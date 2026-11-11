/* MAKE THE CUT — js/install.js (owner: ui_main)
 * Tutorial de «instalar» el juego (añadirlo a la pantalla de inicio) para jugar a pantalla completa en el móvil, sin la barra de
 * direcciones. Pasos dibujados según dónde se abre: iPhone/iPad (Safari), Android (Chrome; botón «Instalar» directo si el
 * navegador lo ofrece) y navegadores de dentro de otras apps (WhatsApp, Instagram…), donde lo primero es abrirlo en el navegador.
 *  - Sale UNA vez, sola, la primera vez que se entra desde un móvil sin tenerlo instalado (clave 'voley3d.install').
 *  - Se cierra al momento: «Ahora no», la ✕, tocando fuera o con Esc. No vuelve a salir sola.
 *  - Se vuelve a abrir con VB.Install.open() (el botón «Pantalla completa» del menú en iPhone y en navegadores de apps).
 * Sin dependencias: crea su propio DOM y su CSS (usa los colores de index.html).
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var KEY = 'voley3d.install';
  var ua = navigator.userAgent || '';
  var isIOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  // navegadores de dentro de apps: no instalan ni ponen pantalla completa
  var inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|musical_ly|TikTok|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(ua);
  var deferred = null; // evento beforeinstallprompt (Chrome Android / escritorio)
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; refreshBtn(); });
  window.addEventListener('appinstalled', function () { deferred = null; seen(); close(); });

  function touch() { try { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch (e) { return false; } }
  function standalone() {
    try { return navigator.standalone === true || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
  }
  function wasSeen() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function seen() { try { localStorage.setItem(KEY, '1'); } catch (e) { } }

  // ---------------------------------------------------------------- dibujos (SVG en línea, estilo cartoon del juego)
  var INK = '#1d1530', GOLD = '#ffd23f', HOT = '#ff6a2e', PAPER = '#fff6e6', SCR = '#3a2c66';
  function phone(inner) {
    return '<svg viewBox="0 0 120 190" aria-hidden="true"><rect x="14" y="6" width="92" height="178" rx="16" fill="' + INK + '"/>' +
      '<rect x="20" y="14" width="80" height="162" rx="10" fill="' + SCR + '"/>' + inner + '</svg>';
  }
  function ring(x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="' + GOLD + '" stroke-width="3.5" class="ix-pulse"/>'; }
  function finger(x, y) { // dedo que toca (la punta en x,y)
    // la punta queda justo debajo del objetivo (que se siga viendo) y la mano baja desde ahí
    return '<g transform="translate(' + (x + 6) + ' ' + (y + 11) + ') scale(.78)"><g class="ix-tap"><path d="M0 0c-3 0-5 2-5 5v16c-3-3-8-3-9 1 0 2 1 3 2 5l8 10c2 2 4 3 7 3h8c5 0 8-4 8-9V17c0-3-2-5-5-5-1 0-2 0-3 1 0-3-2-4-4-4-2 0-3 1-3 2V5c0-3-2-5-4-5z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/></g></g>';
  }
  function shareIco(x, y, c) { // cuadrado con flecha hacia arriba (Compartir de iOS)
    return '<g transform="translate(' + x + ' ' + y + ')" fill="none" stroke="' + c + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M-5 -1h-2v10h14V-1h-2"/><path d="M0 4V-9M-4 -5l4-4 4 4"/></g>';
  }
  function plusIco(x, y, c) { return '<g transform="translate(' + x + ' ' + y + ')" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"><rect x="-6" y="-6" width="12" height="12" rx="3"/><path d="M0 -3v6M-3 0h6"/></g>'; }
  function ball(x, y, r) { // el icono del juego, en pequeño
    return '<g transform="translate(' + x + ' ' + y + ')"><rect x="' + (-r - 3) + '" y="' + (-r - 3) + '" width="' + (2 * r + 6) + '" height="' + (2 * r + 6) + '" rx="' + (r * 0.55) + '" fill="#2a1f4a" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<circle r="' + r + '" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<g fill="none" stroke="' + INK + '" stroke-width="1.3" transform="scale(' + (r / 10) + ') translate(-12 -12)">' +
      ['0', '120', '240'].map(function (a) { return '<g transform="rotate(' + a + ' 12 12)"><path d="M12 12C12 8 10.5 4.5 8 2.8"/><path d="M13.8 2.2C16.5 5.5 17.8 9.5 17.3 13.8"/></g>'; }).join('') + '</g></g>';
  }
  function rows(hl, label, ico) { // lista de opciones de un menú; la fila hl resaltada con su texto
    var h = '';
    for (var i = 0; i < 5; i++) {
      var y = 70 + i * 19, on = i === hl;
      h += '<rect x="26" y="' + y + '" width="68" height="15" rx="4" fill="' + (on ? GOLD : 'rgba(255,255,255,.12)') + '"/>';
      if (on) h += (ico ? ico(34, y + 7.5, INK) : '') + '<text x="' + (ico ? 43 : 31) + '" y="' + (y + 10.5) + '" font-size="6.2" font-weight="800" fill="' + INK + '" font-family="Barlow,system-ui,sans-serif">' + label + '</text>';
      else h += '<rect x="32" y="' + (y + 6) + '" width="' + (30 + (i * 7) % 20) + '" height="3" rx="1.5" fill="rgba(255,255,255,.35)"/>';
    }
    return h;
  }
  function homeGrid() {
    var h = '';
    for (var r = 0; r < 4; r++) for (var c = 0; c < 3; c++) {
      if (r === 2 && c === 1) continue;
      h += '<rect x="' + (31 + c * 22) + '" y="' + (40 + r * 26) + '" width="14" height="14" rx="4" fill="rgba(255,255,255,' + (0.14 + ((r + c) % 3) * 0.06) + ')"/>';
    }
    return h + ball(60, 99, 7);
  }
  var DRAW = {
    iosShare: phone('<rect x="24" y="128" width="72" height="22" rx="11" fill="#2b2547" stroke="rgba(255,255,255,.18)"/>' +
      '<rect x="30" y="135" width="10" height="8" rx="2" fill="rgba(255,255,255,.3)"/><rect x="80" y="135" width="10" height="8" rx="2" fill="rgba(255,255,255,.3)"/>' +
      shareIco(60, 140, PAPER) + ring(60, 139, 11) + finger(60, 148)),
    iosAdd: phone('<rect x="20" y="58" width="80" height="118" rx="10" fill="#2b2547"/>' + rows(2, 'Añadir a inicio', plusIco) + finger(86, 116)),
    iosConfirm: phone('<rect x="20" y="14" width="80" height="40" rx="10" fill="#2b2547"/><text x="82" y="32" font-size="8" font-weight="800" fill="' + GOLD + '" text-anchor="end" font-family="Barlow,system-ui,sans-serif">Añadir</text>' +
      ring(72, 29, 13) + ball(40, 80, 9) + '<rect x="56" y="76" width="34" height="5" rx="2.5" fill="rgba(255,255,255,.4)"/>' + finger(72, 40)),
    home: phone(homeGrid() + ring(60, 99, 13) + finger(60, 110)),
    andMenu: phone('<rect x="20" y="14" width="80" height="22" fill="#2b2547"/><rect x="26" y="20" width="54" height="10" rx="5" fill="rgba(255,255,255,.18)"/>' +
      '<g fill="' + PAPER + '"><circle cx="90" cy="20" r="1.8"/><circle cx="90" cy="25" r="1.8"/><circle cx="90" cy="30" r="1.8"/></g>' + ring(90, 25, 9) + finger(88, 33)),
    andInstall: phone('<rect x="20" y="58" width="80" height="118" rx="10" fill="#2b2547"/>' + rows(3, 'Instalar aplicación', plusIco) + finger(86, 135)),
    appMenu: phone('<rect x="20" y="14" width="80" height="22" fill="#2b2547"/><g fill="' + PAPER + '"><circle cx="84" cy="25" r="1.8"/><circle cx="89" cy="25" r="1.8"/><circle cx="94" cy="25" r="1.8"/></g>' +
      ring(89, 25, 10) + finger(87, 34)),
    appOpen: phone('<rect x="20" y="58" width="80" height="118" rx="10" fill="#2b2547"/>' + rows(1, 'Abrir en el navegador', null) + finger(86, 97))
  };

  // ---------------------------------------------------------------- pasos según el sitio
  function steps() {
    if (inApp) return {
      intro: 'Lo estás abriendo dentro de otra app (WhatsApp, Instagram…). Ahí no se puede quitar la barra: ábrelo en el navegador y luego instálalo.',
      s: [['appMenu', 'Toca el menú de la app (los tres puntos <b>•••</b> o <b>⋮</b>).'],
        ['appOpen', 'Elige <b>Abrir en el navegador</b> (Safari o Chrome).'],
        [isIOS ? 'iosShare' : 'andMenu', 'Ya en el navegador, sigue los pasos de instalar: vuelve a abrir este tutorial desde <b>Pantalla completa</b>.']]
    };
    if (isIOS) return {
      intro: 'En iPhone el juego solo va a pantalla completa si lo añades a la pantalla de inicio. Es un minuto y luego se abre como una app.',
      s: [['iosShare', 'En Safari, toca <b>Compartir</b> (el cuadrado con la flecha). Si no lo ves, está dentro del botón <b>•••</b>.'],
        ['iosAdd', 'Baja y toca <b>Añadir a pantalla de inicio</b>.'],
        ['iosConfirm', 'Toca <b>Añadir</b>, arriba a la derecha.'],
        ['home', 'Abre <b>Make the Cut</b> desde su icono: a pantalla completa y sin barra.']]
    };
    return {
      intro: 'Instala el juego y se abrirá como una app: a pantalla completa, sin la barra de direcciones.',
      s: [['andMenu', 'En Chrome, toca el menú <b>⋮</b> de arriba a la derecha.'],
        ['andInstall', 'Toca <b>Instalar aplicación</b> (o <b>Añadir a pantalla de inicio</b>).'],
        ['home', 'Abre <b>Make the Cut</b> desde su icono.']]
    };
  }

  // ---------------------------------------------------------------- panel
  var CSS = '#install{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:calc(10px + var(--st,0px)) calc(10px + var(--sr,0px)) calc(10px + var(--sbm,0px)) calc(10px + var(--sl,0px));background:rgba(12,8,24,.72);font-family:var(--ui,system-ui,sans-serif)}' +
    '#install[hidden]{display:none}' +
    '#install .ix-sheet{position:relative;width:min(760px,100%);max-height:100%;overflow:auto;padding:16px 18px 14px;border-radius:18px;background:var(--tp,#2b2547);color:var(--fg,#f7f2ea);box-shadow:inset 0 0 0 2.5px var(--tk,#1d1530),5px 6px 0 var(--tk,#1d1530)}' +
    '#install h2{margin:0 40px 4px 0;text-align:left;font:900 26px/1 var(--display,sans-serif);letter-spacing:.03em;text-transform:uppercase}' +
    '#install .ix-k{margin:0 0 4px;text-align:left;font:800 11px var(--display,sans-serif);letter-spacing:.3em;text-transform:uppercase;color:var(--gold,#ffd23f)}' +
    '#install .ix-intro{margin:0 0 12px;text-align:left;font-size:14px;line-height:1.4;color:var(--fg2,#dfe6ef)}' +
    '#install .ix-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:0;padding:0;list-style:none}' +
    '#install .ix-steps li{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 8px 10px;border-radius:14px;background:rgba(0,0,0,.18);box-shadow:inset 0 0 0 2px rgba(255,255,255,.06)}' +
    '#install .ix-steps svg{width:100%;max-width:120px;height:auto;max-height:34vh}' +
    '#install .ix-n{display:grid;place-items:center;width:26px;height:26px;margin-top:-2px;border-radius:50%;background:var(--gold,#ffd23f);color:var(--tk,#1d1530);font:900 15px var(--display,sans-serif);box-shadow:0 0 0 2px var(--tk,#1d1530)}' +
    '#install .ix-steps p{margin:0;font-size:13px;line-height:1.35;text-align:center}' +
    '#install .ix-steps b{color:var(--gold,#ffd23f)}' +
    '#install .ix-acts{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;margin-top:12px}' +
    '#install .ix-acts button{min-height:44px;padding:0 18px;border:0;border-radius:12px;font:800 16px var(--display,sans-serif);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;color:#fff;background:var(--tp2,#352d5c);box-shadow:inset 0 0 0 2px var(--tk,#1d1530),3px 4px 0 var(--tk,#1d1530)}' +
    '#install .ix-acts .pri{background:linear-gradient(180deg,#ff8040 0 50%,#f65d1d 50% 100%)}' +
    '#install .ix-x{position:absolute;top:10px;right:10px;width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:var(--fg,#fff);font-size:26px;line-height:1;cursor:pointer}' +
    '#install .ix-pulse{transform-box:fill-box;transform-origin:center;animation:inPulse 1.4s ease-in-out infinite}' +
    '#install .ix-tap{animation:inTap 1.4s ease-in-out infinite}' +
    '@keyframes inPulse{50%{transform:scale(1.18);opacity:.55}}' +
    '@keyframes inTap{50%{transform:translateY(4px)}}' +
    '@media (max-height:460px){#install .ix-sheet{padding:10px 14px}#install h2{font-size:21px}#install .ix-intro{font-size:12.5px;margin-bottom:8px}#install .ix-steps svg{max-height:40vh}#install .ix-steps p{font-size:12px}#install .ix-acts{margin-top:8px}}' +
    '@media (prefers-reduced-motion:reduce){#install .ix-pulse,#install .ix-tap{animation:none}}';
  var root = null, lastFocus = null;
  function build() {
    if (root) return root;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'install'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'inTitle');
    root.addEventListener('click', function (e) { if (e.target === root) close(); e.stopPropagation(); });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    document.body.appendChild(root);
    return root;
  }
  function render() {
    var d = steps();
    root.innerHTML = '<div class="ix-sheet"><button class="ix-x" data-in="close" aria-label="Cerrar">✕</button>' +
      '<p class="ix-k">Para jugar mejor</p><h2 id="inTitle">Juega a pantalla completa</h2><p class="ix-intro">' + d.intro + '</p>' +
      '<ol class="ix-steps">' + d.s.map(function (s, i) {
        return '<li><span class="ix-n">' + (i + 1) + '</span>' + DRAW[s[0]] + '<p>' + s[1] + '</p></li>';
      }).join('') + '</ol>' +
      '<div class="ix-acts"><button data-in="later">Ahora no</button><button class="pri" data-in="ok" id="inOk">Entendido</button></div></div>';
    root.querySelectorAll('[data-in]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var a = b.getAttribute('data-in');
        if (a === 'install' && deferred) { var p = deferred; deferred = null; p.prompt(); p.userChoice.then(function () { close(); }, close); return; }
        close();
      });
    });
    refreshBtn();
  }
  // con el aviso nativo de Chrome disponible, «Entendido» pasa a «Instalar» (un toque y listo)
  function refreshBtn() {
    var b = root && root.querySelector('#inOk'); if (!b) return;
    if (deferred && !inApp) { b.textContent = 'Instalar'; b.setAttribute('data-in', 'install'); }
  }
  function open() {
    build(); render();
    lastFocus = document.activeElement;
    root.hidden = false; seen();
    try { root.querySelector('#inOk').focus({ preventScroll: true }); } catch (e) { }
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) { }
  }
  function isOpen() { return !!(root && !root.hidden); }
  /** ¿Tiene sentido ofrecerlo aquí? (móvil o tableta sin el juego instalado) */
  function useful() { return touch() && !standalone(); }

  // Primera visita desde el móvil: sale sola una vez, cuando ya se ve el menú. Nunca en las pruebas (?debug=…) ni instalada.
  // Nunca a la vez que otro panel (p. ej. «Primer partido», que sale al tocar JUGAR la primera vez): espera a que la portada del
  // menú esté libre (VB.UI.menuIdle: sin panel, sin cortinilla, sin Carrera) 1,5 s seguidos. Si el jugador se va a jugar antes,
  // sale al volver al menú tras el partido; si cierra la página antes, en la próxima visita (no se marca como visto).
  function idle() {
    var c = VB.ctx, U = VB.UI;
    if (c && c.state && c.state !== 'menu') return false;
    if (U && U.menuIdle) { try { if (!U.menuIdle()) return false; } catch (e) { return false; } }
    else if (U && U.isPanelOpen && U.isPanelOpen()) return false;
    if (VB.CareerUI && VB.CareerUI.isOpen) { try { if (VB.CareerUI.isOpen()) return false; } catch (e) { } }
    return document.visibilityState !== 'hidden';
  }
  function auto() {
    var q = location.search || '';
    if (/[?&](debug|autopilot|noinstall)\b/.test(q) || wasSeen() || !useful()) return;
    var t0 = Date.now(), calm = 0;
    var iv = setInterval(function () {
      if (wasSeen() || isOpen()) { clearInterval(iv); return; }        // abierto a mano (Pantalla completa) o ya visto
      calm = idle() ? calm + 250 : 0;
      if (Date.now() - t0 >= 2200 && calm >= 1500) { clearInterval(iv); open(); }
    }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();

  /** Pruebas: fuerza la variante ('ios' | 'android' | 'app') y abre. */
  function _as(k) { isIOS = k === 'ios'; isAndroid = k === 'android'; inApp = k === 'app'; open(); }
  VB.Install = { _as: _as, open: open, close: close, isOpen: isOpen, useful: useful, inApp: inApp, isIOS: isIOS, isAndroid: isAndroid, KEY: KEY };
})();
