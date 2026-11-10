/* =====================================================================
 * VOLEY 3D — js/arena.js   (owner: arena)
 * Pabellón "PALAU DEL MAR": suelo deportivo procedural (tarima pintada,
 * líneas reglamentarias FIVB), red con malla real y onda al tocarla,
 * antenas, postes acolchados, silla del 1.er árbitro, 2.º árbitro, jueces
 * de línea con bandera, mesa del anotador, gradas con público instanciado
 * animado en GPU (botes, brazos arriba, ola), vallas LED con marcas
 * ficticias y mensajes de partido, videomarcadores de fondo y marcador
 * central colgado, cerchas y focos del techo, haces de luz, mapa de
 * entorno PMREM y post-proceso propio (bloom + ACES + viñeta) en calidad
 * alta.
 *
 * Coordenadas: sim (x largo, y ancho, z arriba) -> three (x, z, -y).
 * Todo procedural (canvas). Sin asignaciones en el bucle por frame.
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var THREE, ctx, C;
  var root, keyLight, rimLight, fillLight, hemi;
  var FONT = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

  // ---------- Dimensiones del pabellón (metros, coordenadas de sim) ----------
  var FZX = 15.5, FZY = 9.5;          // zona libre FIVB: 6.5 m tras los fondos, 5 m en laterales
  var TX = 16.6, TY = 10.6;           // suelo con textura
  var BX = 15.85, BY = 9.85;          // vallas LED
  var SY0 = 11.6, SX0 = 17.8;         // primera fila de gradas (lateral / fondo)
  var ROWS_L = 16, ROWS_E = 13, ROW_D = 0.8, ROW_H = 0.42;
  var LATX = 28, ENDY = 11.2;         // extensión de las gradas
  var HALL_X = 30.5, HALL_Y = 26.5, HALL_H = 22, SCR_Z = 10.75;
  var SEAT_W = 0.56;

  // Paleta (identidad "Palau del Mar": arena cálida + azul Mediterráneo)
  // CARTOON (9-nov-2026): colores planos y saturados; la pista sigue siendo cálida y la zona libre azul (legibilidad).
  var PAL = {
    court: '#f7c470', courtEdge: '#efb862', courtAttack: '#f0b05e', free: '#1f8fd0', freeHi: '#29a0de', surround: '#263a78',
    line: '#ffffff', outer: '#231d4a', wall: '#2c2a66', step: '#38377a', stepTop: '#434386',
    seatA: '#e8504a', seatB: '#2fb6c9', seatC: '#ffc93c', barrier: '#2a2560', steel: '#4a4f8a', truss: '#3d3c78'
  };
  // asientos por bloques de colores (grada de dibujo: cada bloque entre pasillos de un color)
  var SEAT_BLOCKS = ['#e8504a', '#ffb43c', '#2fb6c9', '#5a7dff', '#ff7aa8', '#7ad36a'];
  var TEAMC = ['#ff5b3a', '#3f8cff'];

  // Utilidades reutilizables (nada de `new` por frame)
  var _m, _m3, _q, _e, _v, _v2, _s, _p, _col, UNIT_BOX;
  function col(hex) { return new THREE.Color(hex); }

  /* =====================================================================
   * VB.TOON (contrato del sprint cartoon): sombreado por bandas y contorno de «tinta».
   *   gradientMap: DataTexture de 3 pasos (sombra / media / luz) para MeshToonMaterial. El toon de three la muestrea con
   *     u = dot(N, L) * 0,5 + 0,5; 10 texels: N·L < 0 → sombra, 0..0,4 → media, > 0,4 → luz. Filtro NEAREST: bandas duras.
   *   ink: color de la tinta (#1d1530). shadow: tono de las sombras (#2b2547; la hemisférica ya las tiñe de violeta).
   *   outline(mesh, m): casco invertido (caras traseras empujadas por la normal) que comparte geometría (y esqueleto o
   *     instancias) con `mesh`, colgado como hijo. Grosor = max(m metros, ~TOON_PX px de pantalla): se lee igual cerca y
   *     lejos. Devuelve la malla; en calidad baja queda oculta (y se vuelve a ver al subir de calidad). Sin sombras.
   *   toonMat(params): MeshToonMaterial con el gradientMap ya puesto (params como los de three).
   *   enabled: false en calidad baja (contornos ocultos). Coste: 1 dibujo por contorno visible.
   * ===================================================================== */
  var TOON_PX = 1.8, toonU = null, toonList = [], toonMats = {};
  function makeToon(T) {
    if (VB.TOON && VB.TOON.gradientMap) return VB.TOON;
    var lv = [46, 46, 46, 46, 46, 140, 140, 255, 255, 255], d = new Uint8Array(lv.length * 4); // lineal: 0,18 · 0,55 · 1
    for (var i = 0; i < lv.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = lv[i]; d[i * 4 + 3] = 255; }
    var gm = new T.DataTexture(d, lv.length, 1, T.RGBAFormat);
    gm.minFilter = gm.magFilter = T.NearestFilter; gm.generateMipmaps = false; gm.needsUpdate = true;
    toonU = { uInkPx: { value: 0.0025 }, uInk: { value: new T.Color(0x1d1530) } };
    // o (opcional; integración con players): max = tope en metros, k = multiplicador del grosor en píxeles, ow = atributo
    // `ow` por vértice (0..1, peso del contorno: la cara, los ribetes y los cordones llevan 0; manos, orejas y nariz menos)
    function inkMat(th, o) {
      o = o || {};
      var mx = o.max > 0 ? o.max : 10, kk = o.k > 0 ? o.k : 1, ow = !!o.ow, ic = o.color != null ? new T.Color(o.color) : null;
      var k = th.toFixed(4) + '|' + mx.toFixed(4) + '|' + kk.toFixed(3) + (ow ? 'w' : '') + (ic ? '|' + ic.getHexString() : ''); if (toonMats[k]) return toonMats[k];
      // tinta de color propio (opts.color, p. ej. atletas con la tinta de su equipo): uniforme propio, MISMO programa
      var inkU = ic ? { value: ic } : toonU.uInk;
      var m = new T.MeshBasicMaterial({ color: 0x1d1530, side: T.BackSide });
      if (ow) m.defines = { VB_OW: 1 };
      m.onBeforeCompile = function (sh) {
        sh.uniforms.uInkPx = toonU.uInkPx; sh.uniforms.uInk = inkU; sh.uniforms.uInkTh = { value: th };
        sh.uniforms.uInkMax = { value: mx }; sh.uniforms.uInkK = { value: kk };
        // después del esqueleto: profundidad y normal de la pose actual (con USE_SKINNING objectNormal ya va deformada)
        sh.vertexShader = 'uniform float uInkPx; uniform float uInkTh; uniform float uInkMax; uniform float uInkK;\n#ifdef VB_OW\nattribute float ow;\n#endif\n' +
          sh.vertexShader.replace('#include <skinning_vertex>',
          '#include <skinning_vertex>\n#ifdef USE_SKINNING\n vec3 vbIn = objectNormal;\n#else\n vec3 vbIn = normal;\n#endif\n' +
          ' vec4 vbIp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n vbIp = instanceMatrix * vbIp;\n#endif\n' +
          ' float vbIz = max(0.3, -(modelViewMatrix * vbIp).z);\n float vbIw = min(uInkMax, max(uInkTh, vbIz * uInkPx * uInkK));\n' +
          '#ifdef VB_OW\n vbIw *= ow;\n#endif\n transformed += normalize(vbIn) * vbIw;');
        sh.fragmentShader = 'uniform vec3 uInk;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( uInk, opacity );');
      };
      m.customProgramCacheKey = function () { return ow ? 'vb-toon-ink-w' : 'vb-toon-ink'; };
      toonMats[k] = m; return m;
    }
    VB.TOON = {
      gradientMap: gm, ink: 0x1d1530, shadow: 0x2b2547, enabled: true, px: TOON_PX,
      toonMat: function (p) { var m = new T.MeshToonMaterial(p || {}); m.gradientMap = gm; return m; },
      /** outline(mesh, m, opts): opts opcional { max: tope en metros, k: multiplicador del grosor en píxeles, color: tinta propia
       *  (hex o THREE.Color; sin él, la tinta común 0x1d1530; mismo programa, un material por color) }. Si la
       *  geometría trae el atributo `ow` (atletas de players) se usa como peso por vértice. Un solo contorno para todo. */
      outline: function (mesh, th, opts) {
        if (!mesh || !mesh.geometry || !mesh.geometry.attributes.normal) return null;
        var mat = inkMat(Math.max(0, +th || 0), { max: opts && opts.max, k: opts && opts.k, color: opts && opts.color, ow: !!mesh.geometry.attributes.ow }), o;
        if (mesh.isSkinnedMesh) { o = new T.SkinnedMesh(mesh.geometry, mat); o.bindMode = mesh.bindMode; o.bind(mesh.skeleton, mesh.bindMatrix); }
        else if (mesh.isInstancedMesh) {
          o = new T.InstancedMesh(mesh.geometry, mat, mesh.count); o.instanceMatrix = mesh.instanceMatrix;
          o.onBeforeRender = function () { o.count = mesh.count; };
        } else o = new T.Mesh(mesh.geometry, mat);
        o.name = (mesh.name || 'mesh') + ':ink'; o.castShadow = false; o.receiveShadow = false;
        o.frustumCulled = mesh.frustumCulled; o.renderOrder = mesh.renderOrder; o.visible = VB.TOON.enabled;
        o.userData.inkRank = 1;
        o.userData.inkOf = mesh; mesh.add(o); toonList.push(o);
        return o;
      },
      /** Quita un contorno de la lista (p. ej. players al reconstruir los atletas tras cambiar la equipación). */
      drop: function (o) { var i = toonList.indexOf(o); if (i >= 0) toonList.splice(i, 1); if (o && o.parent) o.parent.remove(o); },
      /** Llamado por arena (setQuality): contornos fuera en calidad baja. */
      setQuality: function (q) {
        var rk = !q ? 2 : q.rank, on = rk >= 1; VB.TOON.enabled = on; VB.TOON.rank = rk;
        // userData.inkRank: calidad mínima de ese contorno (1 = media, 2 = solo alta); userData.inkOn === false lo apaga
        for (var i = 0; i < toonList.length; i++) { var ud = toonList[i].userData; toonList[i].visible = on && rk >= (ud.inkRank || 1) && ud.inkOn !== false; }
      },
      /** Por frame (arena): grosor mínimo en píxeles según el fov y el alto del lienzo. */
      frame: function (cam, h) {
        if (!cam || !h) return;
        // INTEGRACIÓN: el color de la tinta se crea al cargar arena.js, ANTES de que main.js ponga
        // ColorManagement.legacyMode = false; sin esto quedaba en sRGB sin linealizar y la tinta salía lavanda (#6a5a90)
        if (!toonU.lin) { toonU.uInk.value.set(0x1d1530); toonU.lin = true; }
        var px = TOON_PX * Math.max(0.75, Math.min(1.6, h / 720));
        toonU.uInkPx.value = px * 2 * Math.tan(cam.fov * Math.PI / 360) / h;
      },
      _list: toonList
    };
    return VB.TOON;
  }
  if (window.THREE) { try { makeToon(window.THREE); } catch (e) { } }

  // Aleatorio con semilla: el pabellón se ve igual en cada carga
  var _seed = 20261106;
  function rnd() { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; }
  function pick(a) { return a[Math.floor(rnd() * a.length) % a.length]; }

  // ---------- Fusión de geometría con colores por vértice ----------
  function Builder() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; }
  Builder.prototype.add = function (geo, m, color) {
    var pa = geo.attributes.position, na = geo.attributes.normal;
    _m3.getNormalMatrix(m);
    for (var k = 0; k < pa.count; k++) {
      _v.fromBufferAttribute(pa, k).applyMatrix4(m); this.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(na, k).applyMatrix3(_m3).normalize(); this.n.push(_v.x, _v.y, _v.z);
      this.c.push(color.r, color.g, color.b);
    }
    if (geo.index) { var ia = geo.index.array; for (var j = 0; j < ia.length; j++) this.i.push(ia[j] + this.v); }
    else for (var j2 = 0; j2 < pa.count; j2++) this.i.push(j2 + this.v);
    this.v += pa.count;
  };
  /** Caja en coordenadas THREE (centro x,y,z; tamaños w,h,d; giros). */
  Builder.prototype.box = function (w, h, d, x, y, z, color, ry, rx, rz) {
    _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e); _s.set(w, h, d); _p.set(x, y, z);
    _m.compose(_p, _q, _s); this.add(UNIT_BOX, _m, color);
  };
  /** Caja alineada con los ejes de la SIMULACIÓN: tamaños (lx, ly, lz) y centro (cx, cy, cz). */
  Builder.prototype.sbox = function (lx, ly, lz, cx, cy, cz, color) { this.box(lx, lz, ly, cx, cz, -cy, color); };
  Builder.prototype.geo = function (g, x, y, z, color, ry, rx, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e); _s.set(sx || 1, sy || sx || 1, sz || sx || 1); _p.set(x, y, z);
    _m.compose(_p, _q, _s); this.add(g, _m, color);
  };
  /** ARN-16: caja con aristas achaflanadas (acolchados, tableros). Ejes de la SIMULACIÓN como sbox: tamaños (lx, ly, lz),
   *  centro (cx, cy, cz), chaflán vertical c y biselado superior t (m). ~44 triángulos (una caja: 12). */
  Builder.prototype.cbox = function (lx, ly, lz, cx, cy, cz, color, c, t) {
    _e.set(0, 0, 0, 'YXZ'); _q.setFromEuler(_e); _s.set(1, 1, 1); _p.set(cx, cz - lz / 2, -cy);
    _m.compose(_p, _q, _s); this.add(chamferGeo(lx, lz, ly, c == null ? 0.03 : c, t == null ? 0.02 : t), _m, color);
  };
  var _chamCache = {};
  /** Prisma de 8 lados (rectángulo w x d con esquinas cortadas c) de alto h desde y = 0, con la arista superior biselada t:
   *  anillos [0, h - t] al ancho completo y [h] metido t; tapa superior e inferior. Normales planas por cara. */
  function chamferGeo(w, h, d, c, t) {
    var key = [w, h, d, c, t].map(function (v) { return v.toFixed(3); }).join(',');
    if (_chamCache[key]) return _chamCache[key];
    c = Math.min(c, w * 0.45, d * 0.45); t = Math.min(t, h * 0.45);
    function ring(ins) { var x = w / 2 - ins, z = d / 2 - ins, k = Math.max(0.001, c - ins * 0.6); return [[x - k, z], [x, z - k], [x, -z + k], [x - k, -z], [-x + k, -z], [-x, -z + k], [-x, z - k], [-x + k, z]]; }
    var R = [{ y: 0, p: ring(0) }, { y: h - t, p: ring(0) }, { y: h, p: ring(t) }];
    var P = [], N = [], I = [], v = 0, A = new THREE.Vector3(), Bv = new THREE.Vector3(), Cv = new THREE.Vector3(), nn = new THREE.Vector3();
    function quad(a, b, c2, d2) {
      A.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); Bv.set(d2[0] - a[0], d2[1] - a[1], d2[2] - a[2]); nn.crossVectors(A, Bv).normalize();
      if (nn.lengthSq() < 0.5) { Cv.set(c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]); nn.crossVectors(A, Cv).normalize(); }
      [a, b, c2, d2].forEach(function (q) { P.push(q[0], q[1], q[2]); N.push(nn.x, nn.y, nn.z); });
      I.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    }
    for (var r = 0; r < 2; r++) for (var i = 0; i < 8; i++) {
      var j = (i + 1) % 8, a0 = R[r].p[i], a1 = R[r].p[j], b0 = R[r + 1].p[i], b1 = R[r + 1].p[j];
      if (r === 1 && t < 1e-4) continue;
      quad([a0[0], R[r].y, a0[1]], [a1[0], R[r].y, a1[1]], [b1[0], R[r + 1].y, b1[1]], [b0[0], R[r + 1].y, b0[1]]);
    }
    // tapas (abanico): arriba mira +y, abajo -y
    [[2, 1], [0, -1]].forEach(function (cap) {
      var rg = R[cap[0]], s0 = v;
      for (var k = 0; k < 8; k++) { P.push(rg.p[k][0], rg.y, rg.p[k][1]); N.push(0, cap[1], 0); }
      for (var k2 = 1; k2 < 7; k2++) { if (cap[1] > 0) I.push(s0, s0 + k2, s0 + k2 + 1); else I.push(s0, s0 + k2 + 1, s0 + k2); }
      v += 8;
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
    _chamCache[key] = g; return g;
  }
  Builder.prototype.build = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeBoundingSphere(); return g;
  };

  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(cv, srgb) {
    var t = new THREE.CanvasTexture(cv);
    if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function radialTex(stops) {
    var cv = canvas(128, 128), g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return texOf(cv);
  }

  /* =====================================================================
   * SUELO: tarima deportiva pintada (pista arena cálida, zona libre azul),
   * vetas, juntas de tablas y líneas FIVB exactas (5 cm, dentro de la pista).
   * ===================================================================== */
  function drawFloor(cv, ppm) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height;
    function X(x) { return (x + TX) * ppm; }
    function Y(y) { return (TY - y) * ppm; }
    function rect(x0, y0, x1, y1) { g.fillRect(X(x0), Y(y1), (x1 - x0) * ppm, (y1 - y0) * ppm); }
    _seed = 77001;
    g.fillStyle = PAL.surround; g.fillRect(0, 0, W, H);
    // CARTOON: colores planos. Zona libre de un azul limpio (sin degradado de «luz de TV») con un anillo algo más claro
    g.fillStyle = PAL.free; rect(-FZX, -FZY, FZX, FZY);
    g.fillStyle = PAL.freeHi; rect(-C.HL - 1.6, -C.HW - 1.6, C.HL + 1.6, C.HW + 1.6);
    // pista y zonas de ataque (planas)
    g.fillStyle = PAL.court; rect(-C.HL, -C.HW, C.HL, C.HW);
    g.fillStyle = PAL.courtAttack; rect(-C.ATTACK, -C.HW, C.ATTACK, C.HW);

    // tablas anchas (15 cm) con 3 tonos de bloque, juntas finas de tinta y alguna veta dibujada (trazo curvo sencillo).
    // Sin ruido fino: a distancia de juego se lee como un parquet de dibujo animado, no como una foto.
    g.save(); g.beginPath(); g.rect(X(-FZX), Y(FZY), 2 * FZX * ppm, 2 * FZY * ppm); g.clip();
    var pw = 0.15 * ppm, TONES = ['rgba(255,240,205,0.10)', 'rgba(0,0,0,0)', 'rgba(120,50,0,0.07)'];
    var row = 0;
    for (var py = Y(FZY); py < Y(-FZY); py += pw, row++) {
      var x = X(-FZX) - rnd() * 2.4 * ppm;
      while (x < X(FZX)) {
        var len = (2.2 + rnd() * 2.2) * ppm, tk = Math.floor(rnd() * 3);
        g.fillStyle = TONES[tk]; g.fillRect(x, py, len, pw);
        g.fillStyle = 'rgba(70,30,10,0.22)'; g.fillRect(x, py, Math.max(1, ppm * 0.014), pw);
        // veta: un arco suave dentro de la tabla (1 de cada 3)
        if (rnd() < 0.34) {
          var vx0 = x + len * (0.2 + rnd() * 0.3), vl = len * (0.25 + rnd() * 0.3), vy = py + pw * (0.3 + rnd() * 0.4);
          g.strokeStyle = 'rgba(120,55,15,0.16)'; g.lineWidth = Math.max(1, ppm * 0.012);
          g.beginPath(); g.moveTo(vx0, vy); g.quadraticCurveTo(vx0 + vl * 0.5, vy - pw * 0.28, vx0 + vl, vy); g.stroke();
        }
        x += len;
      }
      g.fillStyle = 'rgba(70,30,10,0.16)'; g.fillRect(X(-FZX), py, 2 * FZX * ppm, Math.max(1, ppm * 0.012));
    }
    // brillo de barniz de dibujo: 2 franjas diagonales claras y planas sobre la pista (reflejo «pintado»)
    g.save(); g.beginPath(); g.rect(X(-C.HL), Y(C.HW), 2 * C.HL * ppm, 2 * C.HW * ppm); g.clip();
    g.fillStyle = 'rgba(255,250,235,0.10)';
    for (var gl = -1; gl <= 1; gl += 2) {
      var gx = X(gl * 4.6);
      g.beginPath(); g.moveTo(gx - 0.6 * ppm, Y(C.HW)); g.lineTo(gx + 0.5 * ppm, Y(C.HW)); g.lineTo(gx - 1.9 * ppm, Y(-C.HW)); g.lineTo(gx - 3.0 * ppm, Y(-C.HW)); g.fill();
      g.beginPath(); g.moveTo(gx + 0.9 * ppm, Y(C.HW)); g.lineTo(gx + 1.2 * ppm, Y(C.HW)); g.lineTo(gx - 1.2 * ppm, Y(-C.HW)); g.lineTo(gx - 1.5 * ppm, Y(-C.HW)); g.fill();
    }
    g.restore();
    g.restore();
    // filo de tinta alrededor de la pista (por FUERA de las líneas: no cambia la geometría reglamentaria)
    g.fillStyle = 'rgba(29,21,48,0.55)'; var ik = 0.035;
    rect(-C.HL - ik, C.HW, C.HL + ik, C.HW + ik); rect(-C.HL - ik, -C.HW - ik, C.HL + ik, -C.HW);
    rect(-C.HL - ik, -C.HW, -C.HL, C.HW); rect(C.HL, -C.HW, C.HL + ik, C.HW);

    // logotipos del pabellón en la zona libre (se leen desde la cámara de juego)
    g.save(); g.fillStyle = 'rgba(255,255,255,0.22)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 ' + Math.round(1.05 * ppm) + 'px ' + FONT;
    for (var s = -1; s <= 1; s += 2) {
      g.save(); g.translate(X(s * 12.6), Y(0)); g.rotate(-Math.PI / 2); g.fillText('PALAU DEL MAR', 0, 0); g.restore();
    }
    g.font = '900 ' + Math.round(1.35 * ppm) + 'px ' + FONT;
    g.fillText('PALAU  DEL  MAR', X(0), Y(-7.2));
    g.font = '800 ' + Math.round(0.42 * ppm) + 'px ' + FONT; g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillText('· VALÈNCIA ·', X(0), Y(-8.35));
    g.restore();
    // ondas decorativas sutiles en las esquinas de la zona libre
    g.save(); g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 0.08 * ppm;
    for (var cx = -1; cx <= 1; cx += 2) for (var k = 0; k < 4; k++) {
      g.beginPath(); g.arc(X(cx * 15.5), Y(9.5), (1.4 + k * 0.6) * ppm, 0, Math.PI * 2); g.stroke();
    }
    g.restore();

    // ---- Líneas (5 cm, trazadas DENTRO de las dimensiones de la pista) ----
    g.fillStyle = PAL.line;
    var L = 0.05, HL = C.HL, HW = C.HW, A = C.ATTACK;
    rect(-HL, HW - L, HL, HW); rect(-HL, -HW, HL, -HW + L);            // laterales
    rect(-HL, -HW, -HL + L, HW); rect(HL - L, -HW, HL, HW);            // líneas de fondo
    rect(-L / 2, -HW + L, L / 2, HW - L);                              // central (eje bajo la red)
    rect(A - L, -HW + L, A, HW - L); rect(-A, -HW + L, -A + L, HW - L); // ataque: borde exterior a 3 m del eje
    // prolongación de las líneas de ataque: 5 trazos de 15 cm separados 20 cm (1.75 m)
    for (var sy = -1; sy <= 1; sy += 2) for (var sx = -1; sx <= 1; sx += 2) for (var t = 0; t < 5; t++) {
      var y0 = HW + 0.20 + t * 0.35, y1 = y0 + 0.15;
      if (sy > 0) rect(sx > 0 ? A - L : -A, y0, sx > 0 ? A : -A + L, y1);
      else rect(sx > 0 ? A - L : -A, -y1, sx > 0 ? A : -A + L, -y0);
    }
    // zona de saque: dos trazos de 15 cm a 20 cm de la línea de fondo, prolongando las laterales
    for (var ex = -1; ex <= 1; ex += 2) for (var ey = -1; ey <= 1; ey += 2) {
      var xa = ex * (HL + 0.20), xb = ex * (HL + 0.35);
      rect(Math.min(xa, xb), ey > 0 ? HW - L : -HW, Math.max(xa, xb), ey > 0 ? HW : -HW + L);
    }
  }
  var floorCanvas, floorTex, floorPpm;
  function buildFloor() {
    floorPpm = ctx.isMobile ? 40 : 60;
    floorCanvas = canvas(Math.round(2 * TX * floorPpm), Math.round(2 * TY * floorPpm));
    drawFloor(floorCanvas, floorPpm);
    floorTex = texOf(floorCanvas); floorTex.anisotropy = Math.min(16, ctx.renderer.capabilities.getMaxAnisotropy());
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * TX, 2 * TY),
      // rugosidad 0.6: con menos, el reflejo del foco principal y de las lámparas del mapa de entorno
      // forma una mancha que el bloom revienta en blanco justo detrás del jugador (visto en rally/block).
      // CARTOON: toon (bandas duras, sin especular ni reflejos de entorno): la tarima es plana y luminosa
      floorMat = VB.TOON.toonMat({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; root.add(floor);
    var outer = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALL_X + 2, 2 * HALL_Y + 2),
      VB.TOON.toonMat({ color: PAL.outer }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.006; outer.receiveShadow = true; outer.name = 'outerFloor'; root.add(outer);
  }

  /* =====================================================================
   * RED: malla de 10 cm, banda superior 7 cm, inferior 5 cm, bandas
   * laterales sobre las líneas laterales; antenas de 1.80 m (80 cm sobre la
   * red) con franjas de 10 cm; postes a 1 m con protección; cables.
   * La malla ondula cuando el balón toca la red.
   * ===================================================================== */
  var casters = []; // mallas del pabellón que proyectan sombra (en calidad baja solo la proyectan jugadores y balón)
  var net = null, netRip = { a: 0, y: 0, z: 0, t: 9, dir: 1 };
  var NET_W = 10, NET_HH = 1, NSX = 50, NSY = 6;
  /** beach: red de playa estilo AVP (referencia: foto del Manhattan Beach Open; decisión de Ferran, 10-nov-2026): cuerda
   *  negra, banda superior amarilla y alta con el logo del juego repetido en tinta, banda inferior y laterales amarillas.
   *  En las dos sedes, «M T C» (Make the Cut) en el centro: no es un estampado, son las propias cuerdas y nudos de la malla
   *  pintados de teal dentro de la forma de las letras (bien separadas). */
  function netTexture(beach) {
    var Wd = ctx.isMobile ? 1024 : 2048, Ht = Wd / 8, cv = canvas(Wd, Ht), g = cv.getContext('2d');
    var ppm = Wd / NET_W, cell = 0.1 * ppm, top = (beach ? 0.10 : 0.07) * ppm, bot = (beach ? 0.06 : 0.05) * ppm;
    g.clearRect(0, 0, Wd, Ht);
    g.strokeStyle = 'rgba(14,16,20,0.96)'; g.lineWidth = Math.max(1.5, ppm * 0.011);
    for (var x = cell / 2; x <= Wd; x += cell) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, Ht - bot); g.stroke(); }
    for (var y = top + cell; y < Ht - bot; y += cell) { g.beginPath(); g.moveTo(0, y); g.lineTo(Wd, y); g.stroke(); }
    // nudos
    g.fillStyle = 'rgba(10,10,12,1)';
    for (var nx = cell / 2; nx <= Wd; nx += cell) for (var ny = top + cell; ny < Ht - bot; ny += cell) g.fillRect(nx - 1.5, ny - 1.5, 3, 3);
    // «M T C»: la misma malla (cuerdas y nudos) pintada de teal, recortada por la forma de tres letras separadas
    var mh = Ht - top - bot;
    (function paintLetters() {
      var off = canvas(Wd, Ht), og = off.getContext('2d');
      og.strokeStyle = '#22d8c6'; og.lineWidth = Math.max(3, ppm * 0.032); og.lineCap = 'round';
      for (var x2 = cell / 2; x2 <= Wd; x2 += cell) { og.beginPath(); og.moveTo(x2, top); og.lineTo(x2, Ht - bot); og.stroke(); }
      for (var y2 = top + cell; y2 < Ht - bot; y2 += cell) { og.beginPath(); og.moveTo(0, y2); og.lineTo(Wd, y2); og.stroke(); }
      og.fillStyle = '#22d8c6';
      for (var nx2 = cell / 2; nx2 <= Wd; nx2 += cell) for (var ny2 = top + cell; ny2 < Ht - bot; ny2 += cell) { og.beginPath(); og.arc(nx2, ny2, Math.max(3, ppm * 0.034), 0, 6.283); og.fill(); }
      // máscara: letras gruesas (relleno + trazo) con mucho aire entre ellas
      var mk = canvas(Wd, Ht), mg = mk.getContext('2d'), fh = mh * 0.84, wx = 1.45; // letras anchas (escala en x) y trazo de ~1,3 celdas
      mg.font = '900 ' + Math.round(fh) + 'px Impact, "Arial Black", ' + FONT; mg.textAlign = 'center'; mg.textBaseline = 'middle';
      mg.fillStyle = '#000'; mg.strokeStyle = '#000'; mg.lineWidth = cell * 1.3 / wx; mg.lineJoin = 'round';
      var gap = fh * 1.05 * wx, cy = top + mh * 0.5;
      ['M', 'T', 'C'].forEach(function (L, i) { var cx = Wd / 2 + (i - 1) * gap; mg.save(); mg.translate(cx, cy); mg.scale(wx, 1); mg.strokeText(L, 0, 0); mg.fillText(L, 0, 0); mg.restore(); });
      og.globalCompositeOperation = 'destination-in'; og.drawImage(mk, 0, 0);
      g.drawImage(off, 0, 0);
    })();
    // bandas superior e inferior (lona blanca con costuras; amarillas en la playa)
    var bandCol = beach ? '#f7c531' : '#f3f0e8';
    g.fillStyle = bandCol; g.fillRect(0, 0, Wd, top); g.fillRect(0, Ht - bot, Wd, bot);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, top - 2, Wd, 2); g.fillRect(0, Ht - bot, Wd, 2);
    g.fillStyle = 'rgba(0,0,0,0.10)'; for (var sx = 0; sx < Wd; sx += 12) { g.fillRect(sx, 3, 5, 1); g.fillRect(sx, Ht - bot + bot * 0.5, 5, 1); }
    if (beach) {
      // banda superior AVP: el logo del juego (balón + MAKE THE CUT) repetido en tinta a lo largo de toda la banda
      g.fillStyle = '#1d1530'; g.strokeStyle = '#1d1530'; g.font = '900 ' + Math.round(top * 0.5) + 'px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle';
      var step = 1.25 * ppm, r0 = top * 0.3;
      for (var bx = step * 0.5; bx < Wd; bx += step) {
        g.save(); g.lineWidth = Math.max(1, r0 * 0.14); drawGameBall(g, bx, top * 0.5, r0); g.restore();
        g.fillStyle = '#1d1530'; g.fillText('MAKE THE CUT', bx + r0 * 1.5, top * 0.52);
      }
    } else {
      // marca del fabricante (ficticia) en la banda superior
      g.fillStyle = 'rgba(20,40,70,0.55)'; g.font = '800 ' + Math.round(top * 0.78) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('SALT·9  PRO NET', Wd * 0.5, top * 0.55);
    }
    // bandas laterales sobre las líneas laterales (5 cm x 1 m)
    function bandAt(yy) { var u0 = (yy + NET_W / 2) * ppm; g.fillStyle = beach ? bandCol : '#f7f4ee'; g.fillRect(u0, 0, 0.05 * ppm, Ht); }
    bandAt(C.HW - 0.05); bandAt(-C.HW);
    // cuerdas de los extremos
    g.fillStyle = beach ? bandCol : '#e8e4da'; g.fillRect(0, 0, 3, Ht); g.fillRect(Wd - 3, 0, 3, Ht);
    // CARTOON (arreglos finales): contorno de tinta pintado en la propia textura (la red es un plano: el casco invertido no
    // sirve). Filo de las dos bandas y de los extremos, ~2,5 cm (~1,5-2 px a 1280×720 desde la cámara de juego): 0 dibujos más
    var iw = Math.max(2, Math.round(0.025 * ppm));
    g.fillStyle = '#1d1530';
    g.fillRect(0, 0, Wd, iw); g.fillRect(0, top - iw, Wd, iw); g.fillRect(0, Ht - bot, Wd, iw); g.fillRect(0, Ht - iw, Wd, iw);
    g.fillRect(0, 0, iw, Ht); g.fillRect(Wd - iw, 0, iw, Ht);
    var t = texOf(cv); t.anisotropy = Math.min(16, ctx.renderer.capabilities.getMaxAnisotropy()); return t;
  }
  var padCv = null, padTex = null;
  /** Protección del poste: el texto se ajusta a la longitud útil (márgenes ≥ 8 %) y se pinta en las
   *  dos caras del cilindro (se lee desde los dos campos). Antes salía cortado ("ALAU DEL MA"). */
  function drawPad(cv) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height;
    var gr = g.createLinearGradient(0, 0, W, 0), pb = VENUE.id === 'beach', pa = pb ? '#0f7f9e' : '#163a5c', pc = pb ? '#1aa6c4' : '#1f5076';
    gr.addColorStop(0, pa); gr.addColorStop(0.25, pc); gr.addColorStop(0.5, pa); gr.addColorStop(0.75, pc); gr.addColorStop(1, pa);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // franjas: naranja abajo (cerca del suelo), amarilla arriba; costuras horizontales suaves
    g.fillStyle = '#ff6b3d'; g.fillRect(0, H - 52, W, 20); g.fillStyle = '#ffd23f'; g.fillRect(0, 26, W, 8);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 12, W, 3); g.fillRect(0, H - 15, W, 3);
    var y0 = 44, y1 = H - 62, avail = (y1 - y0) * 0.86, text = VENUE.pad[VENUE.id] || 'PALAU DEL MAR', fs = 62;
    g.font = '900 ' + fs + 'px ' + FONT;
    while (g.measureText(text).width > avail && fs > 20) { fs -= 2; g.font = '900 ' + fs + 'px ' + FONT; }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
    for (var k = 0; k < 2; k++) {
      g.save(); g.translate(W * (0.25 + k * 0.5), (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.fillText(text, 0, 0); g.restore();
    }
  }
  /** Atlas de antenas/postes/protecciones (512×512): protección 0-256 px, franjas de la antena 272-368 px (18 franjas a lo
   *  alto, como la textura de antes), color del poste 416-512 px. Los huecos entre zonas evitan que se mezclen en los mips. */
  var poleCv = null;
  function drawPoleAtlas() {
    var g = poleCv.getContext('2d');
    drawPad(padCv); g.drawImage(padCv, 0, 0);
    g.fillStyle = '#101820'; g.fillRect(256, 0, 16, 512); g.fillRect(368, 0, 48, 512);
    for (var i = 0; i < 18; i++) { g.fillStyle = i % 2 ? '#f7f5f0' : '#e0262f'; g.fillRect(272, Math.round(i * 512 / 18), 96, Math.round((i + 1) * 512 / 18) - Math.round(i * 512 / 18)); }
    g.fillStyle = '#c7ccd3'; g.fillRect(416, 0, 96, 512);
  }
  function poleAtlas() { padCv = canvas(256, 512); poleCv = canvas(512, 512); drawPoleAtlas(); padTex = texOf(poleCv); return padTex; }
  function padRedraw() { if (poleCv) { drawPoleAtlas(); padTex.needsUpdate = true; } }
  /** Como mergeXf para varias piezas: u de cada una a su zona del atlas (u0..u1) y aPbr (rugosidad, metal, reflejos) por vértice. */
  function mergePbr(parts) {
    var P = [], N = [], U = [], R = [], I = [], off = 0;
    for (var q = 0; q < parts.length; q++) {
      var pt = parts[q], geo = pt[0], mats = pt[1], pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv, ia = geo.index.array;
      for (var k = 0; k < mats.length; k++) {
        _m3.getNormalMatrix(mats[k]);
        for (var v = 0; v < pa.count; v++) {
          _v.fromBufferAttribute(pa, v).applyMatrix4(mats[k]); P.push(_v.x, _v.y, _v.z);
          _v.fromBufferAttribute(na, v).applyMatrix3(_m3).normalize(); N.push(_v.x, _v.y, _v.z);
          U.push(pt[2] + (pt[3] - pt[2]) * ua.getX(v), ua.getY(v)); R.push(pt[4], pt[5], pt[6]);
        }
        for (var j = 0; j < ia.length; j++) I.push(ia[j] + off);
        off += pa.count;
      }
      geo.dispose();
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aPbr', new THREE.Float32BufferAttribute(R, 3));
    g.setIndex(I); g.computeBoundingSphere(); return g;
  }
  /** Matriz de colocación: posición en coords de sim + giro Y (three). */
  function xfAt(sx, sy, sz, ry) { var m = new THREE.Matrix4(); _e.set(0, ry || 0, 0, 'YXZ'); _q.setFromEuler(_e); _s.set(1, 1, 1); VB.toThree(sx, sy, sz, _p); return m.compose(_p, _q, _s); }
  /** Copias de una geometría (position/normal/uv, indexada) transformadas por cada matriz, en una sola geometría. */
  function mergeXf(geo, mats) {
    var pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv, ia = geo.index.array, P = [], N = [], U = [], I = [];
    for (var k = 0; k < mats.length; k++) {
      _m3.getNormalMatrix(mats[k]); var off = k * pa.count;
      for (var v = 0; v < pa.count; v++) {
        _v.fromBufferAttribute(pa, v).applyMatrix4(mats[k]); P.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(na, v).applyMatrix3(_m3).normalize(); N.push(_v.x, _v.y, _v.z);
        if (ua) U.push(ua.getX(v), ua.getY(v));
      }
      for (var j = 0; j < ia.length; j++) I.push(ia[j] + off);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    if (ua) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeBoundingSphere(); geo.dispose(); return g;
  }
  function buildNet(S) {
    var grp = new THREE.Group(), top = C.NET_H;
    var geo = new THREE.PlaneGeometry(NET_W, NET_HH, NSX, NSY);
    var tex = netTexture();
    // Dos mallas de una sola cara (delante/detrás) que comparten geometría: three r149 con un material
    // transparente DoubleSide cambia side y pone needsUpdate DOS veces por frame (recalcula el programa).
    var netOpts = { map: tex, transparent: true, side: THREE.FrontSide, depthWrite: false, alphaTest: 0.04 };
    var mesh = new THREE.Mesh(geo, VB.TOON.toonMat(netOpts));
    netOpts.side = THREE.BackSide;
    var meshB = new THREE.Mesh(geo, VB.TOON.toonMat(netOpts));
    mesh.rotation.y = meshB.rotation.y = Math.PI / 2; mesh.position.copy(VB.toThree(0, 0, top - NET_HH / 2, new THREE.Vector3())); meshB.position.copy(mesh.position);
    mesh.renderOrder = meshB.renderOrder = 1; mesh.name = 'netFront'; meshB.name = 'netBack'; grp.add(mesh); grp.add(meshB);
    net = { mesh: mesh, base: Float32Array.from(geo.attributes.position.array) };
    // cinta superior con volumen (proyecta sombra) y cable
    var white = col('#f4f1ea');
    S.sbox(0.035, NET_W, 0.07, 0, 0, top - 0.035, white);
    var cable = col('#9aa3ad');
    for (var s = -1; s <= 1; s += 2) {
      // cables hasta los postes
      S.sbox(0.012, 0.55, 0.012, 0, s * (NET_W / 2 + 0.25), top - 0.03, cable);
      S.sbox(0.012, 0.55, 0.012, 0, s * (NET_W / 2 + 0.25), top - NET_HH + 0.03, cable);
      // varillas en los extremos de la red
      S.sbox(0.02, 0.02, NET_HH, 0, s * NET_W / 2, top - NET_HH / 2, col('#d8d4cc'));
    }
    // Antenas, postes y protecciones: UNA malla (antes 3: 3 dibujos + 3 en el mapa de sombras en media/alta). Un atlas de
    // 512×512 (protección a la izquierda, franjas de la antena y color del poste a la derecha, con margen entre zonas) y los
    // valores PBR de cada pieza por vértice (aPbr = rugosidad, metal, intensidad de reflejos): mismo aspecto que con 3 materiales.
    var antGeo = new THREE.CylinderGeometry(0.013, 0.013, 1.8, 10), antX = []; // diámetro algo exagerado: se lee a distancia
    for (var a = -1; a <= 1; a += 2) antX.push(xfAt(0.03, a * (C.HW + 0.006), top - NET_HH + 0.9, 0));
    // postes a 1 m de las laterales (y = ±5.5) con protección acolchada
    var postGeo = new THREE.CylinderGeometry(0.05, 0.05, top + 0.2, 16), padGeo = new THREE.CylinderGeometry(0.17, 0.17, 1.95, 24);
    var postX = [], padX = [];
    for (var p0 = -1; p0 <= 1; p0 += 2) { postX.push(xfAt(0, p0 * (C.HW + 1), (top + 0.2) / 2, 0)); padX.push(xfAt(0, p0 * (C.HW + 1), 0.975, p0 > 0 ? Math.PI : 0)); }
    // CARTOON: toon con el atlas (aPbr queda en la geometría por compatibilidad; el toon no lo usa) + contorno de tinta
    var poleMat = VB.TOON.toonMat({ map: poleAtlas() });
    // [geometría, matrices, zona del atlas en u (u0, u1), rugosidad, metal, reflejos]: los valores de los 3 materiales de antes
    var poles = mergePbr([[antGeo, antX, 0.56, 0.70, 0.4, 0, 0.6], [postGeo, postX, 0.86, 0.90, 0.3, 0.75, 1], [padGeo, padX, 0, 0.5, 0.75, 0, 0.5]]);
    var pole = new THREE.Mesh(poles, poleMat); pole.castShadow = true; pole.name = 'poles'; casters.push(pole); grp.add(pole);
    VB.TOON.outline(pole, 0.012);
    for (var p = -1; p <= 1; p += 2) {
      var py = p * (C.HW + 1);
      // base y tensor
      S.sbox(0.7, 0.7, 0.04, 0, py, 0.02, col('#2b323c'));
      S.sbox(0.12, 0.08, 0.18, 0.12, py, 1.95, col('#3a424e'));
      S.sbox(0.1, 0.1, 0.08, 0, py, top + 0.24, col('#2b323c'));
    }
    return grp;
  }
  function updateNet(dt, g) {
    if (!net) return;
    if (netRip.t > 2.2) return;
    netRip.t += dt;
    var pos = net.mesh.geometry.attributes.position, arr = pos.array, base = net.base, t = netRip.t;
    var env = netRip.a * Math.exp(-3.2 * t), osc = Math.cos(t * 17) * env;
    var cy = netRip.y, top = NET_HH / 2;
    for (var i = 0; i < pos.count; i++) {
      var lx = base[i * 3], ly = base[i * 3 + 1];
      var h = (top - ly) / NET_HH;                // 0 arriba (cinta tensa) .. 1 abajo
      var dy = lx - cy, spread = 0.7 + t * 2.4;
      var w = Math.exp(-(dy * dy) / (spread * spread)) * Math.sin(Math.PI * Math.min(1, h * 0.95 + 0.05));
      arr[i * 3 + 2] = osc * w * netRip.dir;
    }
    pos.needsUpdate = true;
    if (netRip.t > 2.2) { for (var j = 0; j < pos.count; j++) arr[j * 3 + 2] = 0; pos.needsUpdate = true; }
  }

  /* =====================================================================
   * PERSONAS de arbitraje (1.er y 2.º árbitro, jueces de línea, anotadores)
   * Geometría fusionada con color por vértice; brazos y cabeza articulados.
   * ===================================================================== */
  var personMat, refs = [], judges = [], R1 = null, R2 = null, officials = [];
  /** LatheGeometry a partir de pares [radio, y] (de abajo arriba). */
  function lathePts(pr, seg) {
    var pts = []; for (var i = 0; i < pr.length; i++) pts.push(new THREE.Vector2(pr[i][0], pr[i][1]));
    return new THREE.LatheGeometry(pts, seg || 10);
  }
  // Perfiles (metros). Tronco desde la cadera (y = 0) hasta la base del cuello; se escala elíptico.
  var OFF_TORSO = [[0.0, 0.05], [0.152, 0.06], [0.158, 0.12], [0.148, 0.22], [0.16, 0.32], [0.178, 0.42], [0.186, 0.49], [0.178, 0.545], [0.15, 0.585], [0.1, 0.612], [0.06, 0.625], [0.0, 0.63]];
  var OFF_PELVIS = [[0.0, -0.11], [0.12, -0.105], [0.158, -0.06], [0.163, 0.0], [0.157, 0.075], [0.0, 0.08]];
  var OFF_LEG = [[0.0, -0.86], [0.046, -0.855], [0.052, -0.8], [0.06, -0.64], [0.058, -0.55], [0.052, -0.47], [0.064, -0.36], [0.078, -0.2], [0.084, -0.08], [0.07, 0.0], [0.0, 0.02]];
  var OFF_ARM = [[0.0, -0.57], [0.03, -0.565], [0.034, -0.53], [0.041, -0.43], [0.038, -0.31], [0.043, -0.24], [0.046, -0.14], [0.0, -0.12]];
  // brazo partido en el codo (ARN-07): ELB_Y bajo el hombro; el antebrazo se describe desde el codo
  var ELB_Y = 0.31, OFF_HEAD_K = 1.32;
  var OFF_UARM = [[0.0, -0.335], [0.038, -0.33], [0.038, -0.31], [0.043, -0.24], [0.046, -0.14], [0.0, -0.12]];
  var OFF_FARM = [[0.0, -0.26], [0.03, -0.255], [0.034, -0.22], [0.041, -0.12], [0.039, -0.01], [0.0, 0.02]];
  var OFF_SLEEVE = [[0.0, -0.2], [0.054, -0.195], [0.06, -0.12], [0.062, -0.04], [0.05, 0.02], [0.0, 0.05]];
  /**
   * Oficial (árbitros, jueces de línea, anotadores) con proporciones de atleta: tronco torneado con
   * hombros y cuello, polo con cuello de otro color y escudo blanco en el pecho, pantalón largo,
   * zapatillas con suela, cabeza con orejas, nariz, ojos, cejas y pelo. Mira a +Z local.
   * Jerarquía: root -> piernas (fijas) + `upper` (pivote en la cadera: respiración, balanceo)
   *            -> tronco, `head` (sigue el balón), `armR`/`armL` (señales).
   */
  function makePerson(o) {
    var grp = new THREE.Group(), LB = new Builder(), B = new Builder();
    var shirt = col(o.shirt), pants = col(o.pants), skin = col(o.skin), hair = col(o.hair), shoe = col(o.shoe || '#16181d'), sole = col('#e9e6df');
    var collar = col(o.collar || o.shirt), badge = col(o.badge || '#f4f2ec'), belt = col('#0d0f13');
    // ARN-14: `lo` = versión ligera para la gente del entorno (banquillos, fotógrafos, cámara de TV): ~40 % menos segmentos
    var lo = !!o.lo; function sg(n) { return lo ? Math.max(5, Math.round(n * 0.62)) : n; }
    var capR = lo ? 2 : 3, eyeG = lo ? [4, 3] : [6, 4];
    var hipY = o.seated ? 0.54 : o.kneel ? 0.5 : 0.93;
    var legG = lathePts(OFF_LEG, sg(9));
    var shinC = o.shorts ? skin : pants, sock = col(o.sock || '#eef0f2');
    var thighP = [[0.0, -0.46], [0.058, -0.455], [0.066, -0.36], [0.08, -0.16], [0.084, -0.05], [0.07, 0.0], [0.0, 0.02]];
    var shinP = [[0.0, -0.5], [0.046, -0.495], [0.052, -0.44], [0.06, -0.3], [0.055, -0.1], [0.06, 0.0], [0.0, 0.02]];
    if (o.kneel) {
      // rodilla derecha (x < 0) en el suelo: muslo vertical, espinilla tumbada hacia atrás y punta del pie apoyada;
      // pierna izquierda: muslo hacia delante y espinilla vertical, pie plano
      var thK = lathePts(thighP, sg(9)), shK = lathePts(shinP, sg(9));
      LB.geo(thK, -0.095, hipY, -0.04, pants, 0, 0.12);
      LB.geo(shK, -0.095, 0.075, -0.1, pants, 0, Math.PI / 2 - 0.1);
      LB.geo(new THREE.SphereGeometry(0.062, sg(8), 5), -0.095, 0.07, -0.08, pants, 0, 0, 0, 1, 0.85, 1);              // rodilla apoyada
      LB.geo(new THREE.CapsuleGeometry(0.044, 0.15, capR, sg(8)), -0.095, 0.07, -0.64, shoe, 0, 0.55, 0, 1.05, 1, 0.75);
      LB.geo(thK, 0.095, hipY - 0.03, 0, pants, 0, -Math.PI / 2 + 0.08);
      LB.geo(shK, 0.1, hipY - 0.03, 0.43, pants, 0, 0.06);
      LB.geo(new THREE.CapsuleGeometry(0.048, 0.17, capR, sg(8)), 0.1, 0.055, 0.5, shoe, 0, Math.PI / 2, 0, 1.1, 1, 0.75);
      LB.box(0.1, 0.022, 0.27, 0.1, 0.011, 0.5, sole);
    } else if (!o.seated) {
      for (var s = -1; s <= 1; s += 2) {
        LB.geo(legG, s * 0.092, hipY, 0, pants, 0, 0, s * 0.02);
        LB.geo(new THREE.CapsuleGeometry(0.048, 0.17, capR, sg(8)), s * 0.1, 0.055, 0.045, shoe, 0, Math.PI / 2, 0, 1.1, 1, 0.75);
        LB.box(0.1, 0.022, 0.27, s * 0.1, 0.011, 0.045, sole);
      }
    } else {
      // sentado: muslo hacia delante (el perfil cuelga en -Y; rx = -90° lo lleva a +Z) y espinilla vertical
      // (`shorts`: pantalón corto de equipo, espinilla con piel, calcetín y rodillera)
      var thigh = lathePts(thighP, sg(9)), shin = lathePts(shinP, sg(9));
      var spread = o.spread || 0;
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        var lx = s2 * (0.095 + spread);
        LB.geo(thigh, lx, hipY - 0.04, 0, pants, s2 * spread * 0.9, -Math.PI / 2);
        LB.geo(shin, lx + s2 * spread * 0.35, hipY - 0.04, 0.44, shinC);
        if (o.shorts) {
          LB.geo(new THREE.CylinderGeometry(0.058, 0.052, 0.17, sg(9), 1, true), lx + s2 * spread * 0.35, 0.16, 0.44, sock);
          LB.geo(new THREE.CylinderGeometry(0.066, 0.066, 0.1, sg(9), 1, true), lx + s2 * spread * 0.35, hipY - 0.08, 0.44, col(o.pad || '#1d1f26'));
        }
        LB.geo(new THREE.CapsuleGeometry(0.048, 0.17, capR, sg(8)), lx + s2 * spread * 0.35, 0.055, 0.49, shoe, 0, Math.PI / 2, 0, 1.1, 1, 0.75);
        LB.box(0.1, 0.022, 0.27, lx + s2 * spread * 0.35, 0.011, 0.49, sole);
      }
    }
    if (o.rootProps) o.rootProps(LB, hipY);
    // UNA SkinnedMesh por persona con piel rígida por hueso (antes 5 mallas: 30 dibujos + 30 en sombras para 6 oficiales)
    var parts = [];
    parts.push({ g: LB.build(), b: 0 });
    var rootBone = new THREE.Bone(); grp.add(rootBone);
    var upper = new THREE.Bone(); upper.position.y = hipY; upper.rotation.order = 'YXZ'; rootBone.add(upper);
    B.geo(lathePts(OFF_PELVIS, sg(12)), 0, 0, 0, pants, 0, 0, 0, 1.13, 1, 0.74);
    if (!o.noBelt) B.geo(new THREE.CylinderGeometry(0.164, 0.164, 0.035, sg(14), 1, true), 0, 0.068, 0, belt, 0, 0, 0, 1.12, 1, 0.73);
    B.geo(lathePts(OFF_TORSO, sg(14)), 0, 0.02, 0, shirt, 0, 0, 0, 1.15, 1, 0.66);
    // cuello del polo (anillo) + tapeta de botones y escudo blanco a la izquierda del pecho (camiseta de equipo: cuello en pico)
    B.geo(new THREE.CylinderGeometry(0.068, 0.082, 0.05, sg(12), 1, true), 0, 0.64, -0.004, collar, 0, -0.12);
    if (o.badge !== false) {
      B.box(0.035, 0.11, 0.012, 0, 0.555, 0.118, collar, 0, -0.32);
      B.box(0.06, 0.07, 0.012, 0.085, 0.44, 0.124, badge, 0, -0.1);
      B.box(0.036, 0.012, 0.013, 0.085, 0.452, 0.128, col(o.badgeMark || '#c4532f'), 0, -0.1);
    }
    B.geo(new THREE.CylinderGeometry(0.047, 0.054, 0.13, sg(10)), 0, 0.68, 0.004, skin);
    if (o.upperProps) o.upperProps(B, shirt, skin);
    parts.push({ g: B.build(), b: 1 });
    var head = new THREE.Bone(); head.position.y = 0.74; head.rotation.order = 'YXZ'; upper.add(head);
    // TAJO: cabeza de dibujo animado (×1,32, ~5,5 cabezas) para que árbitros, jueces y anotadores no queden realistas al lado de
    // los atletas cabezones (players.js HEAD_K). Escala del hueso: la geometría y el número de dibujos no cambian.
    head.scale.setScalar(o.headK || OFF_HEAD_K);
    var HB = new Builder();
    HB.geo(new THREE.SphereGeometry(0.104, sg(14), sg(10)), 0, 0.105, 0.004, skin, 0, 0, 0, 0.92, 1.1, 1.0);
    HB.geo(new THREE.SphereGeometry(0.06, sg(10), lo ? 4 : 6), 0, 0.045, 0.03, skin, 0, 0, 0, 1.15, 0.9, 1.1);        // mandíbula
    HB.geo(new THREE.SphereGeometry(0.11, sg(14), lo ? 5 : 7, 0, Math.PI * 2, 0, Math.PI * 0.46), 0, 0.122, -0.008, hair, 0, -0.18, 0, 0.93, 1, 1.02);
    HB.geo(new THREE.SphereGeometry(0.106, sg(12), lo ? 4 : 6, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.4), 0, 0.11, -0.008, hair, 0, 0, 0, 0.94, 1.08, 1.02); // nuca
    if (o.headProps) o.headProps(HB, skin, hair);
    for (var e2 = -1; e2 <= 1; e2 += 2) {
      HB.geo(new THREE.SphereGeometry(0.022, lo ? 4 : 6, lo ? 3 : 5), e2 * 0.094, 0.1, 0.0, skin, 0, 0, 0, 0.5, 1, 0.8);       // orejas
      // ojos de dibujo: blanco + pupila grande (antes un punto de 11 mm que no se leía)
      HB.geo(new THREE.SphereGeometry(0.018, eyeG[0] + 2, eyeG[1] + 1), e2 * 0.035, 0.12, 0.1, col('#fbf8f2'), 0, 0, 0, 1, 1.15, 0.55);
      HB.geo(new THREE.SphereGeometry(0.0095, eyeG[0], eyeG[1]), e2 * 0.034, 0.118, 0.108, col('#1b1410'), 0, 0, 0, 1, 1.1, 0.6);
      HB.box(0.034, 0.008, 0.01, e2 * 0.036, 0.142, 0.094, hair, 0, -0.1, e2 * -0.12);                      // cejas
    }
    HB.box(0.024, 0.042, 0.03, 0, 0.098, 0.104, skin, 0, 0.18);                                              // nariz
    HB.box(0.034, 0.007, 0.01, 0, 0.058, 0.094, col('#7a4a3a'));                                             // boca
    parts.push({ g: HB.build(), b: 2 });
    // Brazo en DOS huesos (ARN-07): hombro (manga + brazo) y codo (antebrazo + mano). El 1.er y el 2.º árbitro llevan además
    // dedos en 4 huesos por mano (índice, corazón, anular+meñique, pulgar) que se «pliegan» escalándolos hacia el nudillo:
    // así hay 4 dedos, 2 dedos, índice que señala, 8 dedos, palma abierta o puño sin dibujos nuevos (misma SkinnedMesh).
    var sleeveG = lathePts(OFF_SLEEVE, sg(9)), uArmG = lathePts(OFF_UARM, sg(8)), fArmG = lathePts(OFF_FARM, sg(8));
    var bones = [rootBone, upper, head];
    function arm(sx) {
      var a = new THREE.Bone(); a.position.set(sx * 0.2, 0.555, -0.005); a.rotation.order = 'XZY'; upper.add(a);
      var e = new THREE.Bone(); e.position.set(0, -ELB_Y, 0); a.add(e);
      var bi = bones.length; bones.push(a); var ei = bones.length; bones.push(e);
      var AB = new Builder();
      AB.geo(sleeveG, 0, 0, 0, shirt);
      AB.geo(uArmG, 0, 0, 0, skin);
      AB.geo(new THREE.SphereGeometry(0.04, sg(8), lo ? 4 : 6), 0, -ELB_Y, 0, skin);                                      // codo (tapa la junta al doblar)
      parts.push({ g: AB.build(), b: bi });
      var FB = new Builder();
      FB.geo(fArmG, 0, 0, 0, skin);
      var F = null;
      if (!o.fingers) {
        FB.geo(new THREE.SphereGeometry(0.042, sg(8), lo ? 4 : 6), 0, -0.305, 0.008, skin, 0, 0, 0, 0.62, 1.3, 1);        // mano
        if (!lo) FB.geo(new THREE.CapsuleGeometry(0.012, 0.04, 2, 5), sx * -0.022, -0.28, 0.03, skin, 0, 0, sx * 0.5); // pulgar
      } else {
        // palma (mira hacia el muslo: dedos repartidos a lo largo de z) y dedos colgando del nudillo (y = -0.335)
        FB.geo(new THREE.SphereGeometry(0.04, 8, 6), 0, -0.3, 0.004, skin, 0, 0, 0, 0.55, 1.05, 1.08);
        F = [];
        var fz = [[0.02, 0.083], [0.006, 0.09], [-0.013, 0.078]], KY = -0.335; // [z, largo] índice, corazón, anular+meñique
        for (var fi = 0; fi < 3; fi++) {
          var fb = new THREE.Bone(); fb.position.set(0, KY, fz[fi][0]); e.add(fb); F.push(fb);
          var GB = new Builder(), L = fz[fi][1];
          if (fi < 2) GB.geo(new THREE.CapsuleGeometry(0.0095, L - 0.019, 2, 6), 0, -L / 2, 0, skin);
          else { GB.geo(new THREE.CapsuleGeometry(0.009, L - 0.018, 2, 6), 0, -L / 2, 0.002, skin); GB.geo(new THREE.CapsuleGeometry(0.0085, L - 0.03, 2, 6), 0, -(L - 0.012) / 2, -0.016, skin); }
          parts.push({ g: GB.build(), b: bones.length }); bones.push(fb);
        }
        var tb = new THREE.Bone(); tb.position.set(sx * -0.016, -0.28, 0.03); e.add(tb); F.push(tb);
        var TB = new Builder(); TB.geo(new THREE.CapsuleGeometry(0.011, 0.04, 2, 6), 0, -0.03, 0.006, skin, 0, 0.35, sx * 0.45);
        parts.push({ g: TB.build(), b: bones.length }); bones.push(tb);
      }
      parts.push({ g: FB.build(), b: ei });
      return { a: a, e: e, f: F, ei: ei };
    }
    var AR = arm(-1), AL = arm(1);
    var rs = o.seated ? -0.75 : 0.06;
    // reposo de cada brazo: [x, z, y, e, t] del brazo DERECHO como en POSE (el izquierdo se refleja); por defecto, brazos caídos
    // o manos en los muslos
    var r0 = o.restR || [rs, -0.1, 0, o.seated ? 0.9 : 0.12, 0], l0 = o.restL || o.restR || r0;
    var rp = restPair(r0, l0), restR = rp.R, restL = rp.L;
    var P = { root: grp, upper: upper, head: head, armR: AR.a, armL: AL.a, elbR: AR.e, elbL: AL.e, fingR: AR.f, fingL: AL.f,
      fR: [0.55, 0.55, 0.55, 0.7], fL: [0.55, 0.55, 0.55, 0.7], rate: 9, hold: 0, flag: null, seq: null, seqT: 0,
      ph: rnd() * 6.283, restR: restR, restL: restL, lean: o.lean || 0, leanS: o.lean || 0, restRate: o.lo ? 3.5 : 9 };
    if (o.extraBones) o.extraBones(P, rootBone, bones, parts);
    // UNA sola SkinnedMesh para TODOS los oficiales (ver finalizeOfficials): 1 dibujo y 1 textura de huesos por
    // frame. La bandera del juez de línea va en la piel, pegada al hueso del ANTEBRAZO derecho (la sujeta la mano).
    if (o.flag) {
      var FGB = new Builder(), dark = col('#2a2f38'), fy = col('#ffd23f'), fr = col('#e0262f');
      FGB.geo(new THREE.CylinderGeometry(0.009, 0.009, 0.5, 6), 0, -0.49, 0.02, dark);   // palo (mano -> abajo)
      for (var fi2 = 0; fi2 < 4; fi2++) for (var fj = 0; fj < 4; fj++)                  // paño a cuadros, hacia fuera del cuerpo
        FGB.box(0.085, 0.085, 0.004, -0.34 + (fi2 + 0.5) * 0.085, -0.42 - (fj + 0.5) * 0.085, 0.02, (fi2 + fj) % 2 ? fy : fr);
      parts.push({ g: FGB.build(), b: AR.ei });
      P.flag = true;
    }
    offBatch.push({ parts: parts, bones: bones, P: P });
    root.add(grp);
    return P;
  }
  var offBatch = [];
  /** Reposo de los dos brazos a partir de [x, z, y, e, t] del brazo derecho (el izquierdo se refleja: z, y, t cambian de signo). */
  function restPair(r0, l0) {
    return { R: { x: r0[0], z: r0[1], y: r0[2], e: r0[3], t: r0[4] || 0 }, L: { x: l0[0], z: -l0[1], y: -l0[2], e: l0[3], t: -(l0[4] || 0) } };
  }
  /** Fusiona a todos los oficiales (ya colocados) en una SkinnedMesh con un esqueleto común (7 huesos por persona: raíz,
   *  tronco, cabeza, 2 hombros, 2 codos; los dos árbitros, 8 más de dedos).
   *  La geometría queda en coordenadas de mundo con la pose de reposo; la malla cuelga de `root` (identidad). */
  function finalizeOfficials() {
    if (!offBatch.length) return;
    root.updateMatrixWorld(true);
    var allParts = [], allBones = [], lowIdx = 0, beachIdx = 0, beachLowIdx = 0;
    // ARN-14: lo que no sale en calidad baja (P.lowSkip) va al final del índice: setQuality lo recorta con drawRange.
    // Orden por grupos: [árbitros, jueces, anotadores, entrenadores] [fotógrafos] [suplentes] [lowSkip: 3.er suplente y cámara de TV].
    // Pabellón: baja = los tres primeros (como antes). Playa (en el vóley playa no hay suplentes): media/alta = los dos primeros,
    // baja = solo el primero (−20 k triángulos en el móvil).
    function grp(b) { return b.P.lowSkip ? 3 : b.P.kind === 'sub' ? 2 : b.P.kind === 'photo' ? 1 : 0; }
    var order = [0, 1, 2, 3].reduce(function (a, k) { return a.concat(offBatch.filter(function (b) { return grp(b) === k; })); }, []);
    for (var i = 0; i < order.length; i++) {
      var B = order[i], gk = grp(B);
      for (var j = 0; j < B.parts.length; j++) {
        allParts.push({ g: B.parts[j].g, b: B.parts[j].b + allBones.length });
        var ic = B.parts[j].g.index.count;
        if (gk < 3) lowIdx += ic; if (gk < 2) beachIdx += ic; if (gk < 1) beachLowIdx += ic;
      }
      for (var k = 0; k < B.bones.length; k++) allBones.push(B.bones[k]);
    }
    var sm = new THREE.SkinnedMesh(skinMerge(allParts, allBones), personMat);
    sm.userData.lowIdx = lowIdx; sm.userData.beachIdx = beachIdx; sm.userData.beachLowIdx = beachLowIdx;
    sm.castShadow = true; sm.name = 'officials'; sm.frustumCulled = false; // repartidos por todo el pabellón
    root.add(sm); sm.updateMatrixWorld(true); sm.bind(new THREE.Skeleton(allBones)); officials.push(sm);
    for (var m = 0; m < offBatch.length; m++) {
      var Pm = offBatch[m].P;
      Pm.armR.rotation.set(Pm.restR.x, Pm.restR.y, Pm.restR.z); Pm.armL.rotation.set(Pm.restL.x, Pm.restL.y, Pm.restL.z);
      Pm.elbR.rotation.set(-Pm.restR.e, Pm.restR.t, 0); Pm.elbL.rotation.set(-Pm.restL.e, Pm.restL.t, 0);
      if (Pm.fingR) for (var fg = 0; fg < 4; fg++) { var s0 = 0.18 + 0.82 * (fg < 3 ? 0.55 : 0.7); Pm.fingR[fg].scale.setScalar(s0); Pm.fingL[fg].scale.setScalar(s0); }
    }
    offBatch.length = 0;
  }
  /** Fusiona piezas {g (BufferGeometry indexada con position/normal/color), b (índice de hueso)} en una geometría con
   *  skinIndex/skinWeight rígidos; cada pieza se transforma con la matriz (pose de reposo) de su hueso. */
  function skinMerge(parts, bones) {
    var P = [], N = [], Cc = [], SI = [], SW = [], I = [], off = 0;
    for (var i = 0; i < parts.length; i++) {
      var g = parts[i].g; g.applyMatrix4(bones[parts[i].b].matrixWorld);
      var pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, ia = g.index.array;
      for (var k = 0; k < pa.count; k++) {
        P.push(pa.getX(k), pa.getY(k), pa.getZ(k)); N.push(na.getX(k), na.getY(k), na.getZ(k)); Cc.push(ca.getX(k), ca.getY(k), ca.getZ(k));
        SI.push(parts[i].b, 0, 0, 0); SW.push(1, 0, 0, 0);
      }
      for (var j = 0; j < ia.length; j++) I.push(ia[j] + off);
      off += pa.count; g.dispose();
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    geo.setIndex(I); geo.computeBoundingSphere(); geo.boundingSphere.radius += 0.6; // brazos en alto
    return geo;
  }
  function placePerson(P, sx, sy, sz, faceX, faceY) {
    VB.toThree(sx, sy, sz, P.root.position);
    P.root.rotation.y = Math.atan2(faceX, -faceY); // modelo mira a +Z local; sim (fx,fy) -> three (fx, -fy)
    P.sim = { x: sx, y: sy, z: sz };
  }
  function buildOfficials(S, E) {
    personMat = VB.TOON.toonMat({ vertexColors: true });
    var ref = { shirt: '#1a2540', collar: '#f1efe8', pants: '#14171c', skin: '#d9a77f', hair: '#2a1c12', badge: '#f4f2ec', badgeMark: '#c4532f', fingers: true };
    // Silla del 1.er árbitro (junto al poste del lado -y), plataforma a 1.25 m (ARN-16): mismo acolchado que las protecciones
    // de los postes (azul marino, banda naranja abajo y filete amarillo arriba), aristas achaflanadas, barandilla acolchada con
    // remates redondos, peto frontal, escalera de 3 peldaños con zancas y pasamanos de acero a los dos lados.
    var ry = -(C.HW + 1.62), steel = col('#3a4350'), steelL = col('#8d97a5'), dark = col('#1b212b'), padc = col('#1d4a6e'), padd = col('#173f5f');
    var orange = col('#ff6b3d'), yellow = col('#ffd23f'), whiteS = col('#eef0f2'), PZ = 1.25, rd = 0.43;
    S.cbox(0.98, 0.98, 0.04, 0, ry, 0.02, dark, 0.09, 0.015);                          // base
    S.cbox(0.62, 0.62, PZ - 0.1, 0, ry, 0.04 + (PZ - 0.1) / 2, padc, 0.075, 0.02);     // columna acolchada
    S.cbox(0.646, 0.646, 0.16, 0, ry, 0.25, orange, 0.08, 0);                          // banda naranja (como la protección)
    S.cbox(0.644, 0.644, 0.022, 0, ry, PZ - 0.25, yellow, 0.079, 0);                   // filete amarillo
    S.cbox(0.88, 0.88, 0.08, 0, ry, PZ - 0.01, steel, 0.07, 0.015);                    // plataforma
    S.sbox(0.8, 0.8, 0.012, 0, ry, PZ + 0.036, dark);                                  // piso antideslizante
    var railZ = PZ + 0.98;
    for (var px2 = -1; px2 <= 1; px2 += 2) for (var py2 = -1; py2 <= 1; py2 += 2) S.sbox(0.035, 0.035, railZ - PZ, px2 * rd, ry + py2 * rd, (railZ + PZ) / 2, steel);
    var railG = new THREE.CylinderGeometry(0.052, 0.052, 2 * rd, 12), knobG = new THREE.SphereGeometry(0.056, 8, 5);
    S.geo(railG, 0, railZ, -(ry + rd), padd, 0, 0, Math.PI / 2);                       // barandilla frontal (lado pista)
    for (var rs = -1; rs <= 1; rs += 2) S.geo(railG, rs * rd, railZ, -ry, padd, 0, Math.PI / 2, 0);  // laterales
    for (var kx = -1; kx <= 1; kx += 2) for (var ky = -1; ky <= 1; ky += 2) S.geo(knobG, kx * rd, railZ, -(ry + ky * rd), ky > 0 ? padd : orange);
    S.cbox(2 * rd, 0.07, 0.58, 0, ry + rd, PZ + 0.38, padc, 0.025, 0.025);             // peto frontal acolchado
    S.cbox(2 * rd + 0.012, 0.078, 0.07, 0, ry + rd, PZ + 0.2, orange, 0.028, 0);
    S.cbox(2 * rd + 0.01, 0.076, 0.016, 0, ry + rd, PZ + 0.6, yellow, 0.027, 0);
    var stY0 = ry - rd, stY1 = ry - rd - 0.82;
    for (var st = 0; st < 4; st++) {                                               // peldaños macizos con huella clara
      var tz = PZ - 0.31 * (st + 1) + 0.02, sy0 = ry - rd - 0.14 - st * 0.27;
      if (tz < 0.1) break;
      S.sbox(0.6, 0.27, tz, 0, sy0, tz / 2, dark); S.sbox(0.6, 0.04, 0.012, 0, sy0 + 0.12, tz + 0.006, whiteS);
    }
    // zancas inclinadas y pasamanos (tubo de acero) a los dos lados de la escalera, con poste al pie
    var inc = Math.hypot(stY0 - stY1, PZ), aS = Math.atan2(PZ, stY0 - stY1), aR = Math.atan2(-(stY0 - stY1), PZ);
    var hrG = new THREE.CylinderGeometry(0.019, 0.019, inc + 0.06, 8), hpG = new THREE.CylinderGeometry(0.019, 0.019, 0.9, 8);
    for (var sd = -1; sd <= 1; sd += 2) {
      S.box(0.03, 0.2, inc, sd * 0.32, PZ / 2 - 0.02, -(stY0 + stY1) / 2, steel, 0, aS);
      S.geo(hrG, sd * 0.34, PZ / 2 + 0.92, -(stY0 + stY1) / 2, steelL, 0, aR);
      S.geo(hpG, sd * 0.34, 0.45, -stY1, steelL);
    }
    R1 = makePerson(ref); placePerson(R1, 0, ry, PZ + 0.04, 0, 1); refs.push(R1);
    // 2.º árbitro de pie junto al poste opuesto
    R2 = makePerson(ref); placePerson(R2, 0, C.HW + 1.55, 0, 0, -1); refs.push(R2);
    // Mesa del anotador detrás del 2.º árbitro (ARN-16): tablero achaflanado con canto naranja, laterales acolchados, acta electrónica
    // (tableta con pantalla encendida) delante de cada anotador, monitor central, paletas de cambio de cada equipo y zumbador.
    var ty = C.HW + 3.6, tabc = col('#121a26'), navyT = col('#1a2433');
    S.cbox(2.86, 0.74, 0.05, 0, ty, 0.765, navyT, 0.045, 0.012);
    S.sbox(2.86, 0.012, 0.014, 0, ty + 0.365, 0.787, orange);                          // canto trasero (lado anotadores)
    S.sbox(2.8, 0.05, 0.72, 0, ty - 0.33, 0.38, tabc);
    for (var sp = -1; sp <= 1; sp += 2) S.cbox(0.06, 0.66, 0.73, sp * 1.39, ty, 0.375, padc, 0.02, 0.012);
    var scrC = col('#4f93c2'), scrW = col('#9dbbd6'), frameC = col('#0b0e13');
    for (var c = -1; c <= 1; c += 2) {
      var sc = makePerson({ shirt: '#22304a', collar: '#f1efe8', pants: '#16191f', skin: c > 0 ? '#c68b5e' : '#f0c9a6', hair: c > 0 ? '#111' : '#6b4a2a', seated: true, fingers: false });
      placePerson(sc, c * 0.6, ty + 0.5, 0, 0, -1); refs.push(sc);
      // silla: asiento y respaldo acolchados, pata central de acero
      S.cbox(0.46, 0.44, 0.06, c * 0.6, ty + 0.62, 0.45, padd, 0.05, 0.02); S.cbox(0.44, 0.06, 0.4, c * 0.6, ty + 0.85, 0.72, padd, 0.03, 0.02);
      S.sbox(0.05, 0.05, 0.42, c * 0.6, ty + 0.62, 0.21, steel); S.sbox(0.36, 0.05, 0.02, c * 0.6, ty + 0.62, 0.01, steel);
      // acta electrónica: tableta inclinada hacia el anotador (marco + pantalla)
      S.box(0.3, 0.014, 0.22, c * 0.6, 0.802, -(ty + 0.04), frameC, 0, -0.32);
      E.box(0.27, 0.004, 0.19, c * 0.6, 0.811, -(ty + 0.043), c > 0 ? scrW : scrC, 0, -0.32);
    }
    // monitor central (de cara a los anotadores) sobre su peana
    S.sbox(0.1, 0.1, 0.012, 0, ty + 0.06, 0.796, frameC); S.sbox(0.03, 0.03, 0.17, 0, ty + 0.08, 0.875, frameC);
    S.box(0.46, 0.29, 0.03, 0, 1.05, -(ty + 0.07), frameC, 0, 0.14);
    E.box(0.42, 0.25, 0.004, 0, 1.05, -(ty + 0.087), col('#6aa6cf'), 0, 0.14);
    // paletas de cambio numeradas (bandeja + 4 paletas por equipo; el equipo 0 juega en x > 0) y zumbador
    for (var pt = -1; pt <= 1; pt += 2) {
      var pc = pt > 0 ? col(TEAMC[0]) : col(TEAMC[1]);
      S.sbox(0.34, 0.12, 0.03, pt * 1.12, ty - 0.2, 0.805, frameC);
      for (var pi = 0; pi < 4; pi++) S.sbox(0.012, 0.09, 0.14, pt * 1.12 + (pi - 1.5) * 0.07, ty - 0.2, 0.86, pi % 2 ? pc : whiteS);
    }
    S.sbox(0.09, 0.07, 0.035, 0, ty - 0.22, 0.807, frameC); S.sbox(0.045, 0.045, 0.02, 0, ty - 0.22, 0.832, col('#e0262f'));
    // Jueces de línea en las esquinas diagonales (a la derecha de cada árbitro)
    var lj = { shirt: '#1a2540', collar: '#f1efe8', pants: '#14171c', skin: '#e6b48a', hair: '#3a2618', flag: true, badge: '#f4f2ec', badgeMark: '#ffd23f' };
    var J1 = makePerson(lj); placePerson(J1, C.HL + 1.4, -(C.HW + 1.4), 0, -0.7, 0.7); J1.lines = [0, -1]; judges.push(J1);
    lj.skin = '#8d5a3b'; lj.hair = '#111111';
    var J2 = makePerson(lj); placePerson(J2, -(C.HL + 1.4), C.HW + 1.4, 0, 0.7, -0.7); J2.lines = [1, 1]; judges.push(J2);
  }
  /* =====================================================================
   * ENTORNO DE PISTA (ARN-14): banquillos con 3 suplentes sentados (equipación) y el entrenador de pie, 4 fotógrafos
   * arrodillados en las esquinas tras los fondos y una cámara de TV con su operador en las vallas del lado opuesto a la mesa.
   * Todos fuera de la zona libre (|x| ≥ 15,5 o |y| ≥ 9,5). Reutilizan makePerson en versión ligera (`lo`) y van en la MISMA
   * SkinnedMesh que los oficiales (0 dibujos nuevos). En calidad baja, el 3.er suplente de cada banquillo y la cámara de TV
   * quedan al final del índice y se recortan con drawRange (ni se dibujan ni cuentan triángulos).
   * ===================================================================== */
  var crewFrame = 0, crew = [], CREW_BENCH_X = 5.15, CREW_BENCH_Y = 10.72, CREW_RISER = 0.22;
  var KIT = [{ shirt: '#ff5a2c', collar: '#ffb238', yoke: '#ffb238', pad: '#1d1f26', pants: '#191b22', polo: '#22242c', poloC: '#ff6b3d' },
    { shirt: '#3363ea', collar: '#f4f8ff', yoke: '#f4f8ff', pad: '#141a2a', pants: '#0b0e17', polo: '#141a2a', poloC: '#7fb0ff' }];
  /** Canesú de la equipación (franja alta del pecho y espalda con el color de acento, como la de los jugadores). */
  function kitYoke(hex) {
    return function (B) { B.geo(new THREE.CylinderGeometry(0.19, 0.188, 0.07, 9, 1, true), 0, 0.52, 0, col(hex), 0, 0, 0, 1.16, 1, 0.68); };
  }
  var SUB_CLASP = [-0.33, 0.01, 0.48, 1.42, 0], COACH_CROSS = [[-0.58, 0.27, 1.23, 1.53, 0], [-0.37, 0.36, 1.06, 1.43, 0]];
  var COACH_HIPS = [0.12, -0.67, 1.28, 1.37, 0], COACH_CHIN = [-1.08, -0.54, 0.84, 2.46, 0];
  var CREW_SKIN = ['#e6b48a', '#7a4a2f', '#f0c9a6', '#c68b5e', '#a8714a', '#d9a77f', '#5f3a24', '#efc3a0'];
  var CREW_HAIR = ['#1a120c', '#14100e', '#3d2716', '#5a3a20', '#111111', '#2b1b10', '#8f8f8f', '#26150c'];
  function buildCrew(S, E) {
    var steel = col('#3a4350'), dark = col('#151a22'), frameC = col('#0b0e13'), wh = col('#eef0f2');
    var si = 0;
    for (var t = 0; t < 2; t++) {
      var sx = t === 0 ? 1 : -1, bx = sx * CREW_BENCH_X, K = KIT[t], tc = col(TEAMC[t]);
      // tarima del banquillo con filo de luz del color del equipo; banco con cojín del equipo, respaldo y patas de acero
      S.cbox(3.3, 0.8, CREW_RISER, bx - sx * 0.25, 10.62, CREW_RISER / 2, dark, 0.04, 0.02);
      E.sbox(3.2, 0.012, 0.016, bx - sx * 0.25, 10.215, CREW_RISER - 0.03, tc);
      var seatZ = CREW_RISER + 0.45;
      S.cbox(2.2, 0.42, 0.06, bx, CREW_BENCH_Y + 0.12, seatZ, tc.clone().multiplyScalar(0.55), 0.04, 0.025);
      S.cbox(2.2, 0.06, 0.42, bx, CREW_BENCH_Y + 0.36, seatZ + 0.3, tc.clone().multiplyScalar(0.42), 0.025, 0.02);
      for (var lg = -1; lg <= 1; lg += 2) { S.sbox(0.04, 0.36, 0.04, bx + lg * 1.0, CREW_BENCH_Y + 0.12, seatZ - 0.05, steel); S.sbox(0.04, 0.04, 0.42, bx + lg * 1.0, CREW_BENCH_Y + 0.12, CREW_RISER + 0.21, steel); }
      // caja de botellas al extremo del banquillo (hacia el fondo) y toalla doblada sobre el banco
      var cx = bx + sx * 1.32, botG = new THREE.CylinderGeometry(0.032, 0.034, 0.21, 6);
      S.cbox(0.36, 0.28, 0.24, cx, CREW_BENCH_Y + 0.05, CREW_RISER + 0.12, frameC, 0.02, 0.01);
      for (var bt = 0; bt < 6; bt++) S.geo(botG, cx - 0.12 + (bt % 3) * 0.12, CREW_RISER + 0.34, -(CREW_BENCH_Y + 0.05 + (bt < 3 ? -0.06 : 0.06)), bt % 2 ? tc : wh);
      S.sbox(0.42, 0.3, 0.025, bx - sx * 0.62, CREW_BENCH_Y + 0.14, seatZ + 0.042, wh);
      // 3 suplentes con la equipación (el más cercano al fondo no sale en baja)
      for (var k = 0; k < 3; k++) {
        var skin = CREW_SKIN[si % CREW_SKIN.length], hair = CREW_HAIR[(si * 3 + 1) % CREW_HAIR.length]; si++;
        var P = makePerson({ lo: true, seated: true, shorts: true, shirt: K.shirt, collar: K.collar, pants: K.pants, pad: K.pad, skin: skin, hair: hair,
          badge: false, noBelt: true, spread: 0.03 + 0.02 * k, upperProps: kitYoke(K.yoke), restR: [-0.72 + 0.06 * k, -0.08, 0, 0.95, 0], restL: [-0.7, -0.12, 0, 0.9 - 0.1 * k, 0], lean: 0.08 + 0.05 * (k % 2) });
        placePerson(P, bx + sx * (k - 1) * 0.68, CREW_BENCH_Y, CREW_RISER, sx * (0.06 * (1 - k)), -1);
        P.kind = 'sub'; P.team = t; P.lowSkip = k === 2; crew.push(P);
        // posturas de espera que se alternan (manos en las rodillas · manos juntas en el regazo · inclinado hacia delante)
        P.alts = [{ p: { R: P.restR, L: P.restL }, lean: P.lean }, { p: restPair(SUB_CLASP, SUB_CLASP), lean: 0.12 }, { p: restPair(SUB_CLASP, SUB_CLASP), lean: 0.3 }];
        P.idleT = 2 + k * 2.3 + t * 1.1;
      }
      // entrenador de pie al extremo del banquillo más cercano a la línea central (brazos cruzados / manos en la cintura)
      var co = makePerson({ lo: true, shirt: K.polo, collar: K.poloC, pants: '#1a1c22', skin: CREW_SKIN[(si + 4) % 8], hair: t ? '#8f8f8f' : '#1a120c', badge: '#f4f2ec', badgeMark: TEAMC[t],
        restR: t ? COACH_HIPS : COACH_CROSS[0], restL: t ? COACH_HIPS : COACH_CROSS[1] });
      placePerson(co, sx * 3.55, 10.5, CREW_RISER, -sx * 0.25, -1); co.kind = 'coach'; co.team = t; crew.push(co);
      // entrenador: brazos cruzados · manos en la cintura · mano en la barbilla
      co.alts = [{ p: restPair(COACH_CROSS[0], COACH_CROSS[1]), lean: 0 }, { p: restPair(COACH_HIPS, COACH_HIPS), lean: -0.03 }, { p: restPair(COACH_CHIN, COACH_CROSS[1]), lean: 0.05 }];
      co.idleT = 5 + t * 3;
    }
    // fotógrafos arrodillados en las 4 esquinas, tras los fondos, apuntando al campo contrario con teleobjetivo
    var PH = [[16.25, 10.2, '#2a2d33', true], [16.3, -10.15, '#1f2228', false], [-16.25, -10.2, '#2c2a26', true], [-16.3, 10.15, '#24262b', false]];
    for (var f = 0; f < 4; f++) {
      var q = PH[f], fx = -q[0] * 1.5, fy = -q[1];
      var fl = Math.hypot(fx, fy); fx /= fl; fy /= fl;
      var ph = makePerson({ lo: true, kneel: true, shirt: q[2], collar: q[2], pants: '#1b1d22', skin: CREW_SKIN[(f * 3 + 2) % 8], hair: CREW_HAIR[(f * 5) % 8], badge: false, lean: 0.2,
        restR: [-1.72, -0.42, 0.76, 2.0, -0.3], restL: q[3] ? [-2.02, -0.2, 1.5, 1.29, 0.4] : [-1.93, -0.26, 1.29, 1.56, 0.4], upperProps: photoProps(q[3], frameC) });
      placePerson(ph, q[0], q[1], 0, fx, fy); ph.kind = 'photo'; ph.noHead = true; crew.push(ph);
    }
    // cámara de TV en tarima detrás de las vallas del lado -y (opuesto a la mesa), con operador y auriculares; sale en media/alta
    var tvx = -2.7, tvy = -10.62, tvz = 0.42;
    S.cbox(1.2, 0.8, tvz, tvx, tvy, tvz / 2, dark, 0.04, 0.02);
    E.sbox(1.1, 0.012, 0.014, tvx, tvy + 0.405, tvz - 0.03, col('#9fb6cc'));
    var op = makePerson({ lo: true, shirt: '#1c1f26', collar: '#1c1f26', pants: '#17191e', skin: '#d29a6e', hair: '#2b1b10', badge: false,
      restR: [-0.34, -0.68, 1.34, 2.01, 0], restL: [-0.34, -0.68, 1.34, 2.01, 0], headProps: headsetProps, rootProps: tripodProps, extraBones: tvCameraBones });
    placePerson(op, tvx, tvy - 0.32, tvz, 0.1, 1); op.kind = 'tv'; op.lowSkip = true; crew.push(op);
  }
  /** Peto de prensa (delante y detrás) y cámara con teleobjetivo (claro o negro) delante de la cara, en el hueso del tronco. */
  function photoProps(white, frameC) {
    return function (B) {
      var bib = col('#c8d23c');
      B.box(0.26, 0.25, 0.012, 0, 0.4, 0.128, bib, 0, -0.1); B.box(0.26, 0.25, 0.012, 0, 0.4, -0.122, bib, 0, 0.08);
      B.box(0.09, 0.05, 0.014, 0.03, 0.43, 0.136, col('#26331a'), 0, -0.1);
      B.box(0.14, 0.11, 0.085, -0.01, 0.84, 0.2, frameC);
      B.geo(new THREE.CylinderGeometry(white ? 0.05 : 0.04, white ? 0.054 : 0.042, white ? 0.36 : 0.22, 8), -0.01, 0.83, white ? 0.42 : 0.35, col(white ? '#d9d6cc' : '#1a1b1f'), 0, Math.PI / 2);
      B.geo(new THREE.CylinderGeometry(white ? 0.062 : 0.05, white ? 0.058 : 0.046, 0.07, 8, 1, true), -0.01, 0.83, white ? 0.63 : 0.48, frameC, 0, Math.PI / 2);
    };
  }
  function headsetProps(HB) {
    var hc = col('#101215');
    HB.geo(new THREE.TorusGeometry(0.112, 0.012, 4, 10, Math.PI), 0, 0.11, -0.01, hc);
    for (var e3 = -1; e3 <= 1; e3 += 2) HB.geo(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8), e3 * 0.108, 0.1, 0, hc, 0, 0, Math.PI / 2);
  }
  function tripodProps(LB) {
    var tg = new THREE.CylinderGeometry(0.014, 0.018, 1.5, 5), lc = col('#2a2e35');
    for (var lt = 0; lt < 3; lt++) { var a = lt * 2.094 + 0.5; LB.geo(tg, Math.sin(a) * 0.24, 0.73, 0.5 + Math.cos(a) * 0.24, lc, 0, Math.cos(a) * 0.17, -Math.sin(a) * 0.17); }
    LB.geo(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8), 0, 1.48, 0.5, lc);
  }
  /** Cabezal de la cámara de TV en su propio hueso (panorámica/inclinación hacia el balón): cuerpo, objetivo, parasol, visor,
   *  piloto rojo y barras de panorámica hacia las manos del operador. */
  function tvCameraBones(P, rootBone, bones, parts) {
    var pan = new THREE.Bone(); pan.position.set(0, 1.58, 0.5); pan.rotation.order = 'YXZ'; rootBone.add(pan);
    var bi = bones.length; bones.push(pan); P.pan = pan;
    var CB = new Builder(), body = col('#59606b'), blk = col('#0f1114');
    CB.box(0.17, 0.22, 0.46, 0, 0.03, -0.02, body);
    CB.box(0.004, 0.09, 0.2, 0.087, 0.04, -0.02, col('#d9dde3'));             // placa lateral clara
    CB.geo(new THREE.CylinderGeometry(0.075, 0.085, 0.4, 10), 0, 0.03, 0.39, blk, 0, Math.PI / 2);
    CB.geo(new THREE.CylinderGeometry(0.1, 0.09, 0.09, 10, 1, true), 0, 0.03, 0.63, blk, 0, Math.PI / 2);
    CB.box(0.12, 0.09, 0.12, -0.15, 0.1, -0.16, blk);
    CB.box(0.02, 0.02, 0.02, 0.07, 0.15, 0.17, col('#ff2a2a'));
    var barG = new THREE.CylinderGeometry(0.013, 0.013, 0.36, 5);
    CB.geo(barG, -0.1, -0.23, -0.24, blk, 0, 0.745); CB.geo(barG, 0.1, -0.23, -0.24, blk, 0, 0.745);
    parts.push({ g: CB.build(), b: bi });
  }
  /** Por frame: cabeza que sigue al balón (fotógrafos: el tronco con la cámara), respiración, brazos por secuencia (aplausos,
   *  puño, brazos arriba) y la panorámica de la cámara de TV. Mismo esquema sin basura que los oficiales. */
  function crewStep(P) {
    var S = offState(P), dt = OFK[7];
    var dx = OFK[0] - S.hx, dy = OFK[1] - S.hy - 0.12, dz = OFK[2] - S.hz;
    var yaw = angWrap(Math.atan2(dx, dz) - S.ry);
    if (P.kind === 'photo') {
      yaw = yaw > 0.7 ? 0.7 : yaw < -0.7 ? -0.7 : yaw;
      // tras un punto, algunos bajan la cámara para mirar la pantalla (y vuelven a encuadrar)
      if (P.chimp > 0) { P.chimp -= OFK[8]; yaw *= 0.4; P.lean = P.chimp > 0 ? 0.55 : 0.2; }
      S.uy += (yaw - S.uy) * OFK[3];
    } else if (!P.noHead) {
      yaw = yaw > 1.2 ? 1.2 : yaw < -1.2 ? -1.2 : yaw;
      var pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)); pitch = pitch > 0.45 ? 0.45 : pitch < -0.5 ? -0.5 : pitch;
      if (P.droop > 0) { P.droop -= OFK[8]; pitch = 0.42; yaw *= 0.3; }
      headTo(P, S, yaw, pitch, P.kind === 'tv' ? OFK[3] * 0.5 : OFK[3]);
    }
    if (P.pan) {
      if (S.px == null) { P.pan.getWorldPosition(_v); S.px = _v.x; S.py = _v.y; S.pz = _v.z; S.pyaw = 0; S.ppit = 0; }
      var ex = OFK[0] - S.px, ey = OFK[1] - S.py, ez = OFK[2] - S.pz;
      var py = angWrap(Math.atan2(ex, ez) - S.ry), pp = -Math.atan2(ey, Math.sqrt(ex * ex + ez * ez));
      py = py > 1.3 ? 1.3 : py < -1.3 ? -1.3 : py; pp = pp > 0.35 ? 0.35 : pp < -0.5 ? -0.5 : pp;
      var k3 = OFK[3] * 0.6, dyw = (py - S.pyaw) * k3, dpp = (pp - S.ppit) * k3;
      if (dyw > OFF_EPS || dyw < -OFF_EPS || dpp > OFF_EPS || dpp < -OFF_EPS) {
        S.pyaw += dyw; S.ppit += dpp; var pe = P.pan.rotation; pe._y = S.pyaw; pe._x = S.ppit; P.pan.quaternion.setFromEuler(pe, false);
        S.uy = S.pyaw * 0.35; // el operador acompaña el giro con el tronco
      }
    }
    if (P.alts && !P.seq) {
      P.idleT -= OFK[8];
      if (P.idleT <= 0) {
        var al = P.alts[Math.floor(rnd() * P.alts.length) % P.alts.length];
        P.restR = al.p.R; P.restL = al.p.L; P.lean = al.lean; P.idleT = 4 + rnd() * 7;
      }
    }
    breathe(P, S);
    limbsTo(P, S, dt);
  }
  /** Reacciones del entorno a un punto/set/partido: el banquillo que gana aplaude (el entrenador, puño), el otro se queda
   *  quieto (cabeza baja un momento; el entrenador, manos a la cabeza si el punto es grande). */
  function crewReact(team, big, kind) {
    for (var i = 0; i < crew.length; i++) {
      var P = crew[i];
      if (P.kind === 'photo') { if (rnd() < 0.5) P.chimp = 0.9 + rnd() * 1.2; continue; }
      if (P.team == null) continue;
      var dly = step(0.05 + rnd() * 0.22, 9, null, null);
      if (P.team === team) {
        if (kind === 'match') P.seq = [dly, step(4.2, 14, POSE.armsUp, POSE.armsUp, F_OPEN, F_OPEN, 8)];
        else if (P.kind === 'coach') P.seq = [dly, step(0.75, 12, POSE.fist, null, F_FIST, F_REL, 7), step(kind === 'set' ? 2.2 : 1.2, 22, POSE.clap, POSE.clap, F_OPEN, F_OPEN, 6)];
        else P.seq = [dly, step((kind === 'set' ? 2.4 : 1.25) + rnd() * 0.5, 22, POSE.clap, POSE.clap, F_OPEN, F_OPEN, 6)];
        P.droop = 0;
      } else {
        if (P.kind === 'coach' && (big || kind !== 'point')) P.seq = [step(0.25, 9, null, null), step(kind === 'match' ? 2.6 : 1.5, 7, POSE.headHands, POSE.headHands, F_OPEN, F_OPEN)];
        else if (P.kind === 'sub' && (big || kind !== 'point')) P.droop = kind === 'match' ? 3.5 : 1.4;
      }
      P.seqT = 0; P.seqI = 0;
    }
  }
  /* Animación de los oficiales casi SIN basura por frame. Llamada una vez por frame, updateOfficials tardaba en subir de
   * nivel en V8 (baseline/Maglev): ahí cada double que cruza una llamada (damp(), getters/setters de Euler,
   * Math.max/min/hypot) se encajona en un HeapNumber nuevo (~55 KB/s medidos). Por eso: estado propio en números planos
   * (P.st), factores de amortiguado una vez por frame (OFK), trabajo en funciones pequeñas llamadas 5-7 veces por frame
   * (se optimizan antes), sin getters de three, y las rotaciones se escriben en los campos _x/_y/_z del Euler (three
   * r149, versión fijada) seguidas de UNA llamada quaternion.setFromEuler (solo argumentos objeto), y solo si el valor
   * ha cambiado de verdad (brazos en reposo = cero escrituras). */
  var TAU = Math.PI * 2, OFF_EPS = 2e-5;
  function angWrap(a) { return a - TAU * Math.round(a / TAU); }
  function damp(a, b, rate, dt) { return a + (b - a) * (1 - Math.exp(-rate * dt)); }
  /** Estado plano de un oficial (se crea en el primer frame, ya colocado y con el esqueleto montado).
   *  ar/al = [flexión x, abducción z, giro y, codo e, pronación t] de cada brazo; fr/fl = extensión de los 4 dedos (0..1). */
  function offState(P) {
    if (P.st) return P.st;
    P.head.getWorldPosition(_v);
    var hr = P.head.rotation, ur = P.upper.rotation;
    P.st = { hx: _v.x, hy: _v.y, hz: _v.z, ry: P.root.rotation.y, yaw: hr.y, pitch: hr.x, ux: ur.x, uz: ur.z,
      ar: new Float64Array([P.restR.x, P.restR.z, P.restR.y, P.restR.e, P.restR.t]), al: new Float64Array([P.restL.x, P.restL.z, P.restL.y, P.restL.e, P.restL.t]), uy: 0,
      fr: new Float64Array([0.55, 0.55, 0.55, 0.7]), fl: new Float64Array([0.55, 0.55, 0.55, 0.7]), dirty: 1 };
    return P.st;
  }
  /** Respiración y balanceo del peso (tiempo real: también en pausa/congelado se ven vivos). */
  var SIN_N = 1024, SIN_T = new Float64Array(SIN_N + 1);
  for (var si = 0; si <= SIN_N; si++) SIN_T[si] = Math.sin(si / SIN_N * Math.PI * 2);
  /** seno por tabla con interpolación (error < 5e-6): aritmética pura, sin llamadas que encajonen el resultado. */
  function tsin(a) {
    var f = a / TAU; f -= Math.floor(f); f *= SIN_N; var i = f | 0; f -= i;
    return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * f;
  }
  function breathe(P, S) {
    var t = ctx.time + P.ph, u = P.upper, e = u.rotation;
    u.scale.y = 1 + tsin(t * 1.6) * 0.007;
    P.leanS += (P.lean - P.leanS) * OFK[3] * 0.5; // cambios de postura suaves
    S.uz = tsin(t * 0.37) * 0.018; S.ux = P.leanS + 0.02 + tsin(t * 0.23) * 0.01;
    e._x = S.ux; e._z = S.uz; e._y = S.uy; u.quaternion.setFromEuler(e, false);
  }
  /* ---------------------------------------------------------------------
   * SEÑALES OFICIALES (ARN-07). Pose de un brazo = [x, z, y, e, t] del brazo DERECHO (el izquierdo se refleja: z, y, t
   * cambian de signo): x = flexión del hombro (negativo = hacia delante/arriba), z = abducción (negativo = hacia fuera),
   * y = giro del brazo, e = flexión del codo (positivo = doblar), t = pronación del antebrazo. Dedos = [índice, corazón,
   * anular+meñique, pulgar] (1 = extendido, 0 = plegado). El 1.er árbitro mira a +y: su DERECHA es el campo x > 0
   * (equipo 0), así que el brazo «del lado» de un equipo es el derecho para el 0 y el izquierdo para el 1.
   * --------------------------------------------------------------------- */
  var F_OPEN = [1, 1, 1, 1], F_FOUR = [1, 1, 1, 0], F_TWO = [1, 1, 0, 0], F_POINT = [1, 0, 0, 0], F_FIST = [0, 0, 0, 0], F_REL = [0.55, 0.55, 0.55, 0.7];
  var POSE = {
    rest:    [0.06, -0.1, 0, 0.12, 0],
    whistle: [-0.9, 0.3, 0, 2.5, -0.9],     // mano derecha a la boca (silbato)
    side:    [-0.12, -1.5, 0, 0.06, -1.2],    // brazo extendido hacia el lado (equipo que saca), palma al frente
    inSide:  [-0.42, -0.72, 0, 0.0, -0.6],    // brazo y dedos hacia el suelo del lado donde botó
    outFa:   [-1.12, 0.14, 0, 2.0, 1.45],     // antebrazo vertical delante, palma hacia el cuerpo (los dos brazos)
    touchUp: [-1.0, 0.1, 0, 2.15, -1.5],      // mano vertical (dedos arriba) que recibe el roce
    touchBr: [-1.32, 0.42, 0, 1.55, 1.4],     // la otra palma roza las puntas de los dedos (con vaivén)
    fingers: [-0.3, -0.95, -1.57, 1.75, 0],    // antebrazo vertical junto a la cabeza, palma al frente (4 / 2 / 8 dedos)
    netSide: [-1.38, -0.42, 0, 0.3, -1.4],    // la mano señala el lado de la red del infractor
    under:   [-0.78, -0.2, 0, 0.06, -0.3],    // el índice señala la línea central
    atkHi:   [-0.95, -0.42, 0, 1.95, -0.2],   // falta de ataque: antebrazo arriba…
    atkLo:   [-0.95, -0.42, 0, 0.35, -0.2],   // …y movimiento hacia abajo con la mano abierta
    blockUp: [-2.95, -0.18, 0, 0.05, -1.5],   // falta de bloqueo: los dos brazos en vertical, palmas al frente
    srvUp:   [-1.78, -0.25, 0, 0.04, 1.6],    // balón no lanzado/soltado: brazo extendido que sube, palma hacia arriba
    beckon:  [-0.38, -1.22, 0, 0.25, -1.3],   // autorización del saque: la mano indica la dirección del saque
    chal:    [-1.2, -0.28, 0, 1.3, -1.4],     // challenge aceptado: los dos índices delante de la cara dibujan la pantalla (vaivén 9)
    // jueces de línea (brazo derecho = bandera)
    flagDn:  [-0.72, -0.18, 0, 0.0, 0],       // dentro: bandera hacia el suelo
    flagUp:  [0.0, -2.95, 0, 0.0, 0],         // fuera: bandera arriba
    flagTch: [-2.8, 0.5, 0, 0.35, 0],       // tocado: la palma libre (izquierda) sobre la punta de la bandera
    jPoint:  [-1.45, 0.25, 0, 0.0, 0],        // antena: la mano libre señala la antena
    // entorno de pista (ARN-14)
    clap:    [-0.69, -0.21, 0.94, 1.79, -0.6], // aplauso delante del pecho (vaivén 6)
    fist:    [-2.55, -0.3, 0, 1.25, 0],       // puño arriba (vaivén 7)
    armsUp:  [-2.85, -0.4, 0, 0.3, -1.2],     // brazos arriba (vaivén 8)
    headHands: [-2.72, -0.45, 1.17, 1.65, 0]  // manos a la cabeza
  };
  /** Paso de una secuencia: pose de cada brazo (null = reposo), dedos, duración, velocidad de amortiguado y vaivén. */
  function step(d, rate, R, L, fR, fL, osc) { return { d: d, rate: rate, R: R, L: L, fR: fR || F_REL, fL: fL || F_REL, osc: osc || 0 }; }
  /** Pose con el brazo del lado `side` (0 = derecho, 1 = izquierdo) y el otro en reposo. */
  function sideStep(d, rate, pose, side, f, osc) { return side === 1 ? step(d, rate, null, pose, F_REL, f, osc) : step(d, rate, pose, null, f, F_REL, osc); }
  /** Señal oficial del 1.er árbitro para point.signal (SIM-02). side = lado relevante (0 = campo x > 0, a su derecha). */
  function refSignalStep(sig, side, e) {
    switch (sig) {
      case 'in': return sideStep(1.25, 10, POSE.inSide, side, F_OPEN);
      case 'out': return step(1.25, 10, POSE.outFa, POSE.outFa, F_OPEN, F_OPEN);
      case 'touched': return step(1.3, 11, POSE.touchBr, POSE.touchUp, F_OPEN, F_OPEN, 1);
      case 'four': return sideStep(1.25, 10, POSE.fingers, side, F_FOUR);
      case 'double': return sideStep(1.25, 10, POSE.fingers, side, F_TWO);
      case 'net': return sideStep(1.25, 10, POSE.netSide, side, F_OPEN);
      case 'under': return sideStep(1.25, 10, POSE.under, side, F_POINT);
      case 'antenna': return step(1.25, 10, POSE.outFa, POSE.outFa, F_OPEN, F_OPEN); // FIVB: el 1.er árbitro marca «balón fuera»; señalar la antena es cosa del juez de línea
      case 'attackFault': return e && e.reason === 'block' ? step(1.2, 9, POSE.blockUp, POSE.blockUp, F_OPEN, F_OPEN) : sideStep(1.25, 14, POSE.atkHi, side, F_OPEN, 2);
      case 'delay8': return step(1.3, 10, POSE.fingers, POSE.fingers, F_FOUR, F_FOUR);
      case 'serveFault': return sideStep(1.2, 9, POSE.srvUp, side, F_OPEN);
    }
    return null;
  }
  /** Lado relevante de cada señal: dónde botó (in), el infractor (red, debajo, 4 toques, dobles…) o el que sacó. */
  function signalSide(sig, e, g) {
    var fault = 1 - (e.team === 1 ? 1 : 0); // equipo que comete la falta / pierde el punto
    if (sig === 'in' || sig === 'out' || sig === 'touched') return e.landSide === 0 || e.landSide === 1 ? e.landSide : (g.ball.x > 0 ? 0 : 1);
    if (e.player && e.player.x != null) return e.player.x > 0 ? 0 : 1;
    if (sig === 'antenna') return e.antenna ? (e.antenna[0] > 0 ? 0 : 1) : (g.ball.x > 0 ? 0 : 1);
    return fault;
  }
  var SIG_FROM_REASON = { 'in': 'in', out: 'out', antenna: 'antenna', 'double': 'double', four: 'four', net: 'net', under: 'under', block: 'attackFault', attackServe: 'attackFault' };
  /** Secuencia del punto: silbato a la boca → brazo hacia el equipo que saca → señal de la falta (1,2-1,3 s) → reposo. */
  function refSignal(e, g) {
    if (!R1) return;
    var sig = e.signal || (e.reason === 'serve' ? (/8/.test(e.text || '') ? 'delay8' : 'serveFault') : SIG_FROM_REASON[e.reason]);
    var team = e.team === 1 ? 1 : 0, seq = [step(0.32, 26, POSE.whistle, null, F_FIST, F_REL), sideStep(0.75, 12, POSE.side, team, F_OPEN)];
    var s = refSignalStep(sig, signalSide(sig, e, g), e);
    if (s) seq.push(s);
    R1.seq = seq; R1.seqT = 0; R1.seqI = 0; R1.sig = sig || '';
  }
  /** B6: challenge aceptado. Silbato y la señal de revisión por vídeo (dibuja la pantalla con los dos índices) mientras dura. */
  function refChallenge() {
    if (!R1) return;
    R1.seq = [step(0.3, 26, POSE.whistle, null, F_FIST, F_REL), step(2.6, 10, POSE.chal, POSE.chal, F_POINT, F_POINT, 9)];
    R1.seqT = 0; R1.seqI = 0; R1.sig = 'challenge';
  }
  /** Autorización del saque: silbato + la mano indica la dirección del saque (gesto propio, no el del punto). */
  function refAuthorize(team) {
    if (!R1) return;
    R1.seq = [step(0.3, 26, POSE.whistle, null, F_FIST, F_REL), sideStep(0.9, 11, POSE.beckon, team, F_OPEN, 3)]; R1.seqT = 0; R1.seqI = 0; R1.sig = 'serve';
  }
  /** Juez de línea: dentro (bandera abajo), fuera (arriba), tocado (arriba + palma sobre la bandera), antena (agita la
   *  bandera por encima de la cabeza y señala la antena con la otra mano). */
  function judgeSignal(x, y, inside, antenna, touched) {
    var best = null, bd = 1e9;
    for (var j = 0; j < judges.length; j++) { var J = judges[j], d = Math.hypot(J.sim.x - x, J.sim.y - y); if (d < bd) { bd = d; best = J; } }
    if (!best) return;
    if (antenna) best.seq = [step(1.7, 10, POSE.flagUp, POSE.jPoint, F_FIST, F_POINT, 4)];
    else if (touched) best.seq = [step(1.8, 10, POSE.flagUp, POSE.flagTch, F_FIST, F_OPEN, 5)];
    else if (inside) best.seq = [step(1.7, 10, POSE.flagDn, null, F_FIST, F_REL)];
    else best.seq = [step(1.7, 10, POSE.flagUp, null, F_FIST, F_REL)];
    best.seqT = 0; best.seqI = 0; best.sig = antenna ? 'antenna' : touched ? 'touched' : inside ? 'in' : 'out';
  }
  /** Objetivos del frame a partir de la secuencia (o reposo). Vaivenes: 1 = roce de la palma, 2 = falta de ataque (dos
   *  golpes hacia abajo), 3 = la mano que indica el saque, 4 = bandera agitada, 5 = roce sobre la bandera,
   *  9 = los dos índices dibujan un rectángulo (señal de revisión por vídeo / challenge). */
  var _tR = new Float64Array(5), _tL = new Float64Array(5);
  function seqTargets(P, dt) {
    var R = P.restR, L = P.restL, st = null;
    _tR[0] = R.x; _tR[1] = R.z; _tR[2] = R.y; _tR[3] = R.e; _tR[4] = R.t;
    _tL[0] = L.x; _tL[1] = L.z; _tL[2] = L.y; _tL[3] = L.e; _tL[4] = L.t;
    P.curF = null; P.rate = P.restRate || 9;
    if (P.seq) {
      P.seqT += dt;
      while (P.seq && P.seqT >= P.seq[P.seqI].d) { P.seqT -= P.seq[P.seqI].d; P.seqI++; if (P.seqI >= P.seq.length) { P.seq = null; P.sig = ''; } }
      if (P.seq) st = P.seq[P.seqI];
    }
    if (!st) return null;
    P.rate = st.rate;
    if (st.R) { for (var i = 0; i < 5; i++) _tR[i] = st.R[i]; }
    if (st.L) { _tL[0] = st.L[0]; _tL[1] = -st.L[1]; _tL[2] = -st.L[2]; _tL[3] = st.L[3]; _tL[4] = -st.L[4]; }
    var u = P.seqT, w;
    if (st.osc === 1) { w = tsin(u * 22); _tR[0] += w * 0.1; _tR[3] += w * 0.16; }
    else if (st.osc === 2) { w = u < 0.18 ? 0 : (u - 0.18) % 0.5; _tR[3] = w < 0.22 ? st.R ? st.R[3] : st.L[3] : 0.35; if (st.L) _tL[3] = _tR[3]; if (st.L) _tR[3] = R.e; }
    else if (st.osc === 3) { w = 0.5 + 0.5 * tsin(u * 11); if (st.R) _tR[3] += w * 0.75; else _tL[3] += w * 0.75; }
    else if (st.osc === 4) { _tR[1] += tsin(u * 14) * 0.45; }
    else if (st.osc === 5) { w = tsin(u * 16); _tL[0] += w * 0.12; }
    else if (st.osc === 6) { w = tsin(u * 27 + P.ph) * 0.3; _tR[1] += w; _tL[1] -= w; _tR[3] -= w * 0.4; _tL[3] -= w * 0.4; }
    else if (st.osc === 7) { w = 0.5 + 0.5 * tsin(u * 13); _tR[0] -= w * 0.3; _tR[3] -= w * 0.7; }
    else if (st.osc === 9) { // rectángulo: seno «cuadrado» (saturado) en abducción y flexión, desfasados 1/4 de vuelta, en espejo
      w = tsin(u * 5.5) * 1.8; w = w > 1 ? 1 : w < -1 ? -1 : w;
      var w2 = tsin(u * 5.5 + 1.571) * 1.8; w2 = w2 > 1 ? 1 : w2 < -1 ? -1 : w2;
      _tR[1] -= w * 0.26; _tL[1] += w * 0.26; _tR[0] += w2 * 0.16; _tL[0] += w2 * 0.16;
    }
    else if (st.osc === 8) { w = tsin(u * 6 + P.ph); _tR[1] += w * 0.22; _tL[1] += w * 0.22; _tR[3] += (0.5 + 0.5 * tsin(u * 11)) * 0.4; }
    return st;
  }
  /** Brazos y dedos: amortigua hacia el objetivo; escribe en three solo si algo se mueve. */
  function armTo(A, T, kf, bone, elb, mir) {
    var mv = 0;
    for (var i = 0; i < 5; i++) { var d = T[i] - A[i]; if (d > OFF_EPS || d < -OFF_EPS) { A[i] += d * kf; mv = 1; } }
    if (!mv) return;
    var r = bone.rotation; r._x = A[0]; r._z = A[1]; r._y = A[2]; bone.quaternion.setFromEuler(r, false);
    var q = elb.rotation; q._x = -A[3]; q._y = A[4] * mir; q._z = 0; elb.quaternion.setFromEuler(q, false);
  }
  function fingersTo(Fs, Fb, T, kf) {
    if (!Fb) return;
    for (var i = 0; i < 4; i++) {
      var d = T[i] - Fs[i];
      if (d > OFF_EPS || d < -OFF_EPS) { Fs[i] += d * kf; var s = 0.18 + 0.82 * Fs[i]; Fb[i].scale.set(s, s, s); }
    }
  }
  function limbsTo(P, S, dt) {
    var st = seqTargets(P, dt), kf = 1 - Math.exp(-P.rate * OFK[8]);
    armTo(S.ar, _tR, kf, P.armR, P.elbR, 1);
    armTo(S.al, _tL, kf, P.armL, P.elbL, 1);
    if (P.fingR) { fingersTo(S.fr, P.fingR, st ? st.fR : F_REL, kf); fingersTo(S.fl, P.fingL, st ? st.fL : F_REL, kf); }
  }
  function headTo(P, S, yaw, pitch, kf) {
    var dy = (yaw - S.yaw) * kf, dp = (pitch - S.pitch) * kf;
    if (dy > OFF_EPS || dy < -OFF_EPS || dp > OFF_EPS || dp < -OFF_EPS) {
      S.yaw += dy; S.pitch += dp; var e = P.head.rotation; e._x = S.pitch; e._y = S.yaw; P.head.quaternion.setFromEuler(e, false);
    }
  }
  // datos del frame compartidos por refStep/judgeStep (sin pasar doubles como argumentos)
  var OFK = new Float64Array(9); // 0..2 balón (three) · 3 k6 · 4 k7 · 5 k9 · 6 k10 · 7 dt (juego) · 8 dt real
  /** Árbitros y anotadores: cabeza que sigue al balón (de frente mientras señala), brazos/dedos por secuencia, respiración. */
  function refStep(P) {
    var S = offState(P), dt = OFK[7];
    var dx = OFK[0] - S.hx, dy = OFK[1] - S.hy - 0.12, dz = OFK[2] - S.hz;
    var yaw = angWrap(Math.atan2(dx, dz) - S.ry);
    yaw = yaw > 1.25 ? 1.25 : yaw < -1.25 ? -1.25 : yaw;
    var pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)); pitch = pitch > 0.5 ? 0.5 : pitch < -0.6 ? -0.6 : pitch;
    if (P.seq) { yaw *= 0.35; pitch = 0.05; } // mientras señala mira a la pista, de frente
    headTo(P, S, yaw, pitch, OFK[4]);
    breathe(P, S);
    limbsTo(P, S, dt);
  }
  /** Jueces de línea: brazo de la bandera y cabeza hacia el balón. */
  function judgeStep(J) {
    var S = offState(J), dt = OFK[7];
    breathe(J, S);
    limbsTo(J, S, dt);
    var jy = angWrap(Math.atan2(OFK[0] - S.hx, OFK[2] - S.hz) - S.ry); jy = jy > 1.3 ? 1.3 : jy < -1.3 ? -1.3 : jy;
    headTo(J, S, jy, S.pitch, OFK[3]);
  }
  function updateOfficials(g, dt, rdt) {
    var b = g.ball, k = rdt > 0 ? rdt : 0;
    OFK[0] = b.x; OFK[1] = b.z; OFK[2] = -b.y; // VB.toThree en línea
    OFK[3] = 1 - Math.exp(-6 * k); OFK[4] = 1 - Math.exp(-7 * k); OFK[5] = 1 - Math.exp(-9 * k); OFK[6] = 1 - Math.exp(-10 * k); OFK[7] = dt; OFK[8] = k;
    for (var i = 0; i < refs.length; i++) refStep(refs[i]);
    for (var j = 0; j < judges.length; j++) judgeStep(judges[j]);
    // entorno de pista (ARN-14): media cadencia (cada frame anima la mitad, alternando) con dt doble: la mitad de coste y,
    // a su distancia, el mismo aspecto
    if (crew.length) {
      var s3 = OFK[3], s4 = OFK[4], s7 = OFK[7], s8 = OFK[8], k2 = k * 2, par = (crewFrame++) & 1;
      OFK[3] = 1 - Math.exp(-6 * k2); OFK[4] = 1 - Math.exp(-7 * k2); OFK[7] = dt * 2; OFK[8] = k2;
      for (var cw = par; cw < crew.length; cw += 2) crewStep(crew[cw]);
      OFK[3] = s3; OFK[4] = s4; OFK[7] = s7; OFK[8] = s8;
    }
    // 2.º árbitro: se coloca hacia el lado del equipo receptor durante el saque
    if (R2 && g.mode === 'serve') {
      var recv = 1 - (g.serving === 1 ? 1 : 0), want = (recv === 0 ? 1 : -1) * 0.7, dxr = (want - R2.sim.x) * (1 - Math.exp(-2 * k));
      if (dxr > OFF_EPS || dxr < -OFF_EPS) {
        R2.sim.x += dxr; R2.root.position.x = R2.sim.x; // toThree: x -> x (y, z de R2 no cambian)
        if (R2.st) R2.st.hx += dxr;                    // la cabeza se desplaza con él (la rotación del cuerpo no cambia)
      }
    }
  }

  /* =====================================================================
   * GRADAS + PÚBLICO (InstancedMesh animado en el shader: cero CPU)
   * ===================================================================== */
  var crowdMeshes = [], crowdU = null, crowdHeads = [];
  // Camisetas (ARN-02): afición local naranja/arena, visitante azul, neutros oscuros. Se desaturan un 25 % al asignarlas
  // (la grada no compite con la pista) y los neutros claros solo aparecen en las filas bajas (nada de filas altas blancas).
  var SHIRTS = {
    t0: ['#ff5b3a', '#ff7a3d', '#ff9a3d', '#e8642c', '#ffb13d', '#e0a86a', '#d98f52'],
    t1: ['#3f8cff', '#2c63d6', '#5a95e6', '#1f4fb8'],
    // CARTOON (arreglos finales): los neutros dejan de ser grises/marrones oscuros casi realistas y pasan a colores de bloque
    // alegres pero algo apagados (no compiten con los equipos ni con la pista); mismo número de entradas (misma secuencia)
    n: ['#3d3a6b', '#2f8f83', '#c9a23a', '#8a4f9e', '#4a6fa8', '#d0705a', '#5f9a4a', '#a8486a', '#3e7f9a', '#b58a4a', '#7d74b8', '#2f5a6a'],
    nLight: ['#cbc6ba', '#aea795', '#bcc0c6']
  };
  var SHIRT_DESAT = 0.08, SHIRT_DESAT_TEAM = 0.1; // CARTOON: público más saturado (antes 0,25 / 0,30)
  var PRESS_SHIRTS = ['#2a2d33', '#3b3f46', '#1f2a3d', '#cfd2d6', '#4a4f57', '#e2e0da', '#263445'];
  var HAIRS = ['#1a120c', '#2b1b10', '#3d2716', '#5a3a20', '#7a5532', '#a8814f', '#18181a', '#8f8f8f', '#cfc0a0', '#26150c'];
  var PANTS = ['#1f2a3d', '#2e4466', '#1a1b1f', '#3b3f46', '#6b5f4a', '#2a2a2a', '#40506a'];
  var SKINS = ['#f0c9a6', '#e6b48a', '#d29a6e', '#c68b5e', '#a8714a', '#8d5a3b', '#6b4329', '#f3d2b5'];
  /* Figura sentada mirando a +Z local; cadera (asiento) en y = 0.
   * Atributo `color` reutilizado como datos: x = pieza (0 camiseta, 1 piel, 2 pelo, 3 pantalón, 4 bufanda),
   * y = brazo (±1 brazo, ±2 antebrazo; signo = lado), z = marca (1 bufanda, 2 cabeza).
   * hi ≈ 300 triángulos (torso torneado con hombros y cuello, brazos de dos segmentos, pelo, bufanda);
   * lo ≈ 150 (móvil / calidad baja). Articulaciones (deben coincidir con el shader): hombro (±0.225, 0.6, 0),
   * codo (±0.25, 0.36, 0.04), cuello (0, 0.74, 0). */
  var CROWD_SH = [0.225, 0.6, 0], CROWD_EL = [0.24, 0.37, 0.02];
  function crowdGeometry(hi) {
    var pos = [], nor = [], dat = [], idx = [], off = 0;
    function M(x, y, z, rx, ry, rz, sx, sy, sz) {
      _e.set(rx || 0, ry || 0, rz || 0, 'XYZ'); _q.setFromEuler(_e); _s.set(sx || 1, sy || 1, sz || 1); _p.set(x, y, z); return _m.compose(_p, _q, _s);
    }
    /** Añade geo transformada por m; classify(x,y,z) -> [pieza, brazo, marca] por vértice (coords finales). */
    function add(geo, m, classify, pre) {
      var p = geo.attributes.position, n = geo.attributes.normal;
      _m3.getNormalMatrix(m);
      for (var k = 0; k < p.count; k++) {
        _v.fromBufferAttribute(p, k); if (pre) pre(_v);
        _v.applyMatrix4(m); pos.push(_v.x, _v.y, _v.z);
        var c = classify(_v.x, _v.y, _v.z);
        _v2.fromBufferAttribute(n, k).applyMatrix3(_m3).normalize(); nor.push(_v2.x, _v2.y, _v2.z);
        dat.push(c[0], c[1], c[2]);
      }
      var ia = geo.index.array; for (var j = 0; j < ia.length; j++) idx.push(ia[j] + off);
      off += p.count; geo.dispose();
    }
    function fixed(a, b, c) { var r = [a, b, c]; return function () { return r; }; }
    function limb(r0, r1, a, b, segs, part, code) { // cilindro abierto de a -> b
      var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
      var g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true);
      _v.set(dx / len, dy / len, dz / len); _q.setFromUnitVectors(_v2.set(0, 1, 0), _v);
      _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); _s.set(1, 1, 1); _m.compose(_p, _q, _s);
      add(g, _m, fixed(part, code, 0));
    }
    // torso torneado: cadera, cintura, pecho, hombros (bisel) y cuello
    var prof = hi
      ? [[0.15, 0.0], [0.165, 0.1], [0.152, 0.25], [0.172, 0.42], [0.186, 0.55], [0.162, 0.63], [0.088, 0.684], [0.05, 0.7], [0.047, 0.79]]
      : [[0.15, 0.0], [0.158, 0.28], [0.186, 0.55], [0.1, 0.675], [0.048, 0.79]];
    var pts = []; for (var i = 0; i < prof.length; i++) pts.push(new THREE.Vector2(prof[i][0], prof[i][1]));
    add(new THREE.LatheGeometry(pts, hi ? 8 : 6), M(0, 0, 0, 0, 0, 0, 1.13, 1, 0.6), function (x, y) {
      return [y > 0.688 ? 1 : y < 0.07 ? 3 : 0, 0, 0];
    });
    // cabeza con casquete de pelo (vértices de arriba/detrás, algo hinchados)
    add(new THREE.SphereGeometry(0.105, hi ? 8 : 6, hi ? 6 : 4), M(0, 0.87, 0.012, 0, 0, 0, 0.94, 1.12, 1.0), function (x, y, z) {
      var yr = y - 0.87, zr = z - 0.012; // nacimiento del pelo alto en la frente, bajo en la nuca
      return [(yr > 0.072 || (zr < -0.008 && yr > -0.055)) ? 2 : 1, 0, 2];
    }, function (v) { if (v.y > 0.068 || (v.z < -0.01 && v.y > -0.045)) v.multiplyScalar(1.07); });
    // brazos
    for (var sd = -1; sd <= 1; sd += 2) {
      var S = [sd * CROWD_SH[0], CROWD_SH[1], CROWD_SH[2]], E = [sd * CROWD_EL[0], CROWD_EL[1], CROWD_EL[2]];
      if (hi) {
        limb(0.05, 0.043, S, E, 5, 0, sd);                                   // manga / brazo
        limb(0.041, 0.036, E, [sd * 0.15, 0.2, 0.2], 5, 1, sd * 2);          // antebrazo (piel), mano sobre el muslo
      } else { // LOD sencilla también con codo (antes un palo recto en diagonal: todos con el mismo brazo)
        limb(0.05, 0.044, S, E, 4, 0, sd);
        limb(0.042, 0.036, E, [sd * 0.15, 0.2, 0.2], 4, 1, sd * 2);
      }
    }
    // piernas (sentado): muslos hacia delante y espinillas
    for (var lg = -1; lg <= 1; lg += 2) { // dos piernas en las dos LOD (la sencilla era un bloque)
      add(new THREE.BoxGeometry(0.15, 0.14, 0.44), M(lg * 0.088, 0.05, 0.16), fixed(3, 0, 0));
      add(new THREE.BoxGeometry(0.12, 0.42, 0.12), M(lg * 0.088, -0.19, 0.36), fixed(3, 0, 0));
    }
    if (hi) {
      // bufanda (solo la muestran las instancias con aAcc.w = 1): anillo al cuello + caída por delante
      add(new THREE.CylinderGeometry(0.098, 0.112, 0.07, 8, 1, true), M(0, 0.668, 0, 0, 0, 0, 1.12, 1, 0.78), fixed(4, 0, 1));
      add(new THREE.BoxGeometry(0.075, 0.27, 0.022), M(0.06, 0.52, 0.122, -0.08, 0, 0.05), fixed(4, 0, 1));
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(dat, 3));
    geo.setIndex(idx); return geo;
  }
  /* Jerarquía de valores (ARN-02): la luz de TV cae sobre la pista y las primeras filas; la grada se apaga hacia arriba
   * (x0,5 desde ~2 m hasta 7,5 m de altura: las 3 primeras filas a plena luz) y con la distancia a la pista, y pierde algo
   * de saturación. uCrowdLight = multiplicador global para la iluminación «de puntuación» (ARN-08). Compartido por el
   * público 3D, los impostores y las banderas (mismo valor en los tres). */
  var CROWD_FALL_GLSL = 'float vbCrowdFall(vec3 ip){ float f = mix(1.0, 0.6, smoothstep(1.6, 5.4, ip.y));' +
    ' f *= mix(1.0, 0.8, smoothstep(17.0, 30.0, length(ip.xz))); return f * uCrowdLight; }' +
    ' vec3 vbCrowdTone(vec3 c, vec3 ip){ float k = smoothstep(1.3, 7.3, ip.y); return mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), 0.12 + k * 0.22) * vbCrowdFall(ip); }'; // CARTOON: antes 0,33 + k·0,3 y caída a 0,42
  // bruma del pabellón sobre la grada (perspectiva aérea): comprime contraste y saturación de lo lejano. En el fragmento,
  // tras la codificación: uHazeC es LINEAL y pasa por linearToOutputTexel, así la bruma es la misma pintando a pantalla
  // (salida sRGB) que al destino del post-proceso (salida lineal); vHazeD = profundidad de vista.
  var CROWD_HAZE_FS = 'uniform float uHaze; uniform vec3 uHazeC; varying float vHazeD;\n';
  var CROWD_HAZE_APPLY = ' gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uHazeC, 1.0)).rgb, uHaze * smoothstep(9.0, 30.0, vHazeD));\n';
  var CROWD_GLSL_HEAD = [
    'attribute vec4 aAnim; attribute vec3 aSkin; attribute vec3 aHair; attribute vec3 aPants; attribute vec4 aAcc;',
    'varying vec3 vFace; varying float vFaceK; varying float vHazeD;',
    'uniform float uTime; uniform vec2 uCheer; uniform vec2 uCheerAge; uniform vec2 uWave; uniform float uTension; uniform vec3 uBall; uniform float uLook; uniform float uCrowdLight;',
    CROWD_FALL_GLSL,
    'vec3 vbRotX(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }',
    'vec3 vbRotY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }',
    'vec3 vbRotZ(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }',
    // ánimo por instancia: equipo, retraso escalonado (no todos a la vez), ola
    'float vbCheer(){ float dly = fract(aAnim.x * 0.731) * 0.42; vec2 ch = uCheer * smoothstep(vec2(dly), vec2(dly + 0.2), uCheerAge);',
    ' float c = aAnim.z < 0.25 ? ch.x : (aAnim.z > 0.75 ? ch.y : max(ch.x, ch.y) * 0.55); return c * aAnim.y; }',
    'float vbWave(){ float wd = abs(fract(aAnim.w - uWave.x + 0.5) - 0.5); return uWave.y * smoothstep(0.045, 0.0, wd) * step(0.2, aAnim.y); }' // prensa (energía < 0,2): sin ola
  ].join('\n');
  var crowdGm = null;
  function crowdRamp() {
    if (crowdGm) return crowdGm;
    var lv = [128, 128, 128, 128, 128, 200, 200, 255, 255, 255], d = new Uint8Array(lv.length * 4);
    for (var i = 0; i < lv.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = lv[i]; d[i * 4 + 3] = 255; }
    crowdGm = new THREE.DataTexture(d, lv.length, 1, THREE.RGBAFormat);
    crowdGm.minFilter = crowdGm.magFilter = THREE.NearestFilter; crowdGm.generateMipmaps = false; crowdGm.needsUpdate = true;
    return crowdGm;
  }
  function crowdMaterial() {
    crowdU = { uTime: { value: 0 }, uCheer: { value: new THREE.Vector2() }, uCheerAge: { value: new THREE.Vector2(9, 9) }, uWave: { value: new THREE.Vector2() },
      uTension: { value: 0 }, uBall: { value: new THREE.Vector3(0, 3, 0) }, uLook: { value: 1 }, uCrowdLight: { value: 1 }, uHaze: { value: 0.34 }, uHazeC: { value: new THREE.Vector3(0.0041, 0.0046, 0.0059) } };
    // CARTOON (arreglos finales): sombreado por bandas (MeshToonMaterial) en vez de Lambert suave; rampa propia más clara que la
    // de los atletas (0,5 · 0,78 · 1): de cerca se leen bloques de color planos sin que la grada se oscurezca ni compita con la pista
    var m = new THREE.MeshToonMaterial({ vertexColors: true, color: 0xc8c8c8 });
    m.gradientMap = crowdRamp();
    m.onBeforeCompile = function (sh) {
      for (var k in crowdU) sh.uniforms[k] = crowdU[k];
      sh.vertexShader = CROWD_GLSL_HEAD + '\n' + sh.vertexShader
        .replace('#include <color_vertex>', [
          '#ifdef USE_INSTANCING_COLOR',
          ' vec3 cc = instanceColor.xyz; float pidc = color.x;',
          ' if (pidc > 0.5) cc = aSkin; if (pidc > 1.5) cc = aHair; if (pidc > 2.5) cc = aPants; if (pidc > 3.5) cc = aAcc.xyz;',
          // profundidad: las filas altas se oscurecen y desaturan (la luz de TV cae sobre la pista y las primeras filas)
          ' cc = vbCrowdTone(cc, instanceMatrix[3].xyz);',
          ' vColor = cc;',
          '#else',
          ' vColor = vec3(1.0);',
          '#endif'
        ].join('\n'))
        .replace('#include <beginnormal_vertex>', [
          'float cheer = vbCheer(); float act = max(cheer, vbWave());',
          'float armUp = clamp(act * 1.4, 0.0, 1.0) * (0.82 + 0.18 * sin(uTime * 11.0 + aAnim.x * 3.0));',
          'float clap = uTension * (1.0 - act) * (0.5 + 0.5 * sin(uTime * 13.0 + aAnim.x * 7.0));',
          'float armCode = color.y; float side = sign(armCode); float isFore = step(1.5, abs(armCode));',
          'float shAng = side * (armUp * 2.75 + 0.12 * uTension * (1.0 - act));',
          'float elAng = isFore * armUp * 1.45; float clapAng = -isFore * side * clap * 0.6;',
          // posturas de reposo por instancia (se deshacen al animar): manos en los muslos, manos juntas en el regazo,
          // mano en la barbilla, mano levantada a medias. Y encorvado/recostado variable.
          'float pv = fract(aAnim.x * 5.17); float idleK = 1.0 - clamp(act * 2.0, 0.0, 1.0);',
          'shAng += idleK * ((pv > 0.55 && pv < 0.75) ? -side * 0.17 : 0.0);',
          'elAng += idleK * isFore * ((pv >= 0.75 && pv < 0.9 && side > 0.0) ? -1.5 : ((pv >= 0.9 && side < 0.0) ? -0.8 : 0.0));',
          'float hun = (fract(aAnim.x * 2.31) * 0.24 - 0.06) * idleK;',
          'float hunB = smoothstep(0.05, 0.45, position.y);',
          // la cabeza sigue el balón (y a ratos charla con el de al lado)
          'vec3 ip = instanceMatrix[3].xyz; vec3 fwv = normalize(instanceMatrix[2].xyz); vec3 rtv = normalize(instanceMatrix[0].xyz);',
          'vec3 dB = uBall - ip; float yaw = atan(dot(dB, rtv), max(0.4, dot(dB, fwv)));',
          'float chat = smoothstep(0.84, 0.98, sin(uTime * 0.19 + aAnim.x * 7.3)) * (fract(aAnim.x * 3.7) > 0.5 ? 1.0 : -1.0);',
          'float isHead = step(1.5, color.z);',
          'float hy = isHead * clamp(yaw * uLook * 0.85 + chat * 0.95 * (1.0 - act), -1.2, 1.2);',
          'vec3 objectNormal = vec3(normal);',
          'if (armCode != 0.0) { if (isFore > 0.5) objectNormal = vbRotY(vbRotX(objectNormal, elAng), clapAng); objectNormal = vbRotZ(objectNormal, shAng); }',
          'if (isHead > 0.5) objectNormal = vbRotY(objectNormal, hy);',
          'objectNormal = vbRotX(objectNormal, hun * hunB);'
        ].join('\n'))
        .replace('#include <begin_vertex>', [
          'vec3 transformed = vec3(position);',
          'if (color.z > 0.5 && color.z < 1.5 && aAcc.w < 0.5) transformed = vec3(0.0, 0.6, 0.0);', // sin bufanda: se pliega dentro del torso
          'if (armCode != 0.0) {',
          ' vec3 el = vec3(side * ' + CROWD_EL[0] + ', ' + CROWD_EL[1] + ', ' + CROWD_EL[2] + ');',
          ' if (isFore > 0.5) transformed = vbRotY(vbRotX(transformed - el, elAng), clapAng) + el;',
          ' vec3 sh = vec3(side * ' + CROWD_SH[0] + ', ' + CROWD_SH[1] + ', 0.0);',
          ' transformed = vbRotZ(transformed - sh, shAng) + sh;',
          '}',
          'vFace = position - vec3(0.0, 0.87, 0.012); vFaceK = isHead * step(0.5, color.x) * step(color.x, 1.5);',
          'if (isHead > 0.5) transformed = vbRotY(transformed - vec3(0.0, 0.74, 0.0), hy) + vec3(0.0, 0.74, 0.0);',
          'transformed = vbRotX(transformed - vec3(0.0, 0.05, 0.0), hun * hunB) + vec3(0.0, 0.05, 0.0);',
          'float bob = sin(uTime * (1.1 + aAnim.y * 0.7) + aAnim.x) * 0.012 + uTension * sin(uTime * 4.0 + aAnim.x) * 0.02;',
          'float hop = abs(sin(uTime * 8.0 + aAnim.x)) * 0.17 * cheer;',
          'float rise = smoothstep(0.05, 0.6, act) * 0.36;',
          'transformed.y += bob + hop + rise;',
          'transformed.x += sin(uTime * 0.55 + aAnim.x * 2.0) * 0.024 * max(0.0, transformed.y);' // balanceo suave
        ].join('\n'))
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFaceK *= 1.0 - smoothstep(7.0, 15.0, -mvPosition.z); vHazeD = -mvPosition.z;');
      // rasgos de la cara (ojos, cejas, boca) en el fragmento: solo de cerca, se apagan con la distancia
      sh.fragmentShader = CROWD_HAZE_FS + 'varying vec3 vFace; varying float vFaceK;\n' + sh.fragmentShader.replace('#include <fog_fragment>', CROWD_HAZE_APPLY + '#include <fog_fragment>').replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'if (vFaceK > 0.01 && vFace.z > 0.035) {',
        ' vec3 fp = vFace;',
        ' float eye = 1.0 - smoothstep(0.008, 0.013, length(vec2(abs(fp.x) - 0.035, (fp.y - 0.012) * 1.25)));',
        ' float brow = (1.0 - smoothstep(0.004, 0.008, abs(fp.y - 0.036 + abs(fp.x) * 0.12))) * step(0.014, abs(fp.x)) * (1.0 - step(0.056, abs(fp.x)));',
        ' float mouth = (1.0 - smoothstep(0.003, 0.007, abs(fp.y + 0.046 - fp.x * fp.x * 6.0))) * (1.0 - smoothstep(0.017, 0.025, abs(fp.x)));',
        ' float fk = max(eye, max(brow * 0.75, mouth * 0.55)) * vFaceK;',
        ' diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.18, fk);',
        '}'].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'vb-crowd-7'; };
    return m;
  }
  /* Banderas de la grada (ARN-02): atlas de 8 banderas ORIGINALES de peña (4 locales en naranja/arena/marino, 4 visitantes en
   * azules), con emblemas de ola, estrella, número de la afición («12») y balón; nada de franjas nacionales. Una sola
   * InstancedMesh: mástil (gris, una muestra del atlas) + paño de 0,78 x 0,51 m que ondea. aAcc.x = índice de la bandera. */
  var FLAG_CW = 256, FLAG_CH = 168, FLAG_AH = 512; // celda y alto del atlas (4 x 2 celdas + franja gris del mástil)
  function drawFlagAtlas() {
    var cv = canvas(FLAG_CW * 4, FLAG_AH), g = cv.getContext('2d');
    g.fillStyle = '#8b9098'; g.fillRect(0, FLAG_CH * 2 + 8, cv.width, FLAG_AH - FLAG_CH * 2 - 8); // mástil
    var HOME = { a: '#ff6b3d', b: '#e9c48f', d: '#16243a', k: '#ffd23f', w: '#fff6ea' };
    var AWAY = { a: '#3f8cff', b: '#9cc7ff', d: '#173a8a', k: '#ffd23f', w: '#f4f8ff' };
    function star(cx, cy, r, col) { g.fillStyle = col; g.beginPath(); for (var i = 0; i < 10; i++) { var an = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; g.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr); } g.closePath(); g.fill(); }
    function wave(x0, y0, w, amp, lw, col) { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); for (var t = 0; t <= 32; t++) { var x = x0 + w * t / 32, y = y0 + Math.sin(t / 32 * Math.PI * 2.5) * amp; if (t) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    function ball(cx, cy, r, col, lw) {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.clip();
      g.beginPath(); g.arc(cx - r * 1.05, cy - r * 0.95, r * 1.35, 0.15, 1.45); g.stroke(); g.beginPath(); g.arc(cx + r * 1.1, cy + r * 0.2, r * 1.3, 2.25, 3.6); g.stroke();
      g.beginPath(); g.arc(cx + r * 0.1, cy + r * 1.25, r * 1.2, 3.75, 5.3); g.stroke(); g.restore();
    }
    function num(cx, cy, size, txt, col) { g.fillStyle = col; g.font = 'italic 900 ' + Math.round(size) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, cx, cy + size * 0.04); }
    for (var t = 0; t < 2; t++) {
      var P = t ? AWAY : HOME;
      for (var d = 0; d < 4; d++) {
        var x0 = d * FLAG_CW, y0 = t * FLAG_CH, W = FLAG_CW, H = FLAG_CH, cx = x0 + W / 2, cy = y0 + H / 2;
        g.save(); g.beginPath(); g.rect(x0, y0, W, H); g.clip();
        if (d === 0) {        // ola del Palau: campo del color del equipo, doble ola, estrella dorada
          g.fillStyle = P.a; g.fillRect(x0, y0, W, H);
          wave(x0 - 6, y0 + H * 0.62, W + 12, H * 0.07, H * 0.085, P.w); wave(x0 - 6, y0 + H * 0.82, W + 12, H * 0.07, H * 0.085, P.b);
          star(x0 + W * 0.2, y0 + H * 0.3, H * 0.16, P.k);
        } else if (d === 1) { // estrella grande sobre fondo oscuro, disco y ribete
          g.fillStyle = P.d; g.fillRect(x0, y0, W, H);
          g.strokeStyle = P.b; g.lineWidth = H * 0.07; g.strokeRect(x0 + H * 0.06, y0 + H * 0.06, W - H * 0.12, H - H * 0.12);
          g.fillStyle = P.a; g.beginPath(); g.arc(cx, cy, H * 0.33, 0, 6.283); g.fill();
          star(cx, cy, H * 0.27, P.w);
        } else if (d === 2) { // número de la afición en un disco
          g.fillStyle = P.b; g.fillRect(x0, y0, W, H);
          g.fillStyle = P.a; g.fillRect(x0, y0, W * 0.16, H); g.fillRect(x0 + W * 0.84, y0, W * 0.16, H);
          g.fillStyle = P.d; g.beginPath(); g.arc(cx, cy, H * 0.36, 0, 6.283); g.fill();
          num(cx, cy, H * 0.46, '12', P.w);
        } else {              // balón del pabellón con rayos
          g.fillStyle = P.a; g.fillRect(x0, y0, W, H);
          g.fillStyle = P.d; for (var k = 0; k < 8; k++) { var an = k * Math.PI / 4 + 0.2; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, W, an, an + 0.22); g.closePath(); g.fill(); }
          g.fillStyle = P.a; g.beginPath(); g.arc(cx, cy, H * 0.36, 0, 6.283); g.fill();
          ball(cx, cy, H * 0.26, P.w, H * 0.05);
        }
        // tela: luz suave arriba, pliegue oscuro abajo y dobladillo del lado del mástil
        var sh = g.createLinearGradient(0, y0, 0, y0 + H); sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(1, 'rgba(0,0,0,0.18)');
        g.fillStyle = sh; g.fillRect(x0, y0, W, H);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, y0, W * 0.03, H);
        g.restore();
      }
    }
    return cv;
  }
  var flagCv = null, flagTex = null;
  function flagMaterial() {
    flagCv = drawFlagAtlas(); flagTex = texOf(flagCv);
    var m = new THREE.MeshLambertMaterial({ vertexColors: true, map: flagTex, side: THREE.DoubleSide });
    m.onBeforeCompile = function (sh) {
      for (var k in crowdU) sh.uniforms[k] = crowdU[k];
      sh.vertexShader = CROWD_GLSL_HEAD + '\n' + sh.vertexShader
        .replace('#include <uv_vertex>', [
          '#ifdef USE_UV',
          ' if (color.x > 0.5) { float fid = floor(aAcc.x + 0.5); float fcx = mod(fid, 4.0), fcy = floor(fid / 4.0);',
          '  vUv = vec2((fcx + uv.x) * 0.25, 1.0 - (fcy + 1.0 - uv.y) * ' + (FLAG_CH / FLAG_AH).toFixed(5) + '); }',
          ' else vUv = vec2(0.5, 0.08);',
          '#endif'].join('\n'))
        .replace('#include <color_vertex>', [
          '#ifdef USE_COLOR', ' vColor = vec3(vbCrowdFall(instanceMatrix[3].xyz));', '#endif'].join('\n'))
        .replace('#include <project_vertex>', '#include <project_vertex>\n vHazeD = -mvPosition.z;')
        .replace('#include <begin_vertex>', [
          'float cheer = vbCheer(); float act = max(cheer, vbWave());',
          'vec3 transformed = vec3(position);',
          'float fx = clamp(transformed.x / 0.78, 0.0, 1.0);',
          'if (color.x > 0.5) transformed.z += sin(uTime * 7.0 + transformed.x * 6.0 + aAnim.x * 4.0) * 0.1 * fx + sin(uTime * 3.1 + transformed.y * 5.0) * 0.03 * fx;',
          'float sw = sin(uTime * (2.2 + aAnim.y) + aAnim.x * 5.0) * (0.12 + 0.55 * act);',
          'transformed = vbRotZ(transformed - vec3(0.0, 0.75, 0.0), sw) + vec3(0.0, 0.75, 0.0);',
          'transformed.y += smoothstep(0.05, 0.6, act) * 0.36 + abs(sin(uTime * 8.0 + aAnim.x)) * 0.17 * cheer;'
        ].join('\n'));
    };
    m.onBeforeCompile = (function (vs) { return function (sh) { vs(sh); sh.fragmentShader = CROWD_HAZE_FS + sh.fragmentShader.replace('#include <fog_fragment>', CROWD_HAZE_APPLY + '#include <fog_fragment>'); }; })(m.onBeforeCompile);
    m.customProgramCacheKey = function () { return 'vb-flag-3'; };
    return m;
  }
  function flagGeometry() {
    var pos = [], nor = [], dat = [], uvs = [], idx = [], off = 0;
    function add(geo, part, x, y, z) {
      var p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
      for (var k = 0; k < p.count; k++) { pos.push(p.getX(k) + x, p.getY(k) + y, p.getZ(k) + z); nor.push(n.getX(k), n.getY(k), n.getZ(k)); dat.push(part, 0, 0); uvs.push(u.getX(k), u.getY(k)); }
      var ia = geo.index.array; for (var j = 0; j < ia.length; j++) idx.push(ia[j] + off); off += p.count; geo.dispose();
    }
    add(new THREE.BoxGeometry(0.025, 1.6, 0.025), 0, 0, 1.15, 0);               // mástil (de la mano hacia arriba)
    add(new THREE.PlaneGeometry(0.78, 0.51, 6, 2), 1, 0.4, 1.66, 0);            // paño
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(dat, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx); return geo;
  }
  /* Vomitorio (antes un rectángulo negro que en el plano de héroe leía como un agujero en la grada).
   * Zanja entre dos muretes escalonados a través de las filas 0..VOM_ROWS-1 y, al fondo, la boca de un túnel
   * con profundidad real bajo las filas siguientes: marco y dintel con línea de luz, techo con tubo de luz,
   * pared del fondo con el resplandor del pasillo y una señal de salida colgada. Todo va a las mallas
   * fusionadas (S iluminada, E emisiva): 0 dibujos más. */
  var VOM_X = 10.5, VOM_W = 2.2, VOM_H = 2.05, VOM_ROWS = 4, VOM_DEEP = 2, VOM_T = 0.18;
  function buildVomitory(S, E, s, vx) {
    var cheek = col('#243040'), cap = col('#4d5b6d'), floorC = col('#36424f'), nose = col('#4f9fd0');
    var inner = col('#202b39'), ceil = col('#2a3544'), back = col('#18212d'), frame = col('#3a4658');
    var y0 = SY0 - 0.05, ym = SY0 + VOM_ROWS * ROW_D, yb = ym + VOM_DEEP * ROW_D, half = VOM_W / 2, cw = VOM_W - 2 * VOM_T;
    // suelo de la zanja y del túnel
    S.sbox(cw, yb - y0, 0.04, vx, s * (y0 + yb) / 2, 0.02, floorC);
    for (var side = -1; side <= 1; side += 2) {
      var cx = vx + side * (half - VOM_T / 2);
      // murete escalonado con albardilla clara (barandilla de la escalera)
      for (var r = 0; r < VOM_ROWS; r++) {
        var ra = r === 0 ? y0 : SY0 + r * ROW_D, rb = SY0 + (r + 1) * ROW_D, hz = 0.5 + r * ROW_H + 0.9;
        S.sbox(VOM_T, rb - ra, hz, cx, s * (ra + rb) / 2, hz / 2, cheek);
        S.sbox(VOM_T + 0.04, rb - ra, 0.05, cx, s * (ra + rb) / 2, hz + 0.025, cap);
        E.sbox(0.02, rb - ra - 0.04, 0.018, cx - side * (VOM_T / 2 + 0.02), s * (ra + rb) / 2, hz + 0.01, nose);   // borde con luz (como los pasillos)
      }
      // paredes interiores del túnel
      S.sbox(VOM_T, yb - ym, VOM_H, cx, s * (ym + yb) / 2, VOM_H / 2, inner);
      // jamba (marco) en la boca
      S.sbox(0.12, 0.1, VOM_H, vx + side * (cw / 2 - 0.06), s * (ym - 0.05), VOM_H / 2, frame);
      // franja de guía en la pared interior (refleja el tubo del techo)
      E.sbox(0.012, yb - ym - 0.3, 0.03, vx + side * (cw / 2 - 0.006), s * (ym + yb) / 2, 1.0, col('#3f6584'));
    }
    // dintel con línea de luz cálida (misma familia que la del antepecho)
    S.sbox(cw, 0.1, 0.16, vx, s * (ym - 0.05), VOM_H - 0.08, frame);
    E.sbox(cw - 0.24, 0.02, 0.025, vx, s * (ym - 0.11), VOM_H - 0.17, col('#ffcf9a'));
    // techo del túnel y tubo de luz fría
    S.sbox(cw, yb - ym, 0.06, vx, s * (ym + yb) / 2, VOM_H - 0.03, ceil);
    E.sbox(0.12, yb - ym - 0.5, 0.025, vx, s * ((ym + yb) / 2 + 0.1), VOM_H - 0.075, col('#9fc4e6'));
    // pared del fondo: oscura arriba, resplandor del pasillo abajo (el túnel gira y sigue)
    S.sbox(cw, 0.06, VOM_H, vx, s * (yb - 0.03), VOM_H / 2, back);
    var gLo = col('#3e5975'), gHi = col('#162130'), NB = 10;
    for (var g = 0; g < NB; g++) { var gt = g / (NB - 1); E.sbox(cw - 0.02, 0.02, VOM_H / NB, vx, s * (yb - 0.07), (g + 0.5) * VOM_H / NB, gLo.clone().lerp(gHi, Math.pow(gt, 0.8))); }
    // señal de salida colgada del techo, junto a la boca (verde con figura y flecha en blanco)
    var sy = s * (ym + 0.25), sz = VOM_H - 0.28;
    S.sbox(0.012, 0.012, 0.12, vx - 0.18, sy, VOM_H - 0.12, frame); S.sbox(0.012, 0.012, 0.12, vx + 0.18, sy, VOM_H - 0.12, frame);
    E.sbox(0.5, 0.04, 0.17, vx, sy, sz, col('#13b862'));
    var fy = sy - s * 0.022, wh = col('#eafff2');
    E.sbox(0.035, 0.01, 0.035, vx - 0.13, fy, sz + 0.045, wh);            // cabeza
    E.sbox(0.04, 0.01, 0.07, vx - 0.135, fy, sz - 0.01, wh);              // cuerpo
    E.sbox(0.025, 0.01, 0.05, vx - 0.115, fy, sz - 0.06, wh); E.sbox(0.025, 0.01, 0.05, vx - 0.155, fy, sz - 0.055, wh);
    E.sbox(0.16, 0.01, 0.025, vx + 0.08, fy, sz, wh);                     // flecha
    E.sbox(0.04, 0.01, 0.06, vx + 0.16, fy, sz, wh);
  }
  /* ARN-15: tribuna de prensa en las primeras filas de la grada de la mesa (lado +y), entre los pasillos ±7 m: las filas pares
   * son mesas corridas (tablero, faldón con filo de luz fría) y las impares, periodistas (público con camisa sobria que no
   * salta ni hace la ola) con un portátil por plaza: pantalla encendida hacia el periodista y piloto en la tapa. */
  var PRESS_X = 6.45, PRESS_ROWS = 4;
  function pressCut(segs) {
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      var a = segs[i][0], b = segs[i][1];
      if (b <= -PRESS_X || a >= PRESS_X) { out.push(segs[i]); continue; }
      if (a < -PRESS_X) out.push([a, -PRESS_X]);
      if (b > PRESS_X) out.push([PRESS_X, b]);
    }
    return out;
  }
  function buildPress(S, E) {
    var deskC = col('#202834'), panelC = col('#141b25'), lidC = col('#2d333c'), strip = col('#6f8fb0');
    var scr = [col('#4f7aa0'), col('#6b8fb0'), col('#8aa4bc'), col('#3f6e96')], logo = col('#cfe3ff');
    var blocks = [[-PRESS_X, -0.55], [0.55, PRESS_X]];
    for (var r = 0; r < PRESS_ROWS; r += 2) {
      var y0 = SY0 + r * ROW_D, topR = 0.5 + r * ROW_H, deskZ = 0.5 + (r + 1) * ROW_H + 0.7;
      for (var b = 0; b < blocks.length; b++) {
        var x0 = blocks[b][0] + 0.06, x1 = blocks[b][1] - 0.06, w = x1 - x0, cx = (x0 + x1) / 2;
        S.cbox(w, 0.5, 0.045, cx, y0 + 0.52, deskZ - 0.0225, deskC, 0.03, 0.012);                 // tablero
        S.sbox(w - 0.04, 0.035, deskZ - topR - 0.045, cx, y0 + 0.3, (deskZ - 0.045 + topR) / 2, panelC); // faldón
        E.sbox(w - 0.1, 0.01, 0.014, cx, y0 + 0.28, deskZ - 0.07, strip);                        // filo de luz
        // un portátil por plaza (las mismas x que los asientos de la fila de detrás)
        for (var x = -LATX + 0.3 + SEAT_W / 2; x < LATX - 0.3; x += SEAT_W) {
          if (x < x0 + 0.2 || x > x1 - 0.2) continue;
          var ly = y0 + 0.6, lz = deskZ + 0.1, k = Math.floor(Math.abs(x * 7.3 + r)) % 4, a = 0.32;
          S.sbox(0.3, 0.2, 0.014, x, ly + 0.04, deskZ + 0.007, lidC);                             // base
          S.box(0.3, 0.2, 0.012, x, lz, -ly, lidC, 0, a);                                          // tapa
          E.box(0.27, 0.17, 0.003, x, lz + 0.0024, -ly - 0.0078, scr[k], 0, a);                    // pantalla (hacia el periodista)
          E.box(0.022, 0.022, 0.003, x, lz + 0.02, -ly + 0.0078, logo, 0, a);                      // piloto de la tapa (hacia la pista)
        }
      }
    }
  }
  /* ARN-15: barandilla de vidrio y acero sobre el antepecho de cada grada: postes cada ~1,5 m, pasamanos tubular, perfil de
   * apoyo y canto del vidrio con un filo de luz tenue; el brillo del vidrio va en la malla aditiva de las vallas (tipo 3). */
  function buildRailing(S, E, axis, c, len) {
    var steelL = col('#9aa3ae'), chan = col('#2a313b'), edge = col('#56687c'), z0 = 1.15, z1 = 1.58, zr = 1.63;
    var n = Math.max(2, Math.round(len / 1.5)), stepL = len / n, along = axis === 'y';
    function sb(lA, lB, lz, a, b, z, colr) { if (along) S.sbox(lA, lB, lz, a, b, z, colr); else S.sbox(lB, lA, lz, b, a, z, colr); }
    for (var i = 0; i <= n; i++) { var a = -len / 2 + i * stepL; sb(0.035, 0.035, zr - z0, a, c, (zr + z0) / 2, steelL); }
    sb(len, 0.06, 0.04, 0, c, z0 + 0.02, chan);                                                     // perfil de apoyo
    var hr = new THREE.CylinderGeometry(0.024, 0.024, len, 8);
    if (along) S.geo(hr, 0, zr, -c, steelL, 0, 0, Math.PI / 2); else S.geo(hr, c, zr, 0, steelL, 0, Math.PI / 2, 0);
    if (along) E.sbox(len, 0.012, 0.006, 0, c, z1, edge); else E.sbox(0.012, len, 0.006, c, 0, z1, edge);
    // vidrio: paneles aditivos (tipo 3) en el lote de reflejos/halos de las vallas, uno por vano
    if (led.rbatch) {
      var pos = new THREE.Vector3(), ry = along ? (c > 0 ? 0 : Math.PI) : (c > 0 ? -Math.PI / 2 : Math.PI / 2); // cara hacia la pista
      for (var j = 0; j < n; j++) {
        var m = -len / 2 + (j + 0.5) * stepL;
        if (along) VB.toThree(m, c, (z0 + z1) / 2 + 0.02, pos); else VB.toThree(c, m, (z0 + z1) / 2 + 0.02, pos);
        led.rbatch.add(stepL - 0.05, z1 - z0 - 0.04, pos, 0, ry, [1, 0, rnd(), 0], [3, 0, 1]);
      }
    }
  }
  function buildStands(S, E) {
    var stepA = col(PAL.step), stepT = col(PAL.stepTop), seatA = col(PAL.seatA), seatB = col(PAL.seatB), seatC = col(PAL.seatC);
    var barrier = col(PAL.barrier), cove = col('#ffcf9a'), aisle = col('#4d4c8e'), wall = col(PAL.wall), aisleLight = col('#7fc8ff');
    var blocks = SEAT_BLOCKS.map(col); // CARTOON: color de bloque (entre pasillos), sin tocar la secuencia aleatoria del público
    var seats = [[], [], [], []];
    var aislesL = [-21, -14, -7, 0, 7, 14, 21], aislesE = [-5.6, 0, 5.6];
    function inAisle(v, list) { for (var i = 0; i < list.length; i++) if (Math.abs(v - list[i]) < 0.55) return true; return false; }
    // misma caída de luz que el público (vbCrowdFall): peldaños y asientos se apagan hacia arriba (ARN-02)
    function rowC(c, r) { var y = 0.96 + r * ROW_H, u = Math.min(1, Math.max(0, (y - 1.6) / 3.8)); return c.clone().multiplyScalar(1 - 0.5 * u * u * (3 - 2 * u)); }
    /** Trozos de [a, b] que quedan fuera de los vomitorios. */
    function vomCut(a, b) {
      var cuts = [[-VOM_X - VOM_W / 2, -VOM_X + VOM_W / 2], [VOM_X - VOM_W / 2, VOM_X + VOM_W / 2]], out = [[a, b]];
      for (var k = 0; k < cuts.length; k++) {
        var nx = [];
        for (var q = 0; q < out.length; q++) {
          var p = out[q];
          if (cuts[k][1] <= p[0] || cuts[k][0] >= p[1]) { nx.push(p); continue; }
          if (cuts[k][0] > p[0]) nx.push([p[0], cuts[k][0]]);
          if (cuts[k][1] < p[1]) nx.push([cuts[k][1], p[1]]);
        }
        out = nx;
      }
      return out;
    }
    // ----- laterales (s = signo de y) -----
    for (var s = -1; s <= 1; s += 2) {
      var mi = s > 0 ? 0 : 1;
      for (var r = 0; r < ROWS_L; r++) {
        var y0 = SY0 + r * ROW_D, top = 0.5 + r * ROW_H, yc = y0 + ROW_D / 2;
        var stc = rowC(r % 2 ? stepA : stepT, r);
        if (r < VOM_ROWS + VOM_DEEP) {
          var segs = vomCut(-LATX, LATX);
          for (var sg = 0; sg < segs.length; sg++) S.sbox(segs[sg][1] - segs[sg][0], ROW_D, top, (segs[sg][0] + segs[sg][1]) / 2, s * yc, top / 2, stc);
          // sobre la boca del túnel: losa (techo del túnel) bajo los asientos de esta fila
          if (r >= VOM_ROWS) for (var vs = -1; vs <= 1; vs += 2) S.sbox(VOM_W, ROW_D, top - VOM_H, vs * VOM_X, s * yc, (top + VOM_H) / 2, stc);
        } else S.sbox(2 * LATX, ROW_D, top, 0, s * yc, top / 2, stc);
        // asientos por bloques entre pasillos
        var bx0 = -LATX + 0.3;
        for (var ai = 0; ai <= aislesL.length; ai++) {
          var bx1 = ai < aislesL.length ? aislesL[ai] - 0.55 : LATX - 0.3;
          var sc = rowC(blocks[(ai + (s > 0 ? 0 : 3) + (r > 9 ? 1 : 0)) % blocks.length], r);
          if (bx1 - bx0 > 0.4) {
            var bseg = r < VOM_ROWS ? vomCut(bx0, bx1) : [[bx0, bx1]];
            if (s > 0 && r < PRESS_ROWS && r % 2 === 0) bseg = pressCut(bseg);
            for (var bq = 0; bq < bseg.length; bq++) {
              var ba = bseg[bq][0] + (bseg[bq][0] > bx0 ? 0.08 : 0), bb = bseg[bq][1] - (bseg[bq][1] < bx1 ? 0.08 : 0);
              if (bb - ba < 0.3) continue;
              S.sbox(bb - ba, 0.42, 0.08, (ba + bb) / 2, s * (y0 + 0.36), top + 0.42, sc);
              S.sbox(bb - ba, 0.06, 0.42, (ba + bb) / 2, s * (y0 + 0.62), top + 0.66, sc);
            }
          }
          if (ai < aislesL.length) {
            S.sbox(1.0, ROW_D, 0.02, aislesL[ai], s * yc, top + 0.01, aisle);
            E.sbox(0.5, 0.02, 0.02, aislesL[ai], s * (y0 + 0.02), top + 0.03, aisleLight);
            bx0 = aislesL[ai] + 0.55;
          }
        }
        for (var x = -LATX + 0.3 + SEAT_W / 2; x < LATX - 0.3; x += SEAT_W) {
          if (inAisle(x, aislesL)) continue;
          var jx = (rnd() - 0.5) * 0.06;            // se consume igual: el resto del público no cambia
          if (r < VOM_ROWS && Math.abs(Math.abs(x) - VOM_X) < VOM_W / 2 + 0.2) continue;
          var inPress = s > 0 && r < PRESS_ROWS && Math.abs(x) < PRESS_X;
          if (inPress && r % 2 === 0) continue;               // filas de mesas de la tribuna de prensa: sin asiento
          seats[mi].push({ x: x + jx, y: s * (y0 + 0.42), z: top + 0.46, fx: 0, fy: -s, row: r, press: inPress });
        }
      }
      var yb = SY0 + ROWS_L * ROW_D, tb = 0.5 + ROWS_L * ROW_H;
      S.sbox(2 * LATX, 0.4, tb + 2.6, 0, s * (yb + 0.2), (tb + 2.6) / 2, wall);               // muro trasero
      S.sbox(2 * LATX + 1, 0.5, 1.15, 0, s * (SY0 - 0.3), 0.575, barrier);                    // antepecho
      E.sbox(2 * LATX + 1, 0.04, 0.035, 0, s * (SY0 - 0.56), 1.13, cove);                    // línea de luz
      for (var v = -1; v <= 1; v += 2) buildVomitory(S, E, s, v * VOM_X);
      buildRailing(S, E, 'y', s * (SY0 - 0.42), 2 * LATX + 1);
      if (s > 0) buildPress(S, E);
    }
    // ----- fondos (s = signo de x) -----
    for (var e = -1; e <= 1; e += 2) {
      var me = e > 0 ? 2 : 3;
      for (var r2 = 0; r2 < ROWS_E; r2++) {
        var x0 = SX0 + r2 * ROW_D, top2 = 0.5 + r2 * ROW_H, xc = x0 + ROW_D / 2;
        S.sbox(ROW_D, 2 * ENDY, top2, e * xc, 0, top2 / 2, rowC(r2 % 2 ? stepA : stepT, r2));
        var by0 = -ENDY + 0.3;
        for (var aj = 0; aj <= aislesE.length; aj++) {
          var by1 = aj < aislesE.length ? aislesE[aj] - 0.55 : ENDY - 0.3;
          var sc2 = rowC(blocks[(aj + (e > 0 ? 1 : 4) + (r2 > 8 ? 1 : 0)) % blocks.length], r2);
          if (by1 - by0 > 0.4) {
            S.sbox(0.42, by1 - by0, 0.08, e * (x0 + 0.36), (by0 + by1) / 2, top2 + 0.42, sc2);
            S.sbox(0.06, by1 - by0, 0.42, e * (x0 + 0.62), (by0 + by1) / 2, top2 + 0.66, sc2);
          }
          if (aj < aislesE.length) {
            S.sbox(ROW_D, 1.0, 0.02, e * xc, aislesE[aj], top2 + 0.01, aisle);
            E.sbox(0.02, 0.5, 0.02, e * (x0 + 0.02), aislesE[aj], top2 + 0.03, aisleLight);
            by0 = aislesE[aj] + 0.55;
          }
        }
        for (var y = -ENDY + 0.3 + SEAT_W / 2; y < ENDY - 0.3; y += SEAT_W) {
          if (inAisle(y, aislesE)) continue;
          seats[me].push({ x: e * (x0 + 0.42), y: y + (rnd() - 0.5) * 0.06, z: top2 + 0.46, fx: -e, fy: 0, row: r2 });
        }
      }
      var xb = SX0 + ROWS_E * ROW_D, tb2 = 0.5 + ROWS_E * ROW_H;
      S.sbox(0.4, 2 * ENDY + 0.8, tb2 + 2.2, e * (xb + 0.2), 0, (tb2 + 2.2) / 2, wall);
      S.sbox(0.5, 2 * ENDY + 0.8, 1.15, e * (SX0 - 0.3), 0, 0.575, barrier);
      E.sbox(0.035, 2 * ENDY + 0.8, 0.035, e * (SX0 - 0.56), 0, 1.13, cove);
      // paredes laterales de la grada de fondo
      for (var sw = -1; sw <= 1; sw += 2) S.sbox(xb - SX0 + 0.6, 0.3, tb2 + 0.4, e * (SX0 + (xb - SX0) / 2), sw * (ENDY + 0.2), (tb2 + 0.4) / 2, wall);
      buildRailing(S, E, 'x', e * (SX0 - 0.42), 2 * ENDY + 0.8);
    }
    return seats;
  }
  /* ---------------------------------------------------------------------
   * PÚBLICO IMPOSTOR (calidad media: filas lejanas; baja: toda la grada)
   * Cada aficionado es un cartel de 2 triángulos orientado a la cámara (eje vertical) que muestra una figura
   * pintada en un atlas de lienzo: 4 posturas (manos en el regazo, brazos arriba, aplauso, brazos cruzados)
   * x 2 peinados. El atlas guarda MÁSCARAS (R camiseta, G piel, B pelo, resto = pantalón; A = silueta) en la
   * mitad de arriba y el SOMBREADO en la de abajo: los colores de cada persona son los mismos que los de la
   * versión 3D (atributos por instancia) y la animación (alegría, ola, tensión, botes) usa los mismos uniformes.
   * Una sola malla instanciada para las 4 gradas (1 dibujo, ~2 triángulos por persona); la densidad y el
   * "solo filas lejanas" se resuelven en el vértice (aImp = [aleatorio, ¿fila cercana?]).
   * --------------------------------------------------------------------- */
  var NEAR_L = 4, NEAR_E = 3;           // filas "cercanas" (3D en calidad media) en laterales / fondos
  var IMP_W = 0.875, IMP_Y0 = -0.45, IMP_H = 1.75, IMP_CW = 64, IMP_CH = 128; // cartel (m) y celda del atlas (px)
  var IMP_LIGHT = [0.42, 0.42]; // [baja, media]
  var _m4i = null, imp = { mesh: null, U: null, cv: null, tex: null };
  /** Figura sentada de frente en la celda (ox, oy). mode 'mask' = colores de máscara, 'shade' = grises. */
  function drawImpFigure(g, ox, oy, pose, variant, mode) {
    var P = IMP_CH / IMP_H, cx = ox + IMP_CW / 2;
    function X(x) { return cx + x * P; }
    function Y(y) { return oy + (IMP_Y0 + IMP_H - y) * P; }
    var M = mode === 'mask';
    var SH = M ? { shirt: '#ff0000', skin: '#00ff00', hair: '#0000ff', pants: '#000000', shoe: '#000000' }
      : { shirt: '#d6d6d6', skin: '#e8e8e8', hair: '#a8a8a8', pants: '#9a9a9a', shoe: '#5a5a5a' };
    function limb(x0, y0, x1, y1, w, col) { g.strokeStyle = col; g.lineWidth = w * P; g.lineCap = 'round'; g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); }
    function ell(x, y, rx, ry, col) { g.fillStyle = col; g.beginPath(); g.ellipse(X(x), Y(y), rx * P, ry * P, 0, 0, 6.2832); g.fill(); }
    var longHair = variant === 1;
    // piernas: muslos en escorzo (hacia la cámara), espinillas y zapatillas
    for (var s = -1; s <= 1; s += 2) {
      limb(s * 0.09, 0.02, s * 0.1, -0.06, 0.15, SH.pants);
      limb(s * 0.1, -0.08, s * 0.105, -0.37, 0.105, SH.pants);
      ell(s * 0.105, -0.405, 0.068, 0.04, SH.shoe);
    }
    // melena por detrás (peinado largo)
    if (longHair) {
      g.fillStyle = SH.hair; g.beginPath();
      g.moveTo(X(-0.105), Y(0.93)); g.quadraticCurveTo(X(-0.15), Y(0.75), X(-0.13), Y(0.6)); g.lineTo(X(0.13), Y(0.6));
      g.quadraticCurveTo(X(0.15), Y(0.75), X(0.105), Y(0.93)); g.closePath(); g.fill();
    }
    // tronco con hombros redondeados
    g.fillStyle = SH.shirt; g.beginPath();
    g.moveTo(X(-0.155), Y(-0.02)); g.quadraticCurveTo(X(-0.14), Y(0.24), X(-0.178), Y(0.47));
    g.quadraticCurveTo(X(-0.215), Y(0.6), X(-0.075), Y(0.648)); g.lineTo(X(0.075), Y(0.648));
    g.quadraticCurveTo(X(0.215), Y(0.6), X(0.178), Y(0.47)); g.quadraticCurveTo(X(0.14), Y(0.24), X(0.155), Y(-0.02));
    g.closePath(); g.fill();
    // cuello y cabeza
    g.fillStyle = SH.skin; g.fillRect(X(-0.045), Y(0.735), 0.09 * P, 0.13 * P);
    ell(0, 0.862, 0.094, 0.114, SH.skin);
    ell(-0.093, 0.858, 0.018, 0.028, SH.skin); ell(0.093, 0.858, 0.018, 0.028, SH.skin); // orejas
    // pelo: casquete (corto) o casquete + flequillo lateral (largo)
    g.save(); g.beginPath(); g.ellipse(X(0), Y(0.866), 0.101 * P, 0.122 * P, 0, 0, 6.2832); g.clip();
    g.fillStyle = SH.hair; g.fillRect(X(-0.12), Y(1.02), 0.24 * P, (1.02 - (longHair ? 0.88 : 0.905)) * P);
    if (longHair) { g.fillRect(X(-0.12), Y(0.95), 0.035 * P, 0.15 * P); g.fillRect(X(0.085), Y(0.95), 0.035 * P, 0.15 * P); }
    g.restore();
    // brazos: manga (camiseta) + antebrazo y mano (piel)
    var A;
    if (pose === 1) A = [[0.3, 0.84, 0.34, 1.16], [0.3, 0.84, 0.34, 1.16]];          // brazos arriba
    else if (pose === 2) A = [[0.235, 0.35, 0.035, 0.53], [0.235, 0.35, 0.035, 0.53]]; // aplauso
    else if (pose === 3) A = [[0.225, 0.33, -0.075, 0.37], [0.225, 0.33, -0.085, 0.41]]; // brazos cruzados
    else A = [[0.24, 0.32, 0.125, 0.12], [0.24, 0.32, 0.125, 0.12]];                 // manos en el regazo
    for (var a = 0; a < 2; a++) {
      var sd = a ? 1 : -1, e = A[a], ex = sd * e[0], ey = e[1], hx = sd * e[2], hy = e[3];
      var shx = sd * 0.198, shy = 0.565, mx = shx + (ex - shx) * 0.55, my = shy + (ey - shy) * 0.55;
      limb(ex, ey, hx, hy, 0.068, SH.skin);
      limb(shx, shy, ex, ey, 0.072, SH.skin);
      limb(shx, shy, mx, my, 0.088, SH.shirt);
      ell(hx, hy, 0.038, 0.042, SH.skin);
    }
    if (!M) {
      // sombreado: luz de arriba a la izquierda, piernas en la sombra de la fila de delante, rasgos de la cara
      g.save(); g.globalCompositeOperation = 'source-atop';
      var gx = g.createLinearGradient(X(-0.25), 0, X(0.25), 0); gx.addColorStop(0, 'rgba(255,255,255,0.10)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.26)');
      g.fillStyle = gx; g.fillRect(ox, oy, IMP_CW, IMP_CH);
      var gy = g.createLinearGradient(0, Y(0.3), 0, Y(-0.45)); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = gy; g.fillRect(ox, Y(0.3), IMP_CW, IMP_CH);
      g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(X(-0.15), Y(0.03), 0.3 * P, 0.03 * P);          // cintura
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(X(-0.045), Y(0.75), 0.09 * P, 0.035 * P);       // sombra de la barbilla
      g.fillStyle = 'rgba(30,20,10,0.75)';
      g.fillRect(X(-0.05), Y(0.885), 0.026 * P, 0.02 * P); g.fillRect(X(0.024), Y(0.885), 0.026 * P, 0.02 * P); // ojos
      g.fillStyle = 'rgba(60,25,20,0.45)'; g.fillRect(X(-0.03), Y(0.815), 0.06 * P, 0.012 * P);     // boca
      g.restore();
    }
  }
  function impAtlas() {
    var cv = canvas(IMP_CW * 4, IMP_CH * 4), g = cv.getContext('2d');
    for (var v = 0; v < 2; v++) for (var p = 0; p < 4; p++) {
      drawImpFigure(g, p * IMP_CW, v * IMP_CH, p, v, 'mask');
      drawImpFigure(g, p * IMP_CW, (v + 2) * IMP_CH, p, v, 'shade');
    }
    return cv;
  }
  var IMP_VS = [
    'attribute vec4 aAnim; attribute vec3 aSkin; attribute vec3 aHair; attribute vec3 aPants; attribute vec2 aImp;',
    'uniform float uTime; uniform vec2 uCheer; uniform vec2 uCheerAge; uniform vec2 uWave; uniform float uTension; uniform float uCrowdLight;',
    'uniform float uDens; uniform float uSkipNear;',
    CROWD_FALL_GLSL,
    'varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying vec3 vPants; varying float vHazeD;',
    '#include <fog_pars_vertex>',
    'float vbCheer(){ float dly = fract(aAnim.x * 0.731) * 0.42; vec2 ch = uCheer * smoothstep(vec2(dly), vec2(dly + 0.2), uCheerAge);',
    ' float c = aAnim.z < 0.25 ? ch.x : (aAnim.z > 0.75 ? ch.y : max(ch.x, ch.y) * 0.55); return c * aAnim.y; }',
    'float vbWave(){ float wd = abs(fract(aAnim.w - uWave.x + 0.5) - 0.5); return uWave.y * smoothstep(0.045, 0.0, wd) * step(0.2, aAnim.y); }',
    'void main(){',
    ' if (aImp.x >= uDens || (uSkipNear > 0.5 && aImp.y > 0.5)) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }',
    ' vec3 ip = instanceMatrix[3].xyz; float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);',
    ' float cheer = vbCheer(); float act = max(cheer, vbWave());',
    ' float clap = uTension * (1.0 - act) * step(0.5, fract(uTime * 2.2 + aAnim.x));',
    ' float pv = fract(aAnim.x * 5.17);',
    ' float frame = act * 1.4 > 0.45 ? 1.0 : (clap > 0.5 ? 2.0 : ((pv > 0.55 && pv < 0.9) ? 3.0 : 0.0));',
    ' float row = fract(aAnim.x * 3.7) > 0.62 ? 1.0 : 0.0;',
    ' vec2 q = uv; if (fract(aAnim.x * 1.93) > 0.5) q.x = 1.0 - q.x;',
    ' vUv = vec2((frame + q.x) * 0.25, 1.0 - (row + 1.0 - q.y) * 0.25);',
    ' float bob = sin(uTime * (1.1 + aAnim.y * 0.7) + aAnim.x) * 0.012 + uTension * sin(uTime * 4.0 + aAnim.x) * 0.02;',
    ' float hop = abs(sin(uTime * 8.0 + aAnim.x)) * 0.17 * cheer;',
    ' float rise = smoothstep(0.05, 0.6, act) * 0.36;',
    ' vec3 tc = cameraPosition - ip; vec3 rt = normalize(vec3(tc.z, 0.0, -tc.x) + vec3(1e-4, 0.0, 0.0));',
    ' float sway = sin(uTime * 0.55 + aAnim.x * 2.0) * 0.024 * position.y;',
    ' vec3 wp = ip + rt * ((position.x * ' + IMP_W.toFixed(4) + ' + sway) * sx) + vec3(0.0, (' + IMP_Y0.toFixed(3) + ' + position.y * ' + IMP_H.toFixed(3) + ') * sy + bob + hop + rise, 0.0);',
    ' vec3 cc = vec3(1.0);',
    '#ifdef USE_INSTANCING_COLOR',
    ' cc = instanceColor.xyz;',
    '#endif',
    ' float dk = vbCrowdFall(ip);',
    ' vShirt = vbCrowdTone(cc, ip); vSkin = vbCrowdTone(aSkin, ip);',
    ' vHair = aHair * dk; vPants = aPants * dk;',
    ' vec4 mvPosition = viewMatrix * vec4(wp, 1.0); gl_Position = projectionMatrix * mvPosition; vHazeD = -mvPosition.z;',
    '#include <fog_vertex>',
    '}'].join('\n');
  var IMP_FS = [
    CROWD_HAZE_FS + 'uniform sampler2D uAtlas; uniform vec3 uLight;',
    'varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying vec3 vPants;',
    '#include <fog_pars_fragment>',
    'void main(){',
    ' vec4 m = texture2D(uAtlas, vUv);',
    ' if (m.a < 0.3) discard;',
    ' float s = texture2D(uAtlas, vUv - vec2(0.0, 0.5)).r;',
    ' float pw = clamp(1.0 - m.r - m.g - m.b, 0.0, 1.0);',
    ' vec3 c = (m.r * vShirt + m.g * vSkin + m.b * vHair + pw * vPants) * s * uLight;',
    ' gl_FragColor = vec4(c, 1.0);',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    CROWD_HAZE_APPLY + '#include <fog_fragment>',
    '}'].join('\n');
  function buildImpostors(IM) {
    var n = IM.imp.length / 2; if (!n) return;
    imp.cv = impAtlas();
    imp.tex = new THREE.CanvasTexture(imp.cv); // máscaras y sombreado son DATOS (sin sRGB)
    imp.tex.generateMipmaps = true; imp.tex.minFilter = THREE.LinearMipmapLinearFilter;
    imp.U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uLight: { value: new THREE.Vector3(1, 1, 1) },
      uDens: { value: 1 }, uSkipNear: { value: 0 } }]);
    imp.U.uAtlas.value = imp.tex;
    for (var k in crowdU) imp.U[k] = crowdU[k]; // mismos uniformes de animación que el público 3D (objetos compartidos)
    var mat = new THREE.ShaderMaterial({ uniforms: imp.U, vertexShader: IMP_VS, fragmentShader: IMP_FS, fog: true });
    var geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(IM.anim), 4));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(new Float32Array(IM.skin), 3));
    geo.setAttribute('aHair', new THREE.InstancedBufferAttribute(new Float32Array(IM.hair), 3));
    geo.setAttribute('aPants', new THREE.InstancedBufferAttribute(new Float32Array(IM.pants), 3));
    geo.setAttribute('aImp', new THREE.InstancedBufferAttribute(new Float32Array(IM.imp), 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 45);
    var mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.array.set(IM.mat);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(IM.col), 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'crowdImp';
    root.add(mesh); imp.mesh = mesh;
  }
  // bolsas de afición visitante (coords de sim): grupos compactos de azul en la grada rival
  var AWAY_POCKETS = [[-12, -15.5, 4.2], [-22, 15, 3.6], [-21.5, 4.5, 3.4], [6, 16.5, 2.6]];
  var crowdGeos = { hi: null, lo: null }, flagMesh = null;
  function buildCrowd(seats) {
    crowdGeos.hi = crowdGeometry(true); crowdGeos.lo = crowdGeometry(false);
    var mat = crowdMaterial();
    var c = new THREE.Color();
    var flagSeats = [];
    crowdHeads.length = 0;
    var IM = { mat: [], col: [], anim: [], skin: [], hair: [], pants: [], imp: [] }; // datos del público "impostor" (todas las gradas)
    function shuffle(l) { for (var i = l.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = l[i]; l[i] = l[j]; l[j] = t; } }
    for (var m = 0; m < 4; m++) {
      // filas cercanas primero y lejanas después, cada grupo barajado (para que `count` reducido quite gente
      // repartida) y aforo ~88 %. En calidad media la malla 3D dibuja solo las cercanas (count = cercanas) y las
      // lejanas van como impostores; en baja todo es impostor; en alta, todo 3D como siempre.
      var nearRows = m < 2 ? NEAR_L : NEAR_E, nearL = [], farL = [];
      for (var si = 0; si < seats[m].length; si++) (seats[m][si].row < nearRows ? nearL : farL).push(seats[m][si]);
      shuffle(nearL); shuffle(farL);
      var nn = Math.floor(nearL.length * 0.88), nf = Math.floor(farL.length * 0.88);
      var list = nearL.slice(0, nn).concat(farL.slice(0, nf));
      var n = nn + nf;
      var anim = new Float32Array(n * 4), skin = new Float32Array(n * 3), hair = new Float32Array(n * 3), pants = new Float32Array(n * 3), acc = new Float32Array(n * 4);
      var mesh = new THREE.InstancedMesh(crowdGeos.hi, mat, n);
      var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9;
      for (var k = 0; k < n; k++) {
        var st = list[k];
        // afición en BLOQUES: el fondo +x (detrás del saque local) es la grada de animación local, naranja y arena; en el
        // fondo rival, un bloque visitante azul en las secciones centrales y neutros oscuros a los lados; en las
        // laterales, la mitad +x tira a local y la -x a neutra, con bolsas visitantes compactas.
        var home = st.x > 2 ? 0.6 : st.x < -2 ? 0.18 : 0.4, away = st.x < -2 ? 0.08 : st.x > 2 ? 0.02 : 0.05;
        if (m === 2) { home = 0.86; away = 0.02; }
        if (m === 3) { var cen = Math.abs(st.y) < 5.0; home = cen ? 0.04 : 0.14; away = cen ? 0.86 : 0.06; }
        for (var pk = 0; pk < AWAY_POCKETS.length; pk++) {
          var P = AWAY_POCKETS[pk], pd = Math.hypot(st.x - P[0], st.y - P[1]);
          if (pd < P[2]) { var pw = 1 - pd / P[2]; away = Math.max(away, 0.55 + 0.35 * pw); home = Math.min(home, 0.08); }
        }
        var rr = rnd(), team = rr < away ? 1 : rr < away + home ? 0 : 0.5;
        if (st.press) team = 0.5;
        var shirt = st.press ? pick(PRESS_SHIRTS) : team === 0 ? pick(SHIRTS.t0) : team === 1 ? pick(SHIRTS.t1) : (st.row < 5 && rnd() < 0.3 ? pick(SHIRTS.nLight) : pick(SHIRTS.n));
        c.set(shirt).multiplyScalar(0.78 + rnd() * 0.24);
        // ARN-02: los bloques de afición (camisetas de equipo) van algo más apagados que los neutros (≈ −7 % de croma extra)
        var sdz = team === 0.5 ? SHIRT_DESAT : SHIRT_DESAT_TEAM;
        var lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114; c.r += (lum - c.r) * sdz; c.g += (lum - c.g) * sdz; c.b += (lum - c.b) * sdz;
        mesh.setColorAt(k, c);
        var sk = pick(SKINS); c.set(sk); skin[k * 3] = c.r; skin[k * 3 + 1] = c.g; skin[k * 3 + 2] = c.b;
        // pelo (un 6 % calvos: pelo = piel algo más oscura)
        if (rnd() < 0.06) c.set(sk).multiplyScalar(0.85); else c.set(pick(HAIRS));
        hair[k * 3] = c.r; hair[k * 3 + 1] = c.g; hair[k * 3 + 2] = c.b;
        c.set(pick(PANTS)); pants[k * 3] = c.r; pants[k * 3 + 1] = c.g; pants[k * 3 + 2] = c.b;
        // bufandas de la afición (más en los fondos)
        var scarf = team !== 0.5 && !st.press && rnd() < (m >= 2 ? 0.26 : 0.14);
        if (scarf) { c.set(team === 0 ? pick(['#ff6b3d', '#ffd23f', '#ff8a3d']) : pick(['#3f8cff', '#f2f4f8', '#2c63d6'])); acc[k * 4] = c.r; acc[k * 4 + 1] = c.g; acc[k * 4 + 2] = c.b; acc[k * 4 + 3] = 1; }
        anim[k * 4] = rnd() * 6.283; anim[k * 4 + 1] = st.press ? 0.06 : 0.55 + rnd() * 0.45; anim[k * 4 + 2] = team; // prensa: no salta
        anim[k * 4 + 3] = Math.atan2(st.y, st.x) / 6.2832 + 0.5;
        // complexión: 4 % niños; anchura y altura variables
        var kid = rnd() < 0.04, sh = kid ? 0.78 : 0.92 + rnd() * 0.16, sw = kid ? 0.8 : 0.9 + rnd() * 0.24;
        var yaw = Math.atan2(st.fx, -st.fy);
        VB.toThree(st.x, st.y, st.z, _p); _e.set(0, yaw + (rnd() - 0.5) * 0.25, 0); _q.setFromEuler(_e); _s.set(sw, sh, (sw + 1) / 2);
        _m.compose(_p, _q, _s); mesh.setMatrixAt(k, _m);
        // impostor: misma persona (colores, animación), cartel orientado a cámara en el shader
        _q.identity(); _s.set(sw, sh, 1); _m4i.compose(_p, _q, _s);
        for (var me4 = 0; me4 < 16; me4++) IM.mat.push(_m4i.elements[me4]);
        mesh.getColorAt(k, c); IM.col.push(c.r, c.g, c.b);
        IM.anim.push(anim[k * 4], anim[k * 4 + 1], anim[k * 4 + 2], anim[k * 4 + 3]);
        IM.skin.push(skin[k * 3], skin[k * 3 + 1], skin[k * 3 + 2]); IM.hair.push(hair[k * 3], hair[k * 3 + 1], hair[k * 3 + 2]);
        IM.pants.push(pants[k * 3], pants[k * 3 + 1], pants[k * 3 + 2]);
        IM.imp.push(rnd(), k < nn ? 1 : 0);
        if (_p.x < minx) minx = _p.x; if (_p.x > maxx) maxx = _p.x; if (_p.y < miny) miny = _p.y; if (_p.y > maxy) maxy = _p.y; if (_p.z < minz) minz = _p.z; if (_p.z > maxz) maxz = _p.z;
        if (k % 23 === 0) crowdHeads.push(_p.x, _p.y + 0.95, _p.z);
        // banderas: algunos aficionados de equipo, a partir de la 3.ª fila
        if (team !== 0.5 && !kid && _p.y > 2.0 && rnd() < (m >= 2 ? 0.03 : 0.014)) flagSeats.push({ m: _m.clone(), team: team, a: k * 4, anim: anim });
      }
      var geo = crowdGeos.hi; // los atributos por instancia van en un clon por grada; las dos LOD comparten los mismos buffers
      var ga = { aAnim: new THREE.InstancedBufferAttribute(anim, 4), aSkin: new THREE.InstancedBufferAttribute(skin, 3), aHair: new THREE.InstancedBufferAttribute(hair, 3),
        aPants: new THREE.InstancedBufferAttribute(pants, 3), aAcc: new THREE.InstancedBufferAttribute(acc, 4) };
      var bs = new THREE.Sphere(new THREE.Vector3((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2), Math.hypot(maxx - minx, maxy - miny, maxz - minz) / 2 + 1.5);
      var lods = {};
      ['hi', 'lo'].forEach(function (lv) {
        var g = new THREE.BufferGeometry(), src = crowdGeos[lv];
        g.setAttribute('position', src.attributes.position); g.setAttribute('normal', src.attributes.normal); g.setAttribute('color', src.attributes.color); g.setIndex(src.index);
        for (var an in ga) g.setAttribute(an, ga[an]);
        g.boundingSphere = bs; lods[lv] = g;
      });
      mesh.geometry = lods.hi;
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.full = n; mesh.userData.near = nn; mesh.userData.lods = lods; mesh.name = 'crowd' + m;
      // r149 crea los InstancedMesh con frustumCulled = false; la esfera (mundo, +1,5 m para botes/brazos/ola)
      // es correcta: la grada que queda detrás de la cámara deja de dibujarse
      mesh.frustumCulled = true;
      root.add(mesh); crowdMeshes.push(mesh);
    }
    buildImpostors(IM);
    // banderas
    if (flagSeats.length) {
      var fg = flagGeometry(), fn = flagSeats.length;
      var fAnim = new Float32Array(fn * 4), fAcc = new Float32Array(fn * 4);
      flagMesh = new THREE.InstancedMesh(fg, flagMaterial(), fn);
      for (var f = 0; f < fn; f++) {
        var F = flagSeats[f];
        for (var q = 0; q < 4; q++) fAnim[f * 4 + q] = F.anim[F.a + q];
        // mástil en la mano derecha del aficionado
        _v.set(0.2, 0, 0.12).applyMatrix4(F.m); F.m.setPosition(_v);
        flagMesh.setMatrixAt(f, F.m);
        fAcc[f * 4] = (F.team === 0 ? 0 : 4) + Math.floor(rnd() * 4) % 4; // bandera del atlas (0-3 local, 4-7 visitante)
      }
      fg.setAttribute('aAnim', new THREE.InstancedBufferAttribute(fAnim, 4)); fg.setAttribute('aAcc', new THREE.InstancedBufferAttribute(fAcc, 4));
      fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 40); // abarca todo el pabellón: frustumCulled se queda en false
      flagMesh.instanceMatrix.needsUpdate = true; flagMesh.name = 'flags';
      root.add(flagMesh);
    }
  }

  /* =====================================================================
   * VALLAS LED (marcas ficticias) y mensajes de partido
   * ===================================================================== */
  var BRANDS = [
    { name: 'NÓRDIKA', fg: '#ffd23f', bg: ['#0d1b2a', '#16324f'], deco: 'flake' },
    { name: 'VOLTA', fg: '#ffffff', bg: ['#ff5b3a', '#ff8a3d'], deco: 'bolt' },
    { name: 'ALBA·SPORT', fg: '#0d1b2a', bg: ['#7ee0c3', '#bff3e2'], deco: 'sun' },
    { name: 'MARINA FM', fg: '#ffffff', bg: ['#2a55c9', '#3f7cf0'], deco: 'wave' },
    { name: 'PALAU DEL MAR', fg: '#ffffff', bg: ['#0b3a4f', '#146a86'], deco: 'wave' },
    { name: 'TERRA', fg: '#ffd23f', bg: ['#2a1a0d', '#4a2f17'], deco: 'leaf' },
    { name: 'SALT·9', fg: '#ffffff', bg: ['#0e1118', '#252b38'], deco: 'dots' },
    { name: 'MAKE THE CUT', fg: '#0e1118', bg: ['#ffd23f', '#ffb03d'], deco: 'ball' }
  ];
  var led = { cv: null, tex: null, mcv: null, mtex: null, mat: null, mesh: null, reflMat: null, refl: null, msgT: 0, msgOn: false, scrollT: 0, scrollM: 0, w: 0, pend: null };
  function drawDeco(g, kind, x, y, h, color) {
    g.save(); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = h * 0.08;
    if (kind === 'flake') { for (var i = 0; i < 3; i++) { g.save(); g.translate(x, y); g.rotate(i * Math.PI / 3); g.beginPath(); g.moveTo(-h * 0.32, 0); g.lineTo(h * 0.32, 0); g.stroke(); g.restore(); } }
    else if (kind === 'bolt') { g.beginPath(); g.moveTo(x + h * 0.1, y - h * 0.38); g.lineTo(x - h * 0.16, y + h * 0.05); g.lineTo(x + h * 0.02, y + h * 0.05); g.lineTo(x - h * 0.1, y + h * 0.38); g.lineTo(x + h * 0.18, y - h * 0.06); g.lineTo(x, y - h * 0.06); g.closePath(); g.fill(); }
    else if (kind === 'sun') { g.beginPath(); g.arc(x, y + h * 0.15, h * 0.22, Math.PI, 0); g.fill(); for (var k = 0; k < 5; k++) { var a = Math.PI + (k + 0.5) * Math.PI / 5; g.beginPath(); g.moveTo(x + Math.cos(a) * h * 0.28, y + h * 0.15 + Math.sin(a) * h * 0.28); g.lineTo(x + Math.cos(a) * h * 0.4, y + h * 0.15 + Math.sin(a) * h * 0.4); g.stroke(); } }
    else if (kind === 'wave') { for (var w = 0; w < 2; w++) { g.beginPath(); for (var t = 0; t <= 20; t++) { var xx = x - h * 0.35 + t * h * 0.035, yy = y - h * 0.08 + w * h * 0.2 + Math.sin(t / 20 * Math.PI * 3) * h * 0.07; if (t) g.lineTo(xx, yy); else g.moveTo(xx, yy); } g.stroke(); } }
    else if (kind === 'leaf') { g.beginPath(); g.moveTo(x, y - h * 0.35); g.quadraticCurveTo(x + h * 0.3, y, x, y + h * 0.35); g.quadraticCurveTo(x - h * 0.3, y, x, y - h * 0.35); g.fill(); }
    else if (kind === 'dots') { for (var dx = 0; dx < 3; dx++) for (var dy = 0; dy < 3; dy++) { g.beginPath(); g.arc(x + (dx - 1) * h * 0.18, y + (dy - 1) * h * 0.18, h * 0.05, 0, 6.283); g.fill(); } }
    else if (kind === 'cut') { for (var c2 = 0; c2 < 2; c2++) { g.beginPath(); g.moveTo(x - h * 0.3 + c2 * h * 0.26, y + h * 0.36); g.lineTo(x - h * 0.06 + c2 * h * 0.26, y - h * 0.36); g.lineTo(x + h * 0.08 + c2 * h * 0.26, y - h * 0.36); g.lineTo(x - h * 0.16 + c2 * h * 0.26, y + h * 0.36); g.fill(); } }
    else if (kind === 'ball') drawGameBall(g, x, y, h * 0.37);
    g.restore();
  }
  /* Balón del juego (el mismo de pages/icon.svg y del botón GOLPEAR, ICON_HIT de input.js): tres costuras en remolino desde el
   * centro y una franja curva por panel (naranja y azul; el tercero, crema), con contorno de tinta. Geometría en la caja 24×24
   * del SVG (radio 10), escalada a radio r. Sin Path2D(string) (navegadores viejos): el balón de antes, de arcos. */
  var BALL_SEAM = 'M12 12C12 8 10.5 4.5 8 2.8M13.8 2.2C16.5 5.5 17.8 9.5 17.3 13.8';
  var BALL_PANEL = 'M12 12C12 8 10.5 4.5 8 2.8A10 10 0 0 1 13.8 2.2C16.5 5.5 17.8 9.5 17.3 13.8C15.98 13.86 13.73 13 12 12Z';
  function drawGameBall(g, x, y, r) {
    var s = r / 10, ink = '#140d26';
    var P = typeof Path2D !== 'undefined' ? Path2D : null, seam = null, panel = null;
    try { seam = P && new P(BALL_SEAM); panel = P && new P(BALL_PANEL); } catch (e) { seam = panel = null; }
    if (!seam || !panel) { g.beginPath(); g.arc(x, y, r * 0.8, 0, 6.283); g.stroke(); return; }
    g.save();
    g.translate(x, y); g.scale(s, s); g.translate(-12, -12);
    g.beginPath(); g.arc(12, 12, 10, 0, 6.283); g.fillStyle = '#fff6e6'; g.fill();
    var fills = ['#ff6a2e', '#3a83ff'];
    for (var i = 0; i < 2; i++) { g.save(); g.translate(12, 12); g.rotate(i * 2.0944); g.translate(-12, -12); g.fillStyle = fills[i]; g.fill(panel); g.restore(); }
    g.strokeStyle = ink; g.lineWidth = 1.3; g.lineCap = 'round'; g.lineJoin = 'round';
    for (var j = 0; j < 3; j++) { g.save(); g.translate(12, 12); g.rotate(j * 2.0944); g.translate(-12, -12); g.stroke(seam); g.restore(); }
    g.beginPath(); g.arc(12, 12, 10, 0, 6.283); g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.arc(12, 12, 7.6, 3.6, 4.15); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1; g.stroke();   // brillo
    g.restore();
  }
  function drawBrands(cv) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, seg = W / BRANDS.length;
    for (var i = 0; i < BRANDS.length; i++) {
      var b = BRANDS[i], x0 = i * seg, gr = g.createLinearGradient(x0, 0, x0 + seg, 0);
      gr.addColorStop(0, b.bg[0]); gr.addColorStop(1, b.bg[1]); g.fillStyle = gr; g.fillRect(x0, 0, seg, H);
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x0, 0, seg, H * 0.12);
      drawDeco(g, b.deco, x0 + H * 0.62, H * 0.5, H, b.fg);
      g.fillStyle = b.fg; g.textAlign = 'left'; g.textBaseline = 'middle';
      var fs = Math.round(H * 0.6); g.font = 'italic 900 ' + fs + 'px ' + FONT;
      while (g.measureText(b.name).width > seg - H * 1.6 && fs > 10) { fs -= 2; g.font = 'italic 900 ' + fs + 'px ' + FONT; }
      g.fillText(b.name, x0 + H * 1.15, H * 0.54);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + seg - 2, 0, 2, H);
    }
    // la rejilla de píxeles LED la pinta el shader (ledMaterial): en el canvas producía moiré al mipmapear
  }
  /** Mensaje LED que se repite a lo largo de la valla. both = flechas a los dos lados (cambio de campo: <<< TEXTO >>>). */
  function drawMsg(cv, text, color, both) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height;
    var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, color); gr.addColorStop(1, '#0b0f18');
    g.fillStyle = '#0b0f18'; g.fillRect(0, 0, W, H);
    g.fillStyle = gr; g.globalAlpha = 0.85; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    g.font = 'italic 900 ' + Math.round(H * 0.66) + 'px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'left';
    // floor y no ceil: el reparto exacto solo puede AGRANDAR el hueco (con ceil encogía la unidad y el texto pisaba las
    // flechas y la repetición siguiente: «PUNTO DE SETPUNTO DE SET»)
    var unit = g.measureText(text).width + H * (both ? 3.6 : 2.2), n = Math.max(1, Math.floor(W / unit));
    unit = W / n; // repetición exacta: la textura enlaza sin costura
    for (var i = 0; i < n; i++) {
      var x = i * unit;
      g.fillStyle = '#ffffff'; g.fillText(text, x + H * (both ? 1.9 : 0.6), H * 0.55);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (var c = 0; c < 3; c++) { var cx = x + unit - H * 1.35 + c * H * 0.32; g.beginPath(); g.moveTo(cx, H * 0.25); g.lineTo(cx + H * 0.18, H * 0.5); g.lineTo(cx, H * 0.75); g.lineTo(cx + H * 0.08, H * 0.5); g.closePath(); g.fill(); }
      if (both) for (var c2 = 0; c2 < 3; c2++) { var lx = x + H * 1.35 - c2 * H * 0.32; g.beginPath(); g.moveTo(lx, H * 0.25); g.lineTo(lx - H * 0.18, H * 0.5); g.lineTo(lx, H * 0.75); g.lineTo(lx - H * 0.08, H * 0.5); g.closePath(); g.fill(); }
    }
  }
  /* Material LED común (vallas, videomarcadores, marcador colgado). Una sola textura por lienzo,
   * compartida por todas las vallas: la repetición, la fase y el desplazamiento van en uniformes.
   * La retícula de LEDs se dibuja aquí con fwidth y se apaga cuando cada LED ocupa < ~3 px
   * (antes era una raya de 1 px en el canvas que producía moiré a distancia de juego). */
  var LED_VS = 'varying vec2 vUv;\n#include <fog_pars_vertex>\nvoid main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}';
  var LED_FS = [
    'uniform sampler2D map; uniform float rep; uniform float phase; uniform float scroll; uniform float boost; uniform float dotK; uniform float vis; uniform vec2 cells;',
    'varying vec2 vUv;',
    '#include <fog_pars_fragment>',
    'void main(){',
    ' vec2 uv = vec2(vUv.x * rep + phase + scroll, vUv.y);',
    ' vec3 c = texture2D(map, uv).rgb;',
    ' vec2 gc = uv * cells; vec2 fw = fwidth(gc);',
    ' float fade = (1.0 - smoothstep(0.16, 0.36, max(fw.x, fw.y))) * dotK;',
    ' vec2 f = abs(fract(gc) - 0.5);',
    ' float d = smoothstep(0.5, 0.3, max(f.x, f.y * 1.15));',
    ' c *= mix(1.0, 0.42 + 0.72 * d, fade);',
    ' gl_FragColor = vec4(c * boost * vis, 1.0);',
    '#include <encodings_fragment>',
    '#include <fog_fragment>',
    '}'].join('\n');
  function ledMaterial(map, rep, cellsX, cellsY, fog) {
    var u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null }, rep: { value: rep }, phase: { value: 0 }, scroll: { value: 0 }, boost: { value: 0.95 }, vis: { value: 1 },
      dotK: { value: 1 }, cells: { value: new THREE.Vector2(cellsX, cellsY) } }]);
    u.map.value = map; // merge clona los valores: la textura se asigna después para compartirla de verdad
    var m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: LED_VS, fragmentShader: LED_FS, fog: fog !== false, toneMapped: false });
    m.extensions.derivatives = true;
    return m;
  }
  function ledTex(cv) { var t = texOf(cv); t.wrapS = THREE.RepeatWrapping; return t; }
  /* Vallas LED fusionadas: TODAS las vallas (4 de suelo, frontal de la mesa y 4 anillos de grada) son UNA malla
   * con UN material (antes 9 mallas y 9 materiales: 9 dibujos) y sus 4 reflejos en el suelo otra (antes 4).
   * Lo que antes eran uniformes por valla (repetición de marcas y de mensaje, fase, velocidad de desplazamiento,
   * retícula de LEDs) va en atributos por vértice; el desplazamiento es fract(velocidad * scrollT), con
   * scrollT acumulado en JS (x6 durante un mensaje) y envuelto en 500 (todas las velocidades x 500 son enteras). */
  var LEDM_VS = [
    'attribute vec4 aLed; attribute vec3 aCells; uniform float scrollT; uniform float scrollM;',
    'varying vec2 vUv; varying float vUb; varying float vUm; varying vec2 vCells; varying float vLedK;',
    '#include <fog_pars_vertex>',
    'void main(){ vUv = uv; vCells = aCells.xy; vLedK = aCells.z;',
    // marcas (aLed.x repeticiones, fase aLed.z, desplazamiento lento) y mensaje (aLed.y repeticiones, desplazamiento x6)
    ' vUb = uv.x * aLed.x + aLed.z + fract(aLed.w * scrollT);',
    ' vUm = uv.x * aLed.y + fract(aLed.w * scrollM);',
    ' vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;',
    '#include <fog_vertex>',
    '}'].join('\n');
  /* Cambio marcas <-> mensaje con una cortina (msgW 0..1) que barre cada valla de izquierda a derecha con un filo de luz
   * (edgeK; 0,4 con «destellos suaves»). Antes el mensaje sustituía a las marcas de golpe en un frame. */
  var LEDM_FS = [
    'uniform sampler2D map; uniform sampler2D mmap; uniform float boost; uniform float dotK; uniform vec4 tint; uniform float msgW; uniform float edgeK;',
    'varying vec2 vUv; varying float vUb; varying float vUm; varying vec2 vCells; varying float vLedK;',
    '#include <fog_pars_fragment>',
    'void main(){',
    ' vec3 cb = texture2D(map, vec2(vUb, vUv.y)).rgb;',
    ' vec3 cm = texture2D(mmap, vec2(vUm, vUv.y)).rgb;',
    ' float e = msgW * 1.24 - 0.12; float wk = 1.0 - smoothstep(e - 0.05, e + 0.05, vUv.x);',
    ' vec3 c = mix(cb, cm, wk);',
    ' c += vec3(1.0, 0.97, 0.9) * edgeK * 0.55 * max(0.0, 1.0 - abs(vUv.x - e) / 0.035);',
    ' vec2 gc = vec2(vUb, vUv.y) * vCells; vec2 fw = fwidth(gc);',
    ' float fade = (1.0 - smoothstep(0.16, 0.36, max(fw.x, fw.y))) * dotK;',
    ' vec2 f = abs(fract(gc) - 0.5);',
    ' float d = smoothstep(0.5, 0.3, max(f.x, f.y * 1.15));',
    ' c *= mix(1.0, 0.42 + 0.72 * d, fade);',
    // ARN-08: tinte del equipo que tiene el punto de set/partido (latido lento): las marcas se tiñen sin perder lectura
    ' c = mix(c, c * tint.rgb * 1.35 + tint.rgb * 0.1, tint.a);',
    ' gl_FragColor = vec4(c * boost * vLedK, 1.0);',
    '#include <encodings_fragment>',
    '#include <fog_fragment>',
    '}'].join('\n');
  /* Malla de «luz de las vallas» (una sola para todo): aCells.x = tipo de tarjeta. 0 = reflejo falso en el suelo (degradado
   * desde la valla, color al cuadrado); 1 / 2 = halo de la valla por su borde superior / inferior (ARN-12): tarjeta en el plano
   * de la pantalla que se apaga hacia fuera, con el color MEDIO del tramo de valla que tiene al lado (mip muy bajo: misma
   * marca que se ve, o el color del equipo con un mensaje). reflK / glowK encienden cada familia por calidad. */
  var LEDR_VS = 'attribute vec4 aLed; attribute vec3 aCells; uniform float scrollT; uniform float scrollM; varying vec2 vUv; varying float vUb; varying float vUm; varying vec2 vKind;' +
    'void main(){ vUv = uv; vKind = aCells.xz; vUb = uv.x * aLed.x + aLed.z + fract(aLed.w * scrollT); vUm = uv.x * aLed.y + fract(aLed.w * scrollM);' +
    ' gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var LEDR_FS = 'uniform sampler2D map; uniform sampler2D mmap; uniform float msgW; uniform float k; uniform float reflK; uniform float glowK; uniform float glassK; varying vec2 vUv; varying float vUb; varying float vUm; varying vec2 vKind;' +
    'void main(){ if (vKind.x > 2.5) { float gy = vUv.y; float st = 1.0 - smoothstep(0.0, 0.07, abs(fract(vUb * 0.9 - gy * 0.32) - 0.5) - 0.18);' +
    ' float ga = (0.004 + 0.016 * gy * gy * gy + 0.01 * st * gy) * glassK; gl_FragColor = linearToOutputTexel(vec4(vec3(0.62, 0.78, 1.0) * ga, 1.0)); return; }' +
    ' if (vKind.x < 0.5) { float y = 1.0 - vUv.y * 0.9; vec3 c = mix(texture2D(map, vec2(vUb, y)).rgb, texture2D(mmap, vec2(vUm, y)).rgb, msgW);' +
    ' float f = pow(1.0 - vUv.y, 2.2); gl_FragColor = vec4(c * c * f * k * reflK, 1.0); return; }' +
    // halo: color medio del tramo (3 muestras de mip alto repartidas a lo ancho: sin «código de barras» de cerca)
    ' vec3 g = (texture2D(map, vec2(vUb - 0.022, 0.5), 7.5).rgb + texture2D(map, vec2(vUb, 0.5), 7.5).rgb + texture2D(map, vec2(vUb + 0.022, 0.5), 7.5).rgb) / 3.0;' +
    ' vec3 gm = (texture2D(mmap, vec2(vUm - 0.03, 0.5), 7.5).rgb + texture2D(mmap, vec2(vUm, 0.5), 7.5).rgb + texture2D(mmap, vec2(vUm + 0.03, 0.5), 7.5).rgb) / 3.0;' +
    ' g = mix(g, gm, msgW);' +
    ' float v = vKind.x < 1.5 ? vUv.y : 1.0 - vUv.y; float a = pow(1.0 - v, 1.7);' +
    ' float sx = smoothstep(0.0, 0.015, vUv.x) * smoothstep(1.0, 0.985, vUv.x);' +
    ' gl_FragColor = linearToOutputTexel(vec4(g * a * sx * glowK * vKind.y, 1.0)); }';
  /** Acumulador de una malla fusionada de vallas: plano (len x h) colocado con (pos, giro) + atributos por valla. */
  function LedBatch() { this.P = []; this.U = []; this.L = []; this.Cc = []; this.I = []; this.n = 0; }
  LedBatch.prototype.add = function (len, h, pos, rx, ry, a4, cells) {
    var g = new THREE.PlaneGeometry(len, h), pa = g.attributes.position, ua = g.attributes.uv, ia = g.index.array;
    _e.set(rx, ry, 0, 'YXZ'); _q.setFromEuler(_e); _s.set(1, 1, 1); _m.compose(pos, _q, _s);
    for (var v = 0; v < pa.count; v++) {
      _v.fromBufferAttribute(pa, v).applyMatrix4(_m); this.P.push(_v.x, _v.y, _v.z); this.U.push(ua.getX(v), ua.getY(v));
      this.L.push(a4[0], a4[1], a4[2], a4[3]); this.Cc.push(cells[0], cells[1], cells[2] == null ? 1 : cells[2]);
    }
    for (var j = 0; j < ia.length; j++) this.I.push(ia[j] + this.n);
    this.n += pa.count; g.dispose();
  };
  LedBatch.prototype.build = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('aLed', new THREE.Float32BufferAttribute(this.L, 4)); g.setAttribute('aCells', new THREE.Float32BufferAttribute(this.Cc, 3));
    g.setIndex(this.I); g.computeBoundingSphere(); return g;
  };
  /** Valla LED. (cx,cy) centro en sim, len a lo largo, normal hacia la pista (nx,ny).
   *  Las de suelo van inclinadas hacia atrás (-0.16 rad) dentro de una carcasa inclinada igual:
   *  la pantalla queda 1,5 cm por delante de su cara frontal (antes quedaba medio enterrada).
   *  refl: añade su reflejo falso en el suelo brillante (tira aditiva con degradado). */
  function ledBoard(S, cx, cy, len, nx, ny, h, z0, speed, rows, refl, glow) {
    var meterPerSeg = h * (led.cv.width / BRANDS.length) / led.cv.height;
    var repB = len / (meterPerSeg * BRANDS.length), repM = len / (h * led.mcv.width / led.mcv.height);
    var cellsY = Math.round(h / 0.016), cellsX = Math.round(cellsY * led.cv.width / led.cv.height);
    var ry = Math.atan2(nx, -ny), rx = rows ? 0 : -0.16, pos = new THREE.Vector3();
    _e.set(rx, ry, 0, 'YXZ'); _v.set(0, 1, 0).applyEuler(_e); _v2.set(0, 0, 1).applyEuler(_e);
    if (rows) VB.toThree(cx + nx * 0.07, cy + ny * 0.07, z0 + h / 2, pos);
    else {
      // borde inferior a 12 cm por delante de la línea de vallas; el centro sube por el plano inclinado
      VB.toThree(cx + nx * 0.12, cy + ny * 0.12, z0, pos); pos.addScaledVector(_v, h / 2);
      var d = 0.32, w = len + 0.1, hh = h + 0.14;
      // carcasa: misma inclinación, cara frontal 1,5 cm detrás de la pantalla
      S.box(w, hh, d, pos.x - _v2.x * (d / 2 + 0.015), pos.y - _v2.y * (d / 2 + 0.015) - 0.02, pos.z - _v2.z * (d / 2 + 0.015), col('#0a0d12'), ry, rx);
      // remate superior iluminado (filo de luz fría) y zócalo
      S.box(w, 0.035, d + 0.02, pos.x - _v2.x * (d / 2) + _v.x * (hh / 2), pos.y + _v.y * (hh / 2) - 0.02, pos.z - _v2.z * (d / 2) + _v.z * (hh / 2), col('#1a2230'), ry, rx);
    }
    var a4 = [repB, repM, rnd(), speed], cells = [cellsX, cellsY, rows && z0 > 3 ? 0.62 : 1]; // anillos altos más tenues: no deslumbran sobre la grada
    led.batch.add(len, h, pos, rx, ry, a4, cells);
    // halo (ARN-12): tarjeta en el plano de la pantalla, 1,2 cm por delante, pegada al borde superior (y al inferior en las de grada)
    if (glow) {
      _e.set(rx, ry, 0, 'YXZ'); var up = new THREE.Vector3(0, 1, 0).applyEuler(_e), nv = new THREE.Vector3(0, 0, 1).applyEuler(_e), gp = new THREE.Vector3();
      var gk = cells[2], gt = rows ? 0.42 : 0.62;
      gp.copy(pos).addScaledVector(up, h / 2 + gt / 2).addScaledVector(nv, 0.012); led.rbatch.add(len, gt, gp, rx, ry, a4, [1, 0, gk]);
      if (rows) { gp.copy(pos).addScaledVector(up, -h / 2 - 0.17).addScaledVector(nv, 0.012); led.rbatch.add(len, 0.34, gp, rx, ry, a4, [2, 0, gk]); }
    }
    if (refl) { VB.toThree(cx + nx * 0.92, cy + ny * 0.92, 0.004, pos); led.rbatch.add(len, 1.6, pos, -Math.PI / 2, ry, a4, [0, 0, 1]); }
  }
  function buildLED(S) {
    var hi = !ctx.isMobile;
    led.cv = canvas(hi ? 4096 : 2048, hi ? 128 : 64); drawBrands(led.cv);
    led.mcv = canvas(hi ? 2048 : 1024, hi ? 128 : 64); drawMsg(led.mcv, 'PALAU DEL MAR', '#146a86');
    // UNA textura por lienzo para todas las vallas (antes 9 copias de 4096x128 con mipmaps, ~25 MB)
    led.tex = ledTex(led.cv); led.mtex = ledTex(led.mcv);
    led.batch = new LedBatch(); led.rbatch = new LedBatch();
    var h = 0.86;
    ledBoard(S, 0, BY, 2 * FZX, 0, -1, h, 0.04, 0.012, false, true, true);
    ledBoard(S, 0, -BY, 2 * FZX, 0, 1, h, 0.04, -0.012, false, true, true);
    ledBoard(S, BX, 0, 2 * FZY, -1, 0, h, 0.04, 0.016, false, true, true);
    ledBoard(S, -BX, 0, 2 * FZY, 1, 0, h, 0.04, -0.016, false, true, true);
    // frontal de la mesa del anotador
    ledBoard(S, 0, C.HW + 3.6 - 0.36, 2.7, 0, -1, 0.62, 0.06, 0.02, true);
    // anillos LED en lo alto de las gradas (ribbon boards)
    var yb = SY0 + ROWS_L * ROW_D, tb = 0.5 + ROWS_L * ROW_H;
    ledBoard(S, 0, yb, 2 * LATX, 0, -1, 0.75, tb + 0.9, -0.006, true, false, true);
    ledBoard(S, 0, -yb, 2 * LATX, 0, 1, 0.75, tb + 0.9, 0.006, true, false, true);
    var xb = SX0 + ROWS_E * ROW_D, tb2 = 0.5 + ROWS_E * ROW_H;
    ledBoard(S, xb, 0, 2 * ENDY + 0.8, -1, 0, 0.7, tb2 + 0.8, 0.008, true, false, true);
    ledBoard(S, -xb, 0, 2 * ENDY + 0.8, 1, 0, 0.7, tb2 + 0.8, -0.008, true, false, true);
    // uniformes compartidos por vallas y reflejos (mismos objetos)
    var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, mmap: { value: null }, msgW: { value: 0 }, edgeK: { value: 1 }, scrollT: { value: 0 }, scrollM: { value: 0 }, boost: { value: 0.95 },
      dotK: { value: 1 }, tint: { value: new THREE.Vector4(1, 1, 1, 0) } }]);
    U.map.value = led.tex; U.mmap.value = led.mtex;
    led.mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: LEDM_VS, fragmentShader: LEDM_FS, fog: true, toneMapped: false });
    led.mat.extensions.derivatives = true;
    led.mesh = new THREE.Mesh(led.batch.build(), led.mat); led.mesh.name = 'ledBoards'; led.mesh.frustumCulled = false; root.add(led.mesh);
    led.reflMat = new THREE.ShaderMaterial({ uniforms: { map: U.map, mmap: U.mmap, msgW: U.msgW, scrollT: U.scrollT, scrollM: U.scrollM, k: { value: 0.22 }, reflK: { value: 1 }, glowK: { value: 0 }, glassK: { value: 1 } }, vertexShader: LEDR_VS, fragmentShader: LEDR_FS,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    led.batch = null; // el lote de reflejos/halos se cierra en finishLedRefl (tras la grada: añade el vidrio de las barandillas)
  }
  function finishLedRefl() {
    led.refl = new THREE.Mesh(led.rbatch.build(), led.reflMat); led.refl.name = 'ledRefl'; led.refl.renderOrder = 1; led.refl.frustumCulled = false; root.add(led.refl);
    led.rbatch = null;
  }
  /** Pide un mensaje en las vallas: se dibuja en el lienzo del mensaje cuando la cortina está cerrada (si ya hay otro
   *  mensaje a la vista, primero se recoge) y luego la cortina lo descubre. led.msgOn = hay un mensaje pedido o a la vista. */
  function ledMessage(text, color, dur, both) {
    led.pend = [text, color, both]; led.msgT = dur; led.msgOn = true;
  }
  function setLedMode(on) { led.msgOn = on; if (!on) led.pend = null; }
  function updateLED(dt) {
    if (led.msgT > 0) { led.msgT -= dt; if (led.msgT <= 0) { if (led.next) { var ln = led.next; led.next = null; ledMessage(ln[0], ln[1], ln[2], ln[3]); } else setLedMode(false); } }
    var target = led.msgOn ? 1 : 0;
    if (led.pend) {
      if (led.w <= 0.001) { var P = led.pend; led.pend = null; drawMsg(led.mcv, P[0], P[1], P[2]); led.mtex.needsUpdate = true; } // una subida por mensaje
      else target = 0; // recoger el mensaje anterior antes de pintar el nuevo
    }
    // abrir en 0,38 s, recoger en 0,27 s (con dt = 0 en pausa se queda donde está)
    led.w = target > led.w ? Math.min(target, led.w + dt / 0.38) : Math.max(target, led.w - dt / 0.27);
    var w = led.w * led.w * (3 - 2 * led.w);
    led.scrollT = (led.scrollT + dt) % 500; led.scrollM = (led.scrollM + dt * 6) % 500;
    if (led.mat) {
      var U = led.mat.uniforms;
      U.scrollT.value = led.scrollT; U.scrollM.value = led.scrollM;
      if (U.msgW.value !== w) U.msgW.value = w;
      var ek = softK(); if (U.edgeK.value !== ek) U.edgeK.value = ek;
    }
  }

  /* =====================================================================
   * VIDEOMARCADORES (fondos) y MARCADOR CENTRAL COLGADO
   * ===================================================================== */
  var SB = { names: ['TÚ', 'CPU'], score: [0, 0], sets: [0, 0], setNo: 1, serving: 0, msg: '', msgSub: '', msgCol: '#ff6b3d', msgT: 0, tag: '', dirty: true };
  var screens = { big: null, bigTex: null, hung: null, hungTex: null, mats: [], vis: [], flash: 0, ranges: [], visU: null };
  function fitFont(g, text, weight, size, maxW) {
    g.font = weight + ' ' + Math.round(size) + 'px ' + FONT;
    var w = g.measureText(text).width;
    if (w > maxW) { size = size * maxW / w; g.font = weight + ' ' + Math.round(size) + 'px ' + FONT; }
    return size;
  }
  function drawSetDots(g, cx, cy, r, gap, t) {
    for (var k = 0; k < 2; k++) {
      g.beginPath(); g.arc(cx + (k - 0.5) * gap, cy, r, 0, 6.283);
      g.fillStyle = k < SB.sets[t] ? TEAMC[t] : 'rgba(255,255,255,0.16)'; g.fill();
    }
  }
  function drawMsgOverlay(g, W, H, top) {
    if (!(SB.msgT > 0 && SB.msg)) return;
    var by = top + (H - top) * 0.14, bh = (H - top) * 0.72, mid = W / 2;
    g.fillStyle = 'rgba(4,7,12,0.9)'; g.fillRect(0, by, W, bh);
    g.fillStyle = SB.msgCol; g.fillRect(0, by, W, H * 0.022); g.fillRect(0, by + bh - H * 0.022, W, H * 0.022);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
    fitFont(g, SB.msg, 'italic 900', bh * (SB.msgSub ? 0.46 : 0.6), W * 0.92);
    g.fillText(SB.msg, mid, by + bh * (SB.msgSub ? 0.38 : 0.52));
    if (SB.msgSub) { g.fillStyle = SB.msgCol; fitFont(g, SB.msgSub, '800', bh * 0.22, W * 0.9); g.fillText(SB.msgSub, mid, by + bh * 0.77); }
    if (SB.msgIcon === 'swap') { // cambio de campo: dos flechas opuestas a cada lado del texto
      var tw = Math.min(W * 0.92, g.measureText(SB.msg).width), ay = by + bh * (SB.msgSub ? 0.38 : 0.52), s = bh * 0.11;
      g.font = 'italic 900 ' + Math.round(bh * (SB.msgSub ? 0.46 : 0.6)) + 'px ' + FONT; tw = Math.min(W * 0.92, g.measureText(SB.msg).width);
      g.fillStyle = SB.msgCol;
      for (var sd = -1; sd <= 1; sd += 2) {
        var ax = mid + sd * (tw / 2 + s * 2.2);
        if (ax - s * 1.6 < 0 || ax + s * 1.6 > W) continue;
        g.beginPath(); g.moveTo(ax - s * 1.5, ay - s * 0.55); g.lineTo(ax + s * 0.6, ay - s * 0.55); g.lineTo(ax + s * 0.6, ay - s * 1.1); g.lineTo(ax + s * 1.6, ay - s * 0.3);
        g.lineTo(ax + s * 0.6, ay + s * 0.5); g.lineTo(ax + s * 0.6, ay - s * 0.05); g.lineTo(ax - s * 1.5, ay - s * 0.05); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(ax + s * 1.5, ay + s * 0.35); g.lineTo(ax - s * 0.6, ay + s * 0.35); g.lineTo(ax - s * 0.6, ay - s * 0.2); g.lineTo(ax - s * 1.6, ay + s * 0.6);
        g.lineTo(ax - s * 0.6, ay + s * 1.4); g.lineTo(ax - s * 0.6, ay + s * 0.85); g.lineTo(ax + s * 1.5, ay + s * 0.85); g.closePath(); g.fill();
      }
    }
  }
  /** Videomarcador de fondo (ancho, 8:3). */
  function drawScoreWide(cv) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height;
    var bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d1626'); bg.addColorStop(1, '#060a12');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    var hb = H * 0.18;
    var gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#0b3a4f'); gr.addColorStop(0.5, '#146a86'); gr.addColorStop(1, '#0b3a4f');
    g.fillStyle = gr; g.fillRect(0, 0, W, hb);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#ffffff';
    g.font = '800 ' + Math.round(hb * 0.62) + 'px ' + FONT; g.fillText('PALAU DEL MAR', H * 0.07, hb * 0.54);
    g.textAlign = 'right'; g.fillStyle = '#ffd23f'; g.font = '900 ' + Math.round(hb * 0.66) + 'px ' + FONT; g.fillText('SET ' + SB.setNo, W - H * 0.07, hb * 0.54);
    var mid = W / 2;
    for (var t = 0; t < 2; t++) {
      var side = t === 0 ? -1 : 1, cx = mid + side * W * 0.25;
      g.fillStyle = TEAMC[t]; g.fillRect(t === 0 ? 0 : W - W * 0.014, hb, W * 0.014, H - hb);
      g.textAlign = 'center'; g.fillStyle = '#ffffff';
      fitFont(g, SB.names[t], '800', H * 0.14, W * 0.3); g.fillText(SB.names[t], cx, hb + H * 0.12);
      if (SB.serving === t) {
        var nw = g.measureText(SB.names[t]).width;
        g.beginPath(); g.arc(cx - nw / 2 - H * 0.07, hb + H * 0.12, H * 0.032, 0, 6.283); g.fillStyle = '#ffd23f'; g.fill();
      }
      // cifras blanco roto: con el post-proceso, el blanco puro cruzaba el umbral del bloom y la cifra se veía como una mancha
      g.fillStyle = SCORE_INK; g.font = '900 ' + Math.round(H * 0.5) + 'px ' + FONT; g.fillText(String(SB.score[t]), cx, hb + (H - hb) * 0.55);
      drawSetDots(g, cx, H * 0.91, H * 0.03, H * 0.1, t);
    }
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.font = '800 ' + Math.round(H * 0.2) + 'px ' + FONT; g.textAlign = 'center'; g.fillText('–', mid, hb + (H - hb) * 0.5);
    if (SB.tag) { g.fillStyle = '#ffd23f'; fitFont(g, SB.tag, '900', H * 0.09, W * 0.3); g.fillText(SB.tag, mid, H * 0.91); }
    drawMsgOverlay(g, W, H, hb);
  }
  /** Marcador colgado (16:9), visto a 15-20 m: dos cifras enormes, nombres cortos y gruesos, nada fino. */
  var SCORE_INK = '#dfe5ee';
  function drawScoreHung(cv) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, mid = W / 2;
    g.fillStyle = '#05080e'; g.fillRect(0, 0, W, H);
    var hb = H * 0.17;
    // franja superior: SET n (o PUNTO DE SET / PARTIDO, en amarillo)
    var gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#0b3a4f'); gr.addColorStop(0.5, '#157393'); gr.addColorStop(1, '#0b3a4f');
    g.fillStyle = SB.tag ? '#ffd23f' : gr; g.fillRect(0, 0, W, hb);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = SB.tag ? '#10141c' : '#ffffff';
    var top = SB.tag || ('SET ' + SB.setNo);
    fitFont(g, top, '900', hb * 0.78, W * 0.9); g.fillText(top, mid, hb * 0.54);
    for (var t = 0; t < 2; t++) {
      var x0 = t === 0 ? 0 : mid, cx = x0 + W / 4;
      // panel del equipo con su color (degradado suave hacia el centro)
      var pg = g.createLinearGradient(x0, 0, x0 + mid, 0);
      pg.addColorStop(t === 0 ? 0 : 1, TEAMC[t]); pg.addColorStop(t === 0 ? 1 : 0, '#0a0f18');
      g.globalAlpha = 0.28; g.fillStyle = pg; g.fillRect(x0, hb, mid, H - hb); g.globalAlpha = 1;
      g.fillStyle = TEAMC[t]; g.fillRect(x0 + W * 0.03, hb + H * 0.205, mid - W * 0.06, H * 0.018);
      g.fillStyle = '#ffffff'; fitFont(g, SB.names[t], '900', H * 0.15, mid * 0.72);
      g.fillText(SB.names[t], cx, hb + H * 0.11);
      if (SB.serving === t) {
        var nw = g.measureText(SB.names[t]).width;
        g.beginPath(); g.arc(cx + (t === 0 ? -1 : 1) * (nw / 2 + H * 0.06), hb + H * 0.11, H * 0.035, 0, 6.283); g.fillStyle = '#ffd23f'; g.fill();
      }
      g.fillStyle = SCORE_INK; g.font = '900 ' + Math.round(H * 0.52) + 'px ' + FONT;
      g.fillText(String(SB.score[t]), cx, hb + H * 0.5);
      drawSetDots(g, cx, H * 0.93, H * 0.032, H * 0.11, t);
    }
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(mid - W * 0.003, hb + H * 0.06, W * 0.006, H - hb - H * 0.12);
    drawMsgOverlay(g, W, H, hb);
  }
  function buildScreens(S, E) {
    var hi = !ctx.isMobile;
    screens.big = canvas(hi ? 1024 : 768, hi ? 384 : 288); screens.bigTex = texOf(screens.big);
    // 1024x576 en escritorio (antes 512x288): se ve a 15-20 m de la cámara de juego
    screens.hung = canvas(hi ? 1024 : 640, hi ? 576 : 360); screens.hungTex = texOf(screens.hung);
    var frame = col('#0b0e14');
    // videomarcadores en las paredes de los fondos
    // Cada pantalla (y sus filos de luz) se apaga entera si la cámara la corta por arriba (ver screenVis):
    // nada brillante asomando a medias detrás de la franja superior del HUD.
    // Los filos de luz de cada pantalla van DENTRO de la malla emisiva (antes 1 malla y 1 dibujo por pantalla): se anota el tramo
    // de vértices y el atributo aScr (1..3) elige su atenuación en el uniforme uScrVis (ver emissiveScreens y screenVis).
    function stripMesh(B) {
      var v0 = E.v, si = screens.ranges.length + 1;
      for (var q = 0; q < B.p.length; q += 3) E.p.push(B.p[q], B.p[q + 1], B.p[q + 2]);
      for (var q2 = 0; q2 < B.n.length; q2++) E.n.push(B.n[q2]);
      for (var q3 = 0; q3 < B.c.length; q3++) E.c.push(B.c[q3]);
      for (var q4 = 0; q4 < B.i.length; q4++) E.i.push(B.i[q4] + v0);
      E.v += B.v; screens.ranges.push([v0, B.v, si]);
      return si;
    }
    for (var e = -1; e <= 1; e += 2) {
      var m = ledMaterial(screens.bigTex, 1, 400, 150);
      var p = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.25), m);
      VB.toThree(e * (HALL_X - 0.63), 0, SCR_Z, p.position); // 3 cm delante del marco (antes coincidían: z-fighting)
      p.rotation.y = e > 0 ? -Math.PI / 2 : Math.PI / 2; p.name = 'endScreen'; root.add(p);
      screens.mats.push(m);
      S.sbox(0.5, 14.6, 5.85, e * (HALL_X - 0.35), 0, SCR_Z, frame);
      var EB = new Builder();
      EB.sbox(0.05, 14.6, 0.06, e * (HALL_X - 0.64), 0, SCR_Z - 2.95, col('#ff7a45'));
      EB.sbox(0.05, 14.6, 0.06, e * (HALL_X - 0.64), 0, SCR_Z + 2.95, col('#7fc8ff'));
      screens.vis.push({ mats: [m], strip: stripMesh(EB), x: e * (HALL_X - 0.63), y: 0, half: 7, z0: SCR_Z - 2.98, z1: SCR_Z + 2.98, v: 1, w: -1, top: null, bot: null });
    }
    // marcador central colgado (4 caras)
    var hz = 11.4, hw = 4.2, hh = 2.36, hd = 4.2; // caja cuadrada: las 4 caras con la proporción de la textura (16:9)
    var hm = ledMaterial(screens.hungTex, 1, 192, 108, false); screens.mats.push(hm);
    // las 4 caras en UNA malla (1 dibujo en vez de 4)
    var hgs = [];
    for (var f = 0; f < 4; f++) {
      // caras: +x / -x (miran a los fondos, ancho = hd) y +y / -y (miran a las laterales, ancho = hw)
      var nx = [1, -1, 0, 0][f], ny = [0, 0, 1, -1][f];
      // las pantallas van FUERA de la carcasa (que mide hw+0.2 x hd+0.2)
      var pg = new THREE.PlaneGeometry(f < 2 ? hd : hw, hh), dist = (f < 2 ? hw : hd) / 2 + 0.1;
      pg.rotateY(Math.atan2(nx, -ny));
      VB.toThree(nx * (dist + 0.015), ny * (dist + 0.015), hz, _p); pg.translate(_p.x, _p.y, _p.z);
      hgs.push(pg);
    }
    var hP = [], hU = [], hI = [], hOff = 0;
    for (var hg = 0; hg < hgs.length; hg++) {
      var ga = hgs[hg].attributes, gi = hgs[hg].index.array;
      for (var hv = 0; hv < ga.position.count; hv++) { hP.push(ga.position.getX(hv), ga.position.getY(hv), ga.position.getZ(hv)); hU.push(ga.uv.getX(hv), ga.uv.getY(hv)); }
      for (var hi2 = 0; hi2 < gi.length; hi2++) hI.push(gi[hi2] + hOff);
      hOff += ga.position.count;
    }
    var hgeo = new THREE.BufferGeometry();
    hgeo.setAttribute('position', new THREE.Float32BufferAttribute(hP, 3)); hgeo.setAttribute('uv', new THREE.Float32BufferAttribute(hU, 2));
    hgeo.setIndex(hI); hgeo.computeBoundingSphere();
    var hmesh = new THREE.Mesh(hgeo, hm); hmesh.name = 'hungScreens'; root.add(hmesh);
    S.sbox(hw + 0.2, hd + 0.2, hh + 0.2, 0, 0, hz, frame);
    S.sbox(hw - 0.4, hd - 0.4, 0.6, 0, 0, hz - hh / 2 - 0.3, frame);
    // filos de luz arriba (frío) y abajo (cálido) en las 4 aristas de la caja
    var HB = new Builder();
    for (var eg = -1; eg <= 1; eg += 2) for (var ez = -1; ez <= 1; ez += 2) {
      var ec = col(ez > 0 ? '#7fc8ff' : '#ff7a45'), zz = hz + ez * (hh / 2 + 0.1);
      HB.sbox(hw + 0.24, 0.05, 0.05, 0, eg * (hd / 2 + 0.11), zz, ec); HB.sbox(0.05, hd + 0.24, 0.05, eg * (hw / 2 + 0.11), 0, zz, ec);
    }
    screens.vis.push({ mats: [hm], strip: stripMesh(HB), x: 0, y: 0, half: 0, z0: hz - hh / 2 - 0.15, z1: hz + hh / 2 + 0.15, v: 1, w: -1, top: null, bot: null });
    for (var c = -1; c <= 1; c += 2) for (var d = -1; d <= 1; d += 2) S.sbox(0.03, 0.03, HALL_H - hz - hh / 2, c * 1.5, d * 1.5, (HALL_H + hz + hh / 2) / 2, col('#2a2f38'));
  }
  /** Pantallas cortadas por el borde superior: si menos de ~70 % de su alto queda bajo la franja del HUD
   *  (VIS_TOP en NDC), la pantalla y sus filos se apagan (pantalla LED negra). Proyección con la cámara del
   *  frame anterior (camera.js se actualiza después de Arena): 1 frame de retraso, invisible con el fundido. */
  function screenVis(rdt, g) {
    // franja del HUD: ~7,5 % del alto, y como mínimo ~64 px (en móvil apaisado el HUD ocupa proporcionalmente más)
    var VIS_TOP = 1 - 2 * Math.max(0.075, 64 / Math.max(200, ctx.height || 720));
    var cam = ctx.camera, k = 1 - Math.exp(-7 * rdt);
    // Pantalla baja (móvil apaisado, ≤ 560 px CSS de alto) en juego (saque/peloteo): arriba al centro ya están el aviso del HUD,
    // la guía de toques y el marcador del HUD. Un marcador del pabellón (el videomarcador del fondo, en la cámara de juego justo
    // bajo el aviso; o el colgado) que cae en el 40 % superior del cuadro sería otro «marcador» apilado ahí: se atenúa al 22 %
    // (no se apaga del todo: sigue leyéndose como pantalla). En el punto, en el cambio de campo y en escritorio, igual que siempre.
    var calm = (ctx.height || 720) <= 560 && ctx.state === 'playing' && !!g && (g.mode === 'serve' || g.mode === 'rally') && !(RT.ccT > 0);
    for (var i = 0; i < screens.vis.length; i++) {
      var S = screens.vis[i], want = 1;
      if (!S.top) { S.top = VB.toThree(S.x, S.y, S.z1, new THREE.Vector3()); S.bot = VB.toThree(S.x, S.y, S.z0, new THREE.Vector3()); } // fijos: una vez
      _v.copy(S.top); _v2.copy(S.bot);
      _p.copy(_v).applyMatrix4(cam.matrixWorldInverse);
      if (_p.z < -0.5) {
        _v.project(cam); _v2.project(cam);
        var yt = _v.y, yb = _v2.y, inX = Math.abs(_v.x) < 1.3;
        if (inX && yt > VIS_TOP && yt > yb) {
          var frac = (VIS_TOP - (yb > -1 ? yb : -1)) / (yt - yb);
          frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;
          var u = (frac - 0.5) / 0.3; u = u < 0 ? 0 : u > 1 ? 1 : u; want = u * u * (3 - 2 * u);
        }
      }
      if (calm && _p.z < -0.5) {
        // _v2 = borde inferior ya proyectado: su NDC y > 0,2 = la pantalla entera queda en el 40 % superior del cuadro
        var lo = (_v2.y - 0.2) / 0.15; lo = lo < 0 ? 0 : lo > 1 ? 1 : lo; lo = lo * lo * (3 - 2 * lo);
        var dimW = 1 - 0.78 * lo; if (dimW < want) want = dimW;
      }
      S.v += (want - S.v) * (rdt > 0 ? k : 1);
      var mv = 0.02 + 0.98 * S.v, dw = mv - S.w;
      if (dw > 1e-4 || dw < -1e-4) { // asentada: sin escribir uniformes cada frame (cada double nuevo es un HeapNumber)
        S.w = mv;
        for (var m = 0; m < S.mats.length; m++) S.mats[m].uniforms.vis.value = mv;
        screens.visU.value.setComponent(S.strip, mv); // filos de luz de esta pantalla (malla emisiva)
      }
    }
  }
  /** Fundido en la franja superior de la pantalla (NDC y 0,72 -> 0,98) para brillos del techo (halos de los
   *  focos, tiras de luz): no se encienden detrás de la franja del HUD. y/w exacto por fragmento. */
  function topFade(mat, key) {
    mat.onBeforeCompile = function (sh) {
      sh.vertexShader = 'varying vec2 vTopC;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vTopC = gl_Position.yw;');
      sh.fragmentShader = 'varying vec2 vTopC;\n' + sh.fragmentShader.replace('#include <fog_fragment>',
        ' gl_FragColor.rgb *= 1.0 - 0.92 * smoothstep(0.72, 0.98, vTopC.x / max(vTopC.y, 1e-4));\n#include <fog_fragment>');
    };
    mat.customProgramCacheKey = function () { return key; };
    return mat;
  }
  /** Malla emisiva con los filos de las pantallas: aScr = 0 (siempre encendido) o 1..3 (pantalla de screens.vis); uScrVis.yzw =
   *  atenuación de cada pantalla (la escribe screenVis), multiplicada antes de la niebla. Va encima del fundido de topFade.
   *  uScrVis.x = 1 / multiplicador de la malla emisiva (2,2 con post): los filos quedan con su brillo de siempre. */
  function emissiveScreens(mat) {
    var prev = mat.onBeforeCompile;
    screens.visU = { value: new THREE.Vector4(1, 1, 1, 1) };
    mat.onBeforeCompile = function (sh) {
      prev(sh);
      sh.uniforms.uScrVis = screens.visU;
      sh.vertexShader = 'attribute float aScr; uniform vec4 uScrVis; varying float vScrK;\n' + sh.vertexShader.replace('#include <color_vertex>',
        '#include <color_vertex>\n vScrK = aScr < 0.5 ? 1.0 : uScrVis.x * (aScr < 1.5 ? uScrVis.y : aScr < 2.5 ? uScrVis.z : uScrVis.w);');
      sh.fragmentShader = 'varying float vScrK;\n' + sh.fragmentShader.replace('#include <fog_fragment>', ' gl_FragColor.rgb *= vScrK;\n#include <fog_fragment>');
    };
    return mat;
  }
  function emissiveScreensAttr(geo) {
    var n = geo.attributes.position.count, a = new Float32Array(n);
    for (var r = 0; r < screens.ranges.length; r++) { var R = screens.ranges[r]; for (var k = 0; k < R[1]; k++) a[R[0] + k] = R[2]; }
    geo.setAttribute('aScr', new THREE.BufferAttribute(a, 1));
  }
  /** Integración (ola 4): crear de antemano, bajo el telón, las tallas de letra del mensaje del videomarcador (fitFont de
   *  drawMsgOverlay) y dar forma a sus textos. La primera vez que Chrome usa una talla nueva crea la fuente y su caché de
   *  formas (~1-2 ms por talla en el PC, ×4 en el móvil): en el PRIMER punto del partido eran ~45 ms de un frame de 160 ms. */
  function warmMsgFonts() {
    try {
      var cv = document.createElement('canvas'); cv.width = cv.height = 8;
      var g = cv.getContext('2d'), list = [screens.big, screens.hung], names = ['TÚ', 'CPU', 'LOCAL', 'VISITA'], subs = ['SAQUE A LA RED', 'BALÓN A LA RED'], k;
      for (k in HOW) subs.push(HOW[k]);
      for (k in REASON) subs.push(REASON[k]);
      for (var i = 0; i < list.length; i++) {
        if (!list[i]) continue;
        var H = list[i].height, top = H * (list[i] === screens.big ? 0.18 : 0.17), bh = (H - top) * 0.72;
        var big = [Math.round(bh * 0.46), Math.round(bh * 0.6)];
        for (var b = 0; b < 2; b++) {
          g.font = 'italic 900 ' + big[b] + 'px ' + FONT;
          for (var n = 0; n < names.length; n++) { g.measureText('PUNTO ' + names[n]); g.measureText('SET ' + names[n]); g.fillText('PUNTO ' + names[n], 0, 4); }
          g.measureText('¡VICTORIA!');
        }
        g.font = '800 ' + Math.round(bh * 0.22) + 'px ' + FONT;
        for (var j = 0; j < subs.length; j++) { g.measureText(subs[j]); g.fillText(subs[j], 0, 4); }
      }
      if (led.mcv) {                                                    // mensajes de las vallas (drawMsg)
        g.font = 'italic 900 ' + Math.round(led.mcv.height * 0.66) + 'px ' + FONT;
        var lm = ['PUNTO DE PARTIDO', 'PUNTO DE SET', '¡BLOQUEO!', '¡VICTORIA!', 'FIN DEL PARTIDO', 'VIDEO CHALLENGE'];
        for (var q = 0; q < names.length; q++) lm.push('PUNTO · ' + names[q], 'SET · ' + names[q]);
        for (var m = 0; m < lm.length; m++) { g.measureText(lm[m]); g.fillText(lm[m], 0, 4); }
      }
    } catch (e) { }
  }
  function redrawScreens() {
    drawScoreWide(screens.big); screens.bigTex.needsUpdate = true;
    drawScoreHung(screens.hung); screens.hungTex.needsUpdate = true;
    SB.dirty = false;
  }
  function scoreFromGame(g) {
    if (!g) return;
    SB.names = g.demo ? ['LOCAL', 'VISITA'] : ['TÚ', 'CPU'];
    SB.score[0] = g.score[0]; SB.score[1] = g.score[1]; SB.sets[0] = g.sets[0]; SB.sets[1] = g.sets[1];
    SB.setNo = g.setNo || 1; SB.serving = g.serving === 1 ? 1 : 0;
    SB.tag = g.mode === 'over' || g.pendingSet ? '' : g.matchPoint >= 0 ? 'PUNTO DE PARTIDO' : g.setPoint >= 0 ? 'PUNTO DE SET' : '';
    SB.dirty = true;
  }
  function screenMsg(text, sub, color, dur, icon) { SB.msg = text; SB.msgSub = sub || ''; SB.msgCol = color; SB.msgT = dur; SB.msgIcon = icon || ''; SB.dirty = true; screens.flash = 1; }

  /* =====================================================================
   * TECHO, PAREDES, CERCHAS, FOCOS, HACES DE LUZ, BANDEROLAS
   * ===================================================================== */
  var halos = null, cones = [], coneMat = null;
  /** Banderola dibujada en el atlas (columna x0, 256x512). */
  function drawBanner(g, x0, title, sub, c1, c2) {
    g.save(); g.translate(x0, 0);
    var gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(16, 16, 224, 4); g.fillRect(16, 492, 224, 4);
    g.fillStyle = '#ffd23f'; g.beginPath(); for (var i = 0; i < 5; i++) { var a = -Math.PI / 2 + i * 4 * Math.PI / 5, r = 34; g.lineTo(128 + Math.cos(a) * r, 120 + Math.sin(a) * r); } g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, title, '900', 64, 228); g.fillText(title, 128, 260);
    g.font = '700 30px ' + FONT; g.fillText(sub, 128, 330);
    g.restore();
  }
  var banner = { cv: null, tex: null, list: null };
  function drawBanners() {
    var g = banner.cv.getContext('2d');
    for (var b = 0; b < banner.list.length; b++) { var B = banner.list[b]; drawBanner(g, b * 256, B[0], B[1], B[2], B[3]); }
  }
  /** Halos de los focos: como PointsMaterial con sizeAttenuation (tamaño 3,4 m) pero con tamaño por punto (aS), opacidad y el
   *  fundido de la franja superior del HUD (como topFade). uScale = alto del búfer / 2 (lo pone postResize, que llama resize). */
  function haloMaterial(map) {
    var m = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, opacity: { value: 1 }, size: { value: 3.4 }, uScale: { value: 360 } },
      vertexShader: 'attribute float aS; uniform float size; uniform float uScale; varying vec2 vTopC;' +
        'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * aS * uScale / max(0.1, -mv.z); vTopC = gl_Position.yw; }',
      fragmentShader: 'uniform sampler2D map; uniform float opacity; varying vec2 vTopC;' +
        'void main(){ vec4 t = texture2D(map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)); gl_FragColor = vec4(t.rgb * t.a * opacity, 1.0);' +
        ' gl_FragColor.rgb *= 1.0 - 0.92 * smoothstep(0.72, 0.98, vTopC.x / max(vTopC.y, 1e-4));' +
        ' gl_FragColor = linearToOutputTexel(gl_FragColor); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    });
    return m;
  }
  function haloScale() { if (halos && ctx.renderer) { ctx.renderer.getDrawingBufferSize(_sz); halos.material.uniforms.uScale.value = _sz.y / 2; } }

  /* =====================================================================
   * CASCARÓN DEL PABELLÓN (ARN-09): antes, una caja negra iluminada (el techo salía a luma ~2: un vacío negro en los planos
   * de reacción). Ahora UNA malla sin luces con un shader que pinta, según el tipo (uv.x):
   *   0 = utillaje con color por vértice (pasarela, altavoces), con el sombreado ya «horneado» por cara (luz que rebota de
   *       la pista por debajo, más oscuro por arriba);
   *   1 = cubierta: paneles acústicos de 2,4 x 1,2 m procedurales (juntas antialias con fwidth, tono por panel, microperforado
   *       que se apaga con la distancia) y un degradado frío que cae desde el centro (el reflejo de la pista iluminada);
   *   2 = paredes: degradado vertical con la franja cálida del anfiteatro (pasillo alto tras la última fila) y su derrame.
   * Todo baja con la luz de la grada (uCrowdLight, ARN-08). Coste: los mismos dibujos que la caja; ~1,7 k triángulos.
   * ===================================================================== */
  var SHELL_VS = [
    'varying vec3 vC; varying vec3 vW; varying float vK;',
    '#include <fog_pars_vertex>',
    'void main(){ vC = color; vK = uv.x; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;',
    ' vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;',
    '#include <fog_vertex>',
    '}'].join('\n');
  var SHELL_FS = [
    'uniform float uCrowdLight; varying vec3 vC; varying vec3 vW; varying float vK;',
    '#include <fog_pars_fragment>',
    'float vbHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'void main(){',
    ' vec3 c = vC; float house = mix(1.0, uCrowdLight, 0.75);',
    ' if (vK > 0.5 && vK < 1.5) {',
    '  vec2 q = vW.xz / vec2(2.4, 1.2); vec2 id = floor(q); vec2 f = fract(q); vec2 fw = fwidth(q);',
    '  vec2 e = smoothstep(vec2(0.0), fw * 1.2 + 0.015, f) * smoothstep(vec2(0.0), fw * 1.2 + 0.015, 1.0 - f);',
    '  float seamK = 1.0 - smoothstep(0.12, 0.45, max(fw.x, fw.y));',
    '  float seam = mix(1.0, 0.5 + 0.5 * e.x * e.y, seamK);',
    '  vec2 pq = vW.xz * 9.0; vec2 pf = abs(fract(pq) - 0.5); vec2 pw = fwidth(pq); float pk = 1.0 - smoothstep(0.08, 0.3, max(pw.x, pw.y));',
    '  float perf = mix(1.0, 0.82 + 0.18 * smoothstep(0.12, 0.22, max(pf.x, pf.y)), pk);',
    '  float r2 = vW.x * vW.x / 520.0 + vW.z * vW.z / 300.0;',
    '  float lit = 0.45 + 0.55 * exp(-r2);',
    // CARTOON: techo luminoso (azul violáceo de dibujo, no casi negro); paneles con tono por bloque más marcado
    '  c = vec3(0.13, 0.15, 0.36) * lit * (0.82 + 0.36 * step(0.5, vbHash(id))) * seam * perf * house;',
    ' } else if (vK > 1.5) {',
    '  float y = vW.y;',
    '  float strip = smoothstep(9.55, 9.67, y) * (1.0 - smoothstep(10.03, 10.15, y));',
    '  float up = y > 10.15 ? exp(-(y - 10.15) * 0.42) : 0.0; float dn = y < 9.55 ? exp(-(9.55 - y) * 1.6) : 0.0;',
    '  float top = smoothstep(13.0, 21.8, y);',
    '  c = vC * (0.7 + 0.35 * top) * house + vec3(1.0, 0.62, 0.34) * (strip * 0.2 + (up * 0.035 + dn * 0.02) * house);',
    ' } else { c *= house; }',
    ' gl_FragColor = vec4(c, 1.0);',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    '#include <fog_fragment>',
    '}'].join('\n');
  function buildShell() {
    var P = [], Cc = [], K = [], I = [], n = 0, cc = new THREE.Color();
    function quad(a, b, c2, d, color, kind) { // a b c d antihorario visto desde la cara visible (coords three)
      var q = [a, b, c2, d];
      for (var i = 0; i < 4; i++) { P.push(q[i][0], q[i][1], q[i][2]); Cc.push(color.r, color.g, color.b); K.push(kind, 0); }
      I.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
    }
    // caja (centro y tamaños en coords three, giro ry) con sombreado por cara horneado: abajo la ilumina la pista, arriba oscura
    function box(cx, cy, cz, sx, sy, sz, hex, ry) {
      var col0 = new THREE.Color(hex), hx = sx / 2, hy = sy / 2, hz = sz / 2, cs = Math.cos(ry || 0), sn = Math.sin(ry || 0);
      function V(x, y, z) { return [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs]; }
      var F = [
        [-1, V(-hx, -hy, hz), V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, -hy, hz)],
        [1, V(-hx, hy, -hz), V(-hx, hy, hz), V(hx, hy, hz), V(hx, hy, -hz)],
        [0, V(hx, -hy, hz), V(hx, -hy, -hz), V(hx, hy, -hz), V(hx, hy, hz)],
        [0, V(-hx, -hy, -hz), V(-hx, -hy, hz), V(-hx, hy, hz), V(-hx, hy, -hz)],
        [0, V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, hy, hz)],
        [0, V(hx, -hy, -hz), V(-hx, -hy, -hz), V(-hx, hy, -hz), V(hx, hy, -hz)]
      ];
      for (var f = 0; f < 6; f++) {
        var ny = F[f][0], k = ny < 0 ? 1.0 : ny > 0 ? 0.35 : 0.62;
        cc.copy(col0).multiplyScalar(k); if (ny < 0) cc.r *= 1.12; // rebote cálido de la tarima
        quad(F[f][1], F[f][2], F[f][3], F[f][4], cc, 0);
      }
    }
    var X = HALL_X, Z = HALL_Y, H = HALL_H, wall = new THREE.Color('#2e3272'), wallE = new THREE.Color('#2a2d68'), deck = new THREE.Color(1, 1, 1);
    // paredes (caras hacia dentro)
    quad([-X, 0, -Z], [X, 0, -Z], [X, H, -Z], [-X, H, -Z], wall, 2);
    quad([X, 0, Z], [-X, 0, Z], [-X, H, Z], [X, H, Z], wall, 2);
    quad([X, 0, -Z], [X, 0, Z], [X, H, Z], [X, H, -Z], wallE, 2);
    quad([-X, 0, Z], [-X, 0, -Z], [-X, H, -Z], [-X, H, Z], wallE, 2);
    // cubierta (mira hacia abajo)
    quad([-X, H - 0.02, -Z], [X, H - 0.02, -Z], [X, H - 0.02, Z], [-X, H - 0.02, Z], deck, 1);
    // pasarela técnica perimetral a 17,2 m (rejilla, barandillas, montantes, larguero y péndolas hasta las cerchas)
    var cy0 = 17.2, AX = 17.2, AZ = 12.6, W = 1.0, steel = '#555a9a', grate = '#3f4380';
    var sides = [[0, -AZ, 2 * AX + W, 0], [0, AZ, 2 * AX + W, 0], [-AX, 0, 2 * AZ - W, 1], [AX, 0, 2 * AZ - W, 1]];
    for (var si = 0; si < 4; si++) {
      var S4 = sides[si], along = S4[3] === 0, L = S4[2];
      box(S4[0], cy0, S4[1], along ? L : W, 0.07, along ? W : L, grate);
      for (var side = -1; side <= 1; side += 2) {
        var ox = along ? 0 : side * W / 2, oz = along ? side * W / 2 : 0;
        box(S4[0] + ox, cy0 + 1.05, S4[1] + oz, along ? L : 0.05, 0.05, along ? 0.05 : L, steel);
        box(S4[0] + ox, cy0 + 0.55, S4[1] + oz, along ? L : 0.035, 0.035, along ? 0.035 : L, steel);
        for (var t = -L / 2 + 0.6; t <= L / 2 - 0.6; t += 2.5)
          box(S4[0] + ox + (along ? t : 0), cy0 + 0.52, S4[1] + oz + (along ? 0 : t), 0.045, 1.05, 0.045, steel);
      }
      box(S4[0], cy0 - 0.12, S4[1], along ? L : 0.14, 0.18, along ? 0.14 : L, steel);
      for (var hgg = -L / 2 + 1; hgg <= L / 2 - 1; hgg += 5) box(S4[0] + (along ? hgg : 0), (cy0 + 18.2) / 2 + 0.05, S4[1] + (along ? 0 : hgg), 0.04, 18.2 - cy0, 0.04, steel);
    }
    // 2 racimos de altavoces junto al marcador colgado (miran a las gradas laterales), con bastidor y cables
    for (var sp = -1; sp <= 1; sp += 2) {
      var sz0 = -sp * 3.5; // sim y = ±3,5 -> three z
      box(0, 14.75, sz0, 1.5, 0.12, 0.9, '#1d2329');
      for (var e = 0; e < 3; e++) {
        var yy = 14.35 - e * 0.52, tilt = e * 0.07;
        box(0, yy, sz0 + sp * tilt, 1.2, 0.48, 0.7, '#14181d');
        box(0, yy, sz0 + sp * (0.36 + tilt), 1.08, 0.38, 0.02, '#2a3038');
      }
      for (var cbl = -1; cbl <= 1; cbl += 2) box(cbl * 0.6, (14.8 + H) / 2, sz0, 0.025, H - 14.8, 0.025, '#2a2f38');
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(K, 2)); g.setIndex(I); g.computeBoundingSphere();
    var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCrowdLight: { value: 1 } }]);
    U.uCrowdLight = crowdU.uCrowdLight; // el mismo objeto que la grada
    var m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SHELL_VS, fragmentShader: SHELL_FS, vertexColors: true, fog: true });
    m.extensions.derivatives = true;
    var mesh = new THREE.Mesh(g, m); mesh.name = 'hallShell'; mesh.frustumCulled = false; root.add(mesh);
    return mesh;
  }
  function buildHall(S, E) {
    buildShell(); // paredes + techo + pasarela + altavoces (ARN-09): 1 malla sin luces, en el sitio de la caja negra de antes
    var pil = col('#26296a'), strip = col('#5ec8ff'), warm = col('#ffb878');
    // pilastras y tiras de luz verticales en paredes laterales
    for (var x = -27; x <= 27; x += 6) for (var s = -1; s <= 1; s += 2) {
      S.sbox(1.0, 0.6, HALL_H, x, s * (HALL_Y - 0.3), HALL_H / 2, pil);
      E.sbox(0.12, 0.04, 9, x, s * (HALL_Y - 0.62), 13.5, strip);
    }
    // cerchas de techo (cordón superior, inferior y diagonales)
    var tr = col(PAL.truss), zt = 19.5, zb = 18.2;
    for (var xi = -25; xi <= 25; xi += 5) {
      S.sbox(0.25, 2 * HALL_Y, 0.25, xi, 0, zt, tr); S.sbox(0.25, 2 * HALL_Y, 0.25, xi, 0, zb, tr);
      for (var yi = -HALL_Y + 1; yi < HALL_Y - 1; yi += 2.6) S.box(0.08, 1.85, 0.08, xi, (zt + zb) / 2, -(yi + 0.65), tr, 0, (yi | 0) % 2 ? 0.78 : -0.78);
    }
    for (var yl = -20; yl <= 20; yl += 10) S.sbox(2 * HALL_X, 0.2, 0.2, 0, yl, zb, tr);
    // anillo de focos sobre la pista (rectángulo) + paneles emisivos
    var lz = 15.6, fix = col('#2a313c'), lamp = col('#fff2dc');
    var lampPos = [];
    for (var lx = -12; lx <= 12; lx += 2.4) for (var ls = -1; ls <= 1; ls += 2) lampPos.push([lx, ls * 7.2]);
    for (var ly = -4.8; ly <= 4.8; ly += 2.4) for (var le = -1; le <= 1; le += 2) lampPos.push([le * 13.2, ly]);
    S.sbox(27, 0.3, 0.3, 0, 7.2, lz + 0.45, fix); S.sbox(27, 0.3, 0.3, 0, -7.2, lz + 0.45, fix);
    S.sbox(0.3, 14.7, 0.3, 13.2, 0, lz + 0.45, fix); S.sbox(0.3, 14.7, 0.3, -13.2, 0, lz + 0.45, fix);
    var hp = [];
    for (var i = 0; i < lampPos.length; i++) {
      var L = lampPos[i];
      S.sbox(0.9, 0.9, 0.35, L[0], L[1], lz + 0.18, fix);
      E.sbox(0.78, 0.78, 0.02, L[0], L[1], lz - 0.005, lamp);
      hp.push(L[0], lz - 0.1, -L[1]);
    }
    // halos (glow barato) de los focos: Points aditivos
    var hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    // ARN-09: cada foco con su tamaño de halo (±12 %, como lámparas reales de distinta edad/ángulo): atributo aS + shader propio
    var hs = []; for (var hsi = 0; hsi < hp.length / 3; hsi++) hs.push(0.88 + rnd() * 0.24);
    hg.setAttribute('aS', new THREE.Float32BufferAttribute(hs, 1));
    halos = new THREE.Points(hg, haloMaterial(radialTex([[0, 'rgba(255,240,215,0.85)'], [0.2, 'rgba(255,225,180,0.28)'], [1, 'rgba(255,220,170,0)']])));
    halos.frustumCulled = false; halos.name = 'halos'; root.add(halos);
    // haces de luz volumétricos (conos aditivos muy sutiles)
    coneMat = new THREE.ShaderMaterial({
      // sweep/uT (ARN-08): barrido lento de los haces en la celebración del partido. Cada cono gira alrededor de SU foco
      // (aApex.xyz, coords three) con su fase (aApex.w); con sweep = 0 la geometría queda exactamente como antes.
      uniforms: { k: { value: 0.05 }, sweep: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'attribute vec4 aApex; uniform float sweep; uniform float uT; varying float vH; varying vec3 vN; varying vec3 vV; varying float vD;' +
        'vec3 vbRx(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }' +
        'vec3 vbRz(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }' +
        'void main(){ vH = uv.y; float a1 = sweep * sin(uT * 0.62 + aApex.w), a2 = sweep * 0.8 * cos(uT * 0.47 + aApex.w * 1.7);' +
        ' vec3 p = vbRz(vbRx(position - aApex.xyz, a1), a2) + aApex.xyz; vec3 n = vbRz(vbRx(normal, a1), a2);' +
        ' vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float k; varying float vH; varying vec3 vN; varying vec3 vV; varying float vD;' +
        'void main(){ float e = pow(abs(dot(vN, vV)), 1.6); float f = smoothstep(0.0, 0.85, vH) * (1.0 - smoothstep(0.92, 1.0, vH));' +
        ' float near = smoothstep(9.0, 22.0, vD);' +
        ' gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * e * f * near * k, 1.0); }',
      // transparent:false a propósito: aditivo + sin escribir profundidad funciona igual en la lista opaca
      // (renderOrder 5 = después de lo opaco) y evita el doble recompilado de transparente+DoubleSide en r149
      transparent: false, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    var cg = new THREE.CylinderGeometry(0.35, 2.2, lz - 0.3, 20, 1, true); cg.translate(0, -(lz - 0.3) / 2, 0);
    var conePos = [[-9, 7.2], [-3, 7.2], [3, 7.2], [9, 7.2], [-9, -7.2], [-3, -7.2], [3, -7.2], [9, -7.2]];
    // los 8 conos fusionados en UNA malla (1 draw call en vez de 8)
    var cP = [], cN = [], cU = [], cI = [], cA = [], cOff = 0, cpa = cg.attributes.position, cna = cg.attributes.normal, cua = cg.attributes.uv, cia = cg.index.array;
    for (var c = 0; c < conePos.length; c++) {
      VB.toThree(conePos[c][0], conePos[c][1], lz - 0.1, _p);
      _e.set(conePos[c][1] > 0 ? -0.16 : 0.16, 0, 0, 'YXZ'); _q.setFromEuler(_e); _s.set(1, 1, 1); _m.compose(_p, _q, _s); _m3.getNormalMatrix(_m);
      for (var cv = 0; cv < cpa.count; cv++) {
        _v.fromBufferAttribute(cpa, cv).applyMatrix4(_m); cP.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(cna, cv).applyMatrix3(_m3).normalize(); cN.push(_v.x, _v.y, _v.z);
        cU.push(cua.getX(cv), cua.getY(cv)); cA.push(_p.x, _p.y, _p.z, c * 1.37);
      }
      for (var ci = 0; ci < cia.length; ci++) cI.push(cia[ci] + cOff);
      cOff += cpa.count;
    }
    var cgm = new THREE.BufferGeometry();
    cgm.setAttribute('position', new THREE.Float32BufferAttribute(cP, 3)); cgm.setAttribute('normal', new THREE.Float32BufferAttribute(cN, 3));
    cgm.setAttribute('uv', new THREE.Float32BufferAttribute(cU, 2)); cgm.setAttribute('aApex', new THREE.Float32BufferAttribute(cA, 4)); cgm.setIndex(cI); cgm.computeBoundingSphere();
    var cm = new THREE.Mesh(cgm, coneMat); cm.renderOrder = 5; cm.name = 'lightCones'; root.add(cm); cones.push(cm);
    // banderolas de títulos (ficticios) colgadas en las paredes laterales
    var BAN = [['LIGA', '2019', '#146a86', '#0b3a4f'], ['COPA', '2021', '#c4532f', '#6b2412'], ['LIGA', '2023', '#146a86', '#0b3a4f'], ['SUPERCOPA', '2024', '#2a55c9', '#13265e'], ['COPA', '2025', '#c4532f', '#6b2412']];
    // las 5 en UNA malla con un atlas (antes 5 mallas, 5 materiales y 5 texturas)
    banner.list = BAN; banner.cv = canvas(256 * BAN.length, 512); drawBanners(); banner.tex = texOf(banner.cv);
    var bP = [], bN = [], bU = [], bI = [];
    for (var b = 0; b < BAN.length; b++) {
      VB.toThree(-12 + b * 6, HALL_Y - 0.9, 14.2, _p);
      var u0 = b / BAN.length, u1 = (b + 1) / BAN.length, o4 = b * 4;
      bP.push(_p.x - 1.1, _p.y + 2.2, _p.z, _p.x + 1.1, _p.y + 2.2, _p.z, _p.x - 1.1, _p.y - 2.2, _p.z, _p.x + 1.1, _p.y - 2.2, _p.z);
      bN.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      bU.push(u0, 1, u1, 1, u0, 0, u1, 0);
      bI.push(o4, o4 + 2, o4 + 1, o4 + 2, o4 + 3, o4 + 1);
    }
    var bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bP, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(bN, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(bU, 2)); bg.setIndex(bI); bg.computeBoundingSphere();
    var bmesh = new THREE.Mesh(bg, VB.TOON.toonMat({ map: banner.tex, side: THREE.DoubleSide }));
    bmesh.name = 'banners'; root.add(bmesh);
    // nombre del pabellón en la pared lateral opuesta (letras retroiluminadas)
    var nc = canvas(2048, 256), ng = nc.getContext('2d');
    ng.font = '900 200px ' + FONT; ng.textAlign = 'center'; ng.textBaseline = 'middle';
    ng.shadowColor = 'rgba(255,170,110,0.9)'; ng.shadowBlur = 30; ng.fillStyle = '#ffe7cf'; ng.fillText('PALAU  DEL  MAR', 1024, 135);
    var nm = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.75), new THREE.MeshBasicMaterial({ map: texOf(nc), transparent: true, toneMapped: false, depthWrite: false }));
    VB.toThree(0, -(HALL_Y - 0.7), 13.5, nm.position); nm.rotation.y = Math.PI; nm.name = 'hallName'; root.add(nm);
  }

  /* =====================================================================
   * LUCES Y MAPA DE ENTORNO
   * ===================================================================== */
  /* Equipo de luces (ARN-01). Objetivo: pista de tarima con luma ~195 y saturación >= 0,36 en TODOS los niveles
   * (antes salía crema, 223/0,26 en alta) y sombras de jugador que anclen (poca luz ambiente). Una fila por nivel
   * [baja, media, alta]: la alta lleva bloom (mezcla «screen» que aclara la pista) y la baja no tiene relleno ni
   * contraluz, así que cada nivel compensa con la principal y la hemisférica para que la pista quede igual.
   * key = principal (sombras), hemi = cielo/suelo, fill = relleno frío, rim = contraluz cálido, env = reflejos del suelo. */
  var LT = [
    // CARTOON: `floor` = tinte del toon de la tarima (sin especular ni entorno, a 1 lavaba la pista con el ACES; 0,6-0,7
    // deja el naranja saturado). Las luces no cambian (los atletas se ajustan contra ellas).
    { key: 1.42, hemi: 0.36, fill: 0, rim: 0, env: 0.6, floor: 0.68 },
    { key: 1.26, hemi: 0.22, fill: 0.25, rim: 0.22, env: 0.6, floor: 0.72 },
    { key: 1.42, hemi: 0.24, fill: 0.25, rim: 0.22, env: 0.6, floor: 0.64 }
  ];
  var FILL_I = LT[2].fill, RIM_I = LT[2].rim; // (setQuality las pone a 0 en baja en el móvil)
  var floorMat = null;
  function buildLights(q) {
    // suelo de la hemisférica oscuro y frío: el rebote no levanta las sombras de los jugadores
    // CARTOON: cielo lavanda y suelo violeta (#2b2547 aclarado): lo que no ve la principal queda violáceo, no negro
    hemi = new THREE.HemisphereLight(0xd6d0ff, 0x5a4f8c, LT[2].hemi); root.add(hemi);
    keyLight = new THREE.DirectionalLight(0xfff0dc, LT[2].key);
    VB.toThree(7, -9, 26, keyLight.position); keyLight.target.position.set(0, 0, 0);
    keyLight.castShadow = !!q.shadows;
    var sc = keyLight.shadow.camera; sc.left = -18; sc.right = 18; sc.top = 13; sc.bottom = -13; sc.near = 8; sc.far = 55;
    keyLight.shadow.mapSize.set(q.shadowSize, q.shadowSize); keyLight.shadow.bias = -0.0005; keyLight.shadow.normalBias = 0.025;
    root.add(keyLight); root.add(keyLight.target);
    fillLight = new THREE.DirectionalLight(0xb9d2ff, FILL_I); VB.toThree(-10, 12, 14, fillLight.position); root.add(fillLight);
    // contraluz cálido desde el fondo rival: perfila a los jugadores vistos de espaldas.
    // Alto (~52°) y suave: más bajo coincide con el ángulo rasante de la cámara de juego y su
    // reflejo especular lava medio campo rival (y el bloom lo convierte en una mancha blanca).
    rimLight = new THREE.DirectionalLight(0xffd2a0, RIM_I); VB.toThree(-14, 4, 20, rimLight.position); root.add(rimLight);
  }
  function buildEnvironment() {
    try {
      var es = new THREE.Scene();
      es.background = new THREE.Color(0x07090e);
      var room = new THREE.Mesh(new THREE.BoxGeometry(60, 24, 52), new THREE.MeshBasicMaterial({ color: 0x10151d, side: THREE.BackSide }));
      room.position.y = 12; es.add(room);
      var fl = new THREE.Mesh(new THREE.PlaneGeometry(32, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.court).multiplyScalar(0.35) }));
      fl.rotation.x = -Math.PI / 2; fl.position.y = 0.05; es.add(fl);
      var lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0dc).multiplyScalar(7) });
      for (var x = -12; x <= 12; x += 4) for (var s = -1; s <= 1; s += 2) { var l = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 1.2), lampM); l.position.set(x, 15.5, s * 7.2); es.add(l); }
      var ledM = [0xff6b3d, 0x3f8cff, 0x7ee0c3, 0xffd23f];
      for (var k = 0; k < 4; k++) {
        var lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(ledM[k]).multiplyScalar(1.2) });
        var b = new THREE.Mesh(new THREE.BoxGeometry(k < 2 ? 30 : 0.2, 0.9, k < 2 ? 0.2 : 19), lm);
        b.position.set(k === 2 ? 15.8 : k === 3 ? -15.8 : 0, 0.5, k === 0 ? -9.8 : k === 1 ? 9.8 : 0); es.add(b);
      }
      var scr = new THREE.Mesh(new THREE.BoxGeometry(0.2, 6, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3b7fae).multiplyScalar(1.4) }));
      scr.position.set(-29.5, 12, 0); es.add(scr); var scr2 = scr.clone(); scr2.position.x = 29.5; es.add(scr2);
      var pm = new THREE.PMREMGenerator(ctx.renderer);
      var rt = pm.fromScene(es, 0.035);
      pm.dispose();
      ctx.scene.environment = rt.texture;
    } catch (err) { console.warn('[VB] arena: sin mapa de entorno', err); }
  }

  /* =====================================================================
   * FLASHES DE CÁMARAS en la grada
   * ===================================================================== */
  var flashes = null, FL_N = 90, flLife = null, flRate = 0;
  function buildFlashes() {
    var pos = new Float32Array(FL_N * 3), colr = new Float32Array(FL_N * 3);
    flLife = new Float32Array(FL_N);
    var nh = crowdHeads.length / 3;
    for (var i = 0; i < FL_N; i++) {
      var k = Math.floor(rnd() * nh) * 3;
      pos[i * 3] = crowdHeads[k] || 0; pos[i * 3 + 1] = (crowdHeads[k + 1] || 0) + 0.15; pos[i * 3 + 2] = crowdHeads[k + 2] || 0;
    }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    flashes = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.9, map: radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(220,235,255,0.5)'], [1, 'rgba(200,220,255,0)']]),
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    flashes.frustumCulled = false; flashes.name = 'camFlashes'; root.add(flashes);
  }
  function updateFlashes(rdt) {
    if (!flashes || !flashes.visible) return;
    var colr = flashes.geometry.attributes.color.array, any = false;
    flRate = Math.max(0, flRate - rdt * 6);
    // «destellos suaves» (ARN-13): flashes más tenues (35 %), más largos y menos frecuentes: brillos, no estrobos
    var soft = softK() < 1, life = soft ? 0.3 : 0.09, amp = soft ? 0.35 : 1;
    var p = (0.35 + flRate) * rdt * (soft ? 0.4 : 1);
    for (var i = 0; i < FL_N; i++) {
      if (flLife[i] <= 0 && Math.random() < p / FL_N * 6) flLife[i] = life;
      var v = 0;
      if (flLife[i] > 0) { flLife[i] -= rdt; var u = flLife[i] / life; v = u > 0 ? amp * (soft ? Math.sin(u * Math.PI) : u) : 0; any = true; }
      if (colr[i * 3] !== v) { colr[i * 3] = v; colr[i * 3 + 1] = v; colr[i * 3 + 2] = v; any = true; }
    }
    if (any) flashes.geometry.attributes.color.needsUpdate = true;
  }

  /* =====================================================================
   * POST-PROCESO (solo calidad alta + WebGL2): bloom + ACES + viñeta
   * ===================================================================== */
  var post = null;
  var QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  function makePost() {
    var r = ctx.renderer;
    if (!r.capabilities.isWebGL2) return null;
    var P = {};
    // Cadena LDR: la escena se pinta con el tone mapping normal del renderer (ACES) en un destino
    // de 8 bits sRGB con MSAA (sin bandas en oscuros). Se evitan a propósito los HalfFloat: en
    // algunos drivers (SwiftShader) producen filas corruptas.
    var pp = ctx.params || {}, msaa = pp.msaa != null ? (+pp.msaa | 0) : 4, u8 = THREE.UnsignedByteType, rtT = pp.rtt === 'half' ? THREE.HalfFloatType : u8;
    P.rt = new THREE.WebGLRenderTarget(4, 4, { type: rtT, samples: msaa, encoding: rtT === u8 ? THREE.sRGBEncoding : THREE.LinearEncoding });
    P.rt.texture.encoding = THREE.sRGBEncoding;
    P.a1 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.b1 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.a2 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.b2 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.scene = new THREE.Scene(); P.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    P.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); P.quad.frustumCulled = false; P.scene.add(P.quad);
    P.bright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.82 } },
      vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold; varying vec2 vUv;' +
        'vec3 s(vec2 o){ vec3 c = clamp(texture2D(tDiffuse, vUv + o * texel).rgb, 0.0, 1.0);' +
        ' float l = max(c.r, max(c.g, c.b)); return c * smoothstep(threshold, 1.0, l); }' +
        'void main(){ vec3 c = s(vec2(-1.0,-1.0)) + s(vec2(1.0,-1.0)) + s(vec2(-1.0,1.0)) + s(vec2(1.0,1.0)); gl_FragColor = vec4(c * 0.25, 1.0); }'
    });
    P.blur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;' +
        'void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270;' +
        ' c += (texture2D(tDiffuse, vUv + dir * 1.3846154).rgb + texture2D(tDiffuse, vUv - dir * 1.3846154).rgb) * 0.3162162;' +
        ' c += (texture2D(tDiffuse, vUv + dir * 3.2307692).rgb + texture2D(tDiffuse, vUv - dir * 3.2307692).rgb) * 0.0702703;' +
        ' gl_FragColor = vec4(c, 1.0); }'
    });
    P.copy = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;' +
        'void main(){ vec3 c = texture2D(tDiffuse, vUv + texel * vec2(-1.0,-1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0,-1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(-1.0,1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0,1.0)).rgb; gl_FragColor = vec4(c * 0.25, 1.0); }'
    });
    P.comp = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, exposure: { value: 1.0 }, bloom: { value: 0.72 },
        vig: { value: 0.32 }, aspect: { value: 1.7 }, time: { value: 0 }, gam: { value: 1.16 } },
      vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
      fragmentShader: [
        'uniform sampler2D tScene; uniform sampler2D tB1; uniform sampler2D tB2; uniform float exposure; uniform float bloom; uniform float vig; uniform float aspect; uniform float time; uniform float gam; varying vec2 vUv;',
        'vec3 toSRGB(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }',
        'void main(){',
        ' vec3 c = pow(max(texture2D(tScene, vUv).rgb, 0.0), vec3(gam));', // igualar la curva de la pintura directa (media/baja): sin esto la alta salía lavada (negros levantados, luces comprimidas)
        ' vec3 b = texture2D(tB1, vUv).rgb * 0.8 + texture2D(tB2, vUv).rgb * 1.0;',
        ' c = 1.0 - (1.0 - c) * (1.0 - clamp(b * bloom, 0.0, 1.0));', // mezcla "screen": brillo sin quemar
        ' vec2 d = (vUv - 0.5) * vec2(aspect, 1.0); float v = smoothstep(1.25, 0.25, length(d) * 1.05);',
        ' c *= mix(1.0, v, vig);',
        ' c = toSRGB(c);',
        ' c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;',
        ' gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n')
    });
    return P;
  }
  var _sz = null;
  function postResize() {
    haloScale();
    if (!post) return;
    var r = ctx.renderer; r.getDrawingBufferSize(_sz);
    var w = Math.max(4, _sz.x | 0), h = Math.max(4, _sz.y | 0);
    post.rt.setSize(w, h);
    var w1 = Math.max(2, w >> 2), h1 = Math.max(2, h >> 2), w2 = Math.max(2, w >> 3), h2 = Math.max(2, h >> 3);
    post.a1.setSize(w1, h1); post.b1.setSize(w1, h1); post.a2.setSize(w2, h2); post.b2.setSize(w2, h2);
    post.w = w; post.h = h; post.w1 = w1; post.h1 = h1; post.w2 = w2; post.h2 = h2;
    post.comp.uniforms.aspect.value = w / h;
  }
  function pass(mat, target) { post.quad.material = mat; ctx.renderer.setRenderTarget(target); ctx.renderer.render(post.scene, post.cam); }
  function renderPost(c) {
    var r = c.renderer, P = post;
    try {
      r.setRenderTarget(P.rt); r.render(c.scene, c.camera);
      P.bright.uniforms.tDiffuse.value = P.rt.texture; P.bright.uniforms.texel.value.set(1 / P.w, 1 / P.h); pass(P.bright, P.a1);
      P.blur.uniforms.tDiffuse.value = P.a1.texture; P.blur.uniforms.dir.value.set(1 / P.w1, 0); pass(P.blur, P.b1);
      P.blur.uniforms.tDiffuse.value = P.b1.texture; P.blur.uniforms.dir.value.set(0, 1 / P.h1); pass(P.blur, P.a1);
      P.copy.uniforms.tDiffuse.value = P.a1.texture; P.copy.uniforms.texel.value.set(0.5 / P.w1, 0.5 / P.h1); pass(P.copy, P.a2);
      P.blur.uniforms.tDiffuse.value = P.a2.texture; P.blur.uniforms.dir.value.set(1 / P.w2, 0); pass(P.blur, P.b2);
      P.blur.uniforms.tDiffuse.value = P.b2.texture; P.blur.uniforms.dir.value.set(0, 1 / P.h2); pass(P.blur, P.a2);
      P.comp.uniforms.tScene.value = P.rt.texture; P.comp.uniforms.tB1.value = P.a1.texture; P.comp.uniforms.tB2.value = P.a2.texture;
      P.comp.uniforms.time.value = (c.time % 10);
      pass(P.comp, null);
    } catch (err) {
      console.warn('[VB] arena: post-proceso desactivado', err);
      r.setRenderTarget(null); setPost(false);
      r.render(c.scene, c.camera);
    }
  }
  function wantPost(q) {
    var pp = ctx.params && ctx.params.post;
    if (pp === '0') return false;
    if (pp === '1') return true;
    return q && q.rank >= 2 && !ctx.isMobile;
  }
  function setPost(on) {
    if (on && !post) { try { post = makePost(); } catch (e) { post = null; } if (post) postResize(); }
    var active = on && !!post;
    var was = ctx.renderFn === renderPost;
    ctx.renderFn = active ? renderPost : (was ? null : ctx.renderFn);
    // con post, los emisivos superan 1.0 (HDR) y el bloom los recoge
    var boost = active ? 1.55 : 1.0;
    if (led.mat) led.mat.uniforms.boost.value = boost * 0.95;
    // pantallas de marcador: poco por encima de 1 (a 1,55 las cifras blancas se volvían manchas de bloom)
    screens.base = active ? 1.12 : 1.0;
    for (var j = 0; j < screens.mats.length; j++) screens.mats[j].uniforms.boost.value = screens.base;
    if (emissiveMesh) emissiveMesh.material.color.setScalar(active ? 2.2 : 1.0);
    if (screens.visU) screens.visU.value.x = active ? 1 / 2.2 : 1; // filos de las pantallas: sin el ×2,2 de los emisivos
    if (halos) halos.material.uniforms.opacity.value = active ? 0.55 : 1.0;
    // bases del estado de luz (ARN-08 escribe encima, multiplicando)
    MOOD.ledBase = boost * 0.95; MOOD.haloBase = active ? 0.55 : 1.0; MOOD.dirty = true;
  }

  /* =====================================================================
   * LUZ COMO PUNTUACIÓN (ARN-08) — solo uniformes, intensidades y colores: ni dibujos ni programas nuevos.
   * · Punto de set/partido (desde el serveReady hasta el punto): la grada y los peldaños bajan (uCrowdLight), los haces
   *   se marcan más, la principal se enfría un poco y las vallas laten despacio en el color del equipo que tiene el punto.
   * · Punto: contraluz teñido hacia el color del que anota (sube en 0,3 s, vuelve antes de 1 s) + destello de vallas y
   *   halos de los focos escalado por point.highlight.
   * · Partido ganado: barrido lento de los haces y pulso suave de la luz de la grada mientras dura la celebración.
   * Todo con rampas >= 0,3 s (nada salta) y con ctx.settings.softFlash los destellos/latidos al 40 % (sin estrobos).
   * ===================================================================== */
  var MOOD = { tense: 0, team: 0, mp: 0, pfT: 9, pfTeam: 0, pfHl: 0.5, win: 0, winOn: false, t: 0, force: -1, dirty: true,
    ledBase: 0.95, haloBase: 1, coneBase: 0.04, rimBase: 0, rimOn: false, keyC: null, keyCool: null, rimC: null, teamC: null,
    w: { crowd: -1, led: -1, halo: -1, cone: -1, sweep: -1, tint: -1, rim: -1, rimc: -1, key: -1, haze: -1, glow: -1 } };
  var HAZE0 = 0.34, CROWD_DIM = 0.45, GLOW_K = 0.8; // uCrowdLight en punto de set (lineal): 1 → 0,45 ≈ −20-25 % de luma en pantalla (curva ACES + sRGB)
  function softK() { var st = ctx.settings; return st && st.softFlash ? 0.4 : 1; }
  /** Envolvente del destello del punto: sube en 0,3 s (smoothstep), se mantiene un instante y baja de 0,35 a 0,95 s. */
  function pfEnv(t) {
    if (t < 0 || t >= 0.95) return 0;
    var a = t / 0.3; a = a > 1 ? 1 : a; a = a * a * (3 - 2 * a);
    var b = (t - 0.35) / 0.6; b = b < 0 ? 0 : b > 1 ? 1 : b;
    return a * (1 - b * b * (3 - 2 * b));
  }
  function moodSet(key, v, apply) { var o = MOOD.w[key]; if (v - o > 1e-4 || o - v > 1e-4 || MOOD.dirty) { MOOD.w[key] = v; apply(v); } }
  function applyMood(g, rdt) {
    var M = MOOD;
    if (!M.keyC) {
      M.keyC = keyLight.color.clone(); M.keyCool = new THREE.Color(0xe6efff); M.rimC = rimLight ? rimLight.color.clone() : new THREE.Color();
      M.teamC = [new THREE.Color(TEAMC[0]), new THREE.Color(TEAMC[1])];
    }
    M.t = (M.t + rdt) % 3600;
    var sp = g.matchPoint >= 0 ? g.matchPoint : g.setPoint;
    var tensT = sp >= 0 && (g.mode === 'serve' || g.mode === 'rally') && !g.finished;
    if (tensT) { M.team = sp === 1 ? 1 : 0; M.mp = g.matchPoint >= 0 ? 1 : 0; }
    M.tense += ((tensT ? 1 : 0) - M.tense) * (1 - Math.exp(-rdt * (tensT ? 2.6 : 1.8))); // ~0,4 s de entrada, ~0,55 s de salida
    if (M.force >= 0) M.tense = M.force;
    M.pfT += rdt;
    M.win += ((M.winOn ? 1 : 0) - M.win) * (1 - Math.exp(-rdt * 0.9));
    var soft = softK(), pe = pfEnv(M.pfT), hlK = 0.4 + 0.6 * M.pfHl, tn = M.tense, wn = M.win;
    // grada y peldaños
    var cl = 1 - (BEACH.on ? 0.08 : CROWD_DIM) * tn; // a pleno sol (playa) la grada apenas se apaga
    cl = cl * (1 - wn) + wn * (1.04 + 0.1 * soft * Math.sin(M.t * 1.9)); // pulso de 0,3 Hz en la celebración
    moodSet('crowd', cl, function (v) { crowdU.uCrowdLight.value = v; });
    // y la bruma del pabellón se espesa sobre la grada lejana: el foco se queda en la pista
    moodSet('haze', BEACH.on ? 0.12 : HAZE0 + 0.14 * tn, function (v) { crowdU.uHaze.value = v; });
    // haces de luz: más marcados en la tensión, barrido en la celebración
    if (coneMat) {
      moodSet('cone', M.coneBase * (1 + 0.8 * tn + 0.6 * wn), function (v) { coneMat.uniforms.k.value = v; });
      moodSet('sweep', 0.2 * wn, function (v) { coneMat.uniforms.sweep.value = v; });
      if (wn > 1e-3) coneMat.uniforms.uT.value = M.t;
    }
    // principal algo más fría en la tensión (más en punto de partido)
    var kc = (0.5 + 0.25 * M.mp) * tn;
    moodSet('key', kc, function (v) { keyLight.color.copy(M.keyC).lerp(M.keyCool, v); });
    // contraluz: tinte del que anota + subida de intensidad (si la luz está en la escena: en baja de escritorio no)
    if (rimLight) {
      moodSet('rimc', pe, function (v) { rimLight.color.copy(M.rimC).lerp(M.teamC[M.pfTeam], 0.85 * v); });
      if (rimLight.visible) moodSet('rim', M.rimBase + pe * (0.12 + 0.3 * M.pfHl) * soft, function (v) { rimLight.intensity = v; });
    }
    // vallas LED: destello del punto (boost) + latido en el color del equipo con el punto de set (0,8 Hz)
    if (led.mat) {
      moodSet('led', M.ledBase * (1 + 0.55 * pe * hlK * soft), function (v) { led.mat.uniforms.boost.value = v; });
      var ta = tn * (0.2 + 0.12 * Math.sin(M.t * 5.03)) * soft;
      moodSet('tint', ta, function (v) { var T = led.mat.uniforms.tint.value, c = M.teamC[M.team]; T.set(c.r, c.g, c.b, v); });
    }
    if (led.reflMat) moodSet('glow', (led.GLOW || 0) * (soft < 1 ? 0.7 : 1) * (1 + 0.35 * pe * hlK * soft), function (v) { led.reflMat.uniforms.glowK.value = v; });
    if (halos) moodSet('halo', M.haloBase * (1 + 0.7 * pe * hlK * soft + 0.12 * tn), function (v) { halos.material.uniforms.opacity.value = v; });
    M.dirty = false;
  }

  // ---------- Estado runtime ----------
  var emissiveMesh = null;
  var RT = { cheerT: [0, 0], cheerAge: [9, 9], look: 1, cheerMax: [1, 1], waveAmp: 0, waveX: 0, waveT: 0, menuWave: 18, tension: 0, ccT: 0 };
  /** Arranca la alegría de un equipo; si ya estaba saltando no reinicia el escalonado. */
  function startCheer(t, sec) { if (RT.cheerT[t] < 0.3) RT.cheerAge[t] = 0; RT.cheerT[t] = sec; }
  function teamName(t, g) { return g && g.demo ? (t === 0 ? 'LOCAL' : 'VISITA') : (t === 0 ? 'TÚ' : 'CPU'); }
  var REASON = { 'in': 'DENTRO', out: 'FUERA', antenna: 'ANTENA', 'double': 'DOBLES', four: '4 TOQUES', net: 'TOQUE DE RED',
    serve: 'FALTA DE SAQUE', under: 'BAJO LA RED', block: 'BLOQUEO DEL SAQUE', attackServe: 'ATAQUE SOBRE EL SAQUE' };
  var HOW = { ace: '¡ACE!', kill: 'REMATE', tip: 'DEJADA', block: 'BLOQUEO' };
  /** Subtítulo del videomarcador: cómo se ganó; el balón que el rival no pasa de la red no es «DENTRO». */
  function pointSub(e) {
    var net = !!(e.text && /a la red/i.test(e.text));
    if (e.reason === 'in' || (e.reason === 'out' && net)) {
      if (e.reason === 'in' && HOW[e.how]) return HOW[e.how];
      if (net) return e.lastKind === 'serve' ? 'SAQUE A LA RED' : 'BALÓN A LA RED';
    }
    return REASON[e.reason] || '';
  }
  var CC_COL = '#f2c14e'; // dorado del cambio de campo

  function onEvents(g, events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.type) {
        case 'newMatch': MOOD.winOn = false; scoreFromGame(g); break;
        case 'newSet': scoreFromGame(g); break;
        case 'serveReady':
          scoreFromGame(g); SB.serving = e.team;
          if (e.matchPoint >= 0) ledMessage('PUNTO DE PARTIDO', TEAMC[e.matchPoint], 3.2);
          else if (e.setPoint >= 0) ledMessage('PUNTO DE SET', TEAMC[e.setPoint], 3.2);
          break;
        case 'point':
          if (e.score) { SB.score[0] = e.score[0]; SB.score[1] = e.score[1]; } else scoreFromGame(g);
          SB.serving = e.team; SB.dirty = true;
          var w = e.team, mul = e.matchWon ? 3.5 : e.setWon ? 2 : 1;
          startCheer(w, 2.4 * mul); RT.cheerMax[w] = 1;
          RT.cheerT[1 - w] = Math.min(RT.cheerT[1 - w], 0.0);
          flRate = Math.max(flRate, e.matchWon ? 30 : 12);
          if (!e.setWon && !e.matchWon) {
            ledMessage('PUNTO · ' + teamName(w, g), TEAMC[w], 2.6);
            screenMsg('PUNTO ' + teamName(w, g), pointSub(e), TEAMC[w], 2.4);
          }
          refSignal(e, g);
          crewReact(w, (e.highlight || 0) >= 0.6, e.matchWon ? 'match' : e.setWon ? 'set' : 'point');
          MOOD.pfT = 0; MOOD.pfTeam = e.team === 1 ? 1 : 0; MOOD.pfHl = e.highlight != null ? Math.max(0, Math.min(1, e.highlight)) : 0.5;
          // antena: el juez del lado del contacto real (point.antenna) o, si cruzó por fuera, el del lado del balón
          if (e.reason === 'antenna') judgeSignal(0, e.antenna ? e.antenna[1] : g.ball.y, false, true);
          // balón tocado y fuera: el juez que dio «fuera» en el bote pasa a «tocado»
          else if (e.signal === 'touched' && g.lastLand) judgeSignal(g.lastLand.x, g.lastLand.y, false, false, true);
          break;
        case 'land': judgeSignal(e.x, e.y, e.inside, false); break;
        case 'challenge': { // B6: revisión por vídeo. Señal del 1.er árbitro, rótulos en las pantallas y la grada se calla
          var ct = e.team === 1 ? 1 : 0;
          refChallenge();
          ledMessage('VIDEO CHALLENGE', TEAMC[ct], 4.5);
          screenMsg('CHALLENGE', 'REVISIÓN · ' + teamName(ct, g), TEAMC[ct], 4.6);
          RT.cheerT[0] = Math.min(RT.cheerT[0], 0); RT.cheerT[1] = Math.min(RT.cheerT[1], 0);
          break;
        }
        case 'challengeResult': { // IN/OUT con los cm; si se anula, punto para el que lo pidió (marcador desde g)
          var chT = e.team === 1 ? 1 : 0, cmv = Math.abs(+e.dist || 0) * 100, chW = e.overturned ? chT : 1 - chT;
          var chH = (e.truthIn ? 'IN' : 'OUT') + ' · ' + cmv.toFixed(1).replace('.', ',') + ' cm';
          scoreFromGame(g);
          screenMsg(chH, e.overturned ? 'PUNTO ' + teamName(chW, g) : 'SE MANTIENE', TEAMC[chW], 3.2);
          ledMessage(e.overturned ? 'PUNTO · ' + teamName(chW, g) : chH, TEAMC[chW], 3);
          if (e.overturned) { startCheer(chW, 2.6); RT.cheerMax[chW] = 1; crewReact(chW, true, 'point'); }
          if (R1) { R1.seq = [sideStep(1.2, 12, POSE.side, chW, F_OPEN)]; R1.seqT = 0; R1.seqI = 0; R1.sig = 'challengeResult'; }
          break;
        }
        case 'whistle': // autorización del saque: silbato + brazo hacia el equipo que saca
          if (e.reason === 'serve') refAuthorize(g.serving === 1 ? 1 : 0);
          break;
        case 'set':
          if (e.sets) { SB.sets[0] = e.sets[0]; SB.sets[1] = e.sets[1]; }
          ledMessage('SET · ' + teamName(e.team, g), TEAMC[e.team], 4);
          screenMsg('SET ' + teamName(e.team, g), (e.score ? e.score[0] + ' – ' + e.score[1] : ''), TEAMC[e.team], 4);
          RT.waveAmp = 1; RT.waveT = 5;
          break;
        case 'match':
          var win = e.team === 0 && !g.demo;
          ledMessage(win ? '¡VICTORIA!' : 'FIN DEL PARTIDO', TEAMC[e.team], 9);
          screenMsg(win ? '¡VICTORIA!' : 'GANA ' + teamName(e.team, g), 'SETS ' + (e.sets ? e.sets[0] + ' – ' + e.sets[1] : ''), TEAMC[e.team], 9);
          RT.waveAmp = 1; RT.waveT = 10; flRate = 40; MOOD.winOn = true;
          break;
        case 'block':
          if (!e.result || e.result === 'stuff') {
            startCheer(e.team, Math.max(RT.cheerT[e.team], 0.9));
            if (!led.msgOn) ledMessage('¡BLOQUEO!', TEAMC[e.team], 1.4);
          }
          break;
        case 'courtChange': { // reglas 18.2.1 / 18.2.2: momento de "cambio de campo" en todo el pabellón
          // (playa, why 'swap': cada 7 puntos jugados, 5 en el tercer set; mensaje corto, como el de los 8 puntos)
          var eight = e.why === 'eight' || e.why === 'swap', ccDur = (e.pause || (eight ? 1.4 : 1.0)) + (eight ? 2.4 : 2.2);
          // videomarcadores y marcador colgado: encadenado tras el mensaje de SET / PUNTO, con icono de intercambio
          var ccSub = e.why === 'swap' ? 'CADA ' + (e.every || 7) + ' PUNTOS' : eight ? 'SET DECISIVO · 8 PUNTOS' : 'FIN DEL SET ' + e.setNo;
          var ccm = ['CAMBIO DE CAMPO', ccSub, CC_COL, eight ? 2.4 : 2.6, 'swap'];
          if (SB.msgT > 0 && SB.msg) { SB.next = ccm; SB.msgT = Math.min(SB.msgT, eight ? 1.3 : 2.6); } else screenMsg(ccm[0], ccm[1], ccm[2], ccm[3], ccm[4]);
          // vallas LED: "<<< CAMBIO DE CAMPO >>>" en dorado, también encadenado al mensaje en curso
          var lcm = ['CAMBIO DE CAMPO', CC_COL, eight ? 2.6 : 3.0, true];
          if (led.msgOn && led.msgT > 0) { led.next = lcm; led.msgT = Math.min(led.msgT, eight ? 1.3 : 2.4); } else ledMessage(lcm[0], lcm[1], lcm[2], lcm[3]);
          // público: aplauso de reconocimiento (sin saltos) y unos flashes
          RT.ccT = ccDur; flRate = Math.max(flRate, 8);
          break;
        }
        case 'netTouch': // un jugador toca la red: la malla vibra (más suave que un balonazo)
          netRip.a = 0.08; netRip.t = 0; netRip.y = e.y || 0; netRip.dir = e.player && e.player.x < 0 ? 1 : -1;
          break;
        case 'hit':
          if (e.kind === 'spike') flRate = Math.max(flRate, 4);
          break;
        case 'net':
          netRip.a = Math.min(0.22, 0.05 + (Math.hypot(g.ball.vx, g.ball.vy) * 0.02)); netRip.t = 0;
          netRip.y = e.y; netRip.dir = g.ball.x >= 0 ? -1 : 1;
          break;
      }
    }
  }

  /** Matrices fijas: todo el pabellón es estático salvo las personas de arbitraje (sus huesos se animan y el
   *  2.º árbitro se desplaza). Sin esto, three recompone ~250 matrices locales por frame para nada.
   *  (Para que tampoco recalcule las matrices de mundo, main.js puede poner scene.matrixAutoUpdate = false:
   *  ver notes/arena.md.) */
  function freezeStatic() {
    var movers = [];
    for (var i = 0; i < refs.length; i++) movers.push(refs[i].root);
    for (var j = 0; j < judges.length; j++) movers.push(judges[j].root);
    for (var k = 0; k < crew.length; k++) movers.push(crew[k].root);
    root.updateMatrixWorld(true);
    (function walk(o) {
      if (movers.indexOf(o) >= 0) return;
      o.updateMatrix(); o.matrixAutoUpdate = false;
      for (var c = 0; c < o.children.length; c++) walk(o.children[c]);
    })(root);
  }
  /** ARN-08: la luz de la grada (uCrowdLight) también baja en peldaños, asientos, paredes y techo de la malla estática: todo lo
   *  que queda fuera de las vallas y por encima de 0,3 m (el utillaje de pista comparte material y no cambia). */
  function standDim(m) {
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uCrowdLight = crowdU.uCrowdLight;
      sh.vertexShader = 'varying vec3 vVbW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vVbW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uCrowdLight; varying vec3 vVbW;\n' + sh.fragmentShader.replace('#include <output_fragment>',
        ' float vbOut = max(step(' + (BX + 0.7).toFixed(2) + ', abs(vVbW.x)), step(' + (BY + 0.7).toFixed(2) + ', abs(vVbW.z))) * step(0.3, vVbW.y);\n' +
        ' outgoingLight *= mix(1.0, uCrowdLight, vbOut);\n#include <output_fragment>');
    };
    m.customProgramCacheKey = function () { return 'vb-static-stand'; };
    return m;
  }
  /** Copias «de compilación» (ARN-03): por cada combinación material + tipo de objeto, un objeto NUEVO que comparte geometría
   *  y material con el original (no lo saca de su padre ni lo modifica). Visibles y sin recorte: para renderer.compile(). */
  function prewarmProxies(top, out) {
    var seen = [];
    top.traverse(function (o) {
      var m = o.material; if (!m || Array.isArray(m) || !o.geometry && !o.isSprite) return;
      var k = (o.isInstancedMesh ? 'I' : o.isSkinnedMesh ? 'S' : o.isPoints ? 'P' : o.isSprite ? 's' : o.isLine ? 'L' : o.isMesh ? 'M' : '') + (o.instanceColor ? 'c' : '');
      if (!k || k === 'S') return; // las mallas con esqueleto (oficiales) están siempre a la vista: ya compiladas
      for (var i = 0; i < seen.length; i++) if (seen[i][0] === m && seen[i][1] === k) return;
      seen.push([m, k]);
      var px;
      if (o.isInstancedMesh) { px = new THREE.InstancedMesh(o.geometry, m, 1); if (o.instanceColor) px.instanceColor = o.instanceColor; }
      else if (o.isPoints) px = new THREE.Points(o.geometry, m);
      else if (o.isSprite) px = new THREE.Sprite(m);
      else if (o.isLine) px = new THREE.Line(o.geometry, m);
      else px = new THREE.Mesh(o.geometry, m);
      px.castShadow = o.castShadow; px.receiveShadow = o.receiveShadow; px.frustumCulled = false; px.visible = true;
      px.name = 'prewarm:' + (o.name || o.type); px.userData.prewarmOf = o;
      out.push(px);
    });
    return out;
  }
  /* =====================================================================
   * ESCENARIO «PLAYA» — Platja Llarga (9-nov-2026). Segunda sede, SOLO escenario: la sim no cambia (pista 18×9 y reglas de
   * pista cubierta; el modo de reglas de playa queda anotado en TRASPASO.md). Ajuste `arena` ('hall' | 'beach', Ajustes ·
   * Imagen) o ?map=beach (pruebas). Se construye al elegirla en un grupo propio (`beach`) y se libera entera (dispose de
   * geometrías, materiales y texturas) al volver al pabellón. El pabellón NO se destruye: sus piezas se ocultan (0 dibujos)
   * y se comparten red, postes (protección repintada con el nombre de la sede), oficiales, banquillos (las personas) y
   * luces (otro tono e intensidad, mismo número: no recompila nada).
   * Escena: cielo (degradado + sol de dibujo), nubes de dibujo, mar con oleaje y espuma en la orilla (detrás del fondo
   * rival: es el fondo de la cámara de juego), arena (mosaico + variación por vértice + franja mojada), capa de pista
   * (cintas coral, arena rastrillada, hoyuelos y huellas), vallas de lona con el tajo, dos gradas pequeñas de aluminio con
   * toldo y público (el MISMO material animado del pabellón: botes, ola, tensión), palmeras y pinos, sombrillas, hamacas, toallas,
   * chiringuito, silla de socorrista (fuera del eje del fondo), banderas de vela; llaüts y telón del horizonte aparte.
   * Dibujos: cielo, nubes, mar, arena, capa de pista, lona, estática (+ tinta en media/alta) y público = 8-9.
   * ===================================================================== */
  var VENUE = { id: 'hall', names: { hall: 'Palau del Mar', beach: 'Platja Llarga' }, pad: { hall: 'PALAU DEL MAR', beach: 'PLATJA LLARGA' } };
  var BEACH = { on: false, grp: null, hallObjs: null, seaU: null, clouds: null, crowd: null, stat: null, ink: null, sandMat: null, courtMat: null,
    texs: [], save: null, bannerCv: null, bannerTex: null, courtCv: null, courtTex: null, courtPpm: 40,
    hl: null, hw: null, rules: false, net: null, netInk: null, poles: null, light: 'dia', skyU: null };
  // piezas del pabellón que se ocultan en la playa (nombres de los hijos de `root`)
  var HALL_ONLY = { floor: 1, outerFloor: 1, ledBoards: 1, ledRefl: 1, crowd0: 1, crowd1: 1, crowd2: 1, crowd3: 1, crowdImp: 1, flags: 1, endScreen: 1,
    hungScreens: 1, hallShell: 1, halos: 1, lightCones: 1, banners: 1, hallName: 1, camFlashes: 1, 'static': 1, emissive: 1, props: 1 };
  var SHORE_X = -27;                 // orilla media (sim)
  var BLY = 12.2, BLX = 9.5;         // gradas de la playa: primera fila a |y| = 12,2; de x = -9,5 a 9,5
  var BSKY = { zen: '#2f8ff2', hor: '#9fd6ff', fog: '#cce8f6', sun: '#fff3c4' };
  // Luz de la playa: 'dia' (mediodía) o 'tarde' (opcional: sol bajo sobre el mar, cálido). ?luz=tarde o ajuste `beachLight`
  // ('dia' | 'tarde'; VB.Arena.beachLight(modo) en vivo). Mismas luces (solo color e intensidad): no recompila nada.
  var BLOOK = {
    dia: { sky: BSKY, sun: [-0.82, 0.36, 0.44], hemi: 0xd4ecff, ground: 0xf2d29c, key: 0xfff0d4, fill: 0xcfe4ff, rim: 0xffe2b4, keyK: 1, hemiK: 1,
      deep: '#1c82d4', shal: '#4fd8d2', foam: '#ffffff', tint: '#ffffff' },
    tarde: { sky: { zen: '#4d6cc8', hor: '#ffc796', fog: '#f4d6b8', sun: '#ffe2a8' }, sun: [-0.9, 0.14, 0.15], hemi: 0xffd9bc, ground: 0xe9b47e,
      key: 0xffbf7a, fill: 0xb9c6ff, rim: 0xffb070, keyK: 1.08, hemiK: 0.82, deep: '#2d5fae', shal: '#5cbcc0', foam: '#fff1dc', tint: '#ffd6b8' } };
  function beachPal() { return BLOOK[BEACH.light] || BLOOK.dia; }
  function wantLight() {
    var p = ctx.params && (ctx.params.luz || ctx.params.light);
    if (p === 'tarde' || p === 'dia') return p;
    return ctx.settings && ctx.settings.beachLight === 'tarde' ? 'tarde' : 'dia';
  }
  /** Colores de cielo, mar, telón y nubes según la luz (la niebla y las luces, en venueLook). */
  function beachTint() {
    var L = beachPal(), U = BEACH.skyU;
    if (U) { U.uZen.value.set(L.sky.zen); U.uHor.value.set(L.sky.hor); U.uSunC.value.set(L.sky.sun); VB.toThree(L.sun[0], L.sun[1], L.sun[2], U.uSun.value); U.uSun.value.normalize(); }
    if (BEACH.seaU) { BEACH.seaU.uDeep.value.set(L.deep); BEACH.seaU.uShal.value.set(L.shal); BEACH.seaU.uFoam.value.set(L.foam); }
    if (BEACH.backdrop) BEACH.backdrop.material.color.set(L.tint);
    if (BEACH.clouds) BEACH.clouds.material.color.set(L.tint);
  }
  // luces de día: multiplicadores sobre la fila LT del nivel (key, hemi, fill, rim, floor = tinte de la arena)
  var BL = { key: 1.0, hemi: 2.3, fill: 0.8, rim: 0.7, floor: 1.14 };
  var _mo = null, _ml = null, BT = null, BGEO = null, lastQ = null;

  /** Matriz del objeto (coords de sim del pie, giro en three, escala). Las piezas se dan en coords locales de three. */
  function objM(sx, sy, yaw, sc) { VB.toThree(sx, sy, 0, _p); _e.set(0, yaw || 0, 0, 'YXZ'); _q.setFromEuler(_e); _s.set(sc || 1, sc || 1, sc || 1); return _mo.compose(_p, _q, _s); }
  function part(B, g, x, y, z, color, rx, ry, rz, w, h, d) {
    _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e); _s.set(w || 1, h || w || 1, d || w || 1); _p.set(x, y, z);
    _ml.compose(_p, _q, _s).premultiply(_mo); B.add(g, _ml, color);
  }
  /** Barra (cilindro de radio r) entre dos puntos locales; g opcional (tronco que se estrecha). */
  function lrod(B, ax, ay, az, bx, by, bz, r, color, g) {
    BT.a.set(ax, ay, az); BT.b.set(bx, by, bz); var len = BT.a.distanceTo(BT.b);
    BT.m.addVectors(BT.a, BT.b).multiplyScalar(0.5); BT.b.sub(BT.a).normalize(); BT.q.setFromUnitVectors(BT.up, BT.b); BT.s.set(r, len, r);
    _ml.compose(BT.m, BT.q, BT.s).premultiply(_mo); B.add(g || BGEO.rod, _ml, color);
  }
  /** Tira de dos caras (lista de pares [izq, der] de puntos locales): hojas, velas, banderas. */
  function stripGeo(rows) {
    var P = [];
    function tri(a, b, c) { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); P.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]); }
    for (var i = 0; i < rows.length - 1; i++) {
      var r0 = rows[i], r1 = rows[i + 1];
      for (var k = 0; k < r0.length - 1; k++) { tri(r0[k], r0[k + 1], r1[k + 1]); tri(r0[k], r1[k + 1], r1[k]); }
    }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
  }
  function taperGeo(k) {
    k = Math.round(k * 20) / 20; var key = 't' + k;
    if (!BGEO[key]) BGEO[key] = new THREE.CylinderGeometry(k, 1, 1, 7, 1, true);
    return BGEO[key];
  }
  function beachGeos() {
    BGEO = { rod: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1), sph: new THREE.SphereGeometry(1, 10, 7), sph6: new THREE.SphereGeometry(1, 6, 4),
      hemi: new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), cone4: new THREE.ConeGeometry(1, 1, 4, 1), cone6: new THREE.ConeGeometry(1, 1, 6, 1),
      torus: new THREE.TorusGeometry(1, 0.3, 6, 14) };
    // hoja de palmera: nervio que cae, borde dentado (anchos alternos) y en V (las bandas del toon la leen)
    var rows = [], n = 8, L = 2.5, W = 0.46; // 8 tramos (antes 12): misma silueta, un tercio menos de triángulos
    for (var i = 0; i <= n; i++) {
      var t = i / n, w = W * Math.sin(Math.PI * Math.min(1, 0.08 + t * 1.02)) * (i % 2 ? 1 : 0.72), x = t * L, y = -1.15 * t * t;
      rows.push([[x, y + w * 0.3, w], [x, y, 0], [x, y + w * 0.3, -w]]);
    }
    BGEO.frond = stripGeo(rows);
    // cuña de sombrilla (1/8): vértice, anillo medio y borde festoneado
    var th = Math.PI / 4, A = [0, 1, 0], m0 = [0.6, 0.7, 0], m1 = [0.6 * Math.cos(th), 0.7, -0.6 * Math.sin(th)];
    var r0 = [1, 0.18, 0], r1 = [Math.cos(th), 0.18, -Math.sin(th)], rm = [0.92 * Math.cos(th / 2), 0.04, -0.92 * Math.sin(th / 2)];
    var P = [];
    [[A, m0, m1], [m0, r0, rm], [m0, rm, m1], [m1, rm, r1]].forEach(function (t) { P.push.apply(P, t[0].concat(t[1], t[2], t[0], t[2], t[1])); });
    var wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); wg.computeVertexNormals(); BGEO.wedge = wg;
    // vela de bandera (2,6 m): borde exterior que se curva hacia el mástil arriba, algo de viento
    var fr = [];
    for (var j = 0; j <= 8; j++) {
      var u = j / 8, yy = 0.5 + u * 2.6, wd = 0.72 * (0.7 + 0.3 * u) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (u - 0.7) / 0.3), 2)));
      // bolsa de viento marcada (0,26 m): de canto se lee como vela curvada, no como un palo
      fr.push([[0, yy, 0], [wd * 0.33, yy, 0.2], [wd * 0.66, yy, 0.26], [wd, yy, 0.12]]);
    }
    BGEO.flag = stripGeo(fr);
    // vela latina de los llaüts: triángulo colgado de la antena (baja a proa) con algo de bolsa
    BGEO.lateen = stripGeo([[[1.8, 1.0, 0], [0.05, 2.75, 0.28], [-1.7, 4.5, 0]], [[-1.3, 0.8, 0], [-1.3, 0.8, 0.01], [-1.3, 0.8, 0]]]);
    var ln = BGEO.lateen.attributes.normal; for (var q2 = 0; q2 < ln.count; q2++) ln.setXYZ(q2, 0, 1, 0); // vela siempre al sol (de lejos, la cara en sombra salía negra)
  }

  /* ---------- cielo y nubes ---------- */
  var SKY_VS = 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var SKY_FS = [
    'uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSunC; uniform vec3 uSun; uniform vec3 fogColor; varying vec3 vD;',
    'void main(){ vec3 d = normalize(vD); float h = d.y;',
    ' vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.4, h));',
    ' float s = dot(d, uSun);',
    // CARTOON: disco de borde duro, aro claro y halo amplio y suave
    ' float disc = smoothstep(0.9978, 0.9983, s);',
    ' c += vec3(1.0, 0.92, 0.75) * (0.16 * pow(max(s, 0.0), 18.0) + 0.22 * smoothstep(0.990, 0.9972, s) * (1.0 - disc));',
    ' c = mix(c, uSunC * 1.25, disc);',
    ' gl_FragColor = vec4(c, 1.0);',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    // horizonte = color de la niebla (igual que fog_fragment de three r149): el mar y la arena se funden sin costura
    ' gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - smoothstep(-0.02, 0.09, h));',
    '}'].join('\n');
  function cloudAtlas() {
    var cv = canvas(1024, 512), g = cv.getContext('2d');
    for (var k = 0; k < 4; k++) {
      var ox = (k % 2) * 512, oy = Math.floor(k / 2) * 256, base = oy + 206, n = 5 + (k % 3), P = [];
      for (var i = 0; i < n; i++) { var t = (i + 0.5) / n, r = 34 + Math.sin(t * Math.PI) * (46 + rnd() * 34); P.push([ox + 62 + t * 388, base - r * 0.7 - rnd() * 12, r]); }
      var circ = function (pad) { g.beginPath(); for (var q = 0; q < P.length; q++) { g.moveTo(P[q][0] + P[q][2] + pad, P[q][1]); g.arc(P[q][0], P[q][1], P[q][2] + pad, 0, Math.PI * 2); } g.fill(); };
      g.save(); g.beginPath(); g.rect(ox, oy, 512, base - oy + 6); g.clip(); g.fillStyle = '#1d1530'; circ(6); g.restore();
      g.save(); g.beginPath(); g.rect(ox, oy, 512, base - oy); g.clip(); g.fillStyle = '#ffffff'; circ(0);
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = '#cfe2f6'; g.fillRect(ox, base - 40, 512, 40);
      g.fillStyle = '#e6f0fb'; g.fillRect(ox, base - 58, 512, 18);
      g.restore();
    }
    return cv;
  }
  function beachSky(G) {
    var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uZen: { value: new THREE.Color(BSKY.zen) }, uHor: { value: new THREE.Color(BSKY.hor) },
      uSunC: { value: new THREE.Color(BSKY.sun) }, uSun: { value: new THREE.Vector3() } }]);
    VB.toThree(-0.82, 0.36, 0.44, U.uSun.value); U.uSun.value.normalize(); // sol sobre el mar, delante de la cámara de juego
    BEACH.skyU = U; // (beachTint pone los colores y el sol de la luz elegida)
    var sky = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16),
      new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: true }));
    sky.name = 'beachSky'; sky.renderOrder = -10; sky.frustumCulled = false; G.add(sky);
    // nubes: tarjetas mirando al centro, en un anillo a 140-165 m, con un atlas de 4 nubes (1 dibujo; giran muy despacio)
    var tex = texOf(cloudAtlas()); BEACH.texs.push(tex);
    var P = [], UV = [], up = new THREE.Vector3(0, 1, 0), c = new THREE.Vector3(), r = new THREE.Vector3();
    for (var i = 0; i < 11; i++) {
      var a = i / 11 * TAU + rnd() * 0.35, D = 145 + rnd() * 25, hh = 26 + rnd() * 30, w = 24 + rnd() * 20, h = w * 0.5, k = i % 4;
      c.set(Math.cos(a) * D, hh, Math.sin(a) * D); r.set(-Math.sin(a), 0, Math.cos(a));
      var u0 = (k % 2) * 0.5, v1 = 1 - Math.floor(k / 2) * 0.5, v0 = v1 - 0.5;
      var q = [[-1, -1, u0, v0], [1, -1, u0 + 0.5, v0], [1, 1, u0 + 0.5, v1], [-1, -1, u0, v0], [1, 1, u0 + 0.5, v1], [-1, 1, u0, v1]];
      for (var j = 0; j < 6; j++) { P.push(c.x + r.x * q[j][0] * w / 2, c.y + q[j][1] * h / 2, c.z + r.z * q[j][0] * w / 2); UV.push(q[j][2], q[j][3]); }
    }
    var cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    var cl = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    cl.name = 'beachClouds'; cl.renderOrder = -9; cl.frustumCulled = false; G.add(cl); BEACH.clouds = cl;
  }

  /* ---------- mar ---------- */
  var SEA_VS = [
    'uniform float uT; varying vec3 vW;',
    '#include <fog_pars_vertex>',
    'void main(){ vec4 wp = modelMatrix * vec4(position, 1.0);',
    ' float far = smoothstep(-34.0, -70.0, wp.x);',
    ' wp.y += far * (sin(wp.x * 0.21 + uT * 1.1) * 0.16 + sin(wp.z * 0.17 - uT * 0.7) * 0.1);',
    ' vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;',
    '#include <fog_vertex>',
    '}'].join('\n');
  var SEA_FS = [
    'uniform float uT; uniform float uShore; uniform vec3 uDeep; uniform vec3 uShal; uniform vec3 uFoam; varying vec3 vW;',
    '#include <fog_pars_fragment>',
    'void main(){ float x = vW.x, z = vW.z;',
    // la orilla sube y baja (resaca) y se ondula a lo largo de la playa
    ' float sh = uShore + sin(uT * 0.55) * 1.1 + sin(z * 0.13 + uT * 0.4) * 0.5 + sin(z * 0.31 - uT * 0.23) * 0.25;',
    ' float d = sh - x; if (d < 0.0) discard;',
    ' vec3 c = mix(uShal, uDeep, smoothstep(1.5, 30.0, d));',
    // olas de dibujo: bandas claras que llegan a la orilla, más tenues mar adentro
    ' float wv = fract(d * 0.085 - uT * 0.11 + sin(z * 0.07) * 0.25 + sin(z * 0.023 + 1.7) * 0.6);',
    ' float fw = fwidth(d * 0.085) * 1.5;',
    ' float band = smoothstep(0.0, 0.02 + fw, wv) * (1.0 - smoothstep(0.05, 0.08 + fw, wv));',
    ' c = mix(c, uFoam, band * 0.55 * (1.0 - smoothstep(25.0, 80.0, d)));',
    // espuma de la orilla: festón blanco con una segunda línea fina detrás
    ' float sc = 0.55 + 0.22 * sin(z * 1.7 + uT * 1.3) + 0.14 * sin(z * 3.1 - uT * 0.9);',
    ' float foam = 1.0 - smoothstep(sc, sc + 0.07, d);',
    ' float f2 = smoothstep(sc + 0.5, sc + 0.56, d) * (1.0 - smoothstep(sc + 0.66, sc + 0.72, d));',
    ' c = mix(c, uFoam, max(foam, f2 * 0.8));',
    // ola que rompe: cada ~7 s una cresta avanza hacia la orilla, se aclara el agua delante y se deshace en espuma al llegar
    ' float wp = fract(uT * 0.14 + sin(z * 0.045) * 0.07); float wd = mix(17.0, 0.9, wp * wp);',
    ' float fc = fwidth(d) * 1.2, crest = 1.0 - smoothstep(0.2 + fc, 0.34 + fc + wp * 0.25, abs(d - wd));',
    ' float brk = smoothstep(0.6, 0.95, wp) * (0.5 + 0.5 * sin(z * 2.1 + uT * 1.6));',
    ' c = mix(c, uShal * 1.1, (1.0 - smoothstep(0.0, 3.0, wd - d)) * step(d, wd) * 0.3 * wp);',
    ' c = mix(c, uFoam, crest * (0.3 + 0.6 * wp) * (1.0 - brk * 0.7));',
    ' gl_FragColor = vec4(c, 1.0);',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    '#include <fog_fragment>',
    '}'].join('\n');
  function beachSea(G) {
    var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uShore: { value: SHORE_X }, uDeep: { value: new THREE.Color('#1c82d4') },
      uShal: { value: new THREE.Color('#4fd8d2') }, uFoam: { value: new THREE.Color('#ffffff') } }]);
    var m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SEA_VS, fragmentShader: SEA_FS, fog: true });
    m.extensions.derivatives = true;
    var geo = new THREE.PlaneGeometry(220, 470, 44, 24); geo.rotateX(-Math.PI / 2); geo.translate(SHORE_X + 3 - 110, 0.025, 0);
    var sea = new THREE.Mesh(geo, m); sea.name = 'beachSea'; sea.frustumCulled = false; G.add(sea); BEACH.seaU = U;
  }

  /* ---------- arena y capa de la pista ---------- */
  function sandTile() {
    var N = 512, cv = canvas(N, N), g = cv.getContext('2d');
    g.fillStyle = '#f6d396'; g.fillRect(0, 0, N, N);
    function wrapAt(x, y, r, fn) { for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) { var X = x + dx * N, Y = y + dy * N; if (X + r > 0 && X - r < N && Y + r > 0 && Y - r < N) fn(X, Y); } }
    // manchas grandes y suaves (dunas)
    for (var i = 0; i < 26; i++) {
      var bx = rnd() * N, by = rnd() * N, br = 40 + rnd() * 70, lt = rnd() < 0.5;
      wrapAt(bx, by, br, function (X, Y) { var gr = g.createRadialGradient(X, Y, 0, X, Y, br); gr.addColorStop(0, lt ? 'rgba(255,240,205,0.22)' : 'rgba(200,150,85,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - br, Y - br, br * 2, br * 2); });
    }
    // rizos del viento: arcos claros con su sombra debajo
    // (pocos, cortos, de tamaño y giro variados y tenues: muchos e iguales se leían como escamas al repetirse el mosaico)
    for (var j = 0; j < 22; j++) {
      var rx = rnd() * N, ry = rnd() * N, rr = 24 + rnd() * 70, rot = (rnd() - 0.5) * 0.9, sp = 0.18 + rnd() * 0.22, a0 = -Math.PI / 2 + rot - sp, a1 = -Math.PI / 2 + rot + sp;
      wrapAt(rx, ry, rr, function (X, Y) {
        g.lineWidth = 2; g.strokeStyle = 'rgba(190,135,70,0.12)'; g.beginPath(); g.arc(X, Y + 3, rr, a0, a1); g.stroke();
        g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,246,222,0.32)'; g.beginPath(); g.arc(X, Y, rr, a0, a1); g.stroke();
      });
    }
    // granos
    for (var k = 0; k < 2400; k++) { var dk = rnd() < 0.55; g.fillStyle = dk ? 'rgba(175,125,65,0.32)' : 'rgba(255,248,228,0.55)'; var s = rnd() < 0.8 ? 1 : 2; g.fillRect(Math.floor(rnd() * N), Math.floor(rnd() * N), s, s); }
    // conchas y piedrecitas
    for (var c = 0; c < 7; c++) { var cx = 8 + rnd() * (N - 16), cy = 8 + rnd() * (N - 16); g.fillStyle = rnd() < 0.5 ? '#ffe2d6' : '#fff7ee'; g.beginPath(); g.ellipse(cx, cy, 4, 3, rnd() * 3, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(160,100,80,0.5)'; g.lineWidth = 1; g.stroke(); }
    for (var p = 0; p < 9; p++) { var px = 6 + rnd() * (N - 12), py = 6 + rnd() * (N - 12); g.fillStyle = rnd() < 0.5 ? '#a89c8e' : '#8a8178'; g.beginPath(); g.ellipse(px, py, 2.5 + rnd() * 2, 2, rnd() * 3, 0, Math.PI * 2); g.fill(); }
    return cv;
  }
  function drawBeachCourt(cv, ppm) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, HL = BEACH.hl || C.HL, HW = BEACH.hw || C.HW;
    function X(x) { return (x + TX) * ppm; }
    function Y(y) { return (TY - y) * ppm; }
    function rect(x0, y0, x1, y1) { g.fillRect(X(x0), Y(y1), (x1 - x0) * ppm, (y1 - y0) * ppm); }
    function ell(x, y, rx, ry, a) { g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), a || 0, 0, Math.PI * 2); g.fill(); }
    var sd = _seed; _seed = 55117;
    g.clearRect(0, 0, W, H);
    // velo de arena casi transparente: los mips de la textura no oscurecen los bordes de cintas y huellas
    g.fillStyle = 'rgba(243,214,160,0.03)'; g.fillRect(0, 0, W, H);
    // pista rastrillada: más clara y lisa, con surcos finos a lo largo
    g.fillStyle = 'rgba(255,246,222,0.2)'; rect(-HL, -HW, HL, HW);
    for (var ry = -HW + 0.09; ry < HW; ry += 0.2) { g.fillStyle = 'rgba(175,120,60,0.08)'; rect(-HL, ry, HL, ry + 0.025); g.fillStyle = 'rgba(255,250,236,0.12)'; rect(-HL, ry + 0.025, HL, ry + 0.05); }
    // hoyuelos de pisadas: muchos junto a las líneas y en la zona de saque, menos en el centro de cada campo
    for (var i = 0; i < 1700; i++) {
      var x = (rnd() * 2 - 1) * (HL + 3.6), y = (rnd() * 2 - 1) * (HW + 2.8);
      var edge = Math.min(Math.abs(Math.abs(x) - HL), Math.abs(Math.abs(y) - HW)), keep = edge < 1.4 ? 1 : (Math.abs(x) < HL && Math.abs(y) < HW ? 0.45 : 0.7);
      if (rnd() > keep) continue;
      var r = (0.05 + rnd() * 0.07) * ppm, px = X(x), py = Y(y);
      g.fillStyle = 'rgba(150,98,42,0.15)'; ell(px, py + r * 0.22, r, r * 0.62, 0);
      g.fillStyle = 'rgba(255,249,230,0.2)'; ell(px, py - r * 0.36, r * 0.78, r * 0.32, 0);
    }
    // huellas de pies descalzos en algunos caminos (banquillo → pista, saque → fondo)
    var trails = [[5.2, 9.9, 3.0, 4.6], [-5.2, 9.9, -3.4, 4.2], [11.5, 1.5, 9.4, 0.4], [-11.2, -1.8, -9.3, -0.6], [0.6, -9.6, 1.6, -4.6], [12.2, -3.4, 10.4, -6.8]];
    for (var t = 0; t < trails.length; t++) {
      var T = trails[t], len = Math.hypot(T[2] - T[0], T[3] - T[1]), n = Math.floor(len / 0.36), ang = Math.atan2(-(T[3] - T[1]), T[2] - T[0]);
      for (var s = 0; s < n; s++) {
        var u = s / n, side = s % 2 ? 1 : -1, fx = T[0] + (T[2] - T[0]) * u, fy = T[1] + (T[3] - T[1]) * u;
        var ox = -Math.sin(-ang) * 0.09 * side, oy = Math.cos(-ang) * 0.09 * side, cx = X(fx + ox), cy = Y(fy + oy);
        g.fillStyle = 'rgba(140,90,40,0.2)'; ell(cx, cy, 0.12 * ppm, 0.05 * ppm, ang);
        for (var d = 0; d < 3; d++) ell(cx + Math.cos(ang) * 0.15 * ppm + Math.sin(ang) * (d - 1) * 0.03 * ppm, cy + Math.sin(ang) * 0.15 * ppm - Math.cos(ang) * (d - 1) * 0.03 * ppm, 0.02 * ppm, 0.018 * ppm, 0);
      }
    }
    // cintas (5 cm, DENTRO de la pista como las líneas del pabellón): CORAL (identidad propia; no las azules de siempre) con filo oscuro y brillo central
    var L = 0.05;
    function tape(x0, y0, x1, y1) {
      g.fillStyle = 'rgba(110,28,18,0.55)'; rect(x0 - 0.016, y0 - 0.016, x1 + 0.016, y1 + 0.016);
      g.fillStyle = '#f2401f'; rect(x0, y0, x1, y1);
      g.fillStyle = 'rgba(255,255,255,0.28)'; if (x1 - x0 > y1 - y0) rect(x0, (y0 + y1) / 2 - 0.006, x1, (y0 + y1) / 2 + 0.006); else rect((x0 + x1) / 2 - 0.006, y0, (x0 + x1) / 2 + 0.006, y1);
    }
    tape(-HL, HW - L, HL, HW); tape(-HL, -HW, HL, -HW + L); tape(-HL, -HW, -HL + L, HW); tape(HL - L, -HW, HL, HW);
    // líneas de ataque: en la playa no existen; solo si la partida juega con reglas de pista cubierta (p. ej. 6v6): cordel discontinuo
    var A = BEACH.rules ? 99 : C.ATTACK;
    for (var sx = -1; sx <= 1 && A < HL; sx += 2) for (var dy = -HW + 0.1; dy < HW - 0.1; dy += 0.5) {
      g.fillStyle = 'rgba(214,60,40,0.5)'; var xa = sx > 0 ? A - 0.035 : -A;
      rect(xa, dy, xa + 0.035, Math.min(HW - 0.1, dy + 0.3));
    }
    // anclajes de las cintas: piquetas de madera en las esquinas y bajo la red
    g.fillStyle = '#7a4a26';
    [[HL, HW], [HL, -HW], [-HL, HW], [-HL, -HW], [0, HW], [0, -HW]].forEach(function (p) { var ax = p[0] + (p[0] > 0 ? 0.06 : p[0] < 0 ? -0.06 : 0), ay = p[1] + (p[1] > 0 ? 0.06 : -0.06); ell(X(ax), Y(ay), 0.05 * ppm, 0.05 * ppm, 0); });
    _seed = sd;
  }
  function beachSand(G) {
    var tile = texOf(sandTile()); tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.anisotropy = Math.min(16, ctx.renderer.capabilities.getMaxAnisotropy());
    var SW = 210, SH = 340; tile.repeat.set(SW / 7.5, SH / 7.5); BEACH.texs.push(tile);
    var geo = new THREE.PlaneGeometry(SW, SH, 42, 24); geo.rotateX(-Math.PI / 2); geo.translate(-40 + SW / 2, 0, 0); // 5 m a lo ancho (franja mojada), 14 m a lo largo
    var pa = geo.attributes.position, cols = new Float32Array(pa.count * 3);
    for (var i = 0; i < pa.count; i++) {
      var x = pa.getX(i), y = -pa.getZ(i);
      var n = 0.5 + 0.5 * (Math.sin(x * 0.071 + 0.4) * Math.sin(y * 0.053 + 1.3) * 0.6 + Math.sin(x * 0.19 - y * 0.13) * 0.4);
      var k = 0.93 + 0.1 * n, wet = Math.min(1, Math.max(0, (-21 - x) / 5.5)); wet = wet * wet * (3 - 2 * wet);
      cols[i * 3] = k * (1 - wet * 0.24); cols[i * 3 + 1] = k * (1 - wet * 0.3); cols[i * 3 + 2] = k * (1 - wet * 0.36);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    var sand = new THREE.Mesh(geo, BEACH.sandMat = VB.TOON.toonMat({ map: tile, vertexColors: true }));
    sand.name = 'beachSand'; sand.receiveShadow = true; G.add(sand);
    // capa de la pista (cintas, rastrillado, huellas): transparente sobre la arena, sin costura en sus bordes
    var ppm = BEACH.courtPpm = ctx.isMobile ? 26 : 40, cv = BEACH.courtCv = canvas(Math.round(2 * TX * ppm), Math.round(2 * TY * ppm));
    drawBeachCourt(cv, ppm);
    var ct = BEACH.courtTex = texOf(cv); ct.anisotropy = Math.min(16, ctx.renderer.capabilities.getMaxAnisotropy()); BEACH.texs.push(ct);
    var court = new THREE.Mesh(new THREE.PlaneGeometry(2 * TX, 2 * TY), BEACH.courtMat = VB.TOON.toonMat({ map: ct, transparent: true, depthWrite: false }));
    court.rotation.x = -Math.PI / 2; court.position.y = 0.006; court.renderOrder = -1; court.receiveShadow = true; court.name = 'beachCourt'; G.add(court);
  }

  /* ---------- vallas de lona con marcas ---------- */
  function beachBrands() {
    return BRANDS.map(function (b) { return b.name === 'PALAU DEL MAR' ? { name: 'PLATJA LLARGA', fg: '#ffffff', bg: ['#0f8fb3', '#22b8d6'], deco: 'cut' } : b; });
  }
  function drawBeachBanners(cv) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, BB = beachBrands(), seg = W / BB.length;
    for (var i = 0; i < BB.length; i++) {
      var b = BB[i], x0 = i * seg, gr = g.createLinearGradient(x0, 0, x0, H);
      gr.addColorStop(0, b.bg[1]); gr.addColorStop(1, b.bg[0]); g.fillStyle = gr; g.fillRect(x0, 0, seg, H);
      // lona: dobladillo claro arriba y abajo con ojales
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x0, 0, seg, H * 0.07); g.fillRect(x0, H * 0.93, seg, H * 0.07);
      g.fillStyle = 'rgba(29,21,48,0.55)'; for (var o = x0 + H * 0.3; o < x0 + seg; o += H * 0.9) { g.fillRect(o, H * 0.015, H * 0.04, H * 0.04); g.fillRect(o, H * 0.945, H * 0.04, H * 0.04); }
      // el «tajo» al final de cada lona: corte diagonal blanco con filo oscuro (sello propio, no las ondas y soles de siempre)
      var tx = x0 + seg - H * 1.05;
      g.fillStyle = 'rgba(29,21,48,0.55)'; g.beginPath(); g.moveTo(tx - H * 0.06, H); g.lineTo(tx + H * 0.3, 0); g.lineTo(tx + H * 0.64, 0); g.lineTo(tx + H * 0.28, H); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(tx, H); g.lineTo(tx + H * 0.36, 0); g.lineTo(tx + H * 0.58, 0); g.lineTo(tx + H * 0.22, H); g.fill();
      drawDeco(g, b.deco, x0 + H * 0.62, H * 0.5, H * 0.86, b.fg);
      g.fillStyle = b.fg; g.textAlign = 'left'; g.textBaseline = 'middle';
      var fs = Math.round(H * 0.56); g.font = 'italic 900 ' + fs + 'px ' + FONT;
      while (g.measureText(b.name).width > seg - H * 2.3 && fs > 10) { fs -= 2; g.font = 'italic 900 ' + fs + 'px ' + FONT; }
      g.fillText(b.name, x0 + H * 1.12, H * 0.53);
      g.fillStyle = '#1d1530'; g.fillRect(x0 + seg - 3, 0, 3, H);
    }
  }
  function beachBanners(G, B) {
    var hi = !ctx.isMobile, cv = BEACH.bannerCv = canvas(hi ? 4096 : 2048, hi ? 128 : 64); drawBeachBanners(cv);
    var tex = BEACH.bannerTex = texOf(cv); tex.wrapS = THREE.RepeatWrapping; BEACH.texs.push(tex);
    var P = [], UV = [], h = 0.8, z0 = 0.12, uPerM = cv.height / (h * cv.width), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pd = new THREE.Vector3();
    var frame = col('#e9eef3'), dark = col('#2a3550');
    function put(v, u, vv) { P.push(v.x, v.y, v.z); UV.push(u, vv); }
    function banner(cx, cy, len, nx, ny) {
      var rx = -ny, ry = nx, u0 = rnd(), u1 = u0 + len * uPerM;
      for (var side = 0; side < 2; side++) {
        var off = side ? -0.012 : 0, ox = nx * off, oy = ny * off, sg = side ? -1 : 1, ua = side ? u1 : u0, ub = side ? u0 : u1;
        VB.toThree(cx - rx * len / 2 + ox, cy - ry * len / 2 + oy, z0, pa); VB.toThree(cx + rx * len / 2 + ox, cy + ry * len / 2 + oy, z0, pb);
        VB.toThree(cx + rx * len / 2 + ox, cy + ry * len / 2 + oy, z0 + h, pc); VB.toThree(cx - rx * len / 2 + ox, cy - ry * len / 2 + oy, z0 + h, pd);
        // cara delantera (mira a la pista) y trasera (el texto se lee también desde fuera)
        if (sg > 0) { put(pa, ua, 0); put(pb, ub, 0); put(pc, ub, 1); put(pa, ua, 0); put(pc, ub, 1); put(pd, ua, 1); }
        else { put(pa, ua, 0); put(pc, ub, 1); put(pb, ub, 0); put(pa, ua, 0); put(pd, ua, 1); put(pc, ub, 1); }
      }
      // bastidor: postes cada ~3 m y travesaño de arriba, detrás de la lona
      objM(0, 0, 0, 1);
      var np = Math.max(2, Math.round(len / 3) + 1);
      for (var k = 0; k < np; k++) {
        var f = k / (np - 1) - 0.5, px = cx + rx * len * f - nx * 0.04, py = cy + ry * len * f - ny * 0.04;
        lrod(B, px, 0, -py, px, z0 + h + 0.05, -py, 0.03, frame);
      }
      lrod(B, cx - rx * len / 2 - nx * 0.04, z0 + h + 0.03, -(cy - ry * len / 2 - ny * 0.04), cx + rx * len / 2 - nx * 0.04, z0 + h + 0.03, -(cy + ry * len / 2 - ny * 0.04), 0.022, dark);
    }
    banner(0, BY, 2 * FZX, 0, -1); banner(0, -BY, 2 * FZX, 0, 1); banner(BX, 0, 2 * FZY, -1, 0); banner(-BX, 0, 2 * FZY, 1, 0);
    var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.computeVertexNormals();
    var m = new THREE.Mesh(geo, VB.TOON.toonMat({ map: tex })); m.name = 'beachBanners'; m.receiveShadow = true; G.add(m);
  }

  /* ---------- gradas de aluminio con toldo (y sus asientos para el público) ---------- */
  function beachStands(B) {
    var seats = [], alu = col('#c9d3de'), aluD = col('#9aa6b4'), frame = col('#2f6fb6'), canA = col('#ffffff'), canB = col('#22b8d6'), canC = col('#ff6b5a');
    objM(0, 0, 0, 1);
    for (var s = -1; s <= 1; s += 2) {
      var rows = 5;
      for (var r = 0; r < rows; r++) {
        var yc = s * (BLY + 0.55 + r * 0.8), zs = 0.45 + r * 0.42;
        B.sbox(2 * BLX, 0.32, 0.05, 0, yc, zs - 0.025, alu);                                  // asiento
        B.sbox(2 * BLX, 0.3, 0.035, 0, s * (BLY + 0.18 + r * 0.8), zs - 0.42 + 0.03, aluD);    // reposapiés
        for (var sx = -BLX; sx <= BLX + 0.01; sx += 3.8) { var y0 = s * (BLY + 0.55 + r * 0.8 + 0.12); lrod(B, sx, 0, -y0, sx, zs - 0.03, -y0, 0.035, frame); }
        for (var si = -BLX + 0.42; si < BLX - 0.3; si += SEAT_W) if (rnd() < 0.74) seats.push({ x: si + (rnd() - 0.5) * 0.12, y: yc + s * 0.02, z: zs, fx: 0, fy: -s, row: r });
      }
      // largueros inclinados y barandilla trasera
      var ytop = s * (BLY + 0.55 + (rows - 1) * 0.8 + 0.22), ztop = 0.45 + (rows - 1) * 0.42;
      for (var lx = -BLX; lx <= BLX + 0.01; lx += 3.8) {
        lrod(B, lx, 0, -(s * BLY), lx, ztop, -ytop, 0.045, frame);
        lrod(B, lx, ztop, -ytop, lx, ztop + 1.0, -ytop, 0.03, frame);
      }
      lrod(B, -BLX, ztop + 1.0, -ytop, BLX, ztop + 1.0, -ytop, 0.03, frame);
      lrod(B, -BLX, ztop + 0.5, -ytop, BLX, ztop + 0.5, -ytop, 0.025, frame);
      // toldo a rayas sobre las filas altas, con faldón festoneado delante (lo sujetan postes en los extremos y detrás)
      var y1 = s * (BLY + 1.0), zc1 = 3.15, zc2 = 3.75, dy = ytop - y1, rxT = Math.atan2(zc2 - zc1, Math.abs(dy)) * s, nseg = 10, segL = 2 * BLX / nseg;
      for (var k = 0; k < nseg; k++) {
        var cx = -BLX + (k + 0.5) * segL, cc = k % 2 ? canA : (k % 4 === 0 ? canB : canC);
        B.box(segL, 0.05, Math.hypot(dy, zc2 - zc1) + 0.1, cx, (zc1 + zc2) / 2, -(y1 + ytop) / 2, cc, 0, rxT);
        for (var v = 0; v < 2; v++) B.geo(BGEO.cone4, cx - segL / 4 + v * segL / 2, zc1 - 0.2, -y1, cc, Math.PI / 4, Math.PI, 0, segL * 0.36, 0.3, 0.06);
      }
      [-BLX, 0, BLX].forEach(function (px) { lrod(B, px, ztop + 1.0, -ytop, px, zc2, -ytop, 0.035, frame); });
      [-BLX, BLX].forEach(function (px) { lrod(B, px, 0, -y1, px, zc1, -y1, 0.04, frame); });
    }
    return seats;
  }

  /* ---------- atrezo de playa ---------- */
  var LEAF = ['#3fae49', '#2f9440', '#56c24f'], BARK = ['#8a5a32', '#a9753f'];
  function palm(B, x, y, H, lean, yaw) {
    objM(x, y, yaw, 1);
    var n = 7, px0 = 0, py0 = 0, la = col(LEAF[0]), lb = col(LEAF[1]), lc = col(LEAF[2]), ba = col(BARK[0]), bb = col(BARK[1]);
    for (var i = 1; i <= n; i++) {
      var t = i / n, px = lean * H * Math.pow(t, 1.8), py = H * t, r0 = 0.21 - 0.08 * (i - 1) / n, r1 = 0.21 - 0.08 * t;
      lrod(B, px0, py0 - (i > 1 ? 0.05 : 0.1), 0, px, py, 0, r0, i % 2 ? ba : bb, taperGeo(r1 / r0));
      px0 = px; py0 = py;
    }
    var nut = col('#5a3a1a');
    for (var c = 0; c < 3; c++) part(B, BGEO.sph6, px0 + Math.cos(c * 2.1) * 0.13, py0 - 0.14, Math.sin(c * 2.1) * 0.13, nut, 0, 0, 0, 0.13, 0.13, 0.13);
    var nf = 8;
    for (var f = 0; f < nf; f++) part(B, BGEO.frond, px0, py0 + 0.04, 0, f % 3 === 0 ? la : f % 3 === 1 ? lb : lc, 0, f / nf * TAU + rnd() * 0.3, 0.42 - (f % 2) * 0.32 + rnd() * 0.1, 1, 1, 1);
  }
  function umbrella(B, x, y, cA, cB, sc) {
    objM(x, y, rnd() * TAU, sc || 1);
    var wh = col('#f4f2ec'), a = col(cA), b = col(cB);
    lrod(B, 0, -0.1, 0, 0, 2.15, 0, 0.028, wh);
    for (var k = 0; k < 8; k++) part(B, BGEO.wedge, 0, 1.75, 0, k % 2 ? a : b, 0, k * Math.PI / 4, 0, 1.25, 0.5, 1.25);
    part(B, BGEO.sph6, 0, 2.27, 0, wh, 0, 0, 0, 0.06, 0.06, 0.06);
  }
  function lounger(B, x, y, yaw, cA, cB) {
    objM(x, y, yaw, 1);
    var wh = col('#f4f2ec'), a = col(cA), b = col(cB);
    part(B, UNIT_BOX, 0.25, 0.3, 0, a, 0, 0, 0, 1.25, 0.05, 0.6);
    part(B, UNIT_BOX, -0.62, 0.52, 0, a, 0, 0, -0.72, 0.72, 0.05, 0.6);
    for (var s = 0; s < 3; s++) part(B, UNIT_BOX, -0.05 + s * 0.38, 0.33, 0, b, 0, 0, 0, 0.12, 0.012, 0.6);
    part(B, UNIT_BOX, -0.62, 0.55, 0, b, 0, 0, -0.72, 0.12, 0.012, 0.6);
    for (var lx = -1; lx <= 1; lx += 2) for (var lz = -1; lz <= 1; lz += 2) part(B, UNIT_BOX, 0.25 + lx * 0.55, 0.14, lz * 0.27, wh, 0, 0, 0, 0.05, 0.28, 0.05);
  }
  function towel(B, x, y, yaw, cA, cB) {
    objM(x, y, yaw, 1);
    part(B, UNIT_BOX, 0, 0.012, 0, col(cA), 0, 0, 0, 1.7, 0.02, 0.85);
    for (var s = -1; s <= 1; s += 2) part(B, UNIT_BOX, s * 0.62, 0.024, 0, col(cB), 0, 0, 0, 0.14, 0.006, 0.85);
  }
  function beachBall(B, x, y) {
    objM(x, y, rnd() * TAU, 1);
    part(B, BGEO.hemi, 0, 0.18, 0, col('#ff5b3a'), 0, 0, 0, 0.18, 0.18, 0.18);
    part(B, BGEO.hemi, 0, 0.18, 0, col('#ffd23f'), Math.PI, 0, 0, 0.18, 0.18, 0.18);
  }
  function featherFlag(B, x, y, c1, yaw) {
    objM(x, y, yaw, 1);
    lrod(B, 0, 0, 0, 0, 3.25, 0, 0.03, col('#dfe4ea'));
    part(B, BGEO.flag, 0, 0, 0, col(c1));
  }
  function chiringuito(B, x, y, yaw) {
    objM(x, y, yaw, 1);
    var wood = col('#b07a46'), woodD = col('#8a5a32'), straw = col('#e2b65c'), strawD = col('#c9973f'), red = col('#e8504a'), wh = col('#f4f2ec'), teal = col('#22b8d6');
    part(B, UNIT_BOX, 0, 0.08, 0, woodD, 0, 0, 0, 4.6, 0.16, 3.6);
    for (var cx = -1; cx <= 1; cx += 2) for (var cz = -1; cz <= 1; cz += 2) lrod(B, cx * 2.0, 0.1, cz * 1.5, cx * 2.0, 2.7, cz * 1.5, 0.09, wood);
    part(B, UNIT_BOX, 0, 1.4, 1.5, wood, 0, 0, 0, 4.0, 2.6, 0.12);                  // pared del fondo
    part(B, UNIT_BOX, 0, 0.62, -1.15, wood, 0, 0, 0, 4.1, 1.05, 0.5);              // barra
    part(B, UNIT_BOX, 0, 1.17, -1.2, woodD, 0, 0, 0, 4.3, 0.07, 0.68);             // tablero
    for (var s = 0; s < 5; s++) part(B, UNIT_BOX, -1.6 + s * 0.8, 0.62, -1.41, s % 2 ? wh : teal, 0, 0, 0, 0.8, 1.0, 0.02);
    part(B, BGEO.cone4, 0, 3.35, 0, straw, 0, Math.PI / 4, 0, 3.6, 1.4, 3.1);
    part(B, BGEO.cone4, 0, 2.78, 0, strawD, 0, Math.PI / 4, 0, 3.75, 0.25, 3.25);
    part(B, UNIT_BOX, 0, 2.55, -1.85, red, 0, 0, 0, 2.6, 0.55, 0.08);             // rótulo
    part(B, UNIT_BOX, 0, 2.55, -1.9, wh, 0, 0, 0, 2.2, 0.16, 0.02);
    for (var b = 0; b < 4; b++) { var bx = -1.5 + b; lrod(B, bx, 0.16, -1.85, bx, 0.75, -1.85, 0.03, woodD); part(B, BGEO.cyl, bx, 0.78, -1.85, red, 0, 0, 0, 0.17, 0.06, 0.17); }
    part(B, BGEO.sph, 2.4, 1.1, 0.4, teal, 0, 0, 0.18, 0.28, 1.1, 0.07);            // tabla de surf apoyada
    part(B, BGEO.sph, 2.45, 1.05, -0.3, col('#ffd23f'), 0, 0, 0.22, 0.26, 1.0, 0.07);
  }
  function beachProps(B) {
    var wood = col('#b98a55'), woodD = col('#8a5a32');
    // banquillos de playa (las personas son las del pabellón: mismas posiciones) con sombrilla del color del equipo
    for (var t = 0; t < 2; t++) {
      var sx = t === 0 ? 1 : -1, bx = sx * CREW_BENCH_X, tc = col(TEAMC[t]), seatZ = CREW_RISER + 0.45;
      B.cbox(3.4, 0.9, CREW_RISER, bx - sx * 0.25, 10.62, CREW_RISER / 2, woodD, 0.03, 0.02);
      B.cbox(2.2, 0.42, 0.06, bx, CREW_BENCH_Y + 0.12, seatZ, wood, 0.03, 0.02);
      B.cbox(2.2, 0.06, 0.4, bx, CREW_BENCH_Y + 0.36, seatZ + 0.3, wood, 0.02, 0.02);
      for (var lg = -1; lg <= 1; lg += 2) B.sbox(0.06, 0.36, 0.42, bx + lg * 1.0, CREW_BENCH_Y + 0.12, CREW_RISER + 0.21, woodD);
      B.cbox(0.5, 0.36, 0.38, bx + sx * 1.45, CREW_BENCH_Y + 0.05, CREW_RISER + 0.19, col('#2f6fb6'), 0.03, 0.02); // nevera
      B.sbox(0.52, 0.38, 0.05, bx + sx * 1.45, CREW_BENCH_Y + 0.05, CREW_RISER + 0.4, col('#f4f2ec'));
      umbrella(B, bx, CREW_BENCH_Y + 0.75, TEAMC[t], '#ffffff', 1.25);
    }
    B.cbox(1.3, 0.9, 0.42, -2.7, -10.62, 0.21, woodD, 0.03, 0.02); // tarima de la cámara de TV
    // (los vientos de los postes van con la red en `beachNet`: siguen el ancho de la pista de la partida)
    // palmeras: enmarcan el mar al fondo y rodean las gradas
    var PALMS = [[-20.5, 17.5, 7.6, 0.14, 2.6], [-23.5, -12.8, 8.4, 0.18, -2.2], [-26, -19.5, 6.8, 0.1, -2.9], [-19, 24, 8.8, 0.2, 2.2], [-17.5, -23, 7.4, 0.12, -1.8],
      [-12, 18.6, 8.0, 0.1, 1.3], [3.5, 18.8, 7.2, 0.16, 1.7], [12.5, 18.2, 8.6, 0.12, 1.0], [-6, -18.8, 7.8, 0.14, -1.5], [8, -19.4, 8.4, 0.1, -1.2],
      [21, 12.5, 8.2, 0.18, 0.6], [26.5, 2.5, 7.0, 0.12, 0.1], [22, -14.5, 7.8, 0.16, -0.7], [31, -6, 8.6, 0.1, 0.3], [30, 16, 7.2, 0.14, 0.9]];
    // las del lado de tierra son pinos piñoneros (copa plana: la costa mediterránea, no la isla tropical de postal)
    for (var p = 0; p < PALMS.length; p++) { var P = PALMS[p]; if (P[0] > 0) pine(B, P[0], P[1], P[2] * 0.95, P[4] + rnd() * 0.4); else palm(B, P[0], P[1], P[2], P[3], P[4] + rnd() * 0.4); }
    // sombrillas, hamacas y toallas (junto a la orilla a los lados y detrás de las gradas)
    var UMB = [['#ff5b3a', '#ffffff'], ['#22b8d6', '#ffffff'], ['#ffd23f', '#ff6b5a'], ['#7ad36a', '#ffffff'], ['#5a7dff', '#ffd23f'], ['#ff7aa8', '#ffffff']];
    var spots = [[-21, 13], [-22.5, 21], [-20, 28], [-22, -17], [-20.5, -26], [-23.5, -31], [-15, 22.5], [-14, -21], [0, 22.5], [9, 23.5], [-3, -22.5], [4, -23.5],
      [17.5, 20], [19, -19], [26, 10], [27, -12]];
    for (var u = 0; u < spots.length; u++) {
      var S = spots[u], cc = UMB[u % UMB.length];
      umbrella(B, S[0], S[1], cc[0], cc[1], 1);
      if (u % 3 !== 2) { var ly = rnd() < 0.5 ? -1 : 1; lounger(B, S[0] + 1.3, S[1] + ly * 0.6, Math.PI + (rnd() - 0.5) * 0.4, cc[0], '#ffffff'); }
      if (u % 2 === 0) towel(B, S[0] - 1.2, S[1] - 1.0, rnd() * TAU, UMB[(u + 2) % UMB.length][0], '#ffffff');
      if (u % 5 === 1) beachBall(B, S[0] + 0.6, S[1] - 1.5);
    }
    chiringuito(B, 25, -5.5, Math.PI / 2 + 0.25);
    // (fuera del eje del fondo: en el centro del encuadre de juego recordaba a la torre de socorrista de otros juegos de playa)
    lifeChair(B, -26.5, 24, -Math.PI / 2 - 0.5);
    var FL = ['#ff5b3a', '#22b8d6', '#ffd23f', '#3f8cff', '#ff6b5a', '#7ad36a'];
    // la vela mira hacia el centro de la pista (de frente a las cámaras de juego), algo girada por el viento
    [[-17.4, 7.5], [-17.4, -7.5], [17.2, 8.2], [17.2, -8.2], [-11.5, 11.7], [11.5, -11.7]].forEach(function (f, i) { featherFlag(B, f[0], f[1], FL[i], Math.atan2(-f[0], f[1]) + 0.45); });
    // horizonte: los llaüts navegan aparte (`beachBoats`) y la costa con el faro es el telón (`beachBackdrop`)
    // dunas con matas detrás del chiringuito
    for (var d = 0; d < 6; d++) {
      var dx2 = 36 + rnd() * 8, dy2 = -30 + d * 12 + rnd() * 4;
      objM(dx2, dy2, rnd() * TAU, 1); part(B, BGEO.hemi, 0, -0.3, 0, col('#f0cf95'), 0, 0, 0, 5 + rnd() * 3, 1.5 + rnd(), 3 + rnd() * 2);
      for (var gm = 0; gm < 5; gm++) part(B, BGEO.cone6, (rnd() - 0.5) * 6, 1.0, (rnd() - 0.5) * 3, col(LEAF[gm % 3]), 0, 0, 0, 0.18, 0.7, 0.18);
    }
  }

  /* ---------- horizonte de tierra: telón pintado en un anillo (pueblo blanco, pinar, sierra baja y cabo con faro) ----------
   * Antes, hacia las gradas laterales la arena se fundía con el cielo. Un cilindro abierto a 150 m (1 dibujo, 192 triángulos)
   * con un lienzo transparente: la parte del mar queda vacía (horizonte limpio), los cabos bajan hacia el agua. Colores ya
   * velados por la distancia (sin niebla de three: a 150 m la del juego lo dejaría blanco); `color` lo tiñe con la luz. */
  var BD_R = 150, BD_H = 24;
  function backdropCanvas() {
    var hi = !ctx.isMobile, W = hi ? 4096 : 2048, H = hi ? 256 : 128, k = H / 256, cv = canvas(W, H), g = cv.getContext('2d');
    var sd = _seed; _seed = 99173;
    function phi(px) { var th = px / W * TAU; return Math.atan2(Math.cos(th), Math.sin(th)); } // 0 = tierra adentro (+x three), ±π = mar
    function land(px) { var a = Math.abs(phi(px)); return a < 1.8 ? 1 : a < 2.62 ? Math.pow(1 - (a - 1.8) / 0.82, 0.8) : 0; }
    var ph = []; for (var q = 0; q < 6; q++) ph.push(rnd() * TAU);
    function wav(px, f, i) { return Math.sin(px / W * TAU * f + ph[i]); }
    function ridge(color, base, amp, fr, i0, step) {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, H);
      for (var x = 0; x <= W; x += step) {
        var l = land(x), h = l > 0 ? (base + amp * (0.5 + 0.3 * wav(x, fr, i0) + 0.2 * wav(x, fr * 2.7, i0 + 1))) * l : 0;
        g.lineTo(x, H - h * k);
      }
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    ridge('#b9cde6', 70, 90, 5, 0, 8);                       // sierra baja, muy velada (sin «la montaña» de postal)
    ridge('#a9c6c8', 40, 46, 11, 2, 6);                      // lomas con pinar
    // copas de pino piñonero sobre las lomas (planas y anchas: silueta mediterránea)
    for (var p = 0; p < (hi ? 150 : 80); p++) {
      var px = rnd() * W, l = land(px); if (l < 0.6) continue;
      var hb = (40 + 46 * (0.5 + 0.3 * wav(px, 11, 2) + 0.2 * wav(px, 29.7, 3))) * l * k, r = (5 + rnd() * 6) * k;
      g.fillStyle = rnd() < 0.5 ? '#93b5ad' : '#88aca4';
      g.beginPath(); g.ellipse(px, H - hb - r * 0.2, r * 1.6, r * 0.55, 0, 0, TAU); g.fill();
    }
    // pueblo blanco al pie de las lomas: casas de 2-5 plantas con tejado de teja, campanario y algún bloque
    var HOUSES = ['#f3eee6', '#efe5d5', '#f5e9d6', '#e9dccb', '#f2f1ec', '#f0e0d0'], x0 = 0;
    while (x0 < W) {
      var w = (8 + rnd() * 18) * k, a = Math.abs(phi(x0));
      if (a < 1.62) {
        var hh = (12 + rnd() * 26 + (rnd() < 0.08 ? 26 : 0)) * k * (a > 1.3 ? 0.6 : 1);
        g.fillStyle = pick(HOUSES); g.fillRect(x0, H - 12 * k - hh, w, hh + 12 * k);
        if (rnd() < 0.6) { g.fillStyle = rnd() < 0.5 ? '#dca58a' : '#d4977c'; g.beginPath(); g.moveTo(x0 - 1, H - 12 * k - hh); g.lineTo(x0 + w / 2, H - 12 * k - hh - 5 * k); g.lineTo(x0 + w + 1, H - 12 * k - hh); g.fill(); }
        if (hi) { g.fillStyle = 'rgba(120,140,170,0.35)'; for (var wy = H - 12 * k - hh + 4; wy < H - 14 * k; wy += 7) for (var wx = x0 + 3; wx < x0 + w - 3; wx += 6) g.fillRect(wx, wy, 2, 3); }
        if (rnd() < 0.025) { // campanario
          g.fillStyle = '#efe3cf'; g.fillRect(x0 + w / 2 - 4 * k, H - 12 * k - hh - 30 * k, 8 * k, 30 * k);
          g.fillStyle = '#d4977c'; g.beginPath(); g.moveTo(x0 + w / 2 - 5 * k, H - 12 * k - hh - 30 * k); g.lineTo(x0 + w / 2, H - 12 * k - hh - 40 * k); g.lineTo(x0 + w / 2 + 5 * k, H - 12 * k - hh - 30 * k); g.fill();
        }
      }
      x0 += w + (rnd() < 0.15 ? rnd() * 20 * k : 0);
    }
    // paseo: palmeras finas en silueta delante del pueblo
    for (var pp = 0; pp < (hi ? 70 : 36); pp++) {
      var qx = rnd() * W; if (Math.abs(phi(qx)) > 1.6) continue;
      var th = (22 + rnd() * 10) * k; g.strokeStyle = '#9fb3a6'; g.lineWidth = 1.4 * k; g.beginPath(); g.moveTo(qx, H - 8 * k); g.quadraticCurveTo(qx + 2 * k, H - 8 * k - th / 2, qx + 1, H - 8 * k - th); g.stroke();
      g.fillStyle = '#8fb0a0'; for (var f = 0; f < 5; f++) { g.beginPath(); g.ellipse(qx + 1 + Math.cos(f * 1.26) * 4 * k, H - 8 * k - th + Math.sin(f * 1.26) * 1.5 * k, 5 * k, 1.6 * k, f * 1.26, 0, TAU); g.fill(); }
    }
    // faro en el cabo (lado y > 0 de la sim, a la izquierda del mar desde la cámara de juego)
    var fx = 0, bd = 9;
    for (var sx = 0; sx < W; sx += 2) { var dd = Math.abs(phi(sx) + 2.42); if (dd < bd) { bd = dd; fx = sx; } }
    var fb = H - (40 + 23) * land(fx) * k - 6 * k;
    g.fillStyle = '#f6f4ef'; g.fillRect(fx - 3 * k, fb - 30 * k, 6 * k, 30 * k);
    g.fillStyle = '#e46a55'; g.fillRect(fx - 3 * k, fb - 20 * k, 6 * k, 5 * k); g.fillRect(fx - 4 * k, fb - 36 * k, 8 * k, 6 * k);
    g.fillStyle = '#fff3c4'; g.fillRect(fx - 2 * k, fb - 34 * k, 4 * k, 3 * k);
    // pie del telón fundido con la bruma del horizonte (la arena lejana ya es color de niebla)
    g.globalCompositeOperation = 'source-atop';
    var gr = g.createLinearGradient(0, H * 0.55, 0, H); gr.addColorStop(0, 'rgba(204,232,246,0)'); gr.addColorStop(1, 'rgba(204,232,246,0.85)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    _seed = sd;
    return cv;
  }
  function beachBackdrop(G) {
    var tex = texOf(backdropCanvas()); tex.wrapS = THREE.RepeatWrapping; BEACH.texs.push(tex);
    var geo = new THREE.CylinderGeometry(BD_R, BD_R, BD_H, 96, 1, true); geo.translate(0, BD_H / 2 - 1.2, 0);
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
    m.name = 'beachBackdrop'; m.renderOrder = -8; m.frustumCulled = false; G.add(m); BEACH.backdrop = m;
  }

  /* ---------- gaviotas (1 dibujo: 2 triángulos por ave, vuelo y aleteo en el shader) ---------- */
  var GULL_VS = [
    'uniform float uT; attribute vec4 aG; attribute vec3 aW; varying float vTip;',
    '#include <fog_pars_vertex>',
    'void main(){',
    // aG = (centro x, centro z, radio, fase); aW = (envergadura -1..1, a lo largo del cuerpo, altura base)
    ' float sp = 0.16 + 0.05 * fract(aG.w * 3.7); float a = aG.w * 6.2832 + uT * sp * (fract(aG.w * 9.1) > 0.5 ? 1.0 : -1.0);',
    ' vec3 c = vec3(aG.x + cos(a) * aG.z, aW.z + sin(uT * 0.31 + aG.w * 20.0) * 1.2, aG.y + sin(a) * aG.z * 0.6);',
    ' vec3 fw = normalize(vec3(-sin(a), 0.0, cos(a) * 0.6)) * (fract(aG.w * 9.1) > 0.5 ? 1.0 : -1.0); vec3 rt = vec3(fw.z, 0.0, -fw.x);',
    ' float fl = sin(uT * (5.5 + 2.0 * fract(aG.w * 5.3)) + aG.w * 40.0); fl = fl * (0.5 + 0.5 * step(0.0, sin(uT * 0.7 + aG.w * 13.0)));',
    ' float s = abs(aW.x); vec3 p = c + rt * aW.x * 0.65 + fw * aW.y * 0.32 + vec3(0.0, (s * 0.22 + s * s * 0.25 * fl) , 0.0);',
    ' vTip = s; vec4 mvPosition = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;',
    '#include <fog_vertex>',
    '}'].join('\n');
  var GULL_FS = [
    'uniform vec3 uC; varying float vTip;',
    '#include <fog_pars_fragment>',
    'void main(){ vec3 c = mix(uC, vec3(0.16, 0.15, 0.22), smoothstep(0.78, 0.95, vTip)); gl_FragColor = vec4(c, 1.0);',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    '#include <fog_fragment>',
    '}'].join('\n');
  function beachGulls(G) {
    var N = ctx.isMobile ? 9 : 14, P = [], AG = [], AW = [];
    // bandadas sobre la orilla y el mar (delante de la cámara de juego de los dos campos) y alguna sobre las gradas
    var spots = [[-34, -8, 7], [-40, 14, 9], [-30, 4, 5], [-48, -20, 11], [26, -4, 8], [-12, 26, 10], [6, -28, 9]];
    for (var i = 0; i < N; i++) {
      var sp = spots[i % spots.length], ph = rnd(), cx = sp[0] + (rnd() - 0.5) * 6, cz = -sp[1] + (rnd() - 0.5) * 6, r = sp[2] * (0.7 + rnd() * 0.5), hb = 9 + rnd() * 9;
      // ala izquierda y derecha: (envergadura, a lo largo del cuerpo)
      var W = [[0, 0.5], [-1, -0.25], [0, -0.45], [0, 0.5], [0, -0.45], [1, -0.25]];
      for (var j = 0; j < 6; j++) { P.push(0, 0, 0); AG.push(cx, cz, r, ph); AW.push(W[j][0], W[j][1], hb); }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('aG', new THREE.Float32BufferAttribute(AG, 4)); geo.setAttribute('aW', new THREE.Float32BufferAttribute(AW, 3));
    var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uC: { value: new THREE.Color('#f7f6f2') } }]);
    var m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: GULL_VS, fragmentShader: GULL_FS, side: THREE.DoubleSide, fog: true }));
    m.name = 'beachGulls'; m.frustumCulled = false; G.add(m); BEACH.gullU = U;
  }

  /* ---------- llaüts (barcas de vela latina) que navegan despacio a lo largo de la costa (1 dibujo, desplazamiento en el
   * shader del toon: cada barca lleva su base, fase y velocidad; se encogen al llegar a los extremos para reaparecer) ---------- */
  var BOAT_LEN = 260;
  function boatPiece(B, sc, hull, trim, sail) {
    objM(0, 0, 0, sc);
    part(B, UNIT_BOX, 0, 0.32, 0, hull, 0, 0, 0, 3.4, 0.5, 1.15);                                       // casco
    part(B, BGEO.cone4, 2.0, 0.32, 0, hull, 0, Math.PI / 4, -Math.PI / 2, 0.62, 0.62, 0.62);            // proa en punta
    part(B, UNIT_BOX, 0.1, 0.6, 0, trim, 0, 0, 0, 3.5, 0.08, 1.18);                                     // regala de color
    lrod(B, 0.6, 0.6, 0, 0.6, 3.0, 0, 0.05, col('#6b4a2e'));                                            // palo
    lrod(B, 1.9, 0.9, 0, -1.8, 4.6, 0, 0.035, col('#6b4a2e'));                                          // antena (verga inclinada, baja a proa)
    part(B, BGEO.lateen, 0, 0, 0, sail);                                                                 // vela latina
  }
  function beachBoats(G) {
    // barca de pesca tradicional, no velero de regata: casco de madera pintada oscuro y vela latina TOSTADA (ocre / teja), más
    // pequeña; las velas blancas triangulares se leían como los veleros de otros juegos de playa (revisión visual TAJO)
    var B = new Builder(), ranges = [], hulls = ['#2f5d8a', '#7a4a2a', '#2f7a6a', '#8a3a32', '#3a4f7a'], trims = ['#f2c14e', '#f4f2ec', '#e8504a', '#f2c14e', '#f4f2ec'];
    var SAILS = ['#e0a25a', '#d27a4e', '#e8c07a', '#c9683f', '#dca868'];
    var BOATS = [[-72, 0.18, 1.0], [-96, 0.12, 1.25], [-58, 0.24, 0.85], [-125, 0.09, 1.55], [-84, -0.14, 1.1]];
    for (var i = 0; i < BOATS.length; i++) { var v0 = B.v; boatPiece(B, BOATS[i][2], col(hulls[i]), col(trims[i]), col(SAILS[i])); ranges.push([v0, B.v]); }
    var geo = B.build(), n = geo.attributes.position.count, ab = new Float32Array(n * 4);
    for (var b = 0; b < ranges.length; b++) for (var v = ranges[b][0], ph0 = (b * 0.37 + 0.11) * BOAT_LEN; v < ranges[b][1]; v++) { ab[v * 4] = BOATS[b][0]; ab[v * 4 + 1] = ph0; ab[v * 4 + 2] = BOATS[b][1]; ab[v * 4 + 3] = b * 1.7; }
    geo.setAttribute('aBoat', new THREE.BufferAttribute(ab, 4));
    var U = { uT: { value: 0 } }, mat = VB.TOON.toonMat({ vertexColors: true });
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uT = U.uT;
      sh.vertexShader = 'uniform float uT; attribute vec4 aBoat;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n objectNormal = vec3(-objectNormal.z * sign(aBoat.z), objectNormal.y, objectNormal.x * sign(aBoat.z));').replace('#include <begin_vertex>',
        // aBoat = (x de la sim, fase en m, velocidad m/s con signo = sentido, semilla): rumbo a lo largo de la costa (eje z de three)
        '#include <begin_vertex>\n float vbZ = mod(aBoat.y + uT * abs(aBoat.z), ' + BOAT_LEN.toFixed(1) + ') - ' + (BOAT_LEN / 2).toFixed(1) + '; vbZ *= sign(aBoat.z);\n' +
        ' float vbE = 1.0 - smoothstep(' + (BOAT_LEN / 2 - 25).toFixed(1) + ', ' + (BOAT_LEN / 2).toFixed(1) + ', abs(vbZ));\n' +
        ' float vbR = sin(uT * 0.9 + aBoat.w) * 0.05; transformed = vec3(transformed.x, transformed.y * cos(vbR) + transformed.z * sin(vbR), transformed.z * cos(vbR) - transformed.y * sin(vbR));\n' +
        ' transformed = vec3(-transformed.z * sign(aBoat.z), transformed.y, transformed.x * sign(aBoat.z)) * vbE + vec3(aBoat.x, sin(uT * 1.3 + aBoat.w) * 0.12 - 0.05, vbZ);');
    };
    mat.customProgramCacheKey = function () { return 'vb-beach-boats'; };
    var m = new THREE.Mesh(geo, mat); m.name = 'beachBoats'; m.frustumCulled = false; G.add(m); BEACH.boatU = U;
  }

  /* ---------- pino piñonero (copa ancha y plana: el árbol de la costa mediterránea) y silla de socorrista ---------- */
  function pine(B, x, y, H, yaw) {
    objM(x, y, yaw, 1);
    var bark = col('#8a5536'), barkD = col('#6e4128'), g1 = col('#3f7a4a'), g2 = col('#4f8c55'), g3 = col('#5e9c5c');
    var lean = 0.35 + rnd() * 0.5, mx = lean * 0.6, my = H * 0.55;
    lrod(B, 0, -0.1, 0, mx, my, 0, 0.2, bark, taperGeo(0.8));
    lrod(B, mx, my, 0, lean * 1.5, H - 0.6, 0.2, 0.16, barkD, taperGeo(0.75));
    lrod(B, mx * 0.9, my * 0.85, 0, -0.9, H - 1.1, -0.4, 0.09, barkD, taperGeo(0.7));
    var cx = lean * 1.5, cs = H * 0.42;
    part(B, BGEO.sph, cx, H, 0.2, g1, 0, 0, 0, cs, cs * 0.3, cs * 0.85);
    part(B, BGEO.sph, cx + cs * 0.35, H + cs * 0.17, -cs * 0.2, g2, 0, 0.6, 0, cs * 0.62, cs * 0.24, cs * 0.55);
    part(B, BGEO.sph, cx - cs * 0.42, H + cs * 0.1, cs * 0.25, g3, 0, -0.4, 0, cs * 0.5, cs * 0.2, cs * 0.46);
    part(B, BGEO.sph, -0.9, H - 1.0, -0.4, g2, 0, 0, 0, cs * 0.42, cs * 0.17, cs * 0.4);
  }
  /** Silla alta de socorrista (blanca, con sombrilla a gajos y la bandera del estado del mar) en vez de la torre de caseta. */
  function lifeChair(B, x, y, yaw) {
    objM(x, y, yaw, 1);
    var wh = col('#f4f2ec'), wood = col('#c8955a'), red = col('#e8504a'), yel = col('#ffd23f'), grn = col('#3fae49'), org = col('#ff7a2a');
    for (var cx = -1; cx <= 1; cx += 2) {
      lrod(B, cx * 0.55, 0, -0.65, cx * 0.42, 2.4, -0.1, 0.05, wh); lrod(B, cx * 0.55, 0, 0.65, cx * 0.42, 2.4, 0.3, 0.05, wh);
      lrod(B, cx * 0.5, 0.9, -0.48, cx * 0.5, 0.9, 0.5, 0.03, wh);
    }
    for (var r = 1; r <= 5; r++) lrod(B, -0.5, r * 0.42, -0.65 + r * 0.1, 0.5, r * 0.42, -0.65 + r * 0.1, 0.022, wh);   // peldaños
    part(B, UNIT_BOX, 0, 2.42, 0.1, wood, 0, 0, 0, 0.95, 0.06, 0.6);                                              // asiento
    part(B, UNIT_BOX, 0, 2.8, 0.42, wood, -0.12, 0, 0, 0.95, 0.7, 0.05);                                          // respaldo
    part(B, UNIT_BOX, 0, 3.0, 0.45, red, -0.12, 0, 0, 0.97, 0.16, 0.06);
    lrod(B, 0.42, 2.4, 0.3, 0.42, 4.3, 0.3, 0.025, wh);                                                            // sombrilla
    for (var k = 0; k < 8; k++) part(B, BGEO.wedge, 0.42, 3.85, 0.3, k % 2 ? red : wh, 0, k * Math.PI / 4, 0, 1.0, 0.42, 1.0);
    lrod(B, -0.6, 0, 0.9, -0.6, 4.6, 0.9, 0.025, col('#9aa3ad'));                                                   // mástil con bandera verde
    part(B, UNIT_BOX, -0.6 + 0.32, 4.32, 0.9, grn, 0, 0, 0, 0.62, 0.42, 0.02);
    part(B, BGEO.torus, 0.5, 1.3, -0.62, org, 0, 0, 0, 0.26, 0.26, 0.26);                                            // flotador
    part(B, UNIT_BOX, -0.05, 1.3, -0.66, yel, 0, 0, 0, 0.5, 0.18, 0.04);                                             // tablilla
  }

  /* ---------- público de la playa (el material animado del pabellón: mismos uniformes de alegría, ola y tensión) ---------- */
  var BEACH_SHIRTS = ['#ff5b3a', '#ffd23f', '#2fb6c9', '#ff7aa8', '#7ad36a', '#f4f2ec', '#5a7dff', '#ffb43c', '#e8504a', '#3fd0b0', '#b58cff'];
  var BEACH_PANTS = ['#2e4466', '#f4f2ec', '#3fa0d8', '#ff8a3d', '#1f2a3d', '#7ad36a', '#e8504a', '#ffd23f'];
  function beachCrowd(G, seats) {
    var n = seats.length; if (!n || !crowdMeshes.length || !crowdGeos.hi) return;
    var c = new THREE.Color(), anim = new Float32Array(n * 4), skin = new Float32Array(n * 3), hair = new Float32Array(n * 3), pants = new Float32Array(n * 3), acc = new Float32Array(n * 4);
    var mesh = new THREE.InstancedMesh(crowdGeos.hi, crowdMeshes[0].material, n);
    for (var k = 0; k < n; k++) {
      var st = seats[k], rr = rnd(), team = rr < 0.2 ? 1 : rr < 0.5 ? 0 : 0.5;
      c.set(team === 0 ? pick(SHIRTS.t0) : team === 1 ? pick(SHIRTS.t1) : pick(BEACH_SHIRTS)).multiplyScalar(0.84 + rnd() * 0.16); mesh.setColorAt(k, c);
      var sk = pick(SKINS); c.set(sk); skin[k * 3] = c.r; skin[k * 3 + 1] = c.g; skin[k * 3 + 2] = c.b;
      if (rnd() < 0.06) c.set(sk).multiplyScalar(0.85); else c.set(pick(HAIRS)); hair[k * 3] = c.r; hair[k * 3 + 1] = c.g; hair[k * 3 + 2] = c.b;
      c.set(pick(BEACH_PANTS)); pants[k * 3] = c.r; pants[k * 3 + 1] = c.g; pants[k * 3 + 2] = c.b;
      anim[k * 4] = rnd() * 6.283; anim[k * 4 + 1] = 0.55 + rnd() * 0.45; anim[k * 4 + 2] = team; anim[k * 4 + 3] = Math.atan2(st.y, st.x) / 6.2832 + 0.5;
      var kid = rnd() < 0.08, sh = kid ? 0.78 : 0.92 + rnd() * 0.16, sw = kid ? 0.8 : 0.9 + rnd() * 0.24;
      VB.toThree(st.x, st.y, st.z, _p); _e.set(0, Math.atan2(st.fx, -st.fy) + (rnd() - 0.5) * 0.3, 0); _q.setFromEuler(_e); _s.set(sw, sh, (sw + 1) / 2);
      _m.compose(_p, _q, _s); mesh.setMatrixAt(k, _m);
    }
    var ga = { aAnim: new THREE.InstancedBufferAttribute(anim, 4), aSkin: new THREE.InstancedBufferAttribute(skin, 3), aHair: new THREE.InstancedBufferAttribute(hair, 3),
      aPants: new THREE.InstancedBufferAttribute(pants, 3), aAcc: new THREE.InstancedBufferAttribute(acc, 4) };
    var bs = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), Math.hypot(BLX, BLY + 4.5) + 2), lods = {};
    ['hi', 'lo'].forEach(function (lv) {
      // copias propias de los buffers base: liberar esta geometría no debe tocar los del pabellón (su VAO los sigue usando)
      var g = new THREE.BufferGeometry(), src = crowdGeos[lv];
      g.setAttribute('position', src.attributes.position.clone()); g.setAttribute('normal', src.attributes.normal.clone()); g.setAttribute('color', src.attributes.color.clone()); g.setIndex(src.index.clone());
      for (var an in ga) g.setAttribute(an, ga[an]);
      g.boundingSphere = bs; lods[lv] = g;
    });
    mesh.geometry = lods.lo; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.full = n; mesh.userData.lods = lods; mesh.userData.sharedMat = true; mesh.name = 'beachCrowd'; mesh.frustumCulled = true;
    G.add(mesh); BEACH.crowd = mesh;
  }

  /* ---------- pista de la PARTIDA, red, postes, silla del árbitro y mesa de anotadores de playa ----------
   * La pista que se dibuja es la de la partida (la pone la sim: g.HL / g.HW = 8 × 4 con reglas de playa, g.beach; sin
   * partida, VB.C). Si cambia (otra partida), se repintan las cintas y se rehace esta malla pequeña (`beachNet`: postes de
   * aluminio con protección fina de lona, antenas, cinta, vientos con sacos, silla del árbitro de madera con toldo y mesa de
   * anotadores con caballetes y toldo de lona); la malla de la red se estrecha (escala) y los oficiales se recolocan. Las
   * piezas del pabellón equivalentes (`props`, `poles`) se ocultan en la playa. 1 dibujo (+ tinta en media/alta). */
  var BCOL = { wood: '#c8955a', woodD: '#94653a', woodL: '#e4b97f', canA: '#ffffff', canB: '#22b8d6', coral: '#ee4a2f', alu: '#dfe4ea', rope: '#f2ead8', bag: '#d8342c' };
  function beachNetHW(B, hw) {
    var top = C.NET_H, white = col('#f4f1ea'), cable = col('#9aa3ad'), rod = col('#d8d4cc'), post = col('#26262c'), padA = col('#f7c531'), padW = col('#1d1530');
    var coral = col(BCOL.coral), red = col('#e0262f'), antW = col('#f7f5f0'), ropeC = col(BCOL.rope), bagC = col(BCOL.bag);
    objM(0, 0, 0, 1);
    B.sbox(0.035, 2 * hw + 1, 0.10, 0, 0, top - 0.05, col('#f7c531'));                            // cinta superior alta y amarilla (AVP)
    for (var s = -1; s <= 1; s += 2) {
      var py = s * (hw + 1);
      B.sbox(0.012, 0.55, 0.012, 0, s * (hw + 0.75), top - 0.03, cable); B.sbox(0.012, 0.55, 0.012, 0, s * (hw + 0.75), top - 0.97, cable);
      B.sbox(0.02, 0.02, 1, 0, s * (hw + 0.5), top - 0.5, rod);                                   // varilla del extremo de la red
      lrod(B, 0, -0.3, -py, 0, top + 0.2, -py, 0.045, post, BGEO.cyl);                            // poste de aluminio (clavado en la arena)
      part(B, BGEO.hemi, 0, top + 0.2, -py, post, 0, 0, 0, 0.05, 0.035, 0.05);
      // protección de lona acolchada estilo AVP: amarilla sobre poste negro, con una franja negra abajo y otra arriba
      lrod(B, 0, 0, -py, 0, 1.7, -py, 0.1, padA, BGEO.cyl);
      lrod(B, 0, 0.14, -py, 0, 0.3, -py, 0.104, padW, BGEO.cyl);
      lrod(B, 0, 1.5, -py, 0, 1.6, -py, 0.104, padW, BGEO.cyl);
      part(B, BGEO.hemi, 0, 1.7, -py, padA, 0, 0, 0, 0.1, 0.03, 0.1);
      for (var k = 0; k < 10; k++) lrod(B, 0.03, top - 1 + k * 0.18, -s * (hw + 0.006), 0.03, top - 1 + (k + 1) * 0.18, -s * (hw + 0.006), 0.013, k % 2 ? antW : red, BGEO.cyl);
      for (var dx = -1; dx <= 1; dx += 2) {                                                        // vientos a sacos de arena
        lrod(B, 0, 2.45, -py, dx * 1.1, 0.05, -(s * (hw + 2.9)), 0.011, ropeC);
        B.cbox(0.34, 0.26, 0.16, dx * 1.1, s * (hw + 2.9), 0.08, bagC, 0.05, 0.05);
      }
    }
  }
  /** Toldo de lona a rayas (coords de sim): de x0 a x1, delante (yF, altura hF) y detrás (yB, hB), con faldón festoneado delante. */
  function beachAwning(B, x0, x1, yF, hF, yB, hB, nseg, cA, cB) {
    var run = Math.abs(yB - yF), a = Math.atan2(hB - hF, run) * (yB > yF ? 1 : -1), segL = (x1 - x0) / nseg, len = Math.hypot(run, hB - hF) + 0.12;
    for (var k = 0; k < nseg; k++) {
      var cx = x0 + (k + 0.5) * segL, cc = k % 2 ? cA : cB;
      B.box(segL, 0.04, len, cx, (hF + hB) / 2, -(yF + yB) / 2, cc, 0, a);
      B.geo(BGEO.cone4, cx, hF - 0.16, -yF, cc, Math.PI / 4, Math.PI, 0, segL * 0.5, 0.26, 0.05);
    }
  }
  /** Silla del 1.er árbitro de playa: torre de madera con tarima a la MISMA altura que la del pabellón (el árbitro es el
   *  mismo), barandilla, peto de lona con el tajo y escalera detrás. Sin toldo. */
  function beachRefStand(B, hw) {
    var ry = -(hw + 1.62), PZ = 1.25, rd = 0.43, wood = col(BCOL.wood), woodD = col(BCOL.woodD), woodL = col(BCOL.woodL);
    var canA = col(BCOL.canA), canB = col(BCOL.canB), coral = col(BCOL.coral), alu = col(BCOL.alu);
    objM(0, 0, 0, 1);
    for (var px = -1; px <= 1; px += 2) for (var py = -1; py <= 1; py += 2) lrod(B, px * (rd + 0.07), 0, -(ry + py * (rd + 0.07)), px * rd, PZ, -(ry + py * rd), 0.05, woodD, BGEO.cyl);
    for (var s = -1; s <= 1; s += 2) {                                                            // aspas laterales
      lrod(B, s * rd, 0.15, -(ry - rd), s * rd, PZ - 0.12, -(ry + rd), 0.022, woodD);
      lrod(B, s * rd, 0.15, -(ry + rd), s * rd, PZ - 0.12, -(ry - rd), 0.022, woodD);
    }
    B.cbox(1.0, 1.0, 0.08, 0, ry, PZ - 0.01, wood, 0.03, 0.015);                                  // tarima
    for (var j = 0; j < 4; j++) B.sbox(0.96, 0.014, 0.006, 0, ry - 0.36 + j * 0.24, PZ + 0.033, woodD);
    var rz = PZ + 0.95;
    for (var qx = -1; qx <= 1; qx += 2) for (var qy = -1; qy <= 1; qy += 2) lrod(B, qx * rd, PZ, -(ry + qy * rd), qx * rd, rz, -(ry + qy * rd), 0.03, wood);
    B.sbox(2 * rd + 0.08, 0.07, 0.05, 0, ry + rd, rz, woodL);                                     // pasamanos
    for (var r2 = -1; r2 <= 1; r2 += 2) B.sbox(0.07, 2 * rd + 0.08, 0.05, r2 * rd, ry, rz, woodL);
    B.sbox(2 * rd, 0.02, 0.55, 0, ry + rd + 0.02, PZ + 0.46, canA);                              // peto de lona con el tajo
    B.sbox(2 * rd + 0.004, 0.024, 0.11, 0, ry + rd + 0.02, PZ + 0.27, canB);
    B.box(0.15, 0.5, 0.026, -0.1, PZ + 0.47, -(ry + rd + 0.03), coral, 0, 0, 0.62);
    var y0 = ry - rd, y1 = ry - rd - 0.78;                                                         // escalera de mano detrás
    for (var sl = -1; sl <= 1; sl += 2) lrod(B, sl * 0.25, 0, -y1, sl * 0.25, PZ + 0.85, -(y0 + 0.04), 0.025, woodD);
    for (var st = 1; st <= 4; st++) { var t = st / 5, yy = y1 + (y0 - y1) * t, zz = PZ * t; lrod(B, -0.25, zz, -yy, 0.25, zz, -yy, 0.02, woodL); }
    // sin toldo ni sombrilla (decisión de Ferran, 10-nov-2026)
  }
  /** Mesa de anotadores de playa: tablero de madera sobre caballetes, faldón de lona con el tajo, sillas plegables, marcador
   *  de láminas con los colores de los equipos, nevera y toldo de cuatro postes. */
  function beachScorer(B, hw) {
    var ty = hw + 3.6, wood = col(BCOL.wood), woodD = col(BCOL.woodD), woodL = col(BCOL.woodL), canA = col(BCOL.canA), canB = col(BCOL.canB);
    var coral = col(BCOL.coral), alu = col(BCOL.alu), dark = col('#26303e');
    objM(0, 0, 0, 1);
    B.cbox(2.86, 0.74, 0.05, 0, ty, 0.765, woodL, 0.03, 0.012);
    for (var s = -1; s <= 1; s += 2) {
      lrod(B, s * 1.22, 0, -(ty - 0.3), s * 1.22, 0.75, -ty, 0.03, woodD); lrod(B, s * 1.22, 0, -(ty + 0.3), s * 1.22, 0.75, -ty, 0.03, woodD);
      B.sbox(0.04, 0.44, 0.04, s * 1.22, ty, 0.26, woodD);
    }
    B.sbox(2.8, 0.02, 0.6, 0, ty - 0.36, 0.44, canA);                                            // faldón (lado pista)
    B.sbox(2.804, 0.024, 0.11, 0, ty - 0.36, 0.22, canB);
    for (var tj = -1; tj <= 1; tj += 2) B.box(0.2, 0.56, 0.026, tj * 0.95, 0.45, -(ty - 0.38), coral, 0, 0, 0.55);
    for (var c = -1; c <= 1; c += 2) {                                                            // sillas plegables
      var cx = c * 0.6, cy = ty + 0.62;
      B.sbox(0.44, 0.4, 0.035, cx, cy, 0.45, canB); B.sbox(0.44, 0.035, 0.26, cx, cy + 0.22, 0.76, canB);
      for (var lx = -1; lx <= 1; lx += 2) {
        lrod(B, cx + lx * 0.21, 0, -(cy - 0.2), cx + lx * 0.21, 0.45, -(cy + 0.2), 0.017, wood);
        lrod(B, cx + lx * 0.21, 0, -(cy + 0.2), cx + lx * 0.21, 0.92, -(cy + 0.24), 0.017, wood);
      }
      B.sbox(0.24, 0.17, 0.012, cx, ty - 0.02, 0.796, dark);                                       // acta en papel sobre tablilla
      B.sbox(0.2, 0.13, 0.004, cx, ty - 0.02, 0.804, canA);
    }
    B.sbox(0.56, 0.1, 0.4, 0, ty - 0.12, 0.99, woodD);                                            // marcador de láminas
    B.sbox(0.22, 0.11, 0.3, -0.13, ty - 0.13, 1.0, col(TEAMC[1])); B.sbox(0.22, 0.11, 0.3, 0.13, ty - 0.13, 1.0, col(TEAMC[0]));
    B.sbox(0.12, 0.112, 0.04, -0.13, ty - 0.13, 1.0, canA); B.sbox(0.12, 0.112, 0.04, 0.13, ty - 0.13, 1.0, canA);
    B.cbox(0.5, 0.36, 0.38, 1.8, ty + 0.25, 0.19, canB, 0.03, 0.02); B.sbox(0.52, 0.38, 0.05, 1.8, ty + 0.25, 0.4, canA); // nevera
    var ax = 1.75, yF = ty - 0.8, yB = ty + 1.2, hF = 2.3, hB = 2.6;
    for (var px = -1; px <= 1; px += 2) { lrod(B, px * ax, 0, -yF, px * ax, hF, -yF, 0.035, alu); lrod(B, px * ax, 0, -yB, px * ax, hB, -yB, 0.035, alu); }
    beachAwning(B, -ax - 0.1, ax + 0.1, yF - 0.1, hF, yB + 0.1, hB, 7, canA, canB);
  }
  function beachNetGeo(hw) {
    var own = !BGEO; if (own) beachGeos();
    var B = new Builder(); beachNetHW(B, hw); beachRefStand(B, hw); beachScorer(B, hw);
    var geo = B.build();
    if (own) { for (var k in BGEO) BGEO[k].dispose(); BGEO = null; }
    return geo;
  }
  /** Ancho de la malla de la red (escala de las dos mallas compartidas): 1 en el pabellón (10 m = 9 + 2 × 0,5). */
  function netScale(hw) {
    if (!net || !net.mesh) return;
    var k = (2 * hw + 1) / NET_W, m = net.mesh, mb = m.parent ? m.parent.getObjectByName('netBack') : null;
    [m, mb].forEach(function (o) { if (o && Math.abs(o.scale.x - k) > 1e-6) { o.scale.x = k; o.updateMatrix(); } });
    // textura de la malla según la sede: amarillenta en la playa (se crea la primera vez), negra en el pabellón
    if (!net.texHall) net.texHall = m.material.map;
    var want = BEACH.on ? (net.texBeach || (net.texBeach = netTexture(true))) : net.texHall;
    [m, mb].forEach(function (o) { if (o && o.material.map !== want) { o.material.map = want; o.material.needsUpdate = true; } });
  }
  /** Oficiales a la pista de la partida: árbitros y anotadores se mueven en y con la lateral; los jueces de línea, en x e y. */
  function placeOfficials(hl, hw) {
    var dW = hw - C.HW, dL = hl - C.HL;
    function mv(P, judge) {
      if (!P || !P.sim || !P.root) return;
      if (!P.home) P.home = { x: P.sim.x, y: P.sim.y, z: P.sim.z };
      var h = P.home, x = P === R2 ? P.sim.x : h.x + (judge ? (h.x > 0 ? 1 : -1) * dL : 0), y = h.y + (h.y > 0 ? 1 : -1) * dW;
      P.sim.x = x; P.sim.y = y; VB.toThree(x, y, h.z, P.root.position);
    }
    for (var i = 0; i < refs.length; i++) mv(refs[i], false);
    for (var j = 0; j < judges.length; j++) mv(judges[j], true);
  }
  /** Pista de la partida en la playa: repinta las cintas y rehace postes/silla/mesa si cambia el tamaño (o las reglas). */
  function beachLayout(g) {
    var hl = g && g.HL > 0 ? g.HL : C.HL, hw = g && g.HW > 0 ? g.HW : C.HW, rules = !!(g && g.beach);
    if (hl === BEACH.hl && hw === BEACH.hw && rules === BEACH.rules && BEACH.net) return;
    var redraw = BEACH.courtCv && (hl !== BEACH.hl || hw !== BEACH.hw || rules !== BEACH.rules), rebuild = !BEACH.net || hw !== BEACH.hw;
    BEACH.hl = hl; BEACH.hw = hw; BEACH.rules = rules;
    if (redraw) { drawBeachCourt(BEACH.courtCv, BEACH.courtPpm); BEACH.courtTex.needsUpdate = true; }
    if (rebuild && BEACH.grp) {
      var geo = beachNetGeo(hw);
      if (BEACH.net) { BEACH.net.geometry.dispose(); BEACH.net.geometry = geo; if (BEACH.netInk) BEACH.netInk.geometry = geo; }
      else {
        var m = new THREE.Mesh(geo, VB.TOON.toonMat({ vertexColors: true })); m.name = 'beachNet'; m.receiveShadow = true;
        m.castShadow = !lastQ || lastQ.rank >= 1; BEACH.grp.add(m); BEACH.net = m; casters.push(m);
        BEACH.netInk = VB.TOON.outline(m, 0.008); m.updateMatrix(); m.matrixAutoUpdate = false;
      }
    }
    if (BEACH.on) { netScale(hw); placeOfficials(hl, hw); }
  }

  function buildBeach() {
    var sd = _seed; _seed = 4242017;
    if (!_mo) { _mo = new THREE.Matrix4(); _ml = new THREE.Matrix4(); BT = { a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) }; }
    beachGeos();
    var G = new THREE.Group(); G.name = 'beach'; BEACH.grp = G; BEACH.texs = [];
    var g0 = ctx.game; BEACH.hl = g0 && g0.HL > 0 ? g0.HL : C.HL; BEACH.hw = g0 && g0.HW > 0 ? g0.HW : C.HW; BEACH.rules = !!(g0 && g0.beach); BEACH.net = null;
    beachSky(G); beachBackdrop(G); beachSea(G); beachSand(G); beachGulls(G);
    var B = new Builder();
    beachBanners(G, B); beachProps(B); var seats = beachStands(B);
    var stat = new THREE.Mesh(B.build(), VB.TOON.toonMat({ vertexColors: true }));
    stat.name = 'beachStatic'; stat.castShadow = true; stat.receiveShadow = true; G.add(stat); BEACH.stat = stat; casters.push(stat);
    BEACH.ink = VB.TOON.outline(stat, 0.008);
    beachCrowd(G, seats);
    beachLayout(ctx.game); // red, postes, silla y mesa a la medida de la pista de la partida
    beachBoats(G);
    // las geometrías de las piezas solo se copian en las mallas fusionadas: nunca llegan a la GPU
    for (var k in BGEO) BGEO[k].dispose(); BGEO = null;
    root.add(G); G.updateMatrixWorld(true);
    G.traverse(function (o) { if (o !== BEACH.clouds) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    _seed = sd;
    try {
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
        if (BEACH.grp === G && BEACH.bannerCv) { drawBeachBanners(BEACH.bannerCv); BEACH.bannerTex.needsUpdate = true; }
      });
    } catch (e) { }
  }
  function disposeBeach() {
    var G = BEACH.grp; if (!G) return;
    if (BEACH.ink) { VB.TOON.drop(BEACH.ink); BEACH.ink = null; } // material de tinta compartido (caché de VB.TOON): no se libera
    var ci = casters.indexOf(BEACH.stat); if (ci >= 0) casters.splice(ci, 1);
    if (BEACH.netInk) { VB.TOON.drop(BEACH.netInk); BEACH.netInk = null; }
    var ni = casters.indexOf(BEACH.net); if (ni >= 0) casters.splice(ni, 1);
    if (BEACH.crowd) { var L = BEACH.crowd.userData.lods; L.hi.dispose(); L.lo.dispose(); }
    G.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.userData.sharedMat) o.material.dispose(); // el del público es el del pabellón
    });
    for (var i = 0; i < BEACH.texs.length; i++) BEACH.texs[i].dispose();
    root.remove(G);
    BEACH.grp = BEACH.seaU = BEACH.clouds = BEACH.crowd = BEACH.stat = BEACH.sandMat = BEACH.courtMat = BEACH.gullU = BEACH.boatU = BEACH.backdrop = BEACH.skyU = null;
    BEACH.bannerCv = BEACH.bannerTex = BEACH.courtCv = BEACH.courtTex = BEACH.net = null; BEACH.texs = []; BEACH.hl = BEACH.hw = null;
  }
  /** Oculta el pabellón en la playa (lo llama setQuality al final: así no vuelve a enseñar lo que la calidad enciende). */
  function venueVis() {
    if (!BEACH.hallObjs) { BEACH.hallObjs = []; for (var i = 0; i < root.children.length; i++) if (HALL_ONLY[root.children[i].name]) BEACH.hallObjs.push(root.children[i]); }
    if (BEACH.on) for (var j = 0; j < BEACH.hallObjs.length; j++) BEACH.hallObjs[j].visible = false;
    if (BEACH.grp) BEACH.grp.visible = BEACH.on;
    if (!BEACH.poles) BEACH.poles = root.getObjectByName('poles'); // postes y protecciones gruesas del pabellón (en la playa: `beachNet`)
    if (BEACH.poles) BEACH.poles.visible = !BEACH.on;
  }
  /** Cielo, niebla, tono de las luces y bruma del público de cada sede (guarda los del pabellón la primera vez). */
  function venueLook() {
    var fog = ctx.scene.fog;
    if (BEACH.on && !BEACH.save) BEACH.save = { fog: fog.color.clone(), near: fog.near, far: fog.far, hemiC: hemi.color.clone(), hemiG: hemi.groundColor.clone(),
      key: keyLight.color.clone(), fill: fillLight ? fillLight.color.clone() : null, rim: rimLight ? rimLight.color.clone() : null, haze: crowdU.uHazeC.value.clone() };
    var S = BEACH.save; if (!S) return;
    if (BEACH.on) {
      var LK = beachPal();
      fog.color.set(LK.sky.fog); fog.near = 60; fog.far = 200;
      hemi.color.set(LK.hemi); hemi.groundColor.set(LK.ground); keyLight.color.set(LK.key);
      if (fillLight) fillLight.color.set(LK.fill); if (rimLight) rimLight.color.set(LK.rim);
      var hc = new THREE.Color(LK.sky.fog); crowdU.uHazeC.value.set(hc.r, hc.g, hc.b);
      beachTint();
    } else {
      fog.color.copy(S.fog); fog.near = S.near; fog.far = S.far; hemi.color.copy(S.hemiC); hemi.groundColor.copy(S.hemiG); keyLight.color.copy(S.key);
      if (fillLight && S.fill) fillLight.color.copy(S.fill); if (rimLight && S.rim) rimLight.color.copy(S.rim); crowdU.uHazeC.value.copy(S.haze);
    }
    if (MOOD.keyC) MOOD.keyC.copy(keyLight.color); if (MOOD.rimC && rimLight) MOOD.rimC.copy(rimLight.color); MOOD.dirty = true;
  }
  /** Ajustes por calidad de la playa (al final de setQuality, con la fila LT del nivel ya aplicada). */
  function beachQuality(q, L) {
    var cm = BEACH.crowd;
    if (cm) { var ud = cm.userData; cm.geometry = ud.lods[q.rank >= 2 ? 'hi' : 'lo']; cm.count = Math.max(1, Math.floor(ud.full * Math.max(0.6, q.crowdDensity == null ? 1 : q.crowdDensity))); }
    if (!BEACH.on) return;
    var LK = beachPal(); keyLight.intensity = L.key * BL.key * LK.keyK; hemi.intensity = L.hemi * BL.hemi * LK.hemiK;
    if (fillLight && fillLight.intensity > 0) fillLight.intensity = L.fill * BL.fill;
    if (rimLight && rimLight.intensity > 0) rimLight.intensity = MOOD.rimBase = L.rim * BL.rim;
    if (BEACH.sandMat) BEACH.sandMat.color.setScalar(L.floor * BL.floor);
    if (BEACH.courtMat) BEACH.courtMat.color.setScalar(L.floor * BL.floor);
    MOOD.dirty = true;
  }
  function wantVenue() {
    var p = ctx.params && ctx.params.map;
    if (p === 'beach' || p === 'playa') return 'beach';
    if (p === 'hall') return 'hall';
    return ctx.settings && ctx.settings.arena === 'beach' ? 'beach' : 'hall';
  }
  function setVenue(id) {
    id = id === 'beach' ? 'beach' : 'hall';
    if (id === VENUE.id && (id === 'hall' || BEACH.grp)) return;
    VENUE.id = id;
    if (id === 'beach') { if (!BEACH.grp) buildBeach(); BEACH.on = true; netScale(BEACH.hw); placeOfficials(BEACH.hl, BEACH.hw); }
    else {
      BEACH.on = false; netScale(C.HW); placeOfficials(C.HL, C.HW); // el pabellón, como siempre
      if (BEACH.hallObjs) for (var i = 0; i < BEACH.hallObjs.length; i++) BEACH.hallObjs[i].visible = true; // setQuality vuelve a ocultar lo de cada nivel
      disposeBeach();
    }
    venueLook(); padRedraw();
    if (lastQ) VB.Arena.setQuality(lastQ); else venueVis();
    if (ctx.fixShadowDepth) { try { ctx.fixShadowDepth(); } catch (e) { } }
  }
  function beachStep() {
    if (BEACH.seaU) BEACH.seaU.uT.value = ctx.time % 3600;
    if (BEACH.clouds) BEACH.clouds.rotation.y = (ctx.time * 0.0035) % TAU;
    if (BEACH.gullU) BEACH.gullU.uT.value = ctx.time % 3600;
    if (BEACH.boatU) BEACH.boatU.uT.value = ctx.time % 7200;
  }

  // ---------- Interfaz del módulo ----------
  VB.Arena = {
    init: function (c) {
      ctx = c; THREE = c.THREE; C = VB.C; makeToon(THREE);
      _m = new THREE.Matrix4(); _m3 = new THREE.Matrix3(); _q = new THREE.Quaternion(); _e = new THREE.Euler(); _v = new THREE.Vector3();
      _v2 = new THREE.Vector3(); _s = new THREE.Vector3(); _p = new THREE.Vector3(); _sz = new THREE.Vector2(); UNIT_BOX = new THREE.BoxGeometry(1, 1, 1); _m4i = new THREE.Matrix4();
      root = new THREE.Group(); root.name = 'arena'; ctx.scene.add(root);
      var fogc = new THREE.Color(0x1d1a44); // CARTOON: niebla violeta (antes casi negra)
      ctx.scene.fog = new THREE.Fog(fogc, 38, 100);
      ctx.scene.background = fogc;
      var S = new Builder(), E = new Builder(), SC = new Builder();
      buildFloor();
      root.add(buildNet(SC));
      buildOfficials(SC, E);
      buildLED(S);
      var seats = buildStands(S, E);
      finishLedRefl();
      buildCrowd(seats);
      buildScreens(S, E);
      buildHall(S, E);
      buildCrew(S, E);          // ARN-14 (después de la grada: no cambia la secuencia aleatoria del público)
      finalizeOfficials();
      buildLights(c.quality || { shadows: true, shadowSize: 2048 });
      buildFlashes();
      // fusión estática: 1 malla iluminada + 1 emisiva
      var sm = new THREE.Mesh(S.build(), standDim(VB.TOON.toonMat({ vertexColors: true })));
      sm.receiveShadow = true; sm.castShadow = false; sm.name = 'static'; root.add(sm);
      // utillaje junto a la pista (cinta, postes, silla, mesa): sí proyecta sombra
      var scm = new THREE.Mesh(SC.build(), sm.material); scm.castShadow = true; scm.receiveShadow = true; scm.name = 'props'; root.add(scm); casters.push(scm);
      VB.TOON.outline(scm, 0.008); // silla, mesa, cinta de la red, bancos: tinta (media/alta)
      // oficiales: 44 k triángulos más con contorno → solo en alta (en media el presupuesto es de 350 k)
      for (var oi = 0; oi < officials.length; oi++) { var oo = VB.TOON.outline(officials[oi], 0.006); if (oo) { oo.userData.inkRank = 2; oo.visible = (VB.TOON.rank == null ? 2 : VB.TOON.rank) >= 2; } }
      emissiveMesh = new THREE.Mesh(E.build(), emissiveScreens(topFade(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }), 'vb-emis-top-scr')));
      emissiveScreensAttr(emissiveMesh.geometry);
      emissiveMesh.name = 'emissive'; root.add(emissiveMesh);
      buildEnvironment();
      redrawScreens(); warmMsgFonts();
      freezeStatic();
      // la fuente de la UI puede llegar tarde: repintar textos
      try {
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
          try { drawBrands(led.cv); led.tex.needsUpdate = true; SB.dirty = true; padRedraw(); if (flagTex) { flagTex.image = drawFlagAtlas(); flagTex.needsUpdate = true; } if (banner.cv) { drawBanners(); banner.tex.needsUpdate = true; }
            drawFloor(floorCanvas, floorPpm); floorTex.needsUpdate = true; warmMsgFonts(); } catch (e) { }
        });
      } catch (e) { }
      this.setQuality(c.quality);
      BEACH.light = wantLight();
      setVenue(wantVenue()); // playa: ajuste `arena` o ?map=beach
    },
    /** Ajuste `arena` ('hall' | 'beach'): cambia la sede en vivo (también en el menú, con la demo de fondo). */
    onSettings: function (s, k) { if (k === 'arena' && s) setVenue(s.arena); else if (k === 'beachLight' && s) VB.Arena.beachLight(s.beachLight); },
    /** Luz de la playa: 'dia' | 'tarde' (en vivo; sin argumento devuelve la actual). */
    beachLight: function (mode) {
      if (mode === undefined) return BEACH.light;
      BEACH.light = mode === 'tarde' ? 'tarde' : 'dia';
      if (BEACH.on) { venueLook(); if (lastQ) VB.Arena.setQuality(lastQ); }
      return BEACH.light;
    },
    onGameStart: function (g) {
      RT.cheerT[0] = RT.cheerT[1] = 0; RT.waveAmp = 0; RT.waveT = 0; netRip.t = 9; led.msgT = 0; setLedMode(false); led.w = 0;
      SB.msgT = 0; SB.msg = ''; SB.next = null; led.next = null; RT.ccT = 0; scoreFromGame(g);
      MOOD.winOn = false; MOOD.win = 0; MOOD.pfT = 9; MOOD.tense = 0; MOOD.dirty = true;
    },
    onState: function (s) { if (s === 'menu') RT.menuWave = 6; },
    setQuality: function (q) {
      if (!q || !keyLight) return;
      lastQ = q;
      keyLight.castShadow = !!q.shadows;
      // calidad baja: el utillaje, los postes y los oficiales no entran en el mapa de sombras (solo jugadores y balón)
      for (var ca = 0; ca < casters.length; ca++) casters[ca].castShadow = q.rank >= 1;
      for (var of = 0; of < officials.length; of++) {
        var ofm = officials[of]; ofm.castShadow = q.rank >= 1;
        // ARN-14: baja sin 3.er suplente ni cámara de TV; playa: sin suplentes ni cámara (y en baja, sin fotógrafos)
        if (ofm.userData.lowIdx) ofm.geometry.setDrawRange(0, BEACH.on ? (q.rank >= 1 ? ofm.userData.beachIdx : ofm.userData.beachLowIdx) : q.rank >= 1 ? Infinity : ofm.userData.lowIdx);
      }
      if (keyLight.shadow.mapSize.x !== q.shadowSize) {
        keyLight.shadow.mapSize.set(q.shadowSize, q.shadowSize);
        if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
      }
      var dens = q.crowdDensity == null ? 1 : q.crowdDensity;
      // LOD del público: detallada en alta; en media solo la grada de fondo detrás del sacador humano (crowd2, la que
      // sale de cerca en saque/repetición; las laterales y el fondo rival se ven a distancia de juego); baja: sencilla
      // media: la malla 3D solo dibuja las filas cercanas (van primero en cada grada) y las lejanas son impostores;
      // baja: toda la grada en impostores (1 dibujo, ~2 triángulos por persona)
      for (var i = 0; i < crowdMeshes.length; i++) {
        var cmh = crowdMeshes[i], ud = cmh.userData;
        cmh.visible = q.rank >= 1 || !imp.mesh;
        cmh.count = Math.max(1, Math.floor((q.rank === 1 && imp.mesh ? ud.near : ud.full) * dens));
        var crowdLv = q.rank >= 2 || (q.rank === 1 && !ctx.isMobile && cmh.name === 'crowd2') ? 'hi' : 'lo';
        if (ud.lods) cmh.geometry = ud.lods[crowdLv];
      }
      if (imp.mesh) {
        imp.mesh.visible = q.rank < 2;
        imp.U.uDens.value = dens; imp.U.uSkipNear.value = q.rank === 1 ? 1 : 0;
        // luz equivalente a la del público 3D (Lambert) en cada calidad (en baja no hay relleno ni contraluz)
        imp.U.uLight.value.setScalar(q.rank >= 1 ? IMP_LIGHT[1] : IMP_LIGHT[0]);
      }
      if (flagMesh) flagMesh.visible = q.rank >= 1;
      for (var c = 0; c < cones.length; c++) cones[c].visible = q.rank >= 1;
      MOOD.coneBase = q.rank >= 2 ? 0.04 : 0.032; MOOD.dirty = true;
      if (coneMat) coneMat.uniforms.k.value = MOOD.coneBase;
      if (flashes) flashes.visible = q.rank >= 1;
      // calidad baja = recortar CPU de verdad (en móvil el coste está en el propio render de three, no en la GPU):
      // sin reflejos falsos de las vallas (4 dibujos) y sin luces de relleno/contraluz (2 luces menos en cada
      // material iluminado: menos uniformes y menos trabajo por fragmento); la hemisférica compensa.
      // reflejos del suelo en media/alta; halos de las vallas solo sin bloom (media y baja): misma malla, un dibujo
      if (led.refl) { led.refl.visible = true; led.GLOW = wantPost(q) ? 0 : GLOW_K; led.reflMat.uniforms.reflK.value = q.rank >= 1 ? 1 : 0; MOOD.dirty = true; }
      // en el móvil, el mismo NÚMERO de luces en todos los niveles (intensidad 0 en vez de ocultarlas): cambiar el número
      // de luces direccionales recompila todos los materiales iluminados (parón de ~1,6 s con CPU ×10 al bajar de calidad)
      var keepLights = !!ctx.isMobile;
      var L = LT[q.rank >= 2 ? 2 : q.rank === 1 ? 1 : 0];
      keyLight.intensity = L.key;
      if (fillLight) { fillLight.visible = keepLights || q.rank >= 1; fillLight.intensity = q.rank >= 1 ? L.fill : 0; }
      if (rimLight) { rimLight.visible = keepLights || q.rank >= 1; rimLight.intensity = MOOD.rimBase = q.rank >= 1 ? L.rim : 0; }
      if (hemi) hemi.intensity = L.hemi;
      if (floorMat) floorMat.color.setScalar(L.floor); // tinte de la tarima por nivel (ARN-01: pista ≥ 189 en todos)
      if (VB.TOON) VB.TOON.setQuality(q); // contornos de tinta fuera en baja
      if (BEACH.grp) beachQuality(q, L);
      venueVis(); // en la playa, el pabellón sigue oculto aunque el nivel encienda sus piezas
      setPost(wantPost(q)); haloScale();
    },
    resize: function () { postResize(); },
    /** Por frame. dt = tiempo de JUEGO (0 en pausa); la animación ambiental usa tiempo real. */
    update: function (g, dt, events) {
      if (!g) return;
      if (events && events.length) onEvents(g, events);
      var rdt = ctx.realDt || 0;
      if (VB.TOON) VB.TOON.frame(ctx.camera, ctx.height || 720);
      // público: alegría por equipo, ola, tensión en punto de set/partido
      for (var t = 0; t < 2; t++) { if (RT.cheerT[t] > 0) RT.cheerT[t] = Math.max(0, RT.cheerT[t] - rdt); }
      crowdU.uTime.value = ctx.time;
      crowdU.uCheer.value.set(Math.min(1, RT.cheerT[0] / 0.8), Math.min(1, RT.cheerT[1] / 0.8));
      RT.cheerAge[0] = Math.min(9, RT.cheerAge[0] + rdt); RT.cheerAge[1] = Math.min(9, RT.cheerAge[1] + rdt);
      crowdU.uCheerAge.value.set(RT.cheerAge[0], RT.cheerAge[1]);
      // las cabezas siguen el balón durante el rally; entre puntos miran más a su aire
      VB.toThree(g.ball.x, g.ball.y, g.ball.z, crowdU.uBall.value);
      RT.look = damp(RT.look, g.mode === 'rally' || g.mode === 'serve' ? 1 : 0.45, 2, rdt); crowdU.uLook.value = RT.look;
      if (ctx.state === 'menu' || g.demo) { RT.menuWave -= rdt; if (RT.menuWave <= 0) { RT.menuWave = 45; RT.waveT = 9; } }
      if (RT.waveT > 0) { RT.waveT -= rdt; RT.waveX = (RT.waveX + rdt * 0.11) % 1; }
      var wa = RT.waveT > 0 ? Math.min(1, RT.waveT / 1.5) : 0;
      crowdU.uWave.value.set(RT.waveX, wa);
      if (RT.ccT > 0) RT.ccT = Math.max(0, RT.ccT - rdt);
    var tens = ((g.matchPoint >= 0 || g.setPoint >= 0) && g.mode !== 'over') || RT.ccT > 0 ? 1 : 0;
      RT.tension += (tens - RT.tension) * Math.min(1, rdt * 2); crowdU.uTension.value = RT.tension;
      updateLED(rdt);
      if (SB.msgT > 0) { SB.msgT -= rdt; if (SB.msgT <= 0) { SB.dirty = true; if (SB.next) { var nx = SB.next; SB.next = null; screenMsg(nx[0], nx[1], nx[2], nx[3], nx[4]); } } }
      if (SB.dirty && !BEACH.on) redrawScreens(); // en la playa no hay marcadores: se repintan al volver (sigue dirty)
      if (screens.flash > 0) {
        screens.flash = Math.max(0, screens.flash - rdt * 1.5);
        var fb = (screens.base || 1) * (1 + screens.flash * 0.45 * softK());
        for (var j = 0; j < screens.mats.length; j++) screens.mats[j].uniforms.boost.value = fb;
      }
      if (BEACH.on) { beachLayout(g); beachStep(); } else screenVis(rdt, g);
      updateNet(dt > 0 ? dt : 0, g);
      updateOfficials(g, dt, rdt);
      updateFlashes(rdt);
      applyMood(g, rdt);
    },
    // ---- añadidos opcionales (ver notes/arena.md) ----
    /** Límites útiles para la cámara (coordenadas de sim). */
    bounds: { freeX: FZX, freeY: FZY, boardsX: BX, boardsY: BY, standsX: SX0, standsY: SY0, hallX: HALL_X, hallY: HALL_Y, hallH: HALL_H },
    /** Sede actual: 'hall' (Palau del Mar) | 'beach' (Platja Llarga) y su nombre para la interfaz. */
    venue: function () { return VENUE.id; },
    venueName: function (id) { return VENUE.names[id || VENUE.id] || VENUE.names.hall; },
    /** Fuerza un mensaje en las vallas LED. */
    message: function (text, team, dur) { if (led.mcv) ledMessage(String(text), TEAMC[team === 1 ? 1 : 0], dur || 2.5); },
    /** Hace saltar al público de un equipo (0/1) durante `sec` segundos. */
    cheer: function (team, sec) { startCheer(team === 1 ? 1 : 0, sec || 2); },
    /** Lanza la ola en la grada. */
    wave: function (sec) { RT.waveT = sec || 8; },
    /** Segundos que quedan del "momento" de cambio de campo (0 = no hay). Para camera.js / ui.js. */
    courtChangeT: function () { return RT.ccT; },
    /** Puntos de interés del pabellón (coords de sim) para planos de cámara: marcador colgado, videomarcadores. */
    landmarks: { scoreHung: { x: 0, y: 0, z: 11.4 }, screenPos: { x: HALL_X - 0.63, y: 0, z: SCR_Z }, screenNeg: { x: -(HALL_X - 0.63), y: 0, z: SCR_Z },
      // ARN-14: banquillo de cada equipo (centro, a la altura de las cabezas de los suplentes sentados; el equipo 0 juega en x > 0),
      // fotógrafos (esquinas) y cámara de TV. Fuera de la zona libre: útiles como objetivo de un plano, no como posición de cámara.
      benches: [{ x: CREW_BENCH_X, y: CREW_BENCH_Y, z: CREW_RISER + 1.15 }, { x: -CREW_BENCH_X, y: CREW_BENCH_Y, z: CREW_RISER + 1.15 }],
      photographers: [{ x: 16.25, y: 10.2, z: 0.9 }, { x: 16.3, y: -10.15, z: 0.9 }, { x: -16.25, y: -10.2, z: 0.9 }, { x: -16.3, y: 10.15, z: 0.9 }],
      tvCamera: { x: -2.7, y: -10.62, z: 2.0 } },
    /** ¿Post-proceso activo? */
    postActive: function () { return !!post && ctx.renderFn === renderPost; },
    /** ARN-03: objetos para precompilar TODAS las variantes de material que el pabellón y los efectos estrenan en juego
     *  (banderolas, público impostor, vallas/marcadores LED, banderas, pools de fx.js: estela, destellos, ondas, chispas,
     *  polvo, confeti, aros, marcas…). Copias que comparten geometría y material: añadirlas a un grupo temporal DENTRO de
     *  ctx.scene (mismas luces, niebla y entorno = mismos programas), renderer.compile(scene, camera) y quitar el grupo.
     *  No las liberéis con dispose(): la geometría y el material son los del juego. */
    prewarmList: function () {
      var out = [];
      if (root) prewarmProxies(root, out);
      if (VB.FX && VB.FX.prewarmList) { try { var f = VB.FX.prewarmList(); for (var i = 0; i < f.length; i++) out.push(f[i]); } catch (e) { } }
      return out;
    },
    /** ARN-03: precompila prewarmList() de una vez, con el destino de render REAL: con el post-proceso activo la escena se
     *  pinta en su destino (salida lineal) y los programas son OTRA variante que pintando a pantalla. Devuelve ms. */
    prewarmCompile: function () {
      var r = ctx.renderer, sc = ctx.scene, t0 = performance.now(), grp = new THREE.Group(), list = this.prewarmList();
      grp.name = 'prewarm'; for (var i = 0; i < list.length; i++) grp.add(list[i]);
      var prev = r.getRenderTarget();
      try {
        sc.add(grp); sc.updateMatrixWorld(true);
        if (post && ctx.renderFn === renderPost) r.setRenderTarget(post.rt);
        r.compile(sc, ctx.camera);
      } catch (e) { console.warn('[VB] arena: prewarm', e); }
      r.setRenderTarget(prev); sc.remove(grp);
      return Math.round(performance.now() - t0);
    },
    /** Solo depuración (tools/eval.js): uniformes del público, oficiales, etc. */
    _dbg: function () { return { crowdU: crowdU, crowdMeshes: crowdMeshes, refs: refs, judges: judges, led: led, RT: RT, LT: LT, imp: imp,
      lights: { key: keyLight, hemi: hemi, fill: fillLight, rim: rimLight }, floorMat: floorMat, post: post, mood: MOOD, screens: screens,
      crew: crew, crewReact: crewReact, POSE: POSE }; }
  };
})();
