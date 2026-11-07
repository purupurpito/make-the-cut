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
  for (const f of ['js/sim.js', 'js/ai.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.VB;
}
const VB = load();
const S = VB.Sim, C = VB.C;
const DT = 1 / C.SIM_HZ;
let failures = 0;
const fail = m => { failures++; console.error('FALLO:', m); };
const KNOWN = ['hit', 'block', 'net', 'land', 'point', 'set', 'match', 'gameOver', 'whistle', 'jump', 'switch', 'serveReady',
  'sideout', 'newSet', 'bounce', 'swing', 'landPlayer', 'newMatch', 'toss', 'miss', 'dive', 'netTouch', 'courtChange'];
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
// Vocabulario del árbitro (FCVB): cada motivo de punto con sus textos válidos. Un texto nuevo debe pasar por aquí.
const POINT_TEXTS = {
  in: ['El balón cae en tu campo', 'El balón cae en el campo rival', 'Saque a la red', 'Balón a la red'],
  // (out también admite 'Saque a la red'/'Balón a la red': da en la red y cae fuera en el propio campo)
  out: ['Saque fuera', 'Remate fuera', 'Dejada fuera', 'Recepción fuera', 'Defensa fuera', 'Colocación fuera', 'Balón fuera', 'Toca el bloqueo y sale fuera', 'Le da en el cuerpo y sale fuera', 'Saque a la red', 'Balón a la red'],
  antenna: ['Balón toca la antena', 'Balón por fuera de la antena'], under: ['Balón por debajo de la red'],
  double: ['Dobles: el mismo jugador toca dos veces'], four: ['4 toques'], net: ['Toque de red'], block: ['Bloqueo del saque'],
  attackServe: ['Ataque sobre el saque'], serve: ['Falta de saque: 8 segundos', 'Falta de saque: el balón cae sin golpearlo']
};
const badText = new Set();

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

/** Ejecuta `seconds` de juego. inputFn(g) devuelve la entrada humana o null. */
function run(label, opts, seconds, inputFn, quiet) {
  const g = S.createGame(Object.assign({ stats: true, seed: SEED }, opts));
  const ev = newCounters(), evs = [], serveTakeoff = [];
  let steps = Math.round(seconds / DT), lastSamePlayer = null, sameTouch = 0, matches = 0, setsSeen = 0, matchWins = [0, 0];
  let ghost = 0, stalePr = 0, lateSw = 0, blkSwitch = 0, spikeCtl = null; const fresh = {};
  const t0 = Date.now();
  try {
    for (let i = 0; i < steps; i++) {
      const preSp = Math.hypot(g.ball.vx, g.ball.vy, g.ball.vz), preT = g.pr1.t; // lo que ve la sim al decidir el cambio
      S.step(g, DT, inputFn ? inputFn(g, i) : null);
      evs.length = 0; S.drainEvents(g, evs);
      for (const e of evs) {
        if (!(e.type in ev)) fail('evento desconocido ' + e.type); else ev[e.type]++;
        if (!Number.isFinite(e.t)) fail('evento sin t ' + e.type);
        if (e.type === 'hit') {
          if (!(e.quality >= 0 && e.quality <= 1) || !e.grade) fail('hit sin calidad válida');
          if (e.kind !== 'serve') { if (lastSamePlayer === e.player && e.touch > 1) sameTouch++; lastSamePlayer = e.player; }
        }
        if (e.type === 'block') lastSamePlayer = null; // tras bloqueo se puede volver a tocar
        if (e.type === 'jump' && g.mode === 'serve' && g.serveJump) serveTakeoff.push(e.player.x * S.side(e.player.team));
        if (e.type === 'point') lastSamePlayer = null;
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
  }
  if (sameTouch) fail(label + ` mismo jugador tocó dos veces seguidas ${sameTouch} veces sin falta`);
  if (ghost) fail(label + ` ${ghost} remates atraviesan las manos del bloqueador sin evento block`);
  if (stalePr) fail(label + ` g.pr3 vieja tras ${stalePr} toques`);
  if (lateSw) fail(label + ` ${lateSw} cambios automáticos de jugador con balón rápido a < 0,6 s del contacto`);
  if (blkSwitch) fail(label + ` el control salta del bloqueador al defensor ${blkSwitch} veces durante el ataque de la CPU`);
  return { g, st, ev, med, mean, matches, setsSeen, matchWins };
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
function makeBot(bp, seed) {
  const rng = S._makeRng(seed), gauss = () => (rng() + rng() + rng() + rng() - 2) * 1.732;
  const mv = [0, 0], want = [0, 0], aimv = [0, 0], out = { move: mv, hit: false, jump: false, switchPlayer: false };
  let stamp = -9, lead = 0, jlead = 0, eu = 0, ev = 0, presses = 0, useAim = false, useGap = false, serveWait = 0;
  let react = 0, wrongT = 0, wrongD = 0, jumpOk = true, blockT = 0, blockSeen = -1;
  let lastCtrl = null, yawE = 0, yawT = 0, naive = false; const mvOut = [0, 0];
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
      if (useAim) out.move = aimv;
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
    const blocks = bp.block || naive || g.defRole === 'block'; // con CAMBIAR en la colocación rival el juego le pide bloquear
    if (g.swingLive && p.z > 0 && (useGap || useAim)) out.move = aimv; // en el aire mantiene la dirección mientras dura el gesto
    const since = g.time - g.lastTouchT, job = g.jobs[0] === p;
    let tx = p.x, ty = p.y;
    const attack = job && g.touchTeam === 0 && g.touches === 2 && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5;
    if (job) {
      const pr = attack ? g.pr3 : g.pr1;
      if (attack) { tx = pr.x + 0.35 * sd; ty = pr.y; } else { tx = pr.x + 0.15; ty = pr.y; }
      // error de lectura: crece con el vuelo que queda y la distancia; en profundidad (eje de la cámara) es mayor
      const dist = Math.hypot(pr.x - p.x, pr.y - p.y), tr = Math.max(0, pr.t);
      const s = bp.posErr * (0.22 + 0.55 * Math.min(1.6, tr / 1.1) + 0.06 * Math.min(8, dist));
      tx += eu * s * 0.5 * bp.depth; ty += ev * s * 0.5;
      if (wrongD && since < wrongT) tx += wrongD;
    } else if (g.defRole === 'dig' && g.touchTeam === 1 && !naive) { tx = 5.4; ty = Math.max(-2, Math.min(2, -g.pr3.y * 0.3)); } // el juego le da la defensa
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
        if (useGap && p.z > 0.25) { gapAim(g, p, aimv); out.move = aimv; } // remate: busca el hueco
        else if (useAim) out.move = aimv;
      }
    }
    // bloqueo: salta cuando VE despegar al rematador rival (con su reacción y su error de timing)
    if (blocks && !job && p.z === 0 && Math.abs(p.x) < 1.2 && g.touchTeam === 1 && g.touches === 2) {
      const att = g.teams[1].some(q => q.z > 0.35 && q.vz < 1.5 && Math.abs(q.x) < 4);
      if (att && blockSeen !== stamp) { blockSeen = stamp; blockT = g.time + Math.max(0, bp.react * 0.35 + gauss() * bp.sigma * (naive ? 2.4 : 1.2)); }
      if (att && g.time >= blockT) out.jump = true;
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

/** Trabajo de una casilla de la matriz (se ejecuta en un worker). */
function runJob(j) {
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
}

// ================= 3) Fuzz: entrada humana aleatoria =================
if (ONLY !== 'matrix') {
  const rng = S._makeRng(SEED ^ 0xabc), held = [0, 0];
  run('Fuzz humano aleatorio', { demo: false }, 8 * 60, (g, i) => {
    if (i % 30 === 0) { const a = rng() * Math.PI * 2, m = rng() < 0.2 ? 0 : rng(); held[0] = Math.cos(a) * m; held[1] = Math.sin(a) * m; }
    return { move: held, hit: rng() < 0.04, jump: rng() < 0.01, switchPlayer: rng() < 0.005 };
  });
}


  // ================= 2) y 4) Matriz en paralelo =================
  if (BOTMIN > 0) {
    const jobs = [];
    const LV = VB.DIFF_ORDER; // easy, normal, hard, expert
    for (let s = 0; s < NSEED; s++) {
      for (const d of LV) jobs.push({ kind: 'auto', diff: d, seconds: BOTMIN * 60, label: 'auto ' + d, seed: SEED + 1000 * s });
      for (const bn of Object.keys(BOTS)) for (const d of LV)
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
    console.log(`\n######## IA compañero (equipo 0) contra cada dificultad  [${NSEED} semillas × ${BOTMIN} min de juego por casilla, ${((Date.now() - t0) / 1000).toFixed(1)} s en paralelo] ########`);
    const diffShare = {};
    for (const r of res.filter(r => r && r.kind === 'auto')) {
      diffShare[r.diff] = r.won0 / r.points;
      console.log(`  vs ${VB.DIFF[r.diff].name.padEnd(8)} puntos IA-compañero ${pct(r.won0, r.points)} (${r.points} pts)  rally mediana ${r.med.toFixed(2)} s  remates ${r.hits.spike} bloqueos ${r.blocks} planchas ${r.dives}  partidos ${r.matchWins.join('-')}  cómo ${JSON.stringify(r.how)}`);
    }
    if (BOTMIN >= 20 && !MFILTER && !(diffShare.easy > diffShare.normal + 0.04 && diffShare.normal > diffShare.hard + 0.02 && diffShare.hard > diffShare.expert + 0.02)) fail('las dificultades no están ordenadas: ' + JSON.stringify(diffShare));
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
      const rng2 = (k, a, b, why) => { if (!(botRes[k] > a && botRes[k] < b)) fail(why + ' (' + k + ' = ' + (botRes[k] || 0).toFixed(2) + ', objetivo ' + a + '-' + b + ')'); };
      // revisión 3 (bots humanos en tercera persona; márgenes = objetivo ± ruido de 4 semillas × 20 min, ~2,5 puntos de %)
      rng2('novato:easy', 0.40, 0.51, 'novato en su primera sesión vs Fácil: objetivo 45-49 % de puntos (perdona, pero no es automático; gana ~1 de cada 3)');
      rng2('medio:normal', 0.44, 0.57, 'jugador medio vs Normal: objetivo ~50 % de puntos');
      rng2('novato:normal', 0.22, 0.42, 'novato vs Normal: objetivo ~33 %');
      if (!(botRes['medio:easy'] > 0.62)) fail('Fácil no perdona a un jugador medio (' + botRes['medio:easy'].toFixed(2) + ')');
      if (!(botRes['medio:hard'] < botRes['medio:normal'] - 0.06 && botRes['medio:expert'] < botRes['medio:hard'] - 0.06)) fail('Difícil/Experto no son claramente más difíciles para el jugador medio');
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
      if (!ld || ld.inside !== inside) fail(`línea ${axis} a ${off} m: inside=${ld && ld.inside}`);
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
          if (g.mode === 'serve' && g.serveState === 'toss' && !pressed && g.ball.vz < 0) { const w = S.hitWindow(g, h); if (w.t <= C.WINDUP) { inp.hit = true; pressed = true; if (aim) inp.move = [-0.7, (s % 2 ? 1 : -1) * 0.7]; } }
          S.step(g, DT, inp);
          for (const e of S.drainEvents(g)) { if (e.type === 'hit' && e.kind === 'serve') n++; if (e.type === 'point') { res = e; if (e.team === 0 && e.how === 'ace') ace++; } }
        }
      } return ace / n; };
    const fn = aceRate('normal', false), fa = aceRate('normal', true);
    const msg = 'aces de flotante perfecto en Normal: sin apuntar ' + (100 * fn).toFixed(0) + '%, apuntado ' + (100 * fa).toFixed(0) + '%';
    if (!(fn >= 0.02 && fn <= 0.09 && fa >= 0.07 && fa <= 0.16 && fa > fn)) fail(msg + ' (objetivo 2-9 / 7-16)'); else console.log(msg + ' OK');
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
    const a1 = S.aimPoint(ga, {}, [-1, 0]), a2 = S.aimPoint(ga, {}, [0, 1]), a0 = S.aimPoint(ga, {});
    if (!a1 || a1.mode !== 1 || a1.kind !== 'serve' || Math.abs(a1.x + 8.4) > 1e-9 || Math.abs(a2.y - 3.4) > 1e-9 || a0.aimed || a0.x !== -6) { ok = false; msg.push('saque ' + JSON.stringify([a1, a2, a0])); }
    // saque real apuntado con timing perfecto: el destino del evento hit es el de aimPoint
    let tossed = false, hitE = null, ap = null;
    for (let i = 0; i < 600 && !hitE; i++) {
      const inp = { move: [-0.6, 0.8], hit: false, jump: false };
      if (ga.serveState === 'ready' && !tossed) { inp.hit = true; tossed = true; }
      else if (ga.serveState === 'toss' && ga.ball.vz < 0 && S.hitWindow(ga, ga.ctrl).t <= C.WINDUP && !ga.swingLive) { inp.hit = true; ap = Object.assign({}, S.aimPoint(ga, {}, inp.move)); }
      S.step(ga, DT, inp); hitE = S.drainEvents(ga).find(e => e.type === 'hit');
    }
    if (!hitE || !ap || ap.mode !== 2 || Math.hypot(hitE.target[0] - ap.x, hitE.target[1] - ap.y) > 1e-6) { ok = false; msg.push('saque real ' + JSON.stringify([hitE && hitE.target, ap])); }
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
  // dificultades: alias en castellano
  if (S.createGame({ difficulty: 'Difícil', seed: 1 }).difficulty !== 'hard' || S.createGame({ difficulty: 'facil', seed: 1 }).difficulty !== 'easy' || S.createGame({ difficulty: 'Experto', seed: 1 }).difficulty !== 'expert') fail('alias de dificultad');
  else console.log('dificultad (alias easy/normal/hard/expert, facil/dificil/experto) OK');
}


  console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
  process.exit(failures ? 1 : 0);
}
if (isMainThread) main();
else parentPort.postMessage(runJob(workerData));
