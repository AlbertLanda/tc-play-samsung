(function (root) {
  'use strict';
  root.TCPlayPlatform = {
    label: 'Samsung · Tizen',
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
      var generation = 0, rectangle = [0, 0, 1920, 1080], object;
      video.style.display = 'none';
      object = document.createElement('object');
      object.id = 'native-player'; object.type = 'application/avplayer'; slot.appendChild(object);
      function stop() {
        generation += 1;
        if (!av) return;
        try { av.close(); } catch (ignore) {}
      }
      return {
        play: function (url, callbacks) {
          stop();
          var ticket = generation;
          function current() { return ticket === generation; }
          if (!av) { callbacks.error(); return; }
          try {
            av.open(url);
            av.setListener({
              onbufferingstart: function () { if (current()) callbacks.buffering(); },
              onbufferingcomplete: function () {
                if (current() && av.getState() === 'PLAYING') callbacks.ready();
              },
              oncurrentplaytime: function () { if (current()) callbacks.ready(); },
              onerror: function () { if (current()) callbacks.error(); },
              onstreamcompleted: function () { if (current()) callbacks.ended(); }
            });
            av.setDisplayRect.apply(av, rectangle);
            av.prepareAsync(function () {
              if (!current()) return;
              try {
                av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
                av.play();
              } catch (ignore) { callbacks.error(); }
            }, function () { if (current()) callbacks.error(); });
          } catch (ignore) { if (current()) callbacks.error(); }
        },
        stop: stop,
        setRect: function (rect, width, height) {
          rectangle = [Math.round(rect.left * 1920 / width), Math.round(rect.top * 1080 / height),
            Math.max(1, Math.round(rect.width * 1920 / width)), Math.max(1, Math.round(rect.height * 1080 / height))];
          if (!av) return;
          try { if (av.getState() !== 'NONE') av.setDisplayRect.apply(av, rectangle); } catch (ignore) {}
        }
      };
    }
  };
}(window));
