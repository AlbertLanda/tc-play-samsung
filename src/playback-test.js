(function (root) {
  'use strict';
  var video = document.getElementById('test-video'), status = document.getElementById('test-status');
  var started = null, firstPlaying = null, events = [], generation = 0;
  function record(name) {
    if (started === null) return;
    var event = { event: name, atMs: Date.now() - started };
    if (name === 'error' && video.error) event.code = video.error.code;
    events.push(event); if (events.length > 30) events.shift();
  }
  ['loadedmetadata', 'playing', 'waiting', 'stalled', 'ended', 'error'].forEach(function (name) {
    video.addEventListener(name, function () {
      record(name);
      if (name === 'playing') {
        if (started !== null && firstPlaying === null) firstPlaying = Date.now() - started;
        status.textContent = 'Reproduciendo archivo local. Observa el movimiento y escucha el tono.';
      } else if (name === 'ended') status.textContent = 'Prueba terminada. Puedes repetirla o mostrar el diagnóstico.';
      else if (name === 'error') status.textContent = 'No se pudo reproducir el archivo local. Muestra el diagnóstico.';
    });
  });
  root.getLocalPlaybackTestDiagnostics = function () {
    var quality = null;
    try {
      if (video.getVideoPlaybackQuality) {
        var q = video.getVideoPlaybackQuality();
        if (q.totalVideoFrames > 0) quality = { totalFrames: q.totalVideoFrames, droppedFrames: q.droppedVideoFrames };
      }
    } catch (ignore) {}
    return { source: 'bundled-mp4', startupMs: firstPlaying, playbackTimeMs: Math.round(video.currentTime * 1000),
      sourceSize: [video.videoWidth, video.videoHeight], readyState: video.readyState,
      frameQuality: quality, events: events.map(function (event) {
        var copy = { event: event.event, atMs: event.atMs };
        if (typeof event.code === 'number') copy.code = event.code;
        return copy;
      }) };
  };
  document.getElementById('start-test').onclick = function () {
    generation += 1;
    var ticket = generation;
    events = []; started = Date.now(); firstPlaying = null;
    document.getElementById('report').textContent = '';
    status.textContent = 'Iniciando archivo local…';
    try {
      video.pause(); video.currentTime = 0;
      var result = video.play();
      if (result && result.catch) result.catch(function () {
        if (ticket !== generation) return;
        record('play_rejected'); status.textContent = 'No se pudo iniciar. Muestra el diagnóstico.';
      });
    } catch (ignore) { record('play_failed'); status.textContent = 'No se pudo iniciar. Muestra el diagnóstico.'; }
  };
  document.getElementById('size-test').onclick = function () { document.body.classList.toggle('large'); };
  document.getElementById('report-test').onclick = function () {
    document.getElementById('report').textContent = JSON.stringify(root.getLocalPlaybackTestDiagnostics(), null, 2);
  };
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode || event.which, buttons = document.querySelectorAll('button');
    if (code === 37 || code === 39) {
      event.preventDefault();
      var index = Array.prototype.indexOf.call(buttons, document.activeElement);
      buttons[(Math.max(0, index) + (code === 39 ? 1 : buttons.length - 1)) % buttons.length].focus();
    } else if (code === 10009 || code === 27) {
      video.pause();
      if (root.tizen && root.tizen.application) root.tizen.application.getCurrentApplication().exit();
    }
  });
  root.addEventListener('pagehide', function () { generation += 1; video.pause(); video.removeAttribute('src'); video.load(); });
  document.getElementById('start-test').focus();
}(window));
