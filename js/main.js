/* =====================================================================
 * VOLEY 3D — js/main.js   (owner: ui_main)
 * Arranque, renderer, bucle con simulación de paso fijo a 120 Hz,
 * reparto de eventos a los módulos, calidad adaptativa (con histéresis)
 * y escenas de depuración deterministas:
 *   ?debug=menu|serve|rally|spike|block|point|ace|setpoint|switch|over|end|
 *          mobile|pause|tutorial|controls|settings|toss|jumpserve|dive
 *   &seed=N  &live=1  &quality=low|medium|high  &maxdt=0.25  &fps=1  &clock=1 (serve/hud con regla de 8 s)
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

  // 4 niveles (Fácil, Normal, Difícil, Experto); VB.DIFF_ORDER lo da sim.js
  var DIFFS = (VB.DIFF_ORDER && VB.DIFF_ORDER.slice()) || ['easy', 'normal', 'hard', 'expert'];

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
    // Accesibilidad (UI-16): camStable (cámara sin temblores ni sacudidas; la lee camera.js), rumble (vibración de mando y
    // móvil; input.js), hudScale (1 | 1,15 | 1,3: tamaño del HUD y de las hojas; ui.js), softFlash (destellos suaves; arena/fx/ui)
    // coachTips: consejos del partido (franja de arriba). Se ven hasta la primera victoria: ui.js los apaga al ganar el 1r partido
    // y se pueden volver a encender en Ajustes · Juego.
    var s = { muted: false, difficulty: 'normal', quality: 'auto', showHelp: true, coachTips: true, camSens: 1, sfxVol: 1, musicVol: 0.75,
      camStable: false, rumble: true, hudScale: 1, softFlash: false };
    var saved = false;
    var o = null;
    try { var raw = localStorage.getItem('voley3d.settings'); if (raw) { saved = true; o = JSON.parse(raw); for (var k in o) if (k in s && typeof o[k] === typeof s[k]) s[k] = o[k]; } } catch (e) { }
    // Jugador nuevo (sin ajustes guardados ni partidos jugados): empieza en Fácil. Normal contra un novato
    // es un muro (simtest: un bot novato gana ~30 % de los puntos en Normal y ~54 % en Fácil).
    // Las escenas de depuración siguen en Normal para que las capturas sean comparables.
    var rec = null; try { rec = JSON.parse(localStorage.getItem('voley3d.record') || 'null'); } catch (e) { }
    if (!saved && !Q.debug) {
      if (!rec || !(rec.played > 0)) s.difficulty = 'easy';
    }
    // ajustes de antes de existir coachTips: quien ya ha ganado algún partido empieza sin consejos (como si acabara de ganar)
    if (!Q.debug && rec && rec.wins > 0 && !(o && 'coachTips' in o)) s.coachTips = false;
    if (DIFFS.indexOf(s.difficulty) < 0) s.difficulty = 'normal';
    if (['auto', 'high', 'medium', 'low'].indexOf(s.quality) < 0) s.quality = 'auto';
    s.camSens = Math.max(0.5, Math.min(1.5, +s.camSens || 1));
    s.sfxVol = Math.max(0, Math.min(1, isFinite(+s.sfxVol) ? +s.sfxVol : 1));
    s.musicVol = Math.max(0, Math.min(1, isFinite(+s.musicVol) ? +s.musicVol : 0.75));
    if ([1, 1.15, 1.3].indexOf(s.hudScale) < 0) s.hudScale = 1;
    if (Q.diff && DIFFS.indexOf(Q.diff) >= 0) s.difficulty = Q.diff;
    return s;
  }
  function saveSettings() { try { localStorage.setItem('voley3d.settings', JSON.stringify(ctx.settings)); } catch (e) { } }

  // ---------- Calidad ----------
  var QUALITY = {
    high:   { level: 'high',   rank: 2, pixelRatio: 2,   mobilePixelRatio: 1.5,  shadowSize: 2048, shadows: true, antialias: true,  crowdDensity: 1 },
    medium: { level: 'medium', rank: 1, pixelRatio: 1.5, mobilePixelRatio: 1.25, shadowSize: 1024, shadows: true, antialias: true,  crowdDensity: 0.7 },
    low:    { level: 'low',    rank: 0, pixelRatio: 1,   mobilePixelRatio: 1,    shadowSize: 512,  shadows: true, antialias: false, crowdDensity: 0.4 }
  };
  // Escritorio en "baja": mapa de sombra de 1024 (con 512 el frustum de 36x26 m da ~7 cm por texel y la sombra de los pies
  // sale escalonada en los planos cercanos; la GPU de un PC lo paga sin notarlo). En el móvil se queda en 512 (presupuesto).
  if (!isMobile) QUALITY.low.shadowSize = 1024;
  var BY_RANK = [QUALITY.low, QUALITY.medium, QUALITY.high];
  // Último recurso por debajo de "baja": escala de render (<1 = menos píxeles que la pantalla).
  // La calidad adaptativa la baja a 0,8 y luego a 0,67 si en "baja" sigue por debajo de 40 fps.
  var renderScale = 1;
  function autoTop() { return isMobile ? QUALITY.medium : QUALITY.high; }
  function pickQuality() {
    var want = Q.quality || ctx.settings.quality;
    if (QUALITY[want]) return QUALITY[want];
    return autoTop();
  }

  // Módulos en orden de inicialización/actualización
  var MODS = ['Arena', 'FX', 'Players', 'CameraRig', 'Input', 'Audio', 'UI'];
  // Aridad fija (hasta 3 argumentos): sin `arguments`/slice, que asignaban un array en cada una de las
  // ~15 llamadas por frame (CONTRACT §2: nada de basura por frame en el bucle).
  function call(name, fn, a, b, c) {
    var m = VB[name]; if (!m || typeof m[fn] !== 'function') return;
    try { return m[fn](a, b, c); }
    catch (e) { reportError(name + '.' + fn, e); }
  }
  var errCount = {};
  function reportError(where, e) {
    errCount[where] = (errCount[where] || 0) + 1;
    if (errCount[where] <= 3) console.error('[VB][ERROR] ' + where + ': ' + (e && e.stack || e));
  }

  // Tipo de sombra: un solo tipo por dispositivo (cambiar de tipo obliga a recompilar todos los materiales: medido con
  // tools/perf.js, CPU ×10, la bajada de media a baja congelaba el juego ~2 s justo cuando ya iba lento).
  //  - Móvil: PCF simple en todos los niveles (con un mapa de 1024 la diferencia de borde apenas se ve).
  //  - Escritorio: PCF suave también en baja (con PCF simple y mapa de 512 la sombra de los pies salía escalonada en los
  //    planos cercanos; ahora 1024 + PCF suave, y la bajada de alta/media a baja ya no recompila).
  function shadowType(q) { return isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; }
  function applyQuality(q) {
    ctx.quality = q;
    var dpr = window.devicePixelRatio || 1;
    // tope de píxeles: en el móvil la pantalla tiene dpr 2,5-3,5 y la GPU de gama media no llena tanto (MSAA x4 incluido):
    // alta 1,5, media 1,25, baja 1 (844x390 en media = 1055x488 px: 0,69 × los píxeles de antes, con pr 1,5).
    // Escritorio: el pixelRatio de cada nivel con tope 2 (sin cambios: alta mantiene su aspecto).
    var cap = isMobile ? (q.mobilePixelRatio || q.pixelRatio) : Math.min(2, q.pixelRatio);
    if (q.rank > 0) renderScale = 1;
    ctx.renderer.setPixelRatio(Math.min(dpr, cap) * renderScale);
    // sombras: un tipo fijo por dispositivo (ver shadowType); solo cambia si algún día cambia la regla
    var st = shadowType(q), sm = ctx.renderer.shadowMap;
    if (sm.type !== st) {
      sm.type = st;
      // el tipo de sombra forma parte del programa de cada material: hay que recompilarlos
      if (ctx.scene) ctx.scene.traverse(function (o) {
        var m = o.material; if (!m) return;
        if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) m[i].needsUpdate = true; } else m.needsUpdate = true;
      });
    }
    sm.enabled = q.shadows;
    sm.needsUpdate = true;
    resize(true);
    for (var i = 0; i < MODS.length; i++) call(MODS[i], 'setQuality', q);
    fixShadowDepth();
  }

  // ---------- Sombras: un material de profundidad por variante ----------
  // three r149 pinta TODAS las sombras con un único MeshDepthMaterial. Al alternar en la misma pasada mallas con
  // esqueleto (jugadores, oficiales), instanciadas y normales, ese material cambia de programa en cada cambio:
  // getProgram() rehace los parámetros y la clave de programa (cadenas) 4 veces por frame (medido con tools/perf.js:
  // ~650 KB/s de basura y CPU en cada frame). Con un customDepthMaterial compartido por variante cada programa queda fijo.
  var depthMats = {};
  function depthMat(kind) {
    return depthMats[kind] || (depthMats[kind] = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  }
  function fixShadowDepth() {
    if (!ctx.scene || !THREE.MeshDepthMaterial) return;
    try {
      ctx.scene.traverse(function (o) {
        if (!o.isMesh || o.customDepthMaterial) return;
        if (o.isSkinnedMesh) o.customDepthMaterial = depthMat('skin');
        else if (o.isInstancedMesh) o.customDepthMaterial = depthMat('inst');
      });
    } catch (e) { reportError('fixShadowDepth', e); }
  }
  ctx.fixShadowDepth = fixShadowDepth;

  // ---------- Renderer / escena ----------
  function initRenderer() {
    var q = pickQuality();
    // MSAA del lienzo: sobra si arena va a pintar con su post-proceso (escritorio, calidad alta, WebGL2):
    // la escena va a un destino propio con MSAA x4 y al lienzo solo llega un rectángulo a pantalla completa.
    // Un búfer multimuestreo del tamaño de la pantalla costaría memoria y ancho de banda sin usarse.
    // MSAA del lienzo (no se puede cambiar después de crearlo):
    //  - móvil: SIEMPRE. En GPUs de teselas el MSAA x4 se resuelve en la memoria del chip y sale casi gratis;
    //    el tope de pixelRatio 1,5 se mantiene. Antes el móvil iba sin AA (líneas, red y antenas en escalera).
    //  - escritorio: también, salvo calidad FIJA "baja". Con el post-proceso de arena (alta + WebGL2) la escena
    //    va a su destino MSAA propio y el lienzo solo recibe un rectángulo (coste: una resolución por frame);
    //    pero si la calidad adaptativa baja de alta a media el post se apaga y, sin MSAA en el lienzo,
    //    la imagen se quedaba sin AA ninguno.
    var fixedLow = (Q.quality || ctx.settings.quality) === 'low';
    var aa = isMobile ? true : !fixedLow;
    ctx.canvasAA = aa; // lo puede leer arena
    var r = new THREE.WebGLRenderer({ antialias: aa, powerPreference: 'high-performance', alpha: false, stencil: false });
    // three r149 consulta el estado de enlace de cada programa nuevo (bloquea el hilo hasta que el driver
    // termina de compilar): fuera de depuración no hace falta y quita picos de 50-150 ms al estrenar materiales
    if (!ctx.debug && r.debug) r.debug.checkShaderErrors = false;
    // renderer.info acumula TODO el frame (sombras, escena, bloom): main.js lo pone a cero al empezar cada render
    r.info.autoReset = false;
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = shadowType(q);
    r.setClearColor(0x0b1220, 1);
    ctx.canvas = r.domElement; ctx.canvas.id = 'gl';
    ctx.canvas.setAttribute('aria-label', 'Pista de vóley en 3D');
    ctx.canvas.addEventListener('webglcontextlost', onContextLost, false);
    ctx.canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    ctx.container.appendChild(ctx.canvas);
    ctx.renderer = r;
    ctx.scene = new THREE.Scene();
    // la escena está en el origen y no se mueve: three no recalcula su matriz cada frame (arena congeló las suyas)
    ctx.scene.matrixAutoUpdate = false; ctx.scene.updateMatrix();
    ctx.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 200);
    ctx.camera.position.set(16, 6, 0); ctx.camera.lookAt(0, 1, 0);
    ctx.scene.add(ctx.camera);
    ctx.quality = q;
  }

  // ---------- Pérdida del contexto WebGL ----------
  // En el móvil es habitual al pasar la app a segundo plano. Se pausa el partido, se avisa sin bloquear y,
  // cuando vuelve el contexto, three.js vuelve a subir texturas y geometrías: solo hay que rehacer sombras
  // y destinos del post-proceso (applyQuality). Si en 6 s no ha vuelto, mensaje definitivo.
  var glLost = false, glLostTimer = 0;
  function onContextLost(e) {
    e.preventDefault(); // imprescindible para que el navegador intente restaurarlo
    glLost = true;
    if (ctx.state === 'playing') ctx.actions.pause();
    showFatal('Recuperando los gráficos…', true);
    clearTimeout(glLostTimer);
    glLostTimer = setTimeout(function () { if (glLost) showFatal('Se ha perdido el contexto gráfico. Recarga la página para seguir jugando.'); }, 6000);
  }
  function onContextRestored() {
    glLost = false; clearTimeout(glLostTimer);
    var d = document.getElementById('fatal'); if (d) { d.hidden = true; d.classList.remove('soft'); }
    try {
      ctx.renderer.shadowMap.needsUpdate = true;
      applyQuality(ctx.quality);
      call('Arena', 'onContextRestored', ctx); call('FX', 'onContextRestored', ctx);
    } catch (err) { reportError('contextRestored', err); }
    last = 0; meter.t = 0; meter.n = 0; meter.js = 0; meter.lt = 0; aq.skip = 1; // el parón no cuenta como fps bajos
    console.info('[VB] contexto WebGL restaurado');
  }

  // Solo se lee el tamaño del contenedor cuando algo lo ha cambiado (evento resize / ResizeObserver):
  // leer clientWidth cada frame podía forzar recálculo de estilos y maquetación con las animaciones del HUD.
  var sizeDirty = true;
  function resize(force) {
    if (!force && !sizeDirty) return;
    sizeDirty = false;
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
    fixShadowDepth(); // los jugadores se reconstruyen en onGameStart
  }
  // primer partido (sin récord guardado): la CPU saca más suave (notes/sim.md, createGame({rookie}))
  function isRookie() { try { var r = JSON.parse(localStorage.getItem('voley3d.record') || 'null'); return !(r && r.played > 0); } catch (e) { return false; } }
  function seed() { return Q.seed ? (+Q.seed | 0) : ((Date.now() ^ (Math.random() * 1e9)) & 0x7fffffff); }

  // UI-01/UI-07: un partido humano pedido mientras el arranque aún ensaya estilos bajo el fondo del telón (herramientas que llaman
  // a startMatch a los ~2,5 s; con el menú, la cortinilla ya espera sola) espera a que acabe (como mucho hasta los 9 s): si no, el
  // ensayo se cortaba y el primer uso de la tarjeta de presentación o del aviso del saque costaba un frame de 45-70 ms.
  var startWait = null;
  ctx.actions.startMatch = function (opts) {
    opts = opts || {};
    // (solo partidos humanos: los de autopilot —herramientas de medida— empiezan al momento, como siempre)
    if (!ctx.debug && !opts.autopilot && call('UI', 'bootBusy')) { startWait = opts; return; }
    startWait = null;
    call('Audio', 'unlock');
    tryFullscreen();
    ctx.frozen = false;
    // present (SIM-03): en los partidos de verdad la pausa del punto se alarga en los momentos grandes (y se puede recortar)
    setGame(Sim.createGame({ demo: false, seed: seed(), difficulty: opts.difficulty || ctx.settings.difficulty, autopilot: !!opts.autopilot, rookie: isRookie(), present: !opts.autopilot }));
    setState('playing');
    // los jugadores se reconstruyen en onGameStart: sube sus texturas/programas antes del primer frame
    // (sin pintar: aquí no hay telón que tape los objetos ocultos)
    if (Q.prewarm !== '0') { prewarm('t'); prewarmPrograms(false); }
    // UI-14: tarjeta de presentación (partidos humanos; en depuración solo con &intro=1)
    if (!opts.autopilot && !opts.noIntro && Q.intro !== '0' && (!ctx.debug || Q.intro === '1')) introStart();
  };
  // ---------- Presentación del partido (UI-14) ----------
  // Tarjeta de INTRO_SEC s al empezar: la sim queda parada (sin serveReady ni silbato; los eventos iniciales salvo newMatch se
  // guardan y se entregan al acabar), el mundo sigue animándose (dt de presentación = tiempo real). Cualquier botón, tecla o toque
  // la salta en el frame siguiente. Cámara: VB.CameraRig.playIntro(s) (playIntro(0) al acabar antes); audio: sting('intro').
  var INTRO_SEC = 2.5, intro = { left: 0, held: [] };
  ctx.introLeft = 0; ctx.introSkipReq = false;
  function introStart() {
    intro.left = INTRO_SEC; intro.held.length = 0; ctx.introSkipReq = false;
    var keep = [];
    for (var i = 0; i < pendingEvents.length; i++) (pendingEvents[i].type === 'newMatch' ? keep : intro.held).push(pendingEvents[i]);
    pendingEvents.length = 0; for (var j = 0; j < keep.length; j++) pendingEvents.push(keep[j]);
    ctx.introLeft = intro.left;
    call('CameraRig', 'playIntro', INTRO_SEC);
    call('Audio', 'sting', 'intro');
    call('UI', 'introStart', ctx.game);
  }
  function introEnd(skipped) {
    if (!(intro.left > 0)) return;
    intro.left = 0; ctx.introLeft = 0; ctx.introSkipReq = false;
    for (var i = 0; i < intro.held.length; i++) pendingEvents.push(intro.held[i]);
    intro.held.length = 0;
    if (skipped) call('CameraRig', 'playIntro', 0);
    call('UI', 'introEnd', !!skipped);
  }
  ctx.actions.toMenu = function () {
    if (intro.left > 0) { intro.left = 0; ctx.introLeft = 0; intro.held.length = 0; call('CameraRig', 'playIntro', 0); call('UI', 'introEnd', true); }
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
    if (k === 'quality') { aq.downs = 0; aq.lastDown = -99; aq.noScale = false; aq.chk = null; applyQuality(pickQuality()); }
    for (var i = 0; i < MODS.length; i++) call(MODS[i], 'onSettings', ctx.settings, k);
  };
  ctx.actions.toggleMute = function () { ctx.actions.setSetting('muted', !ctx.settings.muted); };

  function setState(s) {
    var prev = ctx.state; ctx.state = s;
    if (prev !== s) aq.skip = 1; // la ventana de fps que cruza un cambio de estado no cuenta para la calidad adaptativa
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
  ctx.simMove = simIn.move; // entrada de MUNDO del frame (FX la lee para la retícula de apuntado en vivo)
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
  var pendingEvents = [], frameEvents = [], EMPTY = [], PFX = [];
  var acc = 0, last = 0, fxAge = 0, idleT = 0, drawn = 0, bootDone = false;
  var bootEl = document.getElementById('boot'), fpsEl = document.getElementById('fps');
  var meter = { t: 0, n: 0, js: 0, lt: 0 }, fpsShowT = 0;
  // Tareas largas del hilo principal (>50 ms, incluidas las que no son del juego: GC, otras pestañas del proceso, compositor).
  // ctx.frameMs solo mide el JS del juego; con la máquina saturada se queda corto y la calidad adaptativa creía que el cuello
  // era la GPU. La suma de la ventana se usa como cota inferior del tiempo ocupado (ver measure / adaptQuality).
  try {
    if (window.PerformanceObserver && (PerformanceObserver.supportedEntryTypes || []).indexOf('longtask') >= 0) {
      new PerformanceObserver(function (list) { var es = list.getEntries(); for (var i = 0; i < es.length; i++) meter.lt += es[i].duration; }).observe({ entryTypes: ['longtask'] });
    }
  } catch (e) { }

  function frame(now) {
    requestAnimationFrame(frame);
    var tWork = performance.now(); // coste JS de este frame (ctx.frameMs; lo lee tools/perf.js)
    now = now || tWork;
    var raw = last ? Math.max(0, (now - last) / 1000) : 1 / 60;
    var realDt = Math.min(MAX_DT, raw); last = now;
    ctx.realDt = realDt; ctx.time += realDt; ctx.frame++;
    if (sizeDirty) resize(false);

    var it = VB.Input && VB.Input.poll ? safePoll(realDt) : null;
    if (intro.left > 0) {
      if (ctx.state !== 'playing') { if (ctx.state !== 'paused') introEnd(true); }
      else if (ctx.introSkipReq || (it && (it.hit || it.jump || it.switchPlayer || it.pause || it.confirm))) {
        introEnd(true);
        if (it) { it.hit = it.jump = it.switchPlayer = it.pause = it.confirm = false; }   // el botón que salta no golpea ni pausa
      }
    }
    if (it) {
      if (it.device) ctx.inputDevice = it.device;
      if (it.padEvent) call('UI', 'padEvent', it.padEvent); // 'connected' | 'disconnected' (antes de la pausa que provoca)
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
    if (startWait && !call('UI', 'bootBusy')) { var sw = startWait; startWait = null; ctx.actions.startMatch(sw); }
    var g = ctx.game;
    ctx.portraitBlock = isTouch && ctx.state === 'playing' && ctx.height > ctx.width;
    var running = !ctx.frozen && ctx.state !== 'paused' && !ctx.portraitBlock;

    frameEvents.length = 0;
    // eventos pendientes (inicio de partida, escenas de depuración)
    for (var k = 0; k < pendingEvents.length; k++) frameEvents.push(pendingEvents[k]);
    pendingEvents.length = 0;

    var gdt = 0;
    // tarjeta de presentación: la sim espera; el resto del mundo se anima en tiempo real
    if (running && intro.left > 0) {
      intro.left -= realDt; ctx.introLeft = Math.max(0, intro.left);
      if (intro.left <= 0) { intro.left = 1e-6; introEnd(false); }
      for (var ih = 0; ih < pendingEvents.length; ih++) frameEvents.push(pendingEvents[ih]);
      pendingEvents.length = 0;
    }
    if (running && intro.left > 0) { gdt = realDt; edge.hit = edge.jump = edge.switchPlayer = false; acc = 0; }
    else if (running) {
      buildInput(ctx.state === 'playing' ? it : null);
      gdt = realDt * ctx.timeScale;
      acc += gdt;
      // SIM-03: GOLPEAR o SALTAR durante la pausa del punto la recorta (sim decide: tras 0,8 s y nunca a menos de 0,3 s);
      // el flanco se consume para que no llegue al saque siguiente
      // (UI-11: cualquier botón —golpear, saltar, cambiar o aceptar— también en la pausa del punto que gana el partido)
      if (ctx.state === 'playing' && g && (g.mode === 'point' || g.mode === 'over') && (edge.hit || edge.jump || edge.switchPlayer || (it && it.confirm)) && Sim.skipHold) {
        var skipped = false; try { skipped = Sim.skipHold(g); } catch (e) { reportError('Sim.skipHold', e); }
        if (skipped) { edge.hit = edge.jump = edge.switchPlayer = false; call('UI', 'onHoldSkip', g); }
      }
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
    // escena tapada (pausa, pantalla final ya visible): se pinta a ritmo reducido. Durante la celebración
    // previa a la pantalla final (ctx.endHold, ui.js) se pinta a ritmo completo.
    if ((ctx.state === 'over' && g && g.finished && !ctx.endHold) || ctx.state === 'paused') idleT += realDt; else idleT = 0;
    call('Arena', 'update', g, gdt, ev);
    call('Players', 'update', g, gdt, ev);
    // contactos cosméticos de la celebración (players PLY-07): se reparten como eventos 'fx:*' a FX, cámara, audio y UI
    if (VB.Players && VB.Players.drainFx && g) {
      PFX.length = 0; try { VB.Players.drainFx(PFX); } catch (e) { reportError('Players.drainFx', e); PFX.length = 0; }
      if (PFX.length) { if (ev === EMPTY) ev = frameEvents; for (var pf = 0; pf < PFX.length; pf++) { var fq = PFX[pf]; fq.t = g.time; fq.type = 'fx:' + fq.type; ev.push(fq); } }
    }
    call('FX', 'update', g, gdt, ev);
    // escenas congeladas: los efectos del evento que dispara la escena se envejecen lo que avanzó la sim desde él
    // (si no, el destello/onda se queda congelado a plena intensidad en la captura)
    if (fxAge > 0 && ctx.frozen && ev !== EMPTY) { call('FX', 'update', g, fxAge, EMPTY); fxAge = 0; }
    call('CameraRig', 'update', g, realDt, ev);
    // &camyaw=rad (solo depuración): gira la cámara tras su update; escena reproducible con el jugador fuera de cuadro para el
    // indicador de borde (UI-10), p. ej. ?debug=rally&live=1&seed=4&camyaw=0.9
    if (ctx.debug && Q.camyaw && ctx.camera) { ctx.camera.rotateY(+Q.camyaw || 0); ctx.camera.updateMatrixWorld(true); }
    call('Audio', 'handle', ev, g);
    call('Audio', 'update', g, realDt);
    call('UI', 'update', g, gdt, ev);

    // En pausa (y en la pantalla final ya asentada) la escena queda detrás de un velo desenfocado: se pinta
    // a 1/3 de frecuencia para ahorrar batería y calor en el móvil. Entrada y UI siguen a ritmo completo.
    // Móvil en vertical: el aviso "Gira el móvil" tapa toda la pantalla, no se pinta nada (batería).
    var throttled = ctx.portraitBlock || (idleT > 0.6 && (ctx.frame % 3) !== 0);
    // precompilado asíncrono en curso (arranque): no se pinta todavía (pintar esperaría al driver y congelaría el telón)
    if (progWarm.pending && progsPending() && progWarm.gate) throttled = true;
    // programas listos: primer dibujo de todo (variantes de ANGLE) justo antes del primer frame real, aún bajo el telón
    if (needWarmDraw && !throttled && !glLost && !(progWarm.pending && progWarm.gate)) { needWarmDraw = false; warmDraw(); }
    if (!throttled && !glLost) {
      drawn++;
      ctx.renderer.info.reset();
      try {
        if (ctx.renderFn) ctx.renderFn(ctx); else ctx.renderer.render(ctx.scene, ctx.camera);
      } catch (e) { reportError('render', e); }
    }

    // telón: en depuración se quita sin más; si no, ui.js hace el relevo al menú (espera a las fuentes; UI-07)
    if (drawn === 3 && !bootDone && bootEl) {
      bootDone = true;
      if (ctx.debug) bootEl.hidden = true;
      else if (!call('UI', 'bootReady', bootEl)) { bootEl.classList.add('gone'); var mn = document.getElementById('menu'); if (mn) mn.classList.remove('intro'); }
    }
    if (idleT > 0.6 || ctx.portraitBlock || progWarm.gate) { meter.t = 0; meter.n = 0; meter.js = 0; meter.lt = 0; } else measure(raw); // sin medir mientras se pinta a ritmo reducido
    ctx.frameMs = performance.now() - tWork;
  }
  function isGameOver(e) { return e.type === 'gameOver'; }
  function safePoll(dt) { try { return VB.Input.poll(dt); } catch (e) { reportError('Input.poll', e); return null; } }

  // ---------- Medición y calidad adaptativa ----------
  // Ventanas de 2 s (afinado con tools/perf.js: móvil emulado 844x390, dpr 2,75, CPU ×4).
  //  - BAJA un nivel tras 2 ventanas seguidas < 45 fps (no llega) o 3 seguidas < 52 fps (va justo: el objetivo es 55-60).
  //  - Ya en "baja": escala de render ×0,8 y luego ×0,67 tras 2 ventanas < 45 fps, PERO solo si el cuello es la GPU
  //    (tiempo ocupado del hilo principal < 40 % del intervalo entre frames; ocupado = máx. del JS del juego y de la suma de
  //    tareas largas). Si el que no llega es el procesador, quitar píxeles no ayuda y solo emborrona la imagen. Además,
  //    tras cada escalón se comprueba: si en las 2 ventanas siguientes los fps no suben al menos un 15 %, se deshace y no
  //    se vuelve a escalar (con la CPU saturada al 90-100 % llegaba a 0,8 con js 0,50-0,53 y los fps seguían en ~48).
  //  - Calentamiento: nada de ventanas en los primeros 8 s tras el arranque (compilación de shaders y subida de texturas
  //    en los primeros frames; un móvil cargado bajaba de media a baja en el menú a los 3 s con un pico de 550 ms).
  //  - SUBE uno (hasta el máximo automático: alta en escritorio, media en móvil) tras 5 ventanas seguidas > 58 fps y 30 s
  //    sin bajar; tras 2 bajadas ya no sube (evita oscilar).
  //  - La ventana siguiente a un cambio de calidad, al empezar partido o tras volver de la pausa no cuenta (recompilación
  //    de sombras/materiales y subida de texturas dan picos que no son el ritmo real).
  // Desactivada con ?quality=, en depuración (salvo &aq=1, para tools/perf.js) o con calidad fija en Ajustes.
  var aq = { low: 0, mild: 0, high: 0, downs: 0, lastDown: -99, skip: 1, warmUntil: 0, boot: 0, chk: null, noScale: false };
  ctx.cpuBusy = 0; // fracción ocupada del hilo principal en la última ventana (máx. de JS del juego y tareas largas)
  ctx.frameMsAvg = 0; // coste JS medio por frame de la última ventana (ms)
  function measure(raw) {
    if (document.hidden || raw > 0.5) return;
    meter.t += raw; meter.n++; meter.js += ctx.frameMs || 0;
    if (fpsEl && Q.fps === '1' && (fpsShowT += raw) > 0.5) {
      fpsShowT = 0; var info = ctx.renderer.info.render;
      fpsEl.hidden = false;
      fpsEl.textContent = Math.round(ctx.fps) + ' fps · ' + ctx.quality.level + ' · pr ' + ctx.renderer.getPixelRatio().toFixed(2) + (renderScale < 1 ? ' (×' + renderScale + ')' : '') + '\n' + info.calls + ' draw · ' + Math.round(info.triangles / 1000) + 'k tri · js ' + ctx.frameMsAvg.toFixed(1) + ' ms';
    }
    if (meter.t < 2) return;
    ctx.fps = meter.n / meter.t; ctx.frameMsAvg = meter.js / meter.n;
    var interval = 1000 * meter.t / meter.n, win = 1000 * meter.t;
    ctx.cpuBusy = Math.min(1, Math.max(ctx.frameMsAvg / interval, meter.lt / win));
    meter.t = 0; meter.n = 0; meter.js = 0; meter.lt = 0;
    adaptQuality(ctx.fps, ctx.cpuBusy);
  }
  // Historial de la calidad adaptativa (lo lee tools/perf.js): {t (s de ctx.time, con tope por frame), rt (s reales desde el arranque), level, scale, pr, fps, js (fracción del frame), why}
  ctx.qLog = [];
  function logQ(why, fps, load) {
    var e = { t: Math.round(ctx.time * 10) / 10, rt: Math.round((performance.now() - aq.boot) / 100) / 10, level: ctx.quality.level, scale: renderScale, pr: Math.round(ctx.renderer.getPixelRatio() * 100) / 100, fps: Math.round(fps), js: Math.round((load || 0) * 100) / 100, why: why };
    if (ctx.qLog.length < 50) ctx.qLog.push(e);
    console.info('[VB] calidad -> ' + e.level + (renderScale < 1 ? ' ×' + renderScale : '') + ' (' + e.fps + ' fps, ' + why + ')');
  }
  function stepDown(why, fps, load) {
    aq.low = aq.mild = aq.high = 0; aq.downs++; aq.lastDown = ctx.time; aq.skip = 1;
    applyQuality(BY_RANK[ctx.quality.rank - 1]); logQ(why, fps, load);
  }
  function adaptQuality(fps, load) {
    if ((ctx.debug && Q.aq !== '1') || Q.quality || ctx.settings.quality !== 'auto' || ctx.state === 'paused' || ctx.portraitBlock) { aq.low = aq.mild = aq.high = 0; aq.skip = 1; aq.chk = null; return; }
    if (performance.now() < aq.warmUntil) { aq.low = aq.mild = aq.high = 0; return; } // calentamiento tras el arranque
    if (aq.skip > 0) { aq.skip--; return; }
    if (aq.chk) { // ¿sirvió el último escalón de escala? 2 ventanas y media de fps
      aq.chk.sum += fps; if (++aq.chk.n < 2) return;
      var gain = aq.chk.sum / aq.chk.n / aq.chk.fps, prevScale = aq.chk.scale; aq.chk = null;
      if (gain < 1.15) {
        renderScale = prevScale; aq.noScale = true; aq.low = aq.mild = 0; aq.skip = 1;
        applyQuality(ctx.quality); logQ('escala deshecha (x' + gain.toFixed(2) + ')', fps, load); return;
      }
    }
    var r = ctx.quality.rank;
    if (fps < 45) {
      aq.high = 0; aq.mild++;
      if (++aq.low < 2) return;
      if (r > 0) { stepDown('baja', fps, load); return; }
      // ya en "baja": menos píxeles solo si la GPU es el cuello de botella
      if (renderScale > 0.7 && load < 0.4 && !aq.noScale) {
        aq.low = aq.mild = 0; aq.downs++; aq.lastDown = ctx.time; aq.skip = 1;
        aq.chk = { fps: fps, scale: renderScale, sum: 0, n: 0 };
        renderScale = renderScale > 0.9 ? 0.8 : 0.67;
        applyQuality(ctx.quality); logQ('escala', fps, load);
      } else aq.low = 0;
    } else if (fps < 52) {
      aq.low = 0; aq.high = 0;
      if (r > 0 && ++aq.mild >= 3) stepDown('baja (justa)', fps, load);
    } else if (fps > 58) {
      aq.low = aq.mild = 0;
      if (r < autoTop().rank && aq.downs < 2 && ctx.time - aq.lastDown > 30 && ++aq.high >= 5) {
        aq.high = 0; aq.skip = 1; applyQuality(BY_RANK[r + 1]); logQ('sube', fps, load);
      }
    } else { aq.low = 0; aq.mild = 0; aq.high = 0; }
  }

  // ---------- Escenas de depuración ----------
  // Avanzan la simulación de forma determinista hasta un momento representativo
  // y congelan (ctx.frozen) para que las capturas sean significativas.
  // &live=1 sigue corriendo después; &seed=N cambia la semilla.
  function debugScene(name) {
    var sd = Q.seed ? +Q.seed : 7, diff = ctx.settings.difficulty;
    function mk(auto, noClock) { return Sim.createGame({ demo: false, autopilot: !!auto, seed: sd, difficulty: diff, serveClock: noClock ? false : undefined }); }
    var preLand = null; // último 'land' ANTERIOR al momento buscado (escenas de punto: la marca del bote)
    function advanceUntil(g, pred, extra, maxSec, onAll) {
      var evs = [], keep = [], trig = -1, t = 0, max = (maxSec || 600) / STEP;
      for (var i = 0; i < max; i++) {
        Sim.step(g, STEP, null); evs.length = 0; Sim.drainEvents(g, evs);
        if (onAll && evs.length) onAll(evs, g);
        for (var j = 0; j < evs.length; j++) {
          var ej = evs[j];
          if (trig < 0 && ej.type === 'serveReady') preLand = null;
          if (trig < 0 && pred(ej, g)) trig = i;
          if (trig >= 0) keep.push(ej); else if (ej.type === 'land') preLand = ej;
        }
        if (trig < 0 && evs.length === 0 && pred(null, g)) trig = i;
        if (trig >= 0) { t += STEP; if (t >= extra) break; }
      }
      if (trig < 0) console.warn('[VB] escena ' + name + ': no se alcanzó el momento buscado');
      fxAge = Math.min(0.6, extra || 0); // edad de los efectos del evento que dispara la escena (ver frame)
      return keep;
    }
    function uiIngest(evs, g) { call('UI', 'ingest', evs, g); }
    var g, keep = [], state = 'playing', live = Q.live === '1';
    switch (name) {
      case 'menu': case 'tutorial': case 'controls': case 'settings':
        ctx.actions.toMenu(); return;
      case 'serve': case 'hud':
        // sin la regla de 8 s: las capturas largas no acaban en falta de saque (&clock=1 la activa)
        g = mk(false, Q.clock !== '1'); break;
      case 'toss': case 'jumpserve': // saque humano con el balón en el aire (flotante / en salto)
        g = mk(false, true);
        for (var si = 0; si < 240 && !g.serveAuth; si++) Sim.step(g, STEP, null);
        Sim.step(g, STEP, { move: [0, 0], hit: name === 'toss', jump: name === 'jumpserve', switchPlayer: false });
        for (var sj = 0; sj < (name === 'toss' ? 50 : 145); sj++) Sim.step(g, STEP, null);
        Sim.drainEvents(g, keep);
        // sin 'newMatch': su banner "Set 1" taparía la escena congelada para siempre
        keep = keep.filter(function (e) { return e.type !== 'newMatch'; }); break;
      case 'dive': // plancha que se lea como plano principal
        g = mk(true);
        // Por defecto, plancha de NUESTRO equipo hecha por el que NO controlamos, con el compañero controlado más cerca de
        // la red (≥ 1,5 m) y el que se tira a < 4,8 m de ella: la cámara va detrás del controlado y el que se tira queda
        // DELANTE, a media distancia y grande en el plano (seed 7: la 6.ª plancha propia, ~325 s de juego; seeds 2-5 también
        // tienen una). La de la CPU, al otro lado de la red, quedaba diminuta (~85 px a 1280x720, ~25 px a 844x390), y la
        // del jugador controlado tampoco sirve (el cambio automático lleva la cámara al compañero y el que se tira queda
        // detrás de ella). Si no hay ninguna en 30 min de juego, la primera de la CPU.
        // &team=0|1|any elige quién (sin el filtro de plano), &n=N la N-ésima, &t=s el instante tras el contacto (0,22 s: ya tendido).
        var dT = Q.t ? +Q.t : 0.22, dN = Q.n ? +Q.n : 1, dSeen = 0;
        if (Q.team == null) {
          keep = advanceUntil(g, function (e, gg) {
            if (!e || e.type !== 'dive' || e.miss || e.player.team !== 0) return false;
            var d = e.player, c = gg.ctrl;
            return c && c !== d && c.team === 0 && Math.abs(d.x) < 4.8 && Math.abs(c.x) < Math.abs(d.x) - 1.5 && ++dSeen >= dN;
          }, dT, 1800);
          if (!keep.length) { g = mk(true); dSeen = 0; keep = advanceUntil(g, function (e) { return e && e.type === 'dive' && !e.miss && e.player.team === 1 && ++dSeen >= dN; }, dT, 1800); }
        } else {
          var dTeam = Q.team === 'any' ? -1 : +Q.team;
          keep = advanceUntil(g, function (e) { return e && e.type === 'dive' && !e.miss && (dTeam < 0 || e.player.team === dTeam) && ++dSeen >= dN; }, dT, 1800);
        }
        break;
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
        keep = advanceUntil(g, function (e) { return e && e.type === 'point'; }, 0.5, 600, uiIngest);
        if (preLand) keep.unshift(preLand); // el bote que decide el punto: FX/arena pintan su marca como en vivo
        break;
      case 'ace':
        // ace NUESTRO (banner dorado). Con el autopilot en Normal casi no hay aces: la escena va en Fácil
        // salvo &diff= (seed 7 → ace a los ~96 s). sim >= v2 lo marca en point.how (con roce de recepción, rallyHits > 0).
        if (!Q.diff) diff = 'easy';
        g = mk(true);
        keep = advanceUntil(g, function (e) { return e && e.type === 'point' && e.team === 0 && (e.how ? e.how === 'ace' : (!e.sideout && !e.rallyHits && e.reason === 'in')); }, 0.5, 1500, uiIngest);
        if (preLand) keep.unshift(preLand);
        break;
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

  // ---------- Precalentado de GPU ----------
  // Compila todos los programas y sube todas las texturas ANTES de que se vean, para que el primer remate,
  // la primera onda o el primer confeti no paren el juego 50-150 ms. Con render=true (solo tras el telón de
  // carga) también pinta un frame con los objetos ocultos visibles (pools de FX, confeti, etc.): así se
  // compilan los programas de sombra y de post-proceso que compile() no cubre. Después los vuelve a ocultar.
  function prewarm(mode) {
    var render = mode === 'r', compile = mode === 'r' || mode === 'c';
    var r = ctx.renderer, sc = ctx.scene; if (!r || !sc || glLost) return;
    var t0 = performance.now(), hid = [], tex = [], seen = typeof Set === 'function' ? new Set() : null;
    function addTex(t) { if (t && t.isTexture && !t.isRenderTargetTexture && t.image && seen && !seen.has(t)) { seen.add(t); tex.push(t); } }
    function scanMat(m) {
      for (var k in m) { var v = m[k]; if (v && v.isTexture) addTex(v); }
      var u = m.uniforms; if (u) for (var n in u) { var x = u[n] && u[n].value; if (x && x.isTexture) addTex(x); }
    }
    try {
      sc.traverse(function (o) {
        if (render && !o.visible) { hid.push(o); o.visible = true; }
        var m = o.material; if (!m) return;
        if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) scanMat(m[i]); } else scanMat(m);
      });
      for (var j = 0; j < tex.length; j++) { try { r.initTexture(tex[j]); } catch (e) { } }
      if (compile) r.compile(sc, ctx.camera);
      if (render) { r.info.reset(); if (ctx.renderFn) ctx.renderFn(ctx); else r.render(sc, ctx.camera); }
    } catch (e) { reportError('prewarm', e); }
    for (var h = 0; h < hid.length; h++) hid[h].visible = false;
    ctx.prewarmMs = Math.round(performance.now() - t0);
    if (ctx.debug) console.info('[VB] precalentado: ' + (r.info.programs ? r.info.programs.length : '?') + ' programas, ' + tex.length + ' texturas, ' + Math.round(performance.now() - t0) + ' ms');
  }
  ctx.prewarm = prewarm;

  // ---------- Precompilado de programas ASÍNCRONO (UI-01) ----------
  // El primer remate/onda/confeti estrenaba programas en pleno peloteo (medido con progs.js: 5 programas tras empezar, uno de
  // 168 ms). Se compilan antes: escena + VB.Arena.prewarmList() (copias de TODO arena y de los pools de fx.js que comparten
  // geometría y material) dentro de ctx.scene (mismas luces, niebla y entorno = mismas claves de programa) y con el destino de
  // render real (con el post de arena activo, los programas son otra variante).
  // three r149 hace compile() BLOQUEANTE: tras enlazar cada programa pide sus uniformes (getUniforms → getProgramParameter espera
  // a que el driver acabe; ANGLE/D3D11 ~100 ms por programa: 3,2 s al arrancar). Con KHR_parallel_shader_compile: durante
  // compile() los programas NUEVOS devuelven uniformes vacíos (no bloquea; el driver compila en paralelo), luego se devuelve su
  // getUniforms real y se borra currentProgram de los materiales afectados (el siguiente render rehace su lista de uniformes con
  // el programa ya enlazado, sin esperar). El estado se sondea con COMPLETION_STATUS_KHR, que no bloquea.
  // Sin la extensión: VB.Arena.prewarmCompile() (bloqueante, 0,3-0,6 s), bajo el telón y al empezar partido.
  var progWarm = { pending: null, t0: 0, ext: null, n: 0, waitMs: 0, issueMs: 0, gate: false, drawMs: 0 }, needWarmDraw = false;
  var DUMMY_UNIFORMS = { seq: [], map: {}, setValue: function () { } };
  function prewarmPrograms(gate) {
    var r = ctx.renderer, sc = ctx.scene; if (!r || !sc || glLost || Q.prewarm === '0') return;
    var t0 = performance.now(), gl = r.getContext(), ext = null;
    try { ext = gl.getExtension('KHR_parallel_shader_compile'); } catch (e) { }
    if (!ext || Q.prewarm === 'sync') {
      if (VB.Arena && VB.Arena.prewarmCompile) { try { ctx.prewarmMs = VB.Arena.prewarmCompile(); } catch (e) { reportError('prewarmCompile', e); } }
      return;
    }
    var list = [], grp = new THREE.Group(), progs = r.info.programs, push = progs.push, wrapped = [], prevRT = r.getRenderTarget();
    try { if (VB.Arena && VB.Arena.prewarmList) list = VB.Arena.prewarmList() || []; } catch (e) { reportError('prewarmList', e); }
    grp.name = 'prewarm';
    for (var i = 0; i < list.length; i++) grp.add(list[i]);
    try {
      sc.add(grp); grp.updateMatrixWorld(true);
      var rt = null;
      if (VB.Arena) {
        if (VB.Arena.prewarmTarget) rt = VB.Arena.prewarmTarget();
        else if (VB.Arena.postActive && VB.Arena.postActive() && VB.Arena._dbg) { var dd = VB.Arena._dbg(); rt = dd && dd.post && dd.post.rt || null; }
      }
      if (rt) r.setRenderTarget(rt);
      // programas nuevos: uniformes vacíos mientras dura compile() (no espera al enlace)
      progs.push = function (p) { if (p && p.getUniforms) { wrapped.push(p, p.getUniforms); p.getUniforms = function () { return DUMMY_UNIFORMS; }; } return push.apply(progs, arguments); };
      // en depuración three comprueba cada programa al crearlo (getProgramInfoLog espera al driver): se comprueba al acabar
      var chk = r.debug.checkShaderErrors; r.debug.checkShaderErrors = false;
      try {
        r.compile(sc, ctx.camera);
        extraCompile(r, sc);
      } finally { r.debug.checkShaderErrors = chk; }
    } catch (e) { reportError('prewarmPrograms', e); }
    delete progs.push; if (progs.push !== push) progs.push = push;
    r.setRenderTarget(prevRT); sc.remove(grp);
    var pend = [];
    if (wrapped.length) {
      var set = typeof Set === 'function' ? new Set() : null;
      for (var w = 0; w < wrapped.length; w += 2) { wrapped[w].getUniforms = wrapped[w + 1]; pend.push(wrapped[w]); if (set) set.add(wrapped[w]); }
      // los materiales que se quedaron con la lista de uniformes vacía la rehacen en su próximo render
      var fix = function (m) { if (!m) return; var pr = r.properties.get(m); if (pr && pr.currentProgram && set && set.has(pr.currentProgram)) { pr.currentProgram = undefined; pr.uniformsList = null; } };
      var fixObj = function (o) { var m = o.material; if (!m) return; if (Array.isArray(m)) { for (var k = 0; k < m.length; k++) fix(m[k]); } else fix(m); };
      sc.traverse(fixObj); for (var j = 0; j < list.length; j++) fixObj(list[j]);
    }
    progWarm.ext = ext; progWarm.pending = pend.length ? pend : null; progWarm.t0 = performance.now(); progWarm.n = pend.length;
    progWarm.gate = !!gate && pend.length > 0; progWarm.issueMs = Math.round(performance.now() - t0); progWarm.total = r.info.programs.length;
    ctx.prewarmMs = (ctx.prewarmMs || 0) + progWarm.issueMs;
    if (ctx.debug) console.info('[VB] precompilado asíncrono: ' + pend.length + ' programas nuevos, ' + list.length + ' copias, ' + progWarm.issueMs + ' ms en el hilo');
  }
  // Lo que compile() no ve: los materiales de profundidad de las sombras (se pintan con una escena vacía: sin niebla ni luces)
  // y las pasadas del post-proceso de arena (cuadro a pantalla completa: brillo/desenfoque/copia al destino lineal y la mezcla
  // final a pantalla). Sin esto, el primer render los estrenaba de golpe (~0,6 s parado tras el telón).
  var _warmGeo = null, _warmDepth = null;
  function extraCompile(r, sc) {
    var THREE_ = THREE, tmp = new THREE_.Scene(), seen = {};
    if (!_warmGeo) _warmGeo = new THREE_.PlaneGeometry(1, 1);
    if (!_warmDepth) _warmDepth = new THREE_.MeshDepthMaterial({ depthPacking: THREE_.RGBADepthPacking });
    if (ctx.quality && ctx.quality.shadows) {
      var SIDE = [THREE_.BackSide, THREE_.FrontSide, THREE_.DoubleSide]; // three: lado de la sombra = el contrario del material
      sc.traverse(function (o) {
        if (!o.isMesh || !o.castShadow || !o.material) return;
        var ms = Array.isArray(o.material) ? o.material : null;
        if (ms) { for (var mi = 0; mi < ms.length; mi++) addCaster(o, ms[mi]); } else addCaster(o, o.material);
      });
      function addCaster(o, m) {
        var side = m.shadowSide != null ? m.shadowSide : SIDE[m.side | 0], cut = !!(m.map && m.alphaTest > 0) || !!(m.alphaMap && m.alphaTest > 0);
        var base = o.customDepthMaterial || _warmDepth;
        var k = (o.isSkinnedMesh ? 'S' + o.skeleton.bones.length : o.isInstancedMesh ? 'I' + (o.instanceColor ? 'c' : '') : 'M') + base.id + '|' + side + '|' + (cut ? 1 : 0); if (seen[k]) return; seen[k] = 1;
        var dm = base.clone(); dm.side = side;
        if (cut) { dm.map = m.map; dm.alphaMap = m.alphaMap; dm.alphaTest = m.alphaTest; }
        var px;
        if (o.isSkinnedMesh) { px = new THREE_.SkinnedMesh(o.geometry, dm); px.bind(o.skeleton, o.bindMatrix); }
        else if (o.isInstancedMesh) { px = new THREE_.InstancedMesh(o.geometry, dm, 1); if (o.instanceColor) px.instanceColor = o.instanceColor; }
        else px = new THREE_.Mesh(_warmGeo, dm);
        px.frustumCulled = false; tmp.children.push(px);
      }
      // la pasada de sombras se pinta con el estado de luces de la escena: mismas luces (sin re-emparentarlas) = misma clave
      if (tmp.children.length) { sc.traverseVisible(function (o) { if (o.isLight) tmp.children.push(o); }); r.compile(tmp, ctx.camera); }
      tmp.children.length = 0;
    }
    // pasadas del post-proceso (VB.Arena.prewarmPasses() → [{material, target}] si existe; si no, las de _dbg().post)
    var passes = null;
    try {
      if (VB.Arena && VB.Arena.prewarmPasses) passes = VB.Arena.prewarmPasses();
      else if (VB.Arena && VB.Arena.postActive && VB.Arena.postActive() && VB.Arena._dbg) {
        var P = VB.Arena._dbg().post;
        if (P && P.bright) passes = [{ material: P.bright, target: P.a1 }, { material: P.blur, target: P.b1 }, { material: P.copy, target: P.a2 }, { material: P.comp, target: null }];
      }
    } catch (e) { passes = null; }
    if (passes && passes.length) {
      var q = new THREE_.Mesh(_warmGeo, passes[0].material), prev = r.getRenderTarget();
      q.frustumCulled = false; tmp.children.push(q);
      for (var i = 0; i < passes.length; i++) { if (!passes[i] || !passes[i].material) continue; q.material = passes[i].material; r.setRenderTarget(passes[i].target || null); r.compile(tmp, ctx.camera); }
      r.setRenderTarget(prev); tmp.children.length = 0;
    }
  }
  /** ¿Siguen compilándose programas del precalentado? (no bloquea; tope de 8 s). */
  function progsPending() {
    var P = progWarm.pending; if (!P) return false;
    var gl = ctx.renderer.getContext(), CS = progWarm.ext.COMPLETION_STATUS_KHR, left = 0;
    for (var i = 0; i < P.length; i++) { var p = P[i]; if (p && p.program && !gl.getProgramParameter(p.program, CS)) { left++; break; } }
    if (!left || performance.now() - progWarm.t0 > 8000) {
      progWarm.waitMs = Math.round(performance.now() - progWarm.t0); progWarm.pending = null; progWarm.gate = false;
      if (ctx.renderer.debug.checkShaderErrors) { // depuración: errores de enlace como los daría three (ya no bloquea: están listos)
        for (var j = 0; j < P.length; j++) {
          var q = P[j]; if (!q || !q.program || gl.getProgramParameter(q.program, 35714)) continue;
          console.error('THREE.WebGLProgram: Shader Error - ' + (q.name || '') + ' (precompilado) ' + gl.getProgramInfoLog(q.program));
        }
      }
      if (ctx.debug) console.info('[VB] precompilado listo: ' + progWarm.n + ' programas en ' + progWarm.waitMs + ' ms (en paralelo)');
      return false;
    }
    return true;
  }
  ctx.prewarmInfo = function () { return { n: progWarm.n, total: progWarm.total, issueMs: progWarm.issueMs, waitMs: progWarm.waitMs, pending: !!progWarm.pending, drawMs: progWarm.drawMs || 0 }; };

  // ---------- Primer dibujo de todo, bajo el telón (UI-01) ----------
  // Programas enlazados no bastan: ANGLE (D3D11) compila en el primer DIBUJO de cada programa la variante del shader para su
  // formato de vértices (trazas: pares de tareas de compilación de ~3 ms y frames de 40-55 ms al empezar el partido, cuando la
  // cámara de juego mira por primera vez la grada del fondo, la silla del árbitro, el marcador…). Con los programas ya listos,
  // un único render con TODO visible y sin recorte por cámara cuesta poco y se hace bajo el telón, antes del primer frame real.
  function warmDraw() {
    var r = ctx.renderer, sc = ctx.scene; if (!r || !sc || glLost || Q.prewarm === '0') return;
    var t0 = performance.now(), vis = [], cull = [], list = [], grp = null;
    try {
      try { if (VB.Arena && VB.Arena.prewarmList) list = VB.Arena.prewarmList() || []; } catch (e) { list = []; }
      if (list.length) { grp = new THREE.Group(); for (var i = 0; i < list.length; i++) grp.add(list[i]); sc.add(grp); grp.updateMatrixWorld(true); }
      sc.traverse(function (o) {
        if (!o.visible) { vis.push(o); o.visible = true; }
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite) { if (o.frustumCulled) { cull.push(o); o.frustumCulled = false; } }
      });
      r.info.reset();
      if (ctx.renderFn) ctx.renderFn(ctx); else r.render(sc, ctx.camera);
    } catch (e) { reportError('warmDraw', e); }
    for (var a = 0; a < vis.length; a++) vis[a].visible = false;
    for (var b = 0; b < cull.length; b++) cull[b].frustumCulled = true;
    if (grp) sc.remove(grp);
    progWarm.drawMs = Math.round(performance.now() - t0);
    ctx.prewarmMs = (ctx.prewarmMs || 0) + progWarm.drawMs;
    if (ctx.debug) console.info('[VB] primer dibujo de todo: ' + vis.length + ' ocultos, ' + cull.length + ' sin recorte, ' + list.length + ' copias, ' + progWarm.drawMs + ' ms');
  }

  // ---------- Arranque ----------
  function boot() {
    // UI-23: el documento está en castellano (lectores de pantalla, separación de sílabas, traducción automática). index.html no
    // lleva <html> (Artifact): se pone aquí, lo primero
    try { document.documentElement.lang = 'es'; } catch (e) { }
    if (!THREE) { showFatal('No se ha podido cargar el motor 3D. Revisa la conexión y recarga la página.'); return; }
    if (!Sim) { showFatal('No se ha podido cargar la simulación del juego.'); return; }
    var bi = ctx.bootInfo = { t0: Math.round(performance.now()) }, tb = performance.now();
    try { initRenderer(); }
    catch (e) { console.error(e); showFatal('Tu navegador no permite WebGL. Prueba con otro navegador o activa la aceleración por hardware.'); return; }
    bi.renderer = Math.round(performance.now() - tb);
    // UI-07: con el contexto WebGL ya creado (lo crea el hilo principal de la GPU), ui.js monta bajo el telón el primer paso
    // del ensayo de estilos del HUD y se deja UN frame para que llegue al compositor: la GPU lo rasteriza mientras el hilo
    // principal construye el pabellón (CPU pura, ~0,35 s), en vez de después. El ensayo y el contexto WebGL comparten el hilo
    // principal de la GPU: montarlo antes de crear el contexto solo retrasaba la creación (medido). &preboot=0 lo desactiva.
    if (!ctx.debug && Q.preboot !== '0' && bootEl && !bootEl.hidden && VB.UI && VB.UI.preboot) {
      var pre = false; try { pre = VB.UI.preboot(ctx) !== false; } catch (e) { reportError('UI.preboot', e); }
      if (pre) { requestAnimationFrame(function () { setTimeout(function () { bi.yield = Math.round(performance.now() - bi.t0 - bi.renderer); bootRest(); }, 0); }); return; }
    }
    bootRest();
  }
  function bootRest() {
    var bi = ctx.bootInfo, tb = performance.now();
    for (var i = 0; i < MODS.length; i++) { call(MODS[i], 'init', ctx); var tn = performance.now(); bi[MODS[i]] = Math.round(tn - tb); tb = tn; }
    applyQuality(ctx.quality);
    bi.quality = Math.round(performance.now() - tb);
    call('Audio', 'setMuted', !!ctx.settings.muted);
    for (var j = 0; j < MODS.length; j++) call(MODS[j], 'onSettings', ctx.settings, null);
    // primer gesto del usuario: desbloquea el audio
    var unlock = function () { call('Audio', 'unlock'); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('resize', function () { sizeDirty = true; });
    try { if (window.ResizeObserver) new ResizeObserver(function () { sizeDirty = true; }).observe(ctx.container); } catch (e) { }
    document.addEventListener('visibilitychange', function () { if (document.hidden && ctx.state === 'playing' && !ctx.debug) ctx.actions.pause(); last = 0; });
    window.addEventListener('blur', function () { if (ctx.state === 'playing' && !ctx.debug) ctx.actions.pause(); });
    if (ctx.debug) debugScene(ctx.debug); else ctx.actions.toMenu();
    if (Q.prewarm !== '0') prewarm(Q.prewarm === 'c' || Q.prewarm === 'r' ? Q.prewarm : 't'); // tras el telón de carga (en depuración, el primer frame lo tapa)
    // programas: en paralelo bajo el telón; no se pinta hasta que estén (el hilo queda libre: telón, fuentes y audio siguen)
    if (Q.prewarm !== '0' && Q.prewarm !== 'c' && Q.prewarm !== 'r') { prewarmPrograms(true); needWarmDraw = Q.warmdraw !== '0'; }
    aq.boot = performance.now();
    aq.warmUntil = aq.boot + (Q.aqwarm != null ? +Q.aqwarm * 1000 : 8000); // calentamiento sin calidad adaptativa
    bi.end = Math.round(performance.now());
    requestAnimationFrame(frame);
  }
  function showFatal(msg, soft) {
    var d = document.getElementById('fatal');
    if (d) { d.innerHTML = '<b>Voley 3D</b><span></span>'; d.lastChild.textContent = msg; d.hidden = false; d.classList.toggle('soft', !!soft); }
    if (bootEl) bootEl.hidden = true;
  }
  VB.boot = boot;
  // UI-07: el arranque (montar el pabellón, el público, las texturas…) ocupa el hilo principal ~0,6 s. El telón ya sale entero en
  // el primer frame (logotipo con la fuente embebida, sin esperar a Google Fonts): se deja pintar ese frame y se arranca.
  (function startBoot() {
    var started = false;
    function go() { if (started) return; started = true; boot(); }
    if (ctx.debug || Q.bootwait === '0' || !document.getElementById('boot')) { go(); return; }
    requestAnimationFrame(function () { setTimeout(go, 0); });
    setTimeout(go, 400);   // pestaña en segundo plano (sin rAF): arranca igual
  })();
})();
