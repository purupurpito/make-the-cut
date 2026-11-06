#!/usr/bin/env node
/* VOLEY 3D — tools/simtest.js  (owner: sim)
 * Test headless de la simulación: carga js/sim.js y js/ai.js en un contexto vm
 * (sin DOM ni THREE) y ejecuta:
 *   1) CPU vs CPU (demo) -> estadísticas de rally, toques, motivos, calidad
 *   2) Autopilot (equipo humano por IA normal) contra cada dificultad
 *   3) Fuzz con entrada humana aleatoria
 *   4) Bots "humanos" que juegan SOLO con la entrada real (mover/golpear/saltar)
 *      con timing perfecto / medio / novato contra Fácil, Normal y Difícil
 *      -> % de puntos y probabilidad estimada de ganar el partido
 *   5) Reglas puntuales (4 toques, dobles, sets, red, antena, saque, bloqueo...)
 * Sale con código != 0 si hay excepciones o invariantes rotos.
 * Uso: node tools/simtest.js [minutos=20] [seed=12345] [minutosMatriz=30]
 *   La matriz (dificultades y bots) va en paralelo con worker_threads.
 *   minutosMatriz = minutos de juego por casilla (más = menos ruido; 0 = saltar matriz).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const MIN = +(process.argv[2] || 20), SEED = +(process.argv[3] || 12345), BOTMIN = +(process.argv[4] != null ? process.argv[4] : 30);

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
  'sideout', 'newSet', 'bounce', 'swing', 'landPlayer', 'newMatch', 'toss', 'miss', 'dive', 'netTouch'];
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';

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
  const t0 = Date.now();
  try {
    for (let i = 0; i < steps; i++) {
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
        if (e.type === 'match') { matches++; matchWins[e.team]++; }
        if (e.type === 'set') setsSeen++;
      }
      if (i % 60 === 0 && !checkInvariants(g, label)) break;
      if (opts.demo === false && g.finished) { // partido humano acabado: empezar otro
        const ng = S.createGame(Object.assign({}, opts, { seed: SEED + i, stats: false }));
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
const BOTS = {
  perfecto: { sigma: 0.02, react: 0.12, posErr: 0.15, block: true, jumpServe: 0.7, aim: 0.8 },
  medio: { sigma: 0.065, react: 0.22, posErr: 0.45, block: true, jumpServe: 0.4, aim: 0.5 },
  novato: { sigma: 0.12, react: 0.32, posErr: 0.8, block: false, jumpServe: 0.1, aim: 0.2 }
};
function makeBot(bp, seed) {
  const rng = S._makeRng(seed), gauss = () => (rng() + rng() + rng() + rng() - 2) * 1.732;
  const mv = [0, 0], aimv = [0, 0], out = { move: mv, hit: false, jump: false, switchPlayer: false };
  let stamp = -9, lead = 0, jlead = 0, ex = 0, ey = 0, presses = 0, useAim = false, serveWait = 0;
  const w = {};
  return (g) => {
    const p = g.ctrl, sd = 1; out.hit = out.jump = false; out.move = mv;
    if (g.mode === 'serve') {
      mv[0] = mv[1] = 0;
      if (g.server !== p) return out;
      if (g.serveState === 'ready') {
        if (g.serveT < 0.05) serveWait = 0.6 + rng() * 2;
        if (g.serveT > serveWait) { if (rng() < bp.jumpServe) out.jump = true; else out.hit = true; }
        return out;
      }
      if (stamp !== g.lastTouchT) {
        stamp = g.lastTouchT; lead = 0.02 + gauss() * bp.sigma; presses = 0;
        const a = rng() * 6.283; aimv[0] = Math.cos(a); aimv[1] = Math.sin(a); useAim = rng() < bp.aim;
      }
      S.hitWindow(g, p, w);
      if (useAim) out.move = aimv;
      if (presses < 2 && !g.swingLive && w.t <= lead) { out.hit = true; presses++; }
      return out;
    }
    if (g.mode !== 'rally') { mv[0] = mv[1] = 0; return out; }
    if (stamp !== g.lastTouchT) {
      stamp = g.lastTouchT; lead = 0.02 + gauss() * bp.sigma; jlead = gauss() * bp.sigma * 0.8; presses = 0;
      ex = gauss() * bp.posErr * 0.5; ey = gauss() * bp.posErr * 0.5;
      const a = rng() * 6.283; aimv[0] = Math.cos(a); aimv[1] = Math.sin(a); useAim = rng() < bp.aim;
    }
    const since = g.time - g.lastTouchT, job = g.jobs[0] === p;
    let tx = p.x, ty = p.y;
    const attack = job && g.touchTeam === 0 && g.touches === 2 && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5;
    if (job) {
      if (attack) { tx = g.pr3.x + 0.35 * sd; ty = g.pr3.y; } else { tx = g.pr1.x + 0.15; ty = g.pr1.y; }
      tx += ex; ty += ey;
    } else if (bp.block && g.touchTeam === 1 && g.touches === 2 && g.pr3.x < 0) { tx = 0.6; ty = g.pr3.y; }
    else if (!job) { tx = 6; ty = -g.teams[0][g.ctrl.idx ? 0 : 1].y * 0.5; }
    if (since >= bp.react && p.z === 0) {
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d > 0.08) { const f = Math.min(1, d / 0.3); mv[0] = dx / d * f; mv[1] = dy / d * f; } else { mv[0] = mv[1] = 0; }
    }
    if (job && since >= bp.react * 0.5) {
      S.hitWindow(g, p, w);
      if (attack && p.z === 0 && w.attack && w.jumpT <= jlead && Math.hypot(tx - ex - p.x, ty - ey - p.y) < 1.3) out.jump = true;
      const near = Math.hypot(g.ball.x - p.x, g.ball.y - p.y) < 2.6;
      if (near && !(attack && p.z === 0 && w.jumpT > -0.2) && presses < 2 && !g.swingLive && w.t <= lead) {
        out.hit = true; presses++;
        if (useAim) out.move = aimv;
      }
    }
    // bloqueo: salta cuando el rematador rival despega
    if (bp.block && !job && p.z === 0 && Math.abs(p.x) < 1.2 && g.touchTeam === 1 && g.touches === 2) {
      const att = g.teams[1].some(q => q.z > 0.35 && q.vz < 1.5 && Math.abs(q.x) < 4);
      if (att) out.jump = true;
    }
    return out;
  };
}
function topWhy(w) { return Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k.replace(/^(.{24}).*/, '$1') + ':' + v); }

/** Trabajo de una casilla de la matriz (se ejecuta en un worker). */
function runJob(j) {
  const opts = j.kind === 'auto' ? { demo: false, autopilot: true, difficulty: j.diff } : { demo: false, difficulty: j.diff, serveClock: true };
  const r = run(j.label, opts, j.seconds, j.kind === 'bot' ? makeBot(BOTS[j.bot], j.seed) : null, true);
  return { label: j.label, kind: j.kind, bot: j.bot, diff: j.diff, won0: r.st.won[0], points: r.st.points, med: r.med,
    hits: r.st.hits, how: r.st.how, blocks: r.st.blocks, dives: r.st.dives, misses: r.st.misses, hgrades: r.st.hgrades, why: r.st.why,
    matchWins: r.matchWins, failures };
}
function runMatrix(jobs) {
  const n = Math.max(1, Math.min(jobs.length, (os.cpus().length || 2) - 1, 4)), out = new Array(jobs.length);
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
const demo = run('CPU vs CPU (demo, Normal vs Normal)', { demo: true }, MIN * 60);
{
  const { st, ev, med } = demo;
  if (st.points < MIN * 4.5) fail('muy pocos puntos en demo: ' + st.points);
  if (st.hits.pass < 20 || st.hits.set < 10 || st.hits.spike < 5) fail('faltan pases/colocaciones/remates');
  if (st.blocks < 1) fail('ningún bloqueo en demo');
  if (med < 2.5 || med > 9) fail('mediana de rally fuera de rango: ' + med);
  if (ev.point !== st.points) fail('eventos point != puntos');
  if (MIN >= 15 && demo.matches < 1) fail('ningún partido completo en demo');
  const f = st.won[0] / st.points; if (f < 0.3 || f > 0.7) fail('reparto de puntos desequilibrado en demo ' + f.toFixed(2));
  const wf = Object.entries(st.why); const inPts = wf.filter(([k]) => /cae en/.test(k)).reduce((a, [, v]) => a + v, 0);
  if (inPts / st.points < 0.55) fail('demasiados puntos por error (no por balón dentro): ' + pct(inPts, st.points));
}

// ================= 3) Fuzz: entrada humana aleatoria =================
{
  const rng = S._makeRng(SEED ^ 0xabc), held = [0, 0];
  run('Fuzz humano aleatorio', { demo: false }, 8 * 60, (g, i) => {
    if (i % 30 === 0) { const a = rng() * Math.PI * 2, m = rng() < 0.2 ? 0 : rng(); held[0] = Math.cos(a) * m; held[1] = Math.sin(a) * m; }
    return { move: held, hit: rng() < 0.04, jump: rng() < 0.01, switchPlayer: rng() < 0.005 };
  });
}


  // ================= 2) y 4) Matriz en paralelo =================
  if (BOTMIN > 0) {
    const jobs = [];
    for (const d of ['easy', 'normal', 'hard']) jobs.push({ kind: 'auto', diff: d, seconds: BOTMIN * 60, label: 'auto ' + d, seed: SEED });
    for (const bn of Object.keys(BOTS)) for (const d of ['easy', 'normal', 'hard'])
      jobs.push({ kind: 'bot', bot: bn, diff: d, seconds: BOTMIN * 60, label: `bot ${bn} vs ${d}`, seed: SEED + bn.length * 31 + d.length });
    const t0 = Date.now(), res = await runMatrix(jobs);
    for (const r of res) if (r) failures += r.failures;
    console.log(`\n######## IA compañero (equipo 0) contra cada dificultad  [${BOTMIN} min de juego por casilla, ${((Date.now() - t0) / 1000).toFixed(1)} s en paralelo] ########`);
    const diffShare = {};
    for (const r of res.filter(r => r && r.kind === 'auto')) {
      diffShare[r.diff] = r.won0 / r.points;
      console.log(`  vs ${VB.DIFF[r.diff].name.padEnd(8)} puntos IA-compañero ${pct(r.won0, r.points)} (${r.points} pts)  rally mediana ${r.med.toFixed(2)} s  remates ${r.hits.spike} bloqueos ${r.blocks} planchas ${r.dives}  partidos ${r.matchWins.join('-')}  cómo ${JSON.stringify(r.how)}`);
    }
    if (BOTMIN >= 20 && !(diffShare.easy > diffShare.normal + 0.05 && diffShare.easy > diffShare.hard + 0.1 && diffShare.normal > diffShare.hard - 0.04)) fail('las dificultades no están ordenadas: ' + JSON.stringify(diffShare));
    console.log('\n######## Bots humanos (solo entrada de mando) contra la CPU ########');
    const botRes = {};
    for (const r of res.filter(r => r && r.kind === 'bot')) {
      const p = r.won0 / r.points, hg = r.hgrades, ht = hg.perfect + hg.good + hg.poor;
      botRes[r.bot + ':' + r.diff] = p;
      console.log(`  ${r.bot.padEnd(9)} vs ${VB.DIFF[r.diff].name.padEnd(8)} puntos ${pct(r.won0, r.points).padStart(6)} (${r.points})  P(partido)≈${(matchWinProb(p) * 100).toFixed(0).padStart(3)}%  ` +
        `toques P/B/M ${pct(hg.perfect, ht)}/${pct(hg.good, ht)}/${pct(hg.poor, ht)}  fallos ${r.misses}  rally ${r.med.toFixed(1)} s  ` +
        `partidos ${r.matchWins.join('-')}  ${JSON.stringify(topWhy(r.why))}`);
    }
    if (BOTMIN >= 20) { // objetivos de diseño (márgenes amplios: son estimaciones estadísticas)
      if (!(botRes['medio:normal'] > 0.4 && botRes['medio:normal'] < 0.6)) fail('bot medio vs Normal fuera de 40-60 % de puntos: ' + botRes['medio:normal'].toFixed(2));
      if (!(botRes['perfecto:hard'] > 0.5)) fail('bot perfecto no gana a Difícil');
      if (!(botRes['novato:easy'] > 0.4)) fail('el novato no tiene opciones ni en Fácil');
      if (!(botRes['novato:hard'] < 0.35)) fail('Difícil no exige: el novato le gana demasiados puntos');
      for (const d of ['easy', 'normal', 'hard']) if (!(botRes['perfecto:' + d] > botRes['medio:' + d] && botRes['medio:' + d] > botRes['novato:' + d])) fail('la habilidad no se nota contra ' + d);
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
{
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
  // timing: pulsar justo en el ideal da 'perfect'; muy pronto da fallo o 'poor'
  for (const [lead, want] of [[0.02, 'perfect'], [0.0, 'perfect'], [0.16, 'good|poor'], [-0.07, 'good|poor']]) {
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
  // bloquear el saque es falta
  const gk = S.createGame({ demo: false, seed: 15 }), bk = gk.teams[0][0];
  rallyAt(gk, { x: -0.3, y: 0, z: 2.8, vx: 8, vz: -0.5 }); gk.lastTeam = 1; gk.touchTeam = 1; gk.touches = 3; gk.lastKind = 'serve';
  bk.x = 0.5; bk.y = 0; bk.z = 0.9; bk.vz = 0.3; gk.blockCD = 0;
  ea = stepUntil(gk, 'point', 200).find(e => e.type === 'point');
  if (!ea || ea.reason !== 'block' || ea.team !== 1) fail('bloquear el saque no es falta'); else console.log('regla bloqueo del saque OK');
  // dificultades: alias en castellano
  if (S.createGame({ difficulty: 'Difícil', seed: 1 }).difficulty !== 'hard' || S.createGame({ difficulty: 'facil', seed: 1 }).difficulty !== 'easy') fail('alias de dificultad');
  else console.log('dificultad (alias easy/normal/hard, facil/dificil) OK');
}


  console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
  process.exit(failures ? 1 : 0);
}
if (isMainThread) main();
else parentPort.postMessage(runJob(workerData));
