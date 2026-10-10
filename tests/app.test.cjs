const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
function mount(t, fakeClock) {
  const dom = new JSDOM(source('index.html'), { runScripts: 'outside-only', url: 'https://tv.invalid', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, requests = [], plays = [], rectangles = []; let stops = 0;
  let now = 0, timerId = 0;
  const timers = new Map();
  if (fakeClock) {
    w.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; };
    w.clearTimeout = id => timers.delete(id);
  }
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    now = end;
  }
  w.TCPLAY_CONFIG = { apiBaseUrl: 'https://api.invalid' };
  w.XMLHttpRequest = class {
    open(method, url) { this.url = url; }
    setRequestHeader() {}
    send(body) { this.body = JSON.parse(body); requests.push(this); }
    abort() { this.aborted = true; this.onabort?.(); }
    reply(data) { this.status = 200; this.responseText = JSON.stringify(data); this.onload(); }
  };
  w.TCPlayPlatform = { label: 'Test TV', init() {}, exit() {}, keyAction: code => ({ 461: 'back', 10009: 'back', 427: 'next', 428: 'previous' }[code]), createPlayer: () => ({
    play(url, callbacks) { plays.push({ url, callbacks }); }, stop() { stops++; }, setRect(rect, width, height) { rectangles.push({ rect, width, height }); }
  }) };
  w.eval(source('core.js')); w.eval(source('app.js'));
  const el = id => w.document.getElementById(id);
  const key = code => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { keyCode: code, bubbles: true, cancelable: true }));
  function login(catalog, categoryItems) {
    el('username').value = 'test'; el('password').value = 'secret';
    el('login-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    requests[0].reply({ success: true });
    requests[1].reply({ success: true, categories: categoryItems || [{ id: 1, name: 'Noticias' }, { id: 2, name: 'Deportes' }] });
    requests[2].reply({ success: true, channels: catalog || [
      { id: 10, name: 'WILLAX', category_id: 1 }, { id: 11, name: 'Canal 11', category_id: 1 }
    ] });
  }
  return { w, el, key, requests, plays, rectangles, login, advance, stops: () => stops };
}
test('preview excluye borde; fullscreen y Return cambian rectángulo sin reiniciar stream', t => {
  const h = mount(t), anchor = h.el('preview-anchor');
  anchor.getBoundingClientRect = () => ({ left: 700, top: 160, width: 644, height: 364 });
  for (const [name, value] of Object.entries({ clientLeft: 2, clientTop: 2, clientWidth: 640, clientHeight: 360 })) {
    Object.defineProperty(anchor, name, { value });
  }
  h.login(); h.el('channels').firstChild.click();
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/test.m3u8' });
  const preview = { left: 702, top: 162, width: 640, height: 360 };
  assert.deepEqual(JSON.parse(JSON.stringify(h.rectangles.at(-1).rect)), preview);
  assert.equal(h.el('media-slot').style.width, '640px');
  h.el('fullscreen').click();
  assert.deepEqual(JSON.parse(JSON.stringify(h.rectangles.at(-1).rect)), { left: 0, top: 0, width: h.w.innerWidth, height: h.w.innerHeight });
  h.key(10009);
  assert.deepEqual(JSON.parse(JSON.stringify(h.rectangles.at(-1).rect)), preview);
  assert.equal(h.plays.length, 1);
});
test('login selecciona Willax y solicita reproducción automática; credenciales solo en memoria', t => {
  const h = mount(t); h.login();
  assert.equal(h.el('home-screen').classList.contains('hidden'), false);
  assert.equal(h.el('password').value, ''); assert.equal(h.plays.length, 0);
  assert.equal(h.requests.length, 4);
  assert.equal(h.requests[3].body.stream_id, '10');
  assert.equal(h.el('channel-title').textContent, 'WILLAX');
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/willax.ts' });
  assert.equal(h.plays.length, 1);
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
  h.el('reload').click(); const old = h.requests.at(-1);
  h.el('categories').lastChild.click(); h.el('reload').click(); const current = h.requests.at(-1);
  old.reply({ success: true, channels: [{ id: 99, name: 'Viejo' }] });
  current.reply({ success: true, channels: [{ id: 100, name: 'Actual' }] });
  assert.equal(h.el('channels').textContent, 'Actual'); assert.equal(h.plays.length, 0);
});
test('CH+ cambia de canal y no usa endpoints de proxy', t => {
  const h = mount(t); h.login(); h.el('channels').firstChild.click(); h.key(427);
  assert.equal(h.requests.at(-1).body.stream_id, '11');
  assert.ok(h.requests.every(r => !/proxy/.test(r.url)));
});
test('catálogo inserta nombres como texto y pagina listas extensas', t => {
  const h = mount(t); h.login(); h.el('categories').lastChild.click();
  h.el('reload').click();
  h.requests.at(-1).reply({ success: true, channels: Array.from({ length: 100 }, (_, id) => ({ id, name: id === 0 ? '<img onerror="bad()">' : 'Canal ' + id })) });
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
test('Willax fuera de primera categoría/página inicia solo y muestra su fila seleccionada', t => {
  const h = mount(t);
  h.login([
    { id: 8, name: 'Noticias', category_id: 1 },
    ...Array.from({ length: 15 }, (_, id) => ({ id: id + 100, name: 'Sports ' + id, category_id: '2' })),
    { id: 200, name: 'Willax HD', category_id: '2' },
    { id: 201, name: ' willax ', category_id: '2' }
  ]);
  assert.equal(h.requests[3].body.stream_id, '201');
  assert.equal(h.el('category-title').textContent, 'Deportes');
  assert.equal(h.el('page-label').textContent, '2 / 2');
  assert.equal(h.el('channels').querySelector('.selected').getAttribute('data-channel'), '201');
});
test('sin Willax usa primer canal disponible y categorías cacheadas evitan nuevas consultas', t => {
  const h = mount(t); h.login([{ id: 20, name: 'Deporte', category_id: 2 }]);
  assert.equal(h.requests[3].body.stream_id, '20');
  const count = h.requests.length;
  h.el('categories').firstChild.click(); h.el('categories').lastChild.click();
  assert.equal(h.requests.length, count);
  assert.equal(h.el('channels').textContent, 'Deporte');
});
test('catálogo global fallido conserva listado por categoría y autoplay de Willax', t => {
  const h = mount(t);
  h.el('username').value = 'test'; h.el('password').value = 'secret';
  h.el('login-form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  h.requests[0].reply({ success: true });
  h.requests[2].reply({ success: false, error_code: 'network' });
  h.requests[1].reply({ success: true, categories: [{ id: 1, name: 'Nacionales' }] });
  assert.equal(h.requests[3].body.category_id, '1');
  h.requests[3].reply({ success: true, channels: [{ id: 5, name: 'WILLAX' }] });
  assert.equal(h.requests[4].body.stream_id, '5');
});
test('logout durante catálogo impide autoplay tardío y limpia cache para próximo login', t => {
  const h = mount(t);
  h.el('username').value = 'test'; h.el('password').value = 'secret';
  h.el('login-form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  h.requests[0].reply({ success: true }); h.el('logout').click();
  h.requests[1].reply({ success: true, categories: [{ id: 1, name: 'N' }] });
  h.requests[2].reply({ success: true, channels: [{ id: 5, name: 'WILLAX', category_id: 1 }] });
  assert.equal(h.requests.length, 3); assert.equal(h.plays.length, 0);
});
test('OK repetido en canal actual no reinicia; Reintentar solicita URL fresca', t => {
  const h = mount(t); h.login();
  h.el('channels').firstChild.click(); assert.equal(h.requests.length, 4);
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/willax.ts' });
  h.plays[0].callbacks.ready();
  const requests = h.requests.length, stops = h.stops();
  h.el('channels').firstChild.click();
  assert.equal(h.requests.length, requests); assert.equal(h.stops(), stops);
  h.el('retry').click();
  assert.equal(h.requests.at(-1).body.stream_id, '10');
  assert.equal(h.requests.at(-2).aborted, true);
});
test('canal visible preparado cambia sin nueva consulta ni un segundo video simultáneo', t => {
  const h = mount(t); h.login();
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/willax.ts' });
  h.plays[0].callbacks.ready();
  assert.equal(h.requests[4].body.stream_id, '11');
  h.requests[4].reply({ success: true, stream_url: 'https://xtream.invalid/11.ts' });
  assert.equal(h.plays.length, 1);
  h.el('channels').lastChild.click();
  assert.equal(h.requests.length, 5); assert.equal(h.plays.length, 2);
  assert.equal(h.w.TCPlayApp.getChannelSwitchDiagnostics().urlSource, 'prepared');
});
test('catálogo vacío no intenta abrir canales ni inventa identificador de Willax', t => {
  const h = mount(t); h.login([]);
  assert.equal(h.requests.length, 3); assert.equal(h.plays.length, 0);
  assert.match(h.el('catalogue-status').textContent, /No hay canales/);
});

const orderedCatalog = [
  { id: 10, name: 'WILLAX', category_id: 1 },
  { id: 11, name: 'Noticias 2', category_id: 1 },
  { id: 20, name: 'Deportes 1', category_id: 2 },
  { id: 21, name: 'Deportes 2', category_id: 2 }
];
test('derecha en vista previa o diálogo no cambia canal', t => {
  const h = mount(t, true); h.login(orderedCatalog);
  h.el('fullscreen').focus(); h.key(39); h.advance(350);
  assert.equal(h.el('channel-title').textContent, 'WILLAX'); assert.equal(h.requests.length, 4);
  h.key(10009); h.key(39); h.advance(350);
  assert.equal(h.el('channel-title').textContent, 'WILLAX'); assert.equal(h.requests.length, 4);
  assert.equal(h.el('exit-dialog').classList.contains('hidden'), false);
});
test('derecha fullscreen cruza categorías y vuelve al primer canal sin abrir intermedios', t => {
  const h = mount(t, true); h.login(orderedCatalog); h.el('fullscreen').click();
  for (const [name, category] of [['Noticias 2', 'Noticias'], ['Deportes 1', 'Deportes'], ['Deportes 2', 'Deportes'], ['WILLAX', 'Noticias']]) {
    h.key(39);
    assert.equal(h.el('fullscreen-title').textContent, name);
    assert.equal(h.el('fullscreen-category').textContent, category);
    assert.equal(h.el('player-overlay').classList.contains('hidden'), false);
  }
  assert.equal(h.requests.length, 4); assert.equal(h.requests[3].aborted, true);
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/stale.ts' });
  assert.equal(h.plays.length, 0);
  h.advance(350); assert.equal(h.requests.length, 5); assert.equal(h.requests[4].body.stream_id, '10');
});
test('cada pulsación reinicia espera de 350 ms y solo reproduce selección final', t => {
  const h = mount(t, true); h.login(orderedCatalog); h.el('fullscreen').click();
  h.key(39); h.advance(300); h.key(39); h.advance(300); h.key(39);
  assert.equal(h.el('fullscreen-title').textContent, 'Deportes 2');
  assert.equal(h.requests.length, 4); h.advance(349); assert.equal(h.requests.length, 4);
  h.advance(1); assert.equal(h.requests.at(-1).body.stream_id, '21');
  h.requests.at(-1).reply({ success: true, stream_url: 'https://xtream.invalid/final.ts' });
  assert.deepEqual(h.plays.map(p => p.url), ['https://xtream.invalid/final.ts']);
});
test('recorrido salta categorías vacías y respeta orden del proveedor', t => {
  const h = mount(t, true);
  h.login([orderedCatalog[0], { id: 30, name: 'Último', category_id: 3 }], [
    { id: 1, name: 'Noticias' }, { id: 2, name: 'Vacía' }, { id: 3, name: 'Películas' }, { id: 4, name: 'Vacía final' }
  ]);
  h.el('fullscreen').click(); h.key(39); assert.equal(h.el('fullscreen-title').textContent, 'Último');
  h.key(39); assert.equal(h.el('fullscreen-title').textContent, 'WILLAX');
  assert.equal(h.requests.length, 4);
});
test('derecha parte del canal seleccionado aunque usuario haya explorado otra categoría', t => {
  const h = mount(t, true); h.login(orderedCatalog);
  h.el('categories').lastChild.click(); h.el('fullscreen').click(); h.key(39);
  assert.equal(h.el('fullscreen-title').textContent, 'Noticias 2');
  assert.equal(h.el('category-title').textContent, 'Noticias');
  h.advance(350); assert.equal(h.requests.at(-1).body.stream_id, '11');
});
test('Atrás durante selección reproduce último nombre en miniatura y conserva página/fila', t => {
  const h = mount(t, true);
  h.login([orderedCatalog[0], ...Array.from({ length: 14 }, (_, i) => ({ id: 100 + i, name: 'Canal ' + i, category_id: 2 }))]);
  h.el('fullscreen').click(); for (let i = 0; i < 14; i++) h.key(39);
  assert.equal(h.el('fullscreen-title').textContent, 'Canal 13');
  h.key(10009); assert.equal(h.w.document.body.classList.contains('fullscreen'), false);
  assert.equal(h.el('category-title').textContent, 'Deportes'); assert.equal(h.el('page-label').textContent, '2 / 2');
  assert.equal(h.el('channels').querySelector('.selected').getAttribute('data-channel'), '113');
  assert.equal(h.requests.at(-1).body.stream_id, '113');
  const count = h.requests.length; h.advance(350); assert.equal(h.requests.length, count);
});
test('selección diferida conserva URL preparada y suprime callbacks antiguos', t => {
  const h = mount(t, true); h.login();
  h.requests[3].reply({ success: true, stream_url: 'https://xtream.invalid/willax.ts' }); h.plays[0].callbacks.ready();
  h.requests[4].reply({ success: true, stream_url: 'https://xtream.invalid/11.ts' });
  h.el('fullscreen').click(); h.key(39);
  h.plays[0].callbacks.ready(); h.plays[0].callbacks.buffering(); h.plays[0].callbacks.error();
  assert.equal(h.el('fullscreen-title').textContent, 'Canal 11');
  assert.match(h.el('fullscreen-status').textContent, /Suelta/);
  const count = h.requests.length; h.advance(350);
  assert.equal(h.requests.length, count); assert.equal(h.plays.at(-1).url, 'https://xtream.invalid/11.ts');
});
for (const event of ['logout', 'visibilitychange', 'pagehide']) {
  test(event + ' cancela canal diferido sin reproducción tardía', t => {
    const h = mount(t, true); h.login(orderedCatalog); h.el('fullscreen').click(); h.key(39);
    if (event === 'logout') h.el('logout').click();
    else if (event === 'pagehide') h.w.dispatchEvent(new h.w.Event(event));
    else {
      Object.defineProperty(h.w.document, 'hidden', { value: true, configurable: true });
      h.w.document.dispatchEvent(new h.w.Event(event));
    }
    h.advance(5000); assert.equal(h.requests.length, 4); assert.equal(h.plays.length, 0);
  });
}
function fallbackLogin(h) {
  h.el('username').value = 'test'; h.el('password').value = 'secret';
  h.el('login-form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  h.requests[0].reply({ success: true });
  h.requests[1].reply({ success: true, categories: [{ id: 1, name: 'Noticias' }, { id: 2, name: 'Deportes' }] });
  h.requests[2].reply({ success: false, error_code: 'network' });
  h.requests[3].reply({ success: true, channels: [{ id: 10, name: 'WILLAX' }] });
  h.el('fullscreen').click();
}
test('fallback por categoría conserva pulsaciones durante consulta y abre solo destino final', t => {
  const h = mount(t, true); fallbackLogin(h);
  h.key(39); const categoryRequest = h.requests.at(-1);
  assert.equal(categoryRequest.body.category_id, '2');
  h.key(39); h.key(39);
  assert.equal(h.requests.length, 6);
  categoryRequest.reply({ success: true, channels: [{ id: 20, name: 'Deporte A' }, { id: 21, name: 'Deporte B' }] });
  assert.equal(h.el('fullscreen-title').textContent, 'WILLAX');
  assert.equal(h.requests.length, 6); h.advance(350);
  assert.equal(h.requests.at(-1).body.stream_id, '10');
});
test('Atrás cancela categoría pendiente e ignora respuesta tardía', t => {
  const h = mount(t, true); fallbackLogin(h); h.key(39);
  const old = h.requests.at(-1); h.key(10009);
  assert.equal(old.aborted, true);
  old.reply({ success: true, channels: [{ id: 20, name: 'Tardío' }] }); h.advance(350);
  assert.equal(h.el('channel-title').textContent, 'WILLAX');
  assert.equal(h.requests.at(-1).body.stream_id, '10'); assert.equal(h.requests.length, 7);
});
test('fallo de categoría permite reintentar selección sin abrir destino desconocido', t => {
  const h = mount(t, true); fallbackLogin(h); h.key(39);
  h.requests.at(-1).reply({ success: false, error_code: 'network' }); h.advance(350);
  assert.equal(h.requests.length, 6); assert.equal(h.plays.length, 0);
  assert.match(h.el('playback-status').textContent, /Reintentar/);
  h.key(10009); h.el('retry').click(); assert.equal(h.requests.at(-1).body.stream_id, '10');
});
test('nueva pulsación tras iniciar conexión cancela URL anterior y mantiene nombre final', t => {
  const h = mount(t, true); h.login(orderedCatalog); h.el('fullscreen').click();
  h.key(39); h.advance(350); const previous = h.requests.at(-1);
  assert.equal(previous.body.stream_id, '11');
  h.key(39); assert.equal(previous.aborted, true);
  previous.reply({ success: true, stream_url: 'https://xtream.invalid/old.ts' });
  h.advance(350); assert.equal(h.requests.at(-1).body.stream_id, '20');
  h.requests.at(-1).reply({ success: true, stream_url: 'https://xtream.invalid/new.ts' });
  assert.deepEqual(h.plays.map(p => p.url), ['https://xtream.invalid/new.ts']);
  assert.equal(h.el('fullscreen-title').textContent, 'Deportes 1');
});
test('CH+ durante selección reemplaza temporizador y no inicia un canal extra', t => {
  const h = mount(t, true); h.login(orderedCatalog); h.el('fullscreen').click();
  h.key(39); h.key(39); h.key(427);
  assert.equal(h.requests.at(-1).body.stream_id, '21');
  const count = h.requests.length; h.advance(350); assert.equal(h.requests.length, count);
});
