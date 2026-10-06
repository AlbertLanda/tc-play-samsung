const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
function mount(t) {
  const dom = new JSDOM(source('index.html'), { runScripts: 'outside-only', url: 'https://tv.invalid', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, requests = [], plays = []; let stops = 0;
  w.TCPLAY_CONFIG = { apiBaseUrl: 'https://api.invalid' };
  w.XMLHttpRequest = class {
    open(method, url) { this.url = url; }
    setRequestHeader() {}
    send(body) { this.body = JSON.parse(body); requests.push(this); }
    abort() { this.aborted = true; this.onabort?.(); }
    reply(data) { this.status = 200; this.responseText = JSON.stringify(data); this.onload(); }
  };
  w.TCPlayPlatform = { label: 'Test TV', init() {}, exit() {}, keyAction: code => ({ 461: 'back', 10009: 'back', 427: 'next', 428: 'previous' }[code]), createPlayer: () => ({
    play(url, callbacks) { plays.push({ url, callbacks }); }, stop() { stops++; }, setRect() {}
  }) };
  w.eval(source('core.js')); w.eval(source('app.js'));
  const el = id => w.document.getElementById(id);
  const key = code => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { keyCode: code, bubbles: true, cancelable: true }));
  function login() {
    el('username').value = 'test'; el('password').value = 'secret';
    el('login-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    requests[0].reply({ success: true });
    requests[1].reply({ success: true, categories: [{ id: 1, name: 'Noticias' }, { id: 2, name: 'Deportes' }] });
    requests[2].reply({ success: true, channels: [{ id: 10, name: 'Canal 10' }, { id: 11, name: 'Canal 11' }] });
  }
  return { w, el, key, requests, plays, login, stops: () => stops };
}
test('login carga catálogo sin iniciar video y borra contraseña del formulario', t => {
  const h = mount(t); h.login();
  assert.equal(h.el('home-screen').classList.contains('hidden'), false);
  assert.equal(h.el('password').value, ''); assert.equal(h.plays.length, 0);
  assert.equal(h.requests.length, 3);
  assert.equal(h.w.localStorage.length, 0); assert.equal(h.w.sessionStorage.length, 0);
});
test('OK en canal pide URL directa, fullscreen y Atrás vuelven al catálogo', t => {
  const h = mount(t); h.login(); const button = h.el('channels').firstChild;
  button.focus(); h.key(13);
  assert.match(h.requests[3].url, /live\/stream-url\/$/);
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/test.m3u8' });
  h.plays[0].callbacks.ready(); h.el('fullscreen').click();
  assert.equal(h.w.document.body.classList.contains('fullscreen'), true);
  h.key(461); assert.equal(h.w.document.body.classList.contains('fullscreen'), false);
  assert.equal(h.w.document.activeElement.id, 'fullscreen');
});
test('cerrar sesión cancela URL pendiente y no permite video tardío', t => {
  const h = mount(t); h.login(); h.el('channels').firstChild.click();
  h.el('logout').click(); h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/late.m3u8' });
  assert.equal(h.plays.length, 0); assert.equal(h.requests[3].aborted, true);
  assert.equal(h.el('login-screen').classList.contains('hidden'), false);
});
test('cambio rápido de categoría ignora listado anterior', t => {
  const h = mount(t); h.login();
  h.el('categories').firstChild.click(); h.el('categories').lastChild.click();
  h.requests[3].reply({ success: true, channels: [{ id: 99, name: 'Viejo' }] });
  h.requests[4].reply({ success: true, channels: [{ id: 100, name: 'Actual' }] });
  assert.equal(h.el('channels').textContent, 'Actual'); assert.equal(h.plays.length, 0);
});
test('CH+ cambia de canal y no usa endpoints de proxy', t => {
  const h = mount(t); h.login(); h.el('channels').firstChild.click(); h.key(427);
  assert.equal(h.requests.at(-1).body.stream_id, '11');
  assert.ok(h.requests.every(r => !/proxy/.test(r.url)));
});
test('catálogo inserta nombres como texto y pagina listas extensas', t => {
  const h = mount(t); h.login(); h.el('categories').lastChild.click();
  h.requests[3].reply({ success: true, channels: Array.from({ length: 100 }, (_, id) => ({ id, name: id === 0 ? '<img onerror="bad()">' : 'Canal ' + id })) });
  assert.equal(h.el('channels').children.length, 12); assert.equal(h.el('channels').querySelector('img'), null);
  h.el('next-page').click(); assert.equal(h.el('page-label').textContent, '2 / 9');
});
test('ocultar app libera reproducción y exige reintento al regresar', t => {
  const h = mount(t); h.login(); h.el('channels').firstChild.click();
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/stream.m3u8' });
  h.plays[0].callbacks.ready();
  Object.defineProperty(h.w.document, 'hidden', { value: true, configurable: true });
  h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.match(h.el('playback-status').textContent, /Reintentar/); assert.ok(h.stops() >= 2);
});
test('Atrás abre diálogo y cancelar conserva sesión y foco', t => {
  const h = mount(t); h.login(); h.el('logout').focus(); h.key(10009);
  assert.equal(h.el('exit-dialog').classList.contains('hidden'), false);
  h.key(10009); assert.equal(h.el('exit-dialog').classList.contains('hidden'), true);
  assert.equal(h.w.document.activeElement.id, 'logout');
});
