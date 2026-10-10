const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const core = require('../src/core.js');

test('todo el código que corre en TV mantiene sintaxis ES5', () => {
  for (const name of ['core.js', 'app.js', 'platform.js', 'playback-test.js']) {
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
function playbackHarness(config = {}) {
  const pending = [], plays = [], reports = [], timers = new Map(); let timerId = 0, stops = 0;
  const api = { post(path, body, callback) {
    const request = { path, body, callback, aborted: false, abort() { this.aborted = true; } };
    pending.push(request); return request;
  } };
  const player = { stop() { stops++; }, play(url, callbacks) { plays.push({ url, callbacks }); } };
  const clock = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const controller = core.createPlayback(api, player, config, (...report) => reports.push(report), clock);
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
test('comparación TS pide el formato al backend y reproduce su URL exacta sin fallback', () => {
  const h = playbackHarness({ streamFormat: 'ts' }); h.controller.play(credentials, a);
  assert.equal(h.pending[0].path, 'live/stream-url');
  assert.deepEqual(h.pending[0].body, { ...credentials, stream_id: '1', output: 'ts' });
  const url = 'https://xtream.invalid/live/test/secret/1.ts?token=opaque';
  h.pending[0].callback(null, { stream_url: url });
  assert.equal(h.plays[0].url, url);
  h.plays[0].callbacks.error();
  assert.equal(h.pending.length, 1); assert.equal(h.plays.length, 1);
  assert.equal(h.controller.isActive(), false); assert.equal(h.timers.size, 0);
  assert.equal(h.reports.at(-1)[0], 'error');
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
test('preparar URLs no abre videos; canal preparado evita otra consulta al backend', () => {
  const h = playbackHarness({ streamFormat: 'ts' });
  h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.ts' });
  h.plays[0].callbacks.ready();
  h.controller.prepare(credentials, [a, b, b]);
  assert.equal(h.pending.length, 2);
  assert.equal(h.pending[1].body.output, 'ts');
  const exact = 'https://xtream.invalid/b.ts?token=opaque';
  h.pending[1].callback(null, { stream_url: exact });
  assert.equal(h.plays.length, 1);
  h.controller.play(credentials, b);
  assert.equal(h.pending.length, 2);
  assert.equal(h.plays[1].url, exact);
  assert.equal(h.controller.getDiagnostics().urlSource, 'prepared');
});
test('URLs caducan a los 60 segundos sin renovar su edad por reproducirlas', t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  now += 30000; h.controller.play(credentials, a);
  assert.equal(h.pending.length, 1);
  now += 30000; h.controller.play(credentials, a);
  assert.equal(h.pending.length, 2);
  assert.equal(h.controller.getDiagnostics().urlSource, 'request');
});
test('reintento y fallo del player descartan URL preparada sin reconexión automática', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  h.controller.play(credentials, a, true);
  assert.equal(h.pending.length, 2);
  h.pending[1].callback(null, { stream_url: 'https://xtream.invalid/fresh.m3u8' });
  h.plays[1].callbacks.error();
  assert.equal(h.pending.length, 2);
  h.controller.play(credentials, a); assert.equal(h.pending.length, 3);
});
test('preparación limita concurrencia a dos y foreground cancela respuestas antiguas', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  h.plays[0].callbacks.ready();
  h.controller.prepare(credentials, Array.from({ length: 20 }, (_, i) => ({ id: i + 2, name: 'N' })));
  assert.equal(h.pending.length, 3);
  h.pending[1].callback(null, { stream_url: 'https://xtream.invalid/b.m3u8' });
  assert.equal(h.pending.length, 4);
  h.controller.play(credentials, { id: 99, name: 'Selected' });
  assert.equal(h.pending[2].aborted, true); assert.equal(h.pending[3].aborted, true);
  h.pending[2].callback(null, { stream_url: 'https://xtream.invalid/stale.m3u8' });
  assert.equal(h.plays.length, 1); assert.equal(h.pending.length, 5);
  h.pending[4].callback(null, { stream_url: 'https://xtream.invalid/selected.m3u8' });
  assert.equal(h.plays.at(-1).url, 'https://xtream.invalid/selected.m3u8');
});
test('cerrar sesión elimina URLs y descarta preparación tardía incluso para la misma cuenta', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  h.plays[0].callbacks.ready(); h.controller.prepare(credentials, [b]);
  h.controller.stop(); assert.equal(h.pending[1].aborted, true);
  h.pending[1].callback(null, { stream_url: 'https://xtream.invalid/private.m3u8' });
  h.controller.play(credentials, b); assert.equal(h.pending.length, 3);
  assert.equal(h.plays.length, 1);
});
test('cambio de credenciales no reutiliza URLs de otra cuenta', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/old-user.m3u8' });
  h.controller.play({ username: 'other', password: 'other-secret' }, a);
  assert.equal(h.pending.length, 2); assert.equal(h.pending[1].body.username, 'other');
});
test('URL de preparación inválida o fallida no afecta la reproducción actual', () => {
  for (const [err, data] of [[null, { stream_url: 'javascript:bad' }], [{ message: 'network' }, null]]) {
    const h = playbackHarness(); h.controller.play(credentials, a);
    h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
    h.plays[0].callbacks.ready(); h.controller.prepare(credentials, [b]);
    const reports = h.reports.length;
    h.pending[1].callback(err, data);
    assert.equal(h.controller.isActive(), true); assert.equal(h.reports.length, reports);
    h.controller.play(credentials, b); assert.equal(h.pending.length, 3);
  }
});
test('diagnóstico separa consulta de URL y arranque del player sin datos privados', t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const h = playbackHarness(); h.controller.play(credentials, a);
  now += 200; h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/test/secret/a.m3u8' });
  now += 5000; h.plays[0].callbacks.ready();
  assert.deepEqual(h.controller.getDiagnostics(), {
    urlSource: 'request', urlResolutionMs: 200, playerStartupMs: 5000, totalStartupMs: 5200
  });
  now += 1000; h.plays[0].callbacks.buffering(); h.plays[0].callbacks.ready();
  assert.equal(h.controller.getDiagnostics().totalStartupMs, 5200);
  assert.doesNotMatch(JSON.stringify(h.controller.getDiagnostics()), /secret|https|test/);
});
test('cache acotada a 24 URLs y preparación acotada a 12 canales por página', () => {
  const h = playbackHarness(); h.controller.play(credentials, a);
  h.pending[0].callback(null, { stream_url: 'https://xtream.invalid/a.m3u8' });
  h.plays[0].callbacks.ready();
  const list = start => Array.from({ length: 20 }, (_, i) => ({ id: start + i, name: 'N' }));
  h.controller.prepare(credentials, list(2));
  for (let i = 1; i <= 12; i++) h.pending[i].callback(null, { stream_url: 'https://xtream.invalid/' + i });
  assert.equal(h.pending.length, 13); assert.equal(h.plays.length, 1);
  h.controller.prepare(credentials, list(14));
  for (let i = 13; i <= 24; i++) h.pending[i].callback(null, { stream_url: 'https://xtream.invalid/' + i });
  assert.equal(h.pending.length, 25);
  h.controller.play(credentials, a); assert.equal(h.pending.length, 26);
});
test('API con respuesta síncrona no conserva solicitudes completadas como pendientes', () => {
  const plays = [], aborted = [], callbacks = [];
  const api = { post(path, body, done) {
    done(null, { stream_url: 'https://xtream.invalid/' + body.stream_id });
    return { abort() { aborted.push(body.stream_id); } };
  } };
  const player = { stop() {}, play(url, events) { plays.push(url); callbacks.push(events); } };
  const h = core.createPlayback(api, player, {}, () => {});
  h.play(credentials, a); callbacks[0].ready(); h.prepare(credentials, [b]);
  h.play(credentials, b); callbacks[1].ready(); h.stop();
  assert.deepEqual(plays, ['https://xtream.invalid/1', 'https://xtream.invalid/2']);
  assert.deepEqual(aborted, []);
});
