const CACHE_NAME = "evoting-v3-cache";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/college.html",
  "/admin.html",
  "/style.css",
  "/index.js",
  "/college.js",
  "/admin.js",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network-first strategy for API calls, Cache-first for static assets
  if (event.request.url.includes("/api/") || 
      event.request.url.includes("/register") || 
      event.request.url.includes("/verify-otp") ||
      event.request.url.includes("/stats") ||
      event.request.url.includes("/results") ||
      event.request.url.includes("/parties") ||
      event.request.url.includes("/cast-vote")) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});
