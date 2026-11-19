/* Mapa de Campo — geodesia, georreferencia, lectura de GeoPDF y exportación.
   Sin dependencias: se usa en el navegador (window.Geo) y en Node para pruebas. */
(function (root) {
  'use strict';

  // ---------- Elipsoide WGS84 y proyección Transversa de Mercator ----------
  const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2);
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function meridianArc(phi) {
    const e4 = E2 * E2, e6 = e4 * E2;
    return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi));
  }

  // p = { lon0, lat0 = 0, k0, fe, fn }
  function tmForward(lat, lon, p) {
    const phi = lat * D2R, lam = (lon - p.lon0) * D2R;
    const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
    const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, Aa = c * lam;
    const M = meridianArc(phi), M0 = meridianArc((p.lat0 || 0) * D2R);
    const x = p.fe + p.k0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120);
    const y = p.fn + p.k0 * (M - M0 + N * t * (Aa * Aa / 2
      + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720));
    return [x, y];
  }

  function tmInverse(x, y, p) {
    const M = meridianArc((p.lat0 || 0) * D2R) + (y - p.fn) / p.k0;
    const e4 = E2 * E2, e6 = e4 * E2;
    const mu = M / (A * (1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
    const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
    const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
      + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
      + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
    const C1 = EP2 * c * c, T1 = t * t, N1 = A / Math.sqrt(1 - E2 * s * s);
    const R1 = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5);
    const D = (x - p.fe) / (N1 * p.k0);
    const lat = phi1 - (N1 * t / R1) * (D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = p.lon0 * D2R + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
    return [lat * R2D, lon * R2D];
  }

  // GTM: Guatemala Transverse Mercator (WGS84, MC -90°30', k0 0.9998)
  const GTM = { lon0: -90.5, lat0: 0, k0: 0.9998, fe: 500000, fn: 0 };
  function utmParams(zone, south) {
    return { lon0: zone * 6 - 183, lat0: 0, k0: 0.9996, fe: 500000, fn: south ? 10000000 : 0 };
  }
  function utmZone(lon) { return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1)); }

  function toUTM(lat, lon, zone) {
    zone = zone || utmZone(lon);
    const [e, n] = tmForward(lat, lon, utmParams(zone, lat < 0));
    return { zone, south: lat < 0, e, n };
  }
  function fromUTM(e, n, zone, south) { return tmInverse(e, n, utmParams(zone, south)); }
  function toGTM(lat, lon) { return tmForward(lat, lon, GTM); }
  function fromGTM(x, y) { return tmInverse(x, y, GTM); }

  // ---------- Medidas ----------
  const R_EARTH = 6371008.8;
  function haversine(a, b) {
    const dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function pathLength(coords, closed) {
    let d = 0;
    for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
    if (closed && coords.length > 2) d += haversine(coords[coords.length - 1], coords[0]);
    return d;
  }
  // Área geodésica aproximada: TM local centrada en el polígono (error despreciable < 50 km).
  function polygonArea(coords) {
    if (coords.length < 3) return 0;
    let la = 0, lo = 0;
    for (const c of coords) { la += c[0]; lo += c[1]; }
    const p = { lon0: lo / coords.length, lat0: la / coords.length, k0: 1, fe: 0, fn: 0 };
    const xy = coords.map(c => tmForward(c[0], c[1], p));
    let s = 0;
    for (let i = 0; i < xy.length; i++) {
      const j = (i + 1) % xy.length;
      s += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1];
    }
    return Math.abs(s) / 2;
  }

  // ---------- Georreferencia: lat/lon <-> píxel de la imagen ----------
  function solve3(M, b) {
    const a = M.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-12) return null;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  }

  // points: [{x, y, lat, lon}] (x, y en píxeles). Devuelve un objeto serializable o lanza error.
  function fitGeoref(points, source) {
    const n = points.length;
    if (n < 2) throw new Error('Se necesitan al menos 2 puntos de control.');
    let la = 0, lo = 0;
    for (const p of points) { la += p.lat; lo += p.lon; }
    const ref = { lat: la / n, lon: lo / n };
    const proj = { lon0: ref.lon, lat0: ref.lat, k0: 1, fe: 0, fn: 0 };
    const XY = points.map(p => tmForward(p.lat, p.lon, proj));
    let M;
    if (n === 2) {
      const dX = XY[1][0] - XY[0][0], dY = XY[1][1] - XY[0][1];
      const dpx = points[1].x - points[0].x, dpy = points[1].y - points[0].y;
      const det = dX * dX + dY * dY;
      if (det < 1e-6) throw new Error('Los 2 puntos tienen las mismas coordenadas.');
      const a = (dX * dpx - dY * dpy) / det, b = (dY * dpx + dX * dpy) / det;
      M = [a, b, points[0].x - a * XY[0][0] - b * XY[0][1], b, -a, points[0].y - b * XY[0][0] + a * XY[0][1]];
    } else {
      let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0;
      let bx = [0, 0, 0], by = [0, 0, 0];
      XY.forEach(([X, Y], i) => {
        const { x, y } = points[i];
        sxx += X * X; sxy += X * Y; syy += Y * Y; sx += X; sy += Y;
        bx[0] += X * x; bx[1] += Y * x; bx[2] += x;
        by[0] += X * y; by[1] += Y * y; by[2] += y;
      });
      const N = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
      const r1 = solve3(N, bx), r2 = solve3(N, by);
      if (!r1 || !r2) throw new Error('Los puntos de control están alineados; use puntos repartidos por el mapa.');
      M = [...r1, ...r2];
    }
    const det = M[0] * M[4] - M[1] * M[3];
    if (Math.abs(det) < 1e-12) throw new Error('Georreferencia inválida.');
    const g = { ref, M, points: points.map(p => ({ x: p.x, y: p.y, lat: p.lat, lon: p.lon })), source: source || 'manual' };
    // Residuos en metros
    let ss = 0;
    g.points.forEach((p, i) => {
      const [X, Y] = pxToXY(g, p.x, p.y);
      p.err = Math.hypot(X - XY[i][0], Y - XY[i][1]);
      ss += p.err * p.err;
    });
    g.rms = n > (n === 2 ? 2 : 3) ? Math.sqrt(ss / n) : 0;
    g.mpp = 1 / Math.sqrt(Math.abs(det)); // metros por píxel
    return g;
  }
  function projOf(g) { return { lon0: g.ref.lon, lat0: g.ref.lat, k0: 1, fe: 0, fn: 0 }; }
  function geoToPx(g, lat, lon) {
    const [X, Y] = tmForward(lat, lon, projOf(g));
    const M = g.M;
    return [M[0] * X + M[1] * Y + M[2], M[3] * X + M[4] * Y + M[5]];
  }
  function pxToXY(g, x, y) {
    const M = g.M, det = M[0] * M[4] - M[1] * M[3];
    const dx = x - M[2], dy = y - M[5];
    return [(M[4] * dx - M[1] * dy) / det, (-M[3] * dx + M[0] * dy) / det];
  }
  function pxToGeo(g, x, y) {
    const [X, Y] = pxToXY(g, x, y);
    return tmInverse(X, Y, projOf(g));
  }

  // ---------- Formato de coordenadas ----------
  function dms(v, pos, neg) {
    const h = v < 0 ? neg : pos; v = Math.abs(v);
    let d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
    if (s >= 59.95) { s = 0; m++; } if (m >= 60) { m = 0; d++; }
    return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${h}`;
  }
  function formatCoord(lat, lon, fmt) {
    switch (fmt) {
      case 'dms': return `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'O')}`;
      case 'utm': { const u = toUTM(lat, lon); return `UTM ${u.zone}${u.south ? 'S' : 'N'}  ${Math.round(u.e)} E  ${Math.round(u.n)} N`; }
      case 'gtm': { const [x, y] = toGTM(lat, lon); return `GTM  ${Math.round(x)} X  ${Math.round(y)} Y`; }
      default: return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }
  }
  const M2_PER_MZ = 6987.5; // manzana (Guatemala) ≈ 6 987.5 m²
  function formatLength(m) { return m >= 1000 ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(1)} m`; }
  function formatArea(m2) {
    return `${(m2 / 10000).toFixed(4)} ha · ${(m2 / M2_PER_MZ).toFixed(3)} mz · ${Math.round(m2).toLocaleString('es-GT')} m²`;
  }

  // ---------- Lectura mínima de PDF para encontrar la georreferencia (ISO 32000 /VP /Measure /GEO) ----------
  const WS = ' \t\r\n\f\0', DELIM = '()<>[]{}/%';
  function skipWs(s, i) {
    for (;;) {
      while (i < s.length && WS.includes(s[i])) i++;
      if (s[i] === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      return i;
    }
  }
  function readToken(s, i) {
    let j = i;
    while (j < s.length && !WS.includes(s[j]) && !DELIM.includes(s[j])) j++;
    return [s.slice(i, j), j];
  }
  const NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/;
  function parseValue(s, i) {
    i = skipWs(s, i);
    const c = s[i];
    if (c === '<' && s[i + 1] === '<') {
      const d = {}; i += 2;
      for (;;) {
        i = skipWs(s, i);
        if (i >= s.length) return [d, i];
        if (s[i] === '>' && s[i + 1] === '>') return [d, i + 2];
        if (s[i] !== '/') { i++; continue; }
        const [k, j] = readToken(s, i + 1);
        const [v, j2] = parseValue(s, j);
        d[k] = v; i = j2;
      }
    }
    if (c === '<') { const j = s.indexOf('>', i); return [{ str: '' }, j < 0 ? s.length : j + 1]; }
    if (c === '[') {
      const a = []; i++;
      for (;;) {
        i = skipWs(s, i);
        if (i >= s.length) return [a, i];
        if (s[i] === ']') return [a, i + 1];
        const [v, j] = parseValue(s, i);
        if (j <= i) return [a, i + 1];
        a.push(v); i = j;
      }
    }
    if (c === '(') {
      let depth = 0, j = i, out = '';
      for (; j < s.length; j++) {
        const ch = s[j];
        if (ch === '\\') { out += s[j + 1] || ''; j++; continue; }
        if (ch === '(') { if (depth++) out += ch; continue; }
        if (ch === ')') { if (--depth === 0) break; out += ch; continue; }
        out += ch;
      }
      return [{ str: out }, j + 1];
    }
    if (c === '/') { const [t, j] = readToken(s, i + 1); return ['/' + t, j]; }
    const [t, j] = readToken(s, i);
    if (!t) return [null, i + 1];
    if (NUM.test(t)) {
      // ¿Referencia indirecta "n g R"?
      const m = /^\s+(\d+)\s+R(?=[\s\/\]>\[<(%]|$)/.exec(s.slice(j, j + 24));
      if (/^\d+$/.test(t) && m) return [{ ref: +t }, j + m[0].length];
      return [parseFloat(t), j];
    }
    if (t === 'true') return [true, j];
    if (t === 'false') return [false, j];
    if (t === 'null') return [null, j];
    return [{ kw: t }, j];
  }

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    const w = ds.writable.getWriter();
    w.write(bytes).catch(() => {}); w.close().catch(() => {});
    const r = ds.readable.getReader(), parts = [];
    let n = 0;
    try { for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); n += value.length; } }
    catch (e) { if (!n) throw e; } // datos sobrantes tras el final: conserva lo leído
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };

  // Devuelve [{ bbox:[x1,y1,x2,y2], gpts:[lat,lon,...], lpts:[x,y,...] }] para la página indicada.
  async function readGeoPdf(bytes, pageObjNum) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const s = latin1(bytes);
    if (!s.includes('/GPTS') && !s.includes('/ObjStm')) return [];
    const objs = {};
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      try {
        const [val, j] = parseValue(s, m.index + m[0].length);
        const k = skipWs(s, j);
        objs[m[1]] = { val, stream: s.startsWith('stream', k) ? k + 6 : -1 };
        if (j > re.lastIndex) re.lastIndex = j;
      } catch (e) { /* objeto ilegible: se ignora */ }
    }
    const resolve = v => { let g = 0; while (v && typeof v === 'object' && 'ref' in v && g++ < 32) v = objs[v.ref] && objs[v.ref].val; return v; };
    const streamBytes = o => {
      let i = o.stream;
      if (s[i] === '\r') i++;
      if (s[i] === '\n') i++;
      let len = resolve(o.val.Length);
      if (typeof len !== 'number' || len <= 0 || i + len > bytes.length) {
        const e = s.indexOf('endstream', i); len = (e < 0 ? bytes.length : e) - i;
      }
      return bytes.subarray(i, i + len);
    };
    // Flujos de objetos comprimidos (PDF 1.5+)
    for (const num of Object.keys(objs)) {
      const o = objs[num], d = o.val;
      if (!d || o.stream < 0 || d.Type !== '/ObjStm') continue;
      const f = resolve(d.Filter), filt = Array.isArray(f) ? f.map(resolve) : [f];
      if (filt.some(x => x && x !== '/FlateDecode')) continue;
      try {
        const raw = streamBytes(o);
        const txt = latin1(filt[0] ? await inflate(raw) : raw);
        const head = txt.slice(0, d.First).trim().split(/\s+/).map(Number);
        for (let k = 0; k + 1 < head.length; k += 2) {
          if (objs[head[k]]) continue;
          const [val] = parseValue(txt, d.First + head[k + 1]);
          objs[head[k]] = { val, stream: -1 };
        }
      } catch (e) { /* flujo dañado */ }
    }
    let page = pageObjNum != null && objs[pageObjNum] ? objs[pageObjNum].val : null;
    if (!page || !page.VP) {
      page = null;
      for (const k of Object.keys(objs)) {
        const v = objs[k].val;
        if (v && v.Type === '/Page' && v.VP) { page = v; break; }
      }
    }
    if (!page) return [];
    let vp = resolve(page.VP);
    if (!Array.isArray(vp)) vp = [vp];
    const out = [];
    for (let e of vp) {
      e = resolve(e);
      if (!e) continue;
      const meas = resolve(e.Measure);
      if (!meas || resolve(meas.Subtype) !== '/GEO') continue;
      const nums = v => (resolve(v) || []).map(resolve).filter(x => typeof x === 'number');
      const bbox = nums(e.BBox), gpts = nums(meas.GPTS);
      let lpts = nums(meas.LPTS);
      if (bbox.length !== 4 || gpts.length < 4) continue;
      if (lpts.length !== gpts.length) lpts = [0, 1, 0, 0, 1, 0, 1, 1].slice(0, gpts.length);
      out.push({ bbox, gpts, lpts });
    }
    return out;
  }

  // ---------- Exportación ----------
  const xml = t => String(t == null ? '' : t).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const kmlColor = hex => { const h = (hex || '#e4572e').replace('#', ''); return 'ff' + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); };
  const iso = t => t ? new Date(t).toISOString() : '';
  function measures(f) {
    const r = {};
    if (f.type === 'line' || f.type === 'track') r.length = pathLength(f.coords);
    if (f.type === 'polygon') { r.area = polygonArea(f.coords); r.perimeter = pathLength(f.coords, true); }
    return r;
  }
  function describe(f) {
    const m = measures(f), parts = [];
    if (f.note) parts.push(f.note);
    if (m.length != null) parts.push('Longitud: ' + formatLength(m.length));
    if (m.area != null) parts.push('Área: ' + formatArea(m.area), 'Perímetro: ' + formatLength(m.perimeter));
    if (f.type === 'point' && f.coords[0][3] != null) parts.push(`Precisión GPS: ±${Math.round(f.coords[0][3])} m`);
    return parts.join('\n');
  }
  const kc = c => `${c[1].toFixed(7)},${c[0].toFixed(7)}${c[2] != null ? ',' + c[2].toFixed(1) : ''}`;

  function toKML(features, name) {
    const pm = features.map(f => {
      let geom;
      if (f.type === 'point') geom = `<Point><coordinates>${kc(f.coords[0])}</coordinates></Point>`;
      else if (f.type === 'polygon') geom = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${[...f.coords, f.coords[0]].map(kc).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      else geom = `<LineString><tessellate>1</tessellate><coordinates>${f.coords.map(kc).join(' ')}</coordinates></LineString>`;
      const col = kmlColor(f.color);
      const style = `<Style><IconStyle><color>${col}</color></IconStyle><LineStyle><color>${col}</color><width>3</width></LineStyle><PolyStyle><color>${'55' + col.slice(2)}</color></PolyStyle></Style>`;
      return `  <Placemark><name>${xml(f.name)}</name><description>${xml(describe(f))}</description>${f.created ? `<TimeStamp><when>${iso(f.created)}</when></TimeStamp>` : ''}${style}${geom}</Placemark>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>\n${pm}\n</Document></kml>\n`;
  }

  function toGPX(features, name) {
    const pt = (tag, c) => `<${tag} lat="${c[0].toFixed(7)}" lon="${c[1].toFixed(7)}">${c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : ''}${c[4] ? `<time>${iso(c[4])}</time>` : ''}</${tag}>`;
    const wpts = features.filter(f => f.type === 'point').map(f => {
      const c = f.coords[0];
      return `<wpt lat="${c[0].toFixed(7)}" lon="${c[1].toFixed(7)}">${c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : ''}${f.created ? `<time>${iso(f.created)}</time>` : ''}<name>${xml(f.name)}</name><desc>${xml(describe(f))}</desc></wpt>`;
    });
    const trks = features.filter(f => f.type !== 'point').map(f => {
      const cs = f.type === 'polygon' ? [...f.coords, f.coords[0]] : f.coords;
      return `<trk><name>${xml(f.name)}</name><desc>${xml(describe(f))}</desc><type>${f.type === 'polygon' ? 'area' : f.type}</type><trkseg>${cs.map(c => pt('trkpt', c)).join('')}</trkseg></trk>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mapa de Campo" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(name)}</name></metadata>\n${[...wpts, ...trks].join('\n')}\n</gpx>\n`;
  }

  function toCSV(features) {
    const q = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const tipo = { point: 'punto', line: 'línea', track: 'track', polygon: 'área' };
    const head = ['tipo', 'nombre', 'nota', 'latitud', 'longitud', 'altitud_m', 'precision_m', 'gtm_x', 'gtm_y', 'utm_zona', 'utm_e', 'utm_n', 'fecha', 'longitud_m', 'perimetro_m', 'area_m2', 'area_ha', 'area_mz', 'vertices', 'wkt'];
    const rows = features.map(f => {
      const m = measures(f), c = f.coords;
      let lat, lon;
      if (f.type === 'point') [lat, lon] = c[0];
      else { lat = c.reduce((s, p) => s + p[0], 0) / c.length; lon = c.reduce((s, p) => s + p[1], 0) / c.length; }
      const [gx, gy] = toGTM(lat, lon), u = toUTM(lat, lon);
      const w = p => `${p[1].toFixed(7)} ${p[0].toFixed(7)}`;
      const wkt = f.type === 'point' ? `POINT (${w(c[0])})` : f.type === 'polygon' ? `POLYGON ((${[...c, c[0]].map(w).join(', ')}))` : `LINESTRING (${c.map(w).join(', ')})`;
      return [tipo[f.type], f.name, f.note, lat.toFixed(7), lon.toFixed(7),
        f.type === 'point' && c[0][2] != null ? c[0][2].toFixed(1) : '',
        f.type === 'point' && c[0][3] != null ? c[0][3].toFixed(1) : '',
        gx.toFixed(2), gy.toFixed(2), u.zone + (u.south ? 'S' : 'N'), u.e.toFixed(2), u.n.toFixed(2),
        iso(f.created), m.length != null ? m.length.toFixed(2) : '', m.perimeter != null ? m.perimeter.toFixed(2) : '',
        m.area != null ? m.area.toFixed(2) : '', m.area != null ? (m.area / 10000).toFixed(4) : '',
        m.area != null ? (m.area / M2_PER_MZ).toFixed(4) : '', c.length, wkt].map(q).join(',');
    });
    return '﻿' + [head.join(','), ...rows].join('\r\n') + '\r\n';
  }

  const Geo = {
    tmForward, tmInverse, toUTM, fromUTM, toGTM, fromGTM, utmZone, GTM,
    haversine, pathLength, polygonArea, fitGeoref, geoToPx, pxToGeo,
    formatCoord, formatLength, formatArea, M2_PER_MZ, readGeoPdf, parseValue,
    measures, toKML, toGPX, toCSV
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
  root.Geo = Geo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
