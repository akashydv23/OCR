'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview ExportDOCX — Export a canonical document as a .docx file.
 *
 * Uses docx.js (global `docx`) and FileSaver.js (global `saveAs`) with fallback.
 *
 * Document structure:
 *   - One section with all pages concatenated.
 *   - Each page is preceded by a small gray page-label paragraph.
 *   - Heading blocks → HEADING_2 style.
 *   - All other blocks → normal paragraph (24 half-points / 12pt rendered).
 *   - Pages are separated by explicit PageBreak paragraphs.
 *
 * Globals required: docx (window.docx), saveAs (window.saveAs, with fallback)
 */

window.OCRStudio.ExportDOCX = (function () {

  /**
   * Helper to trigger browser blob download safely with fallback.
   * @param {Blob}   blob
   * @param {string} filename
   */
  function downloadBlob(blob, filename) {
    if (typeof window.saveAs === 'function') {
      window.saveAs(blob, filename);
    } else {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    }
  }

  /**
   * Export a canonical document as a Microsoft Word .docx file.
   *
   * @param {Object}        doc         - Full canonical document object.
   * @param {Function|null} [getPageBlob] - async (pageNum) => Blob (JPEG), or null to skip images.
   * @returns {Promise<void>} Triggers a browser file download on success.
   */
  async function exportDOCX(doc, getPageBlob) {
    if (typeof docx === 'undefined' || !docx.Document || !docx.Packer) {
      var notLoadedMsg = 'The Word (.docx) export library is still loading or could not be loaded. Please check your network connection and refresh the page.';
      console.error('[ExportDOCX]', notLoadedMsg);
      if (typeof alert === 'function') {
        alert(notLoadedMsg);
      }
      return;
    }

    // Destructure needed constructors from the docx global namespace
    var Document     = docx.Document;
    var Packer       = docx.Packer;
    var Paragraph    = docx.Paragraph;
    var TextRun      = docx.TextRun;
    var PageBreak    = docx.PageBreak;
    var HeadingLevel = docx.HeadingLevel;

    try {
      var pages = (doc && doc.pages) ? doc.pages : [];
      var total = pages.length;

      /** @type {Array} All paragraph/run children for the single document section */
      var children = [];

      for (var pi = 0; pi < total; pi++) {
        var page = pages[pi];
        var pageNum = page.page_number || (pi + 1);

        // ── Page header label ────────────────────────────────────────────
        // A small, gray, non-intrusive marker so readers can identify pages.
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text:  '--- Page ' + pageNum + ' of ' + total + ' ---',
                size:  20,           // 10pt (half-points)
                color: '808080',     // Gray
                font:  'Arial'
              })
            ]
          })
        );

        // ── Blocks ───────────────────────────────────────────────────────
        // Sort by reading_order to maintain logical document flow
        var blocks = (page.blocks || []).slice().sort(function (a, b) {
          return (a.reading_order || 0) - (b.reading_order || 0);
        });

        for (var bi = 0; bi < blocks.length; bi++) {
          var block    = blocks[bi];
          var text     = (block.active_text || '').trim();
          if (!text) continue;

          var isHeading = block.type === 'heading';

          if (isHeading) {
            // ── Heading block ──────────────────────────────────────────
            children.push(
              new Paragraph({
                heading:  HeadingLevel.HEADING_2,
                children: [
                  new TextRun({
                    text: text,
                    font: 'Arial'
                  })
                ]
              })
            );
          } else {
            // ── Body / paragraph block (including table, figure captions, etc.) ──
            // size: 24 half-points = 12pt body text
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: text,
                    font: 'Arial',
                    size: 24
                  })
                ]
              })
            );
          }
        }

        // ── Page break between pages (not after the last page) ───────────
        if (pi < total - 1) {
          children.push(
            new Paragraph({
              children: [new PageBreak()]
            })
          );
        }
      }

      // ── Assemble the Document ────────────────────────────────────────────
      var docTitle = (doc && doc.metadata && doc.metadata.title) || 'Exported Document';
      var docInstance = new Document({
        creator:     'IndicOCR Studio v2',
        description: 'Exported by IndicOCR Studio v2 — zero data transmission',
        title:       docTitle,
        sections: [{
          properties: {},
          children:   children
        }]
      });

      // ── Serialise and trigger download ───────────────────────────────────
      var blob = await Packer.toBlob(docInstance);
      var filename = docTitle.replace(/\.[^.]+$/, '') + '.docx';
      downloadBlob(blob, filename);

    } catch (err) {
      console.error('[ExportDOCX] Export failed:', err);
      if (typeof alert === 'function') {
        alert('DOCX export failed: ' + err.message);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    export: exportDOCX
  };

}());
