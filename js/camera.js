/* =====================================================================
 * VOLEY 3D — js/camera.js   (owner: camera_input)
 *
 * Rig de cámara en tercera persona por "planos" (shots):
 *   menu       retransmisión: órbita alta y lenta (desplazada a la derecha
 *              para no quedar bajo el menú)
 *   serveUs    detrás y por encima (5,4 m) del sacador humano, sobre su hombro derecho, con
 *              el FOV ajustado para que el campo rival (el objetivo) se vea grande
 *   serveThem  detrás de nuestro receptor, algo más alta, para ver al sacador
 *   rally      detrás y por encima del jugador controlado, mirando a la red
 *   attack     nuestro 3er toque / remate: más baja y cerca (ángulo dramático)
 *   defend     el rival construye su ataque: se abre un poco para leerlo
 *   point      entre puntos: plano de REACCIÓN de retransmisión (corte o deslizamiento a una
 *              cámara baja y cerrada sobre el bote y quien falló / ganó; ver planPoint)
 *   over       fin de partido: órbita lenta alrededor de los ganadores
 *
 * Todo se calcula en coordenadas de SIMULACIÓN (z arriba) y se pasa a
 * Three.js con VB.toThree al final.
 * Movimiento: SmoothDamp vectorial críticamente amortiguado (sin rebote)
 * con velocidad máxima en las transiciones. Al cambiar de jugador, el
 * "sujeto" que sigue la cámara se desliza con easing (0,35-0,6 s) del
 * jugador anterior al nuevo: nunca hay corte.
 * Encuadre: el jugador queda en el tercio inferior (pies a ~-0,56 NDC) y,
 * si el balón se va arriba o a un lado, la cámara cabecea / gira lo justo
 * para mantenerlo en pantalla sin perder al jugador (y abre algo el FOV
 * si no cabe).
 * Jugo: temblor suave por ruido (no aleatorio por frame), "punch" de FOV
 * en los remates propios, micro‑pausa (hit‑stop) y cámara lenta en la
 * bola de partido (ctx.timeScale).
 * getBasis(): ejes adelante/derecha EN EL SUELO de la cámara de juego
 * (coords de sim). Se limita a ±26° de "hacia la red" y se congela en los
 * planos cinemáticos para que los controles nunca den bandazos.
 * ===================================================================== */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;
  var VB = root.VB = root.VB || {};

  var DEG = Math.PI / 180;
  var THREE = null, ctx = null, cam = null, tgt3 = null;

  function V() { return { x: 0, y: 0, z: 0 }; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; } // easeInOutCubic
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // ---------------- Estado del rig (todo preasignado: cero basura por frame) ----------------
  var P = V(), PV = V();           // posición real de la cámara + velocidad
  var L = V(), LV = V();           // punto de mira real + velocidad
  var D = V(), A = V();            // deseados: posición, punto de mira
  var S = V();                     // sujeto (pies del jugador seguido, con deslizamiento al cambiar)
  var F = V();                     // punto a encuadrar en el tercio inferior (pies)
  var fovCur = 54, fovVel = [0], fovWant = 54;
  var exYaw = 0, exPitch = 0, exVel = [0, 0], fovBoost = 0, fovBoostVel = [0];
  var film = 0, filmVel = [0];
  var shot = 'menu', prevShot = '', blendT = 0, blendDur = 0, blendSmooth = 0.6, blendMax = 30;
  var swFast = 0;
  var sw = { active: false, t: 0, dur: 0.45, from: V(), to: null, back: false };
  var landOk = false, landX = 0, landY = 0;
  var pointT = 0, pointHow = '', pointPlayer = null;
  var overT = 0, overA0 = 0, overC = V();
  var orbit = 0.6, timeAcc = 0;
  var basis = { fx: -1, fy: 0, rx: 0, ry: 1 }, basisYaw = Math.PI;
  var shakeA = 0, shakeT = 0, shakeDur = 0.3, shakeRoll = 0;
  var kick = 0;                    // punch de FOV (grados, decae)
  var slow = { t: 0, scale: 1, out: 0.4, total: 0 };
  var reduceMotion = false;
  var dbg = { shot: '', yaw: 0, pitch: 0, fov: 0, ballNdcX: 0, ballNdcY: 0, ctrlNdcY: 0, ballVisible: true, netK: 0, focusNdcY: 9 };

  // ---------------- Planos de juego (ajustados mirando capturas) ----------------
  // back: distancia detrás del sujeto (m) · h: altura de cámara · fov vertical (16:9)
  // k: dónde quedan los pies (NDC, negativo = abajo) · lat: cuánto sigue la cámara la y del jugador
  // off: desplazamiento lateral (m, + = derecha de pantalla) · aimX: a qué distancia mira hacia la red
  // aimLat: fracción de la y del jugador en el punto de mira · ball: sesgo del punto de mira hacia el balón
  // court: la línea de fondo rival al menos a esa altura NDC (=> la pista ocupa >= ~60 % del cuadro)
  // side: cámara "por encima del hombro" (m, hacia el lado contrario al balón) · server: sesgo de la mira hacia el sacador rival
  // hMob: altura en móvil
  var SHOTS = {
    rally:     { back: 6.0, h: 4.0,  fov: 54, k: -0.52, both: 2.6, lat: 0.78, off: 0,    aimX: 8.5, aimLat: 0.30, ball: 0.25, smooth: 0.30, zf: 0.40, court: 0.20 },
    defend:    { back: 6.5, h: 4.3,  fov: 55, k: -0.56, both: 3.0, lat: 0.72, off: 0,    aimX: 9.5, aimLat: 0.25, ball: 0.30, smooth: 0.34, zf: 0.40, court: 0.22 },
    attack:    { back: 4.9, h: 3.6,  fov: 52, k: -0.42, rise: 3.0, lat: 0.85, off: 0,    aimX: 7.0, aimLat: 0.45, ball: 0.20, smooth: 0.26, zf: 0.70, court: 0.20, side: 2.3 },
    // saque propio: cámara alta (4,6 m) sobre el hombro y FOV AJUSTADO (fit) para que el campo rival, que es el
    // objetivo del saque, ocupe todo lo posible: línea de fondo rival a fit.top NDC, cadera del sacador a fit.hip y la
    // lanzamiento por debajo de fit.ball. Antes (h 2,85) el campo rival era una tira de ~60 px (8 %); ahora ~17 % del alto
    // y, al estar más alta, la malla de la red tapa menos el campo rival.
    serveUs:   { back: 4.2, h: 5.4,  fov: 46, k: -0.62, lat: 1.00, off: 1.05, aimX: 16,  aimLat: 0.25, ball: 0,    smooth: 0.28, zf: 0.30,
                 fit: { top: 0.55, lowZ: 1.35, low: -0.88, ball: 0.72 } },
    serveThem: { back: 6.0, h: 4.1,  fov: 42, k: -0.52, lat: 0.55, off: 0,    aimX: 15,  aimLat: 0.10, ball: 0.15, smooth: 0.32, zf: 0.40, server: 0.55, hMob: 3.6 }
  };
  var GAMEPLAY = { rally: 1, defend: 1, attack: 1, serveUs: 1, serveThem: 1 };

  // ---------------- SmoothDamp ----------------
  // Vectorial (Unity/Game Programming Gems 4), con velocidad máxima isótropa.
  function sdv(cur, target, vel, smoothT, dt, maxSpeed) {
    smoothT = Math.max(0.0001, smoothT);
    var omega = 2 / smoothT, x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var cx = cur.x - target.x, cy = cur.y - target.y, cz = cur.z - target.z;
    var ox = target.x, oy = target.y, oz = target.z;
    var maxC = (maxSpeed || 1e9) * smoothT, l2 = cx * cx + cy * cy + cz * cz;
    if (l2 > maxC * maxC) { var s = maxC / Math.sqrt(l2); cx *= s; cy *= s; cz *= s; }
    var tx = cur.x - cx, ty = cur.y - cy, tz = cur.z - cz;
    var px = (vel.x + omega * cx) * dt, py = (vel.y + omega * cy) * dt, pz = (vel.z + omega * cz) * dt;
    vel.x = (vel.x - omega * px) * e; vel.y = (vel.y - omega * py) * e; vel.z = (vel.z - omega * pz) * e;
    var nx = tx + (cx + px) * e, ny = ty + (cy + py) * e, nz = tz + (cz + pz) * e;
    // sin sobrepaso
    if ((ox - cur.x) * (nx - ox) + (oy - cur.y) * (ny - oy) + (oz - cur.z) * (nz - oz) > 0) { nx = ox; ny = oy; nz = oz; vel.x = vel.y = vel.z = 0; }
    cur.x = nx; cur.y = ny; cur.z = nz;
  }
  function sd1(cur, target, velArr, i, smoothT, dt) {
    var omega = 2 / Math.max(0.0001, smoothT), x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var c = cur - target, tmp = (velArr[i] + omega * c) * dt;
    velArr[i] = (velArr[i] - omega * tmp) * e;
    var out = target + (c + tmp) * e;
    if ((target - cur > 0) === (out > target)) { out = target; velArr[i] = 0; }
    return out;
  }

  // ---------------- Utilidades ----------------
  function aspect() { return ctx && ctx.height > 0 ? ctx.width / ctx.height : 16 / 9; }
  /** FOV vertical según el aspecto: abre en pantallas estrechas (4:3) y cierra en móviles muy anchos. */
  function fovFor(base, hMinHalf, vLow) {
    var a = aspect();
    var vMin = 2 * Math.atan(Math.tan((hMinHalf || 37) * DEG) / a) / DEG;  // al menos ~74° de horizontal (o lo pedido)
    var vMax = 2 * Math.atan(Math.tan(46 * DEG) / a) / DEG;                // como mucho ~92° de horizontal
    return clamp(clamp(base, vMin, vMax), vLow || 40, 80);
  }
  /** Ajuste de dos restricciones: el punto de ángulo aT (elevación, rad) a nT NDC y el de aB a nB NDC (nB < 0 < nT).
   *  Devuelve en fitOut {p: cabeceo, t: tan(fov/2)}. Bisección (12 pasos): sin asignaciones. */
  var fitOut = { p: 0, t: 0.4 }, fitLow = { z: 1.35, n: -0.88 };
  function fit2(aT, nT, aB, nB) {
    var lo = aB + 1e-4, hi = aT - 1e-4;
    for (var i = 0; i < 14; i++) {
      var p = (lo + hi) / 2;
      if (Math.tan(aT - p) / nT > Math.tan(p - aB) / -nB) lo = p; else hi = p;
    }
    fitOut.p = (lo + hi) / 2; fitOut.t = Math.tan(aT - fitOut.p) / nT;
    return fitOut;
  }
  /** Potencia del golpe 0..1 (sim la da en e.power; si falta, se deduce de la velocidad). */
  function hitPower(e) {
    if (typeof e.power === 'number' && e.power === e.power) return clamp(e.power, 0, 1);
    return clamp(((e.speed || 15) - 11) / 9, 0, 1);
  }
  /** Multiplicador por calidad del toque. */
  function gradeMul(gr) { return gr === 'perfect' ? 1.25 : gr === 'poor' ? 0.75 : 1; }
  function isPlaying() { return ctx && (ctx.state === 'playing' || ctx.state === 'paused'); }

  /** Elige el plano según el estado del partido. */
  function pickShot(g) {
    if (!g || g.demo || ctx.state === 'menu') return 'menu';
    if (g.mode === 'over' || g.finished || ctx.state === 'over') return 'over';
    if (g.mode === 'point') return 'point';
    if (g.mode === 'serve') return g.serving === 0 ? 'serveUs' : 'serveThem';
    var p = g.ctrl, b = g.ball;
    if (p && p.lastAction === 'spike' && p.actionT < 0.75) return 'attack';
    if (g.touchTeam === 0 && g.touches >= 2 && b.x > -0.5 && p && g.jobs && g.jobs[0] === p && Math.abs(p.x) < 5.5) return 'attack';
    if (b.x < 0 && g.touchTeam === 1 && g.touches >= 1 && g.lastKind !== 'serve') return 'defend';
    return 'rally';
  }

  /** Sujeto que sigue la cámara (pies del jugador controlado), con deslizamiento en los cambios. */
  function subject(g, dt) {
    var p = g.ctrl;
    if (sw.active && sw.to) {
      sw.t += dt;
      // si el nuevo jugador está más cerca de la cámara (detrás), la cámara arranca a retroceder ya (ease‑out);
      // si no, curva suave en S. El SmoothDamp de la posición añade el arranque suave.
      var u = clamp(sw.t / sw.dur, 0, 1), to = sw.to;
      var k = sw.back ? 1 - Math.pow(1 - u, 3) : smooth01(u);
      S.x = sw.from.x + (to.x - sw.from.x) * k;
      S.y = sw.from.y + (to.y - sw.from.y) * k;
      S.z = sw.from.z + (to.z - sw.from.z) * k;
      if (sw.t >= sw.dur || to !== p) sw.active = false;
      if (to === p) { S.x += ant.x; S.y += ant.y; return; }
    }
    S.x = p.x + ant.x; S.y = p.y + ant.y; S.z = p.z;
  }
  /** ANTICIPACIÓN DEL CAMBIO: con el rival construyendo su ataque y nuestro jugador en la red, el control
   *  pasará al compañero de atrás en cuanto el remate cruce (AI.computeJob). En vez de esperar al evento
   *  (el defensor estaría debajo de la cámara y habría que retroceder de golpe), el sujeto se desliza ya,
   *  durante la recepción y la colocación rivales (~1,5 s), hacia un punto entre los dos: al llegar el
   *  cambio, el defensor ya está en el cuadro y el bloqueador sigue visible delante. */
  var ant = V(), antT = V(), antV = V(), antW = 0, antLead = 1;
  function updateAnticipation(g, dt) {
    var p = g.ctrl, w = 0, wy = 0.8, m = null;
    antLead = 1;
    if (p && g.mode === 'rally' && !g.demo) {
      m = mateOf(g);
      if (g.touchTeam === 1 && g.touches >= 1 && g.lastKind !== 'serve') {
        // defensa: nuestro jugador es el de delante (va a la red a bloquear); el remate irá al de atrás
        w = 0.72 * smooth01((m.x - p.x - 1.0) / 2.2);
        antLead = 1 - clamp(w / 0.4, 0, 1);
      } else if (g.touchTeam === 0 && g.touches === 1 && g.jobs && g.jobs[0] === p) {
        // colocación propia: tras ella el control pasa SIEMPRE al compañero (rematador). El sujeto se
        // abre un poco hacia él (sobre todo a lo ancho) para que el cambio no lo deje fuera por un lado.
        w = 0.36; wy = 1.0;
      }
    }
    antW = w;
    antT.x = w ? (m.x - p.x) * w : 0; antT.y = w ? (m.y - p.y) * w * wy : 0; antT.z = 0;
    if (dt > 0) sdv(ant, antT, antV, comfort() ? 0.55 : 0.38, dt, 9);
    else { ant.x = antT.x; ant.y = antT.y; antV.x = antV.y = 0; }
  }
  /** Anticipación: la cámara se adelanta un poco a la carrera del jugador (compensa el retraso del suavizado). */
  var lead = V(), leadV = V(), leadT = V();
  function updateLead(g, dt) {
    // (sin anticipación de carrera mientras el sujeto se adelanta al defensor: el bloqueador corre hacia la red)
    var p = g.ctrl, k = (g.mode === 'rally' && p) ? 0.24 * antLead : 0;
    leadT.x = k ? clamp(p.vx, -7, 7) * k : 0; leadT.y = k ? clamp(p.vy, -7, 7) * k * 0.7 : 0; leadT.z = 0;
    if (dt > 0) sdv(lead, leadT, leadV, 0.25, dt, 20);
  }

  function mateOf(g) { var t = g.teams[0]; return t[0] === g.ctrl ? t[1] : t[0]; }
  /** Modo confort: prefers-reduced-motion o el ajuste opcional "Cámara estable" (ctx.settings.camStable). */
  function comfort() { return reduceMotion || !!(ctx && ctx.settings && ctx.settings.camStable); }

  /** Plano de juego genérico: detrás del sujeto, mirando hacia la red. */
  var occl = 0, netK = 0, netSide = 1, atkSide = 1, nearK = 0, airK = 0, mOcc = 0;
  function gameplayShot(g, c, dt) {
    var b = g.ball, ahead = b.x < S.x + c.back - 1.2;   // balón por delante de la cámara
    var back = c.back, h = (ctx.isMobile && c.hMob) ? c.hMob : c.h, p = g.ctrl, calm = comfort();
    // EN LA RED: el jugador controlado pegado a la red con el rival construyendo (o recién bloqueado).
    // Se mide antes de colocar la cámara porque cambia la distancia y la altura (entra en ~0,7 s).
    var netW = 0;
    if (p && g.mode === 'rally') {
      var nearNet = smooth01((2.4 - S.x) / 1.4);                    // 1 a < 1 m de la red, 0 a > 2,4 m
      var threat = (b.x < 0.4 && g.touchTeam === 1) || (p.lastAction === 'block' && p.actionT < 0.9) ? 1 : 0;
      netW = nearNet * threat;
    }
    if (dt > 0) netK += (netW - netK) * Math.min(1, dt * (netW > netK ? 2.6 : 1.4));
    else netK = netW;
    if (c.rise && ahead) {
      // balón alto (colocación en el aire): la cámara se abre para no perderlo y se cierra al bajar
      // (en modo confort solo se abre: sin subir, para no cabecear)
      var hi = smooth01((b.z - 3.0) / 2.6);
      back += c.rise * hi * (calm ? 0.7 : 1); h += (calm ? 0 : 0.25) * hi;
    }
    if (ctx.isMobile) { back *= 0.94; }
    // REMATE PROPIO EN EL AIRE: la cámara sube ~0,7 m (y deja de subir con el salto) y se abre más de lado: el
    // cuerpo del rematador queda por debajo y a un lado del balón, las manos del bloqueo y el campo abierto
    // (entra en ~0,25 s; sale algo más despacio)
    var airW = (c.side && p && p.z > 0.12) ? 1 : 0;
    if (dt > 0) airK += (airW - airK) * Math.min(1, dt * (airW > airK ? 4 : 2.2)); else airK = airW;
    if (airK > 0.001) { h += 0.7 * airK * (calm ? 0.5 : 1); back -= 0.35 * airK; }
    // en la red: más cerca y no tan alta (a 8-9 m y 6 m de altura la grada se comía medio cuadro)
    if (netK > 0.001) { back += (Math.min(back, 6.2) - back) * netK; h += (Math.min(h + 0.2, 4.5) - h) * netK; }
    // posición: detrás (+x, equipo humano en x>0), algo hacia el centro en y
    var dx = S.x + back + lead.x, over = 0;
    // la cámara se queda algo por detrás del compañero si está justo detrás del jugador (el cambio de
    // control no la deja encima del nuevo). Limitado a 2,2 m y sin efecto en la red: ahí manda el encuadre
    // del bloqueo y el cambio al defensor lo resuelve el deslizamiento (ver update/framing).
    if (c.both && p) {
      var mate = mateOf(g), minX = mate.x + c.both, wB = 1 - netK;
      if (dx < minX && wB > 0) { var push = Math.min(2.2, (minX - dx) * 0.85) * wB; dx += push; h += push * 0.15; }
    }
    if (dx > 14.4) { over = dx - 14.4; dx = 14.4; }       // no meterse en el fondo / vallas
    D.x = dx;
    // (saque en táctil: el sacador más centrado; abajo a la izquierda está el joystick y a la derecha SACAR)
    D.y = clamp((S.y + lead.y) * c.lat + c.off * (c.fit && touchUI() ? 0.35 : 1), -8.5, 8.5);
    // que el compañero no tape al jugador: si está entre la cámara y él, la cámara se aparta de lado
    var want = 0;
    if (g.ctrl) {
      var m2 = mateOf(g);
      var lx = S.x - D.x, ly = S.y - D.y, ll = Math.hypot(lx, ly);
      if (ll > 0.5) {
        var t = ((m2.x - D.x) * lx + (m2.y - D.y) * ly) / (ll * ll);
        if (t > 0.05 && t < 0.97) {
          var side = ((m2.x - D.x) * ly - (m2.y - D.y) * lx) / ll;   // distancia (con signo) del compañero a la línea
          var gap = 0.9 - Math.abs(side);
          if (gap > 0) want = (side >= 0 ? -1 : 1) * gap * 1.8 * smooth01((t - 0.05) / 0.2);
        }
      }
    }
    if (dt > 0) occl += (want - occl) * Math.min(1, dt * 3); else occl = want;   // snap: ya apartada
    // desplazamiento perpendicular a la línea de visión (en el suelo, aproximadamente en y)
    D.y = clamp(D.y + occl, -8.5, 8.5);
    // BLOQUEO EN LA RED: el cuerpo del jugador controlado taparía al atacante. La cámara se aparta
    // hacia el lado del balón: se ve al rematador por encima del hombro y el bloqueador queda a un lado.
    if (netK > 0.001) {
      // lado: hacia donde está el balón respecto al jugador; si está justo delante, hacia el centro de la pista
      var dyb = clamp(b.y, -5, 5) - S.y, sideW = Math.abs(dyb) > 0.35 ? (dyb > 0 ? 1 : -1) : (S.y > 0 ? -1 : 1);
      netSide += (sideW - netSide) * Math.min(1, dt > 0 ? dt * 2.2 : 1);
      D.y = clamp(D.y + netSide * 1.25 * netK, -8.5, 8.5);
    }
    // ATAQUE: por encima del hombro, hacia el lado en que el bloqueador rival está desplazado respecto al
    // rematador. Desde ahí, la línea cámara->rematador sale al otro lado y el bloqueador (y el campo abierto)
    // se ven durante el salto en vez de quedar tapados por la espalda. (Con la regla "lado contrario al
    // balón", como el bloqueador se pone delante del balón, quedaba justo detrás del rematador.)
    if (c.side && p) {
      var r0 = g.teams[1][0], r1 = g.teams[1][1], blk = Math.abs(r0.x) < Math.abs(r1.x) ? r0 : r1;
      var dyk = blk.y - S.y, sideA;
      if (Math.abs(blk.x) < 3 && Math.abs(dyk) > 0.25) {
        sideA = dyk > 0 ? 1 : -1;
        if (sideA * atkSide < 0 && Math.abs(dyk) < 0.6 && dt > 0) sideA = atkSide > 0 ? 1 : -1;   // histéresis: sin bandazos laterales
      }
      else if (Math.abs(S.y) > 1.2) sideA = S.y > 0 ? -1 : 1;     // bloqueador en línea: hacia el centro (campo abierto)
      else { var dya = clamp(b.y, -5, 5) - S.y; sideA = Math.abs(dya) > 0.3 ? (dya > 0 ? -1 : 1) : (S.y > 0 ? -1 : 1); }
      atkSide += (sideA - atkSide) * Math.min(1, dt > 0 ? dt * 1.8 : 1);
      D.y = clamp(D.y + atkSide * c.side * (1 + 0.35 * airK) * (calm ? 0.6 : 1), -8.5, 8.5);
    }
    // ATAQUE RIVAL CON UN COMPAÑERO NUESTRO EN LA RED: su cuerpo (y su bloqueo) taparía al rematador y el
    // contacto. La cámara se aparta de lado (lejos de él) lo que haga falta para que la línea cámara->balón pase a
    // ~1 m de él (como está cerca del balón, el desplazamiento se multiplica: tope 2,2 m) y sube hasta 0,8 m
    // (el balón queda por encima de las manos del bloqueo); entra en ~0,3 s y vuelve suave después.
    var mw = 0;
    if (p && g.mode === 'rally' && g.touchTeam === 1 && g.touches >= 1 && g.lastKind !== 'serve' && b.x < 1.5) {
      var mo = mateOf(g);
      if (mo.x < 3.2) {
        var tx = b.x + b.vx * 0.25, ty = b.y + b.vy * 0.25, lx2 = tx - D.x, ly2 = ty - D.y, l2 = lx2 * lx2 + ly2 * ly2;
        if (l2 > 1) {
          var tm = ((mo.x - D.x) * lx2 + (mo.y - D.y) * ly2) / l2;
          if (tm > 0.1 && tm < 0.98) {
            var sdm = ((mo.x - D.x) * ly2 - (mo.y - D.y) * lx2) / Math.sqrt(l2);   // lado del compañero respecto a la línea
            var gapm = 1.0 - Math.abs(sdm);
            if (gapm > 0) mw = clamp(gapm / Math.max(0.25, 1 - tm), 0, 2.2) * (sdm >= 0 ? -1 : 1) * (calm ? 0.6 : 1);
          }
        }
      }
    }
    if (dt > 0) mOcc += (mw - mOcc) * Math.min(1, dt * (Math.abs(mw) > Math.abs(mOcc) ? 3.2 : 1.6)); else mOcc = mw;
    if (Math.abs(mOcc) > 0.001) {
      // (mOcc > 0: hacia la izquierda de la línea cámara->balón, vista desde arriba; sdm > 0 = compañero a la derecha)
      var llx = (b.x - D.x), lly = (b.y - D.y), lln = Math.hypot(llx, lly) || 1;
      D.x += (lly / lln) * mOcc; D.y = clamp(D.y - (llx / lln) * mOcc, -8.5, 8.5);
    }
    // compañero pegado a la cámara (salía cortado y enorme en una esquina): la cámara se aparta en planta
    // hasta ~2,6 m de él (suavizado; en el remate, sobre todo, el colocador puede quedar detrás)
    if (p) {
      var mq = mateOf(g), qx = D.x - mq.x, qy = D.y - mq.y, ql = Math.hypot(qx, qy), nearW = 0;
      if (ql < 2.6) nearW = (2.6 - ql) / Math.max(0.3, ql);
      if (dt > 0) nearK += (nearW - nearK) * Math.min(1, dt * 4); else nearK = nearW;
      if (nearK > 0.001 && ql > 0.01) { D.x += qx * nearK; D.y = clamp(D.y + qy * nearK, -8.5, 8.5); }
    }
    var high = ahead ? clamp((b.z - 4) * 0.12, 0, 0.55) * (1 - 0.7 * netK) : 0; // balón muy alto: sube un poco
    high += Math.min(0.8, Math.abs(mOcc) * 0.45);
    D.z = h + S.z * c.zf * (1 - 0.6 * airK) + over * 0.32 + high;
    // punto de mira en el suelo hacia la red (define el rumbo / yaw)
    var ax = S.x - c.aimX, ay = S.y * c.aimLat;
    if (c.ball > 0 && ahead) ay += (clamp(b.y, -6, 6) - ay) * c.ball;
    // saque rival: la mira se va hacia el sacador (y el FOV del plano es más cerrado) para leer el saque
    if (c.server && g.server && g.server.team === 1) ay += (clamp(g.server.y, -5, 5) - ay) * c.server;
    var yaw = Math.atan2(ay - D.y, ax - D.x);
    // cabeceo: pies del sujeto a c.k (NDC) -> jugador en el tercio inferior
    F.x = S.x; F.y = S.y; F.z = S.z;
    var cy = Math.cos(yaw), syw = Math.sin(yaw);
    var fd = Math.max(0.5, (F.x - D.x) * cy + (F.y - D.y) * syw);
    var tanH = Math.tan(fovFor(c.fov) * DEG / 2);
    var aF = Math.atan2(F.z - D.z, fd);
    // táctil: el jugador más arriba (pies a ~-0,40 NDC en vez de -0,52): debajo están los pulgares
    var pitch = aF - Math.atan((touchUI() && !c.fit ? c.k + 0.12 : c.k) * tanH);
    // LA PISTA MANDA: la línea de fondo rival no baja de c.court (NDC). Así la grada y el techo nunca se
    // comen más de ~40 % del cuadro (antes, en la red, llegaban al 55 %). Los pies no suben de -0,12.
    if (c.court && cy < -0.25) {
      var aFar = Math.atan2(-D.z, Math.max(2, (-9 - D.x) / cy));
      var pc = aFar - Math.atan(c.court * tanH);
      if (pc < pitch) pitch = Math.max(pc, aF + Math.atan(0.12 * tanH));
    }
    // anticipación del cambio: el defensor (compañero de atrás) entra por abajo, pies a ~-0,8 NDC
    if (antW > 0.01 && p && g.touchTeam === 1) {
      var mt = mateOf(g), fdm = (mt.x - D.x) * cy + (mt.y - D.y) * syw;
      if (fdm > 0.8) {
        var pm = Math.atan2(-D.z, fdm) + Math.atan(0.8 * tanH);
        if (pm < pitch) pitch += (pm - pitch) * clamp(antW / 0.5, 0, 1);
      }
    }
    fovWant = fovFor(c.fov);
    if (c.fit && p) fitServe(g, c, fd, cy, syw);
    if (c.fit && p) pitch = fitOut.p;
    pitch = clamp(pitch, -0.6, 0.35);
    var cp = Math.cos(pitch);
    A.x = D.x + cy * cp * 10; A.y = D.y + syw * cp * 10; A.z = D.z + Math.sin(pitch) * 10;
  }

  /** SAQUE PROPIO: cabeceo y FOV ajustados para que el campo rival (objetivo del saque) se vea grande.
   *  Arriba manda la línea de fondo rival (a fit.top NDC) o, si pide más, la cumbre del lanzamiento (prevista antes
   *  con el balón en el aire: la prevista; el FOV "respira" ~6° durante el lanzamiento en salto) por debajo de fit.ball. Abajo, la
   *  cadera del sacador a fit.hip. Deja el resultado en fitOut.p (cabeceo) y en fovWant. */
  function fitServe(g, c, fd, cy, syw) {
    var b = g.ball, tch = touchUI(), mob = !!ctx.isMobile;
    var nTop = c.fit.top + (tch || mob ? 0.07 : 0), nBall = c.fit.ball - (tch ? 0.1 : mob ? 0.05 : 0);
    // con el balón lanzado manda el sacador entero (cintura) y el balón: es el momento de medir el golpe
    var tossing = g.serveState === 'toss' && !b.held, lowZ = tossing ? 0.9 : c.fit.lowZ;
    // (táctil: el sacador algo más arriba, por encima de la franja de los pulgares y del aviso de SACAR)
    var nHip = tossing ? (tch ? -0.7 : -0.82) : c.fit.low + (tch ? 0.18 : 0);
    var fdT = (-9 - D.x) / Math.min(-0.2, cy);
    var aT = Math.atan2(-D.z, Math.max(4, fdT)), aB = Math.atan2(S.z + lowZ - D.z, fd);
    var r = fit2(aT, nTop, aB, nHip), aTop = aT, nT = nTop;
    var G = (VB.C && VB.C.G) || 9.81, bx, by, bz;
    if (tossing) {
      var up = Math.max(0, b.vz) / G;
      bx = b.x + b.vx * up; by = b.y + b.vy * up; bz = b.z + Math.max(0, b.vz) * up * 0.5;
    } else { bx = b.x; by = b.y; bz = b.z; }
    var fdA = (bx - D.x) * cy + (by - D.y) * syw;
    if (fdA > 0.8) {
      var aA = Math.atan2(bz - D.z, fdA);
      if (Math.tan(aA - r.p) > nBall * r.t) { var pT = r.p, tT = r.t; r = fit2(aA, nBall, aB, nHip); aTop = aA; nT = nBall; if (r.t < tT) { r.p = pT; r.t = tT; } }
    }
    var fv = 2 * Math.atan(r.t) / DEG, fMax = fovFor(56), fMin = fovFor(30, 25, 30);
    if (fv > fMax) { fv = fMax; r.p = aTop - Math.atan(nT * Math.tan(fv * DEG / 2)); }          // arriba manda (el balón)
    else if (fv < fMin) { fv = fMin; r.p = aB - Math.atan(nHip * Math.tan(fv * DEG / 2)); }
    fovWant = fv; fitLow = { z: lowZ, n: nHip };
  }

  /* ---------------- PLANO DE REACCIÓN (entre puntos) ----------------
   * Gramática de retransmisión: ~0,45 s mirando caer el balón desde donde estaba la cámara y CORTE a un plano
   * bajo (1,6-1,9 m) y cerrado (FOV ~32-36°) del bote + el jugador que no llegó / falló (+ el que ganó el punto
   * si está cerca y en el mismo campo), con una deriva lenta. La posición se elige entre 24 ángulos alrededor
   * del grupo, puntuando: dentro de la zona libre, a >= 1,5 m de oficiales, mesa, postes y silla del árbitro, a
   * >= 2 m de los jugadores, sin la red entre la cámara y el grupo, sin nadie delante, y mirando hacia el que
   * ganó el punto (queda al fondo). Si el plano elegido está en el mismo campo y cerca, se llega deslizando en
   * vez de cortar. El borde superior queda por debajo del marcador colgado (nunca a medias).
   * (Antes: dolly hacia el bote desde la cámara de juego -> media pantalla de grada, red y poste delante,
   * marcador cortado y un oficial asomando por la esquina.) */
  // obstáculos fijos [x, y, radio] (coords de sim): postes, silla del 1.er árbitro, 2.º árbitro, mesa, jueces de línea
  var OBST = [[0, 5.5, 0.25], [0, -5.5, 0.25], [0, -6.12, 0.6], [0, 6.05, 0.35], [-1.2, 8.25, 0.7], [0, 8.25, 0.7], [1.2, 8.25, 0.7],
              [10.4, -5.9, 0.35], [-10.4, 5.9, 0.35]];
  var PF = { lx: 0, ly: 0, vic: null, hero: null, heroIn: false, c0x: 0, c0y: 0, cx: 0, cy: 0, R: 6, ang: 0, fov: 34, z: 1.75,
             cut: false, hold: 0.45, cutDone: true, cutNow: false, dir: 1, w: 0 };
  var cutCheck = false;
  function nearestOf(list, x, y, skip) {
    var best = null, bd = 1e9;
    for (var i = 0; i < list.length; i++) { var q = list[i]; if (q === skip) continue; var d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  /** Cómo se ganó el punto si no llegó el evento (escenas congeladas). */
  function inferHow(g) {
    var lp = g.lastPoint; if (!lp) return '';
    if (lp.reason === 'in' && g.lastTeam === lp.team) return g.lastKind === 'serve' ? 'ace' : g.lastKind === 'block' ? 'block' : g.lastKind === 'spike' ? 'kill' : 'free';
    // recepción del saque que no se controla (un solo toque tras el saque): ace
    if ((lp.reason === 'in' || lp.reason === 'out') && g.lastTeam !== lp.team && g.lastKind === 'pass' && g.rally && g.rally.hits <= 2) return 'ace';
    return 'error';
  }
  /** Centro del grupo (bote + víctima + héroe si entra) con las posiciones de AHORA. */
  function groupCenter(out) {
    var x = PF.lx, y = PF.ly, wsum = 1;
    if (PF.vic) { x += PF.vic.x; y += PF.vic.y; wsum += 1; }
    if (PF.hero && PF.heroIn) { x += PF.hero.x * 0.7; y += PF.hero.y * 0.7; wsum += 0.7; }
    out.x = x / wsum; out.y = y / wsum; out.z = 0;
    return out;
  }
  var GC = V();
  function planPoint(g, how, faultP) {
    var w = g.lastPoint ? g.lastPoint.team : 0, los = 1 - w, b = g.ball;
    PF.w = w;
    // bote: evento 'land' del rally o g.lastLand (escenas congeladas); si no lo hubo (red, dobles...), el balón
    var ll = landOk ? null : (g.lastLand && g.lastLand.t > g.time - 6 ? g.lastLand : null);
    var lx = landOk ? landX : ll ? ll.x : b.x, ly = landOk ? landY : ll ? ll.y : b.y;
    if (!landOk && !ll && faultP) { lx = faultP.x * 0.7 + b.x * 0.3; ly = faultP.y * 0.7 + b.y * 0.3; }
    // víctima: el infractor (si es del que pierde), el último que tocó si es del que pierde (la recepción que
    // se va, el remate fuera) o el del que pierde más cerca del bote
    var lastL = g.lastPlayer && g.lastPlayer.team === los && Math.hypot(g.lastPlayer.x - lx, g.lastPlayer.y - ly) < 12 ? g.lastPlayer : null;
    var vic = faultP && faultP.team === los ? faultP : lastL || nearestOf(g.teams[los], lx, ly, null);
    if (vic && vic !== faultP && vic !== lastL && Math.hypot(vic.x - lx, vic.y - ly) > 8) {
      var any = nearestOf(g.players, lx, ly, null);
      vic = any && Math.hypot(any.x - lx, any.y - ly) < 6 ? any : null;
    }
    // ace con recepción desviada lejos (shank): el foco es el receptor y la zona de recepción, no el bote fuera
    var far = Math.abs(lx) > 10.3 || Math.abs(ly) > 5.8;
    if (far && vic) { lx = vic.x + (lx - vic.x) * 0.35; ly = vic.y + (ly - vic.y) * 0.35; }
    PF.lx = clamp(lx, -10.8, 10.8); PF.ly = clamp(ly, -6.6, 6.6); PF.vic = vic;
    // héroe: el último del que gana que tocó (el sacador en un ace)
    var hero = (g.lastTeam === w && g.lastPlayer) ? g.lastPlayer : (how === 'ace' && g.server && g.server.team === w ? g.server : null);
    if (hero === vic) hero = null;
    PF.hero = hero; PF.heroIn = false;
    groupCenter(GC);
    if (hero && hero.x * GC.x > 0 && Math.abs(hero.x) > 0.6 && Math.hypot(hero.x - GC.x, hero.y - GC.y) < 7.5) { PF.heroIn = true; groupCenter(GC); }
    var cx = GC.x, cy = GC.y;
    PF.c0x = cx; PF.c0y = cy; PF.cx = cx; PF.cy = cy;
    var tight = (how === 'ace' || how === 'kill' || how === 'block') ? 32 : 35;
    var tanV = Math.tan(tight * DEG / 2), tanHh = tanV * Math.max(1.1, aspect());
    var best = 1e9, bAng = 0, bR = 6, bFov = tight, n = 24;
    for (var k = 0; k < 2 * n; k++) {
      // 24 ángulos x 2 distancias (la justa y un 30 % más lejos: la perspectiva agranda a quien queda cerca)
      var th = (k % n) * 2 * Math.PI / n, ux = Math.cos(th), uy = Math.sin(th), mR = k < n ? 1 : 1.3;
      // anchura del grupo perpendicular a la mirada
      var sMin = -0.4, sMax = 0.4;
      var s0 = -(PF.lx - cx) * uy + (PF.ly - cy) * ux; sMin = Math.min(sMin, s0); sMax = Math.max(sMax, s0);
      if (vic) { var s1 = -(vic.x - cx) * uy + (vic.y - cy) * ux; sMin = Math.min(sMin, s1); sMax = Math.max(sMax, s1); }
      if (PF.heroIn) { var s2 = -(hero.x - cx) * uy + (hero.y - cy) * ux; sMin = Math.min(sMin, s2); sMax = Math.max(sMax, s2); }
      var half = Math.max(Math.abs(sMin), Math.abs(sMax)) + 1.3;
      var R = clamp(half / tanHh * mR, 5.4, 10.5 * mR), fv = tight;
      if (half / tanHh > 10.5) fv = Math.min(42, 2 * Math.atan(half / 10.5 / Math.max(1.1, aspect())) / DEG);
      // dentro de la zona libre (sin meterse en vallas ni gradas)
      var lim = R;
      if (ux > 1e-3) lim = Math.min(lim, (14.2 - cx) / ux); else if (ux < -1e-3) lim = Math.min(lim, (-14.2 - cx) / ux);
      if (uy > 1e-3) lim = Math.min(lim, (8.6 - cy) / uy); else if (uy < -1e-3) lim = Math.min(lim, (-8.6 - cy) / uy);
      var sc = 0;
      if (lim < R) { if (lim < 4.4) continue; sc += (R - lim) * 6; if (lim < R * 0.8) fv = Math.min(44, fv * R / lim * 0.9); R = lim; }
      var X = cx + ux * R, Y = cy + uy * R, o, d;
      sc += (R - 5.4) * 1.5;
      // cada protagonista ENTERO en el cuadro (con la perspectiva real) y a >= 4,3 m del objetivo
      var vx0 = cx - X, vy0 = cy - Y, hLim = Math.atan(Math.tan(fv * DEG / 2) * Math.max(1.1, aspect())) * 0.8;
      for (o = 0; o < 3; o++) {
        var fx = o === 0 ? PF.lx : o === 1 ? (vic ? vic.x : NaN) : (PF.heroIn ? hero.x : NaN);
        var fy = o === 0 ? PF.ly : o === 1 ? (vic ? vic.y : 0) : (PF.heroIn ? hero.y : 0);
        if (fx !== fx) continue;
        var ddx = fx - X, ddy = fy - Y, dd = Math.hypot(ddx, ddy), an = Math.abs(Math.atan2(vx0 * ddy - vy0 * ddx, vx0 * ddx + vy0 * ddy));
        if (o > 0 && dd < 4.3) sc += (4.3 - dd) * 45;
        if (an > hLim) sc += (an - hLim) / DEG * (o === 0 ? 3 : 6);
      }
      for (o = 0; o < OBST.length; o++) { d = Math.hypot(X - OBST[o][0], Y - OBST[o][1]) - OBST[o][2]; if (d < 2.0) sc += (2.0 - d) * 80; }
      for (o = 0; o < 4; o++) { var q = g.players[o]; d = Math.hypot(X - q.x, Y - q.y); if (d < 2.1) sc += (2.1 - d) * 60; }
      // la red entre la cámara y el grupo (cámara baja: la malla taparía todo)
      if ((X > 0) !== (cx > 0) && Math.abs(cx) > 0.3) {
        var tc = X / (X - cx), yc = Y + (cy - Y) * tc;
        if (Math.abs(yc) < 6.2) sc += 300;
      }
      if (Math.abs(X) < 2.4 && Math.abs(Y) < 6.5) sc += (2.4 - Math.abs(X)) * 40;
      // nadie (ni oficiales) delante del grupo
      var vx = cx - X, vy = cy - Y, vl2 = vx * vx + vy * vy;
      for (o = 0; o < 4; o++) {
        var qq = g.players[o]; if (qq === vic || (PF.heroIn && qq === hero)) continue;
        var t = ((qq.x - X) * vx + (qq.y - Y) * vy) / vl2;
        if (t > 0.05 && t < 0.95) { var dp = Math.abs((qq.x - X) * vy - (qq.y - Y) * vx) / Math.sqrt(vl2); if (dp < 0.8) sc += 45 * (0.8 - dp) / 0.8; }
      }
      // el balón (rodando o botando) no puede quedar pegado al objetivo
      if (b.z < 3) { d = Math.hypot(X - b.x - b.vx * 0.6, Y - b.y - b.vy * 0.6); if (d < 3.2) sc += (3.2 - d) * 60; }
      // obstáculos cerca del objetivo DENTRO del cuadro (un poste o un oficial enorme en primer plano; con FOV 32°, a 6 m ya pesa)
      var hh = Math.atan(tanHh) + 4 * DEG, vlen = Math.sqrt(vl2);
      for (o = 0; o < OBST.length; o++) {
        var ox2 = OBST[o][0] - X, oy2 = OBST[o][1] - Y, od = Math.hypot(ox2, oy2);
        if (od < 7 && Math.abs(Math.atan2(vx * oy2 - vy * ox2, vx * ox2 + vy * oy2)) < hh) sc += 40 * (7 - od) / 7;
      }
      if (b.z < 3.5) {   // el balón suelto (botando) enorme en un lado del cuadro
        var bx3 = b.x - X, by3 = b.y - Y, bd3 = Math.hypot(bx3, by3);
        if (bd3 < 7 && Math.abs(Math.atan2(vx * by3 - vy * bx3, vx * bx3 + vy * by3)) < hh) sc += 40 * (7 - bd3) / 7;
      }
      for (o = 0; o < 4; o++) {   // ídem con los jugadores que no son del grupo (cortados y enormes en un lado)
        var pq = g.players[o]; if (pq === vic || (PF.heroIn && pq === hero)) continue;
        var px2 = pq.x - X, py2 = pq.y - Y, pd = Math.hypot(px2, py2);
        if (pd < 5 && Math.abs(Math.atan2(vx * py2 - vy * px2, vx * px2 + vy * py2)) < hh) sc += 35 * (5 - pd) / 5;
      }
      for (o = 0; o < OBST.length; o++) {
        var tt = ((OBST[o][0] - X) * vx + (OBST[o][1] - Y) * vy) / vl2;
        if (tt > 0.02 && tt < 1.1) { var dq = Math.abs((OBST[o][0] - X) * vy - (OBST[o][1] - Y) * vx) / Math.sqrt(vl2) - OBST[o][2]; if (dq < 0.6) sc += 50 * (0.6 - dq) / 0.6; }
      }
      // el que ganó el punto, al fondo (en un ace, el sacador al otro lado de la red); si no hay, la red al fondo
      var hx = hero ? hero.x - cx : -cx, hy = hero ? hero.y - cy : -cy * 0.3, hl = Math.hypot(hx, hy) || 1;
      sc -= 14 * ((-ux) * hx + (-uy) * hy) / hl;
      // continuidad: si la cámara ya está en este campo y cerca, mejor llegar deslizando que cortar
      if ((X > 0) === (P.x > 0) && Math.hypot(X - P.x, Y - P.y) < 8) sc -= 8;
      if (sc < best) { best = sc; bAng = th; bR = R; bFov = fv; }
    }
    PF.ang = bAng; PF.R = bR; PF.fov = bFov; PF.z = 1.65 + 0.04 * (bR - 5.4);
    // deriva lenta hacia el centro de la pista
    var cX = cx + Math.cos(bAng) * bR, cY = cy + Math.sin(bAng) * bR;
    PF.dir = ((cX - cx) * (0 - cy) - (cY - cy) * (0 - cx)) >= 0 ? 1 : -1;
    var same = (cX > 0) === (P.x > 0) || Math.abs(P.x) < 1;
    PF.cut = !(same && Math.hypot(cX - P.x, cY - P.y) < 9);
    PF.cutDone = !PF.cut; PF.cutNow = false;
  }

  /** Entre puntos: espera breve, corte (o deslizamiento) al plano de reacción y deriva lenta. */
  function pointShot(g, dt) {
    pointT += dt;
    if (!PF.cutDone) {
      if (pointT < PF.hold) {
        // la cámara de juego se queda y mira (suave) hacia donde cayó el balón
        D.x = P.x; D.y = P.y; D.z = P.z;
        A.x = L.x + (PF.lx - L.x) * 0.35; A.y = L.y + (PF.ly - L.y) * 0.35; A.z = L.z + (0.8 - L.z) * 0.35;
        fovWant = fovCur;
        return;
      }
      PF.cutDone = true; PF.cutNow = true; pointT = PF.hold;
    }
    var tc = Math.max(0, pointT - (PF.cut ? PF.hold : 0));
    groupCenter(GC);
    var kk = dt > 0 ? Math.min(1, dt * 2.2) : 1;
    PF.cx += (GC.x - PF.cx) * kk; PF.cy += (GC.y - PF.cy) * kk;
    var ka = smooth01(tc / 3.5), ang = PF.ang + PF.dir * 0.12 * ka, R = PF.R * (1 - 0.06 * ease(tc / 3));
    D.x = PF.c0x + Math.cos(ang) * R; D.y = PF.c0y + Math.sin(ang) * R; D.z = PF.z + 0.12 * ka;
    // jugadores que se acercan (celebraciones, vuelta a su sitio) y obstáculos: la cámara se aparta
    for (var i = 0; i < 4; i++) {
      var q = g.players[i], ex = D.x - q.x, ey = D.y - q.y, el = Math.hypot(ex, ey);
      if (el < 1.9) { var s = (1.9 - el) / Math.max(0.25, el); D.x += ex * s; D.y += ey * s; }
    }
    var bb = g.ball;
    if (bb.z < 3) { var bx2 = D.x - bb.x, by2 = D.y - bb.y, bl = Math.hypot(bx2, by2); if (bl < 3.4) { var sb2 = (3.4 - bl) / Math.max(0.25, bl); D.x += bx2 * sb2; D.y += by2 * sb2; } }
    for (var o = 0; o < OBST.length; o++) {
      var ox = D.x - OBST[o][0], oy = D.y - OBST[o][1], ol = Math.hypot(ox, oy), need = OBST[o][2] + 1.8;
      if (ol < need) { var so = (need - ol) / Math.max(0.2, ol); D.x += ox * so; D.y += oy * so; }
    }
    D.x = clamp(D.x, -14.3, 14.3); D.y = clamp(D.y, -8.7, 8.7);
    // mira: el centro del grupo, con su altura media (0,9 m) a -0,26 NDC (el centro del cuadro es del rótulo del punto)
    fovWant = fovFor(PF.fov, 24, 28);
    var hd = Math.max(1, Math.hypot(PF.cx - D.x, PF.cy - D.y)), th = Math.tan(fovWant * DEG / 2);
    var pitch = Math.atan2(0.9 - D.z, hd) + Math.atan(0.26 * th);
    // marcador colgado (abajo a 9,6 m, sobre el centro): ni a medias. El borde superior, 2° por debajo
    var sbD = Math.max(1, Math.hypot(D.x, D.y)), sbA = Math.atan2(9.6 - D.z, sbD);
    // la víctima entera: sus pies no por debajo de -0,9 NDC (si está cerca, la mira baja)
    if (PF.vic) {
      var vd = (PF.vic.x - D.x) * (PF.cx - D.x) / hd + (PF.vic.y - D.y) * (PF.cy - D.y) / hd;
      if (vd > 1) pitch = Math.min(pitch, Math.atan2(-D.z, vd) + Math.atan(0.9 * th));
    }
    var top = pitch + Math.atan(th);
    if (top > sbA - 2 * DEG) pitch -= top - (sbA - 2 * DEG);
    A.x = PF.cx; A.y = PF.cy; A.z = D.z + Math.tan(pitch) * hd;
  }

  /** Fin de partido: órbita lenta alrededor de los ganadores, en su campo, con el FOV ajustado a los dos. */
  var overSep = 2;
  function overShot(g, dt) {
    overT += dt;
    var w = g.sets[0] >= g.sets[1] ? 0 : 1, t = g.teams[w], sd = w === 0 ? 1 : -1, a0 = t[0], a1 = t[1];
    var tx = (a0.x + a1.x) / 2, ty = (a0.y + a1.y) / 2, sep = Math.hypot(a0.x - a1.x, a0.y - a1.y);
    var kk = dt > 0 ? Math.min(1, dt * 2) : 1;
    overC.x += (tx - overC.x) * kk; overC.y += (ty - overC.y) * kk; overSep += (sep - overSep) * kk;
    // radio según la separación de los ganadores (si se separan, la cámara se aleja: nada de suelo vacío)
    var R = Math.max(5.6, overSep * 0.75 + 3);
    var a = overA0 + Math.sin(overT * 0.22) * 0.6;
    D.x = overC.x + Math.cos(a) * R; D.y = overC.y + Math.sin(a) * R; D.z = 2.0 + 0.4 * Math.sin(overT * 0.31) + 0.08 * (R - 5.6);
    // siempre en el campo de los ganadores, sin cruzar la red
    if (D.x * sd < 1.2) D.x = sd * 1.2;
    // nunca pegada a uno de ellos (con la red al lado, la órbita podía dejar la cámara a 0,6 m)
    for (var i = 0; i < 2; i++) {
      var q = t[i], ex = D.x - q.x, ey = D.y - q.y, el = Math.hypot(ex, ey);
      if (el < 3.2) { var s = (3.2 - el) / Math.max(0.2, el); D.x += ex * s; D.y += ey * s; if (D.x * sd < 1.2) { D.x = sd * 1.2; D.y += (ey >= 0 ? 1 : -1) * (3.2 - el); } }
    }
    A.x = overC.x; A.y = overC.y; A.z = 1.15;
    // FOV que encuadra a los dos (ancho perpendicular a la mirada + margen) y su altura
    var vx = overC.x - D.x, vy = overC.y - D.y, vl = Math.hypot(vx, vy) || 1;
    var perp = Math.abs(((a0.x - a1.x) * vy - (a0.y - a1.y) * vx) / vl);
    var hHalf = Math.atan((perp / 2 + 1.1) / vl), vHalf = Math.atan(Math.tan(hHalf) / aspect());
    var vNeed = Math.max(vHalf, Math.atan(1.6 / vl)) * 2 / DEG;
    fovWant = clamp(Math.max(fovFor(46), vNeed * 1.08), 40, 72);
  }

  /** Menú / demo: plano de retransmisión, órbita alta y lenta. */
  function menuShot(g, dt) {
    orbit += dt * 0.045;
    var a = orbit;
    // elipse dentro de la zona libre (radio y 9,5: antes 11,5-1,5 llegaba a y=-13, en la grada y encima de la silla
    // del 1.er árbitro, que tapaba el centro de la pista); al pasar por las laterales sube un poco
    var sa = Math.sin(a);
    D.x = Math.cos(a) * 15.5; D.y = sa * 9.5; D.z = 6.6 + Math.sin(a * 1.7) * 0.6 + 1.2 * sa * sa;
    var b = g.ball;
    A.x = clamp(b.x, -9, 9) * 0.22; A.y = clamp(b.y, -5, 5) * 0.18; A.z = 1.0;
    fovWant = fovFor(50);
  }

  function computeDesired(g, dt) {
    var s = shot;
    if (s === 'menu') menuShot(g, dt);
    else if (s === 'point') pointShot(g, dt);
    else if (s === 'over') overShot(g, dt);
    else gameplayShot(g, SHOTS[s] || SHOTS.rally, dt);
  }

  /** Transición de plano: suavizado más largo y con velocidad máxima, que decae a lo normal. */
  function startBlend(dur, smoothT, maxSpeed) { blendDur = blendT = dur; blendSmooth = smoothT; blendMax = maxSpeed; }

  function onShotChange(g, from, to) {
    if (to === 'point') {
      pointT = 0;
      planPoint(g, pointHow || inferHow(g), pointPlayer);
      // si se llega deslizando (mismo campo y cerca): 1,2 s, lento y con el giro limitado a 60°/s
      if (!PF.cut) startBlend(1.2, 0.8, 9); else blendT = 0;
      return;
    }
    // del punto al saque o al final: si el plano nuevo está al otro lado de la red o lejos, corte (ver update)
    if (from === 'point') cutCheck = true;
    if (to === 'over') {
      overT = 0; var w = g.sets[0] >= g.sets[1] ? 0 : 1, t = g.teams[w], sdw = w === 0 ? 1 : -1;
      overC.x = (t[0].x + t[1].x) / 2; overC.y = (t[0].y + t[1].y) / 2;
      overSep = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
      // órbita desde la banda más cercana, inclinada hacia el fondo de los ganadores (lejos de la red)
      var sideY = P.y >= overC.y ? 1 : -1;
      overA0 = Math.atan2(sideY, sdw * 0.55);
      startBlend(1.6, 1.1, 8);
      return;
    }
    if (to === 'menu') { startBlend(1.2, 1.2, 12); return; }
    if (from === 'point' || from === 'over' || from === 'menu' || from === '') { startBlend(1.0, 0.75, 16); return; }
    if (to === 'serveUs' || to === 'serveThem') { startBlend(0.8, 0.6, 16); return; }
    // entre planos de juego: suave pero ágil
    startBlend(0.55, 0.5, 22);
  }

  // ---------------- Encuadre fino (balón y jugador en pantalla) ----------------
  // Restricciones, por prioridad: 1) el balón (por debajo del 10 % superior), 2) el jugador (cadera por
  // encima del 8 % inferior; durante un cambio, el punto que se desliza, no el jugador nuevo: así la
  // cámara no cabecea hacia unos pies que aún están debajo de ella), 3) el punto de juego (aro de
  // Sim.focusPoint) fuera de la franja del HUD (avisos abajo) y, en táctil, fuera de los botones.
  // Si no cabe todo, se abre el FOV en vez de cabecear.
  function touchUI() { return !!(VB.Input && VB.Input.overlayShown && VB.Input.overlayShown()); }
  function framing(g, yaw0, pitch0, dt) {
    var wantP = 0, wantY = 0, wantBoost = 0;
    dbg.ballVisible = true; dbg.focusNdcY = 9;
    if (GAMEPLAY[shot] && g && g.ctrl) {
      var b = g.ball, p = g.ctrl, touch = touchUI();
      var tanH = Math.tan(fovCur * DEG / 2), tanW = tanH * aspect();
      var cy = Math.cos(yaw0), syw = Math.sin(yaw0);
      // sujeto: el jugador controlado o, durante un cambio, el punto que se desliza hacia él
      var sx = p.x, sy = p.y, sz = p.z;
      if (sw.active) { sx = S.x; sy = S.y; sz = S.z; }
      var pfd = (sx - P.x) * cy + (sy - P.y) * syw;
      var prt = (sx - P.x) * syw - (sy - P.y) * cy;
      // balón anticipado ~0,25 s (el suavizado va por detrás; así no se escapa al subir)
      // (en móvil/táctil mira más adelante en la subida: el cabeceo va limitado y la franja de toques es más alta)
      var small = touch || ctx.isMobile;
      var bX = b.x + b.vx * 0.2, bY = b.y + b.vy * 0.2, bZ = b.z + Math.max(0, b.vz) * (small ? 0.4 : 0.28);
      // colocación propia en el aire (remate) o táctil: se encuadra ya la CUMBRE prevista del balón (el FOV y el
      // cabeceo llegan a tiempo en vez de ir detrás de un balón que sube a 6-7 m/s)
      if ((shot === 'attack' || touch) && b.vz > 0.5 && g.mode === 'rally') {
        var Gc = (VB.C && VB.C.G) || 9.81, tUp = Math.min(1.2, b.vz / Gc);
        var apexZ = b.z + b.vz * tUp * 0.5;
        if (apexZ > bZ) { bZ = apexZ; bX = b.x + b.vx * tUp * 0.6; bY = b.y + b.vy * tUp * 0.6; }
      }
      var bfd = (bX - P.x) * cy + (bY - P.y) * syw;
      var brt = (bX - P.x) * syw - (bY - P.y) * cy;
      if (pfd > 0.5) {
        var aF = Math.atan2(sz - P.z, pfd), sc = SHOTS[shot];
        // límite: la cadera del jugador (z+0,95) nunca por debajo del 8 % inferior; los pies pueden salir un instante.
        // Táctil: cadera por encima de -0,55 y pies de -0,9 (los botones y el joystick ocupan el tercio inferior).
        // Saque propio (fit): el punto bajo del ajuste (pecho del sacador), sin límite de pies.
        var aHip, pMax;
        if (sc && sc.fit) { aHip = Math.atan2(sz + fitLow.z - P.z, pfd); pMax = aHip + Math.atan((-fitLow.n + 0.04) * tanH) - pitch0; }
        else {
          aHip = Math.atan2(sz + 0.95 - P.z, pfd);
          var hipN = touch ? (shot === 'attack' ? 0.7 : 0.55) : 0.84;   // (remate en táctil: el rematador va hacia la red, lejos de los botones)
          pMax = Math.min(aHip + Math.atan(hipN * tanH), aF + Math.atan((touch ? 0.9 : 1.25) * tanH)) - pitch0;
        }
        // punto de juego (donde se jugará el próximo toque propio) por encima de la franja de avisos
        var fp = null, hF = 0, fNdcY = 9;
        if (g.mode === 'rally' && VB.Sim && VB.Sim.focusPoint && (b.vx > 0.5 || g.touchTeam === 0)) {
          fp = VB.Sim.focusPoint(g);
          if (fp && fp.x > 0 && fp.x < 10) {
            var ffd = (fp.x - P.x) * cy + (fp.y - P.y) * syw;
            if (ffd > 1.5) {
              var aFo = Math.atan2(-P.z, ffd), yMin = touch ? -0.5 : -0.56;
              // como mucho 9° más de picado por esto (un bote justo delante de la cámara no la tumba)
              pMax = Math.min(pMax, Math.max(-9 * DEG, aFo - Math.atan(yMin * tanH) - pitch0));
              hF = Math.atan2((fp.x - P.x) * syw - (fp.y - P.y) * cy, ffd);
              fNdcY = Math.tan(aFo - (pitch0 + exPitch)) / tanH;
              dbg.focusNdcY = fNdcY;
            } else fp = null;
          } else fp = null;
        }
        if (bfd > 0.8) {
          var aB = Math.atan2(bZ - P.z, bfd);
          // balón por debajo del 10 % superior (móvil: 13 %, la franja de toques del HUD es proporcionalmente más alta)
          // táctil: centro del balón por debajo de 0,62 NDC (la franja de toques acaba a ~0,83 NDC a 390 px de alto;
          // se resta el radio del balón y el retraso del cabeceo limitado)
          var need = aB - Math.atan((touch ? 0.62 : ctx.isMobile ? 0.70 : 0.80) * tanH) - pitch0;
          // en la red / defensa, el balón alto en campo rival pesa menos en el cabeceo (el resto, FOV):
          // un colocador rival a 6 m de altura no debe llenar el cuadro de grada
          var bw = 1 - 0.6 * netK;
          if (shot === 'defend' && b.x < 0) bw = Math.min(bw, 0.55);
          var lo = need > 0 ? need * bw : need;
          wantP = clamp(0, lo, Math.max(lo, pMax));
          if (lo > pMax) wantP = pMax;                          // el jugador manda sobre el balón
          // lo que el cabeceo no da (por el límite del jugador o por el límite de velocidad angular, que va
          // por detrás), lo da el FOV. Tope 10° (16° en el remate y en táctil: mejor abrir que perder el balón)
          var lagP = Math.max(0, lagPitch);
          var bCap = (shot === 'attack' || touch) ? 16 : 10;
          if (need > wantP - lagP) wantBoost = clamp((need - wantP + lagP) / DEG * 1.6, 0, bCap);
          // horizontal: sesgo suave hacia el balón, sin sacar al jugador del cuadro
          var hB = Math.atan2(brt, bfd), hP = Math.atan2(prt, pfd);
          var mB = Math.atan(0.82 * tanW), mP = Math.atan(0.62 * tanW);
          var d = -0.16 * hB;
          // táctil: el aro y los pies, fuera del grupo de botones (abajo a la derecha) y del joystick (abajo a la izquierda);
          // y si colocas tú, también el compañero (el rematador al que vas a colocar)
          if (touch) {
            var xMax = Math.atan(0.38 * tanW), xMin = -Math.atan(0.5 * tanW), pNdc = Math.tan(aF - (pitch0 + exPitch)) / tanH;
            if (fp && fNdcY < -0.3) d = Math.min(d, xMax - hF);
            if (pNdc < -0.3) { d = Math.min(d, xMax - hP); d = Math.max(d, xMin - hP); }
            if (g.touchTeam === 0 && g.touches === 1 && g.mode === 'rally') {
              var mt = mateOf(g), mfd = (mt.x - P.x) * cy + (mt.y - P.y) * syw;
              if (mfd > 1) {
                var hM = Math.atan2((mt.x - P.x) * syw - (mt.y - P.y) * cy, mfd);
                var mNdc = Math.tan(Math.atan2(mt.z + 1.2 - P.z, mfd) - (pitch0 + exPitch)) / tanH;
                if (mNdc < -0.25) {
                  var dM = Math.max(Math.min(d, xMax - hM), xMin - hM);
                  // si el compañero y el jugador no caben a la vez fuera de los botones, se abre un poco el FOV
                  if (Math.abs(dM - d) > 0.02 && ((dM < d && pNdc < -0.3 && dM < xMin - hP) || (dM > d && pNdc < -0.3 && dM > xMax - hP))) wantBoost = Math.max(wantBoost, 5);
                  else d = dM;
                }
              }
            }
          }
          d = clamp(d, -mB - hB, mB - hB);
          d = clamp(d, -mP - hP, mP - hP);
          wantY = clamp(d, -0.32, 0.32);
          // diagnóstico
          var rfd = (b.x - P.x) * cy + (b.y - P.y) * syw, rrt = (b.x - P.x) * syw - (b.y - P.y) * cy;
          var ay = Math.tan(Math.atan2(b.z - P.z, rfd) - (pitch0 + exPitch)) / tanH, ax = Math.tan(Math.atan2(rrt, rfd) + exYaw) / tanW;
          if (rfd < 0.3) { ay = 0; ax = 0; }
          dbg.ballNdcY = ay; dbg.ballNdcX = ax; dbg.ballVisible = Math.abs(ay) <= 1 && Math.abs(ax) <= 1;
        }
        else wantP = Math.min(0, pMax);
        // cambio de jugador: si el jugador NUEVO aún está fuera por abajo, se abre el FOV (no se cabecea)
        var rfdC = (p.x - P.x) * cy + (p.y - P.y) * syw, cNdc = rfdC > 0.3 ? Math.tan(Math.atan2(p.z + 0.95 - P.z, rfdC) - (pitch0 + exPitch)) / tanH : -3;
        if (sw.active && cNdc < -0.9) wantBoost = Math.max(wantBoost, clamp((-0.9 - cNdc) * 8, 0, 9));
        dbg.ctrlNdcY = rfdC > 0.3 ? Math.tan(Math.atan2(p.z - P.z, rfdC) - (pitch0 + exPitch)) / tanH : -9; dbg.pfd = pfd;
      }
    }
    if (dt > 0) {
      exPitch = sd1(exPitch, wantP, exVel, 0, 0.30, dt);
      exYaw = sd1(exYaw, wantY, exVel, 1, 0.36, dt);
      // (abrir, deprisa: el balón sube; cerrar, despacio)
      fovBoost = sd1(fovBoost, wantBoost, fovBoostVel, 0, wantBoost > fovBoost ? 0.2 : 0.45, dt);
    }
  }

  // ---------------- Aplicar a la cámara de Three.js ----------------
  function apply(dt, g) {
    // límites físicos: dentro del pabellón, sin atravesar la red ni las gradas
    var lowArea = P.z < 5.5;
    if (lowArea) { P.x = clamp(P.x, -15, 15); P.y = clamp(P.y, -9.7, 9.7); }
    if (P.z < 0.7) P.z = 0.7;
    if (Math.abs(P.x) < 0.9 && Math.abs(P.y) < 6 && P.z < 2.95) P.z = 2.95;

    var dx = L.x - P.x, dy = L.y - P.y, dz = L.z - P.z, hd = Math.hypot(dx, dy) || 1e-4;
    var yaw0 = Math.atan2(dy, dx), pitch0 = Math.atan2(dz, hd);
    framing(g, yaw0, pitch0, dt);

    // FOV (con aspecto, ayuda de encuadre y punch)
    var fv = fovWant + fovBoost - kick;
    if (dt > 0) { fovCur = sd1(fovCur, fv, fovVel, 0, fovBoost > 2 && fv > fovCur ? 0.2 : 0.35, dt); kick = Math.max(0, kick - dt * 14); }
    else fovCur = fv;
    // desplazamiento de imagen en el menú (la pista a la derecha del panel)
    var filmWant = 0;
    if (ctx.state === 'menu' && ctx.width > 760) {
      var th = Math.tan(fovCur * DEG / 2);
      filmWant = -2 * 0.13 * th * aspect() * 35;
    }
    film = dt > 0 ? sd1(film, filmWant, filmVel, 0, 0.5, dt) : filmWant;
    if (Math.abs(cam.fov - fovCur) > 0.01 || Math.abs(cam.filmOffset - film) > 0.005) {
      cam.fov = fovCur; cam.filmOffset = film; cam.updateProjectionMatrix();
    }

    var yaw = yaw0 + exYaw, pitch = pitch0 + exPitch;
    // límite de velocidad angular en TODOS los planos: juego (cabeceo 40°/s, giro 70°/s; saque rival 50°/s),
    // punto/fin 60°/s, menú 25°/s; confort: 30°/s (menú 20). Ninguna transición "barre" el suelo ni hace un
    // latigazo. El FOV de ayuda del encuadre compensa el retraso (lagPitch). Un corte de plano (point) reinicia.
    if (dt > 0 && outInit) {
      var calm = comfort(), lp = 40, ly = 70;
      if (shot === 'serveThem') ly = 50;
      else if (shot === 'serveUs' && blendT > 0) ly = 55;   // vuelta deslizada desde el plano del punto
      else if (shot === 'point' || shot === 'over') lp = ly = 60;
      else if (shot === 'menu' || shot === '') lp = ly = 25;
      if (calm) { lp = Math.min(lp, 30); ly = Math.min(ly, shot === 'menu' ? 20 : 30); }
      // al ARRANCAR un plano (las transiciones), el límite sube suave desde la mitad: sin tirón inicial
      var ramp = blendT > 0 && blendDur > 0 ? 0.5 + 0.5 * smooth01(1 - blendT / blendDur + 0.35) : 1;
      var rp = lp * ramp * DEG * dt, ry = ly * ramp * DEG * dt;
      outPitch += clamp(pitch - outPitch, -rp, rp);
      outYaw = wrap(outYaw + clamp(wrap(yaw - outYaw), -ry, ry));
      lagPitch = pitch - outPitch;
      pitch = outPitch; yaw = outYaw;
    } else { outPitch = pitch; outYaw = yaw; outInit = true; lagPitch = 0; }
    // temblor: ruido suave (suma de senos), decae al cuadrado
    var ox = 0, oy = 0, oz = 0, roll = 0;
    if (shakeT > 0) {
      if (dt > 0) shakeT = Math.max(0, shakeT - dt);
      var k = shakeA * Math.pow(shakeT / shakeDur, 2) * (comfort() ? 0.3 : 1), t = timeAcc;
      ox = k * (Math.sin(t * 47.0) * 0.6 + Math.sin(t * 83.0 + 1.3) * 0.4);
      oy = k * (Math.sin(t * 53.0 + 2.1) * 0.6 + Math.sin(t * 71.0 + 0.4) * 0.4);
      oz = k * (Math.sin(t * 61.0 + 4.2) * 0.6 + Math.sin(t * 97.0 + 2.7) * 0.4);
      roll = shakeRoll * k * Math.sin(t * 39.0 + 0.8);
      if (shakeT <= 0) shakeA = 0;
    }
    VB.toThree(P.x + ox, P.y + oy, P.z + oz, cam.position);
    var cp = Math.cos(pitch);
    VB.toThree(P.x + ox + Math.cos(yaw) * cp * 10, P.y + oy + Math.sin(yaw) * cp * 10, P.z + oz + Math.sin(pitch) * 10, tgt3);
    cam.up.set(0, 1, 0);
    cam.lookAt(tgt3);
    if (roll !== 0) cam.rotateZ(roll);

    // base de control: solo en planos de juego, limitada a ±26° de "hacia la red"
    if (GAMEPLAY[shot]) {
      basisYaw = Math.PI + clamp(wrap(yaw0 - Math.PI), -26 * DEG, 26 * DEG);
      basis.fx = Math.cos(basisYaw); basis.fy = Math.sin(basisYaw);
      basis.rx = basis.fy; basis.ry = -basis.fx;   // derecha de pantalla en el suelo
    }
    dbg.antX = ant.x; dbg.sx = S.x;
    dbg.shot = shot; dbg.netK = netK; dbg.yaw = yaw; dbg.pitch = pitch; dbg.fov = fovCur;
  }

  var outPitch = 0, outYaw = 0, outInit = false, lagPitch = 0;
  function resetVel() { outInit = false;  PV.x = PV.y = PV.z = LV.x = LV.y = LV.z = 0; exVel[0] = exVel[1] = 0; fovVel[0] = 0; fovBoostVel[0] = 0; filmVel[0] = 0; }

  VB.CameraRig = {
    init: function (c) {
      ctx = c; THREE = c.THREE; cam = c.camera; tgt3 = new THREE.Vector3();
      cam.near = 0.12; cam.far = 220; cam.fov = fovCur; cam.updateProjectionMatrix();
      try { reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { }
    },
    onGameStart: function (g) {
      slow.t = 0; if (ctx) ctx.timeScale = 1;
      sw.active = false; shakeT = 0; shakeA = 0; kick = 0; ant.x = ant.y = antV.x = antV.y = 0;
      if (!g) return;
      // del menú (o de una partida anterior) a un partido nuevo: transición larga y suave
      if (!g.demo && P.z > 0) { shot = ''; return; }
      this.snap(g);
    },
    onState: function (s, prev) {
      if (s === 'menu') { slow.t = 0; ctx.timeScale = 1; }
    },
    /** Coloca la cámara de golpe en su sitio (escenas de depuración, menú). */
    snap: function (g) {
      if (!g || !ctx) return;
      S.x = g.ctrl ? g.ctrl.x : 0; S.y = g.ctrl ? g.ctrl.y : 0; S.z = 0;
      shot = pickShot(g); prevShot = shot; blendT = 0; sw.active = false; swFast = 0;
      if (g.ctrl) updateAnticipation(g, 0); else ant.x = ant.y = 0;
      if (shot === 'point') { P.x = g.ctrl.x + 5.5; P.y = g.ctrl.y * 0.78; P.z = 3.2; pointHow = ''; pointPlayer = null; onShotChange(g, '', 'point'); blendT = 0; PF.cutDone = true; PF.cutNow = false; pointT = 1.2 + (PF.cut ? PF.hold : 0); }  // escena congelada: el plano ya asentado
      if (shot === 'over') { P.x = 10; P.y = 0; P.z = 3; onShotChange(g, '', 'over'); blendT = 0; }
      subject(g, 0);
      computeDesired(g, 0);
      P.x = D.x; P.y = D.y; P.z = D.z; L.x = A.x; L.y = A.y; L.z = A.z;
      fovCur = fovWant; exPitch = exYaw = fovBoost = 0; resetVel();
      // dos pasadas de encuadre para que el balón ya esté colocado
      for (var i = 0; i < 30; i++) framing(g, Math.atan2(L.y - P.y, L.x - P.x), Math.atan2(L.z - P.z, Math.hypot(L.x - P.x, L.y - P.y)), 1 / 30);
      apply(0, g);
    },
    /** Temblor: amplitud en metros (0,03-0,15) y duración en s. */
    shake: function (amount, dur) {
      amount = +amount || 0; if (amount <= 0) return;
      if (amount >= shakeA * Math.pow(shakeT / (shakeDur || 1), 2)) { shakeA = amount; shakeDur = Math.max(0.05, dur || 0.3); shakeT = shakeDur; shakeRoll = 0.35; }
    },
    /** Cámara lenta: escala `scale` durante `realSeconds` reales; vuelve a 1 con suavidad en `easeOut` s (opcional). */
    slowmo: function (scale, realSeconds, easeOut) {
      scale = clamp(+scale || 1, 0.05, 1);
      if (slow.t > 0 && slow.scale < scale && slow.t > slow.out) return; // no pisar una más intensa en curso
      slow.scale = scale; slow.total = slow.t = Math.max(0.01, +realSeconds || 0.5);
      slow.out = easeOut != null ? clamp(easeOut, 0, slow.t) : Math.min(0.4, slow.t * 0.5);
      if (ctx) ctx.timeScale = scale;
    },
    /** OPCIONAL: punch de FOV (grados) — p. ej. en un remate propio. */
    kick: function (deg) { if (!comfort()) kick = Math.max(kick, deg || 2.5); },
    /** Ejes de la cámara de juego en el plano del suelo (coordenadas de simulación). */
    getBasis: function () { return basis; },
    /** OPCIONAL (depuración / tests): plano actual y datos de encuadre. */
    getDebug: function () { dbg.pf = shot === 'point' ? { lx: PF.lx, ly: PF.ly, c0x: PF.c0x, c0y: PF.c0y, R: PF.R, ang: PF.ang, fov: PF.fov, cut: PF.cut, vic: PF.vic && PF.vic.num, hero: PF.hero && PF.hero.num, heroIn: PF.heroIn } : null; return dbg; },
    getShot: function () { return shot; },
    /** OPCIONAL (pruebas): fija el ángulo de la órbita del menú. */
    _setOrbit: function (a) { orbit = +a || 0; },
    resize: function () { },
    setQuality: function () { },
    onSettings: function () { },
    update: function (g, realDt, events) {
      if (!g || !cam) return;
      var dt = Math.max(0, Math.min(0.1, realDt || 0));
      timeAcc += dt;
      var playing = ctx.state === 'playing' && !g.demo;
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.type === 'land') { landOk = true; landX = e.x; landY = e.y; }
        else if (e.type === 'serveReady' || e.type === 'newMatch' || e.type === 'toss') landOk = false;
        if (e.type === 'switch') {
          if (!e.reset && e.from && e.to) {
            // deslizar el sujeto desde donde está ahora hasta el nuevo jugador
            // (incluida la anticipación ya recorrida, que pasa a formar parte del deslizamiento)
            sw.from.x = S.x; sw.from.y = S.y; sw.from.z = S.z; sw.to = e.to; sw.t = 0;
            ant.x = ant.y = antV.x = antV.y = 0;
            var dist = Math.hypot(e.to.x - S.x, e.to.y - S.y);
            sw.dur = clamp(0.35 + dist * 0.035, 0.35, 0.6); sw.active = true; sw.back = e.to.x > S.x + 1;
            // cambio al defensor al colocar la CPU (~1,5 s antes del remate): hay tiempo, deslizamiento más largo y suave
            if (e.reason === 'defense') sw.dur = clamp(0.55 + dist * 0.04, 0.6, 0.85);
            swFast = sw.back ? 0.9 : 0;
          } else sw.active = false;
        } else if (e.type === 'hit' && e.kind === 'spike') {
          // remate: temblor escalado por la potencia (e.power 0..1) y la calidad (perfect > good > poor).
          // La dejada llega como kind 'free' (shot 'tip'): no entra aquí, sin temblor.
          var mine = e.team === 0, pw = hitPower(e), gm = gradeMul(e.grade);
          var amp = (mine ? 0.07 : 0.11) * (0.5 + 0.7 * pw) * gm;
          this.shake(amp, (mine ? 0.22 : 0.26) + 0.08 * pw);
          if (mine && playing && !g.autopilot) {
            this.kick(2.6 * (0.6 + 0.55 * pw) * gm);
            if (e.human && !comfort()) this.slowmo(0.3, e.grade === 'perfect' ? 0.12 : 0.09, 0.06); // hit-stop
          }
          if (e.human && VB.Input && VB.Input.rumble) VB.Input.rumble(Math.min(1, 0.55 + 0.45 * pw * gm), 70 + Math.round(40 * pw));
        } else if (e.type === 'hit' && e.kind === 'serve' && e.shot === 'jump') {
          // saque en salto: un golpe seco, más suave que un remate
          var pj = hitPower(e);
          this.shake((e.team === 0 ? 0.035 : 0.05) * (0.6 + 0.6 * pj) * gradeMul(e.grade), 0.2);
          if (e.human && VB.Input && VB.Input.rumble) VB.Input.rumble(0.5 + 0.4 * pj, 60);
        } else if (e.type === 'hit' && e.human) {
          if (VB.Input && VB.Input.rumble) VB.Input.rumble(e.kind === 'serve' ? 0.6 : 0.35, 45);
        } else if (e.type === 'block') {
          // bloqueo directo (stuff) pesa; toque de bloqueo / block-out, suave
          var stuff = e.result === 'stuff' || e.result == null;
          this.shake(stuff ? 0.1 : 0.045, stuff ? 0.3 : 0.2);
          if (e.team === 0 && playing) {
            if (stuff) this.kick(2.2);
            if (e.human && VB.Input && VB.Input.rumble) VB.Input.rumble(stuff ? 0.85 : 0.45, stuff ? 85 : 50);
          }
        } else if (e.type === 'dive') {
          // plancha: golpe sordo contra el suelo (pequeño; más si es el jugador que llevas)
          var meD = e.player && e.player === g.ctrl && !g.autopilot && !g.demo;
          this.shake(meD ? 0.04 : 0.02, 0.2);
          if (meD && VB.Input && VB.Input.rumble) VB.Input.rumble(0.5, 60);
        } else if (e.type === 'net' && !e.tape) {
          this.shake(0.025, 0.18);
        } else if (e.type === 'point' && !g.demo) {
          pointHow = e.how || ''; pointPlayer = e.player || null;
          if (e.matchWon) this.slowmo(0.28, 1.9, 0.6);
          else if (e.setWon) this.slowmo(0.5, 0.8, 0.4);
        }
      }
      // cámara lenta (solo cuenta el tiempo si el juego corre) con vuelta suave a 1
      if (slow.t > 0 && dt > 0 && ctx.state !== 'paused') {
        slow.t -= dt;
        if (slow.t <= 0) ctx.timeScale = 1;
        else if (slow.t < slow.out) ctx.timeScale = 1 - (1 - slow.scale) * smooth01(slow.t / slow.out);
        else ctx.timeScale = slow.scale;
      }

      // plano
      var ns = pickShot(g);
      if (ns !== shot) { onShotChange(g, shot, ns); prevShot = shot; shot = ns; }
      if (g.ctrl) { updateAnticipation(g, dt); subject(g, dt); updateLead(g, dt); }
      computeDesired(g, dt);
      // CORTE de plano (reacción al punto, o vuelta desde ella al otro lado de la red): sin barrido
      if (PF.cutNow || cutCheck) {
        var doCut = PF.cutNow;
        if (cutCheck) doCut = ((P.x > 0) !== (D.x > 0) && Math.abs(P.x) > 0.8 && Math.abs(D.x) > 0.8) || Math.hypot(P.x - D.x, P.y - D.y) > 11;
        PF.cutNow = false; cutCheck = false;
        if (doCut) {
          P.x = D.x; P.y = D.y; P.z = D.z; L.x = A.x; L.y = A.y; L.z = A.z; fovCur = fovWant;
          exPitch = exYaw = fovBoost = 0; sw.active = false; blendT = 0; resetVel();
        }
      }

      var c = SHOTS[shot], baseSmooth = c ? c.smooth : (shot === 'menu' ? 1.0 : shot === 'over' ? 0.9 : 0.6);
      // ajuste del jugador (Ajustes > cámara): 0,5 lenta … 1,5 rápida
      if (c) { var sens = clamp(+(ctx.settings && ctx.settings.camSens) || 1, 0.5, 1.5); baseSmooth /= sens; }
      if (c && comfort()) baseSmooth *= 1.6;
      var smoothT = baseSmooth, maxSpeed = 40;
      if (blendT > 0) {
        var f = blendT / blendDur;               // 1 al empezar, 0 al acabar
        smoothT = baseSmooth + (blendSmooth - baseSmooth) * f;
        maxSpeed = blendMax + (40 - blendMax) * (1 - f);
        blendT = Math.max(0, blendT - dt);
      }
      // cambio hacia un jugador que está por detrás (p. ej. del bloqueador al defensor): la cámara
      // RETROCEDE deprisa (un travelling hacia atrás es cómodo) en vez de cabecear hacia el suelo
      if (swFast > 0 && c) {
        var kf = smooth01(swFast / 0.9);
        smoothT = Math.min(smoothT, smoothT + ((comfort() ? 0.34 : 0.2) - smoothT) * kf);
        maxSpeed = Math.max(maxSpeed, 30 * kf);
        swFast = Math.max(0, swFast - dt);
      }
      if (dt > 0) {
        sdv(P, D, PV, smoothT, dt, maxSpeed);
        sdv(L, A, LV, smoothT * 0.75, dt, maxSpeed * 1.4);
      }
      apply(dt, g);
    }
  };
})();
