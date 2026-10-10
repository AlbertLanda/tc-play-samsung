const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function mount(t) {
  const dom = new JSDOM('<div id="slot"><video id="video"></video></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, video = w.document.getElementById('video'), rejected = [];
  let now = 1000, ready = 0, buffering = 0, errors = 0, ended = 0, paused = 0;
  w.Date.now = () => now;
  w.TCPLAY_CONFIG = { playerEngine: 'html5' };
  w.webapis = { avplay: new Proxy({}, { get() { assert.fail('HTML5 must not open AVPlay'); } }) };
  video.pause = () => { paused++; }; video.load = () => {};
  video.play = () => ({ catch(fn) { rejected.push(fn); } });
  video.canPlayType = () => 'maybe';
  w.eval(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'));
  const player = w.TCPlayPlatform.createPlayer(video, w.document.getElementById('slot'));
  const callbacks = { ready() { ready++; }, buffering() { buffering++; }, error() { errors++; }, ended() { ended++; } };
  const event = name => video.dispatchEvent(new w.Event(name));
  const diagnostics = () => JSON.parse(JSON.stringify(w.TCPlayPlatform.getPlaybackDiagnostics()));
  return { w, video, player, callbacks, event, diagnostics, rejected, advance(ms) { now += ms; },
    counts: () => ({ ready, buffering, errors, ended, paused }) };
}

test('HTML5 usa misma URL directa y cambia preview/fullscreen sin abrir otro reproductor', t => {
  const h = mount(t), stream = 'https://xtream.invalid/user/password/123.m3u8';
  h.player.setRect({ left: 1070, top: 162, width: 771, height: 434 });
  h.player.play(stream, h.callbacks);
  assert.equal(h.video.src, stream); assert.equal(h.video.parentNode, h.w.document.body);
  assert.equal(h.w.document.querySelector('object'), null);
  assert.equal(h.video.width, 771); assert.equal(h.video.height, 434);
  assert.equal(h.video.style.left, '1070px'); assert.equal(h.video.style.display, 'block');
  h.event('playing'); assert.equal(h.counts().ready, 1);
  h.player.setRect({ left: 0, top: 0, width: 1920, height: 1080 });
  assert.equal(h.video.width, 1920); assert.equal(h.video.height, 1080); assert.equal(h.video.src, stream);
  assert.equal(h.counts().paused, 1);
  assert.equal(h.diagnostics().renderer, 'html5-contain');
  h.player.stop(); assert.equal(h.video.hasAttribute('src'), false); assert.equal(h.video.style.display, 'none');
  h.event('playing'); h.event('error');
  assert.equal(h.counts().ready, 1); assert.equal(h.counts().errors, 0);
});

test('HTML5 waiting mantiene watchdog; stalled y timeupdate no simulan ready', t => {
  const h = mount(t); h.player.play('https://xtream.invalid/test.m3u8', h.callbacks);
  h.event('playing'); h.event('stalled');
  assert.equal(h.counts().buffering, 0);
  h.video.currentTime = 1; h.event('timeupdate');
  h.event('waiting'); h.advance(700); h.event('waiting'); h.event('timeupdate');
  assert.equal(h.counts().ready, 1); assert.equal(h.diagnostics().bufferingCount, 1);
  assert.equal(h.diagnostics().bufferingMs, 700); assert.equal(h.diagnostics().lastProgressAgeMs, 700);
  h.event('playing'); assert.equal(h.counts().ready, 2); assert.equal(h.diagnostics().buffering, false);
  h.player.stop(); h.advance(1000); assert.equal(h.diagnostics().bufferingMs, 700);
});

test('HTML5 descarta rechazo de play de un canal anterior y borra estado al cambiar', t => {
  const h = mount(t); h.player.play('https://xtream.invalid/old', h.callbacks);
  h.event('waiting'); h.advance(500);
  h.player.play('https://xtream.invalid/new', h.callbacks);
  h.rejected[0](new Error('private stream URL'));
  assert.equal(h.counts().errors, 0); assert.equal(h.diagnostics().bufferingCount, 0);
  h.rejected[1](new Error('private stream URL'));
  assert.equal(h.counts().errors, 1); assert.equal(h.diagnostics().events.at(-1).event, 'play_rejected');
  assert.equal(JSON.stringify(h.diagnostics()).includes('private stream URL'), false);
});

test('HTML5 informa buffer disponible y frames descartados sin exponer URL ni error.message', t => {
  const h = mount(t), stream = 'https://xtream.invalid/user/password/123.m3u8';
  h.player.play(stream, h.callbacks);
  h.video.currentTime = 3;
  Object.defineProperty(h.video, 'buffered', { value: { length: 1, start: () => 1, end: () => 8 } });
  Object.defineProperty(h.video, 'videoWidth', { value: 1920 });
  Object.defineProperty(h.video, 'videoHeight', { value: 1080 });
  Object.defineProperty(h.video, 'error', { value: { code: 4, message: stream } });
  h.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 90, droppedVideoFrames: 10, privateMessage: stream });
  h.event('error');
  let d = h.diagnostics();
  assert.equal(d.bufferedAheadMs, 5000); assert.deepEqual(d.sourceSize, [1920, 1080]);
  assert.deepEqual(d.frameQuality, { totalFrames: 90, droppedFrames: 10 });
  assert.equal(d.events.at(-1).value, 4); assert.equal(JSON.stringify(d).includes(stream), false);
  for (let i = 0; i < 50; i++) h.event('stalled');
  d = h.diagnostics(); assert.equal(d.events.length, 30);
  d.events[0].event = 'changed'; assert.notEqual(h.diagnostics().events[0].event, 'changed');
});

test('HTML5 no interpreta rangos vacíos y contadores cero como métricas de fluidez disponibles', t => {
  const h = mount(t); h.player.play('https://xtream.invalid/live.m3u8', h.callbacks);
  h.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 });
  const d = h.diagnostics();
  assert.equal(d.frameQuality, null); assert.equal(d.bufferedRangeCount, 0); assert.equal(d.bufferedAheadMs, null);
});
