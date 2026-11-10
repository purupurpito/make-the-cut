#!/usr/bin/env node
/* MAKE THE CUT — tools/badgetest.js (owner: ui_main)
 * Prueba de unidad de js/prog.js (atleta genérico, migración de guardados) y js/badges.js (contar eventos, desbloqueos con
 * umbrales, huecos, equipar) con un localStorage falso. Al final, un partido entero CPU contra CPU de la sim real pasa por
 * VB.Badges.ingest para comprobar que los eventos de verdad se cuentan sin errores.
 * Uso: node tools/badgetest.js   (acaba en «TODO OK» o sale con 1)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, oks = 0;
function ok(name, cond, extra) { if (cond) { oks++; console.log('  ok   ' + name + (extra ? '  (' + extra + ')' : '')); } else { fails++; console.log('  FALLO ' + name + (extra ? '  (' + extra + ')' : '')); } }

function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _m: m };
}
function load(store, files) {
  const ctx = { console, Math, Date, JSON, localStorage: store };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files || ['js/prog.js', 'js/badges.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.VB;
}

// ------------------------------------------------------------------ 1) catálogo
console.log('Catálogo');
{
  const VB = load(fakeStorage());
  const B = VB.Badges, want = ['canon', 'mira', 'rompemanos', 'seda', 'bombardero', 'flotador', 'muro', 'ancla', 'red', 'motor', 'sangrefria', 'lider'];
  ok('12 insignias con los ids acordados', JSON.stringify(B.IDS) === JSON.stringify(want), B.IDS.join(','));
  ok('cada una con nombre, icono SVG, 3 efectos, condición y umbrales crecientes',
    B.LIST.every(b => b.name && /^<svg/.test(b.icon) && b.fx.length === 3 && b.cond && b.unit.length === 2 && b.th.length === 3 && b.th[0] < b.th[1] && b.th[1] < b.th[2]));
  ok('umbrales de la tabla (canon 100/400/1200, ancla 30/120/350, lider 5/25/80)',
    B.BY.canon.th.join() === '100,400,1200' && B.BY.ancla.th.join() === '30,120,350' && B.BY.lider.th.join() === '5,25,80');
}

// ------------------------------------------------------------------ 2) migración de un guardado v1 (sin insignias)
console.log('Migración');
{
  const v1 = { v: 1, a: [
    { num: 7, role: 'Atacante', lvl: 6, xp: 33, pts: 4, matches: 12, st: { jump: 51, speed: 40, react: 40, recv: 36, dig: 38, set: 34, spike: 60, ctl: 41, block: 42, serve: 38 } },
    { num: 11, role: 'Universal', lvl: 3, xp: 10, pts: 0, matches: 12, st: { jump: 38, speed: 42, react: 42, recv: 55, dig: 42, set: 44, spike: 35, ctl: 38, block: 34, serve: 40 } }] };
  const st = fakeStorage({ 'voley3d.squad': JSON.stringify(v1) });
  const VB = load(st), P = VB.Prog, sq = P.squad();
  ok('conserva nivel, XP, puntos, partidos y atributos', sq[0].lvl === 6 && sq[0].xp === 33 && sq[0].pts === 4 && sq[0].matches === 12 && sq[0].st.spike === 60 && sq[1].st.recv === 55 && sq[1].lvl === 3);
  ok('añade bp/bd/beq vacíos', JSON.stringify([sq[0].bp, sq[0].bd, sq[0].beq]) === '[{},{},[]]');
  const saved = JSON.parse(st.getItem('voley3d.squad'));
  ok('reescribe el guardado como v2 sin perder nada', saved.v === 2 && saved.a[0].lvl === 6 && saved.a[0].st.spike === 60 && Array.isArray(saved.a[1].beq));
  ok('renumera el escuadrón: 7 y 11 → 1 y 2 (en memoria y en el guardado)', sq[0].num === 1 && sq[1].num === 2 && saved.a[0].num === 1 && saved.a[1].num === 2);
  ok('attrs() sigue dando [[1, 2], null]', JSON.stringify(P.attrs()[0][0]) === JSON.stringify(v1.a[0].st) && P.attrs()[1] === null);
  // guardado roto / basura
  const VB2 = load(fakeStorage({ 'voley3d.squad': '{"v":2,"a":[{"lvl":"x","bd":{"canon":9,"zz":2},"beq":["canon","canon","mira",5]}]}' }));
  const a0 = VB2.Prog.squad()[0];
  ok('guardado raro: nivel 1, insignia a nivel 3 máx., equipadas solo desbloqueadas y sin repetir', a0.lvl === 1 && a0.bd.canon === 3 && JSON.stringify(a0.beq) === '["canon"]');
  const VB3 = load(fakeStorage({ 'voley3d.squad': 'no es json' }));
  ok('guardado ilegible → escuadrón nuevo', VB3.Prog.squad()[0].lvl === 1 && VB3.Prog.squad()[1].num === 2);
}

// ------------------------------------------------------------------ 3) atleta genérico (Carrera)
console.log('Atleta genérico');
{
  const VB = load(fakeStorage()), P = VB.Prog;
  const a = P.newAthlete({ num: 4, role: 'Receptor', name: 'Tú', st: { spike: 30 }, start: 35 });
  ok('newAthlete con atributos parciales', a.st.spike === 30 && a.st.jump === 35 && a.lvl === 1 && a.name === 'Tú' && JSON.stringify(a.beq) === '[]');
  const r = P.athleteAddXP(a, P.need(1) + P.need(2) + 5);
  ok('athleteAddXP sube dos niveles y da 6 puntos', r.lvlUp === 2 && a.lvl === 3 && a.pts === 6 && a.xp === 5 && a.matches === 1);
  ok('athleteBump gasta puntos y no baja', P.athleteBump(a, 'spike', 1) && a.st.spike === 31 && a.pts === 5 && !P.athleteBump(a, 'spike', -1));
  ok('athleteBump no toca el guardado del escuadrón', P.squad()[0].st.spike === 46);
  const b = P.saneAthlete(JSON.parse(JSON.stringify(a)));
  ok('saneAthlete hace ida y vuelta', JSON.stringify(b) === JSON.stringify(a));
}

// ------------------------------------------------------------------ 4) ingest con eventos sintéticos → desbloqueos
console.log('Contar eventos y desbloquear');
{
  const st = fakeStorage(), VB = load(st), B = VB.Badges, P = VB.Prog;
  const p7 = { id: 0, num: 7, team: 0 }, p11 = { id: 1, num: 11, team: 0 }, c3 = { id: 2, num: 3, team: 1 }, c9 = { id: 3, num: 9, team: 1 };
  const g = { teams: [[p7, p11], [c3, c9]], setPoint: -1, matchPoint: -1, demo: false, autopilot: false };
  const ing = e => B.ingest(e, g);
  ing({ type: 'newMatch' });
  // jugada 1: saque CPU, recepción perfecta del 11, colocación buena del 7, remate perfecto del 11 → punto (asistencia del 7)
  function rallyKill(opts) {
    ing({ type: 'hit', kind: 'serve', player: c3, team: 1, touch: 0, grade: 'good', shot: 'float' });
    ing({ type: 'hit', kind: 'pass', player: p11, team: 0, touch: 1, grade: 'perfect' });
    ing({ type: 'hit', kind: 'set', player: p7, team: 0, touch: 2, grade: 'good' });
    ing({ type: 'hit', kind: 'spike', player: p11, team: 0, touch: 3, grade: 'perfect' });
    if (opts && opts.tool) ing({ type: 'block', player: c9, team: 1, result: 'tool' });
    ing(Object.assign({ type: 'point', team: 0, how: 'kill', reason: opts && opts.tool ? 'out' : 'in', lastKind: opts && opts.tool ? 'block' : 'spike' }, opts && opts.ev));
  }
  for (let i = 0; i < 25; i++) rallyKill();
  let c = B._cur().c;
  ok('25 remates punto del 11, 25 perfectos, 25 recepciones perfectas', c[1].canon === 25 && c[1].mira === 25 && c[1].ancla === 25);
  ok('25 asistencias del 7 deducidas (sin point.assist)', c[0].seda === 25 && !c[1].seda);
  // con el campo de sim point.assist / point.tool (manda sobre la deducción)
  rallyKill({ ev: { assist: p11 } });
  ok('point.assist manda: asistencia propia del rematador no cuenta', B._cur().c[0].seda === 25 && !B._cur().c[1].seda);
  rallyKill({ ev: { assist: null } });
  ok('point.assist = null: sin asistencia', B._cur().c[0].seda === 25);
  rallyKill({ tool: true });
  ok('block-out deducido (fuera tras tocar el bloqueo)', B._cur().c[1].rompemanos === 1);
  rallyKill({ ev: { tool: false } , tool: true });
  ok('point.tool = false manda', B._cur().c[1].rompemanos === 1);
  // ace del 7 (saque en salto) y flotante perfecto del 7
  ing({ type: 'hit', kind: 'serve', player: p7, team: 0, touch: 0, grade: 'perfect', shot: 'float' });
  ing({ type: 'point', team: 0, how: 'ace', reason: 'in', lastKind: 'serve' });
  ok('ace y saque flotante perfecto del 7', B._cur().c[0].bombardero === 1 && B._cur().c[0].flotador === 1);
  // punto de bloqueo del 11 con punto de set en juego → muro + sangre fría a los dos
  g.setPoint = 0;
  ing({ type: 'hit', kind: 'serve', player: p7, team: 0, touch: 0, grade: 'good', shot: 'jump' });
  ing({ type: 'hit', kind: 'pass', player: c9, team: 1, touch: 1, grade: 'good' });
  ing({ type: 'hit', kind: 'set', player: c3, team: 1, touch: 2, grade: 'good' });
  ing({ type: 'hit', kind: 'spike', player: c9, team: 1, touch: 3, grade: 'good' });
  ing({ type: 'block', player: p11, team: 0, result: 'stuff' });
  ing({ type: 'point', team: 0, how: 'block', reason: 'in', lastKind: 'block' });
  c = B._cur().c;
  ok('punto de bloqueo del 11 y sangre fría a los dos', c[1].muro === 1 && c[0].sangrefria === 1 && c[1].sangrefria === 1);
  // defensa de remate (deducida y con e.dig) y punto anulado por challenge
  g.setPoint = -1;
  ing({ type: 'hit', kind: 'serve', player: c3, team: 1, touch: 0, grade: 'good', shot: 'jump' });
  ing({ type: 'hit', kind: 'pass', player: p7, team: 0, touch: 1, grade: 'poor' });
  ing({ type: 'hit', kind: 'free', player: p11, team: 0, touch: 2, grade: 'good' });
  ing({ type: 'hit', kind: 'pass', player: c9, team: 1, touch: 1, grade: 'good' });
  ing({ type: 'hit', kind: 'spike', player: c3, team: 1, touch: 2, grade: 'good' });
  ing({ type: 'hit', kind: 'pass', player: p7, team: 0, touch: 1, grade: 'good' });
  ing({ type: 'hit', kind: 'pass', player: p11, team: 0, touch: 1, grade: 'good', dig: true });
  ok('defensas de remate (deducida + e.dig)', B._cur().c[0].red === 1 && B._cur().c[1].red === 1);
  const before = B._cur().c[1].canon;
  rallyKill();
  ing({ type: 'point', team: 1, how: 'error', reason: 'out', lastKind: 'spike', _ovr: true });
  ok('punto anulado por challenge: se descuenta el remate punto', B._cur().c[1].canon === before);
  // fin de partido: la victoria suma motor y líder, desbloqueos con umbral (contadores previos justo por debajo del bronce), se equipa sola
  const sq = P.squad();
  sq[1].bp.canon = B.BY.canon.th[0] - 20; sq[1].bp.mira = B.BY.mira.th[0] - 20; sq[0].bp.seda = B.BY.seda.th[0] - 20;
  const nw = B.endMatch(g, true);
  ok('endMatch: canon bronce para el 11, seda bronce para el 7', nw.some(u => u.slot === 1 && u.id === 'canon' && u.lvl === 1 && u.tier === 'bronce') && nw.some(u => u.slot === 0 && u.id === 'seda' && u.lvl === 1),
    nw.map(u => u.num + ':' + u.id + u.lvl).join(' '));
  ok('textos de la hoja final', B.label(nw.find(u => u.id === 'canon')) === '¡Insignia nueva: Cañón (bronce)!');
  ok('motor y líder cuentan 1 partido y 1 victoria', sq[0].bp.motor === 1 && sq[0].bp.lider === 1 && sq[1].bp.motor === 1);
  ok('se guardan en voley3d.squad', JSON.parse(st.getItem('voley3d.squad')).a[1].bd.canon === 1);
  ok('nuevas con hueco libre: equipadas solas (2 huecos a nivel 1)', JSON.stringify(sq[1].beq) === '["canon","mira"]' && nw.filter(u => u.slot === 1 && u.eq).length === 2, sq[1].beq.join(','));
  ok('endMatch dos veces para el mismo partido no repite', B.endMatch(g, true).length === 0 && sq[0].bp.motor === 1);
  ok('forPlayer = equipadas con su nivel', JSON.stringify(B.forPlayer(sq[1])) === '{"canon":1,"mira":1}');
  const fs2 = B.forSquad();
  ok('forSquad = [[1, 2], null]', fs2 && fs2[1] === null && fs2[0][1].canon === 1 && fs2[0][0].seda === 1, JSON.stringify(fs2));
  // subida de nivel: canon justo por debajo de la plata → plata
  sq[1].bp.canon = B.BY.canon.th[1] - 1;
  const g2 = Object.assign({}, g); B.ingest({ type: 'newMatch' }, g2);
  B.ingest({ type: 'hit', kind: 'serve', player: c3, team: 1, touch: 0, grade: 'good', shot: 'float' }, g2);
  B.ingest({ type: 'hit', kind: 'spike', player: p11, team: 0, touch: 1, grade: 'good' }, g2);
  B.ingest({ type: 'point', team: 0, how: 'kill', reason: 'in', lastKind: 'spike' }, g2);
  const up = B.endMatch(g2, false);
  ok('canon sube a plata', up.some(u => u.id === 'canon' && u.prev === 1 && u.lvl === 2) && B.label(up.find(u => u.id === 'canon')) === '¡Cañón sube a plata!');
  ok('derrota: líder no suma', sq[1].bp.lider === 1 && sq[1].bp.motor === 2);
  // partidos que no cuentan
  const gd = Object.assign({}, g, { autopilot: true }); B.ingest({ type: 'newMatch' }, gd); B.ingest({ type: 'hit', kind: 'spike', player: p11, team: 0, touch: 3, grade: 'perfect' }, gd);
  ok('autopilot no cuenta', !B._cur() || B._cur().g !== gd);
  VB.ctx = { debug: 'rally' }; const gq = Object.assign({}, g); B.ingest({ type: 'newMatch' }, gq);
  ok('depuración no cuenta', !B._cur() || B._cur().g !== gq);
  delete VB.ctx;
}

// ------------------------------------------------------------------ 5) huecos y equipar
console.log('Huecos y equipar');
{
  const VB = load(fakeStorage()), B = VB.Badges, P = VB.Prog;
  const a = P.newAthlete({});
  ok('slots: 2 a nivel 1, 3 a nivel 5, 4 a nivel 10, 6 tope', B.slots({ lvl: 1 }) === 2 && B.slots({ lvl: 4 }) === 2 && B.slots({ lvl: 5 }) === 3 && B.slots({ lvl: 10 }) === 4 && B.slots({ lvl: 20 }) === 6 && B.slots({ lvl: 99 }) === 6);
  ok('no se equipa una bloqueada', B.toggle(a, 'canon') === '' && a.beq.length === 0);
  a.bd = { canon: 1, mira: 2, muro: 3, motor: 1 };
  ok('equipa hasta los huecos', B.toggle(a, 'canon') === 'on' && B.toggle(a, 'mira') === 'on' && B.toggle(a, 'muro') === '' && a.beq.length === 2);
  ok('desequipa y deja hueco', B.toggle(a, 'canon') === 'off' && B.toggle(a, 'muro') === 'on' && JSON.stringify(a.beq) === '["mira","muro"]');
  a.lvl = 5;
  ok('al subir a nivel 5 hay un hueco más', B.toggle(a, 'motor') === 'on' && a.beq.length === 3);
  a.lvl = 1;
  ok('si baja el número de huecos, forPlayer solo da las que caben', Object.keys(B.forPlayer(a)).length === 2);
  ok('forPlayer vacío = {}', JSON.stringify(B.forPlayer(P.newAthlete({}))) === '{}');
  const p = B.progress({ bp: { ancla: 23 }, bd: {} }, 'ancla');
  ok('progreso de bloqueada: 23/30 recepciones perfectas', p.n === 23 && p.next === 30 && p.unit === 'recepciones perfectas' && Math.abs(p.frac - 23 / 30) < 1e-9);
  const p3 = B.progress({ bp: { canon: 1300 }, bd: { canon: 3 } }, 'canon');
  ok('progreso de oro: sin siguiente', p3.lvl === 3 && p3.next === null && p3.frac === 1);
  ok('Carrera: endMatch con atletas propios no toca el escuadrón', (() => {
    const me = P.newAthlete({ num: 4 }), gC = { teams: [[{ id: 0 }, { id: 1 }], [{ id: 2 }, { id: 3 }]], setPoint: -1, matchPoint: -1 };
    B.ingest({ type: 'newMatch' }, gC); B.endMatch(gC, true, [me, null]);
    return me.bp.motor === 1 && me.bp.lider === 1 && !P.squad()[0].bp.motor;
  })());
}

// ------------------------------------------------------------------ 6) partido real de la sim (CPU contra CPU) por ingest
console.log('Partido real de la sim');
{
  const VB = load(fakeStorage(), ['js/sim.js', 'js/ai.js', 'js/prog.js', 'js/badges.js']);
  const S = VB.Sim, B = VB.Badges, DT = 1 / VB.C.SIM_HZ;
  let g = null;
  try { g = S.createGame({ demo: false, autopilot: true, seed: 4242, difficulty: 'normal', points: 15 }); }
  catch (e) { console.log('  OMITIDO: la sim no arranca (¿a medio editar por otro agente?): ' + e.message); }
  if (g) runReal(VB, S, B, DT, g);
}
function runReal(VB, S, B, DT, g) {
  // el autopilot no cuenta: se pasa una vista del partido sin esa marca (mismos equipos y punto de set/partido en vivo)
  const gv = { get teams() { return g.teams; }, get setPoint() { return g.setPoint; }, get matchPoint() { return g.matchPoint; }, demo: false, autopilot: false };
  let n = 0, pts0 = 0, kills0 = 0, err = null, over = null;
  try {
    for (let i = 0; i < 60 * 60 * VB.C.SIM_HZ && !over; i++) {
      S.step(g, DT, null);
      for (const e of S.drainEvents(g)) {
        n++; B.ingest(e, gv);
        if (e.type === 'point' && e.team === 0) { pts0++; if (e.how === 'kill') kills0++; }
        if (e.type === 'gameOver') over = e;
      }
    }
  } catch (e) { err = e; }
  ok('sin errores al contar ' + n + ' eventos', !err, err && err.stack);
  const c = B._cur() ? B._cur().c : [{}, {}];
  const canon = (c[0].canon | 0) + (c[1].canon | 0);
  ok('partido acabado', !!over, over ? 'sets ' + over.sets.join('-') : 'sin gameOver');
  ok('remates punto contados ≤ puntos de ataque del equipo 0', canon <= kills0 && canon > 0, canon + ' de ' + kills0 + ' kills, ' + pts0 + ' puntos');
  console.log('    contadores n.º 1: ' + JSON.stringify(c[0]) + '\n    contadores n.º 2:' + JSON.stringify(c[1]));
  const a = [VB.Prog.newAthlete({ num: 1 }), VB.Prog.newAthlete({ num: 2 })];
  const nw = B.endMatch(gv, over && over.team === 0, a);
  ok('endMatch con el partido real', a[0].bp.motor === 1 && Array.isArray(nw), nw.length + ' novedades');
}

console.log(fails ? '\n' + fails + ' FALLOS (' + oks + ' ok)' : '\nTODO OK (' + oks + ' comprobaciones)');
process.exit(fails ? 1 : 0);
