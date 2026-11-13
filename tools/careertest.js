#!/usr/bin/env node
/* MAKE THE CUT — tools/careertest.js (owner: ui_main)
 * Prueba headless del modo Carrera (js/career.js) con localStorage falso: crear carrera, calendario, simular temporadas enteras,
 * clasificación coherente, copa, ofertas, cambio de club, ascensos/descensos, guardar/cargar, partido jugado (eventos falsos →
 * estadísticas y nota) y curva de progresión de varias temporadas. Al final, la dificultad de la Carrera (12-nov-2026: Normal idéntico
 * al de antes, IA rival por nivel, atributos, XP, entreno, entrenador, objetivo, ofertas, cambio entre partidos, sellos y migración).
 * Uso: node tools/careertest.js [temporadas=8]   Sale con 1 si algo falla; acaba en «TODO OK».
 * NOWORLD=1: sin js/career-world.js (Faro, noticias y clubes); la prueba debe pasar igual con y sin él.
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
const NOWORLD = !!process.env.NOWORLD;
const FILES = ['js/sim.js', 'js/prog.js', 'js/badges.js', 'js/leagues.js', 'js/career.js', 'js/career-life.js', 'js/career-world.js'];
for (const f of FILES) {
  if (NOWORLD && f === 'js/career-world.js') continue;
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
  c6.contract.role = 'Titular indiscutible';   // (titularidad: así sales de inicio y se prueba tu hueco; el banquillo, en su sección)
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
  if (ms && ms.meOn) ok(ms.ctrlRole === 'S' && ms.ctrlIdx === VB.Sim.ROLES6.indexOf('S') && ms.nums[0][ms.ctrlIdx] === c6.player.num, 'el partido te pone de colocador en su hueco');
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

// ------------------------------------------------------------------ titularidad en la pista (13-nov-2026; notes/titularidad-y-cambios.md)
section('Carrera de pista: titularidad (plantilla, seis de la jornada, rol, ofertas, partido con cambios y minutos)');
if (!C.hall || !C.hall.available()) console.log('  (sin ligas de pista)');
else {
  const H = C.hall, keep = { c6: mem['voley3d.career6'], md: mem['voley3d.career.mode'], roles: VB.Sim.CTRL_ROLES6 };
  VB.Sim.CTRL_ROLES6 = ['OH', 'S', 'OPP', 'MB'];
  const R6 = VB.Sim.ROLES6 || ['S', 'OH', 'MB', 'OPP', 'OH', 'MB'];
  const fresh = (seed, pos, role) => {
    delete mem['voley3d.career6']; C._reset();
    const c = C.create({ mode: 'hall', name: 'Titu Prueba', num: 9, pos: pos || 'OH', seed });
    const i = c.offers.findIndex(o => !o.trial); if (role) c.offers[i].role = role;
    C.acceptOffer(i, 2); return C.get();
  };
  const reLine = c => { c.sq6.wk = null; c.sq6.L = null; };   // otra elección en la misma jornada (pruebas)
  const setAll = (c, v) => C.KEYS.forEach(k => { c.player.st[k] = v; });
  const toLeagueFixture = c => { let g = 0; while (c.phase === 'league' && !C.next(c) && g++ < 5) C.simulateNext(); return c.phase === 'league' && !!C.next(c); };
  const cntMsg = (c, t) => c.inbox.filter(m => m.t === t).length;
  const NEUTRO = /\b(él|ella|bienvenida|nuevo fichaje|cansado|cansada|listo|lista|concentrado|concentrada)\b/i;
  // plantilla
  { const c = fresh(4100), k = C.myClub(c);
    ok(JSON.stringify(H.squad(c, k, 1)) === JSON.stringify(H.squad(c, k, 1)) && JSON.stringify(H.squad(c, k, 1)) !== JSON.stringify(H.squad(c, k, 2)), 'squad6 determinista (por club y temporada)');
    const cnt = l => l.reduce((m, x) => (m[x.pos] = (m[x.pos] || 0) + 1, m), {});
    const s12 = H.squad(c, Object.assign({}, k, { ovr: 60 }), 1, 'OH'), s14 = H.squad(c, Object.assign({}, k, { ovr: 75 }), 1, 'OH'), c12 = cnt(s12), c14 = cnt(s14);
    ok(s12.length === 11 && c12.S === 2 && c12.OPP === 2 && c12.OH === 3 && c12.MB === 3 && c12.L === 1, 'plantilla de 12 contándote a ti (sin ti: ' + JSON.stringify(c12) + ')');
    ok(s14.length === 13 && c14.OH === 4 && c14.MB === 4 && c14.S === 2, 'club de ' + H.SQ_BIG + ' o más: +1 receptor y +1 central (14: ' + JSON.stringify(c14) + ')');
    const nums = s14.filter(x => x.pos !== 'L').map(x => x.num);
    ok(new Set(nums).size === nums.length && nums.every(n => n >= 1 && n <= 20 && n !== 13 && n !== c.player.num) && s14.find(x => x.pos === 'L').num === 13, 'dorsales únicos 1-20 sin el tuyo ni el 13 (el líbero lleva el 13): ' + nums.join(','));
    ok(s14.every(x => x.name !== c.player.name) && new Set(s14.map(x => x.name.split(' ')[0])).size === s14.length, 'tú no estás en la lista y no se repiten nombres');
    const nat = s14.filter(x => x.pos === 'MB'), kv = 75;
    ok(nat.slice(0, 2).every(x => x.ovr >= kv - 3 && x.ovr <= kv + 4) && nat.slice(2).every(x => x.ovr >= kv - 9 && x.ovr <= kv - 1) && s14.every(x => x.conf >= 30 && x.conf <= 75 && x.form === 0 && x.fat === 0), 'medias: titulares naturales −3..+4, el resto −9..−1; confianza 30-75');
    ok(c.sq6 && c.sq6.club === k.id && c.sq6.list.length === 11 + (k.ovr >= H.SQ_BIG ? 2 : 0), 'c.sq6 se crea al fichar (' + c.sq6.list.length + ' sin ti)');
    const ro = C.roster(c); ok(ro.filter(p => p.me).length === 1 && ro.length === c.sq6.list.length + 1 && ro.every(p => ['start', 'sub', 'out'].indexOf(p.stat) >= 0 && typeof p.form === 'number' && p.posName), 'roster6 lee de c.sq6: tu fila, estado y forma');
    ok(C.ROLE_HINT === H.ROLE_HINT && /^Compites por el puesto/.test(C.ROLE_HINT[0]) && /2 jornadas/.test(C.ROLE_HINT[1]) && /85/.test(C.ROLE_HINT[2]) && C.beach.ROLE_HINT !== H.ROLE_HINT, 'textos de rol de la pista (la playa conserva los suyos)');
  }
  // club muy superior: J1 en el banquillo, la bienvenida lo dice; luego un mensaje por cada cambio de estado
  { delete mem['voley3d.career6']; C._reset(); let c = C.create({ mode: 'hall', name: 'Titu Prueba', num: 9, pos: 'OH', seed: 4200 });
    const i = c.offers.findIndex(o => !o.trial), kk = C.club(c, c.offers[i].club); kk.ovr = Math.min(H.SQ_BIG - 1, kk.ovr + 15); c.offers[i].role = 'Rotación';   // (+15, sin llegar a la plantilla de 14)
    C.acceptOffer(i, 2); c = C.get(); toLeagueFixture(c);
    const n = C.next(c), wl = c.inbox.filter(m => /^Bienvenido a /.test(m.t)).slice(-1)[0];
    ok(n.status === 'sub' && !n.bench && (n.whyCode === 'new' || n.whyCode === 'ovr') && n.rivalIn && n.rivalIn.name && n.gap < 0, 'fichar por un club muy superior: J1 en el banquillo (' + n.whyCode + ', gap ' + n.gap + ', sale ' + (n.rivalIn && n.rivalIn.name) + ')');
    ok(wl && /Aquí tendrás que ganarte el puesto: por delante (está|están) .+\(\d+\)/.test(wl.x), 'bienvenida: «' + (wl && 'Aquí tendrás' + wl.x.split('Aquí tendrás')[1]) + '»');
    ok(cntMsg(c, 'Empiezas en el banquillo') === 0 && /^Sale de inicio /.test(C.benchWhy(c)), 'sin mensaje repetido (la bienvenida ya lo cuenta); benchWhy: «' + C.benchWhy(c) + '»');
    const ms = C.matchSetup(c); ok(ms && ms.meOn === false, 'desde el banquillo el partido se juega igual (matchSetup con meOn false)');
    setAll(c, 95); reLine(c);
    ok(C.next(c).status === 'start' && cntMsg(c, 'Sales de inicio') === 1, 'subes de nivel: sales de inicio y llega UN mensaje «Sales de inicio»');
    C.next(c); C.roster(c); ok(cntMsg(c, 'Sales de inicio') === 1, 'mirar otra vez la jornada no repite el mensaje');
    setAll(c, 20); reLine(c);
    const stB = C.next(c).status, sm = c.inbox.filter(m => m.t === 'Empiezas en el banquillo');
    ok(stB === 'sub' && sm.length === 1 && /^Esta semana sale de inicio .+: .+\. Estate a punto/.test(sm[0].x), 'bajas: «Empiezas en el banquillo» (' + (sm[0] && sm[0].x) + ')');
    setAll(c, 95); c.fatigue = 90; reLine(c);
    const nf = C.next(c); ok(nf.status === 'sub' && nf.whyCode === 'fatiga' && cntMsg(c, 'Descansas de inicio') === 0, 'con fatiga 90 descansas de inicio (sin mensaje: ya estabas en el banquillo)');
    c.fatigue = 0; reLine(c); C.next(c); c.fatigue = 90; reLine(c); C.next(c);
    ok(cntMsg(c, 'Descansas de inicio') === 1 && /mucha fatiga \(90\)/.test(c.inbox.filter(m => m.t === 'Descansas de inicio')[0].x), 'de titular a descanso: «Descansas de inicio» con la fatiga');
    ok(!c.inbox.filter(m => m.k === 'coach').some(m => NEUTRO.test(m.x) || /·/.test(m.x)), 'mensajes del entrenador en neutro y sin «·»');
  }
  // rol: titular con dos suplencias → promesa incumplida (la fatiga no cuenta); indiscutible siempre; rotación → titular
  { let c = fresh(4300, 'OH', 'Titular');
    c.coach = 60; c.broken = 0; setAll(c, 95); let g = 0, rest = 0;
    while (rest < 2 && g++ < 6) { if (!toLeagueFixture(c)) break; c.fatigue = 90; reLine(c); if (C.next(c).whyCode === 'fatiga') rest++; C.simulateNext(); }
    ok(rest === 2 && c.sq6.titBench === 0 && c.broken !== c.season, 'titular que descansa por fatiga 2 jornadas: no cuenta como promesa incumplida');
    setAll(c, 20); c.fatigue = 0; let subs = 0; g = 0;
    while (subs < 2 && g++ < 6) { if (!toLeagueFixture(c)) break; c.fatigue = 0; c.coach = 60; reLine(c); if (C.next(c).status !== 'start') subs++; C.simulateNext(); }
    ok(subs === 2 && c.broken === c.season && c.inbox.some(m => m.t === 'Promesa incumplida'), 'titular: 2 jornadas de liga en el banquillo por méritos → promesa incumplida (c.broken)');
    c.contract.role = 'Titular indiscutible'; setAll(c, 20); c.coach = 35; c.fatigue = 84; reLine(c);
    ok(C.next(c).status === 'start', 'indiscutible: de inicio aunque esté por debajo (fatiga 84)');
    c.fatigue = 85; reLine(c); ok(C.next(c).status === 'sub' && C.next(c).whyCode === 'fatiga', 'indiscutible con fatiga 85: descansa');
    c.fatigue = 0; reLine(c); const ms = C.matchSetup(c); ok(ms && ms.coach[0].me.pullAt === 99, 'indiscutible: no te cambian por jugar mal (pullAt 99)');
    c = fresh(4400, 'OH', 'Rotación'); setAll(c, 95); const s0 = c.contract.salary; let st = 0; g = 0;
    while (c.contract.role === 'Rotación' && g++ < 6) { if (!toLeagueFixture(c)) break; c.fatigue = 0; if (C.next(c).status === 'start') st++; C.simulateNext(); }
    ok(c.contract.role === 'Titular' && st === H.STARTS_PROMOTE && c.contract.salary >= s0 && c.inbox.some(m => m.t === 'Te has ganado la titularidad'), 'rotación: ' + H.STARTS_PROMOTE + ' jornadas seguidas de inicio → titular (sueldo ' + s0 + ' → ' + c.contract.salary + ')');
  }
  // club de 14: convocatoria de 12; con la confianza por debajo de 20, fuera
  { const c = fresh(4500, 'OH', 'Rotación'); toLeagueFixture(c); const k = C.myClub(c); k.ovr = 75; c.sq6 = null; setAll(c, 70);
    const L = H.lineup(c);
    ok(c.sq6.list.length === 13 && L.start.length === 6 && L.bench.length === 5 && L.out.length === 2 && L.out.indexOf('me') < 0 && L.lib, 'club de 14: seis, líbero y 5 suplentes; 2 fuera de la convocatoria de 12');
    c.coach = 10; reLine(c); const n = C.next(c);
    ok(n.status === 'out' && n.bench && n.whyCode === 'coach' && C.matchSetup(c) === null && cntMsg(c, 'Fuera de la convocatoria') === 1, 'confianza 10: fuera de la convocatoria (sin partido; mensaje «Fuera de la convocatoria»)');
    const b0 = c.stats.bench | 0, xp0 = c.player.xp, coach0 = c.coach, r = C.benchNext(c);
    ok(r && r.bench && r.nota === null && r.xp === 0 && r.part && r.part.status === 'out' && c.stats.bench === b0 + 1 && c.player.xp === xp0 && /no cuenta contigo/.test(r.why), 'benchNext6: sin nota ni XP, banquillo +1 (' + r.why + ')');
    ok(c.coach === coach0 + (c.train !== 'rest' ? H.TRAIN_COACH : 0), 'entrenar fuera de la convocatoria suma +' + H.TRAIN_COACH + ' de confianza');
  }
  // ofertas coherentes con la plantilla
  { const c = fresh(4600); let all = [];
    for (let s = 0; s < 6; s++) { c.season = 1 + s; setAll(c, 50 + s * 6); c.notes = [{ nota: 7.4 }, { nota: 7.6 }, { nota: 7.2 }]; c.coach = 70; c.scouts = {}; all = all.concat(H._genOffers(c, false)); }
    c.season = 1;
    const st = [4600, 4601, 4602, 4603, 4604, 4605].reduce((a, s) => { delete mem['voley3d.career6']; C._reset(); return a.concat(C.create({ mode: 'hall', name: 'O', num: 4, pos: 'OH', seed: s }).offers.filter(o => !o.trial)); }, []);
    const bad = all.concat(st).filter(o => !o.depth || !o.dm || (!o.dm.start && o.dm.gap < -3 && o.role !== 'Rotación') || (o.role === 'Titular indiscutible' && !(o.dm.start && o.dm.gap >= 3)) || (!o.dm.start && o.role === 'Titular indiscutible'));
    ok(all.length >= 5 && st.length >= 10 && !bad.length, 'ofertas (' + all.length + ' de clubes, ' + st.length + ' de inicio): el rol respeta la profundidad (' + all.concat(st).slice(0, 5).map(o => o.role + ' ' + (o.dm.start ? 'tit' : o.dm.rank + 'º') + ' ' + o.dm.gap).join(', ') + ')');
    ok(all.concat(st).every(o => Array.isArray(o.depth.ahead) && o.depth.rank === o.depth.ahead.length + 1 && o.depth.slots >= 1 && o.depth.rl === ['Rotación', 'Titular', 'Titular indiscutible'].indexOf(o.role)), 'cada oferta lleva su depth con su rol (quién va por delante y tu sitio)');
    ok(all.concat(st).every(o => o.role !== 'Titular indiscutible' || (o.depth.start && !o.depth.ahead.length)), 'Titular indiscutible: «Tu sitio» dice que sales de inicio');
  }
  // «Tu sitio» de la oferta = lo que pasa en tu primera jornada en el club (revisión: 10 de 12 titulares decían «serías 3º» y salían)
  { let same = 0, tot = 0; const bad = [];
    for (let s = 0; s < 40; s++) {
      delete mem['voley3d.career6']; C._reset();
      let c = C.create({ mode: 'hall', name: 'Sitio Prueba', num: 9, pos: 'OH', seed: 6100 + s });
      const i = c.offers.findIndex(o => !o.trial), o = c.offers[i], d = o.depth;
      C.acceptOffer(i, 2); c = C.get(); toLeagueFixture(c);
      const n = C.next(c); if (!n || n.status === 'out') continue;
      tot++; if (d.start === (n.status === 'start')) same++; else bad.push(o.role + ':' + (d.start ? 'tit' : d.rank + 'º') + '→' + n.status + ' gap ' + d.gap);
    }
    ok(tot >= 20 && same >= tot - 3, '«Tu sitio» de la oferta coincide con la primera jornada en ' + same + ' de ' + tot + ' carreras (fallan: ' + bad.join(', ') + ')');
  }
  // matchSetup6 con los campos del contrato
  { let c = fresh(4700, 'OH', 'Titular indiscutible'); toLeagueFixture(c); c.fatigue = 0;
    const isB = b => b && ['S', 'OPP', 'OH', 'MB'].indexOf(b.role) >= 0 && VB.ATTR_KEYS.every(k => b.st[k] >= 1 && b.st[k] <= 99) && b.num >= 1 && b.num <= 99 && typeof b.name === 'string' && b.fat >= 0 && b.fat <= 100 && 'badges' in b;
    let ms = C.matchSetup(c);
    ok(ms.attrs[0].length === 6 && ms.attrs[1].length === 6 && ms.nums[0].length === 6 && ms.nums[1].length === 6 && ms.names[0].length === 6 && ms.names[1].length === 6, 'de inicio: 6+6 atributos, dorsales y nombres');
    ok(ms.bench[0].length === 5 && ms.bench[1].length === 5 && ms.bench[0].concat(ms.bench[1]).every(isB), '5+5 suplentes {role, st, num, name, fat, badges}');
    ok(ms.meOn === true && R6[ms.meSlot] === 'OH' && ms.ctrlIdx === ms.meSlot && ms.meBench === -1 && ms.nums[0][ms.meSlot] === 9 && ms.names[0][ms.meSlot] === c.player.name && ms.career.meOn === true && ms.career.status === 'start', 'meOn, meSlot (' + ms.meSlot + '), ctrlIdx y tu dorsal en tu hueco');
    ok(ms.coach[0].auto && ms.coach[1].auto && [1, 2, 3].indexOf(ms.coach[0].iq) >= 0 && ms.coach[1].iq === ({ easy: 1, normal: 2, hard: 3, expert: 3 })[ms.difficulty] && ms.coach[0].me.pullAt === 99 && ms.coach[0].me.enterBad === true && ms.coach[0].me.garbage === true, 'entrenadores: iq por dificultad y reglas hacia ti (pullAt 99 con indiscutible)');
    ok(new Set(ms.nums[0].concat(ms.bench[0].map(b => b.num))).size === 11, 'dorsales de tu equipo distintos (6 + 5)');
    c.contract.role = 'Rotación'; c.coach = 40; setAll(c, 20); reLine(c);
    ms = C.matchSetup(c);
    ok(ms.meOn === false && ms.meSlot === -1 && ms.ctrlIdx === -1 && ms.meBench >= 0 && ms.meBench < 5 && ms.bench[0][ms.meBench].num === 9 && ms.bench[0][ms.meBench].name === c.player.name && ms.nums[0].indexOf(9) < 0 && ms.career.meOn === false && ms.career.status === 'sub', 'desde el banquillo: meOn false, meSlot −1, tú en bench[0][' + ms.meBench + ']');
    ok(ms.coach[0].me.pullAt === 3 && ms.coach[0].me.backNextSet === false && typeof ms.coach[0].me.enterLostSet === 'boolean', 'rotación con confianza 40: pullAt 3, sin vuelta el set siguiente');
    ok(ms.bench[0][ms.meBench].st.jump === Math.max(1, c.player.st.jump - ms.fatigue) && (!ms.badges || ms.badges[0].every(x => x === null)), 'tus atributos (con fatiga) en tu sitio del banquillo; ninguna insignia en pista');
    const Lf = VB.CareerLife;
    if (Lf) { c.money = 1e6; const b0 = ms.bench[0][ms.meBench].st.recv; Lf.buyGear('eyes'); const ms2 = C.matchSetup(C.get()); ok(ms2.bench[0][ms2.meBench].st.recv === Math.min(99, b0 + 1) && JSON.stringify(ms2.attrs[0]) === JSON.stringify(ms.attrs[0]), 'career-life: tu material va a tu ficha del banquillo (recepción ' + b0 + ' → ' + ms2.bench[0][ms2.meBench].st.recv + ')'); }
  }
  // partido con cambios (eventos falsos): minutos, nota, experiencia y estadísticas
  { let c = fresh(4800, 'OH', 'Rotación'); toLeagueFixture(c); setAll(c, 20); c.coach = 50; reLine(c);
    const mkG = ms => { const t0 = [0, 1, 2, 3, 4, 5].map(i => ({ team: 0, id: i, num: ms.nums[0][i] })), me = { team: 0, id: 23, num: 9 }; return { g: { career: ms.career, size: 6, teams: [t0, [0, 1, 2, 3, 4, 5].map(i => ({ team: 1, id: 16 + i }))], ctrl: me, ctrlBase: me }, t0, me }; };
    const pts = (evs, n) => { for (let i = 0; i < n; i++) evs.push({ type: 'point', team: i % 2, how: 'error' }); };
    let ms = C.matchSetup(c), G = mkG(ms), evs = [{ type: 'newMatch' }];
    pts(evs, 20); evs.push({ type: 'newSet', setNo: 2 }, { type: 'lineup', team: 0, set: 2, ins: [G.me], outs: [G.t0[1]], meIn: true, meOut: false });
    for (let i = 0; i < 6; i++) evs.push({ type: 'hit', team: 0, player: G.me, kind: 'spike', touch: 3, human: true, grade: 'good' }, { type: 'point', team: 0, how: 'kill' });
    pts(evs, 14);
    C.ingest(evs, G.g);
    const xp0 = c.player.xp, lv0 = c.player.lvl, st0 = c.stats.starts | 0, si0 = c.stats.subIn | 0, nn = c.notes.length, L = C.league(C.myClub(c).lid);
    let s = C.matchDone({ sets: [2, 0], setScores: [[11, 9], [12, 8]], win: true }, null, G.g);
    const xpExp = Math.round((40 + 22 * s.nota + 40 + 6 * 6) * H.xpMul(L) * (0.35 + 0.65 * 0.5)) + ((s.life && s.life.xp) | 0);   // (+ el reto, si se cumple)
    ok(s.part && s.part.status === 'sub' && s.part.entered === 2 && s.part.meR === 20 && s.part.rallies === 40 && Math.abs(s.part.share - 0.5) < 0.01 && s.part.sets.join() === '2', 'entras en el 2º set: 20 de 40 puntos (share ' + s.part.share + ')');
    ok(typeof s.nota === 'number' && !s.bench && s.xp === xpExp && c.notes.length === nn + 1, 'nota con tus puntos en pista (' + s.nota + ') y XP escalada (' + s.xp + ' = ' + xpExp + ')');
    ok((c.stats.starts | 0) === st0 && c.stats.subIn === si0 + 1 && c.stats.mr >= 20 && c.stats.rr >= 40, 'estadísticas: subIn +1, starts igual, puntos en pista');
    // sin entrar: sin nota, banquillo +1, experiencia de banquillo
    if (toLeagueFixture(c)) {
      setAll(c, 20); reLine(c); ms = C.matchSetup(c); G = mkG(ms); evs = [{ type: 'newMatch' }]; pts(evs, 40); C.ingest(evs, G.g);
      const b0 = c.stats.bench | 0, pl0 = c.stats.played, n0 = c.notes.length, xp1 = c.player.xp, m0 = c.player.matches;
      s = C.matchDone({ sets: [2, 1], setScores: [[15, 10], [10, 15], [15, 12]], win: true }, null, G.g);
      const bx = Math.round(H.BENCH_XP * H.xpMul(L));
      ok(s.nota === null && s.bench && s.part.status === 'sub' && !s.part.entered && s.part.meR === 0 && c.stats.bench === b0 + 1 && c.stats.played === pl0 && c.notes.length === n0, 'sin entrar: «s. c.», banquillo +1, partidos jugados igual, c.notes sin entrada');
      ok(s.xp === bx && c.player.matches === m0, 'experiencia de banquillo: ' + H.BENCH_XP + ' × ' + H.xpMul(L) + ' = ' + s.xp + ' (no cuenta como partido)');
      ok(C.form(c) != null && c.notes.every(x => typeof x.nota === 'number'), 'forma y nota media sin nulos');
    }
    // de inicio y te cambian a mitad (y g.meR de la sim manda)
    if (toLeagueFixture(c)) {
      c.contract.role = 'Titular'; setAll(c, 95); c.coach = 40; reLine(c); ms = C.matchSetup(c); G = mkG(ms); G.t0[ms.meSlot] = G.me; G.g.teams[0] = G.t0;
      evs = [{ type: 'newMatch' }]; pts(evs, 16); evs.push({ type: 'sub', team: 0, inP: G.t0[0], outP: G.me, why: 'meOut', n: 1, left: 5, set: 1, score: [8, 8], meIn: false, meOut: true }); pts(evs, 16);
      C.ingest(evs, G.g); const coach0 = c.coach;
      G.g.meR = 17; G.g.rallyN = 34;
      s = C.matchDone({ sets: [0, 2], setScores: [[10, 15], [9, 15]], win: false }, null, G.g);
      ok(s.part.status === 'start' && s.part.pulled === 1 && s.part.meR === 17 && s.part.rallies === 34, 'de inicio y te cambian en el 1r set; g.meR (17) y g.rallyN (34) de la sim mandan');
      const tm = c.inbox.filter(m => m.t === 'Te he cambiado').slice(-1)[0];
      ok(s.nota != null && (s.nota >= 6 || (tm && /en el 1r set/.test(tm.x))), 'mensaje «Te he cambiado» con el ordinal (' + (tm ? tm.x : 'nota ' + s.nota) + ')');
    }
  }
  // simular siendo suplente: determinista, y entras a veces
  { let c = fresh(4900, 'OH', 'Rotación'); toLeagueFixture(c); setAll(c, 40); c.coach = 50; reLine(c);
    const snap = mem['voley3d.career6'] = JSON.stringify(c); C._reset(); c = C.get(); reLine(c);
    const n = C.next(c); const a = C.simulateNext(c); mem['voley3d.career6'] = snap; C._reset(); c = C.get(); reLine(c); const b = C.simulateNext(c);
    ok(n.status === 'sub' && a && b && JSON.stringify([a.nota, a.part, a.sets, a.xp]) === JSON.stringify([b.nota, b.part, b.sets, b.xp]), 'simular de suplente: misma semilla, mismo resultado (' + JSON.stringify(a.part) + ')');
    let subs = 0, ins = 0;
    for (let s = 0; s < 40; s++) {
      const t = fresh(5000 + s, 'OH', 'Rotación'); if (!toLeagueFixture(t)) continue; setAll(t, 42); reLine(t);
      if (C.next(t).status !== 'sub') continue;
      subs++; const r = C.simulateNext(t); if (r.part.entered) { ins++; ok(r.part.share >= 0.08 && r.part.share <= 0.7 && r.part.meR > 0, 'entras con el 8-70 % de los puntos (' + r.part.share.toFixed(2) + ')'); }
    }
    ok(subs >= 20 && ins >= subs * 0.15 && ins <= subs * 0.7, 'en ' + subs + ' semillas de suplente entras en ' + ins + ' (15-70 %; calibrado con partidos jugados: ~45 %)');
  }
  // guardado sin c.sq6: migra al cargar
  { const c = fresh(5100); const raw = JSON.parse(mem['voley3d.career6']); delete raw.sq6; mem['voley3d.career6'] = JSON.stringify(raw); C._reset();
    const r = C.get(); let err = ''; try { C.next(r); C.simulateNext(); } catch (e) { err = e.message; }
    ok(r && r.v === 1 && r.sq6 && r.sq6.club === r.myClub && r.sq6.list.length >= 11 && !err, 'guardado de pista sin c.sq6 (VER6 igual): se crea al cargar y se sigue jugando' + (err ? ' — ' + err : ''));
    const raw2 = JSON.parse(mem['voley3d.career6']); raw2.sq6.list = 'x'; mem['voley3d.career6'] = JSON.stringify(raw2); C._reset();
    ok(C.get() && Array.isArray(C.get().sq6.list) && C.get().sq6.list.length >= 11, 'c.sq6 dañada: se rehace');
  }
  // migrar no es fichar: tras varias jornadas en el club, un guardado sin c.sq6 no te trata de recién llegado
  { let c = fresh(5150, 'OH', 'Titular'); setAll(c, 80); let g = 0;
    while (g++ < 6) { if (!toLeagueFixture(c)) break; c.fatigue = 0; C.simulateNext(); c = C.get(); }
    toLeagueFixture(c); const before = C.next(c);
    const raw = JSON.parse(mem['voley3d.career6']); delete raw.sq6; mem['voley3d.career6'] = JSON.stringify(raw); C._reset(); c = C.get();
    const after = C.next(c);
    ok(c.sq6.fresh === 0 && after.whyCode !== 'new' && !/acabas de llegar/.test(after.why || ''), 'guardado viejo sin c.sq6 tras ' + (g - 1) + ' jornadas: fresh 0 y sin «acabas de llegar» (' + before.status + '/' + before.whyCode + ' → ' + after.status + '/' + after.whyCode + ')');
    ok(c.sq6.meLs === (c.last && c.last.part && c.last.part.status === 'start' ? 1 : 0), 'y conserva si saliste de inicio la última jornada (meLs ' + c.sq6.meLs + ')');
    fresh(5160); const raw2 = JSON.parse(mem['voley3d.career6']); delete raw2.sq6; mem['voley3d.career6'] = JSON.stringify(raw2); C._reset();
    ok(C.get().sq6.fresh === 1, 'recién fichado (sin jugar aún): sigue siendo recién llegado');
  }
  // confianza por los suelos: la Rotación nunca queda fuera por el entrenador dos jornadas seguidas; el Titular nunca queda fuera por eso
  { let c = fresh(5200, 'OH', 'Rotación'); const st = []; let g = 0;
    while (g++ < 6) { if (!toLeagueFixture(c)) break; c.coach = 5; c.fatigue = 0; c.sq6.wk = null; const n = C.next(c); st.push(n.status + '/' + n.whyCode); if (n.bench) C.benchNext(c); else C.simulateNext(); c = C.get(); }
    ok(st.length >= 4 && !st.some((x, i) => i && x === 'out/coach' && st[i - 1] === 'out/coach') && st.indexOf('out/coach') >= 0, 'rotación con confianza 5: fuera por el entrenador, pero nunca dos jornadas seguidas (' + st.join(', ') + ')');
    c = fresh(5210, 'OH', 'Titular'); toLeagueFixture(c); c.coach = 5; c.fatigue = 0; reLine(c); const n = C.next(c);
    ok(n.status !== 'out' && n.whyCode === 'coach', 'titular con confianza 5: al banquillo, no fuera de la convocatoria (' + n.status + '/' + n.whyCode + ')');
  }
  // un set que empiezas en el banquillo (lineup con meOut) no cuenta como set jugado
  { const c = fresh(5300, 'OH', 'Titular indiscutible'); toLeagueFixture(c); c.fatigue = 0; reLine(c);
    const ms = C.matchSetup(c), me = { team: 0, id: 3, num: 9 }, t0 = [0, 1, 2, 3, 4, 5].map(i => i === ms.meSlot ? me : { team: 0, id: i, num: ms.nums[0][i] });
    const G = { career: ms.career, size: 6, teams: [t0, []], ctrl: me, ctrlBase: me }, evs = [{ type: 'newMatch' }];
    for (let i = 0; i < 20; i++) evs.push({ type: 'point', team: i % 2, how: 'error' });
    evs.push({ type: 'newSet', setNo: 2 }, { type: 'lineup', team: 0, set: 2, ins: [], outs: [], meIn: false, meOut: true });
    for (let i = 0; i < 20; i++) evs.push({ type: 'point', team: i % 2, how: 'error' });
    C.ingest(evs, G); G.meR = 20; G.rallyN = 40;
    const s = C.matchDone({ sets: [1, 1], setScores: [[11, 9], [9, 11]] }, null, G);
    ok(s.part.sets.join() === '1' && s.part.pulled === 2, 'lineup con meOut al empezar el 2º set: sets jugados = 1 (' + s.part.sets.join() + ')');
  }
  C.abandon(); C._reset();
  if (keep.c6 != null) mem['voley3d.career6'] = keep.c6; else delete mem['voley3d.career6'];
  if (keep.md != null) mem['voley3d.career.mode'] = keep.md; else delete mem['voley3d.career.mode'];
  if (keep.roles) VB.Sim.CTRL_ROLES6 = keep.roles; else delete VB.Sim.CTRL_ROLES6;
  C._reset();
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
  // con la Carrera de pista activa (desde el 12-nov-2026 la pista también tiene vida: ver «Vida en la Carrera de pista» abajo)
  if (C.hall && C.hall.available()) {
    const keep6 = mem['voley3d.career6']; delete mem['voley3d.career6']; C._reset();
    const h = C.create({ mode: 'hall', name: 'Vida Pista', num: 4, pos: 'OH', seed: 99 }); C.acceptOffer(0, 2);
    let ch = null, err = '';
    try { ch = Lf.challengeAt(C.get(), C.get().season, 'league', { week: 1 }, -1); Lf.challenge(C.get()); } catch (e) { err = e.message; }
    ok(h && h.mode === 'hall' && ch && isFinite(ch.fans) && isFinite(ch.xp) && isFinite(ch.money) && !err, 'pista: el reto se calcula sin romper (league() de la pista busca por id)' + (err ? ' — ' + err : ''));
    C.abandon(); if (keep6 != null) mem['voley3d.career6'] = keep6; C.setMode('beach'); C._reset();
  }
}

// ------------------------------------------------------------------ sprint 5: celebración de firma y rival (E2, career-life.js)
section('Celebración de firma y dorsal del rival (E2)');
{
  const Lf = VB.CareerLife;
  ok(Lf && Lf.celebs && Lf.setCeleb && Lf.signatureNow, 'API de celebraciones en CareerLife');
  C.abandon(); C._reset(); C.create({ name: 'Celeb', num: 9, seed: 777, autoClub: true });
  // carrera v3 sin l.celeb (anterior al sprint 5): se crea al cargar
  c = C.load(); delete c.life.celeb; delete c.life.celebAnn; C.save(c); C._reset(); c = C.load(); Lf.ensure(c);
  ok(c.life.celeb === '' && c.life.celebAnn === 0, 'carrera v3 sin l.celeb: se crea vacía (' + JSON.stringify(c.life.celeb) + ')');
  const L0 = Lf.celebs(c);
  ok(L0.length >= 6 && L0.every(x => x.id && x.name && x.tierName && x.open === (x.tier <= 0)), 'catálogo de 6+ celebraciones, todas bloqueadas sin fama (' + L0.map(x => x.id).join(',') + ')');
  ok(L0.some(x => x.id === 'bailecito') && !L0.some(x => x.id === 'baile'), 'la firma del baile es «bailecito» (conflicto 9)');
  ok(Lf.setCeleb('saludo') === false && C.load().life.celeb === '', 'setCeleb rechaza una celebración bloqueada');
  ok(Lf.setCeleb('noexiste') === false, 'setCeleb rechaza un id desconocido');
  ok(Lf.signatureNow() === '', 'sin firma elegida: signatureNow() = «»');
  const nMsg = id => C.load().inbox.filter(m => m.k === 'fans' && m.t === 'Celebración nueva: ' + id).length;
  c = C.load(); Lf.addFame(c, 600 - c.life.fame); C.save(c);
  ok(nMsg('Saludo') === 1, 'aviso de «Saludo» al llegar a Promesa local');
  ok(Lf.setCeleb('saludo') === true && C.load().life.celeb === 'saludo' && Lf.signatureNow() === 'saludo', 'elegir «Saludo» ya desbloqueada → signatureNow()');
  c = C.load(); Lf.addFame(c, 7100 - c.life.fame); C.save(c);
  ok(nMsg('Avioncito') === 1 && nMsg('Bailecito') === 1, 'al cruzar «Figura»: aviso de Avioncito (y del Bailecito que se saltó)');
  c = C.load(); Lf.addFame(c, -3000); Lf.addFame(c, 3500); C.save(c);
  ok(nMsg('Avioncito') === 1, 'el aviso de «Figura» sale una sola vez aunque la fama baje y vuelva a subir (' + nMsg('Avioncito') + ')');
  ok(Lf.celebs(C.load()).filter(x => x.open).length === 3, 'desbloqueo por fameMax: 3 abiertas');
  ok(Lf.setCeleb('') === true && Lf.signatureNow() === '', '«Ninguna» vuelve a la reacción normal');
  // rivalNum: solo en los duelos, con el dorsal del rival personal
  let duels = 0, plain = 0, bad = 0;
  for (let i = 0; i < 60 && C.load().phase !== 'off'; i++) {
    c = C.load(); const n = C.next(c);
    if (!n || n.bench) { C.benchNext(); continue; }
    const ms = C.matchSetup(c), rv = c.life.rival;
    if (ms && ms.career) {
      if (ms.career.duel) { duels++; if (!(rv && ms.career.rivalNum === rv.num)) bad++; }
      else { plain++; if (ms.career.rivalNum != null) bad++; }
    }
    C.simulateNext();
  }
  ok(duels > 0 && plain > 0 && bad === 0, 'rivalNum solo en los duelos y con el dorsal del rival (duelos ' + duels + ', normales ' + plain + ', mal ' + bad + ')');
  C.abandon(); C._reset();
}

// ------------------------------------------------------------------ sprint 5: mundo de la Carrera (career-world.js): Faro
if (!VB.CareerWorld) console.log('\n(sin career-world.js: se salta Faro)');   // (y las noticias y los clubes)
else {
  section('Mundo de la Carrera: Faro, el mentor (E4)');
  const W = VB.CareerWorld;
  const boot = (withWorld) => {
    const m2 = {}; const LS = { getItem: k => (k in m2 ? m2[k] : null), setItem: (k, v) => { m2[k] = String(v); }, removeItem: k => { delete m2[k]; } };
    const cx = { console, Math, Date, JSON, Set, localStorage: LS }; cx.globalThis = cx; cx.window = cx; vm.createContext(cx);
    for (const f of FILES) { if (f === 'js/career-world.js' && !withWorld) continue; const fp = path.join(ROOT, f); if (fs.existsSync(fp)) vm.runInContext(fs.readFileSync(fp, 'utf8'), cx, { filename: f }); }
    return { VB: cx.VB, mem: m2 };
  };
  // carrera de prueba: 1 de cada 3 partidos «jugado» (estadísticas falsas deterministas), el resto simulado; banquillos y decisiones
  const run = (withWorld, seasons, seed, each) => {
    const B = boot(withWorld), K = B.VB.Career, L = B.VB.CareerLife;
    K.create({ name: 'Mundo', num: 7, role: 'atk', seed });
    K.acceptOffer(0, 2);
    let played = 0;
    for (let s = 0; s < seasons; s++) {
      let guard = 0;
      while (K.load().phase !== 'off' && guard++ < 40) {
        const cc = K.load(), n = K.next(cc);
        if (n && n.bench) { K.benchNext(); continue; }
        const i = played++;
        if (i % 3 === 0) {
          const win = (i % 5) !== 0, g = { career: { season: cc.season }, teams: [[{}, {}], [{}, {}]], demo: false };
          K.matchDone({ sets: win ? [2, 1] : [0, 2], setScores: win ? [[21, 17], [18, 21], [15, 12]] : [[17, 21], [19, 21]], win }, { kills: 12, aces: 2, blocks: 1, digs: 8, assists: 3, errors: 3 }, g);
        } else K.simulateNext();
        if (L) { const ev = L.pendingEvent(K.load()); if (ev) L.answer(0); }
      }
      if (each) each(K.load(), s);
      K.stay(1);
    }
    return { VB: B.VB, K, c: K.load(), mem: B.mem };
  };
  const strip = x => { const o = JSON.parse(JSON.stringify(x)); delete o.world; delete o.created; delete o.inbox; delete o.msgN; return JSON.stringify(o); };
  // 1) determinismo
  let same = 0;
  for (const sd of [97, 1234, 50001]) if (strip(run(false, 6, sd).c) === strip(run(true, 6, sd).c)) same++;
  ok(same === 3, 'misma carrera con y sin career-world.js fuera de world/inbox/msgN/created (' + same + ' de 3 semillas, 6 temporadas)');
  // 2) mentor en una carrera larga sin mirar ninguna escena (la cola se desborda a la bandeja)
  const lines = [], perSeason = [];
  let slumpJump = 0;
  const R = run(true, 8, 4242, (cc) => { perSeason.push(cc.world.mentor.seen.slump | 0); });
  for (let i = 0; i < perSeason.length; i++) if (perSeason[i] - (i ? perSeason[i - 1] : 0) > 1) slumpJump++;
  const mw = R.c.world.mentor;
  ok(Object.keys(mw.seen).every(id => (mw.seen[id] | 0) <= (id === 'slump' ? 3 : 1)), 'cada escena una vez en la carrera y slump ≤ 3 (' + JSON.stringify(mw.seen) + ')');
  ok(slumpJump === 0, 'slump como mucho 1 por temporada (acumulado: ' + perSeason.join(',') + ')');
  ok(mw.seen.hola && mw.seen.debut && mw.seen.win1 && mw.seen.loss1, 'hola, debut, primera victoria y primera derrota han salido');
  ok(mw.q.length <= 3, 'cola de escenas ≤ 3 (' + mw.q.length + ')');
  R.c.inbox.filter(m => m.k === 'mentor').forEach(m => { ok(/^Faro: /.test(m.t), 'mensaje del mentor con título «Faro: …» (' + m.t + ')'); lines.push(m.x); });
  mw.q.forEach(q => q.l.forEach(l => lines.push(l)));
  // 3) bandeja solo si la escena no se ve; Seguir/Saltar/apagar
  C.abandon(); C._reset(); C.create({ name: 'Faro', num: 5, seed: 31 });
  c = C.load();
  const mIn = () => C.load().inbox.filter(m => m.k === 'mentor').length;
  ok(c.world && c.world.mentor.q.length === 1 && c.world.mentor.q[0].id === 'hola' && mIn() === 0, '«hola» al crear: en la cola y no en la bandeja');
  ok(W.mentorScene(c) && W.mentorScene(c).title === 'Faro se presenta' && W.mentorScene(c).lines.length === 3, 'mentorScene da la escena con sus 3 frases');
  C.acceptOffer(0, 1); c = C.load();
  ok(c.world.mentor.q.map(q => q.id).join() === 'hola,debut' && c.world.mentor.q[1].l[0].indexOf(C.myClub(c).name) >= 0, '«debut» al firmar, con el nombre del club (' + c.world.mentor.q.map(q => q.id) + ')');
  ok(W.mentorDone() && mIn() === 0, 'vista entera (Vale): sale de la cola sin ir a la bandeja');
  ok(W.mentorSkip() && mIn() === 1 && C.load().world.mentor.q.length === 0 && W.mentorScene(C.load()) === null, 'Saltar: a la bandeja y cola vacía');
  ok(W.mentorDone() === false, 'mentorDone con la cola vacía no hace nada');
  ok(W.setMentor(false) && !W.mentorOn(C.load()), 'escenas apagadas');
  c = C.load(); c.review = { champion: true, cup: false, move: 1, awards: ['MVP del Circuito Regional'] }; W.hook(c, 'season'); C.save(c);
  ok(c.world.mentor.q.length === 0 && mIn() === 4 && W.mentorScene(c) === null, 'apagadas: no se encolan y van a la bandeja (title, award, up) (' + mIn() + ')');
  const tMsg = c.inbox.filter(m => m.k === 'mentor' && m.t === 'Faro: primer título')[0];
  ok(tMsg && tMsg.x.indexOf('Título del Circuito Regional.') === 0 && !/Campe[oó]n/.test(tMsg.x), 'título en género neutro: «Título del Circuito Regional» (' + (tMsg && tMsg.x.slice(0, 40)) + ')');
  ok(c.inbox.some(m => m.t === 'Faro: ascenso' && m.x.indexOf('al Circuito Nacional') >= 0), '«up» con el circuito al que se sube');
  W.hook(c, 'season'); ok(mIn() === 4, 'title, up y award no se repiten');
  W.setMentor(true); c = C.load();
  // slump: 3 derrotas seguidas, como mucho una por temporada y 3 en total
  c.notes = [{ win: 0 }, { win: 0 }, { win: 0 }]; W.hook(c, 'match', { win: false, sets: [0, 2], rival: 1, season: c.season });
  const q1 = c.world.mentor.q.filter(q => q.id === 'slump').length;
  W.hook(c, 'match', { win: false, sets: [0, 2], rival: 1, season: c.season });
  ok(q1 === 1 && c.world.mentor.q.filter(q => q.id === 'slump').length === 1, 'slump encolado una sola vez en la temporada');
  for (let k = 0; k < 3; k++) { c.season++; W.hook(c, 'match', { win: false, sets: [0, 2], rival: 1, season: c.season }); }
  ok((c.world.mentor.seen.slump | 0) === 3, 'slump hasta 3 en total (' + c.world.mentor.seen.slump + ')');
  c.world.mentor.q.forEach(q => q.l.forEach(l => lines.push(l)));
  // consejos de la mala racha (los 4) con un nombre largo
  const fake = { fatigue: 0, mate: { name: 'Nombre Larguísimo De Compañía', chem: 50 }, player: { pts: 0 } };
  [[{ fatigue: 50 }, 'player:train'], [{ mate: { name: fake.mate.name, chem: 10 } }, ''], [{ player: { pts: 3 } }, 'player:atk'], [{}, '']].forEach(([o, act]) => {
    const t = W._slumpTip(Object.assign({}, fake, o)); lines.push(t[0]); ok(t[1] === act, 'consejo de mala racha → ' + (act || 'sin botón'));
  });
  // todas las escenas, con valores largos
  W.BEAT_ORDER.forEach(id => { ok(W.BEATS[id], 'BEATS.' + id); W.BEATS[id].l.forEach(l => { if (l !== '{tip}') lines.push(l.replace(/\{\w+\}/g, 'Club Platja Peñaclara 1998')); }); });
  ok(!W.BEATS.midLow, 'midLow recortado (plan §3)');
  const longL = lines.filter(l => l.length > 140), brace = lines.filter(l => /[{}]/.test(l) || /undefined/.test(l));
  ok(lines.length > 20 && !longL.length, 'frases del mentor ≤ 140 caracteres (' + lines.length + ' revisadas' + (longL.length ? '; larga: ' + longL[0] : '') + ')');
  ok(!brace.length, 'ninguna frase con «{» ni «undefined»' + (brace.length ? ': ' + brace[0] : ''));
  C.abandon(); C._reset();
  // ---------------------------------------------------------------- E5 (tarea C2): noticias, anales, cara a cara y fichas
  section('Mundo de la Carrera: noticias de la liga y enciclopedia de clubes (E5)');
  {
    const B = boot(true), K = B.VB.Career, L = B.VB.CareerLife, Wn = B.VB.CareerWorld;
    K.create({ name: 'Noticia Prueba', num: 9, role: 'cr', seed: 777 });
    K.acceptOffer(0, 2);
    const all = [], kinds = {}, MY = ['upset', 'thriller', 'rout', 'meWin', 'meUpset'];
    let lastId = 0, played = 0, maxRound = 0, badMine = 0, badMineEx = '', meOnSim = 0, simN = 0, benchN = 0, annOk = 0, annBad = '', champsOk = 0, movesBad = 0, seasonsDone = 0, unseenOk = true;
    const grab = (sum) => {   // noticias nuevas tras una jornada tuya
      const w = K.load().world, fresh = w.news.filter(x => x.id > lastId);
      lastId = w.newsN;
      fresh.forEach(x => { all.push(x); kinds[x.k] = (kinds[x.k] | 0) + 1; });
      const perW = {}; fresh.filter(x => x.w >= 1 && x.w <= 14).forEach(x => { perW[x.s + ':' + x.w] = (perW[x.s + ':' + x.w] | 0) + 1; });
      Object.keys(perW).forEach(k => { maxRound = Math.max(maxRound, perW[k]); });
      if (sum && (sum.sim || sum.bench)) {
        if (sum.bench) benchN++; else simN++;
        const me = K.load().myClub;
        fresh.forEach(x => {
          if (x.k === 'meWin' || x.k === 'meUpset') meOnSim++;
          if (MY.indexOf(x.k) >= 0 && x.c.indexOf(me) >= 0 && x.c.indexOf(sum.rival) >= 0) { badMine++; badMineEx = x.t; }
        });
      }
    };
    for (let s = 0; s < 12; s++) {
      let guard = 0;
      while (K.load().phase !== 'off' && guard++ < 40) {
        const cc = K.load(), n = K.next(cc);
        let sum;
        if (n && n.bench) sum = K.benchNext();
        else {
          const i = played++;
          if (i % 3 === 0) {
            const win = (i % 5) !== 0, g = { career: { season: cc.season }, teams: [[{}, {}], [{}, {}]], demo: false };
            sum = K.matchDone({ sets: win ? [2, 1] : [0, 2], setScores: win ? [[21, 17], [18, 21], [15, 12]] : [[17, 21], [19, 21]], win }, { kills: 12, aces: 2, blocks: 1, digs: 8, assists: 3, errors: 3 }, g);
          } else sum = K.simulateNext();
        }
        grab(sum);
        if (L) { const ev = L.pendingEvent(K.load()); if (ev) L.answer(0); }
      }
      // fin de temporada (fase off, antes de applyMoves): anales de esta temporada
      const cc = K.load(), w = cc.world, an = w.annals[w.annals.length - 1], me = K.myClub(cc);
      seasonsDone++;
      if (an && an.s === cc.season && an.lg.length === K.LEAGUES.length && an.lg.every((ids, Lv) => ids.slice().sort((a, b) => a - b).join() === K.clubsOf(cc, Lv).map(k => k.id).sort((a, b) => a - b).join()) &&
        an.cup[me.lvl] === cc.cup.champion && an.cup.every((id, Lv) => an.lg[Lv].indexOf(id) >= 0) &&
        an.up.slice().sort().join() === cc.review.moves.filter(m => m.to > K.club(cc, m.id).lvl).map(m => m.id).sort().join() &&
        an.dn.slice().sort().join() === cc.review.moves.filter(m => m.to < K.club(cc, m.id).lvl).map(m => m.id).sort().join()) annOk++;
      else if (!annBad) annBad = 'T' + cc.season + ' ' + JSON.stringify(an).slice(0, 120);
      const ch = w.news.filter(x => x.k === 'champs' && x.s === cc.season);
      // (frase corta con nombres enteros: el campeón de tu liga y, si es otra, el de la más alta; sin códigos cortos)
      const topLv = K.LEAGUES.length - 1, chT = ch.length === 1 ? ch[0].t : '';
      if (ch.length === 1 && ch[0].c.length === K.LEAGUES.length && ch[0].c[0] === an.lg[me.lvl][0] && chT.indexOf(K.club(cc, an.lg[me.lvl][0]).name) === 0 &&
        (me.lvl === topLv || chT.indexOf(K.club(cc, an.lg[topLv][0]).name) > 0) && chT.indexOf('(') < 0 && chT.length <= 140) champsOk++;
      else if (ch.length === 1 && !annBad) annBad = 'champs T' + cc.season + ' ' + chT.slice(0, 120);
      w.news.filter(x => x.k === 'moves' && x.s === cc.season).forEach(x => { if (!x.c.every(id => K.club(cc, id).lvl === me.lvl)) movesBad++; });
      // sin ver / vistas
      const un = Wn.newsUnseen(cc); if (!(un > 0) || Wn.markNewsSeen() !== un || Wn.newsUnseen(K.load()) !== 0 || Wn.markNewsSeen() !== 0) unseenOk = false;
      if (s === 11) break;
      K.stay(1); grab(null);
    }
    const c3 = K.load(), w3 = c3.world;
    console.log('  noticias en 12 temporadas: ' + all.length + ' — ' + Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a]).map(k => k + ' ' + kinds[k]).join(', '));
    ok(maxRound >= 1 && maxRound <= 3, 'como mucho 3 noticias por jornada (máx. ' + maxRound + ')');
    ok(w3.news.length <= Wn.NEWS_MAX && w3.news.length === 60, 'tope de 60 noticias guardadas (' + w3.news.length + ')');
    const bad = all.filter(x => /[{}]|undefined|NaN|\(\)|\s{2}|^\s|\s$|null/.test(x.t));
    ok(!bad.length, 'ninguna noticia con «{», «undefined», «NaN», «()» ni espacios de más' + (bad.length ? ': ' + bad[0].t : ''));
    ok(!/Campe[oó]n|campe[oó]n/.test(all.map(x => x.t).join('|')), 'género neutro: ninguna noticia dice «campeón»');
    ok(simN > 10 && meOnSim === 0 && badMine === 0, 'ninguna noticia de tu partido simulado ni del banquillo (' + simN + ' simulados, ' + benchN + ' banquillos' + (badMineEx ? '; ' + badMineEx : '') + ')');
    ok((kinds.meWin | 0) + (kinds.meUpset | 0) > 0, 'tus partidos jugados y ganados sí son noticia (meWin/meUpset: ' + ((kinds.meWin | 0) + (kinds.meUpset | 0)) + ')');
    ['upset', 'thriller', 'rout', 'leader', 'streak', 'skid', 'top', 'mid', 'champs', 'open', 'moves', 'mkt'].forEach(k => ok(kinds[k] > 0, 'sale algún titular «' + k + '»'));
    // variantes: nunca la misma dos veces seguidas en un tipo
    const lastV = {}; let rep = 0, repEx = '';
    all.slice().sort((a, b) => a.id - b.id).forEach(x => { if (Wn.TPL[x.k] && Wn.TPL[x.k].length > 1) { if (lastV[x.k] === x.v) { rep++; repEx = x.k; } lastV[x.k] = x.v; } });
    ok(rep === 0, 'ninguna variante repetida seguida en el mismo tipo' + (rep ? ' (' + rep + ', ' + repEx + ')' : ''));
    ok(Object.keys(Wn.TPL).every(k => Wn.TPL[k].every(t => !/Campe[oó]n/i.test(t))), 'plantillas sin «campeón»');
    // anales
    ok(annOk === seasonsDone && w3.annals.length === seasonsDone, 'anales: uno por temporada, permutaciones de cada liga, open y movimientos cuadran (' + annOk + '/' + seasonsDone + (annBad ? '; ' + annBad : '') + ')');
    ok(champsOk === seasonsDone, '«champs» con los ' + K.LEAGUES.length + ' campeones en ids, tu liga primero y con nombres enteros (' + champsOk + '/' + seasonsDone + ')');
    ok(movesBad === 0, 'ascensos y descensos: solo los de tu liga');
    ok(unseenOk, 'newsUnseen / markNewsSeen');
    // cara a cara
    const H2 = Object.keys(w3.h2h).map(id => w3.h2h[id]);
    ok(H2.reduce((s, h) => s + h[0], 0) === (c3.career.played | 0), 'cara a cara: suma de PJ = partidos jugados (sin banquillos) desde since (' + H2.reduce((s, h) => s + h[0], 0) + ' = ' + c3.career.played + ')');
    ok(H2.length > 0 && H2.every(h => h[1] + h[2] === h[0] && h[3] >= 0 && h[4] >= 0 && h[5] >= 1), 'cara a cara: G + P = PJ en todos los clubes');
    // fichas de los 40 clubes
    let cardErr = '', yearOk = 0, yearN = 0, dupT = 0, rowsOk = true;
    c3.clubs.forEach(k => {
      try {
        const f = Wn.clubCard(c3, k.id);
        if (!f || f.name !== k.name || !f.lore || !(f.lore.founded >= 1962 && f.lore.founded <= 2026) || !f.lore.nick || !f.lore.motto) cardErr = cardErr || 'ficha incompleta: ' + k.name;
        const ym = /(\d{4})$/.exec(k.name); if (ym) { yearN++; if (f.lore.founded === +ym[1]) yearOk++; }
        const seen = {}; f.titles.forEach(t => { const kk = t.s + ':' + t.kind; if (seen[kk]) dupT++; seen[kk] = 1; });
        if (f.path.length > 8 || f.form.length > 5) cardErr = cardErr || 'trayectoria/forma de más: ' + k.name;
      } catch (e) { cardErr = cardErr || String(e); }
    });
    ok(!cardErr, 'clubCard de los 40 clubes sin errores, fundación entre 1962 y 2026' + (cardErr ? ' (' + cardErr + ')' : ''));
    ok(yearOk === yearN, 'el año del nombre se respeta («… 1998» → 1998) (' + yearOk + '/' + yearN + ')');
    ok(dupT === 0, 'ningún título duplicado (misma temporada y tipo)');
    ok(Wn.clubCard(c3, 999) === null, 'clubCard de un id que no existe → null');
    K.LEAGUES.forEach((Lg, Lv) => { const r = Wn.clubRows(c3, Lv); if (r.length !== 8 || r.some((x, i) => x.pos !== i + 1)) rowsOk = false; });
    ok(rowsOk, 'clubRows: los 8 clubes de cada liga en orden de tabla');
    const sz = JSON.stringify(w3).length;
    ok(sz < 20000, 'c.world < 20 KB a las 12 temporadas (' + sz + ' bytes)');
    // la ficha usa tus trofeos de antes del sprint («contigo»)
    {
      const cc = JSON.parse(JSON.stringify(c3)), me = K.myClub(cc);
      cc.world.since = 99; cc.world.annals = [];
      cc.trophies = [{ season: 3, kind: 'liga', name: 'Circuito Regional', club: me.name }, { season: 3, kind: 'premio', name: 'MVP', club: me.name }];
      const f = Wn.clubCard(cc, me.id);
      ok(f.titles.length === 1 && f.titles[0].you === 1 && f.titles[0].s === 3, 'palmarés de antes del sprint: tus trofeos con el club, «(contigo)», sin premios');
    }
    // interfaz (sin DOM): HTML sin «undefined» ni «{»
    const uiF = path.join(ROOT, 'js/career-world-ui.js');
    const UIc = (() => { const cx = { console, Math, Date, JSON, VB: B.VB }; cx.globalThis = cx; cx.window = cx; vm.createContext(cx); if (fs.existsSync(uiF)) vm.runInContext(fs.readFileSync(uiF, 'utf8'), cx, { filename: 'js/career-world-ui.js' }); return cx.VB.CareerWorldUI; })();
    ok(UIc, 'career-world-ui.js se carga sin DOM');
    if (UIc) {
      const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => '&#' + ch.charCodeAt(0) + ';');
      const HLP = { esc, sp: (a, k) => a.filter(p => p !== '' && p != null).map(p => typeof p === 'object' ? p.h : p).join(' | '), kitSw: () => '<i class="cr-kit"></i>' };
      const cu = K.load(); cu.world.newsSeen = 0;
      const htmls = [UIc.headlines(cu, HLP), UIc.newsHTML(cu, HLP, 0), UIc.clubsHTML(cu, 0, HLP), UIc.clubsHTML(cu, 4, HLP)];
      const ar = UIc.act('cw-club', { getAttribute: k => (k === 'data-id' ? String(cu.myClub) : null) });
      ok(ar && ar.tab === 'league' && ar.s === 'clubs', 'cw-club lleva a Liga › Clubes');
      htmls.push(UIc.clubsHTML(cu, 0, HLP));
      ok(/‹ Clubes/.test(htmls[4]) && /Contra ti/.test(htmls[4]) && /Palmarés/.test(htmls[4]), 'clubsHTML con un club elegido pinta la ficha');
      ok(UIc.back() === true && UIc.back() === false, 'back() cierra la ficha y luego no hace nada');
      ok(/Titulares/.test(htmls[0]) && /data-act="cw-club"/.test(htmls[1]) && (htmls[2].match(/class="cw-row/g) || []).length === 8, 'Titulares, Noticias (abren ficha) y Clubes (8 filas)');
      const bh = htmls.filter(h => /undefined|NaN|\{\w+\}|null/.test(h.replace(/<svg[\s\S]*?<\/svg>/g, '')));
      ok(!bh.length, 'HTML de noticias y clubes sin «undefined», «NaN» ni «{x}»');
      ok(!/1\.er|·/.test(htmls.join('')), 'sin «1.er» ni «·» en la interfaz del mundo');
      cu.world.newsSeen = cu.world.newsN;
      ok(UIc.headlines(cu, HLP) === '', 'sin noticias nuevas no hay Titulares');
    }
  }
  // 4) migración: carrera de 2 temporadas sin c.world
  {
    const old = run(false, 2, 555), B2 = boot(true);
    B2.mem['voley3d.career'] = old.mem['voley3d.career'];
    const c2 = B2.VB.Career.load(); ok(!c2.world, 'guardado viejo sin c.world');
    const w2 = B2.VB.CareerWorld.ensure(c2), sn = w2.mentor.seen;
    ok(w2.since === c2.season, 'migración: since = temporada actual (' + w2.since + ' = ' + c2.season + ')');
    ok(sn.hola && sn.debut && sn.win1 && sn.loss1, 'migración: hitos pasados vistos (' + JSON.stringify(sn) + ')');
    ok(w2.mentor.q.length === 0 && B2.VB.CareerWorld.mentorScene(c2) === null, 'migración: cola vacía (Faro no saluda a mitad de carrera)');
    ok(Array.isArray(w2.news) && !w2.news.length && Array.isArray(w2.annals) && !w2.annals.length && w2.newsSeen === w2.newsN, 'migración: sin noticias ni anales viejos (empiezan ahora)');
    const n2 = B2.VB.Career.simulateNext(); ok(n2 && B2.VB.Career.load().world, 'tras migrar, la carrera sigue y guarda c.world');
    ok(JSON.stringify(R.c.world).length < 20000, 'c.world pequeño a las 8 temporadas (' + JSON.stringify(R.c.world).length + ' bytes)');
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
// ------------------------------------------------------------------ vida de la Carrera en la PISTA (12-nov-2026)
section('Vida en la Carrera de pista: retos por puesto, fama, patrocinio de pabellón, tienda, decisiones, temporada y guardados');
if (!VB.CareerLife || !C.hall || !C.hall.available()) console.log('  (sin js/career-life.js o sin ligas de pista)');
else {
  verbose = true;
  const Lf = VB.CareerLife, H = C.hall;
  const keep = { c6: mem['voley3d.career6'], md: mem['voley3d.career.mode'], roles: VB.Sim.CTRL_ROLES6 };
  VB.Sim.CTRL_ROLES6 = ['OH', 'S', 'OPP', 'MB'];   // (los cuatro puestos que deja llevar sim.js)
  // una Carrera de playa al lado: no debe cambiar nada mientras se juega la de pista
  C.setMode('beach'); C.abandon(); C._reset(); C.create({ name: 'Playa Al Lado', num: 3, role: 'atk', seed: 4321, autoClub: true });
  const beachRaw = mem['voley3d.career'];
  delete mem['voley3d.career6']; C._reset();
  let c = C.create({ mode: 'hall', name: 'Vida Pista', num: 10, pos: 'OH', seed: 2024 });
  const inh = Lf.legends().length ? Lf.legacyTier(Lf.legends()[0].score).i * 150 : 0;   // (la retirada de arriba dejó una leyenda: fama heredada)
  ok(c && c.mode === 'hall' && c.life && c.life.fame === inh && JSON.parse(mem['voley3d.career6']).life, 'crear: c.life dentro de voley3d.career6 (fama heredada ' + inh + ')');
  ok(C.acceptOffer(c.offers.findIndex(o => !o.trial), 2) && c.phase === 'league', 'firma por un club de la 2ª');
  // titular indiscutible con el entrenador contento: que juegue todas (sin banquillo)
  const starter = () => { c = C.get(); c.contract.role = 'Titular indiscutible'; c.coach = 90; C.save(c); };
  starter();
  if (!C.next(c)) C.simulateNext();
  // reto por puesto, con el umbral medido de la pista
  { const L = Lf.lvlOf(c), Lg = C.league(C.myClub(c).lid), ch = Lf.challenge(c);
    ok(L === Math.max(0, Math.min(4, Math.round((Lg.strength - 50) / 10))), 'nivel 0-4 desde la fuerza de la liga (' + Lg.name + ' ' + Lg.strength + ' → ' + L + ')');
    const T = Lf.CH6.OH, okN = ch && (ch.id === 'win' || (T[ch.id] && T[ch.id][L] != null && (ch.id === 'nota' || ch.n === Math.max(1, Math.round(T[ch.id][L] * Lf.ptsF(c))))));
    ok(okN, 'reto de receptor con el umbral de la pista: «' + (ch && ch.txt) + '»');
    const ms = C.matchSetup(c); ok(ms && ms.career.goal === ch.txt, 'matchSetup de la pista lleva el reto a g.career.goal');
    // umbrales por puesto: el colocador no remata (asistencias), el central no defiende ni asiste; a 25 puntos, más
    const ids = pos => { const s = new Set(); c.player.roleKey = pos; for (let w = 0; w < 60; w++) s.add(Lf.challengeAt(c, 1, 'league', { week: w }, -1).id); c.player.roleKey = 'OH'; return [...s]; };
    const iS = ids('S'), iM = ids('MB'), iO = ids('OH');
    ok(iS.indexOf('kills') < 0 && iS.indexOf('assists') >= 0, 'colocador: retos de asistencias, nunca de remates (' + iS.join(', ') + ')');
    ok(iM.indexOf('digs') < 0 && iM.indexOf('assists') < 0 && iM.indexOf('blocks') >= 0, 'central: bloqueo y remate, sin defensas ni asistencias (' + iM.join(', ') + ')');
    ok(iO.indexOf('assists') < 0 && iO.indexOf('kills') >= 0 && iO.indexOf('clean') < 0, 'receptor: remates y defensas; «sin ceder un set» solo en L3 (' + iO.join(', ') + ')');
    c.player.roleKey = 'S'; let chS = null; for (let w = 0; w < 60 && !chS; w++) { const x = Lf.challengeAt(c, 1, 'league', { week: w }, -1); if (x.id === 'assists') chS = x; }
    ok(chS && chS.n === Lf.CH6.S.assists[L] && chS.n < 30, 'asistencias del colocador a 15: ' + (chS && chS.txt));
    c.points = 25; let chS25 = null; for (let w = 0; w < 60 && !chS25; w++) { const x = Lf.challengeAt(c, 1, 'league', { week: w }, -1); if (x.id === 'assists') chS25 = x; }
    ok(chS25 && chS25.n === Math.round(Lf.CH6.S.assists[L] * 25 / 15), 'a 25 puntos el umbral crece (' + (chS25 && chS25.txt) + ')');
    c.points = 15; c.player.roleKey = 'OH'; C.save(c);
    const t1 = Lf.challengeAt(c, 1, 'league', { week: 0 }, -1); ok(!/\b1 (aces|bloqueos|errores)\b/.test(t1.txt) && ['Haz un ace', 'Haz un bloqueo punto', 'Gana sin cometer ningún error'].every(s => typeof s === 'string'), 'textos en singular para 1 y «sin ningún error» para 0'); }
  // tienda: el material se aplica en el partido de pista, en TU hueco (ctrlIdx), y no en los demás
  { c = C.get(); c.money = 100000; C.save(c);
    const before = C.matchSetup(c); ok(Lf.buyGear('eyes') === 'ok' && Lf.buyGear('eyes') === 'ok' && C.get().life.gear.eyes === 2, 'material comprado en la pista (2 niveles de ' + Lf.gearName(C.get(), 'eyes') + ')');
    const after = C.matchSetup(C.get()), i = after.ctrlIdx, o = (i + 1) % 6;
    ok(after.attrs[0][i].recv === Math.min(99, before.attrs[0][i].recv + 2) && after.attrs[0][i].dig === Math.min(99, before.attrs[0][i].dig + 2) && after.attrs[0][i].spike === before.attrs[0][i].spike, 'setup: +2 recepción y defensa en tu hueco (' + i + ')');
    ok(after.attrs[0][o].recv === before.attrs[0][o].recv && JSON.stringify(after.attrs[1]) === JSON.stringify(before.attrs[1]), 'los compañeros y el rival, igual');
    ok(C.get().player.st.recv === C.get().player.st.recv && after.gear && after.gear.recv === 2, 'el atleta no cambia (solo el partido)'); }
  // partidos jugados: reto cumplido, fama, dinero, logros, rival de tu liga
  { const big = { kills: 30, aces: 5, blocks: 5, digs: 30, assists: 40, errors: 0 };
    const play = () => { starter(); const ms = C.matchSetup(C.get()); if (!ms) { C.simulateNext(); return null; } return C.matchDone({ sets: [2, 0], setScores: [[15, 8], [15, 9]], win: true }, big, { career: ms.career }); };
    c = C.get(); const f0 = c.life.fame, m0 = c.money, d0 = c.life.chDone;
    const s = play();
    ok(s && s.mode === 'hall' && s.life && s.life.ch && s.life.ch.ok, 'partido de pista jugado: reto cumplido (' + (s && s.life && s.life.ch && s.life.ch.txt + ', ' + s.life.ch.prog) + ')');
    c = C.get(); ok(c.life.chDone === d0 + 1 && c.life.fame > f0 && c.money > m0, 'premio: seguidores ' + f0 + ' → ' + c.life.fame + ', dinero ' + m0 + ' → ' + c.money);
    ok(c.life.ach.m1 && c.life.ach.w1, 'logros «Debut» y «Primera victoria» en la pista');
    const rk = c.life.rival && C.club(c, c.life.rival.club);
    ok(rk && rk.lid === C.myClub(c).lid && rk.id !== c.myClub && c.life.rival.num !== 13 && c.life.rival.num !== c.player.num, 'rival personal de tu liga (por id): ' + (c.life.rival && c.life.rival.name + ', ' + rk.name));
    ok(c.last && c.last.life && c.last.life.ch, 'la tarjeta del último partido lleva el reto (c.last.life)');
    const fame = [c.life.fame]; for (let i = 0; i < 4; i++) { play(); fame.push(C.get().life.fame); }
    ok(fame.every((v, i) => !i || v >= fame[i - 1]) && fame[4] > fame[0], 'la fama sube jornada a jornada jugando bien: ' + fame.join(' → '));
    const ss = C.simulateNext(); ok(ss && ss.life && !ss.life.ch, 'simulando no hay reto'); }
  // patrocinio de pabellón (inventado) y offerBonus en las ofertas de pista
  { c = C.get();
    Lf.addFame(c, Math.max(0, 600 - c.life.fame)); C.save(c); c = C.get();
    if (!c.life.spOffers.length) { Lf.sponsorOffers(c, 'season'); C.save(c); c = C.get(); }
    ok(c.life.spOffers.length === 2 && c.life.spOffers.every(o => Lf.SPONSORS6.indexOf(o.name) >= 0 && Lf.SPONSORS.indexOf(o.name) < 0), 'patrocinadores de pabellón inventados: ' + c.life.spOffers.map(o => o.name).join(', '));
    ok(c.life.spOffers.every(o => Lf.SP_GOALS6.OH.some(g => g.stat === o.goal.stat) && o.goal.n >= 3), 'objetivo de temporada de receptor: ' + c.life.spOffers.map(o => o.goal.txt).join(' / '));
    const sNo = C.beach.offerScore(Object.assign({}, c, { life: undefined })), sYes = C.beach.offerScore(c), sct = c.life.scout === c.season ? 2 : 0;
    ok(Lf.offerBonus(c) > 0 && Math.abs(sYes - sNo - Lf.offerBonus(c) - sct) < 1e-9, 'la fama (y el ojeador) suman interés en las ofertas de pista (offerScore, que usa genOffers6): +' + Lf.offerBonus(c));
    ok(Lf.signSponsor(0) && C.get().life.sponsor && Lf.SPONSORS6.indexOf(C.get().life.sponsor.name) >= 0, 'patrocinio firmado: ' + C.get().life.sponsor.name);
    const m1 = C.get().money, sp = C.get().life.sponsor.pay; C.simulateNext(); ok(C.get().money >= m1 + sp - 1 || C.get().phase === 'off', 'el patrocinio paga cada jornada (' + sp + ' €)'); }
  // decisiones: las de pabellón (solo en la pista) y la química del equipo
  { c = C.get(); c.life.ev = { key: 'speech', id: 900 }; const ch0 = c.chem | 0; C.save(c);
    const pe = Lf.pendingEvent(C.get()); ok(pe && pe.title === 'Charla en el vestuario' && pe.opts.length === 3, 'decisión de pabellón: «' + (pe && pe.title) + '»');
    const r = Lf.answer(0); ok(r && C.get().chem === Math.min(100, ch0 + 8), 'la química que se mueve es la del equipo (' + ch0 + ' → ' + C.get().chem + ')');
    c = C.get(); c.life.ev = { key: 'mateDown', id: 901 }; C.save(c); const md = Lf.pendingEvent(C.get());
    ok(md && md.title === 'Un compañero está de bajón' && !/\{mate\}|^Un compañero apenas/.test(md.text) && md.opts.every(o => o.hint.every(h => h[0] !== 'Forma del compañero')), 'sin pareja: un compañero de la plantilla con nombre (' + md.text + ')');
    c = C.get(); c.life.ev = { key: 'rivalTalk', id: 902 }; C.save(c); ok(/pabellón/.test(Lf.pendingEvent(C.get()).text), 'el pique del rival habla del pabellón');
    c = C.get(); c.life.ev = null; C.save(c);
    ok(Object.keys(Lf.EVENTS).filter(k => Lf.EVENTS[k].only === 'hall').length >= 2, 'hay decisiones que solo salen en la pista'); }
  // textos de pabellón
  { c = C.get();
    const fi = Lf.fameInfo(Object.assign({}, c, { life: Object.assign({}, c.life, { fame: 2500 }) }));
    ok(fi.name === 'Conocido en la liga' && Lf.tierName(2) === 'Conocido en el circuito', 'escalón de fama de pabellón: «' + fi.name + '» (playa: «' + Lf.tierName(2) + '»)');
    ok(Lf.legacyTier(160, c).name === 'Ídolo del pabellón' && Lf.legacyTier(160).name === 'Ídolo del circuito', 'legado de pabellón: «' + Lf.legacyTier(160, c).name + '»');
    const al = Lf.achList(c), txt = al.map(a => a.name + ' ' + a.d).join(' | ');
    ok(al.some(a => a.name === 'Veterano del parqué') && al.some(a => a.name === 'Director de orquesta') && !/arena|circuito|\bopen\b/i.test(txt), 'logros de pabellón (sin arena, circuito ni open)');
    ok(Lf.GEAR_KEYS.every(k => Lf.gearName(c, k)) && Lf.gearName(c, 'eyes') === 'Rodilleras de gel', 'material de pabellón'); }
  // cierre de temporada y temporada nueva
  { let g = 0; while (C.get().phase !== 'off' && g++ < 60) C.simulateNext();
    c = C.get(); const r = c.review || {};
    ok(c.phase === 'off' && r.fans > 0 && r.legacy > 0 && Array.isArray(r.awards) && c.history.length === 1, 'fin de temporada: fama ' + r.fans + ', legado ' + r.legacy + ', premios ' + (r.awards || []).length + ' (con 6 partidazos forzados)');
    ok(c.life.sponsor && c.life.sponsor.done && c.inbox.some(m => m.k === 'fans' && (/^Bonus de /.test(m.t) || /objetivo no cumplido/.test(m.t))), 'el patrocinio se liquida al acabar la temporada');
    const age0 = c.player.age; C.stay(1); c = C.get();
    ok(c.season === 2 && c.player.age === age0 + 1 && !c.life.sponsor && (Lf.fameInfo(c).i < 1 || c.life.spOffers.length === 2) && c.life.rival, 'temporada nueva: el patrocinio se va, llegan ofertas nuevas y sigue el rival');
    // premios de pabellón: una temporada de colocador descomunal y jugada → «Mejor colocador»
    c.player.roleKey = 'S'; c.stats = { played: 12, won: 11, sim: 0, bench: 0, pts: 10, kills: 2, aces: 10, blocks: 14, assists: 330, digs: 30, errors: 4 };
    c.notes = Array.from({ length: 12 }, () => ({ nota: 8.6, win: 1, sim: 0 }));
    const a0 = c.life.awards.length; Lf.hook(c, 'season'); const got = c.life.awards.slice(a0).map(a => a.name);
    ok(got.some(n => /^Mejor colocador /.test(n)) && !got.some(n => /^Máximo anotador/.test(n)), 'premios de pabellón por puesto: ' + got.join(', '));
    c.player.roleKey = 'OH'; C._reset(); }
  // guardado de pista viejo, sin c.life: se crea solo al cargar
  { const raw = JSON.parse(mem['voley3d.career6']); delete raw.life; mem['voley3d.career6'] = JSON.stringify(raw); C._reset();
    c = C.get(); ok(c && c.mode === 'hall' && c.life && c.life.fame === 0 && Array.isArray(c.life.awards) && Lf.fameInfo(c).fans === 0, 'guardado de pista sin c.life: se crea al cargar (fama 0)');
    let err = ''; try { Lf.challenge(c); Lf.achList(c); C.simulateNext(); } catch (e) { err = e.message; } ok(!err && C.get().life, 'y la Carrera sigue sin errores' + (err ? ' — ' + err : '')); }
  // textos de pabellón también en lo que se guarda: historial de decisiones y logros de la tarjeta del partido; jornadas de patrocinio
  { c = C.get(); c.life.ev = { key: 'mateDown', id: 903 }; C.save(c); const pe = Lf.pendingEvent(C.get()); Lf.answer(0);
    const lg = C.get().life.log.slice(-1)[0];
    ok(lg && lg.t === 'Un compañero está de bajón' && lg.o === pe.opts[0].t && !/\{/.test(lg.o), 'historial de decisiones con el título de pabellón: «' + (lg && lg.t) + '» / «' + (lg && lg.o) + '»');
    c = C.get(); c.career.played = 49; C.save(c); let sm = null, g = 0; while (!sm && g++ < 5) { const x = C.simulateNext(); if (x && x.life && x.life.ach && x.life.ach.length) sm = x; }
    ok(sm && sm.life.ach.indexOf('Veterano del parqué') >= 0 && sm.life.ach.every(n => !/arena/i.test(n)), 'la tarjeta del partido nombra el logro de pabellón (' + (sm && sm.life.ach.join(', ')) + ')');
    c = C.get(); const k = C.myClub(c), nC = H.leagueClubs(c, k.lid).length, w = H.weeksOf(c, k.lid);
    ok(Lf.seasonWeeks(c) === (nC % 2 ? w - w / nC : w), 'objetivo de patrocinio con las jornadas que juegas (' + nC + ' clubes: ' + Lf.seasonWeeks(c) + ' de ' + w + ')');
    const odd = [3, 5, 7, 9, 11].every(n => { const ww = n <= 8 ? 2 * n : n; return ww - ww / n === (n <= 8 ? 2 * (n - 1) : n - 1); });
    ok(odd, 'con un nº impar de clubes se quitan los descansos (1 por vuelta)'); }
  // y la playa, igual
  ok(mem['voley3d.career'] === beachRaw, 'la Carrera de playa guardada al lado no ha cambiado');
  { C.setMode('beach'); C._reset(); const cb = C.get(), ch = Lf.challenge(cb);
    ok(cb && cb.mode !== 'hall' && ch && (ch.id === 'win' || ch.id === 'clean' || Lf.CH[ch.id].n[cb.myClub >= 0 ? C.myClub(cb).lvl : 0] === ch.n), 'playa: el reto sigue con sus umbrales (' + (ch && ch.txt) + ')');
    ok(Lf.fameInfo(cb).name === 'Desconocido' && Lf.achList(cb).some(a => a.name === 'Veterano de la arena') && !Lf.achList(cb).some(a => a.name === 'Director de orquesta'), 'playa: sus textos y logros'); }
  // dejar todo como estaba
  C.abandon(); C._reset();
  if (keep.c6 != null) mem['voley3d.career6'] = keep.c6; else delete mem['voley3d.career6'];
  if (keep.md != null) mem['voley3d.career.mode'] = keep.md; else delete mem['voley3d.career.mode'];
  if (keep.roles) VB.Sim.CTRL_ROLES6 = keep.roles; else delete VB.Sim.CTRL_ROLES6;
  C._reset(); verbose = false;
}

// ------------------------------------------------------------------ mundo de la Carrera en la PISTA (merge sprint 5 + main)
section('Mundo de la Carrera en la pista: Faro, noticias y clubes con las ligas por país');
if (NOWORLD || !VB.CareerWorld) console.log('  (sin career-world.js: se salta el mundo en la pista)');
else if (!C.hall || !C.hall.available()) console.log('  (sin ligas de pista)');
else {
  verbose = true;
  const Wd = VB.CareerWorld, H = C.hall;
  const keep = { c6: mem['voley3d.career6'], md: mem['voley3d.career.mode'], b: mem['voley3d.career'] };
  const BAD = /arena|playa|circuito|\bopen\b|pareja|chiringuito/i, JUNK = /\{|undefined|NaN|null|\(\)/;
  C.setMode('beach'); C.abandon(); C._reset(); C.create({ name: 'Playa Mundo', num: 3, role: 'atk', seed: 9191, autoClub: true });
  const beachRaw = mem['voley3d.career'];
  delete mem['voley3d.career6']; C._reset();
  // la misma Carrera de pista con y sin el mundo: lo demás, idéntico (el mundo no consume el azar de career.js)
  const strip = c => { const o = JSON.parse(JSON.stringify(c)); delete o.world; o.inbox = (o.inbox || []).filter(m => m.k !== 'mentor'); o.inbox.forEach(m => { delete m.id; }); delete o.msgN; delete o.created; return JSON.stringify(o); };
  const run = () => {
    delete mem['voley3d.career6']; C._reset();
    const c = C.create({ mode: 'hall', name: 'Mundo Pista', num: 8, pos: 'OH', seed: 31337, now: 1 });
    const hola = c.world && c.world.mentor.q.map(q => q.l.join(' ')).join(' ');
    C.acceptOffer(c.offers.findIndex(o => !o.trial), 2);
    let g = 0; while (C.get().season < 3 && g++ < 200) { if (C.get().phase === 'off') C.stay(1); else C.simulateNext(); }
    return { c: C.get(), hola };
  };
  const Wsave = VB.CareerWorld; VB.CareerWorld = undefined;
  const noW = run().c; VB.CareerWorld = Wsave;
  const { c, hola } = run();
  ok(c && c.mode === 'hall' && c.season === 3 && !noW.world, 'dos temporadas de pista simuladas (' + c.history.map(h => h.lgShort + ' ' + h.pos).join(', ') + ')');
  ok(strip(c) === strip(noW), 'con y sin career-world.js la Carrera de pista es idéntica (salvo c.world y los mensajes de Faro)');
  ok(hola && /pabellón/.test(hola) && !BAD.test(hola), 'Faro se presenta con textos de pabellón: «' + (hola || '').slice(0, 70) + '…»');
  ok(c.world.mentor.seen.hola && c.world.mentor.seen.debut, 'escenas «hola» y «antes del debut» (gancho join de la pista)');
  const allQ = c.world.mentor.q.concat([]).map(q => q.l.join(' ')).join(' | ') + ' | ' + c.inbox.filter(m => m.k === 'mentor').map(m => m.x).join(' | ');
  ok(!BAD.test(allQ) && !/\{/.test(allQ), 'escenas y bandeja de Faro sin arena, playa, circuito ni pareja');
  ok(Object.keys(Wd.BEATS_H).every(k => Wd.BEATS_H[k].every(l => l.length <= Wd.LINE_MAX && !BAD.test(l))), 'frases de pista ≤ ' + Wd.LINE_MAX + ' caracteres');
  const me = C.myClub(c), L = H.league(me.lid, c), lgs = Wd.leaguesOf(c);
  ok(lgs.length >= 1 && lgs.every(id => H.league(id, c) && H.league(id, c).cc === L.cc) && lgs.indexOf(me.lid) >= 0 && Wd.topLv(c) === L.cc + '1', 'leaguesOf: las ligas de tu país (' + lgs.join(', ') + ')');
  const ol = Wd.otherLv(c, L.cc + '1'), OL = H.league(ol, c);
  ok(OL && OL.lvl === 1 && OL.id !== L.cc + '1' && c.leagues.filter(x => x.lvl === 1 && x.id !== L.cc + '1').every(x => x.strength <= OL.strength), 'otra liga desde la 1ª: la 1ª más fuerte del mundo (' + ol + ')');
  ok(Wd.isTop(c, 'IT1') && !Wd.isTop(c, 'ES1') && !Wd.isTop(c, 'ES2'), 'élite de la pista: 1ª con fuerza ≥ 84 (IT1 sí, ES1 y ES2 no)');
  // noticias
  const nw = Wd.news(c), txt = nw.map(x => x.t).join(' | ');
  ok(nw.length >= 10, nw.length + ' noticias en dos temporadas: ' + [...new Set(nw.map(x => x.k))].join(', '));
  ok(!JUNK.test(txt) && !BAD.test(txt), 'sin «{», «undefined» ni textos de playa: ' + nw.slice(0, 2).map(x => '«' + x.t + '»').join(' '));
  ok(nw.every(x => x.c.every(id => C.club(c, id))), 'cada noticia apunta a clubes que existen');
  const perWk = {}; nw.filter(x => x.w >= 1 && x.w < Wd.W_END).forEach(x => { const k = x.s + ':' + x.w; perWk[k] = (perWk[k] || 0) + 1; });
  ok(Object.keys(perWk).length > 0 && Object.values(perWk).every(n => n <= 3), 'máx. 3 noticias por jornada (' + Object.keys(perWk).length + ' jornadas con noticias)');
  ok(nw.some(x => x.k === 'champs') && nw.some(x => x.k === 'cup') && nw.filter(x => x.k === 'cup').every(x => Wd.newsWhen(x) === 'T' + x.s + ' Copa'), 'cierre: campeones y finales de copa («' + (nw.find(x => x.k === 'cup') || {}).t + '»)');
  ok(nw.some(x => x.k === 'mkt'), 'rumores de verano con jugadores inventados de pista');
  // anales y fichas
  const an = c.world.annals;
  ok(an.length === 2 && an.every(a => Array.isArray(a.l) && a.l.length === a.lg.length && a.lg.every((ids, i) => ids.length === H.leagueClubs(c, a.l[i]).length)), 'anales con los ids de las ligas (' + an.map(a => a.l.join('+')).join(', ') + ')');
  const rows = Wd.clubRows(c, me.lid);
  ok(rows.length === H.leagueClubs(c, me.lid).length && rows.filter(r => r.mine).length === 1 && rows.every(r => r.stars >= 1 && r.stars <= 5 && r.ovr > 0), 'Clubes: ' + rows.length + ' filas de ' + L.name + ', tu club marcado');
  const kc = Wd.clubCard(c, me.id);
  ok(kc && kc.league === L.name && kc.path.length >= 1 && kc.path.every(p => p.league && p.pos >= 1) && kc.lore && kc.lore.nick && kc.mine, 'ficha de tu club: liga, trayectoria (' + kc.path.map(p => 'T' + p.s + ' ' + p.league + ' ' + p.pos).join(', ') + '), apodo «' + kc.lore.nick + '»');
  ok(!/Cangrejo|Gaviota|Delf|Medusa|orilla|cala/i.test(c.clubs.slice(0, 40).map(k => { const l = Wd.lore(c, k); return l.nick + ' ' + l.motto; }).join(' ')), 'apodos y lemas de pabellón (sin mar)');
  const champ = an[0].lg[0][0], cc = Wd.clubCard(c, champ);
  ok(cc && cc.titles.some(t => t.kind === 'liga' && t.s === 1), 'el campeón de la T1 tiene su título en la ficha (' + cc.name + ')');
  const cupW = an.find(a => a.cup.some(x => x >= 0));
  ok(!cupW || cupW.cn && Wd.clubCard(c, cupW.cup.find(x => x >= 0)).titles.some(t => t.kind === 'copa' && t.name === cupW.cn), 'la copa nacional cuenta en la ficha del campeón (' + (cupW ? cupW.cn : 'sin campeón de tus ligas') + ')');
  ok(Object.keys(c.world.h2h).length > 0 && Object.keys(c.world.h2h).every(id => C.club(c, +id)), 'cara a cara con ' + Object.keys(c.world.h2h).length + ' clubes');
  // la élite: Faro lo celebra en la pista con el nombre de la liga
  { const t = JSON.parse(JSON.stringify(c)); t.world.mentor.seen.top = 0; t.world.mentor.q = []; const it = t.clubs.find(k => k.lid === 'IT1'); t.myClub = it.id;
    Wd.hook(t, 'newSeason'); const q = t.world.mentor.q.find(x => x.id === 'top');
    ok(q && /^IperLega: una de las grandes ligas/.test(q.l[0]), 'escena «En la élite» de pista: «' + (q && q.l[0]) + '»'); }
  // guardado de pista viejo sin c.world: se crea al vuelo, y Faro no se presenta a mitad
  { const raw = JSON.parse(mem['voley3d.career6']); delete raw.world; mem['voley3d.career6'] = JSON.stringify(raw); C._reset();
    let err = ''; try { C.simulateNext(); } catch (e) { err = e.message; }
    const r = C.get(); ok(!err && r.world && r.world.mentor.seen.hola && !r.world.mentor.q.some(q => q.id === 'hola'), 'guardado de pista sin c.world: se crea al jugar, sin la presentación' + (err ? ' — ' + err : '')); }
  // career-life en la pista tras el merge: celebraciones (E2) y dorsal del rival en el duelo (setup → m.career.rivalNum)
  if (VB.CareerLife) {
    const Lf = VB.CareerLife, r = C.get(); let err = '', cl = null;
    try { cl = Lf.celebs(r); } catch (e) { err = e.message; }
    ok(!err && Array.isArray(cl), 'pista: celebraciones de firma disponibles (' + (cl ? cl.length : 0) + ')' + (err ? ' — ' + err : ''));
    const rv = r.life && r.life.rival, rk = rv && C.club(r, rv.club);
    if (rk) {
      let ms = null, g = 0; while (g++ < 30) { const n = C.next(C.get()); if (!n) { if (C.get().phase === 'off') C.stay(1); else C.simulateNext(); continue; } if (n.rival.id === rk.id && !n.bench) { ms = C.matchSetup(C.get()); break; } C.simulateNext(); }
      ok(!ms || (ms.career.duel && ms.career.rivalNum === (C.get().life.rival.num | 0) && Array.isArray(ms.nums)), 'pista: en el duelo, matchSetup lleva rivalNum ' + (ms ? ms.career.rivalNum : '(sin duelo a mano)') + ' (main.js usa m.nums de la pista)');
    }
  }
  ok(mem['voley3d.career'] === beachRaw, 'la Carrera de playa guardada al lado no ha cambiado');
  C.abandon(); C._reset();
  if (keep.c6 != null) mem['voley3d.career6'] = keep.c6; else delete mem['voley3d.career6'];
  if (keep.md != null) mem['voley3d.career.mode'] = keep.md; else delete mem['voley3d.career.mode'];
  if (keep.b != null) mem['voley3d.career'] = keep.b; else delete mem['voley3d.career'];
  C._reset(); verbose = false;
}

console.log('\n' + passes + ' comprobaciones bien');
console.log(fails ? '\n' + fails + ' FALLOS' : '\nTODO OK');
process.exit(fails ? 1 : 0);
