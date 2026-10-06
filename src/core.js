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
    timers = timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
    function clearWatchdog() {
      if (watchdog !== null) timers.clearTimeout(watchdog);
      watchdog = null;
    }
    function stop() {
      sequence += 1;
      if (request) request.abort();
      request = null;
      clearWatchdog();
      active = false;
      player.stop();
    }
    function play(credentials, channel) {
      stop();
      var ticket = sequence;
      function current() { return ticket === sequence; }
      function fail() {
        if (!current()) return;
        stop();
        report('error', message('playback'));
      }
      report('loading', 'Conectando con ' + channel.name + '…');
      request = api.post('live/stream-url', {
        username: credentials.username, password: credentials.password,
        stream_id: String(channel.id), output: 'm3u8'
      }, function (err, data) {
        if (!current()) return;
        request = null;
        if (err) {
          stop();
          report('error', err.message);
          return;
        }
        if (!data || typeof data.stream_url !== 'string' ||
            !/^https?:\/\/[^\s]+$/i.test(data.stream_url)) { fail(); return; }
        watchdog = timers.setTimeout(fail, config.playbackTimeoutMs || 20000);
        try {
          player.play(data.stream_url, {
            ready: function () {
              if (!current() || active) return;
              clearWatchdog(); active = true;
              report('playing', channel.name);
            },
            buffering: function () {
              if (!current()) return;
              active = false;
              report('loading', 'Cargando ' + channel.name + '…');
              if (watchdog === null) watchdog = timers.setTimeout(fail, config.playbackTimeoutMs || 20000);
            },
            error: fail,
            ended: fail
          });
        } catch (ignore) { fail(); }
      });
    }
    return { play: play, stop: stop, isActive: function () { return active; } };
  }
  return { createApi: createApi, createPlayback: createPlayback, message: message };
}));
