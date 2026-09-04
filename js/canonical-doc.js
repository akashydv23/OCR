'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview CanonicalDoc — Schema factory & mutation helpers for IndicOCR Studio v2.
 *
 * Canonical document hierarchy:
 *   Document  →  pages[]  →  blocks[]  →  words[]  +  diffs[]
 *
 * Golden rule: raw_text is IMMUTABLE after creation.
 *   All corrections are captured as diffs; active_text is the "live" view.
 *
 * Globals required: none
 */

window.OCRStudio.CanonicalDoc = (function () {

  // ─────────────────────────────────────────────
  // Internal utilities
  // ─────────────────────────────────────────────

  /**
   * Generate a short random hex string of `len` characters.
   * @param {number} len
   * @returns {string}
   */
  function _randomHex(len) {
    var chars = '0123456789abcdef';
    var result = '';
    for (var i = 0; i < len; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  /**
   * Deep-merge `src` into `dst` (shallow for non-object values).
   * Returns a new object — neither dst nor src is mutated.
   * @param {Object} dst
   * @param {Object} src
   * @returns {Object}
   */
  function _deepMerge(dst, src) {
    var result = Object.assign({}, dst);
    for (var key in src) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      if (
        src[key] !== null &&
        typeof src[key] === 'object' &&
        !Array.isArray(src[key]) &&
        typeof dst[key] === 'object' &&
        dst[key] !== null &&
        !Array.isArray(dst[key])
      ) {
        result[key] = _deepMerge(dst[key], src[key]);
      } else {
        result[key] = src[key];
      }
    }
    return result;
  }

  /**
   * Replay all currently-accepted diffs (in array order) on top of raw_text
   * and return the resulting string.
   * @param {Object} block
   * @returns {string}
   */
  function _replayAcceptedDiffs(block) {
    var text = block.raw_text;
    for (var i = 0; i < block.diffs.length; i++) {
      var diff = block.diffs[i];
      if (diff.status === 'accepted') {
        // Replace ALL occurrences of diff.original with diff.suggested
        text = text.split(diff.original).join(diff.suggested);
      }
    }
    return text;
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  /**
   * Generate a unique document ID of the form `doc_YYYYMMDD_RANDOM6CHARS`.
   * @returns {string}
   */
  function generateDocumentId() {
    var ts = new Date().toISOString()
      .replace(/[-:T.Z]/g, '')  // e.g. "20260904143000000"
      .slice(0, 8);             // "20260904"
    return 'doc_' + ts + '_' + _randomHex(6);
  }

  /**
   * Create a new canonical document object.
   *
   * @param {Object} metadata - Partial metadata to merge with defaults.
   *   Recognized keys: title, total_pages, source_file_type, languages, created_at
   * @returns {Object} A canonical document conforming to PRD §6 schema.
   */
  function createDocument(metadata) {
    metadata = metadata || {};

    var defaults = {
      title: 'Untitled',
      total_pages: 0,
      processed_pages: 0,
      source_file_type: 'application/pdf',
      languages: [],
      created_at: new Date().toISOString(),
      provenance: {
        pipeline_version: '2.0.0',
        zero_data_transmission: true,
        processing_location: 'client_browser_on_device'
      }
    };

    // Merge caller-supplied metadata over defaults
    var merged = _deepMerge(defaults, metadata);

    // Provenance.zero_data_transmission is ALWAYS true — enforce regardless of input
    merged.provenance.zero_data_transmission = true;
    merged.provenance.processing_location = 'client_browser_on_device';

    return {
      document_id: generateDocumentId(),
      metadata: merged,
      pages: []
    };
  }

  /**
   * Create a new canonical page object with sensible defaults.
   *
   * @param {number} pageNum   - 1-based page number.
   * @param {number} width     - Page width in pixels (at capture DPI).
   * @param {number} height    - Page height in pixels (at capture DPI).
   * @param {number} [dpi=200] - Capture DPI.
   * @returns {Object} Canonical page object.
   */
  function createPage(pageNum, width, height, dpi) {
    return {
      page_number: pageNum,
      width: width || 0,
      height: height || 0,
      dpi: dpi || 200,
      skew_angle: 0,
      confidence: 0,
      estimated_wer: 0,
      needs_review: false,
      review_flags: [],
      blocks: []
    };
  }

  /**
   * Create a new canonical block object.
   *
   * @param {number} pageNum     - 1-based page number this block belongs to.
   * @param {number} blockIndex  - 0-based index of this block on the page.
   * @param {Object} [blockData] - Partial block fields to override defaults.
   * @returns {Object} Canonical block object.
   */
  function createBlock(pageNum, blockIndex, blockData) {
    blockData = blockData || {};

    var blockId = 'blk_p' + pageNum + '_b' + blockIndex;

    var defaults = {
      block_id: blockId,
      reading_order: blockIndex,
      type: 'paragraph',          // 'heading' | 'paragraph' | 'table' | 'figure' | 'footer' | 'other'
      column_index: 0,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      script: 'Latin',            // e.g. 'Devanagari', 'Bengali', 'Latin', ...
      is_code_mixed: false,
      raw_text: '',
      active_text: '',
      confidence: 0,
      needs_review: false,
      review_flags: [],
      diffs: [],
      words: []
    };

    var block = Object.assign({}, defaults, blockData);

    // Ensure block_id is consistent when not explicitly supplied
    if (!blockData.block_id) {
      block.block_id = blockId;
    }

    // active_text mirrors raw_text on creation if not explicitly supplied
    if (!blockData.active_text && block.raw_text) {
      block.active_text = block.raw_text;
    }

    return block;
  }

  /**
   * Create a new diff object for a block.
   *
   * @param {string} blockId          - ID of the owning block (e.g. 'blk_p1_b0').
   * @param {number} pageNum          - 1-based page number.
   * @param {string} original         - The erroneous text fragment.
   * @param {string} suggested        - The corrected replacement.
   * @param {string} reason           - Human-readable reason for the correction.
   * @param {string} [source]         - Source agent / tool (default: 'correction_agent').
   * @param {number} [confidenceGain=0] - Expected confidence improvement (0.0-1.0).
   * @returns {Object} Canonical diff object with status 'proposed'.
   */
  function createDiff(blockId, pageNum, original, suggested, reason, source, confidenceGain) {
    var safeBlockId = (blockId || 'blk_p' + pageNum + '_b0').replace(/[^a-z0-9_]/gi, '_');
    var diffId = 'diff_' + safeBlockId + '_' + Date.now() + '_' + _randomHex(3);

    return {
      diff_id: diffId,
      original: original || '',
      suggested: suggested || '',
      reason: reason || '',
      status: 'proposed',           // 'proposed' | 'accepted' | 'rejected'
      source: source || 'correction_agent',
      confidence_gain: typeof confidenceGain === 'number' ? confidenceGain : 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Apply a diff to a block — replace occurrences of diff.original with diff.suggested
   * in block.active_text, and mark the diff as 'accepted'.
   *
   * NEVER modifies block.raw_text.
   *
   * @param {Object} block  - Canonical block object (mutated in place).
   * @param {string} diffId - ID of the diff to apply.
   * @returns {boolean} True if the diff was found and applied; false otherwise.
   */
  function applyDiff(block, diffId) {
    var diff = null;
    for (var i = 0; i < block.diffs.length; i++) {
      if (block.diffs[i].diff_id === diffId) {
        diff = block.diffs[i];
        break;
      }
    }

    if (!diff) {
      console.warn('[CanonicalDoc] applyDiff: diff not found:', diffId);
      return false;
    }

    if (diff.status === 'accepted') {
      // Already applied — idempotent no-op
      return true;
    }

    // Replace ALL occurrences of original in active_text with suggested
    block.active_text = block.active_text.split(diff.original).join(diff.suggested);
    diff.status = 'accepted';

    return true;
  }

  /**
   * Revert a previously-accepted diff.
   *
   * Recomputes active_text by replaying ONLY the remaining accepted diffs
   * (in their original array order) on top of raw_text. This ensures correct
   * multi-diff stacking when diffs may overlap.
   *
   * @param {Object} block  - Canonical block object (mutated in place).
   * @param {string} diffId - ID of the diff to revert.
   * @returns {boolean} True if the diff was found; false otherwise.
   */
  function revertDiff(block, diffId) {
    var diff = null;
    for (var i = 0; i < block.diffs.length; i++) {
      if (block.diffs[i].diff_id === diffId) {
        diff = block.diffs[i];
        break;
      }
    }

    if (!diff) {
      console.warn('[CanonicalDoc] revertDiff: diff not found:', diffId);
      return false;
    }

    // Mark as rejected first so _replayAcceptedDiffs skips it
    diff.status = 'rejected';

    // Recompute active_text from scratch by replaying remaining accepted diffs
    block.active_text = _replayAcceptedDiffs(block);

    return true;
  }

  /**
   * Return the current live text of a block (i.e. raw_text with all
   * accepted diffs applied).
   *
   * @param {Object} block - Canonical block object.
   * @returns {string}
   */
  function getActiveText(block) {
    return block.active_text;
  }

  /**
   * Append a page object to a document and increment processed_pages.
   *
   * @param {Object} doc     - Canonical document object (mutated in place).
   * @param {Object} pageObj - Canonical page object to append.
   */
  function addPageToDoc(doc, pageObj) {
    doc.pages.push(pageObj);
    doc.metadata.processed_pages = doc.pages.length;
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    generateDocumentId: generateDocumentId,
    createDocument:     createDocument,
    createPage:         createPage,
    createBlock:        createBlock,
    createDiff:         createDiff,
    applyDiff:          applyDiff,
    revertDiff:         revertDiff,
    getActiveText:      getActiveText,
    addPageToDoc:       addPageToDoc
  };

}());
