/* MAKE THE CUT — js/account.js (owner: ui_main)
 * Cuentas para guardar el progreso en la nube (Firebase, proyecto make-the-cut-vb; diseño en notes/cuentas.md).
 *  - Solo usuario y contraseña (correo ficticio <usuario>@cuentas.make-the-cut.invalid). Firebase por REST, sin librerías.
 *  - Se sincronizan cuatro guardados del navegador: escuadrón ('voley3d.squad'), Carrera ('voley3d.career'), ajustes
 *    ('voley3d.settings') y récord ('voley3d.record'). Cada uno es un documento users/{uid}/saves/{squad|career|settings|record}
 *    = {data: JSON en texto, updatedAt: ms, v: 1}. Sin cifrar (lo eligió Ferran); las reglas solo dejan leer y escribir al dueño.
 *  - No toca el resto del juego: escucha las escrituras de esas claves en localStorage (envuelve Storage.setItem/removeItem),
 *    apunta la hora y sube el cambio a los ~1,5 s (y al ocultar la pestaña). Sin cuenta o sin red, todo sigue en local.
 *  - Al entrar se une lo del dispositivo con lo de la cuenta: gana lo más reciente; si las dos Carreras son distintas, se pregunta.
 *    Si llega algo de la cuenta, la página se recarga para que el juego lo lea.
 *  - Panel propio (#account) que se abre con el botón «Cuenta» del menú principal (#btnAcc, lo crea este módulo).
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var FB = { key: 'AIzaSyC59o9QtpUvjWT4g3ouOXinghASTuXZSes', project: 'make-the-cut-vb', mail: '@cuentas.make-the-cut.invalid' };
  var FS = 'https://firestore.googleapis.com/v1/projects/' + FB.project + '/databases/(default)/documents/';
  var SES = 'voley3d.account', META = 'voley3d.account.meta';
  var DOCS = { 'voley3d.squad': 'squad', 'voley3d.career': 'career', 'voley3d.settings': 'settings', 'voley3d.record': 'record' };
  var LS = null; try { LS = window.localStorage; } catch (e) { }
  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;

  function jget(k) { try { return JSON.parse(LS.getItem(k) || 'null'); } catch (e) { return null; } }
  function jset(k, v) { try { if (v == null) rawRemove.call(LS, k); else rawSet.call(LS, k, JSON.stringify(v)); } catch (e) { } }
  var acc = jget(SES); if (acc && !(acc.uid && acc.rt && acc.user)) acc = null;
  var meta = jget(META) || {};          // {clave: ms de la última escritura local}
  var synced = jget(META + '.up') || {}; // {clave: ms subido a la cuenta}
  var applying = false, dirty = {}, pushT = 0, lastSync = 0, status = acc ? 'idle' : 'off', lastErr = '';

  // ---------------------------------------------------------------- escuchar las escrituras del juego
  if (LS) {
    Storage.prototype.setItem = function (k, v) {
      rawSet.call(this, k, v);
      if (this === LS && !applying && DOCS[k]) touch(k);
    };
    Storage.prototype.removeItem = function (k) {
      rawRemove.call(this, k);
      if (this === LS && !applying && DOCS[k]) touch(k);
    };
  }
  function touch(k) { meta[k] = Date.now(); jset(META, meta); if (acc) { dirty[k] = 1; schedule(); } }
  function schedule() { clearTimeout(pushT); pushT = setTimeout(function () { push().catch(function () { }); }, 1500); }

  // ---------------------------------------------------------------- Firebase (REST)
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function req(url, opt) {
    var ac = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, 15000);
    if (ac) opt.signal = ac.signal;
    return fetch(url, opt).then(function (r) { clearTimeout(t); return r; }, function () { clearTimeout(t); throw err('unavailable', 'sin conexión'); });
  }
  function idt(path, body) {
    return req('https://identitytoolkit.googleapis.com/v1/' + path + '?key=' + FB.key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var m = String(j.error && j.error.message || ''); throw err(r.status >= 500 || r.status === 429 ? 'unavailable' : m.split(/[ :]/)[0] || 'error', m); }
          return j;
        });
      });
  }
  function token() {
    if (!acc) return Promise.reject(err('unauthenticated'));
    if (acc.it && acc.ie > Date.now() + 60e3) return Promise.resolve(acc.it);
    return req('https://securetoken.googleapis.com/v1/token?key=' + FB.key, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(acc.rt) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) {
            var m = String(j.error && j.error.message || '');
            if (r.status === 400 && /TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN/.test(m)) { lost(); throw err('unauthenticated'); }
            throw err('unavailable', m);
          }
          acc.it = j.id_token; acc.rt = j.refresh_token || acc.rt; acc.ie = Date.now() + (+j.expires_in || 3600) * 1000; jset(SES, acc);
          return acc.it;
        });
      });
  }
  function fs(method, path, body, keep) {
    return token().then(function (t) {
      var o = { method: method, headers: { Authorization: 'Bearer ' + t } };
      if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
      if (keep) o.keepalive = true;
      return req(FS + path, o);
    }).then(function (r) {
      if (r.status === 404) return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw err(r.status === 403 ? 'permission_denied' : r.status === 401 ? 'unauthenticated' : r.status >= 500 || r.status === 429 ? 'unavailable' : 'error', j.error && j.error.message);
        return j;
      });
    });
  }
  function docPath(name) { return 'users/' + acc.uid + '/saves/' + name; }
  function readAll() {
    return fs('GET', 'users/' + acc.uid + '/saves?pageSize=20').then(function (j) {
      var out = {};
      ((j && j.documents) || []).forEach(function (d) {
        var f = d.fields || {}, name = d.name.split('/').pop();
        out[name] = { data: f.data ? f.data.stringValue : null, at: f.updatedAt ? +(f.updatedAt.integerValue || f.updatedAt.doubleValue || 0) : 0 };
      });
      return out;
    });
  }
  function writeDoc(k, keep) {
    var at = meta[k] || Date.now(), raw = null;
    try { raw = LS.getItem(k); } catch (e) { }
    var body = { fields: { data: { stringValue: raw == null ? 'null' : raw }, updatedAt: { integerValue: String(at) }, v: { integerValue: '1' } } };
    return fs('PATCH', docPath(DOCS[k]), body, keep).then(function () { synced[k] = at; jset(META + '.up', synced); });
  }
  function push(keep) {
    if (!acc) return Promise.resolve();
    var ks = Object.keys(dirty); if (!ks.length) return Promise.resolve();
    dirty = {}; setStatus('busy');
    return Promise.all(ks.map(function (k) { return writeDoc(k, keep); })).then(function () { lastSync = Date.now(); setStatus('idle'); },
      function (e) { ks.forEach(function (k) { dirty[k] = 1; }); setStatus('error', e); if (e.code === 'unavailable') { /* se reintenta al volver la red */ } });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') push(true); else if (acc) syncDown(false); });
  window.addEventListener('pagehide', function () { push(true); });
  window.addEventListener('online', function () { if (acc) { for (var k in DOCS) if ((meta[k] || 0) > (synced[k] || 0)) dirty[k] = 1; push(); } });

  // ---------------------------------------------------------------- unir dispositivo y cuenta
  function score(raw) { // progreso del escuadrón para decidir sin fechas (primera vez en este dispositivo)
    try { var o = JSON.parse(raw), s = 0; (o.a || []).forEach(function (a) { s += (a.lvl || 0) * 1000 + (a.xp || 0) + (a.matches || 0); }); return s; } catch (e) { return 0; }
  }
  function apply(k, raw) {
    applying = true;
    try { if (raw == null || raw === 'null') rawRemove.call(LS, k); else rawSet.call(LS, k, raw); } catch (e) { }
    applying = false;
  }
  /** Une lo local con lo remoto. first: primera entrada en este dispositivo (sin fechas fiables). Devuelve {changed, conflict}. */
  function merge(remote, first) {
    var changed = false, conflict = null;
    Object.keys(DOCS).forEach(function (k) {
      var name = DOCS[k], R = remote[name], L = null; try { L = LS.getItem(k); } catch (e) { }
      var Lt = meta[k] || 0;
      if (!R) { if (L != null) dirty[k] = 1; return; }
      var Rd = R.data === 'null' ? null : R.data;
      if (Rd === L) { synced[k] = R.at; return; }
      if (L == null) { apply(k, Rd); meta[k] = R.at; synced[k] = R.at; changed = true; return; }
      if (Rd == null) { if (first || Lt > R.at) dirty[k] = 1; else { apply(k, null); meta[k] = R.at; changed = true; } return; }
      if (k === 'voley3d.career' && first) { conflict = { k: k, remote: Rd, local: L, at: R.at }; return; }
      var remoteWins = first ? (k === 'voley3d.squad' ? score(Rd) >= score(L) : k !== 'voley3d.record' || recPlayed(Rd) >= recPlayed(L)) : R.at > Lt;
      if (remoteWins) { apply(k, Rd); meta[k] = R.at; synced[k] = R.at; changed = true; } else dirty[k] = 1;
    });
    jset(META, meta); jset(META + '.up', synced);
    return { changed: changed, conflict: conflict };
  }
  function recPlayed(raw) { try { return +(JSON.parse(raw).played) || 0; } catch (e) { return 0; } }
  function reloadSoon(msg) {
    try { sessionStorage.setItem('voley3d.account.toast', msg); } catch (e) { }
    setTimeout(function () { location.reload(); }, 350);
  }
  /** Al abrir el juego (y al volver a la pestaña) con sesión: baja lo que haya cambiado en otro dispositivo. */
  function syncDown(atBoot) {
    if (!acc) return Promise.resolve();
    setStatus('busy');
    return readAll().then(function (remote) {
      var r = merge(remote, false);
      lastSync = Date.now(); setStatus('idle'); push();
      var c = VB.ctx, inMenu = !c || !c.state || c.state === 'menu';
      if (r.changed && inMenu && !reloadedOnce()) reloadSoon('Progreso actualizado desde tu cuenta');
    }, function (e) { setStatus('error', e); });
  }
  function reloadedOnce() { try { if (sessionStorage.getItem('voley3d.account.rl')) return true; sessionStorage.setItem('voley3d.account.rl', '1'); } catch (e) { } return false; }

  // ---------------------------------------------------------------- entrar, crear, salir, borrar
  function normUser(u) { return String(u || '').trim().toLowerCase(); }
  function userOk(u) { return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u); }
  function enter(user, pass, create) {
    user = normUser(user);
    if (!userOk(user)) return Promise.reject(err('bad_user'));
    if (String(pass || '').length < 6) return Promise.reject(err('WEAK_PASSWORD'));
    return idt(create ? 'accounts:signUp' : 'accounts:signInWithPassword', { email: user + FB.mail, password: pass, returnSecureToken: true })
      .then(function (j) {
        acc = { user: user, uid: j.localId, rt: j.refreshToken, it: j.idToken, ie: Date.now() + (+j.expiresIn || 3600) * 1000 };
        jset(SES, acc); synced = {}; jset(META + '.up', synced);
        return readAll();
      }).then(function (remote) {
        var r = merge(remote, true);
        return push().then(function () { lastSync = Date.now(); setStatus('idle'); return r; });
      });
  }
  function signOut() { acc = null; dirty = {}; jset(SES, null); setStatus('off'); }
  function lost() { acc = null; jset(SES, null); setStatus('off'); toast('Se ha cerrado la sesión de tu cuenta. Vuelve a entrar desde «Cuenta».'); }
  function deleteAccount() {
    if (!acc) return Promise.resolve();
    return Promise.all(Object.keys(DOCS).map(function (k) { return fs('DELETE', docPath(DOCS[k])).catch(function () { }); }))
      .then(function () { return token(); })
      .then(function (t) { return idt('accounts:delete', { idToken: t }); })
      .then(function () { signOut(); });
  }
  function errText(e) {
    var c = e && e.code || '';
    if (c === 'bad_user') return 'El usuario debe tener entre 3 y 30 letras o números (también . _ -), sin espacios.';
    if (c === 'WEAK_PASSWORD') return 'La contraseña debe tener al menos 6 caracteres.';
    if (c === 'EMAIL_EXISTS') return 'Ese usuario ya existe. Si es tuyo, pulsa «Entrar».';
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(c)) return 'Usuario o contraseña incorrectos.';
    if (c === 'TOO_MANY_ATTEMPTS_TRY_LATER') return 'Demasiados intentos. Espera un poco y vuelve a probar.';
    if (c === 'unavailable') return 'No hay conexión. Prueba otra vez en un momento.';
    return 'No se ha podido completar. Prueba otra vez.';
  }

  // ---------------------------------------------------------------- estado y avisos
  var listeners = [];
  function setStatus(s, e) { status = acc ? s : 'off'; lastErr = e ? errText(e) : ''; listeners.forEach(function (f) { try { f(status); } catch (x) { } }); refreshBtn(); if (root && !root.hidden && view === 'in') render(); }
  var toastT = 0;
  function toast(msg) {
    var t = document.getElementById('accToast');
    if (!t) { t = document.createElement('div'); t.id = 'accToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3500);
  }

  // ---------------------------------------------------------------- panel y botón
  var CSS = '#account{position:fixed;inset:0;z-index:190;display:flex;align-items:center;justify-content:center;padding:calc(10px + var(--st,0px)) calc(10px + var(--sr,0px)) calc(10px + var(--sbm,0px)) calc(10px + var(--sl,0px));background:rgba(12,8,24,.72);font-family:var(--ui,system-ui,sans-serif)}' +
    '#account[hidden],#accToast[hidden]{display:none}' +
    '#account .ac-sheet{position:relative;width:min(440px,100%);max-height:100%;overflow:auto;padding:18px 20px 16px;border-radius:18px;background:var(--tp,#2b2547);color:var(--fg,#f7f2ea);box-shadow:inset 0 0 0 2.5px var(--tk,#1d1530),5px 6px 0 var(--tk,#1d1530);text-align:left}' +
    '#account h2{margin:0 44px 6px 0;font:900 28px/1 var(--display,sans-serif);letter-spacing:.03em;text-transform:uppercase}' +
    '#account .ac-k{margin:0 0 4px;font:800 11px var(--display,sans-serif);letter-spacing:.3em;text-transform:uppercase;color:var(--gold,#ffd23f)}' +
    '#account p{margin:0 0 10px;font-size:14px;line-height:1.4;color:var(--fg2,#dfe6ef)}' +
    '#account .ac-tabs{display:flex;gap:6px;margin:4px 0 12px;padding:4px;border-radius:12px;background:rgba(0,0,0,.22)}' +
    '#account .ac-tabs button{flex:1;min-height:40px;border:0;border-radius:9px;background:transparent;color:var(--fg2,#dfe6ef);font:800 15px var(--display,sans-serif);letter-spacing:.08em;text-transform:uppercase;cursor:pointer}' +
    '#account .ac-tabs button[aria-selected=true]{background:var(--gold,#ffd23f);color:var(--tk,#1d1530);box-shadow:0 0 0 2px var(--tk,#1d1530)}' +
    '#account label{display:block;margin:0 0 4px;font:800 11px var(--display,sans-serif);letter-spacing:.24em;text-transform:uppercase;color:var(--gold,#ffd23f)}' +
    '#account input{width:100%;box-sizing:border-box;height:46px;margin:0 0 10px;padding:0 12px;border:0;border-radius:11px;background:rgba(0,0,0,.3);color:#fff;font:600 17px var(--ui,system-ui,sans-serif);box-shadow:inset 0 0 0 2px rgba(255,255,255,.12)}' +
    '#account input:focus{outline:none;box-shadow:inset 0 0 0 2.5px var(--gold,#ffd23f)}' +
    '#account .ac-warn{padding:8px 10px;border-radius:10px;background:rgba(255,178,56,.12);box-shadow:inset 0 0 0 1.5px rgba(255,178,56,.4);font-size:13px}' +
    '#account .ac-err{color:#ff9b8a;font-weight:700;min-height:1em}' +
    '#account .ac-acts{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;margin-top:6px}' +
    '#account .ac-acts button,#account .ac-row button{min-height:44px;padding:0 16px;border:0;border-radius:12px;font:800 16px var(--display,sans-serif);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;color:#fff;background:var(--tp2,#352d5c);box-shadow:inset 0 0 0 2px var(--tk,#1d1530),3px 4px 0 var(--tk,#1d1530)}' +
    '#account .pri{background:var(--pri,linear-gradient(180deg,#ff8040 0 50%,#f65d1d 50% 100%))!important}' +
    '#account .dan{background:var(--bad-d,#a8283a)!important}' +
    '#account .ac-x{position:absolute;top:10px;right:10px;width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:var(--fg,#fff);font-size:26px;line-height:1;cursor:pointer}' +
    '#account .ac-user{display:flex;align-items:center;gap:12px;margin:6px 0 12px;padding:10px 12px;border-radius:14px;background:rgba(0,0,0,.2)}' +
    '#account .ac-av{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:#1cc4b4;color:var(--tk,#1d1530);font:900 24px var(--display,sans-serif);box-shadow:0 0 0 2.5px var(--tk,#1d1530)}' +
    '#account .ac-user b{display:block;font:900 20px var(--display,sans-serif);letter-spacing:.04em}' +
    '#account .ac-user small{color:var(--muted,#93a4b9);font-size:13px}' +
    '#account .ac-row{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}' +
    '#account .ac-choice{display:grid;gap:10px;margin:8px 0}' +
    '#account .ac-choice button{text-align:left;min-height:56px;padding:8px 14px;border:0;border-radius:12px;color:#fff;background:var(--tp2,#352d5c);box-shadow:inset 0 0 0 2px var(--tk,#1d1530),3px 4px 0 var(--tk,#1d1530);font:600 14px var(--ui,system-ui,sans-serif);cursor:pointer}' +
    '#account .ac-choice b{display:block;font:900 17px var(--display,sans-serif);letter-spacing:.05em;text-transform:uppercase;color:var(--gold,#ffd23f)}' +
    '#btnAcc .ac-dot{width:9px;height:9px;border-radius:50%;background:var(--muted,#93a4b9);box-shadow:0 0 0 1.5px var(--tk,#1d1530)}' +
    '#btnAcc.on .ac-dot{background:#1cc4b4}#btnAcc.busy .ac-dot{background:var(--gold,#ffd23f)}#btnAcc.err .ac-dot{background:#ff6a5a}#btnAcc:not(.on):not(.busy):not(.err) .ac-dot{display:none}' +
    '@media (max-height:460px){#account .ac-sheet{padding:10px 16px 12px}#account h2{font-size:22px}#account .ac-intro{display:none}#account .ac-tabs{margin:2px 0 8px}#account .ac-tabs button{min-height:36px}#account input{height:40px;margin-bottom:6px}#account .ac-warn{font-size:12px;padding:6px 8px;margin-bottom:4px}}' +
    '#accToast{position:fixed;left:50%;bottom:calc(18px + var(--sbm,0px));transform:translateX(-50%);z-index:195;max-width:calc(100% - 32px);padding:10px 16px;border-radius:12px;background:var(--tp,#2b2547);color:var(--fg,#fff);font:700 14px var(--ui,system-ui,sans-serif);box-shadow:inset 0 0 0 2px var(--tk,#1d1530),4px 5px 0 var(--tk,#1d1530);pointer-events:none}';
  var root = null, view = 'enter', tab = 'in', busy = false, msg = '', pending = null, lastFocus = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function build() {
    if (root) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'account'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'acTitle');
    root.addEventListener('click', function (e) { if (e.target === root && !busy && view !== 'conflict') close(); e.stopPropagation(); });
    root.addEventListener('keydown', function (e) {
      e.stopPropagation(); // que el menú de detrás no reciba las teclas mientras se escribe
      if (e.key === 'Escape' && !busy && view !== 'conflict') { e.preventDefault(); close(); }
    });
    root.addEventListener('keyup', function (e) { e.stopPropagation(); });
    document.body.appendChild(root);
  }
  function ago(t) {
    if (!t) return 'todavía no';
    var s = Math.round((Date.now() - t) / 1000);
    return s < 10 ? 'ahora mismo' : s < 60 ? 'hace ' + s + ' s' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : 'hace ' + Math.round(s / 3600) + ' h';
  }
  function careerInfo(raw) {
    try {
      var c = JSON.parse(raw), p = c.player || {}, k = c.clubs && c.myClub >= 0 ? c.clubs[c.myClub] : null, club = k && k.name || '';
      var bits = [];
      if (p.name) bits.push(p.name);
      if (c.season) bits.push('temporada ' + c.season);
      if (typeof club === 'string' && club) bits.push(club);
      if (p.lvl) bits.push('nivel ' + p.lvl);
      return bits.join(', ') || 'Carrera guardada';
    } catch (e) { return 'Carrera guardada'; }
  }
  function render() {
    var h = '<div class="ac-sheet"><button class="ac-x" data-ac="close" aria-label="Cerrar"' + (busy || view === 'conflict' ? ' hidden' : '') + '>✕</button>';
    if (view === 'conflict' && pending) {
      h += '<p class="ac-k">Tu cuenta</p><h2 id="acTitle">¿Qué Carrera te quedas?</h2>' +
        '<p>Tienes una Carrera en este dispositivo y otra distinta en tu cuenta. Elige con cuál seguir: la otra se perderá.</p>' +
        '<div class="ac-choice"><button data-ac="keepRemote"><b>La de la cuenta</b>' + esc(careerInfo(pending.remote)) + '</button>' +
        '<button data-ac="keepLocal"><b>La de este dispositivo</b>' + esc(careerInfo(pending.local)) + '</button></div>';
    } else if (acc) {
      var st = status === 'busy' ? 'Sincronizando…' : status === 'error' ? (lastErr || 'Sin conexión') + ' Se reintentará solo.' : 'Guardado en la nube ' + ago(lastSync);
      h += '<p class="ac-k">Tu cuenta</p><h2 id="acTitle">Cuenta</h2>' +
        '<div class="ac-user"><span class="ac-av" aria-hidden="true">' + esc(acc.user.charAt(0).toUpperCase()) + '</span><span><b>' + esc(acc.user) + '</b><small>' + esc(st) + '</small></span></div>' +
        '<p>Tu progreso (jugadores, Carrera, récord y ajustes) se guarda solo en tu cuenta. Entra con el mismo usuario en otro dispositivo para seguir donde lo dejaste.</p>' +
        '<div class="ac-row"><button data-ac="sync">Sincronizar ahora</button><button data-ac="out">Cerrar sesión</button></div>' +
        (view === 'del' ? '<p class="ac-warn">¿Seguro? Se borra la cuenta y lo guardado en ella, y no se puede deshacer. Lo de este dispositivo se queda.</p><div class="ac-acts"><button data-ac="cancel">No, volver</button><button class="dan" data-ac="delYes">Sí, borrar la cuenta</button></div>'
          : '<div class="ac-acts"><button class="dan" data-ac="del">Borrar la cuenta</button><button class="pri" data-ac="close">Hecho</button></div>');
    } else {
      var create = tab === 'new';
      h += '<p class="ac-k">Guarda tu progreso</p><h2 id="acTitle">Cuenta</h2>' +
        '<p class="ac-intro">Con una cuenta, tus jugadores, tu Carrera y tus ajustes se guardan en la nube y los tienes en cualquier dispositivo.</p>' +
        '<div class="ac-tabs" role="tablist"><button role="tab" data-ac="tabIn" aria-selected="' + !create + '">Entrar</button><button role="tab" data-ac="tabNew" aria-selected="' + create + '">Crear cuenta</button></div>' +
        '<form id="acForm" autocomplete="on" novalidate><label for="acUser">Usuario</label><input id="acUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" required>' +
        '<label for="acPass">Contraseña</label><input id="acPass" name="password" type="password" autocomplete="' + (create ? 'new-password' : 'current-password') + '" minlength="6" required>' +
        (create ? '<p class="ac-warn">No pedimos correo, así que <b>si olvidas la contraseña no se puede recuperar</b>. Apúntala en un sitio seguro.</p>' : '') +
        '<p class="ac-err" role="alert">' + esc(msg) + '</p>' +
        '<div class="ac-acts"><button type="button" data-ac="close">Ahora no</button><button class="pri" type="submit"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Un momento…' : create ? 'Crear cuenta' : 'Entrar') + '</button></div></form>';
    }
    h += '</div>';
    var u = root.querySelector('#acUser'), keepU = u ? u.value : '', keepP = root.querySelector('#acPass') ? root.querySelector('#acPass').value : '';
    root.innerHTML = h;
    if (root.querySelector('#acUser')) { root.querySelector('#acUser').value = keepU; root.querySelector('#acPass').value = keepP; }
    root.querySelectorAll('[data-ac]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); act(b.getAttribute('data-ac')); }); });
    var f = root.querySelector('#acForm');
    if (f) f.addEventListener('submit', function (e) { e.preventDefault(); e.stopPropagation(); act('submit'); });
  }
  function act(a) {
    if (busy && a !== 'close') return;
    if (a === 'close') { if (!busy) close(); return; }
    if (a === 'tabIn' || a === 'tabNew') { tab = a === 'tabNew' ? 'new' : 'in'; msg = ''; render(); focusFirst(); return; }
    if (a === 'submit') {
      var u = root.querySelector('#acUser').value, p = root.querySelector('#acPass').value;
      busy = true; msg = ''; render();
      enter(u, p, tab === 'new').then(function (r) {
        busy = false;
        if (r.conflict) { pending = r.conflict; view = 'conflict'; render(); return; }
        view = 'in'; render();
        if (r.changed) reloadSoon(tab === 'new' ? 'Cuenta creada' : 'Has entrado: progreso cargado desde tu cuenta');
        else toast(tab === 'new' ? 'Cuenta creada: tu progreso ya se guarda en la nube' : 'Has entrado en tu cuenta');
      }, function (e) { busy = false; if (acc && e.code !== 'unauthenticated') { view = 'in'; } msg = errText(e); render(); });
      return;
    }
    if (a === 'keepRemote' || a === 'keepLocal') {
      var p2 = pending; pending = null; view = 'in';
      if (a === 'keepRemote') { apply(p2.k, p2.remote); meta[p2.k] = p2.at; synced[p2.k] = p2.at; jset(META, meta); jset(META + '.up', synced); render(); reloadSoon('Carrera cargada desde tu cuenta'); }
      else { meta[p2.k] = Date.now(); jset(META, meta); dirty[p2.k] = 1; push(); render(); toast('Te quedas con la Carrera de este dispositivo'); }
      return;
    }
    if (a === 'sync') { for (var k in DOCS) if ((meta[k] || 0) > (synced[k] || 0)) dirty[k] = 1; busy = true; render(); syncDown(false).then(function () { busy = false; render(); }); return; }
    if (a === 'out') { signOut(); view = 'enter'; tab = 'in'; render(); toast('Sesión cerrada. Tu progreso sigue en este dispositivo.'); return; }
    if (a === 'del') { view = 'del'; render(); return; }
    if (a === 'cancel') { view = 'in'; render(); return; }
    if (a === 'delYes') {
      busy = true; render();
      deleteAccount().then(function () { busy = false; view = 'enter'; render(); toast('Cuenta borrada'); }, function (e) { busy = false; view = 'in'; lastErr = errText(e); render(); });
    }
  }
  function focusFirst() { try { var i = root.querySelector('#acUser') || root.querySelector('[data-ac=close]'); if (i) i.focus({ preventScroll: true }); } catch (e) { } }
  function open() {
    build(); view = acc ? 'in' : 'enter'; msg = ''; render();
    lastFocus = document.activeElement; root.hidden = false; focusFirst();
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) { }
  }
  function isOpen() { return !!(root && !root.hidden); }

  // botón «Cuenta» del menú principal (debajo de «Pantalla completa»; solo en la página principal del menú)
  var btn = null;
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1.2-4 4-5.6 7.5-5.6s6.3 1.6 7.5 5.6"/></svg>';
  function refreshBtn() {
    if (!btn) return;
    btn.querySelector('span').textContent = acc ? acc.user : 'Cuenta';
    btn.classList.toggle('on', !!acc); btn.classList.toggle('busy', status === 'busy'); btn.classList.toggle('err', status === 'error');
    btn.setAttribute('aria-label', acc ? 'Cuenta: ' + acc.user : 'Cuenta: guarda tu progreso');
    btn.title = acc ? 'Sesión iniciada' : 'Sin sesión';
  }
  function placeBtn() {
    if (!btn) return;
    var page = VB.UI && VB.UI.menuPage ? VB.UI.menuPage() : 'main';
    btn.hidden = page !== 'main' || !!(VB.ctx && VB.ctx.debug);
    var fsb = document.getElementById('btnFs');
    if (fsb && !fsb.hidden) btn.style.top = (fsb.offsetTop + fsb.offsetHeight + 8) + 'px'; else btn.style.top = '';
  }
  function initBtn() {
    var menu = document.getElementById('menu'); if (!menu || btn) return;
    btn = document.createElement('button'); btn.id = 'btnAcc'; btn.className = 'fs-btn'; btn.setAttribute('data-ui', '');
    btn.innerHTML = ICON + '<span>Cuenta</span><i class="ac-dot" aria-hidden="true"></i>';
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(); });
    var fsb = document.getElementById('btnFs');
    if (fsb && fsb.parentNode === menu) menu.insertBefore(btn, fsb.nextSibling); else menu.appendChild(btn);
    refreshBtn(); placeBtn(); setInterval(placeBtn, 700);
  }

  function boot() {
    build(); initBtn();
    try { var t = sessionStorage.getItem('voley3d.account.toast'); if (t) { sessionStorage.removeItem('voley3d.account.toast'); setTimeout(function () { toast(t); }, 900); } } catch (e) { }
    if (acc) syncDown(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  VB.Account = {
    open: open, close: close, isOpen: isOpen, user: function () { return acc ? acc.user : null; }, status: function () { return status; },
    sync: function () { return syncDown(false); }, signOut: signOut, onChange: function (f) { listeners.push(f); },
    // pruebas (tools/cuentatest.js): entrar sin la interfaz y borrar la cuenta al acabar
    _enter: enter, _delete: deleteAccount, _push: function () { for (var k in DOCS) if ((meta[k] || 0) > (synced[k] || 0)) dirty[k] = 1; return push(); }
  };
})();
