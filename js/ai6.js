/* =====================================================================
 * VOLEY 3D — js/ai6.js   (owner: sim)
 * IA de equipo del 6v6 (sprint 2, notes/diseno-6v6-carrera.md §1.2-1.4). Pura: sin DOM/THREE. Depende de VB.Sim y
 * VB.AI (se carga después de js/ai.js). En 2v2 no se usa nunca (ai.js y sim.js solo la llaman con g.rot / g.size === 6),
 * así que el 2v2 sigue idéntico.
 *
 * Reutiliza AI.update (movimiento, salto, timing aleatorio, plancha, toque desviado); aquí solo se decide:
 *   computeJob(g, t)        quién va al balón (1.er toque con penalización por puesto, 2.º el colocador, 3.º el atacante elegido)
 *   pos(g, p)               dónde estar (recepción, saque propio, ataque propio con cobertura, bloqueo de zona y defensa perímetro)
 *   placeServe(g, t, sv)    formaciones del saque: el equipo que saca en sus zonas, el que recibe en «W» con 3 receptores (OH, OH, L)
 *   passTarget(g, p, hard)  destino de la recepción/defensa (sim.hit, 1.er toque)
 *   chooseSet(g, p)         el colocador elige atacante y tempo (sim.hit, 2.º toque): bola alta a punta, tensa al opuesto, rápida al central
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
    // inicio de la carrera de batida (ataque propio, antes de la colocación)
    approach: { OH: { d: 3.8, yl: -3.3 }, OPP: { d: 3.8, yl: 3.3 }, MB: { d: 2.8, yl: -0.2 } },
    // destino de la colocación por tempo (d, yl, ápice)
    set: { high: { d: 1.4, yl: -3.4, apex: 4.7 }, shoot: { d: 1.4, yl: 3.4, apex: 4.3 }, quick: { d: 1.0, yl: -0.1, apex: 3.75 } },
    // peso de cada atacante para el colocador (bola en sistema); con recepción mala solo bola alta (OH, OPP)
    setW: { OH: 1.0, OPP: 0.85, MB: 0.8 },
    sysDig: 0.7, oosDig: 1.15,         // defensa rival del remate en sistema / fuera de sistema (× prob. de defender)
    blockErr: 1.8,                    // × el error de colocación del bloqueo (g.blockOff): con dos bloqueadores, más hueco entre manos
    digSys: 0.6,                      // calidad de la defensa para el colocador (× q): en transición casi siempre bola alta
    // formación de recepción en «W»: línea de 3 receptores
    recvD: 6.0, recvY: [-2.8, 0, 2.8],
    // penalización por puesto en quién va al balón (s): 1.er toque, 2.º toque
    pen1: { S: 0.35, L: -0.10, OH: -0.05, MB: 0.25, OPP: 0.15 },
    pen2: { S: -0.8, L: 0, OH: 0.15, MB: 0.2, OPP: 0.1 }
  };

  var _tg = { x: 0, y: 0, attack: false, block: false };
  function setTg(x, y, attack, block) { _tg.x = x; _tg.y = y; _tg.attack = !!attack; _tg.block = !!block; return _tg; }
  /** Objetivo en coordenadas locales del equipo t. */
  function loc(t, d, yl, attack, block) { var sd = side(t); return setTg(sd * d, clamp(sd * yl, -4.4, 4.4), attack, block); }
  function dOf(p) { return p.x * side(p.team); }
  function ylOf(p) { return p.y * side(p.team); }
  /** ¿Puede atacar por encima de la red? Delantero y no líbero (v1: sin «pipe» de zaguero). */
  function canAttack(p) { return p.front && p.role !== 'L' && !p.bench; }
  function setterOf(g, t) { var tm = g.teams[t]; for (var i = 0; i < tm.length; i++) if (tm[i].role === 'S') return tm[i]; return null; }

  /* ---------- Quién va al balón ---------- */
  function jobCost(g, p, pr) {
    var c = VB.AI.timeTo(g, p, pr.x, pr.y);
    if (p.z > 0.3) { var tl = (p.vz + Math.sqrt(p.vz * p.vz + 2 * C.G * Math.max(0, p.z))) / C.G; if (pr.t < tl + 0.15) c += 10; }
    return c;
  }
  /** Penalización (s) del puesto para el toque n (0 = 1.er toque del equipo, 1 = 2.º, 2 = 3.º). */
  function rolePen(g, t, q, n, pr) {
    // humano (control Uno en 6v6, aún sin ayudas: sprint 3): solo va si nadie llega claramente antes
    if (S.isHuman(g, q)) return 0.4;
    if (n === 0) { var a = FORM.pen1[q.role] || 0; return q.role === 'MB' || q.role === 'OPP' ? (q.front ? a : 0) : a; }
    if (n === 1) {
      if (q.role === 'L') return Math.abs(pr.x) < C.ATTACK + 0.3 ? 0.6 : 0; // el líbero de dedos delante de 3 m anula el ataque por arriba
      return FORM.pen2[q.role] || 0;
    }
    var pl = g.setPlan[t];
    if (pl && pl.to === q && pl.t === g.lastTouchT) return -0.8;
    return q.role === 'L' ? 0.6 : canAttack(q) ? 0 : 0.3;
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
    // 3.er toque: el atacante elegido por el colocador, fijo como «el compañero» del 2v2 (en el aire el coste de jobCost
    // le daría por perdido justo al saltar a rematar)
    var pl = mineN === 2 && g.lastKind === 'set' ? g.setPlan[t] : null;
    if (pl && pl.to && pl.t === g.lastTouchT && pl.to !== excl && !pl.to.bench) return pl.to;
    var mem = g.jobMem && g.jobMemT[t] === g.lastTouchT ? g.jobMem[t] : null;
    if (mem === excl || (mem && mem.bench)) mem = null;
    var best = null, bc = 1e9, cm = 1e9;
    for (var i = 0; i < tm.length; i++) {
      var q = tm[i]; if (q === excl) continue;
      var c = jobCost(g, q, pr) + rolePen(g, t, q, mineN, pr);
      if (q === mem) cm = c;
      else if (c < bc) { bc = c; best = q; }
    }
    var pick;
    if (mem) {
      var clearly = best && bc < cm - 0.3 && g.time - g.jobSwT[t] > 0.5 && pr.t > 0.4;
      var hopeless = best && pr.t > 0.15 && cm > pr.t + 0.35 && bc < pr.t + 0.1 && bc < cm - 0.2 && g.time - g.jobSwT[t] > 0.25 && g.jobHop[t] !== g.lastTouchT;
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
      if (S.atkPhase(g, t) && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) return setTg(g.pr3.x + sd * 0.35, g.pr3.y, canAttack(p), false);
      return setTg(g.pr1.x + sd * 0.2, g.pr1.y);
    }
    var lk = g.lastKind, tt = g.touchTeam;
    if (lk === 'serve') return tt === t ? basePos(g, p) : recvPos(g, p);
    if (tt === t && g.touches < 3) return offPos(g, p);
    return defPos(g, p);
  }
  /** Recibiendo el saque: cada uno en su sitio de la formación; el colocador sale ya a su punto. */
  function recvPos(g, p) {
    if (p.role === 'S') return loc(p.team, FORM.setSpot.d, FORM.setSpot.yl);
    return setTg(p.fx, p.fy);
  }
  /** Saque propio: al puesto de especialidad (delanteros a su carril en la red, zagueros a la defensa). */
  function basePos(g, p) {
    if (p.front) return loc(p.team, FORM.netD, FORM.netLane[p.role] || 0);
    var B = FORM.back[p.role] || FORM.back.OH;
    return loc(p.team, B.d, B.yl);
  }
  /** Balón propio (1 o 2 toques, o tras tocar nuestro bloqueo): carrera de batida, colocador al punto y cobertura del atacante. */
  function offPos(g, p) {
    var t = p.team, set = g.touches >= 2 && g.lastKind === 'set';
    if (!set) {
      if (p.role === 'S' && g.lastPlayer !== p) return loc(t, FORM.setSpot.d, FORM.setSpot.yl);
      if (canAttack(p) && FORM.approach[p.role]) { var A = FORM.approach[p.role]; return loc(t, A.d, A.yl); }
      if (p.front) return loc(t, 1.8, 1.5); // el colocador que hizo el 1.er toque
      var lb = p.role === 'OH' ? 0 : (p.role === 'S' || p.role === 'OPP') ? 2.2 : -2.2;
      return loc(t, 5.6, lb);
    }
    // colocación en el aire: cobertura alrededor del atacante (o del destino previsto)
    var a = g.pr3.y * side(t), lv = p.role === 'OH' ? (p.front ? -1 : 0) : p.role === 'MB' ? (p.front ? 0 : -1) : p.role === 'L' ? -1 : 1;
    // (el central zaguero, cuando no le ha cambiado el líbero porque acaba de sacar, cubre en el sitio del líbero: con lv 0 caía
    //  encima del receptor zaguero; revisión juego6 M3)
    if (p.front) return loc(t, 2.4, clamp(a + lv * 1.5, -4, 4));
    return loc(t, 4.8, clamp(a * 0.6 + lv * 2.2, -4, 4));
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
          var c = clamp(g.pr3.y + g.blockOff[t] * FORM.blockErr * (quick ? 1.7 : 1), -4.0, 4.0);
          var off = !bp.b ? 0 : (p === bp.lo ? -0.45 : 0.45);
          return setTg(sd * 0.6, clamp(c + off, -4.2, 4.2), false, true);
        }
        return loc(t, 3.0, (FORM.netLane[p.role] || 0) * 0.6); // el que no bloquea: dejadas y balones tocados
      }
      return loc(t, FORM.netD, FORM.netLane[p.role] || 0);
    }
    var B = FORM.back[p.role] || FORM.back.OH, d = B.d, yl = B.yl;
    if (atk) { // perímetro: se abre hacia el lado del ataque; el de la línea del atacante sube un poco
      var ay = g.pr3.y * sd;
      yl = clamp(yl + 0.25 * ay, -3.9, 3.9);
      if (yl * ay > 0 && Math.abs(B.yl) > 1) d -= 0.6;
    }
    return loc(t, d, yl);
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
  /** Coloca a los dos equipos para el saque: el que saca (t) en sus zonas base y el sacador detrás de la línea; el que recibe,
   *  en «W» con 3 receptores y el resto escondido, siempre legal (overlapCount 0). Guarda el sitio en p.fx/p.fy. */
  function placeServe(g, t, sv) {
    for (var u = 0; u < 2; u++) {
      for (var z = 1; z <= 6; z++) _P[z] = S.onCourt(g, u, z);
      if (u === t) servingForm(); else recvForm();
      legalize();
      var sd = side(u);
      for (var k = 1; k <= 6; k++) { var p = _P[k]; p.x = p.fx = sd * _D[k]; p.y = p.fy = sd * _Y[k]; }
    }
    sv.x = side(t) * 10.3; sv.y = side(t) * 2.0; sv.fx = sv.x; sv.fy = sv.y;
  }
  function servingForm() {
    for (var z = 1; z <= 6; z++) { var Z = S.ZONE[z]; _D[z] = z >= 2 && z <= 4 ? FORM.netD : 7.2; _Y[z] = Z.yl * 0.9; }
  }
  function recvForm() {
    _pas.length = 0;
    for (var z = 1; z <= 6; z++) {
      var p = _P[z], front = z >= 2 && z <= 4, yl0 = S.ZONE[z].yl;
      if (p.role === 'OH' || p.role === 'L') { _pas.push(z); continue; }
      if (p.role === 'S') { _D[z] = front ? 0.8 : 2.2; _Y[z] = front ? yl0 * 0.7 : (z === 1 ? 3.7 : z === 6 ? 0.6 : -1.2); }
      else if (front) { _D[z] = 1.0; _Y[z] = yl0 * 0.8; }   // central y opuesto delanteros: en la red, listos para atacar
      else { _D[z] = 8.0; _Y[z] = yl0 * 1.05; }               // opuesto zaguero (o central que no sustituye el líbero): al fondo
    }
    // receptores: ordenados por su posición lateral (y, a igualdad, el delantero primero) a los huecos de la línea
    _pas.sort(function (a, b) { return RANK[a] - RANK[b] || (b >= 2 && b <= 4 ? 1 : 0) - (a >= 2 && a <= 4 ? 1 : 0); });
    for (var i = 0; i < _pas.length; i++) { var zz = _pas[i]; _D[zz] = FORM.recvD; _Y[zz] = FORM.recvY[Math.min(i, 2)]; }
  }
  var FB = [[2, 1], [3, 6], [4, 5]], ROWS = [[4, 3, 2], [5, 6, 1]], GAP = 0.5, YMAX = 4.2;
  /** Corrige _D/_Y hasta que no haya solapamientos (margen GAP): zaguero detrás de su delantero y filas en orden lateral. */
  function legalize() {
    for (var it = 0; it < 4; it++) {
      for (var i = 0; i < 3; i++) {
        var f = FB[i][0], k = FB[i][1];
        if (_D[k] < _D[f] + GAP) { _D[k] = _D[f] + GAP; if (_D[k] > 8.6) { _D[k] = 8.6; _D[f] = Math.min(_D[f], 8.6 - GAP); } }
      }
      for (var r = 0; r < 2; r++) {
        var R = ROWS[r];
        for (var a = 1; a < 3; a++) if (_Y[R[a]] < _Y[R[a - 1]] + GAP) _Y[R[a]] = _Y[R[a - 1]] + GAP;
        if (_Y[R[2]] > YMAX) _Y[R[2]] = YMAX;
        for (var c = 1; c >= 0; c--) if (_Y[R[c]] > _Y[R[c + 1]] - GAP) _Y[R[c]] = _Y[R[c + 1]] - GAP;
      }
    }
  }

  /* ---------- Decisiones del toque (las llama sim.hit) ---------- */
  var _pt = { d: 0, yl: 0, apex: 4 };
  /** Destino del 1.er toque (recepción/defensa) en coordenadas locales. Anota la calidad para el colocador. */
  function passTarget(g, p, hard, q) {
    var T = hard ? FORM.digTo : FORM.passTo;
    _pt.d = T.d; _pt.yl = T.yl; _pt.apex = T.apex;
    var pq = g._pq6 || (g._pq6 = [{ q: 0, t: -9 }, { q: 0, t: -9 }]);
    // la defensa de un remate casi nunca deja jugar en sistema (rápida): cuenta como peor recepción
    pq[p.team].q = (q == null ? 0.6 : q) * (hard ? FORM.digSys : 1); pq[p.team].t = g.time;
    return _pt;
  }
  var _sp = { d: 0, yl: 0, apex: 5 }, _cand = [], _w = [];
  /** El colocador elige atacante y tempo (2.º toque). Delanteros que pueden atacar (sin el líbero ni quien coloca); el central
   *  solo con recepción buena y el colocador cerca de la red (rápida). Peso del puesto, menos si el bloqueo rival ya está
   *  enfrente, y azar (g.rng: solo 6v6). Deja g.setPlan[t] = {to, tempo, d, yl, apex, t} para computeJob y el bloqueo rival. */
  function chooseSet(g, p) {
    var t = p.team, tm = g.teams[t], opp = g.teams[1 - t], sd = side(t);
    var pq = g._pq6 && g._pq6[t], good = pq && g.time - pq.t < 3 && pq.q >= 0.45;
    var inSys = good && p.role === 'S' && dOf(p) < 3.0;
    _cand.length = 0; _w.length = 0;
    var sum = 0;
    for (var i = 0; i < tm.length; i++) {
      var q = tm[i]; if (q === p || !canAttack(q) || q.role === 'S' || S.isHuman(g, q)) continue; // (humano: sprint 3, «¡Pídela!»)
      var tempo = q.role === 'MB' ? 'quick' : q.role === 'OPP' ? 'shoot' : 'high';
      if (tempo === 'quick' && !inSys) continue;
      var T = FORM.set[tempo], ty = tempo === 'quick' ? clamp(ylOf(p) - 1.0, -2.5, 2.5) : T.yl, Y = sd * ty, w = FORM.setW[q.role] || 0.5;
      for (var k = 0; k < opp.length; k++) { var o = opp[k]; if (o.front && Math.abs(o.x) < 2 && Math.abs(o.y - Y) < 1.3) w *= 0.7; }
      _cand.push(q); _w.push(w); sum += w;
    }
    var plan = g._sp6 || (g._sp6 = [{}, {}]), P = plan[t], to = null, r = g.rng() * sum;
    for (var j = 0; j < _cand.length; j++) { r -= _w[j]; if (r <= 0 || j === _cand.length - 1) { to = _cand[j]; break; } }
    var tp = !to ? 'high' : to.role === 'MB' ? 'quick' : to.role === 'OPP' ? 'shoot' : 'high', TT = FORM.set[tp];
    P.to = to; P.tempo = tp; P.d = TT.d; P.yl = tp === 'quick' ? clamp(ylOf(p) - 1.0, -2.5, 2.5) : TT.yl;
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

  VB.AI6 = { computeJob: computeJob, pos: pos, placeServe: placeServe, passTarget: passTarget, chooseSet: chooseSet,
    blockPlan: blockPlan, digK: digK, canAttack: canAttack, setterOf: setterOf, FORM: FORM };
})();
