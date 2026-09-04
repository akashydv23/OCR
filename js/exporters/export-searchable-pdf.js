'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview ExportSearchablePDF — Generate a searchable PDF with an invisible text layer.
 *
 * Strategy:
 *   1. Re-rasterise each page from the stored JPEG blob (visual layer).
 *   2. Overlay invisible Helvetica text at every word's bounding box so the
 *      PDF is copy-paste and search-engine friendly.
 *   3. Y-axis is flipped because PDF coordinate origin is bottom-left.
 *
 * Globals required: PDFLib (pdf-lib v1.17.1), saveAs (FileSaver.js)
 */

window.OCRStudio.ExportSearchablePDF = (function () {

  /**
   * Export a canonical document as a searchable PDF.
   *
   * @param {Object}   doc          - Full canonical document object.
   * @param {Function} getPageBlob  - async (pageNum: number) => Blob  (JPEG image)
   * @param {Function} [onProgress] - Optional callback: (currentPage, totalPages) => void
   * @returns {Promise<void>} Triggers a browser file download on success.
   */
  async function exportPDF(doc, getPageBlob, onProgress) {
    // Destructure pdf-lib constructors from the global PDFLib namespace
    var PDFDocument       = PDFLib.PDFDocument;
    var StandardFonts     = PDFLib.StandardFonts;
    var TextRenderingMode = PDFLib.TextRenderingMode;
    var rgb               = PDFLib.rgb;

    try {
      // ── Create the PDF document ──────────────────────────────────────────
      var pdfDoc = await PDFDocument.create();

      // Embed a standard font for the invisible text layer.
      // Helvetica is a core 14 font (no embedding needed) so file size stays small.
      var font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      var pages = doc.pages || [];
      var total = pages.length;

      for (var pi = 0; pi < total; pi++) {
        var page = pages[pi];

        // ── Notify caller of progress ────────────────────────────────────
        if (typeof onProgress === 'function') {
          onProgress(page.page_number, total);
        }

        // ── Fetch the JPEG blob for this page ────────────────────────────
        var blob = await getPageBlob(page.page_number);
        if (!blob) {
          console.warn('[ExportSearchablePDF] No blob for page', page.page_number, '— skipping.');
          continue;
        }

        var arrayBuffer = await blob.arrayBuffer();
        var jpegBytes   = new Uint8Array(arrayBuffer);
        var img         = await pdfDoc.embedJpg(jpegBytes);

        // ── Compute PDF page dimensions (pixels → points, 1pt = 1/72 inch) ──
        var dpi  = page.dpi || 200;
        var ptW  = page.width  * 72 / dpi;   // page width in PDF points
        var ptH  = page.height * 72 / dpi;   // page height in PDF points
        var scale = 72 / dpi;                 // universal pixel-to-point scale factor

        // ── Add the visual (raster) layer ────────────────────────────────
        var pdfPage = pdfDoc.addPage([ptW, ptH]);
        pdfPage.drawImage(img, {
          x:      0,
          y:      0,
          width:  ptW,
          height: ptH
        });

        // ── Add the invisible text layer ─────────────────────────────────
        // Sort blocks by reading_order so text extraction order is logical
        var blocks = (page.blocks || []).slice().sort(function (a, b) {
          return (a.reading_order || 0) - (b.reading_order || 0);
        });

        for (var bi = 0; bi < blocks.length; bi++) {
          var block = blocks[bi];

          // Split active_text into words for alignment with word bboxes
          var activeWords = (block.active_text || '').split(/\s+/).filter(Boolean);

          var words = block.words || [];

          for (var wi = 0; wi < words.length; wi++) {
            var word = words[wi];

            // Determine the display text for this word position:
            // prefer the active_text word at the same index (reflects accepted diffs)
            // but fall back to the raw word.text if counts differ.
            var wordText = (activeWords.length === words.length)
              ? (activeWords[wi] || word.text || '')
              : (word.text || '');

            if (!wordText) continue;

            var bbox = word.bbox;
            if (!bbox) continue;

            // Convert pixel coordinates to PDF points
            var wordWidthPt  = bbox.w * scale;
            var wordHeightPt = bbox.h * scale;
            var pdfX         = bbox.x * scale;
            // PDF Y-axis: origin is BOTTOM-left; canvas Y is TOP-left → flip
            var pdfY         = ptH - (bbox.y + bbox.h) * scale;

            // Font size: fit to bbox height with a small margin
            var fontSize = Math.max(1, wordHeightPt * 0.85);

            // Clamp to ensure text stays within page bounds
            if (pdfX < 0) pdfX = 0;
            if (pdfY < 0) pdfY = 0;

            var cleanWord = (wordText || '')
              .replace(/[\u2018\u2019]/g, "'")
              .replace(/[\u201C\u201D]/g, '"')
              .replace(/[\u2013\u2014]/g, '-')
              .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '-')
              .replace(/[\u00A0]/g, ' ')
              .replace(/[^\x00-\xFF]/g, '');

            if (!cleanWord) continue;

            try {
              pdfPage.drawText(cleanWord, {
                x:       pdfX,
                y:       pdfY,
                size:    fontSize,
                font:    font,
                color:   rgb(0, 0, 0),
                opacity: 0
              });
            } catch (drawErr) {
              // Non-fatal: glyph encoding fallback
            }
          }
        }
      }

      // ── Serialise and trigger download ───────────────────────────────────
      var pdfBytes = await pdfDoc.save();
      var pdfBlob  = new Blob([pdfBytes], { type: 'application/pdf' });

      var filename = (doc.metadata.title || 'document').replace(/\.[^.]+$/, '') + '_searchable.pdf';
      saveAs(pdfBlob, filename);

    } catch (err) {
      console.error('[ExportSearchablePDF] Export failed:', err);
      alert('PDF export failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    export: exportPDF
  };

}());
