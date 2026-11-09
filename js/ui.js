/* =====================================================================
 * VOLEY 3D — js/ui.js   (owner: ui_main)
 * Interfaz en DOM sobre el lienzo, en castellano:
 *   - Marcador de retransmisión (sets, puntos, saque, punto de set/partido,
 *     historial de sets), contador de toques del equipo (recepción/defensa,
 *     colocación, ataque), avisos contextuales ("¡Golpea ahora!", "¡Salta!"),
 *     consejos para principiantes y banners animados (Punto, Ace, Remate,
 *     Bloqueo, Cambio de saque, Punto de set/partido, Set, Partido).
 *   - Menú principal sobre la demo en directo, dificultad, tutorial
 *     interactivo con diagramas animados, controles, ajustes.
 *   - Pausa, pantalla final con estadísticas, aviso de girar el móvil.
 *   - Navegación con teclado (flechas/Intro/Esc) y mando (stick/A/B).
 * API pública (todas opcionales para main.js, ver CONTRACT.md §4.4):
 *   init, onState, onSettings, onGameStart, update, banner,
 *   nav(it, realDt)  -> navegación de menús con mando (main.js, fuera de partido)
 *   back()           -> cierra el panel abierto; true si lo ha consumido
 *   ingest(events,g) -> solo estadísticas (escenas de depuración)
 *   isPanelOpen()
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var ctx, $ = function (id) { return document.getElementById(id); };
  var el = {}, last = {}, shown = '', panel = null, panelFrom = 'menu';
  var banT = 0, banOut = false, calloutT = 0;
  // Presentación (UI-02/03/04): banKind = qué anuncia el banner visible ('point' | 'set' | 'match' | 'court' | 'info' | 'sp');
  // banGate = cómo acaba ('cut' = con el corte de vuelta al saque; 'court' = al bajar la grúa del cambio de campo)
  var banKind = '', banTier = 0, banRect = null, bugT = 0, bugOut = false;
  var record = { played: 0, wins: 0, bestStreak: 0, winRun: 0, tut: 0 };
  var hudScale = 1;            // UI-16: escala del HUD (ctx.settings.hudScale)

  // ---------- Telón de carga → menú (UI-07) ----------
  // El telón sale entero en el primer frame (logotipo con la fuente embebida «VB Marca», index.html). Relevo en dos tiempos:
  //  1. MENÚ: el logotipo vuela a su sitio y el menú entra en cascada (ya se puede pulsar) en cuanto la escena está pintada
  //     (bootReady: programas enlazados y primeros frames hechos; mientras la GPU enlaza no hay frames fluidos y el vuelo iría a
  //     tirones, medido), o como muy tarde a BOOT_CAP ms de la navegación. Si el ensayo de estilos no ha acabado, el fondo del
  //     telón se queda DEBAJO del menú (z 9: tapa lienzo, HUD y el ensayo, que se para durante el vuelo y luego sigue).
  //  2. PABELLÓN: con el ensayo hecho (tope 1,7 s desde la escena lista), el fondo se funde y aparece el pabellón.
  // Las fuentes de Google (script en línea de index.html: window.__vbFonts / __vbOnFonts, que avisa YA si la hoja no ha cargado)
  // solo retienen el relevo junto, como mucho 0,6 s desde la escena lista, y nunca pasado BOOT_CAP.
  // JUGAR antes del tiempo 2: la cortinilla de pantalla cubre y espera a que el pabellón esté listo (wipeTickRun).
  var fontsReady = false, bootWant = null, bootT0 = 0, BOOT_CAP = 2600, bootStage = 0, bootBg = null, bootFly = 0;
  (function waitFonts() {
    if (window.__vbFonts) { fontsReady = true; return; }
    var prev = window.__vbOnFonts;
    window.__vbOnFonts = function () { fontsReady = true; if (prev) try { prev(); } catch (e) { } tryReveal(); };
    setTimeout(function () { fontsReady = true; tryReveal(); }, Math.max(0, 2500 - performance.now()));
  })();
  /** main.js (frame 3, fuera de depuración): la escena está lista. */
  function bootReady(b) {
    bootWant = b; bootT0 = performance.now();
    tryReveal();
    return true;
  }
  /** Se llama en cada frame mientras el relevo no ha acabado (y al llegar fuentes, escena o fin del ensayo). */
  function tryReveal() {
    if (bootStage >= 2 || !ctx) return;
    var b = document.getElementById('boot'); if (!b || (b.hidden && !b.__done)) { bootStage = 2; return; }   // sin telón (escenas debug=): nada que relevar
    // escenas debug=: el telón lo quita main.js en el 3.er frame pintado (sin bootReady). Aquí nunca se empieza un relevo: con el
    // enlace de programas lento el 3.er frame llegaba pasado BOOT_CAP, salía un relevo PARCIAL y el fondo del telón tapaba el
    // pabellón bajo el menú hasta la red de seguridad (7,6 s; debug=menu a 4 s sin escena en shot.sh, también a 1280×720).
    if (ctx.debug) return;
    var now = performance.now(), cap = ctx.params && ctx.params.bootcap ? +ctx.params.bootcap : BOOT_CAP;   // &bootcap=ms (pruebas)
    var ready = !!bootWant;                  // programas enlazados y escena ya pintada (sus primeros frames, los caros, pasaron)
    if (bootStage === 0) {
      if (!el.menu || el.menu.hidden || ctx.state !== 'menu') return;
      if (!ready && now < cap) return;
      if (ready && !fontsReady && now - bootT0 < 600 && now < cap) return;
      var full = ready && gym.done;          // todo hecho: un solo relevo (el fondo se funde con el vuelo)
      bootReveal(b, !full);
      if (full) return;
    }
    // tiempo 2: escena lista, vuelo acabado y ensayo hecho (tope: 1,7 s desde la escena lista, contando la pausa del vuelo)
    if (bootStage === 1 && now >= bootFly && (ready && (gym.done || now - bootT0 >= 1700) || now >= cap + 5000)) bootBgOut();   // (+5 s: red de seguridad si la escena no llega a pintarse)
  }
  /** Relevo coreografiado: el logotipo del telón vuela (FLIP, solo transform) hasta el sitio del logotipo del menú mientras
   *  las opciones del menú entran en cascada (ya se pueden pulsar) y el fondo del telón se funde (o, con partial, se queda bajo
   *  el menú hasta bootBgOut); al aterrizar, el logotipo del menú lo releva en el mismo frame (nunca hay dos). Movimiento
   *  reducido: fundido cruzado de 150 ms. */
  function bootReveal(b, partial) {
    if (!b || b.__done) return; b.__done = true;
    var bg = b.querySelector('.bt-bg');
    if (partial && bg && el.menu && el.menu.parentNode) {
      bootStage = 1; bootBg = bg; bg.classList.add('under'); el.app.classList.add('bt-wait');
      el.menu.parentNode.insertBefore(bg, el.menu);     // mismo contexto de apilado que el menú (z 10) y el HUD (z 3)
    } else {
      bootStage = 2; bootWant = null;
      if (!gym.done) gymEnd();
    }
    var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
    var M = el.menu && !el.menu.hidden ? el.menu.querySelector('.logo') : null, L = b.querySelector('.bt-logo');
    function land() {
      if (el.menu) el.menu.classList.remove('lgwait', 'intro');
      b.hidden = true; b.classList.remove('flying', 'xfade');
    }
    if (reduce || !M || !L) {
      b.classList.add('xfade'); if (el.menu) el.menu.classList.remove('intro');
      setTimeout(land, 160); return;
    }
    var rb = L.getBoundingClientRect(), rm = M.getBoundingClientRect();
    var sc = rb.width > 0 ? rm.width / rb.width : 1, dx = rm.left - rb.left, dy = rm.top - rb.top;
    L.style.transformOrigin = '0 0';
    L.style.transition = 'transform .64s cubic-bezier(.65,0,.22,1)';
    void L.offsetWidth;
    L.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0) scale(' + sc.toFixed(4) + ')';
    b.classList.add('flying'); bootFly = performance.now() + 760;
    // el menú entra a la vez que vuela el logotipo (sin el suyo hasta el aterrizaje)
    if (el.menu) { el.menu.classList.add('lgwait', 'enter'); el.menu.classList.remove('intro'); }
    var landed = false, fin = function () { if (landed) return; landed = true; land(); };
    L.addEventListener('transitionend', function (ev) { if (ev.propertyName === 'transform') fin(); });
    setTimeout(fin, 740);
  }
  /** Tiempo 2 tras un relevo parcial: el fondo del telón (bajo el menú) se funde y aparece el pabellón. Seco si ya no estamos en
   *  el menú o una cortinilla de pantalla lo tapa. */
  function bootBgOut() {
    var bg = bootBg; bootStage = 2; bootWant = null;
    if (!gym.done) gymEnd();
    if (!bg) return;
    bg.__out = true; el.app.classList.remove('bt-wait');
    var dry = ctx.state !== 'menu' || !!wp.ph;
    // «EN DIRECTO · DEMO» solo cuando se ve la demo
    var lv = el.menu && el.menu.querySelector('.live');
    if (lv && lv.animate && !dry) { try { lv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 250, easing: 'ease-out', fill: 'backwards' }); } catch (e) { } }
    if (dry) { if (bg.parentNode) bg.parentNode.removeChild(bg); bootBg = null; return; }
    bg.style.opacity = '0';
    setTimeout(function () { if (bg.parentNode) bg.parentNode.removeChild(bg); if (bootBg === bg) bootBg = null; }, 650);
  }
  /** ¿Sigue tapado el pabellón por el arranque? (la cortinilla de pantalla espera; el menú no navega con el telón entero). */
  function bootBusy() { return bootStage < 2 && !!ctx && !ctx.debug && !!document.getElementById('boot') && performance.now() < 9000; }
  /** ¿Hay algo opaco al 99,5 % encima del HUD bajo lo que ensayar estilos? (telón entero, o su fondo bajo el menú) */
  function gymCover() {
    if (bootStage === 1) return !!bootBg && !bootBg.__out;
    var bt = document.getElementById('boot');
    return !!bt && !bt.hidden && !/\b(flying|xfade|gone)\b/.test(bt.className);
  }
  var BAN = { point: 1.6, set: 2.6, match: 3.2, info: 1.5, ace: 1.8, sp: 1.5 };

  // ---------- Precalentado de estilos del HUD (UI-01) ----------
  // La primera vez que Chrome pinta un efecto (sombra con desenfoque, degradado, capa animada) compila sus shaders en el
  // proceso de GPU (Skia sobre ANGLE): medido, el primer «¡Golpea ahora!» costaba un frame de 45-55 ms con el JS del frame en
  // 1 ms, y la segunda vez nada. Mientras está el telón de carga se pinta UNA vez, casi transparente, cada estado
  // visual del banner, la pestaña de punto, el aviso, el consejo, la tarjeta guiada y el contador; luego todo vuelve a su sitio.
  var gym = { i: -1, f: 0, ts: 0, lf: 0, fast: 0, done: false };
  // 4 pasos con varios estados a la vez (cada combinación de forma y efecto pide sus propios shaders): teclas de teclado, mando
  // y táctil en el mismo aviso, cinta + pestaña + aviso corto + tarjeta guiada + consejo + contador + etiqueta de punto de set.
  var GYM = [
    function () { gymBan('¡Remate!', 'Recepción fuera', 'CAMBIO DE SAQUE', 'show win r2 at-l'); gymPr('hit go bar anch', '¡Golpea ahora!', 'key', 1); gymBug('show t0 two', 1);
      el.callout.className = 'show c0'; el.guide.className = 'show'; el.rl.className = 'rl on'; el.rlN.className = 'bump'; el.coach.className = ''; el.touchbar.className = ''; el.tb[0].className = 'tb-seg done'; el.tb[1].className = 'tb-seg next';
      el.tag.hidden = false; el.tag.textContent = 'PUNTO DE SET'; gymTouch(0); gymStamp('on pf', ''); el.off.className = 'on'; el.off.style.transform = 'translate3d(60px,' + Math.round(ctx.height * 0.5) + 'px,0)'; },
    function () { gymBan('Punto de set', 'Un punto para ganar el 1.er set', '', 'show gold compact'); gymPr('jump go anch thru', '¡Salta! · Bloqueo', 'key', 1); gymBug('show t1', 0);
      el.callout.className = 'show good'; el.coach.className = 'faint'; el.rl.className = 'rl on hot'; el.rlN.className = ''; el.touchbar.className = 'thru'; el.tag.className = 'sb-tag cpu'; el.guide.className = 'out'; gymTouch(1); gymStamp('on gd', 'un pelín tarde'); el.off.className = 'on t1'; },
    function () { gymBan('Gana la CPU', 'Sets 0-2', 'SETS 0-2', 'show lose t3 long'); gymPr('hit clk urg anch', 'Saca ya <span class="nu">1 s</span>', 'key', 1);
      gymBug('show t0 out fast', 0); el.rl.className = 'rl on end'; el.coach.className = 'thru'; gymTouch(2);
      el.callout.innerHTML = '¡Pronto!<span class="cg"><i class="cg-l"></i><span class="cg-t"><u></u><b style="left:30%"></b></span><i class="cg-r"></i></span>'; el.callout.className = 'show neg'; },
    function () { gymBan('¡Ace!', 'Saque directo', '', 'show ace r2 at-t out fast'); gymPr('hit soon bar anch', 'Espera… golpea al bajar', 'key', 0); el.callout.className = '';
      if (gym.pre) gymTouch(0); else gymTouchOff(); gymWipe('on cutw'); },
    // tarjeta de presentación (UI-14) y cortinilla de pantalla de la casa: sin ensayar, la tarjeta costaba un frame de 55-85 ms
    // ~0,1 s después de startMatch (raster en la GPU con compilación de shaders de Skia; traza de smtrace.js)
    function () { gymBan('Cambio de campo', 'Fin del 1.er set', '', 'show neutral fastin mid'); gymPr('wait anch', 'Espera el silbato', 'key', 0); el.pbug.className = ''; gymTouchOff();
      gymIntro(); gymWipe('on brand cutw'); }
  ];
  // controles táctiles de input.js (solo en táctil): se enseñan con sus estados (listo, aro, pulsado, apagado, en reposo) y se
  // devuelven tal cual estaban (sin ellos, el primer frame del partido en el móvil costaba 120-130 ms de raster)
  var gymT = null;
  function gymTouch(stage) {
    var root = document.getElementById('touch'); if (!root || !ctx.isTouch || !root.firstChild) return;
    var nodes = root.querySelectorAll('.vt-btn,.vt-joy');
    if (!gymT) { gymT = { root: root, hid: root.hidden, cls: root.className, n: [] }; for (var i = 0; i < nodes.length; i++) gymT.n.push([nodes[i], nodes[i].className]); }
    root.hidden = false;
    root.className = stage === 0 ? 'on' : stage === 1 ? 'on idle' : 'on dead';
    for (var j = 0; j < gymT.n.length; j++) {
      var nd = gymT.n[j][0], base = gymT.n[j][1].replace(/\b(ready|cue|dn|off|see|idle)\b/g, '').replace(/\s+/g, ' ').trim();
      nd.className = base + (stage === 0 ? ' ready cue' : stage === 1 ? ' dn' : (j & 1 ? ' off' : ' see'));
    }
  }
  function gymTouchOff() {
    if (!gymT) return;
    gymT.root.hidden = gymT.hid; gymT.root.className = gymT.cls;
    for (var i = 0; i < gymT.n.length; i++) gymT.n[i][0].className = gymT.n[i][1];
    gymT = null;
  }
  function gymBan(t1, t2, t3, cls) {
    el.bn1.textContent = t1; el.bn2.textContent = t2; el.bn2.hidden = !t2; el.bn3.textContent = t3; el.bn3.hidden = !t3; el.bn3.classList.toggle('so', !!t3);
    el.banner.className = cls;
    if (/\br2\b/.test(cls)) { el.banner.style.left = '120px'; el.banner.style.top = Math.round(ctx.height * 0.6) + 'px'; } else { el.banner.style.left = el.banner.style.top = ''; }
  }
  var gymKeys = null;
  function gymPr(cls, txt, keyCls, allKeys) {
    el.prompt.className = cls; el.promptText.innerHTML = txt; el.promptKey.className = keyCls;
    // las otras teclas (mando A/B, táctil GOLPEAR/SALTAR) en el mismo aviso, junto a la de teclado
    if (allKeys && !gymKeys) {
      gymKeys = [['key pad pa', 'A'], ['key pad pb', 'B'], ['key tch', 'GOLPEAR'], ['key tch j', 'SALTAR']].map(function (k) {
        var n = document.createElement('span'); n.className = k[0]; n.textContent = k[1]; el.promptKey.parentNode.appendChild(n); return n;
      });
    } else if (!allKeys && gymKeys) gymKeysOff();
    el.prompt.style.transform = 'translate3d(' + Math.round(ctx.width * 0.55) + 'px,' + Math.round(ctx.height * 0.62) + 'px,0)';
    if (/clk/.test(cls)) el.promptRing.style.setProperty('--p', /urg/.test(cls) ? '0.2' : '0.7');
    el.promptBar.style.transform = 'scaleX(0.6)';
  }
  /** Cortinilla en el ensayo: tapando un cuarto de la pantalla (los shaders de sus degradados se compilan igual y rasteriza menos).
   *  Siempre con .cutw (z 2, bajo el fondo del telón): con el relevo parcial el menú ya está a la vista (la z 30 lo taparía). */
  // (una cortinilla de verdad en marcha —JUGAR en el tiempo 1 del relevo— no se toca)
  function gymWipe(cls) { if (ctx.params.gymwipe === '0' || wp.ph) return; el.wipe.className = cls; el.wpBand.style.transform = 'translate3d(' + Math.round(-(ctx.width || 1280) * 0.75) + 'px,0,0) skewX(-14deg)'; }
  function gymStamp(cls, hint) {
    el.stampT.textContent = /pf/.test(cls) ? 'Perfecto' : 'Bien'; el.stampS.textContent = hint; el.stampS.hidden = !hint;
    el.stamp.className = cls; el.stamp.style.transform = 'translate3d(' + Math.round(ctx.width * 0.3) + 'px,' + Math.round(ctx.height * 0.5) + 'px,0)'; el.stampIn.style.opacity = '1';
  }
  function gymIntro() {
    if (introUI.on || ctx.params.gymintro === '0') return;
    el.introDiff.textContent = 'Nivel Normal'; el.introSrv.textContent = 'Sacas tú';
    el.introHint.innerHTML = device() === 'gamepad' ? '<span class="key pad pa">A</span>para empezar ya' : 'Pulsa cualquier tecla para empezar ya';
    el.intro.className = 'show gy';
  }
  function gymBug(cls, tag) { el.pbT.textContent = 'Remate'; el.pbS.textContent = 'Fuera'; el.pbS.hidden = !/two/.test(cls); el.pbX.textContent = '⇄ Saque'; el.pbX.hidden = !tag; el.pbug.className = cls; }
  /** main.js, con el contexto WebGL creado y ANTES del arranque pesado: monta el primer paso del ensayo (el que más rasteriza) para
   *  que la GPU lo pinte mientras el hilo principal construye la escena (~0,6 s en los que la GPU estaba parada). Sin los
   *  controles táctiles (aún no existen: se ensayan en el paso 4). &preboot=0 lo desactiva (A/B). */
  function preboot(c) {
    if (gym.i >= 0 || gym.done) return false;
    ctx = ctx || c; cacheEls(); if (ctx.isTouch) el.app.classList.add('is-touch');
    var bt = document.getElementById('boot'); if (!bt || bt.hidden) return false;
    gym.pre = true; gym.t0 = performance.now(); gym.ts = gym.t0; gym.i = 0;
    el.hud.hidden = false; el.hud.classList.remove('warm');
    var bg = bt.querySelector('.bt-bg'); if (bg) bg.style.opacity = '0.995';
    try { GYM[0](); } catch (e) { gymEnd(); return false; }
    return true;
  }
  /** Un paso cada 2 frames, solo en el menú (bajo el telón al arrancar). */
  function gymTick() {
    if (gym.done) return;
    if (ctx.state !== 'menu' || panel || (gym.i < 0 && !el.hud.classList.contains('warm'))) { if (gym.i >= 0) gymEnd(); return; }
    var now = performance.now(); gym.f++;
    if (bootWant) tryReveal();                                  // tope del ensayo con la escena ya lista
    // empieza cuando la GPU ha terminado de enlazar los programas (si no, no rasteriza estos estados)
    // (también tras el paso montado antes del arranque: ensayo y enlace a la vez se estorban en la GPU y tardan lo mismo)
    if (ctx.prewarmInfo && ctx.prewarmInfo().pending) { gym.lf = 0; gym.fast = 0; return; }
    // relevo parcial: mientras vuela el logotipo y entra el menú no se ensaya nada (cada paso es un frame largo en la GPU)
    if (bootStage === 1 && now < bootFly) { gym.lf = 0; gym.fast = 0; return; }
    // siguiente paso cuando la GPU ha acabado con el anterior: 2 frames seguidos fluidos (< 26 ms) tras 50 ms como mínimo
    // (con 3 frames y 70 ms el ensayo se comía ~100 ms más del arranque sin compilar nada más: medido con trazas)
    var gap = gym.lf ? now - gym.lf : 99; gym.lf = now;
    gym.fast = gap < 26 ? gym.fast + 1 : 0;
    if (gym.i >= 0 && (now - gym.ts < 50 || gym.fast < 2)) return;
    gym.ts = now; gym.fast = 0;
    // el telón ya se va (o no hay): se acaba aquí, no debe verse nada en el menú
    // (sin telón —depuración— no hay ensayo: se vería; con el relevo parcial sigue bajo el fondo del telón, bajo el menú)
    if (!gymCover()) { gymEnd(); return; }
    var bt = document.getElementById('boot');
    // Debajo del telón, con el fondo del telón al 99,5 % de opacidad: lo de debajo se rasteriza (una capa opaca lo taparía y
    // Chrome se saltaría el raster) y no se ve (se cuela un 0,5 %). Medido: bajo el telón opaco no se compilaba nada; con
    // .warm (opacidad .01 en CADA descendiente) o con el contenedor a 1/255 Skia no pinta nada; encima del telón al 3 % se veía.
    if (gym.i < 0) {
      gym.t0 = performance.now();
      el.hud.classList.remove('warm');
      var bg = bootBg || (bt && bt.querySelector('.bt-bg')); if (bg) bg.style.opacity = '0.995';
    }
    if (el.hud.classList.contains('warm')) el.hud.classList.remove('warm');   // (el cambio a 'menu' tras preboot lo vuelve a poner)
    if (++gym.i < GYM.length) { try { GYM[gym.i](); } catch (e) { gymEnd(); } } else gymEnd();
  }
  function gymKeysOff() { if (gymKeys) { gymKeys.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); gymKeys = null; } }
  function gymEnd() {
    if (gym.done) return;
    gymKeysOff(); gymTouchOff();
    gym.done = true; gym.t1 = performance.now();
    setTimeout(tryReveal, 0);
    var bg = bootBg || document.querySelector('#boot .bt-bg'); if (bg && !bg.__out) bg.style.opacity = '';
    el.hud.classList.toggle('warm', ctx.state === 'menu');
    el.banner.className = ''; el.banner.style.left = el.banner.style.top = ''; el.bn3.hidden = true; el.bn3.classList.remove('so');
    el.pbug.className = ''; el.callout.className = ''; el.guide.className = '';
    el.stamp.className = ''; el.stamp.style.transform = ''; el.stampIn.style.opacity = '';
    el.rl.className = 'rl'; el.rlN.className = '';
    el.off.className = ''; el.off.style.transform = '';
    // (si el ensayo acaba con el partido ya empezado —JUGAR antes de que se vaya el telón—, no se pisan la cortinilla ni la
    // tarjeta de presentación que ya están en marcha; integración ola 2)
    if (!wp.ph) { el.wipe.className = ''; el.wpBand.style.transform = ''; wp.last = ''; }
    if (!introUI.on) el.intro.className = ''; else el.intro.classList.remove('gy');
    el.prompt.className = 'off'; el.prompt.style.transform = ''; el.promptKey.className = 'key'; el.promptBar.style.transform = 'scaleX(0)';
    el.coach.className = 'off'; el.touchbar.className = 'off'; el.tb[0].className = el.tb[1].className = 'tb-seg';
    el.tag.hidden = true; el.tag.className = 'sb-tag';
    anchorOn = false; prX = -1; prThru = false; last = {};
  }

  /** UI-16: con el HUD grande, el contador de toques solo rotula el toque activo si a tamaño completo pisaría el marcador
   *  (mismo criterio que la regla de ≤ 760 px de index.html; marcador ~240 px de ancho × su escala, contador ~440 px). */
  function hudFit() {
    if (!el.app) return;
    var W = ctx.width || innerWidth, H = ctx.height || innerHeight, sbs = H <= 560 ? 0.78 : 1;
    var compact = hudScale > 1 && W / 2 - 222 * hudScale < 16 + 240 * sbs * hudScale + 12;
    el.app.classList.toggle('tb-compact', compact);
  }

  // ---------- Capa de pantalla (UI-12): viñeta de media/baja y pulso de impacto ----------
  var reduceMotion = false;
  try { reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
  /** Viñeta CSS solo sin el post de arena (alta ya la lleva en su composición: nunca dos). */
  function vigTick() {
    var post = false; try { post = !!(VB.Arena && VB.Arena.postActive && VB.Arena.postActive()); } catch (e) { }
    if (ctx.params.vig === '0') post = true;                    // &vig=0: sin viñeta CSS (pruebas A/B de rendimiento)
    if (el.veil.classList.contains('vig') === post) el.veil.classList.toggle('vig', !post);
  }
  /** Pulso del color del equipo en los bordes (0 → 0,35 → 0 en 120 ms; opacidad con Web Animations: sin maquetación).
   *  Remate perfecto o bloqueo directo del humano y punto que gana el partido. No con movimiento reducido ni destellos suaves. */
  function pulse(team, gold) {
    if (reduceMotion || (ctx.settings && ctx.settings.softFlash) || !el.vp) return;
    el.vp.className = 'vp' + (gold ? ' gold' : team === 1 ? ' t1' : '');
    pulseT = performance.now();
    if (el.vp.animate) { try { el.vp.animate([{ opacity: 0 }, { opacity: 0.35, offset: 0.15 }, { opacity: 0.31, offset: 0.45 }, { opacity: 0 }], { duration: 120, easing: 'linear' }); return; } catch (e) { } }
    restartAnim(el.vp, 'on');
  }
  var pulseT = -1;

  // ---------- Estadísticas del partido ----------
  function newStats() {
    // Desglose de puntos como el acta/estadística FIVB: ataque + bloqueo + saque + errores del rival = puntos.
    // kills = puntos de ataque (remate, dejada, balón libre que cae), blocks = puntos de bloqueo,
    // aces = puntos de saque, oppErr = puntos regalados por el rival (fuera, red, dobles, 4 toques, falta de saque...).
    function t() { return { points: 0, aces: 0, kills: 0, blocks: 0, oppErr: 0, best: 0 }; }
    // p: por jugador (id → {num, team, pts, kills, blocks, aces}) para el MVP de cada equipo (UI-11): el punto de ataque es del último
    // que golpeó del equipo que puntúa; el ace, del sacador; el de bloqueo, del bloqueador. Los errores del rival no son de nadie.
    return { t: [t(), t()], run: 0, runTeam: -1, longest: 0, lastHitKind: '', lastHitTeam: -1, blockTeam: -1, p: {}, lastHitter: [null, null], blocker: null };
  }
  var stats = newStats();

  function loadRecord() { try { var r = JSON.parse(localStorage.getItem('voley3d.record') || 'null'); if (r && typeof r.played === 'number') for (var k in record) if (typeof r[k] === 'number') record[k] = r[k]; } catch (e) { } }
  function saveRecord() { try { localStorage.setItem('voley3d.record', JSON.stringify(record)); } catch (e) { } }
  function click() { if (VB.Audio && VB.Audio.click) try { VB.Audio.click(); } catch (e) { } }
  function uiSound(kind) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui(kind); else click(); } catch (e) { } }
  function hoverSound() { try { if (VB.Audio && VB.Audio.hover) VB.Audio.hover(); } catch (e) { } }
  function setText(node, key, val) { if (last[key] !== val) { last[key] = val; node.textContent = val; return true; } return false; }
  function setHTML(node, key, val) { if (last[key] !== val) { last[key] = val; node.innerHTML = val; return true; } return false; }
  function restartAnim(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

  // ---------- Dispositivo / glifos de teclas ----------
  /** Referencias a los nodos del DOM (init; y antes, preboot del telón). */
  function cacheEls() {
    ['hud', 'banner', 'callout', 'menu', 'pause', 'end', 'panel', 'rotate', 'touchbar', 'prompt', 'promptKey', 'promptText', 'promptBar', 'promptRing', 'coach',
      'pS0', 'pS1', 'pMid', 'endTitle', 'endKicker', 'endS0', 'endS1', 'endSets', 'endStats', 'endRecord',
      'btnPlay', 'optDiff', 'btnTut', 'btnControls', 'btnSettings', 'btnResume', 'btnRestart', 'btnQuit', 'btnPControls', 'btnPSettings',
      'btnAgain', 'btnMenu', 'btnPanelBack', 'btnTutPrev', 'btnTutNext', 'btnHudPause', 'btnHudMute', 'icoSound',
      'pnKick', 'pnTitle', 'tutBody', 'tutFig', 'tutStep', 'tutTitle', 'tutText', 'tutDots', 'ctlGrid', 'ctlSub', 'navHint', 'menuRecord',
      'diffVal', 'diffLvl', 'playSub', 'qualNote', 'tb1t', 'btnFirstTut', 'btnFirstPlay', 'firstDiff', 'guide', 'guideK', 'guideT', 'skip', 'btnAgainAlt', 'endMvp', 'btnPeek', 'btnEndBack'].forEach(function (k) { el[k] = $(k); });
    el.bn1 = $('bn1'); el.bn2 = $('bn2'); el.bn3 = $('bn3'); el.pbug = $('pbug'); el.pbT = $('pbT'); el.pbS = $('pbS'); el.pbX = $('pbX'); el.sbBody = document.querySelector('.sb-body'); el.sb = $('sb'); el.sbSet = $('sbSet'); el.tag = $('sbTag'); el.hist = $('sbHist');
    el.row0 = $('sbRow0'); el.row1 = $('sbRow1'); el.name0 = $('sbName0'); el.name1 = $('sbName1');
    el.pts0 = $('sbPts0'); el.pts1 = $('sbPts1');
    el.pips0 = $('sbSets0').children; el.pips1 = $('sbSets1').children;
    el.tb = [$('tb1'), $('tb2'), $('tb3')];
    el.app = $('app');
    el.veil = $('veil'); el.vp = $('vpulse');
    el.rl = $('rally'); el.rlN = $('rallyN');
    el.wipe = $('wipe'); el.wpBand = el.wipe.firstChild;
    el.intro = $('intro'); el.introDiff = $('introDiff'); el.introSrv = $('introSrv'); el.introHint = $('introHint');
    el.off = $('offArrow'); el.offNum = $('offNum'); el.offRot = el.off.firstChild;
    el.pnCtl = $('pnCtl'); el.pKick = document.querySelector('#pause .sh-k');
    el.stamp = $('stamp'); el.stampIn = el.stamp.firstChild; el.stampT = $('stampT'); el.stampS = $('stampS'); el.sr = $('srLive');
  }
  function device() {
    var d = ctx.inputDevice || 'keyboard';
    if (d === 'keyboard' && (ctx.isTouch || (VB.Input && VB.Input.isTouchActive && safe(VB.Input.isTouchActive)))) {
      if (!ctx.lastKeyT || ctx.time - ctx.lastKeyT > 3) d = 'touch';
    }
    return d;
  }
  function safe(fn) { try { return fn(); } catch (e) { return false; } }
  var GLYPH = {
    keyboard: { serve: '<span class="key">Espacio</span>', hit: '<span class="key">Espacio</span>', jump: '<span class="key">K</span>', move: '<span class="key">←</span><span class="key">→</span>', aim: 'las flechas', hitT: 'ESPACIO', jumpT: 'K', sw: '<span class="key">C</span>' },
    gamepad: { serve: '<span class="key pad pa">A</span>', hit: '<span class="key pad pa">A</span>', jump: '<span class="key pad pb">B</span>', move: '<span class="key">Stick</span>', aim: 'el stick', hitT: 'A', jumpT: 'B', sw: '<span class="key pad py">Y</span>' },
    touch: { serve: '<span class="key tch">Sacar</span>', hit: '<span class="key tch">Golpear</span>', jump: '<span class="key tch j">Saltar</span>', move: '<span class="key">Joystick</span>', aim: 'el joystick', hitT: 'GOLPEAR', jumpT: 'SALTAR', sw: '<span class="key">⇄</span>' }
  };
  // UI-22: mandos de la familia PlayStation (vendor 054c o nombres típicos) → glifos de forma ✕ ○ □ △ en texto neutro (sin logotipos
  // ni colores de marca); el resto, A/B/X/Y. El id se lee de VB.Input.padInfo() como mucho una vez por segundo (padInfo crea un objeto).
  var PADK = {
    std: { a: ['pa', 'A'], b: ['pb', 'B'], x: ['px', 'X'], y: ['py', 'Y'], start: 'Start', select: 'Select', lb: 'LB', rb: 'RB' },
    ps: { a: ['ps pa', '✕'], b: ['ps pb', '○'], x: ['ps px', '□'], y: ['ps py', '△'], start: 'Options', select: 'Share', lb: 'L1', rb: 'R1' }
  };
  var padFamF = -999, padFamV = '', padFamId = null, GLYPH_PS = null;
  /** 'ps' | '' (estándar). Xbox también dice «Wireless Controller»: se excluye por nombre o vendor (045e). */
  function padFam() {
    if (ctx && ctx.frame - padFamF < 60 && padFamId !== null) return padFamV;
    padFamF = ctx ? ctx.frame : 0;
    var id = ''; try { var pi = VB.Input && VB.Input.padInfo ? VB.Input.padInfo() : null; id = (pi && pi.id) || ''; } catch (e) { id = ''; }
    if (id !== padFamId) { padFamId = id; padFamV = !/xbox|045e/i.test(id) && /054c|dualsense|dualshock|wireless controller|playstation/i.test(id) ? 'ps' : ''; }
    return padFamV;
  }
  function padSet() { return PADK[padFam() === 'ps' ? 'ps' : 'std']; }
  /** Glifo HTML de un botón del mando ('a' golpear, 'b'/'x' saltar, 'y' cambiar). */
  var PADN = { '✕': 'equis', '○': 'círculo', '□': 'cuadrado', '△': 'triángulo' };
  function padKey(r) { var k = padSet()[r]; return '<span class="key pad ' + k[0] + '"' + (PADN[k[1]] ? ' aria-label="' + PADN[k[1]] + '"' : '') + '>' + k[1] + '</span>'; }
  function G() {
    var d = device();
    if (d === 'gamepad' && padFam() === 'ps') {
      if (!GLYPH_PS) GLYPH_PS = { serve: padKey('a'), hit: padKey('a'), jump: padKey('b'), move: GLYPH.gamepad.move, aim: GLYPH.gamepad.aim, hitT: '✕', jumpT: '○', sw: padKey('y') };
      return GLYPH_PS;
    }
    return GLYPH[d] || GLYPH.keyboard;
  }

  // =====================================================================
  //  BANNERS Y AVISOS
  // =====================================================================
  /** Banner central. cls: 'win'|'lose'|'gold'|'ace'|'neutral' */
  function banner(t1, t2, t3, cls, dur, kind) {
    el.bn1.textContent = t1 || ''; el.bn2.textContent = t2 || '';
    el.bn2.hidden = !t2; el.bn3.hidden = !t3; el.bn3.textContent = t3 || '';
    el.bn3.classList.toggle('so', t3 === 'CAMBIO DE SAQUE'); // el icono ⇄ solo en el cambio de saque
    el.banner.className = '';
    el.banner.style.left = el.banner.style.top = el.banner.style.right = el.banner.style.bottom = '';
    void el.banner.offsetWidth; // reinicia las animaciones CSS
    el.banner.className = 'show ' + (cls || 'win') + ((t1 || '').length > 15 ? ' long' : '');
    banT = dur || BAN.info; banOut = false; banKind = kind || 'info'; banRect = null;
    banTier = /compact/.test(cls || '') ? 1 : /\br2\b/.test(cls || '') ? 2 : 3;
    lastBn2 = t2 || '';
    // al aparecer un banner se apartan la tarjeta guiada y el consejo (UI-02: el banner manda)
    if (guideT > 0 && el.guide.className === 'show') { guideT = 0; el.guide.className = ''; }
  }
  function hideBanner() { el.banner.className = ''; banT = 0; banKind = ''; banRect = null; }
  /** Salida rápida del banner (corte de cámara): 120 ms. */
  function fadeBanner(sec) {
    if (banT <= 0) return;
    if (!banOut) { banOut = true; el.banner.classList.add('out', 'fast'); }
    banT = Math.min(banT, sec || 0.12);
  }
  /** Rectángulo del banner visible en px CSS (unión de cinta, subtítulo y chip) o null. Para camera.js (CAM-18). */
  function bannerRect() {
    if (!(banT > 0) || !el.banner.classList.contains('show')) return null;
    if (banRect) return banRect;
    var r = null, kids = [el.banner.firstChild, el.bn2, el.bn3];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i]; if (!k || k.hidden) continue;
      var q = k.getBoundingClientRect(); if (!q.width) continue;
      if (!r) r = { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
      else { r.left = Math.min(r.left, q.left); r.top = Math.min(r.top, q.top); r.right = Math.max(r.right, q.right); r.bottom = Math.max(r.bottom, q.bottom); }
    }
    if (r) { r.width = r.right - r.left; r.height = r.bottom - r.top; r.x = r.left; r.y = r.top; }
    banRect = r;
    return r;
  }
  // ---- Marcador de punto (nivel 1): pestaña del color del equipo que sale del marcador, junto a su fila ----
  function showBug(team, title, sub, tag, dur) {
    el.pbT.textContent = title; el.pbS.textContent = sub || ''; el.pbS.hidden = !sub;
    el.pbX.hidden = !tag; el.pbX.textContent = tag || '';
    el.pbug.className = '';
    void el.pbug.offsetWidth;
    el.pbug.className = 'show t' + (team === 1 ? 1 : 0) + (sub ? ' two' : '');
    bugT = dur; bugOut = false;
  }
  function hideBug(fast) {
    if (!(bugT > 0)) return;
    if (fast) { bugT = Math.min(bugT, 0.12); if (!bugOut) { bugOut = true; el.pbug.classList.add('out', 'fast'); } }
    else { bugT = 0; el.pbug.className = ''; }
  }
  /** Aviso corto bajo el marcador. cls opcional: 'tip' = consejo (más pequeño, dura más); 'neg' / 'good' = respuesta PERSONAL al
   *  jugador (UI-17: blanco con filo rojo-naranja / dorado; c0/c1 = color del equipo, solo para lo que hace un equipo).
   *  o (opcional): {html: texto con glifos de teclas, propio}, {gauge: -1..1} = medidor ◀ ● ▶ de pronto (−) / tarde (+). */
  function callout(text, team, cls, dur, o) {
    if (o && o.html) el.callout.innerHTML = text; else el.callout.textContent = text;
    if (o && typeof o.gauge === 'number') {
      // medidor: pista con la marca del instante bueno en el centro y el punto donde se pulsó (izquierda = pronto, derecha = tarde)
      var u = Math.max(0.06, Math.min(0.94, 0.5 + 0.44 * Math.max(-1, Math.min(1, o.gauge))));
      el.callout.insertAdjacentHTML('beforeend', '<span class="cg" aria-hidden="true"><i class="cg-l"></i><span class="cg-t"><u></u><b style="left:' + (u * 100).toFixed(1) + '%"></b></span><i class="cg-r"></i></span>');
    }
    el.callout.className = '';
    void el.callout.offsetWidth;
    el.callout.className = 'show' + (cls === 'neg' || cls === 'good' ? '' : ' c' + (team === 1 ? 1 : 0)) + (cls ? ' ' + cls : '');
    el.callout.style.animationDuration = (dur || 0.8) + 's';
    calloutT = dur || 0.8;
  }

  // =====================================================================
  //  EVENTOS -> estadísticas y banners
  // =====================================================================
  function tally(e) {
    var s = stats;
    switch (e.type) {
      case 'hit':
        s.lastHitKind = e.kind; s.lastHitTeam = e.team; s.blockTeam = -1; if (e.player) s.lastHitter[e.team === 1 ? 1 : 0] = e.player; break;
      case 'block':
        s.blockTeam = e.team; s.blocker = e.player || null; break;
      case 'point': {
        var w = e.team, T = s.t[w];
        T.points++;
        if (s.runTeam === w) s.run++; else { s.run = 1; s.runTeam = w; }
        if (s.run > T.best) T.best = s.run;
        if ((e.rallyHits || 0) > s.longest) s.longest = e.rallyHits || 0;
        // falta de saque solo si la comete el equipo que saca (gana el receptor). Bloquear el saque o tocar la red durante el
        // saque es falta del equipo RECEPTOR (12.6 / 14.6.3 / 11.3.1): gana el que saca y no es "falta de saque"
        var kind = 'point', srv = (e.lastKind === 'serve' || (e.lastKind == null && (e.rallyHits | 0) === 0)) && !!e.sideout;
        if (e.how) { // sim >= v2: 'ace' | 'kill' | 'tip' | 'block' | 'error' | 'free'
          if (e.how === 'ace') kind = 'ace';
          else if (e.how === 'kill' || e.how === 'tip' || e.how === 'free') kind = e.how;
          else if (e.how === 'block') kind = 'blockPt';
          else kind = (srv || (e.reason === 'serve' && e.sideout)) ? 'srvErr' : 'error';
        }
        else if (e.reason === 'in' && !e.sideout && (e.rallyHits | 0) === 0) kind = 'ace';
        else if ((e.rallyHits | 0) === 0 && e.reason !== 'in' && e.sideout) kind = 'srvErr';
        else if (e.reason === 'in' && s.blockTeam === w) kind = 'blockPt';
        else if (e.reason === 'in') kind = s.lastHitKind === 'spike' && s.lastHitTeam === w ? 'kill' : 'free';
        else kind = 'error';
        // cada punto cae en exactamente una fila: las filas suman "Puntos"
        if (kind === 'ace') T.aces++;
        else if (kind === 'blockPt') T.blocks++;
        else if (kind === 'kill' || kind === 'tip' || kind === 'free') T.kills++;
        else T.oppErr++;
        e._uiKind = kind; // solo para la UI (no forma parte del contrato)
        var who = kind === 'blockPt' ? s.blocker : (kind === 'ace' || kind === 'kill' || kind === 'tip' || kind === 'free') ? s.lastHitter[w] : null;
        if (who && who.team === w) {
          var P = s.p[who.id] || (s.p[who.id] = { id: who.id, num: who.num, team: who.team, pts: 0, kills: 0, blocks: 0, aces: 0 });
          P.pts++; if (kind === 'ace') P.aces++; else if (kind === 'blockPt') P.blocks++; else P.kills++;
        }
        break;
      }
    }
  }

  function onEvents(g, events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === 'newMatch') { stats = newStats(); }
      if (g.demo) continue;
      tally(e);
      switch (e.type) {
        case 'newMatch':
          if (ctx.introLeft > 0 || introUI.on) break;           // la tarjeta de presentación ya lo dice (UI-14)
          banner('Set 1', 'Al mejor de 3 sets · ' + (g.serving === 0 ? 'Sacas tú' : 'Saca la CPU'), '', 'neutral', BAN.info, 'newSet');
          break;
        case 'point': {
          var me = e.team === 0, k = e._uiKind;
          flashRow(e.team); lastScorer = e.team;
          rallyEnd(e);
          if (e.matchWon) { pulse(e.team, e.team === 0); matchPtT = ctx.time; }
          // UI-02: el punto aparta al momento la tarjeta guiada, el consejo y el aviso
          clearPrompt(); if (guideT > 0) { guideT = 0; el.guide.className = ''; }
          last.coach = null; el.coach.classList.add('off');
          presentPoint(e, me, k, g);
          srScore(e, g);
          break;
        }
        case 'block':
          if (e.human && e.result === 'stuff') pulse(e.team, false);
          // tu propio bloqueo directo es un logro personal (dorado); el resto, del color del equipo que bloquea
          callout(e.result === 'soft' || e.result === 'tool' || e.result === 'touch' ? 'Toque de bloqueo' : '¡Bloqueo!', e.team, e.human && e.result === 'stuff' ? 'good' : '');
          break;
        case 'hit':
          if (e.team === 0) { clearPrompt(); if (guideT > 0) guideHide(); } // el aviso del que acaba de golpear no pasa al compañero
          if (!e.human) { if (stampDbg(g) && e.team === 0 && e.player === g.ctrl) stampHit(e, g); break; }
          if (e.kind === 'spike' && e.grade === 'perfect' && e.shot !== 'tip') pulse(e.team, false);
          if (e.shot === 'body') { // sin gesto: el balón le da en el cuerpo (cuenta como toque)
            // (si acaba de salir «¡Pronto!» con su medidor, se queda: explica por qué le ha dado y hacia dónde corregir)
            if (performance.now() - missT > 700) callout('¡Te ha dado!', 0, 'neg', 1);
            else srSay('Te ha dado');
            if (ctx.settings.showHelp !== false) bodyTipT = 1.5;
            break;
          }
          if (e.kind === 'free' && e.shot !== 'tip' && e.touch === 3 && ctx.settings.showHelp !== false && !e.dive)
            callout('Balón libre · ' + G().jump + ' para rematar', 0, 'tip', 1.6, { html: true });
          else {
            // UI-09: sello junto al punto de contacto (PERFECTO / BIEN); el aviso de arriba a la izquierda ya no sale
            // (el lector de pantalla lo sigue oyendo por #srLive)
            stampHit(e, g);
            var pm = e.grade === 'perfect' ? (e.kind === 'free' ? (e.shot === 'tip' ? 'Dejada perfecta' : '') : PERFECT[e.kind]) : '';
            if (pm) srSay(pm.replace(/¡|!/g, ''));
          }
          break;
        case 'switch':
          clearPrompt(); break;
        case 'miss':
          // UI-17: respuesta personal (no del equipo rival): blanco con filo rojo-naranja; con pronto/tarde, el medidor dice hacia dónde
          // corregir (t2 = s que faltaban para el instante bueno: > 0 pronto, < 0 tarde). Marca a ±(0,27…1) de la pista según el desfase.
          if (e.player === g.ctrl) {
            var t2 = typeof e.t2 === 'number' && isFinite(e.t2) ? e.t2 : (e.reason === 'early' ? 0.15 : -0.15);
            var gz = e.reason === 'early' || e.reason === 'late' ? (e.reason === 'early' ? -1 : 1) * (0.27 + 0.73 * Math.min(1, Math.abs(t2) / 0.35)) : null;
            callout(e.reason === 'early' ? '¡Pronto!' : e.reason === 'late' ? '¡Tarde!' : 'No llegas', 0, 'neg', gz != null ? 1.2 : 0.8, gz != null ? { gauge: gz } : null);
            missT = performance.now();
            srSay(e.reason === 'early' ? 'Pronto' : e.reason === 'late' ? 'Tarde' : 'No llegas');
          }
          break;
        case 'whistle':
          if (introUI.quiet && !(ctx.introLeft > 0)) introUI.quiet = false;
          break;
        case 'serveReady':
          atSP = e.matchPoint >= 0 || e.setPoint >= 0;
          // versión compacta, arriba: la cinta grande tapaba la red y al sacador justo cuando va a sacar
          if (e.matchPoint >= 0) banner('Punto de partido', e.matchPoint === 0 ? 'Un punto para ganar el partido' : 'La CPU tiene punto de partido', '', 'gold compact', BAN.sp, 'sp');
          else if (e.setPoint >= 0) banner('Punto de set', e.setPoint === 0 ? 'Un punto para ganar el ' + (ORD[g.setNo] || g.setNo + '.º') + ' set' : 'La CPU tiene punto de set', '', 'gold compact', BAN.sp, 'sp');
          break;
        case 'toss':
          // con el balón en el aire no puede quedar nada encima de la jugada
          if (banT > 0 && el.banner.classList.contains('compact')) { banT = Math.min(banT, 0.3); }
          break;
        case 'set':
          // nivel 3, tras el momento del héroe: espera al corte al plano de reacción; acaba antes de la grúa del cambio de campo
          if (!e.sets || e.sets[e.team] < 2) queuePres({ t1: e.team === 0 ? 'Set para ti' : 'Set para la CPU', t2: 'Set ' + e.setNo + ' · ' + e.score[0] + '-' + e.score[1],
            t3: '', chip: 'SETS ' + e.sets[0] + '-' + e.sets[1], cls: (e.team === 0 ? 'win' : 'lose') + ' t3', dur: BAN.set, kind: 'set', gate: 'cut' });
          break;
        case 'match':
          queuePres({ t1: e.team === 0 ? '¡Ganas el partido!' : 'Gana la CPU', t2: 'Sets ' + e.sets[0] + '-' + e.sets[1], t3: '', cls: (e.team === 0 ? 'ace' : 'lose') + ' t3', dur: BAN.match, kind: 'match', gate: 'cut' });
          break;
        case 'courtChange':
          // reglas 18.2.1 / 18.2.2: cuando la cámara pasa al plano 'court' (grúa); se va antes de que la grúa acabe (ccU = 1)
          pendCourt = { t2: e.why === 'eight' ? 'Set decisivo · 8 puntos' : 'Fin del ' + (ORD[e.setNo] || e.setNo + '.º') + ' set', dur: e.why === 'eight' ? 1.6 : 1.9, rt: ctx.time };
          // fin de set: «Set N» entra en la bajada de la grúa, en cuanto se va «Cambio de campo» (no al empezar el saque)
          courtNext = e.why === 'set' && e.sets ? { n: e.setNo + 1, sub: e.setNo + 1 === 3 ? 'Set decisivo · a 15 puntos' : 'Sets ' + e.sets[0] + '-' + e.sets[1] } : null;
          break;
        case 'newSet':
          courtNext = null;
          if (newSetShown === e.setNo) { newSetShown = 0; break; } // ya salió en la bajada de la grúa
          newSetShown = 0;
          banner('Set ' + e.setNo, e.setNo === 3 ? 'Set decisivo · a 15 puntos' : 'Sets ' + g.sets[0] + '-' + g.sets[1], '', 'neutral', BAN.info, 'newSet');
          break;
        case 'gameOver':
          showEnd(e);
          endFlow(e);
          break;
      }
    }
  }
  var missT = -9999;
  var ORD = ['', '1.er', '2.º', '3.er'], pendCourt = null, courtNext = null, newSetShown = 0, bodyTipT = 0, lastBn2 = '', lastSub = '', held = null;
  var OUTK = { serve: 'Saque fuera', pass: 'Recepción fuera', set: 'Colocación fuera', spike: 'Remate fuera', free: 'Balón fuera' };
  // sin 'free': un balón libre (3.er toque sin saltar) es la opción floja y no se celebra
  var PERFECT = { pass: 'Recepción perfecta', set: 'Colocación perfecta', spike: '¡Remate perfecto!', serve: '¡Saque perfecto!' };
  function flashRow(t) { restartAnim(t === 0 ? el.row0 : el.row1, 'scored'); }
  /** UI-23: el tanteo, en el aviso educado del lector de pantalla, tras cada punto: «Tú 3, CPU 1. Set 1.» (con el set o el partido
   *  ganado delante). Las mismas cifras que el marcador (point.score = tanteo tras el punto). */
  function srScore(e, g) {
    var sc = e.score || g.score, n = g.setNo, pre = '';
    if (e.matchWon) pre = e.team === 0 ? 'Ganas el partido. ' : 'Gana la CPU el partido. ';
    else if (e.setWon) pre = e.team === 0 ? 'Set para ti. ' : 'Set para la CPU. ';
    var sets = (e.setWon || e.matchWon) && g.sets ? ' Sets ' + g.sets[0] + '-' + g.sets[1] + '.' : '';
    srSay(pre + 'Tú ' + sc[0] + ', CPU ' + sc[1] + '. Set ' + n + '.' + sets);
  }
  /** Lector de pantalla: aviso educado (sustituye al aviso visual de arriba a la izquierda para los golpes). */
  var srLast = '', srT = 0;
  function srSay(txt) {
    if (!el.sr) return;
    var now = performance.now(); if (txt === srLast && now - srT < 1500) return;
    srLast = txt; srT = now; el.sr.textContent = ''; el.sr.textContent = txt;
  }

  // =====================================================================
  //  PRESENTACIÓN DEL PARTIDO (UI-14)
  // =====================================================================
  // main.js para la sim y llama introStart(g); al acabar (2,5 s) o al saltarla (cualquier botón, tecla o toque → ctx.introSkipReq),
  // introEnd(skipped). La tarjeta sale; el marcador entra deslizando 0,25 s después (con el saque ya en marcha: acaba hacia el
  // silbato, como pide audio) y se avisa a audio (ui('introEnd') al entrar el marcador; ui('introSkip') si la saltan).
  var introUI = { on: false, hudT: 0, skipped: false };
  function introStart(g) {
    introUI.on = true; introUI.hudT = 0; introUI.quiet = true;   // sin avisos ni consejos hasta el primer silbato
    var di = optIndex('difficulty'), nm = g && VB.DIFF && VB.DIFF[g.difficulty] && VB.DIFF[g.difficulty].name;
    el.introDiff.textContent = 'Nivel ' + (nm || OPT.difficulty.labels[di]);
    el.introSrv.textContent = g && g.serving === 1 ? 'Saca la CPU' : 'Sacas tú';
    var d = device();
    el.introHint.innerHTML = d === 'touch' ? 'Toca para empezar ya' : d === 'gamepad' ? padKey('a') + 'para empezar ya' : 'Pulsa cualquier tecla para empezar ya';
    el.intro.className = ''; void el.intro.offsetWidth; el.intro.className = 'show';
    el.app.classList.add('intro-on'); el.app.classList.remove('hud-in');
    hideBanner(); clearPrompt();
    if (reduceMotion && el.intro.animate) { try { el.intro.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }); } catch (e) { } }
  }
  function introEndUI(skipped) {
    if (!introUI.on) return;
    introUI.on = false; introUI.skipped = !!skipped;
    el.intro.className = 'out' + (skipped ? ' fast' : '');
    if (reduceMotion && el.intro.animate) { try { el.intro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: skipped ? 120 : 200, easing: 'ease-in', fill: 'forwards' }); } catch (e) { } }
    introUI.outT = skipped ? 0.16 : 0.3;
    introUI.hudT = skipped ? 0.08 : 0.25;
    if (skipped) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('introSkip'); } catch (e) { } }
  }
  function introTick(rdt) {
    if (introUI.outT > 0) { introUI.outT -= rdt; if (introUI.outT <= 0) { el.intro.className = ''; el.intro.getAnimations && el.intro.getAnimations().forEach(function (a) { a.cancel(); }); } }
    if (introUI.hudT > 0) {
      introUI.hudT -= rdt;
      if (introUI.hudT <= 0) {
        el.app.classList.remove('intro-on'); restartAnim(el.app, 'hud-in');
        if (!introUI.skipped) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('introEnd'); } catch (e) { } }
      }
    }
  }

  // =====================================================================
  //  CORTINILLA DE MARCA (UI-13)
  // =====================================================================
  // Cortes punto → saque y punto → cambio de campo: la cinta cubre la pantalla en WIPE_IN s contados con el nextCutIn de la
  // cámara (cubierta del todo en el frame del corte) y se va en WIPE_OUT s; el corte al plano de reacción sigue siendo un corte
  // seco. Si el corte llega sin avisar, se cubre en ese mismo frame. Transiciones de pantalla (menú → partido, partido →
  // final, final → menú): 0,45 s con la acción a mitad, bajo la cinta (el parón de montar el partido queda tapado).
  // Movimiento reducido: fundido de 150 ms. VB.Audio.ui('wipe') (soplido con el pico a 0,15 s) al empezar.
  var WIPE_IN = 0.075, WIPE_OUT = 0.085, WIPE_AUDIO = 0.15;
  var wp = { ph: 0, p: 0, t: 0, x: 1, team: 0, cut: false, aud: false, cb: null, dur: 0, hold: 0, last: '', log: null, armCut: -1 };
  function wipeCls(team) {
    var c = 'on' + (team === 1 ? ' t1' : team === 2 ? ' brand' : '') + (reduceMotion ? ' fade' : '') + (wp.cb || wp.lock ? ' lock' : '') + (wp.cut ? ' cutw' : '');
    if (wp.last !== c) { wp.last = c; el.wipe.className = c; }
  }
  /** Coloca la cinta: c = cobertura 0..1 (entrando desde la izquierda) o, con out, saliendo por la derecha. */
  function wipeDraw(c, out) {
    if (reduceMotion) { el.wpBand.style.opacity = c.toFixed(3); return; }
    var W = ctx.width || innerWidth, H = ctx.height || innerHeight, off = W + 0.62 * H;
    var e = out ? c * c * (3 - 2 * c) : 1 - (1 - c) * (1 - c);           // entra frenando, sale acelerando
    var x = out ? e * off : -(1 - e) * off;
    el.wpBand.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0) skewX(-14deg)';
  }
  function wipeOff() { wp.ph = 0; wp.cut = false; wp.aud = false; wp.cb = null; wp.lock = false; wp.last = ''; el.wipe.className = ''; el.wpBand.style.opacity = ''; }
  function wipeSound() { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('wipe'); } catch (e) { } }
  /** Transición de pantalla (450 ms; fundido de 150 ms con movimiento reducido): cb a mitad, con la pantalla cubierta. */
  function wipeRun(team, cb) {
    if (wp.ph && wp.cb) return false;                                   // ya hay una en marcha: un solo cambio de pantalla
    wp.cb = cb || null; wp.team = team; wp.cut = false; wp.ph = 1; wp.t = 0;
    wp.dur = reduceMotion ? 0.075 : 0.2; wp.hold = reduceMotion ? 0 : 0.05;
    wipeSound(); wipeCls(team); wipeDraw(0, false);
    if (wp.log) wp.log.push(['run', performance.now()]);
    return true;
  }
  /** Cada frame (también fuera del partido): avanza la transición de pantalla en tiempo real. */
  function wipeTickRun(rdt) {
    if (!wp.ph || wp.cut) return;
    wp.t += Math.min(rdt, 0.034);
    if (wp.ph === 1) { var c = Math.min(1, wp.t / wp.dur); wipeDraw(c, false); if (c >= 1 && bootBusy()) return; if (c >= 1) { wp.ph = 2; wp.t = 0; var f = wp.cb; wp.cb = null; wipeCls(wp.team); if (f) { try { f(); } catch (e) { console.error('[VB][ERROR] UI.wipe: ' + (e && e.stack || e)); } } } }
    else if (wp.ph === 2) { wipeDraw(1, false); if (wp.t >= wp.hold) { wp.ph = 3; wp.t = 0; } }
    else if (wp.ph === 3) { var r = Math.min(1, wp.t / wp.dur); wipeDraw(reduceMotion ? 1 - r : r, !reduceMotion); if (r >= 1) wipeOff(); }
  }
  /** Cortes de cámara del punto (presUpdate): d = getDebug(), reacted = ya pasó el corte al plano de reacción. */
  function wipeTickCut(g, d, reacted, cutNow) {
    if (ctx.params.wipe === '0') return;                            // &wipe=0: sin cortinilla en los cortes (pruebas A/B)
    var rdt = ctx.realDt || 0.016;
    if (wp.ph && !wp.cut) return;                                       // transición de pantalla en marcha
    var nci = d && typeof d.nextCutIn === 'number' ? d.nextCutIn : -1, lc = d && d.lastCut;
    // cortes que SALEN del punto (reacción o cierre) hacia el saque, la grúa del cambio de campo o el plano corto del sacador rival (CAM-14)
    var masked = cutNow && lc && (lc.kind === 'serve' || lc.kind === 'court' || lc.kind === 'cutaway') && (lc.from === 'point' || lc.from === 'clinch' || lc.kind === 'court');
    if (wp.ph === 3) {                                                  // saliendo
      wp.t += Math.min(rdt, 0.022);                     // un frame largo no se come la salida (se ve entera)
      var r = Math.min(1, wp.t / (reduceMotion ? 0.075 : wp.outDur || WIPE_OUT)); wipeDraw(reduceMotion ? 1 - r : r, !reduceMotion);
      if (wp.log) wp.log.push(['out', performance.now(), +r.toFixed(3)]);
      if (r >= 1) wipeOff();
      return;
    }
    if (masked) {                                                       // frame del corte: cubierta del todo, y a salir
      if (!wp.ph) { wp.cut = true; wp.team = lastScorer; wipeCls(wp.team); if (!wp.aud) wipeSound(); wp.inT = 0; }
      // si el corte llegó sin aviso (o con poco), la salida se alarga: la cortinilla nunca dura menos de ~125 ms en pantalla
      wp.outDur = Math.max(WIPE_OUT, 0.125 - (wp.inT || 0));
      wp.cut = true; wp.ph = 3; wp.t = 0; wipeDraw(1, false);
      if (wp.log) wp.log.push(['cut', performance.now(), lc.kind]);
      return;
    }
    // el próximo corte es el de vuelta al saque o la grúa (no el corte seco al plano de reacción ni los de la secuencia de cierre):
    // ya hubo corte de reacción/cierre en este punto (y el cierre está en su plano final), o este punto no lleva corte de reacción
    var clp = d && d.clinch ? d.clinch.phase || '' : '', pfc = d && d.pf ? d.pf.cut : null;
    var after = !!(lc && (lc.kind === 'point' || lc.kind === 'clinch') && lc.t >= cam.pointRt - 0.05 && (!clp || clp === 'hero'));
    var armed = !cutNow && g.mode === 'point' && nci >= 0 && ctx.state === 'playing' && !ctx.frozen && (cam.shot === 'court' || after || (pfc === false && !clp && ctx.time - cam.pointRt > 0.05));
    if (armed && nci <= WIPE_AUDIO && !wp.aud) { wp.aud = true; wipeSound(); }
    if (armed && nci <= (reduceMotion ? 0.075 : WIPE_IN)) {
      if (!wp.ph) { wp.ph = 1; wp.cut = true; wp.team = lastScorer; wipeCls(wp.team); wp.inT = 0; } else wp.inT = (wp.inT || 0) + rdt;
      var c = 1 - nci / (reduceMotion ? 0.075 : WIPE_IN); wipeDraw(Math.max(0, Math.min(1, c)), false);
      if (wp.log) wp.log.push(['in', performance.now(), +c.toFixed(3), +nci.toFixed(3)]);
    } else if (wp.ph === 1 && wp.cut) { wp.ph = 3; wp.t = WIPE_OUT * 0.5; }   // el corte se anuló: se retira
    if (!armed && wp.aud && !wp.ph) wp.aud = false;
  }
  var lastScorer = 0;

  // =====================================================================
  //  INDICADOR DE BORDE (UI-10)
  // =====================================================================
  // El jugador controlado fuera de cuadro (cabeza fuera de la pantalla o detrás de la cámara, o pies a < 40 px de un borde):
  // insignia con su dorsal en el borde, en la recta que va del centro de la pantalla al jugador, con la flecha apuntándole.
  // Se aparta del marcador, de los botones de arriba y de los controles táctiles. Solo con el balón en juego o en el saque.
  var _offBl = [], _offCd = [], _ok = null;
  var offA = { on: false, off: 0, x: -1, y: -1, ang: 0, n: -1, team: -1, obs: [], obsF: -999, sh: '', shT: 0.5, cutT: 0.5 }, _ov = null, _oh = null, _of = null;
  function offObstacles() {
    if (ctx.frame - offA.obsF < 48 && offA.obs.length) return offA.obs;
    offA.obsF = ctx.frame; var L = offA.obs; L.length = 0;
    function add(e) { if (!e) return; var r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) L.push({ l: r.left, t: r.top, r: r.right, b: r.bottom }); }
    add(el.sbBody); add(document.querySelector('#sb .sb-top')); add(document.querySelector('.hud-btns'));
    // controles táctiles: botones y joystick (base, mando y rótulo «MOVER»; la zona táctil invisible no estorba)
    var tb = document.querySelectorAll('#touch.on .vt-btn, #touch.on .vt-base, #touch.on .vt-knob, #touch.on .vt-tip'); for (var i = 0; i < tb.length; i++) add(tb[i]);
    return L;
  }
  function offProj(x, y, z, v) { VB.toThree(x, y, z, v); v.project(ctx.camera); return v; }
  var OFF_CINE = { clinch: 1, cutaway: 1, intro: 1, point: 1, court: 1, over: 1 };
  var OFF_FEETOK = { serveUs: 1, defend: 1 };
  function offTick(g, playing) {
    var want = false, p = g.ctrl, W = ctx.width, H = ctx.height;
    // solo en los planos de juego: en los cinematográficos (cutaway del sacador rival, cierre, presentación, punto, grúa, final) no
    // (camera_input, CAM-09/14; integración ola 2)
    var sh = ''; try { sh = VB.CameraRig && VB.CameraRig.getShot ? VB.CameraRig.getShot() || '' : ''; } catch (e) { sh = ''; }
    if (sh !== offA.sh) { offA.sh = sh; offA.shT = ctx.time; }
    // ni en los planos cinematográficos ni en los 0,35 s que siguen a un cambio de plano (la cámara aún se asienta tras el corte)
    if (OFF_CINE[sh] || (!offA.on && ctx.time - (offA.shT || 0) < 0.35)) playing = false;
    if (playing && p && !(ctx.introLeft > 0) && !introUI.quiet && (g.mode === 'rally' || g.mode === 'serve') && ctx.camera && VB.toThree && ctx.THREE && !ctx.portraitBlock) {
      if (!_ov) { _ov = new ctx.THREE.Vector3(); _oh = new ctx.THREE.Vector3(); _of = new ctx.THREE.Vector3(); }
      var hd = offProj(p.x, p.y, (p.z || 0) + 1.85, _oh), ft = offProj(p.x, p.y, Math.max(0, p.z || 0), _of), bd = offProj(p.x, p.y, (p.z || 0) + 1.0, _ov);
      var hx = (hd.x + 1) * 0.5 * W, hy = (1 - hd.y) * 0.5 * H, fx = (ft.x + 1) * 0.5 * W, fy = (1 - ft.y) * 0.5 * H;
      var behind = hd.z > 1 || bd.z > 1;
      var headOut = behind || hx < 0 || hx > W || hy < 0 || hy > H;
      // pies a < 40 px de los bordes laterales o de arriba; abajo, la cámara de juego ya encuadra al jugador bajo (en táctil más):
      // ahí solo cuenta si se le cortan las piernas (rodilla a < 10 px del borde)
      if (!_ok) _ok = new ctx.THREE.Vector3();
      var kn = offProj(p.x, p.y, Math.max(0, p.z || 0) + 0.5, _ok), ky = (1 - kn.y) * 0.5 * H;
      var feetEdge = ft.z > 1 || fx < 40 || fx > W - 40 || fy < 40 || ky > H - 10;
      // planos que cortan las piernas A PROPÓSITO: el saque propio (cámara detrás del sacador) y la defensa que se acerca (CAM-13):
      // ahí solo vale «fuera de cuadro» (cabeza fuera), no «cortado» (integración ola 2: la insignia salía tras el aviso del saque)
      if (OFF_FEETOK[sh]) feetEdge = false;
      // solo cortado (pies fuera, cabeza dentro): tras 0,3 s seguidos (un instante en el borde no merece la insignia)
      offA.cutT = !headOut && feetEdge ? (offA.cutT || 0) + (ctx.realDt || 0.016) : 0;
      want = headOut || (feetEdge && (offA.on || offA.cutT > 0.3));
      if (want) {
        // dirección centro → jugador (detrás de la cámara la proyección sale invertida)
        var dx = bd.x, dy = -bd.y; if (bd.z > 1) { dx = -dx; dy = -dy; }
        dx *= W * 0.5; dy *= H * 0.5;
        var len = Math.sqrt(dx * dx + dy * dy); if (len < 1e-3) { dx = 0; dy = 1; len = 1; }
        dx /= len; dy /= len;
        var sc = hudScale * (ctx.isTouch ? 0.9 : 1), rad = 19 * sc + 8, m = rad + 10;
        var x0 = m + (ctx.isTouch ? 8 : 0), x1 = W - m - (ctx.isTouch ? 8 : 0), y0 = m, y1 = H - m;
        var cx = W * 0.5, cy = H * 0.5, tx = dx > 0 ? (x1 - cx) / dx : dx < 0 ? (x0 - cx) / dx : 1e9, ty = dy > 0 ? (y1 - cy) / dy : dy < 0 ? (y0 - cy) / dy : 1e9;
        var t = Math.min(tx, ty), x = cx + dx * t, y = cy + dy * t, horiz = ty < tx;   // horiz: está en el borde de arriba/abajo
        // solo cortado (la cabeza se ve): la insignia va al borde más cercano a los pies, junto al jugador (no encima de él)
        var cut = !headOut, bx0 = 0, bx1 = 0, by0 = 0;
        if (cut) {
          var bw2 = Math.max(14, (fy - hy) * 0.3);
          bx0 = Math.min(hx, fx) - bw2; bx1 = Math.max(hx, fx) + bw2; by0 = Math.min(hy, fy) - 6;
          var dl = fx - 0, dr = W - fx, dt2 = fy, db = H - fy;
          if (ky > H - 10 || (db <= dl && db <= dr && db <= dt2)) { horiz = true; y = y1; x = Math.max(x0, Math.min(x1, fx)); }
          else if (dl <= dr && dl <= dt2) { horiz = false; x = x0; y = Math.max(y0, Math.min(y1, fy)); }
          else if (dr <= dt2) { horiz = false; x = x1; y = Math.max(y0, Math.min(y1, fy)); }
          else { horiz = true; y = y0; x = Math.max(x0, Math.min(x1, fx)); }
        }
        // apartarse de marcador, botones y controles: deslizar por el borde hasta salir de ellos
        // tramos libres del borde: se quitan las proyecciones (con margen) de los obstáculos que cruzan la franja del borde y
        // se elige el punto libre más cercano al deseado (si el borde está lleno, se pasa a la esquina libre del otro borde)
        var O = offObstacles(), lo = horiz ? x0 : y0, hi = horiz ? x1 : y1, want0 = horiz ? x : y, bl = _offBl; bl.length = 0;
        for (var k = 0; k < O.length; k++) {
          var o = O[k];
          if (horiz ? (y + rad > o.t - 6 && y - rad < o.b + 6) : (x + rad > o.l - 6 && x - rad < o.r + 6)) bl.push(horiz ? o.l - 6 - rad : o.t - 6 - rad, horiz ? o.r + 6 + rad : o.b + 6 + rad);
        }
        if (cut && (horiz ? y + rad > by0 : true)) bl.push(horiz ? bx0 - 4 - rad : by0 - 4 - rad, horiz ? bx1 + 4 + rad : H + rad);   // el propio jugador
        var bestP = want0, bestD = 1e9, free = true;
        for (var q = 0; q < bl.length; q += 2) if (want0 > bl[q] && want0 < bl[q + 1]) { free = false; break; }
        if (!free) {
          var cand = _offCd; cand.length = 0; cand.push(lo, hi);
          for (var q2 = 0; q2 < bl.length; q2 += 2) cand.push(bl[q2], bl[q2 + 1]);
          for (var ci = 0; ci < cand.length; ci++) {
            var cp = cand[ci]; if (cp < lo || cp > hi) continue;
            var blocked = false; for (var q3 = 0; q3 < bl.length; q3 += 2) if (cp > bl[q3] + 0.5 && cp < bl[q3 + 1] - 0.5) { blocked = true; break; }
            if (!blocked && Math.abs(cp - want0) < bestD) { bestD = Math.abs(cp - want0); bestP = cp; }
          }
          if (horiz) x = bestP; else y = bestP;
        }
        // la flecha apunta al jugador desde donde queda la insignia (detrás de la cámara, en la dirección de la recta)
        if (cut) offA.ang = Math.atan2((horiz && y > H * 0.5 ? H + 40 : fy) - y, fx - x);
        else offA.ang = Math.atan2(dy, dx);                   // fuera de cuadro: la recta centro → jugador
        offA.cut = cut;
        // salto grande (otro borde, o el tramo libre cambia): directo, sin cruzar la pantalla (la interpolación cortaba la esquina y
        // pasaba por encima del joystick o del jugador; verificación ola 2)
        if (!offA.on || offA.x < 0 || Math.abs(x - offA.x) + Math.abs(y - offA.y) > 90) { offA.x = x; offA.y = y; }
        else { var kk = 1 - Math.exp(-18 * Math.max(0.001, ctx.realDt || 0.016)); offA.x += (x - offA.x) * kk; offA.y += (y - offA.y) * kk; }
        if (offA.n !== p.num || offA.team !== p.team) { offA.n = p.num; offA.team = p.team; el.offNum.textContent = p.num; el.off.classList.toggle('t1', p.team === 1); }
        el.off.style.transform = 'translate3d(' + offA.x.toFixed(1) + 'px,' + offA.y.toFixed(1) + 'px,0)';
        el.offRot.style.transform = 'rotate(' + (offA.ang * 57.29578).toFixed(1) + 'deg)';
      }
    }
    // histéresis: aparece al momento, se va tras 0,2 s fuera de la condición (sin parpadeo en el borde)
    if (want) { offA.off = 0; if (!offA.on) { offA.on = true; el.off.classList.add('on'); } }
    else if (offA.on) { offA.off += ctx.realDt || 0.016; if (offA.off > 0.2 || !playing || (g.mode !== 'rally' && g.mode !== 'serve')) { offA.on = false; offA.x = -1; el.off.classList.remove('on'); } }
  }

  // =====================================================================
  //  PELOTEO LARGO (UI-15)
  // =====================================================================
  // Desde el 8.º toque de la jugada (g.rally.hits, la misma cuenta que point.rallyHits), «JUGADA · N» bajo el marcador; el
  // número late en cada contacto. Al acabar la jugada se queda 1,5 s en dorado con la cuenta final. Desde 15, naranja vivo.
  var RALLY_CHIP = 8, rl = { on: false, n: 0, endT: 0 };
  function rallyShow(n) {
    if (!rl.on) { rl.on = true; el.rl.className = 'rl on'; }
    if (n !== rl.n) { rl.n = n; el.rlN.textContent = n; restartAnim(el.rlN, 'bump'); if (n >= 15) el.rl.classList.add('hot'); }
  }
  function rallyHide() { if (rl.on || rl.endT > 0) { rl.on = false; rl.n = 0; rl.endT = 0; el.rl.className = 'rl'; } }
  function rallyEnd(e) {
    var n = e.rallyHits | 0;
    if (!rl.on || n < RALLY_CHIP) { rallyHide(); return; }
    rallyShow(n); el.rl.classList.remove('hot'); el.rl.classList.add('end'); rl.endT = 1.5;
  }
  /** La cuenta ya está dicha (subtítulo «¡Jugada de N toques!») o llega el rótulo de set/partido: el chip se funde en 0,25 s
   *  (antes seguía bajo el marcador durante toda la celebración del partido). */
  function rallyFade() {
    if (!(rl.on || rl.endT > 0) || el.rl.classList.contains('fade')) return;
    el.rl.classList.add('fade'); rl.endT = Math.min(rl.endT > 0 ? rl.endT : 0.26, 0.26);
  }
  function rallyTick(g, dt, playing) {
    if (rl.endT > 0) { rl.endT -= dt || 0; if (rl.endT <= 0 || g.mode === 'serve') rallyHide(); return; }
    var n = playing && g.mode === 'rally' ? g.rally.hits | 0 : 0;
    if (n >= RALLY_CHIP) rallyShow(n); else if (rl.on) rallyHide();
  }

  // =====================================================================
  //  SELLO DE CALIDAD DEL GOLPE (UI-09)
  // =====================================================================
  // Sale del punto de contacto, a ~72 px en la dirección que menos estorba: nunca encima del balón en los 0,3 s siguientes
  // (se proyecta su vuelo), ni del que golpea, ni del marcador; sube ~30 px y se funde en 0,6 s.
  // «PERFECTO» dorado o «BIEN» blanco con la pista de tiempo («un pelín pronto» / «un pelín tarde») si el desfase la explica.
  // Nada en un golpe flojo. Capa de nivel «aviso corto» del árbitro (UI-02). &stamp=1: también con el autopilot (pruebas).
  var stp = { t: 0, wx: 0, wy: 0, wz: 0, ox: 0, oy: 0, x: 0, y: 0, born: 0, cost: 0, dir: 0 }, _sv = null, _sp = { x: 0, y: 0, ok: false }, _sq = { x: 0, y: 0, ok: false };
  var STAMP_R = 72, STAMP_DIRS = [[-0.71, -0.71], [0.71, -0.71], [0, -1], [-1, 0], [1, 0], [-0.71, 0.71], [0.71, 0.71], [0, 1]];
  var STAMP_KF = null, STAMP_KF_RM = [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }];
  function stampDbg(g) { return ctx.params.stamp === '1' && g && g.autopilot; }
  function sproj(x, y, z, out) {
    VB.toThree(x, y, z, _sv); _sv.project(ctx.camera);
    out.x = (_sv.x + 1) * 0.5 * ctx.width; out.y = (1 - _sv.y) * 0.5 * ctx.height; out.ok = _sv.z < 1 && _sv.z > -1;
    return out;
  }
  /** Subida (px) del sello a los t s: la misma curva que STAMP_KF. */
  function stampRise(t) {
    var u = Math.min(1, Math.max(0, t / 0.6)), K = [[0, -6], [0.14, 7], [0.3, 14], [0.62, 23], [1, 30]];
    for (var i = 1; i < K.length; i++) if (u <= K[i][0]) return K[i - 1][1] + (K[i][1] - K[i - 1][1]) * (u - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
    return 30;
  }
  function stampHit(e, g) {
    if (e.team !== 0 || (e.grade !== 'perfect' && e.grade !== 'good')) return;      // golpe flojo: nada
    if (!ctx.camera || !VB.toThree || !ctx.THREE || !el.stamp) return;
    // árbitro de capas (UI-02): con banner y tarjeta guiada a la vez no hay sitio para otra capa
    if (((banT > 0 && el.banner.classList.contains('show')) || bugT > 0) && guideT > 0) return;
    if (!_sv) _sv = new ctx.THREE.Vector3();
    ctx.camera.updateMatrixWorld();
    var pf = e.grade === 'perfect', hint = '';
    if (!pf && typeof e.timing === 'number' && Math.abs(e.timing) > 0.03) hint = e.timing < 0 ? 'un pelín pronto' : 'un pelín tarde';
    var C = sproj(e.x, e.y, e.z, _sp); if (!C.ok) return;
    var cx = C.x, cy = C.y;
    // tamaño aproximado del sello (px CSS; sin medir el DOM)
    var k = hudScale * (ctx.isTouch ? 0.82 : 1), bw = (pf ? 160 : hint ? 132 : 84) * k, bh = (pf ? 42 : hint ? 52 : 30) * k;
    // vuelo del balón en los próximos 0,1/0,2/0,3 s, en pantalla (tras el golpe ya lleva su velocidad nueva)
    var b = g.ball, Gv = (VB.C && VB.C.G) || 9.81, BP = _bp3;
    for (var i = 0; i < 3; i++) { var t = (i + 1) * 0.1, q = sproj(b.x + b.vx * t, b.y + b.vy * t, Math.max(0.1, b.z + b.vz * t - 0.5 * Gv * t * t), _sq); BP[i * 3] = q.x; BP[i * 3 + 1] = q.y; BP[i * 3 + 2] = q.ok ? 1 : 0; }
    // el que golpea (de los pies a la cabeza)
    var p = e.player || g.ctrl, F = sproj(p.x, p.y, 0, _sq), fx = F.x, fy = F.y, hy = sproj(p.x, p.y, (p.z || 0) + 1.95, _sq).y, half = Math.max(12, (fy - hy) * 0.3);
    var sb = el.sbBody ? el.sbBody.getBoundingClientRect() : null, W = ctx.width, Hh = ctx.height, best = 0, bc = 1e9;
    for (var d = 0; d < STAMP_DIRS.length; d++) {
      var ox = STAMP_DIRS[d][0] * STAMP_R, oy = STAMP_DIRS[d][1] * STAMP_R * 0.8, c = d >= 5 ? 8 : d >= 3 ? 3 : 0; // arriba, mejor (sube)
      for (var j = 0; j < 3; j++) {
        if (!BP[j * 3 + 2]) continue;
        var sx = cx + ox, sy = cy + oy - stampRise((j + 1) * 0.1), dx = Math.max(0, Math.abs(BP[j * 3] - sx) - bw * 0.5), dy = Math.max(0, Math.abs(BP[j * 3 + 1] - sy) - bh * 0.5);
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < 18) c += 100 * (j === 1 ? 2 : 1); else c += 120 / dd;
      }
      var l = cx + ox - bw / 2, r = l + bw, tp = cy + oy - bh / 2 - 30, bt = cy + oy + bh / 2;
      var ix = Math.min(r, fx + half) - Math.max(l, fx - half), iy = Math.min(bt, fy) - Math.max(tp, hy);
      if (ix > 0 && iy > 0) c += 25 * (ix * iy) / Math.max(1, bw * bh);
      if (l < 8 || r > W - 8 || tp < 8 || bt > Hh - 8) c += 200;
      if (sb && l < sb.right + 6 && r > sb.left && tp < sb.bottom + 6 && bt > sb.top) c += 200;
      if (c < bc - 0.01) { bc = c; best = d; }
    }
    stp.ox = STAMP_DIRS[best][0] * STAMP_R; stp.oy = STAMP_DIRS[best][1] * STAMP_R * 0.8;
    stp.wx = e.x; stp.wy = e.y; stp.wz = e.z; stp.t = 0.62; stp.born = performance.now(); stp.cost = bc; stp.dir = best;
    el.stampT.textContent = pf ? 'Perfecto' : 'Bien';
    el.stampS.textContent = hint; el.stampS.hidden = !hint;
    el.stamp.className = 'on ' + (pf ? 'pf' : 'gd');
    stampPlace();
    if (!STAMP_KF) STAMP_KF = [
      { opacity: 0, transform: 'translate(-50%,-50%) translateY(6px) scale(.8)' },
      { opacity: 1, transform: 'translate(-50%,-50%) translateY(-7px) scale(1.07)', offset: 0.14 },
      { opacity: 1, transform: 'translate(-50%,-50%) translateY(-14px) scale(1)', offset: 0.3 },
      { opacity: 1, transform: 'translate(-50%,-50%) translateY(-23px) scale(1)', offset: 0.62 },
      { opacity: 0, transform: 'translate(-50%,-50%) translateY(-30px) scale(.97)' }];
    try { if (el.stampIn.animate) el.stampIn.animate(reduceMotion ? STAMP_KF_RM : STAMP_KF, { duration: 600, easing: 'linear', fill: 'both' }); } catch (er) { }
  }
  var _bp3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  /** Cada frame mientras vive: sigue al punto del mundo (la cámara se mueve) con su desplazamiento. */
  function stampPlace() {
    var C = sproj(stp.wx, stp.wy, stp.wz, _sp);
    if (!C.ok) { el.stamp.className = ''; stp.t = 0; return; }
    stp.x = C.x + stp.ox; stp.y = C.y + stp.oy;
    el.stamp.style.transform = 'translate3d(' + stp.x.toFixed(1) + 'px,' + stp.y.toFixed(1) + 'px,0)';
  }
  function stampTick(rdt) {
    if (!(stp.t > 0)) return;
    stp.t -= rdt;
    if (stp.t <= 0 || ctx.state !== 'playing') { stp.t = 0; el.stamp.className = ''; return; }
    stampPlace();
  }

  // =====================================================================
  //  PRESENTACIÓN DEL PUNTO (UI-03) Y SINCRONÍA CON LA CÁMARA (UI-04)
  // =====================================================================
  // Nivel 1 (punto de trámite, highlight < 0,55): pestaña compacta junto al marcador (~1 s), sin subtítulo salvo que
  //   informe (fuera, red, antena, dobles, 8 s…). Nivel 2 (bloqueo, ace, jugada ≥ 8 toques, racha ≥ 3, punto de set salvado o
  //   highlight ≥ 0,55): cinta en el tercio inferior (franja alta en pantallas bajas), tras el corte al plano de reacción y
  //   mientras dure ese plano (~1,4 s). Nivel 3 (set/partido): tratamiento central, tras el momento del héroe.
  // Los textos del árbitro de sim («Dobles…», «Falta de saque: 8 segundos», «Ataque sobre el saque»…) salen tal cual.
  var REF_REASONS = { net: 1, antenna: 1, double: 1, four: 1, under: 1, attackServe: 1, block: 1, serve: 1 };
  var pres = null;            // presentación pendiente {t1,t2,t3,cls,dur,kind,gate,rt}
  var lastBig = null;         // última cinta de nivel 2 {team, k} (para no repetir la misma dos puntos seguidos)
  // Ritmo de las cintas grandes: como mucho UNA cada 3 puntos, salvo un punto enorme (highlight ≥ 0,8) o jugado con punto de
  // set/partido (o que lo salva). Medido en partidos humanos (no solo con autopilot): quien juega bien encadena aces, bloqueos
  // y rachas, y la cinta salía en el 42-45 % de los puntos (objetivo ≤ 35 %).
  var BIG_GAP = 2, bigGap = 9, atSP = false;
  var cam = { shot: '', prev: '', cutN: -1, pointRt: -99, pointCut0: -1, courtRt: -1 };
  function queuePres(o) {
    var d = camDbg(); // contador de cortes ACTUAL (cam.cutN solo se refresca durante el punto)
    o.rt = ctx.time; o.cut0 = d && typeof d.cutN === 'number' ? d.cutN : -1; pres = o;
  }
  // Calibrado con la sim (tools/out/ui1/tierstat*.js, 16 partidos con autopilot por nivel): con «jugada ≥ 8 toques» y toda
  // racha ≥ 3 salía cinta grande en el 42 % de los puntos (objetivo ≤ 35 %). Ahora: jugada ≥ 10 toques; la racha se celebra al
  // llegar a 3 y a 5 y solo la tuya; un error del rival es de trámite salvo que salve un punto de set; y la misma cinta no se
  // repite dos puntos seguidos → 32,5 % en Fácil, 28,5 % en Normal, 27 % en Difícil.
  // SIM-05 (ola 3) ya calibra highlight (jugada larga, defensas, racha, final apretado y bloqueo directo van dentro del número):
  // basta highlight ≥ VB.HOLD.bigAt (la misma frontera que la pausa larga de 2,4 s), más el ace y el punto de set salvado.
  var RALLY_BIG = 10;   // solo para el subtítulo «¡Jugada de N toques!»
  function tierOf(e, k) {
    var hl = typeof e.highlight === 'number' ? e.highlight : 0, big = (VB.HOLD && VB.HOLD.bigAt) || 0.55;
    if (k === 'blockPt' || k === 'ace' || e.savedSetPoint) return 2;
    if (k === 'error' || k === 'srvErr') return 1;
    return hl >= big ? 2 : 1;
  }
  function presentPoint(e, me, k, g) {
    var spNow = atSP; atSP = false;                          // ¿se jugó con punto de set/partido? (serveReady de esta jugada)
    if (e.matchWon || e.setWon) { hideBug(false); lastBig = null; bigGap = 9; return; } // lo anuncian 'set' / 'match' (nivel 3)
    var ref = !!REF_REASONS[e.reason] || /^(Saque|Balón) a la red$/.test(e.text || ''), txt = e.text || '';
    var sub = '';
    if (ref || e.reason === 'out') sub = txt;               // texto del árbitro: siempre, tal cual
    var tier = tierOf(e, k);
    // la misma cinta dos puntos seguidos (2.º ace o 2.º bloqueo del mismo equipo) cansa: el segundo va en la pestaña
    // (con esto la cinta grande sale en el 28-33 % de los puntos según el nivel; medido con tools/out/ui1/tierstat5.js)
    if (tier === 2 && lastBig && lastBig.team === e.team && lastBig.k === k && !e.savedSetPoint) tier = 1;
    var hlv = typeof e.highlight === 'number' ? e.highlight : 0;
    // (un bloqueo directo TUYO de los buenos, highlight ≥ 0,6, sale grande aunque haya habido cinta hace poco: verificación ola 2)
    if (tier === 2 && bigGap < BIG_GAP && hlv < 0.8 && !e.savedSetPoint && !spNow && !(k === 'blockPt' && me && hlv >= 0.6)) tier = 1;
    bigGap = tier === 2 ? 0 : bigGap + 1;
    lastBig = tier === 2 ? { team: e.team, k: k } : null;
    // títulos: mismo estilo siempre («… de la CPU»)
    var t1;
    if (k === 'ace') t1 = me ? (tier > 1 ? '¡Ace!' : 'Ace') : 'Ace de la CPU';
    else if (k === 'kill') t1 = me ? (tier > 1 ? '¡Remate!' : 'Remate') : 'Remate de la CPU';
    else if (k === 'tip') t1 = me ? (tier > 1 ? '¡Dejada!' : 'Dejada') : 'Dejada de la CPU';
    else if (k === 'blockPt') t1 = me ? (tier > 1 ? '¡Punto de bloqueo!' : 'Punto de bloqueo') : 'Bloqueo de la CPU';
    else if (k === 'srvErr') t1 = /^falta de saque/i.test(txt) ? (me ? 'Error de la CPU' : 'Punto de la CPU') : (me ? 'Falta de saque de la CPU' : 'Falta de saque');
    else if (k === 'error') t1 = me ? 'Error de la CPU' : 'Punto de la CPU';
    else t1 = me ? (tier > 1 ? '¡Punto!' : 'Punto') : 'Punto de la CPU';
    // ace con roce de recepción: dice por qué (sim lo acredita al saque); el ace limpio no necesita subtítulo. Si el árbitro
    // pita algo («Balón a la red» de la recepción que acaba en la red…), manda su texto, tal cual
    if (k === 'ace' && (e.rallyHits | 0) > 0 && !ref) sub = me ? 'La CPU no controla la recepción' : 'No controlas la recepción';
    // ace en el que la RECEPCIÓN acaba en la red: «Balón a la red» junto a «¡Ace!» se leía como saque a la red (falta del que
    // saca); se cuenta desde el lado del que recibe (verificación ola 2). Las faltas de red/antena/dobles/8 s siguen tal cual.
    if (k === 'ace' && /^Balón a la red$/.test(txt)) sub = me ? 'La recepción de la CPU va a la red' : 'Tu recepción va a la red';
    // contexto que sí informa (nivel 2), si no hay texto del árbitro
    if (!sub && tier > 1) {
      if (e.savedSetPoint) sub = me ? 'Punto de set salvado' : 'La CPU salva el punto de set';
      else if ((e.rallyHits | 0) >= RALLY_BIG) sub = '¡Jugada de ' + e.rallyHits + ' toques!';   // UI-15 (un solo término: «jugada», como en la hoja final)
      else if ((e.streak | 0) >= 3) sub = me ? e.streak + ' puntos seguidos' : e.streak + ' puntos seguidos de la CPU';
      else if (e.clutch && !spNow) sub = 'Final apretado';   // SIM-05: últimos puntos del set con ≤ 2 de diferencia
    }
    var chip = e.sideout ? 'CAMBIO DE SAQUE' : '';
    if (tier === 1) { // la pestaña siempre lleva la llamada del árbitro (fuera, red, antena, dobles, 8 s…)
      showBug(e.team, t1, sub, e.sideout ? '⇄ Saque' : '', sub ? 1.5 : 1.05);
      return;
    }
    // cinta: nunca el mismo subtítulo dos veces seguidas (salvo las faltas del árbitro: red, antena, dobles, 8 s…, que van siempre)
    if (sub && sub === lastSub && !ref) sub = '';
    if (sub) lastSub = sub;
    hideBug(false);
    queuePres({ t1: t1, t2: sub, t3: chip, cls: (me ? (k === 'ace' ? 'ace' : 'win') : 'lose') + ' r2', dur: k === 'ace' ? 1.6 : 1.45, kind: 'point', gate: 'cut' });
  }
  /** Plano de cámara (con guarda) y contador de cortes (CAM-05: getDebug().cutN; si no existe, se deduce). */
  function camRead() {
    var CR = VB.CameraRig; cam.prev = cam.shot;
    try { cam.shot = CR && CR.getShot ? CR.getShot() || '' : ''; } catch (e) { cam.shot = ''; }
    return cam.shot;
  }
  /** Plano de héroe con el que anota a la izquierda (bajo el marcador): el marcador se atenúa (camera_input, CAM-02). */
  var sbDim = false;
  function sbDimTick(g) {
    var on = false;
    if (ctx.state === 'playing' && g.mode === 'point' && cam.shot === 'point') { var d = camDbg(); on = !!(d && d.pf && d.pf.mode === 'hero' && d.pf.heroX < -0.5); }
    if (on !== sbDim) { sbDim = on; if (el.sb) el.sb.classList.toggle('dim', on); }
  }
  function camDbg() { try { return VB.CameraRig && VB.CameraRig.getDebug ? VB.CameraRig.getDebug() : null; } catch (e) { return null; } }
  /** ¿Ya cortó la cámara al plano de reacción? Con CAM-05 (cutN) lo sabe; si no, 0,47 s reales tras empezar el plano del punto
   *  (camera.js PF.hold = 0,45: la cámara de juego mira el bote y luego corta). */
  function reactionReady(o, d) {
    var t = ctx.time - o.rt;
    if (d && typeof d.cutN === 'number' && o.cut0 >= 0) {
      if (d.cutN !== o.cut0) return true;                          // ya cortó: la cinta entra con el plano nuevo
      var nc = typeof d.nextCutIn === 'number' ? d.nextCutIn : -1;
      if (nc >= 0 && nc < 0.6) return false;                       // corte inminente: se espera a él
    }
    return t >= 0.47;                                              // sin corte (deslizamiento) o sin CAM-05
  }
  // cajas en pantalla de los 4 atletas y del balón; el héroe y la víctima del plano del punto (CameraRig.getDebug().pf.hero /
  // .vic = dorsal) pesan mucho más: la cinta no los tapa nunca si hay otro sitio
  var _hb = [], _hbN = 0, _hv = null;
  function hbBox(i) { return _hb[i] || (_hb[i] = { l: 0, t: 0, r: 0, b: 0, w: 1 }); }
  function heroBoxes(g, d) {
    _hbN = 0;
    if (!ctx.camera || !VB.toThree || !ctx.THREE) return;
    if (!_hv) _hv = new ctx.THREE.Vector3();
    // en el frame del corte la cámara ya está en el plano nuevo pero su matriz aún no (se actualiza al pintar)
    ctx.camera.updateMatrixWorld();
    var pf = d && d.pf, W = ctx.width, H = ctx.height;
    for (var j = 0; j < g.players.length; j++) {
      var q = g.players[j];
      VB.toThree(q.x, q.y, 0, _hv); _hv.project(ctx.camera); if (_hv.z > 1 || _hv.z < -1) continue;
      var fx = (_hv.x + 1) * 0.5 * W, fy = (1 - _hv.y) * 0.5 * H;
      VB.toThree(q.x, q.y, (q.z || 0) + 2.0, _hv); _hv.project(ctx.camera);
      var hy = (1 - _hv.y) * 0.5 * H, h = Math.max(20, fy - hy), o = hbBox(_hbN++);
      o.l = fx - h * 0.3; o.r = fx + h * 0.3; o.t = hy - h * 0.06; o.b = fy;
      o.w = pf && (q.num === pf.hero || q.num === pf.vic) ? 12 : 1;
    }
    var b = g.ball;
    if (b) { VB.toThree(b.x, b.y, b.z, _hv); _hv.project(ctx.camera); if (_hv.z < 1 && _hv.z > -1) { var bx = (_hv.x + 1) * 0.5 * W, by = (1 - _hv.y) * 0.5 * H, ob = hbBox(_hbN++); ob.l = bx - 30; ob.r = bx + 30; ob.t = by - 30; ob.b = by + 30; ob.w = 0.5; } }
  }
  function hitsHero(x, y, w, h) {
    var a = 0;
    for (var i = 0; i < _hbN; i++) { var o = _hb[i], ix = Math.min(x + w, o.r) - Math.max(x, o.l), iy = Math.min(y + h, o.b) - Math.max(y, o.t); if (ix > 0 && iy > 0) a += o.w * ix * iy; }
    return a;
  }
  /** Coloca la cinta de nivel 2: tercio inferior (izquierda o derecha) en escritorio, franja alta en pantallas bajas o
   *  táctiles (abajo están el joystick y los botones); la primera que no tape al héroe ni a la víctima. */
  function placeRib2(g, d) {
    var W = ctx.width, H = ctx.height, B = el.banner;
    var bw = B.offsetWidth, bh = B.offsetHeight, m = 16;
    heroBoxes(g, d);
    var sb = el.sbBody ? el.sbBody.getBoundingClientRect() : null, topL = sb ? sb.right + 12 : 230, topR = W - (ctx.isTouch ? 64 : 120);
    var cands = [];
    var low = H <= 560 || ctx.isTouch;
    if (!low) {
      var y1 = Math.round(H * 0.70 - bh * 0.5), y2 = Math.round(H - bh - 28);
      cands.push([m + 40, y1, 'l'], [W - m - 40 - bw, y1, 'r'], [m + 40, y2, 'l'], [W - m - 40 - bw, y2, 'r']);
    }
    var tx = Math.max(topL, Math.min(topR - bw, (topL + topR - bw) * 0.5));
    cands.push([tx, 10, 't']);
    if (low && bw > topR - topL) cands.push([(W - bw) * 0.5, 10, 't']);
    var best = cands[0], ba = 1e18;
    for (var i = 0; i < cands.length; i++) { var c = cands[i], a = hitsHero(c[0], c[1], bw, bh); if (a < ba - 1) { ba = a; best = c; } }
    if (ctx.params.uidbg) console.info('[VB][ui] cinta', JSON.stringify({ c: cands.map(function (c) { return [Math.round(c[0]), Math.round(c[1]), c[2], Math.round(hitsHero(c[0], c[1], bw, bh))]; }), bw: bw, bh: bh, pf: d && d.pf ? [d.pf.hero, d.pf.vic] : null }));
    B.style.left = Math.round(best[0]) + 'px'; B.style.top = Math.round(best[1]) + 'px';
    B.classList.add('at-' + best[2]);
    banRect = null;
  }
  /** Nivel 3 (set/partido): centrado; arriba (sobre la grada), a media altura o en el tercio inferior, donde menos tape al héroe
   *  y a la víctima del plano de reacción (a 1280×720, a media altura tapaba la cabeza del que celebra). */
  function placeT3(g, d) {
    var W = ctx.width, H = ctx.height, B = el.banner;
    B.style.left = ''; // (se recoloca también al entrar la órbita del cierre: se mide centrado)
    var bh = B.offsetHeight, rw = Math.min(W, el.banner.firstChild.offsetWidth), bw = Math.min(W, rw + 40), ro = (bw - rw) * 0.5;
    heroBoxes(g, d);
    // zonas que el rótulo no tapa nunca: el marcador ENTERO (franja, cuerpo con el historial de sets, etiqueta de punto de set y
    // chip de la jugada) y los botones de arriba. Antes solo contaba .sb-body y, en la órbita del cierre (un único sitio arriba),
    // «¡GANAS EL PARTIDO!» tapaba el 25 final a 1280×720 (verificación ola 3)
    var R = [], m = 16;
    function keep(n) { if (!n || n.hidden || !n.offsetWidth) return; var q = n.getBoundingClientRect(); if (q.width) R.push(q); }
    if (el.sb) { keep(el.sb.firstElementChild); keep(el.sbBody); if (!el.tag.hidden) keep(el.tag); if (el.rl.classList.contains('on') && !el.rl.classList.contains('fade')) keep(el.rl); }
    keep(document.querySelector('.hud-btns')); if (ctx.isTouch) keep(document.querySelector('#touch .vt-pause'));
    function hud(x, y) {
      var a = 0;
      // (con la cinta de verdad, sin el margen de 20 px por lado del cálculo de centrado)
      for (var k = 0; k < R.length; k++) { var r = R[k], ix = Math.min(x + ro + rw, r.right + 12) - Math.max(x + ro, r.left - 12), iy = Math.min(y + bh, r.bottom + 10) - Math.max(y, r.top - 10); if (ix > 0 && iy > 0) a += 400 * ix * iy; }   // (manda sobre el héroe, peso 12)
      return a;
    }
    var hudBot = 0; for (var k = 0; k < R.length; k++) hudBot = Math.max(hudBot, R[k].bottom);
    var xc = (W - bw) * 0.5, ys = [Math.round(H * (H <= 560 ? 0.12 : 0.17)), Math.max(Math.round(H * 0.04), 8), Math.round(H - bh - H * (ctx.isTouch ? 0.28 : 0.07))];
    // órbita del cierre (CAM-09): la cámara deja libre la mitad de arriba para el rótulo (camera_input; integración ola 2)
    var dc = d || camDbg();
    if (dc && dc.clinch && dc.clinch.phase === 'hero') ys = [ys[1]];
    // cada altura centrada; si pisa el marcador o los botones, desplazada a la derecha del marcador (si cabe) o justo debajo
    var cands = [];
    for (var i = 0; i < ys.length; i++) {
      var y = ys[i]; if (y < 0) continue;
      cands.push([xc, y, i === 0 ? 0.85 : 1]);              // a igualdad, la posición de siempre
      if (hud(xc, y) > 0) {
        var sbR = 0; for (var j = 0; j < R.length; j++) if (R[j].left < W * 0.5) sbR = Math.max(sbR, R[j].right);
        var xr = Math.max(xc, sbR + m - ro); if (xr + ro + rw <= W - m) cands.push([xr, y, 1]);
        var yb = Math.round(hudBot + 12); if (yb + bh <= H - 8) cands.push([xc, yb, 1.02]);
      }
    }
    var best = cands[0], ba = 1e18;
    for (var c = 0; c < cands.length; c++) {
      var q = cands[c], a = hitsHero(q[0], q[1], bw, bh) * q[2] + hud(q[0], q[1]);
      if (a < ba - 1) { ba = a; best = q; }
    }
    // #banner va de lado a lado (left 0 / right 0, contenido centrado): para el centro en best[0], left = 2·x − (W − bw)
    var L = Math.round(2 * best[0] - (W - bw));
    B.style.left = L > 0 ? L + 'px' : '';
    B.style.top = best[1] + 'px'; banRect = null;
    if (ctx.params.uidbg) console.info('[VB][ui] rótulo', JSON.stringify({ c: cands.map(function (q) { return [Math.round(q[0]), q[1], Math.round(hitsHero(q[0], q[1], bw, bh)), Math.round(hud(q[0], q[1]))]; }), bw: bw, bh: bh }));
  }
  /** Cada frame: avanza la presentación según el plano de cámara (UI-04). */
  function presUpdate(g, dt) {
    var shot = camRead(), d = null;
    var inPoint = g.mode === 'point' || g.mode === 'over';
    if (shot === 'point' || shot === 'court' || shot === 'clinch' || pres || wp.ph || g.mode === 'point' || g.mode === 'over' || cam.prev === 'point' || cam.prev === 'court') d = camDbg();
    var cn = d && typeof d.cutN === 'number' ? d.cutN : -1;
    if (shot === 'point' && cam.prev !== 'point') { cam.pointRt = ctx.time; cam.pointCut0 = cn; }
    var cutNow = cn >= 0 && cam.cutN >= 0 && cn !== cam.cutN;     // corte en ESTE frame (nextCutIn vale 0 en él)
    if (cn >= 0) { if (pres && pres.cut0 < 0) pres.cut0 = cn; cam.cutN = cn; }
    // ¿pasó ya el corte al plano de reacción? (a partir de ahí, el siguiente corte es la vuelta al saque o la grúa)
    var reacted = shot === 'court' || (cn >= 0 && cam.pointCut0 >= 0 ? cn > cam.pointCut0 : false) || ctx.time - cam.pointRt > 0.6;
    wipeTickCut(g, d, reacted, cutNow);
    // corte de vuelta al saque (o cambio de plano fuera del punto): nada del punto sobrevive al corte
    var leftPoint = (cam.prev === 'point' || cam.prev === 'court') && shot !== cam.prev && shot !== 'court' && shot !== 'point';
    if (leftPoint || (!inPoint && g.mode !== 'over')) {
      if (banT > 0 && (banKind === 'point' || banKind === 'set' || banKind === 'court')) hideBanner();
      if (bugT > 0) hideBug(false);
      if (pres && pres.kind !== 'match') pres = null;
      pendCourt = null;
    }
    // vista previa del corte (g.timer = s de juego que quedan de la pausa del punto; el corte llega cuando acaba):
    // la cinta y la pestaña se funden en 120 ms y acaban justo antes del corte
    if (g.mode === 'point' && g.timer > 0 && reacted && dt > 0 && !cutNow) { // (congelado o en pausa: nada se va)
      var nci = d && typeof d.nextCutIn === 'number' ? d.nextCutIn : -1;
      var lead = nci >= 0 ? Math.min(nci, g.timer) : g.timer;
      if (lead <= 0.14) {
        if (banT > 0 && (banKind === 'point' || banKind === 'court' || banKind === 'set')) fadeBanner(0.12);
        if (bugT > 0) hideBug(true);
      }
    }
    // pendiente que espera al plano de reacción
    if (pres && pres.gate === 'cut' && (ctx.time - pres.rt > 0.2) && (shot === 'point' || shot === 'over' || pres.kind === 'match')) {
      if (reactionReady(pres, d) || ctx.time - pres.rt > 1.2) {
        var o = pres; pres = null;
        banner(o.t1, o.t2, o.t3 || o.chip, o.cls, o.dur, o.kind);
        if (o.kind === 'set' || o.kind === 'match' || /toques!$/.test(o.t2 || '')) rallyFade();   // UI-15: la cuenta ya no hace falta
        if (o.kind === 'point') placeRib2(g, d); else if (o.kind === 'set' || o.kind === 'match') placeT3(g, d);
        // la cinta del punto no pasa del final de la pausa (sale antes del corte)
        if (o.kind === 'point' && g.mode === 'point' && g.timer > 0) banT = Math.min(banT, Math.max(0.5, g.timer - 0.02));
      }
    }
    // rótulo de set/partido ya en pantalla cuando la cámara entra en la órbita del cierre: al hueco de arriba (CAM-09)
    var clPh = d && d.clinch ? d.clinch.phase || '' : '';
    if (clPh === 'hero' && cam.clPh !== 'hero' && banT > 0 && (banKind === 'set' || banKind === 'match')) placeT3(g, d);
    cam.clPh = clPh;
    // cambio de campo: al pasar la cámara a la grúa; el banner del set se va en ese momento
    if (pendCourt && shot === 'court') {
      var c = pendCourt; pendCourt = null; pres = null;
      banner('Cambio de campo', c.t2, '', 'neutral fastin mid', c.dur, 'court');
      cam.courtRt = ctx.time;
    }
    if (!pendCourt && banKind === 'set' && banT > 0 && shot === 'court') fadeBanner(0.12);
    var u = d && typeof d.ccU === 'number' ? d.ccU : -1;
    if (banKind === 'court' && banT > 0 && (u >= 0.8 || shot !== 'court')) fadeBanner(0.2);
    // «Set N» en la bajada: cuando ya no queda «Cambio de campo» y la grúa va por el último tramo (o ya ha bajado)
    if (courtNext && !pendCourt && banKind !== 'court' && (u >= 0.8 || (shot !== 'court' && ctx.time - cam.courtRt > 0.5))) {
      var cn2 = courtNext; courtNext = null; newSetShown = cn2.n;
      banner('Set ' + cn2.n, cn2.sub, '', 'neutral', 2.1, 'newSet');
    }
    // sin cámara (o sin plano 'court') el cambio de campo sale tras el banner del set, como antes
    if (pendCourt && shot !== 'court' && ctx.time - pendCourt.rt > 2.4 && banT <= 0.3) {
      var c2 = pendCourt; pendCourt = null; banner('Cambio de campo', c2.t2, '', 'neutral fastin mid', 1.2, 'court');
    }
  }

  // =====================================================================
  //  HUD
  // =====================================================================
  var _bv = null, tbRect = null, coachRect = null, guideRect = null;
  var promptCur = '', promptCls = '', promptHold = 0, promptWho = null, serveT0 = 0, tbLabel1 = 'RECEPCIÓN', coachSeen = {};

  // ---- Primeros toques guiados (primer partido, o &guide=1) ----
  // La primera recepción, la primera colocación y el primer remate del jugador nuevo llegan a cámara lenta
  // con una tarjeta grande que dice exactamente qué pulsar. Una sola vez por tipo.
  var guideT = 0, guideDone = {};
  function guideOn(g) {
    if (g.demo || (g.autopilot && ctx.params.guide !== '1') || ctx.settings.showHelp === false) return false;
    return ctx.params.guide === '1' || (!ctx.debug && record.played === 0);
  }
  function guideCheck(g, p, w, nt, gl) {
    if (guideT > 0 || nt === 0 || banT > 0 || bugT > 0) return; // UI-02: la tarjeta espera a que no haya banner
    var t = w ? (nt === 3 && w.attack ? w.jumpT : w.t) : (g.pr1 ? g.pr1.t : 9);
    var key = nt === 1 ? 'r' : nt === 2 ? 's' : 'a';
    if (guideDone[key] || !(t > 0.05 && t < 0.85)) return;
    if (nt === 3 && !(w && w.attack)) return;
    guideDone[key] = 1;
    // en mayúsculas, sin abreviaturas ordinales ("1.ER" queda mal)
    // (UI-18: el nombre del toque ya lo dice el contador de toques, justo encima: aquí solo el ordinal)
    var k = nt === 1 ? 'Primer toque' : nt === 2 ? 'Segundo toque' : 'Tercer toque';
    var shortT = device() === 'touch' && ctx.height <= 420; // móvil apaisado: tarjeta de una línea
    var txt = shortT ? (nt === 1 ? 'Al aro amarillo y ' + gl.hit : nt === 2 ? 'Bajo el balón y ' + gl.hit : gl.jump + ' y ' + gl.hit + ' arriba')
      : nt === 1 ? 'Ve al aro amarillo y pulsa ' + gl.hit : nt === 2 ? 'Ponte bajo el balón y pulsa ' + gl.hit : gl.jump + ' para saltar · ' + gl.hit + ' arriba';
    el.guideK.textContent = k.toUpperCase(); el.guideT.innerHTML = txt;
    el.guide.className = ''; void el.guide.offsetWidth; el.guide.className = 'show';
    guideT = 2.4;
    try { if (VB.CameraRig && VB.CameraRig.slowmo) VB.CameraRig.slowmo(0.4, 1.3, 0.35); } catch (e) { }
  }
  function guideHide() { guideT = 0.3; el.guide.className = 'out'; }
  // sin cierres por frame: llamadas a la sim protegidas
  function hw(g, p) { try { return VB.Sim.hitWindow(g, p); } catch (e) { return null; } }
  // ventana del aviso "¡Golpea!" = la del brillo de GOLPEAR/SACAR (input.js CUE_OFF/CUE_ON); si cambia allí, cambiar aquí
  var HINT_ON = 0.24, HINT_OFF = -0.15;
  // barra del saque lanzado: la muesca fija marca el instante ideal de pulsar (fracción de la barra; index.html .pr-bar u)
  var NOTCH = 0.78;
  function cr(g, p) { try { return VB.Sim.canReach(g, p); } catch (e) { return false; } }
  function dist2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  /** Franja alta (contador de toques, consejo): centrada, salvo que pise el marcador (HUD grande en un teléfono estrecho):
   *  entonces se corre a la derecha (variable --fx) hasta quedar a 10 px del marcador, sin pasar de los botones de la
   *  derecha. Devuelve true si ha cambiado (el rectángulo medido queda viejo). */
  var fitSh = [0, 0], sbRc = null, sbRcF = -99;
  function fitX(node, r, i) {
    if (!r || !r.width) return false;
    if (!sbRc || ctx.frame - sbRcF > 31) { sbRcF = ctx.frame; sbRc = el.sbBody ? el.sbBody.getBoundingClientRect() : null; }
    if (!sbRc || !sbRc.width) return false;
    var cur = fitSh[i], base = r.left - cur, want = Math.max(0, Math.round(sbRc.right + 10 - base));
    var maxR = ctx.width - (ctx.isTouch ? 62 : 120);
    if (want > 0 && base + want + r.width > maxR) want = Math.max(0, Math.round(maxR - r.width - base));
    if (r.top > sbRc.bottom) want = 0;                         // por debajo del marcador (consejo en escritorio estrecho): no hace falta
    if (Math.abs(want - cur) < 2) return false;
    fitSh[i] = want; node.style.setProperty('--fx', want + 'px');
    return true;
  }

  /** Etiqueta del 1.er toque deducida del estado: RECEPCIÓN si el único contacto rival de la jugada fue el saque, si no DEFENSA. */
  function label1Of(g) {
    if (!g || g.mode !== 'rally') return 'RECEPCIÓN';
    if (g.touchTeam !== 0) return g.lastKind === 'serve' ? 'RECEPCIÓN' : 'DEFENSA';
    if (g.lastKind === 'serve') return 'RECEPCIÓN';
    // rally.hits no cuenta el saque: si todos los contactos de la jugada son nuestros y sacó la CPU, es la recepción
    var hits = g.rally ? g.rally.hits | 0 : 0, t = g.touches | 0;
    return (g.serving === 1 && hits <= t) ? 'RECEPCIÓN' : 'DEFENSA';
  }

  /** Siguiente toque del equipo humano (1..3) o 0 si no le toca. */
  function nextTouch(g) {
    if (g.mode !== 'rally' || g.ball.held) return 0;
    if (g.touchTeam === 0 && g.lastKind !== 'serve') return g.touches < 3 ? g.touches + 1 : 0;
    if (g.touchTeam !== 0 && g.pr1 && g.pr1.x > 0 && g.ball.vx > -0.5) return 1;
    if (g.touchTeam === 1 && g.ball.x > 0) return 1;
    return 0;
  }

  function hud(g, dt) {
    var demo = g.demo;
    setText(el.sbSet, 'set', demo ? 'DEMO' : ('SET ' + g.setNo + (g.setNo === 3 ? ' · A 15' : '')));
    setText(el.name0, 'n0', demo ? 'ROJO' : 'TÚ'); setText(el.name1, 'n1', demo ? 'AZUL' : 'CPU');
    setText(el.pts0, 'p0', g.score[0]); setText(el.pts1, 'p1', g.score[1]);
    var sk = g.sets[0] * 8 + g.sets[1];
    if (last.sets !== sk) {
      last.sets = sk;
      for (var i = 0; i < 2; i++) { el.pips0[i].classList.toggle('on', i < g.sets[0]); el.pips1[i].classList.toggle('on', i < g.sets[1]); }
    }
    var hk = (g.setScores || []).length;
    if (last.hist !== hk) {
      last.hist = hk; el.hist.hidden = !hk;
      el.hist.innerHTML = (g.setScores || []).map(function (s, j) { return 'S' + (j + 1) + ' <b>' + s[0] + '-' + s[1] + '</b>'; }).join(' · ');
    }
    var srv = g.serving;
    if (last.srv !== srv) { last.srv = srv; el.row0.classList.toggle('serving', srv === 0); el.row1.classList.toggle('serving', srv === 1); }
    var tag = '', tagT = -1;
    if (g.mode === 'serve' || g.mode === 'rally') {
      if (g.matchPoint >= 0) { tag = 'PUNTO DE PARTIDO'; tagT = g.matchPoint; }
      else if (g.setPoint >= 0) { tag = 'PUNTO DE SET'; tagT = g.setPoint; }
    }
    if (tag && tagT === 1) tag += ' · CPU';
    // (UI-18) mientras la cinta «Punto de set/partido» lo anuncia, la etiqueta no lo repite debajo del marcador
    if (tag && banKind === 'sp' && banT > 0) tag = '';
    if (last.tag !== tag) { last.tag = tag; el.tag.hidden = !tag; el.tag.textContent = tag; el.tag.classList.toggle('cpu', tagT === 1); }

    var playing = ctx.state === 'playing' && !demo;
    rallyTick(g, dt, playing);
    offTick(g, playing);
    // ---- contador de toques ----
    var nt = playing ? nextTouch(g) : 0;
    if (nt === 1 && g.touchTeam !== 0) tbLabel1 = g.lastKind === 'serve' ? 'RECEPCIÓN' : 'DEFENSA';
    else if (nt === 1 && g.touchTeam === 0 && g.lastKind === 'block') tbLabel1 = 'DEFENSA'; // tras un bloqueo propio
    if (bodyTipT > 0) bodyTipT -= dt || 0;
    var tbk = nt + tbLabel1;
    if (last.tb !== tbk) {
      last.tb = tbk;
      el.touchbar.classList.toggle('off', nt === 0);
      if (nt) {
        el.tb1t.textContent = tbLabel1;
        for (var s = 0; s < 3; s++) {
          el.tb[s].classList.toggle('done', s + 1 < nt);
          el.tb[s].classList.toggle('next', s + 1 === nt);
        }
      }
    }
    // red de seguridad: si el balón proyectado cae dentro del contador de toques, se atenúa (la cámara ya lo evita)
    // Lo mismo con la pastilla del consejo (va justo debajo del contador y es opaca): con el balón detrás, se vuelve
    // translúcida (.thru). Se usa el consejo visible del frame anterior (last.coach).
    var tbDim = false, coachThru = false, guideThru = false;
    if ((nt || last.coach || guideT > 0) && ctx.camera && VB.toThree && ctx.THREE) {
      if (!_bv) _bv = new ctx.THREE.Vector3();
      VB.toThree(g.ball.x, g.ball.y, g.ball.z, _bv); _bv.project(ctx.camera);
      var bpx = (_bv.x + 1) * 0.5 * ctx.width, bpy = (1 - _bv.y) * 0.5 * ctx.height, bOn = _bv.z < 1;
      if (nt) {
        if (!tbRect || (ctx.frame & 31) === 0) { tbRect = el.touchbar.getBoundingClientRect(); if (fitX(el.touchbar, tbRect, 0)) tbRect = el.touchbar.getBoundingClientRect(); }
        tbDim = bOn && inRect(bpx, bpy, tbRect, 12);
      }
      if (last.coach) {
        if (!coachRect || (ctx.frame & 31) === 0) { coachRect = el.coach.getBoundingClientRect(); if (fitX(el.coach, coachRect, 1)) coachRect = el.coach.getBoundingClientRect(); }
        coachThru = bOn && inRect(bpx, bpy, coachRect, 12);
      }
      if (guideT > 0) { // tarjeta guiada: también se aparta si el balón pasa por detrás (CSS solo la atenúa en móvil apaisado)
        if (!guideRect || (ctx.frame & 15) === 0) guideRect = el.guide.getBoundingClientRect();
        guideThru = bOn && inRect(bpx, bpy, guideRect, 12);
      } else guideRect = null;
    }
    if (last.tbDim !== tbDim) { last.tbDim = tbDim; el.touchbar.classList.toggle('thru', tbDim); }
    if (el.guide.classList.contains('thru') !== guideThru) el.guide.classList.toggle('thru', guideThru);
    if (last.coachThru !== coachThru) { last.coachThru = coachThru; el.coach.classList.toggle('thru', coachThru); }
    // ---- aviso contextual + consejo ----
    var help = ctx.settings.showHelp !== false, gl = G(), touchDev = device() === 'touch';
    var pk = '', ptext = '', pcls = '', coach = '', progress = 0, clockF = -1;
    var p = g.ctrl, humanSide = playing && (!g.autopilot || ctx.debug) && !(ctx.introLeft > 0) && !introUI.quiet;
    if (humanSide && p) {
      var sv = g.server || (g.ball.held || null), myServe = g.mode === 'serve' && sv && sv.team === 0;
      var tossed = g.serveState ? g.serveState === 'toss' : !g.ball.held;
      if (myServe && !tossed && g.serveAuth === false) {
        // antes del silbato del árbitro no se puede sacar (regla)
        pk = 'wait'; ptext = 'Espera el silbato';
        coach = touchDev ? 'Tu saque · espera el silbato' : 'Tu saque · ' + gl.move + ' te mueves por el fondo';
      } else if (myServe && !tossed) {
        // táctil: los dos saques van en el MISMO aviso junto al sacador, en dos líneas compactas («SACAR Flotante» /
        // «SALTAR En salto»; la tecla SACAR es la de siempre, #promptKey, y el resto se coloca en rejilla: ver .two en index.html); arriba, en un móvil apaisado, la pastilla del consejo tapaba la red y a los receptores de la CPU
        pk = 'serve'; ptext = touchDev ? (help ? '<span>Flotante</span>' + gl.jump + '<span>En salto</span>' : 'Lanza el balón') : 'Lanzar';
        pcls = touchDev && help ? 'hit two' : 'hit';
        coach = touchDev ? ''
          : g.serveState ? 'Tu saque · ' + gl.move + ' te mueves · ' + gl.serve + ' saque flotante · ' + gl.jump + ' saque en salto'
          : 'Tu saque · ' + gl.move + ' para colocarte en el fondo, apunta con ' + gl.aim + ' (la <b>diana naranja</b> marca adónde va) y pulsa ' + gl.serve;
        // reloj de 8 s (UI-05): aro alrededor de la tecla en los últimos 5 s (ámbar → rojo en los 2 últimos); la cifra y la
        // unidad van en un span sin mayúsculas («3 s», no «3 S»). El texto del árbitro «Falta de saque: 8 segundos» es de sim.
        if (g.serveClock != null && g.serveAuth && g.serveClock < 5 && g.serveClock > 0 && !(g.opts && g.opts.serveClock === false)) clockF = g.serveClock / 5;
        if (clockF >= 0 && g.serveClock < 4.5 && g.serveT > 0.35) { ptext = 'Saca ya <span class="nu">' + Math.ceil(g.serveClock) + ' s</span>'; pcls = 'hit'; coach = 'Regla de los <b>8 segundos</b>: saca antes de que acabe la cuenta'; }
      } else if (myServe) {
        // Balón lanzado. Mientras SUBE, hitWindow().t pasa por ~0 (cruza la altura de contacto de subida):
        // la tecla encendida y «¡Golpea ahora!» SOLO con el balón BAJANDO y dentro de la ventana del brillo de SACAR.
        // Antes de eso (UI-05): sin tecla, reloj de arena y «Espera… golpea al bajar», con una barra que se llena hacia una
        // muesca fija (el instante ideal). Antes salía la tecla con «Golpea al bajar» y quien reaccionaba a la tecla sacaba pronto.
        var ws = VB.Sim.hitWindow ? hw(g, p) : null, b = g.ball;
        var tl = serveTimeLeft(g, ws);
        // La MISMA ventana que el brillo del botón SACAR (input.js CUE_OFF/CUE_ON): ws.press (s hasta el instante ideal
        // de PULSAR) en (-0,15, 0,24).
        var wp = ws ? (ws.press === ws.press && ws.press != null ? ws.press : ws.t) : 9;
        var down = b.vz < 0 && ws && ws.reach;
        // s hasta el instante ideal de PULSAR: hitWindow().press ya cuenta hacia el contacto de BAJADA también mientras sube
        // (medido: 0,85 → 0 de forma continua), el mismo reloj que el aro de SACAR y el de la pista; de reserva, la caída
        var pe = ws && wp === wp && wp < 8 ? wp : (tl > 0 ? tl - ((VB.C && VB.C.WINDUP) || 0.07) : NaN);
        if (pe === pe) { if (!serveT0 || pe > serveT0) serveT0 = Math.max(0.3, pe); progress = pe > 0 ? NOTCH * (1 - pe / serveT0) : NOTCH + (1 - NOTCH) * Math.min(1, -pe / 0.25); }
        if (down && wp < HINT_ON && wp > HINT_OFF) { pk = 'serve'; ptext = device() === 'touch' ? '¡Golpea!' : '¡Golpea ahora!'; pcls = 'hit go bar'; }
        else if (tl > 0 && !(down && wp <= HINT_OFF)) { pk = 'serve'; ptext = 'Espera… golpea al bajar'; pcls = 'hit soon bar'; }
        // balón en el aire: sin consejo arriba (tapaba el balón y el marcador colgado justo al golpear);
        // basta el aviso "¡Golpea ahora!" junto al jugador
        coach = '';
      } else if (g.mode === 'serve') {
        coach = help ? (touchDev ? 'Saca la CPU · a recibir' : 'Saca la CPU · prepárate para la <b>recepción</b>') : '';
      } else if (g.mode === 'rally') {
        var w = VB.Sim && VB.Sim.hitWindow ? hw(g, p) : null;
        var wpr = w ? (w.press === w.press && w.press != null ? w.press : w.t) : 9;
        // misma ventana que el brillo de GOLPEAR (input.js): press en (-0,15, 0,24)
        var reach = w ? (w.reach && wpr < HINT_ON && wpr > HINT_OFF && nt > 0) : (VB.Sim && VB.Sim.canReach ? cr(g, p) : false);
        // en el aire junto a la red con el remate rival aún en su lado: es un bloqueo (automático), no un golpe
        if (reach && g.touchTeam !== 0 && p.z > 0.2 && Math.abs(p.x) < 1.8 && g.ball.x <= 0.3) reach = false;
        if (reach) { pk = 'hit'; ptext = '¡Golpea ahora!'; pcls = 'hit go'; }
        else if (p.z <= 0.01 && g.pr3) {
          var pr = g.pr3;
          if (w && w.attack && w.jumpT > -0.06 && w.jumpT < 0.32) { pk = 'jump'; ptext = '¡Salta!'; pcls = 'jump go'; }
          else if (!w && nt === 3 && g.jobs && g.jobs[0] === p && pr.x > 0 && pr.x < 3.9 && pr.t > 0.08 && pr.t < 0.62 && dist2(p, pr) < 2.9) { pk = 'jump'; ptext = '¡Salta!'; pcls = 'jump go'; }
          else if (g.touchTeam === 1 && g.touches === 2 && (g.defRole === 'block' || !g.defRole) && pr.x < 0 && pr.x > -3.9 && pr.t < 0.62 && p.x < 2.4 && Math.abs(p.y - pr.y) < 1.8) { pk = 'jump'; ptext = '¡Salta! · Bloqueo'; pcls = 'jump go'; }
        }
        if (help && touchDev) { // táctil: una línea corta (el texto completo no cabe entre marcador y pausa)
          // (el contador de toques ya dice recepción/colocación/ataque)
          if (nt === 1) coach = 'Al aro amarillo y ' + gl.hit;
          else if (nt === 2) coach = 'Bajo el balón y ' + gl.hit;
          else if (nt === 3) coach = gl.jump + ' y ' + gl.hit + ' arriba';
          else if (g.touchTeam === 1 && g.touches === 2) coach = g.defRole === 'block' ? '<b>Bloqueo</b>: a la red y ' + gl.jump : '<b>Defiende</b> el aro · ' + gl.sw + ' bloqueas tú';
        } else if (help) {
          if (nt === 1) coach = '1.er toque · <b>' + (tbLabel1 === 'DEFENSA' ? 'Defensa' : 'Recepción') + '</b>: ve al aro amarillo y pulsa ' + gl.hit;
          else if (nt === 2) coach = '2.º toque · <b>Colocación</b>: ponte bajo el balón y pulsa ' + gl.hit;
          else if (nt === 3) coach = '3.er toque · <b>Ataque</b>: ponte bajo el balón, salta con ' + gl.jump + ' y golpea con ' + gl.hit + ' arriba';
          else if (g.touchTeam === 1 && g.touches === 2) coach = g.defRole === 'block' ? 'La CPU va a atacar: frente al atacante, ' + gl.jump + ' para <b>bloquear</b>'
            : 'La CPU va a atacar: <b>defiende</b> el aro · tu compañero bloquea · ' + gl.sw + ' para bloquear tú';
        }
        if (bodyTipT > 0 && help && !touchDev) coach = 'Pulsa ' + gl.hit + ' antes de que llegue el balón';
        if (guideOn(g)) guideCheck(g, p, w, nt, gl);
      }
    }
    if (!help && pcls.indexOf('go') >= 0) { pk = ''; } // sin ayudas: solo el aviso de saque
    if (!(myServe && tossed)) serveT0 = 0;
    // el aviso se mantiene un mínimo para que no parpadee, pero SOLO si el mismo aviso vuelve para el
    // mismo jugador (un golpe o un cambio de jugador lo borran al momento: ver clearPrompt)
    var pkey = pk ? pk + '|' + ptext + '|' + pcls : '';
    // los avisos de "¡ahora!" se apagan enseguida al cerrarse la ventana (si no, invitan a golpear tarde)
    if (pkey) { promptCur = pkey; promptCls = pcls; promptHold = pcls.indexOf('go') >= 0 ? 0.08 : 0.3; promptWho = p; }
    else if (promptHold > 0) { promptHold -= Math.max(dt, ctx.realDt || 0); if (promptHold <= 0 || promptWho !== p) promptCur = ''; }
    // ---- árbitro de capas de texto (UI-02): banner > guía > aviso corto > aviso de golpe > consejo; como mucho 2 ----
    // (la tarjeta guiada cuenta también con .thru: el balón por detrás solo la atenúa, sigue en pantalla)
    var Lban = (banT > 0 && el.banner.classList.contains('show')) || bugT > 0, Lguide = guideT > 0 && el.guide.classList.contains('show');
    if (Lban && Lguide) { guideT = 0; el.guide.className = ''; Lguide = false; }
    var Lcall = calloutT > 0 || stp.t > 0;                     // el sello del golpe (UI-09) cuenta como aviso corto
    // el aviso de golpe («¡Salta!», «¡Golpea ahora!») manda sobre el elogio del toque anterior («Colocación perfecta»): con la
    // tarjeta guiada (o un banner) ya arriba, el elogio se corta para que el aviso pueda salir (nunca 3 capas de texto)
    if (Lcall && promptCur && (Lban || Lguide) && promptCls.indexOf('go') >= 0) { calloutT = 0; el.callout.className = ''; if (stp.t > 0) { stp.t = 0; el.stamp.className = ''; } Lcall = false; }
    var nLay = (Lban ? 1 : 0) + (Lguide ? 1 : 0) + (Lcall ? 1 : 0);
    var promptOk = !!promptCur && nLay < 2;
    var showKey = promptOk ? promptCur + '|' + device() + padFam() : '';
    if (last.prompt !== showKey) {
      last.prompt = showKey;
      if (promptOk) {
        var parts = promptCur.split('|'), dv = device();
        // en el saque el botón táctil se llama SACAR: el aviso usa el mismo nombre
        el.promptKey.textContent = parts[0] === 'jump' ? gl.jumpT : (parts[0] === 'serve' && dv === 'touch' ? 'SACAR' : gl.hitT);
        el.promptKey.className = 'key' + (dv === 'gamepad' ? ' pad ' + padSet()[parts[0] === 'jump' ? 'b' : 'a'][0] : dv === 'touch' ? ' tch' + (parts[0] === 'jump' ? ' j' : '') : '');
        el.promptText.innerHTML = parts[1]; // textos propios (sin datos externos): «Saca ya <span class=nu>3 s</span>»
        el.prompt.className = (parts[0] === 'wait' ? 'wait' : parts[2] || 'hit') + (anchorOn ? ' anch' : '') + (prThru ? ' thru' : '');
        promptW = 0; prKonly = false; // se vuelve a medir (y el className nuevo ya no lleva .konly)
        last.clk = -1; // className reescrito: el aro del reloj vuelve a poner sus clases abajo
      } else { el.prompt.className = 'off' + (anchorOn ? ' anch' : ''); prX = -1; prThru = false; prKonly = false; }
    }
    if (promptOk) {
      if (promptCls.indexOf('bar') >= 0) { var pq = Math.round(Math.max(0, Math.min(1, progress)) * 400); if (pq !== last.pbar) { last.pbar = pq; el.promptBar.style.transform = 'scaleX(' + (pq / 400).toFixed(4) + ')'; } }
      placePrompt(g, p);
    }
    // aro del reloj de 8 s: propiedad --p (0..1) en la tecla; sin maquetación (conic-gradient enmascarado)
    var ck0 = clockF >= 0 && promptOk && promptCur.indexOf('serve|') === 0 && promptCls === 'hit' ? Math.round(clockF * 500) : -1;
    if (ck0 !== last.clk) {
      if ((ck0 >= 0) !== (last.clk >= 0)) el.prompt.classList.toggle('clk', ck0 >= 0);
      last.clk = ck0;
      if (ck0 >= 0) { el.promptRing.style.setProperty('--p', (ck0 / 500).toFixed(3)); el.prompt.classList.toggle('urg', clockF * 5 < 2); }
      else el.prompt.classList.remove('urg');
    }
    // latido por segundo en los 3 últimos (mismos umbrales que el «toc» de audio: Math.ceil 4→3, 3→2, 2→1)
    var csec = ck0 >= 0 ? Math.ceil(g.serveClock) : 0;
    if (csec !== last.csec) {
      if (csec > 0 && csec <= 3 && last.csec === csec + 1) {
        restartAnim(el.promptRing.parentNode, 'tk');
        var nu = el.promptText.querySelector('.nu'); if (nu) restartAnim(nu, 'tk');
      }
      last.csec = csec;
    }
    // el consejo espera a que no haya banner (punto, SET n, punto de set) ni tarjeta guiada, y es la capa que antes cede
    var showCoach = coach && !(ctx.introLeft > 0) && !introUI.quiet && !Lban && !(guideT > 0) && g.mode !== 'point' && (nLay + (promptOk ? 1 : 0)) < 2 && (help || g.mode === 'serve') && (record.played < 3 || ctx.params.coach === '1' || (g.mode === 'serve' && !touchDev));
    // táctil: cada tipo de consejo se ve 3 s como mucho por partido (luego estorba más que ayuda)
    if (showCoach && touchDev) {
      var ckey = g.mode === 'serve' ? 's' + (myServe ? 1 : 0) : 'r' + nt + (g.touchTeam === 1 && g.touches === 2 ? 'b' : '');
      coachSeen[ckey] = (coachSeen[ckey] || 0) + (dt || 0); // tiempo de juego: congelado o en pausa no cuenta
      if (coachSeen[ckey] > 3) showCoach = false;
    }
    var ck = showCoach ? coach : '';
    if (last.coach !== ck) { last.coach = ck; coachRect = null; if (ck) el.coach.innerHTML = ck; el.coach.classList.toggle('off', !ck); }
    // con un aviso de "¡ahora!" en marcha, el consejo se atenúa: los ojos van al jugador
    var dimC = !!ck && promptOk && promptCls.indexOf('go') >= 0;
    if (last.dimC !== dimC) { last.dimC = dimC; el.coach.classList.toggle('faint', dimC); }
  }

  /** Borra el aviso al instante (golpe del equipo humano, cambio de jugador). */
  function clearPrompt() { promptCur = ''; promptHold = 0; }

  /** Segundos hasta que el balón lanzado del saque BAJE a la altura de contacto (sirve también mientras sube). */
  function inRect(x, y, r, m) { return x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m; }
  function serveTimeLeft(g, ws) {
    if (!ws) return 0;
    var b = g.ball, Gv = (VB.C && VB.C.G) || 9, zt = ws.zc + (g.ctrl ? g.ctrl.z : 0);
    if (b.vz < 0 && ws.t > 0) return ws.t;
    var disc = b.vz * b.vz + 2 * Gv * (b.z - zt);
    if (disc < 0) return 0;
    var t = (b.vz + Math.sqrt(disc)) / Gv;
    return t > 0 && t < 3 ? t : 0;
  }

  // ---- Aviso anclado al jugador controlado ----
  // El aviso va a la altura del pecho, al lado del jugador (a su derecha en pantalla; a la izquierda si
  // no cabe): nunca tapa los pies ni el aro amarillo, y queda donde ya están mirando los ojos.
  // Si el jugador no está en pantalla, vuelve abajo al centro (clase 'bot' sin 'anch').
  var anchorOn = true, promptW = 0, promptH = 0, prX = -1, prY = -1, _pv = null, _ph = null, prSide = 1, prThru = false;
  // cajas en pantalla de los OTROS atletas y del balón (px CSS, preasignadas): el aviso no debe taparlos en el momento clave
  var _ob = [], _obN = 0;
  function obBox(i) { return _ob[i] || (_ob[i] = { l: 0, r: 0, t: 0, b: 0, w: 1 }); }
  function collectObstacles(g, p, W, H) {
    _obN = 0;
    for (var t = 0; t < 2; t++) for (var i = 0; i < 2; i++) {
      var q = g.teams && g.teams[t] && g.teams[t][i];
      if (!q || q === p) continue;
      VB.toThree(q.x, q.y, (q.z || 0) + 0.95, _pv); _pv.project(ctx.camera);
      if (_pv.z > 1 || _pv.z < -1) continue;
      VB.toThree(q.x, q.y, (q.z || 0) + 1.95, _ph); _ph.project(ctx.camera);
      var cx = (_pv.x + 1) * 0.5 * W, cy = (1 - _pv.y) * 0.5 * H, hy = (1 - _ph.y) * 0.5 * H, half = Math.max(10, Math.abs(cy - hy));
      var o = obBox(_obN++); o.l = cx - half * 0.42; o.r = cx + half * 0.42; o.t = cy - half; o.b = cy + half; o.w = 1;
    }
    var bl = g.ball;
    if (bl) {
      VB.toThree(bl.x, bl.y, bl.z, _pv); _pv.project(ctx.camera);
      if (_pv.z < 1 && _pv.z > -1) { var bx = (_pv.x + 1) * 0.5 * W, by = (1 - _pv.y) * 0.5 * H, o2 = obBox(_obN++); o2.l = bx - 14; o2.r = bx + 14; o2.t = by - 14; o2.b = by + 14; o2.w = 1.5; }
    }
  }
  /** Fracción (ponderada) de las cajas de obstáculos que quedaría bajo el aviso en (x, y). */
  function overlapAt(x, y) {
    var sum = 0;
    for (var i = 0; i < _obN; i++) {
      var o = _ob[i], ix = Math.min(x + promptW, o.r) - Math.max(x, o.l), iy = Math.min(y + promptH, o.b) - Math.max(y, o.t);
      if (ix > 0 && iy > 0) sum += o.w * (ix * iy) / Math.max(1, (o.r - o.l) * (o.b - o.t));
    }
    return sum;
  }
  // UI-20: los botones táctiles reales (GOLPEAR, SALTAR, ⇄, pausa; con el aro del botón y 10 px de margen) son zonas PROHIBIDAS para
  // el aviso a cualquier tamaño. Se miden al cambiar de tamaño (y cada 2 s por si input.js los recoloca), nunca por frame.
  var tbx = { f: -9999, ok: false, L: [] };
  function touchBoxes() {
    if (!el.app.classList.contains('is-touch')) return null;
    if (tbx.ok && ctx.frame - tbx.f < 120) return tbx.L;
    tbx.f = ctx.frame; tbx.L.length = 0; tbx.ok = false;
    var root = document.getElementById('touch'); if (!root || root.hidden) return tbx.L;
    var bs = root.querySelectorAll('.vt-btn');
    for (var i = 0; i < bs.length; i++) {
      var r = bs[i].getBoundingClientRect(); if (!(r.width > 0)) continue;
      // (pulsado, el botón encoge un poco: se toma la caja de layout entera, centrada)
      var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, hw2 = Math.max(r.width, bs[i].offsetWidth) / 2 + 10, hh2 = Math.max(r.height, bs[i].offsetHeight) / 2 + 10;
      tbx.L.push({ l: cx - hw2, t: cy - hh2, r: cx + hw2, b: cy + hh2 });
    }
    tbx.ok = tbx.L.length > 0;
    return tbx.L;
  }
  function hitTouch(TB, x, y, w, h) {
    if (!TB) return false;
    for (var i = 0; i < TB.length; i++) { var o = TB[i]; if (x < o.r && x + w > o.l && y < o.b && y + h > o.t) return true; }
    return false;
  }
  var prKonly = false, promptWK = 0;
  /** Solo la tecla (sin texto ni barra): el aviso no cabía junto al jugador sin pisar un botón táctil. */
  function setKonly(on) {
    if (on === prKonly) return;
    prKonly = on; el.prompt.classList.toggle('konly', on); prX = -1;
  }
  var _prX = [0, 0, 0], prLast = { x: 0, y: 0, w: 0, h: 0 }, prC = [9, 9, 9];
  /** Costes de los tres sitios (derecha, izquierda, encima) para un aviso de ancho wd; 9 = descartado (borde, joystick o botón táctil). */
  function prCands(TB, wd, sx, gap, y0, yT, hy, lEdge, rEdge, m, W) {
    var xR = sx + gap, xL = sx - gap - wd, xT = Math.max(m, Math.min(W - m - wd, sx - wd * 0.5));
    var w0 = promptW; promptW = wd;                       // overlapAt mide con promptW
    prC[0] = xR + wd > rEdge || hitTouch(TB, xR, y0, wd, promptH) ? 9 : overlapAt(xR, y0);
    prC[1] = xL < lEdge || hitTouch(TB, xL, y0, wd, promptH) ? 9 : overlapAt(xL, y0);
    prC[2] = (yT + promptH > hy - 4) || hitTouch(TB, xT, yT, wd, promptH) ? 9 : overlapAt(xT, yT) + 0.05; // arriba: solo si gana (tapa algo de vista sobre la jugada)
    promptW = w0; _prX[0] = xR; _prX[1] = xL; _prX[2] = xT;
  }
  function placePrompt(g, p) {
    var cam = ctx.camera, W = ctx.width, H = ctx.height;
    if (!cam || !p || !VB.toThree || !ctx.THREE) return anchorBottom();
    if (!_pv) { _pv = new ctx.THREE.Vector3(); _ph = new ctx.THREE.Vector3(); }
    VB.toThree(p.x, p.y, (p.z || 0) + 1.15, _pv); _pv.project(cam);
    VB.toThree(p.x, p.y, (p.z || 0) + 1.85, _ph); _ph.project(cam);
    if (_pv.z > 1 || _pv.z < -1 || Math.abs(_pv.x) > 1.05 || Math.abs(_pv.y) > 1.05) return anchorBottom();
    if (!promptW) {
      // ancho entero (sin .konly) y el de solo la tecla
      if (prKonly) el.prompt.classList.remove('konly');
      promptW = (el.prompt.offsetWidth || 180) * hudScale; promptH = (el.prompt.offsetHeight || 38) * hudScale;
      var kw = el.promptKey.parentNode; promptWK = ((kw && kw.offsetWidth) || 60) * hudScale + 22 * hudScale;
      if (prKonly) el.prompt.classList.add('konly');
    }
    var TB = touchBoxes();
    var sx = (_pv.x + 1) * 0.5 * W, sy = (1 - _pv.y) * 0.5 * H;
    var hy = (1 - _ph.y) * 0.5 * H, body = Math.max(18, Math.abs(sy - hy) * 1.55); // ~ media altura del jugador en px
    var gap = Math.max(26, body * 0.42), m = 12;
    var y0 = Math.max(64, Math.min(H - promptH - m, sy - promptH * 0.5));
    // a la izquierda, el joystick (abajo): el pulgar taparía el aviso. A la derecha, los botones táctiles reales (TB)
    var lEdge = m + (ctx.isTouch && y0 + promptH > H - joyTop() ? joyRight() : 0), rEdge = W - m;
    // Tres sitios junto al jugador controlado (derecha, izquierda, sobre la cabeza): el que menos tape a los demás
    // atletas y al balón. Con histéresis (el lado actual gana los empates por poco) para que no salte de un lado a otro.
    collectObstacles(g, p, W, H);
    var yT = Math.max(64, hy - body * 0.55 - promptH);
    var ko = false, wd = promptW, X = _prX, C = prC;
    prCands(TB, wd, sx, gap, y0, yT, hy, lEdge, rEdge, m, W);
    if (C[0] >= 9 && C[1] >= 9 && C[2] >= 9 && TB && TB.length) { ko = true; wd = promptWK; prCands(TB, wd, sx, gap, y0, yT, hy, lEdge, rEdge, m, W); }   // no cabe entero: solo la tecla
    var y = y0, best = prSide;
    if (C[0] >= 9 && C[1] >= 9 && C[2] >= 9) {
      // nada cabe a la altura del pecho: se sube por encima de los botones (a la derecha o a la izquierda, lo que quede libre)
      best = X[0] + wd > rEdge ? -1 : 1;
      if (TB) for (var k = 1; k <= 12; k++) {
        var yy = y0 - k * 16; if (yy < 52) break;
        if (X[0] + wd <= rEdge && !hitTouch(TB, X[0], yy, wd, promptH)) { best = 1; y = yy; break; }
        if (X[1] >= m && !hitTouch(TB, X[1], yy, wd, promptH)) { best = -1; y = yy; break; }
      }
    } else {
      var cur = C[prSide === 1 ? 0 : prSide === -1 ? 1 : 2], bc = cur - 0.07;
      if (C[0] < bc) { best = 1; bc = C[0]; }
      if (C[1] < bc) { best = -1; bc = C[1]; }
      if (C[2] < bc) { best = 0; bc = C[2]; }
      // el lado actual descartado (9) no se queda por histéresis
      if (C[best === 1 ? 0 : best === -1 ? 1 : 2] >= 9) best = C[0] < 9 ? 1 : C[1] < 9 ? -1 : 0;
    }
    setKonly(ko);
    if (best !== prSide) { prSide = best; prX = -1; } // cambio de lado: salta (deslizarse cruzaría por encima del propio jugador)
    var x = prSide === 1 ? X[0] : prSide === -1 ? X[1] : X[2];
    if (prSide === 0) y = yT;
    x = Math.max(m, Math.min(W - m - wd, x));
    if (!anchorOn) { anchorOn = true; el.prompt.classList.add('anch'); prX = -1; }
    if (prX < 0) { prX = x; prY = y; }
    else { var kk = 1 - Math.exp(-16 * Math.max(0.001, ctx.realDt || 0.016)); prX += (x - prX) * kk; prY += (y - prY) * kk; }
    // el suavizado nunca lo lleva por encima de un botón táctil: si lo pisaría, salta al sitio bueno
    if (hitTouch(TB, prX, prY, wd, promptH)) { prX = x; prY = y; }
    // si aun así (en la posición ya suavizada) tapa a otro atleta o al balón, se vuelve translúcido (como el contador y el consejo)
    var w1 = promptW; promptW = wd; var thru = overlapAt(prX, prY) > 0.08; promptW = w1;
    if (thru !== prThru) { prThru = thru; el.prompt.classList.toggle('thru', thru); }
    el.prompt.style.transform = 'translate3d(' + prX.toFixed(1) + 'px,' + prY.toFixed(1) + 'px,0)';
    prLast.x = prX; prLast.y = prY; prLast.w = wd; prLast.h = promptH;
  }
  // caja del joystick táctil (input.js) en px CSS; se vuelve a medir cada 64 frames
  var joyR = null, joyF = -999;
  function joyBox() {
    if (!joyR || ctx.frame - joyF > 64) {
      joyF = ctx.frame; joyR = { r: 0, h: 0 };
      var j = document.querySelector('#touch .vt-joy'), b = j && j.getBoundingClientRect();
      if (b && b.width) { joyR.r = b.right + 6; joyR.h = ctx.height - b.top; }
    }
    return joyR;
  }
  function joyRight() { return joyBox().r; }
  function joyTop() { return joyBox().h || ctx.height * 0.38; }
  function anchorBottom() {
    if (anchorOn) { anchorOn = false; el.prompt.classList.remove('anch'); el.prompt.style.transform = ''; prX = -1; }
    if (prKonly) setKonly(false);
    if (prThru) { prThru = false; el.prompt.classList.remove('thru'); }
  }

  // =====================================================================
  //  PANTALLAS
  // =====================================================================
  /** UI-16: zoom de la hoja = tamaño del HUD, como mucho lo que quepa en el alto disponible (sin desplazar para ver los botones). */
  function fitSheet(node) {
    var sh = node && node.querySelector ? node.querySelector('.sheet') : null; if (!sh) return;
    if (hudScale <= 1) { if (sh.style.zoom) sh.style.zoom = ''; return; }
    sh.style.zoom = '1';
    var h = sh.scrollHeight, avail = (node.clientHeight || ctx.height) - 32, w = sh.scrollWidth, availW = (node.clientWidth || ctx.width) - 32;
    var z = Math.min(hudScale, Math.max(1, Math.min(avail / Math.max(1, h), availW / Math.max(1, w))));
    sh.style.zoom = z > 1.005 ? z.toFixed(3) : '';
  }
  /** UI-21: hoja desplazable → desvanecido con flecha abajo (.has-more) mientras quede algo por debajo del borde. */
  function checkMore(node) {
    var sh = node && node.querySelector ? node.querySelector('.sheet') : null; if (!sh || node.hidden) return;
    var more = sh.scrollHeight - sh.clientHeight > 2 && sh.scrollTop + sh.clientHeight < sh.scrollHeight - 4;
    if (sh.classList.contains('has-more') !== more) sh.classList.toggle('has-more', more);
  }
  function showNode(node, on) {
    if (on) {
      if (node.hidden) { node.hidden = false; fitSheet(node); checkMore(node); node.classList.remove('in'); requestAnimationFrame(function () { node.classList.add('in'); }); }
    } else { node.hidden = true; node.classList.remove('in'); }
  }
  function syncScreens(g) {
    var s = ctx.state, key = s + (ctx.portraitBlock ? 'P' : '') + (ctx.endHold ? 'H' : '') + (endGate ? 'G' : '') + (panel || '');
    if (key === shown) return;
    shown = key;
    showNode(el.menu, s === 'menu' && !panel);
    showNode(el.pause, s === 'paused' && !panel);
    var endOn = s === 'over' && !!g.finished && !panel && !ctx.endHold && !endGate;
    if (endOn && el.end.hidden) { el.end.classList.toggle('dock', endDocked()); countUp(el.end); }
    showNode(el.end, endOn);
    el.app.classList.toggle('end-on', s === 'over' && !!g.finished);
    showNode(el.panel, !!panel);
    // En el menú el HUD no se oculta con display:none sino casi transparente (.warm): mostrarlo por primera vez
    // al empezar el partido costaba un frame de 100-120 ms (rasterizado del marcador; medido en Chrome/ANGLE).
    // Así ya está pintado y el primer frame del partido baja a < 35 ms.
    el.hud.hidden = false; el.hud.classList.toggle('warm', s === 'menu');
    el.rotate.hidden = !ctx.portraitBlock;
    // la viñeta no se suma al velo de las hojas (pausa, final, paneles)
    el.veil.classList.toggle('under', (s === 'paused' || (s === 'over' && !!g.finished && !ctx.endHold && !endGate && !el.end.classList.contains('dock')) || !!panel));
    if (s === 'menu') { hideBanner(); renderMenu(); }
    if (s === 'paused') renderPause(g);
    focusLayer();
  }
  function activeLayer() {
    if (panel) return el.panel;
    if (ctx.state === 'menu') return el.menu;
    if (ctx.state === 'paused') return el.pause;
    if (ctx.state === 'over' && !el.end.hidden) return el.end;
    return null;
  }
  function focusables(layer) {
    if (!layer) return [];
    var all = layer.querySelectorAll('[data-nav] button, .pn-head button'), out = [];
    for (var i = 0; i < all.length; i++) if (!all[i].closest('[hidden]') && !all[i].disabled) out.push(all[i]);
    // en paneles: primero el contenido y "Volver" al final
    if (panel) out.sort(function (a, b) { return (a.id === 'btnPanelBack') - (b.id === 'btnPanelBack'); });
    return out;
  }
  function focusEl(b, kb) {
    if (!b) return;
    try { b.focus({ preventScroll: !kb }); } catch (e) { }
    var prev = document.querySelectorAll('.kf'); for (var i = 0; i < prev.length; i++) if (prev[i] !== b) prev[i].classList.remove('kf');
    if (kb) b.classList.add('kf');
  }
  function focusLayer(pref) {
    setTimeout(function () {
      var L = activeLayer(); if (!L) return;
      var f = pref || (ctx.state === 'menu' && !panel ? el.btnPlay : null) || focusables(L)[0];
      focusEl(f, false);
    }, 30);
  }
  function navMove(d) {
    var L = activeLayer(), list = focusables(L); if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    i = i < 0 ? 0 : (i + d + list.length) % list.length;
    focusEl(list[i], true); if (list[i].classList && list[i].classList.contains('opt')) uiSound2('optHover'); else hoverSound();
  }

  function renderMenu() {
    var d = device();
    var h = d === 'gamepad' ? '<span class="key">Stick</span> elegir · ' + padKey('a') + ' aceptar · ' + padKey('b') + ' volver'
      : d === 'touch' ? '' : '<span class="key">↑</span><span class="key">↓</span> elegir · <span class="key">Intro</span> aceptar · <span class="key">←</span><span class="key">→</span> cambiar · <span class="key">Esc</span> volver';
    setHTML(el.navHint, 'navh', h);
    setText(el.ctlSub, 'ctls', d === 'gamepad' ? 'Mando conectado' : d === 'touch' ? 'Táctil' : 'Teclado · mando');
    var rec = record.played ? '<span><b>' + record.wins + '/' + record.played + '</b>Victorias</span>' + (record.bestStreak ? '<span><b>' + record.bestStreak + '</b>Mejor racha</span>' : '') : '<span><b>Estreno</b>Primer partido</span>';
    setHTML(el.menuRecord, 'rec', rec);
  }
  var restartArm = 0, restartTo = 0;
  function disarmRestart() {
    restartArm = 0; clearTimeout(restartTo);
    if (el.btnRestart && el.btnRestart.classList.contains('arm')) { el.btnRestart.classList.remove('arm'); el.btnRestart.textContent = 'Reiniciar partido'; }
  }
  /** Pausa (UI-18): el antetítulo da el contexto («Set 1 · 24-10 · Normal»; «Mando desconectado» si se fue el mando) y en medio
   *  solo los sets (el set y el tanteo ya están arriba: nada repetido). */
  var padGone = false;
  function pauseKicker(g) {
    if (padGone) return 'Mando desconectado';
    var nm = VB.DIFF && g && VB.DIFF[g.difficulty] && VB.DIFF[g.difficulty].name;
    return 'Set ' + g.setNo + ' · ' + g.score[0] + '-' + g.score[1] + ' · ' + (nm || OPT.difficulty.labels[optIndex('difficulty')]);
  }
  function renderPause(g) {
    disarmRestart();
    el.pS0.textContent = g.score[0]; el.pS1.textContent = g.score[1];
    el.pMid.innerHTML = 'SETS<b>' + g.sets[0] + '-' + g.sets[1] + '</b>';
    if (el.pKick) el.pKick.textContent = pauseKicker(g);
  }

  // ---------- Celebración previa a la pantalla final ----------
  // (ver «Flujo hasta la hoja final»: endFlow / endHoldTick / endSkip)
  function revealEnd() { endSkip(); }

  // ---------- Final ----------
  function showEnd(e) {
    var win = e.team === 0, T = stats.t;
    var isNew = false;
    if (!ctx.debug) {
      record.played++; if (win) { record.wins++; record.winRun++; } else record.winRun = 0;
      if (T[0].best > record.bestStreak) { record.bestStreak = T[0].best; isNew = record.bestStreak >= 3; } // las rachas cortas no son récord
      saveRecord();
    }
    el.end.classList.toggle('win', win); el.end.classList.toggle('lose', !win);
    // (UI-18) antetítulo con contexto, sin repetir el título: «Palau del Mar · Nivel Normal · 3 sets»
    var nSets = (e.setScores || []).length || ((e.sets ? e.sets[0] + e.sets[1] : 0) | 0), dn = VB.DIFF && ctx.game && VB.DIFF[ctx.game.difficulty] && VB.DIFF[ctx.game.difficulty].name;
    el.endKicker.textContent = 'Palau del Mar · Nivel ' + (dn || OPT.difficulty.labels[optIndex('difficulty')]) + ' · ' + nSets + (nSets === 1 ? ' set' : ' sets');
    el.endTitle.textContent = win ? '¡Victoria!' : 'Gana la CPU';
    el.endS0.textContent = e.sets[0]; el.endS1.textContent = e.sets[1];
    el.endSets.innerHTML = (e.setScores || []).map(function (s, i) {
      return '<span class="w' + (s[0] > s[1] ? 0 : 1) + '"><small>SET ' + (i + 1) + '</small>' + s[0] + '-' + s[1] + '</span>';
    }).join('');
    // ataque + bloqueo + saque + errores del rival = puntos (cada punto cuenta en una sola fila)
    var rows = [['Puntos', 'points'], ['Puntos de ataque', 'kills'], ['Puntos de bloqueo', 'blocks'], ['Aces', 'aces'], ['Errores del rival', 'oppErr'], ['Mejor racha', 'best']];
    // (UI-18: sin la cabecera «TÚ · CPU»: el resultado de arriba ya dice qué lado es cada uno y las cifras van en el color del equipo)
    var html = '';
    rows.forEach(function (r, i) {
      var a = T[0][r[1]], b = T[1][r[1]], m = Math.max(1, a, b);
      html += '<div class="st-r' + (i === 0 ? ' tot' : '') + '" style="animation-delay:' + (0.15 + i * 0.07).toFixed(2) + 's"><b>' + a + '</b><div class="mid"><div class="bar l"><i style="--w:' + (a / m * 100).toFixed(0) + '%"></i></div><div class="bar r"><i style="--w:' + (b / m * 100).toFixed(0) + '%"></i></div><em>' + r[0] + '</em></div><b>' + b + '</b></div>';
    });
    el.endStats.innerHTML = html;
    var rec = '<span>Jugada más larga: <b>' + stats.longest + ' toques</b></span>';
    if (!ctx.debug) rec += '<span>Partidos ganados: <b>' + record.wins + ' de ' + record.played + '</b></span>';
    var bs = record.bestStreak;
    if (isNew) rec += '<span class="new">¡Nueva mejor racha: ' + (bs === 1 ? '1 punto seguido' : bs + ' puntos seguidos') + '!</span>';
    else if (record.winRun > 1) rec += '<span class="new">' + record.winRun + ' victorias seguidas</span>';
    // siguiente paso en un clic: tras ganar, revancha un nivel por encima; tras perder (salvo en Fácil), uno por debajo
    var di = optIndex('difficulty'), alt = win ? (di < OPT.difficulty.vals.length - 1 ? di + 1 : -1) : (di > 0 ? di - 1 : -1);
    if (!win && alt >= 0) rec += '<span class="new">¿Te cuesta? Prueba el nivel <b>' + OPT.difficulty.labels[alt] + '</b></span>';
    el.btnAgainAlt.hidden = alt < 0;
    if (alt >= 0) { el.btnAgainAlt.textContent = 'Revancha en ' + OPT.difficulty.labels[alt]; el.btnAgainAlt.setAttribute('data-d', OPT.difficulty.vals[alt]); }
    el.endRecord.innerHTML = rec;
    // MVP de cada equipo (UI-11). UI-18: una tabla pequeña: un solo rótulo «MVP», la cabecera «Ataque · Bloqueo · Saque» una vez y en
    // cada fila el dorsal, los puntos (la cifra grande) y su desglose; el lector de pantalla oye la frase entera (aria-label).
    var mv = '', nMv = 0;
    for (var tm = 0; tm < 2; tm++) {
      var best = null;
      for (var id in stats.p) { var q = stats.p[id]; if (q.team !== tm) continue; if (!best || q.pts > best.pts || (q.pts === best.pts && (q.kills > best.kills || (q.kills === best.kills && q.blocks > best.blocks)))) best = q; }
      if (!best || !best.pts) continue;
      var aria = 'MVP ' + (tm === 0 ? 'de tu equipo' : 'de la CPU') + ', dorsal ' + best.num + ': ' + best.pts + (best.pts === 1 ? ' punto' : ' puntos') + ' (' + best.kills + ' de ataque, ' + best.blocks + ' de bloqueo, ' + best.aces + (best.aces === 1 ? ' ace' : ' aces') + ')';
      var cell = function (v) { return '<b' + (v ? ' data-cu="' + v + '"' : ' class="z"') + '>' + v + '</b>'; };
      mv += '<div class="mvp t' + tm + '" data-pid="' + best.id + '" role="group" aria-label="' + aria + '"><span class="mvp-n" aria-hidden="true">' + best.num + '</span>' +
        '<strong aria-hidden="true"><i data-cu="' + best.pts + '" class="mvp-pts">' + best.pts + '</i></strong>' + cell(best.kills) + cell(best.blocks) + cell(best.aces) + '</div>';
      nMv++;
    }
    el.endMvp.innerHTML = nMv ? '<span class="mvp-h" aria-hidden="true">MVP</span><div class="mvp-cols" aria-hidden="true"><span></span><span></span><span>Ataque</span><span>Bloqueo</span><span>Saque</span></div>' + mv : '';
    el.endMvp.classList.toggle('two', nMv > 1);
    shown = '';
  }
  /** Cuenta hacia arriba (600 ms, rAF) de las cifras de la hoja final al aparecer: solo textContent (cifras tabulares, la hoja no
   *  cambia de tamaño). Movimiento reducido: cifras finales directamente. */
  var cuRaf = 0;
  function countUp(root) {
    var L = root.querySelectorAll('[data-cu], .st-r b, .es-t b'), items = [];
    for (var i = 0; i < L.length; i++) { var n = L[i], v = +(n.getAttribute('data-cu') || n.textContent) || 0; if (v > 0) items.push([n, v]); }
    cancelAnimationFrame(cuRaf);
    // AUD-08: revelación del MVP (el acento cae a 0,6 s, cuando se posan las cifras; con movimiento reducido, 0,6 s tras aparecer)
    if (el.endMvp && el.endMvp.firstChild) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('mvp', root.classList.contains('win')); } catch (e) { } }
    if (reduceMotion || !items.length) return;
    for (var k = 0; k < items.length; k++) items[k][0].textContent = '0';
    // un solo reloj: t0 = sello del PRIMER frame de rAF (mezclar performance.now() con los sellos de rAF daba cifras negativas)
    var t0 = -1;
    cuRaf = requestAnimationFrame(function step(now) {
      if (t0 < 0) t0 = now;
      var u2 = Math.max(0, Math.min(1, (now - t0) / 600)), e2 = 1 - Math.pow(1 - u2, 3);
      var chg = false;
      for (var j = 0; j < items.length; j++) { var tv = String(Math.round(items[j][1] * e2)); if (items[j][0].textContent !== tv) { items[j][0].textContent = tv; chg = true; } }
      // AUD-08: tic en los frames en que cambia alguna cifra (audio.js los espacia: ≤ 20/s, se frenan con la cuenta) y «clac» en el último
      if (chg || u2 >= 1) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('count', u2, now); } catch (e) { } }
      if (u2 < 1) cuRaf = requestAnimationFrame(step);
    });
  }
  // ---------- Flujo hasta la hoja final (UI-11 / UI-13) ----------
  // Escritorio (≥ 1000 px): al llegar gameOver, cortinilla y hoja acoplada a la izquierda (la celebración sigue a la derecha).
  // Móvil: la celebración sin nada encima hasta que acaba el cierre de la cámara (clinchLeft = 0) y han pasado ≥ 2,5 s desde el
  // punto que gana el partido; cualquier botón o toque lo adelanta (tras 0,8 s). Luego cortinilla y hoja.
  var endGate = false, endWait = 0, endT0 = 0, matchPtT = -99, endTeam = 0, endPeek = false;
  function endDocked() { return (ctx.width || innerWidth) >= 1000; }
  function endFlow(e) {
    endTeam = e.team === 1 ? 1 : 0; endPeek = false; el.end.classList.remove('peek');
    if (ctx.debug && ctx.params.hold !== '1') { endGate = false; return; }   // depuración: la hoja al momento
    endGate = true; endT0 = ctx.time;
    if (endDocked()) { endWait = 0; if (!wipeRun(endTeam, endOpen)) endOpen(); return; }
    endWait = 1; ctx.endHold = true;
    var d = device();
    el.skip.innerHTML = d === 'touch' ? 'Toca para ver el resultado' : d === 'gamepad' ? padKey('a') + 'Ver el resultado' : '<span class="key">Intro</span>Ver el resultado';
    el.skip.hidden = false; shown = '';
  }
  function endOpen() { endGate = false; endWait = 0; ctx.endHold = false; el.skip.hidden = true; shown = ''; if (ctx.game) syncScreens(ctx.game); }
  function endHoldTick() {
    if (!endWait) return;
    if (ctx.state !== 'over') { endWait = 0; endGate = false; ctx.endHold = false; el.skip.hidden = true; return; }
    var cl = 0; try { cl = VB.CameraRig && VB.CameraRig.clinchLeft ? +VB.CameraRig.clinchLeft() || 0 : 0; } catch (er) { cl = 0; }
    var ref = matchPtT > endT0 - 12 ? matchPtT : endT0;            // desde el punto que gana el partido (o desde gameOver si no se vio)
    if (ctx.time - ref >= 2.5 && ctx.time - endT0 >= 0.25 && cl <= 0.01) endGo();
  }
  function endGo() { if (endWait !== 1) return; endWait = 2; el.skip.hidden = true; if (!wipeRun(endTeam, endOpen)) endOpen(); }
  function endSkip() { if (endWait === 1 && ctx.time - endT0 >= 0.8) endGo(); }
  /** Cambia entre la hoja y la celebración (móvil). */
  function setPeek(on) { endPeek = !!on; el.end.classList.toggle('peek', endPeek); focusEl(endPeek ? el.btnEndBack : el.btnPeek, false); }
  /** ctx.uiDock = {side:'left', frac} con la hoja final acoplada (CAM-10 encuadra en el resto); null si no. */
  var dockKey = '';
  function dockTick() {
    var on = ctx.state === 'over' && !el.end.hidden && el.end.classList.contains('dock') && !endPeek;
    var sh = on ? el.end.querySelector('.sheet') : null, r = sh ? sh.getBoundingClientRect() : null;
    var frac = r && r.width ? Math.min(0.75, Math.max(0, r.right / (ctx.width || innerWidth))) : 0;
    var k = on ? 'l' + frac.toFixed(3) : '';
    if (k !== dockKey) { dockKey = k; ctx.uiDock = on ? { side: 'left', frac: +frac.toFixed(3) } : null; }
  }

  // =====================================================================
  //  PANELES: tutorial, controles, ajustes
  // =====================================================================
  // (UI-18: el antetítulo da contexto, nunca repite el título ni las pestañas)
  var PANELS = { tut: ['pnTut', 'Tutorial', 'Cómo se juega'], ctl: ['pnCtl', 'Botones y gestos', 'Controles'], set: ['pnSet', 'Se guardan en este navegador', 'Ajustes'], first: ['pnFirst', 'Antes de empezar', 'Primer partido'] };
  var firstAsked = false;
  /** JUGAR desde el menú: la primera vez (sin partidos ni tutorial) ofrece ver el tutorial o jugar ya. */
  function play() {
    if (!firstAsked && !record.played && !record.tut && !ctx.debug) {
      firstAsked = true; uiSound('click');
      var di = optIndex('difficulty');
      el.firstDiff.textContent = 'Nivel ' + OPT.difficulty.labels[di] + (di === 0 ? ' (recomendado para empezar)' : '') + ' · se cambia en el menú';
      openPanel('first', 'menu'); return;
    }
    uiSound('start'); goMatch();
  }
  /** Al partido (menú, revancha, tutorial): bajo la cortinilla de marca (UI-13). */
  function goMatch(diff) {
    if (!wipeRun(2, function () { if (diff) ctx.actions.setSetting('difficulty', diff); ctx.actions.startMatch(); }) && !wp.cb) ctx.actions.startMatch();
  }
  function goMenu() { if (!wipeRun(2, function () { ctx.actions.toMenu(); }) && !wp.cb) ctx.actions.toMenu(); }
  function openPanel(name, from) {
    panel = name; panelFrom = from || ctx.state;
    for (var k in PANELS) $(PANELS[k][0]).hidden = k !== name;
    el.pnKick.textContent = PANELS[name][1]; el.pnTitle.textContent = PANELS[name][2];
    if (name === 'tut') { tutGo(0); }
    if (name === 'ctl') { ctlView = device(); renderCtl(); }
    if (name === 'set') renderOpts();
    var psh = el.panel.querySelector('.sheet');
    psh.classList.toggle('first', name === 'first');
    psh.classList.toggle('wide', name === 'set');
    psh.scrollTop = 0;
    shown = '';
    syncScreens(ctx.game);
    fitSheet(el.panel); checkMore(el.panel);
    focusLayer(name === 'tut' ? el.btnTutNext : name === 'first' ? el.btnFirstTut : null);
  }
  function closePanel() {
    if (!panel) return false;
    var was = panel; panel = null; tutStop();
    shown = ''; syncScreens(ctx.game);
    focusLayer(ctx.state === 'menu' ? (was === 'tut' ? el.btnTut : was === 'ctl' ? el.btnControls : was === 'first' ? el.btnPlay : el.btnSettings) : null);
    return true;
  }

  // ---------- Controles (UI-21 / UI-22) ----------
  // El dispositivo en uso va grande, en dos columnas; los otros, en pestañas pequeñas (clic, toque, ←/→ o el stick).
  var ctlView = 'keyboard';
  function K(t) { return '<kbd>' + t + '</kbd>'; }
  function S(t) { return '<span class="key">' + t + '</span>'; }
  function T(t, j) { return '<span class="key tch' + (j ? ' j' : '') + '">' + t + '</span>'; }
  function ctlRows(dv) {
    if (dv === 'gamepad') {
      var P = padSet();
      return [[S('Stick') + S('Cruceta'), 'Moverse'], [padKey('a'), 'Golpear · sacar'], [padKey('b') + padKey('x'), 'Saltar <small>(en el aire: dejada)</small>'],
        [padKey('y') + S(P.lb) + S(P.rb), 'Cambiar jugador'], [S(P.start), 'Pausa'], [S(P.select), 'Sonido'], [padKey('a') + padKey('b'), 'Menús: aceptar · volver']];
    }
    if (dv === 'touch') return [[S('Joystick') + '<small>mitad izquierda</small>', 'Moverse'], [T('Golpear'), 'Golpear <small>(SACAR en el saque)</small>'],
      [T('Saltar', 1), 'Saltar <small>(en el aire: dejada)</small>'], [S('⇄'), 'Cambiar jugador'], [S('II'), 'Pausa']];
    return [[K('W') + K('A') + K('S') + K('D') + '<small>o</small>' + K('↑') + K('←') + K('↓') + K('→'), 'Moverse'], [K('Espacio') + K('J'), 'Golpear · sacar'],
      [K('K') + K('X'), 'Saltar <small>(en el aire: dejada)</small>'], [K('C'), 'Cambiar jugador'], [K('P') + K('Esc'), 'Pausa'], [K('M'), 'Sonido']];
  }
  function renderCtl() {
    var cur = device(), tabs = el.pnCtl ? el.pnCtl.querySelectorAll('.ctl-tab') : [];
    for (var i = 0; i < tabs.length; i++) {
      var k = tabs[i].getAttribute('data-ctl'), on = k === ctlView;
      tabs[i].classList.toggle('on', on); tabs[i].classList.toggle('cur', k === cur); tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var R = ctlRows(ctlView), h = '';
    for (var j = 0; j < R.length; j++) h += '<div><dt>' + R[j][0] + '</dt><dd>' + R[j][1] + '</dd></div>';
    el.ctlGrid.innerHTML = h;
    if (!el.panel.hidden) { fitSheet(el.panel); checkMore(el.panel); }
  }
  function ctlStep(d) {
    var L = ['keyboard', 'gamepad', 'touch'], i = L.indexOf(ctlView);
    ctlView = L[(i + d + L.length) % L.length]; renderCtl(); click();
    var t = el.pnCtl.querySelector('.ctl-tab[data-ctl="' + ctlView + '"]'); if (t && document.activeElement && document.activeElement.classList.contains('ctl-tab')) focusEl(t, true);
  }

  // ---------- Opciones ----------
  var OPT = {
    // 4 niveles (sim: VB.DIFF_ORDER / VB.DIFF[k].name)
    difficulty: (VB.DIFF_ORDER && VB.DIFF) ? { vals: VB.DIFF_ORDER.slice(), labels: VB.DIFF_ORDER.map(function (k) { return (VB.DIFF[k] && VB.DIFF[k].name) || k; }) }
      : { vals: ['easy', 'normal', 'hard', 'expert'], labels: ['Fácil', 'Normal', 'Difícil', 'Experto'] },
    muted: { vals: [false, true], labels: ['Sí', 'No'] },
    quality: { vals: ['auto', 'high', 'medium', 'low'], labels: ['Auto', 'Alta', 'Media', 'Baja'] },
    showHelp: { vals: [true, false], labels: ['Sí', 'No'] },
    // Accesibilidad (UI-16)
    camStable: { vals: [true, false], labels: ['Sí', 'No'] },
    rumble: { vals: [true, false], labels: ['Sí', 'No'] },
    hudScale: { vals: [1, 1.15, 1.3], labels: ['100%', '115%', '130%'] },
    softFlash: { vals: [true, false], labels: ['Sí', 'No'] }
  };
  function optIndex(k) { var o = OPT[k], v = ctx.settings[k]; for (var i = 0; i < o.vals.length; i++) if (o.vals[i] === v) return i; return k === 'difficulty' ? 1 : 0; }
  var SLIDERS = { camSens: { min: 0.5, max: 1.5, def: 1 }, sfxVol: { min: 0, max: 1, def: 1 }, musicVol: { min: 0, max: 1, def: 0.75 } };
  function slVal(k) { var c = SLIDERS[k], v = +ctx.settings[k]; return isFinite(v) ? Math.max(c.min, Math.min(c.max, v)) : c.def; }
  function changeOpt(k, d, absIdx, arrowDir) {
    if (SLIDERS[k]) {
      var c = SLIDERS[k], v = Math.round((slVal(k) + d * 0.1) * 10) / 10;
      if (v > c.max + 1e-6) v = d > 0 && absIdx === 'wrap' ? c.min : c.max; if (v < c.min - 1e-6) v = c.min;
      ctx.actions.setSetting(k, v);
      if (k === 'sfxVol' && ctx.settings.muted) ctx.actions.setSetting('muted', false);   // mover el volumen quita el silencio
      if (k === 'sfxVol' && VB.Audio && VB.Audio.play) try { VB.Audio.play('pass', 0.8); } catch (e) { }
    } else {
      var o = OPT[k], i = absIdx != null ? absIdx : (optIndex(k) + d + o.vals.length) % o.vals.length;
      ctx.actions.setSetting(k, o.vals[i]);
    }
    optSound(k, arrowDir);
  }
  /** AUD-08: confirmación con el sonido de su tipo: flecha de dificultad (la nota sigue al nivel), Sí/No, varios valores, deslizador. */
  function optSound(k, arrowDir) {
    var A = VB.Audio; if (!A || !A.ui) return click();
    try {
      if (SLIDERS[k]) { if (k !== 'sfxVol') A.ui('slide', (slVal(k) - SLIDERS[k].min) / (SLIDERS[k].max - SLIDERS[k].min)); return; }
      var o = OPT[k], i = optIndex(k);
      if (arrowDir) A.ui('arrow', arrowDir, i, o.vals.length);
      else if (o.labels.length === 2 && o.labels[0] === 'Sí') A.ui('toggle', i === 0);
      else A.ui('select', i, o.vals.length);
    } catch (e) { }
  }
  function uiSound2(kind, a) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui(kind, a); } catch (e) { } }
  /** Flechas de la dificultad: ‹/› sin dar la vuelta (en Fácil, ‹ no hace nada salvo un rebote). */
  function stepDiff(d) {
    var o = OPT.difficulty, i = optIndex('difficulty'), j = Math.max(0, Math.min(o.vals.length - 1, i + d));
    if (j === i) { restartAnim(el.diffVal.parentNode, d < 0 ? 'sl-r' : 'sl-l'); uiSound2('arrowEdge', d); return; }
    changeOpt('difficulty', 0, j, d);
  }
  var lastDiffI = -1;
  function renderOpts() {
    var segs = document.querySelectorAll('[data-seg]');
    for (var i = 0; i < segs.length; i++) {
      var k = segs[i].getAttribute('data-seg'), o = OPT[k], cur = optIndex(k), h = '';
      for (var j = 0; j < o.labels.length; j++) h += '<span data-i="' + j + '"' + (j === cur ? ' class="on"' : '') + '>' + o.labels[j] + '</span>';
      segs[i].innerHTML = h;
    }
    var sls = document.querySelectorAll('[data-sl]');
    for (var m = 0; m < sls.length; m++) {
      var key = sls[m].getAttribute('data-sl'), c = SLIDERS[key], v = slVal(key), f = (v - c.min) / (c.max - c.min) * 100;
      sls[m].querySelector('i').style.width = f + '%'; sls[m].querySelector('b').style.left = f + '%';
      sls[m].querySelector('.v').textContent = Math.round(v * 100) + '%';
    }
    var snd = document.querySelector('.opt-snd');
    if (snd) { snd.classList.toggle('muted', !!ctx.settings.muted); var mb = snd.querySelector('[data-mute]'); if (mb) mb.setAttribute('aria-checked', ctx.settings.muted ? 'true' : 'false'); }
    var q = ctx.quality && ctx.quality.level, qn = { high: 'alta', medium: 'media', low: 'baja' }[q] || '';
    el.qualNote.textContent = ctx.settings.quality === 'auto' ? 'Auto la ajusta sola' + (qn ? ' · ahora: ' + qn : '') : 'Fija · ' + (qn || '');
    // menú: dificultad
    var di = optIndex('difficulty');
    if (el.diffVal.textContent !== OPT.difficulty.labels[di]) {
      el.diffVal.textContent = OPT.difficulty.labels[di];
      // el valor entra deslizando desde el lado de la flecha (solo transform/opacity)
      if (lastDiffI >= 0) { var mv = el.diffVal.parentNode; mv.classList.remove('sl-l', 'sl-r'); void mv.offsetWidth; mv.classList.add(di > lastDiffI ? 'sl-r' : 'sl-l'); }
    }
    lastDiffI = di;
    var ars = el.optDiff.querySelectorAll('.arr');
    if (ars.length === 2) { ars[0].classList.toggle('end', di === 0); ars[1].classList.toggle('end', di === OPT.difficulty.vals.length - 1); }
    for (var n = 0; n < el.diffLvl.children.length; n++) el.diffLvl.children[n].classList.toggle('on', n <= di);
    el.playSub.textContent = 'Partido · ' + OPT.difficulty.labels[di] + ' · Al mejor de 3 sets';
  }

  // ---------- Tutorial ----------
  // Diagramas con proyección en perspectiva de la pista vista desde detrás del
  // equipo humano (como la cámara del juego). Coordenadas de SIMULACIÓN (m).
  var SVGNS = 'http://www.w3.org/2000/svg';
  function P(x, y, z) {
    var d = (x + 9) / 18, s = 0.56 + 0.44 * d;
    return [200 + y * 25 * s, 30 + 200 * d - (z || 0) * 19 * s, s];
  }
  function svgEl(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function pts(list) { return list.map(function (q) { var p = P(q[0], q[1], q[2]); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
  function drawCourt(svg) {
    svgEl('rect', { x: 0, y: 0, width: 400, height: 275, fill: '#0d1a2e' }, svg);
    svgEl('polygon', { points: pts([[-10.5, -6.3], [-10.5, 6.3], [11.6, 6.3], [11.6, -6.3]]), fill: '#2f6f9a' }, svg);
    svgEl('polygon', { points: pts([[-9, -4.5], [-9, 4.5], [9, 4.5], [9, -4.5]]), fill: '#e8cfa0' }, svg);
    svgEl('polygon', { points: pts([[-3, -4.5], [-3, 4.5], [3, 4.5], [3, -4.5]]), fill: '#dfc290' }, svg);
    var L = { fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linejoin': 'round' };
    svgEl('polygon', Object.assign({ points: pts([[-9, -4.5], [-9, 4.5], [9, 4.5], [9, -4.5]]) }, L), svg);
    svgEl('polyline', Object.assign({ points: pts([[-3, -4.5], [-3, 4.5]]) }, L), svg);
    svgEl('polyline', Object.assign({ points: pts([[3, -4.5], [3, 4.5]]) }, L), svg);
    svgEl('polyline', Object.assign({ points: pts([[0, -4.5], [0, 4.5]]) }, L), svg);
  }
  function drawNet(svg) {
    svgEl('polygon', { points: pts([[0, -4.5, 1.43], [0, 4.5, 1.43], [0, 4.5, 2.43], [0, -4.5, 2.43]]), fill: 'rgba(10,14,22,.55)', stroke: 'rgba(255,255,255,.35)', 'stroke-width': 0.6 }, svg);
    svgEl('polyline', { points: pts([[0, -4.5, 2.43], [0, 4.5, 2.43]]), stroke: '#fff', 'stroke-width': 2.2, fill: 'none' }, svg);
    [-4.5, 4.5].forEach(function (y) { svgEl('polyline', { points: pts([[0, y, 1.43], [0, y, 3.23]]), stroke: '#ff4d4d', 'stroke-width': 1.6, 'stroke-dasharray': '3 3', fill: 'none' }, svg); });
    [-5.5, 5.5].forEach(function (y) { svgEl('polyline', { points: pts([[0, y, 0], [0, y, 2.6]]), stroke: '#1b2b44', 'stroke-width': 3.4, fill: 'none' }, svg); });
  }
  function drawPlayer(svg, pl) {
    var g = svgEl('g', {}, svg), p = P(pl.x, pl.y, 0), s = p[2] * 1.45;
    var shadow = svgEl('ellipse', { cx: p[0], cy: p[1], rx: 9 * s, ry: 3.2 * s, fill: 'rgba(0,0,0,.35)' }, g);
    var body = svgEl('g', { transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ') scale(' + s.toFixed(3) + ')' }, g);
    var col = pl.t === 0 ? '#ff6a2e' : '#3a83ff', dark = pl.t === 0 ? '#9c2c0e' : '#173d8a';
    svgEl('rect', { x: -4.2, y: -14, width: 3.4, height: 14, rx: 1.6, fill: '#e9c39d' }, body);
    svgEl('rect', { x: 0.8, y: -14, width: 3.4, height: 14, rx: 1.6, fill: '#e9c39d' }, body);
    svgEl('rect', { x: -5.2, y: -18, width: 10.4, height: 7, rx: 2, fill: '#141b28' }, body);
    svgEl('rect', { x: -6, y: -31, width: 12, height: 15, rx: 4, fill: col }, body);
    var arms = svgEl('g', {}, body);
    svgEl('rect', { x: -9, y: -30, width: 3.2, height: 12, rx: 1.6, fill: col }, arms);
    svgEl('rect', { x: 5.8, y: -30, width: 3.2, height: 12, rx: 1.6, fill: col }, arms);
    svgEl('circle', { cx: 0, cy: -36, r: 5, fill: '#e9c39d' }, body);
    svgEl('path', { d: 'M-5 -37 a5 5 0 0 1 10 0 z', fill: dark }, body);
    if (pl.you) svgEl('path', { d: 'M-4 -49 h8 l-4 5 z', fill: '#ffffff', stroke: '#0d1a2e', 'stroke-width': 0.8 }, body);
    if (pl.lbl) {
      var t = svgEl('text', { x: 0, y: pl.you ? -53 : -46, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'Barlow Condensed,Arial Narrow,sans-serif', 'font-weight': 800, 'font-size': Math.max(12.8, 12.8 * 1.55 / s).toFixed(1), 'letter-spacing': 1, stroke: '#0d1a2e', 'stroke-width': 2.4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, body);
      t.textContent = pl.lbl;
    }
    return { g: g, body: body, arms: arms, shadow: shadow, base: p, s: s, pl: pl };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  /** posición del balón en un tramo: lineal en x,y; parábola con vértice `apex` en z */
  function segPos(sg, u, out) {
    out[0] = lerp(sg.a[0], sg.b[0], u); out[1] = lerp(sg.a[1], sg.b[1], u);
    if (!sg.apex) { out[2] = lerp(sg.a[2], sg.b[2], u); return out; }
    var za = sg.a[2], zb = sg.b[2], h = Math.max(sg.apex, za + 0.01, zb + 0.01);
    var ra = Math.sqrt(h - za), rb = Math.sqrt(h - zb), um = ra / (ra + rb); // instante del vértice
    var k = u < um ? (h - za) / (um * um) : (h - zb) / ((1 - um) * (1 - um));
    out[2] = h - k * (u - um) * (u - um);
    return out;
  }

  var TUT = [
    { step: 'Paso 1 de 6', title: 'El saque', fig: {
        players: [{ t: 0, x: 10.3, y: -1.5, you: 1, lbl: 'TÚ' }, { t: 0, x: 3.5, y: 2 }, { t: 1, x: -6.5, y: -2.2 }, { t: 1, x: -6.5, y: 2.2 }],
        segs: [{ a: [10.0, -1.5, 2.7], b: [-6.2, 1.6, 0.2], apex: 4.3, dur: 1.5, who: 0 }], ring: [-6.2, 1.6], swing: [[0, 0, 0.3]] },
      text: function (g) { return 'Con ' + g.move + ' te desplazas por el fondo. ' + g.serve + ' lanza el balón para un saque flotante; ' + g.jump + ', para un <b>saque en salto</b>. Vuelve a pulsar ' + g.serve + ' cuando baje a tu mano y apunta con ' + g.aim + '.'; },
      rule: '<b>Ace</b> (punto directo de saque): el balón cae en el campo rival o la recepción no se controla. Tienes <b>8 segundos</b> para sacar; si sale fuera o pasa por fuera de las antenas, punto para el rival.' },
    { step: 'Paso 2 de 6', title: '1.er toque · Recepción', fig: {
        players: [{ t: 0, x: 6, y: -1.5, you: 1, lbl: '1' }, { t: 0, x: 1.8, y: 1.2, lbl: '2' }, { t: 1, x: -9.8, y: 1 }, { t: 1, x: -3.5, y: -2 }],
        segs: [{ a: [-9.5, 1, 2.7], b: [5.9, -1.5, 0.85], apex: 4.1, dur: 1.3 }, { a: [5.9, -1.5, 0.85], b: [1.8, 1.2, 2.3], apex: 4.4, dur: 1.0, who: 0 }], ring: [6, -1.5], swing: [[0, 1.25, 0.3]] },
      text: function (g) { return 'Cuando el balón viene a tu campo aparece un <b>aro amarillo</b> donde tienes que jugarlo; se cierra y se llena en el momento de pulsar. Llega al aro y pulsa ' + g.hit + ': el juego hace la <b>recepción</b> de antebrazos hacia tu compañero.'; },
      rule: 'Tras un remate rival el 1.er toque se llama <b>defensa</b>. Tú solo te colocas y golpeas: el tipo de toque lo elige el juego.' },
    { step: 'Paso 3 de 6', title: '2.º toque · Colocación', fig: {
        players: [{ t: 0, x: 4.2, y: -2.4, lbl: '1' }, { t: 0, x: 1.8, y: 1.2, you: 1, lbl: '2' }, { t: 1, x: -5.5, y: -2 }, { t: 1, x: -5.5, y: 2 }],
        segs: [{ a: [3.2, -1.5, 3.4], b: [1.8, 1.2, 2.3], apex: 4.4, dur: 0.7 }, { a: [1.8, 1.2, 2.3], b: [1.1, -2.4, 3.0], apex: 5.3, dur: 1.3, who: 1 }], ring: [1.8, 1.2], swing: [[1, 0.65, 0.3]] },
      text: function (g) { return 'El control pasa solo a tu compañero (la cámara se desliza hacia él). Ponte bajo el balón y pulsa ' + g.hit + ': es la <b>colocación</b>, un balón alto junto a la red.'; },
      rule: 'Cada equipo tiene <b>3 toques</b>. Un jugador no puede tocar dos veces seguidas: eso son <b>dobles</b>.' },
    { step: 'Paso 4 de 6', title: '3.er toque · Remate', fig: {
        players: [{ t: 0, x: 1.3, y: -2.4, you: 1, lbl: '3' }, { t: 0, x: 1.8, y: 1.2 }, { t: 1, x: -5.5, y: -2 }, { t: 1, x: -5.5, y: 2 }],
        segs: [{ a: [1.8, 1.2, 2.3], b: [1.05, -2.4, 3.15], apex: 5.3, dur: 1.15 }, { a: [1.05, -2.4, 3.15], b: [-6.2, 2.8, 0.2], dur: 0.38, who: 0, spike: 1 }],
        ring: [1.3, -2.4], jump: [[0, 0.62, 1.05]], swing: [[0, 1.05, 0.25]] },
      text: function (g) { return 'En el 3.er toque ponte bajo la colocación, pulsa ' + g.jump + ' para <b>saltar</b> y ' + g.hit + ' en lo alto: <b>remate</b>. Sin dirección va en diagonal; con ' + g.aim + ' eliges la zona: arriba, al fondo; abajo, corta; izquierda o derecha, hacia esa línea.'; },
      rule: 'En el aire, ' + '<b>Saltar</b> otra vez hace una <b>dejada</b>. Si golpeas el 3.er toque sin saltar, el balón pasa en globo (<b>balón libre</b>).' },
    { step: 'Paso 5 de 6', title: 'El bloqueo', fig: {
        players: [{ t: 0, x: 0.6, y: 1.4, you: 1, lbl: 'TÚ' }, { t: 0, x: 6, y: -1.5 }, { t: 1, x: -1.3, y: 1.4 }, { t: 1, x: -2, y: -2.5 }],
        segs: [{ a: [-2, -2.5, 2.3], b: [-1.05, 1.4, 3.15], apex: 5.1, dur: 1.1 }, { a: [-1.05, 1.4, 3.15], b: [-0.05, 1.4, 2.95], dur: 0.16, who: 2, spike: 1 }, { a: [-0.05, 1.4, 2.95], b: [-4.6, 0.3, 0.2], apex: 3.4, dur: 0.85, who: 0 }],
        jump: [[2, 0.6, 1.05], [0, 0.66, 1.1]], swing: [[2, 1.1, 0.25]], block: [0] },
      text: function (g) { return 'Cuando la CPU coloca, el juego te pasa al defensor y tu compañero bloquea. Si prefieres bloquear tú, pulsa ' + g.sw + ' (cambiar) mientras la CPU coloca: ve a la red frente al atacante y pulsa ' + g.jump + ' cuando golpea. Si el balón te da en las manos: <b>bloqueo</b>.'; },
      rule: 'El <b>bloqueo no cuenta como toque</b>: después tu equipo aún tiene sus 3 toques.' },
    { step: 'Paso 6 de 6', title: 'Reglas y faltas', faults: true,
      text: function () { return ''; }, rule: '' }
  ];
  var FAULTS = '<ul class="faults">' +
    '<li><b>Fuera</b>El balón cae fuera de las líneas: punto para el rival de quien lo tocó por última vez.</li>' +
    '<li><b>Antena</b>El balón toca la antena o cruza por fuera de ella.</li>' +
    '<li><b>Red</b>Tocar la red entre las antenas mientras se juega el balón es falta. Si el balón la toca y pasa, el juego sigue.</li>' +
    '<li><b>4 toques</b>Un equipo toca el balón más de 3 veces (el bloqueo no cuenta).</li>' +
    '<li><b>Dobles</b>El mismo jugador toca el balón dos veces seguidas.</li>' +
    '<li><b>Cuerpo</b>Si el balón te da en el cuerpo, cuenta como toque.</li>' +
    '<li><b>Falta de saque: 8 segundos</b>Tras el silbato del árbitro tienes 8 segundos para sacar.</li>' +
    '<li><b>Ataque sobre el saque</b>No se puede rematar ni bloquear el saque rival por encima de la red.</li>' +
    '<li><b>Cambio de campo</b>Al acabar cada set y a los 8 puntos del set decisivo.</li>' +
    '<li><b>Sets</b>A 25 puntos con 2 de diferencia; el 3.º, a 15. Gana quien se lleva 2 sets.</li>' +
    '</ul><p class="tut-rule">Cada jugada da un punto (sistema de punto por jugada). Si la ganas recibiendo, recuperas el saque (<b>cambio de saque</b>) y sacáis por turnos: saca el jugador de tu equipo que no sacó la última vez (y lo controlas tú).</p>';

  var tut = { i: 0, raf: 0, t0: 0, fig: null, seen: {} };
  function tutGo(i) {
    i = Math.max(0, Math.min(TUT.length - 1, i));
    tut.i = i; tut.seen[i] = 1;
    var S = TUT[i], g = G();
    el.tutStep.textContent = S.step; el.tutTitle.textContent = S.title;
    el.tutText.innerHTML = S.faults ? FAULTS : '<p class="tut-text">' + S.text(g) + '</p>' + (S.rule ? '<div class="tut-rule">' + S.rule + '</div>' : '');
    restartAnim(el.tutBody, 'tut-anim');
    el.tutFig.hidden = !!S.faults;
    el.tutBody.style.gridTemplateColumns = S.faults ? '1fr' : '';
    var dots = ''; for (var k = 0; k < TUT.length; k++) dots += '<i class="' + (k === i ? 'on' : tut.seen[k] ? 'seen' : '') + '"></i>';
    el.tutDots.innerHTML = dots;
    el.btnTutPrev.disabled = i === 0; el.btnTutPrev.style.visibility = i === 0 ? 'hidden' : '';
    el.btnTutNext.textContent = i === TUT.length - 1 ? (panelFrom === 'menu' ? '¡A jugar!' : 'Volver al partido') : 'Siguiente ›';
    if (!el.panel.hidden) { fitSheet(el.panel); checkMore(el.panel); }
    tutStop();
    if (!S.faults) buildFig(S.fig);
    if (i === TUT.length - 1 && !ctx.debug) { record.tut = 1; saveRecord(); }
  }
  function buildFig(F) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 400 275'); svg.setAttribute('aria-hidden', 'true');
    drawCourt(svg);
    var ring = null;
    if (F.ring) { var rp = P(F.ring[0], F.ring[1], 0); ring = svgEl('ellipse', { cx: rp[0], cy: rp[1], rx: 15 * rp[2], ry: 5.5 * rp[2], fill: 'rgba(255,190,20,.28)', stroke: '#f2a900', 'stroke-width': 2.6 }, svg); }
    // jugadores ordenados por profundidad (los del fondo primero)
    var order = F.players.map(function (p, i) { return i; }).sort(function (a, b) { return F.players[a].x - F.players[b].x; });
    var far = [], near = [], figs = [];
    order.forEach(function (i) { (F.players[i].x < 0 ? far : near).push(i); });
    far.forEach(function (i) { figs[i] = drawPlayer(svg, F.players[i]); });
    // trayectoria punteada completa
    var path = '', tmp = [0, 0, 0];
    F.segs.forEach(function (sg) { for (var k = 0; k <= 24; k++) { segPos(sg, k / 24, tmp); var p = P(tmp[0], tmp[1], tmp[2]); path += (path ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); } });
    var ballShadow = svgEl('ellipse', { rx: 4, ry: 1.6, fill: 'rgba(0,0,0,.45)' }, svg);
    drawNet(svg);
    near.forEach(function (i) { figs[i] = drawPlayer(svg, F.players[i]); });
    svgEl('path', { d: path, fill: 'none', stroke: 'rgba(13,26,46,.35)', 'stroke-width': 2.6, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, svg);
    svgEl('path', { d: path, fill: 'none', stroke: 'rgba(255,255,255,.85)', 'stroke-width': 1.3, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, svg);
    var flash = svgEl('circle', { r: 10, fill: 'none', stroke: '#fff', 'stroke-width': 2, opacity: 0 }, svg);
    var ball = svgEl('g', {}, svg);
    svgEl('circle', { r: 5.2, fill: '#f7f2ea', stroke: '#1d3d7a', 'stroke-width': 1 }, ball);
    svgEl('path', { d: 'M-5 0 Q0 -3 5 0 M-2 -4.6 Q1 0 -2 4.6', fill: 'none', stroke: '#ffb238', 'stroke-width': 1.3 }, ball);
    el.tutFig.innerHTML = ''; el.tutFig.appendChild(svg);
    var total = 0; F.segs.forEach(function (s) { s.t0 = total; total += s.dur; });
    tut.fig = { F: F, figs: figs, ball: ball, ballShadow: ballShadow, flash: flash, ring: ring, total: total, loop: total + 1.1 };
    tut.t0 = performance.now();
    var tick = function (now) { tut.raf = requestAnimationFrame(tick); animFig((now - tut.t0) / 1000); };
    tut.raf = requestAnimationFrame(tick);
    animFig(0);
  }
  var _bp = [0, 0, 0];
  function animFig(time) {
    var f = tut.fig; if (!f) return;
    var F = f.F, t = time % f.loop, segs = F.segs, sg = segs[segs.length - 1], u = 1;
    for (var i = 0; i < segs.length; i++) if (t < segs[i].t0 + segs[i].dur) { sg = segs[i]; u = Math.max(0, (t - sg.t0) / sg.dur); break; }
    segPos(sg, u, _bp);
    var p = P(_bp[0], _bp[1], _bp[2]), q = P(_bp[0], _bp[1], 0), s = p[2] * 1.1;
    f.ball.setAttribute('transform', 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ') scale(' + s.toFixed(2) + ') rotate(' + ((time * 400) % 360).toFixed(0) + ')');
    f.ballShadow.setAttribute('cx', q[0].toFixed(1)); f.ballShadow.setAttribute('cy', q[1].toFixed(1));
    f.ball.style.opacity = t > f.total + 0.7 ? 0 : 1;
    // destello del golpe al empezar cada tramo con autor
    var fl = 0, fp = null;
    for (var k = 0; k < segs.length; k++) { var dtk = t - segs[k].t0; if (segs[k].who != null && dtk >= 0 && dtk < 0.3) { fl = 1 - dtk / 0.3; fp = P(segs[k].a[0], segs[k].a[1], segs[k].a[2]); } }
    if (fp) { f.flash.setAttribute('cx', fp[0]); f.flash.setAttribute('cy', fp[1]); f.flash.setAttribute('r', (8 + (1 - fl) * 14).toFixed(1)); }
    f.flash.setAttribute('opacity', fl.toFixed(2));
    if (f.ring) f.ring.setAttribute('opacity', (0.65 + 0.35 * Math.sin(time * 6)).toFixed(2));
    // saltos y brazos
    for (var j = 0; j < f.figs.length; j++) {
      var fg = f.figs[j]; if (!fg) continue;
      var z = 0;
      (F.jump || []).forEach(function (J) { if (J[0] === j && t >= J[1] && t <= J[2]) { var w = (t - J[1]) / (J[2] - J[1]); z = Math.sin(w * Math.PI) * 0.9; } });
      var arm = 0;
      (F.swing || []).forEach(function (S) { if (S[0] === j && t >= S[1] - 0.15 && t <= S[1] + S[2]) arm = 1; });
      if ((F.block || []).indexOf(j) >= 0 && z > 0.1) arm = 2;
      var bp = P(fg.pl.x, fg.pl.y, z);
      fg.body.setAttribute('transform', 'translate(' + bp[0].toFixed(1) + ',' + bp[1].toFixed(1) + ') scale(' + fg.s.toFixed(3) + ')');
      fg.shadow.setAttribute('rx', (9 * fg.s * (1 - z * 0.35)).toFixed(1));
      fg.arms.setAttribute('transform', arm === 2 ? 'translate(0,-12) scale(1,-1.15) translate(0,48)' : arm === 1 ? 'rotate(' + (fg.pl.t === 0 ? -160 : 160) + ' 7 -29)' : '');
    }
  }
  function tutStop() { if (tut.raf) cancelAnimationFrame(tut.raf); tut.raf = 0; tut.fig = null; }
  function tutNext() {
    if (tut.i < TUT.length - 1) { tutGo(tut.i + 1); click(); return; }
    var from = panelFrom; uiSound(from === 'menu' ? 'start' : 'back'); closePanel();
    if (from === 'menu') goMatch();
  }

  // =====================================================================
  //  ENTRADA DE MENÚS
  // =====================================================================
  function adjustFocused(d) {
    var a = document.activeElement;
    if (panel === 'ctl') { ctlStep(d > 0 ? 1 : -1); return true; }
    if (panel === 'tut' && (!a || !a.getAttribute || !a.getAttribute('data-opt'))) { if (d > 0) { if (tut.i < TUT.length - 1) tutGo(tut.i + 1); } else tutGo(tut.i - 1); click(); return true; }
    if (a && a.getAttribute && a.getAttribute('data-opt') && !a.closest('[hidden]')) { changeOpt(a.getAttribute('data-opt'), d); return true; }
    return false;
  }
  function onKey(e) {
    ctx.lastKeyT = ctx.time;
    if (ctx.introLeft > 0 && ctx.state === 'playing') { if (!e.repeat) ctx.introSkipReq = true; return; }   // UI-14: cualquier tecla salta la tarjeta
    if (ctx.state === 'playing' && !panel) return;
    var k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || ((k === 'Tab') && activeLayer())) {
      e.preventDefault(); navMove(k === 'ArrowUp' || (k === 'Tab' && e.shiftKey) ? -1 : 1); return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { if (adjustFocused(k === 'ArrowRight' ? 1 : -1)) e.preventDefault(); return; }
    if (k === 'Enter') {
      var a = document.activeElement;
      if (a && a.tagName === 'BUTTON' && !a.closest('[hidden]')) { e.preventDefault(); a.click(); return; }
      if (ctx.state === 'menu' && !panel) play();
      else if (ctx.state === 'paused' && !panel) ctx.actions.resume();
      else if (ctx.state === 'over' && endWait) endSkip();
      else if (ctx.state === 'over' && endPeek) setPeek(false);
      else if (ctx.state === 'over' && ctx.game && ctx.game.finished && !el.end.hidden) goMatch();
    }
  }
  var navRep = { y: 0, x: 0, ty: 0, tx: 0 };
  function axisRepeat(v, key, tkey, dt) {
    var dir = v > 0.55 ? 1 : v < -0.55 ? -1 : 0;
    if (dir !== navRep[key]) { navRep[key] = dir; navRep[tkey] = 0.38; return dir; }
    if (!dir) return 0;
    navRep[tkey] -= dt; if (navRep[tkey] <= 0) { navRep[tkey] = 0.14; return dir; }
    return 0;
  }

  // =====================================================================
  //  API
  // =====================================================================
  VB.UI = {
    banner: banner,
    callout: callout,
    bootReady: bootReady,
    preboot: preboot,
    bootBusy: function () { return bootBusy(); },
    _boot: function () { return { stage: bootStage, ready: Math.round(bootT0), fly: Math.round(bootFly - 760), gymEnd: Math.round(gym.t1 || 0), fonts: fontsReady }; },
    /** Rectángulo (px CSS) del banner visible o null (UI-04; para el encuadre del plano del punto, CAM-18). */
    bannerRect: bannerRect,
    /** main.js: el jugador recorta la pausa del punto (SIM-03, quedan 0,3 s): lo del punto se funde ya (120 ms). */
    onHoldSkip: function () {
      if (banT > 0 && (banKind === 'point' || banKind === 'set' || banKind === 'court')) fadeBanner(0.12);
      if (bugT > 0) hideBug(true);
      if (pres && pres.kind === 'point') pres = null;
    },
    /** Pruebas: estado del precalentado de estilos {i, f, done, t0, t1}. */
    _gym: function () { return gym; },
    /** Pruebas (UI-09): estado del sello {t, x, y (px del centro sin la subida), ox, oy, dir, cost}. */
    _stamp: function () { return stp; },
    /** UI-14 (main.js): empieza / acaba la tarjeta de presentación. */
    introStart: function (g) { introStart(g); },
    introEnd: function (skipped) { introEndUI(skipped); },
    /** Pruebas (UI-11): estadística por jugador del partido (id → {num, team, pts, kills, blocks, aces}) y estado de la hoja. */
    _endStats: function () { return { p: stats.p, gate: endGate, wait: endWait, peek: endPeek, dock: ctx.uiDock || null }; },
    /** Pruebas (UI-13): estado de la cortinilla {ph 0 parada|1 entra|2 tapa|3 sale, cut}; _wipeLog(true) empieza a registrar. */
    _wipe: function () { return wp; },
    _wipeLog: function (on) { wp.log = on ? [] : null; return wp.log; },
    /** Cortinilla de pantalla (450 ms) con la acción a mitad; false si ya hay una en marcha. */
    wipe: function (team, cb) { return wipeRun(team == null ? 2 : team, cb); },
    /** Pruebas (UI-10): indicador de borde {on, x, y, ang (rad, centro → jugador)}. */
    _offArrow: function () { return offA; },
    /** Pruebas (UI-20): última caja del aviso anclado {x, y, w, h} (px CSS), solo la tecla (konly) y zonas de los botones táctiles. */
    _prompt: function () { return { x: prLast.x, y: prLast.y, w: prLast.w, h: prLast.h, konly: prKonly, side: prSide, tb: tbx.L.slice() }; },
    isPanelOpen: function () { return !!panel; },
    /** Mando conectado / desconectado (main.js con Input.poll().padEvent). Al desconectarse jugando con él, input.js pausa:
     *  la hoja de pausa lo dice ("Mando desconectado") en el antetítulo, en vez del set y el tanteo. */
    padEvent: function (kind) {
      if (kind === 'disconnected') { padGone = true; if (el.pKick) el.pKick.textContent = 'Mando desconectado'; }
      else if (kind === 'connected') {
        padGone = false; padFamF = -999; GLYPH_PS = null;
        if (ctx.game && el.pKick) el.pKick.textContent = pauseKicker(ctx.game);
        if (ctx.state === 'playing') callout('Mando conectado', 0, 'good');
      }
    },
    init: function (c) {
      ctx = c; loadRecord();
      cacheEls(); if (ctx.isTouch) el.app.classList.add('is-touch');
      if (ctx.debug) el.menu.classList.remove('intro'); // en depuración no hay relevo desde el telón

      function on(b, fn) { b.addEventListener('click', function (ev) { click(); fn(ev); }); }
      el.btnPlay.addEventListener('click', play);
      el.btnFirstTut.addEventListener('click', function () { click(); openPanel('tut', 'menu'); });
      el.btnFirstPlay.addEventListener('click', function () { uiSound('start'); goMatch(); });
      // Dificultad: ‹ baja y › sube (zonas propias, UI-06); un clic en el resto de la fila sigue avanzando en ciclo
      el.optDiff.addEventListener('click', function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('[data-d]') : null;
        if (a) { var d = +a.getAttribute('data-d'); stepDiff(d); restartAnim(a, 'hit'); }
        else changeOpt('difficulty', 1);
      });
      var arrs = el.optDiff.querySelectorAll('.arr');
      for (var ai = 0; ai < arrs.length; ai++) arrs[ai].addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') uiSound2('arrowHover', +this.getAttribute('data-d') || 1); });
      on(el.btnTut, function () { openPanel('tut', 'menu'); });
      on(el.btnControls, function () { openPanel('ctl', 'menu'); });
      on(el.btnSettings, function () { openPanel('set', 'menu'); });
      on(el.btnResume, function () { ctx.actions.resume(); });
      on(el.btnPControls, function () { openPanel('ctl', 'paused'); });
      on(el.btnPSettings, function () { openPanel('set', 'paused'); });
      // Reiniciar en dos pasos (un dedo que se escapa no tira el partido): 1.er toque arma 2 s, el 2.º reinicia. Sin confirm().
      on(el.btnRestart, function () {
        if (restartArm > 0 && performance.now() - restartArm < 2000) { disarmRestart(); goMatch(); return; }
        restartArm = performance.now();
        el.btnRestart.textContent = device() === 'touch' ? 'Toca otra vez para reiniciar' : 'Pulsa otra vez para reiniciar';
        el.btnRestart.classList.add('arm');
        clearTimeout(restartTo); restartTo = setTimeout(disarmRestart, 2000);
      });
      on(el.btnQuit, function () { goMenu(); });
      el.btnAgain.addEventListener('click', function () { uiSound('start'); goMatch(); });
      el.btnMenu.addEventListener('click', function () { uiSound('back'); goMenu(); });
      el.btnAgainAlt.addEventListener('click', function () {
        var d = el.btnAgainAlt.getAttribute('data-d'); uiSound('start');
        goMatch(d || null);
      });
      // tocar/clic durante la tarjeta de presentación la salta (UI-14; main.js la quita en el frame siguiente)
      window.addEventListener('pointerdown', function () { if (ctx.introLeft > 0 && ctx.state === 'playing') ctx.introSkipReq = true; }, { passive: true, capture: true });
      // tocar/clic durante la celebración final la salta
      window.addEventListener('pointerdown', function () { if (endWait) endSkip(); }, { passive: true });
      el.btnPeek.addEventListener('click', function () { click(); setPeek(true); });
      el.btnEndBack.addEventListener('click', function () { click(); setPeek(false); });
      el.btnPanelBack.addEventListener('click', function () { uiSound('back'); closePanel(); });
      // sonido suave al pasar por encima de un botón de menú (solo ratón)
      var hb = document.querySelectorAll('.screen button');
      for (var h = 0; h < hb.length; h++) hb[h].addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') { if (this.classList.contains('opt')) uiSound2('optHover'); else hoverSound(); } });
      var ctabs = el.pnCtl.querySelectorAll('.ctl-tab');
      for (var ct = 0; ct < ctabs.length; ct++) (function (b) { b.addEventListener('click', function () { click(); ctlView = b.getAttribute('data-ctl'); renderCtl(); }); })(ctabs[ct]);
      el.btnTutPrev.addEventListener('click', function () { click(); tutGo(tut.i - 1); });
      el.btnTutNext.addEventListener('click', tutNext);
      on(el.btnHudPause, function () { ctx.actions.pause(); });
      on(el.btnHudMute, function () { ctx.actions.toggleMute(); });
      // opciones: clic en un valor concreto o en la fila (siguiente valor)
      var opts = document.querySelectorAll('#optList .opt');
      for (var i = 0; i < opts.length; i++) (function (b) {
        b.addEventListener('click', function (ev) {
          var k = b.getAttribute('data-opt'), sp = ev.target && ev.target.closest ? ev.target.closest('[data-i]') : null;
          if (SLIDERS[k] && ev.target.closest && ev.target.closest('.trk')) {
            var r = ev.target.closest('.trk').getBoundingClientRect(), f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), c = SLIDERS[k];
            ctx.actions.setSetting(k, Math.round((c.min + f * (c.max - c.min)) * 10) / 10);
            if (k === 'sfxVol' && ctx.settings.muted) ctx.actions.setSetting('muted', false);
            click(); return;
          }
          // fila de Sonido: el altavoz (o la fila entera, con Intro) es el silencio general; ←/→ y la pista, el volumen
          if (b.classList.contains('opt-snd')) { ctx.actions.toggleMute(); click(); return; }
          if (sp && OPT[k]) changeOpt(k, 0, +sp.getAttribute('data-i')); else changeOpt(k, 1, SLIDERS[k] ? 'wrap' : null);
        });
      })(opts[i]);
      window.addEventListener('keydown', onKey);
      [el.pause, el.end, el.panel].forEach(function (n) { var sh = n.querySelector('.sheet'); if (sh) sh.addEventListener('scroll', function () { checkMore(n); }, { passive: true }); });
      window.addEventListener('pointerdown', function () { var p = document.querySelectorAll('.kf'); for (var i = 0; i < p.length; i++) p[i].classList.remove('kf'); }, { passive: true });
      document.addEventListener('focusout', function (e) { if (e.target && e.target.classList) e.target.classList.remove('kf'); });
      window.addEventListener('gamepadconnected', function () { last.navh = null; last.ctls = null; padFamF = -999; GLYPH_PS = null; if (ctx.state === 'menu') renderMenu(); if (panel === 'ctl') { ctlView = 'gamepad'; renderCtl(); } });
      this.onSettings(ctx.settings);
      var pn = ctx.params.panel || (ctx.debug === 'tutorial' ? 'tut' : ctx.debug === 'controls' ? 'ctl' : ctx.debug === 'settings' ? 'set' : '');
      if (pn && PANELS[pn]) setTimeout(function () { openPanel(pn, 'menu'); if (ctx.params.step) tutGo(+ctx.params.step - 1); }, 0);
    },
    onSettings: function (s) {
      el.btnHudMute.classList.toggle('muted', !!s.muted);
      el.icoSound.innerHTML = s.muted ? '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="#f7f2ea" stroke-width="2" stroke-linecap="round"/>'
        : '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="#f7f2ea" stroke-width="2" stroke-linecap="round"/>';
      // UI-16: tamaño del HUD (variable --hs en #app: marcador, contador, avisos, botones y hojas) y destellos suaves
      var hs = [1, 1.15, 1.3].indexOf(+s.hudScale) >= 0 ? +s.hudScale : 1;
      if (hudScale !== hs) { hudScale = hs; el.app.style.setProperty('--hs', String(hs)); el.app.classList.toggle('hs-big', hs > 1); promptW = 0; tbRect = coachRect = guideRect = null; joyR = null; }
      el.app.classList.toggle('soft-flash', !!s.softFlash);
      hudFit();
      renderOpts();
      [el.pause, el.end, el.panel].forEach(function (n) { if (n && !n.hidden) { fitSheet(n); checkMore(n); } });
    },
    setQuality: function () { if (panel === 'set') renderOpts(); vigTick(); },
    resize: function () { offA.obsF = -999; tbx.ok = false; tbx.f = -9999; hudFit(); [el.pause, el.end, el.panel].forEach(function (n) { if (n && !n.hidden) { fitSheet(n); checkMore(n); } }); tbRect = coachRect = guideRect = null; joyR = null; promptW = 0; },
    onState: function (s, prev) {
      shown = '';
      // UI-04: la pausa aparta banner, pestaña y aviso corto; al volver solo reaparecen si les quedaban > 0,4 s
      if (s === 'paused' && prev === 'playing') {
        held = { ban: banT, bug: bugT, call: calloutT };
        el.banner.classList.add('held'); el.pbug.classList.add('held'); el.callout.classList.add('held');
      } else if (prev === 'paused' && held) {
        el.banner.classList.remove('held'); el.pbug.classList.remove('held'); el.callout.classList.remove('held');
        if (held.ban > 0 && banT > 0 && banT <= 0.4) hideBanner();
        if (held.bug > 0 && bugT > 0 && bugT <= 0.4) { bugT = 0; el.pbug.className = ''; }
        if (held.call > 0 && calloutT > 0 && calloutT <= 0.4) { calloutT = 0; el.callout.className = ''; }
        held = null;
      }
      if (s !== 'paused') padGone = false;
      if (s === 'playing') {
        if (prev !== 'paused') hideBanner();
        if (panel) { panel = null; tutStop(); }
        var a = document.activeElement; if (a && a.blur && a.tagName === 'BUTTON') a.blur(); // que el Espacio no pulse un botón oculto
      }
      if (s === 'menu') { panel = null; tutStop(); }
    },
    onGameStart: function (g) {
      last = {}; banT = 0; hideBanner(); promptCur = ''; promptHold = 0; // las estadísticas se reinician con 'newMatch'
      pres = null; pendCourt = null; courtNext = null; newSetShown = 0; lastSub = ''; lastBig = null; bigGap = 9; atSP = false; lastBn2 = ''; bugT = 0; el.pbug.className = ''; held = null;
      coachSeen = {}; guideDone = {}; guideT = 0; el.guide.className = '';
      rallyHide();
      tbLabel1 = label1Of(g); // escenas de depuración que empiezan a mitad de jugada (p. ej. dive): no fiarse del valor por defecto
      ctx.endHold = false; el.skip.hidden = true; endGate = false; endWait = 0; endPeek = false; matchPtT = -99; el.end.classList.remove('peek', 'dock'); ctx.uiDock = null; dockKey = '';
      if (introUI.on && !(ctx.introLeft > 0)) introEndUI(true);
      if (!(ctx.introLeft > 0)) { el.app.classList.remove('intro-on'); introUI.hudT = 0; introUI.quiet = false; }
      el.end.classList.remove('win', 'lose');
    },
    /** Estadísticas sin banners (escenas de depuración que avanzan la sim sin pintar). */
    ingest: function (events, g) { for (var i = 0; i < events.length; i++) { if (events[i].type === 'newMatch') stats = newStats(); else tally(events[i]); } },
    /** Cierra el panel abierto. true si se ha consumido (Esc / B / Start). */
    back: function () {
      if (panel) { uiSound('back'); return closePanel(); }
      return false;
    },
    /** Navegación con mando fuera del partido (main.js la llama con las intenciones del frame). */
    nav: function (it, dt) {
      if (bootStage === 0 && bootBusy()) return;               // telón entero: el menú aún no se ve
      if (endWait) { if (it && (it.hit || it.jump || it.confirm || it.switchPlayer)) endSkip(); return; }
      if (endPeek && it && (it.hit || it.jump || it.confirm)) { setPeek(false); return; }
      if (!it || it.device !== 'gamepad') { navRep.y = navRep.x = 0; return; }
      if (!activeLayer()) return;
      var dy = axisRepeat(it.my || 0, 'y', 'ty', dt), dx = axisRepeat(it.mx || 0, 'x', 'tx', dt);
      if (dy) navMove(-dy);
      if (dx) adjustFocused(dx);
      if (it.hit) { var a = document.activeElement; if (a && a.tagName === 'BUTTON' && !a.closest('[hidden]')) a.click(); else focusLayer(); }
      if (it.jump) { if (!this.back() && ctx.state === 'paused') ctx.actions.resume(); }
      if (ctx.state === 'menu' && last.navDev !== 'gamepad') { last.navDev = 'gamepad'; last.navh = null; renderMenu(); }
    },
    /** dt = tiempo de juego (0 en pausa/congelado: los banners se quedan). */
    update: function (g, dt, events) {
      if (!g) return;
      onEvents(g, events);
      syncScreens(g);
      if (!gym.done) gymTick();
      if (bootStage < 2) tryReveal();
      if (ctx.state !== 'menu') hud(g, dt);
      if (ctx.state === 'playing' || ctx.state === 'over') presUpdate(g, dt);
      // en pausa no se ve ningún banner, pestaña ni aviso corto (tampoco los que llegan con la pausa ya puesta: escenas de depuración)
      else if (ctx.state === 'paused' && held) {
        if (!el.banner.classList.contains('held')) el.banner.classList.add('held');
        if (!el.pbug.classList.contains('held')) el.pbug.classList.add('held');
        if (!el.callout.classList.contains('held')) el.callout.classList.add('held');
      }
      if (banT > 0) {
        banT -= dt;
        if (banT <= 0.3 && !banOut) { banOut = true; el.banner.classList.add('out'); }
        if (banT <= 0) hideBanner();
      }
      if (bugT > 0) {
        bugT -= dt;
        if (bugT <= 0.25 && !bugOut) { bugOut = true; el.pbug.classList.add('out'); }
        if (bugT <= 0) el.pbug.className = '';
      }
      if (calloutT > 0) { calloutT -= Math.max(dt, 0); if (calloutT <= 0) el.callout.className = ''; }
      var rdt = ctx.realDt || 0;
      stampTick(rdt);
      introTick(rdt);
      wipeTickRun(rdt);
      if (wp.ph && wp.cut && ctx.state !== 'playing' && ctx.state !== 'over') wipeOff();   // pausa a mitad de cortinilla
      if (guideT > 0) { guideT -= rdt; if (guideT <= 0.3 && el.guide.className === 'show') el.guide.className = 'out'; if (guideT <= 0) el.guide.className = ''; }
      endHoldTick();
      if ((ctx.frame & 7) === 3) dockTick();
      // la hoja puede cambiar de alto tras abrirse (fuentes, cifras, celebración que se aparta): el desvanecido se revisa a menudo
      if ((ctx.frame & 15) === 5) { if (!el.panel.hidden) checkMore(el.panel); if (!el.end.hidden) checkMore(el.end); if (!el.pause.hidden) checkMore(el.pause); }
      if (ctx.state === 'menu' && (ctx.frame & 63) === 0) renderMenu();
      if ((ctx.frame & 7) === 0) sbDimTick(g);
      if ((ctx.frame & 31) === 1) vigTick();
      if ((ctx.frame & 31) === 0 && !el.app.classList.contains('is-touch') && VB.Input && VB.Input.isTouchActive && safe(VB.Input.isTouchActive)) el.app.classList.add('is-touch');
    }
  };
})();
