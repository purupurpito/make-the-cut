/* =====================================================================
 * VOLEY 3D — js/doll.js   (owner: players; MAQUETA, fase 1)
 * MUÑECO nuevo («doll»): figura redondeada y limpia de muñeco articulado (Switch Sports / Sackboy) con caricatura de
 * cómic (Windjammers 2 / Mario Strikers): cabeza grande sin cuello, cara enorme dibujada, tubos con bolas en las
 * articulaciones, manoplas y zapatones, ropa PINTADA en la textura, contorno de tinta de color y dos bandas de sombra.
 *
 * Se construye sobre el MISMO esqueleto que players.js (27 huesos, mismos nombres y orden: body, pelvis, spine, chest,
 * head, eyes, mouth, teeth, browL, browR, hair, [sh, up, el, hand, hip, th, kn, ft] × izquierda/derecha), así en la fase 2
 * la animación procedural, la IK y la sim no cambian. Las LONGITUDES sí cambian (piernas cortas, tronco largo, brazo algo
 * más largo) pero el ALCANCE con el brazo estirado (hombro + brazo + antebrazo + palma) es el del atleta: VB.Players.dims().
 *
 * Espacio del cuerpo como en players: mira a +Z, +X es su IZQUIERDA, +Y arriba, origen entre los pies.
 * Solo actúa en ?debug=doll (VB.Doll.start desde main.js); en el juego normal no hace nada.
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var THREE, ctx, PI = Math.PI;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mixHex(a, b, t) {
    var ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255, br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function lumHex(h) { return (0.2126 * (h >> 16 & 255) + 0.7152 * (h >> 8 & 255) + 0.0722 * (h & 255)) / 255; }
  function hexCss(h) { return '#' + ('000000' + h.toString(16)).slice(-6); }

  // ---------- Proporciones del muñeco (m): presets de cuerpo ----------
  // `chibi` (por defecto, 10-nov-2026, «¿más chibi?»): ~3,3 cabezas (cabeza 0,50 m, algo más ancha que alta), piernas 0,58 (zapatón
  // incluido), tronco 0,605 corto y redondo por abajo, hombros a 1,185, de pie 1,64 m. `v1` = la primera maqueta (4,4 cabezas, 1,86 m).
  // En los dos el ALCANCE con el brazo estirado es el del atleta (fitReach): lo que baja el hombro lo pone el brazo (de muñeco).
  // ?body=v1 lo elige en la escena; VB.Doll.setBody(nombre) cambia en caliente (pruebas y comparación antes/después).
  var BODIES = {
    v1: { ANKLE: 0.12, THIGH: 0.33, SHIN: 0.33, HIP_W: 0.085, SPINE_Y: 0.22, CHEST_Y: 0.22, SH_Y: 0.23, SH_X: 0.17, PALM: 0.10,
      HEAD_C: 0.20, HEAD_RX: 0.20, HEAD_RY: 0.21, HEAD_RZ: 0.195, TUBE_ARM: 0.047, TUBE_LEG: 0.054, BALL_SH: 0.08, BALL_EL: 0.056, BALL_KN: 0.066, BALL_HIP: 0.06,
      HAND_K: 1, FOOT_K: 1, TORSO_W: 1 },
    // ARM = hombro→muñeca en REPOSO (0,635 + palma 0,115 = 0,75 hombro→palma: la manopla cuelga a la altura de la cadera); lo que falta
    // hasta el alcance del atleta lo pone el ESTIRÓN cartoon de la IK (reachTo, hasta ×STRETCH_MAX ≈ 1,41). Sin ARM (v1): brazo a medida.
    chibi: { ANKLE: 0.12, THIGH: 0.23, SHIN: 0.23, HIP_W: 0.09, SPINE_Y: 0.2, CHEST_Y: 0.2, SH_Y: 0.205, SH_X: 0.175, PALM: 0.115, ARM: 0.635,
      HEAD_C: 0.205, HEAD_RX: 0.245, HEAD_RY: 0.25, HEAD_RZ: 0.235, TUBE_ARM: 0.05, TUBE_LEG: 0.058, BALL_SH: 0.085, BALL_EL: 0.06, BALL_KN: 0.07, BALL_HIP: 0.064,
      HAND_K: 1.15, FOOT_K: 1.15, TORSO_W: 1.12 }
  };
  var BODY = 'chibi';
  var ANKLE, THIGH, SHIN, HIP_H, HIP_W, SPINE_Y, CHEST_Y, SH_Y, SH_X, SH_Z = 0.0, SH_H, NECK_Y, PALM, UPPER, FORE;
  var HEAD_C, HEAD_RX, HEAD_RY, HEAD_RZ, TUBE_ARM, TUBE_LEG, BALL_SH, BALL_EL, BALL_KN, BALL_HIP, HAND_K, FOOT_K, TORSO_W;
  // derivados: FK = escala de la cara/pelo respecto a la cabeza de v1 (los rasgos se dibujan en metros de v1 y se escalan);
  // TORSO_K = escala vertical del perfil del tronco (diseñado para un tronco de 0,67); TR_Y0/1 = alturas de reposo que cubre la camiseta
  var HEAD_C0 = 0.20, HEAD_RY0 = 0.21, FK = 1, TORSO_K = 1, TR_Y0 = 0, TR_Y1 = 1;
  var REACH_WANT = 2.192, REACH = 0, REACH_REST = 0, STRETCH_MAX = 1, ARM_REST = 0;   // alcance del atleta; del muñeco estirado / en reposo; tope del estirón
  function applyDims(name) {
    var b = BODIES[name] || BODIES.chibi; BODY = BODIES[name] ? name : 'chibi';
    ANKLE = b.ANKLE; THIGH = b.THIGH; SHIN = b.SHIN; HIP_H = THIGH + SHIN + ANKLE; HIP_W = b.HIP_W;
    SPINE_Y = b.SPINE_Y; CHEST_Y = b.CHEST_Y; SH_Y = b.SH_Y; SH_X = b.SH_X; SH_H = HIP_H + SPINE_Y + CHEST_Y + SH_Y;
    NECK_Y = SH_Y;                           // la cabeza nace a la altura de los hombros (sin cuello)
    PALM = b.PALM;                           // muñeca → centro de la manopla (la palma se apoya en el balón)
    HEAD_C = b.HEAD_C; HEAD_RX = b.HEAD_RX; HEAD_RY = b.HEAD_RY; HEAD_RZ = b.HEAD_RZ;
    TUBE_ARM = b.TUBE_ARM; TUBE_LEG = b.TUBE_LEG; BALL_SH = b.BALL_SH; BALL_EL = b.BALL_EL; BALL_KN = b.BALL_KN; BALL_HIP = b.BALL_HIP;
    HAND_K = b.HAND_K; FOOT_K = b.FOOT_K; TORSO_W = b.TORSO_W;
    FK = HEAD_RY / HEAD_RY0; TORSO_K = (SPINE_Y + CHEST_Y + SH_Y) / 0.67;
    TR_Y0 = HIP_H - 0.13 * TORSO_K; TR_Y1 = HIP_H + 0.70 * TORSO_K;
    ARM_REST = b.ARM || 0;
    fitReach();
  }

  /** Alcance del atleta (VB.Players.dims().reach). Sin ARM en el preset, el brazo se hace a medida (hombro + brazo + antebrazo + palma =
   *  alcance, proporción 0,52/0,48) y no hay estirón. Con ARM (chibi), el brazo de reposo es corto y STRETCH_MAX es el factor de
   *  estiramiento de brazo + antebrazo que cubre el alcance: lo aplica reachTo cuando el objetivo queda fuera. */
  function fitReach() {
    var d = null;
    try { d = VB.Players && VB.Players.dims ? VB.Players.dims() : null; } catch (e) { d = null; }
    if (d && d.reach > 0) REACH_WANT = d.reach;
    var arm = ARM_REST > 0 ? ARM_REST : REACH_WANT - SH_H - PALM;
    UPPER = arm * 0.52; FORE = arm * 0.48;
    REACH_REST = SH_H + UPPER + FORE + PALM;
    STRETCH_MAX = Math.max(1, (REACH_WANT - SH_H - PALM) / (UPPER + FORE));
    REACH = SH_H + (UPPER + FORE) * STRETCH_MAX + PALM;
  }

  // ---------- Equipos (misma paleta que players) ----------
  var TEAMS = [
    { base: 0xff5a2c, accent: 0xffb238, dark: 0x6e1606, trim: 0xffffff, shorts: 0x191b22, pad: 0x1d1f26, sole: 0xff6a2a, numFill: '#ffffff' },
    { base: 0x3363ea, accent: 0xbcd8ff, dark: 0x0b2766, trim: 0xffffff, shorts: 0x0b0e17, pad: 0x141a2a, sole: 0x2f7bff, numFill: '#ffffff' }
  ];
  var INK = 0x1d1530;
  function inkHex(tc) { return mixHex(tc.dark, INK, 0.35); }
  function tajoFill(tc) { return lumHex(tc.base) > 0.62 ? tc.accent : 0xf8f8f4; }

  // Aspectos de la maqueta (4 muñecos): piel, pelo, peinado, complemento, equipo, dorsal, expresión y pose
  var LOOKS = [
    { skin: 0xdba27a, hair: 0x3a2416, style: 'tupe', acc: 'gorra', team: 0, num: 7, face: 'neutra', pose: 'idle' },
    { skin: 0x8a5638, hair: 0x241a14, style: 'afro', acc: 'cinta', team: 0, num: 11, face: 'concentrado', pose: 'recv' },
    { skin: 0xf0c6a4, hair: 0x7a3a16, style: 'coleta', acc: 'visera', team: 1, num: 3, face: 'grito', pose: 'spike' },
    { skin: 0xc68a5f, hair: 0x1e1612, style: 'mono', acc: 'gafas', team: 1, num: 9, face: 'alegria', pose: 'cel' }
  ];
  var STYLES = ['tupe', 'coleta', 'afro', 'flequillo', 'rapado', 'mono', 'trenzas'];
  var ACCS = ['', 'gorra', 'visera', 'cinta', 'gafas'];

  // =====================================================================
  //  GEOMETRÍA: acumulador (una malla con piel rígida por hueso, color por vértice, UV del atlas, peso de tinta `ow`)
  // =====================================================================
  // Modos de UV: 'flat' (texel blanco: color por vértice) · 'wrap' (tronco: u alrededor, v por la altura de reposo entre
  // yBot..yTop sobre las filas r0..r1 del atlas) · 'strip' (tubos: v de la primitiva sobre las filas r0..r1) · 'own' (UV propia).
  // El atlas se DISEÑA en 512 unidades (filas y celdas de abajo) pero se pinta a 1024² (PXK = 2): la cara es enorme y con 512 se veía
  // blanda en primer plano. Las UV se calculan en unidades de diseño (ATLAS = 512) y el lienzo lleva la escala.
  var ATLAS = 512, PXK = 2, WHITE_V = 1 - 203.5 / ATLAS;
  function Geo() { this.p = []; this.n = []; this.c = []; this.u = []; this.si = []; this.sw = []; this.i = []; this.o = []; this.k = 0; this.pre = null; this.bone = 0; this.bone2 = -1; this.w2 = null; this.owk = 1; this.mode = 'flat'; this.rows = null; this.yr = null; }
  Geo.prototype.add = function (geo, hex, x, y, z, rx, ry, rz, sx, sy, sz) {
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    q.setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
    var m0 = this.w2 ? m.clone() : null;
    if (this.pre) m.premultiply(this.pre);
    nm.getNormalMatrix(m);
    var P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, col = new THREE.Color(hex == null ? 0xffffff : hex), i;
    for (i = 0; i < P.count; i++) {
      var w2 = 0; if (m0) { v.fromBufferAttribute(P, i).applyMatrix4(m0); w2 = this.w2(v.y); }
      var gv = U ? U.getY(i) : 0, gu = U ? U.getX(i) : 0;
      v.fromBufferAttribute(P, i).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      if (this.mode === 'wrap') { var t = clamp((v.y - this.yr[0]) / (this.yr[1] - this.yr[0]), 0, 1); this.u.push(gu, 1 - (this.rows[1] - (this.rows[1] - this.rows[0]) * t) / ATLAS); }
      else if (this.mode === 'strip') { var tv = clamp(gv, 0.03, 0.97); this.u.push(0.5, 1 - (this.rows[1] - (this.rows[1] - this.rows[0]) * tv) / ATLAS); }
      else if (this.mode === 'own') this.u.push(gu, gv);
      else this.u.push(0.5, WHITE_V);
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
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(this.sw), 4));
    g.setAttribute('ow', new THREE.Float32BufferAttribute(this.o, 1));
    g.setIndex(this.i);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0.2), 2.4);   // la piel no recalcula límites (salto, brazos arriba)
    return g;
  };

  // ---------- Primitivas con nivel de detalle ----------
  var LOD_K = [0.45, 0.65, 1], LODK = 1, LODR = 2;
  function sg(n, mn) { return Math.max(mn || 3, Math.round(n * LODK)); }
  function V2(x, y) { return new THREE.Vector2(x, y); }
  function sph(r, w, h, ps, pl, ts, tl) { return new THREE.SphereGeometry(r, sg(w || 16, 8), sg(h || 12, 5), ps || 0, pl == null ? PI * 2 : pl, ts || 0, tl == null ? PI : tl); }
  function cyl(rt, rb, h, seg, open) { return new THREE.CylinderGeometry(rt, rb, h, sg(seg || 16, 8), 1, !!open); }
  function torus(r, t, rs, ts) { return new THREE.TorusGeometry(r, t, sg(rs, 4), sg(ts, 10)); }
  function lathe(pts, seg, mn) { return new THREE.LatheGeometry(pts, sg(seg, mn || 8), 0, PI * 2); }
  function capsule(r, len, cs, rs) { return new THREE.CapsuleGeometry(r, len, Math.max(1, Math.round((cs || 3) * LODK)), sg(rs || 10, 5)); }
  /** Tubo de grosor uniforme que cuelga del origen hasta -len (v = 1 en el arranque, 0 en la punta). */
  function tube(r, len, seg) { return cyl(r, r, len, seg || 16, true); }

  // ---------- Cabeza: esfera deformada de cómic (cráneo grande, mejillas, mandíbula marcada y mentón) ----------
  // (x, y, z) dirección sobre la esfera unidad → punto en metros del hueso de la cabeza (centro en HEAD_C)
  function headShape(x, y, z, o) {
    var lo = y < 0 ? -y : 0, hi = y > 0 ? y : 0, fr = z > 0 ? z : 0;
    var jaw = Math.exp(-(y + 0.45) * (y + 0.45) / 0.03);                   // anillo de la mandíbula (ángulo marcado bajo las orejas)
    var X = x * HEAD_RX * (1 - 0.3 * lo * lo * lo) * (1 + 0.035 * hi) * (1 + 0.1 * jaw * (0.5 + 0.5 * fr));
    var Y = y * HEAD_RY * (y < 0 ? 0.95 : 1);
    var Z = z * HEAD_RZ * (z < 0 ? (1 - 0.12 * lo * lo) : (1 + 0.02 * hi)) * (1 + 0.05 * jaw * fr);
    Z += 0.04 * lo * lo * fr * fr;                                             // mentón que asoma
    Z -= 0.012 * fr * fr * fr * hi * hi;                                       // frente algo plana
    o.x = X; o.y = HEAD_C + Y; o.z = Z; return o;
  }
  var HS = null;
  /** Esfera deformada por headShape con normales calculadas sobre la forma. */
  function headSphere(w, h) {
    if (!HS) HS = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    var geo = new THREE.SphereGeometry(1, w, h), P = geo.attributes.position, N = geo.attributes.normal, d = HS[0], t1 = HS[1], t2 = HS[2], p0 = HS[3], p1 = HS[4], p2 = HS[5], q = HS[6], e = 0.002;
    for (var i = 0; i < P.count; i++) {
      d.fromBufferAttribute(P, i).normalize();
      t1.set(0, 1, 0); if (Math.abs(d.y) > 0.95) t1.set(1, 0, 0);
      t1.cross(d).normalize(); t2.crossVectors(d, t1).normalize();
      headShape(d.x, d.y, d.z, p0);
      q.copy(d).addScaledVector(t1, e).normalize(); headShape(q.x, q.y, q.z, p1);
      q.copy(d).addScaledVector(t2, e).normalize(); headShape(q.x, q.y, q.z, p2);
      p1.sub(p0); p2.sub(p0); q.crossVectors(p1, p2).normalize();
      if (q.dot(d) < 0) q.multiplyScalar(-1);
      P.setXYZ(i, p0.x, p0.y, p0.z); N.setXYZ(i, q.x, q.y, q.z);
    }
    return geo;
  }
  /** Lámina pegada a la cara (rejilla nx × ny sobre headShape, dirección dx ∈ ±dxM, dy ∈ [dy0, dy1]) a F_OFF por fuera,
   *  con UV en la celda 0 de su hoja (x0, y0, w, h en píxeles del atlas). */
  var F_OFF = 0.002, F_PAD = 3;
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
      uv.push((x0 + F_PAD + (w - 2 * F_PAD) * i / nx) / ATLAS, 1 - (y0 + F_PAD + (h - 2 * F_PAD) * (1 - j / ny)) / ATLAS);
    }
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) { var a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, dd = c + 1; idx.push(a, b, dd, a, dd, c); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }
  /** Z de la superficie delantera de la cabeza en (x, y) del hueso. */
  function headFrontZ(x, y) {
    var dx = x / HEAD_RX, dy = (y - HEAD_C) / HEAD_RY, o = { x: 0, y: 0, z: 0 };
    for (var it = 0; it < 30; it++) {
      var dz = Math.sqrt(Math.max(0.02, 1 - dx * dx - dy * dy));
      headShape(dx, dy, dz, o);
      dx += (x - o.x) / HEAD_RX * 0.8; dy += (y - o.y) / HEAD_RY * 0.8;
    }
    return o.z;
  }

  // =====================================================================
  //  ATLAS (512²): tronco con la ropa pintada, tiras de brazo/muslo/espinilla, texel blanco y HOJA DE CARAS
  // =====================================================================
  // Filas: 0-199 tronco (u alrededor: 0 delante, 0,25 izquierda, 0,5 espalda; v = altura; camiseta arriba, pantalón abajo)
  //        200-207 blanco · 208-247 brazo (manga → piel) · 250-289 muslo (pantalón → piel) · 292-331 espinilla (piel → calcetín)
  //        336-455 ojos+cejas: 8 celdas de 128×60 (4×2) · 456-511 bocas: 8 celdas de 64×56
  var TR_R = [0, 199], TR_SPLIT = 142, ARM_R = [208, 247], TH_R = [250, 289], SHN_R = [292, 331];
  var FE_W = 128, FE_H = 60, FE_Y = 336, FM_W = 64, FM_H = 56, FM_Y = 456;
  // alturas de reposo del tronco (espacio del cuerpo) que cubren las filas TR_R: del bajo del pantalón al domo de los hombros
  // (TR_Y0 / TR_Y1 los pone applyDims)
  // direcciones de las láminas de la cara (sobre la esfera unidad) y geometría de los rasgos (metros del hueso de la cabeza)
  var FE_DX = 0.8, FE_DY0 = -0.36, FE_DY1 = 0.64, FM_DX = 0.56, FM_DY0 = -0.92, FM_DY1 = -0.3;
  // rasgos en metros de la cabeza de v1 (centro HEAD_C0): faceCell los escala ×FK alrededor del centro de la cabeza activa
  var EYE_X = 0.078, EYE_Y = HEAD_C0 + 0.005, EYE_RX = 0.046, EYE_RY = 0.06, BROW_Y = HEAD_C0 + 0.095, MOUTH_Y = HEAD_C0 - 0.1;
  var NUM_FONT = '"Barlow Condensed","Arial Narrow","Arial Black",Impact,sans-serif';

  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(cv) { var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping; return t; }

  function paintAtlas(cv, tc, L) {
    var g = cv.getContext('2d');
    g.setTransform(PXK, 0, 0, PXK, 0, 0);   // unidades de diseño (512) → píxeles del lienzo (1024)
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, ATLAS, ATLAS);
    paintBody(g, tc, L);
    paintStrips(g, tc, L);
    paintFace(g, tc, L);
  }
  /** Banda del «tajo» en zigzag con filo oscuro de (x0,y0) a (x1,y1), ancho w. */
  function tajoBand(g, x0, y0, x1, y1, w, fill, edge) {
    var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy), nx = -dy / l, ny = dx / l;
    function band(hw, zz) {
      var n = Math.max(2, Math.round(l / 16)), i, t, o, pts = [];
      for (i = 0; i <= n; i++) { t = i / n; o = hw + (i % 2 ? zz : -zz); pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]); }
      for (i = n; i >= 0; i--) { t = i / n; o = -hw + (i % 2 ? -zz : zz); pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]); }
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill();
    }
    g.fillStyle = hexCss(edge); band(w / 2 + 6, 6);
    g.fillStyle = hexCss(fill); band(w / 2, 6);
  }
  /** Tronco: camiseta (filas 0..TR_SPLIT) con el tajo del hombro izquierdo a la cadera derecha, dorsal grande en la espalda y
   *  pequeño en el pecho; pantalón (TR_SPLIT..199) con cinturilla y paneles del acento. */
  function paintBody(g, tc, L) {
    var W = ATLAS, S = TR_SPLIT;
    g.save(); g.beginPath(); g.rect(0, TR_R[0], W, TR_R[1] - TR_R[0] + 1); g.clip();
    g.fillStyle = hexCss(tc.base); g.fillRect(0, 0, W, S);
    function wrap(fn) { fn(0); fn(W); fn(-W); }
    // tajo: del hombro izquierdo (u ≈ 0,18, arriba) a la cadera derecha (u ≈ -0,2, bajo de la camiseta), pasando por el pecho
    wrap(function (o) { tajoBand(g, o + 92, -10, o - 104, S + 10, 60, tajoFill(tc), tc.dark); });
    // cuello redondo (ribete) y hombros: canesú oscuro ligero en la espalda
    g.fillStyle = hexCss(tc.dark); g.globalAlpha = 0.3; g.fillRect(170, 0, 172, 16); g.globalAlpha = 1;
    wrap(function (o) { g.fillStyle = hexCss(tc.trim); g.beginPath(); g.ellipse(o, 0, 62, 20, 0, 0, PI * 2); g.fill(); g.fillStyle = hexCss(L.skin); g.beginPath(); g.ellipse(o, -3, 54, 15, 0, 0, PI * 2); g.fill(); });
    // dorsales: grande en la espalda (u 0,5), pequeño en el pecho dentro del tajo (oscuro)
    var s = String(L.num);
    function num(cx, cy, h, sx, dark) {
      g.save(); g.translate(cx, cy); g.scale(sx, 1); g.font = 'italic 900 ' + h + 'px ' + NUM_FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      if (dark) { g.fillStyle = hexCss(tc.dark); g.fillText(s, 0, 0); }
      else { g.lineWidth = h * 0.12; g.strokeStyle = hexCss(tc.dark); g.strokeText(s, 0, 0); g.fillStyle = tc.numFill; g.fillText(s, 0, 0); }
      g.restore();
    }
    num(W / 2, 62, 92, 1.0, false);
    wrap(function (o) { num(o, 58, 44, 1.25, true); });
    // bajo de la camiseta (ribete fino) y pantalón
    g.fillStyle = hexCss(tc.shorts); g.fillRect(0, S, W, TR_R[1] - S + 1);
    g.fillStyle = hexCss(tc.accent); g.fillRect(0, S, W, 5);                                   // cinturilla
    g.fillStyle = hexCss(tc.dark); g.globalAlpha = 0.5; g.fillRect(0, S - 4, W, 4); g.globalAlpha = 1;   // ribete del bajo
    [0.25, 0.75].forEach(function (u) {                                                          // paneles laterales del acento
      var cx = u * W; g.fillStyle = hexCss(tc.accent); g.beginPath(); g.moveTo(cx - 14, S + 5); g.lineTo(cx + 14, S + 5); g.lineTo(cx + 22, TR_R[1] + 1); g.lineTo(cx - 22, TR_R[1] + 1); g.fill();
    });
    g.restore();
  }
  /** Tiras de las extremidades: v = 1 (arranque, fila r0) → v = 0 (punta, fila r1). */
  function paintStrips(g, tc, L) {
    var W = ATLAS, sk = hexCss(L.skin);
    function strip(r, segs) { var y = r[0], h = r[1] - r[0] + 1; for (var i = 0; i < segs.length; i++) { g.fillStyle = segs[i][1]; g.fillRect(0, y + Math.round(h * segs[i][0]), W, Math.ceil(h * ((segs[i + 1] ? segs[i + 1][0] : 1) - segs[i][0])) + 1); } }
    strip(ARM_R, [[0, hexCss(tc.base)], [0.38, hexCss(tc.accent)], [0.46, sk]]);          // manga corta con ribete → piel
    strip(TH_R, [[0, hexCss(tc.shorts)], [0.42, hexCss(tc.accent)], [0.48, sk]]);        // pernera con ribete → piel
    strip(SHN_R, [[0, sk], [0.66, hexCss(tc.accent)], [0.78, hexCss(tc.base)], [0.86, hexCss(tc.accent)]]);   // piel → calcetín del acento con franja
  }

  // ---------- HOJA DE CARAS ----------
  // Ojos+cejas (8 celdas): 0 neutra · 1 parpadeo · 2 concentrado (párpado en diagonal, cejas en V) · 3 esfuerzo (apretados > <) ·
  //   4 alegría (^ ^ cerrados de risa) · 5 pena (párpados caídos, cejas hacia arriba por dentro) · 6 sorpresa (redondos enormes,
  //   pupila chica, cejas altas) · 7 grito/rabia (abiertos, cejas en V muy bajas).
  // Bocas (8 celdas): 0 neutra · 1 sonrisa grande con dientes · 2 grito en O · 3 dientes apretados · 4 pena · 5 «o» chica ·
  //   6 sonrisa con lengua · 7 línea tensa (concentración).
  var EXPR = { neutra: [0, 0], concentrado: [2, 7], esfuerzo: [3, 3], grito: [7, 2], alegria: [4, 1], pena: [5, 4], sorpresa: [6, 5], lengua: [4, 6] };
  function faceInk(tc) { return mixHex(tc.dark, INK, 0.55); }
  function faceHalo(L) { var lu = lumHex(L.skin); if (lu >= 0.42) return null; return hexCss(mixHex(L.skin, 0xffe6d2, clamp(0.38 + (0.42 - lu) * 1.6, 0.38, 0.6))); }
  /** Celda: recorte y transformación de metros del hueso de la cabeza (X, Y) a píxeles. */
  function faceCell(g, x0, y0, w, h, dxM, dy0, dy1, fn) {
    var X0 = -dxM * HEAD_RX, X1 = dxM * HEAD_RX, Y0 = HEAD_C + dy0 * HEAD_RY, Y1 = HEAD_C + dy1 * HEAD_RY;
    var a = (w - 2 * F_PAD) / (X1 - X0), d = -(h - 2 * F_PAD) / (Y1 - Y0);
    g.save(); g.beginPath(); g.rect(x0 + 1, y0 + 1, w - 2, h - 2); g.clip();
    g.setTransform(a * PXK, 0, 0, d * PXK, (x0 + F_PAD - a * X0) * PXK, (y0 + F_PAD - d * Y1) * PXK);
    g.translate(0, HEAD_C); g.scale(FK, FK); g.translate(0, -HEAD_C0);   // rasgos de v1 → cabeza activa (ojos y boca en proporción)
    g.lineCap = 'round'; g.lineJoin = 'round';
    fn();
    g.restore();
  }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, PI * 2); }
  function paintFace(g, tc, L) {
    g.save();
    g.fillStyle = hexCss(L.skin); g.fillRect(0, FE_Y - 2, ATLAS, ATLAS - FE_Y + 2);
    var i;
    for (i = 0; i < 8; i++) faceCell(g, (i & 3) * FE_W, FE_Y + (i >> 2) * FE_H, FE_W, FE_H, FE_DX, FE_DY0, FE_DY1, function () { paintEyes(g, i, L, tc); });
    for (i = 0; i < 8; i++) faceCell(g, i * FM_W, FM_Y, FM_W, FM_H, FM_DX, FM_DY0, FM_DY1, function () { paintMouth(g, i, L, tc); });
    g.restore();
  }
  function paintEyes(g, cell, L, tc) {
    var ink = hexCss(faceInk(tc)), brow = hexCss(mixHex(L.hair, 0x000000, 0.2)), halo = faceHalo(L), s;
    for (s = -1; s <= 1; s += 2) {
      var cx = s * EYE_X, cy = EYE_Y, rx = EYE_RX, ry = EYE_RY, pr = 0.027, py = -0.004, px = 0, lid = 0, tilt = 0, shut = 0;
      if (halo) { g.fillStyle = halo; ell(g, cx, cy + 0.01, rx * 1.5, ry * 1.4); g.fill(); }
      if (cell === 6) { rx *= 1.14; ry *= 1.1; pr = 0.016; px = 0; py = 0; }      // sorpresa: enormes, pupila chica
      if (cell === 7) { rx *= 1.05; pr = 0.022; py = 0.004; lid = 0.22; tilt = 0.55; }   // grito: ceja encima del ojo
      if (cell === 2) { lid = 0.42; tilt = 0.5; }                                  // concentrado: párpado en diagonal
      if (cell === 5) { lid = 0.4; tilt = -0.5; py = -0.014; px = s * 0.006; }   // pena: párpado caído, mirada baja
      if (cell === 1 || cell === 3 || cell === 4) shut = cell;
      g.lineWidth = 0.009; g.strokeStyle = ink;
      if (shut === 1) {                 // parpadeo: línea curva hacia abajo
        g.beginPath(); g.moveTo(cx - rx, cy + 0.004); g.quadraticCurveTo(cx, cy - 0.022, cx + rx, cy + 0.004); g.stroke();
      } else if (shut === 4) {          // alegría: arcos ^ ^
        g.lineWidth = 0.011;
        g.beginPath(); g.moveTo(cx - rx, cy - 0.012); g.quadraticCurveTo(cx, cy + 0.05, cx + rx, cy - 0.012); g.stroke();
      } else if (shut === 3) {          // esfuerzo: apretados > <
        g.lineWidth = 0.01;
        g.beginPath(); g.moveTo(cx - s * rx * 0.9, cy + 0.028); g.lineTo(cx + s * rx * 0.5, cy); g.lineTo(cx - s * rx * 0.9, cy - 0.028); g.stroke();
        g.beginPath(); g.moveTo(cx - s * rx * 0.3, cy + 0.03); g.quadraticCurveTo(cx + s * rx * 0.9, cy, cx - s * rx * 0.3, cy - 0.03); g.stroke();
      } else {
        g.save();
        ell(g, cx, cy, rx, ry); g.fillStyle = '#ffffff'; g.fill(); g.clip();
        ell(g, cx + px, cy + py, pr * 0.9, pr); g.fillStyle = ink; g.fill();                              // pupila
        g.fillStyle = '#ffffff';
        ell(g, cx + px - s * 0.009, cy + py + 0.012, pr * 0.34, pr * 0.36); g.fill();                     // brillo grande
        ell(g, cx + px + s * 0.008, cy + py - 0.011, pr * 0.16, pr * 0.17); g.fill();                     // brillo chico
        if (lid > 0) {                                                                                     // párpado (piel) con línea de tinta
          var ly = cy + ry - 2 * ry * lid, t = tilt * s;
          g.fillStyle = hexCss(L.skin); g.beginPath();
          g.moveTo(cx - rx * 1.4, ly - t * rx); g.lineTo(cx + rx * 1.4, ly + t * rx); g.lineTo(cx + rx * 1.4, cy + ry * 1.5); g.lineTo(cx - rx * 1.4, cy + ry * 1.5); g.closePath(); g.fill();
          g.strokeStyle = ink; g.lineWidth = 0.009; g.beginPath(); g.moveTo(cx - rx * 1.4, ly - t * rx); g.lineTo(cx + rx * 1.4, ly + t * rx); g.stroke();
        }
        g.restore();
        g.strokeStyle = ink; g.lineWidth = 0.0075; ell(g, cx, cy, rx, ry); g.stroke();
      }
      // cejas GRUESAS: llevan la expresión (bi interior, bo exterior, bm centro; Y en metros)
      var bi = BROW_Y, bo = BROW_Y - 0.012, bm = BROW_Y + 0.006, bw = 0.024;
      if (cell === 2) { bi = BROW_Y - 0.03; bo = BROW_Y + 0.004; bm = BROW_Y - 0.016; }            // V de concentración
      if (cell === 7) { bi = BROW_Y - 0.05; bo = BROW_Y + 0.0; bm = BROW_Y - 0.03; bw = 0.024; }    // V de grito
      if (cell === 3) { bi = BROW_Y - 0.038; bo = BROW_Y - 0.01; bm = BROW_Y - 0.03; }             // esfuerzo
      if (cell === 5) { bi = BROW_Y + 0.012; bo = BROW_Y - 0.03; bm = BROW_Y + 0.002; }            // pena: por dentro arriba
      if (cell === 4) { bi = BROW_Y + 0.02; bo = BROW_Y + 0.01; bm = BROW_Y + 0.03; }              // alegría: altas
      if (cell === 6) { bi = BROW_Y + 0.035; bo = BROW_Y + 0.022; bm = BROW_Y + 0.045; }           // sorpresa: muy altas
      if (halo) { g.strokeStyle = halo; g.lineWidth = bw + 0.012; g.beginPath(); g.moveTo(s * 0.035, bi); g.quadraticCurveTo(s * 0.08, bm, s * 0.13, bo); g.stroke(); }
      g.strokeStyle = brow; g.lineWidth = bw;
      g.beginPath(); g.moveTo(s * 0.035, bi); g.quadraticCurveTo(s * 0.08, bm, s * 0.13, bo); g.stroke();
    }
  }
  function paintMouth(g, cell, L, tc) {
    var ink = hexCss(faceInk(tc)), cy = MOUTH_Y, inner = '#5a1620', tongue = '#ef6f78', teeth = '#fffaf0', halo = faceHalo(L);
    if (halo) { g.fillStyle = halo; ell(g, 0, cy - 0.004, 0.075, 0.04); g.fill(); }
    g.strokeStyle = ink; g.lineWidth = 0.008;
    switch (cell) {
      case 1:   // sonrisa grande con dientes (D)
        g.save(); g.beginPath(); g.moveTo(-0.07, cy + 0.012); g.quadraticCurveTo(0, cy - 0.07, 0.07, cy + 0.012); g.closePath();
        g.fillStyle = inner; g.fill(); g.clip(); g.fillStyle = teeth; g.fillRect(-0.08, cy - 0.0, 0.16, 0.014);
        g.fillStyle = tongue; ell(g, 0.01, cy - 0.034, 0.03, 0.018); g.fill(); g.restore();
        g.beginPath(); g.moveTo(-0.07, cy + 0.012); g.quadraticCurveTo(0, cy - 0.07, 0.07, cy + 0.012); g.closePath(); g.stroke(); break;
      case 2:   // grito: O grande con dientes arriba y lengua
        g.save(); ell(g, 0, cy - 0.01, 0.048, 0.05); g.fillStyle = inner; g.fill(); g.clip();
        g.fillStyle = tongue; ell(g, 0, cy - 0.052, 0.036, 0.022); g.fill();
        g.fillStyle = teeth; g.fillRect(-0.06, cy + 0.024, 0.12, 0.014); g.restore();
        ell(g, 0, cy - 0.01, 0.048, 0.05); g.stroke(); break;
      case 3:   // dientes apretados
        g.fillStyle = teeth; ell(g, 0, cy, 0.056, 0.02); g.fill();
        g.lineWidth = 0.005; g.beginPath(); g.moveTo(-0.052, cy); g.lineTo(0.052, cy);
        for (var k = -2; k <= 2; k++) { g.moveTo(k * 0.02, cy - 0.018); g.lineTo(k * 0.02, cy + 0.018); }
        g.stroke(); g.lineWidth = 0.008; ell(g, 0, cy, 0.056, 0.02); g.stroke(); break;
      case 4:   // pena: arco hacia abajo
        g.beginPath(); g.moveTo(-0.045, cy - 0.022); g.quadraticCurveTo(0, cy + 0.016, 0.045, cy - 0.022); g.stroke(); break;
      case 5:   // «o» chica (sorpresa)
        ell(g, 0, cy - 0.004, 0.02, 0.023); g.fillStyle = inner; g.fill(); g.stroke(); break;
      case 6:   // sonrisa abierta con lengua fuera
        g.save(); g.beginPath(); g.moveTo(-0.06, cy + 0.012); g.quadraticCurveTo(0, cy - 0.06, 0.06, cy + 0.012); g.closePath();
        g.fillStyle = inner; g.fill(); g.clip(); g.fillStyle = teeth; g.fillRect(-0.07, cy - 0.0, 0.14, 0.012); g.restore();
        g.fillStyle = tongue; ell(g, 0.012, cy - 0.038, 0.026, 0.028); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(-0.06, cy + 0.012); g.quadraticCurveTo(0, cy - 0.06, 0.06, cy + 0.012); g.closePath(); g.stroke(); break;
      case 7:   // línea tensa (concentración), ligeramente torcida
        g.beginPath(); g.moveTo(-0.045, cy - 0.004); g.lineTo(0.04, cy - 0.012); g.stroke(); break;
      default:  // neutra: sonrisa corta
        g.beginPath(); g.moveTo(-0.035, cy + 0.004); g.quadraticCurveTo(0, cy - 0.012, 0.035, cy + 0.004); g.stroke();
    }
  }

  // =====================================================================
  //  MATERIAL: toon de DOS bandas (solo la luz principal en bandas), ambiente teñido, brillo de borde, celdas de la cara
  // =====================================================================
  var GRAD = null, SHADE = [0.12, 0.09, 0.2], SHADE_SKIN = [0.18, 0.09, 0.1], TOON_CHUNK = null;
  function gradient2() {
    if (GRAD) return GRAD;
    // 10 texeles: 0-5 sombra (0,5), 6-9 luz: el terminador queda en N·L ≈ 0,2 (la sombra ocupa algo menos de media bola)
    var d = new Uint8Array(40); for (var i = 0; i < 10; i++) { var v = i < 6 ? 128 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    GRAD = new THREE.DataTexture(d, 10, 1, THREE.RGBAFormat); GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.generateMipmaps = false; GRAD.needsUpdate = true;
    return GRAD;
  }
  function toonLightsChunk() {
    if (TOON_CHUNK) return TOON_CHUNK;
    var src = THREE.ShaderChunk.lights_toon_pars_fragment, a = 'vec3 irradiance = getGradientIrradiance( geometry.normal, directLight.direction ) * directLight.color;';
    if (src.indexOf(a) < 0) return (TOON_CHUNK = src);
    return (TOON_CHUNK = src.replace(a, 'float vbL = dot( directLight.color, vec3( 0.2126, 0.7152, 0.0722 ) );\n' +
      '\tvec3 vbB = getGradientIrradiance( geometry.normal, directLight.direction );\n' +
      '\tvec3 vbS = vec3( 0.55 * saturate( dot( geometry.normal, directLight.direction ) ) );\n' +
      '\tvec3 irradiance = mix( vbS, vbB, smoothstep( 1.2, 2.4, vbL ) ) * directLight.color;'));
  }
  function dollMaterial(tc, L) {
    var cv = canvas(ATLAS * PXK, ATLAS * PXK); paintAtlas(cv, tc, L);
    var t = texOf(cv), m = new THREE.MeshToonMaterial({ map: t, vertexColors: true, gradientMap: gradient2() });
    var eyeOff = m.userData.eyeOff = new THREE.Vector2(), mouthOff = m.userData.mouthOff = new THREE.Vector2();
    var fe0 = (1 - (FE_Y + FE_H) / ATLAS - 0.004).toFixed(4), fe1 = (1 - FE_Y / ATLAS + 0.004).toFixed(4);
    var fm0 = (1 - (FM_Y + FM_H) / ATLAS - 0.004).toFixed(4), fm1 = (1 - FM_Y / ATLAS + 0.004).toFixed(4);
    var rim = new THREE.Color(0xfff1e0).multiplyScalar(0.14);
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uRim = { value: rim };
      sh.uniforms.uShade = { value: new THREE.Vector3(SHADE[0], SHADE[1], SHADE[2]) };
      sh.uniforms.uShadeSkin = { value: new THREE.Vector3(SHADE_SKIN[0], SHADE_SKIN[1], SHADE_SKIN[2]) };
      sh.uniforms.uEyeOff = { value: eyeOff }; sh.uniforms.uMouthOff = { value: mouthOff };
      sh.fragmentShader = 'uniform vec3 uRim;\nuniform vec3 uShade;\nuniform vec3 uShadeSkin;\nuniform vec2 uEyeOff;\nuniform vec2 uMouthOff;\nfloat vbFace = 0.0;\n' + sh.fragmentShader
        .replace('#include <lights_toon_pars_fragment>', toonLightsChunk())
        .replace('#include <map_fragment>', '#ifdef USE_UV\n  vec2 vbUv = vUv;\n' +
          '  float vbFE = step( ' + fe0 + ', vUv.y ) * step( vUv.y, ' + fe1 + ' );\n' +
          '  float vbFM = step( ' + fm0 + ', vUv.y ) * step( vUv.y, ' + fm1 + ' );\n' +
          '  vbFace = max( vbFE, vbFM );\n  vbUv += uEyeOff * vbFE + uMouthOff * vbFM;\n#endif\n' +
          THREE.ShaderChunk.map_fragment.replace(/vUv/g, 'vbUv'))
        .replace('#include <output_fragment>',
          'outgoingLight += diffuseColor.rgb * mix( uShade, uShadeSkin, vbFace );\n' +
          'float vbRim = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );\n' +
          'outgoingLight += uRim * smoothstep( 0.72, 0.78, vbRim );\n' +
          // blanco de los ojos y dientes con algo de luz propia: no se tiñe de violeta en la sombra
          'outgoingLight += diffuseColor.rgb * 0.5 * vbFace * smoothstep( 0.72, 0.92, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );\n' +
          '#include <output_fragment>');
    };
    m.customProgramCacheKey = function () { return 'vbDollToon'; };
    try { if (document.fonts && document.fonts.load) document.fonts.load('italic 900 100px "Barlow Condensed"').then(function () { paintAtlas(cv, tc, L); t.needsUpdate = true; }).catch(function () { }); } catch (e) { }
    return m;
  }
  // contorno de tinta de color: VB.TOON.outline de arena (grosor en píxeles, tope en metros, peso `ow` por vértice, color propio)
  var OUT_PX = 3.6, OUT_MAX = 0.06, OUT_MIN = 0.003;
  function ensureInk(r) {
    var T = VB.TOON; if (r.ink || !T || !T.outline) return;
    r.ink = T.outline(r.skin, OUT_MIN, { max: OUT_MAX, k: T.px ? OUT_PX / T.px : 1, color: inkHex(r.tc) });
    if (r.ink) r.ink.name = r.skin.name + 'Ink';
  }

  // =====================================================================
  //  PIEZAS (espacio del hueso; todas en la pose de reposo)
  // =====================================================================
  function torsoGeo(G, r) {
    // pera limpia: redonda por abajo (entre las piernas), más ancha en la barriga, se estrecha hacia el domo de los hombros
    // (perfil diseñado para un tronco de 0,67: TORSO_K lo estira/acorta; TORSO_W lo ensancha por abajo —chibi rechoncho— y nada arriba)
    var prof = [[0, -0.13], [0.12, -0.12], [0.185, -0.06], [0.205, 0.04], [0.2, 0.16], [0.185, 0.3], [0.168, 0.44], [0.152, 0.56], [0.13, 0.64], [0.085, 0.69], [0, 0.705]];
    var pts = []; for (var i = 0; i < prof.length; i++) pts.push(V2(prof[i][0] * lerp(TORSO_W, 1, clamp((prof[i][1] + 0.13) / 0.7, 0, 1)), prof[i][1] * TORSO_K));
    // piel a dos huesos: la mitad alta sigue al pecho (flexión suave del tronco sin costura)
    G.bone2 = r.bones.indexOf(r.chest); G.w2 = function (y) { return sstep(0.1 * TORSO_K, 0.5 * TORSO_K, y); };
    G.mode = 'wrap'; G.rows = TR_R; G.yr = [TR_Y0, TR_Y1];
    G.add(lathe(pts, 30, 14), null, 0, 0, 0, 0, 0, 0, 1, 1, 0.86);
    G.mode = 'flat'; G.bone2 = -1; G.w2 = null;
  }
  // bola del hombro un punto más oscura que la camiseta: se lee como pieza aparte aunque el tronco sea del mismo color
  function shoulderGeo(G, tc) { G.add(sph(BALL_SH, 16, 12), mixHex(tc.base, tc.dark, 0.14)); }
  function upperGeo(G) { G.mode = 'strip'; G.rows = ARM_R; G.add(tube(TUBE_ARM, UPPER), null, 0, -UPPER / 2, 0); G.mode = 'flat'; }
  function foreGeo(G, L) {
    G.add(sph(BALL_EL, 14, 10), L.skin);                                     // codo: bola visible
    G.add(tube(TUBE_ARM, FORE), L.skin, 0, -FORE / 2, 0);
  }
  /** Manopla grande y redonda (sin dedos) con el pulgar insinuado. Plano de la mano = Y-Z del hueso (grosor en X). */
  function handGeo(G, L, s) {
    var K = HAND_K;
    G.owk = 0.75;
    G.add(sph(1, 16, 12), L.skin, 0, -PALM, 0.004, 0, 0, 0, 0.058 * K, 0.108 * K, 0.094 * K);
    G.add(capsule(1, 1.4, 2, 8), L.skin, 0, -0.06 * K, 0.085 * K, -0.75, 0, 0, 0.034 * K, 0.034 * K, 0.034 * K);   // pulgar
    G.owk = 1;
  }
  function thighGeo(G, tc) {
    G.add(sph(BALL_HIP, 12, 9), tc.shorts);                                  // bola de la cadera (asoma al levantar la pierna)
    G.mode = 'strip'; G.rows = TH_R; G.add(tube(TUBE_LEG, THIGH), null, 0, -THIGH / 2, 0); G.mode = 'flat';
  }
  function shinGeo(G, tc) {
    G.add(sph(BALL_KN, 16, 12), tc.pad, 0, 0, 0.004, 0, 0, 0, 1.08, 1, 1.04);   // rodilla: bola = RODILLERA pintada (oscuro del equipo)
    G.mode = 'strip'; G.rows = SHN_R; G.add(tube(TUBE_LEG * 0.96, SHIN), null, 0, -SHIN / 2, 0); G.mode = 'flat';
  }
  /** Zapatón redondeado grande (blanco con puntera y suela del equipo); la planta queda en -ANKLE. */
  function shoeGeo(G, tc) {
    var K = FOOT_K, Y = -ANKLE + 0.075;   // la planta sigue en -ANKLE: el zapatón crece en largo y ancho (y algo en alto)
    G.add(sph(1, 18, 12, 0, PI * 2, 0, PI * 0.5), 0xf4f4f4, 0, Y, 0.055 * K, 0, 0, 0, 0.092 * K, 0.088 * Math.sqrt(K), 0.158 * K);       // empeine (media esfera)
    G.add(sph(1, 18, 7, 0, PI * 2, PI * 0.5, PI * 0.5), tc.sole, 0, Y, 0.055 * K, 0, 0, 0, 0.094 * K, 0.075, 0.16 * K);   // suela (media esfera aplastada)
    G.owk = 0.5; G.add(sph(1, 14, 8, 0, PI * 2, 0, PI * 0.5), tc.accent, 0, Y + 0.006, 0.12 * K, 0, 0, 0, 0.078 * K, 0.064 * Math.sqrt(K), 0.105 * K); // puntera del acento
    G.add(cyl(0.05 * K, 0.056 * K, 0.06, 14), 0xf4f4f4, 0, -0.03, -0.005);                                             // tobillera
    G.owk = 0;
    G.add(cyl(0.057 * K, 0.057 * K, 0.014, 14, true), tc.accent, 0, -0.012, -0.005);                                  // ribete del tobillo
    G.owk = 1;
  }
  /** Cabeza, orejas, pelo y complementos (hueso head). */
  function headGeo(G, L, tc) {
    var sk = L.skin, hr = L.hair, s, i;
    G.add(headSphere(sg(30, 16), sg(20, 12)), sk);
    G.owk = 0.6; for (s = -1; s <= 1; s += 2) G.add(sph(0.046 * FK, 10, 8), sk, s * (HEAD_RX - 0.005), HEAD_C - 0.005, -0.01, 0, 0, 0, 0.45, 1, 0.85);   // orejas sencillas
    G.owk = 1;
    var gorra = L.acc === 'gorra', R = HEAD_RX + 0.01;
    /** casquete de pelo: media esfera algo mayor que el cráneo, abierta por abajo (thetaLength) y echada atrás (rot) */
    function cap(col, theta, rot, k) { G.add(new THREE.SphereGeometry(1, sg(26, 14), sg(14, 7), 0, PI * 2, 0, theta), col, 0, HEAD_C + 0.012, -0.012, rot || 0, 0, 0, R * (k || 1), (HEAD_RY + 0.012) * (k || 1), (HEAD_RZ + 0.012) * (k || 1)); }
    /** mechón liso en lágrima (punta en +Y) */
    function tuft(len, rr, seg) { return lathe([V2(0, 0), V2(rr * 0.8, len * 0.08), V2(rr, len * 0.3), V2(rr * 0.74, len * 0.62), V2(rr * 0.3, len * 0.9), V2(0, len)], seg || 10, 6); }
    switch (gorra ? 'gorra' : L.style) {
      case 'tupe':        // tupé: casquete + mechón grande hacia delante y arriba
        cap(hr, PI * 0.42, -0.25);
        G.add(tuft(0.26 * FK, 0.11 * FK), hr, 0.01, HEAD_C + 0.13 * FK, 0.03 * FK, 0.95, 0, -0.15, 1.5, 1, 0.75);
        G.add(tuft(0.16 * FK, 0.085 * FK), hr, -0.03, HEAD_C + 0.15 * FK, -0.08 * FK, 0.25, 0, 0.12, 1.4, 1, 0.7);
        break;
      case 'coleta':      // coleta alta: casquete + goma + cola (en el hueso del pelo, para el muelle)
        cap(hr, PI * 0.46, -0.2);
        G.owk = 0; G.add(torus(R * 0.98, 0.016, 6, 30), tc.accent, 0, HEAD_C + 0.1 * FK, -0.01, PI / 2 - 0.2, 0, 0, 0.98, 1.04, 1); G.owk = 1;   // cinta del equipo
        break;
      case 'afro': {      // afro redondo: bola grande que envuelve la cabeza, abierta por delante (la cara queda libre)
        var ax = HEAD_RX + 0.08, ay = HEAD_RY + 0.07, az = HEAD_RZ + 0.07, ac = HEAD_C + 0.045, azc = -0.035;
        G.add(new THREE.SphereGeometry(1, sg(28, 14), sg(8, 4), 0, PI * 2, 0, PI * 0.36), hr, 0, ac, azc, 0, 0, 0, ax, ay, az);        // casquete alto completo
        G.add(new THREE.SphereGeometry(1, sg(28, 14), sg(10, 5), PI * 0.5 + 1.05, PI * 2 - 2.1, PI * 0.36, PI * 0.5), hr, 0, ac, azc, 0, 0, 0, ax, ay, az);   // anillo sin la cuña de la cara
        break; }
      case 'flequillo':   // melena a tazón: casquete con borde recto justo encima de las cejas (flequillo liso) y algo más largo a los lados
        cap(hr, PI * 0.37, 0.0, 1.03);
        for (s = -1; s <= 1; s += 2) G.add(sph(1, 10, 8), hr, s * (HEAD_RX + 0.012), HEAD_C + 0.03, -0.03, 0, 0, 0, 0.03, 0.085, 0.1);   // mechones laterales
        break;
      case 'rapado':      // rapado: casquete finísimo pegado al cráneo (se lee por el color)
        cap(hr, PI * 0.47, -0.1, 0.985);
        break;
      case 'mono':        // moño alto: casquete + bola arriba con goma
        cap(hr, PI * 0.46, -0.15);
        G.add(sph(0.085 * FK, 16, 12), hr, 0, HEAD_C + HEAD_RY + 0.045 * FK, -0.05, 0, 0, 0, 1, 0.9, 1);
        G.owk = 0; G.add(torus(0.05 * FK, 0.012, 5, 16), tc.accent, 0, HEAD_C + HEAD_RY - 0.01, -0.05, PI / 2 + 0.15, 0, 0); G.owk = 1;
        break;
      case 'trenzas':     // dos trenzas gordas que caen por detrás de las orejas
        cap(hr, PI * 0.5, -0.1);
        var bp = []; for (i = 0; i <= 10; i++) bp.push(V2(i === 0 || i === 10 ? 0 : (i % 2 ? 0.04 : 0.028) * (1 - i * 0.04), -i * 0.035));
        for (s = -1; s <= 1; s += 2) G.add(lathe(bp, 10, 6), hr, s * (HEAD_RX - 0.03), HEAD_C + 0.02, -0.1, 0.3, 0, s * 0.2);
        G.owk = 0; for (s = -1; s <= 1; s += 2) G.add(torus(0.02, 0.008, 5, 12), tc.accent, s * (HEAD_RX - 0.03 + 0.07), HEAD_C - 0.3, -0.07, PI / 2, 0, 0); G.owk = 1;
        break;
      case 'gorra':       // gorra hacia delante del acento con visera larga y botón; el pelo asoma (casquete corto)
        cap(hr, PI * 0.5, -0.1, 0.99);
        G.add(new THREE.SphereGeometry(1, sg(26, 14), sg(12, 6), 0, PI * 2, 0, PI * 0.46), tc.accent, 0, HEAD_C + 0.02, -0.005, 0.1, 0, 0, R + 0.012, HEAD_RY + 0.03, HEAD_RZ + 0.018);
        G.add(sph(1, 16, 4, 0, PI * 2, 0, PI * 0.5), tc.dark, 0, HEAD_C + 0.095 * FK, HEAD_RZ + 0.06 * FK, -0.45, 0, 0, 0.17 * FK, 0.016, 0.15 * FK);   // visera (del oscuro)
        G.owk = 0; G.add(cyl(R + 0.016, R + 0.018, 0.028, 10, true, 0, 0), tc.dark, 0, HEAD_C + 0.07 * FK, -0.005, 0.1, 0, 0, 1, 1, 1.06);   // banda
        G.add(sph(0.016, 6, 4), tc.dark, 0, HEAD_C + HEAD_RY + 0.03, -0.005); G.owk = 1;
        break;
      default:
        cap(hr, PI * 0.44, -0.2);
    }
    if (L.acc === 'visera') {   // visera deportiva: banda abierta por arriba (cilindro corto) + ala del acento con filo oscuro
      G.add(new THREE.CylinderGeometry(R + 0.008, R + 0.012, 0.045 * FK, sg(24, 12), 1, true), tc.accent, 0, HEAD_C + 0.1 * FK, -0.01, -0.1, 0, 0, 1, 1, 1.0);
      G.add(sph(1, 16, 4, 0, PI * 2, 0, PI * 0.5), tc.accent, 0, HEAD_C + 0.1 * FK, HEAD_RZ + 0.08 * FK, -0.4, 0, 0, 0.16 * FK, 0.014, 0.13 * FK);
      G.owk = 0; G.add(sph(1, 16, 3, 0, PI * 2, PI * 0.5, PI * 0.5), tc.dark, 0, HEAD_C + 0.099 * FK, HEAD_RZ + 0.08 * FK, -0.4, 0, 0, 0.158 * FK, 0.008, 0.128 * FK); G.owk = 1;
    } else if (L.acc === 'cinta') {   // cinta del acento alrededor de la frente
      G.add(torus(R + 0.004, 0.02 * FK, 6, 32), tc.accent, 0, HEAD_C + 0.085 * FK, -0.008, PI / 2 - 0.08, 0, 0, 1, 1.05, 1);
      G.owk = 0; G.add(torus(R + 0.0045, 0.009 * FK, 5, 32), tc.dark, 0, HEAD_C + 0.085 * FK, -0.008, PI / 2 - 0.08, 0, 0, 1, 1.05, 1); G.owk = 1;
    } else if (L.acc === 'gafas') {   // gafas de sol subidas a la frente (la cara sigue leyéndose): montura del acento, lentes con brillo
      var gy = HEAD_C + 0.14 * FK, gz = headFrontZ(0.085 * FK, gy) - 0.012, LENS = 0x1a2340;
      for (s = -1; s <= 1; s += 2) {
        G.owk = 0.6; G.add(sph(1, 14, 8), tc.accent, s * 0.088 * FK, gy, gz + 0.01, -0.5, 0, 0, 0.082 * FK, 0.06 * FK, 0.03);              // montura
        G.owk = 0; G.add(sph(1, 14, 8), LENS, s * 0.088 * FK, gy, gz + 0.022, -0.5, 0, 0, 0.068 * FK, 0.048 * FK, 0.022);                   // lente
        G.add(sph(1, 8, 6), 0xdfe8ff, s * 0.07 * FK, gy + 0.018 * FK, gz + 0.04, -0.5, 0, 0, 0.018 * FK, 0.009 * FK, 0.006);                    // brillo
      }
      G.owk = 0.6; G.add(cyl(0.01, 0.01, 0.03 * FK, 6), tc.accent, 0, gy + 0.004, gz + 0.02, 0, 0, PI / 2);                     // puente
      G.owk = 0; for (s = -1; s <= 1; s += 2) G.add(cyl(0.008, 0.008, 0.2, 6), tc.accent, s * (R + 0.004), gy, gz - 0.09, PI / 2, 0, 0); G.owk = 1;   // patillas
    }
    G.owk = 1;
  }
  /** Láminas de la cara (sin contorno, UV propia) y, con coleta, la cola en el hueso del pelo. */
  function faceGeo(G, r, L, tc, on) {
    on(r.head); G.owk = 0; G.mode = 'own';
    var nx = Math.max(6, Math.round(12 * LODK + 0.5)), ny = Math.max(4, Math.round(7 * LODK + 0.5));
    G.add(faceSheet(nx, ny, FE_DX, FE_DY0, FE_DY1, 0, FE_Y, FE_W, FE_H), 0xffffff);
    G.add(faceSheet(Math.max(4, nx - 3), 4, FM_DX, FM_DY0, FM_DY1, 0, FM_Y, FM_W, FM_H), 0xffffff);
    G.mode = 'flat'; G.owk = 1;
    if (L.style === 'coleta' && L.acc !== 'gorra') {
      on(r.hair);
      G.add(sph(0.062, 14, 10), L.hair, 0, 0.01, 0, 0, 0, 0, 1, 0.9, 1.1);                                                  // nudo
      G.owk = 0; G.add(torus(0.04, 0.012, 5, 12), tc.accent, 0, -0.02, -0.03, -1.0, 0, 0); G.owk = 1;                        // goma
      G.add(lathe([V2(0, 0), V2(0.05, -0.03), V2(0.06, -0.12), V2(0.05, -0.22), V2(0.03, -0.3), V2(0.01, -0.36), V2(0, -0.37)], 12, 6), L.hair, 0, -0.03, -0.05, 0.5, 0, 0, 1, 1, 0.85);   // cola
    }
  }

  // =====================================================================
  //  RIG: mismo esqueleto que players.js (27 huesos, mismo orden)
  // =====================================================================
  function buildRig(L, idx) {
    var tc = TEAMS[L.team], root = new THREE.Group(); root.name = 'doll' + idx;
    var bones = [];
    function bone(parent, x, y, z) { var b = new THREE.Bone(); b.position.set(x || 0, y || 0, z || 0); parent.add(b); bones.push(b); return b; }
    var body = bone(root);
    var pelvis = bone(body, 0, HIP_H, 0);
    var spine = bone(pelvis, 0, SPINE_Y, 0);
    var chest = bone(spine, 0, CHEST_Y, 0);
    var head = bone(chest, 0, NECK_Y, 0); head.rotation.order = 'YXZ';
    var fz = headFrontZ;
    // huesos de la cara (vacíos: la cara es una textura) en la cabeza activa (rasgos de v1 escalados ×FK)
    var eY = HEAD_C + (EYE_Y - HEAD_C0) * FK, mY = HEAD_C + (MOUTH_Y - HEAD_C0) * FK, bY = HEAD_C + (BROW_Y - HEAD_C0) * FK, eX = EYE_X * FK;
    var eyes = bone(head, 0, eY, fz(eX, eY)), mouth = bone(head, 0, mY, fz(0, mY)), teeth = bone(head, 0, mY, fz(0, mY));
    var browL = bone(head, eX, bY, fz(eX, bY)), browR = bone(head, -eX, bY, fz(eX, bY));
    var hair = bone(head, 0, HEAD_C + HEAD_RY - 0.02, -0.06);
    // medidas con las que se construyó ESTE muñeco (las poses y el balón las leen de aquí: así conviven v1 y chibi en la comparación)
    var D = { body: BODY, HIP_H: HIP_H, NECK_Y: NECK_Y, SH_X: SH_X, PALM: PALM, UPPER: UPPER, FORE: FORE, STRETCH: STRETCH_MAX, LEG: THIGH + SHIN, SH_H: SH_H, HEAD_C: HEAD_C, HEAD_RY: HEAD_RY, top: SH_H + HEAD_C + HEAD_RY, heads: (SH_H + HEAD_C + HEAD_RY) / (2 * HEAD_RY), reach: REACH, reachRest: REACH_REST };
    var r = { idx: idx, look: L, tc: tc, D: D, root: root, body: body, pelvis: pelvis, spine: spine, chest: chest, head: head, eyes: eyes, mouth: mouth, teeth: teeth, brow: [browL, browR], hair: hair,
      sh: [], up: [], el: [], hand: [], hip: [], th: [], kn: [], ft: [], face: 'neutra', faceE: 0, faceM: 0, blinkT: 1.5 + idx * 0.9, blinkOn: 0, pose: 'idle', t0: idx * 0.37, tFix: -1, ball: null, geos: [null, null, null], ink: null };
    for (var k = 0; k < 2; k++) {
      var s = k === 0 ? 1 : -1;
      var sh = bone(chest, s * SH_X, SH_Y, SH_Z), up = bone(sh), el = bone(up, 0, -UPPER, 0), hd = bone(el, 0, -FORE, 0);
      r.sh.push(sh); r.up.push(up); r.el.push(el); r.hand.push(hd);
      var hp = bone(pelvis, s * HIP_W, 0, 0), th = bone(hp), kn = bone(th, 0, -THIGH, 0), ft = bone(kn, 0, -SHIN, 0);
      r.hip.push(hp); r.th.push(th); r.kn.push(kn); r.ft.push(ft);
    }
    root.updateMatrixWorld(true);
    r.bones = bones; r.rest = [];
    for (k = 0; k < bones.length; k++) r.rest.push(bones[k].matrixWorld.clone());
    var skin = new THREE.SkinnedMesh(rigGeometry(r, LODR), dollMaterial(tc, L));
    skin.castShadow = true; skin.receiveShadow = true; skin.name = 'dollSkin' + idx; skin.frustumCulled = false;
    root.add(skin); root.updateMatrixWorld(true);
    skin.bind(new THREE.Skeleton(bones), skin.matrixWorld);
    r.skin = skin;
    ensureInk(r);
    r.handL = r.hand[0]; r.handR = r.hand[1]; r.footL = r.ft[0]; r.footR = r.ft[1];
    return r;
  }
  /** Geometría del muñeco para un nivel de detalle (0 baja, 1 media, 2 alta), en la pose de reposo guardada. */
  function rigGeometry(r, lod) {
    if (r.geos[lod]) return r.geos[lod];
    var keepK = LODK, keepR = LODR; LODK = LOD_K[lod]; LODR = lod;
    var G = new Geo(), L = r.look, tc = r.tc, k, s;
    function on(b) { var i = r.bones.indexOf(b); G.pre = r.rest[i]; G.bone = i; G.mode = 'flat'; G.owk = 1; return G; }
    try {
      torsoGeo(on(r.pelvis), r);
      headGeo(on(r.head), L, tc); faceGeo(G, r, L, tc, on);
      for (k = 0; k < 2; k++) {
        s = k === 0 ? 1 : -1;
        shoulderGeo(on(r.sh[k]), tc); upperGeo(on(r.up[k])); foreGeo(on(r.el[k]), L); handGeo(on(r.hand[k]), L, s);
        thighGeo(on(r.th[k]), tc); shinGeo(on(r.kn[k]), tc); shoeGeo(on(r.ft[k]), tc);
      }
    } finally { LODK = keepK; LODR = keepR; }
    return (r.geos[lod] = G.build());
  }
  function setLod(r, lod) {
    var g = rigGeometry(r, lod);
    if (r.skin.geometry !== g) { r.skin.geometry = g; if (r.ink) r.ink.geometry = g; }
  }
  function triCount(geo) { return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; }

  // ---------- Cara: celdas → uniformes del material ----------
  function setFaceCells(r, e, m) {
    r.faceE = e; r.faceM = m;
    var ud = r.skin.material.userData;
    ud.eyeOff.set((e & 3) * FE_W / ATLAS, -(e >> 2) * FE_H / ATLAS);
    ud.mouthOff.set(m * FM_W / ATLAS, 0);
  }
  function setFace(r, name) { var x = EXPR[name] || EXPR.neutra; r.face = EXPR[name] ? name : 'neutra'; setFaceCells(r, r.blinkOn > 0 ? 1 : x[0], x[1]); }
  /** Parpadeo: cada 2-5 s, 0,12 s con la celda 1 (no en las expresiones con los ojos ya cerrados). */
  function blink(r, dt) {
    var x = EXPR[r.face] || EXPR.neutra;
    if (r.blinkOn > 0) { r.blinkOn -= dt; if (r.blinkOn <= 0) { r.blinkOn = 0; setFaceCells(r, x[0], x[1]); } return; }
    r.blinkT -= dt;
    if (r.blinkT <= 0) { r.blinkT = 2 + Math.random() * 3; if (x[0] === 0 || x[0] === 2 || x[0] === 5 || x[0] === 6) { r.blinkOn = 0.12; setFaceCells(r, 1, x[1]); } }
  }

  // =====================================================================
  //  POSES (a mano, rotando huesos) y ANIMACIÓN DE DEMOSTRACIÓN (squash & stretch como escalas de huesos)
  // =====================================================================
  // Convenciones (huesos en reposo con la identidad; extremidades colgando en -Y): rotation.x < 0 lleva la mano/pie hacia
  // DELANTE (+Z); rotation.z > 0 lleva la mano hacia +X (la izquierda del muñeco). s = +1 lado izquierdo, -1 derecho.
  function rot(b, x, y, z) { b.rotation.set(x || 0, y || 0, z || 0); }
  function resetPose(r) {
    var i; for (i = 0; i < r.bones.length; i++) { r.bones[i].rotation.set(0, 0, 0); r.bones[i].scale.set(1, 1, 1); }
    r.body.position.set(0, 0, 0); r.pelvis.position.set(0, r.D.HIP_H, 0); r.head.position.set(0, r.D.NECK_Y, 0);
  }
  var POSES = {
    /** de pie, en reposo, con el balón en la mano derecha a la altura de la barriga */
    idle: function (r) {
      rot(r.pelvis, 0.02, 0, 0.02); rot(r.chest, 0, 0.06, -0.02); rot(r.head, 0.04, -0.14, -0.05);
      rot(r.up[0], -0.1, 0, 0.14); rot(r.el[0], -0.3, 0, 0.05);
      rot(r.up[1], -0.55, 0, -0.1); rot(r.el[1], -1.45, 0.0, 0); rot(r.hand[1], 0.3, 0, 0);
      rot(r.th[0], 0.02, 0, 0.06); rot(r.th[1], -0.02, 0, -0.1); rot(r.kn[1], 0.06, 0, 0); rot(r.ft[0], 0, 0.05, -0.06); rot(r.ft[1], -0.04, -0.1, 0.1);
    },
    /** recepción / plataforma: rodillas flexionadas, tronco adelante, brazos rectos y juntos, mirada al balón */
    recv: function (r) {
      var th = -1.0, kn = 1.35;
      r.pelvis.position.y = r.D.HIP_H - 0.26 * r.D.LEG;   // lo que acortan las rodillas flexionadas (pies en el suelo)
      rot(r.pelvis, 0.42, 0, 0); rot(r.chest, 0.22, 0, 0); rot(r.head, -0.62, 0, 0);
      for (var k = 0; k < 2; k++) {
        var s = k ? -1 : 1;
        rot(r.th[k], th, 0, s * 0.22); rot(r.kn[k], kn, 0, 0); rot(r.ft[k], -(th + kn) - 0.42, 0, -s * 0.22);
        rot(r.up[k], -0.78, 0, -s * 0.16); rot(r.el[k], 0.0, 0, -s * 0.06); rot(r.hand[k], 0.15, s * 1.3, 0);
      }
    },
    /** remate en el aire: brazo derecho armado, cuerpo arqueado, piernas recogidas (el estirón al golpe lo pone animate con reachTo) */
    spike: function (r) {
      r.body.position.y = 0.72;
      rot(r.pelvis, -0.22, 0.1, 0); rot(r.chest, -0.12, 0.25, 0.08); rot(r.head, -0.45, -0.12, 0);
      rot(r.up[1], -2.85, 0, -0.35); rot(r.el[1], -0.25, 0, 0); rot(r.hand[1], -0.55, 0, 0);
      rot(r.up[0], -0.95, 0, 0.45); rot(r.el[0], -1.1, 0, 0);
      rot(r.th[0], -0.55, 0, 0.12); rot(r.kn[0], 1.25, 0, 0); rot(r.ft[0], 0.45, 0, 0);
      rot(r.th[1], 0.35, 0, -0.12); rot(r.kn[1], 0.95, 0, 0); rot(r.ft[1], 0.5, 0, 0);
      r.body.scale.set(0.96, 1.08, 0.96);
    },
    /** bloqueo: en el aire, los dos brazos rectos arriba (animate los lleva con reachTo a los objetivos: estirón), rodillas recogidas */
    block: function (r) {
      r.body.position.y = 0.45;
      rot(r.pelvis, 0.08, 0, 0); rot(r.chest, 0.06, 0, 0); rot(r.head, -0.2, 0, 0);
      rot(r.up[0], -3.0, 0, 0.2); rot(r.up[1], -3.0, 0, -0.2); rot(r.hand[0], 0.25, 0, 0); rot(r.hand[1], 0.25, 0, 0);
      rot(r.th[0], -0.35, 0, 0.1); rot(r.kn[0], 0.8, 0, 0); rot(r.ft[0], 0.3, 0, 0);
      rot(r.th[1], -0.35, 0, -0.1); rot(r.kn[1], 0.8, 0, 0); rot(r.ft[1], 0.3, 0, 0);
    },
    /** celebración: brazos en V, una rodilla arriba, cabeza atrás */
    cel: function (r) {
      rot(r.pelvis, -0.1, 0, 0); rot(r.chest, -0.1, 0, 0); rot(r.head, -0.3, 0.1, 0.1);
      rot(r.up[0], -0.25, 0, 2.5); rot(r.el[0], 0, 0, 0.45); rot(r.hand[0], 0, 0, 0.3);
      rot(r.up[1], -0.25, 0, -2.5); rot(r.el[1], 0, 0, -0.45); rot(r.hand[1], 0, 0, -0.3);
      rot(r.th[0], -1.2, 0, 0.1); rot(r.kn[0], 1.5, 0, 0); rot(r.ft[0], 0.3, 0, 0);
      rot(r.th[1], 0.05, 0, -0.08); rot(r.ft[1], -0.05, 0, 0.08);
    }
  };
  // ---- Ganchos de squash & stretch (escalas de huesos; la fase 2 los llamará desde players.js) ----
  /** Estira (a > 0) o aplasta (a < 0) el cuerpo entero desde el suelo (hueso body): volumen casi constante. */
  function squash(r, a) { var sy = 1 + a, sx = 1 / Math.sqrt(sy); r.body.scale.set(sx, sy, sx); }
  /** Estirón del brazo k: brazo + antebrazo se alargan ×s desde el hombro (escala y del hueso del brazo) y adelgazan (volumen,
   *  ×1/√s); la bola del codo se desplaza con él; la MANO recupera su tamaño (escala inversa en el hueso de la mano). s = 1: reposo. */
  function stretchArm(r, k, s) {
    var q = Math.sqrt(s);
    r.up[k].scale.set(1 / q, s, 1 / q);
    r.hand[k].scale.set(q, 1 / s, q);
  }
  var DOWN = null, QA = null, TMP2 = null;
  /** IK de un hueso con estirón cartoon (gancho para la fase 2): lleva el centro de la PALMA del brazo k al punto `tw` (mundo) con el
   *  brazo recto apuntando a él. Si queda fuera del alcance de reposo, brazo + antebrazo se alargan lo que haga falta (tope r.D.STRETCH,
   *  que cubre el alcance del atleta). `w` (0..1, por defecto 1) = peso del estirón (0 = largo de reposo; valores < 0 lo encogen un poco:
   *  anticipación, mínimo ×0,9); `blend` (0..1, por defecto 1) = mezcla de la orientación con la pose actual del brazo (entrada suave).
   *  Devuelve el factor de estiramiento necesario (1 = llega sin estirar; > STRETCH = no llega ni estirado). */
  function reachTo(r, k, tw, w, blend) {
    if (!DOWN) { DOWN = new THREE.Vector3(0, -1, 0); QA = new THREE.Quaternion(); TMP2 = new THREE.Vector3(); }
    if (w == null) w = 1; if (blend == null) blend = 1;
    var sh = r.sh[k], up = r.up[k], el = r.el[k];
    r.root.updateMatrixWorld(true);
    TMP2.copy(tw); sh.worldToLocal(TMP2);
    var d = TMP2.length(), armL = r.D.UPPER + r.D.FORE, need = Math.max(0.2, (d - r.D.PALM) / armL);
    var sN = clamp(need, 1, r.D.STRETCH), s = Math.max(0.9, 1 + (sN - 1) * w);
    if (d > 1e-4) {
      TMP2.multiplyScalar(1 / d); QA.setFromUnitVectors(DOWN, TMP2);
      if (blend >= 1) up.quaternion.copy(QA); else up.quaternion.slerp(QA, blend);
      el.rotation.x *= 1 - blend; el.rotation.z *= 1 - blend;
    }
    stretchArm(r, k, s);
    return need;
  }
  /** Rebote de la cabeza (sube/baja y se inclina sin cuello: solo el hueso head). */
  function headBob(r, dy, pitch) { r.head.position.y = r.D.NECK_Y + dy; r.head.rotation.x += pitch || 0; }

  /** Bucle sencillo de la maqueta: cada muñeco repite su pose con vida (respiración, rebote de la cabeza, estirón, aplastamiento). */
  function animate(r, t) {
    resetPose(r);
    var P = POSES[r.pose] || POSES.idle; P(r);
    var w;
    switch (r.pose) {
      case 'idle':   // respiración + rebote de la cabeza al compás + el balón sube y baja con la mano
        w = Math.sin(t * 2.2);
        r.chest.scale.set(1 + 0.012 * w, 1 + 0.02 * w, 1 + 0.012 * w);
        headBob(r, 0.008 * Math.sin(t * 2.2 + 0.6), 0.03 * Math.sin(t * 2.2 + 0.6));
        r.el[1].rotation.x += 0.06 * Math.sin(t * 2.2 - 0.4);
        break;
      case 'recv':   // balanceo lateral del peso y cabeza que sigue al balón
        w = Math.sin(t * 1.7);
        r.pelvis.position.x = 0.03 * w; r.pelvis.rotation.z = -0.05 * w; r.head.rotation.y = 0.12 * w;
        headBob(r, 0.004 * Math.sin(t * 3.4), 0);
        break;
      case 'spike': {   // ciclo de 1,9 s: carrera (abajo, aplastado) → impulso (estirado) → golpe (estirón del brazo) → aterrizaje (aplastado) → rebote
        var T = (t % 1.9) / 1.9, air = sstep(0.1, 0.22, T) * (1 - sstep(0.62, 0.74, T)), h = Math.sin(clamp((T - 0.14) / 0.56, 0, 1) * PI);
        r.body.position.y = 0.78 * h;
        var a = 0;
        if (T < 0.14) a = -0.12 * Math.sin(T / 0.14 * PI);                         // anticipación: aplastado antes de saltar
        else if (T < 0.3) a = 0.1 * Math.sin((T - 0.14) / 0.16 * PI);              // despegue: estirado
        else if (T > 0.68 && T < 0.86) a = -0.14 * Math.sin((T - 0.68) / 0.18 * PI); // aterrizaje: aplastado
        else if (T >= 0.86) a = 0.03 * Math.sin((T - 0.86) / 0.14 * PI);           // rebote
        squash(r, a);
        r.up[1].rotation.x = lerp(-1.6, -2.85, sstep(0.18, 0.4, T)) + 0.5 * sstep(0.44, 0.6, T);   // armado → golpe → acompañamiento
        r.hand[1].rotation.x = -0.55 + 0.9 * sstep(0.42, 0.52, T);
        // ESTIRÓN cartoon (reachTo): el balón está a la altura del alcance del atleta sobre el salto (fuera del brazo corto de reposo).
        // Anticipación: el brazo se ENCOGE un poco (w < 0) justo antes; estirón en pocos fotogramas hasta el golpe; vuelve al soltar.
        var hitT = 0.42, ws = T < 0.3 ? 0 : T < 0.37 ? -0.3 * Math.sin((T - 0.3) / 0.07 * PI) : T < hitT ? sstep(0.37, hitT, T) : T < 0.48 ? 1 : 1 - sstep(0.48, 0.6, T);
        var bl = sstep(0.3, hitT, T) * (1 - sstep(0.5, 0.62, T));
        TMP.set(-r.D.SH_X - 0.1, 0.78 + r.D.reach - 0.03, 0.22); r.root.localToWorld(TMP);   // objetivo: palma a reach m sobre los pies, en el vértice del salto
        if (bl > 0) reachTo(r, 1, TMP, ws, bl);
        if (r.ball) {   // el balón del remate: llega, se golpea en hitT y sale disparado
          r.ball.visible = T > 0.26 && T < 0.64;
          if (r.ball.visible) { r.root.worldToLocal(r.ball.position.copy(TMP)); if (T < hitT) r.ball.position.y += 0.9 * (hitT - T) / 0.16; else { r.ball.position.z += 7 * (T - hitT); r.ball.position.y -= 3.5 * (T - hitT); } }
        }
        // en el suelo: piernas de carrera/caída en vez de recogidas
        var gnd = 1 - air;
        if (gnd > 0) { for (var k = 0; k < 2; k++) { r.th[k].rotation.x *= air; r.kn[k].rotation.x = r.kn[k].rotation.x * air + 0.9 * gnd * (T < 0.14 || T > 0.68 ? 1 : 0); r.ft[k].rotation.x *= air; } r.pelvis.position.y = r.D.HIP_H - 0.18 * r.D.LEG * gnd * (T < 0.14 || T > 0.68 ? 1 : 0); }
        headBob(r, -0.01 * a * 4, -0.12 * Math.max(0, ws));
        r.body.scale.y *= 1;   // (ya en squash)
        break; }
      case 'cel': {   // saltitos de alegría: parábola, brazos que bombean, aplastamiento al caer y rebote de la cabeza
        var Tc = (t % 1.1) / 1.1, hc = Math.sin(clamp((Tc - 0.1) / 0.5, 0, 1) * PI);
        r.body.position.y = 0.32 * hc;
        var ac = 0;
        if (Tc < 0.1) ac = -0.1 * Math.sin(Tc / 0.1 * PI); else if (Tc < 0.22) ac = 0.07 * Math.sin((Tc - 0.1) / 0.12 * PI);
        else if (Tc > 0.6 && Tc < 0.78) ac = -0.13 * Math.sin((Tc - 0.6) / 0.18 * PI); else if (Tc >= 0.78) ac = 0.03 * Math.sin((Tc - 0.78) / 0.22 * PI);
        squash(r, ac);
        var pump = Math.sin(Tc * 2 * PI);
        r.up[0].rotation.z += 0.25 * pump; r.up[1].rotation.z -= 0.25 * pump; r.el[0].rotation.z = 0.45 + 0.3 * pump; r.el[1].rotation.z = -0.45 - 0.3 * pump;
        var kneeUp = sstep(0.1, 0.3, Tc) * (1 - sstep(0.55, 0.7, Tc));
        r.th[0].rotation.x = -1.2 * kneeUp; r.kn[0].rotation.x = 1.5 * kneeUp; r.ft[0].rotation.x = 0.3 * kneeUp;
        if (kneeUp < 1) { var kb = (1 - kneeUp) * (Tc < 0.12 || Tc > 0.6 ? 1 : 0); r.kn[0].rotation.x += 0.8 * kb; r.kn[1].rotation.x = 0.8 * kb; r.th[0].rotation.x -= 0.4 * kb; r.th[1].rotation.x = -0.4 * kb; }
        headBob(r, -0.02 * ac * 3 + 0.01 * pump, 0.06 * pump);
        break; }
      case 'block': {   // ciclo de 1,6 s: agachado → salto con los brazos que se estiran hacia la cinta → aterrizaje
        var Tb = (t % 1.6) / 1.6, hb = Math.sin(clamp((Tb - 0.12) / 0.56, 0, 1) * PI);
        r.body.position.y = 0.45 * hb;
        var ab = 0;
        if (Tb < 0.12) ab = -0.1 * Math.sin(Tb / 0.12 * PI); else if (Tb < 0.26) ab = 0.08 * Math.sin((Tb - 0.12) / 0.14 * PI);
        else if (Tb > 0.66 && Tb < 0.84) ab = -0.12 * Math.sin((Tb - 0.66) / 0.18 * PI);
        squash(r, ab);
        var wb = sstep(0.2, 0.34, Tb) * (1 - sstep(0.6, 0.72, Tb)), blb = sstep(0.12, 0.3, Tb) * (1 - sstep(0.62, 0.74, Tb));
        for (var kb2 = 0; kb2 < 2; kb2++) {
          TMP.set((kb2 ? -1 : 1) * 0.24, 0.45 + r.D.reach - 0.05, 0.28); r.root.localToWorld(TMP);   // manos a reach m sobre los pies del vértice, por encima de la cinta
          if (blb > 0) reachTo(r, kb2, TMP, wb, blb);
          else { rot(r.up[kb2], -0.6 - 0.4 * Math.sin(Tb * PI), 0, (kb2 ? -1 : 1) * 0.25); rot(r.el[kb2], -0.9, 0, 0); }
        }
        var gb = Tb < 0.12 || Tb > 0.66 ? 1 : 0;
        if (gb) { for (var kb3 = 0; kb3 < 2; kb3++) { r.th[kb3].rotation.x = -0.5; r.kn[kb3].rotation.x = 1.0; r.ft[kb3].rotation.x = -0.5; } r.pelvis.position.y = r.D.HIP_H - 0.2 * r.D.LEG; }
        headBob(r, -0.015 * ab * 3, 0);
        break; }
    }
    // el balón va en la mano derecha del que está en reposo (apoyado en la manopla); en el remate lo mueve el bucle de arriba
    if (r.ball && r.pose !== 'spike') { r.ball.visible = r.pose === 'idle'; if (r.ball.visible) { r.root.updateMatrixWorld(true); r.hand[1].getWorldPosition(TMP); r.root.worldToLocal(TMP); r.ball.position.set(TMP.x - 0.02, TMP.y - r.D.PALM + 0.03 + BR * 0.95, TMP.z + 0.03); r.ball.rotation.y = t * 0.3; } }
  }
  var TMP = null, BR = 0.21;

  // ---------- Balón sencillo (toon + tinta) para la maqueta ----------
  function makeBall() {
    var S = 256, cv = canvas(S, S), g = cv.getContext('2d'), cols = ['#1cc4b4', '#fffaf0', '#0b8a86'];
    for (var i = 0; i < 3; i++) { g.fillStyle = cols[i]; g.fillRect(i * S / 3, 0, S / 3 + 1, S); }
    g.fillStyle = 'rgba(29,21,48,0.8)'; g.fillRect(S / 3 - 3, 0, 6, S); g.fillRect(2 * S / 3 - 3, 0, 6, S); g.fillRect(0, 0, S, 5); g.fillRect(0, S - 5, S, 5);
    var t = texOf(cv), m = VB.TOON && VB.TOON.toonMat ? VB.TOON.toonMat({ map: t }) : new THREE.MeshToonMaterial({ map: t });
    var b = new THREE.Mesh(new THREE.SphereGeometry(BR, 20, 14), m); b.name = 'dollBall'; b.castShadow = true;
    if (VB.TOON && VB.TOON.outline) VB.TOON.outline(b, OUT_MIN, { max: OUT_MAX, k: VB.TOON.px ? OUT_PX / VB.TOON.px : 1 });
    return b;
  }

  // =====================================================================
  //  ESCENA DE DEPURACIÓN ?debug=doll
  // =====================================================================
  var rigs = [], group = null, on = false, view = 'fila', tAnim = 0, hidden = [], styleEl = null, camSet = null, lodNow = 2;
  var VIEWS = {
    // posiciones en coords de la SIM (x largo, y ancho), yaw de la sim (0 = mira a +x, hacia la cámara), cámara en Three.
    // Las alturas (y de cam/at) están pensadas para v1 (cabeza a 1,65, 1,86 de pie): applyCamera las escala con el cuerpo activo
    // (cuerpo entero: × alto/1,86; `face`: desplazadas con el centro de la cabeza); `fixed` no se toca (comparación antes/después).
    fila: { pos: [[3, -1.65], [3, -0.55], [3, 0.55], [3, 1.65]], yaw: [0, 0, 0, 0], cam: [7.4, 1.5, 0], at: [3, 1.2, 0], fov: 40 },
    poses: { pos: [[3, -1.8], [3, -0.6], [3, 0.6], [3, 1.8]], yaw: [0.5, 0.5, 0.5, 0.5], cam: [6.9, 2.7, 3.1], at: [3, 1.45, 0.1], fov: 46 },
    cara: { pos: [[3, -0.62], [3, 0], [3, 0.62]], yaw: [0, 0, 0], cam: [5.3, 1.66, 0], at: [3, 1.63, 0], fov: 30, faces: ['neutra', 'alegria', 'esfuerzo'], poses: ['stand', 'stand', 'stand'], face: true },
    cuerpo: { pos: [[3, -1.25], [3, 0], [3, 1.25]], yaw: [0, 0.78, PI], cam: [7.4, 1.25, 0], at: [3, 0.95, 0], fov: 32, poses: ['stand', 'stand', 'stand'] },
    // los otros peinados (rehace los tres primeros muñecos sin complemento): flequillo, rapado, trenzas + moño
    peinados: { pos: [[3, -1.05], [3, -0.35], [3, 0.35], [3, 1.05]], yaw: [0.25, 0.25, 0.25, 0.25], cam: [6.1, 1.75, 0.5], at: [3, 1.45, 0], fov: 32, poses: ['stand', 'stand', 'stand', 'stand'], faces: ['neutra', 'sorpresa', 'pena', 'lengua'], restyle: [['flequillo', ''], ['rapado', ''], ['trenzas', ''], ['mono', '']], face: true },
    // un solo muñeco de pie con cámara FIJA (misma para v1 y chibi): hoja antes/después
    solo: { pos: [[3, 0]], yaw: [0.12], cam: [7.2, 1.15, 0], at: [3, 0.98, 0], fov: 30, poses: ['stand'], faces: ['neutra'], fixed: true },
    // estirón del remate (el rematador solo, 3/4, cámara fija: 4 fotogramas con freeze) y bloqueo (dos muñecos)
    estiron: { pos: [null, null, [3, 0]], yaw: [0, 0, 0.55], cam: [6.7, 2.0, 2.3], at: [3, 1.65, 0.1], fov: 48, fixed: true },
    bloqueo: { pos: [null, null, [3, -0.55], [3, 0.55]], yaw: [0, 0, 0.3, 0.3], cam: [6.9, 1.9, 1.6], at: [3, 1.75, 0], fov: 44, poses: [null, null, 'block', 'block'], faces: [null, null, 'concentrado', 'esfuerzo'], fixed: true }
  };
  function viewY(V, y) {
    if (V.fixed) return y;
    var top = SH_H + HEAD_C + HEAD_RY, hc = SH_H + HEAD_C;
    return V.face ? y + (hc - 1.65) : y * top / 1.86;
  }
  POSES.stand = function (r) {   // de pie, neutro (hoja de cuerpo)
    rot(r.up[0], -0.05, 0, 0.12); rot(r.up[1], -0.05, 0, -0.12); rot(r.el[0], -0.15, 0, 0); rot(r.el[1], -0.15, 0, 0);
    rot(r.th[0], 0, 0, 0.05); rot(r.th[1], 0, 0, -0.05); rot(r.ft[0], 0, 0, -0.05); rot(r.ft[1], 0, 0, 0.05);
  };
  function hideObj(o) { if (o && o.visible) { o.visible = false; hidden.push(o); } }
  function hideGame() {
    if (!ctx || !ctx.scene) return;
    hideObj(ctx.scene.getObjectByName('players'));
    hideObj(ctx.scene.getObjectByName('contactBlobs'));
    try { if (VB.FX && VB.FX.ballObject) hideObj(VB.FX.ballObject()); } catch (e) { }
  }
  function placeView(name) {
    var V = VIEWS[name] || VIEWS.fila; view = VIEWS[name] ? name : 'fila';
    if (V.restyle) for (var k = 0; k < V.restyle.length; k++) if (rigs[k] && (rigs[k].look.style !== V.restyle[k][0] || rigs[k].look.acc !== V.restyle[k][1])) VB.Doll.restyle(k, V.restyle[k][0], V.restyle[k][1]);
    for (var i = 0; i < rigs.length; i++) {
      var r = rigs[i], p = V.pos[i];
      r.root.visible = !!p;
      if (!p) continue;
      r.root.position.set(p[0], 0, -p[1]);
      var yaw = V.yaw[i] || 0; r.root.rotation.y = Math.atan2(Math.cos(yaw), -Math.sin(yaw));
      r.pose = V.poses && V.poses[i] ? V.poses[i] : r.look.pose;
      setFace(r, V.faces && V.faces[i] ? V.faces[i] : r.look.face);
    }
    camSet = V;
  }
  function applyCamera() {
    var cam = ctx && ctx.camera, V = camSet; if (!cam || !V) return;
    cam.position.set(V.cam[0], viewY(V, V.cam[1]), V.cam[2]); cam.up.set(0, 1, 0); cam.lookAt(V.at[0], viewY(V, V.at[1]), V.at[2]);
    if (cam.fov !== V.fov) { cam.fov = V.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
  }
  function reachInfo() {
    var d = null; try { d = VB.Players && VB.Players.dims ? VB.Players.dims() : null; } catch (e) { }
    return { body: BODY, doll: +REACH.toFixed(4), rest: +REACH_REST.toFixed(4), stretch: +STRETCH_MAX.toFixed(3), athlete: d ? +d.reach.toFixed(4) : null, shoulder: +SH_H.toFixed(3), upper: +UPPER.toFixed(4), fore: +FORE.toFixed(4), palm: PALM, hip: +HIP_H.toFixed(3), head: +(2 * HEAD_RY).toFixed(3), headW: +(2 * HEAD_RX).toFixed(3), headTop: +(SH_H + HEAD_C + HEAD_RY).toFixed(3), heads: +((SH_H + HEAD_C + HEAD_RY) / (2 * HEAD_RY)).toFixed(2), handLow: +(SH_H - UPPER - FORE - PALM - 0.06 * HAND_K).toFixed(3) };
  }

  VB.Doll = {
    rigs: rigs, LOOKS: LOOKS, STYLES: STYLES, ACCS: ACCS, EXPR: EXPR, POSES: POSES,
    squash: squash, stretchArm: stretchArm, reachTo: reachTo, headBob: headBob, setFaceOf: setFace,
    /** Dimensiones del muñeco (m): para la fase 2 (players.js) y las pruebas. */
    dims: function () { return { HIP_H: HIP_H, HIP_W: HIP_W, THIGH: THIGH, SHIN: SHIN, ANKLE: ANKLE, SPINE_Y: SPINE_Y, CHEST_Y: CHEST_Y, SH_X: SH_X, SH_Y: SH_Y, NECK_Y: NECK_Y, UPPER: UPPER, FORE: FORE, PALM: PALM, HEAD_C: HEAD_C, HEAD_RX: HEAD_RX, HEAD_RY: HEAD_RY, reach: REACH, shoulder: SH_H }; },
    reach: reachInfo,
    /** Construye un muñeco (fuera de la escena de depuración: para la fase 2 / pruebas). L = {skin, hair, style, acc, team, num}. */
    build: function (L, idx) { if (!THREE) { THREE = window.THREE; ctx = VB.ctx; applyDims(BODY); } return buildRig(L, idx || 0); },
    /** Preset de cuerpo activo ('chibi' | 'v1') y nombres. */
    body: function () { return BODY; },
    bodies: function () { return Object.keys(BODIES); },
    /** Cambia el preset de cuerpo en caliente (rehace los muñecos de la escena con su mismo aspecto). */
    setBody: function (name) {
      if (!BODIES[name]) return false;
      applyDims(name);
      if (on) { for (var i = 0; i < rigs.length; i++) this.restyle(i, null, null); placeView(view); applyCamera(); }
      return BODY;
    },
    /** Arranca la escena de depuración (main.js, ?debug=doll). */
    start: function (c, g) {
      ctx = c; THREE = c.THREE; if (VB.C && VB.C.BR) BR = VB.C.BR; TMP = new THREE.Vector3();
      applyDims((ctx.params && ctx.params.body) || 'chibi');
      if (group) { ctx.scene.remove(group); }
      group = new THREE.Group(); group.name = 'dolls'; ctx.scene.add(group); rigs.length = 0;
      for (var i = 0; i < LOOKS.length; i++) { var r = buildRig(LOOKS[i], i); rigs.push(r); group.add(r.root); }
      rigs[0].ball = makeBall(); rigs[0].root.add(rigs[0].ball);
      rigs[2].ball = makeBall(); rigs[2].root.add(rigs[2].ball);   // el balón del remate (lo mueve el bucle del estirón)
      hideGame();
      if (g) g.watch = true;   // sin galón ni halo del controlado
      // HUD fuera: solo el pabellón y los muñecos
      if (!styleEl) { styleEl = document.createElement('style'); styleEl.textContent = '#hud,#coach,#prompt,#banner,#callout,#guide,#touch,#touchbar,#offArrow,#stamp,#rally,#chal,#fps{display:none!important}'; document.head.appendChild(styleEl); }
      placeView((ctx.params && ctx.params.view) || 'fila');
      on = true; tAnim = 0;
      try { if (ctx.fixShadowDepth) ctx.fixShadowDepth(); } catch (e) { }
      var ri = reachInfo(), st = this.stats();
      console.info('[VB] doll (' + BODY + '): alcance ' + ri.doll + ' m (atleta ' + ri.athlete + '), hombro ' + ri.shoulder + ', cabeza ' + ri.head + ' m hasta ' + ri.headTop + ' m (' + ri.heads + ' cabezas); triángulos alta/media/baja ' + st.tris.join('/') + ', dibujos ' + st.draws);
    },
    /** Cada frame (main.js, solo en ?debug=doll, después de la cámara): animación de la maqueta y cámara fija. */
    update: function (g, dt) {
      if (!on) return;
      dt = Math.min(0.05, dt || 0); tAnim += dt;
      // nivel de detalle según la calidad activa (la maqueta no está en la lista de módulos de main.js: se mira aquí)
      var rk = ctx.quality && ctx.quality.rank != null ? ctx.quality.rank : 2; if (rk !== lodNow) { lodNow = rk; this.setLod(rk); }
      for (var i = 0; i < rigs.length; i++) { var r = rigs[i]; if (!r.root.visible) continue; animate(r, r.tFix >= 0 ? r.tFix : tAnim + r.t0); blink(r, dt); }
      for (var h = 0; h < hidden.length; h++) hidden[h].visible = false;
      applyCamera();
    },
    /** Cambia la vista: 'fila' | 'poses' | 'cara' | 'cuerpo'. */
    view: function (name) { if (!on) return false; placeView(name); applyCamera(); return view; },
    /** Expresión de un muñeco (0-3): neutra | concentrado | esfuerzo | grito | alegria | pena | sorpresa | lengua. */
    setFace: function (i, name) { var r = rigs[i]; if (!r) return false; setFace(r, name); return r.face; },
    /** Pose de un muñeco: idle | recv | spike | cel | stand. */
    setPose: function (i, name) { var r = rigs[i]; if (!r || !POSES[name]) return false; r.pose = name; return true; },
    /** Capturas reproducibles: congela el bucle de cada muñeco en un instante (s) — {idx: t}; t < 0 = vuelve a correr.
     *  Remate: el golpe está en t = 0,8 (ciclo de 1,9 s); celebración: en el aire en t = 0,38 (ciclo de 1,1 s). */
    freeze: function (map) { for (var k in map) if (rigs[k]) { rigs[k].tFix = map[k]; rigs[k].blinkOn = 0; } return true; },
    /** Rehace un muñeco con otro peinado / complemento (pruebas). */
    restyle: function (i, style, acc) {
      var r = rigs[i]; if (!r) return false;
      var L = Object.assign({}, r.look); if (style) L.style = style; if (acc != null) L.acc = acc;
      if (r.ball && r.ball.parent === r.root) r.root.remove(r.ball);
      var n = buildRig(L, i); n.pose = r.pose; n.ball = r.ball; n.tFix = r.tFix; if (r.ball) n.root.add(r.ball);
      n.root.position.copy(r.root.position); n.root.rotation.copy(r.root.rotation); setFace(n, r.face);
      group.remove(r.root); if (r.ink && VB.TOON && VB.TOON.drop) VB.TOON.drop(r.ink);
      group.add(n.root); rigs[i] = n; return true;
    },
    /** Nivel de detalle de todos (0 baja, 1 media, 2 alta). */
    setLod: function (lod) { for (var i = 0; i < rigs.length; i++) setLod(rigs[i], lod); return lod; },
    setQuality: function (q) { var rk = q && q.rank != null ? q.rank : 2; if (on) this.setLod(rk); },
    /** Triángulos por nivel (muñeco 0) y dibujos por muñeco (piel + tinta + sombra). */
    stats: function () {
      var r = rigs[0]; if (!r) return null;
      var tris = [0, 1, 2].map(function (l) { return triCount(rigGeometry(r, l)); });
      return { tris: tris, draws: 1 + (r.ink ? 1 : 0) + 1, reach: reachInfo() };
    },
    active: function () { return on; }
  };
})();
