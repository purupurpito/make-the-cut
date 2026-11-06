/* =====================================================================
 * VOLEY 3D — js/camera.js   (owner: camera_input)
 *
 * Rig de cámara en tercera persona por "planos" (shots):
 *   menu       retransmisión: órbita alta y lenta (desplazada a la derecha
 *              para no quedar bajo el menú)
 *   serveUs    detrás del sacador humano, sobre su hombro derecho
 *   serveThem  detrás de nuestro receptor, algo más alta, para ver al sacador
 *   rally      detrás y por encima del jugador controlado, mirando a la red
 *   attack     nuestro 3er toque / remate: más baja y cerca (ángulo dramático)
 *   defend     el rival construye su ataque: se abre un poco para leerlo
 *   point      entre puntos: paneo lento hacia donde cayó el balón
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
  var sw = { active: false, t: 0, dur: 0.45, from: V(), to: null, back: false };
  var pointT = 0, point0 = V(), pointFocus = V(), pointDir = 1, pointLift = 1.1, pointWin = 0;
  var overT = 0, overA0 = 0, overC = V();
  var orbit = 0.6, timeAcc = 0;
  var basis = { fx: -1, fy: 0, rx: 0, ry: 1 }, basisYaw = Math.PI;
  var shakeA = 0, shakeT = 0, shakeDur = 0.3, shakeRoll = 0;
  var kick = 0;                    // punch de FOV (grados, decae)
  var slow = { t: 0, scale: 1, out: 0.4, total: 0 };
  var reduceMotion = false;
  var dbg = { shot: '', yaw: 0, pitch: 0, fov: 0, ballNdcX: 0, ballNdcY: 0, ctrlNdcY: 0, ballVisible: true };

  // ---------------- Planos de juego (ajustados mirando capturas) ----------------
  // back: distancia detrás del sujeto (m) · h: altura de cámara · fov vertical (16:9)
  // k: dónde quedan los pies (NDC, negativo = abajo) · lat: cuánto sigue la cámara la y del jugador
  // off: desplazamiento lateral (m, + = derecha de pantalla) · aimX: a qué distancia mira hacia la red
  // aimLat: fracción de la y del jugador en el punto de mira · ball: sesgo del punto de mira hacia el balón
  var SHOTS = {
    rally:     { back: 6.0, h: 4.0,  fov: 54, k: -0.52, both: 2.6, lat: 0.78, off: 0,    aimX: 8.5, aimLat: 0.30, ball: 0.25, smooth: 0.30, zf: 0.40 },
    defend:    { back: 6.5, h: 4.3,  fov: 55, k: -0.56, both: 3.0, lat: 0.72, off: 0,    aimX: 9.5, aimLat: 0.25, ball: 0.30, smooth: 0.34, zf: 0.40 },
    attack:    { back: 4.9, h: 2.8,  fov: 52, k: -0.50, rise: 3.0, lat: 0.85, off: 0.35, aimX: 7.0, aimLat: 0.45, ball: 0.20, smooth: 0.26, zf: 0.70 },
    serveUs:   { back: 4.4, h: 2.85, fov: 50, k: -0.70, lat: 1.00, off: 0.95, aimX: 16,  aimLat: 0.25, ball: 0,    smooth: 0.28, zf: 0.40 },
    serveThem: { back: 6.0, h: 4.1,  fov: 54, k: -0.52, lat: 0.55, off: 0,    aimX: 15,  aimLat: 0.10, ball: 0.15, smooth: 0.32, zf: 0.40 }
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
  function fovFor(base) {
    var a = aspect();
    var vMin = 2 * Math.atan(Math.tan(37 * DEG) / a) / DEG;  // al menos ~74° de horizontal
    var vMax = 2 * Math.atan(Math.tan(46 * DEG) / a) / DEG;  // como mucho ~92° de horizontal
    return clamp(clamp(base, vMin, vMax), 40, 80);
  }
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
      if (to === p) return;
    }
    S.x = p.x; S.y = p.y; S.z = p.z;
  }
  /** Anticipación: la cámara se adelanta un poco a la carrera del jugador (compensa el retraso del suavizado). */
  var lead = V(), leadV = V(), leadT = V();
  function updateLead(g, dt) {
    var p = g.ctrl, k = (g.mode === 'rally' && p) ? 0.24 : 0;
    leadT.x = k ? clamp(p.vx, -7, 7) * k : 0; leadT.y = k ? clamp(p.vy, -7, 7) * k * 0.7 : 0; leadT.z = 0;
    if (dt > 0) sdv(lead, leadT, leadV, 0.25, dt, 20);
  }

  /** Plano de juego genérico: detrás del sujeto, mirando hacia la red. */
  var occl = 0;
  function gameplayShot(g, c, dt) {
    var b = g.ball, ahead = b.x < S.x + c.back - 1.2;   // balón por delante de la cámara
    var back = c.back, h = c.h;
    if (c.rise && ahead) {
      // balón alto (colocación en el aire): la cámara se abre para no perderlo y se cierra al bajar
      var hi = smooth01((b.z - 3.0) / 2.6);
      back += c.rise * hi; h += 0.25 * hi;
    }
    if (ctx.isMobile) { back *= 0.94; }
    // posición: detrás (+x, equipo humano en x>0), algo hacia el centro en y
    var dx = S.x + back + lead.x, over = 0;
    // la cámara se queda por detrás de LOS DOS jugadores propios: así, al pasar el control al
    // compañero (p. ej. del bloqueador al defensor), el nuevo nunca queda debajo de la cámara
    if (c.both && g.ctrl) {
      var mate = g.teams[0][0] === g.ctrl ? g.teams[0][1] : g.teams[0][0];
      var minX = mate.x + c.both;
      if (dx < minX) { h += (minX - dx) * 0.18; dx = dx + (minX - dx) * 0.85; }
    }
    if (dx > 14.4) { over = dx - 14.4; dx = 14.4; }       // no meterse en el fondo / vallas
    D.x = dx;
    D.y = clamp((S.y + lead.y) * c.lat + c.off, -8.5, 8.5);
    // que el compañero no tape al jugador: si está entre la cámara y él, la cámara se aparta de lado
    var want = 0;
    if (g.ctrl) {
      var m2 = g.teams[0][0] === g.ctrl ? g.teams[0][1] : g.teams[0][0];
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
    occl += (want - occl) * Math.min(1, dt * 3);
    // desplazamiento perpendicular a la línea de visión (en el suelo, aproximadamente en y)
    D.y = clamp(D.y + occl, -8.5, 8.5);
    var high = ahead ? clamp((b.z - 4) * 0.12, 0, 0.55) : 0; // balón muy alto: sube un poco
    D.z = h + S.z * c.zf + over * 0.32 + high;
    // punto de mira en el suelo hacia la red (define el rumbo / yaw)
    var ax = S.x - c.aimX, ay = S.y * c.aimLat;
    if (c.ball > 0 && ahead) ay += (clamp(b.y, -6, 6) - ay) * c.ball;
    var yaw = Math.atan2(ay - D.y, ax - D.x);
    // cabeceo: pies del sujeto a c.k (NDC) -> jugador en el tercio inferior
    F.x = S.x; F.y = S.y; F.z = S.z;
    var cy = Math.cos(yaw), syw = Math.sin(yaw);
    var fd = Math.max(0.5, (F.x - D.x) * cy + (F.y - D.y) * syw);
    var tanH = Math.tan(fovFor(c.fov) * DEG / 2);
    var pitch = Math.atan2(F.z - D.z, fd) - Math.atan(c.k * tanH);
    pitch = clamp(pitch, -0.6, 0.35);
    var cp = Math.cos(pitch);
    A.x = D.x + cy * cp * 10; A.y = D.y + syw * cp * 10; A.z = D.z + Math.sin(pitch) * 10;
    fovWant = fovFor(c.fov);
  }

  /** Entre puntos: paneo lento alrededor de donde cayó el balón, subiendo un poco. */
  function pointShot(g, dt) {
    pointT += dt;
    var k = smooth01(pointT / 2.1);
    var rx = point0.x - pointFocus.x, ry = point0.y - pointFocus.y;
    var ang = pointDir * 0.24 * k, ca = Math.cos(ang), sa = Math.sin(ang);
    var dist = Math.hypot(rx, ry) || 1, pull = 1 + 0.12 * k;
    D.x = pointFocus.x + (rx * ca - ry * sa) * pull;
    D.y = pointFocus.y + (rx * sa + ry * ca) * pull;
    D.z = point0.z + pointLift * k;
    if (dist < 3) { D.x += 1.5 * k; D.z += 0.6 * k; }
    // mira: el bote, con un poco de la pista del equipo que ganó el punto
    var cx = pointWin === 0 ? 4.5 : -4.5;
    A.x = pointFocus.x + (cx - pointFocus.x) * 0.25 * k;
    A.y = pointFocus.y * (1 - 0.2 * k);
    A.z = 0.7 + 0.5 * k;
    fovWant = fovFor(52 - 3 * k);
  }

  /** Fin de partido: órbita lenta alrededor de los ganadores, en su campo. */
  function overShot(g, dt) {
    overT += dt;
    var w = g.sets[0] >= g.sets[1] ? 0 : 1, t = g.teams[w], sd = w === 0 ? 1 : -1;
    var tx = (t[0].x + t[1].x) / 2, ty = (t[0].y + t[1].y) / 2;
    overC.x += (tx - overC.x) * Math.min(1, dt * 2); overC.y += (ty - overC.y) * Math.min(1, dt * 2);
    var a = overA0 + Math.sin(overT * 0.22) * 0.75, R = 5.6;
    D.x = overC.x + Math.cos(a) * R; D.y = overC.y + Math.sin(a) * R; D.z = 2.0 + 0.4 * Math.sin(overT * 0.31);
    // siempre en el campo de los ganadores, sin cruzar la red
    if (D.x * sd < 1.2) D.x = sd * 1.2;
    A.x = overC.x; A.y = overC.y; A.z = 1.25;
    fovWant = fovFor(48);
  }

  /** Menú / demo: plano de retransmisión, órbita alta y lenta. */
  function menuShot(g, dt) {
    orbit += dt * 0.045;
    var a = orbit;
    D.x = Math.cos(a) * 15.5; D.y = Math.sin(a) * 11.5 - 1.5; D.z = 6.6 + Math.sin(a * 1.7) * 0.6;
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
      pointT = 0; point0.x = P.x; point0.y = P.y; point0.z = P.z;
      var b = g.ball; pointFocus.x = clamp(b.x, -10.5, 10.5); pointFocus.y = clamp(b.y, -6.5, 6.5);
      pointWin = g.lastPoint ? g.lastPoint.team : 0;
      // gira hacia el centro de la pista
      var cross = (point0.x - pointFocus.x) * (0 - pointFocus.y) - (point0.y - pointFocus.y) * (0 - pointFocus.x);
      pointDir = cross >= 0 ? 1 : -1;
      startBlend(0.9, 0.7, 10);
      return;
    }
    if (to === 'over') {
      overT = 0; var w = g.sets[0] >= g.sets[1] ? 0 : 1, t = g.teams[w];
      overC.x = (t[0].x + t[1].x) / 2; overC.y = (t[0].y + t[1].y) / 2;
      overA0 = Math.atan2(P.y - overC.y, P.x - overC.x);
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
  function framing(g, yaw0, pitch0, dt) {
    var wantP = 0, wantY = 0, wantBoost = 0;
    dbg.ballVisible = true;
    if (GAMEPLAY[shot] && g && g.ctrl) {
      var b = g.ball, p = g.ctrl;
      var tanH = Math.tan(fovCur * DEG / 2), tanW = tanH * aspect();
      var cy = Math.cos(yaw0), syw = Math.sin(yaw0);
      // jugador controlado (pies y cabeza)
      var pfd = (p.x - P.x) * cy + (p.y - P.y) * syw;
      var prt = (p.x - P.x) * syw - (p.y - P.y) * cy;
      // balón anticipado ~0,25 s (el suavizado va por detrás; así no se escapa al subir)
      var bX = b.x + b.vx * 0.2, bY = b.y + b.vy * 0.2, bZ = b.z + Math.max(0, b.vz) * 0.28;
      var bfd = (bX - P.x) * cy + (bY - P.y) * syw;
      var brt = (bX - P.x) * syw - (bY - P.y) * cy;
      if (pfd > 0.5) {
        var aF = Math.atan2(p.z - P.z, pfd);
        // límite: la cadera del jugador (z+0,95) nunca por debajo del 8 % inferior; los pies pueden salir un instante
        var aHip = Math.atan2(p.z + 0.95 - P.z, pfd);
        var pMax = Math.min(aHip + Math.atan(0.84 * tanH), aF + Math.atan(1.25 * tanH)) - pitch0;
        if (bfd > 0.8) {
          var aB = Math.atan2(bZ - P.z, bfd);
          var need = aB - Math.atan(0.80 * tanH) - pitch0;     // balón por debajo del 10 % superior
          wantP = Math.min(Math.max(0, need), pMax);            // el jugador manda sobre el balón
          if (need > pMax) wantBoost = clamp((need - Math.max(0, pMax)) / DEG * 0.9, 0, 9);
          // horizontal: sesgo suave hacia el balón, sin sacar al jugador del cuadro
          var hB = Math.atan2(brt, bfd), hP = Math.atan2(prt, pfd);
          var mB = Math.atan(0.82 * tanW), mP = Math.atan(0.62 * tanW);
          var d = -0.16 * hB;
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
        dbg.ctrlNdcY = Math.tan(aF - (pitch0 + exPitch)) / tanH; dbg.pfd = pfd;
      }
    }
    if (dt > 0) {
      exPitch = sd1(exPitch, wantP, exVel, 0, 0.30, dt);
      exYaw = sd1(exYaw, wantY, exVel, 1, 0.36, dt);
      fovBoost = sd1(fovBoost, wantBoost, fovBoostVel, 0, 0.4, dt);
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
    if (dt > 0) { fovCur = sd1(fovCur, fv, fovVel, 0, 0.35, dt); kick = Math.max(0, kick - dt * 14); }
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
    // temblor: ruido suave (suma de senos), decae al cuadrado
    var ox = 0, oy = 0, oz = 0, roll = 0;
    if (shakeT > 0) {
      if (dt > 0) shakeT = Math.max(0, shakeT - dt);
      var k = shakeA * Math.pow(shakeT / shakeDur, 2) * (reduceMotion ? 0.3 : 1), t = timeAcc;
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
    dbg.shot = shot; dbg.yaw = yaw; dbg.pitch = pitch; dbg.fov = fovCur;
  }

  function resetVel() { PV.x = PV.y = PV.z = LV.x = LV.y = LV.z = 0; exVel[0] = exVel[1] = 0; fovVel[0] = 0; fovBoostVel[0] = 0; filmVel[0] = 0; }

  VB.CameraRig = {
    init: function (c) {
      ctx = c; THREE = c.THREE; cam = c.camera; tgt3 = new THREE.Vector3();
      cam.near = 0.12; cam.far = 220; cam.fov = fovCur; cam.updateProjectionMatrix();
      try { reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { }
    },
    onGameStart: function (g) {
      slow.t = 0; if (ctx) ctx.timeScale = 1;
      sw.active = false; shakeT = 0; shakeA = 0; kick = 0;
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
      shot = pickShot(g); prevShot = shot; blendT = 0; sw.active = false;
      if (shot === 'point') { point0.x = g.ctrl.x + 5.5; point0.y = g.ctrl.y * 0.78; point0.z = 3.2; P.x = point0.x; P.y = point0.y; P.z = point0.z; onShotChange(g, '', 'point'); blendT = 0; }
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
    kick: function (deg) { if (!reduceMotion) kick = Math.max(kick, deg || 2.5); },
    /** Ejes de la cámara de juego en el plano del suelo (coordenadas de simulación). */
    getBasis: function () { return basis; },
    /** OPCIONAL (depuración / tests): plano actual y datos de encuadre. */
    getDebug: function () { return dbg; },
    getShot: function () { return shot; },
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
        if (e.type === 'switch') {
          if (!e.reset && e.from && e.to) {
            // deslizar el sujeto desde donde está ahora hasta el nuevo jugador
            sw.from.x = S.x; sw.from.y = S.y; sw.from.z = S.z; sw.to = e.to; sw.t = 0;
            var dist = Math.hypot(e.to.x - S.x, e.to.y - S.y);
            sw.dur = clamp(0.35 + dist * 0.035, 0.35, 0.6); sw.active = true; sw.back = e.to.x > S.x + 1;
          } else sw.active = false;
        } else if (e.type === 'hit' && e.kind === 'spike') {
          var mine = e.team === 0;
          this.shake(mine ? 0.07 : 0.11, mine ? 0.26 : 0.32);
          if (mine && playing && !g.autopilot) { this.kick(2.6); if (e.human) this.slowmo(0.3, 0.09, 0.06); }
          if (e.human && VB.Input && VB.Input.rumble) VB.Input.rumble(0.9, 90);
        } else if (e.type === 'hit' && e.human) {
          if (VB.Input && VB.Input.rumble) VB.Input.rumble(e.kind === 'serve' ? 0.6 : 0.35, 45);
        } else if (e.type === 'block') {
          this.shake(0.09, 0.28);
          if (e.team === 0 && playing) { this.kick(2); if (VB.Input && VB.Input.rumble) VB.Input.rumble(0.8, 80); }
        } else if (e.type === 'net' && !e.tape) {
          this.shake(0.025, 0.18);
        } else if (e.type === 'point' && !g.demo) {
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
      if (g.ctrl) { subject(g, dt); updateLead(g, dt); }
      computeDesired(g, dt);

      var c = SHOTS[shot], baseSmooth = c ? c.smooth : (shot === 'menu' ? 1.0 : shot === 'over' ? 0.9 : 0.6);
      // ajuste del jugador (Ajustes > cámara): 0,5 lenta … 1,5 rápida
      if (c) { var sens = clamp(+(ctx.settings && ctx.settings.camSens) || 1, 0.5, 1.5); baseSmooth /= sens; }
      var smoothT = baseSmooth, maxSpeed = 40;
      if (blendT > 0) {
        var f = blendT / blendDur;               // 1 al empezar, 0 al acabar
        smoothT = baseSmooth + (blendSmooth - baseSmooth) * f;
        maxSpeed = blendMax + (40 - blendMax) * (1 - f);
        blendT = Math.max(0, blendT - dt);
      }
      if (dt > 0) {
        sdv(P, D, PV, smoothT, dt, maxSpeed);
        sdv(L, A, LV, smoothT * 0.75, dt, maxSpeed * 1.4);
      }
      apply(dt, g);
    }
  };
})();
