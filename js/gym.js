/* MAKE THE CUT — js/gym.js (owner: ui_main)
 * Entrenamiento (E6): datos y guardado de los ejercicios, sin DOM. La mecánica (montaje, puntuación por repetición, eventos
 * drillStage / drillRep / drillEnd) es de la sim (VB.DRILL, VB.Sim.drillStage); la interfaz (página #mpGym, #drillBar, hoja
 * .drill) es de ui.js. index.html lo carga después de prog.js. En el código el modo se llama «drill» / VB.Gym; en pantalla,
 * «Entrenamiento» (el prefijo gym* de ui.js es otra cosa: el ensayo de estilos del telón).
 *
 * Guardado: localStorage 'voley3d.gym' (JSON, v1):
 *   { v:1, d:{ serve:{b,m,n,t}, recv:{…}, set:{…}, atk:{…}, block:{…} }, free:{rally}, xp:{ serve:2, … } }
 *   b = récord (0-40), m = medalla 0-3, n = intentos, t = fecha del récord (ms), rally = peloteo más largo (toques),
 *   xp = nivel de medalla ya cobrado (evita cobrar dos veces, también tras unir con la cuenta).
 * Cuentas: NO se sincroniza en este sprint (account.js lo tiene detrás de GYM_SYNC = false hasta que Ferran despliegue las
 * reglas de Firestore con 'gym'; la fusión por máximo ya está escrita allí).
 *
 * API (VB.Gym):
 *   DRILLS [{id, name, short, help}] en el orden de la página (5 con medallas + 'free'), IDS (los 5 con medallas),
 *   MEDALS {id:[bronce, plata, oro]}, XP [bronce, plata, oro] (experiencia por nivel nuevo, a cada uno de los dos jugadores),
 *   MAX (puntos máximos por ejercicio: 30), MEDAL_NAMES ['', 'Bronce', 'Plata', 'Oro'],
 *   load() → copia validada del guardado · save(o) · get(id) → {b,m,n,t} | null · drill(id) → fila de DRILLS | null
 *   medalOf(id, total) → 0..3 · record(id, total) → {best, prev, isBest, medal, newMedal, xp, n}
 *   recordRally(hits) → {best, isBest} · count() → medallas conseguidas (de 15) · nextOf(id) → id siguiente con medallas | null
 *   bestRally() → toques · reset() (pruebas).
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var KEY = 'voley3d.gym', VER = 1;

  var DRILLS = [
    { id: 'serve', name: 'Saque a diana', short: 'Saque', help: '10 saques a la diana que se mueve' },
    { id: 'recv', name: 'Recepción', short: 'Recepción', help: '10 saques de la CPU: déjala en la zona del colocador' },
    { id: 'set', name: 'Colocación', short: 'Colocación', help: 'Coloca a tu compañero: de dedos o en salto' },
    { id: 'atk', name: 'Remate', short: 'Remate', help: 'Tu compañero te coloca: remata a la diana' },
    { id: 'block', name: 'Bloqueo', short: 'Bloqueo', help: 'La CPU ataca: salta a tiempo y cierra' },
    { id: 'free', name: 'Peloteo libre', short: 'Peloteo', help: 'Sin marcador ni sets: practica lo que quieras' }
  ];
  var IDS = ['serve', 'recv', 'set', 'atk', 'block'];
  // Umbrales recalibrados con simtest «Gimnasio» (5) (tarea S). Manda VB.DRILL.kinds[id].medals de la sim si está cargada (lectura
  // perezosa: gym.js se carga antes que sim.js en algunas herramientas); esta copia es la reserva y debe coincidir.
  var MEDALS = { serve: [12, 18, 24], recv: [18, 24, 28], set: [16, 22, 27], atk: [12, 18, 23], block: [6, 11, 16] };
  var XP = [30, 50, 80];
  var MAX = 30, B_MAX = 40, RALLY_MAX = 999;

  function isId(id) { return IDS.indexOf(id) >= 0; }
  function num(v, lo, hi) { v = +v; if (!isFinite(v)) return lo; v = Math.floor(v); return v < lo ? lo : v > hi ? hi : v; }
  function empty() { return { v: VER, d: {}, free: { rally: 0 }, xp: {} }; }

  /** Valida un objeto cualquiera (JSON del guardado o de la cuenta) y devuelve uno limpio. Claves desconocidas, fuera. */
  function clean(o) {
    var out = empty();
    if (!o || typeof o !== 'object') return out;
    var d = o.d && typeof o.d === 'object' ? o.d : {};
    IDS.forEach(function (id) {
      var e = d[id];
      if (!e || typeof e !== 'object') return;
      out.d[id] = { b: num(e.b, 0, B_MAX), m: num(e.m, 0, 3), n: num(e.n, 0, 1e6), t: num(e.t, 0, 9e15) };
    });
    out.free.rally = num(o.free && o.free.rally, 0, RALLY_MAX);
    var x = o.xp && typeof o.xp === 'object' ? o.xp : {};
    IDS.forEach(function (id) { var v = num(x[id], 0, 3); if (v) out.xp[id] = v; });
    return out;
  }
  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { }
    if (!raw) return empty();
    try { return clean(JSON.parse(raw)); } catch (e) { return empty(); }
  }
  function save(o) {
    try { window.localStorage.setItem(KEY, JSON.stringify(clean(o))); return true; } catch (e) { return false; }
  }

  function medalsOf(id) {
    var k = VB.DRILL && VB.DRILL.kinds && VB.DRILL.kinds[id];
    return isId(id) ? (k && k.medals || MEDALS[id]) : null;
  }
  function medalOf(id, total) {
    var t = medalsOf(id); if (!t) return 0;
    total = +total || 0;
    return total >= t[2] ? 3 : total >= t[1] ? 2 : total >= t[0] ? 1 : 0;
  }

  /** Apunta el total de un ejercicio terminado. Si la medalla sube por encima de lo ya cobrado, da XP[nivel] a los dos
   *  jugadores del escuadrón (VB.Prog.addXP(0/1)) una vez por cada nivel nuevo. xp = experiencia dada a CADA jugador. */
  function record(id, total) {
    if (!isId(id)) return { best: 0, prev: 0, isBest: false, medal: 0, newMedal: false, xp: 0, n: 0 };
    total = num(total, 0, B_MAX);
    var o = load(), e = o.d[id] || { b: 0, m: 0, n: 0, t: 0 }, prev = e.b;
    var isBest = total > prev;
    e.n++;
    if (total > e.b) { e.b = total; e.t = Date.now(); }
    var medal = medalOf(id, total), newMedal = medal > e.m;
    if (newMedal) e.m = medal;
    var paid = o.xp[id] || 0, xp = 0;
    for (var lv = paid + 1; lv <= e.m; lv++) {
      xp += XP[lv - 1];
      if (VB.Prog && VB.Prog.addXP) { try { VB.Prog.addXP(0, XP[lv - 1]); VB.Prog.addXP(1, XP[lv - 1]); } catch (er) { } }
    }
    if (e.m > paid) o.xp[id] = e.m;
    o.d[id] = e; save(o);
    return { best: e.b, prev: prev, isBest: isBest, medal: medal, newMedal: newMedal, xp: xp, n: e.n };
  }
  function recordRally(hits) {
    hits = num(hits, 0, RALLY_MAX);
    var o = load(), isBest = hits > o.free.rally;
    if (isBest) { o.free.rally = hits; save(o); }
    return { best: o.free.rally, isBest: isBest };
  }
  function count() { var o = load(), s = 0; IDS.forEach(function (id) { s += o.d[id] ? o.d[id].m : 0; }); return s; }
  function nextOf(id) { var i = IDS.indexOf(id); return i < 0 ? null : IDS[(i + 1) % IDS.length]; }
  function get(id) { var e = load().d[id]; return e ? { b: e.b, m: e.m, n: e.n, t: e.t } : null; }
  function drill(id) { for (var i = 0; i < DRILLS.length; i++) if (DRILLS[i].id === id) return DRILLS[i]; return null; }

  VB.Gym = {
    KEY: KEY, VER: VER, DRILLS: DRILLS, IDS: IDS, MEDALS: MEDALS, XP: XP, MAX: MAX, MEDAL_NAMES: ['', 'Bronce', 'Plata', 'Oro'],
    load: load, save: save, clean: clean, get: get, drill: drill, medalsOf: medalsOf, medalOf: medalOf, record: record, recordRally: recordRally,
    count: count, nextOf: nextOf, bestRally: function () { return load().free.rally; },
    reset: function () { try { window.localStorage.removeItem(KEY); } catch (e) { } }
  };
})();
