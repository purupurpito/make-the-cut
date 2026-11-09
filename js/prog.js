/* MAKE THE CUT — js/prog.js (owner: ui_main)
 * Estadísticas de tus jugadores y su progresión (base del modo Carrera, de momento en 2v2).
 *
 * Cada atleta de tu equipo (n.º 7 y n.º 11) tiene 10 atributos 1-99 (las claves de VB.ATTR_KEYS, que sim.js convierte en
 * perfil de IA y multiplicadores del humano con createGame({attrs})), un nivel, experiencia y puntos de mejora.
 *   - Cada partido da experiencia a cada atleta: base + sus puntos + victoria + sets ganados, por la dificultad.
 *   - Al subir de nivel gana PTS_LVL puntos de mejora; subir un atributo cuesta más cuanto más alto está (cost).
 * Se guarda en localStorage ('voley3d.squad'); si no hay almacenamiento, funciona en memoria.
 * Sin DOM ni Three: lo usan main.js (atributos al crear el partido) y ui.js (panel «Jugadores» y experiencia al acabar).
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var KEY = 'voley3d.squad', VER = 1;
  var KEYS = ['jump', 'speed', 'react', 'recv', 'dig', 'set', 'spike', 'ctl', 'block', 'serve'];
  var LABEL = { jump: 'Salto', speed: 'Velocidad', react: 'Reacción', recv: 'Recepción', dig: 'Defensa', set: 'Colocación',
    spike: 'Potencia', ctl: 'Control', block: 'Bloqueo', serve: 'Saque' };
  var HINT = { jump: 'Altura del salto', speed: 'Rapidez al correr', react: 'Lectura de la jugada cuando lo lleva la IA',
    recv: 'Margen de timing al recibir el saque', dig: 'Margen de timing al defender un remate', set: 'Margen de timing al colocar',
    spike: 'Velocidad del remate', ctl: 'Margen al rematar y diana más pequeña', block: 'Bloqueo cuando lo lleva la IA',
    serve: 'Margen y fuerza del saque' };
  // Grupos para el panel
  var GROUPS = [['Físico', ['jump', 'speed', 'react']], ['Defensa', ['recv', 'dig', 'block']], ['Ataque', ['set', 'spike', 'ctl', 'serve']]];
  var START = 40, MAX = 99, PTS_LVL = 3;
  // Perfil inicial de cada atleta (misma suma: 400): el 7 es más rematador, el 11 más de recepción y colocación
  var BASE = [
    { num: 7, role: 'Atacante', st: { jump: 45, speed: 40, react: 40, recv: 36, dig: 38, set: 34, spike: 46, ctl: 41, block: 42, serve: 38 } },
    { num: 11, role: 'Universal', st: { jump: 38, speed: 42, react: 42, recv: 45, dig: 42, set: 44, spike: 35, ctl: 38, block: 34, serve: 40 } }
  ];
  var DIFF_MUL = { easy: 0.7, normal: 1, hard: 1.3, expert: 1.6 };

  function clampI(v, a, b) { v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function fresh() {
    return { v: VER, a: BASE.map(function (b) { var st = {}; KEYS.forEach(function (k) { st[k] = b.st[k] != null ? b.st[k] : START; });
      return { num: b.num, role: b.role, lvl: 1, xp: 0, pts: 0, st: st, matches: 0 }; }) };
  }
  function sane(o) {
    var f = fresh();
    if (!o || !o.a || !o.a.length) return f;
    for (var i = 0; i < 2; i++) {
      var s = o.a[i], d = f.a[i]; if (!s) continue;
      d.lvl = clampI(s.lvl, 1, 999); d.xp = clampI(s.xp, 0, 1e9); d.pts = clampI(s.pts, 0, 9999); d.matches = clampI(s.matches, 0, 1e9);
      if (s.st) KEYS.forEach(function (k) { if (s.st[k] != null) d.st[k] = clampI(s.st[k], 1, MAX); });
    }
    return f;
  }
  var data = null;
  function load() {
    if (data) return data;
    var o = null; try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
    data = sane(o); return data;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { } }

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
  /** Suma experiencia y sube niveles; devuelve {xp, lvlUp, pts}. */
  function addXP(i, xp) {
    var a = load().a[i], up = 0;
    a.xp += xp; a.matches++;
    while (a.xp >= need(a.lvl)) { a.xp -= need(a.lvl); a.lvl++; up++; a.pts += PTS_LVL; }
    save();
    return { xp: xp, lvlUp: up, pts: up * PTS_LVL, lvl: a.lvl };
  }
  /** Reparte la experiencia de un partido acabado. perP = [stats de n.º 7, stats de n.º 11]. */
  function award(perP, r) { return [0, 1].map(function (i) { return addXP(i, matchXP(perP[i], r)); }); }
  /** Sube (d = 1) o baja (d = -1, devuelve los puntos) un atributo. Devuelve true si ha cambiado. */
  function bump(i, k, d) {
    var a = load().a[i]; if (!a || KEYS.indexOf(k) < 0) return false;
    var v = a.st[k];
    if (d > 0) { if (v >= MAX || a.pts < cost(v)) return false; a.pts -= cost(v); a.st[k] = v + 1; }
    else return false; // las mejoras son definitivas (como en una carrera)
    save(); return true;
  }
  /** Atributos para createGame({attrs}): [[n.º 7, n.º 11], null] (la CPU juega con el perfil de su nivel). */
  function attrs() { var d = load(); return [[copy(d.a[0].st), copy(d.a[1].st)], null]; }
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function reset() { data = fresh(); save(); return data; }

  VB.Prog = { KEYS: KEYS, LABEL: LABEL, HINT: HINT, GROUPS: GROUPS, MAX: MAX, PTS_LVL: PTS_LVL,
    get: load, save: save, need: need, cost: cost, ovr: ovr, matchXP: matchXP, addXP: addXP, award: award, bump: bump,
    attrs: attrs, reset: reset, _fresh: fresh };
})();
