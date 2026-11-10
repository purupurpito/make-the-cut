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
 *   Pulsar GOLPEAR abre un "gesto" de g.tm.swing s (VB.TIMING según el nivel). El contacto ocurre cuando el
 *   balón está al alcance; si el momento ideal (balón a la altura de contacto
 *   de ese toque) llega en menos de g.tm.assist s, el gesto lo espera. La calidad
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
    IN_TOL: 0.03,    // "dentro": el centro del balón cae como mucho 3 cm fuera del borde exterior de la línea
                     // (huella de contacto del balón real; el balón se dibuja más grande por legibilidad)
    SWING: 0.30,     // duración del gesto de golpeo (ventana de contacto tras pulsar)
    WINDUP: 0.07,    // armado del brazo: lo ideal es PULSAR esto antes del contacto ideal (te = pulsación + WINDUP - ideal)
    ASSIST: 0.16,    // el gesto espera al momento ideal si llega antes de esto (el contacto se ve en su sitio)
    W_PERFECT: 0.035,// |desfase| máximo para 'perfect' (s)
    W_GOOD: 0.10,    // |desfase| máximo para 'good' (s)
    SWING_LOCK: 0.12,// bloqueo tras un gesto fallido (evita aporrear el botón)
    NET_TOUCH: 0.30, // un jugador en el aire a menos de esto de la red la toca
    SERVE_CLOCK: 8,  // regla de los 8 segundos para sacar
    // altura ideal de contacto sobre los pies del jugador, por tipo de toque
    ZC: { pass: 0.85, set: 2.2, free: 1.5, spike: 2.45, fserve: 2.55, jserve: 2.45 },
    // balón en la mano del sacador antes del lanzamiento: a la altura del pecho, delante del cuerpo
    // (hacia la red) y desplazado hacia la mano que NO golpea (izquierda; el golpeo es con la derecha)
    HOLD_Z: 1.28, HOLD_FWD: 0.35, HOLD_SIDE: 0.16
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
  /* Escalera de 4 niveles (revisión 2): el salto Fácil -> Normal era demasiado grande para un jugador real en
   * tercera persona. 'normal' es ahora un nivel intermedio; el Normal anterior pasa a 'hard' (Difícil) y el
   * Difícil anterior a 'expert' (Experto). */
  var DIFF = VB.DIFF = {
    easy:   { name: 'Fácil',   react: 0.30, speed: 0.82, timing: 0.11,  err: 1.35, block: 0.12, dig: 0.27, recv: 0.72, spike: 13.5, jserve: 12.0, jumpServe: 0.00, tip: 0.04, aimNoise: 4.0, netErr: 0.06,  blockReact: 0.18, atkErr: 0.11, srvErr: 0.12, seam: 0.00, srvNoise: 1.6, float: 0.75 },
    normal: { name: 'Normal',  react: 0.18, speed: 0.90, timing: 0.07, err: 1.1,  block: 0.30, dig: 0.42, recv: 0.83, spike: 15.4, jserve: 14.0, jumpServe: 0.08, tip: 0.08, aimNoise: 1.9, netErr: 0.03, blockReact: 0.10, atkErr: 0.105, srvErr: 0.12, seam: 0.08, srvNoise: 1.4, float: 0.76 },
    hard:   { name: 'Difícil', react: 0.13, speed: 0.94, timing: 0.05,  err: 0.9,  block: 0.40, dig: 0.48, recv: 0.89, spike: 16.2, jserve: 15.6, jumpServe: 0.18, tip: 0.12, aimNoise: 1.1, netErr: 0.018, blockReact: 0.065, atkErr: 0.09, srvErr: 0.10, seam: 0.18, srvNoise: 1.2, float: 0.8 },
    expert: { name: 'Experto', react: 0.06, speed: 1.00, timing: 0.028, err: 0.55, block: 0.55, dig: 0.61, recv: 0.95, spike: 19.0, jserve: 18.0, jumpServe: 0.70, tip: 0.15, aimNoise: 0.4, netErr: 0.005, blockReact: 0.04, atkErr: 0.05, srvErr: 0.07, seam: 0.75, srvNoise: 0.6, float: 1.0 },
    // demo del menú (CPU vs CPU), perfil propio (R6). Antes era el Difícil de la revisión 2 congelado (dig 0,51,
    // block 0,42, tip 0,12, atkErr 0,08, spike 16,6), valores afinados con el modelo de defensa de la revisión 1. La
    // revisión 2 (bloqueo geométrico con 'touch'/'soft' jugables, contacto con el cuerpo) alarga la defensa CPU vs CPU:
    // con esos valores la demo bajó de 48 % a 43 % de remates punto y quedó en el filo entre peloteos de 1 y 2 ataques
    // (mediana 5 u 8 s según la semilla). Solo la demo: defensa base 0,37, remate 17,4 m/s, más bloqueo directo (0,58),
    // más error de ataque (0,15) y pocas dejadas (0,04; se defienden siempre). Medido (105 semillas × 20 min):
    // mediana 5,0 s, 52 % de remates punto, 5,7 puntos/min. Ver notes/sim.md §R6.
    demo:   { name: 'Demo',    react: 0.12, speed: 0.95, timing: 0.045, err: 0.85, block: 0.58, dig: 0.37, recv: 0.90, spike: 17.4, jserve: 16.0, jumpServe: 0.20, tip: 0.04, aimNoise: 1.0, netErr: 0.015, blockReact: 0.06, atkErr: 0.15, srvErr: 0.10, seam: 0.2, srvNoise: 1.2, float: 0.8 },
    // compañero IA del humano (y equipo 0 en autopilot): nivel fijo, el peso del partido lo lleva el humano
    mate:   { name: 'Compañero', react: 0.16, speed: 0.92, timing: 0.065, err: 1.0, block: 0.30, dig: 0.56, recv: 0.85, spike: 16.0, jserve: 14.5, jumpServe: 0.35, tip: 0.10, aimNoise: 1.6, netErr: 0.02, blockReact: 0.09, atkErr: 0.05, srvErr: 0.08, seam: 0.4, srvNoise: 1.0, float: 1.0 }
  };
  /*  seam: prob. de sacar a la zona libre (entre receptores)   srvNoise: ruido del destino del saque (m)
   *  float: multiplicador del baile del saque flotante */

  var DIFF_ALIAS = { facil: 'easy', 'fácil': 'easy', easy: 'easy', normal: 'normal', medio: 'normal', dificil: 'hard', 'difícil': 'hard', hard: 'hard',
    experto: 'expert', expert: 'expert' };
  function normDiff(d) { return DIFF_ALIAS[String(d || 'normal').toLowerCase()] || 'normal'; }
  /** Orden de los niveles (para menús: VB.DIFF_ORDER.map(k => VB.DIFF[k].name)). */
  VB.DIFF_ORDER = ['easy', 'normal', 'hard', 'expert'];

  /* Ayuda de timing del humano según el nivel (revisión 2): en Fácil (y en el primer partido) una pulsación
   * algo pronta sigue haciendo contacto. La NOTA del toque es honesta en todos los niveles (sale del desfase
   * real con el momento ideal: perfect/good/poor); lo que cambia es cuánto espera el gesto y cuánto dura.
   *   assist: el gesto espera al momento ideal si llega antes de esto (s)
   *   swing:  duración del gesto (ventana de contacto tras pulsar)      lock: bloqueo tras un gesto fallido */
  var TIMING = VB.TIMING = {
    easy:   { assist: 0.28, swing: 0.42, lock: 0.06 },
    normal: { assist: 0.22, swing: 0.36, lock: 0.09 },
    hard:   { assist: 0.16, swing: 0.30, lock: 0.12 },
    expert: { assist: 0.14, swing: 0.27, lock: 0.14 }
  };

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
    return dblFields({
      id: team * 2 + idx, team: team, idx: idx, num: num,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, // vx,vy = velocidad real del último paso (para animación)
      anim: 0,        // >0 mientras dura un gesto de golpeo/brazos arriba (s)
      cool: 0,        // enfriamiento tras tocar
      st: null, prof: null, ak: null, // atributos 1-99, perfil de IA y multiplicadores (applyAttrs; null = perfil del equipo)
      badges: null,   // insignias equipadas {id: nivel 1-3} (applyBadges; null = ninguna)
      bd: 0, bdT: 0.1,// temporizador de salto al bloqueo (IA)
      jvx: 0, jvy: 0, // deriva horizontal en el aire (impulso del despegue)
      lvx: 0, lvy: 0, // impulso de la plancha
      down: 0,        // >0 = en el suelo tras una plancha (s): no se puede mover
      shot: '',       // subtipo del último toque ('tip', 'dive', 'jump', 'float', ...)
      grade: '',      // calidad del último toque ('perfect'|'good'|'poor')
      aiTe: 0, aiTeT: -1, aiJt: 0, aiDv: 0, // desfases de la IA (muestreados por toque)
      lastAction: '', // 'pass'|'set'|'spike'|'free'|'serve'|'block'|'swing'|'jump'|'toss'|'dive'
      actionT: 99,    // segundos desde lastAction
      onGround: true
    });
  }

  /** Crea un partido nuevo.
   *  opts: { demo:bool (CPU vs CPU), autopilot:bool (equipo humano lo lleva la IA
   *          pero la cámara/HUD son de partido), seed:int,
   *          difficulty:'easy'|'normal'|'hard' (también 'facil','dificil'): nivel de la CPU,
   *          serveClock:bool (regla de 8 s para el saque humano, por defecto true),
   *          ctrl:'both'|'one' (controlar a los dos jugadores o solo a uno; g.ctrlMode, por defecto 'both'),
   *          ctrlIdx:0|1 (modo 'one': a quién lleva el humano, 0 = teams[0][0] dorsal 1, 1 = teams[0][1] dorsal 2; g.ctrlIdx;
   *          el juego ya solo usa 0, el 1 queda para pruebas y &ctrlidx=),
   *          stats:bool } */
  /** Puntos por set que se pueden elegir (Partido rápido). */
  var SET_POINTS = [11, 15, 21, 25];
  /** Puntos para ganar el set en curso: g.points, y el set decisivo (3.º) a min(15, g.points). */
  function setTarget(g) { var p = g.points || 25; return g.setNo === 3 ? Math.min(15, p) : p; }
  function createGame(opts) {
    opts = opts || {};
    var teams = [[mkPlayer(0, 1, 0), mkPlayer(0, 2, 1)], [mkPlayer(1, 3, 0), mkPlayer(1, 9, 1)]];
    // dorsales propios (Carrera): opts.nums = [[n1, n2], [n3, n9]] (cada hueco o equipo puede ser null = el de siempre). Solo cambia p.num.
    if (opts.nums) for (var nt = 0; nt < 2; nt++) for (var ni = 0; ni < 2; ni++) {
      var nv = opts.nums[nt] && opts.nums[nt][ni];
      if (nv === (nv | 0) && nv >= 1 && nv <= 99) teams[nt][ni].num = nv;
    }
    var diff = normDiff(opts.difficulty);
    var seed = opts.seed != null ? opts.seed : (Date.now() & 0x7fffffff);
    var g = {
      opts: opts,
      demo: !!opts.demo,
      autopilot: !!opts.autopilot,
      // control del humano: 'both' = el control pasa a quien da el siguiente toque; 'one' = siempre el mismo jugador
      // (teams[0][ctrlIdx]) y la IA lleva al compañero en todo, saque incluido
      ctrlMode: opts.ctrl === 'one' ? 'one' : 'both',
      // modo 'one': jugador del humano (0 = dorsal 1, 1 = dorsal 2); en 'both' siempre 0 (el control empieza en teams[0][0])
      ctrlIdx: opts.ctrl === 'one' && +opts.ctrlIdx === 1 ? 1 : 0,
      difficulty: diff,
      // demo del menú: CPU vs CPU con el perfil DIFF.demo (peloteos vistosos con ritmo de partido real, ver R6)
      prof: opts.demo ? [DIFF.demo, DIFF.demo] : [DIFF.mate, rookieProf(DIFF[diff], opts.rookie && (diff === 'easy' || diff === 'normal'), diff)], // equipo 0: compañero IA de nivel fijo
      // ayuda de timing del humano (VB.TIMING): el primer partido usa la de Fácil
      tm: opts.demo ? TIMING.hard : (opts.rookie && (diff === 'easy' || diff === 'normal') ? TIMING.easy : TIMING[diff]),
      defRole: '',             // rol del humano mientras ataca la CPU: '' | 'dig' (defiende) | 'block' (bloquea) — ver updateDefense
      recvRisk: 0,             // dificultad (0..1+) del último saque para el receptor (ver serveRisk)
      courtSwap3: false,       // ya se cambió de campo a mitad del set decisivo (a los 8 si va a 15)
      // puntos por set (Partido rápido: 11 | 15 | 21 | 25); el set decisivo va a min(15, points). Ver setTarget
      points: SET_POINTS.indexOf(+opts.points) >= 0 ? +opts.points : 25,
      antennaHit: null,        // {x,y,z} donde el balón tocó la antena en este punto (null si no)
      atkServe: null,          // {team, player}: toque por encima de la red sobre el saque rival en zona de ataque; es falta
                               // (13.3.4) solo si se COMPLETA como ataque: el balón cruza la red o lo toca el rival
      aimIn: [0, 0], aimOn: false, // dirección de apuntado de la entrada del último paso (mundo, normalizada)
      rng: makeRng(seed),
      seed: seed | 0,          // semilla del partido (la presentación determinista la usa sin gastar g.rng: ritual SIM-04)
      serveNo: 0,              // saques puestos en este partido (cuenta serveReady)
      // ritual del sacador CPU (SIM-04), objeto persistente: on, phase ('none'|'wait'|'pre'|'dribble'|'post'|'done'), t (s desde
      // el silbato), dur (s silbato -> lanzamiento), bounces, n (botes hechos), u (0..1 del bote en curso), player, rx/ry
      // (punto del bote), cyc/td/tu (periodo, bajada, subida), v0/vu/vc/vi (empujón, subida, recogida, contra el suelo), press
      ritual: dblFields({ on: false, phase: 'none', t: 0.5, dur: 0.5, bounces: 0, n: 0, u: 0.5, player: null, rx: 0.5, ry: 0.5,
        pre: 0.5, post: 0.5, still: 0.5, cyc: 0.5, td: 0.5, tu: 0.5, v0: 0.5, vu: 0.5, vc: 0.5, vi: 0.5, press: false }),
      cpuTossIn: -1,           // s de juego hasta el lanzamiento programado de la CPU (0 = ya lanzado; -1 = humano / sin saque)
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
      ctrl: teams[0][opts.ctrl === 'one' && +opts.ctrlIdx === 1 ? 1 : 0], // jugador que controla el humano (g.ctrlIdx)
      jobs: [null, null],      // quién de cada equipo va al balón
      pr1: { x: 0, y: 0, z: 0, t: 0 }, pr3: { x: 0, y: 0, z: 0, t: 0 }, // predicciones de cruce a 1 m y 3 m
      blockOff: [0, 0], timer: 0, blockCD: 0,
      hitBuf: 0,               // > 0 mientras dura el gesto de golpeo del humano (s)
      jsetQ: 0,                // > 0: COLOCAR pulsado justo al despegar, pendiente de lanzarse en cuanto se pueda (s)
      swingLive: false, swingShot: '', swingLock: 0,
      swingAim: [0, 0], swingHasAim: false, // dirección dada durante el gesto (vale aunque se suelte antes del contacto)
      lastGrade: '',           // calidad del último toque humano
      pendingSet: false, digOk: true, hardIn: false, finished: false,
      swingT0: 0,              // g.time de la pulsación que abrió el gesto humano en curso
      prevKind: '',            // tipo del toque anterior al último
      atkTeam: -1, atkHow: '', atkHits: 0, // último ataque/saque (para atribuir kill/ace aunque el rival lo toque y no lo salve)
      atkSet: null,            // colocador (2.º toque del mismo equipo) del último ataque, o null (point.assist)
      jobMem: [null, null], jobMemT: [-1, -1], jobSwT: [-9, -9], jobHop: [-1, -1], // IA: memoria de quién va al balón (histéresis)
      digMargin: 0,            // margen de defensa (s) del último remate (>0 el defensor llega con tiempo; <0 al hueco)
      lastPoint: null,         // {team, reason, text, how, highlight, digs, streak, savedSetPoint, clutch, signal, touchedOut, landSide, hold, setWon, matchWon}
      setPoint: -1, matchPoint: -1, // equipo con punto de set/partido en el saque actual (-1 nadie)
      rally: { t: 0, hits: 0, digs: 0 },// duración, toques y defensas de remate (SIM-01) del rally en curso
      // presentación (SIM-03): g.present = true (main.js, partidos humanos) alarga la pausa de los puntos grandes;
      // hold = duración (s) de la pausa del punto en curso (point.hold), para skipHold
      present: !!opts.present, hold: 0,
      streakTeam: -1, streakN: 0, // racha de puntos seguidos en el set (SIM-01)
      atkHuman: false, atkGrade: '', // quién/cómo fue el último ataque o saque (para 'kill perfecto del humano')
      // remate apuntado (A1-A3): mira libre del humano en el aire en el 3.er toque; defensa más justa tras remate perfecto
      // saque dirigible: la misma diana con kind 'serve' mientras saca el humano (serveAimReset / updateServeAim)
      aim3: dblFields({ on: false, x: 0.5, y: 0.5, kind: '' }), digTight: false,
      // error arbitral + challenge (B1-B3): llamada del último bote, challenges por set, revisión en curso, petición de la CPU
      // opts.ref (Carrera, error arbitral por competición): {p1, p2, p3, d1?, d2?, d3?, chal} sobre VB.REF_ERR / CHAL.perSet
      refErr: refOf(opts.ref), chalPerSet: chalOf(opts.ref),
      call: null, challenges: [2, 2], review: null, cpuChal: null, _pendCall: null, _snap: null,
      events: [],              // cola de eventos del paso (main.js la vacía cada frame)
      stats: opts.stats ? {
        hits: { pass: 0, set: 0, spike: 0, free: 0, serve: 0 }, blocks: 0, points: 0, why: {}, rallies: [],
        grades: { perfect: 0, good: 0, poor: 0 }, hgrades: { perfect: 0, good: 0, poor: 0 }, shots: {},
        won: [0, 0], misses: 0, dives: 0, diveMiss: 0, blockKinds: { stuff: 0, soft: 0, tool: 0, touch: 0 },
        serves: [0, 0], aces: [0, 0], spikes: [0, 0], kills: [0, 0], stuffPts: [0, 0], faults: {}, body: 0, jsets: 0, courtChanges: 0
      } : null
    };
    dblFields(g); dblFields(g.ball); dblFields(g.pr1); dblFields(g.pr3); dblFields(g.rally);
    applyAttrs(g, opts.attrs);
    applyBadges(g, opts.badges);
    g.server = g.ctrl;
    newGame(g);
    return g;
  }

  /* ---------- Estadísticas de jugador (atributos 1-99, ver notes/diseno-6v6-carrera.md §2) ----------
   * opts.attrs = [[st n.º 1, st n.º 2], [st n.º 3, st n.º 9]] (cualquiera puede faltar). Un jugador sin atributos usa el
   * perfil de su equipo tal cual (g.prof[team]); con atributos, p.prof = statProf(perfil del equipo, st). 50 en todo = neutro
   * (idéntico al perfil base), así que sin opts.attrs la sim no cambia ni gasta azar. Al humano le llegan por p.ak:
   * ventanas de timing por toque, velocidad de remate/saque, dispersión de la diana, salto y carrera. */
  var ATTR_KEYS = VB.ATTR_KEYS = ['jump', 'speed', 'react', 'recv', 'dig', 'set', 'spike', 'ctl', 'block', 'serve'];
  function sAt(st, k) { var v = st && st[k]; return v == null || !isFinite(v) ? 0.5 : clamp((+v - 1) / 98, 0, 1); }
  function statProf(base, st) {
    var o = {}; for (var k in base) o[k] = base[k];
    var f = function (k) { return sAt(st, k); };
    o.speed = base.speed * (0.9 + 0.2 * f('speed'));
    o.react = Math.max(0.03, base.react + 0.10 * (0.5 - f('react')));
    o.blockReact = Math.max(0.02, base.blockReact + 0.06 * (0.5 - f('react')));
    o.timing = base.timing * (1.25 - 0.5 * f('ctl'));
    o.recv = clamp(base.recv + 0.12 * (f('recv') - 0.5), 0.4, 0.98);
    o.dig = clamp(base.dig + 0.2 * (f('dig') - 0.5), 0.1, 0.8);
    o.block = clamp(base.block + 0.25 * (f('block') - 0.5), 0.05, 0.75);
    o.spike = base.spike + 4 * (f('spike') - 0.5);
    o.atkErr = base.atkErr * (1.4 - 0.8 * f('ctl'));
    o.err = base.err * (1.2 - 0.4 * f('set'));
    o.jserve = base.jserve + 3.5 * (f('serve') - 0.5);
    o.srvErr = base.srvErr * (1.4 - 0.8 * f('serve'));
    o.jumpServe = clamp(base.jumpServe + 0.5 * (f('serve') - 0.5), 0, 0.9);
    return o;
  }
  /** Multiplicadores del humano (y de la física de todos) a partir de los atributos; 50 en todo = 1. */
  function attrK(st) {
    var f = function (k) { return sAt(st, k); }, w = function (k) { return 0.88 + 0.24 * f(k); };
    return { jump: 0.94 + 0.12 * f('jump'), speed: 0.92 + 0.16 * f('speed'), wRecv: w('recv'), wDig: w('dig'), wSet: w('set'),
      wAtk: w('ctl'), wSrv: w('serve'), wBlk: w('block'), spike: 4 * (f('spike') - 0.5), serve: 3 * (f('serve') - 0.5),
      spread: 1.2 - 0.4 * f('ctl'), srvSpread: 1.2 - 0.4 * f('serve') };
  }
  function applyAttrs(g, attrs) {
    if (!attrs || g.demo) return;
    for (var t = 0; t < 2; t++) for (var i = 0; i < 2; i++) {
      var st = attrs[t] && attrs[t][i]; if (!st) continue;
      var p = g.teams[t][i], c = {}; for (var j = 0; j < ATTR_KEYS.length; j++) c[ATTR_KEYS[j]] = clamp(Math.round(+st[ATTR_KEYS[j]] || 50), 1, 99);
      p.st = c; p.prof = statProf(g.prof[t], c); p.ak = attrK(c);
    }
  }
  function profOf(g, p) { return (p && p.prof) || g.prof[p.team]; }

  /* ---------- Insignias (badges) ----------
   * opts.badges = [[b n.º 1, b n.º 2], [b n.º 3, b n.º 9]], cada b = {idInsignia: nivel (1 bronce, 2 plata, 3 oro)} o null.
   * Queda en p.badges ({id: nivel} solo con ids conocidos y nivel 1-3; null si no lleva ninguna). Los efectos valen para el
   * jugador lo lleve el humano o la IA. Tablas por nivel [0, bronce, plata, oro] en VB.BADGE (solo lectura). Sin opts.badges
   * la sim es idéntica: todos los factores valen 1 (o 0 si suman) y solo 'rompemanos' tira un dado extra, y solo si lo lleva
   * el atacante. Ver notes/sim.md, «Insignias». */
  var BADGE_IDS = ['canon', 'mira', 'rompemanos', 'seda', 'bombardero', 'flotador', 'muro', 'ancla', 'red', 'motor', 'sangrefria', 'lider'];
  var BADGE = VB.BADGE = {
    canon: [0, 0.6, 1.2, 1.8],          // remate +m/s
    mira: [1, 0.88, 0.78, 0.68],        // dispersión de la diana del remate (humano)
    miraAI: [1, 0.9, 0.8, 0.7],         // atkErr (IA)
    rompemanos: [0, 0.08, 0.16, 0.24],  // +prob. (absoluta) de block-out si el remate toca el bloqueo
    sedaW: [1, 1.08, 1.16, 1.25],       // ventana de timing del remate siguiente del compañero (humano)
    sedaV: [0, 0.4, 0.8, 1.2],          // +m/s de ese remate
    sedaAI: [1, 0.85, 0.7, 0.55],       // atkErr de ese remate (IA)
    bombardero: [0, 0.7, 1.4, 2.1],     // saque en salto +m/s
    bombarderoAI: [0, 0.1, 0.2, 0.3],   // +prob. de saque en salto (IA)
    flotador: [1, 1.15, 1.3, 1.45],     // baile del flotante
    muroAI: [0, 0.04, 0.08, 0.12],      // +oficio del bloqueo (IA)
    muroQ: [1, 1.08, 1.16, 1.25],       // calidad del contacto del bloqueo (humano)
    anclaW: [1, 1.06, 1.12, 1.18],      // ventana de la recepción del saque (humano)
    anclaAI: [0, 0.02, 0.04, 0.06],     // +recv (IA)
    redR: [1, 1.05, 1.10, 1.15],        // alcance de defensa (1r toque) y de plancha
    redW: [1, 1.05, 1.10, 1.15],        // ventana de la defensa de remate (humano)
    motor: [1, 1.015, 1.03, 1.045],     // velocidad de carrera (peloteo); a la mitad en los arreglos finales (llega sola y era de las más fuertes)
    sangreW: [1, 1.08, 1.16, 1.25],     // con punto de set/partido: todas sus ventanas (humano)
    sangreAI: [1, 0.9, 0.8, 0.7],       // con punto de set/partido: timing (IA)
    liderReact: [0, 0.03, 0.06, 0.09],  // su compañero IA: −reacción (s) (subido en los arreglos finales: el oro casi no se notaba)
    liderT: [1, 0.92, 0.84, 0.76]       // su compañero IA: timing
  };
  function applyBadges(g, badges) {
    if (!badges || g.demo) return;
    for (var t = 0; t < 2; t++) for (var i = 0; i < 2; i++) {
      var b = badges[t] && badges[t][i]; if (!b || typeof b !== 'object') continue;
      var o = null;
      for (var j = 0; j < BADGE_IDS.length; j++) {
        var lv = Math.round(+b[BADGE_IDS[j]] || 0); if (lv < 1) continue;
        (o = o || {})[BADGE_IDS[j]] = lv > 3 ? 3 : lv;
      }
      g.teams[t][i].badges = o;
    }
  }
  /** Nivel (0-3) de la insignia id del jugador p. */
  function bl(p, id) { var b = p && p.badges; return b ? (b[id] | 0) : 0; }
  /** ¿Punto de set o de partido en juego (de cualquiera)? (Sangre fría) */
  function clutchOn(g) { return g.setPoint !== -1 || g.matchPoint !== -1; }
  /** Factor de las ventanas de timing del humano por Sangre fría (1 sin ella o sin punto de set/partido). */
  function sangreW(g, p) { var l = bl(p, 'sangrefria'); return l && clutchOn(g) ? BADGE.sangreW[l] : 1; }
  /** Reacción y timing efectivos de la IA del jugador p (perfil + Líder del compañero + Sangre fría). Sin insignias = perfil. */
  function aiReact(g, p, pr) { var l = bl(other(g, p), 'lider'); return l ? Math.max(0.02, pr.react - BADGE.liderReact[l]) : pr.react; }
  function aiTiming(g, p, pr) {
    var k = 1, l = bl(other(g, p), 'lider'), s = bl(p, 'sangrefria');
    if (l) k *= BADGE.liderT[l];
    if (s && clutchOn(g)) k *= BADGE.sangreAI[s];
    return k === 1 ? pr.timing : pr.timing * k;
  }
  /** Alcance de toque del jugador p: C.REACH, ×Red de seguridad en la defensa (1r toque de su equipo que no es la recepción
   *  del saque; la recepción es cosa de Ancla). La plancha usa (REACH + DIVE) × redR en canDive. */
  function reachOf(g, p) {
    var l = bl(p, 'red');
    return l && g.touchTeam !== p.team && g.lastKind !== 'serve' ? C.REACH * BADGE.redR[l] : C.REACH;
  }

  /** Primer partido (opts.rookie): la CPU saca más suave (sin saque en salto, flotante con menos baile).
   *  En Normal además remata algo más lento y menos fino, defiende y bloquea menos. En Fácil (ya blando de por sí)
   *  solo cambia el saque, que además falla menos: los puntos regalados por saques a la red no enseñan nada.
   *  Medido con el bot 'novato' de simtest (ver notes/sim.md): con los extras de peloteo también en Fácil el novato
   *  ganaba el 51-53 % de los puntos; así, 47-48 % (gana ~1 de cada 3 partidos). */
  function rookieProf(pr, on, diff) {
    if (!on) return pr;
    var o = {}; for (var k in pr) o[k] = pr[k];
    o.jumpServe = 0; o.float = pr.float * 0.6; o.seam = pr.seam * 0.4; o.srvSoft = 0.4; o.name = pr.name;
    if (diff === 'easy') { o.srvErr = pr.srvErr * 0.65; return o; }
    o.spike = pr.spike * 0.9; o.atkErr = pr.atkErr * 1.4; o.aimNoise = pr.aimNoise * 1.25; o.dig = pr.dig * 0.8; o.block = pr.block * 0.5;
    return o;
  }

  /** ¿Toque por encima de la red en salto (remate o dejada)? Lo comparten hit() y aimPoint() para que el aro
   *  de apuntado prediga el mismo tipo de golpe que luego se ejecuta. */
  function isAttackContact(p, b) { return p.z > 0.25 && Math.abs(b.x) < 3.8 && b.z > C.NET_H + 0.1; }

  /* Colocación en salto (solo el humano; input.jset = COLOCAR estando en el aire). Vale en el 2.º toque y en el 1.º si el
   * balón llega alto a la red (isAttackContact): el compañero ataca entonces en el 2.º. Sale más tensa que la de suelo (cima
   * baja: llega antes al atacante), con la ventana de timing ÷win y, con mal timing, se pega a la red o se va larga.
   *  win: divisor de la ventana (1,2 = un 17 % más justa que una colocación de suelo)
   *  tx, tz: destino (m de la red, altura) como la colocación de suelo (1,35 / 3), algo más separada de la red
   *  rise/rise1: cima = contacto + rise (2.º toque) / rise1 (1.er toque, el compañero viene de más lejos), mínimo minApex
   *  err0/err1: dispersión (como la de suelo, 0,1 + 1,15·(1−q)); badQ/badP: por debajo de badQ, prob. (badQ+0,05−q)·badP
   *  de colocación mala (mitad pegada a la red, mitad larga); blk: el error de colocación del bloqueador rival (blockOff) crece
 *  ×(1 + blk·q): la rápida y bien dada le pilla peor colocado; dig: el dado de defensa del remate que sigue a una colocación en
 *  salto buena/perfecta del 2.º toque ×dig (tempo rápido; el bloqueador CPU la lee y llega, ai.js, y sin esto no compensaba
 *  arriesgar); mate: |y| máximo del destino; buf: s que se guarda COLOCAR pulsado justo al despegar (g.jsetQ). */
  var JSET = VB.JSET = { win: 1.2, tx: 1.5, tz: 3, rise: 0.75, rise1: 1.15, minApex: 4.1, err0: 0.12, err1: 1.3, badQ: 0.45, badP: 1.5, blk: 0.6, dig: 0.8, mate: 3.6, buf: 0.2 };
  /** El remate rival no se «coloca» desde el bloqueo: con un remate del otro equipo en camino COLOCAR no hace nada en el
   *  aire (bloquea como si no se hubiera pulsado) y la UI no lo ofrece. */
  function jsetVoid(g, p) { return g.touchTeam !== p.team && g.lastKind === 'spike'; }
  function canJset(g, p, count) { return p.z > 0.25 && !jsetVoid(g, p) && (count === 2 || (count === 1 && isAttackContact(p, g.ball))); }
  /** Para la UI (botón táctil COLOCAR, aviso «Rematar | Colocar») y la lectura del bloqueador CPU (ai.js): el jugador humano
   *  está en el aire, el balón le queda a < 3 m en un toque donde cabe la colocación en salto (2.º, o 1.º con el balón alto
   *  junto a la red) y el contacto previsto (hitWindow, el mismo que el aro) cumple lo que luego pide canJset: el jugador
   *  aún en el aire (> 0,25 m) y, en el 1.er toque, el balón por encima de NET_H + 0,1 (isAttackContact). Así lo que se
   *  ofrece es lo que sale. Una llamada por paso (caché por g.time). */
  var _jw = { t: 0, press: 0, d: 9, dz: 9, reach: false, kind: '', zc: 0, x: 0, y: 0, z: 0, active: false, canReach: false, attack: false, jumpT: NaN };
  var _jrG = null, _jrT = -1, _jrV = false;
  function jsetReady(g) {
    if (g.mode !== 'rally' || g.demo || g.autopilot) return false;
    if (_jrG === g && _jrT === g.time) return _jrV;
    _jrG = g; _jrT = g.time; _jrV = jsetReady0(g);
    return _jrV;
  }
  function jsetReady0(g) {
    var p = g.ctrl, b = g.ball;
    if (!p || p.team !== 0 || !(p.z > 0.05) || p.down > 0 || b.held) return false;
    if (g.touchTeam === 0 && (g.lastPlayer === p || g.lastKind === 'serve')) return false;
    if (jsetVoid(g, p)) return false;
    var count = g.touchTeam === 0 ? g.touches + 1 : 1;
    if (count > 2 || Math.hypot(b.x - p.x, b.y - p.y) >= 3) return false;
    var w = hitWindow(g, p, _jw), t = Math.max(0, w.t);
    if (!(p.z + p.vz * t - 0.5 * C.G * t * t > 0.25)) return false;           // el contacto ya sería en el suelo
    if (count === 1 && !(Math.abs(w.x) < 3.8 && w.z > C.NET_H + 0.1 && w.x * side(p.team) > -0.5)) return false;
    return true;
  }
  /** ¿Toca atacar al equipo t en su siguiente toque? Tras su 2.º toque o tras una colocación en salto en el 1.º. */
  function atkPhase(g, t) { return g.touchTeam === t && (g.touches === 2 || (g.touches === 1 && g.lastKind === 'set')); }

  function other(g, p) { var t = g.teams[p.team]; return t[0] === p ? t[1] : t[0]; }
  function isHuman(g, p) { return !g.demo && !g.autopilot && p.team === 0 && p === g.ctrl; }
  // Representación de campos en V8 (integración, ronda 2 de verificación): un campo numérico que nace entero (Smi: 0, -1, 99)
  // y luego recibe un double obliga a V8 a generalizar el mapa del objeto y deprecar todo su árbol de transiciones; eso,
  // en mitad del peloteo (primer bloqueo, primera plancha…), desoptimizaba de golpe el código caliente de TODOS los módulos
  // (notes/camera_input.md, ronda 2). Pasar cada campo entero por un double al crear el objeto hace esa generalización aquí,
  // al crear el partido, y una sola vez por sitio. La semántica no cambia (mismo valor; simtest da la misma salida).
  function dblFields(o) { for (var k in o) { var v = o[k]; if (typeof v === 'number' && (v | 0) === v) { o[k] = 0.5; o[k] = v; } } return o; }
  function emit(g, e) { e.t = g.time; dblFields(e); g.events.push(e); return e; }
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
  /** Dispersión (m, radio) del remate del HUMANO según la calidad q: perfecto (q >= 0,9) casi exacto (<= 0,1 m),
   *  0,78 ~0,28, 0,5 ~0,74, 0,2 ~1,3. Monótona decreciente. */
  function spikeSpread(q) {
    q = clamp(q || 0, 0, 1);
    var s = 1.7 * Math.pow(1 - q, 1.2);
    return q >= 0.9 ? Math.min(s, 1 - q) : s;
  }
  /** Dispersión (m, radio) del saque dirigido del HUMANO según la calidad q del timing. En salto (jump): perfecto casi
   *  exacto (q >= 0,9: <= 1 − q), 0,78 ~0,32, 0,5 ~0,87, 0,2 ~1,53. Flotante: siempre algo más (0,1 de base) con buen
   *  timing y algo menos con mal timing (0,78 ~0,36, 0,5 ~0,75, 0,2 ~1,27); además sigue bailando en el aire (wobA). */
  function serveSpread(q, jump) {
    q = clamp(q || 0, 0, 1);
    var u = Math.pow(1 - q, 1.2);
    if (jump) { var s = 2.0 * u; return q >= 0.9 ? Math.min(s, 1 - q) : s; }
    var f = 0.1 + 1.5 * u; return q >= 0.9 ? Math.min(f, 0.1 + (1 - q)) : f;
  }

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
  /** Más velocidad con la MISMA trayectoria (Cañón, Manos de seda, Bombardero): la gravedad efectiva sube con (v'/v)², así el
   *  remate/saque que launchDirect frena para pasar la red sale de verdad más rápido (mismo dibujo en el aire, en menos tiempo). */
  function boostDip(dip, v0, v1) { var k = v1 / v0; return (C.G + dip) * k * k - C.G; }
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
    if (d > reachOf(g, p) || rz < 0.05 || rz > 2.7) return false;
    // penetración en el espacio contrario: solo se juega el balón que está (casi del todo) en el propio campo
    // (el bloqueo va aparte, en checkBlock)
    return b.x * side(p.team) > -C.BR * 0.5;
  }
  /** ¿Puede llegar lanzándose en plancha? (solo en el suelo, balón bajo) */
  function canDive(g, p) {
    var b = g.ball;
    if (b.held || g.mode !== 'rally' || p.down > 0 || p.z > 0 || p.vz > 0) return false;
    if (g.lastKind === 'serve' && g.touchTeam === p.team) return false;
    if (g.touchTeam === p.team && g.lastPlayer === p) return false;
    var d = Math.hypot(b.x - p.x, b.y - p.y), rl = bl(p, 'red');
    if (d > (rl ? (C.REACH + C.DIVE) * BADGE.redR[rl] : C.REACH + C.DIVE) || b.z < 0.08 || b.z > 1.3) return false;
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
  var _w = { t: 0, press: 0, d: 9, dz: 9, reach: false, kind: '', zc: 0, x: 0, y: 0, z: 0, active: false, canReach: false, attack: false, jumpT: NaN };
  function hitWindow(g, p, out) {
    p = p || g.ctrl; out = out || _w;
    var b = g.ball, kind = predictKind(g, p), zc = C.ZC[kind], G = gEff(b), PG = C.G;
    var sd = side(p.team), offx = g.mode === 'serve' ? -sd * 0.3 : 0;
    var air = p.z > 0 || p.vz > 0;
    // lanzamiento del saque: el contacto válido es con el balón BAJANDO (el cruce de subida no cuenta)
    var tossUp = g.mode === 'serve' && g.serveState === 'toss';
    var tb = -Math.min(0.35, Math.max(0, g.time - g.lastTouchT));
    var best = 1e9, bt = 0, bd = 9, bdz = 9, bx = b.x, by = b.y, bz = b.z, st = 1 / 120;
    for (var t = tb; t <= 1.2; t += st) {
      if (tossUp && b.vz - G * t > 0) continue;
      var x = b.x + b.vx * t, y = b.y + b.vy * t, z = b.z + b.vz * t - 0.5 * G * t * t;
      if (t > 0 && z < C.BR) break;
      var pz = air ? Math.max(0, p.z + p.vz * t - 0.5 * PG * t * t) : p.z;
      var dx = x - p.x - offx, dy = y - p.y, dz = z - (pz + zc);
      var D = 0.6 * (dx * dx + dy * dy) + dz * dz;
      if (D < best) { best = D; bt = t; bd = Math.sqrt(dx * dx + dy * dy); bdz = dz; bx = x; by = y; bz = z; }
      if (t > 0.3 && D > best + 4) break; // ya se aleja mucho: no hace falta seguir
    }
    out.t = bt; out.d = bd; out.dz = bdz; out.kind = kind; out.zc = zc; out.x = bx; out.y = by; out.z = bz;
    out.press = bt - C.WINDUP; // s hasta el momento ideal de PULSAR (0 = pulsa ya: 'perfect')
    out.reach = g.mode === 'serve' ? (bd < 0.85 && Math.abs(bdz) < 0.85) : (bd <= reachOf(g, p) && bdz > -zc + 0.05 && bdz < 2.7 - zc);
    out.active = g.hitBuf > 0 && g.swingLive; out.canReach = canReach(g, p);
    // ¿toca atacar? tiempo hasta el despegue ideal (para la UI: "¡salta!") o NaN
    out.attack = false; out.jumpT = NaN;
    if (g.mode === 'rally' && !air && atkPhase(g, p.team) && g.jobs[p.team] === p &&
        Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) {
      var hz = C.ZC.spike + C.JUMP_V * C.JUMP_V / (2 * C.G), vz0 = b.vz, disc = vz0 * vz0 - 2 * G * (hz - b.z);
      if (disc >= 0) { out.attack = true; out.jumpT = (vz0 + Math.sqrt(disc)) / G - C.JUMP_V / C.G; }
    }
    return out;
  }

  function attackTarget(p, aim, dd) {
    var sd = side(p.team);
    var tx = -sd * dd, ty = -Math.sign(p.y || 0.1) * 1.6; // sin apuntar: diagonal
    // apuntando: la dirección es un "joystick" sobre el campo rival (centro a 5 m de la red): adelante = fondo,
    // atrás = corta, izquierda/derecha = hasta las líneas laterales (paralela o diagonal, ambas posibles)
    if (aim) { tx = -sd * 5 + aim[0] * 3.0; ty = aim[1] * 3.7; }
    return [-sd * clamp(-sd * tx, 1.4, 8.3), clamp(ty, -3.9, 3.9)];
  }

  /** Margen de defensa (s) de un remate: tiempo de vuelo hasta el bote menos lo que tarda el defensor más
   *  rápido del equipo dt en plantarse allí (VB.AI.timeTo: aterrizar, levantarse, correr). >0 = llega con
   *  tiempo; <0 = al hueco. Balón que no entra en el campo: margen alto (no hace falta defenderlo). */
  function digMargin(g, dt, o, v, G) {
    var disc = v[2] * v[2] + 2 * G * Math.max(0, o.z - C.BR), ft = (v[2] + Math.sqrt(disc)) / G;
    var lx = o.x + v[0] * ft, ly = o.y + v[1] * ft;
    if (Math.abs(lx) > C.HL + 0.3 || Math.abs(ly) > C.HW + 0.3 || lx * side(dt) <= 0) return 2;
    var AI = VB.AI, best = 9;
    for (var i = 0; i < 2; i++) {
      var q = g.teams[dt][i];
      var tq = AI && AI.timeTo ? AI.timeTo(g, q, lx, ly) : Math.hypot(q.x - lx, q.y - ly) / C.SPEED;
      if (tq < best) best = tq;
    }
    return ft - best;
  }

  function fastInFor(g) {
    var b = g.ball; return Math.hypot(b.vx, b.vy, b.vz);
  }

  /** Golpeo: el tipo de toque lo decide el juego según contexto.
   *  te: desfase con el momento ideal (s). shot: '' | 'tip' | 'dive'.
   *  tgt: [x,y] destino explícito (IA) o null para usar aim. */
  function hit(g, p, aim, te, shot, tgt) {
    var t = p.team, sd = side(t), b = g.ball, prof = profOf(g, p);
    var inKind = g.lastKind, inShot = g.lastShot, inPrev = g.prevKind; // lo que llega (para contar defensas de remate)
    var prevPlayer = g.lastPlayer;                                          // autor del toque anterior (colocador: asistencia, Manos de seda)
    if (g.touchTeam === t && g.lastPlayer === p) { fault(g, t, 'double', 'Dobles: el mismo jugador toca dos veces', p); return; }
    var count = g.touchTeam === t ? g.touches + 1 : 1;
    if (count > 3) { fault(g, t, 'four', '4 toques', p); return; }
    // COLOCAR en el aire donde no cabe colocación en salto (3.er toque, o 1.º sin el balón alto en la red): dejada si es
    // un toque de ataque, si no el toque normal
    if (shot === 'jset' && !canJset(g, p, count)) shot = isAttackContact(p, b) ? 'tip' : '';
    var jset = shot === 'jset';
    // Regla 13.3.4: atacar el saque rival en zona de ataque con el balón entero por encima de la red. El golpe solo
    // es falta cuando se COMPLETA como ataque (el balón cruza entero el plano de la red o lo toca el rival): una
    // recepción alta dirigida al propio campo no lo es. Se anota aquí y se pita en stepBall/checkBlock.
    var atkSrv = shot !== 'body' && g.lastKind === 'serve' && g.lastTeam !== t && p.z > 0.25 && b.z - 0.1 > C.NET_H && Math.abs(b.x) < C.ATTACK;
    g.atkServe = atkSrv ? { team: t, player: p } : null;
    var human = isHuman(g, p), mate = other(g, p);
    te = te || 0; shot = shot || '';
    if (human && count === 1 && g.digTight) te *= 1.5; // A3: tras un remate perfecto rival la ventana es más justa
    var d = Math.hypot(b.x - p.x, b.y - p.y), inSp = fastInFor(g);
    var hardIn = g.lastKind === 'spike' || (g.lastKind === 'serve' && inSp > 13);
    if (human && p.ak) { // atributos: ventana de timing del toque (recepción/defensa, colocación, ataque) ±12 %
      var wk = jset ? p.ak.wSet : isAttackContact(p, b) ? p.ak.wAtk : count === 2 ? p.ak.wSet : g.lastKind === 'serve' ? p.ak.wRecv : p.ak.wDig;
      te /= wk;
    }
    // Manos de seda: remate del compañero tras una colocación buena o perfecta del que la lleva
    // (también el ataque del 2.º toque tras una colocación en salto en el 1.º)
    var setIn = inKind === 'set' && (count === 3 || (count === 2 && inShot === 'jump'));
    var sedaL = setIn && prevPlayer && prevPlayer !== p && prevPlayer.team === t && prevPlayer.grade !== 'poor' ? bl(prevPlayer, 'seda') : 0;
    if (human && p.badges) { // insignias: ventanas de timing del humano (Sangre fría, Manos de seda, Ancla, Red de seguridad)
      var bw = sangreW(g, p), atkC = isAttackContact(p, b);
      if (atkC && sedaL && shot !== 'tip') bw *= BADGE.sedaW[sedaL];
      if (count === 1 && !atkC) {
        if (inKind === 'serve') bw *= BADGE.anclaW[bl(p, 'ancla')];
        else if (inKind === 'spike' || (inKind === 'block' && inPrev === 'spike')) bw *= BADGE.redW[bl(p, 'red')];
      }
      if (bw !== 1) te /= bw;
    } else if (human && sedaL && shot !== 'tip' && isAttackContact(p, b)) te /= BADGE.sedaW[sedaL];
    if (jset) te *= JSET.win; // colocación en salto: ventana más justa
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
    if (shot === 'body') {
      // el balón da en el cuerpo sin gesto de golpeo (regla: cualquier parte del cuerpo vale como toque).
      // Rebota amortiguado hacia atrás y hacia arriba, con un desvío lateral: casi nunca controlado.
      // sale HACIA FUERA del cuerpo (por donde iba a salir de la "cápsula"), para que no vuelva a caerle encima
      var vin = Math.hypot(b.vx, b.vy, b.vz), ox = b.x - p.x, oy = b.y - p.y, ol = Math.hypot(ox, oy);
      if (ol < 0.05) { ox = -b.vx; oy = -b.vy; ol = Math.hypot(ox, oy) || 1; }
      if (ox * sd < 0) ox = -ox * 0.5; // el cuerpo amortigua: no sale disparado hacia la red (ni por debajo de ella)
      var kout = 1.5 + g.rng() * 1.3 + vin * 0.04;
      v = [ox / ol * kout - b.vx * 0.08, oy / ol * kout - b.vy * 0.08 + rnd(g, 0.4), Math.max(0, -b.vz) * 0.2 + 1.3 + g.rng() * 1.4 + vin * 0.04];
      kind = count === 1 ? 'pass' : count === 2 ? 'set' : 'free';
      q = Math.min(q, 0.12); grade = 'poor';
      g.hardIn = false; g.digOk = true;
      if (g.stats) g.stats.body++;
    } else if (jset) {
      // colocación en salto: hacia la zona de ataque del compañero, tensa (cima baja); con mal timing, pegada o larga
      er = (JSET.err0 + JSET.err1 * (1 - q)) * mul;
      var jx = JSET.tx, jy = clamp(mate.y, -JSET.mate, JSET.mate), jap = Math.max(JSET.minApex, b.z + (count === 1 ? JSET.rise1 : JSET.rise));
      if (q < JSET.badQ && g.rng() < (JSET.badQ + 0.05 - q) * JSET.badP) {
        if (g.rng() < 0.5) jx = 0.25 + g.rng() * 0.35;          // pegada a la red: toque de red o bloqueo fácil
        else { jx = 3.6 + g.rng() * 1.8; jap -= 0.35; }        // larga y baja: el atacante no llega a rematar
      }
      v = launchApex(o, sd * Math.max(0.15, jx + rnd(g, er * 0.5)), clamp(jy + rnd(g, er * 0.9), -4.2, 4.2), JSET.tz, jap);
      kind = 'set'; sub = 'jump';
      g.blockOff[1 - t] = rnd(g, (0.35 + 0.9 * (1 - g.prof[1 - t].block)) * (1 + JSET.blk * q)); // rápida: el bloqueo rival llega peor colocado
      g.hardIn = false; g.digOk = true;
      if (g.stats) g.stats.jsets = (g.stats.jsets || 0) + 1;
    } else if (isAttackContact(p, b)) {
      if (shot === 'tip') { // dejada: suave, corta, por encima del bloqueo
        at = tgt || [-sd * (1.6 + (aim ? clamp(-sd * aim[0], -0.3, 1) : 0.3)), clamp(aim ? p.y + aim[1] * 2.6 : -p.y, -3.8, 3.8)];
        er = (0.25 + 0.9 * (1 - q)) * mul;
        v = launchSafe(o, at[0] + rnd(g, er), at[1] + rnd(g, er), 0, Math.max(b.z + 0.45, C.NET_H + 0.9));
        kind = 'free'; power = 0.1;
      } else { // remate
        var free3 = human && !tgt && g.aim3.on && g.aim3.kind !== 'serve'; // A1: mira libre del humano
        at = tgt || (free3 ? [g.aim3.x, g.aim3.y] : attackTarget(p, aim, 6));
        var spd = human ? 13.5 + 5.5 * q + (p.ak ? p.ak.spike : 0) : prof.spike * (0.82 + 0.18 * q);
        var boost = p.badges || sedaL ? BADGE.canon[bl(p, 'canon')] + BADGE.sedaV[sedaL] : 0; // Cañón, Manos de seda (m/s)
        power = clamp((spd + boost - 11) / 8, 0, 1);
        er = (0.25 + 1.5 * (1 - q)) * mul;
        dip = C.G * (0.15 + 0.3 * q); // liftado: el balón "cae" más
        if (boost > 0) { dip = boostDip(dip, spd, spd + boost); spd += boost; }
        if (free3) { // A2: dispersión según el timing, uniforme en un círculo de radio spikeSpread(q) (mismo gasto de azar)
          var sr = spikeSpread(q) * (p.ak ? p.ak.spread : 1) * BADGE.mira[bl(p, 'mira')] * Math.sqrt(g.rng()), sa = g.rng() * 6.2832;
          v = launchDirect(o, at[0] + sr * Math.cos(sa), at[1] + sr * Math.sin(sa), C.BR, spd, C.G + dip); // bota justo en la diana
        } else v = launchDirect(o, at[0] + rnd(g, er), at[1] + rnd(g, er), 0, spd, C.G + dip);
        if (q < 0.45 && g.rng() < (0.48 - q) * 0.75) v[2] -= 1.4 + g.rng(); // a la red
        else if (!human && g.rng() < prof.atkErr * BADGE.miraAI[bl(p, 'mira')] * BADGE.sedaAI[sedaL]) aiError(g, o, v, spd, sd, C.G + dip); // error no forzado de la IA
        kind = 'spike'; sub = 'power';
      }
      // ¿defenderá la IA del otro equipo? Depende de la potencia y de la COLOCACIÓN: margen de tiempo entre el
      // vuelo del balón y lo que tarda el defensor más rápido en llegar al bote (remate al hueco = punto;
      // remate a las manos del defensor = defendible). Así apuntar compensa.
      g.hardIn = kind === 'spike';
      var dp = g.prof[1 - t];
      if (kind === 'spike') {
        g.digMargin = digMargin(g, 1 - t, o, v, C.G + dip);
        // A3: remate perfecto del humano -> la IA rival defiende peor (x0,8); remate perfecto contra el humano -> g.digTight
        var tightK = human && grade === 'perfect' ? 0.8 : 1;
        // remate tras una colocación en salto buena o perfecta en el 2.º toque: el tempo rápido pilla a la defensa rival a
        // medio colocar. No tras la del 1.er toque: ahí ya sale sola (balón regalado en la red) y con el ×dig colocar ganaba
        // más que rematarlo uno mismo
        if (setIn && count === 3 && inShot === 'jump' && prevPlayer && prevPlayer.grade !== 'poor') tightK *= JSET.dig;
        g.digOk = g.rng() < dp.dig * tightK * clamp(1.55 - 0.9 * power, 0.3, 1.25) * clamp(1.21 + 1.3 * g.digMargin, 0.35, 1.7);
        g.digTight = grade === 'perfect' && 1 - t === 0 && !g.demo && !g.autopilot;
      } else { g.digOk = true; g.digTight = false; }
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
      if (shot === 'shank') { // la IA llega pero no la controla: el balón sale disparado (casi siempre injugable)
        // sale tenso y bajo, casi siempre hacia fuera (el compañero rara vez llega)
        var spk = g.lastKind === 'spike';
        var sy = (g.rng() < 0.5 ? -1 : 1), far = g.rng() < (spk ? 0.9 : 0.85);
        var shA = spk ? 1.1 + g.rng() * 1.3 : 1.1 + g.rng() * 1.5;
        v = launchApex(o, sd * (far ? 8.5 + g.rng() * 6 : 3 + g.rng() * 4), sy * (far ? 5.6 + g.rng() * 3.5 : 3 + g.rng() * 2), 0, Math.max(b.z + 0.3, shA));
        q = Math.min(q, 0.2); grade = 'poor';
      } else if (q < 0.3 && g.rng() < 0.55 * (0.3 - q) / 0.3) { // recepción fallida: sale desviada
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
      // error de colocación del bloqueador IA rival (el bloqueo es geométrico: peor bloqueador = manos más lejos del balón)
      g.blockOff[1 - t] = rnd(g, 0.35 + 0.9 * (1 - g.prof[1 - t].block));
      g.hardIn = false; g.digOk = true;
    }
    b.vx = v[0]; b.vy = v[1]; b.vz = v[2]; b.dip = dip; b.wobA = 0;
    if (kind !== 'spike') g.digTight = false;
    g.aim3.on = false;
    g.prevKind = g.lastKind;
    g.lastKind = kind; g.lastShot = sub; g.lastTouchT = g.time; g.netSince = false;
    if (kind === 'spike' || (kind === 'free' && sub === 'tip')) {
      g.atkTeam = t; g.atkHow = kind === 'spike' ? 'kill' : 'tip'; g.atkHits = g.rally.hits + 1; g.atkHuman = human; g.atkGrade = grade;
      // colocador del ataque (point.assist): el 2.º toque del mismo equipo, si el ataque es el 3.º (o el 1.º si colocó en salto
      // y el ataque es el 2.º)
      g.atkSet = setIn && prevPlayer && prevPlayer !== p && prevPlayer.team === t ? prevPlayer : null;
      if (g.stats && kind === 'spike') g.stats.spikes[t]++;
    }
    b.speed = Math.hypot(v[0], v[1], v[2]);
    p.lastAction = kind === 'free' && sub === 'tip' ? 'spike' : kind; p.actionT = 0; p.shot = sub; p.grade = grade;
    if (sub === 'body') p.anim = 0.12; // sin gesto de brazos: solo el rebote
    if (shot === 'dive') p.lastAction = 'dive';
    g.rally.hits++;
    // defensa de un remate (SIM-01): primer toque controlado (no desviado ni de rebote en el cuerpo) de un remate rival,
    // también si llega frenado por el propio bloqueo ('touch') o es la cobertura de un bloqueo directo rival ('stuff')
    if (kind === 'pass' && count === 1 && sub !== 'shank' && shot !== 'body' &&
        (inKind === 'spike' || (inKind === 'block' && inPrev === 'spike' && (inShot === 'touch' || inShot === 'stuff')))) g.rally.digs++;
    // hit.dig: defensa controlada de un remate RIVAL (1r toque; también el que llega frenado por el propio bloqueo, 'touch';
    // no la cobertura del propio remate tras un bloqueo directo rival, ni el desviado ni el rebote en el cuerpo)
    var isDig = kind === 'pass' && count === 1 && sub !== 'shank' && shot !== 'body' &&
      (inKind === 'spike' || (inKind === 'block' && inPrev === 'spike' && inShot === 'touch'));
    if (human) g.lastGrade = grade;
    if (g.stats) {
      g.stats.hits[kind]++; g.stats.grades[grade]++; if (human) g.stats.hgrades[grade]++;
      g.stats.shots[sub] = (g.stats.shots[sub] || 0) + 1;
    }
    emit(g, { type: 'hit', kind: kind, player: p, team: t, touch: count, quality: q, grade: grade, timing: te,
      power: power, shot: sub, dive: shot === 'dive', aim: aim ? [aim[0], aim[1]] : null, target: at ? [at[0], at[1]] : null,
      x: b.x, y: b.y, z: b.z, speed: b.speed, human: human, dig: isDig, recv: count === 1 && inKind === 'serve', jset: jset });
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

  function endSwing(g) { g.hitBuf = 0; g.swingLive = false; g.swingShot = ''; g.swingHasAim = false; }

  /* Volumen de las manos del bloqueador (revisión 2). El bloqueo es GEOMÉTRICO: si el balón entra en el
   * volumen, SIEMPRE hay contacto; el azar solo decide el resultado. Un bloqueo mal medido (lejos del punto
   * alto del salto, qb bajo) tiene las manos más bajas y más juntas: el balón pasa visiblemente por ENCIMA o
   * por el LADO, nunca a través.
   *   qb  = 1 en el punto alto del salto, ~0.2 subiendo/bajando rápido
   *   top = alcance de las manos sobre los pies; hw = media anchura de las manos (centro del balón)
   * Por debajo de las manos (pies + BLK_HANDS) está el cuerpo (cabeza/pecho), más estrecho (BLK_BODY). */
  var BLK_HANDS = 1.95, BLK_BODY = 0.3;
  function blockTop(qb) { return 2.5 + 0.3 * qb; }
  function blockHalfW(qb) { return 0.42 + 0.25 * qb; }
  function blockQ(q) { return clamp(1 - Math.abs(q.vz) / C.JUMP_V * 0.8, 0, 1); }
  /** ¿Está el balón dentro del volumen de bloqueo del jugador q? (no comprueba equipo ni dirección) */
  function inBlockVol(q, b) {
    var qb = blockQ(q);
    if (b.z < C.NET_H - 0.05 || b.z > q.z + blockTop(qb)) return false;
    return Math.abs(b.y - q.y) <= (b.z > q.z + BLK_HANDS ? blockHalfW(qb) : BLK_BODY);
  }

  function checkBlock(g) {
    var b = g.ball;
    if (g.blockCD > 0 || Math.abs(b.x) > 0.6) return;
    for (var i = 0; i < 4; i++) {
      var q = g.players[i], sq = side(q.team);
      if (q.z < 0.15 || Math.abs(q.x) > 1.1 || g.lastTeam === q.team || Math.sign(b.vx) !== sq) continue;
      if (!inBlockVol(q, b)) continue;
      g.blockCD = 0.5; g.blockBy = q;
      if (g.lastKind === 'serve') { fault(g, q.team, 'block', 'Bloqueo del saque', q); return; }
      if (g.atkServe) { fault(g, g.atkServe.team, 'attackServe', 'Ataque sobre el saque', g.atkServe.player); return; } // lo toca el rival: ataque completado
      var human = isHuman(g, q), prof = profOf(g, q), kindB;
      var qb = blockQ(q), hands = b.z > q.z + BLK_HANDS, hw = hands ? blockHalfW(qb) : BLK_BODY;
      var pw = clamp((b.speed - 11) / 8, 0, 1), spike = g.lastKind === 'spike';
      var cen = 1 - clamp(Math.abs(b.y - q.y) / hw, 0, 1);              // 1 = balón en el centro de las manos
      var cq = qb * (0.5 + 0.5 * cen) * (hands ? 1 : 0.45);              // calidad del contacto
      var ml = bl(q, 'muro');                                            // Muro: mejor contacto (humano) / más oficio (IA)
      if (ml && human) cq = Math.min(1, cq * BADGE.muroQ[ml]);
      var k = human ? 0.9 : clamp(0.3 + prof.block + BADGE.muroAI[ml], 0.3, 0.95); // oficio del bloqueador
      // resultado (probabilidades condicionadas, en este orden): directo, amortiguado, block-out, toque que sigue
      var pStuff = spike ? clamp(k * (0.15 + 0.6 * cq) - 0.15 * pw, 0.03, 0.65) : 0.12 * k * cq;
      var pSoft = clamp(0.12 + 0.45 * k * cq + (spike ? 0 : 0.4), 0, 0.9);
      var pTool = clamp(0.1 + 0.15 * pw + 0.25 * (1 - cen), 0, 0.5);
      // Rompemanos (atacante): +x de prob. ABSOLUTA de block-out. Dado previo con x / (1 − P(tool)) para que la prob. total
      // sea exactamente P(tool) + x (el dado extra solo se tira si el atacante lleva la insignia)
      var rk = spike ? bl(g.lastPlayer, 'rompemanos') : 0, forceTool = false;
      if (rk) {
        var pT0 = (1 - pStuff) * (1 - pSoft) * pTool, xr = Math.min(BADGE.rompemanos[rk], 0.95 - pT0);
        forceTool = xr > 0 && g.rng() < xr / (1 - pT0);
      }
      if (forceTool) {
        kindB = 'tool';
        var outF = g.rng() < 0.5 ? 1 : -1;
        b.x = sq * 0.3; b.vx = b.vx * 0.55; b.vy = outF * (2.5 + g.rng() * 3); b.vz = 1.5 + g.rng() * 2.5;
      } else if (g.rng() < pStuff) { // bloqueo directo ("muro"): hacia abajo y al campo del atacante, casi imposible de defender
        kindB = 'stuff';
        b.x = -sq * 0.25; b.vx = -sq * (2 + g.rng() * 2); b.vy = b.vy * 0.3 + rnd(g, 1.2); b.vz = -6 - g.rng() * 3;
      } else if (g.rng() < pSoft) { // bloqueo amortiguado: el balón queda jugable en el propio campo
        kindB = 'soft';
        b.x = sq * 0.3; b.vx = b.vx * 0.14 + sq * 0.6; b.vy = b.vy * 0.3 + rnd(g, 0.8); b.vz = 2.6 + g.rng() * 2;
      } else if (g.rng() < pTool) { // block-out: rebota en el borde de las manos y se va fuera
        kindB = 'tool';
        var out = g.rng() < 0.5 ? 1 : -1;
        b.x = sq * 0.3; b.vx = b.vx * 0.55; b.vy = out * (2.5 + g.rng() * 3); b.vz = 1.5 + g.rng() * 2.5;
      } else { // toque de bloqueo: el balón sigue a su campo, frenado, más alto y algo desviado (defendible)
        kindB = 'touch';
        var kv = 0.5 + 0.2 * g.rng() - 0.15 * cq;
        b.x = sq * 0.25; b.vx = b.vx * kv; b.vy = b.vy * 0.6 + rnd(g, 1.3); b.vz = Math.max(b.vz * 0.3, 0) + 1.2 + g.rng() * 2.2;
      }
      b.dip = 0; b.wobA = 0; b.speed = Math.hypot(b.vx, b.vy, b.vz);
      // El toque de bloqueo no cuenta como uno de los 3 toques del equipo
      g.touchTeam = q.team; g.touches = 0; g.lastPlayer = null; g.lastTeam = q.team; q.anim = 0.3; g.prevKind = g.lastKind; g.lastKind = 'block'; g.digTight = false;
      g.lastShot = kindB; g.lastTouchT = g.time; g.hardIn = false; g.digOk = true; g.netSince = false;
      if (kindB === 'stuff') { // el atacante casi nunca la salva
        g.hardIn = true; g.digOk = g.rng() < 0.2 * (1 - qb);
        g.atkTeam = q.team; g.atkHow = 'block'; g.atkHits = g.rally.hits; g.atkHuman = human; g.atkGrade = gradeOf(qb);
      } else if (kindB === 'touch') { // el remate sigue vivo pero frenado: la defensa IA lo saca más que un remate limpio
        var dpb = profOf(g, q);
        g.hardIn = true; g.digOk = g.rng() < clamp(0.08 + dpb.dig * 1.0, 0, 0.85);
      }
      q.lastAction = 'block'; q.actionT = 0; q.shot = kindB; q.grade = gradeOf(qb);
      if (g.stats) { g.stats.blocks++; g.stats.blockKinds[kindB]++; }
      emit(g, { type: 'block', player: q, team: q.team, x: b.x, y: b.y, z: b.z, result: kindB, quality: qb, human: human });
      return;
    }
  }

  /** Contacto con el cuerpo (revisión 2): si el balón entra en la "cápsula" del cuerpo de un jugador en su
   *  propio campo (radio BODY_R alrededor del eje, de 0,2 m a la cabeza) y nadie está jugando ese balón,
   *  es un toque (regla: cualquier parte del cuerpo). Antes atravesaba al jugador y contaba como ace. */
  var BODY_R = 0.3, BODY_Z0 = 0.2, BODY_Z1 = 1.85;
  /* El contacto se aplica en el ÚLTIMO instante en que el balón está dentro de la cápsula (va a salir por
   * abajo o por un lado en este subpaso): hasta entonces el jugador aún puede pulsar y jugarlo con un gesto
   * (algo tarde = toque 'good'/'poor' normal). Así un balón que cae encima del receptor no le "roba" el toque. */
  function checkBody(g, dt) {
    var b = g.ball;
    if (g.mode !== 'rally') return;
    for (var i = 0; i < 4; i++) {
      var p = g.players[i], sd = side(p.team), dz = b.z - p.z;
      if (p === g.blockBy && g.time - g.lastTouchT < 0.35) continue;      // el que acaba de bloquear
      if (b.x * sd < 0.25 || dz < BODY_Z0 || dz > BODY_Z1 || p.down > 0) continue;
      var dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy > BODY_R * BODY_R) continue;
      // ¿sigue dentro tras el próximo subpaso (solo se mueve el balón) Y tras un paso entero (se mueve también
      // el jugador)? Si en cualquiera de los dos sale, este es el último instante: contacto.
      var nx = dx + b.vx * dt, ny = dy + b.vy * dt, nz = dz + b.vz * dt;
      var mx2 = dx + (b.vx - p.vx) * 2 * dt, my2 = dy + (b.vy - p.vy) * 2 * dt, mz2 = dz + (b.vz - p.vz) * 2 * dt;
      if (nx * nx + ny * ny <= BODY_R * BODY_R && nz >= BODY_Z0 + 0.12 && nz <= BODY_Z1 &&
          mx2 * mx2 + my2 * my2 <= BODY_R * BODY_R && mz2 >= BODY_Z0 + 0.12 && mz2 <= BODY_Z1) continue; // aún dentro
      if (g.lastPlayer === p && g.time - g.lastTouchT < (g.lastShot === 'body' ? 1.2 : 0.5)) continue; // acaba de salir de sus manos / de rebotarle
      if (g.lastKind === 'serve' && g.touchTeam === p.team) continue;      // su propio saque
      // la IA aparta el cuerpo del balón que le costaría una falta (dobles: su propio toque que le vuelve a caer
      // encima; 4 toques: el equipo ya tocó tres veces) o que su compañero acaba de soltar a su lado (< 0,3 s: el
      // toque siguiente lo juega con un gesto, no "de rebote"). Antes, ~1 de cada 1.800 puntos la IA hacía dobles
      // o 4 toques así (recepción desviada que le cae encima; colocación que rebota en el compañero pegado).
      // El humano sigue expuesto a la regla: si el balón le da a él, es toque.
      if (!isHuman(g, p) && g.touchTeam === p.team &&
          (g.lastPlayer === p || g.touches >= 3 || g.time - g.lastTouchT < 0.3)) continue;
      if (isHuman(g, p)) { if (g.swingLive) continue; }                    // gesto en curso: lo resuelve processSwing
      else if (g.jobs[p.team] === p && g.digOk) continue;                 // la IA que va a jugarlo lo juega (salvo 'batida')
      hit(g, p, null, 0.25, 'body', null);
      return;
    }
  }

  /** Balón en la mano del sacador (antes del lanzamiento): pecho, delante, hacia la mano izquierda.
   *  Un leve vaivén (el sacador "bota" el balón en la mano mientras se concentra). */
  function holdBase(g, p, out) {
    var sd = side(p.team);
    out.x = p.x - sd * C.HOLD_FWD;            // hacia la red (-sd)
    out.y = p.y - sd * C.HOLD_SIDE;           // izquierda del jugador mirando a la red
    out.z = p.z + C.HOLD_Z + Math.sin(g.time * 3.1) * 0.025;
    return out;
  }
  /** Punto de la MANO izquierda del sacador (players ancla ahí la palma con `_holdPos`). Fuera del ritual = balón en la
   *  mano (holdBase). Durante el ritual de la CPU (SIM-04): en 'pre'/'post' la mano lleva el balón (= posición del balón);
   *  en 'dribble' la mano se aparta a un lado mientras el balón bota y vuelve a recogerlo (ver ritualHand). */
  function holdPos(g, p, out) {
    var r = g.ritual;
    if (r && r.on && r.player === p && g.mode === 'serve' && g.serveState === 'ready') return ritualHand(g, p, r, out);
    return holdBase(g, p, out);
  }

  // ---------- Ritual del sacador CPU (SIM-04) ----------
  /* Entre el silbato y el lanzamiento, el sacador de la CPU bota el balón 1-3 veces con un estilo propio y un tiempo
   * previsible. Todo es presentación DETERMINISTA: no gasta el azar del partido (g.rng); los parámetros salen de un hash
   * de la semilla del partido, el jugador y el número de saque. Fases (r.phase): 'wait' (balón en la mano antes del
   * silbato) → 'pre' (baja el balón hasta la altura del bote) → 'dribble' (botes; r.n = botes ya hechos, r.u = 0..1 dentro
   * del bote en curso) → 'post' (lo recoge y lo sube a la mano) → 'done' (quieto, concentrado, hasta el lanzamiento).
   * El balón es una función pura de r.t (s desde el silbato). Cada contacto con el suelo emite `dribble`.
   *   relZ: altura del centro del balón al soltarlo/recogerlo (m)   fwd/side: punto del bote delante/izquierda del sacador
   *   e: restitución del bote (madera)   tossBy: el lanzamiento nunca después de esto desde serveReady (8 s de reglamento)
   *   minDur/maxDur: duración total del ritual (silbato → lanzamiento)   postMove: s que tarda en subir el balón a la mano */
  var RITUAL = VB.RITUAL = { minDur: 0.8, maxDur: 1.6, tossBy: 4.5, relZ: 1.0, fwd: 0.42, side: 0.12, e: 0.8,
    postMove: 0.22, minCyc: 0.32, hand: 0.30, dwell: 0.017, demoMax: 0.8, demoBounces: 1, demoWhistle: 0.2, demoHold: 1.65 };
  // demo del menú (ola 3): un solo bote firme, ritual de 0,8 s como mucho (minCyc puede alargarlo a ~0,84), silbato a los
  // demoWhistle s y pausa rutinaria demoHold s (no 1,9): el ritual no puede frenar la demo. Con 2 botes/1,1 s y silbato a 0,35 la
  // demo bajó de 113 a 108 puntos de media en 20 min (semillas 1-200) y 4 semillas no llegaban a 2 sets; así: 116 puntos, 0/200.
  // dwell: el balón se queda en contacto con el suelo ~1 frame de 60 Hz (aplastamiento), para que todo frame pintado vea el bote
  function hash01(a, b, c) { // [0,1) determinista (mezcla tipo murmur3)
    var h = Math.imul((a | 0) ^ 0x2545F491, 0x9E3779B1) ^ Math.imul((b | 0) + 0x632BE5AB, 0x85EBCA77) ^ Math.imul((c | 0) + 0x1B873593, 0xC2B2AE3D);
    h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  /** Estilo fijo de cada jugador en el partido (personalidad): botes base y tempo. */
  function ritualStyle(g, p) {
    var a = hash01(g.seed, p.id, -1), b = hash01(g.seed, p.id, -2), c = hash01(g.seed, p.id, -3);
    return { n: a < 0.3 ? 1 : a < 0.75 ? 2 : 3, tempo: b, pre: 0.16 + 0.06 * c, still: 0.12 + 0.14 * hash01(g.seed, p.id, -4) };
  }
  /** Divide un bote de periodo T en bajada (td, empujado), contacto (RITUAL.dwell) y subida (tu) con restitución RITUAL.e. */
  function ritualSplit(r, T) {
    var d = RITUAL.relZ - C.BR, G = C.G, lim = Math.sqrt(2 * d / G) - 1e-3;
    T -= RITUAL.dwell;
    var lo = Math.max(0.05, T - lim), hi = Math.min(lim, T - 0.05), td = 0.5 * (lo + hi);
    for (var it = 0; it < 40; it++) { // e(td) crece con td: bisección
      td = 0.5 * (lo + hi);
      var tu = T - td, e = ((d + G * tu * tu / 2) / tu) / ((d + G * td * td / 2) / td);
      if (e < RITUAL.e) lo = td; else hi = td;
    }
    var tu2 = T - td;
    r.cyc = T + RITUAL.dwell; r.td = td; r.tu = tu2;
    r.v0 = (d - G * td * td / 2) / td;          // velocidad del empujón hacia abajo
    r.vu = (d + G * tu2 * tu2 / 2) / tu2;        // velocidad de subida tras el bote
    r.vc = r.vu - G * tu2;                       // velocidad (hacia arriba) al recogerlo
    r.vi = r.v0 + G * td;                        // velocidad contra el suelo
  }
  /** Prepara el ritual del sacador sv en setupServe (CPU) o lo apaga (humano). Devuelve s desde serveReady hasta el lanzamiento. */
  function ritualSetup(g, sv, cpu) {
    var r = g.ritual;
    r.on = false; r.phase = 'none'; r.t = 0; r.n = 0; r.u = 0; r.player = null; r.dur = 0; r.bounces = 0;
    if (!cpu || g.opts.ritual === false) return -1;               // opts.ritual:false = sin ritual (pruebas: flujo anterior)
    var st = ritualStyle(g, sv), sn = g.serveNo;
    var n = st.n, v = hash01(g.seed, sv.id, sn);
    if (v < 0.11) n--; else if (v > 0.89) n++;                       // a veces uno más o uno menos
    var press = g.setPoint >= 0 || g.matchPoint >= 0;                 // con punto de set/partido se toma su tiempo
    if (press) n++;
    n = clamp(n, 1, g.demo ? RITUAL.demoBounces : 3);
    var maxDur = g.demo ? RITUAL.demoMax : RITUAL.maxDur;
    var T = (n === 1 ? 0.50 : n === 2 ? 0.40 : 0.33) + (n === 1 ? 0.10 : n === 2 ? 0.06 : 0.04) * st.tempo;
    T *= 1 + 0.06 * (hash01(g.seed, sv.id, sn + 7777) * 2 - 1);
    var pre = st.pre, still = st.still + (press ? 0.12 : 0), post = RITUAL.postMove;
    var dur = pre + n * T + post + still;
    if (dur > maxDur) {                                               // demasiado largo: primero la pausa final, luego el tempo
      still = Math.max(0.08, still - (dur - maxDur)); dur = pre + n * T + post + still;
      if (dur > maxDur) { T = Math.max(RITUAL.minCyc, (maxDur - pre - post - still) / n); dur = pre + n * T + post + still; }
    }
    var minDur = Math.min(RITUAL.minDur, maxDur);
    if (dur < minDur) { still += minDur - dur; dur = minDur; }
    ritualSplit(r, T);
    var sd = side(sv.team);
    r.on = true; r.phase = 'wait'; r.player = sv; r.bounces = n; r.pre = pre; r.post = post; r.still = still; r.dur = dur;
    r.rx = sv.x - sd * RITUAL.fwd; r.ry = sv.y - sd * RITUAL.side; r.press = press;
    return Math.min(RITUAL.tossBy, g.whistleAt + dur);
  }
  function herm(a, b, ma, mb, s) { // Hermite cúbica: valores a,b y tangentes ma,mb (ya multiplicadas por la duración)
    var s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * a + (s3 - 2 * s2 + s) * ma + (-2 * s3 + 3 * s2) * b + (s3 - s2) * mb;
  }
  var _rH = { x: 0, y: 0, z: 0 };
  /** Posición del balón durante el ritual: función pura del tiempo del ritual (r.t, o `at` si se pasa: mirar adelante). */
  function ritualBall(g, p, r, out, at) {
    var t = at != null ? at : r.t, H = holdBase(g, p, _rH), R0 = RITUAL.relZ + p.z, s, k;
    if (t <= 0) { out.x = H.x; out.y = H.y; out.z = H.z; return out; }
    if (t < r.pre) {                                  // baja el balón: llega al punto del bote ya empujándolo
      s = t / r.pre;
      out.x = herm(H.x, r.rx, 0, 0, s); out.y = herm(H.y, r.ry, 0, 0, s); out.z = herm(H.z, R0, 0, -r.v0 * r.pre, s);
      return out;
    }
    var td = t - r.pre, nb = r.bounces * r.cyc;
    if (td < nb) {                                    // botes
      k = Math.floor(td / r.cyc); if (k >= r.bounces) k = r.bounces - 1;
      var tau = td - k * r.cyc;
      out.x = r.rx; out.y = r.ry;
      if (tau < r.td) out.z = R0 - r.v0 * tau - C.G * tau * tau / 2;
      else if (tau < r.td + RITUAL.dwell) out.z = p.z + C.BR;                       // en el suelo
      else { var tt = tau - r.td - RITUAL.dwell; out.z = p.z + C.BR + r.vu * tt - C.G * tt * tt / 2; }
      return out;
    }
    var tp = td - nb;                                 // lo recoge y lo sube a la mano
    if (tp < r.post) {
      s = tp / r.post;
      out.x = herm(r.rx, H.x, 0, 0, s); out.y = herm(r.ry, H.y, 0, 0, s); out.z = herm(R0, H.z, r.vc * r.post, 0, s);
      return out;
    }
    out.x = H.x; out.y = H.y; out.z = H.z; return out;
  }
  /** Mano izquierda durante el ritual: con el balón en 'pre'/'post'/'done'; en cada bote suelta el balón en el punto del
   *  bote, se aparta a un lado (RITUAL.hand m) mientras el balón baja y sube, y vuelve a por él al final del bote. */
  function ritualHand(g, p, r, out) {
    ritualBall(g, p, r, out);
    if (r.phase !== 'dribble') return out;
    var u = r.u, k = sstep01(u / 0.22) * (1 - sstep01((u - 0.76) / 0.24));
    out.x = r.rx; out.y = r.ry; out.z = RITUAL.relZ + p.z - 0.05 * k;
    out.y -= side(p.team) * RITUAL.hand * k;       // hacia la izquierda del sacador
    return out;
  }
  /** OPCIONAL (players, PLY-16): balón del ritual en el instante `t` (s desde el silbato) sin tocar nada; null si no hay ritual. */
  function ritualAt(g, t, out) {
    var r = g.ritual; if (!r || !r.on || !r.player) return null;
    return ritualBall(g, r.player, r, out || {}, t);
  }
  function endRitual(g) { var r = g.ritual; if (r.on) { r.on = false; r.phase = 'none'; } g.cpuTossIn = -1; }
  function sstep01(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
  /** Avanza el ritual un paso: fase, avance del bote y evento `dribble` en cada contacto con el suelo. */
  function ritualStep(g, sv) {
    var r = g.ritual;
    if (!r.on) return;
    var t0 = r.t;
    if (g.serveAuth) r.t = Math.max(0, g.serveT - g.whistleAt);
    var t = r.t, td = t - r.pre, nb = r.bounces * r.cyc;
    if (!g.serveAuth) r.phase = 'wait';
    else if (t < r.pre) r.phase = 'pre';
    else if (td < nb) {
      r.phase = 'dribble';
      var k = Math.min(r.bounces - 1, Math.floor(td / r.cyc));
      r.u = (td - k * r.cyc) / r.cyc;
      r.n = (td - k * r.cyc) >= r.td ? k + 1 : k;
    } else { r.n = r.bounces; r.u = 1; r.phase = td - nb < r.post ? 'post' : 'done'; }
    // contactos con el suelo cruzados en este paso
    for (var i = 0; i < r.bounces; i++) {
      var tc = r.pre + i * r.cyc + r.td;
      if (t0 < tc && t >= tc) {
        emit(g, { type: 'dribble', player: sv, team: sv.team, x: r.rx, y: r.ry, n: i + 1, of: r.bounces, speed: r.vi, last: i === r.bounces - 1 });
      }
    }
  }

  function stepBall(g, dt) {
    var b = g.ball, G = gEff(b);
    if (b.held) {
      var rt = g.ritual;
      if (rt.on && rt.player === b.held && g.mode === 'serve') { // ritual de la CPU: el balón sigue la función del bote
        var ox = b.x, oy = b.y, oz = b.z;
        ritualBall(g, b.held, rt, b);
        if (dt > 0) { b.vx = (b.x - ox) / dt; b.vy = (b.y - oy) / dt; b.vz = (b.z - oz) / dt; }
        if (rt.phase === 'dribble') b.spin += dt * 3;
      } else holdPos(g, b.held, b);
      return;
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
      if (b.z < C.NET_LOW - C.BR) { fault(g, g.lastTeam, 'under', 'Balón por debajo de la red'); return; }
      if (ay > C.HW - C.BR && ay <= C.HW + C.BR && b.z < C.ANT_TOP + C.BR) {
        g.antennaHit = { x: 0, y: (b.y < 0 ? -1 : 1) * (C.HW + ANT_Y), z: clamp(b.z, C.NET_LOW, C.ANT_TOP) };
        fault(g, g.lastTeam, 'antenna', 'Balón toca la antena'); return;
      }
      if (ay > C.HW) { fault(g, g.lastTeam, 'antenna', 'Balón por fuera de la antena'); return; }
      // por encima de la antena: el espacio de paso sigue la prolongación imaginaria de las antenas hasta el techo
      // (regla 8.4.4). Un balón que cruza en parte por fuera de ella es falta aunque su centro vaya por dentro.
      if (ay > C.HW - C.BR && b.z >= C.ANT_TOP + C.BR) { fault(g, g.lastTeam, 'antenna', 'Balón por fuera de la antena'); return; }
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
      // ataque del saque completado: el balón cruza entero el plano de la red (también tras pasar por la cinta)
      if (g.atkServe && (px > 0) !== (b.x > 0)) { fault(g, g.atkServe.team, 'attackServe', 'Ataque sobre el saque', g.atkServe.player); return; }
    }
    if (checkAntenna(g)) return;
    checkBlock(g);
    if (g.mode === 'rally') checkBody(g, dt);
    if (b.z <= C.BR && g.mode === 'rally') {
      b.z = C.BR; land(g);
      b.vz = Math.abs(b.vz) * 0.45; b.vx *= 0.5; b.vy *= 0.5; b.dip = 0; b.wobA = 0;
    }
  }
  /* Antena tocada SIN cruzar la red (regla 8.4.3: el balón que toca la antena es "fuera"). Antes solo se
   * pitaba al cruzar el plano de la red por fuera del espacio de paso; un balón que daba en la antena y volvía
   * a su campo seguía en juego. Antena: varilla vertical en x = 0, y = ±(HW + ANT_Y), de la parte baja de la red
   * (NET_LOW) a ANT_TOP (80 cm sobre la red), radio ANT_R. Falta del último equipo que tocó el balón (con un
   * bloqueo, del bloqueador: el balón que toca el bloqueo y luego la antena es punto del atacante). */
  var ANT_R = 0.01, ANT_Y = 0.005;
  function checkAntenna(g) {
    var b = g.ball;
    if (g.mode !== 'rally' || Math.abs(b.x) > C.BR + ANT_R || b.z < C.NET_LOW - C.BR || b.z > C.ANT_TOP + C.BR + ANT_R) return false;
    var dy = Math.abs(b.y) - (C.HW + ANT_Y), dz = b.z > C.ANT_TOP ? b.z - C.ANT_TOP : 0; // por encima: contra la punta
    if (b.x * b.x + dy * dy + dz * dz > (C.BR + ANT_R) * (C.BR + ANT_R)) return false;
    g.antennaHit = { x: b.x, y: (b.y < 0 ? -1 : 1) * (C.HW + ANT_Y), z: Math.min(b.z, C.ANT_TOP) };
    fault(g, g.lastTeam, 'antenna', 'Balón toca la antena');
    return true;
  }

  /** Texto del árbitro para un balón fuera, según el último toque (vocabulario FCVB): "Saque fuera",
   *  "Remate fuera", "Recepción fuera"... El equipo ya lo dice el marcador (antes: "La CPU manda el balón fuera"). */
  function outText(g) {
    var k = g.lastKind, sh = g.lastShot;
    if (k === 'serve') return 'Saque fuera';
    if (k === 'block') return 'Toca el bloqueo y sale fuera';
    if (sh === 'body') return 'Le da en el cuerpo y sale fuera';
    if (sh === 'tip') return 'Dejada fuera';
    if (k === 'spike') return 'Remate fuera';
    if (k === 'pass') return g.prevKind === 'serve' ? 'Recepción fuera' : 'Defensa fuera';
    if (k === 'set') return 'Colocación fuera';
    return 'Balón fuera';
  }

  /* ---------- Error arbitral (B1) ----------
   * Distancia firmada (m) del borde de la huella del balón a la línea más cercana (> 0 dentro): dentro <=> dist >= 0,
   * igual que el criterio de siempre de land() (C.IN_TOL). Con |dist| <= 0,10 el árbitro puede cantar al revés (REF_ERR),
   * sin avisar. Gasta g.rng solo en esos botes justos. */
  // Calibrado 9-nov-2026 (antes p 0.35/0.15/0.05): en partido casi no se veía (ver notes/sim.md, «error arbitral visible»).
  // La banda sigue en <= 10 cm; un árbitro solo, sin jueces de línea, con la huella a 1-2 cm de la línea es casi una moneda.
  // Es el error BASE (Partido rápido, sin modificador); los niveles de competición futuros lo escalarán.
  var REF_ERR = VB.REF_ERR = { d1: 0.02, p1: 0.45, d2: 0.05, p2: 0.30, d3: 0.10, p3: 0.15 };
  function lineDist(x, y) { return Math.min(C.HL + C.IN_TOL - Math.abs(x), C.HW + C.IN_TOL - Math.abs(y)); }
  function refErrP(dist, g) {
    var R = (g && g.refErr) || REF_ERR, a = Math.abs(dist);
    return a < R.d1 ? R.p1 : a < R.d2 ? R.p2 : a <= R.d3 ? R.p3 : 0;
  }
  /** opts.ref → tabla de error arbitral propia (null = la de base, REF_ERR). Valores fuera de rango se ignoran. */
  function refOf(r) {
    if (!r || typeof r !== 'object') return null;
    var o = {}, k, ks = ['d1', 'p1', 'd2', 'p2', 'd3', 'p3'];
    for (var i = 0; i < ks.length; i++) { k = ks[i]; o[k] = typeof r[k] === 'number' && r[k] >= 0 && r[k] <= (k[0] === 'p' ? 1 : 0.5) ? r[k] : REF_ERR[k]; }
    return o;
  }
  /** Challenges por set con opts.ref.chal (0 = sin challenge); sin ella, CHAL.perSet. */
  function chalOf(r) { return r && typeof r.chal === 'number' && r.chal >= 0 ? Math.min(5, Math.floor(r.chal)) : null; }
  function perSet(g) { return g.chalPerSet != null ? g.chalPerSet : CHAL.perSet; }
  /** [ganador, motivo, texto] del punto de un bote según lo que se cante (inside). */
  function landOutcome(g, inside, st) {
    var netTxt = g.lastKind === 'serve' ? 'Saque a la red' : 'Balón a la red';
    if (inside && st === g.lastTeam && g.netSince) return [1 - st, 'in', netTxt];
    if (inside) return [1 - st, 'in', st === 0 ? 'El balón cae en tu campo' : 'El balón cae en el campo rival'];
    // da en la red y cae fuera en el propio campo: nunca cruzó, el árbitro canta "a la red", no "fuera"
    if (st === g.lastTeam && g.netSince) return [1 - g.lastTeam, 'out', netTxt];
    return [1 - g.lastTeam, 'out', outText(g)];
  }
  function land(g) {
    var b = g.ball;
    // el balón toca el suelo justo debajo de su centro: dentro si esa huella toca la línea (las líneas son parte del campo)
    var dist = lineDist(b.x, b.y), truthIn = dist >= 0, st = b.x > 0 ? 0 : 1;
    var oT = landOutcome(g, truthIn, st), calledIn = truthIn, oC = oT, oW = landOutcome(g, !truthIn, st);
    // B1: solo si cantar al revés cambia el punto (un balón que no cruzó la red da el mismo punto dentro o fuera)
    var pe = refErrP(dist, g);
    if (pe > 0 && oW[0] !== oT[0] && g.rng() < pe) { calledIn = !truthIn; oC = oW; }
    var inside = calledIn;
    g.lastLand = { x: b.x, y: b.y, inside: inside, t: g.time }; // primer bote (lo lee la cámara en escenas congeladas)
    emit(g, { type: 'land', x: b.x, y: b.y, inside: inside, team: st, speed: Math.abs(b.vz), dist: dist, truthIn: truthIn });
    // alt = lo que se pitaría con la llamada contraria (para anular el punto tras un challenge acertado)
    g._pendCall = { x: b.x, y: b.y, dist: dist, truthIn: truthIn, calledIn: calledIn, wrong: calledIn !== truthIn, team: 1 - oC[0], t: g.time,
      alt: calledIn !== truthIn ? oT : oW, used: oW[0] === oT[0] };
    point(g, oC[0], oC[1], oC[2]);
    cpuChallengeDecide(g);
  }
  function fault(g, t, reason, text, p, sig) { point(g, 1 - t, reason, text, p, sig); }

  /* ---------- Presentación del punto (SIM-01/02/03) ----------
   * Campos AÑADIDOS al evento `point` (y copiados en g.lastPoint) para que cámara, UI, audio, luces y jugadores
   * coincidan en cuánto vale un punto y qué señala el árbitro. Puros y deterministas: no gastan azar ni cambian
   * el flujo del partido (salvo la duración de la pausa con g.present = true). Ver notes/sim.md §P1. */
  /** Señal oficial del árbitro por motivo (reason 'out' y 'serve' se resuelven aparte, ver point()). */
  var SIGNAL = { in: 'in', out: 'out', four: 'four', double: 'double', net: 'net', under: 'under', antenna: 'antenna',
    attackServe: 'attackFault', block: 'attackFault', serve: 'serveFault' };
  /** Pausa del punto con g.present (partido humano): normal, punto grande (highlight >= HOLD.bigAt), set, partido;
   *  `eight` se suma por el cambio de campo a los 8 del set decisivo. */
  var HOLD = VB.HOLD = { routine: 1.9, big: 2.4, bigAt: 0.55, set: 4.0, match: 4.2, eight: 1.4, skipAfter: 0.8, skipTo: 0.3 };
  /** Pausa clásica (demo, autopilot, tests sin g.present): la de siempre. */
  var HOLD_LEGACY = { routine: 1.9, set: 3.6, match: 2.2, eight: 1.4 };
  /** Pesos de highlightOf (SIM-01, calibrados en SIM-05; ver notes/sim.md §P3). Solo lectura para los demás módulos. */
  var HL = VB.HL = { base: 0.15, rallyFrom: 4, rally: 0.025, rallyMax: 0.35, dig: 0.08, digMax: 0.3, playMax: 0.4,
    block: 0.4, ace: 0.25, perfectKill: 0.1, setPoint: 0.15, clutch: 0.28, clutchLast: 8, clutchGap: 2, matchPoint: 0.45,
    saved: 0.15, streakAt: 3, streak: 0.1, errorMax: 0.35 };
  /** "Lo grande que ha sido" un punto, 0..1 (SIM-01, calibrado en SIM-05). o = {how, rallyHits, digs, perfectKill, setPoint,
   *  matchPoint, clutch, saved, streak, setWon, matchWon}. Base 0,15 +
   *  - JUGADA (tope conjunto 0,4: con la base, una jugada épica sola ya llega a 0,55): peloteo largo +0,025 por toque a partir
   *    del 5.º (máx. 0,35) y +0,08 por defensa de remate (máx. 0,3);
   *  - CÓMO: bloqueo directo +0,4 (un punto de bloqueo siempre es grande), ace +0,25, remate perfecto del humano +0,1;
   *  - PRESIÓN: punto de set +0,15, o final apretado (`clutch`: últimos 8 puntos del set con 2 o menos de diferencia) +0,28,
   *    lo que sea mayor (no se suman: el 24-23 no vale menos que el 23-22); punto de partido +0,45 más;
   *  - salvar un punto de set/partido +0,15; racha de 3 o más +0,1.
   *  Un error se queda en 0,35 como mucho salvo que cierre el set o el partido. Redondeado a milésimas. */
  function highlightOf(o) {
    var play = Math.min(HL.rallyMax, HL.rally * Math.max(0, (o.rallyHits || 0) - HL.rallyFrom)) + Math.min(HL.digMax, HL.dig * (o.digs || 0));
    var h = HL.base + Math.min(HL.playMax, play);
    if (o.how === 'block') h += HL.block;
    if (o.how === 'ace') h += HL.ace;
    if (o.perfectKill) h += HL.perfectKill;
    h += Math.max(o.setPoint ? HL.setPoint : 0, o.clutch ? HL.clutch : 0);
    if (o.matchPoint) h += HL.matchPoint;
    if (o.saved) h += HL.saved;
    if (o.streak >= HL.streakAt) h += HL.streak;
    if (o.how === 'error' && !o.setWon && !o.matchWon) h = Math.min(h, HL.errorMax);
    return Math.round(clamp(h, 0, 1) * 1000) / 1000;
  }
  /** Final apretado (SIM-05): con el marcador de ANTES del punto, el que va delante está en los últimos HL.clutchLast puntos
   *  del set (>= 17 de 25, >= 7 de 15) y la diferencia es de HL.clutchGap o menos. */
  function clutchOf(s0, s1, tgt) { return Math.max(s0, s1) >= tgt - HL.clutchLast && Math.abs(s0 - s1) <= HL.clutchGap; }

  /** Asigna punto. reason: 'in'|'out'|'antenna'|'under'|'double'|'four'|'net'|'serve'|'block'|'attackServe'.
   *  sig: señal del árbitro explícita (solo la falta de saque: 'delay8' | 'serveFault'). */
  function point(g, w, reason, text, p, sig) {
    if (g.mode !== 'rally' && g.mode !== 'serve') { g._pendCall = null; return; }
    // B2: llamada de este punto (solo si acaba en bote) e instantánea del estado previo para poder anularlo
    g.call = g._pendCall; g._pendCall = null; g.cpuChal = null; g.digTight = false; g.aim3.on = false;
    if (g.call) { g.call.team = 1 - w; g.call.t = g.time; g.call.setNo = g.setNo; g._snap = snapOf(g); } else g._snap = null;
    g.score[w]++; g.mode = 'point'; g.ball.held = null; endSwing(g);
    var sideout = w !== g.serving;
    if (g.stats) { g.stats.points++; g.stats.won[w]++; g.stats.how = g.stats.how || {}; g.stats.why[text] = (g.stats.why[text] || 0) + 1; g.stats.rallies.push(g.rally.t); }
    emit(g, { type: 'whistle', reason: 'point' });
    // cómo se ganó (para UI/público): ace, kill (remate), tip (dejada), block, error, free
    var how = 'error';
    // (sin mirar g.netSince: un saque o remate que roza la cinta y cae dentro sin que nadie lo toque es ace/kill legal;
    //  el balón 'a la red' que cae en su propio campo ya tiene lastTeam !== w)
    if (reason === 'in' && g.lastTeam === w) {
      how = g.lastKind === 'serve' ? 'ace' : g.lastKind === 'block' ? 'block' : g.lastKind === 'spike' ? 'kill' : g.lastShot === 'tip' ? 'tip' : 'free';
    } else if ((reason === 'out' || reason === 'in') && g.lastKind === 'block' && g.lastTeam !== w && !g.netSince) how = 'kill'; // block-out / remate que pasa tocando el bloqueo
    // el rival tocó una sola vez el ataque/saque y no lo salvó (recepción/defensa desviada): mérito del que atacó/sacó
    if (how === 'error' && (reason === 'in' || reason === 'out') && g.atkTeam === w && g.lastTeam !== w && g.rally.hits - g.atkHits <= 1 &&
        g.lastPlayer && (g.lastShot === 'shank' || g.lastPlayer.grade === 'poor')) how = g.atkHow;
    // insignias: asistencia (colocador del remate que gana el punto) y block-out (remate que toca el bloqueo rival y sale)
    var assist = how === 'kill' && g.atkHow === 'kill' && g.atkTeam === w ? (g.atkSet || null) : null;
    var tool = g.lastKind === 'block' && g.prevKind === 'spike' && g.lastTeam !== w && (reason === 'out' || reason === 'antenna');
    if (g.stats) {
      if (how === 'ace') g.stats.aces[w]++; else if (how === 'kill') g.stats.kills[w]++; else if (how === 'block') g.stats.stuffPts[w]++;
      if (p) g.stats.faults[reason] = (g.stats.faults[reason] || 0) + 1;
    }
    // ¿cierra el set / el partido? ¿cambio de campo a los 8 del set decisivo? (se decide aquí para que el evento lo lleve)
    var tgt = setTarget(g), a = g.score[0], bb = g.score[1], half = Math.ceil(tgt / 2);
    var setWon = g.score[w] >= tgt && g.score[w] - g.score[1 - w] >= 2, matchWon = setWon && g.sets[w] === 1;
    var eight = !setWon && g.setNo === 3 && !g.courtSwap3 && g.score[w] === half && g.score[1 - w] < half;
    // contexto (SIM-01): racha en el set, punto de set/partido salvado, defensas de remate del peloteo
    if (g.streakTeam === w) g.streakN++; else { g.streakTeam = w; g.streakN = 1; }
    var saved = g.setPoint === 1 - w, digs = g.rally.digs;
    var clutch = clutchOf(a - (w === 0 ? 1 : 0), bb - (w === 1 ? 1 : 0), tgt);
    var perfectKill = how === 'kill' && g.atkHow === 'kill' && g.atkHuman && g.atkGrade === 'perfect';
    var hl = highlightOf({ how: how, rallyHits: g.rally.hits, digs: digs, perfectKill: perfectKill, setPoint: g.setPoint !== -1,
      matchPoint: g.matchPoint !== -1, clutch: clutch, saved: saved, streak: g.streakN, setWon: setWon, matchWon: matchWon });
    // señal oficial (SIM-02). 'touched' (balón tocado y fuera): el último contacto fue del equipo que RECIBÍA el ataque o
    // el saque rival (su bloqueo, o su primer toque: recepción/defensa, también desviada o de rebote en el cuerpo)
    var touchedOut = reason === 'out' && (g.lastKind === 'block' || (g.lastKind === 'pass' && g.touches === 1 && g.touchTeam === g.lastTeam));
    var signal = sig || (reason === 'out' ? (touchedOut ? 'touched' : 'out') : SIGNAL[reason] || reason);
    var ll = g.lastLand, landSide = (reason === 'in' || reason === 'out') && ll && ll.t === g.time ? (ll.x > 0 ? 0 : 1) : -1;
    // pausa del punto (SIM-03): con g.present (partido humano) más larga para los momentos grandes; si no, la de siempre
    var hold;
    if (g.present) hold = matchWon ? HOLD.match : setWon ? HOLD.set : (hl >= HOLD.bigAt ? HOLD.big : HOLD.routine) + (eight ? HOLD.eight : 0);
    else hold = matchWon ? HOLD_LEGACY.match : setWon ? HOLD_LEGACY.set : (g.demo ? RITUAL.demoHold : HOLD_LEGACY.routine) + (eight ? HOLD_LEGACY.eight : 0);
    g.timer = hold; g.hold = hold;
    var ev = emit(g, { type: 'point', team: w, reason: reason, text: text, how: how, score: [g.score[0], g.score[1]],
      sideout: sideout, rallyTime: g.rally.t, rallyHits: g.rally.hits, setWon: setWon, matchWon: matchWon, player: p || null,
      lastKind: g.lastKind, lastShot: g.lastShot,
      highlight: hl, digs: digs, streak: g.streakN, savedSetPoint: saved, clutch: clutch,
      signal: signal, touchedOut: touchedOut, landSide: landSide, hold: hold, assist: assist, tool: tool });
    if (reason === 'antenna') ev.antenna = g.antennaHit ? [g.antennaHit.x, g.antennaHit.y, g.antennaHit.z] : null; // null = por fuera de la antena
    g.lastPoint = { team: w, reason: reason, text: text, how: how, highlight: hl, digs: digs, streak: g.streakN, savedSetPoint: saved, clutch: clutch,
      signal: signal, touchedOut: touchedOut, landSide: landSide, hold: hold, setWon: setWon, matchWon: matchWon, assist: assist, tool: tool };
    if (g.stats) g.stats.how[how] = (g.stats.how[how] || 0) + 1;
    if (sideout) { // cambio de saque: rota el sacador del equipo que recupera el saque
      g.serving = w; g.serverIdx[w] = (g.serverIdx[w] + 1) % 2;
      emit(g, { type: 'sideout', team: w });
    }
    if (setWon) {
      g.sets[w]++; g.setScores.push([a, bb]);
      if (matchWon) {
        g.mode = 'over';
        emit(g, { type: 'set', team: w, setNo: g.setNo, score: [a, bb], sets: [g.sets[0], g.sets[1]] });
        emit(g, { type: 'match', team: w, sets: [g.sets[0], g.sets[1]], setScores: g.setScores.slice() });
      } else {
        g.pendingSet = true; // (la pausa ya incluye la del cambio de campo)
        emit(g, { type: 'set', team: w, setNo: g.setNo, score: [a, bb], sets: [g.sets[0], g.sets[1]] });
        courtChange(g, 'set');
      }
    } else if (eight) {
      // Regla 18.2.2: en el set decisivo, cuando un equipo llega a 8 puntos se cambia de campo (sin demora)
      g.courtSwap3 = true;
      courtChange(g, 'eight');
    }
  }
  /** Saltar la pausa del punto (SIM-03). En 'point'/'over', pasados HOLD.skipAfter (0,8 s) de la pausa, la recorta a
   *  HOLD.skipTo (0,3 s) como mucho; nunca a menos: el silbato, el cambio de campo y la vuelta al saque siguen su
   *  orden. Devuelve true si se ha aceptado (también si ya quedaban menos de 0,3 s). Sin efecto en 'serve'/'rally'
   *  ni con el partido ya terminado (gameOver emitido). Solo toca g.timer (y, en 'over', renuncia al challenge pendiente). */
  function skipHold(g) {
    if (g.review) return false;
    if ((g.mode !== 'point' && g.mode !== 'over') || g.finished || !(g.timer > 0)) return false;
    if (g.hold - g.timer < HOLD.skipAfter) return false;
    if (g.timer > HOLD.skipTo) g.timer = HOLD.skipTo;
    if (g.mode === 'over' && g.call) g.call.waived = true; // saltar el final del partido renuncia al challenge pendiente
    return true;
  }
  /* ---------- Challenge (B2/B3, notes/challenge-fivb.md) ----------
   * 2 por set (g.challenges), solo dentro/fuera de un bote; ventana de CHAL.window s desde el punto y hasta que se saca la
   * siguiente jugada. Acertado: se conserva y el punto pasa al otro equipo (instantánea previa al punto); fallado: se pierde.
   * Durante la revisión (g.review) la simulación queda en espera sin cambiar g.mode. */
  var CHAL = VB.CHAL = { window: 7, dur: 4.5, perSet: 2, cpuNear: 0.05, cpuP: 0.6, cpuFarP: 0.25, cpuRightP: 0.07, cpuWrongP: 0.02, cpuMin: 1.5, cpuMax: 3 };
  function snapOf(g) {
    return { score: g.score.slice(), sets: g.sets.slice(), setNo: g.setNo, serving: g.serving, serverIdx: g.serverIdx.slice(),
      setScores: g.setScores.map(function (s) { return s.slice(); }), streakTeam: g.streakTeam, streakN: g.streakN, courtSwap3: g.courtSwap3,
      pendingSet: g.pendingSet, setPoint: g.setPoint, matchPoint: g.matchPoint, challenges: g.challenges.slice(), lastPoint: g.lastPoint };
  }
  /** Challenges que le quedaban a team en el set de la llamada c (si ya empezó el set siguiente, los de la instantánea). */
  function chalLeft(g, c, team) {
    if (c.setNo === undefined || c.setNo === g.setNo) return g.challenges[team];
    return g._snap ? g._snap.challenges[team] : 0;
  }
  /** s que quedan de ventana para que team pida challenge (0 si no puede). */
  function canChallenge(g, team) {
    var c = g.call;
    if (!c || c.used || g.review || g.finished || c.team !== team || !(chalLeft(g, c, team) > 0)) return 0;
    if (g.mode !== 'point' && g.mode !== 'over' && g.mode !== 'serve') return 0; // en 'rally' ya se ha sacado
    var left = CHAL.window - (g.time - c.t);
    return left > 0 ? left : 0;
  }
  function challenge(g, team) {
    if (!(canChallenge(g, team) > 0)) return false;
    var c = g.call; c.used = true; g.cpuChal = null;
    g.review = dblFields({ team: team, t: 0, dur: CHAL.dur, x: c.x, y: c.y, dist: c.dist, truthIn: c.truthIn, calledIn: c.calledIn, overturned: c.wrong });
    endSwing(g);
    emit(g, { type: 'challenge', team: team, x: c.x, y: c.y });
    return true;
  }
  function endReview(g) {
    var r = g.review, c = g.call; g.review = null;
    if (r.overturned && g._snap) {
      var s = g._snap, wOld = 1 - c.team;
      g.score = s.score; g.sets = s.sets; g.setNo = s.setNo; g.serving = s.serving; g.serverIdx = s.serverIdx; g.setScores = s.setScores;
      g.streakTeam = s.streakTeam; g.streakN = s.streakN; g.courtSwap3 = s.courtSwap3; g.pendingSet = s.pendingSet;
      g.setPoint = s.setPoint; g.matchPoint = s.matchPoint; g.challenges = s.challenges; g.lastPoint = s.lastPoint;
      if (g.stats) { g.stats.points--; g.stats.won[wOld]--; }
      if (g.mode === 'serve') { endRitual(g); endSwing(g); g.serveState = 'ready'; }
      // mismo bote (landSide del punto nuevo); si ya se preparó el saque siguiente, lastLand puede venir a null: se rehace con la llamada
      g.ball.held = null; if (g.lastLand) g.lastLand.t = g.time; else g.lastLand = { x: c.x, y: c.y, inside: c.truthIn, t: g.time };
      // se vuelve a pitar el punto con la llamada correcta (marcador, saque, set/partido y pausas como un punto normal)
      g.mode = 'rally';
      point(g, c.alt[0], c.alt[1], c.alt[2]);
      g.call = c; c.used = true; c.calledIn = c.truthIn; c.wrong = false; c.team = 1 - c.alt[0]; g._snap = null;
    } else {
      // se gasta del set de la llamada: si ya empezó el siguiente, ese set ya está cerrado y el nuevo conserva los suyos
      if (c.setNo === undefined || c.setNo === g.setNo) g.challenges[r.team] = Math.max(0, g.challenges[r.team] - 1);
      else if (g._snap) g._snap.challenges[r.team] = Math.max(0, g._snap.challenges[r.team] - 1);
      if ((g.mode === 'point' || g.mode === 'over') && g.timer < 1) g.timer = 1; // un respiro antes del saque
      else if (g.mode === 'serve') { endRitual(g); endSwing(g); setupServe(g); } // se vuelve a autorizar el saque desde el principio
    }
    emit(g, { type: 'challengeResult', team: r.team, overturned: r.overturned, dist: r.dist, truthIn: r.truthIn, calledIn: r.calledIn,
      x: r.x, y: r.y, left: [g.challenges[0], g.challenges[1]] });
  }
  /** B3: la CPU decide si pide challenge al acabar el punto (gasta azar solo con un bote a <= 10 cm de la línea). */
  function cpuChallengeDecide(g) {
    var c = g.call; if (!c || c.used) return;
    var t = c.team, ai = t === 1 || g.demo || g.autopilot;
    if (!ai || !(g.challenges[t] > 0) || Math.abs(c.dist) > ((g.refErr || REF_ERR).d3)) return;
    // la CPU "lo ha visto": pide sobre todo cuando el árbitro se equivocó; con la llamada bien hecha, muy rara vez
    var near = Math.abs(c.dist) < CHAL.cpuNear;
    var pr = c.wrong ? (near ? CHAL.cpuP : CHAL.cpuFarP) : (near ? CHAL.cpuRightP : CHAL.cpuWrongP);
    if (g.rng() < pr) g.cpuChal = { team: t, at: g.time + CHAL.cpuMin + g.rng() * (CHAL.cpuMax - CHAL.cpuMin) };
  }

  /** Cambio de campo (reglas 18.2.1 y 18.2.2). Es PRESENTACIÓN: el humano sigue en x > 0 (controles relativos
   *  a la cámara); la UI muestra el aviso y arena/cámara pueden escenificarlo. */
  function courtChange(g, why) {
    if (g.stats) g.stats.courtChanges++;
    emit(g, { type: 'courtChange', setNo: g.setNo, why: why, score: [g.score[0], g.score[1]], sets: [g.sets[0], g.sets[1]], pause: why === 'set' ? 1.0 : 1.4 });
  }

  // ---------- Jugadores ----------
  function jump(g, p, jvx, jvy) {
    if (p.z === 0 && p.vz === 0 && p.down <= 0) {
      p.vz = C.JUMP_V * (p.ak ? p.ak.jump : 1); p.onGround = false; p.lastAction = 'jump'; p.actionT = 0;
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
    else {
      var spk = p.ak && isHuman(g, p) ? p.ak.speed : 1;
      if (p.badges && g.mode === 'rally') spk *= BADGE.motor[bl(p, 'motor')]; // Motor (humano e IA)
      p.x += mx * C.SPEED * spk * dt; p.y += my * C.SPEED * spk * dt;
    }
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

  /** Plancha que no llega (IA): se lanza tarde, el balón pasa. Mismo evento `dive` (con miss:true), sin toque. */
  function diveMiss(g, p) {
    var b = g.ball, dx = b.x - p.x, dy = b.y - p.y, dl = Math.hypot(dx, dy) || 1;
    var reachOut = Math.max(0, dl - C.REACH * 0.7);
    p.lvx = dx / dl * reachOut * 6; p.lvy = dy / dl * reachOut * 6;
    p.down = 0.9; p.anim = 0.3; p.lastAction = 'dive'; p.actionT = 0; p.shot = 'dive'; p.grade = 'poor';
    if (g.stats) { g.stats.dives++; g.stats.diveMiss++; }
    emit(g, { type: 'dive', player: p, x: b.x, y: b.y, z: b.z, dir: [dx / dl, dy / dl], miss: true });
  }

  /** Salto del humano. Cerca de la red (< 1,5 m) y con el balón del rival (cualquier número de toques, tras
   *  un bloqueo suyo, o el balón en su campo o yendo hacia la red), la inercia que añade el propio juego no le
   *  mete en la red: se limita la deriva hacia la red para caer a >= 0,40 m (la IA hace lo mismo). En el aire
   *  no hay control, así que un toque de red así sería culpa del juego, no del jugador. En jugada propia
   *  (ataque) la carrera sí puede llevarle a la red, como a la IA (netErr). */
  function humanJump(g, p) {
    var sd = side(p.team), b = g.ball;
    var jvx = p.vx * 0.3, jvy = p.vy * 0.3, jl = Math.hypot(jvx, jvy);
    if (jl > 0.6) { jvx *= 0.6 / jl; jvy *= 0.6 / jl; }
    var oppBall = g.touchTeam !== p.team || b.x * sd < 0 || (b.vx * sd < 0 && g.touches === 0);
    if (Math.abs(p.x) < 1.5 && oppBall && jvx * sd < 0) {
      var air = 2 * C.JUMP_V / C.G, minX = 0.40;
      if ((p.x + jvx * air) * sd < minX) jvx = Math.min(0, (minX - p.x * sd) / air) * sd;
    }
    jump(g, p, jvx, jvy);
  }

  // ---------- Gesto de golpeo del humano ----------
  function startSwing(g, p, shot) {
    if (g.swingLive) { g.swingShot = shot || ''; return false; } // durante el gesto, la última pulsación decide el golpe
    if (g.swingLock > 0) return false;
    g.hitBuf = g.tm.swing; g.swingLive = true; g.swingShot = shot || ''; g.swingT0 = g.time;
    if (p.anim <= 0) { p.anim = 0.18; }
    if (p.lastAction !== 'jump' || p.z <= 0) { p.lastAction = 'swing'; p.actionT = 0; }
    emit(g, { type: 'swing', player: p, shot: g.swingShot });
    return true;
  }
  /** Resuelve el gesto en curso: contacto (con espera asistida), plancha, o fallo al expirar. */
  function processSwing(g, p, aim) {
    if (!g.swingLive) return;
    // apuntado: el de ahora; si ya no se pulsa dirección, el último que se dio durante el gesto
    if (aim) { g.swingAim[0] = aim[0]; g.swingAim[1] = aim[1]; g.swingHasAim = true; }
    else if (g.swingHasAim) aim = g.swingAim;
    var w, b = g.ball, te;
    if (canReach(g, p)) {
      w = hitWindow(g, p);
      var wait = w.t > 0 && w.t <= Math.min(g.tm.assist, g.hitBuf) && w.reach;
      // saque: con el balón aún subiendo no hay contacto (no vale golpear el lanzamiento de camino arriba)
      var rising = g.mode === 'serve' && b.vz > 0;
      if (!wait && !rising) {
        // desfase = (pulsación + armado del brazo) - momento ideal. Pulsar WINDUP antes del ideal = 'perfect'
        te = g.swingT0 + C.WINDUP - (g.time + w.t);
        if (g.mode === 'serve') doServe(g, p, aim, te, null);
        else hit(g, p, aim, te, g.swingShot);
        return;
      }
    } else if (g.mode === 'rally' && !g.swingShot && canDive(g, p)) {
      w = hitWindow(g, p);
      if (!w.reach || b.z < 0.6) { dive(g, p, aim, g.swingT0 + C.WINDUP - (g.time + w.t)); return; }
    }
    if (g.hitBuf <= 0) { // el gesto termina sin contacto
      w = hitWindow(g, p);
      var near = Math.hypot(b.x - p.x, b.y - p.y) < 3.2;
      if (near && (g.mode === 'rally' || g.mode === 'serve')) {
        if (g.stats) g.stats.misses++;
        emit(g, { type: 'miss', player: p, reason: w.t > 0 ? 'early' : (w.reach ? 'late' : 'far'), t2: w.t });
      }
      endSwing(g); g.swingLock = g.tm.lock;
    }
  }

  /** Asistencia de movimiento: cerca del punto de contacto, el jugador humano se
   *  "imanta" suavemente y frena al llegar (la colocación gruesa sigue siendo suya). */
  var _mv = [0, 0];
  function assistMove(g, p, mx, my) {
    _mv[0] = mx; _mv[1] = my;
    if (g.jobs[0] !== p || p.z > 0 || p.down > 0) return _mv;
    var sd = side(p.team), tx, ty;
    if (atkPhase(g, 0) && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) { tx = g.pr3.x + sd * 0.35; ty = g.pr3.y; }
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
    g.lastLand = null; g.antennaHit = null; g.atkServe = null;
    g.server = sv; g.serveState = 'ready'; g.serveJump = false; g.serveClock = C.SERVE_CLOCK; g.serveT = 0; g.tossT = 0;
    g.serveNo++;
    g.serveAuth = false; g.whistleAt = g.demo ? RITUAL.demoWhistle : 0.7; // (también abajo, tras el serveReady: el ritual lo necesita ya)
    b.held = sv; b.vx = b.vy = b.vz = 0; b.dip = 0; b.wobA = 0;
    g.touchTeam = -1; g.touches = 0; g.lastPlayer = null; g.lastTeam = t; g.jobs[0] = g.jobs[1] = null; g.lastKind = ''; g.lastShot = '';
    g.hardIn = false; g.digOk = true; g.prevKind = ''; g.atkTeam = -1; g.atkHow = '';
    var prevCtrl = g.ctrl;
    if (g.ctrlMode !== 'one') g.ctrl = t === 0 ? sv : g.teams[0][0]; // modo 'one': el humano sigue con su jugador (si saca el compañero, saca la IA)
    endSwing(g); g.swingLock = 0; g.defRole = '';
    g.rally.t = 0; g.rally.hits = 0; g.rally.digs = 0; g.atkSet = null;
    serveAimReset(g, sv);
    // ¿Punto de set / punto de partido?
    var tgt = setTarget(g);
    g.setPoint = -1; g.matchPoint = -1;
    for (var k = 0; k < 2; k++) {
      if (g.score[k] >= tgt - 1 && g.score[k] - g.score[1 - k] >= 1) { g.setPoint = k; if (g.sets[k] === 1) g.matchPoint = k; }
    }
    // CPU: ritual con botes y lanzamiento a hora fija (g.timer = g.cpuTossIn = s hasta el lanzamiento); humano: sin ritual
    var tossIn = ritualSetup(g, sv, !isHuman(g, sv));
    g.timer = tossIn > 0 ? tossIn : (g.demo ? 0.9 : 1.3); g.cpuTossIn = tossIn;
    holdPos(g, sv, b); // en la mano ya en el frame de serveReady
    if (prevCtrl !== g.ctrl) emit(g, { type: 'switch', from: prevCtrl, to: g.ctrl, auto: true, reset: true });
    emit(g, { type: 'serveReady', team: t, player: sv, setPoint: g.setPoint, matchPoint: g.matchPoint });
    // el silbato de autorización llega un instante después (stepServe); desde él corren los 8 s
    g.serveAuth = false; g.whistleAt = g.demo ? RITUAL.demoWhistle : 0.7;
  }

  /** Lanza el balón para sacar. jumpServe: toss alto y adelantado + carrera y salto automáticos. */
  function toss(g, sv, jumpServe) {
    var b = g.ball, sd = side(sv.team);
    var rt = g.ritual; if (rt.on) { rt.on = false; rt.phase = 'none'; }
    if (g.cpuTossIn > 0) g.cpuTossIn = 0;                  // CPU: lanzado (0 hasta que acaba el saque)
    b.held = null; g.serveState = 'toss'; g.serveJump = !!jumpServe; g.tossT = 0;
    holdPos(g, sv, b); // sale de la mano izquierda, a la altura del pecho
    var hx, hy = sv.y; // punto de contacto (sobre el hombro derecho, algo delante)
    if (jumpServe) {
      var apex = 4.6, vz0 = Math.sqrt(2 * C.G * (apex - b.z));
      var hz = C.ZC.jserve + C.JUMP_V * C.JUMP_V / (2 * C.G);           // mano en lo alto del salto
      var tb = (vz0 + Math.sqrt(Math.max(0, vz0 * vz0 - 2 * C.G * (hz - b.z)))) / C.G;
      g.jumpAt = tb - C.JUMP_V / C.G - 0.02;                               // despegue para coincidir
      hx = sv.x - sd * 1.35;                                               // carrera de 0,75 m + golpeo delante
      b.vz = vz0; b.vx = (hx - b.x) / tb; b.vy = (hy - b.y) / tb;
    } else {
      var top = 3.0, vz1 = Math.sqrt(2 * C.G * (top - b.z));
      var tf = (vz1 + Math.sqrt(2 * C.G * (top - (sv.z + C.ZC.fserve)))) / C.G; // cae a la altura del golpeo
      hx = sv.x - sd * 0.38;
      b.vz = vz1; b.vx = (hx - b.x) / tf; b.vy = (hy - b.y) / tf;
      g.jumpAt = 0;
    }
    g.lastTouchT = g.time;
    sv.lastAction = 'toss'; sv.actionT = 0; sv.anim = 0.3;
    if (!isHuman(g, sv)) { var pr = profOf(g, sv); g.aiServeTe = clamp(gauss(g) * aiTiming(g, sv, pr) * 0.9, -0.25, 0.2); } // tope tardío 0,2: con 0,25 la ventana de alcance (canReach, ~-0,23 s) se cerraba antes y la CPU dejaba caer su propio lanzamiento
    emit(g, { type: 'toss', player: sv, team: sv.team, jump: g.serveJump, human: isHuman(g, sv) });
  }

  function doServe(g, sv, aim, te, tgt) {
    var sd = side(sv.team), b = g.ball, prof = profOf(g, sv), human = isHuman(g, sv);
    b.held = null;
    te = te || 0;
    if (human && sv.ak) te /= sv.ak.wSrv;
    if (human && sv.badges) { var sw = sangreW(g, sv); if (sw !== 1) te /= sw; } // Sangre fría
    var q = timingQ(te), grade = gradeOf(q), mul = human ? 1 : prof.err, v, power, er, tx, ty;
    // saque dirigible (humano): a la diana g.aim3, con una dispersión uniforme en un círculo de radio serveSpread(q)
    var aimed = human && !tgt && g.aim3.on && g.aim3.kind === 'serve', ox = 0, oy = 0;
    if (tgt) { tx = tgt[0]; ty = tgt[1]; }
    else if (aimed) {
      tx = g.aim3.x; ty = g.aim3.y;
      var srr = serveSpread(q, g.serveJump) * (sv.ak ? sv.ak.srvSpread : 1) * Math.sqrt(g.rng()), sra = g.rng() * 6.2832;
      ox = srr * Math.cos(sra); oy = srr * Math.sin(sra);
    }
    else {
      tx = -sd * 6; ty = 0;
      if (aim) { tx += aim[0] * 2.4; ty += aim[1] * 3.4; }
      tx = -sd * clamp(-sd * tx, 2, 8.4); ty = clamp(ty, -4, 4);
    }
    g.aim3.on = false;
    if (g.serveJump) { // saque en salto: potente y con liftado
      var spd = human ? 12.5 + 5 * q + (sv.ak ? sv.ak.serve : 0) : prof.jserve * (0.86 + 0.14 * q);
      var sboost = sv.badges ? BADGE.bombardero[bl(sv, 'bombardero')] : 0; // Bombardero (m/s)
      er = (0.3 + 1.5 * (1 - q)) * mul; power = clamp((spd + sboost - 10) / 8, 0, 1);
      b.dip = C.G * (0.12 + 0.25 * q);
      if (sboost > 0) { b.dip = boostDip(b.dip, spd, spd + sboost); spd += sboost; }
      if (aimed) v = launchDirect(b, tx + ox, ty + oy, C.BR, spd, C.G + b.dip); // bota en la diana (± dispersión)
      else v = launchDirect(b, tx + rnd(g, er), ty + rnd(g, er), 0, spd, C.G + b.dip);
      if (q < 0.45 && g.rng() < (0.5 - q) * 0.7) v[2] -= 1.1 + g.rng() * 0.8; // a la red
      b.wobA = 0;
    } else { // flotante: más lento, pero baila
      er = (0.3 + 1.3 * (1 - q)) * mul; power = 0.25 + 0.2 * q;
      var ap = Math.max(b.z + 0.35, 3.25 + (1 - q) * 0.4 + (human ? 0 : (prof.srvSoft || 0)));
      if (aimed) { // saque dirigible: el baile se decide antes de lanzar para que la diana marque dónde cae (FLOAT_DANCE de baile)
        var netBall = q < 0.45 && g.rng() < (0.5 - q) * 0.6;
        b.dip = 0; b.wobA = (2 + 4.2 * q) * BADGE.flotador[bl(sv, 'flotador')]; b.wobF = 3.6 + g.rng() * 2; b.wobP = g.rng() < 0.5 ? -1 : 1;
        if (netBall) v = launchApex(b, tx + ox, ty + oy, 0, 2.75); // se queda en la red
        else v = aimFloat(b, tx + ox, ty + oy, ap);
      } else {
        if (q < 0.45 && g.rng() < (0.5 - q) * 0.6) v = launchApex(b, tx + rnd(g, er), ty + rnd(g, er), 0, 2.75);
        else v = launchSafe(b, tx + rnd(g, er), ty + rnd(g, er), 0, ap);
        b.dip = 0; b.wobA = (2 + 4.2 * q) * (human ? 1 : prof.float); b.wobF = 3.6 + g.rng() * 2; b.wobP = g.rng() < 0.5 ? -1 : 1; // wobP = sentido
        if (sv.badges) b.wobA *= BADGE.flotador[bl(sv, 'flotador')];      // Hoja seca
      }
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
    g.lastTouchT = g.time; g.hardIn = b.speed > 13; g.netSince = false; g.prevKind = '';
    g.atkTeam = sv.team; g.atkHow = 'ace'; g.atkHits = g.rally.hits; g.atkHuman = human; g.atkGrade = grade; g.atkSet = null;
    // ¿Recibirá bien la IA? Función CONTINUA de la dificultad del saque (velocidad, baile del flotante, zona y
    // carrera del receptor), escalada por la recepción del perfil. (Antes era un corte duro a 13 m/s: un
    // flotante sin apuntar nunca podía ser ace y su baile no contaba.)
    var rp = g.prof[1 - sv.team];
    g.recvRisk = serveRisk(g, 1 - sv.team);
    // Ancla (IA): el receptor previsto (el que llega antes al bote) recibe con recv + 0,02/0,04/0,06
    if (g.recvRisk > 0 && g._rc && g._rc.who) { var al = bl(g._rc.who, 'ancla'); if (al) rp = { recv: Math.min(0.99, rp.recv + BADGE.anclaAI[al]) }; }
    g.digOk = g.rng() >= recvFail(g.recvRisk, rp);
    if (human) g.lastGrade = grade;
    if (g.stats) { g.stats.serves[sv.team]++; g.stats.hits.serve++; g.stats.grades[grade]++; if (human) g.stats.hgrades[grade]++; g.stats.shots[sv.shot] = (g.stats.shots[sv.shot] || 0) + 1; }
    emit(g, { type: 'hit', kind: 'serve', player: sv, team: sv.team, touch: 0, quality: q, grade: grade, timing: te,
      power: power, shot: sv.shot, dive: false, aim: aim ? [aim[0], aim[1]] : null, target: [tx, ty],
      x: b.x, y: b.y, z: b.z, speed: b.speed, human: human, dig: false, recv: false });
    endSwing(g);
  }

  /* Saque dirigible flotante: el baile (b.wobA/wobF/wobP ya decididos) desvía el balón de forma determinista. aimFloat lanza de
   * forma que el balón, bailando, caiga en la diana con un resto de FLOAT_DANCE del desvío (el flotante sigue bailando) y pase la
   * red con margen (el desvío hacia atrás del baile metía en la red los flotantes cortos). floatPath integra el vuelo como stepBall. */
  var FLOAT_DANCE = 0.25, _fp = { lx: 0, ly: 0, nz: 9, ny: 0 };
  function floatPath(b, v) {
    var x = b.x, y = b.y, z = b.z, vx = v[0], vy = v[1], vz = v[2], A = b.wobA, F = b.wobF, P = b.wobP, h = 1 / 240, t = 1 / 120;
    _fp.nz = 9; _fp.ny = 0;
    for (var i = 0; i < 1200; i++) {
      var ph = F * t, px = x;
      vy += A * P * Math.cos(ph) * h; vx += A * 0.25 * Math.sin(ph * 1.7) * h;
      vz -= C.G * h; x += vx * h; y += vy * h; z += vz * h; t += h;
      if ((px > 0) !== (x > 0)) { _fp.nz = z; _fp.ny = y; }
      if (z <= C.BR) break;
    }
    _fp.lx = x; _fp.ly = y; return _fp;
  }
  function aimFloat(b, tx, ty, ap) {
    var v = launchSafe(b, tx, ty, C.BR, ap), r = floatPath(b, v);
    var gx = tx + FLOAT_DANCE * (r.lx - tx), gy = ty + FLOAT_DANCE * (r.ly - ty), ax = tx, ay = ty, apex = ap;
    for (var it = 0; it < 24; it++) {
      if (r.nz < C.NET_H + C.BR + 0.12) apex += 0.25;                // roza la red: más alto (globo si es corto)
      else { var ex = gx - r.lx, ey = gy - r.ly; if (ex * ex + ey * ey < 0.0009) break; ax += ex; ay += ey; } // hacia el punto buscado
      v = launchSafe(b, ax, ay, C.BR, apex); r = floatPath(b, v);
    }
    return v;
  }

  function smooth01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  /** Dificultad del saque recién golpeado para el equipo receptor rt (0 = cómodo, ~1 = muy difícil).
   *  Suma: velocidad (desde 10 m/s), baile del flotante (desvío lateral ~2A/F²), margen de carrera del
   *  receptor más rápido hasta el bote (VB.AI.timeTo, con la lectura del saque), cerca de las líneas o corto,
   *  y "entre los dos" (zona de nadie). Un saque que cae fuera no exige recepción (0). */
  function serveRisk(g, rt) {
    var b = g.ball, G = gEff(b);
    var ft = (b.vz + Math.sqrt(b.vz * b.vz + 2 * G * Math.max(0, b.z - C.BR))) / G;
    var lx = b.x + b.vx * ft, ly = b.y + b.vy * ft, sr = side(rt);
    if (Math.abs(lx) > C.HL + 0.15 || Math.abs(ly) > C.HW + 0.15 || lx * sr <= 0) return 0;
    // ritmo: lo que cuenta para el receptor es el TIEMPO de vuelo (un flotante largo va más rápido solo
    // porque recorre más distancia: no por eso es más difícil); 1,0 s o menos = muy rápido
    var pace = smooth01((1.5 - ft) / 0.55);
    var dev = b.wobA ? 2 * b.wobA / (b.wobF * b.wobF) : 0, wob = smooth01(dev / 0.6);
    var AI = VB.AI, best = 9, mind = 9, who = null;
    for (var i = 0; i < 2; i++) {
      var q = g.teams[rt][i], tq = AI && AI.timeTo ? AI.timeTo(g, q, lx, ly) : Math.hypot(q.x - lx, q.y - ly) / C.SPEED;
      if (tq < best) { best = tq; who = q; }
      var dq = Math.hypot(q.x - lx, q.y - ly); if (dq < mind) mind = dq;
    }
    var margin = ft - best - g.prof[rt].react - 0.2;                 // 0,2 s: leer el saque
    var run = smooth01((0.5 - margin) / 0.8);                        // hay que correr (o tirarse) para llegar
    var move = smooth01((mind - 0.9) / 2.4);                         // lejos de las manos del receptor
    var depth = Math.abs(lx);
    var line = Math.max(smooth01((Math.abs(ly) - 2.7) / 1.4), smooth01((depth - 6.9) / 1.8), smooth01((5 - depth) / 2));
    var rc = g._rc || (g._rc = {});
    rc.pace = pace; rc.wob = wob; rc.run = run; rc.move = move; rc.line = line; rc.ft = ft; rc.who = who; // who: receptor previsto
    return RISK_W.pace * pace + RISK_W.wob * wob + RISK_W.run * run + RISK_W.move * move + RISK_W.line * line;
  }
  var RISK_W = { pace: 0.85, wob: 0.42, run: 0.35, move: 0.3, line: 0.27 };
  /** Probabilidad de que el receptor IA no controle un saque de dificultad `risk` (perfil de recepción rp.recv). */
  function recvFail(risk, rp) {
    var x = Math.max(0, risk - 0.25);
    return clamp(x * x * (0.14 + (1 - rp.recv) * 1.3), 0, 0.8);
  }

  function stepServe(g, dt, input, mx, my, aim, human) {
    var sv = g.server, b = g.ball, sd = side(sv.team), i, p;
    var hs = human && sv.team === 0 && sv === g.ctrl; // saca el humano (modo 'one': solo si saca su jugador)
    g.serveT += dt;
    if (!g.serveAuth && g.serveT >= g.whistleAt) { g.serveAuth = true; emit(g, { type: 'whistle', reason: 'serve' }); } // autorización del saque
    if (g.serveState === 'ready') {
      if (hs) {
        // El sacador humano se desplaza a lo ancho de la zona de saque
        stepPlayer(g, sv, dt, 0, my * 0.8); sv.y = clamp(sv.y, -4.3, 4.3);
        if (g.serveAuth) { if (input.jump || input.jset) toss(g, sv, true); else if (input.hit) toss(g, sv, false); }
        if (g.serveState === 'ready' && g.serveAuth && g.opts.serveClock !== false) {
          g.serveClock -= dt;
          if (g.serveClock <= 0) { g.serveClock = 0; fault(g, sv.team, 'serve', 'Falta de saque: 8 segundos', sv, 'delay8'); return; }
        }
      } else {
        stepPlayer(g, sv, dt, 0, 0);
        g.timer -= dt;
        if (g.cpuTossIn >= 0) g.cpuTossIn = g.timer > 0 ? g.timer : 0;
        if (g.serveAuth && g.opts.serveClock !== false) g.serveClock -= dt; // el reloj de 8 s corre para todos (la CPU lanza antes de 4,5 s)
        ritualStep(g, sv);
        if (g.timer <= 0 && g.serveAuth) toss(g, sv, g.rng() < profOf(g, sv).jumpServe + BADGE.bombarderoAI[bl(sv, 'bombardero')]);
      }
    } else { // balón en el aire
      g.tossT += dt;
      if (hs) updateServeAim(g, sv, dt, mx, my); // saque dirigible: el stick mueve la diana durante el lanzamiento
      if (g.serveJump && sv.z === 0 && sv.vz === 0 && g.tossT < g.jumpAt + 0.05) {
        // carrera de saque en salto (automática): 2 pasos hacia la red, despegue detrás de la línea
        var run = g.tossT > 0.2 ? 0.75 / Math.max(0.2, g.jumpAt - 0.2) / C.SPEED : 0;
        stepPlayer(g, sv, dt, -sd * run, 0);
        if (g.tossT >= g.jumpAt) jump(g, sv, -sd * 0.55, 0);
      } else stepPlayer(g, sv, dt, 0, 0);
      if (hs) {
        if ((input.jump || input.jset) && !g.serveJump) jump(g, sv, 0, 0); // salto con toss bajo: flotante en salto
        if (input.hit) startSwing(g, sv, '');
        processSwing(g, sv, aim);
        if (g.mode === 'serve' && g.hitBuf <= 0 && g.swingLive) { endSwing(g); g.swingLock = g.tm.lock; }
      } else if (canReach(g, sv) && b.vz <= 0) { // la IA golpea siempre con el balón ya bajando
        var w = hitWindow(g, sv);
        if (w.t <= -g.aiServeTe || !w.reach || b.vz < -6) doServe(g, sv, null, -w.t, VB.AI && VB.AI.serveTarget ? VB.AI.serveTarget(g, sv) : null);
      }
      if (g.mode === 'serve' && b.vz < 0 && b.z < sv.z + 1.0) { // el balón cae sin golpearlo
        fault(g, sv.team, 'serve', 'Falta de saque: el balón cae sin golpearlo', sv, 'serveFault'); return;
      }
    }
    for (i = 0; i < 4; i++) { p = g.players[i]; if (p !== sv) stepPlayer(g, p, dt, 0, 0); }
    stepBall(g, dt);
  }

  function nextSet(g) {
    g.pendingSet = false; g.setNo++; g.score = [0, 0]; g.serving = (g.setNo - 1) % 2; g.courtSwap3 = false;
    g.streakTeam = -1; g.streakN = 0; // la racha es dentro del set
    g.challenges = [perSet(g), perSet(g)]; // los challenges no se acumulan entre sets
    g.serverIdx = g.serving === 0 ? [0, 1] : [1, 0];
    if (g.ctrlIdx) g.serverIdx[0] = 1 - g.serverIdx[0]; // modo 'one' con el n.º 2: el orden de saque del equipo 0, en espejo
    emit(g, { type: 'newSet', setNo: g.setNo });
  }
  function newGame(g) {
    g.score = [0, 0]; g.sets = [0, 0]; g.setNo = 1; g.serving = 0; g.serverIdx = [0, 1]; g.setScores = [];
    // modo 'one' con el n.º 2 (ctrlIdx 1): orden de saque en espejo, así el jugador del humano saca primero como con el n.º 1
    if (g.ctrlIdx) g.serverIdx[0] = 1;
    g.pendingSet = false; g.finished = false; g.lastPoint = null; g.courtSwap3 = false;
    g.challenges = [perSet(g), perSet(g)]; g.call = null; g.review = null; g.cpuChal = null; g._snap = null; g._pendCall = null;
    g.streakTeam = -1; g.streakN = 0;
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
   *    SALTAR en el suelo = salto (remate/bloqueo); SALTAR en el aire = dejada.
   *    jset (COLOCAR): en el suelo = SALTAR; en el aire = colocación en salto (2.º toque, o 1.º con el balón alto en la red). */
  function step(g, dt, input) {
    input = input || NOIN;
    var AI = VB.AI, b = g.ball;
    g.time += dt; g.blockCD -= dt; g.hitBuf -= dt; g.swingLock -= dt; g.jsetQ -= dt;
    var human = !g.demo && !g.autopilot;
    var mv = input.move || NOIN.move, ml = dirLen(mv);
    var mx = mv[0], my = mv[1];
    if (ml > 1) { mx /= ml; my /= ml; ml = 1; }
    var aim = null;
    if (ml > 0.2) { _aim[0] = mx / ml; _aim[1] = my / ml; aim = _aim; }
    g.aimOn = !!aim; if (aim) { g.aimIn[0] = aim[0]; g.aimIn[1] = aim[1]; } // para aimPoint (UI/FX)
    var i, p;

    if (g.review) { // B2: revisión en curso: todo en espera (el reloj del punto no corre)
      g.review.t += dt;
      for (i = 0; i < 4; i++) stepPlayer(g, g.players[i], dt, 0, 0);
      if (g.mode === 'point' || g.mode === 'over') stepBall(g, dt);
      if (g.review.t >= g.review.dur) endReview(g);
      return;
    }
    if (g.cpuChal && g.time >= g.cpuChal.at) { var cc = g.cpuChal; g.cpuChal = null; if (challenge(g, cc.team)) return; }

    if (g.mode === 'point' || g.mode === 'over') {
      for (i = 0; i < 4; i++) stepPlayer(g, g.players[i], dt, 0, 0);
      stepBall(g, dt); g.timer -= dt;
      if (g.timer <= 0) {
        if (g.mode === 'over') {
          if (g.demo) { newGame(g); }
          else if (!(g.call && g.call.waived) && (canChallenge(g, 0) > 0 || canChallenge(g, 1) > 0 || g.cpuChal)) g.timer = 0; // B2: la ventana dura sus 7 s también en el punto de partido
          else if (!g.finished) { g.finished = true; emit(g, { type: 'gameOver', team: g.sets[0] > g.sets[1] ? 0 : 1, sets: [g.sets[0], g.sets[1]], setScores: g.setScores.slice() }); }
        } else { if (g.pendingSet) nextSet(g); setupServe(g); }
      }
      return;
    }
    if (g.mode === 'serve') { stepServe(g, dt, input, mx, my, aim, human); if (g.mode !== 'serve') endRitual(g); refreshPred(g); return; }
    // ---- Peloteo ----
    g.rally.t += dt;
    // (g.pr1/g.pr3 ya están al día: se recalculan al final de cada paso, ver refreshPred)
    g.jobs[0] = AI.computeJob(g, 0); g.jobs[1] = AI.computeJob(g, 1);
    var hp = null;
    if (!g.demo) {
      var cpuSet = updateDefense(g);
      // el control pasa solo al que le toca jugar el siguiente toque, salvo:
      //  - el humano eligió bloquear (defRole 'block'): sigue en el bloqueo hasta que el balón vuelva a ser nuestro;
      //  - balón rápido a menos de 0,6 s del contacto: un cambio ahí metería toda la ventana de defensa
      //    dentro del deslizamiento de la cámara. Juega el compañero IA y el control pasa en el siguiente toque.
      var fastLate = Math.hypot(b.vx, b.vy, b.vz) > 12 && g.pr1.t < 0.6;
      if (g.ctrlMode === 'one') {
        // modo 'one': nunca cambia el control; el compañero IA juega sus toques (AI.update)
      } else if (g.jobs[0] && g.jobs[0] !== g.ctrl) {
        if (!(g.defRole === 'block' && g.touchTeam === 1) && !fastLate) { emit(g, { type: 'switch', from: g.ctrl, to: g.jobs[0], auto: true }); g.ctrl = g.jobs[0]; endSwing(g); }
      } else if (!g.jobs[0] && input.switchPlayer && human) {
        var o2 = other(g, g.ctrl); emit(g, { type: 'switch', from: g.ctrl, to: o2, auto: false }); g.ctrl = o2; endSwing(g);
        if (cpuSet) g.defRole = g.defRole === 'block' ? 'dig' : 'block'; // durante la colocación rival: cambia de rol
      }
    }
    if (human) {
      hp = g.ctrl;
      if (input.jump || input.jset) { // COLOCAR (jset) en el suelo salta como SALTAR
        if (hp.z === 0 && hp.vz === 0) humanJump(g, hp);
        else if (input.jset && jsetVoid(g, hp)) { /* bloqueando un remate rival: COLOCAR no hace nada */ }
        else if (hp.z > 0.2 && hp.actionT > 0.12 && Math.hypot(b.x - hp.x, b.y - hp.y) < 3) startSwing(g, hp, input.jset ? 'jset' : 'tip'); // en el aire: colocación en salto / dejada
        else if (input.jset && hp.z > 0) g.jsetQ = JSET.buf; // recién despegado: COLOCAR se guarda JSET.buf s (doble pulsación rápida = salta y coloca)
      }
      if (g.jsetQ > 0 && hp.z > 0.2 && hp.actionT > 0.12 && Math.hypot(b.x - hp.x, b.y - hp.y) < 3 && !jsetVoid(g, hp)) { g.jsetQ = 0; startSwing(g, hp, 'jset'); }
      if (hp.z > 0) stepPlayer(g, hp, dt, 0, 0);
      else { var am = assistMove(g, hp, mx, my); stepPlayer(g, hp, dt, am[0], am[1]); }
      updateAim3(g, hp, dt, mx, my);
      if (input.hit && g.mode === 'rally') startSwing(g, hp, '');
      if (g.mode === 'rally') processSwing(g, hp, aim);
      if (g.lastTouchT === g.time && g.mode === 'rally') refreshPred(g); // la IA de este paso ya ve el balón nuevo
    }
    for (i = 0; i < 4; i++) { p = g.players[i]; if (p !== hp && g.mode === 'rally') AI.update(g, p, dt); }
    for (i = 0; i < 2 && g.mode === 'rally'; i++) stepBall(g, dt / 2);
    refreshPred(g);
  }

  /** A1: mira libre del remate. Atacante humano del 3.er toque en el aire: g.aim3 empieza en el objetivo por defecto
   *  (diagonal) y la dirección (mundo) lo mueve a AIM3_SPEED m/s dentro del campo rival. Fuera de ese caso, off. */
  var AIM3_SPEED = 11;
  function updateAim3(g, p, dt, mx, my) {
    var a = g.aim3, on = g.mode === 'rally' && p.team === 0 && p.z > 0 && atkPhase(g, 0);
    if (!on) { a.on = false; return; }
    var sd = side(p.team);
    if (!a.on || a.kind !== 'spike') { var d0 = attackTarget(p, null, 6); a.x = d0[0]; a.y = d0[1]; a.on = true; a.kind = 'spike'; }
    a.x = -sd * clamp(-sd * (a.x + mx * AIM3_SPEED * dt), 1.4, 8.3);
    a.y = clamp(a.y + my * AIM3_SPEED * dt, -3.9, 3.9);
  }

  /* Saque dirigible (sprint Carrera): mientras saca el humano, g.aim3 = {on: true, kind: 'serve', x, y} en el campo rival.
   * Aparece con el balón en la mano (serveReady) en el centro del fondo rival (SERVE_AIM0) y queda quieta en 'ready', porque
   * ahí el stick mueve al sacador a lo ancho; en el lanzamiento ('toss') la dirección (mundo) la mueve a SERVE_AIM_SPEED m/s
   * por todo el campo rival, hasta las líneas (|x| SERVE_AIM_MIN..HL, |y| <= HW). doServe apunta a ella con serveSpread(q). */
  var SERVE_AIM0 = 7.0, SERVE_AIM_SPEED = 12, SERVE_AIM_MIN = 1.0;
  function serveAimReset(g, sv) {
    var a = g.aim3;
    if (!isHuman(g, sv)) { a.on = false; a.kind = ''; return; }
    a.on = true; a.kind = 'serve'; a.x = -side(sv.team) * SERVE_AIM0; a.y = 0;
  }
  function updateServeAim(g, sv, dt, mx, my) {
    var a = g.aim3; if (!a.on || a.kind !== 'serve') return;
    var sd = side(sv.team);
    a.x = -sd * clamp(-sd * (a.x + mx * SERVE_AIM_SPEED * dt), SERVE_AIM_MIN, C.HL);
    a.y = clamp(a.y + my * SERVE_AIM_SPEED * dt, -C.HW, C.HW);
  }

  /** Predicciones de cruce (g.pr1 a 1 m, g.pr3 a 3 m) al día con el balón al FINAL del paso: lo que lee la
   *  UI/cámara/FX tras el paso (antes se calculaban al principio y tras un toque quedaban viejas un paso). */
  function refreshPred(g) {
    if (g.mode !== 'rally') return;
    predict(g, 1, g.pr1); predict(g, 3, g.pr3);
  }

  /** Rol defensivo del humano (revisión 2). El rol se decide ANTES del ataque, no después: en cuanto la CPU
   *  coloca para atacar (2º toque con el balón quedándose en su campo, ~1 s antes del remate), el humano pasa
   *  a DEFENDER: si su jugador es el que está más cerca de la red, el control se desliza al compañero de atrás
   *  (evento switch auto, reason 'defense') y el compañero IA bloquea. La cámara tiene tiempo de asentarse y
   *  el humano conserva defensa -> (colocación del compañero) -> remate. Mientras dura esa colocación, CAMBIAR
   *  intercambia los papeles (defRole 'block': el humano bloquea y defiende la IA).
   *  Antes el control saltaba del bloqueador al defensor ~0,43 s antes del contacto, en plena transición.
   *  Devuelve true durante la fase en la que se puede elegir rol (colocación rival, balón aún en su campo). */
  function updateDefense(g) {
    if (g.mode !== 'rally' || g.touchTeam !== 1 || g.lastKind === 'serve') { g.defRole = ''; return false; }
    var setPhase = atkPhase(g, 1) && g.ball.x < 0 && g.pr3.x < -0.2 && g.pr3.x > -4.2;
    if (setPhase && g.ctrlMode === 'one') {
      // modo 'one': sin cambio de control; bloquea el que esté más cerca de la red (el humano o su compañero IA).
      // El reparto se REVISA durante la colocación de la CPU: si el humano sube a la red (o salta cerca de ella), el
      // compañero IA se echa atrás a defender; si el humano se va al fondo, el compañero sube a bloquear. Con histéresis
      // (diferencia clara de posición) y congelado en el último tramo (sin tiempo para recolocarse) o con el compañero en el aire.
      var hc1 = g.ctrl, hm1 = other(g, hc1), hx = Math.abs(hc1.x), mx1 = Math.abs(hm1.x);
      if (!g.defRole) g.defRole = hx <= mx1 ? 'block' : 'dig';
      else if (g.pr3.t > 0.35 && hm1.z <= 0) {
        if (g.defRole === 'dig' && ((hx < 1.3 && hx < mx1 + 0.3) || hx < mx1 - 0.8 || (hc1.z > 0 && hx < 2))) g.defRole = 'block';
        else if (g.defRole === 'block' && hc1.z <= 0 && hx > 3.2 && hx > mx1 - 0.5) g.defRole = 'dig';
      }
    } else if (setPhase && !g.defRole) {
      g.defRole = 'dig';
      var c = g.ctrl, m = other(g, c);
      if (Math.abs(c.x) < Math.abs(m.x)) { // el humano está más cerca de la red: defiende el otro, bloquea la IA
        emit(g, { type: 'switch', from: c, to: m, auto: true, reason: 'defense' }); g.ctrl = m; endSwing(g);
      }
    }
    return setPhase;
  }

  /** Vacía y devuelve la cola de eventos (main.js lo hace una vez por frame). */
  function drainEvents(g, out) {
    out = out || [];
    for (var i = 0; i < g.events.length; i++) out.push(g.events[i]);
    g.events.length = 0; return out;
  }

  /** Destino previsto del golpe del HUMANO con la dirección actual (para la retícula de apuntado de FX/UI).
   *  Mismas fórmulas que doServe (sin objetivo de IA) y hit (remate attackTarget dd 6, dejada, balón libre
   *  dd 6,5), SIN el error aleatorio de ejecución. move: [wx,wy] opcional (entrada de mundo de este frame); si
   *  no se pasa, la del último paso de la sim (g.aimIn) o, sin dirección, la que se dio durante el gesto.
   *  Devuelve out = {x, y, kind:'serve'|'spike'|'tip'|'free', mode: 1 (vista previa: saque aún sin lanzar) |
   *  2 (activo), aimed (hay dirección), spread (m: dispersión con un toque 'perfect'), spreadPoor (con 'poor')}
   *  o null si ahora no toca apuntar (CPU sacando, sin ataque propio, demo/autopilot). Sin asignaciones si se
   *  pasa out. */
  var _ap = { x: 0, y: 0, kind: '', mode: 0, aimed: false, spread: 0, spreadPoor: 0, spreadNow: 0 }, _apA = [0, 0];
  function aimPoint(g, out, move) {
    if (g.demo || g.autopilot) return null;
    out = out || _ap;
    var a = null, b = g.ball, p, sd, tx, ty, kind, mode;
    if (move && move.length >= 2) {
      var ml = Math.hypot(move[0], move[1]);
      if (ml > 0.2) { _apA[0] = move[0] / ml; _apA[1] = move[1] / ml; a = _apA; }
    } else if (g.aimOn) a = g.aimIn;
    if (!a && g.swingLive && g.swingHasAim) a = g.swingAim;
    if (g.mode === 'serve') {
      p = g.server; if (!p || p.team !== 0 || p !== g.ctrl) return null; // modo 'one': no apunta el saque del compañero IA
      mode = g.serveState === 'toss' ? 2 : (g.serveAuth ? 1 : 0); if (!mode) return null;
      if (g.aim3.on && g.aim3.kind === 'serve') { // saque dirigible: la diana y su dispersión (radio) según el timing
        var jmp = g.serveState === 'toss' && g.serveJump, ssk = p.ak ? p.ak.srvSpread : 1;
        out.x = g.aim3.x; out.y = g.aim3.y; out.kind = 'serve'; out.mode = mode; out.aimed = true;
        out.spread = serveSpread(0.95, jmp) * ssk; out.spreadPoor = serveSpread(0.3, jmp) * ssk;
        out.spreadNow = g.serveState === 'toss' && b.vz <= 0 ? serveSpread(qNowServe(g, p), jmp) * ssk : out.spread + (out.spreadPoor - out.spread) * 0.5;
        return out;
      }
      sd = side(p.team); tx = -sd * 6; ty = 0;
      if (a) { tx += a[0] * 2.4; ty += a[1] * 3.4; }
      tx = -sd * clamp(-sd * tx, 2, 8.4); ty = clamp(ty, -4, 4); kind = 'serve';
      out.spread = 0.3 + 1.3 * 0.05; out.spreadPoor = 0.3 + 1.3 * 0.55; // flotante (el salto: algo más)
      if (g.serveJump) { out.spread = 0.3 + 1.5 * 0.05; out.spreadPoor = 0.3 + 1.5 * 0.55; }
    } else if (g.mode === 'rally') {
      p = g.ctrl;
      if (!p || p.team !== 0 || !atkPhase(g, 0) || b.x < -0.2 || b.x > 4.5) return null;
      if (g.swingLive && g.swingShot === 'jset' && p.z > 0) return null; // colocando en salto: no hay retícula de ataque
      mode = 2; sd = side(p.team);
      var air = isAttackContact(p, b);
      if (air && g.swingShot === 'tip') {
        kind = 'tip';
        tx = -sd * (1.6 + (a ? clamp(-sd * a[0], -0.3, 1) : 0.3)); ty = clamp(a ? p.y + a[1] * 2.6 : -p.y, -3.8, 3.8);
        out.spread = 0.25 + 0.9 * 0.05; out.spreadPoor = 0.25 + 0.9 * 0.55;
      } else if (g.aim3.on && g.aim3.kind !== 'serve' && (air || p.z > 0)) { // A1/A2: mira libre; el radio es la dispersión si golpeara AHORA
        tx = g.aim3.x; ty = g.aim3.y; kind = 'spike';
        var spk2 = p.ak ? p.ak.spread : 1;
        spk2 *= BADGE.mira[bl(p, 'mira')];
        out.spread = spikeSpread(0.95) * spk2; out.spreadPoor = spikeSpread(0.3) * spk2;
        out.spreadNow = spikeSpread(qNow(g, p)) * spk2;
        out.x = tx; out.y = ty; out.kind = kind; out.mode = mode; out.aimed = true;
        return out;
      } else {
        var at = attackTarget(p, a, air ? 6 : 6.5); tx = at[0]; ty = at[1];
        kind = air ? 'spike' : 'free';
        out.spread = air ? 0.25 + 1.5 * 0.05 : 0.35 + 1.4 * 0.05; out.spreadPoor = air ? 0.25 + 1.5 * 0.55 : 0.35 + 1.4 * 0.55;
      }
    } else return null;
    out.x = tx; out.y = ty; out.kind = kind; out.mode = mode; out.aimed = !!a;
    out.spreadNow = out.spread + (out.spreadPoor - out.spread) * 0.5;
    return out;
  }

  /** Calidad que tendría el golpe del humano si pulsara AHORA (o la del gesto en curso), como en processSwing/hit. */
  var _wq = {};
  function qNow(g, p) {
    var w = hitWindow(g, p, _wq), t0 = g.swingLive ? g.swingT0 : g.time;
    var te = t0 + C.WINDUP - (g.time + w.t);
    var q = timingQ(te) * (1 - 0.3 * clamp((w.d / C.REACH - 0.55) / 0.45, 0, 1));
    return clamp(q, 0, 1);
  }

  /** Calidad del saque del humano si pulsara AHORA (o la del gesto en curso), como en processSwing/doServe (sin distancia). */
  function qNowServe(g, p) {
    var w = hitWindow(g, p, _wq), t0 = g.swingLive ? g.swingT0 : g.time;
    var te = t0 + C.WINDUP - (g.time + w.t);
    if (p.ak) te /= p.ak.wSrv;
    if (p.badges) te /= sangreW(g, p);
    return timingQ(te);
  }

  /** Objetivo útil para el HUD/aro: dónde jugará el balón el equipo humano. */
  function focusPoint(g) {
    return atkPhase(g, 0) ? g.pr3 : g.pr1;
  }

  VB.Sim = {
    createGame: createGame, step: step, drainEvents: drainEvents, setTarget: setTarget, SET_POINTS: SET_POINTS,
    predict: predict, predictLanding: predictLanding, focusPoint: focusPoint,
    canReach: canReach, other: other, isHuman: isHuman, side: side, clamp: clamp,
    // añadidos (opcionales)
    hitWindow: hitWindow, aimPoint: aimPoint, predictKind: predictKind, canDive: canDive, timingQ: timingQ, gradeOf: gradeOf,
    normDiff: normDiff, DIFF: DIFF, TIMING: TIMING,
    atkPhase: atkPhase, canJset: canJset, jsetReady: jsetReady, jsetVoid: jsetVoid, JSET: JSET, // colocación en salto
    // internos expuestos para la IA y los tests
    _aimFloat: aimFloat, _floatPath: floatPath,
    _hit: hit, _jump: jump, _dive: dive, _diveMiss: diveMiss, _humanJump: humanJump, _holdPos: holdPos, _holdBase: holdBase, _ritualBall: ritualBall, _ritualStyle: ritualStyle, _stepPlayer: stepPlayer, _emit: emit, _rnd: rnd, _gauss: gauss,
    _setupServe: setupServe, _newGame: newGame, _makeRng: makeRng, _toss: toss, _doServe: doServe, _fault: fault,
    _inBlockVol: inBlockVol, _serveRisk: serveRisk, _recvFail: recvFail, _refreshPred: refreshPred,
    // presentación del punto (SIM-01/03)
    skipHold: skipHold, highlightOf: highlightOf, clutchOf: clutchOf,
    // ritual del sacador CPU (SIM-04)
    ritualAt: ritualAt,
    // remate apuntado (A2) y challenge (B2)
    statProf: statProf, attrK: attrK, profOf: profOf, ATTR_KEYS: ATTR_KEYS, spikeSpread: spikeSpread, serveSpread: serveSpread,
    // insignias: ids, nivel de un jugador, reacción/timing efectivos de la IA (ai.js), alcance
    BADGE_IDS: BADGE_IDS, badgeLevel: bl, aiReact: aiReact, aiTiming: aiTiming, reachOf: reachOf, canChallenge: canChallenge, challenge: challenge, lineDist: lineDist, refErrP: refErrP,
    _land: land, _point: point
  };
})();
