#!/usr/bin/env node
// VOLEY 3D — prueba de las equipaciones (owner: players): node tools/kittest.js [ruta/players.js]
// Carga js/players.js en node (sin THREE ni DOM: setKit / liberoColor / kitColors no los usan) y comprueba:
//  - Carrera de pista: color del líbero del club (usado / descartado si choca) y 2ª equipación del rival (kitAccent).
//  - Fuera de la Carrera de pista (sin kitLibero): igual que antes (huella de 400 casos sacada del players.js anterior).
// Sale con 1 si algo falla.
'use strict';
var vm = require('vm'), fs = require('fs'), path = require('path');
var FILE = process.argv[2] || path.join(__dirname, '..', 'js', 'players.js');
var w = {}; w.window = w; w.VB = {}; vm.createContext(w);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), w, { filename: FILE });
var P = w.VB.Players, fails = 0, n = 0;
function hx(v) { return '#' + ('00000' + (v >>> 0).toString(16)).slice(-6); }
function ok(cond, msg) { n++; if (!cond) { fails++; console.log('  FALLO: ' + msg); } else console.log('  ok: ' + msg); }
function kit(st) { P.setKit(st); var k = P.kitColors(); return { t0: k.t0, t1: k.t1, l0: P.liberoColor(0), l1: P.liberoColor(1) }; }
var CPU_BLUE = 0x3363ea, CPU_RED = 0xd8262e;

console.log('1) Líbero del club usado (camiseta azul marino, líbero amarillo; rival verde con líbero rosa)');
var r = kit({ kitShirt: 0x1b3a8a, kitAccent: 0xffffff, kitShorts: 0x1b3a8a, kitPattern: 'liso', kitLibero: 0xffd23a,
  rival: { kitShirt: 0x1f9a4a, kitAccent: 0xffffff, kitShorts: 0x111111, kitPattern: 'diag', kitLibero: 0xff3fa4 } });
ok(r.l0 === 0xffd23a, 'líbero tuyo = ' + hx(r.l0) + ' (club #ffd23a)');
ok(r.l1 === 0xff3fa4, 'líbero rival = ' + hx(r.l1) + ' (club #ff3fa4)');
ok(r.t1.base === 0x1f9a4a, 'rival con su 1ª (' + hx(r.t1.base) + ')');

console.log('2) Líbero del club que choca -> cálculo de siempre');
// tu líbero rojo con camiseta roja (choca con la tuya); el rival con líbero = tu camiseta (choca con la rival... de enfrente)
var st2 = { kitShirt: 0xd8262e, kitAccent: 0xffffff, kitShorts: 0x111111, kitPattern: 'liso', kitLibero: 0xe0303a,
  rival: { kitShirt: 0x1f9a4a, kitAccent: 0xffffff, kitShorts: 0x111111, kitPattern: 'diag', kitLibero: 0xd02a30 } };
r = kit(st2);
var ref2 = kit({ kitShirt: 0xd8262e, kitAccent: 0xffffff, kitShorts: 0x111111, kitPattern: 'liso',
  rival: { kitShirt: 0x1f9a4a, kitAccent: 0xffffff, kitShorts: 0x111111, kitPattern: 'diag', kitLibero: null } });
ok(r.l0 !== 0xe0303a && r.l0 === ref2.l0, 'líbero tuyo calculado ' + hx(r.l0) + ' (= sin dato ' + hx(ref2.l0) + ')');
ok(r.l1 !== 0xd02a30 && r.l1 === ref2.l1, 'líbero rival calculado ' + hx(r.l1) + ' (= sin dato ' + hx(ref2.l1) + ')');
// el líbero rival igual que el tuyo (ambos se distinguen de las camisetas, pero no entre sí) -> el rival se calcula
r = kit({ kitShirt: 0x1b3a8a, kitAccent: 0xffffff, kitShorts: 0x1b3a8a, kitLibero: 0xffd23a,
  rival: { kitShirt: 0x1f9a4a, kitAccent: 0xffffff, kitShorts: 0x111111, kitLibero: 0xffd800 } });
ok(r.l0 === 0xffd23a && r.l1 !== 0xffd800 && r.l1 !== r.l0, 'líberos iguales: tuyo ' + hx(r.l0) + ', rival calculado ' + hx(r.l1));

console.log('3) Rival con camiseta parecida y 2º color distinto -> su 2ª (camiseta = kitAccent)');
r = kit({ kitShirt: 0xd8262e, kitAccent: 0xffffff, kitShorts: 0x111111, kitLibero: 0x9a5cff,
  rival: { kitShirt: 0xc81e28, kitAccent: 0xffd23a, kitShorts: 0x111111, kitPattern: 'franjas', kitLibero: 0x18c8d8 } });
ok(r.t1.base === 0xffd23a, 'camiseta rival = ' + hx(r.t1.base) + ' (su 2º color #ffd23a)');
ok(r.t1.accent === 0xc81e28, 'detalles rival = ' + hx(r.t1.accent) + ' (su 1ª camiseta)');
ok(r.t1.shorts === 0x111111, 'pantalón rival = ' + hx(r.t1.shorts) + ' (el suyo)');
ok(r.l1 === 0x18c8d8, 'el rival con su 2ª conserva su líbero de club ' + hx(r.l1));
// 2º color que se funde con su pantalón (blanco/blanco) -> pantalón = su 1ª camiseta
r = kit({ kitShirt: 0x1b3a8a, kitAccent: 0xffffff, kitShorts: 0x1b3a8a, kitLibero: 0xffd23a,
  rival: { kitShirt: 0x22408f, kitAccent: 0xffffff, kitShorts: 0xf4f4f4, kitLibero: 0xff3fa4 } });
ok(r.t1.base === 0xffffff && r.t1.shorts === 0x22408f, '2ª blanca: camiseta ' + hx(r.t1.base) + ', pantalón ' + hx(r.t1.shorts) + ' (no blanco)');

console.log('4) Rival con 1ª y 2º color parecidos a tu camiseta -> kit de la CPU');
var st4 = { kitShirt: 0xd8262e, kitAccent: 0xffffff, kitShorts: 0x111111, kitLibero: 0xffd23a,
  rival: { kitShirt: 0xc81e28, kitAccent: 0xe8403a, kitShorts: 0x111111, kitLibero: 0x18c8d8 } };
r = kit(st4);
var ref4 = kit({ kitShirt: 0xd8262e, kitAccent: 0xffffff, kitShorts: 0x111111 });
ok(r.t1.base === ref4.t1.base && r.t1.base !== 0xc81e28 && r.t1.base !== 0xe8403a, 'rival con kit de CPU ' + hx(r.t1.base) + ' (= sin Carrera ' + hx(ref4.t1.base) + ')');
ok(r.l1 !== 0x18c8d8, 'con kit de CPU el rival no usa el líbero de su club (' + hx(r.l1) + ')');
ok(r.l0 === 0xffd23a, 'tu líbero de club sigue (' + hx(r.l0) + ')');

console.log('5) Carrera de playa (rival sin kitLibero) con choque -> kit de la CPU como antes');
r = kit({ kitShirt: 0xd8262e, kitAccent: 0xffffff, kitShorts: 0x111111, kitPattern: 'diag',
  rival: { kitShirt: 0xc81e28, kitAccent: 0xffd23a, kitShorts: 0x111111, kitPattern: 'diag' } });
ok(r.t1.base === ref4.t1.base, 'playa: rival ' + hx(r.t1.base) + ' (CPU, sin 2ª)');

console.log('6) Sin datos de Carrera de pista -> igual que antes (huella de 400 casos)');
var seed = 12345; function rnd() { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; }
var PALS = [0xff5a2c, 0x3363ea, 0xd8262e, 0x1f9a4a, 0xffffff, 0x111111, 0xffd23a, 0x9a5cff, 0x18c8d8, 0xf2f4f8, 0x1b2b5a, 0xc81e28];
function col() { return rnd() < 0.5 ? PALS[(rnd() * PALS.length) | 0] : (rnd() * 0x1000000) | 0; }
var PATS = ['diag', 'liso', 'franjas', 'rayas'], acc = 0;
for (var i = 0; i < 400; i++) {
  var st = {};
  if (rnd() < 0.85) { st.kitShirt = col(); st.kitAccent = col(); st.kitShorts = col(); st.kitPattern = PATS[(rnd() * 4) | 0]; }
  if (rnd() < 0.5) st.rival = { kitShirt: rnd() < 0.5 ? st.kitShirt || col() : col(), kitAccent: col(), kitShorts: col(), kitPattern: PATS[(rnd() * 4) | 0] };
  var k = kit(st), s = [k.t0.base, k.t0.accent, k.t0.shorts, k.t1.base, k.t1.accent, k.t1.shorts, k.l0, k.l1].join(',');
  for (var j = 0; j < s.length; j++) acc = (Math.imul(acc, 31) + s.charCodeAt(j)) >>> 0;
}
var FP_OLD = 2432943197;   // huella con el players.js anterior a las equipaciones de club (12-nov-2026)
ok(acc === FP_OLD, 'huella ' + acc + ' (esperada ' + FP_OLD + ')');

console.log('7) Players.rivalKit (muestra del hub) dice lo mismo que setKit en 1ª, 2ª y CPU');
var R7 = [{ kitShirt: 0x1b3a8a, kitAccent: 0xffffff, kitShorts: 0x1b3a8a, kitLibero: 0xffd23a, rival: { kitShirt: 0x1f9a4a, kitAccent: 0xffffff, kitShorts: 0x111111, kitLibero: 0xff3fa4 } },
  { kitShirt: 0xd8262e, kitAccent: 0xffffff, kitShorts: 0x111111, kitLibero: 0x9a5cff, rival: { kitShirt: 0xc81e28, kitAccent: 0xffd23a, kitShorts: 0x111111, kitPattern: 'franjas', kitLibero: 0x18c8d8 } },
  st4];
var K7 = R7.map(function (st) { var q = P.rivalKit(st), k = kit(st); return q && (q.kind === '1a' ? k.t1.base === st.rival.kitShirt : q.kind === '2a' ? k.t1.base === q.shirt && k.t1.accent === q.accent && k.t1.shorts === q.shorts : k.t1.base === ref4.t1.base) ? q.kind : 'MAL'; });
ok(K7.join(',') === '1a,2a,cpu', 'rivalKit: ' + K7.join(', ') + ' (esperado 1a, 2a, cpu)');
ok(P.rivalKit({ kitShirt: 0xd8262e }) === null, 'rivalKit sin rival: null');

console.log(fails ? 'kittest: ' + fails + ' de ' + n + ' FALLAN' : 'kittest: ' + n + ' comprobaciones OK');
process.exit(fails ? 1 : 0);
