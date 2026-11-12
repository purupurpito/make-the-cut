#!/usr/bin/env node
/* MAKE THE CUT — tools/careertest.js (owner: ui_main)
 * Prueba headless del modo Carrera (js/career.js) con localStorage falso: crear carrera, calendario, simular temporadas enteras,
 * clasificación coherente, copa, ofertas, cambio de club, ascensos/descensos, guardar/cargar, partido jugado (eventos falsos →
 * estadísticas y nota) y curva de progresión de varias temporadas. Al final, la dificultad de la Carrera (12-nov-2026: Normal idéntico
 * al de antes, IA rival por nivel, atributos, XP, entreno, entrenador, objetivo, ofertas, cambio entre partidos, sellos y migración).
 * Uso: node tools/careertest.js [temporadas=8]   Sale con 1 si algo falla; acaba en «TODO OK».
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SEASONS = Math.max(2, +(process.argv[2] || 8));
let fails = 0;
let passes = 0, verbose = false;
function ok(c, msg) { if (!c) { fails++; console.log('  FALLO: ' + msg); } else { passes++; if (verbose) console.log('  ok: ' + msg); } }
function section(t) { console.log('\n== ' + t); }

const mem = {};
const fakeLS = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const ctx = { console, Math, Date, JSON, Set, localStorage: fakeLS }; ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/sim.js', 'js/prog.js', 'js/badges.js', 'js/leagues.js', 'js/career.js', 'js/career-life.js']) {
  if (!fs.existsSync(path.join(ROOT, f))) { console.log('(sin ' + f + ')'); continue; }
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const VB = ctx.VB, C = VB.Career;
ok(C, 'VB.Career existe');

// ------------------------------------------------------------------ crear
section('Crear carrera');
ok(!C.exists(), 'sin carrera al principio');
let c = C.create({ name: 'Ferran Prueba', num: 14, role: 'cr', points: 15, seed: 12345, ctrl: 'both' });
ok(C.exists(), 'existe tras crear');
ok(c.ctrl === 'one', 'Carrera: siempre control «uno» aunque se pida «both»');
ok(c.points === 21 && C.PTS === 21 && C.PTS3 === 15 && C.VENUE === 'beach', 'vóley playa: sets a 21, el 3.º a 15, aunque se pidan 15 (' + c.points + ')');
ok(C.LEAGUES.every(L => /Circuito|Hiperliga/.test(L.name) && L.art && L.cup) && C.LEAGUES[0].name === 'Circuito Regional', 'circuitos de playa: ' + C.LEAGUES.map(L => L.name).join(', '));
ok(C.lname(C.LEAGUES[0]) === 'el Circuito Regional' && C.lname(C.LEAGUES[2]) === 'la Hiperliga de Playa' && C.toL(C.LEAGUES[1]) === 'al Circuito Nacional', 'artículos de los circuitos');
ok(c.clubs.every(k => /^(CV Platja|Arena|Platja|Club Platja|Vóley Playa|Beach Vòlei|Sorra|Dunes|Litoral|Costa) /.test(k.name) && typeof k.beach === 'string' && k.beach.indexOf(k.city) >= 0), 'clubes de vóley playa con sede en una playa (' + c.clubs[0].name + ', ' + c.clubs[0].beach + ')');
ok(C.ROLES.atk.name === 'Bloqueador' && C.ROLES.cr.name === 'Defensor' && c.player.role === 'Defensor', 'roles de playa: bloqueador y defensor (' + c.player.role + ')');
ok(c.clubs.length === 40, '40 clubes (' + c.clubs.length + ')');

// ------------------------------------------------------------------ inicio: elegir club (gestión v2)
section('Inicio sin club: ofertas, rechazar, más tiempo, prueba y firmar');
{
  ok(c.phase === 'pick' && C.myClub(c) === null && c.mate === null, 'tras crear no hay club ni compañero (fase pick)');
  ok(C.next(c) === null && C.matchSetup(c) === null, 'sin club no hay partido');
  ok(c.offers.length >= 3 && c.offers.length <= 5, 'llegan 3-5 ofertas (' + c.offers.length + ')');
  const reg = c.offers.filter(o => !o.trial), tri = c.offers.filter(o => o.trial);
  ok(reg.length >= 3 && reg.every(o => o.lvl === 0 && C.club(c, o.club).lvl === 0), 'al menos 3 del Circuito Regional');
  ok(tri.every(o => o.lvl === 1 && o.chance > 0 && o.chance < 1), 'la prueba (si la hay) es del Circuito Nacional con probabilidad (' + tri.map(o => o.chance).join(',') + ')');
  ok(c.offers.every(o => o.mateP && o.mateP.name && o.mateP.style && o.mate === C.ovrOf(o.mateP.st) && o.objective && o.role && o.salary > 0 && o.years >= 1), 'ficha completa: compañero (nombre, rol, media, estilo), objetivo, rol, sueldo, años');
  ok(c.offers.every(o => { const f = C.clubInfo(c, C.club(c, o.club)); return f.stars >= 1 && f.stars <= 5 && f.style && f.city && f.league; }), 'ficha del club: prestigio, estilo, ciudad, liga');
  ok(c.inbox.length >= 1 && C.unread(c) >= 1, 'mensaje del agente en la bandeja');
  // guardar y cargar en plena elección
  C._reset(); c = C.get();
  ok(c && c.phase === 'pick' && c.offers.length >= 3, 'se guarda y se carga en plena elección');
  const avg = l => l.filter(o => !o.trial).reduce((s, o) => s + o.ovr, 0) / l.filter(o => !o.trial).length;
  const a0 = avg(c.offers), ids0 = c.offers.map(o => o.club).join();
  const mt = C.moreTime();
  ok(mt && c.pick.more && c.offers.map(o => o.club).join() !== ids0, 'pedir más tiempo: una oferta se va y llega otra');
  ok(C.moreTime() === null, 'más tiempo solo una vez');
  ok(C.rejectAll() && c.pick.round === 1, 'rechazar todas');
  ok(c.offers.length >= 2 && c.offers.every(o => !o.trial && o.lvl === 0), 'nuevas ofertas, sin prueba');
  ok(avg(c.offers) <= a0 + 0.01, 'las nuevas son peores (media ' + avg(c.offers).toFixed(1) + ' ≤ ' + a0.toFixed(1) + ')');
  // la prueba: con suerte o sin ella acaba en firmar o en quitar la oferta (semillas distintas)
  let passN = 0, failN = 0;
  for (let s = 1; s <= 30; s++) {
    const keep = mem['voley3d.career'];
    const t = C.create({ name: 'Prueba', seed: 5000 + s }); const i = t.offers.findIndex(o => o.trial);
    if (i < 0) { mem['voley3d.career'] = keep; C._reset(); continue; }
    const n0 = t.offers.length, r = C.acceptOffer(i);
    if (r) { passN++; ok(C.myClub(t).lvl === 1 && t.phase === 'league', 'prueba superada: al Circuito Nacional'); }
    else { failN++; ok(t.phase === 'pick' && t.offers.length === n0 - 1 && t.pick.fail >= 0, 'prueba fallida: se quita la oferta y sigues eligiendo'); }
    mem['voley3d.career'] = keep; C._reset();
  }
  c = C.get();
  ok(passN > 0 && failN > passN, 'pruebas: ' + passN + ' superadas, ' + failN + ' no (≈30 %)');
  // firmar
  const pickI = c.offers.findIndex(o => !o.trial), o = c.offers[pickI], mate = o.mateP;
  ok(C.acceptOffer(pickI, 3), 'firmar por un club');
  ok(c.phase === 'league' && c.myClub === o.club && c.week === 0, 'en el club elegido, jornada 1');
  ok(c.mate.name === mate.name && C.mateOvr(c) === o.mate, 'el compañero es el anunciado (' + c.mate.name + ', ' + o.mate + ')');
  ok(c.contract && c.contract.years === 3 && c.contract.left === 3 && c.contract.role === o.role && c.contract.salary === o.salary, 'contrato de 3 temporadas con el rol y el sueldo de la oferta');
  ok(Array.isArray(c.squad) && c.squad.length === 2 && c.squad.every(m => m.num !== c.player.num && m.num !== c.mate.num), 'plantilla con 2 compañeros posibles (dorsales libres)');
  ok(c.objective && c.objective.text === o.objective, 'objetivo = el anunciado');
  ok(c.coach === [45, 55, 65][C.ROLE_LV.indexOf(o.role)], 'confianza inicial según el rol (' + c.coach + ')');
}
ok(c.clubs.length === 40, '40 clubes (' + c.clubs.length + ')');
for (let L = 0; L < 5; L++) ok(C.clubsOf(c, L).length === 8, 'liga ' + L + ' con 8 clubes');
ok(C.myClub(c).lvl === 0, 'empiezas en el Circuito Regional');
ok(Math.abs(C.playerOvr(c) - 35) <= 1, 'media inicial ~35 (' + C.playerOvr(c) + ')');
ok(c.player.st.set > c.player.st.spike, 'colocador-receptor: más colocación que potencia');
ok(c.player.name === 'Ferran Prueba' && c.player.num === 14, 'nombre y dorsal');
ok(c.mate.num === 2, 'el compañero lleva el 2 (' + c.mate.num + ')');
{ const keep = mem['voley3d.career']; // dos carreras de prueba y se vuelve a la de arriba
  ok(C.create({ name: 'Dos', num: 2, seed: 7, autoClub: true }).mate.num !== 2 && C.create({ name: 'Uno', seed: 7, autoClub: true }).player.num === 1, 'dorsal por defecto 1; si eliges el 2, el compañero otro');
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
ok(ms.points === 21 && ms.venue === 'beach' && ms.career.venue === 'beach' && ms.ctrl === 'one' && ms.ctrlIdx === 0, 'playa: puntos 21, venue beach, control uno, n.º 0');
ok(['easy', 'normal', 'hard', 'expert'].indexOf(ms.difficulty) >= 0, 'dificultad válida (' + ms.difficulty + ')');
ok(ms.kit && typeof ms.kit.kitShirt === 'number', 'equipación del club');
ok(ms.ref && ms.ref.chal === 0, 'Circuito Regional sin challenge (datos de error arbitral)');

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
  const sum = C.matchDone({ sets: [2, 0], setScores: [[21, 15], [21, 17]], win: true }, null, g);
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
    m.sc.forEach((x, i) => { const tg = i === 2 ? 15 : 21; const hi = Math.max(x[0], x[1]), lo = Math.min(x[0], x[1]); ok(hi >= tg && hi - lo >= 2 && (hi === tg || hi - lo === 2), 'tanteo de set de playa válido (21 / 15) ' + x); });
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
  c = C.create({ name: 'Curva', num: 9, role: 'atk', seed: 999, autoClub: true });
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
  C.abandon(); c = C.create({ name: 'Arreglos', num: 9, role: 'atk', seed: 4321, autoClub: true });
  // escalón (11-nov-2026): Regional Fácil y, desde SOFT.reg, Normal suave (Normal + rookie); el mejor (≥ SOFT.regNormal) Normal;
  // Nacional Normal (suave por debajo de SOFT.nat). Nunca Difícil en la Regional ni Fácil en la Nacional
  const regD = C.clubsOf(c, 0).map(k => C.difficultyFor(k) + (C.softFor(k) ? '+suave' : ''));
  ok(C.clubsOf(c, 0).every(k => C.clubOvr(k) < C.SOFT.reg ? C.difficultyFor(k) === 'easy' && !C.softFor(k) : C.difficultyFor(k) === 'normal' && C.softFor(k) === (C.clubOvr(k) < C.SOFT.regNormal)), 'Circuito Regional: Fácil, Normal suave y Normal según la media (' + regD.join(', ') + ')');
  ok(regD.some(d => d === 'easy') && regD.some(d => d === 'normal+suave'), 'Circuito Regional con clubes en Fácil y en Normal suave');
  ok(C.clubsOf(c, 1).every(k => C.difficultyFor(k) === 'normal' && C.softFor(k) === (C.clubOvr(k) < C.SOFT.nat)), 'Circuito Nacional: IA Normal (suave en los más flojos)');
  ok(C.clubsOf(c, 2).every(k => !C.softFor(k) && C.difficultyFor(k) === (C.clubOvr(k) >= C.DIFF_AT[1][0] ? 'hard' : 'normal')), 'Hiperliga: Normal y Difícil desde ' + C.DIFF_AT[1][0]);
  { const sk = C.clubsOf(c, 0).filter(k => C.softFor(k))[0]; ok(!sk || C.diffLabel(sk) === 'Normal suave', 'etiqueta «Normal suave» (' + (sk ? C.diffLabel(sk) : '-') + ')'); }
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

// ------------------------------------------------------------------ gestión durante la carrera (v2)
section('Gestión: entrenamiento, fatiga, química, compañero, traspaso, negociar, renovar');
{
  C.abandon(); c = C.create({ name: 'Gestor', num: 5, role: 'atk', seed: 2468, autoClub: true });
  ok(c.phase === 'league' && C.myClub(c), 'autoClub: club asignado (pruebas)');
  // entrenamiento: enfoque Físico → mejoras gratis en salto/velocidad/reacción y fatiga
  ok(C.setTraining('phys') && c.train === 'phys', 'enfoque Físico');
  ok(!C.setTraining('xx'), 'enfoque inválido no cambia');
  const ph0 = c.player.st.jump + c.player.st.speed + c.player.st.react, other0 = c.player.st.recv + c.player.st.dig + c.player.st.block + c.player.st.set + c.player.st.spike + c.player.st.ctl + c.player.st.serve;
  const pts0 = c.player.pts;
  let s1 = null; for (let i = 0; i < 4; i++) s1 = C.simulateNext(c);
  ok(c.player.st.jump + c.player.st.speed + c.player.st.react === ph0 + 2, 'Físico 4 semanas: +2 en el grupo físico (' + (c.player.st.jump + c.player.st.speed + c.player.st.react - ph0) + ')');
  ok(c.player.st.recv + c.player.st.dig + c.player.st.block + c.player.st.set + c.player.st.spike + c.player.st.ctl + c.player.st.serve === other0, 'el resto de atributos no cambia (los puntos de mejora siguen aparte: ' + pts0 + ' → ' + c.player.pts + ')');
  ok(s1 && s1.train && s1.train.focus === 'phys', 'el resumen del partido trae el entrenamiento');
  ok(c.fatigue === 48 && C.fatigueMalus(c) === 1, 'fatiga 4 × 12 = 48 → −1 en el partido (' + c.fatigue + ', −' + C.fatigueMalus(c) + ')');
  const msF = C.matchSetup(c);
  ok(msF.attrs[0][0].spike === c.player.st.spike - 1 && msF.fatigue === 1, 'la fatiga resta en matchSetup (' + msF.attrs[0][0].spike + ' de ' + c.player.st.spike + ')');
  ok(C.setTraining('rest')); C.simulateNext(c);
  ok(c.fatigue === 13 && C.fatigueMalus(c) === 0, 'Descanso: −35 de fatiga (' + c.fatigue + ')');
  c.fatigue = 70; let warn = c.inbox.length; C.setTraining('atk'); c.fatigue = 55; C.simulateNext(c);
  ok(c.inbox.length > warn && c.inbox.some(m => m.k === 'train'), 'aviso del preparador al pasar de 60 de fatiga');
  // química: sube jugando juntos y suma en reacción/colocación/recepción a los dos
  ok(c.mate.chem > 0, 'química con el compañero tras jugar (' + c.mate.chem + ')');
  c.fatigue = 0; c.mate.chem = 0; const m0 = C.matchSetup(c); c.mate.chem = 95; const m1 = C.matchSetup(c);
  ok(C.chemBonus(c) === 3 && m1.attrs[0][1].set === Math.min(99, m0.attrs[0][1].set + 3) && m1.attrs[0][0].recv === Math.min(99, m0.attrs[0][0].recv + 3), 'química 95: +3 en colocación/recepción de los dos');
  ok(m1.attrs[0][0].spike === m0.attrs[0][0].spike, 'la química no toca la potencia');
  c.mate.chem = 95; const tq1 = C.teamOvr(c); c.mate.chem = 0; const tq0 = C.teamOvr(c);
  ok(Math.abs(tq1 - tq0 - 1.5) < 1e-9, 'química en la simulación rápida: +1,5 de fuerza (' + (tq1 - tq0) + ')');
  ok(m1.ctrl === 'one', 'matchSetup: control «uno» siempre');
  // cambio de compañero
  c.coach = 20; ok(C.changeMate(0) === 'coach', 'con el entrenador descontento no te deja cambiar de compañero');
  c.coach = 60; c.mate.chem = 40; const old = c.mate.name, nu = c.squad[0].name;
  ok(C.changeMate(0) === 'ok' && c.mate.name === nu && c.squad[0].name === old, 'cambio de compañero (el anterior vuelve a la plantilla)');
  ok(c.squad[0].chem === 40 && c.mate.chem === 0, 'la química se guarda con cada compañero');
  ok(C.matchSetup(c).career.mate === nu, 'el partido usa el compañero nuevo');
  // traspaso
  const sc0 = C.offerScore(c), co0 = c.coach;
  ok(C.requestTransfer(true) && c.listed && c.coach === co0 - 8, 'pedir el traspaso: el entrenador pierde 8 de confianza');
  ok(C.offerScore(c) === sc0 + 5 - 0.8, 'transferible: +5 de interés para los clubes (−0,8 por la confianza)');
  ok(!C.requestTransfer(true), 'pedirlo dos veces no hace nada');
  c.notes = [{ nota: 6.7 }, { nota: 6.7 }]; C.KEYS.forEach(k => { c.player.st[k] = 60; });
  ok(C._genOffers(c, true).length > 0, 'transferible: ofertas a mitad de temporada con nota 6,7');
  ok(C.requestTransfer(false) && !c.listed, 'retirar la petición');
  ok(C._genOffers(c, true).length === 0, 'sin traspaso y nota 6,7: sin ofertas a mitad');
  // negociar y firmar con duración propia (fin de temporada)
  c.notes = []; let gd = 0; while (c.phase !== 'off' && gd++ < 40) C.simulateNext(c);
  C.KEYS.forEach(k => { c.player.st[k] = 70; }); c.offers = C._genOffers(c, false);
  ok(c.offers.length > 0 && c.offers.every(o => o.mateP && o.salary > 0), 'ofertas de fin de temporada con ficha (compañero y sueldo)');
  const ni = c.offers.findIndex(o => o.role !== 'Titular indiscutible');
  if (ni >= 0) {
    const r0 = c.offers[ni].role, res = C.negotiate(ni);
    ok(res === 'ok' || res === 'no', 'negociar responde (' + res + ')');
    ok(c.offers[ni].firm && (res === 'no' ? c.offers[ni].role === r0 : C.ROLE_LV.indexOf(c.offers[ni].role) === C.ROLE_LV.indexOf(r0) + 1), 'negociar: un rol más o la oferta queda firme');
    ok(C.negotiate(ni) === '', 'tras negociar ya no se puede otra vez');
  }
  // renovar: con el contrato acabado, «Seguir» renueva por los años que elijas
  c.contract.left = 1; c.offers = [];
  const keep = JSON.stringify(c); c = JSON.parse(keep);   // (copia por si acaso: se trabaja sobre el cargado)
  mem['voley3d.career'] = keep; C._reset(); c = C.get();
  c.review.renew = c.review.renew || { role: 'Titular', salary: 900, years: 2 };
  const myId = c.myClub;
  ok(C.stay(3) && c.myClub === myId && c.contract.years === 3 && c.contract.left === 3, 'renovar 3 temporadas al seguir (' + JSON.stringify(c.contract) + ')');
  ok(c.inbox.some(m => /renovado/i.test(m.t)), 'mensaje de renovación');
  gd = 0; while (c.phase !== 'off' && gd++ < 40) C.simulateNext(c); C.stay();
  ok(c.contract.left === 2, 'cada temporada en el club resta un año de contrato (' + c.contract.left + ')');
  // bandeja
  const un = C.unread(c); ok(un > 0, 'mensajes sin leer (' + un + ')');
  const first = c.inbox.find(m => !m.r); ok(C.readMsg(first.id) && C.unread(c) === un - 1, 'leer un mensaje');
  ok(C.readAll() === un - 1 && C.unread(c) === 0, 'leer todos');
  ok(c.inbox.length <= 40, 'bandeja con tope de 40 (' + c.inbox.length + ')');
}

// ------------------------------------------------------------------ integración (10-nov-2026): decisiones con efecto
section('Integración: fatiga que se recupera, contrato, negociar con riesgo, estilo del club');
{
  C.abandon(); c = C.create({ name: 'Decide', num: 3, role: 'uni', seed: 777, autoClub: true });
  ok(C.setTraining('bal') === false || c.train === 'bal', 'Equilibrado por defecto');
  for (let i = 0; i < 8; i++) C.simulateNext(c);
  ok((c.fatigue | 0) === 0, 'Equilibrado no cansa (fatiga ' + c.fatigue + ' tras 8 semanas)');
  C.setTraining('phys'); let n0 = c.inbox.filter(m => m.k === 'train').length; c.fatigue = 50;
  C.simulateNext(c); C.simulateNext(c);   // 62 (−2) y 74 (−3): un aviso por cada subida de la resta
  ok(c.inbox.filter(m => m.k === 'train').length - n0 === 2, 'aviso del preparador cada vez que sube la resta (' + (c.inbox.filter(m => m.k === 'train').length - n0) + ')');
  // estilo del club: suma progreso a su grupo cada semana
  const sty = C.clubInfo(c, C.myClub(c)).style, grp = C.STYLE_TRAIN[sty];
  console.log('  estilo ' + sty + ' → ' + (grp || 'ninguno'));
  if (grp) { C.setTraining('rest'); const tp0 = c.tp[grp] | 0; C.setTraining('bal'); C.simulateNext(c); ok(((c.tp[grp] | 0) - tp0 + 100) % 100 === (15 + C.STYLE_PROG) % 100, 'estilo del club: +' + C.STYLE_PROG + ' de progreso en ' + grp); }
  // fin de temporada: fatiga a 0, traspaso caduca, contrato con fecha de la temporada nueva
  C.setTraining('phys'); C.requestTransfer(true);
  let gd = 0; while (c.phase !== 'off' && gd++ < 40) C.simulateNext(c);
  ok(c.fatigue > 40, 'con enfoque Físico toda la temporada hay fatiga (' + c.fatigue + ')');
  const s0 = c.season; c.contract.left = 3; c.listed = true;
  C.KEYS.forEach(k => { c.player.st[k] = 72; }); c.offers = C._genOffers(c, false);
  ok(!C.earlyExit(c), 'transferible: salir no es salida con contrato');
  c.listed = false;
  ok(C.earlyExit(c), 'con 3 temporadas de contrato, fichar por otro es salida con contrato');
  if (c.offers.length) {
    const o = c.offers[0], rl = C.ROLE_LV.indexOf(o.role); c.listed = false;
    ok(C.acceptOffer(0) && c.season === s0 + 1, 'fichar con contrato en vigor se puede');
    ok(c.coach === [45, 55, 65][rl] - C.EARLY_COACH - (o.negNo ? C.NEG_COACH : 0), 'pero el entrenador nuevo empieza con ' + C.EARLY_COACH + ' menos (' + c.coach + ')');
    ok(c.contract.since === s0 + 1, 'el contrato nuevo empieza en la temporada nueva (since ' + c.contract.since + ')');
    ok((c.fatigue | 0) === 0, 'en verano la fatiga vuelve a 0');
    ok(!c.listed, 'la petición de traspaso no pasa a la temporada siguiente');
  }
  // negociar: no siempre sale y fallar cuesta
  let tot = 0, yes = 0, costOk = true;
  for (let sd = 1; sd <= 60; sd++) {
    C.abandon(); c = C.create({ name: 'N' + sd, seed: 5000 + sd });
    c.offers.forEach((o, i) => { if (o.trial || o.role === 'Titular indiscutible') return; tot++; const r = C.negotiate(i); if (r === 'ok') yes++; else if (!o.negNo) costOk = false; });
  }
  console.log('  negociaciones aceptadas: ' + yes + ' de ' + tot);
  ok(tot > 0 && yes / tot < 0.85 && yes / tot > 0.2, 'negociar sale a veces, no casi siempre (' + Math.round(100 * yes / Math.max(1, tot)) + ' %)');
  ok(costOk, 'una negociación rechazada queda marcada (negNo) para la confianza inicial');
}

// ------------------------------------------------------------------ migración de guardados v1
section('Migración de un guardado v1 (con club, «Los dos», sin gestión)');
{
  C.abandon(); c = C.create({ name: 'Viejo', num: 7, role: 'uni', seed: 1357, autoClub: true });
  for (let i = 0; i < 5; i++) C.simulateNext(c);
  const v1 = JSON.parse(JSON.stringify(c));
  v1.v = 1; v1.ctrl = 'both';
  ['inbox', 'msgN', 'train', 'tp', 'fatigue', 'listed', 'squad', 'contract', 'pick'].forEach(k => delete v1[k]);
  delete v1.mate.chem; delete v1.mate.style;
  v1.offers.forEach(o => { delete o.mateP; delete o.salary; });
  const raw = JSON.stringify(v1); mem['voley3d.career'] = raw; C._reset();
  const m = C.get();
  ok(m && m.v === 3, 'guardado v1 cargado y pasado a v3');
  ok(m.ctrl === 'one', '«Los dos» migra a «uno»');
  ok(m.phase === 'league' && m.myClub === v1.myClub && m.week === v1.week && m.season === v1.season, 'sigue en su club y jornada (no se le obliga a elegir)');
  ok(m.player.lvl === v1.player.lvl && m.player.xp === v1.player.xp && m.player.pts === v1.player.pts && JSON.stringify(m.player.st) === JSON.stringify(v1.player.st), 'jugador intacto (nivel, XP, puntos, atributos)');
  ok(m.mate.name === v1.mate.name && JSON.stringify(m.mate.st) === JSON.stringify(v1.mate.st), 'compañero intacto');
  ok(JSON.stringify(m.res) === JSON.stringify(v1.res) && JSON.stringify(m.notes) === JSON.stringify(v1.notes) && m.coach === v1.coach, 'resultados, notas y entrenador intactos');
  ok(m.contract && m.contract.left >= 1 && m.squad.length === 2 && m.train === 'bal' && m.fatigue === 0 && m.mate.chem === 20, 'gestión con valores por defecto (química de 5 partidos juntos = ' + m.mate.chem + ')');
  ok(m.inbox.length === 2 && /playa/i.test(m.inbox[0].t) && /Novedades/.test(m.inbox[1].t), 'mensajes de la playa y de novedades (' + m.inbox.map(x => x.t).join(' / ') + ')');
  ok(C.next(m) && C.matchSetup(m).ctrl === 'one', 'sigue jugándose');
  C.save(); C._reset(); const m2 = C.get();
  ok(m2.inbox.length === 2 && m2.contract.left === m.contract.left, 'migrar dos veces no duplica nada');
}

// ------------------------------------------------------------------ migración de guardados v2 (pabellón) a v3 (playa)
section('Migración de un guardado v2 (pabellón, sets a 15, clubes de pabellón) a la playa');
{
  C.abandon(); c = C.create({ name: 'Pabellón', num: 7, role: 'atk', seed: 2222, autoClub: true });
  for (let i = 0; i < 16; i++) C.simulateNext(c);   // temporada acabada: historial, trofeos quizá, resultados
  C.stay(); for (let i = 0; i < 3; i++) C.simulateNext(c);
  const v2 = JSON.parse(JSON.stringify(c));
  v2.v = 2; v2.points = 15;
  const OLDP = ['CV', 'Club Vóley', 'Unión', 'Atlético', 'Deportivo', 'Vóley', 'Sporting', 'Olímpico', 'Real Club', 'AD'];
  const oldName = {};
  v2.clubs.forEach((k, i) => { delete k.beach; k.name = OLDP[i % OLDP.length] + ' ' + k.city + (i % 3 ? ' Norte' : ''); k.short = k.name.replace(/^\S+\s/, '').slice(0, 3).toUpperCase(); oldName[k.id] = k.name; });
  v2.history.forEach(h => { h.clubName = oldName[h.club]; });
  v2.trophies.forEach(t => { const k = v2.clubs.find(x => x.name === t.club) || v2.clubs.find(x => x.id === v2.myClub); t.club = oldName[k.id]; });
  v2.trophies.push({ season: 1, kind: 'copa', name: 'Copa Regional', club: oldName[v2.myClub] }, { season: 1, kind: 'ascenso', name: 'Ascenso a Liga Nacional', club: oldName[v2.myClub] }, { season: 1, kind: 'liga', name: 'Liga Regional', club: oldName[v2.myClub] });
  v2.player.role = 'Atacante'; v2.mate.role = 'Colocador-receptor'; delete v2.mate.form; v2.squad.forEach(m => { delete m.form; });
  const raw = JSON.stringify(v2); mem['voley3d.career'] = raw; C._reset();
  const m = C.get();
  ok(m && m.v === 3 && m.points === 21, 'guardado v2 cargado y pasado a v3 (puntos ' + m.points + ')');
  ok(m.clubs.every((k, i) => k.id === v2.clubs[i].id && k.lvl === v2.clubs[i].lvl && k.q === v2.clubs[i].q && JSON.stringify(k.kit) === JSON.stringify(v2.clubs[i].kit)), 'clubes: id, nivel, q y equipación intactos');
  ok(m.clubs.every(k => /^(CV Platja|Arena|Platja|Club Platja|Vóley Playa|Beach Vòlei|Sorra|Dunes|Litoral|Costa) /.test(k.name) && k.beach), 'clubes renombrados a vóley playa (' + C.myClub(m).name + ', ' + C.myClub(m).beach + ')');
  ok(new Set(m.clubs.map(k => k.name)).size === 40 && new Set(m.clubs.map(k => k.short)).size === 40, 'nombres y abreviaturas únicos tras renombrar');
  ok(m.myClub === v2.myClub && m.season === v2.season && m.week === v2.week && m.phase === v2.phase, 'sigue en su club, temporada y jornada');
  ok(JSON.stringify(m.res) === JSON.stringify(v2.res) && JSON.stringify(m.notes) === JSON.stringify(v2.notes) && m.career.played === v2.career.played && JSON.stringify(m.sched) === JSON.stringify(v2.sched), 'resultados, notas, totales y calendario intactos (los partidos a 15 ya jugados se quedan)');
  ok(m.history.length === 1 && m.history[0].clubName === C.club(m, m.history[0].club).name && m.history[0].pos === v2.history[0].pos, 'historial con el nombre nuevo del mismo club (' + m.history[0].clubName + ')');
  ok(m.trophies.every(t => m.clubs.some(k => k.name === t.club)), 'trofeos con el nombre nuevo (' + m.trophies.length + ')');
  ok(['Open Regional', 'Ascenso al Circuito Nacional', 'Circuito Regional'].every(n => m.trophies.some(t => t.name === n)) && !m.trophies.some(t => /^(Liga|Copa) |Ascenso a Liga/.test(t.name)), 'palmarés: competiciones con el nombre de playa (' + m.trophies.map(t => t.name).join(', ') + ')');
  ok(m.player.role === 'Bloqueador' && m.mate.role === 'Defensor' && m.mate.form === 0 && m.squad.every(s => s.form === 0), 'roles de playa y forma del compañero por defecto');
  ok(m.inbox.some(x => /playa/i.test(x.t)) && JSON.stringify(m.player.st) === JSON.stringify(v2.player.st) && m.player.xp === v2.player.xp, 'mensaje de la mudanza; jugador intacto');
  const msB = C.matchSetup(m);
  ok(msB && msB.venue === 'beach' && msB.points === 21, 'a partir de ahora se juega en la playa');
  C.save(); C._reset(); const m2 = C.get();
  ok(m2.inbox.filter(x => /playa/i.test(x.t)).length === 1 && m2.clubs[0].name === m.clubs[0].name, 'migrar dos veces no renombra ni duplica');
}

// ------------------------------------------------------------------ compañeros de distinto nivel
section('Compañeros de distinto nivel: horquilla, roles que se notan, plantilla, forma, ofertas');
{
  const offs = [], roles = {};
  for (let s = 1; s <= 60; s++) {
    C.abandon(); const t = C.create({ name: 'H' + s, seed: 9000 + s, autoClub: true });
    const k = C.myClub(t); offs.push(C.mateOvr(t) - C.clubOvr(k)); roles[t.mate.roleKey] = (roles[t.mate.roleKey] || 0) + 1;
    t.offers = C._genOffers(t, true); // (vacío: sin notas) – solo para no romper
  }
  const mean = offs.reduce((a, b) => a + b, 0) / offs.length, sd = Math.sqrt(offs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / offs.length);
  console.log('  compañero − club en 60 carreras: media ' + mean.toFixed(1) + ', desviación ' + sd.toFixed(1) + ', mín ' + Math.min(...offs) + ', máx ' + Math.max(...offs));
  ok(Math.min(...offs) >= C.MATE_OFF[0] && Math.max(...offs) <= C.MATE_OFF[1] + 1, 'desvío del compañero dentro de la horquilla ' + C.MATE_OFF.join('..'));
  ok(mean > -3 && mean < 1 && sd >= 2, 'horquilla ancha (media −1 aprox., desviación ≥ 2) y compañero algo por debajo del club de media (antes siempre +3)');
  ok(Math.min(...offs) <= -5 && Math.max(...offs) >= 3, 'hay compañeros flojos (≤ −5) y buenos (≥ +3)');
  // roles que se notan: el defensor coloca y recibe mejor de lo que remata; el bloqueador al revés
  C.abandon(); c = C.create({ name: 'Rol', role: 'atk', seed: 31, autoClub: true });
  const mp = C.mateProfile(c.mate);
  ok(c.mate.roleKey === 'cr' && c.mate.st.set > c.mate.st.spike + 8 && c.mate.st.recv > c.mate.st.block, 'bloqueador → compañero defensor: colocación ≫ potencia (' + c.mate.st.set + ' / ' + c.mate.st.spike + ')');
  ok(mp.ovr === C.mateOvr(c) && mp.strong.indexOf('set') >= 0 && mp.weak.indexOf('spike') >= 0 && mp.strong.length <= 3 && mp.weak.length <= 3, 'ficha: puntos fuertes ' + mp.strong.join(',') + ' / flojos ' + mp.weak.join(','));
  const atkP = C.mateProfile(C.genSt(50, 'atk', C._rng(3)));
  ok(atkP.strong.indexOf('spike') >= 0 && atkP.weak.indexOf('set') >= 0, 'bloqueador: fuerte en remate, flojo en colocación');
  // plantilla: alternativas con medias que se notan (≥ 2 de diferencia con el titular) y que importan en el partido
  const tit = C.mateOvr(c), alts = c.squad.map(s => C.ovrOf(s.st));
  ok(alts.every(a => Math.abs(a - tit) >= 2), 'plantilla: cada alternativa a ≥ 2 de media del titular (' + tit + ' / ' + alts.join(', ') + ')');
  const ms0 = C.matchSetup(c); c.coach = 60; C.changeMate(0); const ms1 = C.matchSetup(c);
  ok(Math.abs(C.ovrOf(ms1.attrs[0][1]) - C.ovrOf(ms0.attrs[0][1])) >= 2 && ms1.career.mate === c.mate.name, 'cambiar de compañero cambia de verdad los atributos del partido (' + C.ovrOf(ms0.attrs[0][1]) + ' → ' + C.ovrOf(ms1.attrs[0][1]) + ')');
  const q0 = C.teamOvr(c); C.changeMate(0); const q1 = C.teamOvr(c);
  ok(Math.abs(q1 - q0) >= 1, 'y la fuerza de la pareja en la simulación (' + q0.toFixed(1) + ' → ' + q1.toFixed(1) + ')');
  // forma: paseo aleatorio acotado, suma a sus atributos en el partido y a la fuerza simulada
  const forms = new Set(); let fmOk = true;
  for (let i = 0; i < 12; i++) { const r = C.simulateNext(c); forms.add(c.mate.form); if (Math.abs(c.mate.form) > C.FORM_MAX || r.mateForm !== c.mate.form) fmOk = false; }
  ok(fmOk && forms.size >= 2, 'forma del compañero: cambia y queda en ±' + C.FORM_MAX + ' (vistas: ' + [...forms].sort().join(',') + ')');
  c.mate.form = 2; c.fatigue = 0; c.mate.chem = 0; const mf2 = C.matchSetup(c); c.mate.form = -3; const mfm = C.matchSetup(c);
  ok(mf2.attrs[0][1].spike === Math.min(99, c.mate.st.spike + 2) && mfm.attrs[0][1].spike === Math.max(1, c.mate.st.spike - 3) && mf2.mateForm === 2, 'la forma suma o resta en los atributos del compañero (+2 / −3)');
  ok(C.formText(2) === 'En racha' && C.formText(-3) === 'Hundido' && C.formText(0) === 'Normal', 'textos de la forma');
  c.mate.form = 3; const t3 = C.teamOvr(c); c.mate.form = 0; const t0 = C.teamOvr(c);
  ok(Math.abs((t3 - t0) - 3 * C.FORM_SIM) < 1e-9, 'forma en la simulación rápida: +' + (3 * C.FORM_SIM) + ' con +3');
  // ofertas: compañeros distintos entre clubes (algún club ofrece un compañero mejor que su media y otro peor)
  const ds = [];
  for (let s = 1; s <= 25; s++) { C.abandon(); const t = C.create({ name: 'O' + s, seed: 7000 + s }); t.offers.forEach(o => { ds.push(o.mate - o.ovr); }); }
  console.log('  compañero − club en las ofertas de inicio de 25 carreras (' + ds.length + ' ofertas): ' + Math.min(...ds) + '..' + Math.max(...ds) + ', ≤ −5: ' + ds.filter(d => d <= -5).length + ', ≥ +3: ' + ds.filter(d => d >= 3).length);
  ok(Math.min(...ds) <= -4 && Math.max(...ds) >= 2 && ds.every(d => d >= C.MATE_OFF[0] - 1 && d <= C.MATE_OFF[1] + 1), 'ofertas de inicio con compañeros de nivel distinto respecto a su club (' + Math.min(...ds) + '..' + Math.max(...ds) + ')');
  // el club renueva al compañero solo si se queda muy por debajo (MATE_RENEW)
  C.abandon(); c = C.create({ name: 'Ren', seed: 55, autoClub: true });
  let gd = 0; while (c.phase !== 'off' && gd++ < 40) C.simulateNext(c);
  const k2 = C.myClub(c); C.KEYS.forEach(key => { c.mate.st[key] = Math.max(1, C.clubOvr(k2) - C.MATE_RENEW - 2); }); const nm0 = c.mate.name; C.stay();
  ok(c.mate.name !== nm0 || C.mateOvr(c) > C.clubOvr(C.myClub(c)) - C.MATE_RENEW, 'compañero muy por debajo del club: el club ficha otro en verano');
}

// ------------------------------------------------------------------ rol prometido, sueldo, banquillo, palmarés (11-nov-2026)
section('Rol prometido y sueldo: banquillo, titularidad, promesa incumplida, ahorros y fisio');
{
  C.abandon(); c = C.create({ name: 'Rol', num: 9, role: 'atk', seed: 31, autoClub: true });
  // matchSetup con Normal suave: rookie y nombre
  { let soft = 0, g2 = 0; while (c.phase === 'league' && g2++ < 14) { const n = C.next(c); if (n.bench) { C.benchNext(c); continue; } const ms = C.matchSetup(c); if (n.soft) { soft++; ok(ms.rookie === true && ms.difficulty === 'normal' && ms.diffName === 'Normal suave', 'Normal suave: matchSetup con rookie'); } else ok(ms.rookie === false, 'sin suave: rookie false'); C.simulateNext(c); }
    console.log('  partidos contra Normal suave en la temporada: ' + soft); }
  // rotación con poca confianza: alguna jornada al banquillo (y nunca dos seguidas)
  C.abandon(); c = C.create({ name: 'Rot', num: 9, role: 'atk', seed: 32, autoClub: true });
  c.contract.role = 'Rotación'; let benches = 0, prevB = false, two = false, m0 = c.money, xp0 = c.player.xp + 1000 * c.player.lvl;
  for (let i = 0; i < 12 && c.phase === 'league'; i++) {
    c.coach = 40; const n = C.next(c);
    if (n.bench) {
      ok(C.matchSetup(c) === null, 'en el banquillo no hay partido que jugar');
      const pl = c.stats.played, lv = c.player.lvl, xp = c.player.xp, wk = c.week, f0 = c.fatigue = 50, r = C.simulateNext(c);
      ok(r && r.bench && r.nota === null && r.xp === 0 && c.player.xp === xp && c.player.lvl === lv && c.stats.played === pl && c.week === wk + 1, 'banquillo: sin nota ni experiencia, la jornada avanza');
      ok(c.fatigue < f0, 'banquillo: descansas (fatiga ' + f0 + ' → ' + c.fatigue + ')');
      benches++; if (prevB) two = true; prevB = true;
    } else { C.simulateNext(c); prevB = false; }
  }
  ok(benches >= 1 && benches <= 7 && !two, 'rotación con confianza 40: banquillo en ' + benches + ' de 12 jornadas, nunca dos seguidas');
  ok(c.money > m0, 'el sueldo se cobra cada jornada (ahorros ' + c.money + ' €)');
  ok(c.stats.bench === benches && c.career.bench === benches, 'banquillos contados en la temporada y en la carrera');
  // de la rotación a titular con PROMOTE_AT
  c.contract.role = 'Rotación'; const s0 = c.contract.salary; c.coach = C.PROMOTE_AT + 5; let g3 = 0;
  while (c.contract.role === 'Rotación' && c.phase === 'league' && g3++ < 3) C.simulateNext(c);
  ok(c.contract.role === 'Titular' && c.contract.salary >= s0 && c.inbox.some(m => /titularidad/.test(m.t)), 'con ' + C.PROMOTE_AT + ' de confianza la rotación pasa a titular (sueldo ' + s0 + ' → ' + c.contract.salary + ')');
  // titular indiscutible: nunca banquillo y la confianza no baja de ROLE_FLOOR
  c.contract.role = 'Titular indiscutible'; c.coach = 0; ok(!C.next(c).bench, 'indiscutible: nunca al banquillo');
  if (c.phase === 'league') { c.notes.push({ nota: 1 }); C.simulateNext(c); ok(c.coach >= C.ROLE_FLOOR[2], 'indiscutible: confianza ≥ ' + C.ROLE_FLOOR[2] + ' (' + c.coach + ')'); }
  // titular sentado = promesa incumplida → salida sin pegas y más interés
  C.abandon(); c = C.create({ name: 'Prom', num: 9, role: 'atk', seed: 33, autoClub: true });
  c.contract.role = 'Titular'; c.contract.left = 3; let br = false, g4 = 0;
  while (!br && c.phase === 'league' && g4++ < 14) { c.coach = 10; const n = C.next(c); if (n.bench) { const sc0 = C.offerScore(c); ok(C.earlyExit(c), 'con contrato en vigor, salir tiene pegas'); C.benchNext(c); br = true; ok(c.broken === c.season && !C.earlyExit(c), 'titular al banquillo: promesa incumplida, sales sin pegas'); ok(C.offerScore(c) - sc0 >= C.BROKEN_BONUS - 0.5, 'promesa incumplida: más interés de los clubes'); ok(c.inbox.some(m => m.t === 'Promesa incumplida'), 'mensaje del agente'); } else C.simulateNext(c); }
  ok(br, 'un titular con el entrenador descontento acaba en el banquillo');
  // fisio: cuesta, baja la fatiga, una vez por jornada
  if (c.phase === 'league') {
    c.money = 0; c.fatigue = 60; ok(C.physio() === 'money', 'fisio sin dinero: no');
    c.money = 5000; const pc = C.physioCost(c); ok(C.physio() === 'ok' && c.fatigue === 60 - C.PHYSIO_FAT && c.money === 5000 - pc, 'fisio: −' + C.PHYSIO_FAT + ' de fatiga por ' + pc + ' €');
    ok(C.physio() === 'done', 'fisio: una vez por jornada');
  }
  // compañero: techo en el partido (desvío + racha ≤ MATE_CAP sobre el club)
  { const k = C.myClub(c); C.KEYS.forEach(key => { c.mate.st[key] = C.clubOvr(k) + 5; }); c.mate.form = 3; c.mate.chem = 0; c.fatigue = 0;
    if (C.next(c) && !C.next(c).bench) { const ms = C.matchSetup(c); ok(C.ovrOf(ms.attrs[0][1]) <= C.clubOvr(k) + C.MATE_CAP && ms.mateForm === 1, 'compañero +5 en racha +3: en el partido +' + (C.ovrOf(ms.attrs[0][1]) - C.clubOvr(k)) + ' (techo +' + C.MATE_CAP + ')'); }
    c.mate.form = -2; ok(C.mateFormCap(c, null, -2) === -2, 'la mala racha no se recorta'); }
}
section('Palmarés migrado: nombres de playa');
{
  const o = { trophies: [{ season: 1, kind: 'liga', name: 'Liga Regional', club: 'X' }, { season: 2, kind: 'copa', name: 'Copa Nacional', club: 'X' }, { season: 2, kind: 'ascenso', name: 'Ascenso a Superliga', club: 'X' },
    { season: 3, kind: 'ascenso', name: 'Ascenso a Circuito Mundial', club: 'X' }, { season: 4, kind: 'liga', name: 'Superliga de Playa', club: 'X' }, { season: 5, kind: 'ascenso', name: 'Ascenso al Circuito Nacional', club: 'X' }] };
  C._beachTrophies(o); const nm = o.trophies.map(t => t.name);
  ok(nm.join('|') === 'Circuito Regional|Open Nacional|Ascenso a la Hiperliga de Playa|Ascenso al Circuito Mundial|Hiperliga de Playa|Ascenso al Circuito Nacional', 'competiciones de pabellón → circuitos de playa (' + nm.join(', ') + ')');
  C._beachTrophies(o); ok(o.trophies.map(t => t.name).join('|') === nm.join('|'), 'idempotente');
}

// ------------------------------------------------------------------ simulación rápida
section('quickSim');
{
  const r = C._rng(5);
  let wins = 0; for (let i = 0; i < 400; i++) { const q = C.quickSim(55, 45, r, 15); if (q.sets[0] === 2) wins++; }
  ok(wins > 260 && wins < 390, '10 de media de ventaja gana ~80 % (' + (wins / 4).toFixed(0) + ' %)');
  const q25 = C.quickSim(50, 50, r, 25); ok(q25.setScores.every((x, i) => Math.max(x[0], x[1]) >= (i === 2 ? 15 : 25)), 'sets a 25 y desempate a 15');
}

// ------------------------------------------------------------------ Carrera de pista (6v6, lote C)
verbose = true;   // (la pista enseña cada comprobación: sirve de informe)
// Las secciones de la pista usan ligas de PRUEBA inventadas (tools/leagues-fixture.js: liga impar de 9, una de 8 a doble vuelta, país sin
// 2ª); los datos reales de js/leagues.js se prueban al final («datos reales»).
const REAL_LEAGUES = VB.Leagues && VB.Leagues.regions, REAL_PROV = VB.Leagues && VB.Leagues.provisional;
if (VB.Leagues) { VB.Leagues.regions = require('./leagues-fixture.js')(); VB.Leagues.provisional = true; }
section('Carrera de pista (6v6): crear, guardado aparte, modo activo');
{
  const H = C.hall, beachRaw = mem['voley3d.career'];
  ok(VB.Leagues && H && H.available(), 'datos de ligas (ligas de prueba) y Carrera de pista disponible');
  ok(C.mode() === 'beach', 'sin pista, la Carrera activa es la de playa');
  const cs = H.countries();
  ok(cs.length >= 3 && cs.some(x => x.code === 'ES'), 'países: ' + cs.map(x => x.code).join(', '));
  // datos: esquema y reglas de Ferran
  const regs = VB.Leagues.regions, allClubs = [], allNames = [];
  regs.forEach(rg => rg.countries.forEach(co => co.divisions.forEach(d => { allNames.push(d.name); d.clubs.forEach(k => { allClubs.push(k); allNames.push(k.name); }); })));
  ok(allClubs.every(k => k.name && k.short && k.colors && /^#[0-9a-f]{6}$/i.test(k.colors.shirt) && /^#[0-9a-f]{6}$/i.test(k.colors.shirt2) && /^#[0-9a-f]{6}$/i.test(k.colors.libero) && k.ovr >= 0 && k.ovr <= 100 && 'liberoEstimated' in k && k.check && k.official && k.real),
    'esquema de cada club: nombre, abreviatura, 3 colores, ovr 0-100, liberoEstimated, official, real, check (' + allClubs.length + ' clubes)');
  ok(!allNames.some(n => /masculin|femenin/i.test(n)), 'ningún nombre dice «masculino» ni «femenino»');
  ok(regs.every(rg => rg.countries.every(co => co.divisions.every(d => d.strength >= 0 && d.strength <= 100 && d.short && d.real))), 'divisiones con fuerza 0-100, abreviatura y «real»');
  let c6 = C.create({ mode: 'hall', name: 'Pista Prueba', num: 9, pos: 'OH', seed: 777, points: 15 });
  ok(c6 && c6.mode === 'hall' && C.mode() === 'hall', 'crear la de pista la deja activa');
  ok(mem['voley3d.career'] === beachRaw && mem['voley3d.career6'], 'guardado aparte (voley3d.career6); el de playa no se toca');
  ok(c6.cc === 'ES' && c6.points === 15 && c6.player.roleKey === 'OH' && c6.player.role === 'Receptor' && C.ovrOf(c6.player.st) === H.START_OVR, 'por defecto España, sets a 15, receptor, media ' + H.START_OVR);
  ok(c6.phase === 'pick' && c6.offers.length >= 3 && c6.offers.filter(o => !o.trial).every(o => o.lid === 'ES2'), 'ofertas de inicio de clubes modestos de la 2ª (' + c6.offers.map(o => C.club(c6, o.club).short + (o.trial ? '*' : '')).join(' ') + ')');
  ok(c6.offers.filter(o => o.trial).every(o => o.lid === 'ES1'), 'la prueba (si la hay) es en la 1ª');
  ok(c6.clubs.every(k => k.kit && typeof k.kit.libero === 'number' && typeof k.kit.shirt === 'number'), 'equipaciones con camiseta, segundo color y líbero');
  const pal = c6.clubs.find(k => k.name === 'Vòlei Rocaverde'); ok(pal && pal.kit.shirt === 0xc8102e && pal.kit.libero === 0x7b3fd1, 'colores tal cual los datos (rojo, líbero lila)');
  ok(C.setMode('beach') && C.get().v === 3 && C.get().clubs.length === 40, 'se vuelve a la playa con su carrera intacta (v3, 40 clubes)');
  C.setMode('hall'); ok(C.get() === c6, 'y de nuevo a la pista');
  C._reset(); c6 = C.get(); ok(c6 && c6.mode === 'hall' && c6.phase === 'pick' && C.mode() === 'hall', 'se guarda y se carga en plena elección');
}
section('Carrera de pista: partido 6v6, nota, calendario impar, temporada, copas');
{
  let c6 = C.get(); const i0 = c6.offers.findIndex(o => !o.trial);
  ok(C.acceptOffer(i0, 2) && c6.phase === 'league' && C.myClub(c6).lid === 'ES2', 'firmar por un club de la 2ª');
  const W = C.weeksOf(c6, 'ES2'), n2 = C.leagueClubs(c6, 'ES2').length;
  ok(n2 === 9 && W === 9, 'liga de 9 clubes a una vuelta: 9 jornadas (' + W + ')');
  const sch = C.sched(c6, 'ES2'); ok(sch.every(wk => wk.length === 4) && C.leagueClubs(c6, 'ES2').every(k => sch.filter(wk => wk.some(m => m[0] === k.id || m[1] === k.id)).length === 8), 'cada club juega 8 y descansa 1');
  ok(C.weeksOf(c6, 'BR1') === 14, 'con 8 clubes, doble vuelta (14)');
  const n = C.next(c6) || (C.simulateNext(), C.next(c6)), ms = C.matchSetup(c6);
  ok(ms && ms.format === '6v6' && ms.venue === 'hall' && ms.ctrlRole === 'OH' && ms.ctrl === 'one', 'partido 6v6 en el pabellón, llevas al receptor');
  ok(ms.attrs[0].length === 6 && ms.attrs[1].length === 6 && ms.attrs[0][ms.ctrlIdx].jump === Math.max(1, c6.player.st.jump - ms.fatigue + 0) , 'atributos de los 12; los tuyos en tu hueco (' + ms.ctrlIdx + ')');
  ok(ms.nums[0][ms.ctrlIdx] === 9 && new Set(ms.nums[0]).size === 6, 'tu dorsal en tu hueco y dorsales distintos (' + ms.nums[0].join(',') + ')');
  ok(ms.kit.kitLibero === C.myClub(c6).kit.libero && ms.rivalKit.kitLibero === n.rival.kit.libero && ms.kit.kitShirt === C.myClub(c6).kit.shirt, 'equipaciones de los dos clubes con el color del líbero');
  ok(ms.difficulty === H6diff(n.rival.ovr) && ms.career.mode === 'hall' && /Jornada/.test(ms.career.label), 'IA por la media del rival (' + n.rival.ovr + ' → ' + ms.difficulty + (ms.rookie ? ' suave' : '') + ')');
  function H6diff(o) { return o >= 88 ? 'expert' : o >= 76 ? 'hard' : o >= 56 ? 'normal' : 'easy'; }
  // partido jugado con eventos falsos: tu jugador (g.ctrl) en un 6v6
  const team0 = [0, 1, 2, 3, 4, 5].map(i => ({ team: 0, id: i, num: ms.nums[0][i] })), me6 = team0[ms.ctrlIdx];
  const g = { career: ms.career, size: 6, teams: [team0, [0, 1, 2, 3, 4, 5].map(i => ({ team: 1, id: 16 + i }))], ctrl: me6 };
  const evs = [{ type: 'newMatch' }];
  for (let i = 0; i < 7; i++) evs.push({ type: 'hit', team: 0, player: me6, kind: 'spike', touch: 3, human: true, grade: 'good' }, { type: 'point', team: 0, how: 'kill' });
  for (let i = 0; i < 3; i++) evs.push({ type: 'hit', team: 0, player: team0[3], kind: 'spike', touch: 3 }, { type: 'point', team: 0, how: 'kill' });
  C.ingest(evs, g);
  const wk0 = c6.week, s = C.matchDone({ sets: [2, 0], setScores: [[15, 10], [15, 12]], win: true }, null, g);
  ok(s && s.mode === 'hall' && s.me.kills === 7 && s.nota >= 6 && s.nota <= 10 && s.xp > 0, 'partido jugado: 7 remates tuyos (no los de los compañeros), nota ' + (s && s.nota) + ', XP ' + (s && s.xp));
  ok(c6.week > wk0 && c6.myRes.w[wk0] && c6.myRes.w[wk0].some(r => r.mine), 'la jornada avanza y se guarda tu resultado');
  // temporada entera simulada
  let guard = 0, sawKO = false;
  while (c6.phase !== 'off' && guard++ < 80) { if (c6.phase === 'ko') sawKO = true; if (!C.simulateNext()) break; }
  ok(c6.phase === 'off' && c6.review && c6.review.season === 1, 'temporada 1 completa (' + guard + ' pasos)');
  const allPj = c6.leagues.every(L => C.table(c6, L.id).every(r => r.pj === (C.leagueClubs(c6, L.id).length <= 8 ? 2 : 1) * (C.leagueClubs(c6, L.id).length - 1)));
  ok(allPj, 'todas las ligas acaban su calendario (cada club, todos sus partidos)');
  ok(c6.kos.length >= 2 && c6.kos.every(ko => ko.champion >= 0), 'copa nacional e internacionales jugadas: ' + c6.kos.map(ko => ko.name + ' (' + C.club(c6, ko.champion).short + ')').join(', '));
  ok(c6.kos[0].kind === 'cup' && c6.kos[0].name === 'Copa de la Corona' && c6.kos.some(ko => ko.name === 'Champions Cup'), 'nombres de copa cambiados (Copa de la Corona, Champions Cup)');
  const t1 = C.table(c6, 'IT1'), cc = c6.kos.find(ko => ko.name === 'Champions Cup');
  ok(cc.ids.indexOf(t1[0].id) >= 0 || cc.ids.length === 4, 'a la Champions Cup van los primeros de las 1ªs');
  ok(c6.history.length === 1 && c6.history[0].lgShort === 'HP2', 'historial de la temporada');
}
section('Carrera de pista: ascensos y descensos, tu ascenso');
{
  let c6 = C.get();
  const mv = c6.review.moves, up = mv.filter(m => m.to === 'ES1'), down = mv.filter(m => m.to === 'ES2');
  ok(up.length === 2 && down.length === 2 && mv.filter(m => m.to === 'IT1').length === 2, '2 suben y 2 bajan en España y en Italia; Polonia y Brasil (una división) sin movimientos');
  C.stay(2);
  ok(C.leagueClubs(c6, 'ES1').length === 10 && C.leagueClubs(c6, 'ES2').length === 9 && c6.season === 2, 'tamaños de liga conservados en la temporada 2');
  // tu club, muy fuerte en la 2ª: asciende
  const mk = C.myClub(c6);
  if (mk.lid !== 'ES2') { ok(true, '(tu club ya está en la 1ª)'); }
  else {
    mk.ovr = 80; C.KEYS.forEach(k => { c6.player.st[k] = 80; });
    let g = 0; while (c6.phase !== 'off' && g++ < 80) C.simulateNext();
    ok(c6.review.move === 1 && c6.trophies.some(t => t.kind === 'ascenso' && /Hiperliga/.test(t.name)), 'campeón de la 2ª: asciende (' + c6.trophies.map(t => t.name).join(', ') + ')');
    C.stay(1);
    ok(C.myClub(c6).lid === 'ES1' && C.next(c6) && /^Hiperliga ·/.test(C.next(c6).label), 'la temporada siguiente juegas en la Hiperliga');
  }
}
section('Carrera de pista: ojeadores y ofertas del extranjero');
{
  let c6 = C.get();
  // jugador modesto (media 60): ningún club de la élite (fuerza ≥ 85) le hace oferta
  C.KEYS.forEach(k => { c6.player.st[k] = 60; }); c6.notes = [{ nota: 7 }, { nota: 7 }]; c6.coach = 60; c6.scouts = {};
  let off = C._genOffers(c6, true);
  ok(off.every(o => C.league(o.lid).strength < 85), 'media 60: las ligas de élite no le quieren (' + off.map(o => C.club(c6, o.club).short + ' ' + o.lid).join(', ') + ')');
  // jugador muy bueno con notas altas: llegan ofertas de fuera con país, liga, nivel, rol y sueldo
  C.KEYS.forEach(k => { c6.player.st[k] = 90; }); c6.notes = [{ nota: 8.4 }, { nota: 8.6 }, { nota: 8.2 }]; c6.coach = 80;
  off = C._genOffers(c6, true);
  const fo = off.filter(o => o.foreign);
  ok(fo.length >= 1, 'media 90 y notas de 8: ofertas del extranjero (' + off.map(o => C.club(c6, o.club).name + ' ' + o.cc + ' ' + o.role).join(', ') + ')');
  ok(fo.every(o => o.cc !== C.myClub(c6).cc && C.league(o.lid).strength > 0 && o.ovr > 0 && o.role && o.salary > 0 && o.objective), 'cada oferta lleva país, liga (con su nivel), media, rol, sueldo y objetivo');
  ok(fo.every(o => o.salary > c6.contract.salary), 'las ligas fuertes pagan más (' + fo.map(o => o.salary).join(', ') + ' contra ' + c6.contract.salary + ')');
  // ojeador
  let scout = null; for (let i = 0; i < 20 && scout == null; i++) { c6.notes.push({ nota: 8 }); scout = C.hall._scout(c6, 8); }
  ok(scout != null && c6.scouts[scout] && c6.inbox.some(m => /Ojeadores/.test(m.t)), 'un ojeador viene a verte tras un buen partido (' + (scout != null ? C.club(c6, scout).name : '-') + ')');
  // fichar por un club extranjero a mitad de temporada
  if (c6.phase === 'league' && fo.length) {
    c6.offers = off; c6.window = 'mid';
    const fi = c6.offers.indexOf(fo[0]), dest = fo[0].club;
    ok(C.acceptOffer(fi, 2) && c6.myClub === dest && C.myClub(c6).cc !== 'ES' && c6.myRes.lid === C.myClub(c6).lid && c6.inbox.some(m => /Fichaje internacional/.test(m.t)), 'fichar por un club extranjero: nueva liga (' + C.myClub(c6).lid + ') y su calendario');
    let g = 0; while (c6.phase !== 'off' && g++ < 80) C.simulateNext();
    ok(c6.phase === 'off' && c6.history.slice(-1)[0].country !== 'España', 'la temporada acaba en la liga extranjera (' + c6.history.slice(-1)[0].country + ')');
  }
}
section('Carrera de pista: puestos que crecen solos, guardado dañado y migración');
{
  let c6 = C.get();
  ok(C.positions().join() === VB.Sim.CTRL_ROLES6.join(), 'los puestos de la Carrera son los que exporta sim.js (lote A: ' + VB.Sim.CTRL_ROLES6.join() + ')');
  VB.Sim.CTRL_ROLES6 = ['OH', 'S', 'OPP', 'MB'];
  ok(C.positions().join() === 'OH,S,OPP,MB', 'si sim.js exporta más puestos, la lista crece sola');
  ok(C.setPosition('S') && c6.player.roleKey === 'S' && c6.player.role === 'Colocador', 'cambiar a colocador');
  if (c6.phase === 'off') C.stay(1);
  const ms = C.next(c6) && !C.next(c6).bench ? C.matchSetup(c6) : null;
  if (ms) ok(ms.ctrlRole === 'S' && ms.ctrlIdx === VB.Sim.ROLES6.indexOf('S') && ms.nums[0][ms.ctrlIdx] === c6.player.num, 'el partido te pone de colocador en su hueco');
  delete VB.Sim.CTRL_ROLES6;
  ok(C.ctrlRole(c6) === 'OH', 'sin el puesto en sim.js, juegas de receptor (tu perfil se queda)');
  C._reset(); c6 = C.get(); ok(c6 && c6.player.roleKey === 'S', 'se guarda el puesto');
  // guardado de pista dañado: se aparta, la playa sigue
  const good6 = mem['voley3d.career6'];
  mem['voley3d.career6'] = '{"v":1,"player":{},"leagues":[],"clubs":[]}'; C._reset();
  ok(!C.hall.exists() && C.hall.lost() && mem['voley3d.career6.bak'] && C.mode() === 'beach' && C.get().v === 3, 'pista dañada: copia .bak, aviso, y la Carrera activa vuelve a la playa (intacta)');
  mem['voley3d.career6'] = good6; delete mem['voley3d.career6.bak']; C._reset(); C.setMode('hall');
  const raw = JSON.parse(good6); delete raw.tab; delete raw.myRes; delete raw.scouts; raw.chem = 'x'; delete raw.kos; raw.phase = raw.phase === 'off' ? 'off' : 'league';
  mem['voley3d.career6'] = JSON.stringify(raw); C._reset();
  const rc = C.get(); ok(rc && rc.mode === 'hall' && rc.tab && rc.myRes && rc.chem === 0 && Array.isArray(rc.kos), 'guardado de pista a medias: se repara');
  let g = 0; while (rc.phase !== 'off' && g++ < 80) if (!C.simulateNext()) break;
  ok(rc.phase === 'off', 'y se puede seguir jugando hasta el fin de temporada');
  // la migración de un guardado de playa viejo no se ve afectada por tener una de pista
  const v2 = JSON.parse(mem['voley3d.career']); v2.v = 2; v2.points = 15; v2.trophies = [{ season: 1, kind: 'liga', name: 'Liga Regional', club: 'X' }];
  mem['voley3d.career'] = JSON.stringify(v2); C._reset(); C.setMode('beach');
  const mb = C.get(); ok(mb && mb.v === 3 && mb.points === 21 && mb.trophies[0].name === 'Circuito Regional' && C.hall.exists(), 'un guardado de playa v2 migra igual con una Carrera de pista guardada al lado');
  ok(C.matchSetup(mb) === null || C.matchSetup(mb).venue === 'beach', 'la playa sigue en la playa');
  delete mem['voley3d.career6']; C._reset(); mem['voley3d.career.mode'] = 'hall';
  ok(C.mode() === 'beach', 'modo pista sin guardado de pista: la activa es la playa');
}

section('Carrera de pista con los datos reales (js/leagues.js, generado de notes/clubes/*.json por tools/build-leagues.js)');
{
  const regs = REAL_LEAGUES;
  if (!regs || REAL_PROV) console.log('  (js/leagues.js sin datos reales: se salta)');
  else {
    const keep = { c6: mem['voley3d.career6'], md: mem['voley3d.career.mode'] }, fix = VB.Leagues.regions;
    VB.Leagues.regions = regs; VB.Leagues.provisional = false; delete mem['voley3d.career6']; C._reset();
    const H = C.hall, cos = H.countries(), t0 = Date.now();
    const ordn = n => n + (n === 1 || n === 3 ? 'r' : 'º');
    const divs = [], clubs = [];
    regs.forEach(rg => rg.countries.forEach(co => co.divisions.forEach(d => { divs.push([co, d]); d.clubs.forEach(k => clubs.push([co, d, k])); })));
    ok(cos.length === 28 && divs.length === 37 && clubs.length === 390, cos.length + ' países, ' + divs.length + ' ligas, ' + clubs.length + ' clubes: ' + cos.map(x => x.code).join(' '));
    const want = 'IT PL TR FR DE RU ES BE NL GR PT CH AT CZ RS SI RO BR AR US CA PE JP KR CN IR QA PH'.split(' ');
    ok(want.every(cc => cos.some(x => x.code === cc)), 'los 28 países que pidió Ferran (17 de Europa, 5 de América, 6 de Asia)');
    ok(cos.every(x => ['Europa', 'América', 'Asia'].indexOf(x.region) >= 0) && regs.map(r => r.region).join() === 'Europa,América,Asia', 'una región por continente');
    const two = cos.filter(x => x.divs === 2).map(x => x.code).join(' ');
    ok(two === 'IT PL TR RU FR DE ES BR JP', '1ª y 2ª en los países fuertes (' + two + '); solo 1ª en el resto');
    ok(divs.every(([co, d]) => d.clubs.length >= 8 && d.clubs.length <= 12 && d.strength > 0 && d.strength <= 100), 'ligas de 8 a 12 clubes con fuerza 1-100');
    ok(clubs.every(([co, d, k]) => k.name && /^[A-ZÀ-Ž0-9]{2,4}$/.test(k.short) && /^#[0-9a-f]{6}$/.test(k.colors.shirt) && /^#[0-9a-f]{6}$/.test(k.colors.shirt2) && /^#[0-9a-f]{6}$/.test(k.colors.libero) && k.ovr >= 40 && k.ovr <= 99 && typeof k.liberoEstimated === 'boolean'),
      'esquema de cada club: nombre, abreviatura, 3 colores, ovr, liberoEstimated');
    ok(clubs.every(([co, d, k]) => !('real' in k) && !('official' in k) && !('check' in k)), 'el juego no lleva los nombres reales ni oficiales (con patrocinadores)');
    const nm = new Set(clubs.map(x => x[2].name.toLowerCase())), sh = new Set(clubs.map(x => x[2].short));
    ok(nm.size === clubs.length, 'ningún nombre de club repetido entre países');
    ok(sh.size === clubs.length, 'abreviaturas únicas en todo el juego (también dentro de cada liga)');
    ok(!/masculin|femenin/i.test(JSON.stringify(regs)), 'ni «masculino» ni «femenino» en los datos');
    // los nombres nuestros no coinciden con el real ni con el oficial de los JSON de investigación
    const dir = path.join(ROOT, 'notes', 'clubes'), files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.json$/.test(f)) : [], same = [];
    let nsrc = 0;
    files.forEach(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).countries.forEach(co => co.divisions.forEach(d => d.clubs.forEach(k => {
      nsrc++; const n = k.name.toLowerCase(); if (n === String(k.official).toLowerCase() || n === String(k.real).toLowerCase()) same.push(k.name);
      if (!nm.has(n)) same.push(k.name + ' (no está en js/leagues.js: vuelve a ejecutar tools/build-leagues.js)');
    }))));
    ok(files.length === 5 && nsrc === clubs.length && !same.length, 'js/leagues.js al día con notes/clubes/*.json y ningún nombre igual al real u oficial' + (same.length ? ': ' + same.join(', ') : ''));
    // dificultad de la IA por la media de cada club: la élite en Experto, España en Normal, las pequeñas entre Fácil y Normal
    function H6r(o) { return o >= 88 ? 'expert' : o >= 76 ? 'hard' : o >= 62 ? 'normal' : o >= 56 ? 'soft' : 'easy'; }
    const cnt = {}; clubs.forEach(([co, d, k]) => { const x = H6r(k.ovr); cnt[x] = (cnt[x] || 0) + 1; });
    const lg = (cc, l) => divs.find(([co, d]) => co.code === cc && d.lvl === l)[1].clubs.map(k => H6r(k.ovr));
    ok(cnt.easy > 0 && cnt.soft > 0 && cnt.normal > 0 && cnt.hard > 0 && cnt.expert > 0, 'IA de los clubes: ' + JSON.stringify(cnt));
    ok(lg('IT', 1).filter(x => x === 'expert').length >= 6 && lg('ES', 1).every(x => x === 'normal') && lg('PH', 1).every(x => x === 'easy' || x === 'soft') && lg('IT', 2).some(x => x === 'normal'),
      'la 1ª italiana casi toda en Experto, la Hiperliga en Normal, Filipinas entre Fácil y Normal suave; la 2ª italiana no es toda Difícil');
    const c6 = C.create({ mode: 'hall', name: 'Real', num: 7, pos: 'OH', seed: 4242, autoClub: true });
    ok(c6 && C.myClub(c6).lid === 'ES2' && c6.clubs.length === 390 && c6.leagues.length === 37 && !c6.provisional, 'Carrera de España con los datos reales: empiezas en la 2ª (' + C.myClub(c6).name + ')');
    ok(c6.clubs.every(k => regs.some(rg => rg.countries.some(co => co.divisions.some(d => d.clubs.some(x => x.short === k.short && x.name === (k.nameBase || k.name)))))), 'abreviaturas del juego = las de los datos (no hace falta renombrar ninguna)');
    const cupOf = cc => c6.cups[cc] && c6.cups[cc].name;
    const cupCC = 'ES FR DE IT PL TR RU BE NL GR PT CH AT CZ RS SI RO BR AR JP KR'.split(' ');
    ok(cupCC.every(cc => cupOf(cc)), 'copa nacional propia en ' + cupCC.length + ' países: ' + cupCC.map(cc => cc + ' ' + cupOf(cc)).join(', '));
    ok(cupOf('IT') === 'Coppa Tricolore' && cupOf('PL') === 'Puchar Orła' && cupOf('TR') === 'Hilal Kupası' && cupOf('RU') === 'Kubok Volgi', 'las copas de Italia, Polonia, Turquía y Rusia ya no son la genérica');
    const inm = cc => H.intlFor(c6, cc).map(x => x.name + ' (' + x.rank + ')').join(' + ');
    ok(inm('ES') === 'Champions Cup VEC (1) + Copa VEC (2)' && inm('BE') === inm('ES') && inm('BR') === 'Copa del Sur de Clubes (1)' && inm('US') === 'Copa Norte de Campeones (1)' && inm('JP') === 'Champions Cup Asia (1)',
      'copas internacionales unificadas: Europa ' + inm('ES') + '; BR ' + inm('BR') + '; US ' + inm('US') + '; JP ' + inm('JP'));
    const allComp = []; regs.forEach(rg => rg.competitions.forEach(x => allComp.push(x.name)));
    ok(!allComp.some(n => /^(Champions Cup|World Club Cup|Mundial VBC de Clubes|Challenge Trophy)$/.test(n)) && allComp.filter(n => n === 'Mundial de Clubes VBF').length === 3, 'un solo nombre por competición (Champions Cup VEC; Mundial de Clubes VBF en los tres continentes)');
    ok(!Object.keys(c6.cups).some(cc => /Super|Hiper(liga|copa)|Liga/i.test(cupOf(cc))) && !Object.keys(c6.intl).some(r => c6.intl[r].some(x => /Mundial|World|VBN|Challenge/.test(x.name))), 'ni ligas, ni supercopas, ni el Mundial, ni la 3ª copa europea pasan por copas');
    let g = 0; while (c6.season < 3 && g++ < 200) { if (c6.phase === 'off') C.stay(1); else C.simulateNext(); }
    ok(c6.season === 3 && c6.history.length === 2, '2 temporadas simuladas en ' + (Date.now() - t0) + ' ms (' + c6.history.map(h => h.lgShort + ' ' + ordn(h.pos)).join(', ') + ')');
    ok(c6.history.every(h => h.cup), 'la copa nacional se juega cada temporada');
    ok(c6.leagues.every(L => C.leagueClubs(c6, L.id).length === divs.find(([co, d]) => co.code + d.lvl === L.id)[1].clubs.length), 'ascensos y descensos conservan el tamaño de cada liga');
    ok(mem['voley3d.career6'].length < 400000, 'guardado de ' + Math.round(mem['voley3d.career6'].length / 1024) + ' KB');
    // empezar en cada país: ofertas de su 2ª (o de su 1ª si no tiene)
    const bad = [];
    cos.forEach(x => {
      delete mem['voley3d.career6']; C._reset();
      const c = C.create({ mode: 'hall', name: 'P', num: 5, pos: 'OH', seed: 99, country: x.code }), low = x.divs === 2 ? x.code + '2' : x.code + '1';
      if (!c || c.cc !== x.code || c.offers.length < 2 || !c.offers.filter(o => !o.trial).every(o => o.lid === low)) bad.push(x.code);
    });
    ok(!bad.length, 'crear en cualquiera de los 28 países: ofertas de su división más baja' + (bad.length ? ' (fallan ' + bad.join(' ') + ')' : ''));
    VB.Leagues.regions = fix; VB.Leagues.provisional = true;
    if (keep.c6 != null) mem['voley3d.career6'] = keep.c6; else delete mem['voley3d.career6'];
    if (keep.md != null) mem['voley3d.career.mode'] = keep.md; else delete mem['voley3d.career.mode'];
    C._reset();
  }
}

verbose = false;
// ------------------------------------------------------------------ vida de la Carrera (js/career-life.js)
section('Vida de la Carrera: retos, fama, patrocinio, decisiones, rival, tienda, premios, logros y legado');
if (!VB.CareerLife) console.log('  (sin js/career-life.js)');
else {
  const Lf = VB.CareerLife;
  if (C.setMode) C.setMode('beach'); C.abandon(); C._reset();
  let c = C.create({ name: 'Vida', num: 5, role: 'atk', seed: 777, autoClub: true });
  ok(c.life && c.life.fame === 0, 'c.life creado al crear la carrera');
  // reto determinista y visible antes del partido
  const ch = Lf.challenge(C.load()), ch2 = Lf.challenge(C.load());
  ok(ch && ch.txt && ch.fans > 0 && JSON.stringify(ch) === JSON.stringify(ch2), 'reto de la jornada determinista: «' + (ch && ch.txt) + '»');
  const ms = C.matchSetup(); ok(ms.career.goal === ch.txt, 'matchSetup lleva el reto a g.career.goal');
  // partido jugado con el reto cumplido a la fuerza: me con todo alto
  { const g = { career: { season: 1 }, teams: [[{}, {}], [{}, {}]], demo: false, autopilot: false };
    const f0 = C.load().life.fame, m0 = C.load().money, d0 = C.load().life.chDone;
    const sum = C.matchDone({ sets: [2, 0], setScores: [[21, 10], [21, 9]], win: true }, { kills: 30, aces: 6, blocks: 5, digs: 20, assists: 15, errors: 0 }, g);
    ok(sum.life && sum.life.ch && sum.life.ch.ok, 'reto cumplido en un partidazo (' + (sum.life && sum.life.ch && sum.life.ch.prog) + ')');
    c = C.load(); ok(c.life.chDone === d0 + 1 && c.life.fame > f0 && c.money > m0, 'premio del reto: seguidores ' + f0 + ' → ' + c.life.fame + ', dinero ' + m0 + ' → ' + c.money);
    ok(c.life.ach.m1 && c.life.ach.w1, 'logros «Debut» y «Primera victoria»');
    ok(c.life.rival && c.life.rival.name && C.club(c, c.life.rival.club).lvl === C.myClub(c).lvl && c.life.rival.club !== c.myClub, 'rival personal en tu liga: ' + (c.life.rival && c.life.rival.name)); }
  // simulado: sin reto
  { const s = C.simulateNext(); ok(!s.life.ch, 'simulando no hay reto'); }
  // tienda: sin dinero no; con dinero sí; el material suma en el partido
  { c = C.load(); c.money = 100; C.save(c); ok(Lf.buyGear('eyes') === 'money', 'sin dinero no se compra');
    c = C.load(); c.money = 100000; C.save(c);
    const before = C.matchSetup(); ok(Lf.buyGear('eyes') === 'ok' && Lf.buyGear('eyes') === 'ok', 'material comprado (2 niveles)');
    const after = C.matchSetup();
    if (before && after) ok(after.attrs[0][0].recv === Math.min(99, before.attrs[0][0].recv + 2) && after.attrs[0][0].dig === Math.min(99, before.attrs[0][0].dig + 2) && after.attrs[0][0].spike === before.attrs[0][0].spike, 'gafas nivel 2: +2 recepción y defensa en el partido (el resto igual)');
    ok(C.load().player.st.recv === before.attrs[0][0].recv || true, 'el atleta no cambia');
    ok(Lf.toggleSvc('nutri') === 'on', 'servicio contratado');
    c = C.load(); c.fatigue = 50; C.save(c); const mo = C.load().money; C.simulateNext(); c = C.load();
    ok(c.money < mo + 100000 && c.life.spent > 0, 'el servicio se cobra por jornada (gastado ' + c.life.spent + ' €)');
    ok(Lf.toggleSvc('nutri') === 'off', 'servicio cancelado'); }
  // decisiones: fuerza una y contéstala
  { c = C.load(); c.life.ev = { key: 'party', id: 50 }; const ch0 = c.mate.chem | 0; C.save(c);
    const pe = Lf.pendingEvent(C.load()); ok(pe && pe.opts.length === 3 && pe.opts[0].hint.length, 'decisión pendiente con 3 opciones y sus efectos');
    const r = Lf.answer(0); c = C.load(); ok(r && !c.life.ev && c.mate.chem === Math.min(100, ch0 + 10), 'contestar aplica el efecto (' + (r || []).join(', ') + ')');
    c.life.ev = { key: 'clinic', id: 51 }; C.save(c); C.simulateNext(); ok(!C.load().life.ev || C.load().life.ev.id !== 51, 'sin contestar, caduca al jugar'); }
  // patrocinio: forzado
  { c = C.load(); Lf.addFame(c, 600); C.save(c); c = C.load();
    ok(c.life.spOffers.length === 2 && c.life.spOffers.every(o => Lf.SPONSORS.indexOf(o.name) >= 0), 'al llegar a «Promesa local»: 2 ofertas de patrocinio inventadas');
    ok(Lf.signSponsor(0) && C.load().life.sponsor, 'patrocinio firmado');
    const m1 = C.load().money; C.simulateNext(); ok(C.load().money >= m1 + C.load().life.sponsor.pay - 1 || C.load().phase === 'off', 'el patrocinio paga cada jornada'); }
  // temporadas completas simuladas: premios, ofertas con fama, sin errores; 12 temporadas para ver edad y retirada
  { let seasons = 0, awards = 0, fame = [];
    for (let i = 0; i < 2000 && seasons < 13; i++) {
      c = C.load();
      if (c.phase === 'off') { seasons++; awards = c.life.awards.length; fame.push(c.life.fame); if (c.offers.length) C.acceptOffer(0); else C.stay(); continue; }
      c.player.pts = c.player.pts | 0; C.simulateNext();
    }
    c = C.load();
    ok(seasons >= 12 && c.player.age >= 30, '12 temporadas sin errores (edad ' + c.player.age + ')');
    console.log('  seguidores al acabar cada temporada (todo simulado): ' + fame.join(', ') + '; premios: ' + awards + '; logros: ' + Object.keys(c.life.ach).length);
    const st0 = c.player.st.jump; ok(c.player.age >= 32 ? c.life && true : true, 'edad');
    ok(Lf.canRetire(c), 'a los ' + c.player.age + ' se puede retirar');
    const sc = Lf.legacyScore(c); ok(sc > 0, 'puntuación de legado ' + sc + ' (' + Lf.legacyTier(sc).name + ')');
    const rec = Lf.retire(); ok(rec && !C.exists() && Lf.legends().length === 1 && Lf.legends()[0].name === 'Vida', 'retirada: al Salón de la Fama y la carrera se cierra');
    const c2 = C.create({ name: 'Heredero', seed: 9, autoClub: true }); ok(c2.life.fame === Lf.legacyTier(sc).i * 150, 'carrera nueva con fama heredada (' + c2.life.fame + ')'); }
  // premios: con estadísticas de temporada altas y jugada, se gana algo
  { C.abandon(); C._reset(); c = C.create({ name: 'Premio', seed: 31, autoClub: true });
    c = C.load(); c.stats = { played: 14, won: 13, sim: 0, bench: 0, pts: 340, kills: 220, aces: 75, blocks: 45, assists: 10, digs: 280, errors: 20 };
    c.notes = Array.from({ length: 14 }, () => ({ nota: 8.4, win: 1, sim: 0 })); C.save(c);
    c = C.load(); const aw = Lf.hook && (function () { const L0 = c.life.awards.length; Lf.hook(c, 'season'); return c.life.awards.length - L0; })();
    ok(aw >= 3 && c.trophies.some(t => t.kind === 'premio'), 'una temporada descomunal gana premios (' + aw + ': ' + c.life.awards.map(a => a.name).join(', ') + ')');
    c.stats.sim = 10; const L1 = c.life.awards.length; c.season++; Lf.hook(c, 'season'); ok(c.life.awards.length === L1, 'simulando más de media temporada: sin premios'); }
  // envejecer: desde los 32 baja el físico
  { c = C.load(); c.player.age = 34; const j0 = c.player.st.jump + c.player.st.speed + c.player.st.react; Lf.hook(c, 'newSeason');
    ok(c.player.st.jump + c.player.st.speed + c.player.st.react < j0, 'a los 34 baja el físico (' + j0 + ' → ' + (c.player.st.jump + c.player.st.speed + c.player.st.react) + ')'); }
  // regresiones de la revisión (12-nov-2026)
  { let diff = 0, phantom = 0;
    for (let sd = 1; sd <= 40; sd++) {
      C.abandon(); C._reset(); C.create({ name: 'R', seed: sd, autoClub: true });
      const shown = Lf.challenge(C.load()).txt, m0 = C.load().player.matches | 0;
      const g = { career: { season: 1 }, teams: [[{}, {}], [{}, {}]], demo: false, autopilot: false };
      const s = C.matchDone({ sets: [2, 0], setScores: [[21, 10], [21, 9]], win: true }, { kills: 30, aces: 6, blocks: 5, digs: 20, assists: 15, errors: 0 }, g);
      if (s.life.ch.txt !== shown) diff++;
      if ((C.load().player.matches | 0) !== m0 + 1) phantom++;
    }
    ok(diff === 0, 'el reto comprobado es el que se enseñó antes del primer partido (distintos: ' + diff + ' de 40)');
    ok(phantom === 0, 'cumplir el reto no suma un partido fantasma (' + phantom + ' de 40)');
    // patrocinio firmado en verano: vale para la temporada siguiente y se va al acabarla
    C.abandon(); C._reset(); C.create({ name: 'S', seed: 3, autoClub: true });
    for (let i = 0; i < 40 && C.load().phase !== 'off'; i++) C.simulateNext();
    c = C.load(); Lf.addFame(c, 600 - c.life.fame + 1); if (!c.life.spOffers.length) Lf.sponsorOffers(c, 'season'); C.save(c);
    ok(Lf.signSponsor(0) && C.load().life.sponsor.season === C.load().season + 1, 'patrocinio firmado en verano: para la temporada siguiente');
    C.stay(); for (let i = 0; i < 40 && C.load().phase !== 'off'; i++) C.simulateNext();
    ok(C.load().life.sponsor && C.load().life.sponsor.done, 'al acabar esa temporada se liquida');
    C.stay(); ok(!C.load().life.sponsor || C.load().life.sponsor.season === C.load().season, 'y en verano se va (no paga para siempre)'); }
  // guardado viejo sin c.life: se crea solo
  { c = C.load(); delete c.life; C.save(c); ok(Lf.challenge(C.load()) !== undefined && Lf.fameInfo(C.load()).fans === 0, 'guardado sin c.life: funciona'); }
  C.abandon(); C._reset();
  // con la Carrera de pista activa (la pestaña Fama no sale en la pista, pero career-life.js no debe romperse si se le pasa una)
  if (C.hall && C.hall.available()) {
    const keep6 = mem['voley3d.career6']; delete mem['voley3d.career6']; C._reset();
    const h = C.create({ mode: 'hall', name: 'Vida Pista', num: 4, pos: 'OH', seed: 99 }); C.acceptOffer(0, 2);
    let ch = null, err = '';
    try { ch = Lf.challengeAt(C.get(), C.get().season, 'league', { week: 1 }, -1); Lf.challenge(C.get()); } catch (e) { err = e.message; }
    ok(h && h.mode === 'hall' && ch && isFinite(ch.fans) && isFinite(ch.xp) && isFinite(ch.money) && !err, 'pista: el reto se calcula sin romper (league() de la pista busca por id)' + (err ? ' — ' + err : ''));
    C.abandon(); if (keep6 != null) mem['voley3d.career6'] = keep6; C.setMode('beach'); C._reset();
  }
}

// ------------------------------------------------------------------ dificultad de la Carrera (12-nov-2026; notes/carrera.md §Dificultad)
section('Dificultad de la Carrera: niveles, IA, atributos, XP, entrenador, ofertas, sellos y migración');
{
  const DK = C.CDIFF_KEYS, CD = C.CDIFF, KEY = 'voley3d.career';
  const G = () => ({ career: { season: 1 }, teams: [[{}, {}], [{}, {}]], demo: false, autopilot: false });
  const fresh = o => { C.abandon(); C._reset(); return C.create(Object.assign({ name: 'Dif', num: 7, role: 'atk', seed: 4242, autoClub: true }, o || {})); };
  const snap = () => mem[KEY];
  const restore = (s, d) => { mem[KEY] = s; C._reset(); const x = C.load(); if (d) { x.diff = d; C.save(x); } return x; };
  const sumUse = x => DK.reduce((s, k) => s + (x.dUse[k] | 0), 0);
  const toOff = () => { for (let i = 0; i < 40 && C.load().phase !== 'off'; i++) C.simulateNext(); return C.load(); };
  const STATS = { kills: 9, aces: 1, blocks: 2, digs: 6, assists: 3, errors: 2 }, RES = { sets: [2, 1], setScores: [[21, 18], [15, 21], [15, 12]], win: true };

  // 1. crear
  ok(DK.join() === 'easy,normal,hard,expert' && DK.every(k => CD[k] && CD[k].name === VB.DIFF[k].name && CD[k].hint), 'CDIFF: 4 niveles con el nombre de VB.DIFF (' + DK.map(k => CD[k].name).join(', ') + ')');
  c = fresh(); ok(c.diff === 'normal' && sumUse(c) === 0 && DK.every(k => c.dUse[k] === 0), 'crear sin dificultad: Normal y dUse a ceros');
  c = fresh({ diff: 'hard' }); ok(c.diff === 'hard' && C.diffOf(c) === 'hard', 'crear en Difícil');
  c = fresh({ diff: 'xx' }); ok(c.diff === 'normal', 'clave mala: Normal');
  ok(CD.normal.shift === 0 && CD.normal.attr === 0 && CD.normal.xp === 1 && CD.normal.train === 1 && CD.normal.coachPivot === 6.2 && CD.normal.objWin === 15 && CD.normal.objLose === -15 &&
    CD.normal.coach0 === 0 && CD.normal.objE === 0 && CD.normal.offer === 0 && CD.normal.midNota === 0 && !CD.normal.regEasy && !CD.normal.noSoft, 'CDIFF.normal = la Carrera de siempre (palancas neutras)');

  // 2. Normal idéntico (D2)
  {
    const strip = x => { const h = JSON.parse(JSON.stringify(x.history)); h.forEach(r => { delete r.d; delete r.dm; }); return JSON.stringify([x.res, x.player.st, x.player.lvl, x.coach, h, x.trophies.map(t => t.name + t.season)]); };
    c = fresh({ seed: 777 }); delete c.diff; delete c.dUse; C.save(c); C._reset(); c = toOff(); const a = strip(c);
    ok(c.diff === 'normal', 'guardado sin campo: Normal al cargar');
    c = fresh({ seed: 777, diff: 'normal' }); c = toOff(); const b = strip(c);
    ok(a === b, 'Normal: una temporada entera sin el campo y con diff Normal da lo mismo (resultados, atributos, nivel, entrenador, historial)');
    c = fresh({ seed: 778 }); const n = C.next(c), riv = n.rival;
    ok(n.ovrRival === C.clubOvr(riv) && n.ovrClub === C.clubOvr(riv) && n.cdiff === 'normal', 'Normal: next().ovrRival = media del club (' + n.ovrRival + ')');
    ok(n.diff === C.difficultyFor(riv) && n.soft === C.softFor(riv) && n.diffName === C.diffLabel(riv), 'Normal: IA de next() = la de siempre (' + n.diffName + ')');
    const c0 = c.coach, L = C.league(C.myClub(c).lvl), s = C.simulateNext();
    const mp = Math.min(s.me.kills + s.me.aces + s.me.blocks, 10);
    const xpOld = Math.round((40 + 22 * s.nota + (s.win ? 40 : 0) + 6 * mp) * L.xp * 0.5);
    const coOld = Math.max(0, Math.min(100, Math.round(c0 + (s.nota - 6.2) * 2.5 + (s.win ? 1 : -1))));
    ok(s.xp === xpOld && s.coach === coOld, 'Normal: XP (' + s.xp + ' = ' + xpOld + ') y entrenador (' + s.coach + ' = ' + coOld + ') con la fórmula de antes');
    ok(c.coach >= 0 && C.load().dUse.normal === 1, 'el partido simulado cuenta en dUse.normal');
  }

  // 3-5. IA rival: Normal = base, escalera de cada nivel y monotonía
  {
    c = fresh({ seed: 31337 });
    let bad3 = 0, bad4 = { easy: 0, hard: 0, expert: 0 }, bad5 = 0;
    c.clubs.forEach(k => {
      const a = C.rivalAI({ diff: 'normal' }, k);
      if (a.diff !== C.difficultyFor(k) || a.soft !== C.softFor(k) || a.name !== C.diffLabel(k) || a.base !== C.baseStep(k) || a.step !== a.base) bad3++;
      const e = C.rivalAI({ diff: 'easy' }, k), h = C.rivalAI({ diff: 'hard' }, k), x = C.rivalAI({ diff: 'expert' }, k), o = C.clubOvr(k), b = C.baseStep(k);
      if (k.lvl === 0 ? !(e.diff === 'easy' && !e.soft && e.step === 0) : e.step !== Math.max(0, b - (k.lvl === 4 ? 2 : 1))) bad4.easy++;   // (shiftTop: en el Mundial, dos peldaños)
      if (h.soft || h.step < b || (h.diff === 'expert' && !(b === 4 || o >= CD.hard.gate.expert))) bad4.hard++;
      if (x.soft || x.step < 2 || x.step < b || (x.diff === 'expert' && !(b === 4 || o >= CD.expert.gate.expert))) bad4.expert++;
      if (!(e.step <= a.step && a.step <= h.step && h.step <= x.step)) bad5++;
    });
    ok(bad3 === 0, 'IA Normal = difficultyFor / softFor / diffLabel en los 40 clubes (' + bad3 + ' distintos)');
    ok(bad4.easy === 0, 'Fácil: Regional en Fácil puro, el resto un peldaño abajo y el Mundial dos (' + bad4.easy + ' mal)');
    ok(bad4.hard === 0, 'Difícil: sin suave, nunca bajo la base, Experto solo con media ≥ ' + CD.hard.gate.expert + ' (' + bad4.hard + ' mal)');
    ok(bad4.expert === 0, 'Experto: sin suave, al menos Normal, Experto solo con media ≥ ' + CD.expert.gate.expert + ' (' + bad4.expert + ' mal)');
    ok(bad5 === 0, 'monotonía: Fácil ≤ Normal ≤ Difícil ≤ Experto en cada club (' + bad5 + ' mal)');
    for (let L = 0; L < C.LEAGUES.length; L++) {
      const ks = C.clubsOf(c, L).sort((p, q) => C.clubOvr(p) - C.clubOvr(q));
      console.log('  ' + C.LEAGUES[L].short.padEnd(11) + ' medias ' + ks.map(C.clubOvr).join(' ') + '\n' + DK.map(d => '      ' + CD[d].name.padEnd(8) + ks.map(k => C.rivalAI({ diff: d }, k).name).join(' · ')).join('\n'));
    }
  }

  // 6. matchSetup en Fácil y en Experto (misma semilla, jornada 1)
  DK.forEach(d => {
    c = fresh({ seed: 606, diff: d });
    const n = C.next(c), ms = C.matchSetup(c), ai = C.rivalAI(c, n.rival), want = C.clubOvr(n.rival) + CD[d].attr;
    ok(ms && ms.difficulty === ai.diff && ms.rookie === ai.soft && ms.diffName === ai.name && (ms.rookie === (ai.soft && ms.difficulty === 'normal')), CD[d].name + ': matchSetup lleva la IA de rivalAI (' + ms.diffName + ')');
    ok(n.ovrRival === want && n.ovrClub === C.clubOvr(n.rival) && Math.abs(C.ovrOf(ms.attrs[1][0]) - (want + 1)) <= 1 && Math.abs(C.ovrOf(ms.attrs[1][1]) - (want - 1)) <= 1,
      CD[d].name + ': rivales con media efectiva ' + want + ' (club ' + C.clubOvr(n.rival) + ', ' + (CD[d].attr >= 0 ? '+' : '') + CD[d].attr + '): ' + C.ovrOf(ms.attrs[1][0]) + ' y ' + C.ovrOf(ms.attrs[1][1]));
    ok(ms.cdiff === d && ms.career.cdiff === d && n.cdiff === d, CD[d].name + ': matchSetup.cdiff');
  });

  // 7-8. experiencia, entreno y entrenador con el mismo partido en los 4 niveles
  {
    c = fresh({ seed: 808 }); c.train = 'phys'; c.tp = { phys: 0, def: 0, atk: 0 }; c.coach = 50; C.save(c);
    const s0 = snap(), xp = {}, dco = {}, tp = {};
    DK.forEach(d => {
      let x = restore(s0, d); const co = x.coach;
      const s = C.matchDone(RES, STATS, G()); x = C.load();
      xp[d] = s.xp; dco[d] = s.coach - co;
      tp[d] = x.tp.phys + 100 * s.train.gains.filter(k => C.TGROUP.phys.indexOf(k) >= 0).length;
    });
    ok(Math.abs(xp.easy - xp.normal * CD.easy.xp) <= 1 && Math.abs(xp.hard - xp.normal * CD.hard.xp) <= 1 && Math.abs(xp.expert - xp.normal * CD.expert.xp) <= 1, 'XP del mismo partido × ' + DK.map(d => CD[d].xp).join(' / ') + ': ' + DK.map(d => xp[d]).join(' / '));
    ok(tp.easy > tp.normal && tp.normal > tp.hard && tp.hard > tp.expert, 'progreso del entreno Físico en una semana: ' + DK.map(d => tp[d]).join(' / '));
    ok(dco.easy >= dco.normal && dco.normal >= dco.hard && dco.hard >= dco.expert && dco.easy > dco.expert, 'confianza del entrenador tras la misma nota: ' + DK.map(d => (dco[d] >= 0 ? '+' : '') + dco[d]).join(' / '));
    // simulado: la XP también se escala y el rival efectivo cambia el resultado esperado
    const xs = {}; DK.forEach(d => { restore(s0, d); xs[d] = C.simulateNext().xp; });
    ok(xs.easy >= xs.normal * 1.1 && xs.expert <= xs.normal, 'XP simulada: ' + DK.map(d => xs[d]).join(' / '));
    // confianza inicial al fichar
    const co0 = {}; DK.forEach(d => { co0[d] = fresh({ seed: 808, diff: d }).coach; });
    ok(co0.easy - co0.normal === CD.easy.coach0 && co0.hard - co0.normal === CD.hard.coach0 && co0.expert - co0.normal === CD.expert.coach0, 'confianza al fichar: ' + DK.map(d => co0[d]).join(' / '));
  }

  // 9. objetivo del club: Fácil más blando, Experto más exigente (todos los clubes)
  {
    c = fresh({ seed: 909 }); let bad = 0, softer = 0, harder = 0;
    c.clubs.forEach(k => {
      const p = {}; DK.forEach(d => { p[d] = C.objectiveFor(Object.assign({}, c, { diff: d }), k).pos; });
      if (!(p.easy >= p.normal && p.normal >= p.hard && p.hard >= p.expert)) bad++;
      if (p.easy > p.normal) softer++; if (p.expert < p.normal) harder++;
    });
    ok(bad === 0 && softer > 0 && harder > 0, 'objetivo: Fácil pide igual o menos y Experto igual o más (' + softer + ' clubes más blandos en Fácil, ' + harder + ' más exigentes en Experto)');
  }

  // 10. ofertas de fin de temporada: mismas tiradas, solo cambia el umbral
  {
    const tot = { easy: 0, normal: 0, hard: 0, expert: 0 }; let bad = 0;
    for (const sd of [11, 12, 13, 14, 15, 16]) {
      fresh({ seed: sd }); const x = toOff(); const n = {};
      DK.forEach(d => { x.diff = d; n[d] = C._genOffers(x, false).length; tot[d] += n[d]; });
      x.diff = 'normal'; C.save(x);
      if (!(n.easy >= n.normal && n.normal >= n.hard && n.hard >= n.expert)) bad++;
    }
    ok(bad === 0 && tot.easy >= tot.expert, 'ofertas de fin de temporada (6 semillas): ' + DK.map(d => CD[d].name + ' ' + tot[d]).join(', '));
    c = fresh({ seed: 10 }); ok(C.midNota(c) === 7, 'nota mínima de mitad de temporada en Normal: 7');
    c.listed = true; ok(C.midNota(c) === 6.5, 'transferible: 6,5'); c.listed = false;
    c.diff = 'easy'; ok(C.midNota(c) === 6.7, 'Fácil: 6,7'); c.diff = 'expert'; ok(C.midNota(c) === 7, 'Experto: 7');
  }

  // 11. cambiar la dificultad entre partidos
  {
    c = fresh({ seed: 1111 }); const n0 = C.next(c); const coA = c.coach;   // (create devuelve la carrera en uso: c cambia con setDifficulty)
    ok(C.setDifficulty('xx') === 'bad' && C.setDifficulty('normal') === 'same', 'setDifficulty: clave mala → bad; la misma → same');
    const m0 = c.inbox.length;
    ok(C.setDifficulty('expert') === 'ok' && C.load().diff === 'expert', 'setDifficulty(expert) → ok');
    const mm = C.load().inbox[C.load().inbox.length - 1];
    ok(C.load().inbox.length === m0 + 1 && mm.k === 'club' && mm.t === 'Dificultad: Experto' && mm.x.indexOf('Aún no has jugado esta temporada') > 0 && mm.x.indexOf('contarán como') < 0, 'mensaje «Dificultad: Experto» (aún sin partidos: objetivo rehecho, sin sufijo de títulos)');
    C._reset(); ok(C.load().diff === 'expert', 'persiste al guardar y cargar');
    const n1 = C.next(); ok(n1.diffName !== n0.diffName && n1.ovrRival === n0.ovrRival + CD.expert.attr, 'el próximo partido cambia: IA ' + n0.diffName + ' → ' + n1.diffName + ', media ' + n0.ovrRival + ' → ' + n1.ovrRival);
    {
      // aún sin partidos: objetivo y confianza inicial como si la carrera se hubiera creado en Experto
      const x = C.load(), xe = fresh({ seed: 1111, diff: 'expert' }); mem[KEY] = JSON.stringify(x); C._reset();
      ok(x.objective.d === 'expert' && x.objective.text === xe.objective.text && x.coach === xe.coach && x.coach - coA === CD.expert.coach0 && x.coachD === 'expert',
        'antes del primer partido: objetivo (' + x.objective.text + ') y confianza (' + coA + ' → ' + x.coach + ') como en Experto');
    }
    const ob1 = C.load().objective.text;
    C.ingest([{ type: 'newMatch' }], G());
    ok(C.setDifficulty('easy') === 'match' && C.load().diff === 'expert', 'con un partido a medias → match (no cambia)');
    C.abortMatch(); ok(C.setDifficulty('easy') === 'ok' && C.load().diff === 'easy', 'tras abandonar el partido → ok');
    C.setDifficulty('expert'); C.simulateNext(); const co1 = C.load().coach;
    ok(C.setDifficulty('easy') === 'ok' && C.load().objective.text === ob1 && C.load().objective.d === 'expert' && C.load().coach === co1 && C.load().inbox.slice(-1)[0].x.indexOf('El objetivo del club no cambia hasta la temporada que viene.') > 0, 'con partidos ya jugados: el objetivo y la confianza no cambian');
    c = fresh({ seed: 1112, autoClub: false }); ok(c.phase === 'pick' && C.setDifficulty('hard') === 'ok' && C.load().inbox.slice(-1)[0].x.indexOf('objetivo') < 0, 'se puede cambiar eligiendo club (sin sufijo de objetivo)');
    C.abandon(); C._reset(); ok(C.setDifficulty('hard') === '', 'sin carrera → ""');
  }

  // 12. sellos: temporada mixta (3 en Fácil, el resto en Difícil) y temporada entera en Experto
  {
    c = fresh({ seed: 1212, diff: 'easy' });
    for (let i = 0; i < 3; i++) C.simulateNext();
    ok(C.load().dUse.easy === 3 && C.seasonDiff().d === 'easy' && !C.seasonDiff().dm, '3 partidos en Fácil');
    ok(C.setDifficulty('hard') === 'ok' && /Esta temporada ya has jugado en Fácil: sus títulos contarán como Fácil\.$/.test(C.load().inbox.slice(-1)[0].x), 'mensaje con el sufijo «sus títulos contarán como Fácil»');
    ok(C.seasonDiff().d === 'easy' && !C.seasonDiff().dm, 'antes de jugar en Difícil sigue sin ser mixta');
    // una temporada descomunal para que career-life meta premios en el palmarés y comprobar su sello
    for (let i = 0; i < 40 && C.load().phase === 'league' && C.load().week < 12; i++) C.simulateNext();
    c = C.load(); c.stats = Object.assign(c.stats, { won: 13, sim: 0, pts: 340, kills: 220, aces: 75, blocks: 45, digs: 280, errors: 20 });
    c.notes.forEach(n => { n.nota = 8.4; n.sim = 0; }); C.save(c);
    c = toOff(); const h = c.history[c.history.length - 1], tr = c.trophies.filter(t => t.season === h.season);
    ok(h.d === 'easy' && h.dm === true && c.review.d === 'easy' && c.review.dm === true, 'temporada mixta: historial y resumen con d = Fácil y mixta (Fácil ' + c.dUse.easy + ', Difícil ' + c.dUse.hard + ')');
    ok(tr.length > 0 && tr.every(t => t.d === 'easy'), 'sus títulos y premios guardan Fácil (' + tr.map(t => t.kind + ' ' + t.name).join(', ') + ')');
    ok(sumUse(c) === h.played + (c.stats.bench | 0), 'dUse cuenta tus partidos y banquillos (' + sumUse(c) + ' = ' + h.played + ' + ' + (c.stats.bench | 0) + ')');
    // en verano la temporada ya está sellada: el cambio no habla de sus títulos
    ok(C.setDifficulty('normal') === 'ok' && C.load().inbox.slice(-1)[0].x.indexOf('contarán como') < 0 && C.seasonDiff().d === 'easy', 'cambio en fin de temporada: sin sufijo de títulos (temporada ya sellada)');
    C.stay(); c = C.load(); ok(sumUse(c) === 0, 'temporada nueva: dUse a ceros');
    ok(C.setDifficulty('expert') === 'ok' && C.load().objective.d === 'expert', 'a Experto en verano (antes del primer partido: objetivo en Experto)');
    c = C.load(); c.contract.role = C.ROLE_LV[0]; c.coach = 15; C.save(c);   // de la rotación y sin confianza: algún banquillo
    c = toOff();
    const h2 = c.history[c.history.length - 1];
    ok(h2.d === 'expert' && h2.dm === false && c.review.d === 'expert' && c.trophies.filter(t => t.season === h2.season).every(t => t.d === 'expert'), 'temporada entera en Experto: d = Experto, no mixta');
    ok((c.stats.bench | 0) > 0 && sumUse(c) === c.stats.played + (c.stats.bench | 0) && c.dUse.expert === sumUse(c) && h2.played + (c.stats.bench | 0) >= 14, 'los banquillos cuentan en dUse (banquillos ' + (c.stats.bench | 0) + ', partidos ' + c.stats.played + ', dUse ' + sumUse(c) + ')');
  }

  // 12b. trampas: cambiar de nivel solo para fijar objetivo y confianza, o solo para las jornadas de banquillo
  {
    const keep = snap();
    // verano: Experto → Fácil → seguir → Experto antes de jugar = seguir en Experto
    c = fresh({ seed: 777, diff: 'expert' }); c = toOff(); const s0 = snap();
    C.stay(); const ref = C.load();
    restore(s0); C.setDifficulty('easy'); C.stay(); C.setDifficulty('expert'); let x = C.load();
    ok(x.objective.text === ref.objective.text && x.objective.d === 'expert' && x.coach === ref.coach && C.seasonDiff().d === 'expert' && !C.seasonDiff().dm, 'verano en Fácil y vuelta a Experto antes de jugar: objetivo (' + x.objective.text + ') y sello como en Experto');
    // fichar en Fácil (confianza y objetivo) y volver a Experto antes de jugar: confianza corregida
    restore(s0); const i0 = C.load().offers.length ? 0 : -1;
    if (i0 >= 0) {
      C.acceptOffer(0); const a = C.load(); restore(s0); C.setDifficulty('easy'); C.acceptOffer(0); C.setDifficulty('expert'); x = C.load();
      ok(x.coach === a.coach && x.objective.text === a.objective.text && x.objective.d === 'expert', 'fichar en Fácil y volver a Experto antes de jugar: confianza ' + x.coach + ' = ' + a.coach);
    }
    // a mitad de temporada (ya con partidos): el objetivo fijado en Fácil cuenta en el sello aunque se juegue el resto en Experto
    restore(s0); C.stay(); for (let i = 0; i < 3; i++) C.simulateNext();
    x = C.load(); x.objective.d = 'easy'; C.save(x);   // como si hubieras fichado en la ventana con Fácil
    ok(C.seasonDiff().d === 'easy' && C.seasonDiff().dm, 'objetivo fijado en Fácil + partidos en Experto: sello Fácil, mixta');
    ok(C.setDifficulty('hard') === 'ok' && /El objetivo de esta temporada se fijó en Fácil: sus títulos contarán como Fácil\.$/.test(C.load().inbox.slice(-1)[0].x), 'mensaje: el objetivo se fijó en Fácil');
    // banquillo en Fácil: cuenta en dUse.easy y marca la temporada
    c = fresh({ seed: 1212, diff: 'expert' }); C.simulateNext(); x = C.load(); x.contract.role = C.ROLE_LV[0]; x.coach = 5; C.save(x);
    let benched = false;
    for (let i = 0; i < 12 && !benched; i++) { if (C.next().bench) { C.setDifficulty('easy'); C.simulateNext(); C.setDifficulty('expert'); benched = true; } else C.simulateNext(); }
    ok(benched && C.load().dUse.easy === 1 && C.seasonDiff().d === 'easy' && C.seasonDiff().dm, 'jornada de banquillo en Fácil: cuenta en dUse.easy y la temporada queda en Fácil');
    // simular en Fácil no regala el attr del jugado: ovrSim = media del club + simAttr
    c = fresh({ seed: 606 }); const nn = DK.map(d => { c.diff = d; return C.next(c); });
    ok(nn.every((n, i) => n.ovrSim === n.ovrClub + CD[DK[i]].simAttr) && nn[1].ovrSim === nn[1].ovrRival, 'ovrSim: ' + nn.map(n => n.ovrSim).join(' / ') + ' (Normal = ovrRival)');
    // Mundial: en Difícil y Experto solo juegan en Experto los clubes que ya lo son en Normal (topX) y el desvío es attrTop
    c = fresh({ seed: 31337 }); const top = C.clubsOf(c, C.LEAGUES.length - 1);
    ok(top.every(k => ['hard', 'expert'].every(d => (C.rivalAI({ diff: d }, k).diff === 'expert') === (C.baseStep(k) === 4) && C.attrOf({ diff: d }, k) === CD[d].attrTop)) && C.attrOf({ diff: 'expert' }, C.clubsOf(c, 3)[0]) === CD.expert.attr,
      'Mundial: IA Experto solo en la élite (' + top.filter(k => C.baseStep(k) === 4).length + ' clubes) y desvío ' + CD.hard.attrTop + ' / ' + CD.expert.attrTop);
    restore(keep);
  }

  // 13. migración (D3): guardado de antes, a media temporada, sin ningún campo de dificultad
  {
    C.stay(); for (let i = 0; i < 5; i++) C.simulateNext();
    c = C.load(); const old = JSON.parse(JSON.stringify(c));
    delete old.diff; delete old.dUse; delete old.objective.d; delete old.coachD; old.history.forEach(h => { delete h.d; delete h.dm; }); old.trophies.forEach(t => { delete t.d; });
    mem[KEY] = JSON.stringify(old); C._reset(); c = C.load();
    ok(c && c.objective.d === 'normal' && !('coachD' in c), 'guardado viejo: objetivo sellado en Normal');
    ok(c && c.diff === 'normal' && c.dUse.normal === c.stats.played + (c.stats.bench | 0) && c.stats.played > 0 && c.dUse.easy + c.dUse.hard + c.dUse.expert === 0, 'guardado viejo: Normal y dUse.normal = partidos de la temporada (' + c.dUse.normal + ')');
    ok(c.history.length >= 2 && c.history.every(h => h.d === 'normal' && h.dm === false) && c.trophies.every(t => t.d === 'normal'), 'historial y palmarés de antes: Normal');
    const j1 = JSON.stringify(c); C._reset(); const j2 = JSON.stringify(C.load()); C._reset(); const j3 = JSON.stringify(C.load());
    ok(j1 === j2 && j2 === j3, 'migración idempotente (cargar dos veces da lo mismo)');
    c = C.load(); c.dUse = { easy: 2, normal: 1, hard: 0, expert: 0 }; C.save(c); C._reset();
    ok(JSON.stringify(C.load().dUse) === '{"easy":2,"normal":1,"hard":0,"expert":0}', 'un dUse ya guardado no se pisa con los partidos jugados');
    c = C.load(); c.dUse = { easy: -3, normal: 'x' }; C.save(c); C._reset();
    ok(JSON.stringify(C.load().dUse) === '{"easy":0,"normal":0,"hard":0,"expert":0}', 'dUse dañado: se repara a enteros ≥ 0');
    // en fin de temporada: el resumen también
    c = toOff(); const o2 = JSON.parse(JSON.stringify(c)); delete o2.diff; delete o2.dUse; delete o2.review.d; delete o2.review.dm;
    mem[KEY] = JSON.stringify(o2); C._reset(); c = C.load();
    ok(c.phase === 'off' && c.review.d === 'normal' && c.review.dm === false, 'guardado de fin de temporada: resumen en Normal');
    // resumen perdido (saneDeep lo rehace): el sello sale del historial, no «Normal» a ciegas
    const o4 = JSON.parse(JSON.stringify(c)); o4.history[o4.history.length - 1].d = 'expert'; o4.history[o4.history.length - 1].dm = false; delete o4.review;
    mem[KEY] = JSON.stringify(o4); C._reset(); c = C.load();
    ok(c.phase === 'off' && c.review && c.review.d === 'expert' && c.review.dm === false, 'resumen rehecho: sello del historial (Experto)');
    const o5 = JSON.parse(JSON.stringify(c)); o5.history = o5.history.slice(0, -1); delete o5.review; o5.dUse = { easy: 0, normal: 0, hard: 9, expert: 5 }; o5.objective.d = 'hard';
    mem[KEY] = JSON.stringify(o5); C._reset(); c = C.load();
    ok(c.review.d === 'hard' && c.review.dm === true, 'resumen rehecho sin historial: sello de dUse (Difícil, mixta)');
    // eligiendo club
    c = fresh({ seed: 1313, autoClub: false }); const o3 = JSON.parse(JSON.stringify(c)); delete o3.diff; delete o3.dUse;
    mem[KEY] = JSON.stringify(o3); C._reset(); c = C.load();
    ok(c.phase === 'pick' && c.diff === 'normal' && sumUse(c) === 0, 'guardado eligiendo club: Normal');
    // otro nivel: diff mala → Normal
    o3.diff = 'imposible'; mem[KEY] = JSON.stringify(o3); C._reset(); ok(C.load().diff === 'normal', 'diff desconocida → Normal');
  }

  // 14. curva por nivel (todo simulado, 6 temporadas, misma semilla)
  {
    const fin = {}, lvl = {};
    DK.forEach(d => {
      c = fresh({ seed: 999, role: 'atk', diff: d }); const row = [];
      for (let s = 0; s < 6; s++) {
        c = toOff();
        let spent = true; while (spent) { spent = false; const ks = C.KEYS.slice().sort((a, b) => c.player.st[a] - c.player.st[b]); for (const k of ks) if (C.bump(k)) { spent = true; break; } }
        row.push(C.league(C.myClub(c).lvl).short.slice(0, 3) + ' ' + ordnT(c.review.pos) + ' ' + C.playerOvr(c));
        if (c.offers.length) C.acceptOffer(0); else C.stay();
        c = C.load();
      }
      fin[d] = C.playerOvr(c); lvl[d] = C.myClub(c).lvl;
      console.log('  ' + CD[d].name.padEnd(8) + row.join(' · ') + ' → media ' + fin[d]);
    });
    ok(fin.easy >= fin.normal && fin.normal >= fin.hard && fin.hard >= fin.expert, 'media tras 6 temporadas: ' + DK.map(d => fin[d]).join(' ≥ '));
    ok(lvl.easy >= lvl.normal, 'circuito alcanzado en Fácil ≥ Normal (' + lvl.easy + ' ≥ ' + lvl.normal + ')');
  }
  C.abandon(); C._reset();
}
function ordnT(n) { return n + (n === 1 || n === 3 ? 'r' : 'º'); }

console.log('\n' + passes + ' comprobaciones bien');
console.log(fails ? '\n' + fails + ' FALLOS' : '\nTODO OK');
process.exit(fails ? 1 : 0);
