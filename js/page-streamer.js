'use strict';

/**
 * page-streamer.js — Memory-Bounded Page Streaming Engine
 *
 * Renders PDF pages sequentially (1 at a time) at 200 DPI using PDF.js.
 * After rendering, immediately compresses to JPEG and writes to IndexedDB.
 * Clears the canvas bitmap from JS heap, keeping peak RAM < 250 MB.
 *
 * Supports: pause / resume / cancel controls.
 * Emits events via callbacks: onPageReady, onProgress, onComplete, onError.
 *
 * Depends on: pdfjsLib (global ESM), OCRStudio.DB
 * Exposes: window.OCRStudio.PageStreamer (class)
 */

window.OCRStudio = window.OCRStudio || {};

window.OCRStudio.PageStreamer = class PageStreamer {

  /**
   * @param {File} file - The PDF or image file to stream
   * @param {string} sessionId - Session ID for IndexedDB storage
   * @param {number} [dpi=200] - Render DPI for PDF rasterization
   * @param {number} [concurrency=2] - Number of pages to process in parallel
   */
  constructor(file, sessionId, dpi = 200, concurrency = 2) {
    this.file = file;
    this.sessionId = sessionId;
    this.dpi = dpi;
    this.concurrency = Math.max(1, concurrency || 2);
    this.totalPages = 0;
    this.currentPage = 0;

    // Control state
    this._paused = false;
    this._cancelled = false;
    this._resumeResolve = null; // Resolve function for the pause-resume promise

    // PDF document reference (if PDF)
    this._pdfDoc = null;

    // Callbacks
    this.onPageReady = null;   // (pageNum, width, height, jpegBlob) => void
    this.onProgress = null;    // (current, total) => void
    this.onComplete = null;    // () => void
    this.onError = null;       // (error, pageNum) => void
  }

  /**
   * Begin streaming all pages from the file.
   * Resolves when all pages are processed or cancelled.
   */
  async start() {
    this._cancelled = false;
    this._paused = false;

    try {
      const isPdf = await this._isPDF(this.file);

      if (isPdf) {
        await this._streamPDF();
      } else {
        await this._streamImages([this.file]);
      }
    } catch (err) {
      if (this._cancelled) return;
      console.error('[PageStreamer] Fatal error:', err);
      this.onError?.(err, this.currentPage);
    }
  }

  /**
   * Pause streaming between page boundaries.
   * Safe to call at any time — takes effect after the current page finishes.
   */
  pause() {
    if (!this._paused) {
      this._paused = true;
      console.log('[PageStreamer] Paused after page', this.currentPage);
    }
  }

  /**
   * Resume streaming after a pause.
   */
  resume() {
    if (this._paused) {
      this._paused = false;
      this._resumeResolve?.();
      this._resumeResolve = null;
      console.log('[PageStreamer] Resumed');
    }
  }

  /**
   * Cancel streaming immediately.
   * No further callbacks will be fired after cancel.
   */
  cancel() {
    this._cancelled = true;
    this._paused = false;
    this._resumeResolve?.();
    this._resumeResolve = null;
    console.log('[PageStreamer] Cancelled at page', this.currentPage);
  }

  /**
   * Retrieve a previously-rendered page as a canvas element.
   * Reads JPEG blob from IndexedDB, draws onto an OffscreenCanvas, returns it.
   * @param {number} pageNum
   * @returns {Promise<HTMLCanvasElement|null>}
   */
  async getPage(pageNum) {
    const blob = await window.OCRStudio.DB.getPageBlob(this.sessionId, pageNum);
    if (!blob) return null;

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  // ─── Private: PDF Streaming ──────────────────────────────────────────────

  async _streamPDF() {
    // Ensure pdfjsLib is available (wait if still loading as module)
    if (!window.pdfjsLib) {
      for (let i = 0; i < 50; i++) {
        if (window.pdfjsLib) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!window.pdfjsLib) {
        throw new Error('PDF.js engine is still loading. Please check your internet connection.');
      }
    }

    const arrayBuffer = await this.file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/standard_fonts/',
    });
    this._pdfDoc = await loadingTask.promise;

    this.totalPages = this._pdfDoc.numPages;
    console.log(`[PageStreamer] PDF loaded: ${this.totalPages} pages (Concurrency: ${this.concurrency})`);

    const activeTasks = new Set();

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      if (this._cancelled) break;

      // Wait if paused
      if (this._paused) {
        await this._waitForResume();
        if (this._cancelled) break;
      }

      this.currentPage = pageNum;

      try {
        const { blob, width, height } = await this._renderPDFPage(pageNum);

        if (!blob || blob.size === 0) {
          throw new Error(`Failed to rasterize page ${pageNum} image`);
        }

        // Write to IndexedDB immediately
        await window.OCRStudio.DB.savePageBlob(this.sessionId, pageNum, blob);

        // Throttle concurrency: if we have reached max concurrency, wait for at least one to complete
        while (activeTasks.size >= this.concurrency && !this._cancelled) {
          await Promise.race(activeTasks);
        }

        if (this._cancelled) break;

        // Dispatch page processing task
        if (typeof this.onPageReady === 'function') {
          let taskPromise = null;
          taskPromise = Promise.resolve(this.onPageReady(pageNum, width, height, blob))
            .catch((err) => {
              console.error(`[PageStreamer] Error processing page ${pageNum}:`, err);
              this.onError?.(err, pageNum);
            })
            .finally(() => {
              activeTasks.delete(taskPromise);
              this.onProgress?.(pageNum, this.totalPages);
            });

          activeTasks.add(taskPromise);
        } else {
          this.onProgress?.(pageNum, this.totalPages);
        }

      } catch (err) {
        console.error(`[PageStreamer] Error on page ${pageNum}:`, err);
        this.onError?.(err, pageNum);
        // Continue to next page — don't abort the whole job
      }
    }

    // Await any remaining parallel tasks
    await Promise.all(Array.from(activeTasks));

    if (this._pdfDoc) {
      try {
        await this._pdfDoc.destroy();
      } catch (e) { /* ignore */ }
      this._pdfDoc = null;
    }

    if (!this._cancelled) {
      this.onComplete?.();
    }
  }

  /**
   * Render a single PDF page to a canvas, compress to JPEG blob.
   * The canvas is immediately set to null after capture (GC hint).
   * @param {number} pageNum
   * @returns {Promise<{ blob: Blob, width: number, height: number }>}
   */
  async _renderPDFPage(pageNum) {
    const page = await this._pdfDoc.getPage(pageNum);
    const scale = this.dpi / 72; // PDF.js works in 72 DPI units
    const viewport = page.getViewport({ scale });

    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // White background (important for OCR — some PDFs have transparent pages)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    try {
      const renderTask = page.render({ canvasContext: ctx, viewport: viewport });
      await renderTask.promise;
    } catch (renderErr) {
      console.warn(`[PageStreamer] Page ${pageNum} render warning:`, renderErr);
    } finally {
      try {
        page.cleanup(); // Free PDF.js internal resources
      } catch (e) { /* ignore */ }
    }

    // Compress canvas to JPEG blob with bulletproof fallback
    const blob = await this._canvasToBlob(canvas, 'image/jpeg', 0.90);

    // Explicitly clear canvas to hint GC
    canvas.width = 0;
    canvas.height = 0;

    return { blob, width, height };
  }

  // ─── Private: Image Streaming (single images or multi-file batch) ─────────

  async _streamImages(files) {
    this.totalPages = files.length;
    console.log(`[PageStreamer] Images loaded: ${this.totalPages} pages (Concurrency: ${this.concurrency})`);

    const activeTasks = new Set();

    for (let i = 0; i < files.length; i++) {
      if (this._cancelled) break;
      if (this._paused) {
        await this._waitForResume();
        if (this._cancelled) break;
      }

      const pageNum = i + 1;
      this.currentPage = pageNum;

      try {
        const { blob, width, height } = await this._loadImageAsJPEG(files[i]);
        await window.OCRStudio.DB.savePageBlob(this.sessionId, pageNum, blob);

        // Throttle concurrency
        while (activeTasks.size >= this.concurrency && !this._cancelled) {
          await Promise.race(activeTasks);
        }

        if (this._cancelled) break;

        if (typeof this.onPageReady === 'function') {
          let taskPromise = null;
          taskPromise = Promise.resolve(this.onPageReady(pageNum, width, height, blob))
            .catch((err) => {
              console.error(`[PageStreamer] Error processing image ${files[i].name}:`, err);
              this.onError?.(err, pageNum);
            })
            .finally(() => {
              activeTasks.delete(taskPromise);
              this.onProgress?.(pageNum, this.totalPages);
            });

          activeTasks.add(taskPromise);
        } else {
          this.onProgress?.(pageNum, this.totalPages);
        }
      } catch (err) {
        console.error(`[PageStreamer] Error loading image ${files[i].name}:`, err);
        this.onError?.(err, pageNum);
      }
    }

    // Await any remaining parallel image tasks
    await Promise.all(Array.from(activeTasks));

    if (!this._cancelled) {
      this.onComplete?.();
    }
  }

  /**
   * Load an image file into a canvas and compress to JPEG blob.
   * @param {File} file
   * @returns {Promise<{ blob: Blob, width: number, height: number }>}
   */
  async _loadImageAsJPEG(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        const blob = await this._canvasToBlob(canvas, 'image/jpeg', 0.90);
        const { width, height } = canvas;
        canvas.width = 0;
        canvas.height = 0;

        resolve({ blob, width, height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image: ${file.name}`));
      };
      img.src = url;
    });
  }

  // ─── Private: Utilities ───────────────────────────────────────────────────

  /**
   * Convert canvas to a Blob using the specified format and quality.
   * Includes bulletproof fallback to toDataURL in case Safari hangs or returns null.
   * @param {HTMLCanvasElement} canvas
   * @param {string} type - MIME type ('image/jpeg' or 'image/png')
   * @param {number} quality - 0.0–1.0
   * @returns {Promise<Blob>}
   */
  _canvasToBlob(canvas, type = 'image/jpeg', quality = 0.90) {
    return new Promise((resolve, reject) => {
      let settled = false;

      // 2.5-second timeout in case Safari's canvas.toBlob never invokes callback
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn('[PageStreamer] canvas.toBlob timed out — using toDataURL fallback');
        try {
          const blob = this._dataUrlToBlob(canvas.toDataURL(type, quality));
          resolve(blob);
        } catch (err) {
          try {
            const pngBlob = this._dataUrlToBlob(canvas.toDataURL('image/png'));
            resolve(pngBlob);
          } catch (err2) {
            reject(new Error('[PageStreamer] Canvas encoding failed: ' + err2.message));
          }
        }
      }, 2500);

      try {
        canvas.toBlob(
          (blob) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (blob && blob.size > 0) {
              resolve(blob);
            } else {
              console.warn('[PageStreamer] canvas.toBlob returned empty — using toDataURL fallback');
              try {
                const b = this._dataUrlToBlob(canvas.toDataURL(type, quality));
                resolve(b);
              } catch (e) {
                reject(new Error('[PageStreamer] toDataURL fallback failed: ' + e.message));
              }
            }
          },
          type,
          quality
        );
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          const b = this._dataUrlToBlob(canvas.toDataURL(type, quality));
          resolve(b);
        } catch (e) {
          reject(new Error('[PageStreamer] toBlob threw: ' + err.message));
        }
      }
    });
  }

  _dataUrlToBlob(dataURL) {
    const parts = dataURL.split(';base64,');
    const contentType = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const raw = window.atob(parts[1]);
    const uInt8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  }

  /**
   * Check if a File is a PDF by reading its magic bytes.
   * @param {File} file
   * @returns {Promise<boolean>}
   */
  async _isPDF(file) {
    const header = await file.slice(0, 5).arrayBuffer();
    const bytes = new Uint8Array(header);
    return (
      bytes[0] === 0x25 && // %
      bytes[1] === 0x50 && // P
      bytes[2] === 0x44 && // D
      bytes[3] === 0x46    // F
    );
  }

  /**
   * Wait until resume() is called.
   * @returns {Promise<void>}
   */
  _waitForResume() {
    return new Promise((resolve) => {
      this._resumeResolve = resolve;
    });
  }

};
