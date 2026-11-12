#!/usr/bin/env node
/* VOLEY 3D — tools/fingerprint6.js  (owner: sim)
 * HUELLA del 2v2 para el refactor «Sim a N jugadores» (sprint 1 del 6v6, notes/diseno-6v6-carrera.md §4, riesgo 1).
 * Juega 50 semillas × 3 variantes con el código de js/sim.js + js/ai.js y guarda, por partida, la secuencia de puntos
 * (equipo, motivo, cómo, autor, marcador), el recuento de eventos, las posiciones finales EXACTAS de los 4 jugadores y el
 * balón, y el número de llamadas a g.rng desde que existe la partida. Variantes:
 *   cpu:   CPU contra CPU (demo), 150 s de juego
 *   human: humano simulado (bot de entrada real con su propio azar, no el de la sim) contra Fácil/Normal/Difícil/Experto,
 *          control 'both' u 'one' según la semilla, 150 s
 *   attrs: igual que human pero con atributos (opts.attrs) e insignias (opts.badges) en los 4 jugadores; una de cada tres
 *          semillas con autopilot (el equipo humano lo lleva la IA)
 * Uso:
 *   node tools/fingerprint6.js            compara con tools/fp-2v2.json (sale con código 1 si algo cambia)
 *   node tools/fingerprint6.js --write    regenera tools/fp-2v2.json (SOLO con el código de referencia, antes de tocar la sim)
 *   node tools/fingerprint6.js --variant mastery [--write]   E1 (sprint 5): 50 semillas × 150 s de partido humano con
 *          createGame({mastery:true}) y el bot pulsando también COLOCAR y GOLPEAR→SALTAR en el aire; compara con / escribe
 *          tools/fp-mastery.json (no la llama simtest: protege la maestría frente a cambios de otros lotes)
 * tools/simtest.js lo llama al final (sección «Huella 2v2»).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const MASTERY = process.argv.includes('--variant') && process.argv[process.argv.indexOf('--variant') + 1] === 'mastery';
const REF = path.join(__dirname, MASTERY ? 'fp-mastery.json' : 'fp-2v2.json');
const NSEEDS = 50, SECS = 150;

function load() {
  const ctx = { console, Math, Date };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['js/sim.js', 'js/ai.js', 'js/ai6.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.VB;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Bot humano sencillo y determinista (azar propio): va al punto de juego, golpea cerca del balón, salta a veces,
 *  cambia de jugador alguna vez y saca con flotante o en salto. Solo lee el estado; nunca toca g.rng. */
function makeBot(seed, mastery) {
  const r = mulberry(seed * 7919 + 13);
  let serveWait = -1, jumpCd = 0;
  return function (g, S) {
    const p = g.ctrl, b = g.ball, inp = { move: [0, 0], hit: false, jump: false, switchPlayer: false };
    if (g.mode === 'serve') {
      if (g.server !== p || g.serving !== 0) return inp;
      if (serveWait < 0) serveWait = 40 + Math.floor(r() * 200);
      if (--serveWait === 0) { if (r() < 0.4) inp.jump = true; else inp.hit = true; }
      if (g.serveState === 'toss' && b.z > 2.3 && b.vz < 0 && r() < 0.25) inp.hit = true;
      inp.move = [0, r() < 0.5 ? 0 : (r() - 0.5)];
      return inp;
    }
    serveWait = -1;
    if (g.mode !== 'rally') return inp;
    const pr = g.pr1, dx = pr.x - p.x, dy = pr.y - p.y, d = Math.hypot(dx, dy);
    const mine = S.side(0) * pr.x > 0;
    if (mine && d > 0.25) inp.move = [dx / d * Math.min(1, d), dy / d * Math.min(1, d)];
    else if (!mine) { const hx = S.side(0) * 5 - p.x, hy = -p.y * 0.5; const hd = Math.hypot(hx, hy); if (hd > 0.5) inp.move = [hx / hd * 0.7, hy / hd * 0.7]; }
    if (r() < 0.15) inp.move = [inp.move[0] + (r() - 0.5) * 0.8, inp.move[1] + (r() - 0.5) * 0.8];
    const bd = Math.hypot(b.x - p.x, b.y - p.y);
    if (bd < 1.6 && b.z < 3.2 && r() < 0.35) inp.hit = true;
    if (--jumpCd <= 0 && Math.abs(p.x) < 2.5 && bd < 2.5 && b.z > 2.3 && r() < 0.2) { inp.jump = true; jumpCd = 60; }
    if (p.z > 0.6 && bd < 2 && r() < 0.05) inp.jump = true;
    if (mastery && p.z > 0.6 && bd < 2 && r() < 0.04) inp.jset = true; // (E1: golpe colocado y finta; solo en la variante mastery)
    if (r() < 0.004) inp.switchPlayer = true;
    if (r() < 0.002) inp.hit = true;
    return inp;
  };
}

function attrsFor(seed) {
  const r = mulberry(seed * 104729 + 1), K = ['jump', 'speed', 'react', 'recv', 'dig', 'set', 'spike', 'ctl', 'block', 'serve'];
  const one = () => { const o = {}; for (const k of K) o[k] = 20 + Math.floor(r() * 79); return o; };
  return [[one(), one()], [one(), r() < 0.5 ? one() : null]];
}
function badgesFor(seed) {
  const r = mulberry(seed * 15485863 + 7);
  const IDS = ['canon', 'mira', 'rompemanos', 'seda', 'bombardero', 'flotador', 'muro', 'ancla', 'red', 'motor', 'sangrefria', 'lider'];
  const one = () => { const o = {}; for (let j = 0; j < 3; j++) o[IDS[Math.floor(r() * IDS.length)]] = 1 + Math.floor(r() * 3); return o; };
  return [[one(), one()], [one(), one()]];
}

const DIFFS = ['easy', 'normal', 'hard', 'expert'];
function optsFor(variant, seed) {
  if (variant === 'cpu') return { demo: true, seed: seed, stats: true };
  if (variant === 'mastery') return Object.assign(optsFor('human', seed), { mastery: true });
  const o = { demo: false, seed: seed, stats: true, difficulty: DIFFS[seed % 4], ctrl: seed % 3 === 0 ? 'one' : 'both', points: [11, 15, 21, 25][seed % 4] };
  if (seed % 5 === 0) o.rookie = true;
  if (variant === 'attrs') { o.attrs = attrsFor(seed); o.badges = badgesFor(seed); if (seed % 3 === 1) o.autopilot = true; }
  return o;
}

// Posiciones y tiempo: Linux (CI) y Windows redondean distinto en la cifra 13-15 (Math.sin/cos/pow de V8 por plataforma).
// Se comparan con tolerancia 1e-7; el resto (puntos, eventos, llamadas a g.rng, marcador) sigue exacto.
function near(a, b, f) {
  if (f !== 'end' && f !== 'time') return false;
  const eq = (x, y) => typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x)) :
    Array.isArray(x) && Array.isArray(y) ? x.length === y.length && x.every((v, i) => eq(v, y[i])) : x === y;
  try { return f === 'end' ? eq(JSON.parse(a), JSON.parse(b)) : eq(a, b); } catch (e) { return false; }
}
const fx = v => typeof v === 'number' ? +v.toPrecision(15) : v;
function runOne(VB, variant, seed) {
  const S = VB.Sim, C = VB.C, DT = 1 / C.SIM_HZ;
  const opts = optsFor(variant, seed);
  const g = S.createGame(opts);
  let nrng = 0; const rng0 = g.rng; g.rng = function () { nrng++; return rng0(); };
  const bot = variant === 'cpu' || opts.autopilot ? null : makeBot(seed, variant === 'mastery');
  const pts = [], evc = {}, evs = [];
  const steps = Math.round(SECS / DT);
  for (let i = 0; i < steps; i++) {
    S.step(g, DT, bot ? bot(g, S) : null);
    evs.length = 0; S.drainEvents(g, evs);
    for (const e of evs) {
      evc[e.type] = (evc[e.type] || 0) + 1;
      if (e.type === 'point') pts.push([e.team, e.reason, e.how, e.player ? e.player.id : -1, e.score ? e.score.join('-') : ''].join(':'));
      if (e.type === 'hit') evc['h:' + e.kind + ':' + e.player.id + ':' + e.grade] = (evc['h:' + e.kind + ':' + e.player.id + ':' + e.grade] || 0) + 1;
    }
    if (g.finished) break;
  }
  const end = g.players.map(p => [p.id, fx(p.x), fx(p.y), fx(p.z)]).concat([[fx(g.ball.x), fx(g.ball.y), fx(g.ball.z)]]);
  return { k: variant + ':' + seed, pts: pts.join(' '), ev: Object.keys(evc).sort().map(k => k + '=' + evc[k]).join(','),
    end: JSON.stringify(end), rng: nrng, time: fx(g.time), score: g.sets.join('-') + '/' + g.score.join('-') };
}

function runAll() {
  const VB = load(), out = [];
  for (let s = 1; s <= NSEEDS; s++) for (const v of MASTERY ? ['mastery'] : ['cpu', 'human', 'attrs']) out.push(runOne(VB, v, s));
  return out;
}

function main() {
  const t0 = Date.now(), write = process.argv.includes('--write');
  const res = runAll();
  if (write) {
    if (MASTERY) fs.writeFileSync(REF, JSON.stringify({ note: 'Huella de la maestría (E1, sprint 5; tools/fingerprint6.js --variant mastery): partido humano 2v2 con createGame({mastery:true}). Regenerar solo con un cambio intencionado de la maestría.', n: res.length, runs: res }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
    else fs.writeFileSync(REF, JSON.stringify({ note: 'Huella 2v2 (tools/fingerprint6.js). cpu/human: código ANTERIOR al refactor del sprint 1 del 6v6 (sin cambios desde entonces). attrs: regenerada el 10-nov-2026 con «atributos que se notan» y otra vez en la integración del mismo día (precisión del toque ATTR_K.err y frenada al momento; cpu/human comprobadas idénticas antes, 100 de 100). human/attrs: regenerada el 11-nov-2026 (bloqueo activo) y el 12-nov-2026 (overpass que cruza = golpe normal en el aire, no pulsación de bloqueo; cpu idéntica). No regenerar salvo cambio intencionado del 2v2.', n: res.length, runs: res }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
    console.log(MASTERY ? 'huella de la maestría escrita:' : 'huella 2v2 escrita:', res.length, 'partidas,', res.reduce((a, r) => a + r.pts.split(' ').filter(Boolean).length, 0), 'puntos,', (Date.now() - t0) + ' ms');
    return 0;
  }
  if (!fs.existsSync(REF)) { console.error('FALLO: falta ' + 'tools/' + path.basename(REF) + ' (node tools/fingerprint6.js' + (MASTERY ? ' --variant mastery' : '') + ' --write con el código de referencia)'); return 1; }
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8')).runs;
  let bad = 0;
  for (let i = 0; i < Math.max(ref.length, res.length); i++) {
    const a = ref[i], b = res[i];
    if (!a || !b) { bad++; console.error('FALLO huella: partida', i, 'falta'); continue; }
    for (const f of ['k', 'pts', 'ev', 'end', 'rng', 'time', 'score']) if (a[f] !== b[f] && !near(a[f], b[f], f)) {
      if (bad++ < 8) console.error('FALLO huella', a.k, f + ':', '\n  ref', String(a[f]).slice(0, 300), '\n  ahora', String(b[f]).slice(0, 300));
      break;
    }
  }
  const npts = res.reduce((a, r) => a + r.pts.split(' ').filter(Boolean).length, 0);
  const nrng = res.reduce((a, r) => a + r.rng, 0);
  if (bad) { console.error(MASTERY ? 'FALLO: huella de la maestría distinta en' : 'FALLO: huella 2v2 distinta en', bad, 'de', res.length, 'partidas'); return 1; }
  console.log(MASTERY ? 'huella de la maestría idéntica:' : 'huella 2v2 idéntica:', res.length, 'partidas,', npts, 'puntos,', nrng, 'llamadas a g.rng,', (Date.now() - t0) + ' ms');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main, runAll };
