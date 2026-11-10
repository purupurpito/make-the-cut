/* =====================================================================
 * VOLEY 3D — js/players.js   (owner: players)
 * Atletas estilizados (estilo cartoon: toon + contorno de tinta) hechos con primitivas + animación procedural.
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
  // PLY-21: piernas ~4,5 % más largas y tronco más corto en lo mismo (hombros, cabeza y alcance en su sitio: las poses de
  // brazos, que van en el espacio del cuerpo, siguen valiendo)
  var HIP_H = 1.042, HIP_W = 0.1, THIGH = 0.481, SHIN = 0.481, ANKLE = 0.08;
  var SPINE_Y = 0.079, CHEST_Y = 0.179, SH_X = 0.2, SH_Y = 0.235, SH_Z = -0.01;
  // TAJO (dirección de arte propia, 10-nov-2026): cabezón (~5 cabezas), manopla grande y cuello corto. Las longitudes del rig
  // (HIP_H, THIGH, SHIN, UPPER, FORE) NO cambian: alcance, salto, bloqueo e IK siguen igual. PALM crece con la mano (0,075 × 1,32/1,14).
  var UPPER = 0.3, FORE = 0.27, PALM = 0.087, NECK_Y = 0.345;
  // escala del hueso (la geometría se construye en la pose de reposo ya escalada)
  var HEAD_K = 1.55, HAND_K = 1.32;

  // ---------- Aspecto ----------
  // Equipos (colores alineados con la UI: --hot/--amber y --blue/--sky)
  var TEAMS = [
    { base: 0xff5a2c, top: 0xff7a3c, accent: 0xffb238, dark: 0x6e1606, trim: 0xffffff, shorts: 0x191b22, sole: 0xff6a2a, band: 0xffb238, pad: 0x1d1f26 },
    // CPU: cuerpo azul claro (se separa del azul verdoso de la zona libre) con canesú y paneles BLANCOS y pantalón casi negro:
    // estructura de valores que se lee de lejos sobre la pista y las vallas; acentos #bcd8ff como la UI (c1)
    { base: 0x3363ea, top: 0x4f7ef6, accent: 0xbcd8ff, dark: 0x0b2766, trim: 0xffffff, shorts: 0x0b0e17, sole: 0x2f7bff, band: 0xbcd8ff, pad: 0x141a2a,
      yoke: 0xf4f8ff, panel: 0xf4f8ff }
  ];
  // ---------- Equipación personalizable (Ajustes · Equipación) ----------
  // settings.kitShirt / kitAccent / kitShorts (colores 0xRRGGBB) y kitPattern ('diag' | 'liso' | 'franjas' | 'rayas').
  // El equipo 0 se deriva de esos colores; la CPU usa su equipación azul o, si se parece a la tuya, una alternativa.
  var TEAM0_DEF = TEAMS[0], CPU_KITS = [TEAMS[1],
    { base: 0x1f9a4a, top: 0x36b863, accent: 0xf4f8ff, dark: 0x0a3d1c, trim: 0xffffff, shorts: 0x0b0e17, sole: 0x22b45a, band: 0xf4f8ff, pad: 0x141a2a, yoke: 0xf4f8ff, panel: 0xf4f8ff },
    { base: 0xd8262e, top: 0xea4048, accent: 0xffffff, dark: 0x5a0a0e, trim: 0xffffff, shorts: 0x0b0e17, sole: 0xe8323a, band: 0xffffff, pad: 0x141a2a, yoke: 0xf4f8ff, panel: 0xf4f8ff },
    { base: 0xf2f4f8, top: 0xffffff, accent: 0x1b2b5a, dark: 0x1b2b5a, trim: 0x1b2b5a, shorts: 0x1b2b5a, sole: 0x1b2b5a, band: 0x1b2b5a, pad: 0x141a2a, numFill: '#1b2b5a' }];
  var kitSig = 0;
  function mixHex(a, b, t) {
    var ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255, br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function lumHex(h) { return (0.2126 * (h >> 16 & 255) + 0.7152 * (h >> 8 & 255) + 0.0722 * (h & 255)) / 255; }
  function hueSat(h) {
    var r = (h >> 16 & 255) / 255, g = (h >> 8 & 255) / 255, b = (h & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hu = 0;
    if (d > 0) hu = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hu * 60, mx ? d / mx : 0, mx];
  }
  /** Parecido visual entre dos colores (0 = idénticos): tono si ambos tienen color; si no, luminosidad. */
  function kitDist(a, b) {
    var A = hueSat(a), B = hueSat(b);
    if (A[1] < 0.25 || B[1] < 0.25) return Math.abs(lumHex(a) - lumHex(b)) * 2 + (A[1] < 0.25 && B[1] < 0.25 ? 0 : 0.6);
    var dh = Math.abs(A[0] - B[0]); dh = Math.min(dh, 360 - dh); return dh / 60 + Math.abs(lumHex(a) - lumHex(b));
  }
  /** Equipación completa desde los 4 colores de setKit (camiseta, detalles, pantalón, diseño). */
  function mkKit(shirt, acc, sh, pat) {
    var light = lumHex(shirt) > 0.62;
    // CARTOON (arreglos finales): una camiseta casi negra se fundía con la tinta del contorno y con el uniforme negro de los
    // árbitros; se aclara a pizarra (#383c4a con el negro de la paleta) para que el contorno y los pliegues se lean
    if (lumHex(shirt) < 0.18) shirt = mixHex(shirt, 0x5a5f78, 0.4);
    return { base: shirt, top: mixHex(shirt, 0xffffff, 0.14), accent: acc, dark: light ? 0x20242e : mixHex(shirt, 0x000000, 0.62),
      trim: light ? 0x20242e : 0xffffff, shorts: sh, sole: acc, band: acc, pad: 0x1d1f26, pattern: pat, numFill: light ? '#20242e' : '#ffffff' };
  }
  function setKit(st) {
    st = st || {};
    var shirt = typeof st.kitShirt === 'number' ? st.kitShirt : TEAM0_DEF.base;
    var acc = typeof st.kitAccent === 'number' ? st.kitAccent : TEAM0_DEF.accent;
    var sh = typeof st.kitShorts === 'number' ? st.kitShorts : TEAM0_DEF.shorts;
    var pat = st.kitPattern || 'diag';
    var t0 = mkKit(shirt, acc, sh, pat);
    shirt = t0.base;
    var best = CPU_KITS[0], bd = -1;
    // integración Carrera: st.rival = {kitShirt, kitAccent, kitShorts, kitPattern} viste al equipo 1 con la equipación del club
    // rival si se distingue de la tuya; si se parece, la CPU de siempre (la alternativa más distinta)
    var rv = st.rival && typeof st.rival.kitShirt === 'number' ? st.rival : null, rk = null;
    if (rv) {
      rk = mkKit(rv.kitShirt, typeof rv.kitAccent === 'number' ? rv.kitAccent : 0xffffff, typeof rv.kitShorts === 'number' ? rv.kitShorts : 0x0b0e17, rv.kitPattern || 'diag');
      if (Math.min(kitDist(shirt, rk.base), kitDist(sh, rk.shorts) + 1.5) < 1.1) rk = null;
    }
    if (rk) { best = rk; bd = 9; }
    else for (var i = 0; i < CPU_KITS.length; i++) {   // la azul de siempre si se distingue bien; si no, la alternativa más distinta
      var d = Math.min(kitDist(shirt, CPU_KITS[i].base), kitDist(sh, CPU_KITS[i].shorts) + 1.5);
      if (i === 0 && d >= 1.1) { best = CPU_KITS[0]; bd = 9; break; }
      if (d > bd) { bd = d; best = CPU_KITS[i]; }
    }
    var sig = [shirt, acc, sh, pat, rk ? [rk.base, rk.accent, rk.shorts, rk.pattern].join('/') : ''].join(':');
    if (sig === TEAMS._sig) return false;
    TEAMS[0] = t0; TEAMS[1] = best; TEAMS._sig = sig; kitSig++;
    flushCache();   // fuera los atletas construidos con la equipación anterior (texturas y mallas)
    return true;
  }
  /** Libera todos los atletas construidos (equipación nueva o cambio de escenario). */
  function flushCache() {
    for (var key in cache) {
      var r = cache[key];
      if (r.ink && VB.TOON && VB.TOON.drop) VB.TOON.drop(r.ink);   // integración: el contorno vive en la lista de VB.TOON
      else if (r.ink && r.ink.parent) r.ink.parent.remove(r.ink);
      try { if (r.skin && r.skin.material) { if (r.skin.material.map) r.skin.material.map.dispose(); r.skin.material.dispose(); } for (var gi in r.geos) if (r.geos[gi] && r.geos[gi].dispose) r.geos[gi].dispose(); } catch (e) { }
      // la textura de huesos del esqueleto (16×16 RGBA32F, una por atleta; la comparte el contorno) también es una textura de
      // GPU: sin esto se perdían 4 por cambio de escenario o de equipación en 2v2 (14 en 6v6)
      try { if (r.skin && r.skin.skeleton && r.skin.skeleton.dispose) r.skin.skeleton.dispose(); } catch (e) { }
      delete cache[key];
    }
  }
  // ---------- TAJO: escenario (pabellón / playa) ----------
  // Los atletas se visten según el escenario que publica arena (VB.Arena.venue(): 'hall' | 'beach'; si no existe, el ajuste
  // ctx.settings.arena o ?map=beach). Se mira cada frame en update (coste: una llamada); al cambiar, se liberan los atletas y
  // se reconstruyen con la ropa del escenario (como al cambiar de equipación). VB.Players.setVenue(v) lo fuerza (pruebas).
  var VEN = 'hall', VEN_FORCE = '';
  function venueNow() {
    if (VEN_FORCE) return VEN_FORCE;
    try { if (VB.Arena && VB.Arena.venue) return VB.Arena.venue() === 'beach' ? 'beach' : 'hall'; } catch (e) { }
    var pm = ctx && ctx.params && ctx.params.map;
    if (pm === 'beach' || pm === 'playa') return 'beach';
    return ctx && ctx.settings && ctx.settings.arena === 'beach' ? 'beach' : 'hall';
  }
  /** true si el escenario cambió (y los atletas se liberaron: el siguiente onGameStart los viste de nuevo). */
  function syncVenue() {
    var v = venueNow(); if (v === VEN) return false;
    VEN = v; flushCache(); return true;
  }
  // ---------- 6v6: camiseta del líbero (role 'L') ----------
  // Cuarta equipación derivada de la del equipo: el color de la camiseta es el candidato que más se separa A LA VEZ de la
  // camiseta de su equipo y de la del rival (acento del equipo, complementario, y una paleta fija de colores vivos); detalles
  // con la camiseta del equipo (se lee que es de los suyos), mismo pantalón y diseño liso. Se recalcula al cambiar la
  // equipación (kitSig). En 2v2 no se usa nunca (no hay role).
  var LIB_PAL = [0xffd23a, 0x2bd96b, 0xff3fa4, 0x18c8d8, 0xf4f8ff, 0x9a5cff, 0xff8a1e];
  var LIBK = [null, null], LIBSIG = -1;
  function compHex(h) { return ((255 - (h >> 16 & 255)) << 16) | ((255 - (h >> 8 & 255)) << 8) | (255 - (h & 255)); }
  function liberoKit(team) {
    if (LIBSIG !== kitSig) { LIBK[0] = LIBK[1] = null; LIBSIG = kitSig; }
    if (LIBK[team]) return LIBK[team];
    var own = TEAMS[team], riv = TEAMS[1 - team], cands = [own.accent, compHex(own.base)].concat(LIB_PAL), best = cands[0], bd = -1;
    var o0 = team === 1 ? liberoKit(0).base : -1;   // el líbero rival, además, distinto del tuyo
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], d = Math.min(kitDist(c, own.base), kitDist(c, riv.base), kitDist(c, riv.accent) + 0.4);
      if (o0 >= 0) d = Math.min(d, kitDist(c, o0) + 0.2);
      if (lumHex(c) < 0.18) continue;                    // oscuro: se funde con la tinta del contorno (mkKit lo volvería pizarra)
      if (hueSat(c)[1] < 0.25) d -= 0.35;                // a igualdad, mejor un color vivo que el blanco
      if (d > bd + 1e-6) { bd = d; best = c; }
    }
    var k = mkKit(best, own.base, own.shorts, 'liso');
    k.libero = true;
    return (LIBK[team] = k);
  }
  /** Equipación de un jugador: la del equipo o, si es el líbero (6v6), la suya. */
  function kitOf(p) { return p.role === 'L' ? liberoKit(p.team) : TEAMS[p.team]; }
  // Por id de jugador: piel, pelo, peinado, escala de altura
  var LOOKS = [
    // TAJO: peinados de mechones grandes y lisos (tupe, puff2, coleta, cresta, flequillo, rapado, trenzas: headGeo)
    { skin: 0xdba27a, hair: 0x3a2416, style: 'tupe', h: 1.0 },   // CARTOON: pelos algo más claros (se separan de la tinta del contorno)
    { skin: 0x8a5638, hair: 0x2b1d17, style: 'puff2', h: 1.03 },
    { skin: 0xc68a5f, hair: 0x4b2a18, style: 'coleta', h: 0.985 },
    { skin: 0xf0c6a4, hair: 0x2e2420, style: 'cresta', h: 1.04 }
  ];
  // 6v6: más variedad (12 en pista). Estos solo se usan con p.role.
  var LOOKS6 = LOOKS.concat([
    { skin: 0xb07650, hair: 0x6a4424, style: 'flequillo', h: 1.0 },
    { skin: 0xe6b48e, hair: 0x9a6a3a, style: 'trenzas', h: 1.0 },
    { skin: 0x6e4430, hair: 0x1e1612, style: 'rapado', h: 1.0 },
    { skin: 0xf3d0b0, hair: 0xb88a4e, style: 'tupe', h: 1.0 },
    { skin: 0xa36a48, hair: 0x2b1d17, style: 'coleta', h: 1.0 },
    { skin: 0xd9a07c, hair: 0x241a14, style: 'puff2', h: 1.0 }
  ]);
  // escala de altura por puesto (solo visual): centrales y opuestos altos, colocador y líbero algo más bajos
  var ROLE_H = { MB: 1.05, OPP: 1.03, OH: 1.015, S: 0.985, L: 0.955 };
  function lookOf(p) {
    if (!p.role) return LOOKS[p.id % LOOKS.length];
    var b = LOOKS6[(p.num * 7 + p.team * 5) % LOOKS6.length], h = ROLE_H[p.role] || 1;
    return { skin: b.skin, hair: b.hair, style: b.style, h: h * (1 + ((p.num * 13) % 5 - 2) * 0.006) };
  }

  var rigs = [], byId = [], cache = {}, lastBlocker = null;
  var groupRoot, marker, markerCone, markerMat, coneMat;
  var markerDim = 1;   // atenuación del halo con el balón muerto

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
  // texel blanco del atlas (piezas de color por vértice); la piel en v = 0,04. TAJO: bajan (filas 461 / 491) para dejar las filas
  // 276-424 a la hoja de caras (FACE_*): con 37 filas de separación los mipmaps no mezclan la cara con el blanco
  var BODY_UV_U = 0.5, BODY_UV_V = 0.1, SKIN_UV_V = 0.04;
  // ownUv: la pieza trae su propia UV del atlas (la lámina de la cara)
  function Geo() { this.p = []; this.n = []; this.c = []; this.u = []; this.si = []; this.sw = []; this.i = []; this.k = 0; this.pre = null; this.bone = 0; this.jersey = false; this.bone2 = -1; this.w2 = null; this.skinHex = -1; this.uvv = -1; this.o = []; this.owk = 1; this.ownUv = false; }
  Geo.prototype.add = function (geo, hex, x, y, z, rx, ry, rz, sx, sy, sz) {
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    q.setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
    if (this.pre) m.premultiply(this.pre);
    nm.getNormalMatrix(m);
    var P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, col = new THREE.Color(hex == null ? 0xffffff : hex), i;
    var skin = hex != null && hex === this.skinHex;   // piel: v propia en la zona blanca del atlas (el shader la reconoce: PLY-17)
    var m0 = this.w2 ? m.clone() : null; if (m0 && this.pre) m0.premultiply(new THREE.Matrix4().copy(this.pre).invert());
    for (i = 0; i < P.count; i++) {
      // piel a dos huesos (w2: peso del segundo hueso según la y LOCAL del vértice; p. ej. la rodillera sobre la rodilla)
      var w2 = 0; if (m0) { v.fromBufferAttribute(P, i).applyMatrix4(m0); w2 = this.w2(v.y); }
      v.fromBufferAttribute(P, i).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      if (this.jersey) this.u.push(U ? U.getX(i) : 0, 0.5 + 0.5 * clamp((v.y - JY0) / (JY1 - JY0), 0, 1));
      else if (this.ownUv && U) this.u.push(U.getX(i), U.getY(i));
      else this.u.push(BODY_UV_U, this.uvv >= 0 ? this.uvv : skin ? SKIN_UV_V : BODY_UV_V);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.c.push(col.r, col.g, col.b); this.o.push(this.owk);
      if (w2 > 0) { this.si.push(this.bone, this.bone2, 0, 0); this.sw.push(1 - w2, w2, 0, 0); }
      else { this.si.push(this.bone, 0, 0, 0); this.sw.push(1, 0, 0, 0); }
    }
    if (geo.index) for (i = 0; i < geo.index.count; i++) this.i.push(geo.index.getX(i) + this.k);
    else for (i = 0; i < P.count; i++) this.i.push(this.k + i);
    this.k += P.count; geo.dispose(); return this;
  };
  Geo.prototype.build = function () {
    var g = new THREE.BufferGeometry(), w = new Float32Array(this.sw);
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    g.setAttribute('ow', new THREE.Float32BufferAttribute(this.o, 1));   // peso del contorno de tinta (outlineMesh)
    g.setIndex(this.i);
    // esfera amplia: la piel no recalcula límites (salto, plancha, brazos arriba)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0.2), 2.3);
    return g;
  };

  function V2(x, y) { return new THREE.Vector2(x, y); }
  // ---------- Nivel de detalle (LOD) por calidad ----------
  // Los segmentos de cada primitiva se escalan con LODK (alta 1, media 0,62, baja 0,42) con un mínimo por pieza.
  // La malla del atleta se reconstruye (misma piel, mismos huesos) al cambiar de calidad: ver setLod().
  var LOD_K = [0.42, 0.62, 1], LODK = 1, LODR = 2;
  function sg(n, mn) { return Math.max(mn || 3, Math.round(n * LODK)); }
  /** Perfil de extremidad (de abajo arriba) para LatheGeometry: cuelga en -Y de 0 a -len. */
  function limbPts(len, r0, r1, bAt, bulge, n) {
    var pts = [], i, a, nc = LODR === 2 ? 3 : 2;
    n = sg(n, 3);
    for (i = 0; i <= nc; i++) { a = i / nc * PI / 2; pts.push(V2(Math.sin(a) * r1, -len - Math.cos(a) * r1 * 0.75)); }
    for (i = 1; i < n; i++) {
      var t = 1 - i / n, d = (t - bAt) / 0.3;
      pts.push(V2(r0 + (r1 - r0) * t + bulge * Math.exp(-d * d), -len * t));
    }
    for (i = 0; i <= nc; i++) { a = i / nc * PI / 2; pts.push(V2(Math.cos(a) * r0, Math.sin(a) * r0 * 0.75)); }
    return pts;
  }
  function lathe(pts, seg, mn) { return new THREE.LatheGeometry(pts, sg(seg, mn || 8), 0, PI * 2); }
  function sph(r, w, h, ps, pl, ts, tl) { return new THREE.SphereGeometry(r, sg(w || 12, 6), sg(h || 8, 3), ps || 0, pl == null ? PI * 2 : pl, ts || 0, tl == null ? PI : tl); }
  function cyl(rt, rb, h, seg, open) { return new THREE.CylinderGeometry(rt, rb, h, sg(seg || 12, 8), 1, !!open); }
  function torus(r, t, rs, ts) { return new THREE.TorusGeometry(r, t, sg(rs, 3), sg(ts, 8)); }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

  // Perfiles del tronco (y local de cada hueso) [r, y] de abajo arriba
  var CHEST_PROF = [[0, -0.17], [0.142, -0.16], [0.15, -0.08], [0.162, 0.0], [0.172, 0.08], [0.176, 0.15], [0.166, 0.205], [0.142, 0.25], [0.1, 0.282], [0.058, 0.3], [0, 0.306]];
  var CHEST_S = [1.38, 1, 0.84];   // TAJO: torso en V (pecho ancho, cintura estrecha)
  // el bajo de la camiseta se abre un poco y la cintura del pantalón queda DENTRO (sin anillo ni parpadeo)
  // PLY-21: cintura más estrecha y bajo de la camiseta algo abierto
  var ABS_PROF = [[0, -0.135], [0.18, -0.13], [0.177, -0.105], [0.16, -0.035], [0.144, 0.035], [0.132, 0.1], [0.118, 0.16], [0, 0.17]];
  var ABS_S = [1.1, 1, 0.8];       // TAJO: algo más estrecho (el bajo sigue por fuera del pantalón: 0,198 frente a 0,19)
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
  // TAJO: L (aspecto) y beach (versión de playa) para la hoja de caras y la camiseta de tirantes
  function paintAtlas(cv, tc, num, L, beach) {
    var g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 512);
    paintJersey(g, tc, L, beach);
    // bajo prolongado con el color de la camiseta (no un cinturón oscuro): el filtrado de mipmaps
    // no mezcla el blanco del atlas con el bajo; el ribete real es fino (paintJersey)
    g.fillStyle = hexCss(tc.base); g.fillRect(0, 256, 512, 18);
    paintNumbers(g, num, tc, beach);
    if (L) paintFace(g, L, tc, beach);
  }
  /** TAJO: el corte diagonal de «Make the Cut»: banda clara con los dos bordes en zigzag y filo oscuro, de (x0, y0) a (x1, y1)
   *  (píxeles del atlas de la camiseta), de ancho w. */
  function tajoBand(g, x0, y0, x1, y1, w, fill, edge) {
    var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy), ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    function band(hw, zz) {
      var n = Math.max(2, Math.round(l / 14)), i, t, o, pts = [];
      for (i = 0; i <= n; i++) { t = i / n; o = hw + (i % 2 ? zz : -zz); pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]); }
      for (i = n; i >= 0; i--) { t = i / n; o = -hw + (i % 2 ? -zz : zz); pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]); }
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill();
    }
    g.fillStyle = hexCss(edge); band(w / 2 + 5, 5);
    g.fillStyle = hexCss(fill); band(w / 2, 5);
  }
  function tajoFill(tc) { return lumHex(tc.base) > 0.62 ? tc.accent : 0xf8f8f4; }
  /** Camiseta: u alrededor (0 = delante, .25 izquierda, .5 espalda, .75 derecha); filas 0-255 de arriba (cuello) abajo (bajo). */
  function paintJersey(g, tc, L, beach) {
    var W = 512, H = 256;
    // CARTOON: color plano (sin degradado ni trama sublimada: el sombreado toon ya da el volumen)
    g.fillStyle = hexCss(tc.base); g.fillRect(0, 0, W, H);
    function wrap(fn) { fn(0); fn(W); fn(-W); }
    if (beach) { paintTank(g, tc, L, wrap); return; }
    // paneles laterales (bajo el brazo) en color de acento (o blancos) con filo oscuro
    [0.25, 0.75].forEach(function (u) {
      var cx = u * W, wb = tc.panel ? 1.25 : 1;
      g.fillStyle = hexCss(tc.dark); g.beginPath(); g.moveTo(cx - 40 * wb, H); g.lineTo(cx + 40 * wb, H); g.lineTo(cx + 22 * wb, 0); g.lineTo(cx - 22 * wb, 0); g.fill();
      g.fillStyle = hexCss(tc.panel || tc.accent); g.beginPath(); g.moveTo(cx - 33 * wb, H); g.lineTo(cx + 33 * wb, H); g.lineTo(cx + 15 * wb, 0); g.lineTo(cx - 15 * wb, 0); g.fill();
    });
    // canesú blanco sobre los hombros (delante y detrás), con filo oscuro; queda por encima de los dorsales
    if (tc.yoke) {
      wrap(function (o) {
        g.fillStyle = hexCss(tc.dark);
        g.beginPath(); g.moveTo(o - W * 0.5, 0); g.lineTo(o + W * 0.5, 0); g.lineTo(o + W * 0.5, 30); g.quadraticCurveTo(o + W * 0.25, 46, o, 30);
        g.quadraticCurveTo(o - W * 0.25, 46, o - W * 0.5, 30); g.fill();
        g.fillStyle = hexCss(tc.yoke);
        g.beginPath(); g.moveTo(o - W * 0.5, 0); g.lineTo(o + W * 0.5, 0); g.lineTo(o + W * 0.5, 25); g.quadraticCurveTo(o + W * 0.25, 40, o, 25);
        g.quadraticCurveTo(o - W * 0.25, 40, o - W * 0.5, 25); g.fill();
      });
    }
    // diseño de la camiseta (equipación personalizable, setKit): 'diag' franja diagonal en el pecho (la de siempre),
    // 'liso' sin franja, 'franjas' dos bandas horizontales, 'rayas' rayas verticales finas
    // TAJO: 'diag' (el diseño por defecto, «Diagonal» en Ajustes) es ahora el TAJO: corte claro en zigzag del hombro izquierdo a
    // la cadera derecha que pasa por el dorsal del pecho (que va dentro, en oscuro: paintNumbers)
    var pat = tc.pattern || 'diag';
    if (pat === 'diag') {
      wrap(function (o) { tajoBand(g, o + 48, -8, o - 126, 264, 66, tajoFill(tc), tc.dark); });
    } else if (pat === 'franjas') {
      g.fillStyle = hexCss(tc.accent); g.globalAlpha = 0.92; g.fillRect(0, 150, W, 22); g.fillRect(0, 180, W, 10); g.globalAlpha = 1;
    } else if (pat === 'rayas') {
      g.fillStyle = hexCss(tc.accent); g.globalAlpha = 0.55;
      for (var rx = 8; rx < W; rx += 32) g.fillRect(rx, 30, 9, H - 42);
      g.globalAlpha = 1;
    }
    // canesú en la espalda (parte alta) en oscuro
    if (!tc.yoke) { g.fillStyle = hexCss(tc.dark); g.globalAlpha = 0.35; g.fillRect(150, 0, 212, 22); g.globalAlpha = 1; }
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
  function paintNumbers(g, num, tc, beach) {
    var s = String(num), chest0 = HIP_H + SPINE_Y + CHEST_Y;
    // TAJO: el dorsal del pecho va dentro del corte claro, en el oscuro del equipo (sin filo); playa: dorsal grande en el pecho
    var inTajo = !beach && (tc.pattern || 'diag') === 'diag';
    function one(cx, yTop, yBot, sx, dark) {
      var r0 = jerseyRow(yTop), r1 = jerseyRow(yBot), h = r1 - r0;
      g.save(); g.translate(cx, (r0 + r1) / 2); g.scale(sx, 1);
      g.font = 'italic 900 ' + Math.round(h * 1.12) + 'px ' + NUM_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round';
      if (dark) { g.fillStyle = hexCss(tc.dark); g.fillText(s, 0, h * 0.06); g.restore(); return; }
      g.lineWidth = h * 0.13; g.strokeStyle = hexCss(tc.dark);
      g.strokeText(s, 0, h * 0.06); g.fillStyle = tc.numFill || '#ffffff'; g.fillText(s, 0, h * 0.06);
      g.restore();
    }
    one(256, chest0 + 0.19, chest0 - 0.03, 0.95);           // espalda (~20 cm)
    if (beach) { one(0, chest0 + 0.19, chest0 + 0.03, 1.2); one(512, chest0 + 0.19, chest0 + 0.03, 1.2); return; }
    one(0, chest0 + 0.175, chest0 + 0.08, 1.3, inTajo); one(512, chest0 + 0.175, chest0 + 0.08, 1.3, inTajo); // pecho (cruza la costura; más ancho: la curva lo estrecha)
  }
  /** TAJO (playa): camiseta de TIRANTES de licra del equipo, unisex: sisas de piel (espalda nadadora: más abiertas hacia
   *  atrás), cuello redondo, tajo en zigzag bajo el dorsal grande del pecho. Nada de tops ni ropa suelta por jugador. */
  function paintTank(g, tc, L, wrap) {
    var W = 512, H = 256, sk = hexCss(L ? L.skin : 0xd9a07c);
    // paneles laterales finos de acento
    [0.25, 0.75].forEach(function (u) {
      var cx = u * W;
      g.fillStyle = hexCss(tc.accent); g.beginPath(); g.moveTo(cx - 20, H); g.lineTo(cx + 20, H); g.lineTo(cx + 12, 60); g.lineTo(cx - 12, 60); g.fill();
    });
    wrap(function (o) { tajoBand(g, o + 150, 112, o - 150, 214, 40, tajoFill(tc), tc.dark); });
    // sisas (piel) con ribete de acento: más abiertas hacia la espalda (u = .5)
    [[128 + 16, 1], [384 - 16, -1]].forEach(function (a) {
      g.fillStyle = hexCss(tc.accent); g.beginPath(); g.ellipse(a[0], -4, 62, 74, 0, 0, PI * 2); g.fill();
      g.fillStyle = sk; g.beginPath(); g.ellipse(a[0], -4, 56, 68, 0, 0, PI * 2); g.fill();
    });
    // espalda nadadora: tirante estrecho entre las dos sisas
    g.fillStyle = sk; g.beginPath(); g.ellipse(256, -10, 40, 26, 0, 0, PI * 2); g.fill();
    // cuello redondo delante con ribete
    wrap(function (o) {
      g.fillStyle = hexCss(tc.accent); g.beginPath(); g.ellipse(o, -2, 46, 26, 0, 0, PI * 2); g.fill();
      g.fillStyle = sk; g.beginPath(); g.ellipse(o, -4, 41, 21, 0, 0, PI * 2); g.fill();
    });
    g.fillStyle = hexCss(tc.base); g.fillRect(0, H - 12, W, 12);
    g.fillStyle = hexCss(tc.dark); g.globalAlpha = 0.45; g.fillRect(0, H - 6, W, 3); g.globalAlpha = 1;
  }

  // =====================================================================
  //  TAJO: HOJA DE CARAS (cara dibujada en el atlas del jugador, filas FACE_Y0-FACE_Y1)
  // =====================================================================
  // La cara es una lámina pegada al cráneo (faceGeo) con UV en la celda 0; el shader suma el desplazamiento de la celda de la
  // expresión (uniformes uEyeOff / uMouthOff): cambiar de cara = 2 uniformes, sin texturas, mallas ni programas nuevos.
  //  - Ojos y cejas: 8 celdas de 128×46 (4 por fila, 2 filas): 0 abiertos · 1 parpadeo · 2 entornados (esfuerzo) · 3 felices ^ ^ ·
  //    4 tristes · 5 grito (enormes, cejas de guerra) · 6 guiño · 7 concentrado/enfadado (cejas en V).
  //    Sello: la «raya de guerra» (dos trazos bajo cada ojo, acento del equipo con filo oscuro); en la playa, crema de zinc neón.
  //  - Boca: 8 celdas de 64×52 (una fila): 0 neutra · 1 sonrisa · 2 grito en O con dientes · 3 dientes apretados · 4 triste ·
  //    5 «o» pequeña · 6 sonrisa con lengua · 7 mueca.
  // Coordenadas de la lámina: dirección (dx, dy) sobre la esfera unidad de headShape; se pinta en metros del hueso de la cabeza
  // relativos a HEAD_C (X = dx·HEAD_RX, Y = dy·HEAD_RY).
  var FACE_Y0 = 276, FACE_Y1 = 424, FE_W = 128, FE_H = 46, FE_Y = 278, FM_W = 64, FM_H = 52, FM_Y = 370, F_PAD = 3;
  var FE_DX = 0.66, FE_DY0 = -0.24, FE_DY1 = 0.38, FM_DX = 0.45, FM_DY0 = -0.64, FM_DY1 = -0.28;
  function faceInk(tc) { return mixHex(tc.dark, INK, 0.55); }
  /** Pieles oscuras (luminancia < 0,42): halo claro alrededor de ojos, cejas y boca. Sin él, la tinta, el pelo y la sombra toon
   *  tenían casi el mismo tono y desde la cámara de juego solo se veía el blanco del ojo (revisión visual TAJO). null = no hace falta. */
  function faceHalo(L) {
    var lu = lumHex(L.skin); if (lu >= 0.42) return null;
    return hexCss(mixHex(L.skin, 0xffe6d2, clamp(0.38 + (0.42 - lu) * 1.6, 0.38, 0.6)));
  }
  function paintFace(g, L, tc, beach) {
    g.save();
    g.fillStyle = hexCss(L.skin); g.fillRect(0, FACE_Y0, 512, FACE_Y1 - FACE_Y0);
    var i;
    for (i = 0; i < 8; i++) faceCell(g, (i & 3) * FE_W, FE_Y + (i >> 2) * FE_H, FE_W, FE_H, FE_DX, FE_DY0, FE_DY1, function () { paintEyes(g, i, L, tc, beach); });
    for (i = 0; i < 8; i++) faceCell(g, i * FM_W, FM_Y, FM_W, FM_H, FM_DX, FM_DY0, FM_DY1, function () { paintMouth(g, i, L, tc); });
    g.restore();
  }
  /** Celda: recorte y transformación de metros del hueso de la cabeza (X, Y relativos a HEAD_C) a píxeles. */
  function faceCell(g, x0, y0, w, h, dxM, dy0, dy1, fn) {
    var X0 = -dxM * HEAD_RX, X1 = dxM * HEAD_RX, Y0 = dy0 * HEAD_RY, Y1 = dy1 * HEAD_RY;
    var a = (w - 2 * F_PAD) / (X1 - X0), d = -(h - 2 * F_PAD) / (Y1 - Y0);
    g.save(); g.beginPath(); g.rect(x0 + 1, y0 + 1, w - 2, h - 2); g.clip();
    g.setTransform(a, 0, 0, d, x0 + F_PAD - a * X0, y0 + F_PAD - d * Y1);
    g.lineCap = 'round'; g.lineJoin = 'round';
    fn();
    g.restore();
  }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, PI * 2); }
  /** Mancha elíptica de color css que se desvanece hacia el borde (macizo hasta el 55 % del radio). */
  function softHalo(g, x, y, rx, ry, css) {
    g.save(); g.translate(x, y); g.scale(1, ry / rx);
    var gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    var h = parseInt(css.slice(1), 16), clear = 'rgba(' + (h >> 16 & 255) + ',' + (h >> 8 & 255) + ',' + (h & 255) + ',0)'; // (mismo color: sin halo gris)
    gr.addColorStop(0, css); gr.addColorStop(0.55, css); gr.addColorStop(1, clear);
    g.fillStyle = gr; g.globalAlpha = 0.92; g.beginPath(); g.arc(0, 0, rx, 0, PI * 2); g.fill();
    g.restore();
  }
  var EYE_CX = 0.034, EYE_CY = 0.012, EYE_RX = 0.0155, EYE_RY = 0.0195;
  function paintEyes(g, cell, L, tc, beach) {
    var ink = hexCss(faceInk(tc)), brow = hexCss(L.browC || mixHex(L.hair, 0x000000, 0.15)), halo = faceHalo(L), s, k;
    // piel oscura: halo claro y difuso detrás de cada ojo (también cerrado), antes del sello para no taparlo
    if (halo) for (s = -1; s <= 1; s += 2) softHalo(g, s * EYE_CX, EYE_CY + 0.002, EYE_RX * 1.55, EYE_RY * 1.35, halo);
    // sello del equipo bajo los ojos (todas las celdas: se lee igual con cualquier expresión)
    for (s = -1; s <= 1; s += 2) {
      if (beach) {
        // crema de zinc de color neón del equipo: dos rayas gruesas en cada mejilla
        var zc = hexCss(zincHex(tc));
        g.strokeStyle = zc; g.lineWidth = 0.0058;
        for (k = 0; k < 2; k++) { g.beginPath(); g.moveTo(s * 0.022, -0.0135 - k * 0.0085); g.lineTo(s * 0.05, -0.0105 - k * 0.0085); g.stroke(); }
      } else {
        // raya de guerra: dos trazos diagonales cortos (acento con filo oscuro)
        for (k = 0; k < 2; k++) {
          var xa = s * (0.027 + k * 0.011), ya = -0.0115, xb = s * (0.021 + k * 0.011), yb = -0.0235;
          g.strokeStyle = hexCss(tc.dark); g.lineWidth = 0.0062; g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
          g.strokeStyle = hexCss(tc.accent); g.lineWidth = 0.0038; g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
        }
      }
    }
    // ojos
    for (s = -1; s <= 1; s += 2) {
      var cx = s * EYE_CX, cy = EYE_CY, kind = cell;
      if (cell === 6 && s < 0) kind = 3;          // guiño: el derecho (x < 0) cerrado en arco
      else if (cell === 6) kind = 0;
      g.lineWidth = 0.0034; g.strokeStyle = ink;
      if (kind === 1) {                            // parpadeo: línea curva
        g.beginPath(); g.moveTo(cx - EYE_RX, cy - 0.002); g.quadraticCurveTo(cx, cy - 0.009, cx + EYE_RX, cy - 0.002); g.stroke();
      } else if (kind === 3) {                     // feliz: arco ^
        g.lineWidth = 0.0042;
        g.beginPath(); g.moveTo(cx - EYE_RX, cy - 0.006); g.quadraticCurveTo(cx, cy + 0.02, cx + EYE_RX, cy - 0.006); g.stroke();
      } else {
        var rx = EYE_RX, ry = EYE_RY, pr = 0.0095, py = -0.002, px = -s * 0.0018, lid = 0, lidTilt = 0;
        if (kind === 5) { rx *= 1.12; ry *= 1.12; pr = 0.0068; py = 0; px = 0; }
        if (kind === 2) { lid = 0.5; lidTilt = 0.18; }            // entornados (esfuerzo)
        if (kind === 4) { lid = 0.34; lidTilt = -0.42; py = -0.006; } // tristes: párpado caído hacia fuera, mirada baja
        if (kind === 7) { lid = 0.3; lidTilt = 0.5; }             // concentrado: párpado en diagonal
        g.save();
        ell(g, cx, cy, rx, ry); g.fillStyle = '#ffffff'; g.fill();
        g.clip();
        ell(g, cx + px, cy + py, pr * 0.82, pr); g.fillStyle = ink; g.fill();
        g.fillStyle = '#ffffff';
        ell(g, cx + px - s * 0.0032 + 0.001, cy + py + 0.0045, pr * 0.32, pr * 0.34); g.fill();
        ell(g, cx + px + s * 0.0028, cy + py - 0.0042, pr * 0.15, pr * 0.16); g.fill();
        if (lid > 0) {                             // párpado: piel por encima de una línea inclinada
          var ly = cy + ry - 2 * ry * lid, t = lidTilt * s;
          g.fillStyle = hexCss(L.skin); g.beginPath();
          g.moveTo(cx - rx * 1.3, ly - t * rx); g.lineTo(cx + rx * 1.3, ly + t * rx); g.lineTo(cx + rx * 1.3, cy + ry * 1.4); g.lineTo(cx - rx * 1.3, cy + ry * 1.4); g.closePath(); g.fill();
          g.strokeStyle = ink; g.lineWidth = 0.0036; g.beginPath(); g.moveTo(cx - rx * 1.3, ly - t * rx); g.lineTo(cx + rx * 1.3, ly + t * rx); g.stroke();
        }
        g.restore();
        g.strokeStyle = ink; g.lineWidth = 0.0032; ell(g, cx, cy, rx, ry); g.stroke();
      }
      // cejas gruesas (por expresión): bx = interior → exterior
      var bi = 0.031, bo = 0.026, bm = 0.033;   // alto interior, exterior y del centro (Y)
      if (cell === 2 || cell === 5 || cell === 7) { bi = 0.022; bo = 0.03; bm = 0.028; }      // en V (esfuerzo, grito, concentración)
      if (cell === 4) { bi = 0.035; bo = 0.025; bm = 0.032; }                                  // tristes
      if (cell === 3) { bi = 0.034; bo = 0.031; bm = 0.038; }                                  // felices: arriba
      if (cell === 6) { if (s > 0) { bi = 0.035; bo = 0.034; bm = 0.04; } else { bi = 0.028; bo = 0.027; bm = 0.03; } }
      if (halo) { g.strokeStyle = halo; g.lineWidth = 0.0098; g.beginPath(); g.moveTo(s * 0.019, bi); g.quadraticCurveTo(s * 0.034, bm + 0.002, s * 0.05, bo); g.stroke(); }
      g.strokeStyle = brow; g.lineWidth = 0.0058;
      g.beginPath(); g.moveTo(s * 0.019, bi); g.quadraticCurveTo(s * 0.034, bm + 0.002, s * 0.05, bo); g.stroke();
    }
  }
  /** Color de la crema de zinc (playa): el acento del equipo llevado a neón (muy saturado y claro). */
  function zincHex(tc) {
    var c = new THREE.Color(tc.accent), hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
    if (hsl.s < 0.25) return 0x3ff0ff;   // acento blanco o gris: cian neón
    c.setHSL(hsl.h, 1, clamp(hsl.l, 0.55, 0.62)); return c.getHex();
  }
  var MOUTH_CY = -0.052, MOUTH_K = 1.35;
  function paintMouth(g, cell, L, tc) {
    var ink = hexCss(faceInk(tc)), cy = MOUTH_CY, inner = '#5a1620', tongue = '#ef6f78', teeth = '#fffaf0';
    g.translate(0, cy); g.scale(MOUTH_K, MOUTH_K); g.translate(0, -cy);   // boca grande de dibujo animado
    var halo = faceHalo(L);
    if (halo) softHalo(g, 0, cy - 0.003, 0.026, 0.0135, halo);   // piel oscura: hocico claro y difuso detrás de la boca
    g.strokeStyle = ink; g.lineWidth = 0.0026;
    switch (cell) {
      case 1:   // sonrisa
        g.beginPath(); g.moveTo(-0.019, cy + 0.004); g.quadraticCurveTo(0, cy - 0.013, 0.019, cy + 0.004); g.stroke(); break;
      case 2:   // grito: O grande con dientes de arriba y lengua
        g.save(); ell(g, 0, cy - 0.003, 0.0145, 0.0135); g.fillStyle = inner; g.fill(); g.clip();
        g.fillStyle = tongue; ell(g, 0, cy - 0.016, 0.011, 0.007); g.fill();
        g.fillStyle = teeth; g.fillRect(-0.02, cy + 0.0065, 0.04, 0.0045); g.restore();
        ell(g, 0, cy - 0.003, 0.0145, 0.0135); g.stroke(); break;
      case 3:   // dientes apretados
        g.fillStyle = teeth; g.beginPath(); g.ellipse(0, cy, 0.017, 0.0065, 0, 0, PI * 2); g.fill();
        g.lineWidth = 0.0018; g.beginPath(); g.moveTo(-0.016, cy); g.lineTo(0.016, cy);
        for (var k = -2; k <= 2; k++) { g.moveTo(k * 0.006, cy - 0.006); g.lineTo(k * 0.006, cy + 0.006); }
        g.stroke(); g.lineWidth = 0.003; g.beginPath(); g.ellipse(0, cy, 0.017, 0.0065, 0, 0, PI * 2); g.stroke(); break;
      case 4:   // triste
        g.beginPath(); g.moveTo(-0.014, cy - 0.006); g.quadraticCurveTo(0, cy + 0.006, 0.014, cy - 0.006); g.stroke(); break;
      case 5:   // «o» pequeña
        ell(g, 0, cy - 0.001, 0.0055, 0.006); g.fillStyle = inner; g.fill(); g.stroke(); break;
      case 6:   // sonrisa abierta con lengua (D)
        g.save(); g.beginPath(); g.moveTo(-0.017, cy + 0.005); g.quadraticCurveTo(0, cy - 0.024, 0.017, cy + 0.005); g.closePath();
        g.fillStyle = inner; g.fill(); g.clip();
        g.fillStyle = tongue; ell(g, 0.002, cy - 0.011, 0.009, 0.006); g.fill();
        g.fillStyle = teeth; g.fillRect(-0.02, cy + 0.001, 0.04, 0.004); g.restore();
        g.beginPath(); g.moveTo(-0.017, cy + 0.005); g.quadraticCurveTo(0, cy - 0.024, 0.017, cy + 0.005); g.closePath(); g.stroke(); break;
      case 7:   // mueca (ondulada)
        g.beginPath(); g.moveTo(-0.016, cy - 0.001);
        g.bezierCurveTo(-0.008, cy + 0.005, -0.004, cy - 0.006, 0, cy); g.bezierCurveTo(0.004, cy + 0.006, 0.008, cy - 0.005, 0.016, cy + 0.002); g.stroke(); break;
      default:  // neutra: línea corta algo curva
        g.beginPath(); g.moveTo(-0.01, cy + 0.001); g.quadraticCurveTo(0, cy - 0.003, 0.01, cy + 0.001); g.stroke();
    }
  }
  function atlasMaterial(num, tc, L, beach) {
    var cv = canvas(512, 512); paintAtlas(cv, tc, num, L, beach);
    var t = texOf(cv);
    // CARTOON: material toon (bandas de luz duras con el gradientMap de VB.TOON, sin especular) en vez del estándar
    var m = new THREE.MeshToonMaterial({ map: t, vertexColors: true, gradientMap: toon().gradientMap });
    addToon(m);
    // con la fuente de la UI cargada, se redibuja (sin peticiones nuevas: la carga la propia UI)
    try {
      if (document.fonts && document.fonts.load) document.fonts.load('italic 900 100px "Barlow Condensed"').then(function () { paintAtlas(cv, tc, num, L, beach); t.needsUpdate = true; }).catch(function () { });
    } catch (e) { }
    return m;
  }

  // =====================================================================
  //  ESTILO CARTOON (sprint cartoon, 9-nov-2026)
  // =====================================================================
  // VB.TOON (CONTRATO DEL SPRINT): { gradientMap: DataTexture de 3 pasos, ink: 0x1d1530, outline(mesh, m) }. Lo crea arena;
  // si aún no existe cuando se construye el primer atleta, players crea uno compatible y lo publica (VB.TOON.own = 'players').
  // Los atletas usan SIEMPRE su propio contorno con piel (outlineMesh): un casco genérico no seguiría a los huesos.
  var INK = 0x1d1530, TOON_OWN = null, QRANK = 2;
  // grosor del contorno: ~OUT_PX px a 720 de alto (proporcional al alto de la imagen: igual a 1280×720 y a 844×390),
  // limitado en metros (los del fondo no se vuelven manchas; en primer plano no pasa de un trazo fino)
  // TAJO: trazo más grueso (3,2 px) y de COLOR (la tinta del atleta = oscuro del equipo mezclado con INK: inkHex)
  var OUT_PX = 3.2, OUT_MAX = 0.05, OUT_MIN = 0.0025;
  function inkHex(tc) { return mixHex(tc.dark, INK, 0.35); }
  function toonGradient() {
    // 3 pasos (sombra, medio tono, luz): RGBA de 3 texeles, filtro NEAREST (bandas duras), sin mipmaps
    var v = [64, 158, 255], d = new Uint8Array(12);
    for (var i = 0; i < 3; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v[i]; d[i * 4 + 3] = 255; }
    var t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  function toon() {
    var T = VB.TOON;
    if (T && T.gradientMap) return T;
    if (!TOON_OWN) TOON_OWN = { gradientMap: toonGradient(), ink: INK, outline: function (mesh, th) { return outlineMesh(mesh, th); }, own: 'players' };
    if (!VB.TOON) VB.TOON = TOON_OWN;
    return TOON_OWN;
  }
  /** Sombreado toon de los atletas (onBeforeCompile; mismo programa para los 4: customProgramCacheKey):
   *  - luz directa en bandas (gradientMap) y luz ambiente teñida de azul violáceo (sombras de color, no negras);
   *    la piel tiñe su sombra hacia un tono cálido (se lee también la piel oscura);
   *  - contraluz en banda dura (brillo de borde de dibujo animado) y ojos con algo de luz propia.
   *  La piel se reconoce por su v del atlas (SKIN_UV_V, zona blanca) y la lámina de la cara por su franja (FACE_*), que cuenta como piel. */
  var SHADE = [0.1, 0.075, 0.2], SHADE_SKIN = [0.17, 0.08, 0.1];
  // Solo la luz principal (la más fuerte) va en bandas; relleno y contraluz (débiles) suman un Lambert suave a medias: con
  // todas en bandas la cara se llenaba de manchas (cada luz añade su escalón). Mezcla suave por intensidad (sin saltos en la penumbra).
  var TOON_CHUNK = null;
  function toonLightsChunk() {
    if (TOON_CHUNK) return TOON_CHUNK;
    var src = THREE.ShaderChunk.lights_toon_pars_fragment, a = 'vec3 irradiance = getGradientIrradiance( geometry.normal, directLight.direction ) * directLight.color;';
    if (src.indexOf(a) < 0) return (TOON_CHUNK = src);
    return (TOON_CHUNK = src.replace(a, 'float vbL = dot( directLight.color, vec3( 0.2126, 0.7152, 0.0722 ) );\n' +
      '\tvec3 vbB = getGradientIrradiance( geometry.normal, directLight.direction );\n' +
      '\tvec3 vbS = vec3( 0.6 * saturate( dot( geometry.normal, directLight.direction ) ) );\n' +
      '\tvec3 irradiance = mix( vbS, vbB, smoothstep( 1.2, 2.4, vbL ) ) * directLight.color;'));
  }
  function addToon(mat) {
    var rim = new THREE.Color(0xfff1e0).multiplyScalar(0.13);
    // TAJO: desplazamiento de UV de la celda de ojos / boca (hoja de caras); por material (= por atleta), sin programa nuevo
    var eyeOff = mat.userData.eyeOff = new THREE.Vector2(), mouthOff = mat.userData.mouthOff = new THREE.Vector2();
    // franjas de v de las láminas de la cara (celda 0), con margen
    var fe0 = (1 - (FE_Y + FE_H) / 512 - 0.006).toFixed(4), fe1 = (1 - FE_Y / 512 + 0.006).toFixed(4);
    var fm0 = (1 - (FM_Y + FM_H) / 512 - 0.006).toFixed(4), fm1 = (1 - FM_Y / 512 + 0.006).toFixed(4);
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uRim = { value: rim };
      sh.uniforms.uShade = { value: new THREE.Vector3(SHADE[0], SHADE[1], SHADE[2]) };
      sh.uniforms.uShadeSkin = { value: new THREE.Vector3(SHADE_SKIN[0], SHADE_SKIN[1], SHADE_SKIN[2]) };
      sh.uniforms.uEyeOff = { value: eyeOff }; sh.uniforms.uMouthOff = { value: mouthOff };
      sh.fragmentShader = 'uniform vec3 uRim;\nuniform vec3 uShade;\nuniform vec3 uShadeSkin;\nuniform vec2 uEyeOff;\nuniform vec2 uMouthOff;\nfloat vbSkin = 0.0;\nfloat vbFace = 0.0;\n' + sh.fragmentShader
        .replace('#include <lights_toon_pars_fragment>', toonLightsChunk())
        .replace('#include <map_fragment>', '#ifdef USE_UV\n  vec2 vbUv = vUv;\n' +
          '  float vbFE = step( ' + fe0 + ', vUv.y ) * step( vUv.y, ' + fe1 + ' );\n' +
          '  float vbFM = step( ' + fm0 + ', vUv.y ) * step( vUv.y, ' + fm1 + ' );\n' +
          '  vbFace = max( vbFE, vbFM );\n  vbUv += uEyeOff * vbFE + uMouthOff * vbFM;\n#endif\n' +
          THREE.ShaderChunk.map_fragment.replace(/vUv/g, 'vbUv'))
        .replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_UV\n  vbSkin = max( vbFace, 1.0 - step( 0.03, abs( vUv.y - ' + SKIN_UV_V.toFixed(2) + ' ) ) );\n#endif')
        .replace('#include <output_fragment>',
          'outgoingLight += diffuseColor.rgb * mix( uShade, uShadeSkin, vbSkin );\n' +
          'float vbRim = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );\n' +
          'outgoingLight += uRim * smoothstep( 0.74, 0.79, vbRim ) * mix( vec3( 1.0 ), vec3( 1.3, 1.08, 0.86 ), vbSkin );\n' +
          // TAJO: blanco de los ojos (y dientes) de la cara dibujada con algo de luz propia: no se tiñe de violeta en la sombra
          'outgoingLight += diffuseColor.rgb * 0.45 * vbFace * smoothstep( 0.72, 0.92, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );\n' +
          '#include <output_fragment>');
    };
    mat.customProgramCacheKey = function () { return 'vbToonSkin'; };
  }

  /** Contorno de tinta por casco invertido: la misma geometría dibujada por detrás y empujada por la normal en el
   *  espacio de la vista (después de la piel), con un grosor en píxeles proporcional al alto de la imagen y limitado en
   *  metros. Atributo opcional `ow` por vértice (0..1): las piezas pequeñas de la cara y los ribetes no llevan contorno. */
  var INK_MATS = {};
  var INK_VS = [
    '#include <common>', '#include <skinning_pars_vertex>', '#include <fog_pars_vertex>',
    'uniform float uPx; uniform float uMaxW; uniform float uMinW;',
    '#ifdef VB_OW', 'attribute float ow;', '#endif',
    'void main() {',
    '  #include <beginnormal_vertex>', '  #include <skinbase_vertex>', '  #include <skinnormal_vertex>',
    '  #include <begin_vertex>', '  #include <skinning_vertex>',
    '  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );',
    '  vec3 vbN = normalize( normalMatrix * objectNormal );',
    '  float vbW = clamp( -mvPosition.z * uPx * 2.0 / ( 720.0 * projectionMatrix[ 1 ][ 1 ] ), uMinW, uMaxW );',
    '  #ifdef VB_OW', '  vbW *= ow;', '  #endif',
    '  mvPosition.xyz += vbN * vbW;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>', '}'].join('\n');
  var INK_FS = [
    'uniform vec3 uInk;', '#include <common>', '#include <fog_pars_fragment>',
    'void main() {', '  gl_FragColor = vec4( uInk, 1.0 );',
    '  #include <tonemapping_fragment>', '  #include <encodings_fragment>', '  #include <fog_fragment>', '}'].join('\n');
  function inkMaterial(maxW, perVertex) {
    var key = maxW.toFixed(4) + (perVertex ? 'w' : '');
    if (INK_MATS[key]) return INK_MATS[key];
    var u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uInk: { value: null }, uPx: { value: OUT_PX }, uMaxW: { value: maxW }, uMinW: { value: Math.min(OUT_MIN, maxW * 0.5) } }]);
    var T = toon();
    u.uInk.value = new THREE.Color(T.ink != null ? T.ink : INK);
    var m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: INK_VS, fragmentShader: INK_FS, side: THREE.BackSide, fog: true });
    if (perVertex) m.defines = { VB_OW: 1 };
    m.name = 'vbInk';
    return (INK_MATS[key] = m);
  }
  /** Malla de contorno para `mesh` (Mesh o SkinnedMesh; comparte geometría y esqueleto), hija de su mismo padre.
   *  null en calidad baja. Es la implementación de VB.TOON.outline cuando la publica players. */
  function outlineMesh(mesh, th) {
    if (!mesh || !mesh.geometry || QRANK === 0 || mesh.isInstancedMesh) return null;
    var mat = inkMaterial(th > 0 ? th : OUT_MAX, !!mesh.geometry.attributes.ow), o;
    if (mesh.isSkinnedMesh) { o = new THREE.SkinnedMesh(mesh.geometry, mat); o.bind(mesh.skeleton, mesh.bindMatrix); }
    else o = new THREE.Mesh(mesh.geometry, mat);
    o.name = (mesh.name || 'mesh') + 'Ink'; o.castShadow = false; o.receiveShadow = false;
    o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
    o.frustumCulled = mesh.frustumCulled; o.renderOrder = mesh.renderOrder;
    if (mesh.parent) mesh.parent.add(o);
    return o;
  }
  /** Contorno del atleta (1 dibujo más por atleta en media/alta; ninguno en baja). */
  // INTEGRACIÓN (sprint cartoon): con el VB.TOON de arena, el contorno de los atletas es el MISMO que el del pabellón
  // (VB.TOON.outline con tope en metros, grosor ×OUT_PX/px de arena y el peso `ow` por vértice); outlineMesh queda de
  // respaldo si arena no ha publicado VB.TOON. La calidad la gobiernan VB.TOON.setQuality y setQuality de abajo.
  function ensureInk(r) {
    if (r.ink || QRANK === 0 || !r.skin) return;
    var T = VB.TOON;
    if (T && T.outline && T.own !== 'players' && T.px) {
      r.ink = T.outline(r.skin, OUT_MIN, { max: OUT_MAX, k: OUT_PX / T.px });
      if (r.ink) { r.ink.name = (r.skin.name || 'athlete') + 'Ink'; r.ink.visible = QRANK > 0; r.ink.material = tintInk(r.ink.material, inkHex(r.tc)); }
      return;
    }
    r.ink = outlineMesh(r.skin, OUT_MAX);
    if (r.ink) { r.ink.material = r.ink.material.clone(); r.ink.material.uniforms.uInk.value = new THREE.Color(inkHex(r.tc)); }
  }
  /** TAJO: tinta de color sin tocar arena.js: copia del material de tinta de VB.TOON que reutiliza su onBeforeCompile (mismo
   *  programa: mismos defines y customProgramCacheKey) y solo cambia el uniforme uInk. Uno por color (= por equipación). */
  var TINT_MATS = {};
  function tintInk(base, hex) {
    if (!base || !base.onBeforeCompile) return base;
    var key = base.uuid + ':' + hex; if (TINT_MATS[key]) return TINT_MATS[key];
    var m = new THREE.MeshBasicMaterial({ color: hex, side: base.side });
    if (base.defines) m.defines = Object.assign({}, base.defines);
    var col = new THREE.Color(hex);
    m.onBeforeCompile = function (sh, rn) { base.onBeforeCompile(sh, rn); sh.uniforms.uInk = { value: col }; };
    m.customProgramCacheKey = base.customProgramCacheKey;
    m.name = 'vbInkTint';
    return (TINT_MATS[key] = m);
  }

  // ---------- Piezas ----------
  // CABEZA (PLY-17): UNA superficie continua (cráneo + mandíbula + mentón + arco de las cejas) deformando una esfera con
  // normales analíticas (sin costuras ni el "hocico" de dos esferas). Espacio del hueso de la cabeza: +Z delante, +X izquierda.
  // TAJO: cara redonda de mofletes (más ancha, mandíbula menos estrecha, mentón suave) y sin cuencas ni arco de las cejas:
  // los ojos van dibujados en la lámina de la cara (faceGeo), que necesita una superficie lisa
  var HEAD_C = 0.098, HEAD_RX = 0.108, HEAD_RY = 0.12, HEAD_RZ = 0.106;
  function headShape(x, y, z, o) {
    var lo = y < 0 ? -y : 0, fr = z > 0 ? z : 0;
    var X = x * HEAD_RX * (1 - 0.22 * lo * lo) * (1 + 0.05 * Math.exp(-((y + 0.2) * (y + 0.2)) / 0.04) * fr);    // mandíbula ancha, mofletes
    var Y = y * HEAD_RY;
    var Z = z * HEAD_RZ * (z < 0 ? (1.07 - 0.2 * lo * lo) : 1);                                            // occipucio; nuca recogida
    Z += 0.016 * lo * fr * fr;                                                                              // mentón suave
    Z -= 0.006 * fr * fr * fr * (y > 0.35 ? (y - 0.35) / 0.65 : 0);                                         // frente algo plana
    o.x = X; o.y = HEAD_C + Y; o.z = Z + 0.004; return o;
  }
  /** Esfera deformada por headShape con normales calculadas sobre la forma (continuas también en la costura de la UV). */
  var HS_A = null;
  function headSphere(w, h, inf, ps, pl, ts, tl) {
    if (!HS_A) HS_A = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    var geo = new THREE.SphereGeometry(1, w, h, ps || 0, pl == null ? PI * 2 : pl, ts || 0, tl == null ? PI : tl), P = geo.attributes.position, N = geo.attributes.normal, d = HS_A[0], t1 = HS_A[1], t2 = HS_A[2], p0 = HS_A[3], p1 = HS_A[4], p2 = HS_A[5], q = HS_A[6], e = 0.002;
    for (var i = 0; i < P.count; i++) {
      d.fromBufferAttribute(P, i).normalize();
      t1.set(0, 1, 0); if (Math.abs(d.y) > 0.95) t1.set(1, 0, 0);
      t1.cross(d).normalize(); t2.crossVectors(d, t1).normalize();
      headShape(d.x, d.y, d.z, p0);
      q.copy(d).addScaledVector(t1, e).normalize(); headShape(q.x, q.y, q.z, p1);
      q.copy(d).addScaledVector(t2, e).normalize(); headShape(q.x, q.y, q.z, p2);
      p1.sub(p0); p2.sub(p0); q.crossVectors(p1, p2).normalize();
      if (q.dot(d) < 0) q.multiplyScalar(-1);
      if (inf) { p0.y -= HEAD_C; p0.multiplyScalar(inf); p0.y += HEAD_C; }
      P.setXYZ(i, p0.x, p0.y, p0.z); N.setXYZ(i, q.x, q.y, q.z);
    }
    return geo;
  }
  /** Z de la superficie delantera de la cabeza en (x, y) del hueso (búsqueda sobre la dirección: una vez por malla). */
  function headFrontZ(x, y) {
    var dx = x / HEAD_RX, dy = (y - HEAD_C) / HEAD_RY, o = { x: 0, y: 0, z: 0 };
    for (var it = 0; it < 30; it++) {
      var dz = Math.sqrt(Math.max(0.02, 1 - dx * dx - dy * dy));
      headShape(dx, dy, dz, o);
      dx += (x - o.x) / HEAD_RX * 0.8; dy += (y - o.y) / HEAD_RY * 0.8;
    }
    return o.z;
  }
  /** TAJO: mechón liso en lágrima (lathe, punta en +Y, largo len, radio r): nada de facetas. */
  function tuft(len, r, seg) {
    return lathe([V2(0, 0), V2(r * 0.8, len * 0.08), V2(r, len * 0.3), V2(r * 0.72, len * 0.62), V2(r * 0.3, len * 0.9), V2(0, len)], seg || 10, 6);
  }
  // acc (playa): 'visor' visera de acento | 'gorra' gorra hacia atrás | '' nada. Sin gafas de sol nunca.
  function headGeo(g, L, tc, acc, beach) {
    var sk = L.skin, hr = L.hair, s, i;
    g.add(headSphere(sg(24, 14), sg(16, 10)), sk);                                  // cráneo + cara (una pieza; la cara va en la lámina)
    // nariz: un botón redondo (en la playa, con la raya de zinc neón)
    g.owk = 0.25;
    g.add(sph(0.0125, 10, 7), beach ? zincHex(tc) : sk, 0, 0.088, headFrontZ(0, 0.088) - 0.0035, 0, 0, 0, 1.05, 0.95, 0.75);
    g.owk = 0.5; for (s = -1; s <= 1; s += 2) g.add(sph(0.0324, 8, 6), sk, s * 0.106, 0.092, -0.004, 0, 0, 0, 0.45, 1, 0.75); // orejas (+20 %)
    g.owk = 1;
    var cap = function (col, rot, sc) { g.add(new THREE.SphereGeometry(0.119, sg(22, 14), sg(12, 6), 0, PI * 2, 0, PI * 0.5), col, 0, 0.105, -0.006, rot, 0, 0, 0.96 * (sc || 1), 1.06 * (sc || 1), 1.04 * (sc || 1)); };
    var gorra = acc === 'gorra';
    // peinados de mechones grandes y lisos (con gorra solo el casquete: los mechones la atravesarían)
    switch (gorra ? '' : L.style) {
      case 'puff2':      // dos moños afro redondos a los lados, en lo alto
        cap(hr, -0.28);
        for (s = -1; s <= 1; s += 2) g.add(sph(0.07, 14, 10), hr, s * 0.085, 0.2, -0.012, 0, 0, 0, 1, 0.96, 1);
        break;
      case 'coleta':     // coleta alta (la cola va en el hueso del pelo, faceGeo) con la ÚNICA cinta del equipo
        cap(hr, -0.3);
        g.owk = 0; g.add(torus(0.109, 0.013, 6, 28), tc.band, 0, 0.142, -0.004, PI / 2 - 0.22, 0, 0, 0.96, 1.04, 1);
        break;
      case 'cresta':     // casquete rapado + 5 aletas en fila de delante atrás
        cap(hr, -0.18, 0.99);
        var fa = [0.55, 0.2, -0.15, -0.5, -0.85], fl = [0.06, 0.075, 0.08, 0.07, 0.055];
        for (i = 0; i < 5; i++) g.add(tuft(fl[i], 0.03, 8), hr, 0, 0.098 + 0.118 * Math.cos(fa[i]), -0.006 + 0.118 * Math.sin(fa[i]), fa[i] + 0.25, 0, 0, 0.42, 1, 1);
        break;
      case 'flequillo':  // flequillo grande que tapa media frente (ladeado)
        cap(hr, -0.3);
        g.add(sph(0.07, 14, 9), hr, 0.022, 0.172, 0.07, 0.35, 0, -0.25, 1.35, 0.55, 0.8);
        break;
      case 'rapado':     // casquete muy corto con raya lateral (surco de piel)
        cap(hr, -0.18, 0.99);
        g.owk = 0; g.add(sph(1, 10, 4), sk, 0.045, 0.205, 0.02, 0, 0, 0.5, 0.004, 0.003, 0.05);
        break;
      case 'trenzas':    // dos trenzas cortas por detrás de las orejas
        cap(hr, -0.3);
        var bp = []; for (i = 0; i <= 8; i++) bp.push(V2(i === 0 || i === 8 ? 0 : (i % 2 ? 0.022 : 0.015) * (1 - i * 0.05), -i * 0.02));
        for (s = -1; s <= 1; s += 2) g.add(lathe(bp, 8, 6), hr, s * 0.08, 0.1, -0.075, 0.35, 0, s * 0.18);
        break;
      case 'tupe':       // tupé: casquete + un mechón ancho que sale hacia delante y arriba (y otro detrás, más bajo)
        cap(hr, -0.32);
        g.add(tuft(0.12, 0.046), hr, 0.008, 0.19, 0.0, 0.85, 0, -0.12, 1.75, 1, 0.62);
        g.add(tuft(0.09, 0.04), hr, -0.01, 0.2, -0.045, 0.3, 0, 0.1, 1.6, 1, 0.6);
        break;
      default:
        cap(hr, gorra ? -0.18 : -0.32, gorra ? 0.99 : 1);
    }
    g.owk = 1;
    if (acc === 'visor') {
      // visera: media corona (banda abierta) + ala, color de acento con filo oscuro
      g.add(new THREE.CylinderGeometry(0.107, 0.113, 0.03, sg(20, 10), 1, true, -PI * 0.62, PI * 1.24), tc.accent, 0, 0.158, -0.008, -0.32, 0, 0, 1, 1, 1.02);
      g.add(sph(1, 14, 4, 0, PI * 2, 0, PI * 0.5), tc.accent, 0, 0.158, 0.112, -0.38, 0, 0, 0.082, 0.011, 0.058);
      g.owk = 0; g.add(sph(1, 14, 3, 0, PI * 2, PI * 0.5, PI * 0.5), tc.dark, 0, 0.157, 0.112, -0.38, 0, 0, 0.08, 0.006, 0.056); g.owk = 1;
    } else if (gorra) {
      // gorra hacia atrás: copa (casquete) + ala por detrás + botón; la frente queda libre (se ven las cejas)
      g.add(new THREE.SphereGeometry(0.125, sg(18, 12), sg(9, 5), 0, PI * 2, 0, PI * 0.5), tc.accent, 0, 0.116, -0.012, -0.36, 0, 0, 0.98, 1.0, 1.04);
      // ala más larga y OSCURA (dos tonos: de detrás y a media distancia se leía como un casco o pelo rubio) y la tira del
      // cierre cruzando la frente, como una gorra hacia atrás de verdad
      g.add(sph(1, 14, 4, 0, PI * 2, 0, PI * 0.5), tc.dark, 0, 0.11, -0.152, 0.26, 0, 0, 0.088, 0.013, 0.088);
      g.owk = 0;
      g.add(new THREE.CylinderGeometry(0.1265, 0.1275, 0.017, 8, 1, true, -PI * 0.2, PI * 0.4), tc.dark, 0, 0.13, -0.012, -0.36, 0, 0, 0.98, 1, 1.04);
      g.add(sph(0.014, 6, 4), tc.dark, 0, 0.238, -0.05); g.owk = 1;
    }
  }
  // Huesos de la cara (espacio del hueso de la cabeza): ojos, boca, dientes, cejas (TAJO: vacíos, la cara va dibujada) y pelo (muelle)
  var EYE_Y = 0.112, EYE_X = 0.036, MOUTH_Y = 0.05, BROW_Y = 0.142, BROW_X = 0.038, HAIR_P = [0, 0.19, -0.1];
  /** TAJO: lámina de la cara pegada al cráneo (rejilla nx × ny sobre headShape en dirección dx ∈ [-dxM, dxM], dy ∈ [dy0, dy1]),
   *  F_OFF por fuera con la normal de la cabeza; UV en la celda 0 de su hoja (x0, y0, w, h en píxeles del atlas). */
  var F_OFF = 0.0016;
  function faceSheet(nx, ny, dxM, dy0, dy1, x0, y0, w, h) {
    var geo = new THREE.BufferGeometry(), pos = [], nrm = [], uv = [], idx = [], i, j;
    var d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), q = new THREE.Vector3(), p0 = {}, p1 = {}, p2 = {}, e = 0.002;
    var P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3();
    for (j = 0; j <= ny; j++) for (i = 0; i <= nx; i++) {
      var dx = -dxM + 2 * dxM * i / nx, dy = dy0 + (dy1 - dy0) * j / ny;
      d.set(dx, dy, Math.sqrt(Math.max(0.02, 1 - dx * dx - dy * dy))).normalize();
      t1.set(0, 1, 0).cross(d).normalize(); t2.crossVectors(d, t1).normalize();
      headShape(d.x, d.y, d.z, p0); P0.set(p0.x, p0.y, p0.z);
      q.copy(d).addScaledVector(t1, e).normalize(); headShape(q.x, q.y, q.z, p1); P1.set(p1.x, p1.y, p1.z).sub(P0);
      q.copy(d).addScaledVector(t2, e).normalize(); headShape(q.x, q.y, q.z, p2); P2.set(p2.x, p2.y, p2.z).sub(P0);
      q.crossVectors(P1, P2).normalize(); if (q.dot(d) < 0) q.multiplyScalar(-1);
      P0.addScaledVector(q, F_OFF);
      pos.push(P0.x, P0.y, P0.z); nrm.push(q.x, q.y, q.z);
      // u con X (el lado izquierdo del atleta, +X, a la derecha de la celda) y v con Y (flipY del lienzo)
      uv.push((x0 + F_PAD + (w - 2 * F_PAD) * i / nx) / 512, 1 - (y0 + F_PAD + (h - 2 * F_PAD) * (1 - j / ny)) / 512);
    }
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, dd = c + 1;
      idx.push(a, b, dd, a, dd, c);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }
  /** TAJO: la cara (ojos, cejas, sello y boca) es una lámina con la hoja de caras del atlas (paintFace); sustituye a los rasgos
   *  3D (esclerótica, iris, brillo, párpado, boca, labio, dientes y cejas, ~900 triángulos). Los huesos eyes/mouth/teeth/brow
   *  quedan vacíos (CONTRACT: siguen existiendo). La expresión la eligen los uniformes del material (updateFace). */
  function faceGeo(r, on, L) {
    var g = on(r.head); g.owk = 0; g.ownUv = true;   // sin contorno; UV propia
    var nxE = Math.max(6, Math.round(10 * LODK + 0.5)), nyE = Math.max(4, Math.round(6 * LODK + 0.5));
    g.add(faceSheet(nxE, nyE, FE_DX, FE_DY0, FE_DY1, 0, FE_Y, FE_W, FE_H), 0xffffff);
    g.add(faceSheet(Math.max(4, nxE - 2), 3, FM_DX, FM_DY0, FM_DY1, 0, FM_Y, FM_W, FM_H), 0xffffff);
    g.ownUv = false; g.owk = 1;
    if (L.style === 'coleta' && r.acc !== 'gorra') {
      // coleta alta (PLY-19): goma + mechón largo que se estrecha, en el hueso del pelo (muelle amortiguado)
      var gH = on(r.hair), hr = L.hair;
      gH.owk = 1; gH.add(sph(0.036, 12, 8), hr, 0, 0.0, 0.0, 0, 0, 0, 1, 0.9, 1.1);                                       // nudo
      gH.owk = 0; gH.add(torus(0.023, 0.008, 5, 10), r.tc.band, 0, -0.014, -0.022, -1.02, 0, 0);                            // goma
      gH.owk = 1; gH.add(lathe([V2(0, 0.0), V2(0.028, -0.014), V2(0.034, -0.055), V2(0.03, -0.11), V2(0.02, -0.16), V2(0.008, -0.2), V2(0, -0.21)], 10, 6), hr, 0, -0.016, -0.03, 0.55, 0, 0, 1, 1, 0.8); // mechón
    }
    g.owk = 1;
  }
  // TAJO: cuello corto y ancho (la cabeza grande no parece una jirafa)
  function neckGeo(g, L, tc, beach) {
    g.add(cyl(0.058, 0.064, 0.12, 14), L.skin, 0, 0.3, 0.0);
    g.owk = 0; g.add(torus(0.064, 0.012, 6, 20), beach ? tc.accent : tc.trim, 0, 0.29, 0.005, PI / 2 + 0.25, 0, 0, 1.15, 1, 1); // ribete del cuello
    g.owk = 1;
  }
  function upperGeo(g, L, tc, s, beach) {
    g.add(lathe(limbPts(UPPER, 0.065, 0.05, 0.38, 0.01, 7), 14), L.skin);
    if (beach) {   // playa: camiseta de tirantes, hombro de piel
      g.add(new THREE.SphereGeometry(0.072, sg(14, 10), sg(10, 7)), L.skin, 0, -0.008, 0, 0, 0, 0, 1, 0.92, 1);
      return;
    }
    // manga por fuera del brazo (perfil <= 0,069 m con el bíceps; antes 0,066 abajo: la piel asomaba entre manga y ribete)
    g.add(cyl(0.079, 0.0712, 0.14, 14, true), tc.base, 0, -0.06, 0);                // manga corta que se estrecha (PLY-21)
    g.add(new THREE.SphereGeometry(0.087, sg(14, 10), sg(10, 7)), tc.base, 0, -0.008, 0, 0, 0, 0, 1, 0.88, 1);          // hombro redondo (TAJO ×1,15)
    g.owk = 0; g.add(cyl(0.0722, 0.0718, 0.016, 14, true), tc.accent, 0, -0.123, 0);           // ribete de manga
    if (s > 0) {   // TAJO: chapa redonda del equipo en la manga izquierda (en vez de muñequeras)
      g.add(cyl(0.025, 0.025, 0.006, 14), tc.dark, s * 0.0775, -0.062, 0, 0, 0, PI / 2 + 0.07);
      g.add(cyl(0.019, 0.019, 0.004, 14), tc.accent, s * 0.0805, -0.062, 0, 0, 0, PI / 2 + 0.07);
    }
    g.owk = 1;
  }
  function foreGeo(g, L, tc, s) {
    // TAJO: antebrazo que se afina (grueso en el codo, fino en la muñeca); sin muñequeras
    g.add(lathe(limbPts(FORE, 0.052, 0.032, 0.2, 0.011, 8), 12), L.skin, 0, 0, 0, 0, 0, 0, 1, 1, 0.92);
    g.add(sph(0.052, 10, 6), L.skin, 0, 0.004, -0.004, 0, 0, 0, 1.02, 1, 0.98);      // codo: esfera de unión (sin escalón al doblar)
  }
  /** TAJO: manopla de verdad: palma, UNA hoja de dedos fusionados y pulgar (sin dedos sueltos: -600 triángulos por atleta).
   *  Plano de la mano = Y-Z del hueso (grosor en X); pulgar hacia +Z. Se lee a distancia (bloqueo, colocación). */
  function capsule(r, len, cs, rs) { return new THREE.CapsuleGeometry(r, len, Math.max(1, Math.round((cs || 3) * LODK)), sg(rs || 8, 4)); }
  function handGeo(g, L) {
    g.owk = 0.6;
    g.add(capsule(1, 0.9, 3, 10), L.skin, 0, -0.052, 0.002, 0, 0, 0, 0.0185, 0.029, 0.047);   // palma
    g.add(capsule(1, 1.0, 3, 10), L.skin, 0, -0.106, 0.0, 0, 0, 0, 0.0125, 0.021, 0.043);     // dedos (una hoja de punta redonda)
    g.add(capsule(1, 2.0, 2, 8), L.skin, 0.007, -0.058, 0.058, -0.55, 0, 0, 0.0145, 0.0145, 0.016); // pulgar (algo abierto)
    g.owk = 1;
  }
  function thighGeo(g, L, tc, beach) {
    g.add(lathe(limbPts(THIGH, 0.09, 0.062, 0.25, 0.012, 8), 14), L.skin);
    // piezas superpuestas con los MISMOS lados que la extremidad (14 → mismo LOD y misma fase de vértices) y holgura
    // >= 4 mm: con lados distintos los vértices de la piel asomaban entre las caras planas (dientes de sierra en media)
    if (beach) {   // playa: malla corta ceñida del color de la camiseta
      g.add(cyl(0.103, 0.1015, 0.13, 14, true), tc.base, 0, -0.035, 0);
      g.owk = 0; g.add(cyl(0.1035, 0.1035, 0.014, 14, true), tc.accent, 0, -0.095, 0);
      g.owk = 1; return;
    }
    g.add(cyl(0.103, 0.1015, 0.22, 14, true), tc.shorts, 0, -0.08, 0);              // pernera (muslo <= 0,097)
    g.owk = 0; g.add(cyl(0.1035, 0.1035, 0.016, 14, true), tc.accent, 0, -0.184, 0);          // ribete
    g.owk = 1;
  }
  function kneeW(y) { return sstep(-0.04, 0.035, y) * 0.5; }
  function shinGeo(g, L, tc, thighBone, beach) {
    // TAJO: espinilla que se afina (gruesa en la rodilla, fina en el tobillo)
    g.add(lathe(limbPts(SHIN, 0.066, 0.033, 0.28, 0.013, 8), 14), L.skin);
    if (beach) return;   // playa: descalzos, sin rodilleras ni calcetines
    // mismos lados que la pierna (14) y holgura sobre su perfil: sin dientes de sierra
    // rodillera elástica: la mitad de arriba sigue al muslo (piel a dos huesos), así al doblar la rodilla la cubre
    // en vez de dejar asomar el muslo por delante (borde dentado). TAJO: «pastilla» redonda del oscuro del equipo
    if (thighBone >= 0) { g.bone2 = thighBone; g.w2 = kneeW; }
    g.add(cyl(0.084, 0.083, 0.12, 14), tc.dark, 0, -0.025, 0.004);                   // rodillera
    g.add(sph(0.05, 12, 8), tc.dark, 0, -0.022, 0.062, 0, 0, 0, 1.1, 1.05, 0.55);     // pastilla delantera
    g.bone2 = -1; g.w2 = null;
    g.owk = 0;   // calcetín y franja pegados a la pierna: sin contorno propio (el de la pierna ya los perfila)
    g.add(cyl(0.051, 0.038, 0.16, 14, true), tc.accent, 0, -SHIN + 0.08, 0);         // calcetín (del acento, no blanco)
    g.add(cyl(0.0505, 0.05, 0.02, 14, true), tc.base, 0, -SHIN + 0.13, 0);          // franja del calcetín
    g.owk = 1;
  }
  // TAJO: zapatillas exageradas (×1,4 de largo y ancho, suela 1,5× más alta y del acento, punta redonda); la planta sigue en el
  // mismo plano (-0,082): la locomoción y footLock no cambian
  var FOOT_K = 1.4;
  function shoeGeo(g, tc) {
    var K = FOOT_K, Y = -0.042;
    g.add(sph(1, 16, 8, 0, PI * 2, 0, PI * 0.5), 0xf4f4f4, 0, Y, 0.04 * K, 0, 0, 0, 0.055 * K, 0.07, 0.13 * K);  // empeine
    g.add(cyl(0.046, 0.05, 0.06, 12), 0xf4f4f4, 0, -0.02, -0.01);                   // tobillera
    g.add(sph(1, 16, 5, 0, PI * 2, PI * 0.5, PI * 0.5), tc.sole, 0, Y, 0.04 * K, 0, 0, 0, 0.058 * K, 0.04, 0.134 * K); // suela
    g.owk = 0.5; g.add(sph(1, 14, 6, 0, PI * 2, 0, PI * 0.5), tc.accent, 0, Y + 0.006, -0.025 * K, 0, 0, 0, 0.0565 * K, 0.034, 0.06 * K);  // talón
    g.owk = 0; g.add(box(0.03 * K, 0.006, 0.06 * K), 0x30333a, 0, 0.014, 0.09 * K, -0.5, 0, 0);               // cordones
    g.owk = 1;
  }
  /** TAJO (playa): pie descalzo de manopla (×1,3) con el bulto del dedo gordo, planta con arena y tobillera de tela del
   *  acento. La planta queda en el mismo plano que la suela de la zapatilla. s: 1 izquierdo, -1 derecho (el dedo gordo, dentro). */
  var SAND_HEX = 0xe8cf9a;
  function footGeo(g, L, tc, s) {
    var K = 1.3, sk = L.skin, Y = -0.058;
    g.add(sph(0.042, 12, 8), sk, 0, -0.035, -0.008, 0, 0, 0, 1, 1.1, 1.1);                                   // tobillo y talón
    g.add(sph(1, 14, 7, 0, PI * 2, 0, PI * 0.5), sk, 0, Y, 0.035 * K, 0, 0, 0, 0.046 * K, 0.05, 0.1 * K);       // empeine
    g.add(sph(1, 14, 4, 0, PI * 2, PI * 0.5, PI * 0.5), mixHex(sk, SAND_HEX, 0.35), 0, Y, 0.035 * K, 0, 0, 0, 0.047 * K, 0.024, 0.101 * K); // planta con arena
    g.owk = 0.5; g.add(sph(0.021, 8, 6), sk, -s * 0.026, Y + 0.004, 0.035 * K + 0.088 * K, 0, 0, 0, 1, 0.85, 1.1); // dedo gordo
    g.owk = 0; g.add(torus(0.037, 0.0075, 5, 14), tc.accent, 0, -0.006, -0.004, PI / 2, 0, 0);                    // tobillera de tela
    g.owk = 1;
  }
  /** Pantalón (pelvis). TAJO: panel lateral del acento a los dos lados (el tajo que baja de la camiseta). Playa: del color de la camiseta. */
  function shortsGeo(g, tc, beach) {
    g.add(lathe(profPts(SHORTS_PROF), 22, 16), beach ? tc.base : tc.shorts, 0, 0, 0, 0, 0, 0, SHORTS_S[0], SHORTS_S[1], SHORTS_S[2]);
    var pp = profPts(SHORTS_PROF).slice(1, -1);
    g.owk = 0;
    for (var s = -1; s <= 1; s += 2) g.add(new THREE.LatheGeometry(pp, sg(4, 3), s * PI / 2 - 0.2, 0.4), tc.accent, 0, 0, 0, 0, 0, 0, SHORTS_S[0] * 1.012, SHORTS_S[1] * 1.002, SHORTS_S[2] * 1.03);
    g.owk = 1;
  }
  /** Camiseta (abdomen en el hueso spine, pecho en chest): toma la textura del atlas. */
  function absGeo(g) { g.jersey = true; g.add(lathe(profPts(ABS_PROF), 24, 16), null, 0, 0, 0, 0, 0, 0, ABS_S[0], ABS_S[1], ABS_S[2]); g.jersey = false; }
  function chestGeo(g) { g.jersey = true; g.add(lathe(profPts(CHEST_PROF), 28, 18), null, 0, 0, 0, 0, 0, 0, CHEST_S[0], CHEST_S[1], CHEST_S[2]); g.jersey = false; }

  // =====================================================================
  //  POSE (estructura plana para mezclar capas)
  // =====================================================================
  // escalares
  var DROP = 0, PP = 1, PR = 2, PY = 3, CP = 4, CY = 5, CR = 6, HY = 7, HP = 8, HOP = 9, OX = 10, OZ = 11, PX = 12, PZ = 13,
    FPL = 14, FPR = 15, WRL = 16, WRR = 17, LOOK = 18, FYL = 19, FYR = 20, TWL = 21, TWR = 22, SHR = 23, NS = 24;
  // TWL/TWR: giro de la mano sobre el antebrazo (palma al frente en el bloqueo); SHR: hombros encogidos (0..1)
  // vectores
  var HL = 0, HR = 1, AL = 2, AR = 3, FL = 4, FR = 5, KL = 6, KR = 7, NV = 8;
  // Campos que nacen enteros (Smi) y luego reciben doubles: generalizarlos al crear el objeto (ver dblFields en sim.js:
  // si no, V8 depreca el mapa del rig en mitad del peloteo —primer bloqueo, primera plancha— y desoptimiza todo a la vez).
  function dblFields(o) { for (var k in o) { var v = o[k]; if (typeof v === 'number' && (v | 0) === v) { o[k] = 0.5; o[k] = v; } } return o; }
  function footState() { return dblFields({ n: 0, o0: 0, px: 0, py: 0, st: false, lock: false, skip: false, x: 0, y: 0, yaw: 0, w: 0, cx: 0, cz: 0, ox: 0, oz: 0,
    sl: false, sx: 0, sy: 0, syaw: 0, sst: -1, s0x: 0, s0y: 0, s0yaw: 0, sdur: 0.22, slh: 1, apX: 0, apY: 0, apYaw: 0, apSw: -1, a0x: 0, a0y: 0, a0yaw: 0 }); }
  function Pose() { this.s = new Float32Array(NS); this.v = []; for (var i = 0; i < NV; i++) this.v.push(new THREE.Vector3()); this.ra = 14.5; this.rb = 10.5; this.ra = 14; this.rb = 10; }
  function copyP(dst, src) { dst.s.set(src.s); for (var i = 0; i < NV; i++) dst.v[i].copy(src.v[i]); dst.ra = src.ra; dst.rb = src.rb; }
  function blendP(dst, src, w) {
    if (w <= 0) return; if (w > 1) w = 1;
    for (var i = 0; i < NS; i++) dst.s[i] += (src.s[i] - dst.s[i]) * w;
    for (var j = 0; j < NV; j++) dst.v[j].lerp(src.v[j], w);
    dst.ra = lerp(dst.ra, src.ra, w); dst.rb = lerp(dst.rb, src.rb, w);
  }

  // Temporales (sin asignaciones por frame)
  var T = null, T2 = null, BL, CL, tV, tV2, tV3, mA, mB, mInv, qA, qB, qC, qD, eA, IKx, IKy, IKz, IKm, HC, ZERO3, XAXIS;

  // =====================================================================
  //  CONSTRUCCIÓN DEL RIG
  // =====================================================================
  function buildRig(p) {
    var id = p.id, team = p.team, L = lookOf(p), tc = kitOf(p);
    var root = new THREE.Group(); root.name = 'athlete' + id;
    var bones = [];
    function bone(parent, x, y, z) { var b = new THREE.Bone(); b.position.set(x || 0, y || 0, z || 0); parent.add(b); bones.push(b); return b; }
    var body = bone(root);
    var pelvis = bone(body, 0, HIP_H, 0);
    var spine = bone(pelvis, 0, SPINE_Y, 0);
    var chest = bone(spine, 0, CHEST_Y, 0);
    var head = bone(chest, 0, NECK_Y, 0.012); head.rotation.order = 'YXZ';
    head.scale.setScalar(HEAD_K);   // CARTOON: cabeza más grande (cara, ojos y pelo van en huesos hijos: escalan con ella)
    // cara (PLY-17/18) y pelo (PLY-19): huesos hijos de la cabeza; la escala de los de la cara da las expresiones
    var fz = headFrontZ;
    var eyes = bone(head, 0, EYE_Y, fz(EYE_X, EYE_Y) - 0.004), mouth = bone(head, 0, MOUTH_Y, fz(0, MOUTH_Y) - 0.004);
    var teeth = bone(head, 0, MOUTH_Y, fz(0, MOUTH_Y) - 0.004);
    var browL = bone(head, BROW_X, BROW_Y, fz(BROW_X, BROW_Y)), browR = bone(head, -BROW_X, BROW_Y, fz(BROW_X, BROW_Y));
    var hair = bone(head, HAIR_P[0], HAIR_P[1], HAIR_P[2]);
    var r = {
      p: p, id: id, team: team, num: p.num, root: root, body: body, pelvis: pelvis, spine: spine, chest: chest, head: head,
      eyes: eyes, mouth: mouth, teeth: teeth, brow: [browL, browR], hair: hair,
      fxS: 0, fxE: 0, fxJ: 0, fxD: 0, fxBlink: 0, blinkT: 1 + Math.random() * 3, fxForce: '', fxForceT: 0,
      ritOn: false, ritPh: '', ritU: 0, catchN: -1, callT: -99, callKey: -99, tgtW: 0,
      hsX: 0, hsY: 0, hsZ: 0, hvX: 0, hvY: 0, hvZ: 0, hrX: 0, hrY: 0, hrZ: 0, htX: 0, htY: 0, htZ: 0, hsOn: false, hairAng: 0, swP: 0,
      sh: [], up: [], el: [], hand: [], hip: [], th: [], kn: [], ft: [],
      cur: new Pose(), tgt: new Pose(), inited: false,
      yaw: 0, yawT: 0, phase: 0, vf: 0, vl: 0, clock: Math.random() * 10, headYaw: 0, headPitch: 0,
      // tiempos de eventos (tiempo de juego), -99 = nunca
      hitT: -99, hitKind: '', hitC: new THREE.Vector3(), hitQ: 1,
      jumpT: -99, jumpKind: '', landT: -99, blockT: -99, swingT: -99,
      pointT: -99, pointWin: false, celeb: 0, matchEnd: false, mateHF: false,
      cvW0: 0, cvW1: 0, cvMode: 0, cvRx: 0, cvRy: 0, cvRz: 0, cvLx: 0, cvLy: 0, cvLz: 0,
      lieW: 0, diveTc: 0, pdW: 0, pdT0: -1, pdTp: 0, pdX: 0, pdY: 0, pdZ: 0, pdLive: false,
      diveT: -99, diveYaw: 0, diveDist: 0, diveEnd: 1.0, diveUp: 1, diveDz: 0, ozGiven: 0, upBoost: 0,
      vh: 0, svH: 0, jsH: 0, jsT0: -99, aE: 0, aUp: 0, aw0: 0, aw1: 0, aMode: '', aX: 0, aY: 0, aZ: 0, aDx: 0, aDy: 0, aDz: 0, aLean: 0.25, holdWr: 0, holdTw: 0,
      hitMode: '', hwx: 0, hwy: 0, hwz: 0, hdx: 0, hdy: 0, hdz: 0,
      locoOwn: 0, ownPrev: 0, mPrev: 0, hipYaw: 0, fk: [footState(), footState()],
      offX: 0, offY: 0, ox0: 0, oy0: 0, lpx: 0, lpy: 0, faceKeep: 0, hasFace: false, yawRate: 0, yawV: 0, standW: 0, fex: 0, bkOn: false, celV: '', celId: '', lastCel: '', lastPrev: '', lkW: 0, lkX: 0, lkY: 0, lkZ: 0, apOn: false, apWarp: false, apS: 0, apS0: 0, apW: 0, apT0: -99, apJ: -99, apX0: 0, apY0: 0, ssT: -99, ssLast: -99, ssK: 1, ssAir: false, guard: false, tossT: -99, tossJump: false, hitShot: '', hitGrade: '',
      faceE: 0, faceM: 0, beach: false, acc: ''   // TAJO: celdas de la cara y escenario
    };
    for (var k = 0; k < 2; k++) {
      var s = k === 0 ? 1 : -1;
      var sh = bone(chest, s * SH_X, SH_Y, SH_Z), up = bone(sh), el = bone(up, 0, -UPPER, 0), hd = bone(el, 0, -FORE, 0);
      hd.scale.setScalar(HAND_K);     // CARTOON: manos algo mayores (la muñeca no se mueve: la IK sigue llevando la palma al balón)
      r.sh.push(sh); r.up.push(up); r.el.push(el); r.hand.push(hd);
      var hp = bone(pelvis, s * HIP_W, 0, 0), th = bone(hp), kn = bone(th, 0, -THIGH, 0), ft = bone(kn, 0, -SHIN, 0);
      r.hip.push(hp); r.th.push(th); r.kn.push(kn); r.ft.push(ft);
    }
    // ---- UNA malla con piel rígida por hueso: 1 llamada de dibujo + 1 de sombra por atleta
    root.updateMatrixWorld(true);
    r.bones = bones; r.rest = []; r.geos = [null, null, null]; r.look = L; r.tc = tc;
    // TAJO: escenario de playa (el rig se construye para un escenario: la clave de caché lo incluye, rigFor) y complemento de
    // cabeza alterno: 2v2 por id (A visera, B gorra hacia atrás), 6v6 por dorsal
    r.beach = VEN === 'beach'; r.acc = r.beach ? (((p.role ? p.num : p.id) % 2) ? 'gorra' : 'visor') : '';
    for (k = 0; k < bones.length; k++) r.rest.push(bones[k].matrixWorld.clone()); // pose de reposo (para reconstruir el LOD)
    var skin = new THREE.SkinnedMesh(rigGeometry(r, LODR), atlasMaterial(p.num, tc, L, r.beach));
    skin.castShadow = true; skin.receiveShadow = true; skin.name = 'athleteSkin' + id;
    root.add(skin); root.updateMatrixWorld(true);
    skin.bind(new THREE.Skeleton(bones), skin.matrixWorld);
    r.skin = skin; r.ink = null;
    ensureInk(r);                   // contorno de tinta (media/alta)
    root.scale.setScalar(L.h);
    // alias públicos para cámara/FX (rigOf)
    r.handL = r.hand[0]; r.handR = r.hand[1]; r.footL = r.ft[0]; r.footR = r.ft[1];
    r.scale = L.h;
    dblFields(r);
    return r;
  }

  /** Geometría del atleta para un nivel de detalle (0 baja, 1 media, 2 alta), en la pose de reposo
   *  guardada (r.rest), así que vale para la misma piel aunque los huesos estén ya posados. Se guarda en r.geos. */
  function rigGeometry(r, lod) {
    if (r.geos[lod]) return r.geos[lod];
    var keepK = LODK, keepR = LODR; LODK = LOD_K[lod]; LODR = lod;
    var G = new Geo(), L = r.look, tc = r.tc, k, s;
    function on(b) { var i = r.bones.indexOf(b); G.pre = r.rest[i]; G.bone = i; return G; }
    try {
      var bch = !!r.beach;   // TAJO: versión de playa (tirantes, malla, descalzos, visera/gorra)
      shortsGeo(on(r.pelvis), tc, bch);
      absGeo(on(r.spine));
      chestGeo(on(r.chest)); neckGeo(G, L, tc, bch);
      G.skinHex = L.skin; headGeo(on(r.head), L, tc, r.acc, bch); faceGeo(r, on, L);
      for (k = 0; k < 2; k++) {
        s = k === 0 ? 1 : -1;
        upperGeo(on(r.up[k]), L, tc, s, bch); foreGeo(on(r.el[k]), L, tc, s); handGeo(on(r.hand[k]), L);
        thighGeo(on(r.th[k]), L, tc, bch); shinGeo(on(r.kn[k]), L, tc, r.bones.indexOf(r.th[k]), bch);
        if (bch) footGeo(on(r.ft[k]), L, tc, s); else shoeGeo(on(r.ft[k]), tc);
      }
    } finally { LODK = keepK; LODR = keepR; }
    return (r.geos[lod] = G.build());
  }
  /** Detalle por tamaño en pantalla: un atleta en primer plano (punto, ace, celebración, cámara muy cerca) usa
   *  la malla completa aunque la calidad sea media/baja; el resto, la de la calidad. Con histéresis (no parpadea).
   *  Usa la cámara del frame anterior (la cámara se actualiza después de Players). La geometría alta ya está
   *  preparada desde onGameStart, así que el cambio no construye nada. */
  var LOD_UP = 0.58, LOD_DOWN = 0.5, LODW = null; // peloteo en 3ª persona: el más cercano ocupa <= ~0,55 del alto
  // 6v6 (diseño §1.8, rendimiento con 12 atletas). Solo con g.size > 2; el 2v2 no pasa por aquí.
  //  - LOD por distancia: en calidad media, los atletas lejanos (> FAR_D m de profundidad, o del equipo rival a > FAR_RIV m)
  //    usan la malla baja y sin contorno de tinta (un dibujo menos cada uno). En baja ya van con la malla baja y sin contorno.
  //  - Sombras parciales: en media/baja solo proyectan sombra los SHADOW_N más cercanos a la cámara; el resto se queda con la
  //    mancha de contacto de FX (InstancedMesh, un dibujo para todos).
  var FAR_D = 14, FAR_RIV = 10, FAR_HYS = 1, SHADOW_N = [2, 6], LODA = null;   // sombras: [baja, media]
  function screenLod(g) {
    var cam = ctx && ctx.camera;
    if (!cam || !cam.isPerspectiveCamera) return;
    if (!LODW) LODW = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    var six = !!(g && g.size > 2), myTeam = g && g.ctrl ? g.ctrl.team : 0;
    if (six && (!LODA || LODA.length < rigs.length)) LODA = new Float32Array(Math.max(16, rigs.length));
    var cp = LODW[0], dir = LODW[1]; cp.setFromMatrixPosition(cam.matrixWorld); cam.getWorldDirection(dir);
    var tanH = 2 * Math.tan(cam.fov * PI / 360) / (cam.zoom || 1);
    for (var k = 0; k < rigs.length; k++) {
      var r = rigs[k], rp = r.root.position, want = LODR;
      if (LODR < 2 || six) {
        var dx = rp.x - cp.x, dy = rp.y + 1.0 * r.scale - cp.y, dz = rp.z - cp.z;
        var ahead = dx * dir.x + dy * dir.y + dz * dir.z;             // profundidad (la altura en pantalla va con ella)
        if (six) LODA[k] = dx * dx + dy * dy + dz * dz;
      }
      if (LODR < 2) {
        var frac = ahead > 0.05 ? 1.85 * r.scale / (ahead * tanH) : 0;
        if (frac > LOD_DOWN) { // solo si está en el encuadre (no uno pegado a la cámara pero fuera de plano)
          LODW[2].set(rp.x, rp.y + 1.0 * r.scale, rp.z).project(cam);
          if (Math.abs(LODW[2].x) > 1.15 || Math.abs(LODW[2].y) > 1.3) frac = 0;
        }
        r.lodFrac = frac;
        var big = frac > (r.lodBig ? LOD_DOWN : LOD_UP);
        r.lodBig = big; if (big) want = 2;
        if (six) {
          var hy = r.far ? -FAR_HYS : 0;
          r.far = !big && (ahead > FAR_D + hy || (r.team !== myTeam && ahead > FAR_RIV + hy));
          if (r.far && LODR === 1) want = 0;
        }
      } else { r.lodBig = false; r.far = false; }
      var geo = r.geos[want] || (want === LODR ? rigGeometry(r, want) : null);
      if (geo && r.skin.geometry !== geo) r.skin.geometry = geo;
      if (six && r.ink) { var iv = QRANK > 0 && !r.far; if (r.ink.visible !== iv) r.ink.visible = iv; }
    }
    if (six) {
      for (k = 0; k < rigs.length; k++) {
        var cast = true;
        if (QRANK < 2 && rigs.length > SHADOW_N[QRANK]) {
          var nb = 0, dk = LODA[k];
          for (var j = 0; j < rigs.length; j++) if (LODA[j] < dk || (LODA[j] === dk && j < k)) nb++;
          cast = nb < SHADOW_N[QRANK];
        }
        if (rigs[k].skin.castShadow !== cast) rigs[k].skin.castShadow = cast;
      }
    }
  }
  /** Cambia el nivel de detalle de todos los atletas construidos (la geometría de cada nivel se crea una vez). */
  function setLod(lod) {
    LODR = lod; LODK = LOD_K[lod];
    for (var key in cache) {
      var r = cache[key], g = rigGeometry(r, lod);
      if (r.skin.geometry !== g) r.skin.geometry = g;
    }
  }

  // =====================================================================
  //  CONVERSIONES sim -> espacio cuerpo
  // =====================================================================
  /** Punto de la sim -> espacio del cuerpo del rig (antes de desplazamientos del body). */
  function toBodyV(r, o, out) { return toBody(r, o.x, o.y, o.z, out); }
  function toBody(r, x, y, z, out) {
    var p = r.p, fx = Math.cos(r.yaw), fy = Math.sin(r.yaw), s = r.scale;
    var dx = x - p.x - r.offX, dy = y - p.y - r.offY;
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
      // brazos colgando RECTOS (a un brazo exacto del hombro) con los codos algo atrás: nunca "en jarras"
      setV(v[HL], 0.245, 0.9, 0.07); setV(v[HR], -0.245, 0.9, 0.07);
      setV(v[AL], 0.25, 0.1, -1); setV(v[AR], -0.25, 0.1, -1);
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

  /** Locomoción: ciclo de zancada ligado a la velocidad real. Los pies de apoyo se BLOQUEAN en el mundo (footLock,
   *  después del amortiguado): aquí solo se calcula el ciclo (fase, apoyo/vuelo de cada pie y la trayectoria de vuelo).
   *  Carrera: fracción de apoyo 0,32 (fase de vuelo), cadencia 3,2-3,6 pasos/s por encima de 4 m/s y paso de hasta
   *  ~1,5 m, de modo que paso × cadencia = velocidad. El pie en vuelo despega y aterriza con la velocidad del suelo
   *  (tangentes de Hermite = velocidad de apoyo): sin tirón al bloquear/soltar. Desplazamiento lateral: pasos cortos
   *  sin cruzar los pies. */
  function locomotion(r, P, sp, dirX, dirZ, dt, snap, armsToo) {
    var m = sstep(0.12, 0.7, sp);
    LOCO_M = m;
    if (m <= 0) { r.mPrev = 0; return; }
    var s = P.s, v = P.v, runK = sstep(1.8, 4.8, sp);
    // las caderas giran hacia donde corre (el tronco sigue mirando al balón): en diagonal no se cruzan las piernas
    // ni se encoge el paso; de espaldas, las caderas miran al lado contrario (carrera hacia atrás)
    var ang = Math.atan2(dirX, dirZ), back = Math.abs(ang) > 1.75;
    var hyT = clamp(back ? wrapA(ang - PI) : ang, -0.75, 0.75) * sstep(0.5, 2.2, sp);
    if (snap) r.hipYaw = hyT; else r.hipYaw += (hyT - r.hipYaw) * kf(9, dt);
    var hy = r.hipYaw, chy = Math.cos(hy), shy = Math.sin(hy), rel = ang - hy;
    dirX = Math.sin(rel); dirZ = Math.cos(rel);           // dirección de la carrera en el marco de las caderas
    var lat = sstep(0.35, 0.9, Math.abs(dirX));
    var S = lerp(0.5, 0.32, runK);                        // fracción de apoyo (carrera: fase de vuelo)
    var f = lerp(1.2 + 0.35 * sp, 1.0 + 0.13 * sp, runK); // ciclos/s (2 pasos por ciclo)
    // excursión del pie de apoyo limitada por el alcance real de la pierna con la cadera de la carrera
    var drop = lerp(0.12, 0.17, runK);
    var hh = HIP_H - drop - ANKLE, LR = (THIGH + SHIN) * 0.92, half = Math.sqrt(Math.max(0.01, LR * LR - hh * hh));
    var maxExc = lerp(2 * half * 0.97, 0.3, lat);
    if (sp * S / f > maxExc * r.scale) f = sp * S / (maxExc * r.scale);
    var stride = sp * S / f / r.scale;                    // excursión del pie de apoyo (espacio cuerpo)
    if (r.mPrev <= 0) r.phase = 0;                       // primer paso: pie izquierdo apoyando, el derecho sale
    r.mPrev = m;
    if (!snap) r.phase += PI * 2 * f * dt;
    var lift = (0.07 + 0.13 * runK) * (1 - lat * 0.5);
    var cosL = 0, tan = -stride * (1 - S) / S;           // tangente de Hermite (velocidad del apoyo en unidades de w)
    for (var k = 0; k < 2; k++) {
      var F = r.fk[k];
      var u = r.phase / (PI * 2) + (k ? 0.5 : 0); u -= Math.floor(u);
      var along, up = 0, pitch = 0, w = 0;
      var sd = k ? -1 : 1, fv = v[FL + k];
      var bx = sd * lerp(0.13, 0.2, lat), bz = lerp(0.02, -0.05, runK);
      if (u < S) { along = stride * (0.5 - u / S); F.st = true; }
      else {
        w = (u - S) / (1 - S); F.st = false;
        // despegue (w < 0,1) y apoyo (w > 0,86) a la velocidad del suelo (quietos en el mundo); en medio, Hermite
        if (w < SW_A) along = -0.5 * stride + tan * w;
        else if (w > SW_B) along = 0.5 * stride + tan * (w - 1);
        else {
          var q = (w - SW_A) / (SW_B - SW_A), q2 = q * q, q3 = q2 * q, mt = tan * (SW_B - SW_A);
          along = (2 * q3 - 3 * q2 + 1) * (-0.5 * stride + tan * SW_A) + (q3 - 2 * q2 + q) * mt +
            (-2 * q3 + 3 * q2) * (0.5 * stride + tan * (SW_B - 1)) + (q3 - q2) * mt;
        }
        // altura: sube y baja deprisa (el pie solo roza el suelo cuando ya va a la velocidad del suelo)
        var sw = Math.sin(PI * w), sq = Math.sqrt(sw);
        up = sq * lift * (0.75 + 0.5 * (1 - w)) * (1 - 0.35 * w * w); // talón arriba al principio del vuelo (recogida)
        up = Math.max(up, 0.032 * sstep(0, 0.05, w) * sstep(0, 0.05, 1 - w)); // despegue y apoyo francos (no roza el suelo)
        pitch = -sw * 0.55 * (1 - lat);
      }
      F.w = w;
      var lx = bx + dirX * along, lz = bz + dirZ * along;
      var tx = lx * chy + lz * shy, tz = -lx * shy + lz * chy;  // marco de las caderas -> cuerpo
      F.cx = tx; F.cz = tz;
      if (!F.st && (F.ox !== 0 || F.oz !== 0)) {           // vuelo: sale de donde quedó el pie bloqueado
        var fe = Math.min(1, F.o0 + 0.6), fo = 1 - sstep(F.o0, fe, w); tx += F.ox * fo; tz += F.oz * fo;
        if (w >= fe) { F.ox = 0; F.oz = 0; }
      }
      fv.x = lerp(fv.x, tx, m); fv.y = lerp(fv.y, ANKLE + up, m); fv.z = lerp(fv.z, tz, m);
      s[FPL + k] = lerp(s[FPL + k], pitch + (u < S ? 0 : 0.15), m);
      s[FYL + k] = lerp(s[FYL + k], sd * 0.06 + hy, m);
      if (k === 0) cosL = Math.cos(PI * 2 * u);
    }
    var bob = Math.cos(r.phase * 2) * 0.03 * runK;
    s[DROP] = lerp(s[DROP], drop + bob, m);
    s[PP] = lerp(s[PP], 0.06 + dirZ * 0.2 * runK, m);
    s[PR] = lerp(s[PR], -dirX * 0.1 * runK, m);
    s[CP] = lerp(s[CP], 0.12 + dirZ * 0.12 * runK, m);
    s[CY] = lerp(s[CY], cosL * 0.22 * runK * (1 - lat) - 0.4 * hy, m);
    s[PY] = lerp(s[PY], -cosL * 0.12 * runK * (1 - lat) + hy, m);
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

  // Propiedad de los pies en la pose objetivo del frame: LOCO_M = peso de la locomoción; FOW = 1 - lo que las capas
  // de gesto (recepción, saque, plancha, celebración…) han reescrito de los pies. footLock bloquea con m × FOW.
  // FEX = parte de los pies que mueven gestos con pasos PROPIOS (saque, plancha): ahí no entra el apoyo de pie (standFeet);
  // el resto de gestos (colocación, recepción, celebración) dejan los pies quietos en el mundo y dan pasos de ajuste.
  var LOCO_M = 0, FOW = 1, FEX = 0, SW_A = 0.1, SW_B = 0.86, SET_PLANT = 1, SET_UP = 0.12;
  function layerF(P, T, w, ex) { blendP(P, T, w); if (w > 0) { var ww = w > 1 ? 1 : w; FOW *= 1 - ww; if (ex) FEX = 1 - (1 - FEX) * (1 - ww); } }
  /** Capa de gesto que, si el jugador se está desplazando, deja los pies a la locomoción (en proporción a LOCO_M):
   *  el gesto de brazos/tronco entra entero y los pies solo en lo que no corre. `plant` (0-1, opcional) reclama los
   *  pies para el gesto aunque corra: apoyo a dos pies en el contacto (colocación). */
  function layerG(P, T, w, plant, ex) {
    if (w <= 0) return; if (w > 1) w = 1;
    var wf = w * Math.max(1 - LOCO_M, plant > 0 ? (plant > 1 ? 1 : plant) : 0), i;
    for (i = 0; i < NS; i++) {
      var ww = (i === FPL || i === FPR || i === FYL || i === FYR) ? wf : w;
      P.s[i] += (T.s[i] - P.s[i]) * ww;
    }
    for (i = 0; i < NV; i++) P.v[i].lerp(T.v[i], (i >= FL) ? wf : w);
    P.ra = lerp(P.ra, T.ra, w); P.rb = lerp(P.rb, T.rb, w);
    FOW *= 1 - wf;
    if (ex) FEX = 1 - (1 - FEX) * (1 - wf);
  }
  /** Bloqueo de pies (tras dampPose, con la raíz ya colocada): el pie en apoyo queda fijo en el MUNDO; se convierte
   *  al espacio del cuerpo cada frame y alimenta la IK de la pierna. Se suelta al despegar (fase) o si la pierna
   *  se estiraría de más. En vuelo, el pie sigue el ciclo exacto (sin el muelle de la pose: sin retraso). */
  function footLock(r, air, snap, dt) {
    var own = air || snap ? 0 : r.locoOwn;
    // arranque (la sim sale a toda velocidad de golpe): el pie de apoyo se planta DONDE estaba (frame anterior) y el
    // otro sale desde donde estaba (desfase que se absorbe en el vuelo): primer paso sin tirones
    var start = own > 0.3 && r.ownPrev < 0.3;
    r.ownPrev = own;
    var c = r.cur, s = c.s, k;
    if (r.apOn && !air && !snap && r.apS === r.apS) { approachFeet(r, s); r.ownPrev = 1; return; }
    // de pie (sin carrera y con los pies en manos de la postura base): pies quietos en el MUNDO, pasos de ajuste y de pivote
    var ws = (own < 0.04 && !air && !snap) ? sstep(0.5, 0.95, r.standW) : 0;
    if (ws > 0) { standFeet(r, ws, s, dt); return; }
    r.fk[0].sl = r.fk[1].sl = false; r.fk[0].sst = r.fk[1].sst = -1;
    for (k = 0; k < 2; k++) {
      var F = r.fk[k], fv = c.v[FL + k], tg = r.tgt.v[FL + k];
      if (own < 0.04) {
        F.lock = false; F.ox = 0; F.oz = 0;
        // fin de la carrera: el pie que aún no está en su sitio se recoloca con un pasito (se levanta), no se arrastra
        var dx0 = tg.x - fv.x, dz0 = tg.z - fv.z, dd0 = dx0 * dx0 + dz0 * dz0;
        if (dd0 > 0.0016 && !air) fv.y = Math.max(fv.y, ANKLE + Math.min(0.09, Math.sqrt(dd0) * 0.5));
        footSave(r, F, fv, s);
        continue;
      }
      // el pie va bloqueado en el MUNDO mientras está bajo: apoyo + despegue (w < SW_A) + llegada (w > SW_B)
      var low = F.st || (F.lock && F.w < SW_A) || F.w > SW_B;
      if (start) {
        if (F.st) { F.x = F.px; F.y = F.py; F.lock = true; F.yaw = r.yaw; F.skip = false; F.n = 0; }
        else { toBody(r, F.px, F.py, r.p.z, tV); F.lock = false; F.skip = false; F.ox = tV.x - s[OX] - F.cx; F.oz = tV.z - s[OZ] - F.cz; F.o0 = F.w; low = false; }
      }
      if (low && !F.skip) {
        if (!F.lock) { // se planta donde dice el ciclo (el muelle de la pose va un frame por detrás)
          tV.copy(fv).lerp(tg, own);
          bodyToSim(r, tV.x + s[OX], tV.z + s[OZ], F); F.lock = true; F.yaw = r.yaw; F.n = 0;
        }
        F.n++; toBody(r, F.x, F.y, r.p.z, tV);
        tV.x -= s[OX]; tV.z -= s[OZ];
        // alcance de la pierna (cadera de ese lado con el giro de la pelvis)
        var hw = k ? -HIP_W : HIP_W, cpy = Math.cos(s[PY]), spy = Math.sin(s[PY]);
        var fy = F.st ? ANKLE : tg.y;
        var hx = tV.x - (s[PX] + hw * cpy), hy = HIP_H - s[DROP] - fy, hz = tV.z - (s[PZ] - hw * spy);
        var LL = 0.98 * (THIGH + SHIN), h2 = hx * hx + hz * hz;
        if (h2 + hy * hy > LL * LL) {
          // la cadera baja un poco (rodilla de apoyo) antes que soltar el pie; si no basta, despega antes
          var need = h2 < LL * LL ? HIP_H - fy - Math.sqrt(LL * LL - h2) : 9;
          if (need - s[DROP] < 0.09) s[DROP] = need;
          else { F.lock = false; F.skip = true; F.ox = 0; F.oz = 0; fv.y = Math.max(fv.y, ANKLE + 0.045); footSave(r, F, fv, s); continue; }
        }
        // el pie de apoyo queda fijo en el mundo con TODO el peso que no reclaman gestos con pasos propios (aunque la
        // carrera solo tenga parte de los pies: al frenar, el resto es apoyo de pie, no deslizamiento)
        var wl = air ? own : 1 - r.fex * (1 - own);
        fv.x += (tV.x - fv.x) * wl; fv.z += (tV.z - fv.z) * wl; fv.y += (fy - fv.y) * wl;
        s[FYL + k] += (clamp(wrapA(F.yaw - r.yaw), -0.7, 0.7) - s[FYL + k]) * wl;
        if (F.st) s[FPL + k] *= 1 - wl;
      } else if (low) {
        // pierna al límite: despegue anticipado (el pie se levanta y va hacia el ciclo; no se arrastra)
        fv.x += (tg.x - fv.x) * own; fv.z += (tg.z - fv.z) * own; fv.y = Math.max(fv.y + (tg.y - fv.y) * own, ANKLE + 0.045);
      } else {
        if (F.lock) { F.lock = false; F.ox = fv.x - F.cx; F.oz = fv.z - F.cz; F.o0 = F.w; }
        else { fv.x += (tg.x - fv.x) * own; fv.y += (tg.y - fv.y) * own; fv.z += (tg.z - fv.z) * own; }
        if (!F.st) F.skip = false;
      }
      footSave(r, F, fv, s);
    }
  }
  /** Pies de apoyo con el jugador parado: cada pie queda fijo en el MUNDO (posición y giro) mientras la postura no se
   *  aleje de él; si el objetivo de la postura se separa (> ST_D m, > ST_YAW rad de giro o la pierna se estira de más)
   *  da un paso corto (se levanta y se planta donde pide la postura). Un solo pie a la vez: en un giro grande el pie que
   *  queda pivota sobre la punta (gira en el sitio) mientras el otro da la vuelta. ws: peso (0..1) de este control. */
  var ST_D = 0.13, ST_YAW = 0.62, ST_LIFT = 0.065;
  function standFeet(r, ws, s, dt) {
    var c = r.cur, tm = r.clock, k, stepping = -1, best = -1, bestE = 1;
    if (r.ssAir) { for (k = 0; k < 2; k++) { r.fk[k].sl = false; r.fk[k].sst = -1; footSave(r, r.fk[k], c.v[FL + k], s); } return; }   // saltito: pies libres
    for (k = 0; k < 2; k++) if (r.fk[k].sst >= 0) stepping = k;
    for (k = 0; k < 2; k++) {
      var F = r.fk[k], fv = c.v[FL + k], tg = r.tgt.v[FL + k], tfy = r.tgt.s[FYL + k];
      F.lock = false; F.ox = 0; F.oz = 0;
      if (F.sst >= 0) {
        // paso en curso: de donde estaba (mundo) a donde pide la postura ahora (cuerpo), con el pie levantado
        var u = (tm - F.sst) / F.sdur, e = sstep(0, 1, u);
        toBody(r, F.s0x, F.s0y, r.p.z, tV); tV.x -= s[OX]; tV.z -= s[OZ];
        if (u >= 1) {
          F.sst = -1; F.sl = true; bodyToSim(r, tg.x + s[OX], tg.z + s[OZ], tV2); F.sx = tV2.x; F.sy = tV2.y; F.syaw = r.yaw + tfy;
        } else {
          fv.x += (lerp(tV.x, tg.x, e) - fv.x) * ws; fv.z += (lerp(tV.z, tg.z, e) - fv.z) * ws;
          fv.y += (Math.max(tg.y, ANKLE + ST_LIFT * Math.sqrt(Math.sin(PI * u)) * F.slh) - fv.y) * ws;
          s[FYL + k] += (wrapA(F.s0yaw + wrapA(r.yaw + tfy - F.s0yaw) * e - r.yaw) - s[FYL + k]) * ws;
          s[FPL + k] += (-0.35 * Math.sin(PI * u) * F.slh - s[FPL + k]) * ws;   // talón arriba al despegar
          footSave(r, F, fv, s);
          continue;
        }
      }
      if (!F.sl) {
        // entra en el control de pie: el pie que ya está en el suelo se queda donde está; el que está en el aire se planta con un paso
        // (desde donde estaba el pie al final del frame anterior: footSave; la pose de este frame ya se ha movido)
        if (fv.y < ANKLE + 0.03 || stepping >= 0) { F.sl = true; F.sx = F.px; F.sy = F.py; F.syaw = r.yaw + s[FYL + k]; }
        else { stepStart(r, F, F.px, F.py, r.yaw + s[FYL + k], 0.18, tm); stepping = k; footSave(r, F, fv, s); continue; }
      }
      // pie bloqueado: dónde queda en el cuerpo y cuánto se separa de la postura
      toBody(r, F.sx, F.sy, r.p.z, tV); tV.x -= s[OX]; tV.z -= s[OZ];
      var dx = tV.x - tg.x, dz = tV.z - tg.z, d = Math.sqrt(dx * dx + dz * dz);
      // pivote: mientras el otro pie da el paso, este gira sobre la punta hacia donde mira el cuerpo
      if (stepping >= 0 && stepping !== k) F.syaw += wrapA(r.yaw + tfy - F.syaw) * kf(7, dt);
      var ye = Math.abs(wrapA(F.syaw - r.yaw - tfy));
      var hw = k ? -HIP_W : HIP_W, hx = tV.x - (s[PX] + hw * Math.cos(s[PY])), hy = HIP_H - s[DROP] - ANKLE, hz = tV.z - (s[PZ] - hw * Math.sin(s[PY]));
      var over = hx * hx + hz * hz + hy * hy > 0.94 * (THIGH + SHIN) * (THIGH + SHIN);
      var err = Math.max(d / ST_D, ye / ST_YAW, over ? 2 : 0);
      if (err > bestE) { bestE = err; best = k; }
      fv.x += (tV.x - fv.x) * ws; fv.z += (tV.z - fv.z) * ws; fv.y += (ANKLE - fv.y) * ws;
      s[FYL + k] += (clamp(wrapA(F.syaw - r.yaw), -1.1, 1.1) - s[FYL + k]) * ws;
      s[FPL + k] *= 1 - ws;
      footSave(r, F, fv, s);
    }
    if (best >= 0 && stepping < 0) {
      var Fb = r.fk[best], tgb = r.tgt.v[FL + best];
      var db = Math.sqrt((c.v[FL + best].x - tgb.x) * (c.v[FL + best].x - tgb.x) + (c.v[FL + best].z - tgb.z) * (c.v[FL + best].z - tgb.z));
      stepStart(r, Fb, Fb.sx, Fb.sy, Fb.syaw, clamp(0.17 + db * 0.35, 0.18, 0.3), tm);
      Fb.slh = clamp(0.6 + db * 2.5, 0.6, 1);
    }
  }
  function stepStart(r, F, x, y, yaw, dur, tm) { F.sl = false; F.sst = tm; F.s0x = x; F.s0y = y; F.s0yaw = yaw; F.sdur = dur; F.slh = 1; }
  /** Posición del pie en el mundo (sim) al final del frame: para plantarlo donde estaba si arranca a correr. */
  function footSave(r, F, fv, s) { bodyToSim(r, fv.x + s[OX], fv.z + s[OZ], tV2); F.px = tV2.x; F.py = tV2.y; }
  /** Espacio cuerpo (x, z, sin desplazamientos del body) -> sim (x, y) en o.x/o.y. Inversa de toBody. */
  function bodyToSim(r, bx, bz, o) {
    var fx = Math.cos(r.yaw), fy = Math.sin(r.yaw), s = r.scale;
    o.x = r.p.x + r.offX + s * (bz * fx - bx * fy); o.y = r.p.y + r.offY + s * (bz * fy + bx * fx);
    return o;
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
  /** Mano en el contacto del remate (espacio cuerpo, sin HOP): brazo ESTIRADO desde el hombro derecho (con el tronco
   *  del contacto: algo girado y adelantado) en la dirección del balón, limitada a delante-arriba del hombro de golpeo.
   *  Si el balón llega tarde (más bajo), el brazo golpea más por delante en vez de doblarse junto a la cabeza. */
  var SC = new Float32Array(NS), CT_CY = 0.32, PIKE_Y = 0.27, PIKE_Z = 0.25;
  function contactHand(o, Ct, hop) {
    SC[PP] = 0.1; SC[CP] = 0.2; SC[DROP] = -0.06; SC[PZ] = 0; SC[SHR] = 0;
    shoulderC(SC);
    var sx = -SH_X * Math.cos(CT_CY), sz = SHZ + SH_X * Math.sin(CT_CY), sy = SHY, dx = -0.06, dy = 0.9, dz = 0.38;
    if (Ct) { dx = Ct.x - sx; dy = Ct.y - hop - sy; dz = Ct.z - sz; }
    var l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx = clamp(dx / l, -0.32, -0.04); dz = clamp(dz / l, 0.24, 0.6); dy = Math.sqrt(Math.max(0.25, 1 - dx * dx - dz * dz));
    l = Math.sqrt(dx * dx + dy * dy + dz * dz); var L = ARM_R * 0.98 / l;
    o.set(sx + dx * L, sy + dy * L, sz + dz * L);
  }
  function attackPose(r, P, tj, sw, ha, Ct) {
    var s = P.s, v = P.v;
    var a1 = sstep(0.0, 0.15, tj), ck = sstep(0.06, 0.26, tj);
    s[DROP] = -0.06; s[PY] = 0; s[PR] = 0;
    s[FYL] = 0.1; s[FYR] = -0.12;
    // punto de contacto (mano): por delante y a la derecha de la cabeza, brazo estirado
    contactHand(tV3, Ct, s[HOP]);
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
        // los puntos de control van por FUERA de la cabeza (lado derecho): la mano sube en arco, no en línea recta
        v[HR].set(b0 * hx + b1 * -0.38 + b2 * (tV3.x - 0.14) + b3 * tV3.x,
          b0 * hy + b1 * 2.05 + b2 * (tV3.y + 0.1) + b3 * tV3.y,
          b0 * hz + b1 * -0.36 + b2 * (tV3.z - 0.22) + b3 * tV3.z);
        v[AR].lerp(tV2.set(-1, 0.05, -0.3), sstep(0.2, 0.9, sw));
        s[WRR] = lerp(s[WRR], -0.15, sw);
      }
      // piernas acopladas al brazo: en el despegue se quedan atrás (estela), en el arco y flecha las rodillas van más atrás
      // (cuerpo arqueado, caderas en extensión) y en el latigazo vienen delante y arriba con la cadera en "navaja" (~40º)
      // mientras el tronco cierra sobre el balón
      var trail = 1 - a1;
      setV(v[FL], 0.13, ANKLE + lerp(0.1, 0.3, c) * a1 + 0.06 * trail, lerp(-0.12, -0.38, c) * a1 - 0.12 * trail);
      setV(v[FR], -0.15, ANKLE + lerp(0.16, 0.42, c) * a1 + 0.1 * trail, lerp(-0.18, -0.5, c) * a1 - 0.18 * trail);
      if (e > 0) { v[FL].lerp(tV2.set(0.14, ANKLE + PIKE_Y, PIKE_Z), e); v[FR].lerp(tV2.set(-0.16, ANKLE + PIKE_Y - 0.06, PIKE_Z - 0.1), e); }
      s[PP] -= 0.1 * c * (1 - e);
      s[FPL] = s[FPR] = lerp(lerp(0.7, 1.0, c), 0.55, e);
      P.ra = sw > 0 ? lerp(24, 70, sw) : 22; P.rb = sw > 0 ? lerp(16, 30, sw) : 16;
    } else {
      // acompañamiento: el brazo SIGUE el latigazo hacia delante y abajo, cruzando hasta la cadera izquierda en ~0,22 s
      // (sale del contacto con velocidad: curva de salida rápida, la mano nunca vuelve a subir); la izquierda se recoge
      var x0 = clamp(ha / 0.22, 0, 1), f = 1 - (1 - x0) * (1 - x0), wr = sstep(0.0, 0.06, ha), g1 = 1 - f;
      // latigazo, no "plegado": el pecho se queda bastante erguido (<= ~27º), la cabeza arriba mirando el balón
      s[PP] = lerp(0.08, 0.13, f); s[CP] = lerp(0.16, 0.34, f); s[CY] = lerp(0.32, 0.55, f); s[CR] = -0.07 * f; s[SHR] = 0;
      s[HP] = -0.3; s[LOOK] = 0.55;
      var q0 = g1 * g1, q1 = 2 * g1 * f, q2 = f * f;
      v[HR].set(q0 * tV3.x + q1 * (tV3.x + 0.08) + q2 * 0.18,
        q0 * tV3.y + q1 * (tV3.y - 0.5) + q2 * 0.98,
        q0 * tV3.z + q1 * (tV3.z + 0.45) + q2 * 0.34);
      setV(v[AR], lerp(-1, -0.6, f), lerp(0.05, -0.8, f), lerp(-0.3, 0.2, f));
      s[WRR] = lerp(-0.15, 1.0, wr) * (1 - 0.45 * f);
      setV(v[HL], 0.1, lerp(1.32, 1.18, f), lerp(0.24, 0.18, f)); setV(v[AL], lerp(1, 0.6, f), lerp(-0.5, -1, f), -0.1); s[WRL] = 0.2; // izquierda recogida
      // piernas: la "navaja" del contacto se mantiene un instante y se deshace hacia abajo para caer (izquierda delante)
      var lg = sstep(0.06, 0.3, ha);
      setV(v[FL], 0.14, ANKLE + lerp(PIKE_Y, 0.16, lg), lerp(PIKE_Z, 0.12, lg)); setV(v[FR], -0.16, ANKLE + lerp(PIKE_Y - 0.06, 0.22, lg), lerp(PIKE_Z - 0.1, -0.02, lg));
      s[FPL] = s[FPR] = lerp(0.55, 0.45, lg);
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
    // pierna izquierda algo adelantada (cae primero), puntas abajo para recibir el suelo
    v[FL].lerp(tV3.set(0.15, ANKLE + 0.02, 0.1), w); v[FR].lerp(tV3.set(-0.15, ANKLE + 0.02, -0.04), w);
    s[FPL] = lerp(s[FPL], 0.3, w); s[FPR] = lerp(s[FPR], 0.3, w);
    s[OZ] *= 1 - 0.6 * w;
    // las rodillas empiezan a doblarse ANTES de tocar el suelo (tiempo previsto hasta el contacto): al apoyar ya amortiguan
    var tl = (vz + Math.sqrt(vz * vz + 2 * C.G * Math.max(0, z))) / C.G, kb = sstep(0.18, 0.0, tl);
    if (kb > 0) { s[DROP] = Math.max(s[DROP], -0.06) + LAND_PRE * kb; s[PP] += 0.12 * kb; s[CP] += 0.08 * kb; s[OX] *= 1 - kb; P.rb = Math.max(P.rb, 30); P.ra = Math.max(P.ra, 24); }
  }
  var LAND_PRE = 0.12, LAND_K = 0.11;

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
  var SHR_UP = 0.06, ARM_R = UPPER + FORE + PALM, ARM_L2 = FORE + PALM;

  /** Recepción de antebrazos (plataforma) hacia el punto de contacto Pc (espacio cuerpo). follow: 0..1 acompañamiento.
   *  Brazos RECTOS con las muñecas juntas y los hombros encogidos hacia delante; la altura se busca con las
   *  piernas y la cadera, no subiendo las manos: la plataforma nunca pasa de la altura del pecho
   *  (balón alto = plataforma alta con el tronco hacia atrás; nunca manos juntas delante de la cara). */
  function passPose(r, P, Pc, follow) {
    var s = P.s, v = P.v;
    var hx = Pc.x, hz = Pc.z, dh = Math.sqrt(hx * hx + hz * hz) || 1e-3, nx = hx / dh, nz = hz / dh;
    var reach = clamp((dh - 0.35) / 0.9, 0, 1), low = clamp((1.0 - Pc.y) / 0.7, 0, 1), high = sstep(1.15, 1.6, Pc.y);
    s[PX] = nx * (0.3 + 0.15 * low) * reach; s[PZ] = nz * (0.3 + 0.15 * low) * reach * (1 - 0.5 * high);
    s[DROP] = 0.3 + 0.08 * reach + 0.24 * low - 0.17 * high - 0.12 * follow;   // el acompañamiento sale de las piernas
    s[PP] = 0.24 + 0.12 * low - 0.16 * high - 0.04 * follow;
    s[CP] = 0.18 + 0.1 * reach + 0.1 * low - 0.36 * high - 0.06 * follow;      // balón alto: tronco algo atrás
    s[HP] = -0.12 - 0.15 * high; s[SHR] = 0.55;
    s[CY] = clamp(Math.atan2(nx, nz) * 0.45, -0.6, 0.6); s[PR] = -nx * 0.12 * reach;
    shoulderC(s);
    var shx = s[PX], ax = clamp(hx, -1.0, 1.0) - shx, az = Math.max(0.3, hz) - SHZ, hh = Math.sqrt(ax * ax + az * az) || 1e-3;
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
  /** Colocación por tiempos (ht = s hasta el contacto, >= 0; ha = s desde el contacto, < 0 antes). Antes: ventana de dedos
   *  sobre la frente con los codos abiertos (~90º) desde t-0,35 y una pequeña amortiguación en los últimos 0,06 s. Después:
   *  brazos y piernas se estiran A LA VEZ hacia donde sale el balón (atrás: el tronco se echa atrás) y, a partir de +0,16 s,
   *  las manos se separan y bajan a preparado con salida suave y un leve rebote. Pc: balón (cuerpo) antes; contacto después. */
  function setPose2(r, P, Pc, ht, ha) {
    var s = P.s, v = P.v;
    s[PP] = 0.04; s[CY] = 0; s[HP] = -0.25; s[PX] = 0; s[PZ] = 0;
    if (ha < 0) {
      var rise = sstep(0.3, 0.0, ht);
      s[DROP] = lerp(0.2, 0.1, rise); s[CP] = lerp(-0.06, -0.12, rise);
      shoulderC(s);
      var cx = Pc ? clamp(Pc.x * 0.4, -0.12, 0.12) : 0, cz = SHZ + 0.17 + (Pc ? clamp(Pc.z * 0.15, -0.03, 0.06) : 0);
      var cy = SHY + 0.37 - 0.035 * sstep(0.07, 0.0, ht);              // amortigua en los últimos 0,06 s
      setV(v[HL], cx + 0.105, cy, cz); setV(v[HR], cx - 0.105, cy, cz);
      setV(v[AL], 1, -0.35, 0.05); setV(v[AR], -1, -0.35, 0.05);       // codos abiertos y algo abajo
      s[WRL] = s[WRR] = -1.15;
      setV(v[FL], 0.2, ANKLE, 0.1); setV(v[FR], -0.2, ANKLE, -0.08); s[FPL] = s[FPR] = 0;
      P.ra = 22; P.rb = 14;
      return;
    }
    // empuje: dirección de salida del balón en el cuerpo (hitAnchor dejó la dirección en r.hd*)
    dirToBody(r, r.hdx, r.hdy, r.hdz, tV3);
    var back = tV3.z < -0.15 ? sstep(-0.15, -0.6, tV3.z) : 0;
    var e = clamp(ha / 0.09, 0, 1); e = 1 - (1 - e) * (1 - e) * (1 - e);
    s[DROP] = lerp(0.1, -0.04, e); s[CP] = lerp(-0.12, -0.12 - 0.22 * back, e); s[PP] = lerp(0.04, 0.02 - 0.08 * back, e);
    shoulderC(s);
    var dx = clamp(tV3.x, -0.5, 0.5), dy = Math.max(0.75, tV3.y + 0.6), dz = clamp(tV3.z, -0.5, 0.55), dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var L = ARM_R * 0.97 / dl;
    var px = dx * L, py = SHY + dy * L, pz = SHZ + dz * L;
    var c0x = Pc ? Pc.x * 0.5 : 0, c0y = Pc ? Math.min(Pc.y - 0.12, SHY + 0.5) : SHY + 0.37, c0z = Pc ? clamp(Pc.z - 0.1, SHZ + 0.05, SHZ + 0.35) : SHZ + 0.17;
    setV(v[HL], lerp(c0x + 0.1, px + 0.085, e), lerp(c0y, py, e), lerp(c0z, pz, e));
    setV(v[HR], lerp(c0x - 0.1, px - 0.085, e), lerp(c0y, py, e), lerp(c0z, pz, e));
    setV(v[AL], 1, lerp(-0.35, -0.6, e), 0.05); setV(v[AR], -1, lerp(-0.35, -0.6, e), 0.05);
    s[WRL] = s[WRR] = lerp(-1.15, -0.25, e);
    setV(v[FL], 0.2, ANKLE, 0.1); setV(v[FR], -0.2, ANKLE, -0.08);
    s[FPL] = s[FPR] = 0.35 * e * (1 - sstep(0.15, 0.3, ha));            // de puntillas al estirarse
    // asentarse: las manos se separan y bajan a preparado (salida suave con un leve rebote), las rodillas vuelven
    var d = clamp((ha - 0.15) / 0.2, 0, 1);
    if (d > 0) {
      var ob = 1 + 2.2 * Math.pow(d - 1, 3) + 1.2 * Math.pow(d - 1, 2);   // easeOutBack
      v[HL].lerp(tV3.set(0.24, 1.04, 0.36), ob); v[HR].lerp(tV3.set(-0.24, 1.04, 0.36), ob);
      v[AL].lerp(tV3.set(0.4, -1, -0.25), d); v[AR].lerp(tV3.set(-0.4, -1, -0.25), d);
      s[DROP] = lerp(s[DROP], 0.17, sstep(0, 1, d)); s[CP] = lerp(s[CP], 0.14, d); s[PP] = lerp(s[PP], 0.12, d);
      s[WRL] = s[WRR] = lerp(s[WRL], 0, d);
    }
    P.ra = ha < 0.15 ? 34 : 20; P.rb = 16;
  }
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
  /** Segundos hasta el contacto REAL previsto de un golpe por arriba en el aire (hitWindow da el instante IDEAL).
   *  IA: golpea cuando w.t <= -aiTe (desfase muestreado por toque; en el saque -aiServeTe), o antes si baja del salto (p.z < 0,3).
   *  Humano: el contacto llega con la pulsación; sin pulsar, el brazo se queda armado; pulsado, espera al ideal. */
  var SWING_T = 0.12;
  function contactIn(g, p, hw) {
    var t = hw.t;
    if (!g.demo && !g.autopilot && p.team === 0 && p === g.ctrl) return g.swingLive ? Math.max(t, 0) : Math.max(t, SWING_T * 0.8);
    if (g.mode === 'rally' && p.aiTeT === g.lastTouchT) t += p.aiTe || 0;
    else if (g.mode === 'serve' && g.server === p) t += g.aiServeTe || 0;   // IA sacando: golpea cuando w.t <= -aiServeTe
    if (p.z > 0.3) { var vz = p.vz, te = (vz + Math.sqrt(vz * vz + 2 * C.G * (p.z - 0.3))) / C.G; if (te < t) t = te; }
    return t;
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

  /** Fuente del anclaje de contacto (coords de la sim) para applyPose. Tras el toque: el contacto real (peso 1 durante
   *  ANC_HOLD s y se suelta en el acompañamiento). Antes: el balón previsto en el contacto REAL (contactIn) si llega en
   *  menos de ANC_PRE s (peso 0 -> 1 con curva suave). */
  var HOLDP = { x: 0, y: 0, z: 0 }, ANC_HOLD = 0.03, HOLD_WR = -0.35, HOLD_TW = 1.45;
  function anchorSource(g, r, hw, hitAge) {
    var p = r.p, w, sd = side(p.team);
    r.aw0 = r.aw1 = 0; r.aLean = 0.25; r.aUp = 0;
    if (r.cvW0 > 0 || r.cvW1 > 0) {                          // convergencia tras el punto: manos a puntos dados
      r.aMode = 'pt'; r.aX = r.cvRx; r.aY = r.cvRy; r.aZ = r.cvRz; r.aDx = r.cvLx; r.aDy = r.cvLy; r.aDz = r.cvLz;
      r.aw1 = r.cvW1; r.aw0 = r.cvW0; r.aLean = 0.25; r.aUp = 0.1;
      return;
    }
    var b0 = g.ball;
    if (ritualHand(g, r, b0)) return;
    if (g.mode === 'serve' && g.server === p && (b0.held === p || (g.serveState === 'toss' && !r.tossJump && g.time - r.tossT < 0.14))) {
      // balón del saque en la palma izquierda; al lanzarlo, la palma lo acompaña un instante hacia arriba
      var tt = b0.held === p ? -1 : g.time - r.tossT;
      r.aMode = 'hold'; r.aX = b0.x; r.aY = b0.y; r.aZ = b0.z; r.aDx = r.aDy = r.aDz = 0; r.aLean = 0; r.aUp = 0;
      // recién puesto el saque la sim aún no ha movido el balón a la mano (lo hace en el paso siguiente): punto de la mano
      if (b0.held === p && VB.Sim._holdPos) { try { VB.Sim._holdPos(g, p, HOLDP); r.aX = HOLDP.x; r.aY = HOLDP.y; r.aZ = HOLDP.z; } catch (e) { } }
      r.aw0 = tt < 0 ? 1 : 1 - sstep(0.02, 0.13, tt); r.holdWr = HOLD_WR; r.holdTw = HOLD_TW;
      return;
    }
    if (r.hitMode && hitAge >= 0) {
      var hm = r.hitMode, rel = hm === 'palm' ? 0.13 : hm === 'plat' ? 0.12 : hm === 'set' ? 0.06 : 0.18;
      if (hitAge < ANC_HOLD + rel) {
        w = hitAge < ANC_HOLD ? 1 : 1 - sstep(ANC_HOLD, ANC_HOLD + rel, hitAge);
        r.aMode = hm; r.aX = r.hwx; r.aY = r.hwy; r.aZ = r.hwz; r.aDx = r.hdx; r.aDy = r.hdy; r.aDz = r.hdz;
        if (hm === 'palm' || hm === 'tip') r.aw1 = w; else { r.aw0 = w; r.aw1 = w; }
        ancLimits(r, hm);
        return;
      }
    }
    if (r.pdLive && r.pdTp < ANC_PRE) {                     // plancha prevista: manos al balón previsto
      w = sstep(ANC_PRE, 0, r.pdTp); w = w * w * (3 - 2 * w);
      r.aMode = 'dive'; r.aX = r.pdX; r.aY = r.pdY; r.aZ = r.pdZ; r.aDx = 0; r.aDy = 0; r.aDz = 1; r.aw0 = r.aw1 = w; ancLimits(r, 'dive');
      return;
    }
    if (!hw || g.ball.held) return;
    var tc0 = contactIn(g, p, hw), tc = tc0 < 0 && tc0 > -0.15 ? 0 : tc0; // contacto con retraso sobre lo previsto: se mantiene
    if (!(tc >= 0 && tc < ANC_PRE)) return;
    // golpes por arriba con el balón bajando: se apunta un poco por delante en la trayectoria (el balón "cae" en la palma y
    // la última corrección en el contacto es hacia arriba: la mano nunca baja antes de golpear)
    var tq = tc, kk = hw.kind;
    if ((kk === 'spike' || kk === 'fserve' || kk === 'jserve') && g.ball.vz < 0) tq = Math.max(0, tc0 + 0.035);
    var b = g.ball, G = C.G + (b.dip || 0), x = b.x + b.vx * tq, y = b.y + b.vy * tq, z = b.z + b.vz * tq - 0.5 * G * tq * tq;
    var dxp = x - p.x, dyp = y - p.y;
    if (dxp * dxp + dyp * dyp > 2.7 || z < 0.05) return;
    var k = hw.kind, mode;
    if (k === 'pass') mode = 'plat';
    else if (k === 'set') mode = 'set';
    else if (k === 'free') mode = z - p.z < 1.75 ? 'plat' : 'palm';
    else mode = 'palm';
    w = sstep(mode === 'set' ? 0.075 : ANC_PRE, 0, tc); w = w * w * (3 - 2 * w);   // colocación: la ventana manda hasta el final
    r.aMode = mode; r.aX = x; r.aY = y; r.aZ = z;
    if (mode === 'plat') { r.aDx = -sd * 0.3; r.aDy = 0; r.aDz = 1; }
    else if (k === 'spike') { r.aDx = -sd * 0.93; r.aDy = 0; r.aDz = -0.36; }
    else { r.aDx = -sd * 0.97; r.aDy = 0; r.aDz = 0.12; }
    var dl = Math.sqrt(r.aDx * r.aDx + r.aDz * r.aDz); r.aDx /= dl; r.aDz /= dl;
    if (mode === 'palm') r.aw1 = w; else { r.aw0 = w; r.aw1 = w; }
    ancLimits(r, mode);
  }
  /** RITUAL DEL SACADOR CPU (PLY-16, datos de SIM-04 en g.ritual): la mano izquierda va con el balón. 'pre': de debajo del
   *  balón pasa por el lado de fuera hasta encima (empuja el primer bote); 'dribble': palma ENCIMA del balón mientras está
   *  por encima de la altura de espera (empuje y recogida), si no, espera quieta sobre el punto del bote; 'post': de encima
   *  vuelve por fuera a debajo (lo sube a la mano); 'wait'/'done': sostener (anclaje 'hold'). Emite 'catch' en cada recogida. */
  var RIT_HOVER = 0.14, RIT_PUSH = 0.13, RIT_REACH = 0.04, RIT_SOFT = 0.06;
  function ritualHand(g, r, b) {
    var p = r.p, rt = g.ritual;
    if (!rt || !rt.on || rt.player !== p || g.mode !== 'serve' || g.serveState !== 'ready' || b.held !== p) { r.ritOn = false; return false; }
    var ph = rt.phase, th, R0 = ((VB.RITUAL && VB.RITUAL.relZ) || 1.0) + p.z, hx = b.x, hy = b.y, hz = b.z;
    r.ritOn = true; r.ritPh = ph; r.ritU = rt.u || 0;
    if (ph === 'pre') th = lerp(-PI / 2, PI / 2, sstep(0, 0.85, rt.pre > 0 ? rt.t / rt.pre : 1));
    else if (ph === 'dribble') {
      th = PI / 2;
      var hov = R0 - RIT_HOVER, u = r.ritU;
      // EMPUJÓN visible (a distancia de juego): al soltar, la palma acompaña al balón RIT_PUSH m más abajo de la altura de
      // espera y vuelve; máximo suave (sin frenazo seco en el instante en que el balón se le escapa). Antes de la recogida
      // baja un poco a buscarlo (RIT_REACH) y lo amortigua al subir.
      var wP = sstep(0, 0.16, u) * (1 - sstep(0.24, 0.56, u)), wR = sstep(0.6, 0.8, u) * (1 - sstep(0.86, 0.98, u));
      var zT = hov - RIT_PUSH * wP - RIT_REACH * wR, dz = hz - zT;
      hz = 0.5 * (hz + zT + Math.sqrt(dz * dz + RIT_SOFT * RIT_SOFT));
      hx = rt.rx; hy = rt.ry;
      // recogida: el balón que sube vuelve a tocar la palma (una vez por bote)
      if (b.vz > 0 && b.z >= hov - 0.005 && r.catchN !== rt.n && rt.n > 0) {
        r.catchN = rt.n;
        if (FXQ.length < 32) FXQ.push({ type: 'catch', team: p.team, x: b.x, y: b.y, z: b.z + BR, strength: 0.6 });
      }
    } else if (ph === 'post') th = lerp(PI / 2, -PI / 2, sstep(0.1, 1, rt.post > 0 ? (rt.t - rt.pre - rt.bounces * rt.cyc) / rt.post : 1));
    else { r.catchN = -1; return false; }                         // 'wait' / 'done': anclaje 'hold' normal
    var sd = side(p.team), ox = sd * 0.3, oy = -sd, ol = Math.sqrt(ox * ox + oy * oy);  // fuera = izquierda del sacador (algo atrás)
    var c = Math.cos(th), sn = Math.sin(th);
    r.aMode = 'drib'; r.aX = hx; r.aY = hy; r.aZ = hz;
    r.aDx = c * ox / ol; r.aDy = c * oy / ol; r.aDz = sn;
    r.aw0 = 1; r.aw1 = 0; r.aLean = 0.15; r.aUp = 0;
    r.holdWr = lerp(HOLD_WR, -0.15, sstep(-0.2, 0.9, sn)); r.holdTw = lerp(HOLD_TW, 0.2, sstep(-0.2, 0.9, sn));
    if (ph === 'dribble') {
      // muñeca: se flexiona al empujar (latigazo de la palma hacia abajo) y se arma hacia atrás para recibir el bote
      var uu = r.ritU, flex = sstep(0.0, 0.12, uu) * (1 - sstep(0.2, 0.5, uu)), cock = sstep(0.62, 0.82, uu) * (1 - sstep(0.9, 1, uu));
      r.holdWr += 0.6 * flex - 0.22 * cock;
    }
    return true;
  }
  /** Límites de la corrección de cuerpo por modo: inclinación horizontal (aLean) y subida (aUp: puntillas/saltito). */
  function ancLimits(r, m) {
    r.aLean = m === 'dive' ? 0.4 : m === 'set' ? 0.38 : m === 'plat' ? 0.3 : 0.25;
    r.aUp = m === 'palm' ? 0.24 : m === 'tip' ? 0.2 : m === 'set' ? SET_UP : 0;
  }
  /** Colocación en salto (solo visual): si el balón de la colocación llega por encima del alcance de pie, el cuerpo
   *  despega en una parábola que culmina en el contacto previsto (se fija al despegar: sin temblores) y cae después. */
  var JS_TOP = 2.25, SRV_TOP = 2.2;
  function jumpSetHop(g, r, hw, air) {
    var p = r.p, tm = g.time, G = C.G;
    if (r.jsH > 0) {
      var T = Math.sqrt(2 * r.jsH / G), u = tm - r.jsT0 - T;
      if (u > T || air || p.down > 0) { r.jsH = 0; r.vh = 0; return; }
      r.vh = Math.max(0, r.jsH - 0.5 * G * u * u) / r.scale;
      return;
    }
    r.vh = 0;
    // saque flotante: sube a puntillas (y un saltito si hace falta) en los últimos 0,3 s hasta el contacto previsto y baja
    // después; la altura se fija al empezar a subir
    if (!air && g.mode === 'serve' && g.server === p && g.serveState === 'toss' && !r.tossJump && hw) {
      var tcs = contactIn(g, p, hw), bb = g.ball, zz = bb.z + bb.vz * tcs - 0.5 * (G + (bb.dip || 0)) * tcs * tcs;
      if (tcs < 0 && tcs > -0.2) tcs = 0;
      if (tcs > 0.3 || tcs < 0) { r.svH = 0; return; }
      if (!(r.svH > 0)) r.svH = clamp((zz - p.z) / r.scale - SRV_TOP, 0, 0.22);
      r.vh = r.svH * sstep(0.3, 0.0, tcs); return;
    }
    if (!air && r.hitKind === 'serve' && r.hitShot !== 'jump' && r.svH > 0) {
      var ha = tm - r.hitT;
      if (ha >= 0 && ha < 0.3) { r.vh = r.svH * (1 - sstep(0.02, 0.28, ha)); return; }
      r.svH = 0;
    }
    if (air || !hw || hw.kind !== 'set' || g.mode !== 'rally') return;
    var tc = contactIn(g, p, hw), b = g.ball, Gb = G + (b.dip || 0);
    if (!(tc > 0 && tc < 0.5)) return;
    var z = b.z + b.vz * tc - 0.5 * Gb * tc * tc, need = (z - p.z) / r.scale - JS_TOP;
    if (need < 0.04) return;
    var H = Math.min(need + 0.03, 0.45);
    if (tc <= Math.sqrt(2 * H / G)) { r.jsH = H; r.jsT0 = tm - (Math.sqrt(2 * H / G) - tc); r.vh = Math.max(0, H - 0.5 * G * tc * tc) / r.scale; }
  }
  /** Modo de anclaje y dirección de salida de un toque (evento hit). */
  function hitAnchor(g, r, e) {
    var sh = e.shot || '', k = e.kind, m;
    if (sh === 'body') m = '';
    else if (sh === 'dive' || e.dive) m = 'dive';
    else if (k === 'pass' || (k === 'free' && sh === 'forearm')) m = 'plat';
    else if (k === 'set') m = 'set';
    else if (sh === 'tip') m = 'tip';
    else m = 'palm';
    r.hitMode = m; r.hwx = e.x; r.hwy = e.y; r.hwz = e.z;
    var b = g.ball, vx, vy, vz;
    if (Math.abs((g.lastTouchT || 0) - e.t) < 1e-6) { vx = b.vx; vy = b.vy; vz = b.vz; }
    else if (e.target) { vx = e.target[0] - e.x; vy = e.target[1] - e.y; vz = 0.3 * Math.sqrt(vx * vx + vy * vy); }
    else { vx = -side(r.p.team); vy = 0; vz = 0.3; }
    var l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1; vx /= l; vy /= l; vz /= l;
    if (m === 'plat' || m === 'dive') { vz += 1.4; l = Math.sqrt(vx * vx + vy * vy + vz * vz); vx /= l; vy /= l; vz /= l; } // normal de la plataforma
    r.hdx = vx; r.hdy = vy; r.hdz = vz;
  }

  function computeTarget(g, r, dt, snap) {
    var p = r.p, P = r.tgt, b = g.ball, tm = g.time, mode = g.mode, sd = side(p.team);
    var air = p.z > 0.012, sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    r.guard = false; // la mano derecha debe rodear la cabeza (gestos por arriba): ver applyPose
    r.swP = 0;       // proximidad del latigazo (0..1) para la cara (grito)
    FOW = 1; FEX = 0; LOCO_M = 0; r.lieW = 0; r.cvW0 = r.cvW1 = 0;
    toBodyV(r, b, BL);
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
    // esperas del saque: el peso pasa despacio de una pierna a otra (balanceo de pelvis ±3º, periodo propio de cada jugador)
    if (mode === 'serve' && !serving && g.server !== p) {
      var wsh = Math.sin(r.clock * PI * 2 / (1.55 + 0.29 * r.id) + r.id * 1.7);
      P.s[PR] += 0.052 * wsh; P.s[PX] += 0.03 * wsh; P.s[CR] -= 0.03 * wsh; P.s[DROP] += 0.008 * Math.abs(wsh);
    }
    if (mode === 'serve' && kind === 2 && b.held && b.held.team === 0) {
      // contra el saque humano no hay temporizador: pasan a preparados poco a poco
    }

    // ---- 2. locomoción
    if (!air) {
      var vf = r.vf, vl = r.vl, vs = Math.sqrt(vf * vf + vl * vl);
      var drive = vs;   // girar en el sitio NO es correr: lo resuelven los pies de apoyo (standFeet: pasos de pivote)
      if (drive > 0.25) {
        var dx = vs > 0.05 ? vl / vs : 1, dz = vs > 0.05 ? vf / vs : 0;
        // en la red esperando el ataque rival (postura 3) las manos siguen arriba al desplazarse (paso lateral de bloqueo)
        locomotion(r, P, drive, dx, dz, dt, snap, kind !== 3);
      } else r.mPrev = 0;
    } else r.mPrev = 0;

    // ---- predicción de contacto (VB.Sim.hitWindow: instante y punto ideales del próximo toque)
    var hitAge = tm - r.hitT;
    var recentHit = hitAge >= 0 && hitAge < 0.45;
    var tossing = mode === 'serve' && g.serveState === 'toss' && g.server === p;
    var hw = null;
    if ((job || tossing) && !recentHit) hw = predictHit(g, p, r);
    if (hw) toBodyV(r, hw, CL);
    // contacto previsto del ataque o saque de este equipo (para el paso de reacción, split-step, del rival)
    if (hw && (tossing || (job && (hw.attack || hw.kind === 'spike' || (hw.kind === 'free' && hw.z - p.z > 1.75))))) {
      var tca = contactIn(g, p, hw); if (hw.attack && hw.jumpT === hw.jumpT) tca = Math.max(tca, hw.jumpT + 0.32);
      if (tca > -0.05 && tca < 1.5) { TEAM_TC[p.team] = tm + Math.max(0, tca); TEAM_TS[p.team] = tm; }
    }

    // ---- 2b. carrera de ataque (y del saque en salto): pasos con tiempo fijado hacia atrás desde el despegue previsto
    var apS = approachTime(g, r, hw, tossing, air, tm);

    // ---- 3. aire
    var tj = tm - r.jumpT;
    if (air && tj >= 0 && tj < 1.6) {
      copyP(T2, P);
      var zk = clamp(p.z / 1.05, 0, 1);
      if (r.jumpKind === 'attack') {
        r.guard = true;
        // salto visual algo más alto en el remate (más atlético; no cambia la sim)
        T2.s[HOP] = 0.16 * zk;
        var ha = (r.hitAir && r.hitT >= r.jumpT - 0.02 && hitAge >= 0) ? hitAge : -1, prox = 0, Ct = null;
        if (ha < 0) {
          if (hw && (hw.kind === 'spike' || hw.kind === 'jserve' || hw.kind === 'fserve' || hw.kind === 'free') && hw.d < 1.6) {
            // latigazo de SWING_T hasta el contacto REAL previsto (no el ideal): el armado se mantiene hasta ~0,06 s antes
            prox = clamp(1 - (contactIn(g, p, hw) - 0.004) / SWING_T, 0, 1); Ct = CL;
          } else if (!hw) { // sin predicción: proximidad del balón al punto de golpeo
            var ddx = BL.x + 0.2, ddy = BL.y - 2.3, ddz = BL.z - 0.3, dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            prox = (1 - sstep(0.25, 0.8, dd)) * (b.vz < 1.5 ? 1 : 0.5); Ct = BL;
          }
        } else Ct = r.hitC;
        // contacto bajo para el salto (balón a menos de un brazo estirado sobre los pies): el cuerpo visual
        // baja un poco en vez de golpear con el codo doblado junto a la cabeza (se anticipa con la predicción)
        if (Ct && Ct !== BL) T2.s[HOP] = clamp(Ct.y - 2.12, -0.22, 0.16) * zk;
        r.swP = ha >= 0 ? 0 : prox;
        attackPose(r, T2, tj, prox, ha, Ct);
      } else if (r.jumpKind === 'block') {
        T2.s[HOP] = 0.06 * zk;
        blockPose(r, T2, tj);
      } else airPose(r, T2, r.jumpKind, tj);
      landPrep(T2, p.z, p.vz);
      blendP(P, T2, 1);
    }
    // aterrizaje: amortiguación
    var tl = tm - r.landT, landW = 0;
    if (!air && tl >= 0 && tl < 0.6 && (r.jumpKind === 'attack' || r.jumpKind === 'block' || tl < 0.35)) {
      // amortiguación: sigue la flexión que traía del aire, pico ~0,08 s tras apoyar y vuelta con un pequeño rebote
      var big = r.jumpKind === 'attack' || r.jumpKind === 'block' ? 1 : 0.6;
      var w = tl < 0.07 ? lerp(0.55, 1, tl / 0.07) : 1 - sstep(0.07, 0.48, tl);
      landW = w * big;
      P.s[DROP] += LAND_K * big * w; P.s[PP] += 0.2 * big * w; P.s[CP] += 0.14 * big * w;
      P.v[HL].y -= 0.22 * w; P.v[HR].y -= 0.22 * w;
      if (tl < 0.12) { P.rb = Math.max(P.rb, 26); P.ra = Math.max(P.ra, 20); }
      if (sp < 1) P.s[HOP] += 0.018 * big * Math.sin(clamp((tl - 0.3) / 0.2, 0, 1) * PI);   // rebote de recuperación
    }

    // ---- 3b. paso de reacción (split-step) ante el saque o el ataque rival
    splitStep(g, r, P, air, sp, tm);

    // ---- 4. anticipación del que va al balón
    if (hw && !air && !tossing) {
      var pk = hw.kind, ht = hw.t, hz = hw.z - p.z;
      if (hw.attack && hw.jumpT === hw.jumpT) {
        if (r.apOn) { copyP(T2, P); approachPose(r, T2, apS); blendP(P, T2, r.apW); }
      } else if (ht > -0.05 && hw.d < 2.6) {
        if (pk === 'pass' || (pk === 'free' && hz < 1.75)) {
          var wA = 1 - sstep(0.18, 0.75, ht);
          if (wA > 0) { copyP(T2, P); passPose(r, T2, CL, 0); layerG(P, T2, wA); }
        } else if (pk === 'set') {
          var wS = 1 - sstep(0.25, 0.9, ht);
          // los dos pies se plantan antes del toque (sin colocación «a la pata coja» en plena zancada): el pie en vuelo
          // aterriza con un pasito entre 0,4 y 0,18 s antes y la base queda fija hasta el contacto
          if (wS > 0) { copyP(T2, P); setPose2(r, T2, CL, Math.max(0, ht), -1); layerG(P, T2, wS, sstep(0.4, 0.18, ht) * SET_PLANT); }
        } else if (pk === 'free') {
          // golpe por arriba de pie: armar y soltar el brazo al contacto
          var wF = 1 - sstep(0.25, 0.75, ht), sw = 1 - sstep(0.03, 0.22, ht);
          if (wF > 0) {
            r.guard = true; copyP(T2, P);
            setV(T2.v[HR], -0.3, 1.88, -0.2); setV(T2.v[AR], -1, 0.7, -0.6);
            setV(T2.v[HL], 0.2, 2.1, 0.35); T2.s[CY] = -0.35;
            if (sw > 0) { T2.v[HR].lerp(CL, sw); T2.v[HL].lerp(tV2.set(0.2, 1.6, 0.35), sw); T2.s[CY] = lerp(-0.35, 0.2, sw); T2.ra = 32; }
            blendP(P, T2, wF);
          }
        }
      }
    }
    // ---- 4b. «¡mía!» (PLY-20): el que va a por el balón levanta el brazo izquierdo y mira al balón; el compañero enseña
    // la mano como objetivo de la recepción (saque o balón fácil del rival)
    callGesture(g, r, P, hw, job, air, tm);

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
        // acompañamiento de la plataforma con las piernas (sube ~0,15 m) y luego los brazos se separan y bajan a preparado
        wOut = 1 - sstep(0.34, 0.52, hitAge);
        copyP(T2, P); passPose(r, T2, r.hitC, sstep(0.0, 0.14, hitAge));
        var pd = clamp((hitAge - 0.12) / 0.18, 0, 1);
        if (pd > 0) {
          var pob = 1 + 2.2 * Math.pow(pd - 1, 3) + 1.2 * Math.pow(pd - 1, 2);
          T2.v[HL].lerp(tV3.set(0.24, 0.98, 0.38), pob); T2.v[HR].lerp(tV3.set(-0.24, 0.98, 0.38), pob);
          T2.v[AL].lerp(tV3.set(0.4, -1, -0.25), pd); T2.v[AR].lerp(tV3.set(-0.4, -1, -0.25), pd);
          T2.s[SHR] *= 1 - pd; T2.s[DROP] = lerp(T2.s[DROP], 0.2, pd); T2.s[CP] = lerp(T2.s[CP], 0.2, pd);
          T2.ra = 24;
        }
        layerG(P, T2, wOut);
      } else if (hk === 'set') {
        wOut = 1 - sstep(0.36, 0.55, hitAge);
        copyP(T2, P); setPose2(r, T2, r.hitC, 0, hitAge); layerG(P, T2, wOut, (1 - sstep(0.12, 0.3, hitAge)) * SET_PLANT);
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
      } else if (hk === 'serve' && r.hitShot !== 'jump') {
        // flotante: puñetazo corto (brazo estirado y muñeca firme, sin acompañamiento) y a posición de defensa con las
        // dos manos delante (nunca en la cadera); el pie de atrás da el paso hacia la pista
        var pu = sstep(0.1, 0.42, hitAge), pf = sstep(0.0, 0.07, hitAge), stp = sstep(0.08, 0.34, hitAge);
        if (hitAge < 0.2) r.guard = true;
        copyP(T2, P);
        tV3.set(Math.min(r.hitC.x, -0.1), r.hitC.y - 0.04, r.hitC.z + 0.06 * pf);
        T2.v[HR].copy(tV3).lerp(tV2.set(-0.21, 1.04, 0.42), pu); T2.v[AR].set(-1, lerp(-0.1, -0.7, pu), lerp(-0.4, -0.2, pu));
        T2.s[WRR] = lerp(-0.05, 0.15, pu);
        T2.v[HL].set(lerp(0.06, 0.2, pu), lerp(1.3, 1.04, pu), lerp(0.4, 0.42, pu)); T2.v[AL].set(lerp(0.25, 0.7, pu), -1, lerp(-0.15, -0.3, pu)); T2.s[WRL] = lerp(0.35, 0.1, pu);
        T2.s[CY] = lerp(0.22, 0, pu); T2.s[PY] = lerp(0.12, 0, pu); T2.s[CP] = lerp(0.12, 0.22, pu); T2.s[CR] = 0;
        T2.s[DROP] = lerp(0.05, 0.18, pu); T2.s[PZ] = lerp(0.12, 0, pu); T2.s[LOOK] = 1;
        setV(T2.v[FL], 0.15, ANKLE, lerp(0.47, 0.3, stp)); setV(T2.v[FR], lerp(-0.15, -0.24, stp), ANKLE + 0.07 * Math.sin(PI * stp), lerp(-0.17, 0.12, stp));
        T2.s[FPL] = 0; T2.s[FPR] = 0.25 * (1 - stp); T2.s[FYR] = lerp(-0.4, -0.15, stp);
        T2.ra = lerp(40, 16, pu); T2.rb = 14;
        layerG(P, T2, 1 - sstep(0.5, 0.8, hitAge), 0, true);
      } else if (hk === 'spike' || hk === 'free' || hk === 'serve') {
        var dur = hk === 'serve' ? 0.75 : 0.6;
        if (hitAge < dur) r.guard = true;
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
        if (tip) {
          // dejada: brazo extendido arriba, muñeca que empuja, tronco quieto (sin latigazo)
          var tw = sstep(0.0, 0.25, hitAge);
          T2.s[CP] = lerp(0.05, 0.12, tw); T2.s[CY] = 0.12; T2.s[WRR] = lerp(-0.5, 0.35, tw);
          T2.v[HL].set(0.2, 1.75, 0.35); T2.ra = 20;
        } else if (perfect) {
          // toque perfecto: más cierre de tronco y rotación (gesto más enérgico)
          var pw = sstep(0.0, 0.18, hitAge);
          T2.s[CP] += 0.18 * pw; T2.s[CY] += 0.15 * pw; T2.s[PP] += 0.08 * pw; T2.ra = 46;
        }
        if (hk === 'serve') layerG(P, T2, wOut, 0, true); else blendP(P, T2, wOut);
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
      r.guard = !serving; copyP(T2, P);
      var s2 = T2.s, v2 = T2.v, tt = tossing ? tm - r.tossT : -1;
      s2[DROP] = 0.07; s2[PP] = 0.06; s2[CP] = 0.05; s2[CY] = -0.25; s2[PY] = -0.12; s2[LOOK] = 0.5; s2[PX] = 0; s2[PZ] = 0;
      setV(v2[FL], 0.13, ANKLE, 0.16); setV(v2[FR], -0.15, ANKLE, -0.17);
      setV(v2[KL], 0.4, 0, 1); setV(v2[KR], -0.4, 0, 1);
      s2[FYL] = 0.08; s2[FYR] = -0.4; s2[FPL] = s2[FPR] = 0;
      T2.ra = 12; T2.rb = 10;
      if (serving) {
        // balón en la palma izquierda (anclaje 'hold' en applyPose), antebrazo bajo el balón con el codo junto al costado;
        // la derecha relajada por delante del muslo, lejos del balón. La IA, al ir a lanzar, flexiona un poco las rodillas.
        setV(v2[HL], BL.x + 0.02, BL.y - 0.1, BL.z - 0.02); setV(v2[AL], 0.55, -1, -0.35); s2[WRL] = -0.2;
        setV(v2[HR], -0.235, 0.74, 0.03); setV(v2[AR], -0.15, 0, -1); s2[WRR] = 0.05; // derecha colgando suelta (nunca en la cadera)
        var dip = (!g.demo && !g.autopilot && p.team === 0) ? 0 : (g.serveAuth ? sstep(0.45, 0.08, g.timer) : 0);
        s2[DROP] += 0.07 * dip; s2[CP] += 0.06 * dip; s2[PP] += 0.04 * dip;
        if (r.ritOn) {
          // ritual (PLY-16): tronco inclinado sobre el bote, rodillas que se doblan en cada empujón y amortiguan la recogida,
          // la cabeza sigue al balón; al subirlo a la mano se endereza (y en 'done' mira al campo rival)
          var rph = r.ritPh, ru = r.ritU, lean = rph === 'dribble' ? 1 : rph === 'pre' ? 0.7 : rph === 'post' ? 0.45 : 0;
          var push = rph === 'dribble' ? sstep(0, 0.1, ru) * (1 - sstep(0.18, 0.55, ru)) + 0.5 * sstep(0.78, 0.92, ru) * (1 - sstep(0.92, 1, ru)) : 0;
          s2[DROP] += 0.05 * lean + 0.11 * push; s2[CP] += 0.2 * lean + 0.09 * push; s2[PP] += 0.08 * lean + 0.03 * push;
          v2[KL].z += 0.3 * push; v2[KR].z += 0.3 * push; s2[LOOK] = 1; s2[CY] = lerp(s2[CY], -0.1, lean);
          T2.rb = Math.max(T2.rb, 16);
        }
      } else if (r.tossJump && r.apOn) {
        // saque en salto: carrera de ataque (pasos y brazos) con la izquierda que acaba de lanzar alto el balón
        approachPose(r, T2, apS);
        var upT = sstep(0.0, 0.12, tt) * (1 - sstep(0.22, 0.5, tt));
        if (upT > 0) { v2[HL].lerp(tV3.set(0.16, 2.25, 0.32), upT); v2[AL].lerp(tV3.set(0.6, 0.2, -1), upT); }
        T2.rb = Math.max(T2.rb, 14);
      } else if (r.tossJump) {
        // saque en salto: lanzamiento alto con la izquierda y carrera con brazos atrás antes del despegue
        var toJump = (g.jumpAt || 0.6) - (g.tossT || tt), back = sstep(0.55, 0.1, toJump);
        var up = sstep(0.0, 0.14, tt) * (1 - sstep(0.16, 0.4, tt));
        setV(v2[HL], 0.2, lerp(lerp(1.2, 2.25, up), 0.76, back), lerp(0.3, -0.56, back));
        setV(v2[HR], -0.22, lerp(1.1, 0.76, back), lerp(0.1, -0.56, back));
        setV(v2[AL], 0.6, 0.2, 1); setV(v2[AR], -0.6, 0.2, 1);
        s2[DROP] = lerp(0.12, 0.3, back); s2[PP] = lerp(0.1, 0.3, back); s2[CP] = lerp(0.1, 0.4, back); s2[CY] = 0; s2[PY] = 0; s2[LOOK] = 1;
        T2.ra = 16;
      } else {
        // flotante. Lanzamiento: la palma izquierda empuja el balón hacia arriba y el brazo queda estirado señalándolo;
        // la derecha se arma (codo por encima del hombro, mano junto a la oreja, muñeca atrás) con los hombros abiertos;
        // paso corto del pie izquierdo hacia la red con la cadera que rota hacia el golpe; la mano SUBE hasta el contacto
        // (el anclaje 'palm' la pone detrás del balón en los últimos ANC_PRE s)
        var tcS = hw ? contactIn(g, p, hw) : 0.5;
        var lift = sstep(0.0, 0.14, tt), cock = sstep(0.04, 0.38, tt);
        var sw2 = sstep(0.24, 0.0, tcS), swe = sw2 * sw2 * (3 - 2 * sw2);
        var drop2 = sstep(0.3, 0.08, tcS);                       // la izquierda baja delante del pecho al soltar el golpe
        var step = sstep(0.22, 0.5, tt);
        // la izquierda baja recogida DELANTE del pecho con el codo abajo (no abierta a la cadera)
        setV(v2[HL], lerp(lerp(BL.x, 0.15, lift), 0.06, drop2), lerp(lerp(BL.y, 2.18, lift), 1.3, drop2), lerp(lerp(BL.z, 0.34, lift), 0.4, drop2));
        setV(v2[AL], lerp(1, 0.25, drop2), lerp(-0.3, -1, drop2), lerp(-0.2, -0.15, drop2)); s2[WRL] = lerp(-0.3, 0.35, drop2);
        // derecha: relajada -> armada junto a la oreja -> sube al balón (monótona en altura)
        tV.set(lerp(-0.28, -0.27, cock), lerp(0.98, 1.8, cock), lerp(0.1, -0.12, cock));
        if (swe > 0) { tV3.copy(CL); tV3.y -= 0.1; tV3.z -= 0.08; if (tV3.x > -0.12) tV3.x = -0.12; if (tV3.y < tV.y) tV3.y = tV.y; tV.lerp(tV3, swe); }
        v2[HR].copy(tV);
        setV(v2[AR], -1, lerp(-0.3, 0.6, cock) - 0.5 * swe, lerp(-1, -0.55, cock) + 0.35 * swe); s2[WRR] = lerp(0.1, -0.65, cock) * (1 - swe) - 0.1 * swe;
        s2[CY] = lerp(lerp(-0.25, -0.5, cock), 0.22, swe); s2[PY] = lerp(lerp(-0.12, -0.22, cock), 0.12, swe);
        s2[CP] = lerp(lerp(0.05, -0.1, cock), 0.12, swe); s2[CR] = lerp(0.1 * cock, -0.04, swe); s2[LOOK] = 1;
        s2[DROP] = lerp(0.07, 0.1, cock) - 0.05 * swe;
        v2[FL].z = lerp(0.16, 0.47, step); v2[FL].y = ANKLE + 0.05 * Math.sin(PI * step); s2[FPL] = -0.25 * Math.sin(PI * step);
        s2[PZ] = 0.12 * step; s2[FPR] = 0.25 * swe;                // el peso pasa al pie de delante; talón de atrás arriba
        T2.ra = lerp(18, 40, swe); T2.rb = 14;
      }
      if (tossing || LOCO_M > 0) layerG(P, T2, 1, 0, true); else layerF(P, T2, 1, true);
    }

    // ---- 7. plancha (balón que cae lejos y no se alcanza)
    var dv = tm - r.diveT, dEnd = r.diveEnd + 0.75;
    var diving = diveActive(r, dv);
    if (diving) divePose(r, P, dv);
    else {
      // plancha PREVISTA de la IA: el impulso empieza hasta DIVE_PRE s antes del contacto (progreso = cercanía prevista);
      // si al final no se lanza, la pose vuelve con suavidad
      var pdt = air ? -1 : predictDive(g, r);
      if (pdt >= 0 && pdt <= DIVE_PRE) {
        if (r.pdW <= 0) r.pdT0 = tm;
        r.pdW = Math.max(r.pdW, 1 - pdt / DIVE_PRE); r.pdTp = pdt; r.pdX = PDB.x; r.pdY = PDB.y; r.pdZ = PDB.z; r.pdLive = true;
        r.diveYaw = Math.atan2(PDB.y - p.y, PDB.x - p.x);
      } else { r.pdLive = false; if (r.pdW > 0) r.pdW = Math.max(0, r.pdW - dt * 5); }
      if (r.pdW > 0) {
        var keepUp = r.diveUp, keepDz = r.diveDz, keepUT = r.upDiveT, keepU0 = r.upT0, keepTc = r.diveTc, keepDist = r.diveDist;
        r.diveTc = DIVE_PRE; r.diveDist = diveDistFor(r, Math.sqrt((r.pdX - p.x) * (r.pdX - p.x) + (r.pdY - p.y) * (r.pdY - p.y)), DIVE_PRE);
        copyP(T2, P); divePose(r, T2, DIVE_PRE * r.pdW); layerF(P, T2, r.pdLive ? 1 : r.pdW, true);
        r.diveUp = keepUp; r.diveDz = keepDz; r.upDiveT = keepUT; r.upT0 = keepU0; r.diveTc = keepTc; r.diveDist = keepDist;
      }
    }
    // plancha cosmética (sin evento dive de la sim): polvo al tocar el suelo con el pecho (~0,18 s)
    if (r.cosDust && dv >= 0.18) {
      r.cosDust = false;
      if (dv < 0.5 && VB.FX && VB.FX.dust) { var dd = 0.55 + r.diveDist * r.scale, dcx = Math.cos(r.diveYaw), dcy = Math.sin(r.diveYaw); try { VB.FX.dust(p.x + dcx * dd, p.y + dcy * dd, 16, dcx, dcy); } catch (e) { } }
    }

    // ---- 8. celebración / lamento tras el punto
    var pa = tm - r.pointT;
    if ((mode === 'point' || mode === 'over') && r.pointT > -50 && pa >= 0 && !air && (!diving || (dv > dEnd - 0.3 && r.diveUp > 0.6))) {
      // la celebración (tres tiempos) y, encima, la convergencia (camino, choque de manos, palmadas de ánimo)
      celebrate(g, r, P, diving ? Math.max(0, dv - (dEnd - 0.3)) : pa);
      if (!diving) cvPose(g, r, P);
      // la caída se amortigua aunque ya celebre: el brinco de la celebración no estira las rodillas recién apoyadas
      if (landW > 0) { var lk = clamp(landW * 1.6, 0, 1); P.s[HOP] = lerp(P.s[HOP], Math.min(P.s[HOP], 0), lk); P.s[DROP] = Math.max(P.s[DROP], 0.06 + LAND_K * 1.25 * landW); P.s[PP] = Math.max(P.s[PP], 0.15 * landW); }
    } else r.lkW = 0;
    if (diving) { FOW = 0; FEX = 1; }
    r.locoOwn = air ? 0 : LOCO_M * FOW;
    r.standW = air ? 0 : (1 - r.locoOwn) * (1 - FEX); r.fex = FEX;
    anchorSource(g, r, hw, hitAge);
    jumpSetHop(g, r, hw, air);
  }

  /** «¡Mía!» (PLY-20). Cuando el balón va a este jugador (g.jobs) y el contacto está a 0,8-1,15 s (o en cuanto le toca, si
   *  quedan > 0,8 s), brazo izquierdo ~45º por encima del hombro durante CALL_T s con la cabeza al balón, sobre la
   *  locomoción (solo el brazo). Un aviso por balón (clave: último toque). Emite {type:'call'} por drainFx.
   *  El compañero que no va (cerca de la red) enseña la mano derecha como objetivo mientras llega el balón del rival. */
  var CALL_T = 0.42;
  function callGesture(g, r, P, hw, job, air, tm) {
    var p = r.p, ca = tm - r.callT;
    if (job && hw && !air && !(p.down > 0) && g.mode === 'rally' && (g.touchTeam !== p.team || g.touches === 0) && r.callKey !== g.lastTouchT) {
      var ht = hw.t;
      if (ht > 0.8 && ht <= 1.15) {
        r.callKey = g.lastTouchT; r.callT = tm; ca = 0;
        if (FXQ.length < 32) FXQ.push({ type: 'call', team: p.team, x: p.x + r.offX, y: p.y + r.offY, z: p.z + 1.75 * r.scale, strength: 0.6 });
      }
    }
    if (ca >= 0 && ca < CALL_T && !air) {
      var w = sstep(0, 0.07, ca) * (1 - sstep(CALL_T - 0.09, CALL_T, ca));
      tV3.set(0.5, 1.94, 0.24); P.v[HL].lerp(tV3, w); tV3.set(1, -0.5, -0.3); P.v[AL].lerp(tV3, w);
      P.s[WRL] += (-0.25 - P.s[WRL]) * w; P.s[TWL] += (1.2 - P.s[TWL]) * w; P.s[LOOK] = Math.max(P.s[LOOK], w);
      P.ra = Math.max(P.ra, 22);
      return;
    }
    // compañero: mano derecha arriba como objetivo mientras su compañero recibe (saque / balón fácil del rival)
    var mate = g.jobs && g.jobs[p.team];
    var inbound = g.touchTeam === 1 - p.team && (g.lastKind === 'serve' || g.lastKind === 'free');
    if (!job && mate && mate !== p && !air && g.mode === 'rally' && inbound && Math.abs(p.x) < 3.6) {
      var sd = side(p.team), inc = (g.ball.x - p.x) * sd >= -1 || g.ball.vx * sd > 0;
      var wt = inc ? 1 : 0;
      r.tgtW += (wt - r.tgtW) * 0.12;
    } else r.tgtW *= 0.85;
    if (r.tgtW > 0.02) {
      tV3.set(-0.24, 2.02, 0.26); P.v[HR].lerp(tV3, r.tgtW); tV3.set(-1, -0.3, -0.4); P.v[AR].lerp(tV3, r.tgtW);
      P.s[WRR] += (-0.3 - P.s[WRR]) * r.tgtW; P.s[TWR] += (-1.2 - P.s[TWR]) * r.tgtW;
    }
  }

  /** Carrera de ataque. Devuelve los s que faltan para el despegue previsto (NaN si no hay carrera) y deja el estado en el
   *  rig: r.apOn (activa), r.apS, r.apW (peso de la pose), r.apWarp (desfase visual de la IA). Despegue previsto: IA = la
   *  regla de ai.js (salta cuando pr3.t < 0,47 + aiJt; error medido ~15 ms); humano = hitWindow().jumpT (despegue ideal);
   *  saque en salto = g.jumpAt (fijo desde el lanzamiento). */
  var AP_T = 1.0, AP_SEG = [[0.86, 0.6, 0.1, 0.06, 0, 0.07], [0.58, 0.27, -0.11, 0.22, 0, 0.1], [0.25, 0.07, 0.13, 0.3, -0.38, 0.06]];  // [inicio, plantado, x, z, giro, alto]
  function approachTime(g, r, hw, tossing, air, tm) {
    var p = r.p, tJ = NaN, warp = false;
    if (!air && p.down <= 0) {
      if (tossing && r.tossJump && g.jumpAt > 0 && g.serveState === 'toss') tJ = tm - g.tossT + g.jumpAt;
      else if (g.mode === 'rally' && g.jobs && g.jobs[p.team] === p && (VB.Sim.atkPhase ? VB.Sim.atkPhase(g, p.team) : g.touchTeam === p.team && g.touches === 2) && Math.abs(g.pr3.x) < 3.8 && g.pr3.z > 2.5) { // también tras una colocación en salto en el 1.er toque
        var human = !g.demo && !g.autopilot && p.team === 0 && p === g.ctrl;
        if (human) { if (hw && hw.attack && hw.jumpT === hw.jumpT) tJ = tm + hw.jumpT; }
        else if (p.aiTeT === g.lastTouchT) { tJ = tm + g.pr3.t - 0.47 - (p.aiJt || 0); warp = true; }
      }
    }
    var sNow = tJ - tm;
    if (!(sNow === sNow) || sNow < -0.3 || (!r.apOn && sNow > AP_T)) {
      if (r.apOn) { r.apOn = false; r.apWarp = false; }
      r.apS = NaN; r.apW = 0; return NaN;
    }
    if (!r.apOn) {
      if (tossing && sNow > g.jumpAt - 0.28) { r.apS = NaN; return NaN; }       // saque en salto: primero el lanzamiento
      r.apOn = true; r.apT0 = tm; r.apS0 = sNow; r.apWarp = warp;
      r.apX0 = p.x + r.offX; r.apY0 = p.y + r.offY;
      for (var k = 0; k < 2; k++) { var F = r.fk[k]; F.apX = F.px; F.apY = F.py; F.apYaw = r.yaw + r.cur.s[FYL + k]; F.apSw = -1; F.lock = false; F.sl = false; F.sst = -1; }
    }
    r.apJ = tJ; r.apS = sNow; r.apW = sstep(0, 0.12, tm - r.apT0);
    return sNow;
  }
  /** Perfil de distancia de la carrera (0..1): primer paso corto, penúltimo largo y rápido, cierre algo más lento. */
  function apProf(u) { return u <= 0 ? 0 : u >= 1 ? 1 : (-0.8 * u + 1.5) * u * u + 0.3 * u; }
  /** Desfase visual de la carrera de la IA: la sim llega al sitio del salto a la carrera (5 m/s) y espera parada; el
   *  cuerpo visual recorre ese mismo camino con un perfil de carrera de ataque que termina justo en el despegue. */
  function approachOffset(g, r) {
    if (!r.apOn || !r.apWarp) return false;
    var p = r.p, T = r.apJ - r.apT0, u = T > 0.05 ? clamp((g.time - r.apT0) / T, 0, 1) : 1, k = apProf(u);
    var dx = p.x - r.apX0, dy = p.y - r.apY0;
    if (dx * dx + dy * dy > 16) { r.apWarp = false; return false; }
    r.offX = r.apX0 + dx * k - p.x; r.offY = r.apY0 + dy * k - p.y;
    return true;
  }
  /** Pies de la carrera (mundo): izquierda, DERECHA larga con apoyo de talón (penúltimo), izquierda de cierre algo por
   *  delante y girada hacia dentro; despegue a dos pies. Cada pie plantado queda fijo en el mundo; en el vuelo va de donde
   *  estaba al sitio de plantado previsto (raíz prevista en ese instante + desplazamiento del paso). */
  function approachFeet(r, st) {
    var c = r.cur, sNow = r.apS, sc = r.scale;
    for (var k = 0; k < 2; k++) {
      var F = r.fk[k], fv = c.v[FL + k], seg = -1, i;
      for (i = 0; i < AP_SEG.length; i++) {
        var G = AP_SEG[i]; if ((i === 1) !== (k === 1)) continue;
        var s0 = Math.min(G[0], r.apS0 - 0.02);
        if (G[1] < r.apS0 - 0.08 && sNow <= s0 && sNow > G[1]) seg = i;
      }
      if (seg >= 0) {
        var G2 = AP_SEG[seg], s0b = Math.min(G2[0], r.apS0 - 0.02), u = clamp((s0b - sNow) / Math.max(0.05, s0b - G2[1]), 0, 1);
        if (F.apSw !== seg) { F.apSw = seg; F.a0x = F.apX; F.a0y = F.apY; F.a0yaw = F.apYaw; }
        var dtp = sNow - G2[1];
        toBody(r, F.a0x, F.a0y, r.p.z, tV); tV.x -= st[OX]; tV.z -= st[OZ];
        var tx = G2[2] + r.vl * dtp / sc, tz = G2[3] + r.vf * dtp / sc, e = u * u * (3 - 2 * u);
        fv.x = lerp(tV.x, tx, e); fv.z = lerp(tV.z, tz, e);
        fv.y = ANKLE + G2[5] * Math.sqrt(Math.sin(PI * u)) + (seg ? 0.03 * sstep(0.7, 1, u) : 0);   // talón primero
        st[FYL + k] = lerp(clamp(wrapA(F.a0yaw - r.yaw), -1, 1), G2[4], e);
        st[FPL + k] = -0.45 * Math.sin(PI * u) * (1 - u) - (seg ? 0.4 * sstep(0.6, 1, u) : 0);
        bodyToSim(r, fv.x + st[OX], fv.z + st[OZ], tV2); F.apX = tV2.x; F.apY = tV2.y; F.apYaw = r.yaw + st[FYL + k];
      } else {
        if (F.apSw >= 0) F.apSw = -1;
        toBody(r, F.apX, F.apY, r.p.z, tV); tV.x -= st[OX]; tV.z -= st[OZ];
        fv.x = tV.x; fv.z = tV.z; fv.y = ANKLE; st[FYL + k] = clamp(wrapA(F.apYaw - r.yaw), -1, 1);
        // del talón a la planta en 0,08 s tras plantar; en el impulso, talones arriba
        var lastEnd = k ? AP_SEG[1][1] : (sNow <= AP_SEG[2][1] ? AP_SEG[2][1] : AP_SEG[0][1]);
        st[FPL + k] = sNow < lastEnd ? -0.4 * (1 - sstep(lastEnd, lastEnd - 0.08, sNow)) : 0;
        if (sNow < 0.02) st[FPL + k] = 0.35 * sstep(0.02, -0.04, sNow);
      }
      F.lock = false; F.sl = false; F.sst = -1;
      footSave(r, F, fv, st);
    }
  }
  /** Brazos y tronco de la carrera: brazos en contrafase en los primeros pasos, en el penúltimo los dos brazos atrás
   *  (manos por detrás de la cadera) con el tronco inclinado ~35º, en el cierre las rodillas bajan ~0,25 m y los brazos
   *  vienen por delante y arriba hacia el despegue. s = s hasta el despegue. */
  function approachPose(r, P, s) {
    var S = P.s, v = P.v;
    var back = sstep(0.62, 0.3, s), fwd = sstep(0.18, -0.02, s), pit = sstep(0.75, 0.38, s) * (1 - sstep(0.12, -0.02, s));
    var crouch = sstep(0.32, 0.08, s) * (1 - 0.6 * sstep(0.05, -0.03, s));
    tV3.set(0.21, lerp(0.95, 0.8, back), lerp(0.15, -0.5, back));
    v[HL].lerp(tV3, back * (1 - fwd)); tV3.x = -0.21; v[HR].lerp(tV3, back * (1 - fwd));
    if (fwd > 0) { v[HL].lerp(tV3.set(0.22, 1.35, 0.32), fwd); v[HR].lerp(tV3.set(-0.22, 1.3, 0.3), fwd); }
    v[AL].lerp(tV3.set(0.5, 0.3, 1), back * (1 - fwd)); v[AR].lerp(tV3.set(-0.5, 0.3, 1), back * (1 - fwd));
    if (fwd > 0) { v[AL].lerp(tV3.set(1, -0.5, -0.4), fwd); v[AR].lerp(tV3.set(-1, -0.5, -0.4), fwd); }
    S[PP] = lerp(S[PP], 0.2, pit); S[CP] = lerp(S[CP], 0.44, pit); S[HP] = lerp(S[HP], -0.45, pit);
    S[DROP] = lerp(S[DROP], 0.36, crouch); S[CY] = lerp(S[CY], -0.18, crouch); S[PY] = lerp(S[PY], -0.1, crouch);
    S[PX] = 0; S[PZ] = lerp(S[PZ], -0.06, crouch);
    S[WRL] = S[WRR] = lerp(0, -0.4, back);
    P.ra = Math.max(P.ra, 22); P.rb = Math.max(P.rb, 18);
  }
  /** Paso de reacción: los que esperan el saque o el ataque rival dan un saltito de 4-6 cm que aterriza justo después
   *  del golpe rival (contacto + 0,08 s): flexión previa, vuelo con los pies que se abren 10 cm, caída con las rodillas
   *  dobladas y los brazos delante (listos para la plataforma). Sin contacto previsto (golpe imprevisto del humano), el
   *  saltito sale en el mismo golpe. Solo visual. */
  var TEAM_TC = [-99, -99], TEAM_TS = [-99, -99], SS_UP = 0.14, SS_DN = 0.08, SS_H = 0.05;
  function splitStep(g, r, P, air, sp, tm) {
    var p = r.p, opp = 1 - p.team, mode = g.mode;
    r.ssAir = false;
    if (air || p.down > 0 || r.lieW > 0 || (mode !== 'rally' && mode !== 'serve')) { if (air) r.ssT = -99; return; }
    if (tm - r.ssT > SS_DN + 0.35) {
      // programar: contacto rival previsto (actualizado en este frame o el anterior) a menos de 0,3 s
      var oppAtk = mode === 'serve' ? (g.serving === opp && g.serveState === 'toss') : (g.touchTeam === opp && g.touches >= 1);
      if (oppAtk && tm - TEAM_TS[opp] < 0.05 && TEAM_TC[opp] - tm < SS_UP + 0.16 && TEAM_TC[opp] - tm > SS_UP - 0.04 && tm - r.ssLast > 0.6) {
        r.ssT = TEAM_TC[opp]; r.ssLast = tm; r.ssK = sp > 3.2 ? 0.6 : 1;
      }
    }
    var u = tm - r.ssT;
    if (u < -SS_UP - 0.12 || u > SS_DN + 0.32) return;
    var s = P.s, v = P.v, k = r.ssK;
    var pre = sstep(-SS_UP - 0.12, -SS_UP - 0.02, u) * (1 - sstep(-SS_UP - 0.02, -SS_UP + 0.03, u));
    var fl = (u + SS_UP) / (SS_UP + SS_DN), hop = fl > 0 && fl < 1 ? SS_H * k * 4 * fl * (1 - fl) : 0;   // parábola
    var land = u > SS_DN - 0.02 ? Math.exp(-Math.pow((u - SS_DN - 0.05) / 0.09, 2)) : 0;
    var ready = sstep(-SS_UP - 0.1, -SS_UP + 0.05, u) * (1 - sstep(SS_DN + 0.15, SS_DN + 0.32, u));
    s[HOP] += hop; s[DROP] += 0.045 * pre * k + 0.075 * land * k; s[PP] += 0.06 * land; s[CP] += 0.05 * ready;
    r.ssAir = hop > 0.004;
    // pies 5 cm más abiertos cada uno (se reajustan en el vuelo)
    var wide = sstep(-SS_UP, SS_DN, u) * (1 - sstep(SS_DN + 0.15, SS_DN + 0.32, u)) * 0.05;
    v[FL].x += wide; v[FR].x -= wide;
    if (hop > 0) { v[FL].y = Math.max(v[FL].y, ANKLE + hop * 0.4); v[FR].y = Math.max(v[FR].y, ANKLE + hop * 0.4); }
    // brazos delante, listos
    v[HL].lerp(tV3.set(0.2, 0.98, 0.42), 0.8 * ready); v[HR].lerp(tV3.set(-0.2, 0.98, 0.42), 0.8 * ready);
    v[AL].lerp(tV3.set(0.5, -1, -0.2), 0.8 * ready); v[AR].lerp(tV3.set(-0.5, -1, -0.2), 0.8 * ready);
    if (hop > 0 || land > 0.2) { P.rb = Math.max(P.rb, 22); P.ra = Math.max(P.ra, 18); }
  }
  /** Plancha en curso: la ventana dura hasta que se ha levantado del todo (diveUp = 1). */
  function diveActive(r, dv) { return dv >= 0 && dv < 5 && (dv < r.diveEnd + 0.75 || r.diveUp < 0.999); }
  function divePose(r, P, t) {
    var s = P.s, v = P.v, L = r.diveTc;
    // Tiempos relativos al CONTACTO (t = L): con plancha prevista (IA) el impulso empieza ~0,15 s antes y en el contacto el
    // cuerpo va estirado en un ~70-80 % con las manos bajo el balón (anclaje 'dive'); vuela ~0,1 s, cae de pecho y se desliza
    // 0,3-0,5 m frenando; tumbado con el pecho y la cabeza levantados mirando el balón; se levanta antes de que la sim lo suelte.
    var go = sstep(0.0, L + 0.07, t), lie = sstep(L + 0.02, L + 0.16, t);
    var fly = sstep(L * 0.4, L + 0.04, t) * (1 - sstep(L + 0.1, L + 0.22, t));          // fase en el aire
    var sx = clamp((t - L - 0.14) / 0.36, 0, 1), slideE = 1 - (1 - sx) * (1 - sx);       // deslizamiento que frena
    // levantarse: empieza 0,3 s antes de que la sim lo suelte (p.down) y dura GET_T; el inicio se congela la primera vez
    var upStart = r.p.down > 0.04 ? Math.max(L + 0.38, t + r.p.down - 0.35) : L + 0.38 - r.upBoost;
    if (r.upDiveT !== r.diveT) { r.upDiveT = r.diveT; r.upT0 = -1; }
    if (r.upT0 < 0 && t >= upStart && t > L + 0.35) r.upT0 = t;
    var gu = r.upT0 < 0 ? 0 : clamp((t - r.upT0) / GET_T, 0, 1), up = sstep(0, 1, gu);
    if (gu > 0 && !DB) { DB = new Pose(); GK = new Pose(); }
    if (gu > 0) copyP(DB, P);                                            // pose de pie (base) a la que llega
    // el avance del cuerpo (Dz) pasa del cuerpo a la raíz mientras se levanta (r.offX/offY en diveOffset): se
    // incorpora DONDE ha caído, sin deslizarse hacia atrás hasta la posición de la sim
    var Dz = r.diveDist * go + DIVE_SLIDE * slideE;
    r.diveUp = up; r.diveDz = Dz; r.lieW = lie * (1 - sstep(0.45, 1, up));
    s[OZ] = Dz * (1 - up); s[OX] = 0;
    s[LOOK] = 1 - lie * 0.25;
    // tumbado: pelvis casi horizontal y el pecho ARQUEADO hacia arriba (cabeza alta, mirando el balón), cadera girada un poco
    var roll = 0.12 * lie * (1 - up) * Math.sin(PI * clamp((t - L - 0.12) / 0.5, 0, 1));
    s[PP] = lerp(0.9 * go, 2.4, lie); s[CP] = lerp(0.75 * go, -1.2, lie) - 0.1 * fly; s[CY] = 0; s[PY] = 0; s[PR] = roll;
    s[DROP] = lerp(0.42 * go, 0.84, lie) - 0.27 * fly; s[HP] = -0.55 * lie;
    s[PZ] = 0.1 * lie;
    // brazos estirados hacia el balón (manos planas: "pancake"); tumbado, codos apoyados y manos delante (activas)
    var hy = lerp(0.7, 0.22, lie) + 0.27 * fly, hz = lerp(0.95, 1.25, lie) + 0.12 * fly;
    setV(v[HL], 0.2, hy + 0.03 * fly, hz - 0.08 * fly); setV(v[HR], -0.14, hy - 0.02 * fly, hz + 0.06 * fly);
    setV(v[AL], 1, -0.8 * lie, 0); setV(v[AR], -1, -0.8 * lie, 0);
    s[WRL] = s[WRR] = -0.9 * fly * (1 - up); s[TWR] = 0;
    // piernas: zancada de impulso y luego estiradas detrás (en el aire, algo levantadas)
    setV(v[FL], 0.18, ANKLE + 0.02 * lie + 0.2 * fly, lerp(0.55 * go, -0.92, lie)); setV(v[FR], -0.2, ANKLE + 0.04 * lie + 0.26 * fly, lerp(-0.3, -0.97, lie));
    setV(v[KL], 0.1, -lie, 1 - lie); setV(v[KR], -0.1, -lie, 1 - lie);
    s[FPL] = s[FPR] = 1.3 * lie;
    P.ra = t < L + 0.3 ? 45 : 18; P.rb = t < L + 0.3 ? 42 : 14;
    if (gu > 0) getUp(P, gu);
  }
  var DIVE_SLIDE = 0.38, DIVE_PRE = 0.15;
  /** Avance del cuerpo (espacio cuerpo) para que las manos lleguen a un balón a bd m (horizontal) en el contacto t = L. */
  function diveDistFor(r, bd, L) { var go = sstep(0, L + 0.07, L); return clamp(bd / r.scale - 0.92, 0, 1.6) / Math.max(go, 0.35); }
  /** ¿Va a lanzarse la IA en plancha en los próximos 0,2 s? Repite sus condiciones (ai.js) sobre el balón y el jugador
   *  extrapolados. Devuelve los s hasta la plancha o -1. Sin asignaciones (escribe el balón previsto en PDB). */
  var PDB = { x: 0, y: 0, z: 0 };
  function predictDive(g, r) {
    var p = r.p, b = g.ball, t0 = p.team;
    if (g.mode !== 'rally' || b.held || p.z > 0 || p.vz > 0 || p.down > 0) return -1;
    if (!g.jobs || g.jobs[t0] !== p) return -1;
    if (!g.demo && !g.autopilot && t0 === 0 && p === g.ctrl) return -1;   // el humano decide cuándo: imprevisible
    if (g.lastKind === 'serve' && g.touchTeam === t0) return -1;
    if (g.touchTeam === t0 && g.lastPlayer === p) return -1;
    var pr = g.prof && g.prof[t0], react = pr ? pr.react : 0.15, beaten = !g.digOk, G = C.G + (b.dip || 0), sd = side(t0);
    for (var t = 0; t <= 0.2; t += 1 / 120) {
      var z = b.z + b.vz * t - 0.5 * G * t * t;
      if (z < 0.08) return -1;
      if (b.vz - G * t >= 0 || g.time + t - g.lastTouchT <= react) continue;
      var x = b.x + b.vx * t, y = b.y + b.vy * t, dx = x - p.x - p.vx * t, dy = y - p.y - p.vy * t, d = Math.sqrt(dx * dx + dy * dy);
      if (x * sd <= 0.2 || z > 1.3) continue;
      if (d <= C.REACH) return -1;                                   // la alcanza de pie: toque normal
      if (d > C.REACH + C.DIVE) continue;
      if (beaten ? (z < 0.55 && p.aiDv < 0.75) : z < 0.95) { PDB.x = x; PDB.y = y; PDB.z = z; return t; }
    }
    return -1;
  }
  /** Levantarse de la plancha (gu 0..1 en GET_T s): tumbado → flexión con los brazos (pecho arriba, manos bajo los
   *  hombros, rodillas al suelo) → rodilla izquierda delante (zancada con la derecha apoyada, mano en la rodilla) →
   *  de pie (la pose base). P llega con la pose de tumbado; DB tiene la pose base. */
  var GET_T = 0.45, DB = null, GK = null;
  function getUp(P, gu) {
    var s, v;
    if (gu < 0.38) {
      copyP(GK, P); s = GK.s; v = GK.v;
      s[PP] = 1.75; s[CP] = -0.72; s[DROP] = 0.7; s[HP] = -0.45; s[PZ] = 0.04; s[LOOK] = 0.7; s[WRL] = s[WRR] = -0.9; s[TWR] = 0;
      setV(v[HL], 0.21, 0.07, 0.5); setV(v[HR], -0.21, 0.07, 0.5); setV(v[AL], 0.6, 0.2, -1); setV(v[AR], -0.6, 0.2, -1);
      setV(v[FL], 0.15, ANKLE + 0.05, -0.62); setV(v[FR], -0.16, ANKLE + 0.05, -0.66);
      setV(v[KL], 0.1, -1, 0.2); setV(v[KR], -0.1, -1, 0.2); s[FPL] = s[FPR] = 1.3;
      GK.ra = 22; GK.rb = 18;
      blendP(P, GK, sstep(0, 0.38, gu));
      return;
    }
    if (gu < 0.72) {
      // la flexión de partida
      s = P.s; v = P.v;
      s[PP] = 1.75; s[CP] = -0.72; s[DROP] = 0.7; s[HP] = -0.45; s[PZ] = 0.04; s[LOOK] = 0.7; s[WRL] = s[WRR] = -0.9; s[TWR] = 0;
      setV(v[HL], 0.21, 0.07, 0.5); setV(v[HR], -0.21, 0.07, 0.5); setV(v[AL], 0.6, 0.2, -1); setV(v[AR], -0.6, 0.2, -1);
      setV(v[FL], 0.15, ANKLE + 0.05, -0.62); setV(v[FR], -0.16, ANKLE + 0.05, -0.66);
      setV(v[KL], 0.1, -1, 0.2); setV(v[KR], -0.1, -1, 0.2); s[FPL] = s[FPR] = 1.3;
      lunge(GK, P);
      blendP(P, GK, sstep(0.38, 0.72, gu));
      return;
    }
    lunge(P, P);
    blendP(P, DB, sstep(0.72, 1, gu));
  }
  /** Zancada de rodillas: pie izquierdo delante plantado, rodilla derecha casi en el suelo, mano izquierda en la rodilla. */
  function lunge(o, from) {
    if (o !== from) copyP(o, from);
    var s = o.s, v = o.v;
    s[PP] = 0.45; s[CP] = 0.2; s[DROP] = 0.42; s[HP] = -0.2; s[PZ] = 0.02; s[LOOK] = 0.85; s[WRL] = s[WRR] = 0; s[OX] = 0;
    setV(v[HL], 0.16, 0.62, 0.4); setV(v[HR], -0.26, 0.42, 0.22); setV(v[AL], 1, -0.3, -0.3); setV(v[AR], -1, -0.5, -0.2);
    setV(v[FL], 0.15, ANKLE, 0.36); setV(v[FR], -0.16, ANKLE + 0.04, -0.5);
    setV(v[KL], 0.1, 0.3, 1); setV(v[KR], -0.1, -1, 0.15); s[FPL] = 0; s[FPR] = 1.0;
    o.ra = 20; o.rb = 16;
  }

  /** Celebraciones y lamentos en tres tiempos (PLY-14): REACCIÓN (0-0,42 s: puño, salto, rugido…) → GESTO SOCIAL
   *  (0,42-1,3 s: ir al compañero y chocar —convergencia—, señalar al colocador tras un remate, puño a la grada tras un
   *  ace…) → RECUPERACIÓN (aplaudiendo o resoplando). La variante (r.celV) se elige en el punto según el contexto
   *  (cómo se ganó, peloteo largo, set, remontada) sin repetir la del punto anterior del mismo jugador. Cada tiempo tiene
   *  un punto de mirada (r.lk*). La pareja que pierde mira el bote o la antena y luego anima al compañero. */
  var CB1 = 0.42, CB2 = 1.3;
  var CEL_ALT = { vamos: 'vArms', vArms: 'vamos', kill: 'vamos', mateCheer: 'vArms', ace: 'vArms', roar: 'vamos', bigV: 'vamos', comeback: 'vArms',
    tiredWin: 'vamos', tiredLose: 'lookSpot', headHands: 'shake', shake: 'lookSpot', lookSpot: 'shake', lookAntenna: 'shake', clapUp: 'lookSpot' };
  function pickCeleb(g, r, e, scorer) {
    var p = r.p, won = e.team === p.team, seq = (e.score ? e.score[0] + e.score[1] : 0) + r.id, v;
    var long = (e.rallyHits || 0) >= 10;
    if (won) {
      if (scorer === r) {
        if (e.how === 'block' && r === lastBlocker) v = 'roar';
        else if (e.how === 'ace' && g.server === p) v = 'ace';
        else if (e.setWon) v = 'bigV';
        else if (e.savedSetPoint || (e.streak || 0) >= 4) v = 'comeback';
        else if (long) v = 'tiredWin';
        else if (e.how === 'kill' || e.how === 'tip') v = 'kill';
        else v = seq % 2 ? 'vamos' : 'vArms';
      } else {
        if (e.setWon) v = 'bigV';
        else if (long) v = 'tiredWin';
        else if (e.how === 'kill' || e.how === 'tip' || e.how === 'ace') v = 'mateCheer';
        else v = ['vamos', 'mateCheer', 'vArms'][seq % 3];
      }
    } else {
      if (long) v = 'tiredLose';
      else if (e.player === p) v = seq % 2 ? 'headHands' : 'shake';
      else if (e.reason === 'antenna') v = 'lookAntenna';
      else v = seq % 2 ? 'lookSpot' : 'shake';
    }
    if (v === r.lastCel) v = CEL_ALT[v] || v;
    return v;
  }
  /** Mirada de la celebración: punto de la sim (x, y, z) con peso w. */
  function look(r, x, y, z, w) { r.lkX = x; r.lkY = y; r.lkZ = z; r.lkW = w; }
  /** Mano derecha (o izquierda con k = 0) señalando un punto de la sim: brazo casi estirado desde el hombro. */
  function pointAt(r, P, k, x, y, z, w) {
    var s = P.s; shoulderC(s);
    toBody(r, x, y, z, tV2);
    var sx = (k ? -1 : 1) * SH_X, dx = tV2.x - sx, dy = tV2.y - SHY, dz = tV2.z - SHZ, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dy = Math.max(dy / l, -0.1); dz = Math.max(dz / l, 0.35); dx = dx / l; l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var L = ARM_R * 0.94 / l;
    P.v[HL + k].lerp(tV2.set(sx + dx * L, SHY + dy * L, SHZ + dz * L), w);
    P.v[AL + k].lerp(tV2.set(k ? -1 : 1, -0.6, -0.2), w); s[WRL + k] = lerp(s[WRL + k], 0.1, w);
  }
  /** Aplauso delante del pecho a f Hz (manos que se juntan y se separan). */
  function clapHands(P, t, f, y, w) {
    var sep = 0.035 + 0.15 * (0.5 + 0.5 * Math.cos(t * f * PI * 2));
    P.v[HL].lerp(tV2.set(sep, y, 0.36), w); P.v[HR].lerp(tV2.set(-sep, y, 0.36), w);
    P.v[AL].lerp(tV2.set(0.7, -1, -0.3), w); P.v[AR].lerp(tV2.set(-0.7, -1, -0.3), w);
    P.s[WRL] = lerp(P.s[WRL], 0.2, w); P.s[WRR] = lerp(P.s[WRR], 0.2, w); P.s[TWL] = lerp(P.s[TWL], 1.2, w); P.s[TWR] = lerp(P.s[TWR], -1.2, w);
  }
  function fistPump(s2, v2, t, n) {
    var ph = t * 2.6, pump = ph < n ? sstep(0, 0.35, ph - Math.floor(ph)) : 1;
    s2[DROP] = lerp(0.1, 0.26, pump); s2[PP] = lerp(0.05, 0.2, pump); s2[CP] = lerp(0.0, 0.3, pump); s2[CY] = lerp(0, -0.3, pump); s2[HP] = -0.25;
    setV(v2[HR], lerp(-0.3, -0.24, pump), lerp(1.95, 1.18, pump), lerp(0.22, 0.1, pump)); setV(v2[AR], -0.6, -1, -0.5);
    setV(v2[HL], 0.26, lerp(1.05, 0.95, pump), lerp(0.2, 0.3, pump)); setV(v2[AL], 0.6, -1, -0.3);
    v2[FL].x = 0.28; v2[FR].x = -0.28; s2[WRR] = 0.6;
  }
  function vArms(s2, v2, t, hopN) {
    var hp = Math.abs(Math.sin(t * 7)) * 0.13 * (t * 7 < PI * hopN ? 1 : 0);
    s2[HOP] = hp; s2[CP] = -0.12; s2[HP] = -0.35;
    setV(v2[HL], 0.48, 2.15, 0.12); setV(v2[HR], -0.48, 2.15, 0.12); setV(v2[AL], 1, 0, -0.4); setV(v2[AR], -1, 0, -0.4);
    s2[WRL] = s2[WRR] = 0.6;
  }
  function kneesHeave(s2, v2, t) {
    var hv = Math.sin(t * PI * 2 * 2.0) * 0.5 + 0.5;                    // respiración agitada ~2 Hz
    s2[DROP] = 0.27; s2[PP] = 0.42; s2[CP] = 0.42 - 0.07 * hv; s2[HP] = -0.25; s2[SHR] = 0.25 * hv;
    setV(v2[HL], 0.17, 0.6, 0.29); setV(v2[HR], -0.17, 0.6, 0.27); setV(v2[AL], 1, 0, -0.4); setV(v2[AR], -1, 0, -0.4);
    v2[FL].x = 0.26; v2[FR].x = -0.26;
  }
  function celebrate(g, r, P, t) {
    var c = r.celV || 'vamos', ramp = sstep(0.0, 0.12, t);
    copyP(T2, P);
    var s2 = T2.s, v2 = T2.v, p = r.p;
    var mate = byId[mateOf(g, p).id], mx = mate ? mate.p.x + mate.offX : p.x, my = mate ? mate.p.y + mate.offY : p.y;
    var cv = CVP[r.team], conv = !!(cv && cv.on && cv.ts >= 0 && !cv.solo && r.pointWin);
    var walker = conv && cv.scorer !== r.id;                               // el que va hacia el otro (el héroe se queda)
    var b1 = sstep(CB1 - 0.08, CB1 + 0.08, t), b2 = sstep(CB2 - 0.1, CB2 + 0.1, t);
    var crowdY = (p.y >= 0 ? 1 : -1) * 13, crowdX = p.x * 1.15;
    r.lkW = 0;
    if (r.matchEnd) { matchCeleb(g, r, T2, t); T2.ra = 10; T2.rb = 8; layerF(P, T2, ramp); return; }
    s2[LOOK] = 0.2;
    if (c === 'roar') {
      var roar = sstep(0.15, 0.45, t), sh = Math.sin(t * 18) * 0.03 * roar * (1 - sstep(1.2, 1.6, t));
      s2[DROP] = lerp(0.22, 0.14, roar); s2[PP] = lerp(0.25, -0.05, roar); s2[CP] = lerp(0.35, -0.22, roar) + sh; s2[HP] = -0.45 * roar; s2[LOOK] = 0;
      setV(v2[HL], lerp(0.3, 0.62, roar), lerp(1.1, 1.55, roar) + sh, lerp(0.25, 0.12, roar)); setV(v2[HR], lerp(-0.3, -0.62, roar), lerp(1.1, 1.55, roar) + sh, lerp(0.25, 0.12, roar));
      setV(v2[AL], 0.3, -1, -0.4); setV(v2[AR], -0.3, -1, -0.4); s2[WRL] = s2[WRR] = 0.9;
      v2[FL].x = 0.3; v2[FR].x = -0.3; s2[FYL] = 0.3; s2[FYR] = -0.3;
      look(r, p.x * 0.3, p.y, 2.6, 0.8 * (1 - b2));                        // a la red, al rival
    } else if (c === 'ace') {
      if (t < CB1 + 0.1) { var hpA = Math.sin(clamp(t / 0.38, 0, 1) * PI) * 0.14; s2[HOP] = hpA; setV(v2[HL], 0.3, 1.2, 0.2); setV(v2[HR], -0.3, 1.2, 0.2); s2[CP] = 0.15; s2[WRL] = s2[WRR] = 0.9; }
      else { pointAt(r, T2, 1, crowdX, crowdY, 6, 1); setV(v2[HL], 0.24, 1.05, 0.25); s2[CP] = -0.1; s2[WRR] = 0.9; s2[HP] = -0.2; }
      look(r, crowdX, crowdY, 4, b1 * (1 - b2));
    } else if (c === 'kill') {
      if (t < CB1) { fistPump(s2, v2, t, 1); s2[HOP] = Math.sin(clamp(t / 0.32, 0, 1) * PI) * 0.1; }
      else if (!conv) { pointAt(r, T2, 1, mx, my, 1.4 * r.scale, 1); s2[CP] = 0.02; setV(v2[HL], 0.22, 1.05, 0.25); }
      else if (!walker) fistPump(s2, v2, t - CB1 + 0.39, 3);              // el héroe espera al compañero gritando
      look(r, mx, my, 1.6, b1 * (1 - b2 * 0.5));
    } else if (c === 'mateCheer') {
      clapHands(T2, t, 2.4, 2.05, 1 - b1); s2[CP] = -0.08;
      if (!conv && b1 > 0) { pointAt(r, T2, 1, mx, my, 1.4 * r.scale, b1); pointAt(r, T2, 0, mx, my, 1.4 * r.scale, b1); }
      look(r, mx, my, 1.6, 0.9);
    } else if (c === 'bigV') {
      vArms(s2, v2, t, 4); look(r, crowdX, crowdY, 5, b1);
    } else if (c === 'comeback') {
      // doble puño "bíceps" con los codos abiertos, agachado y rugiendo; luego puño al pecho mirando a la grada
      var fl = sstep(0.05, 0.3, t);
      s2[DROP] = 0.24 * fl; s2[PP] = 0.2 * fl; s2[CP] = -0.18 * fl; s2[HP] = -0.4 * fl;
      setV(v2[HL], 0.42, 1.58, 0.05); setV(v2[HR], -0.42, 1.58, 0.05); setV(v2[AL], 1, -0.6, -0.2); setV(v2[AR], -1, -0.6, -0.2); s2[WRL] = s2[WRR] = 0.9;
      v2[FL].x = 0.3; v2[FR].x = -0.3;
      if (b1 > 0 && !conv) { var beat = Math.max(0, Math.sin((t - CB1) * PI * 2 * 1.8)); v2[HR].lerp(tV2.set(-0.05, 1.42 + 0.03 * beat, 0.2 + 0.06 * beat), b1); }
      look(r, crowdX, crowdY, 4, b1);
    } else if (c === 'tiredWin') {
      if (t < CB1) fistPump(s2, v2, t, 1); else kneesHeave(s2, v2, t);
      look(r, mx, my, 1.4, 0.6 * b1);
    } else if (c === 'tiredLose') {
      kneesHeave(s2, v2, t); look(r, mx, my, 1.2, 0.5 * b2);
    } else if (c === 'headHands') {
      var hh = 1 - b2;
      s2[DROP] = 0.03; s2[CP] = -0.08; s2[HP] = -0.35;
      setV(v2[HL], 0.1, 1.86, -0.04); setV(v2[HR], -0.1, 1.86, -0.04); setV(v2[AL], 1, 0.3, 0.2); setV(v2[AR], -1, 0.3, 0.2); s2[WRL] = s2[WRR] = 0.6;
      if (hh < 1) { v2[HL].lerp(tV2.set(0.24, 0.92, 0.12), 1 - hh); v2[HR].lerp(tV2.set(-0.24, 0.92, 0.12), 1 - hh); }
      look(r, mx, my, 1.5, b2);
    } else if (c === 'shake' || c === 'lookSpot' || c === 'lookAntenna' || c === 'clapUp') {
      // mira el bote (o la antena), niega con la cabeza / abre las palmas; luego busca al compañero
      var L = g.lastLand, lx = L ? L.x : p.x - side(p.team) * 2, ly = L ? L.y : p.y, lz = 0;
      if (c === 'lookAntenna' && g.antennaHit) { lx = g.antennaHit.x; ly = g.antennaHit.y; lz = g.antennaHit.z; }
      s2[DROP] = 0.06; s2[CP] = 0.12; s2[PP] = 0.04;
      setV(v2[HL], 0.27, 0.95, 0.12); setV(v2[HR], -0.27, 0.95, 0.12); setV(v2[AL], 1, 0.2, -0.3); setV(v2[AR], -1, 0.2, -0.3);
      if (c === 'shake') s2[HY] = Math.sin(t * PI * 2 * 2.6) * 0.32 * sstep(0.2, 0.4, t) * (1 - sstep(1.0, 1.3, t));
      if (c === 'lookSpot' || c === 'lookAntenna') { var sg = sstep(0.35, 0.6, t) * (1 - sstep(1.1, 1.4, t)); v2[HL].lerp(tV2.set(0.36, 1.08, 0.3), sg); v2[HR].lerp(tV2.set(-0.36, 1.08, 0.3), sg); s2[TWL] = 1.2 * sg; s2[TWR] = -1.2 * sg; s2[SHR] = 0.5 * sg; }
      look(r, lx, ly, lz, 1 - b2);
      if (b2 > 0) { look(r, mx, my, 1.5, b2); if (c !== 'clapUp') clapHands(T2, t, 2.2, 1.2, b2 * (1 - sstep(2.0, 2.3, t))); }
    } else if (c === 'vArms') {
      if (t < CB1 + 0.3) vArms(s2, v2, t, 2);
      look(r, mx, my, 1.6, b1);
    } else {                                                               // vamos
      fistPump(s2, v2, t, 2);
      look(r, mx, my, 1.6, b1);
    }
    // recuperación de los que ganan: vuelven aplaudiendo (si no es la convergencia la que manda en ese momento)
    if (r.pointWin && b2 > 0 && c !== 'tiredWin') { clapHands(T2, t, 2.2, 1.22, b2 * (1 - sstep(2.2, 2.6, t))); s2[DROP] = lerp(s2[DROP], 0.08, b2); s2[CP] = lerp(s2[CP], 0.06, b2); s2[PP] = lerp(s2[PP], 0.04, b2); s2[HOP] *= 1 - b2; }
    // la convergencia (camino y choque) manda en el gesto social: brazos libres, puño cerrado
    if (walker && t > CB1 * 0.7 && t < CB2) { var cw = sstep(CB1 * 0.7, CB1, t); s2[HOP] *= 1 - cw; s2[DROP] = lerp(s2[DROP], 0.06, cw); s2[CP] = lerp(s2[CP], -0.04, cw); v2[HR].lerp(tV2.set(-0.24, 1.0, 0.22), cw); v2[HL].lerp(tV2.set(0.24, 1.0, 0.22), cw); }
    T2.ra = t < CB1 + 0.1 ? 20 : 11; T2.rb = t < CB1 + 0.1 ? 14 : 8;   // la reacción, rápida; lo demás, suave
    layerF(P, T2, ramp);
  }
  /** Fin de partido (PLY-15): los que ganan van el uno al otro (convergencia del partido: choque de pecho o de las dos
   *  manos) y después saltan con los brazos arriba durante toda la pausa final; los que pierden se arrodillan (uno) o se
   *  agachan con las manos en la cabeza (el otro). */
  function matchCeleb(g, r, T, t) {
    var s2 = T.s, v2 = T.v, cv = CVP[r.team];
    if (r.pointWin) {
      var after = cv && cv.on && cv.ts >= 0 ? sstep(cv.tc + 0.3, cv.tc + 0.6, g.time) : sstep(0.4, 0.7, t);
      // primero: puño y a por el compañero (brazos de carrera libres)
      if (t < 0.4) fistPump(s2, v2, t, 1);
      else {
        // a por el compañero: erguido, los dos puños arriba gritando
        var up = sstep(0.4, 0.6, t);
        s2[DROP] = lerp(s2[DROP], 0.06, up); s2[CP] = lerp(s2[CP], -0.1, up); s2[PP] = lerp(s2[PP], 0.04, up); s2[CY] = lerp(s2[CY], 0, up); s2[HP] = -0.3;
        v2[HL].lerp(tV2.set(0.3, 1.92, 0.12), up); v2[HR].lerp(tV2.set(-0.3, 1.92, 0.12), up); v2[AL].lerp(tV2.set(1, -0.3, -0.4), up); v2[AR].lerp(tV2.set(-1, -0.3, -0.4), up);
        s2[WRL] = s2[WRR] = 0.6;
      }
      s2[LOOK] = 0.2;
      if (after > 0) {
        var t2 = Math.max(0, g.time - (cv && cv.ts >= 0 ? cv.tc + 0.3 : r.pointT + 0.4));
        var hop = Math.abs(Math.sin(t2 * 6.5)) * 0.24;
        s2[HOP] = lerp(s2[HOP], hop, after); s2[DROP] = lerp(s2[DROP], 0.05, after); s2[CP] = lerp(s2[CP], -0.15, after); s2[HP] = lerp(s2[HP], -0.5, after); s2[CY] = lerp(s2[CY], 0, after);
        v2[HL].lerp(tV2.set(0.42, 2.25 + hop * 0.2, 0.1), after); v2[HR].lerp(tV2.set(-0.42, 2.25 + hop * 0.2, 0.1), after);
        v2[AL].lerp(tV2.set(1, 0, -0.5), after); v2[AR].lerp(tV2.set(-1, 0, -0.5), after);
        v2[FL].y = ANKLE + hop * 0.6 * after; v2[FR].y = ANKLE + hop * 0.5 * after; s2[FPL] = s2[FPR] = hop * 2 * after;
        look(r, r.p.x * 1.15, (r.p.y >= 0 ? 1 : -1) * 13, 5, 0.6 * after);
      }
      r.celId = 'matchWin';
      return;
    }
    var kneel = r.p.idx === 0, k = sstep(0.5, 1.3, t);
    if (kneel) {
      // de rodillas: rodilla derecha en el suelo, izquierda delante, mano en la rodilla y la cabeza baja
      s2[DROP] = lerp(0.2, 0.62, k); s2[PP] = 0.25; s2[CP] = 0.35; s2[HP] = 0.55; s2[LOOK] = 0;
      setV(v2[FL], 0.16, ANKLE, lerp(0.1, 0.42, k)); setV(v2[FR], -0.16, ANKLE + 0.03 * k, lerp(-0.05, -0.5, k));
      setV(v2[KL], 0.1, 0.3, 1); setV(v2[KR], -0.1, -1 * k + 0.3 * (1 - k), 0.2 + 0.8 * (1 - k)); s2[FPL] = 0; s2[FPR] = 1.1 * k;
      shoulderC(s2);
      setV(v2[HL], 0.16, lerp(0.95, 0.62, k), lerp(0.2, 0.42, k)); setV(v2[HR], -0.08, lerp(0.95, SHY + 0.2, k), lerp(0.2, SHZ + 0.2, k));   // mano a la frente
      setV(v2[AL], 1, -0.3, -0.3); setV(v2[AR], -1, -0.2, -0.3);
      r.celId = 'matchKneel';
    } else {
      // agachado con las manos en la cabeza
      s2[DROP] = lerp(0.15, 0.56, k); s2[PP] = 0.4; s2[CP] = 0.45; s2[HP] = 0.5; s2[LOOK] = 0;
      shoulderC(s2);
      setV(v2[HL], 0.1, SHY + 0.3, SHZ + 0.06); setV(v2[HR], -0.1, SHY + 0.3, SHZ + 0.06); setV(v2[AL], 1, 0.2, -0.2); setV(v2[AR], -1, 0.2, -0.2);
      setV(v2[FL], 0.24, ANKLE, 0.14); setV(v2[FR], -0.24, ANKLE, 0.0);
      r.celId = 'matchHeads';
    }
  }

  // =====================================================================
  //  CONVERGENCIA TRAS EL PUNTO (choque de manos de la pareja ganadora; solo visual)
  // =====================================================================
  // En 'point' la pareja que gana se junta: el que hizo el punto apenas se mueve (<= CV_SCORER m: el plano de héroe lo
  // encuadra) y el compañero va hacia él (<= CV_MATE m). Desfase VISUAL de la raíz (offX/offY, como la plancha) con los
  // pies bloqueados (la locomoción ve la velocidad visual). Llegan a la vez, se giran el uno al otro, contacto (choque
  // arriba, choque abajo o puños, alternando por punto), palmada en el hombro y vuelven. La sim no se toca: en serveReady
  // el desfase vuelve a 0 (la sim recoloca a todos en ese mismo instante). La pareja que pierde: si están cerca, uno da
  // ánimos con dos palmadas. Contactos -> VB.Players.drainFx(out) (sonido de palmadas).
  var CV_SCORER = 1.2, CV_MATE = 4.0, CV_MAXD = 6.6, CV_WALK = 3.2, CV_WALKM = 2.8;
  var CVP = [null, null], FXQ = [];
  var TAB_END = 3.6, TAB_HOLD = 0.6, TAB = { ev: null, g: null, t0: 0, t: 0, max: 0, v: new Float64Array(16) }; // cuadro vivo de la escena congelada del punto (update)
  function cvNew() { return dblFields({ on: false, ts: -1, t0: -99, type: 0, scorer: -1, ax: 0, ay: 0, bx: 0, by: 0, a0x: 0, a0y: 0, b0x: 0, b0y: 0,
    twa: 0, twb: 0, da: 0, db: 0, tc: 0, tr: 0, mx: 0, my: 0, mz: 0, emitted: false, clap: false, clapper: -1, claps: 0, ra: 0, rtA: 0.3, rtB: 0.3,
    rax: 0, ray: 0, rbx: 0, rby: 0, rStart: false, d0: 0, hs: false, solo: false, hero: 0, hyaw: 0.5, myaw: 0.5, match: false, pA: null, pB: null }); }
  /** Compañero de p: en 2v2 el otro (como siempre); con más jugadores, el compañero en pista más cercano (VB.Sim.nearestMate). */
  function mateOf(g, p) {
    var t = g.teams[p.team];
    if (t.length === 2) return t[0] === p ? t[1] : t[0];
    return (VB.Sim.nearestMate && VB.Sim.nearestMate(g, p)) || p;
  }
  /** Pareja de la convergencia/ánimo del equipo t (c.pA, c.pB). 2v2: teams[t][0] y [1], como siempre. Con más jugadores: el
   *  protagonista (hero, o el último que tocó de ese equipo) y su compañero más cercano; el resto no entra en la coreografía. */
  function cvPair(g, t, c, hero) {
    var tm = g.teams[t];
    if (tm.length === 2) { c.pA = tm[0]; c.pB = tm[1]; return; }
    var h = hero && hero.team === t ? hero : (g.lastPlayer && g.lastPlayer.team === t ? g.lastPlayer : tm[0]);
    c.pA = h; c.pB = mateOf(g, h);
  }
  function inPair(c, p) { return p === c.pA || p === c.pB; }
  function cvPoint(g, e) {
    for (var t = 0; t < 2; t++) { if (!CVP[t]) CVP[t] = cvNew(); CVP[t].on = false; CVP[t].clap = false; }
    var won = e.team, sum = e.score ? e.score[0] + e.score[1] : 0, c = CVP[won];
    cvPair(g, won, c, g.lastTeam === won ? g.lastPlayer : null); cvPair(g, 1 - won, CVP[1 - won], e.player);
    if (e.matchWon) {
      // fin de partido (PLY-15): la pareja ganadora se junta para un choque de pecho o de las dos manos; no vuelven
      c.on = true; c.ts = -1; c.t0 = e.t != null ? e.t : g.time; c.type = 3 + (sum % 2); c.emitted = false; c.rStart = false; c.match = true; c.scorer = -1;
      return;
    }
    c.match = false;
    if (g.mode === 'over') return;
    c.on = true; c.ts = -1; c.t0 = e.t != null ? e.t : g.time; c.type = sum % 3; c.emitted = false; c.rStart = false;
    c.scorer = (!e.player && g.lastTeam === won && g.lastPlayer) ? g.lastPlayer.id : -1;
    // pareja que pierde: ánimo con palmadas si están cerca (da ánimos el compañero del que cometió la falta)
    var lt = 1 - won, l = CVP[lt], q0 = l.pA, q1 = l.pB, r0 = byId[q0.id], r1 = byId[q1.id];
    if (r0 && r1) {
      var dl = Math.sqrt((q0.x + r0.offX - q1.x - r1.offX) * (q0.x + r0.offX - q1.x - r1.offX) + (q0.y + r0.offY - q1.y - r1.offY) * (q0.y + r0.offY - q1.y - r1.offY));
      if (dl < 4) { l.clap = true; l.t0 = c.t0; l.claps = 0; l.clapper = e.player && e.player.team === lt ? (e.player === q0 ? q1.id : q0.id) : (sum % 2 ? q1.id : q0.id); }
    }
  }
  /** Arranca la convergencia cuando los dos están de pie (tras una plancha, al levantarse). Calcula los puntos de llegada. */
  function cvStart(g, c, won) {
    var A = c.pA || g.teams[won][0], B = c.pB || g.teams[won][1], ra = byId[A.id], rb = byId[B.id], tm = g.time;
    if (!ra || !rb) { c.on = false; return; }
    if (diveActive(ra, tm - ra.diveT) || diveActive(rb, tm - rb.diveT) || tm - c.t0 < 0.12) {
      if (tm - c.t0 > 0.9) c.on = false;
      return;
    }
    var ax = A.x + ra.offX, ay = A.y + ra.offY, bx = B.x + rb.offX, by = B.y + rb.offY, dx = bx - ax, dy = by - ay, D = Math.sqrt(dx * dx + dy * dy);
    // ACUERDO CON LA CÁMARA (CAM-02): el plano de héroe dice dónde está la cámara, hacia dónde mira el héroe y adónde va el compañero
    var hs = !c.match && VB.CameraRig && VB.CameraRig.heroShot ? VB.CameraRig.heroShot() : null;
    c.hs = false; c.solo = false;
    if (c.match) {
      if (tm - c.t0 < 0.3) return;                                          // primero, la reacción
      var S1 = c.type === 3 ? 0.6 : 0.86, fr = Math.max(0, D - S1);
      if (D < 0.05) { c.on = false; return; }
      dx /= D; dy /= D;
      c.a0x = ax; c.a0y = ay; c.b0x = bx; c.b0y = by;
      c.ax = ax + dx * fr * 0.5; c.ay = ay + dy * fr * 0.5; c.bx = bx - dx * fr * 0.5; c.by = by - dy * fr * 0.5;
      c.twa = c.twb = Math.max(0.35, fr * 0.5 / CV_WALKM); c.da = c.db = 0;
      c.ts = tm; c.tc = tm + 0.14 + c.twa + 0.08; c.tr = 1e9;
      var scm = (ra.scale + rb.scale) * 0.5;
      c.mx = (c.ax + c.bx) * 0.5; c.my = (c.ay + c.by) * 0.5; c.mz = (c.type === 3 ? 1.35 : 2.12) * scm;
      return;
    }
    if (hs && hs.team === won && (hs.heroId === A.id || hs.heroId === B.id)) {
      var hA = hs.heroId === A.id, mX0 = hA ? bx : ax, mY0 = hA ? by : ay;
      var mTx = hs.conv ? hs.mx : mX0, mTy = hs.conv ? hs.my : mY0, wm = Math.sqrt((mTx - mX0) * (mTx - mX0) + (mTy - mY0) * (mTy - mY0));
      c.hs = true; c.solo = !hs.conv; c.hyaw = hs.heroYaw; c.myaw = hs.mateYaw; c.scorer = hs.heroId; c.hero = hA ? 0 : 1;
      c.a0x = ax; c.a0y = ay; c.b0x = bx; c.b0y = by;
      if (hA) { c.ax = ax; c.ay = ay; c.bx = mTx; c.by = mTy; c.twa = 0.3; c.twb = Math.max(0.3, wm / CV_WALK); }
      else { c.bx = bx; c.by = by; c.ax = mTx; c.ay = mTy; c.twb = 0.3; c.twa = Math.max(0.3, wm / CV_WALK); }
      var Th = Math.max(c.twa, c.twb); c.da = Th - c.twa; c.db = Th - c.twb;
      c.ts = tm; c.tc = tm + 0.14 + Th + 0.16; c.tr = c.tc + 0.46;
      var sch = (ra.scale + rb.scale) * 0.5;
      c.mx = (c.ax + c.bx) * 0.5; c.my = (c.ay + c.by) * 0.5; c.mz = (c.type === 0 ? 2.02 : c.type === 1 ? 0.98 : 1.32) * sch;
      return;
    }
    var S0 = c.type === 2 ? 0.74 : c.type === 1 ? 0.98 : 0.8, free = D - S0;
    if (D > CV_MAXD + S0 || D < 0.05) { c.on = false; return; }
    dx /= D; dy /= D;
    var wa, wb;
    if (c.scorer === A.id) { wa = Math.min(CV_SCORER, free * 0.3); wb = free - wa; }
    else if (c.scorer === B.id) { wb = Math.min(CV_SCORER, free * 0.3); wa = free - wb; }
    else { wa = wb = free * 0.5; }
    if (wa > CV_MATE) { wb += wa - CV_MATE; wa = CV_MATE; } if (wb > CV_MATE) { wa += wb - CV_MATE; wb = CV_MATE; }
    if (wa < 0) wa = 0; if (wb < 0) wb = 0;
    c.a0x = ax; c.a0y = ay; c.b0x = bx; c.b0y = by;
    c.ax = ax + dx * wa; c.ay = ay + dy * wa; c.bx = bx - dx * wb; c.by = by - dy * wb;
    c.twa = Math.max(0.3, wa / CV_WALK); c.twb = Math.max(0.3, wb / CV_WALK);
    var Tm = Math.max(c.twa, c.twb); c.da = Tm - c.twa; c.db = Tm - c.twb;
    c.ts = tm; c.tc = tm + 0.14 + Tm + 0.06; c.tr = c.tc + 0.46;
    var sc = (ra.scale + rb.scale) * 0.5;
    c.mx = (c.ax + c.bx) * 0.5; c.my = (c.ay + c.by) * 0.5; c.mz = (c.type === 0 ? 2.02 : c.type === 1 ? 0.98 : 1.32) * sc;
  }
  /** Desfase visual del jugador en la convergencia (sustituye a la recuperación de diveOffset mientras dura). */
  function cvOffset(g, r) {
    var c = CVP[r.team];
    if (!c || !c.on || c.ts < 0 || !inPair(c, r.p)) return false;
    var p = r.p, A = c.pA === p, tm = g.time;
    var x0 = A ? c.a0x : c.b0x, y0 = A ? c.a0y : c.b0y, tx = A ? c.ax : c.bx, ty = A ? c.ay : c.by, tw = A ? c.twa : c.twb, dl = A ? c.da : c.db;
    var vx, vy;
    if (!c.rStart && !c.match && tm > c.tc + 0.14 && (g.timer || 0) < 0.42) c.tr = Math.min(c.tr, tm);  // se acaba la pausa: vuelven ya
    if (tm < c.tr) {
      var u = clamp((tm - c.ts - 0.14 - dl) / tw, 0, 1), e = u * u * u * (u * (u * 6 - 15) + 10);
      vx = lerp(x0, tx, e); vy = lerp(y0, ty, e);
    } else {
      if (!c.rStart) { // vuelta: con el tiempo que quede de la pausa del punto (la sim recoloca a todos en serveReady)
        c.rStart = true; var left = Math.max(0.25, (g.timer || 0.4) - 0.06);
        // a trote natural (<= 3 m/s de media): si no da tiempo, lo que falte lo absorbe la recolocación de serveReady
        var qa = c.pA, qb = c.pB;
        c.rtA = Math.max(left, 0.3, Math.sqrt((c.ax - qa.x) * (c.ax - qa.x) + (c.ay - qa.y) * (c.ay - qa.y)) / 3.0);
        c.rtB = Math.max(left, 0.3, Math.sqrt((c.bx - qb.x) * (c.bx - qb.x) + (c.by - qb.y) * (c.by - qb.y)) / 3.0);
      }
      var w = clamp((tm - c.tr) / (A ? c.rtA : c.rtB), 0, 1), e2 = w * w * (3 - 2 * w);
      vx = lerp(tx, p.x, e2); vy = lerp(ty, p.y, e2);
    }
    r.offX = vx - p.x; r.offY = vy - p.y;
    return true;
  }
  /** Peso y puntos del contacto de la convergencia (anclaje 'pt' en applyPose) y pose de acompañamiento. */
  function cvPose(g, r, P) {
    var c = CVP[r.team], tm = g.time, s = P.s;
    if (!c) return false;
    if (c.clap && r.p.id === c.clapper) {
      // palmadas de ánimo hacia el compañero: dos golpes a 0,55 y 0,85 s del punto
      var ta = tm - c.t0, on = sstep(0.3, 0.42, ta) * (1 - sstep(1.0, 1.2, ta));
      if (on <= 0) return false;
      s[DROP] = lerp(s[DROP], 0.1, on); s[CP] = lerp(s[CP], 0.1, on); s[LOOK] = lerp(s[LOOK], 0.6, on);
      var pl = Math.exp(-Math.pow((ta - 0.55) / 0.06, 2)) + Math.exp(-Math.pow((ta - 0.85) / 0.06, 2)), sep = 0.03 + 0.16 * (1 - Math.min(1, pl));
      var fx = Math.cos(r.yaw), fy = Math.sin(r.yaw), cx = r.p.x + r.offX + fx * 0.36 * r.scale, cy = r.p.y + r.offY + fy * 0.36 * r.scale, cz = 1.22 * r.scale;
      r.cvW1 = r.cvW0 = on; r.cvMode = 1;
      r.cvRx = cx + fy * sep; r.cvRy = cy - fx * sep; r.cvRz = cz; r.cvLx = cx - fy * sep; r.cvLy = cy + fx * sep; r.cvLz = cz;
      return true;
    }
    if (!c.on || c.ts < 0 || c.solo || !inPair(c, r.p)) return false;
    var dtc = tm - c.tc, w1 = sstep(-0.3, 0, dtc) * (1 - sstep(0.12, 0.34, dtc)), w0 = 0;
    if (c.type === 3) {
      // choque de pecho en el aire: saltito, brazos atrás y pecho fuera en el contacto
      var cb = Math.exp(-Math.pow(dtc / 0.13, 2)), arm = sstep(-0.35, -0.08, dtc) * (1 - sstep(0.15, 0.4, dtc));
      s[HOP] += 0.2 * cb; s[CP] -= 0.3 * cb; s[PP] -= 0.08 * cb; s[HP] -= 0.3 * cb; s[DROP] += 0.1 * sstep(-0.3, -0.12, dtc) * (1 - sstep(-0.12, -0.04, dtc));
      P.v[HL].lerp(tV3.set(0.34, 1.0, -0.32), arm); P.v[HR].lerp(tV3.set(-0.34, 1.0, -0.32), arm);
      P.v[AL].lerp(tV3.set(1, 0, 0.3), arm); P.v[AR].lerp(tV3.set(-1, 0, 0.3), arm);
      r.cvW0 = r.cvW1 = 0; r.cvMode = 3;
      return true;
    }
    // de frente al compañero: muñeca derecha en el punto de contacto, palmas que se tocan (desplazada hacia uno mismo)
    var A = c.pA === r.p, mex = (A ? c.ax : c.bx), mey = (A ? c.ay : c.by);
    var ux = mex - c.mx, uy = mey - c.my, ul = Math.sqrt(ux * ux + uy * uy) || 1, gap = c.type === 2 ? 0.055 : 0.03;
    r.cvRx = c.mx + ux / ul * gap; r.cvRy = c.my + uy / ul * gap; r.cvRz = c.mz;
    if (c.type === 4) {
      // las dos manos arriba contra las del compañero (la izquierda a 0,3 m de la derecha, a su izquierda)
      var lx = -uy / ul, ly = ux / ul;
      r.cvRx -= lx * 0.15; r.cvRy -= ly * 0.15; r.cvLx = r.cvRx + lx * 0.3; r.cvLy = r.cvRy + ly * 0.3; r.cvLz = c.mz;
      w0 = w1; s[HOP] += 0.12 * Math.exp(-Math.pow(dtc / 0.1, 2));
    } else
    // palmada en el hombro del compañero (choque arriba y puños)
    if (c.type !== 1) {
      var mate = byId[(A ? c.pB : c.pA).id];
      if (mate) {
        w0 = sstep(0.1, 0.22, dtc) * (1 - sstep(0.42, 0.56, dtc));
        if (w0 > 0) { mate.sh[0].getWorldPosition(tV3); r.cvLx = tV3.x - ux / ul * 0.06; r.cvLy = -tV3.z - uy / ul * 0.06; r.cvLz = tV3.y + 0.05; }
      }
    }
    r.cvW1 = w1; r.cvW0 = w0; r.cvMode = 2;
    // cuerpo: erguido y contento; saltito en el choque arriba, flexión en el choque abajo
    var bump = Math.exp(-Math.pow(dtc / 0.09, 2));
    var near = sstep(-0.3, 0, dtc) * (1 - sstep(0.15, 0.4, dtc));
    if (c.type === 0) s[HOP] += 0.07 * bump; else if (c.type === 1) { s[DROP] += 0.12 * near; s[CP] += 0.12 * near; }
    s[CP] -= 0.05; s[LOOK] = 0.2; s[HP] -= 0.1;
    // la mano libre: puño cerrado a la altura del pecho (energía; nunca colgando junto a la cadera)
    if (w0 <= 0 && tm < c.tr) { setV(P.v[HL], 0.17, 1.22, 0.28); setV(P.v[AL], 0.35, -1, -0.25); s[WRL] = 0.5; }
    return true;
  }
  function cvEmit(g, dt) {
    if (dt <= 0) return;
    for (var t = 0; t < 2; t++) {
      var c = CVP[t]; if (!c) continue;
      if (c.on && c.ts >= 0 && !c.emitted && !c.solo && g.time >= c.tc) {
        c.emitted = true;
        FXQ.push({ type: c.type === 3 ? 'chestbump' : c.type === 2 ? 'fistbump' : 'highfive', team: t, x: c.mx, y: c.my, z: c.mz, strength: c.type >= 3 || c.type === 0 ? 1 : c.type === 1 ? 0.75 : 0.55 });
      }
      if (c.clap && c.claps < 2) {
        var ta = g.time - c.t0, due = c.claps === 0 ? 0.55 : 0.85;
        if (ta >= due) {
          c.claps++; var cr = byId[c.clapper];
          if (cr) FXQ.push({ type: 'clap', team: t, x: cr.p.x + cr.offX + Math.cos(cr.yaw) * 0.36, y: cr.p.y + cr.offY + Math.sin(cr.yaw) * 0.36, z: 1.22 * cr.scale, strength: 0.6 });
        }
        if (FXQ.length > 32) FXQ.splice(0, FXQ.length - 32);
      }
    }
  }
  /** Orientación durante la convergencia: hacia el compañero (algo a la izquierda: las manos derechas quedan en medio) y,
   *  al volver, hacia donde camina. NaN = sin opinión. */
  function cvYaw(g, r) {
    var c = CVP[r.team];
    if (!c) return NaN;
    var p = r.p, A = c.pA === p;
    if (c.clap && p.id === c.clapper) {
      var m = byId[(A ? c.pB : c.pA).id]; if (!m) return NaN;
      return Math.atan2(m.p.y + m.offY - p.y - r.offY, m.p.x + m.offX - p.x - r.offX);
    }
    if (!c.on || c.ts < 0 || !inPair(c, p)) return NaN;
    // (CAM-02) tras el choque de manos, el que anotó sigue de cara a la cámara del plano de héroe hasta que acaba la pausa
    if (c.hs && (A ? 0 : 1) === c.hero && g.time >= c.tr + 0.05 && g.mode === 'point' && (g.timer || 0) > 0.3) return c.hyaw;
    if (c.hs && g.time < c.tr + 0.05) {
      var mh = byId[(A ? c.pB : c.pA).id], dtc = g.time - c.tc, isH = (A ? 0 : 1) === c.hero;
      var toM = mh ? Math.atan2(mh.p.y + mh.offY - p.y - r.offY, mh.p.x + mh.offX - p.x - r.offX) : NaN;
      var hf = !c.solo && dtc > -0.28 && dtc < 0.22 && toM === toM;   // el choque de manos: cara a cara un instante
      if (isH) return hf ? toM : c.hyaw;
      var tx = A ? c.ax : c.bx, ty = A ? c.ay : c.by, ex = tx - p.x - r.offX, ey = ty - p.y - r.offY;
      if (!c.solo && ex * ex + ey * ey > 0.12) return Math.atan2(ey, ex);
      return hf ? toM : c.myaw;
    }
    if (g.time < c.tr + 0.05) {
      var mt = byId[(A ? c.pB : c.pA).id]; if (!mt) return NaN;
      var aM = Math.atan2(mt.p.y + mt.offY - p.y - r.offY, mt.p.x + mt.offX - p.x - r.offX);
      // (CAM-09) victoria del PARTIDO: medio segundo después del choque, los dos ganadores se abren hacia la cámara de la órbita
      // (≤ 35° vueltos hacia el compañero), en vez de quedarse de cara el uno al otro. La órbita lo detecta (frentes a < 60°) y
      // pasa a encuadrarlos de frente. El giro lo suaviza el muelle de yaw (sin saltos aunque la cámara orbite).
      var cam = c.match && g.time > c.tc + 0.5 && VB.ctx && VB.ctx.camera;
      if (cam) {
        var aC = Math.atan2(-cam.position.z - p.y - r.offY, cam.position.x - p.x - r.offX), dm = wrapA(aM - aC);
        return aC + clamp(dm, -0.61, 0.61);
      }
      return aM + (c.type >= 3 ? 0 : c.type === 1 ? -0.15 : -0.32);
    }
    var ox = -r.offX, oy = -r.offY;
    if (ox * ox + oy * oy < 0.25) return NaN;
    return Math.atan2(oy, ox);
  }

  // =====================================================================
  //  IK de dos huesos
  // =====================================================================
  /** Orienta `upper` (hueso que cuelga en -Y) y dobla `lower` (rotación X) para llevar el extremo a (tx,ty,tz),
   *  expresado en el espacio del padre de `upper` relativo a su pivote. pole: hacia dónde apunta el codo/rodilla. */
  // T: extremo; Pv: polo (Vector3). Se pasan vectores y no 8 números: cada número calculado que se pasa a una
  // función no integrada crea un HeapNumber (basura por frame: 16 llamadas por frame).
  function solveIK(upper, lower, T, Pv, l1, l2) {
    var tx = T.x, ty = T.y, tz = T.z, px = Pv.x, py = Pv.y, pz = Pv.z;
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

  /** CARTOON: estirar y encoger suave (squash & stretch) en el despegue y el aterrizaje, escalando el hueso body
   *  (su origen está entre los pies: no se despegan del suelo). Volumen casi constante (xz = 1/sqrt(y)). Solo visual:
   *  la sim, el balón y los contactos no cambian (el despegue acaba antes de cualquier contacto en el aire). */
  var SQ_UP = 0.06, SQ_LAND = 0.08;
  function squash(g, r) {
    var tm = g.time, a = 0, tj = tm - r.jumpT, tl = tm - r.landT, b = r.body.scale;
    if (tj >= 0 && tj < 0.16) a += SQ_UP * Math.sin(tj / 0.16 * PI);
    if (tl >= 0 && tl < 0.38) a -= tl < 0.05 ? SQ_LAND * tl / 0.05 : tl < 0.24 ? SQ_LAND * (1 - sstep(0.05, 0.24, tl)) : -0.018 * Math.sin((tl - 0.24) / 0.14 * PI);
    if (a === 0) { if (b.y !== 1) b.set(1, 1, 1); return; }
    var sy = 1 + a, sx = 1 / Math.sqrt(sy);
    b.set(sx, sy, sx);
  }
  function torso(r, s) {
    r.body.position.set(s[OX], s[HOP], s[OZ]);
    r.pelvis.position.set(s[PX], HIP_H - s[DROP], s[PZ]);
    eA.set(s[PP] * 0.6, s[PY], s[PR], 'YXZ'); r.pelvis.quaternion.setFromEuler(eA);
    eA.set(s[PP] * 0.4 + s[CP] * 0.45, s[CY] * 0.4, s[CR] * 0.5, 'YXZ'); r.spine.quaternion.setFromEuler(eA);
    eA.set(s[CP] * 0.55, s[CY] * 0.6 - s[PY] * 0.6, s[CR] * 0.5, 'YXZ'); r.chest.quaternion.setFromEuler(eA);
    // matrices pelvis/torso en el espacio del cuerpo
    r.pelvis.updateMatrix(); r.spine.updateMatrix(); r.chest.updateMatrix();
    mA.multiplyMatrices(r.pelvis.matrix, r.spine.matrix); mA.multiply(r.chest.matrix);   // cuerpo <- pecho
  }
  function shoulderAt(s, k, out) { return out.set((k ? -1 : 1) * (SH_X - 0.022 * s[SHR]), SH_Y + SHR_UP * s[SHR], SH_Z).applyMatrix4(mA); }

  // =====================================================================
  //  ANCLAJE DE CONTACTO (las manos llegan al balón en cada toque)
  // =====================================================================
  // computeTarget deja en el rig la fuente del anclaje en coordenadas de la SIM (balón previsto en el contacto REAL o el
  // contacto ya ocurrido), el modo y el peso por mano (curva de tiempo: 0 -> 1 en los últimos ANC_PRE s, 1 en el contacto,
  // se suelta en el acompañamiento). applyPose lo resuelve contra los hombros reales del frame:
  //  palm (palma detrás del balón en la dirección del golpe: remate, saque, balón libre), tip (dejada: palma debajo-detrás),
  //  plat (antebrazos 0,12 m por encima de las muñecas bajo el balón, plano girado hacia el destino), set (ventana de los
  //  dedos sobre la frente), dive (plancha: manos planas bajo el balón), hold (palma bajo el balón del saque), pt (puntos dados).
  // Si el brazo no llega, la pelvis se corrige (inclinación <= aLean m, flexión de rodillas para balones bajos) solo en este
  // frame (no altera el muelle de la pose). Sin asignaciones.
  var ANC_PRE = 0.14, ARM_W = UPPER + FORE, BR = 0.21; // BR = radio del balón de la sim (VB.C.BR, exagerado): init
  var SVS = new Float32Array(NS), AB = null, AD = null, AW0 = null, AW1 = null, AS0 = null, AS1 = null, AU = null, AN = null, AX = null, AP = null;
  function ancVecs() { AB = new THREE.Vector3(); AD = new THREE.Vector3(); AW0 = new THREE.Vector3(); AW1 = new THREE.Vector3(); AS0 = new THREE.Vector3(); AS1 = new THREE.Vector3(); AU = new THREE.Vector3(); AN = new THREE.Vector3(); AX = new THREE.Vector3(); AP = new THREE.Vector3(); }
  /** Punto de la sim -> marco del hueso body (espacio cuerpo menos los desplazamientos del body). */
  function toBodyBone(r, s, x, y, z, out) { toBody(r, x, y, z, out); out.x -= s[OX]; out.y -= s[HOP]; out.z -= s[OZ]; return out; }
  /** Dirección de la sim -> espacio cuerpo (solo giro). */
  function dirToBody(r, dx, dy, dz, out) { var fx = Math.cos(r.yaw), fy = Math.sin(r.yaw); out.x = dx * -fy + dy * fx; out.z = dx * fx + dy * fy; out.y = dz; return out; }
  /** Muñecas objetivo (AW0 izquierda, AW1 derecha) para el modo del anclaje, con los hombros del frame. Devuelve el
   *  exceso de alcance (m; > 0 = no llega; < 0 en plat = demasiado encogido) y deja en AX la dirección de corrección. */
  function ancSolve(r, s, mode) {
    shoulderAt(s, 0, AS0); shoulderAt(s, 1, AS1);
    var e = 0, d;
    if (mode === 1 || mode === 2) {          // palm / tip: mano derecha
      AW1.copy(AB).addScaledVector(AD, -(BR + (mode === 2 ? 0.016 : 0.01)));   // palma en la superficie del balón
      AU.subVectors(AW1, AS1).normalize(); AW1.addScaledVector(AU, -0.045);
      AX.subVectors(AW1, AS1); d = AX.length(); e = d - ARM_W * 0.985; AX.multiplyScalar(1 / (d || 1));
    } else if (mode === 3) {                 // plat: plataforma de antebrazos
      AX.addVectors(AS0, AS1).multiplyScalar(0.5);                 // centro de hombros
      AU.subVectors(AB, AX).normalize();
      for (var it = 0; it < 3; it++) {
        AN.copy(AD); AN.addScaledVector(AU, -AN.dot(AU)).normalize();
        AW1.copy(AB).addScaledVector(AN, -(BR + 0.038)).addScaledVector(AU, 0.12);
        AU.subVectors(AW1, AX).normalize();
      }
      AN.copy(AD); AN.addScaledVector(AU, -AN.dot(AU)).normalize();
      AW1.copy(AB).addScaledVector(AN, -(BR + 0.038)).addScaledVector(AU, 0.12);
      AW0.crossVectors(AU, AN); if (AW0.x < 0) AW0.multiplyScalar(-1); AW0.normalize();
      AX.subVectors(AW1, AX); d = AX.length(); AX.multiplyScalar(1 / (d || 1));
      e = d > 0.53 ? d - 0.53 : d < 0.42 ? d - 0.42 : 0;
      var cx = AW1.x, cy = AW1.y, cz = AW1.z;
      AW1.set(cx - AW0.x * 0.04, cy - AW0.y * 0.04, cz - AW0.z * 0.04);
      AW0.set(cx + AW0.x * 0.04, cy + AW0.y * 0.04, cz + AW0.z * 0.04);
    } else if (mode === 4) {                 // set: ventana de los dedos
      // las muñecas quedan del lado de los hombros (debajo-detrás del balón), separadas 0,16 m
      AU.addVectors(AS0, AS1).multiplyScalar(0.5).sub(AB); AU.y = Math.min(AU.y, -0.25); AU.normalize();
      var wd = BR * 0.62 + 0.04, wl = BR * 0.5 + 0.03;   // muñecas debajo-detrás, dedos abrazando la parte de atrás del balón
      AW0.set(AB.x + AU.x * wd + wl, AB.y + AU.y * wd, AB.z + AU.z * wd);
      AW1.set(AB.x + AU.x * wd - wl, AB.y + AU.y * wd, AB.z + AU.z * wd);
      var e0 = AW0.distanceTo(AS0), e1 = AW1.distanceTo(AS1);
      if (e1 > e0) { AX.subVectors(AW1, AS1); e = e1; } else { AX.subVectors(AW0, AS0); e = e0; }
      AX.normalize(); e -= ARM_W * 0.97;
    } else if (mode === 5) {                 // dive: manos planas bajo el balón
      var hx = AB.x, hz = AB.z, hl = Math.sqrt(hx * hx + hz * hz) || 1; hx /= hl; hz /= hl;
      var db = BR * 0.55 + 0.05, dl2 = BR * 0.35 + 0.03, du = BR * 0.75;
      AW0.set(AB.x - hx * db + hz * dl2, AB.y - du, AB.z - hz * db - hx * dl2);
      AW1.set(AB.x - hx * db - hz * dl2, AB.y - du, AB.z - hz * db + hx * dl2);
      AX.addVectors(AS0, AS1).multiplyScalar(0.5); AU.addVectors(AW0, AW1).multiplyScalar(0.5);
      AX.subVectors(AU, AX); d = AX.length(); AX.multiplyScalar(1 / (d || 1)); e = d - 0.53;
    } else if (mode === 6) {                 // hold: palma izquierda bajo el balón del saque
      AU.set(AB.x - AS0.x, 0, AB.z - AS0.z).normalize();
      AW0.set(AB.x - AU.x * 0.04, AB.y - BR - 0.016, AB.z - AU.z * 0.04);
      e = 0;
    } else if (mode === 8) {                 // drib: palma izquierda en la superficie del balón en la dirección AD (ritual)
      // la muñeca se retira hacia el hombro solo en el plano tangente (la palma queda SOBRE la superficie, nunca dentro)
      AW0.copy(AB).addScaledVector(AD, BR + 0.03);
      AU.subVectors(AW0, AS0); AU.addScaledVector(AD, -AU.dot(AD)); var aul = AU.length();
      if (aul > 1e-4) AW0.addScaledVector(AU, -0.04 / aul);
      AX.subVectors(AW0, AS0); d = AX.length(); e = d - ARM_W * 0.97; AX.multiplyScalar(1 / (d || 1));
    } else if (mode === 7) {                 // pt: muñecas a puntos dados (AB derecha, AD izquierda)
      AW1.copy(AB); AW0.copy(AD);
      var f0 = r.aw0 > 0 ? AW0.distanceTo(AS0) : 0, f1 = r.aw1 > 0 ? AW1.distanceTo(AS1) : 0;
      if (f1 >= f0) { AX.subVectors(AW1, AS1); e = f1; } else { AX.subVectors(AW0, AS0); e = f0; }
      AX.normalize(); e -= ARM_W * 0.97;
    }
    return e;
  }
  var ANC_MODE = { palm: 1, tip: 2, plat: 3, set: 4, dive: 5, hold: 6, pt: 7, drib: 8 };

  function applyPose(r) {
    var c = r.cur, s = c.s, v = c.v, k;
    var aw0 = r.aw0, aw1 = r.aw1, mode = (aw0 > 0 || aw1 > 0) ? ANC_MODE[r.aMode] || 0 : 0, save = mode || r.vh > 0;
    if (save) SVS.set(s);
    if (r.vh > 0) { s[HOP] += r.vh; s[FPL] += 0.5 * sstep(0, 0.1, r.vh); s[FPR] += 0.5 * sstep(0, 0.1, r.vh); }
    torso(r, s);
    if (mode) {
      if (!AB) ancVecs();
      toBodyBone(r, s, r.aX, r.aY, r.aZ, AB);
      if (mode === 7) toBodyBone(r, s, r.aDx, r.aDy, r.aDz, AD); else dirToBody(r, r.aDx, r.aDy, r.aDz, AD);
      var e = ancSolve(r, s, mode), wm = Math.max(aw0, aw1);
      if (e !== 0 && r.aLean > 0 && (e > 0 || mode === 3)) {
        // corrección de cuerpo: la pelvis acerca (o aleja) los hombros; horizontal <= aLean, rodillas para lo bajo
        var dx = AX.x * e, dy = AX.y * e, dz = AX.z * e, hl = Math.sqrt(dx * dx + dz * dz), lim = r.aLean;
        if (hl > lim) { dx *= lim / hl; dz *= lim / hl; }
        dy = clamp(dy, -0.32, 0.12 + r.aUp);
        s[PX] += dx * wm; s[PZ] += dz * wm;
        var nd = s[DROP] - dy * wm, lo = Math.min(s[DROP], -0.04);
        if (nd < lo) {
          // más arriba de lo que da la cadera: de puntillas (talones arriba, punteras en el suelo) y luego un saltito
          var up = Math.min(lo - nd, r.aUp); nd = lo; s[HOP] += up;
          if (r.p.z < 0.01) { var tp = Math.asin(Math.min(up, 0.12) / 0.17); s[FPL] += tp; s[FPR] += tp; }
        }
        s[DROP] = Math.min(nd, 0.78);
        torso(r, s); e = ancSolve(r, s, mode);
      }
      r.aE = e;
      // orientación de la mano en el contacto
      if (mode === 1 || mode === 2) s[WRR] += ((mode === 2 ? -0.5 : -0.12) - s[WRR]) * aw1;
      else if (mode === 3) { s[WRL] += (0.12 - s[WRL]) * aw0; s[WRR] += (0.12 - s[WRR]) * aw1; s[TWL] *= 1 - aw0; s[TWR] *= 1 - aw1; }
      else if (mode === 4) { s[WRL] += (-1.15 - s[WRL]) * aw0; s[WRR] += (-1.15 - s[WRR]) * aw1; }
      else if (mode === 5) { s[WRL] += (-0.35 - s[WRL]) * aw0; s[WRR] += (-0.35 - s[WRR]) * aw1; }
      else if (mode === 6 || mode === 8) { s[WRL] += (r.holdWr - s[WRL]) * aw0; s[TWL] += (r.holdTw - s[TWL]) * aw0; }
    }
    mInv.copy(mA).invert();
    qA.copy(r.pelvis.quaternion).multiply(r.spine.quaternion).multiply(r.chest.quaternion); qB.copy(qA).invert();

    // brazos
    for (k = 0; k < 2; k++) {
      var sh = r.sh[k], sg = k ? -1 : 1;
      sh.position.set(sg * (SH_X - 0.022 * s[SHR]), SH_Y + SHR_UP * s[SHR], SH_Z);
      tV2.copy(v[AL + k]).applyQuaternion(qB);
      tV.copy(v[HL + k]);
      if (k === 1 && r.guard) headClear(tV);
      if (mode) {
        var wk = k ? aw1 : aw0;
        if (wk > 0) {
          // la IK lleva a la mano el punto a FORE + PALM del codo: se resuelve primero a la MUÑECA anclada y el objetivo
          // final es esa muñeca prolongada PALM en la dirección real del antebrazo (exacto también con el codo doblado)
          var AWk = k ? AW1 : AW0;
          AP.copy(AWk).applyMatrix4(mInv); AP.x -= sh.position.x; AP.y -= sh.position.y; AP.z -= sh.position.z;
          solveIK(r.up[k], r.el[k], AP, tV2, UPPER, FORE);
          AP.set(0, -PALM, 0).applyQuaternion(r.el[k].quaternion).applyQuaternion(r.up[k].quaternion).applyQuaternion(qA).add(AWk);
          tV.lerp(AP, wk);
          // el latigazo sigue rodeando la cabeza mientras el anclaje entra (en el contacto manda el balón)
          if (k === 1 && wk < 0.98 && (mode === 1 || mode === 2)) { tV2.copy(tV); headClear(tV2); tV.lerp(tV2, 1 - wk * wk * wk); }
        }
      }
      tV.applyMatrix4(mInv); tV.x -= sh.position.x; tV.y -= sh.position.y; tV.z -= sh.position.z;
      solveIK(r.up[k], r.el[k], tV, tV2, UPPER, ARM_L2);
      eA.set(s[WRL + k], s[TWL + k], 0, 'YXZ'); r.hand[k].quaternion.setFromEuler(eA);
    }
    // piernas
    mB.copy(r.pelvis.matrix).invert(); qC.copy(r.pelvis.quaternion).invert();
    for (k = 0; k < 2; k++) {
      var hp = r.hip[k];
      tV.copy(v[FL + k]).applyMatrix4(mB); tV.x -= hp.position.x; tV.y -= hp.position.y; tV.z -= hp.position.z;
      tV2.copy(v[KL + k]).applyQuaternion(qC);
      solveIK(r.th[k], r.kn[k], tV, tV2, THIGH, SHIN);
      // pie plano respecto al cuerpo (con puntera y giro)
      qD.copy(r.pelvis.quaternion).multiply(r.th[k].quaternion).multiply(r.kn[k].quaternion).invert();
      eA.set(s[FPL + k], s[FYL + k], 0, 'YXZ'); qA.setFromEuler(eA);
      r.ft[k].quaternion.copy(qD).multiply(qA);
    }
    if (save) s.set(SVS);
  }

  /** La mano derecha (espacio cuerpo) rodea la cabeza en los gestos por arriba: si cae dentro de un cilindro
   *  alrededor de la cabeza (r = 0,25 m, de la barbilla a un palmo por encima), se aparta hacia fuera y a la
   *  derecha con una transición suave. Así el trayecto armado → contacto es un arco y no roza la cabeza. */
  // TAJO: cabeza grande (×1,55): cilindro de 0,33 m y banda 6 cm más alta
  var HEAD_R = 0.33, HEAD_CY = NECK_Y + HEAD_C * HEAD_K, HEAD_UP = 0.62;   // HEAD_UP: lo más que la cabeza mira hacia arriba (rad)
  function headClear(h) {
    HC.set(0, HEAD_CY, 0.012).applyMatrix4(mA);   // centro de la cabeza (mA: cuerpo <- pecho)
    var dy = h.y - HC.y, band = sstep(-0.33, -0.19, dy) * (1 - sstep(0.26, 0.4, dy));
    if (band <= 0) return;
    var dx = h.x - HC.x, dz = h.z - HC.z, d = Math.sqrt(dx * dx + dz * dz), R = HEAD_R * band;
    if (d >= R) return;
    var nx, nz;
    if (d < 1e-4) { nx = -1; nz = 0; } else { nx = dx / d; nz = dz / d; }
    if (nx > -0.35) { nx = -0.35; var nl = Math.sqrt(nx * nx + nz * nz); nx /= nl; nz /= nl; } // siempre hacia el lado del brazo
    h.x = HC.x + nx * R; h.z = HC.z + nz * R;
  }

  /** Cabeza: mira al balón (limitado), más ajustes de la pose. */
  function aimHead(r, g, dt, snap) {
    var s = r.cur.s, b = g.ball;
    toBodyV(r, b, tV);
    tV.x -= r.body.position.x; tV.y -= r.body.position.y; tV.z -= r.body.position.z;
    tV.applyMatrix4(mInv); // en espacio del pecho
    var dx = tV.x, dy = tV.y - NECK_Y - 0.1, dz = tV.z, h = Math.sqrt(dx * dx + dz * dz);
    var yaw = clamp(Math.atan2(dx, dz), -1.25, 1.25), pitch = clamp(-Math.atan2(dy, Math.max(0.05, h)), -HEAD_UP, 0.55);   // TAJO: con la cabeza grande no se echa tan atrás (la cara se sigue viendo)
    if (dz < -0.1) yaw *= 0.6;
    var w = s[LOOK];
    var ty = yaw * w + s[HY], tp = pitch * w + s[HP] - s[CP] * 0.3 * (1 - w);
    if (r.lkW > 0) {
      // punto de mirada de la celebración (compañero, grada, bote, antena)
      toBody(r, r.lkX, r.lkY, r.lkZ, tV2); tV2.sub(r.body.position); tV2.applyMatrix4(mInv);
      var lx = tV2.x, ly = tV2.y - NECK_Y - 0.1, lz = tV2.z, lh = Math.sqrt(lx * lx + lz * lz);
      var lyaw = clamp(Math.atan2(lx, lz), -1.25, 1.25), lpit = clamp(-Math.atan2(ly, Math.max(0.05, lh)), -HEAD_UP, 0.75);
      ty = lerp(ty, lyaw + s[HY], r.lkW); tp = lerp(tp, lpit, r.lkW);
    }
    // la cabeza se adelanta al giro del cuerpo (~0,08 s)
    ty += clamp(r.yawV * 0.08, -0.45, 0.45) * (1 - 0.5 * w);
    if (r.lieW > 0) {
      // tumbado boca abajo: la cara gira alrededor de la columna hacia el lado del balón (ángulo en el espacio del
      // cuerpo) y se levanta menos cuanto más gira: mira el balón sin hundir la cara en el suelo
      toBodyV(r, b, tV2); tV2.sub(r.body.position);
      tV3.set(0, NECK_Y + 0.1, 0.012).applyMatrix4(mA); tV2.sub(tV3);       // desde la CABEZA (va muy por delante de la raíz)
      var ab = clamp(Math.atan2(tV2.x, tV2.z), -1.9, 1.9), lp = lerp(-0.9, -0.12, Math.min(1, Math.abs(ab) / 1.7));
      ty = lerp(ty, ab, r.lieW); tp = lerp(tp, lp, r.lieW);
    }
    if (tp < -HEAD_UP - 0.12 && r.lieW < 0.5) tp = -HEAD_UP - 0.12;   // TAJO: tope con las poses (s[HP]) incluidas
    var k = snap ? 1 : kf(r.lieW > 0.5 ? 18 : 10, dt);
    r.headYaw += (ty - r.headYaw) * k; r.headPitch += (tp - r.headPitch) * k;
    r.head.rotation.set(r.headPitch, r.headYaw, 0);
  }

  // =====================================================================
  //  CARA (PLY-18): grito, esfuerzo, alegría y abatimiento + parpadeo
  // =====================================================================
  // Pesos por frame (0..1): S grito (latigazo y contacto del remate ±0,15 s, bloqueo, rugido), E esfuerzo (plancha, despegue,
  // defensa, saque), J alegría (boca abierta con dientes, cejas arriba: celebración), D abatimiento (cejas tristes, boca cerrada).
  // Se traducen a escala/posición de los huesos de ojos, boca, dientes y cejas: sin texturas ni programas nuevos.
  var FACE_FORCE = { shout: [1, 0, 0, 0], effort: [0, 1, 0, 0], joy: [0, 0, 1, 0], sad: [0, 0, 0, 1], neutral: [0, 0, 0, 0] };
  var FW = [0, 0, 0, 0];
  function faceTarget(g, r) {
    var p = r.p, tm = g.time, S = 0, E = 0, J = 0, D = 0, air = p.z > 0.012, ha = tm - r.hitT, tj = tm - r.jumpT, x;
    if (r.fxForce && FACE_FORCE[r.fxForce] && (r.fxForceT < 0 || (ctx && ctx.time < r.fxForceT))) { x = FACE_FORCE[r.fxForce]; FW[0] = x[0]; FW[1] = x[1]; FW[2] = x[2]; FW[3] = x[3]; return true; }
    // remate / saque en salto: grito desde el latigazo (~0,12 s antes) hasta 0,15 s después del contacto
    if (air && r.jumpKind === 'attack') {
      if (r.swP > 0) S = sstep(0.0, 0.35, r.swP);
      if (tj >= 0 && tj < 0.22) E = Math.max(E, 0.65 * (1 - tj / 0.22));         // despegue
    }
    if (r.hitAir && r.hitShot !== 'tip' && (r.hitKind === 'spike' || r.hitKind === 'serve' || r.hitKind === 'free') && ha >= 0 && ha < 0.32) S = Math.max(S, 1 - sstep(0.15, 0.32, ha));
    var ba = tm - r.blockT;
    if (air && r.jumpKind === 'block') E = Math.max(E, 0.55);
    if (ba >= 0 && ba < 0.45) S = Math.max(S, 0.9 * (1 - sstep(0.3, 0.45, ba)));
    // plancha (y su impulso previsto): esfuerzo
    var dv = tm - r.diveT;
    if (dv >= -0.05 && dv < r.diveTc + 0.5 && diveActive(r, dv)) E = Math.max(E, 1 - sstep(r.diveTc + 0.3, r.diveTc + 0.5, dv));
    if (r.pdW > 0) E = Math.max(E, r.pdW);
    // defensa / recepción baja y saque de pie: esfuerzo breve
    if (ha >= -0.02 && ha < 0.22 && (r.hitShot === 'dig' || (r.hitKind === 'serve' && !r.hitAir))) E = Math.max(E, 0.6 * (1 - sstep(0.1, 0.22, ha)));
    // tras el punto
    var mode = g.mode;
    if ((mode === 'point' || mode === 'over') && r.pointT > -50) {
      var pa = tm - r.pointT, cv = r.celV;
      if (pa >= 0) {
        if (r.pointWin) {
          if (r.celeb === 3 || cv === 'roar') S = Math.max(S, 1 - sstep(1.3, 1.6, pa));
          else if (cv === 'tiredWin') { E = Math.max(E, 0.35); J = Math.max(J, 0.45); }
          else J = Math.max(J, r.matchEnd ? 1 : pa < 1.0 ? 1 : 0.55);
          if (cv === 'ace' || cv === 'kill' || cv === 'vamos' || cv === 'bigV' || cv === 'comeback') { if (pa < 0.7) S = Math.max(S, 0.75 * (1 - sstep(0.45, 0.7, pa))); }
        } else D = r.matchEnd ? 1 : cv === 'tiredLose' ? 0.6 : 0.85;
      }
    }
    FW[0] = S; FW[1] = E; FW[2] = J; FW[3] = D; return false;
  }
  function updateFace(g, r, dt, snap) {
    var forced = faceTarget(g, r), sn = snap || forced;
    var kS = sn ? 1 : kf(FW[0] > r.fxS ? 26 : 7, dt), kE = sn ? 1 : kf(FW[1] > r.fxE ? 22 : 6, dt);
    var kJ = sn ? 1 : kf(FW[2] > r.fxJ ? 16 : 5, dt), kD = sn ? 1 : kf(FW[3] > r.fxD ? 5 : 5, dt);
    r.fxS += (FW[0] - r.fxS) * kS; r.fxE += (FW[1] - r.fxE) * kE; r.fxJ += (FW[2] - r.fxJ) * kJ; r.fxD += (FW[3] - r.fxD) * kD;
    var S = r.fxS, E = r.fxE, J = r.fxJ, D = r.fxD;
    // parpadeo: cada 2,2-5,5 s (0,13 s); no mientras grita o aprieta
    var bl = 0;
    if (!snap && dt > 0) {
      r.blinkT -= dt;
      if (r.blinkT < 0) { var u = -r.blinkT / 0.13; if (u >= 1) r.blinkT = 2.2 + 3.3 * Math.random(); else bl = Math.sin(PI * u); }
    }
    // TAJO: la cara dibujada elige celda de ojos (0-7) y de boca (0-7) de la hoja de caras (paintFace) con los mismos pesos
    var eye = 0, mouth = 0, tm = g.time;
    if (S > 0.45) { eye = 5; mouth = 2; }                                   // grito (remate, bloqueo, punto)
    else if (E > 0.4) { eye = 2; mouth = 3; }                               // esfuerzo: entornados y dientes apretados
    else if (J > 0.4) {                                                     // alegría: ^ ^ y sonrisa (con lengua) o guiño
      var ph = Math.floor((tm + r.id * 0.37) / 0.9);
      eye = (ph % 5 === 3) ? 6 : 3; mouth = (r.id + ph) % 3 === 0 ? 6 : 1;
    }
    else if (D > 0.4) { eye = 4; mouth = r.matchEnd ? 7 : 4; }              // tristeza (fin del partido: mueca)
    else if (faceFocus(g, r)) { eye = 7; mouth = 5; }                       // concentración: le llega el balón
    if (bl > 0.5 && eye !== 5 && eye !== 2 && eye !== 3 && eye !== 6) eye = 1;   // parpadeo
    var fc = r.fxForce && r.fxForce.charAt(0) === 'c' && /^c(\d)\/(\d)$/.exec(r.fxForce);   // pruebas: _face(p, 'c<ojos>/<boca>')
    if (fc && (r.fxForceT < 0 || (ctx && ctx.time < r.fxForceT))) { eye = +fc[1] & 7; mouth = +fc[2] & 7; }
    var mat = r.skin && r.skin.material, ud = mat && mat.userData;
    if (ud && ud.eyeOff) {
      ud.eyeOff.set((eye & 3) * FE_W / 512, -(eye >> 2) * FE_H / 512);
      ud.mouthOff.set(mouth * FM_W / 512, 0);
    }
    r.faceE = eye; r.faceM = mouth;
  }
  /** TAJO: cara de concentración (ojos 7 / boca 5): peloteo, el balón viene del rival y es él quien lo va a jugar. */
  function faceFocus(g, r) {
    var p = r.p;
    if (g.mode !== 'rally' || p.z > 0.012 || !g.jobs || g.jobs[p.team] !== p || g.touchTeam === p.team) return false;
    return side(p.team) * g.ball.x > -0.5;   // balón ya en su campo (o encima de la red)
  }

  // =====================================================================
  //  PELO (PLY-19): un hueso con muelle amortiguado (coleta), movido por la aceleración de la cabeza
  // =====================================================================
  // La punta de la coleta se separa de su sitio de reposo (que viaja con la cabeza) por la aceleración de ese sitio: muelle
  // amortiguado sobre el DESFASE (o'' = -K·o - C·o' - HAIR_B·a), con acoplamiento HAIR_B < 1: la sim arranca y frena en seco
  // (5 m/s en un paso), y con la física completa la coleta iría siempre al tope. El hueso gira hacia la punta, ±HAIR_MAX.
  var HAIR_L = 0.14, HAIR_K = 520, HAIR_C = 25, HAIR_B = 0.55, HAIR_MAX = 25 * PI / 180;
  var HQ = null, HV0, HV1, HV2, HV3, HREST;
  function hairSpring(r, dt, snap) {
    if (!HQ) { HQ = new THREE.Quaternion(); HV0 = new THREE.Vector3(); HV1 = new THREE.Vector3(); HV2 = new THREE.Vector3(); HV3 = new THREE.Vector3(); HREST = new THREE.Vector3(0, -0.85, -0.52).normalize(); }
    r.head.updateWorldMatrix(true, false);
    r.head.getWorldQuaternion(HQ);
    HV0.set(HAIR_P[0], HAIR_P[1], HAIR_P[2]).applyMatrix4(r.head.matrixWorld);          // pivote (mundo)
    HV1.copy(HREST).applyQuaternion(HQ).multiplyScalar(HAIR_L * r.scale).add(HV0);        // sitio de reposo de la punta
    if (snap || !r.hsOn || !(dt > 0)) {
      r.hsX = r.hsY = r.hsZ = 0; r.hvX = r.hvY = r.hvZ = 0; r.htX = r.htY = r.htZ = 0; r.hsOn = true;
      r.hrX = HV1.x; r.hrY = HV1.y; r.hrZ = HV1.z;
    } else {
      // aceleración del sitio de reposo (diferencias finitas; limitada: un frame perdido no la dispara)
      var tvx = (HV1.x - r.hrX) / dt, tvy = (HV1.y - r.hrY) / dt, tvz = (HV1.z - r.hrZ) / dt;
      var ax = (tvx - r.htX) / dt, ay = (tvy - r.htY) / dt, az = (tvz - r.htZ) / dt, al = Math.sqrt(ax * ax + ay * ay + az * az);
      if (al > 160) { var f = 160 / al; ax *= f; ay *= f; az *= f; }
      r.hrX = HV1.x; r.hrY = HV1.y; r.hrZ = HV1.z; r.htX = tvx; r.htY = tvy; r.htZ = tvz;
      var n = dt > 0.021 ? 2 : 1, h = Math.min(dt, 0.05) / n;
      for (var i = 0; i < n; i++) {
        r.hvX += (-HAIR_K * r.hsX - HAIR_C * r.hvX - HAIR_B * ax) * h;
        r.hvY += (-HAIR_K * r.hsY - HAIR_C * r.hvY - HAIR_B * ay) * h;
        r.hvZ += (-HAIR_K * r.hsZ - HAIR_C * r.hvZ - HAIR_B * az) * h;
        r.hsX += r.hvX * h; r.hsY += r.hvY * h; r.hsZ += r.hvZ * h;
      }
    }
    HV1.x += r.hsX; HV1.y += r.hsY; HV1.z += r.hsZ;                                        // punta actual
    // dirección actual en el espacio de la cabeza, limitada a ±HAIR_MAX del reposo
    HV2.copy(HV1).sub(HV0);
    HQ.invert(); HV2.applyQuaternion(HQ).normalize();
    var c = clamp(HV2.dot(HREST), -1, 1), a = Math.acos(c);
    if (a > HAIR_MAX) {
      // vuelve hacia el reposo: la parte perpendicular escalada para quedar en HAIR_MAX
      HV3.copy(HV2).addScaledVector(HREST, -c).normalize();
      HV2.copy(HREST).multiplyScalar(Math.cos(HAIR_MAX)).addScaledVector(HV3, Math.sin(HAIR_MAX));
      a = HAIR_MAX;
      // el desfase se recorta al cono (sin acumular energía fuera del límite) y pierde la velocidad hacia fuera
      HV3.copy(HV2).applyQuaternion(HQ.invert()).multiplyScalar(HAIR_L * r.scale).add(HV0); HQ.invert();
      HV3.x -= HV1.x - r.hsX; HV3.y -= HV1.y - r.hsY; HV3.z -= HV1.z - r.hsZ;              // nuevo desfase = punta recortada - reposo
      var ol = Math.sqrt(r.hsX * r.hsX + r.hsY * r.hsY + r.hsZ * r.hsZ) || 1, ux = r.hsX / ol, uy = r.hsY / ol, uz = r.hsZ / ol, vo = r.hvX * ux + r.hvY * uy + r.hvZ * uz;
      if (vo > 0) { r.hvX -= vo * ux; r.hvY -= vo * uy; r.hvZ -= vo * uz; }
      r.hsX = HV3.x; r.hsY = HV3.y; r.hsZ = HV3.z;
    }
    r.hairAng = a * 180 / PI;
    r.hair.quaternion.setFromUnitVectors(HREST, HV2);
  }

  // =====================================================================
  //  ORIENTACIÓN
  // =====================================================================
  function desiredYaw(g, r) {
    var p = r.p, b = g.ball, sd = side(p.team), net = sd > 0 ? PI : 0;
    var tm = g.time;
    var dvy = tm - r.diveT;
    if ((dvy >= 0 && dvy < 5 && (dvy < r.diveEnd + 0.1 || r.diveUp < 0.999)) || r.pdW > 0) return r.diveYaw;   // ya de pie: libre
    if (g.mode === 'point' || g.mode === 'over') {
      var cyw = cvYaw(g, r); if (cyw === cyw) return cyw;
      if (tm - r.pointT >= 0 && r.pointWin && r.celeb === 2 && r.mateHF && !r.matchEnd) {
        var m = VB.Sim.other(g, p); return Math.atan2(m.y - p.y, m.x - p.x) - 0.35;
      }
      return r.hasFace ? r.faceKeep : r.yaw;
    }
    if (g.mode === 'serve' && g.serving === p.team) return net;
    var dx = b.x - p.x, dy = b.y - p.y;
    if (dx * dx + dy * dy < 0.04) return r.yaw;
    var yb = Math.atan2(dy, dx);
    // carrera rápida alejándose del balón: nada de correr de espaldas; las caderas y el cuerpo giran hacia donde corre
    // (60º hacia el lado del balón) y la cabeza mira atrás por encima del hombro
    var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (g.mode === 'rally' && p.z < 0.02 && !(p.down > 0) && sp > (r.bkOn ? 1.8 : 2.2)) {
      var ry = Math.atan2(p.vy, p.vx), rel = wrapA(ry - yb);
      if (Math.abs(rel) > (r.bkOn ? 1.35 : 1.55)) { r.bkOn = true; return wrapA(ry - (rel > 0 ? 1 : -1) * 1.05); }
    }
    r.bkOn = false;
    // en la red (bloqueo / remate) se mira sobre todo a la red
    // el bloqueador en el aire va de frente a la red (las manos pasan la cinta en recto)
    if (p.z > 0.05 && r.jumpKind === 'block' && Math.abs(p.x) < 1.7) return net + clamp(wrapA(yb - net), -0.18, 0.18);
    if (Math.abs(p.x) < 1.7 && (p.z > 0.05 || (g.mode === 'rally' && g.touchTeam === 1 - p.team && g.touches >= 1))) {
      return net + clamp(wrapA(yb - net), -0.5, 0.5);
    }
    if (p.z > 0.05 && r.jumpKind === 'attack') return net + clamp(wrapA(yb - net), -0.7, 0.7);
    return yb;
  }

  /** Giro del cuerpo con un muelle angular críticamente amortiguado y límites de velocidad y aceleración (sin giros
   *  instantáneos): de pie 9 rad/s, en el aire 4 rad/s (no hay apoyo para girar), en el impulso de la plancha 22 rad/s. */
  var TURN_W = 15, TURN_VMAX = 9, TURN_VAIR = 4, TURN_VDIVE = 22, TURN_AMAX = 75, TURN_AAIR = 30;
  function turnSpring(g, r, want, dt) {
    var p = r.p, dv = g.time - r.diveT, diveNow = (dv >= -0.05 && dv < 0.3) || r.pdW > 0.05, air = p.z > 0.05;
    // a la carrera (salida de un sprint) el giro de caderas es más rápido: hasta 11,5 rad/s
    var run = air ? 0 : sstep(1.5, 3.5, Math.sqrt(p.vx * p.vx + p.vy * p.vy));
    var vmax = diveNow ? TURN_VDIVE : air ? TURN_VAIR : TURN_VMAX + 2.9 * run, amax = diveNow ? 600 : air ? TURN_AAIR : TURN_AMAX + 140 * run, w0 = diveNow ? 30 : TURN_W + 12 * run;
    var err = wrapA(want - r.yaw), v = r.yawV;
    // paso exacto del muelle (estable con dt grande) y luego límites de aceleración y velocidad
    var ex = Math.exp(-w0 * dt), vNew = (v - (v + w0 * -err) * w0 * dt) * ex;   // v(t) de un muelle crítico con error err
    var acc = clamp((vNew - v) / dt, -amax, amax);
    v = clamp(v + acc * dt, -vmax, vmax);
    // sin pasarse: si el paso cruza el objetivo con poca velocidad, se queda en él
    var stepA = v * dt;
    if ((err > 0 && stepA > err) || (err < 0 && stepA < err)) { stepA = err; v = 0; }
    r.yaw = wrapA(r.yaw + stepA); r.yawV = v; r.yawRate = v;
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

  /** Galón (V hacia abajo, punta en el origen) en una sola geometría: filo oscuro detrás y relleno naranja delante. */
  var CHEV_FILL = 0xff7a3d, CHEV_EDGE = 0x2a1308;
  function chevronGeometry() {
    function shape(k, cy) {
      var P = [[-0.17, 0.2], [-0.085, 0.2], [0, 0.105], [0.085, 0.2], [0.17, 0.2], [0, 0]], sh = new THREE.Shape();
      for (var i = 0; i < P.length; i++) { var x = P[i][0] * k, y = cy + (P[i][1] - cy) * k; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); }
      return new THREE.ShapeGeometry(sh).toNonIndexed();
    }
    var edge = shape(1.24, 0.12), fill = shape(1, 0.12), pos = [], col = [], cE = new THREE.Color(CHEV_EDGE), cF = new THREE.Color(CHEV_FILL).multiplyScalar(0.78);
    [[edge, cE, -0.004], [fill, cF, 0]].forEach(function (L) {
      var a = L[0].attributes.position;
      for (var i = 0; i < a.count; i++) { pos.push(a.getX(i), a.getY(i) - 0.012 * (L[2] ? 1 : 0), L[2]); col.push(L[1].r, L[1].g, L[1].b); }
      L[0].dispose();
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
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
    IKx = new THREE.Vector3(); IKy = new THREE.Vector3(); IKz = new THREE.Vector3(); IKm = new THREE.Matrix4(); HC = new THREE.Vector3(); ZERO3 = new THREE.Vector3(); XAXIS = new THREE.Vector3(1, 0, 0);
  }

  function rigFor(p) {
    var key = p.id + ':' + p.team + ':' + p.num + ':' + kitSig + (p.role ? ':' + p.role : '') + ':' + VEN;   // 6v6: el puesto cambia aspecto y equipación; TAJO: escenario
    var r = cache[key];
    if (!r) { r = cache[key] = buildRig(p); }
    r.p = p; return r;
  }
  function resetRig(r) {
    r.callT = -99; r.callKey = -99; r.tgtW = 0; r.fxForce = '';
    r.inited = false; r.hitT = r.jumpT = r.landT = r.blockT = r.swingT = r.pointT = r.diveT = r.tossT = -99;
    r.hitKind = ''; r.hitShot = ''; r.hitGrade = ''; r.jumpKind = ''; r.hasFace = false; r.yawRate = 0; r.yawV = 0; r.vf = r.vl = 0;
    r.diveUp = 1; r.diveDz = 0; r.ozGiven = 0; r.upBoost = 0; r.offX = r.offY = r.ox0 = r.oy0 = 0; r.lpx = r.p.x; r.lpy = r.p.y;
    r.fk[0].lock = r.fk[1].lock = false; r.locoOwn = 0; r.aw0 = r.aw1 = 0; r.hitMode = ''; r.pdW = 0; r.pdLive = false; r.diveTc = 0;
  }

  /** 6v6: si cambió quién está en pista (líbero que entra por un central, cambios: VB.Sim.refreshTeams), rehace la lista de
   *  rigs sin tocar a los que siguen; el que entra aparece ya en su sitio (resetRig: primera pose sin amortiguar) y el que sale
   *  desaparece. Coste por frame sin cambios: comparar g.players.length referencias. */
  function syncRigs(g) {
    var pl = g.players, same = rigs.length === pl.length;
    for (var i = 0; same && i < pl.length; i++) if (rigs[i].p !== pl[i]) same = false;
    if (same) return false;
    var old = rigs.slice();
    rigs.length = 0; byId.length = 0;
    for (i = 0; i < pl.length; i++) {
      var r = rigFor(pl[i]);
      if (old.indexOf(r) < 0) { resetRig(r); r.far = false; r.skin.castShadow = true; if (LODR > 0) rigGeometry(r, LODR - 1); if (LODR < 2) rigGeometry(r, 2); }
      if (QRANK > 0) ensureInk(r);
      rigs.push(r); byId[pl[i].id] = r;
      if (r.root.parent !== groupRoot) groupRoot.add(r.root);
    }
    for (i = 0; i < old.length; i++) if (rigs.indexOf(old[i]) < 0) groupRoot.remove(old[i].root);   // los que salen de pista
    return true;
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
      var since = (C.JUMP_V * (p.ak ? p.ak.jump : 1) - p.vz) / G, tj = tm - r.jumpT; // con atributos, su salto (Salto)
      if (!(tj > since - 0.12 && tj < since + 0.12)) {
        r.jumpT = tm - since;
        r.jumpKind = p.lastAction === 'block' ? 'block' : p.lastAction === 'spike' || p.lastAction === 'serve' ? 'attack' : classifyJump(g, p);
      }
      // salto de ataque que no llegó a golpear y el rival ya ataca: se convierte en bloqueo
      if (r.jumpKind === 'attack' && g.mode === 'rally' && r.hitT < r.jumpT && Math.abs(p.x) < 1.7 &&
          g.touchTeam === 1 - p.team && g.lastKind !== 'serve' && p.lastAction === 'jump' && !(g.jobs && g.jobs[p.team] === p)) r.jumpKind = 'block';
    }
  }

  /** Desfase visual (mundo, coords de sim) de la raíz tras una plancha: el avance del cuerpo pasa a la raíz al
   *  levantarse; mientras está en el suelo o levantándose, la raíz no sigue a la sim (sin deslizarse tumbado); si la
   *  sim ya lo mueve, se levanta antes. Después el desfase se recupera "corriendo" (<= 3 m/s, con zancada). */
  function diveOffset(g, r, dt, snap) {
    var p = r.p;
    r.ox0 = r.offX; r.oy0 = r.offY;
    if (snap) { r.lpx = p.x; r.lpy = p.y; return; }
    var dv = g.time - r.diveT, active = diveActive(r, dv);
    var mx = p.x - r.lpx, my = p.y - r.lpy; r.lpx = p.x; r.lpy = p.y;
    if ((g.mode === 'point' || g.mode === 'over') && !active && cvOffset(g, r)) return;
    if (!active && approachOffset(g, r)) return;
    if (active) {
      var cx = Math.cos(r.diveYaw), cy = Math.sin(r.diveYaw), want = r.diveDz * r.diveUp, dl = (want - r.ozGiven) * r.scale;
      r.ozGiven = want; r.offX += cx * dl; r.offY += cy * dl;
      if (dv > r.diveTc && r.diveUp < 0.999) {
        r.offX -= mx; r.offY -= my;                                    // tumbado/levantándose: la raíz se queda
        var sp = Math.sqrt(mx * mx + my * my) / dt;
        // se levanta antes (en ~0,3 s en vez de 0,55 s), nunca mientras la sim lo tenga en el suelo
        if (sp > 0.3 && !(p.down > 0.04)) r.upBoost = Math.min(r.diveEnd - 0.2, r.upBoost + dt * 0.8);
        return;
      }
    }
    if (sepOffset(g, r, dt)) return;
    // recuperación: el desfase se reduce (exponencial) con la velocidad VISUAL limitada a max(4 m/s, la de la sim)
    if (r.offX === 0 && r.offY === 0) return;
    var dk = kf(4, dt), ox = r.offX * (1 - dk), oy = r.offY * (1 - dk);
    var vx = mx + ox - r.offX, vy = my + oy - r.offY, vl = Math.sqrt(vx * vx + vy * vy), ml = Math.sqrt(mx * mx + my * my);
    var cap = Math.max(4 * dt, ml * 1.05);
    if (vl > cap) { var f = cap / vl; ox = r.offX + vx * f - mx; oy = r.offY + vy * f - my; }
    if (ox * ox + oy * oy < 1e-4) { ox = 0; oy = 0; }
    r.offX = ox; r.offY = oy;
  }

  /** Separación VISUAL entre compañeros (p. ej. el doble bloqueo al caer): si las raíces quedan a menos de SEP_MIN,
   *  cada uno se aparta la mitad de lo que falta (todo, si el otro está en plancha o en carrera de ataque) (<= 1,6 m/s, entra en la velocidad visual: da un pasito, no patina).
   *  Mientras se solapan no se recupera el desfase; cuando la sim los separa, vuelve a cero como el de la plancha. */
  var SEP_MIN = 0.5;
  function sepOffset(g, r, dt) {
    var p = r.p, q = mateOf(g, p), m = q && q !== p && byId[q.id];
    if (!m || !m.inited) return false;
    var dx = p.x + r.offX - q.x - m.offX, dy = p.y + r.offY - q.y - m.offY, d2 = dx * dx + dy * dy;
    if (d2 >= SEP_MIN * SEP_MIN) return false;
    var d = Math.sqrt(d2);
    if (d < 1e-3) { dx = r.id < q.id ? -1 : 1; dy = 0; d = 1; }      // encima: se apartan a lo largo de la red
    // si el compañero está en plancha o en carrera de ataque (su raíz no se aparta) se aparta él solo todo lo que falta
    var solo = m.apOn || diveActive(m, g.time - m.diveT);
    var push = Math.min((SEP_MIN - Math.sqrt(d2)) * (solo ? 1 : 0.5), (solo ? 2.5 : 1.6) * dt) / d;
    r.offX += dx * push; r.offY += dy * push;
    return true;
  }

  /** Plancha cosmética (el balón cae dentro y nadie llegó): solo si se lee como un intento real: a distancia de
   *  plancha (1,3-2,8 m), con tiempo de reacción (>= 0,4 s desde el último toque), sin haber tocado él el balón,
   *  sin alejarse de él y con el balón por delante o a un lado (nadie se tira hacia atrás). */
  function cosmeticDiveOk(g, r, e, bd, tm) {
    var q = r.p;
    if (bd < 1.3 || bd > 2.8 || q.down > 0 || tm - r.diveT < 1.5) return false;
    if (tm - r.hitT < 0.6 || tm - r.landT < 0.25) return false;
    if (g.lastTouchT != null && tm - g.lastTouchT < 0.4) return false;
    var ux = (e.x - q.x) / bd, uy = (e.y - q.y) / bd;
    if (q.vx * ux + q.vy * uy < -0.6) return false;
    return Math.cos(r.yaw) * ux + Math.sin(r.yaw) * uy > -0.3;
  }

  function onEvent(g, e) {
    var r, tm = e.t != null ? e.t : g.time;
    if (e.player && e.player.id != null) r = byId[e.player.id];
    switch (e.type) {
      case 'hit':
        if (!r) return;
        r.hitT = tm; r.hitKind = e.kind; r.hitQ = e.quality == null ? 1 : e.quality; r.hitShot = e.shot || ''; r.hitGrade = e.grade || '';
        hitAnchor(g, r, e);
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
        // con la plancha ya prevista (impulso en curso) el contacto llega a DIVE_PRE × progreso s de la plancha
        var Lc = (r.pdW > 0.05 && tm - r.pdT0 < 0.5) ? DIVE_PRE * r.pdW : 0;
        r.diveT = tm - Lc; r.diveTc = Lc; r.diveEnd = Lc + 0.6;
        r.diveDist = diveDistFor(r, Math.sqrt((e.x - r.p.x) * (e.x - r.p.x) + (e.y - r.p.y) * (e.y - r.p.y)), Lc);
        r.diveUp = 0; r.ozGiven = 0; r.upBoost = 0; r.pdW = 0; r.pdLive = false;
        r.diveYaw = e.dir ? Math.atan2(e.dir[1], e.dir[0]) : r.yaw;
        break;
      case 'block': if (r) { r.blockT = tm; lastBlocker = r; } break;
      case 'swing': if (r) r.swingT = tm; break;
      case 'serveReady':
        for (var i = 0; i < rigs.length; i++) { rigs[i].diveT = -99; rigs[i].pdW = 0; rigs[i].pdLive = false; rigs[i].pointT = -99; rigs[i].hasFace = false; rigs[i].cosDust = false; rigs[i].diveUp = 1; rigs[i].offX = rigs[i].offY = 0; rigs[i].ozGiven = 0; rigs[i].upBoost = 0; }
        lastBlocker = null;
        for (var ci = 0; ci < 2; ci++) if (CVP[ci]) { CVP[ci].on = false; CVP[ci].clap = false; }
        // la sim recoloca a todos en este instante: la pose también se coloca sin muelle (sin un frame de pose vieja)
        for (var ri = 0; ri < rigs.length; ri++) { rigs[ri].inited = false; rigs[ri].fk[0].lock = rigs[ri].fk[1].lock = false; }
        break;
      case 'land':
        // plancha del defensor más cercano si el balón cae dentro de su campo y no llegó, SOLO si se lee como
        // un intento real (cosmeticDiveOk)
        if (!e.inside) return;
        var best = null, bd = 9;
        for (var j = 0; j < rigs.length; j++) {
          var q = rigs[j].p; if (q.team !== e.team || q.z > 0.05) continue;
          var d = Math.hypot(e.x - q.x, e.y - q.y);
          if (d < bd) { bd = d; best = rigs[j]; }
        }
        if (best && cosmeticDiveOk(g, best, e, bd, tm)) {
          best.diveT = tm - 0.12; best.diveTc = 0.12; best.diveEnd = 0.72; best.cosDust = true; best.diveYaw = Math.atan2(e.y - best.p.y, e.x - best.p.x);
          // las manos (≈1,55 m por delante de los pies, tumbado) acaban junto al balón
          best.diveDist = clamp(bd - 1.5, 0, 1.2) / best.scale; best.diveUp = 0; best.ozGiven = 0; best.upBoost = 0;
        }
        break;
      case 'point':
        var won = e.team, sum = (e.score ? e.score[0] + e.score[1] : 0);
        for (var k = 0; k < rigs.length; k++) {
          var rr = rigs[k], pp = rr.p;
          rr.pointT = tm; rr.pointWin = pp.team === won; rr.matchEnd = !!e.matchWon;
          rr.celeb = (sum + pp.idx * 2 + (e.setWon ? 1 : 0)) % 3;
          var scR = e.how === 'ace' && g.server && g.server.team === won ? byId[g.server.id] : e.how === 'block' && lastBlocker && lastBlocker.team === won ? lastBlocker : (g.lastTeam === won && g.lastPlayer) ? byId[g.lastPlayer.id] : null;
          rr.celV = e.matchWon ? '' : pickCeleb(g, rr, e, scR); rr.lastCel = rr.celV; rr.celId = rr.celV;
          rr.faceKeep = rr.yaw; rr.hasFace = true;
          var mate = VB.Sim.other(g, pp);
          rr.mateHF = Math.hypot(mate.x - pp.x, mate.y - pp.y) < 3.2;
          // los dos del equipo ganador comparten el choque de manos
          if (rr.pointWin && rr.mateHF && (sum % 3 === 2 || e.setWon)) rr.celeb = 2;
          // punto de bloqueo: el bloqueador ruge hacia la red (su compañero mantiene su celebración)
          if (e.how === 'block' && rr === lastBlocker && rr.pointWin && !e.matchWon) rr.celeb = 3;
        }
        cvPoint(g, e);
        // el que da las palmadas de ánimo (convergencia de los que pierden) lleva esa variante
        var lc = CVP[1 - won];
        if (lc && lc.clap && byId[lc.clapper]) { var rc = byId[lc.clapper]; if (rc.lastPrev === 'clapUp') lc.clap = false; else { rc.celV = 'clapUp'; rc.celId = 'clapUp'; rc.lastCel = 'clapUp'; } }
        for (var kk = 0; kk < rigs.length; kk++) rigs[kk].lastPrev = rigs[kk].lastCel;
        break;
    }
  }

  VB.Players = {
    rigs: rigs,
    /** La convergencia sigue la coreografía de VB.CameraRig.heroShot() (CAM-02). */
    heroShotAware: true,
    init: function (c) {
      ctx = c; THREE = c.THREE; C = VB.C; if (C && C.BR) BR = C.BR;
      ensureTemps();
      groupRoot = new THREE.Group(); groupRoot.name = 'players'; ctx.scene.add(groupRoot);
      // marcador del jugador controlado: aro luminoso + flecha flotante
      markerMat = new THREE.MeshBasicMaterial({ map: markerTexture(), transparent: true, depthWrite: false, opacity: 1, toneMapped: false });
      marker = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), markerMat);
      marker.rotation.x = -PI / 2; marker.position.y = 0.018; marker.renderOrder = 3; ctx.scene.add(marker);
      // indicador flotante: galón naranja del equipo con filo oscuro, plano y siempre de cara a la cámara, de tamaño
      // constante en pantalla; color lineal por debajo del umbral del bloom (nunca se quema en blanco). 1 dibujo.
      coneMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: true });
      markerCone = new THREE.Mesh(chevronGeometry(), coneMat);
      markerCone.renderOrder = 4; markerCone.visible = false; ctx.scene.add(markerCone);
    },
    setQuality: function (q) {
      // cada atleta es UNA malla con piel (1 dibujo + 1 sombra); la calidad elige el nivel de detalle
      // de la malla (alta ~10k, media ~4k, baja ~2k triángulos por atleta) y el filtrado del atlas
      var rank = q && q.rank != null ? q.rank : 2;
      setLod(rank);
      // contorno de tinta: no en baja (1 dibujo menos por atleta); se crea al subir de baja a media/alta
      QRANK = rank;
      for (var ck in cache) { var cr = cache[ck]; if (rank > 0) ensureInk(cr); if (cr.ink) cr.ink.visible = rank > 0; }
      var aniso = rank > 0 ? 4 : 1;
      for (var k in cache) { var m = cache[k].skin.material.map; if (m && m.anisotropy !== aniso) { m.anisotropy = aniso; m.needsUpdate = true; } }
    },
    /** Equipación personalizable: aplica settings.kit* (ver setKit arriba). Con g, reconstruye ya los atletas del partido
     *  visible (la demo del menú o el partido en pausa). Devuelve true si cambió algo. */
    setKit: function (st, g) { var ch = setKit(st); if (ch && g) this.onGameStart(g); return ch; },
    /** Colores actuales (para la UI): {t0: {base, accent, shorts}, t1: {...}}. */
    /** 6v6: color de la camiseta del líbero del equipo t (0xRRGGBB; para la UI o pruebas). */
    liberoColor: function (t) { return liberoKit(t ? 1 : 0).base; },
    kitColors: function () { return { t0: { base: TEAMS[0].base, accent: TEAMS[0].accent, shorts: TEAMS[0].shorts }, t1: { base: TEAMS[1].base, accent: TEAMS[1].accent, shorts: TEAMS[1].shorts } }; },
    /** TAJO: escenario con el que se visten los atletas ('hall' | 'beach'). */
    venue: function () { return VEN; },
    /** TAJO (pruebas): fuerza el escenario de los atletas ('hall' | 'beach'; '' = el de arena). Con g, los reconstruye ya. */
    setVenue: function (v, g) { VEN_FORCE = v === 'beach' || v === 'hall' ? v : ''; var ch = syncVenue(); if (ch && g) this.onGameStart(g); return ch; },
    onGameStart: function (g) {
      syncVenue();
      for (var i = 0; i < rigs.length; i++) groupRoot.remove(rigs[i].root);
      rigs.length = 0; byId.length = 0;
      for (var j = 0; j < g.players.length; j++) {
        var r = rigFor(g.players[j]); resetRig(r); r.skin.castShadow = true; r.far = false;
        rigs.push(r); byId[g.players[j].id] = r; groupRoot.add(r.root);
        // la calidad adaptativa solo baja: el nivel inferior se prepara ya (el paso a menos calidad no espera a la geometría)
        if (LODR > 0) rigGeometry(r, LODR - 1);
        // primeros planos (screenLod): la malla completa también preparada, para no construirla en mitad de la jugada
        if (LODR < 2) rigGeometry(r, 2);
      }
    },
    /** Rig de un jugador de la simulación (para cámara/FX).
     *  Campos útiles: root, body, pelvis, chest, head, handL, handR, footL, footR (Object3D; usar getWorldPosition). */
    /** Contactos cosméticos de la celebración (choques de manos, puños, palmadas) desde la última llamada:
     *  añade a `out` objetos {type:'highfive'|'fistbump'|'chestbump'|'clap', team, x, y, z (coords de la sim), strength 0..1}. */
    drainFx: function (out) { for (var i = 0; i < FXQ.length; i++) out.push(FXQ[i]); FXQ.length = 0; return out; },
    /** Depuración (pruebas): estado del galón del jugador controlado. */
    _marker: function () { return markerCone ? { visible: markerCone.visible, opacity: +coneMat.opacity.toFixed(3), y: +markerCone.position.y.toFixed(2), scale: +markerCone.scale.x.toFixed(2), calls: 1 } : null; },
    /** Depuración (pruebas): reloj del cuadro vivo de la escena congelada del punto (s desde la escena; -1 sin cuadro). */
    _tab: function () { return TAB.g ? { t: +TAB.t.toFixed(3), max: +TAB.max.toFixed(3) } : -1; },
    rigOf: function (p) { return p && byId[p.id] && byId[p.id].p === p ? byId[p.id] : null; },
    /** Pruebas (PLY-18): fuerza una expresión ('shout'|'effort'|'joy'|'sad'|'neutral'; '' = automática) durante `sec` s
     *  de tiempo real (sec < 0: hasta que se quite). */
    _face: function (p, expr, sec) { var r = this.rigOf(p); if (!r) return false; r.fxForce = expr || ''; r.fxForceT = sec == null || sec < 0 ? -1 : ctx.time + sec; return true; },
    /** Frente (rad, coords de sim, como rig.yaw) hacia el que va a mirar el jugador: en el punto, el OBJETIVO del giro de la
     *  celebración (compañero, cámara del héroe…); si no, el frente actual. Lo usa camera.js (planHero) con guarda. */
    faceOf: function (p) {
      var r = this.rigOf(p), g = ctx && ctx.game; if (!r) return NaN;
      if (g && (g.mode === 'point' || g.mode === 'over')) { try { var f = desiredYaw(g, r); if (f === f) return f; } catch (e) { } }
      return r.yaw;
    },
    /** Posición mundial (Three) de la mano derecha/izquierda del jugador. OPCIONAL. */
    handWorld: function (p, right, out) {
      var r = this.rigOf(p); if (!r) return null;
      out = out || new THREE.Vector3(); return (right === false ? r.handL : r.handR).getWorldPosition(out);
    },
    update: function (g, dt, events) {
      if (!g) return;
      // ESCENA CONGELADA DEL PUNTO (?debug=point|ace): la sim está parada 0,5 s después del punto, pero la celebración
      // (convergencia, choque de manos, variantes de tres tiempos) se representa en tiempo real como un cuadro vivo:
      // durante este update se adelantan g.time / g.timer con el reloj real y se anulan las velocidades de la sim (las
      // posiciones no cambian: sin esto correría en el sitio); todo se restaura al salir (los demás módulos no lo ven).
      // Solo con la sim parada de verdad (dt = 0): las herramientas que avanzan la sim a mano con ctx.frozen (film.js) no lo ven.
      // El cuadro dura hasta TAB_END s después del punto (los tres tiempos completos de la celebración y la vuelta), espera
      // TAB_HOLD s en la última pose y vuelve a empezar re-emitiendo el mismo 'point' (pickCeleb no repite variante: cada
      // vuelta enseña otra celebración). La pausa virtual no baja de 0,5 s (la vuelta a su sitio es la de la coreografía).
      if (ctx.frozen && ctx.debug) for (var ei = 0; ei < events.length; ei++) if (events[ei].type === 'point') TAB.ev = events[ei];
      if (ctx.frozen && ctx.debug && !(dt > 0) && g.mode === 'point' && !g.finished && rigs.length && rigs[0].p === g.players[0]) {
        if (TAB.g !== g || TAB.t0 !== g.time) { TAB.g = g; TAB.t0 = g.time; TAB.t = 0; TAB.max = Math.max(0, TAB_END - (g.hold ? g.hold - (g.timer || 0) : 0.5)); }
        var rdt = Math.min(0.05, Math.max(0, ctx.realDt || 0));
        TAB.t += rdt;
        var again = TAB.t > TAB.max + TAB_HOLD && TAB.ev;
        if (again) TAB.t = 0;
        var time0 = g.time, timer0 = g.timer, pl = g.players, vs = TAB.v;
        for (var q = 0; q < pl.length; q++) { vs[2 * q] = pl[q].vx; vs[2 * q + 1] = pl[q].vy; pl[q].vx = pl[q].vy = 0; }
        var tv = Math.min(TAB.t, TAB.max);
        g.time = time0 + tv; g.timer = Math.max(Math.min(timer0, 0.5), timer0 - tv);
        try {
          if (again) onEvent(g, TAB.ev);
          this._update(g, rdt > 0 ? rdt : 1e-4, events); }
        finally { g.time = time0; g.timer = timer0; for (q = 0; q < pl.length; q++) { pl[q].vx = vs[2 * q]; pl[q].vy = vs[2 * q + 1]; } }
        return;
      }
      TAB.g = null; if (!ctx.frozen) TAB.ev = null;
      this._update(g, dt, events);
    },
    _update: function (g, dt, events) {
      if (syncVenue() || !rigs.length || rigs[0].p !== g.players[0]) this.onGameStart(g);   // TAJO: al cambiar de escenario, se visten de nuevo
      else if (g.size > 2) syncRigs(g);   // 6v6: el líbero (o un cambio) entra/sale de pista sin rehacer a los demás
      var i;
      // los rigs recién creados se orientan antes de leer eventos (puntos de contacto en su espacio)
      for (i = 0; i < rigs.length; i++) if (!rigs[i].inited) rigs[i].yaw = desiredYaw(g, rigs[i]);
      for (i = 0; i < events.length; i++) { try { onEvent(g, events[i]); } catch (e) { if (!window.__plErr) { window.__plErr = 1; console.error("[VB][ERROR] Players.onEvent: " + e); } } }
      if (g.mode === 'point' || g.mode === 'over') for (i = 0; i < 2; i++) if (CVP[i] && CVP[i].on && CVP[i].ts < 0) cvStart(g, CVP[i], i);
      var frozen = ctx.frozen, paused = dt <= 0 && !frozen;
      for (var k = 0; k < rigs.length; k++) {
        var r = rigs[k], p = r.p;
        if (paused && r.inited) continue; // pausa: se mantiene la pose
        var snap = !r.inited || dt <= 0;
        // posición y orientación
        var want = desiredYaw(g, r);
        if (snap) { r.yaw = want; r.yawRate = 0; r.yawV = 0; }
        else turnSpring(g, r, want, dt);
        r.root.rotation.y = Math.atan2(Math.cos(r.yaw), -Math.sin(r.yaw));
        // velocidad en ejes del cuerpo (suavizada)
        var fx = Math.cos(r.yaw), fy = Math.sin(r.yaw);
        // la velocidad VISUAL incluye la del desfase de la plancha (si lo recupera corriendo, los pies no patinan)
        var vx = p.vx, vy = p.vy;
        if (!snap) { vx += (r.offX - r.ox0) / dt; vy += (r.offY - r.oy0) / dt; }
        var vf = vx * fx + vy * fy, vl = vx * -fy + vy * fx;
        if (p.z > 0.01) { vf = 0; vl = 0; }
        if (snap) { r.vf = vf; r.vl = vl; } else { var kv = kf(14, dt); r.vf += (vf - r.vf) * kv; r.vl += (vl - r.vl) * kv; }
        if (!snap) r.clock += dt;
        syncFromSim(g, r);
        computeTarget(g, r, dt, snap);
        dampPose(r, dt, snap);
        diveOffset(g, r, dt, snap);
        var rp = r.root.position; rp.x = p.x + r.offX; rp.y = p.z; rp.z = -(p.y + r.offY); // = VB.toThree (sin HeapNumbers)
        footLock(r, p.z > 0.012, snap, dt);
        applyPose(r);
        squash(g, r);
        // compresión del brazo que golpea (0,06 s tras el remate)
        var ha = g.time - r.hitT, sq = (r.hitAir && ha >= 0 && ha < 0.06 && r.hitShot !== 'tip') ? Math.sin(ha / 0.06 * PI) : 0;
        r.up[1].scale.set(1 + 0.1 * sq, 1, 1 + 0.1 * sq);
        aimHead(r, g, dt, snap);
        updateFace(g, r, dt, snap);
        hairSpring(r, dt, snap);
        r.inited = true;
      }
      screenLod(g);
      for (i = 0; i < rigs.length; i++) { var ik = rigs[i].ink; if (ik && ik.geometry !== rigs[i].skin.geometry) ik.geometry = rigs[i].skin.geometry; }
      cvEmit(g, dt);
      // marcador del jugador controlado
      var show = !g.demo && !g.watch && ctx.state !== 'menu' && g.ctrl; // (6v6 espectador, g.watch: sin halo ni flecha)
      marker.visible = markerCone.visible = !!show;
      if (show) {
        var c = g.ctrl, reach = VB.Sim.canReach(g, c), rc0 = byId[c.id];
        // halo bajo los pies VISUALES (en la celebración del punto el rig se separa de la sim)
        var hx = c.x + (rc0 ? rc0.offX : 0), hy = c.y + (rc0 ? rc0.offY : 0);
        marker.position.x = hx; marker.position.z = -hy;
        // con el aro amarillo de FX (focusPoint) cerca de los pies, el halo se encoge y se atenúa: no compite con él
        var fp = g.mode === 'rally' && g.jobs && g.jobs[0] && VB.Sim.focusPoint ? VB.Sim.focusPoint(g) : null, nearF = 0;
        if (fp && fp.x === fp.x) { var fdx = fp.x - hx, fdy = fp.y - hy; nearF = 1 - sstep(0.9, 2.4, Math.sqrt(fdx * fdx + fdy * fdy)); }
        var pulse = (reach ? 1.08 + Math.sin(ctx.time * 16) * 0.07 : 1) * (1 - 0.38 * nearF);
        marker.scale.set(pulse, pulse, pulse);
        // balón muerto (punto / final): el halo se funde al 25 % como los controles táctiles (CAM-07): el plano de héroe queda limpio
        var hdW = (g.mode === 'point' || g.mode === 'over') ? 0.25 : 1;
        markerDim += (hdW - markerDim) * (dt > 0 ? kf(hdW < markerDim ? 3.3 : 6.6, dt) : 1);
        markerMat.opacity = (reach ? 1 : 0.8) * (1 - 0.55 * nearF) * markerDim;
        var rc = rc0, topY = (rc ? rc.scale : 1) * 2.18 + (rc ? rc.cur.s[HOP] : 0);
        // galón: tamaño constante en pantalla (escala con la distancia a la cámara), de cara a la cámara; se apaga cerca de
        // la cámara (< ~6 m: el aro del suelo ya lo marca), con el saque propio y en el aire (taparía la mano que golpea)
        var cam = ctx.camera;
        // justo encima de la cabeza REAL (agachado, en carrera o tumbado la cabeza no está a la altura de pie)
        if (rc) { rc.head.getWorldPosition(markerCone.position); markerCone.position.y += 0.3 * rc.scale + Math.sin(ctx.time * 3.2) * 0.015; }
        else markerCone.position.set(c.x, c.z + topY, -c.y);
        var cd = cam ? cam.position.distanceTo(markerCone.position) : 10;
        var want = sstep(4.8, 6.6, cd) * (c.z > 0.05 || (g.mode === 'serve' && g.server === c) || g.mode === 'point' || g.mode === 'over' ? 0 : 1); // balón muerto: sin galón (plano de héroe limpio)
        coneMat.opacity += (want - coneMat.opacity) * (dt > 0 ? kf(10, dt) : 1);
        markerCone.visible = coneMat.opacity > 0.02;
        if (cam) markerCone.quaternion.copy(cam.quaternion);
        markerCone.scale.setScalar(clamp(cd / 12.5, 0.5, 2.2));
      }
    }
  };
})();
