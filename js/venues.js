/* VOLEY 3D — js/venues.js (owner: arena)
 * Registro de SEDES (mapas): datos puros, sin THREE. Lo leen arena.js (qué montar), ui.js (nombres y selector de
 * Ajustes · Imagen), main.js (validar los ajustes `mapHall` / `mapBeach` y ?map=) y career.js si quiere el nombre.
 *
 * kind = 'hall' | 'beach' es lo ÚNICO que llega a la sim (createGame({venue: kind})): el mapa solo cambia el escenario.
 * Cada sede: { kind, name (interfaz), short (selector de Ajustes), pad (protecciones de los postes y lonas, en mayúsculas), tier (1 regional .. 3 gran
 * cita), help (una línea para la ayuda del menú), sand [r,g,b] 0..1 (partículas de arena de fx.js; solo playa),
 * lights (modos de luz que admite el ajuste «Luz de playa»; sin lights = luz fija), night (sede de noche) }.
 *
 * Una sede está DISPONIBLE (sale en el selector y se puede elegir) cuando tiene constructor: las de serie (palau,
 * platja) siempre; las demás cuando su fichero js/venue-<id>.js llama VB.Arena.registerMap({id, …}) al cargar (ese
 * fichero va en index.html después de arena.js y antes de fx.js). Las sedes del plan sin fichero quedan aquí como
 * datos (nombre, nivel) pero list() no las devuelve. Añadir una sede = su entrada aquí (si no está) + su venue-<id>.js
 * + su <script>. Ver notes/arena.md «Sedes».
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  VB.VENUES = {
    palau: { kind: 'hall', name: 'Palau del Mar', short: 'Palau', pad: 'PALAU DEL MAR', tier: 2, builtin: true,
      help: 'Palau del Mar, pista cubierta de 18 × 9' },
    canrebot: { kind: 'hall', name: 'Poliesportiu Can Rebot', short: 'Can Rebot', pad: 'CAN REBOT', tier: 1, day: true,
      help: 'Can Rebot, el pabellón del barrio, pista de 18 × 9' },
    cupula: { kind: 'hall', name: 'Cúpula del Far', short: 'Cúpula', pad: 'CÚPULA DEL FAR', tier: 3, night: true,
      help: 'Cúpula del Far, la sede de las finales, pista de 18 × 9' },
    platja: { kind: 'beach', name: 'Platja Llarga', short: 'Platja', pad: 'PLATJA LLARGA', tier: 1, builtin: true, lights: ['dia', 'tarde'],
      sand: [0.98, 0.87, 0.66], help: 'Platja Llarga, vóley playa en pista de 16 × 8' },
    moll: { kind: 'beach', name: 'Moll de la Sorra', short: 'Moll', pad: 'MOLL DE LA SORRA', tier: 2, lights: ['dia', 'tarde'],
      sand: [0.9, 0.83, 0.68], help: 'Moll de la Sorra, vóley playa en el puerto, pista de 16 × 8' },
    fanals: { kind: 'beach', name: 'Cala dels Fanals', short: 'Fanals', pad: 'CALA DELS FANALS', tier: 3, night: true,
      sand: [0.73, 0.66, 0.56], help: 'Cala dels Fanals, vóley playa de noche, pista de 16 × 8' }
  };
  var DEF = { hall: 'palau', beach: 'platja' };
  var ready = { palau: true, platja: true };
  function kindOf(id) {
    if (id === 'beach' || id === 'playa') return 'beach';
    if (id === 'hall' || id === 'pabellon') return 'hall';
    var d = VB.VENUES[id]; return d ? d.kind : '';
  }
  function list(kind) {
    var out = [];
    for (var id in VB.VENUES) if (VB.VENUES[id].kind === kind && ready[id]) out.push(id);
    return out;
  }
  /** Semilla → índice (entero no negativo). Sin semilla, Math.random. */
  function pickIdx(n, seed) {
    if (!(n > 0)) return 0;
    if (seed == null || !isFinite(+seed)) return Math.floor(Math.random() * n) % n;
    var h = (+seed | 0) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
    return ((h % n) + n) % n;
  }
  VB.Venues = {
    DEF: DEF,
    def: function (id) { return VB.VENUES[id] || null; },
    kindOf: kindOf,
    /** Sedes DISPONIBLES de un tipo, en el orden del registro (la de serie primero). */
    list: list,
    ready: function (id) { return !!ready[id]; },
    /** Lo llama VB.Arena.registerMap: la sede pasa a estar disponible. */
    markReady: function (id) { if (VB.VENUES[id]) ready[id] = true; },
    /** ¿Valor válido para el ajuste del tipo? (un id disponible de ese tipo o 'rand') */
    valid: function (kind, v) { return v === 'rand' || (ready[v] === true && kindOf(v) === kind); },
    name: function (id) { var d = VB.VENUES[id]; return d ? d.name : ''; },
    /** Id del mapa que toca: `x` es un id (?map=fanals) o un tipo ('hall' | 'beach'); con un tipo manda el ajuste
     *  (settings.mapHall / settings.mapBeach; 'rand' = al azar con `seed`). Lo desconocido vuelve a la sede de serie. */
    resolve: function (x, settings, seed) {
      if (VB.VENUES[x] && ready[x]) return x;
      var kind = kindOf(x) || (settings && settings.arena === 'beach' ? 'beach' : 'hall');
      var pref = settings ? settings[kind === 'beach' ? 'mapBeach' : 'mapHall'] : '';
      if (pref === 'rand') { var L = list(kind); return L.length ? L[pickIdx(L.length, seed)] : DEF[kind]; }
      if (pref && ready[pref] && kindOf(pref) === kind) return pref;
      return DEF[kind];
    }
  };
})();
