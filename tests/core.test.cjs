const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const core = require('../src/core.js');

test('todo el código que corre en TV mantiene sintaxis ES5', () => {
  for (const name of ['core.js', 'app.js', 'platform.js']) {
    acorn.parse(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), { ecmaVersion: 5 });
  }
});
function xhrHarness() {
  const sent = [];
  class Xhr {
    constructor() { sent.push(this); }
    open(method, url, async) { Object.assign(this, { method, url, async }); }
    setRequestHeader(name, value) { this.header = [name, value]; }
    send(body) { this.body = JSON.parse(body); }
    abort() { this.aborted = true; this.onabort?.(); }
    reply(data, status = 200) { this.status = status; this.responseText = JSON.stringify(data); this.onload(); }
  }
  return { sent, Xhr };
}
test('API envía POST JSON, conserva barra final y normaliza base', () => {
  const h = xhrHarness(); let result;
  const api = core.createApi({ apiBaseUrl: 'https://api.invalid/' }, h.Xhr);
  api.post('login', { username: 'test', password: 'private' }, (err, data) => { result = [err, data]; });
  assert.equal(h.sent[0].url, 'https://api.invalid/api/xtream/login/');
  assert.equal(h.sent[0].method, 'POST');
  assert.deepEqual(h.sent[0].header, ['Content-Type', 'application/json']);
  h.sent[0].reply({ success: true });
  assert.equal(result[0], null);
});
test('configuración vacía no hace solicitudes de red', () => {
  const h = xhrHarness(); let error;
  core.createApi({}, h.Xhr).post('login', {}, e => { error = e; });
  assert.equal(error.code, 'unconfigured'); assert.equal(h.sent.length, 0);
});
test('API diferencia cuenta inactiva y no muestra mensajes internos sensibles', () => {
  const h = xhrHarness(); let error;
  core.createApi({ apiBaseUrl: 'https://api.invalid' }, h.Xhr).post('login', {}, e => { error = e; });
  h.sent[0].reply({ success: false, error_code: 'inactive_account', message: 'https://server/password' }, 403);
  assert.match(error.message, /no está activa/); assert.doesNotMatch(error.message, /password/);
});
test('abortar una solicitud suprime una respuesta tardía', () => {
  const h = xhrHarness(); let count = 0;
  const request = core.createApi({ apiBaseUrl: 'https://api.invalid' }, h.Xhr).post('login', {}, () => { count++; });
  request.abort(); h.sent[0].reply({ success: true }); assert.equal(count, 0);
});
test('timeout y error de red se notifican una sola vez', () => {
  const h = xhrHarness(); const errors = [];
  core.createApi({ apiBaseUrl: 'https://api.invalid' }, h.Xhr).post('login', {}, e => errors.push(e.code));
  h.sent[0].ontimeout(); h.sent[0].onerror(); assert.deepEqual(errors, ['timeout']);
});
function playbackHarness() {
  const pending = [], plays = [], reports = [], timers = new Map(); let timerId = 0, stops = 0;
  const api = { post(path, body, callback) {
    const request = { path, body, callback, aborted: false, abort() { this.aborted = true; } };
    pending.push(request); return request;
  } };
  const player = { stop() { stops++; }, play(url, callbacks) { plays.push({ url, callbacks }); } };
  const clock = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const controller = core.createPlayback(api, player, {}, (...report) => reports.push(report), clock);
  return { controller, pending, plays, reports, timers, stops: () => stops };
}
const credentials = { username: 'test', password: 'secret' };
const a = { id: 1, name: 'A' }, b = { id: 2, name: 'B' };
test('reproducción pide únicamente URL directa HLS, sin proxy', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  assert.equal(h.pending[0].path, 'live/stream-url');
  assert.deepEqual(h.pending[0].body, { ...credentials, stream_id: '1', output: 'm3u8' });
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/live/test/secret/1.m3u8' });
  assert.equal(h.plays.length, 1); h.plays[0].callbacks.ready();
  assert.equal(h.controller.isActive(), true); assert.equal(h.timers.size, 0);
});
test('zapping descarta URL del canal anterior aunque llegue tarde', () => {
  const h = playbackHarness(); h.controller.play(credentials, a); h.controller.play(credentials, b);
  assert.equal(h.pending[0].aborted, true);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  h.pending[1].callback(null, { stream_url: 'https://xtream.invalid/b.m3u8' });
  assert.deepEqual(h.plays.map(p => p.url), ['https://xtream.invalid/b.m3u8']);
});
test('callbacks nativos antiguos no cambian el canal nuevo', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  const old = h.plays[0].callbacks; h.controller.play(credentials, b);
  const count = h.reports.length; old.ready(); old.error(); old.buffering();
  assert.equal(h.reports.length, count); assert.equal(h.controller.isActive(), false);
});
test('detener invalida respuestas, libera reproductor y cancela watchdog', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  h.controller.stop(); assert.equal(h.timers.size, 0);
  h.plays[0].callbacks.ready(); assert.equal(h.controller.isActive(), false);
  assert.ok(h.stops() >= 2);
});
test('timeout de video cierra el reproductor y permite reintentar', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  [...h.timers.values()][0](); assert.equal(h.reports.at(-1)[0], 'error');
  h.controller.play(credentials, a); assert.equal(h.pending.length, 2);
});
test('no acepta URLs javascript ni respuestas sin URL', () => {
  for (const data of [{ stream_url: 'javascript:alert(1)' }, {}]) {
    const h = playbackHarness(); h.controller.play(credentials, a); h.pending[0].callback(null, data);
    assert.equal(h.plays.length, 0); assert.equal(h.reports.at(-1)[0], 'error');
  }
});
test('ticks de reproducción repetidos no reinician el estado visual', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  h.plays[0].callbacks.ready(); const count = h.reports.length;
  h.plays[0].callbacks.ready(); assert.equal(h.reports.length, count);
});
test('eventos de buffering repetidos no extienden indefinidamente el timeout', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  const deadline = [...h.timers.keys()][0];
  h.plays[0].callbacks.buffering(); h.plays[0].callbacks.buffering();
  assert.equal([...h.timers.keys()][0], deadline);
});
