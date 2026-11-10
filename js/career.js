/* MAKE THE CUT — js/career.js (owner: ui_main)
 * Modo Carrera 2v2: datos y lógica, sin DOM ni Three (se carga también en node: tools/careertest.js).
 *
 * Tu jugador es un atleta de VB.Prog (st, lvl, xp, pts, bp/bd/beq de VB.Badges) con su propio guardado ('voley3d.career').
 * Empiezas en un club modesto de la liga más baja; el club te pone compañero. 5 ligas de 8 clubes (inventados), temporada =
 * liga a doble vuelta (14 jornadas) + copa de los 4 primeros (semifinales 1-4 y 2-3, final). Cada jornada juegas tu partido de
 * verdad (main.js lo arranca con matchSetup) o lo simulas; el resto se simula (quickSim). Nota del partido 1-10, objetivo del
 * club, confianza del entrenador, ofertas (mitad y final de temporada), ascensos y descensos. Diseño y calibrado en
 * notes/carrera.md.
 *
 * API principal (VB.Career):
 *   exists(), get(), create(o), abandon(), save()
 *   next(c)            → próximo partido tuyo {kind, label, week, round, me, rival, home, away, ovrMe, ovrRival, diff} o null
 *   matchSetup(c)      → opciones para Sim.createGame + equipación (main.js)
 *   ingest(evs, g)     → cuenta tus estadísticas durante el partido (main.js, cada frame de un partido de Carrera)
 *   matchDone(r, st, g)→ cierra tu partido jugado (r = {sets, setScores, win}); devuelve el resumen (también en c.last)
 *   simulateNext(c)    → simula tu partido; devuelve el resumen
 *   table(c, lvl)      → clasificación;  bump(k) / toggleBadge(id) → mejoras del jugador
 *   acceptOffer(i), stay() → fin de temporada (o fichaje en la ventana de mitad de temporada)
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var VB = root.VB = root.VB || {};
  var KEY = 'voley3d.career', VER = 1;
  var KEYS = ['jump', 'speed', 'react', 'recv', 'dig', 'set', 'spike', 'ctl', 'block', 'serve'];
  var WEEKS = 14, MID_WEEK = 7, CLUBS_PER = 8;

  // ------------------------------------------------------------------ ligas
  // ovr = media de atributos de los rivales [peor club, mejor club]; diff = perfil de la IA rival más habitual en la liga (el de
  // cada club sale de su media: difficultyFor / DIFF_AT).
  // xp = multiplicador de la experiencia. ref = error arbitral y challenge (tabla del TRASPASO; sim la aplica con createGame({ref}): g.refErr y g.chalPerSet).
  // Calibrado con la sim en autopilot (notes/carrera.md §Calibrado).
  var REF = {
    low: { p1: 0.55, p2: 0.40, p3: 0.22, d3: 0.25, chal: 0, judges: false, name: 'Error arbitral alto · sin challenge' },
    mid: { p1: 0.45, p2: 0.25, p3: 0.12, d3: 0.15, chal: 0, judges: false, name: 'Error arbitral medio · sin challenge' },
    high: { p1: 0.20, p2: 0.08, p3: 0.02, d3: 0.10, chal: 0, judges: true, name: 'Jueces de línea · sin challenge' },
    top: { p1: 0.20, p2: 0.08, p3: 0.02, d3: 0.10, chal: 2, judges: true, name: 'Jueces de línea · challenge' }
  };
  var LEAGUES = [
    { lvl: 0, name: 'Liga Regional', short: 'Regional', cup: 'Copa Regional', diff: 'easy', ovr: [28, 40], xp: 1, ref: 'low' },
    { lvl: 1, name: 'Liga Nacional', short: 'Nacional', cup: 'Copa Nacional', diff: 'normal', ovr: [38, 50], xp: 1.5, ref: 'mid' },
    { lvl: 2, name: 'Superliga', short: 'Superliga', cup: 'Copa de la Superliga', diff: 'normal', ovr: [48, 61], xp: 2.1, ref: 'mid' },
    { lvl: 3, name: 'Liga Continental', short: 'Continental', cup: 'Copa Continental', diff: 'hard', ovr: [58, 71], xp: 2.8, ref: 'high' },
    { lvl: 4, name: 'Circuito Mundial', short: 'Mundial', cup: 'Final a Cuatro Mundial', diff: 'hard', ovr: [68, 84], xp: 3.6, ref: 'top' }
  ];
  var POINTS = [11, 15, 21, 25];

  // ------------------------------------------------------------------ roles (desviaciones sobre la media; suman 0)
  var ROLES = {
    atk: { name: 'Atacante', hint: 'Remate, salto y bloqueo', off: { jump: 6, speed: 0, react: 0, recv: -7, dig: -4, set: -10, spike: 7, ctl: 3, block: 4, serve: 1 } },
    uni: { name: 'Universal', hint: 'Un poco de todo', off: { jump: 1, speed: 2, react: 2, recv: 1, dig: 1, set: 0, spike: -1, ctl: -2, block: -3, serve: -1 } },
    cr: { name: 'Colocador-receptor', hint: 'Recepción, colocación y defensa', off: { jump: -5, speed: 1, react: 2, recv: 7, dig: 4, set: 9, spike: -8, ctl: 1, block: -7, serve: -4 } }
  };
  var MATE_ROLE = { atk: 'cr', cr: 'atk', uni: 'uni' };
  var START_OVR = 35;

  // ------------------------------------------------------------------ nombres (inventados)
  var CITIES = [
    // nivel 0-2 (de casa)
    'Rocaverde', 'Puertoluz', 'Valdesol', 'Miraflor', 'Castelnube', 'Brisamar', 'Peñaclara', 'Arenalta',
    'Fuenteviva', 'Lomablanca', 'Riosereno', 'Campoalto', 'Salinera', 'Montecielo', 'Villaduna', 'Calarrosa',
    'Pinarejo', 'Torremar', 'Olivarda', 'Cuestaluna', 'Vegaclara', 'Sotoazul', 'Maresia', 'Altobrío',
    // nivel 3-4 (de fuera)
    'Brennvik', 'Solmara', 'Kastelheim', 'Ardenza', 'Velmora', 'Quintavalle', 'Marisport', 'Duneholm',
    'Altavera', 'Rivenza', 'Lunaport', 'Sankora', 'Teravento', 'Ombralia', 'Nevaro', 'Calyra'
  ];
  var PREFIX = ['CV', 'Club Vóley', 'Unión', 'Atlético', 'Deportivo', 'Vóley', 'Sporting', 'Olímpico', 'Real Club', 'AD'];
  var SUFFIX = ['', '', '', ' Playa', ' Norte', ' Sur', ' 1924', ' Atlántico', ' Costa', ' Mar'];
  var FIRST = ['Álex', 'Nico', 'Dani', 'Iker', 'Marc', 'Pablo', 'Leo', 'Hugo', 'Unai', 'Bruno', 'Raúl', 'Joel', 'Sergi', 'Ander', 'Rubén', 'Teo',
    'Lucas', 'Gael', 'Mateo', 'Íñigo', 'Pau', 'Óscar', 'Jon', 'Adri', 'Lars', 'Mikko', 'Tomás', 'Elio', 'Bastian', 'Kai'];
  var LAST = ['Arnedo', 'Vallés', 'Cortina', 'Molinar', 'Serrat', 'Ibarra', 'Quiles', 'Lasierra', 'Ferrán', 'Robledo', 'Almagro', 'Urquiza',
    'Sotelo', 'Pardiñas', 'Ocaña', 'Villar', 'Brandt', 'Lindqvist', 'Moretti', 'Kovač', 'Ferreira', 'Dubois', 'Halvorsen', 'Novák', 'Aranda', 'Belmonte'];
  // equipaciones con los valores del menú Ajustes · Equipación (players.js setKit los entiende igual)
  var SHIRTS = [0xff5a2c, 0xd8262e, 0xf2c230, 0x1f9a4a, 0x32b5e8, 0x7b3fd1, 0x22252c, 0xf2f4f8];
  var ACCENTS = [0xffb238, 0xffffff, 0x1a1c22, 0xd9a520, 0x8fd3ff, 0xff4040];
  var SHORTS = [0x191b22, 0xeceef2, 0x18244a, 0xb3161d, 0x5a606b];
  var PATTERNS = ['diag', 'liso', 'franjas', 'rayas'];

  // ------------------------------------------------------------------ utilidades
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clampI(v, a, b) { v = Math.round(+v); return isFinite(v) ? clamp(v, a, b) : a; }
  function rng(seed) {   // mulberry32
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash() { var h = 2166136261; for (var i = 0; i < arguments.length; i++) { var s = String(arguments[i]); for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 16777619); } h ^= 124; } return h >>> 0; }
  function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }
  function shuffle(r, a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function P() { return VB.Prog || null; }
  function B() { return VB.Badges || null; }
  function ovrOf(st) { var s = 0; for (var i = 0; i < KEYS.length; i++) s += st[KEYS[i]]; return Math.round(s / KEYS.length); }
  function costOf(v) { var p = P(); return p && p.cost ? p.cost(v) : (v < 50 ? 1 : v < 65 ? 2 : v < 80 ? 3 : 4); }
  function round1(v) { return Math.round(v * 10) / 10; }

  /** Atributos de un jugador de media o y rol role (ruido determinista con r). La media sale exacta (±0,5). */
  function genSt(o, role, r) {
    var off = (ROLES[role] || ROLES.uni).off, st = {}, k, sum = 0;
    var sc = clamp(0.7 + o / 100, 0.8, 1.5);   // los buenos están más especializados
    for (k = 0; k < KEYS.length; k++) { var key = KEYS[k]; st[key] = o + off[key] * sc + (r ? (r() - 0.5) * 6 : 0); sum += st[key]; }
    var d = o - sum / KEYS.length;
    for (k = 0; k < KEYS.length; k++) st[KEYS[k]] = clampI(st[KEYS[k]] + d, 1, 99);
    return st;
  }

  // ------------------------------------------------------------------ progresión propia de la Carrera
  // La experiencia de la Carrera es más generosa que la de Partido rápido (la temporada tiene 16-17 partidos y hay que llegar
  // a la élite en ~6-8 temporadas): ver notes/carrera.md §Progresión.
  var PTS_LVL = 4;
  function need(lvl) { return 140 + 6 * lvl; }
  function addXP(a, xp) {
    var up = 0;
    a.xp += xp; a.matches = (a.matches | 0) + 1;
    while (a.xp >= need(a.lvl)) { a.xp -= need(a.lvl); a.lvl++; up++; a.pts += PTS_LVL; }
    return { xp: xp, lvlUp: up, pts: up * PTS_LVL, lvl: a.lvl };
  }

  // ------------------------------------------------------------------ almacenamiento
  var cur = null;
  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  function save(c) {
    c = c || cur; if (!c) return false;
    try { var s = store(); if (!s) return false; s.setItem(KEY, JSON.stringify(c)); return true; } catch (e) { return false; }
  }
  var lost = false;   // había una carrera guardada que no se ha podido recuperar (copia en KEY + '.bak'); la UI lo avisa
  function load() {
    if (cur) return cur;
    var o = null, raw = null, s = null;
    try { s = store(); raw = s ? s.getItem(KEY) : null; o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
    cur = sane(o);
    if (!cur && raw) {
      lost = true;
      try { if (s) { s.setItem(KEY + '.bak', raw); s.removeItem(KEY); } } catch (e) { }
    }
    return cur;
  }
  function sane(o) {
    if (!o || typeof o !== 'object' || o.v !== VER || !o.player || typeof o.player !== 'object' || !Array.isArray(o.clubs) || !o.clubs.length) return null;
    var p = P();
    if (p && p.saneAthlete) {
      var d = p.newAthlete({ num: o.player.num, role: o.player.role, name: o.player.name });
      o.player = (function (src, dst) { p.saneAthlete(src, dst); dst.roleKey = ROLES[src.roleKey] ? src.roleKey : 'uni'; dst.age = clampI(src.age, 15, 60); return dst; })(o.player, d);
    }
    if (POINTS.indexOf(o.points) < 0) o.points = 15;
    if (o.ctrl !== 'both') o.ctrl = 'one';
    try { return saneDeep(o); } catch (e) { return null; }
  }
  /** Repara lo reparable de un guardado tocado o a medias (antes solo se miraba el primer nivel y un `sched` o un `myClub` malos
   *  dejaban el hub vacío, con errores, o atascado sin partido). Lo irreparable (clubes) → null (y copia en KEY + '.bak'). */
  function saneDeep(o) {
    var arr = Array.isArray, num = function (v) { return typeof v === 'number' && isFinite(v); };
    // clubes: id, nivel, q y equipación válidos; 8 por liga
    var okClub = function (k) { return k && num(k.id) && num(k.lvl) && k.lvl >= 0 && k.lvl < LEAGUES.length && num(k.q) && typeof k.name === 'string' && k.kit && typeof k.kit === 'object'; };
    if (!o.clubs.every(okClub)) return null;
    for (var L = 0; L < LEAGUES.length; L++) if (clubsOf(o, L).length !== CLUBS_PER) return null;
    o.clubs.forEach(function (k) { k.q = clamp(k.q, 0.02, 0.98); if (typeof k.short !== 'string') k.short = abbr(k.name); if (typeof k.city !== 'string') k.city = ''; });
    if (!myClub(o)) return null;
    o.seed = num(o.seed) ? o.seed >>> 0 : hash('reparado', o.created || 0);
    o.season = clampI(o.season, 1, 999);
    // compañero
    if (!o.mate || typeof o.mate !== 'object' || !o.mate.st || typeof o.mate.st !== 'object') o.mate = newMate(o, myClub(o), rng(hash(o.seed, 'mate', o.season)));
    KEYS.forEach(function (k) { o.mate.st[k] = clampI(o.mate.st[k], 1, 99); });
    if (typeof o.mate.name !== 'string') o.mate.name = 'Compañero';
    o.mate.num = clampI(o.mate.num, 1, 99);
    // calendario y resultados: 5 ligas × 14 jornadas × 4 partidos con ids de su liga
    var okSched = arr(o.sched) && o.sched.length === LEAGUES.length && o.sched.every(function (s, L) {
      var ids = clubsOf(o, L).map(function (k) { return k.id; });
      return arr(s) && s.length === WEEKS && s.every(function (wk) { return arr(wk) && wk.length === CLUBS_PER / 2 && wk.every(function (m) { return arr(m) && ids.indexOf(m[0]) >= 0 && ids.indexOf(m[1]) >= 0; }); });
    });
    if (!okSched) { genSchedule(o); o.week = 0; if (o.phase !== 'off') o.phase = 'league'; o.cup = null; }
    if (!arr(o.res) || o.res.length !== LEAGUES.length) o.res = LEAGUES.map(function () { return []; });
    o.res = o.res.map(function (lr) { return arr(lr) ? lr.map(function (wk) { return arr(wk) ? wk.map(function (m) { return m && arr(m.s) && arr(m.sc) ? m : null; }) : []; }) : []; });
    // listas y números sueltos
    ['notes', 'offers', 'history', 'trophies'].forEach(function (k) { if (!arr(o[k])) o[k] = []; });
    o.notes = o.notes.filter(function (n) { return n && num(n.nota); });
    o.offers = o.offers.filter(function (x) { return x && club(o, x.club); });
    if (!o.stats || typeof o.stats !== 'object') o.stats = newSeasonStats();
    if (!o.career || typeof o.career !== 'object') o.career = newSeasonStats();
    [o.stats, o.career].forEach(function (x) { var z = newSeasonStats(); for (var k in z) if (!num(x[k])) x[k] = 0; });
    o.coach = num(o.coach) ? clamp(Math.round(o.coach), 0, 100) : 50;
    if (!o.objective || typeof o.objective.text !== 'string' || !num(o.objective.pos)) o.objective = makeObjective(o);
    if (o.last && (!o.last.me || !arr(o.last.sets) || !arr(o.last.setScores))) o.last = null;
    if (o.window !== 'mid' && o.window !== 'end') o.window = '';
    // fase y jornada
    if (['league', 'cup', 'off'].indexOf(o.phase) < 0) o.phase = 'league';
    o.week = clampI(o.week, 0, WEEKS);
    if (o.phase === 'league' && o.week >= WEEKS) { cur = o; startCup(o); }
    if (o.phase === 'cup') {
      var cu = o.cup, okId = function (id) { var k = club(o, id); return k && k.lvl === myClub(o).lvl; };
      var okCup = cu && typeof cu === 'object' && arr(cu.semis) && cu.semis.length === 2 && cu.semis.every(function (m) { return arr(m) && okId(m[0]) && okId(m[1]); }) &&
        arr(cu.res) && (cu.round === 0 || (cu.round === 1 && arr(cu.final) && okId(cu.final[0]) && okId(cu.final[1])));
      if (!okCup) { cur = o; startCup(o); }
    }
    if (o.phase === 'off') {
      var me = myClub(o);
      if (!o.review || typeof o.review !== 'object') o.review = { season: o.season, pos: posOf(o, me.id), lvl: me.lvl, objective: o.objective.text, objOk: false, champion: false, cup: false, move: 0, nota: avgNota(o), coach: o.coach, moves: [] };
      if (!arr(o.pendingMoves)) o.pendingMoves = [];
      o.window = 'end';
    }
    if (o.phase !== 'off' && !myFixture(o) && o.phase === 'league') { genSchedule(o); o.week = 0; }   // sin partido tuyo: calendario nuevo
    return o;
  }
  function exists() { return !!load(); }
  function get() { return load(); }
  function abandon() { cur = null; M = null; lost = false; try { var s = store(); if (s) s.removeItem(KEY); } catch (e) { } return true; }

  // ------------------------------------------------------------------ clubes y calendario
  function league(lvl) { return LEAGUES[clamp(lvl | 0, 0, LEAGUES.length - 1)]; }
  function clubOvr(club) { var L = league(club.lvl); return Math.round(L.ovr[0] + (L.ovr[1] - L.ovr[0]) * club.q); }
  function club(c, id) { for (var i = 0; i < c.clubs.length; i++) if (c.clubs[i].id === id) return c.clubs[i]; return null; }
  function myClub(c) { return club(c, c.myClub); }
  function clubsOf(c, lvl) { return c.clubs.filter(function (k) { return k.lvl === lvl; }); }
  function abbr(name) {
    var w = name.replace(/^(CV|AD|Club Vóley|Real Club|Unión|Atlético|Deportivo|Vóley|Sporting|Olímpico)\s+/, '').split(/\s+/)[0];
    return w.normalize ? w.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3).toUpperCase() : w.slice(0, 3).toUpperCase();
  }
  function genClubs(r) {
    var out = [], used = {};
    for (var L = 0; L < LEAGUES.length; L++) {
      var qs = []; for (var i = 0; i < CLUBS_PER; i++) qs.push((i + 0.5) / CLUBS_PER);
      shuffle(r, qs);
      for (var j = 0; j < CLUBS_PER; j++) {
        var idx = L * CLUBS_PER + j, city = CITIES[idx], name;
        do { name = pick(r, PREFIX) + ' ' + city + pick(r, SUFFIX); } while (used[name]);
        used[name] = 1;
        var shirt = pick(r, SHIRTS), acc = pick(r, ACCENTS), sh = pick(r, SHORTS);
        if (acc === shirt) acc = ACCENTS[(ACCENTS.indexOf(acc) + 1) % ACCENTS.length];
        out.push({ id: idx, name: name, city: city, short: abbr(name), lvl: L, q: round1(clamp(qs[j] + (r() - 0.5) * 0.08, 0.02, 0.98) * 10) / 10,
          kit: { shirt: shirt, accent: acc, shorts: sh, pattern: pick(r, PATTERNS) } });
      }
    }
    // abreviaturas únicas
    var seen = {};
    out.forEach(function (k) { var a = k.short, n = 1; while (seen[a]) { a = k.short.slice(0, 2) + (n++); } seen[a] = 1; k.short = a; });
    return out;
  }
  /** Liga a doble vuelta (método del círculo): 14 jornadas de 4 partidos [local, visitante]. */
  function roundRobin(ids, r) {
    var t = shuffle(r, ids.slice()), n = t.length, weeks = [];
    for (var w = 0; w < n - 1; w++) {
      var wk = [];
      for (var i = 0; i < n / 2; i++) { var a = t[i], b = t[n - 1 - i]; wk.push(w % 2 ? [b, a] : [a, b]); }
      weeks.push(wk);
      t.splice(1, 0, t.pop());   // rota todos menos el primero
    }
    var back = weeks.map(function (wk) { return wk.map(function (m) { return [m[1], m[0]]; }); });
    return weeks.concat(back);
  }
  function genSchedule(c) {
    var r = rng(hash(c.seed, 'sched', c.season)), sched = [], res = [];
    for (var L = 0; L < LEAGUES.length; L++) {
      sched.push(roundRobin(clubsOf(c, L).map(function (k) { return k.id; }), r));
      res.push([]);
    }
    c.sched = sched; c.res = res;
  }

  // ------------------------------------------------------------------ simulación rápida
  /** Partido al mejor de 3 punto a punto: prob. de ganar cada punto 0,5 + 0,009 × (oa − ob) (0,2-0,8). */
  function quickSim(oa, ob, r, points) {
    points = points || 15;
    var pA = clamp(0.5 + 0.009 * (oa - ob), 0.2, 0.8), sets = [0, 0], sc = [];
    while (sets[0] < 2 && sets[1] < 2) {
      var tgt = sets[0] + sets[1] === 2 ? Math.min(15, points) : points, a = 0, b = 0;
      while (!((a >= tgt || b >= tgt) && Math.abs(a - b) >= 2)) { if (r() < pA) a++; else b++; }
      sc.push([a, b]); sets[a > b ? 0 : 1]++;
    }
    return { sets: sets, setScores: sc };
  }
  function setPts(s) { return s[0] === 2 ? (s[1] === 0 ? [3, 0] : [2, 1]) : (s[0] === 0 ? [0, 3] : [1, 2]); }

  // ------------------------------------------------------------------ jugador y compañero
  function playerOvr(c) { return ovrOf(c.player.st); }
  function mateOvr(c) { return ovrOf(c.mate.st); }
  function newMate(c, k, r) {
    var role = MATE_ROLE[c.player.roleKey] || 'uni', o = clamp(clubOvr(k) + 3, 25, 88);
    var num; do { num = 1 + Math.floor(r() * 24); } while (num === c.player.num);
    if (c.player.num !== 2) num = 2; // el compañero lleva el 2 (como en Partido rápido); si es el tuyo, el sorteado (misma tirada)
    return { name: pick(r, FIRST) + ' ' + pick(r, LAST), num: num, roleKey: role, role: ROLES[role].name, st: genSt(o, role, r) };
  }
  function badgePower(a) { var b = a.beq || [], s = 0; for (var i = 0; i < b.length; i++) s += (a.bd && a.bd[b[i]]) | 0; return s; }
  /** Fuerza de tu pareja para la simulación rápida: media de los dos + insignias + forma. */
  function teamOvr(c) {
    var f = form(c);
    return 0.5 * playerOvr(c) + 0.5 * mateOvr(c) + 0.35 * badgePower(c.player) + (f == null ? 0 : (f - 6.5) * 0.8);
  }
  function form(c) { var n = c.notes || []; if (!n.length) return null; var s = 0, k = Math.min(3, n.length); for (var i = n.length - k; i < n.length; i++) s += n[i].nota; return s / k; }
  function avgNota(c) { var n = c.notes || []; if (!n.length) return null; var s = 0; n.forEach(function (x) { s += x.nota; }); return round1(s / n.length); }

  // ------------------------------------------------------------------ objetivos y entrenador
  function expectedPos(c, k) {
    var lst = clubsOf(c, k.lvl).map(clubOvr).sort(function (a, b) { return b - a; });
    return lst.indexOf(clubOvr(k)) + 1;
  }
  function makeObjective(c) {
    var k = myClub(c), e = expectedPos(c, k), top = k.lvl === LEAGUES.length - 1, low = k.lvl === 0;
    if (e <= 2) return top ? { pos: 1, text: 'Ganar el ' + league(k.lvl).name } : { pos: 2, text: 'Subir de categoría (quedar entre los 2 primeros)' };
    if (e <= 4) return { pos: 4, text: 'Quedar entre los 4 primeros (y jugar la copa)' };
    if (e <= 6) return { pos: 6, text: 'Terminar en mitad de tabla (entre los 6 primeros)' };
    return low ? { pos: 7, text: 'No acabar último' } : { pos: 6, text: 'Evitar el descenso' };
  }
  function coachText(v) { return v < 30 ? 'Descontento' : v < 50 ? 'Tiene dudas' : v < 70 ? 'Confía en ti' : v < 85 ? 'Pieza clave' : 'Intocable'; }

  // ------------------------------------------------------------------ crear carrera
  function create(o) {
    o = o || {};
    var seed = (o.seed != null ? +o.seed : (Date.now() ^ (Math.random() * 1e9))) >>> 0, r = rng(seed);
    var roleKey = ROLES[o.role] ? o.role : 'atk', p = P();
    var name = String(o.name || '').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Jugador';
    var num = clampI(o.num != null ? o.num : 1, 1, 99), st = genSt(START_OVR, roleKey, null);
    var player = p && p.newAthlete ? p.newAthlete({ num: num, role: ROLES[roleKey].name, name: name, st: st })
      : { num: num, role: ROLES[roleKey].name, name: name, lvl: 1, xp: 0, pts: 0, st: st, matches: 0, bp: {}, bd: {}, beq: [] };
    player.roleKey = roleKey; player.age = 18;
    var c = { v: VER, seed: seed, created: o.now || Date.now(), points: POINTS.indexOf(+o.points) >= 0 ? +o.points : 15, ctrl: o.ctrl === 'both' ? 'both' : 'one',
      season: 1, week: 0, phase: 'league', player: player, clubs: genClubs(r), myClub: -1, mate: null, sched: null, res: null,
      cup: null, notes: [], coach: 50, objective: null, offers: [], window: '', review: null, last: null,
      stats: newSeasonStats(), career: newSeasonStats(), history: [], trophies: [] };
    // club modesto de la Liga Regional (de los peores, pero no el último)
    var reg = clubsOf(c, 0).sort(function (a, b) { return a.q - b.q; });
    var start = reg[1 + Math.floor(r() * 2)];
    c.myClub = start.id;
    c.mate = newMate(c, start, r);
    genSchedule(c);
    c.objective = makeObjective(c);
    cur = c; M = null; lost = false; save(c);
    return c;
  }
  function newSeasonStats() { return { played: 0, won: 0, sim: 0, pts: 0, kills: 0, aces: 0, blocks: 0, assists: 0, digs: 0, errors: 0 }; }

  // ------------------------------------------------------------------ próximo partido
  function myFixture(c) {
    var k = myClub(c); if (!k) return null;
    if (c.phase === 'league') {
      var wk = c.sched[k.lvl] && c.sched[k.lvl][c.week]; if (!wk) return null;
      for (var i = 0; i < wk.length; i++) if (wk[i][0] === k.id || wk[i][1] === k.id) return { kind: 'league', week: c.week, i: i, home: wk[i][0], away: wk[i][1] };
      return null;
    }
    if (c.phase === 'cup' && c.cup) {
      var rd = c.cup.round, ms = rd === 0 ? c.cup.semis : [c.cup.final];
      for (var j = 0; j < ms.length; j++) if (ms[j] && (ms[j][0] === k.id || ms[j][1] === k.id) && !(c.cup.res[rd] && c.cup.res[rd][j])) return { kind: 'cup', round: rd, i: j, home: ms[j][0], away: ms[j][1] };
    }
    return null;
  }
  /** Perfil de la IA rival según la media del club (calibrado en notes/carrera.md: el perfil pesa mucho más que los atributos). */
  var DIFF_AT = [[80, 'expert'], [52, 'hard'], [38, 'normal'], [0, 'easy']];
  function difficultyFor(rival) {
    // en la Liga Regional siempre Fácil: con la IA Normal los 1-2 mejores clubes (media ≥ 38) eran un muro (el bot «medio»
    // de simtest, con tu media 35, ganaba el 100 % contra los de Fácil y el 10 % contra esos; el novato, del 60 % al 0 %)
    if ((rival.lvl | 0) === 0) return 'easy';
    var o = clubOvr(rival);
    for (var i = 0; i < DIFF_AT.length; i++) if (o >= DIFF_AT[i][0]) return DIFF_AT[i][1];
    return 'easy';
  }
  function next(c) {
    c = c || load(); if (!c) return null;
    var f = myFixture(c); if (!f) return null;
    var me = myClub(c), riv = club(c, f.home === me.id ? f.away : f.home), L = league(me.lvl);
    var label = f.kind === 'league' ? L.name + ' · Jornada ' + (f.week + 1) + ' de ' + WEEKS
      : L.cup + ' · ' + (f.round === 0 ? 'Semifinal' : 'Final');
    return { kind: f.kind, week: f.week, round: f.round, i: f.i, label: label, home: club(c, f.home), away: club(c, f.away), me: me, rival: riv,
      atHome: f.home === me.id, ovrMe: Math.round(teamOvr(c)), ovrRival: clubOvr(riv), diff: difficultyFor(riv) };
  }

  /** Opciones del partido de Carrera para Sim.createGame (+ kit para Players.setKit y datos para la UI). */
  function matchSetup(c) {
    c = c || load(); var n = next(c); if (!n) return null;
    var r = rng(hash(c.seed, 'riv', c.season, c.phase, n.week, n.round, n.rival.id)), ro = n.ovrRival;
    var rivA = genSt(clamp(ro + 1, 1, 99), 'atk', r), rivB = genSt(clamp(ro - 1, 1, 99), 'cr', r);
    var bd = B() && B().forPlayer ? B().forPlayer(c.player) : null;
    if (bd && !Object.keys(bd).length) bd = null;
    var k = n.me.kit;
    return {
      attrs: [[copy(c.player.st), copy(c.mate.st)], [rivA, rivB]],
      badges: bd ? [[bd, null], null] : null,
      points: c.points, difficulty: n.diff, ctrl: c.ctrl, ctrlIdx: 0,
      ref: copy(REF[league(n.me.lvl).ref]),
      kit: { kitShirt: k.shirt, kitAccent: k.accent, kitShorts: k.shorts, kitPattern: k.pattern },
      rivalKit: { kitShirt: n.rival.kit.shirt, kitAccent: n.rival.kit.accent, kitShorts: n.rival.kit.shorts, kitPattern: n.rival.kit.pattern },
      career: { season: c.season, phase: c.phase, week: n.week, round: n.round, label: n.label, me: n.me.short, rival: n.rival.short,
        meName: n.me.name, rivalName: n.rival.name, player: c.player.name, num: c.player.num, mate: c.mate.name, mateNum: c.mate.num }
    };
  }

  // ------------------------------------------------------------------ estadísticas del partido jugado
  var M = null;
  function newM(g) {
    var z = function () { return { kills: 0, aces: 0, blocks: 0, assists: 0, digs: 0, errors: 0, recvP: 0, perfect: 0, good: 0, poor: 0, serves: 0 }; };
    return { g: g, p: [z(), z()], last0: -1, lastTeam: -1, server: -1, setter: -1, cand: -1, blocker: -1, prevKind: '', prevTeam: -1, rallies: 0 };
  }
  function slotOf(g, pl) { if (!pl || !g || !g.teams) return -1; var t = g.teams[0]; return t[0] === pl ? 0 : t[1] === pl ? 1 : -1; }
  /** Cuenta los eventos de un partido de Carrera (g.career). main.js la llama con los eventos de cada frame. */
  function ingest(evs, g) {
    if (!g || !g.career || g.demo || g.autopilot || !evs) return;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i]; if (!e) continue;
      if (e.type === 'newMatch') { M = newM(g); continue; }
      if (!M || M.g !== g) M = newM(g);
      var s;
      if (e.type === 'hit') {
        if (e.team === 0) {
          s = slotOf(g, e.player); M.last0 = s; M.lastTeam = 0;
          if (s >= 0) {
            var q = M.p[s];
            if (e.human) { if (e.grade === 'perfect') q.perfect++; else if (e.grade === 'good') q.good++; else if (e.grade === 'poor') q.poor++; }
            if (e.kind === 'serve') { M.server = s; q.serves++; M.setter = -1; M.cand = -1; M.blocker = -1; }
            else {
              var recv = e.recv != null ? !!e.recv : (e.touch === 1 && M.prevKind === 'serve' && M.prevTeam === 1);
              var dig = e.dig != null ? !!e.dig : (e.touch === 1 && M.prevKind === 'spike' && M.prevTeam === 1 && e.shot !== 'shank');
              if (recv && e.grade === 'perfect') q.recvP++;
              if (dig) q.digs++;
              if (e.touch === 1) { M.setter = -1; M.cand = -1; }
              if (e.touch === 2 && e.kind !== 'spike') M.setter = s;
              if (e.kind === 'spike') M.cand = e.touch === 3 && M.setter >= 0 && M.setter !== s ? M.setter : -1;
            }
          }
        } else { M.lastTeam = 1; if (e.kind === 'serve') { M.server = -1; M.setter = -1; M.cand = -1; M.blocker = -1; } }
        M.prevKind = e.kind; M.prevTeam = e.team;
      } else if (e.type === 'block') {
        if (e.team === 0) M.blocker = slotOf(g, e.player);
        M.prevKind = 'block'; M.prevTeam = e.team;
      } else if (e.type === 'point') {
        M.rallies++;
        if (e.team === 0) {
          if ((e.how === 'kill' || e.how === 'tip') && M.last0 >= 0) {
            M.p[M.last0].kills++;
            var as = e.assist !== undefined ? slotOf(g, e.assist) : M.cand;
            if (as >= 0 && as !== M.last0) M.p[as].assists++;
          } else if (e.how === 'ace' && M.server >= 0) M.p[M.server].aces++;
          else if (e.how === 'block' && M.blocker >= 0) M.p[M.blocker].blocks++;
        } else {
          var fp = e.player && e.player.team === 0 ? slotOf(g, e.player) : -1;
          if (fp >= 0) M.p[fp].errors++;
          else if (e.how === 'error' && M.lastTeam === 0 && M.last0 >= 0) M.p[M.last0].errors++;
        }
        M.last0 = -1; M.lastTeam = -1; M.server = -1; M.setter = -1; M.cand = -1; M.blocker = -1; M.prevKind = ''; M.prevTeam = -1;
      }
    }
  }
  function abortMatch() { M = null; }

  /** Nota 1-10 del partido (estilo periódico deportivo). me = estadísticas de tu jugador; r = {win, sets}. */
  // Calibrado (arreglos finales del sprint): con control «uno» tu jugador remata casi todo (15-18 remates punto por partido), así
  // que con el remate a 0,32 la nota se iba casi siempre a 10. Pesos medidos con los bots de simtest en la Regional (temporada 1):
  // novato ~6,3, medio ~7,5, bueno ~8,5; por encima de 8,5 la nota se comprime (techo suave) para que 10 sea excepcional.
  var RATE_W = { kills: 0.055, aces: 0.2, blocks: 0.2, assists: 0.045, digs: 0.035, recvP: 0.03, perfect: 0.02, poor: -0.015, errors: -0.17 };
  function rating(me, r, rallies) {
    me = me || {};
    var k = 40 / Math.max(24, rallies || 40);   // por cada 40 puntos jugados (partidos a 11 y a 25 comparables)
    var v = 0;
    for (var key in RATE_W) v += RATE_W[key] * (me[key] || 0);
    var res = r.win ? (r.sets && r.sets[1] === 0 ? 0.9 : 0.6) : (r.sets && r.sets[0] === 1 ? -0.3 : -0.6);
    var raw = 5.4 + v * k + res;
    if (raw > 8.5) raw = 8.5 + 1.5 * (1 - Math.exp(-(raw - 8.5) / 1.5));   // techo suave: 10 solo con un partido descomunal
    return round1(clamp(raw, 1, 10));
  }

  // ------------------------------------------------------------------ cerrar un partido tuyo
  function recordMine(c, f, sets, setScores) {
    var me = myClub(c), mine = f.home === me.id, s = mine ? sets : [sets[1], sets[0]], sc = setScores.map(function (x) { return mine ? x.slice() : [x[1], x[0]]; });
    var rec = { a: f.home, b: f.away, s: s, sc: sc, mine: 1 };
    if (f.kind === 'league') { (c.res[me.lvl][f.week] = c.res[me.lvl][f.week] || [])[f.i] = rec; }
    else { (c.cup.res[f.round] = c.cup.res[f.round] || [])[f.i] = rec; }
    return rec;
  }
  /** Simula lo que queda de la jornada (todas las ligas) y avanza. Devuelve los resultados de tu liga. */
  function finishRound(c) {
    var me = myClub(c), out = [];
    if (c.phase === 'league') {
      for (var L = 0; L < LEAGUES.length; L++) {
        var wk = c.sched[L][c.week], arr = c.res[L][c.week] = c.res[L][c.week] || [];
        for (var i = 0; i < wk.length; i++) {
          if (!arr[i]) {
            var a = club(c, wk[i][0]), b = club(c, wk[i][1]), r = rng(hash(c.seed, 'm', c.season, L, c.week, i));
            var q = quickSim(clubOvr(a) + (r() - 0.5) * 4, clubOvr(b) + (r() - 0.5) * 4, r, c.points);
            arr[i] = { a: a.id, b: b.id, s: q.sets, sc: q.setScores };
          }
          if (L === me.lvl) out.push(arr[i]);
        }
      }
      c.week++;
      c.offers = c.window === 'mid' ? [] : c.offers; if (c.window === 'mid') c.window = '';
      if (c.week === MID_WEEK) midWindow(c);
      if (c.week >= WEEKS) startCup(c);
    } else if (c.phase === 'cup') {
      var cu = c.cup, rd = cu.round, ms = rd === 0 ? cu.semis : [cu.final], ar = cu.res[rd] = cu.res[rd] || [];
      for (var j = 0; j < ms.length; j++) {
        if (!ar[j]) {
          var ca = club(c, ms[j][0]), cb = club(c, ms[j][1]), r2 = rng(hash(c.seed, 'cup', c.season, rd, j));
          var q2 = quickSim(clubOvr(ca) + (r2() - 0.5) * 4, clubOvr(cb) + (r2() - 0.5) * 4, r2, c.points);
          ar[j] = { a: ca.id, b: cb.id, s: q2.sets, sc: q2.setScores };
        }
        out.push(ar[j]);
      }
      if (rd === 0) { cu.final = [winnerOf(ar[0]), winnerOf(ar[1])]; cu.round = 1; }
      else { cu.champion = winnerOf(ar[0]); cu.round = 2; endSeason(c); }
      // sin ti en la final: se juega sola
      if (c.phase === 'cup' && cu.round === 1 && !myFixture(c)) return out.concat(finishRound(c));
    }
    return out;
  }
  function winnerOf(m) { return m.s[0] > m.s[1] ? m.a : m.b; }
  function startCup(c) {
    var me = myClub(c), t = table(c, me.lvl);
    c.phase = 'cup';
    c.cup = { lvl: me.lvl, semis: [[t[0].id, t[3].id], [t[1].id, t[2].id]], final: null, res: [], round: 0, champion: -1 };
    if (!myFixture(c)) finishRound(c);   // no clasificado: la copa se juega sola
  }

  /** Resumen común a partido jugado y simulado: nota, experiencia, entrenador, insignias, resto de la jornada. */
  function closeMine(c, f, res, me, sim, extra) {
    var win = res.sets[0] > res.sets[1], L = league(myClub(c).lvl), rival = club(c, f.home === c.myClub ? f.away : f.home);
    var nota = me.nota;
    var mpts = (me.kills || 0) + (me.aces || 0) + (me.blocks || 0);
    // tus puntos cuentan hasta 10 por partido (con control «uno» rematas casi todo y la XP jugada se disparaba)
    var xp = Math.round((40 + 22 * nota + (win ? 40 : 0) + 6 * Math.min(mpts, 10)) * L.xp * (sim ? 0.5 : 1));
    var lv = addXP(c.player, xp);
    // entrenador
    c.coach = clamp(Math.round(c.coach + (nota - 6.2) * 2.5 + (win ? 1 : -1)), 0, 100);
    // temporada
    var S = c.stats, T = c.career;
    [S, T].forEach(function (x) {
      x.played++; if (win) x.won++; if (sim) x.sim++;
      x.pts += mpts; x.kills += me.kills || 0; x.aces += me.aces || 0; x.blocks += me.blocks || 0; x.assists += me.assists || 0; x.digs += me.digs || 0; x.errors += me.errors || 0;
    });
    c.notes.push({ nota: nota, win: win ? 1 : 0, sim: sim ? 1 : 0, kind: f.kind, wk: f.kind === 'league' ? f.week : f.round, rival: rival.id, s: res.sets.slice() });
    var badges = extra && extra.badges || [];
    var label = f.kind === 'league' ? 'Jornada ' + (f.week + 1) : (f.round === 0 ? 'Semifinal de copa' : 'Final de copa');
    var phase0 = c.phase, season0 = c.season;
    recordMine(c, f, res.sets, res.setScores);
    var round = finishRound(c);
    var sum = { season: season0, phase: phase0, label: label, rival: rival.id, rivalName: rival.name, win: win, sets: res.sets.slice(), setScores: res.setScores.map(function (x) { return x.slice(); }),
      sim: !!sim, nota: nota, me: me, xp: xp, lvlUp: lv.lvlUp, lvl: lv.lvl, ptsGained: lv.pts, badges: badges, coach: c.coach,
      round: round.map(function (m) { return { a: m.a, b: m.b, s: m.s }; }), offers: c.window === 'mid' ? c.offers.length : 0, review: phase0 !== c.phase && c.phase === 'off' };
    c.last = sum;
    save(c);
    return sum;
  }

  /** main.js, al llegar gameOver de un partido de Carrera: r = {sets:[tú, rival], setScores, win}. stats = tus números (opcional). */
  function matchDone(r, stats, g) {
    var c = load(); if (!c || !r || !r.sets) return null;
    var f = myFixture(c); if (!f) return null;
    var m = M && (!g || M.g === g) ? M : newM(g);
    var me = stats || m.p[0];
    var rallies = m.rallies || (r.setScores || []).reduce(function (s, x) { return s + x[0] + x[1]; }, 0);
    var res = { sets: [r.sets[0] | 0, r.sets[1] | 0], setScores: (r.setScores || []).map(function (x) { return [x[0] | 0, x[1] | 0]; }) };
    var win = res.sets[0] > res.sets[1];
    var mine = { kills: me.kills | 0, aces: me.aces | 0, blocks: me.blocks | 0, assists: me.assists | 0, digs: me.digs | 0, errors: me.errors | 0,
      recvP: me.recvP | 0, perfect: me.perfect | 0, good: me.good | 0, poor: me.poor | 0 };
    // con «Los dos» llevas a la pareja entera: la nota mide lo que hacen los dos (con «uno», solo tu jugador)
    var rt = mine;
    if (c.ctrl === 'both' && !stats && m.p[1]) { rt = {}; for (var kk in mine) rt[kk] = (mine[kk] | 0) + (m.p[1][kk] | 0); rt.kills = Math.round(rt.kills * 0.85); }
    mine.nota = rating(rt, { win: win, sets: res.sets }, rallies);
    // insignias (sus contadores los lleva VB.Badges con los eventos que le pasa ui.js; aquí se cierran sobre tu atleta)
    var badges = [];
    try { if (B() && B().endMatch && g) badges = B().endMatch(g, win, [c.player, null]) || []; } catch (e) { badges = []; }
    M = null;
    return closeMine(c, f, res, mine, false, { badges: badges });
  }
  /** Simula tu partido (resultado según medias + forma; experiencia reducida). */
  function simulateNext(c) {
    c = c || load(); if (!c) return null;
    var f = myFixture(c); if (!f) return null;
    var n = next(c), r = rng(hash(c.seed, 'mine', c.season, c.phase, f.week, f.round, c.notes.length));
    var q = quickSim(teamOvr(c) + (r() - 0.5) * 4, n.ovrRival + (r() - 0.5) * 4, r, c.points), win = q.sets[0] > q.sets[1];
    var d = teamOvr(c) - n.ovrRival, sh = 0.5 + 0.5 * clamp((playerOvr(c) - mateOvr(c)) / 30 + 0.5, 0.2, 0.8);
    var tot = q.setScores.reduce(function (s, x) { return s + x[0]; }, 0), mp = Math.round(tot * 0.42 * sh);
    var kills = Math.round(mp * 0.72), aces = Math.round(mp * 0.12), blocks = Math.max(0, mp - kills - aces);
    var me = { kills: kills, aces: aces, blocks: blocks, assists: Math.round(tot * 0.2 * (1 - sh)), digs: Math.round(3 + r() * 5), errors: Math.round(1 + r() * 3), recvP: 0, perfect: 0, good: 0, poor: 0 };
    me.nota = round1(clamp(6.1 + d * 0.04 + (win ? 0.6 : -0.6) + (r() - 0.5) * 1.6, 3, 9.5));
    // insignias: los partidos simulados solo cuentan para «partidos jugados» y «victorias»
    var badges = [];
    var Bd = B();
    if (Bd && Bd.levelFor && Bd.LIST) {
      var a = c.player; a.bp = a.bp || {}; a.bd = a.bd || {}; a.beq = a.beq || [];
      a.bp.motor = (a.bp.motor | 0) + 1; if (win) a.bp.lider = (a.bp.lider | 0) + 1;
      ['motor', 'lider'].forEach(function (id) {
        var prev = (a.bd[id] | 0), lv = Bd.levelFor(id, a.bp[id] | 0);
        if (lv > prev) { a.bd[id] = lv; var eq = prev === 0 && Bd.equip ? Bd.equip(a, id) : a.beq.indexOf(id) >= 0;
          badges.push({ slot: 0, num: a.num, id: id, name: Bd.BY[id].name, lvl: lv, prev: prev, tier: Bd.TIERS[lv], eq: eq }); }
      });
    }
    return closeMine(c, f, { sets: q.sets, setScores: q.setScores }, me, true, { badges: badges });
  }

  // ------------------------------------------------------------------ clasificación
  function table(c, lvl) {
    c = c || load();
    var rows = {}, ids = clubsOf(c, lvl).map(function (k) { return k.id; });
    ids.forEach(function (id) { rows[id] = { id: id, pj: 0, g: 0, p: 0, sf: 0, sc: 0, pf: 0, pc: 0, pts: 0 }; });
    (c.res[lvl] || []).forEach(function (wk) {
      (wk || []).forEach(function (m) {
        if (!m || !rows[m.a] || !rows[m.b]) return;
        var A = rows[m.a], Bm = rows[m.b], pp = setPts(m.s);
        A.pj++; Bm.pj++; A.pts += pp[0]; Bm.pts += pp[1];
        if (m.s[0] > m.s[1]) { A.g++; Bm.p++; } else { Bm.g++; A.p++; }
        A.sf += m.s[0]; A.sc += m.s[1]; Bm.sf += m.s[1]; Bm.sc += m.s[0];
        m.sc.forEach(function (x) { A.pf += x[0]; A.pc += x[1]; Bm.pf += x[1]; Bm.pc += x[0]; });
      });
    });
    var arr = ids.map(function (id) { return rows[id]; });
    arr.sort(function (a, b) {
      return b.pts - a.pts || b.g - a.g || ((b.sf + 1) / (b.sc + 1)) - ((a.sf + 1) / (a.sc + 1)) || ((b.pf + 1) / (b.pc + 1)) - ((a.pf + 1) / (a.pc + 1)) || a.id - b.id;
    });
    arr.forEach(function (r, i) { r.pos = i + 1; });
    return arr;
  }
  function posOf(c, id) { var k = club(c, id), t = table(c, k.lvl); for (var i = 0; i < t.length; i++) if (t[i].id === id) return i + 1; return 0; }

  // ------------------------------------------------------------------ ofertas
  function offerScore(c) {
    var an = avgNota(c);
    return playerOvr(c) + (an == null ? 0 : (an - 6) * 6) + (c.coach - 50) / 10 + 0.5 * badgePower(c.player);
  }
  /** Liga de un club la temporada que viene (fin de temporada: con los ascensos y descensos ya decididos en c.pendingMoves). */
  function nextLvl(c, k) {
    var mv = (c.pendingMoves || []).filter(function (m) { return m.id === k.id; })[0];
    return mv ? mv.to : k.lvl;
  }
  /** Nivel de los clubes la temporada que viene: q de los que suben/bajan (entran abajo/arriba de su nueva liga) y paseo
   *  aleatorio del resto. Se decide al acabar la temporada (c.pendingQ) para que las ofertas enseñen la media REAL del club y del
   *  compañero de la temporada siguiente; applyMoves lo aplica tal cual. */
  function nextQs(c, moves) {
    var r = rng(hash(c.seed, 'moves', c.season)), out = {}, moved = {};
    (moves || []).forEach(function (mv) {
      var k = club(c, mv.id); if (!k) return;
      moved[k.id] = 1;
      out[k.id] = round1(clamp(mv.to > k.lvl ? 0.12 + r() * 0.3 : 0.55 + r() * 0.35, 0.02, 0.98) * 10) / 10;
    });
    c.clubs.forEach(function (k) {
      if (moved[k.id]) return;
      out[k.id] = Math.round(clamp(k.q + (r() - 0.5) * 0.24 + (0.5 - k.q) * 0.1, 0.02, 0.98) * 100) / 100;
    });
    return out;
  }
  function genOffers(c, mid) {
    var me = myClub(c), sc = offerScore(c), r = rng(hash(c.seed, 'off', c.season, mid ? 'mid' : 'end')), cand = [], an = avgNota(c) || 0;
    // a mitad de temporada solo si estás jugando muy bien (nota media ≥ 7; antes casi cualquiera recibía ofertas en la jornada 7)
    if (mid && an < 7) return [];
    // al final de la temporada las ofertas se miden con la liga y el nivel (q) de la temporada SIGUIENTE (antes un club que
    // descendía ofrecía «Liga Nacional» y fichabas por él en la Regional, y la media anunciada no era la real)
    var pq = !mid && c.pendingQ ? c.pendingQ : null;
    var lv = function (k) { return mid ? k.lvl : nextLvl(c, k); }, qOf = function (k) { return pq && pq[k.id] != null ? pq[k.id] : k.q; }, myL = lv(me);
    c.clubs.forEach(function (k) {
      var kl = lv(k), L = league(kl), q = qOf(k);
      if (k.id === me.id || kl < myL || kl > myL + 1) return;
      if (kl === myL && q <= qOf(me) + 0.05) return;   // solo clubes mejores que el tuyo
      if (mid && kl > myL && an < 7.5) return;   // a mitad de temporada, saltar de liga exige notas aún más altas
      var o = L.ovr[0] + (L.ovr[1] - L.ovr[0]) * q, thr = o - 5 + (kl > myL ? 2 : 0);
      var it = sc - thr + (r() - 0.5) * 8 - (mid ? 3 : 0);
      if (it > 0) cand.push({ club: k.id, lvl: kl, ovr: Math.round(o), interest: round1(it), mate: clampI(Math.round(o) + 3, 1, 99),
        role: it > 8 ? 'Titular indiscutible' : it > 3 ? 'Titular' : 'Rotación', years: 1 + Math.floor(r() * 3) });
    });
    // las 3 mejores, con preferencia por los clubes de la liga de arriba; se muestran de mejor a peor club
    cand.sort(function (a, b) { return (b.interest + 4 * (b.lvl - myL)) - (a.interest + 4 * (a.lvl - myL)); });
    cand = cand.slice(0, 3);
    cand.sort(function (a, b) { return b.lvl - a.lvl || b.ovr - a.ovr; });
    return cand;
  }
  function midWindow(c) {
    var o = genOffers(c, true);
    c.offers = o; c.window = o.length ? 'mid' : '';
  }

  // ------------------------------------------------------------------ fin de temporada
  function endSeason(c) {
    var me = myClub(c), lvl = me.lvl, t = table(c, lvl), pos = posOf(c, me.id), L = league(lvl);
    var objOk = pos <= c.objective.pos;
    c.coach = clamp(c.coach + (objOk ? 15 : -15), 0, 100);
    var champ = t[0].id, cupWin = c.cup && c.cup.champion === me.id, cupFinal = c.cup && c.cup.final && (c.cup.final[0] === me.id || c.cup.final[1] === me.id);
    var cupSemi = c.cup && c.cup.semis.some(function (m) { return m[0] === me.id || m[1] === me.id; });
    // ascensos y descensos (los 2 primeros suben, los 2 últimos bajan)
    var moves = [];
    for (var Lv = 0; Lv < LEAGUES.length - 1; Lv++) {
      var up = table(c, Lv).slice(0, 2), down = table(c, Lv + 1).slice(-2);
      up.forEach(function (r) { moves.push({ id: r.id, to: Lv + 1 }); });
      down.forEach(function (r) { moves.push({ id: r.id, to: Lv }); });
    }
    var myMove = 0;
    moves.forEach(function (mv) { if (mv.id === me.id) myMove = mv.to > lvl ? 1 : -1; });
    if (champ === me.id) c.trophies.push({ season: c.season, kind: 'liga', name: L.name, club: me.name });
    if (cupWin) c.trophies.push({ season: c.season, kind: 'copa', name: L.cup, club: me.name });
    if (myMove > 0) c.trophies.push({ season: c.season, kind: 'ascenso', name: 'Ascenso a ' + league(lvl + 1).name, club: me.name });
    var an = avgNota(c);
    c.history.push({ season: c.season, club: me.id, clubName: me.name, lvl: lvl, pos: pos, pts: t[pos - 1].pts, objective: c.objective.text, objOk: objOk,
      cup: cupWin ? 'Campeón' : cupFinal ? 'Final' : cupSemi ? 'Semifinal' : '—', nota: an, played: c.stats.played, won: c.stats.won, ppts: c.stats.pts, move: myMove,
      ovr: playerOvr(c), lvlP: c.player.lvl });
    c.review = { season: c.season, pos: pos, lvl: lvl, objective: c.objective.text, objOk: objOk, champion: champ === me.id, cup: cupWin, move: myMove, nota: an,
      coach: c.coach, moves: moves };
    c.pendingMoves = moves;
    c.pendingQ = nextQs(c, moves);
    c.phase = 'off';
    c.offers = genOffers(c, false); c.window = 'end';
  }
  function applyMoves(c) {
    var qs = c.pendingQ || nextQs(c, c.pendingMoves);   // guardados de antes de pendingQ: se calcula igual
    (c.pendingMoves || []).forEach(function (mv) { var k = club(c, mv.id); if (k) k.lvl = mv.to; });
    c.clubs.forEach(function (k) { if (qs[k.id] != null) k.q = qs[k.id]; });
    c.pendingMoves = null; c.pendingQ = null;
  }
  function newSeason(c, toClub) {
    applyMoves(c);
    var r = rng(hash(c.seed, 'season', c.season + 1));
    if (toClub != null && toClub !== c.myClub) { c.myClub = toClub; c.mate = newMate(c, myClub(c), r); c.coach = 55; }
    else {
      // el club renueva tu compañero si ha cambiado de liga o si se ha quedado muy por debajo del nivel del club
      var k = myClub(c), want = clubOvr(k) + 3;
      if (mateOvr(c) < want - 4) c.mate = newMate(c, k, r);
    }
    c.season++; c.week = 0; c.phase = 'league'; c.cup = null; c.notes = []; c.stats = newSeasonStats(); c.offers = []; c.window = ''; c.review = null;
    c.player.age = (c.player.age | 0) + 1;
    genSchedule(c);
    c.objective = makeObjective(c);
    c.last = null;
  }
  /** Acepta la oferta i (fin de temporada: empieza la siguiente en el club nuevo; mitad: cambias de club ya). */
  function acceptOffer(i) {
    var c = load(); if (!c || !c.offers || !c.offers[i]) return false;
    var o = c.offers[i];
    if (c.window === 'end' && c.phase === 'off') { newSeason(c, o.club); save(c); return true; }
    if (c.window === 'mid') {
      var r = rng(hash(c.seed, 'midmove', c.season));
      c.myClub = o.club; c.mate = newMate(c, myClub(c), r); c.coach = 55;
      c.objective = makeObjective(c); c.offers = []; c.window = '';
      c.last = null;   // el último partido era de tu club anterior: la tarjeta «Jornada N» ya no tiene sentido bajo el club nuevo
      save(c); return true;
    }
    return false;
  }
  /** Sigue en tu club: fin de temporada → empieza la siguiente; mitad → descarta las ofertas. */
  function stay() {
    var c = load(); if (!c) return false;
    if (c.phase === 'off') newSeason(c, null);
    else { c.offers = []; c.window = ''; }
    save(c); return true;
  }

  // ------------------------------------------------------------------ jugador: mejoras e insignias
  function bump(k) {
    var c = load(); if (!c) return false;
    var a = c.player, p = P(), ok;
    if (p && p.athleteBump) ok = p.athleteBump(a, k, 1);
    else { var v = a.st[k]; ok = KEYS.indexOf(k) >= 0 && v < 99 && a.pts >= costOf(v); if (ok) { a.pts -= costOf(v); a.st[k] = v + 1; } }
    if (ok) save(c);
    return ok;
  }
  function toggleBadge(id) {
    var c = load(); if (!c || !B() || !B().toggle) return '';
    var r = B().toggle(c.player, id); if (r) save(c); return r;
  }
  /** ¿Es g un partido de Carrera? (ui.js/badges.js: no repartir al escuadrón de Partido rápido) */
  function owns(g) { return !!(g && g.career && !g.demo); }

  VB.Career = {
    VER: VER, STORE: KEY, KEYS: KEYS, LEAGUES: LEAGUES, ROLES: ROLES, REF: REF, POINTS: POINTS, WEEKS: WEEKS, MID_WEEK: MID_WEEK, START_OVR: START_OVR, PTS_LVL: PTS_LVL,
    exists: exists, get: get, load: load, lost: function () { return lost; }, save: save, create: create, abandon: abandon,
    league: league, club: club, myClub: myClub, clubsOf: clubsOf, clubOvr: clubOvr, table: table, posOf: posOf,
    next: next, matchSetup: matchSetup, ingest: ingest, matchDone: matchDone, simulateNext: simulateNext, abortMatch: abortMatch, owns: owns,
    playerOvr: playerOvr, mateOvr: mateOvr, teamOvr: teamOvr, avgNota: avgNota, form: form, ovrOf: ovrOf, need: need, cost: costOf,
    coachText: coachText, difficultyFor: difficultyFor, DIFF_AT: DIFF_AT, rating: rating, quickSim: quickSim, setPts: setPts, genSt: genSt,
    acceptOffer: acceptOffer, stay: stay, bump: bump, toggleBadge: toggleBadge, offerScore: offerScore,
    _M: function () { return M; }, _reset: function () { cur = null; M = null; }, _genOffers: genOffers, _rng: rng, _hash: hash
  };
})();
