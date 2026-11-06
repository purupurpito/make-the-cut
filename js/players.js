/* =====================================================================
 * VOLEY 3D — js/players.js   (owner: players)
 * Atletas estilizados hechos con primitivas + animación procedural.
 *
 * MODELO (espacio "cuerpo": mira a +Z, +X es su IZQUIERDA, +Y arriba,
 * origen en el suelo entre los pies). Atleta de ~1,93 m (escala 1).
 *   root (posición de la sim, yaw, escala de altura)
 *    └ body (desplazamientos visuales: saltitos, plancha)
 *       └ pelvis ─┬ spine ─ chest ─┬ head
 *                 │                ├ shoulder L/R ─ upper ─ elbow ─ hand
 *                 └ hip L/R ─ thigh ─ knee ─ foot
 * Cada hueso es UNA malla (geometrías fusionadas con colores de vértice),
 * ~18 mallas por atleta, 3 materiales compartidos por equipo.
 *
 * ANIMACIÓN: cada frame se calcula una pose OBJETIVO por capas
 * (postura base → carrera → salto → anticipación → gesto de golpeo →
 * plancha → celebración) y la pose actual se amortigua hacia ella.
 * Brazos y piernas se resuelven con IK de dos huesos hacia posiciones de
 * manos/pies: las manos llegan al balón en el contacto y los pies no
 * patinan (zancada ligada a la velocidad real).
 * Todo depende del estado de la sim + tiempos de eventos (g.time - e.t), así
 * que las escenas congeladas (?debug=spike...) muestran la pose exacta.
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var THREE, ctx, C;
  var PI = Math.PI;

  // ---------- Proporciones (m) ----------
  var HIP_H = 1.0, HIP_W = 0.1, THIGH = 0.46, SHIN = 0.46, ANKLE = 0.08;
  var SPINE_Y = 0.1, CHEST_Y = 0.2, SH_X = 0.2, SH_Y = 0.235, SH_Z = -0.01;
  var UPPER = 0.3, FORE = 0.27, PALM = 0.075, NECK_Y = 0.37;

  // ---------- Aspecto ----------
  // Equipos (colores alineados con la UI: --hot/--amber y --blue/--sky)
  var TEAMS = [
    { base: 0xff5a2c, top: 0xff7a3c, accent: 0xffb238, dark: 0x6e1606, trim: 0xffffff, shorts: 0x191b22, sole: 0xff6a2a, band: 0xffb238, pad: 0x1d1f26 },
    { base: 0x2f7bff, top: 0x4f95ff, accent: 0x86c8ff, dark: 0x0a2261, trim: 0xffffff, shorts: 0x111a33, sole: 0x2f7bff, band: 0x86c8ff, pad: 0x1a2236 }
  ];
  // Por id de jugador: piel, pelo, peinado, escala de altura
  var LOOKS = [
    { skin: 0xdba27a, hair: 0x2a1a10, style: 'crop', h: 1.0 },
    { skin: 0x7a4a2f, hair: 0x14100e, style: 'curly', h: 1.03 },
    { skin: 0xc68a5f, hair: 0x4b2a18, style: 'bun', h: 0.985 },
    { skin: 0xf0c6a4, hair: 0x1a1512, style: 'buzz', h: 1.04 }
  ];

  var rigs = [], byId = [], cache = {};
  var groupRoot, marker, markerCone, markerMat, coneMat;
  var bodyMat, jerseyMats = [], numMats = {};
  var smallShadows = true;

  // ---------- Utilidades ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function wrapA(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function kf(rate, dt) { return dt <= 0 ? 1 : 1 - Math.exp(-rate * dt); }
  function side(t) { return t === 0 ? 1 : -1; }

  // =====================================================================
  //  GEOMETRÍA
  // =====================================================================
  /** Acumulador de geometrías con color por vértice (y UV opcional). */
  function Geo(withUV) { this.p = []; this.n = []; this.c = []; this.u = withUV ? [] : null; this.i = []; this.k = 0; }
  Geo.prototype.add = function (geo, hex, x, y, z, rx, ry, rz, sx, sy, sz, uvs, uvo) {
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    q.setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
    nm.getNormalMatrix(m);
    var P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, col = new THREE.Color(hex == null ? 0xffffff : hex), i;
    for (i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.c.push(col.r, col.g, col.b);
      if (this.u) { var uu = U ? U.getX(i) : 0, vv = U ? U.getY(i) : 0; if (uvs) uu = 0.5 + (uu - 0.5) * uvs; if (uvo) vv = uvo[0] + vv * uvo[1]; this.u.push(uu, vv); }
    }
    if (geo.index) for (i = 0; i < geo.index.count; i++) this.i.push(geo.index.getX(i) + this.k);
    else for (i = 0; i < P.count; i++) this.i.push(this.k + i);
    this.k += P.count; geo.dispose(); return this;
  };
  Geo.prototype.build = function (noColor) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (!noColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.u) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i); g.computeBoundingSphere(); return g;
  };

  function V2(x, y) { return new THREE.Vector2(x, y); }
  /** Perfil de extremidad (de abajo arriba) para LatheGeometry: cuelga en -Y de 0 a -len. */
  function limbPts(len, r0, r1, bAt, bulge, n) {
    var pts = [], i, a;
    for (i = 0; i <= 3; i++) { a = i / 3 * PI / 2; pts.push(V2(Math.sin(a) * r1, -len - Math.cos(a) * r1 * 0.75)); }
    for (i = 1; i < n; i++) {
      var t = 1 - i / n, d = (t - bAt) / 0.3;
      pts.push(V2(r0 + (r1 - r0) * t + bulge * Math.exp(-d * d), -len * t));
    }
    for (i = 0; i <= 3; i++) { a = i / 3 * PI / 2; pts.push(V2(Math.cos(a) * r0, Math.sin(a) * r0 * 0.75)); }
    return pts;
  }
  function lathe(pts, seg, ps, pl) { return new THREE.LatheGeometry(pts, seg, ps || 0, pl == null ? PI * 2 : pl); }
  function sph(r, w, h, ps, pl, ts, tl) { return new THREE.SphereGeometry(r, w || 12, h || 8, ps || 0, pl == null ? PI * 2 : pl, ts || 0, tl == null ? PI : tl); }
  function cyl(rt, rb, h, seg, open) { return new THREE.CylinderGeometry(rt, rb, h, seg || 12, 1, !!open); }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

  // Perfiles del tronco (y local de cada hueso) [r, y] de abajo arriba
  var CHEST_PROF = [[0, -0.17], [0.142, -0.16], [0.15, -0.08], [0.162, 0.0], [0.172, 0.08], [0.176, 0.15], [0.166, 0.205], [0.142, 0.25], [0.1, 0.282], [0.058, 0.3], [0, 0.306]];
  var CHEST_S = [1.3, 1, 0.8];
  var ABS_PROF = [[0, -0.135], [0.15, -0.128], [0.158, -0.095], [0.15, -0.02], [0.141, 0.04], [0.128, 0.1], [0.11, 0.16], [0, 0.17]];
  var ABS_S = [1.22, 1, 0.78];
  var SHORTS_PROF = [[0, -0.15], [0.12, -0.146], [0.152, -0.12], [0.16, -0.04], [0.156, 0.06], [0.147, 0.13], [0, 0.14]];
  var SHORTS_S = [1.2, 1, 0.86];
  function profPts(pr) { var a = []; for (var i = 0; i < pr.length; i++) a.push(V2(pr[i][0], pr[i][1])); return a; }
  function profR(pr, y) {
    for (var i = 1; i < pr.length; i++) if (pr[i][1] >= y) { var a = pr[i - 1], b = pr[i], t = (y - a[1]) / ((b[1] - a[1]) || 1); return a[0] + (b[0] - a[0]) * t; }
    return pr[pr.length - 1][0];
  }
  function patchPts(pr, y0, y1, n, off) { var a = []; for (var i = 0; i <= n; i++) { var y = y0 + (y1 - y0) * i / n; a.push(V2(profR(pr, y) + off, y)); } return a; }

  // ---------- Texturas de canvas ----------
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(cv) {
    var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    t.wrapS = THREE.RepeatWrapping; return t;
  }
  function hexCss(h) { return '#' + ('000000' + h.toString(16)).slice(-6); }
  /** Camiseta: u alrededor (0 = delante, .25 izquierda, .5 espalda, .75 derecha), v de abajo arriba. */
  function jerseyTexture(tc) {
    var W = 512, H = 256, cv = canvas(W, H), g = cv.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, hexCss(tc.top)); gr.addColorStop(1, hexCss(tc.base));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // trama sublimada muy sutil
    g.globalAlpha = 0.07; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    for (var x = -H; x < W + H; x += 14) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H * 0.6, 0); g.stroke(); }
    g.globalAlpha = 1;
    function wrap(fn) { fn(0); fn(W); fn(-W); }
    // paneles laterales (bajo el brazo) en color de acento con filo oscuro
    [0.25, 0.75].forEach(function (u) {
      var cx = u * W;
      g.fillStyle = hexCss(tc.dark); g.beginPath(); g.moveTo(cx - 40, H); g.lineTo(cx + 40, H); g.lineTo(cx + 22, 0); g.lineTo(cx - 22, 0); g.fill();
      g.fillStyle = hexCss(tc.accent); g.beginPath(); g.moveTo(cx - 32, H); g.lineTo(cx + 32, H); g.lineTo(cx + 15, 0); g.lineTo(cx - 15, 0); g.fill();
    });
    // franja diagonal en el pecho (delante, cruza la costura u=0)
    wrap(function (o) {
      g.fillStyle = hexCss(tc.accent); g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(o - 70, 120); g.lineTo(o + 70, 70); g.lineTo(o + 70, 86); g.lineTo(o - 70, 136); g.fill();
      g.globalAlpha = 1;
    });
    // canesú en la espalda (parte alta) en oscuro
    g.fillStyle = hexCss(tc.dark); g.globalAlpha = 0.35; g.fillRect(150, 0, 212, 22); g.globalAlpha = 1;
    // cuello en pico (delante) y ribete del cuello
    wrap(function (o) {
      g.strokeStyle = hexCss(tc.trim); g.lineWidth = 7; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(o - 44, 0); g.lineTo(o, 34); g.lineTo(o + 44, 0); g.stroke();
      g.fillStyle = hexCss(tc.dark); g.beginPath(); g.moveTo(o - 40, 0); g.lineTo(o, 28); g.lineTo(o + 40, 0); g.fill();
    });
    g.fillStyle = hexCss(tc.trim); g.fillRect(0, 0, W, 4);
    // bajo de la camiseta
    g.fillStyle = hexCss(tc.dark); g.fillRect(0, H - 8, W, 8);
    return texOf(cv);
  }
  var NUM_FONT = '"Barlow Condensed","Arial Narrow","Arial Black",Impact,sans-serif';
  function drawNumber(cv, num, tc) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, s = String(num);
    g.clearRect(0, 0, W, H);
    g.font = 'italic 900 ' + Math.round(H * 0.8) + 'px ' + NUM_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = H * 0.09; g.strokeStyle = hexCss(tc.dark);
    g.strokeText(s, W / 2, H * 0.54); g.fillStyle = '#ffffff'; g.fillText(s, W / 2, H * 0.54);
  }
  function numberMaterial(num, team) {
    var key = team + ':' + num; if (numMats[key]) return numMats[key];
    var cv = canvas(128, 128), tc = TEAMS[team]; drawNumber(cv, num, tc);
    var t = texOf(cv); t.wrapS = THREE.ClampToEdgeWrapping;
    var m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, roughness: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    addRim(m, 0xfff0e0, 0.12);
    // con la fuente de la UI cargada, se redibuja (sin peticiones nuevas: la carga la propia UI)
    try {
      if (document.fonts && document.fonts.load) document.fonts.load('italic 900 100px "Barlow Condensed"').then(function () { drawNumber(cv, num, tc); t.needsUpdate = true; }).catch(function () { });
    } catch (e) { }
    numMats[key] = m; return m;
  }

  /** Brillo de contorno (luz de retransmisión a contraluz): barato, en el propio shader estándar. */
  function addRim(mat, hex, k) {
    var col = new THREE.Color(hex).multiplyScalar(k);
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uRim = { value: col };
      sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <output_fragment>',
        'float vbRim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);\n' +
        'outgoingLight += uRim * (vbRim * vbRim * vbRim);\n#include <output_fragment>');
    };
    mat.customProgramCacheKey = function () { return 'vbRim'; };
  }

  // ---------- Piezas ----------
  function headGeo(L, tc) {
    var g = new Geo(), sk = L.skin, hr = L.hair, s, i;
    g.add(sph(0.112, 22, 16), sk, 0, 0.1, 0, 0, 0, 0, 0.9, 1.04, 1.0);            // cráneo
    g.add(sph(0.08, 16, 10), sk, 0, 0.035, 0.035, 0, 0, 0, 1.0, 0.85, 1.0);        // mandíbula
    g.add(sph(0.02, 8, 6), sk, 0, 0.083, 0.113, 0.3, 0, 0, 0.85, 1.4, 1.0);        // nariz
    for (s = -1; s <= 1; s += 2) {
      g.add(sph(0.027, 8, 6), sk, s * 0.1, 0.092, -0.004, 0, 0, 0, 0.45, 1, 0.75); // orejas
      g.add(sph(0.016, 10, 8), 0x17110d, s * 0.036, 0.112, 0.103, 0, 0, 0, 1, 1.1, 0.6); // ojos
      g.add(box(0.042, 0.011, 0.014), hr, s * 0.037, 0.141, 0.1, 0, 0, s * -0.12); // cejas
    }
    g.add(box(0.036, 0.007, 0.01), 0x7d3f33, 0, 0.044, 0.112);                     // boca
    var cap = function (col, rot, sc) { g.add(sph(0.119, 22, 12, 0, PI * 2, 0, PI * 0.5), col, 0, 0.105, -0.006, rot, 0, 0, 0.93 * (sc || 1), 1.06 * (sc || 1), 1.04 * (sc || 1)); };
    switch (L.style) {
      case 'curly':
        cap(hr, -0.28);
        var pos = [[0, 0.215, 0.0], [0.05, 0.205, 0.04], [-0.05, 0.205, 0.04], [0.06, 0.2, -0.04], [-0.06, 0.2, -0.04], [0, 0.205, 0.06], [0, 0.2, -0.07], [0.085, 0.165, 0.0], [-0.085, 0.165, 0.0], [0.03, 0.19, 0.085], [-0.03, 0.19, 0.085]];
        for (i = 0; i < pos.length; i++) g.add(new THREE.IcosahedronGeometry(0.045, 1), hr, pos[i][0], pos[i][1], pos[i][2]);
        break;
      case 'bun':
        cap(hr, -0.3);
        g.add(sph(0.05, 12, 8), hr, 0, 0.2, -0.085);                                         // moño
        g.add(new THREE.TorusGeometry(0.106, 0.013, 6, 28), tc.band, 0, 0.142, -0.004, PI / 2 - 0.22, 0, 0, 0.93, 1.04, 1); // cinta
        break;
      case 'buzz':
        cap(hr, -0.18, 0.99);
        g.add(sph(0.084, 16, 8, 0, PI * 2, PI * 0.52, PI * 0.48), hr, 0, 0.037, 0.036, 0, 0, 0, 1.0, 0.85, 1.0); // barba
        break;
      default: // crop con flequillo corto
        cap(hr, -0.32);
        g.add(sph(0.06, 12, 8), hr, 0.02, 0.19, 0.06, 0, 0, 0, 1.4, 0.55, 1.0);
    }
    return g.build();
  }
  function neckGeo(L, tc) {
    var g = new Geo();
    g.add(cyl(0.05, 0.057, 0.16, 14), L.skin, 0, 0.33, 0.0);
    g.add(new THREE.TorusGeometry(0.06, 0.012, 6, 20), tc.trim, 0, 0.29, 0.005, PI / 2 + 0.25, 0, 0, 1.15, 1, 1); // ribete del cuello
    return g.build();
  }
  function upperGeo(L, tc) {
    var g = new Geo();
    g.add(lathe(limbPts(UPPER, 0.062, 0.044, 0.38, 0.009, 7), 14), L.skin);
    g.add(cyl(0.07, 0.066, 0.14, 14, true), tc.base, 0, -0.06, 0);                 // manga
    g.add(sph(0.072, 14, 10), tc.base, 0, -0.005, 0, 0, 0, 0, 1, 0.9, 1);           // hombro
    g.add(cyl(0.0675, 0.0675, 0.016, 14, true), tc.accent, 0, -0.123, 0);           // ribete de manga
    return g.build();
  }
  function foreGeo(L, tc, s) {
    var g = new Geo();
    g.add(lathe(limbPts(FORE, 0.046, 0.031, 0.22, 0.008, 7), 12), L.skin);
    if (s < 0) g.add(cyl(0.039, 0.037, 0.05, 12), tc.band, 0, -FORE + 0.045, 0);    // muñequera
    return g.build();
  }
  function handGeo(L) {
    var g = new Geo();
    g.add(sph(1, 12, 8), L.skin, 0, -0.06, 0.002, 0, 0, 0, 0.027, 0.06, 0.046);     // palma+dedos
    g.add(sph(1, 8, 6), L.skin, 0, -0.04, 0.04, 0.5, 0, 0, 0.017, 0.032, 0.017);    // pulgar
    return g.build();
  }
  function thighGeo(L, tc) {
    var g = new Geo();
    g.add(lathe(limbPts(THIGH, 0.09, 0.062, 0.25, 0.012, 8), 14), L.skin);
    g.add(cyl(0.097, 0.099, 0.22, 16, true), tc.shorts, 0, -0.08, 0);               // pernera
    g.add(cyl(0.0995, 0.0995, 0.016, 16, true), tc.accent, 0, -0.184, 0);          // ribete
    return g.build();
  }
  function shinGeo(L, tc) {
    var g = new Geo();
    g.add(lathe(limbPts(SHIN, 0.062, 0.038, 0.28, 0.013, 8), 14), L.skin);
    g.add(cyl(0.075, 0.07, 0.12, 16), tc.pad, 0, -0.025, 0.01);                       // rodillera
    g.add(cyl(0.047, 0.044, 0.16, 12, true), 0xf4f4f2, 0, -SHIN + 0.08, 0);         // calcetín
    g.add(cyl(0.0475, 0.0475, 0.02, 12, true), tc.base, 0, -SHIN + 0.13, 0);        // franja del calcetín
    return g.build();
  }
  function shoeGeo(tc) {
    var g = new Geo();
    g.add(sph(1, 18, 8, 0, PI * 2, 0, PI * 0.5), 0xf4f4f4, 0, -0.056, 0.04, 0, 0, 0, 0.055, 0.07, 0.135); // empeine
    g.add(cyl(0.046, 0.05, 0.06, 12), 0xf4f4f4, 0, -0.02, -0.01);                   // tobillera
    g.add(sph(1, 18, 6, 0, PI * 2, PI * 0.5, PI * 0.5), tc.sole, 0, -0.056, 0.04, 0, 0, 0, 0.057, 0.026, 0.138); // suela
    g.add(sph(1, 14, 6, 0, PI * 2, 0, PI * 0.5), tc.accent, 0, -0.05, -0.025, 0, 0, 0, 0.0565, 0.034, 0.06);  // talón
    g.add(box(0.03, 0.006, 0.06), 0x30333a, 0, 0.0, 0.1, -0.5, 0, 0);               // cordones
    return g.build();
  }
  function shortsGeo(tc) {
    var g = new Geo();
    g.add(lathe(profPts(SHORTS_PROF), 22), tc.shorts, 0, 0, 0, 0, 0, 0, SHORTS_S[0], SHORTS_S[1], SHORTS_S[2]);
    return g.build();
  }
  var chestGeo = null, absGeo = null;
  function torsoGeos() {
    if (chestGeo) return;
    var g = new Geo(true);
    g.add(lathe(profPts(CHEST_PROF), 26), null, 0, 0, 0, 0, 0, 0, CHEST_S[0], CHEST_S[1], CHEST_S[2], 0, [0.25, 0.75]);
    chestGeo = g.build(true);
    g = new Geo(true);
    g.add(lathe(profPts(ABS_PROF), 24), null, 0, 0, 0, 0, 0, 0, ABS_S[0], ABS_S[1], ABS_S[2], 0, [0, 0.4]);
    absGeo = g.build(true);
  }
  var numGeo = null;
  function numberGeo() {
    if (numGeo) return numGeo;
    var g = new Geo(true);
    // espalda (grande) y pecho (pequeño), pegados a la curva del tronco
    g.add(lathe(patchPts(CHEST_PROF, -0.05, 0.2, 6, 0.005), 12, PI - 0.78, 1.56), null, 0, 0, 0, 0, 0, 0, CHEST_S[0], CHEST_S[1], CHEST_S[2]);
    g.add(lathe(patchPts(CHEST_PROF, 0.075, 0.185, 4, 0.005), 8, -0.42, 0.84), null, 0, 0, 0, 0, 0, 0, CHEST_S[0], CHEST_S[1], CHEST_S[2], 1.45);
    numGeo = g.build(true); return numGeo;
  }

  function grp(parent, x, y, z) { var o = new THREE.Group(); o.position.set(x || 0, y || 0, z || 0); parent.add(o); return o; }
  function mesh(parent, geo, mat, small) {
    var m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.userData.small = !!small;
    parent.add(m); return m;
  }

  // =====================================================================
  //  POSE (estructura plana para mezclar capas)
  // =====================================================================
  // escalares
  var DROP = 0, PP = 1, PR = 2, PY = 3, CP = 4, CY = 5, CR = 6, HY = 7, HP = 8, HOP = 9, OX = 10, OZ = 11, PX = 12, PZ = 13,
    FPL = 14, FPR = 15, WRL = 16, WRR = 17, LOOK = 18, FYL = 19, FYR = 20, NS = 21;
  // vectores
  var HL = 0, HR = 1, AL = 2, AR = 3, FL = 4, FR = 5, KL = 6, KR = 7, NV = 8;
  function Pose() { this.s = new Float32Array(NS); this.v = []; for (var i = 0; i < NV; i++) this.v.push(new THREE.Vector3()); this.ra = 14; this.rb = 10; }
  function copyP(dst, src) { dst.s.set(src.s); for (var i = 0; i < NV; i++) dst.v[i].copy(src.v[i]); dst.ra = src.ra; dst.rb = src.rb; }
  function blendP(dst, src, w) {
    if (w <= 0) return; if (w > 1) w = 1;
    for (var i = 0; i < NS; i++) dst.s[i] += (src.s[i] - dst.s[i]) * w;
    for (var j = 0; j < NV; j++) dst.v[j].lerp(src.v[j], w);
    dst.ra = lerp(dst.ra, src.ra, w); dst.rb = lerp(dst.rb, src.rb, w);
  }

  // Temporales (sin asignaciones por frame)
  var T = null, T2 = null, BL, CL, tV, tV2, tV3, mA, mB, mInv, qA, qB, qC, qD, eA, IKx, IKy, IKz, IKm, ZERO3, XAXIS;

  // =====================================================================
  //  CONSTRUCCIÓN DEL RIG
  // =====================================================================
  function buildRig(p) {
    var id = p.id, team = p.team, L = LOOKS[id % LOOKS.length], tc = TEAMS[team];
    torsoGeos();
    var root = new THREE.Group(); root.name = 'athlete' + id; root.scale.setScalar(L.h);
    var body = grp(root);
    var pelvis = grp(body, 0, HIP_H, 0);
    mesh(pelvis, shortsGeo(tc), bodyMat);
    var spine = grp(pelvis, 0, SPINE_Y, 0);
    mesh(spine, absGeo, jerseyMats[team]);
    var chest = grp(spine, 0, CHEST_Y, 0);
    mesh(chest, chestGeo, jerseyMats[team]);
    var num = mesh(chest, numberGeo(), numberMaterial(p.num, team), true); num.castShadow = false; num.userData.noShadow = true;
    mesh(chest, neckGeo(L, tc), bodyMat, true);
    var head = grp(chest, 0, NECK_Y, 0.012); head.rotation.order = 'YXZ';
    mesh(head, headGeo(L, tc), bodyMat);
    var r = {
      p: p, id: id, team: team, num: p.num, root: root, body: body, pelvis: pelvis, spine: spine, chest: chest, head: head,
      sh: [], up: [], el: [], hand: [], hip: [], th: [], kn: [], ft: [],
      cur: new Pose(), tgt: new Pose(), inited: false,
      yaw: 0, yawT: 0, phase: 0, vf: 0, vl: 0, clock: Math.random() * 10, headYaw: 0, headPitch: 0,
      // tiempos de eventos (tiempo de juego), -99 = nunca
      hitT: -99, hitKind: '', hitC: new THREE.Vector3(), hitQ: 1,
      jumpT: -99, jumpKind: '', landT: -99, blockT: -99, swingT: -99,
      pointT: -99, pointWin: false, celeb: 0, matchEnd: false, mateHF: false,
      diveT: -99, diveYaw: 0, diveDist: 0, diveEnd: 1.0, tossT: -99, tossJump: false, hitShot: ''
    };
    for (var k = 0; k < 2; k++) {
      var s = k === 0 ? 1 : -1;
      var sh = grp(chest, s * SH_X, SH_Y, SH_Z), up = grp(sh);
      mesh(up, upperGeo(L, tc), bodyMat);
      var el = grp(up, 0, -UPPER, 0); mesh(el, foreGeo(L, tc, s), bodyMat, true);
      var hd = grp(el, 0, -FORE, 0); mesh(hd, handGeo(L), bodyMat, true);
      r.sh.push(sh); r.up.push(up); r.el.push(el); r.hand.push(hd);
      var hp = grp(pelvis, s * HIP_W, 0, 0), th = grp(hp);
      mesh(th, thighGeo(L, tc), bodyMat);
      var kn = grp(th, 0, -THIGH, 0); mesh(kn, shinGeo(L, tc), bodyMat);
      var ft = grp(kn, 0, -SHIN, 0); mesh(ft, shoeGeo(tc), bodyMat, true);
      r.hip.push(hp); r.th.push(th); r.kn.push(kn); r.ft.push(ft);
    }
    // alias públicos para cámara/FX (rigOf)
    r.handL = r.hand[0]; r.handR = r.hand[1]; r.footL = r.ft[0]; r.footR = r.ft[1];
    r.scale = L.h;
    applyShadowFlags(r);
    return r;
  }
  function applyShadowFlags(r) {
    r.root.traverse(function (o) { if (o.isMesh && o.userData.small) o.castShadow = smallShadows && !o.userData.noShadow; });
  }

  // =====================================================================
  //  CONVERSIONES sim -> espacio cuerpo
  // =====================================================================
  /** Punto de la sim -> espacio del cuerpo del rig (antes de desplazamientos del body). */
  function toBody(r, x, y, z, out) {
    var p = r.p, fx = Math.cos(r.yaw), fy = Math.sin(r.yaw), s = r.scale;
    var dx = x - p.x, dy = y - p.y;
    out.x = (dx * -fy + dy * fx) / s; out.z = (dx * fx + dy * fy) / s; out.y = (z - p.z) / s;
    return out;
  }

  // =====================================================================
  //  CAPAS DE POSE
  // =====================================================================
  function setV(v, x, y, z) { v.x = x; v.y = y; v.z = z; }

  /** Postura base. kind: 0 relajado, 1 preparado (rally), 2 espera de recepción (manos en rodillas), 3 preparado en red */
  function baseStance(r, P, kind, breath) {
    var s = P.s, v = P.v;
    s.fill(0); s[LOOK] = 1;
    P.ra = 12; P.rb = 9;
    var b = Math.sin(breath * 2.1) * 0.012;
    if (kind === 0) {
      s[DROP] = 0.035 + b * 0.3; s[PP] = 0.02; s[CP] = 0.03 + b; s[CY] = 0;
      setV(v[HL], 0.27, 0.8, 0.03); setV(v[HR], -0.27, 0.8, 0.03);
      setV(v[AL], 0.6, -0.2, -1); setV(v[AR], -0.6, -0.2, -1);
      setV(v[FL], 0.13, ANKLE, 0.03); setV(v[FR], -0.13, ANKLE, -0.02);
      s[FYL] = 0.12; s[FYR] = -0.12;
    } else if (kind === 2) {
      s[DROP] = 0.24 + b * 0.2; s[PP] = 0.32; s[CP] = 0.38 + b; s[HP] = -0.55;
      setV(v[HL], 0.17, 0.6, 0.27); setV(v[HR], -0.17, 0.6, 0.25);
      setV(v[AL], 1, 0, -0.4); setV(v[AR], -1, 0, -0.4);
      setV(v[FL], 0.27, ANKLE, 0.1); setV(v[FR], -0.27, ANKLE, -0.04);
      s[FYL] = 0.18; s[FYR] = -0.18;
    } else if (kind === 3) {
      s[DROP] = 0.17 + b * 0.2; s[PP] = 0.06; s[CP] = 0.05 + b;
      setV(v[HL], 0.27, 1.52, 0.24); setV(v[HR], -0.27, 1.52, 0.24);
      setV(v[AL], 0.8, -1, -0.3); setV(v[AR], -0.8, -1, -0.3);
      setV(v[FL], 0.2, ANKLE, 0.03); setV(v[FR], -0.2, ANKLE, 0.03);
      s[FYL] = 0.05; s[FYR] = -0.05;
    } else {
      s[DROP] = 0.19 + b * 0.25; s[PP] = 0.15; s[CP] = 0.22 + b;
      setV(v[HL], 0.2, 0.98, 0.46); setV(v[HR], -0.2, 0.98, 0.46);
      setV(v[AL], 0.35, -1, -0.25); setV(v[AR], -0.35, -1, -0.25);
      setV(v[FL], 0.26, ANKLE, 0.08); setV(v[FR], -0.26, ANKLE, -0.03);
      s[FYL] = 0.2; s[FYR] = -0.2;
    }
    setV(v[KL], 0.4, 0, 1); setV(v[KR], -0.4, 0, 1);
  }

  /** Locomoción: ciclo de zancada ligado a la velocidad real (sin patinar). */
  function locomotion(r, P, sp, dirX, dirZ, dt, snap, armsToo) {
    var m = sstep(0.25, 1.4, sp);
    if (m <= 0) return;
    var s = P.s, v = P.v, runK = sstep(1.8, 4.8, sp);
    var lat = Math.abs(dirX);
    var S = lerp(0.5, 0.37, runK);                       // fracción de apoyo
    var f = 1.5 + 0.21 * sp;                              // ciclos por segundo
    var maxStride = lerp(1.05, 0.42, lat);
    if (sp * S / f > maxStride) f = sp * S / maxStride;
    var stride = sp * S / f / r.scale;
    if (!snap) r.phase += PI * 2 * f * dt;
    var lift = (0.06 + 0.11 * runK) * (1 - lat * 0.4);
    var cosL = 0;
    for (var k = 0; k < 2; k++) {
      var u = r.phase / (PI * 2) + (k ? 0.5 : 0); u -= Math.floor(u);
      var along, up = 0, pitch = 0;
      if (u < S) { along = stride * (0.5 - u / S); }
      else { var w = (u - S) / (1 - S); along = stride * (-0.5 + w * w * (3 - 2 * w)); up = Math.sin(PI * w) * lift; pitch = -Math.sin(PI * w) * 0.5 * (1 - lat); }
      var sd = k ? -1 : 1, fv = v[FL + k];
      var bx = sd * lerp(0.13, 0.17, lat), bz = 0.02;
      fv.x = lerp(fv.x, bx + dirX * along, m); fv.y = lerp(fv.y, ANKLE + up, m); fv.z = lerp(fv.z, bz + dirZ * along, m);
      s[FPL + k] = lerp(s[FPL + k], pitch + (u < S ? 0 : 0.15), m);
      s[FYL + k] = lerp(s[FYL + k], sd * 0.06, m);
      if (k === 0) cosL = Math.cos(PI * 2 * u);
    }
    var bob = Math.cos(r.phase * 2) * 0.028 * runK;
    s[DROP] = lerp(s[DROP], lerp(0.12, 0.09, runK) + bob, m);
    s[PP] = lerp(s[PP], 0.06 + dirZ * 0.2 * runK, m);
    s[PR] = lerp(s[PR], -dirX * 0.1 * runK, m);
    s[CP] = lerp(s[CP], 0.12 + dirZ * 0.12 * runK, m);
    s[CY] = lerp(s[CY], cosL * 0.22 * runK * (1 - lat), m);
    s[PY] = lerp(s[PY], -cosL * 0.12 * runK * (1 - lat), m);
    if (armsToo) {
      var fw = (1 - lat) * m, a = 0.3 * runK + 0.08;
      // brazos en contrafase con las piernas, codos a ~90º
      v[HL].lerp(tV.set(0.22, 1.02 + Math.max(0, -cosL) * 0.12, 0.1 - cosL * a), fw);
      v[HR].lerp(tV.set(-0.22, 1.02 + Math.max(0, cosL) * 0.12, 0.1 + cosL * a), fw);
      v[AL].lerp(tV.set(0.4, -0.3, -1), fw); v[AR].lerp(tV.set(-0.4, -0.3, -1), fw);
      // desplazamiento lateral: brazos abiertos de equilibrio
      v[HL].lerp(tV.set(0.32, 1.0, 0.25), lat * m * 0.7); v[HR].lerp(tV.set(-0.32, 1.0, 0.25), lat * m * 0.7);
    }
  }

  /** Pose en el aire. kind: 'attack' | 'block' | 'plain' */
  function airPose(r, P, kind, tj, prox, g) {
    var s = P.s, v = P.v;
    if (kind === 'block') {
      s[DROP] = -0.03; s[PP] = 0.02; s[CP] = 0.06; s[CY] = 0; s[PY] = 0; s[PR] = 0;
      var up = sstep(0.0, 0.16, tj);
      setV(v[HL], 0.17, lerp(1.7, 2.36, up), lerp(0.18, 0.42, up)); setV(v[HR], -0.17, lerp(1.7, 2.36, up), lerp(0.18, 0.42, up));
      setV(v[AL], 1, 0.1, -0.6); setV(v[AR], -1, 0.1, -0.6);
      s[WRL] = s[WRR] = -0.25;
      setV(v[FL], 0.13, ANKLE + 0.06, 0.0); setV(v[FR], -0.13, ANKLE + 0.06, 0.0);
      s[FPL] = s[FPR] = 0.55; s[FYL] = 0.08; s[FYR] = -0.08;
      P.ra = 22; P.rb = 14;
    } else if (kind === 'attack') {
      // arco: brazos arriba en el despegue, luego "arco y flecha"
      var a1 = sstep(0.0, 0.17, tj), cock = sstep(0.1, 0.3, tj) * (1 - prox);
      s[DROP] = -0.06; s[PP] = lerp(0.1, -0.12, cock); s[CP] = lerp(0.05, -0.2, cock); s[CY] = -0.5 * cock + prox * 0.35; s[CR] = 0.08 * cock;
      setV(v[HL], 0.2, lerp(1.1, 2.32, a1), lerp(-0.1, 0.38, a1));
      setV(v[HR], lerp(-0.2, -0.34, cock), lerp(1.1 + 1.2 * a1, 1.86, cock), lerp(-0.1 + 0.4 * a1, -0.22, cock));
      setV(v[AL], 1, -0.2, -0.3); setV(v[AR], -1, 0.7, -0.6);
      // piernas recogidas hacia atrás (arqueo)
      setV(v[FL], 0.12, ANKLE + 0.28 * a1, -0.22 * a1); setV(v[FR], -0.13, ANKLE + 0.36 * a1, -0.3 * a1);
      s[FPL] = s[FPR] = 0.7;
      P.ra = 18; P.rb = 12;
    } else {
      var a2 = sstep(0.0, 0.2, tj);
      s[DROP] = -0.02;
      setV(v[HL], 0.24, lerp(1.0, 2.15, a2), 0.2); setV(v[HR], -0.24, lerp(1.0, 2.15, a2), 0.2);
      setV(v[AL], 1, 0, -0.5); setV(v[AR], -1, 0, -0.5);
      setV(v[FL], 0.13, ANKLE + 0.12, -0.05); setV(v[FR], -0.13, ANKLE + 0.18, -0.1);
      s[FPL] = s[FPR] = 0.6;
      P.ra = 16; P.rb = 12;
    }
  }

  /** Recepción de antebrazos hacia el punto de contacto Pc (espacio cuerpo). follow: 0..1 acompañamiento. */
  function passPose(r, P, Pc, follow) {
    var s = P.s, v = P.v;
    var hx = Pc.x, hz = Pc.z, dh = Math.hypot(hx, hz) || 1e-3, nx = hx / dh, nz = hz / dh;
    var reach = clamp((dh - 0.35) / 0.9, 0, 1), low = clamp((1.15 - Pc.y) / 0.8, 0, 1);
    s[PX] = nx * (0.3 + 0.15 * low) * reach; s[PZ] = nz * (0.3 + 0.15 * low) * reach;
    s[DROP] = 0.28 + 0.1 * reach + 0.22 * low - 0.1 * follow;
    s[PP] = 0.22 + 0.12 * low; s[CP] = 0.12 + 0.1 * reach + 0.12 * low - 0.12 * follow; s[HP] = -0.15;
    s[CY] = clamp(Math.atan2(nx, nz) * 0.45, -0.6, 0.6); s[PR] = -nx * 0.12 * reach;
    // dirección desde el centro de los hombros (pose ya agachada) hacia debajo del balón
    var shy = 1.53 - s[DROP] - 0.12 * s[CP], shz = 0.32 * s[CP] + s[PZ], shx = s[PX];
    var ax = clamp(hx, -1.2, 1.2) - shx, ay = clamp(Pc.y - 0.16, 0.2, 1.6) + follow * 0.35 - shy, az = Math.max(0.25, hz) - shz;
    var al = Math.sqrt(ax * ax + ay * ay + az * az) || 1, R = 0.64;
    setV(v[HL], shx + ax / al * R + 0.03, shy + ay / al * R, shz + az / al * R);
    setV(v[HR], shx + ax / al * R - 0.03, shy + ay / al * R, shz + az / al * R);
    setV(v[AL], 0.5, -1, 0.1); setV(v[AR], -0.5, -1, 0.1);
    s[WRL] = s[WRR] = 0.25;
    // paso hacia el balón con el pie de ese lado; el otro se abre
    var k = nx >= 0 ? 0 : 1, sd = k ? -1 : 1;
    setV(v[FL + k], sd * 0.22 + nx * (0.42 + 0.2 * low) * reach, ANKLE, 0.12 + nz * (0.42 + 0.2 * low) * reach);
    setV(v[FL + 1 - k], -sd * 0.3, ANKLE, -0.08);
    s[FPL] = s[FPR] = 0; s[FYL] = 0.25; s[FYR] = -0.25;
    P.ra = 20; P.rb = 12;
  }

  /** Colocación de dedos sobre la frente; Pc: balón (espacio cuerpo) o null. ext: extensión tras el contacto */
  function setPose(r, P, Pc, near, ext) {
    var s = P.s, v = P.v;
    var cx = 0, cy = 2.0, cz = 0.2;
    if (Pc && near > 0) { cx = lerp(cx, clamp(Pc.x, -0.35, 0.35), near); cy = lerp(cy, clamp(Pc.y - 0.16, 1.85, 2.3), near); cz = lerp(cz, clamp(Pc.z, 0.05, 0.45), near); }
    cy += ext * 0.25; cz += ext * 0.12;
    setV(v[HL], cx + 0.095 - ext * 0.02, cy, cz); setV(v[HR], cx - 0.095 + ext * 0.02, cy, cz);
    setV(v[AL], 1, -0.4, 0.3); setV(v[AR], -1, -0.4, 0.3);
    s[WRL] = s[WRR] = lerp(-1.1, -0.4, ext);
    s[DROP] = lerp(0.16, 0.02, ext); s[PP] = 0.04; s[CP] = lerp(-0.12, -0.05, ext); s[CY] = 0; s[HP] = -0.15;
    setV(v[FL], 0.2, ANKLE, 0.1); setV(v[FR], -0.2, ANKLE, -0.08);
    s[FPL] = 0; s[FPR] = lerp(0, 0.3, ext);
    P.ra = 20; P.rb = 12;
  }

  /** Golpe por arriba con el brazo derecho (remate en el aire, balón libre o saque) */
  function strikeArm(P, contact, tau, follow) {
    var v = P.v, s = P.s;
    var t1 = sstep(0.0, 0.2, tau);
    // del contacto al acompañamiento cruzado delante del cuerpo
    v[HR].set(lerp(contact.x, follow.x, t1), lerp(contact.y, follow.y, t1), lerp(contact.z, follow.z, t1));
    v[AR].set(-1, lerp(0.3, -0.6, t1), lerp(-0.4, -0.1, t1));
    v[HL].set(0.18, lerp(1.95, 1.25, t1), lerp(0.35, 0.3, t1));
    v[AL].set(1, -0.5, -0.4);
    s[CY] = lerp(0.2, 0.35, t1); s[CP] = lerp(0.1, 0.45, t1);
    P.ra = 38;
  }

  // =====================================================================
  //  POSE OBJETIVO (por jugador)
  // =====================================================================
  var HW = { t: 0, d: 0, dz: 0, kind: '', zc: 0, x: 0, y: 0, z: 0, reach: false, attack: false, jumpT: NaN };
  /** Contacto previsto del jugador (instante y punto). Usa VB.Sim.hitWindow si existe. */
  function predictHit(g, p, r) {
    var S = VB.Sim;
    if (S.hitWindow) { try { return S.hitWindow(g, p, HW); } catch (e) { } }
    var b = g.ball, k = predictedKind(g, p), h = p.z + (k === 'pass' ? 0.9 : k === 'set' ? 2.15 : k === 'spike' ? 2.45 : 1.6);
    var t = timeTo(b, h);
    HW.t = t; HW.kind = k; HW.x = b.x + b.vx * t; HW.y = b.y + b.vy * t; HW.z = h; HW.d = Math.hypot(HW.x - p.x, HW.y - p.y);
    HW.attack = false; HW.jumpT = NaN; HW.reach = HW.d < C.REACH; return HW;
  }
  function timeTo(b, h) { // tiempo hasta que el balón baja a la altura h (0 si ya está por debajo bajando)
    var G = C.G, d = b.z - h;
    if (d <= 0) return b.vz > 0 ? 9 : 0;
    return (b.vz + Math.sqrt(b.vz * b.vz + 2 * G * d)) / G;
  }
  function predictedKind(g, p) {
    var t = p.team, b = g.ball;
    if (p.z > 0.2 && Math.abs(b.x) < 3.8 && b.z > C.NET_H + 0.1) return 'spike';
    var count = g.touchTeam === t ? g.touches + 1 : 1;
    return count === 3 ? 'free' : count === 1 ? 'pass' : 'set';
  }

  function computeTarget(g, r, dt, snap) {
    var p = r.p, P = r.tgt, b = g.ball, tm = g.time, mode = g.mode, sd = side(p.team);
    var air = p.z > 0.012, sp = Math.hypot(p.vx, p.vy);
    toBody(r, b.x, b.y, b.z, BL);
    var job = mode === 'rally' && g.jobs && g.jobs[p.team] === p;
    var oppAttack = mode === 'rally' && g.touchTeam === 1 - p.team && g.touches >= 1;
    var nearNet = Math.abs(p.x) < 1.7;
    var serving = mode === 'serve' && b.held === p;
    var serveTeam = mode === 'serve' && g.serving === p.team;

    // ---- 1. postura base
    var kind = 1;
    if (mode === 'rally') kind = (nearNet && oppAttack && !job) ? 3 : 1;
    else if (mode === 'serve') kind = serveTeam ? (Math.abs(p.x) < 4.5 ? 3 : 0) : (g.timer > 0.55 || !b.held || b.held.team === 0 ? 2 : 1);
    else kind = 0;
    if (mode === 'serve' && !serveTeam && b.held && b.held.team === 0 && !g.demo && !g.autopilot) kind = 2;
    baseStance(r, P, kind, r.clock + r.id * 1.3);
    if (mode === 'serve' && kind === 2 && b.held && b.held.team === 0) {
      // contra el saque humano no hay temporizador: pasan a preparados poco a poco
    }

    // ---- 2. locomoción
    if (!air) {
      var vf = r.vf, vl = r.vl, vs = Math.hypot(vf, vl);
      var turn = Math.abs(r.yawRate || 0) * 0.35;
      var drive = Math.max(vs, turn);
      if (drive > 0.25) {
        var dx = vs > 0.05 ? vl / vs : 1, dz = vs > 0.05 ? vf / vs : 0;
        locomotion(r, P, drive, dx, dz, dt, snap, true);
      }
    }

    // ---- predicción de contacto (VB.Sim.hitWindow: instante y punto ideales del próximo toque)
    var hitAge = tm - r.hitT;
    var recentHit = hitAge >= 0 && hitAge < 0.45;
    var tossing = mode === 'serve' && g.serveState === 'toss' && g.server === p;
    var hw = null;
    if ((job || tossing) && !recentHit) hw = predictHit(g, p, r);
    if (hw) toBody(r, hw.x, hw.y, hw.z, CL);

    // ---- 3. aire
    var tj = tm - r.jumpT;
    if (air && tj >= 0 && tj < 1.6) {
      var prox = 0;
      if (r.jumpKind === 'attack') {
        if (hw && (hw.kind === 'spike' || hw.kind === 'jserve' || hw.kind === 'fserve') && hw.d < 1.6) prox = 1 - sstep(0.03, 0.26, hw.t);
        else if (!hw) { // sin predicción: proximidad del balón al punto de golpeo
          var ddx = BL.x + 0.22, ddy = BL.y - 2.25, ddz = BL.z - 0.25, dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          prox = (1 - sstep(0.35, 1.25, dd)) * (b.vz < 1.5 ? 1 : 0.5);
        }
        if (recentHit) prox = 0;
      }
      copyP(T2, P); airPose(r, T2, r.jumpKind, tj, prox, g);
      if (r.jumpKind === 'attack' && prox > 0) {
        // el brazo derecho busca el balón (contacto previsto si lo hay)
        if (hw) tV.copy(CL); else tV.copy(BL);
        tV.y += 0.04; if (tV.x > 0.05) tV.x = 0.05;
        T2.v[HR].lerp(tV, prox);
        T2.v[AR].lerp(tV2.set(-1, 0.2, -0.3), prox);
        T2.v[HL].lerp(tV2.set(0.2, 1.7, 0.38), prox);
        T2.s[CY] = lerp(T2.s[CY], 0.25, prox); T2.s[CP] = lerp(T2.s[CP], 0.2, prox);
        T2.ra = 34;
      }
      blendP(P, T2, 1);
      // salto visual algo más alto en el remate (más atlético; no cambia la sim)
      if (r.jumpKind === 'attack') P.s[HOP] = 0.16 * clamp(p.z / 1.05, 0, 1);
      if (r.jumpKind === 'block') P.s[HOP] = 0.06 * clamp(p.z / 1.05, 0, 1);
    }
    // aterrizaje: amortiguación
    var tl = tm - r.landT;
    if (!air && tl >= 0 && tl < 0.35) {
      var w = Math.sin(clamp(tl / 0.35, 0, 1) * PI) * (1 - tl / 0.35 * 0.3);
      P.s[DROP] += 0.22 * w; P.s[PP] += 0.25 * w; P.s[CP] += 0.15 * w;
      P.v[HL].y -= 0.25 * w; P.v[HR].y -= 0.25 * w;
    }

    // ---- 4. anticipación del que va al balón
    if (hw && !air && !tossing) {
      var pk = hw.kind, ht = hw.t, hz = hw.z - p.z;
      if (hw.attack && hw.jumpT === hw.jumpT) {
        // carrera de ataque: brazos atrás y flexión justo antes del despegue
        var wB = sstep(0.7, 0.12, hw.jumpT) * (hw.jumpT > -0.1 ? 1 : 0);
        if (wB > 0) {
          copyP(T2, P);
          T2.s[DROP] = 0.32; T2.s[PP] = 0.3; T2.s[CP] = 0.42;
          setV(T2.v[HL], 0.24, 0.8, -0.45); setV(T2.v[HR], -0.24, 0.8, -0.45);
          setV(T2.v[AL], 0.6, 0.2, 1); setV(T2.v[AR], -0.6, 0.2, 1);
          T2.ra = 14; blendP(P, T2, wB);
        }
      } else if (ht > -0.05 && hw.d < 2.6) {
        if (pk === 'pass' || (pk === 'free' && hz < 1.75)) {
          var wA = 1 - sstep(0.18, 0.75, ht);
          if (wA > 0) { copyP(T2, P); passPose(r, T2, CL, 0); blendP(P, T2, wA); }
        } else if (pk === 'set') {
          var wS = 1 - sstep(0.25, 0.9, ht);
          if (wS > 0) { copyP(T2, P); setPose(r, T2, CL, 1 - sstep(0.05, 0.4, ht), 0); blendP(P, T2, wS); }
        } else if (pk === 'free') {
          // golpe por arriba de pie: armar y soltar el brazo al contacto
          var wF = 1 - sstep(0.25, 0.75, ht), sw = 1 - sstep(0.03, 0.22, ht);
          if (wF > 0) {
            copyP(T2, P);
            setV(T2.v[HR], -0.3, 1.88, -0.2); setV(T2.v[AR], -1, 0.7, -0.6);
            setV(T2.v[HL], 0.2, 2.1, 0.35); T2.s[CY] = -0.35;
            if (sw > 0) { T2.v[HR].lerp(CL, sw); T2.v[HL].lerp(tV2.set(0.2, 1.6, 0.35), sw); T2.s[CY] = lerp(-0.35, 0.2, sw); T2.ra = 32; }
            blendP(P, T2, wF);
          }
        }
      }
    }
    // ---- 5. gestos tras el contacto (tiempos exactos de los eventos)
    if (hitAge >= 0 && hitAge < 0.9) {
      var hk = r.hitKind, wOut;
      if (r.hitShot === 'dive') { /* la plancha manda */ }
      else if (hk === 'pass') {
        wOut = 1 - sstep(0.3, 0.6, hitAge);
        copyP(T2, P); passPose(r, T2, r.hitC, sstep(0.0, 0.18, hitAge)); blendP(P, T2, wOut);
      } else if (hk === 'set') {
        wOut = 1 - sstep(0.32, 0.6, hitAge);
        copyP(T2, P); setPose(r, T2, r.hitC, 1, sstep(0.0, 0.15, hitAge)); blendP(P, T2, wOut);
      } else if (hk === 'spike' || hk === 'free' || hk === 'serve') {
        var dur = hk === 'serve' ? 0.75 : 0.6;
        wOut = 1 - sstep(dur * 0.55, dur, hitAge);
        copyP(T2, P);
        if (hk === 'serve') {
          T2.s[DROP] = 0.08; T2.s[PP] = 0.12;
          setV(T2.v[FL], 0.13, ANKLE, 0.18); setV(T2.v[FR], -0.14, ANKLE, lerp(-0.15, 0.32, sstep(0.08, 0.35, hitAge)));
          T2.s[FPR] = 0.35 * (1 - sstep(0.2, 0.4, hitAge));
        }
        if (r.hitShot === 'tip') tV2.set(-0.05, 2.0, 0.55); else tV2.set(0.12, hk === 'serve' ? 1.15 : 0.95, 0.4);
        strikeArm(T2, r.hitC, hk === 'serve' || r.hitShot !== 'tip' ? hitAge : hitAge * 0.5, tV2);
        blendP(P, T2, wOut);
      }
    }
    var blkAge = tm - r.blockT;
    if (blkAge >= 0 && blkAge < 0.5 && air) {
      var push = Math.sin(clamp(blkAge / 0.25, 0, 1) * PI);
      P.v[HL].z += 0.12 * push; P.v[HR].z += 0.12 * push; P.v[HL].y += 0.04 * push; P.v[HR].y += 0.04 * push;
    }
    var swAge = tm - r.swingT;
    if (swAge >= 0 && swAge < 0.3 && !(hitAge >= 0 && hitAge < 0.5)) {
      var ws = Math.sin(clamp(swAge / 0.3, 0, 1) * PI);
      copyP(T2, P);
      if (air) strikeArm(T2, tV3.set(-0.15, 2.3, 0.45), swAge, tV2.set(0.1, 1.0, 0.4));
      else { setV(T2.v[HL], 0.03, 0.85, 0.55); setV(T2.v[HR], -0.03, 0.85, 0.55); T2.s[DROP] += 0.08; T2.ra = 25; }
      blendP(P, T2, ws);
    }

    // ---- 6. saque: sostener el balón, lanzarlo (toss) y golpear
    if (serving || (tossing && !air)) {
      copyP(T2, P);
      var s2 = T2.s, v2 = T2.v, tt = tossing ? tm - r.tossT : -1;
      s2[DROP] = 0.06; s2[PP] = 0.05; s2[CP] = 0.04; s2[CY] = -0.3; s2[LOOK] = 0.45;
      setV(v2[FL], 0.12, ANKLE, 0.2); setV(v2[FR], -0.15, ANKLE, -0.14);
      s2[FYL] = 0.05; s2[FYR] = -0.35;
      T2.ra = 10;
      if (serving) {
        // balón en la mano izquierda, brazo derecho armado (bota el balón levemente con la sim)
        setV(v2[HL], BL.x + 0.02, BL.y - 0.2, BL.z); setV(v2[AL], 1, -0.6, -0.2); s2[WRL] = 0.9;
        setV(v2[HR], -0.3, 1.7, -0.13); setV(v2[AR], -1, 0.5, -0.7);
      } else if (r.tossJump) {
        // saque en salto: lanzamiento alto con la izquierda y carrera con brazos atrás antes del despegue
        var toJump = (g.jumpAt || 0.6) - (g.tossT || tt), back = sstep(0.55, 0.1, toJump);
        var up = sstep(0.0, 0.14, tt) * (1 - sstep(0.16, 0.4, tt));
        setV(v2[HL], 0.2, lerp(lerp(1.2, 2.25, up), 0.85, back), lerp(0.3, -0.45, back));
        setV(v2[HR], -0.24, lerp(1.1, 0.85, back), lerp(0.1, -0.45, back));
        setV(v2[AL], 0.6, 0.2, 1); setV(v2[AR], -0.6, 0.2, 1);
        s2[DROP] = lerp(0.12, 0.3, back); s2[PP] = lerp(0.1, 0.3, back); s2[CP] = lerp(0.1, 0.4, back); s2[CY] = 0; s2[LOOK] = 1;
        T2.ra = 16;
      } else {
        // flotante: la izquierda acompaña el lanzamiento y señala el balón; la derecha armada y luego al balón
        var lift = sstep(0.0, 0.16, tt), sw2 = hw ? 1 - sstep(0.03, 0.24, hw.t) : 0;
        setV(v2[HL], lerp(BL.x, 0.12, lift), lerp(1.75, 2.2, lift), lerp(0.25, 0.32, lift)); setV(v2[AL], 1, -0.3, -0.2);
        setV(v2[HR], -0.32, 1.95, -0.26); setV(v2[AR], -1, 0.7, -0.6);
        s2[CY] = -0.45; s2[CP] = -0.08; s2[LOOK] = 1;
        if (sw2 > 0) {
          tV.copy(CL); if (tV.x > 0.05) tV.x = 0.05;
          v2[HR].lerp(tV, sw2); v2[AR].lerp(tV2.set(-1, 0.2, -0.3), sw2);
          v2[HL].lerp(tV2.set(0.22, 1.25, 0.3), sw2); s2[CY] = lerp(-0.45, 0.25, sw2); s2[CP] = lerp(-0.08, 0.15, sw2);
          T2.ra = 34;
        }
      }
      blendP(P, T2, 1);
    }

    // ---- 7. plancha (balón que cae lejos y no se alcanza)
    var dv = tm - r.diveT, dEnd = r.diveEnd + 0.75;
    if (dv >= 0 && dv < dEnd) divePose(r, P, dv);

    // ---- 8. celebración / lamento tras el punto
    var pa = tm - r.pointT;
    var diving = dv >= 0 && dv < dEnd;
    if ((mode === 'point' || mode === 'over') && r.pointT > -50 && pa >= 0 && !air && (!diving || dv > dEnd - 0.3)) celebrate(g, r, P, diving ? dv - (dEnd - 0.3) : pa);
  }

  function divePose(r, P, t) {
    var s = P.s, v = P.v;
    var go = sstep(0.0, 0.2, t), down = sstep(0.12, 0.36, t), up = sstep(r.diveEnd, r.diveEnd + 0.55, t);
    var lie = down * (1 - up), reach = go * (1 - up);
    var dist = r.diveDist;
    s[OZ] = lerp(0, dist, go) * (1 - up * 0.0); s[OX] = 0;
    s[LOOK] = 1 - lie * 0.5;
    // tumbado: pelvis casi horizontal (PP*0.6) y tronco recto (CP compensa el reparto de la columna)
    s[PP] = lerp(0.3 * reach, 2.4, lie); s[CP] = lerp(0.35 * reach, -0.92, lie); s[CY] = 0; s[PY] = 0; s[PR] = 0;
    s[DROP] = lerp(0.3 * reach, 0.87, lie); s[HP] = -0.55 * lie;
    s[PZ] = 0.1 * lie;
    // brazos estirados hacia el balón, luego apoyados delante
    setV(v[HL], 0.17, lerp(0.7, 0.1, lie), lerp(0.9, 1.3, lie)); setV(v[HR], -0.17, lerp(0.7, 0.1, lie), lerp(0.9, 1.3, lie));
    setV(v[AL], 1, -0.5, 0); setV(v[AR], -1, -0.5, 0);
    // piernas: zancada larga y luego extendidas detrás
    setV(v[FL], 0.18, ANKLE + 0.02 * lie, lerp(0.55 * reach, -0.9, lie)); setV(v[FR], -0.2, ANKLE + 0.04 * lie, lerp(-0.3, -0.95, lie));
    setV(v[KL], 0.1, -lie, 1 - lie); setV(v[KR], -0.1, -lie, 1 - lie);
    s[FPL] = s[FPR] = 1.3 * lie;
    P.ra = lerp(18, 10, up); P.rb = lerp(14, 6, up);
  }

  /** Celebraciones y lamentos (variadas, deterministas). */
  function celebrate(g, r, P, t) {
    var s = P.s, v = P.v, c = r.celeb, ramp = sstep(0.0, 0.25, t), big = r.matchEnd;
    copyP(T2, P);
    var s2 = T2.s, v2 = T2.v;
    if (r.pointWin) {
      if (big) {
        // fin de partido ganado: saltos con los brazos arriba
        var hop = Math.abs(Math.sin(t * 6.5)) * 0.24 * (1 - sstep(2.5, 3.5, t));
        s2[HOP] = hop; s2[DROP] = 0.05; s2[CP] = -0.15; s2[HP] = -0.5; s2[LOOK] = 0.2;
        setV(v2[HL], 0.42, 2.25 + hop * 0.2, 0.1); setV(v2[HR], -0.42, 2.25 + hop * 0.2, 0.1);
        setV(v2[AL], 1, 0, -0.5); setV(v2[AR], -1, 0, -0.5);
        setV(v2[FL], 0.13, ANKLE + hop * 0.6, 0.0); setV(v2[FR], -0.13, ANKLE + hop * 0.5, 0.0); s2[FPL] = s2[FPR] = hop * 2;
      } else if (c === 2 && r.mateHF) {
        // choca la mano con el compañero (orientado hacia él en update)
        var hf = sstep(0.1, 0.35, t), back = sstep(0.55, 0.8, t);
        s2[LOOK] = 0; s2[DROP] = 0.06; s2[CP] = -0.04;
        setV(v2[HR], -0.12, lerp(1.4, 2.05, hf) - back * 0.4, lerp(0.2, 0.42, hf));
        setV(v2[AR], -1, -0.2, -0.5);
        setV(v2[HL], 0.26, 0.95, 0.15);
        s2[HOP] = Math.sin(clamp((t - 0.25) / 0.3, 0, 1) * PI) * 0.1;
      } else if (c === 1) {
        // brazos en V con dos saltitos
        var hp2 = Math.abs(Math.sin(t * 7)) * 0.13 * (1 - sstep(0.9, 1.2, t));
        s2[HOP] = hp2; s2[CP] = -0.12; s2[HP] = -0.35; s2[LOOK] = 0.3;
        setV(v2[HL], 0.48, 2.15, 0.12); setV(v2[HR], -0.48, 2.15, 0.12);
        setV(v2[AL], 1, 0, -0.4); setV(v2[AR], -1, 0, -0.4);
        setV(v2[FL], 0.13, ANKLE + hp2 * 0.4, 0); setV(v2[FR], -0.13, ANKLE + hp2 * 0.4, 0);
      } else {
        // "¡vamos!": puño arriba y tirón hacia la cadera, dos veces, agachado y gritando
        var ph = t * 2.6, pump = ph < 2 ? sstep(0, 0.35, ph - Math.floor(ph)) : 1;
        s2[DROP] = lerp(0.1, 0.26, pump); s2[PP] = lerp(0.05, 0.2, pump); s2[CP] = lerp(0.0, 0.3, pump); s2[CY] = lerp(0, -0.3, pump); s2[HP] = -0.25; s2[LOOK] = 0.2;
        setV(v2[HR], lerp(-0.3, -0.24, pump), lerp(1.95, 1.18, pump), lerp(0.22, 0.1, pump)); setV(v2[AR], -0.6, -1, -0.5);
        setV(v2[HL], 0.26, lerp(1.05, 0.95, pump), lerp(0.2, 0.3, pump)); setV(v2[AL], 0.6, -1, -0.3);
        setV(v2[FL], 0.28, ANKLE, 0.12); setV(v2[FR], -0.28, ANKLE, -0.05);
      }
    } else {
      if (big) {
        // partido perdido: en cuclillas con las manos en la cabeza
        s2[DROP] = 0.5; s2[PP] = 0.4; s2[CP] = 0.45; s2[HP] = 0.5; s2[LOOK] = 0;
        setV(v2[HL], 0.12, 1.45, 0.05); setV(v2[HR], -0.12, 1.45, 0.05);
        setV(v2[AL], 1, 0.6, 0.6); setV(v2[AR], -1, 0.6, 0.6);
        setV(v2[FL], 0.24, ANKLE, 0.14); setV(v2[FR], -0.24, ANKLE, 0.0);
      } else if (c === 1) {
        // manos en la cabeza, mirando arriba
        s2[DROP] = 0.03; s2[CP] = -0.08; s2[HP] = -0.35; s2[LOOK] = 0;
        setV(v2[HL], 0.1, 1.86, -0.04); setV(v2[HR], -0.1, 1.86, -0.04);
        setV(v2[AL], 1, 0.3, 0.2); setV(v2[AR], -1, 0.3, 0.2);
        s2[WRL] = s2[WRR] = 0.6;
      } else if (c === 2) {
        // manos en las rodillas, cabeza baja
        s2[DROP] = 0.25; s2[PP] = 0.35; s2[CP] = 0.45; s2[HP] = 0.45; s2[LOOK] = 0;
        setV(v2[HL], 0.17, 0.6, 0.27); setV(v2[HR], -0.17, 0.6, 0.25);
        setV(v2[AL], 1, 0, -0.4); setV(v2[AR], -1, 0, -0.4);
        setV(v2[FL], 0.26, ANKLE, 0.08); setV(v2[FR], -0.26, ANKLE, -0.03);
      } else {
        // brazos en jarras, cabeza gacha
        s2[DROP] = 0.04; s2[CP] = 0.05; s2[HP] = 0.4; s2[LOOK] = 0;
        setV(v2[HL], 0.26, 1.03, -0.02); setV(v2[HR], -0.26, 1.03, -0.02);
        setV(v2[AL], 1, 0, 0.2); setV(v2[AR], -1, 0, 0.2);
        s2[WRL] = s2[WRR] = -0.6;
      }
    }
    T2.ra = 10; T2.rb = 8;
    blendP(P, T2, ramp);
  }

  // =====================================================================
  //  IK de dos huesos
  // =====================================================================
  /** Orienta `upper` (hueso que cuelga en -Y) y dobla `lower` (rotación X) para llevar el extremo a (tx,ty,tz),
   *  expresado en el espacio del padre de `upper` relativo a su pivote. pole: hacia dónde apunta el codo/rodilla. */
  function solveIK(upper, lower, tx, ty, tz, px, py, pz, l1, l2) {
    var L = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (L < 1e-5) { tx = 0; ty = -1; tz = 0; L = 1e-5; }
    var vx = tx / L, vy = ty / L, vz = tz / L;
    var Lc = clamp(L, Math.abs(l1 - l2) + 0.02, (l1 + l2) * 0.9995);
    var cosA = clamp((l1 * l1 + Lc * Lc - l2 * l2) / (2 * l1 * Lc), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    var cosE = clamp((l1 * l1 + l2 * l2 - Lc * Lc) / (2 * l1 * l2), -1, 1), bend = PI - Math.acos(cosE);
    // componente del polo perpendicular a v
    var pd = px * vx + py * vy + pz * vz, qx = px - pd * vx, qy = py - pd * vy, qz = pz - pd * vz, ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (ql < 1e-4) { // polo paralelo: cualquier perpendicular
      if (Math.abs(vy) < 0.9) { qx = -vz; qy = 0; qz = vx; } else { qx = 0; qy = vz; qz = -vy; }
      ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
    }
    qx /= ql; qy /= ql; qz /= ql;
    // dirección del hueso superior y dirección de flexión
    var dx = vx * cosA + qx * sinA, dy = vy * cosA + qy * sinA, dz = vz * cosA + qz * sinA;
    var bx = vx * sinA - qx * cosA, by = vy * sinA - qy * cosA, bz = vz * sinA - qz * cosA;
    IKy.set(-dx, -dy, -dz); IKz.set(bx, by, bz); IKx.crossVectors(IKy, IKz);
    IKm.makeBasis(IKx, IKy, IKz);
    upper.quaternion.setFromRotationMatrix(IKm);
    lower.quaternion.setFromAxisAngle(XAXIS, -bend);
  }

  // =====================================================================
  //  APLICAR POSE
  // =====================================================================
  function dampPose(r, dt, snap) {
    var c = r.cur, t = r.tgt;
    var ka = snap ? 1 : kf(t.ra, dt), kb = snap ? 1 : kf(t.rb, dt), kfeet = snap ? 1 : kf(Math.max(30, t.ra), dt);
    for (var i = 0; i < NS; i++) {
      var k = (i === WRL || i === WRR) ? ka : (i === FPL || i === FPR || i === FYL || i === FYR) ? kfeet : kb;
      c.s[i] += (t.s[i] - c.s[i]) * k;
    }
    c.v[HL].lerp(t.v[HL], ka); c.v[HR].lerp(t.v[HR], ka);
    c.v[AL].lerp(t.v[AL], ka); c.v[AR].lerp(t.v[AR], ka);
    c.v[FL].lerp(t.v[FL], kfeet); c.v[FR].lerp(t.v[FR], kfeet);
    c.v[KL].lerp(t.v[KL], kb); c.v[KR].lerp(t.v[KR], kb);
  }

  function applyPose(r) {
    var c = r.cur, s = c.s, v = c.v;
    r.body.position.set(s[OX], s[HOP], s[OZ]);
    r.pelvis.position.set(s[PX], HIP_H - s[DROP], s[PZ]);
    eA.set(s[PP] * 0.6, s[PY], s[PR], 'YXZ'); r.pelvis.quaternion.setFromEuler(eA);
    eA.set(s[PP] * 0.4 + s[CP] * 0.45, s[CY] * 0.4, s[CR] * 0.5, 'YXZ'); r.spine.quaternion.setFromEuler(eA);
    eA.set(s[CP] * 0.55, s[CY] * 0.6 - s[PY] * 0.6, s[CR] * 0.5, 'YXZ'); r.chest.quaternion.setFromEuler(eA);

    // matrices pelvis/torso en el espacio del cuerpo
    r.pelvis.updateMatrix(); r.spine.updateMatrix(); r.chest.updateMatrix();
    mA.multiplyMatrices(r.pelvis.matrix, r.spine.matrix); mA.multiply(r.chest.matrix);   // cuerpo <- pecho
    mInv.copy(mA).invert();
    qA.copy(r.pelvis.quaternion).multiply(r.spine.quaternion).multiply(r.chest.quaternion); qB.copy(qA).invert();

    // brazos
    for (var k = 0; k < 2; k++) {
      var sh = r.sh[k];
      tV.copy(v[HL + k]).applyMatrix4(mInv); tV.x -= sh.position.x; tV.y -= sh.position.y; tV.z -= sh.position.z;
      tV2.copy(v[AL + k]).applyQuaternion(qB);
      solveIK(r.up[k], r.el[k], tV.x, tV.y, tV.z, tV2.x, tV2.y, tV2.z, UPPER, FORE + PALM);
      r.hand[k].quaternion.setFromAxisAngle(XAXIS, s[WRL + k]);
    }
    // piernas
    mB.copy(r.pelvis.matrix).invert(); qC.copy(r.pelvis.quaternion).invert();
    for (k = 0; k < 2; k++) {
      var hp = r.hip[k];
      tV.copy(v[FL + k]).applyMatrix4(mB); tV.x -= hp.position.x; tV.y -= hp.position.y; tV.z -= hp.position.z;
      tV2.copy(v[KL + k]).applyQuaternion(qC);
      solveIK(r.th[k], r.kn[k], tV.x, tV.y, tV.z, tV2.x, tV2.y, tV2.z, THIGH, SHIN);
      // pie plano respecto al cuerpo (con puntera y giro)
      qD.copy(r.pelvis.quaternion).multiply(r.th[k].quaternion).multiply(r.kn[k].quaternion).invert();
      eA.set(s[FPL + k], s[FYL + k], 0, 'YXZ'); qA.setFromEuler(eA);
      r.ft[k].quaternion.copy(qD).multiply(qA);
    }
  }

  /** Cabeza: mira al balón (limitado), más ajustes de la pose. */
  function aimHead(r, g, dt, snap) {
    var s = r.cur.s, b = g.ball;
    toBody(r, b.x, b.y, b.z, tV);
    tV.x -= r.body.position.x; tV.y -= r.body.position.y; tV.z -= r.body.position.z;
    tV.applyMatrix4(mInv); // en espacio del pecho
    var dx = tV.x, dy = tV.y - NECK_Y - 0.1, dz = tV.z, h = Math.hypot(dx, dz);
    var yaw = clamp(Math.atan2(dx, dz), -1.25, 1.25), pitch = clamp(-Math.atan2(dy, Math.max(0.05, h)), -0.95, 0.55);
    if (dz < -0.1) yaw *= 0.6;
    var w = s[LOOK];
    var ty = yaw * w + s[HY], tp = pitch * w + s[HP] - s[CP] * 0.3 * (1 - w);
    var k = snap ? 1 : kf(10, dt);
    r.headYaw += (ty - r.headYaw) * k; r.headPitch += (tp - r.headPitch) * k;
    r.head.rotation.set(r.headPitch, r.headYaw, 0);
  }

  // =====================================================================
  //  ORIENTACIÓN
  // =====================================================================
  function desiredYaw(g, r) {
    var p = r.p, b = g.ball, sd = side(p.team), net = sd > 0 ? PI : 0;
    var tm = g.time;
    if (tm - r.diveT >= 0 && tm - r.diveT < r.diveEnd + 0.75) return r.diveYaw;
    if (g.mode === 'point' || g.mode === 'over') {
      if (tm - r.pointT >= 0 && r.pointWin && r.celeb === 2 && r.mateHF && !r.matchEnd) {
        var m = VB.Sim.other(g, p); return Math.atan2(m.y - p.y, m.x - p.x) - 0.35;
      }
      return r.faceKeep != null ? r.faceKeep : r.yaw;
    }
    if (g.mode === 'serve' && g.serving === p.team) return net;
    var dx = b.x - p.x, dy = b.y - p.y;
    if (dx * dx + dy * dy < 0.04) return r.yaw;
    var yb = Math.atan2(dy, dx);
    // en la red (bloqueo / remate) se mira sobre todo a la red
    if (Math.abs(p.x) < 1.7 && (p.z > 0.05 || (g.mode === 'rally' && g.touchTeam === 1 - p.team && g.touches >= 1))) {
      return net + clamp(wrapA(yb - net), -0.5, 0.5);
    }
    if (p.z > 0.05 && r.jumpKind === 'attack') return net + clamp(wrapA(yb - net), -0.7, 0.7);
    return yb;
  }

  // =====================================================================
  //  MARCADOR DEL JUGADOR CONTROLADO
  // =====================================================================
  function markerTexture() {
    var cv = canvas(128, 128), g = cv.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 30, 64, 64, 63);
    gr.addColorStop(0, 'rgba(255,210,63,0)'); gr.addColorStop(0.62, 'rgba(255,210,63,0.12)');
    gr.addColorStop(0.8, 'rgba(255,220,90,1)'); gr.addColorStop(0.9, 'rgba(255,210,63,0.9)'); gr.addColorStop(1, 'rgba(255,210,63,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t;
  }

  // =====================================================================
  //  API
  // =====================================================================
  function ensureTemps() {
    if (T) return;
    T = new Pose(); T2 = new Pose();
    BL = new THREE.Vector3(); CL = new THREE.Vector3(); tV = new THREE.Vector3(); tV2 = new THREE.Vector3(); tV3 = new THREE.Vector3();
    mA = new THREE.Matrix4(); mB = new THREE.Matrix4(); mInv = new THREE.Matrix4();
    qA = new THREE.Quaternion(); qB = new THREE.Quaternion(); qC = new THREE.Quaternion(); qD = new THREE.Quaternion(); eA = new THREE.Euler();
    IKx = new THREE.Vector3(); IKy = new THREE.Vector3(); IKz = new THREE.Vector3(); IKm = new THREE.Matrix4(); ZERO3 = new THREE.Vector3(); XAXIS = new THREE.Vector3(1, 0, 0);
  }

  function rigFor(p) {
    var key = p.id + ':' + p.team + ':' + p.num;
    var r = cache[key];
    if (!r) { r = cache[key] = buildRig(p); }
    r.p = p; return r;
  }
  function resetRig(r) {
    r.inited = false; r.hitT = r.jumpT = r.landT = r.blockT = r.swingT = r.pointT = r.diveT = r.tossT = -99;
    r.hitKind = ''; r.hitShot = ''; r.jumpKind = ''; r.faceKeep = null; r.yawRate = 0; r.vf = r.vl = 0;
  }

  function onEvent(g, e) {
    var r, tm = e.t != null ? e.t : g.time;
    if (e.player && e.player.id != null) r = byId[e.player.id];
    switch (e.type) {
      case 'hit':
        if (!r) return;
        r.hitT = tm; r.hitKind = e.kind; r.hitQ = e.quality == null ? 1 : e.quality; r.hitShot = e.shot || '';
        toBody(r, e.x, e.y, e.z, r.hitC);
        // el contacto a la altura de la mano/plataforma real (no el centro del balón)
        if (e.kind === 'spike' || e.kind === 'free' || e.kind === 'serve') { r.hitC.y -= 0.06; r.hitC.x = Math.min(r.hitC.x, 0.05); }
        break;
      case 'jump':
        if (!r) return;
        r.jumpT = tm;
        var p = r.p, opp = 1 - p.team;
        if (g.mode === 'serve') r.jumpKind = 'attack';
        else if (Math.abs(p.x) < 1.7 && g.touchTeam === opp && g.lastKind !== 'serve') r.jumpKind = 'block';
        else if (g.jobs && g.jobs[p.team] === p && g.touchTeam === p.team && g.touches >= 1) r.jumpKind = 'attack';
        else if (Math.abs(p.x) < 1.7 && g.touchTeam === opp) r.jumpKind = 'block';
        else r.jumpKind = 'attack';
        break;
      case 'landPlayer': if (r) r.landT = tm; break;
      case 'toss': if (r) { r.tossT = tm; r.tossJump = !!e.jump; } break;
      case 'dive':
        // plancha de la sim: el cuerpo se lanza en la dirección dada y queda en el suelo p.down s
        if (!r) return;
        r.diveT = tm; r.diveEnd = Math.max(0.5, (r.p.down || 0.9) - 0.05); r.diveDist = 0.15 / r.scale;
        r.diveYaw = e.dir ? Math.atan2(e.dir[1], e.dir[0]) : r.yaw;
        break;
      case 'block': if (r) r.blockT = tm; break;
      case 'swing': if (r) r.swingT = tm; break;
      case 'serveReady':
        for (var i = 0; i < rigs.length; i++) { rigs[i].diveT = -99; rigs[i].pointT = -99; rigs[i].faceKeep = null; }
        break;
      case 'land':
        // plancha del defensor más cercano si el balón cae dentro de su campo y no llegó
        if (!e.inside) return;
        var best = null, bd = 9;
        for (var j = 0; j < rigs.length; j++) {
          var q = rigs[j].p; if (q.team !== e.team || q.z > 0.05) continue;
          var d = Math.hypot(e.x - q.x, e.y - q.y);
          if (d < bd) { bd = d; best = rigs[j]; }
        }
        if (best && bd > 0.9 && bd < 3.4 && !(best.p.down > 0) && tm - best.diveT > 1.5) {
          best.diveT = tm - 0.12; best.diveEnd = 1.05; best.diveYaw = Math.atan2(e.y - best.p.y, e.x - best.p.x);
          best.diveDist = clamp(bd - 1.1, 0.2, 1.2) / best.scale;
        }
        break;
      case 'point':
        var won = e.team, sum = (e.score ? e.score[0] + e.score[1] : 0);
        for (var k = 0; k < rigs.length; k++) {
          var rr = rigs[k], pp = rr.p;
          rr.pointT = tm; rr.pointWin = pp.team === won; rr.matchEnd = !!e.matchWon;
          rr.celeb = (sum + pp.idx * 2 + (e.setWon ? 1 : 0)) % 3;
          rr.faceKeep = rr.yaw;
          var mate = VB.Sim.other(g, pp);
          rr.mateHF = Math.hypot(mate.x - pp.x, mate.y - pp.y) < 3.2;
          // los dos del equipo ganador comparten el choque de manos
          if (rr.pointWin && rr.mateHF && (sum % 3 === 2 || e.setWon)) rr.celeb = 2;
        }
        break;
    }
  }

  VB.Players = {
    rigs: rigs,
    init: function (c) {
      ctx = c; THREE = c.THREE; C = VB.C;
      ensureTemps();
      groupRoot = new THREE.Group(); groupRoot.name = 'players'; ctx.scene.add(groupRoot);
      bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });
      addRim(bodyMat, 0xfff1e0, 0.16);
      for (var t = 0; t < 2; t++) {
        var jm = new THREE.MeshStandardMaterial({ map: jerseyTexture(TEAMS[t]), roughness: 0.48, metalness: 0.0 });
        addRim(jm, 0xfff1e0, 0.2); jerseyMats.push(jm);
      }
      // marcador del jugador controlado: aro luminoso + flecha flotante
      markerMat = new THREE.MeshBasicMaterial({ map: markerTexture(), transparent: true, depthWrite: false, opacity: 1, toneMapped: false });
      marker = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), markerMat);
      marker.rotation.x = -PI / 2; marker.position.y = 0.018; marker.renderOrder = 3; ctx.scene.add(marker);
      coneMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false, transparent: true, opacity: 0.95 });
      markerCone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.17, 4), coneMat);
      markerCone.rotation.x = PI; ctx.scene.add(markerCone);
    },
    setQuality: function (q) {
      var want = !q || q.rank > 0;
      if (want === smallShadows) return;
      smallShadows = want;
      for (var k in cache) applyShadowFlags(cache[k]);
    },
    onGameStart: function (g) {
      for (var i = 0; i < rigs.length; i++) groupRoot.remove(rigs[i].root);
      rigs.length = 0; byId.length = 0;
      for (var j = 0; j < g.players.length; j++) {
        var r = rigFor(g.players[j]); resetRig(r);
        rigs.push(r); byId[g.players[j].id] = r; groupRoot.add(r.root);
      }
    },
    /** Rig de un jugador de la simulación (para cámara/FX).
     *  Campos útiles: root, body, pelvis, chest, head, handL, handR, footL, footR (Object3D; usar getWorldPosition). */
    rigOf: function (p) { return p && byId[p.id] && byId[p.id].p === p ? byId[p.id] : null; },
    /** Posición mundial (Three) de la mano derecha/izquierda del jugador. OPCIONAL. */
    handWorld: function (p, right, out) {
      var r = this.rigOf(p); if (!r) return null;
      out = out || new THREE.Vector3(); return (right === false ? r.handL : r.handR).getWorldPosition(out);
    },
    update: function (g, dt, events) {
      if (!g) return;
      if (!rigs.length || rigs[0].p !== g.players[0]) this.onGameStart(g);
      var i;
      // los rigs recién creados se orientan antes de leer eventos (puntos de contacto en su espacio)
      for (i = 0; i < rigs.length; i++) if (!rigs[i].inited) rigs[i].yaw = desiredYaw(g, rigs[i]);
      for (i = 0; i < events.length; i++) { try { onEvent(g, events[i]); } catch (e) { } }
      var frozen = ctx.frozen, paused = dt <= 0 && !frozen;
      for (var k = 0; k < rigs.length; k++) {
        var r = rigs[k], p = r.p;
        if (paused && r.inited) continue; // pausa: se mantiene la pose
        var snap = !r.inited || dt <= 0;
        // posición y orientación
        VB.toThree(p.x, p.y, p.z, r.root.position);
        var want = desiredYaw(g, r);
        if (snap) { r.yaw = want; r.yawRate = 0; }
        else {
          var diveNow = g.time - r.diveT >= 0 && g.time - r.diveT < 0.3;
          var turnRate = diveNow ? 22 : p.z > 0.05 ? 7 : 9, d = wrapA(want - r.yaw) * kf(turnRate, dt);
          r.yaw = wrapA(r.yaw + d); r.yawRate = lerp(r.yawRate || 0, d / dt, kf(8, dt));
        }
        r.root.rotation.y = Math.atan2(Math.cos(r.yaw), -Math.sin(r.yaw));
        // velocidad en ejes del cuerpo (suavizada)
        var fx = Math.cos(r.yaw), fy = Math.sin(r.yaw);
        var vf = p.vx * fx + p.vy * fy, vl = p.vx * -fy + p.vy * fx;
        if (p.z > 0.01) { vf = 0; vl = 0; }
        if (snap) { r.vf = vf; r.vl = vl; } else { var kv = kf(14, dt); r.vf += (vf - r.vf) * kv; r.vl += (vl - r.vl) * kv; }
        if (!snap) r.clock += dt;
        computeTarget(g, r, dt, snap);
        dampPose(r, dt, snap);
        applyPose(r);
        aimHead(r, g, dt, snap);
        r.inited = true;
      }
      // marcador del jugador controlado
      var show = !g.demo && ctx.state !== 'menu' && g.ctrl;
      marker.visible = markerCone.visible = !!show;
      if (show) {
        var c = g.ctrl, reach = VB.Sim.canReach(g, c);
        marker.position.x = c.x; marker.position.z = -c.y;
        var pulse = reach ? 1.08 + Math.sin(ctx.time * 16) * 0.07 : 1;
        marker.scale.set(pulse, pulse, pulse);
        markerMat.opacity = reach ? 1 : 0.8;
        var rc = byId[c.id], topY = (rc ? rc.scale : 1) * 2.18 + (rc ? rc.cur.s[HOP] : 0);
        markerCone.position.set(c.x, c.z + topY + Math.sin(ctx.time * 4) * 0.04, -c.y);
        markerCone.rotation.y += (dt > 0 ? dt : 0) * 2.5;
      }
    }
  };
})();
