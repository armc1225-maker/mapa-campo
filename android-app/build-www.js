// Copia la app web a www/ y reemplaza las librerías de la CDN por copias locales,
// para que la APK abra sin internet desde la primera vez.
const fs = require('fs'), path = require('path');
const src = path.resolve(__dirname, '..'), out = path.join(__dirname, 'www'), lib = path.join(out, 'lib');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(lib, { recursive: true });
for (const f of ['index.html', 'app.js', 'geo.js', 'formats.js', 'icon.svg', 'manifest.webmanifest']) fs.copyFileSync(path.join(src, f), path.join(out, f));
const nm = path.join(__dirname, 'node_modules');
fs.copyFileSync(path.join(nm, 'leaflet/dist/leaflet.css'), path.join(lib, 'leaflet.css'));
fs.copyFileSync(path.join(nm, 'leaflet/dist/leaflet.js'), path.join(lib, 'leaflet.js'));
fs.cpSync(path.join(nm, 'leaflet/dist/images'), path.join(lib, 'images'), { recursive: true });
fs.copyFileSync(path.join(nm, 'pdfjs-dist/build/pdf.min.js'), path.join(lib, 'pdf.min.js'));
fs.copyFileSync(path.join(nm, 'pdfjs-dist/build/pdf.worker.min.js'), path.join(lib, 'pdf.worker.min.js'));
const swap = (file, pairs) => {
  const p = path.join(out, file); let t = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) { if (!t.includes(a)) throw new Error(`${file}: no se encontró ${a}`); t = t.split(a).join(b); }
  fs.writeFileSync(p, t);
};
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
swap('index.html', [
  [CDN + 'leaflet/1.9.4/leaflet.min.css', 'lib/leaflet.css'],
  [CDN + 'leaflet/1.9.4/leaflet.min.js', 'lib/leaflet.js'],
  [CDN + 'pdf.js/3.11.174/pdf.min.js', 'lib/pdf.min.js'],
  ['<link rel="manifest" href="manifest.webmanifest">', ''],
]);
swap('app.js', [[CDN + 'pdf.js/3.11.174/pdf.worker.min.js', 'lib/pdf.worker.min.js']]);
console.log('www listo');
