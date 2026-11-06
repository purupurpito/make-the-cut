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
 *   sfx ──┐                                   ┌─> (compresor) ─> destino
 *   crowd ─> brillo ─┐                         │
 *   reverb (send) ───┴─> fxFilter (pausa/cámara lenta) ─> master ─┘
 *   music ────────────────────────────────────────────> master
 *
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
  function makeRng(seed) { // xorshift32 determinista; estado en Uint32Array para no crear números en el heap
    var st = new Uint32Array(1); st[0] = (seed >>> 0) || 0x2545F491;
    return function () { var s = st[0]; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; st[0] = s; return st[0] * 2.3283064365386963e-10; };
  }
  /** Biquad RBJ: 'lp' | 'hp' | 'bp' (0 dB en el pico). */
  function Biq(type, f, q, sr) { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, sr); }
  Biq.prototype.set = function (type, f, q, sr) {
    f = Math.max(10, Math.min(f, sr * 0.45));
    var w = TAU * f / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * (q || 0.707));
    var b0, b1, b2, a0 = 1 + a;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
  };
  Biq.prototype.p = function (x) {
    var y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  };
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
  /** normalize() troceado para buffers largos (grada, reverb). */
  function* normalizeG(chs, peak) {
    var m = 0, i, c, d;
    for (c = 0; c < chs.length; c++) { d = chs[c]; for (i = 0; i < d.length; i++) { var a = d[i] < 0 ? -d[i] : d[i]; if (a > m) m = a; if ((i & YB) === YB) yield 0; } }
    if (m < 1e-9) return chs;
    var k = peak / m;
    for (c = 0; c < chs.length; c++) { d = chs[c]; for (i = 0; i < d.length; i++) { d[i] *= k; if ((i & YB) === YB) yield 0; } }
    return chs;
  }
  /** loopify() troceado. */
  function* loopifyG(chs, sr, x) {
    var X = (x * sr) | 0, out = [];
    for (var c = 0; c < chs.length; c++) {
      var d = chs[c], n = d.length - X, o = d.slice(0, n);
      for (var i = 0; i < X; i++) { var k = i / X; o[i] = d[i] * Math.sqrt(k) + d[n + i] * Math.sqrt(1 - k); if ((i & YM) === YM) yield 0; }
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
    var ph = 0, ph2 = 0, ph3 = 0, j = 1 + (rng() - 0.5) * 0.08;
    var f0 = o.f0 * j, f1 = o.f1 * j, rf = (o.rf || 0) * (1 + (rng() - 0.5) * 0.05);
    var s2 = o.s2 ? (o.s2 * sr) | 0 : -1;
    // envolventes exponenciales incrementales (una multiplicación por muestra)
    var kP = Math.exp(-1 / (pt * sr)), kB = Math.exp(-1 / (bd * sr)), kH = Math.exp(-1 / (bd * 0.4 * sr)), kC = Math.exp(-1 / (cd * sr));
    var kS = Math.exp(-1 / (sd * sr)), kR = Math.exp(-1 / (rd * sr));
    var eP = 1, eB = ba, eH = ha, eC = ca, eS = sa, eS2 = sa2, eR = ra, wn = (wd * sr) | 0, wst = (wt * sr) | 0;
    for (var i = 0; i < n; i++) {
      var nz = rng() * 2 - 1;
      var f = f1 + (f0 - f1) * eP; eP *= kP;
      ph += TAU * f / sr;
      var y = Math.sin(ph) * eB; eB *= kB;
      if (ha) { ph3 += TAU * f * 2.3 / sr; y += Math.sin(ph3) * eH; eH *= kH; }
      y += cf.p(nz) * eC; eC *= kC;
      y += sf.p(nz) * eS; eS *= kS;
      if (s2 >= 0 && i >= s2) { y += sf2.p(rng() * 2 - 1) * eS2; eS2 *= kS; }
      if (rf) { ph2 += TAU * rf / sr; y += Math.sin(ph2) * eR; eR *= kR; }
      if (tail && i >= wst && i < wst + wn) { // silbido del aire detrás del balón (remate)
        var u = (i - wst) / wn;
        if (((i - wst) & 31) === 0) tail.set('bp', wf0 + (wf1 - wf0) * u, 1.4, sr);
        y += tail.p(nz) * wa * Math.sin(Math.PI * u);
      }
      d[i] = y;
      if ((i & YM) === YM) yield 0;
    }
    var chs = [d];
    if (o.drive) softclip(chs, o.drive);
    return edges(normalize(chs, o.peak || 0.9), sr, 0.0004, 0.01);
  }

  var IMPACTS = {
    // Recepción de antebrazos: "thump" redondo, grave, poco chasquido
    pass: { dur: 0.22, f0: 230, f1: 118, pt: 0.012, ba: 1, bd: 0.055, ha: 0.25, ct: 'lp', cf: 2600, ca: 0.55, cd: 0.005,
            sf: 750, sq: 0.9, sa: 0.45, sd: 0.028, rf: 640, ra: 0.12, rd: 0.03, peak: 0.9 },
    // Colocación de dedos: "pat" suave, doble contacto mínimo de las dos manos
    set: { dur: 0.12, f0: 520, f1: 360, pt: 0.008, ba: 0.35, bd: 0.022, ct: 'hp', cf: 2500, ca: 0.35, cd: 0.002,
           sf: 1700, sq: 1.3, sa: 0.7, sd: 0.014, s2: 0.006, sa2: 0.45, rf: 880, ra: 0.06, rd: 0.02, peak: 0.75 },
    // Balón libre / toque de seguridad
    free: { dur: 0.18, f0: 300, f1: 170, pt: 0.01, ba: 0.8, bd: 0.04, ct: 'lp', cf: 3500, ca: 0.5, cd: 0.004,
            sf: 1100, sq: 1, sa: 0.55, sd: 0.022, rf: 720, ra: 0.1, rd: 0.03, peak: 0.85 },
    // Saque: palmada firme de mano abierta con "pop"
    serve: { dur: 0.25, f0: 300, f1: 140, pt: 0.01, ba: 0.75, bd: 0.05, ct: 'hp', cf: 1800, ca: 0.9, cd: 0.004,
             sf: 2200, sq: 0.9, sa: 0.7, sd: 0.02, rf: 900, ra: 0.18, rd: 0.04,
             wa: 0.08, wf0: 1400, wf1: 700, wt: 0.03, wd: 0.2, drive: 1.4, peak: 0.92 },
    // Remate: CRACK seco (palmada saturada) + cuerpo + silbido del aire
    spike: { dur: 0.38, f0: 340, f1: 120, pt: 0.008, ba: 0.8, bd: 0.06, ha: 0.3, ct: 'hp', cf: 1300, ca: 1.6, cd: 0.0035,
             sf: 3000, sq: 0.7, sa: 1.1, sd: 0.017, s2: 0.0015, sa2: 0.5, rf: 1100, ra: 0.22, rd: 0.05,
             wa: 0.16, wf0: 2200, wf1: 600, wt: 0.025, wd: 0.32, drive: 2.6, peak: 0.98 },
    // Bloqueo: golpe sordo "ahogado", dos manos casi a la vez
    block: { dur: 0.3, f0: 210, f1: 82, pt: 0.018, ba: 1, bd: 0.08, ct: 'lp', cf: 2200, ca: 0.7, cd: 0.006,
             sf: 1000, sq: 0.8, sa: 0.8, sd: 0.03, s2: 0.011, sa2: 0.7, rf: 520, ra: 0.12, rd: 0.05, drive: 1.8, peak: 0.95 },
    // Bote en el parqué durante el rally
    land: { dur: 0.35, f0: 150, f1: 62, pt: 0.02, ba: 1, bd: 0.1, ha: 0.2, ct: 'lp', cf: 4500, ca: 0.8, cd: 0.005,
            sf: 1400, sq: 0.7, sa: 0.6, sd: 0.03, rf: 185, ra: 0.3, rd: 0.14, peak: 0.95 },
    // Remate que revienta contra el suelo
    slam: { dur: 0.5, f0: 170, f1: 52, pt: 0.025, ba: 1.2, bd: 0.13, ha: 0.3, ct: 'hp', cf: 1500, ca: 1.4, cd: 0.005,
            sf: 1600, sq: 0.6, sa: 1.0, sd: 0.035, rf: 175, ra: 0.4, rd: 0.18, drive: 2.2, peak: 1 },
    // Botes de balón muerto
    bounce: { dur: 0.2, f0: 190, f1: 90, pt: 0.015, ba: 0.9, bd: 0.05, ct: 'lp', cf: 3500, ca: 0.6, cd: 0.004,
              sf: 1300, sq: 0.8, sa: 0.45, sd: 0.02, rf: 200, ra: 0.2, rd: 0.07, peak: 0.85 },
    // Pies del atleta al aterrizar
    feet: { dur: 0.16, f0: 95, f1: 48, pt: 0.02, ba: 1, bd: 0.05, ct: 'lp', cf: 900, ca: 0.6, cd: 0.01,
            sf: 500, sq: 0.8, sa: 0.3, sd: 0.02, s2: 0.018, sa2: 0.25, peak: 0.8 },
    // Bombo de la grada
    bombo: { dur: 0.6, f0: 120, f1: 50, pt: 0.03, ba: 1.1, bd: 0.18, ct: 'lp', cf: 1800, ca: 0.45, cd: 0.008,
             sf: 300, sq: 0.8, sa: 0.3, sd: 0.04, peak: 0.95 },
    // Latido (punto de partido): "lub" grave y apagado
    beat: { dur: 0.25, f0: 70, f1: 40, pt: 0.03, ba: 1, bd: 0.07, ct: 'lp', cf: 400, ca: 0.3, cd: 0.01, peak: 0.9 }
  };

  /** Red: cinta/cable que vibra + traqueteo de la malla (granos) + sacudida. */
  function* genNet(tape, rng, sr) {
    var dur = 0.75, n = Math.ceil(dur * sr), d = new Float32Array(n);
    var mesh = new Biq('bp', 520, 1.1, sr), g1 = new Biq('bp', 1800, 2, sr), thw = new Biq('bp', 700, 0.9, sr);
    var ph = 0, ph2 = 0, gEnv = 0, kG = Math.exp(-1 / (0.003 * sr));
    var eD = 1, kD = Math.exp(-1 / (0.08 * sr)), eA = 1, kA = Math.exp(-1 / (0.25 * sr)), eM = 0.5, kM = Math.exp(-1 / (0.12 * sr));
    var eC = 0.35, kC = Math.exp(-1 / (0.3 * sr)), eT = tape ? 1.3 : 0, kT = Math.exp(-1 / (0.022 * sr)), w2 = TAU * 197 / sr;
    for (var i = 0; i < n; i++) {
      var nz = rng() * 2 - 1;
      // granos de la malla: densidad que decae de ~500/s a ~15/s
      if (rng() < (15 + 480 * eD) / sr) { gEnv = (0.4 + rng() * 0.6) * eA * 1.6; g1.set('bp', 1000 + rng() * 2400, 2.5, sr); }
      eD *= kD; eA *= kA;
      var y = g1.p(nz) * gEnv; gEnv *= kG;
      y += mesh.p(nz) * eM; eM *= kM;
      if ((i & 15) === 0) ph2 = TAU * (96 + 2 * Math.sin(i * 31 / sr)) / sr; // vibrato del cable
      ph += ph2;
      var at = i < 0.004 * sr ? i / (0.004 * sr) : 1;
      y += (Math.sin(ph) * eC + Math.sin(w2 * i) * eC * 0.34) * at; eC *= kC;
      if (eT > 1e-4) { y += thw.p(nz) * eT; eT *= kT; }
      d[i] = y;
      if ((i & YM) === YM) yield 0;
    }
    return edges(normalize([d], 0.85), sr, 0.0005, 0.05);
  }

  /** Silbato de árbitro: dos tonos (cámaras) + trino del guisante + aliento. */
  function* genWhistle(dur, rng, sr) {
    var tot = dur + 0.12, n = Math.ceil(tot * sr), d = new Float32Array(n);
    var br = new Biq('bp', 3100, 3, sr), air = new Biq('hp', 1500, 0.7, sr);
    var fA = 2950 + rng() * 120, fB = fA * 1.17, p1 = 0, p2 = 0, p3 = 0, tp = 0;
    var trF = 26 + rng() * 8;
    for (var i = 0; i < n; i++) {
      var t = i / sr, nz = rng() * 2 - 1;
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
      if ((i & YM) === YM) yield 0;
    }
    return edges(normalize([d], 0.8), sr, 0.002, 0.02);
  }

  /** Chirrido de zapatilla sobre parqué (stick-slip). */
  function* genSqueak(rng, sr) {
    var dur = 0.07 + rng() * 0.1, n = Math.ceil(dur * sr), d = new Float32Array(n);
    var bp = new Biq('bp', 2600, 0.8, sr), hp = new Biq('hp', 3500, 0.7, sr);
    var f0 = 1500 + rng() * 1700, glide = (rng() - 0.4) * 0.5, ph = 0, ss = 30 + rng() * 25;
    for (var i = 0; i < n; i++) {
      var t = i / sr, u = t / dur, nz = rng() * 2 - 1;
      var f = f0 * (1 + glide * u) * (1 + 0.06 * Math.sin(TAU * ss * t) + 0.03 * nz);
      ph += TAU * f / sr;
      var env = Math.min(1, t / 0.008) * (1 - u) * Math.sqrt(1 - u);
      var y = (Math.sin(ph) * 0.6 + Math.sin(2 * ph) * 0.3 + Math.sin(3 * ph) * 0.15) * env;
      d[i] = bp.p(y) * 1.4 + hp.p(nz) * 0.12 * env;
      if ((i & YM) === YM) yield 0;
    }
    return edges(normalize([d], 0.8), sr, 0.001, 0.008);
  }

  /** Arrastre de zapatilla al despegar. */
  function* genScuff(rng, sr) {
    var dur = 0.09, n = Math.ceil(dur * sr), d = new Float32Array(n), hp = new Biq('bp', 3200, 0.6, sr), ph = 0;
    for (var i = 0; i < n; i++) {
      var t = i / sr, nz = rng() * 2 - 1; ph += TAU * (90 - t * 300) / sr;
      d[i] = hp.p(nz) * Math.exp(-t / 0.025) * 0.8 + Math.sin(ph) * 0.5 * Math.exp(-t / 0.03);
      if ((i & YM) === YM) yield 0;
    }
    return edges(normalize([d], 0.7), sr, 0.002, 0.01);
  }

  /** Brazo en el aire (golpe al vacío). */
  function* genWhoosh(rng, sr) {
    var dur = 0.26, n = Math.ceil(dur * sr), d = new Float32Array(n), bp = new Biq('bp', 700, 1.5, sr);
    for (var i = 0; i < n; i++) {
      var t = i / sr, u = t / dur;
      if ((i & 31) === 0) bp.set('bp', 600 + 1400 * Math.sin(Math.PI * Math.min(1, u * 1.3)), 1.5, sr);
      var sn = Math.sin(Math.PI * u);
      d[i] = bp.p(rng() * 2 - 1) * sn * sn * (1 - 0.4 * (1 - sn));
      if ((i & YM) === YM) yield 0;
    }
    return edges(normalize([d], 0.7), sr, 0.002, 0.01);
  }

  /** Plancha: el cuerpo cae y se desliza por el parqué (golpe + fricción de piel/tela). */
  function* genSlide(rng, sr) {
    var dur = 0.45, n = Math.ceil(dur * sr), d = new Float32Array(n), bp = new Biq('bp', 1100, 0.6, sr), lp = new Biq('lp', 500, 0.7, sr), ph = 0;
    var eB = 1, kB = Math.exp(-1 / (0.06 * sr));
    for (var i = 0; i < n; i++) {
      var u = i / n, nz = rng() * 2 - 1;
      ph += TAU * (70 - 25 * u) / sr;
      var fr = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (0.75 + 0.25 * Math.sin(i * 0.004)); // fricción que crece y se apaga
      d[i] = Math.sin(ph) * eB * 1.1 + lp.p(nz) * eB * 0.9 + bp.p(nz) * 0.45 * fr * (1 - u * 0.6); eB *= kB;
      if ((i & YM) === YM) yield 0;
    }
    return edges(normalize([d], 0.85), sr, 0.001, 0.04);
  }
  /** Destello sutil de "toque perfecto" (solo golpes del humano): dos parciales de campana. */
  function* genPerfect(rng, sr) {
    var dur = 0.32, n = Math.ceil(dur * sr), d = new Float32Array(n), w1 = TAU * 2093 / sr, w2 = TAU * 3136 / sr, e = 1, ke = Math.exp(-1 / (0.07 * sr));
    for (var i = 0; i < n; i++) { d[i] = (Math.sin(w1 * i) * 0.6 + Math.sin(w2 * i) * 0.4 * (i > 0.035 * sr ? 1 : 0)) * e; e *= ke; if ((i & YM) === YM) yield 0; }
    return edges(normalize([d], 0.6), sr, 0.0015, 0.02);
  }

  /** Interfaz: clic con cuerpo y "hover" cristalino. */
  function* genUi(kind, rng, sr) {
    var dur = kind === 'hover' ? 0.05 : kind === 'back' ? 0.09 : kind === 'start' ? 0.32 : 0.07;
    var n = Math.ceil(dur * sr), d = new Float32Array(n), hp = new Biq('hp', 3000, 0.7, sr), ph = 0, ph2 = 0;
    for (var i = 0; i < n; i++) {
      var t = i / sr, nz = rng() * 2 - 1, f, y;
      if (kind === 'hover') { ph += TAU * 2100 / sr; y = Math.sin(ph) * 0.3 * Math.exp(-t / 0.012); }
      else if (kind === 'back') { f = 900 - t * 3000; ph += TAU * f / sr; y = Math.sin(ph) * 0.6 * Math.exp(-t / 0.03); }
      else if (kind === 'start') { // dos notas ascendentes con brillo
        f = t < 0.08 ? 784 : 1175; ph += TAU * f / sr; ph2 += TAU * f * 2 / sr;
        var tt = t < 0.08 ? t : t - 0.08; y = (Math.sin(ph) * 0.6 + Math.sin(ph2) * 0.15) * Math.exp(-tt / (t < 0.08 ? 0.05 : 0.12));
      } else { f = 1250 - t * 3500; ph += TAU * f / sr; ph2 += TAU * 2600 / sr; y = Math.sin(ph) * 0.6 * Math.exp(-t / 0.018) + Math.sin(ph2) * 0.12 * Math.exp(-t / 0.006); }
      d[i] = y + hp.p(nz) * 0.35 * Math.exp(-t / 0.0015);
      if ((i & YM) === YM) yield 0;
    }
    return edges(normalize([d], kind === 'hover' ? 0.45 : 0.75), sr, 0.0003, 0.005);
  }

  /* ---------- Público (estéreo, 22 050 Hz: la grada no necesita más agudos) ----------
   * Se genera por "planes": una lista de pasos cortos (una voz por paso) que el
   * motor ejecuta repartidos en varios ticks para no congelar el menú en móvil. */

  /** Una voz de público = (ruido + pulso glotal) por dos formantes, con envolvente
   *  silábica propia y posición estéreo aleatoria. o.sweep(t, out[2]) opcional
   *  multiplica F1/F2 con el tiempo (lamento descendente, "uuuh"). */
  var SW = [1, 1];
  function* crowdVoice(o, rng, sr, L, R) {
    var n = L.length, q = o.q, pitched = o.pitched, depth = o.depth, syl = o.syll, sweep = o.sweep || null;
    var pglide = o.pglide || 0, stagger = o.stagger || 0;
    var F1 = o.f1[0] + rng() * (o.f1[1] - o.f1[0]), F2 = o.f2[0] + rng() * (o.f2[1] - o.f2[0]);
    var b1 = new Biq('bp', F1, q, sr), b2 = new Biq('bp', F2, q * 1.3, sr);
    var pan = rng() * 2 - 1, gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    var amp = 0.5 + rng(), pf = o.pitch[0] + rng() * (o.pitch[1] - o.pitch[0]), ph = rng();
    var env = 0, tgt = rng(), nextChange = 0;
    var smooth = 1 - Math.exp(-1 / (sr * (syl > 0 ? 0.25 / syl : 0.4)));
    var vib = 4 + rng() * 3, vibA = 0.02 + rng() * 0.03, start = stagger ? (rng() * stagger * sr) | 0 : 0, inc = pf / sr;
    var aN = 1 - pitched;
    for (var i = start; i < n; i++) {
      if ((i & 31) === 0) {
        var t = i / sr;
        inc = pf * (1 + vibA * Math.sin(TAU * vib * t)) * (1 + pglide * t) / sr;
        if (sweep && (i & 127) === 0) { sweep(t, SW); b1.set('bp', F1 * SW[0], q, sr); b2.set('bp', F2 * SW[1], q * 1.3, sr); }
      }
      if (syl > 0 && i >= nextChange) { tgt = rng() < 0.25 ? 0 : 0.3 + rng() * 0.7; nextChange = i + sr * (0.5 + rng()) / syl; }
      env += (tgt - env) * smooth;
      ph += inc; if (ph >= 1) ph -= 1;
      var src = (rng() * 2 - 1) * aN + (2 * ph - 1) * pitched;
      var y = (b1.p(src) + 0.55 * b2.p(src)) * amp * (1 - depth + depth * env);
      L[i] += y * gl; R[i] += y * gr;
      if ((i & YM) === YM) yield 0;
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
    if (o.env) for (i = 0; i < n; i++) { var e = o.env(i / sr); L[i] *= e; R[i] *= e; if ((i & 8191) === 8191) yield 0; }
    if (o.loop) return yield* normalizeG(yield* loopifyG(chs, sr, o.loop), o.peak);
    yield* normalizeG(chs, o.peak);
    return edges(chs, sr, 0.004, o.fade || 0.15);
  }
  /** Silbidos de aficionados (dedos en la boca): glissandos agudos. */
  function* addFanWhistles(L, R, count, t0, t1, rng, sr, amp) {
    for (var w = 0; w < count; w++) {
      var st = (t0 + rng() * (t1 - t0)) * sr | 0, dur = (0.35 + rng() * 0.5) * sr | 0, f0 = 2100 + rng() * 900;
      var up = rng() < 0.5, pan = rng(), ph = 0;
      for (var i = 0; i < dur && st + i < L.length; i++) {
        var u = i / dur, f = up ? f0 * (0.85 + 0.25 * Math.sin(Math.PI * u * 0.7)) : f0 * (1.1 - 0.25 * u);
        ph += TAU * f / sr;
        var y = Math.sin(ph) * amp * Math.sin(Math.PI * u) * (0.8 + 0.2 * Math.sin(TAU * 6 * u));
        L[st + i] += y * (1 - pan); R[st + i] += y * pan;
        if ((i & YM) === YM) yield 0;
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
    var ks = clapKernels(sr), n = L.length, blk = 32 / sr, nb = 0, work = 0;
    for (var t = t0; t < t1; t += blk) {
      // cede cada ~64 bloques o cada ~6000 muestras de palmadas mezcladas (lo que llegue antes)
      if (++nb >= 64 || work > 6000) { nb = 0; work = 0; yield 0; }
      var expect = rate * (decay ? Math.exp(-Math.max(0, t - decay[0]) / decay[1]) : 1) * blk;
      while (expect > 0) {
        if (rng() < expect) {
          var k = ks[(rng() * ks.length) | 0], st = ((t + rng() * blk) * sr) | 0, pan = rng(), a = amp * (0.3 + rng() * 0.7);
          for (var i = 0; i < k.length && st + i < n; i++) { L[st + i] += k[i] * a * (1 - pan); R[st + i] += k[i] * a * pan; }
          work += k.length;
        }
        expect -= 1;
      }
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
        env: function (t) { return Math.min(1, t / 0.12) * (t < 0.7 ? 1 : Math.exp(-(t - 0.7) / 1.1)); },
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
        env: function (t) { return Math.min(1, t / 0.16) * (t < 0.5 ? 1 : Math.exp(-(t - 0.5) / 0.55)); } }, rng, sr);
    },
    // "Uuuh" de expectación (defensa imposible, balón que roza la línea)
    ooh: function (rng, sr) {
      return crowdPlan({ dur: 1.3, peak: 0.8, fade: 0.1, layers: [
        { voices: 16, f1: [340, 460], f2: [700, 950], q: 2.2, syll: 0, depth: 0, pitched: 0.5, pitch: [160, 360], pglide: 0.05, stagger: 0.06,
          sweep: function (t, o) { var k = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) * 0.25; o[0] = 0.9 + 0.15 * k; o[1] = 0.92 + 0.12 * k; } }],
        env: function (t) { return Math.min(1, t / 0.2) * (t < 0.35 ? 1 : Math.exp(-(t - 0.35) / 0.35)); } }, rng, sr);
    },
    // Aplauso (decae)
    applause: function* (rng, sr) {
      var n = Math.ceil(3.2 * sr), L = new Float32Array(n), R = new Float32Array(n);
      yield* addClaps(L, R, 0, 0.8, 110, rng, sr, 0.5, [0.9, 0.8]);
      yield* addClaps(L, R, 0.8, 1.6, 110, rng, sr, 0.5, [0.9, 0.8]);
      yield* addClaps(L, R, 1.6, 2.4, 110, rng, sr, 0.5, [0.9, 0.8]);
      yield* addClaps(L, R, 2.4, 3.2, 110, rng, sr, 0.5, [0.9, 0.8]);
      var c = [L, R], lp = [new Biq('lp', 6000, 0.7, sr), new Biq('lp', 6000, 0.7, sr)];
      for (var ch = 0; ch < 2; ch++) for (var i = 0; i < n; i++) { c[ch][i] = lp[ch].p(c[ch][i]) * Math.min(1, i / (0.08 * sr)); if ((i & 8191) === 8191) yield 0; }
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
      return edges(normalize([L, R], 0.8), sr, 0.0005, 0.03);
    }
  };

  /** Impulso de reverberación de pabellón (~1.8 s), estéreo. */
  function* genIR(rng, sr) {
    var dur = 1.8, n = Math.ceil(dur * sr), L = new Float32Array(n), R = new Float32Array(n), pre = (0.018 * sr) | 0;
    var lpL = 0, lpR = 0, e = 1, ke = Math.exp(-1 / (0.3 * sr)), kk = Math.exp(-1 / (0.35 * sr)), lk = 1;
    for (var i = pre; i < n; i++) {
      var k = 0.15 + 0.8 * lk; lk *= kk; // se oscurece con el tiempo
      lpL += ((rng() * 2 - 1) - lpL) * k; lpR += ((rng() * 2 - 1) - lpR) * k;
      L[i] = lpL * e; R[i] = lpR * e; e *= ke;
      if ((i & YM) === YM) yield 0;
    }
    for (var r = 0; r < 7; r++) { // primeras reflexiones (suelo, paredes, techo)
      var at = ((0.02 + rng() * 0.07) * sr) | 0, a = 0.5 * (1 - r / 8);
      L[at] += a * (rng() < 0.5 ? 1 : -1); R[at + ((rng() * 0.004 * sr) | 0)] += a * (rng() < 0.5 ? 1 : -1);
    }
    yield* normalizeG([L, R], 0.5);
    // Normalización del ConvolverNode (potencia RMS; GainCalibration -58 dB a 44,1 kHz, como Chrome/WebKit/Firefox)
    // aplicada aquí: así el motor usa normalize = false y el nodo no recorre la IR en el hilo principal.
    var ss = 0;
    for (i = 0; i < n; i++) { ss += L[i] * L[i] + R[i] * R[i]; if ((i & YB) === YB) yield 0; }
    var pw = Math.max(0.000125, Math.sqrt(ss / (2 * n)) || 0), sc = 0.0012589254 / pw * 44100 / sr;
    for (i = 0; i < n; i++) { L[i] *= sc; R[i] *= sc; if ((i & YB) === YB) yield 0; }
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
    var i1 = f * 1.003 / sr, i2 = f * 0.997 / sr, i3 = f * 0.5 / sr, vb = 1;
    for (var i = 0; i < n && st + i < L.length; i++) {
      var a = Math.min(1, i / (0.025 * sr)); if (i > dn) rel *= kr;
      var env = a * (0.75 + 0.25 * e15) * rel; e15 *= k15; e30 *= k30;
      if ((i & 31) === 0) { lp.set('lp', 500 + 3400 * env * (0.6 + 0.4 * e30), 1.1, sr); vb = 1 + 0.003 * Math.sin(TAU * 5.2 * i / sr) * Math.min(1, i / (0.3 * sr)); }
      p1 += i1 * vb; p2 += i2 * vb; p3 += i3 * vb;
      if (p1 >= 1) p1 -= 1; if (p2 >= 1) p2 -= 1; if (p3 >= 1) p3 -= 1;
      var y = lp.p((2 * p1 - 1) + (2 * p2 - 1) + 0.3 * Math.sin(TAU * p3)) * env * amp;
      L[st + i] += y * 0.9; R[st + i] += y * 0.75;
      if ((i & YM) === YM) yield 0;
    }
  }
  /** Campana FM (destellos). */
  function* bell(L, R, sr, f, t0, amp, pan) {
    var st = (t0 * sr) | 0, n = (1.4 * sr) | 0, w = TAU * f / sr, I = 2.2, kI = Math.exp(-1 / (0.15 * sr)), e = amp, ke = Math.exp(-1 / (0.4 * sr));
    for (var i = 0; i < n && st + i < L.length; i++) {
      var y = Math.sin(w * i + I * Math.sin(w * 3.5 * i)) * e * Math.min(1, i / (0.002 * sr)); I *= kI; e *= ke;
      L[st + i] += y * (1 - pan); R[st + i] += y * pan;
      if ((i & YM) === YM) yield 0;
    }
  }
  /** Piano eléctrico suave (derrota). */
  function* epiano(L, R, sr, f, t0, dur, amp) {
    var st = (t0 * sr) | 0, n = Math.ceil((dur + 0.6) * sr), w = TAU * f / sr, dn = (dur * sr) | 0;
    var e = amp, ke = Math.exp(-1 / ((dur * 0.9 + 0.2) * sr)), m = 0.8, km = Math.exp(-1 / (0.3 * sr)), h = 0.15, kh = Math.exp(-1 / (0.2 * sr)), r = 1, kr = Math.exp(-1 / (0.2 * sr));
    for (var i = 0; i < n && st + i < L.length; i++) {
      if (i > dn) r *= kr;
      var y = (Math.sin(w * i + m * Math.sin(w * i)) + h * Math.sin(2 * w * i)) * e * r * Math.min(1, i / (0.01 * sr));
      e *= ke; m *= km; h *= kh;
      var s5 = 0.1 * Math.sin(5 * i / sr);
      L[st + i] += y * (1 + s5); R[st + i] += y * (1 - s5);
      if ((i & YM) === YM) yield 0;
    }
  }
  function* boom(L, R, sr, t0, amp, rng) {
    var st = (t0 * sr) | 0, n = (0.9 * sr) | 0, ph = 0, e1 = 1, k1 = Math.exp(-1 / (0.05 * sr)), e2 = amp, k2 = Math.exp(-1 / (0.35 * sr)), e3 = 0.3 * amp, k3 = Math.exp(-1 / (0.02 * sr));
    for (var i = 0; i < n && st + i < L.length; i++) {
      ph += TAU * (48 + 40 * e1) / sr; e1 *= k1;
      var y = Math.sin(ph) * e2 + (rng() * 2 - 1) * e3; e2 *= k2; e3 *= k3;
      L[st + i] += y; R[st + i] += y;
      if ((i & YM) === YM) yield 0;
    }
  }
  function* crash(L, R, sr, t0, amp, rng) {
    var st = (t0 * sr) | 0, n = (2 * sr) | 0, hp = new Biq('hp', 5000, 0.7, sr), hp2 = new Biq('hp', 4000, 0.7, sr), e = amp, ke = Math.exp(-1 / (0.6 * sr));
    for (var i = 0; i < n && st + i < L.length; i++) { L[st + i] += hp.p(rng() * 2 - 1) * e; R[st + i] += hp2.p(rng() * 2 - 1) * e; e *= ke; if ((i & YM) === YM) yield 0; }
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
  var AC = null, N = {}, bank = {}, jobs = [], jobTimer = null, built = 0, total = 0;
  var pend = [];                      // sonidos ya sintetizados (Float32) a la espera de tener AudioContext
  var genStarted = false, delayT = null;
  var GUESS_RATE = 48000;             // frecuencia supuesta antes del gesto (la habitual); solo la reverb exige la exacta
  var muted = false, hidden = false, state = 'menu', demo = true, reverbOn = true;
  var vol = { master: 0.9, sfx: 1, music: 0.75, crowd: 0.85 };
  var MAX_VOICES = 32, ends = new Float64Array(40), slowRate = 1;
  var last = {};                      // nombre -> último instante (anti-amontonado)
  var stats = { played: {}, skipped: 0, built: 0, synth: 0, total: 0, genMs: 0, steps: 0, maxStepMs: 0, maxStep: '', maxSliceMs: 0, slow: [], hist: new Uint32Array(41), // hist[k]: pasos de k/4..(k+1)/4 ms (el último: ≥ 10 ms)
                startedAt: -1, synthDoneAt: -1, unlockAt: -1, bankDoneAt: -1, reverbAt: -1 };
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
    // en partido solo huecos libres (timeout largo); en menú/pausa se fuerza antes si no hay huecos
    var playing = state === 'playing' && !demo;
    if (root.requestIdleCallback) jobTimer = root.requestIdleCallback(runJobs, { timeout: playing ? 250 : 60 });
    else if (st) jobTimer = st(runJobs, playing ? 24 : 16);
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
    // Presupuesto: hueco libre real si lo hay (requestIdleCallback), menos 1 ms de margen para no rozar el
    // siguiente frame; si el navegador fuerza la llamada (timeout) o no hay rIC, solo ~2-3 ms.
    var t0 = perf.now(), idle = deadline && deadline.timeRemaining && !deadline.didTimeout;
    var budget = idle ? clamp(deadline.timeRemaining() - 1, 1, 8) : (root.requestIdleCallback ? 2 : 3);
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

  function ensure() {
    if (AC) return AC;
    var Ctor = root.AudioContext || root.webkitAudioContext; if (!Ctor) return null;
    try { AC = new Ctor({ latencyHint: 'interactive' }); } catch (e) { try { AC = new Ctor(); } catch (e2) { AC = null; return null; } }
    try {
      N.comp = AC.createDynamicsCompressor();
      N.comp.threshold.value = -14; N.comp.knee.value = 10; N.comp.ratio.value = 4.5; N.comp.attack.value = 0.003; N.comp.release.value = 0.22;
      N.comp.connect(AC.destination);
      N.master = AC.createGain(); N.master.gain.value = 0; N.master.connect(N.comp);
      N.fx = AC.createBiquadFilter(); N.fx.type = 'lowpass'; N.fx.frequency.value = 20000; N.fx.Q.value = 0.5; N.fx.connect(N.master);
      N.sfx = AC.createGain(); N.sfx.gain.value = vol.sfx; N.sfx.connect(N.fx);
      N.crowdTone = AC.createBiquadFilter(); N.crowdTone.type = 'lowpass'; N.crowdTone.frequency.value = 2500; N.crowdTone.Q.value = 0.4;
      N.crowdTone.connect(N.fx);
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
    var list = bank[name]; if (!list || !list.length) { stats.skipped++; return null; }
    var t = AC.currentTime + (delay || 0), slot = -1, lim = bus === 'music' ? ends.length : MAX_VOICES;
    for (var k = 0; k < lim; k++) if (ends[k] <= t) { slot = k; break; }
    if (slot < 0) { stats.skipped++; return null; }
    try {
      var buf = list[(Math.random() * list.length) | 0];
      var src = AC.createBufferSource(); src.buffer = buf;
      var r = (rate || 1) * (bus === 'music' ? 1 : slowRate);
      src.playbackRate.value = r;
      var g = AC.createGain(); g.gain.value = gain;
      src.connect(g);
      var out = g;
      if (px != null) {
        spatial(px, py); g.gain.value = gain * SP_ATT;
        if (AC.createStereoPanner && SP_PAN) { var p = AC.createStereoPanner(); p.pan.value = SP_PAN; g.connect(p); out = p; }
      }
      out.connect(bus === 'music' ? N.music : bus === 'crowd' ? N.crowd : N.sfx);
      if (send > 0 && reverbOn) { var s = AC.createGain(); s.gain.value = send; out.connect(s); s.connect(N.revIn); }
      src.start(t);
      ends[slot] = t + buf.duration / r + 0.02;
      stats.played[name] = (stats.played[name] || 0) + 1;
      return src;
    } catch (e) { return null; }
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
        if (e.reason === 'point') play(longWhistle ? 'whistleEnd' : 'whistleLong', demo ? 0.35 : 0.55, null, null, jit(0.02), 0.45);
        else play('whistle', demo ? 0.3 : 0.5, null, null, jit(0.02), 0.45);
        break;
      case 'point': crowdReact(e, g); break;
      case 'courtChange': // cambio de campo (18.2.1 / 18.2.2): silbato corto tras el del punto
        if (!demo) play('whistle', 0.32, null, null, jit(0.02) * 1.03, 0.45, e.why === 'eight' ? 1.0 : 2.7);
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
      case 'switch': if (e.auto === false && !demo) play('hover', 0.5, null, null, 1.2, 0); break;
      // 'sideout': ya lo cuentan el silbato y la grada; sin sonido propio
    }
  }

  /* ------------------------------------------------------------------
   * 5. API pública
   * ------------------------------------------------------------------ */
  VB.Audio = {
    /** Sonidos del catálogo (tests y audición). */
    SOUNDS: Object.keys(CATALOG),
    /** synth(name, variant, ctxSampleRate) -> [Float32Array...]: genera sin WebAudio. */
    synth: synth,
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
      var bus = SCORES[name] ? 'music' : CATALOG[name] && CATALOG[name].rate === 'low' ? 'crowd' : 'sfx';
      return !!play(name, gain == null ? 0.7 : gain, x == null || bus !== 'sfx' ? null : x, y, jit(0.06), bus === 'sfx' ? 0.15 : 0, 0, bus);
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
      setParam(N.murG.gain, 'mur', Math.round((0.32 + 0.1 * (1 - excite)) * (tossHush > 0 ? 0.6 : 1) * 200) / 200, tossHush > 0 ? 0.25 : 0.2);
      setParam(N.excG.gain, 'exc', Math.round(Math.max(0, excite - 0.12) * 0.75 * 200) / 200, 0.15);
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
