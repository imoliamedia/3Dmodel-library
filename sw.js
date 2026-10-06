// Offline cache for the app shell. Bump VERSION when files change.
const VERSION = 'v1';
const CACHE = `model-library-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'icons/icon.svg',
  'i18n/nl.json',
  'i18n/en.json',
  'js/app.js',
  'js/db.js',
  'js/import.js',
  'js/loaders.js',
  'js/thumbs.js',
  'js/viewer.js',
  'js/backup.js',
  'js/i18n.js',
  'vendor/three/three.module.js',
  'vendor/three/three.core.js',
  'vendor/three/addons/loaders/STLLoader.js',
  'vendor/three/addons/loaders/OBJLoader.js',
  'vendor/three/addons/loaders/3MFLoader.js',
  'vendor/three/addons/controls/OrbitControls.js',
  'vendor/three/addons/utils/BufferGeometryUtils.js',
  'vendor/three/addons/libs/fflate.module.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
