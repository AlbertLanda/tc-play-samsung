// Developer-only capture: direct TS bytes, no decoder/transcoder, no saved credentials.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function validHttpUrl(value) {
  try { return typeof value === 'string' && !/\s/.test(value) && ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}
async function post(apiBaseUrl, endpoint, body, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(apiBaseUrl.replace(/\/+$/, '') + '/api/xtream/' + endpoint + '/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal
    });
    if (!response.ok) throw new Error('API');
    const data = await response.json();
    if (data.success === false) throw new Error('API');
    return data;
  } catch { throw new Error('No se pudo consultar la API. Revisa configuración, cuenta y conexión.'); }
  finally { clearTimeout(timer); }
}
function looksLikeTs(buffer) {
  for (let offset = 0; offset < 188 && offset + 4 * 188 < buffer.length; offset++) {
    if ([0, 1, 2, 3, 4].every(n => buffer[offset + n * 188] === 0x47)) return true;
  }
  return false;
}
async function capture(url, destination, { durationMs = 30000, maxBytes = 50 * 1024 * 1024, fetcher = fetch } = {}) {
  if (!validHttpUrl(url)) throw new Error('La API no devolvió una URL HTTP(S) válida.');
  const controller = new AbortController();
  let timer, reader, fd, bytes = 0, prefix = Buffer.alloc(0), reachedLimit = false, failed = false;
  const cancel = () => { failed = true; controller.abort(); };
  process.once('SIGINT', cancel);
  const temporary = destination + '.' + process.pid + '.' + Date.now() + '.part';
  try {
    timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Stream');
    clearTimeout(timer);
    timer = setTimeout(() => { reachedLimit = true; controller.abort(); }, durationMs);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fd = fs.openSync(temporary, 'wx', 0o600);
    reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const data = Buffer.from(chunk.value).subarray(0, maxBytes - bytes);
      if (prefix.length < 1128) prefix = Buffer.concat([prefix, data.subarray(0, 1128 - prefix.length)]);
      fs.writeSync(fd, data); bytes += data.length;
      if (bytes >= maxBytes) { reachedLimit = true; break; }
    }
  } catch {
    if (!reachedLimit) failed = true;
  } finally {
    process.removeListener('SIGINT', cancel);
    clearTimeout(timer); controller.abort();
    if (reader) { try { await reader.cancel(); } catch {} }
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (failed) {
    fs.rmSync(temporary, { force: true });
    throw new Error('No se pudo capturar el canal. Cierra otros reproductores y revisa la conexión.');
  }
  if (bytes < 188 * 100 || !looksLikeTs(prefix)) {
    fs.rmSync(temporary, { force: true });
    throw new Error('La respuesta no contiene suficiente video TS válido. Conserva cualquier captura anterior.');
  }
  try { fs.renameSync(temporary, destination); }
  catch {
    fs.rmSync(temporary, { force: true });
    throw new Error('No se pudo guardar el archivo. Cierra el reproductor que lo tenga abierto.');
  }
  return { bytes, reachedLimit };
}
function question(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(label, value => { rl.close(); resolve(value.trim()); }));
}
function password() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Ejecuta este comando en una terminal interactiva para ocultar la contraseña.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write('Contraseña (oculta): ');
    process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
    function finish(error) {
      process.stdin.removeListener('data', onData); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    }
    function onData(chunk) {
      if (chunk.includes('\u001b')) return;
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') { finish(new Error('Captura cancelada.')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    }
    process.stdin.on('data', onData);
  });
}
async function main() {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.local.json'), 'utf8'));
  if (!validHttpUrl(config.apiBaseUrl) || /[?#]/.test(config.apiBaseUrl)) throw new Error('Configura apiBaseUrl en config.local.json.');
  console.log('Cierra TC Play en Android y en el emulador antes de capturar. Se abrirá una sola conexión al canal.');
  const username = await question('Usuario: ');
  const credentials = { username, password: await password() };
  if (!credentials.username || !credentials.password) throw new Error('Usuario y contraseña son obligatorios.');
  try {
    const data = await post(config.apiBaseUrl, 'live/streams', credentials);
    const search = (await question('Nombre del canal [WILLAX]: ') || 'WILLAX').toLowerCase();
    const matches = (data.channels || []).filter(c => c && /^\d+$/.test(String(c.id)) && typeof c.name === 'string' && c.name.toLowerCase().includes(search));
    if (!matches.length) throw new Error('No se encontró el canal. Repite con parte de su nombre.');
    // JSON escaping prevents provider-supplied channel names from controlling the terminal.
    matches.slice(0, 20).forEach((c, i) => console.log((i + 1) + '. ' + JSON.stringify(c.name)));
    const selected = matches.length === 1 ? 1 : Number(await question('Número del canal: '));
    if (!Number.isInteger(selected) || selected < 1 || selected > Math.min(20, matches.length)) throw new Error('Número de canal no válido.');
    const stream = await post(config.apiBaseUrl, 'live/stream-url', { ...credentials, stream_id: String(matches[selected - 1].id), output: 'ts' });
    credentials.password = ''; credentials.username = '';
    console.log('Capturando hasta 30 segundos o 50 MB de TS directo…');
    const result = await capture(stream.stream_url, path.join(root, '.diagnostics/channel.ts'));
    stream.stream_url = '';
    console.log('Captura guardada en .diagnostics/channel.ts (' + (result.bytes / 1024 / 1024).toFixed(1) + ' MB).');
    console.log('Prepara la prueba con: npm run build -- --playback-test=channel');
  } finally { credentials.password = ''; credentials.username = ''; }
}
if (require.main === module) main().catch(() => {
  // Never print raw network/filesystem exceptions: they may contain the private stream URL.
  console.error('No se completó la captura. Revisa config.local.json, cuenta/canal y conexión; cierra los otros reproductores.');
  process.exitCode = 1;
});
module.exports = { post, capture, looksLikeTs, validHttpUrl };
