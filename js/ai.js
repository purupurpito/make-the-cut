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
    var sd = side(p.team), opp = g.teams[1 - p.team], pr = g.prof[p.team], best = -1e9;
    out = out || _t2;
    // remate (atk): con un bloqueador rival arriba, evitar las líneas que cruzan la red por sus manos.
    // Cuanto mejor la IA (menos aimNoise), mejor "lee" el bloqueo y remata por fuera de él.
    var blk = null, read = clamp(1 - pr.aimNoise / 4.5, 0.1, 1);
    if (atk) for (var b2 = 0; b2 < 2; b2++) { var o2 = opp[b2]; if (o2.z > 0.15 && Math.abs(o2.x) < 1.2 && (!blk || Math.abs(o2.y - p.y) < Math.abs(blk.y - p.y))) blk = o2; }
    for (var i = 0; i < DEPTHS.length; i++) {
      if (DEPTHS[i] < minDepth) continue;
      for (var j = 0; j < LATS.length; j++) {
        var x = -sd * DEPTHS[i], y = LATS[j], m = 1e9;
        for (var k = 0; k < 2; k++) {
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
        }
        if (sc > best) { best = sc; out[0] = x; out[1] = y; }
      }
    }
    return out;
  }
  /** Destino del saque de la IA. Según el perfil: a la zona libre (entre receptores, `seam`) o a por un
   *  receptor con ruido (`srvNoise`); el fácil saca casi siempre "a las manos". */
  function serveTarget(g, sv) {
    var pr = g.prof[sv.team], sd = side(sv.team), opp = g.teams[1 - sv.team];
    if (g.rng() < (pr.seam != null ? pr.seam : 1)) return openSpot(g, sv, 4, _t2).slice();
    var q = opp[g.rng() < 0.5 ? 0 : 1], n = pr.srvNoise != null ? pr.srvNoise : 1;
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
    return tl + d / (C.SPEED * g.prof[p.team].speed);
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
    var sd = side(t), b = g.ball, pr = g.pr1;
    if (g.mode !== 'rally' || b.held) return null;
    if (pr.x * sd <= 0) return null; // aún va al otro campo (la memoria se conserva para esta trayectoria)
    if (g.touchTeam === t && g.touches >= 3) return null;
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

  // Objetivo reutilizable (sin asignaciones por frame)
  var _tg = { x: 0, y: 0, attack: false, block: false };
  function setTg(x, y, attack, block) { _tg.x = x; _tg.y = y; _tg.attack = !!attack; _tg.block = !!block; return _tg; }

  /** Posición objetivo de un jugador según la fase del rally. */
  function pos(g, p) {
    var t = p.team, sd = side(t), mate = other(g, p), job = g.jobs[t], idx = p.idx, mine = g.touchTeam === t;
    if (job === p) {
      if (mine && g.touches === 2 && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) return setTg(g.pr3.x + sd * 0.35, g.pr3.y, true, false);
      return setTg(g.pr1.x + sd * 0.2, g.pr1.y);
    }
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
      if (g.touches === 1) return setTg(sd * 4.3, clamp(p.y, -3, 3));            // seré el atacante
      return setTg(sd * 5.5, idx ? 2 : -2);
    }
    var opp = 1 - t;
    if (g.touchTeam === opp && g.touches === 2 && g.pr3.x * side(opp) > 0) { // el rival va a atacar
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

  var SHANK_SURPRISE = 0.4; // s que tarda en reaccionar al balón desviado por su compañero
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
    var sd = side(p.team), pr = g.prof[p.team];
    var jvx = p.vx * 0.3, jvy = p.vy * 0.3, jl = Math.hypot(jvx, jvy);
    if (jl > 0.6) { jvx *= 0.6 / jl; jvy *= 0.6 / jl; }
    // corrige la deriva hacia la red (salvo despiste ocasional)
    var land = (p.x + jvx * 0.98) * sd;
    if (land < 0.45 && jvx * sd < 0 && g.rng() >= pr.netErr) jvx = 0;
    S._jump(g, p, jvx, jvy);
  }

  /** Un paso de IA para el jugador p (mueve, salta, golpea). */
  function update(g, p, dt) {
    var t = p.team, sd = side(t), pr = g.prof[t], mx = 0, my = 0, b = g.ball;
    // balón que esta IA "no va a sacar" (dado de defensa/recepción en contra): lee tarde y va lenta.
    // Se ve el fallo (llega tarde, se tira y no llega, o la toca y sale desviada); nunca se queda quieta.
    // (g.digOk solo es false tras un remate/saque/toque de bloqueo que el dado de defensa/recepción da por perdido)
    var beaten = !g.digOk && g.jobs[t] === p;
    // reacción: tras cada toque, durante pr.react sigue con el objetivo anterior
    var tx, ty, attack, block, since = g.time - g.lastTouchT;
    // recepción/defensa del compañero que sale desviada: sorpresa, tarda en leerla (no la intercepta al vuelo)
    var shankT = (g.lastShot === 'shank' || g.lastShot === 'body') && g.touchTeam === t ? SHANK_SURPRISE : 0;
    if (since < pr.react + (beaten ? 0.12 : 0) + shankT) {
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
      if (dl > 0.05) { var f = Math.min(1, dl / 0.35) * pr.speed * (beaten ? 0.6 : 1); mx = dx / dl * f; my = dy / dl * f; }
    }
    S._stepPlayer(g, p, dt, mx, my);
    if (g.mode !== 'rally') return;
    // nuevo toque: muestrea los desfases de esta jugada
    if (p.aiTeT !== g.lastTouchT) {
      p.aiTeT = g.lastTouchT;
      p.aiTe = clamp(S._gauss(g) * pr.timing, -0.25, 0.25);
      p.aiJt = clamp(S._gauss(g) * pr.timing * 0.8, -0.15, 0.15);
      p.aiDv = g.rng();
    }
    if (p.z === 0 && p.vz === 0 && p.down <= 0) {
      if (attack && g.pr3.t < 0.47 + p.aiJt && Math.hypot(g.pr3.x + sd * 0.35 - p.x, g.pr3.y - p.y) < 1) aiJump(g, p);
      if (block) {
        var opp = g.teams[1 - t], att = (opp[0].z > 0.1 && Math.abs(opp[0].x) < 4) || (opp[1].z > 0.1 && Math.abs(opp[1].x) < 4);
        if (att && Math.abs(p.x) < 1.3) { p.bd += dt; if (p.bd > p.bdT) { aiJump(g, p); p.bd = 0; p.bdT = pr.blockReact + g.rng() * 0.1; } }
        else p.bd = 0;
      }
    }
    if (g.jobs[t] !== p || p.cool > 0 || since < shankT) return;
    // no se ataca el saque rival por encima de la red (regla 13.3.4): en el aire, deja pasar el saque
    if (g.lastKind === 'serve' && p.z > 0.25 && b.z > C.NET_H) return;
    if (!S.canReach(g, p)) {
      // plancha: el balón se va al suelo fuera del alcance normal
      if (g.time - g.lastTouchT > pr.react && S.canDive(g, p) && b.vz < 0 && b.z < 0.95) {
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
      for (var k = 0; k < 2; k++) if (opp2[k].z > 0.3 && Math.abs(opp2[k].x) < 1.2 && Math.abs(opp2[k].y - p.y) < 1.2) blockUp = true;
      if (blockUp && g.rng() < pr.tip) { shot = 'tip'; tgt = [-sd * (1.3 + g.rng() * 1.4), clamp(-p.y * 0.6 + S._rnd(g, 1.5), -3.6, 3.6)]; }
      else tgt = openSpot(g, p, 2.2, [0, 0], true);
    } else if (count === 3) tgt = openSpot(g, p, 4, [0, 0]);
    S._hit(g, p, null, -w.t, shot, tgt);
  }

  VB.AI = { aim: aim, computeJob: computeJob, pos: pos, update: update, serveTarget: serveTarget, openSpot: openSpot, timeTo: timeTo };
})();
