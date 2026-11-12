#!/usr/bin/env node
/* VOLEY 3D — tools/simtest.js  (owner: sim)
 * Test headless de la simulación: carga js/sim.js y js/ai.js en un contexto vm
 * (sin DOM ni THREE) y ejecuta:
 *   1) CPU vs CPU (demo) -> estadísticas de rally, toques, motivos, calidad
 *   2) Autopilot (equipo humano por IA normal) contra cada dificultad
 *   3) Fuzz con entrada humana aleatoria
 *   4) Bots "humanos" que juegan SOLO con la entrada real (mover/golpear/saltar) con un modelo de jugador
 *      en tercera persona (reacción lognormal, error de lectura que crece con el vuelo y la distancia,
 *      malas lecturas, timing con σ por habilidad, inercia del stick): perfecto / bueno / medio / novato
 *      (primera sesión) contra los 4 niveles -> % de puntos y probabilidad estimada de ganar el partido
 *   5) Reglas puntuales (4 toques, dobles, sets, red, antena, saque, bloqueo...) y vocabulario del árbitro
 *   6) Ritual del sacador CPU (SIM-04): en cada saque de cada partida (ritualChecker) y casos propios
 *   7) Calibración del highlight (SIM-05): 20 partidos completos CPU vs CPU con histograma, banda 15-25 % de puntos >= 0,55,
 *      < 5 % >= 0,8 fuera de punto de set/partido, cobertura de señal/landSide/pausa/ritual/dribble y determinismo por semilla
 * Sale con código != 0 si hay excepciones o invariantes rotos.
 * Uso: node tools/simtest.js [minutos=20] [seed=12345] [minutosMatriz=20] [semillas=4]
 *   La matriz (dificultades y bots) va en paralelo con worker_threads.
 *   minutosMatriz = minutos de juego por semilla y casilla (0 = saltar matriz); semillas = partidas por casilla.
 *   SIMTEST_ONLY=matrix: solo la matriz. MATRIX_FILTER='novato vs easy|medio vs normal': solo esas casillas.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const MIN = +(process.argv[2] || 20), SEED = +(process.argv[3] || 12345), BOTMIN = +(process.argv[4] != null ? process.argv[4] : 20);
const NSEED = Math.max(1, +(process.argv[5] || 4)); // semillas por casilla de la matriz (se suman)
// SIMTEST_ONLY=matrix: solo la matriz (afinado); MATRIX_FILTER=<regex>: solo las casillas cuya etiqueta encaje
// SIMTEST_ROOKIE=all: el bot novato juega TODOS los partidos con la ayuda de primer partido (medir rookieProf);
// SIMTEST_ROOKIE=off: ninguno. Por defecto solo el primero, como el juego real (main.js isRookie).
const ROOKIE_MODE = process.env.SIMTEST_ROOKIE || 'first';
const ONLY = process.env.SIMTEST_ONLY || '', MFILTER = process.env.MATRIX_FILTER ? new RegExp(process.env.MATRIX_FILTER) : null;

function load() {
  const ctx = { console, Math, Date };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['js/sim.js', 'js/ai.js', 'js/ai6.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.VB;
}
const VB = load();
const S = VB.Sim, C = VB.C;
const DT = 1 / C.SIM_HZ;
let failures = 0;
const fail = m => { failures++; console.error('FALLO:', m); };
const KNOWN = ['hit', 'block', 'net', 'land', 'point', 'set', 'match', 'gameOver', 'whistle', 'jump', 'switch', 'serveReady',
  'sideout', 'newSet', 'bounce', 'swing', 'landPlayer', 'newMatch', 'toss', 'miss', 'dive', 'netTouch', 'courtChange', 'dribble', 'challenge', 'challengeResult',
  'rotation', 'libero', 'blockPress']; // (rotation y libero, solo 6v6; blockPress = GOLPEAR en el aire en el bloqueo, sim.js blockPress)
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
// Vocabulario del árbitro (FCVB): cada motivo de punto con sus textos válidos. Un texto nuevo debe pasar por aquí.
const POINT_TEXTS = {
  in: ['El balón cae en tu campo', 'El balón cae en el campo rival', 'Saque a la red', 'Balón a la red'],
  // (out también admite 'Saque a la red'/'Balón a la red': da en la red y cae fuera en el propio campo)
  out: ['Saque fuera', 'Remate fuera', 'Dejada fuera', 'Pokey fuera', 'Recepción fuera', 'Defensa fuera', 'Colocación fuera', 'Balón fuera', 'Toca el bloqueo y sale fuera', 'Le da en el cuerpo y sale fuera', 'Saque a la red', 'Balón a la red'],
  antenna: ['Balón toca la antena', 'Balón por fuera de la antena'], under: ['Balón por debajo de la red'],
  double: ['Dobles: el mismo jugador toca dos veces', 'Dobles en la colocación de dedos'], four: ['4 toques'], net: ['Toque de red'], block: ['Bloqueo del saque'],
  attackServe: ['Ataque sobre el saque'], serve: ['Falta de saque: 8 segundos', 'Falta de saque: 5 segundos', 'Falta de saque: el balón cae sin golpearlo'],
  position: ['Falta de posición'] // (solo 6v6, lote A: el humano solapado en el golpe de saque; la IA nunca)
};
const badText = new Set();
// Señales oficiales del árbitro (SIM-02, point.signal): lista cerrada
const SIGNALS = ['in', 'out', 'touched', 'four', 'double', 'net', 'under', 'antenna', 'attackFault', 'delay8', 'serveFault'];
const SIG_OF = { in: ['in'], out: ['out', 'touched'], four: ['four'], double: ['double'], net: ['net'], under: ['under'], antenna: ['antenna'],
  attackServe: ['attackFault'], block: ['attackFault'], serve: ['delay8', 'serveFault'], position: ['attackFault', 'serveFault'] }; // (position reutiliza una señal ya pintada)
const isInt0 = v => Number.isInteger(v) && v >= 0;
/** Comprueba los campos de presentación de un evento point (SIM-01/02/03/05). ctx = {streak, setPoint, matchPoint (del
 *  serveReady), eight}. Además de cada campo por separado, RECOMPONE el highlight con S.highlightOf a partir de lo que el test
 *  sabe por su cuenta (cómo, toques, defensas, racha contada, punto de set/partido del serveReady, final apretado calculado del
 *  marcador, salvado, set/partido ganado) y exige el mismo número: un término que se cuele en la sim sin pasar por la fórmula
 *  publicada, o un campo que no cuadre con el número, falla aquí. Devuelve la lista de problemas (vacía si todo cuadra). */
function pointFieldIssues(e, g, ctx) {
  const bad = [];
  if (!(typeof e.highlight === 'number' && e.highlight >= 0 && e.highlight <= 1)) bad.push('highlight ' + e.highlight);
  if (!isInt0(e.digs)) bad.push('digs ' + e.digs);
  if (!isInt0(e.streak) || e.streak < 1) bad.push('streak ' + e.streak);
  if (ctx && ctx.streak != null && e.streak !== ctx.streak) bad.push('streak ' + e.streak + ' != ' + ctx.streak + ' (contado en el test)');
  if (typeof e.savedSetPoint !== 'boolean') bad.push('savedSetPoint ' + e.savedSetPoint);
  if (ctx && ctx.setPoint != null && e.savedSetPoint !== (ctx.setPoint === 1 - e.team)) bad.push('savedSetPoint ' + e.savedSetPoint + ' con punto de set de ' + ctx.setPoint);
  if (e.how === 'error' && !e.setWon && !e.matchWon && e.highlight > 0.35 + 1e-9) bad.push('error con highlight ' + e.highlight);
  // final apretado (SIM-05): marcador de ANTES del punto, últimos HL.clutchLast puntos del set y diferencia <= HL.clutchGap
  if (typeof e.clutch !== 'boolean') bad.push('clutch ' + e.clutch);
  else if (g && Array.isArray(e.score)) {
    const s0 = e.score[0] - (e.team === 0 ? 1 : 0), s1 = e.score[1] - (e.team === 1 ? 1 : 0), tgt = g.setNo === 3 ? 15 : 25;
    const want = Math.max(s0, s1) >= tgt - VB.HL.clutchLast && Math.abs(s0 - s1) <= VB.HL.clutchGap;
    if (e.clutch !== want) bad.push('clutch ' + e.clutch + ' con ' + s0 + '-' + s1 + ' (set ' + g.setNo + ')');
    if (ctx && ctx.setPoint != null && ctx.matchPoint != null && typeof e.rallyHits === 'number') {
      // remate perfecto del humano: el único término que el test no puede saber desde fuera (lo lee de g, como la sim)
      const pk = e.how === 'kill' && g.atkHow === 'kill' && !!g.atkHuman && g.atkGrade === 'perfect';
      const h = S.highlightOf({ how: e.how, rallyHits: e.rallyHits, digs: e.digs, perfectKill: pk, setPoint: ctx.setPoint !== -1, matchPoint: ctx.matchPoint !== -1,
        clutch: want, saved: ctx.setPoint === 1 - e.team, streak: ctx.streak != null ? ctx.streak : e.streak, setWon: e.setWon, matchWon: e.matchWon });
      if (h !== e.highlight) bad.push('highlight ' + e.highlight + ' != fórmula ' + h);
    }
  }
  if (!SIGNALS.includes(e.signal)) bad.push('señal fuera de la lista: ' + e.signal);
  else if (!(SIG_OF[e.reason] || []).includes(e.signal)) bad.push('señal ' + e.signal + ' para el motivo ' + e.reason);
  if ((e.signal === 'touched') !== (e.touchedOut === true) || typeof e.touchedOut !== 'boolean') bad.push('touched/touchedOut ' + e.signal + '/' + e.touchedOut);
  if (e.reason === 'serve' && (e.signal === 'delay8') !== /^Falta de saque: [58] segundos$/.test(e.text)) bad.push('8 s: señal ' + e.signal + ' con "' + e.text + '"');
  if (e.reason === 'serve' && e.signal === 'delay8' && g && g.serveClock !== 0) bad.push('delay8 con el reloj de saque en ' + g.serveClock);
  const landed = e.reason === 'in' || e.reason === 'out';
  if (landed ? !(e.landSide === 0 || e.landSide === 1) : e.landSide !== -1) bad.push('landSide ' + e.landSide + ' con ' + e.reason);
  if (landed && g && g.lastLand && e.landSide !== (g.lastLand.x > 0 ? 0 : 1)) bad.push('landSide no es el campo del bote');
  // pausa: la clásica sin g.present; con g.present la de presentación (VB.HOLD)
  const H = VB.HOLD, eight = ctx && ctx.eight;
  const want = g && g.present ? (e.matchWon ? H.match : e.setWon ? H.set : (e.highlight >= H.bigAt ? H.big : H.routine) + (eight ? H.eight : 0))
    : (e.matchWon ? 2.2 : e.setWon ? 3.6 : (g && g.demo ? VB.RITUAL.demoHold : 1.9) + (eight ? 1.4 : 0)); // demo: pausa rutinaria corta (SIM-04)
  if (Math.abs(e.hold - want) > 1e-9) bad.push('hold ' + e.hold + ' (esperado ' + want + ')');
  const lp = g && g.lastPoint;
  if (lp && (lp.highlight !== e.highlight || lp.signal !== e.signal || lp.hold !== e.hold || lp.digs !== e.digs || lp.streak !== e.streak || lp.landSide !== e.landSide || lp.clutch !== e.clutch)) bad.push('g.lastPoint no copia el evento');
  return bad;
}

function checkInvariants(g, tag) {
  const b = g.ball;
  for (const v of [b.x, b.y, b.z, b.vx, b.vy, b.vz]) if (!Number.isFinite(v)) { fail(tag + ' balón no finito'); return false; }
  for (const p of g.players) {
    if (!Number.isFinite(p.x + p.y + p.z)) { fail(tag + ' jugador no finito'); return false; }
    if (p.x * S.side(p.team) < 0.19) { fail(tag + ' jugador invade el campo rival'); return false; }
    if (p.z === 0 && p.x * S.side(p.team) < 0.34) { fail(tag + ' jugador pisa la línea central'); return false; }
  }
  if (g.touches > 3 && g.mode === 'rally' && g.lastKind !== 'serve') { fail(tag + ' más de 3 toques sin falta'); return false; }
  if (!g.ctrl || g.ctrl.team !== 0) { fail(tag + ' ctrl no es del equipo humano'); return false; }
  return true;
}

function newCounters() { const o = {}; for (const k of KNOWN) o[k] = 0; return o; }

/** Ritual del sacador CPU (SIM-04), comprobado en CADA saque de una partida (se llama tras cada paso con sus eventos):
 *  - CPU: g.cpuTossIn decrece de forma monótona desde el serveReady y vale 0 en el paso del toss; el lanzamiento llega
 *    a los g.whistleAt + ritual.dur (≤ RITUAL.tossBy desde el serveReady) y con el reloj de 8 s en ≥ 3 s; tantos `dribble`
 *    como ritual.bounces, cada uno con el balón en el suelo (z = BR) y tras él el balón vuelve a la altura de la mano;
 *    la duración del ritual en [minDur, maxDur]; 1-3 botes.
 *  - Humano: sin ritual (cpuTossIn -1, ritual.on false, ningún `dribble`).
 *  - Fuera del saque: cpuTossIn -1 y ritual apagado. */
function ritualChecker(label) {
  const R = VB.RITUAL, st = { serves: 0, cpu: 0, human: 0, dribbles: 0, minClock: 9, maxToss: 0, bad: 0, nb: [0, 0, 0, 0] };
  let cur = null;
  const bad = m => { if (st.bad++ < 4) fail(label + ' ritual: ' + m); };
  st.step = (g, evs) => {
    for (const e of evs) {
      if (e.type === 'serveReady') {
        st.serves++;
        const cpu = !S.isHuman(g, e.player), r = g.ritual;
        cur = { cpu, t0: e.t, last: g.cpuTossIn, n: 0, bounces: r.bounces, dur: r.dur, low: false, back: false };
        // (el primer serveReady lo emite createGame: se ve tras el primer paso, de ahí el + g.serveT)
        if (cpu) {
          st.cpu++;
          if (!r.on || r.player !== e.player || r.phase !== 'wait') bad('CPU sin ritual al poner el saque');
          if (!(r.bounces >= 1 && r.bounces <= 3)) bad('botes ' + r.bounces);
          if (!(r.dur >= R.minDur - 1e-9 && r.dur <= R.maxDur + 1e-9)) bad('duración ' + r.dur);
          if (!(Math.abs(g.cpuTossIn + g.serveT - Math.min(R.tossBy, g.whistleAt + r.dur)) < 1e-9) || Math.abs(g.timer - g.cpuTossIn) > 1e-9) bad('cpuTossIn ' + g.cpuTossIn + ' / timer ' + g.timer);
          st.nb[r.bounces]++;
        } else {
          st.human++;
          if (r.on || g.cpuTossIn !== -1) bad('humano con ritual (cpuTossIn ' + g.cpuTossIn + ')');
        }
      }
      if (e.type === 'dribble') {
        st.dribbles++;
        if (!cur || !cur.cpu) { bad('dribble sin saque de la CPU'); continue; }
        cur.n++;
        if (e.player !== g.server || Math.abs(g.ball.z - C.BR) > 1e-9) bad('dribble con el balón a ' + g.ball.z.toFixed(3) + ' m');
        if (e.n !== cur.n || e.of !== cur.bounces) bad('dribble ' + e.n + '/' + e.of + ' (contados ' + cur.n + '/' + cur.bounces + ')');
      }
      if (e.type === 'toss' && cur) {
        if (cur.cpu) {
          const tt = e.t - cur.t0;
          if (g.cpuTossIn !== 0) bad('cpuTossIn ' + g.cpuTossIn + ' en el toss');
          if (g.serveClock < 3) bad('lanzamiento con el reloj de saque en ' + g.serveClock.toFixed(2) + ' s');
          if (tt > R.tossBy + 1e-6 || Math.abs(tt - Math.min(R.tossBy, g.whistleAt + cur.dur)) > 1.5 * DT) bad('lanzamiento a los ' + tt.toFixed(3) + ' s (dur ' + cur.dur.toFixed(3) + ')');
          if (cur.n !== cur.bounces) bad(cur.n + ' dribbles de ' + cur.bounces);
          if (!cur.low || !cur.back) bad('el balón no bota (bajo ' + cur.low + ', vuelve ' + cur.back + ')');
          if (g.serveClock < st.minClock) st.minClock = g.serveClock; if (tt > st.maxToss) st.maxToss = tt;
        } else if (g.cpuTossIn !== -1) bad('cpuTossIn ' + g.cpuTossIn + ' en un toss humano');
        cur.tossed = true;
      }
    }
    if (g.mode === 'serve' && cur && !cur.tossed) {
      if (cur.cpu) {
        if (g.cpuTossIn > cur.last + 1e-9 || g.cpuTossIn < 0) bad('cpuTossIn no decrece: ' + cur.last + ' -> ' + g.cpuTossIn);
        cur.last = g.cpuTossIn;
        if (g.ritual.phase === 'dribble' && g.ball.z <= C.BR + 0.06) cur.low = true;
        if (cur.low && g.ritual.phase !== 'dribble' && g.ball.z >= R.relZ - 0.05) cur.back = true;
        if (g.serveState === 'ready' && g.ball.held !== g.server) bad('balón fuera de la mano del sacador durante el ritual');
      } else if (g.cpuTossIn !== -1 || g.ritual.on) bad('saque humano con cpuTossIn ' + g.cpuTossIn);
    } else if (g.mode !== 'serve' && (g.cpuTossIn !== -1 || g.ritual.on)) bad('cpuTossIn ' + g.cpuTossIn + ' / ritual en modo ' + g.mode);
  };
  return st;
}

/** Ejecuta `seconds` de juego. inputFn(g) devuelve la entrada humana o null. */
function run(label, opts, seconds, inputFn, quiet) {
  const g = S.createGame(Object.assign({ stats: true, seed: SEED }, opts));
  const ev = newCounters(), evs = [], serveTakeoff = [];
  let steps = Math.round(seconds / DT), lastSamePlayer = null, sameTouch = 0, matches = 0, setsSeen = 0, matchWins = [0, 0];
  let ghost = 0, stalePr = 0, lateSw = 0, blkSwitch = 0, spikeCtl = null; const fresh = {};
  const aiFaults = []; // dobles / 4 toques cometidos por la IA (equipo CPU o compañero IA del humano): deben ser 0
  const hls = [], sigs = {}, pf = { streakT: -1, streakN: 0, setPoint: -1, matchPoint: -1, issues: 0, digs: 0, maxDigs: 0 };
  const rit = ritualChecker(label);
  const t0 = Date.now();
  try {
    for (let i = 0; i < steps; i++) {
      const preSp = Math.hypot(g.ball.vx, g.ball.vy, g.ball.vz), preT = g.pr1.t; // lo que ve la sim al decidir el cambio
      S.step(g, DT, inputFn ? inputFn(g, i) : null);
      evs.length = 0; S.drainEvents(g, evs);
      rit.step(g, evs);
      for (const e of evs) {
        // campos de presentación del punto (SIM-01/02/03), contrastados con un recuento propio
        if (e.type === 'newSet' || e.type === 'newMatch') { pf.streakT = -1; pf.streakN = 0; }
        if (e.type === 'serveReady') { pf.setPoint = e.setPoint; pf.matchPoint = e.matchPoint; }
        // challenge (B2): el punto anulado se vuelve a pitar; el recuento propio vuelve al de antes de ese punto
        if (e.type === 'challenge') pf.rev = true;
        if (e.type === 'challengeResult') pf.rev = false;
        if (e.type === 'point') {
          if (pf.rev && pf.prev) { Object.assign(pf, pf.prev); pf.rev = false; }
          pf.prev = { streakT: pf.streakT, streakN: pf.streakN, setPoint: pf.setPoint, matchPoint: pf.matchPoint };
          if (pf.streakT === e.team) pf.streakN++; else { pf.streakT = e.team; pf.streakN = 1; }
          const eight = evs.some(x => x.type === 'courtChange' && x.why === 'eight');
          const bad = pointFieldIssues(e, g, { streak: pf.streakN, setPoint: pf.setPoint, matchPoint: pf.matchPoint, eight });
          if (Math.abs(g.timer - e.hold) > 1e-9) bad.push('g.timer ' + g.timer + ' != hold ' + e.hold);
          if (bad.length && pf.issues++ < 5) fail(label + ' campos del punto: ' + bad.join('; ') + ' ' + JSON.stringify({ reason: e.reason, how: e.how, text: e.text, score: e.score }));
          hls.push(e.highlight); sigs[e.signal] = (sigs[e.signal] || 0) + 1; pf.digs += e.digs; if (e.digs > pf.maxDigs) pf.maxDigs = e.digs;
        }
        if (!(e.type in ev)) fail('evento desconocido ' + e.type); else ev[e.type]++;
        if (!Number.isFinite(e.t)) fail('evento sin t ' + e.type);
        if (e.type === 'hit') {
          if (!(e.quality >= 0 && e.quality <= 1) || !e.grade) fail('hit sin calidad válida');
          if (e.kind !== 'serve') { if (lastSamePlayer === e.player && e.touch > 1) sameTouch++; lastSamePlayer = e.player; }
        }
        if (e.type === 'block') lastSamePlayer = null; // tras bloqueo se puede volver a tocar
        if (e.type === 'jump' && g.mode === 'serve' && g.serveJump) serveTakeoff.push(e.player.x * S.side(e.player.team));
        if (e.type === 'point') lastSamePlayer = null;
        if (e.type === 'point' && (e.reason === 'double' || e.reason === 'four')) {
          const ft = 1 - e.team, human = !g.demo && !g.autopilot && ft === 0 && e.player === g.ctrl;
          if (!human) aiFaults.push(e.reason + ' eq' + ft + ' t=' + e.t.toFixed(2));
        }
        if (e.type === 'point' && !(POINT_TEXTS[e.reason] || []).includes(e.text) && !badText.has(e.reason + e.text)) { badText.add(e.reason + e.text); fail(label + ' texto de punto fuera del vocabulario: ' + e.reason + ' "' + e.text + '"'); }
        if (e.type === 'match') { matches++; matchWins[e.team]++; }
        if (e.type === 'set') setsSeen++;
        // cambio automático con balón rápido a < 0,6 s del contacto (la cámara se deslizaría durante la defensa)
        if (e.type === 'switch' && e.auto && !e.reset && preSp > 12 && preT < 0.6 && g.mode === 'rally') lateSw++;
        // remate de la CPU con el humano en el bloqueo: el control no salta al defensor hasta el toque siguiente
        if (e.type === 'hit' && e.kind === 'spike' && e.team === 1 && !g.demo && !g.autopilot) spikeCtl = g.defRole === 'block' ? g.ctrl : null;
        // (solo cambios AUTOMÁTICOS: si el jugador pulsa CAMBIAR él mismo tras el remate, es su decisión; el fuzz lo hace al azar)
        if (e.type === 'switch' && e.auto && spikeCtl && e.from === spikeCtl && g.touchTeam === 1) blkSwitch++;
        if ((e.type === 'hit' && e.team === 0) || e.type === 'block' || e.type === 'point') spikeCtl = null;
      }
      // ningún remate atraviesa el volumen de manos de un bloqueador sin evento de bloqueo
      { const b = g.ball;
        if (g.mode === 'rally' && g.lastKind === 'spike' && Math.abs(b.x) <= 0.6 && g.blockCD <= 0)
          for (const q of g.players) if (q.z >= 0.15 && Math.abs(q.x) <= 1.1 && g.lastTeam !== q.team && Math.sign(b.vx) === S.side(q.team) && S._inBlockVol(q, b)) { ghost++; break; } }
      // tras un paso con toque, g.pr3/g.pr1 ya son las del balón nuevo
      if (g.mode === 'rally' && evs.some(e => e.type === 'hit' || e.type === 'block')) {
        S.predict(g, 3, fresh); if (Math.abs(fresh.x - g.pr3.x) + Math.abs(fresh.t - g.pr3.t) > 1e-9) stalePr++;
      }
      if (i % 60 === 0 && !checkInvariants(g, label)) break;
      if (opts.demo === false && g.finished) { // partido humano acabado: empezar otro
        // como main.js isRookie(): la ayuda del primer partido solo vale para el primero (SIMTEST_ROOKIE=all: en todos, para medirla)
        const ng = S.createGame(Object.assign({}, opts, { seed: SEED + i, stats: false, rookie: ROOKIE_MODE === 'all' ? opts.rookie : false }));
        ng.stats = g.stats; Object.assign(g, ng); g.stats = ng.stats;
      }
    }
  } catch (e) { fail(label + ' excepción: ' + (e && e.stack || e)); }
  const st = g.stats, r = st.rallies.slice().sort((a, b) => a - b);
  const med = r.length ? r[r.length >> 1] : 0, mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
  if (serveTakeoff.some(x => x < 9)) fail(label + ' saque en salto con despegue dentro del campo');
  if (!quiet) {
    console.log(`\n== ${label} (${(seconds / 60).toFixed(1)} min de juego, ${Date.now() - t0} ms reales) ==`);
    console.log('puntos', st.points, '(eq0', st.won[0], '/ eq1', st.won[1] + ')', '| sets cerrados', setsSeen, 'partidos', matches, JSON.stringify(matchWins));
    console.log('rally mediana', med.toFixed(2) + ' s', 'media', mean.toFixed(2) + ' s', 'p90', (r[Math.floor(r.length * 0.9)] || 0).toFixed(2) + ' s');
    console.log('toques', JSON.stringify(st.hits), 'bloqueos', st.blocks, JSON.stringify(st.blockKinds), 'planchas', st.dives);
    console.log('calidad', JSON.stringify(st.grades), 'humano', JSON.stringify(st.hgrades), 'fallos de gesto', st.misses);
    console.log('golpes', JSON.stringify(st.shots));
    console.log('motivos', JSON.stringify(st.why));
    console.log('cómo', JSON.stringify(st.how));
    console.log('eventos', JSON.stringify(ev));
    if (hls.length) {
      const hs = hls.slice().sort((a, b) => a - b), m = hs.reduce((a, b) => a + b, 0) / hs.length;
      console.log('highlight media', m.toFixed(3), 'p50', hs[hs.length >> 1].toFixed(2), 'p90', hs[Math.floor(hs.length * 0.9)].toFixed(2), 'máx', hs[hs.length - 1].toFixed(2),
        '>=0,55:', pct(hs.filter(h => h >= 0.55).length, hs.length), '| defensas de remate', pf.digs, '(máx. por punto ' + pf.maxDigs + ')', '| señales', JSON.stringify(sigs));
    }
    console.log('ritual (SIM-04): saques', rit.serves, '(CPU', rit.cpu, '/ humano', rit.human + ')', '| botes por saque', JSON.stringify(rit.nb.slice(1)),
      '| dribbles', rit.dribbles, '| lanzamiento CPU más tardío', rit.maxToss.toFixed(2) + ' s', '| reloj mínimo al lanzar', rit.cpu ? rit.minClock.toFixed(2) + ' s' : '-');
  }
  if (sameTouch) fail(label + ` mismo jugador tocó dos veces seguidas ${sameTouch} veces sin falta`);
  if (aiFaults.length) fail(label + ` la IA comete dobles/4 toques ${aiFaults.length} veces: ` + aiFaults.slice(0, 4).join(', '));
  if (ghost) fail(label + ` ${ghost} remates atraviesan las manos del bloqueador sin evento block`);
  if (stalePr) fail(label + ` g.pr3 vieja tras ${stalePr} toques`);
  if (lateSw) fail(label + ` ${lateSw} cambios automáticos de jugador con balón rápido a < 0,6 s del contacto`);
  if (blkSwitch) fail(label + ` el control salta del bloqueador al defensor ${blkSwitch} veces durante el ataque de la CPU`);
  const hlMean = hls.length ? hls.reduce((a, b) => a + b, 0) / hls.length : 0;
  if (rit.serves > 2 && !rit.cpu && !(opts.demo === false && !opts.autopilot && inputFn)) fail(label + ' ritual: ningún saque de la CPU');
  return { g, st, ev, med, mean, matches, setsSeen, matchWins, hlMean, hls, rit };
}

// ---------- Probabilidad de partido a partir de la de punto (sets 25/25/15, dif. 2) ----------
function setWinProb(p, target) {
  const memo = new Map();
  function f(a, b) {
    if (a >= target && a - b >= 2) return 1; if (b >= target && b - a >= 2) return 0;
    if (a >= target - 1 && b >= target - 1 && a === b) { const q = 1 - p; return p * p / (p * p + q * q); } // deuce
    const k = a + ',' + b; if (memo.has(k)) return memo.get(k);
    const v = p * f(a + 1, b) + (1 - p) * f(a, b + 1); memo.set(k, v); return v;
  }
  return f(0, 0);
}
/** Estadística de la matriz (SIM-05), medida con 80 semillas × 20 min por casilla (8-nov-2026, `SIMTEST_ONLY=matrix node tools/simtest.js 0 <s> 20 1`,
 *  s = 1..80): [media de % de puntos, desviación típica de UNA semilla de 20 min]. Las bandas y diferencias mínimas se abren con el
 *  ruido real de la muestra: σ de la media = sd / √(semillas × minutos/20), banda = objetivo ± k·σ (k = 3,5: ~2·10⁻⁴ de falso fallo
 *  por comprobación). Las bandas fijas de antes (p. ej. novato/Fácil 0,40-0,51 con 4 semillas) tenían el borde a ~1,6σ de la media:
 *  remuestreando esas 80 semillas, el 14,7 % de las semillas del simtest fallaba la matriz sin haber cambiado nada (semillas 3 y 99);
 *  con esto, el 0,09 %. Las casillas de `key` juegan el doble de semillas para que su banda no se abra tanto.
 *  Si se recalibra la IA, volver a medir (tools/out: bucle de semillas + media y sd por casilla) y actualizar esta tabla. */
const MATRIX_STAT = {
  k: 3.5,
  key: new Set(['novato:easy', 'novato:normal', 'medio:normal', 'medio:hard', 'auto:normal', 'auto:hard']),
  sd: { 'novato:easy': [0.470, 0.051], 'novato:normal': [0.363, 0.052], 'medio:normal': [0.514, 0.053], 'medio:hard': [0.401, 0.040],
    'medio:expert': [0.238, 0.038], 'auto:normal': [0.592, 0.044], 'auto:hard': [0.495, 0.043], 'auto:expert': [0.250, 0.039] }
};
const mxN = (k) => (MATRIX_STAT.key.has(k) ? 2 : 1) * NSEED * BOTMIN / 20;
const mxSd = (k) => MATRIX_STAT.sd[k][1] / Math.sqrt(mxN(k));
/** Diferencia mínima exigida entre dos casillas: la de diseño `want`, salvo que la media medida menos k·σ quede por debajo. */
const mxGap = (a, b, want) => Math.min(want, MATRIX_STAT.sd[a][0] - MATRIX_STAT.sd[b][0] - MATRIX_STAT.k * Math.hypot(mxSd(a), mxSd(b)));
function matchWinProb(p) { const s = setWinProb(p, 25), t = setWinProb(p, 15); return s * s + 2 * s * (1 - s) * t; }

// ================= 4) Bots humanos (solo entrada real) =================
/* Modelo de jugador humano en TERCERA PERSONA (revisión 3). Antes los bots veían la jugada casi perfecta
 * (reacción fija, error de posición pequeño y constante): el equilibrio salía demasiado fácil. Ahora:
 *  react/rlog: reacción tras cada toque ~ lognormal (mediana react, dispersión rlog) + despistes (lapse)
 *  posErr:     error de lectura del punto de juego (m) que CRECE con el tiempo de vuelo que queda y con la
 *              distancia al balón y se corrige al acercarse; en profundidad (eje de la cámara) es depth× mayor
 *  wrong:      prob. de mala lectura (corto/largo al revés) que se corrige tarde (0,3-0,6 s)
 *  sigma/bias: timing de la pulsación (s); bias > 0 = tiende a pulsar pronto; fast = σ extra con balón rápido
 *  acc:        cambio máximo del stick por segundo (inercia del pulgar/teclas); stop = holgura al pararse (m)
 *  jumpOk:     prob. de acordarse de saltar para rematar (novato: a veces ataca desde el suelo)
 *  block, jumpServe, aim, gap: bloquea, saque en salto, apunta al azar, busca el hueco en el remate
 *  rookie:     primera sesión (createGame rookie:true: ayuda de Fácil y la CPU saca suave)
 *  camYaw:     error (grados, σ) del mapeo stick-cámara tras cada cambio de jugador: la cámara se desliza al nuevo
 *              jugador y el pulgar sigue con la referencia vieja; se corrige en 0,5 s
 *  netJump:    prob. por ataque rival de ir a la red a "bloquear" (sin saber: deja el campo y salta a destiempo)
 *  misSwitch:  prob. por trayectoria de pulsar CAMBIAR sin querer (en la colocación rival cambia el rol bloqueo/defensa)
 * El perfil 'perfecto' es la cota superior (casi sin errores de percepción): sirve para comprobar que la
 * habilidad cuenta y que Experto se puede ganar. */
const BOTS = {
  perfecto: { react: 0.13, rlog: 0.1, lapse: 0, posErr: 0.12, depth: 1.1, wrong: 0, sigma: 0.02, bias: 0, fast: 0, acc: 40, stop: 0.08, jumpOk: 1, block: true, jumpServe: 0.7, aim: 0.8, gap: 0.6 },
  bueno: { react: 0.2, rlog: 0.2, lapse: 0.02, posErr: 0.45, depth: 1.4, wrong: 0.02, sigma: 0.045, bias: 0.01, fast: 0.3, acc: 12, stop: 0.1, jumpOk: 0.98, block: true, jumpServe: 0.5, aim: 0.6, gap: 0.45 },
  medio: { react: 0.26, rlog: 0.25, lapse: 0.05, posErr: 0.8, depth: 1.5, wrong: 0.06, sigma: 0.07, bias: 0.02, fast: 0.4, acc: 8, stop: 0.14, jumpOk: 0.93, block: true, jumpServe: 0.3, aim: 0.45, gap: 0.2 },
  novato: { react: 0.34, rlog: 0.3, lapse: 0.1, posErr: 1.2, depth: 1.6, wrong: 0.12, sigma: 0.11, bias: 0.04, fast: 0.5, acc: 5, stop: 0.2, jumpOk: 0.75, block: false, jumpServe: 0.05, aim: 0.15, gap: 0, rookie: true,
    camYaw: 22, netJump: 0.1, misSwitch: 0.01 } // solo el novato: medio/bueno/perfecto sin cambios (matriz comparable)
};
/** Dirección de apuntado (unitaria, mundo) que manda el remate más lejos de los defensores de la CPU y,
 *  como haría un jugador que mira la jugada, por fuera de las manos del bloqueador rival si está arriba.
 *  El simulador apunta a: centro del campo rival (5 m) + dir * (3 ; 3,7) (sim.js attackTarget). */
function gapAim(g, p, out) {
  let best = -1e9, blk = null;
  for (const q of g.teams[1]) if (q.z > 0.15 && Math.abs(q.x) < 1.2 && (!blk || Math.abs(q.y - p.y) < Math.abs(blk.y - p.y))) blk = q;
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a);
    const tx = Math.max(-8.3, Math.min(-1.4, -5 + ux * 3)), ty = Math.max(-3.9, Math.min(3.9, uy * 3.7));
    let m = 99; for (const q of g.teams[1]) m = Math.min(m, Math.hypot(q.x - tx, q.y - ty));
    let sc = m - (Math.abs(ty) > 3.4 ? 0.8 : 0) - (tx < -7.8 ? 0.6 : 0);
    if (blk) { const y0 = p.y + (ty - p.y) * (0 - p.x) / (tx - p.x), gb = Math.abs(y0 - blk.y); if (gb < 0.9) sc -= 3 * (1 - gb / 0.9); }
    if (sc > best) { best = sc; out[0] = ux; out[1] = uy; }
  }
  return out;
}
/** opt.six (6v6 con humano, 11-nov-2026): el personaje ya no se mueve solo, así que sin balón suyo el bot va él mismo a su sitio
 *  de la formación (VB.AI6.spot: recepción, batida, cobertura, bloqueo de zona, defensa perímetro) con su reacción, su error de
 *  lectura y la inercia del stick, y solo sube a bloquear si su sitio es de bloqueo. Sin opt, el bot de siempre (matriz 2v2).
 *  opt.role (lote A): puesto del humano. Con 'S' (colocador) el 2º toque de su equipo es suyo: sigue yendo a su sitio (VB.AI6.spot,
 *  el punto de colocación) y de ahí al balón cuando lo lee (pase alto: poco error), y al golpear de 2º empuja el stick en una de las
 *  4 direcciones (al azar: VB.AI6.laneOf elige el carril). Los demás puestos, igual que sin role. */
function makeBot(bp, seed, opt) {
  const six = !!(opt && opt.six), role = six && opt.role || '';
  const LANES = [[1, 0], [-1, 0], [0, 1], [0, -1]]; let laneV = null; // stick del colocador bot en su 2º toque (mundo; laneOf lo pasa a local)
  const rng = S._makeRng(seed), gauss = () => (rng() + rng() + rng() + rng() - 2) * 1.732;
  const mv = [0, 0], want = [0, 0], aimv = [0, 0], out = { move: mv, hit: false, jump: false, switchPlayer: false };
  let stamp = -9, lead = 0, jlead = 0, eu = 0, ev = 0, presses = 0, useAim = false, useGap = false, serveWait = 0;
  let react = 0, wrongT = 0, wrongD = 0, jumpOk = true, blockT = 0, blockSeen = -1;
  let lastCtrl = null, yawE = 0, yawT = 0, naive = false; const mvOut = [0, 0], aimSt = [0, 0];
  const w = {}, DT2 = DT;
  // reacción: lognormal con mediana bp.react (+ despiste ocasional)
  const sampleReact = () => bp.react * Math.exp(gauss() * bp.rlog) + (rng() < bp.lapse ? 0.2 + rng() * 0.3 : 0);
  return (g) => {
    const p = g.ctrl, sd = 1; out.hit = out.jump = out.switchPlayer = false; out.move = mv;
    if (p !== lastCtrl) { if (lastCtrl && bp.camYaw) { yawE = gauss() * bp.camYaw * Math.PI / 180; yawT = g.time; } lastCtrl = p; }
    if (g.mode === 'serve') {
      mv[0] = mv[1] = 0; want[0] = want[1] = 0;
      if (g.server !== p) return out;
      if (g.serveState === 'ready') {
        if (g.serveT < 0.05) serveWait = 0.6 + rng() * 2;
        if (g.serveT > serveWait) { if (rng() < bp.jumpServe) out.jump = true; else out.hit = true; }
        return out;
      }
      if (stamp !== g.lastTouchT) {
        stamp = g.lastTouchT; lead = C.WINDUP + bp.bias + gauss() * bp.sigma; presses = 0;
        const a = rng() * 6.283; aimv[0] = Math.cos(a); aimv[1] = Math.sin(a); useAim = rng() < bp.aim;
      }
      S.hitWindow(g, p, w);
      if (g.aim3 && g.aim3.on && g.aim3.kind === 'serve') {
        // saque dirigible: lleva la diana con el stick al punto que antes elegía con la dirección (centro a 6 m + dir * (2,4 ; 3,4))
        const tx = -Math.max(2, Math.min(8.4, 6 - (useAim ? aimv[0] * 2.4 : 0))), ty = useAim ? Math.max(-4, Math.min(4, aimv[1] * 3.4)) : 0;
        const dx = tx - g.aim3.x, dy = ty - g.aim3.y, d = Math.hypot(dx, dy), f = d > 1e-6 ? Math.min(1, d / 0.25) / d : 0;
        aimSt[0] = dx * f; aimSt[1] = dy * f; out.move = aimSt;
      } else if (useAim) out.move = aimv;
      if (presses < 2 && !g.swingLive && w.t <= lead) { out.hit = true; presses++; }
      return out;
    }
    if (g.mode !== 'rally') { mv[0] = mv[1] = 0; want[0] = want[1] = 0; return out; }
    const b = g.ball, bsp = Math.hypot(b.vx, b.vy, b.vz);
    if (stamp !== g.lastTouchT) { // nueva trayectoria: nueva lectura
      stamp = g.lastTouchT; presses = 0;
      react = sampleReact();
      const sg = bp.sigma * (1 + bp.fast * Math.max(0, Math.min(1, (bsp - 9) / 8))); // balón rápido = timing peor
      lead = C.WINDUP + bp.bias + gauss() * sg; jlead = bp.bias * 0.5 + gauss() * sg * 0.9;
      eu = gauss(); ev = gauss();
      wrongD = rng() < bp.wrong ? (rng() < 0.5 ? -1 : 1) * (1.3 + rng() * 1.2) : 0; // corto/largo al revés
      wrongT = react + 0.3 + rng() * 0.3;
      jumpOk = rng() < bp.jumpOk;
      const a = rng() * 6.283; aimv[0] = Math.cos(a); aimv[1] = Math.sin(a); useAim = rng() < bp.aim; useGap = rng() < (bp.gap || 0);
      naive = !bp.block && g.touchTeam === 1 && g.touches === 2 && rng() < (bp.netJump || 0); // "bloqueo" de novato
      if (bp.misSwitch && rng() < bp.misSwitch) out.switchPlayer = true;
    }
    const since = g.time - g.lastTouchT, job = g.jobs[0] === p;
    const set2 = role === 'S' && job && g.touchTeam === 0 && g.touches === 1; // colocador bot: el 2º toque es suyo
    const sp6 = six && (!job || set2) ? VB.AI6.spot(g, p) : null, sp6x = sp6 ? sp6.x : 0, sp6y = sp6 ? sp6.y : 0, sp6b = !!(sp6 && sp6.block);
    const blocks = six ? sp6b : bp.block || naive || g.defRole === 'block'; // con CAMBIAR en la colocación rival el juego le pide bloquear
    if (g.swingLive && p.z > 0 && (useGap || useAim)) out.move = aimv; // en el aire mantiene la dirección mientras dura el gesto
    let tx = p.x, ty = p.y;
    const attack = job && g.touchTeam === 0 && g.touches === 2 && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5;
    if (set2) { // colocador: en su punto de colocación hasta leer el pase; luego al balón (si el pase viene a él, se queda quieto)
      const pr = g.pr1;
      if (since < react || Math.hypot(pr.x - sp6x, pr.y - sp6y) < 0.7) { tx = sp6x; ty = sp6y; } else { tx = pr.x + 0.15; ty = pr.y; }
      tx += eu * bp.posErr * 0.15; ty += ev * bp.posErr * 0.15;
    } else if (job) {
      const pr = attack ? g.pr3 : g.pr1;
      if (attack) { tx = pr.x + 0.35 * sd; ty = pr.y; } else { tx = pr.x + 0.15; ty = pr.y; }
      // error de lectura: crece con el vuelo que queda y la distancia; en profundidad (eje de la cámara) es mayor
      const dist = Math.hypot(pr.x - p.x, pr.y - p.y), tr = Math.max(0, pr.t);
      const s = bp.posErr * (0.22 + 0.55 * Math.min(1.6, tr / 1.1) + 0.06 * Math.min(8, dist));
      tx += eu * s * 0.5 * bp.depth; ty += ev * s * 0.5;
      if (wrongD && since < wrongT) tx += wrongD;
    } else if (six) { tx = sp6x + eu * bp.posErr * 0.25; ty = sp6y + ev * bp.posErr * 0.25; if (sp6b) tx = sp6x; } // 6v6: a su sitio (lee el bloqueo sin error de profundidad)
    else if (g.defRole === 'dig' && g.touchTeam === 1 && !naive) { tx = 5.4; ty = Math.max(-2, Math.min(2, -g.pr3.y * 0.3)); } // el juego le da la defensa
    else if (blocks && g.touchTeam === 1 && g.touches === 2 && g.pr3.x < 0) { tx = 0.6; ty = g.pr3.y + ev * bp.posErr * 0.4; } // lee el ataque con error
    else if (!job) { tx = 6; ty = -g.teams[0][g.ctrl.idx ? 0 : 1].y * 0.5; }
    // hasta reaccionar sigue con lo que hacía (no se para en seco); luego va al punto leído con inercia del stick
    if (since >= react && p.z === 0) {
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d > bp.stop) { const f = Math.min(1, d / 0.3); want[0] = dx / d * f; want[1] = dy / d * f; } else { want[0] = want[1] = 0; }
    }
    { const k = bp.acc * DT2, ddx = want[0] - mv[0], ddy = want[1] - mv[1], dl = Math.hypot(ddx, ddy);
      if (dl <= k) { mv[0] = want[0]; mv[1] = want[1]; } else { mv[0] += ddx / dl * k; mv[1] += ddy / dl * k; } }
    if (job && since >= react * 0.6) {
      S.hitWindow(g, p, w);
      if (attack && jumpOk && p.z === 0 && w.attack && w.jumpT <= jlead && Math.hypot(g.pr3.x + 0.35 - p.x, g.pr3.y - p.y) < 1.3) out.jump = true;
      const near = Math.hypot(b.x - p.x, b.y - p.y) < 2.6;
      if (near && !(attack && jumpOk && p.z === 0 && w.jumpT > -0.2) && presses < 2 && !g.swingLive && w.t <= lead) {
        out.hit = true; presses++;
        if (set2) { laneV = LANES[Math.floor(rng() * 4) % 4]; out.move = laneV; } // colocador: elige carril con el stick (laneOf)
        else if (useGap && p.z > 0.25) { gapAim(g, p, aimv); out.move = aimv; } // remate: busca el hueco
        else if (useAim) out.move = aimv;
      }
    }
    if (set2 && laneV && g.swingLive) out.move = laneV; // mantiene el stick hasta que el gesto llega al balón (sim.hit lee la dirección ahí)
    else if (!set2) laneV = null;
    // bloqueo: salta cuando VE despegar al rematador rival (con su reacción y su error de timing)
    if (blocks && !job && p.z === 0 && Math.abs(p.x) < 1.2 && g.touchTeam === 1 && g.touches === 2) {
      const att = g.teams[1].some(q => q.z > 0.35 && q.vz < 1.5 && Math.abs(q.x) < 4);
      if (att && blockSeen !== stamp) { blockSeen = stamp; blockT = g.time + Math.max(0, bp.react * 0.35 + gauss() * bp.sigma * (naive ? 2.4 : 1.2)); }
      if (att && g.time >= blockT) out.jump = true;
    }
    // remate con mira libre (A1): en el aire lleva la mira (g.aim3) hacia el punto que quiere (hueco o dirección elegida,
    // con el mismo mapeo de antes: centro a 5 m + dir * (3 ; 3,7)); sin apuntar suelta el stick (diagonal por defecto)
    if (g.aim3 && g.aim3.on && g.ctrl === p) {
      if (useGap || useAim) {
        if (useGap) gapAim(g, p, aimv);
        const tx = Math.max(-8.3, Math.min(-1.4, -5 + aimv[0] * 3)), ty = Math.max(-3.9, Math.min(3.9, aimv[1] * 3.7));
        const dx = tx - g.aim3.x, dy = ty - g.aim3.y, d = Math.hypot(dx, dy), f = d > 1e-6 ? Math.min(1, d / 0.25) / d : 0;
        aimSt[0] = dx * f; aimSt[1] = dy * f; out.move = aimSt;
      } else { aimSt[0] = aimSt[1] = 0; out.move = aimSt; }
    }
    // cámara recién deslizada a otro jugador: el stick va girado yawE (se corrige en 0,5 s)
    if (yawE && out.move === mv) {
      const k = 1 - (g.time - yawT) / 0.5;
      if (k <= 0) yawE = 0;
      else { const a = yawE * k, c = Math.cos(a), s2 = Math.sin(a); mvOut[0] = mv[0] * c - mv[1] * s2; mvOut[1] = mv[0] * s2 + mv[1] * c; out.move = mvOut; }
    }
    return out;
  };
}
function topWhy(w) { return Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k.replace(/^(.{24}).*/, '$1') + ':' + v); }

// ================= Calibración del highlight (SIM-05) =================
/** Un partido COMPLETO de demo (CPU vs CPU, perfil DIFF.demo) con todas las comprobaciones de los campos del punto y del ritual.
 *  Devuelve los puntos compactos [highlight, conPuntoDeSet, how, signal, landSide, hold, clutch, reason] y una TRAZA de todo lo
 *  que la presentación consume (marcador, highlight, señal, campo del bote, pausa, final apretado, defensas, racha y cada bote
 *  del ritual con su velocidad) para la prueba de determinismo: misma semilla -> la misma traza, carácter a carácter. */
function runHlMatch(j) {
  const label = 'calibración del highlight (semilla ' + j.seed + ')';
  const g = S.createGame({ demo: true, seed: j.seed, stats: true }), rit = ritualChecker(label), evs = [];
  const pf = { streakT: -1, streakN: 0, setPoint: -1, matchPoint: -1, issues: 0 }, pts = [], trace = [];
  let done = false, dribbles = 0, bounces = 0;
  try {
    for (let i = 0; i < 70 * 60 * C.SIM_HZ && !done; i++) {
      S.step(g, DT, null); evs.length = 0; S.drainEvents(g, evs); rit.step(g, evs);
      for (const e of evs) {
        if (e.type === 'newSet' || e.type === 'newMatch') { pf.streakT = -1; pf.streakN = 0; }
        if (e.type === 'serveReady') { pf.setPoint = e.setPoint; pf.matchPoint = e.matchPoint; if (g.ritual.on) bounces += g.ritual.bounces; }
        if (e.type === 'dribble') { dribbles++; trace.push('d' + e.n + '/' + e.of + '@' + e.speed); }
        // challenge (B2): el punto anulado se vuelve a pitar; el recuento propio vuelve al de antes de ese punto
        if (e.type === 'challenge') pf.rev = true;
        if (e.type === 'challengeResult') pf.rev = false;
        if (e.type === 'point') {
          if (pf.rev && pf.prev) { Object.assign(pf, pf.prev); pf.rev = false; }
          pf.prev = { streakT: pf.streakT, streakN: pf.streakN, setPoint: pf.setPoint, matchPoint: pf.matchPoint };
          if (pf.streakT === e.team) pf.streakN++; else { pf.streakT = e.team; pf.streakN = 1; }
          const eight = evs.some(x => x.type === 'courtChange' && x.why === 'eight');
          const bad = pointFieldIssues(e, g, { streak: pf.streakN, setPoint: pf.setPoint, matchPoint: pf.matchPoint, eight });
          if (Math.abs(g.timer - e.hold) > 1e-9) bad.push('g.timer ' + g.timer + ' != hold ' + e.hold);
          if (bad.length && pf.issues++ < 5) fail(label + ' campos del punto: ' + bad.join('; ') + ' ' + JSON.stringify({ reason: e.reason, how: e.how, score: e.score }));
          pts.push([e.highlight, pf.setPoint !== -1 ? 1 : 0, e.how, e.signal, e.landSide, e.hold, e.clutch ? 1 : 0, e.reason]);
          trace.push(e.score.join('-') + '|' + e.how + '|' + e.highlight + '|' + e.signal + '|' + e.landSide + '|' + e.hold + '|' + (e.clutch ? 1 : 0) + '|' + e.digs + '|' + e.streak);
        }
        if (e.type === 'match') done = true;
      }
      if (i % 60 === 0 && !checkInvariants(g, label)) break;
    }
  } catch (e) { fail(label + ' excepción: ' + (e && e.stack || e)); }
  if (!done) fail(label + ': el partido no acaba en 70 min de juego');
  return { kind: 'hl', seed: j.seed, pts, trace: trace.join(';'), dribbles, bounces, cpuServes: rit.cpu, serves: rit.serves, failures };
}
/** Banda calibrada (SIM-05): en 20 partidos CPU vs CPU, entre el 15 y el 25 % de los puntos con highlight >= VB.HOLD.bigAt (la
 *  cinta grande y la pausa larga) y menos del 5 % >= 0,8 fuera de los puntos de set/partido. Medido con 160 partidos de demo
 *  (8-nov-2026): 19,6 % (grupos de 20 partidos: 17,6-20,9; σ ≈ 1,1 puntos) y 3,2 %. */
const HL_CAL = { matches: 20, bigLo: 0.15, bigHi: 0.25, topAt: 0.8, topMax: 0.05 };
function hlCalibration(res) {
  const pts = [].concat(...res.map(r => r.pts)), n = pts.length, H = VB.HOLD;
  const big = pts.filter(p => p[0] >= H.bigAt).length / n, nsp = pts.filter(p => !p[1]), top = nsp.filter(p => p[0] >= HL_CAL.topAt).length / Math.max(1, nsp.length);
  const hist = new Array(10).fill(0); for (const p of pts) hist[Math.min(9, Math.floor(p[0] * 10 + 1e-9))]++;
  console.log('\n== Calibración del highlight (SIM-05): ' + res.length + ' partidos completos CPU vs CPU (demo), ' + n + ' puntos ==');
  for (let i = 0; i < 10; i++) console.log('  ' + (i / 10).toFixed(1) + '-' + ((i + 1) / 10).toFixed(1) + ' ' + String(hist[i]).padStart(5) + ' ' + pct(hist[i], n).padStart(6) + ' ' + '#'.repeat(Math.round(60 * hist[i] / n)));
  const per = res.map(r => r.pts.filter(p => p[0] >= H.bigAt).length / Math.max(1, r.pts.length)).sort((a, b) => a - b);
  const howBig = {}, sig = {}, land = { 0: 0, 1: 0, '-1': 0 }, holds = {}; let clutch = 0;
  for (const p of pts) { if (p[0] >= H.bigAt) howBig[p[2]] = (howBig[p[2]] || 0) + 1; sig[p[3]] = (sig[p[3]] || 0) + 1; land[p[4]]++; holds[p[5]] = (holds[p[5]] || 0) + 1; if (p[6]) clutch++; }
  console.log('  >= ' + H.bigAt + ': ' + pct(big * 1000, 1000) + ' (objetivo ' + 100 * HL_CAL.bigLo + '-' + 100 * HL_CAL.bigHi + ' %; por partido ' + pct(per[0] * 1000, 1000) + '-' + pct(per[per.length - 1] * 1000, 1000) + ')' +
    ' | >= ' + HL_CAL.topAt + ' sin punto de set/partido: ' + pct(top * 1000, 1000) + ' (máx. ' + 100 * HL_CAL.topMax + ' %) | final apretado ' + pct(clutch, n) + ' | grandes por cómo ' + JSON.stringify(howBig));
  console.log('  señales ' + JSON.stringify(sig) + ' | landSide ' + JSON.stringify(land) + ' | pausas ' + JSON.stringify(holds));
  const dr = res.reduce((a, r) => a + r.dribbles, 0), bo = res.reduce((a, r) => a + r.bounces, 0), cs = res.reduce((a, r) => a + r.cpuServes, 0), sv = res.reduce((a, r) => a + r.serves, 0);
  console.log('  ritual: ' + sv + ' saques (' + cs + ' de la CPU), ' + bo + ' botes programados, ' + dr + ' eventos dribble');
  const f0 = failures;
  if (!(big >= HL_CAL.bigLo && big <= HL_CAL.bigHi)) fail('calibración del highlight: ' + pct(big * 1000, 1000) + ' de puntos >= ' + H.bigAt + ' (objetivo ' + 100 * HL_CAL.bigLo + '-' + 100 * HL_CAL.bigHi + ' %)');
  if (!(top < HL_CAL.topMax)) fail('calibración del highlight: ' + pct(top * 1000, 1000) + ' de puntos >= ' + HL_CAL.topAt + ' fuera de punto de set/partido (máx. ' + 100 * HL_CAL.topMax + ' %)');
  // cobertura de los campos nuevos en partido real: las tres señales de bote, los dos campos y -1 sin bote, pausas de la tabla
  for (const k of ['in', 'out', 'touched']) if (!sig[k]) fail('calibración: ninguna señal ' + k + ' en ' + n + ' puntos');
  if (!land[0] || !land[1] || !land['-1']) fail('calibración: landSide sin los tres valores ' + JSON.stringify(land));
  const okHold = [VB.RITUAL.demoHold, VB.RITUAL.demoHold + 1.4, 3.6, 2.2];
  for (const h in holds) if (!okHold.some(x => Math.abs(x - h) < 1e-9)) fail('calibración: pausa ' + h + ' fuera de la tabla de la demo');
  if (!holds[3.6] || !holds[2.2]) fail('calibración: faltan pausas de set (3,6) o de partido (2,2): ' + JSON.stringify(holds));
  // ritual: todos los saques de la demo son de la CPU, con un `dribble` por cada bote programado
  // (la demo bota VB.RITUAL.demoBounces veces: hoy 1, así que dribbles >= saques)
  if (cs !== sv || !(dr >= sv * VB.RITUAL.demoBounces) || dr !== bo) fail('calibración: ritual ' + JSON.stringify({ saques: sv, cpu: cs, botes: bo, dribbles: dr }));
  if (failures === f0) console.log('  calibración del highlight y cobertura de señal/landSide/pausa/ritual/dribble OK');
}

/** Trabajo de una casilla de la matriz (se ejecuta en un worker). */
function runJob(j) {
  if (j.kind === 'hl') return runHlMatch(j);
  const opts = j.kind === 'auto' ? { demo: false, autopilot: true, difficulty: j.diff, seed: j.seed } :
    { demo: false, difficulty: j.diff, serveClock: true, seed: j.seed, rookie: !!BOTS[j.bot].rookie && ROOKIE_MODE !== 'off' };
  const r = run(j.label, opts, j.seconds, j.kind === 'bot' ? makeBot(BOTS[j.bot], j.seed * 7 + 3) : null, true);
  return { label: j.label, kind: j.kind, bot: j.bot, diff: j.diff, won0: r.st.won[0], points: r.st.points, med: r.med,
    hits: r.st.hits, how: r.st.how, blocks: r.st.blocks, dives: r.st.dives, misses: r.st.misses, hgrades: r.st.hgrades, why: r.st.why,
    matchWins: r.matchWins, failures };
}
function runMatrix(jobs) {
  const n = Math.max(1, Math.min(jobs.length, (os.cpus().length || 2) - 1, 15)), out = new Array(jobs.length);
  let next = 0;
  return new Promise((resolve) => {
    let alive = 0;
    const spawn = () => {
      if (next >= jobs.length) { if (!alive) resolve(out); return; }
      const k = next++; alive++;
      const w = new Worker(__filename, { workerData: jobs[k], argv: process.argv.slice(2) });
      w.on('message', (m) => { out[k] = m; });
      w.on('error', (e) => { fail('worker ' + jobs[k].label + ': ' + (e && e.stack || e)); });
      w.on('exit', () => { alive--; spawn(); });
    };
    for (let i = 0; i < n; i++) spawn();
  });
}

async function main() {
// ================= 1) CPU vs CPU =================
if (ONLY !== 'matrix') {
const demo = run('CPU vs CPU (demo del menú, perfil DIFF.demo)', { demo: true }, MIN * 60);
  const { st, ev, med } = demo;
  if (st.points < MIN * 4.5) fail('muy pocos puntos en demo: ' + st.points);
  if (st.hits.pass < 20 || st.hits.set < 10 || st.hits.spike < 5) fail('faltan pases/colocaciones/remates');
  if (st.blocks < 1) fail('ningún bloqueo en demo');
  if (med < 2.5 || med > 9) fail('mediana de rally fuera de rango: ' + med);
  if (ev.point !== st.points) fail('eventos point != puntos');
  // un partido a 3 sets puede pasar de 120 puntos (~25 min): basta con un partido completo o dos sets cerrados
  if (MIN >= 15 && demo.matches < 1 && demo.setsSeen < 2) fail('ningún partido completo ni dos sets en demo');
  const f = st.won[0] / st.points; if (f < 0.3 || f > 0.7) fail('reparto de puntos desequilibrado en demo ' + f.toFixed(2));
  // remates que acaban en punto (CPU vs CPU): ni todo remate es punto ni la defensa lo saca todo (objetivo ~45-55 %)
  // Banda 0,38-0,65 para una demo de 20 min (~165 remates: ±3,5σ de muestreo alrededor de 0,515). En carreras más
  // cortas el ruido crece como 1/√n: la banda se ensancha en la misma proporción (10 min, ~80 remates: 0,32-0,71).
  // Medido (R6, 105 semillas): 20 min 41-61 %, 10 min 38-65 % con el mismo perfil (σ 3,9 y 5,5 puntos).
  { const sp = st.spikes[0] + st.spikes[1], kr = (st.kills[0] + st.kills[1]) / Math.max(1, sp);
    const kh = 0.135 * Math.max(1, Math.sqrt(165 / Math.max(1, sp))), klo = 0.515 - kh, khi = 0.515 + kh;
    if (sp > 40 && (kr < klo || kr > khi)) fail('remates que son punto fuera de rango: ' + (100 * kr).toFixed(0) + '% (banda ' + (100 * klo).toFixed(0) + '-' + (100 * khi).toFixed(0) + ' % con ' + sp + ' remates)');
    else console.log('remates que son punto (demo): ' + (100 * kr).toFixed(0) + '% de ' + sp); }
  const wf = Object.entries(st.why); const inPts = wf.filter(([k]) => /cae en/.test(k)).reduce((a, [, v]) => a + v, 0);
  // Media medida 0,72 (40 semillas × 20 min, ~115 puntos). El mínimo 0,55 está a ~4σ binomial con 115 puntos;
  // en pruebas cortas se abre con √(115/n) para mantener la misma tasa de falso fallo (p. ej. 10 min ≈ 0,48).
  const ilo = 0.72 - 0.17 * Math.max(1, Math.sqrt(115 / Math.max(1, st.points)));
  if (inPts / st.points < ilo) fail('demasiados puntos por error (no por balón dentro): ' + pct(inPts, st.points) + ' (mínimo ' + (100 * ilo).toFixed(0) + ' % con ' + st.points + ' puntos)');
  // SIM-01/05: cordura del highlight en ESTA demo (no son 20 partidos: la banda calibrada 15-25 % va en «Calibración del
  // highlight», más abajo). Medido (SIM-05, 160 partidos de demo): media 0,337 (σ por partido 0,033), puntos grandes 19,6 %
  // (σ por partido 4,8 puntos, mínimo 5,8 %, máximo 35,3 %). Topes a 4σ de un partido de ~110 puntos, abiertos con √(110/n).
  { const n = Math.max(1, demo.hls.length), k = Math.max(1, Math.sqrt(110 / n)), big = demo.hls.filter(h => h >= VB.HOLD.bigAt).length / n;
    const hlMax = 0.337 + 4 * 0.033 * k, bigMax = 0.196 + 4 * 0.048 * k;
    if (!(demo.hlMean <= hlMax)) fail('highlight medio de la demo ' + demo.hlMean.toFixed(3) + ' > ' + hlMax.toFixed(3) + ' (' + n + ' puntos)');
    // suelo solo con >= 100 puntos (0 grandes en un partido entero sería que la fórmula no puntúa nada)
    else if (!((n < 100 || big > 0.01) && big < bigMax)) fail('puntos grandes (highlight >= ' + VB.HOLD.bigAt + ') en la demo: ' + pct(big * 1000, 1000) + ' (cordura 1-' + (100 * bigMax).toFixed(0) + ' %)');
    else console.log('highlight medio de la demo ' + demo.hlMean.toFixed(3) + ' (tope ' + hlMax.toFixed(3) + ' con ' + n + ' puntos), puntos grandes ' + (100 * big).toFixed(1) + ' % OK'); }
}

// ================= 3) Fuzz: entrada humana aleatoria =================
if (ONLY !== 'matrix') {
  const rng = S._makeRng(SEED ^ 0xabc), held = [0, 0];
  run('Fuzz humano aleatorio', { demo: false }, 8 * 60, (g, i) => {
    if (i % 30 === 0) { const a = rng() * Math.PI * 2, m = rng() < 0.2 ? 0 : rng(); held[0] = Math.cos(a) * m; held[1] = Math.sin(a) * m; }
    return { move: held, hit: rng() < 0.04, jump: rng() < 0.01, switchPlayer: rng() < 0.005 };
  });
  // el mismo fuzz con COLOCAR (jset; aparte para no mover los números del anterior): reglas e invariantes con colocaciones en salto
  { const rj = S._makeRng(SEED ^ 0x5e7), hj = [0, 0];
    run('Fuzz humano aleatorio con COLOCAR', { demo: false }, 4 * 60, (g, i) => {
      if (i % 30 === 0) { const a = rj() * Math.PI * 2, m = rj() < 0.2 ? 0 : rj(); hj[0] = Math.cos(a) * m; hj[1] = Math.sin(a) * m; }
      return { move: hj, hit: rj() < 0.03, jump: rj() < 0.01, jset: rj() < 0.02, switchPlayer: rj() < 0.005 };
    }); }
  // SIM-03: partido humano con g.present (pausas de presentación) jugado por el bot 'bueno' hasta el final
  { const opts = { demo: false, difficulty: 'normal', serveClock: true, seed: SEED + 5, present: true };
    if (!S.createGame(opts).present) fail('createGame({present:true}) no activa g.present');
    const f0 = failures, r = run('Partido humano con g.present (bot bueno vs Normal)', opts, 6 * 60, makeBot(BOTS.bueno, SEED * 3 + 1), true), hs = r.hls;
    if (hs.length < 15) fail('partido con g.present: muy pocos puntos (' + hs.length + ')'); // (6 min: 24-31 puntos según la semilla)
    console.log('\nPartido con g.present (bot bueno vs Normal, 6 min): ' + hs.length + ' puntos, highlight medio ' + r.hlMean.toFixed(3) + ', puntos >= ' + VB.HOLD.bigAt + ': ' +
      hs.filter(h => h >= VB.HOLD.bigAt).length + ' (pausa ' + VB.HOLD.big + ' s)' + (failures > f0 ? '' : ' OK'));
  }
}

// ================= Calibración del highlight y determinismo (SIM-05) =================
if (ONLY !== 'matrix') {
  const jobs = []; for (let k = 0; k < HL_CAL.matches; k++) jobs.push({ kind: 'hl', seed: SEED + 7919 * k, label: 'highlight ' + k });
  const t0 = Date.now(), res = (await runMatrix(jobs)).filter(Boolean);
  for (const r of res) failures += r.failures;
  if (res.length !== HL_CAL.matches) fail('calibración: ' + res.length + ' de ' + HL_CAL.matches + ' partidos');
  else { hlCalibration(res); console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s en paralelo)'); }
  // determinismo: el mismo partido repetido aquí (otro hilo, otro contexto) da la MISMA traza: highlight, señal, landSide,
  // pausa, final apretado, defensas, racha y cada bote del ritual; otra semilla da otra traza (la traza no es trivial)
  if (res.length >= 2) {
    const a = runHlMatch({ seed: res[0].seed }), b = runHlMatch({ seed: res[0].seed });
    const hlSeq = r => r.pts.map(p => p[0]).join(',');
    const firstDiff = (x, y) => { let i = 0; while (i < x.length && x[i] === y[i]) i++; return i; };
    if (a.trace !== b.trace || a.trace !== res[0].trace) fail('determinismo: misma semilla ' + res[0].seed + ', trazas distintas (carácter ' + firstDiff(a.trace, a.trace === b.trace ? res[0].trace : b.trace) + ')');
    else if (hlSeq(a) !== hlSeq(res[0])) fail('determinismo: secuencia de highlight distinta con la misma semilla');
    else if (a.trace === res[1].trace) fail('determinismo: dos semillas distintas dan la misma traza (¿traza vacía?)');
    else {
      // partido humano con g.present (la pausa depende del highlight): el bot y la sim repiten la misma secuencia
      const pres = () => { const r = run('determinismo con present', { demo: false, difficulty: 'normal', serveClock: true, seed: SEED + 11, present: true }, 4 * 60, makeBot(BOTS.bueno, SEED * 5 + 2), true);
        return r.hls.join(',') + '#' + r.g.time.toFixed(6); };
      const p1 = pres(), p2 = pres();
      if (p1 !== p2) fail('determinismo: partido con present y la misma semilla da otra secuencia de highlight');
      else console.log('determinismo (misma semilla -> misma traza de ' + a.pts.length + ' puntos y ' + a.dribbles + ' botes en dos hilos; con present ' + p1.split(',').length + ' puntos) OK');
    }
  }
}

  // ================= 2) y 4) Matriz en paralelo =================
  if (BOTMIN > 0) {
    const jobs = [];
    const LV = VB.DIFF_ORDER; // easy, normal, hard, expert
    // las casillas con banda estrecha (MATRIX_STAT.key) juegan el doble de semillas: mismas semillas 0..NSEED-1 que el resto y
    // NSEED..2·NSEED-1 de más (la desviación de su media baja √2 y la banda se estrecha en la misma proporción)
    for (let s = 0; s < 2 * NSEED; s++) {
      const extra = s >= NSEED;
      for (const d of LV) if (!extra || MATRIX_STAT.key.has('auto:' + d)) jobs.push({ kind: 'auto', diff: d, seconds: BOTMIN * 60, label: 'auto ' + d, seed: SEED + 1000 * s });
      for (const bn of Object.keys(BOTS)) for (const d of LV) if (!extra || MATRIX_STAT.key.has(bn + ':' + d))
        jobs.push({ kind: 'bot', bot: bn, diff: d, seconds: BOTMIN * 60, label: `bot ${bn} vs ${d}`, seed: SEED + bn.length * 31 + d.length + 1000 * s });
    }
    if (MFILTER) for (let i = jobs.length - 1; i >= 0; i--) if (!MFILTER.test(jobs[i].label)) jobs.splice(i, 1);
    const t0 = Date.now(), raw = await runMatrix(jobs);
    for (const r of raw) if (r) failures += r.failures;
    // suma las semillas de cada casilla
    const cells = new Map();
    const addObj = (a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; };
    for (const r of raw) {
      if (!r) continue;
      const k = r.kind + ':' + (r.bot || '') + ':' + r.diff, c = cells.get(k);
      if (!c) { cells.set(k, Object.assign({}, r, { hits: Object.assign({}, r.hits), how: Object.assign({}, r.how), hgrades: Object.assign({}, r.hgrades), why: Object.assign({}, r.why), matchWins: r.matchWins.slice(), meds: [r.med] })); continue; }
      c.won0 += r.won0; c.points += r.points; c.blocks += r.blocks; c.dives += r.dives; c.misses += r.misses; c.meds.push(r.med);
      addObj(c.hits, r.hits); addObj(c.how, r.how); addObj(c.hgrades, r.hgrades); addObj(c.why, r.why);
      c.matchWins[0] += r.matchWins[0]; c.matchWins[1] += r.matchWins[1];
    }
    const res = [...cells.values()];
    for (const c of res) c.med = c.meds.reduce((a, b) => a + b, 0) / c.meds.length;
    console.log(`\n######## IA compañero (equipo 0) contra cada dificultad  [${NSEED} semillas × ${BOTMIN} min de juego por casilla (${2 * NSEED} en las de banda estrecha), ${((Date.now() - t0) / 1000).toFixed(1)} s en paralelo] ########`);
    const diffShare = {};
    for (const r of res.filter(r => r && r.kind === 'auto')) {
      diffShare[r.diff] = r.won0 / r.points;
      console.log(`  vs ${VB.DIFF[r.diff].name.padEnd(8)} puntos IA-compañero ${pct(r.won0, r.points)} (${r.points} pts)  rally mediana ${r.med.toFixed(2)} s  remates ${r.hits.spike} bloqueos ${r.blocks} planchas ${r.dives}  partidos ${r.matchWins.join('-')}  cómo ${JSON.stringify(r.how)}`);
    }
    if (BOTMIN >= 20 && !MFILTER && !(diffShare.easy > diffShare.normal + 0.04 && diffShare.normal > diffShare.hard + mxGap('auto:normal', 'auto:hard', 0.02) && diffShare.hard > diffShare.expert + mxGap('auto:hard', 'auto:expert', 0.02))) fail('las dificultades no están ordenadas: ' + JSON.stringify(diffShare));
    console.log('\n######## Bots humanos (solo entrada de mando) contra la CPU ########');
    const botRes = {};
    for (const r of res.filter(r => r && r.kind === 'bot')) {
      const p = r.won0 / r.points, hg = r.hgrades, ht = hg.perfect + hg.good + hg.poor;
      botRes[r.bot + ':' + r.diff] = p;
      console.log(`  ${r.bot.padEnd(9)} vs ${VB.DIFF[r.diff].name.padEnd(8)} puntos ${pct(r.won0, r.points).padStart(6)} (${r.points})  P(partido)≈${(matchWinProb(p) * 100).toFixed(0).padStart(3)}%  ` +
        `toques P/B/M ${pct(hg.perfect, ht)}/${pct(hg.good, ht)}/${pct(hg.poor, ht)}  fallos ${r.misses}  rally ${r.med.toFixed(1)} s  ` +
        `partidos ${r.matchWins.join('-')}  ${JSON.stringify(topWhy(r.why))}`);
    }
    if (BOTMIN >= 20 && !MFILTER) { // objetivos de diseño (márgenes amplios: son estimaciones estadísticas)
      // curva de 4 niveles (revisión 2): quien acaba de superar Fácil no pierde casi todos los partidos en Normal
      // banda = objetivo de diseño [a, b] ± MATRIX_STAT.k desviaciones de la media de la muestra (ver MATRIX_STAT)
      const rng2 = (k, a, b, why) => { const s = MATRIX_STAT.k * mxSd(k), lo = a - s, hi = b + s;
        if (!(botRes[k] > lo && botRes[k] < hi)) fail(why + ' (' + k + ' = ' + (botRes[k] || 0).toFixed(3) + ', banda ' + lo.toFixed(3) + '-' + hi.toFixed(3) + ' con ' + mxN(k) + ' semillas × ' + BOTMIN + ' min)'); };
      rng2('novato:easy', 0.45, 0.49, 'novato en su primera sesión vs Fácil: objetivo 45-49 % de puntos (perdona, pero no es automático; gana ~1 de cada 3)');
      rng2('medio:normal', 0.47, 0.53, 'jugador medio vs Normal: objetivo ~50 % de puntos');
      rng2('novato:normal', 0.30, 0.38, 'novato vs Normal: objetivo ~33-37 %');
      if (!(botRes['medio:easy'] > 0.62)) fail('Fácil no perdona a un jugador medio (' + botRes['medio:easy'].toFixed(2) + ')');
      { const g1 = mxGap('medio:normal', 'medio:hard', 0.06), g2 = mxGap('medio:hard', 'medio:expert', 0.06);
        if (!(botRes['medio:hard'] < botRes['medio:normal'] - g1 && botRes['medio:expert'] < botRes['medio:hard'] - g2)) fail('Difícil/Experto no son claramente más difíciles para el jugador medio (Normal ' + botRes['medio:normal'].toFixed(3) + ', Difícil ' + botRes['medio:hard'].toFixed(3) + ', Experto ' + botRes['medio:expert'].toFixed(3) + '; diferencia mínima ' + g1.toFixed(3) + ' / ' + g2.toFixed(3) + ')'); }
      if (!(botRes['bueno:expert'] < 0.5)) fail('Experto no exige a un buen jugador');
      if (!(botRes['perfecto:expert'] > 0.5)) fail('bot perfecto no gana a Experto');
      if (!(botRes['novato:expert'] < 0.25)) fail('Experto no exige: el novato le gana demasiados puntos');
      for (const d of LV) if (!(botRes['perfecto:' + d] > botRes['bueno:' + d] && botRes['bueno:' + d] > botRes['medio:' + d] && botRes['medio:' + d] > botRes['novato:' + d])) fail('la habilidad no se nota contra ' + d);
      for (const bn of Object.keys(BOTS)) for (let i = 1; i < LV.length; i++) if (!(botRes[bn + ':' + LV[i - 1]] > botRes[bn + ':' + LV[i]] - 0.03)) fail('nivel ' + LV[i] + ' no es más difícil que ' + LV[i - 1] + ' para el bot ' + bn);
    }
  }

// ================= 5) Reglas puntuales =================
function stepUntil(g, type, maxSteps, inputFn) { // avanza hasta ver un evento de ese tipo; devuelve todos los eventos vistos
  const all = []; S.drainEvents(g); // descarta los pendientes
  for (let i = 0; i < (maxSteps || 2000); i++) {
    S.step(g, DT, inputFn ? inputFn(g, i) : null); const evs = S.drainEvents(g); all.push(...evs);
    if (evs.some(e => e.type === type)) return all;
  }
  return all;
}
function rallyAt(g, ball) { g.mode = 'rally'; g.ball.held = null; Object.assign(g.ball, { vx: 0, vy: 0, vz: 0, dip: 0, wobA: 0 }, ball); }
console.log('');
if (ONLY !== 'matrix') {
  // 4 toques
  const g = S.createGame({ demo: false, seed: 1 }), p = g.teams[0][0], q = g.teams[0][1];
  rallyAt(g, { x: 3, y: 0, z: 1.5, vz: -1 }); g.touchTeam = 0; g.touches = 3; g.lastPlayer = q; g.lastKind = 'free';
  S._hit(g, p, null); const pt = S.drainEvents(g).find(e => e.type === 'point');
  if (!pt || pt.reason !== 'four' || pt.team !== 1) fail('4 toques no se sanciona'); else console.log('regla 4 toques OK');
  // dobles
  const g2 = S.createGame({ demo: false, seed: 2 });
  rallyAt(g2, { x: 3, y: 0, z: 1.5, vz: -1 }); g2.touchTeam = 0; g2.touches = 1; g2.lastPlayer = g2.teams[0][0]; g2.lastKind = 'pass';
  S._hit(g2, g2.teams[0][0], null);
  const pt2 = S.drainEvents(g2).find(e => e.type === 'point');
  if (!pt2 || pt2.reason !== 'double') fail('dobles no se sanciona'); else console.log('regla dobles OK');
  if (S.canReach(g2, g2.teams[0][0])) fail('canReach permite dobles');
  // tras bloqueo, el mismo bloqueador puede volver a tocar y el equipo tiene 3 toques
  const gb = S.createGame({ demo: false, seed: 21 }), blk = gb.teams[0][0];
  rallyAt(gb, { x: 0.3, y: blk.y = 0, z: 2.9, vx: 6, vz: -1 }); blk.x = 0.5; blk.z = 0.8; blk.vz = 0.2;
  gb.touchTeam = 1; gb.touches = 3; gb.lastTeam = 1; gb.lastKind = 'spike'; gb.lastPlayer = gb.teams[1][0];
  let got = null;
  for (let k = 0; k < 200 && !got; k++) { gb.blockCD = 0; gb.rng = (() => { let s = 0; return () => (s++ % 2 ? 0.99 : 0.01); })(); gb.ball.x = 0.3; gb.ball.y = 0; gb.ball.z = 2.9; gb.ball.vx = 6; gb.ball.vz = -1; gb.mode = 'rally'; gb.lastTeam = 1; gb.lastKind = 'spike'; S.step(gb, DT, null); got = S.drainEvents(gb).find(e => e.type === 'block'); }
  if (!got) fail('no se produce el bloqueo de prueba');
  else if (gb.touches !== 0 || gb.lastPlayer !== null) fail('el bloqueo cuenta como toque'); else console.log('bloqueo no cuenta como toque OK (' + got.result + ')');
  // set a 25, diferencia de 2, tie-break a 15, punto de set
  const g3 = S.createGame({ demo: false, seed: 3 });
  g3.score = [24, 23]; rallyAt(g3, { x: -5, y: 0, z: 0.3, vz: -3 }); g3.lastTeam = 1;
  const e3 = stepUntil(g3, 'point');
  if (!e3.find(e => e.type === 'set' && e.team === 0) || g3.sets[0] !== 1) fail('set a 25 no se cierra'); else console.log('regla set a 25 OK');
  const g4 = S.createGame({ demo: false, seed: 4 });
  g4.score = [24, 24]; rallyAt(g4, { x: -5, y: 0, z: 0.3, vz: -3 }); g4.lastTeam = 1;
  stepUntil(g4, 'point');
  if (g4.sets[0] !== 0) fail('25-24 no debería cerrar el set (diferencia de 2)'); else console.log('regla diferencia de 2 OK');
  const g5 = S.createGame({ demo: false, seed: 5 });
  g5.setNo = 3; g5.sets = [1, 1]; g5.score = [14, 10]; rallyAt(g5, { x: -5, y: 0, z: 0.3, vz: -3 }); g5.lastTeam = 1;
  const e5 = stepUntil(g5, 'point');
  if (!e5.find(e => e.type === 'match' && e.team === 0) || g5.mode !== 'over') fail('tie-break a 15 no cierra el partido'); else console.log('regla tie-break a 15 OK');
  const g6 = S.createGame({ demo: false, seed: 6 });
  g6.score = [24, 20]; rallyAt(g6, { x: 5, y: 0, z: 0.3, vz: -3 }); g6.lastTeam = 0; g6.serving = 1;
  const e6 = stepUntil(g6, 'serveReady'), sr = e6.find(e => e.type === 'serveReady');
  if (!sr || sr.setPoint !== 0) fail('punto de set no anunciado'); else console.log('punto de set OK');
  // orden de saque: cada vez que un equipo recupera el saque, saca el otro jugador
  {
    const g7 = S.createGame({ demo: true, seed: 77 }), prevServer = [null, null]; let bad = 0, curTeam = -1, curServer = null, curSet = 1, n7 = 0;
    for (let i = 0; i < 120 * 60 * 15; i++) {
      S.step(g7, DT, null);
      for (const e of S.drainEvents(g7)) {
        if (e.type === 'newSet' || e.type === 'newMatch') { prevServer[0] = prevServer[1] = null; curTeam = -1; }
        if (e.type !== 'serveReady') continue;
        n7++;
        if (e.team === curTeam) { if (e.player !== curServer) bad++; }
        else { if (prevServer[e.team] && prevServer[e.team] === e.player) bad++; prevServer[e.team] = e.player; curTeam = e.team; curServer = e.player; }
      }
    }
    if (n7 < 30) fail('pocos saques en la prueba de orden de saque');
    if (bad) fail('orden de saque incorrecto ' + bad); else console.log('orden de saque (alternancia en el equipo) OK');
  }
  // antena / por fuera / por debajo de la red
  const ga = S.createGame({ demo: false, seed: 8 });
  rallyAt(ga, { x: 0.1, y: 4.5, z: 2.8, vx: -3 }); ga.lastTeam = 0; ga.touchTeam = 0; ga.touches = 1;
  let ea = stepUntil(ga, 'point').find(e => e.type === 'point');
  if (!ea || ea.reason !== 'antenna' || ea.team !== 1) fail('balón en la antena no se sanciona'); else console.log('regla antena OK');
  const gf = S.createGame({ demo: false, seed: 9 });
  rallyAt(gf, { x: 0.1, y: 5.3, z: 4, vx: -3 }); gf.lastTeam = 0; gf.touchTeam = 0; gf.touches = 1;
  ea = stepUntil(gf, 'point').find(e => e.type === 'point');
  if (!ea || ea.reason !== 'antenna' || !/fuera/.test(ea.text)) fail('balón por fuera de la antena no se sanciona'); else console.log('regla por fuera de la antena OK');
  const gu = S.createGame({ demo: false, seed: 10 });
  rallyAt(gu, { x: 0.1, y: 0, z: 0.7, vx: -4, vz: 0.5 }); gu.lastTeam = 0; gu.touchTeam = 0; gu.touches = 1;
  ea = stepUntil(gu, 'point').find(e => e.type === 'point');
  if (!ea || ea.reason !== 'under') fail('balón por debajo de la red no se sanciona'); else console.log('regla por debajo de la red OK');
  // toque de red: jugador en el aire que deriva hacia la red con el balón cerca
  const gn = S.createGame({ demo: false, seed: 11 }), pn = gn.teams[0][0];
  rallyAt(gn, { x: 1.5, y: 0, z: 4, vz: 1 }); gn.lastTeam = 1; gn.touchTeam = 1; gn.touches = 1; gn.lastKind = 'pass';
  pn.x = 0.6; pn.y = 0; pn.z = 0; pn.vz = 0; pn.vx = -5.6; pn.vy = 0; gn.ctrl = pn;
  S._jump(gn, pn);
  ea = stepUntil(gn, 'point').find(e => e.type === 'point');
  if (!ea || ea.reason !== 'net' || ea.team !== 1) fail('toque de red no se sanciona'); else console.log('regla toque de red OK');
  // falta de saque: el humano lanza y no golpea
  const gs = S.createGame({ demo: false, seed: 12 });
  let pressed = false;
  ea = stepUntil(gs, 'point', 2000, (g) => { const h = !pressed && g.serveT > 0.5; if (h) pressed = true; return { move: [0, 0], hit: h, jump: false }; }).find(e => e.type === 'point');
  if (!ea || ea.reason !== 'serve' || ea.team !== 1) fail('balón que cae sin golpear en el saque no es falta'); else console.log('falta de saque (no golpea) OK');
  // no se puede sacar antes del silbato
  {
    const gw = S.createGame({ demo: false, seed: 16 }); let early = false, whistleT = -1;
    for (let i = 0; i < 120; i++) { S.step(gw, DT, { move: [0, 0], hit: i === 50, jump: false }); for (const e of S.drainEvents(gw)) { if (e.type === 'toss' && whistleT < 0) early = true; if (e.type === 'whistle') whistleT = e.t; } }
    if (early || gw.serveState !== 'ready' || whistleT < 0) fail('saque antes del silbato'); else console.log('saque solo tras el silbato OK');
  }
  // regla de 8 segundos
  const g8 = S.createGame({ demo: false, seed: 13 });
  const e8 = stepUntil(g8, 'point', 120 * 10).find(e => e.type === 'point');
  const w8 = S.createGame({ demo: false, seed: 13 }).whistleAt;
  if (!e8 || e8.reason !== 'serve' || Math.abs(e8.t - 8 - w8) > 0.05) fail('regla de 8 s no aplicada (t=' + (e8 && e8.t) + ')'); else console.log('regla de 8 segundos OK');
  // en la playa, 5 segundos
  {
    const g5 = S.createGame({ demo: false, seed: 13, venue: 'beach' }), w5 = g5.whistleAt;
    const e5 = stepUntil(g5, 'point', 120 * 10).find(e => e.type === 'point');
    if (!e5 || e5.reason !== 'serve' || e5.text !== 'Falta de saque: 5 segundos' || Math.abs(e5.t - 5 - w5) > 0.05) fail('regla de 5 s de playa no aplicada (t=' + (e5 && e5.t) + ', ' + (e5 && e5.text) + ')'); else console.log('regla de 5 segundos (playa) OK');
  }
  const g8b = S.createGame({ demo: false, seed: 13, serveClock: false });
  if (stepUntil(g8b, 'point', 120 * 10).find(e => e.type === 'point')) fail('serveClock:false no desactiva los 8 s'); else console.log('serveClock:false OK');
  // timing (con armado del brazo C.WINDUP): pulsar WINDUP antes del ideal da 'perfect' (y el contacto se
  // produce en el momento ideal); pulsar en el ideal mismo, 'good'; muy pronto o tarde, 'poor' o fallo
  const WU = C.WINDUP;
  for (const [lead, want] of [[WU, 'perfect'], [WU + 0.03, 'perfect'], [WU - 0.03, 'perfect'], [0.0, 'good'], [0.13, 'good'], [0.30, 'poor|miss'], [-0.08, 'poor']]) {
    const gt = S.createGame({ demo: false, seed: 14 }), ht = gt.teams[0][0];
    rallyAt(gt, { x: 4, y: 0, z: 3, vx: 0, vy: 0, vz: 0 }); gt.lastTeam = 1; gt.touchTeam = 1; gt.touches = 1; gt.lastKind = 'free'; gt.lastTouchT = gt.time;
    ht.x = 4; ht.y = 0; gt.ctrl = ht; gt.teams[0][1].x = 7; let done = false, gr = null, w = {};
    for (let i = 0; i < 400 && !gr; i++) {
      S.hitWindow(gt, ht, w); const h = !done && w.t <= lead; if (h) done = true;
      S.step(gt, DT, { move: [0, 0], hit: h, jump: false }); const evs = S.drainEvents(gt);
      const hv = evs.find(e => e.type === 'hit'); if (hv) gr = hv.grade; if (evs.find(e => e.type === 'miss')) gr = 'miss';
    }
    if (!gr || !new RegExp('^(' + want + ')$').test(gr)) fail(`timing lead ${lead}: esperado ${want}, obtenido ${gr}`);
    else console.log(`timing pulsando ${(lead * 1000).toFixed(0)} ms antes del ideal -> ${gr} OK`);
  }
  // timing: lo aprendible. Pulsar al aparecer "¡Golpea ahora!" / el brillo de GOLPEAR (press en (-0,15, 0,24), ui.js e input.js)
  // + reacción humana (~150-300 ms) no penaliza
  {
    const gradesAt = {};
    for (const delay of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
      const res = {};
      for (let s = 0; s < 12; s++) {
        const gt = S.createGame({ demo: false, seed: 300 + s }), ht = gt.teams[0][0];
        rallyAt(gt, { x: -1, y: (s % 5 - 2) * 0.4, z: 3.2, vx: 6.5, vz: 2.5 }); gt.touchTeam = 1; gt.lastTeam = 1; gt.touches = 3; gt.lastKind = 'spike'; gt.lastPlayer = gt.teams[1][0]; gt.lastTouchT = gt.time;
        const pr = S.predict(gt, 1, {}); ht.x = pr.x + 0.15; ht.y = pr.y; gt.ctrl = ht; gt.teams[0][1].x = 8; gt.teams[0][1].y = 4; gt.hardIn = false; gt.digOk = true;
        let shown = -1, pressed = false, gr = 'none'; const w = {};
        for (let i = 0; i < 300; i++) {
          S.hitWindow(gt, ht, w);
          if (shown < 0 && w.reach && w.press < 0.24 && w.press > -0.15) shown = gt.time;
          const h = shown >= 0 && !pressed && gt.time - shown >= delay - 1e-9; if (h) pressed = true;
          S.step(gt, DT, { move: [0, 0], hit: h, jump: false }); const evs = S.drainEvents(gt);
          const hv = evs.find(e => e.type === 'hit' && e.human); if (hv) { gr = hv.grade; break; }
          if (evs.find(e => e.type === 'miss')) { gr = 'miss'; break; }
        }
        res[gr] = (res[gr] || 0) + 1;
      }
      gradesAt[delay] = res;
    }
    const ok = (d, k, n) => (gradesAt[d][k] || 0) >= n;
    const okG = (d, n) => (gradesAt[d].perfect || 0) + (gradesAt[d].good || 0) >= n;
    if (!(ok(0.2, 'perfect', 9) && ok(0.25, 'perfect', 9) && okG(0.15, 9) && okG(0.3, 9) && !ok(0, 'perfect', 1)))
      fail('timing tras el aviso no es aprendible: ' + JSON.stringify(gradesAt));
    else console.log('timing tras "¡Golpea ahora!" (0/50/100/150/200 ms):', Object.values(gradesAt).map(r => JSON.stringify(r)).join(' '), 'OK');
  }
  // saque: golpear el lanzamiento de subida (doble pulsación rápida) no vale: no hay contacto hasta que baja
  {
    const gd = S.createGame({ demo: false, seed: 31 }); let tossAt = -1, hitEv = null, missEv = null, pressedAt = -1;
    for (let i = 0; i < 400 && !hitEv && !missEv; i++) {
      const inp = { move: [0, 0], hit: false, jump: false };
      if (gd.serveAuth && gd.serveState === 'ready' && tossAt < 0) inp.hit = true;
      if (tossAt >= 0 && pressedAt < 0 && gd.time - tossAt >= 0.09) { inp.hit = true; pressedAt = gd.time; }
      S.step(gd, DT, inp);
      for (const e of S.drainEvents(gd)) { if (e.type === 'toss') tossAt = e.t; if (e.type === 'hit') hitEv = e; if (e.type === 'miss') missEv = e; }
    }
    if (hitEv && hitEv.z < gd.server.z + 2.2) fail('saque golpeado de subida a ' + hitEv.z.toFixed(2) + ' m');
    else if (hitEv && hitEv.grade !== 'poor') fail('doble pulsación del saque da ' + hitEv.grade);
    else console.log('saque de doble pulsación: ' + (missEv ? 'miss ' + missEv.reason : 'hit ' + hitEv.grade + ' bajando') + ' OK');
  }
  // saque: balón en la mano a la altura del pecho, delante y a la izquierda; sale de ahí al lanzar
  {
    const gh = S.createGame({ demo: false, seed: 32 }), sv = gh.server, b = gh.ball;
    S.step(gh, DT, null);
    const fwd = (sv.x - b.x) * S.side(sv.team), lat = (b.y - sv.y) * -S.side(sv.team);
    if (!(b.z > 1.15 && b.z < 1.4 && fwd > 0.25 && fwd < 0.45 && lat > 0.08)) fail(`balón en la mano mal colocado z=${b.z.toFixed(2)} delante=${fwd.toFixed(2)} izq=${lat.toFixed(2)}`);
    else console.log(`balón del sacador a ${b.z.toFixed(2)} m, ${fwd.toFixed(2)} m delante, ${lat.toFixed(2)} m a la izquierda OK`);
  }
  // llamada de línea: centro del balón 2 cm fuera = dentro (huella sobre la línea); 8 cm fuera = fuera
  for (const [off, inside] of [[0.02, true], [0.08, false], [0.2, false]]) {
    for (const axis of ['y', 'x']) {
      const gl = S.createGame({ demo: false, seed: 40 });
      rallyAt(gl, axis === 'y' ? { x: -5, y: -(C.HW + off), z: 0.6, vz: -3 } : { x: -(C.HL + off), y: 0, z: 0.6, vz: -3 });
      gl.lastTeam = 0; gl.touchTeam = 0; gl.lastKind = 'spike'; gl.touches = 3; for (const p of gl.players) { p.x = S.side(p.team) * 8.5; p.y = 3; }
      const ld = stepUntil(gl, 'land', 240).find(e => e.type === 'land');
      if (!ld || ld.truthIn !== inside) fail(`línea ${axis} a ${off} m: truthIn=${ld && ld.truthIn}`); // (lo cantado, ld.inside, puede llevar error arbitral B1)
    }
  }
  console.log('llamada de línea (2 cm fuera = dentro, 8 cm = fuera) OK');
  // saque / remate que roza la cinta y cae dentro sin que nadie lo toque: ace / kill (no "falta"); el que va a la red
  // y cae en su propio campo sigue siendo error
  let ncBad = 0;
  for (const [kind, want, bx] of [['serve', 'ace', -3], ['spike', 'kill', -3], ['spike', 'error', 2]]) {
    const gn = S.createGame({ demo: false, seed: 42 });
    rallyAt(gn, { x: bx, y: 0, z: 0.6, vz: -3 });
    gn.lastTeam = 0; gn.touchTeam = 0; gn.lastKind = kind; gn.lastShot = kind === 'serve' ? 'float' : 'power'; gn.touches = kind === 'serve' ? 1 : 3;
    gn.lastPlayer = gn.teams[0][0]; gn.netSince = true; for (const p of gn.players) { p.x = S.side(p.team) * 8.5; p.y = 3; }
    const pt = stepUntil(gn, 'point', 240).find(e => e.type === 'point'), wt = want === 'error' ? 1 : 0;
    if (!pt || pt.team !== wt || pt.how !== want) { ncBad++; fail(`balón que roza la red (${kind}, x=${bx}): esperado ${want} para ${wt}, obtenido ${pt && pt.how} para ${pt && pt.team}`); }
  }
  if (!ncBad) console.log('saque/remate que roza la cinta y cae dentro = ace/kill OK');
  // aimPoint y hit() deciden remate/libre con el mismo criterio (aro = golpe real)
  {
    let bad = 0;
    for (const [pz, bz, bx] of [[0.18, C.NET_H + 0.5, 1.5], [0.6, C.NET_H + 0.05, 1.5], [0.6, C.NET_H + 0.5, 4.0], [0.6, C.NET_H + 0.5, 1.5], [0, 2, 3]]) {
      const ga = S.createGame({ demo: false, seed: 43 }), h = ga.teams[0][0];
      rallyAt(ga, { x: bx, y: 0, z: bz, vz: -0.5 }); ga.touchTeam = 0; ga.touches = 2; ga.lastTeam = 0; ga.lastPlayer = ga.teams[0][1]; ga.lastKind = 'set';
      ga.ctrl = h; h.x = bx + 0.3; h.y = 0; h.z = pz; h.vz = 0;
      const ap = S.aimPoint(ga, {}, null); S._hit(ga, h, null, 0, 'spike');
      const hv = S.drainEvents(ga).find(e => e.type === 'hit');
      if (!ap || !hv || ap.kind !== hv.kind) { bad++; fail(`aimPoint/hit discrepan (p.z=${pz}, b.z=${bz.toFixed(2)}, b.x=${bx}): aro ${ap && ap.kind}, golpe ${hv && hv.kind}`); }
    }
    if (!bad) console.log('aimPoint y hit() coinciden en remate/libre OK');
  }
  // ataque del saque rival por encima de la red en zona de ataque = falta (13.3.4)
  {
    const gx = S.createGame({ demo: false, seed: 41 });
    rallyAt(gx, { x: 0.9, y: 0, z: 3.1, vx: 8, vz: -1 }); gx.lastKind = 'serve'; gx.touchTeam = 1; gx.lastTeam = 1; gx.touches = 3; gx.lastPlayer = gx.teams[1][0];
    const h = gx.teams[0][0]; gx.ctrl = h; h.x = 1.2; h.y = 0; h.z = 0.9; h.vz = 0.5;
    for (const q of gx.players) if (q !== h) { q.x = S.side(q.team) * 8; q.y = 3.5; }
    S._hit(gx, h, null, 0, '', null);
    const e0 = S.drainEvents(gx), pe = e0.find(e => e.type === 'point') || stepUntil(gx, 'point', 240).find(e => e.type === 'point');
    if (e0.some(e => e.type === 'point')) fail('ataque del saque pitado en el contacto, antes de que el balón cruce la red');
    if (!pe || pe.reason !== 'attackServe' || pe.team !== 1) fail('atacar el saque por encima de la red no es falta (al cruzar la red)'); else console.log('regla ataque del saque (pitada al cruzar la red) OK');
  }
  // ... pero una recepción alta en zona de ataque dirigida al PROPIO campo no es ataque (13.3.4: solo si se completa)
  {
    const gx = S.createGame({ demo: false, seed: 5 }), h = gx.teams[0][0];
    rallyAt(gx, { x: 1.6, y: 0, z: 2.75, vx: -0.5, vz: -1 }); gx.lastKind = 'serve'; gx.touchTeam = 1; gx.lastTeam = 1; gx.touches = 0; gx.lastPlayer = gx.teams[1][0];
    gx.ctrl = h; h.x = 1.8; h.y = 0; h.z = 0.5;
    S._hit(gx, h, [1, 0], 0, '', [3, 0]);
    const all = S.drainEvents(gx).concat(stepUntil(gx, 'hit', 400)), pe = all.find(e => e.type === 'point');
    if (pe && pe.reason === 'attackServe') fail('recepción alta hacia el propio campo pitada como ataque del saque');
    else console.log('recepción alta del saque hacia el propio campo: sin falta de ataque OK');
  }
  // balón que da en la red y cae FUERA en el propio campo: "a la red", no "fuera" (nunca cruzó)
  for (const [kind, shot, want] of [['spike', 'power', 'Balón a la red'], ['serve', 'float', 'Saque a la red'], ['set', 'overhead', 'Balón a la red']]) {
    const gn = S.createGame({ demo: false, seed: 7 }); for (const q of gn.players) { q.x = S.side(q.team) * 8.5; q.y = -3.5; }
    rallyAt(gn, { x: 0.6, y: 3.5, z: 2.0, vx: -6, vy: 4 });
    gn.lastTeam = 0; gn.touchTeam = 0; gn.touches = kind === 'serve' ? 0 : kind === 'set' ? 2 : 3; gn.lastKind = kind; gn.lastShot = shot; gn.lastPlayer = gn.teams[0][0];
    const all = stepUntil(gn, 'point', 900), net = all.some(e => e.type === 'net'), ld = all.find(e => e.type === 'land'), pe = all.find(e => e.type === 'point');
    if (!net || !ld || ld.inside || !pe || pe.text !== want || pe.team !== 1) fail(`${kind} a la red que cae fuera en su campo: red=${net} bote=${ld && ld.inside} -> ${pe && pe.reason} "${pe && pe.text}"`);
  }
  console.log('balón a la red que cae fuera en el propio campo = "Saque/Balón a la red" OK');
  // penetración: no se juega un balón que ya está en el campo rival
  {
    const gp = S.createGame({ demo: false, seed: 42 }), pp = gp.teams[0][0];
    rallyAt(gp, { x: -0.3, y: 0, z: 1.8, vx: -1 }); gp.lastKind = 'pass'; gp.touchTeam = 0; gp.touches = 1; gp.lastPlayer = gp.teams[0][1]; gp.lastTeam = 0;
    pp.x = 0.5; pp.y = 0; pp.z = 0;
    if (S.canReach(gp, pp)) fail('se puede jugar el balón en el campo rival'); else console.log('penetración en el espacio contrario OK');
  }
  // bloqueo humano corriendo hacia la red: la deriva no le mete en la red
  {
    let nets = 0;
    for (const jx of [1.4, 1.1, 0.9, 0.7, 0.5]) {
      const gj = S.createGame({ demo: false, seed: 43 });
      rallyAt(gj, { x: -2, y: 0, z: 4, vz: 1 }); gj.touchTeam = 1; gj.lastTeam = 1; gj.touches = 2; gj.lastKind = 'set'; gj.lastPlayer = gj.teams[1][1]; gj.lastTouchT = gj.time;
      const h = gj.ctrl; h.x = 3; h.y = 0; let jumped = false;
      const evs = stepUntil(gj, 'landPlayer', 400, () => { const inp = { move: [-1, 0], hit: false, jump: false }; if (!jumped && h.x <= jx) { inp.jump = true; jumped = true; } return inp; });
      if (evs.find(e => e.type === 'netTouch' && e.player === h)) nets++;
    }
    if (nets) fail('el humano toca la red al saltar a bloquear corriendo (' + nets + '/5)'); else console.log('salto de bloqueo humano sin toque de red OK');
  }
  // bloqueo directo (stuff): cae rápido en el campo del atacante y casi siempre es punto
  {
    let stuffs = 0, pts = 0;
    for (let s = 0; s < 400 && stuffs < 30; s++) {
      const gs2 = S.createGame({ demo: true, seed: 500 + s }), blk = gs2.teams[0][0];
      rallyAt(gs2, { x: -0.5, y: 0, z: 3.0, vx: 9, vz: -1.5 }); gs2.touchTeam = 1; gs2.lastTeam = 1; gs2.touches = 3; gs2.lastKind = 'spike'; gs2.lastPlayer = gs2.teams[1][0];
      blk.x = 0.5; blk.y = 0; blk.z = 0.8; blk.vz = 0.3; gs2.teams[0][1].x = 6; gs2.teams[1][0].x = -1.5; gs2.teams[1][1].x = -5;
      const evs = stepUntil(gs2, 'point', 600), bk = evs.find(e => e.type === 'block');
      if (!bk || bk.result !== 'stuff') continue;
      stuffs++; const pe = evs.find(e => e.type === 'point'); if (pe && pe.team === 0 && pe.how === 'block') pts++;
    }
    if (stuffs < 10 || pts / stuffs < 0.6) fail(`bloqueo directo: ${pts}/${stuffs} puntos`); else console.log(`bloqueo directo: ${pts}/${stuffs} acaban en punto del bloqueo OK`);
  }
  // colocación del remate: al hueco se defiende bastante menos que a las manos del defensor
  {
    const digRate = (tgt) => { let ok = 0; const N = 150;
      for (let s = 0; s < N; s++) {
        const gq = S.createGame({ demo: true, seed: 900 + s }), at = gq.teams[0][0];
        rallyAt(gq, { x: 1.0, y: 0, z: 3.1, vz: -0.5 }); gq.touchTeam = 0; gq.touches = 2; gq.lastTeam = 0; gq.lastKind = 'set'; gq.lastPlayer = gq.teams[0][1];
        at.x = 1.3; at.y = 0; at.z = 0.8; at.vz = 0.5;
        gq.teams[1][0].x = -5.4; gq.teams[1][0].y = 0.4; gq.teams[1][1].x = -0.8; gq.teams[1][1].y = 2.5;
        S._hit(gq, at, null, 0, '', tgt); S.drainEvents(gq);
        const evq = stepUntil(gq, 'point', 400, null), dg = evq.find(e => e.type === 'hit' && e.team === 1);
        if (dg && dg.shot !== 'shank') ok++; // defensa limpia (no desviada)
      } return ok / N; };
    const atDef = digRate([-5.6, 0.4]), gap = digRate([-7.8, -3.7]);
    if (!(gap < atDef * 0.68)) fail(`defensa según colocación: hueco ${gap.toFixed(2)} vs a las manos ${atDef.toFixed(2)}`);
    else console.log(`remate al hueco defendible ${(100 * gap).toFixed(0)}% / a las manos ${(100 * atDef).toFixed(0)}% OK`);
  }
  // cambio automático de jugador: sin idas y vueltas (la cámara no se desliza dos veces seguidas)
  {
    const gz = S.createGame({ demo: false, seed: 61, difficulty: 'normal' }), bz = makeBot(BOTS.novato, 61); let lastSw = null, flips = 0, nsw = 0;
    for (let i = 0; i < 120 * 60 * 8; i++) {
      S.step(gz, DT, bz(gz));
      for (const e of S.drainEvents(gz)) if (e.type === 'switch' && e.auto && !e.reset) {
        nsw++; if (lastSw && e.t - lastSw.t < 0.45 && e.to === lastSw.from && lastSw.tt === gz.lastTouchT) flips++;
        lastSw = e; e.tt = gz.lastTouchT;
      }
      if (gz.finished) break;
    }
    if (flips > 1) fail('el control salta de un jugador a otro y vuelve: ' + flips + ' de ' + nsw); else console.log(`cambios automáticos sin ida y vuelta (${flips}/${nsw}) OK`);
  }
  // bloquear el saque es falta
  const gk = S.createGame({ demo: false, seed: 15 }), bk = gk.teams[0][0];
  rallyAt(gk, { x: -0.3, y: 0, z: 2.8, vx: 8, vz: -0.5 }); gk.lastTeam = 1; gk.touchTeam = 1; gk.touches = 3; gk.lastKind = 'serve';
  bk.x = 0.5; bk.y = 0; bk.z = 0.9; bk.vz = 0.3; gk.blockCD = 0;
  ea = stepUntil(gk, 'point', 200).find(e => e.type === 'point');
  if (!ea || ea.reason !== 'block' || ea.team !== 1) fail('bloquear el saque no es falta'); else console.log('regla bloqueo del saque OK');
  // ---------- revisión 2 ----------
  // saltar cerca de la red con el balón del rival (cualquier toque) no mete al humano en la red
  {
    let nets = 0, n = 0;
    for (const [tt, tch] of [[1, 0], [1, 1], [-1, 0]]) for (const jx of [1.3, 0.9, 0.7, 0.5]) {
      const gj = S.createGame({ demo: false, seed: 44 }); n++;
      rallyAt(gj, { x: -3, y: 0, z: 3, vz: 2 }); gj.touchTeam = tt; gj.lastTeam = tt < 0 ? 1 : tt; gj.touches = tch; gj.lastKind = tch ? 'pass' : 'block'; gj.lastPlayer = tch ? gj.teams[1][0] : null; gj.lastTouchT = gj.time;
      const h = gj.ctrl; h.x = 3; h.y = 0; let jumped = false;
      const evs = stepUntil(gj, 'landPlayer', 400, () => { const inp = { move: [-1, 0], hit: false, jump: false }; if (!jumped && h.x <= jx) { inp.jump = true; jumped = true; } return inp; });
      if (evs.find(e => e.type === 'netTouch' && e.player === h)) nets++;
    }
    if (nets) fail('toque de red al saltar cerca de la red con el balón del rival en su 1er/2º toque (' + nets + '/' + n + ')'); else console.log('salto junto a la red con cualquier toque rival sin toque de red OK');
  }
  // balón que da en el cuerpo de un receptor que no golpea: toque ('body'), no lo atraviesa
  {
    let body = 0, aces = 0;
    for (let s = 0; s < 20; s++) {
      const gb2 = S.createGame({ demo: false, seed: 70 + s }), h = gb2.teams[0][0];
      rallyAt(gb2, { x: 1.5, y: (s % 3 - 1) * 0.08, z: 1.35, vx: 11, vy: 0, vz: 0.6 }); gb2.lastKind = 'serve'; gb2.touchTeam = 1; gb2.lastTeam = 1; gb2.touches = 3; gb2.lastPlayer = gb2.teams[1][0]; gb2.lastTouchT = gb2.time;
      gb2.ctrl = h; h.x = 6; h.y = 0; gb2.teams[0][1].x = 8.5; gb2.teams[0][1].y = 4.2;
      const evs = stepUntil(gb2, 'point', 600, () => ({ move: [0, 0], hit: false, jump: false }));
      if (evs.find(e => e.type === 'hit' && e.player === h && e.shot === 'body')) body++;
      const pe = evs.find(e => e.type === 'point'); if (pe && pe.how === 'ace') aces++;
    }
    if (body < 18 || aces) fail('saque contra el cuerpo del receptor: ' + body + "/20 toques 'body', " + aces + ' aces'); else console.log('balón contra el cuerpo = toque (' + body + "/20 'body', 0 aces) OK");
  }
  // cambio de campo: al acabar un set y a los 8 puntos del set decisivo (una sola vez)
  {
    const gc = S.createGame({ demo: false, seed: 81 }); gc.score = [24, 20]; rallyAt(gc, { x: -5, y: 0, z: 0.3, vz: -3 }); gc.lastTeam = 0;
    const ec = stepUntil(gc, 'point'); const c1 = ec.find(e => e.type === 'courtChange');
    const gd = S.createGame({ demo: false, seed: 82 }); gd.setNo = 3; gd.sets = [1, 1]; gd.score = [5, 7]; rallyAt(gd, { x: 5, y: 0, z: 0.3, vz: -3 }); gd.lastTeam = 1;
    const ed = stepUntil(gd, 'point'); const c2 = ed.find(e => e.type === 'courtChange');
    stepUntil(gd, 'serveReady', 1200); rallyAt(gd, { x: 5, y: 0, z: 0.3, vz: -3 }); gd.lastTeam = 1;
    const ed2 = stepUntil(gd, 'point');
    if (!c1 || c1.why !== 'set' || !c2 || c2.why !== 'eight' || c2.score[1] !== 8 || ed2.find(e => e.type === 'courtChange')) fail('cambio de campo: ' + JSON.stringify([c1 && c1.why, c2 && c2.why, !!ed2.find(e => e.type === 'courtChange')]));
    else console.log('cambio de campo (fin de set y 8 puntos del 3er set) OK');
  }
  // ayuda de timing por nivel: balón alto que cae; pulsar 0,55 s pronto -> en Fácil (gesto más largo) aún hay contacto; en Difícil, no
  {
    const res = {};
    for (const d of ['easy', 'hard']) {
      const gt = S.createGame({ demo: false, seed: 14, difficulty: d }), ht = gt.teams[0][0];
      rallyAt(gt, { x: 4, y: 0, z: 6, vx: 0, vy: 0, vz: 0 }); gt.lastTeam = 1; gt.touchTeam = 1; gt.touches = 1; gt.lastKind = 'free'; gt.lastTouchT = gt.time;
      ht.x = 4; ht.y = 0; gt.ctrl = ht; gt.teams[0][1].x = 7; let done = false, gr = null; const w = {};
      for (let i = 0; i < 400 && !gr; i++) {
        S.hitWindow(gt, ht, w); const h = !done && w.t <= 0.55; if (h) done = true;
        S.step(gt, DT, { move: [0, 0], hit: h, jump: false }); const evs = S.drainEvents(gt);
        const hv = evs.find(e => e.type === 'hit'); if (hv) gr = hv.shot === 'body' ? 'body' : hv.grade; if (evs.find(e => e.type === 'miss')) gr = 'miss';
      }
      res[d] = gr;
    }
    if (!(res.easy === 'poor' || res.easy === 'good') || res.hard !== 'miss') fail('ayuda de timing por nivel: ' + JSON.stringify(res)); else console.log('ayuda de timing por nivel (pulsar 0,55 s pronto: Fácil ' + res.easy + ', Difícil ' + res.hard + ') OK');
  }
  // recepción de la IA: función continua; un flotante perfecto sin apuntar ya puede ser ace (y apuntado, más)
  {
    const aceRate = (diff, aim) => { let n = 0, ace = 0;
      for (let s = 0; s < 150; s++) {
        const g = S.createGame({ seed: 1000 + s, difficulty: diff, serveClock: false }); S.drainEvents(g);
        const h = g.ctrl; let tossed = false, pressed = false, res = null;
        for (let i = 0; i < 120 * 12 && !res; i++) {
          const inp = { move: [0, 0], hit: false, jump: false, switchPlayer: false };
          if (g.mode === 'serve' && g.serveAuth && g.serveState === 'ready' && !tossed) { inp.hit = true; tossed = true; }
          if (aim && g.mode === 'serve' && g.serveState === 'toss') { // saque dirigible: lleva la diana a la esquina de antes (-7,68 ; ±2,38)
            const dx = -7.68 - g.aim3.x, dy = (s % 2 ? 1 : -1) * 2.38 - g.aim3.y, d = Math.hypot(dx, dy), f = d > 1e-6 ? Math.min(1, d / 0.25) / d : 0; inp.move = [dx * f, dy * f]; }
          if (g.mode === 'serve' && g.serveState === 'toss' && !pressed && g.ball.vz < 0) { const w = S.hitWindow(g, h); if (w.t <= C.WINDUP) { inp.hit = true; pressed = true; } }
          S.step(g, DT, inp);
          for (const e of S.drainEvents(g)) { if (e.type === 'hit' && e.kind === 'serve') n++; if (e.type === 'point') { res = e; if (e.team === 0 && e.how === 'ace') ace++; } }
        }
      } return ace / n; };
    const fn = aceRate('normal', false), fa = aceRate('normal', true);
    const msg = 'aces de flotante perfecto en Normal: sin apuntar ' + (100 * fn).toFixed(0) + '%, apuntado ' + (100 * fa).toFixed(0) + '%';
    // (saque dirigible, sprint Carrera: el flotante cae en la diana con un 25 % del baile; antes el apuntado era 7-16 %)
    if (!(fn >= 0.02 && fn <= 0.09 && fa >= 0.09 && fa <= 0.25 && fa > fn + 0.05)) fail(msg + ' (objetivo 2-9 / 9-25)'); else console.log(msg + ' OK');
  }
  // rol defensivo: el control pasa al defensor cuando la CPU COLOCA (no tras el remate) y la cámara tiene tiempo
  {
    const gz = S.createGame({ demo: false, seed: 62, difficulty: 'normal' }), bz = makeBot(BOTS.medio, 62);
    let lead = [], after = 0, spikes = 0, swT = -1;
    for (let i = 0; i < 120 * 60 * 10; i++) {
      S.step(gz, DT, bz(gz));
      for (const e of S.drainEvents(gz)) {
        if (e.type === 'hit' && e.team === 1 && e.kind === 'set') swT = -1;
        if (e.type === 'switch' && e.reason === 'defense') swT = e.t;
        if (e.type === 'hit' && e.team === 1 && e.kind === 'spike') { spikes++; if (swT > 0) lead.push(e.t - swT); swT = 0; }
        if (e.type === 'switch' && e.auto && !e.reset && e.reason !== 'defense' && swT === 0 && gz.touchTeam === 1 && Math.hypot(gz.ball.vx, gz.ball.vy, gz.ball.vz) > 12) after++;
        if ((e.type === 'hit' && e.team === 0) || e.type === 'point' || e.type === 'block') swT = -1;
      }
      if (gz.finished) break;
    }
    lead.sort((a, b) => a - b); const med = lead.length ? lead[lead.length >> 1] : 0;
    const msg = 'rol defensivo: ' + lead.length + ' cambios al colocar la CPU (antelación mediana al remate ' + med.toFixed(2) + ' s), ' + after + ' cambios con balón rápido tras el remate de ' + spikes;
    if (lead.length < 5 || med < 0.6 || after) fail(msg); else console.log(msg + ' OK');
  }
  // ---------- revisión 3 ----------
  // antena tocada SIN cruzar la red: falta del último que tocó (8.4.3)
  {
    const gA = S.createGame({ demo: false, seed: 90 });
    rallyAt(gA, { x: 0.12, y: 4.0, z: 2.9, vy: 3.5, vz: 0.5 }); gA.lastTeam = 0; gA.touchTeam = 0; gA.touches = 2; gA.lastKind = 'set'; gA.lastPlayer = gA.teams[0][1];
    for (const p of gA.players) { p.x = S.side(p.team) * 6; p.y = 0; }
    const eA = stepUntil(gA, 'point', 240).find(e => e.type === 'point');
    // tras un bloqueo: el balón que toca el bloqueo y luego la antena es punto del atacante
    const gB = S.createGame({ demo: false, seed: 91 });
    rallyAt(gB, { x: -0.15, y: 4.05, z: 3.0, vy: 3, vz: 0.3 }); gB.lastTeam = 1; gB.touchTeam = 1; gB.touches = 0; gB.lastKind = 'block'; gB.lastPlayer = null; gB.atkTeam = 0;
    for (const p of gB.players) { p.x = S.side(p.team) * 6; p.y = 0; }
    const eB = stepUntil(gB, 'point', 240).find(e => e.type === 'point');
    // balón que cruza por encima de la antena con parte del balón por fuera del espacio de paso (8.4.4)
    const gC = S.createGame({ demo: false, seed: 92 });
    rallyAt(gC, { x: 0.1, y: 4.4, z: 4.2, vx: -4 }); gC.lastTeam = 0; gC.touchTeam = 0; gC.touches = 1;
    const eC = stepUntil(gC, 'point', 240).find(e => e.type === 'point');
    // y uno que cruza alto pero entero por dentro: sigue en juego
    const gD = S.createGame({ demo: false, seed: 93 });
    rallyAt(gD, { x: 0.1, y: 4.0, z: 4.2, vx: -4 }); gD.lastTeam = 0; gD.touchTeam = 0; gD.touches = 1; gD.lastKind = 'free';
    for (const p of gD.players) { p.x = S.side(p.team) * 8.5; p.y = -3; }
    const eD = stepUntil(gD, 'point', 30).find(e => e.type === 'point');
    if (!eA || eA.reason !== 'antenna' || eA.team !== 1 || !/toca la antena/.test(eA.text) || !eA.antenna) fail('antena tocada sin cruzar: ' + JSON.stringify(eA && [eA.reason, eA.team, eA.text, eA.antenna]));
    else if (!eB || eB.reason !== 'antenna' || eB.team !== 0) fail('bloqueo y antena: ' + JSON.stringify(eB && [eB.reason, eB.team]));
    else if (!eC || eC.reason !== 'antenna' || eC.antenna !== null || !/fuera de la antena/.test(eC.text)) fail('cruce en parte por fuera por encima de la antena: ' + JSON.stringify(eC && [eC.reason, eC.text]));
    else if (eD) fail('balón alto que cruza por dentro sancionado: ' + eD.text);
    else console.log('antena sin cruzar, bloqueo + antena, cruce en parte por fuera sobre la antena OK');
  }
  // texto del árbitro para el balón fuera según el último toque
  {
    const outCase = (kind, shot, prev) => {
      const go = S.createGame({ demo: false, seed: 95 });
      rallyAt(go, { x: -5, y: -(C.HW + 0.5), z: 0.5, vz: -3 }); go.lastTeam = 0; go.touchTeam = 0; go.touches = 2; go.lastKind = kind; go.lastShot = shot; go.prevKind = prev;
      for (const p of go.players) { p.x = S.side(p.team) * 8.5; p.y = 3; }
      const e = stepUntil(go, 'point', 240).find(x => x.type === 'point'); return e ? e.reason + ':' + e.text : 'nada';
    };
    const got = [outCase('serve', 'float', ''), outCase('spike', 'power', 'set'), outCase('free', 'tip', 'set'), outCase('pass', 'forearm', 'serve'), outCase('pass', 'dig', 'spike'), outCase('block', 'tool', 'spike'), outCase('set', 'overhead', 'pass')];
    const want = ['out:Saque fuera', 'out:Remate fuera', 'out:Dejada fuera', 'out:Recepción fuera', 'out:Defensa fuera', 'out:Toca el bloqueo y sale fuera', 'out:Colocación fuera'];
    if (got.join('|') !== want.join('|')) fail('textos de balón fuera: ' + got.join(' | ')); else console.log('textos de balón fuera (' + got.map(x => x.slice(4)).join(', ') + ') OK');
  }
  // Sim.aimPoint: el saque y el remate van a donde dice la retícula (sin el error de ejecución)
  {
    const ga = S.createGame({ demo: false, seed: 96 }); let ok = true, msg = [];
    S.step(ga, DT, null);
    if (S.aimPoint(ga, {}) !== null) { ok = false; msg.push('antes del silbato'); }
    for (let i = 0; i < 120 && !ga.serveAuth; i++) S.step(ga, DT, null);
    // saque dirigible: con el balón en la mano la diana está en el centro del fondo rival y el stick (que mueve al sacador) no la mueve
    const a1 = Object.assign({}, S.aimPoint(ga, {}, [-1, 0]));
    for (let i = 0; i < 30; i++) S.step(ga, DT, { move: [-1, 0.5], hit: false, jump: false });
    const a0 = Object.assign({}, S.aimPoint(ga, {}));
    if (!a1 || a1.mode !== 1 || a1.kind !== 'serve' || !a1.aimed || a1.x !== -7 || a1.y !== 0 || a0.x !== -7 || a0.y !== 0 || !ga.aim3.on || ga.aim3.kind !== 'serve') { ok = false; msg.push('saque ' + JSON.stringify([a1, a0])); }
    // saque real: la diana se lleva con el stick durante el lanzamiento; con timing perfecto el destino del hit es la diana (aimPoint)
    let tossed = false, hitE = null, ap = null, moved = null;
    for (let i = 0; i < 600 && !hitE; i++) {
      const inp = { move: [0, 0], hit: false, jump: false };
      if (ga.serveState === 'ready' && !tossed) { inp.hit = true; tossed = true; }
      else if (ga.serveState === 'toss' && ga.ball.vz > 0) inp.move = [-0.6, 0.8];
      else if (ga.serveState === 'toss' && S.hitWindow(ga, ga.ctrl).t <= C.WINDUP && !ga.swingLive) { inp.hit = true; ap = Object.assign({}, S.aimPoint(ga, {})); moved = [ga.aim3.x, ga.aim3.y]; }
      S.step(ga, DT, inp); hitE = S.drainEvents(ga).find(e => e.type === 'hit');
    }
    if (!hitE || !ap || ap.mode !== 2 || !(moved[0] < -7.5 && moved[1] > 0.5) || Math.hypot(hitE.target[0] - ap.x, hitE.target[1] - ap.y) > 1e-6 || ga.aim3.on) { ok = false; msg.push('saque real ' + JSON.stringify([hitE && hitE.target, ap, moved])); }
    // remate del humano en el aire: hit.target = aimPoint
    for (const mv of [[-0.5, 0.8], [0.9, -0.3], null]) {
      const gr = S.createGame({ demo: false, seed: 97 }), h = gr.teams[0][0];
      rallyAt(gr, { x: 0.9, y: 0.5, z: 3.1, vz: -0.5 }); gr.touchTeam = 0; gr.touches = 2; gr.lastTeam = 0; gr.lastKind = 'set'; gr.lastPlayer = gr.teams[0][1];
      gr.ctrl = h; h.x = 1.2; h.y = 0.5; h.z = 0.8; h.vz = 0.5;
      const r = S.aimPoint(gr, {}, mv || [0, 0]);
      const l = mv ? Math.hypot(mv[0], mv[1]) : 1;
      S._hit(gr, h, mv ? [mv[0] / l, mv[1] / l] : null, 0, '', null);
      const e = S.drainEvents(gr).find(x => x.type === 'hit');
      if (!r || r.kind !== 'spike' || !e || Math.hypot(e.target[0] - r.x, e.target[1] - r.y) > 1e-9) { ok = false; msg.push('remate ' + JSON.stringify([r, e && e.target])); }
    }
    // la CPU sacando: no hay retícula
    const gc2 = S.createGame({ demo: false, seed: 98 }); gc2.serving = 1; S._setupServe(gc2); for (let i = 0; i < 100; i++) S.step(gc2, DT, null);
    if (gc2.mode === 'serve' && S.aimPoint(gc2, {}) !== null) { ok = false; msg.push('saque de la CPU'); }
    if (!ok) fail('Sim.aimPoint: ' + msg.join('; ')); else console.log('Sim.aimPoint (saque: vista previa y real, remate con y sin dirección, CPU sin retícula) OK');
  }
  // ---------- presentación del punto (SIM-01/02/03) ----------
  // señales del árbitro en casos concretos (además del contraste de cada punto en todas las partidas)
  {
    const sigCase = (setup) => {
      const gq = S.createGame({ demo: false, seed: 120 }); for (const q of gq.players) { q.x = S.side(q.team) * 8.5; q.y = 3; }
      const inp = setup(gq) || null; const e = stepUntil(gq, 'point', 1500, inp).find(x => x.type === 'point'); return e || { signal: 'nada' };
    };
    const outAt = (kind, shot, touches) => (gq) => {
      rallyAt(gq, { x: -5, y: -(C.HW + 0.5), z: 0.5, vz: -3 }); gq.lastTeam = 1; gq.touchTeam = 1; gq.touches = touches;
      gq.lastKind = kind; gq.lastShot = shot; gq.prevKind = kind === 'pass' ? 'spike' : 'pass'; gq.lastPlayer = gq.teams[1][0];
    };
    const cases = {
      'remate fuera': [outAt('spike', 'power', 3), 'out'],
      'saque fuera': [(gq) => { outAt('serve', 'float', 3)(gq); gq.lastTeam = 0; gq.touchTeam = 0; gq.lastPlayer = gq.teams[0][0]; }, 'out'],
      'defensa fuera (1.er toque)': [outAt('pass', 'dig', 1), 'touched'],
      'recepción desviada fuera': [outAt('pass', 'shank', 1), 'touched'],
      'colocación fuera (2.º toque)': [outAt('set', 'overhead', 2), 'out'],
      'toca el bloqueo y fuera': [outAt('block', 'tool', 0), 'touched'],
      'dentro': [(gq) => { rallyAt(gq, { x: -5, y: 0, z: 0.5, vz: -3 }); gq.lastTeam = 0; gq.touchTeam = 0; gq.touches = 3; gq.lastKind = 'spike'; gq.lastShot = 'power'; gq.lastPlayer = gq.teams[0][0]; }, 'in'],
      '8 segundos': [() => null, 'delay8'],
      'no golpea el lanzamiento': [() => { let pr = false; return (g) => { const h = !pr && g.serveAuth; if (h) pr = true; return { move: [0, 0], hit: h, jump: false }; }; }, 'serveFault'],
      'bloqueo del saque': [(gq) => { const bk = gq.teams[0][0]; rallyAt(gq, { x: -0.3, y: 0, z: 2.8, vx: 8, vz: -0.5 }); gq.lastTeam = 1; gq.touchTeam = 1; gq.touches = 3; gq.lastKind = 'serve'; bk.x = 0.5; bk.y = 0; bk.z = 0.9; bk.vz = 0.3; gq.blockCD = 0; }, 'attackFault'],
      'por debajo de la red': [(gq) => { rallyAt(gq, { x: 0.1, y: 0, z: 0.7, vx: -4, vz: 0.5 }); gq.lastTeam = 0; gq.touchTeam = 0; gq.touches = 1; }, 'under'],
      'antena': [(gq) => { rallyAt(gq, { x: 0.1, y: 4.5, z: 2.8, vx: -3 }); gq.lastTeam = 0; gq.touchTeam = 0; gq.touches = 1; }, 'antenna']
    };
    const got = {}; for (const k in cases) got[k] = sigCase(cases[k][0]);
    const bad = Object.keys(cases).filter(k => got[k].signal !== cases[k][1] || (got[k].touchedOut === true) !== (cases[k][1] === 'touched'));
    const ls = [got['dentro'].landSide, got['remate fuera'].landSide, got['saque fuera'].landSide, got['8 segundos'].landSide], lsBad = ls.join() !== '1,1,1,-1';
    if (bad.length || lsBad) fail('señales del árbitro: ' + bad.map(k => k + ' -> ' + got[k].signal + ' (esperado ' + cases[k][1] + ')').join('; ') + (lsBad ? ' | landSide ' + ls.join() : ''));
    else console.log('señales del árbitro (fuera / tocado / dentro / 8 s / no golpea / ataque / debajo / antena) y landSide OK');
  }
  // highlight: momentos grandes (bloqueo directo y remate perfecto del humano con punto de partido) >= 0,8
  {
    const mpGame = (seed, score, sets, demo) => { const gq = S.createGame({ demo: !!demo, seed }); gq.sets = sets; gq.score = score.slice(); S._setupServe(gq); S.drainEvents(gq); return gq; };
    // remate perfecto del humano (te = 0 -> 'perfect') con punto de partido a favor, que cae dentro
    const gk = mpGame(130, [24, 21], [1, 0]), h = gk.teams[0][0];
    if (gk.matchPoint !== 0) fail('prueba de punto de partido mal montada');
    rallyAt(gk, { x: 0.9, y: 0.5, z: 3.1, vz: -0.5 }); gk.touchTeam = 0; gk.touches = 2; gk.lastTeam = 0; gk.lastKind = 'set'; gk.lastPlayer = gk.teams[0][1];
    gk.ctrl = h; h.x = 1.2; h.y = 0.5; h.z = 0.8; h.vz = 0.5; gk.teams[0][1].x = 6;
    for (const q of gk.teams[1]) { q.x = -8.8; q.y = 4.4; }
    S._hit(gk, h, null, 0, '', [-4.5, -2.5]); gk.digOk = false; // (la defensa IA no la saca: el test mide la nota, no la defensa)
    const ek = S.drainEvents(gk).concat(stepUntil(gk, 'point', 600)), hk = ek.find(e => e.type === 'hit'), pk = ek.find(e => e.type === 'point');
    // bloqueo directo con punto de partido: del que bloquea ([24,22], sets 1-0) y del rival (salvado: [22,24], sets 0-1)
    const stuffAt = (score, sets) => {
      for (let s = 0; s < 400; s++) {
        const gs2 = mpGame(700 + s, score, sets, true), blk = gs2.teams[0][0];
        rallyAt(gs2, { x: -0.5, y: 0, z: 3.0, vx: 9, vz: -1.5 }); gs2.touchTeam = 1; gs2.lastTeam = 1; gs2.touches = 3; gs2.lastKind = 'spike'; gs2.lastPlayer = gs2.teams[1][0];
        blk.x = 0.5; blk.y = 0; blk.z = 0.8; blk.vz = 0.3; gs2.teams[0][1].x = 6; gs2.teams[1][0].x = -1.5; gs2.teams[1][1].x = -5;
        const evs = stepUntil(gs2, 'point', 600), bk = evs.find(e => e.type === 'block'), pe = evs.find(e => e.type === 'point');
        if (bk && bk.result === 'stuff' && pe && pe.how === 'block' && pe.team === 0) return pe;
      }
      return null;
    };
    const sOwn = stuffAt([24, 22], [1, 0]), sSaved = stuffAt([22, 24], [0, 1]);
    // fórmula en sus extremos; errores: tope 0,35 salvo que cierren el set
    const H = S.highlightOf;
    const fx = [
      [H({ how: 'error', rallyHits: 30, digs: 4, setPoint: true, matchPoint: true, saved: true, streak: 5 }), 0.35],
      [H({ how: 'error', rallyHits: 3, digs: 0, setPoint: true, matchPoint: true, setWon: true, matchWon: true, streak: 1 }), 0.75],
      [H({ how: 'kill', rallyHits: 3, digs: 0, streak: 1 }), 0.15],
      [H({ how: 'ace', rallyHits: 0, digs: 0, streak: 3 }), 0.5],
      // jugada épica: peloteo (0,35) + defensas (0,3) con tope conjunto 0,4 -> 0,55 justo (grande por sí sola)
      [H({ how: 'kill', rallyHits: 20, digs: 5, streak: 1 }), 0.55],
      [H({ how: 'kill', rallyHits: 10, digs: 1, streak: 1 }), 0.38],
      [H({ how: 'block', rallyHits: 30, digs: 5, setPoint: true, matchPoint: true, saved: true, streak: 4 }), 1],
      // SIM-05: el punto de bloqueo siempre es grande; final apretado 0,28 y punto de set 0,15 no se suman (el mayor)
      [H({ how: 'block', rallyHits: 2, digs: 0, streak: 1 }), 0.55],
      [H({ how: 'kill', rallyHits: 3, digs: 0, clutch: true, streak: 1 }), 0.43],
      [H({ how: 'kill', rallyHits: 3, digs: 0, clutch: true, setPoint: true, streak: 1 }), 0.43],
      [H({ how: 'kill', rallyHits: 3, digs: 0, setPoint: true, streak: 1 }), 0.3],
      [H({ how: 'kill', rallyHits: 3, digs: 0, perfectKill: true, streak: 1 }), 0.25],
      [H({ how: 'kill', rallyHits: 3, digs: 0, perfectKill: true, setPoint: true, matchPoint: true, streak: 1 }), 0.85],
      [H({ how: 'error', rallyHits: 3, digs: 0, clutch: true, saved: true, streak: 4 }), 0.35]
    ];
    const fBad = fx.map(([a, b], i) => Math.abs(a - b) < 1e-9 ? '' : '#' + i + ' ' + a + ' != ' + b).filter(Boolean);
    const msg = 'highlight: remate perfecto del humano con punto de partido ' + (pk && pk.highlight) + ' (' + (hk && hk.grade) + ', ' + (pk && pk.how) + '), bloqueo directo con punto de partido ' +
      (sOwn && sOwn.highlight) + ' / salvándolo ' + (sSaved && sSaved.highlight);
    if (!hk || hk.grade !== 'perfect' || !hk.human || !pk || pk.how !== 'kill' || !pk.matchWon || !(pk.highlight >= 0.8) || gk.lastPoint.highlight !== pk.highlight) fail(msg + ' [remate]');
    else if (!sOwn || !(sOwn.highlight >= 0.8) || sOwn.savedSetPoint || !sSaved || !(sSaved.highlight >= 0.8) || !sSaved.savedSetPoint) fail(msg + ' [bloqueo]');
    else if (fBad.length) fail('highlightOf fuera de la fórmula: ' + fBad.join(', '));
    else console.log(msg + ', errores <= 0,35 y fórmula OK');
  }
  // defensas de remate (digs) y racha (streak) en un peloteo montado
  {
    const gd = S.createGame({ demo: true, seed: 140 }); gd.score = [3, 5]; gd.streakTeam = 1; gd.streakN = 2; // el equipo 1 lleva 2 seguidos
    const d1 = gd.teams[0][0], d2 = gd.teams[0][1];
    const incoming = (kind, shot, prev, touches) => { rallyAt(gd, { x: 3, y: 0, z: 1.2, vx: 4, vz: -1 }); gd.touchTeam = 1; gd.lastTeam = 1; gd.touches = touches; gd.lastKind = kind; gd.lastShot = shot; gd.prevKind = prev; gd.lastPlayer = kind === 'block' ? null : gd.teams[1][0]; };
    d1.x = 3.4; d1.y = 0; d1.z = 0; d2.x = 3.4; d2.y = 0.3; d2.z = 0;
    incoming('spike', 'power', 'set', 3); S._hit(gd, d1, null, 0.01, '', null); const n1 = gd.rally.digs;   // defensa de remate: cuenta
    incoming('serve', 'float', '', 3); S._hit(gd, d1, null, 0.01, '', null); const n2 = gd.rally.digs;     // recepción del saque: no
    incoming('block', 'touch', 'spike', 0); S._hit(gd, d2, null, 0.01, '', null); const n3 = gd.rally.digs;// tras tocar su bloqueo: cuenta
    incoming('spike', 'power', 'set', 3); S._hit(gd, d1, null, 0.01, 'body', null); const n4 = gd.rally.digs;// rebote en el cuerpo: no
    rallyAt(gd, { x: -5, y: 0, z: 0.4, vz: -3 }); gd.lastTeam = 0; gd.lastKind = 'spike'; gd.touchTeam = 0;
    const pd = stepUntil(gd, 'point', 300).find(e => e.type === 'point');
    S._setupServe(gd); S.drainEvents(gd); rallyAt(gd, { x: -5, y: 0, z: 0.4, vz: -3 }); gd.lastTeam = 0; gd.lastKind = 'spike'; gd.touchTeam = 0;
    const pd2 = stepUntil(gd, 'point', 300).find(e => e.type === 'point');
    if (n1 !== 1 || n2 !== 1 || n3 !== 2 || n4 !== 2 || !pd || pd.digs !== 2 || pd.streak !== 1 || !pd2 || pd2.streak !== 2 || pd2.digs !== 0)
      fail('digs/streak: ' + JSON.stringify([n1, n2, n3, n4, pd && pd.digs, pd && pd.streak, pd2 && pd2.streak, pd2 && pd2.digs]));
    else console.log('defensas de remate (digs ' + pd.digs + ': remate y toque de bloqueo sí; saque y cuerpo no) y racha (corta la del rival: ' + pd.streak + ', luego ' + pd2.streak + ') OK');
  }
  // pausa de presentación y skipHold (SIM-03)
  {
    const finish = (present, score, sets, setNo) => {
      const gq = S.createGame({ demo: false, seed: 150, present }); if (sets) gq.sets = sets; if (setNo) gq.setNo = setNo; gq.score = score.slice(); S._setupServe(gq); S.drainEvents(gq);
      rallyAt(gq, { x: -5, y: 0, z: 0.4, vz: -3 }); gq.lastTeam = 0; gq.lastKind = 'spike'; gq.lastShot = 'power'; gq.touches = 3; gq.touchTeam = 0;
      for (const q of gq.players) { q.x = S.side(q.team) * 8.5; q.y = 3; }
      return gq;
    };
    const pointOf = (gq) => { const all = stepUntil(gq, 'point', 300); return { p: all.find(e => e.type === 'point'), all }; };
    const res = [];
    // set ganado con g.present: pausa VB.HOLD.set (4,0 s); skipHold no a los 0,5 s, sí a los 0,9 s, y sale de 'point' en <= 0,3 s
    const gs = finish(true, [24, 20]), ps = pointOf(gs).p;
    const holdOk = ps && ps.setWon && Math.abs(ps.hold - VB.HOLD.set) < 1e-9 && Math.abs(gs.timer - VB.HOLD.set) < 1e-9;
    let tq = 0; while (tq < 0.5 - 1e-9) { S.step(gs, DT, null); tq += DT; } S.drainEvents(gs);
    const s05 = S.skipHold(gs), t05 = gs.timer;
    while (tq < 0.9 - 1e-9) { S.step(gs, DT, null); tq += DT; } S.drainEvents(gs);
    const s09 = S.skipHold(gs), t09 = gs.timer; let left = -1; const after = [];
    for (let i = 1; i <= 120 * 0.3 + 1; i++) { S.step(gs, DT, null); after.push(...S.drainEvents(gs)); if (gs.mode !== 'point') { left = i * DT; break; } }
    res.push(['set con present', holdOk && !s05 && t05 > 2.8 && s09 && Math.abs(t09 - 0.3) < 1e-9 && left > 0 && left <= 0.3 + 1e-9 && gs.mode === 'serve' &&
      after.some(e => e.type === 'newSet') && after.some(e => e.type === 'serveReady'), { hold: ps && ps.hold, s05, s09, t09, left, mode: gs.mode }]);
    // sin present: la pausa clásica del set (3,6 s)
    const gl = finish(false, [24, 20]), pl = pointOf(gl).p;
    res.push(['set sin present', pl && pl.hold === 3.6 && gl.timer === 3.6, pl && pl.hold]);
    // punto normal con present: 1,9 s
    const gr = finish(true, [10, 12]), pr = pointOf(gr).p;
    res.push(['punto normal con present', pr && pr.highlight < 0.55 && pr.hold === 1.9, pr && [pr.highlight, pr.hold]]);
    // punto grande con present (punto de set salvado con racha de 3): 2,4 s
    const gbg = finish(true, [22, 24]); gbg.streakTeam = 0; gbg.streakN = 2; const pbg = pointOf(gbg).p;
    res.push(['punto grande con present', pbg && pbg.highlight >= 0.55 && pbg.hold === 2.4 && pbg.savedSetPoint, pbg && [pbg.highlight, pbg.hold]]);
    // partido con present: 'over' 4,2 s; skipHold a 1 s -> gameOver a los <= 1,3 s; ya terminado, skipHold = false
    const gm = finish(true, [24, 20], [1, 0]), pm = pointOf(gm).p;
    let skM = null, goT = -1;
    for (let i = 0; i < 120 * 6 && goT < 0; i++) { if (i === 120) skM = S.skipHold(gm); S.step(gm, DT, null); if (S.drainEvents(gm).some(e => e.type === 'gameOver')) goT = (i + 1) * DT; }
    res.push(['partido con present', pm && pm.matchWon && pm.hold === 4.2 && skM === true && goT > 1 && goT <= 1.3 + 1e-9 && gm.mode === 'over' && S.skipHold(gm) === false, pm && [pm.hold, skM, goT]]);
    // sin efecto en 'serve' ni en 'rally'
    const gx = S.createGame({ demo: false, seed: 151, present: true }); gx.hold = 5; const tx0 = gx.timer, sx = S.skipHold(gx);
    rallyAt(gx, { x: 3, y: 0, z: 3 }); const sr2 = S.skipHold(gx);
    res.push(['saque/peloteo', !sx && !sr2 && gx.timer === tx0, [sx, sr2]]);
    // cambio de campo a los 8 del set decisivo con present: pausa del punto + 1,4 s
    const g8p = finish(true, [7, 4], [1, 1], 3), r8 = pointOf(g8p), p8p = r8.p;
    res.push(['8 del 3.er set con present', p8p && r8.all.some(e => e.type === 'courtChange' && e.why === 'eight') && Math.abs(p8p.hold - (p8p.highlight >= 0.55 ? 2.4 : 1.9) - 1.4) < 1e-9, p8p && p8p.hold]);
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('pausa de presentación / skipHold: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    else console.log('pausa de presentación (set ' + VB.HOLD.set + ' s; skipHold no a 0,5 s, sí a 0,9 s -> saque en ' + res[0][2].left.toFixed(3) + ' s; normal 1,9; grande 2,4; partido 4,2; 8 del 3.er set +1,4; sin present 3,6) OK');
  }
  // dificultades: alias en castellano
  if (S.createGame({ difficulty: 'Difícil', seed: 1 }).difficulty !== 'hard' || S.createGame({ difficulty: 'facil', seed: 1 }).difficulty !== 'easy' || S.createGame({ difficulty: 'Experto', seed: 1 }).difficulty !== 'expert') fail('alias de dificultad');
  else console.log('dificultad (alias easy/normal/hard/expert, facil/dificil/experto) OK');
  // la CPU nunca deja caer su propio lanzamiento de saque (el desfase tardío muestreado cabe en la ventana de alcance)
  {
    let tosses = 0, drops = 0; const ev = [];
    for (const diff of VB.DIFF_ORDER) for (const rookie of [true, false]) for (let sd = 1; sd <= 3; sd++) {
      const g = S.createGame({ seed: sd * 7 + 3, difficulty: diff, rookie, present: true });
      for (let i = 0; i < 120 * 150 && g.mode !== 'over'; i++) {
        S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
        for (const e of ev) { if (e.type === 'toss' && e.team === 1) tosses++; if (e.type === 'point' && e.reason === 'serve' && e.team === 0) drops++; }
      }
    }
    if (drops || !tosses) fail('la CPU deja caer su lanzamiento de saque: ' + drops + ' de ' + tosses);
    else console.log('saque de la CPU: 0 lanzamientos caídos en ' + tosses + ' (4 niveles, primer partido sí/no) OK');
  }
  // SIM-04: ritual del sacador CPU (las comprobaciones de cada saque van en ritualChecker, dentro de run())
  {
    const res = [], R = VB.RITUAL, ev = [];
    const untilToss = (g, team) => { for (let i = 0; i < 120 * 60; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev); const t = ev.find(e => e.type === 'toss' && (team == null || e.team === team)); if (t) return t; } return null; };
    // 1) no gasta el azar del partido: con y sin ritual, tras el primer lanzamiento de la CPU el generador está en el mismo punto
    { const a = S.createGame({ seed: 4242, autopilot: true }), b = S.createGame({ seed: 4242, autopilot: true, ritual: false });
      const ta = untilToss(a), tb = untilToss(b);
      res.push(['sin gastar g.rng', ta && tb && ta.jump === tb.jump && a.aiServeTe === b.aiServeTe && a.rng() === b.rng() && b.cpuTossIn === -1 && !b.ritual.on, [ta && ta.t, tb && tb.t]]); }
    // 2) determinista: misma semilla -> mismos rituales; el estilo es del jugador (mismo número de botes base en su mayoría)
    { const seq = sd => { const g = S.createGame({ seed: sd, demo: false, autopilot: true }), out = [], per = {}; for (let i = 0; i < 120 * 600; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
          for (const e of ev) if (e.type === 'serveReady') { out.push(e.player.id + ':' + g.ritual.bounces + ':' + g.ritual.dur.toFixed(4)); if (!g.ritual.press) (per[e.player.id] = per[e.player.id] || []).push(g.ritual.bounces); } }
        return { out, per, g }; };
      const s1 = seq(99), s2 = seq(99), s3 = seq(100);
      let styleOk = true, styles = [];
      for (const id in s1.per) { const v = s1.per[id], base = S._ritualStyle(s1.g, s1.g.players[id]).n, k = v.filter(x => x === base).length / v.length; styles.push(id + ':' + base + '(' + (100 * k).toFixed(0) + '%)'); if (v.length >= 8 && k < 0.65) styleOk = false; }
      res.push(['determinista y con estilo propio', s1.out.join() === s2.out.join() && s1.out.join() !== s3.out.join() && styleOk, styles.join(' ')]); }
    // 3) con punto de set la CPU se toma su tiempo (un bote más y pausa más larga, hasta 3 botes y 1,6 s)
    { const g = S.createGame({ seed: 77, autopilot: true }); g.serving = 1; g.score = [20, 24]; S._setupServe(g);
      const r = g.ritual, st = S._ritualStyle(g, g.server);
      res.push(['punto de set: más ritual', r.press && r.bounces >= Math.min(3, st.n) && r.dur <= R.maxDur + 1e-9 && g.cpuTossIn > 0, [r.bounces, st.n, r.dur]]); }
    // 4) el balón es función pura del tiempo del ritual, continuo, y la mano vuelve a por él (bote en el suelo, recogida a la altura de la mano)
    { const g = S.createGame({ seed: 5, autopilot: true }); g.serving = 1; S._setupServe(g);
      const sv = g.server, r = g.ritual, o1 = {}, o2 = {}, h = {};
      let maxStep = 0, prev = null, minZ = 9, handBall = 0, pure = true;
      for (let i = 0; i < 120 * 3 && g.serveState === 'ready'; i++) {
        S.step(g, DT, null); S.drainEvents(g);
        if (!r.on) break;
        S._ritualBall(g, sv, r, o1); S._ritualBall(g, sv, r, o2); if (o1.z !== o2.z || Math.abs(o1.z - g.ball.z) > 1e-9) pure = false;
        if (prev) maxStep = Math.max(maxStep, Math.hypot(g.ball.x - prev[0], g.ball.y - prev[1], g.ball.z - prev[2]));
        prev = [g.ball.x, g.ball.y, g.ball.z]; minZ = Math.min(minZ, g.ball.z);
        S._holdPos(g, sv, h); if (r.phase === 'pre' || r.phase === 'post' || r.phase === 'done') handBall = Math.max(handBall, Math.hypot(h.x - g.ball.x, h.y - g.ball.y, h.z - g.ball.z));
      }
      res.push(['balón puro, continuo y en la mano fuera de los botes', pure && maxStep < 0.08 && Math.abs(minZ - C.BR) < 1e-9 && handBall < 1e-9, [maxStep.toFixed(4), minZ, handBall]]); }
    // 5) el sacador humano no hace ritual y su saque sigue igual (cpuTossIn -1, sin dribble)
    { const g = S.createGame({ seed: 6 }); let dr = 0, okT = true; for (let i = 0; i < 120 * 3; i++) { S.step(g, DT, { move: [0, 0], hit: i === 150, jump: false }); ev.length = 0; S.drainEvents(g, ev); dr += ev.filter(e => e.type === 'dribble').length; if (g.mode === 'serve' && g.cpuTossIn !== -1) okT = false; }
      res.push(['humano sin ritual', dr === 0 && okT && !g.ritual.on, dr]); }
    // 6) la demo del menú: ritual más corto (RITUAL.demoBounces botes como mucho, hoy 1; ~0,8 s)
    { const g = S.createGame({ seed: 8, demo: true }); let mx = 0, mb = 0; for (let i = 0; i < 120 * 300; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev); for (const e of ev) if (e.type === 'serveReady') { mx = Math.max(mx, g.ritual.dur); mb = Math.max(mb, g.ritual.bounces); } }
      res.push(['demo: ritual corto', mb >= 1 && mb <= R.demoBounces && mx <= 1.2, [mb, mx.toFixed(3)]]); }
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('ritual del sacador CPU: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    else console.log('ritual del sacador CPU (sin gastar azar, determinista, estilo por jugador ' + res[1][2] + ', punto de set, balón puro y continuo, humano sin ritual, demo corta) OK');
  }
  // A1/A2: remate apuntado (mira libre g.aim3 en el aire y dispersión según el timing, Sim.spikeSpread)
  {
    const res = [];
    // spikeSpread: monótona decreciente y con los valores del contrato
    { let mono = true, prev = 1e9; for (let q = 0; q <= 1.0001; q += 0.01) { const s = S.spikeSpread(q); if (s > prev + 1e-12) mono = false; prev = s; }
      const v = [0.9, 0.78, 0.5, 0.2].map(q => S.spikeSpread(q));
      res.push(['spikeSpread monótona y calibrada', mono && v[0] <= 0.1 && Math.abs(v[1] - 0.3) < 0.06 && Math.abs(v[2] - 0.75) < 0.08 && Math.abs(v[3] - 1.3) < 0.1, v.map(x => x.toFixed(3))]); }
    // la mira empieza en la diagonal al despegar y la dirección la mueve (~11 m/s) dentro del campo rival
    const setup = (seed, hz) => {
      const g = S.createGame({ demo: false, seed }), h = g.teams[0][0], m = g.teams[0][1];
      rallyAt(g, { x: 1.2, y: 0.5, z: 4.6, vz: 0 }); g.touchTeam = 0; g.touches = 2; g.lastTeam = 0; g.lastPlayer = m; g.lastKind = 'set';
      g.ctrl = h; h.x = 1.5; h.y = 0.5; h.z = hz; h.vz = 2.5; m.x = 6; m.y = -2;
      for (const q of g.teams[1]) { q.x = -8; q.y = q.idx ? 4.5 : -4.5; }
      return g;
    };
    { const g = setup(61, 0.3); S.step(g, DT, { move: [0, 0], hit: false, jump: false });
      const d0 = [g.aim3.x, g.aim3.y], on0 = g.aim3.on;
      for (let i = 0; i < 24; i++) S.step(g, DT, { move: [-1, 0], hit: false, jump: false }); // 0,2 s hacia el fondo
      const dx = g.aim3.x - d0[0];
      for (let i = 0; i < 120; i++) S.step(g, DT, { move: [0, 1], hit: false, jump: false }); // hasta la lateral
      res.push(['mira libre: empieza en la diagonal y se mueve', on0 && Math.abs(d0[0] + 6) < 0.01 && Math.abs(d0[1] + 1.6) < 0.01 && dx < -1.8 && dx > -2.6 &&
        (!g.aim3.on || (g.aim3.y <= 3.9 + 1e-9 && g.aim3.x <= -1.4 && g.aim3.x >= -8.3)), [on0, d0, dx.toFixed(2), g.aim3.y.toFixed(2)]]); }
    { const g = S.createGame({ demo: false, seed: 62 }); S.step(g, DT, null); const g2 = S.createGame({ demo: false, seed: 62 }); g2.serving = 1; S._setupServe(g2); S.step(g2, DT, null);
      res.push(['mira libre apagada fuera del ataque', g.aim3.kind === 'serve' && !g2.aim3.on, [g.aim3.on, g.aim3.kind, g2.aim3.on]]); }
    // el remate cae en la diana: perfecto <= ~0,25 m; tarde 0,12 s claramente más disperso
    const errAt = (te) => {
      const errs = [];
      for (let k = 0; k < 24; k++) {
        const g = setup(100 + k, 0.6); g.ball.z = C.NET_H + 0.6; g.ball.x = 1.4; g.ball.y = 0.5; g.ball.vz = -0.5;
        const h = g.ctrl; h.x = 1.6; h.y = 0.5; h.z = 0.6; h.vz = 0.3;
        g.aim3.on = true; g.aim3.kind = 'spike'; g.aim3.x = -(3 + (k % 5)); g.aim3.y = -3 + (k % 7);
        const tx = g.aim3.x, ty = g.aim3.y;
        S._hit(g, h, null, te, ''); const hv = S.drainEvents(g).find(e => e.type === 'hit');
        if (!hv || hv.kind !== 'spike') { errs.push(99); continue; }
        const ld = S.predictLanding(g, {}); // bote previsto (la defensa de la CPU podría tocarlo antes)
        errs.push(ld ? Math.hypot(ld.x - tx, ld.y - ty) : 99);
      }
      return errs;
    };
    { const ep = errAt(0), el = errAt(0.12), mp = ep.reduce((a, b) => a + b) / ep.length, ml = el.reduce((a, b) => a + b) / el.length;
      res.push(['remate a la diana (perfecto exacto, tarde disperso)', Math.max(...ep) < 0.3 && mp < 0.15 && ml > mp + 0.15, [mp.toFixed(3), Math.max(...ep).toFixed(3), ml.toFixed(3)]]); }
    // aimPoint usa la mira y da spreadNow
    { const g = setup(63, 0.3); S.step(g, DT, null); const ap = S.aimPoint(g, {}, null);
      res.push(['aimPoint con la mira y spreadNow', ap && ap.kind === 'spike' && ap.x === g.aim3.x && ap.y === g.aim3.y && ap.spreadNow >= 0 && ap.spreadNow <= 1.75, ap && [ap.x, ap.y, ap.spreadNow]]); }
    // A3: remate perfecto de la CPU contra el humano -> g.digTight; el humano defiende con te x1,5
    { const g = S.createGame({ demo: false, seed: 64 }), c = g.teams[1][0];
      rallyAt(g, { x: -1.4, y: 0, z: C.NET_H + 0.6, vz: -0.5 }); g.touchTeam = 1; g.touches = 2; g.lastTeam = 1; g.lastPlayer = g.teams[1][1]; g.lastKind = 'set';
      c.x = -1.6; c.y = 0; c.z = 0.6; S._hit(g, c, null, 0, ''); const t1 = g.digTight;
      const g2 = S.createGame({ demo: false, seed: 64 }), c2 = g2.teams[1][0];
      rallyAt(g2, { x: -1.4, y: 0, z: C.NET_H + 0.6, vz: -0.5 }); g2.touchTeam = 1; g2.touches = 2; g2.lastTeam = 1; g2.lastPlayer = g2.teams[1][1]; g2.lastKind = 'set';
      c2.x = -1.6; c2.y = 0; c2.z = 0.6; S._hit(g2, c2, null, 0.2, ''); const t2 = g2.digTight;
      // defensa del humano con desfase 0,04: con digTight la calidad es la de 0,06
      const g3 = S.createGame({ demo: false, seed: 65 }), h = g3.teams[0][0];
      rallyAt(g3, { x: 5, y: 0, z: 0.8, vx: 8, vz: -3 }); g3.touchTeam = 1; g3.touches = 3; g3.lastTeam = 1; g3.lastKind = 'spike'; g3.lastPlayer = g3.teams[1][0];
      g3.ctrl = h; h.x = 5.2; h.y = 0; h.z = 0; g3.digTight = true; S._hit(g3, h, null, 0.04, ''); const hv = S.drainEvents(g3).find(e => e.type === 'hit');
      res.push(['defensa más justa tras remate perfecto', t1 && !t2 && hv && Math.abs(hv.timing - 0.06) < 1e-9 && !g3.digTight, [t1, t2, hv && hv.timing]]); }
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('remate apuntado: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    else console.log('remate apuntado (spikeSpread ' + res[0][2].join('/') + ', mira libre, error perfecto/tarde ' + res[3][2].join('/') + ' m, aimPoint, digTight) OK');
  }
  // B1-B3: error arbitral en botes justos y challenge
  {
    const res = [];
    // bote del remate de team (0: cae en el campo de la CPU; 1: en el del humano) con la huella a dist m de la línea lateral
    const landAt = (seed, dist, team, pre) => {
      const g = S.createGame({ demo: false, seed });
      if (pre) pre(g);
      const sx = team === 0 ? -1 : 1, y = -(C.HW + C.IN_TOL - dist);
      rallyAt(g, { x: sx * 5, y, z: 0.6, vz: -3 });
      g.lastTeam = team; g.touchTeam = team; g.lastKind = 'spike'; g.lastShot = 'power'; g.touches = 3; g.lastPlayer = g.teams[team][0];
      for (const p of g.players) { p.x = S.side(p.team) * 8.5; p.y = 3; }
      const ev = stepUntil(g, 'point', 240);
      return { g, ld: ev.find(e => e.type === 'land'), pt: ev.find(e => e.type === 'point') };
    };
    // tasa de error por banda; nunca con |dist| > 0,10
    { const bands = [[0, 0.02, 0.35, 0.55], [0.02, 0.05, 0.22, 0.38], [0.05, 0.1, 0.09, 0.21], [0.105, 0.3, 0, 0]], rates = [];
      let ok = true, fieldsOk = true;
      for (const [a, bnd, lo, hi] of bands) {
        let n = 0, w = 0;
        for (let k = 0; k < 500; k++) {
          const d = (a + (bnd - a) * ((k * 0.618034) % 1)) * (k % 2 ? 1 : -1);
          const r = landAt(1000 + k, d, k % 4 < 2 ? 0 : 1); const c = r.g.call; n++;
          if (!c || Math.abs(c.dist - d) > 0.03 || c.truthIn !== (c.dist >= 0) || c.calledIn !== r.ld.inside || c.wrong !== (c.calledIn !== c.truthIn) || c.team !== 1 - r.pt.team) fieldsOk = false;
          if (c && c.wrong) w++;
        }
        rates.push((w / n).toFixed(3)); if (w / n < lo || w / n > hi) ok = false;
      }
      res.push(['error arbitral por bandas (0-2, 2-5, 5-10, >10 cm)', ok && fieldsOk, [rates, fieldsOk]]); }
    // sin bote no hay llamada
    { const g = S.createGame({ demo: false, seed: 5 }), p = g.teams[0][0], q = g.teams[0][1];
      rallyAt(g, { x: 3, y: 0, z: 1.5, vz: -1 }); g.touchTeam = 0; g.touches = 3; g.lastPlayer = q; g.lastKind = 'free'; S._hit(g, p, null);
      res.push(['sin bote: g.call null y sin challenge', g.call === null && S.canChallenge(g, 0) === 0, g.call]); }
    // busca un bote mal cantado contra el humano (fuera por 1 cm, cantado dentro)
    const findWrong = (pre, wantWrong, dist) => { for (let s = 1; s < 3000; s++) { const r = landAt(s, dist == null ? -0.01 : dist, 1, pre); if (r.g.call && r.g.call.wrong === wantWrong) return r; } return null; };
    const review = (g, team) => { const ev = []; for (let i = 0; i < 120 * 6; i++) { S.step(g, DT, null); ev.push(...S.drainEvents(g)); if (ev.some(e => e.type === 'challengeResult')) break; } return ev; };
    // acertado: anula el punto y lo conserva
    { const r = findWrong(null, true), g = r.g, s0 = g.score.slice(), w0 = 1 - g.call.team;
      const left = S.canChallenge(g, 0), cpuNo = S.canChallenge(g, 1) === 0, ok = S.challenge(g, 0), rv = g.review && Object.assign({}, g.review);
      const ev = review(g, 0), cr = ev.find(e => e.type === 'challengeResult'), ch = S.drainEvents(g);
      res.push(['challenge acertado anula el punto', left > 6.9 && cpuNo && ok && rv && rv.overturned && rv.dur === 4.5 && cr && cr.overturned && g.review === null &&
        g.score[0] === s0[0] + 1 && g.score[1] === s0[1] - 1 && g.challenges[0] === 2 && cr.left[0] === 2 && w0 === 1 && S.canChallenge(g, 0) === 0 && S.canChallenge(g, 1) === 0 &&
        ev.some(e => e.type === 'point' && e.team === 0), [left, s0, g.score, g.challenges]]); }
    // acertado en punto de set, pedido cuando ya ha empezado el set siguiente: el set vuelve atrás
    { const pre = g => { g.score = [23, 24]; g.serving = 1; };
      const r = findWrong(pre, true), g = r.g; const setW = r.pt.setWon;
      for (let i = 0; i < 120 * 4.2 && g.setNo === 1; i++) { S.step(g, DT, null); S.drainEvents(g); } // la pausa del set acaba: nuevo set
      const mid = [g.setNo, g.sets.slice(), g.score.slice(), g.mode], left = S.canChallenge(g, 0), ok = S.challenge(g, 0);
      const ev = review(g, 0), cr = ev.find(e => e.type === 'challengeResult');
      const after = [g.setNo, g.sets.slice(), g.score.slice(), g.setScores.length, g.pendingSet, g.serving];
      for (let i = 0; i < 120 * 4 && g.mode !== 'serve'; i++) { S.step(g, DT, null); S.drainEvents(g); }
      res.push(['challenge acertado en punto de set (el set vuelve atrás)', setW && mid[0] === 2 && left > 0 && ok && cr && cr.overturned &&
        after[0] === 1 && after[1][0] === 0 && after[1][1] === 0 && after[2][0] === 24 && after[2][1] === 24 && after[3] === 0 && !after[4] && after[5] === 0 &&
        g.mode === 'serve' && g.setNo === 1 && g.server.team === 0, [mid, after, g.mode]]); }
    // fallado: se mantiene y gasta uno; con 0 ya no se puede
    { const r1 = findWrong(null, false, 0.01), g = r1.g, s0 = g.score.slice();
      const ok = S.challenge(g, 0), cr = review(g, 0).find(e => e.type === 'challengeResult');
      const keep = g.score[0] === s0[0] && g.score[1] === s0[1] && g.challenges[0] === 1 && cr && !cr.overturned && cr.left[0] === 1;
      g.challenges[0] = 0; const r2 = landAt(77, 0.2, 1, gg => { gg.challenges = [0, 2]; });
      res.push(['challenge fallado gasta uno', ok && keep && S.canChallenge(r2.g, 0) === 0 && !S.challenge(r2.g, 0), [s0, g.score, g.challenges]]); }
    // ventana de 7 s y fin de la ventana al sacar
    { const r = landAt(9, 0.2, 1), g = r.g; S.drainEvents(g);
      for (let i = 0; i < 120; i++) S.step(g, DT, null);
      const l1 = S.canChallenge(g, 0); const t0 = g.time; g.time = r.g.call.t + 7.01; const l2 = S.canChallenge(g, 0); g.time = t0;
      for (let i = 0; i < 120 * 8 && g.mode !== 'rally'; i++) { S.step(g, DT, null); S.drainEvents(g); }
      res.push(['ventana de 7 s (y se cierra al sacar)', Math.abs(l1 - 6) < 0.02 && l2 === 0 && g.mode === 'rally' && S.canChallenge(g, 0) === 0, [l1, l2, g.mode]]); }
    // la CPU pide challenge con criterio (~60 % con |dist| < 5 cm si el árbitro se equivocó, ~7 % si acertó; tras 1,5-3 s)
    { let n = 0, asked = 0, dOk = true, accepted = 0, good = 0;
      for (let s = 1; s <= 300; s++) {
        const r = landAt(5000 + s, (s % 2 ? 1 : -1) * 0.03, 0), g = r.g; if (!g.call || g.call.team !== 1) continue; n++;
        const t0 = g.call.t;
        for (let i = 0; i < 120 * 3.2; i++) { S.step(g, DT, null); const ev = S.drainEvents(g); const ch = ev.find(e => e.type === 'challenge');
          if (ch) { asked++; if (ch.team !== 1) dOk = false; const dt = g.time - t0; if (dt < 1.5 - 1e-6 || dt > 3.01) dOk = false; break; } }
        if (g.review) { if (g.review.overturned) good++; review(g, 1); accepted++; }
      }
      // y rara vez con un bote lejos de la línea (> 10 cm: nunca)
      let far = 0; for (let s = 1; s <= 60; s++) { const r = landAt(7000 + s, 0.4, 0); for (let i = 0; i < 120 * 3.2; i++) { S.step(r.g, DT, null); if (S.drainEvents(r.g).some(e => e.type === 'challenge')) { far++; break; } } }
      res.push(['la CPU pide challenge', n > 100 && asked / n > 0.08 && asked / n < 0.4 && good / asked > 0.5 && dOk && far === 0 && accepted === asked, [n, asked, good, far]]); }
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('error arbitral / challenge: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    else console.log('error arbitral (tasas ' + res[0][2][0].join('/') + ') y challenge (acertado, punto de set, fallado, ventana 7 s, CPU ' + res[6][2][1] + '/' + res[6][2][0] + ') OK');
  }
  // modo «controlar 1 jugador» (createGame({ctrl:'one'})): el humano (bot 'bueno') lleva siempre al mismo jugador y la IA al
  // compañero en todo (toques, saque, bloqueo). g.ctrl no cambia nunca, el compañero toca y saca, pasa/coloca al humano, la IA
  // no comete dobles ni 4 toques y los partidos (a 11) terminan. Por defecto sigue 'both'.
  {
    const f0 = failures, sum = { mate: 0, mateServe: 0, mateSet: 0, human: 0, mateBlock: 0, humanBlock: 0, matches: 0, pts: 0, mate11: 0, mate11Serve: 0, mate11Block: 0 };
    if (S.createGame({ seed: 1 }).ctrlMode !== 'both' || S.createGame({ seed: 1, ctrl: 'x' }).ctrlMode !== 'both') fail('ctrlMode por defecto no es both');
    // ctrlIdx (contrato del sprint): 0 = teams[0][0] (n.º 1, por defecto; el único que usa el juego), 1 = teams[0][1] (n.º 2, solo pruebas); fuera del modo 'one' o con
    // un valor raro, 0. Con el n.º 2 el orden de saque del equipo 0 va en espejo: el jugador del humano saca primero.
    { const gi = (o) => S.createGame(Object.assign({ demo: false, seed: 3 }, o));
      const a = gi({ ctrl: 'one', ctrlIdx: 1 }), b = gi({ ctrl: 'one' }), c = gi({ ctrl: 'both', ctrlIdx: 1 }), d = gi({ ctrl: 'one', ctrlIdx: 7 }), e = gi({ ctrl: 'one', ctrlIdx: '1' });
      if (a.ctrlIdx !== 1 || a.ctrl !== a.teams[0][1] || a.ctrl.num !== 2 || b.ctrl.num !== 1 || a.server !== a.ctrl) fail('ctrlIdx 1: ctrl/saque inicial ' + [a.ctrlIdx, a.ctrl.num, a.server && a.server.num]);
      if (b.ctrlIdx !== 0 || b.ctrl !== b.teams[0][0] || b.server !== b.ctrl) fail('ctrlIdx por defecto no es 0');
      if (c.ctrlIdx !== 0 || c.ctrl !== c.teams[0][0] || d.ctrlIdx !== 0 || e.ctrlIdx !== 1) fail('ctrlIdx fuera de modo uno / valor raro: ' + [c.ctrlIdx, d.ctrlIdx, e.ctrlIdx]); }
    for (let s = 1; s <= 6; s++) {
      const ci = s > 4 ? 1 : 0; // semillas 5-6: el humano lleva al n.º 2
      const g = S.createGame({ demo: false, seed: 9100 + s, difficulty: 'normal', ctrl: 'one', ctrlIdx: ci, points: 11 }), bot = makeBot(BOTS.bueno, s * 7 + 3);
      const me = g.ctrl, mate = S.other(g, me), ev = [];
      let ctrlBad = 0, sw = 0, aiFault = 0, lastT0 = null;
      if (g.ctrlMode !== 'one') fail('ctrl:one no guarda g.ctrlMode');
      if (me !== g.teams[0][ci]) fail('modo uno: ctrlIdx ' + ci + ' no lleva a teams[0][' + ci + ']');
      for (let i = 0; i < 120 * 60 * 30 && !g.finished; i++) {
        S.step(g, DT, bot(g)); ev.length = 0; S.drainEvents(g, ev);
        if (g.ctrl !== me) ctrlBad++;
        for (const e of ev) {
          if (e.type === 'switch') sw++;
          else if (e.type === 'hit' && e.team === 0) {
            if (e.player === mate) { if (e.kind === 'serve') sum.mateServe++; else sum.mate++; if (ci) { if (e.kind === 'serve') sum.mate11Serve++; else sum.mate11++; } }
            else { sum.human++; if (lastT0 && lastT0.player === mate && lastT0.kind !== 'serve' && e.kind !== 'serve') sum.mateSet++; }
            lastT0 = e;
          } else if (e.type === 'hit') lastT0 = null;
          else if (e.type === 'block' && e.team === 0) { if (e.player === mate) { sum.mateBlock++; if (ci) sum.mate11Block++; } else sum.humanBlock++; }
          // (point.player = el que comete la falta: un 4.º toque del humano tras el 3.º del compañero no es falta de la IA)
          else if (e.type === 'point') { sum.pts++; if ((e.reason === 'double' || e.reason === 'four') && e.team === 1 && e.player === mate) aiFault++; lastT0 = null; }
        }
      }
      if (g.finished) sum.matches++;
      if (ctrlBad || sw || aiFault) fail('modo uno (semilla ' + (9100 + s) + '): ctrl cambiado ' + ctrlBad + ' pasos, ' + sw + ' switch, ' + aiFault + ' dobles/4 toques del compañero IA');
    }
    if (sum.matches < 6 || sum.mate < 60 || sum.mateServe < 12 || sum.mateSet < 22 || sum.human < 60 || sum.mateBlock < 3 || sum.mate11 < 15 || sum.mate11Serve < 3 || sum.mate11Block < 1) fail('modo uno: ' + JSON.stringify(sum));
    else if (failures === f0) console.log('modo controlar 1 jugador OK ' + JSON.stringify(sum));
  }
  // modo uno: el HUMANO bloquea (arreglos finales del sprint cartoon). El bot 'bueno' casi nunca sube a la red en modo uno
  // (humanBlock 0 arriba), así que aquí un humano guionizado sube a la red en cada ataque rival (3.er toque de la CPU) y salta
  // cuando el atacante está en el aire: el humano bloquea, el compañero IA no salta a la vez ni bloquea, sin faltas de red.
  {
    const f0 = failures, out = [];
    for (const ci of [0, 1]) {
      const st = { phases: 0, jumps: 0, human: 0, mate: 0, mateJump: 0, net: 0 };
      for (let s = 1; s <= 6; s++) {
        const g = S.createGame({ demo: false, seed: 9100 + s, difficulty: 'normal', ctrl: 'one', ctrlIdx: ci, points: 11 }), bot = makeBot(BOTS.bueno, s * 7 + 3);
        let seen = -1, jumped = -1; const ev = [], mv = [0, 0];
        for (let i = 0; i < 120 * 60 * 30 && !g.finished; i++) {
          let inp = bot(g);
          if (g.mode === 'rally' && g.touchTeam === 1 && g.touches === 2 && g.ball.x < 0) {
            if (seen !== g.lastTouchT) { seen = g.lastTouchT; st.phases++; }
            const p = g.ctrl, dx = 0.6 - p.x, dy = g.pr3.y - p.y, d = Math.hypot(dx, dy);
            mv[0] = d > 0.15 ? dx / d : 0; mv[1] = d > 0.15 ? dy / d : 0;
            inp = { move: mv, hit: false, jump: false, switchPlayer: false };
            const att = g.teams[1].some(q => q.z > 0.35 && q.vz < 1.5 && Math.abs(q.x) < 4);
            if (att && p.z === 0 && Math.abs(p.x) < 1.2 && jumped !== g.lastTouchT) { inp.jump = true; jumped = g.lastTouchT; st.jumps++; }
            const m = S.other(g, p); if (g.defRole === 'block' && m.z > 0.3 && Math.abs(m.x) < 1.2) st.mateJump++;
          }
          S.step(g, DT, inp); ev.length = 0; S.drainEvents(g, ev);
          for (const e of ev) {
            if (e.type === 'block' && e.team === 0) { if (e.player === g.ctrl) st.human++; else st.mate++; }
            if (e.type === 'point' && e.reason === 'net' && e.team === 1) st.net++;
          }
        }
      }
      out.push(st);
      if (st.human < 30 || st.mate > 2 || st.mateJump > 0 || st.net > 2) fail('modo uno, bloqueo del humano (ctrlIdx ' + ci + '): ' + JSON.stringify(st));
    }
    if (failures === f0) console.log('modo uno: bloqueo del humano OK n.º 1 ' + JSON.stringify(out[0]) + ' · n.º 2 ' + JSON.stringify(out[1]));
  }
}


  // ---------- Estadísticas de jugador (opts.attrs): neutro = idéntico; más atributos = más puntos ----------
  {
    const f0 = failures, ev = [], all = v => { const o = {}; for (const k of S.ATTR_KEYS) o[k] = v; return o; };
    const play = (attrs, sd, secs) => { const g = S.createGame({ seed: sd, autopilot: true, difficulty: 'normal', attrs }), w = [0, 0], sig = [];
      for (let i = 0; i < secs * 120 && g.mode !== 'over'; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
        for (const e of ev) if (e.type === 'point') { w[e.team]++; sig.push(e.team + e.reason); } }
      return { w, sig: sig.join(',') }; };
    // (a) 50 en todo = sin atributos (misma secuencia de puntos con la misma semilla)
    for (const sd of [11, 222]) { const a = play(null, sd, 240), b = play([[all(50), all(50)], [all(50), all(50)]], sd, 240);
      if (a.sig !== b.sig) fail('atributos neutros cambian la sim (semilla ' + sd + ')'); }
    // (b) monotonía: el equipo CPU con 85 en todo gana más puntos que con 50, y con 15 menos
    const pct = v => { let w = 0, n = 0; for (let sd = 1; sd <= 12; sd++) { const r = play(v == null ? null : [null, [all(v), all(v)]], 900 + sd, 300); w += r.w[1]; n += r.w[0] + r.w[1]; } return w / Math.max(1, n); };
    const lo = pct(15), mid = pct(null), hi = pct(85);
    // (revisión «que se noten», 10-nov-2026: medido 15/50/85 = 19,9/42,4/61,8 %, antes 31,3/42,4/49,6; antes el margen exigido era ±3 puntos)
    if (!(hi > mid + 0.06 && lo < mid - 0.10)) fail('atributos sin efecto claro: 15→' + lo.toFixed(3) + ' 50→' + mid.toFixed(3) + ' 85→' + hi.toFixed(3));
    // (c) multiplicadores del humano a 50 = 1 (spike/serve son sumandos: 0)
    const k = S.attrK(all(50)); for (const n in k) { const want = n === 'spike' || n === 'serve' || n === 'accT' ? 0 : 1; if (k[n] !== want) fail('attrK(50).' + n + ' = ' + k[n] + ' (debe ser exactamente ' + want + ')'); }
    if (failures === f0) console.log('estadísticas de jugador OK · % puntos CPU con atributos 15/50/85: ' + [lo, mid, hi].map(x => (x * 100).toFixed(1)).join(' / '));
  }

  // ---------- Atributos que se notan (10-nov-2026): tablas medidas, monotonía y Carrera jugable ----------
  // Velocidad y Salto del humano con st 15/30/50/70/90 (el resto a 50) medidos con la física real (stepPlayer/jump), más la
  // ventana de timing del remate y la del bloqueo. 50 = sin atributos, EXACTO. Ver notes/sim.md, «Atributos que se notan».
  {
    const f0 = failures, all = v => { const o = {}; for (const k of S.ATTR_KEYS) o[k] = v; return o; }, LV = [15, 30, 50, 70, 90];
    const meas = v => {
      const g = S.createGame({ seed: 1, ctrl: 'one', ctrlIdx: 0, attrs: v == null ? null : [[Object.assign(all(50), { speed: v, jump: v }), null], null] }), p = g.teams[0][0];
      g.ctrl = p; g.mode = 'rally'; p.x = 10.5; p.y = 0;
      let d05 = 0, x09 = 0, t4 = NaN;
      for (let i = 1; i <= 160; i++) { S._stepPlayer(g, p, DT, -1, 0); if (i === 60) d05 = 10.5 - p.x; if (i === 108) x09 = p.x; if (i === 120) var d1 = 10.5 - p.x, vmax = (x09 - p.x) / 0.1; if (isNaN(t4) && 10.5 - p.x >= 4) t4 = i * DT; }
      p.x = 5; p.z = 0; p.vz = 0; let jump = 0, air = 0;
      S._jump(g, p, 0, 0); for (let i = 0; i < 400 && (p.z > 0 || p.vz > 0); i++) { S._stepPlayer(g, p, DT, 0, 0); jump = Math.max(jump, p.z); air += DT; }
      const k = p.ak || { jump: 1, wJmp: 1, wBlk: 1, wAtk: 1 }, jv = C.JUMP_V * k.jump, bw = jv * k.wJmp * k.wBlk;
      return { vmax, d05, d1, t4, jump, spikeZ: jump + C.ZC.spike, handZ: jump + 2.8, air, wPerf: C.W_PERFECT * k.wAtk * k.wJmp * 1000, wGood: C.W_GOOD * k.wAtk * k.wJmp * 1000,
        blk: 2 * Math.min(jv, 0.22 / 0.8 * bw) / C.G * 1000 };
    };
    const T = LV.map(meas), N = meas(null), cols = ['vmax', 'd05', 'd1', 'jump', 'spikeZ', 'wPerf', 'wGood', 'blk'];
    console.log('atributos (Velocidad y Salto = st, resto 50): st | vel. máx m/s | 0,5 s m | 1 s m | 4 m en s | salto m | contacto remate m | manos bloqueo m | aire s | ventana remate perfecto/bueno ±ms | bloqueo perfecto ms');
    T.forEach((r, i) => console.log('  ' + LV[i] + ' | ' + r.vmax.toFixed(2) + ' | ' + r.d05.toFixed(2) + ' | ' + r.d1.toFixed(2) + ' | ' + r.t4.toFixed(2) + ' | ' + r.jump.toFixed(2) + ' | ' +
      r.spikeZ.toFixed(2) + ' | ' + r.handZ.toFixed(2) + ' | ' + r.air.toFixed(2) + ' | ' + r.wPerf.toFixed(0) + '/' + r.wGood.toFixed(0) + ' | ' + r.blk.toFixed(0)));
    for (const c of cols) { if (T[2][c] !== N[c]) fail('atributos: con 50, ' + c + ' ' + T[2][c] + ' != sin atributos ' + N[c]);
      for (let i = 1; i < LV.length; i++) if (!(T[i][c] > T[i - 1][c])) fail('atributos: ' + c + ' no crece de ' + LV[i - 1] + ' a ' + LV[i] + ' (' + T[i - 1][c] + ' → ' + T[i][c] + ')'); }
    // que se NOTEN (umbrales holgados sobre lo medido el 10-nov-2026: 1 s 3,98/5,60/6,42 m; salto 0,74/1,06/1,28 m; ventana 28/35/39 ms; bloqueo 177/269/331 ms)
    if (!(T[0].d1 <= 0.75 * T[2].d1 && T[4].d1 >= 1.12 * T[2].d1)) fail('Velocidad: alcance en 1 s poco distinto ' + T[0].d1 + ' / ' + T[2].d1 + ' / ' + T[4].d1);
    if (!(T[0].t4 - T[2].t4 >= 0.2)) fail('Velocidad: con 15 llega a 4 m menos de 0,2 s más tarde que con 50');
    if (!(T[0].jump <= T[2].jump - 0.25 && T[4].jump >= T[2].jump + 0.15)) fail('Salto: altura poco distinta ' + T[0].jump + ' / ' + T[2].jump + ' / ' + T[4].jump);
    if (!(T[0].wPerf <= 0.82 * T[2].wPerf && T[0].blk <= 0.7 * T[2].blk && T[4].blk >= 1.15 * T[2].blk)) fail('Salto: ventanas de timing poco distintas');
    // resto de atributos: cada multiplicador del humano se mueve en el sentido bueno y de forma perceptible (≥ 10 % entre 15 y 90)
    { const lo = S.attrK(all(15)), hi = S.attrK(all(90)), up = ['jump', 'speed', 'wJmp', 'wRecv', 'wDig', 'wSet', 'wAtk', 'wSrv', 'wBlk', 'blk', 'hands'], down = ['spread', 'srvSpread', 'rec'];
      for (const n of up) if (!(hi[n] / lo[n] >= 1.1)) fail('attrK.' + n + ' casi no cambia: ' + lo[n] + ' → ' + hi[n]);
      for (const n of down) if (!(lo[n] / hi[n] >= 1.1)) fail('attrK.' + n + ' casi no cambia: ' + lo[n] + ' → ' + hi[n]);
      if (!(hi.spike - lo.spike >= 4 && hi.serve - lo.serve >= 3.5 && lo.accT > 0.25 && hi.accT === 0)) fail('attrK: potencia/saque/aceleración ' + JSON.stringify([lo.spike, hi.spike, lo.serve, hi.serve, lo.accT])); }
    // Bloqueo del humano: remate rival que cruza la red a ~3 m, el humano despega con un desfase aleatorio (−0,3..+0,1 s) y un error
    // lateral (±0,6 m) y, en cuanto está en el aire, pulsa GOLPEAR una vez (bloqueo activo, 11-nov-2026: sin pulsar nunca hay directo;
    // pulsado a tiempo, el directo depende del contacto). Bloqueo 15/50/90 (resto 50) y Salto 15/90. Medido el 10-nov-2026 sin la
    // pulsación (400 remates): Bloqueo 15/50/90 → toca 91/100/100 %, directos 36/52/57 %; Salto 15/90 → toca 91/100 %, directos 46/54 %.
    // Medido el 11-nov-2026 con la pulsación (300): Bloqueo 15/50/90 → toca 90/100/100 %, directos 49/64/72 %; Salto 15/90 → 90/100 %,
    // directos 57/66 %. 50 = sin atributos, exacto.
    { const PRESS = { move: [0, 0], hit: true, jump: false, jset: false, switchPlayer: false };
      const blkRun = (st, N) => { const o = { n: 0, blk: 0, stuff: 0 }, r = S._makeRng(77);
        for (let s = 0; s < N; s++) { const g = S.createGame({ seed: 500 + s, ctrl: 'one', ctrlIdx: 0, attrs: st ? [[st, null], null] : null }), p = g.teams[0][0], ev = []; g.ctrl = p;
          rallyAt(g, { x: -1.6, y: 0, z: 3.25, vx: 14, vz: -1 }); g.touchTeam = 1; g.lastTeam = 1; g.touches = 3; g.lastKind = 'spike'; g.lastPlayer = g.teams[1][0];
          g.teams[1][0].x = -1.8; g.teams[1][1].x = -5; g.teams[0][1].x = 6;
          const jv = C.JUMP_V * (p.ak ? p.ak.jump : 1), tj = 1.6 / 14 - jv / C.G - 0.3 + 0.4 * r(); p.x = 0.5; p.y = (r() - 0.5) * 1.2;
          if (tj <= 0) { S._jump(g, p, 0, 0); for (let k = 0; k < Math.round(-tj * 120); k++) S._stepPlayer(g, p, DT, 0, 0); }
          let t = 0, done = false, pressed = false;
          for (let i = 0; i < 600 && !done; i++) { t += DT; if (tj > 0 && Math.abs(t - tj) < DT / 2 + 1e-9) S._jump(g, p, 0, 0);
            let inp = null; if (!pressed && p.z > 0.25) { pressed = true; inp = PRESS; }   // en el aire: GOLPEAR = bajar el bloqueo
            S.step(g, DT, inp); ev.length = 0; S.drainEvents(g, ev);
            for (const e of ev) { if (e.type === 'block' && e.player === p) { o.blk++; if (e.result === 'stuff') o.stuff++; } if (e.type === 'point') done = true; } }
          o.n++; }
        return o; };
      const b = v => Object.assign(all(50), { block: v }), j = v => Object.assign(all(50), { jump: v }), N = 300;
      const B0 = blkRun(null, N), B = [15, 50, 90].map(v => blkRun(b(v), N)), J = [15, 90].map(v => blkRun(j(v), N));
      const pc = o => (100 * o.blk / o.n).toFixed(0) + '/' + (100 * o.stuff / o.n).toFixed(0);
      console.log('bloqueo del humano (toca/directo %): sin atributos ' + pc(B0) + ' · Bloqueo 15/50/90 ' + B.map(pc).join(' ') + ' · Salto 15/90 ' + J.map(pc).join(' '));
      if (B[1].blk !== B0.blk || B[1].stuff !== B0.stuff) fail('bloqueo: con 50 distinto de sin atributos');
      if (!(B[0].stuff < B[1].stuff - 0.08 * N && B[2].stuff > B[1].stuff && B[0].blk < B[1].blk && J[0].stuff < B[1].stuff && J[0].blk < B[1].blk && J[1].stuff >= B[1].stuff)) fail('bloqueo: Bloqueo/Salto sin efecto claro en el bloqueo del humano'); }
    // Carrera, Liga Regional: tú con la media inicial (35, Atacante y Colocador-receptor) + compañero del club (+3) con control
    // «solo tu jugador», contra Fácil con rivales del club (genSt(media ± 1)). Bots novato y medio. Medido el 10-nov-2026 (8 semillas
    // × 360 s): novato 50-56 % (sin atributos, 48 %), medio 63-70 % (sin atributos, 71 %): sigue siendo jugable.
    if (MIN >= 10) {
      const cx = { console, Math, Date, JSON, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }; cx.globalThis = cx; cx.window = cx; vm.createContext(cx);
      let G = null;
      try { for (const f of ['js/sim.js', 'js/prog.js', 'js/badges.js', 'js/career.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), cx, { filename: f }); G = cx.VB.Career && cx.VB.Career.genSt; } catch (e) { G = null; }
      if (!G) console.log('Carrera Regional: sin js/career.js (genSt), se salta');
      else {
        const out = [], ev = [];
        for (const bot of ['novato', 'medio']) { let w = 0, n = 0;
          for (const club of [28, 34, 40]) for (const role of ['atk', 'cr']) for (let s = 1; s <= 3; s++) {
            const r = S._makeRng(s * 31 + club), attrs = [[G(35, role, null), G(club + 3, role === 'atk' ? 'cr' : 'atk', null)], [G(club + 1, 'atk', r), G(club - 1, 'cr', r)]];
            const g = S.createGame({ seed: 3000 + s * 7 + club, serveClock: true, difficulty: 'easy', ctrl: 'one', ctrlIdx: 0, attrs, points: 15 }), bf = makeBot(BOTS[bot], s * 11 + club);
            for (let i = 0; i < 300 * 120 && !(g.finished && g.mode === 'over'); i++) { S.step(g, DT, bf(g)); ev.length = 0; S.drainEvents(g, ev); for (const e of ev) if (e.type === 'point') { n++; if (e.team === 0) w++; } }
          }
          out.push(bot + ' ' + (100 * w / n).toFixed(1) + ' % (' + n + ' puntos)');
          if (!(w / n >= (bot === 'medio' ? 0.57 : 0.43))) fail('Carrera Regional poco jugable con la media inicial: ' + bot + ' ' + (w / n).toFixed(3));
        }
        console.log('Carrera Regional con la media inicial (35) contra Fácil: ' + out.join(' · '));
      }
    }
    // integración (10-nov-2026): con Velocidad baja frenar y girar es al momento (antes se pasaba 0,74 m en un giro con 15); la
    // precisión (eRecv/eDig/eSet/eAtk) y el alcance (rRecv/rDig) valen 1 con 50 y van en el sentido del atributo
    {
      const turn = v => {
        const g = S.createGame({ seed: 1, ctrl: 'one', ctrlIdx: 0, attrs: [[Object.assign(all(50), { speed: v }), null], null] }), p = g.teams[0][0];
        g.ctrl = p; g.mode = 'rally'; p.x = 8; p.y = 0;
        for (let i = 0; i < 120; i++) S._stepPlayer(g, p, DT, -1, 0);   // a toda velocidad hacia la red (x baja)
        const x0 = p.x; let over = 0;
        for (let i = 0; i < 60; i++) { S._stepPlayer(g, p, DT, 1, 0); over = Math.max(over, x0 - p.x); }
        return over;
      };
      const o15 = turn(15), o35 = turn(35);
      console.log('  giro de 180° a toda velocidad: se pasa ' + o15.toFixed(3) + ' m con Velocidad 15, ' + o35.toFixed(3) + ' m con 35');
      if (!(o15 < 0.02 && o35 < 0.02)) fail('Velocidad baja: el giro aún desliza (' + o15.toFixed(3) + ' / ' + o35.toFixed(3) + ' m)');
      const K = v => S.attrK(all(v)), k15 = K(15), k50 = K(50), k90 = K(90);
      for (const f of ['eRecv', 'eDig', 'eSet', 'eAtk']) if (!(k50[f] === 1 && k15[f] > 1.4 && k90[f] < 0.7)) fail('precisión ' + f + ': ' + k15[f] + ' / ' + k50[f] + ' / ' + k90[f]);
      for (const f of ['rRecv', 'rDig']) if (!(k50[f] === 1 && k15[f] < 0.96 && k90[f] > 1.03)) fail('alcance ' + f + ': ' + k15[f] + ' / ' + k50[f] + ' / ' + k90[f]);
    }
    if (failures === f0) console.log('atributos que se notan OK (tablas, monotonía, 50 = sin atributos, Carrera Regional, giro, precisión y alcance)');
  }

  // ---------- Insignias (opts.badges), eventos para desbloquearlas y saque dirigible (sprint Carrera) ----------
  {
    const f0 = failures, res = [], ev = [], ids = S.BADGE_IDS;
    const all3 = id => [[null, null], [{ [id]: 3 }, { [id]: 3 }]];
    if (!Array.isArray(ids) || ids.length !== 12 || ids.join() !== 'canon,mira,rompemanos,seda,bombardero,flotador,muro,ancla,red,motor,sangrefria,lider') fail('Sim.BADGE_IDS: ' + ids);
    // (a) sin insignias = idéntico: misma huella (puntos y velocidad de cada toque) con badges ausente, nulo, vacío o con ids desconocidos
    { const play = (badges, sd, demo) => { const g = S.createGame({ seed: sd, autopilot: !demo, demo: !!demo, difficulty: 'normal', badges }), sig = [];
        for (let i = 0; i < 240 * 120; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
          for (const e of ev) if (e.type === 'point') sig.push(e.team + e.reason + e.how); else if (e.type === 'hit') sig.push(e.kind[0] + e.speed.toFixed(5)); }
        return sig.join(','); };
      let same = true;
      for (const sd of [11, 222]) { const a = play(undefined, sd), b = play([[null, null], [null, null]], sd), c = play([[{}, null], [{ inventada: 3 }, { canon: 0 }]], sd);
        if (a !== b || a !== c) same = false; }
      if (play(undefined, 33, true) !== play(all3('canon'), 33, true)) same = false; // la demo no lleva insignias
      const g = S.createGame({ seed: 1, badges: [[{ canon: 2, mira: 7, foo: 1 }, null], [{ red: '1' }, { motor: 0 }]] });
      const norm = JSON.stringify(g.teams[0][0].badges) === '{"canon":2,"mira":3}' && g.teams[0][1].badges === null && g.teams[1][0].badges.red === 1 && g.teams[1][1].badges === null;
      res.push(['(a) sin insignias idéntico y p.badges normalizado', same && norm, [same, norm]]); }
    // CPU contra CPU (autopilot vs Normal): el equipo 1 lleva la insignia en sus dos jugadores; media de una métrica de sus golpes
    const cpuStat = (badges, pick, seeds) => { let sum = 0, n = 0;
      for (let sd = 1; sd <= (seeds || 8); sd++) { const g = S.createGame({ seed: 700 + sd, autopilot: true, difficulty: 'normal', badges }); let prev = null;
        for (let i = 0; i < 300 * 120; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
          for (const e of ev) { if (e.type === 'hit') { const r = pick(e, g, prev); if (r != null) { sum += r; n++; } prev = e; } else if (e.type === 'point') prev = null; } } }
      return { m: sum / Math.max(1, n), n }; };
    // (b1) Cañón: velocidad media de remate del equipo 1
    { const sp = e => e.team === 1 && e.kind === 'spike' ? e.speed : null, a = cpuStat(null, sp, 24), b = cpuStat(all3('canon'), sp, 24);
      res.push(['Cañón: remate más rápido', b.m - a.m > 1.0 && a.n > 100, [a.m.toFixed(2), b.m.toFixed(2), a.n]]); }
    // (b2) Manos de seda: remate tras colocación buena/perfecta del compañero
    { const sp = (e, g, pv) => e.team === 1 && e.kind === 'spike' && pv && pv.team === 1 && pv.kind === 'set' && pv.grade !== 'poor' && pv.player !== e.player ? e.speed : null;
      const a = cpuStat(null, sp, 24), b = cpuStat(all3('seda'), sp, 24);
      res.push(['Manos de seda: remate asistido más rápido', b.m - a.m > 0.3 && a.n > 100, [a.m.toFixed(2), b.m.toFixed(2), a.n]]); }
    // (b3) Bombardero: saque en salto más frecuente (CPU contra CPU) y más rápido (mismo saque forzado en salto, con y sin la insignia)
    { const sv = e => e.team === 1 && e.kind === 'serve' ? (e.shot === 'jump' ? 1 : 0) : null, fa = cpuStat(null, sv), fb = cpuStat(all3('bombardero'), sv);
      const jsp = (s, badges) => { const g = S.createGame({ seed: 4400 + s, autopilot: true, difficulty: 'normal', badges }); g.serving = 1; S._setupServe(g); g.serveAuth = true; S._toss(g, g.server, true);
        for (let i = 0; i < 120 * 3; i++) { S.step(g, DT, null); const h = S.drainEvents(g).find(e => e.type === 'hit' && e.kind === 'serve'); if (h) return h.speed; } return NaN; };
      let d = 0, n = 0; for (let s = 1; s <= 30; s++) { const a = jsp(s, null), b = jsp(s, all3('bombardero')); if (a > 0 && b > 0) { d += b - a; n++; } }
      res.push(['Bombardero: saque en salto', fb.m > fa.m + 0.2 && n >= 25 && d / n > 1.3, [fa.m.toFixed(2), fb.m.toFixed(2), (d / Math.max(1, n)).toFixed(2), n]]); }
    // (b4) Hoja seca: baile del flotante x1,45
    { const wb = (e, g) => e.team === 1 && e.kind === 'serve' && e.shot === 'float' && g.ball.wobA > 0 ? g.ball.wobA : null, a = cpuStat(null, wb), b = cpuStat(all3('flotador'), wb);
      res.push(['Hoja seca: el flotante baila más', b.m / a.m > 1.35 && a.n > 40, [a.m.toFixed(2), b.m.toFixed(2), a.n]]); }
    // bloqueo aislado: remate del equipo 1 contra el bloqueador (IA) teams[0][0]
    const blockRun = (badges, N) => { const out = [];
      for (let s = 0; s < N; s++) { const g = S.createGame({ autopilot: true, seed: 500 + s, badges }), blk = g.teams[0][0];
        rallyAt(g, { x: -0.5, y: 0, z: 3.0, vx: 9, vz: -1.5 }); g.touchTeam = 1; g.lastTeam = 1; g.touches = 3; g.lastKind = 'spike'; g.lastPlayer = g.teams[1][0];
        blk.x = 0.5; blk.y = 0; blk.z = 0.8; blk.vz = 0.3; g.teams[0][1].x = 6; g.teams[1][0].x = -1.5; g.teams[1][1].x = -5;
        const evs = stepUntil(g, 'point', 600), bk = evs.find(e => e.type === 'block'), pt = evs.find(e => e.type === 'point');
        out.push(bk ? { r: bk.result, tool: !!(pt && pt.tool) } : null); }
      return out; };
    // (b5) Rompemanos: +24 puntos de block-out
    { const a = blockRun(null, 400), b = blockRun([[null, null], [{ rompemanos: 3 }, null]], 400), rate = r => r.filter(x => x && x.r === 'tool').length / Math.max(1, r.filter(x => x).length);
      const tp = b.filter(x => x && x.tool).length;
      res.push(['Rompemanos: más block-out', rate(b) - rate(a) > 0.15 && rate(b) - rate(a) < 0.33 && tp > 0, [rate(a).toFixed(3), rate(b).toFixed(3), tp]]); }
    // (b6) Muro (IA): más bloqueos directos; mismo dado, umbral mayor -> todo directo sin la insignia sigue siéndolo con ella
    { const a = blockRun(null, 400), b = blockRun([[{ muro: 3 }, null], null], 400);
      let mono = true, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { const x = a[i] && a[i].r === 'stuff', y = b[i] && b[i].r === 'stuff'; if (x) sa++; if (y) sb++; if (x && !y) mono = false; }
      res.push(['Muro: más bloqueos directos', mono && sb > sa * 1.08, [sa, sb]]); }
    // (b7) Ancla (IA): el receptor previsto falla menos (mismo dado: nunca peor) y el humano tiene la ventana x1,18
    { let okA = 0, okB = 0, mono = true;
      const r = (s, badges) => { const g = S.createGame({ seed: 3000 + s, autopilot: true, difficulty: 'normal', badges });
        for (let i = 0; i < 120 * 8; i++) { S.step(g, DT, null); const h = S.drainEvents(g).find(e => e.type === 'hit' && e.kind === 'serve'); if (h) return h.team === 0 && g.recvRisk > 0.3 ? g.digOk : null; } return null; };
      for (let s = 1; s <= 300; s++) { const a = r(s, null), b = r(s, [[null, null], [{ ancla: 3 }, { ancla: 3 }]]); if (a == null || b == null) continue; if (a) okA++; if (b) okB++; if (a && !b) mono = false; }
      const hq = (te, badges) => { const g = S.createGame({ demo: false, seed: 66, badges }), h = g.teams[0][0];
        rallyAt(g, { x: 6, y: 0, z: 0.9, vx: 9, vz: -2 }); g.touchTeam = 1; g.touches = 3; g.lastTeam = 1; g.lastKind = 'serve'; g.lastPlayer = g.teams[1][0];
        g.ctrl = h; h.x = 6.2; h.y = 0; S._hit(g, h, null, te, ''); return S.drainEvents(g).find(e => e.type === 'hit'); };
      const h0 = hq(0.06, null), h1 = hq(0.06, [[{ ancla: 3 }, null], null]);
      res.push(['Ancla: recepción', mono && okB > okA && h1 && Math.abs(h1.timing - 0.06 / 1.18) < 1e-9 && h1.quality > h0.quality && h1.recv && !h1.dig, [okA, okB, h0 && h0.quality.toFixed(3), h1 && h1.quality.toFixed(3)]]); }
    // (b8) Ojo de halcón: el error del remate con mira (timing tardío) x0,68 (mismo dado); aimPoint lo dibuja igual
    { const err = badges => { let s0 = 0, ap = null; for (let k = 0; k < 24; k++) {
          const g = S.createGame({ demo: false, seed: 100 + k, badges }), h = g.teams[0][0], m = g.teams[0][1];
          rallyAt(g, { x: 1.4, y: 0.5, z: C.NET_H + 0.6, vz: -0.5 }); g.touchTeam = 0; g.touches = 2; g.lastTeam = 0; g.lastPlayer = m; g.lastKind = 'set';
          g.ctrl = h; h.x = 1.6; h.y = 0.5; h.z = 0.6; h.vz = 0.3; m.x = 6; for (const q of g.teams[1]) { q.x = -8; q.y = q.idx ? 4.5 : -4.5; }
          g.aim3.on = true; g.aim3.kind = 'spike'; g.aim3.x = -(3 + (k % 5)); g.aim3.y = -3 + (k % 7); const tx = g.aim3.x, ty = g.aim3.y;
          if (!ap) ap = Object.assign({}, S.aimPoint(g, {}));
          S._hit(g, h, null, 0.12, ''); S.drainEvents(g); const ld = S.predictLanding(g, {}); s0 += Math.hypot(ld.x - tx, ld.y - ty); } return [s0 / 24, ap.spread]; };
      const a = err(null), b = err([[{ mira: 3 }, null], null]);
      res.push(['Ojo de halcón: remate más preciso', b[0] / a[0] > 0.6 && b[0] / a[0] < 0.76 && Math.abs(b[1] / a[1] - 0.68) < 1e-9, [a[0].toFixed(3), b[0].toFixed(3)]]); }
    // (b9) Red de seguridad: alcance de defensa y de plancha x1,15; ventana de la defensa de remate x1,15
    { const g = S.createGame({ autopilot: true, seed: 5, badges: [[{ red: 3 }, null], null] }), p = g.teams[0][0], q = g.teams[0][1];
      rallyAt(g, { x: 5, y: 1.45, z: 1.0, vz: -1 }); g.touchTeam = 1; g.touches = 3; g.lastTeam = 1; g.lastKind = 'spike'; g.lastPlayer = g.teams[1][0];
      p.x = 5; p.y = 0; q.x = 8; q.y = -3;
      const cr = S.canReach(g, p); p.badges = null; const cr0 = S.canReach(g, p); p.badges = { red: 3 };
      g.ball.y = 2.6; g.ball.z = 0.6; const cd = S.canDive(g, p); p.badges = null; const cd0 = S.canDive(g, p);
      const gh = S.createGame({ demo: false, seed: 67, badges: [[{ red: 3 }, null], null] }), h = gh.teams[0][0];
      rallyAt(gh, { x: 5, y: 0, z: 0.8, vx: 8, vz: -3 }); gh.touchTeam = 1; gh.touches = 3; gh.lastTeam = 1; gh.lastKind = 'spike'; gh.lastPlayer = gh.teams[1][0];
      gh.ctrl = h; h.x = 5.2; h.y = 0; S._hit(gh, h, null, 0.046, ''); const hv = S.drainEvents(gh).find(e => e.type === 'hit');
      res.push(['Red de seguridad: alcance y ventana', cr && !cr0 && cd && !cd0 && hv && Math.abs(hv.timing - 0.04) < 1e-9 && hv.dig && !hv.recv, [cr, cr0, cd, cd0, hv && hv.timing]]); }
    // (b10) Motor: carrera x VB.BADGE.motor[3] (1,045 desde los arreglos finales) en el peloteo (humano e IA)
    { const run = (badges, human) => { const g = S.createGame({ demo: false, autopilot: !human, seed: 8, badges }), p = g.teams[0][0]; rallyAt(g, { x: -5, z: 3 }); p.x = 6; p.y = -3;
        for (let i = 0; i < 60; i++) S._stepPlayer(g, p, DT, 0, 1); return p.y + 3; };
      const a = run(null, false), b = run([[{ motor: 3 }, null], null], false), c = run([[{ motor: 3 }, null], null], true), c0 = run(null, true);
      res.push(['Motor: corre más', Math.abs(b / a - VB.BADGE.motor[3]) < 1e-6 && Math.abs(c / c0 - VB.BADGE.motor[3]) < 1e-6 && VB.BADGE.motor[3] > 1, [a.toFixed(3), b.toFixed(3), c.toFixed(3)]]); }
    // (b11) Sangre fría (con punto de set: ventanas x1,25; IA timing x0,7) y (b12) Líder (compañero IA: reacción y timing de VB.BADGE.liderReact/liderT)
    { const g = S.createGame({ demo: false, seed: 9, badges: [[{ sangrefria: 3 }, { lider: 3 }], null] }), h = g.teams[0][0], m = g.teams[0][1], pr = g.prof[0];
      const tOff = S.aiTiming(g, m, pr), tOffH = S.aiTiming(g, h, pr); g.setPoint = 1; const tOn = S.aiTiming(g, h, pr);
      rallyAt(g, { x: 5, y: 0, z: 0.8, vx: 8, vz: -3 }); g.touchTeam = 1; g.touches = 3; g.lastTeam = 1; g.lastKind = 'spike'; g.lastPlayer = g.teams[1][0];
      g.ctrl = h; h.x = 5.2; h.y = 0; S._hit(g, h, null, 0.05, ''); const hv = S.drainEvents(g).find(e => e.type === 'hit');
      const mateR = S.aiReact(g, h, pr), selfR = S.aiReact(g, m, pr);
      res.push(['Sangre fría: ventanas en punto de set', tOff === pr.timing && Math.abs(tOffH - pr.timing * VB.BADGE.liderT[3]) < 1e-12 && Math.abs(tOn - pr.timing * VB.BADGE.liderT[3] * 0.7) < 1e-12 && hv && Math.abs(hv.timing - 0.04) < 1e-9, [tOff, tOn, hv && hv.timing]]);
      res.push(['Líder: el compañero lee antes', Math.abs(mateR - Math.max(0.02, pr.react - VB.BADGE.liderReact[3])) < 1e-12 && selfR === pr.react, [mateR, selfR, tOffH]]); }
    // (c) saque dirigible: humano guionizado que lleva la diana a las 4 esquinas y saca con timing perfecto / tardío (0,13 s)
    { const corners = [[-8.4, -3.9], [-8.4, 3.9], [-2.2, -3.9], [-2.2, 3.9]];
      const serve = (seed, tgt, late, jump) => {
        const g = S.createGame({ demo: false, seed, serveClock: false }), h = g.ctrl;
        for (const q of g.teams[1]) { q.x = -11; q.y = q.idx ? 6 : -6; q.down = 1e9; }
        let tossed = false, pressed = false, ld = null, dmax = 0;
        for (let i = 0; i < 120 * 6 && !ld; i++) {
          const inp = { move: [0, 0], hit: false, jump: false };
          if (g.mode === 'serve' && g.serveAuth && g.serveState === 'ready' && !tossed) { if (jump) inp.jump = true; else inp.hit = true; tossed = true; }
          else if (g.mode === 'serve' && g.serveState === 'toss') {
            const dx = tgt[0] - g.aim3.x, dy = tgt[1] - g.aim3.y, d = Math.hypot(dx, dy), f = d > 1e-6 ? Math.min(1, d / 0.25) / d : 0; inp.move = [dx * f, dy * f];
            if (!pressed && g.ball.vz < 0) { const w = S.hitWindow(g, h); if (w.t <= C.WINDUP - (late ? 0.13 : 0)) { inp.hit = true; pressed = true; dmax = d; } }
          }
          S.step(g, DT, inp);
          for (const e of S.drainEvents(g)) { if (e.type === 'land') ld = e; if (e.type === 'point' && !ld) ld = { x: 0, y: 0, none: true }; }
        }
        return ld ? { e: Math.hypot(ld.x - tgt[0], ld.y - tgt[1]), steer: dmax } : { e: 9, steer: dmax };
      };
      const meanE = (late, jump) => { let s0 = 0, st = 0; for (let k = 0; k < 24; k++) { const r = serve(4000 + k, corners[k % 4], late, jump); s0 += r.e; st = Math.max(st, r.steer); } return [s0 / 24, st]; };
      const pj = meanE(false, true), pf = meanE(false, false), lj = meanE(true, true), lf = meanE(true, false);
      const spr = [0.95, 0.78, 0.5, 0.2].map(q => S.serveSpread(q, true)), sprF = [0.95, 0.5].map(q => S.serveSpread(q, false));
      res.push(['(c) saque dirigible a las esquinas', pj[0] < 1 && pf[0] < 1 && pj[0] < pf[0] && lj[0] > pj[0] + 0.3 && lf[0] > pf[0] + 0.2 && Math.max(pj[1], pf[1]) < 0.05 && spr[0] <= 0.0501 && sprF[0] > spr[0] && sprF[1] < S.serveSpread(0.5, true),
        { saltoPerfecto: pj[0].toFixed(3), flotantePerfecto: pf[0].toFixed(3), saltoTarde: lj[0].toFixed(3), flotanteTarde: lf[0].toFixed(3), dianaSinLlegar: Math.max(pj[1], pf[1]).toFixed(3), serveSpread: spr.map(x => x.toFixed(2)).join('/') }]); }
    // (d) eventos para desbloquear insignias en CPU contra CPU: point.assist, point.tool, hit.dig, hit.recv
    { let pts = 0, kills = 0, assists = 0, tools = 0, digs = 0, recvs = 0, serves = 0, ptDigs = 0, bad = 0;
      for (let sd = 1; sd <= 4; sd++) { const g = S.createGame({ seed: 8800 + sd, demo: true });
        for (let i = 0; i < 600 * 120; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
          for (const e of ev) {
            if (e.type === 'hit') { if (e.dig) digs++; if (e.recv) recvs++; if (e.kind === 'serve') serves++; if ((e.dig && e.touch !== 1) || (e.recv && e.touch !== 1) || typeof e.dig !== 'boolean' || typeof e.recv !== 'boolean') bad++; }
            if (e.type === 'point') { pts++; ptDigs += e.digs; if (e.how === 'kill') kills++;
              if (e.assist) { assists++; if (e.how !== 'kill' || e.assist.team !== e.team) bad++; } else if (e.assist !== null) bad++;
              if (e.tool) { tools++; if (e.lastKind !== 'block' || e.how !== 'kill') bad++; } else if (e.tool !== false) bad++; } } } }
      res.push(['(d) assist/tool/dig/recv en CPU contra CPU', !bad && assists > kills * 0.5 && assists <= kills && tools > pts * 0.01 && digs > pts * 0.15 && digs <= ptDigs + 3 /* + la jugada a medias al cortar */ && recvs > serves * 0.6 && recvs <= serves,
        { puntos: pts, remates: kills, asistencias: assists, blockOut: tools, defensas: digs, defensasPunto: ptDigs, recepciones: recvs, saques: serves, mal: bad }]); }
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('insignias / eventos / saque dirigible: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    if (failures === f0) console.log('insignias, eventos y saque dirigible OK\n  ' + res.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('\n  '));
  }

  // ---- Carrera: opts.ref (error arbitral / challenge por competición) y opts.nums (dorsales) ----
  {
    const f0 = failures, ev = [], pts = o => { const g = S.createGame(Object.assign({ seed: 4242, autopilot: true }, o)), out = [];
      for (let i = 0; i < 240 * 120 && !g.finished; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev); for (const e of ev) if (e.type === 'point') out.push(e.team + e.reason); }
      return out.join(','); };
    const base = pts({});
    if (pts({ ref: null }) !== base || pts({ nums: [[4, null], null] }) !== base) fail('Carrera: sin ref / con dorsales la sim debe ser idéntica');
    const g = S.createGame({ seed: 1, ref: { p1: 0.55, p2: 0.4, p3: 0.22, d3: 0.25, chal: 0 }, nums: [[23, 5], [0, 'x']] });
    if (g.chalPerSet !== 0 || g.challenges[0] !== 0 || g.refErr.d3 !== 0.25 || g.refErr.d1 !== VB.REF_ERR.d1) fail('Carrera: opts.ref no se aplica ' + JSON.stringify([g.refErr, g.chalPerSet, g.challenges]));
    if (Math.abs(S.refErrP(0.2, g) - 0.22) > 1e-9 || S.refErrP(0.2) !== 0) fail('Carrera: refErrP con g.refErr');
    if (g.teams[0][0].num !== 23 || g.teams[0][1].num !== 5 || g.teams[1][0].num !== 3 || g.teams[1][1].num !== 9) fail('Carrera: opts.nums');
    const g2 = S.createGame({ seed: 1, ref: { p1: 0.2, p2: 0.08, p3: 0.02, d3: 0.1, chal: 2 } });
    if (g2.challenges[0] !== 2 || g2.chalPerSet !== 2) fail('Carrera: challenge 2 por set');
    if (failures === f0) console.log('Carrera: opts.ref y opts.nums OK');
  }

  // ---- Colocación en salto (input.jset = COLOCAR en el aire; solo el humano) ----
  {
    const f0 = failures, res = [];
    // escenario: control 'one' (el compañero es IA). 2.º toque: el compañero recibe y el humano, junto a la red, salta y pulsa
    // COLOCAR cuando hitWindow().press <= lead (lead > 0 = pronto, < 0 = tarde). 1.er toque (first): balón libre rival que cae
    // alto sobre la red. Devuelve el toque del humano, el siguiente toque propio y el punto.
    const jsc = (seed, lead, o) => {
      o = o || {};
      const g = S.createGame({ seed, ctrl: 'one', stats: true, badges: o.badges }), h = g.teams[0][0], m = g.teams[0][1], b = g.ball, G = C.G;
      g.mode = 'rally'; b.held = null; S.drainEvents(g);
      const yy = (seed % 5 - 2) * 0.8, ap = (z0, z1, apex, x1, y1) => { const vz = Math.sqrt(2 * G * (apex - z0)), T = vz / G + Math.sqrt(2 * (apex - z1) / G); b.vx = (x1 - b.x) / T; b.vy = (y1 - b.y) / T; b.vz = vz; };
      if (!o.first) { m.x = 5.5; m.y = -1.5 + yy * 0.3; h.x = 2.1; h.y = yy; Object.assign(b, { x: m.x, y: m.y, z: 0.9, dip: 0, wobA: 0 }); ap(0.9, 1.9, 4.4, 1.9, h.y);
        g.touchTeam = 0; g.touches = 1; g.lastPlayer = m; g.lastTeam = 0; g.lastKind = 'pass'; g.lastShot = 'forearm'; }
      else { m.x = 5.8; m.y = -2 + yy * 0.3; h.x = 1.0; h.y = yy; Object.assign(b, { x: -3, y: yy, z: 2.5, dip: 0, wobA: 0 }); ap(2.5, 3.1, 4.6, 0.75, yy);
        g.touchTeam = 1; g.touches = 3; g.lastPlayer = g.teams[1][0]; g.lastTeam = 1; g.lastKind = 'free'; g.lastShot = 'overhead'; }
      g.lastTouchT = g.time; g.ctrl = h;
      const r = { h: null, next: null, pt: null, g, ready: false, blocks: 0 }, w = {}; let jumped = false, pressed = false, ji = 0;
      for (let i = 0; i < 120 * 12 && !r.pt; i++) {
        const inp = { move: [0, 0], hit: false, jump: false, jset: false, switchPlayer: false };
        if (!r.h && g.mode === 'rally') {
          const zc = 1.07 + 2.2, disc = b.vz * b.vz - 2 * G * (zc - b.z);
          if (!jumped && h.z === 0 && disc > 0 && (b.vz + Math.sqrt(disc)) / G < 0.5 && b.vz < 2.5) { inp[o.jumpBtn || 'jump'] = true; jumped = true; ji = i; }
          // o.early: COLOCAR o.early pasos después de despegar (doble pulsación rápida), sin mirar el timing
          if (jumped && o.early != null && !pressed && i >= ji + o.early) { inp.jset = true; pressed = true; }
          if (jumped && o.early == null && h.z > 0.3 && !pressed) { if (S.jsetReady(g)) r.ready = true; S.hitWindow(g, h, w); if (w.press <= lead) { inp[o.btn || 'jset'] = true; pressed = true; } }
        }
        S.step(g, DT, inp);
        for (const e of S.drainEvents(g)) {
          if (e.type === 'hit' && e.player === h && !r.h) r.h = e;
          else if (e.type === 'hit' && r.h && !r.next && e.team === 0) { r.next = e; // bloqueador CPU al rematar: el más cercano a la red
            const o1 = g.teams[1], bk = Math.abs(o1[0].x) < Math.abs(o1[1].x) ? o1[0] : o1[1]; r.bx = Math.abs(bk.x); r.bz = bk.z; }
          if (e.type === 'block' && r.next) r.blocks++;
          if (e.type === 'point') r.pt = e;
        }
      }
      return r;
    };
    const sweep = (lead, o, n) => { const s = { n: 0, js: 0, q: 0, spk: 0, won: 0, as: 0, ready: 0, bad: 0, x: [] };
      for (let k = 1; k <= (n || 120); k++) { const r = jsc(k, lead, o); s.n++; if (r.ready) s.ready++; if (!r.h || !r.h.jset) continue;
        s.js++; s.q += r.h.quality; if (r.h.kind !== 'set' || r.h.shot !== 'jump' || r.h.human !== true) s.bad++;
        if (r.next && r.next.kind === 'spike') s.spk++; if (r.pt && r.pt.team === 0) s.won++; if (r.pt && r.pt.assist === r.h.player) s.as++; }
      s.q = s.js ? s.q / s.js : 0; return s; };
    // (a) ocurre (2.º y 1.er toque), con el evento coherente; el compañero IA la ataca
    const a2 = sweep(0, {}), a1 = sweep(0, { first: true }), late = sweep(-0.15, {}), early = sweep(0.15, {});
    const rate = s => s.js ? s.spk / s.js : 0;
    res.push(['(a) colocación en salto (2.º toque) y remate del compañero IA', a2.js === a2.n && !a2.bad && a2.ready === a2.n && a2.q > 0.85 && rate(a2) >= 0.9 && a2.as > 0,
      { colocaciones: a2.js + '/' + a2.n, calidad: a2.q.toFixed(2), remates: pct(a2.spk, a2.js), ganados: pct(a2.won, a2.n), asistencias: a2.as }]);
    res.push(['(b) 1.er toque con el balón alto en la red: el compañero remata en el 2.º', a1.js === a1.n && !a1.bad && rate(a1) >= 0.85,
      { colocaciones: a1.js + '/' + a1.n, calidad: a1.q.toFixed(2), remates: pct(a1.spk, a1.js), ganados: pct(a1.won, a1.n), asistencias: a1.as }]);
    // (c) mal timing: menos calidad, menos remates y menos puntos (la colocación sale pegada a la red o larga)
    res.push(['(c) mal timing empeora', late.q < a2.q - 0.4 && early.q < a2.q - 0.4 && rate(late) < rate(a2) - 0.05 && rate(early) < rate(a2) - 0.05 && late.won + early.won < 2 * a2.won - 0.1 * a2.n,
      { calidadTarde: late.q.toFixed(2), calidadPronto: early.q.toFixed(2), rematesTarde: pct(late.spk, late.js), rematesPronto: pct(early.spk, early.js), ganadosTarde: pct(late.won, late.n), ganadosPronto: pct(early.won, early.n) }]);
    // (d) reglas: COLOCAR en el suelo salta; en el 3.er toque en la red es dejada; 1.er toque lejos de la red, toque normal; ventana más justa
    { const r3 = jsc(3, 0, { jumpBtn: 'jset' }), j3 = r3.g; // el salto se dio con COLOCAR: debe haber despegado igual
      const g4 = S.createGame({ seed: 5, ctrl: 'one' }), h4 = g4.teams[0][0], m4 = g4.teams[0][1];
      rallyAt(g4, { x: 0.8, y: 0, z: 3.1, vz: -1 }); h4.x = 0.9; h4.y = 0; h4.z = 0.9; g4.touchTeam = 0; g4.touches = 2; g4.lastPlayer = m4; g4.lastKind = 'set'; g4.lastShot = 'overhead'; g4.ctrl = h4;
      S._hit(g4, h4, null, 0, 'jset'); const e4 = S.drainEvents(g4).find(e => e.type === 'hit');
      const g5 = S.createGame({ seed: 6, ctrl: 'one' }), h5 = g5.teams[0][0];
      rallyAt(g5, { x: 5, y: 0, z: 2.6, vz: -2 }); h5.x = 5; h5.y = 0; h5.z = 0.5; g5.touchTeam = 1; g5.touches = 3; g5.lastPlayer = g5.teams[1][0]; g5.lastKind = 'free'; g5.ctrl = h5;
      S._hit(g5, h5, null, 0, 'jset'); const e5 = S.drainEvents(g5).find(e => e.type === 'hit');
      const qOf = (shot) => { const g6 = S.createGame({ seed: 7, ctrl: 'one' }), h6 = g6.teams[0][0], m6 = g6.teams[0][1];
        rallyAt(g6, { x: 1.6, y: 0, z: 3.2, vz: -1 }); h6.x = 1.6; h6.y = 0; h6.z = 0.9; g6.touchTeam = 0; g6.touches = 1; g6.lastPlayer = m6; g6.lastKind = 'pass'; g6.ctrl = h6;
        S._hit(g6, h6, null, 0.06, shot); return S.drainEvents(g6).find(e => e.type === 'hit').quality; };
      res.push(['(d) reglas y ventana', !!(r3.h && r3.h.jset) && j3.stats.jsets === 1 && e4 && e4.kind === 'free' && e4.shot === 'tip' && !e4.jset && e5 && e5.kind === 'pass' && !e5.jset && qOf('jset') < qOf('') - 0.05,
        { saltoConColocar: !!(r3.h && r3.h.jset), tercerToque: e4 && e4.kind + '/' + e4.shot, primeroLejos: e5 && e5.kind, q006: qOf('jset').toFixed(2) + ' vs ' + qOf('').toFixed(2) }]); }
    // (e) Manos de seda del colocador en salto: el remate del compañero sale más rápido; la asistencia cuenta (point.assist)
    { let v0 = 0, v1 = 0, n = 0;
      for (let k = 1; k <= 30; k++) { const r0 = jsc(k, 0, {}), r1 = jsc(k, 0, { badges: [[{ seda: 3 }, null], null] });
        if (r0.next && r1.next && r0.next.kind === 'spike' && r1.next.kind === 'spike') { v0 += r0.next.speed; v1 += r1.next.speed; n++; } }
      const fa = sweep(0, { first: true, badges: [[{ seda: 3 }, null], null] }, 40);
      res.push(['(e) Manos de seda tras colocación en salto', n > 20 && v1 / n > v0 / n + 0.6 && fa.as > 0, { remates: n, v: (v0 / n).toFixed(2) + ' -> ' + (v1 / n).toFixed(2), asist1erToque: fa.as }]); }
    // (f) la IA la usa poco: CPU contra CPU con pocas colocaciones en salto, atkPhase = 2.º toque, y el campo jset:false no cambia nada
    { let js = 0, mis = 0; const g = S.createGame({ seed: 991, demo: true }), ev = [];
      for (let i = 0; i < 300 * 120; i++) { S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev); for (const e of ev) if (e.type === 'hit' && e.jset) js++;
        for (let t = 0; t < 2; t++) if (S.atkPhase(g, t) !== (g.touchTeam === t && g.touches === 2)) mis++; }
      const fpOf = (inp) => { const g2 = S.createGame({ seed: 4343, autopilot: true }), out = [];
        for (let i = 0; i < 120 * 120; i++) { S.step(g2, DT, inp); ev.length = 0; S.drainEvents(g2, ev); for (const e of ev) if (e.type === 'hit' || e.type === 'point') out.push(e.type + (e.kind || e.reason) + (e.x != null ? e.x.toFixed(4) : '')); }
        return out.join(','); };
      const same = fpOf(null) === fpOf({ move: [0, 0], hit: false, jump: false, jset: true, switchPlayer: false });
      res.push(['(f) CPU contra CPU: colocación en salto poco frecuente', js <= 6 && mis === 0 && same, { jsets: js, atkPhaseDistinto: mis, autopilotIgual: same }]); }
    // (g) el bloqueador CPU lee la colocación en salto (ai.js, S.jsetReady): al rematar el compañero está en la red y en el
    // aire, y hay bloqueos (antes: a 2,6–2,9 m de la red, 0 bloqueos de 300)
    { let n = 0, near = 0, air = 0, blk = 0;
      for (let k = 1; k <= 60; k++) { const r = jsc(k, 0, {}); if (!r.next || r.next.kind !== 'spike') continue; n++;
        if (r.bx < 1.3) near++; if (r.bz > 0.1) air++; if (r.blocks) blk++; }
      res.push(['(g) bloqueo rival tras colocación en salto', n > 40 && near >= 0.9 * n && air >= 0.7 * n && blk > 0, { remates: n, enRed: pct(near, n), enElAire: pct(air, n), conBloqueo: pct(blk, n) }]); }
    // (h) COLOCAR pulsado justo al despegar (20–60 ms, antes de que la sim acepte el gesto en el aire) se guarda y sale
    { let ok = 0; const tries = [2, 5, 7];
      for (const e of tries) for (let k = 1; k <= 10; k++) { const r = jsc(k, 0, { early: e }); if (r.h && r.h.jset) ok++; }
      res.push(['(h) doble pulsación rápida = salta y coloca', ok === tries.length * 10, { colocaciones: ok + '/' + tries.length * 10 }]); }
    // (i) bloqueando un remate CPU, COLOCAR no hace nada (ni gesto ni colocación) y la UI no lo ofrece
    { const g = S.createGame({ seed: 12, ctrl: 'one' }), h = g.teams[0][0];
      rallyAt(g, { x: -0.9, y: 0, z: 3.2, vx: 12, vz: -2 }); g.touchTeam = 1; g.touches = 3; g.lastPlayer = g.teams[1][0]; g.lastTeam = 1; g.lastKind = 'spike'; g.lastShot = 'power';
      h.x = 0.5; h.y = 0; h.z = 0.7; h.vz = 1.5; h.actionT = 0.3; h.lastAction = 'jump'; g.ctrl = h; S.drainEvents(g);
      const ready = S.jsetReady(g); S.step(g, DT, { move: [0, 0], hit: false, jump: false, jset: true, switchPlayer: false });
      const sw = S.drainEvents(g).filter(e => (e.type === 'swing' || e.type === 'hit') && e.player === h);
      res.push(['(i) COLOCAR no coloca el remate rival', !ready && sw.length === 0 && !g.swingLive, { jsetReady: ready, gestos: sw.length }]); }
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('colocación en salto: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    if (failures === f0) console.log('colocación en salto OK\n  ' + res.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('\n  '));
  }

  // Sim a N jugadores (sprint 1 del 6v6): API de equipo en 2v2 y humo del 6v6 provisional (?format=6v6, aún sin IA propia)
  if (ONLY !== 'matrix') {
    const f0 = failures, res = [];
    { const g = S.createGame({ seed: 5 }); let ok = g.size === 2 && g.format === '2v2' && g.rot === null && g.players.map(p => p.id).join() === '0,1,2,3';
      for (const p of g.players) { const m = S.mates(g, p); ok = ok && m.length === 1 && m[0] === S.other(g, p) && S.nearestMate(g, p) === m[0] && S.zoneOf(g, p) === 0 && !S.isFront(g, p); }
      ok = ok && S.serverOf(g, 0) === g.teams[0][g.serverIdx[0]];
      res.push(['(a) 2v2: mates/nearestMate = other, sin zonas', ok, {}]); }
    { const zp = S.zonePos(0, 4), zq = S.zonePos(1, 4), z1 = S.zonePos(0, 1);
      res.push(['(b) zonePos con el lateral del equipo', zp.x === 1.5 && zp.y === -3 && zq.x === -1.5 && zq.y === 3 && z1.x === 7.5 && z1.y === 3, { z4eq0: [zp.x, zp.y], z4eq1: [zq.x, zq.y] }]); }
    for (const o of [{ demo: true }, { demo: false, ctrl: 'one' }]) {
      let ex = null, pts = 0, rots = 0, nan = 0, newSet = false, lineupOk = true, srvOk = true;
      const g = S.createGame(Object.assign({ format: '6v6', seed: 66, stats: true }, o)), ev = [];
      try {
        // plantilla de 7 (6 + líbero, id team·16 + 6); en pista 6 por equipo: el líbero ya ha entrado por el central zaguero
        const ids = g.roster.map(r => r.map(p => p.id).join()).join(), onC = g.players.filter(p => !p.bench).length;
        if (ids !== '0,1,2,3,4,5,6,16,17,18,19,20,21,22' || g.size !== 6 || g.players.length !== 12 || onC !== 12) throw new Error('ids/size ' + ids + ' ' + g.size + ' ' + onC);
        for (let i = 0; i < 120 * 240; i++) {
          S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
          for (const e of ev) {
            if (e.type === 'point') pts++;
            if (e.type === 'sideout') rots++;
            if (e.type === 'newSet') { newSet = true; for (let t = 0; t < 2; t++) lineupOk = lineupOk && g.rot[t].every((p, z) => p === g.lineup[t][z] && p.zone === z + 1); }
            if (e.type === 'serveReady') srvOk = srvOk && e.player === g.rot[e.team][0] && e.player.zone === 1;
          }
          if (i % 60 === 0) for (const p of g.players) if (!Number.isFinite(p.x + p.y + p.z)) nan++;
        }
      } catch (e) { ex = e && e.stack || String(e); }
      res.push(['(c) 6v6 provisional ' + JSON.stringify(o), !ex && !nan && pts >= 10 && rots >= 3 && srvOk && lineupOk, { puntos: pts, cambiosDeSaque: rots, sacaZona1: srvOk, nuevoSet: newSet, alineacionAlSet: lineupOk, nan, ex }]);
    }
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('N jugadores: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    if (failures === f0) console.log('\nN jugadores (sprint 1 del 6v6) OK\n  ' + res.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('\n  '));
  }

  // 6v6 CPU contra CPU (sprint 2, notes/diseno-6v6-carrera.md §4 «objetivos medibles»): VB.AI6 con rotaciones, líbero,
  // formaciones y reglas de zaguero. Side-out 58-66 %, mediana del rally 5-8 s, 0 faltas de posición y de zaguero de la IA,
  // líbero nunca delante ni sacando, >= 70 % de 2.os toques del colocador; sin excepciones ni NaN. Lote A (D5): hay remates «pipe»
  // (tempo 'pipe' del colocador: zaguero que despega detrás de 3 m) y siguen las 0 faltas de zaguero.
  if (ONLY !== 'matrix') {
    const f0 = failures, NS6 = 16, MIN6 = 15; // ~1200 puntos: con menos, el side-out baila ±3 %
    let pts = 0, so = 0, sec = 0, secS = 0, ovl = 0, back = 0, libBad = 0, libSrv = 0, libEv = 0, rotEv = 0, sideEv = 0, nan = 0, ex = null, atkBack = 0;
    const rallies = [], tempos = {}, atkRole = {}, t0 = Date.now();
    try {
      for (let s = 0; s < NS6; s++) {
        const g = S.createGame({ format: '6v6', demo: true, seed: 600 + s, stats: true }), ev = [];
        for (let i = 0; i < MIN6 * 60 * 120; i++) {
          S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
          for (const e of ev) {
            if (e.type === 'point') { pts++; if (e.sideout) so++; rallies.push(e.rallyTime); if (e.reason === 'backAttack' || e.reason === 'backBlock') back++; }
            else if (e.type === 'hit' && e.touch === 2) { sec++; if (e.player.role === 'S') secS++; if (e.kind === 'set' && g.setPlan[e.team]) tempos[g.setPlan[e.team].tempo] = (tempos[g.setPlan[e.team].tempo] || 0) + 1; }
            else if (e.type === 'hit' && e.kind === 'spike') { atkRole[e.player.role] = (atkRole[e.player.role] || 0) + 1; if (!e.player.front) atkBack++; }
            else if (e.type === 'serveReady' && (e.player.role === 'L' || e.player.bench)) libSrv++;
            else if (e.type === 'libero') libEv++;
            else if (e.type === 'rotation') rotEv++;
            else if (e.type === 'sideout') sideEv++;
          }
          if (g.mode === 'rally' || g.mode === 'serve') for (let t = 0; t < 2; t++) {
            const L = g.libero[t]; if (!L.bench && (L.front || [1, 5, 6].indexOf(L.zone) < 0 || g.teams[t].indexOf(L) < 0)) libBad++;
            if (g.mode === 'serve' && g.server.role === 'L') libSrv++;
          }
          if (i % 120 === 0) for (const p of g.players) if (!Number.isFinite(p.x + p.y + p.z)) nan++;
        }
        ovl += g.stats.overlap[0] + g.stats.overlap[1];
      }
    } catch (e) { ex = e && e.stack || String(e); }
    rallies.sort((a, b) => a - b);
    const sidePct = pts ? 100 * so / pts : 0, med = rallies.length ? rallies[rallies.length >> 1] : 0, setPct = sec ? 100 * secS / sec : 0;
    const res = [
      ['(a) sin excepciones ni NaN', !ex && !nan && pts > 200, { puntos: pts, nan, ex }],
      ['(b) side-out 58-66 %', sidePct >= 58 && sidePct <= 66, { sideOut: sidePct.toFixed(1) + '%' }],
      ['(c) mediana del rally 5-8 s', med >= 5 && med <= 8, { mediana: +med.toFixed(2) }],
      ['(d) 0 faltas de posición de la IA', ovl === 0, { solapamientos: ovl }],
      ['(e) 0 faltas de zaguero (ataque/bloqueo) de la IA', back === 0, { faltas: back }],
      ['(f) líbero nunca delante ni sacando', libBad === 0 && libSrv === 0 && libEv > 0, { delante: libBad, sacando: libSrv, cambiosLibero: libEv }],
      ['(g) >= 70 % de 2.os toques del colocador', setPct >= 70, { colocador: setPct.toFixed(1) + '%' }],
      ['(h) evento rotation en cada cambio de saque', rotEv === sideEv && rotEv > 0, { rotation: rotEv, sideout: sideEv }],
      // (i) pipe (lote A, D5): el colocador en sistema reparte también al zaguero (peso bajo, FORM.setW.pipe): con ~1300 puntos salen
      // decenas; se exige > 0 (y (e) sigue en 0: el zaguero despega detrás de 3 m)
      ['(i) hay remates pipe (> 0)', (tempos.pipe || 0) > 0, { pipe: tempos.pipe || 0, rematesDeZaguero: atkBack }]
    ];
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('6v6 CPU contra CPU: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    console.log('\n6v6 CPU contra CPU (sprint 2, ' + NS6 + ' semillas x ' + MIN6 + ' min, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)' + (failures === f0 ? ' OK' : '') +
      '\n  ' + res.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('\n  ') + '\n  tempos ' + JSON.stringify(tempos) + ' remates por puesto ' + JSON.stringify(atkRole));
  }

  // 6v6 con HUMANO (sprint 3, notes/diseno-6v6-carrera.md §1.5): control Uno por puesto (receptor, OH1 = n.º 2), la IA mueve al
  // resto. Desde el 11-nov-2026 el personaje NO se mueve solo (Ferran: «deja que el jugador decida»): el bot de la matriz va él
  // mismo a su sitio (makeBot con {six: true}, VB.AI6.spot). Exige: sin excepciones ni NaN, el humano saca con la rotación, sin
  // eventos switch, el colocador le coloca, toques del humano por rally >= 0,5 (novato en Fácil) y >= 0,6 (medio en Normal; objetivo
  // del diseño 0,7 como OH), jugable en Fácil (novato >= 45 % de puntos); con el humano quieto: no se mueve ni salta ni golpea solo,
  // los compañeros no le quitan los balones de su zona y el colocador no se la da; «¡Pídela!» (CAMBIAR) guarda g.ask6 y sube su peso
  // en VB.AI6.chooseSet. Lote A (posiciones jugables, rotaciones reales): (h) los 4 puestos (CTRL_ROLES6) con bot, (i) central humano
  // que sale por el líbero y lo lleva, (j) colocador humano (2º toque suyo; laneOf/chooseSet con carril), (k) 6 formaciones de recepción
  // legales, (m) falta de posición del humano en Difícil (en Fácil no se mueve). El pipe (l) se mide en «6v6 CPU contra CPU» (i).
  if (ONLY !== 'matrix') {
    const f0 = failures, res = [], t0 = Date.now(), NS = 3, MINH = 6;
    for (const [bn, df, minT] of [['novato', 'easy', 0.5], ['medio', 'normal', 0.6]]) {
      let pts = 0, won = 0, ht = 0, hsrv = 0, hsrvOk = 0, sw = 0, setTo = 0, nan = 0, ex = null, role = true;
      try {
        for (let s = 0; s < NS; s++) {
          const g = S.createGame({ format: '6v6', seed: 900 + s, difficulty: df, ctrl: 'one', stats: true }), bot = makeBot(BOTS[bn], 77 + s, { six: true }), ev = [];
          role = role && g.ctrl.role === 'OH' && g.ctrl.num === 2 && g.ctrlMode === 'one' && g.ctrlRole === 'OH';
          for (let i = 0; i < MINH * 60 * 120; i++) {
            S.step(g, DT, bot(g)); ev.length = 0; S.drainEvents(g, ev);
            for (const e of ev) {
              if (e.type === 'point') { pts++; if (e.team === 0) won++; }
              else if (e.type === 'hit' && e.human) { ht++; if (e.kind === 'serve') hsrvOk++; }
              else if (e.type === 'hit' && e.kind === 'set' && e.team === 0 && g.setPlan[0] && g.setPlan[0].to === g.ctrl) setTo++;
              else if (e.type === 'serveReady' && e.player === g.ctrl) hsrv++;
              else if (e.type === 'switch') sw++;
            }
            if (i % 120 === 0) for (const p of g.players) if (!Number.isFinite(p.x + p.y + p.z)) nan++;
          }
        }
      } catch (e) { ex = e && e.stack || String(e); }
      const tpr = pts ? ht / pts : 0;
      res.push(['(a) ' + bn + ' en ' + df + ': sin excepciones ni NaN, receptor n.º 2' + (df === 'easy' ? ', gana >= 45 % de los puntos' : ''),
        !ex && !nan && pts > 40 && role && (df !== 'easy' || won >= 0.45 * pts), { puntos: pts, ganados: pct(won, pts), nan, ex }]);
      res.push(['(b) ' + bn + ': saca con la rotación y sin eventos switch', hsrv > 0 && hsrvOk > 0 && sw === 0, { turnos: hsrv, sacados: hsrvOk, switch: sw }]);
      res.push(['(c) ' + bn + ': toques del humano por rally >= ' + minT + ' y el colocador le coloca', tpr >= minT && setTo > 0, { toquesPorRally: +tpr.toFixed(2), coloca: setTo }]);
    }
    { // (e)-(f) humano QUIETO (sin entrada en todo el partido): no se mueve nunca (tampoco en su balón: desde el 11-nov el imán corto
      // de assistMove solo actúa en 6v6 si el jugador ya empuja el stick), no salta ni golpea (solo contactos de cuerpo, regla); los compañeros
      // no le quitan los 1os toques que caen junto a él (< 1 m) y el colocador no se la da (quieto). En Fácil, su equipo sigue jugando
      let mvOff = 0, mvAll = 0, rallies = 0, jumps = 0, swings = 0, pass0 = 0, steal = 0, setIdle = 0, ex = null;
      try {
        for (let s = 0; s < 2; s++) {
          const g = S.createGame({ format: '6v6', seed: 940 + s, difficulty: 'easy', ctrl: 'one' }), ev = [];
          let px = g.ctrl.x, py = g.ctrl.y;
          for (let i = 0; i < 5 * 60 * 120; i++) {
            const h = g.ctrl, was = g.mode === 'rally' && g.jobs[0] !== h && h.z === 0, wasR = g.mode === 'rally' && h.z === 0;
            S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
            if (was && g.mode === 'rally' && g.jobs[0] !== h && g.ctrl === h) mvOff += Math.hypot(h.x - px, h.y - py);
            if (wasR && g.mode === 'rally' && g.ctrl === h) mvAll += Math.hypot(h.x - px, h.y - py);
            px = g.ctrl.x; py = g.ctrl.y;
            for (const e of ev) {
              if (e.type === 'serveReady') rallies++;
              else if (e.type === 'jump' && e.player === g.ctrl) jumps++;
              else if (e.type === 'hit' && e.human && e.shot !== 'body') swings++;
              else if (e.type === 'hit' && e.team === 0 && e.kind === 'pass' && !e.human) { pass0++; if (Math.hypot(e.x - g.ctrl.x, e.y - g.ctrl.y) < 1.0 && g.ctrl.z === 0) steal++; }
              else if (e.type === 'hit' && e.kind === 'set' && e.team === 0 && g.setPlan[0] && g.setPlan[0].to === g.ctrl) setIdle++;
            }
          }
        }
      } catch (e) { ex = e && e.stack || String(e); }
      res.push(['(e) humano quieto: no se mueve (ni hacia su balón), no salta ni golpea solo', !ex && rallies > 20 && mvAll / Math.max(1, rallies) < 0.05 && jumps === 0 && swings === 0,
        { saques: rallies, mPorRally: +(mvAll / Math.max(1, rallies)).toFixed(3), mFueraDeSuBalon: +(mvOff / Math.max(1, rallies)).toFixed(3), saltos: jumps, golpes: swings, ex }]);
      res.push(['(f) humano quieto: los compañeros no le quitan los balones de su zona y el colocador no se la da', steal <= Math.max(2, 0.02 * pass0) && setIdle === 0,
        { primerosToquesCompañeros: pass0, junto: steal, colocaciones: setIdle }]);
      // (g) colocaciones regaladas (VB.AI6.setReady): delantero a 3,8 m de la red en la batida y jugando → puede recibirla; lejos de la
      // red (6 m) o quieto (sin entrada en HUM.idleT s) → nunca
      const VB6 = VB.AI6, sd0 = S.side(0), n6 = [0, 0, 0];
      for (let k = 0; k < 3; k++) for (let n = 0; n < 200; n++) {
        const h = S.createGame({ format: '6v6', seed: 700 + n, ctrl: 'one' }), st = VB6.setterOf(h, 0), c = h.ctrl;
        h._pq6 = [{ q: 0.9, t: h.time }, { q: 0, t: -9 }]; c.front = true;
        c.x = sd0 * (k === 1 ? 6 : 3.8); c.y = sd0 * -3.3; h.hAct = k === 2 ? h.time - VB6.HUM.idleT - 0.5 : h.time;
        VB6.chooseSet(h, st); if (h.setPlan[0].to === c) n6[k]++;
      }
      res.push(['(g) el colocador no coloca al humano lejos de la red ni quieto (sí en la batida y jugando)', n6[0] >= 40 && n6[1] === 0 && n6[2] === 0, { batida: n6[0], lejos: n6[1], quieto: n6[2] }]);
    }
    { // «¡Pídela!»: CAMBIAR en el peloteo, con el humano delantero y antes de la colocación (S.askOk), guarda g.ask6 y emite
      // 'ask' ok; fuera de esa ventana (zaguero, saque) no guarda nada y emite 'ask' sin ok (ui.js: «Ahora no»). Con g.ask6, el
      // colocador le elige mucho más (mismo azar, mismas condiciones)
      const ASK = { move: [0, 0], hit: false, jump: false, switchPlayer: true };
      let asked = false, noOk = 0, noKept = true;
      for (let sd = 31; sd < 31 + 40 && !asked; sd++) {
        const g = S.createGame({ format: '6v6', seed: sd, ctrl: 'one' });
        stepUntil(g, 'whistle', 2000);
        if (g.mode === 'serve') { const a0 = g.ask6; S.step(g, DT, ASK); if (S.drainEvents(g).some(e => e.type === 'ask' && e.ok === false)) noOk++; if (g.ask6 !== a0) noKept = false; }
        for (let i = 0; i < 400 && g.mode === 'serve'; i++) S.step(g, DT, null);
        for (let i = 0; i < 200 && g.mode === 'rally' && !asked; i++) {
          const ok = S.askOk(g), a0 = g.ask6; S.step(g, DT, ASK);
          const ev = S.drainEvents(g).filter(e => e.type === 'ask');
          if (ok && ev.length && ev[0].ok) asked = g.ask6 === g.time;
          else if (!ok && ev.length) { if (ev[0].ok === false) noOk++; if (g.ask6 !== a0) noKept = false; }
        }
      }
      asked = asked && noOk > 0 && noKept;
      const VB6 = VB.AI6, cnt = [0, 0];
      for (let k = 0; k < 2; k++) for (let n = 0; n < 300; n++) {
        const h = S.createGame({ format: '6v6', seed: 500 + n, ctrl: 'one' }), st = VB6.setterOf(h, 0);
        h.ask6 = k ? h.time : -9; h._pq6 = [{ q: 0.9, t: h.time }, { q: 0, t: -9 }]; h.ctrl.front = true;
        h.ctrl.x = S.side(0) * 3.8; h.ctrl.y = S.side(0) * -3.3; h.hAct = h.time; // en la batida y jugando (VB.AI6.setReady)
        VB6.chooseSet(h, st); if (h.setPlan[0].to === h.ctrl) cnt[k]++;
      }
      res.push(['(d) «¡Pídela!»: CAMBIAR guarda g.ask6 solo en su ventana (askOk) y el colocador elige más al humano', asked && cnt[1] - cnt[0] >= 30, { ask6: asked, ahoraNo: noOk, sinPedir: cnt[0], pidiendo: cnt[1] }]);
    }
    { // (h) puestos jugables (lote A, D1): CTRL_ROLES6 = OH, S, OPP, MB (el líbero no se elige); g.ctrl = el 1r de ese puesto (dorsales
      // 2/1/4/3) y g.ctrlBase su atleta de verdad; setCtrlRole cambia de puesto en caliente (al central sustituido le toca el líbero).
      // 3 min de bot medio por puesto (makeBot {six, role}): sin excepciones ni NaN, 0 switch, se juegan puntos (~5/min: >= 8) y el humano
      // toca algún balón
      const NUM6 = { OH: 2, S: 1, OPP: 4, MB: 3 }, ROLES = S.CTRL_ROLES6 || [], perRole = {};
      let okRoles = ROLES.length === 4 && ['OH', 'S', 'OPP', 'MB'].every(r => ROLES.indexOf(r) >= 0), ex = null;
      try {
        for (const r of ROLES) {
          const g = S.createGame({ format: '6v6', seed: 960, difficulty: 'normal', ctrl: 'one', ctrlRole: r, stats: true }), base = g.ctrl;
          const ok0 = g.ctrlRole === r && base.role === r && base.num === NUM6[r] && g.ctrlBase === base;
          const r2 = ROLES[(ROLES.indexOf(r) + 1) % ROLES.length], c2 = S.setCtrlRole(g, r2);
          const okSw = !!c2 && c2 === g.ctrl && g.ctrlRole === r2 && g.ctrlBase && g.ctrlBase.role === r2 && g.ctrlBase.num === NUM6[r2] && (g.ctrl === g.ctrlBase || g.ctrl === g.libero[0]);
          S.setCtrlRole(g, r);
          const okBack = g.ctrlBase === base && g.ctrlRole === r;
          const bot = makeBot(BOTS.medio, 81, { six: true, role: r }), ev = [];
          let pts = 0, ht = 0, sw = 0, nan = 0;
          for (let i = 0; i < 3 * 60 * 120; i++) {
            S.step(g, DT, bot(g)); ev.length = 0; S.drainEvents(g, ev);
            for (const e of ev) { if (e.type === 'point') pts++; else if (e.type === 'hit' && e.human) ht++; else if (e.type === 'switch') sw++; }
            if (i % 120 === 0) for (const p of g.players) if (!Number.isFinite(p.x + p.y + p.z)) nan++;
          }
          perRole[r] = { dorsal: base.num, cambia: okSw && okBack, puntos: pts, toques: ht, switch: sw, nan };
          okRoles = okRoles && ok0 && okSw && okBack && pts >= 8 && ht > 0 && sw === 0 && nan === 0;
        }
      } catch (e) { ex = e && e.stack || String(e); }
      res.push(['(h) 4 puestos jugables (OH, S, OPP, MB; dorsales 2/1/4/3; setCtrlRole cambia): 3 min de bot por puesto sin excepciones, NaN ni switch', okRoles && !ex, { puestos: ROLES, porPuesto: perRole, ex }]);
    }
    { // (i) central humano (D2): cuando el líbero entra por su central, el humano lleva al líbero (g.ctrl === g.libero[0]) y el evento
      // libero del equipo 0 lleva human: true; al volver su central, g.ctrl === g.ctrlBase. Mientras lleva al líbero no saca ni bloquea
      // (reglas del líbero). 10 min: con 6 rotaciones por vuelta, al central le toca salir y volver varias veces
      let asLib = 0, backMB = 0, libHum = 0, libSrv = 0, libBlk = 0, wasLib = false, pts = 0, ex = null;
      try {
        const g = S.createGame({ format: '6v6', seed: 970, difficulty: 'normal', ctrl: 'one', ctrlRole: 'MB', stats: true }), bot = makeBot(BOTS.medio, 83, { six: true, role: 'MB' }), ev = [];
        for (let i = 0; i < 10 * 60 * 120; i++) {
          S.step(g, DT, bot(g)); ev.length = 0; S.drainEvents(g, ev);
          if (g.ctrl === g.libero[0]) { asLib++; wasLib = true; } else if (wasLib && g.ctrl === g.ctrlBase) backMB++;
          for (const e of ev) {
            if (e.type === 'point') pts++;
            else if (e.type === 'libero' && e.team === 0 && e.human) libHum++;
            else if (e.type === 'serveReady' && e.player === g.ctrl && g.ctrl.role === 'L') libSrv++;
            else if (e.type === 'block' && e.human && g.ctrl.role === 'L') libBlk++;
          }
        }
      } catch (e) { ex = e && e.stack || String(e); }
      res.push(['(i) central humano: el líbero entra por él (lleva al líbero, evento libero human) y vuelve; de líbero no saca ni bloquea',
        !ex && asLib > 0 && backMB > 0 && libHum > 0 && libSrv === 0 && libBlk === 0, { pasosDeLibero: asLib, pasosDeVuelta: backMB, eventosLiberoHumano: libHum, saquesDeLibero: libSrv, bloqueosDeLibero: libBlk, puntos: pts, ex }]);
    }
    { // (j) colocador humano (D3): el 2º toque es suyo (humanOwns ampliado: a < 3 m de él o en la zona de ataque). Con el bot medio que va
      // al punto de colocación, >= 60 % de los 2.os toques de su equipo son suyos (el resto: pases horribles que juega el colocador de
      // emergencia, y balones que el bot no llega a tocar). laneOf (puro, local del equipo: yl = side·my, d = side·mx) y
      // chooseSet(g, p, lane) eligen el carril del stick cuando hay atacante válido: 200 semillas × 4 carriles, sin azar en el carril
      // (se admite 2 % por si el bloqueo rival anula al atacante del carril). Y la colocación en SALTO con carril por la sim entera
      // (sim.hit, rama jset → laneOf → chooseSet, revisión del lote A): saca el rival, en el 1r toque del equipo humano el balón se reconduce
      // a un pase limpio al punto de colocación (en sistema), el colocador humano se planta debajo, salta con el balón a 0,46 s de los 3 m
      // y pulsa COLOCAR en el aire con el stick en el carril (módulo 1): colocación en salto humana de 2º toque con el tempo del carril
      // (pipe: destino detrás de los 3 m, d >= 3,3). Con el stick a 0,3 (zona muerta de D3: aim va normalizado y g.swingLen le devuelve el
      // módulo) el carril NO se fuerza: hacia atrás, el pipe sale como mucho la mitad de las veces (su peso es 0,45 de ~3,1)
      let sec0 = 0, secH = 0, pts = 0, nan = 0, ex = null;
      try {
        for (let s = 0; s < 2; s++) {
          const g = S.createGame({ format: '6v6', seed: 980 + s, difficulty: 'normal', ctrl: 'one', ctrlRole: 'S', stats: true }), bot = makeBot(BOTS.medio, 85 + s, { six: true, role: 'S' }), ev = [];
          for (let i = 0; i < 6 * 60 * 120; i++) {
            S.step(g, DT, bot(g)); ev.length = 0; S.drainEvents(g, ev);
            for (const e of ev) { if (e.type === 'point') pts++; else if (e.type === 'hit' && e.team === 0 && e.touch === 2) { sec0++; if (e.human) secH++; } }
            if (i % 120 === 0) for (const p of g.players) if (!Number.isFinite(p.x + p.y + p.z)) nan++;
          }
        }
      } catch (e) { ex = e && e.stack || String(e); }
      const VB6 = VB.AI6, sd0 = S.side(0), got = {}, NL = 200, jget = {}, jn = {}, jdead = { n: 0, pipe: 0 }, NJ = 10;
      let laneOk = 0, laneN = 0, exL = null;
      try {
        // laneOf: stick (mundo) → carril local; |stick| < 0,4 → null; a igualdad manda el lateral. El equipo 1 con el stick en espejo da lo mismo
        const LANE_IN = [[0, -1, 'left'], [0, 1, 'right'], [-1, 0, 'mid'], [1, 0, 'back'], [0.2, 0.2, null], [-0.5, -0.5, 'left'], [0.5, 0.3, 'back'], [-0.3, 0.6, 'right']];
        const g = S.createGame({ format: '6v6', seed: 1, ctrl: 'one', ctrlRole: 'S' }), st = g.ctrl, q1 = g.teams[1][0];
        for (const [mx, my, want] of LANE_IN) { laneN += 2; if (VB6.laneOf(g, st, sd0 * mx, sd0 * my) === want) laneOk++; if (VB6.laneOf(g, q1, -sd0 * mx, -sd0 * my) === want) laneOk++; }
        const TEMPO = { left: 'high', right: 'shoot', mid: 'quick', back: 'pipe' }, ROLE_L = { left: 'OH', right: 'OPP', mid: 'MB', back: 'OH' };
        for (const lane of ['left', 'right', 'mid', 'back']) {
          got[lane] = 0;
          for (let n = 0; n < NL; n++) {
            const h = S.createGame({ format: '6v6', seed: 700 + n, ctrl: 'one', ctrlRole: 'S' }), hs = h.ctrl;
            if (lane === 'back') { S.rotate(h, 0); S.rotate(h, 0); S.applyLibero(h); } // 2 rotaciones: OH1 en zona 6 (zaguero): candidato al pipe
            h._pq6 = [{ q: 0.9, t: h.time }, { q: 0, t: -9 }]; hs.x = sd0 * 0.9; hs.y = sd0 * 0.9; // en sistema: recepción buena y colocador en su punto
            VB6.chooseSet(h, hs, lane); const P = h.setPlan[0];
            if (P && P.tempo === TEMPO[lane] && P.to && P.to.role === ROLE_L[lane] && (lane === 'back' ? !P.to.front : P.to.front)) got[lane]++;
          }
        }
        // colocación en salto con carril por la sim entera (ver arriba). Devuelve {e, P} (evento hit del 2º toque y g.setPlan[0]) o null si
        // el punto acaba antes (saque fallado, ace…). En la rotación inicial el colocador tiene los 4 carriles: OH1 en 2, MB1 en 3, OPP en 4
        // y OH2 en 5 (zaguero: pipe)
        const LANE_V = { left: [0, -1], right: [0, 1], mid: [-1, 0], back: [1, 0] };
        const jsetLane = (seed, lane, len) => {
          const h = S.createGame({ format: '6v6', seed, difficulty: 'normal', ctrl: 'one', ctrlRole: 'S', serveClock: false }), hs = h.ctrl;
          h.serving = 1; S._setupServe(h); S.drainEvents(h);
          const inp = { move: [LANE_V[lane][0] * sd0 * len, LANE_V[lane][1] * sd0 * len], hit: false, jump: false, jset: false, switchPlayer: false };
          let passed = false;
          for (let i = 0; i < 120 * 12; i++) {
            inp.jump = inp.jset = false;
            if (passed) {
              if (hs.z === 0 && hs.vz === 0) { hs.x = h.pr3.x; hs.y = h.pr3.y; if (h.pr3.t > 0 && h.pr3.t <= 0.46) inp.jump = true; }
              else if (hs.z > 0.2 && hs.actionT > 0.12) inp.jset = true;
            }
            S.step(h, DT, passed ? inp : null);
            for (const e of S.drainEvents(h)) {
              if (e.type === 'point' || e.type === 'serveReady') return null;
              if (!passed && e.type === 'hit' && e.team === 0 && e.touch === 1) {
                passed = true; const b = h.ball, T = 1.1, zt = 3.1;
                b.vx = (sd0 * 0.9 - b.x) / T; b.vy = (sd0 * 0.9 - b.y) / T; b.vz = (zt - b.z + 0.5 * C.G * T * T) / T; b.dip = 0; b.spin = 0; b.wobA = 0;
                h._pq6[0].q = 0.9; h._pq6[0].t = h.time;
              } else if (passed && e.type === 'hit' && e.team === 0 && e.touch === 2) return { e, P: h.setPlan[0] };
            }
          }
          return null;
        };
        for (const lane of ['left', 'right', 'mid', 'back']) {
          jget[lane] = 0; jn[lane] = 0;
          for (let n = 0; n < NJ; n++) {
            const r = jsetLane(700 + n, lane, 1); if (!r) continue; jn[lane]++;
            const P = r.P;
            if (r.e.human && r.e.jset && r.e.shot === 'jump' && P && P.tempo === TEMPO[lane] && P.to && P.to.role === ROLE_L[lane] && (lane === 'back' ? !P.to.front && P.d >= 3.3 : P.to.front)) jget[lane]++;
          }
        }
        for (let n = 0; n < NJ; n++) { const r = jsetLane(700 + n, 'back', 0.3); if (!r) continue; jdead.n++; if (r.e.human && r.e.jset && r.P && r.P.tempo === 'pipe') jdead.pipe++; }
      } catch (e) { exL = e && e.stack || String(e); }
      const jOk = ['left', 'right', 'mid', 'back'].every(l => jn[l] >= 5 && jget[l] === jn[l]) && jdead.n >= 5 && jdead.pipe <= 0.5 * jdead.n;
      res.push(['(j) colocador humano: >= 60 % de los 2.os toques de su equipo son suyos; laneOf y chooseSet(g, p, lane) eligen el carril pedido; colocación en salto con carril (jset) por la sim, zona muerta 0,4',
        !ex && !exL && !nan && sec0 > 20 && secH / sec0 >= 0.6 && laneOk === laneN && ['left', 'right', 'mid', 'back'].every(l => got[l] >= 0.98 * NL) && jOk,
        { segundosToques: sec0, suyos: pct(secH, sec0), puntos: pts, laneOf: laneOk + '/' + laneN, carril: got, jsetCarril: ['left', 'right', 'mid', 'back'].map(l => l + ' ' + jget[l] + '/' + jn[l]).join(', '), stick03atras: 'pipe ' + jdead.pipe + '/' + jdead.n, ex: ex || exL }]);
    }
    { // (k) 6 formaciones de recepción del 5-1 (D6): en cada rotación × 2 equipos, con el rival sacando (placeServe tras applyLibero, como
      // setupServe), 0 solapamientos en los dos equipos (overlapCount), los 3 receptores (L + los 2 OH) en línea a d >= 5 y el colocador
      // escondido, nunca ENTRE los receptores: o al menos 1 m más cerca de la red que el receptor más adelantado (delantero en la red,
      // zaguero penetrando detrás de su delantero), o fuera del abanico lateral de los 3 (con el colocador en zona 1 el receptor delantero
      // está en zona 2 y la legalidad le obliga a quedarse detrás: FORM.RECV le esconde en la esquina del fondo, 1 m más al lado)
      let legal = 0, recvOk = 0, setOk = 0, n = 0, ex = null; const detail = [];
      try {
        for (let t = 0; t < 2; t++) for (let r = 0; r < 6; r++) {
          const g = S.createGame({ format: '6v6', seed: 1000 + r, ctrl: 'one' }), o = 1 - t;
          for (let k = 0; k < r; k++) S.rotate(g, t);
          g.serving = o; S.applyLibero(g);
          const sv = S.serverOf(g, o); g.mode = 'serve'; g.server = sv;
          VB.AI6.placeServe(g, o, sv); n++;
          const ov = S.overlapCount(g, t) + S.overlapCount(g, o); if (ov === 0) legal++;
          const sd = S.side(t), rec = g.teams[t].filter(p => p.role === 'L' || p.role === 'OH'), st = VB.AI6.setterOf(g, t);
          const dMin = rec.length ? Math.min(...rec.map(p => p.x * sd)) : 0, dSet = st ? st.x * sd : 99;
          const yMax = rec.length ? Math.max(...rec.map(p => Math.abs(p.y * sd))) : 0, ySet = st ? Math.abs(st.y * sd) : 0;
          if (rec.length === 3 && dMin >= 5) recvOk++;
          if (dSet <= dMin - 1 || ySet >= yMax + 0.5) setOk++;
          detail.push('e' + t + 'r' + r + ' ' + ov + '/' + dMin.toFixed(1) + '/' + dSet.toFixed(1) + (dSet > dMin - 1 ? '(lado ' + ySet.toFixed(1) + '>' + yMax.toFixed(1) + ')' : ''));
        }
      } catch (e) { ex = e && e.stack || String(e); }
      res.push(['(k) 6 formaciones de recepción legales × 2 equipos: 0 solapamientos, 3 receptores (L + 2 OH) a d >= 5 y el colocador nunca entre ellos',
        !ex && n === 12 && legal === 12 && recvOk === 12 && setOk === 12, { legales: legal + '/12', receptores: recvOk + '/12', colocador: setOk + '/12', 'solapes/dReceptores/dColocador': detail.join(', '), ex }]);
    }
    { // (m) falta de posición del humano (D4): en Difícil el humano que no saca puede moverse durante el saque rival; el receptor zaguero
      // empujado hacia la red (equipo 0 juega en x > 0: delante = x menor) hasta pasar a su delantero → al golpe de saque, punto para el
      // rival con reason 'position' («Falta de posición», señal ya existente). En Fácil el mismo stick no le mueve (placeServe le deja
      // en su sitio legal) y no se pita. La IA sigue con 0 solapamientos en los dos partidos. Se le da al sacador rival 3 s de ritual
      // para que el humano llegue (hasta 5 m si su delantero está en la red)
      const FB6 = { 1: 2, 6: 3, 5: 4 }, PUSH = { move: [-1, 0], hit: false, jump: false, switchPlayer: false }, out = {};
      for (const df of ['hard', 'easy']) {
        const o = { encontrado: false, movido: 0, solapados: -1, motivo: '', equipo: -1, texto: '', iaSolapada: -1 };
        try {
          const g = S.createGame({ format: '6v6', seed: 990, difficulty: df, ctrl: 'one', stats: true });
          let found = false; // hasta un saque rival con el humano zaguero (su equipo ya ha rotado), antes del silbato
          for (let i = 0; i < 12 * 60 * 120 && !found; i++) { S.step(g, DT, null); S.drainEvents(g); found = g.mode === 'serve' && g.serving === 1 && g.serveState === 'ready' && !g.ctrl.front && !g.serveAuth; }
          o.encontrado = found;
          if (found) {
            const h = g.ctrl, fr = S.onCourt(g, 0, FB6[h.zone]), x0 = h.x, y0 = h.y;
            g.timer = Math.max(g.timer, 3);
            for (let i = 0; i < 300 && g.mode === 'serve' && h.x > fr.x - 0.3; i++) { S.step(g, DT, PUSH); S.drainEvents(g); }
            o.movido = +Math.hypot(h.x - x0, h.y - y0).toFixed(2); o.solapados = S.overlapCount(g, 0);
            const pt = stepUntil(g, 'point', 4000).find(e => e.type === 'point');
            if (pt) { o.motivo = pt.reason; o.equipo = pt.team; o.texto = pt.text; o.senal = pt.signal; }
          }
          o.iaSolapada = g.stats.overlap[1];
        } catch (e) { o.ex = e && e.stack || String(e); }
        out[df] = o;
      }
      const H = out.hard, E = out.easy;
      res.push(['(m) falta de posición: en Difícil el receptor zaguero movido delante de su delantero → punto rival por position; en Fácil no se mueve ni se pita; IA 0 solapamientos',
        H.encontrado && H.movido > 0.3 && H.solapados > 0 && H.motivo === 'position' && H.equipo === 1 && H.texto === 'Falta de posición' && H.iaSolapada === 0 && !H.ex &&
        E.encontrado && E.movido < 0.05 && E.solapados === 0 && E.motivo !== 'position' && E.iaSolapada === 0 && !E.ex, out]);
    }
    { // (n) bloqueo activo y overpass (revisión del 12-nov): el humano en la red (colocador) que pulsa GOLPEAR en el aire ante un pase
      // rival que se pasa de campo, aún a 0,8 m en el campo rival, hace un golpe normal (swing), nunca toque de red ni pulsación de bloqueo.
      // VB.Sim.blockPressCase: false con el overpass y con el saque que viene; true con el rival construyendo (balón que se aleja)
      const HIT = { move: [0, 0], hit: true, jump: false, switchPlayer: false }, o = { casos: 0, swing: 0, red: 0, pulsa: 0, casoSet: 0, casoSaque: 0 };
      try {
        for (let sd = 0; sd < 40; sd++) {
          const g = S.createGame({ format: '6v6', seed: 3100 + sd, difficulty: 'normal', ctrl: 'one' });
          S.setCtrlRole(g, 'S');
          for (let i = 0; i < 60 * 120 && g.mode !== 'rally'; i++) { S.step(g, DT, null); S.drainEvents(g); }
          if (g.mode !== 'rally') continue;
          const h = g.ctrl, b = g.ball; o.casos++;
          h.x = 0.5; h.y = 0; h.z = 0.6; h.vz = 0; h.swing = null;
          g.touchTeam = 1; g.touches = 1; g.lastKind = 'pass'; b.held = false; b.x = -0.8; b.y = 0; b.z = 3; b.vx = 3; b.vy = 0; b.vz = 0;
          const c1 = S.blockPressCase(g, h); g.lastKind = 'serve'; g.touches = 3; const c2 = S.blockPressCase(g, h);
          g.lastKind = 'set'; g.touches = 2; b.vx = -1; b.x = -2; if (S.blockPressCase(g, h)) o.casoSet++;
          g.lastKind = 'pass'; g.touches = 1; b.x = -0.8; b.vx = 3; if (!c1 && !c2) o.casoSaque++;
          S.step(g, DT, HIT); const ev = S.drainEvents(g);
          if (ev.some(e => e.type === 'swing')) o.swing++;
          if (ev.some(e => e.type === 'netTouch' || (e.type === 'point' && e.reason === 'net'))) o.red++;
          if (ev.some(e => e.type === 'blockPress')) o.pulsa++;
        }
      } catch (e) { o.ex = e && e.stack || String(e); }
      res.push(['(n) bloqueo activo: GOLPEAR en el aire ante un overpass a 0,8 m = golpe normal (swing), sin red ni pulsación; blockPressCase sí con el rival colocando, no con el saque',
        o.casos >= 30 && o.swing === o.casos && o.red === 0 && o.pulsa === 0 && o.casoSet === o.casos && o.casoSaque === o.casos && !o.ex, o]);
    }
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('6v6 con humano: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    console.log('\n6v6 con humano (sin movimientos solos, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)' + (failures === f0 ? ' OK' : '') + '\n  ' + res.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('\n  '));
  }

  // VÓLEY PLAYA (createGame({venue:'beach'}), 10-nov-2026): pista 16×8, sets a 21 / 15, cambio de campo cada 7 (5 en el 3.º),
  // bloqueo que cuenta como toque, pokey, dobles de dedos; y que la IA juegue creíble en la pista pequeña
  if (ONLY !== 'matrix') {
    const f0 = failures, res = [], t0 = Date.now();
    const gb = S.createGame({ seed: 7, venue: 'beach' }), gh = S.createGame({ seed: 7 }), g6 = S.createGame({ seed: 7, venue: 'beach', format: '6v6' });
    res.push(['(a) flag y pista: playa 16×8 a 21, pabellón 18×9 intacto, 6v6 sin playa', gb.beach && gb.venue === 'beach' && gb.HL === 8 && gb.HW === 4 &&
      Math.abs(gb.cs - 8 / 9) < 1e-12 && gb.points === 21 && !gh.beach && gh.HL === 9 && gh.HW === 4.5 && gh.cs === 1 && gh.points === 25 && !g6.beach && g6.HL === 9 &&
      S.court(gb) === S.court('beach') && S.court('beach').HL === 8 && S.court(gh).HW === 4.5 && S.court().HL === 9 &&
      S.createGame({ seed: 7, venue: 'beach', points: 11 }).points === 21, { HL: gb.HL, HW: gb.HW, points: gb.points }]);
    // (b) líneas: botes que el pabellón da dentro y la playa fuera (más de 8 m de fondo / 4 m de lateral), sin error arbitral posible
    const landAt = (venue, x, y) => {
      const g = S.createGame({ seed: 11, venue, ritual: false }); S.drainEvents(g);
      g.touchTeam = 0; g.touches = 3; g.lastTeam = 0; g.lastKind = 'spike'; g.lastShot = 'power'; g.lastPlayer = g.teams[0][0];
      for (const p of g.players) { p.x = S.side(p.team) * 12; p.y = 5.9; } // lejos: nadie la toca
      rallyAt(g, { x, y, z: 0.5, vz: -2 });
      const ev = stepUntil(g, 'land', 300).find(e => e.type === 'land'); return ev ? ev.inside : null;
    };
    const lines = { fondo85: [landAt('hall', -8.5, 0), landAt('beach', -8.5, 0)], lado43: [landAt('hall', -4, 4.3), landAt('beach', -4, 4.3)],
      dentro: [landAt('beach', -7.6, 3.6)], fondo2: [landAt('beach', 8.4, -1)] };
    res.push(['(b) balón fuera más allá de 8 m de fondo y 4 m de lateral (en el pabellón, dentro)', lines.fondo85[0] === true && lines.fondo85[1] === false &&
      lines.lado43[0] === true && lines.lado43[1] === false && lines.dentro[0] === true && lines.fondo2[0] === false, lines]);
    // partidos CPU contra CPU (demo) y autopilot contra Normal en la playa
    const NB = 8; let pts = 0, so = 0, hits = 0, done = 0, swaps = 0, swapBad = 0, setBad = 0, setsN = 0, nan = 0, ex = null, rallies = [];
    let blkTouch = 0, blkTouchBad = 0, pokey = 0, tipsB = 0, dbl = 0, outB = 0, deep = 0, srvSpot = 0, srvN = 0;
    try {
      for (let s = 0; s < NB; s++) {
        const g = S.createGame(s % 2 ? { seed: 900 + s, venue: 'beach', autopilot: true, difficulty: 'normal', stats: true } : { seed: 900 + s, venue: 'beach', demo: true, stats: true });
        S.drainEvents(g); let tot = 0;
        for (let i = 0; i < 120 * 60 * 60 && g.mode !== 'over'; i++) {
          S.step(g, DT, null);
          for (const e of S.drainEvents(g)) {
            if (e.type === 'point') { pts++; tot = e.score[0] + e.score[1]; if (e.sideout) so++; hits += e.rallyHits; rallies.push(e.rallyTime);
              if (e.reason === 'double' && e.text === 'Dobles en la colocación de dedos') dbl++; if (e.reason === 'out') outB++; }
            if (e.type === 'courtChange' && e.why === 'swap') { swaps++; const sum = e.score[0] + e.score[1], ev2 = e.setNo === 3 ? 5 : 7;
              if (sum % ev2 || e.every !== ev2 || Math.max(e.score[0], e.score[1]) >= S.setTarget(g) && Math.abs(e.score[0] - e.score[1]) >= 2) swapBad++; }
            if (e.type === 'courtChange' && e.why === 'eight') swapBad++; // el cambio a los 8 es del pabellón
            if (e.type === 'set') { setsN++; const a = e.score[0], b = e.score[1], tg = e.setNo === 3 ? 15 : 21, w = Math.max(a, b), l = Math.min(a, b);
              if (w < tg || w - l < 2 || (w > tg && w - l !== 2)) setBad++; }
            if (e.type === 'block' && (e.result === 'soft' || e.result === 'touch')) { blkTouch++; if (g.touches !== 1 || g.touchTeam !== e.team) blkTouchBad++; }
            if (e.type === 'hit' && e.shot === 'tip') { tipsB++; if (e.pokey) pokey++; }
            if (e.type === 'hit' && e.kind === 'serve' && e.target) { srvN++; if (Math.abs(e.target[0]) <= 8 && Math.abs(e.target[1]) <= 4) srvSpot++; }
            if (e.type === 'land' && Math.abs(e.x) > 8.6) deep++;
          }
          if (i % 240 === 0) for (const p of g.players) if (!Number.isFinite(p.x + p.y + p.z)) nan++;
        }
        if (g.mode === 'over') done++;
      }
    } catch (e) { ex = e && e.stack || String(e); }
    rallies.sort((a, b) => a - b);
    const sidePct = pts ? 100 * so / pts : 0, med = rallies.length ? rallies[rallies.length >> 1] : 0;
    res.push(['(c) partidos completos sin excepciones ni NaN', !ex && !nan && done === NB && pts > 400, { partidos: done + '/' + NB, puntos: pts, nan, ex }]);
    res.push(['(d) sets a 21 y el 3.º a 15 (mejor de 3), por 2', setBad === 0 && setsN >= 2 * NB, { sets: setsN, mal: setBad }]);
    res.push(['(e) cambio de campo cada 7 (cada 5 en el 3.º), nunca a los 8', swapBad === 0 && swaps >= 3 * NB, { cambios: swaps, mal: swapBad }]);
    res.push(['(f) el toque de bloqueo cuenta como toque (quedan 2)', blkTouch > 10 && blkTouchBad === 0, { toquesBloqueo: blkTouch, mal: blkTouchBad }]);
    res.push(['(g) dejadas de la playa = pokey (nudillos)', tipsB > 0 && pokey === tipsB, { dejadas: tipsB, pokey }]);
    res.push(['(h) IA creíble: side-out 52-70 %, 4-9 toques por rally, mediana 4-9 s', sidePct >= 52 && sidePct <= 70 && hits / pts >= 4 && hits / pts <= 9 && med >= 4 && med <= 9,
      { sideOut: sidePct.toFixed(1) + '%', toques: +(hits / pts).toFixed(2), mediana: +med.toFixed(2) }]);
    res.push(['(i) la IA saca y juega a la pista pequeña: dianas de saque dentro de 16×8, pocos fuera, botes muy largos como en el pabellón (~12-14 %)', srvN > 200 && srvSpot / srvN > 0.97 &&
      outB / pts < 0.3 && deep / pts < 0.18 && dbl / pts < 0.03, { saques: srvN, dianaDentro: pct(srvSpot, srvN), fuera: pct(outB, pts), botesLargos: pct(deep, pts), dobles: dbl }]);
    const bad = res.filter(r => !r[1]);
    if (bad.length) fail('vóley playa: ' + bad.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('; '));
    console.log('\nVóley playa (' + NB + ' partidos, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)' + (failures === f0 ? ' OK' : '') + '\n  ' + res.map(r => r[0] + ' ' + JSON.stringify(r[2])).join('\n  '));
  }

  // Huella 2v2 (sprint 1 del 6v6): 150 partidas de referencia deben dar EXACTAMENTE lo mismo que tools/fp-2v2.json
  if (ONLY !== 'matrix') {
    console.log('\n== Huella 2v2 (tools/fingerprint6.js) ==');
    try { if (require('./fingerprint6.js').main() !== 0) fail('huella 2v2 distinta de tools/fp-2v2.json'); }
    catch (e) { fail('huella 2v2 excepción: ' + (e && e.stack || e)); }
  }

  console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
  process.exit(failures ? 1 : 0);
}
if (isMainThread) main();
else parentPort.postMessage(runJob(workerData));
