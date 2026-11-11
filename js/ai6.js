/* =====================================================================
 * VOLEY 3D — js/ai6.js   (owner: sim)
 * IA de equipo del 6v6 (sprint 2, notes/diseno-6v6-carrera.md §1.2-1.4). Pura: sin DOM/THREE. Depende de VB.Sim y
 * VB.AI (se carga después de js/ai.js). En 2v2 no se usa nunca (ai.js y sim.js solo la llaman con g.rot / g.size === 6),
 * así que el 2v2 sigue idéntico.
 *
 * Reutiliza AI.update (movimiento, salto, timing aleatorio, plancha, toque desviado); aquí solo se decide:
 *   computeJob(g, t)        quién va al balón (1r toque con penalización por puesto, 2º el colocador, 3r el atacante elegido)
 *   pos(g, p)               dónde estar (recepción, saque propio, ataque propio con cobertura, bloqueo de zona y defensa perímetro)
 *   spot(g, p)              el sitio de la formación sin mirar quién va al balón (marca de posición del humano, su celda, el bot),
 *                           con la fase (.phase: recv, serve, set, attack, cover, block, net, dig) para las marcas del suelo (fx.js)
 *   humanOwns / setReady    humano sin movimientos solos: ¿el balón es suyo? ¿se le puede colocar? (HUM)
 *   placeServe(g, t, sv)    formaciones del saque: el que saca en sus zonas; el que recibe con la formación de su rotación (FORM.RECV:
 *                           3 receptores OH, OH, L a ~6 m y el colocador escondido), legal (overlapCount 0) antes de legalize
 *   passTarget(g, p, hard)  destino de la recepción/defensa (sim.hit, 1r toque)
 *   chooseSet(g, p, lane)   el colocador elige atacante y tempo (sim.hit, 2º toque): bola alta a punta, tensa al opuesto, rápida al
 *                           central o «pipe» al zaguero; lane ('left'|'right'|'mid'|'back', del stick del colocador humano) fuerza el carril
 *   laneOf(g, p, mx, my)    carril que pide el stick del colocador humano (coordenadas locales), o null
 * Coordenadas locales de equipo: d = metros desde la red hacia el propio fondo, yl = lateral (+ = derecha del equipo).
 * x = side(t)·d, y = side(t)·yl (CONTRACT §3). Sin asignaciones por frame en pos/computeJob.
 * ===================================================================== */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;
  var VB = root.VB = root.VB || {};
  var S = VB.Sim, C = VB.C;
  var side = S.side, clamp = S.clamp;

  /* ---------- Tablas (formaciones v1) ---------- */
  var FORM = {
    passTo: { d: 1.5, yl: 0.9, apex: 4.1 },    // recepción: al colocador («zona 2,5»)
    digTo: { d: 2.2, yl: 0.5, apex: 3.9 },     // defensa de remate: algo más separada de la red
    setSpot: { d: 0.9, yl: 0.9 },     // donde espera el colocador la recepción
    // carril de cada puesto delantero en defensa (bloqueo de zona): punta a la izquierda, central al medio, S/OPP a la derecha
    netLane: { OH: -2.6, MB: 0, OPP: 2.6, S: 2.6, L: 0 },
    netD: 1.0,
    // zagueros en defensa perímetro (puesto de especialidad tras el saque): líbero en 5, punta en 6, colocador/opuesto en 1
    back: { L: { d: 6.6, yl: -2.9 }, MB: { d: 6.6, yl: -2.9 }, OH: { d: 7.8, yl: 0 }, OPP: { d: 6.6, yl: 2.9 }, S: { d: 6.6, yl: 2.9 } },
    // inicio de la carrera de batida (ataque propio, antes de la colocación); pipe: el zaguero arranca detrás de los 6 m, en su carril
    approach: { OH: { d: 3.8, yl: -3.3 }, OPP: { d: 3.8, yl: 3.3 }, MB: { d: 2.8, yl: -0.2 }, pipe: { d: 6.0 } },
    // destino de la colocación por tempo (d, yl, ápice). pipe: detrás de la línea de 3 m (con d >= 3,3 la IA despega a pr3 + 0,35
    // y su p.toX queda > C.ATTACK: 0 faltas de zaguero); el lateral sale de la zona del atacante (pipeY · yl de su zona)
    set: { high: { d: 1.4, yl: -3.4, apex: 4.7 }, shoot: { d: 1.4, yl: 3.4, apex: 4.3 }, quick: { d: 1.0, yl: -0.1, apex: 3.75 }, pipe: { d: 3.4, yl: 0, apex: 4.5 } },
    pipeY: 0.8,
    // peso de cada atacante para el colocador (bola en sistema); con recepción mala solo bola alta (OH, OPP); pipe solo en sistema
    setW: { OH: 1.0, OPP: 0.85, MB: 0.8, pipe: 0.45 },
    sysDig: 0.7, oosDig: 1.15,         // defensa rival del remate en sistema / fuera de sistema (× prob. de defender)
    blockErr: 1.8,                    // × el error de colocación del bloqueo (g.blockOff): con dos bloqueadores, más hueco entre manos
    digSys: 0.6,                      // calidad de la defensa para el colocador (× q): en transición casi siempre bola alta
    // formación de recepción en «W»: línea de 3 receptores (reserva si un puesto falta en RECV)
    recvD: 6.0, recvY: [-2.8, 0, 2.8],
    // Formaciones de recepción del 5-1 por rotación (índice = zona del colocador, 1..6), sitio {d, yl} de cada puesto: S, OPP, MB
    // (el central delantero), OHf (el receptor delantero), OHb (el receptor zaguero) y L (el líbero, que en recepción sustituye
    // siempre al central zaguero). Reciben los dos OH y el líbero a ~6 m (laterales ≈ −2,8 / 0 / 2,8, el orden lo manda la
    // legalidad); el colocador se esconde (delantero: en la red, junto a su punto; zaguero: detrás de su delantero cerca de la
    // red, o, con el receptor delante en zona 2, en la esquina del fondo); OPP y MB delanteros en la red, OPP zaguero al fondo
    // en su lado. Las 6 son legales con los centros (overlapCount 0 ANTES de legalize, que queda de red de seguridad).
    RECV: [null,
      { S: { d: 6.0, yl: 3.9 }, OHf: { d: 5.4, yl: 2.9 }, MB: { d: 1.0, yl: 0.0 }, OPP: { d: 1.0, yl: -2.6 }, OHb: { d: 6.0, yl: -2.8 }, L: { d: 6.2, yl: 0.0 } },   // S en 1
      { S: { d: 0.8, yl: 1.6 }, OHf: { d: 5.4, yl: -2.4 }, MB: { d: 1.0, yl: -3.2 }, OPP: { d: 8.0, yl: -3.2 }, OHb: { d: 6.2, yl: 0.2 }, L: { d: 6.0, yl: 2.8 } },  // S en 2
      { S: { d: 0.8, yl: 0.6 }, OHf: { d: 5.6, yl: -2.8 }, MB: { d: 1.0, yl: 1.9 }, OPP: { d: 8.0, yl: 1.2 }, OHb: { d: 6.0, yl: 2.8 }, L: { d: 6.2, yl: -0.3 } },   // S en 3
      { S: { d: 0.8, yl: -0.6 }, OHf: { d: 5.6, yl: 2.8 }, MB: { d: 1.0, yl: 0.4 }, OPP: { d: 8.0, yl: 3.2 }, OHb: { d: 6.0, yl: -2.8 }, L: { d: 6.2, yl: 0.0 } },   // S en 4
      { S: { d: 2.0, yl: -3.6 }, OHf: { d: 5.4, yl: -2.2 }, MB: { d: 1.0, yl: -3.2 }, OPP: { d: 1.0, yl: 2.6 }, OHb: { d: 6.2, yl: 0.0 }, L: { d: 6.0, yl: 2.8 } },  // S en 5
      { S: { d: 2.2, yl: 0.6 }, OHf: { d: 5.6, yl: -2.8 }, MB: { d: 1.0, yl: 2.8 }, OPP: { d: 1.0, yl: 0.2 }, OHb: { d: 6.0, yl: 2.8 }, L: { d: 6.2, yl: -0.4 } }],  // S en 6
    // penalización por puesto en quién va al balón (s): 1r toque, 2º toque
    pen1: { S: 0.35, L: -0.10, OH: -0.05, MB: 0.25, OPP: 0.15 },
    pen2: { S: -0.8, L: 0, OH: 0.15, MB: 0.2, OPP: 0.1 }
  };

  // humano en 6v6 (control Uno). Desde el 11-nov (Ferran: «deja que el jugador decida») el humano NO se mueve solo: ni a su
  // sitio ni al balón. Por eso el reparto de balones ya no puede dárselo «porque llegará»:
  //  area: balón a menos de area m del humano = suyo (está ahí); en el 1r toque también lo es el que cae en SU celda de la
  //        formación (el punto de toque está más cerca de su sitio, spot(), que del de cualquier compañero);
  //  cede: s que se suman los compañeros con un balón suyo (no le quitan el balón ni ocupan su sitio: si no va, cae);
  //  yield: s que se suma el humano con un balón que no es suyo (el compañero juega lo suyo aunque el humano esté algo más cerca;
  //        el humano se lo queda pulsando GOLPEAR, «¡mía!»);
  //  mine: «¡mía!» (pulsa GOLPEAR con el balón a menos de mine m del punto de toque: se lo queda);
  //  ask/askT: «¡Pídela!» (CAMBIAR: peso ×ask en chooseSet durante askT s); atkW: peso del humano como atacante;
  //  setD/setR/idleT: el colocador solo le da el balón si está a ≤ setD m de la red, a ≤ setR m del destino de la colocación y ha
  //        tocado el mando (stick o botón) en los últimos idleT s (no regala colocaciones al que está quieto o lejos);
  //  setDb: lo mismo para el humano zaguero candidato a pipe (su batida empieza a ~6 m: vale hasta setDb m de la red);
  //  own2: el 2º toque es del colocador humano si el punto de toque está a < own2 m de él (o en la zona de ataque, d < own2D)
  var HUM = { area: 1.5, cede: 0.45, yield: 0.25, mine: 1.6, ask: 2.5, askT: 3, atkW: 1.3, setD: 4.6, setR: 4.2, idleT: 3.5, setDb: 7.0, own2: 3.0, own2D: 4.0 };

  // objetivo compartido (sin asignaciones por frame). phase: fase de la formación para las marcas del suelo (fx.js), la postura de
  // cobertura (players.js) y los consejos (ui.js): '' (va al balón) | 'recv' | 'serve' | 'set' | 'attack' | 'cover' | 'block' | 'net' | 'dig'
  var _tg = { x: 0, y: 0, attack: false, block: false, phase: '' };
  function setTg(x, y, attack, block, phase) { _tg.x = x; _tg.y = y; _tg.attack = !!attack; _tg.block = !!block; _tg.phase = phase || ''; return _tg; }
  /** Objetivo en coordenadas locales del equipo t. */
  function loc(t, d, yl, attack, block, phase) { var sd = side(t); return setTg(sd * d, clamp(sd * yl, -4.4, 4.4), attack, block, phase); }
  function dOf(p) { return p.x * side(p.team); }
  function ylOf(p) { return p.y * side(p.team); }
  /** ¿Puede atacar por encima de la red desde delante? Delantero y no líbero. */
  function canAttack(p) { return p.front && p.role !== 'L' && !p.bench; }
  /** ¿Puede atacar de «pipe» (zaguero, despegando detrás de la línea de 3 m)? Receptor u opuesto zaguero en pista (no el líbero
   *  ni el colocador: el que coloca no remata, y el central zaguero solo está en pista cuando acaba de sacar). */
  function canPipe(p) { return !p.front && !p.bench && (p.role === 'OH' || p.role === 'OPP'); }
  /** Carril que pide el stick (mx, my: entrada de mundo) del colocador humano p, en coordenadas LOCALES de su equipo: lateral
   *  yl = side·my, profundidad d = side·mx (+ = hacia el propio fondo). |stick| < 0,4 → null (elige la IA); si manda el lateral:
   *  izquierda 'left' (bola alta a punta, zona 4), derecha 'right' (tensa al opuesto, zona 2); si manda la profundidad: hacia la
   *  red 'mid' (rápida al central), hacia atrás 'back' (pipe al zaguero). Pura (g no se usa; lo llama sim.hit, que le pasa el stick con
   *  su módulo de verdad —g.swingLen, el aim de la sim va normalizado desde 0,2—, y las pruebas). */
  function laneOf(g, p, mx, my) {
    if (!(mx * mx + my * my >= 0.16)) return null;
    var sd = side(p.team), yl = sd * my, d = sd * mx;
    if (Math.abs(yl) >= Math.abs(d)) return yl < 0 ? 'left' : 'right';
    return d < 0 ? 'mid' : 'back';
  }
  function setterOf(g, t) { var tm = g.teams[t]; for (var i = 0; i < tm.length; i++) if (tm[i].role === 'S') return tm[i]; return null; }

  /* ---------- Quién va al balón ---------- */
  function jobCost(g, p, pr) {
    var c = VB.AI.timeTo(g, p, pr.x, pr.y);
    if (p.z > 0.3) { var tl = (p.vz + Math.sqrt(p.vz * p.vz + 2 * C.G * Math.max(0, p.z))) / C.G; if (pr.t < tl + 0.15) c += 10; }
    return c;
  }
  /** Penalización (s) del puesto para el toque n (0 = 1r toque del equipo, 1 = 2º, 2 = 3r). */
  function rolePen(g, t, q, n, pr) {
    if (n === 0) { var a = FORM.pen1[q.role] || 0; return q.role === 'MB' || q.role === 'OPP' ? (q.front ? a : 0) : a; }
    if (n === 1) {
      if (q.role === 'L') return Math.abs(pr.x) < C.ATTACK + 0.3 ? 0.6 : 0; // el líbero de dedos delante de 3 m anula el ataque por arriba
      return FORM.pen2[q.role] || 0;
    }
    var pl = g.setPlan[t];
    if (pl && pl.to === q && pl.t === g.lastTouchT) return -0.8;
    return q.role === 'L' ? 0.6 : canAttack(q) ? 0 : 0.3;
  }
  /** ¿El balón (punto de toque pr) es claramente del humano hu? Si está a menos de HUM.area m de él (ha ido) o, en el 1r toque,
   *  si cae en su celda de la formación (más cerca de su sitio, spot(), que del sitio de cualquier compañero). El 2º toque es del
   *  colocador humano si cae a < HUM.own2 m de él o en la zona de ataque (d < own2D); si no (pase horrible), lo juega un
   *  compañero («colocador de emergencia»). Sin azar. */
  function humanOwns(g, t, hu, pr, n, excl) {
    if (Math.hypot(pr.x - hu.x, pr.y - hu.y) < HUM.area) return true;
    if (n === 1) return hu.role === 'S' && (Math.hypot(pr.x - hu.x, pr.y - hu.y) < HUM.own2 || pr.x * side(t) < HUM.own2D);
    if (n !== 0) return false;
    var s = spot(g, hu), d0 = Math.hypot(pr.x - s.x, pr.y - s.y), tm = g.teams[t];
    for (var i = 0; i < tm.length; i++) {
      var q = tm[i]; if (q === hu || q === excl || q.bench) continue;
      s = spot(g, q); if (Math.hypot(pr.x - s.x, pr.y - s.y) < d0) return false;
    }
    return true;
  }
  /** Mejor candidato del equipo t para el balón (tiempo hasta el balón + puesto), con la memoria por trayectoria de ai.js:
   *  solo cambia si otro llega claramente antes o el elegido no llega de ninguna manera. */
  function computeJob(g, t) {
    var sd = side(t), b = g.ball, pr = g.pr1;
    if (g.mode !== 'rally' || b.held) return null;
    if (pr.x * sd <= 0) return null;
    if (g.touchTeam === t && g.touches >= 3) return null;
    var mineN = g.touchTeam === t && g.lastKind !== 'serve' ? g.touches : 0;
    var tm = g.teams[t], excl = g.touchTeam === t && g.touches >= 1 ? g.lastPlayer : null;
    // 3r toque: el atacante elegido por el colocador, fijo como «el compañero» del 2v2 (en el aire el coste de jobCost
    // le daría por perdido justo al saltar a rematar)
    var pl = mineN === 2 && g.lastKind === 'set' ? g.setPlan[t] : null;
    if (pl && pl.to && pl.t === g.lastTouchT && pl.to !== excl && !pl.to.bench) return pl.to;
    var mem = g.jobMem && g.jobMemT[t] === g.lastTouchT ? g.jobMem[t] : null;
    if (mem === excl || (mem && mem.bench)) mem = null;
    // «¡mía!» (§1.5): el humano pulsa GOLPEAR cerca del punto de toque y le da tiempo a llegar: el balón es suyo
    var hu = t === 0 ? g.ctrl : null;
    if (hu && hu !== excl && g.swingLive && S.isHuman(g, hu) && Math.hypot(pr.x - hu.x, pr.y - hu.y) < HUM.mine && jobCost(g, hu, pr) < pr.t + 0.2) {
      if (mem !== hu) g.jobSwT[t] = g.time;
      g.jobMem[t] = hu; g.jobMemT[t] = g.lastTouchT;
      return hu;
    }
    // humano (sin movimientos automáticos): ¿el balón es claramente suyo? (HUM; solo su equipo y con humano de verdad)
    var hum = hu && hu !== excl && S.isHuman(g, hu) ? hu : null, own = hum ? humanOwns(g, t, hum, pr, mineN, excl) : false;
    var best = null, bc = 1e9, cm = 1e9;
    for (var i = 0; i < tm.length; i++) {
      var q = tm[i]; if (q === excl) continue;
      var c = jobCost(g, q, pr) + rolePen(g, t, q, mineN, pr);
      if (hum) c += q === hum ? (own ? 0 : HUM.yield) : (own ? HUM.cede : 0);
      if (q === mem) cm = c;
      else if (c < bc) { bc = c; best = q; }
    }
    var pick;
    if (mem) {
      var clearly = best && bc < cm - 0.3 && g.time - g.jobSwT[t] > 0.5 && pr.t > 0.4;
      // (un balón claramente del humano no se le quita porque «no llega»: ya no va solo; si no va, cae)
      var hopeless = best && !(own && mem === hum) && pr.t > 0.15 && cm > pr.t + 0.35 && bc < pr.t + 0.1 && bc < cm - 0.2 && g.time - g.jobSwT[t] > 0.25 && g.jobHop[t] !== g.lastTouchT;
      if (hopeless) g.jobHop[t] = g.lastTouchT;
      pick = (clearly || hopeless) ? best : mem;
    } else pick = best;
    if (pick) {
      if (!mem || pick !== mem) g.jobSwT[t] = g.time;
      g.jobMem[t] = pick; g.jobMemT[t] = g.lastTouchT;
    }
    return pick;
  }

  /* ---------- Dónde estar ---------- */
  function pos(g, p) {
    var t = p.team, sd = side(t), job = g.jobs[t];
    if (job === p) {
      // a rematar: el delantero siempre; el zaguero (pipe) solo si la colocación cae detrás de la línea de 3 m con margen (si se
      // queda corta la juega desde el suelo: así la IA no comete nunca falta de zaguero)
      if (S.atkPhase(g, t) && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) return setTg(g.pr3.x + sd * 0.35, g.pr3.y, canAttack(p) || (canPipe(p) && g.pr3.x * sd > C.ATTACK + 0.3), false);
      return setTg(g.pr1.x + sd * 0.2, g.pr1.y);
    }
    return spot(g, p);
  }
  /** Sitio de p en la formación de esta fase SIN mirar quién va al balón (recepción, saque propio, ataque propio con cobertura,
   *  bloqueo de zona, defensa perímetro). Es pos() para el que no juega el balón; para el humano, la marca de posición (fx.js) y
   *  su celda de responsabilidad (humanOwns). Devuelve el objeto compartido de setTg (copiar x/y antes de otra llamada) con la
   *  fase en .phase (ver _tg): fx.js dibuja la marca de esa fase y players.js la postura de cobertura. */
  function spot(g, p) {
    var t = p.team, lk = g.lastKind, tt = g.touchTeam;
    // durante el saque (setupServe deja lastKind ''; la IA no se mueve: ai.update sale si no hay peloteo) el sitio es el legal de
    // placeServe (p.fx/fy): 'recv' si saca el rival (el humano en Difícil/Experto puede moverse y que le piten), 'serve' si sacamos
    if (g.mode === 'serve') return setTg(p.fx, p.fy, false, false, g.server && g.server.team === t ? 'serve' : 'recv');
    if (lk === 'serve') return tt === t ? basePos(g, p) : recvPos(g, p);
    if (tt === t && g.touches < 3) return offPos(g, p);
    return defPos(g, p);
  }
  /** Recibiendo el saque: cada uno en su sitio de la formación; el colocador sale ya a su punto (penetración). */
  function recvPos(g, p) {
    if (p.role === 'S') return loc(p.team, FORM.setSpot.d, FORM.setSpot.yl, false, false, 'set');
    return setTg(p.fx, p.fy, false, false, 'recv');
  }
  /** Saque propio: al puesto de especialidad (delanteros a su carril en la red, zagueros a la defensa). */
  function basePos(g, p) {
    if (p.front) return loc(p.team, FORM.netD, FORM.netLane[p.role] || 0, false, false, 'serve');
    var B = FORM.back[p.role] || FORM.back.OH;
    return loc(p.team, B.d, B.yl, false, false, 'serve');
  }
  /** Balón propio (1 o 2 toques, o tras tocar nuestro bloqueo): carrera de batida, colocador al punto y cobertura del atacante. */
  function offPos(g, p) {
    var t = p.team, set = g.touches >= 2 && g.lastKind === 'set', sd = side(t);
    if (!set) {
      if (p.role === 'S' && g.lastPlayer !== p) return loc(t, FORM.setSpot.d, FORM.setSpot.yl, false, false, 'set');
      if (canAttack(p) && FORM.approach[p.role]) { var A = FORM.approach[p.role]; return loc(t, A.d, A.yl, false, false, 'attack'); }
      if (p.front) return loc(t, 1.8, 1.5, false, false, 'net'); // el colocador que hizo el 1r toque
      // zaguero que puede atacar de pipe: arranca la batida detrás de los 6 m en su carril, pero solo cuenta como batida ('attack') en
      // sistema, el mismo criterio con el que chooseSet reparte el pipe (recepción buena y colocador cerca de la red); fuera de sistema
      // el mismo sitio es su defensa ('dig': sin marca naranja ni «ataca» tras una defensa mala). El resto, a la defensa de su lado
      if (canPipe(p)) {
        var pq = g._pq6 && g._pq6[t], st = setterOf(g, t), sys = pq && g.time - pq.t < 3 && pq.q >= 0.45 && st && dOf(st) < 3.0;
        return loc(t, FORM.approach.pipe.d, S.ZONE[p.zone].yl * FORM.pipeY, false, false, sys ? 'attack' : 'dig');
      }
      var lb = p.role === 'OH' ? 0 : (p.role === 'S' || p.role === 'OPP') ? 2.2 : -2.2;
      return loc(t, 5.6, lb, false, false, 'dig');
    }
    // colocación en el aire: el atacante elegido va a la batida (si es el humano, aquí está su sitio); los demás cubren alrededor
    // del atacante (o del destino previsto)
    var pl = g.setPlan[t];
    if (pl && pl.to === p && pl.t === g.lastTouchT && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) return setTg(g.pr3.x + sd * 0.35, g.pr3.y, false, false, 'attack');
    var a = g.pr3.y * sd, lv = p.role === 'OH' ? (p.front ? -1 : 0) : p.role === 'MB' ? (p.front ? 0 : -1) : p.role === 'L' ? -1 : 1;
    // (el central zaguero, cuando no le ha cambiado el líbero porque acaba de sacar, cubre en el sitio del líbero: con lv 0 caía
    //  encima del receptor zaguero; revisión juego6 M3)
    if (p.front) return loc(t, 2.4, clamp(a + lv * 1.5, -4, 4), false, false, 'cover');
    return loc(t, 4.8, clamp(a * 0.6 + lv * 2.2, -4, 4), false, false, 'cover');
  }
  /** Balón del rival (o en camino): bloqueo de zona con 1-2 bloqueadores y defensa perímetro. */
  function defPos(g, p) {
    var t = p.team, opp = 1 - t, sd = side(t);
    var atk = S.atkPhase(g, opp) && g.pr3.x * side(opp) > 0; // el rival ya ha colocado: va a atacar
    if (p.front && p.role !== 'L') {
      if (atk) {
        var bp = blockPlan(g, t);
        if (p === bp.a || p === bp.b) {
          var pl = g.setPlan[opp], quick = pl && pl.tempo === 'quick' && pl.t === g.lastTouchT;
          // el error de colocación del bloqueador (g.blockOff: oficio del bloqueador IA, ±1,8 m con el perfil del compañero) no va en la
          // marca del humano: para él el sitio es la pista de dónde saltar (D8); acertar ya depende de su salto y su timing
          var c = clamp(g.pr3.y + (S.isHuman(g, p) ? 0 : g.blockOff[t] * FORM.blockErr * (quick ? 1.7 : 1)), -4.0, 4.0);
          var off = !bp.b ? 0 : (p === bp.lo ? -0.45 : 0.45);
          return setTg(sd * 0.6, clamp(c + off, -4.2, 4.2), false, true, 'block');
        }
        return loc(t, 3.0, (FORM.netLane[p.role] || 0) * 0.6, false, false, 'net'); // el que no bloquea: dejadas y balones tocados
      }
      return loc(t, FORM.netD, FORM.netLane[p.role] || 0, false, false, 'net');
    }
    var B = FORM.back[p.role] || FORM.back.OH, d = B.d, yl = B.yl;
    if (atk) { // perímetro: se abre hacia el lado del ataque; el de la línea del atacante sube un poco
      var ay = g.pr3.y * sd;
      yl = clamp(yl + 0.25 * ay, -3.9, 3.9);
      if (yl * ay > 0 && Math.abs(B.yl) > 1) d -= 0.6;
    }
    return loc(t, d, yl, false, false, 'dig');
  }
  /** Reparto del bloqueo (v1, de zona): el delantero cuyo carril está frente al ataque y, si es otro, el central (doble). */
  var _bp = { a: null, b: null, lo: null };
  function blockPlan(g, t) {
    var tm = g.teams[t], sd = side(t), Y = g.pr3.y, a = null, ad = 1e9, mb = null, sec = null, sd2 = 1e9;
    for (var i = 0; i < tm.length; i++) {
      var q = tm[i]; if (!q.front || q.role === 'L') continue;
      var d = Math.abs(sd * (FORM.netLane[q.role] || 0) - Y);
      if (d < ad) { ad = d; a = q; }
      if (q.role === 'MB') mb = q;
    }
    var b = mb && mb !== a ? mb : null;
    if (!b) for (var j = 0; j < tm.length; j++) { var r = tm[j]; if (!r.front || r.role === 'L' || r === a) continue; var e = Math.abs(sd * (FORM.netLane[r.role] || 0) - Y); if (e < sd2) { sd2 = e; sec = r; } }
    if (!b) b = sec;
    // el segundo solo llega si el ataque no está lejos de su carril (bola alta: casi siempre; rápida: a veces)
    if (b && Math.abs(b.y - Y) > 3.4) b = null;
    _bp.a = a; _bp.b = b; _bp.lo = b ? (a.y <= b.y ? a : b) : null; // lo = el de menor y (mundo): va a c - 0,45
    return _bp;
  }

  /* ---------- Formaciones del saque ---------- */
  var RANK = [0, 2, 2, 1, 0, 0, 1]; // posición lateral por zona (0 = izquierda, 1 = centro, 2 = derecha)
  var _D = [0, 0, 0, 0, 0, 0, 0], _Y = [0, 0, 0, 0, 0, 0, 0], _P = [null, null, null, null, null, null, null], _pas = [];
  var _fix = 0; // correcciones de legalize en el último placeServe (0 = las tablas ya eran legales; lo leen las pruebas)
  /** Coloca a los dos equipos para el saque: el que saca (t) en sus zonas base y el sacador detrás de la línea; el que recibe,
   *  con la formación de su rotación (FORM.RECV, 3 receptores y el colocador escondido), siempre legal (overlapCount 0).
   *  Guarda el sitio en p.fx/p.fy. */
  function placeServe(g, t, sv) {
    _fix = 0;
    for (var u = 0; u < 2; u++) {
      for (var z = 1; z <= 6; z++) _P[z] = S.onCourt(g, u, z);
      if (u === t) servingForm(); else recvForm();
      _fix += legalize();
      var sd = side(u);
      for (var k = 1; k <= 6; k++) { var p = _P[k]; p.x = p.fx = sd * _D[k]; p.y = p.fy = sd * _Y[k]; }
    }
    sv.x = side(t) * 10.3; sv.y = side(t) * 2.0; sv.fx = sv.x; sv.fy = sv.y;
  }
  function legalFixes() { return _fix; }
  function servingForm() {
    for (var z = 1; z <= 6; z++) { var Z = S.ZONE[z]; _D[z] = z >= 2 && z <= 4 ? FORM.netD : 7.2; _Y[z] = Z.yl * 0.9; }
  }
  /** Recepción: la tabla de la rotación (FORM.RECV por zona del colocador). Reserva («W» de 3 receptores por orden lateral) si la
   *  alineación no es la del 5-1 (sin colocador en pista, dos centrales en pista…). */
  function recvForm() {
    var zs = 0, z, p;
    for (z = 1; z <= 6; z++) if (_P[z].role === 'S') zs = z;
    var R = zs ? FORM.RECV[zs] : null, ok = !!R;
    if (R) for (z = 1; z <= 6; z++) {
      p = _P[z]; var front = z >= 2 && z <= 4, k = p.role === 'OH' ? (front ? 'OHf' : 'OHb') : p.role === 'MB' ? (front ? 'MB' : 'L') : p.role;
      var Q = R[k]; if (!Q) { ok = false; break; }
      _D[z] = Q.d; _Y[z] = Q.yl;
    }
    if (ok) return;
    _pas.length = 0;
    for (z = 1; z <= 6; z++) {
      p = _P[z]; var fr = z >= 2 && z <= 4, yl0 = S.ZONE[z].yl;
      if (p.role === 'OH' || p.role === 'L') { _pas.push(z); continue; }
      if (p.role === 'S') { _D[z] = fr ? 0.8 : 2.2; _Y[z] = fr ? yl0 * 0.7 : (z === 1 ? 3.7 : z === 6 ? 0.6 : -1.2); }
      else if (fr) { _D[z] = 1.0; _Y[z] = yl0 * 0.8; }   // central y opuesto delanteros: en la red, listos para atacar
      else { _D[z] = 8.0; _Y[z] = yl0 * 1.05; }               // opuesto zaguero (o central que no sustituye el líbero): al fondo
    }
    // receptores: ordenados por su posición lateral (y, a igualdad, el delantero primero) a los huecos de la línea
    _pas.sort(function (a, b) { return RANK[a] - RANK[b] || (b >= 2 && b <= 4 ? 1 : 0) - (a >= 2 && a <= 4 ? 1 : 0); });
    for (var i = 0; i < _pas.length; i++) { var zz = _pas[i]; _D[zz] = FORM.recvD; _Y[zz] = FORM.recvY[Math.min(i, 2)]; }
  }
  var FB = [[2, 1], [3, 6], [4, 5]], ROWS = [[4, 3, 2], [5, 6, 1]], GAP = 0.5, YMAX = 4.2;
  /** Corrige _D/_Y hasta que no haya solapamientos (margen GAP): zaguero detrás de su delantero y filas en orden lateral.
   *  Devuelve cuántas correcciones ha hecho (0 con las tablas legales de FORM.RECV: queda de red de seguridad). */
  function legalize() {
    var n = 0;
    for (var it = 0; it < 4; it++) {
      for (var i = 0; i < 3; i++) {
        var f = FB[i][0], k = FB[i][1];
        if (_D[k] < _D[f] + GAP) { n++; _D[k] = _D[f] + GAP; if (_D[k] > 8.6) { _D[k] = 8.6; _D[f] = Math.min(_D[f], 8.6 - GAP); } }
      }
      for (var r = 0; r < 2; r++) {
        var R = ROWS[r];
        for (var a = 1; a < 3; a++) if (_Y[R[a]] < _Y[R[a - 1]] + GAP) { n++; _Y[R[a]] = _Y[R[a - 1]] + GAP; }
        if (_Y[R[2]] > YMAX) { n++; _Y[R[2]] = YMAX; }
        for (var c = 1; c >= 0; c--) if (_Y[R[c]] > _Y[R[c + 1]] - GAP) { n++; _Y[R[c]] = _Y[R[c + 1]] - GAP; }
      }
    }
    return n;
  }

  /* ---------- Decisiones del toque (las llama sim.hit) ---------- */
  var _pt = { d: 0, yl: 0, apex: 4 };
  /** Destino del 1r toque (recepción/defensa) en coordenadas locales. Anota la calidad para el colocador. */
  function passTarget(g, p, hard, q) {
    var T = hard ? FORM.digTo : FORM.passTo;
    _pt.d = T.d; _pt.yl = T.yl; _pt.apex = T.apex;
    var pq = g._pq6 || (g._pq6 = [{ q: 0, t: -9 }, { q: 0, t: -9 }]);
    // la defensa de un remate casi nunca deja jugar en sistema (rápida): cuenta como peor recepción
    pq[p.team].q = (q == null ? 0.6 : q) * (hard ? FORM.digSys : 1); pq[p.team].t = g.time;
    return _pt;
  }
  /** ¿Puede el colocador darle el balón al humano q con destino (x, y) en el mundo? A ≤ HUM.setD m de la red (≤ setDb si es
   *  zaguero: su batida de pipe empieza a ~6 m), a ≤ HUM.setR m del destino y con el mando tocado en los últimos HUM.idleT s
   *  (g.hAct, sim.step). Quieto o lejos: el colocador busca a otro. (No se aplica al colocador humano: no es el atacante.) */
  function setReady(g, q, x, y) {
    return dOf(q) <= (q.front ? HUM.setD : HUM.setDb) && Math.hypot(q.x - x, q.y - y) <= HUM.setR && g.time - g.hAct <= HUM.idleT;
  }
  /** Tempo de la colocación al atacante q (y su carril para el stick del colocador humano, LANE). */
  function tempoOf(q) { return !q.front ? 'pipe' : q.role === 'MB' ? 'quick' : q.role === 'OPP' ? 'shoot' : 'high'; }
  var LANE = { high: 'left', shoot: 'right', quick: 'mid', pipe: 'back' };
  /** Lateral LOCAL del destino de la colocación al atacante q con el tempo tp (colocador p): la rápida junto al colocador, el pipe
   *  en el carril de la zona del zaguero (6 → centro, 1 → derecha, 5 → izquierda), el resto la tabla FORM.set. */
  function setY(g, p, q, tp) {
    if (tp === 'quick') return clamp(ylOf(p) - 1.0, -2.5, 2.5);
    if (tp === 'pipe') return q ? S.ZONE[q.zone].yl * FORM.pipeY : FORM.set.pipe.yl;
    return FORM.set[tp].yl;
  }
  var _sp = { d: 0, yl: 0, apex: 5 }, _cand = [], _w = [];
  /** El colocador elige atacante y tempo (2º toque). Delanteros que pueden atacar (sin el líbero ni quien coloca); el central
   *  (rápida) y los zagueros de pipe (canPipe) solo en sistema: recepción buena y el colocador cerca de la red. Peso del puesto
   *  (pipe bajo), menos si el bloqueo rival ya está enfrente, y azar (g.rng: solo 6v6). lane ('left'|'right'|'mid'|'back', el
   *  stick del colocador humano, laneOf) se queda solo con los candidatos de ese carril si hay alguno válido; si no, el reparto
   *  de la IA. Deja g.setPlan[t] = {to, tempo, d, yl, apex, t, sys} para computeJob y el bloqueo rival. */
  function chooseSet(g, p, lane) {
    var t = p.team, tm = g.teams[t], opp = g.teams[1 - t], sd = side(t);
    var pq = g._pq6 && g._pq6[t], good = pq && g.time - pq.t < 3 && pq.q >= 0.45;
    var inSys = good && p.role === 'S' && dOf(p) < 3.0;
    _cand.length = 0; _w.length = 0;
    var sum = 0, inLane = false;
    for (var i = 0; i < tm.length; i++) {
      var q = tm[i]; if (q === p || q.role === 'S' || !(canAttack(q) || canPipe(q))) continue;
      var tempo = tempoOf(q);
      if ((tempo === 'quick' || tempo === 'pipe') && !inSys) continue;
      var T = FORM.set[tempo], ty = setY(g, p, q, tempo), Y = sd * ty, w = tempo === 'pipe' ? FORM.setW.pipe : FORM.setW[q.role] || 0.5;
      // humano (sprint 3): un atacante más, algo preferido; con «¡Pídela!» reciente, mucho más. Solo si está para atacar
      // (setReady: cerca de la red —o de su batida de zaguero— y del destino, y jugando): no se le regala el balón
      if (S.isHuman(g, q)) { if (!setReady(g, q, sd * T.d, Y)) continue; w *= HUM.atkW * (g.time - g.ask6 < HUM.askT ? HUM.ask : 1); }
      for (var k = 0; k < opp.length; k++) { var o = opp[k]; if (o.front && Math.abs(o.x) < 2 && Math.abs(o.y - Y) < 1.3) w *= 0.7; }
      if (lane && LANE[tempo] === lane) inLane = true;
      _cand.push(q); _w.push(w); sum += w;
    }
    if (inLane) { sum = 0; for (var m = 0; m < _cand.length; m++) { if (LANE[tempoOf(_cand[m])] !== lane) _w[m] = 0; sum += _w[m]; } }
    var plan = g._sp6 || (g._sp6 = [{}, {}]), P = plan[t], to = null, r = g.rng() * sum;
    for (var j = 0; j < _cand.length; j++) { if (inLane && _w[j] === 0) continue; r -= _w[j]; if (r <= 0 || j === _cand.length - 1) { to = _cand[j]; break; } }
    if (!to && inLane) for (var n = _cand.length - 1; n >= 0; n--) if (_w[n] > 0) { to = _cand[n]; break; }
    var tp = !to ? 'high' : tempoOf(to), TT = FORM.set[tp];
    P.to = to; P.tempo = tp; P.d = TT.d; P.yl = setY(g, p, to, tp);
    // fuera de sistema (colocador lejos de la red o no es el colocador): más alta para dar tiempo al atacante
    P.apex = TT.apex + (inSys || tp === 'quick' ? 0 : 0.4); P.t = g.time; P.sys = inSys;
    g.setPlan[t] = P;
    _sp.d = P.d; _sp.yl = P.yl; _sp.apex = P.apex;
    return _sp;
  }

  /** Multiplicador de la defensa rival (digOk) para el remate del equipo t: ataque en sistema (recepción buena, colocador en su
   *  sitio) más difícil de defender; fuera de sistema (bola alta tras defensa o recepción mala), más fácil. */
  function digK(g, t) {
    var P = g.setPlan[t];
    if (!P || P.t !== g.lastTouchT) return 1;
    return P.sys ? FORM.sysDig : FORM.oosDig;
  }

  VB.AI6 = { computeJob: computeJob, pos: pos, spot: spot, humanOwns: humanOwns, setReady: setReady, placeServe: placeServe, passTarget: passTarget, chooseSet: chooseSet,
    blockPlan: blockPlan, digK: digK, canAttack: canAttack, canPipe: canPipe, laneOf: laneOf, legalFixes: legalFixes, setterOf: setterOf, FORM: FORM, HUM: HUM };
})();
