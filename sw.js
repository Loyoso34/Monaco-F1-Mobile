/* F1-27 Monaco Time Trial – service worker: network-first for the app code (updates appear on the
   next reload), cache-first for the vendored engine, icons and images (fast cold starts). */
const VERSION = 'v1.2.0';
const CACHE = 'monaco-tt-' + VERSION;
const CORE = ['./', './index.html', './manifest.webmanifest', './vendor/three/three.module.min.js',
  './vendor/three/addons/BufferGeometryUtils.js', './vendor/three/addons/RoomEnvironment.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('monaco-tt-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const immutable = url.pathname.includes('/vendor/') || url.pathname.includes('/icons/') || url.pathname.includes('/assets/');
  if (immutable) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; })));
  } else {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
  }
});
