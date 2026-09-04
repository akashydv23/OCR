'use strict';

/**
 * @file cross-validation-agent.js
 * @description Orthographic cross-validation agent for IndicOCR Studio v2.
 *   Validates Devanagari text against Unicode and linguistic rules to detect
 *   common OCR errors. Flags are attached to block objects; source text is
 *   never modified.
 *   Pure vanilla JS — no external dependencies.
 *
 * Exposes: window.OCRStudio.CrossValidationAgent
 */

window.OCRStudio = window.OCRStudio || {};

/**
 * @namespace window.OCRStudio.CrossValidationAgent
 */
window.OCRStudio.CrossValidationAgent = (function () {

  // ---------------------------------------------------------------------------
  // Devanagari Unicode constants & patterns
  // ---------------------------------------------------------------------------

  /**
   * Dependent vowel signs (matras) — must follow a consonant base.
   * U+093E (ā) … U+094C (au), U+094E (ॎ), U+094F (ॏ)
   */
  const MATRA_CLASS        = '[\\u093E-\\u094C\\u094E\\u094F]';
  const ORPHAN_WORD_START  = new RegExp('^' + MATRA_CLASS);
  const ORPHAN_AFTER_SPACE = new RegExp('\\s' + MATRA_CLASS, 'g');

  /**
   * Two consecutive Virama/Halant (U+094D) — always invalid.
   */
  const DOUBLE_VIRAMA_RE   = /\u094D\u094D/g;

  /**
   * Nukta (U+093C) — only valid after these specific base consonants
   * (per Unicode normative data for Devanagari extended phonemes):
   *   क (0915) ख (0916) ग (0917) ज (091C) ड (0921) ढ (0922) फ (092B)
   */
  const VALID_NUKTA_BASES  = new Set([0x0915, 0x0916, 0x0917, 0x091C, 0x0921, 0x0922, 0x092B]);
  const NUKTA_CP           = 0x093C;

  /**
   * Devanagari consonant range for shirorekha fragment detection.
   * U+0915 (क) … U+0939 (ह) plus nukta-modified consonants U+0958–U+095F.
   */
  const CONSONANT_RE       = /^[\u0915-\u0939\u0958-\u095F]$/;

  /**
   * Devanagari independent vowels — single-char tokens of these are valid
   * standalone and should NOT be flagged as shirorekha fragments.
   * U+0905 (अ) … U+0914 (औ)
   */
  const VOWEL_RE           = /^[\u0905-\u0914]$/;

  // ---------------------------------------------------------------------------
  // Internal rule implementations
  // ---------------------------------------------------------------------------

  /**
   * Rule 1 — Orphaned Matra.
   * Detects matras appearing:
   *   (a) At position 0 of any whitespace-delimited word token.
   *   (b) Immediately after a whitespace character in running text.
   *
   * @param {string} text
   * @returns {Array<{type, description, charOffset}>}
   */
  function detectOrphanedMatras(text) {
    const flags = [];

    // (a) Matra at word-start — split keeping delimiters to track offsets
    let offset = 0;
    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      if (part.length && !/^\s+$/.test(part)) {
        if (ORPHAN_WORD_START.test(part)) {
          flags.push({
            type:        'orphaned_matra',
            description: `Dependent vowel sign (matra) at word start with no consonant base: "${part[0]}" at offset ${offset}`,
            charOffset:  offset
          });
        }
      }
      offset += part.length;
    }

    // (b) Matra immediately after whitespace (inter-word orphan)
    ORPHAN_AFTER_SPACE.lastIndex = 0;
    let match;
    while ((match = ORPHAN_AFTER_SPACE.exec(text)) !== null) {
      const matraOffset = match.index + 1; // skip the space; matra is at +1
      const alreadyFlagged = flags.some(f => f.charOffset === matraOffset);
      if (!alreadyFlagged) {
        flags.push({
          type:        'orphaned_matra',
          description: `Dependent vowel sign (matra) after whitespace with no consonant base: "${text[matraOffset]}"`,
          charOffset:  matraOffset
        });
      }
    }

    return flags;
  }

  /**
   * Rule 2 — Double Virama.
   * U+094D U+094D is never valid in any Devanagari conjunct sequence.
   *
   * @param {string} text
   * @returns {Array<{type, description, charOffset}>}
   */
  function detectDoubleVirama(text) {
    const flags = [];
    DOUBLE_VIRAMA_RE.lastIndex = 0;
    let match;
    while ((match = DOUBLE_VIRAMA_RE.exec(text)) !== null) {
      flags.push({
        type:        'double_virama',
        description: 'Two consecutive Virama/Halant characters (U+094D U+094D) — invalid conjunct',
        charOffset:  match.index
      });
    }
    return flags;
  }

  /**
   * Rule 3 — Invalid Nukta Placement.
   * Nukta (U+093C) must follow one of the seven canonical base consonants.
   *
   * @param {string} text
   * @returns {Array<{type, description, charOffset}>}
   */
  function detectInvalidNukta(text) {
    const flags = [];
    for (let i = 1; i < text.length; i++) {
      const cp = text.codePointAt(i);
      if (cp === NUKTA_CP) {
        const prevCp = text.codePointAt(i - 1);
        if (!VALID_NUKTA_BASES.has(prevCp)) {
          flags.push({
            type:        'invalid_nukta',
            description: `Nukta (U+093C) after invalid base U+${prevCp.toString(16).toUpperCase().padStart(4,'0')} "${text[i-1]}"`,
            charOffset:  i
          });
        }
      }
    }
    return flags;
  }

  /**
   * Rule 4 — Severed Shirorekha.
   * A single Devanagari consonant appearing as a standalone whitespace-delimited
   * token (no matras or other modifiers) is likely a shirorekha fragment caused
   * by over-segmentation during binarization.
   *
   * @param {string} text
   * @returns {Array<{type, description, charOffset}>}
   */
  function detectSeveredShirorekha(text) {
    const flags  = [];
    let   offset = 0;
    const parts  = text.split(/(\s+)/);

    for (const part of parts) {
      if (part.length && !/^\s+$/.test(part)) {
        // Single-char token that is a consonant but not an independent vowel
        if (part.length === 1 && CONSONANT_RE.test(part) && !VOWEL_RE.test(part)) {
          flags.push({
            type:        'severed_shirorekha',
            description: `Isolated Devanagari consonant "${part}" — possible shirorekha fragment from over-segmentation`,
            charOffset:  offset
          });
        }
      }
      offset += part.length;
    }

    return flags;
  }

  /**
   * Determine whether a block warrants validation.
   * Latin-only and Common blocks are skipped.
   *
   * @param {Object} block
   * @returns {boolean}
   */
  function shouldValidate(block) {
    const s = (block.script || '').toLowerCase();
    return s !== 'latin' && s !== 'common';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {

    /**
     * Validate a single block's text against Indic orthographic rules.
     *
     * Rules applied for Devanagari (and unknown-script) blocks:
     *   1. Orphaned Matra        — matra without a preceding consonant base
     *   2. Double Virama         — U+094D U+094D sequence
     *   3. Invalid Nukta         — nukta after non-canonical consonant
     *   4. Severed Shirorekha   — isolated single consonant token
     *
     * Blocks with script 'Latin' or 'Common' are skipped (return isValid=true).
     *
     * @param {Object} block - Canonical block object
     * @returns {{ isValid: boolean, flags: Array<{type:string, description:string, charOffset:number}> }}
     */
    validateBlock(block) {
      if (!shouldValidate(block)) {
        return { isValid: true, flags: [] };
      }

      const text = (block.active_text || block.raw_text || '').trim();
      if (!text) return { isValid: true, flags: [] };

      const flags = [
        ...detectOrphanedMatras(text),
        ...detectDoubleVirama(text),
        ...detectInvalidNukta(text),
        ...detectSeveredShirorekha(text)
      ];

      return { isValid: flags.length === 0, flags };
    },

    /**
     * Run validation on all blocks, setting `needs_review` and `review_flags`.
     * A block with at least one flag is marked `needs_review = true`.
     * Mutates blocks in place; returns the array for chaining.
     *
     * @param {Array} blocks - Canonical block objects
     * @returns {Array} Same blocks with needs_review/review_flags populated
     */
    tagBlocks(blocks) {
      if (!Array.isArray(blocks)) return blocks;

      for (const block of blocks) {
        const result       = this.validateBlock(block);
        block.review_flags = result.flags;
        block.needs_review = !result.isValid;
      }

      return blocks;
    }

  };

})();
