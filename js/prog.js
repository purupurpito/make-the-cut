/* MAKE THE CUT — js/prog.js (owner: ui_main)
 * Estadísticas de tus jugadores y su progresión (base del modo Carrera, de momento en 2v2).
 *
 * Un «atleta» es un objeto { num, role, name?, lvl, xp, pts, st, matches, bp, bd, beq }:
 *   - st: 10 atributos 1-99 (las claves de VB.ATTR_KEYS, que sim.js convierte en perfil de IA y multiplicadores del humano con
 *     createGame({attrs}));
 *   - lvl/xp/pts/matches: nivel, experiencia, puntos de mejora y partidos jugados;
 *   - bp/bd/beq: insignias (js/badges.js): contadores de progreso, nivel desbloqueado de cada una (1 bronce, 2 plata, 3 oro) y
 *     las equipadas.
 * Cada partido da experiencia a cada atleta: base + sus puntos + victoria + sets ganados, por la dificultad. Al subir de nivel gana
 * PTS_LVL puntos de mejora; subir un atributo cuesta más cuanto más alto está (cost).
 *
 * Las funciones athlete* trabajan sobre un atleta cualquiera y NO guardan (las usa la Carrera con su propio jugador y su propio
 * guardado). Las de siempre (addXP(i), award, bump(i), attrs) trabajan sobre el escuadrón de Partido rápido (los atletas n.º 1 y
 * n.º 2) y guardan en localStorage ('voley3d.squad'); si no hay almacenamiento, funciona en memoria.
 * Guardado v1 (sin insignias) → v2: se migra solo, sin perder nada.
 * Sin DOM ni Three: lo usan main.js (atributos al crear el partido), ui.js (panel «Jugadores» y experiencia al acabar) y badges.js.
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var KEY = 'voley3d.squad', VER = 3;   // v3 (10-nov-2026): escuadrón inicial a media 50 (+10 a los guardados v1/v2, una vez)
  var KEYS = ['jump', 'speed', 'react', 'recv', 'dig', 'set', 'spike', 'ctl', 'block', 'serve'];
  var LABEL = { jump: 'Salto', speed: 'Velocidad', react: 'Reacción', recv: 'Recepción', dig: 'Defensa', set: 'Colocación',
    spike: 'Potencia', ctl: 'Control', block: 'Bloqueo', serve: 'Saque' };
  var HINT = { jump: 'Altura del salto y margen de timing al rematar y bloquear', speed: 'Velocidad punta y aceleración al correr',
    react: 'Recuperación tras plancha o fallo; la IA lee antes la jugada',
    recv: 'Margen y precisión al recibir el saque', dig: 'Margen y precisión al defender un remate', set: 'Margen y precisión al colocar',
    spike: 'Velocidad del remate', ctl: 'Margen y precisión del remate', block: 'Margen de timing, anchura de manos y acierto en el bloqueo',
    serve: 'Margen, fuerza y precisión del saque' };
  // Grupos para el panel
  var GROUPS = [['Físico', ['jump', 'speed', 'react']], ['Defensa', ['recv', 'dig', 'block']], ['Ataque', ['set', 'spike', 'ctl', 'serve']]];
  var START = 40, MAX = 99, PTS_LVL = 3, MAX_EQ = 6;
  // Perfil inicial de cada atleta (misma suma: 500, media 50 = la CPU, que juega sin atributos): el 1 es más rematador, el 2 más de
  // recepción y colocación. Antes sumaban 400 (media 40) y, desde que los atributos se notan, el jugador nuevo jugaba con un
  // handicap invisible (revisión de estadísticas, 10-nov-2026): los guardados v1/v2 suben +10 cada atributo al cargarse (UP3).
  var BASE = [
    { num: 1, role: 'Atacante', st: { jump: 55, speed: 50, react: 50, recv: 46, dig: 48, set: 44, spike: 56, ctl: 51, block: 52, serve: 48 } },
    { num: 2, role: 'Universal', st: { jump: 48, speed: 52, react: 52, recv: 55, dig: 52, set: 54, spike: 45, ctl: 48, block: 44, serve: 50 } }
  ];
  var UP3 = 10;
  // CPU de Partido rápido con un escuadrón por encima de 50: lleva atributos (todos iguales) = 50 + CPU_K × (media − 50). Sin esto,
  // con 90 se ganaba el 75 % de los puntos al Experto (sets 25-8). Con media ≤ 50 la CPU sigue sin atributos (sim idéntica).
  var CPU_K = 0.6;
  var DIFF_MUL = { easy: 0.7, normal: 1, hard: 1.3, expert: 1.6 };

  function clampI(v, a, b) { v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  // ---------------------------------------------------------------- atleta genérico
  /** Atleta nuevo. o = {num, role, name, st (parcial), start (valor de los atributos que falten; 40)}. */
  function newAthlete(o) {
    o = o || {};
    var st = {}, s0 = o.start != null ? clampI(o.start, 1, MAX) : START;
    KEYS.forEach(function (k) { st[k] = o.st && o.st[k] != null ? clampI(o.st[k], 1, MAX) : s0; });
    var a = { num: o.num != null ? o.num : 1, role: o.role || 'Universal', lvl: 1, xp: 0, pts: 0, st: st, matches: 0, bp: {}, bd: {}, beq: [] };
    if (o.name) a.name = String(o.name);
    return a;
  }
  /** Copia saneada de un atleta guardado s sobre la plantilla d (que se modifica y se devuelve). Acepta guardados sin insignias. */
  function saneAthlete(s, d) {
    d = d || newAthlete();
    if (!s || typeof s !== 'object') return d;
    d.lvl = clampI(s.lvl, 1, 999); d.xp = clampI(s.xp, 0, 1e9); d.pts = clampI(s.pts, 0, 9999); d.matches = clampI(s.matches, 0, 1e9);
    if (s.num != null && isFinite(+s.num)) d.num = clampI(s.num, 0, 99);
    if (typeof s.role === 'string' && s.role) d.role = s.role;
    if (typeof s.name === 'string' && s.name) d.name = s.name;
    if (s.st) KEYS.forEach(function (k) { if (s.st[k] != null) d.st[k] = clampI(s.st[k], 1, MAX); });
    d.bp = {}; d.bd = {}; d.beq = [];
    var k;
    if (s.bp && typeof s.bp === 'object') for (k in s.bp) if (isFinite(+s.bp[k]) && +s.bp[k] > 0) d.bp[k] = clampI(s.bp[k], 0, 1e9);
    if (s.bd && typeof s.bd === 'object') for (k in s.bd) { var lv = clampI(s.bd[k], 0, 3); if (lv > 0) d.bd[k] = lv; }
    if (s.beq && s.beq.length) for (var i = 0; i < s.beq.length && d.beq.length < MAX_EQ; i++) {
      var id = s.beq[i]; if (typeof id === 'string' && d.bd[id] && d.beq.indexOf(id) < 0) d.beq.push(id);
    }
    return d;
  }

  /** Experiencia para pasar del nivel lvl al siguiente. */
  function need(lvl) { return 80 + 40 * lvl; }
  /** Puntos de mejora que cuesta subir un atributo de v a v+1. */
  function cost(v) { return v < 50 ? 1 : v < 65 ? 2 : v < 80 ? 3 : 4; }
  /** Valoración global: media de los atributos. */
  function ovr(st) { var s = 0; KEYS.forEach(function (k) { s += st[k]; }); return Math.round(s / KEYS.length); }

  /** Experiencia de un partido para un atleta. p = {pts, kills, blocks, aces} (ui.js stats.p), r = {win, setsWon, difficulty}. */
  function matchXP(p, r) {
    p = p || {};
    var base = 25 + 6 * (p.pts || 0) + (r.win ? 40 : 0) + 10 * (r.setsWon || 0);
    return Math.round(base * (DIFF_MUL[r.difficulty] || 1));
  }
  /** Suma experiencia a un atleta y sube niveles (no guarda); devuelve {xp, lvlUp, pts, lvl}. */
  function athleteAddXP(a, xp) {
    var up = 0;
    a.xp += xp; a.matches++;
    while (a.xp >= need(a.lvl)) { a.xp -= need(a.lvl); a.lvl++; up++; a.pts += PTS_LVL; }
    return { xp: xp, lvlUp: up, pts: up * PTS_LVL, lvl: a.lvl };
  }
  /** Sube (d = 1) un atributo de un atleta (no guarda). Las mejoras son definitivas: d = -1 no hace nada. true si ha cambiado. */
  function athleteBump(a, k, d) {
    if (!a || KEYS.indexOf(k) < 0 || !(d > 0)) return false;
    var v = a.st[k];
    if (v >= MAX || a.pts < cost(v)) return false;
    a.pts -= cost(v); a.st[k] = v + 1;
    return true;
  }
  /** Atributos de un atleta para createGame({attrs}) (copia). */
  function athleteAttrs(a) { return a ? copy(a.st) : null; }

  // ---------------------------------------------------------------- escuadrón de Partido rápido (n.º 1 y n.º 2)
  function fresh() { return { v: VER, a: BASE.map(function (b) { return newAthlete({ num: b.num, role: b.role, st: b.st }); }) }; }
  function sane(o) {
    var f = fresh();
    if (!o || !o.a || !o.a.length) return f;
    for (var i = 0; i < 2; i++) {
      if (!o.a[i]) continue;
      var d = f.a[i];
      saneAthlete(o.a[i], d);
      // v1/v2 → v3: el escuadrón inicial pasó de media 40 a 50; los guardados de antes suben lo mismo (una vez, tope 99)
      if (!(o.v >= 3) && o.a[i].st) KEYS.forEach(function (k) { d.st[k] = Math.min(MAX, d.st[k] + UP3); });
      // el escuadrón de Partido rápido siempre es el 1 y el 2 (los guardados de antes, con el 7 y el 11, se renumeran sin perder nada)
      if (o.a[i].num !== BASE[i].num) f.renum = true;
      d.num = BASE[i].num; d.role = BASE[i].role;
    }
    return f;
  }
  var data = null;
  function load() {
    if (data) return data;
    var o = null; try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
    data = sane(o);
    var re = data.renum; delete data.renum;
    if (o && (o.v !== VER || re)) save(); // migración (v1 sin insignias → v2; dorsales 7 y 11 → 1 y 2)
    return data;
  }
  function save() { try { if (data) localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { } }
  /** Los dos atletas del escuadrón (objetos vivos: si se modifican, llamar a save()). */
  function squad() { return load().a; }

  /** Suma experiencia al atleta i del escuadrón y guarda. */
  function addXP(i, xp) { var r = athleteAddXP(load().a[i], xp); save(); return r; }
  /** Reparte la experiencia de un partido acabado. perP = [stats de n.º 1, stats de n.º 2]. */
  function award(perP, r) { return [0, 1].map(function (i) { return addXP(i, matchXP(perP[i], r)); }); }
  /** Sube (d = 1) un atributo del atleta i del escuadrón y guarda. true si ha cambiado. */
  function bump(i, k, d) { var ok = athleteBump(load().a[i], k, d); if (ok) save(); return ok; }
  /** Atributos para createGame({attrs}): [[n.º 1, n.º 2], cpu]. La CPU juega con el perfil de su nivel (cpu = null) mientras la
   *  media del escuadrón no pase de 50; por encima lleva cpuSt(media) en sus dos jugadores (CPU_K). */
  function attrs() {
    var d = load(), a = athleteAttrs(d.a[0]), b = athleteAttrs(d.a[1]), c = cpuSt((ovr(a) + ovr(b)) / 2);
    return [[a, b], c ? [c, copy(c)] : null];
  }
  /** Atributos de la CPU de Partido rápido para un escuadrón de media m (null si m ≤ 50). */
  function cpuSt(m) {
    if (!(m > 50)) return null;
    var v = clampI(50 + CPU_K * (m - 50), 1, MAX), st = {};
    KEYS.forEach(function (k) { st[k] = v; });
    return st;
  }
  function reset() { data = fresh(); save(); return data; }
  /** Pruebas: olvida lo cargado (vuelve a leer localStorage en el siguiente get). */
  function _reload() { data = null; return load(); }

  VB.Prog = { KEYS: KEYS, LABEL: LABEL, HINT: HINT, GROUPS: GROUPS, MAX: MAX, PTS_LVL: PTS_LVL, MAX_EQ: MAX_EQ, VER: VER, STORE: KEY,
    get: load, save: save, squad: squad, need: need, cost: cost, ovr: ovr, matchXP: matchXP, addXP: addXP, award: award, bump: bump,
    attrs: attrs, cpuSt: cpuSt, CPU_K: CPU_K, reset: reset, _fresh: fresh, _reload: _reload,
    newAthlete: newAthlete, saneAthlete: saneAthlete, athleteAddXP: athleteAddXP, athleteBump: athleteBump, athleteAttrs: athleteAttrs };
})();
