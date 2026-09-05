'use strict';

/**
 * app.js — Main Application Controller
 *
 * Wires together all modules, handles all user interactions:
 *  - Drag-and-drop file ingestion
 *  - Pre-flight analysis and display
 *  - Session management (new / resume)
 *  - Starting and controlling the OCR pipeline
 *  - Navigating pages in Review Studio
 *  - Export actions
 *  - Settings panel (Gemini BYOK)
 *
 * This file assumes all other OCRStudio.* modules are already loaded
 * via <script> tags earlier in index.html.
 *
 * Depends on: All window.OCRStudio.* modules + pdfjsLib (ESM global)
 */

window.OCRStudio = window.OCRStudio || {};

(async () => {

  // ─── App State ───────────────────────────────────────────────────────────

  const state = {
    sessionId: null,
    canonicalDoc: null,
    streamer: null,
    coordinator: null,
    currentPageNum: 1,
    totalPages: 0,
    isProcessing: false,
    selectedLanguage: 'hin+eng',
    currentFile: null,
  };

  // ─── DOM References ───────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const icon = (name, cls, size) => (window.OCRStudio && window.OCRStudio.Icons ? window.OCRStudio.Icons.get(name, cls, size) : '');
  const uploadZone = $('upload-zone');
  const reviewStudio = $('review-studio');
  const dropArea = $('drop-area');
  const fileInput = $('file-input');
  const preflightPanel = $('preflight-panel');
  const preflightResults = $('preflight-results');
  const languageSelect = $('language-select');
  const btnStartOCR = $('btn-start-ocr');
  const btnCancelPreflight = $('btn-cancel-preflight');
  const btnSelectFile = $('btn-select-file');
  const btnSettings = $('btn-settings');
  const btnGuide = $('btn-guide');
  const settingsModal = $('settings-modal');
  const geminiKeyInput = $('gemini-api-key');
  const geminiModelSelect = $('gemini-model-select');
  const geminiCustomModel = $('gemini-custom-model');
  const btnTestGemini = $('btn-test-gemini');
  const geminiStatus = $('gemini-status');
  const btnSaveSettings = $('btn-save-settings');
  const btnPrevPage = $('btn-prev-page');
  const btnNextPage = $('btn-next-page');
  const pageIndicator = $('page-indicator');
  const btnExportPDF = $('btn-export-pdf');
  const btnExportDOCX = $('btn-export-docx');
  const btnExportTXT = $('btn-export-txt');
  const btnExportJSON = $('btn-export-json');
  const btnExportMenu = $('btn-export-menu');
  const exportDropdownMenu = $('export-dropdown-menu');
  const btnOpenDiffs = $('btn-open-diffs');
  const btnGeminiProofread = $('btn-gemini-proofread');
  const btnGeminiVision = $('btn-gemini-vision');
  const btnHandTool = $('btn-hand-tool');
  const btnFitPage = $('btn-fit-page');
  const btnZoomIn = $('btn-zoom-in');
  const btnZoomOut = $('btn-zoom-out');
  const btnHome = $('btn-home');
  const btnNavBack = $('btn-nav-back');
  const btnNavSamples = $('btn-nav-samples');
  const navSamplesPopup = $('nav-samples-popup');
  const langAutoBadge = $('lang-auto-badge');
  const autoProceedBar = $('auto-proceed-bar');
  const autoProceedFill = $('auto-proceed-fill');
  const autoProceedLabel = $('auto-proceed-label');

  let _currentView = 'landing'; // 'landing' | 'upload' | 'preflight' | 'review'

  // ─── Initialization ───────────────────────────────────────────────────────

  async function init() {
    // Initialize DB
    await window.OCRStudio.DB.init();

    // Initialize PWA service worker
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js?v=20.0');
        if (reg) reg.update();
        console.log('[App] Service worker registered and updated');
      } catch (e) {
        console.warn('[App] Service worker registration failed:', e);
      }
    }

    // Initialize UI components
    window.OCRStudio.JobProgress.init();
    window.OCRStudio.UserGuideModal.init();

    // Load saved Gemini settings & update AI status badge
    loadGeminiSettings();
    updateNavAIStatus();

    // Wire landing page CTA buttons
    wireLandingCTAs();

    // Check URL hash or default to landing page
    const initialHash = window.location.hash.replace('#', '');
    if (initialHash === 'upload') {
      showUploadZone(false);
      history.replaceState({ view: 'upload' }, '', '#upload');
    } else {
      showLanding(false);
      history.replaceState({ view: 'landing' }, '', window.location.pathname);
    }

    // Check for resumable sessions (only relevant when going straight to app)
    await checkForResumableSessions();

    // Wire events
    wireEvents();

    console.log('[App] OCR Studio initialized');
  }

  // ─── Session Management ───────────────────────────────────────────────────

  async function checkForResumableSessions() {
    const sessions = await window.OCRStudio.DB.getAllSessions();
    // Auto-complete any sessions where all pages were already processed
    for (const s of sessions) {
      if ((s.status === 'processing' || s.status === 'paused') && (s.processedPages || 0) >= (s.totalPages || 1)) {
        await window.OCRStudio.DB.updateSessionStatus(s.sessionId, 'complete', s.totalPages);
        s.status = 'complete';
      }
    }

    // Only prompt for sessions that truly have unfinished remaining pages
    const inProgress = sessions.filter(s =>
      (s.status === 'processing' || s.status === 'paused') &&
      (s.processedPages || 0) < (s.totalPages || 1)
    );

    if (inProgress.length > 0) {
      const latest = inProgress.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      showResumePrompt(latest);
    }
  }

  function showResumePrompt(session) {
    const navCenter = document.getElementById('nav-center');
    if (!navCenter) return;
    navCenter.innerHTML = '';

    const banner = document.createElement('div');
    banner.className = 'resume-banner';
    banner.innerHTML = `
      <span class="resume-banner-text">${icon('file-text', 'ui-icon-xs')} Unfinished: <strong>${session.title}</strong> (${session.processedPages || 0}/${session.totalPages} pages)</span>
      <div class="resume-banner-actions">
        <button class="btn-resume-session" data-session-id="${session.sessionId}">Resume</button>
        <button class="btn-discard-session" data-session-id="${session.sessionId}">Discard</button>
      </div>
    `;

    navCenter.appendChild(banner);

    banner.querySelector('.btn-resume-session').addEventListener('click', () => {
      resumeSession(session.sessionId);
      navCenter.innerHTML = '';
    });

    banner.querySelector('.btn-discard-session').addEventListener('click', async () => {
      await window.OCRStudio.DB.deleteSession(session.sessionId);
      navCenter.innerHTML = '';
    });
  }

  async function resumeSession(sessionId) {
    const doc = await window.OCRStudio.DB.getDoc(sessionId);
    if (!doc) {
      alert('Session data not found. Please start a new session.');
      return;
    }

    state.sessionId = sessionId;
    state.canonicalDoc = doc;
    state.totalPages = doc.metadata.total_pages;
    state.currentPageNum = doc.metadata.processed_pages || 1;
    state.selectedLanguage = doc.metadata.languages.join('+');

    // Switch to Review Studio
    showReviewStudio();
    await window.OCRStudio.ReviewStudio.init(doc, sessionId);
    await window.OCRStudio.ReviewStudio.loadPage(state.currentPageNum);
    updatePageIndicator();
  }

  // ─── File Ingestion ────────────────────────────────────────────────────────

  // Tesseract script → OCR language mapping
  const SCRIPT_TO_LANG = {
    'Devanagari': 'hin+eng',
    'Bengali':    'ben+eng',
    'Tamil':      'tam+eng',
    'Telugu':     'tel+eng',
    'Kannada':    'kan+eng',
    'Malayalam':  'mal+eng',
    'Gujarati':   'guj+eng',
    'Gurmukhi':   'pan+eng',
    'Oriya':      'ori+eng',
    'Arabic':     'urd+eng',   // Urdu uses Nastaliq/Arabic script
  };

  let _autoProceedTimer = null;

  function handleFileSelected(file) {
    if (!file) return;
    state.currentFile = file;
    showPreflightPanel(file);
  }

  async function detectLanguageFromFile(file) {
    try {
      if (state.isProcessing) return null;
      const isPdf = file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'));

      // TIER 1: If PDF has digital text layer, detect script instantly via Unicode inspection (1-3ms)
      if (isPdf && window.pdfjsLib) {
        try {
          const pdfData = await file.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({
            data: new Uint8Array(pdfData),
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/standard_fonts/',
          }).promise;
          const page = await pdf.getPage(1);
          const textContent = await page.getTextContent();
          const extractedText = (textContent.items || []).map(item => item.str).join(' ');
          await pdf.destroy();

          if (extractedText && extractedText.trim().length > 15) {
            const classification = window.OCRStudio.ScriptIDAgent.classifyText(extractedText);
            console.log('[App] Detected script from PDF text layer:', classification.script);
            const scriptMap = {
              'Latin':       { code: 'eng', name: 'English' },
              'Devanagari':  { code: 'hin+eng', name: 'Hindi + English' },
              'Bengali':     { code: 'ben+eng', name: 'Bengali + English' },
              'Tamil':       { code: 'tam+eng', name: 'Tamil + English' },
              'Telugu':      { code: 'tel+eng', name: 'Telugu + English' },
              'Kannada':     { code: 'kan+eng', name: 'Kannada + English' },
              'Malayalam':   { code: 'mal+eng', name: 'Malayalam + English' },
              'Gujarati':    { code: 'guj+eng', name: 'Gujarati + English' },
              'Gurmukhi':    { code: 'pan+eng', name: 'Punjabi + English' },
              'Arabic':      { code: 'urd+eng', name: 'Urdu + English' },
              'Odia':        { code: 'ori+eng', name: 'Odia + English' },
            };
            if (scriptMap[classification.script]) {
              return scriptMap[classification.script];
            }
          }
        } catch (e) {
          console.warn('[App] PDF digital text check skipped:', e.message);
        }
      }

      // TIER 2: Render first page thumbnail to canvas for visual detection
      let canvas = null;
      if (isPdf && window.pdfjsLib) {
        const pdfData = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({
          data: new Uint8Array(pdfData),
          cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/standard_fonts/',
        }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 0.75 });
        canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        await pdf.destroy();
      } else {
        const img = new Image();
        const blobUrl = URL.createObjectURL(file);
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = blobUrl;
        });
        canvas = document.createElement('canvas');
        canvas.width = Math.min(img.naturalWidth, 1000);
        canvas.height = Math.round(canvas.width * (img.naturalHeight / img.naturalWidth));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(blobUrl);
      }

      if (!canvas) return null;

      // TIER 3: If Gemini key is linked, run instant visual AI language detection (~300ms)
      if (window.OCRStudio.GeminiService && window.OCRStudio.GeminiService.getApiKey()) {
        const aiResult = await window.OCRStudio.GeminiService.detectLanguage(canvas);
        if (aiResult && aiResult.languageCode) {
          return { code: aiResult.languageCode, name: aiResult.displayName || aiResult.languageCode };
        }
      }

    } catch (err) {
      console.warn('[App] Language auto-detect error:', err.message);
    }
    return null;
  }

  function startAutoProceed(seconds = 3) {
    if (_autoProceedTimer) clearInterval(_autoProceedTimer);
    if (!autoProceedBar) return;

    autoProceedBar.classList.remove('hidden');
    let remaining = seconds;
    const totalMs = seconds * 1000;
    const startTime = Date.now();

    function tick() {
      const elapsed = Date.now() - startTime;
      const pct = Math.min((elapsed / totalMs) * 100, 100);
      const remSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
      if (autoProceedFill) autoProceedFill.style.width = pct + '%';
      if (autoProceedLabel) autoProceedLabel.textContent = remSec > 0 ? `Auto-starting in ${remSec}…` : 'Starting…';
      if (pct >= 100) {
        clearInterval(_autoProceedTimer);
        autoProceedBar.classList.add('hidden');
        startOCRProcessing();
      }
    }

    _autoProceedTimer = setInterval(tick, 100);
  }

  function cancelAutoProceed() {
    if (_autoProceedTimer) {
      clearInterval(_autoProceedTimer);
      _autoProceedTimer = null;
    }
    if (autoProceedBar) autoProceedBar.classList.add('hidden');
  }

  async function showPreflightPanel(file, push = true) {
    cancelAutoProceed();
    _currentView = 'preflight';
    if (push) {
      history.pushState({ view: 'preflight' }, '', '#preflight');
    }
    updateNavBackButton();

    // Ensure uploadZone is active and landing is hidden
    uploadZone.classList.remove('hidden');
    uploadZone.classList.add('active');
    hideLandingPage();
    reviewStudio.classList.remove('active');
    reviewStudio.classList.add('hidden');

    preflightPanel.classList.remove('hidden');
    dropArea.classList.add('hidden');
    const samplesSection = document.querySelector('.samples-section');
    if (samplesSection) samplesSection.classList.add('hidden');

    // Reset auto-detect badge
    if (langAutoBadge) langAutoBadge.classList.add('hidden');

    preflightResults.innerHTML = `<div class="preflight-loading">${icon('loader', 'ui-icon-spin ui-icon-sm')} Analyzing document...</div>`;

    try {
      const analysis = await window.OCRStudio.PreflightAnalyzer.analyze(file, state.selectedLanguage);

      const warningHtml = analysis.warnings.length > 0
        ? `<div class="preflight-warnings">${analysis.warnings.map(w => `<div class="preflight-warning">${icon('alert-triangle', 'text-warning ui-icon-xs')} ${w.replace(/^[\u26A0\u2139\uFE0F\s]+/, '')}</div>`).join('')}</div>`
        : '';

      preflightResults.innerHTML = `
        <div class="preflight-grid">
          <div class="preflight-stat">
            <span class="preflight-stat-label">${icon('file-text', 'ui-icon-xs')} Pages</span>
            <span class="preflight-stat-value">${analysis.pageCount}</span>
          </div>
          <div class="preflight-stat">
            <span class="preflight-stat-label">${icon('maximize-2', 'ui-icon-xs')} Resolution</span>
            <span class="preflight-stat-value">${analysis.width} × ${analysis.height} px</span>
          </div>
          <div class="preflight-stat">
            <span class="preflight-stat-label">${icon('cpu', 'ui-icon-xs')} Peak RAM Est.</span>
            <span class="preflight-stat-value">${analysis.peakRamEstimateMB} MB</span>
          </div>
          <div class="preflight-stat">
            <span class="preflight-stat-label">${icon('clock', 'ui-icon-xs')} Est. Time</span>
            <span class="preflight-stat-value">${analysis.estimatedTotalFormatted}</span>
          </div>
          <div class="preflight-stat">
            <span class="preflight-stat-label">${icon('settings', 'ui-icon-xs')} CPU Threads</span>
            <span class="preflight-stat-value">${analysis.hardware.hardwareConcurrency}</span>
          </div>
          <div class="preflight-stat">
            <span class="preflight-stat-label">${icon('folder', 'ui-icon-xs')} Type</span>
            <span class="preflight-stat-value">${analysis.fileType.toUpperCase()}</span>
          </div>
        </div>
        ${warningHtml}
      `;

      // Store analysis for session creation
      state._preflight = analysis;

      // Start auto-proceed timer immediately (4 seconds)
      startAutoProceed(4);

      // Auto-detect language in background (if not already processing)
      detectLanguageFromFile(file).then((result) => {
        if (state.isProcessing) return; // User already clicked Start OCR, do not overwrite
        if (result && result.code && languageSelect) {
          languageSelect.value = result.code;
          state.selectedLanguage = result.code;
          if (langAutoBadge) {
            langAutoBadge.innerHTML = `${icon('sparkles', 'ui-icon-xs')} AI Detected: ${result.name}`;
            langAutoBadge.classList.remove('hidden');
          }
          showToast(`Language auto-detected: ${result.name}`, 'info', 'sparkles');
        }
      }).catch((e) => {
        console.warn('[App] Background language detection error:', e);
      });

    } catch (err) {
      preflightResults.innerHTML = `<div class="preflight-error">${icon('alert-triangle', 'text-danger ui-icon-sm')} Analysis failed: ${err.message}</div>`;
    }
  }

  // ─── OCR Processing ────────────────────────────────────────────────────────

  async function startOCRProcessing() {
    const file = state.currentFile;
    if (!file) return;

    const language = languageSelect.value;
    state.selectedLanguage = language;

    // Create new session
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.sessionId = sessionId;

    const preflight = state._preflight || { pageCount: 1, width: 800, height: 1100, dpi: 200 };
    state.totalPages = preflight.pageCount;

    // Create canonical document
    const doc = window.OCRStudio.CanonicalDoc.createDocument({
      title: file.name,
      total_pages: preflight.pageCount,
      source_file_type: file.type || 'application/pdf',
      languages: language.split('+'),
    });

    state.canonicalDoc = doc;

    // Save session to DB
    await window.OCRStudio.DB.saveSession({
      sessionId,
      title: file.name,
      totalPages: preflight.pageCount,
      language,
      status: 'processing',
      processedPages: 0,
    });

    await window.OCRStudio.DB.saveDoc(sessionId, doc);

    // Switch to Review Studio
    state.currentPageNum = 1;
    state.totalPages = preflight.pageCount || 1;
    showReviewStudio();
    updatePageIndicator();

    // Show progress widget
    window.OCRStudio.JobProgress.show(preflight.pageCount, `Processing: ${file.name}`);
    window.OCRStudio.JobProgress.setPageProcessing(1, 'Rasterizing document...');

    // Wire progress callbacks
    window.OCRStudio.JobProgress.onPause(() => state.streamer?.pause());
    window.OCRStudio.JobProgress.onResume(() => state.streamer?.resume());
    window.OCRStudio.JobProgress.onCancel(cancelProcessing);
    window.OCRStudio.JobProgress.onPartialExport((pagesProcessed) => {
      exportPartial(pagesProcessed);
    });

    // Initialize streamer and coordinator
    state.streamer = new window.OCRStudio.PageStreamer(file, sessionId, 200);
    state.coordinator = new window.OCRStudio.PipelineCoordinator(language, sessionId);

    // Wire coordinator stage completions to ReviewStudio live UI
    state.coordinator.onStageComplete = (pageNum, stageName, result) => {
      if (state.currentPageNum === pageNum) {
        window.OCRStudio.ReviewStudio.updateStage(pageNum, stageName, result);
      }
      if (stageName === 'ocr' && result && result.wordCount) {
        const activeModel = window.OCRStudio.GeminiService?.getModel() || 'gemini-3.6-flash';
        const engineLabel = result.engine === 'gemini_vision' ? ` (⚡ ${activeModel})` : '';
        window.OCRStudio.JobProgress.setPageProcessing?.(pageNum, `${result.wordCount} words recognized${engineLabel}`);
      }
    };

    // Init Review Studio and show initial processing state immediately
    await window.OCRStudio.ReviewStudio.init(doc, sessionId);
    window.OCRStudio.ReviewStudio.showInitialProcessing(1, state.totalPages);

    // Wire streamer callbacks
    state.streamer.onPageReady = async (pageNum, width, height, blob) => {
      try {
        // If viewing this page (or page 1), display scan with laser beam immediately!
        if (state.currentPageNum === pageNum || pageNum === 1) {
          state.currentPageNum = pageNum;
          updatePageIndicator();
          window.OCRStudio.ReviewStudio.showProcessingScan(pageNum, blob, state.totalPages);
        }

        const hasGemini = Boolean(window.OCRStudio.GeminiService && window.OCRStudio.GeminiService.getApiKey());
        const activeModel = window.OCRStudio.GeminiService?.getModel() || 'gemini-3.6-flash';
        const progressMsg = hasGemini ? `⚡ Fast AI Processing (${activeModel})...` : 'Analyzing Indic text on-device...';
        window.OCRStudio.JobProgress.setPageProcessing(pageNum, progressMsg);

        const canonicalPage = await state.coordinator.processPage(pageNum, width, height, 200);
        window.OCRStudio.CanonicalDoc.addPageToDoc(doc, canonicalPage);

        // Update DB with latest doc state
        await window.OCRStudio.DB.saveDoc(sessionId, doc);
        await window.OCRStudio.DB.updateSessionStatus(sessionId, 'processing', pageNum);

        // Update progress widget
        window.OCRStudio.JobProgress.update(pageNum);

        // Load the complete page in ReviewStudio if active
        if (state.currentPageNum === pageNum || pageNum === 1) {
          await window.OCRStudio.ReviewStudio.loadPage(pageNum);
          updatePageIndicator();
        }

      } catch (err) {
        console.error(`[App] Error processing page ${pageNum}:`, err);
        showToast(`Page ${pageNum} error: ${err.message}`, 'error', 'alert-triangle');
      }
    };

    state.streamer.onComplete = async () => {
      state.isProcessing = false;
      await window.OCRStudio.DB.updateSessionStatus(sessionId, 'complete', state.totalPages);
      await window.OCRStudio.DB.saveDoc(sessionId, doc);
      
      // Mark progress widget complete — stays visible until user explicitly dismisses it
      window.OCRStudio.JobProgress.complete(`All ${state.totalPages} page(s) ready!`);

      await state.coordinator.terminateWorker();
      console.log('[App] Processing complete!');
      showToast('Processing complete! All pages are ready.', 'success', 'check-circle');
    };

    state.streamer.onError = (err, pageNum) => {
      console.error(`[App] Page ${pageNum} error:`, err);
      showToast(`Page ${pageNum} rasterization error: ${err.message || err}`, 'error', 'alert-triangle');
      window.OCRStudio.JobProgress.setPageProcessing?.(pageNum, `Error: ${err.message || err}`);
      if (state.currentPageNum === pageNum || pageNum === 1) {
        window.OCRStudio.ReviewStudio.showProcessingError?.(pageNum, err.message || String(err));
      }
    };

    // Start the pipeline!
    state.isProcessing = true;
    state.streamer.start();
  }

  async function cancelProcessing() {
    state.streamer?.cancel();
    state.coordinator?.terminateWorker();
    state.isProcessing = false;
    window.OCRStudio.JobProgress.hide();
    await window.OCRStudio.DB.updateSessionStatus(state.sessionId, 'cancelled', state.currentPageNum);
    showToast('Processing cancelled.', 'info');
  }

  // ─── Export Actions ────────────────────────────────────────────────────────

  async function exportPartial(upToPage) {
    if (!state.canonicalDoc) return;
    const partialDoc = { ...state.canonicalDoc, pages: state.canonicalDoc.pages.slice(0, upToPage) };
    window.OCRStudio.ExportJSON.export(partialDoc);
  }

  // ─── Page Navigation ───────────────────────────────────────────────────────

  async function navigateToPage(pageNum) {
    const clampedPage = Math.max(1, Math.min(pageNum, state.totalPages || 1));
    state.currentPageNum = clampedPage;
    await window.OCRStudio.ReviewStudio.loadPage(clampedPage);
    updatePageIndicator();
  }

  function updatePageIndicator() {
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${state.currentPageNum} of ${state.totalPages || '—'}`;
    }
  }

  // ─── UI State Transitions & Mobile Back Navigation ───────────────────────

  function updateNavBackButton() {
    if (!btnNavBack) return;
    if (_currentView === 'landing') {
      btnNavBack.classList.add('hidden');
    } else {
      btnNavBack.classList.remove('hidden');
      if (_currentView === 'review') {
        btnNavBack.setAttribute('title', 'Back to Upload Zone');
      } else if (_currentView === 'preflight') {
        btnNavBack.setAttribute('title', 'Cancel and Back to File Selection');
      } else {
        btnNavBack.setAttribute('title', 'Back to Landing Page');
      }
    }
  }

  function showReviewStudio(push = true) {
    _currentView = 'review';
    if (push) {
      history.pushState({ view: 'review' }, '', '#review');
    }
    uploadZone.classList.remove('active');
    uploadZone.classList.add('hidden');
    reviewStudio.classList.remove('hidden');
    reviewStudio.classList.add('active');
    hideLandingPage();
    updateNavBackButton();
  }

  function showUploadZone(push = true) {
    cancelAutoProceed();
    _currentView = 'upload';
    if (push) {
      history.pushState({ view: 'upload' }, '', '#upload');
    }
    reviewStudio.classList.remove('active');
    reviewStudio.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    uploadZone.classList.add('active');
    dropArea.classList.remove('hidden');
    preflightPanel.classList.add('hidden');
    const samplesSection = document.querySelector('.samples-section');
    if (samplesSection) samplesSection.classList.remove('hidden');
    state.currentFile = null;
    hideLandingPage();
    updateNavBackButton();
  }

  // ── Landing Page ──────────────────────────────────────────────────────────

  const landingPage = document.getElementById('landing-page');

  function hideLandingPage() {
    if (!landingPage) return;
    landingPage.classList.remove('active');
  }

  function showLanding(push = true) {
    if (!landingPage) return;
    cancelAutoProceed();
    _currentView = 'landing';
    if (push) {
      history.pushState({ view: 'landing' }, '', window.location.pathname);
    }
    // Hide other views
    uploadZone.classList.remove('active');
    uploadZone.classList.add('hidden');
    reviewStudio.classList.remove('active');
    reviewStudio.classList.add('hidden');
    landingPage.classList.add('active');
    // Scroll landing back to top
    landingPage.scrollTop = 0;
    // Wire scroll animations (idempotent)
    initLandingAnimations();
    updateNavBackButton();
  }

  function handleBackNavigation() {
    // 1. If any modal / popup / drawer is open, dismiss it first
    const openModals = [settingsModal, $('test-modal'), $('guide-modal')].filter(m => m && !m.classList.contains('hidden'));
    if (openModals.length > 0) {
      openModals.forEach(m => closeModal(m, false));
      if (window.history.state && window.history.state.overlay) {
        window.history.back();
      }
      return;
    }

    const diffDrawer = document.getElementById('diff-drawer');
    if (diffDrawer && diffDrawer.classList.contains('open')) {
      window.OCRStudio.ReviewStudio?.closeDiffDrawer();
      if (window.history.state && window.history.state.overlay === 'diffs') {
        window.history.back();
      }
      return;
    }

    if (navSamplesPopup && !navSamplesPopup.classList.contains('hidden')) {
      navSamplesPopup.classList.add('hidden');
      return;
    }

    const guidancePopup = document.getElementById('accuracy-guidance-popup');
    if (guidancePopup && !guidancePopup.classList.contains('hidden')) {
      guidancePopup.classList.add('hidden');
      return;
    }

    // 2. If in Review Studio
    if (_currentView === 'review') {
      if (state.isProcessing) {
        const ok = confirm('OCR processing is currently active. Do you want to stop and return to upload?');
        if (!ok) return;
        state.streamer?.pause();
        state.isProcessing = false;
      }
      if (window.history.length > 1 && window.history.state?.view === 'review') {
        window.history.back();
      } else {
        showUploadZone(true);
      }
      return;
    }

    // 3. If in Preflight
    if (_currentView === 'preflight') {
      cancelAutoProceed();
      if (window.history.length > 1 && window.history.state?.view === 'preflight') {
        window.history.back();
      } else {
        showUploadZone(true);
      }
      return;
    }

    // 4. If in Upload Zone
    if (_currentView === 'upload') {
      if (window.history.length > 1 && window.history.state?.view === 'upload') {
        window.history.back();
      } else {
        showLanding(true);
      }
      return;
    }

    // Fallback if on landing: nothing to go back to
  }

  function handlePopState(e) {
    // 1. If any overlay is open, dismiss it
    const openModals = [settingsModal, $('test-modal'), $('guide-modal')].filter(m => m && !m.classList.contains('hidden'));
    const isDiffDrawerOpen = document.getElementById('diff-drawer')?.classList.contains('open');
    const isSamplesPopupOpen = navSamplesPopup && !navSamplesPopup.classList.contains('hidden');
    const isGuidancePopupOpen = document.getElementById('accuracy-guidance-popup') && !document.getElementById('accuracy-guidance-popup').classList.contains('hidden');

    let dismissedOverlay = false;
    if (isGuidancePopupOpen) {
      document.getElementById('accuracy-guidance-popup')?.classList.add('hidden');
      dismissedOverlay = true;
    }
    if (isSamplesPopupOpen) {
      navSamplesPopup?.classList.add('hidden');
      dismissedOverlay = true;
    }
    if (isDiffDrawerOpen) {
      window.OCRStudio.ReviewStudio?.closeDiffDrawer();
      dismissedOverlay = true;
    }
    if (openModals.length > 0) {
      openModals.forEach(m => m.classList.add('hidden'));
      dismissedOverlay = true;
    }

    if (dismissedOverlay) {
      updateNavBackButton();
      return;
    }

    // 2. View resolution
    const target = e.state?.view || (window.location.hash ? window.location.hash.replace('#', '') : 'landing');

    if (target === 'review') {
      if (state.canonicalDoc || state.sessionId) {
        showReviewStudio(false);
      } else {
        showUploadZone(false);
      }
    } else if (target === 'preflight') {
      if (state.currentFile) {
        showPreflightPanel(state.currentFile, false);
      } else {
        showUploadZone(false);
      }
    } else if (target === 'upload') {
      showUploadZone(false);
    } else {
      showLanding(false);
    }
  }

  function initLandingAnimations() {
    if (landingPage._animationsWired) return;
    landingPage._animationsWired = true;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('lp-visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    landingPage.querySelectorAll('.lp-fade').forEach(el => io.observe(el));
  }

  function wireLandingCTAs() {
    // "Try OCR Studio Free" hero CTA
    document.getElementById('lp-btn-open-app')?.addEventListener('click', () => {
      showUploadZone(true);
    });
    // "See how it works" scrolls down within landing
    document.getElementById('lp-btn-learn-more')?.addEventListener('click', () => {
      document.getElementById('lp-how')?.scrollIntoView({ behavior: 'smooth' });
    });
    // Privacy section CTA + bottom CTA
    landingPage?.querySelectorAll('.lp-btn-cta-privacy, .lp-btn-cta-bottom').forEach(btn => {
      btn.addEventListener('click', () => {
        showUploadZone(true);
      });
    });
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  function loadGeminiSettings() {
    if (!geminiKeyInput) return;
    const key = window.OCRStudio.GeminiService.getApiKey();
    const model = window.OCRStudio.GeminiService.getModel();

    if (key) geminiKeyInput.value = key;
    if (model) {
      const validModels = Array.from(geminiModelSelect.options).map(o => o.value);
      if (validModels.includes(model)) {
        geminiModelSelect.value = model;
      } else {
        geminiModelSelect.value = 'custom';
        geminiCustomModel.classList.remove('hidden');
        geminiCustomModel.value = model;
      }
    }
    updateNavAIStatus();
  }

  function updateNavAIStatus() {
    const btnNavAI = $('btn-nav-ai-status');
    const labelNavAI = $('nav-ai-label');
    if (!btnNavAI || !labelNavAI) return;

    const hasKey = Boolean(window.OCRStudio.GeminiService && window.OCRStudio.GeminiService.getApiKey());
    if (hasKey) {
      const model = window.OCRStudio.GeminiService.getModel();
      btnNavAI.classList.add('ai-active');
      labelNavAI.textContent = '⚡ Gemini AI';
      btnNavAI.title = `Fast AI Mode Active (${model}) — ~1s/page OCR & Proofreading. Click to configure.`;
    } else {
      btnNavAI.classList.remove('ai-active');
      labelNavAI.textContent = '🔒 Local Tesseract';
      btnNavAI.title = 'On-Device OCR Mode (Zero network). Click to connect Gemini for 10x speedup.';
    }
  }

  function saveGeminiSettings() {
    const key = geminiKeyInput?.value.trim();
    let model = geminiModelSelect?.value;
    if (model === 'custom') {
      model = geminiCustomModel?.value.trim() || 'gemini-3.6-flash';
    }

    window.OCRStudio.GeminiService.setApiKey(key || '');
    if (model) window.OCRStudio.GeminiService.setModel(model);

    updateNavAIStatus();
    closeModal(settingsModal);
    if (key) {
      showToast('Gemini API key linked! Ultra-fast AI pipeline active (~1s/page).', 'success', 'sparkles');
    } else {
      showToast('Settings saved. Standard on-device OCR active.', 'info');
    }
  }

  // ─── Toast Notifications ──────────────────────────────────────────────────

  function showToast(message, type = 'info', iconName = null) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const defaultIcon = type === 'success' ? 'check-circle' : (type === 'error' || type === 'danger') ? 'alert-triangle' : 'info';
    const ic = icon(iconName || defaultIcon, 'ui-icon-sm');
    toast.innerHTML = (ic ? `<span class="toast-icon">${ic}</span>` : '') + `<span class="toast-text">${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('toast-visible'), 10);
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  // ─── Modal Helpers ────────────────────────────────────────────────────────

  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    if (modal.id) {
      history.pushState({ view: _currentView, overlay: modal.id }, '', '#' + modal.id);
    }
  }

  function closeModal(modal, popHistory = true) {
    if (!modal) return;
    modal.classList.add('hidden');
    if (popHistory && window.history.state && window.history.state.overlay === modal.id) {
      window.history.back();
    }
  }

  // ─── Event Wiring ─────────────────────────────────────────────────────────

  function wireEvents() {

    // ── File Drop ──────────────────────────────────────────────────────────
    if (dropArea) {
      dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.classList.add('drag-over');
      });
      dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
      dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelected(file);
      });
    }

    // ── File Input ──────────────────────────────────────────────────────────
    btnSelectFile?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFileSelected(file);
      fileInput.value = ''; // Reset so same file can be re-selected
    });

    // ── Pre-flight Actions ──────────────────────────────────────────────────
    btnStartOCR?.addEventListener('click', () => {
      cancelAutoProceed();   // cancel countdown if user clicks manually
      startOCRProcessing();
    });
    btnCancelPreflight?.addEventListener('click', () => {
      cancelAutoProceed();
      if (window.history.length > 1 && window.history.state?.view === 'preflight') {
        window.history.back();
      } else {
        showUploadZone(false);
      }
    });

    // ── Brand / Home ────────────────────────────────────────────────────────
    btnHome?.addEventListener('click', () => {
      cancelAutoProceed();
      showLanding(true);
    });

    // ── Back Navigation Button ──────────────────────────────────────────────
    btnNavBack?.addEventListener('click', () => {
      handleBackNavigation();
    });

    // ── History Popstate ────────────────────────────────────────────────────
    window.addEventListener('popstate', (e) => {
      handlePopState(e);
    });

    // ── Samples Nav Popup ───────────────────────────────────────────────────
    if (btnNavSamples && navSamplesPopup) {
      // Populate popup with sample cards (rendered from Samples module)
      function buildSamplesPopup() {
        if (navSamplesPopup.childElementCount > 0) return; // already built
        const samples = window.OCRStudio.Samples?.list;
        if (!samples) return;

        const icons = {
          court_order:       `<svg class="ui-icon ui-icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M6 18V9"/><path d="M10 18V9"/><path d="M14 18V9"/><path d="M18 18V9"/><path d="M12 2l10 5H2l10-5z"/></svg>`,
          land_record:       `<svg class="ui-icon ui-icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s1.3-1.4 1-3c-.4-2-2-3-4-3H4c-.6 0-1 .4-1 1v13c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-2c0-.6.4-1 1-1z"/></svg>`,
          sanskrit_manuscript:`<svg class="ui-icon ui-icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`,
          bengali_gazette:   `<svg class="ui-icon ui-icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>`,
        };

        navSamplesPopup.innerHTML = `
          <div class="samples-header">
            <span class="samples-title">${icon('file-text', 'ui-icon-sm')} Sample Documents (1-Click Test)</span>
            <span class="text-muted" style="font-size:11px;">Authentic Indian language scans</span>
          </div>
          <div class="samples-grid">${samples.map(s => `
            <div class="sample-card" data-sample-id="${s.id}">
              <div class="sample-card-header">
                <div class="sample-card-icon">${icons[s.id] || ''}</div>
                <span class="sample-card-badge">${s.badge || ''}</span>
              </div>
              <div class="sample-card-title">${s.title}</div>
              <div class="sample-card-desc">${s.description || ''}</div>
              <div class="sample-card-footer">
                <span class="sample-card-lang">${s.scriptName || s.language}</span>
                <button class="btn-primary sample-btn-action" data-sample="${s.id}">Load Scan</button>
              </div>
            </div>`).join('')}
          </div>`;

        // Wire the new cards
        navSamplesPopup.querySelectorAll('.sample-card').forEach((card) => {
          card.addEventListener('click', async (e) => {
            const sampleId = card.dataset.sampleId;
            if (!sampleId) return;
            const btn = card.querySelector('.sample-btn-action');
            const origText = btn ? btn.textContent : null;
            if (btn) { btn.innerHTML = `${icon('loader', 'ui-icon-spin ui-icon-xs')} Loading...`; btn.disabled = true; }

            const sampleDef = window.OCRStudio.Samples.list.find(s => s.id === sampleId);
            if (sampleDef && languageSelect) {
              languageSelect.value = sampleDef.language;
              state.selectedLanguage = sampleDef.language;
            }
            showToast(`Loading ${sampleDef ? sampleDef.title : sampleId}...`, 'info', 'file-text');
            navSamplesPopup.classList.add('hidden');

            try {
              const sampleFile = await window.OCRStudio.Samples.getSampleFile(sampleId);
              handleFileSelected(sampleFile);
            } catch (err) {
              showToast(`Failed to load sample: ${err.message}`, 'error', 'alert-triangle');
            } finally {
              if (btn && origText) { btn.textContent = origText; btn.disabled = false; }
            }
          });
        });
      }

      btnNavSamples.addEventListener('click', (e) => {
        e.stopPropagation();
        buildSamplesPopup();
        const wasHidden = navSamplesPopup.classList.contains('hidden');
        navSamplesPopup.classList.toggle('hidden');
        if (wasHidden) {
          history.pushState({ view: _currentView, overlay: 'samples' }, '', '#samples');
        }
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#nav-samples-wrapper')) {
          navSamplesPopup.classList.add('hidden');
        }
      });
    }

    // ── Sample Document Cards (1-Click Test) ────────────────────────────────
    document.querySelectorAll('.sample-card').forEach((card) => {
      card.addEventListener('click', async (e) => {
        const sampleId = card.dataset.sampleId;
        if (!sampleId) return;

        const btn = card.querySelector('.sample-btn-action');
        const origText = btn ? btn.textContent : null;
        if (btn) {
          btn.innerHTML = `${icon('loader', 'ui-icon-spin ui-icon-xs')} Loading...`;
          btn.disabled = true;
        }

        const sampleDef = window.OCRStudio.Samples && window.OCRStudio.Samples.list
          ? window.OCRStudio.Samples.list.find((s) => s.id === sampleId)
          : null;

        if (sampleDef && languageSelect) {
          languageSelect.value = sampleDef.language;
          state.selectedLanguage = sampleDef.language;
        }

        showToast(`Loading ${sampleDef ? sampleDef.title : sampleId}...`, 'info', 'file-text');

        try {
          if (!window.OCRStudio.Samples) {
            throw new Error('Samples module not loaded');
          }
          const sampleFile = await window.OCRStudio.Samples.getSampleFile(sampleId);
          handleFileSelected(sampleFile);
        } catch (err) {
          console.error('[App] Failed to load sample:', err);
          showToast(`Failed to load sample: ${err.message}`, 'error', 'alert-triangle');
        } finally {
          if (btn && origText) {
            btn.textContent = origText;
            btn.disabled = false;
          }
        }
      });
    });

    // ── Navigation ──────────────────────────────────────────────────────────
    btnPrevPage?.addEventListener('click', () => navigateToPage(state.currentPageNum - 1));
    btnNextPage?.addEventListener('click', () => navigateToPage(state.currentPageNum + 1));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      // Only when not in contenteditable
      if (e.target.closest('[contenteditable]')) return;
      if (e.code === 'ArrowLeft') navigateToPage(state.currentPageNum - 1);
      if (e.code === 'ArrowRight') navigateToPage(state.currentPageNum + 1);
    });

    // ── Export Menu Toggle (Vertical Slider Popup) ─────────────────────────
    if (btnExportMenu && exportDropdownMenu) {
      btnExportMenu.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = exportDropdownMenu.classList.toggle('open');
        btnExportMenu.classList.toggle('active', isOpen);
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.export-dropdown')) {
          exportDropdownMenu.classList.remove('open');
          btnExportMenu.classList.remove('active');
        }
      });

      exportDropdownMenu.querySelectorAll('.export-menu-item').forEach((item) => {
        item.addEventListener('click', () => {
          exportDropdownMenu.classList.remove('open');
          btnExportMenu.classList.remove('active');
        });
      });
    }

    // ── Export Actions ─────────────────────────────────────────────────────
    btnExportPDF?.addEventListener('click', async () => {
      if (!state.canonicalDoc) {
        showToast('Please load or process a document first.', 'warning', 'alert-triangle');
        return;
      }
      showToast('Generating searchable PDF...', 'info', 'file-text');
      await window.OCRStudio.ExportSearchablePDF.export(
        state.canonicalDoc,
        (pageNum) => window.OCRStudio.DB.getPageBlob(state.sessionId, pageNum)
      );
    });

    btnExportDOCX?.addEventListener('click', async () => {
      if (!state.canonicalDoc) {
        showToast('Please load or process a document first.', 'warning', 'alert-triangle');
        return;
      }
      showToast('Generating Word document...', 'info', 'file-text');
      await window.OCRStudio.ExportDOCX.export(state.canonicalDoc, null);
    });

    btnExportTXT?.addEventListener('click', () => {
      if (!state.canonicalDoc) {
        showToast('Please load or process a document first.', 'warning', 'alert-triangle');
        return;
      }
      showToast('Exporting plain text...', 'info', 'file-text');
      window.OCRStudio.ExportTXT.export(state.canonicalDoc);
    });

    btnExportJSON?.addEventListener('click', () => {
      if (!state.canonicalDoc) {
        showToast('Please load or process a document first.', 'warning', 'alert-triangle');
        return;
      }
      showToast('Exporting JSON + audit log...', 'info', 'file-text');
      window.OCRStudio.ExportJSON.export(state.canonicalDoc);
    });

    // ── Diff & AI Actions ──────────────────────────────────────────────────
    btnOpenDiffs?.addEventListener('click', () => {
      window.OCRStudio.ReviewStudio.openDiffDrawer();
      history.pushState({ view: _currentView, overlay: 'diffs' }, '', '#diffs');
    });

    btnGeminiProofread?.addEventListener('click', async () => {
      if (!window.OCRStudio.GeminiService.getApiKey()) {
        openModal(settingsModal);
        showToast('Please add your Gemini API key in Settings first.', 'info', 'settings');
        return;
      }

      const pageData = await window.OCRStudio.DB.getPageData(state.sessionId, state.currentPageNum);
      if (!pageData || !pageData.blocks || pageData.blocks.length === 0) {
        showToast('No text blocks found on this page to proofread.', 'warning');
        return;
      }

      showToast('Running AI proofreading with Gemini...', 'info', 'sparkles');

      let newDiffs = 0;
      let lastError = null;

      for (const block of pageData.blocks) {
        try {
          const diffs = await window.OCRStudio.GeminiService.proofreadBlock(block, state.selectedLanguage);
          if (diffs && diffs.length > 0) {
            block.diffs.push(...diffs);
            newDiffs += diffs.length;
          }
        } catch (err) {
          lastError = err;
          console.warn('[App] Gemini proofread error:', err);
        }
      }

      if (lastError && newDiffs === 0) {
        showToast(`AI Proofread failed: ${lastError.message}`, 'error', 'alert-triangle');
        return;
      }

      // Save updated page data
      await window.OCRStudio.DB.savePageData(state.sessionId, state.currentPageNum, pageData);
      if (state.canonicalDoc) {
        const pageIdx = state.canonicalDoc.pages.findIndex(p => p.page_number === state.currentPageNum);
        if (pageIdx >= 0) state.canonicalDoc.pages[pageIdx] = pageData;
        await window.OCRStudio.DB.saveDoc(state.sessionId, state.canonicalDoc);
      }

      window.OCRStudio.ReviewStudio.refresh();

      if (newDiffs > 0) {
        window.OCRStudio.ReviewStudio.openDiffDrawer();
        showToast(`AI suggested ${newDiffs} correction(s). Review in diff drawer.`, 'success', 'check-circle');
      } else {
        showToast('No OCR errors detected. Document text is verified.', 'success', 'check-circle');
      }
    });

    btnGeminiVision?.addEventListener('click', async () => {
      if (!window.OCRStudio.GeminiService.getApiKey()) {
        openModal(settingsModal);
        showToast('Please add your Gemini API key in Settings first.', 'info', 'settings');
        return;
      }

      const blob = await window.OCRStudio.DB.getPageBlob(state.sessionId, state.currentPageNum);
      if (!blob) {
        showToast('Could not load page image from database.', 'error');
        return;
      }

      const canvas = document.createElement('canvas');
      const bm = await createImageBitmap(blob);
      canvas.width = bm.width;
      canvas.height = bm.height;
      canvas.getContext('2d').drawImage(bm, 0, 0);
      bm.close();

      const activeModel = window.OCRStudio.GeminiService?.getModel() || 'gemini-3.6-flash';
      showToast(`Re-scanning page with ${activeModel} Vision...`, 'info', 'sparkles');

      try {
        const visionText = await window.OCRStudio.GeminiService.visionOCRPage(canvas, state.selectedLanguage);
        if (!visionText || !visionText.trim()) {
          showToast('Gemini Vision returned empty text.', 'warning');
          return;
        }

        const pageData = await window.OCRStudio.DB.getPageData(state.sessionId, state.currentPageNum);
        if (!pageData) return;

        // Structure into paragraphs and blocks
        let paragraphs = visionText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
        if (paragraphs.length <= 1 && visionText.includes('\n')) {
          const rawLines = visionText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          paragraphs = [];
          let cur = [];
          for (const line of rawLines) {
            cur.push(line);
            if (line.length < 50 || cur.length >= 4) {
              paragraphs.push(cur.join(' '));
              cur = [];
            }
          }
          if (cur.length) paragraphs.push(cur.join(' '));
        }
        if (paragraphs.length === 0) paragraphs = [visionText.trim()];

        const totalParas = paragraphs.length;
        const paraHeight = totalParas > 0 ? (pageData.height * 0.85) / totalParas : pageData.height;
        const startY = pageData.height * 0.05;
        const marginX = pageData.width * 0.08;
        const blockWidth = pageData.width * 0.84;

        const newBlocks = [];
        let wordCounter = 0;

        for (let idx = 0; idx < paragraphs.length; idx++) {
          const paraText = paragraphs[idx];
          const isHeading = (paraText.length < 70 && !paraText.endsWith('.') && idx === 0) ||
                            (paraText.length < 50 && !paraText.includes('. ') && paraText === paraText.toUpperCase());

          const by = Math.round(startY + idx * paraHeight);
          const bh = Math.round(Math.min(paraHeight * 0.9, pageData.height - by - 10));

          const rawWordTokens = paraText.split(/\s+/).filter(t => t.length > 0);
          const blockWords = [];
          const totalWords = rawWordTokens.length;

          const wordW = totalWords > 0 ? Math.round(blockWidth / Math.min(totalWords, 10)) : 60;
          const wordH = Math.min(24, Math.round(bh / Math.max(1, Math.ceil(totalWords / 10))));

          for (let wIdx = 0; wIdx < rawWordTokens.length; wIdx++) {
            const wToken = rawWordTokens[wIdx];
            const lineRow = Math.floor(wIdx / 10);
            const colPos = wIdx % 10;
            const wx = Math.round(marginX + colPos * (blockWidth / 10));
            const wy = Math.round(by + lineRow * (wordH + 4));

            blockWords.push({
              word_id: `w_${state.currentPageNum}_${wordCounter++}`,
              text: wToken,
              confidence: 0.98,
              bbox: {
                x: wx,
                y: wy,
                w: Math.max(20, Math.min(wordW, 120)),
                h: Math.max(16, wordH)
              }
            });
          }

          const block = window.OCRStudio.CanonicalDoc.createBlock(state.currentPageNum, idx, {
            type: isHeading ? 'heading' : 'paragraph',
            column_index: 0,
            reading_order: idx,
            bbox: {
              x: Math.round(marginX),
              y: by,
              w: Math.round(blockWidth),
              h: Math.max(30, bh)
            },
            raw_text: paraText,
            active_text: paraText,
            confidence: 0.98,
            source: 'gemini_vision',
            words: blockWords
          });

          newBlocks.push(block);
        }

        pageData.blocks = newBlocks;
        pageData.confidence = 0.98;
        pageData.needs_review = false;

        if (state.canonicalDoc) {
          const pageIdx = state.canonicalDoc.pages.findIndex(p => p.page_number === state.currentPageNum);
          if (pageIdx >= 0) state.canonicalDoc.pages[pageIdx] = pageData;
          await window.OCRStudio.DB.saveDoc(state.sessionId, state.canonicalDoc);
        }

        await window.OCRStudio.DB.savePageData(state.sessionId, state.currentPageNum, pageData);
        await window.OCRStudio.ReviewStudio.loadPage(state.currentPageNum);
        showToast('Gemini Vision scan complete! Page text updated.', 'success', 'sparkles');

      } catch (err) {
        console.error('[App] Gemini Vision error:', err);
        showToast(`Gemini Vision error: ${err.message}`, 'error', 'alert-triangle');
      }
    });

    // ── Canvas Toolbar ─────────────────────────────────────────────────────
    btnHandTool?.addEventListener('click', () => {
      window.OCRStudio.ReviewStudio._handToolActive = !window.OCRStudio.ReviewStudio._handToolActive;
      btnHandTool.classList.toggle('active', window.OCRStudio.ReviewStudio._handToolActive);
    });

    btnFitPage?.addEventListener('click', () => {
      window.OCRStudio.ReviewStudio.fitPage?.();
    });

    btnZoomIn?.addEventListener('click', () => {
      window.OCRStudio.ReviewStudio.zoom?.(1.2);
    });

    btnZoomOut?.addEventListener('click', () => {
      window.OCRStudio.ReviewStudio.zoom?.(0.83);
    });

    // ── Settings & AI Status Modal ─────────────────────────────────────────
    btnSettings?.addEventListener('click', () => {
      loadGeminiSettings();
      openModal(settingsModal);
    });
    $('btn-nav-ai-status')?.addEventListener('click', () => {
      loadGeminiSettings();
      openModal(settingsModal);
    });
    btnGuide?.addEventListener('click', () => window.OCRStudio.UserGuideModal.show());

    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeModal(settingsModal);
    });

    document.querySelector('#settings-modal .btn-close-modal')?.addEventListener('click', () =>
      closeModal(settingsModal)
    );

    btnSaveSettings?.addEventListener('click', saveGeminiSettings);

    btnTestGemini?.addEventListener('click', async () => {
      geminiStatus.textContent = 'Testing...';
      geminiStatus.className = 'gemini-status testing';
      try {
        const inputKey = geminiKeyInput?.value.trim();
        let inputModel = geminiModelSelect?.value;
        if (inputModel === 'custom') {
          inputModel = geminiCustomModel?.value.trim() || 'gemini-3.6-flash';
        }
        if (inputKey) window.OCRStudio.GeminiService.setApiKey(inputKey);
        if (inputModel) window.OCRStudio.GeminiService.setModel(inputModel);

        const result = await window.OCRStudio.GeminiService.testConnection();
        if (result.ok) {
          geminiStatus.innerHTML = `${icon('check-circle', 'text-success ui-icon-xs')} Connected (${result.model})`;
          geminiStatus.className = 'gemini-status success';
        } else {
          geminiStatus.innerHTML = `${icon('alert-triangle', 'text-danger ui-icon-xs')} ${result.error}`;
          geminiStatus.className = 'gemini-status error';
        }
      } catch (err) {
        geminiStatus.innerHTML = `${icon('alert-triangle', 'text-danger ui-icon-xs')} ${err.message}`;
        geminiStatus.className = 'gemini-status error';
      }
    });

    geminiModelSelect?.addEventListener('change', () => {
      if (geminiModelSelect.value === 'custom') {
        geminiCustomModel?.classList.remove('hidden');
      } else {
        geminiCustomModel?.classList.add('hidden');
      }
    });

    // ── Close modals on Escape ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        closeModal(settingsModal);
        window.OCRStudio.UserGuideModal.hide();
      }
    });

    // ── ReviewStudio diff action callback ─────────────────────────────────
    window.OCRStudio.ReviewStudio.onDiffAction(async () => {
      // Save updated page data back to DB after any diff action
      const pageData = await window.OCRStudio.DB.getPageData(state.sessionId, state.currentPageNum);
      if (pageData && state.canonicalDoc) {
        // Find and update the page in canonicalDoc
        const pageIdx = state.canonicalDoc.pages.findIndex(p => p.page_number === state.currentPageNum);
        if (pageIdx >= 0) {
          state.canonicalDoc.pages[pageIdx] = pageData;
        }
        await window.OCRStudio.DB.saveDoc(state.sessionId, state.canonicalDoc);
      }
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  await init();

})();
