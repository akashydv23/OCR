'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview ExportSearchablePDF — Generate a searchable PDF with an invisible text layer.
 *
 * Strategy:
 *   1. Re-rasterise each page from the stored scan blob (visual layer).
 *   2. Overlay invisible Unicode text using a Type 0 CIDFont with an Identity-H
 *      encoding and Identity-ToUnicode CMap at every word's exact bounding box.
 *   3. Text rendering mode 3 (`3 Tr`) is the official ISO 32000 standard for
 *      invisible OCR text layers — text is completely invisible to the eye but
 *      100% searchable (`Cmd + F`), indexable, and copy-pasteable (`Cmd + C`).
 *   4. Zero external font downloads required — works 100% offline for ALL 13
 *      Indian regional scripts (Hindi, Marathi, Sanskrit, Bengali, Tamil, Telugu,
 *      Gujarati, Kannada, Malayalam, Odia, Punjabi, etc.) plus English, numbers,
 *      and punctuation.
 *   5. Y-axis is flipped because PDF coordinate origin is bottom-left.
 *
 * Globals required: PDFLib (pdf-lib v1.17.1), saveAs (FileSaver.js, with fallback)
 */

window.OCRStudio.ExportSearchablePDF = (function () {

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
   * Export a canonical document as a searchable PDF.
   *
   * @param {Object}        doc          - Full canonical document object.
   * @param {Function|null} [getPageBlob] - async (pageNum: number) => Blob (JPEG/PNG image)
   * @param {Function}      [onProgress]  - Optional callback: (currentPage, totalPages) => void
   * @returns {Promise<void>} Triggers a browser file download on success.
   */
  async function exportPDF(doc, getPageBlob, onProgress) {
    if (typeof PDFLib === 'undefined' || !PDFLib.PDFDocument) {
      var notLoadedMsg = 'The PDF generation library (pdf-lib) is not available. Please refresh the page.';
      console.error('[ExportSearchablePDF]', notLoadedMsg);
      if (typeof alert === 'function') {
        alert(notLoadedMsg);
      }
      return;
    }

    var PDFDocument = PDFLib.PDFDocument;
    var PDFName     = PDFLib.PDFName;
    var PDFString   = PDFLib.PDFString;
    var PDFArray    = PDFLib.PDFArray;

    try {
      // ── Create the PDF document ──────────────────────────────────────────
      var pdfDoc = await PDFDocument.create();

      // ── Register Invisible Type 0 Identity-H Font with ToUnicode CMap ───
      // Maps all 16-bit CIDs (0x0000 - 0xFFFF) directly to Unicode codepoints.
      // This allows ANY character (all Indic scripts + Latin + numbers) to be
      // extracted and searched accurately by PDF viewers without downloading large fonts.
      var toUnicodeCMap =
        '/CIDInit /ProcSet findresource begin\n' +
        '12 dict begin\n' +
        'begincmap\n' +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n' +
        '/CMapName /Identity-ToUnicode def\n' +
        '/CMapType 2 def\n' +
        '1 begincodespacerange\n' +
        '<0000> <FFFF>\n' +
        'endcodespacerange\n' +
        '1 beginbfrange\n' +
        '<0000> <FFFF> <0000>\n' +
        'endbfrange\n' +
        'endcmap\n' +
        'CMapName currentdict /CMap defineresource pop\n' +
        'end\n' +
        'end\n';

      var toUnicodeRef = pdfDoc.context.register(pdfDoc.context.flateStream(toUnicodeCMap));

      var fontDescRef = pdfDoc.context.register(pdfDoc.context.obj({
        Type:        'FontDescriptor',
        FontName:    'InvisibleOCR',
        Flags:       4,
        FontBBox:    [0, 0, 1000, 1000],
        ItalicAngle: 0,
        Ascent:      800,
        Descent:     -200,
        CapHeight:   700,
        StemV:       10
      }));

      var cidFontRef = pdfDoc.context.register(pdfDoc.context.obj({
        Type:          'Font',
        Subtype:       'CIDFontType2',
        BaseFont:      'InvisibleOCR',
        CIDSystemInfo: {
          Registry:   PDFString.of('Adobe'),
          Ordering:   PDFString.of('Identity'),
          Supplement: 0
        },
        FontDescriptor: fontDescRef,
        DW:             600,
        CIDToGIDMap:    'Identity'
      }));

      var type0FontRef = pdfDoc.context.register(pdfDoc.context.obj({
        Type:            'Font',
        Subtype:         'Type0',
        BaseFont:        'InvisibleOCR',
        Encoding:        'Identity-H',
        DescendantFonts: [cidFontRef],
        ToUnicode:       toUnicodeRef
      }));

      var fontResourceName = PDFName.of('F_OCR');

      var pages = (doc && doc.pages) ? doc.pages : [];
      var total = pages.length;

      for (var pi = 0; pi < total; pi++) {
        var page = pages[pi];
        var pageNum = page.page_number || (pi + 1);

        // ── Notify caller of progress ────────────────────────────────────
        if (typeof onProgress === 'function') {
          onProgress(pageNum, total);
        }

        // ── Compute PDF page dimensions (pixels → points, 1pt = 1/72 inch) ──
        var dpi   = page.dpi || 200;
        var ptW   = (page.width  || 1654) * 72 / dpi;
        var ptH   = (page.height || 2338) * 72 / dpi;
        var scale = 72 / dpi;

        var pdfPage = pdfDoc.addPage([ptW, ptH]);

        // ── Visual layer: Embed the page scan image ──────────────────────
        if (typeof getPageBlob === 'function') {
          try {
            var blob = await getPageBlob(pageNum);
            if (blob) {
              var arrayBuffer = await blob.arrayBuffer();
              var imgBytes    = new Uint8Array(arrayBuffer);
              var img;

              // Detect PNG signature (0x89, 0x50, 0x4E, 0x47), default to JPEG
              if (imgBytes.length >= 4 &&
                  imgBytes[0] === 0x89 && imgBytes[1] === 0x50 &&
                  imgBytes[2] === 0x4E && imgBytes[3] === 0x47) {
                img = await pdfDoc.embedPng(imgBytes);
              } else {
                img = await pdfDoc.embedJpg(imgBytes);
              }

              pdfPage.drawImage(img, {
                x:      0,
                y:      0,
                width:  ptW,
                height: ptH
              });
            }
          } catch (imgErr) {
            console.warn('[ExportSearchablePDF] Could not embed scan image for page', pageNum, ':', imgErr);
          }
        }

        // ── Attach Invisible Font to Page Resources ──────────────────────
        if (!pdfPage.node.Resources()) {
          pdfPage.node.set(PDFName.of('Resources'), pdfDoc.context.obj({}));
        }
        var res = pdfPage.node.Resources();
        if (!res.has(PDFName.of('Font'))) {
          res.set(PDFName.of('Font'), pdfDoc.context.obj({}));
        }
        res.lookup(PDFName.of('Font')).set(fontResourceName, type0FontRef);

        // ── Invisible text layer ─────────────────────────────────────────
        // Sort blocks by reading_order so text extraction order is logical
        var blocks = (page.blocks || []).slice().sort(function (a, b) {
          return (a.reading_order || 0) - (b.reading_order || 0);
        });

        var pageOps = [];

        for (var bi = 0; bi < blocks.length; bi++) {
          var block = blocks[bi];

          // Split active_text into words for alignment with word bboxes
          var activeWords = (block.active_text || '').split(/\s+/).filter(Boolean);
          var words = block.words || [];

          for (var wi = 0; wi < words.length; wi++) {
            var word = words[wi];

            // Determine display text for this word position
            var wordText = (activeWords.length === words.length)
              ? (activeWords[wi] || word.text || '')
              : (word.text || '');

            wordText = wordText.trim();
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
            var fontSize     = Math.max(1, wordHeightPt * 0.85);

            // Build UTF-16BE hex encoding for the CID font
            var hex = '';
            for (var ci = 0; ci < wordText.length; ci++) {
              var code = wordText.charCodeAt(ci).toString(16).toUpperCase();
              while (code.length < 4) code = '0' + code;
              hex += code;
            }

            // Calculate horizontal scaling (Tz) so the text spans the word bounding box
            // At DW=600, nominal character width is fontSize * 0.6
            var naturalWidth = wordText.length * fontSize * 0.6;
            var horizScale = (naturalWidth > 0 && wordWidthPt > 0) ? (wordWidthPt / naturalWidth) * 100 : 100;
            if (horizScale < 10)  horizScale = 10;
            if (horizScale > 600) horizScale = 600;

            if (pdfX < 0) pdfX = 0;
            if (pdfY < 0) pdfY = 0;

            // 3 Tr: Text rendering mode 3 (neither fill nor stroke text = invisible)
            pageOps.push(
              'BT\n' +
              '3 Tr\n' +
              '/F_OCR ' + fontSize.toFixed(2) + ' Tf\n' +
              horizScale.toFixed(2) + ' Tz\n' +
              '1 0 0 1 ' + pdfX.toFixed(2) + ' ' + pdfY.toFixed(2) + ' Tm\n' +
              '<' + hex + '> Tj\n' +
              'ET\n'
            );
          }
        }

        // Append text stream to page Contents
        if (pageOps.length > 0) {
          var textStream = pdfDoc.context.flateStream(pageOps.join(''));
          var textStreamRef = pdfDoc.context.register(textStream);
          var contents = pdfPage.node.Contents();
          if (!contents) {
            pdfPage.node.set(PDFName.of('Contents'), textStreamRef);
          } else if (contents instanceof PDFArray) {
            contents.push(textStreamRef);
          } else {
            pdfPage.node.set(PDFName.of('Contents'), pdfDoc.context.newArray([contents, textStreamRef]));
          }
        }
      }

      // ── Serialise and trigger download ───────────────────────────────────
      var pdfBytes = await pdfDoc.save();
      var pdfBlob  = new Blob([pdfBytes], { type: 'application/pdf' });

      var docTitle = (doc && doc.metadata && doc.metadata.title) || 'document';
      var filename = docTitle.replace(/\.[^.]+$/, '') + '_searchable.pdf';
      downloadBlob(pdfBlob, filename);

    } catch (err) {
      console.error('[ExportSearchablePDF] Export failed:', err);
      if (typeof alert === 'function') {
        alert('PDF export failed: ' + err.message);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    export: exportPDF
  };

}());
