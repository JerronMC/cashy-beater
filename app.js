/* Cashy Beater 2.0.0 — update by DataRonn
   Existing account and progress records are migrated additively; no automatic wipe is performed. */
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
  var HASH_ITERATIONS = 210000;
  var MAX_BOOST_LEVEL = 10;
  var MAX_LUCKY_LEVEL = 10;

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
  function hashPw(pw, salt, iterations) {
    var enc = new TextEncoder();
    iterations = Math.max(60000, Number(iterations) || HASH_ITERATIONS);
    if (!window.crypto || !crypto.subtle) {
      return Promise.reject(new Error('Secure password support is unavailable. Open the game using its HTTPS website.'));
    }
    return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: iterations, hash: 'SHA-256' }, k, 256);
    }).then(function (bits) {
      return Array.prototype.map.call(new Uint8Array(bits), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    });
  }
  function legacyHashPw(pw, salt) {
    var h = 5381, v = salt + pw;
    for (var i = 0; i < v.length; i++) h = ((h << 5) + h + v.charCodeAt(i)) | 0;
    return Promise.resolve('x' + (h >>> 0).toString(16));
  }
  function currentSettings() {
    var v = LS.get('cb_settings', {});
    return { sfx: v.sfx !== false, vfx: v.vfx !== false };
  }
  var prefs = currentSettings();
  function applyPrefs() { var z = document.querySelector('#tapzone'); if (z) z.classList.toggle('no-vfx', !prefs.vfx); }
  var audioContext = null, lastSfxAt = 0;
  function playSfx(kind) {
    if (!prefs.sfx || !window.AudioContext && !window.webkitAudioContext) return;
    var now = Date.now();
    if (kind === 'tap' && now - lastSfxAt < 55) return;
    lastSfxAt = now;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioContext = audioContext || new AC();
      if (audioContext.state === 'suspended') audioContext.resume();
      var osc = audioContext.createOscillator(), gain = audioContext.createGain();
      var tones = { tap: 560, claim: 760, buy: 420, toggle: 620, alert: 230 };
      osc.type = 'sine'; osc.frequency.value = tones[kind] || 500;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.055, audioContext.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + (kind === 'tap' ? 0.045 : 0.11));
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + (kind === 'tap' ? 0.05 : 0.12));
    } catch (e) {}
  }
  function isJerron() { return !!me && me.key === 'jerron'; }
  function canUseLocalOwnerTools() { return isJerron() && !ONLINE; }
  function getLocalBans() { return LS.get('cb_bans', {}); }
  function saveLocalBans(v) { LS.set('cb_bans', v); }


  /* ------------------------------------------------------------------- state */
  function newState() {
    return { bal: 0, total: 0, taps: 0, tapLvl: 0, autoLvl: 0, boostLvl: 0, luckyLvl: 0, streak: 0, lastDailyDay: '', lastBox: 0,
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
    return hashPw(pw, salt, HASH_ITERATIONS).then(function (h) {
      var st = newState(); st.created = c;
      if (ONLINE) {
        return Net.get('users/' + key + '/h').then(function (ex) {
          if (ex) throw new Error('That username is taken.');
          var o = {}; o['users/' + key] = { n: name, salt: salt, h: h, it: HASH_ITERATIONS, c: c, data: st }; o['board/' + key] = { n: name, s: 0, c: c, t: c };
          return Net.patch(o);
        }).then(function () { return { me: { key: key, name: name, created: c }, state: st }; });
      }
      var u = lu();
      if (u[key]) throw new Error('That username is taken on this device.');
      u[key] = { n: name, salt: salt, h: h, it: HASH_ITERATIONS, c: c, data: st }; LS.set('cb_users', u);
      return { me: { key: key, name: name, created: c }, state: st };
    });
  }
  function login(name, pw) {
    var key = name.toLowerCase();
    var lock = LS.get('cb_login_' + key, { fails: 0, until: 0 });
    if (lock.until > Date.now()) return Promise.reject(new Error('Too many attempts. Try again in ' + Math.ceil((lock.until - Date.now()) / 1000) + ' seconds.'));
    return Promise.resolve(ONLINE ? Net.get('users/' + key) : lu()[key]).then(function (rec) {
      if (!rec || !rec.h) throw new Error('No account with that name.');
      if (!ONLINE) {
        var ban = getLocalBans()[key];
        if (ban && (!ban.until || ban.until > Date.now())) {
          throw new Error('This account is banned' + (ban.until ? ' until ' + new Date(ban.until).toLocaleString() : '') + (ban.reason ? '. Reason: ' + ban.reason : '.') );
        }
        if (ban && ban.until && ban.until <= Date.now()) { var bans = getLocalBans(); delete bans[key]; saveLocalBans(bans); }
      }
      var oldLegacy = String(rec.h).charAt(0) === 'x';
      var verify = oldLegacy ? legacyHashPw(pw, rec.salt) : hashPw(pw, rec.salt, Number(rec.it) || 60000);
      return verify.then(function (h) {
        if (h !== rec.h) throw new Error('Wrong password.');
        LS.del('cb_login_' + key);
        var st = Object.assign(newState(), rec.data || {});
        var cached = LS.get('cb_state_' + key, null);
        if (cached && cached.total > st.total) st = Object.assign(newState(), cached);
        var m = { key: key, name: rec.n || name, created: rec.c || Date.now() };
        // Upgrade old local password hashes after a successful login; account data is left intact.
        if (!ONLINE && (oldLegacy || (Number(rec.it) || 60000) < HASH_ITERATIONS)) {
          var freshSalt = rndHex(16);
          return hashPw(pw, freshSalt, HASH_ITERATIONS).then(function (freshHash) {
            var users = lu();
            if (users[key]) { users[key].salt = freshSalt; users[key].h = freshHash; users[key].it = HASH_ITERATIONS; LS.set('cb_users', users); }
            return { me: m, state: st };
          });
        }
        return { me: m, state: st };
      });
    }).catch(function (err) {
      if (err && (err.message === 'Wrong password.' || err.message === 'No account with that name.')) {
        var a = LS.get('cb_login_' + key, { fails: 0, until: 0 });
        a.fails = (a.fails || 0) + 1;
        if (a.fails >= 6) { a.fails = 0; a.until = Date.now() + 60000; }
        LS.set('cb_login_' + key, a);
      }
      throw err;
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
  function perTap() { return Math.max(1, Math.round((1 + S.tapLvl) * (1 + 0.25 * (S.boostLvl || 0)) * 100) / 100); }
  function rateFmt(n) { return Number.isInteger(n) ? fmt(n) : Number(n).toFixed(2); }
  function perSec() { return S.autoLvl; }
  function cost(k) {
    if (k === 'tap') return Math.round(40 * Math.pow(1.55, S.tapLvl));
    if (k === 'auto') return Math.round(120 * Math.pow(1.6, S.autoLvl));
    if (k === 'boost') return Math.round(500 * Math.pow(1.85, S.boostLvl || 0));
    if (k === 'lucky') return Math.round(300 * Math.pow(1.75, S.luckyLvl || 0));
    return 0;
  }
  function add(n) { S.bal += n; S.total += n; dirty = true; }
  function rollDay() { var d = dayStr(); if (S.day !== d) { S.day = d; S.dayTaps = 0; S.dayClaimed = false; dirty = true; } }
  function effStreak() { return (S.lastDailyDay === dayStr() || S.lastDailyDay === dayStr(-1)) ? S.streak : 0; }

  function spawn(x, y, g) {
    var zone = $('#tapzone'), r = zone.getBoundingClientRect(), fx = $('#fx');
    if (fx.children.length > 14) fx.removeChild(fx.firstChild);
    var s = document.createElement('span');
    s.textContent = '+' + rateFmt(g);
    s.style.left = (x - r.left + rint(-18, 18)) + 'px';
    s.style.top = (y - r.top - 10) + 'px';
    fx.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 900);
  }
  function tap(x, y) {
    if (!S) return;
    var now = performance.now();
    if (now - lastTapAt < 24) return;          // responsive tap guard; roughly 40 taps/sec
    lastTapAt = now;
    rollDay();
    var g = perTap(); S.taps++; S.dayTaps++; add(g);
    if (prefs.vfx) spawn(x, y, g);
    playSfx('tap');
    if (navigator.vibrate && prefs.vfx) navigator.vibrate(8);
    hud();
  }

  /* ----- tasks ----- */
  var ACH = [
    { id: 'tap10',   ic: 'hand',  title: 'First steps',     desc: 'Tap 10 times',                goal: 10,    reward: 25,   val: function () { return S.taps; } },
    { id: 'tap500',  ic: 'hand',  title: 'Warming up',      desc: 'Tap 500 times',               goal: 500,   reward: 250,  val: function () { return S.taps; } },
    { id: 'tap5k',   ic: 'zap',   title: 'Finger of steel', desc: 'Tap 5,000 times',             goal: 5000,  reward: 1500, val: function () { return S.taps; } },
    { id: 'earn1k',  ic: 'trend', title: 'Pocket money',    desc: 'Earn 1,000 Cashy in total',   goal: 1000,  reward: 200,  val: function () { return S.total; } },
    { id: 'earn25k', ic: 'trend', title: 'Big spender',     desc: 'Earn 25,000 Cashy in total',  goal: 25000, reward: 3000, val: function () { return S.total; } },
    { id: 'upg1',    ic: 'up',    title: 'Level up',        desc: 'Buy your first upgrade',      goal: 1,     reward: 100,  val: function () { return S.tapLvl + S.autoLvl + (S.boostLvl || 0) + (S.luckyLvl || 0); } },
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
      r = Math.floor(r * (1 + 0.15 * (S.luckyLvl || 0)));
      S.lastBox = now;
    } else if (id === 'dtap') {
      if (S.dayClaimed || S.dayTaps < DAILY_TAP_GOAL) return;
      S.dayClaimed = true; r = 200;
    } else {
      var a = ACH.filter(function (q) { return q.id === id; })[0];
      if (!a || S.done[id] || a.val() < a.goal) return;
      S.done[id] = 1; r = a.reward;
    }
    if (r) { add(r); toast('+' + fmt(r) + ' Cashy', 'gain'); playSfx('claim'); }
    hud(); renderVisible(true);
  }
  function buy(k) {
    if (!S || ['tap', 'auto', 'boost', 'lucky'].indexOf(k) < 0) return;
    var level = k === 'tap' ? S.tapLvl : (k === 'auto' ? S.autoLvl : (k === 'boost' ? (S.boostLvl || 0) : (S.luckyLvl || 0)));
    var max = k === 'boost' ? MAX_BOOST_LEVEL : (k === 'lucky' ? MAX_LUCKY_LEVEL : 500);
    if (level >= max) { toast('This upgrade is already maxed.', 'warn'); return; }
    var c = cost(k);
    if (S.bal < c) { toast('Not enough Cashy', 'warn'); playSfx('alert'); return; }
    S.bal -= c;
    if (k === 'tap') S.tapLvl++;
    else if (k === 'auto') S.autoLvl++;
    else if (k === 'boost') S.boostLvl = (S.boostLvl || 0) + 1;
    else S.luckyLvl = (S.luckyLvl || 0) + 1;
    dirty = true; hud(); renderVisible(true); playSfx('buy');
    toast(k === 'tap' ? 'Tap Power upgraded!' : k === 'auto' ? 'Auto Earner upgraded!' : k === 'boost' ? 'Cashy Multiplier upgraded!' : 'Lucky Aura upgraded!', 'gain');
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
    $('#perTap').textContent = rateFmt(perTap());
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
    function card(k, ic, title, lvl, eff, max) {
      var c = cost(k), can = S.bal >= c, capped = lvl >= max;
      return '<div class="shopcard"><div class="ti">' + icon(ic) + '</div><div class="tb"><span class="lvl">LEVEL ' + lvl + (capped ? ' · MAX' : '') + '</span><b>' + title + '</b><span>' + eff + '</span></div>' +
        '<button class="buy ' + (can && !capped ? 'can' : '') + '" data-buy="' + k + '"' + (capped ? ' disabled' : '') + '>' + (capped ? 'MAX' : 'Upgrade') + (capped ? '' : '<small><svg class="coinsvg"><use href="#i-coin"/></svg>' + fmt(c) + '</small>') + '</button></div>';
    }
    setHtml('#shopBox', '<h2>Upgrades</h2>' +
      card('tap', 'hand', 'Tap Power', S.tapLvl, '+1 Cashy per tap · now ' + rateFmt(perTap()) + '/tap', 500) +
      card('auto', 'zap', 'Auto Earner', S.autoLvl, '+1 Cashy every second · now ' + fmt(perSec()) + '/sec', 500) +
      card('boost', 'trend', 'Cashy Multiplier', S.boostLvl || 0, 'Adds 25% tap power per level · now ' + (1 + 0.25 * (S.boostLvl || 0)).toFixed(2) + '×', MAX_BOOST_LEVEL) +
      card('lucky', 'gift', 'Lucky Aura', S.luckyLvl || 0, 'Boosts Lucky Box rewards by 15% per level', MAX_LUCKY_LEVEL) +
      '<div class="empty">Your leaderboard rank counts everything you have earned. Spending on upgrades does not lower your rank.</div>');
  }

  function row(e, i, isMe) {
    var r = i + 1, king = r === 1;
    var rk = r === 1 ? icon('crown') : (r <= 3 ? icon('medal') : r);
    var owner = e.k === 'jerron';
    var rankTitle = owner ? '<span class="owner-title">Jerron · Owner</span>' : '<span class="tr ' + (king ? 'king' : 'nine') + '">' + (king ? 'King Tier' : 'NineTNine Tier #' + r) + '</span>';
    return '<div class="row ' + (isMe ? 'me ' : '') + (r <= 3 ? 'r' + r : '') + '"><div class="rk">' + rk + '</div>' +
      '<div class="av" style="--h:' + hue(e.n) + '">' + esc(e.n.charAt(0).toUpperCase()) + '</div>' +
      '<div class="nm"><b>' + esc(e.n) + (isMe ? ' (you)' : '') + '</b>' + rankTitle + '</div>' +
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
    var owner = isJerron(), localAdmin = canUseLocalOwnerTools();
    var title = owner ? '<span class="owner-title">✦ Jerron · Owner</span>' : tierHtml();
    var ownerPanel = '';
    if (owner) {
      ownerPanel = '<section class="panel owner-panel"><div class="panel-head"><h2>Owner Features Panel</h2><span class="owner-pill">OWNER</span></div>' +
        (localAdmin ? '<p class="help good">Local owner tools are enabled on this device. These actions only affect accounts stored in this browser.</p>' : '<p class="help warn">Online admin actions are locked. The current Firebase setup has no authenticated owner role, so enabling these controls would let other players abuse them. Add server-side authorization before using online moderation.</p>') +
        '<form id="adminBanForm" class="settings-form"><b>Ban player</b><label>Username / display name<input name="target" maxlength="32" placeholder="Player username" required ' + (localAdmin ? '' : 'disabled') + '></label><div class="form-grid"><label>Duration<input name="duration" type="number" min="1" max="3650" value="1" required ' + (localAdmin ? '' : 'disabled') + '></label><label>Unit<select name="unit" ' + (localAdmin ? '' : 'disabled') + '><option value="days">Days</option><option value="months">Months</option><option value="years">Years</option></select></label></div><label>Reason<input name="reason" maxlength="160" placeholder="Reason for ban" required ' + (localAdmin ? '' : 'disabled') + '></label><button class="btn danger" type="submit" ' + (localAdmin ? '' : 'disabled') + '>Ban player</button></form>' +
        '<form id="adminUnbanForm" class="settings-form"><b>Unban player</b><label>Username<input name="target" maxlength="32" placeholder="Player username" required ' + (localAdmin ? '' : 'disabled') + '></label><button class="btn ghost" type="submit" ' + (localAdmin ? '' : 'disabled') + '>Unban</button></form>' +
        '<form id="adminCashForm" class="settings-form"><b>Change Cashy</b><label>Username<input name="target" maxlength="32" placeholder="Player username" required ' + (localAdmin ? '' : 'disabled') + '></label><label>New balance<input name="amount" type="number" min="0" max="1000000000000000" step="1" placeholder="Amount" required ' + (localAdmin ? '' : 'disabled') + '></label><button class="btn primary" type="submit" ' + (localAdmin ? '' : 'disabled') + '>Set Cashy balance</button><p class="help">Changes current balance only. Total earned and leaderboard rank are preserved.</p></form>' +
        '<div class="settings-form"><b>Economy Reset</b><p class="help">Resets balances, progress, taps, streaks and upgrades for all local accounts. Usernames and passwords are kept. A backup is created first.</p><button class="btn danger" data-act="economy-reset" ' + (localAdmin ? '' : 'disabled') + '>Reset local economy</button></div></section>';
    }
    setHtml('#meBox',
      '<div class="me-head"><div class="av" style="--h:' + hue(me.name) + '">' + esc(me.name.charAt(0).toUpperCase()) + '</div><h3>' + esc(me.name) + '</h3>' + title + '</div>' +
      '<div class="stats">' + st('Rank', rank ? '#' + rank : '—') + st('Total earned', fmt(S.total)) + st('Balance', fmt(S.bal)) + st('Taps', fmt(S.taps)) +
      st('Streak', effStreak() + ' days') + st('Per tap / sec', rateFmt(perTap()) + ' / ' + fmt(perSec())) + '</div>' +
      '<section class="panel"><h2>Account Security</h2><p class="help">Change your password by verifying your current password. New passwords must be at least 8 characters.</p>' +
      '<form id="securityForm" class="settings-form"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required ' + (ONLINE ? 'disabled' : '') + '></label><label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required ' + (ONLINE ? 'disabled' : '') + '></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required ' + (ONLINE ? 'disabled' : '') + '></label><button class="btn primary" type="submit" ' + (ONLINE ? 'disabled' : '') + '>Change password</button></form>' +
      (ONLINE ? '<p class="help warn">Password changes and forgotten-password resets need Firebase Authentication or a trusted recovery service. The current online database stores username/password hashes and has no verified email recovery. No account credentials will be modified by this update.</p>' : '<p class="help">Forgot your password? This account has no verified recovery email. Keep your password safe; a forgotten local password cannot be securely recovered.</p>') +
      '<button class="btn ghost" data-act="export-backup">Export account backup</button></section>' +
      '<section class="panel"><h2>Preferences</h2><div class="setting-row"><div><b>Sound effects</b><small>Tap, claim and shop sounds</small></div><button class="toggle ' + (prefs.sfx ? 'on' : '') + '" data-act="toggle-sfx" aria-pressed="' + prefs.sfx + '">' + (prefs.sfx ? 'ON' : 'OFF') + '</button></div><div class="setting-row"><div><b>Visual effects</b><small>Floating Cashy and vibration</small></div><button class="toggle ' + (prefs.vfx ? 'on' : '') + '" data-act="toggle-vfx" aria-pressed="' + prefs.vfx + '">' + (prefs.vfx ? 'ON' : 'OFF') + '</button></div></section>' +
      ownerPanel +
      '<div class="btnrow"><button class="btn ghost" data-act="share">' + icon('share') + 'Invite friends</button><button class="btn danger" data-act="logout">' + icon('logout') + 'Log out</button></div>' +
      '<div class="empty">Version 2.0.0 · Update by <b class="gold">DataRonn</b><br>Original project credit: Dadasaves</div>');
  }
  function renderUpdates() {
    setHtml('#updatesBox', '<div class="update-hero"><span class="version-pill">VERSION 2.0.0</span><h3>Cashy Beater Update</h3><p>By <b class="gold">DataRonn</b></p></div>' +
      '<section class="panel"><h2>What’s new</h2><div class="change-item"><b>Account security</b><span>Stronger password hashing for new/local accounts, login attempt cooldown, password change and account backup export.</span></div><div class="change-item"><b>Jerron Owner Title</b><span>Owner badge and Owner Features Panel for the account named Jerron.</span></div><div class="change-item"><b>Owner tools</b><span>Local ban/unban, Cashy balance editing and backed-up economy reset. Online actions remain locked until server-side owner authorization is configured.</span></div><div class="change-item"><b>New shop upgrades</b><span>Cashy Multiplier and Lucky Aura added to Tap Power and Auto Earner.</span></div><div class="change-item"><b>Faster tapping</b><span>Reduced input throttle and improved mobile tap handling.</span></div><div class="change-item"><b>Sound and visual effects</b><span>Toggle sound effects, floating Cashy effects and vibration in Preferences.</span></div><div class="change-item"><b>UI improvements</b><span>Updated profile badges, settings, responsive panels and changelog.</span></div><div class="change-item"><b>Progress protection</b><span>Existing accounts and saved progress are migrated without being wiped. Economy Reset is a separate, owner-only action with an automatic local backup.</span></div></section>');
  }
  function findLocalUser(query) {
    var users = lu(), q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    if (users[q]) return q;
    var found = Object.keys(users).filter(function (k) { return String(users[k].n || '').toLowerCase() === q; });
    return found.length === 1 ? found[0] : null;
  }
  function adminBanSubmit(form) {
    if (!canUseLocalOwnerTools()) return toast('Online moderation is locked until secure server authorization is configured.', 'warn');
    var fd = new FormData(form), target = findLocalUser(fd.get('target'));
    var amount = Math.floor(Number(fd.get('duration'))), unit = String(fd.get('unit')), reason = String(fd.get('reason') || '').trim();
    if (!target) return toast('Player account was not found on this device.', 'warn');
    if (target === me.key) return toast('You cannot ban your own owner account.', 'warn');
    if (!Number.isFinite(amount) || amount < 1 || amount > 3650 || !reason) return toast('Enter a valid duration and reason.', 'warn');
    var until = new Date();
    if (unit === 'months') until.setMonth(until.getMonth() + amount);
    else if (unit === 'years') until.setFullYear(until.getFullYear() + amount);
    else until.setDate(until.getDate() + amount);
    var bans = getLocalBans();
    bans[target] = { until: until.getTime(), reason: reason.slice(0, 160), by: me.name, created: Date.now() };
    saveLocalBans(bans); form.reset(); toast('Banned ' + target + ' until ' + until.toLocaleDateString() + '.', 'gain'); playSfx('alert');
  }
  function adminUnbanSubmit(form) {
    if (!canUseLocalOwnerTools()) return toast('Online moderation is locked until secure server authorization is configured.', 'warn');
    var target = findLocalUser(new FormData(form).get('target'));
    if (!target) return toast('Player account was not found on this device.', 'warn');
    var bans = getLocalBans();
    if (!bans[target]) return toast('That player is not banned.', 'warn');
    delete bans[target]; saveLocalBans(bans); form.reset(); toast('Unbanned ' + target + '.', 'gain'); playSfx('claim');
  }
  function adminCashSubmit(form) {
    if (!canUseLocalOwnerTools()) return toast('Online cash editing is locked until secure server authorization is configured.', 'warn');
    var fd = new FormData(form), target = findLocalUser(fd.get('target')), amount = Number(fd.get('amount'));
    if (!target) return toast('Player account was not found on this device.', 'warn');
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000000000) return toast('Enter a valid Cashy balance.', 'warn');
    var users = lu(), rec = users[target];
    var data = Object.assign(newState(), rec.data || {}); data.bal = Math.floor(amount); rec.data = data; users[target] = rec;
    LS.set('cb_users', users); LS.set('cb_state_' + target, data);
    if (me && me.key === target) { S = Object.assign(newState(), data); dirty = false; hud(); }
    form.reset(); renderMe(); toast('Updated ' + target + ' to ' + fmt(data.bal) + ' Cashy.', 'gain'); playSfx('buy');
  }
  function changePasswordSubmit(form) {
    if (ONLINE) return toast('Online password changes need secure Firebase Authentication setup.', 'warn');
    var fd = new FormData(form), current = String(fd.get('currentPassword') || ''), next = String(fd.get('newPassword') || ''), confirm = String(fd.get('confirmPassword') || '');
    if (next.length < 8 || next.length > 128) return toast('New password must be 8–128 characters.', 'warn');
    if (next !== confirm) return toast('The new passwords do not match.', 'warn');
    var users = lu(), rec = users[me.key];
    if (!rec || !rec.h) return toast('Account record was not found.', 'warn');
    var legacy = String(rec.h).charAt(0) === 'x';
    var check = legacy ? legacyHashPw(current, rec.salt) : hashPw(current, rec.salt, Number(rec.it) || 60000);
    check.then(function (h) {
      if (h !== rec.h) throw new Error('Current password is incorrect.');
      var salt = rndHex(16);
      return hashPw(next, salt, HASH_ITERATIONS).then(function (hash) {
        rec.salt = salt; rec.h = hash; rec.it = HASH_ITERATIONS; users[me.key] = rec; LS.set('cb_users', users);
        form.reset(); toast('Password changed. Your account progress was kept.', 'gain'); playSfx('claim');
      });
    }).catch(function (e) { toast(e.message || 'Could not change password.', 'warn'); });
  }
  function exportBackup() {
    if (!me || !S) return;
    var payload = { app: 'Cashy Beater', version: '2.0.0', exportedAt: new Date().toISOString(), username: me.name, state: S };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'cashy-beater-' + me.key + '-backup.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000); toast('Account backup exported. Keep it somewhere safe.', 'gain');
  }
  function resetLocalEconomy() {
    if (!canUseLocalOwnerTools()) return toast('Online economy reset is locked until secure server authorization is configured.', 'warn');
    if (!window.confirm('Reset the economy for every account saved in this browser? Balances, taps, streaks, tasks and upgrades will reset. Usernames and passwords will stay. A backup will be created first.')) return;
    var users = lu(), stamp = Date.now(), backup = { created: new Date(stamp).toISOString(), users: users, bans: getLocalBans() };
    try { localStorage.setItem('cb_economy_backup_' + stamp, JSON.stringify(backup)); }
    catch (backupError) { toast('Backup could not be saved. Economy reset cancelled.', 'warn'); return; }
    Object.keys(users).forEach(function (key) {
      var rec = users[key] || {}, st = newState(); st.created = rec.c || (rec.data && rec.data.created) || stamp;
      rec.data = st; users[key] = rec; LS.set('cb_state_' + key, st);
    });
    LS.set('cb_users', users);
    if (me && users[me.key]) S = Object.assign(newState(), users[me.key].data);
    dirty = false; board = localBoard(); computeRank(); hud(); renderMe(); toast('Local economy reset. Accounts remain saved; backup created.', 'gain'); playSfx('alert');
  }

  function renderVisible(force) {
    if (!me) return;
    if (force) lastHtml = Object.assign({}, lastHtml);
    if (tab === 'tasks') renderTasks();
    else if (tab === 'shop') renderShop();
    else if (tab === 'board') renderBoard();
    else if (tab === 'updates') renderUpdates();
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
      if (tab === 'board') renderVisible();
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
    if (authMode === 'register' && pw.length < 8) { err.textContent = 'New passwords must be at least 8 characters.'; return; }
    if (authMode === 'login' && pw.length < 4) { err.textContent = 'Password must be at least 4 characters.'; return; }
    if (pw.length > 128) { err.textContent = 'Password is too long (maximum 128 characters).'; return; }
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
      if (a === 'fs') toggleFS();
      else if (a === 'logout') logout();
      else if (a === 'share') share();
      else if (a === 'export-backup') exportBackup();
      else if (a === 'forgot-password') { $('#authErr').textContent = 'Password reset is not configured because accounts have no verified recovery email. Your account and progress have not been changed.'; }
      else if (a === 'toggle-sfx') { prefs.sfx = !prefs.sfx; LS.set('cb_settings', prefs); renderMe(); playSfx('toggle'); }
      else if (a === 'toggle-vfx') { prefs.vfx = !prefs.vfx; LS.set('cb_settings', prefs); applyPrefs(); renderMe(); playSfx('toggle'); }
      else if (a === 'economy-reset') resetLocalEconomy();
    }
  });
  document.addEventListener('fullscreenchange', fsIcon);
  document.addEventListener('webkitfullscreenchange', fsIcon);
  document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('#game')) e.preventDefault(); });
  window.addEventListener('pagehide', function () { saveLocal(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me) sync(); });
  $('#authForm').addEventListener('submit', submitAuth);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.id) return;
    if (f.id === 'securityForm' || f.id === 'adminBanForm' || f.id === 'adminUnbanForm' || f.id === 'adminCashForm') e.preventDefault();
    if (f.id === 'securityForm') changePasswordSubmit(f);
    else if (f.id === 'adminBanForm') adminBanSubmit(f);
    else if (f.id === 'adminUnbanForm') adminUnbanSubmit(f);
    else if (f.id === 'adminCashForm') adminCashSubmit(f);
  });

  applyPrefs();
  var coin = $('#coinBtn');
  coin.addEventListener('pointerdown', function (e) { e.preventDefault(); coin.classList.add('press'); tap(e.clientX, e.clientY); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { coin.addEventListener(n, function () { coin.classList.remove('press'); }); });
  coin.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); var r = coin.getBoundingClientRect(); tap(r.left + r.width / 2, r.top + r.height / 2); }
  });

  /* -------------------------------------------------------------------- boot */
  $('#modeNote').textContent = ONLINE
    ? 'Online mode: account and score sync to the shared leaderboard. Secure recovery and admin controls need backend setup.'
    : 'Local mode: accounts and progress are stored on this device. Use Account Backup to save a copy. Version 2.0.0 by DataRonn.';
  var ses = LS.get('cb_session', null);
  if (ses && ses.key) {
    var st0 = LS.get('cb_state_' + ses.key, null);
    if (!st0 && !ONLINE) { var rec = lu()[ses.key]; if (rec) st0 = rec.data; }
    if (st0) enter(ses, st0); else show('auth');
  } else show('auth');
})();
