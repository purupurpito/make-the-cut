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
let c = C.create({ name: 'Ferran Prueba', num: 14, role: 'cr', points: 15, seed: 12345, ctrl: 'both' });
ok(C.exists(), 'existe tras crear');
ok(c.ctrl === 'one', 'Carrera: siempre control «uno» aunque se pida «both»');
ok(c.points === 21 && C.PTS === 21 && C.PTS3 === 15 && C.VENUE === 'beach', 'vóley playa: sets a 21, el 3.º a 15, aunque se pidan 15 (' + c.points + ')');
ok(C.LEAGUES.every(L => /Circuito|Superliga/.test(L.name) && L.art && L.cup) && C.LEAGUES[0].name === 'Circuito Regional', 'circuitos de playa: ' + C.LEAGUES.map(L => L.name).join(', '));
ok(C.lname(C.LEAGUES[0]) === 'el Circuito Regional' && C.lname(C.LEAGUES[2]) === 'la Superliga de Playa' && C.toL(C.LEAGUES[1]) === 'al Circuito Nacional', 'artículos de los circuitos');
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
  ok(C.clubsOf(c, 2).every(k => !C.softFor(k) && C.difficultyFor(k) === (C.clubOvr(k) >= C.DIFF_AT[1][0] ? 'hard' : 'normal')), 'Superliga: Normal y Difícil desde ' + C.DIFF_AT[1][0]);
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
  ok(nm.join('|') === 'Circuito Regional|Open Nacional|Ascenso a la Superliga de Playa|Ascenso al Circuito Mundial|Superliga de Playa|Ascenso al Circuito Nacional', 'competiciones de pabellón → circuitos de playa (' + nm.join(', ') + ')');
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

console.log(fails ? '\n' + fails + ' FALLOS' : '\nTODO OK');
process.exit(fails ? 1 : 0);
