/* =====================================================================
 * VOLEY 3D — js/input.js   (owner: camera_input)
 * Entrada cruda: teclado, mando (Gamepad API) y controles táctiles.
 * Devuelve INTENCIONES en espacio de PANTALLA/cámara:
 *   mx: derecha +, my: hacia la red (arriba) +, |(mx,my)| <= 1
 * main.js las convierte a mundo con VB.CameraRig.getBasis().
 *
 * Teclado: flechas / WASD (por código físico: vale en AZERTY/QWERTZ),
 *   Espacio o J golpear/sacar, K o X saltar, C cambiar, P/Esc pausa, M sonido.
 *   Sin auto‑repetición (e.repeat se ignora) y con prioridad a la última
 *   tecla pulsada si se aprietan dos opuestas (izq+der).
 * Mando (mapeo estándar): stick izq./cruceta mover, A golpear, B o X saltar,
 *   RB/LB/Y cambiar, Start pausa, Select sonido. Zona muerta radial con
 *   reescalado y respuesta suave. Vibración en los toques propios.
 * Táctil: joystick flotante en la mitad izquierda (aparece donde pones el
 *   dedo y te sigue si te pasas), botones GOLPEAR (naranja, grande) y SALTAR
 *   (azul) a la derecha con respuesta al pulsar, botón de pausa; respeta
 *   las zonas seguras (notch). El botón GOLPEAR pasa a "SACAR" en tu saque
 *   y brilla cuando tu jugador llega al balón.
 * El overlay vive en #touch y trae su propio <style> (prefijo .vt-).
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var ctx = null;
  var it = { mx: 0, my: 0, hit: false, jump: false, switchPlayer: false, pause: false, mute: false, any: false,
             confirm: false, device: 'keyboard', hitHeld: false, jumpHeld: false };

  // ---------------- Teclado ----------------
  // acciones por código físico (e.code) y, de reserva, por e.key
  var CODE = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    Space: 'hit', KeyJ: 'hit', KeyK: 'jump', KeyX: 'jump', KeyC: 'switch',
    KeyP: 'pause', Escape: 'pause', KeyM: 'mute', Enter: 'confirm', NumpadEnter: 'confirm'
  };
  var KEY = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    ' ': 'hit', spacebar: 'hit', j: 'hit', k: 'jump', x: 'jump', c: 'switch', p: 'pause', escape: 'pause', esc: 'pause', m: 'mute', enter: 'confirm'
  };
  var down = {};          // acción -> número de teclas físicas que la mantienen
  var held = {};          // código -> acción (para soltar bien aunque cambie el layout)
  var stamp = {};         // acción -> instante de la última pulsación (prioridad de opuestas)
  var edge = {};          // acción -> pulsada desde el último poll
  var seq = 0;

  function actionOf(e) { return CODE[e.code] || KEY[(e.key || '').toLowerCase()] || null; }
  function typingTarget(e) {
    var t = e.target; if (!t || !t.tagName) return false;
    var n = t.tagName; return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable;
  }
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || typingTarget(e)) return;
    var a = actionOf(e); if (!a) return;
    var id = e.code || e.key;
    if (!held[id]) { held[id] = a; down[a] = (down[a] || 0) + 1; stamp[a] = ++seq; if (!e.repeat) edge[a] = true; }
    it.device = 'keyboard';
    // que la página no se desplace con Espacio/flechas mientras se juega
    if (ctx && (ctx.state === 'playing') && (a === 'hit' || a === 'left' || a === 'right' || a === 'up' || a === 'down' || a === 'jump')) e.preventDefault();
  }
  function onKeyUp(e) {
    var id = e.code || e.key, a = held[id];
    if (!a) { a = actionOf(e); if (!a) return; }
    delete held[id];
    down[a] = Math.max(0, (down[a] || 0) - 1);
  }
  function clearKeys() { down = {}; held = {}; edge = {}; }
  function isDown(a) { return (down[a] || 0) > 0; }
  /** Eje con prioridad a la última tecla pulsada si están las dos. */
  function axis(neg, pos) {
    var n = isDown(neg), p = isDown(pos);
    if (n && p) return (stamp[pos] || 0) > (stamp[neg] || 0) ? 1 : -1;
    return p ? 1 : n ? -1 : 0;
  }

  // ---------------- Mando ----------------
  var pad = { idx: -1, prev: [], vibe: null, lastUse: 0 };
  function pollPad() {
    var pads = null;
    try { pads = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { pads = null; }
    if (!pads) return null;
    if (pad.idx >= 0 && pads[pad.idx] && pads[pad.idx].connected) return pads[pad.idx];
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad.idx = i; return pads[i]; }
    pad.idx = -1; return null;
  }
  function padBtn(p, i) { var b = p.buttons && p.buttons[i]; return !!(b && (b.pressed || b.value > 0.5)); }
  // botones (mapeo estándar W3C): 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Select, 9 Start, 12-15 cruceta
  var PB = { hit: [0], jump: [1, 2], sw: [4, 5, 3], pause: [9], mute: [8] };
  var padNow = { hit: false, jump: false, sw: false, pause: false, mute: false };
  function anyBtn(p, list) { for (var i = 0; i < list.length; i++) if (padBtn(p, list[i])) return true; return false; }

  // ---------------- Táctil ----------------
  var T = { joy: null, ox: 0, oy: 0, jx: 0, jy: 0, R: 58, hit: false, jump: false, pause: false, sw: false,
            hitDown: false, jumpDown: false, used: false, shown: false, lastLabel: '', lastReady: null, lastServe: null };
  var el = {};
  var CSS = '' +
    '#touch{position:absolute;inset:0;pointer-events:none;z-index:5;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
    '#touch.on{pointer-events:auto}' +
    '.vt-zone{position:absolute;left:0;top:0;bottom:0;width:50%;touch-action:none}' +
    '.vt-joy{position:absolute;left:0;top:0;pointer-events:none;transition:opacity .25s}' +
    '.vt-base{position:absolute;width:var(--d);height:var(--d);margin:calc(var(--d)/-2) 0 0 calc(var(--d)/-2);border-radius:50%;' +
      'background:radial-gradient(circle,rgba(255,255,255,.05) 0 55%,rgba(255,255,255,.12) 56% 100%);border:2px solid rgba(255,255,255,.28);' +
      'box-shadow:0 6px 24px rgba(0,0,0,.35),inset 0 0 18px rgba(0,0,0,.25)}' +
    '.vt-base::before,.vt-base::after{content:"";position:absolute;left:50%;top:50%;width:0;height:0;border:6px solid transparent;opacity:.45}' +
    '.vt-base::before{border-bottom:8px solid #fff;margin:calc(var(--d)/-2 + 5px) 0 0 -6px}' +
    '.vt-base::after{border-top:8px solid #fff;margin:calc(var(--d)/2 - 19px) 0 0 -6px}' +
    '.vt-knob{position:absolute;width:var(--k);height:var(--k);margin:calc(var(--k)/-2) 0 0 calc(var(--k)/-2);border-radius:50%;' +
      'background:radial-gradient(circle at 35% 30%,#fff 0,#e9eef5 35%,#aab7c7 100%);box-shadow:0 4px 14px rgba(0,0,0,.45);opacity:.9}' +
    '.vt-joy.idle{opacity:.38;left:env(safe-area-inset-left)}.vt-joy.idle .vt-knob{opacity:.55}' +
    '.vt-tip{position:absolute;transform:translate(-50%,0);margin-top:calc(var(--d)/2 + 8px);white-space:nowrap;' +
      'font:700 11px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.16em;color:rgba(255,255,255,.75);text-shadow:0 1px 4px rgba(0,0,0,.6)}' +
    '.vt-joy:not(.idle) .vt-tip{display:none}' +
    '.vt-btn{position:absolute;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#fff;' +
      'font:800 15px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.08em;touch-action:none;' +
      'border:2px solid rgba(255,255,255,.42);box-shadow:0 8px 22px rgba(0,0,0,.4),inset 0 2px 0 rgba(255,255,255,.28),inset 0 -6px 14px rgba(0,0,0,.18);' +
      'opacity:.86;transition:transform .07s ease-out,opacity .12s,box-shadow .2s;text-shadow:0 1px 2px rgba(0,0,0,.35)}' +
    '.vt-btn svg{width:34%;height:auto;display:block;pointer-events:none}' +
    '.vt-btn span{pointer-events:none}' +
    '.vt-btn.dn{transform:scale(.88);opacity:1;filter:brightness(1.12)}' +
    '.vt-hit{width:104px;height:104px;right:calc(22px + env(safe-area-inset-right));bottom:calc(26px + env(safe-area-inset-bottom));' +
      'background:radial-gradient(circle at 40% 30%,#ff9a6b,#ff6b3d 55%,#e2481f)}' +
    '.vt-hit.ready{box-shadow:0 0 0 4px rgba(255,210,63,.85),0 0 28px rgba(255,190,60,.75),0 8px 22px rgba(0,0,0,.4),inset 0 2px 0 rgba(255,255,255,.28);opacity:1}' +
    '.vt-jump{width:78px;height:78px;right:calc(140px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));' +
      'background:radial-gradient(circle at 40% 30%,#7fb2ff,#3f8cff 55%,#2565d6);font-size:13px}' +
    '.vt-jump.off,.vt-sw.off{opacity:.3}' +
    '.vt-sw{width:50px;height:50px;right:calc(150px + env(safe-area-inset-right));bottom:calc(112px + env(safe-area-inset-bottom));' +
      'background:rgba(8,13,22,.62);font-size:10px;letter-spacing:.1em}' +
    '.vt-sw svg{width:46%}' +
    '.vt-pause{width:46px;height:46px;right:calc(14px + env(safe-area-inset-right));top:calc(14px + env(safe-area-inset-top));' +
      'background:rgba(8,13,22,.66);border-color:rgba(255,255,255,.3)}' +
    '.vt-pause svg{width:40%}' +
    '@media (max-height:420px){.vt-hit{width:90px;height:90px;bottom:calc(16px + env(safe-area-inset-bottom))}' +
      '.vt-jump{width:68px;height:68px;right:calc(124px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom))}' +
      '.vt-sw{width:44px;height:44px;right:calc(128px + env(safe-area-inset-right));bottom:calc(92px + env(safe-area-inset-bottom))}' +
      '.vt-pause{width:40px;height:40px}}' +
    '@media (max-height:340px){.vt-hit{width:78px;height:78px}.vt-jump{width:60px;height:60px;right:calc(108px + env(safe-area-inset-right))}' +
      '.vt-sw{right:calc(110px + env(safe-area-inset-right));bottom:calc(80px + env(safe-area-inset-bottom))}}';

  var ICON_HIT = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5c-2.6 3-2.6 14 0 17M4.2 9.2c4.2 1.6 11.4 1.6 15.6 0M5.5 17c3.5-2.4 9.5-2.4 13 0"/></svg>';
  var ICON_JUMP = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13l6-6 6 6M6 19l6-6 6 6"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="#fff"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></svg>';
  var ICON_SW = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-4-4M20 16H6l4 4"/></svg>';

  function buildTouch() {
    var st = document.createElement('style'); st.textContent = CSS;
    (document.head || document.body || document.documentElement).appendChild(st);
    var rootEl = document.getElementById('touch');
    if (!rootEl) { rootEl = document.createElement('div'); rootEl.id = 'touch'; (ctx.container || document.body).appendChild(rootEl); }
    rootEl.hidden = true;
    rootEl.innerHTML = '<div class="vt-zone"></div>' +
      '<div class="vt-joy idle"><div class="vt-base"></div><div class="vt-knob"></div><div class="vt-tip">MOVER</div></div>' +
      '<div class="vt-btn vt-sw" role="button" aria-label="Cambiar de jugador">' + ICON_SW + '</div>' +
      '<div class="vt-btn vt-jump" role="button" aria-label="Saltar">' + ICON_JUMP + '<span>SALTAR</span></div>' +
      '<div class="vt-btn vt-hit" role="button" aria-label="Golpear">' + ICON_HIT + '<span>GOLPEAR</span></div>' +
      '<div class="vt-btn vt-pause" role="button" aria-label="Pausa">' + ICON_PAUSE + '</div>';
    el.root = rootEl; el.zone = rootEl.querySelector('.vt-zone'); el.joy = rootEl.querySelector('.vt-joy');
    el.base = rootEl.querySelector('.vt-base'); el.knob = rootEl.querySelector('.vt-knob');
    el.hit = rootEl.querySelector('.vt-hit'); el.hitLabel = el.hit.querySelector('span');
    el.jump = rootEl.querySelector('.vt-jump'); el.pause = rootEl.querySelector('.vt-pause'); el.sw = rootEl.querySelector('.vt-sw');

    function btn(node, key, heldKey) {
      var ids = {};
      node.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        T.used = true; it.device = 'touch'; T[key] = true; ids[e.pointerId] = 1;
        if (heldKey) T[heldKey] = true;
        node.classList.add('dn');
        try { node.setPointerCapture(e.pointerId); } catch (_) { }
      }, { passive: false });
      var up = function (e) {
        delete ids[e.pointerId];
        for (var k in ids) return; // otro dedo sigue en el botón
        node.classList.remove('dn'); if (heldKey) T[heldKey] = false;
      };
      node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up); node.addEventListener('lostpointercapture', up);
      node.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }
    btn(el.hit, 'hit', 'hitDown'); btn(el.jump, 'jump', 'jumpDown'); btn(el.pause, 'pause'); btn(el.sw, 'sw');

    el.zone.addEventListener('pointerdown', function (e) {
      e.preventDefault(); T.used = true; it.device = 'touch';
      if (T.joy !== null) return;
      var r = rootEl.getBoundingClientRect();
      T.joy = e.pointerId; T.ox = e.clientX - r.left; T.oy = e.clientY - r.top; T.jx = T.jy = 0;
      // que la base no quede medio fuera de la pantalla
      if (r.width > T.R * 3 && r.height > T.R * 3) { T.ox = Math.max(T.R + 8, T.ox); T.oy = Math.min(Math.max(T.R + 8, T.oy), r.height - T.R - 8); }
      try { el.zone.setPointerCapture(e.pointerId); } catch (_) { }
      placeJoy();
    }, { passive: false });
    el.zone.addEventListener('pointermove', function (e) {
      if (e.pointerId !== T.joy) return;
      var r = rootEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      var dx = x - T.ox, dy = y - T.oy, l = Math.hypot(dx, dy), R = T.R;
      if (l > R) { T.ox += dx * (1 - R / l); T.oy += dy * (1 - R / l); dx = x - T.ox; dy = y - T.oy; } // la base sigue al dedo
      T.jx = dx; T.jy = dy; placeJoy();
    });
    var end = function (e) { if (e.pointerId === T.joy) { T.joy = null; T.jx = T.jy = 0; placeJoy(); } };
    el.zone.addEventListener('pointerup', end); el.zone.addEventListener('pointercancel', end); el.zone.addEventListener('lostpointercapture', end);
    // nada de zoom / scroll / menú contextual sobre los controles
    rootEl.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    rootEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    rootEl.addEventListener('dblclick', function (e) { e.preventDefault(); });
    try { document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false }); } catch (_) { }
    layoutTouch();
    placeJoy();
  }
  /** Tamaño del joystick según la pantalla. */
  function layoutTouch() {
    if (!el.root || !ctx) return;
    var h = ctx.height || window.innerHeight || 400, w = ctx.width || window.innerWidth || 800;
    T.R = Math.round(Math.max(42, Math.min(66, Math.min(w, h) * 0.15)));
    el.joy.style.setProperty('--d', (T.R * 2) + 'px');
    el.joy.style.setProperty('--k', Math.round(T.R * 0.9) + 'px');
  }
  /** Joystick: donde está el dedo o, en reposo, una guía tenue abajo a la izquierda. */
  function placeJoy() {
    if (!el.joy) return;
    var on = T.joy !== null, x, y;
    if (on) { x = T.ox; y = T.oy; }
    else {
      var h = ctx && ctx.height ? ctx.height : 400;
      x = T.R + 34; y = h - T.R - 30;   // (.vt-joy.idle ya suma la zona segura izquierda)
    }
    el.joy.classList.toggle('idle', !on);
    el.joy.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    el.knob.style.transform = on ? 'translate(' + T.jx + 'px,' + T.jy + 'px)' : '';
  }
  function resetTouch() { T.joy = null; T.jx = T.jy = 0; T.hitDown = T.jumpDown = false; if (el.hit) { el.hit.classList.remove('dn'); el.jump.classList.remove('dn'); } placeJoy(); }

  /** Estado contextual de los botones (SACAR en tu saque, brillo cuando llegas al balón). */
  function touchContext() {
    var g = ctx.game; if (!g || !el.hit) return;
    var myServe = g.mode === 'serve' && g.ball && g.ball.held && g.ball.held.team === 0 && !g.demo && !g.autopilot;
    var label = myServe ? 'SACAR' : 'GOLPEAR';
    if (label !== T.lastLabel) { T.lastLabel = label; el.hitLabel.textContent = label; el.hit.setAttribute('aria-label', label === 'SACAR' ? 'Sacar' : 'Golpear'); }
    var ready = false;
    if (g.mode === 'rally' && g.ctrl && VB.Sim && VB.Sim.canReach) { try { ready = !!VB.Sim.canReach(g, g.ctrl); } catch (_) { ready = false; } }
    ready = ready || myServe;
    if (ready !== T.lastReady) { T.lastReady = ready; el.hit.classList.toggle('ready', ready); }
    var serveNow = g.mode === 'serve';
    if (serveNow !== T.lastServe) { T.lastServe = serveNow; el.jump.classList.toggle('off', serveNow); el.sw.classList.toggle('off', serveNow); }
  }

  // ---------------- Vibración ----------------
  function rumble(strength, ms) {
    strength = Math.max(0, Math.min(1, strength || 0.5)); ms = Math.max(10, Math.min(250, ms || 60));
    try {
      if (it.device === 'gamepad' && pad.idx >= 0) {
        var pads = navigator.getGamepads ? navigator.getGamepads() : null, p = pads && pads[pad.idx];
        var va = p && p.vibrationActuator;
        if (va && va.playEffect) { var r = va.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: strength * 0.6, strongMagnitude: strength }); if (r && r.catch) r.catch(function () { }); }
      } else if (it.device === 'touch' && navigator.vibrate) {
        navigator.vibrate(Math.round(8 + strength * 14));
      }
    } catch (e) { }
  }

  VB.Input = {
    init: function (c) {
      ctx = c;
      it.device = ctx.isTouch ? 'touch' : 'keyboard';
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', function () { clearKeys(); resetTouch(); });
      document.addEventListener('visibilitychange', function () { if (document.hidden) { clearKeys(); resetTouch(); } });
      // un toque en cualquier sitio en un equipo no detectado como táctil activa los controles táctiles
      window.addEventListener('touchstart', function () { T.used = true; it.device = 'touch'; }, { passive: true });
      window.addEventListener('gamepadconnected', function (e) { pad.idx = e.gamepad ? e.gamepad.index : -1; });
      window.addEventListener('gamepaddisconnected', function (e) { if (e.gamepad && e.gamepad.index === pad.idx) pad.idx = -1; pad.prev.length = 0; });
      buildTouch();
    },
    /** Limpia pulsaciones al cambiar de estado (p. ej. el Espacio que pulsa "Jugar" no saca). */
    onState: function () { edge = {}; T.hit = T.jump = T.pause = T.sw = false; },
    resize: function () { layoutTouch(); placeJoy(); },
    isTouchActive: function () { return T.used || !!(ctx && ctx.isTouch); },
    /** OPCIONAL: vibración corta (mando o móvil). strength 0..1, ms. */
    rumble: rumble,
    /** Devuelve las intenciones del frame (objeto reutilizado). */
    poll: function (dt) {
      // --- teclado
      var mx = axis('left', 'right'), my = axis('down', 'up');
      if (mx && my) { mx *= 0.7071; my *= 0.7071; }
      var hit = !!edge.hit, jump = !!edge.jump, sw = !!edge['switch'], pause = !!edge.pause, mute = !!edge.mute, confirm = !!edge.confirm;
      var hitHeld = isDown('hit'), jumpHeld = isDown('jump');
      edge = {};
      // --- táctil (y de pantalla hacia abajo => my negativo)
      if (T.joy !== null) {
        var jl = Math.hypot(T.jx, T.jy), R = T.R, dz = R * 0.16;
        if (jl > dz) {
          var m = Math.min(1, (jl - dz) / (R * 0.8 - dz));
          m = m * (0.35 + 0.65 * m);                        // curva: precisión cerca del centro, velocidad al fondo
          mx = T.jx / jl * m; my = -T.jy / jl * m;
        }
      }
      hit = hit || T.hit; jump = jump || T.jump; pause = pause || T.pause; sw = sw || T.sw;
      hitHeld = hitHeld || T.hitDown; jumpHeld = jumpHeld || T.jumpDown;
      T.hit = T.jump = T.pause = T.sw = false;
      // --- mando
      var p = pollPad();
      if (p) {
        var ax = p.axes[0] || 0, ay = p.axes[1] || 0, al = Math.hypot(ax, ay), DZ = 0.18;
        var used = false;
        if (al > DZ) {
          var k = Math.min(1, (al - DZ) / (0.95 - DZ)); k = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
          mx = ax / al * k; my = -ay / al * k; used = true;
        }
        var dx = (padBtn(p, 15) ? 1 : 0) - (padBtn(p, 14) ? 1 : 0), dy = (padBtn(p, 12) ? 1 : 0) - (padBtn(p, 13) ? 1 : 0);
        if (dx || dy) { var dl = Math.hypot(dx, dy); mx = dx / dl; my = dy / dl; used = true; }
        padNow.hit = anyBtn(p, PB.hit); padNow.jump = anyBtn(p, PB.jump); padNow.sw = anyBtn(p, PB.sw);
        padNow.pause = anyBtn(p, PB.pause); padNow.mute = anyBtn(p, PB.mute);
        var pv = pad.prev;
        if (padNow.hit && !pv[0]) hit = true; if (padNow.jump && !pv[1]) jump = true; if (padNow.sw && !pv[2]) sw = true;
        if (padNow.pause && !pv[3]) pause = true; if (padNow.mute && !pv[4]) mute = true;
        if ((padNow.hit && !pv[0]) || (padNow.pause && !pv[3])) confirm = true;
        if (padNow.hit || padNow.jump || padNow.sw || padNow.pause || padNow.mute) used = true;
        hitHeld = hitHeld || padNow.hit; jumpHeld = jumpHeld || padNow.jump;
        pv[0] = padNow.hit; pv[1] = padNow.jump; pv[2] = padNow.sw; pv[3] = padNow.pause; pv[4] = padNow.mute;
        if (used) it.device = 'gamepad';
      }
      var l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      it.mx = mx; it.my = my; it.hit = hit; it.jump = jump; it.switchPlayer = sw; it.pause = pause; it.mute = mute;
      it.confirm = confirm; it.hitHeld = hitHeld; it.jumpHeld = jumpHeld;
      it.any = hit || jump || sw || pause || mute || confirm || mx !== 0 || my !== 0;

      // --- overlay táctil: en partido, en horizontal, si se está jugando con el dedo
      var touchy = T.used || ctx.isTouch;
      var show = touchy && it.device === 'touch' && ctx.state === 'playing' && !ctx.portraitBlock;
      if (show !== T.shown) {
        T.shown = show; el.root.hidden = !show; el.root.classList.toggle('on', show);
        if (!show) resetTouch(); else { layoutTouch(); placeJoy(); }
      }
      if (show) touchContext();
      return it;
    }
  };
})();
