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
  var record = { played: 0, wins: 0, bestStreak: 0, winRun: 0, tut: 0 };
  var BAN = { point: 1.6, set: 2.6, match: 3.2, info: 1.5, ace: 1.8, sp: 1.5 };

  // ---------- Estadísticas del partido ----------
  function newStats() {
    // Desglose de puntos como el acta/estadística FIVB: ataque + bloqueo + saque + errores del rival = puntos.
    // kills = puntos de ataque (remate, dejada, balón libre que cae), blocks = puntos de bloqueo,
    // aces = puntos de saque, oppErr = puntos regalados por el rival (fuera, red, dobles, 4 toques, falta de saque...).
    function t() { return { points: 0, aces: 0, kills: 0, blocks: 0, oppErr: 0, best: 0 }; }
    return { t: [t(), t()], run: 0, runTeam: -1, longest: 0, lastHitKind: '', lastHitTeam: -1, blockTeam: -1 };
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
  function G() { return GLYPH[device()] || GLYPH.keyboard; }

  // =====================================================================
  //  BANNERS Y AVISOS
  // =====================================================================
  /** Banner central. cls: 'win'|'lose'|'gold'|'ace'|'neutral' */
  function banner(t1, t2, t3, cls, dur) {
    el.bn1.textContent = t1 || ''; el.bn2.textContent = t2 || '';
    el.bn2.hidden = !t2; el.bn3.hidden = !t3; el.bn3.textContent = t3 || '';
    el.banner.className = '';
    void el.banner.offsetWidth; // reinicia las animaciones CSS
    el.banner.className = 'show ' + (cls || 'win') + ((t1 || '').length > 15 ? ' long' : '');
    banT = dur || BAN.info; banOut = false;
  }
  function hideBanner() { el.banner.className = ''; banT = 0; }
  /** Aviso corto bajo el contador de toques. cls opcional: 'tip' = consejo (más pequeño, dura más). */
  function callout(text, team, cls, dur) {
    el.callout.textContent = text;
    el.callout.className = '';
    void el.callout.offsetWidth;
    el.callout.className = 'show c' + (team === 1 ? 1 : 0) + (cls ? ' ' + cls : '');
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
        s.lastHitKind = e.kind; s.lastHitTeam = e.team; s.blockTeam = -1; break;
      case 'block':
        s.blockTeam = e.team; break;
      case 'point': {
        var w = e.team, T = s.t[w];
        T.points++;
        if (s.runTeam === w) s.run++; else { s.run = 1; s.runTeam = w; }
        if (s.run > T.best) T.best = s.run;
        if ((e.rallyHits || 0) > s.longest) s.longest = e.rallyHits || 0;
        var kind = 'point', srv = e.lastKind === 'serve' || (e.lastKind == null && (e.rallyHits | 0) === 0);
        if (e.how) { // sim >= v2: 'ace' | 'kill' | 'tip' | 'block' | 'error' | 'free'
          if (e.how === 'ace') kind = 'ace';
          else if (e.how === 'kill' || e.how === 'tip' || e.how === 'free') kind = e.how;
          else if (e.how === 'block') kind = 'blockPt';
          else kind = (srv || e.reason === 'serve') ? 'srvErr' : 'error';
        }
        else if (e.reason === 'in' && !e.sideout && (e.rallyHits | 0) === 0) kind = 'ace';
        else if ((e.rallyHits | 0) === 0 && e.reason !== 'in') kind = 'srvErr';
        else if (e.reason === 'in' && s.blockTeam === w) kind = 'blockPt';
        else if (e.reason === 'in') kind = s.lastHitKind === 'spike' && s.lastHitTeam === w ? 'kill' : 'free';
        else kind = 'error';
        // cada punto cae en exactamente una fila: las filas suman "Puntos"
        if (kind === 'ace') T.aces++;
        else if (kind === 'blockPt') T.blocks++;
        else if (kind === 'kill' || kind === 'tip' || kind === 'free') T.kills++;
        else T.oppErr++;
        e._uiKind = kind; // solo para la UI (no forma parte del contrato)
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
          banner('Set 1', 'Al mejor de 3 sets · ' + (g.serving === 0 ? 'Sacas tú' : 'Saca la CPU'), '', 'neutral', BAN.info);
          break;
        case 'point': {
          var me = e.team === 0, k = e._uiKind;
          flashRow(e.team);
          if (e.matchWon || e.setWon) break; // lo anuncian 'set' / 'match'
          var t1, cls = me ? 'win' : 'lose', dur = BAN.point;
          // mismo estilo siempre: "… de la CPU" (antes convivían "Remate CPU" y "Ace de la CPU")
          if (k === 'ace') { t1 = me ? '¡Ace!' : 'Ace de la CPU'; cls = me ? 'ace' : 'lose'; dur = BAN.ace; }
          else if (k === 'kill') t1 = me ? '¡Remate!' : 'Remate de la CPU';
          else if (k === 'tip') t1 = me ? '¡Dejada!' : 'Dejada de la CPU';
          else if (k === 'error') t1 = me ? 'Error de la CPU' : 'Punto de la CPU';
          else if (k === 'blockPt') t1 = me ? '¡Punto de bloqueo!' : 'Bloqueo de la CPU';
          else if (k === 'srvErr') t1 = me ? 'Falta de saque de la CPU' : 'Falta de saque';
          else t1 = me ? '¡Punto!' : 'Punto de la CPU';
          var why = e.text || '';
          // "Fuera" como lo cantaría el árbitro, con el toque que lo manda fuera (quién pierde ya lo dice el título)
          if (e.reason === 'out' && k !== 'srvErr') why = stats.blockTeam >= 0 && stats.blockTeam !== e.team ? 'Toca el bloqueo y sale fuera' : (e.lastShot === 'tip' ? 'Dejada fuera' : (OUTK[e.lastKind] || 'Fuera'));
          // ace con roce de recepción (sim lo acredita al saque): "Balón a la red" bajo "¡ACE!" confundía
          if (k === 'ace') why = (e.rallyHits | 0) > 0 ? (me ? 'La CPU no controla la recepción' : 'No controlas la recepción') : (me ? 'Saque directo: nadie lo toca' : 'Nadie toca el saque de la CPU');
          if (k === 'blockPt' && /cae en el campo/i.test(why)) why = 'Bloqueo directo al suelo';
          // el título ya dice "Falta de saque": el subtítulo da solo el motivo
          if (k === 'srvErr') why = why.replace(/^(falta|error) de saque( de la cpu| cpu)?\s*[:·-]\s*/i, '').replace(/^./, function (c) { return c.toUpperCase(); });
          banner(t1, why, e.sideout ? 'CAMBIO DE SAQUE' : '', cls, dur);
          break;
        }
        case 'block':
          callout(e.result === 'soft' || e.result === 'tool' || e.result === 'touch' ? 'Toque de bloqueo' : '¡Bloqueo!', e.team);
          break;
        case 'hit':
          if (e.team === 0) { clearPrompt(); if (guideT > 0) guideHide(); } // el aviso del que acaba de golpear no pasa al compañero
          if (!e.human) break;
          if (e.shot === 'body') { // sin gesto: el balón le da en el cuerpo (cuenta como toque)
            callout('¡Te ha dado!', 1);
            if (ctx.settings.showHelp !== false) bodyTipT = 1.5;
            break;
          }
          if (e.kind === 'free' && e.shot !== 'tip' && e.touch === 3 && ctx.settings.showHelp !== false && !e.dive)
            callout('Balón libre · salta con ' + G().jumpT + ' para rematar', 0, 'tip', 1.6);
          else if (e.grade === 'perfect' || (!e.grade && e.kind === 'pass' && e.quality >= 0.93)) {
            var pm = e.kind === 'free' ? (e.shot === 'tip' ? '¡Dejada perfecta!' : '') : PERFECT[e.kind];
            if (pm) callout(pm, 0);
          }
          break;
        case 'switch':
          clearPrompt(); break;
        case 'miss':
          if (e.player === g.ctrl) callout(e.reason === 'early' ? '¡Pronto!' : e.reason === 'late' ? '¡Tarde!' : 'No llegas', 1);
          break;
        case 'serveReady':
          // versión compacta, arriba: la cinta grande tapaba la red y al sacador justo cuando va a sacar
          if (e.matchPoint >= 0) banner('Punto de partido', e.matchPoint === 0 ? 'Un punto más y es tuyo' : 'La CPU tiene punto de partido', '', 'gold compact', BAN.sp);
          else if (e.setPoint >= 0) banner('Punto de set', e.setPoint === 0 ? 'Cierra el set ' + g.setNo : 'La CPU tiene punto de set', '', 'gold compact', BAN.sp);
          break;
        case 'toss':
          // con el balón en el aire no puede quedar nada encima de la jugada
          if (banT > 0 && el.banner.classList.contains('compact')) { banT = Math.min(banT, 0.3); }
          break;
        case 'set':
          banner(e.team === 0 ? 'Set para ti' : 'Set para la CPU', 'Set ' + e.setNo + ' · ' + e.score[0] + '-' + e.score[1], 'SETS ' + e.sets[0] + '-' + e.sets[1], e.team === 0 ? 'win' : 'lose', BAN.set);
          break;
        case 'match':
          banner(e.team === 0 ? '¡Partido!' : 'Gana la CPU', 'Sets ' + e.sets[0] + '-' + e.sets[1], '', e.team === 0 ? 'ace' : 'lose', BAN.match);
          break;
        case 'courtChange':
          // reglas 18.2.1 / 18.2.2. Llega en el mismo paso que 'set' / 'point': se encadena tras ese banner
          pendCourt = { t2: e.why === 'eight' ? 'Set decisivo · 8 puntos' : 'Fin del ' + (ORD[e.setNo] || e.setNo + '.º') + ' set', dur: e.why === 'eight' ? 1.25 : 1.05 };
          break;
        case 'newSet':
          banner('Set ' + e.setNo, e.setNo === 3 ? 'Set decisivo · a 15 puntos' : 'Sets ' + g.sets[0] + '-' + g.sets[1], '', 'neutral', BAN.info);
          break;
        case 'gameOver':
          showEnd(e);
          // victoria: 3,6 s reales de celebración (cámara lenta, confeti, público, jugadores) antes de la tarjeta;
          // se puede saltar. La derrota mantiene la pausa corta. En depuración, inmediata salvo &hold=1.
          if (e.team === 0 && (!ctx.debug || ctx.params.hold === '1')) startHold();
          break;
      }
    }
    flushCourt();
  }
  var ORD = ['', '1.er', '2.º', '3.er'], pendCourt = null, bodyTipT = 0;
  function flushCourt() { if (pendCourt && banT <= 0.3) { var c = pendCourt; pendCourt = null; banner('Cambio de campo', c.t2, '', 'neutral', c.dur); } }
  var OUTK = { serve: 'Saque fuera', pass: 'Recepción fuera', set: 'Colocación fuera', spike: 'Remate fuera', free: 'Balón fuera' };
  // sin 'free': un balón libre (3.er toque sin saltar) es la opción floja y no se celebra
  var PERFECT = { pass: 'Recepción perfecta', set: 'Colocación perfecta', spike: '¡Remate perfecto!', serve: '¡Saque perfecto!' };
  function flashRow(t) { restartAnim(t === 0 ? el.row0 : el.row1, 'scored'); }

  // =====================================================================
  //  HUD
  // =====================================================================
  var _bv = null, tbRect = null;
  var promptCur = '', promptHold = 0, promptWho = null, serveT0 = 0, tbLabel1 = 'RECEPCIÓN', coachSeen = {};

  // ---- Primeros toques guiados (primer partido, o &guide=1) ----
  // La primera recepción, la primera colocación y el primer remate del jugador nuevo llegan a cámara lenta
  // con una tarjeta grande que dice exactamente qué pulsar. Una sola vez por tipo.
  var guideT = 0, guideDone = {};
  function guideOn(g) {
    if (g.demo || (g.autopilot && ctx.params.guide !== '1') || ctx.settings.showHelp === false) return false;
    return ctx.params.guide === '1' || (!ctx.debug && record.played === 0);
  }
  function guideCheck(g, p, w, nt, gl) {
    if (guideT > 0 || nt === 0) return;
    var t = w ? (nt === 3 && w.attack ? w.jumpT : w.t) : (g.pr1 ? g.pr1.t : 9);
    var key = nt === 1 ? 'r' : nt === 2 ? 's' : 'a';
    if (guideDone[key] || !(t > 0.05 && t < 0.85)) return;
    if (nt === 3 && !(w && w.attack)) return;
    guideDone[key] = 1;
    // en mayúsculas, sin abreviaturas ordinales ("1.ER" queda mal)
    var k = nt === 1 ? 'Primer toque · ' + (tbLabel1 === 'DEFENSA' ? 'Defensa' : 'Recepción') : nt === 2 ? 'Segundo toque · Colocación' : 'Tercer toque · Remate';
    var txt = nt === 1 ? 'Ve al aro amarillo y pulsa ' + gl.hit : nt === 2 ? 'Ponte bajo el balón y pulsa ' + gl.hit : gl.jump + ' para saltar · ' + gl.hit + ' arriba';
    el.guideK.textContent = k.toUpperCase(); el.guideT.innerHTML = txt;
    el.guide.className = ''; void el.guide.offsetWidth; el.guide.className = 'show';
    guideT = 2.4;
    try { if (VB.CameraRig && VB.CameraRig.slowmo) VB.CameraRig.slowmo(0.4, 1.3, 0.35); } catch (e) { }
  }
  function guideHide() { guideT = 0.3; el.guide.className = 'out'; }
  // sin cierres por frame: llamadas a la sim protegidas
  function hw(g, p) { try { return VB.Sim.hitWindow(g, p); } catch (e) { return null; } }
  function cr(g, p) { try { return VB.Sim.canReach(g, p); } catch (e) { return false; } }
  function dist2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

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
    if (last.tag !== tag) { last.tag = tag; el.tag.hidden = !tag; el.tag.textContent = tag; el.tag.classList.toggle('cpu', tagT === 1); }

    var playing = ctx.state === 'playing' && !demo;
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
    var tbDim = false;
    if (nt && ctx.camera && VB.toThree && ctx.THREE) {
      if (!_bv) _bv = new ctx.THREE.Vector3();
      if (!tbRect || (ctx.frame & 31) === 0) tbRect = el.touchbar.getBoundingClientRect();
      VB.toThree(g.ball.x, g.ball.y, g.ball.z, _bv); _bv.project(ctx.camera);
      var bpx = (_bv.x + 1) * 0.5 * ctx.width, bpy = (1 - _bv.y) * 0.5 * ctx.height;
      tbDim = _bv.z < 1 && bpx > tbRect.left - 12 && bpx < tbRect.right + 12 && bpy > tbRect.top - 12 && bpy < tbRect.bottom + 12;
    }
    if (last.tbDim !== tbDim) { last.tbDim = tbDim; el.touchbar.classList.toggle('dim', tbDim); }
    // ---- aviso contextual + consejo ----
    var help = ctx.settings.showHelp !== false, gl = G(), touchDev = device() === 'touch';
    var pk = '', ptext = '', pcls = '', coach = '', progress = 0;
    var p = g.ctrl, humanSide = playing && (!g.autopilot || ctx.debug);
    if (humanSide && p) {
      var sv = g.server || (g.ball.held || null), myServe = g.mode === 'serve' && sv && sv.team === 0;
      var tossed = g.serveState ? g.serveState === 'toss' : !g.ball.held;
      if (myServe && !tossed && g.serveAuth === false) {
        // antes del silbato del árbitro no se puede sacar (regla)
        pk = 'wait'; ptext = 'Espera el silbato';
        coach = touchDev ? 'Tu saque · espera el silbato' : 'Tu saque · ' + gl.move + ' te mueves por el fondo';
      } else if (myServe && !tossed) {
        pk = 'serve'; ptext = device() === 'touch' ? 'Lanza el balón' : 'Lanzar'; pcls = 'hit';
        coach = touchDev ? gl.serve + ' flotante · ' + gl.jump + ' en salto'
          : g.serveState ? 'Tu saque · ' + gl.move + ' te mueves · ' + gl.serve + ' saque flotante · ' + gl.jump + ' saque en salto'
          : 'Tu saque · ' + gl.move + ' para colocarte en el fondo, apunta con ' + gl.aim + ' (la <b>diana naranja</b> marca adónde va) y pulsa ' + gl.serve;
        if (g.serveClock != null && g.serveClock < 4.5 && g.serveT > 0.35) { ptext = 'Saca ya · ' + Math.ceil(g.serveClock) + ' s'; coach = 'Regla de los <b>8 segundos</b>: saca antes de que acabe la cuenta'; }
      } else if (myServe) {
        // Balón lanzado. Mientras SUBE, hitWindow().t pasa por ~0 (cruza la altura de contacto de subida):
        // el aviso "¡Golpea!" solo con el balón BAJANDO. Antes, un aviso neutro con barra de tiempo.
        var ws = VB.Sim.hitWindow ? hw(g, p) : null, b = g.ball;
        var tl = serveTimeLeft(g, ws);
        if (b.vz < 0 && ws && ws.reach && ws.t < 0.18 && ws.t > -0.06) { pk = 'serve'; ptext = device() === 'touch' ? '¡Golpea!' : '¡Golpea ahora!'; pcls = 'hit go'; }
        else if (tl > 0) {
          pk = 'serve'; ptext = 'Golpea al bajar'; pcls = 'hit soon';
          if (!serveT0 || tl > serveT0) serveT0 = tl;
          progress = 1 - tl / serveT0;
        }
        // balón en el aire: sin consejo arriba (tapaba el balón y el marcador colgado justo al golpear);
        // basta el aviso "¡Golpea ahora!" junto al jugador
        coach = '';
      } else if (g.mode === 'serve') {
        coach = help ? (touchDev ? 'Saca la CPU · a recibir' : 'Saca la CPU · prepárate para la <b>recepción</b>') : '';
      } else if (g.mode === 'rally') {
        var w = VB.Sim && VB.Sim.hitWindow ? hw(g, p) : null;
        var reach = w ? (w.reach && w.t < 0.22 && w.t > -0.06 && nt > 0) : (VB.Sim && VB.Sim.canReach ? cr(g, p) : false);
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
          else if (nt === 3) coach = '3.er toque · <b>Ataque</b>: bajo el balón, ' + gl.jump + ' para saltar y ' + gl.hit + ' arriba';
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
    if (pkey) { promptCur = pkey; promptHold = pcls.indexOf('go') >= 0 ? 0.08 : 0.3; promptWho = p; }
    else if (promptHold > 0) { promptHold -= Math.max(dt, ctx.realDt || 0); if (promptHold <= 0 || promptWho !== p) promptCur = ''; }
    var showKey = promptCur ? promptCur + '|' + device() : '';
    if (last.prompt !== showKey) {
      last.prompt = showKey;
      if (promptCur) {
        var parts = promptCur.split('|'), dv = device();
        // en el saque el botón táctil se llama SACAR: el aviso usa el mismo nombre
        el.promptKey.textContent = parts[0] === 'jump' ? gl.jumpT : (parts[0] === 'serve' && dv === 'touch' ? 'SACAR' : gl.hitT);
        el.promptKey.className = 'key' + (dv === 'gamepad' ? ' pad ' + (parts[0] === 'jump' ? 'pb' : 'pa') : dv === 'touch' ? ' tch' + (parts[0] === 'jump' ? ' j' : '') : '');
        el.promptText.textContent = parts[1];
        el.prompt.className = (parts[0] === 'wait' ? 'wait' : parts[2] || 'hit') + (anchorOn ? ' anch' : '');
        promptW = 0; // se vuelve a medir
      } else { el.prompt.className = 'off' + (anchorOn ? ' anch' : ''); prX = -1; }
    }
    if (promptCur) {
      if (promptCur.indexOf('soon') >= 0) el.promptBar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, progress)).toFixed(3) + ')';
      placePrompt(g, p);
    }
    // la cinta compacta de punto de set/partido ocupa la franja alta: mientras dura, sin consejo
    var compactBan = banT > 0 && el.banner.classList.contains('compact');
    var showCoach = coach && !compactBan && !(guideT > 0) && (help || g.mode === 'serve') && (record.played < 3 || ctx.params.coach === '1' || (g.mode === 'serve' && !touchDev));
    // táctil: cada tipo de consejo se ve 3 s como mucho por partido (luego estorba más que ayuda)
    if (showCoach && touchDev) {
      var ckey = g.mode === 'serve' ? 's' + (myServe ? 1 : 0) : 'r' + nt + (g.touchTeam === 1 && g.touches === 2 ? 'b' : '');
      coachSeen[ckey] = (coachSeen[ckey] || 0) + (dt || 0); // tiempo de juego: congelado o en pausa no cuenta
      if (coachSeen[ckey] > 3) showCoach = false;
    }
    var ck = showCoach ? coach : '';
    if (last.coach !== ck) { last.coach = ck; if (ck) el.coach.innerHTML = ck; el.coach.classList.toggle('off', !ck); }
    // con un aviso de "¡ahora!" en marcha, el consejo se atenúa: los ojos van al jugador
    var dimC = !!ck && !!promptCur && promptCur.indexOf('go') >= 0;
    if (last.dimC !== dimC) { last.dimC = dimC; el.coach.classList.toggle('dim', dimC); }
  }

  /** Borra el aviso al instante (golpe del equipo humano, cambio de jugador). */
  function clearPrompt() { promptCur = ''; promptHold = 0; }

  /** Segundos hasta que el balón lanzado del saque BAJE a la altura de contacto (sirve también mientras sube). */
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
  var anchorOn = true, promptW = 0, promptH = 0, prX = -1, prY = -1, _pv = null, _ph = null;
  function placePrompt(g, p) {
    var cam = ctx.camera, W = ctx.width, H = ctx.height;
    if (!cam || !p || !VB.toThree || !ctx.THREE) return anchorBottom();
    if (!_pv) { _pv = new ctx.THREE.Vector3(); _ph = new ctx.THREE.Vector3(); }
    VB.toThree(p.x, p.y, (p.z || 0) + 1.15, _pv); _pv.project(cam);
    VB.toThree(p.x, p.y, (p.z || 0) + 1.85, _ph); _ph.project(cam);
    if (_pv.z > 1 || _pv.z < -1 || Math.abs(_pv.x) > 1.05 || Math.abs(_pv.y) > 1.05) return anchorBottom();
    if (!promptW) { promptW = el.prompt.offsetWidth || 180; promptH = el.prompt.offsetHeight || 38; }
    var sx = (_pv.x + 1) * 0.5 * W, sy = (1 - _pv.y) * 0.5 * H;
    var hy = (1 - _ph.y) * 0.5 * H, body = Math.max(18, Math.abs(sy - hy) * 1.55); // ~ media altura del jugador en px
    var gap = Math.max(26, body * 0.42), m = 12;
    var x = sx + gap;
    if (x + promptW > W - m - (ctx.isTouch ? W * 0.22 : 0)) x = sx - gap - promptW; // no cabe a la derecha (o pisa los botones táctiles)
    x = Math.max(m, Math.min(W - m - promptW, x));
    var y = Math.max(64, Math.min(H - promptH - m, sy - promptH * 0.5));
    if (!anchorOn) { anchorOn = true; el.prompt.classList.add('anch'); prX = -1; }
    if (prX < 0) { prX = x; prY = y; }
    else { var k = 1 - Math.exp(-16 * Math.max(0.001, ctx.realDt || 0.016)); prX += (x - prX) * k; prY += (y - prY) * k; }
    el.prompt.style.transform = 'translate3d(' + prX.toFixed(1) + 'px,' + prY.toFixed(1) + 'px,0)';
  }
  function anchorBottom() {
    if (anchorOn) { anchorOn = false; el.prompt.classList.remove('anch'); el.prompt.style.transform = ''; prX = -1; }
  }

  // =====================================================================
  //  PANTALLAS
  // =====================================================================
  function showNode(node, on) {
    if (on) {
      if (node.hidden) { node.hidden = false; node.classList.remove('in'); requestAnimationFrame(function () { node.classList.add('in'); }); }
    } else { node.hidden = true; node.classList.remove('in'); }
  }
  function syncScreens(g) {
    var s = ctx.state, key = s + (ctx.portraitBlock ? 'P' : '') + (ctx.endHold ? 'H' : '') + (panel || '');
    if (key === shown) return;
    shown = key;
    showNode(el.menu, s === 'menu' && !panel);
    showNode(el.pause, s === 'paused' && !panel);
    showNode(el.end, s === 'over' && !!g.finished && !panel && !ctx.endHold);
    showNode(el.panel, !!panel);
    // En el menú el HUD no se oculta con display:none sino casi transparente (.warm): mostrarlo por primera vez
    // al empezar el partido costaba un frame de 100-120 ms (rasterizado del marcador; medido en Chrome/ANGLE).
    // Así ya está pintado y el primer frame del partido baja a < 35 ms.
    el.hud.hidden = false; el.hud.classList.toggle('warm', s === 'menu');
    el.rotate.hidden = !ctx.portraitBlock;
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
    focusEl(list[i], true); hoverSound();
  }

  function renderMenu() {
    var d = device();
    var h = d === 'gamepad' ? '<span class="key">Stick</span> elegir · <span class="key pad pa">A</span> aceptar · <span class="key pad pb">B</span> volver'
      : d === 'touch' ? '' : '<span class="key">↑</span><span class="key">↓</span> elegir · <span class="key">Intro</span> aceptar · <span class="key">←</span><span class="key">→</span> cambiar · <span class="key">Esc</span> volver';
    setHTML(el.navHint, 'navh', h);
    setText(el.ctlSub, 'ctls', d === 'gamepad' ? 'Mando conectado' : d === 'touch' ? 'Táctil' : 'Teclado · mando');
    var rec = record.played ? '<span><b>' + record.wins + '/' + record.played + '</b>Victorias</span>' + (record.bestStreak ? '<span><b>' + record.bestStreak + '</b>Mejor racha</span>' : '') : '<span><b>¡Estreno!</b>Tu primer partido</span>';
    setHTML(el.menuRecord, 'rec', rec);
  }
  function renderPause(g) {
    el.pS0.textContent = g.score[0]; el.pS1.textContent = g.score[1];
    el.pMid.innerHTML = 'SET ' + g.setNo + '<br>SETS ' + g.sets[0] + '-' + g.sets[1];
  }

  // ---------- Celebración previa a la pantalla final ----------
  var endHold = 0, holdAge = 0;
  function startHold() {
    endHold = 3.6; holdAge = 0; ctx.endHold = true;
    var d = device();
    el.skip.innerHTML = d === 'touch' ? 'Toca para continuar' : d === 'gamepad' ? '<span class="key pad pa">A</span>Continuar' : '<span class="key">Intro</span>Continuar';
    el.skip.hidden = false; shown = '';
  }
  function revealEnd() {
    if (!ctx.endHold) return;
    endHold = 0; ctx.endHold = false; el.skip.hidden = true; shown = '';
    if (ctx.game) syncScreens(ctx.game);
  }

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
    el.endKicker.textContent = win ? 'Final del partido · Victoria' : 'Final del partido · Derrota';
    el.endTitle.textContent = win ? '¡Victoria!' : 'Gana la CPU';
    el.endS0.textContent = e.sets[0]; el.endS1.textContent = e.sets[1];
    el.endSets.innerHTML = (e.setScores || []).map(function (s, i) {
      return '<span class="w' + (s[0] > s[1] ? 0 : 1) + '"><small>SET ' + (i + 1) + '</small>' + s[0] + '-' + s[1] + '</span>';
    }).join('');
    // ataque + bloqueo + saque + errores del rival = puntos (cada punto cuenta en una sola fila)
    var rows = [['Puntos', 'points'], ['Puntos de ataque', 'kills'], ['Puntos de bloqueo', 'blocks'], ['Aces', 'aces'], ['Errores del rival', 'oppErr'], ['Mejor racha', 'best']];
    var html = '<div class="st-h"><span>TÚ</span><span></span><span>CPU</span></div>';
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
    shown = '';
  }

  // =====================================================================
  //  PANELES: tutorial, controles, ajustes
  // =====================================================================
  var PANELS = { tut: ['pnTut', 'Tutorial', 'Cómo se juega'], ctl: ['pnCtl', 'Mando · teclado · táctil', 'Controles'], set: ['pnSet', 'Opciones', 'Ajustes'], first: ['pnFirst', 'Antes de empezar', '¡Bienvenido!'] };
  var firstAsked = false;
  /** JUGAR desde el menú: la primera vez (sin partidos ni tutorial) ofrece ver el tutorial o jugar ya. */
  function play() {
    if (!firstAsked && !record.played && !record.tut && !ctx.debug) {
      firstAsked = true; uiSound('click');
      var di = optIndex('difficulty');
      el.firstDiff.textContent = 'Nivel ' + OPT.difficulty.labels[di] + (di === 0 ? ' (recomendado para empezar)' : '') + ' · se cambia en el menú';
      openPanel('first', 'menu'); return;
    }
    uiSound('start'); ctx.actions.startMatch();
  }
  function openPanel(name, from) {
    panel = name; panelFrom = from || ctx.state;
    for (var k in PANELS) $(PANELS[k][0]).hidden = k !== name;
    el.pnKick.textContent = PANELS[name][1]; el.pnTitle.textContent = PANELS[name][2];
    if (name === 'tut') { tutGo(0); }
    if (name === 'ctl') { el.ctlGrid.className = 'ctl cur-' + device(); }
    if (name === 'set') renderOpts();
    el.panel.querySelector('.sheet').classList.toggle('first', name === 'first');
    shown = '';
    syncScreens(ctx.game);
    focusLayer(name === 'tut' ? el.btnTutNext : name === 'first' ? el.btnFirstTut : null);
  }
  function closePanel() {
    if (!panel) return false;
    var was = panel; panel = null; tutStop();
    shown = ''; syncScreens(ctx.game);
    focusLayer(ctx.state === 'menu' ? (was === 'tut' ? el.btnTut : was === 'ctl' ? el.btnControls : was === 'first' ? el.btnPlay : el.btnSettings) : null);
    return true;
  }

  // ---------- Opciones ----------
  var OPT = {
    // 4 niveles (sim: VB.DIFF_ORDER / VB.DIFF[k].name)
    difficulty: (VB.DIFF_ORDER && VB.DIFF) ? { vals: VB.DIFF_ORDER.slice(), labels: VB.DIFF_ORDER.map(function (k) { return (VB.DIFF[k] && VB.DIFF[k].name) || k; }) }
      : { vals: ['easy', 'normal', 'hard', 'expert'], labels: ['Fácil', 'Normal', 'Difícil', 'Experto'] },
    muted: { vals: [false, true], labels: ['Sí', 'No'] },
    quality: { vals: ['auto', 'high', 'medium', 'low'], labels: ['Auto', 'Alta', 'Media', 'Baja'] },
    showHelp: { vals: [true, false], labels: ['Sí', 'No'] }
  };
  function optIndex(k) { var o = OPT[k], v = ctx.settings[k]; for (var i = 0; i < o.vals.length; i++) if (o.vals[i] === v) return i; return k === 'difficulty' ? 1 : 0; }
  var SLIDERS = { camSens: { min: 0.5, max: 1.5, def: 1 }, sfxVol: { min: 0, max: 1, def: 1 }, musicVol: { min: 0, max: 1, def: 0.75 } };
  function slVal(k) { var c = SLIDERS[k], v = +ctx.settings[k]; return isFinite(v) ? Math.max(c.min, Math.min(c.max, v)) : c.def; }
  function changeOpt(k, d, absIdx) {
    if (SLIDERS[k]) {
      var c = SLIDERS[k], v = Math.round((slVal(k) + d * 0.1) * 10) / 10;
      if (v > c.max + 1e-6) v = d > 0 && absIdx === 'wrap' ? c.min : c.max; if (v < c.min - 1e-6) v = c.min;
      ctx.actions.setSetting(k, v);
      if (k === 'sfxVol' && VB.Audio && VB.Audio.play) try { VB.Audio.play('pass', 0.8); } catch (e) { }
    } else {
      var o = OPT[k], i = absIdx != null ? absIdx : (optIndex(k) + d + o.vals.length) % o.vals.length;
      ctx.actions.setSetting(k, o.vals[i]);
    }
    click();
  }
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
    var q = ctx.quality && ctx.quality.level, qn = { high: 'alta', medium: 'media', low: 'baja' }[q] || '';
    el.qualNote.textContent = ctx.settings.quality === 'auto' ? 'Auto ajusta la calidad para ir fluido' + (qn ? ' · ahora: ' + qn : '') : 'Fija · ' + (qn || '');
    // menú: dificultad
    var di = optIndex('difficulty');
    el.diffVal.textContent = OPT.difficulty.labels[di];
    for (var n = 0; n < el.diffLvl.children.length; n++) el.diffLvl.children[n].classList.toggle('on', n <= di);
    el.playSub.textContent = 'Partido · ' + OPT.difficulty.labels[di] + ' · 25 · 25 · 15';
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
      var t = svgEl('text', { x: 0, y: pl.you ? -53 : -46, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'Barlow Condensed,Arial Narrow,sans-serif', 'font-weight': 800, 'font-size': 10, 'letter-spacing': 1, stroke: '#0d1a2e', 'stroke-width': 2.4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, body);
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
      rule: '<b>Ace</b>: el saque cae en el campo rival sin que nadie lo toque. Tienes <b>8 segundos</b> para sacar; si sale fuera o por fuera de las antenas, punto para el rival.' },
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
    '<li><b>4 toques</b>Un equipo toca el balón más de 3 veces (el bloqueo no cuenta).</li>' +
    '<li><b>Dobles</b>El mismo jugador toca el balón dos veces seguidas.</li>' +
    '<li><b>Red</b>Tocar la red con el cuerpo es falta. Si el balón la toca y pasa, el juego sigue.</li>' +
    '<li><b>Cuerpo</b>Si el balón te da en el cuerpo, cuenta como toque.</li>' +
    '<li><b>Cambio de campo</b>Al acabar cada set y a los 8 puntos del set decisivo.</li>' +
    '<li><b>Sets</b>A 25 puntos con 2 de diferencia; el 3.º, a 15. Gana quien se lleva 2 sets.</li>' +
    '</ul><p class="tut-rule">Cada jugada da un punto (sistema de punto por jugada). Si la ganas recibiendo, recuperas el saque (<b>cambio de saque</b>) y saca tu compañero.</p>';

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
    if (from === 'menu') ctx.actions.startMatch();
  }

  // =====================================================================
  //  ENTRADA DE MENÚS
  // =====================================================================
  function adjustFocused(d) {
    var a = document.activeElement;
    if (panel === 'tut' && (!a || !a.getAttribute || !a.getAttribute('data-opt'))) { if (d > 0) { if (tut.i < TUT.length - 1) tutGo(tut.i + 1); } else tutGo(tut.i - 1); click(); return true; }
    if (a && a.getAttribute && a.getAttribute('data-opt') && !a.closest('[hidden]')) { changeOpt(a.getAttribute('data-opt'), d); return true; }
    return false;
  }
  function onKey(e) {
    ctx.lastKeyT = ctx.time;
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
      else if (ctx.state === 'over' && ctx.endHold) { if (holdAge > 0.5) revealEnd(); }
      else if (ctx.state === 'over' && ctx.game && ctx.game.finished) ctx.actions.startMatch();
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
    isPanelOpen: function () { return !!panel; },
    init: function (c) {
      ctx = c; loadRecord();
      ['hud', 'banner', 'callout', 'menu', 'pause', 'end', 'panel', 'rotate', 'touchbar', 'prompt', 'promptKey', 'promptText', 'promptBar', 'coach',
        'pS0', 'pS1', 'pMid', 'endTitle', 'endKicker', 'endS0', 'endS1', 'endSets', 'endStats', 'endRecord',
        'btnPlay', 'optDiff', 'btnTut', 'btnControls', 'btnSettings', 'btnResume', 'btnRestart', 'btnQuit', 'btnPControls', 'btnPSettings',
        'btnAgain', 'btnMenu', 'btnPanelBack', 'btnTutPrev', 'btnTutNext', 'btnHudPause', 'btnHudMute', 'icoSound',
        'pnKick', 'pnTitle', 'tutBody', 'tutFig', 'tutStep', 'tutTitle', 'tutText', 'tutDots', 'ctlGrid', 'ctlSub', 'navHint', 'menuRecord',
        'diffVal', 'diffLvl', 'playSub', 'qualNote', 'tb1t', 'btnFirstTut', 'btnFirstPlay', 'firstDiff', 'guide', 'guideK', 'guideT', 'skip', 'btnAgainAlt'].forEach(function (k) { el[k] = $(k); });
      el.bn1 = $('bn1'); el.bn2 = $('bn2'); el.bn3 = $('bn3'); el.sbSet = $('sbSet'); el.tag = $('sbTag'); el.hist = $('sbHist');
      el.row0 = $('sbRow0'); el.row1 = $('sbRow1'); el.name0 = $('sbName0'); el.name1 = $('sbName1');
      el.pts0 = $('sbPts0'); el.pts1 = $('sbPts1');
      el.pips0 = $('sbSets0').children; el.pips1 = $('sbSets1').children;
      el.tb = [$('tb1'), $('tb2'), $('tb3')];
      el.app = $('app'); if (ctx.isTouch) el.app.classList.add('is-touch');

      function on(b, fn) { b.addEventListener('click', function (ev) { click(); fn(ev); }); }
      el.btnPlay.addEventListener('click', play);
      el.btnFirstTut.addEventListener('click', function () { click(); openPanel('tut', 'menu'); });
      el.btnFirstPlay.addEventListener('click', function () { uiSound('start'); panel = null; ctx.actions.startMatch(); });
      el.optDiff.addEventListener('click', function () { changeOpt('difficulty', 1); });
      on(el.btnTut, function () { openPanel('tut', 'menu'); });
      on(el.btnControls, function () { openPanel('ctl', 'menu'); });
      on(el.btnSettings, function () { openPanel('set', 'menu'); });
      on(el.btnResume, function () { ctx.actions.resume(); });
      on(el.btnPControls, function () { openPanel('ctl', 'paused'); });
      on(el.btnPSettings, function () { openPanel('set', 'paused'); });
      on(el.btnRestart, function () { ctx.actions.restart(); });
      on(el.btnQuit, function () { ctx.actions.toMenu(); });
      el.btnAgain.addEventListener('click', function () { uiSound('start'); ctx.actions.startMatch(); });
      el.btnMenu.addEventListener('click', function () { uiSound('back'); ctx.actions.toMenu(); });
      el.btnAgainAlt.addEventListener('click', function () {
        var d = el.btnAgainAlt.getAttribute('data-d'); uiSound('start');
        if (d) ctx.actions.setSetting('difficulty', d);
        ctx.actions.startMatch();
      });
      // tocar/clic durante la celebración final la salta
      window.addEventListener('pointerdown', function () { if (ctx.endHold && holdAge > 0.5) revealEnd(); }, { passive: true });
      el.btnPanelBack.addEventListener('click', function () { uiSound('back'); closePanel(); });
      // sonido suave al pasar por encima de un botón de menú (solo ratón)
      var hb = document.querySelectorAll('.screen button');
      for (var h = 0; h < hb.length; h++) hb[h].addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') hoverSound(); });
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
            ctx.actions.setSetting(k, Math.round((c.min + f * (c.max - c.min)) * 10) / 10); click(); return;
          }
          if (sp && OPT[k]) changeOpt(k, 0, +sp.getAttribute('data-i')); else changeOpt(k, 1, SLIDERS[k] ? 'wrap' : null);
        });
      })(opts[i]);
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', function () { var p = document.querySelectorAll('.kf'); for (var i = 0; i < p.length; i++) p[i].classList.remove('kf'); }, { passive: true });
      document.addEventListener('focusout', function (e) { if (e.target && e.target.classList) e.target.classList.remove('kf'); });
      window.addEventListener('gamepadconnected', function () { last.navh = null; last.ctls = null; if (ctx.state === 'menu') renderMenu(); });
      this.onSettings(ctx.settings);
      var pn = ctx.params.panel || (ctx.debug === 'tutorial' ? 'tut' : ctx.debug === 'controls' ? 'ctl' : ctx.debug === 'settings' ? 'set' : '');
      if (pn && PANELS[pn]) setTimeout(function () { openPanel(pn, 'menu'); if (ctx.params.step) tutGo(+ctx.params.step - 1); }, 0);
    },
    onSettings: function (s) {
      el.btnHudMute.classList.toggle('muted', !!s.muted);
      el.icoSound.innerHTML = s.muted ? '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="#f7f2ea" stroke-width="2" stroke-linecap="round"/>'
        : '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="#f7f2ea" stroke-width="2" stroke-linecap="round"/>';
      renderOpts();
    },
    setQuality: function () { if (panel === 'set') renderOpts(); },
    onState: function (s, prev) {
      shown = '';
      if (s === 'playing') {
        if (prev !== 'paused') hideBanner();
        if (panel) { panel = null; tutStop(); }
        var a = document.activeElement; if (a && a.blur && a.tagName === 'BUTTON') a.blur(); // que el Espacio no pulse un botón oculto
      }
      if (s === 'menu') { panel = null; tutStop(); }
    },
    onGameStart: function (g) {
      last = {}; banT = 0; hideBanner(); promptCur = ''; promptHold = 0; // las estadísticas se reinician con 'newMatch'
      coachSeen = {}; guideDone = {}; guideT = 0; el.guide.className = '';
      endHold = 0; ctx.endHold = false; el.skip.hidden = true;
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
      if (ctx.endHold) { if (it && holdAge > 0.5 && (it.hit || it.jump || it.confirm)) revealEnd(); return; }
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
      if (ctx.state !== 'menu') hud(g, dt);
      if (banT > 0) {
        banT -= dt;
        if (banT <= 0.3 && !banOut) { banOut = true; el.banner.classList.add('out'); }
        if (banT <= 0) { hideBanner(); flushCourt(); }
      }
      if (calloutT > 0) { calloutT -= Math.max(dt, 0); if (calloutT <= 0) el.callout.className = ''; }
      var rdt = ctx.realDt || 0;
      if (guideT > 0) { guideT -= rdt; if (guideT <= 0.3 && el.guide.className === 'show') el.guide.className = 'out'; if (guideT <= 0) el.guide.className = ''; }
      if (ctx.endHold) { holdAge += rdt; endHold -= rdt; if (endHold <= 0 || ctx.state !== 'over') revealEnd(); }
      if (ctx.state === 'menu' && (ctx.frame & 63) === 0) renderMenu();
      if ((ctx.frame & 31) === 0 && !el.app.classList.contains('is-touch') && VB.Input && VB.Input.isTouchActive && safe(VB.Input.isTouchActive)) el.app.classList.add('is-touch');
    }
  };
})();
