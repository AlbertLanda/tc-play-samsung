const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('temporizadores globales conservan su receptor al iniciar, cargar y detener video', () => {
  const context = vm.createContext({});
  // Unlike Node timers, browser host methods reject an unrelated receiver.
  vm.runInContext(`
    var pendingTimers = {}, nextTimer = 0;
    function setTimeout(callback, delay) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      pendingTimers[++nextTimer] = { callback: callback, delay: delay };
      return nextTimer;
    }
    function clearTimeout(id) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      delete pendingTimers[id];
    }
  `, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8'), context);

  const requests = [], plays = [], reports = [];
  const api = { post(path, body, done) {
    requests.push(done);
    return { abort() {} };
  } };
  const player = { stop() {}, play(url, callbacks) { plays.push({ url, callbacks }); } };
  const controller = context.TCPlay.createPlayback(api, player,
    { playbackTimeoutMs: 1234 }, (...report) => reports.push(report));
  const credentials = { username: 'test', password: 'secret' };
  const channel = { id: 1, name: 'Test' };
  function select() {
    controller.play(credentials, channel);
    requests.at(-1)(null, { stream_url: 'https://stream.invalid/test.m3u8' });
  }

  select();
  assert.equal(plays.length, 1);
  assert.equal(Object.values(context.pendingTimers)[0].delay, 1234);
  plays[0].callbacks.ready();
  assert.equal(controller.isActive(), true);
  assert.equal(Object.keys(context.pendingTimers).length, 0);

  plays[0].callbacks.buffering();
  assert.equal(Object.keys(context.pendingTimers).length, 1);
  Object.values(context.pendingTimers)[0].callback();
  assert.equal(reports.at(-1)[0], 'error');
  assert.equal(Object.keys(context.pendingTimers).length, 0);

  select();
  assert.equal(plays.length, 2);
  controller.stop();
  assert.equal(Object.keys(context.pendingTimers).length, 0);
});
