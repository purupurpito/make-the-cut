/* MAKE THE CUT — js/career-world.js (owner: ui_main)
 * «Mundo» de la Carrera (VB.CareerWorld, sprint 5): Faro, el mentor, con escenas cortas en los hitos (E4, tarea C1); noticias de
 * la liga (roundNews por jornada, seasonNews con los anales al acabar, summerNews en verano) y enciclopedia de clubes (lore,
 * clubRows, clubCard, cara a cara) (E5, tarea C2). Las ligas salen de leaguesOf(c): el lote C solo cambia esa función.
 * Sin DOM (se carga en node: tools/careertest.js). Estado en c.world (ensure() lo crea al vuelo; sin subir VER).
 * Solo escribe en c.world y, para el mentor, en la bandeja (K()._msg con k 'mentor'). No toca nada que influya en partidos,
 * ofertas, XP ni dinero, y su azar no consume los generadores de career.js. career.js llama a hook(c, tipo, …) desde life(),
 * después de CareerLife (create, join, setup, match, season, newSeason). Sin este fichero, la Carrera queda igual.
 *
 * Bandeja (plan, conflicto 10): la escena se apunta en la bandeja SOLO si no se ve en pantalla: al saltarla («Saltar»), con las
 * escenas apagadas (Palmarés › Opciones) o si se cae de la cola (máx. 3). Así no se duplica lo que ya avisa CareerLife.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var VB = root.VB = root.VB || {};
  function K() { return VB.Career; }
  function rngOf() { return K()._rng(K()._hash.apply(null, arguments)); }   // (C2: azar propio de las noticias)
  function lgOf(k) { return K().league(k.lid != null ? k.lid : k.lvl); }
  function lvOf(k) { return k.lid != null ? k.lid : k.lvl; }
  var Q_MAX = 3, LINE_MAX = 140;

  // ------------------------------------------------------------------ estado
  function ensure(c) {
    if (!c) return null;
    var w = c.world;
    if (!w || typeof w !== 'object' || Array.isArray(w)) { w = c.world = {}; backfill(c, w); }
    var m = w.mentor;
    if (!m || typeof m !== 'object') m = w.mentor = { on: 1, seen: {}, q: [] };
    m.on = m.on === 0 ? 0 : 1;
    if (!m.seen || typeof m.seen !== 'object') m.seen = {};
    if (!m.last || typeof m.last !== 'object') m.last = {};
    if (!Array.isArray(m.q)) m.q = [];
    m.q = m.q.filter(function (x) { return x && BEATS[x.id] && Array.isArray(x.l); }).slice(-Q_MAX);
    if (!w.h2h || typeof w.h2h !== 'object') w.h2h = {};
    if (!(w.since >= 1)) w.since = c.season | 0 || 1;
    // E5 (C2): noticias, anales, líder de cada liga y última variante de cada plantilla. Lo que no cuadra se descarta.
    if (!Array.isArray(w.news)) w.news = [];
    w.news = w.news.filter(function (x) { return x && typeof x.t === 'string' && x.id > 0; }).slice(-NEWS_MAX);
    w.news.forEach(function (x) { if (!Array.isArray(x.c)) x.c = []; x.s = x.s | 0; x.w = x.w | 0; });
    if (!(w.newsN >= 0)) w.newsN = w.news.reduce(function (m, x) { return Math.max(m, x.id); }, 0);
    if (!(w.newsSeen >= 0)) w.newsSeen = w.newsN;
    if (!Array.isArray(w.annals)) w.annals = [];
    w.annals = w.annals.filter(function (a) { return a && Array.isArray(a.lg) && Array.isArray(a.cup) && Array.isArray(a.up) && Array.isArray(a.dn); }).slice(-ANNALS_MAX);
    if (!w.lead || typeof w.lead !== 'object' || Array.isArray(w.lead)) w.lead = {};
    if (!w.tpl || typeof w.tpl !== 'object' || Array.isArray(w.tpl)) w.tpl = {};
    return w;
  }
  /** Guardado sin c.world (carrera empezada antes del sprint 5): cara a cara de la temporada en curso y hitos ya pasados vistos. */
  function backfill(c, w) {
    w.h2h = {}; w.since = c.season | 0 || 1;
    (c.notes || []).forEach(function (n) { if (n && n.s && n.rival != null) addH2h(w, n.rival, n.s, c.season); });
    w.mentor = { on: 1, seen: {}, q: [], last: {} };
    var T = c.career || {}, S = w.mentor.seen;
    if (c.myClub >= 0) S.hola = 1;   // carrera ya en marcha: Faro no se presenta a mitad
    if ((T.played | 0) > 0) { S.hola = S.debut = 1; }
    if ((T.won | 0) > 0) S.win1 = 1;
    if ((T.played | 0) - (T.won | 0) > 0) S.loss1 = 1;
    if ((T.bench | 0) > 0) S.bench1 = 1;
    if (c.life && c.life.rival) S.rival = 1;
    (c.trophies || []).forEach(function (t) { if (t.kind === 'liga' || t.kind === 'copa') S.title = 1; if (t.kind === 'ascenso') S.up = 1; if (t.kind === 'premio') S.award = 1; });
    (c.history || []).forEach(function (h) { if (h && h.move < 0) S.down = 1; if (h && h.lvl >= K().LEAGUES.length - 1) S.top = 1; });
    var me = c.myClub >= 0 && K().myClub(c); if (me && lvOf(me) >= K().LEAGUES.length - 1) S.top = 1;
    if (c.player && (c.player.age | 0) >= 30) S.vet = 1;
    if ((c.history || []).some(function (h, i, a) { return i > 0 && h.club !== a[i - 1].club; })) S.move = 1;
  }
  function addH2h(w, id, s, season) {
    var h = w.h2h[id] || (w.h2h[id] = [0, 0, 0, 0, 0, 0]);   // [jugados, ganados, perdidos, sets a favor, sets en contra, temporada del último]
    h[0]++; if (s[0] > s[1]) h[1]++; else h[2]++; h[3] += s[0]; h[4] += s[1]; h[5] = season | 0;
  }

  // ------------------------------------------------------------------ mentor
  var MENTOR = { name: 'Álex Marí', nick: 'Faro', role: 'Tu mentor' };
  // Escenas: 1-3 frases cortas (≤ 140 caracteres). act: botón opcional ('tab:sub', career-ui ya lo entiende); al: su texto.
  var BEATS = {
    hola: { t: 'Faro se presenta', l: ['Soy Álex Marí, aunque en la arena todo el mundo me llama Faro.', 'Doce temporadas en el Circuito Mundial. Ahora me toca ver cómo empiezas tú.', 'Primer consejo: mira bien la pareja que te ofrece cada club. En la playa sois dos y no hay dónde esconderse.'] },
    debut: { t: 'Antes del debut', l: ['Primer partido con {club}. Los nervios son buena señal: quiere decir que te importa.', 'Mira el reto de la jornada. No es obligatorio, pero se nota cuando lo cumples.'] },
    win1: { t: 'Primera victoria', l: ['¡Esa es! La primera nunca se olvida.', 'Ahora viene lo difícil: que no sea la única.'] },
    loss1: { t: 'Primera derrota', l: ['Perder también se entrena. Mañana mira qué falló, no quién falló.'] },
    rival: { t: 'Tienes rival', l: ['{rival} va diciendo que es mejor que tú. Un rival te hace mejor o te vuelve loco. Tú eliges.'] },
    bench1: { t: 'Al banquillo', l: ['Duele ver la jornada desde fuera, lo sé. Tus notas son tu voz: súbelas y no podrán dejarte fuera.'], act: 'player:train', al: 'Ver entreno' },
    slump: { t: 'Mala racha', l: ['{n} derrotas seguidas. Todo el mundo pasa por esto, hasta en el Mundial.', '{tip}'], act: '{act}', al: '{al}', max: 3 },
    streak: { t: 'En racha', l: ['Cinco seguidas. Disfrútalo, pero no te lo creas: la arena siempre te baja los humos.'] },
    title: { t: 'Primer título', l: ['{title}. Esto ya nadie te lo quita.', 'Guárdate la sensación: es la que te va a hacer madrugar los próximos diez años.'] },
    award: { t: 'Primer premio', l: ['{award}. Te han visto, y eso en este circuito vale oro.'] },
    up: { t: 'Ascenso', l: ['¡Subís {toL}! Celebra hoy.', 'Mañana, a entrenar: arriba la IA perdona mucho menos y los clubes miran más.'] },
    down: { t: 'Descenso', l: ['Bajar duele. A mí me pasó dos veces y aquí sigo.', 'Una temporada abajo puede ser el mejor sitio para coger confianza.'] },
    move: { t: 'Club nuevo', l: ['Cambiar de club es empezar de cero con {mate}: la química no se ficha, se juega.'] },
    top: { t: 'En la élite', l: ['El Circuito Mundial. Aquí jugué yo doce años.', 'Ahora entiendes por qué te hacía repetir la recepción.'] },
    vet: { t: 'Treinta años', l: ['Treinta. Las piernas empiezan a hablar, la cabeza va mejor que nunca.', 'Tú decides cuándo parar. Lo verás en Fama › Legado.'], act: 'life:legacy', al: 'Ver legado' }
  };
  // (midLow del diseño, recortado por el plan: midWindow del entrenador ya cubre el ecuador)
  var BEAT_ORDER = ['hola', 'debut', 'win1', 'loss1', 'rival', 'bench1', 'slump', 'streak', 'title', 'award', 'up', 'down', 'move', 'top', 'vet'];
  function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, function (a, k) { return v && v[k] != null ? String(v[k]) : ''; }); }
  function inbox(c, q) { var B = BEATS[q.id]; if (B) K()._msg(c, 'mentor', 'Faro: ' + B.t.toLowerCase(), q.l.join(' ')); }
  /** Dispara una escena (una vez en la carrera; slump hasta 3 veces, una por temporada). Con escenas: a la cola; si no, a la bandeja. */
  function beat(c, id, v) {
    var w = ensure(c), m = w.mentor, B = BEATS[id]; if (!B) return false;
    var seen = m.seen[id] | 0;
    if (B.max ? seen >= B.max || m.last[id] === (c.season | 0) : seen) return false;
    m.seen[id] = seen + 1; if (B.max) m.last[id] = c.season | 0;
    var lines = B.l.map(function (s) { return fill(s, v).slice(0, LINE_MAX); }).filter(function (s) { return s; });
    var q = { id: id, s: c.season | 0, l: lines, act: B.act ? fill(B.act, v) : '', al: B.al ? fill(B.al, v) : '' };
    if (!m.on) { inbox(c, q); return true; }
    m.q.push(q);
    while (m.q.length > Q_MAX) inbox(c, m.q.shift());   // la más vieja no se llega a ver: a la bandeja
    return true;
  }
  function slumpTip(c) {
    if ((c.fatigue | 0) > 40) return ['Vas con la fatiga por las nubes. Una semana de Descanso o el fisio y verás otra cosa.', 'player:train', 'Ver entreno'];
    if (c.mate && (c.mate.chem | 0) < 30) return ['Con ' + c.mate.name + ' aún no os entendéis. Jugad juntos, no simuléis: la química sale en la arena.', '', ''];
    if (c.player && (c.player.pts | 0) > 0) return ['Tienes puntos de mejora sin gastar. Úsalos antes del próximo partido.', 'player:atk', 'Mejorar'];
    return ['Simplifica: saque seguro, recepción alta y remate a la línea. Lo bonito, después.', '', ''];
  }
  /** Escena en pantalla (la primera de la cola): {id, title, lines[], act, actLabel, who, left} o null. */
  function mentorScene(c) {
    var w = c && c.world; if (!w || !w.mentor || !w.mentor.on || !Array.isArray(w.mentor.q) || !w.mentor.q.length) return null;
    var q = w.mentor.q[0]; if (!q || !BEATS[q.id]) return null;
    return { id: q.id, title: BEATS[q.id].t, lines: q.l || [], act: q.act || '', actLabel: q.al || '', who: MENTOR, left: w.mentor.q.length - 1 };
  }
  /** Vista entera («Vale» en la última frase): sale de la cola sin ir a la bandeja. */
  function mentorDone() { var c = K().load(); if (!c) return false; var w = ensure(c); if (!w.mentor.q.length) return false; w.mentor.q.shift(); K().save(c); return true; }
  /** «Saltar»: la escena actual sale de la cola y queda en la bandeja para releerla. */
  function mentorSkip() { var c = K().load(); if (!c) return false; var w = ensure(c); if (!w.mentor.q.length) return false; inbox(c, w.mentor.q.shift()); K().save(c); return true; }
  function mentorSkipAll() { var c = K().load(); if (!c) return false; var w = ensure(c); w.mentor.q.forEach(function (q) { inbox(c, q); }); w.mentor.q = []; K().save(c); return true; }
  /** Escenas sí/no (Palmarés › Opciones). Al apagar, lo pendiente va a la bandeja. */
  function setMentor(on) {
    var c = K().load(); if (!c) return false; var w = ensure(c);
    w.mentor.on = on ? 1 : 0;
    if (!on) { w.mentor.q.forEach(function (q) { inbox(c, q); }); w.mentor.q = []; }
    K().save(c); return true;
  }
  function mentorOn(c) { var w = c && c.world; return !(w && w.mentor && w.mentor.on === 0); }

  // ------------------------------------------------------------------ noticias de la liga (E5a, tarea C2)
  // Ligas del modo: hoy las 5 de la playa (índices de K().LEAGUES, 8 clubes, 14 jornadas, el open solo en tu liga). El lote C
  // (carrera-pista, ligas por país) solo tiene que cambiar leaguesOf/topLv: el resto de las noticias y los anales van por aquí.
  function leaguesOf(c) { var out = []; for (var i = 0; i < K().LEAGUES.length; i++) out.push(i); return out; }
  function topLv(c) { var l = leaguesOf(c); return l[l.length - 1]; }
  var NEWS_MAX = 60, ANNALS_MAX = 40, ROUND_MAX = 3, W_SUMMER = 0, W_END = 15;
  var STREAK_AT = { 4: 1, 6: 1, 8: 1, 11: 1, 14: 1 };   // rachas que son noticia (antes 4, 6, 8, 10, 12, 14: el colista salía cada dos jornadas)
  var MKT = true;   // mercado de verano inventado (pura ambientación; plan §3: apagable, lo decide Ferran)
  function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }
  function ordn(n) { return n + (n === 1 || n === 3 ? 'r' : 'º'); }
  // Plantillas (género neutro: «líder», «gana el Open», nunca «campeón»). {a}/{b} clubes, {sc} parciales, {L} «el Circuito…»,
  // {deL}/{enL}/{EnL} con artículo, {p} tú, {mate} tu pareja, {rv} tu rival, {nm} jugador inventado.
  var TPL = {
    upset: ['Campanada en {sede}: {a} tumba a {b}', '{b} tropieza contra {a}, {d} puntos de media por debajo', 'Nadie lo vio venir: {a} gana a {b} ({sc})', 'Sorpresa en {L}: {a} doblega a {b}'],
    rout: ['{a} pasa por encima de {b} ({sc})', 'Exhibición de {a}: {b} apenas suma {pts} puntos', '{b}, sin respuesta ante {a} ({sc})'],
    thriller: ['Infarto en el tercer set: {a} gana a {b} ({sc})', '{a} y {b} se van al tie-break y lo cierra {a} por la mínima', 'Partidazo en {sede}: {a} remonta y gana a {b} ({sc})'],
    leader: ['{a}, nuevo líder {deL}', 'Cambio arriba: {a} adelanta a {b} y manda {enL}', '{a} se sube al liderato tras la jornada {n}'],
    streak: ['{a} no para: {n} victorias seguidas', 'Racha de {a}: ya son {n} partidos sin perder', '¿Quién para a {a}? {n} triunfos seguidos'],
    skid: ['{a} no levanta cabeza: {n} derrotas seguidas', 'Crisis en {a}: {n} partidos sin ganar', 'Alarma en {sede}: {a} encadena {n} derrotas'],
    meWin: ['{p} firma {k} remates y {a} gana a {b}', '{a} gana a {b} con {p} como figura ({nota} de nota)', 'Gran partido de {p}: {a} {sc} {b}'],
    meUpset: ['{p} guía a {a} a una victoria de mérito contra {b}', 'Golpe de {a}: {p} y {mate} tumban a {b}'],
    rivalW: ['{rv} ({b}) responde: «La próxima vez no habrá suerte»', '{rv} se calla tras perder el duelo contra {p}'],
    rivalL: ['Duelo para {rv}: {b} gana a {a} y lo celebra en redes', '{rv} gana el duelo a {p} y presume en las entrevistas'],
    top: ['Mientras, {enL}: {a} sigue líder con {pts} puntos', '{EnL}, {a} gana a {b} ({sc}) y mira a todos desde arriba', 'Ojo a {a}: es la sensación {deL}'],
    mid: ['Ecuador {deL}: {a} manda con {pts} puntos', 'Media temporada {deL}: {a} líder, {b} colista'],
    champs: ['{a} gana {elL} en la temporada {n}'],
    open: ['{a} gana {elCup} ({sc})', '{a} se lleva {elCup} tras vencer a {b}'],
    moves: ['{txt}'],
    mkt: ['Rumor de verano: {nm} deja {b} y ficha por {a}', '{a} ficha a {nm}, una de las promesas {deL}', '{nm} renueva con {a} hasta la temporada {n}']
  };
  /** Variante de la plantilla (nunca la misma dos veces seguidas en un tipo: w.tpl). okv(i): variantes que se pueden usar. */
  function tpl(c, key, r, v, okv) {
    var w = ensure(c), L = TPL[key], idx = [];
    for (var j = 0; j < L.length; j++) if (!okv || okv(j)) idx.push(j);
    if (!idx.length) idx.push(0);
    var i = idx[Math.floor(r() * idx.length) % idx.length];
    if (idx.length > 1 && w.tpl[key] === i) i = idx[(idx.indexOf(i) + 1) % idx.length];
    w.tpl[key] = i;
    return { t: fill(L[i], v), v: i };
  }
  function addNews(c, k, x, ids, me, wk) {
    var w = ensure(c), rv = c.life && c.life.rival;
    ids = (ids || []).filter(function (id) { return id != null && id >= 0; });
    if (!me) me = ids.indexOf(c.myClub) >= 0 ? 1 : rv && ids.indexOf(rv.club) >= 0 ? 2 : 0;
    w.news.push({ id: ++w.newsN, s: c.season | 0, w: wk | 0, k: k, v: x.v | 0, t: x.t, c: ids, me: me | 0 });
    if (w.news.length > NEWS_MAX) w.news = w.news.slice(-NEWS_MAX);
  }
  function scTxt(sc) { return (sc || []).map(function (x) { return x[0] + '-' + x[1]; }).join(', '); }
  function flip(sc) { return sc.map(function (x) { return [x[1], x[0]]; }); }
  function artL(L) { return { deL: (L.art === 'la' ? 'de la ' : 'del ') + L.name, enL: 'en ' + L.art + ' ' + L.name, EnL: 'En ' + L.art + ' ' + L.name, L: L.art + ' ' + L.name }; }
  function sedeOf(k) { return k ? k.beach || k.city || k.name : ''; }
  /** «A y B» / «A, B e Ibiza» (y → e delante de i-/hi-). */
  function andList(a) {
    if (a.length < 2) return a.join('');
    var last = a[a.length - 1], y = /^(i|hi)(?!e)/i.test(String(last).normalize ? String(last).normalize('NFD').replace(/[̀-ͯ]/g, '') : last) ? ' e ' : ' y ';
    return a.slice(0, -1).join(', ') + y + last;
  }
  /** Racha actual de un club en su liga (+ victorias / − derrotas), hasta la jornada wk. */
  function streakOf(c, lvl, id, wk) {
    var n = 0, sign = 0, R = c.res && c.res[lvl] || [];
    for (var i = Math.min(wk, R.length - 1); i >= 0; i--) {
      var m = (R[i] || []).filter(function (x) { return x && (x.a === id || x.b === id); })[0]; if (!m) break;
      var win = (m.a === id) === (m.s[0] > m.s[1]) ? 1 : -1;
      if (!sign) sign = win; if (win !== sign) break; n++;
    }
    return n * sign;
  }
  /** Titulares de la jornada que acaba de cerrarse: máx. 2 de tu liga (uno por tipo, los de más peso) y, una de cada tres
   *  jornadas, 1 de otra liga. Tu partido solo es noticia si lo has JUGADO y ganado (simulado o en el banquillo, no). */
  function roundNews(c, sum) {
    var me = K().myClub(c); if (!me || !sum || sum.phase !== 'league' || !c.res) return;
    var lvl = lvOf(me), L = lgOf(me), wk = (c.phase === 'league' ? c.week : K().WEEKS) - 1, A = artL(L), r = rngOf(c.seed, 'news', c.season, wk);
    if (wk < 0) return;
    var res = (c.res[lvl] && c.res[lvl][wk]) || [], cand = [], w = ensure(c), J = wk + 1;
    res.forEach(function (m) {
      if (!m || !m.s || !m.sc) return;
      var win = m.s[0] > m.s[1], wa = K().club(c, win ? m.a : m.b), lb = K().club(c, win ? m.b : m.a), home = K().club(c, m.a);
      if (!wa || !lb) return;
      var sc = win ? m.sc : flip(m.sc), d = K().clubOvr(lb) - K().clubOvr(wa), mine = m.a === me.id || m.b === me.id;
      var v = { a: wa.name, b: lb.name, sc: scTxt(sc), sede: sedeOf(home), d: d, L: A.L, pts: sc.reduce(function (s, x) { return s + x[1]; }, 0) };
      if (mine) {
        if (sum.bench || sum.sim || !sum.win || wa.id !== me.id) return;
        v.p = c.player.name; v.k = (sum.me && sum.me.kills) | 0; v.nota = String(sum.nota).replace('.', ','); v.mate = c.mate ? c.mate.name : 'su pareja';
        cand.push({ sc: 6 + (d >= 4 ? 3 : 0), k: d >= 4 ? 'meUpset' : 'meWin', v: v, ids: [wa.id, lb.id], me: 1 });
        return;
      }
      var blow = m.s[0] + m.s[1] === 2 && sc.every(function (x) { return x[0] - x[1] >= 8; });
      var tb = m.s[0] + m.s[1] === 3 && sc[2] && Math.abs(sc[2][0] - sc[2][1]) <= 2;
      if (d >= 6) cand.push({ sc: 5 + d / 3, k: 'upset', v: v, ids: [wa.id, lb.id] });
      else if (tb) cand.push({ sc: 4, k: 'thriller', v: v, ids: [wa.id, lb.id] });
      else if (blow) cand.push({ sc: 3, k: 'rout', v: v, ids: [wa.id, lb.id] });
    });
    // tabla: cambio de líder (desde la jornada 3, misma liga y temporada) y rachas de 4, 6, 8…
    var t = K().table(c, lvl); if (!t.length) return;
    var lead = t[0].id, pl = w.lead[lvl], prev = pl && pl[0] === (c.season | 0) ? pl[1] : null;
    if (wk >= 2 && prev != null && prev !== lead && K().club(c, prev)) cand.push({ sc: 5.5, k: 'leader', v: { a: K().club(c, lead).name, b: K().club(c, prev).name, deL: A.deL, enL: A.enL, n: J }, ids: [lead, prev] });
    w.lead[lvl] = [c.season | 0, lead];
    K().clubsOf(c, lvl).forEach(function (k) {
      var s = streakOf(c, lvl, k.id, wk);
      if (!STREAK_AT[Math.abs(s)]) return;
      if (s > 0) cand.push({ sc: 3.5 + s / 4, k: 'streak', v: { a: k.name, n: s }, ids: [k.id] });
      else cand.push({ sc: 3 - s / 4, k: 'skid', v: { a: k.name, n: -s, sede: sedeOf(k) }, ids: [k.id] });
    });
    // tu rival personal: el duelo de CareerLife (sum.life.duel; jugado o simulado, nunca en el banquillo)
    var rv = c.life && c.life.rival, du = sum.life && sum.life.duel, rk = rv && K().club(c, rv.club);
    if (rv && du && rk && !sum.bench) cand.push({ sc: 7, k: du.win ? 'rivalW' : 'rivalL', v: { rv: du.name || rv.name, b: rk.name, a: me.name, p: c.player.name }, ids: [rk.id], me: 2 });
    if (wk === K().MID_WEEK - 1 && t.length > 1) cand.push({ sc: 6.5, k: 'mid', v: { a: K().club(c, lead).name, b: K().club(c, t[t.length - 1].id).name, pts: t[0].pts, deL: A.deL }, ids: [lead] });
    cand.sort(function (x, y) { return y.sc - x.sc; });
    var used = {}, n = 0;
    cand.forEach(function (x) {
      var g = x.k.indexOf('rival') === 0 ? 'rival' : x.k;
      if (n >= ROUND_MAX - 1 || used[g]) return; used[g] = 1; n++;
      addNews(c, x.k, tpl(c, x.k, r, x.v), x.ids, x.me, J);
    });
    // otra liga, una de cada tres jornadas: el líder del Mundial (o, si ya estás en el Mundial, el de la liga de debajo)
    if (wk % 3 === 1) {
      var lgs = leaguesOf(c), top = topLv(c), ol = lvl !== top ? top : lgs[lgs.indexOf(lvl) - 1];
      if (ol == null || !c.res[ol]) return;
      var OL = K().league(ol), ot = K().table(c, ol), lk = ot.length && K().club(c, ot[0].id); if (!lk) return;
      var om = (c.res[ol][wk] || []).filter(function (x) { return x && (x.a === lk.id || x.b === lk.id); })[0], B = artL(OL);
      var ob = om && K().club(c, om.a === lk.id ? om.b : om.a), won = om && (om.a === lk.id) === (om.s[0] > om.s[1]);
      var ov = { a: lk.name, pts: ot[0].pts, enL: B.enL, EnL: B.EnL, deL: B.deL, b: ob ? ob.name : '', sc: om ? scTxt(om.a === lk.id ? om.sc : flip(om.sc)) : '' };
      addNews(c, 'top', tpl(c, 'top', r, ov, function (i) { return i !== 1 || (ob && won); }), [lk.id], 0, J);
    }
  }
  /** Fin de temporada: anales (clasificación final de cada liga, opens y movimientos) y titulares. Va en el gancho 'season'
   *  (endSeason), ANTES de applyMoves: k.lvl aún es el de la temporada que acaba. */
  function seasonNews(c) {
    var w = ensure(c), me = K().myClub(c); if (!me || !c.res) return;
    var r = rngOf(c.seed, 'news-season', c.season), lgs = leaguesOf(c), ml = lvOf(me), an = { s: c.season | 0, lg: [], cup: [], up: [], dn: [] };
    lgs.forEach(function (L) {
      var ids = K().table(c, L).map(function (x) { return x.id; });
      an.lg.push(ids);
      an.cup.push(c.cup && c.cup.lvl === L && c.cup.champion >= 0 ? c.cup.champion : ids.length >= 4 ? simOpen(c, L, ids) : -1);
    });
    var moves = c.review && Array.isArray(c.review.moves) ? c.review.moves : [];
    moves.forEach(function (mv) { var k = K().club(c, mv.id); if (k) (mv.to > lvOf(k) ? an.up : an.dn).push(mv.id); });
    w.annals.push(an); if (w.annals.length > ANNALS_MAX) w.annals = w.annals.slice(-ANNALS_MAX);
    // campeones: el de tu liga con nombre entero y, si es otra, el de la liga más alta («En el Mundial, …»); los ids empiezan por el
    // tuyo (la noticia abre su ficha). (Antes era una lista de códigos cortos, «MA1 (Hiperliga)», que el jugador no ve en ningún sitio)
    var mi = lgs.indexOf(ml), champs = an.lg.map(function (t) { return t[0]; }), ti = lgs.length - 1;
    var elL = function (L) { return (L.art === 'la' ? 'la ' : 'el ') + L.name; }, kName = function (id) { var k = K().club(c, id); return k ? k.name : '?'; };
    if (mi >= 0 && champs[mi] != null) {
      var cht = fill(TPL.champs[0], { a: kName(champs[mi]), elL: elL(K().league(lgs[mi])), n: c.season });
      if (ti !== mi && champs[ti] != null) cht += '. En ' + elL(K().league(lgs[ti])) + ', ' + kName(champs[ti]);
      addNews(c, 'champs', { t: cht, v: 0 }, [champs[mi]].concat(champs.filter(function (x, i) { return i !== mi; })), 0, W_END);
    }
    // la final de tu open
    var cu = c.cup && c.cup.final && c.cup.res && c.cup.res[1] && c.cup.res[1][0];
    if (cu && cu.s && cu.sc) {
      var win = cu.s[0] > cu.s[1], ka = K().club(c, win ? cu.a : cu.b), kb = K().club(c, win ? cu.b : cu.a), cup = lgOf(me).cup;
      if (ka && kb) addNews(c, 'open', tpl(c, 'open', r, { a: ka.name, b: kb.name, elCup: (/^(Final|Copa)/.test(cup) ? 'la ' : 'el ') + cup, sc: scTxt(win ? cu.sc : flip(cu.sc)) }), [ka.id, kb.id], 0, W_END);
    }
    // ascensos y descensos: solo los de tu liga, en una frase
    var nm = function (ids) { return andList(ids.map(function (id) { var k = K().club(c, id); return k ? k.name : '?'; })); };
    var ups = an.up.filter(function (id) { var k = K().club(c, id); return k && lvOf(k) === ml; }), dns = an.dn.filter(function (id) { var k = K().club(c, id); return k && lvOf(k) === ml; });
    var upL = lgs.indexOf(ml) < lgs.length - 1 ? K().league(lgs[lgs.indexOf(ml) + 1]) : null, dnL = lgs.indexOf(ml) > 0 ? K().league(lgs[lgs.indexOf(ml) - 1]) : null, parts = [];
    if (ups.length && upL) parts.push('Suben ' + K().toL(upL) + ': ' + nm(ups));
    if (dns.length && dnL) parts.push((parts.length ? 'bajan ' : 'Bajan ') + K().toL(dnL) + ': ' + nm(dns));
    if (parts.length) addNews(c, 'moves', { t: parts.join('; '), v: 0 }, ups.concat(dns), 0, W_END);
  }
  /** Open de una liga que no es la tuya (career.js solo juega el de tu liga): 1-4 y 2-3, determinista, solo para los anales. */
  function simOpen(c, L, t) {
    var r = rngOf(c.seed, 'open-w', c.season, L), o = function (id) { var k = K().club(c, id); return (k ? K().clubOvr(k) : 50) + (r() - 0.5) * 4; };
    var win = function (a, b) { var q = K().quickSim(o(a), o(b), r, K().PTS); return q.sets[0] > q.sets[1] ? a : b; };
    return win(win(t[0], t[3]), win(t[1], t[2]));
  }
  /** Verano (gancho 'newSeason', ya en la temporada nueva): 2 rumores de mercado con jugadores inventados (ambientación). */
  function summerNews(c) {
    if (!MKT) return;
    var me = K().myClub(c); if (!me) return;
    var r = rngOf(c.seed, 'news-mkt', c.season), lvl = lvOf(me), A = artL(lgOf(me));
    var pool = K().clubsOf(c, lvl).filter(function (k) { return k.id !== me.id; });
    for (var i = 0; i < 2 && pool.length > 1; i++) {
      var a = pick(r, pool), b = pick(r, pool.filter(function (k) { return k.id !== a.id; })), m = K()._newMate(c, a, r);
      addNews(c, 'mkt', tpl(c, 'mkt', r, { a: a.name, b: b.name, nm: m.name, deL: A.deL, n: (c.season | 0) + 1 + Math.floor(r() * 2) }), [a.id, b.id], 0, W_SUMMER);
    }
  }
  /** Noticias de la más nueva a la más vieja (temporada, jornada —verano 0, fin 15— y orden de llegada). */
  function news(c, n) {
    var w = c && c.world; if (!w || !Array.isArray(w.news)) return [];
    var l = w.news.slice().sort(function (a, b) { return b.s - a.s || b.w - a.w || b.id - a.id; });
    return n ? l.slice(0, n) : l;
  }
  function newsUnseen(c) { var w = c && c.world; if (!w || !Array.isArray(w.news)) return 0; var s = w.newsSeen | 0; return w.news.filter(function (x) { return x.id > s; }).length; }
  /** Al abrir Liga › Noticias. Devuelve cuántas había sin ver. */
  function markNewsSeen() { var c = K().load(); if (!c) return 0; var w = ensure(c), n = newsUnseen(c); if (n) { w.newsSeen = w.newsN; K().save(c); } return n; }
  /** Antetítulo de una noticia: «T3 J5», «T3 Verano», «T3 Open» (la final) o «T3 Cierre» (campeones y movimientos). */
  function newsWhen(x) { return 'T' + x.s + ' ' + (x.w === W_SUMMER ? 'Verano' : x.w >= W_END ? (x.k === 'open' ? 'Open' : 'Cierre') : 'J' + x.w); }

  // ------------------------------------------------------------------ enciclopedia de clubes (E5b)
  // Apodos de cosas del mar (no de personas): masculinos y femeninos sin marcar género de nadie.
  var NICKS = ['Los Cangrejos', 'La Marea', 'Las Gaviotas', 'Los Delfines', 'La Ola', 'Los Erizos', 'La Brisa', 'Las Medusas', 'Los Pelícanos', 'El Faro', 'La Espuma', 'Los Albatros',
    'Las Caracolas', 'El Oleaje', 'Los Tiburones', 'La Duna', 'Los Corsarios', 'La Resaca', 'Los Salinos', 'Las Mareas Vivas'];
  var MOTTOS = ['Nacido en la orilla', 'Arena en las venas', 'Ni un balón al suelo', 'De la cala al mundo', 'Sol, sal y bloqueo', 'Siempre de cara al viento', 'La red es nuestra casa', 'Cada punto, una ola'];
  /** Historia inventada (pura, por semilla e id; no se guarda): fundación, apodo, lema y títulos de antes de tu carrera. */
  function lore(c, k) {
    if (!c || !k) return null;
    var r = rngOf(c.seed, 'lore', k.id), ym = /(\d{4})$/.exec(k.name || ''), lv = lvOf(k) | 0;
    var founded = ym ? +ym[1] : 1962 + Math.floor(r() * 50);
    var old = Math.max(0, Math.min(4, Math.round((k.q != null ? k.q : 0.5) * 3 * r() + lv * 0.6 * r() - 0.6)));
    var cups = Math.max(0, Math.min(4, Math.round(old * 0.8 * r() + r() - 0.4)));
    return { founded: founded, nick: pick(r, NICKS), motto: pick(r, MOTTOS), oldLg: old, oldCup: cups };
  }
  /** Filas de Liga › Clubes (orden de tabla): kit, posición, puntos, media, estrellas, cara a cara contigo y marcas. */
  function clubRows(c, lvl) {
    if (!c || !c.clubs) return [];
    var w = ensure(c), rv = c.life && c.life.rival;
    return K().table(c, lvl).map(function (row) {
      var k = K().club(c, row.id); if (!k) return null;
      var h = w.h2h[k.id];
      return { id: k.id, name: k.name, short: k.short, kit: k.kit, pos: row.pos, pts: row.pts, pj: row.pj, ovr: K().clubOvr(k), stars: K().clubInfo(c, k).stars,
        vs: h && h[0] ? { pj: h[0], g: h[1], p: h[2] } : null, mine: k.id === c.myClub, rival: !!(rv && rv.club === k.id) };
    }).filter(function (x) { return x; });
  }
  /** Ficha de un club: datos, historia inventada, palmarés de tu carrera (anales y, antes del sprint, tus trofeos con él),
   *  trayectoria (8 últimas temporadas), forma y cara a cara. null si el id no existe. */
  function clubCard(c, id) {
    if (!c || !c.clubs) return null;
    var w = ensure(c), k = K().club(c, id); if (!k) return null;
    var inf = K().clubInfo(c, k), lo = lore(c, k), lvl = lvOf(k), titles = [], path = [], lgs = leaguesOf(c), seenT = {};
    var addT = function (t) { var key = t.s + ':' + t.kind; if (seenT[key]) return; seenT[key] = 1; titles.push(t); };
    w.annals.forEach(function (a) {
      for (var i = 0; i < a.lg.length; i++) {
        var p = a.lg[i].indexOf(id); if (p < 0) continue;
        var L = lgs[i] != null ? lgs[i] : i, up = a.up.indexOf(id) >= 0, dn = a.dn.indexOf(id) >= 0;
        path.push({ s: a.s, lvl: L, league: K().league(L).short, pos: p + 1, move: up ? 1 : dn ? -1 : 0 });
        if (p === 0) addT({ s: a.s, kind: 'liga', name: K().league(L).name });
        if (a.cup[i] === id) addT({ s: a.s, kind: 'copa', name: K().league(L).cup });
        if (up && i < lgs.length - 1) addT({ s: a.s, kind: 'ascenso', name: 'Ascenso ' + K().toL(K().league(lgs[i + 1])) });
      }
    });
    // temporadas de antes del sprint 5 (antes de w.since): tus trofeos con este club, «(contigo)»
    (c.trophies || []).forEach(function (t) {
      if (t && t.club === k.name && t.kind !== 'premio' && (t.season | 0) < (w.since | 0)) addT({ s: t.season | 0, kind: t.kind, name: t.name, you: 1 });
    });
    titles.sort(function (a, b) { return a.s - b.s; });
    var t = K().table(c, lvl), row = t.filter(function (x) { return x.id === id; })[0], h = w.h2h[id], rv = c.life && c.life.rival;
    var form = [], R = c.res && c.res[lvl] || [], wk = Math.min(c.phase === 'league' ? c.week - 1 : R.length - 1, R.length - 1);
    for (var i = wk; i >= 0 && form.length < 5; i--) { var m = (R[i] || []).filter(function (x) { return x && (x.a === id || x.b === id); })[0]; if (m) form.unshift((m.a === id) === (m.s[0] > m.s[1]) ? 1 : 0); }
    var mySeasons = (c.history || []).filter(function (x) { return x && x.club === id; }).map(function (x) { return x.season; });
    if (c.myClub === id && mySeasons.indexOf(c.season) < 0) mySeasons.push(c.season);
    return { id: id, name: k.name, short: k.short, kit: k.kit, city: k.city, beach: k.beach || '', league: inf.league, lvl: lvl, stars: inf.stars, style: inf.style, ovr: inf.ovr,
      lore: lo, pos: row && row.pj ? row.pos : 0, pts: row ? row.pts : 0, pj: row ? row.pj : 0, form: form, titles: titles, path: path.slice(-8),
      vs: h && h[0] ? { pj: h[0], g: h[1], p: h[2], sf: h[3], sc: h[4], last: h[5] } : null,
      rival: rv && rv.club === id ? { name: rv.name, w: rv.w | 0, l: rv.l | 0 } : null, mine: c.myClub === id, mySeasons: mySeasons, since: w.since | 0 };
  }

  // ------------------------------------------------------------------ ganchos de career.js (después de CareerLife)
  function afterMatch(c, sum) {
    if (!sum) return;
    var w = ensure(c), T = c.career || {};
    if (!sum.bench && sum.sets) addH2h(w, sum.rival, sum.sets, sum.season);
    try { roundNews(c, sum); } catch (e) { try { console.error('CareerWorld roundNews', e); } catch (e2) { } }
    if (sum.bench) { beat(c, 'bench1'); return; }
    if (sum.win && (T.won | 0) === 1) beat(c, 'win1');
    if (!sum.win && (T.played | 0) - (T.won | 0) === 1) beat(c, 'loss1');
    if (c.life && c.life.rival && c.life.rival.name) beat(c, 'rival', { rival: c.life.rival.name });
    if (c.life && c.life.streak === 5) beat(c, 'streak');
    var ln = (c.notes || []).slice(-3);
    if (!sum.win && ln.length === 3 && ln.every(function (n) { return n && !n.win; })) { var tp = slumpTip(c); beat(c, 'slump', { n: 3, tip: tp[0], act: tp[1], al: tp[2] }); }
  }
  function cupTitle(cup) { return 'Título ' + (/^(Final|Copa)/.test(cup) ? 'de la ' : 'del ') + cup; }
  function seasonEnd(c) {
    var r = c.review || {}, me = K().myClub(c); if (!me) return;
    try { seasonNews(c); } catch (e) { try { console.error('CareerWorld seasonNews', e); } catch (e2) { } }
    var L = lgOf(me);
    if (r.champion || r.cup) beat(c, 'title', { title: r.champion ? 'Título ' + (L.art === 'la' ? 'de la ' : 'del ') + L.name : cupTitle(L.cup) });
    if (r.awards && r.awards.length) beat(c, 'award', { award: r.awards[0] });
    var up = K().league(lvOf(me) + 1);
    if (r.move > 0 && up) beat(c, 'up', { toL: K().toL(up) });
    if (r.move < 0) beat(c, 'down');
  }
  function seasonStart(c) {
    try { summerNews(c); } catch (e) { try { console.error('CareerWorld summerNews', e); } catch (e2) { } }
    var me = K().myClub(c);
    if (me && lvOf(me) >= K().LEAGUES.length - 1) beat(c, 'top');
    if (c.player && (c.player.age | 0) >= 30) beat(c, 'vet');
  }
  function onJoin(c) {
    var T = c.career || {}, me = K().myClub(c); if (!me) return;
    if ((T.played | 0) === 0 && !(T.bench | 0)) beat(c, 'debut', { club: me.name });
    else beat(c, 'move', { mate: c.mate ? c.mate.name : 'tu pareja' });
  }
  function hook(c, kind, a, b) {
    if (!c) return;
    if (kind === 'match') afterMatch(c, a, b);
    else if (kind === 'season') seasonEnd(c);
    else if (kind === 'newSeason') seasonStart(c);
    else if (kind === 'create') { ensure(c); beat(c, 'hola'); }
    else if (kind === 'join') onJoin(c, a);
  }

  VB.CareerWorld = {
    hook: hook, ensure: ensure, MENTOR: MENTOR, BEATS: BEATS, BEAT_ORDER: BEAT_ORDER, LINE_MAX: LINE_MAX, Q_MAX: Q_MAX,
    mentorScene: mentorScene, mentorDone: mentorDone, mentorSkip: mentorSkip, mentorSkipAll: mentorSkipAll, setMentor: setMentor, mentorOn: mentorOn,
    _beat: beat, _slumpTip: slumpTip,
    // E5 (C2): noticias y enciclopedia de clubes
    TPL: TPL, NEWS_MAX: NEWS_MAX, ANNALS_MAX: ANNALS_MAX, W_SUMMER: W_SUMMER, W_END: W_END, MKT: MKT,
    news: news, newsUnseen: newsUnseen, markNewsSeen: markNewsSeen, newsWhen: newsWhen,
    lore: lore, clubRows: clubRows, clubCard: clubCard, leaguesOf: leaguesOf, _andList: andList, _ordn: ordn
  };
})();
