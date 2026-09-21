/* Service worker: cache-first app shell so the tool works offline
   at training sites. Bump CACHE_VERSION when shipping changes. */
var CACHE_VERSION = "sbt-v5";
var SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/data.js",
  "./js/sync.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-180.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (c) {
      return c.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  // Only handle same-origin GETs; Supabase API calls and the CDN pass through.
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      // Serve from cache, refresh in the background (stale-while-revalidate)
      var fetched = fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(e.request, clone); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fetched;
    })
  );
});
