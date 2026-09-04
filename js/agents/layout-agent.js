'use strict';

/**
 * @file layout-agent.js
 * @description Layout analysis agent for IndicOCR Studio v2.
 *   Converts raw Tesseract word objects into canonical, reading-order-sorted
 *   block objects with column awareness, type classification, and confidence
 *   normalisation. Pure vanilla JS — no external dependencies.
 *
 * Exposes: window.OCRStudio.LayoutAgent
 */

window.OCRStudio = window.OCRStudio || {};

/**
 * @namespace window.OCRStudio.LayoutAgent
 */
window.OCRStudio.LayoutAgent = (function () {

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute the median of a numeric array. Returns 0 for empty arrays.
   * @param {number[]} arr
   * @returns {number}
   */
  function median(arr) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Compute the union bounding box of an array of {x, y, w, h} rectangles.
   * @param {Array<{x:number,y:number,w:number,h:number}>} boxes
   * @returns {{x:number, y:number, w:number, h:number}}
   */
  function unionBBox(boxes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * Convert a Tesseract bbox {x0, y0, x1, y1} to the canonical {x, y, w, h}.
   * Tesseract uses absolute corner coordinates; we use top-left + dimensions.
   *
   * @param {{x0:number, y0:number, x1:number, y1:number}} tb
   * @returns {{x:number, y:number, w:number, h:number}}
   */
  function tessBboxToXYWH(tb) {
    return {
      x: tb.x0,
      y: tb.y0,
      w: tb.x1 - tb.x0,
      h: tb.y1 - tb.y0
    };
  }

  /**
   * Detect the number of columns and the column boundary x-coordinate.
   *
   * Algorithm:
   *   1. Build a pixel-wide occupancy histogram (length = pageWidth).
   *   2. Mark each word's horizontal span as occupied.
   *   3. Search the middle 60% of the page for the widest contiguous free run
   *      that is >= 10% of pageWidth.
   *   4. If found → 2-column; boundary = centre of the gap.
   *
   * @param {Array} words       - Words with {bbox:{x,y,w,h}} in canonical format
   * @param {number} pageWidth
   * @returns {{ columnCount: number, columnBoundary: number }}
   */
  function detectColumns(words, pageWidth) {
    // Build occupancy histogram
    const occupied = new Uint8Array(pageWidth);
    for (const w of words) {
      const x1 = Math.max(0, w.bbox.x);
      const x2 = Math.min(pageWidth - 1, w.bbox.x + w.bbox.w);
      for (let x = x1; x <= x2; x++) occupied[x] = 1;
    }

    // Search middle 60% for the largest free gap >= 10% wide
    const searchStart = Math.floor(pageWidth * 0.20);
    const searchEnd   = Math.floor(pageWidth * 0.80);
    const minGap      = Math.floor(pageWidth * 0.10);

    let bestGapStart = -1, bestGapLen = 0;
    let curGapStart  = -1, curGapLen  = 0;

    for (let x = searchStart; x <= searchEnd; x++) {
      if (!occupied[x]) {
        if (curGapStart === -1) curGapStart = x;
        curGapLen++;
        if (curGapLen > bestGapLen) {
          bestGapLen  = curGapLen;
          bestGapStart = curGapStart;
        }
      } else {
        curGapStart = -1;
        curGapLen   = 0;
      }
    }

    if (bestGapLen >= minGap) {
      return {
        columnCount:     2,
        columnBoundary:  bestGapStart + Math.floor(bestGapLen / 2)
      };
    }
    return { columnCount: 1, columnBoundary: Math.floor(pageWidth / 2) };
  }

  /**
   * Group words into text lines using y-centre proximity.
   * Words whose y-centres differ by <= 1.5 × medianWordHeight are co-linear.
   *
   * @param {Array}  words           - Words with {bbox:{x,y,w,h}}
   * @param {number} medianWordHeight
   * @returns {Array<Array>} Lines, each an array of word objects (sorted by x)
   */
  function groupWordsIntoLines(words, medianWordHeight) {
    // Sort by y-centre
    const sorted = words.slice().sort((a, b) =>
      (a.bbox.y + a.bbox.h / 2) - (b.bbox.y + b.bbox.h / 2)
    );

    const lines = [];
    const thresh = 1.5 * medianWordHeight;

    for (const word of sorted) {
      const yCenter = word.bbox.y + word.bbox.h / 2;

      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        // Compute rolling mean y-centre of the last line
        let lineYSum = 0;
        for (const w of lastLine) lineYSum += w.bbox.y + w.bbox.h / 2;
        const lineYCenter = lineYSum / lastLine.length;

        if (Math.abs(yCenter - lineYCenter) <= thresh) {
          lastLine.push(word);
          continue;
        }
      }
      lines.push([word]);
    }

    // Sort each line left-to-right
    for (const line of lines) {
      line.sort((a, b) => a.bbox.x - b.bbox.x);
    }

    return lines;
  }

  /**
   * Compute the median line height (max word height per line).
   * @param {Array<Array>} lines
   * @returns {number}
   */
  function computeMedianLineHeight(lines) {
    const heights = lines.map(line => Math.max(...line.map(w => w.bbox.h)));
    return median(heights);
  }

  /**
   * Group consecutive lines into paragraph blocks.
   * A vertical gap > 2.5 × medianLineHeight triggers a new block.
   *
   * @param {Array<Array>} lines
   * @param {number}       medLinH - Median line height
   * @returns {Array<Array<Array>>} Blocks (each = array of lines)
   */
  function groupLinesIntoBlocks(lines, medLinH) {
    if (!lines.length) return [];

    const blocks  = [[lines[0]]];
    const gapThresh = 2.5 * (medLinH || 1);

    for (let i = 1; i < lines.length; i++) {
      const prevLine   = lines[i - 1];
      const curLine    = lines[i];

      // Bottom of previous line
      const prevBottom = Math.max(...prevLine.map(w => w.bbox.y + w.bbox.h));
      // Top of current line
      const curTop     = Math.min(...curLine.map(w => w.bbox.y));

      if (curTop - prevBottom > gapThresh) {
        blocks.push([curLine]);
      } else {
        blocks[blocks.length - 1].push(curLine);
      }
    }

    return blocks;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {

    /**
     * Main entry: detect layout and return sorted canonical blocks.
     *
     * Pipeline:
     *   1. Normalise Tesseract bboxes {x0,y0,x1,y1} → {x,y,w,h}
     *   2. Column detection via horizontal occupancy histogram
     *   3. Word → line grouping (y-proximity, medianWordHeight threshold)
     *   4. Line → block grouping (vertical gap threshold)
     *   5. Column assignment, reading order, type classification
     *   6. Canonical block object construction
     *
     * @param {Array}  words      - Tesseract word objects with bbox {x0,y0,x1,y1}
     * @param {number} pageWidth  - Page image width in pixels
     * @param {number} pageHeight - Page image height in pixels
     * @param {string} [pageNum='1'] - Page number string for block_id generation
     * @returns {{ columnCount: number, columnBoundary: number, blocks: Array }}
     */
    detect(words, pageWidth, pageHeight, pageNum = '1') {

      // -----------------------------------------------------------------------
      // 1. Normalise bboxes; discard degenerate words
      // -----------------------------------------------------------------------
      const normalizedWords = [];
      for (const w of (words || [])) {
        if (!w || !w.bbox) continue;
        const bbox = tessBboxToXYWH(w.bbox);
        if (bbox.w <= 0 || bbox.h <= 0) continue;
        normalizedWords.push({
          text:       (w.text || '').trim(),
          confidence: typeof w.confidence === 'number' ? w.confidence : 0,
          bbox
        });
      }

      if (!normalizedWords.length) {
        return { columnCount: 1, columnBoundary: Math.floor(pageWidth / 2), blocks: [] };
      }

      // -----------------------------------------------------------------------
      // 2. Median word height — used by both line and block groupers
      // -----------------------------------------------------------------------
      const wordHeights        = normalizedWords.map(w => w.bbox.h);
      const medWordHeight      = median(wordHeights);
      const overallMedWordH    = medWordHeight; // kept for heading classification

      // -----------------------------------------------------------------------
      // 3. Column detection
      // -----------------------------------------------------------------------
      const { columnCount, columnBoundary } = detectColumns(normalizedWords, pageWidth);

      // -----------------------------------------------------------------------
      // 4. Group words into lines
      // -----------------------------------------------------------------------
      const lines = groupWordsIntoLines(normalizedWords, medWordHeight);

      // -----------------------------------------------------------------------
      // 5. Group lines into blocks
      // -----------------------------------------------------------------------
      const medLinH   = computeMedianLineHeight(lines);
      const rawBlocks = groupLinesIntoBlocks(lines, medLinH);

      // -----------------------------------------------------------------------
      // 6. Build canonical block objects
      // -----------------------------------------------------------------------
      const blocks = rawBlocks.map((blockLines, bIdx) => {
        // Flatten all words in this block
        const allWords = blockLines.flat();

        // Bounding box = union of all word bboxes in the block
        const bbox = unionBBox(allWords.map(w => w.bbox));

        // Column: compare x-centre of block against columnBoundary
        const blockXCenter = bbox.x + bbox.w / 2;
        const colIdx = (columnCount === 2 && blockXCenter >= columnBoundary) ? 1 : 0;

        // Heading: <= 2 lines AND mean word height > 1.3× overall median
        const blockMeanWordH = allWords.reduce((s, w) => s + w.bbox.h, 0) / (allWords.length || 1);
        const isHeading = blockLines.length <= 2 && blockMeanWordH > 1.3 * overallMedWordH;

        // Build canonical word objects
        const canonicalWords = [];
        blockLines.forEach((line, lIdx) => {
          line.forEach((w, wIdx) => {
            canonicalWords.push({
              word_id:    `w_${lIdx}_${wIdx}`,
              text:       w.text,
              confidence: w.confidence,  // 0–100 (Tesseract native)
              bbox:       w.bbox
            });
          });
        });

        // Raw text = space-joined word texts
        const rawText = canonicalWords.map(w => w.text).join(' ');

        // Block confidence = mean word confidence normalised 0–1
        const avgConf = canonicalWords.length
          ? canonicalWords.reduce((s, w) => s + w.confidence, 0) / canonicalWords.length / 100
          : 0;

        return {
          block_id:      `blk_p${pageNum}_b${bIdx}`,
          reading_order: 0,            // assigned after final sort
          type:          isHeading ? 'heading' : 'paragraph',
          column_index:  colIdx,
          bbox,
          script:        '',           // set by ScriptIDAgent
          is_code_mixed: false,        // set by ScriptIDAgent
          confidence:    Math.round(avgConf * 1000) / 1000,
          needs_review:  false,        // set by CrossValidationAgent / QAAgent
          review_flags:  [],           // set by CrossValidationAgent
          diffs:         [],           // set by CorrectionAgent
          raw_text:      rawText,
          active_text:   rawText,
          words:         canonicalWords
        };
      });

      // -----------------------------------------------------------------------
      // 7. Sort by (column_index ASC, bbox.y ASC); assign reading_order
      // -----------------------------------------------------------------------
      blocks.sort((a, b) => {
        if (a.column_index !== b.column_index) return a.column_index - b.column_index;
        return a.bbox.y - b.bbox.y;
      });

      blocks.forEach((block, idx) => { block.reading_order = idx; });

      return { columnCount, columnBoundary, blocks };
    }

  };

})();
