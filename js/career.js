/* MAKE THE CUT — js/career.js (owner: ui_main)
 * Modo Carrera 2v2 de VÓLEY PLAYA: datos y lógica, sin DOM ni Three (se carga también en node: tools/careertest.js).
 *
 * Tu jugador es un atleta de VB.Prog (st, lvl, xp, pts, bp/bd/beq de VB.Badges) con su propio guardado ('voley3d.career').
 * Empiezas en un club modesto del circuito más bajo; el club te pone pareja. 5 circuitos de 8 clubes de vóley playa (inventados),
 * temporada = liga a doble vuelta (14 jornadas) + open de los 4 primeros (semifinales 1-4 y 2-3, final). Cada jornada juegas tu
 * partido de verdad en la arena (main.js lo arranca con matchSetup: reglas de playa, sets a 21 y el 3r a 15, pista 16×8) o lo
 * simulas; el resto se simula (quickSim). Nota del partido 1-10, objetivo del club, confianza del entrenador, ofertas (mitad y
 * final de temporada), ascensos y descensos. Diseño y calibrado en notes/carrera.md.
 *
 * Sprint playa (10-nov-2026, v3): la Carrera pasa del pabellón a la playa (venue 'beach' en matchSetup; quickSim a 21/15); los
 * clubes son de vóley playa (nombres, sede en una playa inventada; migrate() renombra los de los guardados v1/v2 sin tocar
 * resultados); el compañero tiene una media propia con horquilla ancha respecto al club (MATE_OFF: −9..+5, media −2, antes
 * siempre club + 3: nerf medido en notes/carrera.md), rol que se nota, puntos fuertes y flojos (mateProfile) y forma (m.form).
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
 *   setDifficulty(k)   → cambia la dificultad de la Carrera entre partidos ('ok' | 'same' | 'bad' | 'match' | '')
 *   rivalAI(c, k)      → IA rival efectiva del club k en la dificultad de la Carrera {step, base, diff, soft, name}
 *
 * Dificultad de la Carrera (12-nov-2026): c.diff (easy/normal/hard/expert, Normal por defecto = la Carrera de siempre), tabla
 * CDIFF con todas las palancas (IA rival, atributos de los rivales, experiencia, entreno, entrenador, objetivo, ofertas) y c.dUse
 * (partidos de la temporada en cada nivel: el historial y el palmarés guardan la más fácil). notes/carrera.md §Dificultad.
 *
 * Gestión propia (v2, 10-nov-2026; notes/carrera.md §Gestión):
 *   - Inicio: tras crear el jugador NO hay club (phase 'pick'): llegan 3-4 ofertas del Circuito Regional (y quizá una prueba en el
 *     Nacional). acceptOffer(i, años) elige; rejectAll() trae ofertas peores; moreTime() (una vez) cambia una oferta por otra.
 *   - setTraining(k) enfoque semanal (bal/phys/def/atk/rest → mejoras gratis en ese grupo de atributos o descanso de la fatiga).
 *   - requestTransfer(on) declararte transferible; negotiate(i) pedir más rol en una oferta; stay(años) renueva si toca.
 *   - changeMate(i) cambiar de compañero entre los de la plantilla (c.squad); química con el compañero (c.mate.chem).
 *   - Bandeja de mensajes c.inbox (entrenador, ofertas, objetivos): readMsg(id), readAll(), unread(c).
 *   - En la Carrera solo controlas a tu jugador (ctrl siempre 'one'; los guardados con 'both' se migran).
 */
(function () {
  'use strict';
  /** Ordinal corto (estilo de Ferran): 1r, 2º, 3r, 4º… Nunca «1.er». */
  function ordn(n) { return n + (n === 1 || n === 3 ? 'r' : 'º'); }
  var root = typeof window !== 'undefined' ? window : globalThis;
  var VB = root.VB = root.VB || {};
  var KEY = 'voley3d.career', VER = 3;   // v1 → v2: gestión (inicio sin club, contrato, entrenamiento, plantilla, bandeja); v2 → v3: playa; migrate()
  var KEYS = ['jump', 'speed', 'react', 'recv', 'dig', 'set', 'spike', 'ctl', 'block', 'serve'];
  var WEEKS = 14, MID_WEEK = 7, CLUBS_PER = 8;
  // vóley playa: todos los partidos de la Carrera (jugados y simulados) se juegan en la arena con sus reglas (sim: createGame({venue}))
  var VENUE = 'beach', PTS = VB.BEACH && VB.BEACH.points || 21, PTS3 = VB.BEACH && VB.BEACH.points3 || 15;

  // ------------------------------------------------------------------ ligas
  // ovr = media de atributos de los rivales [peor club, mejor club]; diff = perfil de la IA rival más habitual en la liga (el de
  // cada club sale de su media: difficultyFor / DIFF_AT).
  // xp = multiplicador de la experiencia. ref = error arbitral y challenge (tabla del TRASPASO; sim la aplica con createGame({ref}): g.refErr y g.chalPerSet).
  // Calibrado con la sim en autopilot (notes/carrera.md §Calibrado).
  var REF = {
    low: { p1: 0.55, p2: 0.40, p3: 0.22, d3: 0.25, chal: 0, judges: false, name: 'Error arbitral alto, sin challenge' },
    mid: { p1: 0.45, p2: 0.25, p3: 0.12, d3: 0.15, chal: 0, judges: false, name: 'Error arbitral medio, sin challenge' },
    high: { p1: 0.20, p2: 0.08, p3: 0.02, d3: 0.10, chal: 0, judges: true, name: 'Jueces de línea, sin challenge' },
    top: { p1: 0.20, p2: 0.08, p3: 0.02, d3: 0.10, chal: 2, judges: true, name: 'Jueces de línea y challenge' }
  };
  // Circuitos de vóley playa (sprint playa: antes «Liga Regional»… «Circuito Mundial»; los guardados viejos conservan en el
  // historial y el palmarés los nombres de entonces). La copa de los 4 primeros es el «Open» del circuito.
  var LEAGUES = [
    { lvl: 0, name: 'Circuito Regional', art: 'el', short: 'Regional', cup: 'Open Regional', diff: 'easy', ovr: [28, 40], xp: 1, ref: 'low' },
    { lvl: 1, name: 'Circuito Nacional', art: 'el', short: 'Nacional', cup: 'Open Nacional', diff: 'normal', ovr: [38, 50], xp: 1.5, ref: 'mid' },
    { lvl: 2, name: 'Hiperliga de Playa', art: 'la', short: 'Hiperliga', cup: 'Open de la Hiperliga', diff: 'normal', ovr: [48, 61], xp: 2.1, ref: 'mid' },
    { lvl: 3, name: 'Circuito Continental', art: 'el', short: 'Continental', cup: 'Open Continental', diff: 'hard', ovr: [58, 71], xp: 2.8, ref: 'high' },
    { lvl: 4, name: 'Circuito Mundial', art: 'el', short: 'Mundial', cup: 'Final a Cuatro Mundial', diff: 'hard', ovr: [68, 84], xp: 3.6, ref: 'top' }
  ];
  /** «el Circuito Regional» / «la Hiperliga de Playa» (art = artículo); toL: «al Circuito…» / «a la Hiperliga…». */
  function lname(L) { return L.art + ' ' + L.name; }
  function toL(L) { return (L.art === 'el' ? 'al ' : 'a la ') + L.name; }
  var POINTS = [PTS];   // (v1/v2 elegían 11/15/21/25; en la playa siempre a 21 y el 3r a 15)

  // ------------------------------------------------------------------ roles (desviaciones sobre la media; suman 0)
  // (vóley playa: la pareja es bloqueador + defensor; las claves atk/cr/uni se conservan en los guardados)
  var ROLES = {
    atk: { name: 'Bloqueador', hint: 'Remate, salto y bloqueo en la red', off: { jump: 6, speed: 0, react: 0, recv: -7, dig: -4, set: -10, spike: 7, ctl: 3, block: 4, serve: 1 } },
    uni: { name: 'Universal', hint: 'Un poco de todo', off: { jump: 1, speed: 2, react: 2, recv: 1, dig: 1, set: 0, spike: -1, ctl: -2, block: -3, serve: -1 } },
    cr: { name: 'Defensor', hint: 'Recepción, colocación y defensa en la arena', off: { jump: -5, speed: 1, react: 2, recv: 7, dig: 4, set: 9, spike: -8, ctl: 1, block: -7, serve: -4 } }
  };
  var MATE_ROLE = { atk: 'cr', cr: 'atk', uni: 'uni' };
  // Carrera de pista (6v6, lote C): puestos del 6v6 con su perfil (claves de sim.js: OH receptor, S colocador, OPP opuesto, MB central,
  // L líbero). genSt los entiende igual que los roles de playa (la playa nunca los pide: su 2v2 no cambia).
  var POS6 = {
    OH: { name: 'Receptor', hint: 'Recibe, defiende y remata por la izquierda', off: { jump: 3, speed: 0, react: 0, recv: 4, dig: 2, set: -9, spike: 4, ctl: 0, block: -4, serve: 0 } },
    S: { name: 'Colocador', hint: 'El segundo toque: reparte el juego', off: { jump: -2, speed: 2, react: 3, recv: -3, dig: 1, set: 10, spike: -7, ctl: 4, block: -4, serve: -4 } },
    OPP: { name: 'Opuesto', hint: 'Remate por la derecha y bloqueo', off: { jump: 5, speed: -1, react: 0, recv: -8, dig: -3, set: -6, spike: 8, ctl: 2, block: 3, serve: 0 } },
    MB: { name: 'Central', hint: 'Bloqueo y primer tiempo en el centro', off: { jump: 7, speed: -3, react: 3, recv: -9, dig: -6, set: -5, spike: 4, ctl: 0, block: 9, serve: 0 } },
    L: { name: 'Líbero', hint: 'Recepción y defensa, solo atrás', off: { jump: -8, speed: 4, react: 5, recv: 9, dig: 9, set: 2, spike: -10, ctl: 2, block: -10, serve: -3 } }
  };
  var START_OVR = 35;
  // Compañero: media = media del club + un desvío propio con horquilla ancha (MATE_OFF: −9..+5, media −2; reparto casi plano entre −6
  // y +1 con colas hasta los extremos: desviación 3,2, un 26 % de compañeros a ≤ −5 y un 9 % a ≥ +3). Antes era
  // siempre club + 3 y en el Circuito Nacional el compañero IA hacía más puntos que un jugador medio (16,6 contra 15,5 por
  // partido con el bot «medio» de simtest; con media −2: ~14,5 contra 15,4; medido en notes/carrera.md §Compañero). El club lo
  // renueva en verano si se queda a MATE_RENEW o más por debajo de la media del club.
  var MATE_OFF = [-9, 5], MATE_RENEW = 7;
  function mateOff(r) { return clampI(MATE_OFF[0] + (0.25 * r() + 0.75 * r()) * (MATE_OFF[1] - MATE_OFF[0]), MATE_OFF[0], MATE_OFF[1]); }
  // forma del compañero (−3..+3): paseo aleatorio tras cada partido tuyo, con vuelta hacia 0; suma a todos sus atributos en el
  // partido (matchSetup) y FORM_SIM × forma a la fuerza de la pareja en la simulación rápida
  var FORM_MAX = 3, FORM_SIM = 0.4;
  var FORM_TXT = ['Hundido', 'Flojo', 'Algo bajo', 'Normal', 'Bien', 'En racha', 'Imparable'];   // índice forma + 3

  // ------------------------------------------------------------------ gestión (v2)
  // Enfoque de entrenamiento semanal: cada partido (jugado o simulado) suma progreso al grupo; cada TRAIN_NEED de progreso sube
  // gratis el atributo más bajo del grupo. La fatiga sube con el entrenamiento y baja descansando; por encima de FAT_FREE resta
  // atributos en el partido (matchSetup) y fuerza en la simulación (teamOvr). Grupos = los de VB.Prog.GROUPS.
  // Integración (10-nov-2026, revisión de la Carrera): Equilibrado ya no cansa (con +4 por partido y sin recuperación hundía al
  // jugador para siempre: −4 permanente desde la 2ª temporada); los enfoques dan algo más (60) para que compense la fatiga, y en
  // verano la fatiga vuelve a 0 (newSeason).
  var TRAIN = {
    bal: { name: 'Equilibrado', hint: 'Un poco de todo, sin fatiga', prog: { phys: 15, def: 15, atk: 15 }, fat: 0 },
    phys: { name: 'Físico', hint: 'Salto, velocidad y reacción (cansa)', prog: { phys: 60 }, fat: 12 },
    def: { name: 'Defensa', hint: 'Recepción, defensa y bloqueo (cansa)', prog: { def: 60 }, fat: 12 },
    atk: { name: 'Ataque', hint: 'Colocación, potencia, control y saque (cansa)', prog: { atk: 60 }, fat: 12 },
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
  var MATE_STYLES = { atk: ['Rematador potente', 'Saltador', 'Muro en la red'], cr: ['Colocador fino', 'Pulpo en la arena', 'Receptor seguro'], uni: ['Todoterreno', 'Jugador listo', 'Sacador'] };
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
  // clubes de vóley playa: «CV Platja Rocaverde», «Arena Puertoluz Sud», «Dunes Brisamar»… y su sede, una playa inventada
  // («Cala Rocaverde», «Platja de Puertoluz»). abbr() quita los prefijos (y los de los nombres de antes, por el historial)
  var PREFIX = ['CV Platja', 'Arena', 'Platja', 'Club Platja', 'Vóley Playa', 'Beach Vòlei', 'Sorra', 'Dunes', 'Litoral', 'Costa'];
  var SUFFIX = ['', '', '', ' Sud', ' Nord', ' Marina', ' Beach', ' Sand', ' 1998', ' Dunes'];
  var BEACHES = ['Cala {c}', 'Platja de {c}', 'Playa de {c}', 'Arenal de {c}', 'Platja Gran de {c}', 'Dunas de {c}', 'Cala Fonda de {c}', 'Playa Larga de {c}', 'Platja dels Pins de {c}', 'Caló de {c}'];
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
  function costOf(v) { var p = P(); return p && p.cost ? p.cost(v) : (v < 60 ? 1 : v < 70 ? 2 : v < 85 ? 3 : 4); }
  function round1(v) { return Math.round(v * 10) / 10; }

  /** Atributos de un jugador de media o y rol role (ruido determinista con r). La media sale exacta (±0,5). */
  function genSt(o, role, r) {
    var off = (ROLES[role] || POS6[role] || ROLES.uni).off, st = {}, k, sum = 0;
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
    if (!o || typeof o !== 'object' || [1, 2, VER].indexOf(o.v) < 0 || !o.player || typeof o.player !== 'object' || !Array.isArray(o.clubs) || !o.clubs.length) return null;
    var p = P();
    if (p && p.saneAthlete) {
      var d = p.newAthlete({ num: o.player.num, role: o.player.role, name: o.player.name });
      o.player = (function (src, dst) { p.saneAthlete(src, dst); dst.roleKey = ROLES[src.roleKey] ? src.roleKey : 'uni'; dst.age = clampI(src.age, 15, 60); return dst; })(o.player, d);
    }
    o.player.roleKey = ROLES[o.player.roleKey] ? o.player.roleKey : 'uni'; o.player.role = ROLES[o.player.roleKey].name;   // (v3: «Bloqueador» / «Defensor»)
    o.points = PTS;   // vóley playa: sets a 21 (los guardados v1/v2 elegían 11-25)
    o.ctrl = 'one';   // en la Carrera solo se controla a tu jugador (los guardados con 'both' se migran)
    try { o = saneDeep(o); return o ? migrate(o) : null; } catch (e) { return null; }
  }
  /** v1 → v2 y huecos de la gestión: contrato, plantilla, química, entrenamiento, fatiga, bandeja. No toca el progreso (un jugador
   *  que ya estaba en un club sigue en él: no se le obliga a elegir de nuevo). Idempotente (se aplica también a guardados v2). */
  function migrate(o) {
    var num = function (v) { return typeof v === 'number' && isFinite(v); }, v0 = o.v | 0, old = v0 < 2, oldBeach = v0 < 3;
    o.v = VER;
    if (!Array.isArray(o.inbox)) o.inbox = [];
    // v2 → v3 (sprint playa): los clubes pasan a ser de vóley playa (nombre, abreviatura y sede nuevos; ids, nivel, nivel q,
    // equipación, calendario y resultados intactos: lo jugado se queda), los roles se llaman Bloqueador / Defensor y a partir de
    // ahora se juega en la arena a 21. El historial y el palmarés cambian el nombre del club (mismo club) y el mensaje lo cuenta
    if (oldBeach) { beachify(o); msg(o, 'club', 'La Carrera se muda a la playa', 'Desde ahora todos los partidos se juegan en la arena de Platja Llarga con reglas de vóley playa: pista de 16 × 8, sets a ' + PTS + ' y el tercero a ' + PTS3 + ', cambio de campo cada 7 puntos. Los clubes son de vóley playa (los tuyos, con otro nombre pero la misma plantilla y los mismos resultados) y las parejas son bloqueador y defensor. Los partidos ya jugados se quedan como estaban.'); }
    beachTrophies(o);
    var fixRole = function (m) { if (m && m.st) { m.roleKey = ROLES[m.roleKey] ? m.roleKey : 'uni'; m.role = ROLES[m.roleKey].name; if (!num(m.form)) m.form = 0; } };
    fixRole(o.mate); (Array.isArray(o.squad) ? o.squad : []).forEach(fixRole); (Array.isArray(o.offers) ? o.offers : []).forEach(function (x) { if (x) fixRole(x.mateP); });
    o.inbox = o.inbox.filter(function (m) { return m && typeof m.t === 'string'; }).slice(-INBOX_MAX);
    o.msgN = num(o.msgN) ? o.msgN | 0 : o.inbox.reduce(function (s, m) { return Math.max(s, (m.id | 0) + 1); }, 0);
    if (TRAIN_KEYS.indexOf(o.train) < 0) o.train = 'bal';
    if (!o.tp || typeof o.tp !== 'object') o.tp = {};
    ['phys', 'def', 'atk'].forEach(function (g) { o.tp[g] = num(o.tp[g]) ? clamp(o.tp[g], 0, TRAIN_NEED - 1) : 0; });
    o.fatigue = num(o.fatigue) ? clamp(Math.round(o.fatigue), 0, 100) : 0;
    o.listed = !!o.listed;
    o.money = num(o.money) ? Math.max(0, Math.round(o.money)) : 0;   // (11-nov-2026: el sueldo se cobra y se ahorra)
    // dificultad de la Carrera (12-nov-2026): lo que falta es Normal (la Carrera de antes). Idempotente
    if (CDIFF_KEYS.indexOf(o.diff) < 0) o.diff = 'normal';
    var hadUse = !!o.dUse && typeof o.dUse === 'object';
    if (!hadUse) o.dUse = {};
    CDIFF_KEYS.forEach(function (k) { o.dUse[k] = num(o.dUse[k]) ? Math.max(0, o.dUse[k] | 0) : 0; });
    if (!hadUse && o.stats && num(o.stats.played)) o.dUse.normal = Math.max(0, (o.stats.played | 0) + (num(o.stats.bench) ? o.stats.bench | 0 : 0));   // lo jugado esta temporada (y los banquillos) fue en Normal
    if (o.coachD != null && CDIFF_KEYS.indexOf(o.coachD) < 0) delete o.coachD;
    // objetivo sin sello (guardados de antes): el nivel más fácil con partidos esta temporada o, si no hay, el actual
    if (o.objective && typeof o.objective === 'object' && CDIFF_KEYS.indexOf(o.objective.d) < 0) o.objective.d = lowUse(o.dUse) || o.diff;
    (Array.isArray(o.history) ? o.history : []).forEach(function (h) { if (h && typeof h === 'object') { if (CDIFF_KEYS.indexOf(h.d) < 0) h.d = 'normal'; h.dm = !!h.dm; } });
    (Array.isArray(o.trophies) ? o.trophies : []).forEach(function (t) { if (t && typeof t === 'object' && CDIFF_KEYS.indexOf(t.d) < 0) t.d = 'normal'; });
    if (o.review && typeof o.review === 'object') {
      // resumen sin sello (o rehecho por saneDeep): el de esa temporada en el historial; si no, el de dUse (si venía guardado); si no, Normal
      if (CDIFF_KEYS.indexOf(o.review.d) < 0) {
        var hs = (Array.isArray(o.history) ? o.history : []).filter(function (h) { return h && typeof h === 'object' && h.season === o.review.season; }).pop();
        var sd0 = hs ? { d: hs.d, dm: hs.dm } : hadUse ? seasonDiff(o) : { d: 'normal', dm: false };
        o.review.d = sd0.d; o.review.dm = sd0.dm;
      }
      o.review.dm = !!o.review.dm;
    }
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
    o.clubs.forEach(function (k) { k.q = clamp(k.q, 0.02, 0.98); if (typeof k.short !== 'string') k.short = abbr(k.name); if (typeof k.city !== 'string') k.city = ''; if (typeof k.beach !== 'string') k.beach = beachOf(k.city || k.name, rng(hash(o.seed, 'sede', k.id))); });
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
    var w = name.replace(/^(CV Platja|Club Platja|Vóley Playa|Beach Vòlei|Arena|Platja|Sorra|Dunes|Litoral|Costa|CV|AD|Club Vóley|Real Club|Unión|Atlético|Deportivo|Vóley|Sporting|Olímpico)\s+/, '').split(/\s+/)[0];
    return w.normalize ? w.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3).toUpperCase() : w.slice(0, 3).toUpperCase();
  }
  /** Nombre de club de vóley playa con la ciudad (único dentro de `used`). */
  function clubName(r, city, used) { var name; do { name = pick(r, PREFIX) + ' ' + city + pick(r, SUFFIX); } while (used[name]); used[name] = 1; return name; }
  /** Sede: la playa (inventada) del club, «Cala Rocaverde», «Platja de Puertoluz»… */
  function beachOf(city, r) { return pick(r, BEACHES).replace('{c}', city); }
  function uniqueShorts(clubs) { var seen = {}; clubs.forEach(function (k) { var a = k.short, n = 1; while (seen[a]) { a = k.short.slice(0, 2) + (n++); } seen[a] = 1; k.short = a; }); }
  function genClubs(r) {
    var out = [], used = {};
    for (var L = 0; L < LEAGUES.length; L++) {
      var qs = []; for (var i = 0; i < CLUBS_PER; i++) qs.push((i + 0.5) / CLUBS_PER);
      shuffle(r, qs);
      for (var j = 0; j < CLUBS_PER; j++) {
        var idx = L * CLUBS_PER + j, city = CITIES[idx], name = clubName(r, city, used);
        var shirt = pick(r, SHIRTS), acc = pick(r, ACCENTS), sh = pick(r, SHORTS);
        if (acc === shirt) acc = ACCENTS[(ACCENTS.indexOf(acc) + 1) % ACCENTS.length];
        out.push({ id: idx, name: name, city: city, beach: beachOf(city, r), short: abbr(name), lvl: L, q: round1(clamp(qs[j] + (r() - 0.5) * 0.08, 0.02, 0.98) * 10) / 10,
          kit: { shirt: shirt, accent: acc, shorts: sh, pattern: pick(r, PATTERNS) } });
      }
    }
    uniqueShorts(out);   // abreviaturas únicas
    return out;
  }
  /** Guardado v1/v2 (clubes de pabellón) → clubes de vóley playa: nombre, abreviatura y sede nuevos con una semilla propia; ids,
   *  nivel, q, equipación, calendario, resultados, contrato y mensajes intactos. El historial y el palmarés pasan al nombre nuevo
   *  del MISMO club (por id en el historial; por nombre en los trofeos). */
  function beachify(o) {
    var r = rng(hash(o.seed, 'playa')), used = {}, ren = {};
    o.clubs.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (k) {
      var city = typeof k.city === 'string' && k.city ? k.city : CITIES[k.id % CITIES.length], nm = clubName(r, city, used);
      ren[k.name] = nm; k.name = nm; k.city = city; k.beach = beachOf(city, r); k.short = abbr(nm);
    });
    uniqueShorts(o.clubs);
    (Array.isArray(o.history) ? o.history : []).forEach(function (h) { var k = h && club(o, h.club); if (k) h.clubName = k.name; });
    (Array.isArray(o.trophies) ? o.trophies : []).forEach(function (t) { if (t && ren[t.club]) t.club = ren[t.club]; });
    if (o.review && ren[o.review.clubName]) o.review.clubName = ren[o.review.clubName];
    if (o.last && ren[o.last.rivalName]) o.last.rivalName = ren[o.last.rivalName];
  }
  /** Palmarés de los guardados v1/v2: las competiciones de pabellón («Liga Regional», «Copa Nacional», «Ascenso a Superliga»…)
   *  pasan al circuito de playa del mismo nivel («Circuito Regional», «Open Nacional», «Ascenso a la Hiperliga de Playa»). El club
   *  ya lo renombra beachify. Idempotente (también arregla los guardados que ya migraron a v3 con el nombre viejo). */
  var OLD_LG = ['Liga Regional', 'Liga Nacional', 'Superliga', 'Liga Continental', 'Circuito Mundial'];
  var OLD_CUP = ['Copa Regional', 'Copa Nacional', 'Copa de la Superliga', 'Copa Continental', 'Final a Cuatro Mundial'];
  // (v3 llamaba «Superliga de Playa» al nivel 2; ahora es la Hiperliga: «Superliga de Playa» → «Hiperliga de Playa», «Open de la Superliga» → «Open de la Hiperliga»)
  var OLD_LG3 = { 'Superliga de Playa': 2 }, OLD_CUP3 = { 'Open de la Superliga': 2 };
  function oldIdx(arr, map, n) { var i = arr.indexOf(n); return i >= 0 ? i : Object.prototype.hasOwnProperty.call(map, n) ? map[n] : -1; }
  function beachTrophies(o) {
    (Array.isArray(o.trophies) ? o.trophies : []).forEach(function (t) {
      if (!t || typeof t.name !== 'string') return;
      var i = t.kind === 'liga' ? oldIdx(OLD_LG, OLD_LG3, t.name) : t.kind === 'copa' ? oldIdx(OLD_CUP, OLD_CUP3, t.name) : t.kind === 'ascenso' ? oldIdx(OLD_LG, OLD_LG3, t.name.replace(/^Ascenso a (la )?/, '')) : -1;
      if (i < 0) return;
      t.name = t.kind === 'liga' ? LEAGUES[i].name : t.kind === 'copa' ? LEAGUES[i].cup : 'Ascenso ' + toL(LEAGUES[i]);
    });
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
  /** Partido al mejor de 3 punto a punto: prob. de ganar cada punto 0,5 + 0,009 × (oa − ob) (0,2-0,8). Playa: sets a 21 y el
   *  3r a 15 (points por defecto PTS; el tercero siempre a mín(PTS3, points)). */
  function quickSim(oa, ob, r, points) {
    points = points || PTS;
    var pA = clamp(0.5 + 0.009 * (oa - ob), 0.2, 0.8), sets = [0, 0], sc = [];
    while (sets[0] < 2 && sets[1] < 2) {
      var tgt = sets[0] + sets[1] === 2 ? Math.min(PTS3, points) : points, a = 0, b = 0;
      while (!((a >= tgt || b >= tgt) && Math.abs(a - b) >= 2)) { if (r() < pA) a++; else b++; }
      sc.push([a, b]); sets[a > b ? 0 : 1]++;
    }
    return { sets: sets, setScores: sc };
  }
  function setPts(s) { return s[0] === 2 ? (s[1] === 0 ? [3, 0] : [2, 1]) : (s[0] === 0 ? [0, 3] : [1, 2]); }

  // ------------------------------------------------------------------ jugador y compañero
  function playerOvr(c) { return ovrOf(c.player.st); }
  function mateOvr(c) { return ovrOf(c.mate.st); }
  /** Compañero del club k: media = la del club + un desvío propio (mateOff: −9..+5; antes siempre +3), rol complementario. ovr/role:
   *  los fija quien llama (plantilla). Lleva forma 0 y, en m.off, su desvío respecto al club (la ficha lo enseña). */
  function newMate(c, k, r, ovr, roleKey) {
    var role = roleKey && ROLES[roleKey] ? roleKey : MATE_ROLE[c.player.roleKey] || 'uni', base = clubOvr(k), o = clamp(ovr != null ? ovr : base + mateOff(r), 22, 92);
    var num; do { num = 1 + Math.floor(r() * 24); } while (num === c.player.num);
    if (c.player.num !== 2) num = 2; // el compañero lleva el 2 (como en Partido rápido); si es el tuyo, el sorteado (misma tirada)
    var m = { name: pick(r, FIRST) + ' ' + pick(r, LAST), num: num, roleKey: role, role: ROLES[role].name, st: genSt(o, role, r), chem: 0, form: 0 };
    m.style = mateStyle(m, r);
    return m;
  }
  function mateStyle(m, r) { var l = MATE_STYLES[m.roleKey] || MATE_STYLES.uni; return pick(r, l); }
  /** Puntos fuertes y flojos de un compañero (o de cualquier st): atributos a ≥ MP_D de su media, de mayor a menor desvío (hasta
   *  3 de cada). {ovr, strong: ['set', …], weak: ['spike', …]}. Sin DOM: la UI pone las etiquetas (VB.Prog.LABEL). */
  var MP_D = 4;
  function mateProfile(m) {
    var st = m && m.st ? m.st : m, o = ovrOf(st), d = KEYS.map(function (k) { return { k: k, d: st[k] - o }; });
    var strong = d.filter(function (x) { return x.d >= MP_D; }).sort(function (a, b) { return b.d - a.d; }).slice(0, 3).map(function (x) { return x.k; });
    var weak = d.filter(function (x) { return x.d <= -MP_D; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 3).map(function (x) { return x.k; });
    return { ovr: o, strong: strong, weak: weak };
  }
  /** Texto de la forma del compañero (−3..+3): «Flojo», «Normal», «En racha»… */
  function formText(f) { return FORM_TXT[clampI((f | 0) + FORM_MAX, 0, FORM_TXT.length - 1)]; }
  /** Forma del compañero tras un partido tuyo: paseo aleatorio ±1 con vuelta hacia 0 (determinista por temporada y partido). */
  function mateFormStep(c) {
    var m = c.mate; if (!m) return 0;
    var r = rng(hash(c.seed, 'form', c.season, c.notes.length, m.name)), f = m.form | 0, u = r();
    f += u < 0.3 ? -1 : u < 0.6 ? 1 : 0;
    if (f && r() < 0.3) f += f > 0 ? -1 : 1;   // la racha se gasta
    return (m.form = clampI(f, -FORM_MAX, FORM_MAX));
  }
  /** Techo del compañero en el partido: su media + la racha nunca pasa de la del club + MATE_CAP (la racha positiva se recorta;
   *  la mala se queda). Con el desvío propio (hasta +5) ya rinde como un jugador medio de su circuito; con la racha encima rompía el
   *  equilibrio (pareja +8 sobre el club). k = club (por defecto el tuyo). */
  var MATE_CAP = 6;
  function mateFormCap(c, k, mf) {
    if (!(mf > 0) || !c.mate) return mf | 0;
    k = k || myClub(c); if (!k) return mf;
    return clampI(Math.min(mf, clubOvr(k) + MATE_CAP - mateOvr(c)), 0, FORM_MAX);
  }
  /** Plantilla: otros 2 compañeros posibles en el club (además del titular), con medias que se notan: uno del mismo rol y un
   *  universal (o un bloqueador si tu rol es universal); cada uno con su desvío propio (dentro de MATE_OFF), a ≥ 3 del titular y distintos entre sí para que cambiar
   *  signifique algo (changeMate). */
  function genSquad(c, k, mate, r) {
    var base = clubOvr(k), mr = mate && mate.roleKey || MATE_ROLE[c.player.roleKey] || 'uni', t = mate ? ovrOf(mate.st) - base : 0;
    var alt = mr === 'uni' ? (c.player.roleKey === 'uni' ? 'atk' : 'uni') : 'uni';
    // cada alternativa: dentro de MATE_OFF, a ≥ 3 del titular y distinta de la otra (antes, al deshacer el empate, la 2ª podía
    // caer encima del titular, y el clamp dejaba salir la plantilla a −10..+6). fit busca el valor válido más cercano, primero
    // alejándose del titular.
    var lo = MATE_OFF[0], hi = MATE_OFF[1], offs = [];
    function okOff(o, other) { return o >= lo && o <= hi && Math.abs(o - t) >= 3 && o !== other; }
    function fit(o, other, up) {
      for (var d = 0; d <= hi - lo + 8; d++) { var a = o + (up ? d : -d), b = o - (up ? d : -d); if (okOff(a, other)) return a; if (okOff(b, other)) return b; }
      return clampI(o, lo, hi);
    }
    [mr, alt].forEach(function (x, i) {
      var o = mateOff(r), up = o >= t;
      if (Math.abs(o - t) < 3) o = t + (up ? 3 : -3) + (r() < 0.5 ? 0 : (up ? 1 : -1));
      offs.push(fit(o, i ? offs[0] : NaN, up));
    });
    var out = [newMate(c, k, r, base + offs[0], mr), newMate(c, k, r, base + offs[1], alt)];
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
    return { id: k.id, name: k.name, short: k.short, city: k.city, beach: k.beach || '', kit: k.kit, lvl: lvl, league: L.name, art: L.art, stars: starsOf(lvl, q), style: styleOf(k),
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
    var T = TRAIN[c.train] || TRAIN.bal, gains = [], f0 = c.fatigue | 0, m0 = fatigueMalus(c), prog = {}, g, Dt = cd(c).train;
    for (g in T.prog) prog[g] = T.prog[g];
    var mk = myClub(c), sg = mk ? STYLE_TRAIN[styleOf(mk)] : '';
    if (sg && c.train !== 'rest') prog[sg] = (prog[sg] || 0) + STYLE_PROG;   // estilo del club (descansando no entrenas)
    for (g in prog) {
      c.tp[g] = (c.tp[g] || 0) + Math.round(prog[g] * Dt);   // × ritmo del entreno de la dificultad (Normal: 1)
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
    // + química (0..3 → 0..1,5) − fatiga (la misma resta que en el partido, a la mitad porque solo es tu jugador) + forma del compañero
    return 0.5 * playerOvr(c) + 0.5 * mateOvr(c) + 0.35 * badgePower(c.player) + (f == null ? 0 : (f - 6.5) * 0.8) + 0.5 * chemBonus(c) - 0.5 * fatigueMalus(c) + FORM_SIM * mateFormCap(c, null, (c.mate && c.mate.form) | 0);
  }
  function form(c) { var n = c.notes || []; if (!n.length) return null; var s = 0, k = Math.min(3, n.length); for (var i = n.length - k; i < n.length; i++) s += n[i].nota; return s / k; }
  function avgNota(c) { var n = c.notes || []; if (!n.length) return null; var s = 0; n.forEach(function (x) { s += x.nota; }); return round1(s / n.length); }

  // ------------------------------------------------------------------ objetivos y entrenador
  function expectedPos(c, k) {
    var lst = clubsOf(c, k.lvl).map(clubOvr).sort(function (a, b) { return b - a; });
    return lst.indexOf(clubOvr(k)) + 1;
  }
  function makeObjective(c) { var o = objectiveFor(c, myClub(c)); o.d = diffOf(c); return o; }   // (d: nivel con el que se fijó; cuenta en el sello de la temporada)
  function objectiveFor(c, k) {
    // (dificultad: objE desplaza la posición esperada; + más blando, − más exigente. Normal: 0)
    var e = clamp(expectedPos(c, k) + cd(c).objE, 1, CLUBS_PER), top = k.lvl === LEAGUES.length - 1, low = k.lvl === 0;
    if (e <= 2) return top ? { pos: 1, text: 'Ganar el ' + league(k.lvl).name } : { pos: 2, text: 'Subir de categoría (quedar entre los 2 primeros)' };
    if (e <= 4) return { pos: 4, text: 'Quedar entre los 4 primeros (y jugar el Open)' };
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
    var c = { v: VER, seed: seed, created: o.now || Date.now(), points: PTS, ctrl: 'one',   // (playa: siempre a 21, el 3r a 15)
      season: 1, week: 0, phase: 'pick', player: player, clubs: genClubs(r), myClub: -1, mate: null, sched: null, res: null,
      cup: null, notes: [], coach: 50, objective: null, offers: [], window: 'start', review: null, last: null,
      stats: newSeasonStats(), career: newSeasonStats(), history: [], trophies: [],
      pick: { round: 0, more: false }, inbox: [], msgN: 0, train: 'bal', tp: { phys: 0, def: 0, atk: 0 }, fatigue: 0, listed: false, squad: [], contract: null, money: 0,
      diff: CDIFF[o.diff] && CDIFF_KEYS.indexOf(o.diff) >= 0 ? o.diff : 'normal', dUse: dZeros() };   // dificultad (sin tiradas de r: misma semilla, misma carrera)
    genSchedule(c);
    // sin club: llegan las ofertas de inicio y eliges tú (acceptOffer). o.autoClub: el de antes (pruebas)
    c.offers = genStartOffers(c, 0);
    msg(c, 'agent', 'Tienes ' + c.offers.length + ' ofertas', 'Soy tu agente. Varios clubes de vóley playa quieren ' + (c.offers.some(function (x) { return x.trial; }) ? 'ficharte o probarte' : 'ficharte') +
      ' para la temporada 1. Compara las fichas (circuito, prestigio, compañero, objetivo, rol y sueldo) y fíjate en el compañero que te ofrecen: un buen compañero es medio partido. Si rechazas todas, llegarán otras de clubes más modestos (y se pierde la prueba, si la hay).');
    cur = c; M = null; lost = false;
    life(c, 'create');
    if (o.autoClub) { var i = 0, best = -1; c.offers.forEach(function (x, j) { if (!x.trial && (best < 0 || x.ovr < best)) { best = x.ovr; i = j; } }); joinClub(c, c.offers[i], c.offers[i].years); }
    save(c);
    return c;
  }

  // ------------------------------------------------------------------ inicio: ofertas y pruebas de clubes
  var ROLE_NEED = [0, 3, 8];   // interés mínimo para cada rol (Rotación / Titular / Titular indiscutible)
  /** Ofertas de inicio (sin club): 3-4 clubes del Circuito Regional (de los modestos; con cada rechazo, de los peores) y en la
   *  primera ronda quizá una prueba en el peor club del Circuito Nacional (te fichan si la superas). */
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
  /** Probabilidad de superar la prueba del Circuito Nacional: con la media inicial ~30 %. */
  function trialChance(c) { return round1(clamp(0.3 + (playerOvr(c) - START_OVR) * 0.04, 0.1, 0.75) * 10) / 10; }
  /** Firma por el club de la oferta o (inicio, mitad o fin de temporada): compañero anunciado, plantilla, contrato, objetivo. */
  function joinClub(c, o, years) {
    var k = club(c, o.club), r = rng(hash(c.seed, 'join', c.season, o.club));
    var rl = Math.max(0, ROLE_LV.indexOf(o.role));
    c.myClub = k.id;
    c.mate = o.mateP && o.mateP.st ? copy(o.mateP) : newMate(c, k, r, o.mate != null ? o.mate : null);
    c.mate.chem = 0; c.mate.form = 0; if (typeof c.mate.style !== 'string') c.mate.style = mateStyle(c.mate, r);
    c.squad = genSquad(c, k, c.mate, r);
    years = clampI(years != null ? years : o.years || 1, 1, 3);
    // since: al fichar a final de temporada el contrato empieza en la siguiente (joinClub va antes de c.season++)
    c.contract = { club: k.id, years: years, left: years, role: ROLE_LV[rl], salary: o.salary || salaryOf(k.lvl, k.q, rl), since: c.season + (c.phase === 'off' ? 1 : 0) };
    // confianza inicial: la del rol firmado, menos si saliste con contrato en vigor (o.early) o si te rechazaron la negociación
    c.coach = clamp(ROLE_COACH[rl] + cd(c).coach0 - (o.early ? EARLY_COACH : 0) - (o.negNo ? NEG_COACH : 0), 0, 100); c.listed = false; c.broken = 0;   // (+ coach0 de la dificultad)
    c.coachD = diffOf(c);   // nivel del coach0 aplicado: setDifficulty lo corrige si cambias antes de jugar (seasonDiff ve el objetivo)
    c.joinWk = c.phase === 'off' ? (c.season + 1) * 1000 : wkKey(c);   // tu primera jornada en el club: no te sientan
    c.offers = []; c.window = '';
    if (c.phase === 'pick') { c.phase = 'league'; c.week = 0; c.pick = null; }
    if (c.phase !== 'off') { c.objective = makeObjective(c); welcome(c); }
  }
  function welcome(c) {
    var k = myClub(c), ct = c.contract;
    var d = mateOvr(c) - clubOvr(k);
    msg(c, 'coach', 'Bienvenido a ' + k.name, 'Aquí empiezas como ' + ct.role.toLowerCase() + ' (' + plural(ct.years, 'temporada', 'temporadas') + '). Tu compañero en la arena será ' + c.mate.name +
      ' (' + c.mate.role.toLowerCase() + ', ' + c.mate.style.toLowerCase() + ', media ' + mateOvr(c) + (d >= 3 ? ', por encima del nivel del club' : d <= -3 ? ', por debajo del nivel del club: tendrás que tirar tú del equipo' : '') + '). Objetivo del club: ' + c.objective.text.toLowerCase() + '. Cuanto más juguéis juntos, mejor os entenderéis.');
  }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  /** «Vida» de la Carrera (js/career-life.js: retos, fama, patrocinios, decisiones, rival, tienda, premios, logros, legado). Sin el
   *  fichero, nada cambia. */
  function life(c, kind, a, b) { var Lf = VB.CareerLife; if (!Lf || !Lf.hook) return; try { Lf.hook(c, kind, a, b); } catch (e) { try { console.error('CareerLife.' + kind, e); } catch (e2) { } } }
  /** Inicio: rechazar todas → nuevas ofertas, peores (de los clubes más flojos de la Regional y sin prueba). */
  function rejectAll() {
    var c = load(); if (!c || c.phase !== 'pick') return false;
    c.pick.round = Math.min(9, c.pick.round + 1); c.pick.more = false;
    c.offers = genStartOffers(c, c.pick.round);
    msg(c, 'agent', 'Nuevas ofertas', 'Has rechazado todas las ofertas. Han llegado ' + c.offers.length + ' más, de clubes más modestos. Si rechazas otra vez seguirán siendo de los más flojos d' + lname(league(0)) + '.');
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
  function newSeasonStats() { return { played: 0, won: 0, sim: 0, bench: 0, pts: 0, kills: 0, aces: 0, blocks: 0, assists: 0, digs: 0, errors: 0 }; }

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
  var DIFF_AT = [[80, 'expert'], [56, 'hard'], [38, 'normal'], [0, 'easy']];   // (Difícil desde 56, antes 52: ver §Escalón)
  // Escalón intermedio «Normal suave» (11-nov-2026, muro Regional → Nacional): la IA Normal con el perfil de principiante de la sim
  // (createGame({rookie}): saque sin salto, remate algo más lento, más error, menos defensa y bloqueo; y la ventana de timing amplia
  // para ti). Antes la Regional era toda Fácil (el bot «medio» de simtest ganaba el 99-100 % fuera cual fuera el compañero) y
  // la Nacional toda Normal (con la prueba superada a media 35, 0 de 8). Ahora: Regional < SOFT[0] Fácil, de SOFT[0] en adelante
  // suave (los 3-4 mejores clubes); Nacional < SOFT[1] suave (los 2-3 peores) y Normal desde ahí. Medido en notes/carrera.md §Escalón.
  var SOFT = { reg: 34, regNormal: 38, nat: 42 };
  function softFor(rival) {
    var o = clubOvr(rival), l = rival.lvl | 0;
    return l === 0 ? o >= SOFT.reg && o < SOFT.regNormal : l === 1 && o < SOFT.nat;
  }
  function difficultyFor(rival) {
    // en el Circuito Regional nunca más que Normal suave (con la IA Normal pura los mejores clubes eran un muro: el bot medio, con
    // tu media 35, ganaba el 10 %; el novato, el 0 %)
    if ((rival.lvl | 0) === 0) return clubOvr(rival) >= SOFT.reg ? 'normal' : 'easy';
    var o = clubOvr(rival);
    for (var i = 0; i < DIFF_AT.length; i++) if (o >= DIFF_AT[i][0]) return DIFF_AT[i][1];
    return 'easy';
  }
  /** Nombre de la IA rival para la UI: «Fácil», «Normal suave», «Normal», «Difícil», «Experto». */
  function diffLabel(rival) {
    var d = difficultyFor(rival), nm = VB.DIFF && VB.DIFF[d] && VB.DIFF[d].name || d;
    return softFor(rival) ? nm + ' suave' : nm;
  }

  // ------------------------------------------------------------------ dificultad de la Carrera (12-nov-2026; notes/carrera.md §Dificultad)
  // c.diff elige el nivel; CDIFF reúne TODAS las palancas. Con CDIFF.normal cada fórmula da exactamente lo de siempre (multiplicadores
  // 1, desvíos 0, mismos umbrales): NO tocar sus valores. difficultyFor / softFor / diffLabel siguen siendo la base Normal.
  var CDIFF_KEYS = ['easy', 'normal', 'hard', 'expert'];
  // Escalera de la IA rival: los 4 perfiles de la sim + «Normal suave» (Normal con rookie)
  var STEPS = [{ d: 'easy', soft: false }, { d: 'normal', soft: true }, { d: 'normal', soft: false }, { d: 'hard', soft: false }, { d: 'expert', soft: false }];
  //   shift      peldaños que se mueve la IA rival sobre el peldaño base del club     regEasy  Regional toda en Fácil puro
  //   noSoft     si cae en «Normal suave», sube a Normal                               gate     media mínima para SUBIR a ese perfil por desplazamiento
  //   attr       suma a la media del rival en tus partidos                             xp/train × experiencia de tus partidos / × progreso del entreno
  //   coachPivot nota desde la que el entrenador gana confianza (6,2)                  objWin/objLose confianza al cumplir / no cumplir el objetivo
  //   coach0     suma a la confianza inicial al fichar                                 objE     suma a la posición esperada (objetivo: + más blando)
  //   offer      suma al umbral de interés de las ofertas (+ = menos)                  midNota  suma a la nota mínima de las ofertas de mitad de temporada
  //   simAttr    suma a la media del rival al SIMULAR tus partidos y en el banquillo (en vez de attr: el simulado no ve la IA)
  //   topX       false: en el circuito más alto nadie sube a la IA Experto por desplazamiento (solo los clubes que ya lo son)
  //   attrTop    attr en el circuito más alto (si falta, attr): con attr entero, la élite Experto no se ganaba ni jugando muy bien
  //   shiftTop   shift en el circuito más alto (si falta, shift). Fácil −2: con −1 la élite del Mundial jugaba Difícil y el bot medio con
  //              media 85 no ganaba nada; con −2 (élite Normal, resto Normal suave) gana el Circuito 16 de 28 temporadas (calibrado, 12-nov)
  var CDIFF = {
    easy: { name: 'Fácil', hint: 'Rivales más flojos, más experiencia y un club con paciencia',
      shift: -1, shiftTop: -2, regEasy: true, noSoft: false, gate: {}, attr: -3, simAttr: 0, topX: true, xp: 1.25, train: 1.15,
      coachPivot: 5.8, objWin: 15, objLose: -10, coach0: 5, objE: 1, offer: -2, midNota: -0.3 },
    normal: { name: 'Normal', hint: 'La Carrera tal como está pensada',
      shift: 0, regEasy: false, noSoft: false, gate: {}, attr: 0, simAttr: 0, topX: true, xp: 1, train: 1,
      coachPivot: 6.2, objWin: 15, objLose: -15, coach0: 0, objE: 0, offer: 0, midNota: 0 },
    hard: { name: 'Difícil', hint: 'Rivales un escalón por encima y un club más exigente',
      shift: 1, regEasy: false, noSoft: true, gate: { hard: 46, expert: 76 }, attr: 3, attrTop: 1, simAttr: 3, topX: false, xp: 0.9, train: 0.9,
      coachPivot: 6.3, objWin: 15, objLose: -18, coach0: -3, objE: -1, offer: 2, midNota: 0 },
    expert: { name: 'Experto', hint: 'Para quien domina el juego: cada punto cuesta',
      shift: 2, regEasy: false, noSoft: true, gate: { hard: 38, expert: 66 }, attr: 4, attrTop: 2, simAttr: 4, topX: false, xp: 0.75, train: 0.85,
      coachPivot: 6.5, objWin: 12, objLose: -20, coach0: -6, objE: -2, offer: 4, midNota: 0 }
  };
  var DIFF_MSG = {
    easy: 'Desde el próximo partido juegas en Fácil: rivales más flojos, más experiencia y un club con más paciencia.',
    normal: 'Desde el próximo partido juegas en Normal: la Carrera tal como está pensada.',
    hard: 'Desde el próximo partido juegas en Difícil: rivales un escalón por encima, algo menos de experiencia y un club que exige más.',
    expert: 'Desde el próximo partido juegas en Experto: rivales dos escalones por encima, menos experiencia y un club que no perdona.'
  };
  function dZeros() { return { easy: 0, normal: 0, hard: 0, expert: 0 }; }
  /** Nivel más fácil con partidos en un dUse (null si ninguno). */
  function lowUse(u) { u = u || {}; for (var i = 0; i < CDIFF_KEYS.length; i++) if ((u[CDIFF_KEYS[i]] | 0) > 0) return CDIFF_KEYS[i]; return null; }
  /** Clave de dificultad de la carrera c (o la cargada); 'normal' si falta. */
  function diffOf(c) { c = c || load(); return c && CDIFF_KEYS.indexOf(c.diff) >= 0 ? c.diff : 'normal'; }
  /** Parámetros del nivel de la carrera c. */
  function cd(c) { return CDIFF[diffOf(c)]; }
  /** Desvío de la media del rival en tus partidos jugados: attr (attrTop en el circuito más alto, si el nivel lo fija). */
  function attrOf(c, rival) { var D = cd(c); return D.attrTop != null && (rival.lvl | 0) === LEAGUES.length - 1 ? D.attrTop : D.attr; }
  /** Peldaño base (Normal) de un club: 0 Fácil, 1 Normal suave, 2 Normal, 3 Difícil, 4 Experto (= difficultyFor + softFor). La
   *  única pieza que depende de la rama (en la de pista envuelve su difficultyFor / softFor). */
  function baseStep(rival) {
    var d = difficultyFor(rival);
    return d === 'expert' ? 4 : d === 'hard' ? 3 : d === 'normal' ? (softFor(rival) ? 1 : 2) : 0;
  }
  /** IA rival efectiva en la dificultad de la carrera c. Normal: la de siempre (difficultyFor, softFor, diffLabel). */
  function rivalAI(c, rival) {
    var D = cd(c), b = baseStep(rival), s, top = (rival.lvl | 0) === LEAGUES.length - 1;
    if (D.regEasy && (rival.lvl | 0) === 0) s = 0;
    else {
      s = clamp(b + (top && D.shiftTop != null ? D.shiftTop : D.shift), 0, STEPS.length - 1);
      if (D.noSoft && s === 1) s = 2;
      // subir a un perfil POR DESPLAZAMIENTO exige la media del club (gate); si no llega, un peldaño menos (nunca bajo la base)
      // (topX false: en el circuito más alto el desplazamiento no llega a Experto; con 4 u 8 clubes Experto el título no se gana)
      while (s > b) { var g = D.gate[STEPS[s].d]; if (STEPS[s].d === 'expert' && top && D.topX === false) { s--; continue; } if (g == null || STEPS[s].soft || clubOvr(rival) >= g) break; s--; }
      if (D.noSoft && s === 1) s = 2;
    }
    var st = STEPS[s], nm = (VB.DIFF && VB.DIFF[st.d] && VB.DIFF[st.d].name) || st.d;
    return { step: s, base: b, diff: st.d, soft: st.soft, name: st.soft ? nm + ' suave' : nm };
  }
  /** Dificultad de la temporada en curso para el historial y el palmarés: la más fácil entre las de tus partidos (jugados,
   *  simulados y banquillos) y la del objetivo del club (objective.d: con ella se fijaron objetivo y confianza inicial), o la actual
   *  si no hay nada, y si ha sido mixta. Así un título no se «blanquea» jugando la final en Experto ni fichando en Fácil. */
  function seasonDiff(c) {
    c = c || load(); var u = c && c.dUse || {}, d = null, n = 0;
    var od = c && c.objective && typeof c.objective === 'object' && CDIFF_KEYS.indexOf(c.objective.d) >= 0 ? c.objective.d : null;
    CDIFF_KEYS.forEach(function (k) { if ((u[k] | 0) > 0 || k === od) { n++; if (!d) d = k; } });
    return { d: d || diffOf(c), dm: n > 1 };
  }
  /** Nota media mínima para recibir ofertas a mitad de temporada (6,5 si eres transferible o te incumplieron la promesa). */
  function midNota(c) { c = c || load(); return round1((c && (c.listed || c.broken === c.season) ? 6.5 : 7) + cd(c).midNota); }
  /** Cambia la dificultad de la Carrera (entre partidos; en cualquier fase). Se aplica desde el siguiente cálculo que la use: IA,
   *  atributos, experiencia, entreno, entrenador y ofertas ya. Si aún no hay partidos tuyos esta temporada (liga, jornada 1),
   *  también el objetivo y la confianza inicial del fichaje (coachD); si ya los hay, el objetivo cambia la temporada que viene. */
  function setDifficulty(k) {
    var c = load(); if (!c) return '';
    if (CDIFF_KEYS.indexOf(k) < 0) return 'bad';
    if (M) return 'match';   // partido de Carrera a medias (main.js llama a abortMatch al salir)
    if (diffOf(c) === k) return 'same';
    var low = seasonDiff(c), used = CDIFF_KEYS.reduce(function (s, x) { return s + ((c.dUse && c.dUse[x]) | 0); }, 0), live = c.phase === 'league' || c.phase === 'cup';
    c.diff = k;
    var x = DIFF_MSG[k];
    if (myClub(c) && c.phase === 'league' && used === 0) {
      // aún sin partidos esta temporada: objetivo y confianza inicial se rehacen con el nivel nuevo (cambiar solo para fijarlos, en
      // verano o al fichar, y volver antes de jugar no deja nada a favor)
      var ob = c.objective && c.objective.text; c.objective = makeObjective(c);
      if (CDIFF[c.coachD]) { c.coach = clamp(c.coach + CDIFF[k].coach0 - CDIFF[c.coachD].coach0, 0, 100); c.coachD = k; }
      x += ' Aún no has jugado esta temporada: ' + (ob !== c.objective.text ? 'el objetivo del club pasa a ser ' + c.objective.text.toLowerCase() + '.' : 'el objetivo del club se mantiene.');
    } else if (myClub(c) && live) x += ' El objetivo del club no cambia hasta la temporada que viene.';
    // (solo con la temporada en juego: en verano la temporada ya está sellada y la siguiente empieza de cero)
    if (live && used > 0 && CDIFF_KEYS.indexOf(low.d) < CDIFF_KEYS.indexOf(k))
      x += ((c.dUse && c.dUse[low.d]) | 0) > 0 ? ' Esta temporada ya has jugado en ' + CDIFF[low.d].name + ': sus títulos contarán como ' + CDIFF[low.d].name + '.'
        : ' El objetivo de esta temporada se fijó en ' + CDIFF[low.d].name + ': sus títulos contarán como ' + CDIFF[low.d].name + '.';
    msg(c, 'club', 'Dificultad: ' + CDIFF[k].name, x);
    save(c); return 'ok';
  }
  function next(c) {
    c = c || load(); if (!c) return null;
    var f = myFixture(c); if (!f) return null;
    var me = myClub(c), riv = club(c, f.home === me.id ? f.away : f.home), L = league(me.lvl);
    var label = f.kind === 'league' ? L.name + ' · Jornada ' + (f.week + 1) + ' de ' + WEEKS
      : L.cup + ' · ' + (f.round === 0 ? 'Semifinal' : 'Final');
    // dificultad: IA rival efectiva (rivalAI) y media efectiva del rival (ovrRival = la del club + attr; ovrClub = la real)
    var ai = rivalAI(c, riv);
    return { kind: f.kind, week: f.week, round: f.round, i: f.i, label: label, home: club(c, f.home), away: club(c, f.away), me: me, rival: riv,
      atHome: f.home === me.id, ovrMe: Math.round(teamOvr(c)), ovrRival: clubOvr(riv) + attrOf(c, riv), ovrClub: clubOvr(riv), ovrSim: clubOvr(riv) + cd(c).simAttr, diff: ai.diff, soft: ai.soft, diffName: ai.name,
      cdiff: diffOf(c), bench: f.kind === 'league' && benchFor(c, f) };
  }

  /** Opciones del partido de Carrera para Sim.createGame (+ kit para Players.setKit y datos para la UI). */
  function matchSetup(c) {
    c = c || load(); var n = next(c); if (!n || n.bench) return null;   // en el banquillo no hay partido que jugar (benchNext)
    var r = rng(hash(c.seed, 'riv', c.season, c.phase, n.week, n.round, n.rival.id)), ro = n.ovrRival;
    var rivA = genSt(clamp(ro + 1, 1, 99), 'atk', r), rivB = genSt(clamp(ro - 1, 1, 99), 'cr', r);
    var bd = B() && B().forPlayer ? B().forPlayer(c.player) : null;
    if (bd && !Object.keys(bd).length) bd = null;
    var k = n.me.kit;
    // fatiga (resta a tus atributos), química (suma a los dos en reacción, colocación y recepción) y forma del compañero (suma o
    // resta en todo lo suyo): solo en este partido
    var stMe = copy(c.player.st), stMate = copy(c.mate.st), fm = fatigueMalus(c), ch = chemBonus(c), mf = clampI(c.mate.form | 0, -FORM_MAX, FORM_MAX);
    // techo del compañero: con su desvío (hasta +5) y la racha, nunca más de MATE_CAP sobre el club en el partido (la racha se
    // recorta; la química es de los dos y no cuenta). Puede ser mejor que el club, pero no llevarte en volandas
    mf = mateFormCap(c, n.me, mf);
    KEYS.forEach(function (key) { stMe[key] = clampI(stMe[key] - fm + (CHEM_KEYS.indexOf(key) >= 0 ? ch : 0), 1, 99); stMate[key] = clampI(stMate[key] + mf + (CHEM_KEYS.indexOf(key) >= 0 ? ch : 0), 1, 99); });
    var out = {
      attrs: [[stMe, stMate], [rivA, rivB]],
      badges: bd ? [[bd, null], null] : null,
      points: PTS, venue: VENUE, difficulty: n.diff, ctrl: 'one', ctrlIdx: 0,   // vóley playa (sets a 21, el 3r a 15); en la Carrera solo tu jugador
      rookie: !!n.soft, diffName: n.diffName,   // «Normal suave» = Normal + perfil de principiante (main.js lo pasa a createGame({rookie}))
      cdiff: n.cdiff,   // dificultad de la Carrera (la IA y los atributos de arriba ya la llevan)
      chem: ch, fatigue: fm, mateForm: mf,
      ref: copy(REF[league(n.me.lvl).ref]),
      kit: { kitShirt: k.shirt, kitAccent: k.accent, kitShorts: k.shorts, kitPattern: k.pattern },
      rivalKit: { kitShirt: n.rival.kit.shirt, kitAccent: n.rival.kit.accent, kitShorts: n.rival.kit.shorts, kitPattern: n.rival.kit.pattern },
      career: { season: c.season, phase: c.phase, week: n.week, round: n.round, label: n.label, me: n.me.short, rival: n.rival.short, venue: VENUE,
        meName: n.me.name, rivalName: n.rival.name, player: c.player.name, num: c.player.num, mate: c.mate.name, mateNum: c.mate.num, cdiff: n.cdiff }
    };
    life(c, 'setup', out);   // material de la tienda, molestias y reto de la jornada (career-life.js)
    return out;
  }

  // ------------------------------------------------------------------ estadísticas del partido jugado
  var M = null;
  function newM(g) {
    var z = function () { return { kills: 0, aces: 0, blocks: 0, assists: 0, digs: 0, errors: 0, recvP: 0, perfect: 0, good: 0, poor: 0, serves: 0 }; };
    return { g: g, p: [z(), z()], last0: -1, lastTeam: -1, server: -1, setter: -1, cand: -1, blocker: -1, prevKind: '', prevTeam: -1, rallies: 0 };
  }
  function slotOf(g, pl) {
    if (!pl || !g || !g.teams) return -1;
    if (g.size === 6) return pl === g.ctrl ? 0 : pl.team === 0 ? 1 : -1;   // pista (6v6): 0 = tu jugador, 1 = el resto de tu equipo
    var t = g.teams[0]; return t[0] === pl ? 0 : t[1] === pl ? 1 : -1;
  }
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
  function rating(me, r, rallies, kmul) {
    me = me || {};
    // kmul (pista, 6v6): en el 6v6 tu jugador toca muchos menos balones que en la pareja; la parte de estadísticas se escala por
    // puesto (RATE6). En la playa no se pasa (× 1, la nota de siempre)
    var k = 40 / Math.max(24, rallies || 40) * (kmul || 1);   // por cada 40 puntos jugados (partidos a 11 y a 25 comparables)
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
            var q = quickSim(clubOvr(a) + (r() - 0.5) * 4, clubOvr(b) + (r() - 0.5) * 4, r, PTS);
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
          var q2 = quickSim(clubOvr(ca) + (r2() - 0.5) * 4, clubOvr(cb) + (r2() - 0.5) * 4, r2, PTS);
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
    var win = res.sets[0] > res.sets[1], L = league(myClub(c).lvl), rival = club(c, f.home === c.myClub ? f.away : f.home), D = cd(c), dk = diffOf(c);
    // dificultad: el partido cuenta en su nivel (antes de finishRound, que puede cerrar la temporada)
    if (!c.dUse || typeof c.dUse !== 'object') c.dUse = dZeros();
    c.dUse[dk] = (c.dUse[dk] | 0) + 1;
    var nota = me.nota;
    var mpts = (me.kills || 0) + (me.aces || 0) + (me.blocks || 0);
    // tus puntos cuentan hasta 10 por partido (con control «uno» rematas casi todo y la XP jugada se disparaba)
    var xp = Math.round((40 + 22 * nota + (win ? 40 : 0) + 6 * Math.min(mpts, 10)) * L.xp * (sim ? 0.5 : 1) * D.xp);   // (× xp de la dificultad)
    var lv = addXP(c.player, xp);
    // entrenador
    var ct0 = coachText(c.coach);
    c.coach = clamp(Math.round(c.coach + (nota - D.coachPivot) * 2.5 + (win ? 1 : -1)), 0, 100);   // (pivote de la dificultad; Normal 6,2)
    coachFloor(c);   // titular indiscutible: la confianza no baja de ROLE_FLOOR
    pay(c); promoteCheck(c);   // sueldo de la jornada; de la rotación a titular con PROMOTE_AT
    if (coachText(c.coach) !== ct0) msg(c, 'coach', 'El entrenador: «' + coachText(c.coach) + '»', COACH_LINE[coachText(c.coach)] || '');
    // gestión: química con el compañero (jugando juntos; simulado cuenta menos), su forma y la semana de entrenamiento
    if (c.mate) c.mate.chem = clamp((c.mate.chem | 0) + (sim ? 3 : 5), 0, 100);
    var mf0 = c.mate ? c.mate.form | 0 : 0, mf = mateFormStep(c);
    var tr = trainWeek(c);
    // temporada
    var S = c.stats, T = c.career;
    [S, T].forEach(function (x) {
      x.played++; if (win) x.won++; if (sim) x.sim++;
      x.pts += mpts; x.kills += me.kills || 0; x.aces += me.aces || 0; x.blocks += me.blocks || 0; x.assists += me.assists || 0; x.digs += me.digs || 0; x.errors += me.errors || 0;
    });
    c.notes.push({ nota: nota, win: win ? 1 : 0, sim: sim ? 1 : 0, kind: f.kind, wk: f.kind === 'league' ? f.week : f.round, rival: rival.id, s: res.sets.slice() });
    var badges = extra && extra.badges || [];
    var label = f.kind === 'league' ? 'Jornada ' + (f.week + 1) : (f.round === 0 ? 'Semifinal del Open' : 'Final del Open');
    var phase0 = c.phase, season0 = c.season;
    recordMine(c, f, res.sets, res.setScores);
    var round = finishRound(c);
    var sum = { season: season0, phase: phase0, label: label, rival: rival.id, rivalName: rival.name, win: win, sets: res.sets.slice(), setScores: res.setScores.map(function (x) { return x.slice(); }),
      sim: !!sim, nota: nota, me: me, xp: xp, lvlUp: lv.lvlUp, lvl: lv.lvl, ptsGained: lv.pts, badges: badges, coach: c.coach, train: tr, chem: c.mate ? c.mate.chem : 0, mateForm: mf, mateForm0: mf0,
      round: round.map(function (m) { return { a: m.a, b: m.b, s: m.s }; }), offers: c.window === 'mid' ? c.offers.length : 0, review: phase0 !== c.phase && c.phase === 'off' };
    life(c, 'match', sum, f);
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
    if (next(c).bench) return benchNext(c);   // en el banquillo: la jornada se juega sin ti
    var n = next(c), r = rng(hash(c.seed, 'mine', c.season, c.phase, f.week, f.round, c.notes.length));
    // (dificultad: el simulado usa ovrSim = club + simAttr; no ve la IA, así que en Fácil no se le regala el attr del jugado)
    var q = quickSim(teamOvr(c) + (r() - 0.5) * 4, n.ovrSim + (r() - 0.5) * 4, r, PTS), win = q.sets[0] > q.sets[1];
    var d = teamOvr(c) - n.ovrSim, sh = 0.5 + 0.5 * clamp((playerOvr(c) - mateOvr(c)) / 30 + 0.5, 0.2, 0.8);
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
    return playerOvr(c) + (an == null ? 0 : (an - 6) * 6) + (c.coach - 50) / 10 + 0.5 * badgePower(c.player) + (c.listed ? LISTED_BONUS : 0) + (c.broken === c.season ? BROKEN_BONUS : 0) +
      (VB.CareerLife && VB.CareerLife.offerBonus ? VB.CareerLife.offerBonus(c) + (c.life && c.life.scout === c.season ? 2 : 0) : 0);   // fama, agente estrella y ojeador
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
    // (dificultad: midNota(c) suma su desvío; el umbral de interés, D.offer)
    var D = cd(c);
    if (mid && an < midNota(c)) return [];
    // al final de la temporada las ofertas se miden con la liga y el nivel (q) de la temporada SIGUIENTE (antes un club que
    // descendía ofrecía «Liga Nacional» y fichabas por él en la Regional, y la media anunciada no era la real)
    var pq = !mid && c.pendingQ ? c.pendingQ : null;
    var lv = function (k) { return mid ? k.lvl : nextLvl(c, k); }, qOf = function (k) { return pq && pq[k.id] != null ? pq[k.id] : k.q; }, myL = lv(me);
    c.clubs.forEach(function (k) {
      var kl = lv(k), L = league(kl), q = qOf(k);
      if (k.id === me.id || kl < myL || kl > myL + 1) return;
      if (kl === myL && q <= qOf(me) + 0.05) return;   // solo clubes mejores que el tuyo
      if (mid && kl > myL && an < 7.5 + D.midNota) return;   // a mitad de temporada, saltar de liga exige notas aún más altas
      var o = L.ovr[0] + (L.ovr[1] - L.ovr[0]) * q, thr = o - 5 + (kl > myL ? 2 : 0) + D.offer;
      var it = sc - thr + (r() - 0.5) * 8 - (mid ? 3 : 0);
      if (it > 0) { var rl = it > ROLE_NEED[2] ? 2 : it > ROLE_NEED[1] ? 1 : 0;
        cand.push({ club: k.id, lvl: kl, ovr: Math.round(o), q: q, interest: round1(it), mate: Math.round(o),
          role: ROLE_LV[rl], years: 1 + Math.floor(r() * 3), salary: salaryOf(kl, q, rl) }); }
    });
    // las 3 mejores, con preferencia por los clubes de la liga de arriba; se muestran de mejor a peor club
    cand.sort(function (a, b) { return (b.interest + 4 * (b.lvl - myL)) - (a.interest + 4 * (a.lvl - myL)); });
    cand = cand.slice(0, 3);
    // ficha completa: el compañero que tendrías (el mismo que te dan al firmar; media = la del club de la temporada que viene +
    // su desvío propio, mateOff) y el objetivo aproximado. Un club con buen compañero es un argumento para fichar
    cand.forEach(function (x) { var rm = rng(hash(c.seed, 'offmate', c.season, mid ? 'mid' : 'end', x.club)), mt = newMate(c, club(c, x.club), rm, clamp(x.ovr + mateOff(rm), 22, 92)); x.mateP = mt; x.mate = ovrOf(mt.st); });
    cand.sort(function (a, b) { return b.lvl - a.lvl || b.ovr - a.ovr; });
    return cand;
  }
  function midWindow(c) {
    var o = genOffers(c, true);
    c.offers = o; c.window = o.length ? 'mid' : '';
    if (o.length) msg(c, 'offer', 'Ventana de fichajes: ' + plural(o.length, 'oferta', 'ofertas'), 'Tu agente ha recibido ' + plural(o.length, 'oferta', 'ofertas') + ' a mitad de temporada. Caducan al jugar o simular el siguiente partido. Míralas en Club › Ofertas.');
    // el entrenador repasa el objetivo a mitad de temporada
    var pos = posOf(c, c.myClub), okp = pos <= c.objective.pos;
    msg(c, 'obj', 'Mitad de temporada: ' + ordn(pos), okp ? 'Vamos ' + ordn(pos) + ' y el objetivo (' + c.objective.text.toLowerCase() + ') está a nuestro alcance. No bajemos el ritmo.'
      : 'Vamos ' + ordn(pos) + ' y así no llegamos al objetivo (' + c.objective.text.toLowerCase() + '). Necesito más de ti en la segunda vuelta.');
  }

  // ------------------------------------------------------------------ fin de temporada
  function endSeason(c) {
    var me = myClub(c), lvl = me.lvl, t = table(c, lvl), pos = posOf(c, me.id), L = league(lvl);
    var objOk = pos <= c.objective.pos;
    var D = cd(c), sd = seasonDiff(c);   // dificultad: premio/castigo del objetivo y sello de la temporada (la más fácil usada)
    c.coach = clamp(c.coach + (objOk ? D.objWin : D.objLose), 0, 100); coachFloor(c);
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
    if (champ === me.id) c.trophies.push({ season: c.season, kind: 'liga', name: L.name, club: me.name, d: sd.d });
    if (cupWin) c.trophies.push({ season: c.season, kind: 'copa', name: L.cup, club: me.name, d: sd.d });
    if (myMove > 0) c.trophies.push({ season: c.season, kind: 'ascenso', name: 'Ascenso ' + toL(league(lvl + 1)), club: me.name, d: sd.d });
    var an = avgNota(c);
    c.history.push({ season: c.season, club: me.id, clubName: me.name, lvl: lvl, pos: pos, pts: t[pos - 1].pts, objective: c.objective.text, objOk: objOk,
      cup: cupWin ? 'Campeón' : cupFinal ? 'Final' : cupSemi ? 'Semifinal' : '—', nota: an, played: c.stats.played, won: c.stats.won, ppts: c.stats.pts, move: myMove,
      ovr: playerOvr(c), lvlP: c.player.lvl, d: sd.d, dm: sd.dm });
    c.review = { season: c.season, pos: pos, lvl: lvl, objective: c.objective.text, objOk: objOk, champion: champ === me.id, cup: cupWin, move: myMove, nota: an,
      coach: c.coach, moves: moves, d: sd.d, dm: sd.dm };
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
    msg(c, 'club', 'Fin de la temporada ' + c.season + ': ' + ordn(pos), 'Objetivo ' + (objOk ? 'cumplido' : 'no cumplido') + ' (' + c.objective.text.toLowerCase() + ').' +
      (myMove > 0 ? ' ¡El club asciende!' : myMove < 0 ? ' El club desciende.' : '') + ' ' + (c.offers.length ? 'Tienes ' + plural(c.offers.length, 'oferta', 'ofertas') + ' de otros clubes.' : 'No han llegado ofertas de otros clubes.') +
      (c.review.renew ? ' Se te acaba el contrato: el club te ofrece renovar como ' + c.review.renew.role.toLowerCase() + '.' : ''));
    life(c, 'season');
    c.trophies.forEach(function (t) { if (t && t.season === c.season && !t.d) t.d = sd.d; });   // premios de career-life: su sello
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
      // el club renueva tu compañero si se ha quedado muy por debajo de su nivel (MATE_RENEW; el nuevo tiene su propio desvío)
      var k = myClub(c);
      delete c.coachD;   // la confianza viene de la temporada pasada: cambiar de nivel ya no la corrige
      if (mateOvr(c) <= clubOvr(k) - MATE_RENEW) { c.mate = newMate(c, k, r); msg(c, 'club', 'Nuevo compañero', 'El club ha fichado a ' + c.mate.name + ' (' + c.mate.role.toLowerCase() + ', media ' + mateOvr(c) + ') para jugar contigo. Tendréis que haceros el uno al otro.'); }
      else if (c.mate) c.mate.form = 0;   // verano: la forma se reinicia
      c.squad = genSquad(c, k, c.mate, rng(hash(c.seed, 'squad', c.season + 1, k.id)));   // la plantilla cambia cada verano
      var ct = c.contract || { club: k.id, years: 1, left: 1, role: ROLE_LV[1], salary: salaryOf(k.lvl, k.q, 1), since: c.season };
      ct.left = Math.max(0, (ct.left | 0) - 1);
      if (ct.left <= 0) {   // renovación (stay(años)): rol y sueldo de la propuesta del club
        var y = clampI(years != null ? years : renew ? renew.years : 1, 1, 3);
        c.contract = { club: k.id, years: y, left: y, role: renew ? renew.role : ct.role, salary: renew ? renew.salary : ct.salary, since: c.season + 1 };
        msg(c, 'club', 'Contrato renovado', 'Has renovado con ' + k.name + ' por ' + plural(y, 'temporada', 'temporadas') + ' como ' + c.contract.role.toLowerCase() + '.');
      } else c.contract = ct;
    }
    c.season++; c.week = 0; c.phase = 'league'; c.cup = null; c.notes = []; c.stats = newSeasonStats(); c.offers = []; c.window = ''; c.review = null; c.dUse = dZeros();
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
    life(c, 'newSeason');
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
          msg(c, 'agent', 'Prueba no superada', club(c, o.club).name + ' te ha visto en la prueba y prefiere esperar. Aún tienes ' + plural(c.offers.length, 'oferta', 'ofertas') + ' d' + lname(league(0)) + '.');
          if (!c.offers.length) c.offers = genStartOffers(c, ++c.pick.round);
          save(c); return false;
        }
        msg(c, 'agent', '¡Prueba superada!', club(c, o.club).name + ' te ficha tras la prueba. Empiezas en ' + lname(league(o.lvl)) + ', una categoría por encima.');
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
    if (!c || c.phase === 'pick' || c.listed || !c.contract || c.broken === c.season) return false;   // (promesa incumplida: te vas sin pegas)
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

  // ------------------------------------------------------------------ rol prometido y sueldo (11-nov-2026)
  // Antes el rol solo fijaba la confianza inicial y el sueldo era texto. Ahora:
  //   - Rotación: si el entrenador te tiene por debajo de BENCH[0].coach, alguna jornada de liga te sienta (BENCH[0].p; nunca dos
  //     seguidas ni la primera en el club) y la juega tu pareja con uno de la plantilla. Con PROMOTE_AT de confianza pasas a titular
  //     (y cobras como tal).
  //   - Titular: solo te sienta si está descontento (< BENCH[1].coach). Si lo hace, INCUMPLE la promesa: en lo que queda de temporada
  //     puedes irte sin pegas (earlyExit no cuenta el contrato), los clubes lo saben (+BROKEN_BONUS de interés) y a mitad de temporada
  //     basta una nota media de 6,5 para recibir ofertas.
  //   - Titular indiscutible: juegas siempre y la confianza no baja de ROLE_FLOOR[2].
  //   - Sueldo: se cobra cada jornada tuya (PAY_WEEK del mensual: 7 sueldos por temporada) y se acumula en c.money. Sirve para el
  //     fisioterapeuta (physio(): −PHYSIO_FAT de fatiga, una vez por jornada, cuesta physioCost según el circuito).
  var BENCH = [{ coach: 60, p: 0.35 }, { coach: 30, p: 0.5 }, null], PROMOTE_AT = 70, ROLE_FLOOR = [0, 0, 35], BROKEN_BONUS = 3, BENCH_REST = 15;
  var PAY_WEEK = 0.5, PHYSIO_FAT = 30;
  var ROLE_HINT = [
    'Juegas cuando el entrenador confía en ti: por debajo de ' + BENCH[0].coach + ' de confianza te sienta alguna jornada. Con ' + PROMOTE_AT + ' pasas a titular.',
    'Juegas siempre, salvo que el entrenador esté descontento (menos de ' + BENCH[1].coach + '). Si te sienta, incumple la promesa y puedes irte sin pegas.',
    'Juegas siempre y la confianza del entrenador nunca baja de ' + ROLE_FLOOR[2] + '.'
  ];
  function roleIdx(c) { return c && c.contract ? Math.max(0, ROLE_LV.indexOf(c.contract.role)) : 1; }
  function wkKey(c) { return (c.season | 0) * 1000 + (c.phase === 'cup' ? 500 + (c.cup ? c.cup.round | 0 : 0) : c.week | 0); }
  /** ¿Te sienta el entrenador en la jornada f? (solo liga; determinista por temporada y jornada) */
  function benchFor(c, f) {
    if (!c || !c.contract || c.phase !== 'league' || !f || f.kind !== 'league') return false;
    var b = BENCH[roleIdx(c)]; if (!b || c.coach >= b.coach) return false;
    var k = wkKey(c);
    if (c.benchWk === k - 1 || c.joinWk === k) return false;   // nunca dos seguidas ni en tu primera jornada en el club
    return rng(hash(c.seed, 'bench', c.season, c.week, c.myClub))() < b.p;
  }
  function benchWhy(c) {
    var rl = roleIdx(c);
    return rl === 0 ? 'Firmaste para la rotación y aún no se fía del todo de ti (confianza ' + c.coach + ' de ' + BENCH[0].coach + ').'
      : 'Está descontento contigo (confianza ' + c.coach + '). Te prometió ser titular: si te sienta, incumple el contrato.';
  }
  function pay(c) { if (c.contract && c.contract.salary) c.money = Math.round((+c.money || 0) + c.contract.salary * PAY_WEEK); }
  /** La jornada en la que el entrenador te sienta: la juega tu pareja con el mejor de la plantilla (simulada). Sin nota ni
   *  experiencia; descansas (−BENCH_REST de fatiga), entrenas y cobras. Si eras titular, promesa incumplida (c.broken). */
  function benchNext(c) {
    c = c || load(); if (!c) return null;
    var f = myFixture(c), n = f && next(c); if (!n || !n.bench) return null;
    var r = rng(hash(c.seed, 'bench-m', c.season, f.week)), me = myClub(c);
    var alt = (c.squad || []).slice().sort(function (a, b) { return ovrOf(b.st) - ovrOf(a.st); })[0];
    var oa = 0.5 * mateOvr(c) + 0.5 * (alt ? ovrOf(alt.st) : clubOvr(me)) + FORM_SIM * mateFormCap(c, me, c.mate.form | 0);
    var q = quickSim(oa + (r() - 0.5) * 4, n.ovrSim + (r() - 0.5) * 4, r, PTS), win = q.sets[0] > q.sets[1];
    var rl = roleIdx(c), why = benchWhy(c), first = !(c.stats.bench | 0);
    c.benchWk = wkKey(c);
    // dificultad: la jornada sin ti también cuenta en su nivel (la media del rival y el entreno dependen de él; antes de finishRound)
    if (!c.dUse || typeof c.dUse !== 'object') c.dUse = dZeros();
    c.dUse[diffOf(c)] = (c.dUse[diffOf(c)] | 0) + 1;
    pay(c);
    var mf0 = c.mate.form | 0, mf = mateFormStep(c), tr = trainWeek(c);
    c.fatigue = clamp((c.fatigue | 0) - BENCH_REST, 0, 100);
    c.stats.bench = (c.stats.bench | 0) + 1; c.career.bench = (c.career.bench | 0) + 1;
    if (rl === 1 && c.broken !== c.season) {
      c.broken = c.season;
      msg(c, 'agent', 'Promesa incumplida', me.name + ' te fichó como titular y te ha dejado en el banquillo. Hasta final de temporada puedes irte sin pegas aunque tengas contrato, y los clubes lo saben: llegarán más ofertas (a mitad de temporada basta con una nota media de 6,5).');
    } else if (first) msg(c, 'coach', 'Esta jornada, al banquillo', why + ' Juega ' + c.mate.name + (alt ? ' con ' + alt.name : '') + '. Sube tus notas y volverás a jugar.');
    var rival = club(c, f.home === me.id ? f.away : f.home), phase0 = c.phase, season0 = c.season, label = 'Jornada ' + (f.week + 1);
    recordMine(c, f, q.sets, q.setScores);
    var round = finishRound(c);
    var sum = { season: season0, phase: phase0, label: label, rival: rival.id, rivalName: rival.name, win: win, sets: q.sets.slice(), setScores: q.setScores.map(function (x) { return x.slice(); }),
      sim: true, bench: true, why: why, sub: alt ? alt.name : '', nota: null, me: { kills: 0, aces: 0, blocks: 0, assists: 0, digs: 0, errors: 0 }, xp: 0, lvlUp: 0, lvl: c.player.lvl, ptsGained: 0, badges: [],
      coach: c.coach, train: tr, chem: c.mate.chem | 0, mateForm: mf, mateForm0: mf0, round: round.map(function (m) { return { a: m.a, b: m.b, s: m.s }; }),
      offers: c.window === 'mid' ? c.offers.length : 0, review: phase0 !== c.phase && c.phase === 'off' };
    life(c, 'match', sum, f);
    c.last = sum;
    save(c);
    return sum;
  }
  function physioCost(c) { var k = c && myClub(c); return Math.round(SALARY[k ? k.lvl : 0] * 0.6 / 50) * 50; }
  /** Fisioterapeuta (lo pagas tú con lo ahorrado): −PHYSIO_FAT de fatiga, una vez por jornada. 'ok' | 'done' | 'none' | 'money' | ''. */
  function physio() {
    var c = load(); if (!c || c.phase === 'pick' || c.phase === 'off' || !c.contract) return '';
    if (c.physioWk === wkKey(c)) return 'done';
    if ((c.fatigue | 0) <= 0) return 'none';
    var cost = physioCost(c); if ((+c.money || 0) < cost) return 'money';
    c.money = Math.round(c.money - cost); c.fatigue = clamp((c.fatigue | 0) - PHYSIO_FAT, 0, 100); c.physioWk = wkKey(c);
    save(c); return 'ok';
  }
  /** Tras cada partido tuyo: si firmaste para la rotación y el entrenador ya confía en ti (PROMOTE_AT), pasas a titular. */
  function promoteCheck(c) {
    if (!c.contract || roleIdx(c) !== 0 || c.coach < PROMOTE_AT) return;
    var k = myClub(c), s = Math.max(c.contract.salary | 0, salaryOf(k.lvl, k.q, 1));
    c.contract.role = ROLE_LV[1]; c.contract.salary = s;
    msg(c, 'coach', 'Te has ganado la titularidad', 'Ya no eres de la rotación: desde hoy eres titular, y el club te sube el sueldo a ' + s + ' € al mes.');
  }
  function coachFloor(c) { c.coach = Math.max(c.coach, ROLE_FLOOR[roleIdx(c)] || 0); }

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

  // =====================================================================================================================
  // CARRERA DE PISTA (6v6), lote C (11-nov-2026). Guardado aparte ('voley3d.career6'): la de playa no cambia (ni su guardado, ni su
  // migración, ni su API por defecto). Ligas por país y división con los datos de js/leagues.js (VB.Leagues; el guardado lleva una
  // copia de los clubes, así que cambiar los datos no rompe una carrera empezada), copa nacional, copas internacionales de la región,
  // ascensos y descensos, ojeadores y ofertas de clubes de ligas mejores, también extranjeras. Reutiliza de la playa: atleta y
  // progresión (addXP, bump, insignias), entrenamiento y fatiga (trainWeek), contrato, rol prometido y banquillo (benchFor, pay,
  // earlyExit), bandeja (msg), nota del partido (ingest, rating) y quickSim. Diseño en notes/carrera.md «Carrera de pista».
  var KEY6 = 'voley3d.career6', VER6 = 1, MODE_KEY = 'voley3d.career.mode';
  var START6 = 45;          // media inicial (los clubes reales de pista van de 50, en Filipinas o Perú, a 95 en la élite)
  // Datos reales (js/leagues.js): 28 países, 37 ligas de 8 a 12 clubes, 390 clubes. Hasta 8 clubes, liga a doble vuelta (14 jornadas:
  // Países Bajos, Austria, Eslovenia y Catar); con 9-10, a una vuelta (9 jornadas); con 11-12, a una vuelta (11 jornadas)
  var DOUBLE_MAX = 8;
  var POINTS6 = [15, 21, 25];
  // IA rival según la media del club, calibrada con los datos reales (11-nov-2026): < 56 Fácil (Filipinas, cola de Perú y Austria);
  // 56-61 Normal suave (perfil de principiante: la mitad baja de las ligas pequeñas); 62-75 Normal (lo alto de las pequeñas, España,
  // 2ªs de Alemania, Rusia, Turquía y Francia, mitad de la 2ª italiana); 76-87 Difícil (1ªs de Francia, Alemania, Rusia y Japón, lo alto
  // de las 2ªs de élite); ≥ 88 Experto (los grandes de Italia, Polonia, Turquía y Brasil). Antes: 54 / 60 / 72 / 86, con lo que la 2ª
  // italiana entera era Difícil desde la jornada 1 y casi ningún club era Fácil. Reparto de los 390 clubes: 18 Fácil, 81 Normal suave,
  // 182 Normal, 87 Difícil y 22 Experto (tools/careertest.js, «datos reales»).
  var DIFF6_AT = [[88, 'expert'], [76, 'hard'], [56, 'normal'], [0, 'easy']], SOFT6 = [56, 62];
  // nota del partido en 6v6: tu jugador toca menos balones que en la pareja; la parte de estadísticas se escala por puesto
  // medido (autopilot de la sim como receptor, 10 partidos a 15 por nivel): × 1 → 6,5 / 6,5 / 5,7 contra Fácil / Normal / Difícil; × 2,2 → 6,8 / 7,0 / 6,2.
  // Con × 3 el receptor queda ~7,3 contra Normal (el autopilot juega algo mejor que una persona media: ~6,5 jugando de verdad). Los
  // demás puestos, por analogía (sin medir: sim aún no los deja llevar)
  var RATE6 = { OH: 3.0, OPP: 2.8, MB: 3.4, S: 2.0, L: 4.0 };
  var SIM_SHARE6 = { OH: 0.16, OPP: 0.2, MB: 0.11, S: 0.04, L: 0 };   // simular: parte de los puntos del equipo que son tuyos
  var cur6 = null, lost6 = false;

  // ---------------------------------------------------------------- puestos (los lee de sim.js: crecen solos cuando sim los añada)
  function positions6() {
    var l = (VB.Sim && VB.Sim.CTRL_ROLES6) || VB.CTRL_ROLES6 || ['OH'], out = [];
    for (var i = 0; i < l.length; i++) if (POS6[l[i]] && out.indexOf(l[i]) < 0) out.push(l[i]);
    return out.length ? out : ['OH'];
  }
  /** Orden de los 6 de la rotación en sim.js (mkTeam6): el humano va en el 1r hueco de su puesto. */
  function simRoles6() { var r = VB.Sim && VB.Sim.ROLES6; return Array.isArray(r) && r.length === 6 ? r : ['S', 'OH', 'MB', 'OPP', 'OH', 'MB']; }
  /** Puesto que llevas en el partido: el tuyo si sim lo permite; si no, el primero que haya (receptor). */
  function ctrlRole6(c) { var p = c && c.player && c.player.roleKey, l = positions6(); return l.indexOf(p) >= 0 ? p : l[0]; }

  // ---------------------------------------------------------------- datos (js/leagues.js)
  function regions6() {
    var L = VB.Leagues; if (!L) return [];
    var r = Array.isArray(L) ? L : Array.isArray(L.regions) ? L.regions : Array.isArray(L.countries) ? [L] : [];
    return r.filter(function (x) { return x && Array.isArray(x.countries); });
  }
  function divsOf6(co) {
    if (!co || !co.code || !Array.isArray(co.divisions)) return [];
    var ds = co.divisions.filter(function (d) { return d && (d.lvl === 1 || d.lvl === 2) && Array.isArray(d.clubs) && d.clubs.length >= 4; });
    if (!ds.some(function (d) { return d.lvl === 1; })) return [];
    return ds.slice().sort(function (a, b) { return a.lvl - b.lvl; });
  }
  /** Países con liga de pista: [{country, code, tier, region, divs}]. */
  function countries6() {
    var out = [];
    regions6().forEach(function (rg) {
      rg.countries.forEach(function (co) {
        var ds = divsOf6(co); if (!ds.length || out.some(function (x) { return x.code === co.code; })) return;
        out.push({ country: String(co.country || co.code), code: String(co.code), tier: co.tier | 0, region: regionOf6(co.code, rg.region), divs: ds.length });
      });
    });
    return out;
  }
  // Región (continente) de cada país por su código: los datos reales llegan en varios ficheros por zona («Élite europea…», «Europa
  // media…») y las copas internacionales se juegan por continente. Un código que no esté aquí usa el campo region del fichero.
  var CONT6 = { 'Europa': 'IT PL TR FR DE RU ES BE NL GR PT CH AT CZ RS SI RO HR HU SK BG UA FI SE NO DK GB IE LU BY EE LV LT IL CY MK BA ME AL IS',
    'América': 'BR AR US CA PE CL CO MX PR CU DO VE UY PY BO EC CR GT PA', 'Asia': 'JP KR CN IR QA PH TH TW KZ ID VN IN HK AE SA BH KW' };
  // Zonas dentro de una región (América: la copa del sur y la del norte; cada club solo juega la de su zona)
  var ZONE6 = { sur: 'BR AR PE CL CO VE UY PY BO EC', norte: 'US CA MX PR CU DO CR GT PA' };
  function regionOf6(code, def) {
    code = String(code || '');
    for (var r in CONT6) if ((' ' + CONT6[r] + ' ').indexOf(' ' + code + ' ') >= 0) return r;
    return String(def || '');
  }
  // Para reconocer la copa nacional de cada país en las competiciones de los datos reales (campo real o note) cuando no traen
  // country: nombre del país y del torneo en el idioma local.
  var CUP_ALIAS6 = { ES: 'España|Copa del Rey|Copa de la Reina', IT: 'Itali', PL: 'Polsk|Polonia|Poland', TR: 'Türk|Turqu|Turk', FR: 'France|Francia', DE: 'DVV|Deutsch|Alemania|German',
    RU: 'Rossi|Rusia|Russia', BE: 'Belgi|Bélgica', NL: 'Países Bajos|Nederland|Netherlands|Nationale Beker', GR: 'Grecia|Greek|Hellen|Ellad', PT: 'Portugal', CH: 'Swiss|Suiza|Schweiz',
    AT: 'ÖVV|Austria|Österreich', CZ: 'Český|Chequia|Czech', RS: 'Srbij|Serbia', SI: 'Slovenij|Eslovenia', RO: 'Român|Rumanía|Romania', BR: 'Brasil|Brazil', AR: 'ACLAV|Argentin',
    US: 'USA|Estados Unidos', CA: 'Canad', PE: 'Perú|Peru', JP: 'Emperor|Empress|Japón|Japan', KR: 'KOVO|Corea|Korea', CN: 'China', IR: 'Irán|Iran', QA: 'Qatar|Catar', PH: 'Filipinas|Philippine' };
  /** Qué es una competición de los datos: {kind:'intl', rank, zone} (copa de clubes del continente; rank 1 = la grande, 2 = la
   *  segunda), {kind:'cup', country} (copa nacional) o {kind:'skip'} (ligas, supercopas, selecciones, Mundial de Clubes…).
   *  Manda lo que diga la entrada (kind, rank, zone, country); si no, se deduce del nombre real. */
  function compKind6(x, codes) {
    var real = String(x.real || ''), txt = real + ' ' + String(x.note || ''), kind = x.kind, zone = null, i;
    if (Array.isArray(x.zone)) zone = x.zone.map(String); else if (typeof x.zone === 'string' && ZONE6[x.zone]) zone = ZONE6[x.zone].split(' ');
    if (kind === 'skip') return { kind: 'skip' };
    if (kind === 'cup' || (!kind && x.country)) return x.country ? { kind: 'cup', country: String(x.country) } : { kind: 'skip' };
    var intlRe = /\b(CEV|AVC|CSV|NORCECA|Asian|Sudamerican|South American|Champions League|Challenge Cup)\b/i, notRe = /\b(FIVB|World|Mundial|Nations|VNL|EuroVolley|Ol[ií]mpic|Juegos|selecciones)\b/i;
    if (kind === 'intl' || (!kind && intlRe.test(real) && !notRe.test(real))) {
      var rank = x.rank | 0 || (/Challenge/i.test(real) ? 3 : /\bCEV Cup\b/i.test(real) ? 2 : 1);
      if (!zone) zone = /Sudamerican|South American|\bCSV\b/i.test(real) ? ZONE6.sur.split(' ') : /NORCECA/i.test(real) ? ZONE6.norte.split(' ') : null;
      return { kind: 'intl', rank: rank, zone: zone };
    }
    if (kind) return { kind: 'skip' };
    if (!/(^|[^\wÀ-ž])(Cup|Copa|Coppa|Coupe|Pokal|Ta[çc]a|Puchar|Kupa|Kup|Kupok|poh[áa]r|Cupa|Beker)([^\wÀ-ž]|$)/i.test(real) || /Super|BeNe|MEVZA|Príncipe|Princesa|Superliga 2|Conference/i.test(real)) return { kind: 'skip' };
    for (i = 0; i < codes.length; i++) {
      var al = CUP_ALIAS6[codes[i].code], nm = codes[i].country;
      if ((al && new RegExp(al, 'i').test(real)) || (nm && real.indexOf(nm) >= 0)) return { kind: 'cup', country: codes[i].code };
    }
    for (i = 0; i < codes.length; i++) {   // y si no, en la nota
      var al2 = CUP_ALIAS6[codes[i].code];
      if (al2 && new RegExp(al2, 'i').test(txt)) return { kind: 'cup', country: codes[i].code };
    }
    return { kind: 'skip' };
  }
  function hexN(s, def) { var m = /^#?([0-9a-f]{6})$/i.exec(String(s == null ? '' : s).trim()); return m ? parseInt(m[1], 16) : def; }
  function lum6(h) { return (0.299 * (h >> 16 & 255) + 0.587 * (h >> 8 & 255) + 0.114 * (h & 255)) / 255; }
  function mix6(a, b, t) { var f = function (s) { return Math.round((a >> s & 255) * (1 - t) + (b >> s & 255) * t) << s; }; return (f(16) | f(8) | f(0)) >>> 0; }
  /** Equipación de un club de pista: MISMOS colores que el real (camiseta, segundo color, líbero); el diseño (franjas, cuello) lo
   *  pone el juego (pattern por el nombre, nunca el de la camiseta real). Mismos campos que los kits de playa (+ libero). */
  function kit6(name, sh, s2, lb) {
    var shorts = lum6(sh) > 0.7 || lum6(s2) < 0.3 ? s2 : mix6(sh, 0x0b0e17, 0.6);
    return { shirt: sh, accent: s2, shorts: shorts, pattern: PATTERNS[hash('kit6', name) % PATTERNS.length], libero: lb };
  }
  function artOf6(name) { return /^(Campeonato|Torneo|Circuito|Trofeo|Open)\b/.test(name) ? 'el' : 'la'; }
  /** Copia del mundo de pista en el guardado: ligas (país + división), clubes, copas nacionales e internacionales. */
  function buildWorld6(c) {
    var id = 0, leagues = [], clubs = [], cups = {}, intl = {};
    var allCodes = countries6().map(function (x) { return { code: x.code, country: x.country }; });
    regions6().forEach(function (rg) {
      var comps = (Array.isArray(rg.competitions) ? rg.competitions : []).filter(function (x) { return x && x.name; });
      var codes = rg.countries.filter(function (co) { return co && co.code; }).map(function (co) { return { code: String(co.code), country: String(co.country || '') }; });
      // copas: la nacional de cada país (la 1ª que se reconozca) y, por región y zona, la internacional grande (rank 1) y la 2ª
      comps.forEach(function (x) {
        var ck = compKind6(x, codes.concat(allCodes)), nm = String(x.name), sh = String(x.short || abbr(nm));
        if (ck.kind === 'cup') { if (!cups[ck.country]) cups[ck.country] = { name: nm, short: sh }; return; }
        if (ck.kind !== 'intl' || ck.rank > 2) return;
        var regs = {};
        if (ck.zone) ck.zone.forEach(function (cc) { var rr = regionOf6(cc, ''); if (rr) regs[rr] = 1; });
        if (!Object.keys(regs).length) codes.forEach(function (co) { regs[regionOf6(co.code, rg.region)] = 1; });
        Object.keys(regs).forEach(function (reg) {
          var L = intl[reg] = intl[reg] || [], zk = ck.zone ? ck.zone.join(' ') : '';
          if (L.some(function (y) { return y.rank === ck.rank && (y.zone ? y.zone.join(' ') : '') === zk; })) return;   // repetida en otro fichero: la 1ª
          L.push({ name: nm, short: sh, rank: ck.rank, zone: ck.zone });
        });
      });
      rg.countries.forEach(function (co) {
        var reg = regionOf6(co.code, rg.region);
        divsOf6(co).forEach(function (d) {
          var lid = String(co.code) + d.lvl;
          if (leagues.some(function (L) { return L.id === lid; })) return;
          var nm = String(d.name || 'Liga');
          leagues.push({ id: lid, cc: String(co.code), country: String(co.country || co.code), region: reg, tier: co.tier | 0, lvl: d.lvl, name: nm, art: artOf6(nm),
            short: String(d.short || abbr(nm)), strength: clampI(d.strength, 1, 100) });
          d.clubs.forEach(function (k) {
            if (!k || !k.name) return;
            var col = k.colors || {}, sh = hexN(col.shirt, 0xd8262e), s2 = hexN(col.shirt2, 0xffffff), lb = hexN(col.libero, mix6(sh, 0xffffff, 0.5)), o = clampI(k.ovr, 20, 99);
            // Patrocinador inventado (Ferran, 11-nov-2026): como en la realidad, el club se llama «patrocinador + nombre»; nameBase sin él.
            clubs.push({ id: id++, lid: lid, cc: String(co.code), name: (k.sponsor ? String(k.sponsor) + ' ' : '') + String(k.name), nameBase: String(k.name), sponsor: k.sponsor ? String(k.sponsor) : '', short: String(k.short || abbr(String(k.name))).slice(0, 4).toUpperCase(), city: String(k.city || ''),
              base: o, ovr: o, kit: kit6(String(k.name), sh, s2, lb), libEst: !!k.liberoEstimated });
          });
        });
      });
    });
    uniqueShorts(clubs);
    for (var rr in intl) intl[rr].sort(function (a, b) { return a.rank - b.rank; });
    c.leagues = leagues; c.clubs = clubs; c.cups = cups; c.intl = intl;
  }

  // ---------------------------------------------------------------- almacenamiento (guardado aparte del de playa)
  function save6(c) {
    c = c || cur6; if (!c) return false;
    try { var s = store(); if (!s) return false; s.setItem(KEY6, JSON.stringify(c)); return true; } catch (e) { return false; }
  }
  function load6() {
    if (cur6) return cur6;
    var o = null, raw = null, s = null;
    try { s = store(); raw = s ? s.getItem(KEY6) : null; o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
    try { cur6 = sane6(o); } catch (e) { cur6 = null; }
    if (!cur6 && raw) { lost6 = true; try { if (s) { s.setItem(KEY6 + '.bak', raw); s.removeItem(KEY6); } } catch (e) { } }
    return cur6;
  }
  function abandon6() { cur6 = null; M = null; lost6 = false; try { var s = store(); if (s) s.removeItem(KEY6); } catch (e) { } return true; }
  /** Repara lo reparable de un guardado de pista; lo irreparable (ligas, clubes, tu club) → null (copia en KEY6 + '.bak'). */
  function sane6(o) {
    var arr = Array.isArray, num = function (v) { return typeof v === 'number' && isFinite(v); };
    if (!o || typeof o !== 'object' || o.v !== VER6 || !o.player || typeof o.player !== 'object' || !arr(o.leagues) || !o.leagues.length || !arr(o.clubs) || !o.clubs.length) return null;
    var lids = {}; o.leagues.forEach(function (L) { if (L && typeof L.id === 'string') lids[L.id] = L; });
    if (!o.leagues.every(function (L) { return L && lids[L.id] === L && typeof L.name === 'string' && num(L.strength) && (L.lvl === 1 || L.lvl === 2); })) return null;
    if (!o.clubs.every(function (k) { return k && num(k.id) && lids[k.lid] && typeof k.name === 'string' && num(k.ovr) && k.kit && typeof k.kit === 'object'; })) return null;
    o.leagues.forEach(function (L) { if (typeof L.short !== 'string') L.short = abbr(L.name); if (L.art !== 'el') L.art = 'la'; if (typeof L.country !== 'string') L.country = String(L.cc || ''); if (typeof L.region !== 'string') L.region = ''; });
    o.clubs.forEach(function (k) { k.ovr = clampI(k.ovr, 20, 99); k.base = num(k.base) ? clampI(k.base, 20, 99) : k.ovr; if (typeof k.short !== 'string') k.short = abbr(k.name); if (typeof k.city !== 'string') k.city = ''; k.cc = lids[k.lid].cc; });
    var p = P();
    if (p && p.saneAthlete) {
      var d = p.newAthlete({ num: o.player.num, role: o.player.role, name: o.player.name });
      p.saneAthlete(o.player, d); d.roleKey = POS6[o.player.roleKey] ? o.player.roleKey : 'OH'; d.age = clampI(o.player.age, 15, 60); o.player = d;
    }
    o.player.roleKey = POS6[o.player.roleKey] ? o.player.roleKey : 'OH'; o.player.role = POS6[o.player.roleKey].name;
    o.mode = 'hall'; o.ctrl = 'one'; o.mate = null;
    // vida de la Carrera (career-life.js): un guardado de pista de antes de la vida (sin c.life) la crea aquí, vacía (fama 0)
    if (VB.CareerLife && VB.CareerLife.ensure) { try { VB.CareerLife.ensure(o); } catch (e) { o.life = null; } }
    o.points = POINTS6.indexOf(o.points) >= 0 ? o.points : 15;
    o.seed = num(o.seed) ? o.seed >>> 0 : hash('reparado6', o.created || 0);
    o.season = clampI(o.season, 1, 999);
    if (!o.cups || typeof o.cups !== 'object') o.cups = {};
    if (!o.intl || typeof o.intl !== 'object') o.intl = {};
    ['notes', 'offers', 'history', 'trophies', 'inbox', 'kos'].forEach(function (k) { if (!arr(o[k])) o[k] = []; });
    if (!o.tab || typeof o.tab !== 'object') o.tab = {};
    if (!o.scouts || typeof o.scouts !== 'object') o.scouts = {};
    if (!o.stats || typeof o.stats !== 'object') o.stats = newSeasonStats();
    if (!o.career || typeof o.career !== 'object') o.career = newSeasonStats();
    [o.stats, o.career].forEach(function (x) { var z = newSeasonStats(); for (var k in z) if (!num(x[k])) x[k] = 0; });
    o.inbox = o.inbox.filter(function (m) { return m && typeof m.t === 'string'; }).slice(-INBOX_MAX);
    o.msgN = num(o.msgN) ? o.msgN | 0 : o.inbox.reduce(function (s, m) { return Math.max(s, (m.id | 0) + 1); }, 0);
    if (TRAIN_KEYS.indexOf(o.train) < 0) o.train = 'bal';
    if (!o.tp || typeof o.tp !== 'object') o.tp = {};
    ['phys', 'def', 'atk'].forEach(function (g) { o.tp[g] = num(o.tp[g]) ? clamp(o.tp[g], 0, TRAIN_NEED - 1) : 0; });
    o.fatigue = num(o.fatigue) ? clamp(Math.round(o.fatigue), 0, 100) : 0;
    o.money = num(o.money) ? Math.max(0, Math.round(o.money)) : 0;
    o.chem = num(o.chem) ? clamp(Math.round(o.chem), 0, 100) : 0;
    o.coach = num(o.coach) ? clamp(Math.round(o.coach), 0, 100) : 50;
    o.listed = !!o.listed;
    var cos = countries6(); if (typeof o.cc !== 'string' || !o.leagues.some(function (L) { return L.cc === o.cc; })) o.cc = o.leagues[0].cc;
    o.notes = o.notes.filter(function (n) { return n && num(n.nota); });
    if (o.phase === 'pick') {
      o.myClub = -1; o.window = 'start';
      if (!o.pick || typeof o.pick !== 'object') o.pick = { round: 0, more: false };
      o.pick.round = clampI(o.pick.round, 0, 9); o.pick.more = !!o.pick.more;
      if (!o.offers.length || !o.offers.every(function (x) { var k = x && club(o, x.club); return k && k.cc === o.cc; })) o.offers = genStartOffers6(o, o.pick.round);
      o.week = 0; o.last = null; o.kos = []; o.koI = 0; o.myRes = { lid: '', w: [] };
      return o;
    }
    var me = myClub(o); if (!me) return null;
    o.offers = o.offers.filter(function (x) { return x && club(o, x.club); });
    if (!o.myRes || typeof o.myRes !== 'object' || o.myRes.lid !== me.lid || !arr(o.myRes.w)) o.myRes = { lid: me.lid, w: arr(o.myRes && o.myRes.w) && o.myRes && o.myRes.lid === me.lid ? o.myRes.w : [] };
    var ct = o.contract;
    if (!ct || typeof ct !== 'object' || !num(ct.left) || !num(ct.years) || ROLE_LV.indexOf(ct.role) < 0) {
      var rl = o.coach >= 70 ? 2 : o.coach >= 45 ? 1 : 0;
      o.contract = { club: me.id, years: 2, left: 2, role: ROLE_LV[rl], salary: salary6(o, me, rl), since: o.season };
    } else { ct.left = clampI(ct.left, 0, 5); ct.years = clampI(ct.years, 1, 5); ct.club = o.myClub; if (!num(ct.salary)) ct.salary = salary6(o, me, ROLE_LV.indexOf(ct.role)); }
    if (!o.objective || typeof o.objective.text !== 'string' || !num(o.objective.pos)) o.objective = objectiveFor6(o, me);
    if (o.last && (!o.last.me || !arr(o.last.sets) || !arr(o.last.setScores))) o.last = null;
    if (o.window !== 'mid' && o.window !== 'end') o.window = '';
    if (['league', 'ko', 'off'].indexOf(o.phase) < 0) o.phase = 'league';
    o.week = clampI(o.week, 0, weeksOf6(o, me.lid));
    o.koI = clampI(o.koI, 0, 9);
    cur6 = o;
    if (o.phase === 'league' && o.week >= weeksOf6(o, me.lid)) endLeague6(o);
    if (o.phase === 'ko') {
      var okKO = o.kos.every(function (ko) { return ko && arr(ko.rounds) && ko.rounds.length && arr(ko.res) && arr(ko.ids) && num(ko.round) && ko.rounds.every(function (rd) { return arr(rd) && rd.every(function (m) { return arr(m) && club(o, m[0]) && club(o, m[1]); }); }); });
      if (!okKO) { o.kos = buildKOs6(o); o.koI = 0; }
      advanceKO6(o);
    }
    if (o.phase === 'off') {
      if (!o.review || typeof o.review !== 'object') o.review = { season: o.season, pos: posOf6(o, me.id), lid: me.lid, objective: o.objective.text, objOk: false, champion: false, cups: [], move: 0, nota: avgNota(o), coach: o.coach, moves: [] };
      if (!arr(o.pendingMoves)) o.pendingMoves = [];
      o.window = 'end';
    }
    return o;
  }

  // ---------------------------------------------------------------- ligas, clubes y calendario
  function lg6(c, lid) { if (!c || !c.leagues) return null; for (var i = 0; i < c.leagues.length; i++) if (c.leagues[i].id === lid) return c.leagues[i]; return null; }
  function lgClubs6(c, lid) { return c.clubs.filter(function (k) { return k.lid === lid; }); }
  /** Jornadas de la liga lid: doble vuelta hasta DOUBLE_MAX clubes; a una vuelta con más (así la temporada no es eterna). */
  function weeksOf6(c, lid) { var n = lgClubs6(c, lid).length, m = n + (n % 2); return m < 2 ? 0 : n <= DOUBLE_MAX ? 2 * (m - 1) : m - 1; }
  function midWeek6(c) { var k = myClub(c); return k ? Math.floor(weeksOf6(c, k.lid) / 2) : 0; }
  var SC6 = {}, SC6n = 0;
  /** Calendario de la liga lid en la temporada (determinista: no se guarda). Con número impar de clubes, uno descansa cada jornada. */
  function sched6(c, lid) {
    var ids = lgClubs6(c, lid).map(function (k) { return k.id; }), key = c.seed + '|' + c.season + '|' + lid + '|' + ids.join(',');
    if (SC6[key]) return SC6[key];
    if (++SC6n > 400) { SC6 = {}; SC6n = 1; }
    var t = ids.slice(); if (t.length % 2) t.push(-1);
    if (t.length < 2) return (SC6[key] = []);
    var full = roundRobin(t, rng(hash(c.seed, 'sched6', c.season, lid))), W = ids.length <= DOUBLE_MAX ? full.length : full.length / 2;
    return (SC6[key] = full.slice(0, W).map(function (wk) { return wk.filter(function (m) { return m[0] >= 0 && m[1] >= 0; }); }));
  }
  function addRes6(c, lid, m) {
    var T = c.tab[lid] = c.tab[lid] || {}, pp = setPts(m.s);
    [m.a, m.b].forEach(function (id, s) {
      var row = T[id] = T[id] || [0, 0, 0, 0, 0, 0, 0, 0], my = m.s[s], ot = m.s[1 - s];
      row[0]++; if (my > ot) row[1]++; else row[2]++; row[3] += my; row[4] += ot; row[7] += pp[s];
      m.sc.forEach(function (z) { row[5] += z[s]; row[6] += z[1 - s]; });
    });
  }
  /** Clasificación de la liga lid (por defecto la tuya). Las de todas las ligas se guardan agregadas (c.tab), sin los partidos. */
  function table6(c, lid) {
    c = c || load6(); if (!c) return [];
    if (lid == null || !lg6(c, lid)) { var mk = myClub(c); lid = mk ? mk.lid : c.leagues[0].id; }
    var T = c.tab[lid] || {};
    var out = lgClubs6(c, lid).map(function (k) { var r = T[k.id] || [0, 0, 0, 0, 0, 0, 0, 0]; return { id: k.id, pj: r[0], g: r[1], p: r[2], sf: r[3], sc: r[4], pf: r[5], pc: r[6], pts: r[7] }; });
    out.sort(function (a, b) {
      return b.pts - a.pts || b.g - a.g || ((b.sf + 1) / (b.sc + 1)) - ((a.sf + 1) / (a.sc + 1)) || ((b.pf + 1) / (b.pc + 1)) - ((a.pf + 1) / (a.pc + 1)) || a.id - b.id;
    });
    out.forEach(function (r, i) { r.pos = i + 1; });
    return out;
  }
  function posOf6(c, id) { var k = club(c, id); if (!k) return 0; var t = table6(c, k.lid); for (var i = 0; i < t.length; i++) if (t[i].id === id) return i + 1; return 0; }
  function qOf6(c, k, lid) {
    var l = lgClubs6(c, lid || k.lid).map(function (x) { return x.ovr; }), lo = Math.min.apply(null, l), hi = Math.max.apply(null, l);
    return hi > lo ? clamp((k.ovr - lo) / (hi - lo), 0, 1) : 0.5;
  }
  /** Sueldo base del mes según la fuerza de la liga (ficticio): 400 € en una liga de 50, ~2.500 en una de 70, ~15.000 en la élite. */
  function salBase6(s) { return 400 * Math.exp((clamp(s, 30, 100) - 50) / 11); }
  function salary6(c, k, rl, lid) {
    var L = lg6(c, lid || k.lid), v = salBase6(L ? L.strength : 50) * (0.8 + 0.4 * qOf6(c, k, lid)) * [0.8, 1, 1.25][clamp(rl | 0, 0, 2)];
    return Math.round(v / 50) * 50;
  }
  function ref6(s) { return s < 60 ? 'low' : s < 72 ? 'mid' : s < 84 ? 'high' : 'top'; }
  function xpMul6(L) { return round1(clamp(1 + ((L ? L.strength : 50) - 50) / 14, 1, 4)); }
  function starsOf6(o) { return clamp(1 + Math.floor((o - 45) / 11), 1, 5); }
  /** Ficha de un club de pista (ofertas, pestaña Club): país, liga, prestigio, media, estilo, ciudad. lid/ovr: los de la temporada que viene si se pasan. */
  function clubInfo6(c, k, lid, ovr) {
    var L = lg6(c, lid || k.lid) || lg6(c, k.lid), o = ovr != null ? ovr : k.ovr;
    return { id: k.id, name: k.name, short: k.short, city: k.city, beach: '', kit: k.kit, libEst: !!k.libEst, cc: L.cc, country: L.country, region: L.region, lid: L.id, lvl: L.lvl,
      league: L.name, lgShort: L.short, art: L.art, strength: L.strength, stars: starsOf6(o), style: styleOf(k), ovr: o };
  }
  function expectedPos6(c, k, lid) {
    var l = lgClubs6(c, lid || k.lid).map(function (x) { return x.ovr; }).sort(function (a, b) { return b - a; });
    return l.indexOf(k.ovr) + 1 || l.length;
  }
  function objectiveFor6(c, k, lid) {
    lid = lid || k.lid;
    var L = lg6(c, lid), n = lgClubs6(c, lid).length, e = expectedPos6(c, k, lid), up = L.lvl === 2, down = L.lvl === 1 && !!lg6(c, L.cc + '2'), half = Math.ceil(n * 0.6);
    if (e <= 1 && !up) return { pos: 1, text: 'Ganar la ' + L.name };
    if (e <= 2) return up ? { pos: 2, text: 'Subir de categoría (quedar entre los 2 primeros)' } : { pos: 2, text: 'Quedar entre los 2 primeros (y jugar la copa internacional)' };
    if (e <= 4) return { pos: 4, text: 'Quedar entre los 4 primeros' };
    if (e <= half) return { pos: half, text: 'Terminar en mitad de tabla (entre los ' + half + ' primeros)' };
    return down ? { pos: n - 2, text: 'Evitar el descenso' } : { pos: n - 1, text: 'No acabar último' };
  }
  function difficultyFor6(k) { var o = k.ovr; for (var i = 0; i < DIFF6_AT.length; i++) if (o >= DIFF6_AT[i][0]) return DIFF6_AT[i][1]; return 'easy'; }
  function soft6(k) { return k.ovr >= SOFT6[0] && k.ovr < SOFT6[1]; }
  function diffLabel6(k) { var d = difficultyFor6(k), nm = VB.DIFF && VB.DIFF[d] && VB.DIFF[d].name || d; return soft6(k) ? nm + ' suave' : nm; }
  function chemBonus6(c) { return c ? Math.min(3, Math.floor(clamp(c.chem | 0, 0, 100) / 30)) : 0; }
  /** Fuerza de tu equipo para la simulación: la del club, movida por tu media (un 30 %), insignias, forma, química y fatiga. */
  function teamOvr6(c) {
    var k = myClub(c); if (!k) return 0;
    var f = form(c);
    return k.ovr + 0.3 * (playerOvr(c) - k.ovr) + 0.35 * badgePower(c.player) + (f == null ? 0 : (f - 6.5) * 0.8) + 0.5 * chemBonus6(c) - 0.5 * fatigueMalus(c);
  }
  function wkKey6(c) { return (c.season | 0) * 1000 + (c.phase === 'ko' ? 500 + (c.koI | 0) * 10 + ((c.kos && c.kos[c.koI] && c.kos[c.koI].round) | 0) : c.week | 0); }
  function roundName6(pairs) { return pairs <= 1 ? 'Final' : pairs === 2 ? 'Semifinal' : pairs <= 4 ? 'Cuartos' : 'Octavos'; }
  /** Dorsales del equipo (6 de la rotación, sin el tuyo; el líbero lleva el 13 de sim.js). Deterministas por club y temporada. */
  function teamNums6(c, k) {
    var r = rng(hash(c.seed, 'nums6', k.id, c.season)), pool = [];
    for (var n = 1; n <= 20; n++) if (n !== c.player.num && n !== 13) pool.push(n);
    return shuffle(r, pool).slice(0, 6);
  }
  /** Plantilla del club para la pestaña Equipo (jugadores inventados): los 6 de la rotación y el líbero, tú en tu puesto. */
  function roster6(c, k) {
    k = k || myClub(c); if (!k) return [];
    var R = simRoles6(), role = ctrlRole6(c), idx = R.indexOf(role), nums = teamNums6(c, k), r = rng(hash(c.seed, 'roster6', k.id, c.season)), out = [];
    if (idx < 0) idx = 1;
    R.concat(['L']).forEach(function (ro, i) {
      var me = i === idx && k.id === c.myClub, nm = pick(r, FIRST) + ' ' + pick(r, LAST), o = clampI(k.ovr + (r() - 0.5) * 8, 20, 99);
      out.push({ name: me ? c.player.name : nm, pos: ro, posName: POS6[ro].name, ovr: me ? playerOvr(c) : o, num: me ? c.player.num : ro === 'L' ? 13 : nums[i], me: me });
    });
    return out;
  }

  // ---------------------------------------------------------------- crear
  function create6(o) {
    o = o || {};
    var seed = (o.seed != null ? +o.seed : (Date.now() ^ (Math.random() * 1e9))) >>> 0, p = P();
    var pos = POS6[o.pos] && positions6().indexOf(o.pos) >= 0 ? o.pos : positions6()[0];
    var name = String(o.name || '').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Jugador';
    var num = clampI(o.num != null ? o.num : 1, 1, 99), st = genSt(START6, pos, null);
    var player = p && p.newAthlete ? p.newAthlete({ num: num, role: POS6[pos].name, name: name, st: st })
      : { num: num, role: POS6[pos].name, name: name, lvl: 1, xp: 0, pts: 0, st: st, matches: 0, bp: {}, bd: {}, beq: [] };
    player.roleKey = pos; player.age = 18;
    var c = { v: VER6, mode: 'hall', seed: seed, created: o.now || Date.now(), points: POINTS6.indexOf(+o.points) >= 0 ? +o.points : 15, ctrl: 'one',
      season: 1, week: 0, phase: 'pick', player: player, cc: '', leagues: [], clubs: [], cups: {}, intl: {}, myClub: -1, mate: null,
      tab: {}, myRes: { lid: '', w: [] }, kos: [], koI: 0, notes: [], coach: 50, objective: null, offers: [], window: 'start', review: null, last: null,
      stats: newSeasonStats(), career: newSeasonStats(), history: [], trophies: [], pick: { round: 0, more: false }, inbox: [], msgN: 0,
      train: 'bal', tp: { phys: 0, def: 0, atk: 0 }, fatigue: 0, listed: false, contract: null, money: 0, chem: 0, scouts: {},
      provisional: !!(VB.Leagues && VB.Leagues.provisional) };
    buildWorld6(c);
    if (!c.leagues.length) return null;
    var cos = countries6();
    c.cc = cos.some(function (x) { return x.code === o.country; }) ? String(o.country) : cos.some(function (x) { return x.code === 'ES'; }) ? 'ES' : cos[0].code;
    c.offers = genStartOffers6(c, 0);
    var L0 = lg6(c, c.offers[0] ? club(c, c.offers[0].club).lid : c.cc + '1');
    msg(c, 'agent', 'Tienes ' + c.offers.length + ' ofertas', 'Soy tu agente. Varios clubes ' + (L0 ? 'de la ' + L0.name + ' (' + L0.country + ')' : '') + ' quieren ' + (c.offers.some(function (x) { return x.trial; }) ? 'ficharte o probarte' : 'ficharte') +
      ' para la temporada 1 como ' + POS6[pos].name.toLowerCase() + '. Compara las fichas (liga, prestigio, objetivo, rol y sueldo). Juega bien y los ojeadores de las ligas fuertes, también de fuera, vendrán a verte.');
    cur6 = c; M = null; lost6 = false;
    life(c, 'create');   // vida de la Carrera (career-life.js): c.life, con la fama heredada del Salón de la Fama
    if (o.autoClub) { var i = 0, best = -1; c.offers.forEach(function (x, j) { if (!x.trial && (best < 0 || x.ovr < best)) { best = x.ovr; i = j; } }); joinClub6(c, c.offers[i], c.offers[i].years); }
    save6(c);
    return c;
  }
  /** Ofertas de inicio: 3-4 clubes modestos de la división más baja de tu país y, en la 1ª ronda, quizá una prueba en el peor de la 1ª. */
  function genStartOffers6(c, round) {
    var r = rng(hash(c.seed, 'start6', round)), low = lg6(c, c.cc + '2') ? c.cc + '2' : c.cc + '1';
    var div = lgClubs6(c, low).sort(function (a, b) { return a.ovr - b.ovr || a.id - b.id; });
    var pool = round === 0 ? div.slice(0, 6) : div.slice(0, 3), avg = pool.reduce(function (s, k) { return s + k.ovr; }, 0) / Math.max(1, pool.length);
    shuffle(r, pool);
    var n = round === 0 ? 3 + (r() < 0.5 ? 1 : 0) : (round === 1 ? 3 : 2);
    var out = pool.slice(0, n).map(function (k) { return startOffer6(c, k, avg, round, r, false); });
    if (round === 0 && low !== c.cc + '1' && r() < 0.75) {
      var top = lgClubs6(c, c.cc + '1').sort(function (a, b) { return a.ovr - b.ovr || a.id - b.id; })[0];
      if (top) out.push(startOffer6(c, top, avg, round, r, true));
    }
    out.sort(function (a, b) { return (a.trial ? 1 : 0) - (b.trial ? 1 : 0) || b.ovr - a.ovr; });
    return out;
  }
  function startOffer6(c, k, avg, round, r, trial) {
    var it = round1(8 + (avg - k.ovr) + (r() - 0.5) * 8 + round * 2.5);
    var rl = trial ? 0 : it > ROLE_NEED[2] ? 2 : it > ROLE_NEED[1] ? 1 : 0;
    var o = { club: k.id, lid: k.lid, cc: k.cc, ovr: k.ovr, interest: it, role: ROLE_LV[rl], years: trial ? 1 : 1 + Math.floor(r() * 2),
      salary: Math.round(salary6(c, k, rl) * (round ? 0.85 : 1) / 50) * 50, objective: objectiveFor6(c, k).text, start: 1, foreign: false };
    if (trial) { o.trial = true; o.chance = round1(clamp(0.3 + (playerOvr(c) - START6) * 0.04, 0.1, 0.75) * 10) / 10; }
    return o;
  }
  function joinClub6(c, o, years) {
    var k = club(c, o.club), rl = Math.max(0, ROLE_LV.indexOf(o.role));
    c.myClub = k.id; c.chem = 0;
    years = clampI(years != null ? years : o.years || 1, 1, 3);
    c.contract = { club: k.id, years: years, left: years, role: ROLE_LV[rl], salary: o.salary || salary6(c, k, rl), since: c.season + (c.phase === 'off' ? 1 : 0) };
    c.coach = clamp(ROLE_COACH[rl] - (o.early ? EARLY_COACH : 0) - (o.negNo ? NEG_COACH : 0), 0, 100); c.listed = false; c.broken = 0;
    c.joinWk = c.phase === 'off' ? (c.season + 1) * 1000 : wkKey6(c);
    c.offers = []; c.window = '';
    if (c.phase === 'pick') { c.phase = 'league'; c.week = 0; c.pick = null; }
    if (c.phase !== 'off') {
      c.myRes = { lid: k.lid, w: [] };
      c.objective = objectiveFor6(c, k); welcome6(c);
      if (c.phase === 'league') { if (c.week >= weeksOf6(c, k.lid)) endLeague6(c); else skipBye6(c); }
    }
  }
  function welcome6(c) {
    var k = myClub(c), L = lg6(c, k.lid), ct = c.contract;
    msg(c, 'coach', 'Bienvenido a ' + k.name, 'Aquí empiezas como ' + ct.role.toLowerCase() + ' (' + plural(ct.years, 'temporada', 'temporadas') + ') y juegas de ' + POS6[c.player.roleKey].name.toLowerCase() +
      ' en la ' + L.name + ' (' + L.country + '). Objetivo del club: ' + c.objective.text.toLowerCase() + '. El equipo no te conoce: la química sube con cada partido juntos.');
  }

  // ---------------------------------------------------------------- jornada, copas y temporada
  function myFixture6(c) {
    var k = myClub(c); if (!k) return null;
    if (c.phase === 'league') {
      var wk = sched6(c, k.lid)[c.week]; if (!wk) return null;
      for (var i = 0; i < wk.length; i++) if (wk[i][0] === k.id || wk[i][1] === k.id) return { kind: 'league', week: c.week, i: i, home: wk[i][0], away: wk[i][1] };
      return null;
    }
    if (c.phase === 'ko') {
      var ko = c.kos && c.kos[c.koI]; if (!ko || ko.champion >= 0) return null;
      var rd = ko.round, ps = ko.rounds[rd] || [];
      for (var j = 0; j < ps.length; j++) if ((ps[j][0] === k.id || ps[j][1] === k.id) && !(ko.res[rd] && ko.res[rd][j])) return { kind: 'ko', ko: c.koI, round: rd, i: j, home: ps[j][0], away: ps[j][1] };
    }
    return null;
  }
  function next6(c) {
    c = c || load6(); if (!c) return null;
    var f = myFixture6(c); if (!f) return null;
    var me = myClub(c), riv = club(c, f.home === me.id ? f.away : f.home), L = lg6(c, me.lid), ko = f.kind === 'ko' ? c.kos[f.ko] : null;
    var label = ko ? ko.name + ' · ' + roundName6(ko.rounds[f.round].length) : L.name + ' · Jornada ' + (f.week + 1) + ' de ' + weeksOf6(c, me.lid);
    return { kind: f.kind, week: f.week, round: f.round, ko: f.ko, i: f.i, label: label, home: club(c, f.home), away: club(c, f.away), me: me, rival: riv, atHome: f.home === me.id,
      ovrMe: Math.round(teamOvr6(c)), ovrRival: riv.ovr, diff: difficultyFor6(riv), soft: soft6(riv), diffName: diffLabel6(riv), comp: ko ? ko.kind : 'league', compName: ko ? ko.name : L.name,
      foreign: riv.cc !== me.cc, rivalLeague: lg6(c, riv.lid), bench: f.kind === 'league' && benchFor(c, f) };
  }
  /** Opciones del partido de pista: 6v6 en el pabellón, tu puesto, atributos de los 12, colores de los dos clubes (con el líbero). */
  function matchSetup6(c) {
    c = c || load6(); var n = next6(c); if (!n || n.bench) return null;
    var R = simRoles6(), role = ctrlRole6(c), idx = R.indexOf(role); if (idx < 0) { idx = R.indexOf('OH'); role = 'OH'; }
    var r = rng(hash(c.seed, 'riv6', c.season, c.phase, n.week, n.round, n.ko, n.rival.id));
    var stMe = copy(c.player.st), fm = fatigueMalus(c), ch = chemBonus6(c), mo = n.me.ovr, ro = n.rival.ovr;
    KEYS.forEach(function (key) { stMe[key] = clampI(stMe[key] - fm + (CHEM_KEYS.indexOf(key) >= 0 ? ch : 0), 1, 99); });
    var a0 = R.map(function (pos, i) {
      if (i === idx) return stMe;
      var st = genSt(clamp(mo + (r() - 0.5) * 4, 1, 99), pos, r); CHEM_KEYS.forEach(function (kk) { st[kk] = clampI(st[kk] + ch, 1, 99); }); return st;
    });
    var a1 = R.map(function (pos) { return genSt(clamp(ro + (r() - 0.5) * 4, 1, 99), pos, r); });
    var bd = B() && B().forPlayer ? B().forPlayer(c.player) : null; if (bd && !Object.keys(bd).length) bd = null;
    var nums = teamNums6(c, n.me); nums[idx] = c.player.num;
    var L = lg6(c, n.me.lid), k = n.me.kit, rk = n.rival.kit;
    var out = {
      format: '6v6', venue: 'hall', ctrlRole: role, ctrlIdx: idx, ctrl: 'one',
      attrs: [a0, a1], badges: bd ? [R.map(function (x, i) { return i === idx ? bd : null; }), null] : null, nums: [nums, null],
      points: c.points, difficulty: n.diff, rookie: !!n.soft, diffName: n.diffName, chem: ch, fatigue: fm,
      ref: copy(REF[ref6(L.strength)]),
      kit: { kitShirt: k.shirt, kitAccent: k.accent, kitShorts: k.shorts, kitPattern: k.pattern, kitLibero: k.libero },
      rivalKit: { kitShirt: rk.shirt, kitAccent: rk.accent, kitShorts: rk.shorts, kitPattern: rk.pattern, kitLibero: rk.libero },
      career: { mode: 'hall', season: c.season, phase: c.phase, week: n.week, round: n.round, label: n.label, me: n.me.short, rival: n.rival.short, venue: 'hall',
        meName: n.me.name, rivalName: n.rival.name, player: c.player.name, num: c.player.num, pos: role, posName: POS6[role].name, mate: '', mateNum: 0 }
    };
    life(c, 'setup', out);   // material de la tienda y molestias (en tu hueco, ctrlIdx) y reto de la jornada (career-life.js)
    return out;
  }
  function simMatch6(c, a, b, sd) {
    var ka = club(c, a), kb = club(c, b), r = rng(sd), q = quickSim(ka.ovr + (r() - 0.5) * 4, kb.ovr + (r() - 0.5) * 4, r, c.points);
    return { a: a, b: b, s: q.sets, sc: q.setScores };
  }
  /** Una jornada w de una liga (los partidos que falten). Devuelve los de la liga (solo se guardan los de la tuya). */
  function playLeagueWeek6(c, L, w) {
    var wk = sched6(c, L.id)[w], out = []; if (!wk) return out;
    var mine = !!(c.myRes && c.myRes.lid === L.id), recs = mine ? (c.myRes.w[w] = c.myRes.w[w] || []) : null;
    wk.forEach(function (m, i) {
      var rec = recs ? recs[i] : null;
      if (!rec) { rec = simMatch6(c, m[0], m[1], hash(c.seed, 'm6', c.season, L.id, w, i)); addRes6(c, L.id, rec); if (recs) recs[i] = rec; }
      out.push(rec);
    });
    return out;
  }
  function weekAll6(c) { var me = myClub(c), out = []; c.leagues.forEach(function (L) { var r = playLeagueWeek6(c, L, c.week); if (me && L.id === me.lid) out = r; }); return out; }
  /** Jornadas de descanso (liga impar): el resto juega; tú entrenas, cobras y recuperas. */
  function skipBye6(c) {
    var me = myClub(c), g = 0; if (!me) return;
    while (c.phase === 'league' && c.week < weeksOf6(c, me.lid) && !myFixture6(c) && g++ < 4) {
      msg(c, 'club', 'Jornada ' + (c.week + 1) + ': descansas', 'Esta jornada a tu equipo le toca descansar. Entrenas, cobras y recuperas (fatiga −' + BENCH_REST + ').');
      trainWeek(c); pay(c); c.fatigue = clamp((c.fatigue | 0) - BENCH_REST, 0, 100);
      weekAll6(c); c.week++;
      if (c.week === midWeek6(c)) midWindow6(c);
    }
  }
  function finishRound6(c) {
    var me = myClub(c), out = [];
    if (c.phase === 'league') {
      out = weekAll6(c);
      c.week++;
      if (c.window === 'mid') { c.offers = []; c.window = ''; }
      if (c.week === midWeek6(c)) midWindow6(c);
      skipBye6(c);
      if (c.phase === 'league' && c.week >= weeksOf6(c, me.lid)) endLeague6(c);
    } else if (c.phase === 'ko') {
      var ko = c.kos[c.koI]; out = koRound6(c, ko); advanceKO6(c);
    }
    return out;
  }
  /** Fin de la liga regular: el resto de ligas acaban su calendario y empiezan las copas (nacional e internacionales de la región). */
  function endLeague6(c) {
    c.leagues.forEach(function (L) { for (var w = c.week, W = weeksOf6(c, L.id); w < W; w++) playLeagueWeek6(c, L, w); });
    if (c.window === 'mid') { c.offers = []; c.window = ''; }
    c.kos = buildKOs6(c); c.koI = 0; c.phase = 'ko';
    var mk = myClub(c), mine = c.kos.filter(function (ko) { return ko.ids.indexOf(mk.id) >= 0; });
    if (mine.length) msg(c, 'club', 'Copas: ' + mine.map(function (ko) { return ko.name; }).join(' y '), 'Acaba la liga regular. ' + mk.name + ' juega ' + mine.map(function (ko) { return 'la ' + ko.name + ' (' + plural(ko.ids.length, 'equipo', 'equipos') + ', eliminatoria a un partido)'; }).join(' y ') + '.');
    advanceKO6(c);
  }
  function pow2(n) { var p = 1; while (p * 2 <= n && p < 8) p *= 2; return p; }
  /** Eliminatoria a un partido: hasta 8 equipos (potencia de 2), cabezas de serie por media; si te has clasificado, entras siempre. */
  function mkKO6(c, kind, name, short, cand, meId) {
    var ids = cand.filter(function (id, i) { return club(c, id) && cand.indexOf(id) === i; }), B = pow2(ids.length);
    if (ids.length < 2) return null;
    ids.sort(function (a, b) { return club(c, b).ovr - club(c, a).ovr || a - b; });
    var take = ids.slice(0, B);
    if (ids.indexOf(meId) >= 0 && take.indexOf(meId) < 0) take[B - 1] = meId;
    var ps = []; for (var i = 0; i < B / 2; i++) ps.push([take[i], take[B - 1 - i]]);
    return { kind: kind, name: name, short: short, ids: take, rounds: [ps], res: [], round: 0, champion: -1 };
  }
  /** Copas internacionales que puede jugar un club del país cc: las de su región (y su zona), la grande (rank 1: 1º y 2º de cada 1ª)
   *  y la segunda (rank 2: 3º y 4º). Guardados de antes sin rank: por orden. */
  function intlFor6(c, cc) {
    var L1 = lg6(c, cc + '1') || lg6(c, cc + '2'), reg = L1 ? L1.region : '', out = [];
    (c.intl && c.intl[reg] || []).forEach(function (cp, i) {
      var rk = cp.rank | 0 || i + 1;
      if (rk > 2 || (Array.isArray(cp.zone) && cp.zone.indexOf(cc) < 0) || out.some(function (y) { return y.rank === rk; })) return;
      out.push({ name: cp.name, short: cp.short, rank: rk, zone: Array.isArray(cp.zone) ? cp.zone : null });
    });
    return out;
  }
  function buildKOs6(c) {
    var me = myClub(c), cc = me.cc, out = [], d1 = lg6(c, cc + '1') ? table6(c, cc + '1') : [], d2 = lg6(c, cc + '2') ? table6(c, cc + '2') : [];
    var cand = (d2.length ? d1.slice(0, 6).concat(d2.slice(0, 2)) : d1.slice(0, 8)).map(function (r) { return r.id; });
    var cn = c.cups && c.cups[cc] || { name: 'Copa Nacional', short: 'COP' };
    var cup = mkKO6(c, 'cup', cn.name, cn.short || 'COP', cand, me.id); if (cup) out.push(cup);
    var reg = lg6(c, me.lid).region, comps = intlFor6(c, me.cc);
    comps.forEach(function (cp) {
      var q = [], i = cp.rank - 1, firsts = c.leagues.filter(function (L) { return L.region === reg && L.lvl === 1 && (!cp.zone || cp.zone.indexOf(L.cc) >= 0); });
      firsts.forEach(function (L) { table6(c, L.id).slice(i * 2, i * 2 + 2).forEach(function (r) { q.push(r.id); }); });
      var ko = mkKO6(c, 'intl', cp.name, cp.short, q, me.id); if (ko) out.push(ko);
    });
    return out;
  }
  /** Cierra la ronda actual de la copa en curso (simula lo que falte) y prepara la siguiente o el campeón. */
  function koRound6(c, ko) {
    var rd = ko.round, ps = ko.rounds[rd], ar = ko.res[rd] = ko.res[rd] || [], out = [];
    ps.forEach(function (m, j) { if (!ar[j]) ar[j] = simMatch6(c, m[0], m[1], hash(c.seed, 'ko6', c.season, c.koI, rd, j)); out.push(ar[j]); });
    if (ps.length === 1) { ko.champion = winnerOf(ar[0]); c.koI++; }
    else { var w = ar.map(winnerOf), nx = []; for (var i = 0; i < w.length; i += 2) nx.push([w[i], w[i + 1]]); ko.rounds.push(nx); ko.round++; }
    return out;
  }
  /** Juega solas las rondas sin ti hasta tu próximo partido de copa o el fin de temporada. */
  function advanceKO6(c) {
    for (var g = 0; c.phase === 'ko' && g < 40; g++) {
      var ko = c.kos[c.koI];
      if (!ko) { endSeason6(c); return; }
      if (myFixture6(c)) return;
      koRound6(c, ko);
    }
  }
  function reachOf6(ko, id) {
    if (ko.champion === id) return 'Campeón';
    var last = -1; ko.rounds.forEach(function (rd, i) { if (rd.some(function (m) { return m[0] === id || m[1] === id; })) last = i; });
    return last < 0 ? '' : roundName6(ko.rounds[last].length);
  }
  function nextOvrs6(c, moves) {
    var r = rng(hash(c.seed, 'ovr6', c.season)), mv = {}, out = {};
    (moves || []).forEach(function (m) { var k = club(c, m.id); if (k) mv[m.id] = lg6(c, m.to).lvl < lg6(c, k.lid).lvl ? 2 : -2; });
    c.clubs.forEach(function (k) { out[k.id] = clampI(k.ovr + (k.base - k.ovr) * 0.25 + (r() - 0.5) * 4 + (mv[k.id] || 0), 20, 99); });
    return out;
  }
  function nextLid6(c, k) { var mv = (c.pendingMoves || []).filter(function (m) { return m.id === k.id; })[0]; return mv ? mv.to : k.lid; }
  function endSeason6(c) {
    var me = myClub(c), L = lg6(c, me.lid), t = table6(c, me.lid), pos = posOf6(c, me.id), n = t.length;
    var objOk = pos <= c.objective.pos;
    c.coach = clamp(c.coach + (objOk ? 15 : -15), 0, 100); coachFloor(c);
    var champ = t[0].id === me.id, cups = c.kos.map(function (ko) { return { kind: ko.kind, name: ko.name, short: ko.short, champion: ko.champion, mine: ko.ids.indexOf(me.id) >= 0, reach: reachOf6(ko, me.id) }; });
    // ascensos y descensos dentro de cada país con dos divisiones (2 si las ligas son de 6 y 4 clubes o más; si no, 1)
    var moves = [];
    c.leagues.forEach(function (L1) {
      if (L1.lvl !== 1) return; var L2 = lg6(c, L1.cc + '2'); if (!L2) return;
      var t1 = table6(c, L1.id), t2 = table6(c, L2.id), k = t1.length >= 6 && t2.length >= 4 ? 2 : 1;
      t2.slice(0, k).forEach(function (r) { moves.push({ id: r.id, to: L1.id }); });
      t1.slice(-k).forEach(function (r) { moves.push({ id: r.id, to: L2.id }); });
    });
    var myMove = 0; moves.forEach(function (m) { if (m.id === me.id) myMove = lg6(c, m.to).lvl < L.lvl ? 1 : -1; });
    if (champ) c.trophies.push({ season: c.season, kind: 'liga', name: L.name, club: me.name });
    cups.forEach(function (x) { if (x.champion === me.id) c.trophies.push({ season: c.season, kind: x.kind === 'cup' ? 'copa' : 'intl', name: x.name, club: me.name }); });
    if (myMove > 0) c.trophies.push({ season: c.season, kind: 'ascenso', name: 'Ascenso a la ' + lg6(c, L.cc + '1').name, club: me.name });
    var an = avgNota(c), cupR = cups.filter(function (x) { return x.kind === 'cup' && x.mine; })[0], intR = cups.filter(function (x) { return x.kind === 'intl' && x.mine; })[0];
    c.history.push({ season: c.season, club: me.id, clubName: me.name, lid: me.lid, lgShort: L.short, country: L.country, pos: pos, pts: t[pos - 1].pts, objective: c.objective.text, objOk: objOk,
      cup: cupR ? cupR.reach : '—', intl: intR ? intR.name + ': ' + intR.reach : '', nota: an, played: c.stats.played, won: c.stats.won, ppts: c.stats.pts, move: myMove, ovr: playerOvr(c), lvlP: c.player.lvl });
    c.review = { season: c.season, pos: pos, n: n, lid: me.lid, objective: c.objective.text, objOk: objOk, champion: champ, cups: cups, move: myMove, nota: an, coach: c.coach, moves: moves };
    c.pendingMoves = moves; c.pendingOvr = nextOvrs6(c, moves);
    c.phase = 'off';
    c.offers = genOffers6(c, false); c.window = 'end';
    var ct = c.contract;
    if (ct && (ct.left | 0) <= 1) {
      var rl = c.coach >= 70 ? 2 : c.coach >= 45 ? 1 : 0;
      c.review.renew = { role: ROLE_LV[rl], salary: salary6(c, me, rl, nextLid6(c, me)), years: c.coach >= 45 ? 2 : 1 };
    }
    var cw = cups.filter(function (x) { return x.champion === me.id; }).map(function (x) { return x.name; });
    msg(c, 'club', 'Fin de la temporada ' + c.season + ': ' + ordn(pos), 'Objetivo ' + (objOk ? 'cumplido' : 'no cumplido') + ' (' + c.objective.text.toLowerCase() + ').' + (champ ? ' ¡Campeones de la ' + L.name + '!' : '') +
      (cw.length ? ' ¡Campeones de la ' + cw.join(' y de la ') + '!' : '') + (myMove > 0 ? ' ¡El club asciende!' : myMove < 0 ? ' El club desciende.' : '') + ' ' +
      (c.offers.length ? 'Tienes ' + plural(c.offers.length, 'oferta', 'ofertas') + ' de otros clubes' + (c.offers.some(function (x) { return x.foreign; }) ? ', también del extranjero' : '') + '.' : 'No han llegado ofertas de otros clubes.') +
      (c.review.renew ? ' Se te acaba el contrato: el club te ofrece renovar como ' + c.review.renew.role.toLowerCase() + '.' : ''));
    life(c, 'season');   // premios, títulos a fama, objetivo del patrocinador y logros
  }
  function applyMoves6(c) {
    var ov = c.pendingOvr || nextOvrs6(c, c.pendingMoves);
    (c.pendingMoves || []).forEach(function (m) { var k = club(c, m.id); if (k && lg6(c, m.to)) k.lid = m.to; });
    c.clubs.forEach(function (k) { if (ov[k.id] != null) k.ovr = ov[k.id]; });
    c.pendingMoves = null; c.pendingOvr = null;
  }
  function newSeason6(c, offer, years) {
    applyMoves6(c);
    var moved = offer && offer.club !== c.myClub, renew = c.review && c.review.renew;
    if (moved) joinClub6(c, offer, years);
    else {
      var k = myClub(c), ct = c.contract || { club: k.id, years: 1, left: 1, role: ROLE_LV[1], salary: salary6(c, k, 1), since: c.season };
      ct.left = Math.max(0, (ct.left | 0) - 1);
      if (ct.left <= 0) {
        var y = clampI(years != null ? years : renew ? renew.years : 1, 1, 3);
        c.contract = { club: k.id, years: y, left: y, role: renew ? renew.role : ct.role, salary: renew ? renew.salary : ct.salary, since: c.season + 1 };
        msg(c, 'club', 'Contrato renovado', 'Has renovado con ' + k.name + ' por ' + plural(y, 'temporada', 'temporadas') + ' como ' + c.contract.role.toLowerCase() + '.');
      } else c.contract = ct;
      c.chem = Math.round((c.chem | 0) * 0.6);   // verano: parte del equipo cambia, algo de química se pierde
    }
    c.season++; c.week = 0; c.phase = 'league'; c.kos = []; c.koI = 0; c.notes = []; c.stats = newSeasonStats(); c.offers = []; c.window = ''; c.review = null;
    c.tab = {}; c.myRes = { lid: myClub(c).lid, w: [] }; c.scouts = {};
    c.player.age = (c.player.age | 0) + 1;
    var fat0 = c.fatigue | 0; c.fatigue = 0;
    if (fat0 > FAT_FREE) msg(c, 'train', 'Vacaciones', 'El verano te ha sentado bien: llegas a la pretemporada sin fatiga (tenías ' + fat0 + ').');
    if (c.listed) { c.listed = false; msg(c, 'agent', 'Traspaso', 'Tu petición de traspaso caduca con la temporada. Si quieres salir, vuelve a pedirlo.'); }
    c.objective = objectiveFor6(c, myClub(c));
    if (moved) welcome6(c);
    else msg(c, 'obj', 'Objetivo de la temporada ' + c.season, 'El club quiere: ' + c.objective.text.toLowerCase() + '.');
    c.last = null;
    life(c, 'newSeason');   // edad, patrocinios del verano y rival
    skipBye6(c);
  }

  // ---------------------------------------------------------------- ojeadores y ofertas (también del extranjero)
  /** Tras un buen partido (nota ≥ 7,3), a veces viene a verte un ojeador de un club de una liga mejor (también de fuera): ese club
   *  tendrá +SCOUT_BONUS de interés en las ofertas de la temporada (y a mitad de temporada le basta tu nota de 7). */
  var SCOUT_BONUS = 3;
  function scoutCheck6(c, nota) {
    if (!(nota >= 7.3) || Object.keys(c.scouts || {}).length >= 4) return null;
    var me = myClub(c), L = lg6(c, me.lid), r = rng(hash(c.seed, 'scout', c.season, c.notes.length)), sc = offerScore(c);
    if (r() > 0.4) return null;
    var cand = c.clubs.filter(function (k) { var kl = lg6(c, k.lid); return k.id !== me.id && !c.scouts[k.id] && kl.strength > L.strength && k.ovr > me.ovr + 2 && k.ovr <= sc + 10; });
    if (!cand.length) return null;
    var k = pick(r, cand), kl = lg6(c, k.lid);
    c.scouts[k.id] = c.season;
    msg(c, 'agent', 'Ojeadores en la grada', 'Un ojeador de ' + k.name + ' (' + kl.name + ', ' + kl.country + ') ha venido a verte. Si sigues así, puede llegar una oferta.');
    return k.id;
  }
  /** Ofertas de mitad (mid) o de fin de temporada: clubes mejores que el tuyo de ligas como la tuya o más fuertes, también de otros
   *  países. Las ligas fuertes piden más nivel (umbral = media del club − 5, +2 si es de fuera, + (fuerza − 70) / 5 en las de élite). */
  function genOffers6(c, mid) {
    var me = myClub(c), sc = offerScore(c), r = rng(hash(c.seed, 'off6', c.season, mid ? 'mid' : 'end')), an = avgNota(c) || 0, cand = [];
    if (mid && an < (c.listed || c.broken === c.season ? 6.5 : 7)) return [];
    var po = !mid && c.pendingOvr ? c.pendingOvr : null, ovr = function (k) { return po && po[k.id] != null ? po[k.id] : k.ovr; };
    var lidOf = function (k) { return mid ? k.lid : nextLid6(c, k); }, myL = lg6(c, lidOf(me)), myO = ovr(me);
    c.clubs.forEach(function (k) {
      if (k.id === me.id) return;
      var L = lg6(c, lidOf(k)), o = ovr(k), foreign = L.cc !== me.cc, sct = !!(c.scouts && c.scouts[k.id]);
      if (o <= myO + 1 || L.strength < myL.strength - 6) return;
      if (mid && (foreign || L.strength > myL.strength + 2) && an < 7.5 && !sct) return;
      var thr = o - 5 + (foreign ? 2 : 0) + Math.max(0, (L.strength - 70) / 5);
      var it = sc - thr + (r() - 0.5) * 8 - (mid ? 3 : 0) + (sct ? SCOUT_BONUS : 0);
      if (it > 0) {
        var rl = it > ROLE_NEED[2] ? 2 : it > ROLE_NEED[1] ? 1 : 0, q = qOf6(c, k, L.id);
        cand.push({ club: k.id, lid: L.id, cc: L.cc, ovr: o, q: q, interest: round1(it), role: ROLE_LV[rl], years: 1 + Math.floor(r() * 3), salary: salary6(c, k, rl, L.id), foreign: foreign, scout: sct });
      }
    });
    // de los clubes que te quieren, los 3 más atractivos: pesa sobre todo la liga y el club (con los datos reales hay 28 países y muchos
    // clubes modestos «mejores que el tuyo»: ordenar solo por interés llenaba la bandeja de un crack con clubes de Irán o Eslovenia).
    // El interés cuenta hasta 5 (más allá ya no cambia nada) y decide el rol prometido: la élite que apenas te quiere ofrece rotación.
    var appeal = function (x) { return Math.min(5, x.interest) + 0.5 * (lg6(c, x.lid).strength - myL.strength) + 0.25 * (x.ovr - myO); };
    cand.sort(function (a, b) { return appeal(b) - appeal(a); });
    cand = cand.slice(0, 3);
    cand.forEach(function (x) { var k = club(c, x.club), o0 = k.ovr; k.ovr = x.ovr; x.objective = objectiveFor6(c, k, x.lid).text; k.ovr = o0; });
    cand.sort(function (a, b) { return lg6(c, b.lid).strength - lg6(c, a.lid).strength || b.ovr - a.ovr; });
    return cand;
  }
  function midWindow6(c) {
    var o = genOffers6(c, true);
    c.offers = o; c.window = o.length ? 'mid' : '';
    if (o.length) msg(c, 'offer', 'Ventana de fichajes: ' + plural(o.length, 'oferta', 'ofertas'), 'Tu agente ha recibido ' + plural(o.length, 'oferta', 'ofertas') + ' a mitad de temporada' + (o.some(function (x) { return x.foreign; }) ? ', también del extranjero' : '') + '. Caducan al jugar o simular el siguiente partido. Míralas en Club › Ofertas.');
    var pos = posOf6(c, c.myClub), okp = pos <= c.objective.pos;
    msg(c, 'obj', 'Mitad de temporada: ' + ordn(pos), okp ? 'Vamos ' + ordn(pos) + ' y el objetivo (' + c.objective.text.toLowerCase() + ') está a nuestro alcance. No bajemos el ritmo.'
      : 'Vamos ' + ordn(pos) + ' y así no llegamos al objetivo (' + c.objective.text.toLowerCase() + '). Necesito más de ti en la segunda vuelta.');
  }

  // ---------------------------------------------------------------- cerrar un partido tuyo (jugado, simulado o en el banquillo)
  function recordMine6(c, f, sets, setScores) {
    var me = myClub(c), mine = f.home === me.id, s = mine ? sets : [sets[1], sets[0]], sc = setScores.map(function (x) { return mine ? x.slice() : [x[1], x[0]]; });
    var rec = { a: f.home, b: f.away, s: s, sc: sc, mine: 1 };
    if (f.kind === 'league') { if (!c.myRes || c.myRes.lid !== me.lid) c.myRes = { lid: me.lid, w: [] }; (c.myRes.w[f.week] = c.myRes.w[f.week] || [])[f.i] = rec; addRes6(c, me.lid, rec); }
    else { var ko = c.kos[f.ko]; (ko.res[f.round] = ko.res[f.round] || [])[f.i] = rec; }
    return rec;
  }
  function labelOf6(c, f) { if (f.kind === 'league') return 'Jornada ' + (f.week + 1); var ko = c.kos[f.ko]; return ko.name + ' · ' + roundName6(ko.rounds[f.round].length); }
  function closeMine6(c, f, res, me, sim, extra) {
    var win = res.sets[0] > res.sets[1], mk = myClub(c), L = lg6(c, mk.lid), rival = club(c, f.home === c.myClub ? f.away : f.home), nota = me.nota;
    var mpts = (me.kills || 0) + (me.aces || 0) + (me.blocks || 0);
    var xp = Math.round((40 + 22 * nota + (win ? 40 : 0) + 6 * Math.min(mpts, 10)) * xpMul6(L) * (sim ? 0.5 : 1));
    var lv = addXP(c.player, xp), ct0 = coachText(c.coach);
    c.coach = clamp(Math.round(c.coach + (nota - 6.2) * 2.5 + (win ? 1 : -1)), 0, 100);
    coachFloor(c); pay(c); promoteCheck6(c);
    if (coachText(c.coach) !== ct0) msg(c, 'coach', 'El entrenador: «' + coachText(c.coach) + '»', COACH_LINE[coachText(c.coach)] || '');
    c.chem = clamp((c.chem | 0) + (sim ? 3 : 5), 0, 100);
    var tr = trainWeek(c);
    [c.stats, c.career].forEach(function (x) {
      x.played++; if (win) x.won++; if (sim) x.sim++;
      x.pts += mpts; x.kills += me.kills || 0; x.aces += me.aces || 0; x.blocks += me.blocks || 0; x.assists += me.assists || 0; x.digs += me.digs || 0; x.errors += me.errors || 0;
    });
    c.notes.push({ nota: nota, win: win ? 1 : 0, sim: sim ? 1 : 0, kind: f.kind, wk: f.kind === 'league' ? f.week : f.round, rival: rival.id, s: res.sets.slice() });
    var scout = scoutCheck6(c, nota);
    var label = labelOf6(c, f), phase0 = c.phase, season0 = c.season;
    recordMine6(c, f, res.sets, res.setScores);
    var round = finishRound6(c);
    var sum = { mode: 'hall', season: season0, phase: phase0, label: label, rival: rival.id, rivalName: rival.name, win: win, sets: res.sets.slice(), setScores: res.setScores.map(function (x) { return x.slice(); }),
      sim: !!sim, nota: nota, me: me, xp: xp, lvlUp: lv.lvlUp, lvl: lv.lvl, ptsGained: lv.pts, badges: extra && extra.badges || [], coach: c.coach, train: tr, chem: c.chem, scout: scout,
      round: f.kind === 'league' ? round.map(function (m) { return { a: m.a, b: m.b, s: m.s }; }) : [], offers: c.window === 'mid' ? c.offers.length : 0, review: phase0 !== c.phase && c.phase === 'off' };
    life(c, 'match', sum, f);   // reto, fama, patrocinio, servicios, rival, decisión y logros (sum.life)
    c.last = sum;
    save6(c);
    return sum;
  }
  function promoteCheck6(c) {
    if (!c.contract || roleIdx(c) !== 0 || c.coach < PROMOTE_AT) return;
    var k = myClub(c), s = Math.max(c.contract.salary | 0, salary6(c, k, 1));
    c.contract.role = ROLE_LV[1]; c.contract.salary = s;
    msg(c, 'coach', 'Te has ganado la titularidad', 'Ya no eres de la rotación: desde hoy eres titular, y el club te sube el sueldo a ' + s + ' € al mes.');
  }
  /** Insignias de un partido sin contadores (simulado, o tu puesto fuera de los huecos 0-1 de badges.js): partidos y victorias. */
  function simBadges6(c, win) {
    var out = [], Bd = B(); if (!(Bd && Bd.levelFor && Bd.LIST)) return out;
    var a = c.player; a.bp = a.bp || {}; a.bd = a.bd || {}; a.beq = a.beq || [];
    a.bp.motor = (a.bp.motor | 0) + 1; if (win) a.bp.lider = (a.bp.lider | 0) + 1;
    ['motor', 'lider'].forEach(function (id) {
      var prev = (a.bd[id] | 0), lv = Bd.levelFor(id, a.bp[id] | 0);
      if (lv > prev) { a.bd[id] = lv; var eq = prev === 0 && Bd.equip ? Bd.equip(a, id) : a.beq.indexOf(id) >= 0; out.push({ slot: 0, num: a.num, id: id, name: Bd.BY[id].name, lvl: lv, prev: prev, tier: Bd.TIERS[lv], eq: eq }); }
    });
    return out;
  }
  function matchDone6(r, stats, g) {
    var c = load6(); if (!c || !r || !r.sets) return null;
    var f = myFixture6(c); if (!f) return null;
    var m = M && (!g || M.g === g) ? M : newM(g), me = stats || m.p[0];
    var rallies = m.rallies || (r.setScores || []).reduce(function (s, x) { return s + x[0] + x[1]; }, 0);
    var res = { sets: [r.sets[0] | 0, r.sets[1] | 0], setScores: (r.setScores || []).map(function (x) { return [x[0] | 0, x[1] | 0]; }) }, win = res.sets[0] > res.sets[1];
    var mine = { kills: me.kills | 0, aces: me.aces | 0, blocks: me.blocks | 0, assists: me.assists | 0, digs: me.digs | 0, errors: me.errors | 0, recvP: me.recvP | 0, perfect: me.perfect | 0, good: me.good | 0, poor: me.poor | 0 };
    mine.nota = rating(mine, { win: win, sets: res.sets }, rallies, RATE6[ctrlRole6(c)] || RATE6.OH);
    var badges = [];
    try {
      var ix = g && g.teams && g.ctrl ? g.teams[0].indexOf(g.ctrl) : -1;
      if (B() && B().endMatch && g && (ix === 0 || ix === 1)) { var ath = [null, null]; ath[ix] = c.player; badges = B().endMatch(g, win, ath) || []; }
      else badges = simBadges6(c, win);
    } catch (e) { badges = []; }
    M = null;
    return closeMine6(c, f, res, mine, false, { badges: badges });
  }
  function simulateNext6(c) {
    c = c || load6(); if (!c) return null;
    var f = myFixture6(c); if (!f) return null;
    var n = next6(c); if (n.bench) return benchNext6(c);
    var r = rng(hash(c.seed, 'mine6', c.season, c.phase, f.week, f.round, f.ko, c.notes.length)), to = teamOvr6(c);
    var q = quickSim(to + (r() - 0.5) * 4, n.ovrRival + (r() - 0.5) * 4, r, c.points), win = q.sets[0] > q.sets[1], role = ctrlRole6(c);
    var tot = q.setScores.reduce(function (s, x) { return s + x[0]; }, 0), sh = (SIM_SHARE6[role] || 0.12) * (0.8 + 0.4 * clamp((playerOvr(c) - n.me.ovr + 10) / 20, 0, 1));
    var mp = Math.round(tot * sh), kills = Math.round(mp * (role === 'MB' ? 0.55 : 0.75)), aces = Math.round(mp * 0.1), blocks = Math.max(0, mp - kills - aces);
    var me = { kills: kills, aces: aces, blocks: blocks, assists: Math.round(tot * (role === 'S' ? 0.45 : 0.03)), digs: Math.round(2 + r() * (role === 'L' || role === 'OH' ? 8 : 4)), errors: Math.round(1 + r() * 3), recvP: 0, perfect: 0, good: 0, poor: 0 };
    me.nota = round1(clamp(6.1 + (to - n.ovrRival) * 0.04 + (win ? 0.6 : -0.6) + (r() - 0.5) * 1.6, 3, 9.5));
    return closeMine6(c, f, { sets: q.sets, setScores: q.setScores }, me, true, { badges: simBadges6(c, win) });
  }
  function benchNext6(c) {
    c = c || load6(); if (!c) return null;
    var f = myFixture6(c), n = f && next6(c); if (!n || !n.bench) return null;
    var r = rng(hash(c.seed, 'bench6', c.season, f.week)), me = myClub(c);
    var q = quickSim(me.ovr - 1 + (r() - 0.5) * 4, n.ovrRival + (r() - 0.5) * 4, r, c.points), win = q.sets[0] > q.sets[1];
    var rl = roleIdx(c), why = benchWhy(c), first = !(c.stats.bench | 0);
    c.benchWk = wkKey6(c); pay(c);
    var tr = trainWeek(c);
    c.fatigue = clamp((c.fatigue | 0) - BENCH_REST, 0, 100);
    c.stats.bench = (c.stats.bench | 0) + 1; c.career.bench = (c.career.bench | 0) + 1;
    if (rl === 1 && c.broken !== c.season) {
      c.broken = c.season;
      msg(c, 'agent', 'Promesa incumplida', me.name + ' te fichó como titular y te ha dejado en el banquillo. Hasta final de temporada puedes irte sin pegas aunque tengas contrato, y los clubes lo saben: llegarán más ofertas (a mitad de temporada basta con una nota media de 6,5).');
    } else if (first) msg(c, 'coach', 'Esta jornada, al banquillo', why + ' Juega otro ' + POS6[c.player.roleKey].name.toLowerCase() + ' de la plantilla. Sube tus notas y volverás a jugar.');
    var rival = club(c, f.home === me.id ? f.away : f.home), phase0 = c.phase, season0 = c.season, label = labelOf6(c, f);
    recordMine6(c, f, q.sets, q.setScores);
    var round = finishRound6(c);
    var sum = { mode: 'hall', season: season0, phase: phase0, label: label, rival: rival.id, rivalName: rival.name, win: win, sets: q.sets.slice(), setScores: q.setScores.map(function (x) { return x.slice(); }),
      sim: true, bench: true, why: why, sub: '', nota: null, me: { kills: 0, aces: 0, blocks: 0, assists: 0, digs: 0, errors: 0 }, xp: 0, lvlUp: 0, lvl: c.player.lvl, ptsGained: 0, badges: [],
      coach: c.coach, train: tr, chem: c.chem | 0, round: round.map(function (m) { return { a: m.a, b: m.b, s: m.s }; }), offers: c.window === 'mid' ? c.offers.length : 0, review: phase0 !== c.phase && c.phase === 'off' };
    life(c, 'match', sum, f);   // en el banquillo: patrocinio y servicios (sin reto)
    c.last = sum; save6(c);
    return sum;
  }

  // ---------------------------------------------------------------- acciones de gestión (pista)
  function acceptOffer6(i, years) {
    var c = load6(); if (!c || !c.offers || !c.offers[i]) return false;
    var o = c.offers[i];
    if (c.phase === 'pick') {
      if (o.trial) {
        var pass = rng(hash(c.seed, 'trial6', o.club, c.pick.round))() < o.chance;
        if (!pass) {
          c.offers.splice(i, 1); c.pick.fail = o.club;
          msg(c, 'agent', 'Prueba no superada', club(c, o.club).name + ' te ha visto en la prueba y prefiere esperar. Aún tienes ' + plural(c.offers.length, 'oferta', 'ofertas') + '.');
          if (!c.offers.length) c.offers = genStartOffers6(c, ++c.pick.round);
          save6(c); return false;
        }
        msg(c, 'agent', '¡Prueba superada!', club(c, o.club).name + ' te ficha tras la prueba. Empiezas en la ' + lg6(c, o.lid).name + ', una categoría por encima.');
      }
      joinClub6(c, o, years); save6(c); return true;
    }
    o.early = earlyExit(c);
    if (o.early) msg(c, 'agent', 'Salida con contrato', club(c, c.myClub).name + ' no quería dejarte ir: aún te quedaban ' + plural((c.contract.left | 0) - (c.phase === 'off' ? 1 : 0), 'temporada', 'temporadas') + ' de contrato. Llegas a ' + club(c, o.club).name + ' con algo menos de confianza del entrenador.');
    if (o.foreign) { var L = lg6(c, o.lid); msg(c, 'agent', 'Fichaje internacional', 'Te vas a ' + L.country + ': ' + club(c, o.club).name + ', de la ' + L.name + '. Nueva liga, nuevo idioma y rivales más fuertes.'); }
    if (c.window === 'end' && c.phase === 'off') { newSeason6(c, o, years); save6(c); return true; }
    if (c.window === 'mid') { joinClub6(c, o, years); c.last = null; save6(c); return true; }
    return false;
  }
  function stay6(years) {
    var c = load6(); if (!c || c.phase === 'pick') return false;
    if (c.phase === 'off') newSeason6(c, null, years); else { c.offers = []; c.window = ''; }
    save6(c); return true;
  }
  function negotiate6(i) {
    var c = load6(); if (!c || !c.offers || !c.offers[i]) return '';
    var o = c.offers[i], rl = ROLE_LV.indexOf(o.role);
    if (o.firm || o.trial || rl >= 2) return '';
    var r = rng(hash(c.seed, 'neg6', c.season, c.phase, o.club, c.week)), ok = o.interest + r() * 4 > ROLE_NEED[rl + 1], k = club(c, o.club);
    if (ok) { o.role = ROLE_LV[rl + 1]; o.salary = salary6(c, k, rl + 1, o.lid); o.interest = round1(o.interest - 2); } else o.negNo = true;
    o.firm = true;
    msg(c, 'offer', ok ? 'Negociación: aceptada' : 'Negociación: rechazada', ok ? k.name + ' acepta: firmarías como ' + o.role.toLowerCase() + ' (' + o.salary + ' € al mes).' : k.name + ' no mejora su oferta y no le ha gustado que pidieras más: si firmas, el entrenador empezará con menos confianza.');
    save6(c); return ok ? 'ok' : 'no';
  }
  function rejectAll6() {
    var c = load6(); if (!c || c.phase !== 'pick') return false;
    c.pick.round = Math.min(9, c.pick.round + 1); c.pick.more = false;
    c.offers = genStartOffers6(c, c.pick.round);
    msg(c, 'agent', 'Nuevas ofertas', 'Has rechazado todas las ofertas. Han llegado ' + c.offers.length + ' más, de clubes más modestos.');
    save6(c); return true;
  }
  function moreTime6() {
    var c = load6(); if (!c || c.phase !== 'pick' || c.pick.more || !c.offers.length) return null;
    var r = rng(hash(c.seed, 'more6', c.pick.round)), used = {}, lo = -1;
    c.offers.forEach(function (x, i) { used[x.club] = 1; if (!x.trial && (lo < 0 || x.interest < c.offers[lo].interest)) lo = i; });
    var low = lg6(c, c.cc + '2') ? c.cc + '2' : c.cc + '1';
    var cand = lgClubs6(c, low).filter(function (k) { return !used[k.id]; }).sort(function (a, b) { return a.ovr - b.ovr; }).slice(0, 6);
    if (!cand.length || lo < 0) return null;
    var avg = cand.reduce(function (s, k) { return s + k.ovr; }, 0) / cand.length, gone = c.offers.splice(lo, 1)[0], nk = pick(r, cand);
    c.offers.push(startOffer6(c, nk, avg, c.pick.round, r, false)); c.pick.more = true;
    c.offers.sort(function (a, b) { return (a.trial ? 1 : 0) - (b.trial ? 1 : 0) || b.ovr - a.ovr; });
    msg(c, 'agent', 'Una oferta menos, una más', club(c, gone.club).name + ' no quiere esperar y retira su oferta. A cambio ha llamado ' + nk.name + '.');
    save6(c); return { gone: gone.club, added: nk.id };
  }
  function physioCost6(c) { var k = c && myClub(c), L = k && lg6(c, k.lid); return Math.round(salBase6(L ? L.strength : 50) * 0.6 / 50) * 50; }
  function physio6() {
    var c = load6(); if (!c || c.phase === 'pick' || c.phase === 'off' || !c.contract) return '';
    if (c.physioWk === wkKey6(c)) return 'done';
    if ((c.fatigue | 0) <= 0) return 'none';
    var cost = physioCost6(c); if ((+c.money || 0) < cost) return 'money';
    c.money = Math.round(c.money - cost); c.fatigue = clamp((c.fatigue | 0) - PHYSIO_FAT, 0, 100); c.physioWk = wkKey6(c);
    save6(c); return 'ok';
  }
  /** Cambiar de puesto (p. ej. cuando sim añada colocador, opuesto o central). Tus atributos no cambian: el perfil es el de origen. */
  function setPosition6(k) {
    var c = load6(); if (!c || !POS6[k] || positions6().indexOf(k) < 0 || c.player.roleKey === k) return false;
    c.player.roleKey = k; c.player.role = POS6[k].name;
    msg(c, 'coach', 'Nuevo puesto: ' + POS6[k].name.toLowerCase(), 'De acuerdo: desde la próxima jornada juegas de ' + POS6[k].name.toLowerCase() + '. Tus atributos siguen siendo los tuyos; entrena lo que pide el puesto.');
    save6(c); return true;
  }
  function withC6(fn) { return function () { var c = load6(); if (!c) return false; var r = fn.apply(null, [c].concat([].slice.call(arguments))); if (r) save6(c); return r; }; }
  var setTraining6 = withC6(function (c, k) { if (!TRAIN[k] || c.train === k) return false; c.train = k; return true; });
  var requestTransfer6 = withC6(function (c, on) {
    if (c.phase === 'pick' || !!on === !!c.listed) return false;
    c.listed = !!on;
    if (on) { c.coach = clamp(c.coach - LISTED_COACH, 0, 100); msg(c, 'coach', 'Has pedido el traspaso', 'Entiendo que quieras jugar más arriba, pero no me gusta. Tu agente ya avisa a los clubes, también a los de fuera: llegarán más ofertas (a mitad de temporada basta con una nota media de 6,5).'); }
    else { c.coach = clamp(c.coach + 3, 0, 100); msg(c, 'coach', 'Sigues con nosotros', 'Me alegra que retires la petición de traspaso. A trabajar.'); }
    return true;
  });
  var bump6 = withC6(function (c, k) {
    var a = c.player, p = P();
    if (p && p.athleteBump) return p.athleteBump(a, k, 1);
    var v = a.st[k], ok = KEYS.indexOf(k) >= 0 && v < 99 && a.pts >= costOf(v); if (ok) { a.pts -= costOf(v); a.st[k] = v + 1; } return ok;
  });
  var toggleBadge6 = withC6(function (c, id) { return B() && B().toggle ? B().toggle(c.player, id) : ''; });
  function unread6(c) { c = c || load6(); return c && c.inbox ? c.inbox.filter(function (m) { return !m.r; }).length : 0; }
  var readMsg6 = withC6(function (c, id) { var ok = false; c.inbox.forEach(function (m) { if (m.id === id && !m.r) { m.r = 1; ok = true; } }); return ok; });
  var readAll6 = withC6(function (c) { var n = 0; c.inbox.forEach(function (m) { if (!m.r) { m.r = 1; n++; } }); return n; });

  var HALL = {
    MODE: 'hall', VER: VER6, STORE: KEY6, START_OVR: START6, POS: POS6, POINTS: POINTS6, WEEKS: 99, DIFF_AT: DIFF6_AT, SOFT: SOFT6, RATE6: RATE6, DOUBLE_MAX: DOUBLE_MAX, SCOUT_BONUS: SCOUT_BONUS,
    exists: function () { return !!load6(); }, get: function () { return load6(); }, load: load6, lost: function () { return lost6; }, save: save6, create: create6, abandon: abandon6,
    positions: positions6, countries: countries6, available: function () { return countries6().length > 0; }, simRoles: simRoles6, ctrlRole: ctrlRole6, setPosition: setPosition6,
    league: function (lid, c) { return lg6(c || load6(), lid); }, intlFor: intlFor6, regionOf: regionOf6, _compKind: compKind6, leagueClubs: function (c, lid) { return lgClubs6(c, lid); }, weeksOf: weeksOf6, midWeek: midWeek6, sched: sched6, roundName: roundName6,
    clubOvr: function (k) { return k ? k.ovr : 0; }, table: table6, posOf: posOf6, clubInfo: clubInfo6, objectiveFor: objectiveFor6, roster: roster6, salary: salary6, xpMul: xpMul6, ref: ref6,
    next: next6, matchSetup: matchSetup6, matchDone: matchDone6, simulateNext: simulateNext6, benchNext: benchNext6, teamOvr: teamOvr6,
    difficultyFor: difficultyFor6, diffLabel: diffLabel6, softFor: soft6, chemBonus: chemBonus6, physio: physio6, physioCost: physioCost6,
    acceptOffer: acceptOffer6, stay: stay6, negotiate: negotiate6, rejectAll: rejectAll6, moreTime: moreTime6, changeMate: function () { return ''; },
    setTraining: setTraining6, requestTransfer: requestTransfer6, bump: bump6, toggleBadge: toggleBadge6, unread: unread6, readMsg: readMsg6, readAll: readAll6,
    _genOffers: genOffers6, _scout: scoutCheck6, _wkKey: wkKey6, _name: function (r) { return pick(r, FIRST) + ' ' + pick(r, LAST); },   // (vida de la Carrera)
    _reset: function () { cur6 = null; M = null; }, _buildWorld: buildWorld6, _endLeague: endLeague6
  };

  var BEACH = {
    VER: VER, STORE: KEY, KEYS: KEYS, LEAGUES: LEAGUES, ROLES: ROLES, REF: REF, POINTS: POINTS, WEEKS: WEEKS, MID_WEEK: MID_WEEK, START_OVR: START_OVR, PTS_LVL: PTS_LVL,
    // vóley playa (v3) y compañero con nivel propio
    VENUE: VENUE, PTS: PTS, PTS3: PTS3, MATE_OFF: MATE_OFF, MATE_RENEW: MATE_RENEW, FORM_MAX: FORM_MAX, FORM_SIM: FORM_SIM,
    lname: lname, toL: toL, mateProfile: mateProfile, formText: formText, _newMate: newMate, _mateOff: mateOff, _beachify: beachify,
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
    // escalón Normal suave, rol prometido y sueldo (11-nov-2026)
    SOFT: SOFT, softFor: softFor, diffLabel: diffLabel, MATE_CAP: MATE_CAP, mateFormCap: mateFormCap, BENCH: BENCH, PROMOTE_AT: PROMOTE_AT, ROLE_FLOOR: ROLE_FLOOR, ROLE_HINT: ROLE_HINT,
    BROKEN_BONUS: BROKEN_BONUS, PAY_WEEK: PAY_WEEK, PHYSIO_FAT: PHYSIO_FAT, benchNext: benchNext, benchWhy: benchWhy, BENCH_REST: BENCH_REST, physio: physio, physioCost: physioCost, roleIdx: roleIdx, _beachTrophies: beachTrophies,
    // vida de la Carrera (career-life.js)
    _msg: msg, _addXP: addXP, _wkKey: wkKey,
    // dificultad de la Carrera (12-nov-2026)
    CDIFF: CDIFF, CDIFF_KEYS: CDIFF_KEYS, STEPS: STEPS, DIFF_MSG: DIFF_MSG, diffOf: diffOf, rivalAI: rivalAI, attrOf: attrOf, baseStep: baseStep, seasonDiff: seasonDiff, midNota: midNota, setDifficulty: setDifficulty,
    _M: function () { return M; }, _reset: function () { cur = null; M = null; }, _genOffers: genOffers, _rng: rng, _hash: hash
  };

  // =====================================================================================================================
  // VB.Career: fachada de las dos Carreras. Cada clave lleva a la Carrera ACTIVA ('beach' | 'hall'): las que la pista redefine van a
  // HALL; el resto (constantes y utilidades comunes) a la de playa. Sin nada guardado (o con solo la de playa) la activa es la playa:
  // careertest, los guardados de playa y su migración no notan nada. VB.Career.beach / .hall dan acceso directo a cada una.
  function modeStored() { try { var s = store(), v = s && s.getItem(MODE_KEY); return v === 'hall' || v === 'beach' ? v : ''; } catch (e) { return ''; } }
  /** Carrera activa: la elegida la última vez; si esa no existe y la otra sí, la otra. Por defecto, la playa. */
  function mode() {
    var m = modeStored() || 'beach';
    if (m === 'hall' && !load6() && load()) return 'beach';
    if (m === 'beach' && !load() && load6()) return 'hall';
    return m;
  }
  function setMode(m) { m = m === 'hall' ? 'hall' : 'beach'; try { var s = store(); if (s) s.setItem(MODE_KEY, m); } catch (e) { } return m; }
  function hasMode(m) { return m === 'hall' ? !!load6() : !!load(); }
  function eng() { return mode() === 'hall' ? HALL : BEACH; }
  var F = {
    beach: BEACH, hall: HALL, mode: mode, setMode: setMode, has: hasMode, POS6: POS6,
    /** Crear: o.mode 'hall' → Carrera de pista (y pasa a ser la activa); 'beach' → la de playa; sin mode, la activa. */
    create: function (o) {
      var m = o && (o.mode === 'hall' || o.mode === 'beach') ? o.mode : mode();
      var c = (m === 'hall' ? HALL : BEACH).create(o);
      if (c) setMode(m);
      return c;
    },
    /** Al cerrar un partido: el de la Carrera a la que pertenece (g.career.mode), aunque la activa hubiera cambiado. */
    matchDone: function (r, st, g) { return (g && g.career && g.career.mode === 'hall' ? HALL : g && g.career ? BEACH : eng()).matchDone(r, st, g); },
    ingest: ingest, abortMatch: abortMatch, owns: owns,
    _reset: function () { cur = null; cur6 = null; M = null; }
  };
  var C = {};
  Object.keys(BEACH).concat(Object.keys(HALL)).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(F, k) || Object.prototype.hasOwnProperty.call(C, k)) return;
    Object.defineProperty(C, k, { enumerable: true, configurable: true, get: function () { var e = eng(); return k in e ? e[k] : BEACH[k]; } });
  });
  Object.keys(F).forEach(function (k) { C[k] = F[k]; });
  VB.Career = C;
})();
