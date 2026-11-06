/* =====================================================================
 * VOLEY 3D — js/ai.js   (owner: sim)
 * IA de los jugadores (ambos equipos; en el humano, el compañero no
 * controlado). Pura: sin DOM/THREE. Depende de VB.Sim (js/sim.js).
 * La fuerza de cada equipo sale de g.prof[team] (VB.DIFF: easy/normal/hard):
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
  function openSpot(g, p, minDepth, out) {
    var sd = side(p.team), opp = g.teams[1 - p.team], pr = g.prof[p.team], best = -1e9;
    out = out || _t2;
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
        if (sc > best) { best = sc; out[0] = x; out[1] = y; }
      }
    }
    return out;
  }
  /** Destino del saque de la IA. */
  function serveTarget(g, sv) { return openSpot(g, sv, 4, _t2).slice(); }

  /** Quién de este equipo tiene que ir al balón (o null). */
  function computeJob(g, t) {
    var sd = side(t), b = g.ball;
    if (g.mode !== 'rally' || b.held || g.pr1.x * sd <= 0) return null;
    if (g.touchTeam === t && g.touches >= 3) return null;
    if (g.touchTeam === t && g.touches >= 1) return other(g, g.lastPlayer);
    var a = g.teams[t][0], bb = g.teams[t][1], pr = g.pr1, prev = g.jobs[t];
    if (a.down > 0 && !(bb.down > 0)) return bb;
    if (bb.down > 0 && !(a.down > 0)) return a;
    var da = Math.hypot(a.x - pr.x, a.y - pr.y), db = Math.hypot(bb.x - pr.x, bb.y - pr.y);
    if (prev === a && da < db + 1.2) return a; if (prev === bb && db < da + 1.2) return bb;
    return da <= db ? a : bb;
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
      if (!mine || g.touches === 0) return setTg(sd * 2, clamp(p.y, -1.5, 1.5)); // seré el colocador
      if (g.touches === 1) return setTg(sd * 4.3, clamp(p.y, -3, 3));            // seré el atacante
      return setTg(sd * 5.5, idx ? 2 : -2);
    }
    var opp = 1 - t;
    if (g.touchTeam === opp && g.touches === 2 && g.pr3.x * side(opp) > 0) { // el rival va a atacar
      var bl = g.pr3.y < 0 ? g.teams[t][0] : g.teams[t][1];
      // con humano: el compañero IA bloquea solo si el humano está atrás
      if (t === 0 && !g.demo && !g.autopilot) bl = Math.abs(g.ctrl.x) > 4 ? mate : g.ctrl;
      if (p === bl) return setTg(sd * 0.6, clamp(g.pr3.y + g.blockOff[t], -4.2, 4.2), false, true);
      var by = bl === p ? 0 : bl.y;
      return setTg(sd * 6.3, clamp(-by * 0.5 - g.pr3.y * 0.2, -3, 3));
    }
    return setTg(sd * 6.2, idx ? 2.2 : -2.2);
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
    // reacción: tras cada toque, durante pr.react sigue con el objetivo anterior
    var tx, ty, attack, block, since = g.time - g.lastTouchT;
    if (since < pr.react) {
      if (p.tgTime != null && p.tgTime <= g.lastTouchT && g.lastTouchT - p.tgTime < 0.3) {
        tx = p.tgx; ty = p.tgy; attack = p.tgA; block = p.tgB; // sigue con lo que hacía
      } else { tx = p.x; ty = p.y; attack = block = false; }   // aún no ha leído la jugada
    } else {
      var tg = pos(g, p);
      tx = p.tgx = tg.x; ty = p.tgy = tg.y; attack = p.tgA = tg.attack; block = p.tgB = tg.block; p.tgTime = g.time;
    }
    if (p.z === 0) {
      var dx = tx - p.x, dy = ty - p.y, dl = Math.hypot(dx, dy);
      if (dl > 0.05) { var f = Math.min(1, dl / 0.35) * pr.speed; mx = dx / dl * f; my = dy / dl * f; }
    }
    S._stepPlayer(g, p, dt, mx, my);
    if (g.mode !== 'rally') return;
    // nuevo toque: muestrea los desfases de esta jugada
    if (p.aiTeT !== g.lastTouchT) {
      p.aiTeT = g.lastTouchT;
      p.aiTe = clamp(S._gauss(g) * pr.timing, -0.25, 0.25);
      p.aiJt = clamp(S._gauss(g) * pr.timing * 0.8, -0.15, 0.15);
    }
    if (p.z === 0 && p.vz === 0 && p.down <= 0) {
      if (attack && g.pr3.t < 0.47 + p.aiJt && Math.hypot(g.pr3.x + sd * 0.35 - p.x, g.pr3.y - p.y) < 1) aiJump(g, p);
      if (block) {
        var opp = g.teams[1 - t], att = (opp[0].z > 0.1 && Math.abs(opp[0].x) < 4) || (opp[1].z > 0.1 && Math.abs(opp[1].x) < 4);
        if (att && Math.abs(p.x) < 1.3) { p.bd += dt; if (p.bd > p.bdT) { aiJump(g, p); p.bd = 0; p.bdT = pr.blockReact + g.rng() * 0.1; } }
        else p.bd = 0;
      }
    }
    if (g.jobs[t] !== p || p.cool > 0) return;
    if (g.hardIn && !g.digOk) return; // remate / saque que no llega
    if (!S.canReach(g, p)) {
      // plancha: el balón se va al suelo fuera del alcance normal
      if (g.time - g.lastTouchT > pr.react && S.canDive(g, p) && b.vz < 0 && b.z < 0.95) {
        var wd = S.hitWindow(g, p, _w);
        if (!wd.reach || b.z < 0.5) S._dive(g, p, null, -wd.t + p.aiTe * 0.5);
      }
      return;
    }
    var w = S.hitWindow(g, p, _w);
    var rx = b.x - p.x, ry = b.y - p.y, hd = Math.hypot(rx, ry);
    var exiting = (hd > C.REACH - 0.15 && rx * b.vx + ry * b.vy > 0) || (b.z - p.z < 0.3 && b.vz < 0) || (p.z > 0 && p.z < 0.3 && p.vz < 0);
    if (!(w.t <= -p.aiTe || exiting || !w.reach)) return;
    // ¿qué hace con el balón?
    var shot = '', tgt = null, count = g.touchTeam === t ? g.touches + 1 : 1;
    if (p.z > 0.25 && Math.abs(b.x) < 3.8 && b.z > C.NET_H + 0.1) {
      var opp2 = g.teams[1 - t], blockUp = false;
      for (var k = 0; k < 2; k++) if (opp2[k].z > 0.3 && Math.abs(opp2[k].x) < 1.2 && Math.abs(opp2[k].y - p.y) < 1.2) blockUp = true;
      if (blockUp && g.rng() < pr.tip) { shot = 'tip'; tgt = [-sd * (1.3 + g.rng() * 1.4), clamp(-p.y * 0.6 + S._rnd(g, 1.5), -3.6, 3.6)]; }
      else tgt = openSpot(g, p, 2.2, [0, 0]);
    } else if (count === 3) tgt = openSpot(g, p, 4, [0, 0]);
    S._hit(g, p, null, -w.t, shot, tgt);
  }

  VB.AI = { aim: aim, computeJob: computeJob, pos: pos, update: update, serveTarget: serveTarget, openSpot: openSpot };
})();
