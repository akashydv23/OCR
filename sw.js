/**
 * IndicOCR Studio v2 — Service Worker
 * Cache-first strategy for all app assets and CDN resources.
 * Enables full offline operation after first page load.
 */

'use strict';

const CACHE_VERSION = 'indicocr-v2-27.0.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;

// Local app assets to pre-cache on install
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/icons.js',
  './js/samples.js',
  './js/app.js',
  './js/canonical-doc.js',
  './js/db.js',
  './js/preflight.js',
  './js/page-streamer.js',
  './js/coordinator.js',
  './js/gemini-service.js',
  './js/agents/image-filters.js',
  './js/agents/layout-agent.js',
  './js/agents/script-id-agent.js',
  './js/agents/cross-validation-agent.js',
  './js/agents/correction-agent.js',
  './js/agents/qa-agent.js',
  './js/exporters/export-searchable-pdf.js',
  './js/exporters/export-docx.js',
  './js/exporters/export-txt.js',
  './js/exporters/export-json.js',
  './js/components/ReviewStudio.js',
  './js/components/JobProgress.js',
  './js/components/UserGuideModal.js',
  './tests/test-suite.js',
  './manifest.json',
];

// CDN resources to cache on first use (network-first on miss, then cache)
const CDN_ORIGINS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'tessdata.projectnaptha.com',
];

// ─── Install: Pre-cache all static assets ────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing IndicOCR Studio v2 service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Pre-cache failed (some assets may not exist yet):', err.message);
        // Don't fail install — assets will be cached on first request
        return self.skipWaiting();
      })
  );
});

// ─── Activate: Clean up old cache versions ───────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating IndicOCR Studio v2 service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('indicocr-') && name !== STATIC_CACHE && name !== CDN_CACHE)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: Cache-first for static, network-then-cache for CDN ───────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Gemini API calls (must go to network)
  if (url.hostname === 'generativelanguage.googleapis.com') {
    return; // Let the browser handle it normally
  }

  // Never intercept non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // CDN resources: network-first with cache fallback
  if (CDN_ORIGINS.some((origin) => url.hostname.includes(origin))) {
    event.respondWith(cdnStrategy(event.request));
    return;
  }

  // Static app assets: network-first with cache fallback (guarantees fresh code)
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }
});

/**
 * Network-first strategy for local app assets.
 * Always fetches fresh code from server first, then updates cache.
 * Falls back to cache only when offline.
 */
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request, { cache: 'no-cache' });
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response('App is offline and resource not cached.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

/**
 * Network-first strategy for CDN resources (Tesseract, PDF.js, etc.)
 * Falls back to cache on network failure (offline mode).
 * Caches fresh responses for future offline use.
 */
async function cdnStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CDN_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[SW] Serving from CDN cache (offline):', request.url);
      return cachedResponse;
    }
    return new Response('CDN resource unavailable offline.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}
