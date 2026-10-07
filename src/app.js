(function () {
  'use strict';
  var config = window.TCPLAY_CONFIG || {};
  var api = TCPlay.createApi(config, window.XMLHttpRequest);
  var platform = window.TCPlayPlatform;
  var credentials = null, categories = [], channels = [], selected = null;
  var page = 0, pageSize = 12, categorySequence = 0, loginSequence = 0;
  var requests = [], fullscreen = false, dialogOpen = false, previousFocus = null;
  var overlayTimer = null, playbackState = 'idle', loginBusy = false;
  function el(id) { return document.getElementById(id); }
  function text(id, value) { el(id).textContent = value; }
  function hide(id, value) { el(id).classList[value ? 'add' : 'remove']('hidden'); }
  function visible(node) {
    if (node.disabled) return false;
    for (var parent = node; parent && parent.nodeType === 1; parent = parent.parentNode) {
      if (window.getComputedStyle(parent).display === 'none') return false;
    }
    return true;
  }
  function focusables() {
    var nodes = document.querySelectorAll(dialogOpen ? '#exit-dialog button' : 'button, input');
    return Array.prototype.filter.call(nodes, visible);
  }
  function focus(node) {
    if (!node || !visible(node)) return;
    node.focus();
    if (node.parentNode.id === 'channels' || node.parentNode.id === 'categories') {
      var container = node.parentNode;
      var bounds = node.getBoundingClientRect(), viewport = container.getBoundingClientRect();
      if (bounds.top < viewport.top) container.scrollTop -= viewport.top - bounds.top;
      else if (bounds.bottom > viewport.bottom) container.scrollTop += bounds.bottom - viewport.bottom;
    }
  }
  function navigate(code) {
    var nodes = focusables(), current = document.activeElement;
    var origin = current.getBoundingClientRect(), best = null, bestScore = Infinity;
    var horizontal = code === 37 || code === 39;
    var direction = code === 37 || code === 38 ? -1 : 1;
    var cx = origin.left + origin.width / 2, cy = origin.top + origin.height / 2;
    nodes.forEach(function (node) {
      if (node === current) return;
      var rect = node.getBoundingClientRect();
      var dx = rect.left + rect.width / 2 - cx;
      var dy = rect.top + rect.height / 2 - cy;
      var along = horizontal ? dx : dy, across = horizontal ? dy : dx;
      if (along * direction <= 1) return;
      var score = Math.abs(along) + Math.abs(across) * 3;
      if (score < bestScore) { best = node; bestScore = score; }
    });
    if (!best && !origin.width) {
      var index = nodes.indexOf(current);
      best = nodes[Math.max(0, Math.min(nodes.length - 1, index + direction))];
    }
    focus(best);
  }
  function abortRequests() {
    categorySequence += 1;
    requests.forEach(function (request) { request.abort(); });
    requests = [];
  }
  function post(path, body, done) { requests.push(api.post(path, body, done)); }
  function authBody(extra) {
    var body = { username: credentials.username, password: credentials.password };
    Object.keys(extra || {}).forEach(function (key) { body[key] = extra[key]; });
    return body;
  }
  function showOverlay() {
    if (!fullscreen || dialogOpen) return;
    hide('player-overlay', false);
    clearTimeout(overlayTimer);
    if (playbackState === 'playing') overlayTimer = setTimeout(function () {
      hide('player-overlay', true);
    }, 5000);
  }
  var player = platform.createPlayer(el('video'), el('media-slot'));
  var playback = TCPlay.createPlayback(api, player, config, function (state, message) {
    playbackState = state;
    text('playback-status', message);
    text('fullscreen-status', message);
    showOverlay();
  });
  function positionPlayer() {
    if (!credentials) return;
    hide('media-slot', false);
    var anchor = el('preview-anchor'), bounds = anchor.getBoundingClientRect();
    var rect = fullscreen ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : {
      left: bounds.left + anchor.clientLeft, top: bounds.top + anchor.clientTop,
      width: anchor.clientWidth, height: anchor.clientHeight
    };
    var slot = el('media-slot');
    slot.style.left = rect.left + 'px'; slot.style.top = rect.top + 'px';
    slot.style.width = rect.width + 'px'; slot.style.height = rect.height + 'px';
    player.setRect(rect, window.innerWidth, window.innerHeight);
  }
  function setFullscreen(value) {
    if (value && !selected) return;
    fullscreen = value;
    document.body.classList[value ? 'add' : 'remove']('fullscreen');
    clearTimeout(overlayTimer);
    hide('player-overlay', !value);
    positionPlayer();
    if (value) { focus(el('leave-fullscreen')); showOverlay(); }
    else focus(el('fullscreen'));
  }
  function validItems(items) {
    if (!Array.isArray(items)) return null;
    return items.filter(function (item) {
      return item && item.id !== null && item.id !== undefined && typeof item.name === 'string';
    });
  }
  function renderChannels() {
    var list = el('channels');
    list.textContent = '';
    var start = page * pageSize;
    channels.slice(start, start + pageSize).forEach(function (channel) {
      var button = document.createElement('button');
      button.type = 'button'; button.textContent = channel.name;
      button.setAttribute('data-channel', String(channel.id));
      if (selected && String(selected.id) === String(channel.id)) button.classList.add('selected');
      button.onclick = function () { selectChannel(channel); };
      list.appendChild(button);
    });
    el('previous-page').disabled = page === 0;
    el('next-page').disabled = start + pageSize >= channels.length;
    text('page-label', channels.length ? String(page + 1) + ' / ' + Math.ceil(channels.length / pageSize) : '0 / 0');
  }
  function selectChannel(channel) {
    selected = channel;
    text('channel-title', channel.name); text('fullscreen-title', channel.name);
    var nodes = el('channels').querySelectorAll('button');
    Array.prototype.forEach.call(nodes, function (node) {
      node.classList[node.getAttribute('data-channel') === String(channel.id) ? 'add' : 'remove']('selected');
    });
    positionPlayer();
    playback.play(credentials, channel);
  }
  function loadChannels(category) {
    abortRequests();
    var ticket = categorySequence;
    page = 0; channels = []; renderChannels();
    text('category-title', category.name); text('catalogue-status', 'Cargando canales…');
    el('reload').onclick = function () { loadChannels(category); };
    Array.prototype.forEach.call(el('categories').querySelectorAll('button'), function (node) {
      node.classList[node.getAttribute('data-category') === String(category.id) ? 'add' : 'remove']('selected');
    });
    post('live/streams', authBody({ category_id: String(category.id) }), function (err, data) {
      if (ticket !== categorySequence || !credentials) return;
      var items = !err && validItems(data.channels);
      if (!items) { text('catalogue-status', err ? err.message : TCPlay.message('response')); return; }
      channels = items; renderChannels();
      text('catalogue-status', channels.length ? channels.length + ' canales disponibles' : 'No hay canales en esta categoría.');
    });
  }
  function loadCategories() {
    abortRequests();
    var ticket = categorySequence;
    text('catalogue-status', 'Cargando categorías…');
    el('reload').onclick = loadCategories;
    post('live/categories', authBody(), function (err, data) {
      if (ticket !== categorySequence || !credentials) return;
      var items = !err && validItems(data.categories);
      if (!items) { text('catalogue-status', err ? err.message : TCPlay.message('response')); return; }
      categories = items; el('categories').textContent = '';
      categories.forEach(function (category) {
        var button = document.createElement('button');
        button.type = 'button'; button.textContent = category.name;
        button.setAttribute('data-category', String(category.id));
        button.onclick = function () { loadChannels(category); };
        el('categories').appendChild(button);
      });
      if (categories.length) {
        loadChannels(categories[0]); focus(el('categories').firstChild);
      } else text('catalogue-status', 'Tu cuenta no tiene categorías disponibles.');
    });
  }
  el('login-form').onsubmit = function (event) {
    event.preventDefault();
    if (loginBusy) return;
    var username = el('username').value.trim(), password = el('password').value;
    if (!username || !password) { text('login-status', TCPlay.message('missing_credentials')); return; }
    var candidate = { username: username, password: password }, ticket = ++loginSequence;
    loginBusy = true; el('login-button').disabled = true; text('login-status', 'Ingresando…');
    post('login', candidate, function (err) {
      if (ticket !== loginSequence) return;
      loginBusy = false; el('login-button').disabled = false;
      if (err) { text('login-status', err.message); focus(el('login-button')); return; }
      credentials = candidate; el('password').value = '';
      text('login-status', ''); hide('login-screen', true); hide('home-screen', false);
      positionPlayer(); loadCategories();
    });
  };
  function logout() {
    loginSequence += 1; loginBusy = false; el('login-button').disabled = false;
    abortRequests(); playback.stop();
    setFullscreen(false); credentials = null; selected = null; channels = []; categories = [];
    el('categories').textContent = ''; renderChannels();
    text('channel-title', 'Elige un canal');
    text('playback-status', 'Selecciona un canal y presiona OK para reproducir.');
    hide('media-slot', true); hide('home-screen', true); hide('login-screen', false);
    el('password').value = ''; focus(el('username'));
  }
  function openExit() {
    previousFocus = document.activeElement; dialogOpen = true;
    hide('exit-dialog', false); focus(el('cancel-exit'));
  }
  function closeExit() {
    dialogOpen = false; hide('exit-dialog', true); showOverlay();
    focus(previousFocus);
  }
  function back() {
    if (dialogOpen) closeExit();
    else if (fullscreen) setFullscreen(false);
    else openExit();
  }
  function zap(direction) {
    if (!credentials || !channels.length) return;
    var index = -1;
    channels.forEach(function (channel, position) {
      if (selected && String(channel.id) === String(selected.id)) index = position;
    });
    selectChannel(channels[(index + direction + channels.length) % channels.length]);
  }
  el('logout').onclick = logout;
  el('fullscreen').onclick = function () { setFullscreen(true); };
  el('leave-fullscreen').onclick = function () { setFullscreen(false); };
  el('retry').onclick = function () { if (selected) selectChannel(selected); };
  el('previous-page').onclick = function () { if (page > 0) { page -= 1; renderChannels(); focus(el('channels').firstChild); } };
  el('next-page').onclick = function () { if ((page + 1) * pageSize < channels.length) { page += 1; renderChannels(); focus(el('channels').firstChild); } };
  el('cancel-exit').onclick = closeExit;
  el('confirm-exit').onclick = function () {
    abortRequests(); loginSequence += 1; playback.stop(); credentials = null; el('password').value = '';
    platform.exit();
  };
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode || event.which, action = platform.keyAction(code);
    if (action === 'back' || code === 27) { event.preventDefault(); back(); return; }
    if (dialogOpen && action) { event.preventDefault(); return; }
    if (action === 'next' || action === 'previous') {
      event.preventDefault(); zap(action === 'next' ? 1 : -1); return;
    }
    showOverlay();
    if (code >= 37 && code <= 40) {
      if (document.activeElement.tagName === 'INPUT' && (code === 37 || code === 39)) return;
      event.preventDefault(); navigate(code);
    } else if (code === 13 && document.activeElement.tagName !== 'INPUT') {
      event.preventDefault();
      if (document.activeElement.click) document.activeElement.click();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      abortRequests(); loginSequence += 1; loginBusy = false; el('login-button').disabled = false;
      playback.stop();
      if (selected) {
        playbackState = 'idle';
        text('playback-status', 'Presiona Reintentar canal para continuar.');
        text('fullscreen-status', 'Vuelve a canales y presiona Reintentar canal.');
      }
    } else { positionPlayer(); showOverlay(); }
  });
  window.addEventListener('pagehide', function () { abortRequests(); playback.stop(); credentials = null; });
  window.addEventListener('resize', positionPlayer);
  platform.init(); text('platform-label', platform.label);
  hide('media-slot', true); focus(el('username'));
}());
