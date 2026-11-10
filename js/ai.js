/* =====================================================================
 * VOLEY 3D — js/ai.js   (owner: sim)
 * IA de los jugadores (ambos equipos; en el humano, el compañero no
 * controlado). Pura: sin DOM/THREE. Depende de VB.Sim (js/sim.js).
 * La fuerza de cada equipo sale de g.prof[team] (VB.DIFF: easy/normal/hard/expert, mate, demo):
 * reacción, velocidad, precisión del timing, bloqueo, defensa, potencia.
 * ===================================================================== */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;
  var VB = root.VB = root.VB || {};
  var S = VB.Sim, C = VB.C;
  var side = S.side, clamp = S.clamp, other = S.other;

  /** Apuntado aleatorio de la IA (disco unidad). */
  function aim(g) {
    var a = g.rng() * Math.PI * 2, r = Math.sqrt(g.rng());
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  // Zonas candidatas del campo rival (profundidad desde la red, lateral)
  var DEPTHS = [2.2, 4.2, 6.2, 7.9], LATS = [-3.6, -1.8, 0, 1.8, 3.6];
  var _t2 = [0, 0];
  /** Elige la zona libre del campo rival (lejos de los defensores), con ruido según dificultad. */
  function openSpot(g, p, minDepth, out, atk) {
    var sd = side(p.team), opp = g.teams[1 - p.team], pr = (p.prof || g.prof[p.team]), best = -1e9;
    out = out || _t2;
    // remate (atk): con un bloqueador rival arriba, evitar las líneas que cruzan la red por sus manos.
    // Cuanto mejor la IA (menos aimNoise), mejor "lee" el bloqueo y remata por fuera de él.
    var blk = null, read = clamp(1 - pr.aimNoise / 4.5, 0.1, 1);
    if (atk) for (var b2 = 0; b2 < opp.length; b2++) { var o2 = opp[b2]; if (o2.z > 0.15 && Math.abs(o2.x) < 1.2 && (!blk || Math.abs(o2.y - p.y) < Math.abs(blk.y - p.y))) blk = o2; }
    // 6v6: con doble bloqueo también se lee el segundo bloqueador (el más cercano después del primero). En 2v2, nunca
    var blk2 = null;
    if (atk && blk && g.rot) for (var b3 = 0; b3 < opp.length; b3++) { var o3 = opp[b3]; if (o3 !== blk && o3.z > 0.15 && Math.abs(o3.x) < 1.2 && (!blk2 || Math.abs(o3.y - p.y) < Math.abs(blk2.y - p.y))) blk2 = o3; }
    for (var i = 0; i < DEPTHS.length; i++) {
      if (DEPTHS[i] < minDepth) continue;
      for (var j = 0; j < LATS.length; j++) {
        var x = -sd * DEPTHS[i], y = LATS[j], m = 1e9;
        for (var k = 0; k < opp.length; k++) {
          var q = opp[k], dd = Math.hypot(q.x - x, q.y - y);
          if (q.z > 0.1 && Math.abs(q.x) < 1.2) dd += 1.2; // el bloqueador en el aire no defiende
          if (dd < m) m = dd;
        }
        // la IA fácil apunta más al centro (menos riesgo, menos peligro)
        var risk = (Math.abs(y) > 3 ? 0.6 : 0) + (DEPTHS[i] > 7.5 ? 0.5 : 0);
        var sc = m - risk * (pr.aimNoise > 2 ? 2 : 0.6) + S._rnd(g, pr.aimNoise);
        if (blk && Math.abs(x - p.x) > 0.5) { // dónde cruza la red la línea atacante -> zona
          var y0 = p.y + (y - p.y) * (0 - p.x) / (x - p.x), gapB = Math.abs(y0 - blk.y);
          if (gapB < 0.9) sc -= 3 * read * (1 - gapB / 0.9);
          if (blk2) { var gapC = Math.abs(y0 - blk2.y); if (gapC < 0.9) sc -= 3 * read * (1 - gapC / 0.9); }
        }
        if (sc > best) { best = sc; out[0] = x; out[1] = y; }
      }
    }
    return out;
  }
  /** Destino del saque de la IA. Según el perfil: a la zona libre (entre receptores, `seam`) o a por un
   *  receptor con ruido (`srvNoise`); el fácil saca casi siempre "a las manos". */
  function serveTarget(g, sv) {
    var pr = (sv.prof || g.prof[sv.team]), sd = side(sv.team), opp = g.teams[1 - sv.team];
    if (g.rng() < (pr.seam != null ? pr.seam : 1)) return openSpot(g, sv, 4, _t2).slice();
    var q = opp[Math.floor(g.rng() * opp.length)], n = pr.srvNoise != null ? pr.srvNoise : 1;
    var depth = clamp(Math.abs(q.x) + S._rnd(g, 1.4), 4.2, 8.2);
    var y = clamp(q.y + S._rnd(g, n), -3.9, 3.9);
    return [-sd * depth, y];
  }

  /** Segundos que tardaría p en plantarse en el punto (x,y): aterrizar (si está en el aire), levantarse
   *  (si está en el suelo tras una plancha) y correr. */
  function timeTo(g, p, x, y) {
    var G = C.G, tl = 0, px = p.x, py = p.y;
    if (p.z > 0 || p.vz > 0) {
      tl = (p.vz + Math.sqrt(p.vz * p.vz + 2 * G * Math.max(0, p.z))) / G;
      px += p.jvx * tl; py += p.jvy * tl; tl += 0.08; // amortigua la caída
    }
    if (p.down > 0) tl = Math.max(tl, p.down + 0.05);
    var d = Math.max(0, Math.hypot(px - x, py - y) - 0.45);
    return tl + d / (C.SPEED * (p.prof || g.prof[p.team]).speed);
  }
  function airLand(g, p) { // s hasta que aterriza (0 en el suelo)
    return (p.z > 0 || p.vz > 0) ? (p.vz + Math.sqrt(p.vz * p.vz + 2 * C.G * Math.max(0, p.z))) / C.G : 0;
  }
  function jobCost(g, p, pr) {
    var c = timeTo(g, p, pr.x, pr.y);
    // en el aire y el balón llega antes de que pueda aterrizar y moverse: no puede ser él
    if (p.z > 0.3 && pr.t < airLand(g, p) + 0.15) c += 10;
    return c;
  }

  /** Quién de este equipo tiene que ir al balón (o null). Por tiempo hasta el balón (no por distancia),
   *  con memoria por trayectoria: solo se cambia si el otro llega claramente antes (0,3 s ~ 1,5 m),
   *  como mucho cada 0,5 s y nunca en los últimos 0,4 s (salvo que el elegido no llegue de ninguna manera). */
  function computeJob(g, t) {
    if (g.size !== 2 && VB.AI6 && VB.AI6.computeJob) return VB.AI6.computeJob(g, t); // 6v6 con su IA propia (sprint 2)
    var sd = side(t), b = g.ball, pr = g.pr1;
    if (g.mode !== 'rally' || b.held) return null;
    if (pr.x * sd <= 0) return null; // aún va al otro campo (la memoria se conserva para esta trayectoria)
    if (g.touchTeam === t && g.touches >= 3) return null;
    if (g.teams[t].length !== 2) return computeJobN(g, t, pr);
    if (g.touchTeam === t && g.touches >= 1 && g.lastPlayer) return other(g, g.lastPlayer);
    var mem = g.jobMem && g.jobMemT[t] === g.lastTouchT ? g.jobMem[t] : null;
    var a = g.teams[t][0], bb = g.teams[t][1];
    var ca = jobCost(g, a, pr), cb = jobCost(g, bb, pr), pick;
    if (mem) {
      var o = mem === a ? bb : a, cm = mem === a ? ca : cb, co = mem === a ? cb : ca;
      var clearly = co < cm - 0.3 && g.time - g.jobSwT[t] > 0.5 && pr.t > 0.4;
      // "no llega de ninguna manera": una sola vez por trayectoria (si no, al final de la jugada los dos
      // pueden parecer "sin remedio" por turnos y el control salta de uno a otro)
      var hopeless = pr.t > 0.15 && cm > pr.t + 0.35 && co < pr.t + 0.1 && co < cm - 0.2 && g.time - g.jobSwT[t] > 0.25 && !(g.jobHop && g.jobHop[t] === g.lastTouchT);
      if (hopeless && g.jobHop) g.jobHop[t] = g.lastTouchT;
      pick = (clearly || hopeless) ? o : mem;
    } else {
      // primera elección: a igualdad (±0,12 s), se queda el jugador que ya controla el humano (menos cambios de cámara)
      var bias = t === 0 && !g.demo ? 0.12 : 0;
      pick = (ca - (g.ctrl === a ? bias : 0)) <= (cb - (g.ctrl === bb ? bias : 0)) ? a : bb;
    }
    if (g.jobMem) {
      if (!mem || pick !== mem) g.jobSwT[t] = g.time; // la primera elección también cuenta como cambio
      g.jobMem[t] = pick; g.jobMemT[t] = g.lastTouchT;
    }
    return pick;
  }

  /** computeJob con N jugadores (reserva genérica hasta VB.AI6): el mismo criterio que el de 2v2 (tiempo hasta el balón,
   *  memoria por trayectoria, cambio solo si otro llega claramente antes o el elegido no llega) entre todos los que pueden
   *  tocar (no repite el que acaba de tocar). Sin asignaciones. */
  function computeJobN(g, t, pr) {
    var tm = g.teams[t], excl = g.touchTeam === t && g.touches >= 1 ? g.lastPlayer : null;
    var mem = g.jobMem && g.jobMemT[t] === g.lastTouchT ? g.jobMem[t] : null;
    if (mem === excl) mem = null;
    var bias = t === 0 && !g.demo ? 0.12 : 0, best = null, bc = 1e9, alt = null, ac = 1e9, cm = 1e9;
    for (var i = 0; i < tm.length; i++) {
      var q = tm[i]; if (q === excl) continue;
      var c = jobCost(g, q, pr);
      if (q === mem) { cm = c; continue; }
      var cb = c - (!mem && g.ctrl === q ? bias : 0);
      if (cb < bc) { bc = cb; best = q; }
      if (c < ac) { ac = c; alt = q; }
    }
    var pick;
    if (mem) {
      var clearly = alt && ac < cm - 0.3 && g.time - g.jobSwT[t] > 0.5 && pr.t > 0.4;
      var hopeless = alt && pr.t > 0.15 && cm > pr.t + 0.35 && ac < pr.t + 0.1 && ac < cm - 0.2 && g.time - g.jobSwT[t] > 0.25 && !(g.jobHop && g.jobHop[t] === g.lastTouchT);
      if (hopeless && g.jobHop) g.jobHop[t] = g.lastTouchT;
      pick = (clearly || hopeless) ? alt : mem;
    } else pick = best;
    if (g.jobMem && pick) {
      if (!mem || pick !== mem) g.jobSwT[t] = g.time;
      g.jobMem[t] = pick; g.jobMemT[t] = g.lastTouchT;
    }
    return pick;
  }

  // Objetivo reutilizable (sin asignaciones por frame)
  var _tg = { x: 0, y: 0, attack: false, block: false };
  function setTg(x, y, attack, block) { _tg.x = x; _tg.y = y; _tg.attack = !!attack; _tg.block = !!block; return _tg; }

  /** Posición objetivo de un jugador según la fase del rally. */
  function pos(g, p) {
    if (g.size !== 2 && VB.AI6 && VB.AI6.pos) return VB.AI6.pos(g, p); // 6v6 con su IA propia (sprint 2)
    var t = p.team, sd = side(t), mate = other(g, p), job = g.jobs[t], idx = p.idx, mine = g.touchTeam === t;
    if (job === p) {
      // a atacar: tras el 2.º toque propio o tras una colocación en salto en el 1.º (S.atkPhase)
      if (S.atkPhase(g, t) && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) return setTg(g.pr3.x + sd * 0.35, g.pr3.y, true, false);
      return setTg(g.pr1.x + sd * 0.2, g.pr1.y);
    }
    if (g.teams[t].length !== 2) return posN(g, p);
    if (job === mate) {
      if (!mine) {
        // El balón aún viene: no se abandona la defensa. Con un ataque o un saque potente en camino, el que no va
        // al balón cubre (el que está en la red, la dejada; el de atrás, el fondo contrario a su compañero).
        // Solo sale a colocar cuando el balón está a punto de llegar a su compañero.
        var hard = g.hardIn || g.lastKind === 'spike' || g.lastKind === 'block';
        if (hard || g.pr1.t > 0.75) {
          if (Math.abs(p.x) < 2.6 && g.lastKind !== 'serve') return setTg(sd * 1.9, clamp((g.pr1.y + p.y) * 0.5, -3.5, 3.5));
          var cy = clamp(mate.y + (mate.y > 0 ? -3.2 : 3.2), -3.6, 3.6);
          if (g.lastKind === 'serve') return setTg(sd * 6.2, idx ? 2.2 : -2.2);
          return setTg(sd * clamp(Math.abs(p.x), 4.2, 6.5), cy);
        }
        return setTg(sd * 2, clamp(p.y, -1.5, 1.5)); // seré el colocador
      }
      if (g.touches === 0) return setTg(sd * 2, clamp(p.y, -1.5, 1.5)); // tras tocar nuestro bloqueo: colocador
      if (g.touches === 1 && g.lastKind !== 'set') return setTg(sd * 4.3, clamp(p.y, -3, 3)); // seré el atacante (no tras mi colocación en salto)
      return setTg(sd * 5.5, idx ? 2 : -2);
    }
    var opp = 1 - t;
    // lectura de la colocación en salto: el humano rival salta junto a la red en un toque donde puede colocar en salto
    // (S.jsetReady; nunca en CPU contra CPU). El bloqueador no espera a la colocación: se va ya a la red frente a su atacante
    // (sin saltar mientras no se vea el gesto) y el otro a defender. Si el humano arma un ataque (GOLPEAR o dejada en el aire)
    // salta a bloquearle a él: si no, quedaba plantado en la red sin bloquear ni defender y el ataque en 2.º toque ganaba
    // más (35 → 51 % en Normal). Sin esta lectura, tras una colocación en salto (0,8 s hasta el remate) el bloqueo no
    // llegaba nunca. Tras el toque sigue con este objetivo (reacción) y luego pasa al bloqueo normal de abajo.
    if (opp === 0 && !S.atkPhase(g, opp) && S.jsetReady(g)) {
      var ay0 = other(g, g.ctrl).y, bl0 = ay0 < 0 ? g.teams[t][0] : g.teams[t][1], atk0 = g.swingLive && g.swingShot !== 'jset';
      if (p === bl0) return setTg(sd * 0.6, clamp(atk0 ? g.ctrl.y : ay0, -4.2, 4.2), false, atk0);
      return setTg(sd * 5.4, clamp(-ay0 * 0.3, -2, 2));
    }
    if (S.atkPhase(g, opp) && g.pr3.x * side(opp) > 0) { // el rival va a atacar
      var bl = g.pr3.y < 0 ? g.teams[t][0] : g.teams[t][1];
      // con humano: el rol lo fija la sim al colocar la CPU (g.defRole: 'dig' = el humano defiende y bloquea su
      // compañero IA; 'block' = bloquea el humano). Antes de eso, el compañero IA bloquea si el humano está atrás.
      if (t === 0 && !g.demo && !g.autopilot) {
        var hc = g.ctrl, hm = other(g, hc);
        bl = g.defRole === 'block' ? hc : g.defRole === 'dig' ? hm : (Math.abs(hc.x) > 4 ? hm : hc);
      }
      if (p === bl) return setTg(sd * 0.6, clamp(g.pr3.y + g.blockOff[t], -4.2, 4.2), false, true);
      // defensor: a media pista, algo hacia la diagonal (el bloqueo tapa parte de la paralela), sin dejar
      // vendida la línea: desde ahí llega a la diagonal y, lanzándose, a la paralela
      var ay = g.pr3.y;
      return setTg(sd * 5.4, clamp(-ay * 0.3, -2, 2));
    }
    return setTg(sd * 6.2, idx ? 2.2 : -2.2);
  }

  var _zp = { x: 0, y: 0 };
  /** pos con N jugadores (reserva genérica hasta VB.AI6) para quien no va al balón: con ataque rival en camino, el delantero
   *  más cercano a la colocación bloquea; el resto, a su zona base (S.zonePos). */
  function posN(g, p) {
    var t = p.team, sd = side(t), opp = 1 - t;
    if (S.atkPhase(g, opp) && g.pr3.x * side(opp) > 0 && p.front) {
      var tm = g.teams[t], bl = null, bd = 1e9;
      for (var i = 0; i < tm.length; i++) { var q = tm[i]; if (!q.front) continue; var d = Math.abs(q.y - g.pr3.y); if (d < bd) { bd = d; bl = q; } }
      if (bl === p) return setTg(sd * 0.6, clamp(g.pr3.y + g.blockOff[t], -4.2, 4.2), false, true);
    }
    S.zonePos(t, p.zone || 6, _zp);
    return setTg(_zp.x, _zp.y);
  }

  var SHANK_SURPRISE = 0.4; // s que tarda en reaccionar al balón desviado por su compañero
  var BEAT6 = { react: 0.4, speed: 0.3 }; // 6v6: el defensor «perdido» (dado digOk en contra) lee tarde y va lento (ver aiUpdate)
  var TEAM_GAP = 0.2;       // s mínimos entre el toque de un compañero y el siguiente toque de la IA (salvo balón que se va)
  var DODGE_R = 0.9;        // m: el que acaba de tocar se aparta de la caída de su propio balón (evita dobles de cuerpo)
  /** El jugador que acaba de tocar no puede volver a tocar (dobles): si su balón le va a caer encima (cruce a 1 m de
   *  altura en su campo, cerca de su objetivo), aparta el objetivo a DODGE_R del punto de caída. Muta tg. */
  function dodgeOwnBall(g, p, tg) {
    var pr = g.pr1, sd = side(p.team);
    if (pr.x * sd <= 0 || pr.t > 1.6) return;
    var dx = tg.x - pr.x, dy = tg.y - pr.y, d = Math.hypot(dx, dy);
    if (d >= DODGE_R) return;
    if (d < 0.05) { dx = p.x - pr.x; dy = p.y - pr.y; d = Math.hypot(dx, dy); }
    if (d < 0.05) { dx = sd; dy = 0; d = 1; }         // justo debajo: atrás, hacia su fondo
    tg.x = pr.x + dx / d * DODGE_R; tg.y = clamp(pr.y + dy / d * DODGE_R, -4.4, 4.4);
  }
  var _w = { t: 0, d: 0, dz: 0, reach: false, kind: '', zc: 0, x: 0, y: 0, z: 0, active: false, canReach: false };

  function aiJump(g, p) {
    var sd = side(p.team), pr = (p.prof || g.prof[p.team]);
    var jvx = p.vx * 0.3, jvy = p.vy * 0.3, jl = Math.hypot(jvx, jvy);
    if (jl > 0.6) { jvx *= 0.6 / jl; jvy *= 0.6 / jl; }
    // corrige la deriva hacia la red (salvo despiste ocasional)
    var land = (p.x + jvx * 0.98) * sd;
    if (land < 0.45 && jvx * sd < 0 && g.rng() >= pr.netErr) jvx = 0;
    S._jump(g, p, jvx, jvy);
  }

  /** ¿Deja botar el saque rival? Se decide UNA vez por saque, cuando el balón ya ha pasado a su campo, con el bote previsto
   *  (S.predictLanding, sin el baile del flotante) y S.lineDist (+ dentro, − fuera). Lejos de la línea acierta siempre; cerca
   *  se equivoca a veces (la juega aunque vaya fuera o la deja aunque entre), más cuanto peor recibe el perfil (pr.recv).
   *  La duda está centrada 10 cm por fuera: ante un balón dudoso el receptor prefiere jugarlo. */
  var _land = { x: 0, y: 0, z: 0, t: 0 };
  function leaveServe(g, p, pr) {
    var b = g.ball, sd = side(p.team), lv = g._lv || (g._lv = [{ t: -1, on: false }, { t: -1, on: false }]), L = lv[p.team];
    if (L.t === g.lastTouchT) return L.on;                   // una decisión por saque y equipo (aunque cambie quién va)
    if (b.x * sd <= 0.2) return false;                       // aún no ha pasado la red: todavía no decide
    L.t = g.lastTouchT; L.on = false;
    S.predictLanding(g, _land);
    if (_land.x * sd <= 0) return false;                     // se queda en la red / su propio campo
    var d = S.lineDist(_land.x, _land.y), w = 0.22 + (1 - (pr.recv || 0.8)) * 0.9;
    var x = clamp((d + 0.1 + w) / (2 * w), 0, 1), play = x * x * (3 - 2 * x);
    L.on = play < 1 && g.rng() >= play;
    return L.on;
  }

  /** Un paso de IA para el jugador p (mueve, salta, golpea). */
  function update(g, p, dt) {
    var t = p.team, sd = side(t), pr = p.prof || g.prof[t], mx = 0, my = 0, b = g.ball;
    // insignias (Líder del compañero, Sangre fría): reacción y timing efectivos; sin insignias = los del perfil
    var react = S.aiReact(g, p, pr), timing = S.aiTiming(g, p, pr);
    // balón que esta IA "no va a sacar" (dado de defensa/recepción en contra): lee tarde y va lenta.
    // Se ve el fallo (llega tarde, se tira y no llega, o la toca y sale desviada); nunca se queda quieta.
    // (g.digOk solo es false tras un remate/saque/toque de bloqueo que el dado de defensa/recepción da por perdido)
    var beaten = !g.digOk && g.jobs[t] === p;
    // 6v6 (g.rot): con 3 zagueros el «perdido» llegaba casi siempre y la mandaba a la grada (26 % de puntos en «Defensa fuera»,
    // revisión juego6 M2): lee aún más tarde y va más lenta, así más remates caen sin tocar. En 2v2 (g.rot null), como siempre.
    var bt6 = beaten && g.rot ? BEAT6 : null;
    // reacción: tras cada toque, durante pr.react sigue con el objetivo anterior
    var tx, ty, attack, block, since = g.time - g.lastTouchT;
    // recepción/defensa del compañero que sale desviada: sorpresa, tarda en leerla (no la intercepta al vuelo)
    var shankT = (g.lastShot === 'shank' || g.lastShot === 'body') && g.touchTeam === t ? SHANK_SURPRISE : 0;
    if (since < react + (beaten ? (bt6 ? bt6.react : 0.12) : 0) + shankT) {
      if (p.tgTime != null && p.tgTime <= g.lastTouchT && g.lastTouchT - p.tgTime < 0.3) {
        tx = p.tgx; ty = p.tgy; attack = p.tgA; block = p.tgB; // sigue con lo que hacía
      } else { tx = p.x; ty = p.y; attack = block = false; }   // aún no ha leído la jugada
    } else {
      var tg = pos(g, p);
      if (g.touchTeam === t && g.lastPlayer === p && g.jobs[t] !== p) dodgeOwnBall(g, p, tg);
      tx = p.tgx = tg.x; ty = p.tgy = tg.y; attack = p.tgA = tg.attack; block = p.tgB = tg.block; p.tgTime = g.time;
    }
    if (p.z === 0) {
      var dx = tx - p.x, dy = ty - p.y, dl = Math.hypot(dx, dy);
      if (dl > 0.05) { var f = Math.min(1, dl / 0.35) * pr.speed * (beaten ? (bt6 ? bt6.speed : 0.6) : 1); mx = dx / dl * f; my = dy / dl * f; }
    }
    S._stepPlayer(g, p, dt, mx, my);
    if (g.mode !== 'rally') return;
    // nuevo toque: muestrea los desfases de esta jugada
    if (p.aiTeT !== g.lastTouchT) {
      p.aiTeT = g.lastTouchT;
      p.aiTe = clamp(S._gauss(g) * timing, -0.25, 0.25);
      p.aiJt = clamp(S._gauss(g) * timing * 0.8, -0.15, 0.15);
      p.aiDv = g.rng();
    }
    if (p.z === 0 && p.vz === 0 && p.down <= 0) {
      if (attack && g.pr3.t < 0.47 + p.aiJt && Math.hypot(g.pr3.x + sd * 0.35 - p.x, g.pr3.y - p.y) < 1) aiJump(g, p);
      if (block) {
        var opp = g.teams[1 - t], att = false;
        for (var a = 0; a < opp.length && !att; a++) att = opp[a].z > 0.1 && Math.abs(opp[a].x) < 4;
        if (att && Math.abs(p.x) < 1.3) { p.bd += dt; if (p.bd > p.bdT) { aiJump(g, p); p.bd = 0; p.bdT = pr.blockReact + g.rng() * 0.1; } }
        else p.bd = 0;
      }
    }
    if (g.jobs[t] !== p || p.cool > 0 || since < shankT) return;
    // no se ataca el saque rival por encima de la red (regla 13.3.4): en el aire, deja pasar el saque
    if (g.lastKind === 'serve' && p.z > 0.25 && b.z > C.NET_H) return;
    // saque rival que se va fuera: se deja botar (si no, apuntar a las líneas no tenía ningún riesgo)
    if (g.lastKind === 'serve' && g.touchTeam !== t && leaveServe(g, p, pr)) return;
    if (!S.canReach(g, p)) {
      // plancha: el balón se va al suelo fuera del alcance normal
      if (g.time - g.lastTouchT > react && S.canDive(g, p) && b.vz < 0 && b.z < 0.95) {
        var wd = S.hitWindow(g, p, _w);
        if (beaten) { if (b.z < 0.55 && p.aiDv < 0.75) S._diveMiss(g, p); } // se lanza tarde y no llega
        else if (!wd.reach || b.z < 0.5) S._dive(g, p, null, -wd.t + p.aiTe * 0.5);
      }
      return;
    }
    var w = S.hitWindow(g, p, _w);
    var rx = b.x - p.x, ry = b.y - p.y, hd = Math.hypot(rx, ry);
    var exiting = (hd > C.REACH - 0.15 && rx * b.vx + ry * b.vy > 0) || (b.z - p.z < 0.3 && b.vz < 0) || (p.z > 0 && p.z < 0.3 && p.vz < 0);
    if (g.touchTeam === t && since < TEAM_GAP && !exiting) return; // el balón aún sale de las manos del compañero
    if (!(w.t <= -p.aiTe || exiting || !w.reach)) return;
    if (beaten) { // llega pero no la controla: toque desviado (casi siempre injugable)
      if (p.z > 0.25) return;
      S._hit(g, p, null, (p.aiTe < 0 ? -1 : 1) * (0.16 + g.rng() * 0.08), 'shank', null);
      return;
    }
    // ¿qué hace con el balón?
    var shot = '', tgt = null, count = g.touchTeam === t ? g.touches + 1 : 1;
    if (p.z > 0.25 && Math.abs(b.x) < 3.8 && b.z > C.NET_H + 0.1) {
      var opp2 = g.teams[1 - t], blockUp = false;
      for (var k = 0; k < opp2.length; k++) if (opp2[k].z > 0.3 && Math.abs(opp2[k].x) < 1.2 && Math.abs(opp2[k].y - p.y) < 1.2) blockUp = true;
      if (blockUp && g.rng() < pr.tip) { shot = 'tip'; tgt = [-sd * (1.3 + g.rng() * 1.4), clamp(-p.y * 0.6 + S._rnd(g, 1.5), -3.6, 3.6)]; }
      else tgt = openSpot(g, p, 2.2, [0, 0], true);
    } else if (count === 3) tgt = openSpot(g, p, 4, [0, 0]);
    S._hit(g, p, null, -w.t, shot, tgt);
  }

  VB.AI = { aim: aim, computeJob: computeJob, pos: pos, update: update, serveTarget: serveTarget, openSpot: openSpot, timeTo: timeTo };
})();
