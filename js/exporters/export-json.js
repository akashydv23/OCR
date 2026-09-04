'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview ExportJSON — Export the full canonical document as a pretty-printed JSON file.
 *
 * The exported payload extends the canonical doc with an `export_audit` field that captures:
 *   - Export timestamp and exporter version.
 *   - All accepted diff IDs across every block (for traceability).
 *   - Aggregate correction counts (accepted / rejected).
 *   - List of page numbers that have needs_review = true.
 *
 * This export is synchronous.
 *
 * Globals required: saveAs (FileSaver.js)
 */

window.OCRStudio.ExportJSON = (function () {

  /**
   * Compute the export_audit block by walking all pages → blocks → diffs.
   *
   * @param {Object} doc - Full canonical document object.
   * @returns {Object} Populated export_audit object.
   */
  function _buildAudit(doc) {
    var audit = {
      exported_at:               new Date().toISOString(),
      exporter_version:          '2.0.0',
      zero_data_transmission:    true,
      processing_location:       'client_browser_on_device',
      applied_diffs:             [],   // diff_ids of all accepted diffs
      total_corrections_accepted: 0,
      total_corrections_rejected: 0,
      pages_needing_review:      []    // page_numbers where needs_review = true
    };

    var pages = doc.pages || [];

    for (var pi = 0; pi < pages.length; pi++) {
      var page = pages[pi];

      // Track pages flagged for human review
      if (page.needs_review) {
        audit.pages_needing_review.push(page.page_number);
      }

      var blocks = page.blocks || [];

      for (var bi = 0; bi < blocks.length; bi++) {
        var block = blocks[bi];
        var diffs = block.diffs || [];

        for (var di = 0; di < diffs.length; di++) {
          var diff = diffs[di];

          if (diff.status === 'accepted') {
            audit.applied_diffs.push(diff.diff_id);
            audit.total_corrections_accepted++;
          } else if (diff.status === 'rejected') {
            audit.total_corrections_rejected++;
          }
          // 'proposed' diffs are intentionally not counted in either bucket
        }
      }
    }

    return audit;
  }

  /**
   * Build and download the canonical document augmented with an audit log.
   *
   * @param {Object} doc - Full canonical document object.
   */
  function exportJSON(doc) {
    try {
      // Build the export payload: shallow-spread the doc + inject audit block
      // We avoid deep-cloning (expensive) by relying on JSON.stringify serialisation.
      var exportPayload = Object.assign({}, doc, {
        export_audit: _buildAudit(doc)
      });

      var json     = JSON.stringify(exportPayload, null, 2);
      var blob     = new Blob([json], { type: 'application/json' });
      var filename = (
        (doc.metadata && doc.metadata.title) ? doc.metadata.title : 'document'
      ).replace(/\.[^.]+$/, '') + '_canonical.json';

      saveAs(blob, filename);

    } catch (err) {
      console.error('[ExportJSON] Export failed:', err);
      alert('JSON export failed: ' + err.message);
    }
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    export: exportJSON
  };

}());
