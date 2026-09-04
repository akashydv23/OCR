'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * @fileoverview GeminiService — Gemini API client for IndicOCR Studio v2.
 *
 * Responsibilities:
 *   - Manage API key + model preferences in localStorage.
 *   - Auto-migrate deprecated model identifiers.
 *   - Proofread OCR text (text-only Gemini request).
 *   - Vision OCR a page canvas image (multimodal Gemini request).
 *   - Grounded document Q&A.
 *   - Rate-limit retry (429 → 1s backoff, one retry).
 *
 * Globals required: none (uses native fetch)
 */

window.OCRStudio.GeminiService = (function () {

  // ─────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────

  var BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}';

  var STORAGE_KEY_API  = 'indicocr_gemini_key';
  var STORAGE_KEY_MODEL = 'indicocr_gemini_model';

  /** Publicly available model list */
  var MODELS = {
    DEFAULT: 'gemini-3.6-flash',
    OPTIONS: [
      'gemini-3.6-flash',
      'gemini-3.6-pro',
      'gemini-3.8-flash',
      'gemini-3.8-pro'
    ]
  };

  /**
   * Map of deprecated model IDs → their replacement.
   * getModel() transparently migrates stored values on read.
   */
  var DEPRECATED_MIGRATIONS = {
    'gemini-2.6-flash': 'gemini-3.6-flash',
    'gemini-2.6-pro':   'gemini-3.6-pro',
    'gemini-2.5-flash': 'gemini-3.6-flash',
    'gemini-2.5-pro':   'gemini-3.6-pro',
    'gemini-2.0-flash': 'gemini-3.6-flash',
    'gemini-2.0-pro':   'gemini-3.6-pro',
    'gemini-1.5-flash': 'gemini-3.6-flash',
    'gemini-1.5-pro':   'gemini-3.6-pro'
  };

  // ─────────────────────────────────────────────
  // API key & model preference helpers
  // ─────────────────────────────────────────────

  /**
   * Read the Gemini API key from localStorage.
   * @returns {string} API key, or empty string if not set.
   */
  function getApiKey() {
    return localStorage.getItem(STORAGE_KEY_API) || '';
  }

  /**
   * Persist the Gemini API key to localStorage.
   * @param {string} key
   */
  function setApiKey(key) {
    localStorage.setItem(STORAGE_KEY_API, key || '');
  }

  /**
   * Read the currently-selected model from localStorage.
   * If the stored value is a deprecated model ID, it is automatically
   * migrated (updated in storage) and the new value is returned.
   *
   * @returns {string} Canonical model ID.
   */
  function getModel() {
    var stored = localStorage.getItem(STORAGE_KEY_MODEL) || MODELS.DEFAULT;

    // Migrate deprecated models or invalid non-existent models
    if (DEPRECATED_MIGRATIONS[stored]) {
      var migrated = DEPRECATED_MIGRATIONS[stored];
      console.info('[GeminiService] Migrating deprecated model "' + stored + '" → "' + migrated + '".');
      localStorage.setItem(STORAGE_KEY_MODEL, migrated);
      return migrated;
    }

    if (MODELS.OPTIONS.indexOf(stored) === -1 && stored.indexOf('gemini-') !== 0) {
      localStorage.setItem(STORAGE_KEY_MODEL, MODELS.DEFAULT);
      return MODELS.DEFAULT;
    }

    return stored;
  }

  /**
   * Persist a model selection to localStorage.
   * @param {string} modelId - Must be one of MODELS.OPTIONS.
   */
  function setModel(modelId) {
    var target = modelId || MODELS.DEFAULT;
    if (DEPRECATED_MIGRATIONS[target]) {
      target = DEPRECATED_MIGRATIONS[target];
    }
    localStorage.setItem(STORAGE_KEY_MODEL, target);
  }

  // ─────────────────────────────────────────────
  // Low-level HTTP helper
  // ─────────────────────────────────────────────

  /**
   * POST a request body to the Gemini generateContent endpoint.
   * Implements a single retry with 1-second backoff on HTTP 429.
   *
   * @param {string} modelId - Gemini model to target.
   * @param {Object} body    - Request payload object (will be JSON-serialised).
   * @returns {Promise<Object>} Parsed JSON response body.
   * @throws {Error} On non-2xx status or network failure.
   */
  async function _post(modelId, body) {
    var key      = getApiKey();
    var endpoint = BASE_URL
      .replace('{model}', encodeURIComponent(modelId))
      .replace('{key}',   encodeURIComponent(key));

    var options = {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    };

    var response = await fetch(endpoint, options);

    // Handle rate limiting with a single retry after 1 s
    if (response.status === 429) {
      console.warn('[GeminiService] Rate limited (429). Retrying in 1s…');
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      response = await fetch(endpoint, options);
    }

    if (!response.ok) {
      var errText = '';
      try {
        var errJson = await response.json();
        if (errJson && errJson.error && errJson.error.message) {
          errText = errJson.error.message;
        } else {
          errText = JSON.stringify(errJson);
        }
      } catch (e) {
        try { errText = await response.text(); } catch (e2) { /* ignore */ }
      }
      throw new Error('[GeminiService] ' + (errText || ('HTTP ' + response.status + ': ' + response.statusText)));
    }

    return response.json();
  }

  // ─────────────────────────────────────────────
  // Public API methods
  // ─────────────────────────────────────────────

  /**
   * Verify that the stored API key and model work by sending a minimal prompt.
   *
   * @returns {Promise<{ok: boolean, model: string, error: string|null}>}
   */
  async function testConnection() {
    var model = getModel();
    try {
      await _post(model, {
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 10 }
      });
      return { ok: true, model: model, error: null };
    } catch (err) {
      var msg = err.message || String(err);
      var userError = msg;
      if (msg.indexOf('HTTP 401') !== -1 || msg.indexOf('HTTP 403') !== -1 || msg.indexOf('API_KEY_INVALID') !== -1) {
        userError = 'Invalid API key';
      }
      return { ok: false, model: model, error: userError };
    }
  }

  /**
   * Proofread a block's raw_text using Gemini and return an array of
   * diff-compatible correction objects.
   *
   * @param {Object} block    - Canonical block object (uses block.raw_text).
   * @param {string} language - Language hint.
   * @returns {Promise<Object[]>} Array of partial diff objects:
   *   { original, suggested, reason, confidence_gain }
   */
  async function proofreadBlock(block, language) {
    var model = getModel();

    var systemPrompt =
      'You are a strict OCR character post-processor for Indic regional languages and English.\n\n' +
      'MANDATORY RULES (DO NOT VIOLATE):\n' +
      '1. NEVER TRANSLATE text from one language to another (e.g. NEVER translate English to Hindi, or Hindi to English).\n' +
      '2. NEVER TRANSLITERATE between scripts (do NOT convert English words to Devanagari, or Devanagari to Latin).\n' +
      '3. ALL CORRECTIONS MUST REMAIN IN THE EXACT SAME LANGUAGE AND SCRIPT AS THE INPUT. Only correct genuine character-level OCR mistakes (such as broken letters, split ligatures, or punctuation errors).\n' +
      '4. If words are already correct in their native language, do not alter them.\n' +
      'Return a JSON object with key "corrections" containing an array of objects: { original, suggested, reason, confidence_gain }. If no genuine OCR errors exist, return { "corrections": [] }.';

    var userMessage = 'Analyze this OCR text. Fix ONLY broken OCR characters in their original language. DO NOT TRANSLATE.\nOCR Text:\n' + (block.active_text || block.raw_text || '');

    var body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature:      0.0,
        maxOutputTokens:  2048,
        responseMimeType: 'application/json'
      }
    };

    try {
      var data     = await _post(model, body);
      var rawText  = data.candidates[0].content.parts[0].text;

      // Strip markdown fences if the model wraps its JSON in them
      rawText = rawText.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

      var parsed = JSON.parse(rawText);
      var corrections = Array.isArray(parsed.corrections) ? parsed.corrections : [];

      // Normalise fields and fill in defaults
      return corrections.map(function (c) {
        return {
          original:        String(c.original  || ''),
          suggested:       String(c.suggested || ''),
          reason:          String(c.reason    || ''),
          confidence_gain: typeof c.confidence_gain === 'number' ? c.confidence_gain : 0.1
        };
      }).filter(function (c) {
        // Discard no-op corrections
        return c.original && c.suggested && c.original !== c.suggested;
      });

    } catch (err) {
      console.error('[GeminiService] proofreadBlock error:', err);
      throw err;
    }
  }

  /**
   * Perform vision-based OCR on a canvas element.
   * Converts the canvas to a base64 JPEG, sends it to Gemini Vision,
   * and returns the extracted text string verbatim in original language.
   *
   * @param {HTMLCanvasElement} canvas   - Source canvas.
   * @param {string}            language - Language hint.
   * @returns {Promise<string>} Extracted text verbatim.
   */
  async function visionOCRPage(canvas, language) {
    var model = getModel();

    // Convert canvas → base64 JPEG (quality 0.85)
    var dataUrl    = canvas.toDataURL('image/jpeg', 0.85);
    var base64Data = dataUrl.split(',')[1];

    var systemPrompt =
      'You are a high-precision, verbatim Optical Character Recognition (OCR) engine for Indian regional languages and English documents.\n\n' +
      'ABSOLUTE CRITICAL RULES (NON-NEGOTIABLE):\n' +
      '1. NEVER TRANSLATE: Transcribe every single word in its EXACT ORIGINAL LANGUAGE. If the text in the image is English, transcribe it in English. If it is in Hindi (Devanagari), transcribe it in Hindi (Devanagari). If it is in Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Sanskrit, or Urdu, transcribe it in that exact language and native script.\n' +
      '2. NEVER TRANSLITERATE: Do not convert English words into Devanagari letters, and do not convert Indian scripts into Latin letters.\n' +
      '3. DO NOT ALTER OR SUBSTITUTE WORDS: Transcribe exact character sequences, numbers, punctuation, symbols, and casing as seen in the image.\n' +
      '4. PRESERVE DOCUMENT STRUCTURE: Keep headings, bullet points, numbered lists, tables, code, and line breaks intact. Separate distinct paragraphs with a double newline (\\n\\n).\n' +
      '5. Output ONLY the extracted text verbatim. Never include conversational filler, meta-comments, or code blocks.';

    var body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data:      base64Data
            }
          },
          {
            text: 'Transcribe all text from this image VERBATIM in its original language and script. DO NOT TRANSLATE. DO NOT TRANSLITERATE. Keep original layout, paragraphs, and line breaks.'
          }
        ]
      }],
      generationConfig: {
        temperature:     0.0,
        maxOutputTokens: 8192
      }
    };

    try {
      var data = await _post(model, body);
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts[0]) {
        throw new Error('Gemini Vision returned no text content.');
      }
      return data.candidates[0].content.parts[0].text || '';
    } catch (err) {
      console.error('[GeminiService] visionOCRPage error:', err);
      throw err;
    }
  }

  /**
   * Fast language & script auto-detection from an image canvas.
   * Runs in ~300ms using gemini-3.6-flash with maxOutputTokens: 120.
   *
   * @param {HTMLCanvasElement} canvas - Source canvas (e.g. page 1)
   * @returns {Promise<{ languageCode: string, displayName: string, script: string }|null>}
   */
  async function detectLanguage(canvas) {
    var model = getModel();
    var key = getApiKey();
    if (!key) return null;

    var dataUrl    = canvas.toDataURL('image/jpeg', 0.70);
    var base64Data = dataUrl.split(',')[1];

    var systemPrompt =
      'You are a multilingual document language detector. ' +
      'Analyze the text in this image and detect its primary language and script. ' +
      'Respond ONLY with a valid JSON object in this exact schema:\n' +
      '{\n' +
      '  "languageCode": "eng" | "hin+eng" | "mar+eng" | "ben+eng" | "tam+eng" | "tel+eng" | "kan+eng" | "mal+eng" | "guj+eng" | "pan+eng" | "ori+eng" | "urd+eng" | "san",\n' +
      '  "displayName": "English" | "Hindi + English" | "Marathi" | "Tamil" | "Bengali" | "Gujarati" | "Telugu" | "Kannada" | "Malayalam" | "Punjabi" | "Odia" | "Urdu" | "Sanskrit",\n' +
      '  "script": "Latin" | "Devanagari" | "Bengali" | "Tamil" | "Telugu" | "Gujarati" | "Kannada" | "Malayalam" | "Gurmukhi" | "Odia" | "Arabic"\n' +
      '}';

    var body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64Data } },
          { text: 'Detect document language and script. Return JSON only.' }
        ]
      }],
      generationConfig: {
        temperature:      0.0,
        maxOutputTokens:  120,
        responseMimeType: 'application/json'
      }
    };

    try {
      var data = await _post(model, body);
      var rawText = data.candidates[0].content.parts[0].text.trim();
      rawText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      return JSON.parse(rawText);
    } catch (err) {
      console.warn('[GeminiService] detectLanguage error:', err);
      return null;
    }
  }

  /**
   * Answer a user question grounded in the document's OCR text.
   * Returns only answers that can be supported by the provided page text.
   *
   * @param {string}   question   - Natural-language question.
   * @param {Object[]} pagesText  - Array of { pageNum: number, text: string }.
   * @param {string}   language   - Primary document language hint.
   * @returns {Promise<string>} Model answer, or empty string on error.
   */
  async function queryDocument(question, pagesText, language) {
    var model = getModel();

    // Build a compact context block with page citations
    var contextLines = (pagesText || []).map(function (p) {
      return '=== Page ' + p.pageNum + ' ===\n' + (p.text || '').trim();
    });
    var context = contextLines.join('\n\n');

    var systemPrompt =
      'You are a document analysis assistant. ' +
      'Answer questions ONLY using the provided document text. ' +
      'Cite the page number(s) that support your answer using the format [Page N]. ' +
      'If the answer cannot be found in the document, say so explicitly. ' +
      'Do not hallucinate or use external knowledge. ' +
      'Primary document language: ' + (language || 'auto') + '.';

    var userMessage =
      'DOCUMENT TEXT:\n' + context +
      '\n\n---\nQUESTION: ' + question;

    var body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature:     0.3,
        maxOutputTokens: 2048
      }
    };

    try {
      var data = await _post(model, body);
      return data.candidates[0].content.parts[0].text || '';
    } catch (err) {
      console.error('[GeminiService] queryDocument error:', err);
      return '';
    }
  }

  // ─────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────

  return {
    MODELS:               MODELS,
    DEPRECATED_MIGRATIONS: DEPRECATED_MIGRATIONS,

    getApiKey:      getApiKey,
    setApiKey:      setApiKey,
    getModel:       getModel,
    setModel:       setModel,

    testConnection: testConnection,
    proofreadBlock: proofreadBlock,
    visionOCRPage:  visionOCRPage,
    detectLanguage: detectLanguage,
    queryDocument:  queryDocument,

    // Exposed for testing / advanced use
    _post: _post
  };

}());
