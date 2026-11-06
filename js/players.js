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
 * UNA SkinnedMesh por atleta (piel rígida: cada pieza va a un hueso; colores de vértice),
 * 1 dibujo + 1 sombra por atleta, atlas de camiseta con dorsales por jugador.
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

  var rigs = [], byId = [], cache = {}, lastBlocker = null;
  var groupRoot, marker, markerCone, markerMat, coneMat;

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
  /** Acumulador del atleta entero: UNA geometría con color por vértice, UV del atlas del jugador y
   *  piel rígida (cada pieza va al hueso `bone`, ya colocada en la pose de reposo con `pre`).
   *  jersey = true: la pieza toma la camiseta del atlas (u alrededor, v lineal con la altura de reposo). */
  var JY0 = HIP_H + SPINE_Y - 0.135, JY1 = HIP_H + SPINE_Y + CHEST_Y + 0.306; // alto de la camiseta en reposo
  var BODY_UV_U = 0.5, BODY_UV_V = 0.2; // texel blanco del atlas (piezas de color por vértice)
  function Geo() { this.p = []; this.n = []; this.c = []; this.u = []; this.si = []; this.i = []; this.k = 0; this.pre = null; this.bone = 0; this.jersey = false; }
  Geo.prototype.add = function (geo, hex, x, y, z, rx, ry, rz, sx, sy, sz) {
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    q.setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
    if (this.pre) m.premultiply(this.pre);
    nm.getNormalMatrix(m);
    var P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, col = new THREE.Color(hex == null ? 0xffffff : hex), i;
    for (i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      if (this.jersey) this.u.push(U ? U.getX(i) : 0, 0.5 + 0.5 * clamp((v.y - JY0) / (JY1 - JY0), 0, 1));
      else this.u.push(BODY_UV_U, BODY_UV_V);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.c.push(col.r, col.g, col.b);
      this.si.push(this.bone, 0, 0, 0);
    }
    if (geo.index) for (i = 0; i < geo.index.count; i++) this.i.push(geo.index.getX(i) + this.k);
    else for (i = 0; i < P.count; i++) this.i.push(this.k + i);
    this.k += P.count; geo.dispose(); return this;
  };
  Geo.prototype.build = function () {
    var g = new THREE.BufferGeometry(), n = this.k, w = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) w[i * 4] = 1;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    g.setIndex(this.i);
    // esfera amplia: la piel no recalcula límites (salto, plancha, brazos arriba)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0.2), 2.3);
    return g;
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
  // el bajo de la camiseta se abre un poco y la cintura del pantalón queda DENTRO (sin anillo ni parpadeo)
  var ABS_PROF = [[0, -0.135], [0.17, -0.13], [0.172, -0.1], [0.16, -0.03], [0.146, 0.04], [0.13, 0.1], [0.11, 0.16], [0, 0.17]];
  var ABS_S = [1.22, 1, 0.8];
  var SHORTS_PROF = [[0, -0.15], [0.12, -0.146], [0.152, -0.12], [0.158, -0.05], [0.147, 0.02], [0.128, 0.08], [0.1, 0.12], [0, 0.13]];
  var SHORTS_S = [1.2, 1, 0.8];
  function profPts(pr) { var a = []; for (var i = 0; i < pr.length; i++) a.push(V2(pr[i][0], pr[i][1])); return a; }

  // ---------- Texturas de canvas ----------
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(cv) {
    var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    t.wrapS = THREE.RepeatWrapping; return t;
  }
  function hexCss(h) { return '#' + ('000000' + h.toString(16)).slice(-6); }
  /** Atlas del jugador (512×512): mitad de arriba = camiseta con dorsales, mitad de abajo = blanco
   *  (las demás piezas llevan color por vértice y muestrean ahí). */
  function paintAtlas(cv, tc, num) {
    var g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 512);
    paintJersey(g, tc);
    // bajo prolongado con el color de la camiseta (no un cinturón oscuro): el filtrado de mipmaps
    // no mezcla el blanco del atlas con el bajo; el ribete real es fino (paintJersey)
    g.fillStyle = hexCss(tc.base); g.fillRect(0, 256, 512, 18);
    paintNumbers(g, num, tc);
  }
  /** Camiseta: u alrededor (0 = delante, .25 izquierda, .5 espalda, .75 derecha); filas 0-255 de arriba (cuello) abajo (bajo). */
  function paintJersey(g, tc) {
    var W = 512, H = 256;
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
    // bajo de la camiseta: ribete fino en un tono oscuro de la propia camiseta
    g.fillStyle = hexCss(tc.base); g.fillRect(0, H - 12, W, 12);
    g.fillStyle = hexCss(tc.dark); g.globalAlpha = 0.45; g.fillRect(0, H - 6, W, 3); g.globalAlpha = 1;
  }
  var NUM_FONT = '"Barlow Condensed","Arial Narrow","Arial Black",Impact,sans-serif';
  /** Fila del atlas (0 = cuello) para una altura de reposo del tronco. */
  function jerseyRow(Y) { return (1 - clamp((Y - JY0) / (JY1 - JY0), 0, 1)) * 256; }
  /** Dorsales: grande en la espalda (u = .5) y pequeño en el pecho (u = 0), blancos con filo oscuro.
   *  En el atlas 1 px horizontal ≈ 1/364 m en la espalda y 1 px vertical ≈ 1/400 m: se compensa en x. */
  function paintNumbers(g, num, tc) {
    var s = String(num), chest0 = HIP_H + SPINE_Y + CHEST_Y;
    function one(cx, yTop, yBot, sx) {
      var r0 = jerseyRow(yTop), r1 = jerseyRow(yBot), h = r1 - r0;
      g.save(); g.translate(cx, (r0 + r1) / 2); g.scale(sx, 1);
      g.font = 'italic 900 ' + Math.round(h * 1.12) + 'px ' + NUM_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = h * 0.13; g.strokeStyle = hexCss(tc.dark);
      g.strokeText(s, 0, h * 0.06); g.fillStyle = '#ffffff'; g.fillText(s, 0, h * 0.06);
      g.restore();
    }
    one(256, chest0 + 0.19, chest0 - 0.03, 0.95);           // espalda (~20 cm)
    one(0, chest0 + 0.175, chest0 + 0.08, 1.3); one(512, chest0 + 0.175, chest0 + 0.08, 1.3); // pecho (cruza la costura; más ancho: la curva lo estrecha)
  }
  function atlasMaterial(num, team) {
    var cv = canvas(512, 512), tc = TEAMS[team]; paintAtlas(cv, tc, num);
    var t = texOf(cv);
    var m = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.56, metalness: 0.0 });
    addRim(m, 0xfff1e0, 0.17);
    // con la fuente de la UI cargada, se redibuja (sin peticiones nuevas: la carga la propia UI)
    try {
      if (document.fonts && document.fonts.load) document.fonts.load('italic 900 100px "Barlow Condensed"').then(function () { paintAtlas(cv, tc, num); t.needsUpdate = true; }).catch(function () { });
    } catch (e) { }
    return m;
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
  function headGeo(g, L, tc) {
    var sk = L.skin, hr = L.hair, s, i;
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
  }
  function neckGeo(g, L, tc) {
    g.add(cyl(0.05, 0.057, 0.16, 14), L.skin, 0, 0.33, 0.0);
    g.add(new THREE.TorusGeometry(0.06, 0.012, 6, 20), tc.trim, 0, 0.29, 0.005, PI / 2 + 0.25, 0, 0, 1.15, 1, 1); // ribete del cuello
  }
  function upperGeo(g, L, tc) {
    g.add(lathe(limbPts(UPPER, 0.065, 0.05, 0.38, 0.01, 7), 14), L.skin);
    g.add(cyl(0.07, 0.066, 0.14, 14, true), tc.base, 0, -0.06, 0);                 // manga
    g.add(sph(0.072, 14, 10), tc.base, 0, -0.005, 0, 0, 0, 0, 1, 0.9, 1);           // hombro
    g.add(cyl(0.0675, 0.0675, 0.016, 14, true), tc.accent, 0, -0.123, 0);           // ribete de manga
  }
  function foreGeo(g, L, tc, s) {
    // antebrazo con volumen (de ~0,052 m en el codo a ~0,037 m en la muñeca, músculo cerca del codo)
    g.add(lathe(limbPts(FORE, 0.05, 0.037, 0.2, 0.011, 8), 12), L.skin, 0, 0, 0, 0, 0, 0, 1, 1, 0.92);
    if (s < 0) g.add(cyl(0.045, 0.043, 0.05, 12), tc.band, 0, -FORE + 0.045, 0);    // muñequera
  }
  /** Mano "manopla": palma ancha y plana, dedos de punta redonda algo abiertos y pulgar marcado.
   *  Plano de la mano = Y-Z del hueso (grosor en X); pulgar hacia +Z. Se lee a distancia (bloqueo, colocación). */
  function capsule(r, len, cs, rs) { return new THREE.CapsuleGeometry(r, len, cs || 3, rs || 8); }
  function handGeo(g, L) {
    g.add(capsule(1, 0.9, 3, 12), L.skin, 0, -0.052, 0.002, 0, 0, 0, 0.0175, 0.029, 0.047);   // palma
    var zs = [-0.03, -0.01, 0.01, 0.029], ls = [0.058, 0.07, 0.072, 0.064];
    for (var i = 0; i < 4; i++) {
      var a = -zs[i] * 3.2, l = ls[i];
      g.add(capsule(1, 2.2, 2, 6), L.skin, 0, -0.088 - Math.cos(a) * l * 0.5, zs[i] + Math.sin(-a) * l * 0.5, a, 0, 0, 0.0105, l / 4.2, 0.0115);
    }
    g.add(capsule(1, 2.0, 2, 6), L.skin, 0.007, -0.058, 0.058, -0.55, 0, 0, 0.0125, 0.0125, 0.014); // pulgar (algo abierto)
  }
  function thighGeo(g, L, tc) {
    g.add(lathe(limbPts(THIGH, 0.09, 0.062, 0.25, 0.012, 8), 14), L.skin);
    g.add(cyl(0.097, 0.099, 0.22, 16, true), tc.shorts, 0, -0.08, 0);               // pernera
    g.add(cyl(0.0995, 0.0995, 0.016, 16, true), tc.accent, 0, -0.184, 0);          // ribete
  }
  function shinGeo(g, L, tc) {
    g.add(lathe(limbPts(SHIN, 0.062, 0.038, 0.28, 0.013, 8), 14), L.skin);
    g.add(cyl(0.075, 0.07, 0.12, 16), tc.pad, 0, -0.025, 0.01);                       // rodillera
    g.add(cyl(0.047, 0.044, 0.16, 12, true), 0xf4f4f2, 0, -SHIN + 0.08, 0);         // calcetín
    g.add(cyl(0.0475, 0.0475, 0.02, 12, true), tc.base, 0, -SHIN + 0.13, 0);        // franja del calcetín
  }
  function shoeGeo(g, tc) {
    g.add(sph(1, 18, 8, 0, PI * 2, 0, PI * 0.5), 0xf4f4f4, 0, -0.056, 0.04, 0, 0, 0, 0.055, 0.07, 0.135); // empeine
    g.add(cyl(0.046, 0.05, 0.06, 12), 0xf4f4f4, 0, -0.02, -0.01);                   // tobillera
    g.add(sph(1, 18, 6, 0, PI * 2, PI * 0.5, PI * 0.5), tc.sole, 0, -0.056, 0.04, 0, 0, 0, 0.057, 0.026, 0.138); // suela
    g.add(sph(1, 14, 6, 0, PI * 2, 0, PI * 0.5), tc.accent, 0, -0.05, -0.025, 0, 0, 0, 0.0565, 0.034, 0.06);  // talón
    g.add(box(0.03, 0.006, 0.06), 0x30333a, 0, 0.0, 0.1, -0.5, 0, 0);               // cordones
  }
  function shortsGeo(g, tc) {
    g.add(lathe(profPts(SHORTS_PROF), 22), tc.shorts, 0, 0, 0, 0, 0, 0, SHORTS_S[0], SHORTS_S[1], SHORTS_S[2]);
  }
  /** Camiseta (abdomen en el hueso spine, pecho en chest): toma la textura del atlas. */
  function absGeo(g) { g.jersey = true; g.add(lathe(profPts(ABS_PROF), 24), null, 0, 0, 0, 0, 0, 0, ABS_S[0], ABS_S[1], ABS_S[2]); g.jersey = false; }
  function chestGeo(g) { g.jersey = true; g.add(lathe(profPts(CHEST_PROF), 28), null, 0, 0, 0, 0, 0, 0, CHEST_S[0], CHEST_S[1], CHEST_S[2]); g.jersey = false; }

  // =====================================================================
  //  POSE (estructura plana para mezclar capas)
  // =====================================================================
  // escalares
  var DROP = 0, PP = 1, PR = 2, PY = 3, CP = 4, CY = 5, CR = 6, HY = 7, HP = 8, HOP = 9, OX = 10, OZ = 11, PX = 12, PZ = 13,
    FPL = 14, FPR = 15, WRL = 16, WRR = 17, LOOK = 18, FYL = 19, FYR = 20, TWL = 21, TWR = 22, SHR = 23, NS = 24;
  // TWL/TWR: giro de la mano sobre el antebrazo (palma al frente en el bloqueo); SHR: hombros encogidos (0..1)
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
    var root = new THREE.Group(); root.name = 'athlete' + id;
    var bones = [];
    function bone(parent, x, y, z) { var b = new THREE.Bone(); b.position.set(x || 0, y || 0, z || 0); parent.add(b); bones.push(b); return b; }
    var body = bone(root);
    var pelvis = bone(body, 0, HIP_H, 0);
    var spine = bone(pelvis, 0, SPINE_Y, 0);
    var chest = bone(spine, 0, CHEST_Y, 0);
    var head = bone(chest, 0, NECK_Y, 0.012); head.rotation.order = 'YXZ';
    var r = {
      p: p, id: id, team: team, num: p.num, root: root, body: body, pelvis: pelvis, spine: spine, chest: chest, head: head,
      sh: [], up: [], el: [], hand: [], hip: [], th: [], kn: [], ft: [],
      cur: new Pose(), tgt: new Pose(), inited: false,
      yaw: 0, yawT: 0, phase: 0, vf: 0, vl: 0, clock: Math.random() * 10, headYaw: 0, headPitch: 0,
      // tiempos de eventos (tiempo de juego), -99 = nunca
      hitT: -99, hitKind: '', hitC: new THREE.Vector3(), hitQ: 1,
      jumpT: -99, jumpKind: '', landT: -99, blockT: -99, swingT: -99,
      pointT: -99, pointWin: false, celeb: 0, matchEnd: false, mateHF: false,
      diveT: -99, diveYaw: 0, diveDist: 0, diveEnd: 1.0, tossT: -99, tossJump: false, hitShot: '', hitGrade: ''
    };
    for (var k = 0; k < 2; k++) {
      var s = k === 0 ? 1 : -1;
      var sh = bone(chest, s * SH_X, SH_Y, SH_Z), up = bone(sh), el = bone(up, 0, -UPPER, 0), hd = bone(el, 0, -FORE, 0);
      r.sh.push(sh); r.up.push(up); r.el.push(el); r.hand.push(hd);
      var hp = bone(pelvis, s * HIP_W, 0, 0), th = bone(hp), kn = bone(th, 0, -THIGH, 0), ft = bone(kn, 0, -SHIN, 0);
      r.hip.push(hp); r.th.push(th); r.kn.push(kn); r.ft.push(ft);
    }
    // ---- UNA malla con piel rígida por hueso: 1 llamada de dibujo + 1 de sombra por atleta
    root.updateMatrixWorld(true);
    var G = new Geo();
    function on(b) { G.pre = b.matrixWorld; G.bone = bones.indexOf(b); return G; }
    shortsGeo(on(pelvis), tc);
    absGeo(on(spine));
    chestGeo(on(chest)); neckGeo(G, L, tc);
    headGeo(on(head), L, tc);
    for (k = 0; k < 2; k++) {
      s = k === 0 ? 1 : -1;
      upperGeo(on(r.up[k]), L, tc); foreGeo(on(r.el[k]), L, tc, s); handGeo(on(r.hand[k]), L);
      thighGeo(on(r.th[k]), L, tc); shinGeo(on(r.kn[k]), L, tc); shoeGeo(on(r.ft[k]), tc);
    }
    var skin = new THREE.SkinnedMesh(G.build(), atlasMaterial(p.num, team));
    skin.castShadow = true; skin.receiveShadow = true; skin.name = 'athleteSkin' + id;
    root.add(skin); root.updateMatrixWorld(true);
    skin.bind(new THREE.Skeleton(bones), skin.matrixWorld);
    r.skin = skin;
    root.scale.setScalar(L.h);
    // alias públicos para cámara/FX (rigOf)
    r.handL = r.hand[0]; r.handR = r.hand[1]; r.footL = r.ft[0]; r.footR = r.ft[1];
    r.scale = L.h;
    return r;
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
      setV(v[HL], 0.26, 1.46, 0.3); setV(v[HR], -0.26, 1.46, 0.3);
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

  /** Bloqueo: salto con los brazos que suben y PASAN la red (penetración) con las palmas al frente,
   *  hombros encogidos, el cuerpo inclinado hacia la red; las manos siguen arriba hasta caer. */
  function blockPose(r, P, tj) {
    var s = P.s, v = P.v, p = r.p;
    var fx = Math.abs(Math.cos(r.yaw)), zNet = Math.abs(p.x) / Math.max(0.6, fx) / r.scale; // distancia al plano de la red, de frente
    var up = sstep(0.0, 0.13, tj), pen = sstep(0.07, 0.19, tj);
    var drift = clamp(zNet - 0.36, 0, 0.5) * pen;                  // se echa hacia la red (solo visual)
    s[OZ] = drift;
    s[DROP] = -0.04; s[PP] = 0.04 + 0.08 * pen; s[CP] = 0.05 + 0.2 * pen; s[CY] = 0; s[PY] = 0; s[PR] = 0; s[CR] = 0;
    s[SHR] = up; s[HP] = 0.1 * pen; s[LOOK] = 0.45;                // hombros a las orejas, cabeza algo adelantada
    shoulderC(s);
    // brazos rectos, paralelos, inclinados 20-40º hacia el rival para que las manos PASEN la cinta
    var want = zNet - drift + 0.28 - SHZ, tilt = lerp(0.08, clamp(Math.atan2(want, 0.5), 0.34, 0.72), pen);
    var lat = clamp(BL.x * 0.35, -0.18, 0.18) * pen, D = ARM_R + 0.03;
    var hy = SHY + Math.cos(tilt) * D * lerp(0.82, 1, up), hz = SHZ + Math.sin(tilt) * D;
    setV(v[HL], 0.155 + lat, hy, hz); setV(v[HR], -0.155 + lat, hy, hz);
    setV(v[AL], 1, 0.1, -0.4); setV(v[AR], -1, 0.1, -0.4);
    s[WRL] = s[WRR] = -0.15 - 0.3 * pen;                           // muñecas firmes, palmas al frente y algo abajo
    s[TWL] = BLOCK_TW; s[TWR] = -BLOCK_TW;
    setV(v[FL], 0.14, ANKLE + 0.08, -0.03); setV(v[FR], -0.14, ANKLE + 0.08, -0.03);
    s[FPL] = s[FPR] = 0.6; s[FYL] = 0.08; s[FYR] = -0.08;
    P.ra = 26; P.rb = 16;
  }
  var BLOCK_TW = 1.45;

  /** Remate en el aire con el brazo derecho: despegue con los dos brazos arriba, "arco y flecha"
   *  (codo alto y atrás, mano detrás de la cabeza, tronco girado y arqueado, rodillas atrás), latigazo
   *  en arco (el codo tira primero, luego el antebrazo) hasta el brazo totalmente extendido delante-arriba
   *  con la muñeca que cierra sobre el balón; la izquierda baja recogida al pecho; acompañamiento que cruza
   *  delante del cuerpo hasta la cadera izquierda con cierre de tronco en "navaja".
   *  sw 0..1: progreso del latigazo (0 = armado, 1 = contacto); ha: segundos desde el golpe (<0 = aún no);
   *  Ct: contacto (espacio cuerpo). */
  function swingUp(o, x, a, y1, z1) {
    var i = 1 - a;
    o.set(x, i * i * 0.76 + 2 * i * a * 0.95 + a * a * y1, i * i * -0.56 + 2 * i * a * 0.66 + a * a * z1);
  }
  function attackPose(r, P, tj, sw, ha, Ct) {
    var s = P.s, v = P.v;
    var a1 = sstep(0.0, 0.15, tj), ck = sstep(0.06, 0.26, tj);
    s[DROP] = -0.06; s[PY] = 0; s[PR] = 0;
    s[FYL] = 0.1; s[FYR] = -0.12;
    // punto de contacto (mano): por delante y a la derecha de la cabeza, brazo estirado
    if (Ct) { tV3.copy(Ct); tV3.y -= s[HOP]; if (tV3.x > -0.1) tV3.x = -0.1; if (tV3.z < 0.3) tV3.z = 0.3; if (tV3.y > 2.26) tV3.y = 2.26; }
    else tV3.set(-0.16, 2.2, 0.38);
    if (ha < 0) {
      var c = ck * (1 - sw), e = sw * sw; // e: el latigazo acelera hacia el contacto
      s[PP] = lerp(0.08, -0.2, c) + 0.06 * e; s[CP] = lerp(0.05, -0.36, c) + 0.2 * e;
      s[CY] = -0.7 * c + 0.32 * e; s[CR] = 0.12 * c; s[SHR] = 0.3 * c; s[HP] = -0.25 * c - 0.1 * e;
      // izquierda: sube con el despegue y apunta al balón (arriba-adelante); en el latigazo baja al pecho
      // despegue: los dos brazos vienen de atrás-abajo (carrera) y suben por delante (arco)
      swingUp(v[HL], 0.2, a1, 2.18, 0.46);
      v[HL].lerp(tV2.set(0.08, 1.32, 0.24), sstep(0.0, 0.7, sw));
      setV(v[AL], 1, -0.35, -0.2); s[WRL] = -0.2;
      // derecha: sube con el despegue y se arma detrás de la cabeza (codo alto y atrás, muñeca echada atrás)
      swingUp(v[HR], -0.22, a1, 2.06, 0.25);
      // arco y flecha: mano detrás de la oreja, codo por encima del hombro, abierto y atrás
      v[HR].lerp(tV2.set(-0.3, 1.8, -0.32), ck);
      setV(v[AR], lerp(-1, -0.7, ck), lerp(0.1, 0.15, ck), lerp(-0.4, -1, ck));
      s[WRR] = -0.9 * ck;
      if (sw > 0) {
        // arco cúbico: armado -> la mano sube detrás mientras el codo avanza -> por encima del hombro -> contacto
        var u = e, iu = 1 - u, b0 = iu * iu * iu, b1 = 3 * iu * iu * u, b2 = 3 * iu * u * u, b3 = u * u * u;
        var hx = v[HR].x, hy = v[HR].y, hz = v[HR].z;
        v[HR].set(b0 * hx + b1 * -0.3 + b2 * (tV3.x - 0.06) + b3 * tV3.x,
          b0 * hy + b1 * 2.05 + b2 * (tV3.y + 0.1) + b3 * tV3.y,
          b0 * hz + b1 * -0.36 + b2 * (tV3.z - 0.22) + b3 * tV3.z);
        v[AR].lerp(tV2.set(-1, 0.05, -0.3), sstep(0.2, 0.9, sw));
        s[WRR] = lerp(s[WRR], -0.15, sw);
      }
      // piernas: rodillas dobladas detrás (arqueo del cuerpo); en el latigazo empiezan a venir delante
      setV(v[FL], 0.13, ANKLE + lerp(0.14, 0.3, c) * a1, lerp(-0.06, -0.34, c) * a1);
      setV(v[FR], -0.15, ANKLE + lerp(0.18, 0.44, c) * a1, lerp(-0.1, -0.48, c) * a1);
      v[FL].z += 0.16 * e; v[FR].z += 0.16 * e;
      s[FPL] = s[FPR] = lerp(0.7, 1.0, c);
      P.ra = sw > 0 ? lerp(24, 70, sw) : 22; P.rb = sw > 0 ? lerp(16, 30, sw) : 16;
    } else {
      // acompañamiento: arco hacia delante y abajo, cruzando hasta la cadera izquierda
      var f = sstep(0.0, 0.14, ha), wr = sstep(0.0, 0.06, ha), g1 = 1 - f;
      // latigazo, no "plegado": el pecho se queda bastante erguido (<= ~27º), la cabeza arriba mirando el balón
      s[PP] = lerp(0.08, 0.13, f); s[CP] = lerp(0.16, 0.34, f); s[CY] = lerp(0.32, 0.55, f); s[CR] = -0.07 * f; s[SHR] = 0;
      s[HP] = -0.3; s[LOOK] = 0.55;
      var q0 = g1 * g1, q1 = 2 * g1 * f, q2 = f * f;
      v[HR].set(q0 * tV3.x + q1 * (tV3.x + 0.06) + q2 * 0.18,
        q0 * tV3.y + q1 * (tV3.y - 0.42) + q2 * 0.98,
        q0 * tV3.z + q1 * (tV3.z + 0.42) + q2 * 0.34);
      setV(v[AR], -1, lerp(0.1, -0.6, f), lerp(-0.3, 0.15, f));
      s[WRR] = lerp(-0.15, 1.0, wr) * (1 - 0.45 * f);
      setV(v[HL], 0.1, lerp(1.32, 1.2, f), lerp(0.24, 0.16, f)); setV(v[AL], 1, -0.5, -0.1); s[WRL] = 0.2; // izquierda recogida
      // piernas: vienen algo delante para caer
      setV(v[FL], 0.13, ANKLE + lerp(0.2, 0.24, f), lerp(0.02, 0.1, f)); setV(v[FR], -0.15, ANKLE + lerp(0.26, 0.28, f), lerp(-0.04, 0.06, f));
      s[FPL] = s[FPR] = lerp(0.8, 0.5, f);
      P.ra = lerp(70, 40, f); P.rb = 24;
    }
  }

  /** Pose en el aire. kind: 'attack' | 'block' | 'plain' (attack/block tienen su propia función). */
  function airPose(r, P, kind, tj) {
    var s = P.s, v = P.v;
    var a2 = sstep(0.0, 0.2, tj);
    s[DROP] = -0.02;
    setV(v[HL], 0.24, lerp(1.0, 2.15, a2), 0.2); setV(v[HR], -0.24, lerp(1.0, 2.15, a2), 0.2);
    setV(v[AL], 1, 0, -0.5); setV(v[AR], -1, 0, -0.5);
    setV(v[FL], 0.13, ANKLE + 0.12, -0.05); setV(v[FR], -0.13, ANKLE + 0.18, -0.1);
    s[FPL] = s[FPR] = 0.6;
    P.ra = 16; P.rb = 12;
  }

  /** Bajada: las piernas se estiran y se separan para recibir el suelo (todas las poses aéreas). */
  function landPrep(P, z, vz) {
    if (vz >= 0) return;
    var w = 1 - sstep(0.1, 0.5, z);
    if (w <= 0) return;
    var v = P.v, s = P.s;
    v[FL].lerp(tV3.set(0.15, ANKLE + 0.02, 0.05), w); v[FR].lerp(tV3.set(-0.15, ANKLE + 0.02, -0.02), w);
    s[FPL] = lerp(s[FPL], 0.25, w); s[FPR] = lerp(s[FPR], 0.25, w);
    s[OZ] *= 1 - 0.6 * w;
  }

  /** Centro de los hombros (espacio cuerpo) para una pose (sin giro): misma cadena que applyPose.
   *  Deja el resultado en SHY/SHZ. Sirve para poner las manos a un brazo exacto (brazos rectos). */
  var SHY = 0, SHZ = 0;
  function shoulderC(s) {
    var a1 = s[PP] * 0.6, y = HIP_H - s[DROP], z = s[PZ];
    y += SPINE_Y * Math.cos(a1); z += SPINE_Y * Math.sin(a1);
    var a2 = a1 + s[PP] * 0.4 + s[CP] * 0.45; y += CHEST_Y * Math.cos(a2); z += CHEST_Y * Math.sin(a2);
    var a3 = a2 + s[CP] * 0.55, h = SH_Y + SHR_UP * s[SHR]; y += h * Math.cos(a3); z += h * Math.sin(a3);
    SHY = y; SHZ = z;
  }
  var SHR_UP = 0.06, ARM_R = UPPER + FORE + PALM;

  /** Recepción de antebrazos (plataforma) hacia el punto de contacto Pc (espacio cuerpo). follow: 0..1 acompañamiento.
   *  Brazos RECTOS con las muñecas juntas y los hombros encogidos hacia delante; la altura se busca con las
   *  piernas y la cadera, no subiendo las manos: la plataforma nunca pasa de la altura del pecho
   *  (balón alto = plataforma alta con el tronco hacia atrás; nunca manos juntas delante de la cara). */
  function passPose(r, P, Pc, follow) {
    var s = P.s, v = P.v;
    var hx = Pc.x, hz = Pc.z, dh = Math.hypot(hx, hz) || 1e-3, nx = hx / dh, nz = hz / dh;
    var reach = clamp((dh - 0.35) / 0.9, 0, 1), low = clamp((1.0 - Pc.y) / 0.7, 0, 1), high = sstep(1.15, 1.6, Pc.y);
    s[PX] = nx * (0.3 + 0.15 * low) * reach; s[PZ] = nz * (0.3 + 0.15 * low) * reach * (1 - 0.5 * high);
    s[DROP] = 0.3 + 0.08 * reach + 0.24 * low - 0.17 * high - 0.12 * follow;   // el acompañamiento sale de las piernas
    s[PP] = 0.24 + 0.12 * low - 0.16 * high - 0.04 * follow;
    s[CP] = 0.18 + 0.1 * reach + 0.1 * low - 0.36 * high - 0.06 * follow;      // balón alto: tronco algo atrás
    s[HP] = -0.12 - 0.15 * high; s[SHR] = 0.55;
    s[CY] = clamp(Math.atan2(nx, nz) * 0.45, -0.6, 0.6); s[PR] = -nx * 0.12 * reach;
    shoulderC(s);
    var shx = s[PX], ax = clamp(hx, -1.0, 1.0) - shx, az = Math.max(0.3, hz) - SHZ, hh = Math.hypot(ax, az) || 1e-3;
    var ay = Pc.y - 0.12 - SHY;                                   // los antebrazos van por debajo del centro del balón
    var el = clamp(Math.atan2(ay, hh), -0.85, lerp(-0.34, -0.2, high)) + 0.1 * follow; // ángulo de la plataforma
    var D = ARM_R + 0.02, ce = Math.cos(el) * D;
    var tx = shx + ax / hh * ce, ty = SHY + Math.sin(el) * D, tz = SHZ + az / hh * ce;
    setV(v[HL], tx + 0.035, ty, tz); setV(v[HR], tx - 0.035, ty, tz);
    setV(v[AL], 0.7, -1, -0.1); setV(v[AR], -0.7, -1, -0.1);
    s[WRL] = s[WRR] = 0.12; s[TWL] = s[TWR] = 0;
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
    if (S.hitWindow) {
      try {
        var w = S.hitWindow(g, p, HW);
        // con el balón aún SUBIENDO (lanzamiento del saque, balón que sube hacia el receptor) hitWindow da t<0
        // porque ya cruzó la altura de contacto de subida: el contacto real es en la bajada
        if (w && w.t < 0 && g.ball.vz > 0.3 && !g.ball.held) w.t = g.ball.vz / C.G + 0.25;
        return w;
      } catch (e) { }
    }
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
        // en la red esperando el ataque rival (postura 3) las manos siguen arriba al desplazarse (paso lateral de bloqueo)
        locomotion(r, P, drive, dx, dz, dt, snap, kind !== 3);
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
      copyP(T2, P);
      var zk = clamp(p.z / 1.05, 0, 1);
      if (r.jumpKind === 'attack') {
        // salto visual algo más alto en el remate (más atlético; no cambia la sim)
        T2.s[HOP] = 0.16 * zk;
        var ha = (r.hitAir && r.hitT >= r.jumpT - 0.02 && hitAge >= 0) ? hitAge : -1, prox = 0, Ct = null;
        if (ha < 0) {
          if (hw && (hw.kind === 'spike' || hw.kind === 'jserve' || hw.kind === 'fserve' || hw.kind === 'free') && hw.d < 1.6) {
            // latigazo de ~0,15 s hasta el contacto previsto (antes: 0,2 s lineal, se leía como un empujón)
            prox = clamp(1 - (hw.t - 0.005) / 0.15, 0, 1); Ct = CL;
          } else if (!hw) { // sin predicción: proximidad del balón al punto de golpeo
            var ddx = BL.x + 0.2, ddy = BL.y - 2.3, ddz = BL.z - 0.3, dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            prox = (1 - sstep(0.25, 0.8, dd)) * (b.vz < 1.5 ? 1 : 0.5); Ct = BL;
          }
        } else Ct = r.hitC;
        // contacto bajo para el salto (balón a menos de un brazo estirado sobre los pies): el cuerpo visual
        // baja un poco en vez de golpear con el codo doblado junto a la cabeza (se anticipa con la predicción)
        if (Ct && Ct !== BL) T2.s[HOP] = clamp(Ct.y - 2.12, -0.22, 0.16) * zk;
        attackPose(r, T2, tj, prox, ha, Ct);
      } else if (r.jumpKind === 'block') {
        T2.s[HOP] = 0.06 * zk;
        blockPose(r, T2, tj);
      } else airPose(r, T2, r.jumpKind, tj);
      landPrep(T2, p.z, p.vz);
      blendP(P, T2, 1);
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
          setV(T2.v[HL], 0.22, 0.76, -0.56); setV(T2.v[HR], -0.22, 0.76, -0.56); // brazos estirados atrás
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
      else if (r.hitShot === 'body') {
        // el balón le da en el cuerpo sin gesto (sim shot 'body'): se encoge y gira el tronco apartándose,
        // manos recogidas al pecho; NO la pose de antebrazos/dedos de pass/set
        var fb = sstep(0.0, 0.06, hitAge) * (1 - sstep(0.3, 0.55, hitAge)), bSide = r.hitC.x >= 0 ? -1 : 1;
        copyP(T2, P);
        T2.s[DROP] = 0.12; T2.s[CP] = 0.28; T2.s[CY] = 0.38 * bSide; T2.s[PP] = 0.08;
        setV(T2.v[HL], 0.13, 1.22, 0.2); setV(T2.v[HR], -0.13, 1.22, 0.2);
        setV(T2.v[AL], 1, -0.4, 0.2); setV(T2.v[AR], -1, -0.4, 0.2);
        T2.ra = 40; blendP(P, T2, fb);
      }
      else if (hk === 'pass' || (hk === 'free' && r.hitShot === 'forearm' && !r.hitAir)) {
        wOut = 1 - sstep(0.3, 0.6, hitAge);
        copyP(T2, P); passPose(r, T2, r.hitC, sstep(0.0, 0.18, hitAge)); blendP(P, T2, wOut);
      } else if (hk === 'set') {
        wOut = 1 - sstep(0.32, 0.6, hitAge);
        copyP(T2, P); setPose(r, T2, r.hitC, 1, sstep(0.0, 0.15, hitAge)); blendP(P, T2, wOut);
      } else if ((hk === 'spike' || hk === 'free' || hk === 'serve') && r.hitAir) {
        // golpe en el aire: el gesto lo lleva attackPose (capa 3); aquí solo dejada y toque perfecto
        if (air && r.jumpKind === 'attack') {
          if (r.hitShot === 'tip') {
            // dejada: brazo estirado arriba, la muñeca empuja el balón por encima del bloqueo, sin latigazo
            var tw0 = sstep(0.0, 0.25, hitAge), hop0 = P.s[HOP];
            copyP(T2, P);
            T2.v[HR].set(Math.min(r.hitC.x, 0), r.hitC.y - hop0 - 0.04 + 0.06 * tw0, Math.max(0.2, r.hitC.z) + 0.14 * tw0);
            T2.v[AR].set(-1, 0.1, -0.3); T2.s[WRR] = lerp(-0.6, 0.45, tw0);
            T2.s[CP] = lerp(0.06, 0.14, tw0); T2.s[CY] = 0.12; T2.v[HL].set(0.2, 1.6, 0.3); T2.ra = 24;
            blendP(P, T2, 1 - sstep(0.4, 0.6, hitAge));
          } else if (r.hitGrade === 'perfect') {
            // toque perfecto: cierre de tronco más fuerte y acompañamiento más largo y cruzado
            var pw0 = sstep(0.0, 0.18, hitAge);
            P.s[CP] += 0.07 * pw0; P.s[CY] += 0.14 * pw0; P.s[PP] += 0.03 * pw0;
            P.v[HR].x += 0.07 * pw0; P.v[HR].y -= 0.14 * pw0; P.ra = 52;
          }
        }
      } else if (hk === 'spike' || hk === 'free' || hk === 'serve') {
        var dur = hk === 'serve' ? 0.75 : 0.6;
        wOut = 1 - sstep(dur * 0.55, dur, hitAge);
        copyP(T2, P);
        if (hk === 'serve') {
          T2.s[DROP] = 0.08; T2.s[PP] = 0.12;
          setV(T2.v[FL], 0.13, ANKLE, 0.18); setV(T2.v[FR], -0.14, ANKLE, lerp(-0.15, 0.32, sstep(0.08, 0.35, hitAge)));
          T2.s[FPR] = 0.35 * (1 - sstep(0.2, 0.4, hitAge));
        }
        var tip = r.hitShot === 'tip', perfect = r.hitGrade === 'perfect' && !tip;
        if (tip) tV2.set(-0.05, 2.0, 0.55);
        else if (perfect) tV2.set(0.2, hk === 'serve' ? 1.0 : 0.78, 0.45); // latigazo más largo y cruzado
        else tV2.set(0.12, hk === 'serve' ? 1.15 : 0.95, 0.4);
        strikeArm(T2, r.hitC, tip ? hitAge * 0.5 : hitAge, tV2);
        if (hk === 'serve' && r.hitShot !== 'jump') {
          // flotante: brazo totalmente estirado arriba-delante con la muñeca firme, SIN acompañamiento
          // (se "frena" el golpe); la izquierda cae al costado; luego el brazo baja relajado
          var hold = 1 - sstep(0.16, 0.5, hitAge), pushF = sstep(0.0, 0.06, hitAge);
          tV3.copy(r.hitC); if (tV3.x > -0.06) tV3.x = -0.06; if (tV3.z < 0.32) tV3.z = 0.32;
          shoulderC(T2.s);
          // a un brazo exacto desde el hombro derecho, en la dirección del contacto: brazo recto
          var ex = tV3.x + 0.2, ey = tV3.y - SHY, ez = tV3.z + 0.1 * pushF - SHZ, el2 = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1, Dd = ARM_R + 0.03;
          tV3.set(-0.2 + ex / el2 * Dd, SHY + ey / el2 * Dd, SHZ + ez / el2 * Dd);
          T2.v[HR].copy(tV3).lerp(tV2.set(-0.28, 1.0, 0.26), 1 - hold);
          T2.v[AR].set(-1, -0.2, -0.3); T2.s[WRR] = lerp(-0.05, 0.3, 1 - hold);
          T2.v[HL].set(0.25, 0.9, 0.1); T2.v[AL].set(0.4, -0.2, -1); T2.s[WRL] = 0;
          T2.s[CY] = lerp(0.18, 0.1, 1 - hold); T2.s[CP] = 0.1; T2.ra = 30;
        } else if (tip) {
          // dejada: brazo extendido arriba, muñeca que empuja, tronco quieto (sin latigazo)
          var tw = sstep(0.0, 0.25, hitAge);
          T2.s[CP] = lerp(0.05, 0.12, tw); T2.s[CY] = 0.12; T2.s[WRR] = lerp(-0.5, 0.35, tw);
          T2.v[HL].set(0.2, 1.75, 0.35); T2.ra = 20;
        } else if (perfect) {
          // toque perfecto: más cierre de tronco y rotación (gesto más enérgico)
          var pw = sstep(0.0, 0.18, hitAge);
          T2.s[CP] += 0.18 * pw; T2.s[CY] += 0.15 * pw; T2.s[PP] += 0.08 * pw; T2.ra = 46;
        }
        blendP(P, T2, wOut);
      }
    }
    var blkAge = tm - r.blockT;
    if (blkAge >= 0 && blkAge < 0.5 && air) {
      var push = Math.sin(clamp(blkAge / 0.25, 0, 1) * PI);
      P.v[HL].z += 0.08 * push; P.v[HR].z += 0.08 * push; P.v[HL].y += 0.03 * push; P.v[HR].y += 0.03 * push;
      P.s[WRL] += 0.5 * push; P.s[WRR] += 0.5 * push; // las muñecas "cierran" sobre el balón
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
        setV(v2[HL], 0.2, lerp(lerp(1.2, 2.25, up), 0.76, back), lerp(0.3, -0.56, back));
        setV(v2[HR], -0.22, lerp(1.1, 0.76, back), lerp(0.1, -0.56, back));
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
          tV.copy(CL); if (tV.x > -0.1) tV.x = -0.1;
          var arc = Math.sin(PI * sw2);
          v2[HR].lerp(tV, sw2); v2[HR].x -= 0.1 * arc; v2[HR].y += 0.12 * arc; v2[AR].lerp(tV2.set(-1, 0.2, -0.3), sw2);
          v2[HL].lerp(tV2.set(0.22, 1.25, 0.3), sw2); s2[CY] = lerp(-0.45, 0.25, sw2); s2[CP] = lerp(-0.08, 0.15, sw2);
          T2.ra = 34;
        }
      }
      blendP(P, T2, 1);
    }

    // ---- 7. plancha (balón que cae lejos y no se alcanza)
    var dv = tm - r.diveT, dEnd = r.diveEnd + 0.75;
    if (dv >= 0 && dv < dEnd) divePose(r, P, dv);
    // plancha cosmética (sin evento dive de la sim): polvo al tocar el suelo con el pecho (~0,18 s)
    if (r.cosDust && dv >= 0.18) {
      r.cosDust = false;
      if (dv < 0.5 && VB.FX && VB.FX.dust) { var dd = 0.55 + r.diveDist * r.scale, dcx = Math.cos(r.diveYaw), dcy = Math.sin(r.diveYaw); try { VB.FX.dust(p.x + dcx * dd, p.y + dcy * dd, 16, dcx, dcy); } catch (e) { } }
    }

    // ---- 8. celebración / lamento tras el punto
    var pa = tm - r.pointT;
    var diving = dv >= 0 && dv < dEnd;
    if ((mode === 'point' || mode === 'over') && r.pointT > -50 && pa >= 0 && !air && (!diving || dv > dEnd - 0.3)) celebrate(g, r, P, diving ? dv - (dEnd - 0.3) : pa);
  }

  function divePose(r, P, t) {
    var s = P.s, v = P.v;
    // el evento dive llega en el contacto: el cuerpo ya va lanzado (salida rápida). Hacia ~0,15 s va en
    // horizontal a 0,2-0,4 m del suelo con los brazos estirados (plancha) y las piernas detrás; cae de
    // pecho, se desliza un poco y se queda tumbado mientras la sim lo diga (p.down); luego se levanta.
    var go = sstep(0.0, 0.08, t), down = sstep(0.03, 0.15, t);
    var fly = sstep(0.02, 0.1, t) * (1 - sstep(0.17, 0.28, t));          // fase en el aire
    var upStart = r.p.down > 0.04 ? Math.max(r.diveEnd, t + r.p.down - 0.05) : r.diveEnd, up = sstep(upStart, upStart + 0.55, t);
    var lie = down * (1 - up), reach = go * (1 - up), slide = sstep(0.18, 0.5, t);
    var dist = r.diveDist;
    s[OZ] = lerp(0, dist, go) + 0.12 * slide; s[OX] = 0;
    s[LOOK] = 1 - lie * 0.4;
    // tumbado: pelvis casi horizontal (PP*0.6) y tronco recto (CP compensa el reparto de la columna)
    s[PP] = lerp(0.6 * reach, 2.4, lie); s[CP] = lerp(0.5 * reach, -0.92, lie) - 0.1 * fly; s[CY] = 0; s[PY] = 0; s[PR] = 0;
    s[DROP] = lerp(0.42 * reach, 0.87, lie) - 0.27 * fly; s[HP] = -0.6 * lie;
    s[PZ] = 0.1 * lie;
    // brazos totalmente estirados hacia el balón (una mano plana delante: "pancake"), luego apoyados
    var hy = lerp(0.7, 0.1, lie) + 0.27 * fly, hz = lerp(0.95, 1.4, lie) + 0.12 * fly;
    setV(v[HL], 0.2, hy + 0.03 * fly, hz - 0.08 * fly); setV(v[HR], -0.1, hy - 0.02 * fly, hz + 0.06 * fly);
    setV(v[AL], 1, -0.5, 0); setV(v[AR], -1, -0.5, 0);
    s[WRR] = -0.9 * fly * (1 - up); s[TWR] = 0;
    // piernas: zancada de impulso y luego estiradas detrás (en el aire, algo levantadas)
    setV(v[FL], 0.18, ANKLE + 0.02 * lie + 0.2 * fly, lerp(0.55 * reach, -0.92, lie)); setV(v[FR], -0.2, ANKLE + 0.04 * lie + 0.26 * fly, lerp(-0.3, -0.97, lie));
    setV(v[KL], 0.1, -lie, 1 - lie); setV(v[KR], -0.1, -lie, 1 - lie);
    s[FPL] = s[FPR] = 1.3 * lie;
    P.ra = t < 0.3 ? 30 : lerp(18, 10, up); P.rb = t < 0.3 ? 26 : lerp(14, 6, up);
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
      } else if (c === 3) {
        // bloqueador tras punto de bloqueo: cae, abre los brazos y ruge con el pecho fuera, puños cerrados
        var roar = sstep(0.15, 0.45, t), sh = Math.sin(t * 18) * 0.03 * roar * (1 - sstep(1.2, 1.6, t));
        s2[DROP] = lerp(0.22, 0.14, roar); s2[PP] = lerp(0.25, -0.05, roar); s2[CP] = lerp(0.35, -0.22, roar) + sh; s2[HP] = -0.45 * roar; s2[LOOK] = 0;
        setV(v2[HL], lerp(0.3, 0.62, roar), lerp(1.1, 1.55, roar) + sh, lerp(0.25, 0.12, roar)); setV(v2[HR], lerp(-0.3, -0.62, roar), lerp(1.1, 1.55, roar) + sh, lerp(0.25, 0.12, roar));
        setV(v2[AL], 0.3, -1, -0.4); setV(v2[AR], -0.3, -1, -0.4);
        s2[WRL] = s2[WRR] = 0.9;
        setV(v2[FL], 0.3, ANKLE, 0.1); setV(v2[FR], -0.3, ANKLE, -0.05); s2[FYL] = 0.3; s2[FYR] = -0.3;
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
      var sh = r.sh[k], sg = k ? -1 : 1;
      sh.position.set(sg * (SH_X - 0.022 * s[SHR]), SH_Y + SHR_UP * s[SHR], SH_Z);
      tV.copy(v[HL + k]).applyMatrix4(mInv); tV.x -= sh.position.x; tV.y -= sh.position.y; tV.z -= sh.position.z;
      tV2.copy(v[AL + k]).applyQuaternion(qB);
      solveIK(r.up[k], r.el[k], tV.x, tV.y, tV.z, tV2.x, tV2.y, tV2.z, UPPER, FORE + PALM);
      eA.set(s[WRL + k], s[TWL + k], 0, 'YXZ'); r.hand[k].quaternion.setFromEuler(eA);
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
    // el bloqueador en el aire va de frente a la red (las manos pasan la cinta en recto)
    if (p.z > 0.05 && r.jumpKind === 'block' && Math.abs(p.x) < 1.7) return net + clamp(wrapA(yb - net), -0.18, 0.18);
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
    // halo BLANCO y fino: el amarillo queda reservado al 'aro amarillo' de FX (dónde jugar el balón)
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.66, 'rgba(255,255,255,0.08)');
    gr.addColorStop(0.84, 'rgba(255,255,255,1)'); gr.addColorStop(0.88, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
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
    r.hitKind = ''; r.hitShot = ''; r.hitGrade = ''; r.jumpKind = ''; r.faceKeep = null; r.yawRate = 0; r.vf = r.vl = 0;
  }

  /** Tipo de salto: remate (o saque en salto) / bloqueo. */
  function classifyJump(g, p) {
    var opp = 1 - p.team, net = Math.abs(p.x) < 1.7;
    if (g.mode === 'serve') return 'attack';
    if (net && g.touchTeam === opp && g.lastKind !== 'serve') return 'block';
    if (g.jobs && g.jobs[p.team] === p && g.touchTeam === p.team && g.touches >= 1) return 'attack';
    if (net && g.touchTeam === opp) return 'block';
    return 'attack';
  }
  var HIT_KINDS = { spike: 1, pass: 1, set: 1, free: 1, serve: 1 };
  /** Reconstruye desde el estado de la sim lo que los eventos no dijeron (escenas de depuración que
   *  arrancan a mitad de jugada, frames perdidos): salto (tiempo y tipo), bloqueo y último toque. */
  function syncFromSim(g, r) {
    var p = r.p, tm = g.time, G = C.G;
    var la = p.lastAction, at = p.actionT;
    if (la === 'block' && at < 0.5 && Math.abs(tm - r.blockT - at) > 0.05) r.blockT = tm - at;
    if (HIT_KINDS[la] && at < 0.9 && tm - r.hitT > at + 0.05) {
      var b = g.ball, t = at;
      r.hitT = tm - at; r.hitKind = la; r.hitShot = p.shot || ''; r.hitGrade = p.grade || ''; r.hitQ = 1;
      // posición del contacto: el balón hacia atrás en su parábola
      var pz = p.z > 0 ? p.z - p.vz * t - 0.5 * G * t * t : 0;
      r.hitAir = pz > 0.05 || (p.z > 0.05 && la === 'spike');
      if (g.lastTouchT > r.hitT + 0.01) { // otro toque (bloqueo...) desvió el balón: contacto típico
        if (la === 'pass') r.hitC.set(0, 0.85, 0.45); else r.hitC.set(-0.12, la === 'set' ? 2.2 : 2.4, 0.4);
      } else {
        toBody(r, b.x - b.vx * t, b.y - b.vy * t, b.z - b.vz * t - 0.5 * G * t * t, r.hitC);
        r.hitC.y += (p.z - Math.max(0, pz)) / r.scale;
      }
      if (la === 'spike' || la === 'free' || la === 'serve') { r.hitC.y -= 0.06; r.hitC.z -= 0.06; r.hitC.x = Math.min(r.hitC.x, 0.05); }
    }
    if (p.z > 0.012) {
      var since = (C.JUMP_V - p.vz) / G, tj = tm - r.jumpT;
      if (!(tj > since - 0.12 && tj < since + 0.12)) {
        r.jumpT = tm - since;
        r.jumpKind = p.lastAction === 'block' ? 'block' : p.lastAction === 'spike' || p.lastAction === 'serve' ? 'attack' : classifyJump(g, p);
      }
      // salto de ataque que no llegó a golpear y el rival ya ataca: se convierte en bloqueo
      if (r.jumpKind === 'attack' && g.mode === 'rally' && r.hitT < r.jumpT && Math.abs(p.x) < 1.7 &&
          g.touchTeam === 1 - p.team && g.lastKind !== 'serve' && p.lastAction === 'jump' && !(g.jobs && g.jobs[p.team] === p)) r.jumpKind = 'block';
    }
  }

  function onEvent(g, e) {
    var r, tm = e.t != null ? e.t : g.time;
    if (e.player && e.player.id != null) r = byId[e.player.id];
    switch (e.type) {
      case 'hit':
        if (!r) return;
        r.hitT = tm; r.hitKind = e.kind; r.hitQ = e.quality == null ? 1 : e.quality; r.hitShot = e.shot || ''; r.hitGrade = e.grade || '';
        toBody(r, e.x, e.y, e.z, r.hitC);
        r.hitAir = r.p.z > 0.05;
        // el contacto a la altura de la mano/plataforma real (no el centro del balón)
        if (e.kind === 'spike' || e.kind === 'free' || e.kind === 'serve') { r.hitC.y -= 0.06; r.hitC.z -= 0.06; r.hitC.x = Math.min(r.hitC.x, 0.05); }
        break;
      case 'jump':
        if (!r) return;
        r.jumpT = tm; r.jumpKind = classifyJump(g, r.p);
        break;
      case 'landPlayer': if (r) r.landT = tm; break;
      case 'toss': if (r) { r.tossT = tm; r.tossJump = !!e.jump; } break;
      case 'dive':
        // plancha de la sim: el cuerpo se lanza en la dirección dada y queda en el suelo p.down s
        if (!r) return;
        r.diveT = tm; r.diveEnd = Math.max(0.5, (r.p.down || 0.9) - 0.05); r.diveDist = 0.15 / r.scale;
        r.diveYaw = e.dir ? Math.atan2(e.dir[1], e.dir[0]) : r.yaw;
        break;
      case 'block': if (r) { r.blockT = tm; lastBlocker = r; } break;
      case 'swing': if (r) r.swingT = tm; break;
      case 'serveReady':
        for (var i = 0; i < rigs.length; i++) { rigs[i].diveT = -99; rigs[i].pointT = -99; rigs[i].faceKeep = null; rigs[i].cosDust = false; }
        lastBlocker = null;
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
          best.diveT = tm - 0.12; best.diveEnd = 1.05; best.cosDust = true; best.diveYaw = Math.atan2(e.y - best.p.y, e.x - best.p.x);
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
          // punto de bloqueo: el bloqueador ruge hacia la red (su compañero mantiene su celebración)
          if (e.how === 'block' && rr === lastBlocker && rr.pointWin && !e.matchWon) rr.celeb = 3;
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
      // marcador del jugador controlado: aro luminoso + flecha flotante
      markerMat = new THREE.MeshBasicMaterial({ map: markerTexture(), transparent: true, depthWrite: false, opacity: 1, toneMapped: false });
      marker = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), markerMat);
      marker.rotation.x = -PI / 2; marker.position.y = 0.018; marker.renderOrder = 3; ctx.scene.add(marker);
      coneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.9 });
      markerCone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.17, 4), coneMat);
      markerCone.rotation.x = PI; ctx.scene.add(markerCone);
    },
    setQuality: function (q) {
      // cada atleta es UNA malla con piel (1 dibujo + 1 sombra): en calidad baja solo se baja el filtrado
      var aniso = !q || q.rank > 0 ? 4 : 1;
      for (var k in cache) { var m = cache[k].skin.material.map; if (m && m.anisotropy !== aniso) { m.anisotropy = aniso; m.needsUpdate = true; } }
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
        syncFromSim(g, r);
        computeTarget(g, r, dt, snap);
        dampPose(r, dt, snap);
        applyPose(r);
        // compresión del brazo que golpea (0,06 s tras el remate)
        var ha = g.time - r.hitT, sq = (r.hitAir && ha >= 0 && ha < 0.06 && r.hitShot !== 'tip') ? Math.sin(ha / 0.06 * PI) : 0;
        r.up[1].scale.set(1 + 0.14 * sq, 1 - 0.09 * sq, 1 + 0.14 * sq);
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
        // en el aire o con el balón del saque lanzado el cono taparía la mano que golpea: fuera
        if (c.z > 0.05 || (g.mode === 'serve' && g.server === c && g.serveState === 'toss')) markerCone.visible = false;
      }
    }
  };
})();
