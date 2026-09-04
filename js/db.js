'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview DB — IndexedDB persistence layer for IndicOCR Studio v2.
 *
 * Uses Dexie.js v4 (global `Dexie`) as a thin IndexedDB wrapper.
 * All user data stays 100% on-device; no network calls are made here.
 *
 * Database: IndicOCRStudio
 * Tables:
 *   sessions   — one row per OCR session (document-level metadata)
 *   pageBlobs  — raw JPEG images per page
 *   pageData   — canonical page JSON per page
 *   documents  — full canonical doc JSON per session
 *
 * Globals required: Dexie
 */

window.OCRStudio.DB = (function () {

  /** @type {Dexie} */
  var db = null;

  // ─────────────────────────────────────────────
  // Initialisation
  // ─────────────────────────────────────────────

  /**
   * Open (or create) the IndexedDB database and request persistent storage.
   * Must be called once before any other DB operation.
   *
   * @returns {Promise<void>}
   */
  async function init() {
    if (db && db.isOpen()) return; // already open

    db = new Dexie('IndicOCRStudio');

    // Schema version 1
    // Dexie syntax: '++id' = auto-increment PK; other comma-separated fields are indexed.
    // Non-indexed fields (blob, data, doc, metadata) are stored but not listed here.
    db.version(1).stores({
      sessions:  '++id, sessionId, createdAt, title, totalPages, language, status',
      pageBlobs: '++id, sessionId, pageNum, sizeBytes, createdAt',
      pageData:  '++id, sessionId, pageNum',
      documents: '++id, sessionId'
    });

    try {
      await db.open();
    } catch (err) {
      throw new Error('[DB] Failed to open database: ' + err.message);
    }

    // Request persistent storage so the browser won't evict data under quota pressure
    if (navigator.storage && navigator.storage.persist) {
      try {
        var persisted = await navigator.storage.persist();
        if (!persisted) {
          console.warn('[DB] Persistent storage not granted — data may be evicted under quota pressure.');
        }
      } catch (e) {
        console.warn('[DB] navigator.storage.persist() failed:', e);
      }
    }
  }

  /**
   * Assert the database is open. Throws if init() was never called.
   */
  function _assertOpen() {
    if (!db || !db.isOpen()) {
      throw new Error('[DB] Database is not open. Call DB.init() first.');
    }
  }

  // ─────────────────────────────────────────────
  // Session operations
  // ─────────────────────────────────────────────

  /**
   * Persist a new session record.
   *
   * @param {Object} sessionObj - Must contain: sessionId, title, totalPages, language.
   *   Optional: metadata (plain object, stored as JSON), status.
   * @returns {Promise<number>} Auto-increment row id.
   */
  async function saveSession(sessionObj) {
    _assertOpen();
    try {
      var row = {
        sessionId:   sessionObj.sessionId,
        title:       sessionObj.title || 'Untitled',
        totalPages:  sessionObj.totalPages || 0,
        language:    sessionObj.language || '',
        status:      sessionObj.status || 'pending',
        createdAt:   sessionObj.createdAt || new Date().toISOString(),
        metadata:    sessionObj.metadata ? JSON.stringify(sessionObj.metadata) : '{}'
      };
      return await db.sessions.add(row);
    } catch (err) {
      throw new Error('[DB] saveSession failed: ' + err.message);
    }
  }

  /**
   * Retrieve a session by its logical sessionId.
   *
   * @param {string} sessionId
   * @returns {Promise<Object|null>} Session record (metadata parsed back to object), or null.
   */
  async function getSession(sessionId) {
    _assertOpen();
    try {
      var row = await db.sessions.where('sessionId').equals(sessionId).first();
      if (!row) return null;
      row.metadata = row.metadata ? JSON.parse(row.metadata) : {};
      return row;
    } catch (err) {
      throw new Error('[DB] getSession failed: ' + err.message);
    }
  }

  /**
   * Return all sessions, ordered by createdAt descending (newest first).
   *
   * @returns {Promise<Object[]>}
   */
  async function getAllSessions() {
    _assertOpen();
    try {
      var rows = await db.sessions.orderBy('createdAt').reverse().toArray();
      return rows.map(function (row) {
        row.metadata = row.metadata ? JSON.parse(row.metadata) : {};
        return row;
      });
    } catch (err) {
      throw new Error('[DB] getAllSessions failed: ' + err.message);
    }
  }

  /**
   * Update the status and processed page count of a session.
   *
   * @param {string} sessionId
   * @param {string} status          - e.g. 'processing', 'done', 'error'
   * @param {number} [processedPages]
   * @returns {Promise<number>} Number of rows updated.
   */
  async function updateSessionStatus(sessionId, status, processedPages) {
    _assertOpen();
    try {
      var updates = { status: status };
      if (typeof processedPages === 'number') {
        updates.processedPages = processedPages;
      }
      return await db.sessions
        .where('sessionId').equals(sessionId)
        .modify(updates);
    } catch (err) {
      throw new Error('[DB] updateSessionStatus failed: ' + err.message);
    }
  }

  /**
   * Delete a session and ALL its associated page blobs, page data, and document.
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async function deleteSession(sessionId) {
    _assertOpen();
    try {
      await db.transaction('rw', db.sessions, db.pageBlobs, db.pageData, db.documents, async function () {
        await db.sessions.where('sessionId').equals(sessionId).delete();
        await db.pageBlobs.where('sessionId').equals(sessionId).delete();
        await db.pageData.where('sessionId').equals(sessionId).delete();
        await db.documents.where('sessionId').equals(sessionId).delete();
      });
    } catch (err) {
      throw new Error('[DB] deleteSession failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Page blob operations
  // ─────────────────────────────────────────────

  /**
   * Store a raw JPEG Blob for a page image.
   *
   * @param {string} sessionId
   * @param {number} pageNum   - 1-based page number.
   * @param {Blob}   jpegBlob
   * @returns {Promise<number>} Row id.
   */
  async function savePageBlob(sessionId, pageNum, jpegBlob) {
    _assertOpen();
    try {
      // Upsert: delete existing entry first (if any) then insert fresh
      await db.pageBlobs
        .where('[sessionId+pageNum]').equals([sessionId, pageNum])
        .delete()
        .catch(function () { /* no-op if compound index not set up */ });

      return await db.pageBlobs.add({
        sessionId: sessionId,
        pageNum:   pageNum,
        blob:      jpegBlob,
        sizeBytes: jpegBlob.size,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      // Fallback: try a simple put without compound index delete
      try {
        return await db.pageBlobs.add({
          sessionId: sessionId,
          pageNum:   pageNum,
          blob:      jpegBlob,
          sizeBytes: jpegBlob.size,
          createdAt: new Date().toISOString()
        });
      } catch (err2) {
        throw new Error('[DB] savePageBlob failed: ' + err2.message);
      }
    }
  }

  /**
   * Retrieve the JPEG Blob for a specific page.
   *
   * @param {string} sessionId
   * @param {number} pageNum
   * @returns {Promise<Blob|null>}
   */
  async function getPageBlob(sessionId, pageNum) {
    _assertOpen();
    try {
      var row = await db.pageBlobs
        .where('sessionId').equals(sessionId)
        .and(function (r) { return r.pageNum === pageNum; })
        .first();
      return row ? row.blob : null;
    } catch (err) {
      throw new Error('[DB] getPageBlob failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Page data operations
  // ─────────────────────────────────────────────

  /**
   * Persist a canonical page object (stored as JSON string).
   *
   * @param {string} sessionId
   * @param {number} pageNum
   * @param {Object} pageObj - Canonical page object.
   * @returns {Promise<number>} Row id.
   */
  async function savePageData(sessionId, pageNum, pageObj) {
    _assertOpen();
    try {
      // Remove existing entry to avoid duplicates
      await db.pageData
        .where('sessionId').equals(sessionId)
        .and(function (r) { return r.pageNum === pageNum; })
        .delete();

      return await db.pageData.add({
        sessionId: sessionId,
        pageNum:   pageNum,
        data:      JSON.stringify(pageObj)
      });
    } catch (err) {
      throw new Error('[DB] savePageData failed: ' + err.message);
    }
  }

  /**
   * Retrieve and parse a canonical page object.
   *
   * @param {string} sessionId
   * @param {number} pageNum
   * @returns {Promise<Object|null>}
   */
  async function getPageData(sessionId, pageNum) {
    _assertOpen();
    try {
      var row = await db.pageData
        .where('sessionId').equals(sessionId)
        .and(function (r) { return r.pageNum === pageNum; })
        .first();
      if (!row) return null;
      return JSON.parse(row.data);
    } catch (err) {
      throw new Error('[DB] getPageData failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Full document operations
  // ─────────────────────────────────────────────

  /**
   * Persist the full canonical document (stored as JSON string).
   * Overwrites any existing entry for this sessionId.
   *
   * @param {string} sessionId
   * @param {Object} doc - Full canonical document object.
   * @returns {Promise<number>} Row id.
   */
  async function saveDoc(sessionId, doc) {
    _assertOpen();
    try {
      await db.documents.where('sessionId').equals(sessionId).delete();
      return await db.documents.add({
        sessionId: sessionId,
        doc:       JSON.stringify(doc)
      });
    } catch (err) {
      throw new Error('[DB] saveDoc failed: ' + err.message);
    }
  }

  /**
   * Retrieve and parse the full canonical document for a session.
   *
   * @param {string} sessionId
   * @returns {Promise<Object|null>}
   */
  async function getDoc(sessionId) {
    _assertOpen();
    try {
      var row = await db.documents.where('sessionId').equals(sessionId).first();
      if (!row) return null;
      return JSON.parse(row.doc);
    } catch (err) {
      throw new Error('[DB] getDoc failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Storage utilities
  // ─────────────────────────────────────────────

  /**
   * Return current storage usage statistics.
   *
   * @returns {Promise<{usedMB: number, quotaMB: number, pageCount: number}>}
   */
  async function getStorageStats() {
    _assertOpen();
    try {
      var estimate = { usage: 0, quota: 0 };
      if (navigator.storage && navigator.storage.estimate) {
        estimate = await navigator.storage.estimate();
      }

      var pageCount = await db.pageBlobs.count();

      return {
        usedMB:    Math.round((estimate.usage  || 0) / (1024 * 1024) * 100) / 100,
        quotaMB:   Math.round((estimate.quota  || 0) / (1024 * 1024) * 100) / 100,
        pageCount: pageCount
      };
    } catch (err) {
      throw new Error('[DB] getStorageStats failed: ' + err.message);
    }
  }

  /**
   * Delete page blobs for a session that are NOT in the keepPageNums set.
   * Useful for freeing memory from pages no longer needed in the viewport cache.
   *
   * @param {string}   sessionId
   * @param {number[]} keepPageNums - Array of page numbers to retain.
   * @returns {Promise<number>} Number of blobs deleted.
   */
  async function evictPageBlobs(sessionId, keepPageNums) {
    _assertOpen();
    try {
      var keepSet = new Set(keepPageNums || []);
      var deleted = 0;

      await db.pageBlobs
        .where('sessionId').equals(sessionId)
        .each(async function (row) {
          if (!keepSet.has(row.pageNum)) {
            await db.pageBlobs.delete(row.id);
            deleted++;
          }
        });

      return deleted;
    } catch (err) {
      throw new Error('[DB] evictPageBlobs failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    init:                init,
    saveSession:         saveSession,
    getSession:          getSession,
    getAllSessions:       getAllSessions,
    updateSessionStatus: updateSessionStatus,
    deleteSession:       deleteSession,
    savePageBlob:        savePageBlob,
    getPageBlob:         getPageBlob,
    savePageData:        savePageData,
    getPageData:         getPageData,
    saveDoc:             saveDoc,
    getDoc:              getDoc,
    getStorageStats:     getStorageStats,
    evictPageBlobs:      evictPageBlobs
  };

}());
