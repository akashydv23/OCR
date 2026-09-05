'use strict';

/**
 * JobProgress.js — Floating Job Progress & Telemetry Widget
 *
 * Provides real-time telemetry:
 *  - Page counter: "Page 14 of 250"
 *  - Live throughput: "2.4 pages/sec"
 *  - Dynamic ETA timer: "ETA: 1m 38s"
 *  - Progress bar with percentage
 *  - Pause, Resume, and Cancel controls
 *  - Partial download / export of already-completed pages
 *  - Collapsible minimized pill mode
 *
 * Exposes: window.OCRStudio.JobProgress
 */

window.OCRStudio = window.OCRStudio || {};

window.OCRStudio.JobProgress = (function () {

  var _totalPages = 0;
  var _currentPage = 0;
  var _startTime = null;
  var _isPaused = false;
  var _minimized = false;
  var _callbacks = {
    onPause: null,
    onResume: null,
    onCancel: null,
    onPartialExport: null
  };

  var _dom = {
    widget: null,
    title: null,
    btnMinimize: null,
    barFill: null,
    pageCount: null,
    throughput: null,
    eta: null,
    btnPauseResume: null,
    btnCancel: null,
    btnPartialExport: null
  };

  function _formatTime(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '—';
    var totalSec = Math.round(seconds);
    if (totalSec < 60) return totalSec + 's';
    var hrs = Math.floor(totalSec / 3600);
    var mins = Math.floor((totalSec % 3600) / 60);
    var secs = totalSec % 60;
    if (hrs > 0) return hrs + 'h ' + mins + 'm';
    return mins + 'm ' + secs + 's';
  }

  function _calcThroughput() {
    if (!_startTime || _currentPage <= 0) return 0;
    var elapsedSec = (Date.now() - _startTime) / 1000;
    if (elapsedSec <= 0.05) return 0;
    return _currentPage / elapsedSec;
  }

  function _calcETA() {
    var tp = _calcThroughput();
    if (tp <= 0 || _currentPage >= _totalPages) return 0;
    var remainingPages = _totalPages - _currentPage;
    return remainingPages / tp;
  }

  function init() {
    var existing = document.getElementById('job-progress');
    function getIcon(name) {
      if (window.OCRStudio && window.OCRStudio.Icons) {
        return window.OCRStudio.Icons.get(name, 'ui-icon-xs') + ' ';
      }
      return '';
    }

    if (!existing) {
      var container = document.createElement('div');
      container.id = 'job-progress';
      container.className = 'hidden';
      container.innerHTML =
        '<div id="job-progress-header">' +
          '<span id="job-title">Processing Document...</span>' +
          '<div class="job-progress-header-actions">' +
            '<button id="btn-minimize-progress" class="btn-icon" title="Minimize / Restore" aria-label="Minimize">—</button>' +
            '<button id="btn-close-progress" class="btn-icon" title="Dismiss" aria-label="Dismiss">✕</button>' +
          '</div>' +
        '</div>' +
        '<div id="job-progress-body">' +
          '<div id="progress-bar-track">' +
            '<div id="progress-bar-fill"></div>' +
          '</div>' +
          '<div id="progress-stats">' +
            '<span id="progress-page-count">Page 0 of 0</span>' +
            '<span id="progress-throughput">— pages/sec</span>' +
            '<span id="progress-eta">ETA: —</span>' +
          '</div>' +
          '<div id="progress-controls">' +
            '<button id="btn-pause-resume" class="btn-secondary">' + getIcon('pause') + 'Pause</button>' +
            '<button id="btn-cancel-job" class="btn-secondary">' + getIcon('x') + 'Cancel</button>' +
            '<button id="btn-partial-export" class="btn-secondary">' + getIcon('download') + 'Export So Far</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(container);
      existing = container;
    }

    _dom.widget = existing;
    _dom.title = document.getElementById('job-title');
    _dom.btnMinimize = document.getElementById('btn-minimize-progress');
    _dom.btnClose = document.getElementById('btn-close-progress');
    _dom.barFill = document.getElementById('progress-bar-fill');
    _dom.pageCount = document.getElementById('progress-page-count');
    _dom.throughput = document.getElementById('progress-throughput');
    _dom.eta = document.getElementById('progress-eta');
    _dom.btnPauseResume = document.getElementById('btn-pause-resume');
    _dom.btnCancel = document.getElementById('btn-cancel-job');
    _dom.btnPartialExport = document.getElementById('btn-partial-export');

    if (_dom.btnMinimize) {
      _dom.btnMinimize.addEventListener('click', function (e) {
        e.stopPropagation();
        _minimized = !_minimized;
        _dom.widget.classList.toggle('minimized', _minimized);
        _dom.btnMinimize.textContent = _minimized ? '▢' : '—';
      });
    }

    if (_dom.btnClose) {
      _dom.btnClose.addEventListener('click', function (e) {
        e.stopPropagation();
        hide();
      });
    }

    if (_dom.btnPauseResume) {
      _dom.btnPauseResume.addEventListener('click', function () {
        if (_isPaused) {
          resume();
          if (typeof _callbacks.onResume === 'function') _callbacks.onResume();
        } else {
          pause();
          if (typeof _callbacks.onPause === 'function') _callbacks.onPause();
        }
      });
    }

    if (_dom.btnCancel) {
      _dom.btnCancel.addEventListener('click', function () {
        if (confirm('Are you sure you want to cancel the active OCR job?')) {
          if (typeof _callbacks.onCancel === 'function') _callbacks.onCancel();
          hide();
        }
      });
    }

    if (_dom.btnPartialExport) {
      _dom.btnPartialExport.addEventListener('click', function () {
        if (typeof _callbacks.onPartialExport === 'function') {
          _callbacks.onPartialExport(_currentPage);
        }
      });
    }
  }

  function show(totalPages, title) {
    if (!_dom.widget) init();
    _totalPages = totalPages || 0;
    _currentPage = 0;
    _startTime = Date.now();
    _isPaused = false;
    _minimized = false;

    var iconPause = window.OCRStudio && window.OCRStudio.Icons ? window.OCRStudio.Icons.get('pause', 'ui-icon-xs') + ' ' : '';

    if (_dom.title) _dom.title.textContent = title || 'Processing Document...';
    if (_dom.barFill) _dom.barFill.style.width = '0%';
    if (_dom.pageCount) _dom.pageCount.textContent = 'Page 0 of ' + _totalPages;
    if (_dom.throughput) _dom.throughput.textContent = '— pages/sec';
    if (_dom.eta) _dom.eta.textContent = 'ETA: calculating...';
    if (_dom.btnPauseResume) _dom.btnPauseResume.innerHTML = iconPause + 'Pause';

    _dom.widget.classList.remove('minimized');
    _dom.widget.classList.remove('hidden');
  }

  function hide() {
    if (_dom.widget) {
      _dom.widget.classList.add('hidden');
    }
  }

  function update(currentPage) {
    if (!_dom.widget) return;
    _dom.widget.classList.remove('hidden');
    _currentPage = currentPage;

    var pct = _totalPages > 0 ? Math.min(100, Math.round((_currentPage / _totalPages) * 100)) : 0;
    if (_dom.barFill) _dom.barFill.style.width = pct + '%';
    if (_dom.pageCount) _dom.pageCount.textContent = 'Page ' + _currentPage + ' of ' + _totalPages;

    var tp = _calcThroughput();
    if (_dom.throughput) {
      _dom.throughput.textContent = tp > 0 ? tp.toFixed(1) + ' pages/sec' : '— pages/sec';
    }

    var etaSec = _calcETA();
    if (_dom.eta) {
      _dom.eta.textContent = 'ETA: ' + _formatTime(etaSec);
    }
  }

  function setPageProcessing(pageNum, detail) {
    if (!_dom.widget) return;
    _dom.widget.classList.remove('hidden');
    if (_dom.pageCount) {
      _dom.pageCount.textContent = 'Processing Page ' + pageNum + ' of ' + _totalPages;
    }
    if (detail && _dom.eta) {
      _dom.eta.textContent = detail;
    }
  }

  function complete(message) {
    if (!_dom.widget) return;
    _currentPage = _totalPages;
    if (_dom.barFill) _dom.barFill.style.width = '100%';
    if (_dom.pageCount) _dom.pageCount.textContent = 'All ' + _totalPages + ' page(s) ready';
    if (_dom.eta) _dom.eta.textContent = 'Complete';
    if (_dom.throughput) _dom.throughput.textContent = 'Done';
    if (_dom.title) _dom.title.textContent = message || '✓ OCR Processing Complete';
    if (_dom.btnPauseResume) {
      _dom.btnPauseResume.style.display = '';
      _dom.btnPauseResume.innerHTML = 'Dismiss';
      _dom.btnPauseResume.onclick = function () { hide(); };
    }
    if (_dom.btnCancel) _dom.btnCancel.style.display = 'none';

    // Auto-dismiss completed widget after 3.2s so it does not block the document view
    setTimeout(function () {
      if (_dom.widget && !_dom.widget.classList.contains('hidden')) {
        hide();
      }
    }, 3200);
  }

  function pause() {
    _isPaused = true;
    if (_dom.btnPauseResume) {
      var iconPlay = window.OCRStudio && window.OCRStudio.Icons ? window.OCRStudio.Icons.get('play', 'ui-icon-xs') + ' ' : '';
      _dom.btnPauseResume.innerHTML = iconPlay + 'Resume';
    }
    if (_dom.eta) {
      _dom.eta.textContent = 'ETA: Paused';
    }
  }

  function resume() {
    _isPaused = false;
    if (_dom.btnPauseResume) {
      var iconPause = window.OCRStudio && window.OCRStudio.Icons ? window.OCRStudio.Icons.get('pause', 'ui-icon-xs') + ' ' : '';
      _dom.btnPauseResume.innerHTML = iconPause + 'Pause';
    }
    if (_dom.eta) {
      _dom.eta.textContent = 'ETA: Resuming...';
    }
  }

  function onPause(cb) { _callbacks.onPause = cb; }
  function onResume(cb) { _callbacks.onResume = cb; }
  function onCancel(cb) { _callbacks.onCancel = cb; }
  function onPartialExport(cb) { _callbacks.onPartialExport = cb; }

  return {
    init: init,
    show: show,
    hide: hide,
    update: update,
    setPageProcessing: setPageProcessing,
    complete: complete,
    pause: pause,
    resume: resume,
    _formatTime: _formatTime,
    _calcThroughput: _calcThroughput,
    _calcETA: _calcETA,
    onPause: onPause,
    onResume: onResume,
    onCancel: onCancel,
    onPartialExport: onPartialExport
  };

})();
