/* =====================================================================
 * VOLEY 3D — js/audio.js   (owner: audio)
 *
 * Sonido 100 % procedural con WebAudio. Sin ficheros, sin red.
 *  - Todos los efectos se sintetizan UNA vez en JS (Float32Array) y se
 *    reproducen como AudioBuffer: cada sonido cuesta 1 fuente + 1-3 nodos.
 *  - El AudioContext solo se crea tras un gesto del usuario (unlock()).
 *  - Guiado solo por eventos de la simulación (handle) + estado (update).
 *  - Se carga en node sin AudioContext (no toca nada hasta unlock()).
 *
 * Grafo:
 *   sfx ─────────────────────────────┐
 *   crowd ─> brillo ─> hueco silbato ┼─> fxFilter (pausa/cámara lenta) ─> master ─> compresor ─> compensación ─> recorte suave ─> destino
 *   reverb (envíos) ─────────────────┘                                    ^
 *   music (ráfagas + interfaz) ──────────────────────────────────────────┘
 *
 * Mezcla medida, no a oído: tools/audiotest.js (niveles LUFS por categoría, picos reales, render de un
 * partido en Chrome con OfflineAudioContext). Plan de niveles: LEVEL más abajo.
 * Mapa evento -> sonido: ver notes/audio.md.
 * ===================================================================== */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;
  var VB = root.VB = root.VB || {};
  var hasDoc = typeof document !== 'undefined';
  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------------
   * 1. DSP mínimo en JS (solo para generar los buffers una vez)
   * ------------------------------------------------------------------ */
  /* REGLA DE ASIGNACIÓN (medido, review 3): en un function* de V8, una variable double que pasa de una
   * iteración a la siguiente de un bucle que contiene un yield se guarda "en caja" (HeapNumber) en CADA
   * muestra, incluso con el código optimizado: el banco asignaba ~740 MB de basura para 11 MB de audio
   * (Chrome: ~1-4 MB/s durante el primer partido, recolecciones mayores frecuentes). Por eso todos los
   * generadores siguen el mismo patrón: bucle exterior por tramos de CH muestras (con el yield) y bucle
   * interior sin yield cuyas variables de estado se cargan de / guardan en un Float64Array (Z) por tramo.
   * El ruido se saca con rnd(st) (monomórfica, se inserta en línea) en vez de llamar al cierre rng(),
   * y las envolventes de la grada escriben en un array (o[0]) en vez de devolver un double. */
  function rnd(st) { var s = st[0]; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; st[0] = s; return st[0] * 2.3283064365386963e-10; }
  function makeRng(seed) { // xorshift32 determinista; estado en Uint32Array (f.st) para no crear números en el heap
    var st = new Uint32Array(1); st[0] = (seed >>> 0) || 0x2545F491;
    var f = function () { return rnd(st); }; f.st = st; return f;
  }
  /** Biquad RBJ: 'lp' | 'hp' | 'bp' (0 dB en el pico). Coeficientes y estado en un Float64Array: c = [b0 b1 b2 a1 a2 x1 x2 y1 y2]. */
  function Biq(type, f, q, sr) { this.c = new Float64Array(9); this.set(type, f, q, sr); }
  Biq.prototype.set = function (type, f, q, sr) {
    f = Math.max(10, Math.min(f, sr * 0.45));
    var w = TAU * f / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * (q || 0.707));
    var b0, b1, b2, a0 = 1 + a;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; }
    var k = this.c; k[0] = b0 / a0; k[1] = b1 / a0; k[2] = b2 / a0; k[3] = -2 * c / a0; k[4] = (1 - a) / a0;
  };
  Biq.prototype.p = function (x) {
    var k = this.c, y = k[0] * x + k[1] * k[5] + k[2] * k[6] - k[3] * k[7] - k[4] * k[8];
    k[6] = k[5]; k[5] = x; k[8] = k[7]; k[7] = y; return y;
  };
  /** d[a..b) = B2.p(B1.p(d[i])) en sitio, sin llamadas por muestra (cascada en double, como la llamada anidada). */
  function bq2Run(B1, B2, d, a, b) {
    var p = B1.c, q = B2.c;
    var p0 = p[0], p1 = p[1], p2 = p[2], p3 = p[3], p4 = p[4], px1 = p[5], px2 = p[6], py1 = p[7], py2 = p[8];
    var q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3], q4 = q[4], qx1 = q[5], qx2 = q[6], qy1 = q[7], qy2 = q[8];
    for (var i = a; i < b; i++) {
      var x = d[i], y = p0 * x + p1 * px1 + p2 * px2 - p3 * py1 - p4 * py2; px2 = px1; px1 = x; py2 = py1; py1 = y;
      var z = q0 * y + q1 * qx1 + q2 * qx2 - q3 * qy1 - q4 * qy2; qx2 = qx1; qx1 = y; qy2 = qy1; qy1 = z;
      d[i] = z;
    }
    p[5] = px1; p[6] = px2; p[7] = py1; p[8] = py2; q[5] = qx1; q[6] = qx2; q[7] = qy1; q[8] = qy2;
  }
  function normalize(chs, peak) {
    var m = 0, i, c;
    for (c = 0; c < chs.length; c++) for (i = 0; i < chs[c].length; i++) { var a = Math.abs(chs[c][i]); if (a > m) m = a; }
    if (m < 1e-9) return chs;
    var k = peak / m;
    for (c = 0; c < chs.length; c++) for (i = 0; i < chs[c].length; i++) chs[c][i] *= k;
    return chs;
  }
  /** Rampa de entrada/salida para que ningún buffer haga "clic". */
  function edges(chs, sr, fin, fout) {
    var ni = Math.max(1, (fin * sr) | 0), no = Math.max(1, (fout * sr) | 0);
    for (var c = 0; c < chs.length; c++) {
      var d = chs[c], n = d.length, i;
      for (i = 0; i < ni && i < n; i++) d[i] *= i / ni;
      for (i = 0; i < no && i < n; i++) d[n - 1 - i] *= i / no;
    }
    return chs;
  }
  /** Cierra un bucle sin costura: mezcla los últimos X s con el principio (potencia constante). */
  function loopify(chs, sr, x) {
    var X = (x * sr) | 0, out = [];
    for (var c = 0; c < chs.length; c++) {
      var d = chs[c], n = d.length - X, o = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        if (i < X) { var k = i / X; o[i] = d[i] * Math.sqrt(k) + d[n + i] * Math.sqrt(1 - k); }
        else o[i] = d[i];
      }
      out.push(o);
    }
    return out;
  }
  /** Iguala la energía de L y R (la grada de voces con paneo aleatorio salía hasta 4,5 LU cargada a un lado). */
  function balanceLR(chs) {
    if (chs.length < 2) return chs;
    var a = 0, b = 0, L = chs[0], R = chs[1], i;
    for (i = 0; i < L.length; i++) { a += L[i] * L[i]; b += R[i] * R[i]; }
    if (a < 1e-12 || b < 1e-12) return chs;
    var m = Math.sqrt((a + b) / 2), kl = m / Math.sqrt(a), kr = m / Math.sqrt(b);
    for (i = 0; i < L.length; i++) { L[i] *= kl; R[i] *= kr; }
    return chs;
  }
  /** balanceLR() troceado (grada y música: buffers largos). */
  /* Bucles de tramo de las pasadas largas como funciones normales (sin yield): V8 las optimiza al vuelo (OSR) y
   * no mete nada en caja; el generador solo reparte los tramos. Acumulan en Z (Float64Array). */
  function sqAcc(L, R, a, b, Z) { var x = Z[0], y = Z[1]; for (var i = a; i < b; i++) { x += L[i] * L[i]; y += R[i] * R[i]; } Z[0] = x; Z[1] = y; }
  function scale2(L, R, a, b, kl, kr) { for (var i = a; i < b; i++) { L[i] *= kl; R[i] *= kr; } }
  function peakAcc(d, a, b, Z) { var m = Z[0]; for (var i = a; i < b; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; } Z[0] = m; }
  function scale1(d, a, b, k) { for (var i = a; i < b; i++) d[i] *= k; }
  function* balanceLRG(chs) {
    var L = chs[0], R = chs[1], n = L.length, Z = new Float64Array(4), i0;
    for (i0 = 0; i0 < n; i0 += CB) { sqAcc(L, R, i0, i0 + CB < n ? i0 + CB : n, Z); yield 0; }
    if (Z[0] < 1e-12 || Z[1] < 1e-12) return chs;
    var m = Math.sqrt((Z[0] + Z[1]) / 2); Z[2] = m / Math.sqrt(Z[0]); Z[3] = m / Math.sqrt(Z[1]);
    for (i0 = 0; i0 < n; i0 += CB) { scale2(L, R, i0, i0 + CB < n ? i0 + CB : n, Z[2], Z[3]); yield 0; }
    return chs;
  }
  /** Bloqueo de continua de 20 Hz (un polo), el mismo que lleva impact(). Mono, en sitio (sonidos cortos: sin trocear). */
  function dcBlock(d, sr) {
    var R = Math.exp(-TAU * 20 / sr), x1 = 0, y1 = 0;
    for (var i = 0; i < d.length; i++) { var x = d[i]; y1 = x - x1 + R * y1; x1 = x; d[i] = y1; }
    return d;
  }
  function softclip(chs, drive) {
    var k = Math.tanh(drive);
    for (var c = 0; c < chs.length; c++) for (var i = 0; i < chs[c].length; i++) chs[c][i] = Math.tanh(chs[c][i] * drive) / k;
    return chs;
  }

  /* Troceado de la generación: todos los generadores son function* que ceden
   * (yield) cada YM+1 muestras. El motor llama a it.next() mientras quede
   * presupuesto en el frame, así ningún paso supera ~1 ms en escritorio
   * (unos 4-5 ms en un móvil medio). En node, synth() los ejecuta de un tirón. */
  var YM = 511;           // bucles de síntesis caros (por muestra: filtros, senos)
  var YB = 16383;         // bucles baratos sobre buffers largos (normalizar, envolventes)
  var CH = YM + 1, CB = YB + 1; // tamaño de tramo de los bucles exteriores (ver REGLA DE ASIGNACIÓN)
  /** normalize() troceado para buffers largos (grada, reverb). */
  function* normalizeG(chs, peak) {
    var Z = new Float64Array(2), c, d, n, i0;
    for (c = 0; c < chs.length; c++) { d = chs[c]; n = d.length; for (i0 = 0; i0 < n; i0 += CB) { peakAcc(d, i0, i0 + CB < n ? i0 + CB : n, Z); yield 0; } }
    if (Z[0] < 1e-9) return chs;
    Z[1] = peak / Z[0];
    for (c = 0; c < chs.length; c++) { d = chs[c]; n = d.length; for (i0 = 0; i0 < n; i0 += CB) { scale1(d, i0, i0 + CB < n ? i0 + CB : n, Z[1]); yield 0; } }
    return chs;
  }
  /** loopify() troceado. */
  function* loopifyG(chs, sr, x) {
    var X = (x * sr) | 0, out = [];
    for (var c = 0; c < chs.length; c++) {
      var d = chs[c], n = d.length - X, o = d.slice(0, n);
      for (var i0 = 0; i0 < X; i0 += CH) {
        var i1 = i0 + CH < X ? i0 + CH : X;
        for (var i = i0; i < i1; i++) { var k = i / X; o[i] = d[i] * Math.sqrt(k) + d[n + i] * Math.sqrt(1 - k); }
        yield 0;
      }
      out.push(o); yield 0;
    }
    return out;
  }
  /** Ejecuta un generador hasta el final (node / tests). */
  function runSync(it) { var r; do { r = it.next(); } while (!r.done); return r.value; }

  /* ------------------------------------------------------------------
   * 2. Generadores de efectos
   * ------------------------------------------------------------------ */

  /** Impacto genérico de balón: cuerpo grave con caída de tono + chasquido
   *  (ruido muy corto) + palmada (ruido filtrado) + resonancia de la cámara del balón. */
  function* impact(o, rng, sr) {
    // parámetros a variables locales: los objetos de IMPACTS tienen formas distintas
    // y leerlos por muestra hace los accesos megamórficos (lentísimo)
    var n = Math.ceil(o.dur * sr), d = new Float32Array(n);
    var ba = o.ba || 0, ha = o.ha || 0, ca = o.ca || 0, sa = o.sa || 0, sa2 = o.sa2 || 0, ra = o.ra || 0, wa = o.wa || 0;
    var pt = o.pt || 0.02, bd = o.bd || 0.05, cd = o.cd || 0.004, sd = o.sd || 0.02, rd = o.rd || 0.03;
    var cf = new Biq(o.ct || 'hp', o.cf || 2000, 0.7, sr);
    var sf = new Biq('bp', o.sf || 1200, o.sq || 1, sr);
    var sf2 = new Biq('bp', (o.sf || 1200) * 1.7, o.sq || 1, sr);
    var tail = wa ? new Biq('bp', o.wf0 || 1500, 1.2, sr) : null, wf0 = o.wf0 || 1500, wf1 = o.wf1 || 600, wt = o.wt || 0.02, wd = o.wd || 0.25;
    var j = 1 + (rng() - 0.5) * 0.08;
    var f0 = o.f0 * j, f1 = o.f1 * j, rf = (o.rf || 0) * (1 + (rng() - 0.5) * 0.05);
    var s2 = o.s2 ? (o.s2 * sr) | 0 : -1;
    // envolventes exponenciales incrementales (una multiplicación por muestra)
    var kP = Math.exp(-1 / (pt * sr)), kB = Math.exp(-1 / (bd * sr)), kH = Math.exp(-1 / (bd * 0.4 * sr)), kC = Math.exp(-1 / (cd * sr));
    var kS = Math.exp(-1 / (sd * sr)), kR = Math.exp(-1 / (rd * sr));
    var wn = (wd * sr) | 0, wst = (wt * sr) | 0, dcR = Math.exp(-TAU * 20 / sr), rs = rng.st;
    // estado entre tramos: 0 ph · 1 ph2 · 2 ph3 · 3 eP · 4 eB · 5 eH · 6 eC · 7 eS · 8 eS2 · 9 eR · 10 dcx · 11 dcy
    var Z = new Float64Array(12); Z[3] = 1; Z[4] = ba; Z[5] = ha; Z[6] = ca; Z[7] = sa; Z[8] = sa2; Z[9] = ra;
    // Biq.p() escrito en línea sobre los coeficientes/estado (k = [b0 b1 b2 a1 a2 x1 x2 y1 y2]): en este bucle, con
    // cuatro filtros y tail.set(), V8 dejaba de insertar las llamadas y metía en caja argumento y resultado
    // (~60 bytes de basura por muestra medidos). Mismas operaciones en el mismo orden: salida idéntica.
    var qc = cf.c, qs = sf.c, q2 = sf2.c, qt = tail ? tail.c : new Float64Array(9), hasTail = !!tail;
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n;
      var ph = Z[0], ph2 = Z[1], ph3 = Z[2], eP = Z[3], eB = Z[4], eH = Z[5], eC = Z[6], eS = Z[7], eS2 = Z[8], eR = Z[9], dcx = Z[10], dcy = Z[11];
      for (var i = i0; i < i1; i++) {
        var nz = rnd(rs) * 2 - 1, fy;
        var f = f1 + (f0 - f1) * eP; eP *= kP;
        ph += TAU * f / sr;
        var y = Math.sin(ph) * eB; eB *= kB;
        if (ha) { ph3 += TAU * f * 2.3 / sr; y += Math.sin(ph3) * eH; eH *= kH; }
        fy = qc[0] * nz + qc[1] * qc[5] + qc[2] * qc[6] - qc[3] * qc[7] - qc[4] * qc[8]; qc[6] = qc[5]; qc[5] = nz; qc[8] = qc[7]; qc[7] = fy;
        y += fy * eC; eC *= kC;
        fy = qs[0] * nz + qs[1] * qs[5] + qs[2] * qs[6] - qs[3] * qs[7] - qs[4] * qs[8]; qs[6] = qs[5]; qs[5] = nz; qs[8] = qs[7]; qs[7] = fy;
        y += fy * eS; eS *= kS;
        if (s2 >= 0 && i >= s2) {
          var n2 = rnd(rs) * 2 - 1;
          fy = q2[0] * n2 + q2[1] * q2[5] + q2[2] * q2[6] - q2[3] * q2[7] - q2[4] * q2[8]; q2[6] = q2[5]; q2[5] = n2; q2[8] = q2[7]; q2[7] = fy;
          y += fy * eS2; eS2 *= kS;
        }
        if (rf) { ph2 += TAU * rf / sr; y += Math.sin(ph2) * eR; eR *= kR; }
        if (hasTail && i >= wst && i < wst + wn) { // silbido del aire detrás del balón (remate)
          var u = (i - wst) / wn;
          if (((i - wst) & 31) === 0) tail.set('bp', wf0 + (wf1 - wf0) * u, 1.4, sr);
          fy = qt[0] * nz + qt[1] * qt[5] + qt[2] * qt[6] - qt[3] * qt[7] - qt[4] * qt[8]; qt[6] = qt[5]; qt[5] = nz; qt[8] = qt[7]; qt[7] = fy;
          y += fy * wa * Math.sin(Math.PI * u);
        }
        // bloqueo de continua (20 Hz): los senos graves con caída exponencial dejaban hasta 0,9 % de DC
        dcy = y - dcx + dcR * dcy; dcx = y; d[i] = dcy;
      }
      Z[0] = ph; Z[1] = ph2; Z[2] = ph3; Z[3] = eP; Z[4] = eB; Z[5] = eH; Z[6] = eC; Z[7] = eS; Z[8] = eS2; Z[9] = eR; Z[10] = dcx; Z[11] = dcy;
      yield 0;
    }
    var chs = [d];
    if (o.drive) {
      softclip(chs, o.drive);
      // la saturación deja energía junto a Nyquist (muestras que alternan ±1): picos entre muestras de hasta +5 dBTP
      // y un "fizz" áspero. Un paso bajo de 2 polos tras saturar lo quita sin apagar el chasquido (audiotest: TP).
      var lp = new Biq('lp', o.lpf || 10500, 0.6, sr), lp2 = new Biq('lp', o.lpf || 10500, 0.6, sr);
      for (var k0 = 0; k0 < n; k0 += CB) { bq2Run(lp, lp2, d, k0, k0 + CB < n ? k0 + CB : n); yield 0; }
    }
    return edges(normalize(chs, o.peak || 0.9), sr, 0.0004, 0.01);
  }

  /* Revisión de mezcla (audiotest): los golpes tenían el 85-99 % de la energía por debajo de 150 Hz y en un
   * altavoz de móvil o portátil perdían 11-20 dB (inaudibles frente al silbato). Ahora llevan el armónico del
   * cuerpo (ha) y la resonancia de la cámara del balón / el "knock" del parqué (rf) más presentes: el grave sigue
   * ahí, pero el golpe se oye también en altavoces pequeños (pérdida medida en la columna "phone"). */
  var IMPACTS = {
    // Recepción de antebrazos: "thump" redondo, con el "pop" de la cámara del balón
    pass: { dur: 0.22, f0: 250, f1: 135, pt: 0.012, ba: 0.85, bd: 0.045, ha: 0.55, ct: 'lp', cf: 2600, ca: 0.55, cd: 0.005,
            sf: 800, sq: 0.9, sa: 0.75, sd: 0.03, rf: 620, ra: 0.32, rd: 0.035, drive: 1.3, lpf: 15000, peak: 0.9 },
    // Colocación de dedos: "pat" suave, doble contacto mínimo de las dos manos
    set: { dur: 0.12, f0: 520, f1: 360, pt: 0.008, ba: 0.35, bd: 0.022, ct: 'hp', cf: 2500, ca: 0.35, cd: 0.002,
           sf: 1700, sq: 1.3, sa: 0.7, sd: 0.014, s2: 0.006, sa2: 0.45, rf: 880, ra: 0.06, rd: 0.02, drive: 1.3, lpf: 15000, peak: 0.75 },
    // Balón libre / toque de seguridad
    free: { dur: 0.18, f0: 300, f1: 170, pt: 0.01, ba: 0.75, bd: 0.04, ha: 0.35, ct: 'lp', cf: 3500, ca: 0.5, cd: 0.004,
            sf: 1100, sq: 1, sa: 0.65, sd: 0.022, rf: 720, ra: 0.2, rd: 0.03, drive: 1.3, lpf: 15000, peak: 0.85 },
    // Saque: palmada firme de mano abierta con "pop"
    serve: { dur: 0.25, f0: 300, f1: 150, pt: 0.01, ba: 0.7, bd: 0.045, ha: 0.35, ct: 'hp', cf: 1800, ca: 0.9, cd: 0.004,
             sf: 2200, sq: 0.9, sa: 0.75, sd: 0.02, rf: 900, ra: 0.25, rd: 0.04,
             wa: 0.08, wf0: 1400, wf1: 700, wt: 0.03, wd: 0.2, drive: 1.4, lpf: 12000, peak: 0.92 },
    // Remate: CRACK seco (palmada saturada) + cuerpo + silbido del aire
    spike: { dur: 0.38, f0: 340, f1: 130, pt: 0.008, ba: 0.75, bd: 0.055, ha: 0.45, ct: 'hp', cf: 1300, ca: 1.6, cd: 0.0035,
             sf: 3000, sq: 0.7, sa: 1.1, sd: 0.017, s2: 0.0015, sa2: 0.5, rf: 1100, ra: 0.28, rd: 0.05,
             wa: 0.16, wf0: 2200, wf1: 600, wt: 0.025, wd: 0.32, drive: 2.6, lpf: 12500, peak: 0.98 },
    // Bloqueo: golpe sordo "ahogado", dos manos casi a la vez
    block: { dur: 0.3, f0: 220, f1: 95, pt: 0.018, ba: 0.85, bd: 0.065, ha: 0.5, ct: 'lp', cf: 2200, ca: 0.7, cd: 0.006,
             sf: 1100, sq: 0.8, sa: 1.0, sd: 0.03, s2: 0.011, sa2: 0.8, rf: 560, ra: 0.3, rd: 0.05, drive: 1.8, peak: 0.95 },
    // Bote en el parqué durante el rally: golpe grave + "knock" de la tarima
    land: { dur: 0.35, f0: 160, f1: 70, pt: 0.02, ba: 0.9, bd: 0.085, ha: 0.45, ct: 'lp', cf: 4500, ca: 0.8, cd: 0.005,
            sf: 1300, sq: 0.7, sa: 0.85, sd: 0.03, rf: 360, ra: 0.35, rd: 0.08, drive: 1.3, lpf: 15000, peak: 0.95 },
    // Remate que revienta contra el suelo
    slam: { dur: 0.5, f0: 180, f1: 60, pt: 0.025, ba: 1.0, bd: 0.11, ha: 0.5, ct: 'hp', cf: 1500, ca: 1.4, cd: 0.005,
            sf: 1600, sq: 0.6, sa: 1.2, sd: 0.035, rf: 330, ra: 0.4, rd: 0.12, drive: 2.2, peak: 1 },
    // Botes de balón muerto
    bounce: { dur: 0.2, f0: 200, f1: 100, pt: 0.015, ba: 0.8, bd: 0.045, ha: 0.45, ct: 'lp', cf: 3500, ca: 0.6, cd: 0.004,
              sf: 1300, sq: 0.8, sa: 0.7, sd: 0.02, rf: 380, ra: 0.3, rd: 0.06, drive: 1.3, lpf: 15000, peak: 0.85 },
    // Pies del atleta al aterrizar
    feet: { dur: 0.16, f0: 110, f1: 60, pt: 0.02, ba: 1, bd: 0.045, ha: 0.5, ct: 'lp', cf: 1400, ca: 0.7, cd: 0.01,
            sf: 700, sq: 0.8, sa: 0.5, sd: 0.02, s2: 0.018, sa2: 0.4, rf: 300, ra: 0.2, rd: 0.03, peak: 0.8 },
    // Bombo de la grada
    bombo: { dur: 0.6, f0: 120, f1: 50, pt: 0.03, ba: 1.1, bd: 0.18, ha: 0.3, ct: 'lp', cf: 1800, ca: 0.55, cd: 0.008,
             sf: 300, sq: 0.8, sa: 0.3, sd: 0.04, rf: 240, ra: 0.25, rd: 0.06, peak: 0.95 },
    // Latido (punto de partido): "lub" grave y apagado
    beat: { dur: 0.25, f0: 70, f1: 40, pt: 0.03, ba: 1, bd: 0.07, ha: 0.45, ct: 'lp', cf: 700, ca: 0.5, cd: 0.012, peak: 0.9 }
  };


  /** Red: cinta/cable que vibra + traqueteo de la malla (granos) + sacudida. */
  function* genNet(tape, rng, sr) {
    var dur = 0.75, n = Math.ceil(dur * sr), d = new Float32Array(n);
    var mesh = new Biq('bp', 520, 1.1, sr), g1 = new Biq('bp', 1800, 2, sr), thw = new Biq('bp', 700, 0.9, sr);
    var kG = Math.exp(-1 / (0.003 * sr)), kD = Math.exp(-1 / (0.08 * sr)), kA = Math.exp(-1 / (0.25 * sr)), kM = Math.exp(-1 / (0.12 * sr));
    var kC = Math.exp(-1 / (0.3 * sr)), kT = Math.exp(-1 / (0.022 * sr)), w2 = TAU * 197 / sr, rs = rng.st;
    // estado entre tramos: 0 ph · 1 ph2 · 2 gEnv · 3 eD · 4 eA · 5 eM · 6 eC · 7 eT
    var Z = new Float64Array(8); Z[3] = 1; Z[4] = 1; Z[5] = 0.5; Z[6] = 0.35; Z[7] = tape ? 1.3 : 0;
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n;
      var ph = Z[0], ph2 = Z[1], gEnv = Z[2], eD = Z[3], eA = Z[4], eM = Z[5], eC = Z[6], eT = Z[7];
      for (var i = i0; i < i1; i++) {
        var nz = rnd(rs) * 2 - 1;
        // granos de la malla: densidad que decae de ~500/s a ~15/s
        if (rnd(rs) < (15 + 480 * eD) / sr) { gEnv = (0.4 + rnd(rs) * 0.6) * eA * 1.6; g1.set('bp', 1000 + rnd(rs) * 2400, 2.5, sr); }
        eD *= kD; eA *= kA;
        var y = g1.p(nz) * gEnv; gEnv *= kG;
        y += mesh.p(nz) * eM; eM *= kM;
        if ((i & 15) === 0) ph2 = TAU * (96 + 2 * Math.sin(i * 31 / sr)) / sr; // vibrato del cable
        ph += ph2;
        var at = i < 0.004 * sr ? i / (0.004 * sr) : 1;
        y += (Math.sin(ph) * eC + Math.sin(w2 * i) * eC * 0.34) * at; eC *= kC;
        if (eT > 1e-4) { y += thw.p(nz) * eT; eT *= kT; }
        d[i] = y;
      }
      Z[0] = ph; Z[1] = ph2; Z[2] = gEnv; Z[3] = eD; Z[4] = eA; Z[5] = eM; Z[6] = eC; Z[7] = eT;
      yield 0;
    }
    return edges(normalize([d], 0.85), sr, 0.0005, 0.05);
  }

  /** Silbato de árbitro: dos tonos (cámaras) + trino del guisante + aliento. */
  function* genWhistle(dur, rng, sr) {
    var tot = dur + 0.12, n = Math.ceil(tot * sr), d = new Float32Array(n);
    var br = new Biq('bp', 3100, 3, sr), air = new Biq('hp', 1500, 0.7, sr);
    var fA = 2950 + rng() * 120, fB = fA * 1.17, rs = rng.st;
    var trF = 26 + rng() * 8, Z = new Float64Array(4); // estado entre tramos: 0 p1 · 1 p2 · 2 p3 · 3 tp
    for (var i0 = 0; i0 < n; i0 += CH) {
     var i1 = i0 + CH < n ? i0 + CH : n, p1 = Z[0], p2 = Z[1], p3 = Z[2], tp = Z[3];
     for (var i = i0; i < i1; i++) {
      var t = i / sr, nz = rnd(rs) * 2 - 1;
      var att = Math.min(1, t / 0.028), rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.07) : 1, env = att * att * (3 - 2 * att) * rel;
      // trino irregular del guisante (la frecuencia vaga un poco)
      tp += TAU * trF * (1 + 0.25 * Math.sin(t * 7.3)) / sr;
      var tr = Math.tanh(2.6 * Math.sin(tp)) * 0.5 + 0.5;
      var bend = (0.93 + 0.07 * att) * (t > dur ? 1 - 0.05 * (t - dur) / 0.07 : 1) * (1 + 0.012 * tr);
      p1 += TAU * fA * bend / sr; p2 += TAU * fB * bend / sr; p3 += TAU * fA * 2 * bend / sr;
      var amp = env * (0.55 + 0.45 * tr);
      var y = (Math.sin(p1) * 0.6 + Math.sin(p2) * 0.42 + Math.sin(p3) * 0.07) * amp;
      y += br.p(nz) * 0.5 * env * (0.6 + 0.4 * tr) + air.p(nz) * 0.05 * env * (1.5 - att * 0.8);
      d[i] = y;
     }
     Z[0] = p1; Z[1] = p2; Z[2] = p3; Z[3] = tp;
     yield 0;
    }
    return edges(normalize([d], 0.8), sr, 0.002, 0.02);
  }

  /** Chirrido de zapatilla sobre parqué (stick-slip). */
  function* genSqueak(rng, sr) {
    var dur = 0.07 + rng() * 0.1, n = Math.ceil(dur * sr), d = new Float32Array(n);
    var bp = new Biq('bp', 2600, 0.8, sr), hp = new Biq('hp', 3500, 0.7, sr);
    var f0 = 1500 + rng() * 1700, glide = (rng() - 0.4) * 0.5, ss = 30 + rng() * 25, rs = rng.st, Z = new Float64Array(1);
    for (var i0 = 0; i0 < n; i0 += CH) {
     var i1 = i0 + CH < n ? i0 + CH : n, ph = Z[0];
     for (var i = i0; i < i1; i++) {
      var t = i / sr, u = t / dur, nz = rnd(rs) * 2 - 1;
      var f = f0 * (1 + glide * u) * (1 + 0.06 * Math.sin(TAU * ss * t) + 0.03 * nz);
      ph += TAU * f / sr;
      var env = Math.min(1, t / 0.008) * (1 - u) * Math.sqrt(1 - u);
      var y = (Math.sin(ph) * 0.6 + Math.sin(2 * ph) * 0.3 + Math.sin(3 * ph) * 0.15) * env;
      d[i] = bp.p(y) * 1.4 + hp.p(nz) * 0.12 * env;
     }
     Z[0] = ph; yield 0;
    }
    return edges(normalize([d], 0.8), sr, 0.001, 0.008);
  }

  /** Arrastre de zapatilla al despegar. */
  function* genScuff(rng, sr) {
    var dur = 0.09, n = Math.ceil(dur * sr), d = new Float32Array(n), hp = new Biq('bp', 3200, 0.6, sr), rs = rng.st, Z = new Float64Array(1);
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, ph = Z[0];
      for (var i = i0; i < i1; i++) {
        var t = i / sr, nz = rnd(rs) * 2 - 1; ph += TAU * (90 - t * 300) / sr;
        d[i] = hp.p(nz) * Math.exp(-t / 0.025) * 0.8 + Math.sin(ph) * 0.5 * Math.exp(-t / 0.03);
      }
      Z[0] = ph; yield 0;
    }
    // el seno grave que cae desde 90 Hz dejaba un 0,7 % de continua (audiotest DC): mismo bloqueo de 20 Hz que impact()
    return edges(normalize([dcBlock(d, sr)], 0.7), sr, 0.002, 0.01);
  }

  /** Brazo en el aire (golpe al vacío). */
  function* genWhoosh(rng, sr) {
    var dur = 0.26, n = Math.ceil(dur * sr), d = new Float32Array(n), bp = new Biq('bp', 700, 1.5, sr), rs = rng.st;
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n;
      for (var i = i0; i < i1; i++) {
        var t = i / sr, u = t / dur;
        if ((i & 31) === 0) bp.set('bp', 600 + 1400 * Math.sin(Math.PI * Math.min(1, u * 1.3)), 1.5, sr);
        var sn = Math.sin(Math.PI * u);
        d[i] = bp.p(rnd(rs) * 2 - 1) * sn * sn * (1 - 0.4 * (1 - sn));
      }
      yield 0;
    }
    return edges(normalize([d], 0.7), sr, 0.002, 0.01);
  }

  /** Plancha: el cuerpo cae y se desliza por el parqué (golpe + fricción de piel/tela). */
  function* genSlide(rng, sr) {
    var dur = 0.45, n = Math.ceil(dur * sr), d = new Float32Array(n), bp = new Biq('bp', 1100, 0.6, sr), lp = new Biq('lp', 500, 0.7, sr);
    var kB = Math.exp(-1 / (0.06 * sr)), rs = rng.st, Z = new Float64Array(2); Z[1] = 1; // estado: 0 ph · 1 eB
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, ph = Z[0], eB = Z[1];
      for (var i = i0; i < i1; i++) {
        var u = i / n, nz = rnd(rs) * 2 - 1;
        ph += TAU * (70 - 25 * u) / sr;
        var fr = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (0.75 + 0.25 * Math.sin(i * 0.004)); // fricción que crece y se apaga
        d[i] = Math.sin(ph) * eB * 0.8 + Math.sin(ph * 2.7) * eB * eB * 0.35 + lp.p(nz) * eB * 0.9 + bp.p(nz) * 0.7 * fr * (1 - u * 0.6); eB *= kB;
      }
      Z[0] = ph; Z[1] = eB; yield 0;
    }
    // golpe grave con caída exponencial: 0,4 % de continua sin el bloqueo de 20 Hz (audiotest DC)
    return edges(normalize([dcBlock(d, sr)], 0.85), sr, 0.001, 0.04);
  }
  /** Destello sutil de "toque perfecto" (solo golpes del humano): dos parciales de campana. */
  function* genPerfect(rng, sr) {
    var dur = 0.32, n = Math.ceil(dur * sr), d = new Float32Array(n), w1 = TAU * 2093 / sr, w2 = TAU * 3136 / sr, ke = Math.exp(-1 / (0.07 * sr)), Z = new Float64Array(1); Z[0] = 1;
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, e = Z[0];
      for (var i = i0; i < i1; i++) { d[i] = (Math.sin(w1 * i) * 0.6 + Math.sin(w2 * i) * 0.4 * clamp((i - 0.035 * sr) / (0.004 * sr), 0, 1)) * e; e *= ke; }
      Z[0] = e; yield 0;
    }
    return edges(normalize([d], 0.6), sr, 0.0015, 0.02);
  }

  /** Interfaz: clic con cuerpo y "hover" cristalino. */
  function* genUi(kind, rng, sr) {
    var dur = kind === 'hover' ? 0.05 : kind === 'back' ? 0.09 : kind === 'start' ? 0.32 : 0.07;
    var n = Math.ceil(dur * sr), d = new Float32Array(n), hp = new Biq('hp', 3000, 0.7, sr), rs = rng.st, Z = new Float64Array(4);
    for (var i0 = 0; i0 < n; i0 += CH) {
     var i1 = i0 + CH < n ? i0 + CH : n, ph = Z[0], ph2 = Z[1], ph3 = Z[2], ph4 = Z[3];
     for (var i = i0; i < i1; i++) {
      var t = i / sr, nz = rnd(rs) * 2 - 1, f, y;
      if (kind === 'hover') { ph += TAU * 2100 / sr; y = Math.sin(ph) * 0.3 * Math.exp(-t / 0.012); }
      else if (kind === 'back') { f = 900 - t * 3000; ph += TAU * f / sr; y = Math.sin(ph) * 0.6 * Math.exp(-t / 0.03); }
      else if (kind === 'start') { // dos notas ascendentes con brillo
        // la 1.ª nota (784 Hz) sigue sonando bajo la 2.ª (1175 Hz, desde 80 ms) en vez de cortarse, y la 2.ª
        // entra con 3 ms de ataque: sin escalones de amplitud, sin clic al pulsar JUGAR
        ph += TAU * 784 / sr; ph2 += TAU * 1568 / sr;
        y = (Math.sin(ph) * 0.6 + Math.sin(ph2) * 0.15) * Math.exp(-t / 0.05);
        if (t >= 0.08) {
          var tt = t - 0.08; ph3 += TAU * 1175 / sr; ph4 += TAU * 2350 / sr;
          y += (Math.sin(ph3) * 0.6 + Math.sin(ph4) * 0.15) * Math.exp(-tt / 0.12) * Math.min(1, tt / 0.003);
        }
      } else { f = 1250 - t * 3500; ph += TAU * f / sr; ph2 += TAU * 2600 / sr; y = Math.sin(ph) * 0.6 * Math.exp(-t / 0.018) + Math.sin(ph2) * 0.12 * Math.exp(-t / 0.006); }
      d[i] = y + hp.p(nz) * 0.35 * Math.exp(-t / 0.0015);
     }
     Z[0] = ph; Z[1] = ph2; Z[2] = ph3; Z[3] = ph4; yield 0;
    }
    return edges(normalize([d], kind === 'hover' ? 0.45 : 0.75), sr, 0.0003, 0.005);
  }

  /* ---------- Público (estéreo, 22 050 Hz: la grada no necesita más agudos) ----------
   * Se genera por "planes": una lista de pasos cortos (una voz por paso) que el
   * motor ejecuta repartidos en varios ticks para no congelar el menú en móvil. */

  /** Una voz de público = (ruido + pulso glotal) por dos formantes, con envolvente
   *  silábica propia y posición estéreo aleatoria. o.sweep(t, out[2]) opcional
   *  multiplica F1/F2 con el tiempo (lamento descendente, "uuuh"). */
  var SW = new Float64Array(2), EV = new Float64Array(1); SW[0] = SW[1] = 1; // salidas de sweep(t, SW) y env(t, EV)
  function* crowdVoice(o, rng, sr, L, R) {
    var n = L.length, q = o.q, pitched = o.pitched, depth = o.depth, syl = o.syll, sweep = o.sweep || null;
    var pglide = o.pglide || 0, stagger = o.stagger || 0;
    var F1 = o.f1[0] + rng() * (o.f1[1] - o.f1[0]), F2 = o.f2[0] + rng() * (o.f2[1] - o.f2[0]);
    var b1 = new Biq('bp', F1, q, sr), b2 = new Biq('bp', F2, q * 1.3, sr);
    var pan = rng() * 2 - 1, gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    var amp = 0.5 + rng(), pf = o.pitch[0] + rng() * (o.pitch[1] - o.pitch[0]), ph = rng();
    var env = 0, tgt = rng(), nextChange = 0;
    var smooth = 1 - Math.exp(-1 / (sr * (syl > 0 ? 0.25 / syl : 0.4)));
    var vib = 4 + rng() * 3, vibA = 0.02 + rng() * 0.03, start = stagger ? (rng() * stagger * sr) | 0 : 0;
    var aN = 1 - pitched, rs = rng.st;
    // estado entre tramos: 0 env · 1 tgt · 2 nextChange · 3 inc · 4 ph (los tramos van alineados a CH, como los yield de antes)
    var Z = new Float64Array(5); Z[1] = tgt; Z[3] = pf / sr; Z[4] = ph;
    // Los dos formantes (b1, b2) van escritos en línea con coeficientes y estado en variables locales (es el bucle
    // más caro del banco: ~2,5 M muestras-voz solo en el murmullo). Los dos filtros reciben la misma entrada, así que
    // comparten x1/x2. Mismas operaciones y orden que Biq.p(): salida idéntica, ~2x más rápido.
    var k1 = b1.c, k2 = b2.c, gain0 = amp, d0 = 1 - depth;
    for (var i0 = start; i0 < n; i0 = (i0 | YM) + 1) {
      var i1 = (i0 | YM) + 1 < n ? (i0 | YM) + 1 : n;
      var zenv = Z[0], ztgt = Z[1], znext = Z[2], inc = Z[3], zph = Z[4];
      var a0 = k1[0], a1 = k1[1], a2 = k1[2], a3 = k1[3], a4 = k1[4], x1 = k1[5], x2 = k1[6], y1 = k1[7], y2 = k1[8];
      var c0 = k2[0], c1 = k2[1], c2 = k2[2], c3 = k2[3], c4 = k2[4], w1 = k2[7], w2 = k2[8];
      for (var i = i0; i < i1; i++) {
        if ((i & 31) === 0) {
          var t = i / sr;
          inc = pf * (1 + vibA * Math.sin(TAU * vib * t)) * (1 + pglide * t) / sr;
          if (sweep && (i & 127) === 0) {
            sweep(t, SW); b1.set('bp', F1 * SW[0], q, sr); b2.set('bp', F2 * SW[1], q * 1.3, sr);
            a0 = k1[0]; a1 = k1[1]; a2 = k1[2]; a3 = k1[3]; a4 = k1[4]; c0 = k2[0]; c1 = k2[1]; c2 = k2[2]; c3 = k2[3]; c4 = k2[4];
          }
        }
        if (syl > 0 && i >= znext) { ztgt = rnd(rs) < 0.25 ? 0 : 0.3 + rnd(rs) * 0.7; znext = i + sr * (0.5 + rnd(rs)) / syl; }
        zenv += (ztgt - zenv) * smooth;
        zph += inc; if (zph >= 1) zph -= 1;
        var src = (rnd(rs) * 2 - 1) * aN + (2 * zph - 1) * pitched;
        var o1 = a0 * src + a1 * x1 + a2 * x2 - a3 * y1 - a4 * y2; y2 = y1; y1 = o1;
        var o2 = c0 * src + c1 * x1 + c2 * x2 - c3 * w1 - c4 * w2; w2 = w1; w1 = o2;
        x2 = x1; x1 = src;
        var y = (o1 + 0.55 * o2) * gain0 * (d0 + depth * zenv);
        L[i] += y * gl; R[i] += y * gr;
      }
      k1[5] = x1; k1[6] = x2; k1[7] = y1; k1[8] = y2; k2[5] = x1; k2[6] = x2; k2[7] = w1; k2[8] = w2;
      Z[0] = zenv; Z[1] = ztgt; Z[2] = znext; Z[3] = inc; Z[4] = zph;
      yield 0;
    }
  }
  /** Plan de público: o = {dur, layers, env(t), loop (s de fundido), peak, extras(L,R,rng,sr) -> generador} */
  function* crowdPlan(o, rng, sr) {
    var n = Math.ceil((o.dur + (o.loop || 0)) * sr), L = new Float32Array(n), R = new Float32Array(n), i;
    for (var l = 0; l < o.layers.length; l++) {
      var ly = o.layers[l];
      for (var v = 0; v < ly.voices; v++) yield* crowdVoice(ly, rng, sr, L, R);
    }
    if (o.extras) yield* o.extras(L, R, rng, sr);
    var chs = [L, R];
    // la envolvente escribe en EV[0] (devolver un double desde un cierre no insertado lo metería en caja por muestra)
    if (o.env) for (var i0 = 0; i0 < n; i0 += 8192) {
      var i1 = i0 + 8192 < n ? i0 + 8192 : n;
      for (i = i0; i < i1; i++) { o.env(i / sr, EV); var e = EV[0]; L[i] *= e; R[i] *= e; }
      yield 0;
    }
    yield* balanceLRG(chs);
    if (o.loop) return yield* normalizeG(yield* loopifyG(chs, sr, o.loop), o.peak);
    yield* normalizeG(chs, o.peak);
    return edges(chs, sr, 0.004, o.fade || 0.15);
  }
  /** Silbidos de aficionados (dedos en la boca): glissandos agudos. */
  function* addFanWhistles(L, R, count, t0, t1, rng, sr, amp) {
    for (var w = 0; w < count; w++) {
      var st = (t0 + rng() * (t1 - t0)) * sr | 0, dur = (0.35 + rng() * 0.5) * sr | 0, f0 = 2100 + rng() * 900;
      var up = rng() < 0.5, pan = rng(), Z = new Float64Array(1), m = Math.min(dur, L.length - st); // Z[0] = fase entre tramos
      for (var i0 = 0; i0 < m; i0 += CH) {
        var i1 = i0 + CH < m ? i0 + CH : m, ph = Z[0];
        for (var i = i0; i < i1; i++) {
          var u = i / dur, f = up ? f0 * (0.85 + 0.25 * Math.sin(Math.PI * u * 0.7)) : f0 * (1.1 - 0.25 * u);
          ph += TAU * f / sr;
          var y = Math.sin(ph) * amp * Math.sin(Math.PI * u) * (0.8 + 0.2 * Math.sin(TAU * 6 * u));
          L[st + i] += y * (1 - pan); R[st + i] += y * pan;
        }
        Z[0] = ph; yield 0;
      }
    }
  }
  /** Núcleos de palmada individual (se reutilizan para aplausos y palmas). */
  var KS = null;
  function clapKernels(sr) {
    if (KS && KS.sr === sr) return KS;
    var rng = makeRng(777), ks = [];
    for (var k = 0; k < 8; k++) {
      var n = (0.022 * sr) | 0, d = new Float32Array(n), bp = new Biq('bp', 900 + rng() * 1700, 1 + rng(), sr);
      for (var i = 0; i < n; i++) {
        var t = i / sr, e = Math.exp(-t / 0.0045) + 0.5 * (t > 0.003 ? Math.exp(-(t - 0.003) / 0.004) : 0);
        d[i] = bp.p(rng() * 2 - 1) * e;
      }
      ks.push(normalize([d], 1)[0]);
    }
    KS = ks; KS.sr = sr; return ks;
  }
  function* addClaps(L, R, t0, t1, rate, rng, sr, amp, decay) {
    var ks = clapKernels(sr), n = L.length, blk = 32 / sr, nb = 0, work = 0, rs = rng.st, Z = new Float64Array(1); Z[0] = t0; // Z[0] = t entre tramos
    while (Z[0] < t1) {
      var t = Z[0];
      for (; t < t1; t += blk) {
        // cede cada ~64 bloques o cada ~6000 muestras de palmadas mezcladas (lo que llegue antes)
        if (++nb >= 64 || work > 6000) { nb = 0; work = 0; break; }
        var expect = rate * (decay ? Math.exp(-Math.max(0, t - decay[0]) / decay[1]) : 1) * blk;
        while (expect > 0) {
          if (rnd(rs) < expect) {
            var k = ks[(rnd(rs) * ks.length) | 0], st = ((t + rnd(rs) * blk) * sr) | 0, pan = rnd(rs), a = amp * (0.3 + rnd(rs) * 0.7);
            for (var i = 0; i < k.length && st + i < n; i++) { L[st + i] += k[i] * a * (1 - pan); R[st + i] += k[i] * a * pan; }
            work += k.length;
          }
          expect -= 1;
        }
      }
      Z[0] = t;
      yield 0;
    }
  }

  var CROWD = {
    // Murmullo de fondo (bucle): gente hablando, sílabas
    murmur: function (rng, sr) {
      return crowdPlan({ dur: 6, loop: 0.8, peak: 0.7, layers: [
        { voices: 14, f1: [300, 800], f2: [900, 2300], q: 2.4, syll: 4.5, depth: 0.85, pitched: 0.3, pitch: [95, 260] },
        { voices: 3, f1: [200, 500], f2: [600, 1200], q: 0.8, syll: 0.5, depth: 0.3, pitched: 0, pitch: [100, 100] }] }, rng, sr);
    },
    // Ánimo sostenido (bucle) que crece en los peloteos largos
    excite: function (rng, sr) {
      return crowdPlan({ dur: 4, loop: 0.7, peak: 0.75, layers: [
        { voices: 16, f1: [580, 950], f2: [1000, 1700], q: 1.6, syll: 1.2, depth: 0.4, pitched: 0.4, pitch: [170, 440] },
        { voices: 3, f1: [300, 700], f2: [1500, 2600], q: 0.7, syll: 0.6, depth: 0.25, pitched: 0, pitch: [100, 100] }] }, rng, sr);
    },
    // Ovación: ataque rápido, cuerpo y cola, con silbidos y aplauso
    roar: function (rng, sr) {
      return crowdPlan({ dur: 4.2, peak: 0.9, fade: 0.2, layers: [
        { voices: 20, f1: [600, 1000], f2: [1050, 1800], q: 1.5, syll: 0.9, depth: 0.3, pitched: 0.45, pitch: [180, 520], stagger: 0.12 },
        { voices: 5, f1: [400, 900], f2: [1600, 3000], q: 0.6, syll: 0, depth: 0, pitched: 0, pitch: [100, 100] }],
        env: function (t, o) { o[0] = Math.min(1, t / 0.12) * (t < 0.7 ? 1 : Math.exp(-(t - 0.7) / 1.1)); },
        extras: function* (L, R, rng, sr) {
          yield* addFanWhistles(L, R, 4, 0.25, 1.8, rng, sr, 0.18);
          // mismos tramos que antes: la secuencia aleatoria (y por tanto el sonido) no cambia
          yield* addClaps(L, R, 0.35, 1.6, 70, rng, sr, 0.28, [1.4, 1.2]);
          yield* addClaps(L, R, 1.6, 2.9, 70, rng, sr, 0.28, [1.4, 1.2]);
          yield* addClaps(L, R, 2.9, 4.2, 70, rng, sr, 0.28, [1.4, 1.2]);
        } }, rng, sr);
    },
    // Lamento "ooohhh" descendente (error propio)
    groan: function (rng, sr) {
      return crowdPlan({ dur: 2.1, peak: 0.85, layers: [
        { voices: 18, f1: [520, 700], f2: [850, 1150], q: 2.0, syll: 0, depth: 0, pitched: 0.5, pitch: [150, 330], pglide: -0.12, stagger: 0.1,
          sweep: function (t, o) { var k = Math.min(1, t / 1.4); o[0] = 1 - 0.38 * k; o[1] = 1 - 0.3 * k; } }],
        env: function (t, o) { o[0] = Math.min(1, t / 0.16) * (t < 0.5 ? 1 : Math.exp(-(t - 0.5) / 0.55)); } }, rng, sr);
    },
    // "Uuuh" de expectación (defensa imposible, balón que roza la línea)
    ooh: function (rng, sr) {
      return crowdPlan({ dur: 1.3, peak: 0.8, fade: 0.1, layers: [
        { voices: 16, f1: [340, 460], f2: [700, 950], q: 2.2, syll: 0, depth: 0, pitched: 0.5, pitch: [160, 360], pglide: 0.05, stagger: 0.06,
          sweep: function (t, o) { var k = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) * 0.25; o[0] = 0.9 + 0.15 * k; o[1] = 0.92 + 0.12 * k; } }],
        env: function (t, o) { o[0] = Math.min(1, t / 0.2) * (t < 0.35 ? 1 : Math.exp(-(t - 0.35) / 0.35)); } }, rng, sr);
    },
    // Aplauso (decae)
    applause: function* (rng, sr) {
      var n = Math.ceil(3.2 * sr), L = new Float32Array(n), R = new Float32Array(n);
      yield* addClaps(L, R, 0, 0.8, 110, rng, sr, 0.5, [0.9, 0.8]);
      yield* addClaps(L, R, 0.8, 1.6, 110, rng, sr, 0.5, [0.9, 0.8]);
      yield* addClaps(L, R, 1.6, 2.4, 110, rng, sr, 0.5, [0.9, 0.8]);
      yield* addClaps(L, R, 2.4, 3.2, 110, rng, sr, 0.5, [0.9, 0.8]);
      var c = [L, R], lp = [new Biq('lp', 6000, 0.7, sr), new Biq('lp', 6000, 0.7, sr)];
      for (var ch = 0; ch < 2; ch++) {
        var d = c[ch], f = lp[ch];
        for (var i0 = 0; i0 < n; i0 += 8192) { var i1 = i0 + 8192 < n ? i0 + 8192 : n; for (var i = i0; i < i1; i++) d[i] = f.p(d[i]) * Math.min(1, i / (0.08 * sr)); yield 0; }
      }
      yield* balanceLRG(c);
      yield* normalizeG(c, 0.75);
      return edges(c, sr, 0.002, 0.2);
    },
    // Palmas al unísono de la grada (ritmo durante el saque local)
    palmas: function* (rng, sr) {
      var ks = clapKernels(sr), n = Math.ceil(0.2 * sr), L = new Float32Array(n), R = new Float32Array(n);
      for (var c = 0; c < 70; c++) {
        var k = ks[(rng() * ks.length) | 0], off = 0.012 + (rng() + rng() + rng() - 1.5) * 0.012, st = Math.max(0, off * sr) | 0, pan = rng(), a = 0.3 + rng() * 0.7;
        for (var i = 0; i < k.length && st + i < n; i++) { L[st + i] += k[i] * a * (1 - pan); R[st + i] += k[i] * a * pan; }
        if ((c & 7) === 7) yield 0;
      }
      return edges(normalize(balanceLR([L, R]), 0.8), sr, 0.0005, 0.03);
    }
  };

  /** Impulso de reverberación de pabellón (~1.8 s), estéreo. */
  function* genIR(rng, sr) {
    var dur = 1.8, n = Math.ceil(dur * sr), L = new Float32Array(n), R = new Float32Array(n), pre = (0.018 * sr) | 0;
    var ke = Math.exp(-1 / (0.3 * sr)), kk = Math.exp(-1 / (0.35 * sr)), rs = rng.st, i, i0, i1;
    var Z = new Float64Array(5); Z[2] = 1; Z[3] = 1; // estado entre tramos: 0 lpL · 1 lpR · 2 e · 3 lk · 4 ss
    for (i0 = pre; i0 < n; i0 = (i0 | YM) + 1) { // tramos alineados a CH (los yield de antes)
      i1 = (i0 | YM) + 1 < n ? (i0 | YM) + 1 : n;
      var lpL = Z[0], lpR = Z[1], e = Z[2], lk = Z[3];
      for (i = i0; i < i1; i++) {
        var k = 0.15 + 0.8 * lk; lk *= kk; // se oscurece con el tiempo
        lpL += ((rnd(rs) * 2 - 1) - lpL) * k; lpR += ((rnd(rs) * 2 - 1) - lpR) * k;
        L[i] = lpL * e; R[i] = lpR * e; e *= ke;
      }
      Z[0] = lpL; Z[1] = lpR; Z[2] = e; Z[3] = lk;
      yield 0;
    }
    for (var r = 0; r < 7; r++) { // primeras reflexiones (suelo, paredes, techo)
      var at = ((0.02 + rng() * 0.07) * sr) | 0, a = 0.5 * (1 - r / 8);
      L[at] += a * (rng() < 0.5 ? 1 : -1); R[at + ((rng() * 0.004 * sr) | 0)] += a * (rng() < 0.5 ? 1 : -1);
    }
    yield* normalizeG([L, R], 0.5);
    // Normalización del ConvolverNode (potencia RMS; GainCalibration -58 dB a 44,1 kHz, como Chrome/WebKit/Firefox)
    // aplicada aquí: así el motor usa normalize = false y el nodo no recorre la IR en el hilo principal.
    for (i0 = 0; i0 < n; i0 += CB) {
      var ss = Z[4]; i1 = i0 + CB < n ? i0 + CB : n;
      for (i = i0; i < i1; i++) ss += L[i] * L[i] + R[i] * R[i];
      Z[4] = ss; yield 0;
    }
    var pw = Math.max(0.000125, Math.sqrt(Z[4] / (2 * n)) || 0); Z[0] = 0.0012589254 / pw * 44100 / sr;
    for (i0 = 0; i0 < n; i0 += CB) {
      var sc = Z[0]; i1 = i0 + CB < n ? i0 + CB : n;
      for (i = i0; i < i1; i++) { L[i] *= sc; R[i] *= sc; }
      yield 0;
    }
    return [L, R];
  }

  /* ---------- Música: ráfagas originales de set y partido ---------- */
  var NOTE = { A2: 110, D3: 146.83, Fs3: 185, G3: 196, A3: 220, As3: 233.08, B3: 246.94, Cs4: 277.18, D4: 293.66, E4: 329.63,
               Fs4: 369.99, G4: 392, A4: 440, B4: 493.88, Cs5: 554.37, D5: 587.33, Fs5: 739.99, D6: 1174.66,
               Fs6: 1479.98, A6: 1760, D7: 2349.32 };
  /** Voz "metal": dos sierras desafinadas + subarmónico, filtro que se abre al atacar. */
  function* brass(L, R, sr, f, t0, dur, amp, rng) {
    var st = (t0 * sr) | 0, n = Math.ceil((dur + 0.35) * sr), lp = new Biq('lp', 800, 1.2, sr), p1 = rng(), p2 = rng(), p3 = rng();
    var e15 = 1, k15 = Math.exp(-1 / (0.15 * sr)), e30 = 1, k30 = Math.exp(-1 / (0.3 * sr)), rel = 1, kr = Math.exp(-1 / (0.09 * sr)), dn = (dur * sr) | 0;
    var i1 = f * 1.003 / sr, i2 = f * 0.997 / sr, i3 = f * 0.5 / sr, m = Math.min(n, L.length - st);
    // estado entre tramos: 0 p1 · 1 p2 · 2 p3 · 3 e15 · 4 e30 · 5 rel · 6 vb
    var Z = new Float64Array(7); Z[0] = p1; Z[1] = p2; Z[2] = p3; Z[3] = e15; Z[4] = e30; Z[5] = rel; Z[6] = 1;
    for (var j0 = 0; j0 < m; j0 += CH) {
      var j1 = j0 + CH < m ? j0 + CH : m, q1 = Z[0], q2 = Z[1], q3 = Z[2], g15 = Z[3], g30 = Z[4], grel = Z[5], vb = Z[6];
      for (var i = j0; i < j1; i++) {
        var a = Math.min(1, i / (0.025 * sr)); if (i > dn) grel *= kr;
        var env = a * (0.75 + 0.25 * g15) * grel; g15 *= k15; g30 *= k30;
        if ((i & 31) === 0) { lp.set('lp', 500 + 3400 * env * (0.6 + 0.4 * g30), 1.1, sr); vb = 1 + 0.003 * Math.sin(TAU * 5.2 * i / sr) * Math.min(1, i / (0.3 * sr)); }
        q1 += i1 * vb; q2 += i2 * vb; q3 += i3 * vb;
        if (q1 >= 1) q1 -= 1; if (q2 >= 1) q2 -= 1; if (q3 >= 1) q3 -= 1;
        var y = lp.p((2 * q1 - 1) + (2 * q2 - 1) + 0.3 * Math.sin(TAU * q3)) * env * amp;
        L[st + i] += y * 0.9; R[st + i] += y * 0.75;
      }
      Z[0] = q1; Z[1] = q2; Z[2] = q3; Z[3] = g15; Z[4] = g30; Z[5] = grel; Z[6] = vb;
      yield 0;
    }
  }
  /** Campana FM (destellos). */
  function* bell(L, R, sr, f, t0, amp, pan) {
    var st = (t0 * sr) | 0, n = (1.4 * sr) | 0, w = TAU * f / sr, I = 2.2, kI = Math.exp(-1 / (0.15 * sr)), e = amp, ke = Math.exp(-1 / (0.4 * sr));
    var m = Math.min(n, L.length - st), Z = new Float64Array(2); Z[0] = I; Z[1] = e; // estado entre tramos: 0 I · 1 e
    for (var j0 = 0; j0 < m; j0 += CH) {
      var j1 = j0 + CH < m ? j0 + CH : m, gI = Z[0], ge = Z[1];
      for (var i = j0; i < j1; i++) {
        var y = Math.sin(w * i + gI * Math.sin(w * 3.5 * i)) * ge * Math.min(1, i / (0.002 * sr)); gI *= kI; ge *= ke;
        L[st + i] += y * (1 - pan); R[st + i] += y * pan;
      }
      Z[0] = gI; Z[1] = ge; yield 0;
    }
  }
  /** Piano eléctrico suave (derrota). */
  function* epiano(L, R, sr, f, t0, dur, amp) {
    var st = (t0 * sr) | 0, n = Math.ceil((dur + 0.6) * sr), w = TAU * f / sr, dn = (dur * sr) | 0;
    var e = amp, ke = Math.exp(-1 / ((dur * 0.9 + 0.2) * sr)), m = 0.8, km = Math.exp(-1 / (0.3 * sr)), h = 0.15, kh = Math.exp(-1 / (0.2 * sr)), r = 1, kr = Math.exp(-1 / (0.2 * sr));
    var lim = Math.min(n, L.length - st), Z = new Float64Array(4); Z[0] = e; Z[1] = m; Z[2] = h; Z[3] = r; // estado: 0 e · 1 m · 2 h · 3 r
    for (var j0 = 0; j0 < lim; j0 += CH) {
      var j1 = j0 + CH < lim ? j0 + CH : lim, ge = Z[0], gm = Z[1], gh = Z[2], gr = Z[3];
      for (var i = j0; i < j1; i++) {
        if (i > dn) gr *= kr;
        var y = (Math.sin(w * i + gm * Math.sin(w * i)) + gh * Math.sin(2 * w * i)) * ge * gr * Math.min(1, i / (0.01 * sr));
        ge *= ke; gm *= km; gh *= kh;
        var s5 = 0.1 * Math.sin(5 * i / sr);
        L[st + i] += y * (1 + s5); R[st + i] += y * (1 - s5);
      }
      Z[0] = ge; Z[1] = gm; Z[2] = gh; Z[3] = gr; yield 0;
    }
  }
  function* boom(L, R, sr, t0, amp, rng) {
    var st = (t0 * sr) | 0, n = (0.9 * sr) | 0, ph = 0, e1 = 1, k1 = Math.exp(-1 / (0.05 * sr)), e2 = amp, k2 = Math.exp(-1 / (0.35 * sr)), e3 = 0.3 * amp, k3 = Math.exp(-1 / (0.02 * sr));
    var m = Math.min(n, L.length - st), rs = rng.st, Z = new Float64Array(4); Z[0] = ph; Z[1] = e1; Z[2] = e2; Z[3] = e3; // estado: 0 ph · 1 e1 · 2 e2 · 3 e3
    for (var j0 = 0; j0 < m; j0 += CH) {
      var j1 = j0 + CH < m ? j0 + CH : m, gph = Z[0], g1 = Z[1], g2 = Z[2], g3 = Z[3];
      for (var i = j0; i < j1; i++) {
        gph += TAU * (48 + 40 * g1) / sr; g1 *= k1;
        var y = Math.sin(gph) * g2 + (rnd(rs) * 2 - 1) * g3; g2 *= k2; g3 *= k3;
        L[st + i] += y; R[st + i] += y;
      }
      Z[0] = gph; Z[1] = g1; Z[2] = g2; Z[3] = g3; yield 0;
    }
  }
  function* crash(L, R, sr, t0, amp, rng) {
    var st = (t0 * sr) | 0, n = (2 * sr) | 0, hp = new Biq('hp', 5000, 0.7, sr), hp2 = new Biq('hp', 4000, 0.7, sr), ke = Math.exp(-1 / (0.6 * sr));
    var m = Math.min(n, L.length - st), rs = rng.st, Z = new Float64Array(1); Z[0] = amp; // Z[0] = envolvente entre tramos
    for (var j0 = 0; j0 < m; j0 += CH) {
      var j1 = j0 + CH < m ? j0 + CH : m, e = Z[0];
      for (var i = j0; i < j1; i++) { L[st + i] += hp.p(rnd(rs) * 2 - 1) * e; R[st + i] += hp2.p(rnd(rs) * 2 - 1) * e; e *= ke; }
      Z[0] = e; yield 0;
    }
  }
  /** Partitura como datos: cada nota es un paso del plan.
   *  ['b', nota, t, dur, amp] metal · ['c', [notas], t, dur, amp] acorde · ['boom', t, amp] · ['crash', t, amp]
   *  ['bell', nota, t, amp, pan] · ['ep', nota, t, dur, amp] piano eléctrico */
  var SCORES = {
    // Set ganado: anacrusa + Re mayor con destellos (~1.6 s)
    setWin: { dur: 1.9, peak: 0.8, fade: 0.25, n: [['b', 'A3', 0, 0.09, 0.5], ['b', 'D4', 0.11, 0.09, 0.5], ['c', ['D4', 'Fs4', 'A4', 'D5'], 0.22, 0.85, 0.32],
      ['b', 'D3', 0.22, 0.85, 0.4], ['boom', 0.22, 0.6], ['bell', 'D6', 0.24, 0.12, 0.3], ['bell', 'A6', 0.36, 0.1, 0.7], ['bell', 'D7', 0.48, 0.07, 0.5]] },
    // Partido ganado: fanfarria I-IV-V-I (~3.3 s)
    matchWin: { dur: 3.6, peak: 0.85, fade: 0.4, n: [['b', 'A3', 0, 0.1, 0.5], ['b', 'D4', 0.12, 0.1, 0.5], ['b', 'Fs4', 0.24, 0.1, 0.5],
      ['c', ['D4', 'Fs4', 'A4', 'D5'], 0.36, 0.22, 0.3], ['boom', 0.36, 0.5],
      ['c', ['D4', 'G4', 'B4'], 0.72, 0.2, 0.32], ['b', 'G3', 0.72, 0.2, 0.35],
      ['c', ['E4', 'A4', 'Cs5'], 0.98, 0.2, 0.32], ['b', 'A2', 0.98, 0.2, 0.4], ['boom', 0.98, 0.4],
      ['c', ['D4', 'Fs4', 'A4', 'D5', 'Fs5'], 1.25, 1.6, 0.28], ['b', 'D3', 1.25, 1.6, 0.45], ['boom', 1.25, 0.8], ['crash', 1.25, 0.18],
      ['bell', 'D6', 1.27, 0.12, 0.2], ['bell', 'Fs6', 1.39, 0.11, 0.8], ['bell', 'A6', 1.51, 0.1, 0.35], ['bell', 'D7', 1.63, 0.09, 0.65]] },
    // Set perdido: Si menor -> Fa# (suave)
    setLose: { dur: 2, peak: 0.6, fade: 0.3, n: [['ep', 'B3', 0, 0.55, 0.3], ['ep', 'D4', 0.03, 0.55, 0.3], ['ep', 'Fs4', 0.06, 0.55, 0.3],
      ['ep', 'Fs3', 0.62, 0.9, 0.3], ['ep', 'B3', 0.65, 0.9, 0.3], ['ep', 'Cs4', 0.68, 0.9, 0.3]] },
    // Partido perdido: Si menor -> Sol -> Fa#
    matchLose: { dur: 3, peak: 0.6, fade: 0.3, n: [['ep', 'B3', 0, 0.6, 0.3], ['ep', 'D4', 0.04, 0.6, 0.3], ['ep', 'Fs4', 0.08, 0.6, 0.3],
      ['ep', 'G3', 0.65, 0.6, 0.3], ['ep', 'B3', 0.69, 0.6, 0.3], ['ep', 'D4', 0.73, 0.6, 0.3],
      ['ep', 'Fs3', 1.3, 1.1, 0.3], ['ep', 'As3', 1.34, 1.1, 0.3], ['ep', 'Cs4', 1.38, 1.1, 0.3]] }
  };
  function* musicPlan(sc, rng, sr) {
    var n = Math.ceil(sc.dur * sr), L = new Float32Array(n), R = new Float32Array(n);
    for (var k = 0; k < sc.n.length; k++) {
      var x = sc.n[k];
      switch (x[0]) {
        case 'c': for (var c = 0; c < x[1].length; c++) yield* brass(L, R, sr, NOTE[x[1][c]], x[2], x[3], x[4], rng); break;
        case 'b': yield* brass(L, R, sr, NOTE[x[1]], x[2], x[3], x[4], rng); break;
        case 'boom': yield* boom(L, R, sr, x[1], x[2], rng); break;
        case 'crash': yield* crash(L, R, sr, x[1], x[2], rng); break;
        case 'bell': yield* bell(L, R, sr, NOTE[x[1]], x[2], x[3], x[4]); break;
        case 'ep': yield* epiano(L, R, sr, NOTE[x[1]], x[2], x[3], x[4]); break;
      }
    }
    yield* balanceLRG([L, R]);
    yield* normalizeG([L, R], sc.peak);
    return edges([L, R], sr, 0.001, sc.fade);
  }

  /* ---------- Catálogo ----------
   * nombre -> {gen(rng, sr) -> canales | plan {steps, done}, variants, rate}
   * rate: 'full' (= frecuencia del contexto, máx. 48 kHz), 'ctx' (exacta: la reverb lo exige), 'mid' (32 kHz), 'low' (22,05 kHz) */
  var CATALOG = {};
  function reg(name, variants, rate, fn) { CATALOG[name] = { gen: fn, variants: variants, rate: rate }; }
  Object.keys(IMPACTS).forEach(function (k) {
    reg(k, (k === 'bombo' || k === 'beat') ? 1 : 3, 'full', function (rng, sr) { return impact(IMPACTS[k], rng, sr); });
  });
  reg('net', 2, 'full', function (rng, sr) { return genNet(false, rng, sr); });
  reg('netTape', 2, 'full', function (rng, sr) { return genNet(true, rng, sr); });
  reg('whistle', 2, 'full', function (rng, sr) { return genWhistle(0.32, rng, sr); });
  reg('whistleLong', 2, 'full', function (rng, sr) { return genWhistle(0.62, rng, sr); });
  reg('whistleEnd', 1, 'full', function (rng, sr) { return genWhistle(1.05, rng, sr); });
  reg('squeak', 5, 'full', genSqueak);
  reg('scuff', 2, 'full', genScuff);
  reg('whoosh', 2, 'full', genWhoosh);
  reg('slide', 2, 'full', genSlide);
  reg('perfect', 1, 'full', genPerfect);
  ['click', 'hover', 'back', 'start'].forEach(function (k) { reg(k, 1, 'full', function (rng, sr) { return genUi(k, rng, sr); }); });
  ['murmur', 'excite', 'groan', 'ooh', 'applause', 'palmas'].forEach(function (k) { reg(k, 1, 'low', CROWD[k]); });
  reg('roar', 2, 'low', CROWD.roar);
  Object.keys(SCORES).forEach(function (k) { reg(k, 1, 'mid', function (rng, sr) { return musicPlan(SCORES[k], rng, sr); }); });
  reg('ir', 1, 'ctx', genIR);
  /** Orden de generación: primero lo que suena antes (interfaz, silbato, toques), luego grada y música. */
  var PRIORITY = ['click', 'hover', 'start', 'back', 'whistle', 'serve', 'pass', 'set', 'spike', 'land', 'whistleLong', 'free', 'block', 'net',
    'ir', 'murmur', 'bounce', 'slam', 'netTape', 'squeak', 'feet', 'scuff', 'whoosh', 'roar', 'applause', 'groan', 'excite', 'ooh',
    'whistleEnd', 'slide', 'perfect', 'palmas', 'bombo', 'beat', 'setWin', 'setLose', 'matchWin', 'matchLose'];
  Object.keys(CATALOG).forEach(function (k) { if (PRIORITY.indexOf(k) < 0) PRIORITY.push(k); });

  /* ---------- Plan de mezcla ----------
   * Nivel de cada sonido (dB) para que, a la ganancia nominal de su llamada, caiga en el objetivo de su
   * categoría (LUFS a la salida para señales por debajo del umbral del compresor, con su maquillaje incluido;
   * medido con tools/audiotest.js, tolerancia ±1,5 LU):
   *   interfaz -24 (hover/cambio -28) · toques -18 (colocación/dejada -21) · remate -14 · bloqueo/remate al suelo -15 · balón en el suelo
   *   y red -18 · silbato -16 · pies/zapatillas/brazo -24 · botes muertos -26 · lecho de grada -26 · reacciones
   *   de grada -20 · palmas/latido -22 · ráfagas -16 · destello "perfecto" -26.
   * Los posicionales se miden en campo propio a ~8 m de la cámara (con su panoramizador). */
  var LEVEL = {};
  var LEVEL_LIN = {};
  function setLevels(o) { for (var k in o) { LEVEL[k] = o[k]; LEVEL_LIN[k] = Math.pow(10, o[k] / 20); } }
  setLevels({
    pass: 5.3, set: 10.9, free: 7.9, serve: 2.5, spike: 2.8, block: 3.3, slam: -2.7, land: -0.2, net: 5.9, netTape: 5.7, bounce: 5.9,
    whistle: -3.1, whistleLong: -4.9, whistleEnd: -4.7, squeak: 4.3, scuff: 12.9, feet: 10.2, whoosh: 5.1, slide: 0.7,
    roar: -0.4, groan: -0.6, applause: 8.3, ooh: 1.7, palmas: 3.9, bombo: 3.9, beat: 0.8, murmur: -4.9, excite: -4.9,
    setWin: 2.7, setLose: 5.4, matchWin: 1.5, matchLose: 4.8, perfect: 7.7, click: 5.2, back: 4.3, start: -2.6, hover: 10
  });


  function seedOf(name, variant) {
    var seed = 0;
    for (var i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
    return (seed * 7919 + (variant || 0) * 104729 + 1) >>> 0;
  }
  function rateOf(kind, ctxRate) {
    ctxRate = ctxRate || 44100;
    return kind === 'ctx' ? ctxRate : kind === 'mid' ? 32000 : kind === 'low' ? 22050 : Math.min(48000, ctxRate);
  }
  /** Genera los canales de un sonido sin AudioContext (tests en node / audición).
   *  synth(name, variant, ctxSampleRate) -> [Float32Array...] (la frecuencia real: synthRate(name, ctxRate)) */
  function synth(name, variant, ctxRate) {
    var c = CATALOG[name]; if (!c) return null;
    return runSync(c.gen(makeRng(seedOf(name, variant)), rateOf(c.rate, ctxRate)));
  }

  /* ------------------------------------------------------------------
   * 3. Motor WebAudio
   * ------------------------------------------------------------------ */
  var vctx = null;                    // VB.ctx
  var AC = null, N = {}, bank = Object.create(null), jobs = [], jobTimer = null, built = 0, total = 0;
  var pend = [];                      // sonidos ya sintetizados (Float32) a la espera de tener AudioContext
  var genStarted = false, delayT = null;
  var GUESS_RATE = 48000;             // frecuencia supuesta antes del gesto (la habitual); solo la reverb exige la exacta
  var muted = false, hidden = false, state = 'menu', demo = true, reverbOn = true;
  var vol = { master: 0.9, sfx: 1, music: 0.75, crowd: 0.85 };
  var MAX_VOICES = 32, ends = new Float64Array(40), slowRate = 1;
  var last = {};                      // nombre -> último instante (anti-amontonado)
  var stats = { played: {}, skipped: 0, built: 0, synth: 0, total: 0, genMs: 0, steps: 0, maxStepMs: 0, maxStep: '', maxSliceMs: 0, slow: [], hist: new Uint32Array(41), // hist[k]: pasos de k/4..(k+1)/4 ms (el último: ≥ 10 ms)
                startedAt: -1, synthDoneAt: -1, unlockAt: -1, bankDoneAt: -1, reverbAt: -1,
                deferred: 0, lateDrop: 0, lateMax: 0 }; // aplazados (sin buffer aún), descartados por llegar tarde, retraso máx. (ms)
  var stingDone = false, beatNext = 0, clapNext = 0, clapBeat = 0, serveWait = 0, serveTeam = -1, mpServe = false;
  var excite = 0, exciteBoost = 0, lastSpikeT = -9, lastSpikeTeam = -1, tossHush = 0;
  var pvx = new Float32Array(8), pvy = new Float32Array(8), scd = new Float32Array(8), squeakGap = 0;
  var applied = { fx: -1, crowd: -1, mur: -1, exc: -1, bright: -1, sfx: -1, music: -1, master: -1, rate: -1 };
  var SP_PAN = 0, SP_ATT = 1;
  var perf = root.performance && root.performance.now ? root.performance : Date;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return AC ? AC.currentTime : 0; }
  function live() { return !!AC && AC.state === 'running' && !muted; }

  function toBuffer(chs, sr) {
    var b = AC.createBuffer(chs.length, chs[0].length, sr);
    for (var c = 0; c < chs.length; c++) {
      if (b.copyToChannel) b.copyToChannel(chs[c], c); else b.getChannelData(c).set(chs[c]);
    }
    return b;
  }
  /* Cola de generación troceada.
   *  - Empieza SIN AudioContext (sintetizar Float32Array no es audio): ~1,2 s después de init(),
   *    en los huecos libres del menú. Al primer gesto el banco suele estar ya sintetizado y solo
   *    queda copiarlo a AudioBuffers (barato, también troceado).
   *  - Cada sonido es un generador que cede cada ~1k muestras: el presupuesto se comprueba entre
   *    pasos de ≤ ~1 ms (escritorio), no entre sonidos enteros.
   *  - Orden: interfaz, silbatos, toques; después grada y música (PRIORITY). La reverb (exige la
   *    frecuencia exacta del contexto) entra en cola al crear el contexto. */
  function queueAll() {
    for (var p = 0; p < PRIORITY.length; p++) {
      var c = CATALOG[PRIORITY[p]];
      for (var v = 0; v < c.variants; v++) jobs.push({ name: PRIORITY[p], v: v, it: null, sr: 0 });
    }
    total = stats.total = jobs.length;
  }
  function startGen(delay) {
    if (genStarted) return;
    genStarted = true;
    stats.startedAt = perf.now();
    queueAll();
    schedule(delay || 0);
  }
  function schedule(delay) {
    if (jobTimer != null || (!jobs.length && !(AC && (pend.length || irWaiting())))) return;
    var st = root.setTimeout;
    if (delay > 0 && st) { if (delayT == null) delayT = st(function () { delayT = null; schedule(0); }, delay); return; }
    if (delayT != null) return;     // aún en la espera inicial tras init()
    // en pleno peloteo solo huecos libres (timeout largo: como mucho ~2 ms cada 250 ms); entre puntos, en menú
    // y en pausa se fuerza antes si no hay huecos (2 ms cada 100 / 60 ms). Sin el escalón intermedio, en un móvil
    // sin huecos libres el lecho de grada tardaba más de un minuto de partido en estar listo (medido: CPU ×4).
    var playing = state === 'playing' && !demo, g = vctx && vctx.game, rally = playing && (!g || g.mode === 'rally');
    var tmo = urgent ? 16 : rally ? 250 : playing ? 100 : 60; // urgent: hay un sonido aplazado esperando su buffer
    if (root.requestIdleCallback) jobTimer = root.requestIdleCallback(runJobs, { timeout: tmo });
    else if (st) jobTimer = st(runJobs, rally ? 24 : 16);
    else runJobs();
  }
  function bankDone() { if (!jobs.length && !pend.length && !irWaiting() && AC && stats.bankDoneAt < 0) stats.bankDoneAt = perf.now(); }
  function finishJob(j, chs) {
    stats.synth++;
    if (!jobs.length && stats.synthDoneAt < 0) stats.synthDoneAt = perf.now();
    if (AC) toBank(j.name, chs, j.sr); else pend.push({ name: j.name, chs: chs, sr: j.sr });
  }
  function toBank(name, chs, sr) {
    if (name === 'ir') {
      if (sr !== AC.sampleRate) { // se sintetizó con la frecuencia supuesta y el contexto usa otra: rehacer
        jobs.splice(jobs.length && jobs[0].it ? 1 : 0, 0, { name: 'ir', v: 0, it: null, sr: 0 });
        return;
      }
      irData = chs; irSeg = 0; built++; stats.built = built;
      return;
    }
    try {
      var b = toBuffer(chs, sr);
      (bank[name] = bank[name] || []).push(b);
      if (name === 'murmur' || name === 'excite') startBed(name);
      if (deferred.length) flushDeferred(name);
    } catch (e) { }
    built++; stats.built = built;
  }
  /* Reverb troceada: asignar ConvolverNode.buffer hace FFTs de toda la IR en el hilo principal
   * (medido: ~60 ms con normalize, ~25-35 ms sin él, para 1,8 s estéreo en escritorio). Se reparte en
   * IR_SEG tramos de 0,3 s, cada uno en su ConvolverNode precedido de un DelayNode con su desfase:
   * la suma es la misma convolución, exacta. Un tramo por paso (~3-4 ms en escritorio) y nunca en
   * pleno peloteo. Coste en el hilo de audio: ~2 % de un núcleo (medido con OfflineAudioContext). */
  var IR_SEG = 0.3, irData = null, irSeg = -1;
  function irWaiting() { return !!irData && irSeg >= 0; }
  function quietNow() {
    var g = vctx && vctx.game;
    return state !== 'playing' || !g || g.mode !== 'rally';
  }
  function irStep() {
    var sr = AC.sampleRate, n = irData[0].length, a = Math.round(irSeg * IR_SEG * sr), b = Math.min(n, Math.round((irSeg + 1) * IR_SEG * sr));
    try {
      var buf = AC.createBuffer(2, b - a, sr);
      for (var c = 0; c < 2; c++) {
        var sub = irData[c].subarray(a, b);
        if (buf.copyToChannel) buf.copyToChannel(sub, c); else buf.getChannelData(c).set(sub);
      }
      var cv = AC.createConvolver(); cv.normalize = false; cv.buffer = buf;
      if (a > 0) { var dl = AC.createDelay(Math.max(1, b / sr)); dl.delayTime.value = a / sr; N.revBus.connect(dl); dl.connect(cv); }
      else N.revBus.connect(cv);
      cv.connect(N.revOut);
    } catch (e) { }
    irSeg++;
    if (b >= n) { irData = null; irSeg = -1; stats.reverbAt = perf.now(); }
  }
  function runJobs(deadline) {
    jobTimer = null;
    if (urgent && AC) { // aplazados que ya no llegarán a tiempo (p. ej. su trabajo falló): fuera
      var tn = AC.currentTime;
      for (var dk = deferred.length - 1; dk >= 0; dk--) if (tn - deferred[dk].at > DEFER[deferred[dk].name]) { deferred.splice(dk, 1); stats.skipped++; stats.lateDrop++; }
      urgent = deferred.length > 0;
    }
    // Presupuesto: hueco libre real si lo hay (requestIdleCallback), menos 1 ms de margen para no rozar el
    // siguiente frame; si el navegador fuerza la llamada (timeout) o no hay rIC, solo ~2-3 ms.
    var t0 = perf.now(), idle = deadline && deadline.timeRemaining && !deadline.didTimeout;
    var budget = idle ? clamp(deadline.timeRemaining() - 1, 1, 8) : (root.requestIdleCallback ? 2 : 3);
    // un sonido aplazado espera (silbato del primer saque, ovación de bienvenida): tramos de hasta 6 ms hasta que suene
    if (urgent && budget < 6) budget = 6;
    var irOk = AC && irWaiting() && quietNow();
    while ((jobs.length || (AC && pend.length) || irOk) && perf.now() - t0 < budget) {
      var s0 = perf.now(), lab;
      if (AC && pend.length) { // copiar a AudioBuffer lo ya sintetizado (rápido: un memcpy por canal)
        var pj = pend.shift(); lab = pj.name + '#buf';
        toBank(pj.name, pj.chs, pj.sr); pj.chs = null;
      } else if (irOk) {
        lab = 'ir#seg' + irSeg; irStep(); irOk = irWaiting();
      } else if (!jobs.length) {
        break;
      } else {
        var j = jobs[0];
        try {
          if (!j.it) {
            var c = CATALOG[j.name];
            j.sr = rateOf(c.rate, AC ? AC.sampleRate : GUESS_RATE);
            j.it = c.gen(makeRng(seedOf(j.name, j.v)), j.sr);
          }
          var r = j.it.next(); lab = j.name;
          if (r.done) { jobs.shift(); finishJob(j, r.value); }
        } catch (e) { jobs.shift(); built++; stats.built = built; }
      }
      var sd = perf.now() - s0; stats.steps++; stats.hist[Math.min(40, (sd * 4) | 0)]++;
      if (sd > stats.maxStepMs) { stats.maxStepMs = sd; stats.maxStep = lab || '?'; }
      if (sd > 1.5 && stats.slow.length < 12) stats.slow.push((lab || '?') + ':' + sd.toFixed(1)); // diagnóstico
    }
    var sl = perf.now() - t0; stats.genMs += sl; if (sl > stats.maxSliceMs) stats.maxSliceMs = sl;
    bankDone();
    schedule(0);
  }

  var MAKEUP_COMP = 0.7153; // -2,91 dB: maquillaje medido en Chrome para -10 dB / rodilla 8 / 4:1
  /** Curva del recortador de seguridad: lineal hasta 0,8 y curva suave por encima (a fondo de escala da 0,945: nunca 1). */
  function clipCurve() {
    var n = 2049, c = new Float32Array(n), t = 0.8, top = 0.98;
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1, a = Math.abs(x);
      var y = a <= t ? a : t + (top - t) * Math.tanh((a - t) / (top - t));
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }
  function ensure() {
    if (AC) return AC;
    var Ctor = root.AudioContext || root.webkitAudioContext; if (!Ctor) return null;
    try { AC = new Ctor({ latencyHint: 'interactive' }); } catch (e) { try { AC = new Ctor(); } catch (e2) { AC = null; return null; } }
    try {
      // Máster: compresor de "pegamento" que solo actúa en los picos (remates, ovaciones) + compensación de su
      // ganancia de maquillaje automática (Chrome/WebKit la aplican siempre: +2,9 dB medidos con estos ajustes;
      // con los antiguos, +4,4 dB que subían también los sonidos flojos) + recortador suave de seguridad.
      N.comp = AC.createDynamicsCompressor();
      N.comp.threshold.value = -10; N.comp.knee.value = 8; N.comp.ratio.value = 4; N.comp.attack.value = 0.003; N.comp.release.value = 0.2;
      N.post = AC.createGain(); N.post.gain.value = MAKEUP_COMP;
      N.comp.connect(N.post);
      var out = N.post;
      if (AC.createWaveShaper) { N.clip = AC.createWaveShaper(); N.clip.curve = clipCurve(); N.clip.oversample = '2x'; N.post.connect(N.clip); out = N.clip; }
      out.connect(AC.destination);
      N.master = AC.createGain(); N.master.gain.value = 0; N.master.connect(N.comp);
      N.fx = AC.createBiquadFilter(); N.fx.type = 'lowpass'; N.fx.frequency.value = 20000; N.fx.Q.value = 0.5; N.fx.connect(N.master);
      N.sfx = AC.createGain(); N.sfx.gain.value = vol.sfx; N.sfx.connect(N.fx);
      N.crowdTone = AC.createBiquadFilter(); N.crowdTone.type = 'lowpass'; N.crowdTone.frequency.value = 2500; N.crowdTone.Q.value = 0.4;
      N.crowdEq = AC.createBiquadFilter(); N.crowdEq.type = 'peaking'; N.crowdEq.frequency.value = 3300; N.crowdEq.Q.value = 1.1; N.crowdEq.gain.value = 0;
      N.crowdTone.connect(N.crowdEq); N.crowdEq.connect(N.fx);
      N.crowd = AC.createGain(); N.crowd.gain.value = vol.crowd; N.crowd.connect(N.crowdTone);
      N.music = AC.createGain(); N.music.gain.value = vol.music; N.music.connect(N.master);
      N.revIn = AC.createGain(); N.revIn.gain.value = 1;
      N.revBus = AC.createGain(); N.revBus.gain.value = 1;   // reparte a los tramos de convolución (irStep)
      N.revOut = AC.createGain(); N.revOut.gain.value = 0.55;
      N.revOut.connect(N.fx);
      if (reverbOn) N.revIn.connect(N.revBus);
      N.murG = AC.createGain(); N.murG.gain.value = 0; N.murG.connect(N.crowd);
      N.excG = AC.createGain(); N.excG.gain.value = 0; N.excG.connect(N.crowd);
    } catch (e) { AC = null; N = {}; return null; }
    stats.unlockAt = perf.now();
    // dentro del gesto: los sonidos que no pueden perderse y ya están sintetizados pasan a AudioBuffer ya
    // (una copia de memoria cada uno, < 1 ms en total), sin esperar a la cola troceada
    for (var pk = 0; pk < pend.length; pk++) {
      if (Object.prototype.hasOwnProperty.call(DEFER, pend[pk].name)) { var pj = pend.splice(pk--, 1)[0]; toBank(pj.name, pj.chs, pj.sr); }
    }
    startGen(0);
    if (delayT != null) { try { root.clearTimeout(delayT); } catch (e) { } delayT = null; } // gesto antes de 1,2 s: empezar ya
    if (jobTimer == null) runJobs(); // primer tramo ya, dentro del gesto (≤ ~3 ms)
    applyVolumes(true);
    return AC;
  }
  function startBed(name) {
    if (!AC || !bank[name] || N[name + 'Src']) return;
    try {
      var s = AC.createBufferSource(); s.buffer = bank[name][0]; s.loop = true;
      s.playbackRate.value = slowRate;
      s.connect(name === 'murmur' ? N.murG : N.excG);
      s.start(AC.currentTime + 0.01, Math.random() * 2);
      N[name + 'Src'] = s;
    } catch (e) { }
  }

  /** Posición estéreo y atenuación respecto a la cámara (coords de sim). */
  function spatial(px, py) {
    SP_PAN = 0; SP_ATT = 1;
    var cam = vctx && vctx.camera; if (!cam || !cam.position || px == null || !isFinite(px)) return;
    var cx = cam.position.x, cy = -cam.position.z, dx = px - cx, dy = (isFinite(py) ? py : 0) - cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
    var rx = 0, ry = 1, B = null;
    try { B = VB.CameraRig && VB.CameraRig.getBasis && VB.CameraRig.getBasis(); } catch (e) { }
    if (B && isFinite(B.rx) && isFinite(B.ry)) { rx = B.rx; ry = B.ry; }
    SP_PAN = clamp((dx * rx + dy * ry) / d, -1, 1) * 0.75;
    SP_ATT = 1 / (1 + Math.max(0, d - 4) * 0.055);
  }

  /** Reproduce un buffer del banco.
   *  bus: 'sfx'|'crowd'|'music'. px,py: posición de sim (null = no posicional). */
  function play(name, gain, px, py, rate, send, delay, bus) {
    if (!live()) return null;
    // argumentos saneados: un NaN en gain.value lanza en Chrome (el sonido se perdía con nodos creados sin conectar)
    gain = isFinite(gain) ? clamp(+gain, 0, 4) : 1;
    if (px != null && !isFinite(px)) px = null;
    if (!isFinite(py)) py = 0;
    if (!(rate > 0) || !isFinite(rate)) rate = 1;
    if (!(send > 0) || !isFinite(send)) send = 0;
    if (!(delay > 0) || !isFinite(delay)) delay = 0;
    var list = bank[name];
    if (!list || !list.length) { if (!deferPlay(name, gain, px, py, rate, send, delay, bus, false)) stats.skipped++; return null; }
    var t = AC.currentTime + (delay || 0), slot = -1, lim = bus === 'music' ? ends.length : MAX_VOICES;
    for (var k = 0; k < lim; k++) if (ends[k] <= t) { slot = k; break; }
    if (slot < 0) { stats.skipped++; return null; }
    try {
      var buf = list[(Math.random() * list.length) | 0];
      var src = AC.createBufferSource(); src.buffer = buf;
      var r = (rate || 1) * (bus === 'music' ? 1 : slowRate);
      src.playbackRate.value = r;
      gain *= LEVEL_LIN[name] || 1;
      var g = AC.createGain(); g.gain.value = gain;
      src.connect(g);
      var out = g;
      if (px != null) {
        // siempre con panoramizador: StereoPanner reparte un mono a -3 dB por canal en el centro, así que crearlo
        // solo cuando pan ≠ 0 hacía saltar 3 dB un mismo golpe según cayera en el centro o no (audiotest)
        spatial(px, py); g.gain.value = gain * SP_ATT;
        if (AC.createStereoPanner) { var p = AC.createStereoPanner(); p.pan.value = SP_PAN; g.connect(p); out = p; }
      }
      out.connect(bus === 'music' ? N.music : bus === 'crowd' ? N.crowd : N.sfx);
      if (send > 0 && reverbOn) { var s = AC.createGain(); s.gain.value = send; out.connect(s); s.connect(N.revIn); }
      src.start(t);
      ends[slot] = t + buf.duration / r + 0.02;
      stats.played[name] = (stats.played[name] || 0) + 1;
      return src;
    } catch (e) { return null; }
  }
  /* Sonidos que no pueden perderse si el banco aún no los tiene (gesto rápido en un móvil lento: el silbato del
   * primer saque y la ovación de bienvenida llegaban antes que sus AudioBuffers y se descartaban). Se aplazan,
   * su trabajo pasa al frente de la cola y suenan en cuanto existen, salvo que ya lleguen tarde: máximo de
   * retraso (s) por sonido; un silbato con más de 0,6 s de retraso ya no tiene sentido y se descarta. */
  var DEFER = { whistle: 0.6, whistleLong: 0.6, whistleEnd: 0.8, roar: 2.5, applause: 2.5, groan: 1.5, ooh: 0.5,
                setWin: 1.5, setLose: 1.5, matchWin: 2.5, matchLose: 2.5, start: 0.3, click: 0.2 };
  var deferred = [], urgent = false;
  function deferPlay(name, gain, px, py, rate, send, delay, bus, wh) {
    if (!AC || !genStarted || !Object.prototype.hasOwnProperty.call(DEFER, name)) return false;
    var t = AC.currentTime;
    for (var k = deferred.length - 1; k >= 0; k--) if (t - deferred[k].at > DEFER[deferred[k].name]) { deferred.splice(k, 1); stats.skipped++; stats.lateDrop++; }
    if (deferred.length >= 8) return false;
    deferred.push({ name: name, gain: gain, px: px, py: py, rate: rate, send: send, at: t + (delay || 0), bus: bus, wh: !!wh });
    stats.deferred++;
    bump(name);
    return true;
  }
  /** Pasa al frente de la cola los trabajos de `name` que aún no estén sintetizados, y pide el siguiente tramo ya. */
  function bump(name) {
    var k;
    // ya sintetizado y esperando su copia a AudioBuffer: al frente de esa cola (se copia en el siguiente tramo)
    for (k = 0; k < pend.length; k++) if (pend[k].name === name) { pend.unshift(pend.splice(k, 1)[0]); break; }
    // si no, su primera variante al frente de la generación (con una basta para que suene; el resto, en su turno).
    // Un trabajo a medias espera detrás: su generador conserva el estado.
    if (k === pend.length && !(bank[name] && bank[name].length)) {
      for (k = 0; k < jobs.length; k++) if (jobs[k].name === name) { if (k > 0) jobs.unshift(jobs.splice(k, 1)[0]); break; }
    }
    if (!urgent) {
      urgent = true;
      if (jobTimer != null && root.cancelIdleCallback) { try { root.cancelIdleCallback(jobTimer); } catch (e) { } jobTimer = null; }
      schedule(0);
    }
  }
  function flushDeferred(name) {
    var t = AC.currentTime;
    for (var k = 0; k < deferred.length; k++) {
      var d = deferred[k]; if (d.name !== name) continue;
      deferred.splice(k--, 1);
      var late = t - d.at;
      if (late > DEFER[name]) { stats.skipped++; stats.lateDrop++; continue; }
      stats.lateMax = Math.max(stats.lateMax, Math.round(late * 1000));
      if (d.wh) whistle(name, d.gain, Math.max(0, -late), d.rate); else play(name, d.gain, d.px, d.py, d.rate, d.send, Math.max(0, -late), d.bus);
    }
    if (!deferred.length) urgent = false;
  }
  /** Igual que play() pero ignora repeticiones del mismo sonido en menos de `gap` s. */
  function playGap(name, gap, gain, px, py, rate, send, delay, bus) {
    if (!live()) return null;
    var t = now() + (delay || 0);
    if (last[name] != null && t - last[name] < gap && t >= last[name]) return null;
    last[name] = t;
    return play(name, gain, px, py, rate, send, delay, bus);
  }
  function jit(a) { return 1 + (Math.random() - 0.5) * a; }

  function setParam(p, key, v, tc) {
    if (Math.abs(applied[key] - v) < 1e-4) return;
    applied[key] = v;
    try { p.cancelScheduledValues && p.cancelScheduledValues(AC.currentTime); p.setTargetAtTime(v, AC.currentTime, tc); } catch (e) { p.value = v; }
  }
  function applyVolumes(instant) {
    if (!AC) return;
    var tc = instant ? 0.005 : 0.08;
    setParam(N.master.gain, 'master', muted ? 0 : vol.master, tc);
    setParam(N.sfx.gain, 'sfx', vol.sfx * (demo ? 0.35 : 1) * (state === 'paused' ? 0.5 : 1), tc);
    setParam(N.music.gain, 'music', vol.music, tc);
  }
  function suspendIfIdle() {
    if (!AC || !AC.suspend) return;
    if ((muted || hidden) && AC.state === 'running') { try { var p = AC.suspend(); if (p && p.catch) p.catch(function () { }); } catch (e) { } }
  }
  function resumeIfWanted() {
    if (!AC || !AC.resume || muted || hidden) return;
    if (AC.state !== 'running') { try { var p = AC.resume(); if (p && p.catch) p.catch(function () { }); } catch (e) { } }
  }

  /* ------------------------------------------------------------------
   * 4. Reacciones a los eventos
   * ------------------------------------------------------------------ */
  function evx(e) { return e.player && isFinite(e.player.x) ? e.player.x : e.x; }
  function evy(e) { return e.player && isFinite(e.player.y) ? e.player.y : e.y; }

  function onHit(e) {
    var k = e.kind, q = isFinite(e.quality) ? e.quality : 1, sp = isFinite(e.speed) ? e.speed : 8, x = e.x, y = e.y;
    var hg = e.human ? 1 : 0.92, shot = e.shot || '', pw = isFinite(e.power) ? clamp(e.power, 0, 1) : 0.5;
    // el balón da en el cuerpo sin gesto (sim shot 'body'): golpe sordo, más apagado que un 'shank'
    if (shot === 'body') { play('free', 0.5 * hg, x, y, jit(0.1) * 0.7, 0.1); lastSpikeTeam = -1; return; }
    switch (k) {
      case 'serve':
        if (shot === 'jump') play('spike', 0.85 * hg * (0.85 + 0.2 * pw), x, y, jit(0.06) * 1.05, 0.35); // saque en salto: casi un remate
        else play('serve', 0.8 * hg * clamp(0.75 + sp / 40, 0.8, 1.15), x, y, jit(0.08), 0.28);
        break;
      case 'set': play('set', 0.55 * hg, x, y, jit(0.1) * (0.95 + q * 0.1), 0.12); break;
      case 'spike':
        play('spike', hg * (0.82 + 0.25 * pw), x, y, jit(0.06) * (0.96 + 0.08 * pw), 0.32 + 0.1 * pw);
        if (!demo) exciteBoost = Math.max(exciteBoost, 0.15 + 0.15 * pw);
        lastSpikeT = isFinite(e.t) ? e.t : 0; lastSpikeTeam = e.team; break;
      case 'free':
        if (shot === 'tip') play('set', 0.5 * hg, x, y, jit(0.08) * 1.12, 0.1);          // dejada: yemas de los dedos
        else if (shot === 'overhead') play('set', 0.62 * hg, x, y, jit(0.08) * 0.95, 0.14);
        else play('free', 0.65 * hg, x, y, jit(0.08), 0.18);
        break;
      default: // 'pass' y cualquier tipo futuro
        if (shot === 'shank') play('free', 0.7 * hg, x, y, jit(0.1) * 0.82, 0.2);     // sale de lado: golpe "feo" y apagado
        else play('pass', 0.75 * hg * (0.85 + 0.15 * q), x, y, jit(0.08) * (0.92 + 0.08 * q), 0.2);
        // defensa de un remate rival: "uuuh" de la grada
        if (k === 'pass' && lastSpikeTeam >= 0 && lastSpikeTeam !== e.team && isFinite(e.t) && e.t - lastSpikeT < 1.2 && !demo) {
          playGap('ooh', 1.5, e.dive ? 0.7 : 0.55, null, null, jit(0.06), 0, 0.05, 'crowd'); exciteBoost = Math.max(exciteBoost, 0.35);
        }
    }
    // toque perfecto del jugador humano: destello muy discreto (más presente en remate y saque)
    if (e.human && e.grade === 'perfect' && !demo) play('perfect', k === 'spike' || k === 'serve' ? 0.22 : 0.12, null, null, k === 'spike' ? 1.06 : 1, 0.1, 0, 'music');
    if (k !== 'spike') lastSpikeTeam = -1;
  }

  /** Reacción de la grada al punto. El público es local: anima al equipo humano (0). */
  function crowdReact(e, g) {
    var hits = e.rallyHits | 0, home = e.team === 0, big = hits >= 8 ? 1 : 0;
    var how = typeof e.how === 'string' ? e.how : '';
    var lk = e.lastKind || (g && g.lastKind);
    var kill = how ? (how === 'kill' || how === 'block') : (lk === 'spike' || lk === 'block');
    var ace = how ? how === 'ace' : (e.reason === 'in' && hits === 0 && !e.sideout);
    var error = how ? how === 'error' : (e.reason !== 'in' || (!!e.sideout && hits === 0));
    var homeError = !home && error;                                // fallo del equipo local (fuera, red, antena, dobles...)
    if (demo) { play('applause', 0.25, null, null, jit(0.1), 0, 0.3, 'crowd'); return; }
    if (e.matchWon) {
      if (home) { play('roar', 1.0, null, null, 1, 0, 0.1, 'crowd'); play('roar', 0.7, null, null, 0.94, 0, 0.9, 'crowd'); play('applause', 0.9, null, null, 1, 0, 1.4, 'crowd'); }
      else { play('groan', 0.7, null, null, 0.95, 0, 0.12, 'crowd'); play('applause', 0.45, null, null, 1, 0, 1.2, 'crowd'); }
      return;
    }
    if (home) {
      var a = 0.5 + big * 0.2 + (kill ? 0.15 : 0) + (ace ? 0.25 : 0) + (how === 'tip' ? 0.05 : 0) + (e.setWon ? 0.25 : 0);
      if (error) a -= 0.12; // error del rival: alegría, pero menos
      play('roar', clamp(a, 0.35, 1), null, null, jit(0.08), 0, 0.12, 'crowd');
      play('applause', 0.4 + big * 0.25 + (e.setWon ? 0.3 : 0), null, null, jit(0.08), 0, 0.7, 'crowd');
    } else {
      play('groan', homeError ? 0.7 : 0.42, null, null, jit(0.08) * (homeError ? 1 : 1.05), 0, 0.12, 'crowd');
      if (big || e.setWon) play('applause', 0.35 + big * 0.2, null, null, jit(0.08), 0, 0.9, 'crowd');
    }
  }

  /** Silbato + hueco en la grada: mientras suena, un ecualizador de campana en el bus de la grada baja ~9 dB la
   *  banda del silbato (2,6-4,2 kHz). El punto lo pita el árbitro justo cuando la grada estalla; sin el hueco, en
   *  el render de un partido el silbato quedaba solo 6 dB por encima de la ovación en su banda (audiotest). */
  function whistle(name, gain, delay, rate) {
    if (live() && !(bank[name] && bank[name].length)) { // aún sin buffer: se aplaza con su hueco en la grada incluido
      if (!deferPlay(name, gain, null, null, rate || 1, 0.45, delay, null, true)) stats.skipped++;
      return;
    }
    var src = play(name, gain, null, null, jit(0.02) * (rate || 1), 0.45, delay);
    if (!src || !N.crowdEq) return;
    try {
      var p = N.crowdEq.gain, t0 = AC.currentTime + (delay || 0), dur = src.buffer.duration / (src.playbackRate.value || 1) - 0.1;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t0); else p.cancelScheduledValues(t0);
      p.setTargetAtTime(-9, t0, 0.015);
      p.setTargetAtTime(0, t0 + Math.max(0.15, dur), 0.12);
    } catch (e) { }
  }
  function handleOne(e, g, longWhistle) {
    switch (e.type) {
      case 'hit': onHit(e); break;
      case 'block': { // result: 'stuff' (directo) | 'soft' (toque de bloqueo) | 'tool' (block-out)
        var res = e.result || 'stuff', stuff = res === 'stuff';
        play('block', stuff ? 1.0 : res === 'tool' ? 0.8 : 0.6, evx(e), evy(e), jit(0.06) * (stuff ? 0.95 : 1.08), stuff ? 0.36 : 0.25);
        play('net', stuff ? 0.3 : 0.18, 0, e.y, jit(0.1), 0.05, 0.01);
        if (!demo) {
          if (stuff && e.team === 0) play('roar', 0.6, null, null, jit(0.06), 0, 0.08, 'crowd');
          else if (stuff || res === 'tool') playGap('ooh', 1, 0.5, null, null, jit(0.06), 0, 0.05, 'crowd');
          exciteBoost = Math.max(exciteBoost, stuff ? 0.4 : 0.2);
        }
        break;
      }
      case 'toss': // lanzamiento del saque: el balón sale de la mano; en salto, carrera de batida
        play('whoosh', e.jump ? 0.3 : 0.22, evx(e), evy(e), jit(0.08) * 1.35, 0.05);
        if (e.jump) for (var st2 = 0; st2 < 3; st2++) play('feet', 0.2 + st2 * 0.06, evx(e), evy(e), jit(0.1) * 1.2, 0.05, 0.42 + st2 * 0.24);
        if (!demo) tossHush = 1.2;
        clapBeat = 99; // la grada deja de dar palmas en cuanto el sacador lanza
        break;
      case 'dive':
        play('slide', 0.75, evx(e), evy(e), jit(0.1), 0.15, 0.06);
        if (Math.random() < 0.6) playGap('squeak', 0.1, 0.3, evx(e), evy(e), jit(0.15), 0.1, 0.12);
        break;
      case 'netTouch': play('net', 0.8, evx(e), evy(e), jit(0.1) * 0.9, 0.15); break;
      case 'miss': if (!demo) playGap('whoosh', 0.2, 0.3, evx(e), evy(e), jit(0.1) * 0.85, 0); break;
      case 'net': play(e.tape ? 'netTape' : 'net', e.tape ? 0.85 : 0.7, 0, e.y, jit(0.1), 0.15); break;
      case 'land': {
        var s = isFinite(e.speed) ? e.speed : 4, slam = (g && g.lastKind === 'spike') || s > 13;
        play(slam ? 'slam' : 'land', clamp(0.45 + s * 0.06, 0.5, 1.05), e.x, e.y, jit(0.06) * (slam ? 0.95 : 1), slam ? 0.45 : 0.3);
        // por los pelos: balón fuera a menos de 30 cm de la línea
        var cl = VB.C || { HL: 9, HW: 4.5 }, mx = Math.max(Math.abs(+e.x || 0) - cl.HL, Math.abs(+e.y || 0) - cl.HW);
        if (!demo && e.inside === false && mx < 0.3) playGap('ooh', 1, 0.5, null, null, jit(0.06), 0, 0, 'crowd');
        break;
      }
      case 'bounce': {
        var b = isFinite(e.speed) ? e.speed : 2;
        playGap('bounce', 0.05, clamp(b * 0.09, 0.08, 0.5), e.x, e.y, jit(0.1) * (1 + Math.max(0, 4 - b) * 0.04), 0.15); break;
      }
      case 'whistle': // el silbato llena el pabellón: mucho envío a la reverb
        if (e.reason === 'point') whistle(longWhistle ? 'whistleEnd' : 'whistleLong', demo ? 0.35 : 0.55, 0);
        else whistle('whistle', demo ? 0.3 : 0.5, 0);
        break;
      case 'point': crowdReact(e, g); break;
      case 'courtChange': // cambio de campo (18.2.1 / 18.2.2): silbato corto tras el del punto
        if (!demo) whistle('whistle', 0.32, e.why === 'eight' ? 1.0 : 2.7, 1.03);
        break;
      case 'serveReady':
        serveWait = 0; serveTeam = e.team; clapBeat = 0; clapNext = 0;
        mpServe = !demo && e.matchPoint >= 0; beatNext = now() + 0.6;
        break;
      case 'swing': playGap('whoosh', 0.15, 0.4, evx(e), evy(e), jit(0.15), 0); break;
      case 'jump': playGap('scuff', 0.08, demo ? 0.15 : 0.32, evx(e), evy(e), jit(0.15), 0.05); break;
      case 'landPlayer': {
        var la = e.player && (e.player.lastAction === 'spike' || e.player.lastAction === 'block') ? 0.55 : 0.35;
        playGap('feet', 0.06, demo ? la * 0.4 : la, evx(e), evy(e), jit(0.12), 0.1);
        if (Math.random() < 0.35) playGap('squeak', 0.12, 0.18, evx(e), evy(e), jit(0.1), 0.1, 0.03);
        break;
      }
      case 'set':
        if (!demo) {
          var win = e.team === 0;
          // el set que cierra el partido lo celebra la ráfaga del partido (evento 'match')
          if (!(e.sets && Math.max(e.sets[0] | 0, e.sets[1] | 0) >= 2)) play(win ? 'setWin' : 'setLose', win ? 0.9 : 0.7, null, null, 1, 0.12, 0.8, 'music');
        }
        break;
      case 'match':
        if (!demo && !stingDone) { stingDone = true; play(e.team === 0 ? 'matchWin' : 'matchLose', e.team === 0 ? 1 : 0.75, null, null, 1, 0.12, 0.85, 'music'); }
        break;
      case 'gameOver':
        if (!demo && !stingDone) { stingDone = true; play(e.team === 0 ? 'matchWin' : 'matchLose', e.team === 0 ? 1 : 0.75, null, null, 1, 0.12, 0, 'music'); }
        break;
      case 'newSet': if (!demo) play('applause', 0.45, null, null, 1, 0, 0.1, 'crowd'); break;
      case 'newMatch':
        stingDone = false;
        if (!e.demo && !demo) { play('roar', 0.55, null, null, 1, 0, 0.15, 'crowd'); play('applause', 0.6, null, null, 1, 0, 0.5, 'crowd'); }
        break;
      case 'switch': if (e.auto === false && !demo) play('hover', 0.3, null, null, 1.2, 0); break;
      // 'sideout': ya lo cuentan el silbato y la grada; sin sonido propio
    }
  }

  /* ------------------------------------------------------------------
   * 5. API pública
   * ------------------------------------------------------------------ */
  VB.Audio = {
    /** Sonidos del catálogo (tests y audición). */
    SOUNDS: Object.keys(CATALOG),
    /** Variantes que se generan de cada sonido (tests). */
    VARIANTS: (function () { var o = {}; for (var k in CATALOG) o[k] = CATALOG[k].variants; return o; })(),
    /** Sonidos que suenan en bucle (sin rampa en los extremos: el corte es continuo). */
    LOOPS: ['murmur', 'excite'],
    /** Plan de mezcla: nivel (dB) aplicado a cada sonido del catálogo (ver LEVEL). Solo lectura. */
    LEVELS: LEVEL,
    /** synth(name, variant, ctxSampleRate) -> [Float32Array...]: genera sin WebAudio. */
    synth: synth,
    /** Generador troceado de un sonido (tests: mide el coste de cada paso). it.next() hasta done; value = canales. */
    synthSteps: function (name, variant, ctxRate) { var c = CATALOG[name]; return c ? c.gen(makeRng(seedOf(name, variant)), rateOf(c.rate, ctxRate)) : null; },
    /** Frecuencia de muestreo con la que se genera un sonido. */
    synthRate: function (name, ctxRate) { var c = CATALOG[name]; return c ? rateOf(c.rate, ctxRate) : 0; },
    stats: stats,
    /** 0..1: parte del banco ya generada (0 antes del primer gesto). */
    ready: function () { return total ? built / total : 0; },
    /** Estado del contexto: 'none' | 'suspended' | 'running' | 'interrupted' | 'closed'. */
    contextState: function () { return AC ? AC.state : 'none'; },

    init: function (c) {
      vctx = c || VB.ctx || null;
      if (hasDoc && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
          hidden = !!document.hidden;
          if (hidden) suspendIfIdle(); else resumeIfWanted();
        });
      }
      if (vctx && vctx.settings) VB.Audio.onSettings(vctx.settings);
      // Pre-síntesis del banco en los huecos del menú, antes de cualquier gesto (no crea AudioContext
      // ni suena nada). Se espera ~1,2 s para no competir con el arranque (shaders, texturas).
      if (hasDoc && (root.requestIdleCallback || root.setTimeout)) startGen(1200);
    },
    /** Primer gesto del usuario (y al empezar partido). Barato si ya está desbloqueado. */
    unlock: function () {
      var fresh = !AC;
      if (!ensure()) return;
      if (hasDoc && document.hidden === false) hidden = false;
      resumeIfWanted();
      if (fresh) { // iOS: un buffer silencioso dentro del gesto "abre" la salida
        try { var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) { }
      }
      if (muted) suspendIfIdle();
    },
    setMuted: function (m) {
      muted = !!m;
      if (!AC) return;
      applyVolumes(false);
      if (muted) { var st = root.setTimeout; if (st) st(function () { if (muted) suspendIfIdle(); }, 200); }
      else resumeIfWanted();
    },
    isMuted: function () { return muted; },
    /** Volumen por canal: kind = 'master'|'sfx'|'music'|'crowd', v en 0..1. */
    setVolume: function (kind, v) {
      if (!Object.prototype.hasOwnProperty.call(vol, kind)) return;
      vol[kind] = clamp(+v || 0, 0, 1);
      applied.crowd = -1; // la grada se recalcula en update()
      applyVolumes(false);
    },
    getVolume: function (kind) { return vol[kind]; },
    /** Sonidos de interfaz (por el bus de música: no les afecta la pausa ni la cámara lenta). */
    click: function () { play('click', 0.6, null, null, jit(0.04), 0, 0, 'music'); },
    hover: function () { playGap('hover', 0.04, 0.35, null, null, jit(0.06), 0, 0, 'music'); },
    /** ui('click'|'hover'|'back'|'start') */
    ui: function (kind) {
      if (kind === 'hover') return VB.Audio.hover();
      play(CATALOG[kind] && (kind === 'click' || kind === 'back' || kind === 'start') ? kind : 'click', 0.6, null, null, 1, 0, 0, 'music');
    },
    /** Reproduce cualquier sonido del catálogo (para otros módulos). x,y opcionales en coords de sim. */
    play: function (name, gain, x, y) {
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOG, name) || name === 'ir') return false;
      var bus = SCORES[name] ? 'music' : CATALOG[name].rate === 'low' ? 'crowd' : 'sfx';
      return !!play(name, gain == null || !isFinite(gain) ? 0.7 : gain, x == null || bus !== 'sfx' ? null : x, y, jit(0.06), bus === 'sfx' ? 0.15 : 0, 0, bus);
    },
    /** Ráfaga musical: 'setWin'|'setLose'|'matchWin'|'matchLose'. */
    sting: function (name) { return !!(SCORES[name] && play(name, 0.9, null, null, 1, 0.12, 0, 'music')); },

    onGameStart: function (g) {
      demo = !!(g && g.demo); stingDone = false; excite = 0; exciteBoost = 0; lastSpikeTeam = -1;
      serveTeam = -1; mpServe = false; clapNext = 0;
      for (var i = 0; i < 8; i++) { pvx[i] = pvy[i] = 0; scd[i] = 0.5; }
      applyVolumes(false);
    },
    onState: function (s) {
      state = s;
      if (vctx && vctx.game) demo = !!vctx.game.demo;
      applyVolumes(false);
    },
    /** Lee settings.sfxVol / musicVol / crowdVol / volume (0..1) si existen, y muted. */
    onSettings: function (st, k) {
      if (!st) return;
      if (typeof st.sfxVol === 'number') VB.Audio.setVolume('sfx', st.sfxVol);
      if (typeof st.musicVol === 'number') VB.Audio.setVolume('music', st.musicVol);
      if (typeof st.crowdVol === 'number') VB.Audio.setVolume('crowd', st.crowdVol);
      else if (typeof st.sfxVol === 'number') VB.Audio.setVolume('crowd', 0.85 * st.sfxVol); // sin ajuste propio: la grada sigue a "efectos"
      if (typeof st.volume === 'number') VB.Audio.setVolume('master', 0.9 * st.volume);
      if ((k === 'muted' || k === undefined) && typeof st.muted === 'boolean' && st.muted !== muted) VB.Audio.setMuted(st.muted);
    },
    /** Calidad baja: sin reverb y menos voces. */
    setQuality: function (q) {
      var want = !q || q.rank === undefined || q.rank >= 1;
      MAX_VOICES = want ? 32 : 20;
      if (want === reverbOn) return;
      reverbOn = want;
      if (N.revIn && N.revBus) { try { if (want) N.revIn.connect(N.revBus); else N.revIn.disconnect(); } catch (e) { } }
    },

    /** Eventos del frame -> sonidos. Seguro con cualquier evento (y sin AudioContext). */
    handle: function (events, g) {
      if (!events || !events.length) return;
      var longWh = false, i, e;
      for (i = 0; i < events.length; i++) { e = events[i]; if (e && e.type === 'point' && (e.setWon || e.matchWon)) longWh = true; }
      for (i = 0; i < events.length; i++) {
        e = events[i]; if (!e || typeof e.type !== 'string') continue;
        try { handleOne(e, g, longWh); } catch (err) { }
      }
    },

    /** Estado continuo: grada, pausa/cámara lenta, chirridos, palmas, latido. Sin asignaciones. */
    update: function (g, dt) {
      if (!AC || !N.master) return;
      dt = clamp(+dt || 0, 0, 0.1);
      var t = AC.currentTime, st = (vctx && vctx.state) || state, paused = st === 'paused';
      // --- pausa y cámara lenta: filtro general y tono
      var ts = vctx && isFinite(vctx.timeScale) ? vctx.timeScale : 1;
      slowRate = ts < 0.95 ? clamp(Math.sqrt(Math.max(0.05, ts)), 0.6, 1) : 1;
      setParam(N.fx.frequency, 'fx', paused ? 650 : ts < 0.95 ? 700 + 4000 * ts : 20000, paused ? 0.06 : 0.12);
      setParam(N.sfx.gain, 'sfx', vol.sfx * (demo ? 0.35 : 1) * (paused ? 0.5 : 1), 0.08);
      // --- grada: emoción objetivo según el momento del partido
      var tgt = 0.08;
      if (g && !demo) {
        if (g.mode === 'rally' && g.rally) tgt = 0.22 + Math.min(0.5, (g.rally.hits | 0) * 0.045 + (+g.rally.t || 0) * 0.02);
        else if (g.mode === 'serve') tgt = g.serving === 1 ? 0.12 : 0.2;
        else if (g.mode === 'point') tgt = 0.3;
        else if (g.mode === 'over') tgt = 0.45;
        if (g.matchPoint >= 0 || g.setPoint >= 0) tgt += 0.12;
      }
      exciteBoost = Math.max(0, exciteBoost - dt * 0.35);
      tossHush = Math.max(0, tossHush - dt);
      tgt = Math.min(1, tgt + exciteBoost);
      excite += (tgt - excite) * Math.min(1, dt * (tgt > excite ? 3 : 0.8));
      setParam(N.crowd.gain, 'crowd', vol.crowd * (paused ? 0.45 : 1) * (st === 'menu' ? 0.6 : 1), 0.15);
      setParam(N.murG.gain, 'mur', Math.round((0.32 + 0.1 * (1 - excite)) * (tossHush > 0 ? 0.6 : 1) * LEVEL_LIN.murmur * 400) / 400, tossHush > 0 ? 0.25 : 0.2);
      setParam(N.excG.gain, 'exc', Math.round(Math.max(0, excite - 0.12) * 0.75 * LEVEL_LIN.excite * 400) / 400, 0.15);
      setParam(N.crowdTone.frequency, 'bright', Math.round(1500 + excite * 5000), 0.2);
      // lechos de grada también a cámara lenta
      var br = Math.round(slowRate * 50) / 50;
      if (br !== applied.rate) {
        applied.rate = br;
        if (N.murmurSrc) try { N.murmurSrc.playbackRate.setTargetAtTime(br, t, 0.1); } catch (e) { }
        if (N.exciteSrc) try { N.exciteSrc.playbackRate.setTargetAtTime(br, t, 0.1); } catch (e) { }
      }
      if (!g || paused || !live() || (st !== 'playing' && st !== 'menu')) return;
      // --- chirridos de zapatilla en giros y frenadas bruscas
      squeakGap -= dt;
      var pl = g.players || [], k = Math.min(1, dt / 0.1);
      for (var i = 0; i < pl.length && i < 8; i++) {
        var p = pl[i]; if (!p) continue;
        scd[i] -= dt;
        var vx = +p.vx || 0, vy = +p.vy || 0, ps = Math.sqrt(pvx[i] * pvx[i] + pvy[i] * pvy[i]);
        if ((+p.z || 0) <= 0.02 && scd[i] <= 0 && squeakGap <= 0 && ps > 3.0 && (g.mode === 'rally' || g.mode === 'point')) {
          var s = Math.sqrt(vx * vx + vy * vy), dot = (vx * pvx[i] + vy * pvy[i]) / (ps * Math.max(s, 0.001));
          if ((s > 1.5 && dot < 0.25) || ps - s > 3.2) {
            var hum = !g.demo && p === g.ctrl;
            playGap('squeak', 0.1, (demo ? 0.12 : hum ? 0.38 : 0.26) * (0.7 + Math.random() * 0.3), p.x, p.y, jit(0.15), 0.12);
            scd[i] = 0.55 + Math.random() * 0.4; squeakGap = 0.12;
          }
        }
        // velocidad de referencia suavizada (~0.1 s): detecta giros aunque la sim los reparta en varios pasos
        pvx[i] += (vx - pvx[i]) * k; pvy[i] += (vy - pvy[i]) * k;
      }
      // --- espera del saque local: palmas al unísono con bombo · punto de partido: latido
      if (g.mode === 'serve' && !demo && st === 'playing') {
        serveWait += dt;
        if (serveTeam === 0 && serveWait > 0.9 && bank.palmas) {
          if (!clapNext || clapNext < t) clapNext = t + 0.05;
          while (clapNext < t + 0.12 && clapBeat < 24) {
            var beat = clapBeat % 4, d = clapNext - t, ramp = Math.min(1, 0.4 + clapBeat * 0.08);
            if (beat !== 3) play('palmas', 0.55 * ramp, null, null, jit(0.04), 0, d, 'crowd');
            if (beat === 0 || (beat === 2 && (clapBeat >> 2) % 2 === 1)) play('bombo', 0.42 * ramp, null, null, jit(0.02), 0.25, d, 'crowd');
            clapNext += 0.42; clapBeat++;
          }
        }
        if (mpServe && bank.beat && beatNext && beatNext < t + 0.1) {
          var dd = Math.max(0, beatNext - t);
          play('beat', 0.6, null, null, 1, 0, dd); play('beat', 0.4, null, null, 1.15, 0, dd + 0.22);
          beatNext += 0.9;
        }
      } else clapNext = 0;
    }
  };
})();
