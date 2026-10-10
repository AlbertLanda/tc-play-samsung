(function () {
  'use strict';
  var config = window.TCPLAY_CONFIG || {};
  var api = TCPlay.createApi(config, window.XMLHttpRequest);
  var platform = window.TCPlayPlatform;
  var credentials = null, categories = [], channels = [], selected = null;
  var page = 0, pageSize = 12, categorySequence = 0, loginSequence = 0;
  var requests = [], fullscreen = false, dialogOpen = false, previousFocus = null;
  var overlayTimer = null, playbackState = 'idle', loginBusy = false;
  var categoryCache = {}, startupPending = false;
  var currentCategory = null, selectedCategory = null;
  var zapTimer = null, zapRequest = null, zapSequence = 0;
  var zapQueue = [], zapBusy = false, zapActive = false;
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
    if (state === 'playing') prepareUrls();
  });
  window.TCPlayApp = { getChannelSwitchDiagnostics: function () { return playback.getDiagnostics(); } };
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
    if (!value && zapActive) {
      cancelZap();
      if (credentials && selected) selectChannel(selected);
    }
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
    prepareUrls();
  }
  function prepareUrls() {
    if (credentials && playbackState === 'playing') {
      playback.prepare(credentials, channels.slice(page * pageSize, (page + 1) * pageSize));
    }
  }
  function initialChannel(items) {
    var exact = null, variant = null;
    items.forEach(function (channel) {
      var name = channel.name.trim().toUpperCase();
      if (!exact && name === 'WILLAX') exact = channel;
      if (!variant && /\bWILLAX\b/.test(name)) variant = channel;
    });
    return exact || variant || items[0] || null;
  }
  function showChannel(channel, category) {
    selected = channel;
    selectedCategory = category || currentCategory;
    if (selectedCategory && selectedCategory !== currentCategory) loadChannels(selectedCategory);
    var index = channels.indexOf(channel);
    if (index >= 0 && Math.floor(index / pageSize) !== page) {
      page = Math.floor(index / pageSize); renderChannels();
    }
    text('channel-title', channel.name); text('fullscreen-title', channel.name);
    text('fullscreen-category', selectedCategory ? selectedCategory.name : '');
    var nodes = el('channels').querySelectorAll('button');
    Array.prototype.forEach.call(nodes, function (node) {
      node.classList[node.getAttribute('data-channel') === String(channel.id) ? 'add' : 'remove']('selected');
    });
    positionPlayer();
  }
  function selectChannel(channel, retry) {
    cancelZap();
    if (!retry && selected && String(selected.id) === String(channel.id) &&
        (playbackState === 'playing' || playbackState === 'loading')) return;
    playbackState = 'loading';
    showChannel(channel, channels.indexOf(channel) >= 0 ? currentCategory : selectedCategory);
    playback.play(credentials, channel, retry === true);
  }
  function cancelZap() {
    clearTimeout(zapTimer); zapTimer = null;
    zapSequence += 1;
    if (zapRequest) zapRequest.abort();
    zapRequest = null; zapQueue = []; zapBusy = false; zapActive = false;
  }
  function finishZap() {
    if (!zapActive || zapBusy || zapQueue.length || !credentials) return;
    clearTimeout(zapTimer);
    zapTimer = setTimeout(function () {
      if (zapActive && credentials && selected) selectChannel(selected);
    }, 350);
  }
  function stepFullscreenChannel(direction) {
    if (!fullscreen || !credentials || !selected || !categories.length) return;
    if (!zapActive) { playback.cancel(); zapActive = true; }
    clearTimeout(zapTimer);
    playbackState = 'choosing';
    zapQueue.push(direction);
    advanceZap();
  }
  function advanceZap() {
    if (zapBusy || !zapQueue.length || !zapActive) return;
    zapBusy = true;
    var direction = zapQueue.shift();
    var ticket = zapSequence;
    var categoryIndex = categories.indexOf(selectedCategory);
    if (categoryIndex < 0) categoryIndex = 0;
    function visit(index, first, visited) {
      if (ticket !== zapSequence || !credentials) return;
      var category = categories[index], cached = categoryCache['$' + category.id];
      function complete(err, data) {
        if (ticket !== zapSequence || !credentials) return;
        zapRequest = null;
        var items = !err && validItems(data.channels);
        if (!items) {
          cancelZap(); playbackState = 'idle';
          text('fullscreen-status', err ? err.message : TCPlay.message('response'));
          text('playback-status', 'Presiona Reintentar canal para continuar.');
          showOverlay(); return;
        }
        categoryCache['$' + category.id] = items;
        var position = -1;
        if (first) items.forEach(function (channel, i) {
          if (String(channel.id) === String(selected.id)) position = i;
        });
        var target = first && position >= 0 ? position + direction : (direction > 0 ? 0 : items.length - 1);
        if (target >= 0 && target < items.length) {
          showChannel(items[target], category);
          text('fullscreen-status', 'Suelta la flecha para reproducir este canal.');
          text('playback-status', 'Seleccionando canal…'); showOverlay();
          zapBusy = false;
          if (zapQueue.length) advanceZap(); else finishZap();
        } else if (visited < categories.length) {
          visit((index + direction + categories.length) % categories.length, false, visited + 1);
        } else {
          cancelZap(); playbackState = 'idle';
          text('fullscreen-status', 'No hay canales disponibles.'); showOverlay();
        }
      }
      if (cached) complete(null, { channels: cached });
      else {
        text('fullscreen-status', 'Cargando canales de ' + category.name + '…'); showOverlay();
        var completed = false;
        var request = api.post('live/streams', authBody({ category_id: String(category.id) }), function (err, data) {
          completed = true; complete(err, data);
        });
        if (!completed) zapRequest = request;
      }
    }
    visit(categoryIndex, true, 0);
  }
  function loadChannels(category, first, refresh) {
    abortRequests();
    var ticket = categorySequence;
    currentCategory = category;
    page = 0; channels = []; renderChannels();
    text('category-title', category.name); text('catalogue-status', 'Cargando canales…');
    el('reload').onclick = function () { loadChannels(category, false, true); };
    Array.prototype.forEach.call(el('categories').querySelectorAll('button'), function (node) {
      node.classList[node.getAttribute('data-category') === String(category.id) ? 'add' : 'remove']('selected');
    });
    function complete(err, data) {
      if (ticket !== categorySequence || !credentials) return;
      var items = !err && validItems(data.channels);
      if (!items) { text('catalogue-status', err ? err.message : TCPlay.message('response')); return; }
      categoryCache['$' + category.id] = items;
      channels = items;
      var start = first && !selected ? initialChannel(channels) : null;
      if (start) page = Math.floor(channels.indexOf(start) / pageSize);
      renderChannels();
      text('catalogue-status', channels.length ? channels.length + ' canales disponibles' : 'No hay canales en esta categoría.');
      if (start) { startupPending = false; selectChannel(start); }
    }
    var cached = categoryCache['$' + category.id];
    if (!refresh && cached) complete(null, { channels: cached });
    else post('live/streams', authBody({ category_id: String(category.id) }), complete);
  }
  function loadCategories() {
    cancelZap();
    abortRequests();
    var ticket = categorySequence;
    categoryCache = {};
    var categoryResult = null, catalogResult = null, categoriesDone = false, catalogDone = false;
    text('catalogue-status', 'Cargando categorías…');
    el('reload').onclick = loadCategories;
    function complete() {
      if (!categoriesDone || !catalogDone) return;
      if (ticket !== categorySequence || !credentials) return;
      if (!categoryResult.items) {
        text('catalogue-status', categoryResult.error ? categoryResult.error.message : TCPlay.message('response')); return;
      }
      categories = categoryResult.items; el('categories').textContent = '';
      if (catalogResult) {
        categories.forEach(function (category) { categoryCache['$' + category.id] = []; });
        catalogResult.forEach(function (channel) {
          var list = categoryCache['$' + channel.category_id];
          if (list) list.push(channel);
        });
      }
      categories.forEach(function (category) {
        var button = document.createElement('button');
        button.type = 'button'; button.textContent = category.name;
        button.setAttribute('data-category', String(category.id));
        button.onclick = function () { startupPending = false; loadChannels(category); };
        el('categories').appendChild(button);
      });
      if (categories.length) {
        var preferred = startupPending && catalogResult ? initialChannel(catalogResult) : null;
        var initial = categories[0];
        categories.forEach(function (category) {
          if (preferred && String(category.id) === String(preferred.category_id)) initial = category;
        });
        loadChannels(initial, startupPending);
        var buttons = el('categories').querySelectorAll('button');
        focus(buttons[categories.indexOf(initial)]);
      } else text('catalogue-status', 'Tu cuenta no tiene categorías disponibles.');
    }
    post('live/categories', authBody(), function (err, data) {
      categoryResult = { error: err, items: !err && validItems(data.categories) };
      categoriesDone = true; complete();
    });
    post('live/streams', authBody(), function (err, data) {
      catalogResult = !err && validItems(data.channels);
      // An older provider response may omit category_id: keep per-category loading.
      if (catalogResult && catalogResult.some(function (channel) {
        return channel.category_id === null || channel.category_id === undefined;
      })) catalogResult = null;
      catalogDone = true; complete();
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
      startupPending = true;
      text('login-status', ''); hide('login-screen', true); hide('home-screen', false);
      positionPlayer(); loadCategories();
    });
  };
  function logout() {
    loginSequence += 1; loginBusy = false; el('login-button').disabled = false;
    cancelZap(); abortRequests(); playback.stop();
    categoryCache = {}; startupPending = false;
    setFullscreen(false); credentials = null; selected = null; channels = []; categories = [];
    currentCategory = null; selectedCategory = null;
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
  el('retry').onclick = function () { if (selected) selectChannel(selected, true); };
  el('previous-page').onclick = function () { if (page > 0) { page -= 1; renderChannels(); focus(el('channels').firstChild); } };
  el('next-page').onclick = function () { if ((page + 1) * pageSize < channels.length) { page += 1; renderChannels(); focus(el('channels').firstChild); } };
  el('cancel-exit').onclick = closeExit;
  el('confirm-exit').onclick = function () {
    cancelZap(); abortRequests(); loginSequence += 1; playback.stop(); categoryCache = {}; startupPending = false;
    credentials = null; el('password').value = '';
    platform.exit();
  };
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode || event.which, action = platform.keyAction(code);
    if (action === 'back' || code === 27) { event.preventDefault(); back(); return; }
    if (dialogOpen && action) { event.preventDefault(); return; }
    if (fullscreen && !dialogOpen && (code === 37 || code === 39)) {
      event.preventDefault(); stepFullscreenChannel(code === 39 ? 1 : -1); return;
    }
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
      cancelZap();
      abortRequests(); loginSequence += 1; loginBusy = false; el('login-button').disabled = false;
      startupPending = false;
      playback.stop();
      if (selected) {
        playbackState = 'idle';
        text('playback-status', 'Presiona Reintentar canal para continuar.');
        text('fullscreen-status', 'Vuelve a canales y presiona Reintentar canal.');
      }
    } else { positionPlayer(); showOverlay(); }
  });
  window.addEventListener('pagehide', function () {
    cancelZap(); abortRequests(); playback.stop(); categoryCache = {}; startupPending = false; credentials = null;
  });
  window.addEventListener('resize', positionPlayer);
  platform.init(); text('platform-label', platform.label);
  hide('media-slot', true); focus(el('username'));
}());
