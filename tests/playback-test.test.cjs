const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function mount(t) {
  const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  const dom = new JSDOM(source('playback-test.html'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, video = w.document.getElementById('test-video');
  let now = 1000, plays = 0, pauses = 0;
  w.Date.now = () => now;
  w.XMLHttpRequest = function () { assert.fail('Local clip must not request API'); };
  w.fetch = () => assert.fail('Local clip must not use external network');
  video.play = () => { plays++; }; video.pause = () => { pauses++; }; video.load = () => {};
  w.eval(source('playback-test.js'));
  return { w, video, click(id) { w.document.getElementById(id).click(); },
    event(name) { video.dispatchEvent(new w.Event(name)); }, advance(ms) { now += ms; },
    counts: () => ({ plays, pauses }) };
}

test('prueba local usa únicamente asset incluido, mide inicio y cambia tamaño sin reiniciar', t => {
  const h = mount(t);
  assert.equal(h.video.getAttribute('src'), 'assets/playback-test.mp4');
  assert.equal(h.counts().plays, 0);
  h.click('start-test'); h.advance(120); h.event('playing');
  assert.equal(h.w.getLocalPlaybackTestDiagnostics().startupMs, 120);
  h.click('size-test'); assert.equal(h.w.document.body.classList.contains('large'), true);
  assert.equal(h.counts().plays, 1);
  h.event('ended'); assert.match(h.w.document.getElementById('test-status').textContent, /terminada/);
  h.click('report-test');
  const d = JSON.parse(h.w.document.getElementById('report').textContent);
  assert.equal(d.source, 'bundled-mp4'); assert.equal(d.startupMs, 120);
  h.click('start-test'); assert.equal(h.w.getLocalPlaybackTestDiagnostics().startupMs, null);
  assert.equal(h.video.currentTime, 0); assert.equal(h.counts().plays, 2);
});

test('prueba local registra espera/error sin exponer mensajes y libera video al salir', t => {
  const h = mount(t); h.click('start-test');
  Object.defineProperty(h.video, 'error', { value: { code: 3, message: 'private data' } });
  h.event('waiting'); h.event('error');
  let d = h.w.getLocalPlaybackTestDiagnostics();
  assert.equal(d.events.at(-1).code, 3); assert.equal(JSON.stringify(d).includes('private data'), false);
  for (let i = 0; i < 50; i++) h.event('stalled');
  d = h.w.getLocalPlaybackTestDiagnostics(); assert.equal(d.events.length, 30);
  d.events[0].event = 'changed'; assert.notEqual(h.w.getLocalPlaybackTestDiagnostics().events[0].event, 'changed');
  h.w.dispatchEvent(new h.w.Event('pagehide')); assert.equal(h.video.hasAttribute('src'), false);
});
test('captura TS se identifica sin exponer nombre, URL ni cuenta', t => {
  const h = mount(t);
  h.video.setAttribute('data-test-source', 'captured-ts');
  h.video.setAttribute('src', 'assets/channel-test.ts');
  h.click('start-test'); h.event('playing');
  assert.equal(h.w.getLocalPlaybackTestDiagnostics().source, 'captured-ts');
  h.click('size-test'); assert.equal(h.counts().plays, 1);
});
