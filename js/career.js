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
 *   acceptOffer(i, años), stay(años) → fin de temporada (o fichaje en la ventana de mitad de temporada)
 *
 * Gestión propia (v2, 10-nov-2026; notes/carrera.md §Gestión):
 *   - Inicio: tras crear el jugador NO hay club (phase 'pick'): llegan 3-4 ofertas de la Liga Regional (y quizá una prueba en la
 *     Nacional). acceptOffer(i, años) elige; rejectAll() trae ofertas peores; moreTime() (una vez) cambia una oferta por otra.
 *   - setTraining(k) enfoque semanal (bal/phys/def/atk/rest → mejoras gratis en ese grupo de atributos o descanso de la fatiga).
 *   - requestTransfer(on) declararte transferible; negotiate(i) pedir más rol en una oferta; stay(años) renueva si toca.
 *   - changeMate(i) cambiar de compañero entre los de la plantilla (c.squad); química con el compañero (c.mate.chem).
 *   - Bandeja de mensajes c.inbox (entrenador, ofertas, objetivos): readMsg(id), readAll(), unread(c).
 *   - En la Carrera solo controlas a tu jugador (ctrl siempre 'one'; los guardados con 'both' se migran).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var VB = root.VB = root.VB || {};
  var KEY = 'voley3d.career', VER = 2;   // v1 → v2: gestión (inicio sin club, contrato, entrenamiento, plantilla, bandeja); migrate()
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

  // ------------------------------------------------------------------ gestión (v2)
  // Enfoque de entrenamiento semanal: cada partido (jugado o simulado) suma progreso al grupo; cada TRAIN_NEED de progreso sube
  // gratis el atributo más bajo del grupo. La fatiga sube con el entrenamiento y baja descansando; por encima de FAT_FREE resta
  // atributos en el partido (matchSetup) y fuerza en la simulación (teamOvr). Grupos = los de VB.Prog.GROUPS.
  // Integración (10-nov-2026, revisión de la Carrera): Equilibrado ya no cansa (con +4 por partido y sin recuperación hundía al
  // jugador para siempre: −4 permanente desde la 2.ª temporada); los enfoques dan algo más (60) para que compense la fatiga, y en
  // verano la fatiga vuelve a 0 (newSeason).
  var TRAIN = {
    bal: { name: 'Equilibrado', hint: 'Un poco de todo, sin fatiga', prog: { phys: 15, def: 15, atk: 15 }, fat: 0 },
    phys: { name: 'Físico', hint: 'Salto, velocidad y reacción · cansa', prog: { phys: 60 }, fat: 12 },
    def: { name: 'Defensa', hint: 'Recepción, defensa y bloqueo · cansa', prog: { def: 60 }, fat: 12 },
    atk: { name: 'Ataque', hint: 'Colocación, potencia, control y saque · cansa', prog: { atk: 60 }, fat: 12 },
    rest: { name: 'Descanso', hint: 'Sin progreso; recupera la fatiga', prog: {}, fat: -35 }
  };
  // estilo del club: sus entrenamientos suman STYLE_PROG de progreso por semana a un grupo (siempre, sea cual sea tu enfoque)
  var STYLE_TRAIN = { 'Ofensivo': 'atk', 'Defensivo': 'def', 'Saque y bloqueo': 'def', 'Juego rápido': 'phys', 'Equilibrado': '' }, STYLE_PROG = 6;
  var EARLY_COACH = 10;   // fichar por otro club con contrato en vigor (y sin ser transferible): el entrenador nuevo empieza con 10 menos
  var NEG_COACH = 8;      // negociación rechazada: si firmas igualmente, el entrenador empieza con 8 menos
  var TRAIN_KEYS = ['bal', 'phys', 'def', 'atk', 'rest'];
  var TGROUP = { phys: ['jump', 'speed', 'react'], def: ['recv', 'dig', 'block'], atk: ['set', 'spike', 'ctl', 'serve'] };
  var TRAIN_NEED = 100, FAT_FREE = 40;
  // química con el compañero (0-100): sube jugando juntos; da +0..3 en reacción, colocación y recepción a los dos (matchSetup)
  var CHEM_KEYS = ['react', 'set', 'recv'];
  var STYLES = ['Ofensivo', 'Defensivo', 'Equilibrado', 'Saque y bloqueo', 'Juego rápido'];
  var MATE_STYLES = { atk: ['Rematador potente', 'Saltador', 'Bloqueador'], cr: ['Colocador fino', 'Defensor incansable', 'Receptor seguro'], uni: ['Todoterreno', 'Jugador listo', 'Sacador'] };
  var ROLE_LV = ['Rotación', 'Titular', 'Titular indiscutible'];
  var ROLE_COACH = [45, 55, 65];   // confianza inicial del entrenador según el rol firmado
  var SALARY = [600, 1500, 4000, 9000, 20000];   // € al mes (ficticio) por liga, × nivel del club × rol

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
    if (!o || typeof o !== 'object' || (o.v !== VER && o.v !== 1) || !o.player || typeof o.player !== 'object' || !Array.isArray(o.clubs) || !o.clubs.length) return null;
    var p = P();
    if (p && p.saneAthlete) {
      var d = p.newAthlete({ num: o.player.num, role: o.player.role, name: o.player.name });
      o.player = (function (src, dst) { p.saneAthlete(src, dst); dst.roleKey = ROLES[src.roleKey] ? src.roleKey : 'uni'; dst.age = clampI(src.age, 15, 60); return dst; })(o.player, d);
    }
    if (POINTS.indexOf(o.points) < 0) o.points = 15;
    o.ctrl = 'one';   // en la Carrera solo se controla a tu jugador (los guardados con 'both' se migran)
    try { o = saneDeep(o); return o ? migrate(o) : null; } catch (e) { return null; }
  }
  /** v1 → v2 y huecos de la gestión: contrato, plantilla, química, entrenamiento, fatiga, bandeja. No toca el progreso (un jugador
   *  que ya estaba en un club sigue en él: no se le obliga a elegir de nuevo). Idempotente (se aplica también a guardados v2). */
  function migrate(o) {
    var num = function (v) { return typeof v === 'number' && isFinite(v); }, old = o.v !== VER;
    o.v = VER;
    if (!Array.isArray(o.inbox)) o.inbox = [];
    o.inbox = o.inbox.filter(function (m) { return m && typeof m.t === 'string'; }).slice(-INBOX_MAX);
    o.msgN = num(o.msgN) ? o.msgN | 0 : o.inbox.reduce(function (s, m) { return Math.max(s, (m.id | 0) + 1); }, 0);
    if (TRAIN_KEYS.indexOf(o.train) < 0) o.train = 'bal';
    if (!o.tp || typeof o.tp !== 'object') o.tp = {};
    ['phys', 'def', 'atk'].forEach(function (g) { o.tp[g] = num(o.tp[g]) ? clamp(o.tp[g], 0, TRAIN_NEED - 1) : 0; });
    o.fatigue = num(o.fatigue) ? clamp(Math.round(o.fatigue), 0, 100) : 0;
    o.listed = !!o.listed;
    if (o.phase === 'pick') return o;   // aún sin club: el resto llega al firmar
    if (num(o.mate.chem)) o.mate.chem = clamp(Math.round(o.mate.chem), 0, 100);
    else o.mate.chem = old ? clamp((o.stats && o.stats.played | 0) * 4, 0, 60) : 0;   // los que ya jugaban juntos no empiezan de cero
    if (typeof o.mate.style !== 'string') o.mate.style = mateStyle(o.mate, rng(hash(o.seed, 'mstyle', o.mate.name)));
    if (!Array.isArray(o.squad) || !o.squad.every(function (m) { return m && m.st && typeof m.name === 'string'; })) o.squad = genSquad(o, myClub(o), o.mate, rng(hash(o.seed, 'squad', o.season, o.myClub)));
    o.squad.forEach(function (m) { KEYS.forEach(function (k) { m.st[k] = clampI(m.st[k], 1, 99); }); m.chem = num(m.chem) ? clamp(m.chem, 0, 100) : 0; if (typeof m.style !== 'string') m.style = mateStyle(m, rng(1)); });
    var ct = o.contract;
    if (!ct || typeof ct !== 'object' || !num(ct.left) || !num(ct.years) || ROLE_LV.indexOf(ct.role) < 0) {
      var k = myClub(o), rl = o.coach >= 70 ? 2 : o.coach >= 45 ? 1 : 0;
      o.contract = { club: k.id, years: 2, left: 2, role: ROLE_LV[rl], salary: salaryOf(k.lvl, k.q, rl), since: o.season };
    } else { ct.left = clampI(ct.left, 0, 5); ct.years = clampI(ct.years, 1, 5); ct.club = o.myClub; if (!num(ct.salary)) ct.salary = salaryOf(myClub(o).lvl, myClub(o).q, ROLE_LV.indexOf(ct.role)); }
    if (old) msg(o, 'club', 'Novedades en la Carrera', 'Ahora puedes elegir el enfoque del entrenamiento semanal, cambiar de compañero entre los de la plantilla, pedir el traspaso y negociar las ofertas. Tu química con ' + o.mate.name + ' ya cuenta lo que habéis jugado juntos. En la Carrera solo controlas a tu jugador.');
    return o;
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
    o.seed = num(o.seed) ? o.seed >>> 0 : hash('reparado', o.created || 0);
    o.season = clampI(o.season, 1, 999);
    if (o.phase === 'pick') {   // aún eligiendo el primer club (v2): ofertas de inicio válidas o nuevas
      o.myClub = -1; o.mate = null; o.window = 'start';
      if (!o.pick || typeof o.pick !== 'object') o.pick = { round: 0, more: false };
      o.pick.round = clampI(o.pick.round, 0, 9); o.pick.more = !!o.pick.more;
      if (!arr(o.offers) || !o.offers.length || !o.offers.every(function (x) { var k = x && club(o, x.club); return k && k.lvl <= 1 && x.mateP && x.mateP.st; })) o.offers = genStartOffers(o, o.pick.round);
      ['notes', 'history', 'trophies'].forEach(function (k) { if (!arr(o[k])) o[k] = []; });
      if (!o.stats || typeof o.stats !== 'object') o.stats = newSeasonStats();
      if (!o.career || typeof o.career !== 'object') o.career = newSeasonStats();
      if (!arr(o.sched) || o.sched.length !== LEAGUES.length) genSchedule(o);
      if (!arr(o.res) || o.res.length !== LEAGUES.length) o.res = LEAGUES.map(function () { return []; });
      o.coach = 50; o.week = 0; o.last = null; o.cup = null;
      return o;
    }
    if (!myClub(o)) return null;
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
  /** Compañero del club k (media del club + 3, rol complementario). ovr/role: los fija quien llama (ofertas, plantilla). */
  function newMate(c, k, r, ovr, roleKey) {
    var role = roleKey && ROLES[roleKey] ? roleKey : MATE_ROLE[c.player.roleKey] || 'uni', o = clamp(ovr != null ? ovr : clubOvr(k) + 3, 25, 88);
    var num; do { num = 1 + Math.floor(r() * 24); } while (num === c.player.num);
    if (c.player.num !== 2) num = 2; // el compañero lleva el 2 (como en Partido rápido); si es el tuyo, el sorteado (misma tirada)
    var m = { name: pick(r, FIRST) + ' ' + pick(r, LAST), num: num, roleKey: role, role: ROLES[role].name, st: genSt(o, role, r), chem: 0 };
    m.style = mateStyle(m, r);
    return m;
  }
  function mateStyle(m, r) { var l = MATE_STYLES[m.roleKey] || MATE_STYLES.uni; return pick(r, l); }
  /** Plantilla: otros 2 compañeros posibles en el club (además del titular): uno un poco peor del mismo rol y un universal (o un
   *  atacante si tu rol es universal). Con ellos se puede pedir cambio de compañero (changeMate). */
  function genSquad(c, k, mate, r) {
    var base = clubOvr(k), mr = mate && mate.roleKey || MATE_ROLE[c.player.roleKey] || 'uni';
    var alt = mr === 'uni' ? (c.player.roleKey === 'uni' ? 'atk' : 'uni') : 'uni';
    var out = [newMate(c, k, r, base, mr), newMate(c, k, r, base - 1, alt)];
    out.forEach(function (m, i) { var n = m.num; while (n === c.player.num || n === 2 || (mate && n === mate.num) || (i && n === out[0].num)) n = 3 + Math.floor(r() * 20); m.num = n; });
    return out;
  }
  function salaryOf(lvl, q, rl) {
    var v = SALARY[clamp(lvl | 0, 0, SALARY.length - 1)] * (0.8 + 0.4 * (q || 0)) * [0.8, 1, 1.25][clamp(rl | 0, 0, 2)];
    return Math.round(v / 50) * 50;
  }
  function starsOf(lvl, q) { return clamp(1 + (lvl | 0) + (q > 0.6 ? 1 : 0), 1, 5); }
  function styleOf(k) { return STYLES[hash('estilo', k.name) % STYLES.length]; }
  /** Ficha de un club (para las ofertas y la pestaña Club): liga, prestigio (1-5 estrellas), media, estilo, ciudad. lvl/q: los de la
   *  temporada que viene si se pasan. */
  function clubInfo(c, k, lvl, q) {
    lvl = lvl != null ? lvl : k.lvl; q = q != null ? q : k.q;
    var L = league(lvl);
    return { id: k.id, name: k.name, short: k.short, city: k.city, kit: k.kit, lvl: lvl, league: L.name, stars: starsOf(lvl, q), style: styleOf(k),
      ovr: Math.round(L.ovr[0] + (L.ovr[1] - L.ovr[0]) * q) };
  }

  // ------------------------------------------------------------------ bandeja de mensajes
  var INBOX_MAX = 40;
  /** Mensaje en la bandeja: k = 'coach' | 'offer' | 'obj' | 'club' | 'train' | 'agent'. */
  function msg(c, k, t, x) {
    if (!c) return null;
    if (!Array.isArray(c.inbox)) c.inbox = [];
    var m = { id: (c.msgN = (c.msgN | 0) + 1), k: k, t: t, x: x, s: c.season | 0, w: (c.week | 0) + 1, ph: c.phase, r: 0 };
    c.inbox.push(m);
    if (c.inbox.length > INBOX_MAX) c.inbox = c.inbox.slice(-INBOX_MAX);
    return m;
  }
  function unread(c) { c = c || load(); return c && c.inbox ? c.inbox.filter(function (m) { return !m.r; }).length : 0; }
  function readMsg(id) { var c = load(); if (!c || !c.inbox) return false; var ok = false; c.inbox.forEach(function (m) { if (m.id === id && !m.r) { m.r = 1; ok = true; } }); if (ok) save(c); return ok; }
  function readAll() { var c = load(); if (!c || !c.inbox) return 0; var n = 0; c.inbox.forEach(function (m) { if (!m.r) { m.r = 1; n++; } }); if (n) save(c); return n; }

  // ------------------------------------------------------------------ química, fatiga y entrenamiento
  function chemBonus(c) { return c && c.mate ? Math.min(3, Math.floor(clamp(c.mate.chem | 0, 0, 100) / 30)) : 0; }   // 0..3 (30 → 1, 60 → 2, 90 → 3)
  function fatigueMalus(c) { var f = c ? c.fatigue | 0 : 0; return f <= FAT_FREE ? 0 : Math.min(4, Math.ceil((f - FAT_FREE) / 15)); }
  /** Una semana de entrenamiento (tras cada partido tuyo): progreso del enfoque, mejoras gratis y fatiga. */
  function trainWeek(c) {
    var T = TRAIN[c.train] || TRAIN.bal, gains = [], f0 = c.fatigue | 0, m0 = fatigueMalus(c), prog = {}, g;
    for (g in T.prog) prog[g] = T.prog[g];
    var mk = myClub(c), sg = mk ? STYLE_TRAIN[styleOf(mk)] : '';
    if (sg && c.train !== 'rest') prog[sg] = (prog[sg] || 0) + STYLE_PROG;   // estilo del club (descansando no entrenas)
    for (g in prog) {
      c.tp[g] = (c.tp[g] || 0) + prog[g];
      while (c.tp[g] >= TRAIN_NEED) {
        c.tp[g] -= TRAIN_NEED;
        var ks = TGROUP[g].filter(function (k) { return c.player.st[k] < 99; }).sort(function (a, b) { return c.player.st[a] - c.player.st[b]; });
        if (!ks.length) { c.tp[g] = 0; break; }
        c.player.st[ks[0]]++; gains.push(ks[0]);
      }
    }
    c.fatigue = clamp(f0 + T.fat, 0, 100);
    // aviso cada vez que la resta sube (antes solo una vez, al pasar de 60)
    if (fatigueMalus(c) > m0) msg(c, 'train', 'El preparador físico avisa', 'Llevas muchas semanas cargando: fatiga ' + c.fatigue + ' de 100. Con tanta fatiga rindes menos en los partidos (−' + fatigueMalus(c) + ' en todos tus atributos). Una semana de Descanso la baja mucho; con Equilibrado no sube.');
    return { focus: c.train, gains: gains, fatigue: c.fatigue, fat0: f0 };
  }
  function badgePower(a) { var b = a.beq || [], s = 0; for (var i = 0; i < b.length; i++) s += (a.bd && a.bd[b[i]]) | 0; return s; }
  /** Fuerza de tu pareja para la simulación rápida: media de los dos + insignias + forma. */
  function teamOvr(c) {
    var f = form(c);
    // + química (0..3 → 0..1,5) − fatiga (la misma resta que en el partido, a la mitad porque solo es tu jugador)
    return 0.5 * playerOvr(c) + 0.5 * mateOvr(c) + 0.35 * badgePower(c.player) + (f == null ? 0 : (f - 6.5) * 0.8) + 0.5 * chemBonus(c) - 0.5 * fatigueMalus(c);
  }
  function form(c) { var n = c.notes || []; if (!n.length) return null; var s = 0, k = Math.min(3, n.length); for (var i = n.length - k; i < n.length; i++) s += n[i].nota; return s / k; }
  function avgNota(c) { var n = c.notes || []; if (!n.length) return null; var s = 0; n.forEach(function (x) { s += x.nota; }); return round1(s / n.length); }

  // ------------------------------------------------------------------ objetivos y entrenador
  function expectedPos(c, k) {
    var lst = clubsOf(c, k.lvl).map(clubOvr).sort(function (a, b) { return b - a; });
    return lst.indexOf(clubOvr(k)) + 1;
  }
  function makeObjective(c) { return objectiveFor(c, myClub(c)); }
  function objectiveFor(c, k) {
    var e = expectedPos(c, k), top = k.lvl === LEAGUES.length - 1, low = k.lvl === 0;
    if (e <= 2) return top ? { pos: 1, text: 'Ganar el ' + league(k.lvl).name } : { pos: 2, text: 'Subir de categoría (quedar entre los 2 primeros)' };
    if (e <= 4) return { pos: 4, text: 'Quedar entre los 4 primeros (y jugar la copa)' };
    if (e <= 6) return { pos: 6, text: 'Terminar en mitad de tabla (entre los 6 primeros)' };
    return low ? { pos: 7, text: 'No acabar último' } : { pos: 6, text: 'Evitar el descenso' };
  }
  function coachText(v) { return v < 30 ? 'Descontento' : v < 50 ? 'Tiene dudas' : v < 70 ? 'Confía en ti' : v < 85 ? 'Pieza clave' : 'Intocable'; }
  var COACH_LINE = {
    'Descontento': 'No estoy contento con lo que veo. Necesito notas mejores o buscaré otras soluciones (y no podrás elegir compañero).',
    'Tiene dudas': 'Tienes condiciones, pero me faltan partidos buenos para fiarme del todo de ti.',
    'Confía en ti': 'Vas por buen camino. Sigue así y el equipo irá a más.',
    'Pieza clave': 'Eres una pieza clave del equipo. Los clubes de arriba empiezan a preguntar por ti.',
    'Intocable': 'Eres intocable. Este equipo se construye a tu alrededor.'
  };

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
    var c = { v: VER, seed: seed, created: o.now || Date.now(), points: POINTS.indexOf(+o.points) >= 0 ? +o.points : 15, ctrl: 'one',
      season: 1, week: 0, phase: 'pick', player: player, clubs: genClubs(r), myClub: -1, mate: null, sched: null, res: null,
      cup: null, notes: [], coach: 50, objective: null, offers: [], window: 'start', review: null, last: null,
      stats: newSeasonStats(), career: newSeasonStats(), history: [], trophies: [],
      pick: { round: 0, more: false }, inbox: [], msgN: 0, train: 'bal', tp: { phys: 0, def: 0, atk: 0 }, fatigue: 0, listed: false, squad: [], contract: null };
    genSchedule(c);
    // sin club: llegan las ofertas de inicio y eliges tú (acceptOffer). o.autoClub: el de antes (pruebas)
    c.offers = genStartOffers(c, 0);
    msg(c, 'agent', 'Tienes ' + c.offers.length + ' ofertas', 'Soy tu agente. Varios clubes quieren ' + (c.offers.some(function (x) { return x.trial; }) ? 'ficharte o probarte' : 'ficharte') +
      ' para la temporada 1. Compara las fichas (liga, prestigio, compañero, objetivo, rol y sueldo) y elige. Si rechazas todas, llegarán otras de clubes más modestos (y se pierde la prueba, si la hay).');
    cur = c; M = null; lost = false;
    if (o.autoClub) { var i = 0, best = -1; c.offers.forEach(function (x, j) { if (!x.trial && (best < 0 || x.ovr < best)) { best = x.ovr; i = j; } }); joinClub(c, c.offers[i], c.offers[i].years); }
    save(c);
    return c;
  }

  // ------------------------------------------------------------------ inicio: ofertas y pruebas de clubes
  var ROLE_NEED = [0, 3, 8];   // interés mínimo para cada rol (Rotación / Titular / Titular indiscutible)
  /** Ofertas de inicio (sin club): 3-4 clubes de la Liga Regional (de los modestos; con cada rechazo, de los peores) y en la
   *  primera ronda quizá una prueba en el peor club de la Liga Nacional (te fichan si la superas). */
  function genStartOffers(c, round) {
    var r = rng(hash(c.seed, 'start', round)), reg = clubsOf(c, 0).sort(function (a, b) { return a.q - b.q; });
    var pool = round === 0 ? reg.slice(0, 6) : reg.slice(0, 3);
    shuffle(r, pool);
    var n = round === 0 ? 3 + (r() < 0.5 ? 1 : 0) : (round === 1 ? 3 : 2);
    var out = pool.slice(0, n).map(function (k) { return startOffer(c, k, 0, round, r, false); });
    if (round === 0 && r() < 0.75) {
      var nat = clubsOf(c, 1).sort(function (a, b) { return a.q - b.q; })[0];
      out.push(startOffer(c, nat, 1, round, r, true));
    }
    out.sort(function (a, b) { return (a.trial ? 1 : 0) - (b.trial ? 1 : 0) || b.ovr - a.ovr; });   // la prueba, la última
    return out;
  }
  function startOffer(c, k, lvl, round, r, trial) {
    var inf = clubInfo(c, k), it = round1(START_OVR - (inf.ovr - 5) + (r() - 0.5) * 8 + round * 2.5);   // los peores clubes te necesitan más
    var rl = trial ? 0 : it > ROLE_NEED[2] ? 2 : it > ROLE_NEED[1] ? 1 : 0;
    var mate = newMate(c, k, r);
    var o = { club: k.id, lvl: lvl, ovr: inf.ovr, interest: it, mate: ovrOf(mate.st), mateP: mate, role: ROLE_LV[rl], years: trial ? 1 : 1 + Math.floor(r() * 2),
      salary: salaryOf(lvl, k.q, rl) * (round ? 0.85 : 1) | 0, objective: objectiveFor(c, k).text, start: 1 };
    o.salary = Math.round(o.salary / 50) * 50;
    if (trial) { o.trial = true; o.chance = trialChance(c); }
    return o;
  }
  /** Probabilidad de superar la prueba de la Liga Nacional: con la media inicial ~30 %. */
  function trialChance(c) { return round1(clamp(0.3 + (playerOvr(c) - START_OVR) * 0.04, 0.1, 0.75) * 10) / 10; }
  /** Firma por el club de la oferta o (inicio, mitad o fin de temporada): compañero anunciado, plantilla, contrato, objetivo. */
  function joinClub(c, o, years) {
    var k = club(c, o.club), r = rng(hash(c.seed, 'join', c.season, o.club));
    var rl = Math.max(0, ROLE_LV.indexOf(o.role));
    c.myClub = k.id;
    c.mate = o.mateP && o.mateP.st ? copy(o.mateP) : newMate(c, k, r, o.mate != null ? o.mate : null);
    c.mate.chem = 0; if (typeof c.mate.style !== 'string') c.mate.style = mateStyle(c.mate, r);
    c.squad = genSquad(c, k, c.mate, r);
    years = clampI(years != null ? years : o.years || 1, 1, 3);
    // since: al fichar a final de temporada el contrato empieza en la siguiente (joinClub va antes de c.season++)
    c.contract = { club: k.id, years: years, left: years, role: ROLE_LV[rl], salary: o.salary || salaryOf(k.lvl, k.q, rl), since: c.season + (c.phase === 'off' ? 1 : 0) };
    // confianza inicial: la del rol firmado, menos si saliste con contrato en vigor (o.early) o si te rechazaron la negociación
    c.coach = clamp(ROLE_COACH[rl] - (o.early ? EARLY_COACH : 0) - (o.negNo ? NEG_COACH : 0), 0, 100); c.listed = false;
    c.offers = []; c.window = '';
    if (c.phase === 'pick') { c.phase = 'league'; c.week = 0; c.pick = null; }
    if (c.phase !== 'off') { c.objective = makeObjective(c); welcome(c); }
  }
  function welcome(c) {
    var k = myClub(c), ct = c.contract;
    msg(c, 'coach', 'Bienvenido a ' + k.name, 'Aquí empiezas como ' + ct.role.toLowerCase() + ' (' + plural(ct.years, 'temporada', 'temporadas') + '). Tu compañero será ' + c.mate.name +
      ' (' + c.mate.role.toLowerCase() + ', ' + c.mate.style.toLowerCase() + '). Objetivo del club: ' + c.objective.text.toLowerCase() + '. Cuanto más juguéis juntos, mejor os entenderéis.');
  }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  /** Inicio: rechazar todas → nuevas ofertas, peores (de los clubes más flojos de la Regional y sin prueba). */
  function rejectAll() {
    var c = load(); if (!c || c.phase !== 'pick') return false;
    c.pick.round = Math.min(9, c.pick.round + 1); c.pick.more = false;
    c.offers = genStartOffers(c, c.pick.round);
    msg(c, 'agent', 'Nuevas ofertas', 'Has rechazado todas las ofertas. Han llegado ' + c.offers.length + ' más, de clubes más modestos. Si rechazas otra vez seguirán siendo de los más flojos de la Liga Regional.');
    save(c); return true;
  }
  /** Inicio: pedir más tiempo (una vez): el club con menos interés retira su oferta y llega otra de un club que aún no había llamado. */
  function moreTime() {
    var c = load(); if (!c || c.phase !== 'pick' || c.pick.more || !c.offers.length) return null;
    var r = rng(hash(c.seed, 'more', c.pick.round)), used = {}, lo = 0;
    c.offers.forEach(function (x, i) { used[x.club] = 1; if (!x.trial && x.interest < c.offers[lo].interest) lo = i; });
    if (c.offers[lo].trial) lo = c.offers.findIndex ? c.offers.findIndex(function (x) { return !x.trial; }) : 0;
    var cand = clubsOf(c, 0).filter(function (k) { return !used[k.id]; }).sort(function (a, b) { return a.q - b.q; }).slice(0, 6);
    if (!cand.length || lo < 0) return null;
    var gone = c.offers.splice(lo, 1)[0], nk = pick(r, cand), no = startOffer(c, nk, 0, c.pick.round, r, false);
    c.offers.push(no); c.pick.more = true;
    c.offers.sort(function (a, b) { return (a.trial ? 1 : 0) - (b.trial ? 1 : 0) || b.ovr - a.ovr; });
    var gk = club(c, gone.club);
    msg(c, 'agent', 'Una oferta menos, una más', gk.name + ' no quiere esperar y retira su oferta. A cambio ha llamado ' + nk.name + '.');
    save(c); return { gone: gone.club, added: nk.id };
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
    // fatiga (resta a tus atributos) y química (suma a los dos en reacción, colocación y recepción): solo en este partido
    var stMe = copy(c.player.st), stMate = copy(c.mate.st), fm = fatigueMalus(c), ch = chemBonus(c);
    KEYS.forEach(function (key) { stMe[key] = clampI(stMe[key] - fm + (CHEM_KEYS.indexOf(key) >= 0 ? ch : 0), 1, 99); if (CHEM_KEYS.indexOf(key) >= 0) stMate[key] = clampI(stMate[key] + ch, 1, 99); });
    return {
      attrs: [[stMe, stMate], [rivA, rivB]],
      badges: bd ? [[bd, null], null] : null,
      points: c.points, difficulty: n.diff, ctrl: 'one', ctrlIdx: 0,   // en la Carrera solo tu jugador
      chem: ch, fatigue: fm,
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
    var ct0 = coachText(c.coach);
    c.coach = clamp(Math.round(c.coach + (nota - 6.2) * 2.5 + (win ? 1 : -1)), 0, 100);
    if (coachText(c.coach) !== ct0) msg(c, 'coach', 'El entrenador: «' + coachText(c.coach) + '»', COACH_LINE[coachText(c.coach)] || '');
    // gestión: química con el compañero (jugando juntos; simulado cuenta menos) y la semana de entrenamiento
    if (c.mate) c.mate.chem = clamp((c.mate.chem | 0) + (sim ? 3 : 5), 0, 100);
    var tr = trainWeek(c);
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
      sim: !!sim, nota: nota, me: me, xp: xp, lvlUp: lv.lvlUp, lvl: lv.lvl, ptsGained: lv.pts, badges: badges, coach: c.coach, train: tr, chem: c.mate ? c.mate.chem : 0,
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
    // (v1 tenía control «Los dos» y sumaba lo de la pareja; en v2 la Carrera siempre es «uno»: la nota es solo tuya)
    mine.nota = rating(mine, { win: win, sets: res.sets }, rallies);
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
    return playerOvr(c) + (an == null ? 0 : (an - 6) * 6) + (c.coach - 50) / 10 + 0.5 * badgePower(c.player) + (c.listed ? LISTED_BONUS : 0);
  }
  var LISTED_BONUS = 5, LISTED_COACH = 8;   // transferible: más interés de los clubes, menos confianza del entrenador
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
    // (transferible: basta con 6,5; el club ya sabe que te quieres ir)
    if (mid && an < (c.listed ? 6.5 : 7)) return [];
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
      if (it > 0) { var rl = it > ROLE_NEED[2] ? 2 : it > ROLE_NEED[1] ? 1 : 0;
        cand.push({ club: k.id, lvl: kl, ovr: Math.round(o), q: q, interest: round1(it), mate: clampI(Math.round(o) + 3, 1, 99),
          role: ROLE_LV[rl], years: 1 + Math.floor(r() * 3), salary: salaryOf(kl, q, rl) }); }
    });
    // las 3 mejores, con preferencia por los clubes de la liga de arriba; se muestran de mejor a peor club
    cand.sort(function (a, b) { return (b.interest + 4 * (b.lvl - myL)) - (a.interest + 4 * (a.lvl - myL)); });
    cand = cand.slice(0, 3);
    // ficha completa: el compañero que tendrías (el mismo que te dan al firmar) y el objetivo aproximado
    cand.forEach(function (x) { var mt = newMate(c, club(c, x.club), rng(hash(c.seed, 'offmate', c.season, mid ? 'mid' : 'end', x.club)), x.mate); x.mateP = mt; x.mate = ovrOf(mt.st); });
    cand.sort(function (a, b) { return b.lvl - a.lvl || b.ovr - a.ovr; });
    return cand;
  }
  function midWindow(c) {
    var o = genOffers(c, true);
    c.offers = o; c.window = o.length ? 'mid' : '';
    if (o.length) msg(c, 'offer', 'Ventana de fichajes: ' + plural(o.length, 'oferta', 'ofertas'), 'Tu agente ha recibido ' + plural(o.length, 'oferta', 'ofertas') + ' a mitad de temporada. Caducan al jugar o simular el siguiente partido. Míralas en Club › Ofertas.');
    // el entrenador repasa el objetivo a mitad de temporada
    var pos = posOf(c, c.myClub), okp = pos <= c.objective.pos;
    msg(c, 'obj', 'Mitad de temporada: ' + pos + '.º', okp ? 'Vamos ' + pos + '.º y el objetivo (' + c.objective.text.toLowerCase() + ') está a nuestro alcance. No bajemos el ritmo.'
      : 'Vamos ' + pos + '.º y así no llegamos al objetivo (' + c.objective.text.toLowerCase() + '). Necesito más de ti en la segunda vuelta.');
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
    // contrato: si era tu última temporada, el club propone renovar (rol según la confianza del entrenador)
    var ct = c.contract;
    if (ct && (ct.left | 0) <= 1) {
      var rl = c.coach >= 70 ? 2 : c.coach >= 45 ? 1 : 0, nq = c.pendingQ[me.id] != null ? c.pendingQ[me.id] : me.q;
      c.review.renew = { role: ROLE_LV[rl], salary: salaryOf(nextLvl(c, me), nq, rl), years: c.coach >= 45 ? 2 : 1 };
    }
    msg(c, 'club', 'Fin de la temporada ' + c.season + ': ' + pos + '.º', 'Objetivo ' + (objOk ? 'cumplido' : 'no cumplido') + ' (' + c.objective.text.toLowerCase() + ').' +
      (myMove > 0 ? ' ¡El club asciende!' : myMove < 0 ? ' El club desciende.' : '') + ' ' + (c.offers.length ? 'Tienes ' + plural(c.offers.length, 'oferta', 'ofertas') + ' de otros clubes.' : 'No han llegado ofertas de otros clubes.') +
      (c.review.renew ? ' Se te acaba el contrato: el club te ofrece renovar como ' + c.review.renew.role.toLowerCase() + '.' : ''));
  }
  function applyMoves(c) {
    var qs = c.pendingQ || nextQs(c, c.pendingMoves);   // guardados de antes de pendingQ: se calcula igual
    (c.pendingMoves || []).forEach(function (mv) { var k = club(c, mv.id); if (k) k.lvl = mv.to; });
    c.clubs.forEach(function (k) { if (qs[k.id] != null) k.q = qs[k.id]; });
    c.pendingMoves = null; c.pendingQ = null;
  }
  function newSeason(c, offer, years) {
    applyMoves(c);
    var r = rng(hash(c.seed, 'season', c.season + 1)), moved = offer && offer.club !== c.myClub, renew = c.review && c.review.renew;
    if (moved) joinClub(c, offer, years);
    else {
      // el club renueva tu compañero si ha cambiado de liga o si se ha quedado muy por debajo del nivel del club
      var k = myClub(c), want = clubOvr(k) + 3;
      if (mateOvr(c) < want - 4) { c.mate = newMate(c, k, r); msg(c, 'club', 'Nuevo compañero', 'El club ha fichado a ' + c.mate.name + ' (' + c.mate.role.toLowerCase() + ', media ' + mateOvr(c) + ') para jugar contigo. Tendréis que haceros el uno al otro.'); }
      c.squad = genSquad(c, k, c.mate, rng(hash(c.seed, 'squad', c.season + 1, k.id)));   // la plantilla cambia cada verano
      var ct = c.contract || { club: k.id, years: 1, left: 1, role: ROLE_LV[1], salary: salaryOf(k.lvl, k.q, 1), since: c.season };
      ct.left = Math.max(0, (ct.left | 0) - 1);
      if (ct.left <= 0) {   // renovación (stay(años)): rol y sueldo de la propuesta del club
        var y = clampI(years != null ? years : renew ? renew.years : 1, 1, 3);
        c.contract = { club: k.id, years: y, left: y, role: renew ? renew.role : ct.role, salary: renew ? renew.salary : ct.salary, since: c.season + 1 };
        msg(c, 'club', 'Contrato renovado', 'Has renovado con ' + k.name + ' por ' + plural(y, 'temporada', 'temporadas') + ' como ' + c.contract.role.toLowerCase() + '.');
      } else c.contract = ct;
    }
    c.season++; c.week = 0; c.phase = 'league'; c.cup = null; c.notes = []; c.stats = newSeasonStats(); c.offers = []; c.window = ''; c.review = null;
    c.player.age = (c.player.age | 0) + 1;
    // verano: la fatiga se recupera y la petición de traspaso caduca (antes seguía para siempre y no volvía a costar nada)
    var fat0 = c.fatigue | 0; c.fatigue = 0;
    if (fat0 > FAT_FREE) msg(c, 'train', 'Vacaciones', 'El verano te ha sentado bien: llegas a la pretemporada sin fatiga (tenías ' + fat0 + ').');
    if (c.listed) { c.listed = false; msg(c, 'agent', 'Traspaso', 'Tu petición de traspaso caduca con la temporada. Si quieres salir, vuelve a pedirlo.'); }
    genSchedule(c);
    c.objective = makeObjective(c);
    if (moved) welcome(c);
    else msg(c, 'obj', 'Objetivo de la temporada ' + c.season, 'El club quiere: ' + c.objective.text.toLowerCase() + '.');
    c.last = null;
  }
  /** Acepta la oferta i (inicio: firmas por el club —o haces la prueba—; fin de temporada: empieza la siguiente en el club nuevo;
   *  mitad: cambias de club ya). years = duración del contrato que eliges (1-3; por defecto la de la oferta). Devuelve true si has
   *  firmado; false si no (en una prueba fallida c.pick.fail = id del club y la oferta desaparece). */
  function acceptOffer(i, years) {
    var c = load(); if (!c || !c.offers || !c.offers[i]) return false;
    var o = c.offers[i];
    if (c.phase === 'pick') {
      if (o.trial) {
        var pass = rng(hash(c.seed, 'trial', o.club, c.pick.round))() < o.chance;
        if (!pass) {
          c.offers.splice(i, 1); c.pick.fail = o.club;
          msg(c, 'agent', 'Prueba no superada', club(c, o.club).name + ' te ha visto en la prueba y prefiere esperar. Aún tienes ' + plural(c.offers.length, 'oferta', 'ofertas') + ' de la Liga Regional.');
          if (!c.offers.length) c.offers = genStartOffers(c, ++c.pick.round);
          save(c); return false;
        }
        msg(c, 'agent', '¡Prueba superada!', club(c, o.club).name + ' te ficha tras la prueba. Empiezas en la ' + league(o.lvl).name + ', una categoría por encima.');
      }
      joinClub(c, o, years); save(c); return true;
    }
    // salir con contrato en vigor (te quedan más temporadas que esta) sin haberte declarado transferible: el club anterior pone
    // pegas y llegas con menos confianza del entrenador (EARLY_COACH). Los años del contrato ya cuentan para algo.
    o.early = earlyExit(c);
    if (o.early) msg(c, 'agent', 'Salida con contrato', club(c, c.myClub).name + ' no quería dejarte ir: aún te quedaban ' + plural((c.contract.left | 0) - (c.phase === 'off' ? 1 : 0), 'temporada', 'temporadas') + ' de contrato. Llegas a ' + club(c, o.club).name + ' con algo menos de confianza del entrenador.');
    if (c.window === 'end' && c.phase === 'off') { newSeason(c, o, years); save(c); return true; }
    if (c.window === 'mid') {
      joinClub(c, o, years);
      c.last = null;   // el último partido era de tu club anterior: la tarjeta «Jornada N» ya no tiene sentido bajo el club nuevo
      save(c); return true;
    }
    return false;
  }
  /** ¿Fichar ahora por otro club sería salir con contrato en vigor? (mitad de temporada: siempre que tengas contrato; fin de
   *  temporada: si te queda más de esta). Ser transferible lo evita. */
  function earlyExit(c) {
    if (!c || c.phase === 'pick' || c.listed || !c.contract) return false;
    return (c.contract.left | 0) > (c.phase === 'off' ? 1 : 0);
  }
  /** Sigue en tu club: fin de temporada → empieza la siguiente (y renueva por `years` si se acababa el contrato); mitad → descarta
   *  las ofertas. */
  function stay(years) {
    var c = load(); if (!c || c.phase === 'pick') return false;
    if (c.phase === 'off') newSeason(c, null, years);
    else { c.offers = []; c.window = ''; }
    save(c); return true;
  }
  /** Negociar una oferta: pedir un rol más (y su sueldo). Sale si el interés del club da para ello (con algo de margen y azar); si
   *  no, la oferta queda «firme» (ya no negocian más). Devuelve 'ok' | 'no' | ''. */
  function negotiate(i) {
    var c = load(); if (!c || !c.offers || !c.offers[i]) return '';
    var o = c.offers[i], rl = ROLE_LV.indexOf(o.role);
    if (o.firm || o.trial || rl >= 2) return '';
    // integración (10-nov-2026): antes se aceptaba el 93 % y fallar no costaba nada. Ahora sale con un margen justo (+0..4 sobre
    // el interés) y, si no sale, el entrenador de ese club te recibirá con NEG_COACH menos de confianza si firmas igualmente
    var r = rng(hash(c.seed, 'neg', c.season, c.phase, o.club, c.week)), ok = o.interest + r() * 4 > ROLE_NEED[rl + 1];
    var k = club(c, o.club);
    if (ok) { o.role = ROLE_LV[rl + 1]; o.salary = salaryOf(o.lvl, o.q != null ? o.q : k.q, rl + 1); o.interest = round1(o.interest - 2); }
    else o.negNo = true;
    o.firm = true;
    msg(c, 'offer', ok ? 'Negociación: aceptada' : 'Negociación: rechazada', ok ? k.name + ' acepta: firmarías como ' + o.role.toLowerCase() + ' (' + o.salary + ' € al mes).' : k.name + ' no mejora su oferta y no le ha gustado que pidieras más: si firmas, el entrenador empezará con menos confianza.');
    save(c); return ok ? 'ok' : 'no';
  }

  // ------------------------------------------------------------------ gestión durante la temporada
  function setTraining(k) {
    var c = load(); if (!c || !TRAIN[k] || c.train === k) return false;
    c.train = k; save(c); return true;
  }
  /** Declararte transferible (on = true) o retirarlo. El entrenador pierde confianza; los clubes, más interesados. */
  function requestTransfer(on) {
    var c = load(); if (!c || c.phase === 'pick' || !!on === !!c.listed) return false;
    c.listed = !!on;
    if (on) { c.coach = clamp(c.coach - LISTED_COACH, 0, 100); msg(c, 'coach', 'Has pedido el traspaso', 'Entiendo que quieras jugar más arriba, pero no me gusta. Tu agente ya avisa a los clubes: llegarán más ofertas (a mitad de temporada basta con una nota media de 6,5).'); }
    else { c.coach = clamp(c.coach + 3, 0, 100); msg(c, 'coach', 'Sigues con nosotros', 'Me alegra que retires la petición de traspaso. A trabajar.'); }
    save(c); return true;
  }
  /** Cambiar de compañero por el i-ésimo de la plantilla (c.squad). Necesita la confianza del entrenador (≥ 40). La química se
   *  guarda con cada compañero (vuelve si regresas con él). Devuelve 'ok' | 'coach' (el entrenador no te deja) | ''. */
  var MATE_COACH = 40;
  function changeMate(i) {
    var c = load(); if (!c || c.phase === 'pick' || !c.squad || !c.squad[i]) return '';
    if (c.coach < MATE_COACH) { msg(c, 'coach', 'Cambio de compañero: no', 'Antes de pedirme cambios gánate la confianza del equipo en la pista.'); save(c); return 'coach'; }
    var nm = c.squad[i]; c.squad[i] = c.mate; c.mate = nm;
    msg(c, 'coach', 'Nuevo compañero: ' + nm.name, 'De acuerdo: desde la próxima jornada juegas con ' + nm.name + ' (' + nm.role.toLowerCase() + ', ' + nm.style.toLowerCase() + ').' + ((nm.chem | 0) < 30 ? ' Os costará entenderos al principio.' : ''));
    save(c); return 'ok';
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
    // gestión (v2)
    TRAIN: TRAIN, TRAIN_KEYS: TRAIN_KEYS, TGROUP: TGROUP, TRAIN_NEED: TRAIN_NEED, FAT_FREE: FAT_FREE, CHEM_KEYS: CHEM_KEYS, ROLE_LV: ROLE_LV, MATE_COACH: MATE_COACH,
    rejectAll: rejectAll, moreTime: moreTime, negotiate: negotiate, setTraining: setTraining, requestTransfer: requestTransfer, changeMate: changeMate,
    clubInfo: clubInfo, objectiveFor: objectiveFor, chemBonus: chemBonus, fatigueMalus: fatigueMalus, trialChance: trialChance,
    earlyExit: earlyExit, ROLE_COACH: ROLE_COACH, STYLE_TRAIN: STYLE_TRAIN, STYLE_PROG: STYLE_PROG, EARLY_COACH: EARLY_COACH, NEG_COACH: NEG_COACH,
    unread: unread, readMsg: readMsg, readAll: readAll,
    _M: function () { return M; }, _reset: function () { cur = null; M = null; }, _genOffers: genOffers, _rng: rng, _hash: hash
  };
})();
