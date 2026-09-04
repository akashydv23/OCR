'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview ExportTXT — Export a canonical document as a plain-text file.
 *
 * Produces a structured plain-text file with:
 *   - A human-readable header (title, languages, page count, export timestamp).
 *   - Each page delimited by a banner line with the page number.
 *   - Blocks written in reading_order, separated by double newlines.
 *   - Pages separated by triple newlines.
 *
 * This export is synchronous (no async needed — all data is already in memory).
 *
 * Globals required: saveAs (FileSaver.js)
 */

window.OCRStudio.ExportTXT = (function () {

  var SEPARATOR = '============================================================';

  /**
   * Build and download a plain-text representation of the canonical document.
   *
   * @param {Object} doc - Full canonical document object.
   */
  function exportTXT(doc) {
    try {
      var meta  = doc.metadata || {};
      var pages = doc.pages    || [];
      var total = meta.total_pages || pages.length;

      // ── Document header ──────────────────────────────────────────────────
      var lines = [
        'IndicOCR Studio v2 \u2014 Exported Document',
        'Document: '    + (meta.title || 'Untitled'),
        'Languages: '   + ((meta.languages || []).join(', ') || 'N/A'),
        'Total Pages: ' + total,
        'Exported: '    + new Date().toISOString(),
        'Zero Data Transmission: true',
        SEPARATOR,
        ''   // blank line after header
      ];

      // ── Pages ────────────────────────────────────────────────────────────
      for (var pi = 0; pi < pages.length; pi++) {
        var page = pages[pi];

        // Page banner
        lines.push(SEPARATOR);
        lines.push('--- [ PAGE ' + page.page_number + ' OF ' + total + ' ] ---');
        lines.push(SEPARATOR);
        lines.push('');   // blank line after banner

        // Sort blocks by reading_order
        var blocks = (page.blocks || []).slice().sort(function (a, b) {
          return (a.reading_order || 0) - (b.reading_order || 0);
        });

        var blockTexts = blocks.map(function (block) {
          return block.active_text || '';
        });

        // Blocks separated by double newlines
        lines.push(blockTexts.join('\n\n'));
        lines.push('');   // trailing blank line after page content

        // Triple newline between pages (achieved by pushing two extra blanks
        // since we already pushed one above)
        if (pi < pages.length - 1) {
          lines.push('');
          lines.push('');
        }
      }

      var text     = lines.join('\n');
      var blob     = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var filename = (meta.title || 'document').replace(/\.[^.]+$/, '') + '.txt';

      saveAs(blob, filename);

    } catch (err) {
      console.error('[ExportTXT] Export failed:', err);
      alert('TXT export failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    export: exportTXT
  };

}());
