const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const local = path.join(root, 'config.local.json');
const config = JSON.parse(fs.readFileSync(fs.existsSync(local) ? local : path.join(root, 'config.example.json'), 'utf8'));
const args = process.argv.slice(2);
let playbackTest = false;
for (const arg of args) {
  if (arg === '--playback-test') playbackTest = true;
  else if (arg === '--playback-test=channel') playbackTest = 'channel';
  else if (/^--player-engine=(avplay|html5)$/.test(arg)) config.playerEngine = arg.split('=')[1];
  else if (/^--stream-format=(m3u8|ts)$/.test(arg)) config.streamFormat = arg.split('=')[1];
  else throw new Error('Usa --player-engine=avplay|html5, --stream-format=m3u8|ts, --playback-test o --playback-test=channel.');
}
if (config.playerEngine === undefined) config.playerEngine = 'avplay';
if (config.streamFormat === undefined) config.streamFormat = 'm3u8';
if (!['avplay', 'html5'].includes(config.playerEngine)) throw new Error('playerEngine debe ser avplay o html5.');
if (!['m3u8', 'ts'].includes(config.streamFormat)) throw new Error('streamFormat debe ser m3u8 o ts.');
if (config.apiBaseUrl && !/^https?:\/\/[^\s?#]+$/i.test(config.apiBaseUrl)) throw new Error('apiBaseUrl debe ser una URL HTTP(S) sin query ni fragmento.');
for (const key of ['requestTimeoutMs', 'playbackTimeoutMs']) {
  if (!Number.isFinite(config[key]) || config[key] < 1000 || config[key] > 120000) throw new Error(key + ' debe estar entre 1000 y 120000.');
}
const dist = path.join(root, 'dist');
const captured = path.join(root, '.diagnostics/channel.ts');
if (playbackTest === 'channel' && !fs.existsSync(captured)) throw new Error('Primero ejecuta npm run capture-test. No hay captura local del canal.');
// Keep the workspace directory: Windows can lock it while VS Code or a shell uses it.
fs.mkdirSync(dist, { recursive: true });
for (const name of fs.readdirSync(dist)) {
  fs.rmSync(path.join(dist, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
fs.cpSync(path.join(root, 'src'), dist, { recursive: true });
fs.cpSync(path.join(root, 'platform'), dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'config.js'), 'window.TCPLAY_CONFIG = ' + JSON.stringify(config).replace(/</g, '\\u003c') + ';\n');
const html = path.join(dist, 'index.html');
if (playbackTest) fs.copyFileSync(path.join(dist, 'playback-test.html'), html);
if (playbackTest === 'channel') {
  fs.copyFileSync(captured, path.join(dist, 'assets/channel-test.ts'));
  const testHtml = fs.readFileSync(html, 'utf8')
    .replace('20 segundos. El cuadro debe moverse sin pausas y el tono debe sonar continuo.', 'Canal capturado: observa si aparecen los mismos cortes de video o audio.')
    .replace('src="assets/playback-test.mp4"', 'data-test-source="captured-ts" src="assets/channel-test.ts"');
  fs.writeFileSync(html, testHtml);
}
const samsung = fs.existsSync(path.join(dist, 'config.xml'));
fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<!-- PLATFORM_SCRIPTS -->', samsung ? '<script src="$WEBAPIS/webapis/webapis.js"></script>' : ''));
console.log('Aplicación ' + (samsung ? 'Samsung' : 'LG') + ' preparada en dist/.');
if (playbackTest) console.log('Prueba local preparada: video HTML5 con ' + (playbackTest === 'channel' ? 'TS capturado' : 'MP4 incluido') + ', sin login ni red.');
else {
  console.log('Motor de reproducción: ' + config.playerEngine + '.');
  console.log('Salida directa de Xtream: ' + config.streamFormat + '.');
  if (!config.apiBaseUrl) console.log('Configura config.local.json antes de probar el login real.');
}
