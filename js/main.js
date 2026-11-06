/* =====================================================================
 * VOLEY 3D — js/main.js   (owner: ui_main)
 * Arranque, renderer, bucle con simulación de paso fijo a 120 Hz,
 * reparto de eventos a los módulos, calidad adaptativa (con histéresis)
 * y escenas de depuración deterministas:
 *   ?debug=menu|serve|rally|spike|block|point|ace|setpoint|switch|over|end|
 *          mobile|pause|tutorial|controls|settings
 *   &seed=N  &live=1  &quality=low|medium|high  &maxdt=0.25  &fps=1
 *   &diff=easy|normal|hard  &panel=tut|ctl|set  &step=N (tutorial)
 * Ver CONTRACT.md para el orden por frame y las interfaces.
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var THREE = window.THREE;
  var Sim = VB.Sim;
  // Gestión de color moderna: los colores hex de los materiales se interpretan como sRGB
  // (las texturas de color deben llevar .encoding = THREE.sRGBEncoding).
  if (THREE && THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
  var STEP = 1 / ((VB.C && VB.C.SIM_HZ) || 120);

  // ---------- Parámetros de URL ----------
  var Q = {};
  try { location.search.replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); Q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1)); }); } catch (e) { }

  // dt máximo por frame (s). ?maxdt=0.25 solo para pruebas en entornos lentos (Chrome headless + SwiftShader)
  var MAX_DT = Q.maxdt ? Math.min(0.5, Math.max(0.02, +Q.maxdt || 0.05)) : 0.05;
  var MAX_STEPS = Math.ceil(MAX_DT / STEP) + 2;

  // ---------- Contexto compartido ----------
  var isTouch = false;
  try { isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0); } catch (e) { }
  var isMobile = false;
  try { isMobile = isTouch && Math.min(screen.width || 9999, screen.height || 9999) < 900; } catch (e) { }
  if (Q.debug === 'mobile') { isTouch = true; isMobile = true; }

  var ctx = VB.ctx = {
    THREE: THREE,
    container: document.getElementById('stage'),
    canvas: null, renderer: null, scene: null, camera: null,
    width: 1, height: 1,
    quality: null,              // ver QUALITY
    isTouch: isTouch, isMobile: isMobile,
    state: 'menu',              // 'menu' | 'playing' | 'paused' | 'over'
    game: null,                 // partido actual (VB.Sim.createGame)
    timeScale: 1,               // escala del tiempo de juego (cámara la usa para cámara lenta)
    realDt: 0, gameDt: 0, time: 0, frame: 0, fps: 60,
    debug: Q.debug || null, params: Q, frozen: false,
    portraitBlock: false,       // móvil en vertical durante el partido: se detiene la simulación
    renderFn: null,             // si un módulo (arena) quiere post-proceso, pone aquí function(ctx){...}
    inputDevice: isTouch ? 'touch' : 'keyboard', // último dispositivo usado ('keyboard'|'gamepad'|'touch'), lo lee la UI
    settings: loadSettings(),
    actions: {},                // startMatch, pause, resume, toMenu, restart, setSetting, toggleMute
    // Atajos que implementa la cámara (camera.js). Seguros si no existen.
    shake: function (amount, dur) { if (VB.CameraRig && VB.CameraRig.shake) VB.CameraRig.shake(amount, dur); },
    slowmo: function (scale, realSeconds) { if (VB.CameraRig && VB.CameraRig.slowmo) VB.CameraRig.slowmo(scale, realSeconds); }
  };

  function loadSettings() {
    // camSens: 0.5..1.5 (rapidez de seguimiento de la cámara; la lee camera.js si quiere)
    // sfxVol/musicVol: 0..1 (los lee audio.js en onSettings)
    var s = { muted: false, difficulty: 'normal', quality: 'auto', showHelp: true, camSens: 1, sfxVol: 1, musicVol: 0.75 };
    try { var raw = localStorage.getItem('voley3d.settings'); if (raw) { var o = JSON.parse(raw); for (var k in o) if (k in s && typeof o[k] === typeof s[k]) s[k] = o[k]; } } catch (e) { }
    if (['easy', 'normal', 'hard'].indexOf(s.difficulty) < 0) s.difficulty = 'normal';
    if (['auto', 'high', 'medium', 'low'].indexOf(s.quality) < 0) s.quality = 'auto';
    s.camSens = Math.max(0.5, Math.min(1.5, +s.camSens || 1));
    s.sfxVol = Math.max(0, Math.min(1, isFinite(+s.sfxVol) ? +s.sfxVol : 1));
    s.musicVol = Math.max(0, Math.min(1, isFinite(+s.musicVol) ? +s.musicVol : 0.75));
    if (Q.diff && ['easy', 'normal', 'hard'].indexOf(Q.diff) >= 0) s.difficulty = Q.diff;
    return s;
  }
  function saveSettings() { try { localStorage.setItem('voley3d.settings', JSON.stringify(ctx.settings)); } catch (e) { } }

  // ---------- Calidad ----------
  var QUALITY = {
    high:   { level: 'high',   rank: 2, pixelRatio: 2,   shadowSize: 2048, shadows: true, antialias: true,  crowdDensity: 1 },
    medium: { level: 'medium', rank: 1, pixelRatio: 1.5, shadowSize: 1024, shadows: true, antialias: true,  crowdDensity: 0.7 },
    low:    { level: 'low',    rank: 0, pixelRatio: 1,   shadowSize: 512,  shadows: true, antialias: false, crowdDensity: 0.4 }
  };
  var BY_RANK = [QUALITY.low, QUALITY.medium, QUALITY.high];
  function autoTop() { return isMobile ? QUALITY.medium : QUALITY.high; }
  function pickQuality() {
    var want = Q.quality || ctx.settings.quality;
    if (QUALITY[want]) return QUALITY[want];
    return autoTop();
  }

  // Módulos en orden de inicialización/actualización
  var MODS = ['Arena', 'FX', 'Players', 'CameraRig', 'Input', 'Audio', 'UI'];
  function call(name, fn) {
    var m = VB[name]; if (!m || typeof m[fn] !== 'function') return;
    var args = Array.prototype.slice.call(arguments, 2);
    try { return m[fn].apply(m, args); }
    catch (e) { reportError(name + '.' + fn, e); }
  }
  var errCount = {};
  function reportError(where, e) {
    errCount[where] = (errCount[where] || 0) + 1;
    if (errCount[where] <= 3) console.error('[VB][ERROR] ' + where + ': ' + (e && e.stack || e));
  }

  function applyQuality(q) {
    ctx.quality = q;
    var dpr = window.devicePixelRatio || 1;
    var cap = isMobile ? Math.min(1.5, q.pixelRatio) : Math.min(2, q.pixelRatio);
    ctx.renderer.setPixelRatio(Math.min(dpr, cap));
    ctx.renderer.shadowMap.enabled = q.shadows;
    ctx.renderer.shadowMap.needsUpdate = true;
    resize(true);
    for (var i = 0; i < MODS.length; i++) call(MODS[i], 'setQuality', q);
  }

  // ---------- Renderer / escena ----------
  function initRenderer() {
    var q = pickQuality();
    var r = new THREE.WebGLRenderer({ antialias: q.antialias && !isMobile, powerPreference: 'high-performance', alpha: false, stencil: false });
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x0b1220, 1);
    ctx.canvas = r.domElement; ctx.canvas.id = 'gl';
    ctx.canvas.setAttribute('aria-label', 'Pista de voley en 3D');
    ctx.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); showFatal('Se ha perdido el contexto gráfico. Recarga la página para seguir jugando.'); }, false);
    ctx.container.appendChild(ctx.canvas);
    ctx.renderer = r;
    ctx.scene = new THREE.Scene();
    ctx.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 200);
    ctx.camera.position.set(16, 6, 0); ctx.camera.lookAt(0, 1, 0);
    ctx.scene.add(ctx.camera);
    ctx.quality = q;
  }

  function resize(force) {
    var w = ctx.container.clientWidth || window.innerWidth || 1, h = ctx.container.clientHeight || window.innerHeight || 1;
    if (!force && w === ctx.width && h === ctx.height) return;
    ctx.width = w; ctx.height = h;
    ctx.renderer.setSize(w, h, false);
    ctx.canvas.style.width = '100%'; ctx.canvas.style.height = '100%';
    ctx.camera.aspect = w / h;
    // en pantallas estrechas/altas se abre un poco el campo de visión vertical para no perder la pista
    ctx.camera.updateProjectionMatrix();
    for (var i = 0; i < MODS.length; i++) call(MODS[i], 'resize', w, h);
  }

  // ---------- Partidas ----------
  function setGame(g) {
    ctx.game = g; ctx.timeScale = 1; acc = 0;
    pendingEvents.length = 0;
    Sim.drainEvents(g, pendingEvents); // eventos iniciales (newMatch, serveReady...) se entregan en el primer frame
    for (var i = 0; i < MODS.length; i++) call(MODS[i], 'onGameStart', g);
  }
  function seed() { return Q.seed ? (+Q.seed | 0) : ((Date.now() ^ (Math.random() * 1e9)) & 0x7fffffff); }

  ctx.actions.startMatch = function (opts) {
    opts = opts || {};
    call('Audio', 'unlock');
    tryFullscreen();
    ctx.frozen = false;
    setGame(Sim.createGame({ demo: false, seed: seed(), difficulty: opts.difficulty || ctx.settings.difficulty, autopilot: !!opts.autopilot }));
    setState('playing');
  };
  ctx.actions.toMenu = function () {
    ctx.frozen = false;
    setGame(Sim.createGame({ demo: true, seed: seed(), difficulty: 'normal' }));
    setState('menu');
  };
  ctx.actions.pause = function () { if (ctx.state === 'playing') setState('paused'); };
  ctx.actions.resume = function () { if (ctx.state === 'paused') setState('playing'); };
  ctx.actions.togglePause = function () { if (ctx.state === 'playing') ctx.actions.pause(); else if (ctx.state === 'paused') ctx.actions.resume(); };
  ctx.actions.restart = function () { ctx.actions.startMatch(); };
  ctx.actions.setSetting = function (k, v) {
    if (ctx.settings[k] === v) return;
    ctx.settings[k] = v; saveSettings();
    if (k === 'muted') call('Audio', 'setMuted', !!v);
    if (k === 'quality') { aq.downs = 0; aq.lastDown = -99; applyQuality(pickQuality()); }
    for (var i = 0; i < MODS.length; i++) call(MODS[i], 'onSettings', ctx.settings, k);
  };
  ctx.actions.toggleMute = function () { ctx.actions.setSetting('muted', !ctx.settings.muted); };

  function setState(s) {
    var prev = ctx.state; ctx.state = s;
    if (prev !== s) for (var i = 0; i < MODS.length; i++) call(MODS[i], 'onState', s, prev);
  }

  function tryFullscreen() {
    if (!isTouch || ctx.debug) return;
    try {
      var d = document.documentElement, p = d.requestFullscreen && d.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(function () {
        try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () { }); } catch (e) { }
      }).catch(function () { });
    } catch (e) { }
  }

  // ---------- Entrada -> mundo ----------
  var simIn = { move: [0, 0], hit: false, jump: false, switchPlayer: false };
  var edge = { hit: false, jump: false, switchPlayer: false };
  function buildInput(it) {
    // it: intenciones crudas de VB.Input.poll (pantalla: mx derecha+, my hacia la red+)
    var bs = VB.CameraRig && VB.CameraRig.getBasis ? VB.CameraRig.getBasis() : null;
    var mx = it ? it.mx || 0 : 0, my = it ? it.my || 0 : 0;
    if (bs) { simIn.move[0] = bs.rx * mx + bs.fx * my; simIn.move[1] = bs.ry * mx + bs.fy * my; }
    else { simIn.move[0] = -my; simIn.move[1] = mx; } // por defecto: cámara detrás mirando a -x
    if (it) { edge.hit = edge.hit || !!it.hit; edge.jump = edge.jump || !!it.jump; edge.switchPlayer = edge.switchPlayer || !!it.switchPlayer; }
  }

  // ---------- Bucle ----------
  var pendingEvents = [], frameEvents = [], EMPTY = [];
  var acc = 0, last = 0;
  var bootEl = document.getElementById('boot'), fpsEl = document.getElementById('fps');
  var meter = { t: 0, n: 0 }, fpsShowT = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    now = now || performance.now();
    var raw = last ? Math.max(0, (now - last) / 1000) : 1 / 60;
    var realDt = Math.min(MAX_DT, raw); last = now;
    ctx.realDt = realDt; ctx.time += realDt; ctx.frame++;
    resize(false);

    var it = VB.Input && VB.Input.poll ? safePoll(realDt) : null;
    if (it) {
      if (it.device) ctx.inputDevice = it.device;
      if (it.pause) {
        // Esc/Start/P: primero cierra un panel abierto; si no, pausa/reanuda
        if (!call('UI', 'back') && (ctx.state === 'playing' || ctx.state === 'paused')) ctx.actions.togglePause();
      }
      if (it.mute) ctx.actions.toggleMute();
      if (it.any) call('Audio', 'unlock');
      if (ctx.state !== 'playing') {
        var st0 = ctx.state;
        call('UI', 'nav', it, realDt);
        if (ctx.state !== st0) { it.hit = it.jump = it.switchPlayer = false; } // el botón que acepta un menú no golpea
      }
    }
    var g = ctx.game;
    ctx.portraitBlock = isTouch && ctx.state === 'playing' && ctx.height > ctx.width;
    var running = !ctx.frozen && ctx.state !== 'paused' && !ctx.portraitBlock;

    frameEvents.length = 0;
    // eventos pendientes (inicio de partida, escenas de depuración)
    for (var k = 0; k < pendingEvents.length; k++) frameEvents.push(pendingEvents[k]);
    pendingEvents.length = 0;

    var gdt = 0;
    if (running) {
      buildInput(ctx.state === 'playing' ? it : null);
      gdt = realDt * ctx.timeScale;
      acc += gdt;
      var n = 0;
      while (acc >= STEP && n < MAX_STEPS) {
        simIn.hit = edge.hit; simIn.jump = edge.jump; simIn.switchPlayer = edge.switchPlayer;
        edge.hit = edge.jump = edge.switchPlayer = false; // los flancos solo en el primer subpaso
        try { Sim.step(g, STEP, simIn); } catch (e) { reportError('Sim.step', e); }
        acc -= STEP; n++;
      }
      if (n === MAX_STEPS) acc = 0;
      Sim.drainEvents(g, frameEvents);
      if (ctx.state === 'playing' && g.finished && frameEvents.some(isGameOver)) setState('over');
    } else { edge.hit = edge.jump = edge.switchPlayer = false; acc = 0; }
    ctx.gameDt = gdt;

    var ev = frameEvents.length ? frameEvents : EMPTY;
    call('Arena', 'update', g, gdt, ev);
    call('Players', 'update', g, gdt, ev);
    call('FX', 'update', g, gdt, ev);
    call('CameraRig', 'update', g, realDt, ev);
    call('Audio', 'handle', ev, g);
    call('Audio', 'update', g, realDt);
    call('UI', 'update', g, gdt, ev);

    try {
      if (ctx.renderFn) ctx.renderFn(ctx); else ctx.renderer.render(ctx.scene, ctx.camera);
    } catch (e) { reportError('render', e); }

    if (ctx.frame === 3 && bootEl) { if (ctx.debug) bootEl.hidden = true; else bootEl.classList.add('gone'); }
    measure(raw);
  }
  function isGameOver(e) { return e.type === 'gameOver'; }
  function safePoll(dt) { try { return VB.Input.poll(dt); } catch (e) { reportError('Input.poll', e); return null; } }

  // ---------- Medición y calidad adaptativa ----------
  // Ventanas de 2 s. Baja un nivel si dos ventanas seguidas van < 45 fps; sube uno (solo hasta
  // el máximo automático) tras 5 ventanas seguidas > 57 fps y 30 s sin bajar; tras 2 bajadas
  // ya no vuelve a subir (evita oscilar). Desactivada con ?quality=, en depuración o calidad fija.
  var aq = { low: 0, high: 0, downs: 0, lastDown: -99 };
  function measure(raw) {
    if (document.hidden || raw > 0.5) return;
    meter.t += raw; meter.n++;
    if (fpsEl && Q.fps === '1' && (fpsShowT += raw) > 0.5) {
      fpsShowT = 0; var info = ctx.renderer.info.render;
      fpsEl.hidden = false;
      fpsEl.textContent = Math.round(ctx.fps) + ' fps · ' + ctx.quality.level + ' · pr ' + ctx.renderer.getPixelRatio().toFixed(2) + '\n' + info.calls + ' draw · ' + Math.round(info.triangles / 1000) + 'k tri';
    }
    if (meter.t < 2) return;
    ctx.fps = meter.n / meter.t; meter.t = 0; meter.n = 0;
    adaptQuality(ctx.fps);
  }
  function adaptQuality(fps) {
    if (ctx.debug || Q.quality || ctx.settings.quality !== 'auto' || ctx.state === 'paused' || ctx.portraitBlock) { aq.low = aq.high = 0; return; }
    var r = ctx.quality.rank;
    if (fps < 45) {
      aq.high = 0;
      if (r > 0 && ++aq.low >= 2) {
        aq.low = 0; aq.downs++; aq.lastDown = ctx.time;
        applyQuality(BY_RANK[r - 1]); console.info('[VB] calidad ->', ctx.quality.level, Math.round(fps) + ' fps');
      }
    } else if (fps > 57) {
      aq.low = 0;
      if (r < autoTop().rank && aq.downs < 2 && ctx.time - aq.lastDown > 30 && ++aq.high >= 5) {
        aq.high = 0; applyQuality(BY_RANK[r + 1]); console.info('[VB] calidad ->', ctx.quality.level, Math.round(fps) + ' fps');
      }
    } else { aq.low = 0; aq.high = 0; }
  }

  // ---------- Escenas de depuración ----------
  // Avanzan la simulación de forma determinista hasta un momento representativo
  // y congelan (ctx.frozen) para que las capturas sean significativas.
  // &live=1 sigue corriendo después; &seed=N cambia la semilla.
  function debugScene(name) {
    var sd = Q.seed ? +Q.seed : 7, diff = ctx.settings.difficulty;
    function mk(auto) { return Sim.createGame({ demo: false, autopilot: !!auto, seed: sd, difficulty: diff }); }
    function advanceUntil(g, pred, extra, maxSec, onAll) {
      var evs = [], keep = [], trig = -1, t = 0, max = (maxSec || 600) / STEP;
      for (var i = 0; i < max; i++) {
        Sim.step(g, STEP, null); evs.length = 0; Sim.drainEvents(g, evs);
        if (onAll && evs.length) onAll(evs, g);
        for (var j = 0; j < evs.length; j++) { if (trig < 0 && pred(evs[j], g)) trig = i; if (trig >= 0) keep.push(evs[j]); }
        if (trig < 0 && evs.length === 0 && pred(null, g)) trig = i;
        if (trig >= 0) { t += STEP; if (t >= extra) break; }
      }
      if (trig < 0) console.warn('[VB] escena ' + name + ': no se alcanzó el momento buscado');
      return keep;
    }
    function uiIngest(evs, g) { call('UI', 'ingest', evs, g); }
    var g, keep = [], state = 'playing', live = Q.live === '1';
    switch (name) {
      case 'menu': case 'tutorial': case 'controls': case 'settings':
        ctx.actions.toMenu(); return;
      case 'serve': case 'hud':
        g = mk(false); break;
      case 'pause':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'point'; }, 2.4, 600, uiIngest);
        state = 'paused'; break;
      case 'rally': case 'mobile':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'hit' && e.kind === 'pass' && e.team === 0; }, 0.45); break;
      case 'spike':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'hit' && e.kind === 'spike'; }, 0.07); break;
      case 'block':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'block'; }, 0.06); break;
      case 'point':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'point'; }, 0.5, 600, uiIngest); break;
      case 'ace':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'point' && !e.sideout && !e.rallyHits && e.reason === 'in'; }, 0.5, 1200, uiIngest); break;
      case 'setpoint':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'serveReady' && (e.setPoint >= 0 || e.matchPoint >= 0); }, 0.5, 1500, uiIngest); break;
      case 'switch':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'switch' && e.auto && !e.reset; }, 0.18); break;
      case 'over': case 'end':
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'gameOver'; }, 0, 3000, uiIngest); state = 'over'; break;
      default:
        console.warn('[VB] escena de depuración desconocida:', name); ctx.actions.toMenu(); return;
    }
    // las escenas que ya han pasado los eventos por ingest no los vuelven a contar
    setGame(g);
    for (var i = 0; i < keep.length; i++) pendingEvents.push(keep[i]);
    if (state === 'paused') { setState('playing'); setState('paused'); } else setState(state);
    ctx.frozen = !live && name !== 'serve' && name !== 'hud' && name !== 'pause';
    call('CameraRig', 'snap', g);
    console.info('[VB] escena de depuración: ' + name + ' (modo ' + g.mode + ', ' + g.score.join('-') + ', sets ' + g.sets.join('-') + ')');
  }

  // ---------- Arranque ----------
  function boot() {
    if (!THREE) { showFatal('No se ha podido cargar el motor 3D. Revisa la conexión y recarga la página.'); return; }
    if (!Sim) { showFatal('No se ha podido cargar la simulación del juego.'); return; }
    try { initRenderer(); }
    catch (e) { console.error(e); showFatal('Tu navegador no permite WebGL. Prueba con otro navegador o activa la aceleración por hardware.'); return; }
    for (var i = 0; i < MODS.length; i++) call(MODS[i], 'init', ctx);
    applyQuality(ctx.quality);
    call('Audio', 'setMuted', !!ctx.settings.muted);
    for (var j = 0; j < MODS.length; j++) call(MODS[j], 'onSettings', ctx.settings, null);
    // primer gesto del usuario: desbloquea el audio
    var unlock = function () { call('Audio', 'unlock'); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('resize', function () { resize(false); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && ctx.state === 'playing' && !ctx.debug) ctx.actions.pause(); last = 0; });
    window.addEventListener('blur', function () { if (ctx.state === 'playing' && !ctx.debug) ctx.actions.pause(); });
    if (ctx.debug) debugScene(ctx.debug); else ctx.actions.toMenu();
    requestAnimationFrame(frame);
  }
  function showFatal(msg) {
    var d = document.getElementById('fatal');
    if (d) { d.innerHTML = '<b>Voley 3D</b><span></span>'; d.lastChild.textContent = msg; d.hidden = false; }
    if (bootEl) bootEl.hidden = true;
  }
  VB.boot = boot;
  boot();
})();
