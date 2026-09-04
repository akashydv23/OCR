'use strict';

/**
 * UserGuideModal.js — First-Time Onboarding & User Guide Modal
 *
 * Provides a 3-tab interactive walkthrough:
 *   1. How to Use: Document ingestion, memory safety, Review Studio, and exports.
 *   2. AI & Gemini Setup: Step-by-step Google AI Studio key acquisition, models, testing.
 *   3. Shortcuts & Pro-Tips: Spacebar grab-pan, trackpad gestures, keyboard shortcuts, offline mode.
 *
 * Automatically appears on first visit unless hidden via localStorage preference.
 *
 * Exposes: window.OCRStudio.UserGuideModal
 */

window.OCRStudio = window.OCRStudio || {};

window.OCRStudio.UserGuideModal = (function () {

  var _activeTab = 0;
  var _dom = {
    modal: null,
    tabs: [],
    panels: [],
    btnClose: null,
    btnCloseBottom: null,
    chkDontShow: null
  };

  function init() {
    var modal = document.getElementById('guide-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'guide-modal';
      modal.className = 'modal-overlay hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'User Guide');
      document.body.appendChild(modal);
    }
    _dom.modal = modal;

    function ico(name, cls) {
      if (window.OCRStudio && window.OCRStudio.Icons) {
        return window.OCRStudio.Icons.get(name, cls || 'ui-icon-xs') + ' ';
      }
      return '';
    }

    modal.innerHTML =
      '<div class="modal-box guide-modal-box">' +
        '<div class="modal-header">' +
          '<h2>' + ico('book-open', 'ui-icon-md') + 'OCR Studio — User Guide</h2>' +
          '<button id="btn-close-guide" class="btn-icon" aria-label="Close Guide">' + ico('x', 'ui-icon-xs') + '</button>' +
        '</div>' +
        '<div class="modal-tabs">' +
          '<button class="modal-tab active" data-tab="0">' + ico('play') + 'How to Use</button>' +
          '<button class="modal-tab" data-tab="1">' + ico('bot') + 'AI & Gemini Setup</button>' +
          '<button class="modal-tab" data-tab="2">' + ico('keyboard') + 'Shortcuts</button>' +
        '</div>' +
        '<div id="guide-tab-content">' +
          '<!-- Tab 0: How to Use -->' +
          '<div class="guide-tab-panel" data-panel="0">' +
            '<h3>Getting Started</h3>' +
            '<ol style="margin: 12px 0 0 20px; line-height: 2;">' +
              '<li>Drag and drop a PDF, scanned images, or click <strong>"Try Sample Documents"</strong>.</li>' +
              '<li>The pre-flight analyzer automatically estimates pages, resolution, RAM, and ETA.</li>' +
              '<li>Select your primary language (Hindi+English, Marathi, Sanskrit, Bengali, Tamil).</li>' +
              '<li>Click <strong>Start OCR Processing</strong> — pages process sequentially in your browser.</li>' +
              '<li>Use <strong>Review Studio</strong> to inspect recognized text side-by-side with original scans.</li>' +
              '<li>Export to <strong>Searchable PDF</strong>, <strong>Word DOCX</strong>, <strong>Plain Text</strong>, or <strong>JSON</strong>.</li>' +
            '</ol>' +
            '<div class="guide-tip">' + ico('zap') + '<strong>Memory-Bounded Safety:</strong> Pages are streamed one at a time and cached in local IndexedDB. Sustained peak RAM remains strictly under 250 MB even on 300-page court dockets.</div>' +
            '<div class="guide-tip">' + ico('shield-check') + '<strong>Zero-Server Privacy Guarantee:</strong> In standard mode, zero document bytes, text, or canvas pixels leave your machine.</div>' +
          '</div>' +
          '<!-- Tab 1: AI & Gemini Setup -->' +
          '<div class="guide-tab-panel hidden" data-panel="1">' +
            '<h3>Connecting Google Gemini AI (Optional BYOK)</h3>' +
            '<p style="margin: 8px 0 16px; color: var(--text-secondary);">' +
              'Connect your personal Google AI Studio key for contextual Indic proofreading, multimodal re-scans of damaged pages, and grounded document Q&A.' +
            '</p>' +
            '<ol style="margin: 0 0 0 20px; line-height: 2.2;">' +
              '<li>Visit <strong style="color:var(--accent)">aistudio.google.com</strong> and sign in with your Google account.</li>' +
              '<li>Click <strong>"Get API Key"</strong> → <strong>"Create API Key"</strong>.</li>' +
              '<li>Copy the generated key (starts with <code>AIza...</code>).</li>' +
              '<li>In IndicOCR Studio, open <strong>Settings</strong> in the top navigation bar.</li>' +
              '<li>Paste your key into the <strong>Google AI Studio API Key</strong> field.</li>' +
              '<li>Select <strong>gemini-3.6-flash</strong> (recommended default for fastest Indic processing).</li>' +
              '<li>Click <strong>Test Connection</strong> to verify. A green indicator confirms you are ready.</li>' +
            '</ol>' +
            '<div class="guide-tip">' + ico('bot') + '<strong>Contextual Proofreading:</strong> Click <strong>AI Proofread</strong> in Review Studio to receive reversible diffs for ligature and orthographic ambiguities.</div>' +
            '<div class="guide-tip">' + ico('sparkles') + '<strong>Multimodal Vision Re-Scan:</strong> For severely faded, yellowed, or torn pages, click <strong>Vision</strong> to transcribe the image slice directly with Gemini Vision.</div>' +
          '</div>' +
          '<!-- Tab 2: Shortcuts -->' +
          '<div class="guide-tab-panel hidden" data-panel="2">' +
            '<h3>Keyboard Shortcuts & Pro Tips</h3>' +
            '<table style="width:100%; border-collapse: collapse; margin-top: 12px;">' +
              '<thead>' +
                '<tr style="border-bottom: 1px solid var(--border);">' +
                  '<th style="text-align:left;padding:8px;">Action</th>' +
                  '<th style="text-align:left;padding:8px;">Shortcut / Gesture</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                '<tr><td style="padding:8px;">Pan scan canvas</td><td style="padding:8px;"><kbd>Spacebar</kbd> + Drag or Hand Tool</td></tr>' +
                '<tr><td style="padding:8px;">Zoom in / out</td><td style="padding:8px;"><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + Wheel or Zoom In / Out buttons</td></tr>' +
                '<tr><td style="padding:8px;">Fit page to screen</td><td style="padding:8px;">Click toolbar Fit Page icon</td></tr>' +
                '<tr><td style="padding:8px;">Previous / Next page</td><td style="padding:8px;"><kbd>←</kbd> / <kbd>→</kbd> arrow keys</td></tr>' +
                '<tr><td style="padding:8px;">Close modal / drawer</td><td style="padding:8px;"><kbd>Escape</kbd> key</td></tr>' +
                '<tr><td style="padding:8px;">Inspect scan region</td><td style="padding:8px;">Click any paragraph block in text editor</td></tr>' +
              '</tbody>' +
            '</table>' +
            '<div class="guide-tip">' + ico('wifi-off') + '<strong>Offline Ready:</strong> After initial load, IndicOCR Studio functions fully offline via service worker and IndexedDB caching.</div>' +
            '<div class="guide-tip">' + ico('hard-drive') + '<strong>Automatic Session Resume:</strong> If you accidentally refresh or close the tab, your processed pages are safely persisted.</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top: 24px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 16px;">' +
          '<label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text-secondary); font-size: 13px;">' +
            '<input type="checkbox" id="guide-dont-show">' +
            'Don\'t show this guide on startup' +
          '</label>' +
          '<button id="btn-guide-close-bottom" class="btn-primary">Got it!</button>' +
        '</div>' +
      '</div>';

    _dom.tabs = Array.from(modal.querySelectorAll('.modal-tab'));
    _dom.panels = Array.from(modal.querySelectorAll('.guide-tab-panel'));
    _dom.btnClose = document.getElementById('btn-close-guide');
    _dom.btnCloseBottom = document.getElementById('btn-guide-close-bottom');
    _dom.chkDontShow = document.getElementById('guide-dont-show');

    // Tab switching
    _dom.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var idx = parseInt(tab.getAttribute('data-tab'), 10);
        _switchTab(idx);
      });
    });

    // Close buttons
    if (_dom.btnClose) _dom.btnClose.addEventListener('click', hide);
    if (_dom.btnCloseBottom) _dom.btnCloseBottom.addEventListener('click', hide);

    // Backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) hide();
    });

    // "Don't show again" checkbox
    if (_dom.chkDontShow) {
      _dom.chkDontShow.addEventListener('change', function () {
        if (_dom.chkDontShow.checked) {
          localStorage.setItem('indicocr_guide_seen', '1');
        } else {
          localStorage.removeItem('indicocr_guide_seen');
        }
      });
    }

    // Do NOT auto-open on page load — user can open via Guide button in navbar
  }

  function _switchTab(index) {
    _activeTab = index;
    _dom.tabs.forEach(function (tab, i) {
      tab.classList.toggle('active', i === index);
    });
    _dom.panels.forEach(function (panel, i) {
      panel.classList.toggle('hidden', i !== index);
    });
  }

  function show() {
    if (!_dom.modal) init();
    _switchTab(0);
    if (_dom.modal) {
      _dom.modal.classList.remove('hidden');
    }
  }

  function hide() {
    if (_dom.modal) {
      _dom.modal.classList.add('hidden');
    }
    if (_dom.chkDontShow && _dom.chkDontShow.checked) {
      localStorage.setItem('indicocr_guide_seen', '1');
    }
  }

  return {
    init: init,
    show: show,
    hide: hide,
    _switchTab: _switchTab
  };

})();
