'use strict';

/**
 * @file script-id-agent.js
 * @description Script identification agent for IndicOCR Studio v2.
 *   Classifies the Unicode script of a text string by counting characters in
 *   defined Unicode ranges. Detects code-mixed blocks (Indic + Latin).
 *   Pure vanilla JS — no external dependencies.
 *
 * Exposes: window.OCRStudio.ScriptIDAgent
 */

window.OCRStudio = window.OCRStudio || {};

/**
 * @namespace window.OCRStudio.ScriptIDAgent
 */
window.OCRStudio.ScriptIDAgent = (function () {

  // ---------------------------------------------------------------------------
  // Unicode range table for supported scripts
  // ---------------------------------------------------------------------------

  /**
   * Each entry: { name: string, lo: number, hi: number }
   * Inclusive codepoint bounds (hex).
   * Latin is split into A–Z and a–z; the gap (0x5B–0x60) is handled in
   * classifyCodepoint().
   */
  const SCRIPT_RANGES = [
    { name: 'Devanagari', lo: 0x0900, hi: 0x097F },
    { name: 'Bengali',    lo: 0x0980, hi: 0x09FF },
    { name: 'Gurmukhi',   lo: 0x0A00, hi: 0x0A7F },
    { name: 'Gujarati',   lo: 0x0A80, hi: 0x0AFF },
    { name: 'Odia',       lo: 0x0B00, hi: 0x0B7F },
    { name: 'Tamil',      lo: 0x0B80, hi: 0x0BFF },
    { name: 'Telugu',     lo: 0x0C00, hi: 0x0C7F },
    { name: 'Kannada',    lo: 0x0C80, hi: 0x0CFF },
    { name: 'Malayalam',  lo: 0x0D00, hi: 0x0D7F },
    { name: 'Arabic',     lo: 0x0600, hi: 0x06FF },
    // Latin: covers both A-Z (0x41-0x5A) and a-z (0x61-0x7A)
    { name: 'Latin',      lo: 0x0041, hi: 0x007A }
  ];

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Return true for characters that should be excluded from script counting:
   * whitespace, ASCII digits, common punctuation, Devanagari digits/danda.
   *
   * @param {number} cp - Unicode codepoint
   * @returns {boolean}
   */
  function isIgnored(cp) {
    if (cp <= 0x0020) return true;                        // Whitespace / control
    if (cp >= 0x0030 && cp <= 0x0039) return true;        // ASCII digits 0-9
    if (cp >= 0x0021 && cp <= 0x0040) return true;        // ASCII punctuation/symbols
    if (cp >= 0x005B && cp <= 0x0060) return true;        // [ \ ] ^ _ `
    if (cp >= 0x007B && cp <= 0x007E) return true;        // { | } ~
    if (cp >= 0x0966 && cp <= 0x096F) return true;        // Devanagari digits ०-९
    if (cp === 0x0964 || cp === 0x0965) return true;      // danda, double danda
    return false;
  }

  /**
   * Map a single codepoint to a script name, or null if unrecognised.
   * For Latin, only A-Z and a-z are accepted (the gap 0x5B-0x60 is excluded).
   *
   * @param {number} cp
   * @returns {string|null}
   */
  function classifyCodepoint(cp) {
    for (const r of SCRIPT_RANGES) {
      if (cp >= r.lo && cp <= r.hi) {
        if (r.name === 'Latin') {
          // Only count actual letters — exclude the symbol gap
          return ((cp >= 0x0041 && cp <= 0x005A) || (cp >= 0x0061 && cp <= 0x007A))
            ? 'Latin' : null;
        }
        return r.name;
      }
    }
    return null; // Unrecognised / Common
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {

    /**
     * Classify the dominant Unicode script of a text string.
     *
     * Steps:
     *   1. Iterate over every character; skip ignored characters.
     *   2. Map each codepoint to a script name.
     *   3. dominantScript = script with the highest character count.
     *   4. scriptRatio    = dominantCount / totalClassifiable.
     *   5. is_code_mixed  = true when any secondary script covers > 10%
     *      of total classifiable chars AND that secondary script is Latin.
     *   6. If totalClassifiable === 0 → 'Common' (only digits/punctuation).
     *
     * @param {string} text
     * @returns {{ script: string, is_code_mixed: boolean, scriptRatio: number }}
     */
    classifyText(text) {
      if (!text || typeof text !== 'string') {
        return { script: 'Common', is_code_mixed: false, scriptRatio: 0 };
      }

      const counts = {};
      let total = 0;

      for (let i = 0; i < text.length; i++) {
        const cp = text.codePointAt(i);
        // Skip second code unit of a surrogate pair (outside BMP)
        if (cp > 0xFFFF) i++;

        if (isIgnored(cp)) continue;

        const scriptName = classifyCodepoint(cp);
        if (!scriptName) continue; // unrecognised — neutral, don't count

        total++;
        counts[scriptName] = (counts[scriptName] || 0) + 1;
      }

      // All characters were digits/punctuation/ignored → Common script
      if (total === 0) {
        return { script: 'Common', is_code_mixed: false, scriptRatio: 0 };
      }

      // Find dominant script (highest count)
      let dominantScript = null;
      let dominantCount  = 0;
      for (const [name, count] of Object.entries(counts)) {
        if (count > dominantCount) {
          dominantCount  = count;
          dominantScript = name;
        }
      }

      const scriptRatio = dominantCount / total;

      // Code-mixing: secondary script > 10% AND it is Latin
      let is_code_mixed = false;
      for (const [name, count] of Object.entries(counts)) {
        if (name === dominantScript) continue;
        if ((count / total) > 0.10 && name === 'Latin') {
          is_code_mixed = true;
          break;
        }
      }

      return {
        script:        dominantScript || 'Common',
        is_code_mixed,
        scriptRatio:   Math.round(scriptRatio * 1000) / 1000
      };
    },

    /**
     * Tag all blocks in an array with `script` and `is_code_mixed` fields.
     * Classification uses `active_text` (falls back to `raw_text`).
     * Mutates blocks in place; also returns the array for chaining.
     *
     * @param {Array} blocks - Canonical block objects
     * @returns {Array} Same blocks array with script/is_code_mixed set
     */
    tagBlocks(blocks) {
      if (!Array.isArray(blocks)) return blocks;

      for (const block of blocks) {
        const text   = (block.active_text || block.raw_text || '').trim();
        const result = this.classifyText(text);
        block.script        = result.script;
        block.is_code_mixed = result.is_code_mixed;
        // Store for downstream agents (e.g. QAAgent plausibility weighting)
        block._scriptRatio  = result.scriptRatio;
      }

      return blocks;
    }

  };

})();
