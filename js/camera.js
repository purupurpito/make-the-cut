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
 *   court      CAMBIO DE CAMPO (evento courtChange, reglas 18.2.1/18.2.2): tras ~1,4 s del plano de reacción,
 *              corte a una grúa alta por la banda de la mesa que recorre la pista desde el campo rival hasta
 *              detrás de nuestro equipo (se ven los dos campos, el videomarcador del fondo con el aviso y los
 *              jugadores yendo a su sitio) y de ahí baja, sin corte, al plano del saque
 *   over       fin de partido: órbita lenta alrededor de los ganadores (con la hoja final acoplada, ctx.uiDock, en la parte libre)
 *   clinch     cierre de set/partido (CAM-09): balón cayendo a cámara lenta sobre su marca y órbita cerrada de los ganadores
 *   cutaway    plano corto del sacador rival durante su ritual, antes de la cámara de recepción (CAM-14)
 *   intro      grúa de presentación bajo la tarjeta del partido (UI-14, playIntro)
 * Encima de los planos de juego: seguimiento del remate propio hasta el bote (CAM-08), defensa que se acerca para leer al
 * rematador rival (CAM-13), FOV mínimo de 52° vertical en ultrapanorámica (CAM-12) y, en pantalla pequeña, FOV de ayuda por
 * toque con histéresis y lente a ritmo limitado (CAM-11).
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
 * CÁMARA LENTA ANTES DE GOLPEAR (11-nov-2026, pedido de Ferran: «hace el juego demasiado fácil»): toda cámara lenta
 * que ayude al humano ANTES de su golpe pasa por slowmo(…, aid) y solo entra en Fácil o en los primeros partidos
 * (aidOk). Lo que viene DESPUÉS del golpe (hit-stop del remate/saque/defensa/bloqueo ya hechos, cámara lenta del punto
 * de set o de partido, cierre) no es ayuda y queda en todos los niveles. Inventario en notes/camera_input.md.
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
  // Mates SIN BASURA en todos los niveles del JIT. Maglev (el compilador intermedio de V8, donde la cámara pasa buena
  // parte del partido: sus funciones se llaman una vez por frame y tardan en llegar a TurboFan) no integra
  // Math.min/max/hypot/atan2/sqrt: cada llamada creaba 1-3 HeapNumber (~48 B). Estas sí las integra (medido en
  // tools/out/camalloc). Diferencias: mn/mx con NaN devuelven el otro valor (mejor que propagar un NaN a la cámara);
  // at2(0, -0) da 0 en vez de π (irrelevante aquí).
  var PI = Math.PI, HPI = Math.PI / 2;
  function mn(a, b) { return a < b ? a : b; }
  function mx(a, b) { return a > b ? a : b; }
  function sq(v) { return Math.pow(v, 0.5); }
  function hyp(a, b) { return Math.pow(a * a + b * b, 0.5); }
  function hyp3(a, b, c) { return Math.pow(a * a + b * b + c * c, 0.5); }
  function at2(y, x) {
    if (x > 0) return Math.atan(y / x);
    if (x < 0) return Math.atan(y / x) + (y >= 0 ? PI : -PI);
    return y > 0 ? HPI : y < 0 ? -HPI : 0;
  }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function ease(t) { t = mn(mx(t, 0), 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; } // easeInOutCubic
  function smooth01(t) { t = mn(mx(t, 0), 1); return t * t * (3 - 2 * t); }

  // ---------------- Estado del rig (todo preasignado: cero basura por frame) ----------------
  var P = V(), PV = V();           // posición real de la cámara + velocidad
  var L = V(), LV = V();           // punto de mira real + velocidad
  var D = V(), A = V();            // deseados: posición, punto de mira
  // ESTADO ESCALAR del rig en un objeto (no en variables del cierre): V8 guarda un double de una variable de cierre
  // como HeapNumber nuevo en CADA escritura (~40 por frame = basura en móvil); en un campo de objeto va sin caja.
  var K = { fovCur: 54.5, fovWant: 54.5, exYaw: 0.5, exPitch: 0.5, fovBoost: 0.5, film: 0.5, blendT: 0.5, blendDur: 0.5, blendSmooth: 0.6, blendMax: 30.5,
            swFast: 0.5, landX: 0.5, landY: 0.5, pointT: 0.5, overT: 0.5, overA0: 0.5, orbit: 0.6, timeAcc: 0.5, basisYaw: Math.PI,
            shakeA: 0.5, shakeT: 0.5, shakeDur: 0.3, shakeRoll: 0.5, kick: 0.5, antW: 0.5, antLead: 1.5, occl: 0.5, netK: 0.5, netSide: 1.5,
            atkSide: 1.5, nearK: 0.5, airK: 0.5, mOcc: 0.5, overSep: 2.5, outPitch: 0.5, outYaw: 0.5, lagPitch: 0.5,
            // "bus" de escalares entre funciones internas: un double pasado como ARGUMENTO a una función que V8 no
            // integra (gameplayShot, framing, apply, sdv… son grandes) va en caja = HeapNumber nuevo por llamada
            dt: 0.5, yaw0: 0.5, pitch0: 0.5, sdT: 0.5, sdMax: 0.5, fsFd: 0.5, fsCy: 0.5, fsSy: 0.5, mateUp: 0.5, mateUpWant: 0.5,
            // límites del pabellón (VB.Arena.bounds): |x| <= bX, |y| <= bY (grúa: bYc), z <= bZ
            bX: 15.2, bY: 9.3, bYc: 10.2, bZ: 19.5,
            // hit-stop (s reales de congelación / de vuelta), punch de FOV (amplitud, edad), temblor aplicado este frame
            hsT: 0.5, hsE: 0.5, hsEDur: 0.5, hsF: 0, hsFMax: 0, bgP: 0, punchA: 0.5, punchT: 0.5, shakeOff: 0.5,
            // transición FIJA al saque (curva críticamente amortiguada): duración, tiempo, origen y destino de giro/cabeceo/FOV
            fbT: 0.5, fbDur: 0.5, fbYaw0: 0.5, fbPitch0: 0.5, fbFov0: 0.5, fbYaw1: 0.5, fbPitch1: 0.5, fbFov1: 0.5,
            fbExP: 0.5, fbExY: 0.5, fbBoost: 0.5, nextCut: 0.5, digT: 0.5,
            // ola 2: ajuste por toque en táctil (CAM-11), FOV de ayuda con histéresis, defensa que se acerca (CAM-13)
            tfBack: 0.5, tfBackT: 0.5, bHold: 0.5, bHoldT: 0.5, defU: 0.5, defF: 0.5, awayK: 0.5, ftU: 0.5, ftW: 0.5, ftWe: 0.5, wideT: 9.5, pbNar: 0.5, banP: 0.5, blkU: 0.5, blkEvT: -9.5, spkT: -9.5, ofK: 1.5 };
  (function () { var z = { fovCur: 54, fovWant: 54, blendSmooth: 0.6, blendMax: 30, orbit: 0.6, basisYaw: Math.PI, shakeDur: 0.3, antLead: 1, netSide: 1, atkSide: 1, overSep: 2,
                           bX: 15.2, bY: 9.3, bYc: 10.2, bZ: 19, nextCut: -1, digT: -9, blkEvT: -9, spkT: -9 };
    for (var k in K) K[k] = z.hasOwnProperty(k) ? z[k] : 0; })();   // (inicializados con no enteros: el campo nace double)
  var S = V();                     // sujeto (pies del jugador seguido, con deslizamiento al cambiar)
  var F = V();                     // punto a encuadrar en el tercio inferior (pies)
  var fovVel = [0];
  var exVel = [0, 0], fovBoostVel = [0];
  var filmVel = [0];
  var shot = 'menu', prevShot = '';
  var sw = { active: false, t: 0, dur: 0.45, from: V(), to: null, back: false };
  var landOk = false;
  var pointHow = '', pointPlayer = null, pointEv = null, spikeTeam = -1;
  /** Vibración con FIRMA (input.js rumbleSig: perfect = dos toques secos, good = uno, poor = sordo, body, won, lost,
   *  match, kill, block). Respaldo: rumble(fuerza, ms) de antes. */
  var SIG_FALLBACK = { perfect: [0.8, 35], good: [0.55, 45], poor: [0.25, 110], body: [0.4, 40], won: [0.6, 60], lost: [0.3, 140], match: [0.9, 160], kill: [0.7, 90], block: [0.85, 85] };
  function rumbleSig(name, k) {
    var I = VB.Input; if (!I) return;
    try {
      if (I.rumbleSig) I.rumbleSig(name, k);
      else if (I.rumble) { var f = SIG_FALLBACK[name] || SIG_FALLBACK.good; I.rumble(mn(1, f[0] * (k || 1)), f[1]); }
    } catch (e) { }
  }
  var overC = V();
  var basis = { fx: -1, fy: 0, rx: 0, ry: 1 };
  var slow = { t: 0, scale: 1, out: 0.4, total: 0 };
  var reduceMotion = false;
  var DBGX = (root.location && /camdbg=1/.test(root.location.search || "")) ? [0, 0, 0, 0, 0, 0] : null;
  // PRUEBAS DE LA PRUEBA (CAM-20): &camBreak=clinch|serve|board|menu|block|clutter|hitstop|intro|cut rompe A PROPÓSITO esa regla para
  // comprobar que tools/camtest.js la caza (node tools/camtest.js selftest). Sin el parámetro no cambia nada.
  var BRK = ''; try { var bm = root.location && /[?&]camBreak=([a-z]+)/.exec(root.location.search || ''); BRK = bm ? bm[1] : ''; } catch (e) { BRK = ''; }
  var dbg = { shot: '', yaw: 0, pitch: 0, fov: 0, ballNdcX: 0, ballNdcY: 0, ctrlNdcY: 0, ballVisible: true, netK: 0, focusNdcY: 9, mateLo: -9, mateUp: 0,
              cutN: 0, lastCut: null, nextCutIn: -1, timeScale: 1, hitStop: 0, punch: 0, shake: 0, fb: 0,
              fovBoost: 0, tfBack: 0, defW: 0, defF: 0, ft: null, clinch: null, menu: '', menuT: 0.5 };
  // CORTES DELIBERADOS (para UI: banners sincronizados, cortinillas). cutN sube en cada corte; lastCut = el último;
  // nextCutIn = s (reales) hasta el siguiente corte programado (-1 = ninguno). kind: 'point' (al plano de reacción),
  // 'serve' (de la reacción al saque), 'court' (grúa del cambio de campo), 'over' (al final), 'cutaway', 'replay'.
  var CUT = { n: 0, frame: false, last: { from: '', to: '', kind: '', t: 0 } };
  function markCut(from, to, kind) {
    CUT.n++; CUT.frame = true;
    CUT.last.from = from; CUT.last.to = to; CUT.last.kind = kind; CUT.last.t = ctx ? ctx.time : 0;
    dbg.lastCut = CUT.last;
  }

  // ---------------- Planos de juego (ajustados mirando capturas) ----------------
  // back: distancia detrás del sujeto (m) · h: altura de cámara · fov vertical (16:9)
  // k: dónde quedan los pies (NDC, negativo = abajo) · lat: cuánto sigue la cámara la y del jugador
  // off: desplazamiento lateral (m, + = derecha de pantalla) · aimX: a qué distancia mira hacia la red
  // aimLat: fracción de la y del jugador en el punto de mira · ball: sesgo del punto de mira hacia el balón
  // court: la línea de fondo rival al menos a esa altura NDC (=> la pista ocupa >= ~60 % del cuadro)
  // side: cámara "por encima del hombro" (m, hacia el lado contrario al balón) · server: sesgo de la mira hacia el sacador rival
  // hMob: altura en móvil
  var SHOTS = {
    rally:     { back: 6.0, h: 4.0,  fov: 54, k: -0.52, both: 2.6, lat: 0.78, off: 0,    aimX: 8.5, aimLat: 0.30, ball: 0.25, smooth: 0.30, zf: 0.40, court: 0.20, wide: 1 },
    defend:    { back: 6.5, h: 4.3,  fov: 55, k: -0.56, both: 3.0, lat: 0.72, off: 0,    aimX: 9.5, aimLat: 0.25, ball: 0.30, smooth: 0.34, zf: 0.40, court: 0.22, wide: 1 },
    attack:    { back: 4.9, h: 3.6,  fov: 52, k: -0.42, rise: 3.0, lat: 0.85, off: 0,    aimX: 7.0, aimLat: 0.45, ball: 0.20, smooth: 0.26, zf: 0.70, court: 0.20, side: 2.3, wide: 1 },
    // saque propio: cámara alta (4,6 m) sobre el hombro y FOV AJUSTADO (fit) para que el campo rival, que es el
    // objetivo del saque, ocupe todo lo posible: línea de fondo rival a fit.top NDC, cadera del sacador a fit.hip y la
    // lanzamiento por debajo de fit.ball. Antes (h 2,85) el campo rival era una tira de ~60 px (8 %); ahora ~17 % del alto
    // y, al estar más alta, la malla de la red tapa menos el campo rival.
    serveUs:   { back: 4.2, h: 5.4,  fov: 46, k: -0.62, lat: 1.00, off: 1.05, aimX: 16,  aimLat: 0.25, ball: 0,    smooth: 0.28, zf: 0.30,
                 fit: { top: 0.55, lowZ: 1.35, low: -0.88, ball: 0.72 } },
    serveThem: { back: 6.0, h: 4.1,  fov: 42, k: -0.52, lat: 0.55, off: 0,    aimX: 15,  aimLat: 0.10, ball: 0.15, smooth: 0.32, zf: 0.40, server: 0.55, hMob: 3.6 }
  };
  // Todos los planos con LA MISMA forma (mismos campos y orden; los que faltaban, a 0 / null): lecturas monomórficas
  // y sin búsquedas de campos inexistentes, que dependen de la cadena de prototipos y desoptimizan la cámara entera
  // cuando V8 la invalida (lo hace cada ~9 s en partido; ver notes/camera_input.md).
  (function () {
    for (var k in SHOTS) {
      var o = SHOTS[k];
      SHOTS[k] = { back: o.back || 0, h: o.h || 0, fov: o.fov || 0, k: o.k || 0, both: o.both || 0, rise: o.rise || 0, side: o.side || 0,
                   lat: o.lat || 0, off: o.off || 0, aimX: o.aimX || 0, aimLat: o.aimLat || 0, ball: o.ball || 0, smooth: o.smooth || 0,
                   zf: o.zf || 0, court: o.court || 0, server: o.server || 0, hMob: o.hMob || 0, wide: o.wide || 0, fit: o.fit || null };
    }
  })();
  var GAMEPLAY = { rally: 1, defend: 1, attack: 1, serveUs: 1, serveThem: 1 };

  // ---------------- SmoothDamp ----------------
  // Vectorial (Unity/Game Programming Gems 4), con velocidad máxima isótropa.
  // (smoothT, dt y velocidad máxima llegan por K.sdT, K.dt y K.sdMax: sin dobles en caja por llamada)
  function sdv(cur, target, vel) {
    var smoothT = mx(0.0001, K.sdT), dt = K.dt, maxSpeed = K.sdMax;
    var omega = 2 / smoothT, x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var cx = cur.x - target.x, cy = cur.y - target.y, cz = cur.z - target.z;
    var ox = target.x, oy = target.y, oz = target.z;
    var maxC = (maxSpeed || 1e9) * smoothT, l2 = cx * cx + cy * cy + cz * cz;
    if (l2 > maxC * maxC) { var s = maxC / sq(l2); cx *= s; cy *= s; cz *= s; }
    var tx = cur.x - cx, ty = cur.y - cy, tz = cur.z - cz;
    var px = (vel.x + omega * cx) * dt, py = (vel.y + omega * cy) * dt, pz = (vel.z + omega * cz) * dt;
    vel.x = (vel.x - omega * px) * e; vel.y = (vel.y - omega * py) * e; vel.z = (vel.z - omega * pz) * e;
    var nx = tx + (cx + px) * e, ny = ty + (cy + py) * e, nz = tz + (cz + pz) * e;
    // sin sobrepaso
    if ((ox - cur.x) * (nx - ox) + (oy - cur.y) * (ny - oy) + (oz - cur.z) * (nz - oz) > 0) { nx = ox; ny = oy; nz = oz; vel.x = vel.y = vel.z = 0; }
    cur.x = nx; cur.y = ny; cur.z = nz;
  }
  function sd1(cur, target, velArr, i, smoothT, dt) {
    var omega = 2 / mx(0.0001, smoothT), x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var c = cur - target, tmp = (velArr[i] + omega * c) * dt;
    velArr[i] = (velArr[i] - omega * tmp) * e;
    var out = target + (c + tmp) * e;
    if ((target - cur > 0) === (out > target)) { out = target; velArr[i] = 0; }
    return out;
  }

  // ---------------- Utilidades ----------------
  function aspect() { return ctx && ctx.height > 0 ? ctx.width / ctx.height : 16 / 9; }
  /** FOV vertical según el aspecto: abre en pantallas estrechas (4:3) y cierra en móviles muy anchos.
   *  `wide` (planos de peloteo rally/defend/attack, CAM-12): en pantallas de aspecto > 2 (21:9, 32:9, móvil en horizontal) el
   *  horizontal puede llegar a ~100° y el VERTICAL no baja de 52°: con el tope de 92° de horizontal, a 2560x1080 quedaban 47° de
   *  vertical y el balón alto de la colocación rival se salía por arriba en la defensa. */
  function fovFor(base, hMinHalf, vLow, wide) {
    var a = aspect();
    var vMin = 2 * Math.atan(Math.tan((hMinHalf || 37) * DEG) / a) / DEG;  // al menos ~74° de horizontal (o lo pedido)
    var vMax = 2 * Math.atan(Math.tan((wide && a > 2.0 ? 50 : 46) * DEG) / a) / DEG;   // como mucho ~92° (ultrapanorámica: 100°) de horizontal
    var v = mn(mx(mn(mx(base, vMin), vMax), vLow || 40), 80);
    if (wide && a > 2.0) v = mx(v, mn(52, vMax));
    return v;
  }
  /** Ajuste de dos restricciones: el punto de ángulo aT (elevación, rad) a nT NDC y el de aB a nB NDC (nB < 0 < nT).
   *  Devuelve en fitOut {p: cabeceo, t: tan(fov/2)}. Bisección (12 pasos): sin asignaciones. */
  var fitOut = { p: 0, t: 0.4 }, fitLow = { z: 1.35, n: -0.88 };
  function fit2(aT, nT, aB, nB) {
    // forma cerrada (UI-13: el encuadre del saque la llama ~100 veces por búsqueda): con u = nT·t = tan(aT-p) y v = -nB·t = tan(p-aB),
    // tan(aT-aB) = (u+v)/(1-uv) -> k·T·t² + s·t - T = 0 (T = tan Δ, s = nT-nB, k = -nT·nB). Raíz positiva; misma solución que la bisección.
    var dA = aT - aB;
    if (nT > 0 && nB < 0 && dA > 1e-3 && dA < 1.5) {
      var T = Math.tan(dA), s = nT - nB, kq = -nT * nB, tq = 2 * T / (s + Math.sqrt(s * s + 4 * kq * T * T));
      fitOut.t = tq; fitOut.p = aT - Math.atan(nT * tq);
      return fitOut;
    }
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
    if (typeof e.power === 'number' && e.power === e.power) return mn(mx(e.power, 0), 1);
    return mn(mx(((e.speed || 15) - 11) / 9, 0), 1);
  }
  /** Multiplicador por calidad del toque. */
  function gradeMul(gr) { return gr === 'perfect' ? 1.25 : gr === 'poor' ? 0.75 : 1; }
  function isPlaying() { return ctx && (ctx.state === 'playing' || ctx.state === 'paused'); }

  /** Elige el plano según el estado del partido. */
  function pickShot(g) {
    if (!g || g.demo || ctx.state === 'menu') return 'menu';
    if (reviewOn(g)) return 'review';   // (revisión del challenge, B5: manda sobre el resto mientras dure)
    // 6v6 (sprint 2, espectador): cámara de televisión fija para saque y peloteo; también en el punto; cambio de campo y final como en 2v2
    // (sin presentación, cierre ni plano del sacador rival: entran con el humano, sprint 3)
    if (g.size === 6) {
      if (g.mode === 'over' || g.finished || ctx.state === 'over') return 'over';
      if (tp6(g)) return g.mode === 'point' ? ((CC.on && CC.t >= CC.start) ? 'court' : 'tpPoint') : 'tp';   // (3ª persona)
      if (g.mode === 'point') return (CC.on && CC.t >= CC.start) ? 'court' : 'tv';   // (el plano de reacción entre 12 quedaba tapado: sprint 3)
      return 'tv';
    }
    if (INTRO.on && g.mode === 'serve') return 'intro';   // (presentación del partido, UI-14)
    if (CL.on) return 'clinch';   // (cierre de set/partido, CAM-09)
    if (CW.on && g.mode === 'serve') return 'cutaway';   // (sacador rival antes del lanzamiento, CAM-14)
    if (g.mode === 'over' || g.finished || ctx.state === 'over') return 'over';
    if (g.mode === 'point') return (CC.on && CC.t >= CC.start) ? 'court' : 'point';
    if (g.mode === 'serve') return g.serving === 0 ? 'serveUs' : 'serveThem';
    if (FT.on && GAMEPLAY[FT.shot] && FT.shot !== 'serveUs' && FT.shot !== 'serveThem') return FT.shot;   // (seguimiento del remate: el plano no cambia hasta el bote)
    var p = g.ctrl, b = g.ball;
    if (p && p.lastAction === 'spike' && p.actionT < 0.75) return 'attack';
    if (g.touchTeam === 0 && g.touches >= 2 && b.x > -0.5 && p && g.jobs && g.jobs[0] === p && Math.abs(p.x) < 5.5) return 'attack';
    if (b.x < 0 && g.touchTeam === 1 && g.touches >= 1 && g.lastKind !== 'serve') return 'defend';
    return 'rally';
  }

  /** Sujeto que sigue la cámara (pies del jugador controlado), con deslizamiento en los cambios. */
  function subject(g) {
    var p = g.ctrl, dt = K.dt;
    if (sw.active && sw.to) {
      sw.t += dt;
      // si el nuevo jugador está más cerca de la cámara (detrás), la cámara arranca a retroceder ya (ease‑out);
      // si no, curva suave en S. El SmoothDamp de la posición añade el arranque suave.
      var u = mn(mx(sw.t / sw.dur, 0), 1), to = sw.to;
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
  var ant = V(), antT = V(), antV = V();
  function updateAnticipation(g) {
    var p = g.ctrl, w = 0, wy = 0.8, m = null, dt = K.dt;
    K.antLead = 1;
    if (p && g.mode === 'rally' && !g.demo) {
      m = mateOf(g);
      if (g.touchTeam === 1 && g.touches >= 1 && g.lastKind !== 'serve') {
        // defensa: nuestro jugador es el de delante (va a la red a bloquear); el remate irá al de atrás
        w = 0.72 * smooth01((m.x - p.x - 1.0) / 2.2);
        K.antLead = 1 - mn(mx(w / 0.4, 0), 1);
      } else if (g.touchTeam === 0 && g.touches === 1 && g.jobs && g.jobs[0] === p) {
        // colocación propia: tras ella el control pasa SIEMPRE al compañero (rematador). El sujeto se
        // abre un poco hacia él (sobre todo a lo ancho) para que el cambio no lo deje fuera por un lado.
        w = 0.36; wy = 1.0;
      }
    }
    K.antW = w;
    antT.x = w ? (m.x - p.x) * w : 0; antT.y = w ? (m.y - p.y) * w * wy : 0; antT.z = 0;
    if (dt > 0) { K.sdT = comfort() ? 0.55 : 0.38; K.sdMax = 9; sdv(ant, antT, antV); }
    else { ant.x = antT.x; ant.y = antT.y; antV.x = antV.y = 0; }
  }
  /** Anticipación: la cámara se adelanta un poco a la carrera del jugador (compensa el retraso del suavizado). */
  var lead = V(), leadV = V(), leadT = V();
  function updateLead(g) {
    // (sin anticipación de carrera mientras el sujeto se adelanta al defensor: el bloqueador corre hacia la red)
    var dt = K.dt, p = g.ctrl, k = (g.mode === 'rally' && p) ? 0.24 * K.antLead : 0;
    leadT.x = k ? mn(mx(p.vx, -7), 7) * k : 0; leadT.y = k ? mn(mx(p.vy, -7), 7) * k * 0.7 : 0; leadT.z = 0;
    if (dt > 0) { K.sdT = 0.25; K.sdMax = 20; sdv(lead, leadT, leadV); }
    else { lead.x = leadT.x; lead.y = leadT.y; lead.z = 0; leadV.x = leadV.y = leadV.z = 0; }   // (corte: ya en su sitio)
  }

  /** Compañero de p (2v2: el otro, igual que siempre; con más jugadores: el compañero en pista más cercano a p, VB.Sim.nearestMate). */
  function mateOfP(g, p) {
    var t = g.teams[p.team];
    if (t.length === 2) return t[0] === p ? t[1] : t[0];
    return (VB.Sim && VB.Sim.nearestMate && VB.Sim.nearestMate(g, p)) || p;
  }
  /** Compañero de p en el equipo w (2v2: exactamente el «el otro de teams[w]» de siempre). */
  function mateIn(g, w, p) { var t = g.teams[w]; return t.length === 2 ? (t[0] === p ? t[1] : t[0]) : (p.team === w ? mateOfP(g, p) : t[0]); }
  /** Compañero del jugador del humano (en 2v2 el de siempre). */
  function mateOf(g) { var t = g.teams[0]; return t.length === 2 ? (t[0] === g.ctrl ? t[1] : t[0]) : mateOfP(g, g.ctrl || t[0]); }
  /** Modo confort: prefers-reduced-motion o el ajuste opcional "Cámara estable" (ctx.settings.camStable). */
  // (se lee una vez por frame en update: camStable puede no existir en ctx.settings y una lectura de un campo
  // inexistente en cada llamada ataba media cámara a la cadena de prototipos)
  var calmNow = false, stableNow = false;
  function readComfort() {
    var st = ctx && ctx.settings;
    // (UI-16: el ajuste explícito «Cámara estable» quita el temblor del todo; prefers-reduced-motion lo deja al 30 %)
    stableNow = !!(st && Object.prototype.hasOwnProperty.call(st, 'camStable') && st.camStable);
    calmNow = reduceMotion || stableNow;
    // 6v6: cámara en 3ª persona ('3p', por defecto) o de televisión ('tv'); ?cam6=tv|3p manda (pruebas)
    cam6Tv = Q6 ? Q6 === 'tv' : !!(st && Object.prototype.hasOwnProperty.call(st, 'cam6') && st.cam6 === 'tv');
  }
  var cam6Tv = false, Q6 = ''; try { var m6 = root.location && /[?&]cam6=(tv|3p)/.exec(root.location.search || ''); Q6 = m6 ? m6[1] : ''; } catch (e) { Q6 = ''; }
  /** ¿6v6 con humano y cámara en 3ª persona? (el espectador, g.watch, y el ajuste «Televisión» van con el plano tv) */
  function tp6(g) { return g.size === 6 && !g.watch && !cam6Tv && !!g.ctrl; }
  function comfort() { return calmNow; }

  /* DEFENSA QUE SE ACERCA (CAM-13). Mientras el rival construye (recepción o colocación suya, balón en su campo) la cámara de
   * defensa se acerca ~1,9 m, baja 0,35 m, cierra el FOV 7° y sube el cabeceo hacia el rematador previsto (el que recibió, si
   * aún no han colocado; si ya colocaron, el compañero del colocador). Entra en ~0,8 s; en el remate (o dejada) se suelta en
   * 0,4 s (posición y cabeceo) y el FOV vuelve a <= 8°/s. Devuelve el peso suavizado 0..1. Con dt = 0 (cortes) va a su objetivo. */
  var DEF = { att: null };
  function defPushW(g, c) {
    var want = 0, att = null;
    if (c === SHOTS.defend && g.mode === 'rally' && g.ctrl && g.touchTeam === 1 && g.touches >= 1 && g.touches <= 2 && g.ball.x < 0 &&
        (g.lastKind === 'pass' || g.lastKind === 'set')) {
      var lp = g.lastPlayer;
      if (lp && lp.team === 1) att = g.touches === 1 ? lp : mateOfP(g, lp);
      if (att) { want = 1; DEF.att = att; }
    }
    var dt = K.dt;
    if (dt > 0) {
      K.defU = want > K.defU ? mn(want, K.defU + dt / 0.8) : mx(want, K.defU - dt / 0.4);
      var fr = dt * 8 / 8;   // (FOV: como mucho 8°/s)
      K.defF = want > K.defF ? mn(want, K.defF + fr) : mx(want, K.defF - fr);
    } else { K.defU = want; K.defF = want; }
    if (K.defU <= 0 && K.defF <= 0) DEF.att = null;
    return smooth01(K.defU);
  }
  /* AJUSTE POR TOQUE EN PANTALLA PEQUEÑA (CAM-11). En cada toque (no en cada frame) se mira la trayectoria nueva: si su cumbre y la
   * cadera del jugador no caben a la vez en los límites del táctil (balón <= 0,62 NDC, cadera >= -0,55), la cámara se aleja lo justo
   * (hasta 3 m, y algo más alta) en vez de abrir el FOV. Se mantiene hasta el siguiente toque (un objetivo por toque: sin bombeo). */
  function touchFitPlan(g) {
    var p = g.ctrl, b = g.ball;
    if (!p || g.mode !== 'rally' || !(touchUI() || ctx.isMobile)) { K.tfBackT = 0; return; }
    var Gc = (VB.C && VB.C.G) || 9.81, tUp = mx(0, b.vz) / Gc;
    var ax = b.x + b.vx * tUp, az = b.z + mx(0, b.vz) * tUp * 0.5;
    var c = SHOTS[shot] && SHOTS[shot].wide ? SHOTS[shot] : SHOTS.rally;
    var back = c.back * (ctx.isMobile ? 0.94 : 1), h = (ctx.isMobile && c.hMob) ? c.hMob : c.h;
    var tanH = Math.tan(fovFor(c.fov, 0, 0, 1) * DEG / 2), lim = Math.atan(0.68 * tanH) + Math.atan(0.68 * tanH);
    var px = p.x, ex = 0;
    // (el balón va hacia nuestro campo: el que lo jugará estará cerca de la cumbre/caída; si va al rival, manda el jugador actual)
    for (ex = 0; ex < 3.0; ex += 0.25) {
      var cx = mn(px + back + ex, 14.4), cz = h + 0.22 * ex, dB = cx - ax;
      if (dB < 1.5) break;   // (cumbre encima o detrás de la cámara: el FOV de ayuda se encarga)
      if (Math.atan((az - cz) / dB) - Math.atan((p.z + 0.95 - cz) / mx(1, cx - px)) <= lim) break;
    }
    K.tfBackT = ex;
  }
  /* SEGUIMIENTO DEL REMATE HASTA EL BOTE (CAM-08). Remate del jugador controlado (o saque en salto potente, > 0,7): la mira se
   * va del rematador al punto de caída previsto (Sim.predictLanding) en 0,25 s (de tiempo de JUEGO: el hit-stop lo congela
   * con todo lo demás), el FOV se cierra 3,5° y se mantiene hasta el bote; luego manda el plano del punto (planPoint). Sin corte.
   * La base de control queda congelada mientras dura (como en la grúa). Se suelta (0,35 s) si el rival toca el balón o lo bloquea. */
  var FT = { on: false, t: 0.5, lx: 0.5, ly: 0.5, shot: '', wait: 0.5 }, FTP = { x: 0.5, y: 0.5, z: 0.5, t: 0.5 }, FTD = { on: 0, w: 0.5, lx: 0.5, ly: 0.5 };
  function ftStart(g, e) {
    FT.on = true; FT.t = 0; FT.shot = GAMEPLAY[shot] ? shot : 'rally';
    // (el momento de red, CAM-17, vale 0 mientras dura el seguimiento: sin bloqueo previsto se suelta ya; con él, en 0,5 s)
    // (con bloqueadores rivales arriba junto al balón, la panorámica espera 0,15 s de juego: si bloquean, el seguimiento se anula antes de
    // girar y el bloqueo no se filma con un latigazo de 140°/s)
    FT.wait = 0; var bb0 = g.ball;
    // (bloqueo probable: un rival junto a la red por cuyo plano el balón pasará a su alcance —manos hasta ~3,3 m, ±1 m a lo ancho—)
    for (var wi = 0; wi < g.teams[1].length; wi++) {
      var rq = g.teams[1][wi]; if (Math.abs(rq.x) > 1.3 || !(bb0.vx < -1)) continue;
      var tq = (rq.x - bb0.x) / bb0.vx; if (tq < 0 || tq > 0.5) continue;
      var zq = bb0.z + bb0.vz * tq - 4.9 * tq * tq, yq = bb0.y + bb0.vy * tq;
      if (zq < 3.35 && zq > 1.6 && Math.abs(yq - rq.y) < 1.05) FT.wait = 0.2;
    }
    if (!(FT.wait > 0)) K.blkU = 0;
    ftLanding(g);
  }
  function ftLanding(g) {
    var S0 = VB.Sim;
    if (!S0 || !S0.predictLanding || g.ball.held) return;
    try { S0.predictLanding(g, FTP); } catch (e) { return; }
    if (FTP.x === FTP.x && FTP.y === FTP.y) { FT.lx = mn(mx(FTP.x, -14), 14); FT.ly = mn(mx(FTP.y, -8.5), 8.5); }
  }
  function ftUpdate(g, gdt) {
    if (FT.on) {
      if (g.mode !== 'rally' || FT.t > 2.5) FT.on = false;
      else { FT.t += gdt; ftLanding(g); }
    }
    // (sube en 0,25 s de juego: 0,45 en confort; baja en 0,35 s reales)
    var up = comfort() ? 0.45 : 0.25;
    if (FT.on) { if (FT.t >= FT.wait) K.ftU = mn(1, K.ftU + gdt / up); } else K.ftU = mx(0, K.ftU - K.dt / 0.35);
    K.ftW = smooth01(K.ftU);
  }
  /** Mira del seguimiento: mezcla la mira del plano (A) con la del punto de caída (bote a -0,12 NDC, centrado) y cierra el FOV. */
  function ftApply(tanH) {
    var w = K.ftW; if (!(w > 0.001)) return;
    var tx = FT.lx - D.x, ty = FT.ly - D.y, td = mx(1, hyp(tx, ty));
    var yawT = at2(ty, tx), pitchT = at2(0.3 - D.z, td) + Math.atan(0.12 * tanH);
    var ax = A.x - D.x, ay = A.y - D.y, ah = mx(0.01, hyp(ax, ay));
    var yawA = at2(ay, ax), pitchA = at2(A.z - D.z, ah);
    // (el rematador que cae no sale del cuadro: si su cadera quedaría fuera, la mezcla cede lo justo — bisección de 4 pasos)
    var p = ctx.game && ctx.game.ctrl;
    if (p) {
      var hx = p.x - D.x, hy = p.y - D.y, hz = p.z + 0.95 - D.z, hh = mx(0.3, hyp(hx, hy)), tanW = tanH * aspect();
      var lo = 0, hi = w, ww = w;
      for (var it = 0; it < 5; it++) {
        var yq = yawA + wrap(yawT - yawA) * ww, pq = pitchA + (pitchT - pitchA) * ww;
        var rx = wrap(at2(hy, hx) - yq), fwd = hh * Math.cos(rx), ok = fwd > 0.3;
        if (ok) { var nx = Math.tan(-rx) / tanW, ny = Math.tan(at2(hz, fwd) - pq) / tanH; ok = Math.abs(nx) <= (aspect() > 2 ? 0.8 : 0.9) && ny >= -0.68; }   // (margen: la cámara real va algo por detrás del objetivo)
        if (it === 0 && ok) break;
        if (ok) lo = ww; else hi = ww;
        ww = (lo + hi) / 2;
        if (it === 4) ww = lo;
      }
      w = ww;
    }
    K.ftWe = w;
    var yw = yawA + wrap(yawT - yawA) * w, pt = pitchA + (pitchT - pitchA) * w, cp = Math.cos(pt);
    A.x = D.x + Math.cos(yw) * cp * 10; A.y = D.y + Math.sin(yw) * cp * 10; A.z = D.z + Math.sin(pt) * 10;
    K.fovWant -= 3.5 * w * (comfort() ? 0 : 1);
  }
  /* MOMENTO DE RED Y BLOQUEO (CAM-17): desde que un equipo coloca (toque 2, balón en su campo cerca de la red) hasta 0,35 s después
   * del bloqueo (o del remate que pasa sin bloqueo), la cámara de juego se cierra sobre la red: FOV -12° (remate propio, -4°), la
   * acción de la red (manos y balón) en el tercio de arriba y, con el jugador controlado bloqueando (netK), baja a ~2,85 m y se
   * abre en diagonal desde nuestro campo (sin la silla del árbitro). Sale en 0,5 s. Giro combinado <= 40°/s mientras dura. */
  function blockMoment(g) {
    if (g.mode !== 'rally' || !g.ctrl || FT.on) return 0;   // (el seguimiento del remate propio, CAM-08, manda)
    var b = g.ball, tn = g.time;
    if (tn - K.blkEvT < 0.35) return 1;
    // (el remate que pasa sin bloqueo y viene hacia nuestro campo: se suelta ya, la defensa necesita el plano abierto)
    if (g.lastKind === 'spike' && tn - K.spkT < 0.32 && Math.abs(b.x) < 2.6 && K.blkEvT < K.spkT && !(g.lastTeam === 1 && b.x > 0.3)) return 1;
    if (g.touches === 2 && g.lastKind === 'set' && ((g.touchTeam === 1 && b.x < 0 && b.x > -5) || (g.touchTeam === 0 && b.x > 0 && b.x < 5))) return 1;
    return 0;
  }
  /** Plano de juego genérico: detrás del sujeto, mirando hacia la red. */
  function gameplayShot(g, c) {
    var dt = K.dt, b = g.ball, ahead = b.x < S.x + c.back - 1.2;   // balón por delante de la cámara
    var back = c.back, h = (ctx.isMobile && c.hMob) ? c.hMob : c.h, p = g.ctrl, calm = comfort();
    // EN LA RED: el jugador controlado pegado a la red con el rival construyendo (o recién bloqueado).
    // Se mide antes de colocar la cámara porque cambia la distancia y la altura (entra en ~0,7 s).
    var netW = 0;
    if (p && g.mode === 'rally') {
      var nearNet = smooth01((2.4 - S.x) / 1.4);                    // 1 a < 1 m de la red, 0 a > 2,4 m
      var threat = (b.x < 0.4 && g.touchTeam === 1) || (p.lastAction === 'block' && p.actionT < 0.9) ? 1 : 0;
      netW = nearNet * threat;
    }
    if (dt > 0) K.netK += (netW - K.netK) * mn(1, dt * (netW > K.netK ? 2.6 : 1.4));
    else K.netK = netW;
    // (CAM-17) momento de red y bloqueo: entra en ~0,3 s, sale en 0,5 s
    var bkT = c.wide ? blockMoment(g) : 0;
    if (dt > 0) K.blkU = bkT > K.blkU ? mn(1, K.blkU + dt / 0.3) : mx(0, K.blkU - dt / ((touchUI() || ctx.isMobile) ? 0.3 : 0.5)); else K.blkU = bkT;
    var bkW = smooth01(K.blkU) * (calm ? 0.6 : 1) * (1 - K.ftW), bkN = bkW * smooth01((K.netK - 0.35) / 0.4);
    // (pantalla pequeña: la lente no se toca —CAM-11, sin bombeo—; se acerca la cámara: travelling hacia la red)
    var smallBk = touchUI() || !!ctx.isMobile;
    if (c.rise && ahead) {
      // balón alto (colocación en el aire): la cámara se abre para no perderlo y se cierra al bajar
      // (en modo confort solo se abre: sin subir, para no cabecear)
      var hi = smooth01((b.z - 3.0) / 2.6);
      // (pantalla pequeña: se aleja y sube más: cabe la colocación sin abrir el FOV, CAM-11)
      var smR = touchUI() || ctx.isMobile;
      back += c.rise * hi * (calm ? 0.7 : 1) * (smR ? 1.45 : 1); h += (calm ? 0 : smR ? 0.6 : 0.25) * hi;
    }
    if (ctx.isMobile) { back *= 0.94; }
    // PANTALLA PEQUEÑA (táctil / móvil, CAM-11): la cámara se aleja lo que pida la trayectoria del último toque (calculado UNA vez por
    // toque, ver touchFitPlan) para que balón y jugador quepan sin abrir el FOV; el FOV de ayuda queda para lo que no dé esto
    if (dt > 0) { K.sdT = 0.45; K.tfBack += (K.tfBackT - K.tfBack) * mn(1, dt * (K.tfBackT > K.tfBack ? 2.4 : 0.9)); } else K.tfBack = K.tfBackT;
    if (K.tfBack > 0.001 && c.wide && c !== SHOTS.attack) { back += K.tfBack; h += 0.22 * K.tfBack; }
    // DEFENSA (CAM-13): el rival construye su ataque: la cámara se acerca y se cierra (FOV -7°) para que el rematador previsto se
    // lea grande; el cabeceo sube hacia él (ver más abajo) sin perder la cabeza de nuestro defensor. Se suelta en 0,4 s en el remate.
    var dW = defPushW(g, c);
    var dolly = dW > 0.001 ? 2.5 * dW * (calm ? 0.6 : 1) : 0;
    if (dolly > 0) { back -= dolly; h -= 0.5 * dW; }
    // REMATE PROPIO EN EL AIRE: la cámara sube ~0,7 m (y deja de subir con el salto) y se abre más de lado: el
    // cuerpo del rematador queda por debajo y a un lado del balón, las manos del bloqueo y el campo abierto
    // (entra en ~0,25 s; sale algo más despacio)
    var airW = (c.side && p && p.z > 0.12) ? 1 : 0;
    if (dt > 0) K.airK += (airW - K.airK) * mn(1, dt * (airW > K.airK ? 4 : 2.2)); else K.airK = airW;
    if (K.airK > 0.001) { h += 0.7 * K.airK * (calm ? 0.5 : 1); back -= 0.35 * K.airK; }
    // en la red: más cerca y no tan alta (a 8-9 m y 6 m de altura la grada se comía medio cuadro)
    if (K.netK > 0.001) { back += (mn(back, 6.2) - back) * K.netK; h += (mn(h + 0.2, 4.5) - h) * K.netK; }
    // (CAM-17: bloqueando tú, plano bajo y cerrado: 2,85 m, a ~5 m)
    if (bkN > 0.001) { back += (mn(back, 5.6) - back) * bkN; h += (2.8 - h) * bkN; }
    if (smallBk && bkW > 0.001 && c !== SHOTS.attack) { var bkD = 4.8 * bkW * (1 - bkN) + 1.2 * bkN; back = mx(back - bkD, mn(back, 2.7)); h -= 0.7 * bkW * (1 - bkN); }
    // posición: detrás (+x, equipo humano en x>0), algo hacia el centro en y
    var dx = S.x + back + lead.x, over = 0;
    // la cámara se queda algo por detrás del compañero si está justo detrás del jugador (el cambio de
    // control no la deja encima del nuevo). Limitado a 2,2 m y sin efecto en la red: ahí manda el encuadre
    // del bloqueo y el cambio al defensor lo resuelve el deslizamiento (ver update/framing).
    if (c.both && p) {
      var mate = mateOf(g), minX = mate.x + c.both, wB = 1 - K.netK;
      if (dx < minX && wB > 0) { var push = mn(2.2, (minX - dx) * 0.85) * wB; dx += push; h += push * 0.15; }
    }
    // (defensa que se acerca: nunca por delante de ~3,6 m detrás del compañero que está más atrás que nosotros: en el remate el
    // control puede pasar a él y quedaría debajo de la cámara. Solo recorta el acercamiento, no aleja más que sin él)
    if (dolly > 0 && p) { var mtB = mateOf(g); if (mtB.x > S.x - 0.5) dx = mx(dx, mn(dx + dolly, mtB.x + (aspect() > 2 ? 5.0 : 4.2))); }
    if (dx > 14.4) { over = dx - 14.4; dx = 14.4; }       // no meterse en el fondo / vallas
    D.x = dx;
    // (saque en táctil: el sacador más centrado; abajo a la izquierda está el joystick y a la derecha SACAR)
    D.y = mn(mx((S.y + lead.y) * c.lat + c.off * (c.fit && touchUI() ? 0.35 : 1), -8.5), 8.5);
    // que el compañero no tape al jugador: si está entre la cámara y él, la cámara se aparta de lado
    var want = 0;
    if (g.ctrl) {
      var m2 = mateOf(g);
      var lx = S.x - D.x, ly = S.y - D.y, ll = hyp(lx, ly);
      if (ll > 0.5) {
        var t = ((m2.x - D.x) * lx + (m2.y - D.y) * ly) / (ll * ll);
        if (t > 0.05 && t < 0.97) {
          var side = ((m2.x - D.x) * ly - (m2.y - D.y) * lx) / ll;   // distancia (con signo) del compañero a la línea
          var gap = 0.9 - Math.abs(side);
          if (gap > 0) want = (side >= 0 ? -1 : 1) * gap * 1.8 * smooth01((t - 0.05) / 0.2);
        }
      }
    }
    if (dt > 0) K.occl += (want - K.occl) * mn(1, dt * 3); else K.occl = want;   // snap: ya apartada
    // desplazamiento perpendicular a la línea de visión (en el suelo, aproximadamente en y)
    D.y = mn(mx(D.y + K.occl, -8.5), 8.5);
    // BLOQUEO EN LA RED: el cuerpo del jugador controlado taparía al atacante. La cámara se aparta
    // hacia el lado del balón: se ve al rematador por encima del hombro y el bloqueador queda a un lado.
    if (K.netK > 0.001) {
      // lado: hacia donde está el balón respecto al jugador; si está justo delante, hacia el centro de la pista
      var dyb = mn(mx(b.y, -5), 5) - S.y, sideW = Math.abs(dyb) > 0.35 ? (dyb > 0 ? 1 : -1) : (S.y > 0 ? -1 : 1);
      // (CAM-17: en el plano bajo del bloqueo, la diagonal desde el lado de la mesa: la silla del 1r árbitro, en y = -6,1, queda fuera)
      if (bkN > 0.3) sideW = 1;
      K.netSide += (sideW - K.netSide) * mn(1, dt > 0 ? dt * 2.2 : 1);
      D.y = mn(mx(D.y + K.netSide * (1.25 * K.netK + 0.9 * bkN), -8.5), 8.5);   // (CAM-17: más en diagonal a lo largo de la red)
    }
    // ATAQUE: por encima del hombro, hacia el lado en que el bloqueador rival está desplazado respecto al
    // rematador. Desde ahí, la línea cámara->rematador sale al otro lado y el bloqueador (y el campo abierto)
    // se ven durante el salto en vez de quedar tapados por la espalda. (Con la regla "lado contrario al
    // balón", como el bloqueador se pone delante del balón, quedaba justo detrás del rematador.)
    if (c.side && p) {
      var rt = g.teams[1], blk = rt[0];   // el rival más cerca de la red (en empate, el último: como el r0/r1 de antes)
      for (var rb = 1; rb < rt.length; rb++) if (Math.abs(rt[rb].x) <= Math.abs(blk.x)) blk = rt[rb];
      var dyk = blk.y - S.y, sideA;
      if (Math.abs(blk.x) < 3 && Math.abs(dyk) > 0.25) {
        sideA = dyk > 0 ? 1 : -1;
        if (sideA * K.atkSide < 0 && Math.abs(dyk) < 0.6 && dt > 0) sideA = K.atkSide > 0 ? 1 : -1;   // histéresis: sin bandazos laterales
      }
      else if (Math.abs(S.y) > 1.2) sideA = S.y > 0 ? -1 : 1;     // bloqueador en línea: hacia el centro (campo abierto)
      else { var dya = mn(mx(b.y, -5), 5) - S.y; sideA = Math.abs(dya) > 0.3 ? (dya > 0 ? -1 : 1) : (S.y > 0 ? -1 : 1); }
      K.atkSide += (sideA - K.atkSide) * mn(1, dt > 0 ? dt * 1.8 : 1);
      D.y = mn(mx(D.y + K.atkSide * c.side * (1 + 0.35 * K.airK) * (calm ? 0.6 : 1), -8.5), 8.5);
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
            var sdm = ((mo.x - D.x) * ly2 - (mo.y - D.y) * lx2) / sq(l2);   // lado del compañero respecto a la línea
            var gapm = 1.0 - Math.abs(sdm);
            if (gapm > 0) mw = mn(mx(gapm / mx(0.25, 1 - tm), 0), 2.2) * (sdm >= 0 ? -1 : 1) * (calm ? 0.6 : 1);
          }
        }
      }
    }
    if (dt > 0) K.mOcc += (mw - K.mOcc) * mn(1, dt * (Math.abs(mw) > Math.abs(K.mOcc) ? 3.2 : 1.6)); else K.mOcc = mw;
    if (Math.abs(K.mOcc) > 0.001) {
      // (K.mOcc > 0: hacia la izquierda de la línea cámara->balón, vista desde arriba; sdm > 0 = compañero a la derecha)
      var llx = (b.x - D.x), lly = (b.y - D.y), lln = hyp(llx, lly) || 1;
      D.x += (lly / lln) * K.mOcc; D.y = mn(mx(D.y - (llx / lln) * K.mOcc, -8.5), 8.5);
    }
    // compañero pegado a la cámara (salía cortado y enorme en una esquina): la cámara se aparta en planta
    // hasta ~2,6 m de él (en el remate, sobre todo, el colocador puede quedar detrás).
    // Empujón ACOTADO: unit(q) · max(0, 2,6 − |q|) · w, con w = peso suavizado 0..1. (Antes el suavizado era un
    // MULTIPLICADOR del vector q: tras un corte, un peso viejo de ~7 por un q nuevo de 10 m mandaba la cámara a x = 66 m,
    // fuera del pabellón, en 8 de 25 vueltas al saque en el móvil.)
    if (p) {
      var mq = mateOf(g), qx = D.x - mq.x, qy = D.y - mq.y, ql = hyp(qx, qy), nearW = ql < 2.6 ? 1 : 0;
      if (dt > 0) K.nearK += (nearW - K.nearK) * mn(1, dt * 4); else K.nearK = nearW;
      if (K.nearK > 0.001 && ql > 0.01 && ql < 2.6) {
        var pushQ = (2.6 - ql) * mn(mx(K.nearK, 0), 1) / ql;
        D.x += qx * pushQ; D.y = mn(mx(D.y + qy * pushQ, -8.5), 8.5);
      }
    }
    var high = ahead ? mn(mx((b.z - 4) * 0.12, 0), 0.55) * (1 - 0.7 * K.netK) : 0; // balón muy alto: sube un poco
    high += mn(0.8, Math.abs(K.mOcc) * 0.45);
    D.z = h + S.z * c.zf * (1 - 0.6 * K.airK) + over * 0.32 + high;
    if (bkN > 0.001) D.z += (mn(D.z, 3.0) - D.z) * bkN;   // (CAM-17: plano bajo del bloqueo, 2,6-3,0 m)
    // táctil: compañero en primer plano a medias por abajo -> cámara algo más alta (ver framing; vuelve sola)
    if (dt > 0) K.mateUp += (K.mateUpWant - K.mateUp) * mn(1, dt * 2.5); else K.mateUp = K.mateUpWant;
    if (K.mateUp > 0.001) D.z += K.mateUp;
    // punto de mira en el suelo hacia la red (define el rumbo / yaw)
    var ax = S.x - c.aimX, ay = S.y * c.aimLat;
    if (c.ball > 0 && ahead) ay += (mn(mx(b.y, -6), 6) - ay) * c.ball;
    // saque rival: la mira se va hacia el sacador (y el FOV del plano es más cerrado) para leer el saque
    if (c.server && g.server && g.server.team === 1) ay += (mn(mx(g.server.y, -5), 5) - ay) * c.server;
    var yaw = at2(ay - D.y, ax - D.x);
    // cabeceo: pies del sujeto a c.k (NDC) -> jugador en el tercio inferior
    F.x = S.x; F.y = S.y; F.z = S.z;
    var cy = Math.cos(yaw), syw = Math.sin(yaw);
    var fd = mx(0.5, (F.x - D.x) * cy + (F.y - D.y) * syw);
    // (defensa, CAM-13: hasta 7° más cerrado; en ultrapanorámica el mínimo de 52° de vertical manda)
    // (táctil: +3° de base en el peloteo: la ayuda de FOV hace falta menos veces, CAM-11)
    var fovB = fovFor(c.fov + (c.wide && touchUI() ? 3 : c === SHOTS.serveThem && touchUI() ? 6 : 0) - (c.wide ? 8 * K.defF * (calm ? 0.6 : 1) : 0), 0, 0, c.wide);
    // (CAM-17: cerrado sobre la red; el mínimo de 52° de vertical de CAM-12 no hace falta: el balón está a la altura de las manos)
    if (bkW > 0.001 && !smallBk && c !== SHOTS.attack) { var fBk = fovFor(c.fov - 16 + 8 * bkN, 27, 0, aspect() > 2);   /* (21:9: el mínimo de 52° de vertical de CAM-12 se queda) */ fovB += (mn(fovB, fBk) - fovB) * bkW; }
    var tanH = Math.tan(fovB * DEG / 2);
    var aF = at2(F.z - D.z, fd);
    // táctil: el jugador más arriba (pies a ~-0,40 NDC en vez de -0,52): debajo están los pulgares
    var pitch = aF - Math.atan((touchUI() && !c.fit ? c.k + 0.12 : c.k) * tanH);
    // LA PISTA MANDA: la línea de fondo rival no baja de c.court (NDC). Así la grada y el techo nunca se
    // comen más de ~40 % del cuadro (antes, en la red, llegaban al 55 %). Los pies no suben de -0,12.
    if (c.court && cy < -0.25) {
      var aFar = at2(-D.z, mx(2, (-9 - D.x) / cy));
      var pc = aFar - Math.atan(c.court * tanH);
      if (pc < pitch) pitch = mx(pc, aF + Math.atan(0.12 * tanH));
    }
    // anticipación del cambio: el defensor (compañero de atrás) entra por abajo, pies a ~-0,8 NDC
    if (K.antW > 0.01 && p && g.touchTeam === 1) {
      var mt = mateOf(g), fdm = (mt.x - D.x) * cy + (mt.y - D.y) * syw;
      if (fdm > 0.8) {
        var pm = at2(-D.z, fdm) + Math.atan(0.8 * tanH);
        if (pm < pitch) pitch += (pm - pitch) * mn(mx(K.antW / 0.5, 0), 1);
      }
    }
    // DEFENSA (CAM-13): el cabeceo sube hacia el rematador previsto (pecho a ~+0,05 NDC) sin que la cabeza de nuestro defensor
    // baje de -0,8 NDC (táctil: -0,45, por encima de los pulgares). Solo sube: si el plano ya lo encuadra más arriba, se deja.
    if (dW > 0.001 && p && DEF.att) {
      var at = DEF.att, fdA = (at.x - D.x) * cy + (at.y - D.y) * syw;
      if (fdA > 2) {
        var pAtt = at2(at.z + 1.5 - D.z, fdA) - Math.atan(0.05 * tanH);
        // (ultrapanorámica sin táctil: la CADERA a >= -0,9, CAM-12 la quiere siempre en cuadro)
        var uw = aspect() > 2 && !touchUI(), hdN = touchUI() ? -0.45 : uw ? -0.9 : -0.8;
        var pHead = at2(p.z + (uw ? 0.95 : 1.75) - D.z, mx(0.5, fd)) - Math.atan(hdN * tanH);
        var pUp = mn(pAtt, pHead);
        // (y la del compañero si está delante de la cámara: en el remate el control puede pasar a él, y estaba saliendo por abajo)
        var mtD = mateOf(g), fdM = (mtD.x - D.x) * cy + (mtD.y - D.y) * syw;
        if (fdM > 1) pUp = mn(pUp, at2(mtD.z + (uw ? 0.95 : 1.75) - D.z, fdM) - Math.atan((touchUI() ? -0.55 : uw ? -0.92 : -0.85) * tanH));
        if (pUp > pitch) pitch += (pUp - pitch) * dW;
      }
    }
    // (CAM-17) la acción de la red (balón y manos, ~2,8 m sobre la red a la altura del balón) en el tercio de arriba (+0,3 NDC), sin que la
    // cabeza del jugador controlado (ni la del compañero delante de la cámara) baje de -0,85 NDC (táctil -0,5; 21:9 la cadera a -0,9)
    if (bkW > 0.001 && p) {
      var qx = mn(mx(b.x, -1.2), 1.2), qy = mn(mx(b.y, -4.5), 4.5), fdQ = (qx - D.x) * cy + (qy - D.y) * syw;
      if (fdQ > 2) {
        var pAct = at2(2.8 - D.z, fdQ) - Math.atan(0.3 * tanH);
        // (y el balón, con su radio, por debajo de 0,66 NDC: las manos del bloqueo y el balón en el tercio de arriba, nunca cortados)
        var fdBb = (b.x - D.x) * cy + (b.y - D.y) * syw; if (fdBb > 1.5) pAct = mx(pAct, at2(b.z + 0.3 - D.z, fdBb) - Math.atan(0.66 * tanH));
        var uwB = aspect() > 2 && !touchUI(), hdB = touchUI() ? -0.5 : uwB ? -0.9 : -0.85;
        var pLim = at2(p.z + (uwB ? 0.95 : 1.75) - D.z, mx(0.5, fd)) - Math.atan(hdB * tanH);
        var mtB2 = mateOf(g), fdB2 = (mtB2.x - D.x) * cy + (mtB2.y - D.y) * syw;
        if (fdB2 > 1) pLim = mn(pLim, at2(mtB2.z + (uwB ? 0.95 : 1.75) - D.z, fdB2) - Math.atan((touchUI() ? -0.55 : uwB ? -0.92 : -0.88) * tanH));
        var pB = mn(pAct, pLim);
        pitch += (pB - pitch) * bkW;
      }
    }
    K.fovWant = fovB;
    if (c.fit && p) { K.fsFd = fd; K.fsCy = cy; K.fsSy = syw; fitServe(g, c); }
    if (c.fit && p) pitch = fitOut.p;
    pitch = mn(mx(pitch, -0.6), 0.35);
    var cp = Math.cos(pitch);
    A.x = D.x + cy * cp * 10; A.y = D.y + syw * cp * 10; A.z = D.z + Math.sin(pitch) * 10;
    if (K.ftW > 0.001) ftApply(tanH);   // (seguimiento del remate hasta el bote, CAM-08)
  }

  /** SAQUE PROPIO: cabeceo y FOV ajustados para que el campo rival (objetivo del saque) se vea grande.
   *  Arriba manda la línea de fondo rival (a fit.top NDC) o, si pide más, la cumbre del lanzamiento (prevista antes
   *  con el balón en el aire: la prevista; el FOV "respira" ~6° durante el lanzamiento en salto) por debajo de fit.ball. Abajo, la
   *  cadera del sacador a fit.hip. Deja el resultado en fitOut.p (cabeceo) y en K.fovWant. */
  function fitServe(g, c) {
    var fd = K.fsFd, cy = K.fsCy, syw = K.fsSy, b = g.ball, tch = touchUI(), mob = !!ctx.isMobile;
    // pantalla baja (móvil, aunque se juegue con mando y el overlay esté oculto, o ventana < 480 px de alto): el mismo
    // encuadre que en táctil. Con el de escritorio el pecho quedaba a -0,86 NDC y la cabeza del sacador salía cortada
    var low = tch || mob || (ctx.height || 720) < 480;
    var nTop = c.fit.top + (low ? 0.07 : 0), nBall = c.fit.ball - (low ? 0.1 : 0);
    // con el balón lanzado manda el sacador entero (cintura) y el balón: es el momento de medir el golpe
    var tossing = g.serveState === 'toss' && !b.held, lowZ = tossing ? 0.9 : c.fit.lowZ;
    // (táctil / pantalla baja: el sacador algo más arriba, por encima de la franja de los pulgares y del aviso de SACAR)
    var nHip = tossing ? (low ? -0.7 : -0.82) : c.fit.low + (low ? 0.18 : 0);
    var fdT = (-9 - D.x) / mn(-0.2, cy);
    var aT = at2(-D.z, mx(4, fdT)), aB = at2(S.z + lowZ - D.z, fd);
    var r = fit2(aT, nTop, aB, nHip), aTop = aT, nT = nTop;
    var G = (VB.C && VB.C.G) || 9.81, bx, by, bz;
    if (tossing) {
      var up = mx(0, b.vz) / G;
      bx = b.x + b.vx * up; by = b.y + b.vy * up; bz = b.z + mx(0, b.vz) * up * 0.5;
    } else { bx = b.x; by = b.y; bz = b.z; }
    var fdA = (bx - D.x) * cy + (by - D.y) * syw;
    if (fdA > 0.8) {
      var aA = at2(bz - D.z, fdA);
      if (Math.tan(aA - r.p) > nBall * r.t) { var pT = r.p, tT = r.t; r = fit2(aA, nBall, aB, nHip); aTop = aA; nT = nBall; if (r.t < tT) { r.p = pT; r.t = tT; } }
    }
    var fv = 2 * Math.atan(r.t) / DEG, fMax = fovFor(56), fMin = fovFor(30, 25, 30);
    if (fv > fMax) { fv = fMax; r.p = aTop - Math.atan(nT * Math.tan(fv * DEG / 2)); }          // arriba manda (el balón)
    else if (fv < fMin) { fv = fMin; r.p = aB - Math.atan(nHip * Math.tan(fv * DEG / 2)); }
    K.fovWant = fv; fitLow.z = lowZ; fitLow.n = nHip;   // (sin objeto nuevo por frame)
  }

  /* COMPOSICIÓN DEL SAQUE PROPIO (CAM-15). Por encima del hombro: la cámara ~3,4 m de alto (1,5-1,7 m por encima de los
   * hombros), 3,8 m detrás y a un lado del sacador, que queda en el tercio derecho (~+0,35 NDC; táctil +0,30, lejos de los
   * botones) entero de rodillas para arriba: cabeza, hombros y brazo de golpeo siempre en cuadro. Arriba manda la línea de fondo
   * rival (>= 0,55 NDC: el campo objetivo grande). El balón nunca a < 3,6 m de la lente (antes la cámara a 5,4 m quedaba en el
   * camino del lanzamiento en salto: balón de ~140 px a 1080p). En el lanzamiento en salto la cámara sube 0,75 m y se aleja 0,9 m
   * (grúa suave) y el cabeceo acompaña la cumbre; al bajar el balón vuelve la línea de fondo. El sitio lateral y el sesgo del sacador
   * se eligen entre 21 candidatos: sin oficiales (árbitros, jueces de línea, mesa) cortados por un borde, el campo rival centrado,
   * con histéresis (sin saltos). Sustituye a la cámara alta (5,4 m) con el sacador cortado por el pecho. */
  // oficiales [x, y, z0, z1, radio] (sim): silla del 1r árbitro, 2º árbitro, mesa con anotadores, jueces de línea (con bandera alta)
  var OFFI = [[0, -6.12, 0, 3.2, 0.55], [0, 6.05, 0, 1.9, 0.42], [-0.6, 8.6, 0, 1.4, 0.42], [0.6, 8.6, 0, 1.4, 0.42], [10.4, -5.9, 0, 2.3, 0.42], [-10.4, 5.9, 0, 2.3, 0.42]];
  /** Sitios reales de los oficiales (arena los coloca al construir; el 2º árbitro se mueve junto al poste): se leen al empezar cada saque propio. */
  function readOfficials() {
    var A = VB.Arena, d = null;
    try { d = A && A._dbg ? A._dbg() : null; } catch (e) { d = null; }
    if (!d || !d.refs || !d.judges) return;
    var L = d.refs.concat(d.judges), n = 0;
    for (var i = 0; i < L.length && n < OFFI.length; i++) {
      var q = L[i] && L[i].sim; if (!q) continue;
      var o = OFFI[n++], r1 = q.z > 0.5;   // (el 1r árbitro, subido en su silla: toda la silla cuenta)
      o[0] = q.x; o[1] = q.y; o[2] = r1 ? 0 : q.z; o[3] = q.z + (r1 ? 1.85 : Math.abs(q.y) > 8 ? 1.35 : L[i].lines ? 2.25 : 1.85); o[4] = r1 ? 0.55 : 0.4;
    }
  }
  var SVC = { fullToss: false, pwN: 0, pwX: 0, pwY: 0, pwLow: false, pwAsp: 0, nEval: 0, nOff: 0, rr: 0, wantFull: false, fullF: -1, fullLow: false, fullAsp: 0, lat: 1.2, sx: 0.36, idx: -1, pen: 0.5, off: 0.5, cc: 0.5, yaw: 0.5, p: 0.5, t: 0.4, cx: 0.5, cy: 0.5, cz: 0.5, liftU: 0.5, dB: 0.5, fk: 0.99, inMask: 0 };
  SVC.idx = -1;
  /** Penalización (NDC) por oficiales cortados por un borde desde la cámara (cx, cy, cz) con giro/cabeceo/tan(fov/2) dados (SVC.*). */
  function offStraddle() {
    var pen = 0, cx = SVC.cx, cy = SVC.cy, cz = SVC.cz, yaw = SVC.yaw, pitch = SVC.p, tanH = SVC.t, tanW = tanH * aspect();
    SVC.inMask = 0; SVC.nOff++;
    // base de la cámara (sim): adelante f, derecha r, arriba u — proyección exacta (con el cabeceo, lo de abajo se acerca al centro)
    var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var fx = cp * cyw, fy = cp * syw, fz = sp, rx = syw, ry = -cyw, ux = -sp * cyw, uy = -sp * syw, uz = cp;
    var M = 1.015, E = 0.985;
    var nWE = sq(1 + E * E * tanW * tanW), nHE = sq(1 + E * E * tanH * tanH), nWM = sq(1 + M * M * tanW * tanW), nHM = sq(1 + M * M * tanH * tanH);
    for (var i = 0; i < OFFI.length; i++) {
      var o = OFFI[i], R = o[4];
      // atajo exacto con la esfera que envuelve los 16 puntos (UI-13): si está entera dentro de la banda interior o entera fuera de
      // un borde, el resultado es el mismo que con la caja y nos ahorramos las 16 proyecciones (casi siempre es así)
      var hz = (o[3] - o[2]) * 0.5, rs = sq(R * R + hz * hz), qx = o[0] - cx, qy = o[1] - cy, qz = o[2] + hz - cz;
      var zq = qx * fx + qy * fy + qz * fz, xq = qx * rx + qy * ry, yq = qx * ux + qy * uy + qz * uz, axq = Math.abs(xq), ayq = Math.abs(yq);
      if (axq - M * tanW * zq >= rs * nWM || ayq - M * tanH * zq >= rs * nHM) continue;     // fuera del todo (o detrás)
      if (zq - rs >= 0.3 && E * tanW * zq - axq >= rs * nWE && E * tanH * zq - ayq >= rs * nHE) { SVC.inMask |= 1 << i; continue; }   // dentro del todo
      // (8 puntos en un círculo de radio r a las dos alturas: la misma caja que mide tools/camtest.js)
      var x0 = 9, x1 = -9, y0 = 9, y1 = -9, behind = false;
      for (var k = 0; k < 16; k++) {
        var a = (k >> 1) * 0.7854, ox = o[0] + Math.cos(a) * R, oy = o[1] + Math.sin(a) * R, oz = (k & 1) ? o[3] : o[2];
        var dx = ox - cx, dy = oy - cy, dz = oz - cz, zc = dx * fx + dy * fy + dz * fz;
        if (zc < 0.3) { behind = true; break; }
        var nx = (dx * rx + dy * ry) / (zc * tanW), ny = (dx * ux + dy * uy + dz * uz) / (zc * tanH);
        if (nx < x0) x0 = nx; if (nx > x1) x1 = nx; if (ny < y0) y0 = ny; if (ny > y1) y1 = ny;
      }
      if (behind) continue;
      // (con margen de 0,015 NDC a cada lado del borde: ni rozándolo por dentro ni asomando por fuera)
      if (x1 < -M || x0 > M || y1 < -M || y0 > M) continue;            // fuera del todo
      if (x0 >= -E && x1 <= E && y0 >= -E && y1 <= E) { SVC.inMask |= 1 << i; continue; }   // dentro del todo
      var inW = mn(x1, 1) - mx(x0, -1), outW = mx(0, -1 - x0) + mx(0, x1 - 1), inH = mn(y1, 1) - mx(y0, -1), outH = mx(0, -1 - y0) + mx(0, y1 - 1);
      pen += 0.1 + mx(0.01, mx(mn(inW, outW), mn(inH, outH)));
    }
    return pen;
  }
  /** PANTALLA BAJA / TÁCTIL: penalización por oficiales ENTEROS en cuadro pero enormes en primer plano (> 30 % del alto) o encima de la
   *  zona del joystick (abajo a la izquierda): en el móvil el juez de línea cercano salía de ~150 px justo detrás del MOVER. Usa la
   *  pose de SVC y la máscara del último offStraddle. */
  function offForeground() {
    var m = SVC.inMask; if (!m) return 0;
    var pen = 0, cx = SVC.cx, cy = SVC.cy, cz = SVC.cz, yaw = SVC.yaw, pitch = SVC.p, tanH = SVC.t, tanW = tanH * aspect();
    var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var fx = cp * cyw, fy = cp * syw, fz = sp, rx = syw, ry = -cyw, ux = -sp * cyw, uy = -sp * syw, uz = cp;
    for (var i = 0; i < OFFI.length; i++) {
      if (!(m & (1 << i))) continue;
      var o = OFFI[i], R = o[4], x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (var k = 0; k < 8; k++) {   // (4 puntos del círculo a las dos alturas: basta para el tamaño)
        var a = (k >> 1) * 1.5708, dx = o[0] + Math.cos(a) * R - cx, dy = o[1] + Math.sin(a) * R - cy, dz = ((k & 1) ? o[3] : o[2]) - cz;
        var zc = mx(0.3, dx * fx + dy * fy + dz * fz), nx = (dx * rx + dy * ry) / (zc * tanW), ny = (dx * ux + dy * uy + dz * uz) / (zc * tanH);
        if (nx < x0) x0 = nx; if (nx > x1) x1 = nx; if (ny < y0) y0 = ny; if (ny > y1) y1 = ny;
      }
      var joy = mx(0, mn(x1, -0.45) - x0) * mx(0, mn(y1, -0.15) - y0);
      if (y1 - y0 > 0.6 || joy > 0.02) pen += 0.06;
    }
    return pen;
  }
  /** Saque en salto: FOV vertical mínimo para que el balón (diámetro 2·BR) no pase de ~76 px a 1080p (CAM-15). 0 si no aplica. */
  function ballFov(cx, cy, cz) {
    var g = ctx.game, b = g && g.ball;
    if (!b || g.serveState !== 'toss' || b.held) return 0;
    // (flotante: <= ~110 px; la lente respira unos grados mientras sube el balón, como un operador que abre con el lanzamiento)
    var d = mx(1, hyp3(b.x - cx, b.y - cy, b.z - cz)), R = (VB.C && VB.C.BR) || 0.21, px = g.serveJump ? 76 : 122;
    return mn(2 * Math.atan(2 * R * 1080 / (px * d) / 2) / DEG, g.serveJump ? 60 : 44);
  }
  /** Resuelve el encuadre del saque desde la cámara (SVC.cx, cy, cz) con el sacador a SVC.sxN NDC: giro (proyección exacta de sus
   *  hombros, con el cabeceo), cabeceo y tan(fov/2) en SVC.yaw/.p/.t. Arriba la línea de fondo rival (o el balón), abajo las rodillas. */
  var SVP = { ax: 0.5, ay: 0.5, az: 0.5, nTop: 0.55, nBot: -0.9, nBall: 0.8, sxN: 0.36, fov: 46.5, k: 1.0, kMin: 0.5, fMin0: 38, fMax0: 46.5 };
  var SVK = [1, 0.88, 0.78, 1.14];
  var SVCP = [], SVCQ = []; for (var sci = 0; sci < 84; sci++) { SVCP.push(0.5); SVCQ.push(0.5); }
  function svcSolve(sv) {
    if (BRK === 'serve') SVP.sxN = -0.6;
    var cx = SVC.cx, cy = SVC.cy, cz = SVC.cz, asp = aspect(), sdx = sv.x - cx, sdy = sv.y - cy;
    var tanW = Math.tan(mn(mx(K.fovWant, 30), 62) * DEG / 2) * asp, yaw = at2(sdy, sdx) + Math.atan(SVP.sxN * tanW), p = 0, t = 0.4;
    for (var it = 0; it < 2; it++) {
      var cyw = Math.cos(yaw), syw = Math.sin(yaw), sfd = mx(1, sdx * cyw + sdy * syw);
      var aT = at2(-cz, mx(4, (-9 - cx) / mn(-0.2, cyw))), aB = at2(sv.z + 0.5 - cz, sfd);
      var r = fit2(aT, SVP.nTop, aB, SVP.nBot), aTop = aT, nT = SVP.nTop;
      p = r.p; t = r.t;
      var bfd = (SVP.ax - cx) * cyw + (SVP.ay - cy) * syw;
      if (bfd > 0.8) {
        var aA = at2(SVP.az - cz, bfd);
        if (Math.tan(aA - p) > SVP.nBall * t) { var r2 = fit2(aA, SVP.nBall, aB, SVP.nBot); p = r2.p; t = r2.t; aTop = aA; nT = SVP.nBall; }
      }
      var fMin = mx(SVP.fMin0, ballFov(cx, cy, cz)), fMax = mx(SVP.fMax0, fMin), fv = 2 * Math.atan(t) / DEG;   // (fovFor fuera del bucle: solo depende del aspecto)
      if (fv > fMax) { t = Math.tan(fMax * DEG / 2); p = aTop - Math.atan(nT * t); }
      else if (fv < fMin) { t = Math.tan(fMin * DEG / 2); p = aTop - Math.atan(nT * t); }
      // (más cerrado a propósito —SVP.k < 1— para dejar fuera a un oficial cortado: arriba sigue mandando lo mismo, las rodillas pueden salir)
      if (SVP.k < 0.999 || SVP.k > 1.001) { var tk = Math.tan(mx(Math.atan(t) * SVP.k, SVP.kMin)); p = aTop - Math.atan(nT * tk); t = tk; }
      tanW = t * asp;
      // corrección del giro con la proyección exacta de los hombros (z + 1,45): con la cámara picada, lo bajo se acerca al centro
      var cp = Math.cos(p), sp = Math.sin(p), dz = sv.z + 1.45 - cz;
      var zc = sdx * cp * cyw + sdy * cp * syw + dz * sp, xc = sdx * syw - sdy * cyw;
      if (zc > 0.5) yaw += Math.atan(SVP.sxN * tanW) - Math.atan(xc / zc);
    }
    SVC.yaw = yaw; SVC.p = p; SVC.t = t;
  }
  /** Puntúa el candidato ci del saque propio (sitio lateral, sesgo del sacador, lente) con los datos del frame en SVE: deja la
   *  penalización de oficiales en SVCP[ci] y la total en SVCQ[ci]. */
  var SVE = { low: false, sv: null, back: 4.3, H: 3.35, XMAX: 15, bx: 0, by: 0, bz: 0, ax: 0, ay: 0, az: 0, tossing: false, sxPref: 0.34, latPref: 1.2, asp: 1.78 };
  function svcEval(ci) {
    SVC.nEval++;
    var sv = SVE.sv, sxPref = SVE.sxPref, XMAX = SVE.XMAX, bx = SVE.bx, by = SVE.by, bz = SVE.bz, ax = SVE.ax, ay = SVE.ay, az = SVE.az;
    var lat = 0.5 + 0.3 * (ci % 7), sxN = sxPref - 0.06 + 0.06 * (((ci / 7) | 0) % 3), fk = SVK[(ci / 21) | 0];
    var cx = mn(sv.x + SVE.back, XMAX), cy = mn(mx(sv.y - lat, -8.4), 8.4), cz = SVE.H;
    // el balón nunca a < 3,6 m de la lente: se aleja (en x) lo que falte
    var dBall = mn(hyp3(bx - cx, by - cy, bz - cz), hyp3(ax - cx, ay - cy, az - cz));
    if (dBall < 3.6) cx = mn(cx + (3.6 - dBall) * 1.15, XMAX);
    SVC.cx = cx; SVC.cy = cy; SVC.cz = cz; SVP.sxN = sxN; SVP.k = fk; svcSolve(sv);
    var offP = offStraddle(), m0 = SVC.inMask, fore = SVE.low ? offForeground() : 0;
    // (y con la grúa del saque en salto, que puede llegar: un oficial que entra o sale del cuadro por el camino quedaría cortado; antes del
    // lanzamiento se mira también esa pose, con el balón en la cumbre del salto, y que ningún oficial cambie de dentro a fuera)
    if (!SVE.tossing && ci % 3 === 0 && fk === 1) {
      var yS = SVC.yaw, pS = SVC.p, tS = SVC.t;
      SVP.ax = sv.x - 0.7; SVP.ay = sv.y; SVP.az = 4.6; SVC.cx = mn(cx + SVLB(SVE.low), XMAX); SVC.cz = cz + 1.4; svcSolve(sv);
      var offL = offStraddle(), m1 = SVC.inMask;
      offP += 0.6 * offL + (m0 !== m1 ? 0.25 : 0);
      SVP.ax = ax; SVP.ay = ay; SVP.az = az; SVC.cx = cx; SVC.cz = cz; SVC.yaw = yS; SVC.p = pS; SVC.t = tS;
    }
    // campo rival centrado: centro del campo rival (-4,5, 0) cerca de -0,05 NDC
    var rel = wrap(at2(-cy, -4.5 - cx) - SVC.yaw), ccN = Math.tan(-rel) / (SVC.t * SVE.asp);
    // (oficial cortado: x12, >= 1,3; oficial entero pero enorme o sobre el joystick en el móvil: 0,72 por cada uno, por debajo de un corte.
    // En pantalla baja la lente normal pesa más —x6—: cerrarla agrandaba al sacador hasta salir cortado por las rodillas y la cabeza)
    var pen = offP * 12 + fore * 12 + Math.abs(ccN + 0.05) * 1.2 + Math.abs(lat - SVE.latPref) * 0.25 + Math.abs(sxN - sxPref) * 2 + Math.abs(1 - fk) * (SVE.low ? 6 : 2.5);
    SVCP[ci] = offP; SVCQ[ci] = pen;
  }
  /** Datos del frame para puntuar candidatos del saque propio (SVE) y límites del ajuste (SVP). */
  function svcSetup(sv, low, c, back, H, XMAX, bx, by, bz, ax, ay, az, tossing) {
    SVP.ax = ax; SVP.ay = ay; SVP.az = az; SVP.nTop = low ? 0.61 : 0.56; SVP.nBot = low ? -0.86 : -0.92; SVP.nBall = low ? 0.74 : 0.8; SVP.fov = c.fov + 10;
    SVP.kMin = 15 * DEG; SVP.fMin0 = fovFor(38, 25, 30); SVP.fMax0 = fovFor(SVP.fov);
    SVE.sv = sv; SVE.back = back; SVE.H = H; SVE.XMAX = XMAX; SVE.bx = bx; SVE.by = by; SVE.bz = bz; SVE.ax = ax; SVE.ay = ay; SVE.az = az;
    SVE.tossing = tossing; SVE.low = low; SVE.sxPref = low ? 0.17 : 0.34; SVE.latPref = 1.2; SVE.asp = aspect();
  }
  /** PASADA DE ANTEMANO (UI-13): mientras se ve el plano del punto (o la presentación) y el próximo saque es nuestro, los 84 candidatos
   *  se puntúan de 12 en 12 con el sacador previsto (sim lo coloca en x = 10,3, y = ±1,5 según g.serverIdx; el saque ya está decidido
   *  al anotarse el punto). Así el corte al saque no hace la búsqueda entera en un solo frame (120-140 ms en el móvil antes). */
  var PWS = { x: 0, y: 0, z: 0, team: 0 };
  /** Distancia de la cámara detrás del sacador (la misma en todas las pantallas; la usan el encuadre, la pasada de antemano y predictServe). */
  function SVBACK() { return 4.3; }
  /** Cuánto se aleja la grúa del saque en salto. */
  function SVLB() { return 0.8; }
  function svcPrewarm(g) {
    if (shot === 'serveUs' || shot === 'menu' || g.demo || g.serving !== 0 || !g.serverIdx || SVC.idx >= 0 && g.mode === 'serve') return;
    var sv;
    if (g.mode === 'serve' && g.serveState === 'ready' && g.server && g.server.team === 0) sv = g.server;
    else if (g.mode === 'point') { sv = PWS; PWS.x = (g.HL || 9) + 1.3; PWS.y = g.serverIdx[0] ? 1.5 : -1.5; PWS.z = 0; }
    else return;
    var low = touchUI() || !!ctx.isTouch || !!ctx.isMobile || (ctx.height || 720) < 480, asp = aspect();
    if (SVC.pwN > 0 && (hyp(sv.x - SVC.pwX, sv.y - SVC.pwY) > 0.05 || SVC.pwLow !== low || Math.abs(SVC.pwAsp - asp) > 0.01)) SVC.pwN = 0;
    if (SVC.pwN >= 84) return;
    if (SVC.pwN === 0) { readOfficials(); SVC.pwX = sv.x; SVC.pwY = sv.y; SVC.pwLow = low; SVC.pwAsp = asp; }
    var H = low ? 3.5 : 3.35, XMAX = mn(15, K.bX - 0.2), b = g.ball, held = g.mode === 'serve';
    var bx = held ? b.x : sv.x - 0.3, by = held ? b.y : sv.y, bz = held ? b.z : 1.05;
    var f0 = K.fovWant, sx0 = SVP.sxN, k0 = SVP.k, ax0 = SVP.ax, ay0 = SVP.ay, az0 = SVP.az;
    K.fovWant = SHOTS.serveUs.fov + 4;   // (la cuenta del giro parte de una lente parecida a la del saque, no de la del punto)
    svcSetup(sv, low, SHOTS.serveUs, SVBACK(), H, XMAX, bx, by, bz, bx, by, bz, false);
    for (var i = 0; i < 12 && SVC.pwN < 84; i++) svcEval(SVC.pwN++);
    K.fovWant = f0; SVP.sxN = sx0; SVP.k = k0; SVP.ax = ax0; SVP.ay = ay0; SVP.az = az0;
  }
  function serveUsComp(g, c) {
    var sv = g.server && g.server.team === 0 ? g.server : g.ctrl; if (!sv) return;
    // (ctx.isTouch y no el overlay: bajo la tarjeta de presentación el overlay aún no se ve y el encuadre planeado debe ser el mismo)
    var b = g.ball, low = touchUI() || !!ctx.isTouch || !!ctx.isMobile || (ctx.height || 720) < 480, asp = aspect(), dt = K.dt;
    var tossing = g.serveState === 'toss' && !b.held, Gc = (VB.C && VB.C.G) || 9.81;
    // grúa del lanzamiento en salto (sube en ~0,45 s; baja con el plano siguiente)
    var liftT = tossing && g.serveJump ? 1 : 0;
    SVC.liftU = dt > 0 ? (liftT > SVC.liftU ? mn(1, SVC.liftU + dt / 0.45) : mx(0, SVC.liftU - dt / 0.6)) : liftT;
    var lift = smooth01(SVC.liftU);
    var back = SVBACK() + SVLB(low) * lift, H = (low ? 3.5 : 3.35) + 1.4 * lift, XMAX = mn(15, K.bX - 0.2);
    // balón que vigilar: en la mano, en el aire o la cumbre prevista del lanzamiento
    var bx = b.x, by = b.y, bz = b.z, ax = bx, ay = by, az = bz;
    if (tossing && b.vz > 0) { var up = b.vz / Gc; ax = b.x + b.vx * up; ay = b.y + b.vy * up; az = b.z + b.vz * up * 0.5; }
    svcSetup(sv, low, c, back, H, XMAX, bx, by, bz, ax, ay, az, tossing);
    var sxPref = SVE.sxPref;
    /* BÚSQUEDA REPARTIDA (UI-13: en el móvil, 84 candidatos por frame —y 24 veces en el asentado del corte— costaban 120-140 ms en el
     * corte punto→saque y 23-25 ms por frame en la espera del saque). Ahora:
     *  - pasada completa solo al empezar el saque (SVC.idx < 0), al asentar un corte o colocar una escena (UNA vez: las vueltas del
     *    asentado la reutilizan) o si cambia la pantalla (aspecto, táctil);
     *  - en la espera (balón en la mano), 12 candidatos por frame en rueda + el actual: todos se repasan en ~7 frames (0,12 s), así que
     *    un sacador que se mueve o el 2º árbitro que se recoloca entran solos;
     *  - al lanzar el balón, otra pasada completa (las cuentas cambian: cumbre del lanzamiento, grúa del salto) y luego 21 por frame
     *    (todos en 4 frames): el cambio de candidato, suavizado, saca a un oficial que la grúa iba a dejar cortado. */
    // (pasada hecha de antemano durante el plano del punto —svcPrewarm— con el mismo sacador y la misma pantalla: se aprovecha y el
    // corte punto→saque no paga las 84 evaluaciones; la rueda las va refrescando con los datos reales desde el frame siguiente)
    var pwOk = SVC.idx < 0 && SVC.pwN >= 84 && hyp(sv.x - SVC.pwX, sv.y - SVC.pwY) < 0.05 && SVC.pwLow === low && Math.abs(SVC.pwAsp - asp) < 0.01;
    SVC.pwN = 0;
    if (pwOk) { SVC.fullF = ctx.frame | 0; SVC.wantFull = false; SVC.fullLow = low; SVC.fullAsp = asp; SVC.rr = 0; }
    if (SVC.idx < 0 && !pwOk) readOfficials();
    var full = !pwOk && (SVC.idx < 0 || SVC.wantFull || SVC.fullLow !== low || Math.abs(SVC.fullAsp - asp) > 0.01 || (tossing && !SVC.fullToss));
    if (full) {
      for (var ci = 0; ci < 84; ci++) svcEval(ci);
      SVC.wantFull = false; SVC.fullToss = tossing; SVC.fullF = ctx.frame | 0; SVC.fullLow = low; SVC.fullAsp = asp; SVC.rr = 0;
    } else if (dt > 0) {
      if (!tossing) SVC.fullToss = false;
      for (var sl = 0, sn = tossing ? 21 : 12; sl < sn; sl++) { svcEval(SVC.rr); SVC.rr = (SVC.rr + 1) % 84; }
      if (SVC.idx >= 0) svcEval(SVC.idx);
    }
    var best = 0, bestPen = SVCQ[0], curPen = SVC.idx >= 0 ? SVCQ[SVC.idx] : 1e9;
    for (var cj = 1; cj < 84; cj++) if (SVCQ[cj] < bestPen) { bestPen = SVCQ[cj]; best = cj; }
    // histéresis: el candidato actual se queda salvo que otro gane por > 0,08
    // (con el balón en el aire solo se cambia para sacar a un oficial que el candidato actual deja cortado —cambiar por gusto a mitad del
    // lanzamiento se ve como un reencuadre—, y en pantalla baja nunca: allí el encuadre del saque ya deja fuera al juez de línea cercano y
    // el cambio lo metía por el camino, cortado por el borde)
    if (SVC.idx < 0 || (full && dt <= 0) || (bestPen < curPen - 0.08 && (!tossing || (!low && SVCP[SVC.idx] > 0)))) SVC.idx = best;
    var ci2 = SVC.idx, lat2 = 0.5 + 0.3 * (ci2 % 7), sx2 = sxPref - 0.06 + 0.06 * (((ci2 / 7) | 0) % 3), fk2 = SVK[(ci2 / 21) | 0];
    // (suavizado de los parámetros elegidos: un cambio de candidato no da un salto)
    if (dt > 0) { var kk = mn(1, dt * 3); SVC.lat += (lat2 - SVC.lat) * kk; SVC.sx += (sx2 - SVC.sx) * kk; SVC.fk += (fk2 - SVC.fk) * kk; } else { SVC.lat = lat2; SVC.sx = sx2; SVC.fk = fk2; }
    // composición final con los parámetros suavizados
    var cxF = mn(sv.x + back, XMAX), cyF = mn(mx(sv.y - SVC.lat, -8.4), 8.4), czF = H;
    var dB2 = mn(hyp3(bx - cxF, by - cyF, bz - czF), hyp3(ax - cxF, ay - cyF, az - czF));
    if (dB2 < 3.6) cxF = mn(cxF + (3.6 - dB2) * 1.15, XMAX);
    SVC.dB = dB2;
    D.x = cxF; D.y = cyF; D.z = czF;
    SVC.cx = cxF; SVC.cy = cyF; SVC.cz = czF; SVP.sxN = SVC.sx; SVP.k = SVC.fk; svcSolve(sv);
    var cpF = Math.cos(SVC.p);
    A.x = D.x + Math.cos(SVC.yaw) * cpF * 10; A.y = D.y + Math.sin(SVC.yaw) * cpF * 10; A.z = D.z + Math.sin(SVC.p) * 10;
    K.fovWant = 2 * Math.atan(SVC.t) / DEG;
    fitOut.p = SVC.p; fitLow.z = 0.5; fitLow.n = SVP.nBot;
    if (DBGX) { DBGX[0] = SVC.idx; DBGX[1] = SVC.lat; DBGX[2] = SVC.sx; DBGX[3] = dB2; DBGX[4] = K.fovWant; DBGX[5] = bestPen; }
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
  // obstáculos fijos [x, y, radio] (coords de sim): postes, silla del 1r árbitro, 2º árbitro, mesa, jueces de línea
  var OBST = [[0, 5.5, 0.25], [0, -5.5, 0.25], [0, -6.12, 0.6], [0, 6.05, 0.35], [-1.2, 8.25, 0.7], [0, 8.25, 0.7], [1.2, 8.25, 0.7],
              [10.4, -5.9, 0.35], [-10.4, 5.9, 0.35]];
  var PF = { lx: 0, ly: 0, vic: null, hero: null, heroIn: false, c0x: 0, c0y: 0, cx: 0, cy: 0, R: 6, ang: 0, fov: 34, z: 1.75,
             cut: false, hold: 0.45, cutDone: true, cutNow: false, dir: 1, w: 0, backCut: true, backLock: false,
             mode: 'vic', how: '', mate: null, both: false, score: 0.5, heroD: 6.5, side: 1, hxo: 0.42 };
  var cutCheck = false;
  function nearestOf(list, x, y, skip) {
    var best = null, bd = 1e9;
    for (var i = 0; i < list.length; i++) { var q = list[i]; if (q === skip) continue; var d = hyp(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
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
  /** Centro del grupo (bote + víctima + héroe si entra) con las posiciones de AHORA. En el plano de HÉROE: el que anotó
   *  (y su compañero si se juntan para celebrarlo). */
  function groupCenter(out) {
    if (PF.mode === 'hero' && PF.hero) {
      var hm = PF.mate && PF.both ? 0.55 : 0;
      visPos(PF.hero, VP); if (hm) visPos(PF.mate, VQ);
      out.x = (VP.x + (hm ? VQ.x * hm : 0)) / (1 + hm); out.y = (VP.y + (hm ? VQ.y * hm : 0)) / (1 + hm); out.z = 0;
      return out;
    }
    var x = PF.lx, y = PF.ly, wsum = 1;
    if (PF.vic) { x += PF.vic.x; y += PF.vic.y; wsum += 1; }
    if (PF.hero && PF.heroIn) { x += PF.hero.x * 0.7; y += PF.hero.y * 0.7; wsum += 0.7; }
    out.x = x / wsum; out.y = y / wsum; out.z = 0;
    return out;
  }
  var GC = V();
  /* ---------------- PLANO DE HÉROE (CAM-02) ----------------
   * Remate, ace, bloqueo, dejada, balón libre ganado y errores del RIVAL (punto nuestro sin mérito del rival): el plano
   * es del que anotó celebrándolo (y de su compañero si se juntan), no del que falló. Cámara baja (1,6 m) en tres cuartos
   * de frente desde el propio campo del héroe, a <= 60° de hacia donde mira, FOV 30-38° y el héroe al 35-55 % del alto;
   * los perdedores, al fondo y más pequeños (<= 60 % de su altura). El plano de VÍCTIMA (el infractor, de frente o de lado,
   * nunca de espaldas) queda solo para los errores propios del equipo humano (fuera, red, dobles, 4 toques, por debajo, 8 s…).
   * Se decide al llegar el punto y se vuelve a calcular en el instante del corte (~0,45 s), con las posiciones y el frente
   * de ese momento (la celebración ya ha empezado a girar al héroe). */
  /** Hacia dónde mira un jugador (rad, coords de sim): el de su celebración si players lo expone, o el del rig. */
  function faceOf(p) {
    var Pl = VB.Players;
    try {
      if (Pl && Pl.faceOf) { var f = Pl.faceOf(p); if (typeof f === 'number' && f === f) return f; }
      var r = Pl && Pl.rigOf ? Pl.rigOf(p) : null;
      if (r && typeof r.yaw === 'number' && r.yaw === r.yaw) return r.yaw;
    } catch (e) { }
    return p.team === 0 ? PI : 0;   // (de cara a la red)
  }
  /** Posición VISUAL de un jugador (sim + desfase visual del rig: la convergencia del choque de manos de PLY-07 y la plancha
   *  mueven al atleta sin mover al jugador de sim). Escribe en out. */
  var VP = V(), VQ = V();
  function visPos(p, out) {
    var r = VB.Players && VB.Players.rigOf ? VB.Players.rigOf(p) : null;
    out.x = p.x + (r && r.offX === r.offX ? r.offX || 0 : 0); out.y = p.y + (r && r.offY === r.offY ? r.offY || 0 : 0); out.z = p.z;
    return out;
  }
  function heightOf(p) { var r = VB.Players && VB.Players.rigOf ? VB.Players.rigOf(p) : null; return 1.9 * (r && r.scale > 0.5 ? r.scale : 1); }
  var lastTouch = [null, null];   // último jugador de cada equipo que tocó el balón en este peloteo (hit / block)
  function pickHero(g, w, how) {
    if (how === 'ace' && g.server && g.server.team === w) return g.server;
    if (lastTouch[w]) return lastTouch[w];
    if (g.lastTeam === w && g.lastPlayer) return g.lastPlayer;
    // el rival falló sin que tocáramos (saque fuera, red…): el nuestro más cerca del balón (y su compañero entra)
    return nearestOf(g.teams[w], g.ball.x, g.ball.y, null);
  }
  // composición: el héroe en un tercio (NDC x = ±HERO_X) con aire hacia donde mira; el centro queda para el rótulo
  var HERO_X = 0.42, HERO_XW = 0.55;
  var HP = { fit: 0.5, court: 0.5, face: 0.5, obst: 0.5, ply: 0.5, lose: 0.5, net: 0.5, ball: 0.5, cA: 0.5, frac: 0.5 }, HPB = { fit: 0.5, court: 0.5, face: 0.5, obst: 0.5, ply: 0.5, lose: 0.5, net: 0.5, ball: 0.5, cA: 0.5, frac: 0.5 };
  var HPOS = V(), MPOS = V(), QPOS = V();
  /* ACUERDO CON PLAYERS (plano de héroe): la cámara elige dónde ponerse y PUBLICA la coreografía que mejor se filma:
   * el héroe se queda en su sitio y se gira hacia la cámara (abierto ~35° hacia su compañero), y el compañero llega a un
   * sitio a su lado y algo DETRÁS (0,8 m más lejos de la cámara, 0,9 m de lado, hacia el centro del cuadro: el héroe mira
   * hacia dentro del cuadro), abierto también a la cámara. Así el que anota es la figura más grande y se le ve la cara, y
   * el choque de manos ocurre de cara al público. Sin el acuerdo (cara a cara a 0,85 m), las dos cosas son incompatibles:
   * desde cualquier sitio que le vea la cara al héroe, el compañero queda igual de grande o más.
   * players lo lee con VB.CameraRig.heroShot() (en cvStart, >= 0,12 s después del punto; el plan se hace en el frame del
   * punto) y lo anuncia con VB.Players.heroShotAware = true. Sin ese aviso, la cámara sigue con la convergencia antigua. */
  var HS = { on: false, heroId: -1, mateId: -1, team: -1, camX: 0.5, camY: 0.5, hx: 0.5, hy: 0.5, heroYaw: 0.5, mx: 0.5, my: 0.5, mateYaw: 0.5, conv: false, t: 0.5 };
  function hsAware() { return !!(VB.Players && VB.Players.heroShotAware); }
  var HS_BACK = 0.8, HS_LAT = 0.9, HS_WALK = 4.4, HS_OPEN = 35 * DEG, HS_MOPEN = 45 * DEG;
  function planHero(g, hero, w) {
    if (hsAware()) { planHeroShot(g, hero, w); return; }
    HS.on = false;
    var sd = w === 0 ? 1 : -1, mate = mateIn(g, w, hero);
    // posiciones VISUALES y, si van a juntarse para chocar las manos (PLY-07: el que anota avanza <= 1,2 m hacia el compañero y
    // este camina el resto hasta ~0,8 m), el punto de encuentro previsto: se planifica con donde ESTARÁN durante el plano
    visPos(hero, HPOS); visPos(mate, MPOS);
    var m0x = MPOS.x, m0y = MPOS.y;   // (de dónde sale el compañero: su camino no puede cruzar delante del objetivo)
    var hd = hyp(MPOS.x - HPOS.x, MPOS.y - HPOS.y), conv = hd > 1.0 && hd < 7.4, both = hd < 4.2 || conv;
    if (conv) {
      // (players: el que hizo el punto es g.lastPlayer del equipo que gana y anda poco; si no lo es, se encuentran a medio camino)
      var ux0 = (MPOS.x - HPOS.x) / hd, uy0 = (MPOS.y - HPOS.y) / hd, wa = g.lastPlayer === hero ? mn(1.2, 0.3 * (hd - 0.8)) : (hd - 0.8) * 0.5;
      HPOS.x += ux0 * wa; HPOS.y += uy0 * wa; MPOS.x = HPOS.x + ux0 * 0.85; MPOS.y = HPOS.y + uy0 * 0.85;
    }
    var fa = conv ? at2(MPOS.y - HPOS.y, MPOS.x - HPOS.x) - 0.32 : faceOf(hero), fx = Math.cos(fa), fy = Math.sin(fa), H = heightOf(hero);
    PF.mode = 'hero'; PF.hero = hero; PF.mate = mate; PF.both = both; PF.heroIn = true; PF.vic = null;
    var cx = (HPOS.x + (both ? MPOS.x * 0.55 : 0)) / (both ? 1.55 : 1), cy = (HPOS.y + (both ? MPOS.y * 0.55 : 0)) / (both ? 1.55 : 1);
    var asp = mx(1.1, aspect()), b = g.ball;
    var best = 1e9, bX = 0, bY = 0, bFov = 34, bD = 6, bSide = 1, n = 24;
    for (var k = 0; k < 8 * n; k++) {
      // 24 ángulos alrededor del héroe x 4 tamaños (46 %, 52 %, 41 % y 37 % del alto) x 2 tercios (héroe a la izq. / dcha.).
      // (52 %: más cerca, los rivales del otro lado de la red quedan más separados en ángulo y más pequeños)
      var th = (k % n) * 2 * PI / n, ux = Math.cos(th), uy = Math.sin(th), kk = Math.floor(k / n), ks = kk % 4;
      var frac = ks === 0 ? 0.46 : ks === 1 ? 0.52 : ks === 2 ? 0.41 : 0.37;
      var side = kk < 4 ? 1 : -1;   // +1 = héroe en el tercio DERECHO
      var fov = 34, tanV = Math.tan(fov * DEG / 2), d = H / (frac * 2 * tanV);
      var X = HPOS.x + ux * d, Y = HPOS.y + uy * d, sc = 0, o, s0;
      if (Math.abs(X) > 14.2 || Math.abs(Y) > 8.6) continue;   // dentro de la zona libre (sin vallas ni gradas)
      HP.fit = HP.court = HP.face = HP.obst = HP.ply = HP.lose = HP.net = HP.ball = 0;
      // dirección de la vista: el héroe queda en NDC x = side·HERO_X (girando la vista hacia el otro lado)
      var tanW = Math.tan(fov * DEG / 2) * asp, offA = Math.atan(HERO_X * tanW);
      var yawH = at2(HPOS.y - Y, HPOS.x - X), yawV = yawH + side * offA;
      var vx = Math.cos(yawV), vy = Math.sin(yawV), half = Math.atan(tanW);
      // los dos ganadores en el cuadro: el compañero dentro (con margen); si no cabe, se abre el FOV hasta 38°
      if (both) {
        var relM = wrap(at2(MPOS.y - Y, MPOS.x - X) - yawV);
        if (Math.abs(relM) > half * 0.85) {
          var tw2 = Math.tan(Math.abs(relM) / 0.85);
          var fv2 = 2 * Math.atan(tw2 / asp) / DEG;
          if (fv2 <= 38) { fov = mx(fov, fv2); } else { sc += (fv2 - 38) * 12; HP.fit += (fv2 - 38) * 12; }
          tanW = Math.tan(fov * DEG / 2) * asp; half = Math.atan(tanW);
        }
      }
      // en el CAMPO DEL HÉROE (la red nunca delante, a >= 1,2 m de ella)
      if (X * sd < 1.2) { sc += 260 + (1.2 - X * sd) * 40; HP.court = 260 + (1.2 - X * sd) * 40; }
      // de frente: a <= 60° de hacia donde mira (mejor ~25-35°: tres cuartos); de espaldas, casi prohibido
      var cA = Math.acos(mn(mx((ux * fx + uy * fy), -1), 1)) / DEG;
      // (entre 60° y 110° el castigo es moderado: un rematador junto a la red, de cara a ella, no admite el frente desde su
      // campo y entonces importa más que los rivales no llenen el cuadro; de espaldas, casi prohibido)
      // (chocando las manos, cara a cara a 0,85 m: el compañero solo queda más lejos que el héroe con la cámara a >= ~68° por el lado
      // derecho del héroe; ahí se tolera hasta 66° sin castigo: el plano de dos de perfil, el héroe delante)
      var fT = conv ? 66 : 50, fM = conv ? 18 : 28;
      s0 = sc; sc += mx(0, cA - fT) * (conv ? 2.4 : 1.5) + Math.abs(cA - fM) * 0.3 + (cA > 110 ? 150 + (cA - 110) * 4 : 0); HP.face = sc - s0; HP.cA = cA;
      // aire hacia donde mira: si mira a la derecha de la pantalla, mejor en el tercio izquierdo (y al revés)
      var rx = Math.sin(yawV), ry = -Math.cos(yawV), look = fx * rx + fy * ry;   // > 0 = mira hacia la derecha de pantalla
      if (look * side > 0.25) sc += 14 * look * side;
      sc += ks === 0 ? 0 : ks === 1 ? 6 : ks === 2 ? 5 : 12;   // (mejor el 46 %)
      // oficiales, postes, mesa y jugadores lejos de la cámara
      s0 = sc;
      for (o = 0; o < OBST.length; o++) { var dO = hyp(X - OBST[o][0], Y - OBST[o][1]) - OBST[o][2]; if (dO < 2.0) sc += (2.0 - dO) * 80; }
      HP.obst = sc - s0; s0 = sc;
      var hx = HPOS.x - X, hy = HPOS.y - Y, hl2 = hx * hx + hy * hy, hl = sq(hl2);
      for (o = 0; o < g.players.length; o++) {
        var q = g.players[o]; if (q === hero) continue;
        if (q === mate) { QPOS.x = MPOS.x; QPOS.y = MPOS.y; } else visPos(q, QPOS);
        var qx = QPOS.x - X, qy = QPOS.y - Y, qd = hyp(qx, qy);
        if (qd < 2.1) sc += (2.1 - qd) * 60;
        // nadie entre la cámara y el héroe
        var t = (qx * hx + qy * hy) / hl2;
        if (t > 0.05 && t < 1.05) { var dp = Math.abs(qx * hy - qy * hx) / hl; if (dp < 0.85) sc += 70 * (0.85 - dp) / 0.85; }
        // dentro del cuadro: nadie más grande que el héroe; los perdedores <= 55 % de su altura (al fondo) o fuera.
        // Con su posición PREVISTA (~0,6 s: vuelven a su sitio mientras dura el plano) y la de ahora: vale la peor
        var relQ = wrap(at2(qy, qx) - yawV), inF = Math.abs(relQ) < half + 0.06 && qx * vx + qy * vy > 0.3;
        var qpx = qx + (q === mate ? 0 : (q.vx || 0) * 0.6), qpy = qy + (q === mate ? 0 : (q.vy || 0) * 0.6), relP = wrap(at2(qpy, qpx) - yawV);
        var inP = Math.abs(relP) < half + 0.06 && qpx * vx + qpy * vy > 0.3, qdP = hyp(qpx, qpy);
        if (inP && (!inF || qdP < qd)) { inF = true; qd = qdP; relQ = relP; }
        if (inF) {
          var rel = hl / mx(0.5, qd);                       // altura relativa al héroe
          if (q.team !== w && rel > 0.55) { sc += (rel - 0.55) * 380; HP.lose += (rel - 0.55) * 380; }
          // el compañero nunca más grande que el héroe (si se acerca a la cámara para chocar las manos, se nota enseguida)
          if (q === mate && rel > 0.93) sc += (rel - 0.93) * (conv ? 900 : 320);
          // nadie a medias en el borde (cortado por el lateral), y menos cuanto más grande
          if (Math.abs(relQ) > half - 0.07 && rel > 0.35) sc += 30 + 40 * mn(rel, 1.2);
        } else if (q === mate && both) sc += 40;
        if (q === mate && conv) {
          // su camino hasta el punto de encuentro (3 muestras): ni enorme dentro del cuadro ni pegado a la cámara
          for (var sm = 0; sm < 3; sm++) {
            var su = sm / 3, px3 = m0x + (MPOS.x - m0x) * su - X, py3 = m0y + (MPOS.y - m0y) * su - Y, pd3 = hyp(px3, py3);
            if (pd3 < 2.1) sc += (2.1 - pd3) * 50;
            var inS = Math.abs(wrap(at2(py3, px3) - yawV)) < half + 0.06 + 0.32 / mx(0.6, pd3) && px3 * vx + py3 * vy > 0.3;
            if (inS && hl / mx(0.5, pd3) > 0.95) sc += (hl / mx(0.5, pd3) - 0.95) * 400 + 30;
          }
        }
      }
      HP.ply = sc - s0 - HP.lose; s0 = sc;
      // objetos grandes en primer plano dentro del cuadro (poste, silla, oficial)
      for (o = 0; o < OBST.length; o++) {
        var ox2 = OBST[o][0] - X, oy2 = OBST[o][1] - Y, od = hyp(ox2, oy2);
        if (od < 7 && od < hl && Math.abs(wrap(at2(oy2, ox2) - yawV)) < half + 0.05) sc += 45 * (7 - od) / 7;
      }
      // la red de frente y cerca (su malla llenaría medio cuadro): mejor de lado o lejos
      HP.obst += sc - s0;
      if (Math.abs(X) < 6 && Math.abs(wrap(yawV - (sd > 0 ? PI : 0))) < half) { sc += (6 - Math.abs(X)) * 5; HP.net = (6 - Math.abs(X)) * 5; }
      s0 = sc;
      if (b.z < 3.5) {   // el balón suelto (botando) pegado a la cámara o enorme en el cuadro
        var bx3 = b.x + b.vx * 0.6 - X, by3 = b.y + b.vy * 0.6 - Y, bd3 = hyp(bx3, by3);
        if (bd3 < 3.2) sc += (3.2 - bd3) * 60;
        if (bd3 < 6 && Math.abs(wrap(at2(by3, bx3) - yawV)) < half) sc += 35 * (6 - bd3) / 6;
      }
      HP.ball = sc - s0;
      if (sc < best) { best = sc; bX = X; bY = Y; bFov = fov; bD = d; bSide = side; for (var hk in HP) HPB[hk] = HP[hk]; HPB.frac = frac; }
    }
    PF.score = best; PF.side = bSide; PF.hxo = HERO_X;
    // el plano se describe alrededor del centro del grupo (pointShot deriva y sigue al grupo desde ahí)
    PF.c0x = cx; PF.c0y = cy; PF.cx = cx; PF.cy = cy;
    PF.ang = at2(bY - cy, bX - cx); PF.R = hyp(bX - cx, bY - cy); PF.fov = bFov; PF.z = 1.6; PF.heroD = bD;
    PF.dir = ((bX - cx) * (0 - cy) - (bY - cy) * (0 - cx)) >= 0 ? 1 : -1;
    PF.lx = HPOS.x; PF.ly = HPOS.y;
  }
  /** Plano de héroe CON el acuerdo de players (ver HS): 192 candidatos (24 ángulos x 4 tamaños x 2 tercios); para cada uno, el
   *  sitio del compañero (a su lado y detrás, hacia el centro; si no cabe, hacia fuera) y su camino hasta allí. */
  var HSB = { mx: 0.5, my: 0.5, hyaw: 0.5, myaw: 0.5, conv: false };
  /* HUD de arriba a la izquierda en NDC (marcador + pestaña del punto, que sale de detrás del marcador): el héroe con los
   * brazos en alto no puede quedar debajo. Se lee del DOM una vez por punto (si no hay DOM: nada). La pestaña se estima
   * aunque aún no se vea (sale en el mismo instante del punto). [x0, x1, y0, y1] con un margen por debajo. */
  var HUDR = [[0, 0, 0, 0], [0, 0, 0, 0]], hudN = 0;
  function readHud() {
    hudN = 0;
    try {
      var sb = document.getElementById('sb'), cv = ctx && ctx.renderer && ctx.renderer.domElement;
      if (!sb || !sb.offsetWidth) return;
      var cr = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      if (!(cr.width > 0 && cr.height > 0)) return;
      var r = sb.getBoundingClientRect(), s = r.height / mx(1, sb.offsetHeight), pb = document.getElementById('pbug'), pr = pb && pb.offsetWidth ? pb.getBoundingClientRect() : null;
      var nx = function (px) { return 2 * (px - cr.left) / cr.width - 1; }, ny = function (py) { return 1 - 2 * (py - cr.top) / cr.height; }, m = 0.06;
      HUDR[0][0] = nx(r.left); HUDR[0][1] = nx(r.right); HUDR[0][2] = ny(r.bottom) - m; HUDR[0][3] = ny(r.top);
      var pl = pr ? pr.left : r.right - 14 * s, prr = pr ? mx(pr.right, r.right + 120 * s) : r.right + 150 * s, pt = pr ? pr.top : r.top + 22 * s, pbm = pr ? pr.bottom : r.top + 108 * s;
      HUDR[1][0] = nx(pl); HUDR[1][1] = nx(prr); HUDR[1][2] = ny(pbm) - m; HUDR[1][3] = ny(pt);
      hudN = 2;
    } catch (e) { hudN = 0; }
  }
  /** Fracción (0..1) de la caja [x0,x1]x[y0,y1] (NDC) que tapa el HUD. */
  function hudCover(x0, x1, y0, y1) {
    var a = (x1 - x0) * (y1 - y0), c = 0;
    if (!(a > 0)) return 0;
    for (var i = 0; i < hudN; i++) {
      var R = HUDR[i], ox = mn(x1, R[1]) - mx(x0, R[0]), oy = mn(y1, R[3]) - mx(y0, R[2]);
      if (ox > 0 && oy > 0) c += ox * oy;
    }
    return mn(1, c / a);
  }
  /* Dónde va a estar el balón mientras dura el plano (0,45 / 0,9 / 1,5 s): balística simple con botes amortiguados y
   * rozamiento al rodar. Un balón que en el instante del punto aún va alto (antena, bloqueo que sale) cae y rueda
   * después: hay que contar con él aunque ahora esté a 4 m. */
  // (CAM-18: 2 s en 9 muestras —cae, bota y rueda—; el plano dura ~1,5-2,5 s tras el corte)
  var BPT = [0.2, 0.45, 0.7, 0.9, 1.15, 1.4, 1.65, 1.85, 2.1], BPR = []; for (var bpi = 0; bpi < BPT.length; bpi++) BPR.push([0, 0, 9]);
  function predictBall(b) {
    var x = b.x, y = b.y, z = mx(b.z, 0.11), vx = b.vx || 0, vy = b.vy || 0, vz = b.vz || 0, t = 0, k = 0, h = 1 / 40;
    while (k < BPT.length) {
      vz -= 9.81 * h; x += vx * h; y += vy * h; z += vz * h; t += h;
      if (z < 0.11) { z = 0.11; if (vz < -1) { vz = -vz * 0.55; vx *= 0.8; vy *= 0.8; } else { vz = 0; var f = mx(0, 1 - 1.2 * h); vx *= f; vy *= f; } }
      if (t >= BPT[k] - 1e-6) { BPR[k][0] = x; BPR[k][1] = y; BPR[k][2] = z; k++; }
    }
  }
  /** Balón suelto que estorba (CAM-18) desde la cámara (X, Y) mirando a yawV con medio campo horizontal half: ahora (+0,3 s) y las 9
   *  muestras de predictBall. Pegado a la lente (< 3,2 m) siempre; a < 6 m DENTRO del cuadro es un balón enorme (> 4 % del alto)
   *  en un lado: se descarta (penalización alta). Vale el peor momento. */
  function ballClutter(b, X, Y, yawV, half) {
    var worst = 0;
    if (BRK === 'clutter') return 0;
    for (var bk = -1; bk < BPT.length; bk++) {
      var bpx = bk < 0 ? b.x + b.vx * 0.3 : BPR[bk][0], bpy = bk < 0 ? b.y + b.vy * 0.3 : BPR[bk][1], bpz = bk < 0 ? b.z : BPR[bk][2];
      if (bpz > 3.5) continue;
      var bx3 = bpx - X, by3 = bpy - Y, bd3 = hyp(bx3, by3), bp = 0;
      if (bd3 < 3.2) bp += (3.2 - bd3) * 60;
      if (bd3 < 6 && Math.abs(wrap(at2(by3, bx3) - yawV)) < half + 0.12) bp += 160 + 40 * (6 - bd3);
      else if (bd3 < 8 && Math.abs(wrap(at2(by3, bx3) - yawV)) < half + 0.05) bp += 20 * (8 - bd3) / 2;
      if (bp > worst) worst = bp;
    }
    return worst;
  }
  /** Balón que asoma GRANDE por la franja del borde (CAM-18): con la pose prevista del plano (cámara (X, Y, Z), giro yawV, cabeceo pv, tan del
   *  FOV vertical tV), si en alguna muestra (ahora y los 2 s siguientes) el balón mide > 3,6 % del alto y su disco toca la franja del 15 %
   *  de un borde sin estar fuera del todo, penaliza. Dentro del 66 % central o fuera del cuadro, nada. */
  function ballBand(b, X, Y, Z, yawV, pv, tV) {
    var asp = aspect(), cyw = Math.cos(yawV), syw = Math.sin(yawV), cp = Math.cos(pv), sp = Math.sin(pv), R = (VB.C && VB.C.BR) || 0.21, worst = 0;
    if (BRK === 'clutter') return 0;
    for (var bk = -1; bk < BPT.length; bk++) {
      var bpx = bk < 0 ? b.x : BPR[bk][0], bpy = bk < 0 ? b.y : BPR[bk][1], bpz = bk < 0 ? b.z : BPR[bk][2];
      var dx = bpx - X, dy = bpy - Y, dz = bpz - Z, zc = dx * cp * cyw + dy * cp * syw + dz * sp;
      if (zc < 0.4) continue;
      var dia = 2 * R / (zc * 2 * tV); if (dia < 0.036) continue;
      var nx = (dx * syw - dy * cyw) / (zc * tV * asp), ny = (-dx * sp * cyw - dy * sp * syw + dz * cp) / (zc * tV), rx = dia / asp, ry = dia;
      var ax = Math.abs(nx), ay = Math.abs(ny);
      if (ax - rx > 1.02 || ay - ry > 1.02) continue;          // fuera del cuadro
      if (ax + rx < 0.68 && ay + ry < 0.68) continue;           // en el centro: es parte de la escena
      var p = 120 + 900 * (dia - 0.036);
      if (p > worst) worst = p;
    }
    return worst;
  }
  function planHeroShot(g, hero, w) {
    var sd = w === 0 ? 1 : -1, mate = mateIn(g, w, hero);
    visPos(hero, HPOS); visPos(mate, MPOS);
    // (players fija al héroe donde esté al arrancar la convergencia, ~0,12 s después: se adelanta su deriva)
    HPOS.x += mn(mx(hero.vx || 0, -4), 4) * 0.12; HPOS.y += mn(mx(hero.vy || 0, -4), 4) * 0.12;
    var H = heightOf(hero), asp = mx(1.1, aspect()), b = g.ball, fa0 = faceOf(hero);
    // composición abierta: en pantallas muy anchas sin controles táctiles, más abierta (misma separación angular respecto al
    // que tiene detrás: en 21:9 el cuadro es más ancho y el rival de enfrente se quedaba dentro)
    var hxw = touchUI() ? HERO_XW : mn(0.7, HERO_XW * Math.pow(mx(1, asp / 1.78), 0.8));
    var best = 1e9, bX = 0, bY = 0, bFov = 34, bD = 6, bSide = 1, bHx = HERO_X, n = 24;
    HSB.conv = false;
    readHud(); predictBall(b);
    for (var k = 0; k < 20 * n; k++) {
      // 24 ángulos x 5 tamaños x 2 lados x 2 composiciones: el héroe en el tercio (NDC ±0,42) o más abierto (±0,55: deja fuera
      // del cuadro a quien tiene a 1,5-2 m detrás, como el rematador al que acaba de bloquear al otro lado de la red).
      // (54 %: junto a la banda, la cámara cabe a <= 5,7 m de un héroe que está en la red y deja fuera al rival de enfrente)
      var th = (k % n) * 2 * PI / n, ux = Math.cos(th), uy = Math.sin(th), kk = Math.floor(k / n), ks = kk % 5;
      var frac = ks === 0 ? 0.46 : ks === 1 ? 0.5 : ks === 2 ? 0.42 : ks === 3 ? 0.38 : 0.54;
      var ci = Math.floor(kk / 5), side = ci & 1 ? -1 : 1;   // +1 = héroe a la DERECHA
      var hxo = ci >= 2 ? hxw : HERO_X;
      var fov = 34, tanV = Math.tan(fov * DEG / 2), d = H / (frac * 2 * tanV);
      var X = HPOS.x + ux * d, Y = HPOS.y + uy * d, sc = 0, o;
      if (Math.abs(X) > K.bX - 0.6 || Math.abs(Y) > K.bY - 0.2) continue;   // zona libre (bX/bY: VB.Arena.bounds; 14,6 / 9,1)
      HP.fit = HP.court = HP.face = HP.obst = HP.ply = HP.lose = HP.net = HP.ball = 0;
      var tanW = Math.tan(fov * DEG / 2) * asp, offA = Math.atan(hxo * tanW);
      var yawH = at2(HPOS.y - Y, HPOS.x - X), yawV = yawH + side * offA;
      var vx = Math.cos(yawV), vy = Math.sin(yawV), half = Math.atan(tanW);
      // (mejor en el tercio; abierto a la IZQUIERDA, los brazos en alto del héroe se meten bajo el marcador de arriba a la izquierda)
      if (hxo !== HERO_X) { var pw = side < 0 ? 60 : 12; sc += pw; HP.fit += pw; }
      var rxs = Math.sin(yawV), rys = -Math.cos(yawV);   // derecha de la pantalla, en el suelo
      // sitio del compañero: detrás del héroe (lejos de la cámara) y de lado, primero hacia el centro del cuadro
      var cM = false, mX = MPOS.x, mY = MPOS.y, ls = -side;
      for (var tr = 0; tr < 2 && !cM; tr++) {
        ls = tr === 0 ? -side : side;
        var tx = HPOS.x - ux * HS_BACK + rxs * ls * HS_LAT, ty = HPOS.y - uy * HS_BACK + rys * ls * HS_LAT;
        if (tx * sd < 0.7 || Math.abs(tx) > 11.5 || Math.abs(ty) > 7.2) continue;
        if (hyp(tx - MPOS.x, ty - MPOS.y) > HS_WALK) continue;
        cM = true; mX = tx; mY = ty; if (tr) { sc += 18; HP.fit += 18; }   // (hacia fuera: el héroe mira fuera del cuadro)
      }
      // el héroe, de cara a la cámara y abierto hacia su compañero (o hacia el centro del cuadro si va solo)
      var fc = th, fo1 = fc + HS_OPEN, fo2 = fc - HS_OPEN, wantX = rxs * ls, wantY = rys * ls;
      var hyaw = (Math.cos(fo1) * wantX + Math.sin(fo1) * wantY) >= (Math.cos(fo2) * wantX + Math.sin(fo2) * wantY) ? fo1 : fo2;
      // el compañero, abierto a la cámara y girado hacia el héroe ("V" de cara al público)
      var mc = at2(Y - mY, X - mX), mo1 = mc + HS_MOPEN, mo2 = mc - HS_MOPEN, hxm = HPOS.x - mX, hym = HPOS.y - mY;
      var myaw = (Math.cos(mo1) * hxm + Math.sin(mo1) * hym) >= (Math.cos(mo2) * hxm + Math.sin(mo2) * hym) ? mo1 : mo2;
      // los dos dentro del cuadro: si el compañero no cabe, se abre el FOV hasta 38°
      if (cM) {
        var relM = wrap(at2(mY - Y, mX - X) - yawV);
        if (Math.abs(relM) > half * 0.85) {
          var fv2 = 2 * Math.atan(Math.tan(Math.abs(relM) / 0.85) / asp) / DEG;
          if (fv2 <= 38) fov = mx(fov, fv2); else { sc += (fv2 - 38) * 12; HP.fit += (fv2 - 38) * 12; }
          tanW = Math.tan(fov * DEG / 2) * asp; half = Math.atan(tanW);
        }
      } else { sc += 10; HP.fit += 10; }   // (mejor con la pareja que solo)
      // el héroe ENTERO y libre: ni debajo del marcador / la pestaña del punto (los brazos en alto se meten debajo) ni
      // cortado por el borde del cuadro. Caja aproximada en NDC: cabeza a 0,45 (los pies >= -0,9), brazos en alto ~22 % del
      // alto por encima, medio ancho ~0,22 del alto (con los brazos abiertos)
      var fr = frac * Math.tan(17 * DEG) / Math.tan(fov * DEG / 2), hY = mx(0.45, -0.9 + 2 * fr), hcx = side * hxo, hw = 0.44 * fr / asp;
      // (la CABEZA bajo el HUD pesa; los brazos en alto rozándolo, poco: un perdedor demasiado grande en el cuadro es peor)
      var covH = hudCover(hcx - 0.25 * hw, hcx + 0.25 * hw, hY - 0.25 * fr, hY + 0.06 * fr), covA = covH > 0 ? 0 : hudCover(hcx - hw, hcx + hw, hY, hY + 0.45 * fr);
      if (covH > 0 || covA > 0) { var pc = 40 * covH + 6 * covA + 40 * mx(0, covA - 0.4); sc += pc; HP.fit += pc; }
      var edge = Math.abs(hcx) + hw - 0.97;
      if (edge > 0) { var pe = 60 + 200 * edge / hw; sc += pe; HP.fit += pe; }
      // en el CAMPO DEL HÉROE (la red nunca delante, a >= 1,2 m de ella)
      if (X * sd < 1.2) { sc += 260 + (1.2 - X * sd) * 40; HP.court = 260 + (1.2 - X * sd) * 40; }
      // el giro que se le pide al héroe: hasta ~150° es natural en una celebración; más, un poco peor
      var turn = Math.abs(wrap(hyaw - fa0)) / DEG; HP.cA = HS_OPEN / DEG;
      if (turn > 150) { sc += (turn - 150) * 0.15; HP.face = (turn - 150) * 0.15; }
      sc += ks === 0 ? 0 : ks === 1 ? 4 : ks === 2 ? 4 : ks === 3 ? 10 : 14;   // (mejor el 46 %)
      if (sc >= best) continue;   // (todos los términos suman >= 0: poda en cuanto ya no puede ganar)
      var s0 = sc;
      for (o = 0; o < OBST.length; o++) { var dO = hyp(X - OBST[o][0], Y - OBST[o][1]) - OBST[o][2]; if (dO < 2.0) sc += (2.0 - dO) * 80; }
      HP.obst = sc - s0; s0 = sc;
      if (sc >= best) continue;
      var hx = HPOS.x - X, hy = HPOS.y - Y, hl2 = hx * hx + hy * hy, hl = sq(hl2);
      for (o = 0; o < g.players.length; o++) {
        var q = g.players[o]; if (q === hero) continue;
        var isM = q === mate;
        // el compañero: su sitio final y su CAMINO hasta allí (4 muestras; no puede cruzar delante de la cámara ni del héroe) y,
        // por si no llega a venir (se levanta tarde de una plancha), también donde está y su sitio de la sim (adonde vuelve su
        // figura tras la plancha)
        for (var sm = isM ? (cM ? 0 : 4) : 4; sm <= (isM ? 5 : 4); sm++) {
          var su = sm / 4;
          if (isM) {
            if (sm === 5) { QPOS.x = mate.x; QPOS.y = mate.y; }
            else { QPOS.x = MPOS.x + (mX - MPOS.x) * su; QPOS.y = MPOS.y + (mY - MPOS.y) * su; }
          } else visPos(q, QPOS);
          var qx = QPOS.x - X, qy = QPOS.y - Y, qd = hyp(qx, qy);
          if (qd < 2.1) sc += (2.1 - qd) * 60;
          var t = (qx * hx + qy * hy) / hl2;
          if (t > 0.05 && t < 1.05) { var dp = Math.abs(qx * hy - qy * hx) / hl; if (dp < 0.85) sc += (isM && sm < 4 ? 35 : 70) * (0.85 - dp) / 0.85; }
          // (margen = medio ancho de un cuerpo a esa distancia: de cerca, un hombro asoma por el borde aunque el centro quede fuera)
          var bm = 0.06 + 0.32 / mx(0.6, qd), relQ = wrap(at2(qy, qx) - yawV), inF = Math.abs(relQ) < half + bm && qx * vx + qy * vy > 0.3;
          if (!isM) {
            // (rivales: también con su posición prevista a 0,5 y 1,0 s, que vuelven a su sitio o se acercan a la red; vale la peor)
            for (var pt = 1; pt <= 2; pt++) {
              var qpx = qx + mn(mx(q.vx || 0, -5), 5) * 0.5 * pt, qpy = qy + mn(mx(q.vy || 0, -5), 5) * 0.5 * pt, relP = wrap(at2(qpy, qpx) - yawV);
              var qdP = hyp(qpx, qpy), inP = Math.abs(relP) < half + 0.06 + 0.32 / mx(0.6, qdP) && qpx * vx + qpy * vy > 0.3;
              if (inP && (!inF || qdP < qd)) { inF = true; qd = qdP; relQ = relP; bm = 0.06 + 0.32 / mx(0.6, qdP); }
              // ni delante del héroe DESPUÉS (el bloqueador rival que cae y se gira junto a la red cruza por delante)
              var tP = (qpx * hx + qpy * hy) / hl2;
              if (tP > 0.05 && tP < 1.05) { var dpP = Math.abs(qpx * hy - qpy * hx) / hl; if (dpP < 0.85) sc += 45 * (0.85 - dpP) / 0.85; }
            }
          }
          if (!inF) continue;
          var rel = hl / mx(0.5, qd);
          // perdedores: <= 50 % de la altura del héroe al planificar (margen para el 60 % que se exige mientras dura el plano)
          if (q.team !== w) { if (rel > 0.5) { sc += (rel - 0.5) * 480; HP.lose += (rel - 0.5) * 480; } }
          else if (rel > 0.9) sc += (rel - 0.9) * (sm >= 4 ? 900 : 500) + (sm === 4 ? 0 : 40);   // compañero: nunca tan grande como el héroe
          if (Math.abs(relQ) > half - bm && rel > 0.3 && (!isM || sm >= 4)) sc += 30 + 60 * mn(rel, 1.5);   // cortado por el borde
        }
      }
      HP.ply = sc - s0 - HP.lose; s0 = sc;
      if (sc >= best) continue;
      for (o = 0; o < OBST.length; o++) {
        var ox2 = OBST[o][0] - X, oy2 = OBST[o][1] - Y, od = hyp(ox2, oy2);
        // (margen: el ancho real del acolchado/oficial a esa distancia + la deriva lenta del plano, ~0,12 rad)
        var inO = Math.abs(wrap(at2(oy2, ox2) - yawV)) < half + (o < 2 ? 0.08 + Math.atan(0.4 / mx(0.5, od)) : 0.05);
        // los POSTES (2,55 m, acolchados): en primer plano o a la altura del héroe llenan el centro del cuadro (punto en la
        // antena, bloqueo junto a la red): pesan el doble y hasta 8 m
        if (o < 2) { if (od < 8 && od < hl + 1.5 && inO) sc += 90 * (8 - od) / 8; }
        else if (od < 7 && od < hl && inO) sc += 45 * (7 - od) / 7;
      }
      HP.obst += sc - s0;
      if (Math.abs(X) < 6 && Math.abs(wrap(yawV - (sd > 0 ? PI : 0))) < half) { sc += (6 - Math.abs(X)) * 5; HP.net = (6 - Math.abs(X)) * 5; }
      s0 = sc;
      // el balón suelto: ahora y donde estará mientras dura el plano (cae, bota y rueda); vale el peor momento
      sc += ballClutter(b, X, Y, yawV, half);
      if (sc < best) { var tVb = Math.tan(fov * DEG / 2); sc += ballBand(b, X, Y, 1.6, yawV, at2(hero.z + H - 1.6, d * Math.cos(offA)) - Math.atan(0.45 * tVb), tVb); }
      HP.ball = sc - s0;
      if (sc < best) {
        best = sc; bX = X; bY = Y; bFov = fov; bD = d; bSide = side; bHx = hxo; for (var hk in HP) HPB[hk] = HP[hk]; HPB.frac = frac;
        HSB.conv = cM; HSB.mx = mX; HSB.my = mY; HSB.hyaw = hyaw; HSB.myaw = myaw;
      }
    }
    var both = HSB.conv;
    PF.mode = 'hero'; PF.hero = hero; PF.mate = mate; PF.both = both; PF.heroIn = true; PF.vic = null;
    PF.score = best; PF.side = bSide; PF.hxo = bHx;
    var cx = (HPOS.x + (both ? HSB.mx * 0.55 : 0)) / (both ? 1.55 : 1), cy = (HPOS.y + (both ? HSB.my * 0.55 : 0)) / (both ? 1.55 : 1);
    PF.c0x = cx; PF.c0y = cy; PF.cx = cx; PF.cy = cy;
    PF.ang = at2(bY - cy, bX - cx); PF.R = hyp(bX - cx, bY - cy); PF.fov = bFov; PF.z = 1.6; PF.heroD = bD;
    PF.dir = ((bX - cx) * (0 - cy) - (bY - cy) * (0 - cx)) >= 0 ? 1 : -1;
    PF.lx = HPOS.x; PF.ly = HPOS.y;
    // publicar el acuerdo
    HS.on = true; HS.heroId = hero.id; HS.mateId = mate.id; HS.team = w; HS.camX = bX; HS.camY = bY; HS.hx = HPOS.x; HS.hy = HPOS.y;
    HS.heroYaw = HSB.hyaw; HS.conv = both; HS.mx = both ? HSB.mx : NaN; HS.my = both ? HSB.my : NaN; HS.mateYaw = HSB.myaw; HS.t = g.time;
  }
  function planPoint(g, how, faultP, replan) {
    var w = g.lastPoint ? g.lastPoint.team : 0, los = 1 - w, b = g.ball;
    PF.w = w; PF.how = how; PF.mode = 'vic'; PF.mate = null; PF.both = false; PF.score = 0; HS.on = false;
    // ¿héroe o víctima? Víctima SOLO si el que pierde es el equipo humano y es un error propio
    var ownErr = how === 'error' && los === 0;
    var heroP = ownErr ? null : pickHero(g, w, how);
    if (heroP) {
      planHero(g, heroP, w);
      // el plano de héroe siempre entra por corte a los 0,45 s (es otra gramática: baja, cerrada y de frente)
      if (!replan) { PF.cut = true; PF.cutDone = false; PF.cutNow = false; }
      return;
    }
    // bote: evento 'land' del rally o g.lastLand (escenas congeladas); si no lo hubo (red, dobles...), el balón
    var ll = landOk ? null : (g.lastLand && g.lastLand.t > g.time - 6 ? g.lastLand : null);
    var lx = landOk ? K.landX : ll ? ll.x : b.x, ly = landOk ? K.landY : ll ? ll.y : b.y;
    if (!landOk && !ll && faultP) { lx = faultP.x * 0.7 + b.x * 0.3; ly = faultP.y * 0.7 + b.y * 0.3; }
    // víctima: el infractor (si es del que pierde), el último que tocó si es del que pierde (la recepción que
    // se va, el remate fuera) o el del que pierde más cerca del bote
    var lastL = g.lastPlayer && g.lastPlayer.team === los && hyp(g.lastPlayer.x - lx, g.lastPlayer.y - ly) < 12 ? g.lastPlayer : null;
    var vic = faultP && faultP.team === los ? faultP : lastL || nearestOf(g.teams[los], lx, ly, null);
    if (vic && vic !== faultP && vic !== lastL && hyp(vic.x - lx, vic.y - ly) > 8) {
      var any = nearestOf(g.players, lx, ly, null);
      vic = any && hyp(any.x - lx, any.y - ly) < 6 ? any : null;
    }
    // ace con recepción desviada lejos (shank): el foco es el receptor y la zona de recepción, no el bote fuera
    var far = Math.abs(lx) > 10.3 || Math.abs(ly) > 5.8;
    if (far && vic) { lx = vic.x + (lx - vic.x) * 0.35; ly = vic.y + (ly - vic.y) * 0.35; }
    PF.lx = mn(mx(lx, -10.8), 10.8); PF.ly = mn(mx(ly, -6.6), 6.6); PF.vic = vic;
    // héroe: el último del que gana que tocó (el sacador en un ace)
    var hero = (g.lastTeam === w && g.lastPlayer) ? g.lastPlayer : (how === 'ace' && g.server && g.server.team === w ? g.server : null);
    if (hero === vic) hero = null;
    PF.hero = hero; PF.heroIn = false;
    groupCenter(GC);
    if (hero && hero.x * GC.x > 0 && Math.abs(hero.x) > 0.6 && hyp(hero.x - GC.x, hero.y - GC.y) < 7.5) { PF.heroIn = true; groupCenter(GC); }
    var cx = GC.x, cy = GC.y;
    PF.c0x = cx; PF.c0y = cy; PF.cx = cx; PF.cy = cy;
    var tight = (how === 'ace' || how === 'kill' || how === 'block') ? 32 : 35;
    var tanV = Math.tan(tight * DEG / 2), tanHh = tanV * mx(1.1, aspect());
    var best = 1e9, bAng = 0, bR = 6, bFov = tight, n = 24;
    predictBall(b);
    for (var k = 0; k < 2 * n; k++) {
      // 24 ángulos x 2 distancias (la justa y un 30 % más lejos: la perspectiva agranda a quien queda cerca)
      var th = (k % n) * 2 * Math.PI / n, ux = Math.cos(th), uy = Math.sin(th), mR = k < n ? 1 : 1.3;
      // anchura del grupo perpendicular a la mirada
      var sMin = -0.4, sMax = 0.4;
      var s0 = -(PF.lx - cx) * uy + (PF.ly - cy) * ux; sMin = mn(sMin, s0); sMax = mx(sMax, s0);
      if (vic) { var s1 = -(vic.x - cx) * uy + (vic.y - cy) * ux; sMin = mn(sMin, s1); sMax = mx(sMax, s1); }
      if (PF.heroIn) { var s2 = -(hero.x - cx) * uy + (hero.y - cy) * ux; sMin = mn(sMin, s2); sMax = mx(sMax, s2); }
      var half = mx(Math.abs(sMin), Math.abs(sMax)) + 1.3;
      var R = mn(mx(half / tanHh * mR, 5.4), 10.5 * mR), fv = tight;
      if (half / tanHh > 10.5) fv = mn(42, 2 * Math.atan(half / 10.5 / mx(1.1, aspect())) / DEG);
      // dentro de la zona libre (sin meterse en vallas ni gradas)
      var lim = R;
      if (ux > 1e-3) lim = mn(lim, (14.2 - cx) / ux); else if (ux < -1e-3) lim = mn(lim, (-14.2 - cx) / ux);
      if (uy > 1e-3) lim = mn(lim, (8.6 - cy) / uy); else if (uy < -1e-3) lim = mn(lim, (-8.6 - cy) / uy);
      var sc = 0;
      if (lim < R) { if (lim < 4.4) continue; sc += (R - lim) * 6; if (lim < R * 0.8) fv = mn(44, fv * R / lim * 0.9); R = lim; }
      var X = cx + ux * R, Y = cy + uy * R, o, d;
      sc += (R - 5.4) * 1.5;
      // cada protagonista ENTERO en el cuadro (con la perspectiva real) y a >= 4,3 m del objetivo
      var vx0 = cx - X, vy0 = cy - Y, hLim = Math.atan(Math.tan(fv * DEG / 2) * mx(1.1, aspect())) * 0.8;
      for (o = 0; o < 3; o++) {
        var fx = o === 0 ? PF.lx : o === 1 ? (vic ? vic.x : NaN) : (PF.heroIn ? hero.x : NaN);
        var fy = o === 0 ? PF.ly : o === 1 ? (vic ? vic.y : 0) : (PF.heroIn ? hero.y : 0);
        if (fx !== fx) continue;
        var ddx = fx - X, ddy = fy - Y, dd = hyp(ddx, ddy), an = Math.abs(at2(vx0 * ddy - vy0 * ddx, vx0 * ddx + vy0 * ddy));
        if (o > 0 && dd < 4.3) sc += (4.3 - dd) * 45;
        if (an > hLim) sc += (an - hLim) / DEG * (o === 0 ? 3 : 6);
      }
      for (o = 0; o < OBST.length; o++) { d = hyp(X - OBST[o][0], Y - OBST[o][1]) - OBST[o][2]; if (d < 2.0) sc += (2.0 - d) * 80; }
      for (o = 0; o < g.players.length; o++) { var q = g.players[o]; d = hyp(X - q.x, Y - q.y); if (d < 2.1) sc += (2.1 - d) * 60; }
      // la red entre la cámara y el grupo (cámara baja: la malla taparía todo)
      if ((X > 0) !== (cx > 0) && Math.abs(cx) > 0.3) {
        var tc = X / (X - cx), yc = Y + (cy - Y) * tc;
        if (Math.abs(yc) < 6.2) sc += 300;
      }
      if (Math.abs(X) < 2.4 && Math.abs(Y) < 6.5) sc += (2.4 - Math.abs(X)) * 40;
      // nadie (ni oficiales) delante del grupo
      var vx = cx - X, vy = cy - Y, vl2 = vx * vx + vy * vy;
      for (o = 0; o < g.players.length; o++) {
        var qq = g.players[o]; if (qq === vic || (PF.heroIn && qq === hero)) continue;
        var t = ((qq.x - X) * vx + (qq.y - Y) * vy) / vl2;
        if (t > 0.05 && t < 0.95) { var dp = Math.abs((qq.x - X) * vy - (qq.y - Y) * vx) / sq(vl2); if (dp < 0.8) sc += 45 * (0.8 - dp) / 0.8; }
      }
      // el balón (rodando o botando) no puede quedar pegado al objetivo
      if (b.z < 3) { d = hyp(X - b.x - b.vx * 0.6, Y - b.y - b.vy * 0.6); if (d < 3.2) sc += (3.2 - d) * 60; }
      // obstáculos cerca del objetivo DENTRO del cuadro (un poste o un oficial enorme en primer plano; con FOV 32°, a 6 m ya pesa)
      var hh = Math.atan(tanHh) + 4 * DEG, vlen = sq(vl2);
      for (o = 0; o < OBST.length; o++) {
        var ox2 = OBST[o][0] - X, oy2 = OBST[o][1] - Y, od = hyp(ox2, oy2);
        if (od < 7 && Math.abs(at2(vx * oy2 - vy * ox2, vx * ox2 + vy * oy2)) < hh) sc += 40 * (7 - od) / 7;
      }
      sc += ballClutter(b, X, Y, at2(vy, vx), hh - 4 * DEG);   // (el balón suelto, ahora y los 2 s siguientes, nunca enorme en un lado, CAM-18)
      if (sc < best) { var tVv = Math.tan(fv * DEG / 2), Zv = 1.65 + 0.04 * (R - 5.4); sc += ballBand(b, X, Y, Zv, at2(vy, vx), at2(0.9 - Zv, R) + Math.atan(0.26 * tVv), tVv); }
      for (o = 0; o < g.players.length; o++) {   // ídem con los jugadores que no son del grupo (cortados y enormes en un lado)
        var pq = g.players[o]; if (pq === vic || (PF.heroIn && pq === hero)) continue;
        var px2 = pq.x - X, py2 = pq.y - Y, pd = hyp(px2, py2);
        if (pd < 5 && Math.abs(at2(vx * py2 - vy * px2, vx * px2 + vy * py2)) < hh) sc += 35 * (5 - pd) / 5;
      }
      for (o = 0; o < OBST.length; o++) {
        var tt = ((OBST[o][0] - X) * vx + (OBST[o][1] - Y) * vy) / vl2;
        if (tt > 0.02 && tt < 1.1) { var dq = Math.abs((OBST[o][0] - X) * vy - (OBST[o][1] - Y) * vx) / sq(vl2) - OBST[o][2]; if (dq < 0.6) sc += 50 * (0.6 - dq) / 0.6; }
      }
      // la víctima de frente o de lado, NUNCA de espaldas (su frente vs la dirección hacia la cámara)
      if (vic) {
        var vfa = faceOf(vic), vca = Math.acos(mn(mx(((X - vic.x) * Math.cos(vfa) + (Y - vic.y) * Math.sin(vfa)) / (hyp(X - vic.x, Y - vic.y) || 1), -1), 1)) / DEG;
        if (vca > 105) sc += (vca - 105) * 4;
      }
      // el que ganó el punto, al fondo (en un ace, el sacador al otro lado de la red); si no hay, la red al fondo
      var hx = hero ? hero.x - cx : -cx, hy = hero ? hero.y - cy : -cy * 0.3, hl = hyp(hx, hy) || 1;
      sc -= 14 * ((-ux) * hx + (-uy) * hy) / hl;
      // continuidad: si la cámara ya está en este campo y cerca, mejor llegar deslizando que cortar
      if ((X > 0) === (P.x > 0) && hyp(X - P.x, Y - P.y) < 8) sc -= 8;
      if (sc < best) { best = sc; bAng = th; bR = R; bFov = fv; }
    }
    PF.ang = bAng; PF.R = bR; PF.fov = bFov; PF.z = 1.65 + 0.04 * (bR - 5.4);
    // deriva lenta hacia el centro de la pista
    var cX = cx + Math.cos(bAng) * bR, cY = cy + Math.sin(bAng) * bR;
    PF.dir = ((cX - cx) * (0 - cy) - (cY - cy) * (0 - cx)) >= 0 ? 1 : -1;
    var same = (cX > 0) === (P.x > 0) || Math.abs(P.x) < 1;
    PF.cut = !(same && hyp(cX - P.x, cY - P.y) < 9);
    PF.cutDone = !PF.cut; PF.cutNow = false;
  }

  /** Entre puntos: espera breve, corte (o deslizamiento) al plano de reacción y deriva lenta. */
  function pointShot(g) {
    var dt = K.dt;
    K.pointT += dt;
    if (!PF.cutDone) {
      if (K.pointT < PF.hold) {
        // la cámara de juego se queda y mira (suave) hacia donde cayó el balón
        D.x = P.x; D.y = P.y; D.z = P.z;
        A.x = L.x + (PF.lx - L.x) * 0.35; A.y = L.y + (PF.ly - L.y) * 0.35; A.z = L.z + (0.8 - L.z) * 0.35;
        K.fovWant = K.fovCur;
        return;
      }
      PF.cutDone = true; PF.cutNow = true; K.pointT = PF.hold;
    }
    var tc = mx(0, K.pointT - (PF.cut ? PF.hold : 0));
    groupCenter(GC);
    var kk = dt > 0 ? mn(1, dt * 2.2) : 1;
    PF.cx += (GC.x - PF.cx) * kk; PF.cy += (GC.y - PF.cy) * kk;
    var ka = smooth01(tc / 3.5), ang = PF.ang + PF.dir * 0.12 * ka, R = PF.R * (1 - 0.06 * ease(tc / 3));
    D.x = PF.c0x + Math.cos(ang) * R; D.y = PF.c0y + Math.sin(ang) * R; D.z = PF.z + 0.12 * ka;
    // jugadores que se acercan (celebraciones, vuelta a su sitio) y obstáculos: la cámara se aparta
    for (var i = 0; i < g.players.length; i++) {
      var q = g.players[i], ex = D.x - q.x, ey = D.y - q.y, el = hyp(ex, ey);
      if (el < 1.9) { var s = (1.9 - el) / mx(0.25, el); D.x += ex * s; D.y += ey * s; }
    }
    var bb = g.ball;
    if (bb.z < 3) { var bx2 = D.x - bb.x, by2 = D.y - bb.y, bl = hyp(bx2, by2); if (bl < 3.4) { var sb2 = (3.4 - bl) / mx(0.25, bl); D.x += bx2 * sb2; D.y += by2 * sb2; } }
    for (var o = 0; o < OBST.length; o++) {
      var ox = D.x - OBST[o][0], oy = D.y - OBST[o][1], ol = hyp(ox, oy), need = OBST[o][2] + 1.8;
      if (ol < need) { var so = (need - ol) / mx(0.2, ol); D.x += ox * so; D.y += oy * so; }
    }
    var lxp = PF.mode === 'hero' ? K.bX - 0.5 : 14.3, lyp = PF.mode === 'hero' ? K.bY - 0.1 : 8.7;
    D.x = mn(mx(D.x, -lxp), lxp); D.y = mn(mx(D.y, -lyp), lyp);
    // mira: el centro del grupo, con su altura media (0,9 m) a -0,26 NDC (el centro del cuadro es del rótulo del punto)
    K.fovWant = fovFor(PF.fov, 24, 28);
    var hd = mx(1, hyp(PF.cx - D.x, PF.cy - D.y)), th = Math.tan(K.fovWant * DEG / 2);
    var pitch = at2(0.9 - D.z, hd) + Math.atan(0.26 * th);
    var lookYaw = 0, heroAim = PF.mode === 'hero' && PF.hero;
    if (heroAim) {
      // HÉROE en un tercio (NDC x = ±HERO_X, con aire hacia donde mira; el centro es del rótulo del punto), la cabeza
      // a 0,45 NDC y los pies dentro (>= -0,9)
      var hq = PF.hero, offA = Math.atan(PF.hxo * th * aspect());
      visPos(hq, VP);
      lookYaw = at2(VP.y - D.y, VP.x - D.x) + PF.side * offA;
      var hdH = mx(1, hyp(VP.x - D.x, VP.y - D.y) * Math.cos(offA)), Hh = heightOf(hq);
      hd = hdH;
      pitch = at2(hq.z + Hh - D.z, hdH) - Math.atan(0.45 * th);
      var pFeet = at2(hq.z - D.z, hdH) + Math.atan(0.9 * th);
      if (pitch > pFeet) pitch = pFeet;
    }
    // marcador colgado (abajo a 9,6 m, sobre el centro): ni a medias. El borde superior, 2° por debajo
    var sbD = mx(1, hyp(D.x, D.y)), sbA = at2(9.6 - D.z, sbD);
    // la víctima entera: sus pies no por debajo de -0,9 NDC (si está cerca, la mira baja)
    if (PF.vic) {
      var vd = (PF.vic.x - D.x) * (PF.cx - D.x) / hd + (PF.vic.y - D.y) * (PF.cy - D.y) / hd;
      if (vd > 1) pitch = mn(pitch, at2(-D.z, vd) + Math.atan(0.9 * th));
    }
    // CINTA DEL PUNTO (CAM-18): la cabeza del héroe nunca bajo VB.UI.bannerRect(); si cae dentro, la mira sube lo justo (<= 5°) para que
    // quede un 3,5 % del alto por debajo de la cinta (la UI ya la coloca lejos de él: esto es la red de seguridad)
    var banW = 0;
    if (heroAim && VB.UI && VB.UI.bannerRect && ctx.width > 0) {
      var br = null; try { br = VB.UI.bannerRect(); } catch (e) { br = null; }
      if (br && br.right > br.left) {
        var hN = Math.tan(at2(hq.z + Hh - D.z, hdH) - pitch) / th, hxN = PF.side * PF.hxo, bx0 = 2 * br.left / ctx.width - 1, bx1 = 2 * br.right / ctx.width - 1;
        var by0 = 1 - 2 * br.bottom / ctx.height, by1 = 1 - 2 * br.top / ctx.height;
        if (hxN > bx0 - 0.08 && hxN < bx1 + 0.08 && hN > by0 - 0.07 && hN < by1 + 0.05) banW = mn(5 * DEG, Math.atan((hN - (by0 - 0.07)) * th));
      }
    }
    K.banP = dt > 0 ? K.banP + (banW - K.banP) * mn(1, dt * 6) : banW;
    if (K.banP > 0.0005) pitch += K.banP;
    var top = pitch + Math.atan(th);
    if (top > sbA - 2 * DEG) pitch -= top - (sbA - 2 * DEG);
    if (heroAim) { A.x = D.x + Math.cos(lookYaw) * hd; A.y = D.y + Math.sin(lookYaw) * hd; }
    else { A.x = PF.cx; A.y = PF.cy; }
    A.z = D.z + Math.tan(pitch) * hd;
  }

  var OV0 = V(), OV1 = V();
  /* PANEL FINAL ACOPLADO (CAM-10): ui_main deja en ctx.uiDock = {side: 'left'|'right'|'none', frac: 0..1 (parte del ancho que tapa)}.
   * En 'over' la imagen se desplaza (filmOffset, como en el menú) para que los ganadores queden en el centro de la parte libre. */
  function dockFrac() {
    var dk = ctx && ctx.uiDock;
    if (!dk || (dk.side !== 'left' && dk.side !== 'right') || !(dk.frac > 0)) return 0;
    return mn(dk.frac, 0.6);
  }
  function dockSign() { var dk = ctx && ctx.uiDock; return dk && dk.side === 'right' ? -1 : 1; }
  /** Ángulo inicial de la órbita final: en el campo de los ganadores, sin perdedores grandes ni oficiales delante, cerca de la cámara actual. */
  function overPick(g, w) {
    var t = g.teams[w], sd = w === 0 ? 1 : -1, best = 1e9, bA = K.overA0;
    visPos(t[0], OV0); visPos(t[1], OV1);
    var cx = (OV0.x + OV1.x) / 2, cy = (OV0.y + OV1.y) / 2, R = mx(5.6, hyp(OV0.x - OV1.x, OV0.y - OV1.y) * 0.75 + 3), pa = at2(P.y - cy, P.x - cx);
    for (var k = 0; k < 24; k++) {
      var a = k * PI / 12, X = cx + Math.cos(a) * R, Y = cy + Math.sin(a) * R, sc = Math.abs(wrap(a - pa)) * 8;
      if (X * sd < 1.2 || Math.abs(X) > K.bX - 0.5 || Math.abs(Y) > K.bY - 0.3) sc += 200;
      for (var i = 0; i < g.players.length; i++) {
        var q = g.players[i]; if (q.team === w) continue;
        visPos(q, VP2); var qd = hyp(VP2.x - X, VP2.y - Y), rel = Math.abs(wrap(at2(VP2.y - Y, VP2.x - X) - at2(cy - Y, cx - X)));
        if (rel < 0.6 && qd < R * 1.4) sc += 120 * (R * 1.4 - qd) / R;   // un perdedor dentro del cuadro y casi tan cerca como los ganadores
      }
      for (var o = 0; o < OBST.length; o++) { var dO = hyp(X - OBST[o][0], Y - OBST[o][1]); if (dO < 2.2) sc += (2.2 - dO) * 60; }
      if (sc < best) { best = sc; bA = a; }
    }
    return bA;
  }
  /** Fin de partido: órbita lenta alrededor de los ganadores, en su campo, con el FOV ajustado a los dos. */
  function overShot(g) {
    var dt = K.dt;
    K.overT += dt;
    var w = g.sets[0] >= g.sets[1] ? 0 : 1, t = g.teams[w], sd = w === 0 ? 1 : -1;
    // (posiciones VISUALES: la pareja se junta para celebrarlo, PLY-15)
    var a0 = visPos(t[0], OV0), a1 = visPos(t[1], OV1);
    var tx = (a0.x + a1.x) / 2, ty = (a0.y + a1.y) / 2, sep = hyp(a0.x - a1.x, a0.y - a1.y);
    var kk = dt > 0 ? mn(1, dt * 2) : 1;
    overC.x += (tx - overC.x) * kk; overC.y += (ty - overC.y) * kk; K.overSep += (sep - K.overSep) * kk;
    // radio según la separación de los ganadores (si se separan, la cámara se aleja: nada de suelo vacío)
    var R = mx(5.6, K.overSep * 0.75 + 3);
    var a = K.overA0 + Math.sin(K.overT * 0.22) * 0.6;
    D.x = overC.x + Math.cos(a) * R; D.y = overC.y + Math.sin(a) * R; D.z = 2.0 + 0.4 * Math.sin(K.overT * 0.31) + 0.08 * (R - 5.6);
    // siempre en el campo de los ganadores, sin cruzar la red
    if (D.x * sd < 1.2) D.x = sd * 1.2;
    // nunca pegada a uno de ellos (con la red al lado, la órbita podía dejar la cámara a 0,6 m)
    for (var i = 0; i < t.length; i++) {
      var q = t[i], ex = D.x - q.x, ey = D.y - q.y, el = hyp(ex, ey);
      if (el < 3.2) { var s = (3.2 - el) / mx(0.2, el); D.x += ex * s; D.y += ey * s; if (D.x * sd < 1.2) { D.x = sd * 1.2; D.y += (ey >= 0 ? 1 : -1) * (3.2 - el); } }
    }
    A.x = overC.x; A.y = overC.y; A.z = 1.15;
    // FOV que encuadra a los dos (ancho perpendicular a la mirada + margen) y su altura
    var vx = overC.x - D.x, vy = overC.y - D.y, vl = hyp(vx, vy) || 1;
    var perp = Math.abs(((a0.x - a1.x) * vy - (a0.y - a1.y) * vx) / vl);
    // (con el panel final acoplado a un lado, CAM-10: los dos caben en la parte LIBRE del cuadro; filmOffset en apply los centra en ella)
    var hHalf = Math.atan((perp / 2 + 1.1) / vl), vHalf = Math.atan(Math.tan(hHalf) / mx(0.6, aspect() * (1 - dockFrac())));
    var vNeed = mx(vHalf, Math.atan(1.6 / vl)) * 2 / DEG;
    K.fovWant = mn(mx(mx(fovFor(46), vNeed * 1.08), 40), 72);
  }

  /* ---------------- CAMBIO DE CAMPO (courtChange) ----------------
   * Es presentación (sim deja al humano en x > 0 y los controles no cambian). Plano de transición de retransmisión
   * en vez de volver al saque de golpe: el plano de reacción del punto se ve ~1,4 s (1,25 s a los 8 del 3r set),
   * CORTE a una grúa alta en la banda de la mesa (lado y > 0: la silla del 1r árbitro, al otro lado, no tapa la red)
   * sobre el campo rival, que recorre la banda hasta detrás de nuestro equipo bajando de 7,2 a 6,3 m y girando ~85°
   * (<= 45-53°/s; tope del rig 60°/s). Al empezar el saque, la grúa baja deslizando (1,4 s) al plano del saque: sin corte.
   * El ritmo se ajusta a la pausa real (sim: 3,6 s de juego tras el set con ×0,5 los primeros 0,8 s reales; 3,3 s a los 8). */
  /* ---------------- REVISIÓN DEL CHALLENGE (B5) ----------------
   * Mientras sim publica g.review = {x, y, t, dur, ...} (coords de simulación), corte a un plano «de tele»: la cámara se
   * coloca en la prolongación de la línea más cercana al bote y baja sobre la marca mirando a lo largo de la línea (la línea
   * queda vertical en el centro y la huella a un lado). Con Cámara estable (o reduced-motion) la bajada es corta y lenta.
   * Al acabar (g.review = null) vuelve por corte al flujo normal (punto o saque). Lectura defensiva: sin x/y válidos, nada. */
  var RV = { cutIn: false, cutOut: false, x: 0, y: 0, lx: 0, ly: 0, ax: 1, ay: 0, k: 0 };
  function reviewOn(g) {
    var r = g && g.review;
    return !!(r && typeof r.x === 'number' && typeof r.y === 'number' && r.x === r.x && r.y === r.y && !g.demo);
  }
  /** Línea más cercana al bote y lado desde el que se mira (una vez al entrar). */
  function reviewPlan(g) {
    var r = g.review, C0 = VB.C || {}, HL = g.HL || C0.HL || 9, HW = g.HW || C0.HW || 4.5; // (pista de la partida: 16×8 en la playa)
    var x = mn(mx(r.x, -HL - 3), HL + 3), y = mn(mx(r.y, -HW - 3), HW + 3);
    RV.x = x; RV.y = y;
    var sy = y >= 0 ? 1 : -1, sx = x >= 0 ? 1 : -1;
    if (Math.abs(HW - Math.abs(y)) <= Math.abs(HL - Math.abs(x))) {
      // banda: la línea va a lo largo de x; cámara en su prolongación, del lado del fondo (lejos de la red)
      RV.lx = x; RV.ly = sy * HW; RV.ax = sx; RV.ay = 0;
      // bote cerca de la red: mirando hacia ella el poste (y su protección) tapaba medio plano; la cámara se pone entre
      // la red y la marca mirando hacia el fondo (el poste queda detrás)
      if (Math.abs(x) >= 1.6 && Math.abs(x) < 4.5) RV.ax = -sx;
    } else {
      // fondo: la línea va a lo largo de y; cámara en su prolongación, hacia el centro de la pista (dentro del pabellón)
      RV.lx = sx * HL; RV.ly = y; RV.ax = 0; RV.ay = -sy;
    }
  }
  function reviewShot(g) {
    var r = g.review, dur = mx(1, +r.dur || 4.5), t = mx(0, +r.t || 0), calm = comfort();
    // bajada: ~55 % de la revisión (confort: más corta en recorrido y algo más lenta al empezar)
    var k = smooth01(t / (dur * (calm ? 0.45 : 0.55)));
    RV.k = k;
    var d0 = calm ? 4.2 : 5.6, d1 = 2.9, z0 = calm ? 2.9 : 5.4, z1 = 1.25;
    var dist = d0 + (d1 - d0) * k, h = z0 + (z1 - z0) * k;
    if (RV.ax && RV.ax * RV.x < 0) { // del lado de la red: sin cruzarla (a >= 0,9 m de ella); lo que falta de distancia, en altura
      var room = mx(0.7, Math.abs(RV.x) - 0.9);
      if (dist > room) { h += (dist - room) * 0.55; dist = room; }
    }
    // posición: sobre la prolongación de la línea (coordenada lateral = la de la línea), a 'dist' de la marca
    if (RV.ax) { D.x = RV.x + RV.ax * dist; D.y = RV.ly; }
    else { D.x = RV.lx; D.y = RV.y + RV.ay * dist; }
    D.z = h;
    // mira: entre la marca y la línea (las dos en cuadro), a ras de suelo
    A.x = RV.x * 0.6 + (RV.ax ? RV.x : RV.lx) * 0.4; A.y = RV.y * 0.6 + (RV.ax ? RV.ly : RV.y) * 0.4; A.z = 0.04;
    K.fovWant = fovFor(42 + (27 - 42) * k, 12, 20);
  }
  var CC = { on: false, t: 0, why: '', start: 1.45, len: 2.4, cut: false, u: 0 };
  // pausa del set recortada por el jugador (SIM-03 skipHold) antes de que la grúa acabe: la vuelta al saque es por CORTE
  // (deslizar desde el plano de reacción o desde media grúa barría media pista en diagonal alrededor de la red)
  var ccAbort = false;
  function courtPose(k, out, look) {
    // (mira casi fija cerca del centro: si la mira se moviera al revés que la grúa, el giro pasaría de 60°/s)
    // (y hasta 10,2 m: por encima de las vallas y antes de la grada; así el poste y el 2º árbitro no llenan el primer plano)
    // (grúa corta, tras el cierre del set con poca pausa: arco proporcional para no pasar de ~45°/s)
    var calm = comfort(), sw0 = mn(1, CC.len / 2.0), a0 = 40 * DEG + ((calm ? 90 : 108) - 40) * DEG * sw0, a1 = 40 * DEG;
    var a = a0 + (a1 - a0) * k;
    out.x = Math.cos(a) * 14.0; out.y = Math.sin(a) * 10.2; out.z = 7.2 - 0.9 * k;
    look.x = -0.8 - 0.7 * k; look.y = 0.5 * k; look.z = 0.9;
  }
  function courtShot(g) {
    var dt = K.dt;
    var u = mn(mx((CC.t - CC.start) / CC.len, 0), 1);
    // casi lineal: arranca ya en marcha (tras el corte) y frena algo al final, donde la recoge la bajada al saque.
    // Giro medido en el diseño: <= 45°/s tras un set (2,4 s) y <= 54°/s a los 8 (2,0 s)
    var k = 0.9 * u + 0.1 * (1 - (1 - u) * (1 - u));
    CC.u = u;
    courtPose(k, D, A);
    K.fovWant = fovFor(48 - 4 * k);
  }

  /* ---------------- CIERRE DE SET / PARTIDO (CAM-09) ----------------
   * 1) SEGUIMIENTO ('track'): en punto de set/partido, cuando el balón ya va bajando, le quedan <= 0,42 s de juego, cae en su
   *    lado (sin volver a cruzar la red), lejos de la línea (> 12 cm) y nadie que pueda tocarlo llega (alcance + plancha + carrera),
   *    el punto está decidido: cámara lenta (×0,28 partido / ×0,5 set) y CORTE a un plano bajo (1,15 m) y cerrado (FOV 34) del
   *    balón cayendo sobre su marca, de tres cuartos respecto a su trayectoria. Si alguien lo toca, se deshace (corte al juego y
   *    sin cámara lenta); si el punto no cierra el set (raro: antena…), sigue el plano del punto normal.
   *    Sin bote (falta de red, dobles…): 0,45 s de espera ('hold') y directamente al héroe.
   * 2) HÉROE ('hero'): corte a una órbita lenta (~6°/s) alrededor de los ganadores a 2,8-4,5 m, FOV 34-42, cámara a 1,4 m y las
   *    cabezas a 0,5 NDC (por debajo de la franja del rótulo, 0,75). Set: >= 1,8 s y luego la grúa del cambio de campo (corte).
   *    Partido: hasta que sale el panel final (luego 'over' se abre deslizando, CAM-10).
   * Para la UI: getShot() da 'clinch' en el seguimiento y 'point' (set) / 'over' (partido) en la órbita, con getDebug().pf de héroe
   * (el rótulo del set/partido evita sus cabezas); getDebug().clinch = {phase, left, team}; clinchLeft() = s reales que quedan. */
  var CL = { on: false, phase: '', t: 0.5, tg: 0.5, team: -1, match: false, lx: 0.5, ly: 0.5, tLand: 0.5, landed: false, sinceLand: 0.5, pointed: false,
             heroDur: 0.5, hero: null, mate: null, cx: 0.5, cy: 0.5, ang: 0.5, dir: 1, R: 3.2, camX: 0.5, camY: 0.5, camZ: 1.15, cutNow: false, abortCut: false,
             fov: 36.5, hx: 0.5, headN: -0.04, planned: false,
             // (pulido ola 3) sujeto del seguimiento (el defensor que no llega o el que golpeó: nada de suelo vacío), su peso en la mira,
             // ancla de la órbita del partido (de cara a donde miran los ganadores) y envolvente de la altura de sus manos (rótulo)
             subj: null, sw: 0.5, anc: 0.5, ancOk: false, ancT: 0.5, ancW: 0.5, hz0: 0.5, hz1: 0.5 };
  var CLX = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];   // (pruebas: getDebug().clinch.x)
  var HW3 = null;   // (THREE.Vector3 reutilizado: manos/pecho de los atletas en el cierre)
  var CLW = { why: 0 };
  var CLD = { phase: '', left: 0.5, team: -1, why: 0 }, CLP = { x: 0.5, y: 0.5, z: 0.5, t: 0.5 };
  /** ¿Está decidido el punto que cierra el set? (balón bajando, nadie llega). Arranca el seguimiento. */
  function clinchDetect(g) {
    if (CL.on || g.demo || g.mode !== 'rally' || ctx.state !== 'playing') { CLW.why = 1; return; }
    // punto de set: del marcador (como setupServe; así vale también si el marcador cambió durante el peloteo)
    var tgt = VB.Sim && VB.Sim.setTarget ? VB.Sim.setTarget(g) : (g.setNo === 3 ? 15 : 25), spT = -1;
    for (var st = 0; st < 2; st++) if (g.score[st] >= tgt - 1 && g.score[st] - g.score[1 - st] >= 1) spT = st;
    if (spT < 0) { CLW.why = 9; return; }
    var b = g.ball, S0 = VB.Sim;
    if (b.held || b.vz >= 0 || !S0 || !S0.predictLanding) { CLW.why = 2; return; }
    try { S0.predictLanding(g, CLP); } catch (e) { { CLW.why = 3; return; } }
    var pl = CLP;
    if (!(pl.t > 0.05 && pl.t <= 0.42) || pl.x !== pl.x) { CLW.why = 4; return; }
    if (b.x * pl.x <= 0 || Math.abs(pl.x) < 0.4 || (Math.abs(b.x) < 1.0 && b.z > 2.0)) { CLW.why = 5; return; }   // (sin volver a cruzar ni bloqueo posible)
    var C0 = VB.C || {}, HL = g.HL || C0.HL || 9, HW = g.HW || C0.HW || 4.5;
    var din = mn(HL - Math.abs(pl.x), HW - Math.abs(pl.y));
    if (Math.abs(din) < 0.12) { CLW.why = 6; return; }                                   // demasiado cerca de la línea para cantarlo
    var inside = din > 0, landTeam = pl.x > 0 ? 0 : 1, winner = inside ? 1 - landTeam : 1 - g.lastTeam;
    if (winner !== spT) { CLW.why = 7; return; }
    // nadie que pueda jugarlo llega: los del lado donde está el balón (salvo el que acaba de tocar, que no puede repetir)
    var sideTeam = b.x > 0 ? 0 : 1, reach = (C0.REACH || 1.35) + (C0.DIVE || 1.05), run = (C0.SPEED || 5.6) * 0.85;
    for (var i = 0; i < g.players.length; i++) {
      var q = g.players[i];
      if (q.team !== sideTeam || (q === g.lastPlayer && g.touchTeam === q.team)) continue;
      // distancia al tramo que le queda al balón (ahora -> bote), en planta
      var vx = pl.x - b.x, vy = pl.y - b.y, l2 = vx * vx + vy * vy, t = l2 > 1e-6 ? ((q.x - b.x) * vx + (q.y - b.y) * vy) / l2 : 1;
      t = mn(mx(t, 0), 1);
      if (hyp(b.x + vx * t - q.x, b.y + vy * t - q.y) < reach + run * pl.t * mx(t, 0.35) + 0.25) { CLW.why = 8; return; }
    }
    CL.on = true; CL.phase = 'track'; CL.t = 0; CL.tg = 0; CL.team = winner; CL.match = g.sets[winner] === 1;
    CL.lx = pl.x; CL.ly = pl.y; CL.tLand = pl.t; CL.landed = false; CL.sinceLand = 0; CL.pointed = false; CL.cutNow = true; CL.abortCut = false; CL.planned = false;
    CL.subj = clinchSubject(g, pl.x, pl.y); CL.sw = 0;
    clinchTrackPose(g);
    // cámara lenta YA: el balón cae a cámara lenta (en el punto se prolonga, ver 'point')
    VB.CameraRig.slowmo(CL.match ? 0.28 : 0.5, CL.match ? 1.9 : 1.0, CL.match ? 0.6 : 0.4);
  }
  /** Semiángulo VERTICAL equivalente (rad) que necesita la lente para ver el punto q desde D mirando con (yA, pA). */
  function clNeed(qx, qy, qz, yA, pA, asp) {
    var dx = qx - D.x, dy = qy - D.y, ha = Math.abs(wrap(at2(dy, dx) - yA));
    if (ha > 1.45) return 1.45;
    var va = Math.abs(at2(qz - D.z, mx(0.3, hyp(dx, dy) * Math.cos(ha))) - pA);
    return mx(va, Math.atan(Math.tan(ha) / asp));
  }
  /** Sujeto humano del seguimiento: el atleta (posición visual) más cercano a la marca en el campo donde cae (el defensor que
   *  no llega) si está a <= 7,5 m; si no, el que lo mandó allí (el rematador) a <= 11 m. null = no hay nadie razonable. */
  function clinchSubject(g, lx, ly) {
    var best = null, bd = 1e9, i, q;
    for (i = 0; i < g.players.length; i++) { q = g.players[i]; visPos(q, VP2); if (VP2.x * lx <= 0) continue; var d = hyp(VP2.x - lx, VP2.y - ly); if (d < bd) { bd = d; best = q; } }
    if (best && bd <= 7.5) return best;
    q = g.lastPlayer; if (q) { visPos(q, VP2); if (hyp(VP2.x - lx, VP2.y - ly) <= 11) return q; }
    return best && bd <= 10 ? best : null;
  }
  /** Sitio del plano de seguimiento: 24 ángulos × 3 distancias alrededor de la marca, a 1,15 m. Con sujeto (clinchSubject), el
   *  sitio también lo deja dentro del cuadro abierto (FOV <= 46) y a 2,6-10 m: mientras el balón cae se ve al atleta que no llega
   *  (o al que remató) y solo en los últimos ~0,3 s la mira se cierra sobre el balón y su marca. */
  function clinchTrackPose(g) {
    var b = g.ball, lx = CL.lx, ly = CL.ly, vh = hyp(b.vx, b.vy) || 1, ux0 = -b.vx / vh, uy0 = -b.vy / vh, asp = mx(1.1, aspect());
    var half = Math.atan(Math.tan(17 * DEG) * asp), halfW = Math.atan(Math.tan(23 * DEG) * asp), best = 1e9, bX = lx + 6, bY = ly;
    var Sb = CL.subj, sx = 0.5, sy = 0.5;
    if (Sb) { visPos(Sb, VP2); sx = VP2.x; sy = VP2.y; }
    for (var k = 0; k < 72; k++) {
      var th = (k % 24) * PI / 12, R = k < 24 ? 5.4 : k < 48 ? 6.6 : 7.8, ux = Math.cos(th), uy = Math.sin(th);
      var X = lx + ux * R, Y = ly + uy * R, sc = 0, o;
      if (Math.abs(X) > K.bX - 0.6 || Math.abs(Y) > K.bY - 0.3) continue;
      if (X * lx < 0 || Math.abs(X) < 1.3) sc += 400;                  // en el mismo campo que la marca, lejos de la red
      var a = Math.acos(mn(mx(ux * ux0 + uy * uy0, -1), 1)) / DEG;     // ángulo con "de vuelta hacia el que golpeó"
      sc += Math.abs(a - 55) * 0.8; if (a < 22) sc += 120;              // de tres cuartos; nunca con el balón viniendo de frente
      var mX = (lx + b.x) / 2, mY = (ly + b.y) / 2, yaw = at2(mY - Y, mX - X);
      var relB = Math.abs(wrap(at2(b.y - Y, b.x - X) - yaw)), relL = Math.abs(wrap(at2(ly - Y, lx - X) - yaw));
      if (relB > half * 0.78) sc += (relB - half * 0.78) / DEG * 8;
      if (relL > half * 0.78) sc += (relL - half * 0.78) / DEG * 8;
      for (o = 0; o < OBST.length; o++) {
        var dO = hyp(X - OBST[o][0], Y - OBST[o][1]) - OBST[o][2]; if (dO < 1.6) sc += (1.6 - dO) * 80;
        // (postes, silla y oficiales DENTRO del cuadro y cerca: el poste acolchado llenaba un lado del plano)
        if (dO < 8 && Math.abs(wrap(at2(OBST[o][1] - Y, OBST[o][0] - X) - yaw)) < half + 0.12) sc += (o < 4 ? 70 : 35) * (8 - dO) / 8;
      }
      var vx = lx - X, vy = ly - Y, vl2 = vx * vx + vy * vy;
      for (o = 0; o < g.players.length; o++) {
        var q = g.players[o], qd = hyp(q.x - X, q.y - Y);
        if (qd < 1.8) sc += (1.8 - qd) * 60;
        var t = ((q.x - X) * vx + (q.y - Y) * vy) / vl2;
        if (t > 0.05 && t < 0.95) { var dp = Math.abs((q.x - X) * vy - (q.y - Y) * vx) / sq(vl2); if (dp < 0.6) sc += 60 * (0.6 - dp) / 0.6; }
      }
      if (Sb) {
        // el sujeto, dentro del cuadro abierto que mira al 40 % entre balón/marca y él; ni encima de la cámara ni perdido al fondo
        var mXs = mX + (sx - mX) * 0.4, mYs = mY + (sy - mY) * 0.4, yS = at2(mYs - Y, mXs - X), dS = hyp(sx - X, sy - Y);
        var relS = Math.abs(wrap(at2(sy - Y, sx - X) - yS)), relB2 = Math.abs(wrap(at2(b.y - Y, b.x - X) - yS)), relL2 = Math.abs(wrap(at2(ly - Y, lx - X) - yS));
        if (relS > halfW * 0.8) sc += (relS - halfW * 0.8) / DEG * 6;
        // (y también en el acercamiento final, con la mira al 20 % hacia él: como mucho en el borde)
        var yS2 = at2(mY + (sy - mY) * 0.2 - Y, mX + (sx - mX) * 0.2 - X), relS2 = Math.abs(wrap(at2(sy - Y, sx - X) - yS2));
        if (relS2 > halfW * 0.92) sc += (relS2 - halfW * 0.92) / DEG * 5;
        if (relB2 > halfW * 0.8) sc += (relB2 - halfW * 0.8) / DEG * 6;
        if (relL2 > halfW * 0.8) sc += (relL2 - halfW * 0.8) / DEG * 6;
        if (dS < 2.6) sc += (2.6 - dS) * 60; else if (dS > 10) sc += (dS - 10) * 8;
      }
      if (R > 7) sc += 6;   // (el anillo lejano solo si los cercanos no sirven)
      if (sc < best) { best = sc; bX = X; bY = Y; }
    }
    CL.camX = bX; CL.camY = bY; CL.camZ = 1.15;
  }
  /** Al héroe: plan del sitio inicial de la órbita (y, en el set, la coreografía con players vía planHeroShot / heroShot()). */
  /** Plan del héroe EN EL PUNTO (players lee la coreografía de heroShot() ~0,12 s después: de cara a la cámara, el compañero al lado). */
  function clinchPlan(g) {
    var w = CL.team, t = g.teams[w];
    var hero = pickHero(g, w, pointHow || inferHow(g));
    if (!hero || hero.team !== w) hero = t[0];
    CL.hero = hero; CL.mate = mateIn(g, w, hero);
    // el mejor ángulo del plano de héroe (de frente, sin perdedores grandes, sin postes ni oficiales): la órbita empieza ahí, más cerca
    planHeroShot(g, hero, w);
    if (g.mode !== 'point') HS.on = false;                              // (en el partido players ya no converge: no se publica)
    CL.cx = PF.c0x; CL.cy = PF.c0y; CL.ang = PF.ang; CL.R = 3.2; CL.fov = 38;
    // sentido de la órbita: hacia donde la cámara se aleja de la red y de los postes
    var a1 = CL.ang + 0.3, a0 = CL.ang - 0.3, s1 = 0, s0 = 0, sd = w === 0 ? 1 : -1;
    var x1 = CL.cx + Math.cos(a1) * 3.2, y1 = CL.cy + Math.sin(a1) * 3.2, x0 = CL.cx + Math.cos(a0) * 3.2, y0 = CL.cy + Math.sin(a0) * 3.2;
    s1 = x1 * sd - Math.abs(y1) * 0.3; s0 = x0 * sd - Math.abs(y0) * 0.3;
    CL.dir = s1 >= s0 ? 1 : -1;
    CL.planned = true;
  }
  function clinchToHero(g) {
    if (!CL.planned) clinchPlan(g);
    else { visPos(CL.hero, VP); visPos(CL.mate, VQ); var sp = hyp(VP.x - VQ.x, VP.y - VQ.y), wm = sp < 3.4 ? 0.5 : 0.3; CL.cx = VP.x + (VQ.x - VP.x) * wm; CL.cy = VP.y + (VQ.y - VP.y) * wm; }
    // set: lo que quepa entre 1,8 y 2,4 s dejando >= 1,6 s a la grúa (y 0,3 de margen); partido: hasta el panel
    var left = typeof g.timer === 'number' && g.timer > 0 ? gameToReal(g.timer) : 2.5;
    CL.heroDur = CL.match ? 99 : mn(mx(left - 0.3 - 1.6, 1.85), 2.4);
    if (BRK === 'clinch') CL.heroDur = 0.5;
    CL.phase = 'hero'; CL.t = 0; CL.cutNow = true; CL.ancOk = false; CL.subj = null;
  }
  function clinchEnd() { CL.on = false; CL.phase = ''; CL.subj = null; }
  /** Posición/mira deseadas del plano de cierre. */
  function clinchShot(g) {
    var dt = K.dt, b = g.ball;
    if (CL.phase === 'track' || CL.phase === 'hold') {
      if (CL.phase === 'hold') {   // (sin bote: la cámara se queda y mira hacia el balón, como el plano del punto)
        D.x = P.x; D.y = P.y; D.z = P.z; A.x = L.x + (b.x - L.x) * 0.3; A.y = L.y + (b.y - L.y) * 0.3; A.z = L.z + (0.8 - L.z) * 0.3; K.fovWant = K.fovCur;
        return;
      }
      D.x = CL.camX; D.y = CL.camY; D.z = CL.camZ;
      // mira: entre la marca y el balón (al botar, más hacia la marca); FOV 34 (hasta 36 si el balón aún va alto)
      var k = CL.landed ? 0.35 : 0.5;
      var Bx = CL.lx + (b.x - CL.lx) * k, By = CL.ly + (b.y - CL.ly) * k, Bz = 0.2 + (b.z - 0.2) * k;
      var dd = mx(1, hyp(Bx - D.x, By - D.y)), need = 2 * Math.atan((Math.abs(b.z - 0.2) * 0.5 + 0.4) / dd) / DEG;
      var fov0 = mn(mx(34, need / 0.8), 36);
      // con sujeto: la mira va al 42 % hacia su pecho y la lente abre lo justo para que quepan él, el balón y la marca; en los
      // últimos ~0,3 s reales antes del bote se cierra sobre el balón (y tras el bote vuelve a abrir un poco: su reacción)
      var Sb = CL.subj, wS = 0;
      // (el sujeto nunca sale del todo: en el acercamiento al bote su peso baja a 0,28 y la lente lo deja como mucho en el borde)
      var push = 0;
      if (Sb) {
        if (CL.landed) { push = 1 - smooth01((CL.sinceLand - 0.05) / 0.35); wS = 0.28 + 0.04 * (1 - push); }
        else { push = 1 - smooth01((gameToReal(mx(0, CL.tLand - CL.tg)) - 0.1) / 0.3); wS = 0.28 + 0.14 * (1 - push); }
      }
      CL.sw = wS;
      if (wS < 0.01) { A.x = Bx; A.y = By; A.z = Bz; K.fovWant = fov0; return; }
      visPos(Sb, VP2);
      var Hs = heightOf(Sb), sz = VP2.z + Hs * 0.52, Sr = VB.Players && VB.Players.rigOf ? VB.Players.rigOf(Sb) : null;
      if (Sr && Sr.chest && ctx.THREE) { if (!HW3) HW3 = new ctx.THREE.Vector3(); Sr.chest.getWorldPosition(HW3); sz = HW3.y; }
      A.x = Bx + (VP2.x - Bx) * wS; A.y = By + (VP2.y - By) * wS; A.z = Bz + (sz - Bz) * wS;
      var yA = at2(A.y - D.y, A.x - D.x), pA = at2(A.z - D.z, mx(0.5, hyp(A.x - D.x, A.y - D.y))), asp = mx(0.6, aspect());
      var nB = mx(clNeed(b.x, b.y, b.z, yA, pA, asp), clNeed(CL.lx, CL.ly, 0.1, yA, pA, asp));
      var nS = mx(clNeed(VP2.x, VP2.y, sz + Hs * 0.45, yA, pA, asp), clNeed(VP2.x, VP2.y, mx(0, sz - Hs * 0.5), yA, pA, asp));
      var fB = 2 * Math.atan(Math.tan(nB) / 0.8) / DEG, fS = 2 * Math.atan(Math.tan(nS) / (0.86 + 0.12 * push)) / DEG;
      K.fovWant = mn(mx(mx(fov0, fB), fS), 54);
      return;
    }
    // ÓRBITA DE LOS GANADORES
    var h = CL.hero, m = CL.mate;
    visPos(h, VP); visPos(m, VQ);
    // (partido: la pareja SIEMPRE centrada, los dos tienen que caber; en el set manda el que anotó)
    var sep = hyp(VP.x - VQ.x, VP.y - VQ.y), wM = CL.match || sep < 3.4 ? 0.5 : 0.3;
    var tx = VP.x + (VQ.x - VP.x) * wM, ty = VP.y + (VQ.y - VP.y) * wM, kk = dt > 0 ? mn(1, dt * 1.6) : 1;
    CL.cx += (tx - CL.cx) * kk; CL.cy += (ty - CL.cy) * kk;
    if (CL.match) {
      // PARTIDO: players no sigue la coreografía del héroe; tras el choque de pecho los dos se quedan de cara el uno al otro con la
      // cabeza hacia la grada de su banda. El frente de la pareja es la perpendicular a la línea que los une, del lado de esa grada
      // (perfiles abiertos a cámara, sin que uno tape al otro); si players los gira hacia la cámara (los dos frentes a < 100° entre sí),
      // manda su frente medio. Ancla con giro limitado (25°/s) y sin saltos de lado; la órbita oscila ±22° alrededor de ella.
      var lnx = VQ.x - VP.x, lny = VQ.y - VP.y, ll = hyp(lnx, lny), Mx = (VP.x + VQ.x) * 0.5, My = (VP.y + VQ.y) * 0.5;
      var Tx = Mx * 0.15, Ty = (My >= 0 ? 1 : -1) * 13 - My, na, fh2 = faceOf(h), fm2 = faceOf(m);
      if (ll > 0.35) {
        var nx = -lny / ll, ny = lnx / ll, nd = nx * Tx + ny * Ty;
        if (nd < 0) { nx = -nx; ny = -ny; nd = -nd; }
        na = at2(ny, nx);
        if (CL.ancOk && Math.abs(wrap(na - CL.anc)) > PI / 2 && nd < 0.35 * hyp(Tx, Ty)) na = wrap(na + PI);
      } else na = at2(Ty, Tx);
      // (si players los gira hacia la cámara tras el choque —los dos frentes a < 60° entre sí y ya no de cara el uno al otro—, manda su
      // frente medio; antes del choque faceOf es aún el frente del bote y no vale)
      if (CL.t > 1.2 && Math.abs(wrap(fh2 - fm2)) < 60 * DEG) na = at2(Math.sin(fh2) + Math.sin(fm2), Math.cos(fh2) + Math.cos(fm2));
      // (la dirección preferida no siempre es un sitio válido: cerca de la red apunta al otro campo. Se busca el mejor sitio en
      // ±90° de ella —y de su opuesta, con castigo— cada 0,25 s, con histéresis)
      CL.ancT -= dt;
      if (!CL.ancOk || dt <= 0 || CL.ancT <= 0) { na = clAnchor(g, h, m, na, CL.ancOk ? CL.anc : NaN); CL.ancT = 0.25; CL.ancW = na; } else na = CL.ancW;
      if (!CL.ancOk || dt <= 0) { CL.anc = na; if (!CL.ancOk) CL.ang = na; CL.ancOk = true; }
      else { var da = wrap(na - CL.anc), mxa = 25 * DEG * dt; CL.anc = wrap(CL.anc + mn(mx(da, -mxa), mxa)); }
      if (dt > 0) {
        var offA = wrap(CL.ang - CL.anc), rateA = (comfort() ? 3 : 6) * DEG;
        if (Math.abs(offA) > 40 * DEG) { CL.dir = offA > 0 ? -1 : 1; rateA = (comfort() ? 6 : 14) * DEG; }
        else if (Math.abs(offA) > 22 * DEG && offA * CL.dir > 0) CL.dir = -CL.dir;
        CL.ang += CL.dir * rateA * dt;
      }
    } else
    // órbita lenta (~6°/s) que busca las caras: dentro del cono de ±35° del frente medio de la pareja sigue su sentido; al salir, da la
    // vuelta; si ya está fuera (> 50°, se giraron a la grada), vuelve hacia el frente a 9°/s. Siempre en movimiento.
    if (dt > 0) {
      var fh = faceOf(h), fm = faceOf(m), ffx = Math.cos(fh) + 0.6 * Math.cos(fm), ffy = Math.sin(fh) + 0.6 * Math.sin(fm);
      var off = wrap(CL.ang - at2(ffy, ffx)), rate = (comfort() ? 3 : 6) * DEG;
      if (Math.abs(off) > 50 * DEG) { CL.dir = off > 0 ? -1 : 1; rate = (comfort() ? 4 : 9) * DEG; }
      else if (Math.abs(off) > 35 * DEG && off * CL.dir > 0) CL.dir = -CL.dir;
      CL.ang += CL.dir * rate * dt;
    }
    var sd = CL.team === 0 ? 1 : -1, asp = aspect();
    // FOV para los dos (ancho perpendicular a la mirada + margen) entre 34 y 42; si no caben, la cámara se aleja (hasta 4,5 m; 5,6 en el
    // partido, con la pareja aún separada al cortar)
    var ux = Math.cos(CL.ang), uy = Math.sin(CL.ang), perp = Math.abs(-(VP.x - VQ.x) * uy + (VP.y - VQ.y) * ux);
    var Rw = mn(mx((perp * 0.5 + (CL.match ? 0.9 : 0.6)) / (Math.tan(19 * DEG) * mx(1, asp)), CL.match ? 3.6 : 2.8), CL.match ? 5.6 : 4.5);   // (los dos en ±(19° vertical × aspecto))
    if (dt > 0) CL.R += (Rw - CL.R) * mn(1, dt * 1.5); else CL.R = Rw;
    var X = CL.cx + ux * CL.R, Y = CL.cy + uy * CL.R;
    // en el campo de los ganadores, dentro del pabellón y lejos de los demás jugadores y de postes/oficiales
    if (X * sd < 1.0) X = sd * 1.0;
    for (var i = 0; i < g.players.length; i++) {
      var q = g.players[i], win = q === h || q === m, rq = win ? (CL.match ? 3.3 : 2.6) : 1.6;   // (los ganadores, a >= 2,6 m: si uno viene hacia la cámara, se aparta)
      visPos(q, VP2); var ex = X - VP2.x, ey = Y - VP2.y, el = hyp(ex, ey);
      if (el < rq) { var s = (rq - el) / mx(0.2, el); X += ex * s; Y += ey * s; continue; }
      if (el < 1.6) { var s = (1.6 - el) / mx(0.2, el); X += ex * s; Y += ey * s; }
    }
    for (var o = 0; o < OBST.length; o++) {
      var ox = X - OBST[o][0], oy = Y - OBST[o][1], ol = hyp(ox, oy), need2 = OBST[o][2] + 1.2;
      if (ol < need2) { var so = (need2 - ol) / mx(0.2, ol); X += ox * so; Y += oy * so; }
    }
    X = mn(mx(X, -(K.bX - 0.4)), K.bX - 0.4); Y = mn(mx(Y, -(K.bY - 0.2)), K.bY - 0.2);
    D.x = X; D.y = Y; D.z = 1.2;   // (algo por debajo de las cabezas: plano heroico, mirando un poco hacia arriba)
    var vx = CL.cx - X, vy = CL.cy - Y, vl = mx(0.5, hyp(vx, vy));
    var perp2 = Math.abs(((VP.x - VQ.x) * vy - (VP.y - VQ.y) * vx) / vl), hw = perp2 * 0.5 + (CL.match ? 0.9 : 0.55);   // (partido: brazos abiertos y cuerpo entero a los lados)
    var fv = 2 * Math.atan(Math.tan(Math.atan(hw / vl)) / asp) / DEG;
    K.fovWant = mn(mx(fv, 34), CL.match ? 46 : 42);
    // cabezas a 0,5 NDC (franja del rótulo arriba libre)
    var tanH = Math.tan(K.fovWant * DEG / 2), Hh = mx(heightOf(h), heightOf(m));
    // cabezas por debajo del rótulo grande del set/partido (VB.UI.bannerRect, ~el 35 % de arriba en 16:9): ~0,2 NDC por defecto (aire
    // arriba para el rótulo, como en televisión) y, con el rótulo ya puesto, 0,1 NDC por debajo de su borde inferior (0..0,5)
    // (la UI puede ponerlo al 4 % o al 17 % de arriba y mide ~0,3 del alto: con las cabezas justo bajo el centro no lo pisan nunca)
    var hT = -0.04, handT = 0.86;
    try { var brc = VB.UI && VB.UI.bannerRect ? VB.UI.bannerRect() : null; if (brc && brc.bottom > 0 && ctx.height > 0 && brc.top < ctx.height * 0.2) { hT = mn(0.3, mx(-0.15, 1 - 2 * brc.bottom / ctx.height - 0.12)); handT = 1 - 2 * brc.bottom / ctx.height - 0.07; } } catch (e) { }
    if (dt > 0) CL.headN += (hT - CL.headN) * mn(1, dt * 2.2); else CL.headN = hT;
    // (manda la cabeza MÁS ALTA en el cuadro: la del ganador más cercano a la cámara)
    var yv = at2(vy, vx), hfw = Math.atan(tanH * asp) + 0.08, aHd = at2(Hh - D.z, vl), aHn = -9;
    var rh = Math.abs(wrap(at2(VP.y - Y, VP.x - X) - yv)), rm = Math.abs(wrap(at2(VQ.y - Y, VQ.x - X) - yv));
    // MANOS: envolvente de la altura de las manos de cada ganador (sube al momento, baja a 0,6 m/s: sin cabeceo con cada salto); en el
    // partido, al menos los brazos arriba de la celebración. Los brazos levantados nunca pasan por detrás del rótulo (handT, ~3,5 % del
    // alto por debajo de su borde)
    var z0 = clHandZ(h, CL.match), z1 = clHandZ(m, CL.match);
    if (dt > 0) { CL.hz0 = mx(z0, CL.hz0 - 0.6 * dt); CL.hz1 = mx(z1, CL.hz1 - 0.6 * dt); } else { CL.hz0 = z0; CL.hz1 = z1; }
    if (rh < hfw) { var dh0 = mx(0.8, hyp(VP.x - X, VP.y - Y) * Math.cos(rh)); aHd = mx(aHd, at2(heightOf(h) - D.z, dh0)); aHn = mx(aHn, at2(CL.hz0 - D.z, dh0)); }
    if (rm < hfw) { var dm0 = mx(0.8, hyp(VQ.x - X, VQ.y - Y) * Math.cos(rm)); aHd = mx(aHd, at2(heightOf(m) - D.z, dm0)); aHn = mx(aHn, at2(CL.hz1 - D.z, dm0)); }
    var pitch = aHd - Math.atan(CL.headN * tanH), yaw = yv;
    if (aHn > -9) {
      pitch = mx(pitch, aHn - Math.atan(handT * tanH));
      // de las manos arriba a la cadera tiene que caber: si con esta lente la cadera del más cercano se sale por abajo (< -0,8 NDC),
      // se abre la lente (hasta 50°) con las manos en handT y la cadera en -0,8 (fit2)
      var aHip = 9;
      if (rh < hfw) aHip = mn(aHip, at2(VP.z + heightOf(h) * 0.5 - D.z, mx(0.8, hyp(VP.x - X, VP.y - Y) * Math.cos(rh))));
      if (rm < hfw) aHip = mn(aHip, at2(VQ.z + heightOf(m) * 0.5 - D.z, mx(0.8, hyp(VQ.x - X, VQ.y - Y) * Math.cos(rm))));
      if (aHip < 9 && Math.tan(pitch - aHip) / tanH > 0.8 && handT > 0.1) {
        var ft2 = fit2(aHn, handT, aHip, -0.8), fovFit = mn(2 * Math.atan(ft2.t) / DEG, 50);
        if (fovFit > K.fovWant) { K.fovWant = fovFit; tanH = Math.tan(K.fovWant * DEG / 2); pitch = mx(aHd - Math.atan(CL.headN * tanH), aHn - Math.atan(handT * tanH)); }
      }
    }
    CLX[0] = aHd; CLX[1] = aHn; CLX[2] = pitch; CLX[3] = handT; CLX[4] = CL.headN; CLX[5] = CL.hz0; CLX[6] = CL.hz1; CLX[7] = vl; CLX[8] = CL.anc; CLX[9] = CL.ang;
    // deriva lenta de la mira (cámara "viva", ±2,6°): aunque el muro de 2,6 m de un ganador frene la órbita, el plano nunca se queda quieto
    if (!comfort()) yaw += 0.045 * Math.sin(CL.t * 0.8) + 0.022 * Math.sin(CL.t * 1.9 + 1.1);
    var cp = Math.cos(pitch);
    A.x = D.x + Math.cos(yaw) * cp * vl; A.y = D.y + Math.sin(yaw) * cp * vl; A.z = D.z + Math.sin(pitch) * vl;
    // para la UI (rótulo y marcador): dónde queda el que anotó en NDC x
    var tw = Math.tan(K.fovWant * DEG / 2) * asp;
    CL.hx = Math.tan(wrap(at2(VP.y - Y, VP.x - X) - yaw)) / tw;
  }
  /** Ancla de la órbita del partido: el ángulo (desde la pareja hacia la cámara) más cercano a `pref` con un sitio válido a la
   *  distancia de la órbita: en el campo de los ganadores lejos de la red, dentro del pabellón, sin postes ni oficiales al lado, sin
   *  perdedores cerca de la cámara ni entre ella y la pareja. `cur` (o NaN): el ancla actual, que solo cambia si la nueva gana por 8. */
  function clAnchor(g, h, m, pref, cur) {
    visPos(h, VP); visPos(m, VQ);
    var cx = (VP.x + VQ.x) * 0.5, cy = (VP.y + VQ.y) * 0.5, sd = CL.team === 0 ? 1 : -1, R0 = mn(mx(CL.R, 3.2), 4.6);
    var best = pref, bs = 1e9, cs = 1e9;
    for (var k = 0; k < 38; k++) {
      var opp = k >= 19, a = wrap(pref + (opp ? PI : 0) + ((k % 19) - 9) * 10 * DEG), s = clAnchorPen(g, cx, cy, a, R0, sd, h, m);
      s += Math.abs(wrap(a - pref)) / DEG * 0.35 + (opp ? 12 : 0);
      if (s < bs) { bs = s; best = a; }
    }
    if (cur === cur) { cs = clAnchorPen(g, cx, cy, cur, R0, sd, h, m) + Math.abs(wrap(cur - pref)) / DEG * 0.35; if (cs <= bs + 8) return cur; }
    return best;
  }
  function clAnchorPen(g, cx, cy, a, R0, sd, h, m) {
    var X = cx + Math.cos(a) * R0, Y = cy + Math.sin(a) * R0, s = 0, o;
    if (X * sd < 1.6) s += (1.6 - X * sd) * 45;
    if (Math.abs(X) > K.bX - 0.8) s += (Math.abs(X) - K.bX + 0.8) * 45;
    if (Math.abs(Y) > K.bY - 0.5) s += (Math.abs(Y) - K.bY + 0.5) * 45;
    for (o = 0; o < OBST.length; o++) { var dO = hyp(X - OBST[o][0], Y - OBST[o][1]) - OBST[o][2]; if (dO < 1.4) s += (1.4 - dO) * 40; }
    var vx = cx - X, vy = cy - Y, vl2 = vx * vx + vy * vy;
    for (o = 0; o < g.players.length; o++) {
      var q = g.players[o]; if (q === h || q === m) continue;
      visPos(q, VP2); var dq = hyp(VP2.x - X, VP2.y - Y); if (dq < 2.6) s += (2.6 - dq) * 30;
      var t = ((VP2.x - X) * vx + (VP2.y - Y) * vy) / vl2;
      if (t > 0 && t < 1.15) { var dp = Math.abs((VP2.x - X) * vy - (VP2.y - Y) * vx) / sq(vl2); if (dp < 1.0) s += 30 * (1 - dp); }
    }
    return s;
  }
  /** Altura (m) de la mano más alta del atleta (sin rig: 1,25 × su altura); en la victoria, al menos los brazos arriba. */
  function clHandZ(p, armsUp) {
    var Pl = VB.Players, z = -1, H = heightOf(p);
    try {
      if (Pl && Pl.handWorld && ctx.THREE) {
        if (!HW3) HW3 = new ctx.THREE.Vector3();
        var a = Pl.handWorld(p, true, HW3); if (a) z = a.y;
        a = Pl.handWorld(p, false, HW3); if (a && a.y > z) z = a.y;
      }
    } catch (e) { z = -1; }
    if (!(z > 0)) z = H * 1.25;
    return armsUp ? mx(z, p.z + H * 1.22) : z;
  }
  var VP2 = V(), clinchPlanSoon = false;
  /** Fases del cierre (rdt = s reales; 0 en pausa). */
  function clinchTick(g, rdt) {
    CL.t += rdt; CL.tg += rdt * (ctx.timeScale || 0);
    if (CL.landed) CL.sinceLand += rdt;
    if (CL.phase === 'track') {
      // nadie lo tocó pero el punto no llega (la predicción falló): se deshace por corte, sin cámara lenta
      if (!CL.pointed && CL.tg > CL.tLand + 0.5) { clinchEnd(); CL.abortCut = true; slow.t = 0; ctx.timeScale = 1; return; }
      if (CL.pointed && CL.landed && CL.sinceLand >= (CL.match ? 0.75 : 0.4)) clinchToHero(g);
    } else if (CL.phase === 'hold') {
      if (CL.t >= 0.45) clinchToHero(g);
    } else if (CL.phase === 'hero') {
      if (CL.match) { if (ctx.state === 'over' && !ctx.endHold) clinchEnd(); }   // (sale el panel final: 'over' se abre deslizando)
      else if (CL.t >= CL.heroDur && g.mode === 'point') {
        // a la grúa del cambio de campo con lo que quede de pausa; si no da para >= 1,2 s, la órbita sigue hasta el saque (corte)
        var lf = typeof g.timer === 'number' ? gameToReal(mx(0, g.timer)) - 0.3 : 0;
        if (CC.on && lf >= 0.95) { CC.start = CC.t; CC.len = mn(lf, 2.8); clinchEnd(); }
        else { CC.on = false; CL.heroDur = 99; }
      }
    }
    if (CL.on && (g.mode === 'serve' || g.mode === 'rally' && CL.phase !== 'track')) clinchEnd();
  }
  /** s reales que quedan de la secuencia (0 = no hay). */
  function clinchLeftS(g) {
    if (!CL.on) return 0;
    var sinceNeed = CL.match ? 0.75 : 0.4;
    if (CL.phase === 'track') return (CL.landed ? mx(0, sinceNeed - CL.sinceLand) : gameToReal(mx(0, CL.tLand - CL.tg)) + sinceNeed) + (CL.match ? 2.5 : 1.8);
    if (CL.phase === 'hold') return mx(0, 0.45 - CL.t) + (CL.match ? 2.5 : 1.8);
    if (CL.match) return g && g.mode === 'over' && typeof g.timer === 'number' ? gameToReal(mx(0, g.timer)) + (ctx.endHold ? 0 : 0) : 0.5;
    return mx(0, CL.heroDur - CL.t);
  }

  /* ---------------- CUTAWAY AL SACADOR RIVAL (CAM-14) ----------------
   * Saque de la CPU tras un punto (no tras la grúa del set ni el cierre): en vez de volver directamente a la cámara de recepción,
   * CORTE a un plano corto del sacador (FOV 30, ~45 % del alto, de perfil / tres cuartos de frente junto a su línea de fondo, cámara a
   * 1,3 m) mientras hace su ritual (SIM-04, botes), con un leve acercamiento; y CORTE a la cámara de recepción YA asentada >= 0,55 s antes
   * del lanzamiento (g.cpuTossIn). Duración 0,95-1,4 s; si no hay tiempo (< 0,85 s), no hay cutaway. Base de control congelada (el
   * receptor no se mueve en el saque rival hasta el lanzamiento). getShot() 'cutaway'; lastCut.kind 'serve' al entrar (sale del punto)
   * y 'cutaway' al volver a la cámara de recepción (corte seco). */
  var CW = { on: false, t: 0.5, dur: 0.5, x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5, z: 1.3, side: 1, sv: null, cutIn: false, cutOut: false };
  /** ¿Habrá cutaway en la vuelta al saque? (para anunciar el corte durante el punto) */
  function cutawayNext(g) {
    return !!(g && !g.demo && ctx.state === 'playing' && g.mode === 'point' && g.serving === 1 && !g.pendingSet && !CL.on && !CC.on && g.ritual !== undefined);
  }
  /** Arranca el cutaway en el serveReady del rival (si hay tiempo hasta el lanzamiento). */
  function cutawayStart(g) {
    var sv = g.server; if (!sv || sv.team !== 1 || !(typeof g.cpuTossIn === 'number' && g.cpuTossIn > 0)) return false;
    var dur = gameToReal(g.cpuTossIn) - 0.55;
    if (dur < 0.85) return false;
    dur = mn(dur, 1.4);
    var H = heightOf(sv), asp = mx(1.1, aspect()), tanV = Math.tan(15 * DEG), best = 1e9, bX = 0, bY = 0, bD = 7;
    var sdF = sv.team === 0 ? PI : 0;   // (mira hacia la red: equipo 1 hacia +x)
    for (var k = 0; k < 16; k++) {
      var th = sdF + (k & 1 ? -1 : 1) * (55 + 10 * (k >> 1)) * DEG;   // ±55°…±125° de su frente (de tres cuartos de frente a tres cuartos de espaldas)
      for (var fi = 0; fi < 2; fi++) {
        var frac = fi ? 0.5 : 0.45, d = H / (frac * 2 * tanV), X = sv.x + Math.cos(th) * d, Y = sv.y + Math.sin(th) * d, sc = 0, o;
        if (Math.abs(X) > K.bX - 0.5 || Math.abs(Y) > K.bY - 0.3) continue;
        var rel = Math.abs(wrap(th - sdF)) / DEG; sc += Math.abs(rel - 75) * 0.6 + (fi ? 6 : 0);
        var yawH = at2(sv.y - Y, sv.x - X), half = Math.atan(tanV * asp);
        for (o = 0; o < OBST.length; o++) {
          var ox = OBST[o][0] - X, oy = OBST[o][1] - Y, od = hyp(ox, oy) - OBST[o][2];
          if (od < 1.8) sc += (1.8 - od) * 80;
          if (od < 9 && od < d + 1 && Math.abs(wrap(at2(oy, ox) - yawH)) < half + 0.1) sc += 50 * (9 - od) / 9;   // (juez de línea, poste… delante)
        }
        for (o = 0; o < g.players.length; o++) {
          var q = g.players[o]; if (q === sv) continue;
          var qd = hyp(q.x - X, q.y - Y); if (qd < 2) sc += (2 - qd) * 60;
          if (qd < d * 1.3 && Math.abs(wrap(at2(q.y - Y, q.x - X) - yawH)) < half) sc += 40 * (d * 1.3 - qd) / d;   // (nadie grande en el cuadro)
        }
        if (sc < best) { best = sc; bX = X; bY = Y; bD = d; }
      }
    }
    if (best > 400) return false;
    CW.on = true; CW.t = 0; CW.dur = dur; CW.sv = sv;
    // leve acercamiento (0,35 m) durante el plano
    var ux = (sv.x - bX) / bD, uy = (sv.y - bY) / bD;
    CW.x0 = bX; CW.y0 = bY; CW.x1 = bX + ux * 0.35; CW.y1 = bY + uy * 0.35; CW.z = 1.3;
    // aire hacia donde mira (la red): si hacia la red es la derecha de la pantalla, él a la izquierda (y al revés)
    var yawV = at2(uy, ux), rx = Math.sin(yawV);
    CW.side = (sdF === 0 ? rx : -rx) > 0 ? -1 : 1;
    return true;
  }
  function cutawayShot(g) {
    var sv = CW.sv || g.server, u = smooth01(CW.t / mx(0.1, CW.dur));
    D.x = CW.x0 + (CW.x1 - CW.x0) * u; D.y = CW.y0 + (CW.y1 - CW.y0) * u; D.z = CW.z;
    K.fovWant = fovFor(30, 20, 24);
    var tanH = Math.tan(K.fovWant * DEG / 2), dd = mx(1, hyp(sv.x - D.x, sv.y - D.y));
    var yaw = at2(sv.y - D.y, sv.x - D.x) + CW.side * Math.atan(0.22 * tanH * aspect());
    // cuerpo centrado en vertical (cadera a ~0 NDC): cabeza a ~0,45, pies a ~-0,45; el bote cae delante, abajo
    var pitch = at2(sv.z + 0.95 - D.z, dd * Math.cos(Math.atan(0.22 * tanH * aspect()))), cp = Math.cos(pitch);
    A.x = D.x + Math.cos(yaw) * cp * dd; A.y = D.y + Math.sin(yaw) * cp * dd; A.z = D.z + Math.sin(pitch) * dd;
  }

  /* ---------------- PRESENTACIÓN DEL PARTIDO (UI-14 / CAM-16: VB.CameraRig.playIntro) ----------------
   * Bajo la tarjeta de presentación (la sim está parada en 'serve') un movimiento de establecimiento que ACABA en el encuadre del primer
   * saque: arranca alta y abierta en la esquina de nuestro fondo, del lado de la mesa (pabellón lleno, los dos campos, la red), y baja en
   * grúa con una sola curva de mínimo tirón (posición, mira y FOV a la vez) hasta la cámara del saque ya asentada (calculada una vez al
   * empezar, con el mismo encuadre fino). Al acabar no hay corte: la cámara ya está en su sitio (< 0,1 m) y sigue el plano del saque.
   * Si la tarjeta se salta (playIntro(0)), corte al saque asentado con lastCut.kind 'serve' (lo tapa la cortinilla de UI-13). */
  var INTRO = { on: false, t: 0.5, dur: 2.5, cut: false, cutIn: false, plan: false, done: false, handoff: false,
                p0x: 0.5, p0y: 0.5, p0z: 0.5, l0x: 0.5, l0y: 0.5, l0z: 0.5, f0: 50.5, p1x: 0.5, p1y: 0.5, p1z: 0.5, l1x: 0.5, l1y: 0.5, l1z: 0.5, f1: 40.5,
                exP: 0.5, exY: 0.5, boost: 0.5, tshot: '' };
  /** Destino del movimiento: el plano del saque asentado (settle con ese plano), y el arranque alto en la esquina. */
  function introPlan(g) {
    var tsh = g.serving === 0 ? 'serveUs' : 'serveThem', s0 = shot;
    shot = tsh; settle(g); shot = s0;
    // (la mira del destino ya lleva el encuadre fino: giro/cabeceo extra; FOV con la ayuda)
    var yaw1 = at2(L.y - P.y, L.x - P.x) + K.exYaw, pitch1 = at2(L.z - P.z, hyp(L.x - P.x, L.y - P.y)) + K.exPitch, cp = Math.cos(pitch1);
    INTRO.p1x = P.x; INTRO.p1y = P.y; INTRO.p1z = P.z;
    INTRO.l1x = P.x + Math.cos(yaw1) * cp * 10; INTRO.l1y = P.y + Math.sin(yaw1) * cp * 10; INTRO.l1z = P.z + Math.sin(pitch1) * 10;
    INTRO.f1 = K.fovCur; INTRO.exP = K.exPitch; INTRO.exY = K.exYaw; INTRO.boost = K.fovBoost; INTRO.tshot = tsh;
    // arranque: alto y abierto, en la esquina de nuestro fondo del lado de la mesa (y > 0), mirando al centro de la pista
    var calm = comfort(), sy = INTRO.p1y > 1.5 ? -1 : 1;   // (al lado contrario de donde acaba: el barrido cruza el fondo)
    INTRO.p0x = mn(14.3, K.bX - 0.6); INTRO.p0y = sy * (calm ? 4.5 : 8.2); INTRO.p0z = calm ? 6.2 : 8.4;
    INTRO.l0x = -2.5; INTRO.l0y = 0; INTRO.l0z = 0.4; INTRO.f0 = fovFor(calm ? 46 : 50);
    INTRO.plan = false;
  }
  function introShot(g) {
    if (INTRO.plan) introPlan(g);
    var u = mn(1, INTRO.t / mx(0.5, INTRO.dur)), k = fbCurve(u);
    // posición: interpolación con un arco hacia fuera (la grúa no atraviesa el sitio del sacador) y bajada al final
    var arc = Math.sin(PI * k) * 1.2;
    D.x = mn(INTRO.p0x + (INTRO.p1x - INTRO.p0x) * k + arc * 0.6, K.bX - 0.2);
    D.y = INTRO.p0y + (INTRO.p1y - INTRO.p0y) * k;
    D.z = INTRO.p0z + (INTRO.p1z - INTRO.p0z) * smooth01(mn(1, k * 1.08)) + arc * 0.5;
    // mira: del centro de la pista a la del saque (algo más tarde que la posición: el plano "llega" y luego se asienta)
    var kl = fbCurve(mn(1, u * 1.04));
    A.x = INTRO.l0x + (INTRO.l1x - INTRO.l0x) * kl; A.y = INTRO.l0y + (INTRO.l1y - INTRO.l0y) * kl; A.z = INTRO.l0z + (INTRO.l1z - INTRO.l0z) * kl;
    K.fovWant = INTRO.f0 + (INTRO.f1 - INTRO.f0) * k;
  }

  /* ---------------- MENÚ: PROGRAMA DE RETRANSMISIÓN (CAM-16) ----------------
   * En vez de una órbita lenta, una realización de la demo: 6 tipos de plano de 6,5-9,5 s unidos por cortes secos (nunca a ±0,3 s de
   * un golpe, nunca más cortos de 6 s ni cruzando el eje: todas las cámaras del lado de la mesa, y > 0, salvo el fondo detrás del
   * sacador, que está sobre el eje largo).
   *   wide   gran angular alto, de tres cuartos, que deriva despacio            side   travelling bajo por la banda (2,5 m)
   *   net    a la altura de la cinta, a lo largo de la red                       server bajo detrás del sacador (antes del saque)
   *   setter travelling lento sobre el colocador                                board  marcador colgado + grada, barrido hasta la jugada
   * El balón y los jugadores activos van en la parte libre de la derecha: el centro de la imagen se desplaza con filmOffset (el panel
   * del menú tapa la izquierda) y la lente se ajusta para que quepan en ±0,45 NDC alrededor de la mira (=> NDC x > -0,2 en pantalla). */
  var MN = { k: -1, t: 0.5, dur: 8.5, hitT: -9.5, cut: false, n: 0, last: -1, s: 1.5, a0: 0.5, x0: 0.5, v: 0.5, cx: 0.5, cy: 0.5, cz: 0.5, sp: 0.5,
             rng: 0.37, subj: null, tgt: 0.5, w: 0.99, srvN: -9 };
  MN.k = -1; MN.hitT = -9; MN.n = 0; MN.last = -1;
  var MN_TYPES = ['wide', 'side', 'net', 'server', 'setter', 'board'];
  var MN_BAG = [1, 2, 4, 5, 0];   // (orden base tras el primero; 'server' entra cuando hay saque)
  function mnRand() { MN.rng = (MN.rng * 9301 + 49297) % 233280; return MN.rng / 233280; }
  /** ¿Se puede cortar ahora? Ni a < 0,3 s de un golpe pasado ni de uno inminente (balón a +0,3 s al alcance de alguien). */
  function mnSafe(g) {
    if (K.timeAcc - MN.hitT < 0.32) return false;
    var b = g.ball; if (!b) return true;
    if (b.held && g.serveState !== 'toss') return true;
    if (g.mode === 'serve' && g.serveState === 'toss') return false;   // (lanzamiento: el golpe del saque llega en < 1,2 s)
    var Gc = (VB.C && VB.C.G) || 9.81;
    for (var s = 0; s <= 13; s++) {
      var tt = 0.048 * s, bx = b.x + b.vx * tt, by = b.y + b.vy * tt, bz = b.z + b.vz * tt - 0.5 * Gc * tt * tt;
      for (var i = 0; i < g.players.length; i++) {
        var q = g.players[i], dz = bz - (q.z || 0);
        if (dz > -0.5 && dz < 3.9 && hyp(bx - q.x - (q.vx || 0) * tt, by - q.y - (q.vy || 0) * tt) < 2.6) return false;
      }
    }
    return true;
  }
  /** Centro de la jugada: balón y los dos jugadores más cercanos a él (posición visual), suavizado (giro <= 25°/s en apply). */
  var MNC = V(), MNS = [null, null];
  function mnAction(g, out) {
    var b = g.ball, best = null, bd = 1e9, sec = null, sd = 1e9;
    for (var i = 0; i < g.players.length; i++) { var q = g.players[i], d = hyp(q.x - b.x, q.y - b.y); if (d < bd) { sec = best; sd = bd; best = q; bd = d; } else if (d < sd) { sec = q; sd = d; } }
    MNS[0] = best; MNS[1] = sec;
    var bz = mn(mx(b.z, 0.5), 4.5);
    out.x = b.x * 0.5 + (best ? best.x : b.x) * 0.3 + (sec ? sec.x : b.x) * 0.2;
    out.y = b.y * 0.5 + (best ? best.y : b.y) * 0.3 + (sec ? sec.y : b.y) * 0.2;
    out.z = bz * 0.5 + 1.0 * 0.5;
  }
  /** FOV que deja el balón y los dos jugadores activos dentro de ±hw NDC (horizontal) alrededor de la mira (D -> A). */
  function mnFitFov(g, fMin, fMax, hw) {
    var yaw = at2(A.y - D.y, A.x - D.x), need = 0, asp = aspect(), b = g.ball;
    for (var i = -1; i < 2; i++) {
      var q = i < 0 ? b : MNS[i]; if (!q) continue;
      var dx = q.x - D.x, dy = q.y - D.y, rel = Math.abs(wrap(at2(dy, dx) - yaw)), fwd = hyp(dx, dy) * Math.cos(rel);
      if (fwd < 1) continue;
      var lat = hyp(dx, dy) * Math.sin(rel) + (i < 0 ? 0.3 : 0.45);
      need = mx(need, lat / fwd);
    }
    var t = need / mx(0.2, hw) / asp, f = 2 * Math.atan(t) / DEG;
    return mn(mx(f, fMin), fMax);
  }
  function mnStart(g, k, cut) {
    MN.k = k; MN.t = 0; MN.dur = BRK === 'menu' ? 99 : 6.6 + 2.8 * mnRand(); MN.cut = cut; MN.n++; if (k === 3) MN.srvN = MN.n;
    mnAction(g, MNC); MN.cx = MNC.x; MN.cy = MNC.y; MN.cz = MNC.z;
    var ty = MN_TYPES[k];
    MN.w = 1;
    MN.s = mnRand() < 0.5 ? -1 : 1;
    if (ty === 'wide') { MN.a0 = (35 + 110 * mnRand()) * DEG; MN.v = (mnRand() < 0.5 ? -1 : 1) * 0.035; }
    else if (ty === 'side') { var sx0 = MNC.x >= 0 ? 1 : -1; MN.v = sx0 * 0.42; MN.x0 = sx0 * mn(mx(Math.abs(MNC.x) - 1.0, 2.6), 7.5); }   // (hacia fuera: nunca pasa por la mesa ni el 2º árbitro)
    else if (ty === 'net') { MN.s = MNC.x > 0 ? 1 : -1; }
    else if (ty === 'setter') { MN.a0 = (60 + 60 * mnRand()) * DEG; MN.v = (mnRand() < 0.5 ? -1 : 1) * 0.05; MN.subj = null; }
    else if (ty === 'board') { MN.s = 1; MN.sp = 1; }   // (esquina x > 0 del lado de la mesa: la otra tiene un juez de línea delante)
  }
  /** Siguiente plano: 'server' si hay un saque con tiempo (>= 1,2 s hasta el lanzamiento), si no el siguiente de la bolsa. */
  /** ¿Toca el plano del sacador? Hay un saque con >= 0,6 s hasta el lanzamiento y no se ha usado en los 2 últimos planos (variedad). */
  function mnSrvOk(g) { return g.mode === 'serve' && g.serveState !== 'toss' && MN.k !== 3 && !!g.server && MN.n - MN.srvN >= 3 && !(typeof g.timer === 'number' && g.timer < 0.6); }
  function mnNext(g) {
    var cur = MN.k;
    if (mnSrvOk(g)) return 3;
    for (var i = 0; i < MN_BAG.length; i++) { var k = MN_BAG[(MN.n + i) % MN_BAG.length]; if (k !== cur) return k; }
    return 0;
  }
  function menuShot(g) {
    var dt = K.dt;
    if (MN.k < 0) { readOfficials(); MN.srvN = -9; mnStart(g, 0, false); }
    else if (dt > 0) {
      MN.t += dt;
      // corte: cumplida la duración, en un momento seguro (o, como mucho a los 12 s, aunque haya juego cerca)
      var can = MN.t >= MN.dur && mnSafe(g);
      // (el plano del sacador se adelanta si llega un saque y el actual ya lleva >= 6 s)
      if (!can && MN.t >= 6.2 && mnSrvOk(g) && mnSafe(g)) can = true;
      if (MN.k === 3 && MN.t >= 6.2 && g.mode === 'rally' && g.touches >= 2 && mnSafe(g)) can = true;   // (el fondo no sirve para el peloteo largo)
      if (can) mnStart(g, mnNext(g), true);
    }
    // centro de la jugada, suavizado (s ~0,7 s)
    mnAction(g, MNC);
    var kk = dt > 0 ? mn(1, dt * 1.4) : 1;
    MN.cx += (MNC.x - MN.cx) * kk; MN.cy += (MNC.y - MN.cy) * kk; MN.cz += (MNC.z - MN.cz) * kk;
    var ty = MN_TYPES[MN.k], t = MN.t, b = g.ball, f0 = 34, f1 = 56;
    if (ty === 'wide') {
      var a = MN.a0 + MN.v * t, sa = Math.sin(a);
      D.x = Math.cos(a) * 14.4; D.y = mx(0.6, sa * 8.9); D.z = 6.2 + 0.9 * sa * sa;
      A.x = MN.cx * 0.45; A.y = MN.cy * 0.35; A.z = 0.9;
      f0 = 38; f1 = 58;
    } else if (ty === 'side') {
      // (travelling por la banda que además acompaña un poco la jugada; nunca a |x| < 2,6: mesa y 2º árbitro)
      var sdx = MN.x0 + MN.v * t; sdx += (MN.cx - sdx) * 0.35; sdx = (MN.x0 >= 0 ? 1 : -1) * mn(mx(Math.abs(sdx) * ((sdx >= 0) === (MN.x0 >= 0) ? 1 : -1), 2.6), 12);
      D.x = sdx; D.y = mn(8.7, K.bY - 0.3); D.z = 2.5 + 0.06 * Math.sin(t * 0.5);
      A.x = MN.cx; A.y = MN.cy * 0.7 - 0.8; A.z = MN.cz;
      f0 = 32; f1 = 58;
    } else if (ty === 'net') {
      // (a la altura de la cinta, en diagonal hacia el poste lejano: desde x = ±5,2 el poste cercano y el 2º árbitro quedan fuera)
      D.x = MN.s * (5.2 + 0.08 * t); D.y = mn(8.4, K.bY - 0.4); D.z = 2.45 + 0.05 * Math.sin(t * 0.4);
      A.x = MN.cx * 0.35; A.y = -5.0 + (MN.cy + 5.0) * 0.35; A.z = 2.25;
      f0 = 44; f1 = 66;
    } else if (ty === 'server') {
      var sv = g.server || g.players[0], sd = sv.team === 0 ? 1 : -1;
      if (g.mode === 'serve') { MN.x0 = sv.x; MN.tgt = sv.y; }
      D.x = mn(mx(MN.x0 + sd * 4.3, -14.4), 14.4); D.y = mx(0.4, MN.tgt + 1.45); D.z = 1.7;
      var srvT = g.mode === 'serve' ? 1 : 0.45; MN.w = dt > 0 ? MN.w + (srvT - MN.w) * mn(1, dt * 1.6) : srvT; var srvW = MN.w;
      A.x = (MN.x0 - sd * 8) * srvW + MN.cx * (1 - srvW); A.y = MN.tgt * 0.4 * srvW + MN.cy * (1 - srvW); A.z = 1.6 * srvW + MN.cz * (1 - srvW);
      f0 = 40; f1 = 58;
    } else if (ty === 'setter') {
      // el que va a colocar: compañero del que recibió; si no, el más cercano al balón del equipo que lo juega
      var sj = null;
      if (g.touches === 1 && g.lastPlayer) { var tm = g.teams[g.lastPlayer.team]; sj = tm[0] === g.lastPlayer ? tm[1] : tm[0]; }
      else if (g.touchTeam === 0 || g.touchTeam === 1) sj = nearestOf(g.teams[g.touchTeam], b.x, b.y);
      if (!sj) sj = MNS[0];
      if (!MN.subj || (sj !== MN.subj && t > 1.5)) MN.subj = sj;
      var q = MN.subj, vp = visPos(q, VP), ang = MN.a0 + MN.v * t;
      var tx = vp.x + Math.cos(ang) * 7.0, ty2 = mx(0.6, vp.y + Math.sin(ang) * 7.0);
      // (lejos de la red junto a los postes y el 2º árbitro)
      if (Math.abs(tx) < 1.8 && ty2 > 4.2) tx = (vp.x >= 0 ? 1 : -1) * 1.8;
      if (dt > 0) { var kd = mn(1, dt * 0.9); MN.x0 += (tx - MN.x0) * kd; MN.tgt += (ty2 - MN.tgt) * kd; } else { MN.x0 = tx; MN.tgt = ty2; }
      D.x = mn(mx(MN.x0, -13.5), 13.5); D.y = mn(MN.tgt, 8.8); D.z = 1.85;
      A.x = vp.x * 0.6 + MN.cx * 0.4; A.y = vp.y * 0.6 + MN.cy * 0.4; A.z = 1.35 * 0.6 + MN.cz * 0.4;
      f0 = 32; f1 = 62;
    } else {
      // marcador + grada: cámara baja en la esquina de la mesa, mirando arriba al marcador; barre hacia la jugada
      var LM = VB.Arena && VB.Arena.landmarks && VB.Arena.landmarks.scoreHung, hz = LM ? LM.z : 11.4;
      if (dt > 0) MN.sp = mx(0, MN.sp - dt / 7.5);
      var w = 0.25 + 0.5 * smooth01(MN.sp);
      D.x = MN.s * 11.4; D.y = mn(8.5, K.bY - 0.4); D.z = 1.6;
      A.x = MN.cx * (1 - w); A.y = MN.cy * (1 - w); A.z = MN.cz * (1 - w) + (hz - 1.2) * w;
      f0 = 46; f1 = 62;
    }
    mnClear(g, ty === 'setter' || ty === 'side' || ty === 'server');
    mnFrame(g, f0, f1, ty === 'board' ? 0.55 : ty === 'net' ? 0.35 : 0.2);
  }
  /** Despeje de la cámara del menú: lejos de oficiales (3 m), postes (1,6 m) y, si se pide, atletas (2,4 m); y sin nadie de ellos tapando la
   *  línea de visión cerca de la lente (se aparta de lado). Siempre del lado de la mesa (y >= 0,3) y dentro del pabellón. */
  var MNOB = [[0, 5.5, 1.6], [0, -5.5, 1.6]];
  function mnClear(g, ply) {
    for (var it = 0; it < 2; it++) {
      for (var i = 0; i < OFFI.length + MNOB.length + (ply ? 4 : 0); i++) {
        var ox, oy, r;
        if (i < OFFI.length) { ox = OFFI[i][0]; oy = OFFI[i][1]; r = 3.0; }
        else if (i < OFFI.length + MNOB.length) { var m = MNOB[i - OFFI.length]; ox = m[0]; oy = m[1]; r = m[2]; }
        else { var q = g.players[i - OFFI.length - MNOB.length], vq = visPos(q, VQ); ox = vq.x; oy = vq.y; r = 2.4; }
        var dx = D.x - ox, dy = D.y - oy, d = hyp(dx, dy);
        if (d < r) { if (d < 0.01) { dx = 0; dy = 1; d = 1; } var k = (r - d) / d; D.x += dx * k; D.y += dy * k; }
        // tapando la línea de visión cerca de la lente (a < 6 m): apartarse de lado lo que falte hasta 1 m de la línea
        var lx = A.x - D.x, ly = A.y - D.y, ll = hyp(lx, ly);
        if (ll > 1) {
          var tq = ((ox - D.x) * lx + (oy - D.y) * ly) / (ll * ll), along = tq * ll;
          if (along > 0.5 && along < 6) {
            var sd2 = ((ox - D.x) * ly - (oy - D.y) * lx) / ll, gap = 1.0 - Math.abs(sd2);
            if (gap > 0) { var sg = sd2 >= 0 ? 1 : -1; D.x += sg * (ly / ll) * gap * 0.9; D.y -= sg * (lx / ll) * gap * 0.9; }
          }
        }
      }
    }
    D.x = mn(mx(D.x, -(K.bX - 0.4)), K.bX - 0.4); D.y = mn(mx(D.y, 0.3), K.bY - 0.3);
  }
  /** Encuadre automático del menú: el balón (ahora y dentro de 0,35 s) y los dos jugadores activos dentro de ±0,42 NDC en horizontal y
   *  ±0,72 en vertical alrededor de la mira; la mira del estilo (A) solo sesga (peso bw) sin sacar a nadie. Giro y cabeceo suavizados
   *  (el límite de 25°/s de apply hace el resto); la lente, lo justo entre f0 y f1. Con filmOffset el centro queda a +0,26 NDC. */
  var MNF = { yc: 0.5, pc: 0.5, yv: [0.5], pv: [0.5], film: false }; MNF.yv[0] = 0; MNF.pv[0] = 0;
  function mnFrame(g, f0, f1, bw) {
    var b = g.ball, dt = K.dt, asp = aspect(), Gc = (VB.C && VB.C.G) || 9.81;
    MNF.film = ctx.width > 760;
    var yS = at2(A.y - D.y, A.x - D.x), pS = at2(A.z - D.z, hyp(A.x - D.x, A.y - D.y));
    var yl = 9, yr = -9, pl = 9, ph = -9;
    for (var i = 0; i < 6; i++) {
      var qx, qy, qz;
      if (i === 0) { qx = b.x; qy = b.y; qz = b.z; }
      else if (i < 4) { var tt = b.held ? 0 : 0.2 * i; qx = b.x + b.vx * tt; qy = b.y + b.vy * tt; qz = mx(0.2, b.z + b.vz * tt - 0.5 * Gc * tt * tt); }
      else { var q = MNS[i - 4]; if (!q) continue; var vq = visPos(q, VQ); qx = vq.x; qy = vq.y; qz = (q.z || 0) + 1.0; }
      var dx = qx - D.x, dy = qy - D.y, hd = hyp(dx, dy); if (hd < 1.2) continue;
      var ry = wrap(at2(dy, dx) - yS), rp = at2(qz - D.z, hd);
      var mY = (i < 4 ? 0.25 : 0.4) / hd, mP = (i < 4 ? 0.25 : 1.0) / hd;   // (medio cuerpo / radio del balón)
      if (ry - mY < yl) yl = ry - mY; if (ry + mY > yr) yr = ry + mY;
      if (rp - mP < pl) pl = rp - mP; if (rp + mP > ph) ph = rp + mP;
    }
    var yc = yS, pc = pS;
    if (yl < 8) {
      var ymid = (yl + yr) / 2, pmid = (pl + ph) / 2;
      // sesgo hacia la mira del estilo, sin que el rango de los sujetos se salga de ±0,42 NDC con el FOV máximo
      var tMax = Math.tan(f1 * DEG / 2), hwA = Math.atan(0.42 * tMax * asp), vwA = Math.atan(0.72 * tMax);
      var yo = mn(mx(-ymid * bw, yr - ymid - hwA), yl - ymid + hwA);   // (desplazamiento del centro hacia la mira del estilo, 0 = centrado)
      if (yr - yl > 2 * hwA) yo = 0;
      var po = mn(mx((pS - pmid) * bw, ph - pmid - vwA), pl - pmid + vwA);
      if (ph - pl > 2 * vwA) po = 0;
      // (los sujetos un poco a la izquierda del centro óptico: con filmOffset (+0,26) quedan en ~+0,2 de pantalla, con más aire a la derecha)
      var fShift = MNF.film ? Math.atan(0.07 * Math.tan(K.fovCur * DEG / 2) * asp) : 0;
      yc = yS + ymid + yo + fShift; pc = pmid + po;
      var needH = mx(Math.tan(mx(0.02, yr - ymid - yo)), Math.tan(mx(0.02, ymid + yo - yl))) / 0.42 / asp;
      var needV = mx(Math.tan(mx(0.02, ph - pc)), Math.tan(mx(0.02, pc - pl))) / 0.72;
      var f = 2 * Math.atan(mx(needH, needV)) / DEG;
      K.fovWant = fovFor(mn(mx(f, f0), f1), 30, 28, true);
    } else K.fovWant = fovFor(f0, 30, 28, true);
    // suavizado de la mira (en ángulos): críticamente amortiguado ~0,45 s
    if (dt > 0 && MN.t > 0) { MNF.yc = MNF.yc + wrap(sd1(0, wrap(yc - MNF.yc), MNF.yv, 0, 0.32, dt)); MNF.pc = sd1(MNF.pc, pc, MNF.pv, 0, 0.32, dt); }
    else { MNF.yc = yc; MNF.pc = pc; MNF.yv[0] = 0; MNF.pv[0] = 0; }
    var cp = Math.cos(MNF.pc);
    A.x = D.x + Math.cos(MNF.yc) * cp * 10; A.y = D.y + Math.sin(MNF.yc) * cp * 10; A.z = D.z + Math.sin(MNF.pc) * 10;
  }

  /** PLANO DE TELEVISIÓN del 6v6 (espectador, §1.6 de notes/diseno-6v6-carrera.md): la cámara principal de las retransmisiones,
   *  alta y detrás del fondo del equipo 0 (x > 0), mirando a lo largo de la pista. Encuadra las dos pistas enteras con los 12
   *  jugadores: el fondo cercano (o el sacador cercano) abajo y las cabezas del fondo lejano (o su sacador) arriba, por debajo
   *  del marcador. Solo acompaña un poco el balón a lo ancho; la lente se ajusta al aspecto para que quepan los laterales. */
  var TVS = { y: 0.5, ay: 0.5, near: 9.5, far: -9.5, v: [0.5, 0.5, 0.5, 0.5], mode: '', cut: false }; TVS.v[0] = TVS.v[1] = TVS.v[2] = TVS.v[3] = 0;
  function tvShot(g) {
    var dt = K.dt, b = g.ball, sv = g.mode === 'serve' ? g.server : null;
    // del punto al saque siguiente (los jugadores aparecen en su sitio de golpe): corte, como la realización de la tele (ver update)
    if (dt > 0 && TVS.mode === 'point' && g.mode === 'serve') TVS.cut = true;
    TVS.mode = g.mode;
    var X = mn(14.2, K.bX - 0.8), H = mn(7.8, K.bZ - 2);
    // lo más cercano y lo más lejano que tiene que verse: los jugadores de cada campo (con margen) y, como poco, 6,5 m a cada lado
    // de la red (el operador abre o cierra un poco con la formación: en recepción la pista entera, en el peloteo algo más cerca)
    var nearT = 6.5, farT = -6.5, pl = g.players;
    for (var i = 0; i < pl.length; i++) { var q = pl[i]; if (q.x > 0) { if (q.x + 1.2 > nearT) nearT = q.x + 1.2; } else if (q.x - 0.9 < farT) farT = q.x - 0.9; }
    if (sv && sv.x > 0) nearT = mx(nearT, sv.x + 0.4);
    nearT = mn(nearT, X - 3); farT = mx(farT, -12.5);
    var yT = clamp(b.y, -4.5, 4.5) * 0.25, ayT = clamp(b.y, -4.5, 4.5) * 0.3;
    if (dt > 0) {
      TVS.y = sd1(TVS.y, yT, TVS.v, 0, 0.9, dt); TVS.ay = sd1(TVS.ay, ayT, TVS.v, 1, 0.7, dt);
      TVS.near = sd1(TVS.near, nearT, TVS.v, 2, nearT > TVS.near ? 0.3 : 0.8, dt); TVS.far = sd1(TVS.far, farT, TVS.v, 3, farT < TVS.far ? 0.3 : 0.8, dt);   // (abre deprisa, cierra despacio)
    } else { TVS.y = yT; TVS.ay = ayT; TVS.near = nearT; TVS.far = farT; TVS.v[0] = TVS.v[1] = TVS.v[2] = TVS.v[3] = 0; }
    D.x = X; D.y = TVS.y; D.z = H;
    // vertical: cabezas del fondo lejano (z 2,1) a +0,6 NDC (el marcador y la guía de toques quedan encima) y el suelo del fondo cercano a -0,84
    var aT = at2(2.1 - H, X - TVS.far), aB = at2(-H, mx(1, X - TVS.near));
    var f = fit2(aT, 0.6, aB, -0.84), p = f.p, t = f.t;
    // horizontal: los laterales (± 5 m: con el margen de la zona libre) en el fondo cercano, dentro de ± 0,92 NDC
    var depth = (X - TVS.near) * Math.cos(p) - H * Math.sin(p), lat = 5 + Math.abs(TVS.y);
    var tW = lat / mx(1, depth) / 0.92, asp = aspect();
    if (t * asp < tW) t = tW / asp;
    K.fovWant = mn(mx(2 * Math.atan(t) / DEG, 30), 78);
    var cp = Math.cos(p);
    A.x = D.x - cp * 10; A.y = D.y + (TVS.ay - D.y) * 0.5; A.z = D.z + Math.sin(p) * 10;
  }

  /* ================= 6v6 — CÁMARA EN 3ª PERSONA (ajuste ctx.settings.cam6: '3p' por defecto, 'tv' = la de televisión) =================
   * notes/diseno-6v6-carrera.md §1.6: detrás y por encima del jugador que llevas, mirando a la red y al balón, con más campo que la del 2v2
   * (entre 12 hay que leer la formación) y la red entera. Encuadre por AJUSTE (fit2): los pies del sujeto abajo (nB) y, arriba, lo que pida
   * más lente: la línea de fondo rival (nTop), el balón (adelantado y con la cumbre prevista, nBall) o, en el saque rival, el sacador y su
   * lanzamiento. La lente cambia a ritmo limitado (abre <= 14°/s, cierra <= 4°/s: sin bombeo) y el cabeceo sale de la lente REAL de este
   * frame. Fases (parámetros suavizados, sin saltos): def (el balón es del rival), bld (construimos), atk (tu remate: más cerca, por encima
   * del hombro), srv (tu saque, sobre tu hombro derecho), tsrv (saca un compañero), rsrv (saque rival). Oclusión: de los compañeros, los 2
   * más cercanos al eje cámara-jugador; si tapan al jugador, la cámara se aparta de lado (hasta 2,2 m) y sube (hasta 0,9 m).
   * Solo con g.size === 6 y sin g.watch (pickShot): el 2v2 y el espectador no pasan por aquí. */
  var TP = { ph: '', back: 7.5, h: 5.5, side: 0.5, occ: 0.5, up: 0.5, fg: 0.5, ex: 0.5, ly: 0.5, fov: 50.5, v: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], nB: -0.5, nX: 0.5, nY: 0.5, sox: 0.5, soy: 0.5 };
  (function () { TP.side = TP.occ = TP.up = TP.fg = TP.ex = TP.ly = TP.sox = TP.soy = 0; for (var i = 0; i < TP.v.length; i++) TP.v[i] = 0; })();
  // por fase: [back (m detrás del sujeto), h (altura), nB (NDC de los pies), side (m por encima del hombro, hacia el centro de la pista)]
  var TPK = { def: [7.4, 5.5, -0.6, 0], bld: [6.8, 5.5, -0.62, 0.4], atk: [5.8, 4.9, -0.56, 1.0], srv: [4.0, 5.0, -0.9, 1.1], tsrv: [4.6, 5.1, -0.9, 1.1], rsrv: [7.2, 5.3, -0.6, 0] };
  var TPD = { ph: '', occ: 0, up: 0, fov: 0, t: 0, nb: 0 };
  var TPC = { x: 0.5, y: 0.5, z: 0.5, c: 1.5, s: 0.5 };   // (pose de la cámara para tpEl: sin cierres ni dobles en caja por llamada)
  /** Elevación (rad) de un punto visto desde TPC con el rumbo de TPC (NaN si está detrás o encima de la cámara). */
  function tpEl(x, y, z) { var fd = (x - TPC.x) * TPC.c + (y - TPC.y) * TPC.s; return fd > 0.6 ? at2(z - TPC.z, fd) : NaN; }
  function tpPhase(g, p) {
    if (g.mode === 'serve') return g.serving === 0 ? (g.server === p ? 'srv' : 'tsrv') : 'rsrv';
    if (g.mode !== 'rally') return TP.ph || 'def';
    if (p.lastAction === 'spike' && p.actionT < 0.8) return 'atk';
    if (g.touchTeam === 0 && g.lastKind !== 'serve' && g.ball.x > -0.6) return (g.touches >= 2 && g.jobs && g.jobs[0] === p) ? 'atk' : 'bld';
    return 'def';
  }
  function tpShot(g) {
    var p = g.ctrl; if (!p) { tvShot(g); return; }
    var dt = K.dt, b = g.ball, tch = touchUI(), small = tch || !!ctx.isMobile || (ctx.height || 720) < 480, calm = comfort(), asp = aspect();
    var ph = tpPhase(g, p), kp = TPK[ph], sv = g.mode === 'serve' ? g.server : null;
    TP.ph = ph;
    // SUJETO: tu jugador; si saca un compañero (tsrv), el sacador, encuadrado como tu saque (entero y abajo, con su lanzamiento y el campo
    // rival), y al sacar la cámara se desliza (0,6 s) hasta detrás de tu jugador: antes se quedaba 3 m detrás del sacador mirando solo el
    // punto del golpe y el sacador salía cortado (o bajo el joystick en móvil) y el balón enorme en el centro
    var tsv = ph === 'tsrv' && sv, srvL = ph === 'srv' || !!tsv, soxT = tsv ? sv.x - p.x : 0, soyT = tsv ? sv.y - p.y : 0;
    if (dt > 0) { TP.sox = sd1(TP.sox, soxT, TP.v, 7, 0.6, dt); TP.soy = sd1(TP.soy, soyT, TP.v, 8, 0.6, dt); } else { TP.sox = soxT; TP.soy = soyT; TP.v[7] = TP.v[8] = 0; }
    var sx = p.x + TP.sox, sy = p.y + TP.soy, sz = tsv ? 0 : mx(0, p.z);
    var bT = kp[0] * (small ? 0.95 : 1), hT = kp[1] + (small ? (srvL ? 0.15 : 0.25) : 0);
    // hombro: hacia el centro de la pista (en tu saque, el derecho: +y); con el jugador centrado se queda el lado que había
    var sg = srvL ? 1 : sy > 0.4 ? -1 : sy < -0.4 ? 1 : (TP.side >= 0 ? 1 : -1), sideT = kp[3] * sg * (calm ? 0.6 : 1);
    if (dt > 0) { TP.back = sd1(TP.back, bT, TP.v, 0, 0.6, dt); TP.h = sd1(TP.h, hT, TP.v, 1, 0.6, dt); TP.side = sd1(TP.side, sideT, TP.v, 2, 0.7, dt); }
    else { TP.back = bT; TP.h = hT; TP.side = sideT; TP.v[0] = TP.v[1] = TP.v[2] = 0; }
    // (antes: con un compañero sacando, la cámara se retrasaba detrás de él; ahora el sujeto es el sacador y no hace falta)
    var exT = 0;
    if (dt > 0) TP.ex = sd1(TP.ex, exT, TP.v, 6, exT > TP.ex ? 0.5 : 0.7, dt); else { TP.ex = exT; TP.v[6] = 0; }
    var cx = sx + TP.back + TP.ex, over = 0;
    if (cx > 14.4) { over = cx - 14.4; cx = 14.4; }
    var by = clamp(b.y, -4.5, 4.5), ballAhead = b.x < cx - 1.5;
    var cy = sy * (srvL ? 1 : 0.72) + (srvL || !ballAhead ? 0 : by * 0.12) + TP.side;
    var H0 = TP.h + over * 0.3;
    // OCLUSIÓN: los 2 compañeros más cercanos al eje cámara-jugador (en planta). Tapa si está a < 0,8 m del eje y su cuerpo cubre en
    // vertical > 20 % del del jugador (desde 5 m de altura, uno que está cerca de la cámara queda por debajo del cuadro y no tapa).
    var lx = sx - cx, ly = sy - cy, ll = hyp(lx, ly), occT = 0, upT = 0;
    TP.nX = ll > 0.5 ? ly / ll : 0; TP.nY = ll > 0.5 ? -lx / ll : 1;   // (normal al eje: desplazamiento lateral de la cámara)
    if (ll > 1 && !srvL) {
      var tm = g.teams[0], d1 = 9, d2 = 9, q1 = null, q2 = null, t1 = 0, t2 = 0, s1 = 0, s2 = 0;
      for (var i = 0; i < tm.length; i++) {
        var q = tm[i]; if (q === p) continue;
        var tq = ((q.x - cx) * lx + (q.y - cy) * ly) / (ll * ll); if (tq < 0.05 || tq > 0.97) continue;
        var dq = ((q.x - cx) * ly - (q.y - cy) * lx) / ll, ad = Math.abs(dq);
        if (ad < d1) { d2 = d1; q2 = q1; t2 = t1; s2 = s1; d1 = ad; q1 = q; t1 = tq; s1 = dq; } else if (ad < d2) { d2 = ad; q2 = q; t2 = tq; s2 = dq; }
      }
      for (var k = 0; k < 2; k++) {
        var qq = k ? q2 : q1, ad2 = k ? d2 : d1, tt = k ? t2 : t1, sd = k ? s2 : s1;
        if (!qq || ad2 >= 0.8) continue;
        var dO = tt * ll, hb = at2(-H0, ll), ht = at2(1.9 + sz - H0, ll), ob = at2(-H0, dO), ot = at2(1.9 + mx(0, qq.z) - H0, dO);
        var fr = (mn(ht, ot) - mx(hb, ob)) / mx(0.01, ht - hb);
        if (fr <= 0.2) continue;
        var lat = mn(2.2, (0.8 - ad2) / mx(0.2, 1 - tt)) * (sd >= 0 ? -1 : 1);
        if (Math.abs(lat) > Math.abs(occT)) occT = lat;
        upT = mx(upT, 0.9 * mn(1, fr));
      }
    }
    if (dt > 0) {
      TP.occ = sd1(TP.occ, occT, TP.v, 3, Math.abs(occT) > Math.abs(TP.occ) ? 0.35 : 0.7, dt);
      TP.up = sd1(TP.up, upT, TP.v, 4, upT > TP.up ? 0.4 : 0.8, dt);
    } else { TP.occ = occT; TP.up = upT; TP.v[3] = TP.v[4] = 0; }
    // PRIMER PLANO: un compañero entre la cámara y el jugador cortado por el borde de abajo a la altura del pecho o la cabeza (una
    // mancha grande en una esquina): la cámara sube poco a poco (hasta 0,8 m) mientras pase y baja despacio cuando ya no
    if (dt > 0) {
      var fgW = 0;
      if (!srvL && g.mode === 'rally') {
        var tq0 = Math.tan(K.fovCur * DEG / 2), cw0 = Math.cos(K.outYaw), sw0 = Math.sin(K.outYaw), fdp0 = (sx - P.x) * cw0 + (sy - P.y) * sw0, tm0 = g.teams[0];
        for (var fi = 0; fi < tm0.length; fi++) {
          var fq = tm0[fi]; if (fq === p) continue;
          var ffd = (fq.x - P.x) * cw0 + (fq.y - P.y) * sw0; if (ffd < 0.8 || ffd > fdp0 - 1) continue;
          if (Math.abs((fq.x - P.x) * sw0 - (fq.y - P.y) * cw0) / ffd > tq0 * asp * 1.02) continue;
          var nhd = Math.tan(at2(1.85 + mx(0, fq.z) - P.z, ffd) - K.outPitch) / tq0, nhp = Math.tan(at2(0.95 + mx(0, fq.z) - P.z, ffd) - K.outPitch) / tq0;
          if (nhd > -1.12 && nhd < -0.55 && nhp < -1) fgW = 1;
        }
      }
      TP.fg = clamp(TP.fg + (fgW ? 0.9 : -0.3) * dt, 0, 0.8);
    }
    D.x = cx + TP.nX * TP.occ; D.y = clamp(cy + TP.nY * TP.occ, -8.5, 8.5); D.z = H0 + TP.up + TP.fg + sz * 0.3;
    // RUMBO: hacia la red, con algo del lado del balón (o del sacador rival); ±20° de «hacia la red» (los mandos van con la cámara)
    var lyT = srvL ? sy * 0.2 : ph === 'rsrv' && sv ? sy * 0.25 + clamp(sv.y, -5, 5) * 0.45 : ph === 'atk' ? sy * 0.75 + by * 0.25 : sy * 0.3 + (ballAhead ? by * 0.4 : 0);
    TP.ly = dt > 0 ? sd1(TP.ly, lyT, TP.v, 5, 0.5, dt) : lyT; if (!(dt > 0)) TP.v[5] = 0;
    var aimX = srvL ? -5 : ph === 'rsrv' ? -6 : ph === 'atk' ? -2.5 : -4.5;
    var yaw = PI + clamp(wrap(at2(TP.ly - D.y, aimX - D.x) - PI), -20 * DEG, 20 * DEG);
    // el balón dentro de ±0,8 NDC a lo ancho (lo que falte, girando: como mucho hasta ±30°)
    var tanC = Math.tan((dt > 0 ? K.fovCur : TP.fov) * DEG / 2), tanW = tanC * asp;
    if (ballAhead && g.mode !== 'serve') {
      var rel = wrap(at2(b.y - D.y, b.x - D.x) - yaw), lim = Math.atan(0.8 * tanW);
      if (rel > lim) yaw += rel - lim; else if (rel < -lim) yaw += rel + lim;
      yaw = PI + clamp(wrap(yaw - PI), -30 * DEG, 30 * DEG);
    }
    TPC.x = D.x; TPC.y = D.y; TPC.z = D.z; TPC.c = Math.cos(yaw); TPC.s = Math.sin(yaw);
    // VERTICAL: pies del sujeto a nB; arriba la línea de fondo rival, el balón y (saque rival) el sacador con su lanzamiento
    // (tu saque: sacador entero y grande abajo —pies a -0,88— con el fondo rival, el objetivo, por encima de tus compañeros, y el
    // lanzamiento previsto, 3,9 m, encuadrado desde el principio: la lente no respira)
    var srvP = srvL, zB = 0;
    var nB = srvP ? (tch ? -0.84 : -0.88) : kp[2] + (tch ? -0.14 : small ? -0.1 : 0), nTop = srvP ? (small ? 0.62 : 0.46) : small ? 0.48 : 0.3;
    var nBall = srvP ? 0.93 : tch ? 0.64 : small ? 0.7 : 0.8;
    TP.nB = nB;
    // (pies adelantados si corre hacia la cámara: la cámara va ~0,3 s por detrás y los pies se salían por abajo)
    var aB = tpEl(sx + mx(0, p.vx || 0) * 0.35, sy + (p.vy || 0) * 0.1, zB), tNeed = 0, f;
    if (!(aB === aB)) aB = -0.9;
    var aT = tpEl(-9.6, clamp(TP.ly, -4, 4), 0);
    if (aT === aT && aT - aB > 0.02) { f = fit2(aT, nTop, aB, nB); tNeed = f.t; }
    if (ph === 'rsrv' && sv) {
      aT = tpEl(sv.x, sv.y, 2.1); if (aT === aT && aT - aB > 0.02) { f = fit2(aT, small ? 0.55 : 0.5, aB, nB); tNeed = mx(tNeed, f.t); }
      aT = tpEl(sv.x + 0.9, sv.y, (sv.z || 0) + 4.75); if (aT === aT && aT - aB > 0.02) { f = fit2(aT, nBall, aB, nB); tNeed = mx(tNeed, f.t); }
    } else if (srvL) {
      aT = tpEl(sx - 0.7, sy, 3.9); if (aT === aT && aT - aB > 0.02) { f = fit2(aT, nBall, aB, nB); tNeed = mx(tNeed, f.t); }
    }
    var bx = b.x + b.vx * 0.25, byy = b.y + b.vy * 0.25, bz = b.z + mx(0, b.vz) * 0.25;
    if (g.mode === 'rally' && b.vz > 0.5) {   // (cumbre prevista: la lente llega a tiempo en vez de ir detrás de un balón que sube)
      var Gc = (VB.C && VB.C.G) || 9.81, tUp = mn(1.0, b.vz / Gc), apz = b.z + b.vz * tUp * 0.5;
      if (apz > bz) { bz = apz; bx = b.x + b.vx * tUp * 0.6; byy = b.y + b.vy * tUp * 0.6; }
    }
    var aBall = (g.mode === 'rally' || g.mode === 'point' || (srvP && !b.held)) ? tpEl(bx, byy, bz + 0.2) : NaN;
    if (aBall === aBall && aBall - aB > 0.02) { f = fit2(aBall, nBall, aB, nB); tNeed = mx(tNeed, f.t); }
    // EL BALÓN TAMBIÉN ABAJO: entre la cámara y el jugador (un compañero de atrás que defiende o recibe), el balón no sale por el borde de
    // abajo (>= -0,84 NDC). Segundo ancla inferior, solo si está a > 2 m delante y no más de 20° por debajo de los pies
    var aBl = g.mode === 'rally' ? tpEl(b.x + b.vx * 0.15, b.y + b.vy * 0.15, b.z + b.vz * 0.15 - 0.3) : NaN, nBl = -0.84;
    if (aBl === aBl && ((b.x - D.x) * TPC.c + (b.y - D.y) * TPC.s < 2 || aBl < aB - 0.35)) aBl = NaN;
    // (saca un compañero: el punto del golpe de saque dentro del cuadro desde el principio; el balón ya no entra por el borde de abajo)
    if (aBl === aBl && aBl < aB + 0.1) {
      aT = tpEl(-9.6, clamp(TP.ly, -4, 4), 0); if (aT === aT && aT - aBl > 0.02) { f = fit2(aT, nTop, aBl, nBl); tNeed = mx(tNeed, f.t); }
      if (aBall === aBall && aBall - aBl > 0.02) { f = fit2(aBall, nBall, aBl, nBl); tNeed = mx(tNeed, f.t); }
    } else aBl = NaN;
    // horizontal: la red entera (postes a ±4,6 m) dentro de ±0,95 NDC y el jugador de ±0,7
    var fdN = (0 - D.x) * TPC.c + (0 - D.y) * TPC.s;
    if (fdN > 2) for (var sgp = -1; sgp <= 1; sgp += 2) { var lN = Math.abs((0 - D.x) * TPC.s - (sgp * 4.6 - D.y) * TPC.c); tNeed = mx(tNeed, lN / fdN / 0.95 / asp); }
    var fdP = (sx - D.x) * TPC.c + (sy - D.y) * TPC.s;
    if (fdP > 1) tNeed = mx(tNeed, Math.abs((sx - D.x) * TPC.s - (sy - D.y) * TPC.c) / fdP / 0.7 / asp);
    if (tsv) { var fdC = (p.x - D.x) * TPC.c + (p.y - D.y) * TPC.s; if (fdC > 1) tNeed = mx(tNeed, Math.abs((p.x - D.x) * TPC.s - (p.y - D.y) * TPC.c) / fdC / 0.85 / asp); }
    var fMax = mn(66, 2 * Math.atan(Math.tan(50 * DEG) / asp) / DEG), fMin = mn(srvP ? 28 : 40, fMax);
    var fWant = clamp(2 * Math.atan(tNeed) / DEG, fMin, fMax);
    if (dt > 0) TP.fov = mn(mx(fWant, TP.fov - (calm ? 3 : 4) * dt), TP.fov + (calm ? 9 : 14) * dt); else TP.fov = fWant;
    K.fovWant = TP.fov;
    // cabeceo con la lente que hay AHORA: pies por encima de nB (cabeceo máximo) y lo de arriba por debajo de su límite (mínimo)
    var t = Math.tan((dt > 0 ? K.fovCur : TP.fov) * DEG / 2), pBot = aB + Math.atan(-nB * t), pTop = -9;
    if (aBl === aBl) pBot = mn(pBot, aBl + Math.atan(-nBl * t));
    aT = tpEl(-9.6, clamp(TP.ly, -4, 4), 0); if (aT === aT) pTop = mx(pTop, aT - Math.atan(nTop * t));
    if (aBall === aBall) pTop = mx(pTop, aBall - Math.atan(nBall * t));
    if (ph === 'rsrv' && sv) { aT = tpEl(sv.x + 0.9, sv.y, (sv.z || 0) + 4.75); if (aT === aT) pTop = mx(pTop, aT - Math.atan(nBall * t)); }
    else if (srvP) { aT = tpEl(sx - 0.7, sy, 3.9); if (aT === aT) pTop = mx(pTop, aT - Math.atan(nBall * t)); }
    // (con lente de sobra, a medias; en tu saque, arriba manda el campo rival: el sacador sube en el cuadro)
    var pitch = pTop <= pBot ? (pTop < -8 ? pBot : pBot - (srvP ? 1 : 0.5) * (pBot - pTop)) : mn(pTop, pBot + Math.atan(0.18 * t));
    pitch = clamp(pitch, -0.8, 0.3);
    var cpt = Math.cos(pitch);
    A.x = D.x + TPC.c * cpt * 10; A.y = D.y + TPC.s * cpt * 10; A.z = D.z + Math.sin(pitch) * 10;
    TPD.ph = ph; TPD.occ = TP.occ; TPD.up = TP.up; TPD.fg = TP.fg; TPD.fov = TP.fov; TPD.nb = nB; dbg.tp = TPD;
  }

  /* 6v6 en 3ª persona — PLANO DE REACCIÓN tras el punto (y de CIERRE DE SET): la cámara de juego sigue ~0,55 s (se ve el bote) y CORTA a
   * un plano bajo (2,7 m; en el cierre, 3,2 m y abierto al equipo) del autor del punto con los compañeros que tenga cerca: de los 72
   * sitios a su alrededor (R 5,4 m; cierre 6,8 m) gana el que no cruza la red, no se mete en la red ni fuera del pabellón, no tiene a
   * nadie (ni postes, silla o mesa) entre la cámara y él, le ve de frente y mete a más compañeros. Sigue al héroe con suavidad (en el
   * cierre, órbita lenta de 3°/s) hasta el corte de vuelta al saque. getShot() lo da como 'point' (rótulos, cortinilla). */
  var TPP = { t: 0.5, hold: 0.55, cutDone: false, cutNow: false, willCut: false, backCut: false, swCut: false, replan: false, rAdd: 0.5, hero: null, team: 0, set: false,
              ang: 0.5, R: 5.4, z: 1.9, gx: 0.5, gy: 0.5, v: [0.5, 0.5, 0.5, 0.5], m: [null, null, null, null, null], nm: 0, orb: 1.5 };
  var TPPD = { hero: 0, team: 0, ang: 0, face: 0, pen: 0, set: false }, TPPF = { cut: false };   // (TPPF: getDebug().pf sin corte de reacción: ui.js arma la cortinilla de vuelta al saque)
  function tpPlan(g) {
    var e = pointEv, w = e && (e.team === 0 || e.team === 1) ? e.team : (g.lastPoint && (g.lastPoint.team === 0 || g.lastPoint.team === 1) ? g.lastPoint.team : 0);
    var hero = e && e.player && e.player.team === w ? e.player : null;
    if (!hero) hero = w === 0 && g.ctrl ? g.ctrl : pickHero(g, w, pointHow || inferHow(g));
    if (!hero || hero.team !== w) hero = nearestOf(g.teams[w], g.ball.x, g.ball.y, null) || g.teams[w][0];
    TPP.hero = hero; TPP.team = w; TPP.set = !!(e && (e.setWon || e.matchWon));
    TPP.R = TPP.set ? 6.8 : 5.4; TPP.z = TPP.set ? 3.2 : 2.7;
    // compañeros cercanos (los 3 más cercanos a < 5 m; en el cierre, 5 a < 9 m)
    var tm = g.teams[w], nMax = TPP.set ? 5 : 3, rMax = TPP.set ? 9 : 5;
    TPP.nm = 0;
    for (var n = 0; n < nMax; n++) {
      var best = null, bd = rMax;
      for (var i = 0; i < tm.length; i++) {
        var q = tm[i]; if (q === hero) continue;
        var used = false; for (var j = 0; j < TPP.nm; j++) if (TPP.m[j] === q) used = true;
        if (used) continue;
        var d = hyp(q.x - hero.x, q.y - hero.y); if (d < bd) { bd = d; best = q; }
      }
      if (!best) break;
      TPP.m[TPP.nm++] = best;
    }
    visPos(hero, VP);
    var hfP = Math.atan(Math.tan(20 * DEG) * aspect()) + 0.15;   // (medio ángulo horizontal de un plano de ~40° de lente, con margen)
    var hx = VP.x, hy = VP.y, fy = faceOf(hero), bestA = hero.team === 0 ? PI : 0, bestS = 1e9, R0 = TPP.R, bestR = R0;
    for (var kk = 0; kk < 72; kk++) {
      var k = kk % 24, ri = (kk / 24) | 0, Rk = R0 * (ri === 0 ? 1 : ri === 1 ? 0.8 : 1.3);
      var a = k * PI / 12, cx = hx + Rk * Math.cos(a), cy = hy + Rk * Math.sin(a), pen = ri ? 1.5 : 0;
      if (Math.abs(cx) > 14.4 || Math.abs(cy) > 8.6) continue;
      if ((cx > 0) !== (hx > 0) && Math.abs(hx) > 0.6) pen += 30;          // (al otro lado de la red: la malla delante)
      if (Math.abs(cx) < 1.2 && Math.abs(cy) < 6.3) pen += 40;             // (dentro de la red o de los postes)
      else if (Math.abs(cx) < 2.8 && Math.abs(cy) < 6.3) pen += 7 * (1 - (Math.abs(cx) - 1.2) / 1.6);   // (pegada a la red: la malla cruza el cuadro)
      var vx = hx - cx, vy = hy - cy, l2 = vx * vx + vy * vy;
      for (var pi2 = 0; pi2 < g.players.length; pi2++) {
        var o = g.players[pi2]; if (o === hero) continue;
        var to = ((o.x - cx) * vx + (o.y - cy) * vy) / l2; if (to < 0.04 || to > 0.96) continue;
        var dd = Math.abs((o.x - cx) * vy - (o.y - cy) * vx) / sq(l2);
        if (dd < 0.7) pen += (o.team === hero.team ? 14 : 18) * (1 - dd / 0.7) + 4;
      }
      for (var ob = 0; ob < OBST.length; ob++) {
        var oo = OBST[ob], tb = mn(mx(((oo[0] - cx) * vx + (oo[1] - cy) * vy) / l2, 0), 1);
        if (hyp(cx + vx * tb - oo[0], cy + vy * tb - oo[1]) < oo[2] + 0.4) pen += 25;
      }
      // (nadie ni nada pegado a la cámara dentro del cuadro: salía enorme y cortado en una esquina)
      var va = at2(vy, vx);
      for (var pj = 0; pj < g.players.length; pj++) {
        var oq = g.players[pj]; if (oq === hero) continue;
        var dqc = hyp(oq.x - cx, oq.y - cy), rN = mx(3.6, 0.85 * Rk); if (dqc > rN) continue;
        if (Math.abs(wrap(at2(oq.y - cy, oq.x - cx) - va)) < hfP) pen += 14 * (1 - dqc / rN) + 3;
      }
      for (var oc = 0; oc < 2; oc++) { var py = oc ? -5.5 : 5.5, dpc = hyp(cx, cy - py); if (dpc < 3.5 && Math.abs(wrap(at2(py - cy, -cx) - va)) < 0.8) pen += 12 * (1 - dpc / 3.5) + 4; }
      pen += 16 * (1 - Math.cos(wrap(a - fy))) / 2;                         // (de frente al héroe, mejor que de espaldas)
      for (var mi = 0; mi < TPP.nm; mi++) {                                 // (compañeros en el cuadro, más allá del héroe o a su lado)
        var mq = TPP.m[mi], mvx = mq.x - cx, mvy = mq.y - cy, md = hyp(mvx, mvy);
        if (md > 1.5 && Math.abs(wrap(at2(mvy, mvx) - at2(vy, vx))) < 0.45) pen -= 2.5;
      }
      if (pen < bestS) { bestS = pen; bestA = a; bestR = Rk; }
    }
    TPP.R = bestR;
    TPPD.hero = hero.num; TPPD.team = w; TPPD.ang = +(bestA / DEG).toFixed(0); TPPD.face = +(fy / DEG).toFixed(0); TPPD.pen = +bestS.toFixed(1); TPPD.set = TPP.set; dbg.tpp = TPPD;
    TPP.rAdd = 0; TPP.ang = bestA; TPP.orb = Math.sin(wrap(fy - bestA)) >= 0 ? 1 : -1;
    TPP.gx = hx; TPP.gy = hy; TPP.v[0] = TPP.v[1] = TPP.v[2] = TPP.v[3] = 0;
  }
  function tpPointShot(g) {
    if (!TPP.cutDone || !TPP.hero) { tpShot(g); return; }
    var dt = K.dt, h = TPP.hero, asp = aspect();
    if (dt > 0 && TPP.set && !comfort()) TPP.ang += TPP.orb * 3 * DEG * dt;
    visPos(h, VP);
    var gx = VP.x, gy = VP.y, ws = 1;
    for (var i = 0; i < TPP.nm; i++) { var q = TPP.m[i]; if (hyp(q.x - VP.x, q.y - VP.y) < (TPP.set ? 9 : 5.5)) { gx += q.x * 0.4; gy += q.y * 0.4; ws += 0.4; } }
    gx /= ws; gy /= ws;
    if (dt > 0) { TPP.gx = sd1(TPP.gx, gx, TPP.v, 0, 0.6, dt); TPP.gy = sd1(TPP.gy, gy, TPP.v, 1, 0.6, dt); } else { TPP.gx = gx; TPP.gy = gy; }
    // (alguien que se acerca a la cámara durante la celebración y entraría enorme por un lado: la cámara se aleja, hasta 2,5 m más)
    var pushW = 0, hf = Math.atan(Math.tan(K.fovCur * DEG / 2) * asp) + 0.12, cx0 = VP.x + TPP.R * Math.cos(TPP.ang), cy0 = VP.y + TPP.R * Math.sin(TPP.ang), va0 = TPP.ang + PI;
    for (var pk = 0; pk < g.players.length; pk++) {
      var pq = g.players[pk]; if (pq === h) continue;
      var dpq = hyp(pq.x - cx0, pq.y - cy0); if (dpq > 3.0) continue;
      if (Math.abs(wrap(at2(pq.y - cy0, pq.x - cx0) - va0)) < hf) pushW = 1;
    }
    if (dt > 0) TPP.rAdd = clamp(TPP.rAdd + (pushW ? 3.5 : -0.6) * dt, 0, 2.5);
    var Rn = TPP.R + TPP.rAdd, cx = VP.x + Rn * Math.cos(TPP.ang), cy = VP.y + Rn * Math.sin(TPP.ang);
    D.x = clamp(cx, -14.4, 14.4); D.y = clamp(cy, -8.6, 8.6); D.z = TPP.z;
    var yaw = at2(TPP.gy - D.y, TPP.gx - D.x);
    TPC.x = D.x; TPC.y = D.y; TPC.z = D.z; TPC.c = Math.cos(yaw); TPC.s = Math.sin(yaw);
    // héroe: cabeza a +0,42 NDC, pies a -0,72 (cierre: el equipo, con la lente que pidan los compañeros a lo ancho)
    var hh = heightOf(h), aH = tpEl(VP.x, VP.y, mx(0, h.z) + hh + 0.15), aF = tpEl(VP.x, VP.y, 0), t = 0.33, pitch = -0.1;
    if (aH === aH && aF === aF && aH - aF > 0.02) { var f = fit2(aH, 0.42, aF, -0.72); t = f.t; pitch = f.p; }
    for (var j = 0; j < TPP.nm; j++) {
      var m = TPP.m[j], fdm = (m.x - D.x) * TPC.c + (m.y - D.y) * TPC.s;
      if (fdm > 1.5 && hyp(m.x - VP.x, m.y - VP.y) < (TPP.set ? 9 : 5.5)) t = mx(t, Math.abs((m.x - D.x) * TPC.s - (m.y - D.y) * TPC.c) / fdm / 0.85 / asp);
    }
    var fv = clamp(2 * Math.atan(t) / DEG, 26, TPP.set ? 60 : 52);
    K.fovWant = fv;
    if (aF === aF) pitch = aF + Math.atan(0.72 * Math.tan(fv * DEG / 2));   // (pies a -0,72 con la lente final)
    pitch = clamp(pitch, -0.7, 0.3);
    var cpt = Math.cos(pitch);
    A.x = D.x + TPC.c * cpt * 10; A.y = D.y + TPC.s * cpt * 10; A.z = D.z + Math.sin(pitch) * 10;
  }

  function computeDesired(g) {
    var s = shot, dt = K.dt;
    if (s === 'tv') tvShot(g);
    else if (s === 'tp') tpShot(g);
    else if (s === 'tpPoint') tpPointShot(g);
    else if (s === 'menu') menuShot(g);
    else if (s === 'point') pointShot(g);
    else if (s === 'court') courtShot(g);
    else if (s === 'review') reviewShot(g);
    else if (s === 'clinch') clinchShot(g);
    else if (s === 'cutaway') cutawayShot(g);
    else if (s === 'intro') introShot(g);
    else if (s === 'over') overShot(g);
    else if (s === 'serveUs') { gameplayShot(g, SHOTS.serveUs); serveUsComp(g, SHOTS.serveUs); }   // (CAM-15: la composición manda)
    else { gameplayShot(g, SHOTS[s] || SHOTS.rally); lostFollow(g, s, dt); }
  }
  /** Balón perdido (lostBall): la mira sigue al balón hasta el bote, como un operador que acompaña un balón que se va a la grada
   *  (aunque pase por detrás del plano de la cámara: ahí el encuadre fino no lo ve). Entra y sale en ~0,2 s. */
  var LW = [0.5]; LW[0] = 0;
  function lostFollow(g, s, dt) {
    var on = (s === 'rally' || s === 'attack' || s === 'defend') && !(K.ftW > 0.01) && lostBall(g);
    LW[0] = dt > 0 ? LW[0] + ((on ? 1 : 0) - LW[0]) * mn(1, dt * 5) : (on ? 1 : 0);
    if (LW[0] < 0.01) return;
    var b = g.ball, w = 0.75 * smooth01(LW[0]);
    A.x += (b.x - A.x) * w; A.y += (b.y - A.y) * w; A.z += (mx(b.z, 0.3) - A.z) * w;
  }

  /** Transición de plano: suavizado más largo y con velocidad máxima, que decae a lo normal. */
  function startBlend(dur, smoothT, maxSpeed) { K.blendDur = K.blendT = dur; K.blendSmooth = smoothT; K.blendMax = maxSpeed; }

  function onShotChange(g, from, to) {
    FB.on = false;
    // 6v6 en 3ª persona: al punto se sigue con la cámara de juego (el corte al plano de reacción lo hace update); del punto al saque,
    // siempre por corte (los jugadores aparecen en su sitio de golpe); entre 3ª persona y televisión (cambio del ajuste), corte
    if (to === 'tpPoint') {
      TPP.t = 0; TPP.cutDone = false; TPP.cutNow = false; TPP.hold = 0.55;
      TPP.willCut = !(typeof g.timer === 'number') || gameToReal(g.timer) > TPP.hold + 0.9;
      return;
    }
    if (from === 'tpPoint' && to === 'tp') { TPP.backCut = true; K.blendT = 0; return; }
    if (((from === 'tp' || from === 'tpPoint') && to === 'tv') || (from === 'tv' && to === 'tp')) { TPP.swCut = true; K.blendT = 0; return; }
    // de un plano cinemático (punto, grúa, final, menú) a uno de juego: los suavizados de juego (empujón del
    // compañero, oclusión, red, salto, lado del remate, subida táctil…) arrancan YA en su objetivo (semántica dt = 0):
    // sus valores eran del peloteo anterior y desviaban el plano nuevo durante ~1 s
    if (GAMEPLAY[to] && !GAMEPLAY[from]) settleSmoothers = true;
    if (SHOTS[to] && SHOTS[to].wide && !(SHOTS[from] && SHOTS[from].wide)) K.wideT = 0;
    // cierre de set/partido (CAM-09): sus cortes los hace update (CL.cutNow); al salir: grúa / final / punto como siempre, saque por corte
    // revisión del challenge (B5): entra y sale por CORTE (como la tele); al volver al punto, se replanifica su plano
    if (to === 'review') { reviewPlan(g); RV.cutIn = true; K.blendT = 0; FT.on = false; if (comfort()) K.shakeT = 0; return; }
    if (from === 'review') {
      RV.cutOut = true; K.blendT = 0;
      if (to === 'point') { K.pointT = 0; planPoint(g, pointHow || inferHow(g), pointPlayer); PF.backLock = false; PF.backCut = true; }
      if (GAMEPLAY[to]) settleSmoothers = true;
      return;
    }
    if (to === 'clinch') { K.blendT = 0; return; }
    if (to === 'intro') { K.blendT = 0; INTRO.cutIn = true; return; }   // (del menú a la grúa: corte limpio, sin cruzar el pabellón volando)
    if (from === 'intro') { K.blendT = 0; INTRO.cut = true; return; }
    if (to === 'cutaway') { K.blendT = 0; CW.cutIn = true; return; }
    if (from === 'cutaway') { K.blendT = 0; CW.cutOut = true; return; }
    if (from === 'clinch' && (to === 'serveUs' || to === 'serveThem')) { PF.backCut = true; PF.backLock = true; PF.cut = true; backPending = true; return; }
    if (from === 'clinch' && GAMEPLAY[to]) { K.blendT = 0; return; }   // (se deshizo: corte, ver CL.abortCut)
    if (to === 'point') {
      K.pointT = 0;
      planPoint(g, pointHow || inferHow(g), pointPlayer);
      PF.backLock = false; PF.backCut = true;
      // si se llega deslizando (mismo campo y cerca): 1,2 s, lento y con el giro limitado a 60°/s
      if (!PF.cut) startBlend(1.2, 0.8, 9); else K.blendT = 0;
      return;
    }
    if (to === 'court') {
      // la grúa SIEMPRE entra por corte (anunciado en nextCutIn desde el evento courtChange): desde el plano de
      // reacción (1,6 m, FOV ~34°) a 7 m de altura no hay deslizamiento limpio
      courtPose(0, D, A);
      CC.cut = true; K.blendT = 0;
      return;
    }
    // de la grúa del cambio de campo al saque: baja deslizando, sin corte
    if (from === 'court') { if (ccAbort) cutCheck = true; else startBlend(1.4, 0.9, 12); return; }
    // del punto al saque: corte o transición fija según lo decidido (y anunciado) durante el punto (ver update)
    if (from === 'point' && (to === 'serveUs' || to === 'serveThem')) { backPending = true; return; }
    // 6v6: del plano de reacción a la cámara de televisión, siempre por corte (como la tele; deslizando cruzaba la pista entre jugadores)
    if (from === 'point' && to === 'tv') { PF.backCut = true; backPending = true; return; }
    if (from === 'point') cutCheck = true;
    if (to === 'over') {
      K.overT = 0; var w = g.sets[0] >= g.sets[1] ? 0 : 1, t = g.teams[w], sdw = w === 0 ? 1 : -1;
      overC.x = (t[0].x + t[1].x) / 2; overC.y = (t[0].y + t[1].y) / 2;
      K.overSep = hyp(t[0].x - t[1].x, t[0].y - t[1].y);
      // órbita desde la banda más cercana, inclinada hacia el fondo de los ganadores (lejos de la red)
      var sideY = P.y >= overC.y ? 1 : -1;
      K.overA0 = at2(sideY, sdw * 0.55);
      K.overA0 = overPick(g, w);
      startBlend(1.6, 1.1, 8);
      return;
    }
    if (to === 'menu') { MN.k = -1; startBlend(1.2, 1.2, 12); return; }
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
  /** ¿Balón perdido? En el peloteo, bote previsto en <= 1,2 s a más de 0,4 m por fuera de la pista (de lado o de fondo). Se calcula
   *  una vez por frame (predictLanding no es gratis). */
  var LBP = { x: 0.5, y: 0.5, z: 0.5, t: 0.5 }, lbF = -1, lbV = false;
  function lostBall(g) {
    var f = ctx ? ctx.frame : 0;
    if (f === lbF) return lbV;
    lbF = f; lbV = false;
    var S0 = VB.Sim, b = g.ball;
    if (g.mode !== 'rally' || !b || b.held || !S0 || !S0.predictLanding) return false;
    try { S0.predictLanding(g, LBP); } catch (e) { return false; }
    if (!(LBP.t > 0 && LBP.t <= 1.2) || LBP.x !== LBP.x) return false;
    var C0 = VB.C || {}, HL = g.HL > 0 ? g.HL : (C0.HL || 9), HW = g.HW > 0 ? g.HW : (C0.HW || 4.5); // pista de la partida (playa 16×8)
    lbV = Math.abs(LBP.x) > HL + 0.4 || Math.abs(LBP.y) > HW + 0.4;
    return lbV;
  }
  function touchUI() { return !!(VB.Input && VB.Input.overlayShown && VB.Input.overlayShown()); }
  // (ángulos actuales y dt por K.yaw0, K.pitch0 y K.dt)
  function framing(g) {
    var yaw0 = K.yaw0, pitch0 = K.pitch0, dt = K.dt, wantP = 0, wantY = 0, wantBoost = 0;
    dbg.ballVisible = true; dbg.focusNdcY = 9; dbg.mateLo = -9;
    var mateUpWant = 0;
    if (GAMEPLAY[shot] && shot !== 'serveUs' && g && g.ctrl) {   // (saque propio: la composición de serveUsComp ya es exacta, CAM-15)
      var b = g.ball, p = g.ctrl, touch = touchUI();
      var tanH = Math.tan(K.fovCur * DEG / 2), tanW = tanH * aspect();
      var cy = Math.cos(yaw0), syw = Math.sin(yaw0);
      // sujeto: el jugador controlado o, durante un cambio, el punto que se desliza hacia él
      var sx = p.x, sy = p.y, sz = p.z;
      if (sw.active) { sx = S.x; sy = S.y; sz = S.z; }
      var pfd = (sx - P.x) * cy + (sy - P.y) * syw;
      var prt = (sx - P.x) * syw - (sy - P.y) * cy;
      // balón anticipado ~0,25 s (el suavizado va por detrás; así no se escapa al subir)
      // (en móvil/táctil mira más adelante en la subida: el cabeceo va limitado y la franja de toques es más alta)
      var small = touch || ctx.isMobile;
      var bX = b.x + b.vx * 0.2, bY = b.y + b.vy * 0.2, bZ = b.z + mx(0, b.vz) * (small ? 0.4 : 0.28);
      // BALÓN QUE SE VA (pantalla pequeña, CAM-11): nuestro toque lo manda al campo rival y nadie de los nuestros tiene que jugarlo
      // ahora: el jugador puede bajar en el cuadro (cadera hasta -0,85 NDC) y el balón subir algo más (0,72; la franja de toques acaba
      // en ~0,88), en vez de abrir 12-15° el FOV para un balón que ya no es nuestro. Suavizado (sin saltos del cabeceo).
      var awayW = (small && g.mode === 'rally' && g.touchTeam === 0 && b.vx < -0.5 && g.lastKind !== '' && (g.touches >= 3 || g.lastKind === 'spike' || g.lastKind === 'free' || b.x < 0.5)) ? 1 : 0;
      if (dt > 0) K.awayK += (awayW - K.awayK) * mn(1, dt * (awayW > K.awayK ? 3 : 2)); else K.awayK = awayW;
      // colocación propia en el aire (remate) o táctil: se encuadra ya la CUMBRE prevista del balón (el FOV y el
      // cabeceo llegan a tiempo en vez de ir detrás de un balón que sube a 6-7 m/s)
      // (CAM-12: también en la defensa: la colocación rival sube a 6-7 m y en 21:9 el FOV vertical es corto)
      if ((shot === 'attack' || shot === 'defend' || touch) && b.vz > 0.5 && g.mode === 'rally') {
        var Gc = (VB.C && VB.C.G) || 9.81, tUp = mn(1.2, b.vz / Gc);
        var apexZ = b.z + b.vz * tUp * 0.5;
        if (apexZ > bZ) { bZ = apexZ; bX = b.x + b.vx * tUp * 0.6; bY = b.y + b.vy * tUp * 0.6; }
      }
      // SAQUE RIVAL: se encuadra desde el principio la CUMBRE del lanzamiento (en salto, 4,6 m; delante del sacador) en
      // vez del balón en la mano: el plano queda fijo hasta el golpe (antes cabeceaba ~1,5° arriba y abajo con el lanzamiento)
      if (shot === 'serveThem' && g.mode === 'serve' && g.server && g.server.team === 1) {
        var svr = g.server, apexZ0 = (svr.z || 0) + 4.75;
        if (bZ < apexZ0) { bX = svr.x + 0.9; bY = svr.y; bZ = apexZ0; }
      }
      var bfd = (bX - P.x) * cy + (bY - P.y) * syw;
      var brt = (bX - P.x) * syw - (bY - P.y) * cy;
      if (pfd > 0.5) {
        var aF = at2(sz - P.z, pfd), sc = SHOTS[shot];
        // límite: la cadera del jugador (z+0,95) nunca por debajo del 8 % inferior; los pies pueden salir un instante.
        // Táctil: cadera por encima de -0,55 y pies de -0,9 (los botones y el joystick ocupan el tercio inferior).
        // Saque propio (fit): el punto bajo del ajuste (pecho del sacador), sin límite de pies.
        var aHip, pMax;
        if (sc && sc.fit) { aHip = at2(sz + fitLow.z - P.z, pfd); pMax = aHip + Math.atan((-fitLow.n + 0.04) * tanH) - pitch0; }
        else {
          aHip = at2(sz + 0.95 - P.z, pfd);
          var hipN = touch ? (shot === 'attack' ? 0.7 : 0.55) : aspect() > 2 ? 0.72 : 0.84;   // (ultrapanorámica: margen, CAM-12 la quiere siempre dentro)   // (remate en táctil: el rematador va hacia la red, lejos de los botones)
          // (táctil, CAM-11: los pulgares ocupan las esquinas de abajo, no el centro: con el jugador centrado entre el joystick y los
          // botones, su cadera puede bajar a -0,72 NDC; con el balón que se va al campo rival, a -0,85)
          if (touch) {
            var pxN = Math.tan(at2(prt, pfd) + K.exYaw) / tanW, cen = 1 - smooth01((Math.abs(pxN + 0.05) - 0.28) / 0.14);
            hipN += (shot === 'attack' ? 0.08 : 0.17) * cen;
            hipN += (0.85 - hipN) * K.awayK;
          }
          var feetN = touch ? 0.9 + 0.25 * mx(cen || 0, K.awayK) : 1.25;   // (táctil: pies centrados, pueden salir por abajo: ahí no hay pulgares)
          pMax = mn(aHip + Math.atan(hipN * tanH), aF + Math.atan(feetN * tanH)) - pitch0;
          if (DBGX) { DBGX[3] = (aHip + Math.atan(hipN * tanH) - pitch0) / DEG; DBGX[4] = (aF + Math.atan(feetN * tanH) - pitch0) / DEG; DBGX[5] = 99; }
          // defensa que se acerca (CAM-13): manda la CABEZA del defensor (>= -0,8 NDC; táctil -0,45), no su cadera
          if (K.defU > 0.001 || K.blkU > 0.001) {
            var uwH = aspect() > 2 && !touch;
            var pmH = at2(sz + (uwH ? 0.95 : 1.75) - P.z, pfd) + Math.atan((touch ? 0.45 : uwH ? 0.9 : 0.8) * tanH) - pitch0;
            var mH = mateOf(g), mHfd = (mH.x - P.x) * cy + (mH.y - P.y) * syw;
            if (mHfd > 1) pmH = mn(pmH, at2(mH.z + (uwH ? 0.95 : 1.75) - P.z, mHfd) + Math.atan((touch ? 0.55 : uwH ? 0.92 : 0.85) * tanH) - pitch0);
            if (pmH > pMax) pMax += (pmH - pMax) * smooth01(mx(K.defU, K.blkU));
          }
        }
        // punto de juego (donde se jugará el próximo toque propio) por encima de la franja de avisos
        var fp = null, hF = 0, fNdcY = 9;
        if (g.mode === 'rally' && VB.Sim && VB.Sim.focusPoint && (b.vx > 0.5 || g.touchTeam === 0)) {
          fp = VB.Sim.focusPoint(g);
          if (fp && fp.x > 0 && fp.x < 10) {
            var ffd = (fp.x - P.x) * cy + (fp.y - P.y) * syw;
            if (ffd > 1.5) {
              var aFo = at2(-P.z, ffd), yMin = touch ? -0.5 : -0.56;
              // (táctil, CAM-11: el aro centrado entre el joystick y los botones puede bajar a -0,7: ahí no hay pulgares; con el
              // límite de -0,5 el aro del remate no dejaba cabecear hacia la colocación y se abría el FOV 15°)
              if (touch) { var fxN = Math.tan(at2((fp.x - P.x) * syw - (fp.y - P.y) * cy, ffd) + K.exYaw) / tanW; yMin -= 0.2 * (1 - smooth01((Math.abs(fxN + 0.05) - 0.28) / 0.14)); }
              // como mucho 9° más de picado por esto (un bote justo delante de la cámara no la tumba)
              pMax = mn(pMax, mx(-9 * DEG, aFo - Math.atan(yMin * tanH) - pitch0));
              if (DBGX) DBGX[5] = (aFo - Math.atan(yMin * tanH) - pitch0) / DEG;
              hF = at2((fp.x - P.x) * syw - (fp.y - P.y) * cy, ffd);
              fNdcY = Math.tan(aFo - (pitch0 + K.exPitch)) / tanH;
              dbg.focusNdcY = fNdcY;
            } else fp = null;
          } else fp = null;
        }
        // TÁCTIL: compañero en primer plano (entre la cámara y el jugador) con solo la coronilla asomando por el borde
        // inferior: se leía como una mancha oscura entre el joystick y SALTAR. Si sus hombros ya quedan fuera, se saca
        // también la cabeza: 1) cabeceando lo justo, si el jugador y el aro (pMax) lo permiten; 2) si no, subiendo la
        // cámara (K.mateUp, hasta 0,9 m): desde más alto, lo cercano baja en el cuadro mucho más que lo lejano. Si sus
        // hombros se ven, es una figura "por encima del hombro" de verdad y se deja. Estable: al sacarlo, los hombros
        // bajan aún más; solo se suelta cuando el compañero avanza hacia el centro del cuadro.
        var mateLo = -9;
        if (touch && !(K.blkU > 0.3 && K.netK > 0.5)) {   // (CAM-17: en el plano bajo del bloqueo el compañero de atrás puede asomar abajo)
          var mm = mateOf(g), mmfd = (mm.x - P.x) * cy + (mm.y - P.y) * syw;
          if (mmfd > 0.4 && mmfd < pfd) {
            var mmX = Math.tan(at2((mm.x - P.x) * syw - (mm.y - P.y) * cy, mmfd) + K.exYaw) / tanW;
            var shN = Math.tan(at2(mm.z + 1.42 - P.z, mmfd) - (pitch0 + K.exPitch)) / tanH;
            if (mmX > -1.15 && mmX < 1.15 && shN < -0.8) {
              var pOut = at2(mm.z + 2.05 - P.z, mmfd) + Math.atan(1.06 * tanH) - pitch0;
              if (pOut <= pMax) mateLo = pOut;
              // lo que el cabeceo no da, en altura: ~ (1/d_compañero - 1/d_jugador) rad por metro subido (integrador)
              mateUpWant = clamp(K.mateUp + (pOut - pMax) / mx(0.08, 1 / mmfd - 1 / pfd), 0, 0.9);
            }
          }
        }
        dbg.mateLo = mateLo;
        if (bfd > 0.8) {
          var aB = at2(bZ - P.z, bfd);
          // balón por debajo del 10 % superior (móvil: 13 %, la franja de toques del HUD es proporcionalmente más alta)
          // táctil: centro del balón por debajo de 0,62 NDC (la franja de toques acaba a ~0,83 NDC a 390 px de alto;
          // se resta el radio del balón y el retraso del cabeceo limitado)
          var need = aB - Math.atan((touch ? 0.70 + 0.04 * K.awayK : ctx.isMobile ? 0.72 + 0.03 * K.awayK : 0.80) * tanH) - pitch0;
          // en la red / defensa, el balón alto en campo rival pesa menos en el cabeceo (el resto, FOV):
          // un colocador rival a 6 m de altura no debe llenar el cuadro de grada
          var bw = 1 - 0.6 * K.netK;
          if (shot === 'defend' && b.x < 0) bw = mn(bw, 0.55);
          var lo = need > 0 ? need * bw : need;
          // (aunque pese menos, el balón nunca por encima de 0,9 NDC: 0,7 en táctil)
          if (bw < 1) { var need9 = aB - Math.atan((touch ? 0.7 : 0.9) * tanH) - pitch0; if (need9 > lo) lo = need9; }
          if (mateLo > lo) lo = mateLo;
          wantP = mn(mx(0, lo), mx(lo, pMax));
          if (lo > pMax) wantP = pMax;                          // el jugador manda sobre el balón
          // lo que el cabeceo no da (por el límite del jugador o por el límite de velocidad angular, que va
          // por detrás), lo da el FOV. Tope 10° (16° en el remate y en táctil: mejor abrir que perder el balón)
          var lagP = mx(0, K.lagPitch);
          var bCap = (shot === 'attack' || touch || (shot === 'defend' && aspect() > 2)) ? 16 : 10;
          if (need > wantP - lagP) wantBoost = mn(mx((need - wantP + lagP) / DEG * 1.6, 0), bCap);
          // PANTALLA PEQUEÑA (CAM-11): el cabeceo se anticipa con la cumbre prevista (gratis: no se nota), pero el FOV solo responde al
          // balón REAL (adelantado 0,15 s) frente al cabeceo que la cámara YA tiene (con su retraso): antes la cumbre prevista contra el
          // cabeceo objetivo pedía 5-15° de FOV que no hacían falta (el balón no pasaba de 0,54 NDC con el límite en 0,70). Cálculo
          // EXACTO del FOV vertical que deja el balón en el límite con el cabeceo REAL de ahora (no depende del FOV actual: sin la
          // realimentación que hacía subir la ayuda a escalones hasta el tope)
          if (small && sc && sc.wide) {
            var rfdB = (b.x + b.vx * 0.15 - P.x) * cy + (b.y + b.vy * 0.15 - P.y) * syw;
            wantBoost = 0;
            if (rfdB > 0.8) {
              // (defensa que se acerca: el balón alto del colocador rival, lejos y pequeño, puede subir a 0,78: el contador de toques acaba en 0,88)
              var limB = (touch ? 0.70 + 0.04 * K.awayK : 0.72 + 0.03 * K.awayK) + 0.08 * smooth01(K.defU);
              var alpha = at2(b.z + b.vz * 0.15 - P.z, rfdB) - (pitch0 + K.exPitch - lagP);
              if (alpha > 0.01 && alpha < 1.2) wantBoost = mn(mx(2 * Math.atan(Math.tan(alpha) / limB) / DEG - K.fovWant, 0), bCap);
            }
          }
          if (DBGX) { DBGX[0] = need / DEG; DBGX[1] = wantP / DEG; DBGX[2] = pMax / DEG; }
          // horizontal: sesgo suave hacia el balón, sin sacar al jugador del cuadro
          var hB = at2(brt, bfd), hP = at2(prt, pfd);
          var mB = Math.atan(0.82 * tanW), mP = Math.atan(0.62 * tanW);
          var d = -0.16 * hB;
          // táctil: el aro y los pies, fuera del grupo de botones (abajo a la derecha) y del joystick (abajo a la izquierda);
          // y si colocas tú, también el compañero (el rematador al que vas a colocar)
          if (touch) {
            var xMax = Math.atan(0.38 * tanW), xMin = -Math.atan(0.5 * tanW), pNdc = Math.tan(aF - (pitch0 + K.exPitch)) / tanH;
            if (fp && fNdcY < -0.3) d = mn(d, xMax - hF);
            if (pNdc < -0.3) { d = mn(d, xMax - hP); d = mx(d, xMin - hP); }
            if (g.touchTeam === 0 && g.touches === 1 && g.mode === 'rally') {
              var mt = mateOf(g), mfd = (mt.x - P.x) * cy + (mt.y - P.y) * syw;
              if (mfd > 1) {
                var hM = at2((mt.x - P.x) * syw - (mt.y - P.y) * cy, mfd);
                var mNdc = Math.tan(at2(mt.z + 1.2 - P.z, mfd) - (pitch0 + K.exPitch)) / tanH;
                if (mNdc < -0.25) {
                  var dM = mx(mn(d, xMax - hM), xMin - hM);
                  // si el compañero y el jugador no caben a la vez fuera de los botones, se abre un poco el FOV
                  if (Math.abs(dM - d) > 0.02 && ((dM < d && pNdc < -0.3 && dM < xMin - hP) || (dM > d && pNdc < -0.3 && dM > xMax - hP))) wantBoost = mx(wantBoost, 5);
                  else d = dM;
                }
              }
            }
          }
          d = mn(mx(d, -mB - hB), mB - hB);
          d = mn(mx(d, -mP - hP), mP - hP);
          wantY = mn(mx(d, -0.32), 0.32);
          // BALÓN PERDIDO (un toque que sale muy desviado, hacia la banda o por detrás de la cámara): ya no hay nada que jugar, así que
          // manda el balón (dentro de ±0,75 NDC en horizontal y por encima de -0,8 en vertical) aunque el jugador quede al borde
          if (lostBall(g)) {
            var limL = Math.atan(0.75 * tanW);
            wantY = mn(mx(mn(mx(d, -limL - hB), limL - hB), -0.7), 0.7);
            var lowP = aB - pitch0 + Math.atan(0.8 * tanH);
            if (lowP < wantP) wantP = mx(lowP, -0.5);
          }
          // diagnóstico
          var rfd = (b.x - P.x) * cy + (b.y - P.y) * syw, rrt = (b.x - P.x) * syw - (b.y - P.y) * cy;
          var ay = Math.tan(at2(b.z - P.z, rfd) - (pitch0 + K.exPitch)) / tanH, ax = Math.tan(at2(rrt, rfd) + K.exYaw) / tanW;
          if (rfd < 0.3) { ay = 0; ax = 0; }
          dbg.ballNdcY = ay; dbg.ballNdcX = ax; dbg.ballVisible = Math.abs(ay) <= 1 && Math.abs(ax) <= 1;
        }
        else wantP = mateLo > 0 ? mn(mateLo, pMax) : mn(0, pMax);
        // cambio de jugador: si el jugador NUEVO aún está fuera por abajo, se abre el FOV (no se cabecea)
        var rfdC = (p.x - P.x) * cy + (p.y - P.y) * syw, cNdc = rfdC > 0.3 ? Math.tan(at2(p.z + 0.95 - P.z, rfdC) - (pitch0 + K.exPitch)) / tanH : -3;
        var swLim = aspect() > 2 && !touch ? -0.8 : -0.9;   // (ultrapanorámica: antes, CAM-12)
        // (táctil: los pies del jugador nuevo pueden salir un instante por abajo, en el centro no hay pulgares: como mucho 4°)
        if (sw.active && cNdc < swLim) wantBoost = mx(wantBoost, mn(mx((swLim - cNdc) * (touch ? 4 : 8), 0), touch ? 4 : 9));
        dbg.ctrlNdcY = rfdC > 0.3 ? Math.tan(at2(p.z - P.z, rfdC) - (pitch0 + K.exPitch)) / tanH : -9; dbg.pfd = pfd;
      }
    }
    K.mateUpWant = mateUpWant;
    // seguimiento del remate (CAM-08): manda la mira hacia el bote; el encuadre fino del peloteo se aparta
    if (K.ftW > 0.001) { var fk = 1 - mn(K.ftW, K.ftWe); wantP *= fk; wantY *= fk; wantBoost *= fk; }
    if (dt > 0) {
      K.exPitch = sd1(K.exPitch, wantP, exVel, 0, 0.30, dt);
      K.exYaw = sd1(K.exYaw, wantY, exVel, 1, 0.36, dt);
      // (abrir, deprisa: el balón sube; cerrar, despacio)
      // PANTALLA PEQUEÑA (CAM-11): FOV de ayuda con HISTÉRESIS: solo se abre si hace falta > ~0,05 NDC más (2,4° de ayuda), se abre
      // de una vez con 1° de margen, se mantiene >= 0,6 s y se cierra a <= 5°/s (antes seguía al balón frame a frame: bombeo)
      var bT = wantBoost;
      if ((touchUI() || ctx.isMobile) && SHOTS[shot] && SHOTS[shot].wide) {
        if (wantBoost > K.bHold + 2.4) { K.bHold = mn(16, wantBoost + 1); K.bHoldT = 0.6; }
        else if (K.bHoldT > 0) K.bHoldT -= dt;
        else if (wantBoost < K.bHold) K.bHold = mx(wantBoost, K.bHold - 2 * dt);
        bT = K.bHold;
      } else { K.bHold = wantBoost; K.bHoldT = 0; }
      if (K.ftW > 0.001) { bT *= 1 - K.ftW; if (K.ftW > 0.5) { K.bHold = mn(K.bHold, bT); K.bHoldT = 0; } }   // (seguimiento del remate)
      if ((touchUI() || ctx.isMobile) && SHOTS[shot] && SHOTS[shot].wide && !(K.ftW > 0.001)) {
        // (pantalla pequeña: el FOV de ayuda cambia a ritmo limitado: abre a <= 10°/s, cierra a <= 2°/s; nada de bombeo)
        K.fovBoost += mn(mx(bT - K.fovBoost, -2.5 * dt), 10 * dt); fovBoostVel[0] = 0;
      } else K.fovBoost = sd1(K.fovBoost, bT, fovBoostVel, 0, bT > K.fovBoost ? 0.22 : 0.3, dt);
    }
  }

  // ---------------- Marcador colgado (CAM-19) ----------------
  var BGS = { point: 1, court: 1, clinch: 1, over: 1, cutaway: 1 };
  var BG = { tin: 0.5, tout: 0.5, dp: 0.5, state: '', hx: 2.25, hz0: 9.5, hz1: 12.7, bz: 11.4 };
  BG.dp = 0;
  /** Caja del marcador en "espacio tan" de la cámara (u = x/(z·aspecto), v = y/z): BG.tin = tan(fov/2) mínima para que entre entera,
   *  BG.tout = la máxima con la que queda fuera (por arriba con 2° de margen). -1 = imposible. */
  /* Cajas que nunca se dejan a medias: el marcador colgado (todas las tomas de BGS) y, en el plano final ('over'), las dos pantallas
   * LED de los fondos (14,6 x 5,9 m a 7,8-13,7 m de alto en x = ±29,9): la órbita lenta del final las dejaba cortadas por un borde
   * (arriba a la derecha a 1920x1080; por la derecha a 1280x720 hacia los 7 s). [x, y, z0, z1, medio ancho x, medio ancho y] */
  var BGB = [[0, 0, 9.5, 12.7, 2.25, 2.25], [29.87, 0, 7.8, 13.7, 0.3, 7.3], [-29.87, 0, 7.8, 13.7, 0.3, 7.3]], BGN = 1, BGO = { tin: 0, tout: 0 };
  function boardBoxes() {
    var LM = VB.Arena && VB.Arena.landmarks, h = LM && LM.scoreHung, sp = LM && LM.screenPos, sn = LM && LM.screenNeg, B = BGB[0];
    B[0] = h ? h.x : 0; B[1] = h ? h.y : 0; var oz = h ? h.z : 11.4; B[2] = oz - (BG.bz - BG.hz0); B[3] = oz + (BG.hz1 - BG.bz);
    if (sp) { BGB[1][0] = sp.x + 0.25; BGB[1][1] = sp.y; BGB[1][2] = sp.z - 2.95; BGB[1][3] = sp.z + 2.95; }
    if (sn) { BGB[2][0] = sn.x - 0.25; BGB[2][1] = sn.y; BGB[2][2] = sn.z - 2.95; BGB[2][3] = sn.z + 2.95; }
    BGN = 1;
  }
  /** tan(fov/2) con la que la caja i entra entera (BGO.tin; -1 si una esquina queda detrás) o queda fuera (BGO.tout; por arriba con 2° de
   *  aire; 9 si está toda detrás). Tiene en cuenta el desplazamiento de imagen (filmOffset, panel final acoplado). */
  function boxTan(i, cx, cy, cz, yaw, pitch) {
    var asp = aspect(), cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var fx = cp * cyw, fy = cp * syw, fz = sp, rx = syw, ry = -cyw, ux = -sp * cyw, uy = -sp * syw, uz = cp;
    var B = BGB[i], su = (cam ? cam.filmOffset : 0) / (35 * asp);
    var u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, tin = 0, behind = 0, front = 0;
    for (var k = 0; k < 8; k++) {
      var px = B[0] + ((k & 1) ? B[4] : -B[4]), py = B[1] + ((k & 2) ? B[5] : -B[5]), pz = (k & 4) ? B[3] : B[2];
      var dx = px - cx, dy = py - cy, dz = pz - cz, zc = dx * fx + dy * fy + dz * fz;
      if (zc < 0.2) { behind++; continue; }
      front++;
      var u = (dx * rx + dy * ry) / zc / asp - su, v = (dx * ux + dy * uy + dz * uz) / zc;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      tin = mx(tin, mx(Math.abs(u), Math.abs(v)));
    }
    BGO.tin = behind ? -1 : tin;
    var tout = -1;
    if (front === 0) tout = 9;
    else {
      if (v0 > 0) tout = mx(tout, Math.tan(Math.atan(v0) - 2 * DEG));
      if (u0 > 0) tout = mx(tout, u0);
      if (u1 < 0) tout = mx(tout, -u1);
      if (v1 < 0) tout = mx(tout, -v1);
    }
    BGO.tout = tout;
  }
  /** (compatibilidad) el marcador colgado: deja BG.tin / BG.tout. */
  function boardTan(cx, cy, cz, yaw, pitch) { boxTan(0, cx, cy, cz, yaw, pitch); BG.tin = BGO.tin; BG.tout = BGO.tout; }
  var BGT = [0, 0, 0, 0, 0, 0], BGM = 0, BGX = false;   // tin/tout por caja; margen (plano final: 1,5 %, ni rozando el borde)
  function boardOk(t) {
    for (var i = 0; i < BGN; i++) { var ti = BGT[2 * i], to = BGT[2 * i + 1]; if (!(to >= t * (1 + BGM) || (!BGX && ti >= 0 && ti * (1 + BGM) <= t))) return false; }
    return true;
  }
  function boardMeasure(cx, cy, cz, yaw, pitch) {
    for (var i = 0; i < BGN; i++) { boxTan(i, cx, cy, cz, yaw, pitch); BGT[2 * i] = BGO.tin; BGT[2 * i + 1] = BGO.tout; if (i === 0) { BG.tin = BGO.tin; BG.tout = BGO.tout; } }
  }
  /** Devuelve la lente corregida (grados) y en BG.dp el cabeceo extra hacia abajo (rad) si hace falta. Con varias cajas, el cambio de
   *  lente más pequeño (cerrar hasta -30 % o abrir hasta +25 %) que deja cada una entera o fuera; si ninguno vale, se cierra al 70 % y se
   *  baja la mira lo justo. */
  function boardGuard(cx, cy, cz, yaw, pitch, lens) {
    BG.dp = 0;
    boardBoxes();
    boardMeasure(cx, cy, cz, yaw, pitch);
    var t = Math.tan(lens * DEG / 2);
    if (boardOk(t)) { BG.state = BG.tout >= t ? 'fuera' : 'dentro'; return lens; }
    var lo = 0.7, hi = 1.25, bestT = -1, bestC = 1e9;
    for (var i = 0; i < BGN; i++) {
      var to = BGT[2 * i + 1] * 0.995, ti = BGT[2 * i] * 1.005;
      if (to > 0 && to >= t * lo && to < t && boardOk(to) && Math.log(t / to) < bestC) { bestC = Math.log(t / to); bestT = to; }
      if (ti > t && ti <= t * hi && ti < 1.2 && boardOk(ti) && Math.log(ti / t) < bestC) { bestC = Math.log(ti / t); bestT = ti; }
    }
    if (bestT > 0) { BG.state = bestT < t ? 'cierra' : 'abre'; return 2 * Math.atan(bestT) / DEG; }
    // nada de eso: cerrar al 70 % y bajar la mira lo que falte para que el borde de abajo de las cajas quede 2° por encima
    var t2 = t * 0.7, dp = 0;
    for (var it = 0; it < 30; it++) {
      dp += DEG; boardMeasure(cx, cy, cz, yaw, pitch - dp);
      if (boardOk(t2)) break;
    }
    BG.dp = dp; BG.state = 'baja';
    return 2 * Math.atan(t2) / DEG;
  }

  // ---------------- Aplicar a la cámara de Three.js ----------------
  var OFC = { fail: false, x: 0, y: 0, z: 0, w: 0, p: 0, t: 1, okW: 1, okY: 0 };   // (caché de la red de seguridad de oficiales del saque)
  function apply(g) {
    var dt = K.dt;
    // límites físicos: dentro del pabellón, sin atravesar la red ni las gradas
    var lowArea = P.z < 5.5;
    if (lowArea) { P.x = mn(mx(P.x, -15), 15); P.y = mn(mx(P.y, -9.7), 9.7); }
    if (P.z < 0.7) P.z = 0.7;
    if (Math.abs(P.x) < 0.9 && Math.abs(P.y) < 6 && P.z < 2.95) P.z = 2.95;

    var dx = L.x - P.x, dy = L.y - P.y, dz = L.z - P.z, hd = hyp(dx, dy) || 1e-4;
    var yaw0 = at2(dy, dx), pitch0 = at2(dz, hd), fbu = -1;
    K.yaw0 = yaw0; K.pitch0 = pitch0;
    if (FB.on) {
      // transición fija al saque: giro, cabeceo y FOV en la MISMA curva que la posición (sin encuadre fino por el camino)
      fbu = fbCurve(K.fbT / K.fbDur);
      K.fovCur = K.fbFov0 + (K.fbFov1 - K.fbFov0) * fbu;
    } else {
      framing(g);
      // FOV (con aspecto, ayuda de encuadre y el "kick" lento heredado)
      var fv = K.fovWant + K.fovBoost - K.kick;
      if (dt > 0) {
        var fPrev = K.fovCur;
        K.fovCur = shot === 'intro' ? fv : sd1(K.fovCur, fv, fovVel, 0, shot === 'menu' ? (fv > K.fovCur ? 0.16 : 0.6) : K.fovBoost > 2 && fv > K.fovCur ? 0.2 : 0.35, dt); K.kick = mx(0, K.kick - dt * 14);
        // PANTALLA PEQUEÑA (CAM-11): en el peloteo la lente cambia a ritmo limitado pase lo que pase (cambio de plano, ayuda de FOV,
        // seguimiento del remate, defensa): abre a <= 10°/s y cierra a <= 1,8°/s. En un móvil, el bombeo de la lente marea más que nada.
        // (momento de red / defensa que se acerca en escritorio, CAM-13/17: la lente cambia a <= 10°/s)
        if (!(touchUI() || ctx.isMobile) && SHOTS[shot] && SHOTS[shot].wide && (K.blkU > 0.001 || K.defU > 0.001)) { K.fovCur = mn(mx(K.fovCur, fPrev - 10 * dt), fPrev + 10 * dt); if ((K.fovCur - fPrev) * fovVel[0] < 0) fovVel[0] = 0; }
        if ((touchUI() || ctx.isMobile) && SHOTS[shot] && SHOTS[shot].wide) {
          // (salvo con el balón ya cerca del borde de arriba, p. ej. tras el saque propio, que encuadra con 35-45°: ahí abre a 12°/s)
          var upR = dbg.ballVisible && dbg.ballNdcY > 0.62 ? 11.5 : 10;   // (12, no 16: el p95 de CAM-11 pide <= 12°/s también con el PC cargado)
          // (y sin límite los primeros 0,5 s al entrar desde un plano de saque: la lente venía de 42-46°)
          if (K.wideT < 0.6) upR = mx(upR, 11);
          K.fovCur = mn(mx(K.fovCur, fPrev - 1.4 * dt), fPrev + upR * dt); if ((K.fovCur - fPrev) * fovVel[0] < 0) fovVel[0] = 0;
        }
      }
      else K.fovCur = fv;
    }
    // PUNCH de FOV del impacto: impulso (entra entero en 1 frame) que vuelve con un muelle críticamente amortiguado
    // (~150 ms; < 10 % a los 200 ms). Va directo a la lente, sin pasar por el suavizado del FOV.
    var punch = 0;
    if (K.punchA > 0) {
      var pt = K.punchT / 0.045;
      punch = K.punchA * (1 + pt) * Math.exp(-pt);
      if (dt > 0) K.punchT += dt;
      if (K.punchT > 0.45) { K.punchA = 0; punch = 0; }
    }
    dbg.punch = punch;
    // desplazamiento de imagen en el menú (la pista a la derecha del panel)
    var filmWant = 0;
    if (ctx.state === 'menu' && ctx.width > 760) {
      var th = Math.tan(K.fovCur * DEG / 2);
      filmWant = -2 * 0.13 * th * aspect() * 35;
    } else if (shot === 'over' && ctx.state === 'over') {
      // (CAM-10) centro de la imagen -> centro de la parte libre: desplazamiento de frac NDC hacia el lado libre
      var df = dockFrac();
      if (df > 0) filmWant = -dockSign() * df * Math.tan(K.fovCur * DEG / 2) * aspect() * 35;
    }
    K.film = dt > 0 ? sd1(K.film, filmWant, filmVel, 0, 0.5, dt) : filmWant;
    var lens = K.fovCur - punch;
    if (Math.abs(cam.fov - lens) > 0.01 || Math.abs(cam.filmOffset - K.film) > 0.005) {
      cam.fov = lens; cam.filmOffset = K.film; cam.updateProjectionMatrix();
    }

    var yaw = yaw0 + K.exYaw, pitch = pitch0 + K.exPitch;
    if (fbu >= 0) {
      yaw = K.fbYaw0 + wrap(K.fbYaw1 - K.fbYaw0) * fbu; pitch = K.fbPitch0 + (K.fbPitch1 - K.fbPitch0) * fbu;
      K.outYaw = yaw; K.outPitch = pitch; K.lagPitch = 0; outInit = true;
    } else
    // límite de velocidad angular en TODOS los planos: juego (cabeceo 40°/s, giro 70°/s; saque rival 50°/s),
    // punto/fin 60°/s, menú 25°/s; confort: 30°/s (menú 20). Ninguna transición "barre" el suelo ni hace un
    // latigazo. El FOV de ayuda del encuadre compensa el retraso (K.lagPitch). Un corte de plano (point) reinicia.
    if (dt > 0 && outInit) {
      var calm = comfort(), lp = 40, ly = 70;
      if (shot === 'serveThem') ly = 50;
      else if (shot === 'serveUs' && K.blendT > 0) ly = 55;   // vuelta deslizada desde el plano del punto
      else if (shot === 'point' || shot === 'over' || shot === 'court' || shot === 'review') lp = ly = 60;
      else if (shot === 'clinch') lp = ly = CL.phase === 'track' ? 80 : 60;
      else if (shot === 'cutaway' || shot === 'intro') lp = ly = 60;
      else if (shot === 'menu' || shot === '') lp = ly = 25;
      if (calm) { lp = mn(lp, 30); ly = mn(ly, shot === 'menu' ? 20 : 30); }
      // (seguimiento del remate: el giro hacia el bote cabe en sus 0,25 s; ~20° en 0,25 s piden ~120°/s de pico)
      var ftFast = K.ftW > 0.01 && FT.on && ctx.game && ctx.game.ball.x < (FT.wait > 0 ? -0.5 : -0.15);   // (rápido solo con el balón ya al otro lado del bloqueo)
      if (ftFast) { lp = mx(lp, calm ? 45 : 110); ly = mx(ly, calm ? 60 : 140); }   // (con bloqueo posible, rápido solo cuando el balón ya lo ha pasado)
      // al ARRANCAR un plano (las transiciones), el límite sube suave desde la mitad: sin tirón inicial
      var ramp = K.blendT > 0 && K.blendDur > 0 ? 0.5 + 0.5 * smooth01(1 - K.blendT / K.blendDur + 0.35) : 1;
      var rp = lp * ramp * DEG * dt, ry = ly * ramp * DEG * dt;
      if (BRK === 'block' && K.blkU > 0.3 && GAMEPLAY[shot]) { yaw += 0.09 * Math.sin(K.timeAcc * 38); K.outPitch = pitch; K.outYaw = yaw; }
      else if (shot === 'menu' || ((K.blkU > 0.01 || (FT.on && K.ftW > 0.01)) && GAMEPLAY[shot] && !ftFast)) {
        if (shot !== 'menu') { lp = lp; }
        // (menú, CAM-16 / momento de red, CAM-17: límite del giro COMBINADO —giro y cabeceo a la vez— de 25°/s; 20 en confort)
        var ddp = pitch - K.outPitch, ddy = wrap(yaw - K.outYaw), mag = hyp(ddp, ddy), lim = (shot === 'menu' ? (calm ? 19 : 24) : (calm ? 29 : 38.5)) * ramp * DEG * dt;   // (margen: 25 y 40°/s medidos)
        if (mag > lim) { ddp *= lim / mag; ddy *= lim / mag; }
        K.outPitch += ddp; K.outYaw = wrap(K.outYaw + ddy);
      } else {
      K.outPitch += mn(mx(pitch - K.outPitch, -rp), rp);
      K.outYaw = wrap(K.outYaw + mn(mx(wrap(yaw - K.outYaw), -ry), ry));
      }
      K.lagPitch = pitch - K.outPitch;
      pitch = K.outPitch; yaw = K.outYaw;
    } else { K.outPitch = pitch; K.outYaw = yaw; outInit = true; K.lagPitch = 0; }
    // temblor: ruido suave (suma de senos), decae al cuadrado
    var ox = 0, oy = 0, oz = 0, roll = 0;
    if (K.shakeT > 0) {
      if (dt > 0) K.shakeT = mx(0, K.shakeT - dt);
      var k = K.shakeA * Math.pow(K.shakeT / K.shakeDur, 2) * (stableNow ? 0 : comfort() ? 0.3 : 1) * (shot === 'tp' || shot === 'tpPoint' ? 0.4 : 1), t = K.timeAcc;   // (3ª persona del 6v6: cámara cerca del jugador, temblor a 0,4)
      ox = k * (Math.sin(t * 47.0) * 0.6 + Math.sin(t * 83.0 + 1.3) * 0.4);
      oy = k * (Math.sin(t * 53.0 + 2.1) * 0.6 + Math.sin(t * 71.0 + 0.4) * 0.4);
      oz = k * (Math.sin(t * 61.0 + 4.2) * 0.6 + Math.sin(t * 97.0 + 2.7) * 0.4);
      roll = K.shakeRoll * k * Math.sin(t * 39.0 + 0.8);
      if (K.shakeT <= 0) K.shakeA = 0;
    }
    dbg.shake = hyp3(ox, oy, oz);
    // (VB.toThree en línea: sim (x, y, z) -> three (x, z, -y); llamarla con 3 dobles los metía en caja)
    // límite duro también con el temblor (la cámara nunca sale del pabellón, a ninguna altura)
    var fx0 = P.x + ox, fy0 = P.y + oy, fz0 = P.z + oz, byl = shot === 'court' ? K.bYc : K.bY;
    fx0 = mn(mx(fx0, -K.bX), K.bX); fy0 = mn(mx(fy0, -byl), byl); fz0 = mn(fz0, K.bZ);
    var cp = Math.cos(pitch);
    cam.position.set(fx0, fz0, -fy0);
    tgt3.set(fx0 + Math.cos(yaw) * cp * 10, fz0 + Math.sin(pitch) * 10, -(fy0 + Math.sin(yaw) * cp * 10));
    cam.up.set(0, 1, 0);
    cam.lookAt(tgt3);
    if (roll !== 0) cam.rotateZ(roll);
    // MARCADOR COLGADO NUNCA CORTADO (CAM-19): en los planos de reacción, grúa, cierre y final, la caja del marcador (sobre el centro,
    // 9,5-12,7 m) entra entera o queda fuera (por arriba, >= 2° sobre el borde). Se mira con la pose REAL de este frame y, si cruza
    // un borde, se CIERRA la lente lo justo para dejarla fuera (como mucho un 30 %) o se abre para meterla entera (como mucho un 25 %);
    // si nada vale, se baja la mira. Manda sobre la regla de los pies del héroe/víctima (cierra en vez de cabecear).
    if (BRK === 'board' && BGS[shot] && !FB.on) {   // (camBreak: mira 16° más alta y sin la regla: el marcador queda a medias)
      pitch += 16 * DEG; tgt3.set(fx0 + Math.cos(yaw) * Math.cos(pitch) * 10, fz0 + Math.sin(pitch) * 10, -(fy0 + Math.sin(yaw) * Math.cos(pitch) * 10)); cam.lookAt(tgt3);
    } else if (shot === 'over' && !FB.on) {
      // PLANO FINAL: el marcador colgado y las dos pantallas LED de los fondos nunca a medias. La lente no se toca (cerrarla dejaba a un
      // ganador enorme y cortado y saltaba de un frame a otro) y no se busca "entera": con la órbita, una caja que está dentro acaba
      // cruzando un borde y solo se evita con un salto. Así que quedan SIEMPRE FUERA POR ARRIBA (>= 2° sobre el borde): se baja la mira
      // lo justo (hasta 16°), con un desvío propio y continuo que sube al instante y vuelve despacio (5°/s) solo mientras la vuelta no
      // deje nada a medias. No se acumula en el cabeceo de salida.
      boardBoxes(); BGN = 3; BGM = 0.015; BGX = true;
      var tB = Math.tan(cam.fov * DEG / 2), cur = mx(0, K.bgP), rate = dt > 0 ? dt * 5 * DEG : 0, STEP = 0.25 * DEG, DN = 16 * DEG;
      var dec = mx(0, cur - rate), want = -1;
      boardMeasure(fx0, fy0, fz0, yaw, pitch - dec);
      if (boardOk(tB)) want = dec;
      else for (var dq = 1; dq <= 64 && want < 0; dq++) { var dd = dec + dq * STEP; if (dd > DN) break; boardMeasure(fx0, fy0, fz0, yaw, pitch - dd); if (boardOk(tB)) want = dd; }
      if (want < 0) want = mx(dec, mn(DN, cur));
      K.bgP = want; BGN = 1; BGM = 0; BGX = false; dbg.bgP = +(want / DEG).toFixed(2);
      BG.state = want > 0.0001 ? 'baja' : 'fuera';
      if (want > 0.0001) { pitch -= want; tgt3.set(fx0 + Math.cos(yaw) * Math.cos(pitch) * 10, fz0 + Math.sin(pitch) * 10, -(fy0 + Math.sin(yaw) * Math.cos(pitch) * 10)); cam.lookAt(tgt3); if (roll !== 0) cam.rotateZ(roll); }
    } else if (BGS[shot] && !FB.on) {
      var lensB = boardGuard(fx0, fy0, fz0, yaw, pitch, lens);
      if (lensB !== lens || BG.dp !== 0) {
        if (BG.dp !== 0) { pitch -= BG.dp; tgt3.set(fx0 + Math.cos(yaw) * Math.cos(pitch) * 10, fz0 + Math.sin(pitch) * 10, -(fy0 + Math.sin(yaw) * Math.cos(pitch) * 10)); cam.lookAt(tgt3); if (roll !== 0) cam.rotateZ(roll); K.outPitch -= BG.dp; }
        cam.fov = lensB; cam.updateProjectionMatrix();
      }
    }
    dbg.board = BG.state;
    // OFICIALES NUNCA CORTADOS en el saque propio (CAM-15, red de seguridad sobre la pose REAL: la grúa del salto y el sacador que se
    // mueve cambian el encuadre): si un oficial cruza un borde, la lente busca el cambio más pequeño (cerrar o abrir hasta un 16 %) que
    // lo deje entero o fuera (cambio pequeño y continuo: se aplica directo). Los sitios de los oficiales se releen cada 8 frames (el 2º árbitro se mueve).
    var ofW = 1, ofY = 0;
    if (shot === 'serveUs' && !FB.on) {
      if ((ctx.frame | 0) % 8 === 0) readOfficials();
      var s0x = SVC.cx, s0y = SVC.cy, s0z = SVC.cz, s0w = SVC.yaw, s0p = SVC.p, s0t = SVC.t, tl = Math.tan(cam.fov * DEG / 2);
      SVC.cx = fx0; SVC.cy = fy0; SVC.cz = fz0; SVC.yaw = yaw; SVC.p = pitch; SVC.t = tl;
      // (UI-13: si la búsqueda ya falló con esta misma pose —quieta en la espera del saque—, no se repite: eran ~640 proyecciones
      // por frame, 10-15 ms en el móvil. Y la solución del frame anterior se prueba primero: suele seguir valiendo)
      var ofFail = OFC.fail && Math.abs(fx0 - OFC.x) < 0.05 && Math.abs(fy0 - OFC.y) < 0.05 && Math.abs(fz0 - OFC.z) < 0.05 &&
                   Math.abs(wrap(yaw - OFC.w)) < 0.3 * DEG && Math.abs(pitch - OFC.p) < 0.3 * DEG && Math.abs(tl / OFC.t - 1) < 0.005;
      if (!ofFail && offStraddle() > 0) {
        ofW = 1;
        var found = false;
        // (primero la solución del frame anterior —lente y giro—: sin parpadeo entre soluciones parecidas)
        if (OFC.okW !== 1 || OFC.okY !== 0) { SVC.yaw = yaw + OFC.okY; SVC.t = tl * OFC.okW; if (offStraddle() === 0) { ofW = OFC.okW; ofY = OFC.okY; found = true; } SVC.yaw = yaw; }
        // (si el frame anterior ya falló —la cámara se está moviendo hacia el saque—, búsqueda corta: toda la lente y el giro solo con
        // cambios de lente de hasta un 3 %; ~120 proyecciones como mucho en vez de ~640)
        var oyMaxQ = OFC.fail ? 3 : 24;
        // (pantalla baja: giro de hasta 10°: con el encuadre del móvil el juez de línea cercano queda justo fuera y la grúa del saque en
        // salto, al abrir la lente para el balón, lo metía un 25-30 % por la esquina; un giro corto hacia la pista lo saca)
        var ofLow = touchUI() || !!ctx.isTouch || !!ctx.isMobile || (ctx.height || 720) < 480, oyMaxD = ofLow ? 10 : 6, oqMax = ofLow ? 32 : 24;
        for (var oq = 1; oq <= oqMax && !found; oq++) {
          var fk1 = 1 - 0.01 * oq, fk2 = 1 + 0.01 * oq;
          SVC.t = tl * fk1; if (offStraddle() === 0) { ofW = fk1; found = true; break; }
          SVC.t = tl * fk2; if (offStraddle() === 0) { ofW = fk2; found = true; break; }
          // (y un giro pequeño, hasta 4°, con el mismo cambio de lente)
          if (oq <= oyMaxQ) for (var oy2 = 1; oy2 <= oyMaxD && !found; oy2++) for (var sg = -1; sg <= 1; sg += 2) {
            SVC.yaw = yaw + sg * oy2 * DEG; SVC.t = tl * fk1; if (offStraddle() === 0) { ofW = fk1; ofY = sg * oy2 * DEG; found = true; break; }
            SVC.t = tl; if (offStraddle() === 0) { ofW = 1; ofY = sg * oy2 * DEG; found = true; break; }
          }
          SVC.yaw = yaw;
        }
        OFC.fail = !found; OFC.x = fx0; OFC.y = fy0; OFC.z = fz0; OFC.w = yaw; OFC.p = pitch; OFC.t = tl;
      } else if (!ofFail) OFC.fail = false;
      OFC.okW = ofW; OFC.okY = ofY;
      SVC.cx = s0x; SVC.cy = s0y; SVC.cz = s0z; SVC.yaw = s0w; SVC.p = s0p; SVC.t = s0t;
    } else { OFC.fail = false; OFC.okW = 1; OFC.okY = 0; }
    K.ofK = ofW;
    if (Math.abs(ofW - 1) > 0.001) { cam.fov = 2 * Math.atan(Math.tan(cam.fov * DEG / 2) * ofW) / DEG; cam.updateProjectionMatrix(); }
    // (el giro se aplica SOLO a este frame, encima del giro de salida: antes se sumaba también a K.outYaw y, con un oficial cortado varios
    // frames seguidos —la grúa del saque en salto—, se acumulaba: la cámara acababa mirando a la grada con el balón fuera de cuadro)
    if (ofY !== 0) { yaw += ofY; tgt3.set(fx0 + Math.cos(yaw) * Math.cos(pitch) * 10, fz0 + Math.sin(pitch) * 10, -(fy0 + Math.sin(yaw) * Math.cos(pitch) * 10)); cam.lookAt(tgt3); }
    // BALÓN GRANDE ASOMANDO POR UN BORDE en el plano de reacción (CAM-18, red de seguridad de lo que el plan no previó: un rebote raro):
    // si mide > 3,8 % del alto y su disco toca la franja del 15 % del borde sin salir, la lente se cierra (hasta un 20 %, entra en
    // ~0,08 s, sale en ~0,5 s) para sacarlo. Si haría falta más, se deja (está ya casi dentro y es parte del plano).
    var pbW = 0;
    if (shot === 'point' && PF.cutDone && g && g.ball && !FB.on && BRK !== 'clutter') {
      var bb = g.ball, dxb = bb.x - fx0, dyb = bb.y - fy0, dzb = bb.z - fz0, cpb = Math.cos(pitch), spb = Math.sin(pitch), cyb = Math.cos(yaw), syb = Math.sin(yaw);
      var zcb = dxb * cpb * cyb + dyb * cpb * syb + dzb * spb, tb = Math.tan(cam.fov * DEG / 2);
      if (zcb > 0.4) {
        var Rb = (VB.C && VB.C.BR) || 0.21, dia = 2 * Rb / (zcb * 2 * tb);
        var nxb = Math.abs((dxb * syb - dyb * cyb) / (zcb * tb * aspect())), nyb = Math.abs((-dxb * spb * cyb - dyb * spb * syb + dzb * cpb) / (zcb * tb));
        var nb = mx(nxb, nyb), rb = nxb >= nyb ? dia / aspect() : dia;
        // (en el frame del corte cabe más: un cambio de lente no se nota en un corte)
        if (dia > 0.038 && nb + rb > 0.7 && nb - rb < 1.02) { var need = (nb - rb) / 1.02; if (need > (CUT.frame || K.pbNar > 0.15 ? 0.66 : 0.8)) pbW = 1 - need; }
      }
    }
    if (dt > 0 && !CUT.frame) K.pbNar += (pbW - K.pbNar) * mn(1, dt / (pbW > K.pbNar ? 0.08 : 0.5)); else K.pbNar = pbW;   // (en el frame del corte, ya puesta)
    dbg.pbNar = K.pbNar; dbg.pbW = pbW; dbg.pbD = [shot, PF.cutDone ? 1 : 0, FB.on ? 1 : 0, typeof zcb === "number" ? +zcb.toFixed(2) : -1, typeof dia === "number" ? +dia.toFixed(3) : -1, typeof nb === "number" ? +nb.toFixed(2) : -1];
    if (K.pbNar > 0.002) { cam.fov = 2 * Math.atan(Math.tan(cam.fov * DEG / 2) * (1 - K.pbNar)) / DEG; cam.updateProjectionMatrix(); }

    // base de control: solo en planos de juego, limitada a ±26° de "hacia la red"
    if ((GAMEPLAY[shot] || shot === 'tp') && !(K.ftW > 0.01)) {   // (congelada durante el seguimiento del remate, CAM-08; 6v6 en 3ª persona: igual)
      var byw = FB.on ? at2(FB.L1.y - FB.P1.y, FB.L1.x - FB.P1.x) : yaw0;   // (en la transición fija: la del destino)
      K.basisYaw = Math.PI + mn(mx(wrap(byw - Math.PI), -26 * DEG), 26 * DEG);
      basis.fx = Math.cos(K.basisYaw); basis.fy = Math.sin(K.basisYaw);
      basis.rx = basis.fy; basis.ry = -basis.fx;   // derecha de pantalla en el suelo
    } else if (shot === 'tv') { K.basisYaw = Math.PI; basis.fx = -1; basis.fy = 0; basis.rx = 0; basis.ry = 1; }   // (televisión del 6v6: a lo largo de la pista)
    dbg.antX = ant.x; dbg.sx = S.x;
    dbg.ccU = CC.on ? CC.u : -1;
    dbg.x = DBGX;
    FTD.on = FT.on ? 1 : 0; FTD.w = K.ftW; FTD.lx = FT.lx; FTD.ly = FT.ly; dbg.ft = FTD;
    dbg.fovWant = K.fovWant; dbg.fovBoost = K.fovBoost; dbg.tfBack = K.tfBack; dbg.defW = K.defU; dbg.defF = K.defF;
    dbg.menu = shot === 'menu' && MN.k >= 0 ? MN_TYPES[MN.k] : ''; dbg.menuT = MN.t; dbg.blk = K.blkU;
    dbg.mateUp = K.mateUp; dbg.shot = shot; dbg.netK = K.netK; dbg.yaw = yaw; dbg.pitch = pitch; dbg.fov = K.fovCur;
  }

  var outInit = false;
  function resetVel() { outInit = false;  PV.x = PV.y = PV.z = LV.x = LV.y = LV.z = 0; exVel[0] = exVel[1] = 0; fovVel[0] = 0; fovBoostVel[0] = 0; filmVel[0] = 0; }

  /* ---------------- ASENTAR (cortes) ----------------
   * Deja el rig EXACTAMENTE en el estado estable del plano actual: todos los suavizados en su objetivo (dt = 0), la
   * cámara en la posición/mira deseadas y el encuadre fino (cabeceo/giro extra, FOV de ayuda) convergido. Se usa en
   * cada corte deliberado: tras el corte la cámara no "se recoloca" (antes derivaba 1-18 m en el primer segundo). */
  var settleSmoothers = false, backPending = false;
  function settle(g, iters) {
    var dt0 = K.dt;
    sw.active = false; K.swFast = 0; K.blendT = 0; FB.on = false;
    K.exPitch = K.exYaw = K.fovBoost = 0; K.kick = 0; K.bHold = 0; K.bHoldT = 0;
    SVC.wantFull = SVC.fullF !== (ctx.frame | 0);   // (saque propio: una pasada completa en la primera vuelta —si este frame no la hizo ya—; el resto la reutiliza)
    for (var i = 0; i < (iters || 24); i++) {
      K.dt = 0;
      if (g.ctrl) { updateAnticipation(g); subject(g); updateLead(g); }
      computeDesired(g);
      P.x = D.x; P.y = D.y; P.z = D.z; L.x = A.x; L.y = A.y; L.z = A.z;
      K.fovCur = K.fovWant + K.fovBoost;
      if (!GAMEPLAY[shot] || !g.ctrl) break;   // (sin encuadre fino fuera de los planos de juego)
      K.dt = 1 / 30; K.yaw0 = at2(L.y - P.y, L.x - P.x); K.pitch0 = at2(L.z - P.z, hyp(L.x - P.x, L.y - P.y));
      framing(g);
    }
    clampInside(P, shot === 'court');
    resetVel();
    K.dt = dt0;
  }
  /** Límite duro: la cámara dentro del pabellón a CUALQUIER altura (zona libre; la grúa del cambio de campo puede ir
   *  algo más afuera en la banda, por encima de las vallas) y por debajo del techo. */
  function clampInside(v, crane) {
    var bx = K.bX, by = crane ? K.bYc : K.bY;
    if (v.x > bx) v.x = bx; else if (v.x < -bx) v.x = -bx;
    if (v.y > by) v.y = by; else if (v.y < -by) v.y = -by;
    if (v.z > K.bZ) v.z = K.bZ;
  }
  function readBounds() {
    var B = VB.Arena && VB.Arena.bounds;
    if (!B || !(B.freeX > 5)) return;
    K.bX = B.freeX - 0.3; K.bY = B.freeY - 0.2; K.bYc = B.freeY + 0.7; K.bZ = (B.hallH || 22) - 3;
  }

  /* ---------------- TRANSICIÓN FIJA AL SAQUE (punto -> saque sin corte) ----------------
   * El encuadre de destino se calcula UNA vez al entrar (asentado, como tras un corte) y la cámara va hacia él con una
   * sola curva (mínimo tirón, sin sobrepaso) en posición, giro, cabeceo y FOV a la vez: sin correcciones de encuadre ni FOV
   * de ayuda por el camino (antes: FOV 32 -> 52,5 -> 42,2 y cabeceo -4,6 -> -26,9 -> -14,7, asentada 0,6-0,9 s DESPUÉS
   * del lanzamiento del rival). Al acabar, el rig sigue desde ese estado exacto. */
  var FB = { on: false, P0: V(), P1: V(), L1: V() };
  // Curva de mínimo tirón (10s³ − 15s⁴ + 6s⁵): monótona y sin sobrepaso, como una críticamente amortiguada, pero con velocidad Y
  // aceleración nulas en los dos extremos (la críticamente amortiguada desde reposo daba el 60 % del recorrido en el primer cuarto:
  // un latigazo de 20 m/s en un movimiento de 4 m). Pico de velocidad = 1,875 × la media.
  function fbCurve(s) { s = mn(mx(s, 0), 1); return s * s * s * (10 + s * (-15 + 6 * s)); }
  var SV0 = V(), SVL = V();
  /** Prepara la transición fija desde el estado actual (si no hay que cortar). Devuelve false si conviene cortar. */
  function startFixedBlend(g, budget) {
    var yaw0 = K.outYaw, pitch0 = K.outPitch, fov0 = K.fovCur;
    SV0.x = P.x; SV0.y = P.y; SV0.z = P.z; SVL.x = L.x; SVL.y = L.y; SVL.z = L.z;
    settle(g);
    var yaw1 = at2(L.y - P.y, L.x - P.x) + K.exYaw, pitch1 = at2(L.z - P.z, hyp(L.x - P.x, L.y - P.y)) + K.exPitch, fov1 = K.fovCur;
    var dist = hyp3(P.x - SV0.x, P.y - SV0.y, P.z - SV0.z), dYaw = Math.abs(wrap(yaw1 - yaw0)), dPitch = Math.abs(pitch1 - pitch0);
    var need = mx(mx(dist / 9, dYaw / (70 * DEG)), mx(dPitch / (50 * DEG), Math.abs(fov1 - fov0) / 16));
    var cut = need > 0.9 || dist > 8 || Math.abs(fov1 - fov0) > 8 || ((SV0.x > 0.8) !== (P.x > 0.8) && Math.abs(SV0.x) > 0.8) || segNearPlayer(g, SV0, P, 1.5);
    if (cut) return false;   // (el rig ya está asentado en el destino: el que llama marca el corte)
    FB.on = true; K.fbT = 0; K.fbDur = mn(mx(need * 1.3, 0.5), budget || 0.8);
    FB.P0.x = SV0.x; FB.P0.y = SV0.y; FB.P0.z = SV0.z;
    FB.P1.x = P.x; FB.P1.y = P.y; FB.P1.z = P.z; FB.L1.x = L.x; FB.L1.y = L.y; FB.L1.z = L.z;
    K.fbYaw0 = yaw0; K.fbPitch0 = pitch0; K.fbFov0 = fov0; K.fbYaw1 = yaw1; K.fbPitch1 = pitch1; K.fbFov1 = fov1;
    K.fbExP = K.exPitch; K.fbExY = K.exYaw; K.fbBoost = K.fovBoost;
    // la cámara vuelve al punto de partida: la transición la lleva desde aquí
    P.x = SV0.x; P.y = SV0.y; P.z = SV0.z; L.x = SVL.x; L.y = SVL.y; L.z = SVL.z; K.fovCur = fov0;
    outInit = true; K.outYaw = yaw0; K.outPitch = pitch0;
    return true;
  }
  /** ¿Pasa el segmento a-b (en planta) a menos de r m de algún jugador? */
  function segNearPlayer(g, a, b, r) {
    var vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
    for (var i = 0; i < g.players.length; i++) {
      var q = g.players[i], t = l2 > 1e-6 ? ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2 : 0;
      t = mn(mx(t, 0), 1);
      if (hyp(a.x + vx * t - q.x, a.y + vy * t - q.y) < r) return true;
    }
    return false;
  }
  /** Cámara del saque que viene (aprox.: sim coloca a los jugadores en sitios fijos en setupServe). */
  var PRED = V();
  function predictServe(g) {
    var us = g.serving === 0, tch = touchUI();
    if (us) {
      var si = g.serverIdx ? g.serverIdx[0] : 0;
      PRED.x = 10.3 + SVBACK() - 0.5; PRED.y = (si ? 1.5 : -1.5) - 1.2; PRED.z = (tch || ctx.isMobile) ? 3.5 : 3.35;   // (CAM-15: serveUsComp)
      return fovFor(40);
    }
    PRED.x = 12.5; PRED.y = 0; PRED.z = ctx.isMobile ? SHOTS.serveThem.hMob : SHOTS.serveThem.h;
    return fovFor(SHOTS.serveThem.fov);
  }
  /** Decide (durante el punto) si la vuelta al saque será un corte. Se fija 0,4 s antes para que nextCutIn no mienta. */
  function decideBack(g, tLeft) {
    if (PF.backLock) return;
    var fv = predictServe(g), dist = hyp3(P.x - PRED.x, P.y - PRED.y, P.z - PRED.z);
    PF.backCut = cutawayNext(g) || PF.cut || dist > 7 || Math.abs(K.fovCur - fv) > 7 || ((P.x > 0.8) !== (PRED.x > 0.8) && Math.abs(P.x) > 0.8) || segNearPlayer(g, P, PRED, 1.6) || P.z < 2.4;
    if (tLeft < 0.4) PF.backLock = true;
  }
  /** Segundos REALES que tardará en pasar `gs` de tiempo de juego (hit-stop y cámara lenta en curso). */
  function gameToReal(gs) {
    var real = K.hsT, rem = gs;
    if (K.hsE > 0) { var ge = K.hsE * 0.62; if (rem <= ge) return real + rem / 0.62; rem -= ge; real += K.hsE; }
    if (slow.t > 0) {
      var full = mx(0, slow.t - slow.out), g1 = full * slow.scale;
      if (rem <= g1) return real + rem / mx(0.05, slow.scale);
      rem -= g1; real += full;
      var avg = (1 + slow.scale) / 2, g2 = slow.out * avg;
      if (rem <= g2) return real + rem / avg;
      rem -= g2; real += slow.out;
    }
    return real + rem;
  }
  /** s reales hasta el próximo corte deliberado programado (-1 = ninguno). */
  function nextCutIn(g) {
    if (CUT.frame) return 0;
    if (shot === 'cutaway' && CW.on) return mx(0, CW.dur - CW.t);
    if (shot === 'intro' && INTRO.on) return -1;   // (CAM-16: acaba en el encuadre del saque, sin corte; saltarla corta sin aviso)
    if (shot === 'clinch' && CL.on && g && !ctx.frozen) {
      if (CL.phase === 'track') { var sn = CL.match ? 0.75 : 0.4; return CL.landed ? mx(0, sn - CL.sinceLand) : gameToReal(mx(0, CL.tLand - CL.tg)) + sn; }
      if (CL.phase === 'hold') return mx(0, 0.45 - CL.t);
      if (CL.phase === 'hero' && !CL.match) return CL.heroDur < 50 ? mx(0, CL.heroDur - CL.t) : (typeof g.timer === 'number' && g.mode === 'point' ? gameToReal(mx(0, g.timer)) + mn(0.05, K.dt || 0.016) : -1);
      return -1;
    }
    if (shot === 'tpPoint' && g && g.mode === 'point' && !ctx.frozen) {   // (6v6 en 3ª persona: corte al plano de reacción y vuelta al saque)
      if (!TPP.cutDone && TPP.willCut) return mx(0, TPP.hold - TPP.t);   // (sin corte de reacción: el próximo es el de vuelta al saque, con cortinilla)
      if (CC.on) return mx(0, CC.start - CC.t);
      if (!g.pendingSet && typeof g.timer === 'number') return g.timer > 0 ? gameToReal(g.timer) + mn(0.05, K.dt || 0.016) : 0;
      return -1;
    }
    if (shot !== 'point' || !g || g.mode !== 'point' || ctx.frozen) return -1;
    var best = -1;
    if (!PF.cutDone && PF.cut) best = mx(0, PF.hold - K.pointT);
    if (CC.on) { var tc = mx(0, CC.start - CC.t); if (best < 0 || tc < best) best = tc; return best; }
    if (!g.pendingSet && typeof g.timer === 'number') {
      // (+1 frame: sim cambia de modo en el primer paso que agota el temporizador, y la cámara lo ve en ese frame)
      var ts = g.timer > 0 ? gameToReal(g.timer) + mn(0.05, K.dt || 0.016) : 0;
      decideBack(g, ts);
      if (PF.backCut && (best < 0 || ts < best)) best = ts;
    }
    return best;
  }

  VB.CameraRig = {
    init: function (c) {
      ctx = c; THREE = c.THREE; cam = c.camera; tgt3 = new THREE.Vector3();
      cam.near = 0.12; cam.far = 220; cam.fov = K.fovCur; cam.updateProjectionMatrix();
      try { reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { }
      readComfort(); readBounds();
    },
    onGameStart: function (g) {
      slow.t = 0; if (ctx) ctx.timeScale = 1; readBounds();
      sw.active = false; K.shakeT = 0; K.shakeA = 0; K.kick = 0; ant.x = ant.y = antV.x = antV.y = 0; CC.on = false; CC.cut = false; RV.cutIn = RV.cutOut = false;
      K.hsT = 0; K.hsE = 0; K.punchA = 0; FB.on = false; HS.on = false; FT.on = false; K.ftU = 0; K.ftW = 0; CL.on = false; CL.phase = ''; CL.cutNow = false; CL.abortCut = false; CW.on = false; CW.cutIn = false; CW.cutOut = false; INTRO.on = false; INTRO.cut = false; backPending = false; cutCheck = false; settleSmoothers = false; spikeTeam = -1; pointEv = null;
      TPP.cutDone = false; TPP.cutNow = false; TPP.backCut = false; TPP.swCut = false; TPP.hero = null; TP.ph = '';
      if (!g) return;
      // del menú (o de una partida anterior) a un partido nuevo: transición larga y suave
      if (!g.demo && P.z > 0) { shot = ''; return; }
      this.snap(g);
    },
    onState: function (s, prev) {
      if (s === 'menu') { slow.t = 0; K.hsT = 0; K.hsE = 0; ctx.timeScale = 1; MN.k = -1; }
    },
    /** Coloca la cámara de golpe en su sitio (escenas de depuración, menú). */
    snap: function (g) {
      if (!g || !ctx) return;
      readComfort();
      S.x = g.ctrl ? g.ctrl.x : 0; S.y = g.ctrl ? g.ctrl.y : 0; S.z = 0;
      shot = pickShot(g); prevShot = shot; K.blendT = 0; sw.active = false; K.swFast = 0;
      FB.on = false; backPending = false; cutCheck = false; settleSmoothers = false; K.punchA = 0;
      K.dt = 0; SVC.wantFull = true;
      if (g.ctrl) updateAnticipation(g); else ant.x = ant.y = 0;
      if (shot === 'point') { P.x = g.ctrl.x + 5.5; P.y = g.ctrl.y * 0.78; P.z = 3.2; pointHow = ''; pointPlayer = null; onShotChange(g, '', 'point'); K.blendT = 0; PF.cutDone = true; PF.cutNow = false; K.pointT = 1.2 + (PF.cut ? PF.hold : 0); }  // escena congelada: el plano ya asentado
      if (shot === 'over') { P.x = 10; P.y = 0; P.z = 3; onShotChange(g, '', 'over'); K.blendT = 0; }
      if (shot === 'tpPoint') { tpPlan(g); TPP.cutDone = true; TPP.cutNow = false; TPP.willCut = true; TPP.replan = true; }   // (escena congelada: el plano de reacción ya puesto; se rehace en el 1r frame, con el frente de los atletas ya puesto)
      subject(g);
      computeDesired(g);
      P.x = D.x; P.y = D.y; P.z = D.z; L.x = A.x; L.y = A.y; L.z = A.z;
      K.fovCur = K.fovWant; K.exPitch = K.exYaw = K.fovBoost = 0; resetVel();
      // dos pasadas de encuadre para que el balón ya esté colocado
      K.dt = 1 / 30;
      for (var i = 0; i < 30; i++) { K.yaw0 = at2(L.y - P.y, L.x - P.x); K.pitch0 = at2(L.z - P.z, hyp(L.x - P.x, L.y - P.y)); framing(g); }
      K.dt = 0;
      apply(g);
    },
    /** Temblor: amplitud en metros (0,03-0,15) y duración en s. */
    shake: function (amount, dur) {
      amount = +amount || 0; if (amount <= 0) return;
      if (shot === 'review' && comfort()) return;   // (revisión del challenge con Cámara estable: sin sacudidas)
      if (amount >= K.shakeA * Math.pow(K.shakeT / (K.shakeDur || 1), 2)) { K.shakeA = amount; K.shakeDur = mx(0.05, dur || 0.3); K.shakeT = K.shakeDur; K.shakeRoll = 0.35; }
    },
    /** Cámara lenta: escala `scale` durante `realSeconds` reales; vuelve a 1 con suavidad en `easeOut` s (opcional).
     *  `aid` (opcional): la cámara lenta es una AYUDA ANTES DE QUE EL HUMANO GOLPEE (p. ej. la tarjeta guiada de ui.js). Solo
     *  entra si aidOk() lo permite: en Fácil siempre; a partir de Normal, solo si `aid === 'novice'` (el que llama certifica con
     *  el récord que son los primeros partidos del jugador). Devuelve false si no ha entrado. */
    slowmo: function (scale, realSeconds, easeOut, aid) {
      if (aid && !this.aidOk(aid === 'novice')) return false;
      scale = mn(mx(+scale || 1, 0.05), 1);
      if (slow.t > 0 && slow.scale < scale && slow.t > slow.out) return false; // no pisar una más intensa en curso
      slow.scale = scale; slow.total = slow.t = mx(0.01, +realSeconds || 0.5);
      slow.out = easeOut != null ? mn(mx(easeOut, 0), slow.t) : mn(0.4, slow.t * 0.5);
      if (ctx && !(K.hsT > 0)) ctx.timeScale = scale;   // (un hit-stop en curso manda)
      return true;
    },
    /** ¿Puede entrar una ayuda de presentación ANTES del golpe del humano (cámara lenta guiada)? Fácil: sí. Normal o más: solo
     *  si `novice` (primeros partidos del jugador, según el récord de ui.js). Nunca en la demo ni sin partido. Lo que pasa
     *  DESPUÉS del golpe (hit-stop, cámara lenta del punto de set/partido) no pregunta aquí. (11-nov-2026, pedido de Ferran.) */
    aidOk: function (novice) {
      var g = ctx && ctx.game; if (!g || g.demo) return false;
      return g.difficulty === 'easy' || !!novice;
    },
    /** OPCIONAL: punch de FOV (grados) — p. ej. en un remate propio. (Ahora es el impulso de punch(): entra en 1 frame.) */
    kick: function (deg) { this.punch(deg || 2.5); },
    /** OPCIONAL: impulso de FOV del impacto (grados que CIERRA la lente en 1 frame; vuelve en ~150 ms). Nada en confort. */
    punch: function (deg) {
      deg = +deg || 0; if (deg <= 0 || comfort()) return;
      var t = K.punchT / 0.045, left = K.punchA > 0 ? K.punchA * (1 + t) * Math.exp(-t) : 0;
      if (deg >= left) { K.punchA = deg; K.punchT = 0; }
    },
    /** OPCIONAL: HIT-STOP real. El juego se congela (ctx.timeScale = 0) `ms` milisegundos REALES y vuelve de 0,25 a 1
     *  en 80 ms. Sin `ms`, por calidad: perfect 60, good 35, el resto nada. Desactivado en modo confort. */
    hitStop: function (ms, grade) {
      if (ms == null) ms = grade === 'perfect' ? 60 : grade === 'good' ? 35 : 0;
      ms = mn(mx(+ms || 0, 0), 150);
      if (BRK === 'hitstop') ms = 0;
      if (ms <= 0 || comfort()) return;
      K.hsT = mx(K.hsT, ms / 1000); K.hsEDur = 0.08; K.hsE = 0;
      // (tope en frames: la congelación nunca dura más de su nominal + 2 frames pintados, aunque un frame lento del dispositivo
      // descuente poco tiempo —dt recortado— o el reloj se atasque: un tirón no la estira)
      K.hsF = 0; K.hsFMax = Math.ceil(K.hsT * 60) + 2;
      if (ctx) ctx.timeScale = 0;
    },
    /** OPCIONAL (UI-14): plano de presentación bajo la tarjeta del partido durante s segundos reales; playIntro(0) = cortar ya al saque. */
    playIntro: function (s) {
      s = +s || 0; var g = ctx && ctx.game;
      if (s > 0 && g && !g.demo) { INTRO.on = true; INTRO.t = 0; INTRO.dur = mn(mx(s, 0.8), 6); INTRO.plan = true; INTRO.handoff = false; }
      else if (INTRO.on) { INTRO.on = false; INTRO.handoff = false; }   // (el siguiente update elige el saque y corta)
    },
    /** OPCIONAL (UI): s que quedan de la secuencia de cierre de set/partido (0 = no hay). CAM-09. */
    clinchLeft: function () { return clinchLeftS(ctx && ctx.game); },
    /** OPCIONAL (players, acuerdo del plano de héroe): la coreografía que filma el plano de reacción en curso, o null.
     *  {heroId, mateId, team, camX, camY (sitio de la cámara, sim), hx, hy (sitio del héroe), heroYaw (rad, sim: de cara a la
     *  cámara, abierto hacia el compañero), conv (el compañero va a su sitio), mx, my (sitio del compañero; NaN si no va),
     *  mateYaw, t (g.time del plan)}. Solo cambia la cámara si VB.Players.heroShotAware === true. No modificar. */
    heroShot: function () { var g = ctx && ctx.game; return HS.on && g && (g.mode === 'point') && !reviewOn(g) ? HS : null; },
    /** Ejes de la cámara de juego en el plano del suelo (coordenadas de simulación). */
    getBasis: function () { return basis; },
    /** OPCIONAL (depuración / tests): plano actual y datos de encuadre. */
    getDebug: function () { var clH = shot === 'clinch' && CL.phase === 'hero';
      CLD.phase = CL.on ? CL.phase : ''; CLD.left = clinchLeftS(ctx && ctx.game); CLD.team = CL.on ? CL.team : -1; CLD.why = CLW.why; CLD.x = CLX; dbg.clinch = CLD;
      dbg.pf = shot === 'tpPoint' && !TPP.willCut ? TPPF : (shot === 'point' || clH) ? { lx: PF.lx, ly: PF.ly, c0x: PF.c0x, c0y: PF.c0y, R: PF.R, ang: PF.ang, fov: PF.fov, cut: PF.cut, vic: PF.vic && PF.vic.num, hero: PF.hero && PF.hero.num, heroIn: PF.heroIn,
        mode: PF.mode, how: PF.how, both: PF.both, team: PF.w, score: PF.score, backCut: PF.backCut, heroX: clH ? CL.hx : PF.mode === 'hero' ? PF.side * PF.hxo : 0, parts: PF.mode === 'hero' ? JSON.parse(JSON.stringify(HPB)) : null } : null; return dbg; },
    getShot: function () { return shot === 'tpPoint' ? 'point' : shot === 'clinch' ? (CL.phase === 'hero' || CL.phase === 'hold' ? (CL.match ? 'over' : 'point') : 'clinch') : shot; },
    /** OPCIONAL (pruebas): arranca la transición fija al plano actual desde la cámara desplazada (dx, dy, dz) m y con el FOV +dfov°.
     *  Devuelve true si la transición arranca (false = las reglas piden corte). */
    _testFixedBlend: function (dx, dy, dz, dfov) {
      var g = ctx && ctx.game; if (!g || !GAMEPLAY[shot]) return false;
      P.x += +dx || 0; P.y += +dy || 0; P.z += +dz || 0; K.fovCur += +dfov || 0; outInit = false; apply(g);
      return startFixedBlend(g, 0.8);
    },
    /** OPCIONAL (pruebas): fija el ángulo de la órbita del menú. */
    _setOrbit: function (a) { K.orbit = +a || 0; },
    /** OPCIONAL (pruebas, CAM-19): la corrección del marcador para una pose dada (sim; rad; grados) → {lens, dp, state}. */
    _boardGuard: function (cx, cy, cz, yaw, pitch, lens) { var l = boardGuard(cx, cy, cz, yaw, pitch, lens); return { lens: l, dp: BG.dp, state: BG.state, tin: BG.tin, tout: BG.tout }; },
    /** OPCIONAL (pruebas, CAM-15): candidato del saque propio y penalización de oficiales del encuadre deseado. */
    _serveDbg: function () { return { idx: SVC.idx, lat: SVC.lat, sx: SVC.sx, fk: SVC.fk, cam: [SVC.cx, SVC.cy, SVC.cz], yaw: SVC.yaw, p: SVC.p, t: SVC.t, off: offStraddle(), offs: SVCP.map(function (v) { return +v.toFixed(3); }), pens: SVCQ.map(function (v) { return +v.toFixed(2); }) }; },
    resize: function () { },
    setQuality: function () { },
    onSettings: function () { if (ctx) readComfort(); },
    update: function (g, realDt, events) {
      if (!g || !cam) return;
      var dt = mx(0, mn(0.1, realDt || 0));
      K.dt = dt; K.timeAcc += dt; readComfort();
      CUT.frame = false;
      var playing = ctx.state === 'playing' && !g.demo, human = playing && !g.autopilot, calm = comfort();
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.type === 'land') {
          landOk = true; K.landX = e.x; K.landY = e.y; FT.on = false;
          if (CL.on && CL.phase === 'track' && !CL.landed) { CL.landed = true; CL.sinceLand = 0; CL.lx = e.x; CL.ly = e.y; }
          // BOTE DE UN REMATE (o de un balón rápido) DENTRO: el golpe contra el suelo se nota (pequeño, seco)
          // (también tras un bloqueo: remate + bloqueo que cae dentro —un block-out que entra o un bloqueo directo— es punto
          // igual de grande; el del bloqueo directo suena más)
          var blk = g.lastKind === 'block';
          if (e.inside && !g.demo && (g.lastKind === 'spike' || blk || (e.speed || 0) > 13)) {
            this.shake(blk ? 0.045 : 0.035, blk ? 0.2 : 0.18);
            if (human && e.team === 1 && g.lastTeam === 0) rumbleSig('kill', 1);   // punto nuestro
          }
        }
        else if (e.type === 'serveReady' || e.type === 'newMatch' || e.type === 'toss') landOk = false;
        if ((e.type === 'hit' || e.type === 'block') && shot === 'menu') MN.hitT = K.timeAcc;
        if (BRK === 'cut' && e.type === 'toss' && GAMEPLAY[shot]) { P.y += 3; P.z += 1; }   // (camBreak: salto sin corte anotado)
        if (e.type === 'serveReady' && e.team === 1 && shot === 'point' && !g.demo && ctx.state === 'playing' && !ctx.frozen && !CL.on && g.size !== 6) cutawayStart(g);
        if ((e.type === 'hit' || e.type === 'block') && e.player && (e.team === 0 || e.team === 1)) { lastTouch[e.team] = e.player; touchFitPlan(g); if (e.type === 'block' || e.team === 1) FT.on = false;
          if (CL.on && CL.phase === 'track' && !CL.pointed) { clinchEnd(); CL.abortCut = true; slow.t = 0; ctx.timeScale = 1; } }
        else if (e.type === 'serveReady' || e.type === 'newMatch') { lastTouch[0] = null; lastTouch[1] = null; HS.on = false; SVC.idx = -1; K.tfBackT = 0; FT.on = false; K.ftU = 0; }
        if (e.type === 'switch') {
          if (!e.reset && e.from && e.to) {
            // deslizar el sujeto desde donde está ahora hasta el nuevo jugador
            // (incluida la anticipación ya recorrida, que pasa a formar parte del deslizamiento)
            sw.from.x = S.x; sw.from.y = S.y; sw.from.z = S.z; sw.to = e.to; sw.t = 0;
            ant.x = ant.y = antV.x = antV.y = 0;
            var dist = hyp(e.to.x - S.x, e.to.y - S.y);
            sw.dur = mn(mx(0.35 + dist * 0.035, 0.35), 0.6); sw.active = true; sw.back = e.to.x > S.x + 1;
            // cambio al defensor al colocar la CPU (~1,5 s antes del remate): hay tiempo, deslizamiento más largo y suave
            if (e.reason === 'defense') sw.dur = mn(mx(0.55 + dist * 0.04, 0.6), 0.85);
            K.swFast = sw.back ? 0.9 : 0;
          } else sw.active = false;
        } else if (e.type === 'hit' && e.kind === 'spike') {
          // remate: temblor escalado por la potencia (e.power 0..1) y la calidad (perfect > good > poor).
          // La dejada llega como kind 'free' (shot 'tip'): no entra aquí, sin temblor.
          var mine = e.team === 0, pw = hitPower(e), gm = gradeMul(e.grade);
          var amp = (mine ? 0.07 : 0.11) * (0.5 + 0.7 * pw) * gm;
          this.shake(amp, (mine ? 0.22 : 0.26) + 0.08 * pw);
          K.digT = g.time; spikeTeam = e.team; K.spkT = g.time;
          if (mine && e.player && e.player === g.ctrl && !g.demo) ftStart(g, e);   // (seguimiento hasta el bote, CAM-08)
          if (mine && playing && !g.autopilot) {
            // IMPACTO: punch de FOV en 1 frame (perfecto 3°, bueno 1,8°, malo nada) + congelación real del juego
            this.punch(e.grade === 'perfect' ? 3 : e.grade === 'good' ? 1.8 : 0);
            if (e.human) this.hitStop(e.grade === 'perfect' ? 60 : e.grade === 'good' ? 35 : 0, e.grade);
          }
          if (e.human) rumbleSig(e.grade === 'perfect' ? 'perfect' : e.grade === 'good' ? 'good' : 'poor', 0.75 + 0.35 * pw);
        } else if (e.type === 'hit' && e.kind === 'serve' && e.shot === 'jump') {
          // saque en salto: un golpe seco, más suave que un remate
          var pj = hitPower(e);
          if (e.team === 0 && e.player && e.player === g.ctrl && !g.demo && pj > 0.7) ftStart(g, e);
          this.shake((e.team === 0 ? 0.035 : 0.05) * (0.6 + 0.6 * pj) * gradeMul(e.grade), 0.2);
          if (e.human && human) {
            if (e.grade === 'perfect') { this.punch(1.8); this.hitStop(35, 'perfect'); }
            rumbleSig(e.grade === 'perfect' ? 'perfect' : e.grade === 'good' ? 'good' : 'poor', 0.6 + 0.4 * pj);
          }
        } else if (e.type === 'hit' && e.human) {
          // toques del humano: firma de vibración por calidad; defensa perfecta de un remate rival = micro‑congelación
          var sig = e.shot === 'body' ? 'body' : e.grade === 'perfect' ? 'perfect' : (e.grade === 'poor' || e.shot === 'shank') ? 'poor' : 'good';
          rumbleSig(sig, 1);
          if (human && e.kind === 'pass' && e.grade === 'perfect' && spikeTeam === 1 && g.time - K.digT < 1.6) this.hitStop(40, 'perfect');
        } else if (e.type === 'block') {
          K.blkEvT = g.time;
          // bloqueo directo (stuff) pesa; toque de bloqueo / block-out, suave
          var stuff = e.result === 'stuff' || e.result == null;
          this.shake(stuff ? 0.1 : 0.045, stuff ? 0.3 : 0.2);
          if (e.team === 0 && playing) {
            if (stuff) this.punch(2.4);
            if (e.human) {
              if (stuff && !g.autopilot) this.hitStop(70, 'perfect');
              rumbleSig(stuff ? 'block' : 'good', 1);
            }
          }
        } else if (e.type === 'dive') {
          // plancha: golpe sordo contra el suelo (pequeño; más si es el jugador que llevas)
          var meD = e.player && e.player === g.ctrl && !g.autopilot && !g.demo;
          this.shake(meD ? 0.04 : 0.02, 0.2);
          if (meD) rumbleSig('body', 1);
        } else if (e.type === 'net' && !e.tape) {
          this.shake(0.025, 0.18);
        } else if (e.type === 'courtChange' && !g.demo && e.why !== 'swap') { // (playa, cada 7 puntos: sin grúa, el juego sigue enseguida)
          CC.on = true; CC.t = 0; CC.why = e.why || 'set'; CC.u = 0;
          // tiempo REAL que queda de pausa tras el plano de reacción (ver comentario de courtShot)
          if (CC.why === 'eight') { CC.start = 1.25; CC.len = 2.0; } else { CC.start = 1.45; CC.len = 2.4; }
          // la grúa dura lo que dure de verdad la pausa (sim: point.hold, con la cámara lenta del set ya en marcha):
          // acaba ~0,3 s antes del saque, que la recoge deslizando
          if (typeof g.timer === 'number' && g.timer > 0) CC.len = mn(mx(gameToReal(g.timer) - CC.start - 0.3, 1.6), 2.8);
        } else if (e.type === 'point' && !g.demo) {
          SVC.pwN = 0;   // (pasada de antemano del saque propio: de nuevo para este punto)
          pointHow = e.how || ''; pointPlayer = e.player || null; pointEv = e;
          // cierre de set/partido (CAM-09): confirma el seguimiento o, sin él (falta sin bote), arranca con la espera de 0,45 s
          if (CL.on && CL.phase === 'track') { if ((e.setWon || e.matchWon) && e.team === CL.team) { CL.pointed = true; CL.match = !!e.matchWon; if (!CL.landed) { CL.landed = true; CL.sinceLand = 0; } clinchPlanSoon = true; } else clinchEnd(); }
          else if (!CL.on && (e.setWon || e.matchWon) && ctx.state === 'playing' && g.size !== 6) { CL.on = true; CL.phase = 'hold'; CL.t = 0; CL.tg = 0; CL.team = e.team; CL.match = !!e.matchWon; CL.pointed = true; CL.landed = false; CL.cutNow = false; CL.abortCut = false; CL.planned = false; clinchPlanSoon = true; }
          if (e.matchWon) this.slowmo(0.28, 1.9, 0.6);
          else if (e.setWon) this.slowmo(0.5, 0.8, 0.4);
          if (human) rumbleSig(e.team === 0 ? (e.matchWon ? 'match' : 'won') : 'lost', 1);
        }
      }
      // ESCALA DEL TIEMPO: cámara lenta (solo cuenta si el juego corre, vuelta suave a 1) y HIT-STOP (congelación real:
      // timeScale = 0 durante N ms y vuelta de 0,25 a 1 en 80 ms). Gana la más lenta.
      var sScale = 1, hScale = 1, runs = dt > 0 && ctx.state !== 'paused';
      if (slow.t > 0) {
        if (runs) slow.t -= dt;
        if (slow.t <= 0) sScale = 1;
        else if (slow.t < slow.out) sScale = 1 - (1 - slow.scale) * smooth01(slow.t / slow.out);
        else sScale = slow.scale;
      }
      if (K.hsT > 0) {
        hScale = 0;
        if (runs) { K.hsT = mx(0, K.hsT - dt); if (++K.hsF >= K.hsFMax) K.hsT = 0; if (K.hsT <= 0) K.hsE = K.hsEDur; }
      } else if (K.hsE > 0) {
        if (runs) K.hsE = mx(0, K.hsE - dt);
        hScale = 0.25 + 0.75 * smooth01(1 - K.hsE / mx(0.01, K.hsEDur));
      }
      if (slow.t > 0 || K.hsT > 0 || K.hsE > 0 || ctx.timeScale !== 1) ctx.timeScale = mn(sScale, hScale);

      // CIERRE DE SET / PARTIDO (CAM-09): detección y fases (reloj real; el de juego para el bote previsto)
      if (!CL.on && !ctx.frozen && g.size !== 6) clinchDetect(g);   // (6v6: sin plano de cierre hasta el sprint 3)
      if (CL.on && clinchPlanSoon) { clinchPlanSoon = false; clinchPlan(g); }
      if (CL.on) clinchTick(g, runs ? dt : 0);
      if (INTRO.on) { INTRO.t += dt; if (INTRO.t >= INTRO.dur || g.mode !== 'serve' || g.demo) { INTRO.handoff = INTRO.t >= INTRO.dur && g.mode === 'serve' && !g.demo && BRK !== 'intro'; INTRO.on = false; } }
      if (CW.on) { if (runs) CW.t += dt; if (CW.t >= CW.dur || g.mode !== 'serve' || g.serveState === 'toss') CW.on = false; }
      // seguimiento del remate (CAM-08): su reloj va en tiempo de JUEGO (el hit-stop lo congela)
      ftUpdate(g, dt * (ctx.state === 'paused' ? 0 : ctx.timeScale));
      if (K.wideT < 9) K.wideT += dt;
      // cambio de campo: el reloj del plano solo corre con el juego en marcha; acaba al salir del punto
      ccAbort = false;
      if (CC.on) { if (ctx.state !== 'paused') CC.t += dt; if (g.mode !== 'point' || g.demo) { if (!g.demo && CC.u < 0.85) ccAbort = true; CC.on = false; } }
      // plano
      var ns = pickShot(g);
      if (ns !== shot) { onShotChange(g, shot, ns); prevShot = shot; shot = ns; }
      // (6v6 en 3ª persona: el corte al plano de reacción, pasados TPP.hold s reales del punto)
      if (shot === 'tpPoint' && g.mode === 'point' && !TPP.cutDone && TPP.willCut && ctx.state !== 'paused' && !ctx.frozen) {
        TPP.t += dt; if (TPP.t >= TPP.hold) { tpPlan(g); TPP.cutDone = true; TPP.cutNow = true; }
      }
      if (settleSmoothers) {
        settleSmoothers = false;
        K.dt = 0; if (g.ctrl) { updateAnticipation(g); subject(g); updateLead(g); } computeDesired(g); K.dt = dt;
      }
      if (g.ctrl) { updateAnticipation(g); subject(g); updateLead(g); }
      computeDesired(g);
      svcPrewarm(g);
      // CORTES DE PLANO deliberados: el rig queda asentado en el plano nuevo (settle) y se anotan (cutN / lastCut)
      if (CC.cut) { CC.cut = false; settle(g); markCut(prevShot, shot, 'court'); }
      if (RV.cutIn) { RV.cutIn = false; if (shot === 'review') { settle(g); markCut(prevShot, 'review', 'replay'); } }
      if (RV.cutOut) { RV.cutOut = false; if (shot !== 'review') { settle(g); markCut('point', shot, (shot === 'serveUs' || shot === 'serveThem') ? 'serve' : shot === 'over' ? 'over' : 'replay'); } }
      if (CL.abortCut) { CL.abortCut = false; settle(g); markCut('clinch', shot, 'clinch'); }
      // (el corte que SALE del punto es el de vuelta al saque, 'serve': cortinilla de UI-13 y rótulos con él; la vuelta a la cámara de
      // recepción es un corte seco dentro del saque, 'cutaway')
      if (INTRO.cutIn) { INTRO.cutIn = false; if (shot === 'intro') { settle(g); markCut(prevShot, 'intro', 'intro'); } }
      // (presentación que acaba sola: la cámara ya está en el encuadre planeado; sin asentar de nuevo —un oficial que se movió o el saque
      // que llega tras la tarjeta no la mueven de golpe—: el plano del saque sigue desde ahí con su suavizado)
      if (INTRO.cut) { INTRO.cut = false; if (GAMEPLAY[shot] && !INTRO.handoff) { settle(g); markCut('intro', shot, 'serve'); } else if (INTRO.handoff) { resetVel(); outInit = true; K.outYaw = at2(L.y - P.y, L.x - P.x); K.outPitch = at2(L.z - P.z, hyp(L.x - P.x, L.y - P.y)); K.exPitch = K.exYaw = 0; } INTRO.handoff = false; }
      if (TVS.cut) { TVS.cut = false; if (shot === 'tv') { settle(g); markCut('tv', 'tv', 'serve'); } }
      if (TPP.replan) { TPP.replan = false; if (shot === 'tpPoint' && TPP.cutDone) { tpPlan(g); settle(g); } }
      if (TPP.cutNow) { TPP.cutNow = false; if (shot === 'tpPoint') { settle(g); markCut('point', 'point', 'point'); } }
      if (TPP.backCut) { TPP.backCut = false; if (shot === 'tp') { settle(g); markCut('point', 'tp', 'serve'); } }
      if (TPP.swCut) { TPP.swCut = false; settle(g); markCut(prevShot, shot, 'cam'); }
      if (MN.cut) { MN.cut = false; if (shot === 'menu') { settle(g); markCut('menu', 'menu', 'attract'); } }
      if (CW.cutIn) { CW.cutIn = false; settle(g); markCut(prevShot, 'cutaway', 'serve'); }
      if (CW.cutOut) { CW.cutOut = false; settle(g); markCut('cutaway', shot, 'cutaway'); }
      if (CL.on && CL.cutNow && shot === 'clinch') { CL.cutNow = false; settle(g); markCut(prevShot === 'clinch' ? 'clinch' : prevShot, 'clinch', 'clinch'); }
      if (PF.cutNow) {
        PF.cutNow = false;
        // posiciones y frente del instante del corte (con el acuerdo de players, no: la coreografía ya sigue a ESTA cámara)
        if (PF.mode === 'hero' && !HS.on) planPoint(g, PF.how, pointPlayer, true);
        settle(g); markCut('point', 'point', 'point');
      }
      if (backPending) {
        backPending = false;
        // presupuesto de la transición: listo >= 0,4 s antes del lanzamiento rival (g.cpuTossIn si sim lo da)
        var bud = 0.8;
        if (shot === 'serveThem' && typeof g.cpuTossIn === 'number' && g.cpuTossIn > 0) bud = mn(mx(gameToReal(g.cpuTossIn) - 0.45, 0.45), 0.9);
        if (PF.backCut || ccAbort || !startFixedBlend(g, bud)) { if (FB.on) FB.on = false; settle(g); markCut(prevShot, shot, 'serve'); }
      }
      if (cutCheck) {
        cutCheck = false;
        if (ccAbort || ((P.x > 0) !== (D.x > 0) && Math.abs(P.x) > 0.8 && Math.abs(D.x) > 0.8) || hyp(P.x - D.x, P.y - D.y) > 11) {
          settle(g); markCut(prevShot, shot, shot === 'over' ? 'over' : 'serve');
        }
      }

      if (FB.on) {
        // transición fija: una sola curva en posición (y giro/cabeceo/FOV en apply); al acabar, el rig sigue desde ahí
        K.fbT += dt;
        var u = fbCurve(K.fbT / K.fbDur);
        P.x = FB.P0.x + (FB.P1.x - FB.P0.x) * u; P.y = FB.P0.y + (FB.P1.y - FB.P0.y) * u; P.z = FB.P0.z + (FB.P1.z - FB.P0.z) * u;
        if (K.fbT >= K.fbDur) {
          FB.on = false;
          P.x = FB.P1.x; P.y = FB.P1.y; P.z = FB.P1.z; L.x = FB.L1.x; L.y = FB.L1.y; L.z = FB.L1.z;
          K.exPitch = K.fbExP; K.exYaw = K.fbExY; K.fovBoost = K.fbBoost; K.fovCur = K.fbFov1;
          resetVel(); outInit = true; K.outYaw = K.fbYaw1; K.outPitch = K.fbPitch1; K.blendT = 0;
        }
      } else {
        var c = SHOTS[shot], baseSmooth = c ? c.smooth : (shot === 'menu' ? 1.0 : shot === 'over' ? 0.9 : shot === 'court' ? 0.14 : shot === 'review' ? (calm ? 0.3 : 0.2) : shot === 'clinch' ? 0.12 : shot === 'cutaway' ? 0.2 : shot === 'intro' ? 0.35 : shot === 'tv' ? 0.4 : shot === 'tp' || shot === 'tpPoint' ? 0.3 : 0.6);
        // ajuste del jugador (Ajustes > cámara): 0,5 lenta … 1,5 rápida
        if (c || shot === 'tp') { var sens = mn(mx(+(ctx.settings && ctx.settings.camSens) || 1, 0.5), 1.5); baseSmooth /= sens; }
        if (c && calm) baseSmooth *= 1.6;
        var smoothT = baseSmooth, maxSpeed = 40;
        if (K.blendT > 0) {
          var f = K.blendT / K.blendDur;               // 1 al empezar, 0 al acabar
          smoothT = baseSmooth + (K.blendSmooth - baseSmooth) * f;
          maxSpeed = K.blendMax + (40 - K.blendMax) * (1 - f);
          K.blendT = mx(0, K.blendT - dt);
        }
        // cambio hacia un jugador que está por detrás (p. ej. del bloqueador al defensor): la cámara
        // RETROCEDE deprisa (un travelling hacia atrás es cómodo) en vez de cabecear hacia el suelo
        if (K.swFast > 0 && c) {
          var kf = smooth01(K.swFast / 0.9);
          smoothT = mn(smoothT, smoothT + ((calm ? 0.34 : 0.2) - smoothT) * kf);
          maxSpeed = mx(maxSpeed, 30 * kf);
          K.swFast = mx(0, K.swFast - dt);
        }
        if (dt > 0) {
          K.sdT = smoothT; K.sdMax = maxSpeed; sdv(P, D, PV);
          K.sdT = shot === 'menu' && K.blendT <= 0 ? 0.16 : smoothT * (K.ftW > 0.01 ? 0.45 : 0.75); K.sdMax = maxSpeed * 1.4; sdv(L, A, LV);   // (menú: la mira ya viene suavizada por mnFrame)
        }
      }
      if (shot === 'intro' && !FB.on) { P.x = D.x; P.y = D.y; P.z = D.z; L.x = A.x; L.y = A.y; L.z = A.z; PV.x = PV.y = PV.z = LV.x = LV.y = LV.z = 0; }   // (la curva ya es suave: sin retraso, acaba exacta)
      clampInside(P, shot === 'court');
      apply(g);
      K.nextCut = nextCutIn(g);
      dbg.svcEval = SVC.nEval; dbg.svcOff = SVC.nOff; SVC.nEval = SVC.nOff = 0; dbg.cutN = CUT.n; dbg.nextCutIn = K.nextCut; dbg.timeScale = ctx.timeScale; dbg.hitStop = K.hsT; dbg.fb = FB.on ? K.fbT / K.fbDur : -1;
    }
  };
})();
