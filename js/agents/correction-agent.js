'use strict';

/**
 * @file correction-agent.js
 * @description Correction agent for IndicOCR Studio v2.
 *   Analyses block raw_text using a confusion matrix of common OCR errors in
 *   Devanagari / Indic scripts and generates non-destructive diff objects.
 *
 *   CRITICAL: raw_text is NEVER modified. Only block.diffs[] receives the
 *   proposed correction objects.
 *
 *   Pure vanilla JS — no external dependencies.
 *
 * Exposes: window.OCRStudio.CorrectionAgent
 */

window.OCRStudio = window.OCRStudio || {};

/**
 * @namespace window.OCRStudio.CorrectionAgent
 */
window.OCRStudio.CorrectionAgent = (function () {

  // ---------------------------------------------------------------------------
  // Confusion matrix
  // ---------------------------------------------------------------------------

  /**
   * Each rule:
   *   pattern     {RegExp}  — MUST have the 'g' flag for exec() looping
   *   replacement {string}  — corrected string (literal; no capture refs)
   *   reason      {string}  — human-readable explanation shown in the UI
   *   type        {string}  — category tag for analytics
   *
   * Devanagari range lookahead/lookbehind [\u0900-\u097F] restricts numeral
   * and punctuation rules to Devanagari context only.
   */
  const CONFUSION_RULES = [

    // -------------------------------------------------------------------------
    // Ligature misread
    // -------------------------------------------------------------------------
    {
      // रव (ra + va) in word-internal position before another Devanagari char
      // is a well-known misread of ख (kha) — the loop of ख scans as conjunct रव.
      pattern:     /रव(?=[\u0900-\u097F])/g,
      replacement: 'ख',
      reason:      'Ligature confusion: "रव" misread — conjunct glyph shape resembles ख (kha)',
      type:        'ligature_confusion'
    },

    // -------------------------------------------------------------------------
    // Glyph confusions — visually similar Devanagari aksharas
    // -------------------------------------------------------------------------
    {
      // घ (gha U+0918) ↔ ध (dha U+0927): share a similar topbar + body profile
      pattern:     /घ/g,
      replacement: 'ध',
      reason:      'Glyph confusion: "घ" (gha) may be "ध" (dha) — visually similar upper body stroke',
      type:        'glyph_confusion'
    },
    {
      // म (ma U+092E) ↔ भ (bha U+092D): differ only in the left-side arm
      // Context guard: followed by another Devanagari char or matra
      pattern:     /म(?=[\u0900-\u097F\u093E-\u094C])/g,
      replacement: 'भ',
      reason:      'Glyph confusion: "म" (ma) may be "भ" (bha) — similar body; left arm distinguishes them',
      type:        'glyph_confusion'
    },
    {
      // ट (ṭa U+091F) ↔ ठ (ṭha U+0920): differ only in the curved hook at top
      pattern:     /ट/g,
      replacement: 'ठ',
      reason:      'Glyph confusion: "ट" (ṭa) may be "ठ" (ṭha) — similar retroflex glyph; hook differentiates',
      type:        'glyph_confusion'
    },

    // -------------------------------------------------------------------------
    // Numeral confusions — Latin digits embedded in Devanagari text
    // Lookbehind: preceded by Devanagari char; lookahead: followed by same.
    // -------------------------------------------------------------------------
    {
      pattern:     /(?<=[\u0900-\u097F])0(?=[\u0900-\u097F])/g,
      replacement: '०',
      reason:      'Numeral confusion: Latin "0" in Devanagari context → Devanagari "०" (U+0966)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])1(?=[\u0900-\u097F])/g,
      replacement: '१',
      reason:      'Numeral confusion: Latin "1" in Devanagari context → Devanagari "१" (U+0967)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])2(?=[\u0900-\u097F])/g,
      replacement: '२',
      reason:      'Numeral confusion: Latin "2" in Devanagari context → Devanagari "२" (U+0968)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])3(?=[\u0900-\u097F])/g,
      replacement: '३',
      reason:      'Numeral confusion: Latin "3" in Devanagari context → Devanagari "३" (U+0969)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])4(?=[\u0900-\u097F])/g,
      replacement: '४',
      reason:      'Numeral confusion: Latin "4" in Devanagari context → Devanagari "४" (U+096A)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])5(?=[\u0900-\u097F])/g,
      replacement: '५',
      reason:      'Numeral confusion: Latin "5" in Devanagari context → Devanagari "५" (U+096B)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])6(?=[\u0900-\u097F])/g,
      replacement: '६',
      reason:      'Numeral confusion: Latin "6" in Devanagari context → Devanagari "६" (U+096C)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])7(?=[\u0900-\u097F])/g,
      replacement: '७',
      reason:      'Numeral confusion: Latin "7" in Devanagari context → Devanagari "७" (U+096D)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])8(?=[\u0900-\u097F])/g,
      replacement: '८',
      reason:      'Numeral confusion: Latin "8" in Devanagari context → Devanagari "८" (U+096E)',
      type:        'numeral_confusion'
    },
    {
      pattern:     /(?<=[\u0900-\u097F])9(?=[\u0900-\u097F])/g,
      replacement: '९',
      reason:      'Numeral confusion: Latin "9" in Devanagari context → Devanagari "९" (U+096F)',
      type:        'numeral_confusion'
    },

    // -------------------------------------------------------------------------
    // Character confusion — Latin 'l' (lowercase L) misread as Devanagari danda
    // The danda (।  U+0964) is a sentence-ending punctuation mark; 'l' has
    // the same vertical stroke profile when OCR font models mix scripts.
    // Context: 'l' followed by a Devanagari character.
    // -------------------------------------------------------------------------
    {
      pattern:     /l(?=[\u0900-\u097F])/g,
      replacement: '।',
      reason:      'Character confusion: Latin "l" (lowercase L) before Devanagari → likely danda "।" (U+0964)',
      type:        'char_confusion'
    }

  ];

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Reset the lastIndex of all patterns in CONFUSION_RULES to 0.
   * Must be called before scanning each block to avoid stale regex state
   * from a previous call (consequence of the 'g' flag on RegExp objects).
   */
  function resetPatterns() {
    for (const rule of CONFUSION_RULES) {
      rule.pattern.lastIndex = 0;
    }
  }

  /**
   * Safely apply a RegExp pattern (which may use lookbehind) to text and
   * return all match positions + matched strings.
   * Degrades gracefully on engines that don't support lookbehind assertions.
   *
   * @param {RegExp} pattern - Must have the 'g' flag
   * @param {string} text
   * @returns {Array<{index:number, matched:string}>}
   */
  function findAllMatches(pattern, text) {
    const results = [];
    pattern.lastIndex = 0;
    try {
      let m;
      while ((m = pattern.exec(text)) !== null) {
        results.push({ index: m.index, matched: m[0] });
        // Guard: zero-width match would loop forever
        if (m[0].length === 0) pattern.lastIndex++;
      }
    } catch (e) {
      // Lookbehind not supported — skip this rule gracefully
      console.warn('[CorrectionAgent] Regex not supported, skipping rule:', pattern.source, e.message);
    }
    pattern.lastIndex = 0;
    return results;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {

    /**
     * Generate non-destructive diff objects for a single block's raw_text.
     *
     * For every rule in CONFUSION_RULES, all matches in raw_text produce a
     * diff object pushed to block.diffs[]. The raw_text field is NEVER touched.
     *
     * @param {Object} block       - Canonical block object
     * @param {string|number} pageNum     - Page identifier for diff_id generation
     * @param {number} [blockIndex=0]     - Block position index (for diff_id)
     * @returns {Object} Same block with block.diffs[] populated
     */
    processBlock(block, pageNum, blockIndex = 0) {
      if (!block) return block;

      const text = block.raw_text || '';
      if (!text) return block;

      // Ensure diffs array exists
      if (!Array.isArray(block.diffs)) block.diffs = [];

      let diffCounter = 0;

      // Reset all pattern lastIndex values before scanning this block
      resetPatterns();

      for (const rule of CONFUSION_RULES) {
        const matches = findAllMatches(rule.pattern, text);

        for (const match of matches) {
          const original  = match.matched;
          const suggested = rule.replacement;

          // Skip no-op diffs (shouldn't happen but guard defensively)
          if (original === suggested) continue;

          const diffId = `diff_${pageNum}_${blockIndex}_${diffCounter++}`;

          block.diffs.push({
            diff_id:         diffId,
            original,
            suggested,
            reason:          rule.reason,
            status:          'proposed',
            source:          'correction_agent',
            confidence_gain: 0.1,
            timestamp:       new Date().toISOString(),
            // Auxiliary fields (not in spec but useful for UI highlighting)
            char_offset:     match.index,
            rule_type:       rule.type
          });
        }
      }

      return block;
    },

    /**
     * Process all blocks on a page, populating each block's diffs[].
     *
     * @param {Array}         blocks  - Canonical block objects
     * @param {string|number} pageNum - Page identifier for diff_id generation
     * @returns {Array} Same blocks array with diffs[] populated on each block
     */
    processBlocks(blocks, pageNum) {
      if (!Array.isArray(blocks)) return blocks;

      blocks.forEach((block, idx) => {
        this.processBlock(block, pageNum, idx);
      });

      return blocks;
    }

  };

})();
