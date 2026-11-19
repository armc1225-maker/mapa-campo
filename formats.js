/* Mapa de Campo — importación de KML, KMZ, GPX, GeoJSON, Shapefile (.zip o .shp/.dbf/.prj) y CSV.
   Devuelve elementos en lat/lon WGS84: { type: 'point'|'line'|'track'|'polygon', name, note, color, coords: [[lat, lon, alt?, acc?, time?]] }
   y superposiciones de imagen de KMZ (GroundOverlay) para crear mapas. */
(function (root) {
  'use strict';
  const Geo = root.Geo;
  const VECTOR_EXT = ['kml', 'kmz', 'gpx', 'geojson', 'json', 'zip', 'shp', 'dbf', 'prj', 'cpg', 'shx', 'csv', 'txt'];
  const ext = n => (/\.([^.\/\\]+)$/.exec(n) || [])[1]?.toLowerCase() || '';
  const base = n => n.replace(/^.*[\/\\]/, '');
  const stem = n => base(n).replace(/\.[^.]+$/, '').toLowerCase();
  const isVector = f => VECTOR_EXT.includes(ext(f.name));

  // ---------- ZIP (KMZ y shapefiles comprimidos) ----------
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(out);
  }
  function unzip(buf) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = b.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('El archivo ZIP/KMZ está dañado.');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const td = new TextDecoder('utf-8'), entries = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = b.subarray(start, start + csize);
      entries.push({
        name, bytes: async () => {
          if (method === 0) return data;
          if (method === 8) return inflateRaw(data);
          throw new Error(`Compresión ZIP no soportada en ${name}`);
        }
      });
    }
    return entries;
  }

  // ---------- Utilidades ----------
  const text = async (e, enc) => new TextDecoder(enc || 'utf-8').decode(await e.bytes());
  const kmlColor = c => { c = (c || '').trim(); return /^[0-9a-f]{8}$/i.test(c) ? '#' + c.slice(6, 8) + c.slice(4, 6) + c.slice(2, 4) : null; };
  const hexColor = c => /^#?[0-9a-f]{6}$/i.test(c || '') ? (c[0] === '#' ? c : '#' + c) : null;
  const stripHtml = h => {
    if (!h) return '';
    if (!/[<&]/.test(h)) return h.trim();
    const d = new DOMParser().parseFromString(h.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
    return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  };
  const xmlDoc = s => {
    const d = new DOMParser().parseFromString(s, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('El archivo XML no es válido.');
    return d;
  };
  const child = (el, tag) => { for (const c of el.children) if (c.localName === tag) return c; return null; };
  const childText = (el, tag) => { const c = child(el, tag); return c ? c.textContent.trim() : ''; };
  const desc = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
  function dropClosing(c) {
    if (c.length > 3) { const a = c[0], z = c[c.length - 1]; if (a[0] === z[0] && a[1] === z[1]) return c.slice(0, -1); }
    return c;
  }
  function valid(c) { return c.every(p => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180); }

  // ---------- KML ----------
  function kmlCoords(s) {
    return (s || '').trim().split(/\s+/).filter(Boolean).map(t => {
      const [lon, lat, alt] = t.split(',').map(Number);
      return alt != null && isFinite(alt) ? [lat, lon, alt] : [lat, lon];
    }).filter(p => isFinite(p[0]) && isFinite(p[1]));
  }
  function parseKML(s) {
    const d = xmlDoc(s), styles = {}, maps = {};
    for (const st of desc(d, 'Style')) {
      const id = st.getAttribute('id'); if (!id) continue;
      const pick = t => { const e = desc(st, t)[0]; return e ? kmlColor(childText(e, 'color')) : null; };
      styles['#' + id] = pick('LineStyle') || pick('PolyStyle') || pick('IconStyle');
    }
    for (const sm of desc(d, 'StyleMap')) {
      const id = sm.getAttribute('id'); if (!id) continue;
      for (const pr of desc(sm, 'Pair')) if (childText(pr, 'key') === 'normal') maps['#' + id] = childText(pr, 'styleUrl');
    }
    const styleOf = pm => {
      const inline = child(pm, 'Style');
      if (inline) { for (const t of ['LineStyle', 'PolyStyle', 'IconStyle']) { const e = desc(inline, t)[0]; const c = e && kmlColor(childText(e, 'color')); if (c) return c; } }
      let u = childText(pm, 'styleUrl'); if (!u) return null;
      u = u.replace(/^.*#/, '#');
      if (maps[u]) u = maps[u].replace(/^.*#/, '#');
      return styles[u] || null;
    };
    const features = [], overlays = [];
    for (const pm of desc(d, 'Placemark')) {
      const name = childText(pm, 'name'), note = stripHtml(childText(pm, 'description')), color = styleOf(pm);
      const geoms = [];
      for (const g of pm.getElementsByTagNameNS('*', '*')) {
        const t = g.localName;
        if (t === 'Point') geoms.push({ type: 'point', coords: kmlCoords(childText(g, 'coordinates')).slice(0, 1) });
        else if (t === 'LineString') geoms.push({ type: 'line', coords: kmlCoords(childText(g, 'coordinates')) });
        else if (t === 'Polygon') {
          const ob = desc(g, 'outerBoundaryIs')[0], ring = ob && desc(ob, 'coordinates')[0];
          if (ring) geoms.push({ type: 'polygon', coords: dropClosing(kmlCoords(ring.textContent)) });
        } else if (t === 'Track') {
          const whens = desc(g, 'when').map(w => Date.parse(w.textContent.trim()));
          const cs = desc(g, 'coord').map((c, i) => {
            const [lon, lat, alt] = c.textContent.trim().split(/\s+/).map(Number);
            return [lat, lon, isFinite(alt) ? alt : null, null, isFinite(whens[i]) ? whens[i] : null];
          });
          geoms.push({ type: 'track', coords: cs });
        }
      }
      geoms.forEach((gm, i) => {
        const min = gm.type === 'point' ? 1 : gm.type === 'polygon' ? 3 : 2;
        if (gm.coords.length < min || !valid(gm.coords)) return;
        features.push({ type: gm.type, name: (name || defName(gm.type)) + (geoms.length > 1 ? ` (${i + 1})` : ''), note, color, coords: gm.coords });
      });
    }
    for (const go of desc(d, 'GroundOverlay')) {
      const icon = desc(go, 'Icon')[0], href = icon ? childText(icon, 'href') : '';
      if (!href) continue;
      let corners = null; // [arriba-izq, arriba-der, abajo-der, abajo-izq] como [lat, lon]
      const quad = desc(go, 'LatLonQuad')[0];
      if (quad) {
        const q = kmlCoords(desc(quad, 'coordinates')[0]?.textContent);
        if (q.length >= 4) corners = [q[3], q[2], q[1], q[0]];
      } else {
        const bx = desc(go, 'LatLonBox')[0];
        if (bx) {
          const n = +childText(bx, 'north'), s = +childText(bx, 'south'), e = +childText(bx, 'east'), w = +childText(bx, 'west');
          const rot = (+childText(bx, 'rotation') || 0) * Math.PI / 180;
          const cl = (n + s) / 2, cn = (e + w) / 2, k = Math.cos(cl * Math.PI / 180);
          const r = ([la, lo]) => {
            const x = (lo - cn) * k, y = la - cl;
            return [cl + x * Math.sin(rot) + y * Math.cos(rot), cn + (x * Math.cos(rot) - y * Math.sin(rot)) / k];
          };
          corners = [[n, w], [n, e], [s, e], [s, w]].map(r);
        }
      }
      if (corners && valid(corners)) overlays.push({ name: childText(go, 'name') || base(href), href, corners });
    }
    return { features, overlays };
  }
  const defName = t => ({ point: 'Punto', line: 'Línea', track: 'Track', polygon: 'Área' }[t]);

  // ---------- GPX ----------
  function parseGPX(s) {
    const d = xmlDoc(s), features = [];
    const pt = e => {
      const ele = parseFloat(childText(e, 'ele')), t = Date.parse(childText(e, 'time'));
      return [parseFloat(e.getAttribute('lat')), parseFloat(e.getAttribute('lon')), isFinite(ele) ? ele : null, null, isFinite(t) ? t : null];
    };
    for (const w of desc(d, 'wpt')) features.push({ type: 'point', name: childText(w, 'name') || 'Punto', note: stripHtml(childText(w, 'desc') || childText(w, 'cmt')), coords: [pt(w)] });
    for (const r of desc(d, 'rte')) features.push({ type: 'line', name: childText(r, 'name') || 'Ruta', note: stripHtml(childText(r, 'desc')), coords: desc(r, 'rtept').map(pt) });
    for (const t of desc(d, 'trk')) {
      const segs = desc(t, 'trkseg'), area = childText(t, 'type') === 'area';
      segs.forEach((sg, i) => {
        let cs = desc(sg, 'trkpt').map(pt);
        if (area) cs = dropClosing(cs);
        features.push({ type: area ? 'polygon' : 'track', name: (childText(t, 'name') || 'Track') + (segs.length > 1 ? ` (${i + 1})` : ''), note: stripHtml(childText(t, 'desc')), coords: cs });
      });
    }
    return { features: features.filter(f => f.coords.length >= (f.type === 'point' ? 1 : f.type === 'polygon' ? 3 : 2) && valid(f.coords)) };
  }

  // ---------- Sistemas de coordenadas (archivos .prj y elección del usuario) ----------
  const CRS_PRESETS = {
    gtm: { type: 'tm', label: 'GTM (Guatemala)', ...Geo.GTM },
    utm15: { type: 'tm', label: 'UTM 15 Norte', lon0: -93, lat0: 0, k0: 0.9996, fe: 500000, fn: 0 },
    utm16: { type: 'tm', label: 'UTM 16 Norte', lon0: -87, lat0: 0, k0: 0.9996, fe: 500000, fn: 0 },
    geo: { type: 'geo', label: 'Lat/Lon (grados)' },
  };
  function parsePrj(wkt) {
    if (!wkt) return null;
    const up = wkt.toUpperCase();
    const datumWarn = /NAD.?27|CLARKE.?1866|OCOTEPEQUE/.test(up);
    if (/^\s*(GEOGCS|GEOGCRS|GEODCRS)/.test(up)) return { type: 'geo', datumWarn };
    if (/TRANSVERSE[_ ]MERCATOR/.test(up)) {
      const par = (...names) => {
        for (const n of names) { const m = new RegExp('PARAMETER\\["' + n + '"\\s*,\\s*([-+\\d.eE]+)', 'i').exec(wkt); if (m) return parseFloat(m[1]); }
        return null;
      };
      const unit = /UNIT\["(US survey foot|Foot_US|foot)"\s*,\s*([\d.]+)/i.exec(wkt.slice(wkt.lastIndexOf('UNIT[')));
      return {
        type: 'tm', datumWarn, unit: unit ? parseFloat(unit[2]) : 1,
        lon0: par('central_meridian', 'Longitude of natural origin') ?? 0,
        lat0: par('latitude_of_origin', 'Latitude of natural origin') ?? 0,
        k0: par('scale_factor', 'Scale factor at natural origin') ?? 1,
        fe: par('false_easting', 'False easting') ?? 0,
        fn: par('false_northing', 'False northing') ?? 0,
      };
    }
    return { type: 'unsupported', name: (/(PROJCS|PROJCRS)\["([^"]+)"/i.exec(wkt) || [])[2] || 'desconocido' };
  }
  function projector(crs) {
    if (!crs || crs.type === 'geo') return (x, y) => [y, x];
    const u = crs.unit || 1;
    return (x, y) => Geo.tmInverse(x * u, y * u, crs);
  }
  const looksGeo = pts => pts.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);

  // ---------- GeoJSON ----------
  async function parseGeoJSON(s, askCrs) {
    let j; try { j = JSON.parse(s); } catch (e) { throw new Error('El archivo JSON no es válido.'); }
    const feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', geometry: j, properties: {} }];
    const sample = [];
    const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : sample.length < 200 && sample.push(c);
    feats.forEach(f => f && f.geometry && f.geometry.coordinates && walk(f.geometry.coordinates));
    let crs = { type: 'geo' };
    if (!looksGeo(sample)) { crs = await askCrs('El GeoJSON tiene coordenadas proyectadas (no en grados).'); if (!crs) return null; }
    const P = projector(crs), cv = c => { const [la, lo] = P(c[0], c[1]); return c[2] != null ? [la, lo, c[2]] : [la, lo]; };
    const out = [];
    for (const f of feats) {
      if (!f || !f.geometry) continue;
      const pr = f.properties || {}, name = nameFrom(pr), note = noteFrom(pr, name);
      const color = hexColor(pr.stroke) || hexColor(pr['marker-color']) || hexColor(pr.fill) || null;
      const add = (type, coords) => out.push({ type, name, note, color, coords });
      const g = f.geometry, C = g.coordinates;
      const geom = (t, c) => {
        if (t === 'Point') add('point', [cv(c)]);
        else if (t === 'MultiPoint') c.forEach(p => add('point', [cv(p)]));
        else if (t === 'LineString') add('line', c.map(cv));
        else if (t === 'MultiLineString') c.forEach(l => add('line', l.map(cv)));
        else if (t === 'Polygon') add('polygon', dropClosing(c[0].map(cv)));
        else if (t === 'MultiPolygon') c.forEach(p => add('polygon', dropClosing(p[0].map(cv))));
      };
      if (g.type === 'GeometryCollection') g.geometries.forEach(x => geom(x.type, x.coordinates)); else geom(g.type, C);
    }
    numberDup(out);
    return { features: out.filter(f => valid(f.coords)), crs };
  }
  function numberDup(list) {
    const seen = {};
    for (const f of list) { const k = f.name; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) f.name = `${k} (${seen[k]})`; }
  }
  const NAME_KEYS = /^(name|nombre|nom|nombre_finca|finca|predio|rodal|parcela|lote|label|titulo|title|id|codigo|cod)$/i;
  function nameFrom(pr) {
    const keys = Object.keys(pr);
    const k = keys.find(k => NAME_KEYS.test(k) && pr[k] !== '' && pr[k] != null) || keys.find(k => typeof pr[k] === 'string' && pr[k].trim());
    return k ? String(pr[k]).trim().slice(0, 80) : '';
  }
  function noteFrom(pr, name) {
    return Object.entries(pr).filter(([k, v]) => v !== '' && v != null && typeof v !== 'object' && String(v) !== name && !/^(stroke|fill|marker-|styleUrl)/i.test(k))
      .map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 2000);
  }

  // ---------- Shapefile ----------
  function readDBF(buf, enc) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = dv.getUint32(4, true), hl = dv.getUint16(8, true), rl = dv.getUint16(10, true);
    const fields = [];
    for (let p = 32; p + 32 <= hl && b[p] !== 0x0d; p += 32) {
      let nm = ''; for (let i = 0; i < 11 && b[p + i]; i++) nm += String.fromCharCode(b[p + i]);
      fields.push({ name: nm, type: String.fromCharCode(b[p + 11]), len: b[p + 16] });
    }
    let td;
    try { td = new TextDecoder(enc || 'utf-8', { fatal: !enc }); td.decode(b.subarray(hl, Math.min(b.length, hl + rl * Math.min(n, 200)))); }
    catch (e) { td = new TextDecoder('windows-1252'); }
    const rows = [];
    for (let r = 0; r < n; r++) {
      let p = hl + r * rl;
      if (p + rl > b.length) break;
      const row = {}, deleted = b[p] === 0x2a; p++;
      for (const f of fields) {
        let v = td.decode(b.subarray(p, p + f.len)).trim(); p += f.len;
        if ('NFO'.includes(f.type)) v = v === '' ? null : Number(v);
        row[f.name] = v;
      }
      rows.push(deleted ? null : row);
    }
    return rows;
  }
  function readSHP(buf) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), recs = [];
    let p = 100;
    while (p + 8 <= b.length) {
      const len = dv.getInt32(p + 4, false) * 2, c = p + 8;
      p = c + len;
      if (len < 4 || p > b.length) break;
      const t = dv.getInt32(c, true);
      const kind = { 1: 'point', 11: 'point', 21: 'point', 3: 'line', 13: 'line', 23: 'line', 5: 'polygon', 15: 'polygon', 25: 'polygon', 8: 'multipoint', 18: 'multipoint', 28: 'multipoint' }[t];
      if (!kind) { recs.push(null); continue; }
      if (kind === 'point') { recs.push({ kind, parts: [[[dv.getFloat64(c + 4, true), dv.getFloat64(c + 12, true)]]] }); continue; }
      if (kind === 'multipoint') {
        const np = dv.getInt32(c + 36, true), pts = [];
        for (let i = 0; i < np; i++) pts.push([dv.getFloat64(c + 40 + i * 16, true), dv.getFloat64(c + 48 + i * 16, true)]);
        recs.push({ kind, parts: pts.map(q => [q]) }); continue;
      }
      const nparts = dv.getInt32(c + 36, true), npts = dv.getInt32(c + 40, true);
      const starts = []; for (let i = 0; i < nparts; i++) starts.push(dv.getInt32(c + 44 + i * 4, true));
      const p0 = c + 44 + nparts * 4, parts = [];
      for (let i = 0; i < nparts; i++) {
        const a = starts[i], z = i + 1 < nparts ? starts[i + 1] : npts, ring = [];
        for (let k = a; k < z; k++) ring.push([dv.getFloat64(p0 + k * 16, true), dv.getFloat64(p0 + k * 16 + 8, true)]);
        parts.push(ring);
      }
      recs.push({ kind, parts });
    }
    return recs;
  }
  const signedArea = r => { let s = 0; for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; s += r[i][0] * r[j][1] - r[j][0] * r[i][1]; } return s / 2; };
  async function parseShapefile(shp, dbf, prj, cpg, askCrs, layerName) {
    const recs = readSHP(await shp.bytes());
    const rows = dbf ? readDBF(await dbf.bytes(), cpg ? (await text(cpg)).trim().replace(/^(utf-?8|65001)$/i, 'utf-8') || undefined : undefined) : [];
    let crs = prj ? parsePrj(await text(prj)) : null;
    const sample = recs.filter(Boolean).slice(0, 50).flatMap(r => r.parts.flat().slice(0, 4));
    if (crs && crs.type === 'unsupported') { crs = await askCrs(`La proyección "${crs.name}" de ${layerName} no es compatible. Elige el sistema en que están las coordenadas.`); if (!crs) return null; }
    if (!crs) {
      if (looksGeo(sample)) crs = { type: 'geo' };
      else { crs = await askCrs(`La capa ${layerName} no trae archivo .prj con su sistema de coordenadas.`); if (!crs) return null; }
    }
    const P = projector(crs), out = [];
    recs.forEach((r, i) => {
      if (!r) return;
      const row = rows[i]; if (row === null) return;
      const pr = row || {}, name = nameFrom(pr) || `${layerName} ${i + 1}`, note = noteFrom(pr, name);
      const conv = ring => ring.map(([x, y]) => P(x, y));
      if (r.kind === 'point' || r.kind === 'multipoint') r.parts.forEach(q => out.push({ type: 'point', name, note, coords: conv(q) }));
      else if (r.kind === 'line') r.parts.forEach(q => q.length > 1 && out.push({ type: 'line', name, note, coords: conv(q) }));
      else {
        let outer = r.parts.filter(q => signedArea(q) < 0);
        if (!outer.length) outer = r.parts;
        outer.forEach(q => { const c = dropClosing(conv(q)); if (c.length >= 3) out.push({ type: 'polygon', name, note, coords: c }); });
      }
    });
    numberDup(out);
    return { features: out.filter(f => valid(f.coords)), crs };
  }

  // ---------- CSV ----------
  function splitCSV(s) {
    s = s.replace(/^﻿/, '');
    const first = s.split(/\r?\n/, 1)[0];
    const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  const norm = h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '');
  const num = v => parseFloat(String(v == null ? '' : v).trim().replace(/\s/g, '').replace(/,(?=\d+$)/, '.'));
  function parseWKT(w, P) {
    const m = /^\s*(MULTI)?(POINT|LINESTRING|POLYGON)\s*(Z|M|ZM)?\s*\((.*)\)\s*$/i.exec(w || '');
    if (!m) return [];
    const kind = m[2].toUpperCase(), multi = !!m[1], body = m[4];
    const pts = s => s.replace(/[()]/g, ' ').split(',').map(t => t.trim().split(/\s+/).map(Number)).filter(a => a.length >= 2).map(([x, y]) => P(x, y));
    const groups = s => s.split(/\)\s*,\s*\(/);
    if (kind === 'POINT') return (multi ? groups(body) : [body]).flatMap(g => pts(g)).map(p => ({ type: 'point', coords: [p] }));
    if (kind === 'LINESTRING') return (multi ? groups(body) : [body]).map(g => ({ type: 'line', coords: pts(g) }));
    // Polígonos: solo el anillo exterior de cada uno
    const polys = multi ? body.split(/\)\s*\)\s*,\s*\(\s*\(/) : [body];
    return polys.map(pg => ({ type: 'polygon', coords: dropClosing(pts(pg.split(/\)\s*,\s*\(/)[0])) }));
  }
  async function parseCSV(s, askCrs, layerName) {
    const rows = splitCSV(s);
    if (rows.length < 2) throw new Error('El CSV no tiene filas de datos.');
    const H = rows[0].map(norm), col = (...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
    const iName = col('nombre', 'name', 'punto', 'arbol', 'id', 'codigo', 'cod', 'no', 'numero', 'label');
    const iNote = col('nota', 'note', 'descripcion', 'description', 'observaciones', 'desc', 'comentario');
    const iWkt = col('wkt', 'geometry', 'geometria', 'the_geom'), iTipo = col('tipo', 'type');
    const iLat = col('latitud', 'latitude', 'lat', 'y_lat'), iLon = col('longitud', 'longitude', 'lon', 'long', 'lng', 'x_lon');
    const iAlt = col('altitud_m', 'altitud', 'altitude', 'elevacion', 'ele', 'alt', 'z');
    const iGx = col('gtm_x', 'x_gtm'), iGy = col('gtm_y', 'y_gtm');
    const iUe = col('utm_e', 'este_utm', 'easting'), iUn = col('utm_n', 'norte_utm', 'northing'), iUz = col('utm_zona', 'zona', 'zone', 'utm_zone');
    const iX = col('x', 'este', 'e', 'coord_x', 'coordx'), iY = col('y', 'norte', 'n', 'coord_y', 'coordy');
    const data = rows.slice(1);
    let mode, P, crs;
    if (iWkt >= 0) {
      const sample = data.slice(0, 30).flatMap(r => (String(r[iWkt]).match(/-?\d+(\.\d+)?\s+-?\d+(\.\d+)?/g) || []).slice(0, 2).map(t => t.split(/\s+/).map(Number)));
      crs = looksGeo(sample) ? { type: 'geo' } : await askCrs(`Las geometrías WKT de ${layerName} están en coordenadas proyectadas.`);
      if (!crs) return null; mode = 'wkt'; P = projector(crs);
    } else if (iLat >= 0 && iLon >= 0) { mode = 'xy'; crs = { type: 'geo' }; P = (x, y) => [y, x]; }
    else if (iGx >= 0 && iGy >= 0) { mode = 'gtm'; crs = CRS_PRESETS.gtm; P = projector(crs); }
    else if (iUe >= 0 && iUn >= 0 && iUz >= 0) { mode = 'utm'; crs = { type: 'utm' }; }
    else if ((iUe >= 0 && iUn >= 0) || (iX >= 0 && iY >= 0)) {
      mode = 'proj';
      const ix = iUe >= 0 ? iUe : iX, iy = iUe >= 0 ? iUn : iY;
      const sample = data.slice(0, 30).map(r => [num(r[ix]), num(r[iy])]).filter(p => isFinite(p[0]) && isFinite(p[1]));
      crs = looksGeo(sample) ? { type: 'geo' } : await askCrs(`El CSV ${layerName} tiene columnas X/Y (Este/Norte).`);
      if (!crs) return null; P = projector(crs);
    } else throw new Error('No encontré columnas de coordenadas. Usa latitud/longitud, gtm_x/gtm_y, utm_e/utm_n/utm_zona, x/y o wkt.');
    const out = [];
    data.forEach((r, i) => {
      const name = (iName >= 0 && r[iName] ? String(r[iName]).trim() : '') || `${layerName} ${i + 1}`;
      const note = iNote >= 0 ? String(r[iNote] || '').trim() : '';
      const alt = iAlt >= 0 ? num(r[iAlt]) : NaN;
      if (mode === 'wkt') {
        const tipo = iTipo >= 0 ? norm(String(r[iTipo] || '')) : '';
        parseWKT(r[iWkt], P).forEach(g => out.push({ type: g.type === 'line' && tipo === 'track' ? 'track' : g.type, name, note, coords: g.coords }));
        return;
      }
      let la, lo;
      if (mode === 'xy') { la = num(r[iLat]); lo = num(r[iLon]); }
      else if (mode === 'gtm') [la, lo] = P(num(r[iGx]), num(r[iGy]));
      else if (mode === 'utm') { const z = String(r[iUz]); [la, lo] = Geo.fromUTM(num(r[iUe]), num(r[iUn]), parseInt(z), /s/i.test(z)); }
      else { const ix = iUe >= 0 ? iUe : iX, iy = iUe >= 0 ? iUn : iY; [la, lo] = P(num(r[ix]), num(r[iy])); }
      if (isFinite(la) && isFinite(lo)) out.push({ type: 'point', name, note, coords: [isFinite(alt) ? [la, lo, alt] : [la, lo]] });
    });
    return { features: out.filter(f => f.coords.length && valid(f.coords) && (f.type !== 'polygon' || f.coords.length >= 3) && (f.type === 'point' || f.coords.length >= 2)), crs };
  }

  // ---------- Entrada principal ----------
  // files: File[]; askCrs(motivo) -> Promise<crs|null>. Devuelve { features, overlays: [{name, corners, blob}], warnings }
  async function readFiles(files, askCrs) {
    let entries = [];
    for (const f of files) {
      const e = ext(f.name);
      if (e === 'zip' || e === 'kmz') {
        const zs = unzip(await f.arrayBuffer());
        entries.push(...zs.map(z => ({ ...z, name: z.name, from: f.name })));
      } else entries.push({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()), from: f.name });
    }
    const byStem = {};
    for (const e of entries) (byStem[stem(e.name)] = byStem[stem(e.name)] || {})[ext(e.name)] = e;
    const features = [], overlays = [], warnings = [];
    const ask = async msg => { const c = await askCrs(msg); return c ? (CRS_PRESETS[c] || c) : null; };
    const push = (r, label) => {
      if (!r) return;
      r.features.forEach(f => { f.layer = label; });
      features.push(...r.features);
      if (r.crs && r.crs.datumWarn) warnings.push(`${label}: usa el datum NAD27; puede haber un desplazamiento de unos 200 m.`);
    };
    let recognized = 0;
    for (const e of entries) {
      const x = ext(e.name), label = base(e.name);
      try {
        if (x === 'kml') {
          recognized++;
          const r = parseKML(await text(e));
          push(r, label);
          for (const o of r.overlays) {
            const want = o.href.replace(/^\.?\//, '').toLowerCase();
            const img = entries.find(z => z.name.toLowerCase() === want) || entries.find(z => base(z.name).toLowerCase() === base(want));
            if (img) overlays.push({ name: o.name, corners: o.corners, blob: new Blob([await img.bytes()], { type: /\.png$/i.test(img.name) ? 'image/png' : 'image/jpeg' }) });
            else warnings.push(`La imagen "${o.href}" de ${label} no está dentro del archivo; no se pudo crear ese mapa.`);
          }
        } else if (x === 'gpx') { recognized++; push(parseGPX(await text(e)), label); }
        else if (x === 'geojson' || x === 'json') { recognized++; push(await parseGeoJSON(await text(e), ask), label); }
        else if (x === 'csv' || x === 'txt') { recognized++; push(await parseCSV(await text(e), ask, stem(e.name)), label); }
        else if (x === 'shp') {
          recognized++;
          const g = byStem[stem(e.name)];
          if (!g.dbf) warnings.push(`${label}: falta el archivo .dbf; se importa sin nombres ni atributos.`);
          push(await parseShapefile(e, g.dbf, g.prj, g.cpg, ask, stem(e.name)), label);
        }
      } catch (err) { warnings.push(`${label}: ${err.message || err}`); }
    }
    if (!recognized) throw new Error('No encontré archivos KML, KMZ, GPX, GeoJSON, Shapefile (.shp) ni CSV.');
    return { features, overlays, warnings };
  }

  root.Formats = { readFiles, isVector, parsePrj, parseWKT, splitCSV, CRS_PRESETS, unzip };
})(typeof globalThis !== 'undefined' ? globalThis : this);
