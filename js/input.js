/* =====================================================================
 * VOLEY 3D — js/input.js   (owner: camera_input)
 * Entrada cruda: teclado, mando (Gamepad API) y controles táctiles.
 * Devuelve INTENCIONES en espacio de PANTALLA/cámara:
 *   mx: derecha +, my: hacia la red (arriba) +, |(mx,my)| <= 1
 * main.js las convierte a mundo con VB.CameraRig.getBasis().
 *
 * Teclado: flechas / WASD (por código físico: vale en AZERTY/QWERTZ),
 *   Espacio saltar (pulgar), J o X golpear/sacar (J: mano derecha con WASD; X: mano
 *   izquierda con las flechas), C cambiar, V challenge, P/Esc pausa, M sonido.
 *   K sigue saltando (alias mudo del mapa antiguo: no se anuncia).
 *   Sin auto‑repetición (e.repeat se ignora) y con prioridad a la última
 *   tecla pulsada si se aprietan dos opuestas (izq+der).
 * Ratón (solo en partido, sobre la pista): clic izquierdo golpear/sacar, clic
 *   derecho saltar (sin menú contextual en el canvas). Mantener pulsado = mantener
 *   la tecla. No cuenta si el clic cae en un botón/panel ni con el overlay táctil.
 * Mando (mapeo estándar): stick izq./cruceta mover, A golpear, B o X saltar,
 *   RB/LB/Y cambiar, LT (L2) challenge, Start pausa, Select sonido. Zona muerta radial (medida
 *   desde el reposo de cada mando: la deriva de un stick gastado no mueve ni
 *   roba el control al dedo/teclado) con reescalado y respuesta suave.
 *   Vibración en los toques propios. Mapeo no
 *   estándar por heurística (botones + eje hat). Varios mandos: manda el último
 *   usado. Si se desconecta el mando con el que juegas, PAUSA.
 * Táctil: joystick flotante en la mitad izquierda (aparece donde pones el
 *   dedo y te sigue si te pasas), botones GOLPEAR (naranja, grande) y SALTAR
 *   (azul) a la derecha con respuesta al pulsar, botón de pausa; respeta
 *   las zonas seguras (notch). El botón GOLPEAR pasa a "SACAR" en tu saque;
 *   un aro se cierra sobre él hasta el instante ideal de pulsar y brilla desde
 *   ~0,24 s antes (a tiempo para reaccionar). Multitáctil con un gestor único
 *   de punteros: joystick + botones a la vez, deslizar de SALTAR a GOLPEAR,
 *   dedos perdidos / cancelados, giro de pantalla con el dedo puesto.
 * El overlay vive en #touch y trae su propio <style> (prefijo .vt-).
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var ctx = null;
  var it = { mx: 0, my: 0, hit: false, jump: false, jset: false, switchPlayer: false, pause: false, mute: false, challenge: false, any: false,
             confirm: false, device: 'keyboard', hitHeld: false, jumpHeld: false, padEvent: '' };

  // ---------------- Teclado ----------------
  // acciones por código físico (e.code) y, de reserva, por e.key
  var CODE = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    // K = COLOCAR (jset): en el aire, colocación en salto; en el suelo salta como Espacio (poll lo manda también como jump)
    Space: 'jump', KeyJ: 'hit', KeyX: 'hit', KeyK: 'jset', KeyC: 'switch', KeyV: 'challenge',
    KeyP: 'pause', Escape: 'pause', KeyM: 'mute', Enter: 'confirm', NumpadEnter: 'confirm'
  };
  var KEY = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    ' ': 'jump', spacebar: 'jump', j: 'hit', x: 'hit', k: 'jset', c: 'switch', v: 'challenge', p: 'pause', escape: 'pause', esc: 'pause', m: 'mute', enter: 'confirm'
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
    if (ctx && (ctx.state === 'playing') && (a === 'hit' || a === 'left' || a === 'right' || a === 'up' || a === 'down' || a === 'jump' || a === 'jset')) e.preventDefault();
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

  // ---------------- Ratón ----------------
  // Clic izquierdo = golpear, derecho = saltar: entran en el mismo mapa que las teclas (ids 'Mouse0'/'Mouse2'), así que
  // mantener pulsado da hitHeld/jumpHeld igual que una tecla. Se lee e.buttons (no e.button) en pointerdown/move/up: con un
  // botón ya pulsado, el 2.º solo llega como pointermove «acordado» (e.button !== -1). Solo pointerType 'mouse' (el dedo y
  // el lápiz van por el overlay táctil), solo en partido y nunca sobre un control de la UI, un panel o el overlay táctil.
  var MOUSE_UI = 'button,a,input,select,textarea,label,[role="button"],[data-ui],[data-opt],[data-nav],.screen,.sheet,#touch';
  function mouseOk(e) {
    if (!ctx || ctx.state !== 'playing' || ctx.portraitBlock || T.shown) return false;
    var tg = e.target;
    return !(tg && tg.closest && tg.closest(MOUSE_UI));
  }
  function mouseBtn(id, a, on, e, canPress) {
    if (on) {
      if (held[id] || !canPress || !mouseOk(e)) return;
      held[id] = a; down[a] = (down[a] || 0) + 1; stamp[a] = ++seq; edge[a] = true;
      it.device = 'keyboard'; stats.mouse[a]++;
      if (e.cancelable) e.preventDefault();          // sin selección de texto ni arrastres al hacer clic en la pista
    } else if (held[id]) {
      delete held[id]; down[a] = Math.max(0, (down[a] || 0) - 1);
    }
  }
  function onMouse(e) {
    if (e.pointerType !== 'mouse') return;
    var b = e.buttons | 0, canPress = e.type === 'pointerdown' || (e.type === 'pointermove' && e.button >= 0);
    mouseBtn('Mouse0', 'hit', (b & 1) !== 0, e, canPress);
    mouseBtn('Mouse2', 'jump', (b & 2) !== 0, e, canPress);
    mouseBtn('Mouse1', 'jset', (b & 4) !== 0, e, canPress);   // botón central (rueda) = COLOCAR
  }
  // la rueda pulsada no abre el desplazamiento automático (Windows) ni pega en Linux mientras se juega
  function onAux(e) { if (e.button === 1 && e.pointerType !== 'touch' && mouseOk(e) && e.cancelable) e.preventDefault(); }
  function onCtxMenu(e) {
    // el clic derecho salta: sin menú contextual sobre la pista (sí en los menús y paneles)
    var tg = e.target;
    if (tg && (tg === (ctx && ctx.canvas) || tg.tagName === 'CANVAS') && e.cancelable) e.preventDefault();
    else if (held.Mouse2 && e.cancelable) e.preventDefault();
  }

  // ---------------- Mando ----------------
  // Varios mandos: manda el último que se ha usado (cada uno con sus flancos). Conectar/desconectar en pleno
  // partido: al perder el mando activo se pide PAUSA (como en consola) y el dispositivo vuelve a teclado/táctil.
  // Mapeo no estándar (mapping !== 'standard', p. ej. mandos DirectInput genéricos): botones por heurística
  // (<= 11 botones: tipo XInput, Back 6 / Start 7; si no: Select 8 / Start 9) y cruceta por el eje "hat" (axes[9],
  // solo si antes se ha visto su valor de reposo > 1: así un eje que reposa en 0 no se lee como "abajo").
  // getGamepads() crea un array nuevo en cada llamada: sin ningún mando visto solo se consulta cada 30 frames.
  var pad = { idx: -1, known: false, prev: [], hatOk: [], event: '', pendPause: false, scan: 0, id: '', mapping: '', rest: [] };
  // DERIVA del stick (mandos gastados reposan en 0,2-0,3): la zona muerta se aplica al DESPLAZAMIENTO desde el
  // reposo de cada mando, no desde 0. Reposo = ejes al conectar (o al verlo por primera vez) y se refresca cuando el
  // stick lleva ~1 s quieto (±0,02) sin botones y a menos de 0,4 del centro (2 s si ahora mismo está moviendo al
  // jugador: un pulgar firme a media inclinación no se "come"). Si el stick vuelve al centro real lejos del reposo
  // guardado (reposo mal cogido con el stick inclinado), el reposo vuelve a ese centro al instante.
  var DZ = 0.18, PAD_ON = 0.5, PAD_SOFT = 0.26, REST_STILL = 0.02, REST_MAX = 0.4;
  var bufRest = { x: 0, y: 0 };
  function restOf(ix) {
    var R = pad.rest[ix];
    if (!R) R = pad.rest[ix] = { x: 0, y: 0, sx: 0, sy: 0, st: 0, ok: false };
    return R;
  }
  /** Fija el reposo desde una instantánea (gamepadconnected) si el stick está razonablemente centrado. */
  function seedRest(p) {
    if (!p || !p.axes) return;
    var R = restOf(p.index | 0), ax = +p.axes[0] || 0, ay = +p.axes[1] || 0;
    if (Math.hypot(ax, ay) < PAD_ON) { R.x = ax; R.y = ay; } else { R.x = R.y = 0; }
    R.sx = ax; R.sy = ay; R.st = nowS(); R.ok = true;
  }
  function anyPadBtn(p) {
    var b = p.buttons; if (!b) return false;
    for (var i = 0; i < b.length && i < 18; i++) if (b[i] && (b[i].pressed || b[i].value > 0.5)) return true;
    return false;
  }
  /** Actualiza el reposo del mando p y deja en bufRest el desplazamiento del stick izquierdo desde él. */
  function stickOffset(p) {
    var a = p.axes, ax = +a[0] || 0, ay = +a[1] || 0, R = restOf(p.index | 0), t = nowS();
    if (!R.ok) seedRest(p);
    var raw = Math.hypot(ax, ay);
    if (raw < 0.1 && Math.hypot(ax - R.x, ay - R.y) > DZ * 0.8) { R.x = ax; R.y = ay; }
    if (anyPadBtn(p) || Math.abs(ax - R.sx) > REST_STILL || Math.abs(ay - R.sy) > REST_STILL) { R.sx = ax; R.sy = ay; R.st = t; }
    else if (raw < REST_MAX) {
      var moving = it.device === 'gamepad' && (p.index | 0) === pad.idx && Math.hypot(ax - R.x, ay - R.y) > DZ;
      if (t - R.st > (moving ? 2.0 : 1.0)) { R.x = R.sx; R.y = R.sy; }
    }
    bufRest.x = ax - R.x; bufRest.y = ay - R.y;
    return bufRest;
  }
  function padActive(p) {
    var a = p.axes;
    if (anyPadBtn(p)) { stickOffset(p); return true; }
    var o = stickOffset(p);
    if (Math.hypot(o.x, o.y) > PAD_ON) return true;
    // cruceta por eje hat (mando no estándar): cuenta como uso solo tras haber visto su reposo (> 1,05) en ESE mando;
    // así un mando que solo se mueve con la cruceta pasa a ser el activo aunque haya otro conectado
    if (p.mapping !== 'standard' && a.length >= 10) {
      var v = +a[9], ix = p.index | 0;
      if (v === v) { if (v > 1.05) pad.hatOk[ix] = true; else if (pad.hatOk[ix] && v >= -1.05) return true; }
    }
    return false;
  }
  function padLost() {
    if (pad.idx < 0) return;
    pad.idx = -1; pad.event = 'disconnected'; stats.padLost++;
    // solo si se estaba jugando CON el mando: el teclado/táctil no se pausa porque se desenchufe un mando olvidado
    if (it.device === 'gamepad') {
      if (ctx && ctx.state === 'playing') pad.pendPause = true;
      it.device = (T.used || (ctx && ctx.isTouch)) ? 'touch' : 'keyboard';
    }
  }
  function pollPad() {
    pad.scan++;
    if (!pad.known && pad.scan % 30 !== 1) return null;
    var pads = null;
    try { pads = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { pads = null; }
    if (!pads) { if (pad.idx >= 0) padLost(); return null; }
    var cur = pad.idx >= 0 ? pads[pad.idx] : null;
    if (pad.idx >= 0 && (!cur || !cur.connected)) { padLost(); cur = null; }   // desconectado sin evento
    var curOn = cur && padActive(cur);
    if (!curOn) {
      // otro mando en uso (o el primero que aparece): pasa a ser el activo
      for (var i = 0; i < pads.length; i++) {
        var q = pads[i];
        if (!q || !q.connected || i === pad.idx) continue;
        pad.known = true;
        if (padActive(q) || !cur) { pad.idx = i; cur = q; if (padActive(q)) break; }
      }
    }
    if (cur) { pad.known = true; if (pad.id !== cur.id) { pad.id = cur.id || ''; pad.mapping = cur.mapping || ''; } }
    return cur;
  }
  function padBtn(p, i) { var b = p.buttons && p.buttons[i]; return !!(b && (b.pressed || b.value > 0.5)); }
  // botones (mapeo estándar W3C): 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Select, 9 Start, 12-15 cruceta
  // challenge (B4): gatillo izquierdo LT/L2 = botón 6 del mapeo estándar (analógico: cuenta por encima de 0,5). En XInput no
  // estándar los gatillos son ejes (sin mapeo fiable): ahí no hay challenge por mando (teclado V o botón táctil).
  // X (PS: cuadrado), antes 2.º botón de saltar, es COLOCAR (jset): en el aire coloca en salto, en el suelo sigue saltando
  var PB = { hit: [0], jump: [1], jset: [2], sw: [4, 5, 3], pause: [9], mute: [8], chal: [6] };
  var PB_X = { hit: [0], jump: [1], jset: [2], sw: [3, 4, 5], pause: [7], mute: [6], chal: [] };    // no estándar, <= 11 botones (XInput)
  var PB_D = { hit: [0], jump: [1], jset: [2], sw: [3, 4, 5], pause: [9], mute: [8], chal: [6] };    // no estándar, DirectInput genérico (L2)
  var padNow = { hit: false, jump: false, jset: false, sw: false, pause: false, mute: false, chal: false };
  // glifos de texto por acción (los usa la UI en avisos y en el panel de controles)
  var GLYPHS = { challenge: { keyboard: 'V', gamepad: 'LT', ps: 'L2', touch: 'CHALLENGE' },
                 jset: { keyboard: 'K', mouse: 'clic central', gamepad: 'X', ps: '□', touch: 'COLOCAR' } };
  function anyBtn(p, list) { for (var i = 0; i < list.length; i++) if (padBtn(p, list[i])) return true; return false; }
  // cruceta de un mando no estándar por el eje hat (axes[9]): -1 arriba … +1 arriba-izq. en pasos de 2/7; reposo ~1,29
  var HATX = [0, 1, 1, 1, 0, -1, -1, -1], HATY = [1, 1, 0, -1, -1, -1, 0, 1], hat = { x: 0, y: 0 };
  function readHat(p, idx) {
    hat.x = hat.y = 0;
    var a = p.axes; if (!a || a.length < 10) return false;
    var v = +a[9]; if (v !== v) return false;
    if (v > 1.05) { pad.hatOk[idx] = true; return false; }
    if (!pad.hatOk[idx] || v < -1.05) return false;
    var k = Math.round((v + 1) * 3.5) % 8; hat.x = HATX[k]; hat.y = HATY[k];
    return true;
  }

  // ---------------- Táctil ----------------
  var T = { lastTouch: 0, idle: false, see: [false, false, false], rects: null, rectAt: -1, joy: null, ox: 0, oy: 0, jx: 0, jy: 0, R: 58, hit: false, jump: false, set: false, setOn: false, pause: false, sw: false, chal: false,
            hitDown: false, jumpDown: false, used: false, shown: false, lastLabel: '', lastReady: null, lastServe: null,
            touchN: 0, touchEvT: 0, lastW: 0, lastH: 0, lastRing: -2, lastCue: false, dead: false };
  var el = {};
  // estadística/diagnóstico (VB.Input._debug(): pruebas táctiles y de mando con eventos reales vía DevTools)
  var stats = { press: { hit: 0, jump: 0, sw: 0, pause: 0, set: 0 }, out: { hit: 0, jump: 0, sw: 0, pause: 0, confirm: 0, chal: 0, jset: 0 }, mouse: { hit: 0, jump: 0, jset: 0 }, slide: 0, lost: 0, adopt: 0,
                promote: 0, resets: 0, padLost: 0, padPause: 0 };
  // punteros táctiles activos: pointerId -> { role:'joy'|'hit'|'jump'|'sw'|'pause'|'set'|'none', x, y, touch }
  var ptrs = {}, nPtr = 0, cnt = { hit: 0, jump: 0, sw: 0, pause: 0, set: 0 };
  // geometría de los botones relativa al overlay (círculos) y zonas seguras (notch) en px
  var GEO = { hit: { cx: 0, cy: 0, r: 0 }, jump: { cx: 0, cy: 0, r: 0 }, sw: { cx: 0, cy: 0, r: 0 }, pause: { cx: 0, cy: 0, r: 0 }, set: { cx: 0, cy: 0, r: 0 }, ok: false, at: -99, w: 0, h: 0, rl: 0, rt: 0, rw: 0, rh: 0 };
  var SA = { t: 0, r: 0, b: 0, l: 0 };
  // 'set' = COLOCAR: contextual, solo se ve (y solo se puede pulsar) en el aire con el balón jugable (sim jsetReady)
  var ROLES = ['hit', 'jump', 'sw', 'pause', 'set'];
  var CSS = '' +
    '#touch{position:absolute;inset:0;pointer-events:none;z-index:5;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:opacity .15s ease-out}' +
    // BALÓN MUERTO (entre el punto y el saque siguiente): todo el overlay baja al 25 % y deja ver el plano de reacción;
    // vuelve en 150 ms al llegar el saque. Las zonas de pulsación siguen activas (sin latencia añadida).
    '#touch.dead{opacity:.25;transition:opacity .3s ease-in}' +
    '#touch.on{pointer-events:auto;touch-action:none}' +
    '.vt-zone{position:absolute;left:0;top:0;bottom:0;width:50%;touch-action:none}' +
    '.vt-joy{position:absolute;left:0;top:0;pointer-events:none;transition:opacity .25s}' +
    '.vt-base{position:absolute;width:var(--d);height:var(--d);margin:calc(var(--d)/-2) 0 0 calc(var(--d)/-2);border-radius:50%;' +
      'background:radial-gradient(circle,rgba(6,10,18,.30) 0 55%,rgba(6,10,18,.62) 56% 100%);border:2px solid rgba(255,255,255,.6);' +
      'box-shadow:0 6px 24px rgba(0,0,0,.35),inset 0 0 18px rgba(0,0,0,.25)}' +
    '.vt-base::before,.vt-base::after{content:"";position:absolute;left:50%;top:50%;width:0;height:0;border:6px solid transparent;opacity:.45}' +
    '.vt-base::before{border-bottom:8px solid #fff;margin:calc(var(--d)/-2 + 5px) 0 0 -6px}' +
    '.vt-base::after{border-top:8px solid #fff;margin:calc(var(--d)/2 - 19px) 0 0 -6px}' +
    '.vt-knob{position:absolute;width:var(--k);height:var(--k);margin:calc(var(--k)/-2) 0 0 calc(var(--k)/-2);border-radius:50%;' +
      'background:radial-gradient(circle at 35% 30%,#fff 0,#e9eef5 35%,#aab7c7 100%);box-shadow:0 4px 14px rgba(0,0,0,.45);opacity:.9}' +
    '.vt-joy.idle{opacity:.5}.vt-joy.idle .vt-knob{opacity:.55}' +
    // sonda de zonas seguras: su padding = env(safe-area-inset-*) (lo lee readSafe; el joystick no nace bajo el notch)
    '.vt-safe{position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}' +
    '.vt-tip{position:absolute;transform:translate(-50%,0);margin-top:calc(var(--d)/2 + 8px);white-space:nowrap;' +
      'font:700 11px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.16em;color:rgba(255,255,255,.75);text-shadow:0 1px 4px rgba(0,0,0,.6)}' +
    '.vt-joy:not(.idle) .vt-tip{display:none}' +
    '.vt-btn{position:absolute;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#fff;' +
      'font:800 15px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.08em;touch-action:none;' +
      'border:2px solid rgba(255,255,255,.42);box-shadow:0 8px 22px rgba(0,0,0,.4),inset 0 2px 0 rgba(255,255,255,.28),inset 0 -6px 14px rgba(0,0,0,.18);' +
      'opacity:.86;transition:transform .07s ease-out,opacity .25s,box-shadow .2s;text-shadow:0 1px 2px rgba(0,0,0,.35)}' +
    '.vt-btn svg{width:34%;height:auto;display:block;pointer-events:none}' +
    '.vt-btn span{pointer-events:none}' +
    '.vt-btn.dn{transform:scale(.88);opacity:1;filter:brightness(1.12)}' +
    // en reposo (sin tocar ~1,4 s) los botones se encogen un poco y bajan a .55: dejan ver el juego; con un jugador
    // detrás, más transparentes (.3). Al tocar o al brillar (.ready) vuelven enseguida.
    '#touch.idle .vt-btn:not(.dn):not(.ready):not(.cue):not(.off){opacity:.55;transform:scale(.94)}#touch.idle .vt-btn.off{transform:scale(.94)}' +
    '#touch .vt-btn.see:not(.dn):not(.ready):not(.cue):not(.off){opacity:.3}' +
    // ⇄ es pequeño: en reposo se queda legible (disco oscuro >= 3:1 sobre un suelo gris medio)
    '#touch.idle .vt-btn.vt-sw:not(.dn):not(.ready):not(.cue):not(.off):not(.see){opacity:.82}' +
    '#touch.idle .vt-btn.see:not(.dn):not(.ready):not(.cue):not(.off){opacity:.26}' +
    '.vt-hit{width:104px;height:104px;right:calc(22px + env(safe-area-inset-right));bottom:calc(26px + env(safe-area-inset-bottom));' +
      // (UI-19: paradas más oscuras; rótulo blanco de 15 px >= 4,5:1 en el centro del botón)
      'background:radial-gradient(circle at 40% 30%,#ec7444,#c9441a 55%,#a8300e)}' +
    '.vt-hit.ready{box-shadow:0 0 0 4px rgba(255,210,63,.85),0 0 28px rgba(255,190,60,.75),0 8px 22px rgba(0,0,0,.4),inset 0 2px 0 rgba(255,255,255,.28);opacity:1}' +
    // aro que se CIERRA sobre GOLPEAR/SACAR (como el aro amarillo de la pista): toca el borde del botón en el instante
    // ideal de pulsar; el brillo (.ready) se enciende ~0,24 s antes, a tiempo para reaccionar con el pulgar
    '.vt-ring{position:absolute;left:-5px;top:-5px;right:-5px;bottom:-5px;border-radius:50%;border:3px solid rgba(255,214,70,.95);' +
      'box-shadow:0 0 10px rgba(255,190,60,.55);opacity:0;pointer-events:none;will-change:transform,opacity}' +
    '.vt-hit.cue{opacity:1}' +
    // arco con >= 16 px entre botones: SALTAR a la izquierda y algo más abajo que GOLPEAR; CAMBIAR (⇄) arriba a la
    // derecha de GOLPEAR, fuera del recorrido del pulgar de SALTAR a GOLPEAR (antes estaba encima de SALTAR a 8 px)
    '.vt-jump{width:78px;height:78px;right:calc(150px + env(safe-area-inset-right));bottom:calc(14px + env(safe-area-inset-bottom));' +
      'background:radial-gradient(circle at 40% 30%,#6a9cf5,#2c62e0 55%,#1d4bbf);font-size:13px}' +
    // DESACTIVADO (SALTAR y ⇄ en el saque): borde discontinuo, sin relieve ni color, icono atenuado y un candado pequeño
    '.vt-jump.off,.vt-sw.off{opacity:.62;border-style:dashed;border-color:rgba(255,255,255,.6);box-shadow:none;filter:saturate(.15) brightness(.8)}' +
    '.vt-jump.off{background:radial-gradient(circle at 40% 30%,rgba(90,110,140,.55),rgba(30,40,58,.6))}' +
    '.vt-btn.off svg,.vt-btn.off span{opacity:.5}' +
    '.vt-btn.off::before{content:"";position:absolute;right:12%;top:9%;width:7px;height:6px;margin-top:-5px;border:2px solid #dfe6ef;border-bottom:0;border-radius:5px 5px 0 0;box-sizing:border-box}' +
    '.vt-btn.off::after{content:"";position:absolute;right:calc(12% - 1px);top:9%;width:9px;height:7px;border-radius:2px;background:#dfe6ef;box-shadow:0 0 0 1.5px rgba(8,13,22,.85)}' +
    '.vt-sw{width:50px;height:50px;right:calc(14px + env(safe-area-inset-right));bottom:calc(152px + env(safe-area-inset-bottom));' +
      'background:rgba(8,13,22,.78);border-color:rgba(255,255,255,.62);font-size:10px;letter-spacing:.1em}' +
    '.vt-sw svg{width:46%}' +
    // COLOCAR (colocación en salto): encima de SALTAR, lejos del joystick y de GOLPEAR; aparece al despegar con el balón
    // jugable y se va al caer (visibility: la geometría medida sigue valiendo). Hueco con SALTAR: 12 px medidos en pantallas
    // bajas (844×390, 667×375: 56 px CSS por max-height:420); los márgenes de toque (12 y 16 px) se tocan a propósito para
    // poder deslizar el dedo de SALTAR a COLOCAR
    '.vt-set{width:64px;height:64px;right:calc(157px + env(safe-area-inset-right));bottom:calc(110px + env(safe-area-inset-bottom));' +
      'background:radial-gradient(circle at 40% 30%,#3fd6a4,#13946d 55%,#0c7556);font-size:11px;visibility:hidden;opacity:0;transform:scale(.7);' +
      'transition:opacity .1s,transform .1s,visibility 0s .1s}' +
    '.vt-set.on{visibility:visible;opacity:1;transform:scale(1);transition:opacity .1s,transform .1s}' +
    '.vt-set.on.dn{transform:scale(.88)}' +
    '.vt-pause{width:46px;height:46px;right:calc(14px + env(safe-area-inset-right));top:calc(14px + env(safe-area-inset-top));' +
      'background:rgba(8,13,22,.66);border-color:rgba(255,255,255,.3)}' +
    '.vt-pause svg{width:40%}' +
    '@media (max-height:420px){.vt-hit{width:90px;height:90px;bottom:calc(16px + env(safe-area-inset-bottom))}' +
      '.vt-jump{width:68px;height:68px;right:calc(134px + env(safe-area-inset-right));bottom:calc(8px + env(safe-area-inset-bottom))}' +
      '.vt-sw{width:44px;height:44px;right:calc(14px + env(safe-area-inset-right));bottom:calc(128px + env(safe-area-inset-bottom))}' +
      '.vt-set{width:56px;height:56px;right:calc(140px + env(safe-area-inset-right));bottom:calc(92px + env(safe-area-inset-bottom))}' +
      '.vt-pause{width:40px;height:40px}}' +
    '@media (max-height:340px){.vt-hit{width:78px;height:78px}.vt-jump{width:60px;height:60px;right:calc(120px + env(safe-area-inset-right))}' +
      '.vt-sw{right:calc(12px + env(safe-area-inset-right));bottom:calc(118px + env(safe-area-inset-bottom))}' +
      '.vt-set{width:52px;height:52px;right:calc(124px + env(safe-area-inset-right));bottom:calc(84px + env(safe-area-inset-bottom))}}';

  var ICON_HIT = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5c-2.6 3-2.6 14 0 17M4.2 9.2c4.2 1.6 11.4 1.6 15.6 0M5.5 17c3.5-2.4 9.5-2.4 13 0"/></svg>';
  var ICON_JUMP = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13l6-6 6 6M6 19l6-6 6 6"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="#fff"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></svg>';
  var ICON_SET = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18c1.5-8 11-11 16-6"/><path d="M15.5 8.5l4.5 3.5-4 3"/></svg>';
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
      '<div class="vt-btn vt-hit" role="button" aria-label="Golpear">' + ICON_HIT + '<span>GOLPEAR</span><i class="vt-ring"></i></div>' +
      '<div class="vt-btn vt-set" role="button" aria-label="Colocar en salto" aria-hidden="true">' + ICON_SET + '<span>COLOCAR</span></div>' +
      '<div class="vt-btn vt-pause" role="button" aria-label="Pausa">' + ICON_PAUSE + '</div><div class="vt-safe"></div>';
    el.root = rootEl; el.zone = rootEl.querySelector('.vt-zone'); el.joy = rootEl.querySelector('.vt-joy');
    el.base = rootEl.querySelector('.vt-base'); el.knob = rootEl.querySelector('.vt-knob');
    el.hit = rootEl.querySelector('.vt-hit'); el.hitLabel = el.hit.querySelector('span'); el.ring = el.hit.querySelector('.vt-ring');
    el.jump = rootEl.querySelector('.vt-jump'); el.pause = rootEl.querySelector('.vt-pause'); el.sw = rootEl.querySelector('.vt-sw');
    el.safe = rootEl.querySelector('.vt-safe'); el.set = rootEl.querySelector('.vt-set');

    // GESTOR ÚNICO DE PUNTEROS sobre todo el overlay (no un listener por botón): cada dedo tiene un papel.
    // - Dedo que nace sobre un botón (círculo + margen de 16 px en GOLPEAR/SALTAR para dedos gordos) -> ese botón.
    // - Dedo en la mitad izquierda (y fuera de los botones) -> joystick flotante; un 2.º dedo allí espera y, si el
    //   del joystick se levanta, lo hereda (sin soltar y volver a poner).
    // - DESLIZAR entre GOLPEAR y SALTAR (o desde una zona vacía de la derecha) pulsa el botón al que se llega
    //   (salto + remate de un solo gesto). Salir de un botón a zona vacía lo mantiene pulsado (perdona el pulgar).
    // - pointercancel / lostpointercapture / dedo "perdido" (touchend sin pointerup) liberan; ver poll().
    rootEl.addEventListener('pointerdown', onPtrDown, { passive: false });
    rootEl.addEventListener('pointermove', onPtrMove, { passive: false });
    rootEl.addEventListener('pointerup', onPtrEnd);
    rootEl.addEventListener('pointercancel', onPtrEnd);
    rootEl.addEventListener('lostpointercapture', onPtrEnd);
    // nada de zoom / scroll / menú contextual sobre los controles
    rootEl.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    rootEl.addEventListener('contextmenu', function (e) { if (e.cancelable) e.preventDefault(); });
    rootEl.addEventListener('dblclick', function (e) { if (e.cancelable) e.preventDefault(); });
    try { document.addEventListener('gesturestart', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false }); } catch (_) { }
    // Overlay OCULTO (se jugaba con mando/teclado) en un equipo táctil: el 1.er dedo no se pierde. Sin esto, el dedo
    // cae en el canvas (que lo captura implícitamente), el overlay vuelve un frame después y ni el toque en GOLPEAR
    // cuenta ni el dedo de la izquierda llega a ser joystick. Aquí (fase de captura) se muestra el overlay al
    // instante, se le pasa el dedo y el overlay lo captura.
    window.addEventListener('pointerdown', onHiddenDown, { capture: true, passive: false });
    layoutTouch();
    placeJoy();
  }
  function localXY(e) {
    // origen del overlay cacheado en measure() (se invalida al cambiar el tamaño): sin DOMRect por pointermove
    if (!GEO.ok || GEO.w !== (ctx.width | 0) || GEO.h !== (ctx.height | 0)) measure();
    if (GEO.ok) { LXY.x = e.clientX - GEO.rl; LXY.y = e.clientY - GEO.rt; LXY.w = GEO.rw; LXY.h = GEO.rh; return LXY; }
    var r = el.root.getBoundingClientRect();
    LXY.x = e.clientX - r.left; LXY.y = e.clientY - r.top; LXY.w = r.width; LXY.h = r.height;
    return LXY;
  }
  var LXY = { x: 0, y: 0, w: 0, h: 0 };
  /** Botón bajo (x, y): el más "hondo" de los que tocan (distancia al borde del círculo), con margen. */
  function hitTest(x, y) {
    if (!GEO.ok || GEO.w !== (ctx.width | 0) || GEO.h !== (ctx.height | 0)) measure();
    var best = null, bd = 1e9;
    for (var i = 0; i < ROLES.length; i++) {
      var k = ROLES[i], g = GEO[k]; if (g.r <= 0 || (k === 'set' && !T.setOn)) continue;
      var d = Math.hypot(x - g.cx, y - g.cy) - g.r, slop = (k === 'hit' || k === 'jump') ? 16 : k === 'set' ? 12 : 8;
      if (d < slop && d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function press(role) {
    cnt[role]++; T[role] = true; stats.press[role]++;
    if (cnt[role] === 1) el[role].classList.add('dn');
    // SACAR pulsado para lanzar: el brillo del silbato se apaga YA (si no, sigue un frame con el balón lanzado y
    // parece la señal de golpear)
    if (role === 'hit' && T.lastReady && T.lastLabel === 'SACAR') { T.lastReady = false; el.hit.classList.remove('ready'); }
    T.hitDown = cnt.hit > 0; T.jumpDown = cnt.jump > 0;
  }
  function release(role) {
    if (cnt[role] > 0) cnt[role]--;
    if (cnt[role] === 0) el[role].classList.remove('dn');
    T.hitDown = cnt.hit > 0; T.jumpDown = cnt.jump > 0;
  }
  function joyStart(id, x, y) {
    T.joy = id; T.ox = x; T.oy = y; T.jx = T.jy = 0;
    clampJoy();
    placeJoy();
  }
  /** Que la base del joystick no quede medio fuera ni bajo el notch / la barra de gestos. */
  function clampJoy() {
    var W = ctx.width || 800, H = ctx.height || 400, R = T.R;
    if (W > R * 3 && H > R * 3) {
      T.ox = Math.min(Math.max(SA.l + R + 8, T.ox), W * 0.62);
      T.oy = Math.min(Math.max(SA.t + R + 8, T.oy), H - SA.b - R - 8);
    }
  }
  function joyMove(x, y) {
    var dx = x - T.ox, dy = y - T.oy, l = Math.hypot(dx, dy), R = T.R;
    if (l > R) {
      // la base sigue al dedo, pero sin salir de su zona (<= 62 % del ancho, fuera del notch): nunca se mete bajo
      // SALTAR/GOLPEAR. Si el dedo se pasa, el mando sigue a fondo en esa dirección (el pomo se queda en el borde).
      T.ox += dx * (1 - R / l); T.oy += dy * (1 - R / l); clampJoy();
      dx = x - T.ox; dy = y - T.oy; l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
    }
    T.jx = dx; T.jy = dy; placeJoy();
  }
  function onPtrDown(e, adopted) {
    if (!T.shown) return;
    if (e.cancelable) e.preventDefault();
    if (!adopted) e.stopPropagation();
    T.used = true; it.device = 'touch'; T.lastTouch = nowS();
    var id = e.pointerId, q = localXY(e), x = q.x, y = q.y;
    if (ptrs[id]) endPtr(id);                       // (id reutilizado sin pointerup: se cierra el anterior)
    var role = hitTest(x, y);
    if (!role) role = (x < q.w * 0.5 && T.joy === null) ? 'joy' : 'none';
    ptrs[id] = { role: role, x: x, y: y, touch: e.pointerType === 'touch' }; nPtr++;
    if (role === 'joy') joyStart(id, x, y); else if (role !== 'none') press(role);
    try { el.root.setPointerCapture(id); } catch (_) { }
  }
  function onHiddenDown(e) {
    if (T.shown || e.pointerType !== 'touch' || !ctx || ctx.state !== 'playing' || ctx.portraitBlock || !el.root) return;
    var tg = e.target;
    // los controles de la propia UI (pausa del HUD, avisos con botón...) siguen recibiendo su toque
    if (tg && tg.closest && tg.closest('button,a,input,select,textarea,[role="button"],[data-ui]')) return;
    T.used = true; it.device = 'touch';
    setShown(true);
    onPtrDown(e, true);
  }
  function onPtrMove(e) {
    var id = e.pointerId, p = ptrs[id];
    if (!p) {
      // dedo que ya estaba puesto cuando se reinició el overlay (giro, pérdida de foco): en la mitad izquierda
      // se adopta como joystick desde donde está (no hace falta levantarlo). Sobre los botones NO (pulsaría solo).
      if (!T.shown || e.pointerType !== 'touch' || T.joy !== null || !(e.buttons & 1)) return;
      var q0 = localXY(e);
      if (q0.x >= q0.w * 0.5 || hitTest(q0.x, q0.y)) return;
      ptrs[id] = { role: 'joy', x: q0.x, y: q0.y, touch: true }; nPtr++; stats.adopt++;
      joyStart(id, q0.x, q0.y);
      try { el.root.setPointerCapture(id); } catch (_) { }
      return;
    }
    if (e.cancelable) e.preventDefault();
    var q = localXY(e); p.x = q.x; p.y = q.y; T.lastTouch = nowS();
    if (p.role === 'joy') { joyMove(q.x, q.y); return; }
    if (p.role === 'hit' || p.role === 'jump' || p.role === 'set' || p.role === 'none') {
      var r2 = hitTest(q.x, q.y);
      if ((r2 === 'hit' || r2 === 'jump' || r2 === 'set') && r2 !== p.role) {   // (deslizar de SALTAR a COLOCAR: salta y coloca)
        if (p.role !== 'none') release(p.role);
        p.role = r2; press(r2); stats.slide++;
      }
    }
  }
  function onPtrEnd(e) { endPtr(e.pointerId); }
  function endPtr(id) {
    var p = ptrs[id]; if (!p) return;
    delete ptrs[id]; nPtr--;
    if (p.role === 'joy') {
      T.joy = null; T.jx = T.jy = 0;
      // otro dedo esperando en la mitad izquierda: hereda el joystick desde donde está
      for (var k in ptrs) {
        var o = ptrs[k];
        if (o.role === 'none' && o.x < (ctx.width || 800) * 0.5 && !hitTest(o.x, o.y)) { o.role = 'joy'; stats.promote++; joyStart(+k, o.x, o.y); break; }
      }
      placeJoy();
    } else if (p.role !== 'none') release(p.role);
  }
  /** Lee las zonas seguras (env(safe-area-inset-*)) de la sonda. */
  function readSafe() {
    if (!el.safe) return;
    try {
      var cs = getComputedStyle(el.safe);
      SA.t = parseFloat(cs.paddingTop) || 0; SA.r = parseFloat(cs.paddingRight) || 0;
      SA.b = parseFloat(cs.paddingBottom) || 0; SA.l = parseFloat(cs.paddingLeft) || 0;
    } catch (_) { }
  }
  /** Mide los botones (círculos relativos al overlay) y los rectángulos de oclusión. Solo con el overlay visible. */
  function measure() {
    if (!el.root || el.root.hidden) return;
    readSafe();   // (el notch cambia con el giro y algunos navegadores lo actualizan sin resize)
    var rr = el.root.getBoundingClientRect();
    T.rects = T.rects || [{}, {}, {}];
    for (var i = 0; i < ROLES.length; i++) {
      var k = ROLES[i], b = el[k].getBoundingClientRect(), g = GEO[k];
      g.cx = (b.left + b.right) / 2 - rr.left; g.cy = (b.top + b.bottom) / 2 - rr.top; g.r = Math.min(b.width, b.height) / 2;
      if (i < 3) { var o = T.rects[i]; o.l = b.left - rr.left - 6; o.r = b.right - rr.left + 6; o.t = b.top - rr.top - 6; o.b = b.bottom - rr.top + 6; }
    }
    GEO.rl = rr.left; GEO.rt = rr.top; GEO.rw = rr.width; GEO.rh = rr.height;
    GEO.ok = true; GEO.at = ctx.frame || 0; GEO.w = ctx.width | 0; GEO.h = ctx.height | 0; T.rectAt = GEO.at;
  }
  /** Tamaño del joystick según la pantalla. */
  function layoutTouch() {
    if (!el.root || !ctx) return;
    var h = ctx.height || window.innerHeight || 400, w = ctx.width || window.innerWidth || 800;
    T.R = Math.round(Math.max(42, Math.min(66, Math.min(w, h) * 0.15)));
    el.joy.style.setProperty('--d', (T.R * 2) + 'px');
    el.joy.style.setProperty('--k', Math.round(T.R * 0.9) + 'px');
    readSafe();
  }
  /** Joystick: donde está el dedo o, en reposo, una guía tenue abajo a la izquierda (fuera del notch). */
  function placeJoy() {
    if (!el.joy) return;
    var on = T.joy !== null, x, y;
    if (on) { x = T.ox; y = T.oy; }
    else {
      var h = ctx && ctx.height ? ctx.height : 400;
      x = SA.l + T.R + 34; y = h - SA.b - T.R - 30;
    }
    el.joy.classList.toggle('idle', !on);
    el.joy.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    el.knob.style.transform = on ? 'translate(' + T.jx + 'px,' + T.jy + 'px)' : '';
  }
  function nowS() { return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000; }
  /** Reposo y transparencia por oclusión: si el jugador que llevas o tu compañero quedan detrás de un botón, el
   *  botón se vuelve casi transparente (la cámara ya intenta que no pase; esto cubre lo que queda). */
  var pv3 = null, BTN_KEYS = ['hit', 'jump', 'sw'];
  function touchVisibility() {
    var t = nowS();
    var idle = T.joy === null && !T.hitDown && !T.jumpDown && t - T.lastTouch > 1.4;
    if (idle !== T.idle) { T.idle = idle; el.root.classList.toggle('idle', idle); }
    var g = ctx.game, cam = ctx.camera;
    if (!g || !g.ctrl || !cam || !ctx.THREE || !VB.toThree) return;
    // (oclusión 1 de cada 3 frames: es un fundido de opacidad de .25 s; ahorra 4 proyecciones por frame en móvil)
    if ((ctx.frame || 0) % 3 !== 0 && T.rects) return;
    if (!pv3) pv3 = new ctx.THREE.Vector3();
    // rectángulos de los botones relativos al overlay (se recalculan cada ~0,5 s o al cambiar el tamaño)
    if (!T.rects || !GEO.ok || ctx.frame - T.rectAt > 30 || ctx.frame < T.rectAt) measure();
    if (!T.rects) return;
    var W = ctx.width || 1, H = ctx.height || 1, tm = g.teams[0], hitAny0 = false, hitAny1 = false, hitAny2 = false;
    for (var k = 0; k < tm.length; k++) {
      var q = tm[k];
      for (var zz = 0; zz < 2; zz++) {   // pecho y cadera
        VB.toThree(q.x, q.y, q.z + (zz ? 0.9 : 1.35), pv3); pv3.project(cam);
        if (pv3.z > 1) continue;
        var px = (pv3.x + 1) / 2 * W, py = (1 - pv3.y) / 2 * H, R = T.rects;
        if (px > R[0].l && px < R[0].r && py > R[0].t && py < R[0].b) hitAny0 = true;
        if (px > R[1].l && px < R[1].r && py > R[1].t && py < R[1].b) hitAny1 = true;
        if (px > R[2].l && px < R[2].r && py > R[2].t && py < R[2].b) hitAny2 = true;
      }
    }
    if (hitAny0 !== T.see[0]) { T.see[0] = hitAny0; el.hit.classList.toggle('see', hitAny0); }
    if (hitAny1 !== T.see[1]) { T.see[1] = hitAny1; el.jump.classList.toggle('see', hitAny1); }
    if (hitAny2 !== T.see[2]) { T.see[2] = hitAny2; el.sw.classList.toggle('see', hitAny2); }
  }
  /** Muestra / oculta el overlay táctil. */
  function setShown(show) {
    T.shown = show; el.root.hidden = !show; el.root.classList.toggle('on', show);
    if (!show) resetTouch(); else { layoutTouch(); placeJoy(); T.rects = null; GEO.ok = false; T.lastTouch = nowS(); }
  }
  /** Suelta TODO (dedos, joystick, botones). Pérdida de foco, pestaña oculta, giro, overlay oculto. */
  function resetTouch() {
    for (var k in ptrs) delete ptrs[k];
    nPtr = 0; T.joy = null; T.jx = T.jy = 0; T.hitDown = T.jumpDown = false; stats.resets++;
    for (var i = 0; i < ROLES.length; i++) { cnt[ROLES[i]] = 0; if (el[ROLES[i]]) el[ROLES[i]].classList.remove('dn'); }
    placeJoy();
  }
  /** Dedos "perdidos": el sistema se comió el pointerup (gesto del SO, notificación, iOS al cambiar de app…).
   *  Si los touch events dicen que no queda ningún dedo en pantalla y aún hay punteros táctiles vivos, fuera. */
  function sweepLost() {
    if (nPtr <= 0 || T.touchN > 0 || nowS() - T.touchEvT < 0.12) return;
    var any = false;
    for (var k in ptrs) if (ptrs[k].touch) { any = true; endPtr(+k); }
    if (any) stats.lost++;
  }
  function onTouchList(e) { T.touchN = e.touches ? e.touches.length : 0; T.touchEvT = nowS(); }

  // salida propia para hitWindow (no pisa el objeto compartido de sim que usan otros módulos en el mismo frame)
  // brillo de GOLPEAR/SACAR: de 0,24 s ANTES del instante ideal de pulsar a 0,15 s DESPUÉS (~0,4 s encendido: un
  // pulgar algo lento aún llega, tarde pero con golpe; apagarlo justo en el ideal hacía que no se pulsara nunca)
  var CUE_ON = 0.24, CUE_OFF = -0.15;
  var HWO = { t: 0, press: 0, d: 9, dz: 9, reach: false, kind: '', zc: 0, x: 0, y: 0, z: 0, active: false, canReach: false, attack: false, jumpT: NaN };
  /** Estado contextual de los botones (SACAR en tu saque, brillo y aro en el momento de golpear). */
  function touchContext() {
    var g = ctx.game; if (!g || !el.hit) return;
    // (también durante el plano corto del sacador rival, CAM-14: no se puede hacer nada hasta su lanzamiento; vuelve con el corte)
    var CRs = VB.CameraRig, cwy = false;
    if (CRs && CRs.getShot && g.mode === 'serve') { try { cwy = CRs.getShot() === 'cutaway'; } catch (e) { cwy = false; } }
    var dead = !g.demo && (g.mode === 'point' || g.mode === 'over' || cwy);
    if (dead !== T.dead) { T.dead = dead; el.root.classList.toggle('dead', dead); }
    // nuestro saque: sacador humano, tanto con el balón en la mano ('ready') como lanzado ('toss')
    var sv = g.server || (g.ball && g.ball.held) || null;
    var myServe = g.mode === 'serve' && !!sv && sv.team === 0 && !g.demo && !g.autopilot && (g.ctrlMode !== 'one' || sv === g.ctrl);
    // modo «controlar 1 jugador» (sim g.ctrlMode 'one'): no hay cambio de jugador, fuera el botón ⇄
    var swHide = g.ctrlMode === 'one';
    if (swHide !== T.swHide) { T.swHide = swHide; el.sw.style.display = swHide ? 'none' : ''; }
    var tossing = myServe && g.serveState === 'toss';
    var label = myServe ? 'SACAR' : 'GOLPEAR';
    if (label !== T.lastLabel) { T.lastLabel = label; el.hitLabel.textContent = label; el.hit.setAttribute('aria-label', label === 'SACAR' ? 'Sacar' : 'Golpear'); }
    // Señal de golpeo con el MISMO reloj que el aro amarillo de la pista (fx.js): hitWindow().press = s hasta el
    // instante ideal de PULSAR. El brillo se enciende con press en (CUE_OFF = -0,15, CUE_ON = 0,24): visto el brillo, un pulgar humano
    // (~0,2 s de reacción + latencia táctil) llega en la ventana buena/perfecta. Antes se encendía con canReach(), una
    // media de 0,05 s antes del instante ideal: siempre tarde (golpes malos, "le da en el cuerpo"). Y un aro que se
    // cierra sobre el botón desde press 0,75 permite anticiparse en vez de reaccionar.
    var ready = false, press = NaN, S = VB.Sim;
    if (g.mode === 'rally' && g.ctrl && S && S.hitWindow) {
      var p = g.ctrl, mine = !!(g.jobs && g.jobs[0] === p), reach = false;
      if (!mine && S.canReach) { try { reach = !!S.canReach(g, p); } catch (_) { reach = false; } }
      // en el aire junto a la red con el remate rival aún en su lado: es un bloqueo (automático), no un golpe
      var block = g.touchTeam !== 0 && p.z > 0.2 && Math.abs(p.x) < 1.8 && g.ball && g.ball.x <= 0.3;
      if ((mine || reach) && !block) {
        try { var hw = S.hitWindow(g, p, HWO); if (hw && isFinite(hw.press)) press = hw.press; } catch (_) { press = NaN; }
      }
    }
    else if (myServe && !tossing) ready = g.serveAuth !== false && !T.hitDown; // tras el silbato ya se puede lanzar
    else if (tossing && S && S.hitWindow) {                                   // balón en el aire: el mismo reloj
      try { var w = S.hitWindow(g, sv, HWO); if (w && isFinite(w.press)) press = w.press; } catch (_) { press = NaN; }
    }
    if (press === press) ready = press > CUE_OFF && press < CUE_ON;
    // aro: escala 1,8 -> 1 entre press 0,75 y 0 (cuantizado a 1/100: sin escribir estilos si no cambia)
    var rk = press === press && press > -0.06 && press < 0.75 ? Math.round(Math.max(0, press) / 0.75 * 80) : -1;
    if (rk !== T.lastRing) {
      T.lastRing = rk;
      if (el.ring) {
        if (rk < 0) el.ring.style.opacity = '0';
        else { el.ring.style.opacity = (0.45 + 0.55 * (1 - rk / 80)).toFixed(2); el.ring.style.transform = 'scale(' + (1 + rk / 100).toFixed(2) + ')'; }
      }
      var cue = rk >= 0;
      if (cue !== T.lastCue) { T.lastCue = cue; el.hit.classList.toggle('cue', cue); }
    }
    if (ready !== T.lastReady) { T.lastReady = ready; el.hit.classList.toggle('ready', ready); }
    // SALTAR: en nuestro saque (antes de lanzar) es el saque en salto; en el resto del saque, apagado
    var jumpOff = g.mode === 'serve' && !(myServe && !tossing);
    var swOff = g.mode === 'serve';
    var key = (jumpOff ? 1 : 0) + (swOff ? 2 : 0);
    if (key !== T.lastServe) { T.lastServe = key; el.jump.classList.toggle('off', jumpOff); el.sw.classList.toggle('off', swOff); }
    // COLOCAR: solo en el aire con el balón jugable para una colocación en salto (sim jsetReady); al caer, fuera
    var setOn = false;
    if (S && S.jsetReady) { try { setOn = !!S.jsetReady(g); } catch (_) { setOn = false; } }
    if (setOn !== T.setOn) { T.setOn = setOn; el.set.classList.toggle('on', setOn); el.set.setAttribute('aria-hidden', setOn ? 'false' : 'true'); }
  }

  // ---------------- Vibración ----------------
  function rumbleOff() { var st = ctx && ctx.settings; return !!(st && st.rumble === false); }   // Ajustes > Vibración (UI-16)
  function actuator() {
    if (it.device !== 'gamepad' || pad.idx < 0) return null;
    var pads = navigator.getGamepads ? navigator.getGamepads() : null, p = pads && pads[pad.idx];
    var va = p && p.vibrationActuator;
    return va && va.playEffect ? va : null;
  }
  function pulse(va, ms, strong, weak) {
    var r = va.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) });
    if (r && r.catch) r.catch(function () { });
  }
  /** Sin un gesto previo en la página Chrome bloquea navigator.vibrate y deja un error en la consola: no lo intentamos. */
  function canVibrate() { var ua = navigator.userActivation; return !!navigator.vibrate && !(ua && !ua.hasBeenActive); }
  function rumble(strength, ms) {
    if (rumbleOff()) return;
    strength = Math.max(0, Math.min(1, strength || 0.5)); ms = Math.max(10, Math.min(250, ms || 60));
    try {
      var va = actuator();
      if (va) pulse(va, ms, strength, strength * 0.6);
      else if (it.device === 'touch' && canVibrate()) navigator.vibrate(Math.round(8 + strength * 14));
    } catch (e) { }
  }
  /* FIRMAS de vibración: el pulgar distingue la calidad del toque sin mirar.
   * Cada pulso [inicio ms, duración ms, motor fuerte (grave), motor débil (agudo)]; en el móvil, patrón de navigator.vibrate.
   * perfect = dos toques secos de 25 ms separados 40 ms · good = un toque de 45 ms · poor = golpe sordo y largo (grave) ·
   * body = pulso corto y grave · won = doble pulso · lost = uno flojo · match = tres pulsos crecientes · kill / block = golpe pleno. */
  var SIG = {
    perfect: { pad: [[0, 25, 0.55, 1.0], [65, 25, 0.55, 1.0]], vib: [25, 40, 25] },
    good:    { pad: [[0, 45, 0.5, 0.7]], vib: [34] },
    poor:    { pad: [[0, 110, 0.25, 0.04]], vib: [70] },
    body:    { pad: [[0, 40, 0.42, 0.0]], vib: [26] },
    won:     { pad: [[0, 60, 0.6, 0.5], [140, 60, 0.6, 0.5]], vib: [40, 100, 40] },
    lost:    { pad: [[0, 140, 0.3, 0.06]], vib: [60] },
    match:   { pad: [[0, 70, 0.65, 0.5], [160, 70, 0.8, 0.6], [320, 150, 1.0, 0.8]], vib: [50, 110, 50, 110, 130] },
    kill:    { pad: [[0, 90, 0.7, 0.45]], vib: [55] },
    block:   { pad: [[0, 85, 0.85, 0.55]], vib: [55] }
  };
  var sigTimers = [], sigLog = [];
  function rumbleSig(name, k) {
    if (rumbleOff()) return;
    var s = SIG[name]; if (!s) return;
    k = Math.max(0.2, Math.min(1.5, +k || 1));
    try {
      var va = actuator();
      if (va) {
        for (var i = 0; i < sigTimers.length; i++) clearTimeout(sigTimers[i]);   // una firma nueva corta la anterior
        sigTimers.length = 0;
        if (sigLog.length < 64) sigLog.push(name);
        var P = s.pad;
        for (var j = 0; j < P.length; j++) {
          (function (q) {
            if (q[0] <= 0) pulse(va, q[1], q[2] * k, q[3] * k);
            else sigTimers.push(setTimeout(function () { try { var v2 = actuator(); if (v2) pulse(v2, q[1], q[2] * k, q[3] * k); } catch (e) { } }, q[0]));
          })(P[j]);
        }
      } else if (it.device === 'touch' && navigator.vibrate) {
        if (sigLog.length < 64) sigLog.push(name);
        if (canVibrate()) navigator.vibrate(s.vib);
      }
    } catch (e) { }
  }

  VB.Input = {
    init: function (c) {
      ctx = c;
      it.device = ctx.isTouch ? 'touch' : 'keyboard';
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      // ratón (fase de burbuja: el overlay táctil para la propagación de sus punteros y no se duplica el golpe)
      window.addEventListener('pointerdown', onMouse, { passive: false });
      window.addEventListener('pointermove', onMouse, { passive: false });
      window.addEventListener('pointerup', onMouse);
      window.addEventListener('pointercancel', function (e) { if (e.pointerType === 'mouse') { mouseBtn('Mouse0', 'hit', false, e, false); mouseBtn('Mouse2', 'jump', false, e, false); mouseBtn('Mouse1', 'jset', false, e, false); } });
      window.addEventListener('mousedown', onAux, { passive: false });
      window.addEventListener('auxclick', onAux, { passive: false });
      window.addEventListener('contextmenu', onCtxMenu);
      window.addEventListener('blur', function () { clearKeys(); resetTouch(); });
      document.addEventListener('visibilitychange', function () { if (document.hidden) { clearKeys(); resetTouch(); } });
      // un toque en cualquier sitio en un equipo no detectado como táctil activa los controles táctiles;
      // la lista de dedos (e.touches) sirve además para detectar dedos perdidos (ver sweepLost)
      window.addEventListener('touchstart', function (e) { T.used = true; it.device = 'touch'; onTouchList(e); }, { passive: true, capture: true });
      window.addEventListener('touchend', onTouchList, { passive: true, capture: true });
      window.addEventListener('touchcancel', onTouchList, { passive: true, capture: true });
      // giro del móvil con el dedo puesto: el origen del joystick ya no significa nada -> se suelta todo
      var onTurn = function () { resetTouch(); GEO.ok = false; };
      window.addEventListener('orientationchange', onTurn);
      try { if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', onTurn); } catch (_) { }
      window.addEventListener('gamepadconnected', function (e) {
        pad.known = true; pad.event = 'connected';
        if (e.gamepad) seedRest(e.gamepad);   // reposo del stick (deriva) tal y como llega el mando
        if (pad.idx < 0 && e.gamepad) pad.idx = e.gamepad.index;
      });
      window.addEventListener('gamepaddisconnected', function (e) {
        var i = e.gamepad ? e.gamepad.index : -1;
        if (i >= 0) { pad.prev[i] = null; pad.hatOk[i] = false; pad.rest[i] = null; }
        if (i === pad.idx) padLost();
      });
      buildTouch();
    },
    /** Limpia pulsaciones al cambiar de estado (p. ej. el Intro/Espacio que pulsa "Jugar" no saca ni salta). */
    onState: function () { for (var ek in edge) edge[ek] = false; T.hit = T.jump = T.set = T.pause = T.sw = false; T.chal = false; },
    /** OPCIONAL (B4/B7): glifo de texto de una acción para el dispositivo dado ('keyboard'|'gamepad'|'touch'; por defecto el
     *  activo). fam = 'ps' para mandos PlayStation. Hoy solo 'challenge': «V» / «LT» (PS: «L2») / «CHALLENGE». '' si no hay. */
    glyph: function (action, dev, fam) {
      var t = GLYPHS[action]; if (!t) return '';
      var d = dev || it.device || 'keyboard';
      if (d === 'gamepad' && fam === 'ps' && t.ps) return t.ps;
      return t[d] || t.keyboard || '';
    },
    /** OPCIONAL: tabla de glifos { acción: { keyboard, gamepad, ps, touch } } (para el panel de controles). */
    glyphs: function () { return GLYPHS; },
    /** OPCIONAL: pulso de challenge desde fuera (p. ej. un botón táctil propio de la UI): sale en el siguiente poll(). */
    pressChallenge: function () { T.chal = true; },
    resize: function (w, h) {
      w = w || (ctx && ctx.width) || 0; h = h || (ctx && ctx.height) || 0;
      // cambio de orientación (o de tamaño > 30 %) con dedos puestos: se suelta todo. Si solo cambia un poco
      // (barra del navegador que se esconde), el joystick sigue y su base se recoloca dentro de la pantalla.
      if (T.lastW && ((w > h) !== (T.lastW > T.lastH) || Math.abs(w - T.lastW) > 0.3 * T.lastW || Math.abs(h - T.lastH) > 0.3 * T.lastH)) resetTouch();
      T.lastW = w; T.lastH = h;
      layoutTouch(); GEO.ok = false; T.rects = null;
      if (T.joy !== null) clampJoy();
      placeJoy();
    },
    isTouchActive: function () { return T.used || !!(ctx && ctx.isTouch); },
    /** OPCIONAL: los controles táctiles están en pantalla (la cámara aparta el aro de los botones). */
    overlayShown: function () { return T.shown; },
    /** OPCIONAL: vibración corta (mando o móvil). strength 0..1, ms. Nada si ctx.settings.rumble === false. */
    rumble: rumble,
    /** OPCIONAL: vibración con firma ('perfect'|'good'|'poor'|'body'|'won'|'lost'|'match'|'kill'|'block'), k = intensidad 0,2..1,5. */
    rumbleSig: rumbleSig,
    /** OPCIONAL: mando activo { connected, id, mapping ('standard' | '' = heurística) }. */
    padInfo: function () { return { connected: pad.idx >= 0, id: pad.id, mapping: pad.mapping }; },
    /** OPCIONAL (pruebas: tools/touchplay.js, tools/padplay.js, tools/out/ci/*): copia del estado interno. */
    _debug: function () {
      var P = []; for (var k in ptrs) P.push({ id: +k, role: ptrs[k].role, x: Math.round(ptrs[k].x), y: Math.round(ptrs[k].y) });
      return { ptrs: P, joy: T.joy, ox: T.ox, oy: T.oy, jx: T.jx, jy: T.jy, R: T.R, hitDown: T.hitDown, jumpDown: T.jumpDown, shown: T.shown,
               device: it.device, mx: it.mx, my: it.my, safe: { t: SA.t, r: SA.r, b: SA.b, l: SA.l },
               pad: { idx: pad.idx, known: pad.known, id: pad.id, mapping: pad.mapping,
                      rest: pad.idx >= 0 && pad.rest[pad.idx] ? { x: pad.rest[pad.idx].x, y: pad.rest[pad.idx].y } : null },
               geo: JSON.parse(JSON.stringify({ hit: GEO.hit, jump: GEO.jump, sw: GEO.sw, pause: GEO.pause, set: GEO.set })), stats: JSON.parse(JSON.stringify(stats)), setOn: T.setOn,
               sigs: sigLog.slice(), dead: T.dead };
    },
    /** Devuelve las intenciones del frame (objeto reutilizado). */
    poll: function (dt) {
      // --- teclado
      var mx = axis('left', 'right'), my = axis('down', 'up');
      if (mx && my) { mx *= 0.7071; my *= 0.7071; }
      var hit = !!edge.hit, jump = !!edge.jump, jset = !!edge.jset, sw = !!edge['switch'], pause = !!edge.pause, mute = !!edge.mute, confirm = !!edge.confirm;
      var chal = !!edge.challenge || T.chal; T.chal = false;
      var hitHeld = isDown('hit'), jumpHeld = isDown('jump') || isDown('jset');
      for (var ek in edge) edge[ek] = false; // sin asignar un objeto nuevo por frame
      // --- táctil (y de pantalla hacia abajo => my negativo)
      if (nPtr > 0) sweepLost();
      if (T.joy !== null) {
        var jl = Math.hypot(T.jx, T.jy), R = T.R, dz = R * 0.16;
        if (jl > dz) {
          var m = Math.min(1, (jl - dz) / (R * 0.8 - dz));
          m = m * (0.35 + 0.65 * m);                        // curva: precisión cerca del centro, velocidad al fondo
          mx = T.jx / jl * m; my = -T.jy / jl * m;
        }
      }
      hit = hit || T.hit; jump = jump || T.jump; jset = jset || T.set; pause = pause || T.pause; sw = sw || T.sw;
      hitHeld = hitHeld || T.hitDown; jumpHeld = jumpHeld || T.jumpDown;
      T.hit = T.jump = T.set = T.pause = T.sw = false;
      // --- mando
      var p = pollPad();
      if (p) {
        var std = p.mapping === 'standard', nb = p.buttons ? p.buttons.length : 0;
        var map = std ? PB : nb <= 11 ? PB_X : PB_D;
        // stick izquierdo: zona muerta RADIAL 0,18 sobre el desplazamiento desde el REPOSO del mando (deriva), sin
        // cruz muerta en las diagonales, con reescalado (el recorrido útil descuenta la deriva) y curva suave.
        // - Solo pasa a ser el dispositivo activo con el stick > 0,5 (como padActive) o un botón: la deriva no
        //   esconde los controles táctiles ni cambia los glifos.
        // - Sustituye al teclado/dedo solo si el mando ya es el activo o si empuja más (y > 0,26, por encima de la deriva
        //   típica aún no aprendida como reposo): con una flecha pulsada, un stick que deriva no la anula.
        // - Mando sano (reposo dentro de la zona muerta clásica): el stick crudo dentro de 0,18 también es zona
        //   muerta, como siempre (una deriva que cambia de lado tras soltarlo no mueve al jugador).
        var so = stickOffset(p), ax = so.x, ay = so.y, al = Math.hypot(ax, ay);
        var used = false, padIsDev = it.device === 'gamepad';
        var R0 = restOf(pad.idx), rr = Math.hypot(R0.x, R0.y);
        if (al > DZ && (rr >= DZ || Math.hypot(+p.axes[0] || 0, +p.axes[1] || 0) > DZ)) {
          var full = Math.max(0.45, 0.95 - DZ - rr);
          var k = Math.min(1, (al - DZ) / full); k = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
          if (padIsDev || (al > PAD_SOFT && k > Math.hypot(mx, my))) { mx = ax / al * k; my = -ay / al * k; }
          if (al > PAD_ON) used = true;
        }
        // cruceta: botones 12-15 (estándar o mandos que la exponen igual) o eje hat (no estándar)
        var dx = 0, dy = 0;
        if (std || nb >= 16) { dx = (padBtn(p, 15) ? 1 : 0) - (padBtn(p, 14) ? 1 : 0); dy = (padBtn(p, 12) ? 1 : 0) - (padBtn(p, 13) ? 1 : 0); }
        if (!std && !dx && !dy && readHat(p, pad.idx)) { dx = hat.x; dy = hat.y; }
        if (dx || dy) { var dl = Math.hypot(dx, dy); mx = dx / dl; my = dy / dl; used = true; }
        padNow.hit = anyBtn(p, map.hit); padNow.jump = anyBtn(p, map.jump); padNow.jset = anyBtn(p, map.jset); padNow.sw = anyBtn(p, map.sw);
        padNow.pause = anyBtn(p, map.pause); padNow.mute = anyBtn(p, map.mute); padNow.chal = anyBtn(p, map.chal);
        var pv = pad.prev[pad.idx] || (pad.prev[pad.idx] = [false, false, false, false, false, false, false]);   // (una vez por mando)
        if (padNow.hit && !pv[0]) hit = true; if (padNow.jump && !pv[1]) jump = true; if (padNow.sw && !pv[2]) sw = true;
        if (padNow.pause && !pv[3]) pause = true; if (padNow.mute && !pv[4]) mute = true; if (padNow.chal && !pv[5]) chal = true;
        if (padNow.jset && !pv[6]) jset = true;
        if ((padNow.hit && !pv[0]) || (padNow.pause && !pv[3])) confirm = true;
        if (padNow.hit || padNow.jump || padNow.jset || padNow.sw || padNow.pause || padNow.mute || padNow.chal) used = true;
        hitHeld = hitHeld || padNow.hit; jumpHeld = jumpHeld || padNow.jump || padNow.jset;
        pv[0] = padNow.hit; pv[1] = padNow.jump; pv[2] = padNow.sw; pv[3] = padNow.pause; pv[4] = padNow.mute; pv[5] = padNow.chal; pv[6] = padNow.jset;
        if (used) it.device = 'gamepad';
      }
      // mando activo desconectado en pleno partido: pausa (una vez; si ya está en pausa, nada)
      if (pad.pendPause) { pad.pendPause = false; if (ctx.state === 'playing' && !pause) { pause = true; stats.padPause++; } }
      var l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      // COLOCAR también es SALTAR (en el suelo salta; menús, saltar la presentación…): la sim distingue con it.jset en el aire
      if (jset) { jump = true; stats.out.jset++; }
      it.jset = jset;
      it.mx = mx; it.my = my; it.hit = hit; it.jump = jump; it.switchPlayer = sw; it.pause = pause; it.mute = mute;
      it.confirm = confirm; it.hitHeld = hitHeld; it.jumpHeld = jumpHeld; it.challenge = chal;
      it.padEvent = pad.event; pad.event = '';
      it.any = hit || jump || sw || pause || mute || confirm || chal || mx !== 0 || my !== 0;
      if (hit) stats.out.hit++; if (jump) stats.out.jump++; if (sw) stats.out.sw++; if (pause) stats.out.pause++; if (confirm) stats.out.confirm++; if (chal) stats.out.chal++;

      // --- overlay táctil: en partido, en horizontal, si se está jugando con el dedo
      var touchy = T.used || ctx.isTouch;
      var show = touchy && it.device === 'touch' && ctx.state === 'playing' && !ctx.portraitBlock && !(ctx.game && ctx.game.watch);   // (6v6 espectador, g.watch: sin mandos)
      if (show !== T.shown) setShown(show);
      if (show) { touchContext(); touchVisibility(); }
      return it;
    }
  };
})();
