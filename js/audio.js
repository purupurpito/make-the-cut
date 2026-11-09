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
 *   sfx ─────────────────────────────────────────────────────┐
 *   crowd ─> agachada ─> paso alto ─> brillo ─> hueco silbato ┼─> fxFilter (pausa/cámara lenta) ─> master ─> compresor ─> compensación ─┬─> recorte suave ─> destino
 *   reverb (envíos) ─────────────────────────────────────────┘                                    ^                                    │
 *   music (ráfagas + interfaz + "toc" del reloj) ─────────────────────────────────────────────────┘                                    │
 *   punch (golpe perfecto: chasquido "héroe" + sub, con techo de pico) ─> retraso 6 ms ──────────────────────────────────────────────────┘
 *   pool: 8 tiras fijas ganancia → paneo → sfx (+ envío de reverb) para los contactos de celebración y los botes del ritual de saque
 *         (AUD-05: solo se crea la BufferSource; ganancia/paneo/envío programados en la tira en el instante de arranque)
 *
 * Pulido ola 2: contactos de celebración (fx:highfive/fistbump/chestbump/clap) y botes del ritual de saque (dribble), un sonido
 * por evento; presentación (sting('intro'): firma + crescendo de grada + lecho agachado) y cortinilla (ui('wipe')); reacción de
 * la grada al punto escalada de forma continua con point.highlight (+ "uuuh" con defensas, cántico de racha, alivio).
 * Pulido ola 3 (AUD-08): hoja final (tics de la cuenta que se frenan con las cifras, «clac» en el último frame, revelación del
 * MVP, la grada cede 6 dB a la hoja) y sonidos propios de las flechas de dificultad y de las filas de Ajustes (ui(...)).
 *
 * Banco sintetizado en un Worker creado desde este mismo fichero (Blob; sin Worker, cola troceada en el hilo principal).
 * Mezcla medida, no a oído: tools/audiotest.js (niveles LUFS por categoría, picos reales, render de un
 * partido en Chrome con OfflineAudioContext). Plan de niveles: LEVEL más abajo.
 * Mapa evento -> sonido: ver notes/audio.md.
 * ===================================================================== */
(function VBAudioModule() { // con nombre: su propio código fuente arranca el hilo de síntesis (Worker, ver §3)
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
    // Remate PERFECTO del humano: el mismo chasquido con más cuerpo y palmada más larga (la energía se reparte en el tiempo:
    // ~3,3 dB más sonoro que el normal al mismo pico real) y un pelo más brillante. Va por el bus de refuerzo (ver sweeten)
    spikeHero: { dur: 0.42, f0: 320, f1: 115, pt: 0.009, ba: 1.0, bd: 0.1, ha: 0.6, ct: 'hp', cf: 1300, ca: 1.5, cd: 0.004, sf: 2900, sq: 0.7, sa: 1.2, sd: 0.04, s2: 0.0015, sa2: 0.6, rf: 1050, ra: 0.4, rd: 0.09, wa: 0.22, wf0: 2300, wf1: 600, wt: 0.025, wd: 0.34, drive: 2.8, lpf: 12500, peak: 0.98 },
    // Bloqueo: golpe sordo "ahogado", dos manos casi a la vez
    block: { dur: 0.3, f0: 220, f1: 95, pt: 0.018, ba: 0.85, bd: 0.065, ha: 0.5, ct: 'lp', cf: 2200, ca: 0.7, cd: 0.006,
             sf: 1100, sq: 0.8, sa: 1.0, sd: 0.03, s2: 0.011, sa2: 0.8, rf: 560, ra: 0.3, rd: 0.05, drive: 1.8, peak: 0.95 },
    // Bloqueo directo del humano: más cuerpo y palmada más larga (~2,6 dB más sonoro al mismo pico real). Bus de refuerzo
    blockHero: { dur: 0.34, f0: 220, f1: 90, pt: 0.018, ba: 0.95, bd: 0.085, ha: 0.55, ct: 'lp', cf: 2400, ca: 0.75, cd: 0.006, sf: 1100, sq: 0.8, sa: 1.1, sd: 0.04, s2: 0.011, sa2: 0.85, rf: 560, ra: 0.35, rd: 0.07, drive: 2.4, lpf: 11000, peak: 0.95 },
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
    // Latido (punto de partido / de set): "lub" grave y apagado
    beat: { dur: 0.25, f0: 70, f1: 40, pt: 0.03, ba: 1, bd: 0.07, ha: 0.45, ct: 'lp', cf: 700, ca: 0.5, cd: 0.012, peak: 0.9 },
    // Capa de "tarima" del remate que revienta contra el suelo: golpe de cuerpo grave + knock de la madera
    slamSub: { dur: 0.22, f0: 96, f1: 48, pt: 0.02, ba: 1, bd: 0.06, ha: 0.45, ct: 'lp', cf: 2800, ca: 0.35, cd: 0.006,
               sf: 420, sq: 0.8, sa: 0.5, sd: 0.02, rf: 190, ra: 0.3, rd: 0.05, drive: 1.5, lpf: 8000, peak: 0.9 },
    // Bote del ritual de saque (SIM-04, AUD-05): el sacador empuja el balón contra el parqué, ~5 m/s. Más controlado que un bote
    // de peloteo ('land': golpe grave grande) y más vivo que uno muerto ('bounce'): poco cuerpo, el "ping" de la cámara del balón
    // bien inflado algo más largo (rf/rd) y el knock seco de la tarima. Es lo único que suena en el silencio antes del saque.
    dribble: { dur: 0.24, f0: 205, f1: 118, pt: 0.011, ba: 0.62, bd: 0.034, ha: 0.5, ct: 'lp', cf: 3800, ca: 0.62, cd: 0.0035,
               sf: 1500, sq: 0.9, sa: 0.72, sd: 0.016, rf: 455, ra: 0.42, rd: 0.05, drive: 1.25, lpf: 14000, peak: 0.85 }
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

  /** Refuerzo del golpe perfecto (remate / bloqueo directo / saque en salto del humano): "thump" sub que cae de 62 a 45 Hz,
   *  ~120 ms audibles. Ataque de 7 ms en coseno (sin pico encima del chasquido, que ya va saturado), cuerpo largo para que
   *  la energía esté en el tiempo y no en el pico, y armónicos 2.º y 3.º (90-190 Hz) que se apagan antes: le dan peso en un
   *  altavoz pequeño, donde 50 Hz no existe. Fase en 0 al empezar: sin escalón. */
  function* genSub(rng, sr) {
    var dur = 0.17, n = Math.ceil(dur * sr), d = new Float32Array(n), na = (0.007 * sr) | 0;
    var kP = Math.exp(-1 / (0.035 * sr)), kE = Math.exp(-1 / (0.055 * sr)), k2 = Math.exp(-1 / (0.04 * sr)), k3 = Math.exp(-1 / (0.025 * sr));
    var Z = new Float64Array(5); Z[1] = 1; Z[2] = 1; Z[3] = 1; Z[4] = 1; // estado: 0 ph · 1 eP · 2 eE · 3 e2 · 4 e3
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, ph = Z[0], eP = Z[1], eE = Z[2], e2 = Z[3], e3 = Z[4];
      for (var i = i0; i < i1; i++) {
        ph += TAU * (45 + 17 * eP) / sr; eP *= kP;
        var a = i < na ? 0.5 - 0.5 * Math.cos(Math.PI * i / na) : 1;
        d[i] = (Math.sin(ph) + 0.42 * Math.sin(2 * ph) * e2 + 0.16 * Math.sin(3 * ph) * e3) * eE * a;
        eE *= kE; e2 *= k2; e3 *= k3;
      }
      Z[0] = ph; Z[1] = eP; Z[2] = eE; Z[3] = e2; Z[4] = e3; yield 0;
    }
    return edges(normalize([dcBlock(d, sr)], 0.9), sr, 0.0005, 0.03);
  }
  /** Reloj de saque (últimos 3 s del sacador humano): "toc" de madera corto y seco. Dos parciales inarmónicos
   *  (bloque de madera) + un chasquido de ruido de 1,5 ms; ~40 ms. Sin cola: no ensucia el silbato que llega después. */
  function* genTick(rng, sr) {
    var dur = 0.045, n = Math.ceil(dur * sr), d = new Float32Array(n), bp = new Biq('bp', 3800, 1.2, sr), rs = rng.st;
    var w1 = TAU * 1480 / sr, w2 = TAU * 2310 / sr, w3 = TAU * 740 / sr, k1 = Math.exp(-1 / (0.0085 * sr)), k2 = Math.exp(-1 / (0.0045 * sr)), kn = Math.exp(-1 / (0.0012 * sr));
    var Z = new Float64Array(3); Z[0] = 1; Z[1] = 1; Z[2] = 1; // estado entre tramos: 0 e1 · 1 e2 · 2 en
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, e1 = Z[0], e2 = Z[1], en = Z[2];
      for (var i = i0; i < i1; i++) {
        var nz = rnd(rs) * 2 - 1;
        d[i] = Math.sin(w1 * i) * 0.62 * e1 + Math.sin(w2 * i) * 0.34 * e2 + Math.sin(w3 * i) * 0.22 * e1 + bp.p(nz) * 0.55 * en;
        e1 *= k1; e2 *= k2; en *= kn;
      }
      Z[0] = e1; Z[1] = e2; Z[2] = en; yield 0;
    }
    return edges(normalize([d], 0.8), sr, 0.0004, 0.006);
  }

  /** Celebración (contactos cosméticos de players, PLY-07 -> eventos 'fx:*' de main.js): choque de manos 'slap' (dos palmas
   *  planas que se encuentran: chasquido seco a 1-3 kHz con un cuerpo hueco de ~190 Hz) y choque de puños 'fist' (sordo: ruido
   *  filtrado por debajo de 1 kHz y golpe de 120 Hz, sin brillo). Cortos (< 70 ms) y secos: la reverb del pabellón pone el aire. */
  function* genSlap(kind, rng, sr) {
    var fist = kind === 'fist', dur = fist ? 0.07 : 0.06, n = Math.ceil(dur * sr), d = new Float32Array(n), rs = rng.st;
    var f1 = new Biq(fist ? 'lp' : 'bp', fist ? 1100 : 1500 + rng() * 700, fist ? 0.8 : 0.9, sr), f2 = new Biq('bp', fist ? 560 : 2900 + rng() * 600, 1.4, sr);
    var hp = new Biq('hp', fist ? 100 : 90, 0.7, sr), wb = TAU * (fist ? 118 : 185 + rng() * 25) / sr, kb = Math.exp(-1 / ((fist ? 0.016 : 0.011) * sr));
    var k1 = Math.exp(-1 / ((fist ? 0.007 : 0.0042) * sr)), off = Math.round((0.0011 + rng() * 0.0012) * sr); // segunda palma: 1-2 ms después
    // puños: el segundo contacto (nudillos) entra en 0,5 ms; en banda media un escalón seco sonaba a clic (audiotest)
    var na = fist ? Math.max(1, Math.round(0.0005 * sr)) : 0;
    var Z = new Float64Array(3); Z[0] = 1; Z[1] = 1; Z[2] = 1; // estado entre tramos: 0 e1 · 1 e2 · 2 eb
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, e1 = Z[0], e2 = Z[1], eb = Z[2];
      for (var i = i0; i < i1; i++) {
        var nz = rnd(rs) * 2 - 1;
        if (i === off) e2 = 0.8;
        if (i < off) e2 = 0;
        var a2 = na && i < off + na ? Math.max(0, (i - off) / na) : 1;
        d[i] = hp.p(f1.p(nz) * e1 * (fist ? 1.1 : 1) + f2.p(nz) * e2 * a2 * (fist ? 0.9 : 0.7) + Math.sin(wb * i) * eb * (fist ? 0.5 : 0.45)); // paso alto: sin DC
        e1 *= k1; e2 *= k1; eb *= kb;
      }
      Z[0] = e1; Z[1] = e2; Z[2] = eb; yield 0;
    }
    return edges(normalize([d], 0.8), sr, 0.0003, 0.012);
  }
  /** Palmada de ánimo de UNA persona (el equipo que pierde el punto se anima, AUD-05): manos ahuecadas, no palma contra palma.
   *  La cavidad entre las manos da una resonancia de ~1 kHz con Q alto y muy corta (8-11 ms); encima, 2-3 micro-impactos en
   *  menos de 1 ms (los dedos llegan antes que la base de la mano) y un chasquido de aire de 1,5 ms. Más pequeña, más hueca y
   *  más corta que el choque de manos ('slap', dos personas). Sin grave: no hay cuerpo que suene. */
  function* genHandclap(rng, sr) {
    var dur = 0.065, n = Math.ceil(dur * sr), d = new Float32Array(n), rs = rng.st;
    var fc = 950 + rng() * 450, cav = new Biq('bp', fc, 2.6 + rng() * 1.2, sr), cav2 = new Biq('bp', fc * 2.15, 3, sr), air = new Biq('hp', 2500, 0.7, sr);
    var kc = Math.exp(-1 / ((0.0075 + rng() * 0.0035) * sr)), ka = Math.exp(-1 / (0.0016 * sr));
    var o1 = Math.round((0.00035 + rng() * 0.0003) * sr), o2 = Math.round((0.0007 + rng() * 0.0005) * sr);
    var Z = new Float64Array(2); Z[0] = 0.55; Z[1] = 1; // estado entre tramos: 0 envolvente de la cavidad · 1 envolvente del aire
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, ec = Z[0], ea = Z[1];
      for (var i = i0; i < i1; i++) {
        var nz = rnd(rs) * 2 - 1;
        if (i === o1) ec += 0.5; else if (i === o2) ec += 0.65; // micro-impactos: dedos, palma, base
        d[i] = cav.p(nz) * ec + cav2.p(nz) * ec * 0.35 + air.p(nz) * ea * 0.55;
        ec *= kc; ea *= ka;
      }
      Z[0] = ec; Z[1] = ea; yield 0;
    }
    return edges(normalize([dcBlock(d, sr)], 0.8), sr, 0.0002, 0.01);
  }
  /** Choque de pecho (celebración de partido, PLY-15): dos torsos que chocan. Golpe grave del tórax (95→62 Hz, ~45 ms) con
   *  el "plaf" sordo de la ropa contra la ropa (ruido < 700 Hz), un roce de camiseta más largo y brillante (2-4 kHz, 90 ms)
   *  y las dos manos que se agarran de los hombros 25-40 ms después (palmada blanda). DC fuera; cola corta (la reverb pone el aire). */
  function* genChest(rng, sr) {
    var dur = 0.22, n = Math.ceil(dur * sr), d = new Float32Array(n), rs = rng.st;
    var lp = new Biq('lp', 1000, 0.8, sr), lo = new Biq('bp', 260, 1.1, sr), rub = new Biq('bp', 2600 + rng() * 900, 0.9, sr), pat = new Biq('bp', 1300 + rng() * 300, 1.2, sr);
    var kP = Math.exp(-1 / (0.03 * sr)), kB = Math.exp(-1 / (0.045 * sr)), kN = Math.exp(-1 / (0.02 * sr)), kH = Math.exp(-1 / (0.006 * sr));
    var hAt = Math.round((0.025 + rng() * 0.015) * sr), f0 = 92 + rng() * 10;
    // estado entre tramos: 0 ph · 1 ePitch · 2 eBody · 3 eNoise · 4 eHands
    var Z = new Float64Array(5); Z[1] = 1; Z[2] = 1; Z[3] = 1;
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, ph = Z[0], eP = Z[1], eB = Z[2], eN = Z[3], eH = Z[4];
      for (var i = i0; i < i1; i++) {
        var nz = rnd(rs) * 2 - 1, u = i / n;
        ph += TAU * (62 + (f0 - 62) * eP) / sr; eP *= kP;
        var at = i < 0.002 * sr ? i / (0.002 * sr) : 1;
        if (i === hAt) eH = 0.55;
        var rubE = Math.sin(Math.PI * Math.min(1, u * 2.4)) * (1 - u);
        d[i] = (Math.sin(ph) + 0.75 * Math.sin(2 * ph) * eB + 0.4 * Math.sin(3 * ph) * eB * eB) * eB * at + lp.p(nz) * eN * 0.9 + lo.p(nz) * eN * 2.4 + rub.p(nz) * rubE * 0.16 + pat.p(nz) * eH * 0.7;
        eB *= kB; eN *= kN; eH *= kH;
      }
      Z[0] = ph; Z[1] = eP; Z[2] = eB; Z[3] = eN; Z[4] = eH; yield 0;
    }
    return edges(normalize([dcBlock(d, sr)], 0.85), sr, 0.0004, 0.03);
  }
  /** Cortinilla de transición (UI-13, AUD-06): soplido de aire filtrado que cruza de izquierda a derecha, como la cortinilla
   *  en pantalla. Pico a ~0,15 s (el corte de cámara queda en el centro de la cortinilla de 0,3 s), ruido por un paso banda
   *  resonante que sube de 450 Hz a 2,8 kHz y baja a 1,1 kHz, un segundo formante una octava arriba para el "brillo", y un
   *  golpe de aire grave muy suave (110 Hz, 60 ms) justo en el corte que tapa el salto de imagen. Estéreo: el paneo va en el
   *  propio buffer (potencia constante). Seco y discreto: suena en casi cada punto, no puede cansar. */
  function* genWipe(rng, sr) {
    var dur = 0.42, n = Math.ceil(dur * sr), L = new Float32Array(n), R = new Float32Array(n), rs = rng.st;
    var bp = new Biq('bp', 600, 1.6, sr), bp2 = new Biq('bp', 1200, 2.2, sr), dir = 1; // siempre de izquierda a derecha (como la cortinilla)
    var pk = 0.15 + rng() * 0.012, cutAt = (pk * sr) | 0, wb = TAU * 110 / sr, kb = Math.exp(-1 / (0.022 * sr)), fa = 0.85 + rng() * 0.3;
    var Z = new Float64Array(2); // estado entre tramos: 0 fase del golpe grave · 1 envolvente del golpe
    for (var i0 = 0; i0 < n; i0 += CH) {
      var i1 = i0 + CH < n ? i0 + CH : n, ph = Z[0], eb = Z[1];
      for (var i = i0; i < i1; i++) {
        var t = i / sr, u = t / dur;
        if ((i & 31) === 0) {
          var f = t < pk ? 450 + 2350 * Math.pow(t / pk, 1.6) * fa : 1100 + (2800 * fa - 1100) * Math.exp(-(t - pk) / 0.06);
          bp.set('bp', f, 1.6, sr); bp2.set('bp', f * 2.05, 2.2, sr);
        }
        // envolvente: sube en coseno hasta el pico y cae exponencial (aire que pasa y se va)
        var env = t < pk ? 0.5 - 0.5 * Math.cos(Math.PI * t / pk) : Math.exp(-(t - pk) / 0.075);
        var nz = rnd(rs) * 2 - 1, y = (bp.p(nz) + 0.4 * bp2.p(nz)) * env;
        if (i === cutAt) eb = 0.32;
        ph += wb; y += Math.sin(ph) * eb; eb *= kb;
        var pan = clamp(-0.85 + 1.7 * Math.min(1, u * 1.35) * dir, -1, 1), a = (pan + 1) * Math.PI / 4;
        L[i] = y * Math.cos(a); R[i] = y * Math.sin(a);
      }
      Z[0] = ph; Z[1] = eb; yield 0;
    }
    return edges(normalize([dcBlock(L, sr), dcBlock(R, sr)], 0.7), sr, 0.002, 0.03);
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

  /* ---------- Interfaz, ola 3 (AUD-08): hoja final, flechas de dificultad, interruptores de Ajustes ----------
   * Una familia propia, distinta del clic/hover genéricos: piezas de "mecanismo" (pestillo, trinquete, contador) con un
   * tono pequeño en la tonalidad de la casa (Re mayor: las ráfagas y la firma de presentación están en Re).
   * Cada sonido es una lista de parciales y de golpes de ruido:
   *   p: [t0, f0, f1, tGlide, decay, amp, attack]  seno con deslizamiento exponencial f0→f1 en tGlide s y caída exp.
   *   z: [t0, fBanda, Q, decay, amp]                ruido por un paso banda (el "clic" del mecanismo), caída exp.
   * Todo empieza con un ataque ≥ 0,2 ms (sin escalones: audiotest busca clics dentro del sonido). */
  var UI2 = {
    // tic del contador de la hoja final (UI-11): cristalino y cortísimo; sube de tono con el avance (playbackRate). Su energía está
    // en 4-9 kHz, por encima de la grada (que pasa por un paso bajo de 1,5-6,5 kHz): se oye sobre la ovación final sin subirlo
    cntTick: { dur: 0.03, peak: 0.7, jit: 0.05, p: [[0, 5200, 5200, 0, 0.0026, 0.5, 0.0003], [0, 7800, 7800, 0, 0.0016, 0.28, 0.0002], [0, 2600, 2600, 0, 0.005, 0.22, 0.0004]], z: [[0, 9000, 1.0, 0.0006, 0.4]] },
    // las cifras se posan: pestillo doble (clac) con cuerpo en Re5/La5 y un "ding" pequeño en Re6 (todo consonante)
    cntLock: { dur: 0.26, peak: 0.75, p: [[0.009, 587.33, 587.33, 0, 0.028, 0.4, 0.0006], [0.009, 880, 880, 0, 0.016, 0.2, 0.0005], [0.009, 1174.66, 1174.66, 0, 0.085, 0.3, 0.002], [0.009, 2349.32, 2349.32, 0, 0.045, 0.09, 0.002]],
               z: [[0, 3500, 0.9, 0.0012, 0.55], [0.009, 2400, 0.9, 0.0016, 0.45]] },
    // pasar por encima de una flecha de la dificultad: punteo suave (‹ más grave, › más agudo por playbackRate)
    arwHover: { dur: 0.05, peak: 0.45, p: [[0, 1650, 1650, 0, 0.010, 0.45, 0.0008], [0, 3300, 3300, 0, 0.005, 0.18, 0.0006]], z: [[0, 5000, 0.8, 0.0005, 0.18]] },
    // pasar por encima de una fila de Ajustes: toque de fieltro, grave y sordo
    optHover: { dur: 0.05, peak: 0.45, p: [[0, 880, 880, 0, 0.012, 0.5, 0.001], [0, 1760, 1760, 0, 0.006, 0.15, 0.0008]], z: [[0, 2500, 0.7, 0.0008, 0.15]] },
    // un nivel más difícil: trinquete + cuarta ascendente La5→Re6 con brillo de octava; la nota final sigue al nivel
    stepUp: { dur: 0.27, peak: 0.75, p: [[0, 880, 880, 0, 0.035, 0.42, 0.0015], [0.045, 1174.66, 1174.66, 0, 0.09, 0.48, 0.002], [0.045, 2349.32, 2349.32, 0, 0.04, 0.1, 0.002]],
              z: [[0, 4200, 1, 0.0008, 0.45], [0.045, 3600, 1, 0.0007, 0.24]] },
    // un nivel más fácil: cuarta descendente Re6→La5, más oscura (sin octava)
    stepDown: { dur: 0.25, peak: 0.75, p: [[0, 1174.66, 1174.66, 0, 0.035, 0.4, 0.0015], [0.045, 880, 880, 0, 0.085, 0.48, 0.002], [0.045, 1760, 1760, 0, 0.025, 0.08, 0.002]],
                z: [[0, 3200, 1, 0.0009, 0.42], [0.045, 2600, 1, 0.0008, 0.28]] },
    // tope (‹ en Fácil, › en Experto): doble golpe sordo "no se puede"
    arwEdge: { dur: 0.17, peak: 0.6, p: [[0, 330, 255, 0.03, 0.022, 0.6, 0.001], [0, 660, 510, 0.03, 0.01, 0.16, 0.001], [0.055, 310, 240, 0.03, 0.02, 0.45, 0.001], [0.055, 620, 480, 0.03, 0.009, 0.12, 0.001]],
               z: [[0, 900, 0.7, 0.002, 0.25], [0.055, 850, 0.7, 0.002, 0.18]] },
    // interruptor a «Sí»: pestillo brillante y tono que sube Re6→La6
    tglOn: { dur: 0.19, peak: 0.7, p: [[0, 1174.66, 1760, 0.03, 0.06, 0.45, 0.0015], [0, 2349.32, 3520, 0.03, 0.03, 0.12, 0.0015]], z: [[0, 3800, 1, 0.001, 0.5]] },
    // interruptor a «No»: pestillo más grave y tono que baja Re6→Sol5, sin brillo
    tglOff: { dur: 0.17, peak: 0.7, p: [[0, 1174.66, 784, 0.04, 0.045, 0.45, 0.0015], [0, 587.33, 392, 0.04, 0.03, 0.12, 0.0015]], z: [[0, 2200, 1, 0.0012, 0.45]] },
    // opción de varios valores (calidad, tamaño del HUD, dificultad en Ajustes): retén + nota que sube con el índice
    optSel: { dur: 0.15, peak: 0.7, p: [[0, 1318.51, 1318.51, 0, 0.04, 0.42, 0.0015], [0, 2637.02, 2637.02, 0, 0.02, 0.1, 0.0012]], z: [[0, 4000, 1, 0.0008, 0.4]] }
  };
  function* genUi2(kind, rng, sr) {
    var def = UI2[kind], n = Math.ceil(def.dur * sr), d = new Float32Array(n), rs = rng.st;
    var fj = def.jit ? 1 + (rng() - 0.5) * def.jit : 1;           // variantes: el mismo mecanismo un pelo desafinado
    for (var a = 0; a < def.p.length; a++) {
      var P = def.p[a], st = (P[0] * sr) | 0, ke = Math.exp(-1 / (P[4] * sr)), att = Math.max(1, P[6] * sr), gl = P[3] > 0 ? P[3] * sr : 0;
      var f0 = P[1] * fj, lr = Math.log(P[2] / P[1]), m = Math.min(n - st, Math.ceil(P[4] * 9.5 * sr) + (att | 0));
      var Z = new Float64Array(2); Z[0] = 0; Z[1] = P[5];          // estado entre tramos: 0 fase · 1 envolvente
      for (var j0 = 0; j0 < m; j0 += CH) {
        var j1 = j0 + CH < m ? j0 + CH : m, ph = Z[0], e = Z[1];
        for (var i = j0; i < j1; i++) {
          var f = gl ? f0 * Math.exp(lr * Math.min(1, i / gl)) : f0;
          ph += TAU * f / sr; if (ph > TAU) ph -= TAU;
          var aa = i < att ? 0.5 - 0.5 * Math.cos(Math.PI * i / att) : 1;
          d[st + i] += Math.sin(ph) * e * aa; e *= ke;
        }
        Z[0] = ph; Z[1] = e; yield 0;
      }
    }
    for (var b = 0; b < def.z.length; b++) {
      var Q = def.z[b], s0 = (Q[0] * sr) | 0, bp = new Biq('bp', Q[1] * fj, Q[2], sr), kz = Math.exp(-1 / (Q[3] * sr)), mz = Math.min(n - s0, Math.ceil(Q[3] * 12 * sr) + 16), at2 = Math.max(1, 0.0004 * sr);
      var Y = new Float64Array(1); Y[0] = Q[4];
      for (var k0 = 0; k0 < mz; k0 += CH) {
        var k1 = k0 + CH < mz ? k0 + CH : mz, ez = Y[0];
        for (var k = k0; k < k1; k++) { var az = k < at2 ? k / at2 : 1; d[s0 + k] += bp.p(rnd(rs) * 2 - 1) * ez * az; ez *= kz; }
        Y[0] = ez; yield 0;
      }
    }
    dcBlock(d, sr);
    return edges(normalize([d], def.peak), sr, 0.0002, 0.004);
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
    // Presentación del partido (UI-14, AUD-06): la grada que crece mientras salen los equipos. Voces de ánimo que suben
    // en crescendo (no un estallido: no hay jugada), aplauso cada vez más denso, unos silbidos de aficionado y una
    // meseta final que se abre al pitido del primer saque. ~3,6 s.
    introSwell: function (rng, sr) {
      return crowdPlan({ dur: 3.6, peak: 0.85, fade: 0.45, layers: [
        { voices: 18, f1: [560, 960], f2: [1000, 1750], q: 1.5, syll: 1.0, depth: 0.35, pitched: 0.42, pitch: [170, 480], pglide: 0.04, stagger: 0.5 },
        { voices: 4, f1: [380, 850], f2: [1500, 2800], q: 0.6, syll: 0, depth: 0, pitched: 0, pitch: [100, 100] }],
        env: function (t, o) { var u = Math.min(1, t / 2.7); o[0] = (0.18 + 0.82 * u * u * (3 - 2 * u)) * Math.min(1, t / 0.25); },
        extras: function* (L, R, rng, sr) {
          yield* addClaps(L, R, 0.2, 1.2, 35, rng, sr, 0.22, null);
          yield* addClaps(L, R, 1.2, 2.2, 75, rng, sr, 0.26, null);
          yield* addClaps(L, R, 2.2, 3.6, 115, rng, sr, 0.3, null);
          yield* addFanWhistles(L, R, 3, 1.4, 3.0, rng, sr, 0.14);
        } }, rng, sr);
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
               Fs4: 369.99, G4: 392, A4: 440, B4: 493.88, Cs5: 554.37, D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880, D6: 1174.66,
               E6: 1318.51, Fs6: 1479.98, A6: 1760, D7: 2349.32, B5: 987.77 };
  /** Voz "metal": dos sierras desafinadas + subarmónico, filtro que se abre al atacar. */
  function* brass(L, R, sr, f, t0, dur, amp, rng) {
    var st = (t0 * sr) | 0, n = Math.ceil((dur + 0.35) * sr), lp = new Biq('lp', 800, 1.2, sr), p1 = rng(), p2 = rng(), p3 = rng();
    var e15 = 1, k15 = Math.exp(-1 / (0.15 * sr)), e30 = 1, k30 = Math.exp(-1 / (0.3 * sr)), rel = 1, kr = Math.exp(-1 / (0.09 * sr)), dn = (dur * sr) | 0;
    var i1 = f * 1.003 / sr, i2 = f * 0.997 / sr, i3 = f * 0.5 / sr, m = Math.min(n, L.length - st), nFade = (0.04 * sr) | 0, nTail = n - nFade;
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
        if (i > nTail) y *= (n - i) / nFade;   // AUD-08: la cola de la nota se apaga (antes se cortaba al 2 %: clic al final de la ráfaga)
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
    var bFade = (0.08 * sr) | 0, bTail = n - bFade;
    for (var j0 = 0; j0 < m; j0 += CH) {
      var j1 = j0 + CH < m ? j0 + CH : m, gI = Z[0], ge = Z[1];
      for (var i = j0; i < j1; i++) {
        var y = Math.sin(w * i + gI * Math.sin(w * 3.5 * i)) * ge * Math.min(1, i / (0.002 * sr)); gI *= kI; ge *= ke;
        if (i > bTail) y *= (n - i) / bFade;   // AUD-08: la cola se apaga (antes se cortaba al 3 % a los 1,4 s: clic)
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
    var nf = (0.06 * sr) | 0, f0 = n - nf;  // AUD-08: los últimos 60 ms se apagan (antes la cola se cortaba en seco a -22 dB: un clic en una ráfaga tranquila)
    for (var j0 = 0; j0 < m; j0 += CH) {
      var j1 = j0 + CH < m ? j0 + CH : m, gph = Z[0], g1 = Z[1], g2 = Z[2], g3 = Z[3];
      for (var i = j0; i < j1; i++) {
        gph += TAU * (48 + 40 * g1) / sr; g1 *= k1;
        var y = Math.sin(gph) * g2 + (rnd(rs) * 2 - 1) * g3; g2 *= k2; g3 *= k3;
        if (i > f0) y *= (n - i) / nf;
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
  /** Soplo que sube (AUD-08, revelación del MVP): ruido por un paso banda que barre de f0 a f1 (exponencial) y crece en
   *  potencia hasta t0+len, donde se apaga en 12 ms (el acento de la ráfaga cae justo ahí y lo tapa). Estéreo: un ruido
   *  y un filtro por canal (ancho, sin fase común). */
  function* air(L, R, sr, t0, len, amp, rng) {
    var st = (t0 * sr) | 0, n = (len * sr) | 0, nf = (0.012 * sr) | 0, m = Math.min(n + nf, L.length - st), rs = rng.st;
    var bl = new Biq('bp', 400, 1.3, sr), br = new Biq('bp', 416, 1.3, sr), lr = Math.log(6);
    for (var j0 = 0; j0 < m; j0 += CH) {
      var j1 = j0 + CH < m ? j0 + CH : m;
      for (var i = j0; i < j1; i++) {
        var u = Math.min(1, i / n);
        if ((i & 63) === 0) { var f = 400 * Math.exp(lr * u); bl.set('bp', f, 1.3, sr); br.set('bp', f * 1.04, 1.3, sr); }
        var e = amp * u * u * u * (i < n ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (i - n) / nf));
        L[st + i] += bl.p(rnd(rs) * 2 - 1) * e; R[st + i] += br.p(rnd(rs) * 2 - 1) * e;
      }
      yield 0;
    }
  }
  /** Partitura como datos: cada nota es un paso del plan.
   *  ['b', nota, t, dur, amp] metal · ['c', [notas], t, dur, amp] acorde · ['boom', t, amp] · ['crash', t, amp]
   *  ['bell', nota, t, amp, pan] · ['ep', nota, t, dur, amp] piano eléctrico · ['air', t, len, amp] soplo que sube */
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
      ['ep', 'Fs3', 1.3, 1.1, 0.3], ['ep', 'As3', 1.34, 1.1, 0.3], ['ep', 'Cs4', 1.38, 1.1, 0.3]] },
    // Presentación (AUD-06): firma de la casa, suave. Motivo de campana que sube (La-Re-Mi) y se posa en Fa# sobre un acorde
    // abierto de Re con novena (Re-Fa#-La-Mi) en piano eléctrico, con el Re grave debajo; un golpe grave amortiguado al
    // posarse. Mismo color que las ráfagas de set y partido (Re mayor, campana FM), sin fanfarria ni metal: abre, no celebra.
    // (Con metal en el bajo, el diente de sierra de Re2 quedaba al aire al apagarse las campanas: audiotest lo marcaba como clic.)
    // (El motivo es la firma: las campanas van casi al nivel del acorde, y el golpe grave es un apoyo, no un impacto.)
    introSting: { dur: 2.7, peak: 0.75, fade: 0.6, n: [['bell', 'A5', 0, 0.26, 0.35], ['bell', 'D6', 0.17, 0.26, 0.6], ['bell', 'E6', 0.34, 0.24, 0.45],
      ['ep', 'D3', 0.52, 1.6, 0.26], ['ep', 'A3', 0.53, 1.55, 0.17],
      ['ep', 'D4', 0.54, 1.5, 0.19], ['ep', 'Fs4', 0.56, 1.5, 0.17], ['ep', 'A4', 0.58, 1.5, 0.17], ['ep', 'E5', 0.6, 1.5, 0.13],
      ['boom', 0.52, 0.18], ['bell', 'Fs6', 0.52, 0.22, 0.5], ['bell', 'A6', 0.7, 0.1, 0.62]] },
    // Revelación del MVP en la hoja final (AUD-08). ui('mvp') se llama cuando empieza la cuenta de las cifras (600 ms): un soplo
    // sube bajo los tics y el acento cae a 0,6 s, cuando las cifras se posan. Gana el humano: arpegio de campanas Re-Fa#-La-Re
    // sobre Re mayor en piano eléctrico (el color de la fanfarria de partido, que suele estar acabando debajo). Pierde: el mismo
    // gesto en Si menor, más corto y suave (reconocimiento, no celebración).
    mvpWin: { dur: 2.0, peak: 0.7, fade: 0.5, n: [['air', 0.1, 0.5, 0.3],
      ['ep', 'D3', 0.6, 0.9, 0.16], ['ep', 'D4', 0.6, 0.8, 0.12], ['ep', 'Fs4', 0.61, 0.8, 0.11], ['ep', 'A4', 0.62, 0.8, 0.11], ['boom', 0.6, 0.1],
      ['bell', 'D6', 0.6, 0.2, 0.35], ['bell', 'Fs6', 0.636, 0.17, 0.65], ['bell', 'A6', 0.672, 0.15, 0.4], ['bell', 'D7', 0.708, 0.12, 0.6]] },
    mvpLose: { dur: 1.7, peak: 0.6, fade: 0.45, n: [['air', 0.15, 0.45, 0.2],
      ['ep', 'B3', 0.6, 0.8, 0.13], ['ep', 'D4', 0.61, 0.75, 0.11], ['ep', 'Fs4', 0.62, 0.75, 0.11],
      ['bell', 'Fs5', 0.6, 0.13, 0.4], ['bell', 'B5', 0.645, 0.11, 0.6], ['bell', 'D6', 0.69, 0.09, 0.5]] }
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
        case 'air': yield* air(L, R, sr, x[1], x[2], x[3], rng); break;
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
    reg(k, (k === 'bombo' || k === 'beat') ? 1 : k === 'slamSub' ? 2 : 3, 'full', function (rng, sr) { return impact(IMPACTS[k], rng, sr); });
  });
  reg('tick', 1, 'full', genTick);
  reg('sub', 1, 'full', genSub);
  reg('slap', 3, 'full', function (rng, sr) { return genSlap('slap', rng, sr); });
  reg('fist', 2, 'full', function (rng, sr) { return genSlap('fist', rng, sr); });
  reg('handclap', 3, 'full', genHandclap);
  reg('chest', 2, 'full', genChest);
  reg('wipe', 2, 'full', genWipe);
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
  Object.keys(UI2).forEach(function (k) { reg(k, k === 'cntTick' ? 2 : 1, 'full', function (rng, sr) { return genUi2(k, rng, sr); }); });
  ['murmur', 'excite', 'groan', 'ooh', 'applause', 'palmas'].forEach(function (k) { reg(k, 1, 'low', CROWD[k]); });
  reg('roar', 2, 'low', CROWD.roar);
  reg('introSwell', 1, 'low', CROWD.introSwell);
  Object.keys(SCORES).forEach(function (k) { reg(k, 1, 'mid', function (rng, sr) { return musicPlan(SCORES[k], rng, sr); }); });
  reg('ir', 1, 'ctx', genIR);
  /** Orden de generación: primero lo que suena antes (interfaz, silbato, toques), luego grada y música. */
  // la presentación (introSting/introSwell) suena nada más pulsar JUGAR y la cortinilla en el primer punto: van justo detrás del silbato
  // AUD-08: los de los menús (flechas, interruptores) justo tras la interfaz; los de la hoja final (tics, MVP) al final
  var PRIORITY = ['click', 'hover', 'start', 'back', 'arwHover', 'optHover', 'stepUp', 'stepDown', 'arwEdge', 'tglOn', 'tglOff', 'optSel', 'cntTick', 'whistle', 'introSting', 'introSwell', 'serve', 'pass', 'set', 'spike', 'land', 'whistleLong', 'free', 'block', 'net',
    'ir', 'murmur', 'bounce', 'dribble', 'wipe', 'slam', 'spikeHero', 'blockHero', 'sub', 'slamSub', 'tick', 'netTape', 'squeak', 'feet', 'scuff', 'whoosh', 'roar', 'applause', 'groan', 'excite', 'ooh',
    'whistleEnd', 'slide', 'perfect', 'slap', 'fist', 'handclap', 'chest', 'palmas', 'bombo', 'beat', 'setWin', 'setLose', 'matchWin', 'matchLose', 'cntLock', 'mvpWin', 'mvpLose'];
  Object.keys(CATALOG).forEach(function (k) { if (PRIORITY.indexOf(k) < 0) PRIORITY.push(k); });

  /* ---------- Plan de mezcla ----------
   * Nivel de cada sonido (dB) para que, a la ganancia nominal de su llamada, caiga en el objetivo de su
   * categoría (LUFS a la salida para señales por debajo del umbral del compresor, con su maquillaje incluido;
   * medido con tools/audiotest.js, tolerancia ±1,5 LU):
   *   interfaz -24 (hover/cambio -28) · toques -18 (colocación/dejada -21) · remate -14 · bloqueo/remate al suelo -15 · balón en el suelo
   *   y red -18 · silbato -16 · pies/zapatillas/brazo -24 · botes muertos -26 · lecho de grada -26 · reacciones
   *   de grada -20 · palmas/latido -22 · ráfagas -16 · destello "perfecto" -26.
   *   Ola 2: choque/puños/pecho -24 · palmada de ánimo -27 · bote del ritual -23 · cortinilla -25 · firma -19 · grada de la
   *   presentación -21 (juntas -17). Ola 3 (AUD-08): tics de la cuenta -29 (los 600 ms) · «clac» -25 · MVP -19 (hoja entera -19) ·
   *   flechas y Ajustes: confirmaciones -24, hovers y paso de deslizador -28. Relaciones entre capas: audiotest parte 2e (AUD-09).
   * Los posicionales se miden en campo propio a ~8 m de la cámara (con su panoramizador). */
  var LEVEL = {};
  var LEVEL_LIN = {};
  function setLevels(o) { for (var k in o) { LEVEL[k] = o[k]; LEVEL_LIN[k] = Math.pow(10, o[k] / 20); } }
  setLevels({
    pass: 5.3, set: 10.9, free: 7.9, serve: 2.5, spike: 2.8, block: 3.3, slam: -2.7, land: -0.2, net: 5.9, netTape: 5.7, bounce: 5.9,
    whistle: -3.1, whistleLong: -4.9, whistleEnd: -4.7, squeak: 4.3, scuff: 12.9, feet: 10.2, whoosh: 5.1, slide: 0.7,
    roar: -0.4, groan: -0.6, applause: 8.3, ooh: 1.7, palmas: 3.9, bombo: 3.9, beat: 0.8, murmur: -4.9, excite: -4.9,
    setWin: 2.7, setLose: 5.4, matchWin: 1.5, matchLose: 4.8, perfect: 7.7, click: 5.2, back: 4.3, start: -2.6, hover: 11,
    spikeHero: 2.8, blockHero: 3.3, sub: 0, slamSub: 0, tick: 8.6, slap: 9.8, fist: 10.4,
    handclap: 11.2, chest: 4.9, dribble: 1.4, wipe: -1.6, introSwell: -2.4, introSting: -0.3,
    cntTick: -1.8, cntLock: 0, arwHover: 7.9, optHover: 8.5, stepUp: -3.5, stepDown: -3.4, arwEdge: 3, tglOn: -2.6, tglOff: 0.7, optSel: -0.5, mvpWin: 1.6, mvpLose: 1.8
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
                deferred: 0, lateDrop: 0, lateMax: 0, ticks: 0, worker: 'none', workerMs: 0, workerHi: -1, bumped: 0, missed: {},
                // AUD-05: contactos de celebración y botes del ritual recibidos / que sonaron; tiras del pool usadas / pool lleno;
                // máximo de voces simultáneas (ranuras ocupadas, sin lechos). AUD-06/07: presentaciones, cortinillas, reacciones.
                fxIn: 0, fxOut: 0, dribIn: 0, dribOut: 0, pooled: 0, poolFull: 0, voicesMax: 0, intro: 0, wipe: 0, react: 0 }; // missed: nombre -> veces que se pidió sin buffer (y no se pudo aplazar) // ticks: "toc" del reloj de saque programados · aplazados (sin buffer aún), descartados por llegar tarde, retraso máx. (ms)
  var stingDone = false, beatNext = 0, clapNext = 0, clapBeat = 0, serveWait = 0, serveTeam = -1;
  /* Tensión del saque: 2 = punto de partido (latido 0,9 s, ganancia 1), 1 = punto de set (latido 1,0 s, ×0,6), 0 = nada.
   * El latido para en cuanto el sacador lanza (el gesto resuelve la tensión). */
  var tension = 0, BEAT_PERIOD = [0, 1.0, 0.9], BEAT_GAIN = [0, 0.6, 1];
  /* Reloj de saque (8 s, solo sacador humano): "toc" en los segundos 3, 2 y 1. tickNext = próximo segundo a marcar
   * (0 = ninguno); tickSrc/tickAt = el último programado (se cancela si el sacador lanza antes de que suene). */
  var tickNext = 0, tickSrc = null, tickAt = 0, TICK_AHEAD = 0.04;
  /* Cámara lenta frente a congelación (hit-stop): una bajada de ctx.timeScale de menos de SLOW_HOLD s reales se ignora
   * (el impacto suena a tiempo real, la grada no cambia de tono ni se apaga). Por debajo de FREEZE_TS es una congelación:
   * nunca cambia el tono. */
  // CAM-04 (camera.js hitStop): 0 durante ≤ 150 ms + vuelta de 0,25 a 1 en 80 ms → ≤ 230 ms bajo 0,95. Las cámaras lentas de
  // verdad (set/partido) duran 0,8-1,9 s: entran 0,25 s tarde, con rampas suaves.
  var lowT = 0, SLOW_HOLD = 0.25, FREEZE_TS = 0.04;
  var excite = 0, exciteBoost = 0, lastSpikeT = -9, lastSpikeTeam = -1, tossHush = 0;
  var pvx = new Float32Array(8), pvy = new Float32Array(8), scd = new Float32Array(8), squeakGap = 0;
  var applied = { fx: -1, crowd: -1, mur: -1, exc: -1, bright: -1, sfx: -1, music: -1, master: -1, rate: -1, chp: -1, punch: -1 };
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
   *    frecuencia exacta del contexto) entra en cola al crear el contexto.
   *  - Normalmente esta cola solo es el respaldo: en cuanto el Worker de síntesis saluda, todos sus
   *    trabajos pasan a él (ver "Hilo de síntesis" más abajo) y aquí quedan las copias y la reverb. */
  /* Primera pasada: UNA variante de cada sonido de juego (con una basta para que suene; play() elige al azar entre las
   * que haya). Medido en Chrome, móvil CPU ×4 y JUGAR nada más cargar: con todas las variantes de cada sonido seguidas
   * (pase ×3, remate ×3...), los primeros 60-80 s de partido perdían la mitad de los toques (skipped 10 → 80). */
  // pulido ola 2: el bote del ritual (cada saque de la CPU desde el primero, SIM-04) y los contactos de celebración (cada punto) también
  // van en la primera pasada (son muy cortos; medido sin Worker: 3 botes del ritual sin sonido en los primeros 20 s)
  // (orden = cuándo se oye por primera vez: el bote del ritual de la CPU va justo tras el silbato, antes del golpe de saque)
  // pulido ola 3: también el resto de sonidos de juego (plancha, toc del reloj de saque, refuerzos del golpe perfecto, celebración,
  // latido, cortinilla): sin Worker o con la CSP bloqueándolo, la cola los dejaba detrás de la grada y la música y en los
  // primeros 20 s se pedían sin buffer (medido: missed {slide:1}). Solo grada y música quedan para la segunda pasada.
  var CORE = ['click', 'start', 'whistle', 'dribble', 'set', 'feet', 'serve', 'whoosh', 'pass', 'spike', 'land', 'whistleLong', 'free', 'block', 'net', 'bounce',
    'scuff', 'squeak', 'slam', 'netTape', 'slide', 'hover', 'back', 'slap', 'handclap', 'tick', 'perfect', 'sub', 'spikeHero', 'blockHero', 'slamSub',
    'fist', 'chest', 'beat', 'wipe'];
  /* Un sonido de grada o música aplazado (bump: ovación de bienvenida, reacción del público) pasa al frente de la cola,
   * pero DETRÁS de los sonidos de juego de la primera pasada que aún falten (coreAhead). Antes iba delante de todo: la
   * ovación (roar + applause, ~90 ms de síntesis en escritorio, 0,4-1 s troceados en un móvil lento) dejaba sin buffer
   * los botes del ritual de la CPU y el primer saque (medido sin Worker, CPU x4: missed {dribble:3, whoosh:1, serve:1})
   * y, con el equipo cargado, los toques del primer peloteo ({spike, set, block, net}). La primera pasada entera son
   * ~160 ms de escritorio: la ovación llega algo más tarde (tolera 2,5 s) o, en un móvil saturado, se pierde ella y
   * no los toques. Con el Worker vivo esta cola casi no trabaja y da igual. */
  var coreLeft = 0, coreWait = Object.create(null), genRally = false, genGap = false; // primera pasada aún sin acabar (sin Worker: la cola corre más, ver schedule)
  function queueAll() {
    var seen = Object.create(null), p, v, c;
    for (p = 0; p < CORE.length; p++) if (CATALOG[CORE[p]]) { jobs.push({ name: CORE[p], v: 0, it: null, sr: 0 }); seen[CORE[p]] = 1; coreWait[CORE[p]] = 1; coreLeft++; }
    for (p = 0; p < PRIORITY.length; p++) {
      c = CATALOG[PRIORITY[p]];
      for (v = seen[PRIORITY[p]] ? 1 : 0; v < c.variants; v++) jobs.push({ name: PRIORITY[p], v: v, it: null, sr: 0 });
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
    if (jobs.length && wkState === 0) startWorker(); // primera vez: la síntesis pasa a su propio hilo si se puede
    if (wk) dispatch();              // con Worker, aquí solo quedan las copias a AudioBuffer y la reverb
    if (!jobs.length && !(AC && (pend.length || irWaiting()))) return;
    // en pleno peloteo solo huecos libres (timeout largo: como mucho ~2 ms cada 250 ms); entre puntos, en menú
    // y en pausa se fuerza antes si no hay huecos (2 ms cada 100 / 60 ms). Sin el escalón intermedio, en un móvil
    // sin huecos libres el lecho de grada tardaba más de un minuto de partido en estar listo (medido: CPU ×4).
    var playing = state === 'playing' && !demo, g = vctx && vctx.game, rally = playing && (!g || g.mode === 'rally');
    // urgent: hay un sonido aplazado esperando su buffer. coreLeft: falta algún sonido de juego (primera pasada; solo
    // ocurre sin Worker, en los primeros segundos): si no hay huecos libres, tramos forzados de 6 ms cada 24 ms (menú,
    // saque, entre puntos) o de 4 ms cada 40 ms (en peloteo) durante unos segundos, en vez de perder los toques durante
    // un minuto (medido en Chrome, CPU x4: ver notes/audio.md). Con huecos libres (móvil real con vsync) no cuesta nada.
    // genGap: sin Worker (o bloqueado), con la primera pasada ya hecha, entre puntos y en la espera del saque: tramos de
    // 4 ms cada 40 ms en vez de 2 ms cada 100 ms. Ahí no hay peloteo que cuidar y la grada y la música dejaban de crecer
    // durante todo el partido (medido sin Worker, CPU x4: built 27 → 28 de 97 entre los segundos 6 y 20).
    genRally = rally; genGap = playing && !rally && !wk && coreLeft <= 0 && jobs.length > 0;
    var tmo = urgent ? 16 : coreLeft > 0 ? (rally ? 40 : 24) : rally ? 250 : genGap ? 40 : playing ? 100 : 60;
    if (root.requestIdleCallback) jobTimer = root.requestIdleCallback(runJobs, { timeout: tmo });
    else if (st) jobTimer = st(runJobs, rally ? 24 : 16);
    else runJobs();
  }
  function bankDone() { if (!jobs.length && !wkCount && !pend.length && !irWaiting() && AC && stats.bankDoneAt < 0) stats.bankDoneAt = perf.now(); }

  /* Hilo de síntesis (Worker). En un móvil lento el hilo principal no tiene huecos libres en pleno partido (medido en
   * Chrome, 844x390, CPU x4: ~1 sonido por segundo; los primeros 60-80 s perdían la mitad de los toques). La síntesis es
   * JS puro sin estado compartido, así que se hace entera en otro hilo: el Worker ejecuta ESTE MISMO módulo (su código
   * fuente: VBAudioModule.toString(), sin ficheros ni red; Blob + URL de objeto, vale en file://) y devuelve los
   * Float32Array transferidos (sin copia). Mismo código y mismas semillas que la cola troceada: salida idéntica bit a bit.
   * El hilo principal solo copia cada resultado a su AudioBuffer (un memcpy). Si no hay Worker, la CSP lo bloquea o no
   * saluda en WK_WAIT ms, todo vuelve a la cola troceada de siempre (stats.worker: 'on' | 'off' | 'failed:<motivo>').
   * window.__vbAudioNoWorker = true lo desactiva (pruebas). Al terminar el banco se cierra (su memoria vuelve al sistema). */
  var wk = null, wkState = 0, wkCount = 0, wkJobs = Object.create(null), wkSeq = 0, wkUrl = null, wkDog = null, wkT0 = 0, WK_WAIT = 6000;
  function startWorker() {
    wkState = -1; stats.worker = 'off';
    if (!hasDoc || root.__vbAudioNoWorker || !root.Worker || !root.Blob || !root.URL || !root.URL.createObjectURL) return;
    try {
      var src = 'self.__vbAudioWorker=1;(' + VBAudioModule.toString() + ')();';
      wkUrl = root.URL.createObjectURL(new root.Blob([src], { type: 'text/javascript' }));
      wk = new root.Worker(wkUrl);
      wk.onmessage = onWorker;
      wk.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); workerFail('error'); };
      wkState = 1; stats.worker = 'starting'; wkT0 = perf.now();
      if (root.setTimeout) wkDog = root.setTimeout(function () { wkDog = null; if (wkState === 1) workerFail('timeout'); }, WK_WAIT);
    } catch (e) { workerFail('throw'); }
  }
  /** Pasa al Worker (cuando ya ha saludado) los trabajos pendientes de la cola, en su orden. Hasta el saludo la cola
   *  troceada sigue trabajando: un Worker que no arranca nunca deja un hueco sin síntesis. */
  function dispatch() {
    if (!wk || wkState !== 2 || !jobs.length) return;
    var msg = [];
    for (var k = 0; k < jobs.length; k++) {
      var j = jobs[k];
      j.it = null;                   // uno a medias en la cola troceada se rehace allí (los generadores no tienen efectos)
      var c = CATALOG[j.name];
      j.sr = rateOf(c.rate, AC ? AC.sampleRate : GUESS_RATE); j.id = ++wkSeq;
      wkJobs[j.id] = j; wkCount++;
      msg.push({ id: j.id, name: j.name, v: j.v, sr: j.sr });
      jobs.splice(k--, 1);
    }
    if (msg.length) { try { wk.postMessage({ jobs: msg }); } catch (e) { workerFail('post'); } }
  }
  function onWorker(e) {
    var m = e && e.data; if (!m || !wk) return;
    if (m.hi) {
      wkState = 2; stats.worker = 'on'; stats.workerHi = Math.round(perf.now() - wkT0);
      if (wkDog != null) { try { root.clearTimeout(wkDog); } catch (er) { } wkDog = null; }
      dispatch();
      return;
    }
    var j = wkJobs[m.id]; if (!j) return;
    delete wkJobs[m.id]; wkCount--;
    stats.workerMs += +m.ms || 0;
    if (m.chs) finishJob(j, m.chs); else jobFailed(j); // falló en el Worker: igual que en la cola
    if (!wkCount && !jobs.length) workerClose();
    bankDone();
    schedule(0);                    // reverb recién llegada, copias pendientes
  }
  function workerClose() {
    if (wk) { try { wk.terminate(); } catch (e) { } }
    wk = null; wkState = -1;
    if (wkUrl) { try { root.URL.revokeObjectURL(wkUrl); } catch (e) { } wkUrl = null; }
  }
  /** El Worker no está o no responde: sus trabajos vuelven a la cola troceada, en su orden. */
  function workerFail(why) {
    var back = [];
    for (var id in wkJobs) back.push(wkJobs[id]);
    back.sort(function (a, b) { return a.id - b.id; });
    workerClose();
    if (wkDog != null) { try { root.clearTimeout(wkDog); } catch (e) { } wkDog = null; }
    wkJobs = Object.create(null); wkCount = 0;
    for (var k = 0; k < back.length; k++) { back[k].it = null; back[k].id = 0; }
    jobs = back.concat(jobs);
    stats.worker = 'failed:' + why;
    schedule(0);
  }
  /** Lado del Worker: el mismo módulo, cargado dentro del Worker, sintetiza lo que le piden (en orden; bump = al frente). */
  function workerMain() {
    var q = [], busy = false, tm = root.performance && root.performance.now ? root.performance : Date;
    function step() {
      busy = false;
      var j = q.shift(); if (!j) return;
      var t0 = tm.now(), c = CATALOG[j.name];
      try {
        var chs = runSync(c.gen(makeRng(seedOf(j.name, j.v)), j.sr)), tr = [];
        for (var i = 0; i < chs.length; i++) if (tr.indexOf(chs[i].buffer) < 0) tr.push(chs[i].buffer);
        root.postMessage({ id: j.id, chs: chs, ms: tm.now() - t0 }, tr);
      } catch (e) { root.postMessage({ id: j.id, err: String(e && e.message || e), ms: tm.now() - t0 }); }
      pump();
    }
    // un trabajo por vuelta del bucle de eventos: entre uno y otro se atienden los "bump" (sonido pedido sin buffer)
    function pump() { if (!busy && q.length) { busy = true; root.setTimeout(step, 0); } }
    root.onmessage = function (e) {
      var m = e.data || {}, k;
      if (m.jobs) for (k = 0; k < m.jobs.length; k++) if (CATALOG[m.jobs[k].name]) q.push(m.jobs[k]);
      if (m.bump) for (k = 0; k < q.length; k++) if (q[k].name === m.bump) { if (k > 0) q.unshift(q.splice(k, 1)[0]); break; }
      pump();
    };
    root.postMessage({ hi: 1 });
  }

  function jobFailed(j) { built++; stats.built = built; if (coreWait[j.name]) { delete coreWait[j.name]; coreLeft--; } }
  function finishJob(j, chs) {
    stats.synth++;
    if (coreWait[j.name]) { delete coreWait[j.name]; coreLeft--; }
    if (!jobs.length && !wkCount && stats.synthDoneAt < 0) stats.synthDoneAt = perf.now();
    if (AC) toBank(j.name, chs, j.sr); else pend.push({ name: j.name, chs: chs, sr: j.sr });
  }
  function toBank(name, chs, sr) {
    if (name === 'ir') {
      if (sr !== AC.sampleRate) { // se sintetizó con la frecuencia supuesta y el contexto usa otra: rehacer
        jobs.splice(jobs.length && jobs[0].it ? 1 : 0, 0, { name: 'ir', v: 0, it: null, sr: 0 });
        schedule(0);                // con Worker vivo, se le pasa a él
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
    var budget = idle ? clamp(deadline.timeRemaining() - 1, 1, 8) : coreLeft > 0 ? (genRally ? 4 : 6) : genGap ? 4 : (root.requestIdleCallback ? 2 : 3);
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
        } catch (e) { jobs.shift(); jobFailed(j); }
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
      // Bus de refuerzo ("punch"): entra DESPUÉS del compresor (directo al recortador). El chasquido del remate ya lleva el
      // compresor a ~3 dB de reducción y su pico queda clavado (-3,8 dBTP medidos): todo refuerzo que pase por él se lo come
      // (medido: el sub por el bus normal dejaba el remate perfecto 0,8 LU MÁS FLOJO que el bueno). Aquí solo van capas de
      // pico conocido y acotado (sub, cuerpo), con volumen general, de efectos, pausa y silencio aplicados a mano.
      // El DynamicsCompressor de Chrome/WebKit retrasa su salida 6 ms (mirada adelante): el bus de refuerzo lleva el mismo
      // retraso para que el chasquido no se adelante a su propia reverb, a la agachada de la grada ni al resto de la mezcla.
      N.punch = AC.createGain(); N.punch.gain.value = 0;
      var pout = N.clip || AC.destination;
      if (AC.createDelay) { N.punchDl = AC.createDelay(0.05); N.punchDl.delayTime.value = 0.006; N.punch.connect(N.punchDl); N.punchDl.connect(pout); }
      else N.punch.connect(pout);
      N.master = AC.createGain(); N.master.gain.value = 0; N.master.connect(N.comp);
      N.fx = AC.createBiquadFilter(); N.fx.type = 'lowpass'; N.fx.frequency.value = 20000; N.fx.Q.value = 0.5; N.fx.connect(N.master);
      N.sfx = AC.createGain(); N.sfx.gain.value = vol.sfx; N.sfx.connect(N.fx);
      N.crowdTone = AC.createBiquadFilter(); N.crowdTone.type = 'lowpass'; N.crowdTone.frequency.value = 2500; N.crowdTone.Q.value = 0.4;
      N.crowdEq = AC.createBiquadFilter(); N.crowdEq.type = 'peaking'; N.crowdEq.frequency.value = 3300; N.crowdEq.Q.value = 1.1; N.crowdEq.gain.value = 0;
      N.crowdTone.connect(N.crowdEq); N.crowdEq.connect(N.fx);
      // agachada de la grada (refuerzo del golpe perfecto) y paso alto de tensión (saque en punto de set/partido):
      // nodos propios, así no pelean con las rampas de volumen de N.crowd
      N.crowdHp = AC.createBiquadFilter(); N.crowdHp.type = 'highpass'; N.crowdHp.frequency.value = 20; N.crowdHp.Q.value = -3; N.crowdHp.connect(N.crowdTone); // Q en dB (WebAudio): -3 dB = Butterworth
      N.duck = AC.createGain(); N.duck.gain.value = 1; N.duck.connect(N.crowdHp);
      N.crowd = AC.createGain(); N.crowd.gain.value = vol.crowd; N.crowd.connect(N.duck);
      N.music = AC.createGain(); N.music.gain.value = vol.music; N.music.connect(N.master);
      N.revIn = AC.createGain(); N.revIn.gain.value = 1;
      N.revBus = AC.createGain(); N.revBus.gain.value = 1;   // reparte a los tramos de convolución (irStep)
      N.revOut = AC.createGain(); N.revOut.gain.value = 0.55;
      N.revOut.connect(N.fx);
      if (reverbOn) N.revIn.connect(N.revBus);
      N.murG = AC.createGain(); N.murG.gain.value = 0; N.murG.connect(N.crowd);
      N.excG = AC.createGain(); N.excG.gain.value = 0; N.excG.connect(N.crowd);
      poolBuild();
    } catch (e) { AC = null; N = {}; return null; }
    stats.unlockAt = perf.now();
    // dentro del gesto: los sonidos que no pueden perderse y ya están sintetizados pasan a AudioBuffer ya
    // (una copia de memoria cada uno, < 1 ms en total), sin esperar a la cola troceada
    for (var pk = 0; pk < pend.length; pk++) {
      if (Object.prototype.hasOwnProperty.call(DEFER, pend[pk].name)) { var pj = pend.splice(pk--, 1)[0]; toBank(pj.name, pj.chs, pj.sr); }
    }
    startGen(0);
    if (delayT != null) { try { root.clearTimeout(delayT); } catch (e) { } delayT = null; } // gesto antes de la espera: empezar ya
    if (jobs.length && wkState === 0) startWorker(); // la cola al Worker antes del primer tramo (si no, lo sintetizaría aquí)
    if (wk) dispatch();
    if (jobTimer == null) runJobs(); // primer tramo ya, dentro del gesto (≤ ~3 ms): copias a AudioBuffer (o síntesis sin Worker)
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
    lastGain = null;
    if (!live()) return null;
    // argumentos saneados: un NaN en gain.value lanza en Chrome (el sonido se perdía con nodos creados sin conectar)
    gain = isFinite(gain) ? clamp(+gain, 0, 4) : 1;
    if (px != null && !isFinite(px)) px = null;
    if (!isFinite(py)) py = 0;
    if (!(rate > 0) || !isFinite(rate)) rate = 1;
    if (!(send > 0) || !isFinite(send)) send = 0;
    if (!(delay > 0) || !isFinite(delay)) delay = 0;
    var list = bank[name];
    if (!list || !list.length) {
      if (!deferPlay(name, gain, px, py, rate, send, delay, bus, false)) { stats.skipped++; stats.missed[name] = (stats.missed[name] | 0) + 1; bumpSoft(name); }
      return null;
    }
    var t = AC.currentTime + (delay || 0), slot = -1, lim = bus === 'music' ? ends.length : MAX_VOICES;
    for (var k = 0; k < lim; k++) if (ends[k] <= t) { slot = k; break; }
    if (slot < 0) { stats.skipped++; return null; }
    try {
      var buf = list[(Math.random() * list.length) | 0];
      var src = AC.createBufferSource(); src.buffer = buf;
      var r = (rate || 1) * (bus === 'music' ? 1 : slowRate);
      src.playbackRate.value = r;
      gain *= LEVEL_LIN[name] || 1;
      var g = AC.createGain(); g.gain.value = gain; lastGain = g;
      src.connect(g);
      var out = g;
      if (px != null) {
        // siempre con panoramizador: StereoPanner reparte un mono a -3 dB por canal en el centro, así que crearlo
        // solo cuando pan ≠ 0 hacía saltar 3 dB un mismo golpe según cayera en el centro o no (audiotest)
        spatial(px, py); g.gain.value = gain * SP_ATT;
        if (AC.createStereoPanner) { var p = AC.createStereoPanner(); p.pan.value = SP_PAN; g.connect(p); out = p; }
      }
      out.connect(bus === 'music' ? N.music : bus === 'crowd' ? N.crowd : bus === 'punch' && N.punch ? N.punch : N.sfx);
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
                setWin: 1.5, setLose: 1.5, matchWin: 2.5, matchLose: 2.5, start: 0.3, click: 0.2,
                introSting: 0.6, introSwell: 1.2, wipe: 0.1,
                // AUD-08: confirmaciones de menú (tarde, no valen: 0,15 s), el clac final de la cuenta y la revelación del MVP
                stepUp: 0.15, stepDown: 0.15, tglOn: 0.15, tglOff: 0.15, optSel: 0.15, arwEdge: 0.15, cntLock: 0.05, mvpWin: 0.4, mvpLose: 0.4 }; // presentación tarde: sin firma pasado 0,6 s; cortinilla: o en su corte o nada
  var deferred = [], urgent = false;
  function deferPlay(name, gain, px, py, rate, send, delay, bus, wh) {
    if (!AC || !genStarted || !Object.prototype.hasOwnProperty.call(DEFER, name)) return false;
    var t = AC.currentTime;
    for (var k = deferred.length - 1; k >= 0; k--) if (t - deferred[k].at > DEFER[deferred[k].name]) { deferred.splice(k, 1); stats.skipped++; stats.lateDrop++; }
    if (deferred.length >= 8) return false;
    deferred.push({ name: name, gain: gain, px: px, py: py, rate: rate, send: send, at: t + (delay || 0), bus: bus, wh: !!wh, wel: deferTag });
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
      if (k < jobs.length && !coreWait[name] && coreLeft > 0) coreAhead();
      if (wk) { try { wk.postMessage({ bump: name }); } catch (e) { } }
    }
    if (!urgent) {
      urgent = true;
      if (jobTimer != null && root.cancelIdleCallback) { try { root.cancelIdleCallback(jobTimer); } catch (e) { } jobTimer = null; }
      schedule(0);
    }
  }
  /** Tras subir al frente un sonido de grada o música: los sonidos de juego de la primera pasada que aún falten van delante
   *  de él, en su orden (moverlos es seguro: un trabajo a medias conserva el estado en su generador). */
  function coreAhead() {
    var mv = [], k;
    for (k = 0; k < jobs.length; k++) if (coreWait[jobs[k].name] && jobs[k].v === 0) mv.push(jobs.splice(k--, 1)[0]);
    if (mv.length) jobs = mv.concat(jobs);
  }
  /** Un toque sin buffer no se aplaza (sonaría tarde), pero su sonido pasa al frente: el siguiente ya suena. */
  function bumpSoft(name) {
    if (!genStarted || !CATALOG[name] || (bank[name] && bank[name].length)) return;
    var k;
    for (k = 0; k < pend.length; k++) if (pend[k].name === name) { if (k > 0) pend.unshift(pend.splice(k, 1)[0]); return; }
    for (k = 0; k < jobs.length; k++) if (jobs[k].name === name) { if (k > 0 && !jobs[0].it) jobs.unshift(jobs.splice(k, 1)[0]); else if (k > 1) jobs.splice(1, 0, jobs.splice(k, 1)[0]); break; }
    if (wk) { try { wk.postMessage({ bump: name }); } catch (e) { } }
    stats.bumped++;
  }
  function flushDeferred(name) {
    var t = AC.currentTime;
    for (var k = 0; k < deferred.length; k++) {
      var d = deferred[k]; if (d.name !== name) continue;
      deferred.splice(k--, 1);
      var late = t - d.at;
      if (late > DEFER[name]) { stats.skipped++; stats.lateDrop++; continue; }
      if (d.wel && intro.t0 >= d.at - 0.4) continue; // bienvenida aplazada que ya cubre la presentación (AUD-06)
      stats.lateMax = Math.max(stats.lateMax, Math.round(late * 1000));
      if (d.wh) whistle(name, d.gain, Math.max(0, -late), d.rate); else play(name, d.gain, d.px, d.py, d.rate, d.send, Math.max(0, -late), d.bus);
    }
    if (!deferred.length) urgent = false;
  }
  /* Tiras de voz reutilizables (AUD-05): ganancia → panoramizador → efectos, con su envío de reverb, creadas UNA vez (al crear
   * el contexto) y conectadas para siempre. Un contacto de celebración o un bote del ritual de saque solo crea su
   * BufferSource (de un solo uso por diseño de WebAudio); ganancia, paneo y envío se programan en la tira con setValueAtTime
   * en el instante exacto de arranque, así no tocan a lo que la tira tocara antes. Se elige la tira libre que lleva más tiempo
   * sin usarse (LRU). Si las POOL_N están ocupadas (no pasa en una celebración: 2-4 contactos), se cae a play() normal. */
  var POOL_N = 8, pool = [];
  function poolBuild() {
    pool.length = 0;
    try {
      for (var k = 0; k < POOL_N; k++) {
        var g = AC.createGain(); g.gain.value = 0;
        var p = AC.createStereoPanner ? AC.createStereoPanner() : null, s = AC.createGain(); s.gain.value = 0;
        var o = p || g; if (p) g.connect(p);
        o.connect(N.sfx); o.connect(s); s.connect(N.revIn);
        pool.push({ g: g, p: p, s: s, end: 0, used: 0 });
      }
    } catch (e) { pool.length = 0; }
  }
  function atT(prm, v, t) { try { if (prm.cancelScheduledValues) prm.cancelScheduledValues(t); prm.setValueAtTime(v, t); } catch (e) { prm.value = v; } }
  /** play() por una tira del pool (solo bus de efectos, posicional). Devuelve la fuente o null. */
  function playPooled(name, gain, px, py, rate, send, delay) {
    if (!live()) return null;
    gain = isFinite(gain) ? clamp(+gain, 0, 4) : 1;
    if (px != null && !isFinite(px)) px = null;
    if (!isFinite(py)) py = 0;
    if (!(rate > 0) || !isFinite(rate)) rate = 1;
    if (!(send > 0) || !isFinite(send)) send = 0;
    if (!(delay > 0) || !isFinite(delay)) delay = 0;
    var list = bank[name];
    if (!list || !list.length) { stats.skipped++; stats.missed[name] = (stats.missed[name] | 0) + 1; bumpSoft(name); return null; }
    var t = AC.currentTime + delay, st = null, k;
    for (k = 0; k < pool.length; k++) { var c = pool[k]; if (c.end <= t && (!st || c.used < st.used)) st = c; }
    if (!st) { stats.poolFull++; return play(name, gain, px, py, rate, send, delay); }
    var slot = -1;
    for (k = 0; k < MAX_VOICES; k++) if (ends[k] <= t) { slot = k; break; }
    if (slot < 0) { stats.skipped++; return null; }
    try {
      var buf = list[(Math.random() * list.length) | 0], src = AC.createBufferSource(), r = rate * slowRate;
      src.buffer = buf; src.playbackRate.value = r;
      spatial(px, py);
      atT(st.g.gain, gain * (LEVEL_LIN[name] || 1) * (px != null ? SP_ATT : 1), t);
      if (st.p) atT(st.p.pan, px != null ? SP_PAN : 0, t);
      atT(st.s.gain, reverbOn ? send : 0, t);
      src.connect(st.g); src.start(t);
      st.end = ends[slot] = t + buf.duration / r + 0.02; st.used = ++poolSeq;
      stats.played[name] = (stats.played[name] || 0) + 1; stats.pooled++;
      return src;
    } catch (e) { return null; }
  }
  var poolSeq = 0;
  /** Voces sonando ahora (ranuras con fin en el futuro; los lechos en bucle no cuentan). Sin asignaciones. */
  function voicesNow() { var t = now(), c = 0; for (var k = 0; k < ends.length; k++) if (ends[k] > t) c++; return c; }
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
    if (N.punch) setParam(N.punch.gain, 'punch', punchGain(), tc);
    setParam(N.sfx.gain, 'sfx', vol.sfx * (demo ? 0.35 : 1) * (state === 'paused' ? 0.5 : 1), tc);
    setParam(N.music.gain, 'music', vol.music, tc);
  }
  /** Ganancia del bus de refuerzo (después del compresor): la misma cadena de volúmenes que un efecto normal (general ×
   *  efectos × demo × pausa) y el maquillaje del compresor ya compensado (MAKEUP_COMP lo cancela en el bus principal). */
  function punchGain() { return muted ? 0 : vol.master * vol.sfx * (demo ? 0.35 : 1) * (state === 'paused' ? 0.5 : 1); }
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
  function fxS(e, d) { return isFinite(e.strength) ? clamp(+e.strength, 0, 1) : d; }
  function evx(e) { return e.player && isFinite(e.player.x) ? e.player.x : e.x; }
  function evy(e) { return e.player && isFinite(e.player.y) ? e.player.y : e.y; }

  /** Agachada breve de la grada (bus propio N.duck): `db` (negativo) durante `hold` s, con ataque de ~5 ms y vuelta
   *  suave (~35 ms). Deja hueco al chasquido del golpe perfecto sin que se note que la grada "baja". */
  function duckCrowd(db, hold) {
    if (!live() || !N.duck) return;
    try {
      var p = N.duck.gain, t0 = AC.currentTime;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t0); else p.cancelScheduledValues(t0);
      p.setTargetAtTime(Math.pow(10, db / 20), t0, 0.005);
      p.setTargetAtTime(1, t0 + hold, 0.035);
    } catch (err) { }
  }
  /* Golpe perfecto del humano (remate, bloqueo directo; saque en salto en versión ligera), medido en la cadena real
   * (tools/audiotest.js, Chrome): el chasquido de un remate normal lleva el compresor general a ~3 dB de reducción y su
   * pico de salida queda clavado en -3,8 dBTP, así que subirlo o sumarle capas por el bus normal no se oye (el sub por ahí
   * dejaba el perfecto 0,8 LU MÁS FLOJO: el grave bombeaba el compresor). En el perfecto, el chasquido va por el bus de
   * refuerzo (después del compresor) con un techo de pico calculado (PUNCH_CEIL): suena entero, sin aplastar, ~+3 LU en los
   * 150 ms tras el contacto y pico real ≤ -1,5 dBTP. Encima, un "thump" sub de 62→45 Hz pequeño (se siente, no suma pico)
   * y una agachada de la grada de 60 ms a -4 dB. */
  // techos de pico de salida (muestras) por el bus de refuerzo: chasquido del remate perfecto, del bloqueo directo (lleva
  // además el traqueteo de la red), de la versión ligera (saque en salto) y del sub (pico a los ~20 ms, sobre la cola).
  // Con la grada y el resto, el total medido queda entre -2 y -3 dBTP.
  var PUNCH_CEIL = 0.6, PUNCH_CEIL_BLOCK = 0.54, PUNCH_CEIL_LIGHT = 0.5, SUB_CEIL = 0.12, SUB_G = 0.5, SUB_DELAY = 0.008;
  /** Ganancia de `name` acotada para que su pico de salida por el bus de refuerzo no pase de `ceil` (muestras, 0..1):
   *  pico del buffer × nivel × distancia × reparto del panoramizador × volúmenes del bus. Determinista: el buffer está
   *  normalizado a su `peak`. */
  function punchCap(name, gain, x, y, ceil) {
    var pg = punchGain(); if (!(pg > 0)) return gain;
    var ch = 1, att = 1;
    if (x != null && isFinite(x)) { spatial(x, y); var u = (SP_PAN + 1) * Math.PI / 4; ch = Math.max(Math.cos(u), Math.sin(u)); att = SP_ATT; }
    var bp = IMPACTS[name] ? IMPACTS[name].peak || 0.9 : 0.9;
    var pk = gain * (LEVEL_LIN[name] || 1) * att * ch * pg * bp;
    return pk > ceil ? gain * ceil / pk : gain;
  }
  /** Capas del perfecto (w = 1 remate / bloqueo, < 1 versión ligera): sub (por el bus de refuerzo, con techo) + agachada. */
  function sweeten(w) {
    if (demo) return;
    duckCrowd(-4 * w, 0.06);
    play('sub', punchCap('sub', SUB_G * w, null, null, SUB_CEIL * w), null, null, jit(0.03), 0, SUB_DELAY, 'punch');
  }
  function onHit(e, g) {
    var k = e.kind, q = isFinite(e.quality) ? e.quality : 1, sp = isFinite(e.speed) ? e.speed : 8, x = e.x, y = e.y;
    var hg = e.human ? 1 : 0.92, shot = e.shot || '', pw = isFinite(e.power) ? clamp(e.power, 0, 1) : 0.5;
    var perf = !!e.human && e.grade === 'perfect';
    // el balón da en el cuerpo sin gesto (sim shot 'body'): golpe sordo, más apagado que un 'shank'
    if (shot === 'body') { play('free', 0.5 * hg, x, y, jit(0.1) * 0.7, 0.1); lastSpikeTeam = -1; return; }
    switch (k) {
      case 'serve':
        if (shot === 'jump') { // saque en salto: casi un remate; perfecto → refuerzo ligero
          var gj = 0.85 * hg * (0.85 + 0.2 * pw);
          if (perf) { sweeten(0.55); play('spikeHero', punchCap('spikeHero', gj, x, y, PUNCH_CEIL_LIGHT), x, y, jit(0.06) * 1.05, 0.35, 0, 'punch'); }
          else play('spike', gj, x, y, jit(0.06) * 1.05, 0.35);
        } else play('serve', 0.8 * hg * clamp(0.75 + sp / 40, 0.8, 1.15), x, y, jit(0.08), 0.28);
        break;
      case 'set': play('set', 0.55 * hg, x, y, jit(0.1) * (0.95 + q * 0.1), 0.12); break;
      case 'spike':
        // remate perfecto del humano: el chasquido sube ~1 dB, un pelo más grave (más "peso"), y lleva el sub
        if (perf) sweeten(1);
        if (perf) { // chasquido entero por el bus de refuerzo (con techo de pico), un pelo más grave: más "peso"
          var gp = hg * (0.82 + 0.25 * pw);
          play('spikeHero', punchCap('spikeHero', gp, x, y, PUNCH_CEIL), x, y, jit(0.06) * (0.96 + 0.08 * pw) * 0.97, 0.32 + 0.1 * pw, 0, 'punch');
        } else play('spike', hg * (0.82 + 0.25 * pw), x, y, jit(0.06) * (0.96 + 0.08 * pw), 0.32 + 0.1 * pw);
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
        // defensa de un remate rival: "uuuh" de la grada que crece con cada defensa del peloteo (AUD-07: la 2.ª y la 3.ª
        // suben de volumen y un pelo de tono; el ánimo del lecho sube con ellas). digs: g.rally.digs (SIM-01) o cuenta propia.
        if (k === 'pass' && lastSpikeTeam >= 0 && lastSpikeTeam !== e.team && isFinite(e.t) && e.t - lastSpikeT < 1.2 && !demo) {
          rallyDigs++;
          var nd = Math.max(1, g && g.rally && isFinite(g.rally.digs) && g.rally.digs > 0 ? g.rally.digs | 0 : rallyDigs), nb = Math.min(nd - 1, 2);
          playGap('ooh', 1.1, Math.min(0.9, 0.55 + 0.12 * nb + (e.dive ? 0.12 : 0)), null, null, jit(0.06) * (1 + 0.025 * nb), 0, 0.05, 'crowd');
          exciteBoost = Math.max(exciteBoost, 0.3 + 0.08 * nd);
        }
    }
    // toque perfecto del jugador humano: destello muy discreto (más presente en remate y saque)
    // En remate y saque el destello entra 45 ms tarde, ya sobre la cola del chasquido: es una campana (picos de seno) y
    // encima del contacto sumaba 0,21 de pico a la salida (medido en Chrome) sin sumar sonoridad; detrás, se oye mejor.
    if (e.human && e.grade === 'perfect' && !demo) {
      var big = k === 'spike' || k === 'serve';
      play('perfect', big ? 0.16 : 0.12, null, null, k === 'spike' ? 1.06 : 1, 0.1, big ? 0.045 : 0, 'music');
    }
    if (k !== 'spike') lastSpikeTeam = -1;
  }

  /* Reacción de la grada al punto (AUD-07). El público es local: anima al equipo humano (0). Todo sale de `point.highlight`
   * (0..1, SIM-01: lo grande que ha sido el punto), con escala continua (ningún escalón): un punto un poco más grande siempre
   * suena un poco más grande. Las muestras son las de siempre (roar, applause, groan, ooh, palmas, bombo); lo que cambia es
   * cuánto, cuánto dura y cuántas capas. Punto local:
   *  - ovación: ganancia 0,40 + 0,72·h (h 0,15 → 0,51 · 0,35 → 0,65, la de antes para un remate · 0,8 → 0,98);
   *  - ovación larga: segunda capa desde h 0,4 (crece hasta 0,8) que entra a los 0,9 s y la alarga hasta la pausa;
   *  - estallido: desde h 0,72, una capa más aguda encima del ataque y dos golpes de bombo;
   *  - aplauso 0,22 + 0,5·h, y un segundo aplauso desde h 0,45 que lo alarga;
   *  - digs ≥ 2: "uuuh" que rompe en ovación (la ovación entra 0,14 s más tarde, encima de la "u");
   *  - racha ≥ 3: tras la ovación, palmas al unísono con bombo que enlazan con las del saque local (misma rejilla);
   *  - punto de set salvado: capa de alivio ("¡aaah!") a los 0,4 s y aplauso más largo.
   * Punto rival: lamento proporcional (más si es error local), aplauso de reconocimiento desde h 0,45 (una gran jugada
   * rival también se aplaude) y "uuuh" de admiración con digs ≥ 2; si el rival salva un punto de set, el lamento es mayor. */
  var CHANT_P = 0.42, chantT0 = 0, chantN = 0, chantUntil = 0, rallyDigs = 0;
  var react = { h: -1, team: -1, layers: 0, chant: 0, t: 0 }; // última reacción (pruebas: VB.Audio._debug().react)
  function rplay(name, gain, delay, rate) {
    if (!(gain > 0.04)) return;
    if (play(name, gain, null, null, (rate || 1) * jit(0.06), 0, delay, 'crowd')) react.layers++;
  }
  /** highlight del punto; sin él (sim anterior a SIM-01) se estima con los mismos términos que VB.Sim.highlightOf. */
  function hlOf(e) {
    if (isFinite(e.highlight)) return clamp(+e.highlight, 0, 1);
    var hits = e.rallyHits | 0, how = typeof e.how === 'string' ? e.how : '';
    var h = 0.15 + Math.min(0.35, 0.03 * Math.max(0, hits - 4)) + Math.min(0.24, 0.12 * (e.digs | 0));
    if (how === 'block') h += 0.25;
    if (how === 'ace') h += 0.2;
    if (e.setWon) h += 0.15;
    if (e.savedSetPoint) h += 0.15;
    if ((e.streak | 0) >= 3) h += 0.1;
    if (how === 'error' && !e.setWon && !e.matchWon) h = Math.min(h, 0.35);
    return clamp(h, 0, 1);
  }
  function ramp01(h, a, b) { return clamp((h - a) / (b - a), 0, 1); }
  function crowdReact(e, g) {
    var h = hlOf(e), home = e.team === 0, how = typeof e.how === 'string' ? e.how : '';
    var error = how ? how === 'error' : e.reason !== 'in';
    var digs = e.digs | 0, streak = e.streak | 0, saved = !!e.savedSetPoint;
    var hold = isFinite(e.hold) && e.hold > 0 ? +e.hold : 1.9;
    react.h = h; react.team = e.team; react.layers = 0; react.chant = 0; react.t = now(); stats.react++;
    if (demo) { rplay('applause', 0.18 + 0.2 * h, 0.3); return; }
    if (e.matchWon) {
      if (home) { rplay('roar', 1.0, 0.1); rplay('roar', 0.7, 0.9, 0.94); rplay('applause', 0.9, 1.4); }
      else { rplay('groan', 0.7, 0.12, 0.95); rplay('applause', 0.45, 1.2); }
      return;
    }
    var pre = digs >= 2 ? 0.14 : 0, u;
    if (home) {
      if (digs >= 2) rplay('ooh', 0.34 + 0.08 * Math.min(digs - 2, 2), 0, 1.04);
      rplay('roar', Math.min(1.12, (0.4 + 0.72 * h) * (error ? 0.92 : 1)), 0.12 + pre);       // error rival: alegría, algo menos
      u = ramp01(h, 0.4, 0.8); if (u > 0) rplay('roar', 0.55 * u, 0.92 + pre, 0.95);            // ovación larga
      u = ramp01(h, 0.72, 1);
      if (u > 0) { rplay('roar', 0.25 + 0.4 * u, 0.04 + pre, 1.07); rplay('bombo', 0.3 + 0.3 * u, 0.22 + pre); rplay('bombo', 0.25 + 0.3 * u, 0.64 + pre); }
      if (saved) rplay('roar', 0.45, 0.4 + pre, 0.97);                                          // alivio: punto de set salvado
      rplay('applause', 0.22 + 0.5 * h + (e.setWon ? 0.25 : 0), 0.7 + pre);
      u = ramp01(h, 0.45, 0.85);
      if (u > 0 || e.setWon || saved) rplay('applause', 0.18 + 0.32 * u + (e.setWon || saved ? 0.15 : 0), 1.9 + pre, 0.97);
      if (streak >= 3 && !e.setWon) chant(hold, streak);
    } else {
      if (digs >= 2) rplay('ooh', 0.3 + 0.06 * Math.min(digs - 2, 2), 0, 1.02);               // admiración por la defensa
      rplay('groan', (error ? 0.55 + 0.45 * h : 0.3 + 0.3 * h) + (saved ? 0.25 : 0), 0.12 + pre, error ? 1 : 1.05);
      u = ramp01(h, 0.45, 0.85);
      if (u > 0 || e.setWon) rplay('applause', 0.2 + 0.35 * u + (e.setWon ? 0.1 : 0), 1.0 + pre);
    }
  }
  /** Racha local ≥ 3: palmas al unísono con bombo tras la ovación, en la rejilla de 0,42 s de las palmas del saque. Solo
   *  hasta poco antes de `serveReady` (point.hold); allí las palmas del saque local siguen la misma rejilla sin hueco. */
  function chant(hold, streak) {
    var t = now(), t0 = t + 1.2, k = 0, ramp = 0.38 + 0.05 * Math.min(streak - 3, 3);
    for (; k < 6 && 1.2 + k * CHANT_P < hold - 0.12; k++) {
      var b = k % 4, d = 1.2 + k * CHANT_P;
      if (b !== 3 && play('palmas', (ramp + k * 0.03) * 0.95, null, null, jit(0.04), 0, d, 'crowd')) react.layers++;
      if (b === 0 || b === 2) play('bombo', (ramp + k * 0.03) * 0.75, null, null, jit(0.02), 0.25, d, 'crowd');
    }
    chantT0 = t0; chantN = k; chantUntil = t + hold + 1.0; react.chant = k;
  }

  /* Presentación (UI-14, AUD-06) y cortinilla (UI-13). VB.Audio.sting('intro') al salir la tarjeta de presentación: firma
   * suave (bus de música, seco) + crescendo de grada (bus de grada), y el lecho de grada (murmullo + ánimo) se agacha a
   * INTRO_BED (-7 dB) mientras la tarjeta está en pantalla. Se suelta con VB.Audio.ui('introEnd') (la tarjeta se va y entra
   * el marcador: sin cortar nada, el lecho vuelve en ~1 s), VB.Audio.ui('introSkip') (saltada: la grada y la firma se apagan
   * en ~0,5 s), el primer silbato del saque (el pitido cae con la grada volviendo) o a los INTRO_MAX s. La ovación de
   * bienvenida de `newMatch` se programa 0,35 s tarde: si la presentación llega antes, se cancela sin sonar (el crescendo es
   * la bienvenida); si llega después de empezar, se deja (cortarla sonaría a corte). */
  // INTRO_DUCK: el lecho vuelve solo a los 3 s aunque la tarjeta siga, bajo la meseta del crescendo (que se apaga a los 3,6 s):
  // sin esto, una tarjeta larga dejaba un hueco (la grada parecía callarse con la tarjeta aún en pantalla)
  var intro = { on: false, t0: -9, until: 0, relUntil: 0, gS: null, gW: null }, INTRO_MAX = 6.5, INTRO_BED = 0.45, INTRO_DUCK = 3.0;
  var welcome = [], deferTag = 0, lastGain = null;
  function fadeGain(gn, tc) {
    if (!gn || !AC) return;
    try {
      var p = gn.gain, t0 = AC.currentTime;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t0); else { p.cancelScheduledValues(t0); p.setValueAtTime(p.value, t0); }
      p.setTargetAtTime(0, t0, tc);
    } catch (e) { }
  }
  function introStart() {
    if (!live()) return false;                    // antes del primer gesto: no-op (sin contexto no suena nada)
    var t = now();
    for (var k = 0; k < welcome.length; k++) if (welcome[k].at > t + 0.003) { try { welcome[k].src.stop(0); } catch (e) { } }
    welcome.length = 0;
    if (intro.on) introEnd('restart');
    intro.on = true; intro.t0 = t; intro.until = t + INTRO_MAX; intro.relUntil = t + INTRO_DUCK + 1.2; stats.intro++;
    var s1 = play('introSting', 0.85, null, null, 1, 0.1, 0.02, 'music'); intro.gS = s1 ? lastGain : null;
    var s2 = play('introSwell', 0.8, null, null, 1, 0, 0.06, 'crowd'); intro.gW = s2 ? lastGain : null;
    return true;
  }
  function introEnd(why) {
    if (!intro.on) return;
    intro.on = false; intro.relUntil = now() + 1.2;
    if (why === 'skip' || why === 'menu' || why === 'restart') { fadeGain(intro.gW, 0.15); fadeGain(intro.gS, why === 'skip' ? 0.3 : 0.1); }
    intro.gS = intro.gW = null;
  }
  function wipe() {
    if (!live()) return false;
    stats.wipe++;
    return !!playGap('wipe', 0.25, 0.6, null, null, jit(0.03), 0, 0, 'music');
  }
  /* ---------- AUD-08: hoja final y menús ----------
   * Cuenta de las cifras (UI-11, 600 ms con salida cúbica): ui('count', u, ts) en cada frame en que cambia alguna cifra (u = avance
   * 0..1; ts = sello del frame de rAF en ms, opcional: sin él, performance.now()). Cada tic suena YA (nada programado a futuro: ningún
   * tic puede sonar después de la cuenta) y los tics se espacian como las cifras: CNT_GAP s al principio y CNT_GAP + CNT_SLOW·u² al
   * final (50 → 150 ms: la cuenta se frena y los tics con ella; nunca más de 20 por segundo). El reloj es virtual (cubeta): un frame
   * que llega 2,5 ms antes no salta un tic, y la media nunca pasa del máximo. Suben de tono con el avance. u ≥ 1 (o ui('countEnd'))
   * = las cifras se posan: «clac» final, exactamente en ese frame.
   * Mientras la hoja final está a la vista (state 'over' tras la primera cifra o el MVP) la grada baja END_DUCK (foco en la hoja). */
  var CNT_GAP = 0.05, CNT_SLOW = 0.1, CNT_TOL = 0.0025, END_DUCK = 0.5;
  var cnt = { on: false, last: -9, n: 0, t0: 0 }, endFocus = false, mvpLast = -9, stingTeam = -1;
  function countTick(u, ts) {
    if (!live()) return false;
    u = isFinite(u) ? clamp(+u, 0, 1) : 0;
    if (u >= 1) return countEnd();
    var t = isFinite(ts) && ts > 0 ? ts / 1000 : perf.now() / 1000;
    if (!cnt.on || t < cnt.last - 1 || (t - cnt.last > 0.5 && u < 0.5 && t - cnt.t0 > 1)) { cnt.on = true; cnt.n = 0; cnt.t0 = t; cnt.last = -9; }   // cuenta nueva
    endFocus = true;
    var gap = CNT_GAP + CNT_SLOW * u * u, dt = t - cnt.last;
    if (dt < gap - CNT_TOL) return false;
    var src = play('cntTick', 0.5 + 0.22 * u, null, null, (0.94 + 0.16 * u) * jit(0.01), 0, 0, 'music');
    if (!src) return false;
    cnt.last = dt < gap ? cnt.last + gap : t; cnt.n++; stats.count = (stats.count | 0) + 1; stats.countAt = perf.now();
    return true;
  }
  function countEnd() {
    if (!live() || !cnt.on) return false;
    cnt.on = false; endFocus = true;
    var src = play('cntLock', 0.6, null, null, 1, 0.06, 0, 'music');
    if (src) { stats.countEnd = (stats.countEnd | 0) + 1; stats.countEndAt = perf.now(); }
    return !!src;
  }
  /** Revelación del MVP: ganó el humano (true) o la CPU (false); sin dato, el último partido ('match'). Anti-repetición 1,5 s. */
  function mvpReveal(win) {
    if (!live()) return false;
    var t = now(); if (t - mvpLast < 1.5) return false;
    var w = win == null ? stingTeam !== 1 : !!win;
    var src = play(w ? 'mvpWin' : 'mvpLose', 0.85, null, null, 1, 0.12, 0, 'music');
    if (src) { mvpLast = t; endFocus = true; stats.mvp = (stats.mvp | 0) + 1; }
    return !!src;
  }
  /* Flechas de la dificultad: la nota final del paso sigue al nivel de destino (semitonos sobre la base, de Fácil a Experto). */
  var LV_SEMI = [-5, -3, 0, 4];
  function levelRate(idx, n) {
    n = n > 1 ? n | 0 : 4; idx = isFinite(idx) ? clamp(Math.round(+idx), 0, n - 1) : 1;
    var x = n === 1 ? 0 : idx * 3 / (n - 1), i = Math.min(2, Math.floor(x)), f = x - i, st = LV_SEMI[i] + (LV_SEMI[i + 1] - LV_SEMI[i]) * f;
    return Math.pow(2, st / 12);
  }
  function uiMenu(kind, a, b) {
    if (!live()) return false;
    switch (kind) {
      case 'arrowHover': return !!playGap('arwHover', 0.04, 0.42, null, null, (a < 0 ? 0.9 : 1.12) * jit(0.02), 0, 0, 'music');
      case 'arrow': return !!play(a < 0 ? 'stepDown' : 'stepUp', 0.6, null, null, levelRate(b, arguments[3]), 0.05, 0, 'music');
      case 'arrowEdge': return !!playGap('arwEdge', 0.12, 0.6, null, null, a < 0 ? 0.94 : 1.06, 0, 0, 'music');
      case 'optHover': return !!playGap('optHover', 0.04, 0.42, null, null, jit(0.03), 0, 0, 'music');
      case 'toggle': return !!play(a ? 'tglOn' : 'tglOff', 0.6, null, null, 1, 0.04, 0, 'music');
      case 'select': {
        var n = b > 1 ? b | 0 : 2, i = isFinite(a) ? clamp(Math.round(+a), 0, n - 1) : 0;
        return !!play('optSel', 0.6, null, null, Math.pow(2, (i - (n - 1) / 2) * 2 / 12), 0.04, 0, 'music');
      }
      case 'slide': { var v = isFinite(a) ? clamp(+a, 0, 1) : 0.5; return !!playGap('cntTick', 0.04, 1.55, null, null, 0.8 + 0.4 * v, 0, 0, 'music'); }   // un tic suelto: -28 como un hover
    }
    return false;
  }
  /** Contacto de celebración (fx:*) o bote del ritual: SIEMPRE un sonido por evento (sin anti-repetición: dos choques a la
   *  vez de dos parejas distintas son dos sonidos). Por el pool de tiras. */
  function fxPlay(name, gain, x, y, rate, send) {
    stats.fxIn++;
    if (playPooled(name, gain, x, y, rate, send, 0)) stats.fxOut++;
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
  /* Sonidos programados a futuro que deben callarse si el saque se lanza antes de que suenen (latido, "toc"). */
  var future = [];
  function keepFuture(src, at) {
    if (!src) return;
    for (var k = future.length - 1; k >= 0; k--) if (future[k].at < now()) future.splice(k, 1);
    if (future.length < 8) future.push({ src: src, at: at });
  }
  /** Calla el "toc" y los latidos programados que aún no han sonado. Devuelve true si había un "toc" pendiente. */
  function cancelTick() {
    var t = now(), was = false;
    if (tickSrc && tickAt > t + 0.003) { try { tickSrc.stop(0); was = true; } catch (e) { } }
    tickSrc = null;
    for (var k = 0; k < future.length; k++) if (future[k].at > t + 0.003) { try { future[k].src.stop(0); } catch (e) { } }
    future.length = 0;
    return was;
  }
  function handleOne(e, g, longWhistle) {
    switch (e.type) {
      case 'hit': onHit(e, g); break;
      case 'block': { // result: 'stuff' (directo) | 'soft' (toque de bloqueo) | 'tool' (block-out)
        var res = e.result || 'stuff', stuff = res === 'stuff';
        if (stuff && e.human) { // bloqueo directo del humano: mismo tratamiento que el remate perfecto
          sweeten(1);
          play('blockHero', punchCap('blockHero', 1.0, evx(e), evy(e), PUNCH_CEIL_BLOCK), evx(e), evy(e), jit(0.06) * 0.95, 0.36, 0, 'punch');
        } else play('block', stuff ? 1.0 : res === 'tool' ? 0.8 : 0.6, evx(e), evy(e), jit(0.06) * (stuff ? 0.95 : 1.08), stuff ? 0.36 : 0.25);
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
        tension = 0;   // y el latido del punto de set/partido para: el gesto resuelve la tensión
        cancelTick();  // un "toc" del reloj ya programado que aún no ha sonado no debe sonar tras el lanzamiento
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
        // remate que revienta DENTRO: capa de tarima (golpe grave de la madera) que crece con la velocidad (13 → 22 m/s)
        if (e.inside === true && g && g.lastKind === 'spike' && s > 13) {
          var kw = clamp((s - 13) / 9, 0, 1);
          play('slamSub', (0.4 + 0.6 * kw) * (demo ? 0.5 : 1), e.x, e.y, jit(0.05) * (1.04 - 0.08 * kw), 0.12);
        }
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
        else { whistle('whistle', demo ? 0.3 : 0.5, 0); if (intro.on) introEnd('whistle'); } // el 1.er pitido suelta la presentación
        break;
      case 'point': crowdReact(e, g); break;
      case 'courtChange': // cambio de campo (18.2.1 / 18.2.2): silbato corto tras el del punto
        if (!demo) whistle('whistle', 0.32, e.why === 'eight' ? 1.0 : 2.7, 1.03);
        break;
      case 'serveReady':
        serveWait = 0; serveTeam = e.team; clapBeat = 0; clapNext = 0; rallyDigs = 0;
        // racha local (AUD-07): las palmas de la grada no se paran, siguen la rejilla del cántico tras la ovación
        if (e.team === 0 && !demo && chantN > 0 && now() < chantUntil) {
          var tn = now(); clapBeat = chantN; clapNext = chantT0 + chantN * CHANT_P;
          while (clapNext < tn + 0.03 && clapBeat < 24) { clapNext += CHANT_P; clapBeat++; }
          serveWait = 1;
        }
        chantN = 0;
        tension = demo ? 0 : e.matchPoint >= 0 ? 2 : e.setPoint >= 0 ? 1 : 0; beatNext = now() + 0.6;
        cancelTick(); tickNext = 3;
        break;
      // contactos cosméticos de la celebración (VB.Players.drainFx, repartidos por main.js como eventos 'fx:*')
      // AUD-05: un sonido por contacto, ganancia por `strength` (0..1), en la posición del contacto, por el pool de tiras
      case 'fx:highfive': fxPlay('slap', (demo ? 0.3 : 0.55) * (0.55 + 0.45 * fxS(e, 1)), e.x, e.y, jit(0.08) * (0.96 + 0.08 * fxS(e, 1)), 0.14); break;
      case 'fx:fistbump': fxPlay('fist', (demo ? 0.3 : 0.55) * (0.55 + 0.45 * fxS(e, 0.55)), e.x, e.y, jit(0.08), 0.1); break;
      case 'fx:chestbump': fxPlay('chest', (demo ? 0.3 : 0.6) * (0.6 + 0.4 * fxS(e, 1)), e.x, e.y, jit(0.06), 0.16); break;
      case 'fx:clap': fxPlay('handclap', (demo ? 0.25 : 0.5) * (0.5 + 0.5 * fxS(e, 0.6)), e.x, e.y, jit(0.06), 0.12); break;
      case 'fx:catch': fxPlay('set', (demo ? 0.15 : 0.3) * (0.6 + 0.4 * fxS(e, 0.6)), e.x, e.y, jit(0.06) * 0.78, 0.06); break; // el sacador recoge el bote (opcional)
      case 'dribble': { // ritual del sacador (SIM-04): bote en el parqué, más suave que un bote de peloteo
        stats.dribIn++;
        var dx = isFinite(e.x) ? e.x : evx(e), dy = isFinite(e.y) ? e.y : evy(e), dsp = isFinite(e.speed) ? clamp(e.speed / 6, 0.5, 1.4) : 1;
        if (playPooled('dribble', (demo ? 0.4 : 0.75) * (0.7 + 0.3 * dsp), dx, dy, jit(0.06) * (0.97 + 0.04 * dsp), 0.16, 0)) stats.dribOut++;
        break;
      }
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
        if (!demo && (e.team === 0 || e.team === 1)) stingTeam = e.team;
        if (!demo && !stingDone) { stingDone = true; play(e.team === 0 ? 'matchWin' : 'matchLose', e.team === 0 ? 1 : 0.75, null, null, 1, 0.12, 0.85, 'music'); }
        break;
      case 'gameOver':
        if (!demo && stingTeam < 0 && (e.team === 0 || e.team === 1)) stingTeam = e.team;
        if (!demo && !stingDone) { stingDone = true; play(e.team === 0 ? 'matchWin' : 'matchLose', e.team === 0 ? 1 : 0.75, null, null, 1, 0.12, 0, 'music'); }
        break;
      case 'newSet': if (!demo) play('applause', 0.45, null, null, 1, 0, 0.1, 'crowd'); break;
      case 'newMatch':
        stingDone = false;
        if (!e.demo && !demo && !(intro.on || now() - intro.t0 < 1.5)) {
          welcome.length = 0; deferTag = 1;
          var w1 = play('roar', 0.55, null, null, 1, 0, 0.35, 'crowd'); if (w1) welcome.push({ src: w1, at: now() + 0.35 });
          var w2 = play('applause', 0.6, null, null, 1, 0, 0.7, 'crowd'); if (w2) welcome.push({ src: w2, at: now() + 0.7 });
          deferTag = 0;
        }
        break;
      case 'switch': if (e.auto === false && !demo) play('hover', 0.27, null, null, 1.2, 0); break; // AUD-09: 0,3 → 0,27 al subir 1 dB el hover
      // 'sideout': ya lo cuentan el silbato y la grada; sin sonido propio
    }
  }

  if (root.__vbAudioWorker && typeof root.postMessage === 'function') workerMain(); // este módulo cargado como hilo de síntesis

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
    /** OPCIONAL (pruebas): estado interno del motor que no se ve en `stats`. */
    /** OPCIONAL (pruebas): copia de la lista de AudioBuffers del banco para `name` (null si aún no hay ninguno). */
    _bank: function (name) { return Object.prototype.hasOwnProperty.call(CATALOG, name) && bank[name] ? bank[name].slice() : null; },
    _debug: function () {
      var free = 0, t = now(); for (var k = 0; k < pool.length; k++) if (pool[k].end <= t) free++;
      return { slowRate: slowRate, lowT: lowT, tension: tension, tickNext: tickNext, duck: N.duck ? N.duck.gain.value : 1, crowdHp: N.crowdHp ? N.crowdHp.frequency.value : 0,
        react: react, intro: { on: intro.on, t0: intro.t0, left: intro.on ? Math.max(0, intro.until - t) : 0 }, pool: pool.length, poolFree: free, voices: voicesNow(),
        bed: N.murG ? N.murG.gain.value : 0, chant: { t0: chantT0, n: chantN, until: chantUntil },
        crowd: N.crowd ? N.crowd.gain.value : 0, endFocus: endFocus, count: { on: cnt.on, n: cnt.n }, stingTeam: stingTeam };
    },
    /** OPCIONAL (UI-14): estado de la presentación → {active, t (s desde que empezó; -1 sin presentación)}. */
    introInfo: function () { return { active: intro.on, t: intro.t0 > 0 ? now() - intro.t0 : -1 }; },
    /** OPCIONAL: voces sonando ahora (ranuras ocupadas; los lechos en bucle no cuentan). */
    voices: function () { return AC ? voicesNow() : 0; },
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
      // Con Worker la síntesis no usa el hilo principal: empieza antes (0,4 s; crearlo cuesta ~1 ms aquí).
      if (hasDoc && (root.requestIdleCallback || root.setTimeout)) startGen(root.Worker && !root.__vbAudioNoWorker ? 400 : 1200);
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
    /** ui('click'|'hover'|'back'|'start'|'wipe'|'intro'|'introEnd'|'introSkip').
     *  'wipe': cortinilla (UI-13), soplido de aire que cruza de izquierda a derecha con el pico a 0,15 s: llamarlo al EMPEZAR
     *  la cortinilla de 0,3 s centrada en el corte (anti-repetición 0,25 s: una llamada por cortinilla).
     *  'intro' = sting('intro'); 'introEnd': la tarjeta de presentación se va (el lecho de grada vuelve, nada se corta);
     *  'introSkip': la saltan (grada y firma se apagan en ~0,5 s). Otros nombres desconocidos: nada (antes, un clic).
     *  AUD-08 (hoja final, UI-11): 'count', u, ts — en cada frame de la cuenta en que cambia alguna cifra (u = avance 0..1, ts = sello
     *  de rAF en ms; tics de ≤ 20/s que se frenan con la cuenta y suben de tono; u ≥ 1 = «clac» final). 'countEnd' = el «clac» si la cuenta acaba sin un frame con u = 1. 'mvp', win —
     *  revelación del MVP (llamarlo al EMPEZAR la cuenta: el acento cae a 0,6 s, cuando se posan las cifras; win = ganó el humano).
     *  AUD-08 (menús): 'arrowHover', dir · 'arrow', dir, nivel, nNiveles (paso de dificultad; la nota sigue al nivel) · 'arrowEdge', dir
     *  (tope) · 'optHover' (fila de Ajustes) · 'toggle', on (Sí/No) · 'select', i, n (opción de varios valores) · 'slide', v (0..1). */
    ui: function (kind, a, b, c) {
      if (kind === 'hover') return VB.Audio.hover();
      if (kind === 'count') return countTick(a, b);
      if (kind === 'countEnd') return countEnd();
      if (kind === 'mvp') return mvpReveal(a);
      if (kind === 'arrowHover' || kind === 'arrow' || kind === 'arrowEdge' || kind === 'optHover' || kind === 'toggle' || kind === 'select' || kind === 'slide') return uiMenu(kind, a, b, c);
      if (kind === 'wipe') return wipe();
      if (kind === 'intro') return introStart();
      if (kind === 'introEnd' || kind === 'introSkip') return introEnd(kind === 'introSkip' ? 'skip' : 'end');
      if (kind && !(kind === 'click' || kind === 'back' || kind === 'start')) return;
      play(kind || 'click', 0.6, null, null, 1, 0, 0, 'music');
    },
    /** Reproduce cualquier sonido del catálogo (para otros módulos). x,y opcionales en coords de sim. */
    play: function (name, gain, x, y) {
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOG, name) || name === 'ir') return false;
      var bus = SCORES[name] ? 'music' : CATALOG[name].rate === 'low' ? 'crowd' : 'sfx';
      return !!play(name, gain == null || !isFinite(gain) ? 0.7 : gain, x == null || bus !== 'sfx' ? null : x, y, jit(0.06), bus === 'sfx' ? 0.15 : 0, 0, bus);
    },
    /** Ráfaga musical: 'setWin'|'setLose'|'matchWin'|'matchLose', o 'intro' (presentación del partido, AUD-06: firma suave +
     *  crescendo de grada + lecho agachado hasta ui('introEnd'|'introSkip'), el primer silbato o 6,5 s). Antes del primer gesto: no-op. */
    sting: function (name) {
      if (name === 'intro') return introStart();
      return !!(SCORES[name] && name !== 'introSting' && name !== 'mvpWin' && name !== 'mvpLose' && play(name, 0.9, null, null, 1, 0.12, 0, 'music'));
    },

    onGameStart: function (g) {
      endFocus = false; cnt.on = false; if (!(g && g.demo)) stingTeam = -1;
      demo = !!(g && g.demo); stingDone = false; excite = 0; exciteBoost = 0; lastSpikeTeam = -1; rallyDigs = 0; chantN = 0; chantUntil = 0;
      if (demo && intro.on) introEnd('menu');
      serveTeam = -1; tension = 0; clapNext = 0; tickNext = 0; cancelTick(); lowT = 0;
      for (var i = 0; i < 8; i++) { pvx[i] = pvy[i] = 0; scd[i] = 0.5; }
      applyVolumes(false);
    },
    onState: function (s) {
      // en pausa no debe sonar un "toc" ya programado (el reloj se para): se cancela y se vuelve a marcar al reanudar
      if (s === 'paused' && state !== 'paused' && cancelTick() && tickNext < 3) tickNext++;
      if (s === 'menu' && intro.on) introEnd('menu');
      if (s !== 'over') { endFocus = false; cnt.on = false; }
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
      // Hit-stop (cámara: timeScale 0 durante 35-70 ms y vuelta en 80 ms) ≠ cámara lenta (0,28-0,5 durante 0,8-1,9 s).
      // Solo cuenta como cámara lenta una bajada que dure SLOW_HOLD s reales y no sea una congelación (ts < FREEZE_TS): así el
      // chasquido y su cola suenan a tiempo real, sin que el filtro general se cierre a mitad del golpe ni la grada cambie de
      // tono durante el parón. Cuando entra, lo hace con las mismas rampas suaves (≥ 100 ms) de siempre: sin clics.
      var ts = vctx && isFinite(vctx.timeScale) ? vctx.timeScale : 1;
      if (ts < 0.95 && !paused) lowT += dt; else if (!paused) lowT = 0;
      var tsE = ts < 0.95 && ts >= FREEZE_TS && lowT >= SLOW_HOLD ? ts : 1;
      slowRate = tsE < 0.95 ? clamp(Math.sqrt(Math.max(0.05, tsE)), 0.6, 1) : 1;
      setParam(N.fx.frequency, 'fx', paused ? 650 : tsE < 0.95 ? 700 + 4000 * tsE : 20000, paused ? 0.06 : 0.12);
      setParam(N.sfx.gain, 'sfx', vol.sfx * (demo ? 0.35 : 1) * (paused ? 0.5 : 1), 0.08);
      if (N.punch) setParam(N.punch.gain, 'punch', punchGain(), 0.08);
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
      // hoja final a la vista (AUD-08): la grada baja -6 dB en ~0,35 s (a la salida, con el compresor, ~-3 dB) y vuelve al salir de 'over'
      var ef = endFocus && st === 'over';
      if (endFocus && st !== 'over' && st !== 'paused') endFocus = false;
      setParam(N.crowd.gain, 'crowd', vol.crowd * (paused ? 0.45 : 1) * (st === 'menu' ? 0.6 : 1) * (ef ? END_DUCK : 1), ef ? 0.35 : 0.15);
      // presentación (AUD-06): el lecho se agacha bajo la tarjeta (-7 dB, entra en ~0,3 s) y vuelve en ~1 s al soltarla
      if (intro.on && t > intro.until) introEnd('timeout');
      var ducked = intro.on && t < intro.t0 + INTRO_DUCK, bd = ducked ? INTRO_BED : 1, btc = ducked ? 0.3 : t < intro.relUntil ? 0.45 : 0;
      setParam(N.murG.gain, 'mur', Math.round((0.32 + 0.1 * (1 - excite)) * (tossHush > 0 ? 0.6 : 1) * bd * LEVEL_LIN.murmur * 400) / 400, btc || (tossHush > 0 ? 0.25 : 0.2));
      setParam(N.excG.gain, 'exc', Math.round(Math.max(0, excite - 0.12) * 0.75 * bd * LEVEL_LIN.excite * 400) / 400, btc || 0.15);
      var vn = voicesNow(); if (vn > stats.voicesMax) stats.voicesMax = vn;
      setParam(N.crowdTone.frequency, 'bright', Math.round(1500 + excite * 5000), 0.2);
      // saque en punto de partido / de set (antes del lanzamiento): la grada se adelgaza un poco (paso alto 220 / 170 Hz)
      var tens = tension && g && !demo && g.mode === 'serve' && g.serveState !== 'toss' && st === 'playing' ? tension : 0;
      if (N.crowdHp) setParam(N.crowdHp.frequency, 'chp', tens === 2 ? 220 : tens === 1 ? 170 : 20, tens ? 0.35 : 0.25);
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
        // latido "lub-dub": punto de partido (cada 0,9 s) o, más suave y lento, punto de set (×0,6, cada 1,0 s); para al lanzar
        // tras una pausa beatNext queda en el pasado: se resincroniza (si no, salía un latido por frame hasta alcanzar el reloj)
        if (beatNext && beatNext < t - 0.25) beatNext = t + 0.15;
        if (tens && bank.beat && beatNext && beatNext < t + 0.1) {
          var dd = Math.max(0, beatNext - t), bg = BEAT_GAIN[tens];
          keepFuture(play('beat', 0.6 * bg, null, null, 1, 0, dd), t + dd);
          keepFuture(play('beat', 0.4 * bg, null, null, 1.15, 0, dd + 0.22), t + dd + 0.22);
          beatNext += BEAT_PERIOD[tens];
        }
        // reloj de saque del humano: "toc" al cruzar 3, 2 y 1 s (el último, más brillante). Se programa con precisión de
        // muestra hasta TICK_AHEAD s antes del cruce; nunca para la CPU, ni antes del silbato, ni tras el lanzamiento.
        if (tickNext >= 1 && g.serveState === 'ready' && g.serveAuth && g.server && g.server.team === 0 && !g.autopilot &&
            !(g.opts && g.opts.serveClock === false) && isFinite(g.serveClock)) {
          var lead = g.serveClock - tickNext;
          if (lead < -0.25) tickNext = Math.ceil(g.serveClock - 1e-6);            // llega tarde (pausa, salto de frame): sin ráfaga
          else if (lead <= TICK_AHEAD) {
            var last1 = tickNext === 1, td = Math.max(0, lead);
            var ts1 = play('tick', last1 ? 0.62 : 0.5, null, null, last1 ? 1.22 : 1, 0, td, 'music');
            if (ts1) { tickSrc = ts1; tickAt = t + td; stats.ticks = (stats.ticks | 0) + 1; }
            tickNext--;
          }
        }
      } else { clapNext = 0; if (g.mode !== 'serve') tickNext = 0; }
    }
  };
})();
