'use strict';

/**
 * preflight.js — Pre-flight Document Analyzer
 *
 * Analyzes uploaded files BEFORE full processing begins.
 * Checks page count, dimensions, estimated memory usage, CPU concurrency,
 * and available device memory. Emits warnings for documents that may stress
 * browser resources.
 *
 * Depends on: pdfjsLib (loaded as ESM module in index.html)
 * Exposes: window.OCRStudio.PreflightAnalyzer
 */

window.OCRStudio = window.OCRStudio || {};

window.OCRStudio.PreflightAnalyzer = (() => {

  /** Render DPI for page rasterization (affects RAM per page). */
  const RENDER_DPI = 200;

  /** Warn if doc exceeds this many pages. */
  const PAGE_COUNT_WARNING_THRESHOLD = 300;

  /** Estimated seconds per page on average hardware. */
  const SECONDS_PER_PAGE_BASELINE = 3.0;

  /**
   * Estimate memory for one page at RENDER_DPI in MB.
   * A 200 DPI A4 page is ~1654 × 2338 px = ~3.87 MP.
   * RGBA = 4 bytes/px → ~15.5 MB raw. JPEG compressed to ~0.3 MB.
   * We hold 2 pages in RAM at a time (raw canvas + processing buffer).
   */
  const estimatePageRamMB = (width, height) => {
    const rawBytes = width * height * 4; // RGBA
    return (rawBytes / (1024 * 1024)).toFixed(1);
  };

  /**
   * Determine if a file is a PDF by checking the magic bytes.
   * @param {File} file
   * @returns {Promise<boolean>}
   */
  const isPDF = async (file) => {
    const header = await file.slice(0, 5).arrayBuffer();
    const bytes = new Uint8Array(header);
    return bytes[0] === 0x25 && bytes[1] === 0x50 &&
           bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  };

  /**
   * Get page count and dimensions from a PDF file using PDF.js.
   * @param {File} file
   * @returns {Promise<{ pageCount: number, width: number, height: number, allDimensions: Array }>}
   */
  const analyzePDF = async (file) => {
    if (!window.pdfjsLib) {
      for (let i = 0; i < 40; i++) {
        if (window.pdfjsLib) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!window.pdfjsLib) {
        throw new Error('PDF engine is still loading. Please try again in a moment.');
      }
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/standard_fonts/',
    }).promise;
    const pageCount = pdf.numPages;

    const allDimensions = [];
    // Sample up to 5 pages to detect dimension variance
    const sampleCount = Math.min(5, pageCount);
    for (let i = 1; i <= sampleCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 }); // scale=1 → raw PDF points (72 DPI)
      // Convert from points to pixels at RENDER_DPI
      const scale = RENDER_DPI / 72;
      allDimensions.push({
        page: i,
        widthPt: Math.round(viewport.width),
        heightPt: Math.round(viewport.height),
        widthPx: Math.round(viewport.width * scale),
        heightPx: Math.round(viewport.height * scale),
      });
      page.cleanup();
    }

    // Use first page as representative
    const { widthPx, heightPx } = allDimensions[0];
    await pdf.destroy();

    return { pageCount, width: widthPx, height: heightPx, allDimensions };
  };

  /**
   * Get dimensions from a single image file.
   * @param {File} file
   * @returns {Promise<{ width: number, height: number }>}
   */
  const analyzeImage = (file) => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Cannot load image: ${file.name}`));
      };
      img.src = url;
    });
  };

  /**
   * Detect device memory and CPU concurrency.
   * @returns {{ hardwareConcurrency: number, deviceMemoryGB: number | null }}
   */
  const detectHardware = () => {
    return {
      hardwareConcurrency: navigator.hardwareConcurrency || 4,
      deviceMemoryGB: navigator.deviceMemory || null, // Only available in Chrome
    };
  };

  /**
   * Main analysis function. Accepts a single File object (PDF or image).
   *
   * @param {File} file - The uploaded file to analyze
   * @param {string} [language='hin+eng'] - Selected OCR language
   * @returns {Promise<{
   *   pageCount: number,
   *   width: number,
   *   height: number,
   *   dpi: number,
   *   estimatedRamPerPageMB: number,
   *   peakRamEstimateMB: number,
   *   estimatedTotalSeconds: number,
   *   estimatedTotalFormatted: string,
   *   fileType: 'pdf' | 'image',
   *   hardware: object,
   *   warnings: string[],
   *   allDimensions: Array
   * }>}
   */
  const analyze = async (file, language = 'hin+eng') => {
    const warnings = [];
    const hardware = detectHardware();
    let pageCount = 1;
    let width = 0;
    let height = 0;
    let allDimensions = [];
    let fileType = 'image';

    try {
      const pdfCheck = await isPDF(file);
      if (pdfCheck) {
        fileType = 'pdf';
        const pdfInfo = await analyzePDF(file);
        pageCount = pdfInfo.pageCount;
        width = pdfInfo.width;
        height = pdfInfo.height;
        allDimensions = pdfInfo.allDimensions;
      } else {
        // Single image or multi-file batch
        const dims = await analyzeImage(file);
        width = dims.width;
        height = dims.height;
        allDimensions = [{ page: 1, widthPx: width, heightPx: height }];
      }
    } catch (err) {
      warnings.push(`Could not fully analyze file: ${err.message}. Using estimates.`);
      width = Math.round(8.5 * RENDER_DPI); // Assume letter-size
      height = Math.round(11 * RENDER_DPI);
    }

    // Estimate RAM: raw canvas = width × height × 4 bytes (RGBA)
    // Keep 2 pages in memory simultaneously (current + next pre-load)
    const rawPageBytes = width * height * 4;
    const estimatedRamPerPageMB = parseFloat((rawPageBytes / (1024 * 1024)).toFixed(1));
    const peakRamEstimateMB = Math.ceil(estimatedRamPerPageMB * 2 + 80); // +80MB for Tesseract worker overhead

    // Throughput estimate (adjust for hardware)
    const concurrencyFactor = Math.min(1.5, hardware.hardwareConcurrency / 4);
    const secondsPerPage = SECONDS_PER_PAGE_BASELINE / concurrencyFactor;
    const estimatedTotalSeconds = Math.round(pageCount * secondsPerPage);
    const estimatedTotalFormatted = formatTime(estimatedTotalSeconds);

    // ─── Warnings ─────────────────────────────────────────────────────────────

    if (pageCount > PAGE_COUNT_WARNING_THRESHOLD) {
      warnings.push(
        `Document has ${pageCount} pages (threshold: ${PAGE_COUNT_WARNING_THRESHOLD}). ` +
        `Processing may take ${estimatedTotalFormatted}. Make sure your browser tab remains open.`
      );
    }

    if (peakRamEstimateMB > 250) {
      warnings.push(
        `Peak RAM estimate (${peakRamEstimateMB} MB) exceeds the 250 MB target. ` +
        `The memory-bounded streamer will minimize impact, but consider closing other heavy tabs.`
      );
    }

    if (hardware.deviceMemoryGB !== null && hardware.deviceMemoryGB < 4) {
      warnings.push(
        `Device has only ${hardware.deviceMemoryGB} GB RAM detected. ` +
        `For documents over 100 pages, you may experience slowdowns.`
      );
    }

    if (hardware.hardwareConcurrency < 4) {
      warnings.push(
        `Device has ${hardware.hardwareConcurrency} CPU threads. ` +
        `Processing speed may be slower than on multi-core systems.`
      );
    }

    if (width > 3000 || height > 4000) {
      warnings.push(
        `Very high resolution pages detected (${width}×${height}px). ` +
        `OCR accuracy will be excellent but processing will be slower.`
      );
    }

    return {
      pageCount,
      width,
      height,
      dpi: RENDER_DPI,
      estimatedRamPerPageMB,
      peakRamEstimateMB,
      estimatedTotalSeconds,
      estimatedTotalFormatted,
      fileType,
      hardware,
      warnings,
      allDimensions,
    };
  };

  /**
   * Format seconds into a human-readable string.
   * @param {number} totalSeconds
   * @returns {string} e.g., '2m 15s', '45s', '1h 3m'
   */
  const formatTime = (totalSeconds) => {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${secs}s`;
  };

  return {
    analyze,
    RENDER_DPI,
    formatTime,
  };

})();
