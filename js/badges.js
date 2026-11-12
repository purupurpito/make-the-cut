/* MAKE THE CUT — js/badges.js (owner: ui_main)
 * Insignias: 12 habilidades con tres niveles (1 bronce, 2 plata, 3 oro) que se desbloquean jugando y se equipan en cada atleta.
 *
 *   VB.Badges.LIST            catálogo [{id, name, icon (SVG inline), desc, fx [bronce, plata, oro], cond, unit, th [b, p, o]}]
 *   VB.Badges.ingest(e, g)    cuenta un evento de la sim de los jugadores del equipo 0 (solo partidos humanos: no demo, autopilot ni
 *                             depuración). ui.js la llama con cada evento del partido.
 *   VB.Badges.endMatch(g, win, athletes?)
 *                             suma lo contado al acabar el partido (más «partidos jugados» y «victorias») y devuelve las insignias
 *                             nuevas o que suben de nivel: [{slot, num, id, name, lvl, prev, tier, eq}]. athletes = [atleta del
 *                             hueco teams[0][0], atleta de teams[0][1]] (null = no cuenta); por defecto el escuadrón de Partido
 *                             rápido (VB.Prog.squad()), que se guarda solo. Con atletas propios (Carrera) guarda quien llama.
 *   VB.Badges.forPlayer(a)    {id: nivel} con las insignias EQUIPADAS del atleta (objeto vacío si ninguna) para createGame({badges}).
 *   VB.Badges.forSquad()      [[equipadas del 1, del 2], null] (null en el lugar de un atleta sin ninguna) para Partido rápido.
 *   VB.Badges.slots(a)        huecos para equipar: 2 + floor(nivel / 5), hasta 6.
 *   VB.Badges.toggle/equip/unequip(a, id), progress(a, id), level(a, id)  (no guardan).
 * El progreso vive en cada atleta (ver js/prog.js): a.bp = contadores, a.bd = {id: nivel desbloqueado}, a.beq = [ids equipados].
 * Los contadores usan la misma clave que la insignia (a.bp.canon = remates punto, etc.).
 * Sin DOM ni Three (se prueba en node: tools/badgetest.js).
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var TIERS = ['', 'bronce', 'plata', 'oro'];

  // Iconos de cómic: f = formas rellenas del color del nivel con contorno de tinta; l = trazos gruesos (tinta debajo, color encima);
  // k = detalles finos de tinta.
  var I = {
    canon: { f: '<circle cx="15" cy="12" r="6.5"/>', k: 'M10.6 9.4c2.6 1.3 5.6 1.3 8.6-.2M10.6 14.6c2.6-1.3 5.6-1.3 8.6.2', l: 'M2 8h4.5M1 12h5M2 16h4.5' },
    mira: { f: '<circle cx="12" cy="12" r="7"/>', k: 'M12 9.2a2.8 2.8 0 1 0 .01 0z', l: 'M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4' },
    rompemanos: { f: '<path d="M5 21v-9l1.4-6.5L8.6 11V3.8L10.8 11V2.8L13 11V3.8L15.2 11.5l2.6-3.2 1.6.9L17 21z"/>', k: 'M9 14.5l3 1.6-1.8 1.8 3.4 2.4', l: '' },
    seda: { f: '<path d="M20.5 2.5C11.5 3.5 6 9.5 5.2 18.6l1.6 1.6C16 19.4 22 13.5 20.5 2.5z"/>', k: 'M10 14.2h4.6M12.8 11h4', l: 'M3.2 21.8L15.4 8.6' },
    bombardero: { f: '<circle cx="10" cy="14.2" r="7"/><path d="M18.6 1.6l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#ffd23f"/>', k: 'M6.6 11.6a4 4 0 0 1 2.6-2.2', l: 'M14.4 8.8l2.6-2.6' },
    flotador: { f: '<path d="M3.5 20.5C3.6 10.3 9.8 3.8 21 3c-.4 11.4-6.8 17.4-17.5 17.5z"/>', k: 'M8 16l3.6-.2M11 12.8l3.6-.4M14 9.8l3-.6', l: 'M3 21L15.6 8.4' },
    muro: { f: '<rect x="2" y="4.5" width="20" height="16" rx="2"/>', k: 'M2 9.8h20M2 15.2h20M8 4.5v5.3M16 4.5v5.3M12 9.8v5.4M6 15.2v5.3M18 15.2v5.3', l: '' },
    ancla: { f: '', k: '', l: 'M12 7.4V20.6M7.4 10.6h9.2M4 13.4c.6 4.6 4 7.2 8 7.2s7.4-2.6 8-7.2M12 2.4a2.5 2.5 0 1 1-.01 0z' },
    red: { f: '<path d="M12 2l8.2 3v6.2c0 5.2-3.6 9.2-8.2 10.8-4.6-1.6-8.2-5.6-8.2-10.8V5z"/>', k: 'M3.8 9.4h16.4M4.6 14h14.8M7.4 17.8h9.2M9 3.2l-.4 16.4M15 3.2l.4 16.4', l: '' },
    motor: { f: '<path d="M13.6 1.6L4 14.2h6.4L9.2 22.4l9.8-12.8h-6.4z"/>', k: '', l: '' },
    sangrefria: { f: '', k: '', l: 'M12 2v20M3.4 7l17.2 10M3.4 17L20.6 7M9.4 3.6L12 5.6l2.6-2M9.4 20.4l2.6-2 2.6 2' },
    lider: { f: '<path d="M3 18.6L1.8 7.2l5.4 4.2L12 3.6l4.8 7.8 5.4-4.2L21 18.6z"/>', k: 'M3.4 15.4h17.2', l: '' }
  };
  function svg(id) {
    var c = I[id] || I.canon, s = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" stroke-linecap="round" stroke-linejoin="round">';
    if (c.l) s += '<path d="' + c.l + '" fill="none" stroke="#1d1530" stroke-width="5"/><path d="' + c.l + '" fill="none" stroke="currentColor" stroke-width="2.4"/>';
    if (c.f) s += '<g fill="currentColor" stroke="#1d1530" stroke-width="1.8">' + c.f + '</g>';
    if (c.k) s += '<path d="' + c.k + '" fill="none" stroke="#1d1530" stroke-width="1.5"/>';
    return s + '</svg>';
  }

  // Catálogo (efectos: los aplica sim.js con createGame({badges}); los textos solo los explican). Umbrales recalibrados en los arreglos
  // finales del sprint (bots de simtest en Carrera, control «uno»): Cañón, Ojo de halcón, Red de seguridad y Manos de seda salían de
  // bronce en 2-3 partidos y de oro en ~20; ahora ~6-10 partidos el bronce y ~60-110 el oro, como las demás. Ancla, al revés (oro en
  // ~200 partidos → ~120-150). Motor (llega sola jugando) a la mitad de efecto.
  var LIST = [
    { id: 'canon', name: 'Cañón', desc: 'Remate más rápido', fx: ['+0,6 m/s', '+1,2 m/s', '+1,8 m/s'], cond: 'Gana puntos con tus remates', unit: ['remate ganador', 'remates ganadores'], th: [100, 400, 1200] },
    { id: 'mira', name: 'Ojo de halcón', desc: 'Remate más preciso: la diana se abre menos', fx: ['−12 % de dispersión', '−22 %', '−32 %'], cond: 'Remata en el momento justo', unit: ['remate perfecto', 'remates perfectos'], th: [80, 300, 1000] },
    { id: 'rompemanos', name: 'Rompemanos', desc: 'Si tu remate toca el bloqueo, sale fuera más a menudo', fx: ['+8 %', '+16 %', '+24 %'], cond: 'Gana puntos con remates que tocan el bloqueo y salen fuera', unit: ['punto tocando el bloqueo', 'puntos tocando el bloqueo'], th: [10, 40, 120] },
    { id: 'seda', name: 'Manos de seda', desc: 'Tras tu colocación buena o perfecta, tu compañero remata con más margen y más fuerte', fx: ['+8 % de margen y +0,4 m/s', '+16 % y +0,8 m/s', '+25 % y +1,2 m/s'], cond: 'Coloca balones que tu compañero convierte en punto', unit: ['asistencia', 'asistencias'], th: [50, 200, 600] },
    { id: 'bombardero', name: 'Bombardero', desc: 'Saque en salto más fuerte (con la IA, saca más en salto)', fx: ['+0,7 m/s', '+1,4 m/s', '+2,1 m/s'], cond: 'Consigue aces', unit: ['ace', 'aces'], th: [10, 40, 120] },
    { id: 'flotador', name: 'Hoja seca', desc: 'Tu saque flotante baila más', fx: ['+15 % de baile', '+30 %', '+45 %'], cond: 'Saca en flotante en el momento justo', unit: ['saque flotante perfecto', 'saques flotantes perfectos'], th: [25, 100, 300] },
    { id: 'muro', name: 'Muro', desc: 'Bloqueo más fiable y de más calidad', fx: ['+4 % de bloqueo', '+8 %', '+12 %'], cond: 'Gana puntos de bloqueo', unit: ['punto de bloqueo', 'puntos de bloqueo'], th: [10, 40, 120] },
    { id: 'ancla', name: 'Ancla', desc: 'Más margen al recibir el saque', fx: ['+6 % de margen', '+12 %', '+18 %'], cond: 'Recibe saques en el momento justo', unit: ['recepción perfecta', 'recepciones perfectas'], th: [30, 120, 350] },
    { id: 'red', name: 'Red de seguridad', desc: 'Más alcance en defensa y plancha y más margen al defender remates', fx: ['+5 %', '+10 %', '+15 %'], cond: 'Defiende remates del rival', unit: ['defensa de remate', 'defensas de remate'], th: [100, 400, 1200] },
    { id: 'motor', name: 'Motor', desc: 'Corre más rápido', fx: ['+1,5 % de velocidad', '+3 %', '+4,5 %'], cond: 'Juega partidos', unit: ['partido jugado', 'partidos jugados'], th: [10, 40, 120] },
    { id: 'sangrefria', name: 'Sangre fría', desc: 'Con punto de set o de partido en juego, más margen en todos sus toques', fx: ['+8 % de margen', '+16 %', '+25 %'], cond: 'Gana puntos con punto de set o de partido en juego', unit: ['punto decisivo', 'puntos decisivos'], th: [10, 40, 120] },
    { id: 'lider', name: 'Líder', desc: 'Su compañero (IA) lee antes la jugada y afina sus toques', fx: ['un poco', 'bastante', 'mucho'], cond: 'Gana partidos', unit: ['victoria', 'victorias'], th: [5, 25, 80] }
  ];
  var BY = {};
  LIST.forEach(function (b) { b.icon = svg(b.id); BY[b.id] = b; });
  var IDS = LIST.map(function (b) { return b.id; });

  // ---------------------------------------------------------------- atleta
  function ensure(a) { if (!a.bp) a.bp = {}; if (!a.bd) a.bd = {}; if (!a.beq) a.beq = []; return a; }
  function slots(a) { return Math.min(6, 2 + Math.floor(((a && a.lvl) || 1) / 5)); }
  function levelFor(id, n) { var b = BY[id], l = 0; if (!b) return 0; for (var i = 0; i < 3; i++) if (n >= b.th[i]) l = i + 1; return l; }
  function level(a, id) { return (a && a.bd && a.bd[id]) | 0; }
  /** {n, lvl, next (umbral siguiente o null), base (umbral anterior), unit (texto según n), frac 0..1 hacia el siguiente}. */
  function progress(a, id) {
    var b = BY[id], n = (a && a.bp && a.bp[id]) | 0, lvl = level(a, id);
    var next = lvl < 3 ? b.th[lvl] : null, base = lvl > 0 ? b.th[lvl - 1] : 0;
    return { n: n, lvl: lvl, next: next, base: base, unit: b.unit[(next != null ? next : n) === 1 ? 0 : 1],
      frac: next == null ? 1 : Math.max(0, Math.min(1, (n - base) / Math.max(1, next - base))) };
  }
  /** Equipadas válidas (desbloqueadas, conocidas, sin repetir y como mucho slots(a)). */
  function equipped(a) {
    if (!a || !a.beq) return [];
    var out = [], max = slots(a);
    for (var i = 0; i < a.beq.length && out.length < max; i++) { var id = a.beq[i]; if (BY[id] && level(a, id) > 0 && out.indexOf(id) < 0) out.push(id); }
    return out;
  }
  function forPlayer(a) { var r = {}; equipped(a).forEach(function (id) { r[id] = level(a, id); }); return r; }
  function forSquad() {
    if (!VB.Prog) return null;
    var sq = VB.Prog.squad(), b = sq.map(function (a) { var r = forPlayer(a); return Object.keys(r).length ? r : null; });
    return b[0] || b[1] ? [b, null] : null;
  }
  function equip(a, id) {
    ensure(a);
    if (!BY[id] || level(a, id) < 1) return false;
    var eq = equipped(a); if (eq.indexOf(id) >= 0) return false;
    if (eq.length >= slots(a)) return false;
    eq.push(id); a.beq = eq; return true;
  }
  function unequip(a, id) { ensure(a); var eq = equipped(a), i = eq.indexOf(id); if (i < 0) return false; eq.splice(i, 1); a.beq = eq; return true; }
  /** Equipa o desequipa. Devuelve 'on' | 'off' | '' (no se puede: bloqueada o sin huecos). */
  function toggle(a, id) { return unequip(a, id) ? 'off' : equip(a, id) ? 'on' : ''; }

  // ---------------------------------------------------------------- contar durante el partido
  var cur = null, lastEndG = null;
  function newCur(g) {
    return { g: g, c: [{}, {}], prevKind: '', prevTeam: -1, hit0: null, server0: -1, setter: -1, setGood: false, assist: -1,
      blocker: -1, clutch: false, lastPt: null };
  }
  function slotOf(g, p) {
    if (p == null || !g || !g.teams) return -1;
    var t0 = g.teams[0];
    for (var i = 0; i < t0.length; i++) if (t0[i] === p || (typeof p === 'object' ? p.id != null && t0[i].id === p.id : t0[i].id === p)) return i;
    return -1;
  }
  function add(s, k, n, D) { if (s < 0 || s > 1) return; var c = cur.c[s]; c[k] = (c[k] || 0) + (n || 1); if (D) D.push([s, k, n || 1]); }
  function counts(g) { return !!g && !g.demo && !g.autopilot && !(VB.ctx && VB.ctx.debug && !VB.Badges._force); }

  function ingest(e, g) {
    if (!e || !counts(g)) return;
    if (e.type === 'newMatch') { cur = newCur(g); if (lastEndG === g) lastEndG = null; return; }
    if (lastEndG === g) return;               // partido ya cerrado (eventos tras gameOver)
    if (!cur || cur.g !== g) cur = newCur(g);
    var s;
    switch (e.type) {
      case 'hit': {
        s = e.team === 0 ? slotOf(g, e.player) : -1;
        var perfect = e.grade === 'perfect';
        if (e.kind === 'serve') {
          // con punto de set o de partido en juego (de cualquiera) al sacar
          cur.clutch = g.setPoint >= 0 || g.matchPoint >= 0;
          cur.setter = -1; cur.assist = -1; cur.blocker = -1; cur.hit0 = null; cur.server0 = s;
          if (s >= 0 && perfect && e.shot === 'float') add(s, 'flotador');
        } else if (s >= 0) {
          var recv = e.recv != null ? !!e.recv : (e.touch === 1 && cur.prevKind === 'serve' && cur.prevTeam === 1);
          var dig = e.dig != null ? !!e.dig : (e.touch === 1 && e.kind === 'pass' && cur.prevKind === 'spike' && cur.prevTeam === 1 && e.shot !== 'shank');
          if (recv && perfect) add(s, 'ancla');
          if (dig) add(s, 'red');
          if (e.touch === 1) { cur.setter = -1; cur.assist = -1; }
          // colocador: el 2º toque, o el 1r si fue colocación en salto (e.jset; el ataque es entonces el 2º)
          if ((e.touch === 2 || (e.touch === 1 && e.jset)) && e.kind !== 'spike') { cur.setter = s; cur.setGood = e.grade === 'perfect' || e.grade === 'good'; }
          if (e.kind === 'spike') {
            if (perfect) add(s, 'mira');
            cur.assist = (e.touch === 3 || (e.touch === 2 && cur.prevKind === 'set')) && cur.setter >= 0 && cur.setter !== s ? cur.setter : -1;
          }
        }
        if (e.team === 0) cur.hit0 = s >= 0 ? { s: s, kind: e.kind } : null;
        cur.prevKind = e.kind; cur.prevTeam = e.team;
        break;
      }
      case 'block':
        if (e.team === 0) cur.blocker = slotOf(g, e.player);
        cur.prevKind = 'block'; cur.prevTeam = e.team;
        break;
      case 'point': {
        // punto anulado por challenge: sim vuelve a pitar el punto y ui.js marca el nuevo con _ovr → se descuenta el anterior
        if (e._ovr && cur.lastPt) cur.lastPt.forEach(function (d) { var c = cur.c[d[0]]; c[d[1]] = Math.max(0, (c[d[1]] || 0) - d[2]); });
        var D = [];
        if (e.team === 0) {
          var h = cur.hit0, spk = h && h.kind === 'spike' ? h.s : -1;
          if (e.how === 'kill' && spk >= 0) {
            add(spk, 'canon', 1, D);
            var tool = e.tool != null ? !!e.tool : (e.reason === 'out' && e.lastKind === 'block');
            if (tool) add(spk, 'rompemanos', 1, D);
            var as = e.assist !== undefined ? slotOf(g, e.assist) : cur.assist;
            if (as >= 0 && as !== spk) add(as, 'seda', 1, D);
          }
          if (e.how === 'ace' && cur.server0 >= 0) add(cur.server0, 'bombardero', 1, D);
          if (e.how === 'block' && cur.blocker >= 0) add(cur.blocker, 'muro', 1, D);
          if (cur.clutch) { add(0, 'sangrefria', 1, D); add(1, 'sangrefria', 1, D); }
        }
        cur.lastPt = D;
        cur.hit0 = null; cur.setter = -1; cur.assist = -1; cur.blocker = -1; cur.prevKind = ''; cur.prevTeam = -1;
        break;
      }
    }
  }

  /** Cierra el partido: suma contadores, partidos y victorias a los atletas y devuelve lo desbloqueado o mejorado. */
  function endMatch(g, win, athletes) {
    if (g && lastEndG === g) return [];        // ya cerrado (dos llamadas para el mismo partido)
    var own = !athletes;
    if (own) { if (!VB.Prog) return []; athletes = VB.Prog.squad(); }
    var c = cur && (!g || cur.g === g) ? cur.c : [{}, {}], out = [];
    for (var s = 0; s < 2; s++) {
      var a = athletes[s]; if (!a) continue;
      ensure(a);
      var cs = c[s] || {}, k;
      for (k in cs) if (cs[k] > 0) a.bp[k] = (a.bp[k] | 0) + cs[k];
      a.bp.motor = (a.bp.motor | 0) + 1;
      if (win) a.bp.lider = (a.bp.lider | 0) + 1;
      for (var i = 0; i < LIST.length; i++) {
        var id = LIST[i].id, prev = level(a, id), lv = levelFor(id, a.bp[id] | 0);
        if (lv > prev) {
          a.bd[id] = lv;
          var eq = prev === 0 ? equip(a, id) : equipped(a).indexOf(id) >= 0; // nueva y con hueco libre: se equipa sola
          out.push({ slot: s, num: a.num, id: id, name: LIST[i].name, lvl: lv, prev: prev, tier: TIERS[lv], eq: eq });
        }
      }
    }
    if (own && VB.Prog) VB.Prog.save();
    lastEndG = g || null; cur = null;
    return out;
  }
  /** Texto de una novedad de endMatch: «¡Insignia nueva: Cañón (bronce)!» o «¡Cañón sube a plata!». */
  function label(u) { return u.prev ? '¡' + u.name + ' sube a ' + u.tier + '!' : '¡Insignia nueva: ' + u.name + ' (' + u.tier + ')!'; }

  VB.Badges = { LIST: LIST, IDS: IDS, BY: BY, TIERS: TIERS, svg: svg,
    ingest: ingest, endMatch: endMatch, forPlayer: forPlayer, forSquad: forSquad, slots: slots, equipped: equipped,
    equip: equip, unequip: unequip, toggle: toggle, level: level, levelFor: levelFor, progress: progress, label: label,
    _cur: function () { return cur; }, _reset: function () { cur = null; lastEndG = null; }, _force: false };
})();
