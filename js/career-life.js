/* MAKE THE CUT — js/career-life.js (owner: carrera)
 * «Vida» de la Carrera (VB.CareerLife): todo lo que pasa alrededor de los partidos para que la Carrera enganche.
 *  - Reto de la jornada: un objetivo por partido (aces, remates, nota, ganar sin ceder un set…) con premio. Solo jugando.
 *  - Fama: seguidores y escalones («Desconocido» → «Leyenda viva»). Suben con las notas, los títulos, los retos y los premios.
 *  - Patrocinadores INVENTADOS (gag constante de vóley, nunca marcas reales): pagan por jornada y dan un bonus por objetivo.
 *  - Decisiones: ruedas de prensa, fiestas, clínics, piques con tu rival… con efecto en entrenador, química, fama y fatiga.
 *  - Rival personal: un jugador de tu liga con el que llevas el cara a cara; los partidos contra su club son «duelo».
 *  - Tienda: material (bonus pequeño en el partido, como la química) y servicios por jornada (entrenador personal, nutricionista,
 *    agente estrella). Por fin hay en qué gastar el sueldo.
 *  - Premios de la temporada (MVP, máximo anotador, mejor sacador, muro, defensa, revelación) y logros de carrera con recompensa.
 *  - Legado: puntuación de leyenda, declive físico desde los 32 y retirada (desde los 30) al Salón de la Fama del dispositivo.
 * Sin DOM (se carga en node: tools/careertest.js). Guarda en c.life dentro de la carrera (sin cambiar su versión: todo tiene valor
 * por defecto y se crea al vuelo con ensure()). career.js llama a hook(c, tipo, …) en sus puntos clave; si este fichero no está,
 * la Carrera funciona igual que antes.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var VB = root.VB = root.VB || {};
  function K() { return VB.Career; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round1(v) { return Math.round(v * 10) / 10; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function eur(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €'; }
  function num(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function rngOf() { var a = Array.prototype.slice.call(arguments); return K()._rng(K()._hash.apply(null, a)); }
  function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }
  function hall(c) { return !!(c && c.mode === 'hall'); }
  /** Nivel 0-4 de la liga de tu club (en la pista, si existe, su nivel; si no, 0). */
  function lvlOf(c) { var k = c && c.myClub >= 0 && K().myClub(c); return k ? clamp(k.lvl | 0, 0, 4) : 0; }
  function leagueOf(c) { var k = K().myClub(c); return k ? K().league(k.lid != null ? k.lid : k.lvl) : K().league(0); }

  var LV_MULT = [1, 2, 4, 8, 15];   // seguidores por liga: jugar en el Circuito Mundial se ve mucho más
  var SALARY = [600, 1500, 4000, 9000, 20000];

  // ------------------------------------------------------------------ estado
  function ensure(c) {
    if (!c) return null;
    var l = c.life;
    if (!l || typeof l !== 'object') l = c.life = {};
    if (!(l.fame >= 0)) l.fame = 0;
    if (!(l.fameMax >= 0)) l.fameMax = l.fame;
    if (!l.gear || typeof l.gear !== 'object') l.gear = {};
    if (!l.svc || typeof l.svc !== 'object') l.svc = {};
    if (!l.ach || typeof l.ach !== 'object') l.ach = {};
    if (!Array.isArray(l.awards)) l.awards = [];
    if (!Array.isArray(l.spOffers)) l.spOffers = [];
    if (!Array.isArray(l.log)) l.log = [];
    ['chDone', 'chTried', 'streak', 'best', 'bestNota', 'evN', 'duelW', 'duelL', 'hurt', 'spent', 'earned'].forEach(function (k) { if (!(+l[k] >= 0)) l[k] = 0; });
    if (l.sponsor && typeof l.sponsor !== 'object') l.sponsor = null;
    if (l.ev && (typeof l.ev !== 'object' || !EVENTS[l.ev.key])) l.ev = null;
    return l;
  }

  // ------------------------------------------------------------------ fama
  var TIERS = [[0, 'Desconocido'], [500, 'Promesa local'], [2000, 'Conocido en el circuito'], [7000, 'Figura'], [20000, 'Estrella'], [50000, 'Ídolo'], [120000, 'Leyenda viva']];
  function tierIdx(f) { var i = 0; for (var j = 0; j < TIERS.length; j++) if (f >= TIERS[j][0]) i = j; return i; }
  function tierOf(c) { var l = ensure(c); return tierIdx(l.fame); }
  function tierName(i) { return TIERS[clamp(i | 0, 0, TIERS.length - 1)][1]; }
  /** Progreso hacia el siguiente escalón: {i, name, next, from, to, p 0..1}. */
  function fameInfo(c) {
    var l = ensure(c), i = tierIdx(l.fame), nx = TIERS[i + 1];
    return { fans: Math.round(l.fame), i: i, name: TIERS[i][1], next: nx ? nx[1] : '', from: TIERS[i][0], to: nx ? nx[0] : TIERS[i][0], p: nx ? clamp((l.fame - TIERS[i][0]) / (nx[0] - TIERS[i][0]), 0, 1) : 1 };
  }
  /** Suma (o resta) seguidores; avisa al subir de escalón y abre patrocinios. Devuelve lo sumado. */
  function addFame(c, n, why) {
    var l = ensure(c), t0 = tierIdx(l.fame);
    n = Math.round(n);
    l.fame = Math.max(0, l.fame + n); l.fameMax = Math.max(l.fameMax, l.fame);
    var t1 = tierIdx(l.fame);
    if (t1 > t0 && l.fame >= l.fameMax) {
      K()._msg(c, 'fans', 'Fama: «' + tierName(t1) + '»', 'Ya te siguen ' + num(l.fame) + ' personas. ' + (FAME_LINE[t1] || '') + (t1 >= 1 ? ' Los patrocinadores empiezan a llamar a tu agente.' : ''));
      if (t1 >= 1) sponsorOffers(c, 'tier');
    }
    return n;
  }
  var FAME_LINE = ['', 'En tu barrio ya te paran por la calle para pedirte una foto.', 'Los comentaristas del circuito saben pronunciar tu apellido. Casi siempre.',
    'Las gradas empiezan a llevar tu dorsal pintado en la cara.', 'Sales en los resúmenes de la tele y tus jugadas dan la vuelta a las redes.',
    'Hay peques que se cortan el pelo como tú. Tu nombre llena gradas.', 'Ya no eres un jugador: eres una referencia. Dentro de veinte años aún hablarán de ti.'];
  /** Interés extra de los clubes por tu fama (career.js offerScore): hasta +3. */
  function offerBonus(c) { var l = c && c.life; if (!l) return 0; return round1(Math.min(3, tierIdx(l.fame || 0) * 0.5) + (l.svc && l.svc.agent ? 2 : 0)); }

  // ------------------------------------------------------------------ reto de la jornada
  // Umbrales medidos con el autopiloto (≈ jugador bueno) en partidos de Carrera de playa (12-nov-2026): remates 10-18, aces 2-5,
  // bloqueos 0,5-3, defensas 5-20, asistencias 10-12, errores ~4 y nota 6,5-7,8 por partido. Objetivo: el autopiloto cumple ~50 %
  // (una persona media, algo menos): un reto tiene que costar.
  var CH = {
    kills: { n: [13, 15, 16, 17, 18], txt: 'Consigue {n} remates punto', stat: 'kills' },
    aces: { n: [5, 4, 4, 3, 3], txt: 'Haz {n} aces', stat: 'aces' },
    blocks: { n: [2, 3, 3, 3, 4], txt: 'Haz {n} bloqueos punto', stat: 'blocks', roles: ['atk', 'uni', 'MB', 'OPP', 'OH'] },
    digs: { n: [8, 12, 15, 18, 20], txt: 'Saca {n} defensas', stat: 'digs', roles: ['cr', 'uni', 'L', 'OH', 'S'] },
    assists: { n: [12, 13, 13, 14, 14], txt: 'Da {n} asistencias', stat: 'assists', roles: ['cr', 'S'] },
    nota: { n: [8.1, 7.9, 7.6, 7.4, 7.2], txt: 'Saca una nota de {n} o más' },
    clean: { txt: 'Gana sin ceder ningún set', minL: 1 },   // (en la Regional, contra la IA Fácil, casi siempre)
    tidy: { n: [1, 2, 2, 2, 2], txt: 'Gana con {n} errores o menos' },
    win: { txt: 'Gana el duelo' }
  };
  var CH_KEYS = ['kills', 'aces', 'blocks', 'digs', 'assists', 'nota', 'clean', 'tidy'];
  function chKey(season, phase, f) { return (season | 0) * 1000 + (phase === 'cup' ? 500 + (f && f.round | 0) : (f && f.week | 0)); }
  /** Reto de un partido (determinista por semilla y jornada). f = {week, round}, phase, season, rivalId. */
  function challengeAt(c, season, phase, f, rivalId) {
    var l = ensure(c), L = lvlOf(c), key = chKey(season, phase, f), r = rngOf(c.seed, 'reto', key);
    var role = (c.player && c.player.roleKey) || (c.player && c.player.pos) || 'uni';
    var duel = !!(l.rival && l.rival.club === rivalId);
    var ks = CH_KEYS.filter(function (k) { var d = CH[k]; return (!d.roles || d.roles.indexOf(role) >= 0) && !(d.minL > L); });
    var id = duel ? (r() < 0.5 ? 'win' : pick(r, ks)) : pick(r, ks);
    var d = CH[id], n = d.n ? d.n[L] : 0;
    var mult = (duel ? 2 : 1) * (phase === 'cup' ? 1.5 : 1);
    var Lg = K().league(L);
    return { key: key, id: id, n: n, duel: duel, txt: d.txt.replace('{n}', String(n).replace('.', ',')),
      fans: Math.round(60 * LV_MULT[L] * mult), xp: Math.round(45 * (Lg.xp || 1) * mult), money: Math.round(SALARY[L] * 0.4 * mult / 10) * 10 };
  }
  /** Reto del próximo partido (para la UI). null si no hay partido o te toca banquillo. */
  function challenge(c) {
    c = c || K().get(); if (!c || c.phase === 'pick' || c.phase === 'off') return null;
    var n = K().next(c); if (!n || n.bench) return null;
    return challengeAt(c, c.season, c.phase, { week: n.week, round: n.round }, n.rival.id);
  }
  function chOk(ch, me, res, nota) {
    var win = res.sets[0] > res.sets[1];
    switch (ch.id) {
      case 'nota': return nota >= ch.n;
      case 'clean': return win && res.sets[1] === 0;
      case 'tidy': return win && (me.errors | 0) <= ch.n;
      case 'win': return win;
      default: return (me[CH[ch.id].stat] | 0) >= ch.n;
    }
  }
  function chProgress(ch, me, res, nota) {
    if (ch.id === 'nota') return String(nota).replace('.', ',');
    if (ch.id === 'clean' || ch.id === 'win') return res.sets[0] + '-' + res.sets[1];
    if (ch.id === 'tidy') return plural(me.errors | 0, 'error', 'errores');
    return (me[CH[ch.id].stat] | 0) + ' de ' + ch.n;
  }

  // ------------------------------------------------------------------ patrocinadores (inventados: gag de vóley, sin marcas reales)
  var SPONSORS = ['Chanclas Voladoras', 'Cremas Quemadito', 'Horchatería El Bloqueo', 'Seguros Arena Mojada', 'Toallas Sin Arena', 'Marisquería El Pulpo Feliz',
    'Gafas Mediodía', 'Bocatas Remate', 'Helados Punto de Set', 'Sombrillas Tie-Break', 'Zumos La Dejada', 'Autoescuela Saque Flotante', 'Panadería La Colocadora',
    'Colchones El Banquillo', 'Peluquería Tie-Break', 'Fontanería Toque de Red', 'Croquetas Doble Contacto', 'Paellas Cambio de Campo', 'Ferretería El Muro', 'Gimnasio Salto Vertical'];
  var SP_PAY = [0, 120, 400, 1200, 3500, 9000, 20000];   // € por jornada según tu escalón de fama
  var SP_GOALS = [
    { stat: 'aces', per: 1.6, txt: '{n} aces en la temporada' },
    { stat: 'kills', per: 9, txt: '{n} remates punto en la temporada' },
    { stat: 'won', per: 0.55, txt: '{n} victorias en la temporada' },
    { stat: 'blocks', per: 1.1, txt: '{n} bloqueos punto en la temporada' },
    { stat: 'digs', per: 6, txt: '{n} defensas en la temporada' }
  ];
  /** Llegan 2 ofertas de patrocinio (al subir de escalón o al empezar temporada). why: 'tier' | 'season'. */
  function sponsorOffers(c, why) {
    var l = ensure(c), t = tierIdx(l.fame); if (t < 1) return [];
    if (l.sponsor && l.sponsor.tier >= t && why === 'tier') return [];
    var r = rngOf(c.seed, 'spons', c.season, t, l.evN), used = {}; if (l.sponsor) used[l.sponsor.name] = 1;
    var out = [];
    for (var i = 0; i < 2; i++) {
      var name; do { name = pick(r, SPONSORS); } while (used[name]); used[name] = 1;
      var g = pick(r, SP_GOALS), weeks = K().WEEKS || 14, n = Math.max(3, Math.round(g.per * weeks * (0.8 + 0.3 * r())));
      var pay = Math.round(SP_PAY[t] * (i ? 0.75 : 1) / 10) * 10;
      out.push({ name: name, tier: t, pay: pay, goal: { stat: g.stat, n: n, txt: g.txt.replace('{n}', n), bonus: Math.round(pay * (i ? 14 : 8) / 50) * 50 } });
    }
    l.spOffers = out;
    K()._msg(c, 'fans', 'Ofertas de patrocinio', out.map(function (o) { return o.name + ' (' + eur(o.pay) + ' por jornada; bonus de ' + eur(o.goal.bonus) + ' si consigues ' + o.goal.txt + ')'; }).join('. ') + '. Míralas en Fama.');
    return out;
  }
  function signSponsor(i) {
    var c = K().load(); if (!c) return false; var l = ensure(c), o = l.spOffers[i]; if (!o) return false;
    var off = c.phase === 'off';   // firmado en verano: cuenta para la temporada que viene (antes no caducaba nunca)
    l.sponsor = { name: o.name, tier: o.tier, pay: o.pay, goal: o.goal, season: c.season + (off ? 1 : 0), base: off ? 0 : statBase(c, o.goal.stat) };
    l.spOffers = [];
    K()._msg(c, 'fans', 'Firmas con ' + o.name, 'Tu cara saldrá en sus anuncios. Cobras ' + eur(o.pay) + ' por jornada y ' + eur(o.goal.bonus) + ' más si consigues ' + o.goal.txt + '.');
    check(c); K().save(c); return true;
  }
  function declineSponsors() { var c = K().load(); if (!c) return false; ensure(c).spOffers = []; K().save(c); return true; }
  function statBase(c, stat) { return (c.stats && c.stats[stat]) | 0; }
  function sponsorProgress(c) { var l = ensure(c), s = l.sponsor; if (!s) return 0; return s.season === c.season && c.phase !== 'off' || s.done ? Math.max(0, statBase(c, s.goal.stat) - (s.base | 0)) : 0; }

  // ------------------------------------------------------------------ tienda: material y servicios
  // Material: compra única por nivel (1-3); suma en el partido a dos atributos (como la química, sin tocar tu atleta).
  var GEAR = {
    eyes: { beach: 'Gafas de sol polarizadas', hall: 'Rodilleras de gel', keys: ['recv', 'dig'], hint: 'Recepción y defensa' },
    feet: { beach: 'Calcetines de arena', hall: 'Zapatillas de salto', keys: ['jump', 'speed'], hint: 'Salto y velocidad' },
    hands: { beach: 'Muñequeras de tacto', hall: 'Muñequeras de tacto', keys: ['set', 'ctl'], hint: 'Colocación y control' },
    power: { beach: 'Banda elástica de potencia', hall: 'Banda elástica de potencia', keys: ['spike', 'serve'], hint: 'Remate y saque' }
  };
  var GEAR_KEYS = ['eyes', 'feet', 'hands', 'power'], GEAR_PRICE = [1500, 6000, 24000], GEAR_MAX = 3;
  // Servicios: se pagan por jornada (los cancelas cuando quieras; sin dinero se cancelan solos).
  var SVC = {
    coach: { name: 'Entrenador personal', hint: '+25 de progreso por semana con enfoque (+8 en Equilibrado)', k: 0.25 },
    nutri: { name: 'Nutricionista', hint: '−5 de fatiga en cada jornada', k: 0.15 },
    agent: { name: 'Agente estrella', hint: 'Más interés de los clubes (+2) y mejores patrocinios', k: 0.2 }
  };
  var SVC_KEYS = ['coach', 'nutri', 'agent'];
  function gearName(c, id) { return GEAR[id][hall(c) ? 'hall' : 'beach']; }
  function gearPrice(c, id) { var lv = (ensure(c).gear[id] | 0); return lv >= GEAR_MAX ? 0 : GEAR_PRICE[lv]; }
  function svcCost(c, id) { return Math.round(SALARY[lvlOf(c)] * SVC[id].k / 10) * 10; }
  function buyGear(id) {
    var c = K().load(); if (!c || !GEAR[id]) return ''; var l = ensure(c), lv = l.gear[id] | 0;
    if (lv >= GEAR_MAX) return 'max';
    var p = GEAR_PRICE[lv]; if ((+c.money || 0) < p) return 'money';
    c.money = Math.round(c.money - p); l.gear[id] = lv + 1; l.spent += p;
    check(c); K().save(c); return 'ok';
  }
  function toggleSvc(id) {
    var c = K().load(); if (!c || !SVC[id]) return ''; var l = ensure(c);
    if (l.svc[id]) { delete l.svc[id]; K().save(c); return 'off'; }
    if ((+c.money || 0) < svcCost(c, id)) return 'money';
    l.svc[id] = 1; K().save(c); return 'on';
  }
  function gearBonus(c) {
    var l = c && c.life, out = {}; if (!l || !l.gear) return out;
    GEAR_KEYS.forEach(function (id) { var lv = l.gear[id] | 0; if (lv) GEAR[id].keys.forEach(function (k) { out[k] = (out[k] | 0) + lv; }); });
    return out;
  }

  // ------------------------------------------------------------------ rival personal
  function ensureRival(c) {
    var l = ensure(c), me = c.myClub >= 0 && K().myClub(c); if (!me) return null;
    var rv = l.rival, rk = rv && K().club(c, rv.club);
    if (rk && rk.lvl === me.lvl && rk.id !== me.id) return rv;
    var pool = K().clubsOf(c, me.lvl).filter(function (k) { return k.id !== me.id; }); if (!pool.length) return null;
    var r = rngOf(c.seed, 'rival', c.season, me.id, l.evN);
    var k = pick(r, pool);
    if (rv && rk && r() < 0.5) {   // tu rival te persigue: ficha por un club de tu nueva liga
      rv.club = k.id;
      K()._msg(c, 'fans', rv.name + ' te sigue', 'Tu rival ' + rv.name + ' ha fichado por ' + k.name + '. Dice que viene a por ti. El cara a cara sigue: ' + rv.w + '-' + rv.l + '.');
      return rv;
    }
    var m = K()._newMate(c, k, r);
    var off = Math.round(1 + r() * 4);
    l.rival = { name: m.name, num: m.num, club: k.id, off: off, w: 0, l: 0, since: c.season };
    K()._msg(c, 'fans', 'Tienes un rival: ' + m.name, m.name + ' (' + k.name + ') tiene tu edad, juega en tu liga y no para de decir en las entrevistas que es mejor que tú. Cada partido contra su club es un duelo: el reto vale el doble.');
    return l.rival;
  }
  function rivalOvr(c) { var l = c && c.life; return l && l.rival ? clamp(K().playerOvr(c) + (l.rival.off | 0), 1, 99) : 0; }

  // ------------------------------------------------------------------ decisiones (eventos con elección)
  // efectos: coach, chem, fame (proporción de tus seguidores, con mínimo fameMin), fatigue, money (× sueldo de la liga), form (pareja), tp (progreso de entreno), hurt
  var EVENTS = {
    pressLoss: { t: 'Rueda de prensa tras la derrota', x: '«¿Qué ha fallado hoy?», pregunta una periodista con muy mala idea.', when: function (c, s) { return !s.win && !s.bench; },
      o: [{ t: 'Asumir la culpa', e: { coach: 4, fame: 0.01 } }, { t: 'Culpar al árbitro', e: { coach: -4, fame: 0.05, fameMin: 40 } }, { t: 'El rival fue mejor', e: { coach: 2 } }] },
    pressWin: { t: 'Los periodistas te rodean', x: 'Has ganado y todo el mundo quiere una frase tuya para el titular.', when: function (c, s) { return s.win && s.nota >= 7; },
      o: [{ t: 'Todo es mérito del equipo', e: { chem: 8, coach: 1 } }, { t: '«Hoy he estado imparable»', e: { fame: 0.07, fameMin: 60, chem: -5 } }, { t: 'Ya pensamos en el siguiente', e: { coach: 3 } }] },
    party: { t: 'Fiesta en el chiringuito', th: 'Cena de equipo', x: 'La plantilla ha quedado para celebrar. Mañana hay entreno a primera hora.', when: function () { return true; },
      o: [{ t: 'Quedarte hasta tarde', e: { chem: 10, fatigue: 15, fame: 0.02, fameMin: 15 } }, { t: 'Un rato y a casa', e: { chem: 4 } }, { t: 'Quedarte entrenando', e: { tp: 35, fatigue: 6, coach: 2 } }] },
    clinic: { t: 'Clínic benéfico', x: 'Una escuela de tu ciudad te invita a entrenar con sus peques el día de descanso.', when: function () { return true; },
      o: [{ t: 'Ir toda la mañana', e: { fame: 0.06, fameMin: 50, fatigue: 5 } }, { t: 'Mandar una camiseta firmada', e: { fame: 0.02, fameMin: 15 } }, { t: 'Esta vez no puedo', e: {} }] },
    viral: { t: 'Reto viral en redes', x: 'Te retan a meter un saque dentro de una papelera a 9 metros. Medio vestuario ya lo ha intentado.', when: function (c) { return tierOf(c) >= 1; },
      o: [{ t: 'Grabar el vídeo', e: { fame: 0.1, coach: -2, fatigue: 3 } }, { t: 'Pasar', e: { coach: 1 } }] },
    rivalTalk: { t: 'Tu rival te pica', x: '{rival} ha dicho en una entrevista que «en la arena hay jugadores y luego hay gente que hace fotos». Todo el mundo sabe por quién lo dice.', when: function (c) { return !!(c.life && c.life.rival); },
      o: [{ t: 'Responder con humor', e: { fame: 0.05, fameMin: 40 } }, { t: 'Contestar duro', e: { fame: 0.08, fameMin: 60, coach: -3 } }, { t: 'Ignorarle', e: { coach: 3 } }] },
    mateDown: { t: 'Tu pareja está de bajón', th: 'Un compañero está de bajón', x: '{mate} apenas habla en los entrenos desde hace días.', when: function (c) { return !!c.mate && (c.mate.chem | 0) < 50; },
      o: [{ t: 'Invitar a cenar', e: { chem: 10, money: -0.15 } }, { t: 'Entrenar juntos extra', e: { chem: 6, fatigue: 8 } }, { t: '«Espabila, que nos jugamos mucho»', e: { chem: -6, form: 1 } }] },
    tv: { t: 'Te invitan a la tele', x: 'Un programa de deportes quiere entrevistarte en directo esta noche.', when: function (c) { return tierOf(c) >= 2; },
      o: [{ t: 'Ir al plató', e: { fame: 0.12, fatigue: 6, money: 0.3 } }, { t: 'Mejor descansar', e: { fatigue: -10 } }] },
    ankle: { t: 'Molestias en el tobillo', x: 'Al bajar de un bloqueo has notado un pinchazo. No parece grave, pero molesta.', when: function (c) { return (c.fatigue | 0) >= 45; },
      o: [{ t: 'Parar y fisio', e: { fatigue: -20, money: -0.3 } }, { t: 'Jugar con molestias', e: { coach: 3, hurt: 1 } }, { t: 'Vendaje y a por ello', e: { fatigue: 4 } }] },
    scout: { t: 'Un ojeador en la grada', x: 'Tu agente te avisa: en el próximo partido habrá un ojeador de un club de arriba.', when: function (c, s) { return lvlOf(c) < 4 && s.nota >= 6.8; },
      o: [{ t: 'Darlo todo', e: { scout: 1, fatigue: 5 } }, { t: 'Como un partido más', e: { coach: 2 } }] },
    fans: { t: 'Pancarta de la afición', x: 'Un grupo de seguidores ha venido con una pancarta enorme con tu cara (no te han sacado muy favorecido).', when: function (c) { return tierOf(c) >= 1; },
      o: [{ t: 'Foto con todos', e: { fame: 0.04, fameMin: 30 } }, { t: 'Saludar de lejos', e: { fame: 0.01 } }] },
    sponsorShoot: { t: 'Rodaje del anuncio', x: '{sponsor} quiere grabar un anuncio contigo el día de descanso. El guion incluye un disfraz.', when: function (c) { return !!(c.life && c.life.sponsor); },
      o: [{ t: 'Ponerte el disfraz', e: { money: 0.5, fame: 0.04, fameMin: 30, fatigue: 5 } }, { t: 'Solo una foto', e: { money: 0.15 } }] }
  };
  var EV_KEYS = Object.keys(EVENTS);
  var EV_P = 0.4;   // probabilidad de decisión tras cada jornada (si no hay otra pendiente)
  function evText(c, s) {
    var l = ensure(c), sp = l.sponsor ? l.sponsor.name : 'Tu patrocinador';
    return String(s).replace('{rival}', l.rival ? l.rival.name : 'Tu rival').replace('{mate}', c.mate ? c.mate.name : 'Un compañero').replace('{sponsor}', sp);
  }
  function maybeEvent(c, sum) {
    var l = ensure(c);
    if (l.ev) { K()._msg(c, 'fans', 'Sin respuesta: ' + EVENTS[l.ev.key].t.toLowerCase(), 'No contestaste a tiempo. La vida sigue.'); l.ev = null; }
    if (c.phase === 'off' || c.phase === 'pick') return;
    var r = rngOf(c.seed, 'ev', c.season, c.week, c.phase, l.evN);
    if (r() >= EV_P) return;
    var ok = EV_KEYS.filter(function (k) { return k !== l.lastEv && EVENTS[k].when(c, sum); });
    if (!ok.length) return;
    var key = pick(r, ok);
    l.ev = { key: key, id: ++l.evN }; l.lastEv = key;
  }
  /** Evento pendiente para la UI: {key, title, text, opts:[{t, hint}]}. */
  function pendingEvent(c) {
    var l = c && c.life; if (!l || !l.ev) return null;
    var E = EVENTS[l.ev.key], th = hall(c) && E.th ? E.th : E.t;
    return { key: l.ev.key, id: l.ev.id, title: evText(c, th), text: evText(c, E.x), opts: E.o.map(function (o) { return { t: evText(c, o.t), hint: effHint(o.e) }; }) };
  }
  function effHint(e) {
    var h = [];
    if (e.coach) h.push(['Entrenador', e.coach > 0]);
    if (e.chem) h.push(['Química', e.chem > 0]);
    if (e.fame) h.push(['Fama', e.fame > 0]);
    if (e.fatigue) h.push(['Fatiga', e.fatigue < 0]);
    if (e.money) h.push(['Dinero', e.money > 0]);
    if (e.tp) h.push(['Entreno', true]);
    if (e.form) h.push(['Forma de la pareja', true]);
    if (e.hurt) h.push(['Riesgo', false]);
    if (e.scout) h.push(['Ofertas', true]);
    return h;
  }
  function answer(i) {
    var c = K().load(); if (!c) return null; var l = ensure(c); if (!l.ev) return null;
    var E = EVENTS[l.ev.key], o = E.o[i]; if (!o) return null;
    var res = applyEff(c, o.e);
    l.log.push({ s: c.season, t: E.t, o: o.t }); if (l.log.length > 30) l.log = l.log.slice(-30);
    l.ev = null;
    check(c); K().save(c);
    return res;
  }
  function applyEff(c, e) {
    var l = ensure(c), out = [];
    if (e.coach) { c.coach = clamp((c.coach | 0) + e.coach, 0, 100); out.push('Entrenador ' + (e.coach > 0 ? '+' : '−') + Math.abs(e.coach)); }
    if (e.chem && c.mate) { c.mate.chem = clamp((c.mate.chem | 0) + e.chem, 0, 100); out.push('Química ' + (e.chem > 0 ? '+' : '−') + Math.abs(e.chem)); }
    if (e.fame) { var n = e.fame > 0 ? Math.max(e.fameMin || 10, l.fame * e.fame) : -l.fame * -e.fame; n = addFame(c, n); out.push((n >= 0 ? '+' : '−') + num(Math.abs(n)) + ' seguidores'); }
    if (e.fatigue) { c.fatigue = clamp((c.fatigue | 0) + e.fatigue, 0, 100); out.push('Fatiga ' + (e.fatigue > 0 ? '+' : '−') + Math.abs(e.fatigue)); }
    if (e.money) { var m = Math.round(SALARY[lvlOf(c)] * e.money / 10) * 10; c.money = Math.max(0, Math.round((+c.money || 0) + m)); if (m > 0) l.earned += m; out.push((m >= 0 ? '+' : '−') + eur(Math.abs(m))); }
    if (e.form && c.mate) { c.mate.form = clamp((c.mate.form | 0) + e.form, -3, 3); out.push('Forma de ' + c.mate.name.split(' ')[0] + ' +' + e.form); }
    if (e.tp && c.tp) { addTp(c, trainGroup(c), e.tp); out.push('Entreno +' + e.tp); }
    if (e.hurt) { l.hurt = 1; out.push('Juegas tocado el próximo partido que juegues (−2)'); }
    if (e.scout) { l.scout = c.season; out.push('Más interés de los clubes esta temporada'); }
    return out;
  }
  function addTp(c, g, n) { c.tp[g] = Math.min(99, (c.tp[g] | 0) + n); }   // (migrate recorta a 99: lo que pase se perdería al recargar)
  function trainGroup(c) { var t = c.train; return t === 'phys' || t === 'def' || t === 'atk' ? t : ['phys', 'def', 'atk'][(c.week | 0) % 3]; }

  // ------------------------------------------------------------------ premios de la temporada
  // Rivales simulados de la liga: lo que necesitas para ganar cada premio (por partido de la temporada). Objetivo: el autopiloto
  // (≈ jugador bueno) gana 1-2 por temporada jugándolo todo; simulando más de media temporada, ninguno.
  var AWARDS = [
    { id: 'mvp', name: 'MVP', test: function (c, x) { return x.nota != null && x.nota >= 8 + 0.5 * x.r() - 0.15 * x.L && x.pos <= 2; } },
    { id: 'pts', name: 'Máximo anotador', test: function (c, x) { return x.pp >= 18 + 4 * x.r() - 0.5 * x.L; } },
    { id: 'ace', name: 'Mejor sacador', test: function (c, x) { return x.per('aces') >= 4 + 1.2 * x.r() - 0.3 * x.L; } },
    { id: 'blk', name: 'Muro del año', test: function (c, x) { return x.per('blocks') >= 2.4 + 1 * x.r() + 0.1 * x.L; } },
    { id: 'dig', name: 'Mejor defensa', test: function (c, x) { return x.per('digs') >= 11 + 6 * x.r() + 2.5 * x.L; } },
    { id: 'rook', name: 'Revelación', test: function (c, x) { return x.newLeague && (c.player.age | 0) <= 23 && x.nota != null && x.nota >= 7.5 && !c.life.awards.some(function (a) { return a.id === 'rook'; }); } }   // una vez en la carrera
  ];
  function seasonAwards(c) {
    var l = ensure(c), S = c.stats, n = Math.max(1, S.played | 0), real = (S.played | 0) - (S.sim | 0);
    if ((S.played | 0) < 6) return [];
    var me = K().myClub(c), L = lvlOf(c), Lg = leagueOf(c), r = rngOf(c.seed, 'awards', c.season);
    var prevL = (c.history || []).filter(function (h) { return h.season === c.season - 1; })[0];
    var x = { r: r, L: L, nota: K().avgNota(c), pos: K().posOf(c, me.id), pp: S.pts / n, per: function (k) { return (S[k] | 0) / n; }, newLeague: !prevL || prevL.lvl !== me.lvl };
    var won = [];
    AWARDS.forEach(function (a) {
      var ok = a.test(c, x);
      if (ok && real < (S.played | 0) * 0.5) ok = false;   // simulando más de media temporada no hay premios (no te han visto jugar)
      if (ok) won.push(a);
    });
    won.forEach(function (a) {
      var nm = a.name + ' ' + deL(Lg);
      l.awards.push({ season: c.season, id: a.id, name: nm, club: me.name });
      c.trophies.push({ season: c.season, kind: 'premio', name: nm, club: me.name });
      addFame(c, (a.id === 'mvp' ? 400 : 150) * LV_MULT[L]);
    });
    if (won.length) K()._msg(c, 'fans', won.length === 1 ? 'Premio: ' + won[0].name : plural(won.length, 'premio', 'premios') + ' de la temporada',
      'La gala ' + deL(Lg) + ' te ha dado ' + won.map(function (a) { return '«' + a.name + '»'; }).join(', ') + '. Ya están en tu palmarés.');
    return won;
  }
  function deL(L) { return (L.art === 'el' ? 'del ' : 'de la ') + L.name; }

  // ------------------------------------------------------------------ logros de carrera
  // v(c) = valor actual; n = objetivo; premio: pts (puntos de mejora), fans, money
  function T(c) { return c.career || {}; }
  function trophiesOf(c, k) { return (c.trophies || []).filter(function (t) { return !k || t.kind === k; }).length; }
  var ACH = [
    { id: 'm1', name: 'Debut', d: 'Juega tu primer partido', n: 1, v: function (c) { return T(c).played; }, fans: 30 },
    { id: 'm50', name: 'Veterano de la arena', d: 'Juega 50 partidos', n: 50, v: function (c) { return T(c).played; }, pts: 2 },
    { id: 'm150', name: 'Incombustible', d: 'Juega 150 partidos', n: 150, v: function (c) { return T(c).played; }, pts: 4 },
    { id: 'w1', name: 'Primera victoria', d: 'Gana un partido', n: 1, v: function (c) { return T(c).won; }, fans: 50 },
    { id: 'w50', name: 'Ganador', d: 'Gana 50 partidos', n: 50, v: function (c) { return T(c).won; }, pts: 3 },
    { id: 'p500', name: 'Anotador', d: 'Suma 500 puntos', n: 500, v: function (c) { return T(c).pts; }, pts: 2 },
    { id: 'p2000', name: 'Máquina de puntos', d: 'Suma 2.000 puntos', n: 2000, v: function (c) { return T(c).pts; }, pts: 4 },
    { id: 'a50', name: 'Saque bomba', d: 'Haz 50 aces', n: 50, v: function (c) { return T(c).aces; }, pts: 2 },
    { id: 'b50', name: 'Muralla', d: 'Haz 50 bloqueos punto', n: 50, v: function (c) { return T(c).blocks; }, pts: 2 },
    { id: 'n9', name: 'Partidazo', d: 'Saca un 9 o más en un partido', n: 9, v: function (c) { return c.life.bestNota; }, fans: 150, dec: true },
    { id: 's5', name: 'En racha', d: 'Gana 5 partidos seguidos', n: 5, v: function (c) { return c.life.best; }, pts: 1 },
    { id: 's10', name: 'Imparable', d: 'Gana 10 partidos seguidos', n: 10, v: function (c) { return c.life.best; }, pts: 3 },
    { id: 'ch10', name: 'Retador', d: 'Cumple 10 retos de jornada', n: 10, v: function (c) { return c.life.chDone; }, pts: 2 },
    { id: 'ch40', name: 'Sin miedo a nada', d: 'Cumple 40 retos de jornada', n: 40, v: function (c) { return c.life.chDone; }, pts: 4 },
    { id: 'duel5', name: 'Némesis', d: 'Gana 5 duelos a tu rival', n: 5, v: function (c) { return c.life.duelW; }, pts: 2 },
    { id: 'up', name: 'Subir de categoría', d: 'Consigue un ascenso', n: 1, v: function (c) { return trophiesOf(c, 'ascenso'); }, money: 2000 },
    { id: 't1', name: 'Campeón', d: 'Gana un título (liga u open)', n: 1, v: function (c) { return trophiesOf(c, 'liga') + trophiesOf(c, 'copa') + trophiesOf(c, 'intl'); }, pts: 2 },
    { id: 't5', name: 'Coleccionista', d: 'Gana 5 títulos', n: 5, v: function (c) { return trophiesOf(c, 'liga') + trophiesOf(c, 'copa') + trophiesOf(c, 'intl'); }, pts: 5 },
    { id: 'aw1', name: 'Gala de premios', d: 'Gana un premio individual', n: 1, v: function (c) { return c.life.awards.length; }, pts: 1 },
    { id: 'mvp', name: 'El mejor de todos', d: 'Gana un MVP', n: 1, v: function (c) { return c.life.awards.filter(function (a) { return a.id === 'mvp'; }).length; }, pts: 3 },
    { id: 'top', name: 'En la élite', d: 'Juega en la máxima categoría', n: 4, v: function (c) { return c.myClub >= 0 ? lvlOf(c) : 0; }, fans: 2000 },
    { id: 'f1', name: 'Te conocen', d: 'Llega a «Conocido en el circuito»', n: 2000, v: function (c) { return c.life.fameMax; }, money: 1000 },
    { id: 'f2', name: 'Estrella', d: 'Llega a «Estrella»', n: 20000, v: function (c) { return c.life.fameMax; }, pts: 3 },
    { id: 'f3', name: 'Leyenda viva', d: 'Llega a «Leyenda viva»', n: 120000, v: function (c) { return c.life.fameMax; }, pts: 5 },
    { id: 'l10', name: 'Nivel 10', d: 'Llega al nivel 10', n: 10, v: function (c) { return c.player.lvl; }, money: 1500 },
    { id: 'l25', name: 'Nivel 25', d: 'Llega al nivel 25', n: 25, v: function (c) { return c.player.lvl; }, pts: 3 },
    { id: 'sp', name: 'Cara de anuncio', d: 'Firma con un patrocinador', n: 1, v: function (c) { return c.life.sponsor || c.life.spDone ? 1 : 0; }, fans: 100 },
    { id: 'gear', name: 'Equipado hasta arriba', d: 'Todo el material a nivel 3', n: 12, v: function (c) { var s = 0; GEAR_KEYS.forEach(function (k) { s += c.life.gear[k] | 0; }); return s; }, pts: 2 }
  ];
  function achList(c) {
    ensure(c);
    return ACH.map(function (a) { var v = +a.v(c) || 0; return { id: a.id, name: a.name, d: a.d, n: a.n, v: Math.min(v, a.n), dec: !!a.dec, done: !!c.life.ach[a.id], reward: rewardTxt(a) }; });
  }
  function rewardTxt(a) { return a.pts ? '+' + plural(a.pts, 'punto de mejora', 'puntos de mejora') : a.fans ? '+' + num(a.fans) + ' seguidores' : a.money ? '+' + eur(a.money) : ''; }
  /** Comprueba logros nuevos y da sus premios. Devuelve los conseguidos ahora. */
  function check(c) {
    var l = ensure(c), got = [];
    ACH.forEach(function (a) {
      if (l.ach[a.id]) return;
      if ((+a.v(c) || 0) >= a.n) {
        l.ach[a.id] = c.season | 0; got.push(a);
        if (a.pts && c.player) c.player.pts = (c.player.pts | 0) + a.pts;
        if (a.money) c.money = Math.round((+c.money || 0) + a.money);
        if (a.fans) addFame(c, a.fans);
      }
    });
    if (got.length) K()._msg(c, 'fans', got.length === 1 ? 'Logro: ' + got[0].name : plural(got.length, 'logro nuevo', 'logros nuevos'), got.map(function (a) { return a.name + ' (' + a.d.toLowerCase() + '): ' + rewardTxt(a); }).join('. ') + '.');
    return got;
  }

  // ------------------------------------------------------------------ legado y retirada
  var LEG_KEY = 'voley3d.legends';
  var LEG_TIERS = [[0, 'Jugador de club'], [60, 'Referente'], [150, 'Ídolo del circuito'], [300, 'Leyenda'], [500, 'Mito del vóley']];
  function legacyScore(c) {
    var l = ensure(c), s = 0;
    (c.trophies || []).forEach(function (t) {
      var lv = 0; K().LEAGUES.forEach(function (L, i) { if (t.name && t.name.indexOf(L.name) >= 0) lv = i; });
      s += t.kind === 'liga' ? 10 + 6 * lv : t.kind === 'copa' ? 6 + 4 * lv : t.kind === 'intl' ? 25 : t.kind === 'premio' ? (/^MVP/.test(t.name) ? 12 : 5) + 2 * lv : 4;
    });
    s += Math.round(Math.log(1 + l.fameMax) * 4);
    s += Math.round(((c.career && c.career.won) | 0) / 5);
    s += Object.keys(l.ach).length * 2;
    return s;
  }
  function legacyTier(s) { var i = 0; for (var j = 0; j < LEG_TIERS.length; j++) if (s >= LEG_TIERS[j][0]) i = j; return { i: i, name: LEG_TIERS[i][1], next: LEG_TIERS[i + 1] ? LEG_TIERS[i + 1] : null }; }
  var RETIRE_AGE = 30, DECLINE_AGE = 32;
  function canRetire(c) { return !!(c && c.player && (c.player.age | 0) >= RETIRE_AGE && c.phase !== 'pick'); }
  function legends() { try { var s = root.localStorage && root.localStorage.getItem(LEG_KEY); var a = s ? JSON.parse(s) : []; return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  /** Te retiras: la carrera pasa al Salón de la Fama del dispositivo y se borra (como abandonar, pero con homenaje). */
  function retire() {
    var c = K().load(); if (!canRetire(c)) return null;
    var l = ensure(c), sc = legacyScore(c), lt = legacyTier(sc), k = K().myClub(c);
    var rec = { name: c.player.name, num: c.player.num, role: c.player.role, age: c.player.age, seasons: c.season, score: sc, tier: lt.name,
      titles: (c.trophies || []).filter(function (t) { return t.kind === 'liga' || t.kind === 'copa' || t.kind === 'intl'; }).length,
      awards: l.awards.length, fans: Math.round(l.fameMax), club: k ? k.name : '', ovr: K().playerOvr(c), played: (c.career && c.career.played) | 0, date: Date.now() };
    var all = legends(); all.push(rec); all.sort(function (a, b) { return b.score - a.score; }); all = all.slice(0, 20);
    try { root.localStorage.setItem(LEG_KEY, JSON.stringify(all)); } catch (e) { }
    K().abandon();
    return rec;
  }
  /** Bonus de legado para una carrera nueva: la mejor leyenda del dispositivo da seguidores de salida («hijo/a de…» no: tu apellido suena). */
  function legacyStart() { var a = legends(); if (!a.length) return 0; var t = legacyTier(a[0].score).i; return t * 150; }
  /** Verano: un año más. Desde DECLINE_AGE el físico baja (salto, velocidad, reacción). */
  function ageing(c) {
    var a = c.player, age = a.age | 0; if (age < DECLINE_AGE) return null;
    var r = rngOf(c.seed, 'age', c.season), d = age >= 35 ? 2 : 1, lost = [];
    ['jump', 'speed', 'react'].forEach(function (k) { var x = d + (r() < 0.4 ? 1 : 0) - (r() < 0.3 ? 1 : 0); if (x > 0 && a.st[k] > 20) { a.st[k] = Math.max(20, a.st[k] - x); lost.push(k); } });
    if (lost.length) K()._msg(c, 'train', 'Los años pesan', 'Con ' + age + ' años el cuerpo ya no responde igual: pierdes algo de físico (' + lost.map(function (k) { return (VB.Prog && VB.Prog.LABEL && VB.Prog.LABEL[k] || k).toLowerCase(); }).join(', ') + '). Tu experiencia sigue intacta.' + (age >= RETIRE_AGE ? ' Puedes retirarte cuando quieras desde Fama › Legado.' : ''));
    return lost;
  }

  // ------------------------------------------------------------------ ganchos de career.js
  /** Tras cada jornada tuya (jugada, simulada o en el banquillo). f = partido, sum = resumen (se le añade sum.life). */
  function afterMatch(c, sum, f) {
    var l = ensure(c), L = lvlOf(c), out = { fans: 0, money: 0, xp: 0, ch: null, ach: [], duel: null };
    // el reto y el duelo, con el rival de ANTES del partido (el que se enseñó en la tarjeta y en g.career.goal)
    var ch = sum.bench ? null : challengeAt(c, sum.season, sum.phase, f, sum.rival), rv0 = l.rival;
    // rival: se crea en tu primera jornada en una liga (o al cambiar de liga)
    ensureRival(c);
    if (!sum.bench) {
      // racha
      if (sum.win) { l.streak++; l.best = Math.max(l.best, l.streak); } else l.streak = 0;
      if (sum.nota != null && !sum.sim) l.bestNota = Math.max(l.bestNota, sum.nota);
      // seguidores por el partido (simulado: un tercio; nadie lo ha visto)
      var base = Math.max(0, (sum.nota - 5.5)) * 22 + (sum.win ? 18 : 0) + (sum.phase === 'cup' ? 30 : 0);
      var fans = Math.round(base * LV_MULT[L] * (sum.sim ? 0.33 : 1) * (1 + 0.05 * Math.min(l.streak, 6)));
      if (!sum.sim && sum.nota < 5) fans = -Math.round(l.fame * 0.02);
      out.fans += addFame(c, fans);
      // reto de la jornada (solo jugando)
      if (!sum.sim) {
        l.chTried++;
        var ok = chOk(ch, sum.me || {}, { sets: sum.sets }, sum.nota);
        out.ch = { txt: ch.txt, ok: ok, prog: chProgress(ch, sum.me || {}, { sets: sum.sets }, sum.nota), duel: ch.duel };
        if (ok) {
          l.chDone++;
          out.fans += addFame(c, ch.fans);
          c.money = Math.round((+c.money || 0) + ch.money); out.money += ch.money; l.earned += ch.money;
          var lv = K()._addXP(c.player, ch.xp); out.xp = ch.xp;
          c.player.matches = Math.max(0, (c.player.matches | 0) - 1);   // (addXP cuenta un partido: el reto no lo es)
          if (lv && lv.lvlUp) { sum.lvlUp = (sum.lvlUp | 0) + lv.lvlUp; sum.lvl = lv.lvl; sum.ptsGained = (sum.ptsGained | 0) + lv.pts; }
          sum.xp = (sum.xp | 0) + ch.xp;
        }
      }
      // duelo con tu rival
      if (ch.duel && rv0) { if (sum.win) { rv0.w++; l.duelW++; } else { rv0.l++; l.duelL++; } out.duel = { name: rv0.name, win: sum.win, w: rv0.w, l: rv0.l }; }
      if (l.hurt && !sum.sim) l.hurt = 0;
    }
    // patrocinador y servicios (cada jornada, también en el banquillo)
    if (l.sponsor) { c.money = Math.round((+c.money || 0) + l.sponsor.pay); out.money += l.sponsor.pay; l.earned += l.sponsor.pay; }
    SVC_KEYS.forEach(function (id) {
      if (!l.svc[id]) return;
      var cost = svcCost(c, id);
      if ((+c.money || 0) < cost) { delete l.svc[id]; K()._msg(c, 'fans', 'Sin dinero: ' + SVC[id].name, 'No te llega para pagar ' + SVC[id].name.toLowerCase() + ' (' + eur(cost) + ' por jornada). Se cancela.'); return; }
      c.money = Math.round(c.money - cost); l.spent += cost; out.money -= cost;
      if (id === 'coach' && c.tp) addTp(c, trainGroup(c), c.train === 'rest' ? 0 : c.train === 'bal' ? 8 : 25);
      if (id === 'nutri') c.fatigue = clamp((c.fatigue | 0) - 5, 0, 100);
    });
    maybeEvent(c, sum);
    out.ach = check(c).map(function (a) { return a.name; });
    sum.life = out;
  }
  /** Fin de temporada (después de career.js endSeason): premios, objetivo del patrocinador, títulos a fama, logros. */
  function seasonEnd(c) {
    var l = ensure(c), L = lvlOf(c), r = c.review || {};
    if (r.champion) addFame(c, 300 * LV_MULT[L]);
    if (r.cup) addFame(c, 150 * LV_MULT[L]);
    if (r.move > 0) addFame(c, 200 * LV_MULT[L]);
    var aw = seasonAwards(c);
    r.awards = aw.map(function (a) { return a.name; });
    if (l.sponsor && l.sponsor.season <= c.season && !l.sponsor.done) {
      var got = sponsorProgress(c), s = l.sponsor;
      if (got >= s.goal.n) { c.money = Math.round((+c.money || 0) + s.goal.bonus); l.earned += s.goal.bonus; K()._msg(c, 'fans', 'Bonus de ' + s.name, 'Has cumplido el objetivo (' + s.goal.txt + '): ' + eur(s.goal.bonus) + ' para ti.'); r.spBonus = s.goal.bonus; }
      else K()._msg(c, 'fans', s.name + ': objetivo no cumplido', 'Te quedaste en ' + got + ' de ' + s.goal.n + ' (' + s.goal.txt + '). Sin bonus esta vez.');
      l.spDone = 1; l.sponsor.done = 1;   // los patrocinios son por temporada: se va en verano (seasonStart); el último partido aún cobra
    }
    r.fans = Math.round(l.fame); r.legacy = legacyScore(c);
    check(c);
  }
  /** Temporada nueva (después de career.js newSeason): edad, patrocinios, rival. */
  function seasonStart(c) {
    var l = ensure(c);
    ageing(c);
    l.scout = 0; l.hurt = 0; l.streak = l.streak | 0;
    if (l.sponsor && (l.sponsor.done || l.sponsor.season < c.season)) l.sponsor = null;
    if (tierOf(c) >= 1) sponsorOffers(c, 'season');
    ensureRival(c);
  }
  /** matchSetup: material (+ a dos atributos por pieza y nivel) y molestias (−2 a todo). Solo en el partido. */
  function setup(c, m) {
    var l = c.life; if (!l || !m || !m.attrs || !m.attrs[0] || !m.attrs[0][0]) return;
    var st = m.attrs[0][0], gb = gearBonus(c), hurt = l.hurt ? 2 : 0;
    Object.keys(st).forEach(function (k) { st[k] = clamp(Math.round(st[k] + (gb[k] | 0) - hurt), 1, 99); });
    m.gear = gb; m.hurt = hurt;
    var ch = challenge(c); if (ch && m.career) { m.career.goal = ch.txt; m.career.duel = ch.duel; }
  }
  function onCreate(c) { var f = legacyStart(); var l = ensure(c); if (f) { l.fame = l.fameMax = f; } }
  function hook(c, kind, a, b) {
    if (!c) return;
    if (kind === 'match') afterMatch(c, a, b);
    else if (kind === 'season') seasonEnd(c);
    else if (kind === 'newSeason') seasonStart(c);
    else if (kind === 'setup') setup(c, a);
    else if (kind === 'create') onCreate(c);
  }

  VB.CareerLife = {
    hook: hook, ensure: ensure, TIERS: TIERS, fameInfo: fameInfo, tierName: tierName, offerBonus: offerBonus, addFame: addFame,
    challenge: challenge, challengeAt: challengeAt, CH: CH,
    sponsorOffers: sponsorOffers, signSponsor: signSponsor, declineSponsors: declineSponsors, sponsorProgress: sponsorProgress, SPONSORS: SPONSORS,
    GEAR: GEAR, GEAR_KEYS: GEAR_KEYS, GEAR_MAX: GEAR_MAX, gearName: gearName, gearPrice: gearPrice, buyGear: buyGear, gearBonus: gearBonus,
    SVC: SVC, SVC_KEYS: SVC_KEYS, svcCost: svcCost, toggleSvc: toggleSvc,
    rivalOvr: rivalOvr, pendingEvent: pendingEvent, answer: answer, EVENTS: EVENTS,
    achList: achList, check: check, AWARDS: AWARDS,
    legacyScore: legacyScore, legacyTier: legacyTier, canRetire: canRetire, retire: retire, legends: legends, RETIRE_AGE: RETIRE_AGE, DECLINE_AGE: DECLINE_AGE,
    eur: eur, num: num
  };
})();
