/* =====================================================================
 * VOLEY 3D — js/sim.js   (owner: sim)
 * Simulación pura del partido: física del balón, reglas, flujo del rally,
 * calidad de golpeo por tiempo (timing), saques, bloqueos, defensas en
 * plancha y marcador. SIN DOM, SIN THREE, SIN window (solo el objeto VB).
 * Se puede cargar en node (tools/simtest.js) con vm.
 *
 * COORDENADAS DE LA SIMULACIÓN (metros):
 *   x = largo de la pista. Red en x = 0. Equipo 0 (humano, rojo) en x > 0,
 *       equipo 1 (CPU, azul) en x < 0. Líneas de fondo en x = ±9.
 *   y = ancho de la pista. Líneas laterales en y = ±4.5.
 *   z = altura (arriba). Suelo z = 0. Borde superior de la red z = 2.43.
 * Three.js es Y-up: usar SIEMPRE VB.toThree(x, y, z, out) para convertir.
 *   three.x = sim.x ; three.y = sim.z ; three.z = -sim.y
 *
 * MODELO DE GOLPEO (humano):
 *   Pulsar GOLPEAR abre un "gesto" de C.SWING s. El contacto ocurre cuando el
 *   balón está al alcance; si el momento ideal (balón a la altura de contacto
 *   de ese toque) llega en menos de C.ASSIST s, el gesto lo espera. La calidad
 *   sale del desfase con el momento ideal: |te| <= W_PERFECT -> 'perfect',
 *   <= W_GOOD -> 'good', si no 'poor'. La IA usa la MISMA función con un
 *   desfase aleatorio que depende de la dificultad.
 * ===================================================================== */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;
  var VB = root.VB = root.VB || {};

  // ---------- Constantes ----------
  var C = VB.C = {
    G: 9,            // gravedad "de juego" (m/s²), algo menor que la real para dar tiempo
    NET_H: 2.43,     // altura de red masculina
    NET_LOW: 1.43,   // borde inferior de la malla (red de 1 m)
    ANT_TOP: 3.23,   // punta de las antenas (80 cm sobre la red)
    HL: 9,           // media longitud de pista
    HW: 4.5,         // media anchura
    ATTACK: 3,       // línea de ataque (3 m)
    BR: 0.21,        // radio del balón (exagerado para legibilidad)
    SPEED: 5.6,      // velocidad de carrera
    JUMP_V: 4.4,     // velocidad inicial de salto
    REACH: 1.35,     // alcance horizontal para tocar
    DIVE: 1.05,      // alcance extra lanzándose en plancha
    SIM_HZ: 120,     // paso fijo recomendado (main.js)
    // --- timing ---
    SWING: 0.30,     // duración del gesto de golpeo (ventana de contacto tras pulsar)
    ASSIST: 0.05,    // el gesto espera al momento ideal si llega antes de esto
    W_PERFECT: 0.035,// |desfase| máximo para 'perfect' (s)
    W_GOOD: 0.10,    // |desfase| máximo para 'good' (s)
    SWING_LOCK: 0.12,// bloqueo tras un gesto fallido (evita aporrear el botón)
    NET_TOUCH: 0.30, // un jugador en el aire a menos de esto de la red la toca
    SERVE_CLOCK: 8,  // regla de los 8 segundos para sacar
    // altura ideal de contacto sobre los pies del jugador, por tipo de toque
    ZC: { pass: 0.85, set: 2.2, free: 1.5, spike: 2.45, fserve: 2.55, jserve: 2.45 }
  };

  /* Perfiles de dificultad. Se aplican por equipo (g.prof[team]).
   *  react: retardo de reacción tras cada toque (s)      speed: fracción de la velocidad de carrera
   *  timing: desviación típica del desfase al golpear (s) err: multiplicador de dispersión
   *  block: prob. de cerrar el bloqueo                     dig: prob. base de defender un remate
   *  recv: prob. base de recibir un saque potente          spike: velocidad de remate (m/s)
   *  jserve: velocidad del saque en salto (m/s)            jumpServe: prob. de sacar en salto
   *  tip: prob. de dejada ante bloqueo                      aimNoise: ruido al elegir zona (m)
   *  netErr: prob. de no corregir la deriva hacia la red   blockReact: retardo del salto al bloqueo
 *  atkErr: prob. de error no forzado en ataque (fuera/red) srvErr: prob. de error de saque */
  var DIFF = VB.DIFF = {
    easy:   { name: 'Fácil',   react: 0.30, speed: 0.82, timing: 0.11,  err: 1.6,  block: 0.12, dig: 0.20, recv: 0.70, spike: 13.5, jserve: 12.0, jumpServe: 0.05, tip: 0.04, aimNoise: 4.0, netErr: 0.06,  blockReact: 0.18, atkErr: 0.14, srvErr: 0.15 },
    normal: { name: 'Normal',  react: 0.12, speed: 0.95, timing: 0.045, err: 0.85, block: 0.42, dig: 0.52, recv: 0.90, spike: 17.5, jserve: 16.0, jumpServe: 0.45, tip: 0.12, aimNoise: 1.0, netErr: 0.015, blockReact: 0.06, atkErr: 0.08, srvErr: 0.10 },
    hard:   { name: 'Difícil', react: 0.06, speed: 1.00, timing: 0.028, err: 0.55, block: 0.55, dig: 0.68, recv: 0.96, spike: 19.5, jserve: 18.0, jumpServe: 0.70, tip: 0.15, aimNoise: 0.4, netErr: 0.005, blockReact: 0.04, atkErr: 0.05, srvErr: 0.07 },
    // compañero IA del humano (y equipo 0 en autopilot): nivel fijo, el peso del partido lo lleva el humano
    mate:   { name: 'Compañero', react: 0.16, speed: 0.92, timing: 0.065, err: 1.0, block: 0.30, dig: 0.40, recv: 0.85, spike: 16.0, jserve: 14.5, jumpServe: 0.35, tip: 0.10, aimNoise: 1.6, netErr: 0.02, blockReact: 0.09, atkErr: 0.05, srvErr: 0.08 }
  };

  var DIFF_ALIAS = { facil: 'easy', 'fácil': 'easy', easy: 'easy', normal: 'normal', medio: 'normal', dificil: 'hard', 'difícil': 'hard', hard: 'hard' };
  function normDiff(d) { return DIFF_ALIAS[String(d || 'normal').toLowerCase()] || 'normal'; }

  /** Convierte coordenadas de la simulación (z arriba) a Three.js (y arriba).
   *  Si se pasa `out` con .set (THREE.Vector3) o un objeto {x,y,z}, se reutiliza. */
  VB.toThree = function (x, y, z, out) {
    if (out) {
      if (out.set) return out.set(x, z, -y);
      out.x = x; out.y = z; out.z = -y; return out;
    }
    return { x: x, y: z, z: -y };
  };
  /** Inversa: Three.js -> simulación. */
  VB.fromThree = function (tx, ty, tz, out) {
    out = out || {};
    out.x = tx; out.y = -tz; out.z = ty; return out;
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function side(t) { return t === 0 ? 1 : -1; } // equipo 0 en x > 0

  // PRNG determinista (mulberry32) para escenas de depuración y tests
  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Entidades ----------
  function mkPlayer(team, num, idx) {
    return {
      id: team * 2 + idx, team: team, idx: idx, num: num,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, // vx,vy = velocidad real del último paso (para animación)
      anim: 0,        // >0 mientras dura un gesto de golpeo/brazos arriba (s)
      cool: 0,        // enfriamiento tras tocar
      bd: 0, bdT: 0.1,// temporizador de salto al bloqueo (IA)
      jvx: 0, jvy: 0, // deriva horizontal en el aire (impulso del despegue)
      lvx: 0, lvy: 0, // impulso de la plancha
      down: 0,        // >0 = en el suelo tras una plancha (s): no se puede mover
      shot: '',       // subtipo del último toque ('tip', 'dive', 'jump', 'float', ...)
      grade: '',      // calidad del último toque ('perfect'|'good'|'poor')
      aiTe: 0, aiTeT: -1, aiJt: 0, // desfases de la IA (muestreados por toque)
      lastAction: '', // 'pass'|'set'|'spike'|'free'|'serve'|'block'|'swing'|'jump'|'toss'|'dive'
      actionT: 99,    // segundos desde lastAction
      onGround: true
    };
  }

  /** Crea un partido nuevo.
   *  opts: { demo:bool (CPU vs CPU), autopilot:bool (equipo humano lo lleva la IA
   *          pero la cámara/HUD son de partido), seed:int,
   *          difficulty:'easy'|'normal'|'hard' (también 'facil','dificil'): nivel de la CPU,
   *          serveClock:bool (regla de 8 s para el saque humano, por defecto true),
   *          stats:bool } */
  function createGame(opts) {
    opts = opts || {};
    var teams = [[mkPlayer(0, 7, 0), mkPlayer(0, 11, 1)], [mkPlayer(1, 3, 0), mkPlayer(1, 9, 1)]];
    var diff = normDiff(opts.difficulty);
    var g = {
      opts: opts,
      demo: !!opts.demo,
      autopilot: !!opts.autopilot,
      difficulty: diff,
      prof: opts.demo ? [DIFF.normal, DIFF.normal] : [DIFF.mate, DIFF[diff]], // equipo 0: compañero IA de nivel fijo
      rng: makeRng(opts.seed != null ? opts.seed : (Date.now() & 0x7fffffff)),
      time: 0,                 // tiempo de juego acumulado (s)
      teams: teams,
      players: teams[0].concat(teams[1]),
      ball: { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0, held: null, spin: 0, speed: 0, dip: 0, wobA: 0, wobF: 0, wobP: 0 },
      mode: 'serve',           // 'serve' | 'rally' | 'point' | 'over'
      score: [0, 0], sets: [0, 0], setNo: 1, setScores: [],
      serving: 0, serverIdx: [0, 1],
      server: null,            // jugador que saca en este punto
      serveState: 'ready',     // 'ready' (balón en la mano) | 'toss' (balón lanzado)
      serveJump: false,        // saque en salto (true) o flotante (false)
      serveClock: C.SERVE_CLOCK, // segundos que quedan para sacar (regla de 8 s, solo humano)
      serveT: 0, tossT: 0, jumpAt: 0, aiServeTe: 0, serveAuth: false, whistleAt: 0.7, // serveAuth: ya ha pitado el saque
      touchTeam: -1, touches: 0, lastPlayer: null, lastTeam: -1, lastKind: '', lastShot: '',
      lastTouchT: 0,           // g.time del último contacto (toque, bloqueo, saque)
      ctrl: teams[0][0],       // jugador que controla el humano
      jobs: [null, null],      // quién de cada equipo va al balón
      pr1: { x: 0, y: 0, z: 0, t: 0 }, pr3: { x: 0, y: 0, z: 0, t: 0 }, // predicciones de cruce a 1 m y 3 m
      blockOff: [0, 0], timer: 0, blockCD: 0,
      hitBuf: 0,               // > 0 mientras dura el gesto de golpeo del humano (s)
      swingLive: false, swingShot: '', swingLock: 0,
      lastGrade: '',           // calidad del último toque humano
      pendingSet: false, digOk: true, hardIn: false, finished: false,
      lastPoint: null,         // {team, reason, text}
      setPoint: -1, matchPoint: -1, // equipo con punto de set/partido en el saque actual (-1 nadie)
      rally: { t: 0, hits: 0 },// duración y toques del rally en curso
      events: [],              // cola de eventos del paso (main.js la vacía cada frame)
      stats: opts.stats ? {
        hits: { pass: 0, set: 0, spike: 0, free: 0, serve: 0 }, blocks: 0, points: 0, why: {}, rallies: [],
        grades: { perfect: 0, good: 0, poor: 0 }, hgrades: { perfect: 0, good: 0, poor: 0 }, shots: {},
        won: [0, 0], misses: 0, dives: 0, blockKinds: { stuff: 0, soft: 0, tool: 0 }
      } : null
    };
    g.server = teams[0][0];
    newGame(g);
    return g;
  }

  function other(g, p) { var t = g.teams[p.team]; return t[0] === p ? t[1] : t[0]; }
  function isHuman(g, p) { return !g.demo && !g.autopilot && p.team === 0 && p === g.ctrl; }
  function emit(g, e) { e.t = g.time; g.events.push(e); return e; }
  function rnd(g, a) { return (g.rng() * 2 - 1) * a; }
  function gauss(g) { return (g.rng() + g.rng() + g.rng() + g.rng() - 2) * 1.732; } // ~N(0,1)

  // ---------- Calidad por timing ----------
  /** te = desfase (s) entre el contacto y el momento ideal (<0 pronto, >0 tarde) -> 0..1 */
  function timingQ(te) {
    var a = Math.abs(te || 0);
    if (a <= C.W_PERFECT) return 1 - 0.1 * a / C.W_PERFECT;
    if (a <= C.W_GOOD) return 0.9 - 0.4 * (a - C.W_PERFECT) / (C.W_GOOD - C.W_PERFECT);
    return Math.max(0.05, 0.5 - 0.45 * (a - C.W_GOOD) / 0.2);
  }
  function gradeOf(q) { return q >= 0.78 ? 'perfect' : q >= 0.45 ? 'good' : 'poor'; }

  // ---------- Física del balón ----------
  function gEff(b) { return C.G + (b.dip || 0); }
  var _pr = { x: 0, y: 0, z: 0, t: 0 };
  /** Dónde cruza el balón la altura zt bajando. Escribe en `out` (sin asignaciones).
   *  Incluye el efecto liftado (b.dip); no incluye el baile del flotante (imprevisible). */
  function predict(g, zt, out) {
    var b = g.ball, x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz, t = 0, dt = 1 / 100, G = gEff(b);
    for (var i = 0; i < 500; i++) {
      if (vz < 0 && z <= zt) break; if (z <= C.BR && vz < 0) break;
      vz -= G * dt; x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
    }
    out = out || _pr; out.x = x; out.y = y; out.z = z; out.t = t; return out;
  }
  /** Punto de caída al suelo (z = radio del balón). Útil para el aro de caída. */
  function predictLanding(g, out) { return predict(g, C.BR, out); }

  function launchApex(p, tx, ty, tz, apex) {
    var G = C.G;
    apex = Math.max(apex, p.z + 0.3, tz + 0.3);
    var vz = Math.sqrt(2 * G * (apex - p.z)), T = vz / G + Math.sqrt(2 * (apex - tz) / G);
    return [(tx - p.x) / T, (ty - p.y) / T, vz];
  }
  function clearsNet(p, v, G) {
    G = G || C.G;
    if (!v[0]) return true; var tn = -p.x / v[0]; if (tn <= 0) return true;
    return p.z + v[2] * tn - 0.5 * G * tn * tn > C.NET_H + 0.3;
  }
  function launchSafe(p, tx, ty, tz, apex) { // globo que pasa la red
    var v; for (var i = 0; i < 25; i++) { v = launchApex(p, tx, ty, tz, apex); if (clearsNet(p, v)) break; apex += 0.25; }
    return v;
  }
  function launchDirect(p, tx, ty, tz, speed, G) { // remate: tenso, se frena lo justo para pasar la red
    G = G || C.G;
    var T = Math.max(0.25, Math.hypot(tx - p.x, ty - p.y) / speed), v;
    for (var i = 0; i < 30; i++) {
      v = [(tx - p.x) / T, (ty - p.y) / T, (tz - p.z + 0.5 * G * T * T) / T];
      if (clearsNet(p, v, G)) break; T *= 1.08;
    }
    return v;
  }

  function canReach(g, p) {
    var b = g.ball;
    if (g.mode === 'serve') return g.serveState === 'toss' && p === g.server && serveReach(g, p);
    if (b.held || g.mode !== 'rally' || p.down > 0) return false;
    if (g.lastKind === 'serve' && g.touchTeam === p.team) return false; // no se toca el propio saque
    if (g.touchTeam === p.team && g.lastPlayer === p) return false;    // ni dos toques seguidos
    var d = Math.hypot(b.x - p.x, b.y - p.y), rz = b.z - p.z;
    if (d > C.REACH || rz < 0.05 || rz > 2.7) return false;
    return b.x * side(p.team) > -0.4;
  }
  /** ¿Puede llegar lanzándose en plancha? (solo en el suelo, balón bajo) */
  function canDive(g, p) {
    var b = g.ball;
    if (b.held || g.mode !== 'rally' || p.down > 0 || p.z > 0 || p.vz > 0) return false;
    if (g.lastKind === 'serve' && g.touchTeam === p.team) return false;
    if (g.touchTeam === p.team && g.lastPlayer === p) return false;
    var d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d > C.REACH + C.DIVE || b.z < 0.08 || b.z > 1.3) return false;
    return b.x * side(p.team) > 0.2;
  }
  function serveReach(g, p) {
    var b = g.ball, sd = side(p.team);
    var dx = b.x - (p.x - sd * 0.3), dy = b.y - p.y, dz = b.z - (p.z + C.ZC[g.serveJump ? 'jserve' : 'fserve']);
    return dx * dx + dy * dy + dz * dz < 0.85 * 0.85;
  }

  /** Tipo de toque que daría ahora el jugador p (para el timing y la UI). */
  function predictKind(g, p) {
    if (g.mode === 'serve') return g.serveJump ? 'jserve' : 'fserve';
    var count = g.touchTeam === p.team ? g.touches + 1 : 1;
    if ((p.z > 0.25 || p.vz > 0.5) && Math.abs(g.ball.x) < 3.8) return 'spike';
    if (count >= 3) return 'free';
    return count === 1 ? 'pass' : 'set';
  }

  /* Ventana de golpeo: busca en la trayectoria del balón (hacia atrás hasta el
   * último contacto y hacia delante 1.2 s) el instante en que está más cerca
   * del punto de contacto ideal del jugador (pies + ZC[kind], con su salto).
   * out = { t: s hasta el ideal (<0 = ya pasó), d: distancia horizontal en el
   *         ideal, dz: error vertical en el ideal, reach: alcanzable en el ideal,
   *         kind, zc, x,y,z: punto ideal del balón, active: gesto humano en curso,
   *         canReach: alcanzable ahora } */
  var _w = { t: 0, d: 9, dz: 9, reach: false, kind: '', zc: 0, x: 0, y: 0, z: 0, active: false, canReach: false };
  function hitWindow(g, p, out) {
    p = p || g.ctrl; out = out || _w;
    var b = g.ball, kind = predictKind(g, p), zc = C.ZC[kind], G = gEff(b), PG = C.G;
    var sd = side(p.team), offx = g.mode === 'serve' ? -sd * 0.3 : 0;
    var air = p.z > 0 || p.vz > 0;
    var tb = -Math.min(0.35, Math.max(0, g.time - g.lastTouchT));
    var best = 1e9, bt = 0, bd = 9, bdz = 9, bx = b.x, by = b.y, bz = b.z, st = 1 / 120;
    for (var t = tb; t <= 1.2; t += st) {
      var x = b.x + b.vx * t, y = b.y + b.vy * t, z = b.z + b.vz * t - 0.5 * G * t * t;
      if (t > 0 && z < C.BR) break;
      var pz = air ? Math.max(0, p.z + p.vz * t - 0.5 * PG * t * t) : p.z;
      var dx = x - p.x - offx, dy = y - p.y, dz = z - (pz + zc);
      var D = 0.6 * (dx * dx + dy * dy) + dz * dz;
      if (D < best) { best = D; bt = t; bd = Math.sqrt(dx * dx + dy * dy); bdz = dz; bx = x; by = y; bz = z; }
      if (t > 0.3 && D > best + 4) break; // ya se aleja mucho: no hace falta seguir
    }
    out.t = bt; out.d = bd; out.dz = bdz; out.kind = kind; out.zc = zc; out.x = bx; out.y = by; out.z = bz;
    out.reach = g.mode === 'serve' ? (bd < 0.85 && Math.abs(bdz) < 0.85) : (bd <= C.REACH && bdz > -zc + 0.05 && bdz < 2.7 - zc);
    out.active = g.hitBuf > 0 && g.swingLive; out.canReach = canReach(g, p);
    // ¿toca atacar? tiempo hasta el despegue ideal (para la UI: "¡salta!") o NaN
    out.attack = false; out.jumpT = NaN;
    if (g.mode === 'rally' && !air && g.touchTeam === p.team && g.touches === 2 && g.jobs[p.team] === p &&
        Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) {
      var hz = C.ZC.spike + C.JUMP_V * C.JUMP_V / (2 * C.G), vz0 = b.vz, disc = vz0 * vz0 - 2 * G * (hz - b.z);
      if (disc >= 0) { out.attack = true; out.jumpT = (vz0 + Math.sqrt(disc)) / G - C.JUMP_V / C.G; }
    }
    return out;
  }

  function attackTarget(p, aim, dd) {
    var sd = side(p.team);
    var tx = -sd * dd, ty = -Math.sign(p.y || 0.1) * 1.6; // por defecto, diagonal
    if (aim) { tx += aim[0] * 2.3; ty += aim[1] * 2.6; }
    return [-sd * clamp(-sd * tx, 1.4, 8.3), clamp(ty, -3.9, 3.9)];
  }

  function fastInFor(g) {
    var b = g.ball; return Math.hypot(b.vx, b.vy, b.vz);
  }

  /** Golpeo: el tipo de toque lo decide el juego según contexto.
   *  te: desfase con el momento ideal (s). shot: '' | 'tip' | 'dive'.
   *  tgt: [x,y] destino explícito (IA) o null para usar aim. */
  function hit(g, p, aim, te, shot, tgt) {
    var t = p.team, sd = side(t), b = g.ball, prof = g.prof[t];
    if (g.touchTeam === t && g.lastPlayer === p) { fault(g, t, 'double', 'Dobles: el mismo jugador toca dos veces', p); return; }
    var count = g.touchTeam === t ? g.touches + 1 : 1;
    if (count > 3) { fault(g, t, 'four', '4 toques', p); return; }
    var human = isHuman(g, p), mate = other(g, p);
    te = te || 0; shot = shot || '';
    var d = Math.hypot(b.x - p.x, b.y - p.y), inSp = fastInFor(g);
    var hardIn = g.lastKind === 'spike' || (g.lastKind === 'serve' && inSp > 13);
    // calidad: timing x distancia x dificultad de lo que llega
    var q = timingQ(te);
    q *= 1 - 0.3 * clamp((d / C.REACH - 0.55) / 0.45, 0, 1);
    if (hardIn) q *= 1 - 0.25 * clamp((inSp - 11) / 8, 0, 1);
    if (shot === 'dive') q = Math.min(q, 0.62) * 0.85;
    q = clamp(q, 0, 1);
    var grade = gradeOf(q), mul = human ? 1 : prof.err;
    g.touchTeam = t; g.touches = count; g.lastPlayer = p; g.lastTeam = t; p.anim = 0.3; p.cool = 0.3;
    var o = { x: b.x, y: b.y, z: b.z };
    var v, kind, at, er, power = 0, dip = 0, sub = shot;
    if (p.z > 0.25 && Math.abs(b.x) < 3.8 && b.z > C.NET_H + 0.1) {
      if (shot === 'tip') { // dejada: suave, corta, por encima del bloqueo
        at = tgt || [-sd * (1.6 + (aim ? clamp(-sd * aim[0], -0.3, 1) : 0.3)), clamp(aim ? p.y + aim[1] * 2.6 : -p.y, -3.8, 3.8)];
        er = (0.25 + 0.9 * (1 - q)) * mul;
        v = launchSafe(o, at[0] + rnd(g, er), at[1] + rnd(g, er), 0, Math.max(b.z + 0.45, C.NET_H + 0.9));
        kind = 'free'; power = 0.1;
      } else { // remate
        at = tgt || attackTarget(p, aim, 6);
        var spd = human ? 13.5 + 5.5 * q : prof.spike * (0.82 + 0.18 * q);
        power = clamp((spd - 11) / 8, 0, 1);
        er = (0.25 + 1.5 * (1 - q)) * mul;
        dip = C.G * (0.15 + 0.3 * q); // liftado: el balón "cae" más
        v = launchDirect(o, at[0] + rnd(g, er), at[1] + rnd(g, er), 0, spd, C.G + dip);
        if (q < 0.45 && g.rng() < (0.48 - q) * 0.75) v[2] -= 1.4 + g.rng(); // a la red
        else if (!human && g.rng() < prof.atkErr) aiError(g, o, v, spd, sd, C.G + dip);   // error no forzado de la IA
        kind = 'spike'; sub = 'power';
      }
      // ¿defenderá la IA del otro equipo?
      g.hardIn = kind === 'spike';
      var dp = g.prof[1 - t];
      g.digOk = kind === 'spike' ? g.rng() < dp.dig * clamp(1.25 - 0.75 * power, 0.25, 1.2) : true;
    } else if (count === 3) {
      at = tgt || attackTarget(p, aim, 6.5);
      er = (0.35 + 1.4 * (1 - q)) * mul;
      var ap = Math.max(4.4, b.z + 1);
      if (q < 0.4 && g.rng() < (0.42 - q) * 0.6) v = launchApex(o, at[0] + rnd(g, er), at[1] + rnd(g, er), 0, 2.9); // se queda en la red
      else v = launchSafe(o, at[0] + rnd(g, er), at[1] + rnd(g, er), 0, ap);
      kind = 'free'; sub = sub || (b.z - p.z > 1.6 ? 'overhead' : 'forearm');
      g.hardIn = false; g.digOk = true;
    } else if (count === 1) {
      er = (0.18 + 1.45 * (1 - q) + (hardIn ? 0.45 * (1 - q) : 0)) * mul;
      if (q < 0.3 && g.rng() < 0.55 * (0.3 - q) / 0.3) { // recepción fallida: sale desviada
        var wy = (g.rng() < 0.5 ? -1 : 1) * (3.5 + g.rng() * 2.5);
        v = launchApex(o, sd * (2.5 + g.rng() * 6), wy, 0, 2.6 + g.rng() * 2); sub = 'shank';
      } else {
        v = launchApex(o, sd * (2 + rnd(g, er * 1.1)), clamp(mate.y, -2.5, 2.5) + rnd(g, er * 1.3), 1.9, hardIn ? 4.1 : 4.4);
      }
      kind = 'pass'; sub = sub || (hardIn ? 'dig' : 'forearm');
      g.hardIn = false; g.digOk = true;
    } else {
      er = (0.1 + 1.15 * (1 - q)) * mul;
      if (q < 0.35 && g.rng() < 0.12) v = launchApex(o, -sd * (1 + g.rng() * 2), b.y + rnd(g, 1.5), 0, 4.6); // pasa la red sin querer
      else v = launchApex(o, sd * (1.35 + rnd(g, er * 0.5)), clamp(mate.y, -3.6, 3.6) + rnd(g, er * 0.9), 3, 5.3);
      kind = 'set'; sub = sub || 'overhead';
      g.blockOff[1 - t] = rnd(g, 0.8);
      g.hardIn = false; g.digOk = true;
    }
    b.vx = v[0]; b.vy = v[1]; b.vz = v[2]; b.dip = dip; b.wobA = 0;
    g.lastKind = kind; g.lastShot = sub; g.lastTouchT = g.time; g.netSince = false;
    b.speed = Math.hypot(v[0], v[1], v[2]);
    p.lastAction = kind === 'free' && sub === 'tip' ? 'spike' : kind; p.actionT = 0; p.shot = sub; p.grade = grade;
    if (shot === 'dive') p.lastAction = 'dive';
    g.rally.hits++;
    if (human) g.lastGrade = grade;
    if (g.stats) {
      g.stats.hits[kind]++; g.stats.grades[grade]++; if (human) g.stats.hgrades[grade]++;
      g.stats.shots[sub] = (g.stats.shots[sub] || 0) + 1;
    }
    emit(g, { type: 'hit', kind: kind, player: p, team: t, touch: count, quality: q, grade: grade, timing: te,
      power: power, shot: sub, dive: shot === 'dive', aim: aim ? [aim[0], aim[1]] : null, target: at ? [at[0], at[1]] : null,
      x: b.x, y: b.y, z: b.z, speed: b.speed, human: human });
    endSwing(g);
  }

  /** Error no forzado de la IA: remate largo, abierto o a la red (reescribe v). */
  function aiError(g, o, v, spd, sd, G) {
    var r = g.rng(), w;
    if (r < 0.4) w = launchDirect(o, -sd * (9.5 + g.rng() * 1.2), o.y * 0.3 + rnd(g, 2.5), 0, spd, G);           // largo
    else if (r < 0.75) w = launchDirect(o, -sd * (3 + g.rng() * 5), (g.rng() < 0.5 ? -1 : 1) * (4.9 + g.rng() * 1.2), 0, spd, G); // abierto
    else { w = v; w[2] -= 1.4 + g.rng(); }                                                                       // a la red
    v[0] = w[0]; v[1] = w[1]; v[2] = w[2];
  }

  function endSwing(g) { g.hitBuf = 0; g.swingLive = false; g.swingShot = ''; }

  function checkBlock(g) {
    var b = g.ball;
    if (g.blockCD > 0 || Math.abs(b.x) > 0.6) return;
    for (var i = 0; i < 4; i++) {
      var q = g.players[i], sq = side(q.team);
      if (q.z < 0.15 || Math.abs(q.x) > 1.1 || g.lastTeam === q.team || Math.sign(b.vx) !== sq) continue;
      if (b.z < C.NET_H - 0.05 || b.z > q.z + 2.85 || Math.abs(b.y - q.y) > 0.75) continue;
      g.blockCD = 0.5;
      if (g.lastKind === 'serve') { fault(g, q.team, 'block', 'Bloqueo del saque', q); return; }
      var human = isHuman(g, q), prof = g.prof[q.team];
      var qb = clamp(1 - Math.abs(q.vz) / C.JUMP_V * 0.8, 0, 1); // mejor cuanto más cerca del punto alto del salto
      var pw = clamp((b.speed - 11) / 8, 0, 1);
      var closeP = human ? 0.55 + 0.45 * qb : prof.block * (0.6 + 0.4 * qb) * (1.2 - 0.5 * pw);
      if (g.lastKind !== 'spike') closeP *= 0.6; // a un balón lento se le bloquea menos (se deja pasar)
      if (g.rng() > closeP) return; // no cierra el bloqueo
      var r = g.rng(), stuffP = 0.22 + 0.4 * qb - 0.22 * pw, kindB;
      if (r < stuffP) { // bloqueo directo: al campo del atacante
        kindB = 'stuff';
        b.x = -sq * 0.25; b.vx = -b.vx * 0.32; b.vy = b.vy * 0.35 + rnd(g, 1.2); b.vz = -1.5 - g.rng() * 2.5;
      } else if (r < stuffP + 0.5) { // toque de bloqueo: el balón queda jugable en el propio campo
        kindB = 'soft';
        b.x = sq * 0.3; b.vx = b.vx * 0.14 + sq * 0.6; b.vy = b.vy * 0.3 + rnd(g, 0.8); b.vz = 2.6 + g.rng() * 2;
      } else { // block-out: rebota en las manos y se va
        kindB = 'tool';
        var out = g.rng() < 0.5 ? 1 : -1;
        b.x = sq * 0.3; b.vx = b.vx * 0.55; b.vy = out * (2.5 + g.rng() * 3); b.vz = 1.5 + g.rng() * 2.5;
      }
      b.dip = 0; b.wobA = 0; b.speed = Math.hypot(b.vx, b.vy, b.vz);
      // El toque de bloqueo no cuenta como uno de los 3 toques del equipo
      g.touchTeam = q.team; g.touches = 0; g.lastPlayer = null; g.lastTeam = q.team; q.anim = 0.3; g.lastKind = 'block';
      g.lastShot = kindB; g.lastTouchT = g.time; g.hardIn = false; g.digOk = true; g.netSince = false;
      q.lastAction = 'block'; q.actionT = 0; q.shot = kindB; q.grade = gradeOf(qb);
      if (g.stats) { g.stats.blocks++; g.stats.blockKinds[kindB]++; }
      emit(g, { type: 'block', player: q, team: q.team, x: b.x, y: b.y, z: b.z, result: kindB, quality: qb, human: human });
      return;
    }
  }

  function stepBall(g, dt) {
    var b = g.ball, G = gEff(b);
    if (b.held) {
      var p = b.held, sd = side(p.team);
      b.x = p.x - sd * 0.25; b.y = p.y; b.z = p.z + 1.95 + Math.sin(g.time * 5.55) * 0.06; return;
    }
    if (g.mode === 'serve') { // balón lanzado al aire para sacar
      b.vz -= C.G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.spin += dt * 2; return;
    }
    if (g.mode !== 'rally') { // balón muerto: bota y rueda
      b.vz -= C.G * dt; b.z += b.vz * dt;
      if (b.z < C.BR) {
        var sp = Math.abs(b.vz);
        b.z = C.BR; b.vz = sp * 0.45; if (b.vz < 0.7) b.vz = 0;
        if (sp > 1.2) emit(g, { type: 'bounce', x: b.x, y: b.y, speed: sp });
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 1 - 1.2 * dt; b.vy *= 1 - 1.2 * dt; b.spin += dt * Math.hypot(b.vx, b.vy) * 2; return;
    }
    var px = b.x;
    if (b.wobA) { // flotante: baila de lado sin girar
      // aceleración lateral de media nula: desvío máximo ~2A/F² (~0.5 m), sin deriva acumulada
      var ph = b.wobF * (g.time - g.lastTouchT);
      b.vy += b.wobA * b.wobP * Math.cos(ph) * dt; b.vx += b.wobA * 0.25 * Math.sin(ph * 1.7) * dt;
    }
    b.vz -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.spin += dt * (b.wobA ? 0.5 : 9 + b.dip);
    if ((px > 0) !== (b.x > 0)) {
      var ay = Math.abs(b.y);
      if (b.z < C.NET_LOW - C.BR) { fault(g, g.lastTeam, 'under', 'Pasa por debajo de la red'); return; }
      if (ay > C.HW - C.BR && ay <= C.HW + C.BR && b.z < C.ANT_TOP + C.BR) { fault(g, g.lastTeam, 'antenna', 'Balón toca la antena'); return; }
      if (ay > C.HW) { fault(g, g.lastTeam, 'antenna', 'Pasa por fuera de la antena'); return; }
      if (b.z < C.NET_H + C.BR) { // red
        var tape = b.z > C.NET_H - 0.06;
        if (tape && b.z > C.NET_H + 0.02 && g.rng() < 0.55) { // en la cinta y pasa (balón "de red")
          b.vx *= 0.3; b.vy *= 0.6; b.vz = Math.abs(b.vz) * 0.2 + 0.9; b.dip = 0; b.wobA = 0;
        } else {
          b.x = px > 0 ? C.BR : -C.BR; b.vx = -b.vx * 0.25; b.vy *= 0.5; if (b.vz > 0) b.vz *= 0.3; b.dip = 0; b.wobA = 0;
        }
        g.netSince = true;
        emit(g, { type: 'net', x: 0, y: b.y, z: b.z, tape: tape });
      }
    }
    checkBlock(g);
    if (b.z <= C.BR && g.mode === 'rally') {
      b.z = C.BR; land(g);
      b.vz = Math.abs(b.vz) * 0.45; b.vx *= 0.5; b.vy *= 0.5; b.dip = 0; b.wobA = 0;
    }
  }
  function land(g) {
    var b = g.ball;
    var inside = Math.abs(b.x) <= C.HL + C.BR && Math.abs(b.y) <= C.HW + C.BR, st = b.x > 0 ? 0 : 1;
    emit(g, { type: 'land', x: b.x, y: b.y, inside: inside, team: st, speed: Math.abs(b.vz) });
    if (inside && st === g.lastTeam && g.netSince) point(g, 1 - st, 'in', g.lastKind === 'serve' ? 'Saque a la red' : 'Balón a la red');
    else if (inside) point(g, 1 - st, 'in', st === 0 ? 'El balón cae en tu campo' : 'El balón cae en el campo rival');
    else point(g, 1 - g.lastTeam, 'out', g.lastKind === 'serve' ? 'Saque fuera' : (g.lastTeam === 0 ? 'Tu balón sale fuera' : 'Balón fuera de la CPU'));
  }
  function fault(g, t, reason, text, p) { point(g, 1 - t, reason, text, p); }

  /** Asigna punto. reason: 'in'|'out'|'antenna'|'under'|'double'|'four'|'net'|'serve'|'block' */
  function point(g, w, reason, text, p) {
    if (g.mode !== 'rally' && g.mode !== 'serve') return;
    g.score[w]++; g.mode = 'point'; g.timer = 1.9; g.ball.held = null; endSwing(g);
    var sideout = w !== g.serving;
    g.lastPoint = { team: w, reason: reason, text: text };
    if (g.stats) { g.stats.points++; g.stats.won[w]++; g.stats.how = g.stats.how || {}; g.stats.why[text] = (g.stats.why[text] || 0) + 1; g.stats.rallies.push(g.rally.t); }
    emit(g, { type: 'whistle', reason: 'point' });
    // cómo se ganó (para UI/público): ace, kill (remate), tip (dejada), block, error, free
    var how = 'error', b = g.ball;
    if (reason === 'in' && g.lastTeam === w && !g.netSince) {
      how = g.lastKind === 'serve' ? 'ace' : g.lastKind === 'block' ? 'block' : g.lastKind === 'spike' ? 'kill' : g.lastShot === 'tip' ? 'tip' : 'free';
    } else if (reason === 'out' && g.lastKind === 'block' && g.lastTeam !== w) how = 'kill'; // block-out
    var ev = emit(g, { type: 'point', team: w, reason: reason, text: text, how: how, score: [g.score[0], g.score[1]],
      sideout: sideout, rallyTime: g.rally.t, rallyHits: g.rally.hits, setWon: false, matchWon: false, player: p || null,
      lastKind: g.lastKind, lastShot: g.lastShot });
    if (g.stats) g.stats.how[how] = (g.stats.how[how] || 0) + 1;
    if (sideout) { // cambio de saque: rota el sacador del equipo que recupera el saque
      g.serving = w; g.serverIdx[w] = (g.serverIdx[w] + 1) % 2;
      emit(g, { type: 'sideout', team: w });
    }
    var tgt = g.setNo === 3 ? 15 : 25, a = g.score[0], bb = g.score[1];
    if (g.score[w] >= tgt && g.score[w] - g.score[1 - w] >= 2) {
      g.sets[w]++; g.setScores.push([a, bb]); ev.setWon = true;
      if (g.sets[w] === 2) {
        g.mode = 'over'; g.timer = 2.2; ev.matchWon = true;
        emit(g, { type: 'set', team: w, setNo: g.setNo, score: [a, bb], sets: [g.sets[0], g.sets[1]] });
        emit(g, { type: 'match', team: w, sets: [g.sets[0], g.sets[1]], setScores: g.setScores.slice() });
      } else {
        g.pendingSet = true; g.timer = 2.6;
        emit(g, { type: 'set', team: w, setNo: g.setNo, score: [a, bb], sets: [g.sets[0], g.sets[1]] });
      }
    }
  }

  // ---------- Jugadores ----------
  function jump(g, p, jvx, jvy) {
    if (p.z === 0 && p.vz === 0 && p.down <= 0) {
      p.vz = C.JUMP_V; p.onGround = false; p.lastAction = 'jump'; p.actionT = 0;
      if (jvx == null) { // impulso: parte de la velocidad de carrera, limitado
        jvx = p.vx * 0.3; jvy = p.vy * 0.3;
        var jl = Math.hypot(jvx, jvy); if (jl > 0.6) { jvx *= 0.6 / jl; jvy *= 0.6 / jl; }
      }
      p.jvx = jvx; p.jvy = jvy || 0;
      emit(g, { type: 'jump', player: p });
    }
  }
  function stepPlayer(g, p, dt, mx, my) {
    var air = p.z > 0 || p.vz > 0;
    if (air) {
      p.vz -= C.G * dt; p.z += p.vz * dt;
      if (p.z <= 0) { p.z = 0; p.vz = 0; p.onGround = true; p.jvx = p.jvy = 0; emit(g, { type: 'landPlayer', player: p }); }
    }
    var ox = p.x, oy = p.y;
    if (p.down > 0) { p.down -= dt; mx = my = 0; }
    if (air) { p.x += p.jvx * dt; p.y += p.jvy * dt; }
    else { p.x += mx * C.SPEED * dt; p.y += my * C.SPEED * dt; }
    if (p.lvx || p.lvy) { // impulso de la plancha
      p.x += p.lvx * dt; p.y += p.lvy * dt; var k = Math.max(0, 1 - 7 * dt); p.lvx *= k; p.lvy *= k;
      if (Math.abs(p.lvx) + Math.abs(p.lvy) < 0.05) p.lvx = p.lvy = 0;
    }
    var sd = side(p.team), inAir = p.z > 0;
    // línea central: no se cruza (en el suelo); en el aire, el cuerpo no atraviesa la red
    p.x = sd * clamp(p.x * sd, inAir ? 0.2 : 0.35, g.mode === 'serve' ? 12 : 11); p.y = clamp(p.y, -6, 6);
    if (inAir && g.mode === 'rally' && Math.abs(p.x) < C.NET_TOUCH && Math.abs(p.y) < C.HW + 0.5) {
      var b = g.ball;
      if (Math.abs(b.x) < 4 && Math.abs(b.y - p.y) < 3) { // durante la acción de jugar el balón
        emit(g, { type: 'netTouch', player: p, x: p.x, y: p.y, z: p.z + 2.2 });
        fault(g, p.team, 'net', 'Toque de red', p);
      }
    }
    if (dt > 0) { p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt; }
    p.anim = Math.max(0, p.anim - dt); p.cool = Math.max(0, p.cool - dt); p.actionT += dt;
  }

  /** Plancha: se lanza hacia el balón y toca (calidad limitada); queda en el suelo un momento. */
  function dive(g, p, aim, te) {
    var b = g.ball, dx = b.x - p.x, dy = b.y - p.y, dl = Math.hypot(dx, dy) || 1;
    var reachOut = Math.max(0, dl - C.REACH * 0.7);
    p.lvx = dx / dl * reachOut * 7; p.lvy = dy / dl * reachOut * 7; // desplaza ~reachOut en el gesto
    p.down = 0.9;
    if (g.stats) g.stats.dives++;
    emit(g, { type: 'dive', player: p, x: b.x, y: b.y, z: b.z, dir: [dx / dl, dy / dl] });
    hit(g, p, aim, te, 'dive');
    p.lastAction = 'dive'; p.actionT = 0;
  }

  // ---------- Gesto de golpeo del humano ----------
  function startSwing(g, p, shot) {
    if (g.swingLive) { g.swingShot = shot || ''; return false; } // durante el gesto, la última pulsación decide el golpe
    if (g.swingLock > 0) return false;
    g.hitBuf = C.SWING; g.swingLive = true; g.swingShot = shot || '';
    if (p.anim <= 0) { p.anim = 0.18; }
    if (p.lastAction !== 'jump' || p.z <= 0) { p.lastAction = 'swing'; p.actionT = 0; }
    emit(g, { type: 'swing', player: p, shot: g.swingShot });
    return true;
  }
  /** Resuelve el gesto en curso: contacto (con espera asistida), plancha, o fallo al expirar. */
  function processSwing(g, p, aim) {
    if (!g.swingLive) return;
    var w, b = g.ball;
    if (canReach(g, p)) {
      w = hitWindow(g, p);
      var wait = w.t > 0 && w.t <= Math.min(C.ASSIST, g.hitBuf) && w.reach;
      if (!wait) {
        if (g.mode === 'serve') doServe(g, p, aim, -w.t, null);
        else hit(g, p, aim, -w.t, g.swingShot);
        return;
      }
    } else if (g.mode === 'rally' && !g.swingShot && canDive(g, p)) {
      w = hitWindow(g, p);
      if (!w.reach || b.z < 0.6) { dive(g, p, aim, -w.t); return; }
    }
    if (g.hitBuf <= 0) { // el gesto termina sin contacto
      w = hitWindow(g, p);
      var near = Math.hypot(b.x - p.x, b.y - p.y) < 3.2;
      if (near && (g.mode === 'rally' || g.mode === 'serve')) {
        if (g.stats) g.stats.misses++;
        emit(g, { type: 'miss', player: p, reason: w.t > 0 ? 'early' : (w.reach ? 'late' : 'far'), t2: w.t });
      }
      endSwing(g); g.swingLock = C.SWING_LOCK;
    }
  }

  /** Asistencia de movimiento: cerca del punto de contacto, el jugador humano se
   *  "imanta" suavemente y frena al llegar (la colocación gruesa sigue siendo suya). */
  var _mv = [0, 0];
  function assistMove(g, p, mx, my) {
    _mv[0] = mx; _mv[1] = my;
    if (g.jobs[0] !== p || p.z > 0 || p.down > 0) return _mv;
    var sd = side(p.team), tx, ty;
    if (g.touchTeam === 0 && g.touches === 2 && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) { tx = g.pr3.x + sd * 0.35; ty = g.pr3.y; }
    else { tx = g.pr1.x + sd * 0.15; ty = g.pr1.y; }
    var dx = tx - p.x, dy = ty - p.y, dl = Math.hypot(dx, dy), il = Math.hypot(mx, my);
    if (dl > 1.8 || dl < 0.03) return _mv;
    var dot = il > 0.05 ? (mx * dx + my * dy) / (il * dl) : 1;
    if (dot < -0.3) return _mv; // el jugador quiere ir a otro sitio: no se le lleva
    var s = 0.5 * Math.min(1, dl / 0.6);
    if (il > 0.2 && dl < 0.45 && dot > 0.5) { mx *= dl / 0.45; my *= dl / 0.45; } // frena al llegar
    mx += dx / dl * s; my += dy / dl * s;
    var l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    _mv[0] = mx; _mv[1] = my; return _mv;
  }

  // ---------- Flujo del partido ----------
  function setupServe(g) {
    g.mode = 'serve';
    var t = g.serving, sd = side(t), sv = g.teams[t][g.serverIdx[t]], mate = other(g, sv), b = g.ball;
    sv.x = sd * 10.3; sv.y = g.serverIdx[t] ? 1.5 : -1.5; mate.x = sd * 3.5; mate.y = -sv.y * 1.3;
    for (var i = 0; i < 2; i++) { var q = g.teams[1 - t][i]; q.x = -sd * 6.5; q.y = i ? 2.2 : -2.2; }
    for (var j = 0; j < 4; j++) {
      var p = g.players[j]; p.z = 0; p.vz = 0; p.vx = 0; p.vy = 0; p.anim = 0; p.bd = 0; p.bdT = 0.05 + g.rng() * 0.15;
      p.onGround = true; p.lastAction = ''; p.actionT = 99; p.jvx = p.jvy = p.lvx = p.lvy = 0; p.down = 0; p.cool = 0;
      p.shot = ''; p.aiTeT = -1;
    }
    g.server = sv; g.serveState = 'ready'; g.serveJump = false; g.serveClock = C.SERVE_CLOCK; g.serveT = 0; g.tossT = 0;
    b.held = sv; b.vx = b.vy = b.vz = 0; b.dip = 0; b.wobA = 0;
    g.touchTeam = -1; g.touches = 0; g.lastPlayer = null; g.lastTeam = t; g.jobs[0] = g.jobs[1] = null; g.lastKind = ''; g.lastShot = '';
    g.timer = g.demo ? 0.9 : 1.3; g.hardIn = false; g.digOk = true;
    var prevCtrl = g.ctrl;
    g.ctrl = t === 0 ? sv : g.teams[0][0]; endSwing(g); g.swingLock = 0;
    g.rally.t = 0; g.rally.hits = 0;
    // ¿Punto de set / punto de partido?
    var tgt = g.setNo === 3 ? 15 : 25;
    g.setPoint = -1; g.matchPoint = -1;
    for (var k = 0; k < 2; k++) {
      if (g.score[k] >= tgt - 1 && g.score[k] - g.score[1 - k] >= 1) { g.setPoint = k; if (g.sets[k] === 1) g.matchPoint = k; }
    }
    if (prevCtrl !== g.ctrl) emit(g, { type: 'switch', from: prevCtrl, to: g.ctrl, auto: true, reset: true });
    emit(g, { type: 'serveReady', team: t, player: sv, setPoint: g.setPoint, matchPoint: g.matchPoint });
    // el silbato de autorización llega un instante después (stepServe); desde él corren los 8 s
    g.serveAuth = false; g.whistleAt = g.demo ? 0.35 : 0.7;
  }

  /** Lanza el balón para sacar. jumpServe: toss alto y adelantado + carrera y salto automáticos. */
  function toss(g, sv, jumpServe) {
    var b = g.ball, sd = side(sv.team);
    b.held = null; g.serveState = 'toss'; g.serveJump = !!jumpServe; g.tossT = 0;
    b.x = sv.x - sd * 0.25; b.y = sv.y; b.z = sv.z + 1.95;
    if (jumpServe) {
      var apex = 4.6, vz0 = Math.sqrt(2 * C.G * (apex - b.z));
      var hz = C.ZC.jserve + C.JUMP_V * C.JUMP_V / (2 * C.G);           // mano en lo alto del salto
      var tb = (vz0 + Math.sqrt(Math.max(0, vz0 * vz0 - 2 * C.G * (hz - b.z)))) / C.G;
      g.jumpAt = tb - C.JUMP_V / C.G - 0.02;                               // despegue para coincidir
      b.vz = vz0; b.vx = -sd * 1.05 / tb; b.vy = 0;
    } else {
      b.vz = Math.sqrt(2 * C.G * (3.0 - b.z)); b.vx = -sd * 0.12; b.vy = 0;
      g.jumpAt = 0;
    }
    g.lastTouchT = g.time;
    sv.lastAction = 'toss'; sv.actionT = 0; sv.anim = 0.3;
    if (!isHuman(g, sv)) { var pr = g.prof[sv.team]; g.aiServeTe = clamp(gauss(g) * pr.timing * 0.9, -0.25, 0.25); }
    emit(g, { type: 'toss', player: sv, team: sv.team, jump: g.serveJump, human: isHuman(g, sv) });
  }

  function doServe(g, sv, aim, te, tgt) {
    var sd = side(sv.team), b = g.ball, prof = g.prof[sv.team], human = isHuman(g, sv);
    b.held = null;
    te = te || 0;
    var q = timingQ(te), grade = gradeOf(q), mul = human ? 1 : prof.err, v, power, er, tx, ty;
    if (tgt) { tx = tgt[0]; ty = tgt[1]; }
    else {
      tx = -sd * 6; ty = 0;
      if (aim) { tx += aim[0] * 2.4; ty += aim[1] * 3.4; }
      tx = -sd * clamp(-sd * tx, 2, 8.4); ty = clamp(ty, -4, 4);
    }
    if (g.serveJump) { // saque en salto: potente y con liftado
      var spd = human ? 12.5 + 5 * q : prof.jserve * (0.86 + 0.14 * q);
      er = (0.3 + 1.5 * (1 - q)) * mul; power = clamp((spd - 10) / 8, 0, 1);
      b.dip = C.G * (0.12 + 0.25 * q);
      v = launchDirect(b, tx + rnd(g, er), ty + rnd(g, er), 0, spd, C.G + b.dip);
      if (q < 0.45 && g.rng() < (0.5 - q) * 0.7) v[2] -= 1.1 + g.rng() * 0.8; // a la red
      b.wobA = 0;
    } else { // flotante: más lento, pero baila
      er = (0.3 + 1.3 * (1 - q)) * mul; power = 0.25 + 0.2 * q;
      var ap = Math.max(b.z + 0.35, 3.25 + (1 - q) * 0.4);
      if (q < 0.45 && g.rng() < (0.5 - q) * 0.6) v = launchApex(b, tx + rnd(g, er), ty + rnd(g, er), 0, 2.75);
      else v = launchSafe(b, tx + rnd(g, er), ty + rnd(g, er), 0, ap);
      b.dip = 0; b.wobA = 2 + 4.2 * q; b.wobF = 3.6 + g.rng() * 2; b.wobP = g.rng() < 0.5 ? -1 : 1; // wobP = sentido
    }
    if (!human && g.rng() < prof.srvErr) { // error de saque de la IA: a la red o largo
      if (g.rng() < 0.55) { v = launchApex(b, -sd * 3, b.y + rnd(g, 2), 0, 2.6); }
      else v = g.serveJump ? launchDirect(b, -sd * (9.6 + g.rng()), ty + rnd(g, 1.5), 0, b.speed || 15) : launchSafe(b, -sd * (9.7 + g.rng()), ty + rnd(g, 1.5), 0, 3.4);
      b.dip = 0; b.wobA = 0;
    }
    b.vx = v[0]; b.vy = v[1]; b.vz = v[2];
    b.speed = Math.hypot(v[0], v[1], v[2]);
    sv.anim = 0.35; sv.lastAction = 'serve'; sv.actionT = 0; sv.shot = g.serveJump ? 'jump' : 'float'; sv.grade = grade;
    g.lastKind = 'serve'; g.lastShot = sv.shot; g.mode = 'rally'; g.touchTeam = sv.team; g.touches = 3; g.lastPlayer = sv; g.lastTeam = sv.team;
    g.lastTouchT = g.time; g.hardIn = b.speed > 13; g.netSince = false;
    var rp = g.prof[1 - sv.team];
    g.digOk = g.hardIn ? g.rng() < rp.recv * (1.1 - 0.35 * power) : true;
    if (human) g.lastGrade = grade;
    if (g.stats) { g.stats.hits.serve++; g.stats.grades[grade]++; if (human) g.stats.hgrades[grade]++; g.stats.shots[sv.shot] = (g.stats.shots[sv.shot] || 0) + 1; }
    emit(g, { type: 'hit', kind: 'serve', player: sv, team: sv.team, touch: 0, quality: q, grade: grade, timing: te,
      power: power, shot: sv.shot, dive: false, aim: aim ? [aim[0], aim[1]] : null, target: [tx, ty],
      x: b.x, y: b.y, z: b.z, speed: b.speed, human: human });
    endSwing(g);
  }

  function stepServe(g, dt, input, mx, my, aim, human) {
    var sv = g.server, b = g.ball, sd = side(sv.team), i, p;
    var hs = human && sv.team === 0; // saca el humano
    g.serveT += dt;
    if (!g.serveAuth && g.serveT >= g.whistleAt) { g.serveAuth = true; emit(g, { type: 'whistle', reason: 'serve' }); } // autorización del saque
    if (g.serveState === 'ready') {
      if (hs) {
        // El sacador humano se desplaza a lo ancho de la zona de saque
        stepPlayer(g, sv, dt, 0, my * 0.8); sv.y = clamp(sv.y, -4.3, 4.3);
        if (g.serveAuth) { if (input.jump) toss(g, sv, true); else if (input.hit) toss(g, sv, false); }
        if (g.serveState === 'ready' && g.serveAuth && g.opts.serveClock !== false) {
          g.serveClock -= dt;
          if (g.serveClock <= 0) { g.serveClock = 0; fault(g, sv.team, 'serve', 'Falta de saque: 8 segundos', sv); return; }
        }
      } else {
        stepPlayer(g, sv, dt, 0, 0);
        g.timer -= dt; if (g.timer <= 0 && g.serveAuth) toss(g, sv, g.rng() < g.prof[sv.team].jumpServe);
      }
    } else { // balón en el aire
      g.tossT += dt;
      if (g.serveJump && sv.z === 0 && sv.vz === 0 && g.tossT < g.jumpAt + 0.05) {
        // carrera de saque en salto (automática): 2 pasos hacia la red, despegue detrás de la línea
        var run = g.tossT > 0.2 ? 0.75 / Math.max(0.2, g.jumpAt - 0.2) / C.SPEED : 0;
        stepPlayer(g, sv, dt, -sd * run, 0);
        if (g.tossT >= g.jumpAt) jump(g, sv, -sd * 0.55, 0);
      } else stepPlayer(g, sv, dt, 0, 0);
      if (hs) {
        if (input.jump && !g.serveJump) jump(g, sv, 0, 0); // salto con toss bajo: flotante en salto
        if (input.hit) startSwing(g, sv, '');
        processSwing(g, sv, aim);
        if (g.mode === 'serve' && g.hitBuf <= 0 && g.swingLive) { endSwing(g); g.swingLock = C.SWING_LOCK; }
      } else if (canReach(g, sv)) {
        var w = hitWindow(g, sv);
        if (w.t <= -g.aiServeTe || !w.reach || b.vz < -6) doServe(g, sv, null, -w.t, VB.AI && VB.AI.serveTarget ? VB.AI.serveTarget(g, sv) : null);
      }
      if (g.mode === 'serve' && b.vz < 0 && b.z < sv.z + 1.0) { // el balón cae sin golpearlo
        fault(g, sv.team, 'serve', 'Falta de saque: el balón cae sin golpearlo', sv); return;
      }
    }
    for (i = 0; i < 4; i++) { p = g.players[i]; if (p !== sv) stepPlayer(g, p, dt, 0, 0); }
    stepBall(g, dt);
  }

  function nextSet(g) {
    g.pendingSet = false; g.setNo++; g.score = [0, 0]; g.serving = (g.setNo - 1) % 2;
    g.serverIdx = g.serving === 0 ? [0, 1] : [1, 0];
    emit(g, { type: 'newSet', setNo: g.setNo });
  }
  function newGame(g) {
    g.score = [0, 0]; g.sets = [0, 0]; g.setNo = 1; g.serving = 0; g.serverIdx = [0, 1]; g.setScores = [];
    g.pendingSet = false; g.finished = false; g.lastPoint = null;
    emit(g, { type: 'newMatch', demo: g.demo, difficulty: g.difficulty });
    setupServe(g);
  }

  function dirLen(m) { return m ? Math.hypot(m[0], m[1]) : 0; }
  var NOIN = { move: [0, 0], hit: false, jump: false, switchPlayer: false };
  var _aim = [0, 0];

  /** Avanza la simulación dt segundos (paso fijo recomendado 1/120).
   *  input (mundo, solo equipo humano): {move:[wx,wy] (|v|<=1), hit, jump, switchPlayer}
   *  hit/jump/switchPlayer = "pulsado en este paso" (flanco).
   *  - Saque: mover = desplazarse a lo ancho; GOLPEAR = lanzar flotante, SALTAR = lanzar
   *    para saque en salto; luego GOLPEAR en el momento justo (dirección = apuntar).
   *  - Peloteo: GOLPEAR = toque (el juego decide recepción/colocación/remate);
   *    SALTAR en el suelo = salto (remate/bloqueo); SALTAR en el aire = dejada. */
  function step(g, dt, input) {
    input = input || NOIN;
    var AI = VB.AI, b = g.ball;
    g.time += dt; g.blockCD -= dt; g.hitBuf -= dt; g.swingLock -= dt;
    var human = !g.demo && !g.autopilot;
    var mv = input.move || NOIN.move, ml = dirLen(mv);
    var mx = mv[0], my = mv[1];
    if (ml > 1) { mx /= ml; my /= ml; ml = 1; }
    var aim = null;
    if (ml > 0.2) { _aim[0] = mx / ml; _aim[1] = my / ml; aim = _aim; }
    var i, p;

    if (g.mode === 'point' || g.mode === 'over') {
      for (i = 0; i < 4; i++) stepPlayer(g, g.players[i], dt, 0, 0);
      stepBall(g, dt); g.timer -= dt;
      if (g.timer <= 0) {
        if (g.mode === 'over') {
          if (g.demo) { newGame(g); }
          else if (!g.finished) { g.finished = true; emit(g, { type: 'gameOver', team: g.sets[0] > g.sets[1] ? 0 : 1, sets: [g.sets[0], g.sets[1]], setScores: g.setScores.slice() }); }
        } else { if (g.pendingSet) nextSet(g); setupServe(g); }
      }
      return;
    }
    if (g.mode === 'serve') { stepServe(g, dt, input, mx, my, aim, human); return; }
    // ---- Peloteo ----
    g.rally.t += dt;
    predict(g, 1, g.pr1); predict(g, 3, g.pr3);
    g.jobs[0] = AI.computeJob(g, 0); g.jobs[1] = AI.computeJob(g, 1);
    var hp = null;
    if (!g.demo) {
      // el control pasa solo al que le toca jugar el siguiente toque
      if (g.jobs[0] && g.jobs[0] !== g.ctrl) { emit(g, { type: 'switch', from: g.ctrl, to: g.jobs[0], auto: true }); g.ctrl = g.jobs[0]; endSwing(g); }
      else if (!g.jobs[0] && input.switchPlayer && human) { var o2 = other(g, g.ctrl); emit(g, { type: 'switch', from: g.ctrl, to: o2, auto: false }); g.ctrl = o2; endSwing(g); }
    }
    if (human) {
      hp = g.ctrl;
      if (input.jump) {
        if (hp.z === 0 && hp.vz === 0) jump(g, hp);
        else if (hp.z > 0.2 && hp.actionT > 0.12 && Math.hypot(b.x - hp.x, b.y - hp.y) < 3) startSwing(g, hp, 'tip'); // en el aire: dejada
      }
      if (hp.z > 0) stepPlayer(g, hp, dt, 0, 0);
      else { var am = assistMove(g, hp, mx, my); stepPlayer(g, hp, dt, am[0], am[1]); }
      if (input.hit && g.mode === 'rally') startSwing(g, hp, '');
      if (g.mode === 'rally') processSwing(g, hp, aim);
    }
    for (i = 0; i < 4; i++) { p = g.players[i]; if (p !== hp && g.mode === 'rally') AI.update(g, p, dt); }
    for (i = 0; i < 2 && g.mode === 'rally'; i++) stepBall(g, dt / 2);
  }

  /** Vacía y devuelve la cola de eventos (main.js lo hace una vez por frame). */
  function drainEvents(g, out) {
    out = out || [];
    for (var i = 0; i < g.events.length; i++) out.push(g.events[i]);
    g.events.length = 0; return out;
  }

  /** Objetivo útil para el HUD/aro: dónde jugará el balón el equipo humano. */
  function focusPoint(g) {
    return (g.touchTeam === 0 && g.touches === 2) ? g.pr3 : g.pr1;
  }

  VB.Sim = {
    createGame: createGame, step: step, drainEvents: drainEvents,
    predict: predict, predictLanding: predictLanding, focusPoint: focusPoint,
    canReach: canReach, other: other, isHuman: isHuman, side: side, clamp: clamp,
    // añadidos (opcionales)
    hitWindow: hitWindow, predictKind: predictKind, canDive: canDive, timingQ: timingQ, gradeOf: gradeOf,
    normDiff: normDiff, DIFF: DIFF,
    // internos expuestos para la IA y los tests
    _hit: hit, _jump: jump, _dive: dive, _stepPlayer: stepPlayer, _emit: emit, _rnd: rnd, _gauss: gauss,
    _setupServe: setupServe, _newGame: newGame, _makeRng: makeRng, _toss: toss, _doServe: doServe, _fault: fault
  };
})();
