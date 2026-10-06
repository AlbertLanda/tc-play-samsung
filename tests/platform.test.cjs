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
  if (samsung) w.webapis = { avplay: { getState: () => 'PLAYING', setDisplayRect(...args) { rectangle = args; } } };
  w.eval(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'));
  const player = w.TCPlayPlatform.createPlayer(video, w.document.getElementById('slot'));
  player.setRect({ left: 100, top: 50, width: 600, height: 300 }, 1280, 720);
  if (samsung) assert.deepEqual(rectangle, [150, 75, 900, 450]);
  else assert.equal(w.document.querySelectorAll('video').length, 1);
});
