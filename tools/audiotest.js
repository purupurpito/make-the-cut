#!/usr/bin/env node
/* VOLEY 3D — tools/audiotest.js   (owner: audio)
 *
 * Nobody can listen during the build, so the audio is MEASURED.
 *
 *  1. Synth: every sound of js/audio.js (all variants) is synthesised in node and measured:
 *     sample peak, true peak (4x oversampled), RMS, K-weighted loudness (ITU-R BS.1770 filter;
 *     integrated with gates for long sounds, momentary-max 400 ms for one-shots), spectral centroid,
 *     high-frequency share, duration, edge clicks (first/last sample, first-ms slope), clicks anywhere
 *     inside the sound (2nd difference vs local RMS; net/netTape grains allowlisted), DC offset, NaN.
 *     WAVs go to tools/out/audio/<name>.wav (variant 0) so a human can listen later.
 *  2. Mix plan: the real engine runs in node against a mock AudioContext that records the graph.
 *     Representative game events (a pass, a spike, a whistle, a home point...) are fed to
 *     VB.Audio.handle()/update(); every BufferSource that starts is rendered through the gains,
 *     filters and stereo panners it is connected to (reverb returns and the master compressor
 *     excluded) and measured in LUFS at the mix bus. Each scenario has a target per category;
 *     PASS = within ±1.5 LU. Stereo balance (L-R) is reported too.
 *  3. Match: a real Chrome renders a full match mix offline (OfflineAudioContext, suspended every
 *     768 samples to step the real sim and feed its events to the real engine, compressor included).
 *     Three deterministic passes (full mix, whistle stem, crowd stem) give: loudness over time,
 *     sample/true peaks, clipping, voice counts and whistle-vs-crowd masking in the whistle band.
 *     The full mix is written to tools/out/audio/match.wav.
 *
 * Usage:  node tools/audiotest.js [options]
 *   --file <path>     audio.js to test (default js/audio.js)
 *   --before <path>   also test that file and print a before/after table
 *   --secs <n>        match length in Chrome (default 60)   --seed <n> sim seed (default 7)
 *   --no-chrome       skip part 3      --no-wav   do not write WAVs     --json <path> dump results
 *   --synth-only      part 1 only      --only a,b  restrict part 1 to these sounds (quick sound design)
 *   --calibrate       print the LEVEL table for js/audio.js that puts every scenario on its target
 * Exits 1 if a sound has NaN, peaks over 1, edge or inner clicks, a mix target miss, a clip in the match
 * or a masked whistle.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'out', 'audio');
const argv = process.argv.slice(2);
function opt(k, d) { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; }
const has = k => argv.includes(k);
const FILE = path.resolve(ROOT, opt('--file', 'js/audio.js'));
const BEFORE = opt('--before', null) && path.resolve(ROOT, opt('--before'));
const SECS = +opt('--secs', 60), SEED = +opt('--seed', 7);

/* ====================================================================
 * Metrics (pure; also injected into the Chrome page as source text)
 * ==================================================================== */
function METRICS() {
  const TAU = Math.PI * 2;
  function biquad(b0, b1, b2, a0, a1, a2) { return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }; }
  function runBq(c, x) {
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  /** BS.1770 K-weighting for any sample rate (shelf + RLB high-pass, analog prototypes as in libebur128/pyloudnorm). */
  function kCoefs(sr) {
    let G = 3.999843853973347, f0 = 1681.974450955533, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    const sh = biquad((Vh + Vb * K / Q + K * K), 2 * (K * K - Vh), (Vh - Vb * K / Q + K * K), a0, 2 * (K * K - 1), (1 - K / Q + K * K));
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
    const hp = biquad(1, -2, 1, 1, 2 * (K * K - 1) / (1 + K / Q + K * K), (1 - K / Q + K * K) / (1 + K / Q + K * K));
    hp.a1 = 2 * (K * K - 1) / (1 + K / Q + K * K); hp.a2 = (1 - K / Q + K * K) / (1 + K / Q + K * K);
    return [sh, hp];
  }
  function kWeight(x, sr) { const c = kCoefs(sr); return runBq(c[1], runBq(c[0], x)); }
  const LU = p => p > 1e-20 ? -0.691 + 10 * Math.log10(p) : -120;
  /** Mean-square blocks of the K-weighted channels summed (channel weights 1). win/hop in s. */
  function blocks(chs, sr, win, hop) {
    const kw = chs.map(c => kWeight(c, sr)), n = chs[0].length, W = Math.round(win * sr), H = Math.round(hop * sr), out = [];
    // pad: a sound shorter than the window is measured inside one zero-padded window (BS.1770 momentary)
    const last = Math.max(0, n - W);
    for (let s = 0; s <= last + 1e-9; s += H) {
      let p = 0;
      for (const k of kw) { let a = 0; const e = Math.min(n, s + W); for (let i = s; i < e; i++) a += k[i] * k[i]; p += a / W; }
      out.push(p);
      if (n <= W) break;
    }
    return out;
  }
  /** Integrated loudness (400 ms blocks, 75 % overlap, -70 LUFS absolute gate, -10 LU relative gate). */
  function integrated(chs, sr) {
    const b = blocks(chs, sr, 0.4, 0.1);
    let g = b.filter(p => LU(p) > -70); if (!g.length) return -120;
    const rel = LU(g.reduce((a, c) => a + c, 0) / g.length) - 10;
    g = g.filter(p => LU(p) > rel); if (!g.length) return -120;
    return LU(g.reduce((a, c) => a + c, 0) / g.length);
  }
  function momentaryMax(chs, sr) { return LU(Math.max.apply(null, blocks(chs, sr, 0.4, 0.01))); }
  function shortTerm(chs, sr, hop) { return blocks(chs, sr, 3, hop || 1).map(LU); }
  /** True peak: 4x oversampling with a 48-tap-per-phase windowed sinc (BS.1770-4 annex 2 style). */
  const TP = (function () {
    const P = 4, T = 12, ph = [];
    for (let p = 0; p < P; p++) {
      const h = new Float32Array(2 * T);
      for (let k = -T + 1; k <= T; k++) {
        const t = k - p / P, w = 0.5 + 0.5 * Math.cos(Math.PI * t / (T + 1));
        h[k + T - 1] = (Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * w;
      }
      ph.push(h);
    }
    return { P, T, ph };
  })();
  function truePeak(chs) {
    let m = 0;
    for (const x of chs) {
      const n = x.length;
      for (let i = 0; i < n; i++) {
        const a = Math.abs(x[i]); if (a > m) m = a;
        for (let p = 1; p < TP.P; p++) {
          const h = TP.ph[p]; let s = 0;
          for (let k = 0; k < h.length; k++) { const j = i + k - TP.T + 1; if (j >= 0 && j < n) s += x[j] * h[k]; }
          if (s > m) m = s; else if (-s > m) m = -s;
        }
      }
    }
    return m;
  }
  function peak(chs) { let m = 0; for (const x of chs) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; }
  function rms(chs) { let s = 0, n = 0; for (const x of chs) { for (let i = 0; i < x.length; i++) s += x[i] * x[i]; n += x.length; } return Math.sqrt(s / Math.max(1, n)); }
  function dc(chs) { let m = 0; for (const x of chs) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; m = Math.max(m, Math.abs(s / x.length)); } return m; }
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -TAU / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  /** Power spectrum summed over Hann frames (mono mix of the channels). Returns {pow, binHz}. */
  function spectrum(chs, sr, N) {
    N = N || 2048; const n = chs[0].length, H = N / 2, pow = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
    for (let s = 0; s < Math.max(1, n - H); s += H) {
      for (let i = 0; i < N; i++) { let v = 0; for (const c of chs) v += (c[s + i] || 0); re[i] = v * (0.5 - 0.5 * Math.cos(TAU * i / N)); im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
    }
    return { pow, binHz: sr / N };
  }
  /** Spectral centroid (magnitude weighted) and share of energy above 6 kHz / below 150 Hz. */
  function spectral(chs, sr) {
    const sp = spectrum(chs, sr, 2048); let sm = 0, sw = 0, tot = 0, hi = 0, lo = 0;
    for (let k = 1; k < sp.pow.length; k++) {
      const f = k * sp.binHz, p = sp.pow[k], m = Math.sqrt(p);
      sm += m; sw += m * f; tot += p; if (f > 6000) hi += p; if (f < 150) lo += p;
    }
    return { centroid: sw / Math.max(1e-12, sm), hf: hi / Math.max(1e-20, tot), lf: lo / Math.max(1e-20, tot) };
  }
  /** Edge clicks: |first|,|last| sample and the largest step in the first/last ms, relative to the peak. */
  function clicks(chs, sr) {
    const pk = Math.max(1e-9, peak(chs)); let edge = 0, slope = 0; const W = Math.max(2, Math.round(0.001 * sr));
    for (const x of chs) {
      const n = x.length; edge = Math.max(edge, Math.abs(x[0]), Math.abs(x[n - 1]));
      for (let i = 1; i < Math.min(W, n); i++) slope = Math.max(slope, Math.abs(x[i] - x[i - 1]), Math.abs(x[n - i] - x[n - i - 1]));
    }
    return { edge: edge / pk, edgeAbs: edge, slope: slope / pk };
  }
  /** Clicks anywhere in the sound: |2nd difference| (emphasises > ~8 kHz) against the local RMS of the
   *  2nd difference in a +-5 ms window (centre +-2 samples excluded). A hit is |d2| > 0.02 and > 8x local.
   *  Same rule as the round-1 verifier's wavcheck.js, so a pass here means a pass there. */
  function innerClicks(chs, sr) {
    let worst = 0, at = 0, cnt = 0; const W = Math.round(0.005 * sr);
    for (const x of chs) {
      const n = x.length, d = new Float64Array(n), cs = new Float64Array(n + 1);
      for (let i = 1; i < n - 1; i++) d[i] = Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]);
      for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + d[i] * d[i];
      for (let i = 2; i < n - 2; i++) {
        if (d[i] <= 0.02) continue;
        const a = Math.max(0, i - W), b = Math.min(n, i + W);
        const e = cs[b] - cs[a] - (cs[Math.min(n, i + 3)] - cs[Math.max(0, i - 2)]), m = Math.max(1, b - a - 5);
        const ratio = d[i] / Math.max(Math.sqrt(Math.max(0, e) / m), 1e-4);
        if (ratio > 8) cnt++;
        if (ratio > worst) { worst = ratio; at = i / sr; }
      }
    }
    return { worst, at, cnt };
  }
  /** Energy of a band [f0,f1] in a window (s) via FFT of the whole window (mono sum). */
  function bandEnergy(chs, sr, t0, t1, f0, f1) {
    const a = Math.max(0, Math.round(t0 * sr)), b = Math.min(chs[0].length, Math.round(t1 * sr)); if (b - a < 64) return 0;
    let N = 1; while (N < b - a) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = a; i < b; i++) { let v = 0; for (const c of chs) v += c[i]; re[i - a] = v * (0.5 - 0.5 * Math.cos(TAU * (i - a) / (b - a))); }
    fft(re, im); let e = 0; const bin = sr / N;
    for (let k = Math.ceil(f0 / bin); k <= Math.floor(f1 / bin) && k < N / 2; k++) e += re[k] * re[k] + im[k] * im[k];
    return e;
  }
  /** Small speaker (phone/laptop): 4th-order high-pass at 250 Hz. Returns the filtered channels. */
  function smallSpeaker(chs, sr) {
    const K = Math.tan(Math.PI * 250 / sr), q = Math.SQRT1_2, n0 = 1 / (1 + K / q + K * K);
    const c = biquad(1, -2, 1, 1, 2 * (K * K - 1) * n0, (1 - K / q + K * K) * n0); c.b0 = n0; c.b1 = -2 * n0; c.b2 = n0;
    return chs.map(x => runBq(c, runBq(c, x)));
  }
  const db = v => v > 1e-12 ? 20 * Math.log10(v) : -240;
  return { smallSpeaker, kWeight, integrated, momentaryMax, shortTerm, truePeak, peak, rms, dc, spectral, spectrum, clicks, innerClicks, bandEnergy, LU, db, blocks };
}
const M = METRICS();
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;

/* ====================================================================
 * WAV writer (16-bit PCM)
 * ==================================================================== */
function wav(file, chs, sr) {
  const n = chs[0].length, C = chs.length, buf = Buffer.alloc(44 + n * C * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * C * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(C, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * C * 2, 28);
  buf.writeUInt16LE(C * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * C * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) { const v = Math.max(-1, Math.min(1, chs[c][i])); buf.writeInt16LE(Math.round(v * 32767), o); o += 2; }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf);
}

/* ====================================================================
 * Load a copy of audio.js in node (fresh VB each time)
 * ==================================================================== */
function loadAudio(file) {
  const src = fs.readFileSync(file, 'utf8');
  const VB = {}; const sandboxRoot = { VB };
  // the module does: root = window || globalThis; VB = root.VB. Run it with a private globalThis-like object.
  const fn = new Function('window', 'globalThis', 'document', src);
  const g = Object.create(globalThis); g.VB = VB;
  fn.call(g, undefined, g, undefined);
  return { VB, root: g, sandboxRoot };
}

/* ====================================================================
 * Part 1: per-sound synthesis metrics
 * ==================================================================== */
function synthReport(file, writeWav) {
  const { VB } = loadAudio(file); const A = VB.Audio, rows = [];
  const ONLY = opt('--only', '') ? opt('--only').split(',') : null;
  for (const name of A.SOUNDS) {
    if (name === 'ir' || (ONLY && !ONLY.includes(name))) continue;
    const sr = A.synthRate(name, 48000);
    for (let v = 0; v < 6; v++) {
      const t0 = Date.now(); const chs = A.synth(name, v, 48000); const ms = Date.now() - t0;
      if (!chs) break;
      // variants beyond the catalogue repeat with new seeds; only measure what the engine builds
      const nan = chs.some(c => c.some(x => !isFinite(x)));
      const dur = chs[0].length / sr, sp = M.spectral(chs, sr), ck = M.clicks(chs, sr), ic = M.innerClicks(chs, sr);
      rows.push({ name, v, sr, ch: chs.length, dur: r2(dur), peak: M.peak(chs), tp: M.truePeak(chs), rms: M.rms(chs),
        I: dur >= 1 ? M.integrated(chs, sr) : null, Mmax: M.momentaryMax(chs, sr), phone: M.momentaryMax(chs, sr) - M.momentaryMax(M.smallSpeaker(chs, sr), sr), centroid: Math.round(sp.centroid), hf: sp.hf, lf: sp.lf,
        edge: ck.edge, slope: ck.slope, click: ic.cnt, clickWorst: ic.worst, clickAt: ic.at, dc: M.dc(chs), nan, ms, loop: LOOPS.includes(name), seam: seamOf(chs) });
      if (writeWav && v === 0) wav(path.join(OUT, name + '.wav'), chs, sr);
      if (v + 1 >= variantsOf(A, name)) break;
    }
  }
  return rows;
}
const LOOPS = ['murmur', 'excite'];
/** Sounds whose short transients are the sound itself (net cord/tape rattle grains): innerClicks not enforced. */
const CLICK_GRAINS = ['net', 'netTape'];
/** Loop seam: jump across the wrap (last→first sample) relative to the typical sample-to-sample step. */
function seamOf(chs) { let w = 0; for (const x of chs) { let st = 0; for (let i = 1; i < x.length; i++) st += Math.abs(x[i] - x[i - 1]); st /= x.length - 1; w = Math.max(w, Math.abs(x[0] - x[x.length - 1]) / Math.max(1e-9, st) / 10); } return w; }
function variantsOf(A, name) { return (A.VARIANTS && A.VARIANTS[name]) || ({ pass: 3, set: 3, free: 3, serve: 3, spike: 3, block: 3, land: 3, slam: 3, bounce: 3, feet: 3, net: 2, netTape: 2, whistle: 2, whistleLong: 2, squeak: 5, scuff: 2, whoosh: 2, slide: 2, roar: 2 })[name] || 1; }

/* ====================================================================
 * Part 2: mix plan through a mock AudioContext
 * ==================================================================== */
const MOCK_SR = 48000;
function makeMock() {
  const started = [];
  class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } exponentialRampToValueAtTime(v) { this.value = v; } cancelScheduledValues() { } cancelAndHoldAtTime() { } }
  class Node { constructor(ctx, type) { this.context = ctx; this.type0 = type; this.outs = []; } connect(d) { this.outs.push(d); return d; } disconnect() { this.outs = []; } }
  class Buf { constructor(c, n, sr) { this.numberOfChannels = c; this.length = n; this.sampleRate = sr; this.duration = n / sr; this.d = []; for (let i = 0; i < c; i++) this.d.push(new Float32Array(n)); } copyToChannel(a, c) { this.d[c].set(a); } getChannelData(c) { return this.d[c]; } }
  class Ctx {
    constructor() { this.sampleRate = MOCK_SR; this.currentTime = 0; this.state = 'running'; this.destination = new Node(this, 'dest'); }
    createBuffer(c, n, sr) { return new Buf(c, n, sr); }
    createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
    createBiquadFilter() { const n = new Node(this, 'biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); return n; }
    createDynamicsCompressor() { const n = new Node(this, 'comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
    createWaveShaper() { const n = new Node(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; }
    createConvolver() { const n = new Node(this, 'conv'); n.normalize = true; n.buffer = null; return n; }
    createDelay() { const n = new Node(this, 'delay'); n.delayTime = new Param(0); return n; }
    createStereoPanner() { const n = new Node(this, 'pan'); n.pan = new Param(0); return n; }
    createBufferSource() {
      const n = new Node(this, 'src'), ctx = this; n.buffer = null; n.loop = false; n.playbackRate = new Param(1); n.detune = new Param(0);
      n.start = function (w, off) { started.push({ src: n, when: w || ctx.currentTime, at: ctx.currentTime }); }; n.stop = function () { }; return n;
    }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  return { Ctx, started };
}
/** Renders one started source through the graph to the destination (stereo). Reverb (convolvers) and the compressor's
 *  dynamics are excluded; gains, biquads (lowpass/highpass, WebAudio Q in dB) and StereoPanner are applied. */
function renderSource(s, Biq) {
  const b = s.src.buffer; if (!b) return null;
  const outL = new Float32Array(b.length), outR = new Float32Array(b.length);
  let reached = false;
  function walk(node, chs) {
    for (const d of node.outs) {
      let c = chs;
      switch (d.type0) {
        case 'gain': c = chs.map(x => x.map(v => v * d.gain.value)); break;
        case 'biquad': {
          const q = Math.pow(10, d.Q.value / 20);
          if (d.type === 'peaking' && Math.abs(d.gain.value) < 0.01) break; // flat
          c = chs.map(x => { const f = d.type === 'peaking' ? new Biq('peak', d.frequency.value, d.Q.value, b.sampleRate, d.gain.value) : new Biq(d.type === 'highpass' ? 'hp' : 'lp', d.frequency.value, q, b.sampleRate); const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = f.p(x[i]); return y; });
          break;
        }
        case 'pan': {
          const p = Math.max(-1, Math.min(1, d.pan.value));
          if (chs.length === 1) { const x = (p + 1) / 2, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2); c = [chs[0].map(v => v * gl), chs[0].map(v => v * gr)]; }
          else if (p <= 0) { const x = p + 1, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2); c = [chs[0].map((v, i) => v + chs[1][i] * gl), chs[1].map(v => v * gr)]; }
          else { const gl = Math.cos(p * Math.PI / 2), gr = Math.sin(p * Math.PI / 2); c = [chs[0].map(v => v * gl), chs[1].map((v, i) => v + chs[0][i] * gr)]; }
          break;
        }
        case 'conv': continue;
        case 'shaper': {
          if (d.curve) { const cv = d.curve, L = cv.length - 1; c = chs.map(x => x.map(v => { const u = (Math.max(-1, Math.min(1, v)) + 1) / 2 * L, i = Math.min(L - 1, Math.floor(u)), f = u - i; return cv[i] * (1 - f) + cv[i + 1] * f; })); }
          break;
        }
        case 'dest': {
          reached = true;
          const L = c[0], R = c.length > 1 ? c[1] : c[0];
          for (let i = 0; i < L.length; i++) { outL[i] += L[i]; outR[i] += R[i]; }
          continue;
        }
        case 'comp': { const g = compMakeup(d); c = chs.map(x => x.map(v => v * g)); break; }
        default: break; // delay: pass through
      }
      walk(d, c);
    }
  }
  walk(s.src, b.d);
  return reached ? { L: outL, R: outR, sr: b.sampleRate } : null;
}
/** Small-signal gain of a DynamicsCompressorNode = its automatic makeup gain (Chrome/WebKit always apply it).
 *  Measured in Chrome with a 1 kHz sine at -40 dBFS (tools/out/audio/compmeasure.js). Gain reduction itself is not
 *  modelled here: part 3 renders the real compressor. */
const MAKEUP_DB = { '-14,10,4.5': 4.42, '-10,8,4': 2.91, '-12,10,3': 2.88, '-8,6,4': 2.45 };
function compMakeup(d) {
  const k = [d.threshold.value, d.knee.value, d.ratio.value].join(',');
  if (!(k in MAKEUP_DB)) { console.log('WARNING: compressor ' + k + ' not measured; assuming 0 dB makeup'); MAKEUP_DB[k] = 0; }
  return Math.pow(10, MAKEUP_DB[k] / 20);
}
/** Minimal RBJ biquad for the mock (same maths as audio.js). */
function Biq(type, f, q, sr, gdb) {
  f = Math.max(10, Math.min(f, sr * 0.45)); const w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * (q || 0.707));
  let a0 = 1 + a, b0, b1, b2;
  if (type === 'peak') { const A = Math.pow(10, (gdb || 0) / 40); b0 = 1 + a * A; b1 = -2 * c; b2 = 1 - a * A; a0 = 1 + a / A; this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a / A) / a0; this.x1 = this.x2 = this.y1 = this.y2 = 0; return; }
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = a; b1 = 0; b2 = -a; }
  this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0; this.x1 = this.x2 = this.y1 = this.y2 = 0;
}
Biq.prototype.p = function (x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; };

/* Loudness plan (LUFS at the OUTPUT for signals under the compressor threshold: gains, filters, panners and the
 * compressor's automatic makeup gain are included, its gain reduction is not; stereo sum; positional sounds measured on
 * the home court ~8 m in front of the camera). 'metric': M = momentary max (one-shots), I = integrated (beds, long). */
const PLAN = {
  ui: { target: -24, desc: 'menu clicks' }, uiSoft: { target: -28, desc: 'hover / player switch' },
  touch: { target: -18, desc: 'pass, free ball, float serve' }, touchSoft: { target: -21, desc: 'set, tip (fingertips)' }, spike: { target: -14, desc: 'spike, jump serve' },
  impact: { target: -15, desc: 'stuff block, spike slamming the floor' }, ball: { target: -18, desc: 'ball on the floor, net' },
  whistle: { target: -16, desc: 'referee whistle' }, foley: { target: -24, desc: 'sneakers, steps, arm swing' },
  deadBall: { target: -26, desc: 'dead-ball bounces' }, bed: { target: -26, desc: 'crowd beds (murmur + excitement)' },
  react: { target: -20, desc: 'crowd reactions (roar, groan, applause)' }, chant: { target: -22, desc: 'stand claps + bass drum, heartbeat' },
  sting: { target: -16, desc: 'set / match stings' }, glint: { target: -26, desc: '"perfect" glint' }
};
const HOME = { x: 6, y: 1.5 }, CAM = { x: 14, y: 0, z: 0 };
function hitE(kind, extra) { return Object.assign({ type: 'hit', kind, x: HOME.x, y: HOME.y, z: 2, quality: 0.8, speed: 10, power: 0.5, human: false, grade: 'good', team: 0, touch: 1, t: 10 }, extra || {}); }
const P0 = { x: HOME.x, y: HOME.y, z: 0, team: 0, lastAction: '' };
const SCEN = [
  { id: 'pass', cat: 'touch', only: ['pass'], ev: [hitE('pass')] },
  { id: 'set', cat: 'touchSoft', only: ['set'], ev: [hitE('set', { touch: 2 })] },
  { id: 'free', cat: 'touch', only: ['free'], ev: [hitE('free', { touch: 3 })] },
  { id: 'serve float', cat: 'touch', only: ['serve'], ev: [hitE('serve', { shot: 'float', speed: 14, touch: 0, x: 9.5 })] },
  { id: 'spike', cat: 'spike', only: ['spike'], ev: [hitE('spike', { touch: 3, speed: 22 })] },
  { id: 'jump serve', cat: 'spike', only: ['spike'], ev: [hitE('serve', { shot: 'jump', speed: 20, touch: 0, x: 9.5 })] },
  { id: 'block stuff', cat: 'impact', only: ['block'], ev: [{ type: 'block', result: 'stuff', x: 0.3, y: 1, z: 3, team: 1, player: { x: -0.4, y: 1, z: 0.5, team: 1 } }] },
  { id: 'slam (spike lands)', cat: 'impact', only: ['slam'], g: { lastKind: 'spike' }, ev: [{ type: 'land', x: HOME.x, y: HOME.y, inside: true, team: 0, speed: 16 }] },
  { id: 'land', cat: 'ball', only: ['land'], g: { lastKind: 'free' }, ev: [{ type: 'land', x: HOME.x, y: HOME.y, inside: true, team: 0, speed: 8 }] },
  { id: 'net', cat: 'ball', only: ['net'], ev: [{ type: 'net', x: 0, y: 1, z: 2.2, tape: false }] },
  { id: 'net tape', cat: 'ball', only: ['netTape'], ev: [{ type: 'net', x: 0, y: 1, z: 2.4, tape: true }] },
  { id: 'whistle serve', cat: 'whistle', only: ['whistle'], ev: [{ type: 'whistle', reason: 'serve' }] },
  { id: 'whistle point', cat: 'whistle', only: ['whistleLong'], ev: [{ type: 'whistle', reason: 'point' }] },
  { id: 'whistle end', cat: 'whistle', only: ['whistleEnd'], ev: [{ type: 'whistle', reason: 'point' }, { type: 'point', team: 1, setWon: true, reason: 'in', rallyHits: 3 }] },
  { id: 'squeak', cat: 'foley', only: ['squeak'], ev: [{ type: 'dive', player: P0, x: HOME.x, y: HOME.y }], tries: 30 },
  { id: 'jump scuff', cat: 'foley', only: ['scuff'], ev: [{ type: 'jump', player: P0 }] },
  { id: 'feet (landing)', cat: 'foley', only: ['feet'], ev: [{ type: 'landPlayer', player: P0 }] },
  { id: 'swing whoosh', cat: 'foley', only: ['whoosh'], ev: [{ type: 'swing', player: P0, shot: '' }] },
  { id: 'dive slide', cat: 'foley', only: ['slide'], ev: [{ type: 'dive', player: P0, x: HOME.x, y: HOME.y }] },
  { id: 'dead bounce', cat: 'deadBall', only: ['bounce'], ev: [{ type: 'bounce', x: HOME.x, y: HOME.y, speed: 3 }] },
  { id: 'roar (home kill)', cat: 'react', only: ['roar'], ev: [{ type: 'point', team: 0, reason: 'in', how: 'kill', rallyHits: 4, lastKind: 'spike' }] },
  { id: 'groan (home error)', cat: 'react', only: ['groan'], ev: [{ type: 'point', team: 1, reason: 'out', how: 'error', rallyHits: 3 }] },
  { id: 'applause (home point)', cat: 'react', only: ['applause'], ev: [{ type: 'point', team: 0, reason: 'in', how: 'kill', rallyHits: 4, lastKind: 'spike' }] },
  { id: 'ooh (dig)', cat: 'react', only: ['ooh'], ev: [hitE('spike', { team: 1, t: 10 }), hitE('pass', { team: 0, t: 10.6 })] },
  { id: 'setWin sting', cat: 'sting', only: ['setWin'], ev: [{ type: 'set', team: 0, sets: [1, 0] }] },
  { id: 'setLose sting', cat: 'sting', only: ['setLose'], ev: [{ type: 'set', team: 1, sets: [0, 1] }] },
  { id: 'matchWin sting', cat: 'sting', only: ['matchWin'], ev: [{ type: 'match', team: 0 }] },
  { id: 'matchLose sting', cat: 'sting', only: ['matchLose'], ev: [{ type: 'match', team: 1 }] },
  { id: 'perfect glint', cat: 'glint', only: ['perfect'], ev: [hitE('pass', { human: true, grade: 'perfect' })] },
  { id: 'click', cat: 'ui', api: A => A.click() }, { id: 'ui back', cat: 'ui', api: A => A.ui('back') },
  { id: 'ui start', cat: 'ui', api: A => A.ui('start') }, { id: 'hover', cat: 'uiSoft', api: A => A.hover() },
  { id: 'switch tick', cat: 'uiSoft', ev: [{ type: 'switch', auto: false }] },
  { id: 'claps + drum (home serve)', cat: 'chant', update: 'serve', only: ['palmas', 'bombo'] },
  { id: 'heartbeat (match point)', cat: 'chant', update: 'mp', only: ['beat'] },
  { id: 'crowd bed (rally, 4 hits)', cat: 'bed', update: 'rally', only: ['murmur', 'excite'] },
  { id: 'crowd bed (home serve)', cat: 'bed', update: 'serveCalm', only: ['murmur', 'excite'], info: true },
  { id: 'crowd bed (long rally, set point)', cat: 'bed', update: 'hot', only: ['murmur', 'excite'], info: true }
];
function seeded(seed) { let s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

async function mixReport(file) {
  const { VB, root } = loadAudio(file); const A = VB.Audio;
  const mock = makeMock();
  root.AudioContext = mock.Ctx;
  root.requestIdleCallback = fn => setImmediate(() => fn({ timeRemaining: () => 50, didTimeout: false }));
  root.setTimeout = setTimeout; root.clearTimeout = clearTimeout;
  const vctx = { camera: { position: { x: CAM.x, y: 4, z: -CAM.y } }, state: 'playing', timeScale: 1, settings: {} };
  const realRandom = Math.random;
  A.init(vctx); A.onGameStart({ demo: false }); A.onState('playing');
  A.unlock();
  for (let i = 0; i < 20000 && (A.ready() < 1); i++) await new Promise(r => setImmediate(r));
  const ctx = mock.started.length ? mock.started[0].src.context : null;
  const AC = ctx || null;
  // find the context instance through a started source or the destination
  let C = AC; if (!C) { A.click(); C = mock.started[mock.started.length - 1].src.context; }
  const rows = [];
  for (const sc of SCEN) {
    const tries = sc.tries || 6, energies = [], bal = []; let pk = 0;
    let n0 = 0;
    for (let k = 0; k < tries; k++) {
      Math.random = seeded(1000 + k * 77 + sc.id.length);
      A.onGameStart({ demo: false });
      C.currentTime += 20; // past every anti-repeat gap and voice slot
      const mark = mock.started.length;
      const g = Object.assign({ mode: 'rally', players: [], rally: { t: 3, hits: 3 }, serving: 0, matchPoint: -1, setPoint: -1, lastKind: 'pass' }, sc.g || {});
      if (sc.api) sc.api(A);
      else if (sc.ev) A.handle(sc.ev.map(e => Object.assign({}, e)), g);
      if (sc.update) {
        // continuous-state scenarios: drive update() like the game loop
        const dt = 1 / 60, gs = { players: [], rally: { t: 0, hits: 0 }, matchPoint: -1, setPoint: -1, serving: 0, mode: 'rally' };
        if (sc.update === 'rally') { gs.mode = 'rally'; gs.rally = { t: 4, hits: 4 }; }
        if (sc.update === 'hot') { gs.mode = 'rally'; gs.rally = { t: 12, hits: 12 }; gs.setPoint = 0; }
        if (sc.update === 'serveCalm') { gs.mode = 'serve'; gs.serving = 0; }
        if (sc.update === 'serve' || sc.update === 'mp') {
          gs.mode = 'serve'; gs.serving = 0;
          A.handle([{ type: 'serveReady', team: 0, player: P0, setPoint: -1, matchPoint: sc.update === 'mp' ? 0 : -1 }], gs);
        }
        for (let f = 0; f < 600; f++) { A.update(gs, dt); C.currentTime += dt; }
      }
      const news = mock.started.slice(mark);
      const isBed = sc.cat === 'bed';
      const pick = isBed ? mock.started.filter(s => s.src.loop && sc.only.includes(nameOfBuf(A, s.src.buffer))) : news.filter(s => !sc.only || sc.only.includes(nameOfBuf(A, s.src.buffer)));
      n0 += pick.length;
      if (!pick.length) continue;
      // mix the picked sources on one timeline
      let t0 = Math.min.apply(null, pick.map(s => s.when)), len = 0;
      const rs = pick.map(s => { const r = renderSource(s, Biq); if (r) len = Math.max(len, Math.round((s.when - t0) * r.sr) + r.L.length); return { s, r }; }).filter(o => o.r);
      if (!rs.length) continue;
      const sr = rs[0].r.sr, L = new Float32Array(len), R = new Float32Array(len);
      for (const o of rs) { const off = isBed ? 0 : Math.round((o.s.when - t0) * sr); for (let i = 0; i < o.r.L.length && off + i < len; i++) { L[off + i] += o.r.L[i]; R[off + i] += o.r.R[i]; } }
      const lu = (isBed || len / sr >= 1.2 && sc.cat !== 'spike') ? M.integrated([L, R], sr) : M.momentaryMax([L, R], sr);
      energies.push(Math.pow(10, (lu + 0.691) / 10)); pk = Math.max(pk, M.peak([L, R]));
      bal.push(M.integrated([L], sr) - M.integrated([R], sr));
      if (isBed) break;
    }
    Math.random = realRandom;
    const lu = energies.length ? M.LU(energies.reduce((a, c) => a + c, 0) / energies.length) : -120;
    const tgt = PLAN[sc.cat].target;
    rows.push({ id: sc.id, cat: sc.cat, target: tgt, lufs: r1(lu), delta: r1(lu - tgt), pass: Math.abs(lu - tgt) <= 1.5 || !!sc.info, info: !!sc.info,
      peak: r1(M.db(pk)), balance: bal.length ? r1(bal.filter(isFinite).reduce((a, c) => a + c, 0) / bal.length) : 0, voices: n0 / (sc.cat === 'bed' ? 1 : (sc.tries || 6)) });
  }
  return rows;
}
/** Identify a buffer by content: synthesise each catalogue sound (cached) and compare a fingerprint. */
const FP = new WeakMap(); let FPT = null;
function fpOf(d) { const n = d.length; return n + ':' + Math.round(d[Math.min(n - 1, 777)] * 1e6) + ':' + Math.round(d[Math.min(n - 1, 5001)] * 1e6); }
function nameOfBuf(A, b) {
  if (!b) return '';
  if (FP.has(b)) return FP.get(b);
  if (!FPT || FPT.A !== A) {
    FPT = { A, map: new Map() };
    for (const name of A.SOUNDS) { if (name === 'ir') continue; for (let v = 0; v < variantsOf(A, name); v++) { const c = A.synth(name, v, MOCK_SR); FPT.map.set(fpOf(c[0]), name); } }
  }
  const nm = FPT.map.get(fpOf(b.getChannelData(0))) || '?';
  FP.set(b, nm); return nm;
}

/* ====================================================================
 * Part 3: full match rendered offline in real Chrome
 * ==================================================================== */
function pageHtml(audioFile) {
  const u = f => require('url').pathToFileURL(f).href;
  return '<!doctype html><meta charset="utf-8"><title>audiotest</title>' +
    ['js/sim.js', 'js/ai.js'].map(f => '<script src="' + u(path.join(ROOT, f)) + '"></script>').join('') +
    '<script src="' + u(audioFile) + '"></script>';
}
/** Runs in the page. opts = {secs, seed, solo:[names]|null, variants:{name:n}} → result (+ base64 PCM of the mix). */
async function PAGE_RUN(opts) {
  const M = (0, eval)('(' + opts.metrics + ')')();
  const SR = 48000, FR = 768, A = VB.Audio;
  // deterministic Math.random for the engine (jitter, variant choice)
  let s = 0x1234567 ^ opts.seed; Math.random = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const off = new OfflineAudioContext(2, SR * opts.secs, SR);
  Object.defineProperty(off, 'state', { get: () => 'running', configurable: true });
  // fingerprint table: buffer content -> sound name
  const fp = d => { const n = d.length; return n + ':' + Math.round(d[Math.min(n - 1, 777)] * 1e6) + ':' + Math.round(d[Math.min(n - 1, 5001)] * 1e6); };
  const table = new Map();
  for (const name of A.SOUNDS) { if (name === 'ir') continue; for (let v = 0; v < (opts.variants[name] || 1); v++) table.set(fp(A.synth(name, v, SR)[0]), name); }
  const log = [], cbs = off.createBufferSource.bind(off);
  off.createBufferSource = function () {
    const src = cbs(), st = src.start.bind(src);
    src.start = function (w, o) {
      const nm = src.buffer ? (table.get(fp(src.buffer.getChannelData(0))) || '?') : '?';
      const when = Math.max(off.currentTime, w || 0);
      log.push({ nm, w: when, d: src.loop ? 1e9 : src.buffer.duration / src.playbackRate.value });
      if (opts.solo && opts.solo.indexOf(nm) < 0) return;
      return st(w || 0, o);
    };
    return src;
  };
  window.AudioContext = function () { return off; };
  const g = VB.Sim.createGame({ autopilot: true, seed: opts.seed, difficulty: 'normal' });
  const fctx = { state: 'playing', timeScale: 1, camera: { position: { x: 14, y: 4, z: 0 } }, game: g, settings: {} };
  A.init(fctx); A.onGameStart(g); A.onState('playing'); A.unlock();
  const t0 = performance.now();
  while (!(A.ready() >= 1 && A.stats.reverbAt > 0) && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 20));
  const genWait = performance.now() - t0;
  const ev = [], input = { move: [0, 0], hit: false, jump: false, switchPlayer: false };
  let acc = 0, frames = 0, points = 0, maxScore = '';
  function frame() {
    const dt = FR / SR; acc += dt;
    while (acc >= 1 / 120) { VB.Sim.step(g, 1 / 120, input); acc -= 1 / 120; }
    ev.length = 0; VB.Sim.drainEvents(g, ev);
    if (opts.inject) for (const it of opts.inject) if (!it.done && off.currentTime >= it.t) { it.done = true; for (const e of it.events) ev.push(Object.assign({ t: g.time }, e)); }
    for (const e of ev) if (e.type === 'point') points++;
    // camera behind the controlled player (approximation of camera.js)
    const c = g.ctrl || g.players[0];
    if (c) { fctx.camera.position.x = Math.max(9.5, c.x + 7); fctx.camera.position.z = -(c.y * 0.6); }
    A.handle(ev, g); A.update(g, dt); frames++;
  }
  frame();
  const N = Math.floor(SR * opts.secs / FR) - 1;
  for (let k = 1; k <= N; k++) off.suspend(k * FR / SR).then(() => { frame(); off.resume(); });
  const rs = performance.now();
  const buf = await off.startRendering();
  const renderMs = performance.now() - rs;
  const L = buf.getChannelData(0), R = buf.getChannelData(1), chs = [L, R];
  maxScore = g.score.join('-') + ' sets ' + g.sets.join('-');
  // voices over time (from the log of started sources, beds included)
  const ends = log.filter(o => o.nm !== '?').map(o => [o.w, o.w + o.d]);
  let vmax = 0, vsum = 0, vn = 0;
  for (let t = 0; t < opts.secs; t += 0.05) { let c = 0; for (const e of ends) if (e[0] <= t && e[1] > t) c++; vmax = Math.max(vmax, c); vsum += c; vn++; }
  const res = { genWait: Math.round(genWait), renderMs: Math.round(renderMs), frames, points, score: maxScore, stats: { played: A.stats.played, skipped: A.stats.skipped },
    voicesMax: vmax, voicesAvg: Math.round(vsum / vn * 10) / 10, starts: log.length, log: opts.wantLog ? log.filter(o => o.nm !== '?') : undefined };
  if (opts.analyse) {
    res.I = M.integrated(chs, SR); res.peak = M.peak(chs); res.tp = M.truePeak(chs); res.clip = 0;
    for (const x of chs) for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.999) res.clip++;
    res.short = M.shortTerm(chs, SR, 1).map(v => Math.round(v * 10) / 10);
    res.Mmax = M.momentaryMax(chs, SR); res.balance = M.integrated([L], SR) - M.integrated([R], SR);
    res.dc = M.dc(chs);
  }
  if (opts.band) { // whistle-band energies at the given windows
    res.band = opts.band.map(w => M.bandEnergy(chs, SR, w[0], w[1], w[2], w[3]));
  }
  if (opts.pcm) { // full mix as base64 int16 for the WAV
    const i16 = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { i16[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))); i16[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))); }
    const u8 = new Uint8Array(i16.buffer); let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    res.pcm = btoa(bin);
  }
  return res;
}
async function chromeReport(file, tag) {
  const CDP = require('./cdp.js');
  const html = path.join(OUT, 'mix-' + tag + '.html'); fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(html, pageHtml(file));
  const url = require('url').pathToFileURL(html).href;
  const { VB } = loadAudio(file), variants = {};
  for (const n of VB.Audio.SOUNDS) variants[n] = variantsOf(VB.Audio, n);
  const page = await CDP.open({ size: '640x360', flags: ['--autoplay-policy=no-user-gesture-required'] });
  async function pass(o) {
    await page.send('Page.navigate', { url }); await CDP.sleep(600);
    const js = '(' + PAGE_RUN.toString() + ')(' + JSON.stringify(Object.assign({ secs: SECS, seed: SEED, variants, metrics: METRICS.toString() }, o)) + ')';
    return page.evalJs(js, true);
  }
  try {
    const full = await pass({ analyse: true, pcm: true, wantLog: true });
    const WH = ['whistle', 'whistleLong', 'whistleEnd'], CR = ['murmur', 'excite', 'roar', 'groan', 'ooh', 'applause', 'palmas', 'bombo'];
    // whistle windows: from 30 ms after the start to the end of the sustained tone; band 2.6-4.2 kHz (both chambers + 2nd partial region)
    const wins = full.log.filter(o => WH.includes(o.nm)).map(o => [o.w + 0.03, o.w + Math.min(o.d - 0.12, 0.9), 2600, 4200]).filter(w => w[1] < SECS);
    const wst = await pass({ solo: WH, band: wins });
    const cst = await pass({ solo: CR, band: wins, analyse: true });
    const nst = await pass({ solo: VB.Audio.SOUNDS.filter(n => !WH.includes(n)), band: wins });
    const mask = wins.map((w, i) => ({ t: r2(w[0]), whistle: r1(10 * Math.log10(wst.band[i] / Math.max(1e-20, cst.band[i]))), others: r1(10 * Math.log10(wst.band[i] / Math.max(1e-20, nst.band[i]))) }));
    const pcm = Buffer.from(full.pcm, 'base64'), i16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    const L = new Float32Array(i16.length / 2), R = new Float32Array(i16.length / 2);
    for (let i = 0; i < L.length; i++) { L[i] = i16[2 * i] / 32767; R[i] = i16[2 * i + 1] / 32767; }
    if (!has('--no-wav')) wav(path.join(OUT, 'match-' + tag + '.wav'), [L, R], 48000);
    const counts = {}; for (const o of full.log) counts[o.nm] = (counts[o.nm] || 0) + 1;
    delete full.pcm; const log = full.log; delete full.log;
    // climax: the loudest moment the game can produce (spike, slam on the floor, final whistle, double roar,
    // applause and the match sting at once) through the real master chain: must not clip
    const P = { x: 6, y: 1, z: 3, team: 0 };
    const climax = await pass({ secs: 8, analyse: true, inject: [
      { t: 0.5, events: [{ type: 'hit', kind: 'spike', x: -2, y: 1, z: 3.2, team: 1, power: 1, speed: 26, player: { x: -2, y: 1, z: 3.2, team: 1 } }] },
      { t: 0.8, events: [{ type: 'block', result: 'tool', x: 0.2, y: 1, z: 3, team: 0, player: P }] },
      { t: 1.1, events: [{ type: 'land', x: 6, y: 1, inside: true, team: 0, speed: 19 }, { type: 'whistle', reason: 'point' },
        { type: 'point', team: 0, reason: 'in', how: 'kill', rallyHits: 10, setWon: true, matchWon: true }, { type: 'match', team: 0 }] }] });
    return { climax: { I: climax.I, Mmax: climax.Mmax, peak: climax.peak, tp: climax.tp, clip: climax.clip, short: climax.short }, full, crowd: { I: cst.I, peak: cst.peak }, mask, counts, errors: page.errors.slice(0, 5), whistles: log.filter(o => WH.includes(o.nm)).length };
  } finally { page.close(); }
}

/* ====================================================================
 * Report
 * ==================================================================== */
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function synthTable(rows) {
  console.log('\n== 1. Synth (48 kHz context; one row per variant 0, worst case across variants for flags) ==');
  console.log(pad('sound', 12) + lpad('sr', 6) + lpad('dur', 6) + lpad('peak', 7) + lpad('TP dB', 7) + lpad('RMS dB', 8) + lpad('Mmax', 7) + lpad('I', 7) + lpad('cent', 7) + lpad('HF%', 6) + lpad('LF%', 6) + lpad('phone', 7) + lpad('edge', 8) + lpad('DC', 9) + '  flags');
  const by = {};
  for (const r of rows) (by[r.name] = by[r.name] || []).push(r);
  let bad = 0;
  for (const n of Object.keys(by)) {
    const a = by[n], r = a[0];
    const flags = [];
    if (a.some(x => x.nan)) flags.push('NaN');
    if (a.some(x => x.peak > 1)) flags.push('PEAK>1');
    if (a.some(x => (x.loop ? x.seam > 0.2 : x.edge > 0.01))) flags.push(r.loop ? 'LOOP-SEAM' : 'EDGE-CLICK');
    if (a.some(x => x.dc > 0.01)) flags.push('DC');
    const ck = a.reduce((m, x) => (x.clickWorst > m.clickWorst ? x : m), a[0]);
    if (!CLICK_GRAINS.includes(n) && a.some(x => x.click > 0)) flags.push('CLICK@' + ck.clickAt.toFixed(3) + 's x' + ck.clickWorst.toFixed(1));
    if (flags.length) bad++;
    const tpw = Math.max.apply(null, a.map(x => x.tp));
    console.log(pad(n, 12) + lpad(r.sr, 6) + lpad(r.dur, 6) + lpad(r2(r.peak), 7) + lpad(r1(M.db(tpw)), 7) + lpad(r1(M.db(r.rms)), 8) + lpad(r1(r.Mmax), 7) + lpad(r.I == null ? '-' : r1(r.I), 7) +
      lpad(r.centroid, 7) + lpad(r1(r.hf * 100), 6) + lpad(r1(r.lf * 100), 6) + lpad('-' + r1(r.phone), 7) + lpad(r.edge.toExponential(0), 8) + lpad(r.dc.toExponential(0), 9) + '  ' + flags.join(' '));
  }
  return bad;
}
function mixTable(rows, before) {
  console.log('\n== 2. Mix plan (LUFS at the output, small-signal: makeup included, no gain reduction; target ±1.5 LU) ==');
  const bm = {}; if (before) for (const r of before) bm[r.id] = r;
  console.log(pad('scenario', 34) + pad('category', 9) + lpad('target', 7) + (before ? lpad('before', 8) : '') + lpad('LUFS', 7) + lpad('Δ', 6) + lpad('peak', 7) + lpad('L-R', 6) + '  ok');
  let bad = 0;
  for (const r of rows) {
    if (!r.pass) bad++;
    console.log(pad(r.id, 34) + pad(r.cat, 9) + lpad(r.target, 7) + (before ? lpad(bm[r.id] ? bm[r.id].lufs : '-', 8) : '') + lpad(r.lufs, 7) + lpad((r.delta > 0 ? '+' : '') + r.delta, 6) + lpad(r.peak, 7) + lpad(r.balance, 6) + '  ' + (r.info ? 'info' : r.pass ? 'OK' : 'MISS'));
  }
  return bad;
}
function chromeTable(c, before) {
  console.log('\n== 3. Match mix in Chrome (' + SECS + ' s, seed ' + SEED + ', OfflineAudioContext 48 kHz, master compressor included) ==');
  const f = c.full, b = before && before.full;
  const row = (k, v, bv) => console.log(pad(k, 30) + (before ? lpad(bv, 14) : '') + lpad(v, 14));
  if (before) row('', 'after', 'before');
  row('integrated loudness (LUFS)', r1(f.I), b && r1(b.I));
  row('momentary max (LUFS)', r1(f.Mmax), b && r1(b.Mmax));
  row('sample peak (dBFS)', r1(M.db(f.peak)), b && r1(M.db(b.peak)));
  row('true peak (dBTP)', r1(M.db(f.tp)), b && r1(M.db(b.tp)));
  row('samples ≥ 0.999', f.clip, b && b.clip);
  row('L-R balance (LU)', r2(f.balance), b && r2(b.balance));
  row('crowd stem integrated', r1(c.crowd.I), before && r1(before.crowd.I));
  row('voices max / avg', f.voicesMax + ' / ' + f.voicesAvg, b && (b.voicesMax + ' / ' + b.voicesAvg));
  row('sources started / dropped', f.starts + ' / ' + f.stats.skipped, b && (b.starts + ' / ' + b.stats.skipped));
  row('points played', f.points, b && b.points);
  const mm = c.mask.length ? Math.min.apply(null, c.mask.map(m => m.whistle)) : NaN, mo = c.mask.length ? Math.min.apply(null, c.mask.map(m => m.others)) : NaN;
  const bm = before && before.mask.length ? Math.min.apply(null, before.mask.map(m => m.whistle)) : null, bo = before && before.mask.length ? Math.min.apply(null, before.mask.map(m => m.others)) : null;
  row('whistle/crowd band min (dB)', r1(mm), bm == null ? '' : r1(bm));
  row('whistle/everything min (dB)', r1(mo), bo == null ? '' : r1(bo));
  row('climax: momentary max (LUFS)', r1(c.climax.Mmax), before && before.climax && r1(before.climax.Mmax));
  row('climax: true peak (dBTP)', r1(M.db(c.climax.tp)), before && before.climax && r1(M.db(before.climax.tp)));
  row('climax: samples >= 0.999', c.climax.clip, before && before.climax && before.climax.clip);
  console.log('short-term loudness per second (LUFS):\n  ' + f.short.join(' '));
  console.log('whistles: ' + c.mask.map(m => m.t + 's ' + m.whistle + '/' + m.others + 'dB').join(', '));
  console.log('render ' + f.renderMs + ' ms, bank ready after ' + f.genWait + ' ms, score ' + f.score);
  if (c.errors.length) console.log('PAGE ERRORS: ' + c.errors.join(' | '));
  let bad = 0;
  if (f.clip > 0 || f.tp > 1) { bad++; console.log('FAIL: clipping in the match mix'); }
  if (c.climax.clip > 0 || c.climax.tp > 1) { bad++; console.log('FAIL: clipping in the climax'); }
  if (!(mm >= 6)) { bad++; console.log('FAIL: whistle less than 6 dB above the crowd in its band'); }
  if (c.errors.length) bad++;
  return bad;
}

/* ====================================================================
 * Part 4: robustness of the engine (mock AudioContext whose params throw on non-finite values, like Chrome)
 *  a. play() with NaN / Infinity / negative arguments: no non-finite write, the sound still plays.
 *  b. a quick tap: whistle + newMatch arrive before the bank has their buffers → they are deferred (not skipped),
 *     their jobs jump the queue, and they play once built; a deferred whistle that arrives too late is dropped.
 *  c. the generation stays allocation-light: scavenges for the whole bank (node, 1 MB semi-space) vs output size.
 * ==================================================================== */
async function robustReport(file) {
  const res = [];
  const ok = (name, pass, info) => res.push({ name, pass: !!pass, info: info || '' });
  function load() {
    const { VB, root } = loadAudio(file); const A = VB.Audio, mock = makeMock(), q = [];
    let bad = 0; const Orig = mock.Ctx.prototype.createGain;
    mock.Ctx.prototype.createGain = function () { const n = Orig.call(this); let v = n.gain.value; Object.defineProperty(n.gain, 'value', { get: () => v, set: x => { if (!isFinite(x)) { bad++; throw new TypeError('non-finite'); } v = x; } }); return n; };
    root.AudioContext = mock.Ctx;
    root.requestIdleCallback = fn => { q.push(fn); return q.length; }; root.cancelIdleCallback = () => { };
    root.setTimeout = (fn, ms) => { q.push(fn); return q.length; }; root.clearTimeout = () => { };
    const pump = (n) => { for (let i = 0; i < n && q.length; i++) q.shift()({ timeRemaining: () => 8, didTimeout: false }); };
    return { A, mock, pump, bad: () => bad, q };
  }
  // a. non-finite arguments
  {
    const t = load(); t.A.init({ camera: { position: { x: 0, y: 4, z: 12 } }, state: 'playing', settings: {} }); t.A.onGameStart({ demo: false }); t.A.onState('playing'); t.A.unlock();
    for (let i = 0; i < 50000 && t.A.ready() < 1; i++) t.pump(1);
    const before = t.mock.started.length; let r = 0;
    r += t.A.play('spike', NaN, NaN, NaN) ? 1 : 0; r += t.A.play('pass', Infinity, Infinity, -Infinity) ? 1 : 0;
    r += t.A.play('net', -3, 1e308, NaN) ? 1 : 0; r += t.A.play('roar', NaN) ? 1 : 0;
    r += t.A.play('constructor') ? 0 : 1; r += t.A.play('__proto__', 1) ? 0 : 1;
    ok('play() with NaN/Infinity/negative args', t.bad() === 0 && r === 6 && t.mock.started.length - before === 4, 'non-finite writes ' + t.bad() + ', played ' + (t.mock.started.length - before) + '/4');
  }
  // b. quick tap: events before the buffers exist
  {
    const t = load(); const C = () => t.mock.started.length ? t.mock.started[0].src.context : null;
    t.A.init({ state: 'playing', settings: {} }); t.A.onGameStart({ demo: false }); t.A.onState('playing'); t.A.unlock();
    const st = t.A.stats, sk0 = st.skipped;
    t.A.handle([{ type: 'newMatch' }, { type: 'whistle', reason: 'serve' }], { mode: 'serve' });
    const deferred = st.deferred, skippedAtTap = st.skipped - sk0;
    for (let i = 0; i < 50000 && !(st.played.whistle && st.played.roar && st.played.applause); i++) t.pump(1);
    ok('quick tap: whistle + welcome deferred, not skipped', deferred >= 3 && skippedAtTap === 0, 'deferred ' + deferred + ', skipped ' + skippedAtTap);
    ok('quick tap: they play once built', st.played.whistle === 1 && st.played.roar === 1 && st.played.applause === 1, 'whistle ' + (st.played.whistle | 0) + ' roar ' + (st.played.roar | 0) + ' applause ' + (st.played.applause | 0) + ' after ' + st.synth + '/' + st.total + ' sounds');
  }
  {
    const t = load(); t.A.init({ state: 'playing', settings: {} }); t.A.onGameStart({ demo: false }); t.A.onState('playing'); t.A.unlock();
    const st = t.A.stats; t.A.handle([{ type: 'whistle', reason: 'point' }], { mode: 'point' });
    const ctx = t.mock.started.length ? t.mock.started[0].src.context : null; // the iOS unlock buffer started inside unlock()
    if (ctx) ctx.currentTime += 1.5; // the bank takes 1.5 s: a whistle that late makes no sense any more
    for (let i = 0; i < 50000 && !st.played.whistleLong && !st.lateDrop; i++) t.pump(1);
    ok('late deferred whistle is dropped', !st.played.whistleLong && st.lateDrop === 1, 'played ' + (st.played.whistleLong | 0) + ', lateDrop ' + st.lateDrop);
  }
  // c. allocation of the whole bank (child process: its own heap and semi-space)
  {
    const cp = require('child_process');
    const code = "globalThis.VB={};require(" + JSON.stringify(file) + ");const A=VB.Audio;let sc=0,out=0;const {PerformanceObserver}=require('perf_hooks');" +
      "new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.detail&&e.detail.kind===1)sc++;}).observe({entryTypes:['gc']});const t=Date.now();" +
      "for(const n of A.SOUNDS)for(let v=0;v<A.VARIANTS[n];v++){const it=A.synthSteps(n,v,48000);let r;do{r=it.next();}while(!r.done);for(const c of r.value)out+=c.length*4;}" +
      "setTimeout(()=>console.log(JSON.stringify({sc,ms:Date.now()-t,mb:out/1048576})),30);";
    try {
      const r = JSON.parse(cp.execFileSync(process.execPath, ['--max-semi-space-size=1', '-e', code], { encoding: 'utf8' }).trim().split('\n').pop());
      // before the review-3 fix: ~870 scavenges (~740 MB of boxed doubles for 11 MB of audio); after: ~400 (mostly the first, unoptimised run of each generator)
      ok('bank generation allocation (node, 1 MB semi-space)', r.sc < 600, r.sc + ' scavenges, ' + r.ms + ' ms, output ' + r.mb.toFixed(1) + ' MB');
    } catch (e) { ok('bank generation allocation', false, String(e.message || e).slice(0, 120)); }
  }
  return res;
}
function robustTable(rows) {
  console.log('\n== 4. Robustness (mock AudioContext, params throw on non-finite values) ==');
  let bad = 0;
  for (const r of rows) { console.log(pad(r.name, 52) + (r.pass ? 'OK  ' : 'FAIL') + '  ' + r.info); if (!r.pass) bad++; }
  return bad;
}

module.exports = { METRICS, loadAudio, synthReport, mixReport, chromeReport, robustReport, PLAN };
if (require.main === module) (async () => {
  let bad = 0; const out = {};
  console.log('audiotest: ' + path.relative(ROOT, FILE) + (BEFORE ? '  (before: ' + path.relative(ROOT, BEFORE) + ')' : ''));
  const syn = synthReport(FILE, !has('--no-wav')); out.synth = syn;
  bad += synthTable(syn);
  if (has('--synth-only')) { console.log(bad ? 'FALLOS: ' + bad : 'TODO OK'); process.exit(bad ? 1 : 0); }
  const mix = await mixReport(FILE); out.mix = mix;
  let mixB = null; if (BEFORE) { mixB = await mixReport(BEFORE); out.mixBefore = mixB; }
  bad += mixTable(mix, mixB);
  const rob = await robustReport(FILE); out.robust = rob;
  bad += robustTable(rob);
  if (has('--calibrate')) { // suggested LEVEL table for js/audio.js: current level + (target - measured) of the first scenario of each sound
    const { VB } = loadAudio(FILE), cur = VB.Audio.LEVELS || {}, sug = {};
    for (const r of mix) { const sc = SCEN.find(x => x.id === r.id); if (!sc || r.info || !sc.only) continue; for (const n of sc.only) if (!(n in sug)) sug[n] = Math.round(((cur[n] || 0) - r.delta) * 10) / 10; }
    for (const n of Object.keys(cur)) if (!(n in sug)) sug[n] = cur[n];
    console.log('\nsuggested LEVEL: ' +JSON.stringify(sug).replace(/"/g, ''));
  }
  if (!has('--no-chrome')) {
    const c = await chromeReport(FILE, 'after'); out.chrome = c;
    let cb = null; if (BEFORE) { cb = await chromeReport(BEFORE, 'before'); out.chromeBefore = cb; }
    bad += chromeTable(c, cb);
  }
  if (opt('--json')) fs.writeFileSync(path.resolve(opt('--json')), JSON.stringify(out, null, 1));
  console.log('\nWAVs in ' + path.relative(ROOT, OUT));
  console.log(bad ? 'FALLOS: ' + bad : 'TODO OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(2); });
