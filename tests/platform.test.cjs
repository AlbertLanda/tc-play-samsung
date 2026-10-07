const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const path = require('node:path');
const samsung = fs.existsSync(path.join(__dirname, '../platform/config.xml'));
function mount(t) {
  const dom = new JSDOM('<div id="slot"><video id="video"></video></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close()); return dom.window;
}
test('reproductor nativo detiene eventos viejos y reproduce solo la selección vigente', t => {
  const w = mount(t), video = w.document.getElementById('video'), slot = w.document.getElementById('slot');
  let ready = 0;
  const callbacks = { ready() { ready++; }, buffering() {}, error() {}, ended() {} };
  if (samsung) {
    const prepared = [], listeners = []; let starts = 0, state = 'NONE';
    w.webapis = { avplay: {
      close() { state = 'NONE'; }, open() { state = 'IDLE'; }, getState() { return state; },
      setListener(value) { listeners.push(value); }, setDisplayRect() {}, setDisplayMethod() {},
      prepareAsync(fn) { prepared.push(fn); }, play() { starts++; state = 'PLAYING'; }
    } };
    w.eval(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'));
    const player = w.TCPlayPlatform.createPlayer(video, slot);
    player.play('https://xtream.invalid/1', callbacks); player.play('https://xtream.invalid/2', callbacks);
    prepared[0](); listeners[0].oncurrentplaytime(); assert.equal(starts, 0); assert.equal(ready, 0);
    prepared[1](); listeners[1].oncurrentplaytime(); assert.equal(starts, 1); assert.equal(ready, 1);
    player.stop(); listeners[1].oncurrentplaytime(); assert.equal(ready, 1);
  } else {
    video.pause = () => {}; video.load = () => {}; video.play = () => undefined;
    w.eval(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'));
    const player = w.TCPlayPlatform.createPlayer(video, slot);
    player.play('https://xtream.invalid/1.m3u8', callbacks);
    video.dispatchEvent(new w.Event('playing')); assert.equal(ready, 1);
    player.stop(); video.dispatchEvent(new w.Event('playing')); assert.equal(ready, 1);
    assert.equal(video.hasAttribute('src'), false);
  }
});
test('Samsung convierte coordenadas al plano AVPlay de 1920x1080; LG usa video', t => {
  const w = mount(t), video = w.document.getElementById('video'); let rectangle;
  video.pause = () => {}; video.load = () => {};
  if (samsung) w.webapis = { avplay: { getState: () => 'PLAYING', setDisplayRect(...args) { rectangle = args; }, setDisplayMethod() {} } };
  w.eval(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'));
  const player = w.TCPlayPlatform.createPlayer(video, w.document.getElementById('slot'));
  player.setRect({ left: 100, top: 50, width: 600, height: 300 }, 1280, 720);
  if (samsung) {
    assert.deepEqual(rectangle, [150, 75, 900, 450]);
    assert.equal(w.document.getElementById('native-player').style.width, '600px');
    assert.equal(w.document.getElementById('native-player').style.height, '300px');
  }
  else assert.equal(w.document.querySelectorAll('video').length, 1);
});

test('AVPlay configura letterbox antes de preparar y conserva fullscreen al terminar prepareAsync', t => {
  const w = mount(t), calls = []; let state = 'NONE', prepared, rectangle, mode;
  w.webapis = { avplay: {
    close() { state = 'NONE'; }, open() { state = 'IDLE'; }, getState() { return state; }, setListener() {},
    setDisplayRect(...args) { rectangle = args; calls.push('rect'); },
    setDisplayMethod(value) { mode = value; calls.push('mode'); },
    prepareAsync(fn) { calls.push('prepare'); prepared = fn; rectangle = null; mode = null; },
    play() { calls.push('play'); state = 'PLAYING'; }
  } };
  w.eval(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'));
  const player = w.TCPlayPlatform.createPlayer(w.document.getElementById('video'), w.document.getElementById('slot'));
  player.setRect({ left: 100, top: 50, width: 640, height: 360 }, 1280, 720);
  player.play('https://xtream.invalid/stream', { ready() {}, buffering() {}, error() { assert.fail('Unexpected error'); }, ended() {} });
  assert.deepEqual(calls, ['rect', 'mode', 'prepare']);
  player.setRect({ left: 0, top: 0, width: 1280, height: 720 }, 1280, 720);
  state = 'READY'; prepared();
  assert.deepEqual(rectangle, [0, 0, 1920, 1080]);
  assert.equal(mode, 'PLAYER_DISPLAY_MODE_LETTER_BOX'); assert.equal(calls.at(-1), 'play');
  player.setRect({ left: 100, top: 50, width: 640, height: 360 }, 1280, 720);
  assert.deepEqual(rectangle, [150, 75, 960, 540]);
  assert.equal(calls.filter(c => c === 'play').length, 1);
});

test('ticks durante buffering no declaran ready; diagnóstico acotado no expone URL ni mensajes nativos', t => {
  const w = mount(t), listeners = []; let ready = 0, now = 1000;
  w.Date.now = () => now;
  w.webapis = { avplay: {
    close() {}, open() {}, getState: () => 'PLAYING', setListener(l) { listeners.push(l); },
    setDisplayRect() {}, setDisplayMethod() {}, prepareAsync(fn) { fn(); }, play() {}
  } };
  w.eval(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'));
  const player = w.TCPlayPlatform.createPlayer(w.document.getElementById('video'), w.document.getElementById('slot'));
  const callbacks = { ready() { ready++; }, buffering() {}, error() {}, ended() {} };
  const secret = 'https://xtream.invalid/user/password/123.m3u8';
  player.play(secret, callbacks);
  listeners[0].oncurrentplaytime(100); assert.equal(ready, 1);
  listeners[0].onbufferingstart(); now += 500;
  listeners[0].oncurrentplaytime(100); assert.equal(ready, 1);
  let diagnostic = w.TCPlayPlatform.getPlaybackDiagnostics();
  assert.equal(diagnostic.bufferingCount, 1); assert.equal(diagnostic.bufferingMs, 500);
  assert.equal(diagnostic.lastProgressAgeMs, 500);
  listeners[0].onbufferingcomplete(); assert.equal(ready, 2);
  listeners[0].onerror('PLAYER_ERROR_CONNECTION_FAILED');
  assert.equal(w.TCPlayPlatform.getPlaybackDiagnostics().events.at(-1).code, 'PLAYER_ERROR_CONNECTION_FAILED');
  listeners[0].onerror({ name: secret, message: secret });
  for (let i = 0; i < 50; i++) listeners[0].onbufferingprogress(i);
  diagnostic = w.TCPlayPlatform.getPlaybackDiagnostics();
  assert.equal(diagnostic.events.length, 30); assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  diagnostic.events[0].event = 'changed'; diagnostic.displayRect[0] = 999;
  assert.notEqual(w.TCPlayPlatform.getPlaybackDiagnostics().events[0].event, 'changed');
  assert.notEqual(w.TCPlayPlatform.getPlaybackDiagnostics().displayRect[0], 999);
  player.play(secret, callbacks); listeners[0].onbufferingstart();
  assert.equal(w.TCPlayPlatform.getPlaybackDiagnostics().bufferingCount, 0);
  assert.equal(w.TCPlayPlatform.getPlaybackDiagnostics().bufferingMs, 0);
});
