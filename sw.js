// ShopEase service worker.
// It only touches files of this website. Supabase, the CDN scripts and the fonts are never cached,
// so money / stock / khata data always comes live from the database (never an old copy).
// Everything is network first (a new upload shows up at once). If the net is down, a page shows the
// "Internet nahi hai" screen (the dashboard cannot work without the database anyway).
const CACHE = "shopease-v1";
const OFFLINE_URL = "./offline.html";

const SHELL = [
  "./offline.html",
  "./assets/style.css",
  "./assets/dashboard.css",
  "./assets/calculator.css",
  "./assets/sales-report.css",
  "./assets/app.js",
  "./assets/dashboard.js",
  "./assets/calculator.js",
  "./assets/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // add one by one: a file that does not exist (yet) must not break the install
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // database, CDN, fonts: browser handles them

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        if (req.mode === "navigate") return caches.match(OFFLINE_URL);
        return (await caches.match(req)) || Response.error();
      })
  );
});