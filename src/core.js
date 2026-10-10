(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TCPlay = factory();
}(this, function () {
  'use strict';
  function message(code) {
    var messages = {
      invalid_credentials: 'El usuario o la contraseña no son correctos.',
      inactive_account: 'Tu cuenta no está activa. Contacta a Telecable.',
      missing_credentials: 'Completa tu usuario y contraseña.',
      network: 'No pudimos conectar. Comprueba tu conexión y vuelve a intentar.',
      timeout: 'La conexión tardó demasiado. Vuelve a intentar.',
      unconfigured: 'Esta versión de prueba aún no está configurada.',
      playback: 'No pudimos reproducir este canal. Prueba otro o vuelve a intentar.'
    };
    return messages[code] || 'No pudimos completar la solicitud. Vuelve a intentar.';
  }
  function error(code) { return { code: code, message: message(code) }; }
  function createApi(config, XMLHttpRequestImpl) {
    var base = String(config.apiBaseUrl || '').replace(/\/+$/, '');
    function post(path, body, done) {
      var xhr, finished = false;
      function complete(err, data) {
        if (finished) return;
        finished = true;
        done(err, data);
      }
      if (!/^https?:\/\/[^\s]+$/i.test(base)) {
        complete(error('unconfigured'));
        return { abort: function () {} };
      }
      xhr = new XMLHttpRequestImpl();
      try {
        xhr.open('POST', base + '/api/xtream/' + path + '/', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = config.requestTimeoutMs || 15000;
        xhr.onload = function () {
          var data;
          try { data = JSON.parse(xhr.responseText); }
          catch (ignore) { complete(error('response')); return; }
          if (xhr.status < 200 || xhr.status >= 300 || !data || data.success !== true) {
            complete(error(data && data.error_code || 'response'));
            return;
          }
          complete(null, data);
        };
        xhr.onerror = function () { complete(error('network')); };
        xhr.ontimeout = function () { complete(error('timeout')); };
        xhr.onabort = function () { finished = true; };
        xhr.send(JSON.stringify(body));
      } catch (ignore) { complete(error('network')); }
      return { abort: function () { finished = true; xhr.abort(); } };
    }
    return { post: post };
  }
  // One current request/player. Older replies and native callbacks cannot start playback.
  function createPlayback(api, player, config, report, timers) {
    var sequence = 0, request = null, watchdog = null, active = false;
    var urls = {}, urlOrder = [], warmRequests = [], warmQueue = [], warmSequence = 0;
    var sessionUser = null, sessionPassword = null;
    var switchStarted = null, playerStarted = null, switchStats = {
      urlSource: null, urlResolutionMs: null, playerStartupMs: null, totalStartupMs: null
    };
    // Browser timer methods must not receive the adapter object as their receiver.
    timers = timers || {
      setTimeout: function (fn, delay) { return setTimeout(fn, delay); },
      clearTimeout: function (id) { clearTimeout(id); }
    };
    function clearWatchdog() {
      if (watchdog !== null) timers.clearTimeout(watchdog);
      watchdog = null;
    }
    function cancelWarmup() {
      warmSequence += 1;
      warmQueue = [];
      warmRequests.forEach(function (entry) { if (entry.request) entry.request.abort(); });
      warmRequests = [];
    }
    function release() {
      sequence += 1;
      if (request) request.abort();
      request = null;
      clearWatchdog();
      active = false;
      player.stop();
      cancelWarmup();
    }
    function stop() {
      release(); urls = {}; urlOrder = []; sessionUser = null; sessionPassword = null;
      switchStarted = null; playerStarted = null;
      switchStats = { urlSource: null, urlResolutionMs: null, playerStartupMs: null, totalStartupMs: null };
    }
    function session(credentials) {
      if (sessionUser !== credentials.username || sessionPassword !== credentials.password) {
        stop(); sessionUser = credentials.username; sessionPassword = credentials.password;
      }
    }
    function key(channel) { return '$' + (config.streamFormat === 'ts' ? 'ts' : 'm3u8') + ':' + channel.id; }
    function validUrl(data) {
      return data && typeof data.stream_url === 'string' && /^https?:\/\/[^\s]+$/i.test(data.stream_url);
    }
    function cached(channel) {
      var entry = urls[key(channel)];
      return entry && Date.now() - entry.at < 60000 ? entry.url : null;
    }
    function remember(channel, url) {
      var id = key(channel), index = urlOrder.indexOf(id);
      if (index >= 0) urlOrder.splice(index, 1);
      urlOrder.push(id); urls[id] = { url: url, at: Date.now() };
      if (urlOrder.length > 24) delete urls[urlOrder.shift()];
    }
    function body(credentials, channel) {
      return { username: credentials.username, password: credentials.password,
        stream_id: String(channel.id), output: config.streamFormat === 'ts' ? 'ts' : 'm3u8' };
    }
    // Resolve URLs only: no media preloading or extra Xtream playback connections.
    function prepare(credentials, channels) {
      if (!active || sessionUser !== credentials.username || sessionPassword !== credentials.password) return;
      cancelWarmup();
      var ticket = warmSequence, seen = {};
      warmQueue = channels.slice(0, 12).filter(function (channel) {
        var id = key(channel);
        if (seen[id] || cached(channel)) return false;
        seen[id] = true; return true;
      });
      function pump() {
        if (ticket !== warmSequence || !active) return;
        while (warmRequests.length < 2 && warmQueue.length) {
          resolve(warmQueue.shift());
        }
      }
      function resolve(channel) {
        var entry = { request: null, done: false };
        warmRequests.push(entry);
        entry.request = api.post('live/stream-url', body(credentials, channel), function (err, data) {
          entry.done = true;
          if (ticket !== warmSequence) return;
          var index = warmRequests.indexOf(entry);
          if (index >= 0) warmRequests.splice(index, 1);
          if (!err && validUrl(data)) remember(channel, data.stream_url);
          pump();
        });
        if (ticket !== warmSequence && !entry.done) entry.request.abort();
      }
      pump();
    }
    function play(credentials, channel, refresh) {
      session(credentials); release();
      if (refresh) delete urls[key(channel)];
      var ticket = sequence;
      var url = cached(channel);
      switchStarted = Date.now(); playerStarted = null;
      switchStats = { urlSource: url ? 'prepared' : 'request', urlResolutionMs: null,
        playerStartupMs: null, totalStartupMs: null };
      function current() { return ticket === sequence; }
      function fail() {
        if (!current()) return;
        delete urls[key(channel)]; release();
        report('error', message('playback'));
      }
      report('loading', 'Conectando con ' + channel.name + '…');
      function open(err, data) {
        if (!current()) return;
        request = null;
        if (err) {
          delete urls[key(channel)]; release();
          report('error', err.message);
          return;
        }
        if (!validUrl(data)) { fail(); return; }
        if (!url) remember(channel, data.stream_url);
        switchStats.urlResolutionMs = Date.now() - switchStarted;
        playerStarted = Date.now();
        watchdog = timers.setTimeout(fail, config.playbackTimeoutMs || 20000);
        try {
          player.play(data.stream_url, {
            ready: function () {
              if (!current() || active) return;
              clearWatchdog(); active = true;
              if (switchStats.totalStartupMs === null) {
                switchStats.playerStartupMs = Date.now() - playerStarted;
                switchStats.totalStartupMs = Date.now() - switchStarted;
              }
              report('playing', channel.name);
            },
            buffering: function () {
              if (!current()) return;
              active = false;
              cancelWarmup();
              report('loading', 'Cargando ' + channel.name + '…');
              if (watchdog === null) watchdog = timers.setTimeout(fail, config.playbackTimeoutMs || 20000);
            },
            error: fail,
            ended: fail
          });
        } catch (ignore) { fail(); }
      }
      if (url) open(null, { stream_url: url });
      else {
        var completed = false;
        var pending = api.post('live/stream-url', body(credentials, channel), function (err, data) {
          completed = true; open(err, data);
        });
        if (!completed && current()) request = pending;
      }
    }
    return { play: play, stop: stop, prepare: prepare, isActive: function () { return active; },
      getDiagnostics: function () {
        return { urlSource: switchStats.urlSource, urlResolutionMs: switchStats.urlResolutionMs,
          playerStartupMs: switchStats.playerStartupMs, totalStartupMs: switchStats.totalStartupMs };
      }
    };
  }
  return { createApi: createApi, createPlayback: createPlayback, message: message };
}));
