const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { post, capture } = require('../scripts/capture-channel.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcplay-capture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'channel.ts');
}
function ts() {
  const buffer = Buffer.alloc(188 * 150, 0x11);
  for (let i = 0; i < buffer.length; i += 188) buffer[i] = 0x47;
  return buffer;
}
const privateUrl = 'https://xtream.invalid/live/private-user/private-password/1.ts';
test('captura conserva bytes originales y cancela la conexión al terminar', async t => {
  const output = fixture(t), bytes = ts(); let signal, cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 150)); c.enqueue(bytes.subarray(150)); }, cancel() { cancelled = true; } });
  const result = await capture(privateUrl, output, { maxBytes: bytes.length, fetcher: async (url, options) => {
    assert.equal(url, privateUrl); signal = options.signal;
    return { ok: true, body: stream };
  } });
  assert.equal(result.bytes, bytes.length); assert.equal(result.reachedLimit, true);
  assert.deepEqual(fs.readFileSync(output), bytes);
  assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});
test('límite de tiempo cierra un directo continuo y conserva el clip', async t => {
  const output = fixture(t), bytes = ts(); let signal;
  const result = await capture(privateUrl, output, { durationMs: 20, fetcher: async (_, options) => {
    signal = options.signal;
    return { ok: true, body: new ReadableStream({ start(c) {
      c.enqueue(bytes); signal.addEventListener('abort', () => c.error(new Error(privateUrl)));
    } }) };
  } });
  assert.equal(result.reachedLimit, true); assert.equal(signal.aborted, true);
  assert.deepEqual(fs.readFileSync(output), bytes);
});
test('fallo de red conserva captura anterior, borra parcial y oculta URL privada', async t => {
  const output = fixture(t); fs.writeFileSync(output, 'previous');
  await assert.rejects(capture(privateUrl, output, { fetcher: async () => {
    return { ok: true, body: new ReadableStream({ start(c) { c.enqueue(ts()); }, pull(c) { c.error(new Error(privateUrl)); } }) };
  } }), e => !e.message.includes('private') && /No se pudo capturar/.test(e.message));
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous');
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ['channel.ts']);
});
test('rechaza HTML de un servidor y esquemas no HTTP sin guardar contenido', async t => {
  const output = fixture(t);
  await assert.rejects(capture(privateUrl, output, { fetcher: async () => new Response('<html>not a stream</html>') }), /TS válido/);
  assert.equal(fs.existsSync(output), false);
  await assert.rejects(capture('file:///private', output, { fetcher: () => assert.fail('Must not fetch') }), /HTTP/);
});
test('cancelar la captura libera conexión y descarta parcial sin reemplazar archivo anterior', async t => {
  const output = fixture(t); fs.writeFileSync(output, 'previous');
  await assert.rejects(capture(privateUrl, output, { fetcher: async (_, options) => {
    return { ok: true, body: new ReadableStream({ start(c) {
      c.enqueue(ts());
      options.signal.addEventListener('abort', () => c.error(new Error(privateUrl)));
      setImmediate(() => process.emit('SIGINT'));
    } }) };
  } }), /No se pudo capturar/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous');
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ['channel.ts']);
});
test('API envía credenciales solo por POST y errores nunca incluyen cuerpo/URL', async () => {
  const credentials = { username: 'private-user', password: 'private-password' };
  const result = await post('https://api.invalid/', 'live/stream-url', credentials, async (url, options) => {
    assert.equal(url, 'https://api.invalid/api/xtream/live/stream-url/');
    assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), credentials);
    return { ok: true, json: async () => ({ stream_url: privateUrl }) };
  });
  assert.equal(result.stream_url, privateUrl);
  await assert.rejects(post('https://api.invalid', 'live/streams', credentials, async () => { throw new Error(privateUrl); }), e => !e.message.includes('private'));
});
