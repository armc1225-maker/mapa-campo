// Ajusta el proyecto Android que genera Capacitor: permisos (GPS y cámara), versión e ícono.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const app = path.join(__dirname, 'android', 'app');
const manifest = path.join(app, 'src', 'main', 'AndroidManifest.xml');
let m = fs.readFileSync(manifest, 'utf8');
const perms = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
].filter(p => !m.includes(p));
m = m.replace('<application', perms.join('\n    ') + '\n\n    <application');
fs.writeFileSync(manifest, m);

// Número de versión = número de compilación de GitHub Actions
const run = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10);
const gradle = path.join(app, 'build.gradle');
let gr = fs.readFileSync(gradle, 'utf8');
gr = gr.replace(/versionCode \d+/, `versionCode ${run}`).replace(/versionName "[^"]*"/, `versionName "1.${run}"`);
fs.writeFileSync(gradle, gr);

// Íconos a partir de icon.svg (requiere rsvg-convert)
const svg = path.resolve(__dirname, '..', 'icon.svg');
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const res = path.join(app, 'src', 'main', 'res');
for (const [d, s] of Object.entries(sizes)) {
  const dir = path.join(res, 'mipmap-' + d);
  if (!fs.existsSync(dir)) continue;
  for (const n of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    execFileSync('rsvg-convert', ['-w', String(s), '-h', String(s), '-o', path.join(dir, n), svg]);
  }
}
// Sin ícono adaptable: usa los PNG anteriores en todas las versiones de Android
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
console.log('Proyecto Android ajustado');
