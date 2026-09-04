'use strict';

/**
 * @file qa-agent.js
 * @description Quality assurance agent for IndicOCR Studio v2.
 *   Calibrates per-block confidence using a three-factor weighted formula,
 *   estimates page-level Word Error Rate, and tags pages / blocks for human
 *   review when quality thresholds are not met.
 *   Pure vanilla JS — no external dependencies.
 *
 * Exposes: window.OCRStudio.QAAgent
 */

window.OCRStudio = window.OCRStudio || {};

/**
 * @namespace window.OCRStudio.QAAgent
 */
window.OCRStudio.QAAgent = (function () {

  // ---------------------------------------------------------------------------
  // Configuration constants
  // ---------------------------------------------------------------------------

  /** Weights for the three-factor calibration formula. Must sum to 1.0. */
  const W_OCR_CONF     = 0.5;  // Raw OCR engine confidence
  const W_DICT_PLAUS   = 0.3;  // Dictionary / word plausibility heuristic
  const W_ORTHOGRAPHIC = 0.2;  // Orthographic validity (cross-validator flags)

  /** Page confidence below this triggers needs_review = true. */
  const PAGE_REVIEW_THRESHOLD = 0.75;

  /** Word confidence below this counts as a "likely error" for WER estimation. */
  const WORD_LOW_CONF_THRESHOLD = 0.5;

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalise a raw confidence value to the [0, 1] range.
   * Tesseract returns 0–100; layout-agent already normalises to 0–1, but we
   * guard defensively against either format.
   *
   * @param {number} conf
   * @returns {number} Clamped value in [0.0, 1.0]
   */
  function normalise(conf) {
    if (typeof conf !== 'number' || isNaN(conf)) return 0;
    // Values > 1.0 are assumed to be in the 0–100 range
    const v = conf > 1.0 ? conf / 100 : conf;
    return Math.max(0, Math.min(1.0, v));
  }

  /**
   * Compute dictionary plausibility for a block.
   *
   * Heuristic: ratio of word tokens whose text length > 1 character.
   * Single-character tokens are more likely OCR noise or fragmented glyphs.
   * An additional penalty is applied for each orphaned_matra flag (−0.05 each),
   * since unattached matras strongly indicate a word-segmentation error.
   *
   * @param {Object} block - Canonical block object
   * @returns {number} Plausibility score in [0.0, 1.0]
   */
  function dictPlausibility(block) {
    const words = block.words || [];
    if (!words.length) return 0.5; // No evidence → neutral

    const longWords = words.filter(w => w.text && w.text.length > 1).length;
    let score = longWords / words.length;

    // Penalise for each orphaned matra flag (capped at total score)
    const orphanCount = (block.review_flags || []).filter(f => f.type === 'orphaned_matra').length;
    score = Math.max(0, score - orphanCount * 0.05);

    return Math.min(1.0, score);
  }

  /**
   * Compute orthographic validity score from cross-validator flags.
   *
   * Score ladder:
   *   1.0 — zero flags (clean block)
   *   0.6 — flags present but needs_review not set (edge case, safe fallback)
   *   0.3 — needs_review=true with non-critical flags (orphan matra, shirorekha)
   *   0.0 — contains double_virama (severe structural Unicode error)
   *
   * @param {Object} block - Canonical block object
   * @returns {number} Validity score in [0.0, 1.0]
   */
  function orthographicValidity(block) {
    const flags    = block.review_flags || [];
    if (!flags.length) return 1.0;

    // Severe: double virama present → structural breakdown
    const hasDoubleVirama = flags.some(f => f.type === 'double_virama');
    if (hasDoubleVirama) return 0.0;

    // Needs review with other flags
    if (block.needs_review) return 0.3;

    // Has flags but needs_review somehow false (edge case)
    return 0.6;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {

    /**
     * Calibrate confidence for a single block using multi-factor scoring.
     *
     * Formula:
     *   calibrated = 0.5 × ocrConf + 0.3 × dictPlausibility + 0.2 × orthographicValidity
     *
     * All three factors are independently computed in [0, 1] and combined
     * with fixed weights. Result is clamped to [0.0, 1.0].
     *
     * @param {Object} block - Canonical block object (review_flags must be set)
     * @returns {number} Calibrated confidence in [0.0, 1.0]
     */
    calibrateBlockConfidence(block) {
      if (!block) return 0;

      const ocrConf    = normalise(block.confidence);
      const dictScore  = dictPlausibility(block);
      const orthoScore = orthographicValidity(block);

      const calibrated = W_OCR_CONF     * ocrConf
                       + W_DICT_PLAUS   * dictScore
                       + W_ORTHOGRAPHIC * orthoScore;

      // Round to 4 dp for clean display; clamp to valid range
      return Math.round(Math.max(0, Math.min(1.0, calibrated)) * 10000) / 10000;
    },

    /**
     * Estimate Word Error Rate (WER) heuristic for an array of blocks.
     *
     * WER heuristic = count(words with normalised confidence < 0.5) / count(all words).
     *
     * This is a heuristic, not a true WER (which requires a reference transcript).
     * It flags structurally uncertain words detected by the OCR engine itself.
     *
     * @param {Array} blocks - Canonical block objects
     * @returns {number} Estimated WER in [0.0, 1.0]
     */
    estimateWER(blocks) {
      if (!Array.isArray(blocks) || !blocks.length) return 0;

      let total   = 0;
      let lowConf = 0;

      for (const block of blocks) {
        for (const word of (block.words || [])) {
          total++;
          if (normalise(word.confidence) < WORD_LOW_CONF_THRESHOLD) lowConf++;
        }
      }

      if (total === 0) return 0;
      return Math.round((lowConf / total) * 10000) / 10000;
    },

    /**
     * Score and tag an entire page object.
     *
     * Steps:
     *   1. Calibrate confidence for every block; overwrite block.confidence.
     *   2. Compute page confidence = word-count-weighted mean of block confidences.
     *      (Weighting by word count ensures content-rich blocks drive the score.)
     *   3. Compute estimated WER and store as page.estimated_wer.
     *   4. page.needs_review = true if:
     *        — page confidence < PAGE_REVIEW_THRESHOLD (0.75), OR
     *        — any block has needs_review = true.
     *
     * @param {Object} pageObj - Canonical page object with a `blocks` array
     * @returns {Object} Same pageObj with confidence, needs_review, estimated_wer set
     */
    scorePage(pageObj) {
      if (!pageObj) return pageObj;

      const blocks = pageObj.blocks || [];

      // Step 1 — Calibrate each block's confidence in place
      for (const block of blocks) {
        block.confidence = this.calibrateBlockConfidence(block);
      }

      // Step 2 — Page confidence: weighted mean by word count
      let weightedSum  = 0;
      let totalWeight  = 0;
      let anyBlockNeedsReview = false;

      for (const block of blocks) {
        // Use at least weight 1 to avoid dividing by 0 for empty blocks
        const wc = (block.words || []).length || 1;
        weightedSum += block.confidence * wc;
        totalWeight += wc;
        if (block.needs_review) anyBlockNeedsReview = true;
      }

      const pageConf = totalWeight > 0
        ? Math.round((weightedSum / totalWeight) * 10000) / 10000
        : 0;

      // Step 3 — WER estimate
      const estimatedWER = this.estimateWER(blocks);

      // Step 4 — Page review flag
      const pageNeedsReview = anyBlockNeedsReview || pageConf < PAGE_REVIEW_THRESHOLD;

      // Write back to page object
      pageObj.confidence    = pageConf;
      pageObj.needs_review  = pageNeedsReview;
      pageObj.estimated_wer = estimatedWER;

      return pageObj;
    }

  };

})();
