#!/usr/bin/env node
/* VOLEY 3D — tools/subtest.js  (owner: sim)
 * Banquillo y cambios del 6v6 (notes/titularidad-y-cambios.md §B, §I y §T2.6). Carga js/sim.js + js/ai.js + js/ai6.js con vm (como
 * tools/fingerprint6.js) y comprueba:
 *  (1) sin banquillo: ni g.subsOn ni eventos 'sub'; mismos puntos, marcador y llamadas a g.rng que antes de existir los cambios
 *      (cifras de referencia medidas con el código del 13-nov-2026, antes de tocar la sim);
 *  (2) reglas con requestSub/canSub: 'pair', 'back', 'used', 'max' (7º cambio), 'libero', 'me', 'bench'; contadores a 0 en el set
 *      nuevo; el líbero no gasta cambios;
 *  (3) 40 semillas CPU contra CPU con banquillo e iq 1-3: todo cambio legal (validador que rehace las reglas desde los eventos), media
 *      de 1 a 10 cambios por partido, algún doble cambio (y su vuelta), sin NaN, todos los partidos acaban y side-out 56-68 %;
 *      y 16 partidos con iq 3 y sacadores buenos en el banquillo: algún sacador especialista con su vuelta;
 *  (4) Carrera: meBench → g.ctrlOut y la entrada del humano no mueve nada; enterLostSet → 'lineup' con meIn al perder un set; pullAt 3
 *      con perf forzado → 'sub' meOut; pullAt 99 → nunca; g.meR = puntos con tu atleta en pista contados desde los eventos;
 *  (5) Partido rápido: requestSub se aplica en el siguiente balón muerto; tu jugador → 'me';
 *  (6) determinismo: misma semilla → mismo registro de cambios.
 * Uso: node tools/subtest.js   (sale con código 1 si algo falla)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
function load() {
  const ctx = { console, Math, Date };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['js/sim.js', 'js/ai.js', 'js/ai6.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.VB;
}
const VB = load(), S = VB.Sim, DT = 1 / 120;
let failures = 0;
const t00 = Date.now();
function report(title, res) {
  const bad = res.filter(r => !r[1]);
  if (bad.length) failures++;
  console.log('\n' + title + (bad.length ? ' FALLA' : ' OK') + '\n  ' + res.map(r => (r[1] ? '' : '[X] ') + r[0] + ' ' + JSON.stringify(r[2])).join('\n  '));
}
function run(g, secs, onEv, stop) {
  const ev = [];
  for (let i = 0; i < secs * 120; i++) {
    S.step(g, DT, onEv && onEv.input ? onEv.input(g, i) : null); ev.length = 0; S.drainEvents(g, ev);
    for (const e of ev) { if (onEv) onEv(e, g); if (stop && stop(e, g)) return i; }
  }
  return -1;
}
/** Banquillo con atributos variados (dorsales de Sim.defaultBench: 7-11 / 13, 15-18), sacadores buenos si strongServe. */
function mkBench(t, seed, strongServe) {
  const b = S.defaultBench(t);
  b.forEach((x, i) => {
    let h = (seed * 2654435761 + i * 40503 + t * 977) >>> 0;
    for (const k in x.st) { h = (h * 1103515245 + 12345) >>> 0; x.st[k] = 38 + (h % 30); }
    if (strongServe) x.st.serve = 80 + (i % 3) * 5;
    x.name = ['Nico Serrat', 'Ari Lluch', 'Kai Morell', 'Dani Ferrer', 'Alex Roig'][i];
    x.fat = (seed * 3 + i * 11) % 25;
  });
  return b;
}

// ---------------------------------------------------------------------------------------------------------------
// (1) Sin banquillo: idéntico a antes de los cambios (referencia del 13-nov-2026, código previo, 6 min de juego por partida)
{
  const REF = [
    { o: { format: '6v6', demo: true, seed: 900, stats: true }, pts: 30, rng: 28339, h: 1047865859 },
    { o: { format: '6v6', demo: true, seed: 901 }, pts: 28, rng: 29700, h: 1097313074 },
    { o: { format: '6v6', autopilot: true, seed: 902, ctrl: 'one', ctrlRole: 'OH', present: true }, pts: 25, rng: 25178, h: 1574410926 },
    { o: { format: '6v6', seed: 903, ctrl: 'one', ctrlRole: 'MB', difficulty: 'hard' }, pts: 33, rng: 18264, h: 666264380 }
  ];
  const got = [], mal = [];
  let subs = 0, on = 0;
  for (const r of REF) {
    const g = S.createGame(r.o); let n = 0; const r0 = g.rng; g.rng = () => { n++; return r0(); };
    let pts = 0, h = 0;
    if (g.subsOn) on++;
    run(g, 6 * 60, e => { if (e.type === 'point') { pts++; h = (h * 31 + e.team * 7 + e.score[0] * 3 + e.score[1]) >>> 0; } else if (e.type === 'sub' || e.type === 'lineup') subs++; });
    got.push({ seed: r.o.seed, pts, rng: n });
    if (pts !== r.pts || n !== r.rng || h !== r.h) mal.push({ seed: r.o.seed, pts, ref: r.pts, rng: n, refRng: r.rng });
  }
  report('(1) Sin banquillo, todo como antes', [
    ['ni g.subsOn ni eventos sub/lineup', on === 0 && subs === 0, { subsOn: on, eventos: subs }],
    ['mismos puntos, marcador y llamadas a g.rng que la referencia', mal.length === 0, mal.length ? mal : got]
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// (2) Reglas (equipo 1 del Partido rápido; el 0 lleva al humano)
{
  const g = S.createGame({ format: '6v6', seed: 77, ctrl: 'one', ctrlRole: 'OH', difficulty: 'normal', bench: [S.defaultBench(0), S.defaultBench(1)], coach: [{ auto: false }, { auto: false }] });
  const L = g.lineup[1].slice(), Bn = S.benchOf(g, 1), by = r => Bn.filter(p => p.role === r);
  const st = L.find(p => p.role === 'S'), opp = L.find(p => p.role === 'OPP'), ohs = L.filter(p => p.role === 'OH');
  const mbFront = g.rot[1].find(p => p.role === 'MB' && p.front), lib = g.libero[1], libFor = g.liberoFor[1];
  const bS = by('S')[0], bO = by('OPP')[0], bOH = by('OH'), bM = by('MB')[0];
  const ap = (o, i) => { const r = S.requestSub(g, 1, o, i); if (!r) S._applySubs(g); return r; };
  const r = {};
  r.off = S.canSub(S.createGame({ format: '6v6', seed: 1 }), 1, st, bS);
  r.libFor = libFor ? S.canSub(g, 1, libFor, bM) : 'sin líbero';
  r.libSelf = S.canSub(g, 1, lib, bM);
  r.benchOut = S.canSub(g, 1, bO, bS);
  r.me = S.canSub(g, 0, g.ctrlBase, S.benchOf(g, 0).find(p => p.role === g.ctrlBase.role));
  r.a = ap(st, bS);                       // 1: S → bS
  r.pairIn = S.canSub(g, 1, opp, st);     // S solo vuelve por bS
  r.pairOut = S.canSub(g, 1, bS, bO);     // bS solo sale por S
  r.b = ap(bS, st);                       // 2: vuelve S
  r.back = S.canSub(g, 1, st, bO);        // S ya volvió
  r.used = S.canSub(g, 1, opp, bS);       // bS ya entró y salió
  r.c = [ap(opp, bO), ap(ohs[0], bOH[0]), ap(mbFront, bM), ap(ohs[1], bOH[1])]; // 3-6
  r.n = S.subsLeft(g, 1);
  r.max = S.canSub(g, 1, bO, opp);        // 7º cambio
  const info = S.subInfo(g, 1, st), info2 = S.subInfo(g, 1, bS);
  // set nuevo: contadores a 0; el líbero no gasta (cuenta sus entradas sin tocar n)
  let libEv = 0, nAtLib = [], newSet = -1;
  const g2 = S.createGame({ format: '6v6', seed: 78, autopilot: true, ctrl: 'one', difficulty: 'normal', points: 11, bench: [S.defaultBench(0), S.defaultBench(1)], coach: [{ auto: false }, { auto: false }] });
  S.requestSub(g2, 1, g2.rot[1].find(p => p.role === 'OPP'), S.benchOf(g2, 1).find(p => p.role === 'OPP')); S._applySubs(g2);
  const n0 = S.subsLeft(g2, 1);
  run(g2, 900, e => { if (e.type === 'libero') { libEv++; nAtLib.push(S.subsLeft(g2, e.team)); } }, (e, gg) => { if (e.type === 'newSet') { newSet = S.subsLeft(gg, 1) + S.subsLeft(gg, 0) * 10 + (gg.subs[1].pairs.length ? 1000 : 0); return true; } return false; });
  report('(2) Reglas de los cambios (FIVB 15.5-15.8)', [
    ['sin banquillo → off', r.off === 'off', r.off],
    ['el que está fuera por el líbero y el propio líbero → libero', r.libFor === 'libero' && r.libSelf === 'libero', [r.libFor, r.libSelf]],
    ['un suplente como «sale» → bench; tu jugador en el Partido rápido → me', r.benchOut === 'bench' && r.me === 'me', [r.benchOut, r.me]],
    ['cambio y vuelta legales', r.a === '' && r.b === '', [r.a, r.b]],
    ['titular que vuelve por otro / suplente que sale por otro → pair', r.pairIn === 'pair' && r.pairOut === 'pair', [r.pairIn, r.pairOut]],
    ['segunda salida del titular → back; suplente que ya salió → used', r.back === 'back' && r.used === 'used', [r.back, r.used]],
    ['6 cambios legales y el 7º → max', r.c.join('') === '' && r.n === 0 && r.max === 'max', { c: r.c, quedan: r.n, siete: r.max }],
    ['subInfo: titular que volvió = back, suplente usado = out sin canIn', info.state === 'back' && info2.state === 'out' && !info2.canIn, [info, info2]],
    ['contadores a 0 en el set nuevo (6 y 6, sin pares)', n0 === 5 && newSet === 66, { antes: n0, setNuevo: newSet }],
    ['el líbero no gasta cambios', libEv > 0 && nAtLib.every(v => v === 5 || v === 6), { entradas: libEv, quedan: [...new Set(nAtLib)] }]
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// (3) 40 semillas CPU contra CPU: legalidad desde los eventos, cuántos, dobles, NaN, final y side-out
/** Validador: rehace las reglas a partir de los eventos (sin mirar el estado de la sim). Devuelve null o el texto del fallo. */
function mkValidator(g) {
  const st = [null, null], onC = [new Set(), new Set()];
  function reset() { for (let t = 0; t < 2; t++) { st[t] = { n: 0, pairs: [] }; onC[t] = new Set(g.lineup[t]); } }
  reset();
  return function (e) {
    if (e.type === 'newSet' || e.type === 'newMatch') { reset(); return null; }
    if (e.type === 'lineup') { reset(); return null; }   // (la alineación nueva ya está en g.lineup)
    if (e.type !== 'sub') return null;
    const t = e.team, s = st[t], o = e.outP, i = e.inP;
    if (o.role === 'L' || i.role === 'L') return 'líbero en un cambio';
    if (!onC[t].has(o)) return 'sale alguien que no estaba en pista ' + o.num;
    if (onC[t].has(i)) return 'entra alguien que ya estaba en pista ' + i.num;
    if (s.n >= 6) return 'más de 6 cambios en el set';
    const ok = o.role === i.role || (o.role === 'OH' && i.role === 'OPP') || (o.role === 'OPP' && i.role === 'OH') ||
      ((e.why === 'double' || e.why === 'doubleBack') && ((o.role === 'S' && i.role === 'OPP') || (o.role === 'OPP' && i.role === 'S')));
    if (!ok) return 'puesto incompatible ' + o.role + '→' + i.role + ' (' + e.why + ')';
    const pb = s.pairs.find(p => p.b === o && !p.back);
    if (pb) { if (pb.a !== i) return 'un suplente sale por otro que no es su titular'; pb.back = true; }
    else {
      if (s.pairs.some(p => p.a === o && p.back)) return 'un titular sale dos veces';
      if (s.pairs.some(p => p.a === i)) return 'un titular vuelve por otro';
      if (s.pairs.some(p => p.b === i && p.back)) return 'un suplente entra dos veces';
      s.pairs.push({ a: o, b: i, back: false });
    }
    s.n++;
    if (e.n !== s.n || e.left !== 6 - s.n) return 'contador del evento ' + e.n + '/' + e.left + ' (esperado ' + s.n + ')';
    onC[t].delete(o); onC[t].add(i);
    return null;
  };
}
{
  let tot = 0, dbl = 0, dblB = 0, pts = 0, so = 0, nan = 0, ends = 0, ilegal = [], ex = null, maxN = 0;
  const why = {}, porIq = [0, 0, 0], t0 = Date.now();
  for (let s = 0; s < 40; s++) {
    const iq = 1 + s % 3;
    const g = S.createGame({ format: '6v6', demo: true, seed: 1000 + s, points: 25, bench: [mkBench(0, s), mkBench(1, s + 5)], coach: [{ auto: true, iq }, { auto: true, iq }] });
    const val = mkValidator(g); let n = 0, done = false;
    try {
      const ev = [];
      for (let i = 0; i < 60 * 60 * 120 && !done; i++) {
        S.step(g, DT, null); ev.length = 0; S.drainEvents(g, ev);
        for (const e of ev) {
          const bad = val(e); if (bad && ilegal.length < 5) ilegal.push({ seed: 1000 + s, bad });
          if (e.type === 'sub') { n++; why[e.why] = (why[e.why] || 0) + 1; if (e.why === 'double') dbl++; if (e.why === 'doubleBack') dblB++; maxN = Math.max(maxN, e.n); }
          else if (e.type === 'point') { pts++; if (e.sideout) so++; }
          else if (e.type === 'match') { ends++; done = true; }
        }
        if (i % 240 === 0) for (const p of g.players) if (!Number.isFinite(p.x + p.y + p.z + p.tired + p.perf)) nan++;
      }
    } catch (e) { ex = e && e.stack || String(e); break; }
    tot += n; porIq[iq - 1] += n;
  }
  // sacador especialista: iq 3, sacadores buenos en el banquillo, partidos ajustados (dos CPU de igual nivel), sets a 25
  let srv = 0, srvB = 0, srvBad = 0;
  for (let s = 0; s < 16; s++) {
    const g = S.createGame({ format: '6v6', autopilot: true, ctrl: 'one', seed: 3000 + s, difficulty: 'hard', points: 25, bench: [mkBench(0, s, true), mkBench(1, s + 9, true)], coach: [{ auto: true, iq: 3 }, { auto: true, iq: 3 }] });
    const val = mkValidator(g), act = [null, null];
    run(g, 60 * 60, e => {
      const bad = val(e); if (bad && ilegal.length < 5) ilegal.push({ seed: 3000 + s, bad });
      if (e.type === 'sub' && e.why === 'serve') { srv++; act[e.team] = e.inP; }
      if (e.type === 'sub' && e.why === 'serveBack') { srvB++; if (act[e.team] !== e.outP || g.serving === e.team) srvBad++; act[e.team] = null; }
    }, e => e.type === 'gameOver');
  }
  const avg = tot / 40, side = pts ? 100 * so / pts : 0;
  report('(3) CPU contra CPU con banquillo (40 semillas, iq 1-3; ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)', [
    ['sin excepciones ni NaN, los 40 partidos acaban', !ex && nan === 0 && ends === 40, { nan, acaban: ends, ex }],
    ['todo cambio legal (validador desde los eventos)', ilegal.length === 0, ilegal],
    ['media de cambios por partido entre 1 y 10', avg >= 1 && avg <= 10, { media: +avg.toFixed(2), porIq: porIq.map(v => +(v / 13.3).toFixed(1)), motivos: why, maxN }],
    ['algún doble cambio y su vuelta', dbl > 0 && dblB > 0, { dobles: dbl / 2, vueltas: dblB }],
    ['algún sacador especialista y su vuelta al perder el saque', srv > 0 && srvB > 0 && srvBad === 0, { sacadores: srv, vueltas: srvB, malas: srvBad }],
    ['side-out 56-68 %', side >= 56 && side <= 68, { sideOut: side.toFixed(1) + '%', puntos: pts }]
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// (4) Carrera: tú en el banquillo y el entrenador hacia ti
function career(seed, me, o) {
  o = o || {};
  return S.createGame(Object.assign({ format: '6v6', seed, ctrl: 'one', difficulty: o.diff || 'normal', points: o.points || 25, autopilot: !!o.auto,
    bench: [mkBench(0, seed), mkBench(1, seed + 3)], meBench: o.meSlot != null ? -1 : 1, meSlot: o.meSlot != null ? o.meSlot : -1,
    names: [['Tú', 'B', 'C', 'D', 'E', 'F'], ['G', 'H', 'I', 'J', 'K', 'L']],
    coach: [{ auto: true, iq: 2, me: Object.assign({ pullAt: 99, enterLostSet: false, enterBad: false, garbage: false, backNextSet: false }, me) }, { auto: true, iq: 2 }] }, o.extra || {}));
}
{
  // meBench: g.ctrlOut, tu atleta fuera de g.players; la entrada del humano no mueve nada (misma partida con y sin pulsar)
  const a = career(41, {}), b = career(41, {});
  const out0 = a.ctrlOut && a.players.indexOf(a.ctrl) < 0 && a.ctrl === a.ctrlBase && a.ctrl.role === 'OPP' && a.ctrl.bench;
  let k = 0;
  const spam = { move: [0, 0], hit: false, jump: false, switchPlayer: false, jset: false };
  const inp = () => { k++; spam.move[0] = Math.sin(k * 0.05); spam.move[1] = Math.cos(k * 0.07); spam.hit = k % 9 === 0; spam.jump = k % 13 === 0; spam.switchPlayer = k % 31 === 0; spam.jset = k % 17 === 0; return spam; };
  const ea = [], eb = [];
  for (let i = 0; i < 90 * 120; i++) { S.step(a, DT, inp()); S.step(b, DT, null); ea.length = eb.length = 0; S.drainEvents(a, ea); S.drainEvents(b, eb); if (ea.length !== eb.length) break; }
  const same = a.players.every((p, i) => p.x === b.players[i].x && p.y === b.players[i].y) && a.score.join() === b.score.join() && a.ball.x === b.ball.x;
  // enterLostSet: en cuanto tu equipo pierde un set, entras en la alineación del siguiente (evento lineup con meIn, sin gastar cambios)
  let lostOk = 0, lostN = 0, wonIn = 0, lineupBad = 0;
  for (let s = 0; s < 8 && lostN < 3; s++) {
    const g = career(500 + s, { enterLostSet: true }, { auto: true, diff: 'expert', points: 15 });
    let lastSet = null, lost = false;
    run(g, 40 * 60, (e, gg) => {
      if (e.type === 'set') { lastSet = e; if (e.team === 1 && gg.ctrlOut) { lost = true; lostN++; } }
      if (e.type === 'lineup' && e.team === 0 && e.meIn) {
        if (lastSet && lastSet.team === 1) lostOk++; else wonIn++;
        if (gg.subs[0].n !== 0 || gg.ctrlOut) lineupBad++;
      }
    }, e => lost && e.type === 'serveReady');
  }
  // pullAt 3 con perf forzado → te cambian (meOut); pullAt 99 → nunca
  function pulled(pullAt) {
    const g = career(61, { pullAt }, { meSlot: 3, auto: true });
    let out = null, n = 0;
    run(g, 6 * 60, (e, gg) => { if (e.type === 'sub' && e.meOut) out = out || e; if (e.type === 'point' && !gg.ctrlOut) { gg.ctrlBase.perf = -10; n++; } });
    return { out, n };
  }
  const p3 = pulled(3), p99 = pulled(99);
  // g.meR = puntos con tu atleta en pista desde los eventos (entras por partido roto / mal rendimiento / sets perdidos y te sacan con pullAt 4)
  const mr = [];
  for (let s = 0; s < 6; s++) {
    const g = career(700 + s, { enterLostSet: true, enterBad: true, garbage: true, pullAt: 4, backNextSet: s % 2 === 0 }, { auto: true, diff: s % 2 ? 'hard' : 'easy' });
    let on = !g.ctrlOut, me = 0, last = false, inN = 0, outN = 0;
    run(g, 60 * 60, e => {
      if ((e.type === 'sub' || e.type === 'lineup') && e.team === 0) { if (e.meIn) { on = true; inN++; } if (e.meOut) { on = false; outN++; } }
      if (e.type === 'point') { last = on; if (on) me++; }
      if (e.type === 'challengeResult' && e.overturned && last) me--;
    }, e => e.type === 'gameOver');
    mr.push({ meR: g.meR, ev: me, rallies: g.rallyN, inN, outN });
  }
  report('(4) Carrera: tú en el banquillo', [
    ['meBench → g.ctrlOut, tu atleta (OPP) en el banquillo y fuera de g.players', out0, { ctrlOut: a.ctrlOut, role: a.ctrl.role }],
    ['con g.ctrlOut la entrada del humano no mueve nada (90 s igual con y sin pulsar)', same, { t: a.time.toFixed(1), score: a.score }],
    ['enterLostSet: al perder un set entras en la alineación (lineup meIn), sin gastar cambios', lostOk > 0 && wonIn === 0 && lineupBad === 0, { tras_perder: lostOk, sets_perdidos: lostN, tras_ganar: wonIn, mal: lineupBad }],
    ['pullAt 3 con perf forzado → sub meOut (why meOut)', !!p3.out && p3.out.why === 'meOut' && p3.out.outP.role === 'OPP', p3.out ? { why: p3.out.why, set: p3.out.set, score: p3.out.score } : null],
    ['pullAt 99 → nunca te cambian', !p99.out && p99.n > 10, { puntos: p99.n }],
    ['g.meR = puntos con tu atleta en pista contados desde los eventos', mr.every(x => x.meR === x.ev && x.rallies > 0) && mr.some(x => x.inN > 0) && mr.some(x => x.meR > 0 && x.meR < x.rallies), mr]
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// (5) Partido rápido: requestSub en el siguiente balón muerto; tu jugador → 'me'
{
  const g = S.createGame({ format: '6v6', seed: 88, ctrl: 'one', ctrlRole: 'OH', difficulty: 'normal', autopilot: true, bench: [S.defaultBench(0), S.defaultBench(1)], coach: [{ auto: false, iq: 2 }, { auto: true, iq: 2 }] });
  run(g, 60, null, (e) => e.type === 'hit' && e.touch === 2);   // en mitad de una jugada
  const opp = g.rot[0].find(p => p.role === 'OPP'), bo = S.benchOf(g, 0).find(p => p.role === 'OPP');
  const me = S.requestSub(g, 0, g.ctrlBase, S.benchOf(g, 0).find(p => p.role === 'OH'));
  const r = S.requestSub(g, 0, opp, bo), mode0 = g.mode, still = g.rot[0].indexOf(opp) >= 0;
  let subE = null, ptT = -1, sr = -1, subT = -1;
  run(g, 60, e => { if (e.type === 'point' && ptT < 0) ptT = e.t; if (e.type === 'sub' && !subE) { subE = e; subT = e.t; } if (e.type === 'serveReady' && subE && sr < 0) sr = e.t; }, e => e.type === 'serveReady' && !!subE);
  const cancel = (() => { const g2 = S.createGame({ format: '6v6', seed: 89, ctrl: 'one', autopilot: true, bench: [S.defaultBench(0), S.defaultBench(1)], coach: [{ auto: false }, { auto: false }] });
    S.requestSub(g2, 0, g2.rot[0].find(p => p.role === 'OPP'), S.benchOf(g2, 0).find(p => p.role === 'OPP')); S.cancelSub(g2, 0); let n = 0; run(g2, 40, e => { if (e.type === 'sub') n++; }); return n; })();
  report('(5) Partido rápido: tus cambios', [
    ['tu jugador → me', me === 'me', me],
    ['pedido en mitad de la jugada: no se aplica hasta el balón muerto', r === '' && mode0 === 'rally' && still, { r, mode0 }],
    ['se aplica tras el punto, antes del saque siguiente (why human) y el saque espera SUB_HOLD', !!subE && subE.why === 'human' && subT >= ptT && sr - subT >= S.SUB_HOLD - 0.02, subE ? { why: subE.why, tras_punto: +(subT - ptT).toFixed(2), espera: +(sr - subT).toFixed(2) } : null],
    ['cancelSub anula el pedido', cancel === 0, { cambios: cancel }]
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// (6) Determinismo
{
  const log = () => {
    const g = S.createGame({ format: '6v6', demo: true, seed: 1234, points: 21, bench: [mkBench(0, 4), mkBench(1, 9)], coach: [{ auto: true, iq: 3 }, { auto: true, iq: 3 }] });
    const L = []; run(g, 25 * 60, e => { if (e.type === 'sub' || e.type === 'lineup') L.push([e.type, e.team, e.why || '', e.set, (e.score || []).join('-'), e.inP ? e.inP.num : e.ins.map(p => p.num).join('+')].join(':')); }, e => e.type === 'match');
    return L;
  };
  const a = log(), b = log();
  report('(6) Determinismo', [['misma semilla → mismo registro de cambios', a.length > 0 && a.join('|') === b.join('|'), { cambios: a.length, ej: a.slice(0, 4) }]]);
}

// ---------------------------------------------------------------------------------------------------------------
// (7) Arreglos de la revisión (13-nov-2026): puesto en el Partido rápido, challenge anulado, 'lineup' al cambiar tu estado,
// doble cambio con su vuelta y partido roto en sets a 15
{
  // el humano solo cambia en el mismo puesto u OH↔OPP → 'role'; el entrenador CPU no pasa por ahí
  const g = S.createGame({ format: '6v6', seed: 90, ctrl: 'one', ctrlRole: 'OH', difficulty: 'normal', bench: [S.defaultBench(0), S.defaultBench(1)], coach: [{ auto: false }, { auto: false }] });
  const opp = g.rot[0].find(p => p.role === 'OPP'), bMB = S.benchOf(g, 0).find(p => p.role === 'MB'), bOH = S.benchOf(g, 0).find(p => p.role === 'OH');
  const rRole = S.canSub(g, 0, opp, bMB), rOk = S.canSub(g, 0, opp, bOH), rReq = S.requestSub(g, 0, opp, bMB), rC = S._canSubC(g, 0, opp, bMB);
  // challenge anulado: el punto se vuelve a contar sin duplicar puntos en pista (Σ onR = 12 por punto)
  const ov = (() => {
    const g2 = S.createGame({ format: '6v6', demo: true, seed: 309, points: 25, bench: [S.defaultBench(0), S.defaultBench(1)], coach: [{ auto: true, iq: 3 }, { auto: true, iq: 3 }] });
    let o = 0; run(g2, 30 * 60, e => { if (e.type === 'challengeResult' && e.overturned) o++; }, e => e.type === 'gameOver');
    let sum = 0; for (const t of [0, 1]) for (const p of g2.roster[t]) sum += p.onR;
    return { anulados: o, ratio: sum / g2.rallyN };
  })();
  // tu estado cambia al empezar un set sin cambio de alineación → 'lineup' con meIn / meOut igual; los sets a 15 sin partido roto en el 1r set
  let lineupMe = 0, desync = 0, garb1 = 0, dblN = [], stuck = 0;
  for (let s = 0; s < 12; s++) {
    const gg = career(900 + s, { enterLostSet: true, enterBad: true, garbage: true, pullAt: 3, backNextSet: s % 2 === 0 }, { auto: true, diff: 'hard', points: 15, meSlot: s % 3 ? 3 : null });
    let on = !gg.ctrlOut;
    run(gg, 40 * 60, (e, g3) => {
      if ((e.type === 'sub' || e.type === 'lineup') && e.team === 0) { if (e.type === 'lineup' && (e.meIn || e.meOut)) lineupMe++; if (e.meIn) on = true; if (e.meOut) on = false; }
      if (e.type === 'serveReady' && on !== !g3.ctrlOut) desync++;
      if (e.type === 'sub' && e.meIn && g3.subs[0].pairs.some(q => q.b === e.inP && q.src === 'garbage') && (g3.sets[0] + g3.sets[1] === 0)) garb1++;
    }, e => e.type === 'gameOver');
  }
  for (let s = 0; s < 20; s++) {
    const g4 = S.createGame({ format: '6v6', demo: true, seed: 1500 + s, points: 25, bench: [mkBench(0, s), mkBench(1, s + 7)], coach: [{ auto: true, iq: 3 }, { auto: true, iq: 3 }] });
    const open = [0, 0];
    run(g4, 30 * 60, e => {
      if (e.type === 'sub' && e.why === 'double') { dblN.push(e.n); open[e.team]++; }
      if (e.type === 'sub' && e.why === 'doubleBack') open[e.team] = Math.max(0, open[e.team] - 1);
      if (e.type === 'set') { stuck += open[0] + open[1]; open[0] = open[1] = 0; }
    }, e => e.type === 'gameOver');
  }
  report('(7) Arreglos de la revisión', [
    ['Partido rápido: opuesto por central → role (también al pedirlo); OPP por OH sí; el entrenador CPU no usa role', rRole === 'role' && rReq === 'role' && rOk === '' && rC === '', { rRole, rReq, rOk, rC }],
    ['challenge anulado: Σ onR = 12 por punto (sin contar dos veces)', ov.anulados > 0 && Math.abs(ov.ratio - 12) < 1e-9, ov],
    ['tu estado y los eventos sub / lineup nunca se desincronizan', desync === 0 && lineupMe > 0, { desync, lineupMe }],
    ['sets a 15: tu entrada por partido roto nunca en el 1r set (solo en el que decide el partido)', garb1 === 0, { garb1 }],
    ['doble cambio solo con 2 cambios hechos como mucho (cabe la vuelta; sinVuelta = el set acabó antes de que tocara)', dblN.length > 0 && dblN.every(n => n <= 4), { dobles: dblN.length / 2, nMax: Math.max(0, ...dblN), sinVuelta: stuck }]
  ]);
}

console.log('\n' + (failures ? failures + ' secciones FALLAN' : 'TODO OK') + ' (' + ((Date.now() - t00) / 1000).toFixed(1) + ' s)');
process.exit(failures ? 1 : 0);
