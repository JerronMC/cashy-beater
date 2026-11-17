/* Cashy Beater — by Dadasaves
   Static app for GitHub Pages. Local mode by default; online mode via Firebase Realtime Database (see README). */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ config */
  var CFG = window.CASHY_CONFIG || {};
  var DB = String(CFG.FIREBASE_URL || '').trim().replace(/\/+$/, '');
  var ONLINE = /^https:\/\/.+/.test(DB);
  var BOX_CD = 2 * 3600 * 1000;      // Lucky Box cooldown
  var DAILY_TAP_GOAL = 100;
  var SYNC_MS = 2000;                // leaderboard refresh
  var MAX_BOARD = 50;

  /* ----------------------------------------------------------------- helpers */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(n, c) { return '<svg class="i ' + (c || '') + '"><use href="#i-' + n + '"/></svg>'; }
  function fmt(n) {
    n = Math.floor(Number(n) || 0);
    if (n < 10000) return n.toLocaleString('en-US');
    var u = ['K', 'M', 'B', 'T'], i = -1, v = n;
    while (v >= 1000 && i < 3) { v /= 1000; i++; }
    return v.toFixed(v < 100 ? 2 : 1).replace(/\.?0+$/, '') + u[i];
  }
  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayStr(off) {
    var d = new Date(Date.now() + (off || 0) * 864e5);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function midnight() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); }
  function cd(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + 'h ' + pad(m) + 'm' : m + ':' + pad(s % 60);
  }
  function rndHex(n) {
    var a = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  function hashPw(pw, salt) {
    var enc = new TextEncoder();
    if (window.crypto && crypto.subtle) {
      return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']).then(function (k) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 60000, hash: 'SHA-256' }, k, 256);
      }).then(function (bits) {
        return Array.prototype.map.call(new Uint8Array(bits), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
      });
    }
    var h = 5381, s = salt + pw;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Promise.resolve('x' + (h >>> 0).toString(16));
  }

  /* ------------------------------------------------------------------- state */
  function newState() {
    return { bal: 0, total: 0, taps: 0, tapLvl: 0, autoLvl: 0, streak: 0, lastDailyDay: '', lastBox: 0,
      day: '', dayTaps: 0, dayClaimed: false, done: {}, wasKing: false, created: Date.now() };
  }
  var me = null, S = null;
  var dirty = false, board = [], rank = 0, net = true, busy = false;
  var tab = 'earn', lastTapAt = 0, loops = null, lastHtml = {};

  /* ----------------------------------------------------------------- storage */
  function lu() { return LS.get('cb_users', {}); }
  var Net = {
    get: function (p) { return fetch(DB + '/' + p + '.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }); },
    patch: function (o) { return fetch(DB + '/.json', { method: 'PATCH', body: JSON.stringify(o) }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); }); }
  };

  function register(name, pw) {
    var key = name.toLowerCase(), salt = rndHex(16), c = Date.now();
    return hashPw(pw, salt).then(function (h) {
      var st = newState(); st.created = c;
      if (ONLINE) {
        return Net.get('users/' + key + '/h').then(function (ex) {
          if (ex) throw new Error('That username is taken.');
          var o = {}; o['users/' + key] = { n: name, salt: salt, h: h, c: c, data: st }; o['board/' + key] = { n: name, s: 0, c: c, t: c };
          return Net.patch(o);
        }).then(function () { return { me: { key: key, name: name, created: c }, state: st }; });
      }
      var u = lu();
      if (u[key]) throw new Error('That username is taken on this device.');
      u[key] = { n: name, salt: salt, h: h, c: c, data: st }; LS.set('cb_users', u);
      return { me: { key: key, name: name, created: c }, state: st };
    });
  }
  function login(name, pw) {
    var key = name.toLowerCase();
    return Promise.resolve(ONLINE ? Net.get('users/' + key) : lu()[key]).then(function (rec) {
      if (!rec || !rec.h) throw new Error('No account with that name.');
      return hashPw(pw, rec.salt).then(function (h) {
        if (h !== rec.h) throw new Error('Wrong password.');
        var st = Object.assign(newState(), rec.data || {});
        var cached = LS.get('cb_state_' + key, null);
        if (cached && cached.total > st.total) st = Object.assign(newState(), cached);
        return { me: { key: key, name: rec.n || name, created: rec.c || Date.now() }, state: st };
      });
    });
  }
  function saveLocal() {
    if (!me) return;
    LS.set('cb_state_' + me.key, S);
    if (!ONLINE) { var u = lu(); if (u[me.key]) { u[me.key].data = S; LS.set('cb_users', u); } }
  }
  function localBoard() {
    var u = lu();
    return Object.keys(u).map(function (k) { return { k: k, n: u[k].n, s: (u[k].data && u[k].data.total) || 0, c: u[k].c || 0 }; });
  }
  function toList(obj) {
    return Object.keys(obj || {}).map(function (k) {
      var v = obj[k] || {};
      return { k: k, n: String(v.n || k).slice(0, 14), s: Math.max(0, Number(v.s) || 0), c: Number(v.c) || 0 };
    });
  }

  /* -------------------------------------------------------------------- UI bits */
  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    var box = $('#toasts');
    while (box.children.length > 3) box.removeChild(box.firstChild);
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }
  function show(id) { $('#auth').classList.toggle('hidden', id !== 'auth'); $('#game').classList.toggle('hidden', id !== 'game'); }
  function setHtml(id, html) { if (lastHtml[id] !== html) { lastHtml[id] = html; $(id).innerHTML = html; } }

  function toggleFS() {
    var d = document, el = d.documentElement;
    var inFS = d.fullscreenElement || d.webkitFullscreenElement;
    try {
      if (inFS) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
      else {
        var rq = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!rq) { toast('Fullscreen isn’t supported here. On iPhone: Share → Add to Home Screen.'); return; }
        var p = rq.call(el); if (p && p.catch) p.catch(function () { toast('Fullscreen was blocked by the browser.'); });
      }
    } catch (e) { toast('Fullscreen was blocked by the browser.'); }
  }
  function fsIcon() {
    var on = document.fullscreenElement || document.webkitFullscreenElement;
    $$('.fs-btn use').forEach(function (u) { u.setAttribute('href', on ? '#i-minimize' : '#i-maximize'); });
  }

  /* --------------------------------------------------------------------- game */
  function perTap() { return 1 + S.tapLvl; }
  function perSec() { return S.autoLvl; }
  function cost(k) { return k === 'tap' ? Math.round(40 * Math.pow(1.55, S.tapLvl)) : Math.round(120 * Math.pow(1.6, S.autoLvl)); }
  function add(n) { S.bal += n; S.total += n; dirty = true; }
  function rollDay() { var d = dayStr(); if (S.day !== d) { S.day = d; S.dayTaps = 0; S.dayClaimed = false; dirty = true; } }
  function effStreak() { return (S.lastDailyDay === dayStr() || S.lastDailyDay === dayStr(-1)) ? S.streak : 0; }

  function spawn(x, y, g) {
    var zone = $('#tapzone'), r = zone.getBoundingClientRect(), fx = $('#fx');
    if (fx.children.length > 14) fx.removeChild(fx.firstChild);
    var s = document.createElement('span');
    s.textContent = '+' + fmt(g);
    s.style.left = (x - r.left + rint(-18, 18)) + 'px';
    s.style.top = (y - r.top - 10) + 'px';
    fx.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 900);
  }
  function tap(x, y) {
    if (!S) return;
    var now = performance.now();
    if (now - lastTapAt < 70) return;          // max ~14 taps/sec
    lastTapAt = now;
    rollDay();
    var g = perTap(); S.taps++; S.dayTaps++; add(g);
    spawn(x, y, g);
    if (navigator.vibrate) navigator.vibrate(8);
    hud();
  }

  /* ----- tasks ----- */
  var ACH = [
    { id: 'tap10',   ic: 'hand',  title: 'First steps',     desc: 'Tap 10 times',                goal: 10,    reward: 25,   val: function () { return S.taps; } },
    { id: 'tap500',  ic: 'hand',  title: 'Warming up',      desc: 'Tap 500 times',               goal: 500,   reward: 250,  val: function () { return S.taps; } },
    { id: 'tap5k',   ic: 'zap',   title: 'Finger of steel', desc: 'Tap 5,000 times',             goal: 5000,  reward: 1500, val: function () { return S.taps; } },
    { id: 'earn1k',  ic: 'trend', title: 'Pocket money',    desc: 'Earn 1,000 Cashy in total',   goal: 1000,  reward: 200,  val: function () { return S.total; } },
    { id: 'earn25k', ic: 'trend', title: 'Big spender',     desc: 'Earn 25,000 Cashy in total',  goal: 25000, reward: 3000, val: function () { return S.total; } },
    { id: 'upg1',    ic: 'up',    title: 'Level up',        desc: 'Buy your first upgrade',      goal: 1,     reward: 100,  val: function () { return S.tapLvl + S.autoLvl; } },
    { id: 'str7',    ic: 'flame', title: 'On fire',         desc: 'Reach a 7-day streak',        goal: 7,     reward: 1000, val: function () { return effStreak(); } },
    { id: 'top10',   ic: 'medal', title: 'Top 10',          desc: 'Reach the top 10 (needs 2+ players)', goal: 1, reward: 500, val: function () { return (rank > 0 && rank <= 10 && board.length >= 2) ? 1 : 0; } },
    { id: 'king',    ic: 'crown', title: 'Take the crown',  desc: 'Be #1 with 100+ Cashy (needs 2+ players)', goal: 1, reward: 2500, val: function () { return (rank === 1 && board.length >= 2 && S.total >= 100) ? 1 : 0; } }
  ];
  function taskList() {
    var now = Date.now(), today = dayStr(), claimed = S.lastDailyDay === today, eff = effStreak();
    var nextStreak = claimed ? eff : (S.lastDailyDay === dayStr(-1) ? S.streak + 1 : 1);
    var dReward = 100 + 50 * (Math.min(nextStreak, 7) - 1);
    var daily = [];
    daily.push({ id: 'daily', ic: 'gift', title: 'Daily check-in', desc: 'Streak: day ' + (claimed ? eff : nextStreak) + ' · grows every day up to day 7',
      reward: dReward, st: claimed ? 'wait' : 'ready', until: claimed ? midnight() : 0 });
    var boxReady = now - S.lastBox >= BOX_CD;
    daily.push({ id: 'box', ic: 'box', title: 'Lucky box', desc: 'Random 25–500 Cashy · every 2 hours',
      reward: 0, st: boxReady ? 'ready' : 'wait', until: boxReady ? 0 : S.lastBox + BOX_CD });
    var dt = Math.min(S.dayTaps, DAILY_TAP_GOAL);
    daily.push({ id: 'dtap', ic: 'zap', title: 'Daily tap goal', desc: 'Tap ' + DAILY_TAP_GOAL + ' times today',
      reward: 200, goal: DAILY_TAP_GOAL, prog: dt, st: S.dayClaimed ? 'wait' : (dt >= DAILY_TAP_GOAL ? 'ready' : 'prog'), until: S.dayClaimed ? midnight() : 0 });
    var ach = ACH.map(function (a) {
      var v = Math.min(a.val(), a.goal);
      return { id: a.id, ic: a.ic, title: a.title, desc: a.desc, reward: a.reward, goal: a.goal, prog: v,
        st: S.done[a.id] ? 'done' : (v >= a.goal ? 'ready' : 'prog') };
    });
    return { daily: daily, ach: ach };
  }
  function claim(id) {
    if (!S) return;
    rollDay();
    var now = Date.now(), r = 0;
    if (id === 'daily') {
      var today = dayStr(); if (S.lastDailyDay === today) return;
      S.streak = (S.lastDailyDay === dayStr(-1)) ? S.streak + 1 : 1;
      S.lastDailyDay = today; r = 100 + 50 * (Math.min(S.streak, 7) - 1);
    } else if (id === 'box') {
      if (now - S.lastBox < BOX_CD) return;
      var x = Math.random(); r = x < 0.6 ? rint(25, 75) : (x < 0.9 ? rint(80, 200) : rint(250, 500));
      S.lastBox = now;
    } else if (id === 'dtap') {
      if (S.dayClaimed || S.dayTaps < DAILY_TAP_GOAL) return;
      S.dayClaimed = true; r = 200;
    } else {
      var a = ACH.filter(function (q) { return q.id === id; })[0];
      if (!a || S.done[id] || a.val() < a.goal) return;
      S.done[id] = 1; r = a.reward;
    }
    if (r) { add(r); toast('+' + fmt(r) + ' Cashy', 'gain'); }
    hud(); renderVisible(true);
  }
  function buy(k) {
    if (!S) return;
    var c = cost(k);
    if (S.bal < c) { toast('Not enough Cashy', 'warn'); return; }
    S.bal -= c; if (k === 'tap') S.tapLvl++; else S.autoLvl++;
    dirty = true; hud(); renderVisible(true);
    toast(k === 'tap' ? 'Tap Power upgraded!' : 'Auto Earner upgraded!', 'gain');
  }

  /* ---------------------------------------------------------------- rendering */
  function tierHtml() {
    if (!rank) return '';
    if (rank === 1) return '<span class="tier king">' + icon('crown') + 'King Tier</span>';
    return '<span class="tier nine">NineTNine Tier <b>#' + rank + '</b></span>';
  }
  function goalHtml() {
    if (!rank || !board.length) return '';
    if (board.length === 1) return icon('crown') + '<span>You’re the only player so far. Share the link and get friends to challenge you!</span>';
    if (rank === 1) return icon('crown') + '<span>You’re <b>King</b>! Your lead over ' + esc(board[1].n) + ': <b>' + fmt(S.total - board[1].s) + '</b></span>';
    var t = board[rank - 2];
    return icon('flame') + '<span>Earn <b>' + fmt(t.s - S.total + 1) + '</b> more to pass <b>' + esc(t.n) + '</b> (#' + (rank - 1) + ')</span>';
  }
  function hud() {
    if (!S) return;
    $('#bal').textContent = fmt(S.bal);
    $('#perTap').textContent = fmt(perTap());
    $('#perSec').textContent = fmt(perSec());
    setHtml('#tierChip', tierHtml());
    setHtml('#goal', goalHtml());
    var t = taskList(), any = t.daily.concat(t.ach).some(function (x) { return x.st === 'ready'; });
    $('#taskDot').classList.toggle('hidden', !any);
  }
  function taskRow(t) {
    var label;
    if (t.st === 'ready') label = t.reward ? '+' + fmt(t.reward) : 'Open';
    else if (t.st === 'wait') label = '<span class="cd" data-until="' + t.until + '">' + cd(t.until - Date.now()) + '</span>';
    else if (t.st === 'done') label = icon('check');
    else label = fmt(t.prog) + '/' + fmt(t.goal);
    var bar = (t.goal && t.goal > 1 && t.st !== 'done') ? '<div class="bar"><i style="width:' + Math.round(100 * t.prog / t.goal) + '%"></i></div>' : '';
    var rw = (t.reward && t.st !== 'done' && t.st !== 'ready') ? ' · reward ' + fmt(t.reward) : '';
    return '<div class="task ' + t.st + '"><div class="ti">' + icon(t.ic) + '</div><div class="tb"><b>' + esc(t.title) + '</b><span>' + esc(t.desc) + rw + '</span>' + bar +
      '</div><button class="claim" data-claim="' + t.id + '"' + (t.st === 'ready' ? '' : ' disabled') + '>' + label + '</button></div>';
  }
  function renderTasks() {
    var t = taskList();
    setHtml('#tasksBox', '<h2>Daily things</h2>' + t.daily.map(taskRow).join('') + '<h2>Achievements</h2>' + t.ach.map(taskRow).join(''));
  }
  function renderShop() {
    function card(k, ic, title, lvl, eff) {
      var c = cost(k), can = S.bal >= c;
      return '<div class="shopcard"><div class="ti">' + icon(ic) + '</div><div class="tb"><span class="lvl">LEVEL ' + lvl + '</span><b>' + title + '</b><span>' + eff + '</span></div>' +
        '<button class="buy ' + (can ? 'can' : '') + '" data-buy="' + k + '">Upgrade<small><svg class="coinsvg"><use href="#i-coin"/></svg>' + fmt(c) + '</small></button></div>';
    }
    setHtml('#shopBox', '<h2>Upgrades</h2>' +
      card('tap', 'hand', 'Tap Power', S.tapLvl, '+1 Cashy per tap · now ' + fmt(perTap()) + '/tap') +
      card('auto', 'zap', 'Auto Earner', S.autoLvl, '+1 Cashy every second · now ' + fmt(perSec()) + '/sec') +
      '<div class="empty">Your rank counts everything you’ve <b>earned</b>, so spending on upgrades never drops you down the leaderboard.</div>');
  }
  function row(e, i, isMe) {
    var r = i + 1, king = r === 1;
    var rk = r === 1 ? icon('crown') : (r <= 3 ? icon('medal') : r);
    return '<div class="row ' + (isMe ? 'me ' : '') + (r <= 3 ? 'r' + r : '') + '"><div class="rk">' + rk + '</div>' +
      '<div class="av" style="--h:' + hue(e.n) + '">' + esc(e.n.charAt(0).toUpperCase()) + '</div>' +
      '<div class="nm"><b>' + esc(e.n) + (isMe ? ' (you)' : '') + '</b><span class="tr ' + (king ? 'king' : 'nine') + '">' + (king ? 'King Tier' : 'NineTNine Tier #' + r) + '</span></div>' +
      '<div class="sc">' + fmt(e.s) + '</div></div>';
  }
  function renderBoard() {
    var live = ONLINE ? (net ? '<span class="live ok"><i></i>Live · 2s</span>' : '<span class="live off"><i></i>Offline</span>') : '<span class="live"><i></i>This device only</span>';
    var html = '<div class="bhead"><h3>Leaderboard</h3>' + live + '</div>';
    board.slice(0, MAX_BOARD).forEach(function (e, i) { html += row(e, i, e.k === me.key); });
    if (rank > MAX_BOARD) html += '<div class="gap">• • •</div>' + row(board[rank - 1], rank - 1, true);
    if (board.length < 2) html += '<div class="empty">' + (ONLINE ? 'Be the first to set the bar — invite friends!' : 'Only accounts created on this device appear here. Connect Firebase (README) for a worldwide leaderboard.') + '</div>';
    setHtml('#boardBox', html);
  }
  function renderMe() {
    function st(l, v) { return '<div class="stat"><small>' + l + '</small><b>' + v + '</b></div>'; }
    setHtml('#meBox',
      '<div class="me-head"><div class="av" style="--h:' + hue(me.name) + '">' + esc(me.name.charAt(0).toUpperCase()) + '</div><h3>' + esc(me.name) + '</h3>' + tierHtml() + '</div>' +
      '<div class="stats">' + st('Rank', rank ? '#' + rank : '—') + st('Total earned', fmt(S.total)) + st('Balance', fmt(S.bal)) + st('Taps', fmt(S.taps)) +
      st('Streak', effStreak() + ' days') + st('Per tap / sec', fmt(perTap()) + ' / ' + fmt(perSec())) + '</div>' +
      '<div class="btnrow"><button class="btn ghost" data-act="share">' + icon('share') + 'Invite friends</button>' +
      '<button class="btn danger" data-act="logout">' + icon('logout') + 'Log out</button></div>' +
      '<div class="empty">Mode: <b>' + (ONLINE ? 'Online (shared leaderboard)' : 'Local (this device)') + '</b><br>Cashy Beater by <b class="gold">Dadasaves</b></div>');
  }
  function renderVisible(force) {
    if (!me) return;
    if (force) lastHtml = Object.assign({}, lastHtml);
    if (tab === 'tasks') renderTasks();
    else if (tab === 'shop') renderShop();
    else if (tab === 'board') renderBoard();
    else if (tab === 'me') renderMe();
  }
  function setTab(t) {
    tab = t;
    $$('.tab').forEach(function (el) { el.classList.toggle('on', el.id === 'tab-' + t); });
    $$('.nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    $('#main').scrollTop = 0;
    renderVisible();
  }

  /* --------------------------------------------------------------- sync loops */
  function computeRank() {
    var mine = { k: me.key, n: me.name, s: S.total, c: me.created };
    var l = board.filter(function (e) { return e.k !== me.key; });
    l.push(mine);
    l.sort(function (a, b) { return b.s - a.s || a.c - b.c || (a.k < b.k ? -1 : 1); });
    board = l; rank = l.findIndex(function (e) { return e.k === me.key; }) + 1;
    if (rank === 1 && !S.wasKing) {
      S.wasKing = true; dirty = true;
      if (board.length > 1 && S.total > 0) toast('👑 You are the KING!', 'king');
    } else if (rank > 1 && S.wasKing) {
      S.wasKing = false; dirty = true;
      toast(board[0].n + ' took the throne. You’re NineTNine Tier #' + rank + ' now.', 'warn');
    }
  }
  function sync() {
    if (!me || busy) return Promise.resolve();
    busy = true;
    var job;
    if (ONLINE) {
      var push = Promise.resolve();
      if (dirty) {
        dirty = false; saveLocal();
        var o = {}, now = Date.now();
        o['users/' + me.key + '/data'] = S;
        o['board/' + me.key] = { n: me.name, s: S.total, c: me.created, t: now };
        push = Net.patch(o).catch(function (e) { dirty = true; throw e; });
      }
      job = push.then(function () { return Net.get('board'); }).then(function (obj) { board = toList(obj); net = true; });
    } else {
      if (dirty) { dirty = false; saveLocal(); }
      board = localBoard(); net = true; job = Promise.resolve();
    }
    return job.catch(function () { net = false; }).then(function () {
      busy = false;
      if (!me) return;
      computeRank(); hud();
      if (tab === 'board' || tab === 'me') renderVisible();
    });
  }
  function tick() {
    if (!me) return;
    rollDay();
    if (S.autoLvl > 0) { add(S.autoLvl); }
    $('#bal').textContent = fmt(S.bal);
    var expired = false, now = Date.now();
    $$('.cd').forEach(function (el) {
      var u = Number(el.getAttribute('data-until'));
      if (u <= now) expired = true; else el.textContent = cd(u - now);
    });
    if (tab === 'tasks' || tab === 'shop') renderVisible();
    if (expired || tab === 'earn') hud();
    if (dirty) saveLocal();
  }
  function startLoops() {
    if (loops) return;
    loops = [setInterval(tick, 1000), setInterval(sync, SYNC_MS)];
  }
  function stopLoops() { if (loops) loops.forEach(clearInterval); loops = null; }

  /* -------------------------------------------------------------- session */
  function enter(m, st) {
    me = m; S = Object.assign(newState(), st);
    LS.set('cb_session', m);
    lastHtml = {}; board = []; rank = 0; net = true;
    rollDay(); show('game'); setTab('earn'); hud(); startLoops(); sync();
    if (ONLINE) {
      Net.get('users/' + m.key + '/data').then(function (r) {
        if (me && me.key === m.key && r && Number(r.total) > S.total) { S = Object.assign(newState(), r); hud(); renderVisible(); }
      }).catch(function () {});
    }
  }
  function logout() {
    saveLocal();
    var p = (ONLINE && dirty) ? sync() : Promise.resolve();
    p.then(function () {
      stopLoops(); LS.del('cb_session'); me = null; S = null; lastHtml = {};
      $('#fPass').value = ''; show('auth');
    });
  }

  /* --------------------------------------------------------------- auth UI */
  var authMode = 'login';
  function setAuthMode(m) {
    authMode = m;
    $$('[data-auth]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-auth') === m); });
    $('#authBtn').textContent = m === 'login' ? 'Login' : 'Create account';
    $('#fPass').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    $('#authErr').textContent = '';
  }
  function submitAuth(e) {
    e.preventDefault();
    var name = $('#fUser').value.trim(), pw = $('#fPass').value, err = $('#authErr'), btn = $('#authBtn');
    err.textContent = '';
    if (!/^[A-Za-z0-9_]{3,14}$/.test(name)) { err.textContent = 'Username: 3–14 letters, numbers or _.'; return; }
    if (pw.length < 4) { err.textContent = 'Password must be at least 4 characters.'; return; }
    btn.disabled = true;
    var old = btn.textContent; btn.textContent = 'Please wait…';
    (authMode === 'login' ? login(name, pw) : register(name, pw)).then(function (r) {
      enter(r.me, r.state);
    }).catch(function (ex) {
      var m = ex && ex.message || '';
      err.textContent = /^http|fetch|network|failed/i.test(m) ? 'Can’t reach the server. Check your connection and try again.' : (m || 'Something went wrong.');
    }).then(function () { btn.disabled = false; btn.textContent = old; });
  }
  function share() {
    var url = location.href.split('#')[0], text = 'Beat me on the Cashy Beater leaderboard and take the King Tier!';
    if (navigator.share) navigator.share({ title: 'Cashy Beater', text: text, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Link copied!', 'gain'); }, function () { toast(url); });
    else toast(url);
  }

  /* ----------------------------------------------------------------- events */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-act],[data-tab],[data-claim],[data-buy],[data-auth]');
    if (!t) return;
    if (t.hasAttribute('data-auth')) setAuthMode(t.getAttribute('data-auth'));
    else if (t.hasAttribute('data-tab')) setTab(t.getAttribute('data-tab'));
    else if (t.hasAttribute('data-claim')) claim(t.getAttribute('data-claim'));
    else if (t.hasAttribute('data-buy')) buy(t.getAttribute('data-buy'));
    else {
      var a = t.getAttribute('data-act');
      if (a === 'fs') toggleFS(); else if (a === 'logout') logout(); else if (a === 'share') share();
    }
  });
  document.addEventListener('fullscreenchange', fsIcon);
  document.addEventListener('webkitfullscreenchange', fsIcon);
  document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('#game')) e.preventDefault(); });
  window.addEventListener('pagehide', function () { saveLocal(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me) sync(); });
  $('#authForm').addEventListener('submit', submitAuth);

  var coin = $('#coinBtn');
  coin.addEventListener('pointerdown', function (e) { e.preventDefault(); coin.classList.add('press'); tap(e.clientX, e.clientY); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { coin.addEventListener(n, function () { coin.classList.remove('press'); }); });
  coin.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); var r = coin.getBoundingClientRect(); tap(r.left + r.width / 2, r.top + r.height / 2); }
  });

  /* -------------------------------------------------------------------- boot */
  $('#modeNote').textContent = ONLINE
    ? 'Online mode: your account and score are saved to the shared leaderboard.'
    : 'Local mode: accounts and the leaderboard live on this device only. Site owner: see README to enable the worldwide leaderboard.';
  var ses = LS.get('cb_session', null);
  if (ses && ses.key) {
    var st0 = LS.get('cb_state_' + ses.key, null);
    if (!st0 && !ONLINE) { var rec = lu()[ses.key]; if (rec) st0 = rec.data; }
    if (st0) enter(ses, st0); else show('auth');
  } else show('auth');
})();
