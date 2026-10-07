const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const local = path.join(root, 'config.local.json');
const config = JSON.parse(fs.readFileSync(fs.existsSync(local) ? local : path.join(root, 'config.example.json'), 'utf8'));
if (config.apiBaseUrl && !/^https?:\/\/[^\s?#]+$/i.test(config.apiBaseUrl)) throw new Error('apiBaseUrl debe ser una URL HTTP(S) sin query ni fragmento.');
for (const key of ['requestTimeoutMs', 'playbackTimeoutMs']) {
  if (!Number.isFinite(config[key]) || config[key] < 1000 || config[key] > 120000) throw new Error(key + ' debe estar entre 1000 y 120000.');
}
const dist = path.join(root, 'dist');
// Keep the workspace directory: Windows can lock it while VS Code or a shell uses it.
fs.mkdirSync(dist, { recursive: true });
for (const name of fs.readdirSync(dist)) {
  fs.rmSync(path.join(dist, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
fs.cpSync(path.join(root, 'src'), dist, { recursive: true });
fs.cpSync(path.join(root, 'platform'), dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'config.js'), 'window.TCPLAY_CONFIG = ' + JSON.stringify(config).replace(/</g, '\\u003c') + ';\n');
const html = path.join(dist, 'index.html');
const samsung = fs.existsSync(path.join(dist, 'config.xml'));
fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<!-- PLATFORM_SCRIPTS -->', samsung ? '<script src="$WEBAPIS/webapis/webapis.js"></script>' : ''));
console.log('Aplicación ' + (samsung ? 'Samsung' : 'LG') + ' preparada en dist/.');
if (!config.apiBaseUrl) console.log('Configura config.local.json antes de probar el login real.');
