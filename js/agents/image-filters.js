'use strict';

/**
 * @file image-filters.js
 * @description Pre-processing filters for IndicOCR Studio v2.
 *   Provides Sauvola adaptive binarization and projection-profile-based deskew.
 *   Pure vanilla JS — no external dependencies.
 *
 * Exposes: window.OCRStudio.ImageFilters
 */

window.OCRStudio = window.OCRStudio || {};

/**
 * @namespace window.OCRStudio.ImageFilters
 */
window.OCRStudio.ImageFilters = (function () {

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert an RGBA ImageData to a grayscale Float32Array using
   * ITU-R BT.601 luminance coefficients.
   *
   * @param {ImageData} imageData - Source RGBA image data
   * @returns {Float32Array} Grayscale values in [0, 255]
   */
  function rgbaToGrayscale(imageData) {
    const { data, width, height } = imageData;
    const n = width * height;
    const gray = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const base = i * 4;
      // ITU-R BT.601 luminance weights: 0.299R + 0.587G + 0.114B
      gray[i] = 0.299 * data[base]      // R
              + 0.587 * data[base + 1]  // G
              + 0.114 * data[base + 2]; // B
    }
    return gray;
  }

  /**
   * Build a 2-D integral image (summed-area table) from a 1-D pixel array.
   * Uses Float64Array to prevent overflow on large images (e.g., A3 @ 300dpi
   * can have ~35M pixels; Float32 would lose precision for sum-of-squares).
   *
   * Recurrence: I(x,y) = val + I(x-1,y) + I(x,y-1) - I(x-1,y-1)
   *
   * @param {Float32Array} src    - Flat row-major pixel array
   * @param {number}       width
   * @param {number}       height
   * @returns {Float64Array} Integral image (same indexing as src)
   */
  function buildIntegralImage(src, width, height) {
    const integral = new Float64Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx  = y * width + x;
        const val  = src[idx];
        const left  = x > 0 ? integral[idx - 1]            : 0;
        const above = y > 0 ? integral[idx - width]         : 0;
        const diag  = (x > 0 && y > 0) ? integral[idx - width - 1] : 0;

        integral[idx] = val + left + above - diag;
      }
    }
    return integral;
  }

  /**
   * Compute the rectangular sum from a summed-area table.
   * Rectangle corners: top-left (x1,y1) to bottom-right (x2,y2), inclusive.
   *
   * Standard 4-corner formula:
   *   sum = D - B - C + A
   * where D = I(x2,y2), B = I(x2,y1-1), C = I(x1-1,y2), A = I(x1-1,y1-1)
   *
   * @param {Float64Array} integral
   * @param {number}       width
   * @param {number}       x1, y1 - Top-left corner (already clamped by caller)
   * @param {number}       x2, y2 - Bottom-right corner (already clamped by caller)
   * @returns {number}
   */
  function rectSum(integral, width, x1, y1, x2, y2) {
    const D = integral[y2 * width + x2];
    const B = y1 > 0 ? integral[(y1 - 1) * width + x2]          : 0;
    const C = x1 > 0 ? integral[y2 * width + (x1 - 1)]          : 0;
    const A = (x1 > 0 && y1 > 0) ? integral[(y1 - 1) * width + (x1 - 1)] : 0;
    return D - B - C + A;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {

    /**
     * Apply Sauvola adaptive binarization to an ImageData.
     *
     * Algorithm: T(x,y) = mean * (1 + k * (stddev / R - 1))
     *
     * Uses integral images (Float64Array) for O(1) per-pixel window statistics,
     * making overall complexity O(W × H) regardless of windowSize.
     *
     * Reference: Sauvola & Pietikäinen, "Adaptive document image binarization",
     *            Pattern Recognition 33 (2000) 225–236.
     *
     * @param {ImageData} imageData         - Source RGBA image data
     * @param {number}   [windowSize=15]    - Local window side length (odd preferred)
     * @param {number}   [k=0.2]            - Sensitivity (higher → more black pixels)
     * @param {number}   [R=128]            - Dynamic range of standard deviation
     * @returns {ImageData} Binarized RGBA ImageData (black text on white background)
     */
    applySauvola(imageData, windowSize = 15, k = 0.2, R = 128) {
      const { width, height } = imageData;
      const n = width * height;

      // Step 1: Convert RGBA → grayscale
      const gray = rgbaToGrayscale(imageData);

      // Step 2: Build integral images for g and g² (need both for variance)
      // Variance: Var(X) = E[X²] - E[X]²
      const integralG = buildIntegralImage(gray, width, height);

      const graySquared = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        graySquared[i] = gray[i] * gray[i];
      }
      const integralG2 = buildIntegralImage(graySquared, width, height);

      const half = Math.floor(windowSize / 2);

      // Step 3: Apply Sauvola threshold per pixel
      const output = new Uint8ClampedArray(n * 4);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Clamp local window to image boundaries
          const x1 = Math.max(0, x - half);
          const y1 = Math.max(0, y - half);
          const x2 = Math.min(width  - 1, x + half);
          const y2 = Math.min(height - 1, y + half);

          const area = (x2 - x1 + 1) * (y2 - y1 + 1);

          // O(1) window stats using integral images
          const sumG  = rectSum(integralG,  width, x1, y1, x2, y2);
          const sumG2 = rectSum(integralG2, width, x1, y1, x2, y2);

          const mean     = sumG / area;
          // Clamp variance to >= 0 to guard against floating-point rounding
          const variance = Math.max(0, sumG2 / area - mean * mean);
          const stddev   = Math.sqrt(variance);

          // Sauvola threshold
          const threshold = mean * (1 + k * (stddev / R - 1));

          const idx = y * width + x;
          // gray <= threshold → black (ink); else → white (paper)
          const value = gray[idx] <= threshold ? 0 : 255;

          const base = idx * 4;
          output[base]     = value; // R
          output[base + 1] = value; // G
          output[base + 2] = value; // B
          output[base + 3] = 255;   // A — fully opaque
        }
      }

      return new ImageData(output, width, height);
    },

    // -------------------------------------------------------------------------

    /**
     * Detect and correct page skew using horizontal projection profiles.
     *
     * Strategy:
     *   1. Test candidate angles -15° … +15° in 0.5° steps on an offscreen canvas.
     *   2. For each angle: rotate image, compute horizontal projection
     *      (count non-white pixels per row).
     *   3. Compute variance of the projection array — higher variance means
     *      text rows are more distinct (correctly oriented for the script's
     *      shirorekha / baseline).
     *   4. Apply the best-variance angle to the original canvas in-place.
     *
     * @param {HTMLCanvasElement} canvas - Input canvas (modified in place)
     * @returns {{ canvas: HTMLCanvasElement, skewAngle: number }}
     */
    deskew(canvas) {
      const width  = canvas.width;
      const height = canvas.height;

      // Offscreen canvas for angle testing — never shown to the user
      const offscreen = document.createElement('canvas');
      offscreen.width  = width;
      offscreen.height = height;
      const offCtx = offscreen.getContext('2d');

      let bestAngle    = 0;
      let bestVariance = -Infinity;

      // Test every 0.5° from -15° to +15°
      for (let angleDeg = -15; angleDeg <= 15; angleDeg += 0.5) {
        const angleRad = (angleDeg * Math.PI) / 180;

        // Fill with white before drawing (white background assumption)
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(0, 0, width, height);

        // Rotate about the canvas centre
        offCtx.save();
        offCtx.translate(width / 2, height / 2);
        offCtx.rotate(angleRad);
        offCtx.drawImage(canvas, -width / 2, -height / 2);
        offCtx.restore();

        // Read rotated pixels
        const imgData = offCtx.getImageData(0, 0, width, height);
        const pixels  = imgData.data;

        // Horizontal projection: number of non-white pixels per row
        const projection = new Float64Array(height);
        for (let y = 0; y < height; y++) {
          let count = 0;
          for (let x = 0; x < width; x++) {
            const base = (y * width + x) * 4;
            // BT.601 luminance for whiteness check
            const lum = 0.299 * pixels[base]
                      + 0.587 * pixels[base + 1]
                      + 0.114 * pixels[base + 2];
            if (lum < 250) count++; // threshold: anything < 250 is "ink"
          }
          projection[y] = count;
        }

        // Variance of horizontal projection
        let sum = 0;
        for (let i = 0; i < height; i++) sum += projection[i];
        const mean = sum / height;

        let variance = 0;
        for (let i = 0; i < height; i++) {
          const diff = projection[i] - mean;
          variance += diff * diff;
        }
        variance /= height;

        if (variance > bestVariance) {
          bestVariance = variance;
          bestAngle    = angleDeg;
        }
      }

      // Apply the detected skew correction to the original canvas
      if (Math.abs(bestAngle) > 0.05) { // skip trivial corrections
        // Snapshot original content before overwriting
        const snapshot = document.createElement('canvas');
        snapshot.width  = width;
        snapshot.height = height;
        snapshot.getContext('2d').drawImage(canvas, 0, 0);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate((bestAngle * Math.PI) / 180);
        ctx.drawImage(snapshot, -width / 2, -height / 2);
        ctx.restore();
      }

      return { canvas, skewAngle: bestAngle };
    }

  };

})();
