/* Mapa de Campo — interfaz. Depende de Leaflet, pdf.js y geo.js */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
// Dentro de la APK (Capacitor) se usan los plugins nativos para compartir archivos.
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
async function nativeShare(file) {
  try {
    const { Filesystem, Share } = Capacitor.Plugins;
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
    const w = await Filesystem.writeFile({ path: file.name, data, directory: 'CACHE' });
    await Share.share({ title: file.name, files: [w.uri], dialogTitle: 'Enviar ' + file.name });
  } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('No se pudo compartir: ' + (e.message || e)); }
}

// ---------- Iconos ----------
const P = {
  locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  point: '<path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  track: '<path d="M4 19c3-1 3-6 7-6s4 5 9 1"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="14" r="1.5"/>',
  line: '<path d="M4 20L20 4"/><path d="M4 16v4h4M20 8V4h-4"/>',
  area: '<path d="M5 7l7-4 7 5-2 11H7z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  gps: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  pin: '<path d="M12 2v8M8 10h8l-2 5h-4z"/><path d="M12 15v7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};
const ic = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

// ---------- Ajustes (preferencias por dispositivo) ----------
const settings = (() => {
  let s = { fmt: 'dd', labels: true, base: 'sat', opacity: 1 };
  try { Object.assign(s, JSON.parse(localStorage.getItem('mc-settings') || '{}')); } catch (e) { }
  return new Proxy(s, { set(o, k, v) { o[k] = v; try { localStorage.setItem('mc-settings', JSON.stringify(o)); } catch (e) { } return true; } });
})();

// ---------- IndexedDB ----------
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('mapa-campo', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('maps', { keyPath: 'id' });
      d.createObjectStore('features', { keyPath: 'id' }).createIndex('mapId', 'mapId');
      d.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Sin espacio de almacenamiento'));
    });
  };
  return {
    get: (st, id) => tx(st, 'readonly', s => s.get(id)),
    put: (st, v) => tx(st, 'readwrite', s => s.put(v)),
    del: (st, id) => tx(st, 'readwrite', s => s.delete(id)),
    all: st => tx(st, 'readonly', s => s.getAll()),
    byMap: id => tx('features', 'readonly', s => s.index('mapId').getAll(id)),
  };
})();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

// ---------- Utilidades de interfaz ----------
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(msg) { $('#busyMsg').textContent = msg || ''; $('#busy').classList.toggle('on', !!msg); }
let sheetEl = null, sheetClose = null;
function openSheet(html, onClose) {
  closeSheet();
  sheetEl = document.createElement('div');
  sheetEl.className = 'veil';
  sheetEl.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  sheetEl.addEventListener('click', e => { if (e.target === sheetEl) closeSheet(); });
  document.body.appendChild(sheetEl);
  sheetClose = onClose || null;
  const f = sheetEl.querySelector('input:not([type=file]),select,textarea,button');
  if (f && matchMedia('(pointer:fine)').matches) f.focus();
  return sheetEl.firstElementChild;
}
function closeSheet() {
  if (!sheetEl) return;
  sheetEl.remove(); sheetEl = null;
  const c = sheetClose; sheetClose = null; if (c) c();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
const urls = new Set();
function blobUrl(b) { const u = URL.createObjectURL(b); urls.add(u); return u; }
function revokeAll() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }
const canvasBlob = (c, q = 0.88) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
async function shrink(src, max) {
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return canvasBlob(c, 0.85);
}
const fmtDate = t => new Date(t).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDur = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':'); };

// ================= BIBLIOTECA =================
async function showLibrary() {
  stopGps();
  closeSheet();
  revokeAll();
  cur = null;
  show('lib');
  const base = await ensureBaseMap();
  const maps = (await DB.all('maps')).filter(m => m.id !== BASE_ID).sort((a, b) => b.created - a.created);
  const el = $('#maps');
  const counts = {};
  (await DB.all('features')).forEach(f => { counts[f.mapId] = (counts[f.mapId] || 0) + 1; });
  el.innerHTML = '';
  const bb = document.createElement('button');
  bb.className = 'mapcard';
  bb.innerHTML = `<span class="basethumb">${ic('globe')}</span>
    <div><b>${esc(base.name)}</b><small>Imagen satelital de todo el mundo · ${counts[BASE_ID] || 0} elementos</small>
    <span class="tag ok">Necesita internet la primera vez</span></div>`;
  bb.onclick = () => openMap(BASE_ID);
  el.appendChild(bb);
  if (!maps.length) {
    el.insertAdjacentHTML('beforeend', `<div class="empty" style="grid-column:1/-1;margin-top:16px"><h2>Aún no hay mapas importados</h2>
      <p>Importa un <b>GeoPDF</b> (PDF georreferenciado, por ejemplo exportado desde QGIS o ArcGIS): se coloca sobre la imagen satelital y la app ubica tu posición GPS sobre él, también sin internet.</p>
      <p>También puedes importar un PDF normal o una foto de un plano y georreferenciarlo con 2 o más puntos de coordenadas conocidas.</p></div>`);
    return;
  }
  for (const m of maps) {
    const thumb = m.thumbId ? await DB.get('blobs', m.thumbId) : null;
    const b = document.createElement('button');
    b.className = 'mapcard';
    b.innerHTML = `<img alt="" ${thumb ? `src="${blobUrl(thumb.blob)}"` : ''}>
      <div><b>${esc(m.name)}</b><small>${fmtDate(m.created)} · ${counts[m.id] || 0} elementos</small>
      ${m.georef ? `<span class="tag ok">Georreferenciado${m.georef.source === 'geopdf' ? ' (GeoPDF)' : ''}</span>` : '<span class="tag no">Sin georreferencia</span>'}</div>`;
    b.onclick = () => openMap(m.id);
    b.oncontextmenu = e => { e.preventDefault(); mapOptions(m); };
    el.appendChild(b);
  }
}

function mapOptions(m) {
  const s = openSheet(`<h2>${esc(m.name)}</h2><div class="menu">
    <button data-a="open">${ic('globe')}Abrir</button>
    <button data-a="ren">${ic('edit')}Cambiar nombre</button>
    <button data-a="del" style="color:var(--rec)">${ic('trash')}Eliminar mapa y sus elementos</button></div>`);
  s.querySelector('[data-a=open]').onclick = () => { closeSheet(); openMap(m.id); };
  s.querySelector('[data-a=ren]').onclick = async () => {
    const n = prompt('Nombre del mapa', m.name);
    if (n && n.trim()) { m.name = n.trim(); await DB.put('maps', m); }
    closeSheet(); if (cur) { cur.map = m; $('#mapName').textContent = m.name; } else showLibrary();
  };
  s.querySelector('[data-a=del]').onclick = async () => {
    if (!confirm(`¿Eliminar "${m.name}" con todos sus puntos, tracks, áreas y fotos? No se puede deshacer.`)) return;
    const feats = await DB.byMap(m.id);
    for (const f of feats) { for (const p of f.photos || []) await DB.del('blobs', p); await DB.del('features', f.id); }
    for (const b of [m.imageId, m.thumbId]) if (b) await DB.del('blobs', b);
    await DB.del('maps', m.id);
    closeSheet(); showLibrary();
  };
}

$('#btnImport').onclick = () => $('#fileMap').click();
$('#fileMap').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { const id = await importMap(f); await openMap(id); }
  catch (err) { console.error(err); busy(); toast('No se pudo importar: ' + (err.message || err), 5000); }
};

function choosePage(n) {
  return new Promise(res => {
    const s = openSheet(`<h2>El PDF tiene ${n} páginas</h2><label>Página que contiene el mapa
      <input type="number" id="pg" min="1" max="${n}" value="1" inputmode="numeric"></label>
      <button class="btn pri" id="ok" style="width:100%">Usar esta página</button>`, () => res(1));
    s.querySelector('#ok').onclick = () => { const v = Math.min(n, Math.max(1, parseInt(s.querySelector('#pg').value) || 1)); sheetClose = null; closeSheet(); res(v); };
  });
}

async function importMap(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const rec = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), created: Date.now(), kind: isPdf ? 'pdf' : 'image', georef: null };
  let imgBlob, w, h;
  if (isPdf) {
    if (!window.pdfjsLib) throw new Error('el lector de PDF no está disponible; abre la app una vez con internet.');
    busy('Leyendo PDF…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    busy();
    const pageNo = pdf.numPages > 1 ? await choosePage(pdf.numPages) : 1;
    busy('Dibujando el mapa en alta resolución…');
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4096 / Math.max(base.width, base.height), Math.sqrt(16e6 / (base.width * base.height)));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    imgBlob = await canvasBlob(c, 0.9); w = c.width; h = c.height;
    rec.page = pageNo;
    busy('Buscando georreferencia…');
    try {
      const vps = await Geo.readGeoPdf(bytes, page.ref && page.ref.num);
      if (vps.length) {
        const area = v => Math.abs((v.bbox[2] - v.bbox[0]) * (v.bbox[3] - v.bbox[1]));
        const best = vps.sort((a, b) => area(b) - area(a))[0], b = best.bbox, pts = [];
        for (let i = 0; i + 1 < best.gpts.length && i + 1 < best.lpts.length; i += 2) {
          const px = b[0] + best.lpts[i] * (b[2] - b[0]), py = b[1] + best.lpts[i + 1] * (b[3] - b[1]);
          const [x, y] = vp.convertToViewportPoint(px, py);
          pts.push({ x, y, lat: best.gpts[i], lon: best.gpts[i + 1] });
        }
        rec.georef = Geo.fitGeoref(pts, 'geopdf');
      }
    } catch (e) { console.warn('Georreferencia del PDF no leída', e); }
    c.width = c.height = 0;
    pdf.destroy();
  } else {
    busy('Procesando imagen…');
    const bmp = await createImageBitmap(file);
    w = bmp.width; h = bmp.height;
    if (w * h > 16e6) {
      const k = Math.sqrt(16e6 / (w * h)), c = document.createElement('canvas');
      c.width = Math.floor(w * k); c.height = Math.floor(h * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      imgBlob = await canvasBlob(c, 0.9); w = c.width; h = c.height;
    } else imgBlob = file;
    bmp.close && bmp.close();
  }
  busy('Guardando…');
  rec.w = w; rec.h = h;
  rec.imageId = uid(); rec.thumbId = uid();
  await DB.put('blobs', { id: rec.imageId, blob: imgBlob });
  await DB.put('blobs', { id: rec.thumbId, blob: await shrink(imgBlob, 240) });
  await DB.put('maps', rec);
  busy();
  toast(rec.georef ? 'Mapa georreferenciado listo' : 'Mapa importado. Falta georreferenciarlo.', 3500);
  return rec.id;
}

// ================= VISTA DE MAPA =================
let cur = null;     // { map, feats: Map, layers: Map }
let lmap = null, overlay = null, fLayer = null, tmpLayer = null, gcpLayer = null, gpsDot = null, gpsAcc = null;
let gps = null, watchId = null, follow = false;
let mode = null;    // null | 'draw' | 'track' | 'georef'
let draw = null, track = null, gref = null, wakeLock = null;

const COLORS = ['#e4572e', '#f2a541', '#2e9e5b', '#1d70b8', '#7b2cbf', '#d81b60', '#222222'];
const DEF_COLOR = { point: '#e4572e', line: '#1d70b8', track: '#f2a541', polygon: '#2e9e5b' };
const TYPE_NAME = { point: 'Punto', line: 'Línea', track: 'Track', polygon: 'Área' };

// Dos vistas: 'geo' (mapa mundial con capa base satelital; el PDF georreferenciado va encima)
// y 'px' (la imagen sola en píxeles: mapas sin georreferencia y modo georreferenciar).
const toLL = ([x, y]) => L.latLng(-y, x);
const fromLL = ll => [ll.lng, -ll.lat];
const g = () => cur && cur.map.georef;
const geoOn = () => !!(cur && cur.view === 'geo');
const geoLL = (lat, lon) => L.latLng(lat, lon);
const llGeo = ll => [ll.lat, ll.lng];
const BASE_ID = 'base';

// ---------- Capas base (con internet; lo que ya viste queda guardado para usar sin conexión) ----------
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const ATT_ESRI = 'Imágenes © Esri, Maxar, Earthstar Geographics y comunidad SIG';
const BASES = {
  sat: { name: 'Satélite', layers: [[ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', 19, ATT_ESRI]] },
  satlbl: { name: 'Satélite + nombres', layers: [[ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', 19, ATT_ESRI], [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', 19, '']] },
  topo: { name: 'Topográfico', layers: [[ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', 19, 'Mapa © Esri y colaboradores']] },
  osm: { name: 'Calles', layers: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', 19, '© colaboradores de OpenStreetMap']] },
  none: { name: 'Ninguno', layers: [] },
};
let baseGroup = null;
function setBase(key) {
  if (!BASES[key]) key = 'sat';
  settings.base = key;
  if (!lmapGeo) return;
  if (baseGroup) baseGroup.remove();
  baseGroup = L.layerGroup(BASES[key].layers.map(([url, nz, att]) => L.tileLayer(url, {
    maxNativeZoom: nz, maxZoom: 22, attribution: att, crossOrigin: true, keepBuffer: 3, detectRetina: false,
  }))).addTo(lmapGeo);
  baseGroup.eachLayer(l => l.bringToBack());
}

// Imagen del mapa importado colocada sobre el mapa mundial con su georreferencia (transformación afín por CSS).
const GeoImage = L.Layer.extend({
  initialize(url, map, georef) {
    this._url = url; this._m = map; this._g = georef;
    const c = (x, y) => L.latLng(...Geo.pxToGeo(georef, x, y));
    this._corners = [c(0, 0), c(map.w, 0), c(0, map.h), c(map.w, map.h)];
  },
  onAdd(map) {
    const img = this._img = L.DomUtil.create('img', 'geoimg');
    img.src = this._url; img.alt = '';
    img.style.width = this._m.w + 'px'; img.style.height = this._m.h + 'px';
    if (map._zoomAnimated) L.DomUtil.addClass(img, 'leaflet-zoom-animated');
    this.setOpacity(settings.opacity);
    map.getPanes().overlayPane.appendChild(img);
    this._update();
  },
  onRemove() { L.DomUtil.remove(this._img); },
  getEvents() { return { zoom: this._update, viewreset: this._update, zoomanim: this._anim }; },
  getBounds() { return L.latLngBounds(this._corners); },
  setOpacity(o) { if (this._img) this._img.style.opacity = o; },
  _apply(P) {
    const w = this._m.w, h = this._m.h;
    const a = (P[1].x - P[0].x) / w, b = (P[1].y - P[0].y) / w, c = (P[2].x - P[0].x) / h, d = (P[2].y - P[0].y) / h;
    this._img.style.transform = `matrix(${a},${b},${c},${d},${P[0].x},${P[0].y})`;
  },
  _update() { this._apply(this._corners.slice(0, 3).map(ll => this._map.latLngToLayerPoint(ll))); },
  _anim(e) { this._apply(this._corners.slice(0, 3).map(ll => this._map._latLngToNewLayerPoint(ll, e.zoom, e.center))); },
});

let lmapPx = null, lmapGeo = null;
function useMap(view) {
  $('#leaf').hidden = view !== 'px';
  $('#leafGeo').hidden = view !== 'geo';
  const make = (el, opts) => {
    const m = L.map(el, Object.assign({ zoomControl: false, boxZoom: false, wheelPxPerZoomLevel: 90 }, opts));
    m.on('dragstart', () => { if (follow) setFollow(false); });
    m.on('click', onMapClick);
    m.on('move', onMapMove);
    return m;
  };
  if (view === 'px' && !lmapPx) lmapPx = make('leaf', { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false });
  if (view === 'geo' && !lmapGeo) {
    lmapGeo = make('leafGeo', { minZoom: 3, maxZoom: 22, zoomSnap: 0.5, zoomDelta: 0.5, worldCopyJump: true });
    lmapGeo.attributionControl.setPrefix(false);
    setBase(settings.base);
  }
  lmap = view === 'px' ? lmapPx : lmapGeo;
  lmap.invalidateSize();
}

async function ensureBaseMap() {
  let m = await DB.get('maps', BASE_ID);
  if (!m) { m = { id: BASE_ID, name: 'Mapa satelital', kind: 'base', created: 0, georef: null }; await DB.put('maps', m); }
  return m;
}

async function openMap(id, forcePx) {
  const m = await DB.get('maps', id);
  if (!m) return showLibrary();
  const view = m.kind !== 'base' && (forcePx || !m.georef) ? 'px' : 'geo';
  cur = { map: m, feats: new Map(), layers: new Map(), view };
  show('view');
  $('#mapName').textContent = m.name;
  [overlay, fLayer, tmpLayer, gcpLayer, gpsDot, gpsAcc].forEach(l => l && l.remove());
  overlay = gpsDot = gpsAcc = null;
  useMap(view);
  if (view === 'px') {
    const img = await DB.get('blobs', m.imageId);
    const bounds = L.latLngBounds([[-m.h, 0], [0, m.w]]);
    overlay = L.imageOverlay(blobUrl(img.blob), bounds).addTo(lmap);
    lmap.setMaxBounds(bounds.pad(0.6));
    lmap.fitBounds(bounds, { animate: false });
    lmap.setMinZoom(lmap.getZoom() - 1.5);
  } else if (m.kind === 'base') {
    if (gps) lmap.setView([gps.lat, gps.lon], 17, { animate: false });
    else if (!cur.keepView) lmap.setView([15.6, -90.3], 7, { animate: false });
  } else {
    const img = await DB.get('blobs', m.imageId);
    overlay = new GeoImage(blobUrl(img.blob), m, m.georef).addTo(lmap);
    lmap.fitBounds(overlay.getBounds(), { animate: false });
  }
  fLayer = L.layerGroup().addTo(lmap);
  tmpLayer = L.layerGroup().addTo(lmap);
  gcpLayer = L.layerGroup().addTo(lmap);
  (await DB.byMap(id)).forEach(f => { cur.feats.set(f.id, f); });
  renderFeatures();
  setMode(null);
  startGps();
  updateGps();
}
function fitMap() {
  setFollow(false);
  if (cur.view === 'px') lmap.fitBounds(L.latLngBounds([[-cur.map.h, 0], [0, cur.map.w]]));
  else if (overlay) lmap.fitBounds(overlay.getBounds());
  else if (cur.feats.size) lmap.fitBounds(L.latLngBounds([...cur.feats.values()].flatMap(f => f.coords.map(c => [c[0], c[1]]))), { padding: [60, 60], maxZoom: 18 });
  else locate();
}

function updateBanner() {
  const b = $('#banner');
  if (cur && cur.view === 'px' && !g() && mode !== 'georef') {
    b.innerHTML = `${ic('info')}<span>Este mapa no está georreferenciado: sin él no se puede mostrar el GPS ni medir.</span><button class="btn pri" id="bGeo">Georreferenciar</button>`;
    b.classList.add('on');
    $('#bGeo').onclick = startGeoref;
  } else b.classList.remove('on');
}

// ---------- Elementos ----------
function renderFeatures() {
  fLayer.clearLayers(); cur.layers.clear();
  if (!geoOn()) return;
  for (const f of cur.feats.values()) drawFeature(f);
}
function drawFeature(f) {
  const old = cur.layers.get(f.id);
  if (old) fLayer.removeLayer(old);
  if (!geoOn() || !f.coords.length) return;
  const pts = f.coords.map(c => geoLL(c[0], c[1]));
  let lyr;
  if (f.type === 'point') lyr = L.circleMarker(pts[0], { radius: 9, color: '#fff', weight: 2.5, fillColor: f.color, fillOpacity: 1 });
  else if (f.type === 'polygon') lyr = L.polygon(pts, { color: f.color, weight: 3, fillOpacity: 0.22 });
  else lyr = L.polyline(pts, { color: f.color, weight: f.type === 'track' ? 4 : 3.5, dashArray: f.type === 'line' ? '8 6' : null });
  if (settings.labels && f.name) lyr.bindTooltip(esc(f.name), { permanent: true, direction: f.type === 'point' ? 'top' : 'center', offset: f.type === 'point' ? [0, -10] : [0, 0], className: 'lbl' });
  lyr.on('click', e => {
    L.DomEvent.stopPropagation(e);
    if (mode === 'draw') addVertex(llGeo(e.latlng));
    else if (mode === 'georef') onMapClick(e);
    else if (!mode) openEditor(f.id);
  });
  lyr.addTo(fLayer);
  cur.layers.set(f.id, lyr);
}
async function saveFeature(f) {
  f.updated = Date.now();
  await DB.put('features', f);
  cur.feats.set(f.id, f);
  drawFeature(f);
}
function nextName(type) {
  let n = 1;
  for (const f of cur.feats.values()) if (f.type === type) n++;
  return `${TYPE_NAME[type]} ${n}`;
}
function newFeature(type, coords) {
  return { id: uid(), mapId: cur.map.id, type, name: nextName(type), note: '', color: DEF_COLOR[type], coords, photos: [], created: Date.now() };
}
function zoomTo(f) {
  const pts = f.coords.map(c => geoLL(c[0], c[1]));
  if (pts.length === 1) lmap.setView(pts[0], Math.max(lmap.getZoom(), 18));
  else lmap.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 19 });
}
function summary(f) {
  const m = Geo.measures(f);
  if (f.type === 'point') return Geo.formatCoord(f.coords[0][0], f.coords[0][1], settings.fmt);
  if (f.type === 'polygon') return `${(m.area / 10000).toFixed(4)} ha · ${(m.area / Geo.M2_PER_MZ).toFixed(3)} mz`;
  return Geo.formatLength(m.length);
}

// ---------- Editor ----------
async function openEditor(id) {
  const f = cur.feats.get(id);
  if (!f) return;
  setFollow(false);
  const m = Geo.measures(f);
  let kv = '';
  if (f.type === 'point') {
    const c = f.coords[0];
    kv += `<dt>Lat/Lon</dt><dd>${Geo.formatCoord(c[0], c[1], 'dd')}</dd><dt>GMS</dt><dd>${Geo.formatCoord(c[0], c[1], 'dms')}</dd>
      <dt>UTM</dt><dd>${Geo.formatCoord(c[0], c[1], 'utm')}</dd><dt>GTM</dt><dd>${Geo.formatCoord(c[0], c[1], 'gtm')}</dd>`;
    if (c[2] != null) kv += `<dt>Altitud</dt><dd>${Math.round(c[2])} m</dd>`;
    if (c[3] != null) kv += `<dt>Precisión</dt><dd>±${Math.round(c[3])} m (GPS)</dd>`;
    else kv += `<dt>Origen</dt><dd>Marcado en el mapa</dd>`;
  }
  if (m.length != null) kv += `<dt>Longitud</dt><dd>${Geo.formatLength(m.length)}</dd>`;
  if (m.area != null) kv += `<dt>Área</dt><dd>${(m.area / 10000).toFixed(4)} ha<br>${(m.area / Geo.M2_PER_MZ).toFixed(3)} manzanas<br>${Math.round(m.area).toLocaleString('es-GT')} m²</dd><dt>Perímetro</dt><dd>${Geo.formatLength(m.perimeter)}</dd>`;
  if (f.type !== 'point') kv += `<dt>Vértices</dt><dd>${f.coords.length}</dd>`;
  if (f.type === 'track' && f.coords.length > 1 && f.coords[0][4]) kv += `<dt>Duración</dt><dd>${fmtDur(f.coords[f.coords.length - 1][4] - f.coords[0][4])}</dd>`;
  kv += `<dt>Creado</dt><dd>${fmtDate(f.created)}</dd>`;

  const s = openSheet(`<h2>${TYPE_NAME[f.type]}</h2>
    <label>Nombre<input id="eName" value="${esc(f.name)}" maxlength="80"></label>
    <label>Nota<textarea id="eNote" placeholder="Especie, estado, observaciones…">${esc(f.note)}</textarea></label>
    <h3>Color</h3><div class="swatches" id="eCol">${COLORS.map(c => `<button style="background:${c}" data-c="${c}" aria-label="Color ${c}" aria-pressed="${c === f.color}"></button>`).join('')}</div>
    <h3>Fotos</h3><div class="photos" id="ePh"></div><input type="file" id="ePhIn" accept="image/*" capture="environment" hidden>
    <h3>Datos</h3><dl class="kv">${kv}</dl>
    <div class="row" style="margin-top:16px">
      <button class="btn ghost" id="eDel" style="color:var(--rec)">${ic('trash')}Eliminar</button>
      <button class="btn ghost" id="eGo">${ic('fit')}Ver</button>
      <button class="btn pri" id="eOk">${ic('check')}Guardar</button>
    </div>`);
  const commit = async () => {
    f.name = s.querySelector('#eName').value.trim() || f.name;
    f.note = s.querySelector('#eNote').value.trim();
    await saveFeature(f);
  };
  s.querySelectorAll('#eCol button').forEach(b => b.onclick = () => {
    f.color = b.dataset.c;
    s.querySelectorAll('#eCol button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  const renderPhotos = async () => {
    const box = s.querySelector('#ePh'); box.innerHTML = '';
    for (const pid of f.photos || []) {
      const r = await DB.get('blobs', pid);
      if (!r) continue;
      const im = document.createElement('img'); im.src = blobUrl(r.blob); im.alt = 'Foto';
      im.onclick = () => viewPhoto(r.blob, async () => {
        f.photos = f.photos.filter(x => x !== pid); await DB.del('blobs', pid); await saveFeature(f); renderPhotos();
      });
      box.appendChild(im);
    }
    const add = document.createElement('button'); add.className = 'add'; add.innerHTML = ic('camera'); add.setAttribute('aria-label', 'Agregar foto');
    add.onclick = () => s.querySelector('#ePhIn').click();
    box.appendChild(add);
  };
  s.querySelector('#ePhIn').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      busy('Guardando foto…');
      const id = uid();
      await DB.put('blobs', { id, blob: await shrink(file, 1600) });
      f.photos = [...(f.photos || []), id];
      await commit(); await renderPhotos();
    } catch (err) { toast('No se pudo guardar la foto'); } finally { busy(); }
  };
  renderPhotos();
  s.querySelector('#eOk').onclick = async () => { await commit(); closeSheet(); toast('Guardado'); };
  s.querySelector('#eGo').onclick = async () => { await commit(); closeSheet(); zoomTo(f); };
  s.querySelector('#eDel').onclick = async () => {
    if (!confirm(`¿Eliminar "${f.name}"${f.photos && f.photos.length ? ' y sus fotos' : ''}?`)) return;
    for (const p of f.photos || []) await DB.del('blobs', p);
    await DB.del('features', f.id);
    cur.feats.delete(f.id);
    const l = cur.layers.get(f.id); if (l) fLayer.removeLayer(l);
    cur.layers.delete(f.id);
    closeSheet(); toast('Eliminado');
  };
}
function viewPhoto(blob, onDelete) {
  const v = document.createElement('div'); v.className = 'viewer';
  v.innerHTML = `<img alt="Foto" src="${blobUrl(blob)}"><div class="row"><button class="btn" id="vDel" style="color:var(--rec)">${ic('trash')}Borrar foto</button><button class="btn pri" id="vClose">${ic('x')}Cerrar</button></div>`;
  document.body.appendChild(v);
  v.querySelector('#vClose').onclick = () => v.remove();
  v.querySelector('#vDel').onclick = () => { if (confirm('¿Borrar esta foto?')) { v.remove(); onDelete(); } };
}

// ---------- GPS ----------
function startGps() {
  if (!navigator.geolocation) { $('#gpsCoord').textContent = 'Este dispositivo no tiene GPS'; return; }
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
}
function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}
function onPosErr(e) {
  const msg = e.code === 1 ? 'Permiso de ubicación denegado. Actívalo en el navegador.' : e.code === 3 ? 'Esperando señal GPS…' : 'GPS no disponible';
  if (!gps) $('#gpsCoord').textContent = msg;
  if (e.code === 1) { $('#gpsInfo').textContent = location.protocol === 'http:' && location.hostname !== 'localhost' ? 'El GPS requiere abrir la app por https.' : ''; }
}
function onPos(p) {
  const c = p.coords;
  gps = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, t: p.timestamp };
  if (track && !track.paused) addTrackPoint();
  updateGps();
}
function updateGps() {
  if (!cur) return;
  if (!gps) return;
  $('#gpsCoord').textContent = Geo.formatCoord(gps.lat, gps.lon, settings.fmt);
  let info = `±${Math.round(gps.acc)} m` + (gps.alt != null ? ` · alt. ${Math.round(gps.alt)} m` : '');
  const infoEl = $('#gpsInfo');
  infoEl.classList.remove('w');
  if (g()) {
    const [x, y] = Geo.geoToPx(g(), gps.lat, gps.lon);
    const W = cur.map.w, H = cur.map.h;
    const dx = Math.max(0, -x, x - W), dy = Math.max(0, -y, y - H);
    if (dx || dy) { info += ` · Fuera del mapa (${Geo.formatLength(Math.hypot(dx, dy) * g().mpp)})`; infoEl.classList.add('w'); }
  }
  if (geoOn()) {
    const ll = L.latLng(gps.lat, gps.lon), r = gps.acc;
    if (!gpsDot) {
      gpsAcc = L.circle(ll, { radius: r, color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(lmap);
      gpsDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(lmap);
    } else { gpsDot.setLatLng(ll); gpsAcc.setLatLng(ll).setRadius(r); }
    if (follow) lmap.panTo(ll, { animate: true });
  }
  if (gps.acc > 30) { info += ' · señal débil'; infoEl.classList.add('w'); }
  infoEl.textContent = info;
  refreshPanel();
}
function setFollow(on) {
  follow = on;
  const b = $('#bLoc'); if (b) b.classList.toggle('on', on);
}
function locate() {
  if (!geoOn()) return toast('Primero georreferencia el mapa');
  if (!gps) return toast('Todavía no hay señal GPS');
  lmap.setView([gps.lat, gps.lon], Math.max(lmap.getZoom(), 17));
  setFollow(true);
}

// ---------- Modos y barra inferior ----------
function setMode(m) {
  mode = m;
  $('#cross').classList.toggle('on', geoOn() || m === 'georef');
  updateBanner();
  refreshPanel(true);
}
function refreshPanel(rebuild) {
  const bot = $('#bottom');
  if (!cur) return;
  if (mode === 'draw') return drawPanel(bot, rebuild);
  if (mode === 'track') return trackPanel(bot, rebuild);
  if (mode === 'georef') return georefPanel(bot, rebuild);
  if (!rebuild) return;
  const geo = geoOn();
  bot.innerHTML = `<div class="tools">
    <button id="bLoc" ${geo ? '' : 'disabled'}>${ic('locate')}Ubicarme</button>
    <button id="bPt" ${geo ? '' : 'disabled'}>${ic('point')}Punto</button>
    <button id="bTr" ${geo ? '' : 'disabled'}>${ic('track')}Track</button>
    <button id="bLn" ${geo ? '' : 'disabled'}>${ic('line')}Medir</button>
    <button id="bAr" ${geo ? '' : 'disabled'}>${ic('area')}Área</button>
    <button id="bLs">${ic('list')}Elementos</button></div>`;
  $('#bLoc').onclick = locate;
  $('#bPt').onclick = addPointSheet;
  $('#bTr').onclick = startTrack;
  $('#bLn').onclick = () => startDraw('line');
  $('#bAr').onclick = () => startDraw('polygon');
  $('#bLs').onclick = listSheet;
  setFollow(follow);
}
function onMapClick(e) {
  if (mode === 'draw') addVertex(llGeo(e.latlng));
  else if (mode === 'georef') addGcp(fromLL(e.latlng));
}
function onMapMove() { if (mode === 'draw') updateRubber(); }

// ---------- Punto ----------
function addPointSheet() {
  const s = openSheet(`<h2>Nuevo punto</h2><div class="menu">
    <button id="pGps" ${gps ? '' : 'disabled'}>${ic('gps')}<span>En mi ubicación GPS<br><small style="color:var(--muted);font-weight:400">${gps ? `Precisión ±${Math.round(gps.acc)} m` : 'Sin señal GPS todavía'}</small></span></button>
    <button id="pCen">${ic('plus')}<span>En el centro de la cruz<br><small style="color:var(--muted);font-weight:400">Mueve el mapa para colocar la cruz donde quieras</small></span></button></div>`);
  s.querySelector('#pGps').onclick = async () => {
    if (!gps) return;
    const f = newFeature('point', [[gps.lat, gps.lon, gps.alt, gps.acc, gps.t]]);
    closeSheet(); await saveFeature(f); openEditor(f.id);
  };
  s.querySelector('#pCen').onclick = async () => {
    const [lat, lon] = llGeo(lmap.getCenter());
    const f = newFeature('point', [[lat, lon]]);
    closeSheet(); await saveFeature(f); openEditor(f.id);
  };
}

// ---------- Dibujo de líneas y áreas ----------
function startDraw(type) {
  setFollow(false);
  draw = { type, coords: [] };
  setMode('draw');
  toast('Toca el mapa o usa los botones para añadir vértices', 3500);
}
function addVertex(c) {
  draw.coords.push([c[0], c[1]]);
  renderDraw(); refreshPanel();
}
function renderDraw() {
  tmpLayer.clearLayers();
  if (!draw) return;
  const pts = draw.coords.map(c => geoLL(c[0], c[1]));
  const col = DEF_COLOR[draw.type];
  if (draw.type === 'polygon' && pts.length > 2) L.polygon(pts, { color: col, weight: 3, fillOpacity: 0.2, interactive: false }).addTo(tmpLayer);
  else if (pts.length > 1) L.polyline(pts, { color: col, weight: 3.5, interactive: false }).addTo(tmpLayer);
  pts.forEach(p => L.circleMarker(p, { radius: 6, color: '#222', weight: 2.5, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(tmpLayer));
  draw.rubber = null; updateRubber();
}
function updateRubber() {
  if (!draw || !draw.coords.length) return;
  const last = draw.coords[draw.coords.length - 1], c = lmap.getCenter();
  const seg = [geoLL(last[0], last[1]), c];
  if (draw.type === 'polygon' && draw.coords.length > 1) seg.push(geoLL(draw.coords[0][0], draw.coords[0][1]));
  if (draw.rubber) draw.rubber.setLatLngs(seg);
  else draw.rubber = L.polyline(seg, { color: '#222', weight: 1.5, dashArray: '4 5', interactive: false }).addTo(tmpLayer);
  const info = $('#dInfo');
  if (info) {
    const cc = [...draw.coords, llGeo(c)];
    info.textContent = draw.type === 'polygon' ? `Con la cruz: ${Geo.formatArea(Geo.polygonArea(cc))}` : `Con la cruz: ${Geo.formatLength(Geo.pathLength(cc))}`;
  }
}
function drawPanel(bot, rebuild) {
  const n = draw.coords.length, isA = draw.type === 'polygon';
  const val = isA ? (n > 2 ? Geo.formatArea(Geo.polygonArea(draw.coords)) : 'Agrega al menos 3 vértices')
    : (n > 1 ? Geo.formatLength(Geo.pathLength(draw.coords)) : 'Agrega al menos 2 vértices');
  const per = isA && n > 2 ? ` · perímetro ${Geo.formatLength(Geo.pathLength(draw.coords, true))}` : '';
  if (!rebuild && $('#dVal')) {
    $('#dVal').textContent = val + per;
    $('#dN').textContent = `${n} vértices`;
    $('#dGps').disabled = !gps; $('#dUndo').disabled = !n; $('#dOk').disabled = n < (isA ? 3 : 2);
    return;
  }
  bot.innerHTML = `<div class="panel">
    <div class="info" id="dVal">${val + per}</div>
    <div class="sub"><span id="dN">${n} vértices</span> · <span id="dInfo">Mueve la cruz o toca el mapa</span></div>
    <div class="row">
      <button class="btn" id="dCen">${ic('plus')}Cruz</button>
      <button class="btn" id="dGps" ${gps ? '' : 'disabled'}>${ic('gps')}GPS</button>
      <button class="btn" id="dUndo" ${n ? '' : 'disabled'}>${ic('undo')}Deshacer</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn ghost" id="dCancel">${ic('x')}Cancelar</button>
      <button class="btn pri" id="dOk" ${n < (isA ? 3 : 2) ? 'disabled' : ''}>${ic('check')}Terminar</button>
    </div></div>`;
  $('#dCen').onclick = () => addVertex(llGeo(lmap.getCenter()));
  $('#dGps').onclick = () => gps && addVertex([gps.lat, gps.lon]);
  $('#dUndo').onclick = () => { draw.coords.pop(); renderDraw(); refreshPanel(); };
  $('#dCancel').onclick = () => { if (draw.coords.length > 1 && !confirm('¿Descartar esta medición?')) return; endDraw(); };
  $('#dOk').onclick = async () => {
    const f = newFeature(draw.type, draw.coords);
    endDraw(); await saveFeature(f); openEditor(f.id);
  };
  updateRubber();
}
function endDraw() { draw = null; tmpLayer.clearLayers(); setMode(null); }

// ---------- Track ----------
async function requestWake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && track) requestWake(); });
async function startTrack() {
  if (!gps) toast('Esperando señal GPS para empezar…');
  setFollow(true);
  const f = newFeature('track', []);
  track = { f, paused: false, start: Date.now(), lastSave: 0 };
  await DB.put('features', f); cur.feats.set(f.id, f);
  requestWake();
  setMode('track');
  if (gps) addTrackPoint();
  track.timer = setInterval(() => refreshPanel(), 1000);
}
function addTrackPoint() {
  const f = track.f, c = f.coords;
  if (gps.acc > 50) return;              // descarta lecturas muy imprecisas
  if (c.length) {
    const last = c[c.length - 1];
    if (Geo.haversine(last, [gps.lat, gps.lon]) < Math.max(3, gps.acc * 0.5)) return;
  }
  c.push([gps.lat, gps.lon, gps.alt, gps.acc, gps.t]);
  drawFeature(f);
  if (Date.now() - track.lastSave > 15000) { track.lastSave = Date.now(); DB.put('features', f).catch(() => { }); }
}
function trackPanel(bot, rebuild) {
  const f = track.f, len = Geo.pathLength(f.coords);
  const txt = `${fmtDur(Date.now() - track.start)} · ${Geo.formatLength(len)} · ${f.coords.length} puntos`;
  if (!rebuild && $('#tVal')) { $('#tVal').textContent = txt; return; }
  bot.innerHTML = `<div class="panel">
    <div class="info">${track.paused ? 'En pausa' : '<span class="dot"></span> Grabando track'}</div>
    <div class="sub" id="tVal">${txt}</div>
    <div class="note" style="margin-top:-6px">Mantén la app abierta; la pantalla se queda encendida mientras grabas.</div>
    <div class="row">
      <button class="btn" id="tPause">${track.paused ? ic('play') + 'Reanudar' : ic('pause') + 'Pausa'}</button>
      <button class="btn" id="tLoc">${ic('locate')}Centrar</button>
      <button class="btn rec" id="tStop">${ic('stop')}Detener</button></div></div>`;
  $('#tPause').onclick = () => { track.paused = !track.paused; refreshPanel(true); };
  $('#tLoc').onclick = locate;
  $('#tStop').onclick = stopTrack;
}
async function stopTrack() {
  const f = track.f;
  clearInterval(track.timer);
  track = null;
  try { wakeLock && wakeLock.release(); } catch (e) { }
  wakeLock = null;
  setMode(null);
  if (f.coords.length < 2) {
    await DB.del('features', f.id); cur.feats.delete(f.id);
    const l = cur.layers.get(f.id); if (l) fLayer.removeLayer(l);
    return toast('El track tenía menos de 2 puntos y no se guardó', 3500);
  }
  await saveFeature(f); openEditor(f.id);
}

// ---------- Georreferenciación manual ----------
async function startGeoref() {
  const m = cur.map;
  if (m.kind === 'base') return toast('El mapa satelital ya tiene coordenadas');
  if (m.georef && m.georef.source === 'geopdf' && !confirm('Este mapa ya trae georreferencia del GeoPDF. ¿Reemplazarla por puntos manuales?')) return;
  closeSheet();
  setFollow(false);
  if (cur.view !== 'px') await openMap(m.id, true);
  gref = { pts: m.georef && m.georef.source === 'manual' ? m.georef.points.map(p => ({ ...p })) : [] };
  setMode('georef');
  renderGcps();
}
function renderGcps() {
  gcpLayer.clearLayers();
  if (!gref) return;
  gref.fit = null;
  try { if (gref.pts.length >= 2) gref.fit = Geo.fitGeoref(gref.pts, 'manual'); } catch (e) { gref.err = e.message; }
  gref.pts.forEach((p, i) => L.marker(toLL([p.x, p.y]), {
    icon: L.divIcon({ className: 'gcpicon', html: String(i + 1), iconSize: [24, 24] }), interactive: false
  }).addTo(gcpLayer));
  refreshPanel(true);
}
function georefPanel(bot) {
  const pts = gref.pts, fit = gref.fit;
  const rows = pts.map((p, i) => `<div class="gcp"><span class="n">${i + 1}</span><span>${Geo.formatCoord(p.lat, p.lon, settings.fmt)}${fit && fit.points[i] && pts.length > 2 ? `<br><small style="color:var(--muted)">desvío ${fit.points[i].err.toFixed(1)} m</small>` : ''}</span><button class="btn ghost" data-i="${i}" aria-label="Quitar punto ${i + 1}">${ic('trash')}</button></div>`).join('');
  let st = 'Agrega al menos 2 puntos (mejor 3 o 4, repartidos en las esquinas).';
  if (fit) st = `${pts.length} puntos · ${fit.mpp.toFixed(2)} m/píxel` + (pts.length > 3 ? ` · error medio ${fit.rms.toFixed(1)} m` : '');
  else if (pts.length >= 2 && gref.err) st = gref.err;
  bot.innerHTML = `<div class="panel" style="max-height:55dvh;overflow:auto">
    <div class="info">Georreferenciar</div>
    <div class="sub">Coloca la cruz sobre un punto de coordenadas conocidas (cruce de cuadrícula, mojón, esquina) o tócalo, y escribe sus coordenadas.</div>
    ${rows}<div class="note">${esc(st)}</div>
    <div class="row">
      <button class="btn" id="gAdd">${ic('plus')}Punto en la cruz</button>
      <button class="btn ghost" id="gCancel">${ic('x')}Cancelar</button>
      <button class="btn pri" id="gOk" ${fit ? '' : 'disabled'}>${ic('check')}Guardar</button></div></div>`;
  bot.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { gref.pts.splice(+b.dataset.i, 1); renderGcps(); });
  $('#gAdd').onclick = () => addGcp(fromLL(lmap.getCenter()));
  $('#gCancel').onclick = () => {
    gref = null; gcpLayer.clearLayers();
    if (g()) openMap(cur.map.id); else setMode(null);
  };
  $('#gOk').onclick = async () => {
    cur.map.georef = gref.fit;
    await DB.put('maps', cur.map);
    gref = null;
    await openMap(cur.map.id);
    toast('Georreferencia guardada');
  };
}
function addGcp([x, y]) {
  if (x < 0 || y < 0 || x > cur.map.w || y > cur.map.h) return toast('El punto debe estar dentro del mapa');
  const fmt = settings.fmt === 'dms' ? 'dd' : settings.fmt;
  const s = openSheet(`<h2>Coordenadas del punto ${gref.pts.length + 1}</h2>
    <div class="seg" id="cFmt">${[['dd', 'Lat/Lon'], ['utm', 'UTM'], ['gtm', 'GTM']].map(([k, t]) => `<button data-f="${k}" aria-pressed="${k === fmt}">${t}</button>`).join('')}</div>
    <div id="cFields"></div>
    <button class="btn" id="cGps" style="width:100%;margin-bottom:10px" ${gps ? '' : 'disabled'}>${ic('gps')}Usar mi posición GPS actual${gps ? ` (±${Math.round(gps.acc)} m)` : ''}</button>
    <div class="note">Usa tu GPS solo si estás parado exactamente en ese punto del terreno.</div>
    <button class="btn pri" id="cOk" style="width:100%">${ic('check')}Agregar punto</button>`);
  let f = fmt;
  const fields = () => {
    const z = gps ? Geo.utmZone(gps.lon) : 15;
    s.querySelector('#cFields').innerHTML = f === 'dd'
      ? `<div class="grid2"><label>Latitud<input id="cA" inputmode="decimal" placeholder="14.6349"></label><label>Longitud<input id="cB" inputmode="decimal" placeholder="-90.5069"></label></div>`
      : f === 'utm'
        ? `<div class="grid3"><label>Zona<input id="cZ" inputmode="numeric" value="${z}"></label><label>Este (E)<input id="cA" inputmode="decimal" placeholder="768550"></label><label>Norte (N)<input id="cB" inputmode="decimal" placeholder="1619421"></label></div><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cS" style="width:auto;margin:0">Hemisferio sur</label>`
        : `<div class="grid2"><label>X (Este)<input id="cA" inputmode="decimal" placeholder="499256"></label><label>Y (Norte)<input id="cB" inputmode="decimal" placeholder="1618268"></label></div>`;
  };
  fields();
  s.querySelectorAll('#cFmt button').forEach(b => b.onclick = () => {
    f = b.dataset.f; s.querySelectorAll('#cFmt button').forEach(x => x.setAttribute('aria-pressed', x === b)); fields();
  });
  s.querySelector('#cGps').onclick = () => {
    if (!gps) return;
    const a = s.querySelector('#cA'), b = s.querySelector('#cB');
    if (f === 'dd') { a.value = gps.lat.toFixed(7); b.value = gps.lon.toFixed(7); }
    else if (f === 'utm') { const u = Geo.toUTM(gps.lat, gps.lon); s.querySelector('#cZ').value = u.zone; s.querySelector('#cS').checked = u.south; a.value = u.e.toFixed(2); b.value = u.n.toFixed(2); }
    else { const [X, Y] = Geo.toGTM(gps.lat, gps.lon); a.value = X.toFixed(2); b.value = Y.toFixed(2); }
  };
  s.querySelector('#cOk').onclick = () => {
    const num = id => parseFloat(String(s.querySelector(id).value).replace(',', '.'));
    const a = num('#cA'), b = num('#cB');
    if (!isFinite(a) || !isFinite(b)) return toast('Escribe las dos coordenadas');
    let lat, lon;
    if (f === 'dd') { lat = a; lon = b; }
    else if (f === 'utm') {
      const z = parseInt(s.querySelector('#cZ').value);
      if (!(z >= 1 && z <= 60)) return toast('Zona UTM inválida');
      [lat, lon] = Geo.fromUTM(a, b, z, s.querySelector('#cS').checked);
    } else[lat, lon] = Geo.fromGTM(a, b);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return toast('Coordenadas fuera de rango');
    gref.pts.push({ x, y, lat, lon });
    closeSheet(); renderGcps();
  };
}

// ---------- Listado, menú y exportación ----------
function listSheet() {
  const feats = [...cur.feats.values()].sort((a, b) => b.created - a.created);
  const s = openSheet(`<h2>Elementos de este mapa (${feats.length})</h2>
    ${feats.length ? `<button class="btn pri" id="lExp" style="width:100%;margin-bottom:8px">${ic('share')}Exportar KML, GPX o CSV</button>` : '<p class="note">Todavía no hay puntos, tracks ni áreas.</p>'}
    <div class="list">${feats.map(f => `<button data-id="${f.id}"><span class="sw" style="background:${f.color}"></span><span><b>${esc(f.name)}</b><small>${TYPE_NAME[f.type]} · ${esc(summary(f))}${f.photos && f.photos.length ? ` · ${f.photos.length} foto${f.photos.length > 1 ? 's' : ''}` : ''}</small></span></button>`).join('')}</div>`);
  s.querySelectorAll('.list button').forEach(b => b.onclick = () => { const f = cur.feats.get(b.dataset.id); closeSheet(); if (geoOn()) zoomTo(f); openEditor(f.id); });
  const e = s.querySelector('#lExp'); if (e) e.onclick = exportSheet;
}
function exportSheet() {
  const feats = [...cur.feats.values()].filter(f => f.coords.length);
  const s = openSheet(`<h2>Exportar ${feats.length} elementos</h2>
    <div class="seg" id="xFmt"><button data-f="kml" aria-pressed="true">KML</button><button data-f="gpx" aria-pressed="false">GPX</button><button data-f="csv" aria-pressed="false">CSV</button></div>
    <p class="note" id="xNote"></p>
    <div class="row"><button class="btn" id="xDl">Descargar</button><button class="btn pri" id="xSh">${ic('share')}Compartir</button></div>`);
  const notes = { kml: 'Para Google Earth, QGIS o ArcGIS. Incluye puntos, tracks, líneas y áreas con su color.', gpx: 'Para GPS de mano y apps de navegación. Las áreas se exportan como recorridos cerrados.', csv: 'Para Excel: una fila por elemento con lat/lon, GTM, UTM, longitud, perímetro y área (m², ha y manzanas).' };
  let fmt = 'kml';
  const upd = () => { s.querySelector('#xNote').textContent = notes[fmt] + ' Las fotos quedan en el teléfono y no se incluyen.'; };
  upd();
  s.querySelectorAll('#xFmt button').forEach(b => b.onclick = () => { fmt = b.dataset.f; s.querySelectorAll('#xFmt button').forEach(x => x.setAttribute('aria-pressed', x === b)); upd(); });
  const build = () => {
    const name = cur.map.name, d = new Date().toISOString().slice(0, 10);
    const base = (name.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '_') || 'mapa') + '_' + d;
    if (fmt === 'kml') return new File([Geo.toKML(feats, name)], base + '.kml', { type: 'application/vnd.google-earth.kml+xml' });
    if (fmt === 'gpx') return new File([Geo.toGPX(feats, name)], base + '.gpx', { type: 'application/gpx+xml' });
    return new File([Geo.toCSV(feats)], base + '.csv', { type: 'text/csv' });
  };
  s.querySelector('#xDl').onclick = () => {
    if (NATIVE) return nativeShare(build());
    const f = build(), a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  s.querySelector('#xSh').onclick = async () => {
    const f = build();
    if (NATIVE) return nativeShare(f);
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: f.name }); } catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir'); }
    } else { toast('Este navegador no permite compartir archivos; se descargará.'); s.querySelector('#xDl').click(); }
  };
}
function menuSheet() {
  const m = cur.map, gr = m.georef, isBase = m.kind === 'base';
  const s = openSheet(`<h2>${esc(m.name)}</h2>
    ${geoOn() ? `<h3>Mapa base</h3>
    <div class="seg" id="mBase">${Object.entries(BASES).map(([k, b]) => `<button data-b="${k}" aria-pressed="${settings.base === k}">${b.name}</button>`).join('')}</div>
    <p class="note" style="margin-top:-6px">Necesita internet. Las zonas que ya viste quedan guardadas y se ven sin conexión.</p>` : ''}
    ${geoOn() && overlay ? `<label>Transparencia del mapa importado <span id="mOpV">${Math.round(settings.opacity * 100)} %</span>
      <input type="range" id="mOp" min="0" max="1" step="0.05" value="${settings.opacity}"></label>` : ''}
    <div class="menu">
    <button id="mList">${ic('list')}Elementos (${cur.feats.size})</button>
    <button id="mExp" ${cur.feats.size ? '' : 'disabled'}>${ic('share')}Exportar KML / GPX / CSV</button>
    <button id="mFit">${ic('fit')}${isBase ? 'Ver todos mis elementos' : 'Ver mapa completo'}</button>
    ${isBase ? '' : `<button id="mGeo">${ic('pin')}${gr ? 'Rehacer georreferencia' : 'Georreferenciar'}</button>`}
    <button id="mLbl">${ic('tag')}${settings.labels ? 'Ocultar' : 'Mostrar'} nombres en el mapa</button>
    ${isBase ? '' : `<button id="mRen">${ic('edit')}Cambiar nombre del mapa</button>`}</div>
    <h3>Formato de coordenadas</h3>
    <div class="seg" id="mFmt">${[['dd', 'Lat/Lon'], ['dms', 'GMS'], ['utm', 'UTM'], ['gtm', 'GTM']].map(([k, t]) => `<button data-f="${k}" aria-pressed="${settings.fmt === k}">${t}</button>`).join('')}</div>
    ${isBase ? '' : `<h3>Información</h3><dl class="kv">
      <dt>Origen</dt><dd>${m.kind === 'pdf' ? `PDF, página ${m.page || 1}` : 'Imagen'} · ${m.w}×${m.h} px</dd>
      <dt>Georreferencia</dt><dd>${gr ? (gr.source === 'geopdf' ? 'Leída del GeoPDF' : `Manual, ${gr.points.length} puntos`) : 'No'}</dd>
      ${gr ? `<dt>Resolución</dt><dd>${gr.mpp.toFixed(2)} m por píxel</dd>${gr.rms ? `<dt>Error medio</dt><dd>${gr.rms.toFixed(1)} m</dd>` : ''}` : ''}</dl>`}`);
  s.querySelectorAll('#mBase button').forEach(b => b.onclick = () => {
    setBase(b.dataset.b); s.querySelectorAll('#mBase button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  const op = s.querySelector('#mOp');
  if (op) op.oninput = () => { settings.opacity = +op.value; overlay.setOpacity(+op.value); s.querySelector('#mOpV').textContent = Math.round(op.value * 100) + ' %'; };
  s.querySelector('#mList').onclick = listSheet;
  s.querySelector('#mExp').onclick = exportSheet;
  s.querySelector('#mFit').onclick = () => { closeSheet(); fitMap(); };
  const mg = s.querySelector('#mGeo');
  if (mg) mg.onclick = () => { if (mode) return toast('Termina primero lo que estás haciendo'); startGeoref(); };
  s.querySelector('#mLbl').onclick = () => { settings.labels = !settings.labels; closeSheet(); renderFeatures(); };
  const mr = s.querySelector('#mRen');
  if (mr) mr.onclick = () => mapOptions(m);
  s.querySelectorAll('#mFmt button').forEach(b => b.onclick = () => {
    settings.fmt = b.dataset.f; s.querySelectorAll('#mFmt button').forEach(x => x.setAttribute('aria-pressed', x === b)); updateGps();
  });
}
$('#btnMenu').onclick = menuSheet;
$('#btnBack').onclick = async () => {
  if (track) { if (!confirm('Se está grabando un track. ¿Detenerlo y salir?')) return; await stopTrack(); closeSheet(); }
  if (draw) endDraw();
  if (gref) { gref = null; }
  mode = null;
  showLibrary();
};
window.addEventListener('beforeunload', e => { if (track) { DB.put('features', track.f); e.preventDefault(); e.returnValue = ''; } });

// ---------- Inicio ----------
if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
if (NATIVE) {
  // Botón Atrás de Android: cierra hojas, sale del modo actual o vuelve a la biblioteca.
  const App = Capacitor.Plugins.App;
  if (App) App.addListener('backButton', () => {
    const v = document.querySelector('.viewer');
    if (v) return v.remove();
    if (sheetEl) return closeSheet();
    if (cur) return $('#btnBack').click();
    App.exitApp();
  });
}
showLibrary();
