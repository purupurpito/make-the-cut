#!/usr/bin/env node
/* MAKE THE CUT — tools/careertest.js (owner: ui_main)
 * Prueba headless del modo Carrera (js/career.js) con localStorage falso: crear carrera, calendario, simular temporadas enteras,
 * clasificación coherente, copa, ofertas, cambio de club, ascensos/descensos, guardar/cargar, partido jugado (eventos falsos →
 * estadísticas y nota) y curva de progresión de varias temporadas.
 * Uso: node tools/careertest.js [temporadas=8]   Sale con 1 si algo falla; acaba en «TODO OK».
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SEASONS = Math.max(2, +(process.argv[2] || 8));
let fails = 0;
function ok(c, msg) { if (!c) { fails++; console.log('  FALLO: ' + msg); } }
function section(t) { console.log('\n== ' + t); }

const mem = {};
const fakeLS = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const ctx = { console, Math, Date, JSON, localStorage: fakeLS }; ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/sim.js', 'js/prog.js', 'js/badges.js', 'js/career.js']) {
  if (!fs.existsSync(path.join(ROOT, f))) { console.log('(sin ' + f + ')'); continue; }
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const VB = ctx.VB, C = VB.Career;
ok(C, 'VB.Career existe');

// ------------------------------------------------------------------ crear
section('Crear carrera');
ok(!C.exists(), 'sin carrera al principio');
let c = C.create({ name: 'Ferran Prueba', num: 14, role: 'cr', points: 15, seed: 12345 });
ok(C.exists(), 'existe tras crear');
ok(c.clubs.length === 40, '40 clubes (' + c.clubs.length + ')');
for (let L = 0; L < 5; L++) ok(C.clubsOf(c, L).length === 8, 'liga ' + L + ' con 8 clubes');
ok(C.myClub(c).lvl === 0, 'empiezas en la Liga Regional');
ok(Math.abs(C.playerOvr(c) - 35) <= 1, 'media inicial ~35 (' + C.playerOvr(c) + ')');
ok(c.player.st.set > c.player.st.spike, 'colocador-receptor: más colocación que potencia');
ok(c.player.name === 'Ferran Prueba' && c.player.num === 14, 'nombre y dorsal');
ok(c.mate.num === 2, 'el compañero lleva el 2 (' + c.mate.num + ')');
{ const keep = mem['voley3d.career']; // dos carreras de prueba y se vuelve a la de arriba
  ok(C.create({ name: 'Dos', num: 2, seed: 7 }).mate.num !== 2 && C.create({ name: 'Uno', seed: 7 }).player.num === 1, 'dorsal por defecto 1; si eliges el 2, el compañero otro');
  mem['voley3d.career'] = keep; C._reset(); c = C.get(); }
ok(c.mate && C.mateOvr(c) > 0, 'compañero del club (' + (c.mate && c.mate.name) + ', media ' + C.mateOvr(c) + ')');
ok(c.mate.roleKey === 'atk', 'compañero complementario (colocador-receptor → atacante)');
const names = new Set(c.clubs.map(k => k.name)), shorts = new Set(c.clubs.map(k => k.short));
ok(names.size === 40, 'nombres de club únicos');
ok(shorts.size === 40, 'abreviaturas únicas');
console.log('  club: ' + C.myClub(c).name + ' (' + C.myClub(c).short + ', media ' + C.clubOvr(C.myClub(c)) + '), objetivo: ' + c.objective.text);
// calendario
for (let L = 0; L < 5; L++) {
  const s = c.sched[L], pairs = {};
  ok(s.length === 14, 'liga ' + L + ': 14 jornadas');
  s.forEach((wk, w) => {
    ok(wk.length === 4, 'jornada ' + w + ' con 4 partidos');
    const seen = new Set(); wk.forEach(m => { seen.add(m[0]); seen.add(m[1]); const k = m[0] + '-' + m[1]; pairs[k] = (pairs[k] || 0) + 1; });
    ok(seen.size === 8, 'liga ' + L + ' jornada ' + w + ': cada club juega una vez');
  });
  const ids = C.clubsOf(c, L).map(k => k.id);
  let allPairs = true; ids.forEach(a => ids.forEach(b => { if (a !== b && pairs[a + '-' + b] !== 1) allPairs = false; }));
  ok(allPairs, 'liga ' + L + ': doble vuelta (cada par una vez en cada campo)');
}
const n0 = C.next(c);
ok(n0 && n0.kind === 'league' && n0.week === 0, 'próximo partido: jornada 1');
const ms = C.matchSetup(c);
ok(ms && ms.attrs && ms.attrs[0][0] && ms.attrs[1][0] && ms.attrs[1][1], 'matchSetup con atributos de los 4');
ok(ms.points === 15 && ms.ctrl === 'one' && ms.ctrlIdx === 0, 'puntos 15, control uno, n.º 0');
ok(['easy', 'normal', 'hard', 'expert'].indexOf(ms.difficulty) >= 0, 'dificultad válida (' + ms.difficulty + ')');
ok(ms.kit && typeof ms.kit.kitShirt === 'number', 'equipación del club');
ok(ms.ref && ms.ref.chal === 0, 'Liga Regional sin challenge (datos de error arbitral)');

// ------------------------------------------------------------------ guardar / cargar
section('Guardar y cargar');
const saved = mem['voley3d.career'];
ok(saved && saved.length > 1000, 'guardado en voley3d.career (' + (saved ? saved.length : 0) + ' B)');
C._reset();
const c2 = C.get();
ok(c2 && c2.seed === c.seed && c2.player.name === c.player.name && c2.clubs.length === 40, 'carga igual');
ok(JSON.stringify(c2.sched) === JSON.stringify(c.sched), 'calendario igual tras cargar');
c = c2;

// ------------------------------------------------------------------ partido jugado (eventos falsos)
section('Partido jugado: eventos → estadísticas → nota');
{
  const p = [0, 1, 2, 3].map(i => ({ id: i, team: i >> 1, idx: i & 1, num: [7, 11, 3, 9][i] }));
  const g = { career: { season: 1 }, teams: [[p[0], p[1]], [p[2], p[3]]], players: p, demo: false, autopilot: false };
  const E = [{ type: 'newMatch' }];
  // 6 remates punto tuyos con colocación del compañero, 2 aces, 1 bloqueo, 2 errores tuyos, 1 recepción perfecta
  for (let i = 0; i < 6; i++) E.push({ type: 'hit', team: 1, kind: 'serve', touch: 0, player: p[2] }, { type: 'hit', team: 0, kind: 'pass', touch: 1, player: p[0], grade: 'perfect', human: true },
    { type: 'hit', team: 0, kind: 'set', touch: 2, player: p[1], grade: 'good' }, { type: 'hit', team: 0, kind: 'spike', touch: 3, player: p[0], grade: 'perfect', human: true },
    { type: 'point', team: 0, how: 'kill', reason: 'in' });
  for (let i = 0; i < 2; i++) E.push({ type: 'hit', team: 0, kind: 'serve', touch: 0, player: p[0], grade: 'good', human: true }, { type: 'point', team: 0, how: 'ace', reason: 'in' });
  E.push({ type: 'hit', team: 1, kind: 'spike', touch: 3, player: p[3] }, { type: 'block', team: 0, player: p[0], result: 'stuff' }, { type: 'point', team: 0, how: 'block', reason: 'in' });
  E.push({ type: 'hit', team: 0, kind: 'serve', touch: 0, player: p[0], human: true, grade: 'poor' }, { type: 'point', team: 1, how: 'error', reason: 'out' });
  E.push({ type: 'hit', team: 0, kind: 'spike', touch: 3, player: p[0], human: true }, { type: 'point', team: 1, how: 'error', reason: 'net', player: p[0] });
  C.ingest(E, g);
  const m = C._M();
  ok(m && m.p[0].kills === 6, 'remates punto 6 (' + (m && m.p[0].kills) + ')');
  ok(m.p[0].aces === 2 && m.p[0].blocks === 1, 'aces 2, bloqueos 1');
  ok(m.p[0].errors === 2, 'errores 2 (' + m.p[0].errors + ')');
  ok(m.p[1].assists === 6, 'asistencias del compañero 6 (' + m.p[1].assists + ')');
  ok(m.p[0].recvP === 6, 'recepciones perfectas 6 (' + m.p[0].recvP + ')');
  const lvl0 = c.player.lvl, xp0 = c.player.xp;
  const sum = C.matchDone({ sets: [2, 0], setScores: [[15, 10], [15, 12]], win: true }, null, g);
  ok(sum && !sum.sim && sum.win, 'resumen de partido jugado');
  ok(sum.nota >= 7 && sum.nota <= 10, 'nota alta con 9 puntos (' + sum.nota + ')');
  ok(sum.xp > 0 && (c.player.lvl > lvl0 || c.player.xp > xp0), 'experiencia ganada (' + sum.xp + ' XP, nivel ' + c.player.lvl + ')');
  ok(c.week === 1, 'avanza a la jornada 2');
  ok(sum.round.length === 4, 'resultados de la jornada (4)');
  const bad = C.rating({ errors: 6 }, { win: false, sets: [0, 2] }, 40), good = C.rating({ kills: 20, aces: 3, blocks: 2, digs: 5 }, { win: true, sets: [2, 0] }, 40);
  ok(bad < 4 && good > 8, 'nota: mal partido ' + bad + ', partidazo ' + good);
  // con control «uno» tu jugador remata casi todo: un partido normal ganado (15 remates punto, 1 error) no puede ser un 10
  const norm = C.rating({ kills: 15, digs: 4, assists: 2, errors: 1 }, { win: true, sets: [2, 1] }, 34), huge = C.rating({ kills: 40, aces: 8, blocks: 6 }, { win: true, sets: [2, 0] }, 34);
  ok(norm >= 6.5 && norm <= 8.5, 'nota de un partido normal ganado: ' + norm);
  ok(huge < 10 && huge > 9, 'techo suave: un partido descomunal ' + huge);
  console.log('  nota ' + sum.nota + ', +' + sum.xp + ' XP' + (sum.lvlUp ? ', sube a nivel ' + sum.lvl : ''));
}

// ------------------------------------------------------------------ temporada entera simulada
section('Temporada entera simulada');
function playSeason() {
  let guard = 0; const s0 = c.season;
  while (c.phase !== 'off' && guard++ < 40) { const r = C.simulateNext(c); if (!r) break; }
  ok(c.phase === 'off', 'temporada ' + s0 + ' acabada (fase ' + c.phase + ')');
  return guard;
}
const lvlStart = C.myClub(c).lvl;
// antes de acabar la liga: comprobar la clasificación en la última jornada
let guard = 0;
while (c.phase === 'league' && guard++ < 20) C.simulateNext(c);
ok(c.week === 14 || c.phase !== 'league', 'liga de 14 jornadas jugada (semana ' + c.week + ')');
for (let L = 0; L < 5; L++) {
  const t = C.table(c, L);
  let pj = 0, pts = 0, sf = 0, sc = 0, g = 0, p = 0;
  t.forEach(r => { pj += r.pj; pts += r.pts; sf += r.sf; sc += r.sc; g += r.g; p += r.p; ok(r.pj === 14, 'liga ' + L + ' club ' + r.id + ' con 14 partidos (' + r.pj + ')'); });
  ok(pj === 8 * 14, 'liga ' + L + ': 112 partidos-club');
  ok(pts === 56 * 3, 'liga ' + L + ': puntos = 3 por partido (' + pts + ' de ' + 56 * 3 + ')');
  ok(sf === sc && g === p && g === 56, 'liga ' + L + ': sets y victorias cuadran');
  for (let i = 1; i < t.length; i++) ok(t[i - 1].pts >= t[i].pts, 'liga ' + L + ': ordenada por puntos');
  // cada partido: sets al mejor de 3 y tanteo de set válido
  (c.res[L] || []).forEach(wk => wk.forEach(m => {
    ok((m.s[0] === 2) !== (m.s[1] === 2) && m.s[0] + m.s[1] >= 2 && m.s[0] + m.s[1] <= 3, 'al mejor de 3');
    m.sc.forEach((x, i) => { const tg = i === 2 ? 15 : 15; const hi = Math.max(x[0], x[1]), lo = Math.min(x[0], x[1]); ok(hi >= tg && hi - lo >= 2 && (hi === tg || hi - lo === 2), 'tanteo de set válido ' + x); });
  }));
}
const tMine = C.table(c, C.myClub(c).lvl);
console.log('  ' + C.league(lvlStart).name + ': ' + tMine.map(r => C.club(c, r.id).short + ' ' + r.pts + (r.id === c.myClub ? '*' : '')).join(' · '));
playSeason();
ok(c.cup && c.cup.champion >= 0, 'copa jugada (campeón ' + (c.cup && C.club(c, c.cup.champion).short) + ')');
ok(c.review && c.history.length === 1, 'resumen de temporada e historial');
ok(Array.isArray(c.offers), 'ofertas calculadas (' + c.offers.length + ')');
ok(c.notes.length >= 14, 'notas de la temporada (' + c.notes.length + ', media ' + C.avgNota(c) + ')');
console.log('  posición ' + c.review.pos + ', objetivo ' + (c.review.objOk ? 'cumplido' : 'no cumplido') + ', entrenador ' + c.coach + ' (' + C.coachText(c.coach) + '), ofertas ' + c.offers.length);

// ------------------------------------------------------------------ ascensos / descensos
section('Ascensos y descensos');
{
  const up = C.table(c, 0).slice(0, 2).map(r => r.id), down = C.table(c, 1).slice(-2).map(r => r.id), mine = c.myClub, myLvl = C.myClub(c).lvl;
  const myUp = up.indexOf(mine) >= 0;
  ok(C.stay(), 'seguir en tu club');
  ok(c.season === 2 && c.week === 0 && c.phase === 'league', 'temporada 2 empieza');
  up.forEach(id => ok(C.club(c, id).lvl === 1, 'sube a Nacional: ' + C.club(c, id).short));
  down.forEach(id => ok(C.club(c, id).lvl === 0, 'baja a Regional: ' + C.club(c, id).short));
  for (let L = 0; L < 5; L++) ok(C.clubsOf(c, L).length === 8, 'liga ' + L + ' sigue con 8');
  ok(C.myClub(c).lvl === (myUp ? myLvl + 1 : myLvl), 'tu club sube con su clasificación');
  ok(c.sched[0].length === 14 && c.notes.length === 0 && c.player.age === 19, 'calendario nuevo, notas a 0, un año más');
}

// ------------------------------------------------------------------ ofertas y cambio de club
section('Ofertas y cambio de club');
{
  // jugador muy por encima del nivel: tiene que recibir ofertas al acabar
  C.KEYS.forEach(k => { c.player.st[k] = 70; });
  playSeason();
  ok(c.offers.length > 0, 'con media 70 hay ofertas (' + c.offers.length + ')');
  ok(c.offers.length <= 3, 'como mucho 3 ofertas');
  const myLvl = C.myClub(c).lvl;
  c.offers.forEach(o => ok(o.lvl >= myLvl && o.club !== c.myClub, 'oferta de un club igual o mejor'));
  if (c.offers.length) {
    const o = c.offers[0], oldMate = c.mate.name, oldClub = c.myClub;
    ok(C.acceptOffer(0), 'aceptar la oferta');
    ok(c.myClub === o.club && c.myClub !== oldClub, 'cambias de club (' + C.myClub(c).name + ', ' + C.league(C.myClub(c).lvl).name + ')');
    ok(c.mate.name !== oldMate || C.mateOvr(c) > 0, 'compañero nuevo');
    ok(c.season === 3 && c.phase === 'league', 'temporada 3 en el club nuevo');
    const ms2 = C.matchSetup(c);
    ok(ms2.kit.kitShirt === C.myClub(c).kit.shirt, 'equipación del club nuevo');
  }
  // ventana de mitad de temporada
  let g2 = 0; while (c.week < 7 && g2++ < 10) C.simulateNext(c);
  console.log('  mitad de temporada: ventana "' + c.window + '", ofertas ' + c.offers.length);
  if (c.window === 'mid' && c.offers.length) {
    const tgt = c.offers[0].club; ok(C.acceptOffer(0) && c.myClub === tgt && c.phase === 'league', 'fichaje a mitad de temporada');
    ok(C.next(c) && C.next(c).me.id === tgt, 'sigues el calendario del club nuevo');
  }
}

// ------------------------------------------------------------------ curva de progresión
section('Progresión de varias temporadas (todo simulado, gasta puntos en lo más barato y acepta la mejor oferta)');
{
  C.abandon();
  ok(!C.exists() && !mem['voley3d.career'], 'abandonar borra el guardado');
  c = C.create({ name: 'Curva', num: 9, role: 'atk', seed: 999 });
  const rows = [];
  for (let s = 0; s < SEASONS; s++) {
    playSeason();
    // gasta los puntos
    let spent = true; while (spent) { spent = false; const ks = C.KEYS.slice().sort((a, b) => c.player.st[a] - c.player.st[b]); for (const k of ks) if (C.bump(k)) { spent = true; break; } }
    const k = C.myClub(c);
    rows.push('T' + c.season + ' ' + C.league(k.lvl).short.padEnd(11) + ' pos ' + c.review.pos + ' media ' + C.playerOvr(c) + ' (nivel ' + c.player.lvl + ') nota ' + C.avgNota(c) + ' ofertas ' + c.offers.length);
    if (c.offers.length) C.acceptOffer(0); else C.stay();
  }
  rows.forEach(r => console.log('  ' + r));
  ok(C.playerOvr(c) > 50, 'la media sube con las temporadas (' + C.playerOvr(c) + ')');
}

// ------------------------------------------------------------------ arreglos finales del sprint
section('Dificultad, ofertas y guardados dañados');
{
  C.abandon(); c = C.create({ name: 'Arreglos', num: 9, role: 'atk', seed: 4321 });
  ok(C.clubsOf(c, 0).every(k => C.difficultyFor(k) === 'easy'), 'Liga Regional: IA Fácil en todos los clubes');
  ok(C.clubsOf(c, 1).every(k => C.difficultyFor(k) === 'normal'), 'Liga Nacional: IA Normal');
  // mitad de temporada: sin nota media >= 7 no hay ofertas
  c.notes = [{ nota: 6.4 }, { nota: 6.8 }]; ok(C._genOffers(c, true).length === 0, 'mitad de temporada con nota 6,6: sin ofertas');
  C.KEYS.forEach(k => { c.player.st[k] = 60; }); c.notes = [{ nota: 8 }, { nota: 8.2 }];
  ok(C._genOffers(c, true).length > 0, 'mitad de temporada con nota 8,1 y media 60: con ofertas');
  // fin de temporada: la media anunciada es la real tras ascensos y descensos
  c.notes = []; let gd = 0; while (c.phase !== 'off' && gd++ < 40) C.simulateNext(c);
  C.KEYS.forEach(k => { c.player.st[k] = 75; }); c.offers = C._genOffers(c, false);
  ok(c.offers.length > 0, 'con media 75 hay ofertas de fin de temporada (' + c.offers.length + ')');
  if (c.offers.length) {
    const o = c.offers[0]; C.acceptOffer(0); const k = C.myClub(c);
    ok(k.id === o.club && k.lvl === o.lvl && C.clubOvr(k) === o.ovr, 'oferta: liga y media anunciadas = reales (' + o.ovr + ' / ' + C.clubOvr(k) + ')');
    ok(Math.abs(C.mateOvr(c) - o.mate) <= 1, 'oferta: compañero anunciado ~' + o.mate + ', real ' + C.mateOvr(c));
  }
  // guardados dañados: se reparan o se guardan aparte, sin romper
  const good = JSON.stringify(c);
  const tryLoad = (mut) => { const o = JSON.parse(good); mut(o); mem['voley3d.career'] = JSON.stringify(o); C._reset(); return C.get(); };
  let r = tryLoad(o => { o.sched = null; }); ok(r === null || (r && C.next(r)), 'sin sched: ' + (r ? 'reparado, con partido' : 'descartado'));
  r = tryLoad(o => { o.sched = [[1, 2]]; }); ok(r && C.next(r) && r.sched.length === 5, 'sched roto: calendario nuevo');
  r = tryLoad(o => { delete o.res; }); ok(r && Array.isArray(r.res) && r.res.length === 5 && C.table(r, 0).length === 8, 'sin res: tablas vacías');
  r = tryLoad(o => { o.week = 99; }); ok(r && (C.next(r) || r.phase === 'off'), 'week 99: no se queda atascado (fase ' + (r && r.phase) + ')');
  r = tryLoad(o => { o.mate = null; o.coach = 'x'; o.notes = 5; }); ok(r && r.mate && r.mate.st && r.coach === 50 && Array.isArray(r.notes), 'compañero, entrenador y notas reparados');
  r = tryLoad(o => { o.myClub = 999; }); ok(r === null && C.lost() && mem['voley3d.career.bak'] && !mem['voley3d.career'], 'myClub inexistente: descartada, con copia en .bak');
  mem['voley3d.career'] = '{roto'; C._reset(); C.abandon(); C._reset();
  mem['voley3d.career'] = '{roto'; ok(C.get() === null && C.lost() && mem['voley3d.career.bak'] === '{roto', 'JSON roto: copia en .bak y aviso (lost)');
  C.create({ name: 'Nueva', seed: 1 }); ok(!C.lost(), 'crear otra carrera quita el aviso');
}

// ------------------------------------------------------------------ simulación rápida
section('quickSim');
{
  const r = C._rng(5);
  let wins = 0; for (let i = 0; i < 400; i++) { const q = C.quickSim(55, 45, r, 15); if (q.sets[0] === 2) wins++; }
  ok(wins > 260 && wins < 390, '10 de media de ventaja gana ~80 % (' + (wins / 4).toFixed(0) + ' %)');
  const q25 = C.quickSim(50, 50, r, 25); ok(q25.setScores.every((x, i) => Math.max(x[0], x[1]) >= (i === 2 ? 15 : 25)), 'sets a 25 y desempate a 15');
}

console.log(fails ? '\n' + fails + ' FALLOS' : '\nTODO OK');
process.exit(fails ? 1 : 0);
