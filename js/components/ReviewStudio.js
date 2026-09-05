'use strict';
window.OCRStudio = window.OCRStudio || {};

/**
 * ReviewStudio
 * ============
 * Main split-screen review interface for IndicOCR Studio v2.
 *
 * Manages:
 *  - Left pane : Canvas with page image + SVG bounding-box overlays
 *  - Right pane: Contenteditable text editor with per-block elements
 *  - Diff drawer: Slide-in panel with accept / reject controls
 *  - Pan & zoom on the scan canvas
 *  - Cross-panel sync (click text -> highlight bbox; click bbox -> scroll text)
 *  - Gemini action triggers
 */
window.OCRStudio.ReviewStudio = (function () {

  /* Private state */
  var _currentDoc       = null;
  var _currentSessionId = null;
  var _currentPageNum   = 1;
  var _currentPageData  = null;

  var _panState = {
    isPanning:  false,
    startX:     0,
    startY:     0,
    translateX: 0,
    translateY: 0,
  };

  var _zoomState = { scale: 1.0 };

  var _handToolActive = false;
  var _spacePanning   = false;

  var _onDiffActionCallback = null;

  /* DOM helpers */
  function el(id) { return document.getElementById(id); }

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  function _getIcon(name, cls, size) {
    return (window.OCRStudio && window.OCRStudio.Icons) ? window.OCRStudio.Icons.get(name, cls, size) : '';
  }

  /* ── Pan & Zoom ── */

  function _syncPanZoom() {
    var tx = _panState.translateX;
    var ty = _panState.translateY;
    var sc = _zoomState.scale;
    var t  = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + sc + ')';
    var canvas  = el('scan-canvas');
    var overlay = el('bbox-overlay');
    if (canvas)  canvas.style.transform  = t;
    if (overlay) overlay.style.transform = t;

    var pct = Math.round(sc * 100) + '%';
    var zoomLevel = el('zoom-level');
    if (zoomLevel) zoomLevel.textContent = pct;

    var oldIndicator = document.querySelector('.zoom-indicator');
    if (oldIndicator) oldIndicator.remove();
  }

  function _fitPage() {
    var viewport = el('scan-viewport');
    var canvas   = el('scan-canvas');
    if (!viewport || !canvas) return;
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    var iw = canvas.width;
    var ih = canvas.height;
    if (!iw || !ih) return;
    var fitScale = Math.min(vw / iw, vh / ih) * 0.92;
    _zoomState.scale     = fitScale;
    _panState.translateX = (vw - iw * fitScale) / 2;
    _panState.translateY = (vh - ih * fitScale) / 2;
    _syncPanZoom();
  }

  function _setupPanZoom() {
    var viewport = el('scan-viewport');
    if (!viewport) return;

    viewport.addEventListener('mousedown', function (e) {
      if (!(_handToolActive || _spacePanning)) return;
      if (e.target.closest && e.target.closest('.bbox-rect')) return;
      _panState.isPanning    = true;
      _panState.startX       = e.clientX - _panState.translateX;
      _panState.startY       = e.clientY - _panState.translateY;
      viewport.style.cursor  = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!_panState.isPanning) return;
      _panState.translateX = e.clientX - _panState.startX;
      _panState.translateY = e.clientY - _panState.startY;
      _syncPanZoom();
    });

    document.addEventListener('mouseup', function () {
      if (!_panState.isPanning) return;
      _panState.isPanning   = false;
      viewport.style.cursor = _handToolActive ? 'grab' : '';
    });

    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var rect     = viewport.getBoundingClientRect();
        var mouseX   = e.clientX - rect.left;
        var mouseY   = e.clientY - rect.top;
        var factor   = e.deltaY < 0 ? 1.1 : 0.9;
        var oldScale = _zoomState.scale;
        var newScale = clamp(oldScale * factor, 0.2, 5.0);
        _panState.translateX = mouseX - (mouseX - _panState.translateX) * (newScale / oldScale);
        _panState.translateY = mouseY - (mouseY - _panState.translateY) * (newScale / oldScale);
        _zoomState.scale     = newScale;
      } else {
        var dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        var dy = e.shiftKey ? 0         : -e.deltaY;
        _panState.translateX += dx;
        _panState.translateY += dy;
      }
      _syncPanZoom();
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space') {
        var tag = document.activeElement && document.activeElement.tagName;
        var ce  = document.activeElement && document.activeElement.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || ce) return;
        e.preventDefault();
        if (!_spacePanning) {
          _spacePanning         = true;
          viewport.style.cursor = 'grab';
          viewport.classList.add('panning');
        }
      }
      if (e.code === 'ArrowRight' && !e.target.isContentEditable) _navigatePage(1);
      if (e.code === 'ArrowLeft'  && !e.target.isContentEditable) _navigatePage(-1);
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        _zoomState.scale = clamp(_zoomState.scale * 1.15, 0.2, 5.0);
        _syncPanZoom();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        _zoomState.scale = clamp(_zoomState.scale * 0.87, 0.2, 5.0);
        _syncPanZoom();
      }
    });

    document.addEventListener('keyup', function (e) {
      if (e.code === 'Space') {
        _spacePanning         = false;
        viewport.style.cursor = _handToolActive ? 'grab' : '';
        viewport.classList.remove('panning');
        _panState.isPanning   = false;
      }
    });

    var btnHand = el('btn-hand-tool');
    if (btnHand) {
      btnHand.addEventListener('click', function () {
        _handToolActive = !_handToolActive;
        btnHand.classList.toggle('active', _handToolActive);
        viewport.style.cursor = _handToolActive ? 'grab' : '';
        viewport.classList.toggle('panning', _handToolActive);
      });
    }

    var btnFit = el('btn-fit-page');
    if (btnFit) btnFit.addEventListener('click', _fitPage);

    var btnZoomIn  = el('btn-zoom-in');
    var btnZoomOut = el('btn-zoom-out');
    if (btnZoomIn)  btnZoomIn.addEventListener('click',  function () { _zoomState.scale = clamp(_zoomState.scale * 1.2, 0.2, 5.0); _syncPanZoom(); });
    if (btnZoomOut) btnZoomOut.addEventListener('click', function () { _zoomState.scale = clamp(_zoomState.scale * 0.83, 0.2, 5.0); _syncPanZoom(); });

  }

  /* ── Canvas rendering ── */

  function _renderCanvas(blob) {
    var canvas   = el('scan-canvas');
    var viewport = el('scan-viewport');
    if (!canvas || !viewport) return;

    var ph = viewport.querySelector('.viewport-placeholder');
    if (ph) ph.remove();

    if (!blob) {
      canvas.width  = 0;
      canvas.height = 0;
      _showViewportPlaceholder('no-image', 'No image available for this page');
      return;
    }

    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      _fitPage();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      _showViewportPlaceholder('decode-error', 'Could not decode page image');
    };
    img.src = url;
  }

  function _showViewportPlaceholder(type, text) {
    var viewport = el('scan-viewport');
    if (!viewport) return;
    function getIcon(name) {
      return (window.OCRStudio && window.OCRStudio.Icons) ? window.OCRStudio.Icons.get(name, 'ui-icon-xl') : '';
    }
    var icons = { 'no-image': getIcon('file-text'), 'decode-error': getIcon('alert-triangle'), 'loading': getIcon('clock') };
    var icon  = icons[type] || getIcon('file-text');
    var div   = document.createElement('div');
    div.className = 'viewport-placeholder';
    div.innerHTML = '<div class="viewport-placeholder-icon">' + icon + '</div><div>' + _escHtml(text) + '</div>';
    viewport.appendChild(div);
  }

  /* ── BBox SVG Overlay ── */

  function _renderBBoxOverlay(pageData) {
    var svg = el('bbox-overlay');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!pageData || !pageData.blocks) return;

    var canvas = el('scan-canvas');
    if (canvas) {
      svg.setAttribute('width',  canvas.width  || 0);
      svg.setAttribute('height', canvas.height || 0);
    }

    pageData.blocks.forEach(function (block) {
      if (!block.words) return;
      block.words.forEach(function (word) {
        if (!word.bbox) return;
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x',      word.bbox.x || 0);
        rect.setAttribute('y',      word.bbox.y || 0);
        rect.setAttribute('width',  word.bbox.w || 0);
        rect.setAttribute('height', word.bbox.h || 0);
        rect.setAttribute('rx', '2');
        var conf      = typeof word.confidence === 'number' ? word.confidence : 1;
        var confClass = conf >= 0.9 ? 'conf-high' : conf >= 0.75 ? 'conf-mid' : 'conf-low';
        rect.setAttribute('class', 'bbox-rect ' + confClass);
        rect.dataset.wordId  = word.word_id  || '';
        rect.dataset.blockId = block.block_id || '';
        rect.style.pointerEvents = 'all';
        rect.addEventListener('click', function (e) {
          e.stopPropagation();
          _highlightBBox(word.word_id);
          _scrollToBlock(block.block_id);
        });
        svg.appendChild(rect);
      });
    });
  }

  /* ── Text Editor ── */

  function _renderTextEditor(pageData) {
    var editor = el('text-editor');
    if (!editor) return;
    editor.innerHTML = '';

    if (!pageData || !pageData.blocks || pageData.blocks.length === 0) {
      editor.innerHTML =
        '<div class="viewport-placeholder" style="height:200px;">' +
        '<div class="viewport-placeholder-icon">' + _getIcon('edit-3', 'ui-icon-xl') + '</div>' +
        '<div>No text data for this page</div>' +
        '</div>';
      return;
    }

    var blocks = pageData.blocks.slice().sort(function (a, b) {
      return (a.reading_order || 0) - (b.reading_order || 0);
    });

    blocks.forEach(function (block) {
      var blockDiv = document.createElement('div');
      blockDiv.className       = 'text-block';
      blockDiv.dataset.blockId = block.block_id || '';

      if (block.type === 'heading') blockDiv.classList.add('block-heading');
      if (block.script === 'Arabic' || block.script === 'Persian') blockDiv.classList.add('block-rtl');

      var acceptedDiffs = _countAcceptedDiffs(block);
      var badgeClass, badgeLabel;
      if (block.source === 'gemini_vision') {
        badgeClass = 'gemini-vision';
        badgeLabel = 'Gemini Vision';
      } else if (acceptedDiffs > 0) {
        badgeClass = 'ai-corrected';
        badgeLabel = 'AI-Corrected (' + acceptedDiffs + ' applied)';
      } else {
        badgeClass = 'normal';
        badgeLabel = 'Normal (Raw OCR)';
      }

      var metaDiv = document.createElement('div');
      metaDiv.className = 'block-meta';
      metaDiv.innerHTML =
        '<span class="source-badge ' + badgeClass + '">' + badgeLabel + '</span>' +
        '<span class="block-order-label text-muted">#' + (block.reading_order || 0) + '</span>';

      var contentDiv = document.createElement('div');
      contentDiv.className       = 'block-content';
      contentDiv.contentEditable = 'true';
      contentDiv.textContent     = _getActiveText(block);

      contentDiv.addEventListener('input', function () {
        block.active_text = contentDiv.textContent;
        if (typeof _onDiffActionCallback === 'function') {
          _onDiffActionCallback({ type: 'edit', blockId: block.block_id });
        }
      });

      blockDiv.addEventListener('click', function (e) {
        if (e.target === contentDiv || contentDiv.contains(e.target)) return;
        _selectBlock(block.block_id);
      });

      blockDiv.appendChild(metaDiv);
      blockDiv.appendChild(contentDiv);
      editor.appendChild(blockDiv);
    });
  }

  function _getActiveText(block) {
    if (window.OCRStudio.CanonicalDoc &&
        typeof window.OCRStudio.CanonicalDoc.getActiveText === 'function') {
      return window.OCRStudio.CanonicalDoc.getActiveText(block) || '';
    }
    return block.active_text || block.text || '';
  }

  function _countAcceptedDiffs(block) {
    if (!block.diffs) return 0;
    return block.diffs.filter(function (d) { return d.status === 'accepted'; }).length;
  }

  /* ── Cross-panel sync ── */

  function _highlightBBox(wordId) {
    var svg = el('bbox-overlay');
    if (!svg) return;
    svg.querySelectorAll('.bbox-rect').forEach(function (r) {
      r.classList.toggle('bbox-highlighted', r.dataset.wordId === wordId);
    });
  }

  function _scrollToBlock(blockId) {
    var editor = el('text-editor');
    if (!editor) return;
    editor.querySelectorAll('.text-block').forEach(function (b) {
      if (b.dataset.blockId === blockId) {
        b.classList.add('selected');
        b.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        b.classList.remove('selected');
      }
    });
  }

  function _selectBlock(blockId) {
    _scrollToBlock(blockId);
    if (_currentPageData && _currentPageData.blocks) {
      var block = _currentPageData.blocks.find(function (b) { return b.block_id === blockId; });
      if (block && block.words && block.words.length > 0) {
        _highlightBBox(block.words[0].word_id);
      }
    }
  }

  /* ── Page navigation ── */

  function _navigatePage(delta) {
    if (!_currentDoc) return;
    var nextPage = _currentPageNum + delta;
    if (nextPage < 1 || nextPage > (_currentDoc.page_count || 1)) return;
    module.loadPage(nextPage);
  }

  function _updatePageIndicator(explicitTotal) {
    var indicator = el('page-indicator');
    if (!indicator) return;
    var total = explicitTotal ||
      (_currentDoc && _currentDoc.metadata && _currentDoc.metadata.total_pages) ||
      (_currentDoc && _currentDoc.page_count) ||
      (_currentDoc && _currentDoc.pages && _currentDoc.pages.length) ||
      (window.OCRStudio && window.OCRStudio.state && window.OCRStudio.state.totalPages) ||
      1;
    indicator.textContent = 'Page ' + _currentPageNum + ' of ' + total;
  }

  /* ── Live Active OCR State Rendering ── */

  function _removeScanningOverlays() {
    var viewport = el('scan-viewport');
    if (viewport) {
      var overlays = viewport.querySelectorAll('.scan-processing-overlay, .scan-processing-hud, .viewport-placeholder');
      overlays.forEach(function (node) { node.remove(); });
    }
  }

  function _renderProcessingEditorHTML(pageNum, totalPages, stageMessage) {
    var total = totalPages || (_currentDoc && _currentDoc.metadata && _currentDoc.metadata.total_pages) || 1;
    return (
      '<div class="ocr-active-processing-container">' +
        '<div class="ocr-processing-card">' +
          '<div class="ocr-processing-header">' +
            '<div class="spinner"></div>' +
            '<div class="ocr-processing-title">OCR Processing Active</div>' +
          '</div>' +
          '<div class="ocr-page-status" id="ocr-active-status-text">' +
            (stageMessage || ('Processing Page ' + pageNum + ' of ' + total + '...')) +
          '</div>' +
          '<div class="ocr-stage-pills">' +
            '<div class="ocr-stage-pill active" id="stage-pill-1">' +
              '<span class="stage-pill-dot"></span>' +
              '<span>1. Sauvola Binarization &amp; Deskew</span>' +
            '</div>' +
            '<div class="ocr-stage-pill" id="stage-pill-2">' +
              '<span class="stage-pill-dot"></span>' +
              '<span>2. Indic Text Recognition (Tesseract LSTM)</span>' +
            '</div>' +
            '<div class="ocr-stage-pill" id="stage-pill-3">' +
              '<span class="stage-pill-dot"></span>' +
              '<span>3. Layout &amp; Reading Order</span>' +
            '</div>' +
            '<div class="ocr-stage-pill" id="stage-pill-4">' +
              '<span class="stage-pill-dot"></span>' +
              '<span>4. Orthography &amp; Quality QA</span>' +
            '</div>' +
          '</div>' +
          '<div class="ocr-skeleton-lines">' +
            '<div class="skeleton-line long"></div>' +
            '<div class="skeleton-line med"></div>' +
            '<div class="skeleton-line long"></div>' +
            '<div class="skeleton-line short"></div>' +
          '</div>' +
          '<div class="ocr-privacy-note text-muted" style="margin-top:16px;font-size:11px;display:flex;align-items:center;gap:6px;">' +
            _getIcon('shield-check', 'text-success ui-icon-xs') + ' Zero cloud transmission — all compute executed on-device in WebAssembly' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function showInitialProcessing(pageNum, totalPages) {
    _currentPageNum = pageNum || 1;
    _updatePageIndicator(totalPages);

    var viewport = el('scan-viewport');
    if (viewport) {
      _removeScanningOverlays();
      var ph = document.createElement('div');
      ph.className = 'viewport-placeholder';
      ph.innerHTML =
        '<div class="spinner" style="width:36px;height:36px;border-width:3px;"></div>' +
        '<div class="processing-title">Starting OCR Engine...</div>' +
        '<div class="processing-sub">Rasterizing Page ' + _currentPageNum + ' of ' + (totalPages || 1) + ' at 200 DPI</div>';
      viewport.appendChild(ph);
    }

    var editor = el('text-editor');
    if (editor) {
      editor.innerHTML = _renderProcessingEditorHTML(_currentPageNum, totalPages, 'Initializing client-side OCR pipeline...');
    }
  }

  function showProcessingScan(pageNum, blob, totalPages) {
    _currentPageNum = pageNum || 1;
    _updatePageIndicator(totalPages);

    // Render canvas with page image immediately so user sees their document
    if (blob) {
      _renderCanvas(blob);
    }

    var viewport = el('scan-viewport');
    if (viewport) {
      // Remove any prior overlays
      var existingOverlay = viewport.querySelector('.scan-processing-overlay');
      if (existingOverlay) existingOverlay.remove();
      var existingHud = viewport.querySelector('.scan-processing-hud');
      if (existingHud) existingHud.remove();

      // Laser beam animation overlay
      var beamOverlay = document.createElement('div');
      beamOverlay.className = 'scan-processing-overlay';
      beamOverlay.innerHTML = '<div class="scanner-laser-beam"></div>';
      viewport.appendChild(beamOverlay);

      // Scanning HUD badge
      var hud = document.createElement('div');
      hud.className = 'scan-processing-hud';
      hud.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div><span>Scanning Page ' + _currentPageNum + '... Extracting text</span>';
      viewport.appendChild(hud);
    }

    // Populate active status in text editor if not already rendered
    var editor = el('text-editor');
    if (editor && !editor.querySelector('.ocr-processing-card')) {
      editor.innerHTML = _renderProcessingEditorHTML(_currentPageNum, totalPages, 'Applying Sauvola adaptive binarization...');
    }
  }

  function showProcessingError(pageNum, errorMessage) {
    _currentPageNum = pageNum || 1;
    var viewport = el('scan-viewport');
    if (viewport) {
      _removeScanningOverlays();
      var ph = document.createElement('div');
      ph.className = 'viewport-placeholder';
      ph.innerHTML =
        '<div style="color:var(--danger);margin-bottom:8px;">' + _getIcon('alert-triangle', 'text-danger ui-icon-lg') + '</div>' +
        '<div class="processing-title" style="color:var(--danger);">Error Processing Page ' + pageNum + '</div>' +
        '<div class="processing-sub" style="max-width:340px;text-align:center;margin:8px auto;line-height:1.5;">' + _escHtml(errorMessage) + '</div>';
      viewport.appendChild(ph);
    }
    var editor = el('text-editor');
    if (editor) {
      editor.innerHTML =
        '<div class="ocr-active-processing-container">' +
          '<div class="ocr-processing-card" style="border-color:var(--danger);">' +
            '<div class="ocr-processing-header">' +
              '<span class="text-danger">' + _getIcon('alert-triangle', 'ui-icon-sm') + '</span>' +
              '<div class="ocr-processing-title" style="color:var(--danger);">Page ' + pageNum + ' Rasterization Failed</div>' +
            '</div>' +
            '<div class="ocr-page-status text-danger" style="margin-top:6px;">' + _escHtml(errorMessage) + '</div>' +
            '<p class="text-muted" style="margin-top:10px;font-size:12px;line-height:1.5;">' +
              'The document rasterizer encountered an issue on this page. If this PDF has password protection, non-standard embedded fonts, or damaged streams, try re-saving it or converting pages to high-resolution JPEG/PNG images.' +
            '</p>' +
          '</div>' +
        '</div>';
    }
  }

  function updateStage(pageNum, stageName, result) {
    var statusText = el('ocr-active-status-text');
    var p1 = el('stage-pill-1');
    var p2 = el('stage-pill-2');
    var p3 = el('stage-pill-3');
    var p4 = el('stage-pill-4');

    if (stageName === 'preprocessing') {
      if (p1) { p1.classList.remove('active'); p1.classList.add('done'); }
      if (p2) { p2.classList.add('active'); }
      if (statusText) statusText.textContent = 'Preprocessing complete. Recognizing Indic text with Tesseract LSTM...';
    } else if (stageName === 'ocr') {
      if (p2) { p2.classList.remove('active'); p2.classList.add('done'); }
      if (p3) { p3.classList.add('active'); }
      var count = result && result.wordCount ? result.wordCount : 0;
      if (statusText) statusText.textContent = 'Recognized ' + count + ' words. Detecting layout and column structure...';
    } else if (stageName === 'layout') {
      if (p3) { p3.classList.remove('active'); p3.classList.add('done'); }
      if (p4) { p4.classList.add('active'); }
      if (statusText) statusText.textContent = 'Layout detected. Cross-validating orthography & generating diffs...';
    } else if (stageName === 'correction' || stageName === 'qa') {
      if (p4) { p4.classList.remove('active'); p4.classList.add('done'); }
      if (statusText) statusText.textContent = 'Finalizing page QA and confidence calibration...';
    }
  }

  /* ── AI & Accuracy Indicator Badges ── */

  function _updateBadges(pageData) {
    var aiBadge = el('page-source-badge');
    var accBadge = el('page-accuracy-badge');

    // 1. Determine AI Usage Status
    var aiStatus = 'none'; // 'none' | 'proofread' | 'vision'
    var aiDiffCount = 0;
    if (pageData && pageData.blocks) {
      pageData.blocks.forEach(function (b) {
        if (b.source === 'gemini_vision') aiStatus = 'vision';
        if (b.diffs) {
          b.diffs.forEach(function (d) {
            if (d.status === 'accepted') aiDiffCount++;
          });
        }
      });
      if (aiStatus !== 'vision' && aiDiffCount > 0) {
        aiStatus = 'proofread';
      }
    }

    if (aiBadge) {
      if (aiStatus === 'vision') {
        aiBadge.className = 'toolbar-pill-badge gemini-vision';
        aiBadge.innerHTML = '<span class="badge-dot dot-purple"></span><span id="source-text">Gemini Vision AI</span>';
        aiBadge.title = 'AI Status: Gemini Vision Multimodal Transcription';
      } else if (aiStatus === 'proofread') {
        aiBadge.className = 'toolbar-pill-badge ai-corrected';
        aiBadge.innerHTML = '<span class="badge-dot dot-green"></span><span id="source-text">AI Proofread (' + aiDiffCount + ' applied)</span>';
        aiBadge.title = 'AI Status: AI Proofread suggestions active';
      } else {
        aiBadge.className = 'toolbar-pill-badge normal';
        aiBadge.innerHTML = '<span class="badge-dot dot-gray"></span><span id="source-text">No AI (Raw OCR)</span>';
        aiBadge.title = 'AI Status: 100% On-Device OCR (No Cloud AI Used)';
      }
    }

    // 2. Determine Accuracy
    if (!pageData) {
      if (accBadge) {
        accBadge.className = 'toolbar-pill-badge normal';
        accBadge.innerHTML = '<span class="badge-dot dot-gray"></span><span id="accuracy-text">Analyzing...</span>';
        accBadge.title = 'OCR confidence analyzing';
      }
      return;
    }

    var conf = typeof pageData.confidence === 'number' ? pageData.confidence : 0.88;
    var confPct = Math.round(conf * 100);
    var confClass = confPct >= 88 ? 'conf-high' : (confPct >= 70 ? 'conf-mid' : 'conf-low');
    var confLabel = confPct >= 88 ? 'High' : (confPct >= 70 ? 'Moderate' : 'Low');

    if (accBadge) {
      accBadge.className = 'toolbar-pill-badge ' + confClass;
      accBadge.innerHTML = '<span class="badge-dot dot-' + (confClass === 'conf-high' ? 'green' : (confClass === 'conf-mid' ? 'amber' : 'red')) + '</span><span id="accuracy-text">' + confPct + '% ' + confLabel + '</span>';
      accBadge.title = 'Accuracy: ' + confPct + '% (' + confLabel + '). Click for details & AI guidance.';
    }

    _renderGuidancePopupContent(confPct, confClass, confLabel, aiStatus, aiDiffCount);
  }

  function _renderGuidancePopupContent(confPct, confClass, confLabel, aiStatus, aiDiffCount) {
    var body = el('guidance-popup-body');
    if (!body) return;

    var dotColor = confClass === 'conf-high' ? 'var(--success)' : (confClass === 'conf-mid' ? 'var(--warning)' : 'var(--danger)');
    var aiText = aiStatus === 'vision' ? 'Gemini Vision AI Used' : (aiStatus === 'proofread' ? 'AI Proofread Applied (' + aiDiffCount + ' diffs)' : 'No AI Used (Raw On-Device OCR)');

    var html =
      '<div class="guidance-metric-row">' +
        '<div>' +
          '<div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;">Page Confidence</div>' +
          '<div style="font-size:18px;font-weight:700;color:' + dotColor + ';">' + confPct + '% <span style="font-size:12px;font-weight:500;">(' + confLabel + ')</span></div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;">AI Status</div>' +
          '<div style="font-size:12px;font-weight:600;color:var(--text-primary);">' + aiText + '</div>' +
        '</div>' +
      '</div>';

    if (confClass === 'conf-low' || confClass === 'conf-mid') {
      if (aiStatus === 'none') {
        html +=
          '<div class="guidance-box guidance-boost">' +
            '<div class="guidance-title"><svg class="ui-icon ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg> Accuracy Low: Boost with AI</div>' +
            '<p style="margin:4px 0 10px 0;">Normal on-device OCR has some uncertain characters or orphaned matras. You can automatically boost accuracy using Gemini AI:</p>' +
            '<div class="guidance-actions">' +
              '<button class="btn-primary btn-sm" id="btn-popup-proofread" style="padding:6px 12px;font-size:12px;cursor:pointer;">⚡ Run AI Proofread</button>' +
              '<button class="btn-secondary btn-sm" id="btn-popup-vision" style="padding:6px 12px;font-size:12px;cursor:pointer;">✨ Try Gemini Vision</button>' +
            '</div>' +
          '</div>';
      } else {
        html +=
          '<div class="guidance-box guidance-warning">' +
            '<div class="guidance-title"><svg class="ui-icon ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Accuracy Still Low After AI? What to do:</div>' +
            '<ol class="guidance-list">' +
              '<li><strong>Check Scan Resolution:</strong> Low DPI (&lt; 150 DPI) or blurry phone photos lose fine Indic ligatures. Re-scan at 200–300 DPI.</li>' +
              '<li><strong>Verify Selected Language:</strong> Ensure the primary language matches your document script (e.g., Hindi vs Marathi vs Sanskrit).</li>' +
              '<li><strong>Lighting &amp; Contrast:</strong> Dark shadows or folded paper degrade character recognition.</li>' +
              '<li><strong>Direct In-Place Editing:</strong> You can click directly into any text block on the right pane to fix characters manually.</li>' +
            '</ol>' +
          '</div>';
      }
    } else {
      html +=
        '<div class="guidance-box guidance-success">' +
          '<div class="guidance-title"><svg class="ui-icon ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> High Quality OCR Verified</div>' +
          '<p style="margin:4px 0 0 0;">Characters and reading order were recognized with high confidence. Document is ready for PDF, DOCX, or Text export.</p>' +
        '</div>';
    }

    body.innerHTML = html;

    var btnProofread = el('btn-popup-proofread');
    if (btnProofread) {
      btnProofread.addEventListener('click', function () {
        var topBtn = el('btn-gemini-proofread');
        if (topBtn) topBtn.click();
        var pop = el('accuracy-guidance-popup');
        if (pop) pop.classList.add('hidden');
      });
    }
    var btnVision = el('btn-popup-vision');
    if (btnVision) {
      btnVision.addEventListener('click', function () {
        var topBtn = el('btn-gemini-vision');
        if (topBtn) topBtn.click();
        var pop = el('accuracy-guidance-popup');
        if (pop) pop.classList.add('hidden');
      });
    }
  }

  function _wireGuidancePopup() {
    var accBadge = el('page-accuracy-badge');
    var aiBadge = el('page-source-badge');
    var guidancePopup = el('accuracy-guidance-popup');
    var btnCloseGuidance = el('btn-close-guidance');

    function toggleGuidance(e) {
      if (e) e.stopPropagation();
      if (guidancePopup) guidancePopup.classList.toggle('hidden');
    }

    if (accBadge && !accBadge._wiredGuidance) {
      accBadge._wiredGuidance = true;
      accBadge.addEventListener('click', toggleGuidance);
    }
    if (aiBadge && !aiBadge._wiredGuidance) {
      aiBadge._wiredGuidance = true;
      aiBadge.addEventListener('click', toggleGuidance);
    }
    if (btnCloseGuidance) {
      btnCloseGuidance.addEventListener('click', function (e) {
        e.stopPropagation();
        if (guidancePopup) guidancePopup.classList.add('hidden');
      });
    }
    document.addEventListener('click', function (e) {
      if (guidancePopup && !guidancePopup.contains(e.target) && e.target !== accBadge && e.target !== aiBadge) {
        guidancePopup.classList.add('hidden');
      }
    });
  }

  /* ── Diff Drawer ── */

  function _renderDiffDrawer(pageData) {
    var list = el('diff-list');
    if (!list) return;
    list.innerHTML = '';

    if (!pageData || !pageData.blocks) {
      list.innerHTML = _emptyDiffHTML('No page data');
      return;
    }

    var allDiffs = [];
    pageData.blocks.forEach(function (block) {
      if (!block.diffs) return;
      block.diffs.forEach(function (diff) {
        if (diff.status === 'proposed') {
          allDiffs.push({ diff: diff, blockId: block.block_id });
        }
      });
    });

    if (allDiffs.length === 0) {
      list.innerHTML =
        '<div class="diff-empty-state">' +
        '<div class="diff-empty-icon">' + _getIcon('check-circle', 'text-success ui-icon-xl') + '</div>' +
        '<div>No pending suggestions</div>' +
        '</div>';
      return;
    }

    _updateDiffBadge(allDiffs.length);

    allDiffs.forEach(function (entry) {
      var diff    = entry.diff;
      var blockId = entry.blockId;
      var item    = document.createElement('div');
      item.className       = 'diff-item';
      item.dataset.diffId  = diff.diff_id  || '';
      item.dataset.blockId = blockId;

      var gainText = diff.confidence_gain != null
        ? '+' + (diff.confidence_gain * 100).toFixed(0) + '%'
        : 'n/a';

      item.innerHTML =
        '<div class="diff-original">'  + _escHtml(diff.original  || '') + '</div>' +
        '<div class="diff-arrow">→</div>' +
        '<div class="diff-suggested">' + _escHtml(diff.suggested || '') + '</div>' +
        '<div class="diff-reason">'    + _escHtml(diff.reason    || '') + '</div>' +
        '<div class="diff-meta">Source: ' + _escHtml(diff.source || 'ai') +
          ' | Gain: ' + gainText + '</div>' +
        '<div class="diff-actions">' +
          '<button class="btn-success btn-accept-diff btn-sm">' + _getIcon('check', '', 14) + ' Accept</button>' +
          '<button class="btn-danger btn-reject-diff btn-sm">' + _getIcon('x', '', 14) + ' Reject</button>' +
        '</div>';

      item.querySelector('.btn-accept-diff').addEventListener('click', function () { module.acceptDiff(blockId, diff.diff_id); });
      item.querySelector('.btn-reject-diff').addEventListener('click', function () { module.rejectDiff(blockId, diff.diff_id); });

      list.appendChild(item);
    });
  }

  function _emptyDiffHTML(msg) {
    return '<div class="diff-empty-state"><div class="diff-empty-icon">' + _getIcon('git-diff', 'text-muted ui-icon-xl') + '</div><div>' + _escHtml(msg) + '</div></div>';
  }

  function _updateDiffBadge(count) {
    var badge = document.querySelector('.diff-count-badge');
    if (badge) { badge.textContent = count > 0 ? count : ''; badge.style.display = count > 0 ? '' : 'none'; }
  }

  function _refreshBlockInEditor(block) {
    var editor = el('text-editor');
    if (!editor) return;
    var blockDiv = editor.querySelector('.text-block[data-block-id="' + block.block_id + '"]');
    if (!blockDiv) return;
    var cd = blockDiv.querySelector('.block-content');
    if (cd) cd.textContent = _getActiveText(block);
    var badge    = blockDiv.querySelector('.source-badge');
    if (badge) {
      var accepted = _countAcceptedDiffs(block);
      if (block.source === 'gemini_vision') {
        badge.className   = 'source-badge gemini-vision';
        badge.textContent = 'Gemini Vision';
      } else if (accepted > 0) {
        badge.className   = 'source-badge ai-corrected';
        badge.textContent = 'AI-Corrected (' + accepted + ' applied)';
      } else {
        badge.className   = 'source-badge normal';
        badge.textContent = 'Normal (Raw OCR)';
      }
    }
  }

  function _markDiffItemInDrawer(diffId, status) {
    var list = el('diff-list');
    if (!list) return;
    var item = list.querySelector('.diff-item[data-diff-id="' + diffId + '"]');
    if (!item) return;
    item.classList.add('diff-' + status);
    var actions = item.querySelector('.diff-actions');
    if (actions) {
      actions.innerHTML = '<span class="text-muted text-sm">' +
        (status === 'accepted' ? _getIcon('check', 'text-success', 14) + ' Accepted' : _getIcon('x', 'text-danger', 14) + ' Rejected') + '</span>';
    }
  }

  function _escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _wireDiffDrawerButtons() {
    var btnOpen   = el('btn-open-diff-drawer');
    var btnClose  = el('btn-close-diff-drawer');
    var btnAccAll = el('btn-accept-all-diffs');
    var btnRejAll = el('btn-reject-all-diffs');

    if (btnOpen)   btnOpen.addEventListener('click',   function () { module.openDiffDrawer(); });
    if (btnClose)  btnClose.addEventListener('click',  function () { module.closeDiffDrawer(); });
    if (btnAccAll) btnAccAll.addEventListener('click', function () { module.acceptAllDiffs(); });
    if (btnRejAll) btnRejAll.addEventListener('click', function () { module.rejectAllDiffs(); });

    var btnProofread  = el('btn-ai-proofread');
    var btnVisionScan = el('btn-vision-rescan');
    if (btnProofread)  btnProofread.addEventListener('click',  function () { var b = el('btn-gemini-proofread'); if (b) b.click(); });
    if (btnVisionScan) btnVisionScan.addEventListener('click', function () { var b = el('btn-gemini-vision'); if (b) b.click(); });

    var btnPrev = el('btn-prev-page');
    var btnNext = el('btn-next-page');
    if (btnPrev) btnPrev.addEventListener('click', function () { _navigatePage(-1); });
    if (btnNext) btnNext.addEventListener('click', function () { _navigatePage(1); });
  }

  /* ── Gemini actions ── */

  async function _runProofreadSelected() {
    if (!_currentPageData || !_currentPageData.blocks) return;
    var editor     = el('text-editor');
    var selectedEl = editor && editor.querySelector('.text-block.selected');
    var blockId    = selectedEl ? selectedEl.dataset.blockId : null;
    var blocks     = blockId
      ? _currentPageData.blocks.filter(function (b) { return b.block_id === blockId; })
      : _currentPageData.blocks;
    if (!blocks.length) return;
    var lang = (_currentDoc && _currentDoc.primary_language) || 'hi';
    for (var i = 0; i < blocks.length; i++) {
      try {
        var diffs = await window.OCRStudio.GeminiService.proofreadBlock(blocks[i], lang);
        if (diffs && diffs.length > 0) blocks[i].diffs = (blocks[i].diffs || []).concat(diffs);
      } catch (err) { console.error('[ReviewStudio] proofreadBlock error:', err); }
    }
    _renderDiffDrawer(_currentPageData);
    module.openDiffDrawer();
    if (typeof _onDiffActionCallback === 'function') _onDiffActionCallback({ type: 'proofread' });
  }

  async function _runVisionRescan() {
    var canvas = el('scan-canvas');
    if (!canvas || !_currentDoc) return;
    var lang = (_currentDoc && _currentDoc.primary_language) || 'hi';
    try {
      var text = await window.OCRStudio.GeminiService.visionOCRPage(canvas, lang);
      if (text && _currentPageData && _currentPageData.blocks && _currentPageData.blocks[0]) {
        var block = _currentPageData.blocks[0];
        block.source      = 'gemini_vision';
        block.active_text = text;
        _refreshBlockInEditor(block);
        _updateBadges(_currentPageData);
      }
      if (typeof _onDiffActionCallback === 'function') _onDiffActionCallback({ type: 'vision_rescan' });
    } catch (err) { console.error('[ReviewStudio] visionOCRPage error:', err); }
  }

  /* ── Public API ── */
  var module = {

    get _currentDoc()       { return _currentDoc; },
    get _currentSessionId() { return _currentSessionId; },
    get _currentPageNum()   { return _currentPageNum; },
    get _currentPageData()  { return _currentPageData; },
    get _panState()         { return _panState; },
    get _zoomState()        { return _zoomState; },
    get _handToolActive()   { return _handToolActive; },

    init: function (doc, sessionId) {
      _currentDoc       = doc;
      _currentSessionId = sessionId;
      _currentPageNum   = 1;
      _currentPageData  = null;
      _setupPanZoom();
      _wireDiffDrawerButtons();
      _wireGuidancePopup();
      _updateBadges(null);
      _updatePageIndicator();
    },

    loadPage: async function (pageNum) {
      _currentPageNum = pageNum;
      _updatePageIndicator();
      _removeScanningOverlays();

      var viewport = el('scan-viewport');
      if (viewport) {
        var existing = viewport.querySelector('.viewport-placeholder');
        if (existing) existing.remove();
        var ph = document.createElement('div');
        ph.className = 'viewport-placeholder';
        ph.innerHTML = '<div class="spinner"></div><div>Loading page ' + pageNum + '...</div>';
        viewport.appendChild(ph);
      }

      var blobPromise = window.OCRStudio.DB.getPageBlob(_currentSessionId, pageNum)
        .catch(function (e) { console.error('getPageBlob error', e); return null; });
      var dataPromise = window.OCRStudio.DB.getPageData(_currentSessionId, pageNum)
        .catch(function (e) { console.error('getPageData error', e); return null; });

      var blob     = await blobPromise;
      var pageData = await dataPromise;
      _currentPageData = pageData;

      if (viewport) {
        var ph2 = viewport.querySelector('.viewport-placeholder');
        if (ph2) ph2.remove();
      }

      _renderCanvas(blob);
      _renderBBoxOverlay(pageData);
      _renderTextEditor(pageData);
      _renderDiffDrawer(pageData);
      _updateBadges(pageData);
      _updatePageIndicator();
    },

    showInitialProcessing: showInitialProcessing,
    showProcessingScan:    showProcessingScan,
    showProcessingError:   showProcessingError,
    updateStage:           updateStage,

    refresh: function () {
      if (_currentPageData) {
        _renderBBoxOverlay(_currentPageData);
        _renderTextEditor(_currentPageData);
        _renderDiffDrawer(_currentPageData);
        _updateBadges(_currentPageData);
      }
    },

    _renderCanvas:      _renderCanvas,
    _renderBBoxOverlay: _renderBBoxOverlay,
    _renderTextEditor:  _renderTextEditor,
    _syncPanZoom:       _syncPanZoom,
    _setupPanZoom:      _setupPanZoom,
    fitPage:            _fitPage,
    zoom: function (factor) {
      _zoomState.scale = clamp(_zoomState.scale * factor, 0.2, 5.0);
      _syncPanZoom();
    },

    _highlightBBox: function (wordId) { _highlightBBox(wordId); },
    _scrollToBlock: function (blockId) { _scrollToBlock(blockId); },
    _renderDiffDrawer: function (pageData) { _renderDiffDrawer(pageData || _currentPageData); },

    openDiffDrawer:  function () { var d = el('diff-drawer'); if (d) { d.classList.remove('hidden'); d.classList.add('open'); } },
    closeDiffDrawer: function () { var d = el('diff-drawer'); if (d) { d.classList.remove('open'); d.classList.add('hidden'); } },

    acceptDiff: async function (blockId, diffId) {
      if (!_currentPageData) return;
      var block = _currentPageData.blocks &&
        _currentPageData.blocks.find(function (b) { return b.block_id === blockId; });
      if (!block) return;

      if (window.OCRStudio.CanonicalDoc &&
          typeof window.OCRStudio.CanonicalDoc.applyDiff === 'function') {
        window.OCRStudio.CanonicalDoc.applyDiff(block, diffId);
      } else {
        var diff = block.diffs && block.diffs.find(function (d) { return d.diff_id === diffId; });
        if (diff) { block.active_text = diff.suggested; diff.status = 'accepted'; }
      }

      _refreshBlockInEditor(block);
      _markDiffItemInDrawer(diffId, 'accepted');
      _updateBadges(_currentPageData);
      if (typeof _onDiffActionCallback === 'function') _onDiffActionCallback({ type: 'accept', blockId: blockId, diffId: diffId });
    },

    rejectDiff: async function (blockId, diffId) {
      if (!_currentPageData) return;
      var block = _currentPageData.blocks &&
        _currentPageData.blocks.find(function (b) { return b.block_id === blockId; });
      if (!block) return;

      if (window.OCRStudio.CanonicalDoc &&
          typeof window.OCRStudio.CanonicalDoc.revertDiff === 'function') {
        window.OCRStudio.CanonicalDoc.revertDiff(block, diffId);
      } else {
        var diff = block.diffs && block.diffs.find(function (d) { return d.diff_id === diffId; });
        if (diff) diff.status = 'rejected';
      }

      _refreshBlockInEditor(block);
      _markDiffItemInDrawer(diffId, 'rejected');
      _updateBadges(_currentPageData);
      if (typeof _onDiffActionCallback === 'function') _onDiffActionCallback({ type: 'reject', blockId: blockId, diffId: diffId });
    },

    acceptAllDiffs: async function () {
      if (!_currentPageData || !_currentPageData.blocks) return;
      for (var i = 0; i < _currentPageData.blocks.length; i++) {
        var block = _currentPageData.blocks[i];
        if (!block.diffs) continue;
        var proposed = block.diffs.filter(function (d) { return d.status === 'proposed'; });
        for (var j = 0; j < proposed.length; j++) await this.acceptDiff(block.block_id, proposed[j].diff_id);
      }
    },

    rejectAllDiffs: async function () {
      if (!_currentPageData || !_currentPageData.blocks) return;
      for (var i = 0; i < _currentPageData.blocks.length; i++) {
        var block = _currentPageData.blocks[i];
        if (!block.diffs) continue;
        var proposed = block.diffs.filter(function (d) { return d.status === 'proposed'; });
        for (var j = 0; j < proposed.length; j++) await this.rejectDiff(block.block_id, proposed[j].diff_id);
      }
    },

    onDiffAction: function (callback) { _onDiffActionCallback = callback; },

  };

  return module;

}());
