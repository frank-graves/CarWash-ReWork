// public/sw.js
// Cache del shell. Firestore y Auth siempre van a red — esta app no
// promete offline real, solo arranque rápido en la tablet. Si la red
// cae, los repositorios muestran sus errores como siempre; el shell
// sigue visible.

const SHELL_CACHE = 'ecw-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Cross-origin (Firestore, Auth, cualquier CDN): la red decide.
  if (url.origin !== self.location.origin) return;

  // Solo GET: nada de cachear POST.
  if (request.method !== 'GET') return;

  const isMetadata =
    url.pathname === '/' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/favicon.svg';

  if (isMetadata) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(SHELL_CACHE)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Cualquier otra cosa mismo-origen: dejar pasar sin tocar.
});
