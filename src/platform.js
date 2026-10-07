(function (root) {
  'use strict';
  var readDiagnostics = function () { return { state: 'NONE', events: [] }; };
  root.TCPlayPlatform = {
    label: 'Samsung · Tizen',
    getPlaybackDiagnostics: function () { return readDiagnostics(); },
    init: function () {
      if (!root.tizen || !root.tizen.tvinputdevice) return;
      ['ChannelUp', 'ChannelDown'].forEach(function (key) {
        try { root.tizen.tvinputdevice.registerKey(key); } catch (ignore) {}
      });
    },
    keyAction: function (code) {
      return { 10009: 'back', 427: 'next', 428: 'previous' }[code] || null;
    },
    exit: function () {
      if (root.tizen && root.tizen.application) root.tizen.application.getCurrentApplication().exit();
      else root.close();
    },
    createPlayer: function (video, slot) {
      var av = root.webapis && root.webapis.avplay;
      var generation = 0, rectangle = [0, 0, 1920, 1080], object, buffering = false;
      var mode = 'PLAYER_DISPLAY_MODE_LETTER_BOX', started = Date.now(), events = [];
      var bufferCount = 0, bufferSince = null, bufferMs = 0, playTime = null, progressAt = null;
      function record(event, value) {
        var item = { atMs: Date.now() - started, event: event };
        if (typeof value === 'number' && isFinite(value)) item.value = value;
        events.push(item);
        if (events.length > 30) events.shift();
      }
      function failure(event, error) {
        var code = typeof error === 'string' ? error : error && error.name;
        var known = ['InvalidStateError', 'InvalidValuesError', 'TypeMismatchError', 'NotSupportedError',
          'InvalidAccessError', 'UnknownError', 'PLAYER_ERROR_NONE', 'PLAYER_ERROR_INVALID_PARAMETER',
          'PLAYER_ERROR_NO_SUCH_FILE', 'PLAYER_ERROR_INVALID_OPERATION', 'PLAYER_ERROR_SEEK_FAILED',
          'PLAYER_ERROR_INVALID_STATE', 'PLAYER_ERROR_NOT_SUPPORTED_FILE', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT',
          'PLAYER_ERROR_INVALID_URI', 'PLAYER_ERROR_CONNECTION_FAILED', 'PLAYER_ERROR_GENEREIC'];
        record(event);
        if (known.indexOf(code) >= 0) events[events.length - 1].code = code;
      }
      readDiagnostics = function () {
        var state = 'NONE';
        try { if (av) state = av.getState(); } catch (ignore) {}
        if (['NONE', 'IDLE', 'READY', 'PLAYING', 'PAUSED'].indexOf(state) < 0) state = 'UNKNOWN';
        // Only explicit numeric data and internal event names: no stream URLs or raw native errors.
        return {
          state: state, displayRect: rectangle.slice(), displayMode: mode,
          buffering: buffering, bufferingCount: bufferCount,
          bufferingMs: bufferMs + (bufferSince === null ? 0 : Date.now() - bufferSince),
          playbackTimeMs: playTime, lastProgressAgeMs: progressAt === null ? null : Date.now() - progressAt,
          events: events.map(function (item) {
            var copy = { atMs: item.atMs, event: item.event };
            if (typeof item.value === 'number') copy.value = item.value;
            if (item.code) copy.code = item.code;
            return copy;
          })
        };
      };
      video.style.display = 'none';
      object = document.createElement('object');
      object.id = 'native-player'; object.type = 'application/avplayer'; slot.appendChild(object);
      function stop() {
        generation += 1;
        if (bufferSince !== null) bufferMs += Date.now() - bufferSince;
        bufferSince = null; buffering = false;
        record('close');
        if (!av) return;
        try { av.close(); } catch (ignore) {}
      }
      function display() {
        av.setDisplayRect.apply(av, rectangle);
        av.setDisplayMethod(mode);
      }
      return {
        play: function (url, callbacks) {
          stop();
          started = Date.now(); events = []; bufferCount = 0; bufferMs = 0;
          playTime = null; progressAt = null;
          var ticket = generation;
          function current() { return ticket === generation; }
          if (!av) { failure('avplay_unavailable'); callbacks.error(); return; }
          try {
            av.open(url);
            record('open');
            av.setListener({
              onbufferingstart: function () {
                if (!current()) return;
                if (!buffering) { bufferCount += 1; bufferSince = Date.now(); }
                buffering = true; record('buffering_start'); callbacks.buffering();
              },
              onbufferingprogress: function (percent) { if (current()) record('buffering_progress', percent); },
              onbufferingcomplete: function () {
                if (!current()) return;
                if (bufferSince !== null) bufferMs += Date.now() - bufferSince;
                bufferSince = null; buffering = false; record('buffering_complete');
                if (av.getState() === 'PLAYING') callbacks.ready();
              },
              oncurrentplaytime: function (time) {
                if (!current()) return;
                if (typeof time === 'number' && isFinite(time)) {
                  if (playTime === null || time > playTime) progressAt = Date.now();
                  playTime = time;
                }
                if (!buffering) callbacks.ready();
              },
              onerror: function (error) { if (current()) { failure('native_error', error); callbacks.error(); } },
              onstreamcompleted: function () { if (current()) { record('stream_complete'); callbacks.ended(); } }
            });
            display();
            av.prepareAsync(function () {
              if (!current()) return;
              try {
                // Apply the latest rectangle if fullscreen changed during preparation.
                display(); record('prepared');
                av.play();
                record('play');
              } catch (error) { failure('play_failed', error); callbacks.error(); }
            }, function (error) { if (current()) { failure('prepare_failed', error); callbacks.error(); } });
          } catch (error) { if (current()) { failure('open_or_setup_failed', error); callbacks.error(); } }
        },
        stop: stop,
        setRect: function (rect, width, height) {
          // Keep the native object and AVPlay plane at the same computed size.
          object.style.width = rect.width + 'px'; object.style.height = rect.height + 'px';
          rectangle = [Math.round(rect.left * 1920 / width), Math.round(rect.top * 1080 / height),
            Math.max(1, Math.round(rect.width * 1920 / width)), Math.max(1, Math.round(rect.height * 1080 / height))];
          if (!av) return;
          try { if (av.getState() !== 'NONE') { display(); record('display_updated'); } }
          catch (error) { failure('display_update_failed', error); }
        }
      };
    }
  };
}(window));
