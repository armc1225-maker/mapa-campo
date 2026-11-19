// Mapa de Campo — funciona sin internet: guarda la app, sus librerías y las teselas del mapa base que ya se vieron.
const CACHE = 'mapa-campo-v2';
const TILES = 'mapa-campo-teselas';
const MAX_TILES = 8000; // ~ 150-250 MB según la zona
const SHELL = [
  './', 'index.html', 'app.js', 'geo.js', 'manifest.webmanifest', 'icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
let puts = 0;
async function trimTiles() {
  const c = await caches.open(TILES), keys = await c.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES + 500).map(k => c.delete(k)));
}
async function tile(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req, { ignoreVary: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.type !== 'opaque') {
    await c.put(req, r.clone());
    if (++puts % 100 === 0) trimTiles();
  }
  return r;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(n => {
      const c = n.clone(); caches.open(CACHE).then(k => k.put(req, c)); return n;
    })));
  } else if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(tile(req).catch(() => new Response('', { status: 504 })));
  }
});
