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
  var PAL = {
    court: '#d79a63', courtAttack: '#c98a55', free: '#1c5676', surround: '#101822',
    line: '#fbf7ef', outer: '#0a0f17', wall: '#0d131d', step: '#151d29', stepTop: '#1b2533',
    seatA: '#1f3d5c', seatB: '#28506f', seatC: '#c4532f', barrier: '#0f1722', steel: '#2a3240', truss: '#20262f'
  };
  var TEAMC = ['#ff5b3a', '#3f8cff'];

  // Utilidades reutilizables (nada de `new` por frame)
  var _m, _m3, _q, _e, _v, _v2, _s, _p, _col, UNIT_BOX;
  function col(hex) { return new THREE.Color(hex); }

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
    // zona libre con leve degradado (más clara hacia la pista: luz de TV)
    var gr = g.createRadialGradient(X(0), Y(0), 2 * ppm, X(0), Y(0), 17 * ppm);
    gr.addColorStop(0, '#22668a'); gr.addColorStop(1, '#174a68');
    g.fillStyle = gr; rect(-FZX, -FZY, FZX, FZY);
    // pista y zonas de ataque
    var gc = g.createLinearGradient(X(-9), 0, X(9), 0);
    gc.addColorStop(0, '#d39560'); gc.addColorStop(0.5, PAL.court); gc.addColorStop(1, '#d39560');
    g.fillStyle = gc; rect(-C.HL, -C.HW, C.HL, C.HW);
    g.fillStyle = PAL.courtAttack; rect(-C.ATTACK, -C.HW, C.ATTACK, C.HW);

    // tablas de 7.5 cm a lo largo, con juntas al tresbolillo y variación de tono
    g.save(); g.beginPath(); g.rect(X(-FZX), Y(FZY), 2 * FZX * ppm, 2 * FZY * ppm); g.clip();
    var pw = 0.075 * ppm;
    for (var py = Y(FZY); py < Y(-FZY); py += pw) {
      var x = X(-FZX) - rnd() * 1.6 * ppm;
      while (x < X(FZX)) {
        var len = (0.9 + rnd() * 1.5) * ppm, a = (rnd() - 0.5) * 0.085;
        g.fillStyle = a > 0 ? 'rgba(255,236,210,' + a.toFixed(3) + ')' : 'rgba(30,14,0,' + (-a).toFixed(3) + ')';
        g.fillRect(x, py, len, pw);
        g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x, py, Math.max(1, ppm * 0.012), pw);
        x += len;
      }
      g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(X(-FZX), py, 2 * FZX * ppm, Math.max(1, ppm * 0.01));
    }
    // veta fina (patrón estirado a lo largo)
    var gv = canvas(512, 96), gg = gv.getContext('2d');
    for (var i = 0; i < 1400; i++) {
      gg.fillStyle = rnd() < 0.55 ? 'rgba(40,20,5,' + (0.04 + rnd() * 0.07).toFixed(3) + ')' : 'rgba(255,245,230,' + (0.03 + rnd() * 0.05).toFixed(3) + ')';
      gg.fillRect(rnd() * 512, rnd() * 96, 8 + rnd() * 70, 1);
    }
    g.globalAlpha = 0.32; g.fillStyle = g.createPattern(gv, 'repeat'); g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    g.restore();

    // logotipos del pabellón en la zona libre (se leen desde la cámara de juego)
    g.save(); g.fillStyle = 'rgba(255,255,255,0.13)'; g.textAlign = 'center'; g.textBaseline = 'middle';
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
    g.save(); g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 0.06 * ppm;
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
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.36, metalness: 0, envMapIntensity: 0.75 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; root.add(floor);
    var outer = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALL_X + 2, 2 * HALL_Y + 2),
      new THREE.MeshStandardMaterial({ color: PAL.outer, roughness: 0.85, envMapIntensity: 0.3 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.006; outer.receiveShadow = true; root.add(outer);
  }

  /* =====================================================================
   * RED: malla de 10 cm, banda superior 7 cm, inferior 5 cm, bandas
   * laterales sobre las líneas laterales; antenas de 1.80 m (80 cm sobre la
   * red) con franjas de 10 cm; postes a 1 m con protección; cables.
   * La malla ondula cuando el balón toca la red.
   * ===================================================================== */
  var net = null, netRip = { a: 0, y: 0, z: 0, t: 9, dir: 1 };
  var NET_W = 10, NET_HH = 1, NSX = 50, NSY = 6;
  function netTexture() {
    var Wd = ctx.isMobile ? 1024 : 2048, Ht = Wd / 8, cv = canvas(Wd, Ht), g = cv.getContext('2d');
    var ppm = Wd / NET_W, cell = 0.1 * ppm, top = 0.07 * ppm, bot = 0.05 * ppm;
    g.clearRect(0, 0, Wd, Ht);
    g.strokeStyle = 'rgba(14,16,20,0.96)'; g.lineWidth = Math.max(1.5, ppm * 0.011);
    for (var x = cell / 2; x <= Wd; x += cell) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, Ht - bot); g.stroke(); }
    for (var y = top + cell; y < Ht - bot; y += cell) { g.beginPath(); g.moveTo(0, y); g.lineTo(Wd, y); g.stroke(); }
    // nudos
    g.fillStyle = 'rgba(10,10,12,1)';
    for (var nx = cell / 2; nx <= Wd; nx += cell) for (var ny = top + cell; ny < Ht - bot; ny += cell) g.fillRect(nx - 1.5, ny - 1.5, 3, 3);
    // bandas superior e inferior (lona blanca con costuras)
    g.fillStyle = '#f3f0e8'; g.fillRect(0, 0, Wd, top); g.fillRect(0, Ht - bot, Wd, bot);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, top - 2, Wd, 2); g.fillRect(0, Ht - bot, Wd, 2);
    g.fillStyle = 'rgba(0,0,0,0.10)'; for (var sx = 0; sx < Wd; sx += 12) { g.fillRect(sx, 3, 5, 1); g.fillRect(sx, Ht - bot + bot * 0.5, 5, 1); }
    // marca del fabricante (ficticia) en la banda superior
    g.fillStyle = 'rgba(20,40,70,0.55)'; g.font = '800 ' + Math.round(top * 0.78) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SALT·9  PRO NET', Wd * 0.5, top * 0.55);
    // bandas laterales sobre las líneas laterales (5 cm x 1 m)
    function bandAt(yy) { var u0 = (yy + NET_W / 2) * ppm; g.fillStyle = '#f7f4ee'; g.fillRect(u0, 0, 0.05 * ppm, Ht); }
    bandAt(C.HW - 0.05); bandAt(-C.HW);
    // cuerdas de los extremos
    g.fillStyle = '#e8e4da'; g.fillRect(0, 0, 3, Ht); g.fillRect(Wd - 3, 0, 3, Ht);
    var t = texOf(cv); t.anisotropy = Math.min(16, ctx.renderer.capabilities.getMaxAnisotropy()); return t;
  }
  function stripeTexture(n, a, b) {
    var cv = canvas(8, n * 16), g = cv.getContext('2d');
    for (var i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * 16, 8, 16); }
    return texOf(cv);
  }
  function padTexture() {
    var cv = canvas(256, 512), g = cv.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, '#163a5c'); gr.addColorStop(0.5, '#1f5076'); gr.addColorStop(1, '#163a5c');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#ff6b3d'; g.fillRect(0, 470, 256, 18); g.fillStyle = '#ffd23f'; g.fillRect(0, 30, 256, 8);
    g.save(); g.translate(128, 260); g.rotate(-Math.PI / 2); g.fillStyle = '#ffffff';
    g.font = '900 64px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PALAU DEL MAR', 0, 0); g.restore();
    return texOf(cv);
  }
  function buildNet(S) {
    var grp = new THREE.Group(), top = C.NET_H;
    var geo = new THREE.PlaneGeometry(NET_W, NET_HH, NSX, NSY);
    var tex = netTexture();
    var mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.85, depthWrite: false, alphaTest: 0.04, envMapIntensity: 0.4 }));
    mesh.rotation.y = Math.PI / 2; mesh.position.copy(VB.toThree(0, 0, top - NET_HH / 2, new THREE.Vector3()));
    mesh.renderOrder = 1; grp.add(mesh);
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
    // antenas (diámetro exagerado ligeramente para que se lean a distancia)
    var antTex = stripeTexture(18, '#e0262f', '#f7f5f0');
    var antMat = new THREE.MeshStandardMaterial({ map: antTex, roughness: 0.4, envMapIntensity: 0.6 });
    var antGeo = new THREE.CylinderGeometry(0.013, 0.013, 1.8, 10);
    for (var a = -1; a <= 1; a += 2) {
      var ant = new THREE.Mesh(antGeo, antMat);
      ant.position.copy(VB.toThree(0.03, a * (C.HW + 0.006), top - NET_HH + 0.9, new THREE.Vector3())); ant.castShadow = true; grp.add(ant);
    }
    // postes a 1 m de las laterales (y = ±5.5) con protección acolchada
    var postMat = new THREE.MeshStandardMaterial({ color: '#c7ccd3', metalness: 0.75, roughness: 0.3 });
    var padMat = new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.75, envMapIntensity: 0.5 });
    var postGeo = new THREE.CylinderGeometry(0.05, 0.05, top + 0.2, 16), padGeo = new THREE.CylinderGeometry(0.17, 0.17, 1.95, 24);
    for (var p = -1; p <= 1; p += 2) {
      var py = p * (C.HW + 1);
      var post = new THREE.Mesh(postGeo, postMat); post.position.copy(VB.toThree(0, py, (top + 0.2) / 2, new THREE.Vector3())); post.castShadow = true; grp.add(post);
      var pad = new THREE.Mesh(padGeo, padMat); pad.position.copy(VB.toThree(0, py, 0.975, new THREE.Vector3())); pad.castShadow = true;
      pad.rotation.y = p > 0 ? Math.PI : 0; grp.add(pad);
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
  var personMat, refs = [], judges = [], R1 = null, R2 = null;
  function makePerson(o) {
    var grp = new THREE.Group(), B = new Builder();
    var shirt = col(o.shirt), pants = col(o.pants), skin = col(o.skin), hair = col(o.hair), shoe = col('#15171b');
    var up = o.seated ? -0.36 : 0;
    var cap = function (r, l) { return new THREE.CapsuleGeometry(r, l, 3, 7); };
    if (!o.seated) {
      for (var s = -1; s <= 1; s += 2) {
        B.geo(cap(0.068, 0.66), s * 0.1, 0.46, 0, pants);
        B.box(0.11, 0.08, 0.27, s * 0.1, 0.04, 0.04, shoe);
      }
    } else {
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        B.geo(cap(0.07, 0.34), s2 * 0.1, 0.52, 0.2, pants, 0, Math.PI / 2);
        B.geo(cap(0.06, 0.36), s2 * 0.1, 0.26, 0.4, pants);
        B.box(0.11, 0.08, 0.26, s2 * 0.1, 0.04, 0.45, shoe);
      }
    }
    B.box(0.34, 0.2, 0.22, 0, 0.88 + up, 0, pants);
    B.geo(cap(0.165, 0.34), 0, 1.2 + up, 0, shirt, 0, 0, 0, 1, 1, 0.66);
    B.box(0.2, 0.05, 0.13, 0, 1.47 + up, 0.0, col(o.collar || o.shirt));
    B.geo(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8), 0, 1.52 + up, 0, skin);
    var body = new THREE.Mesh(B.build(), personMat); body.castShadow = true; grp.add(body);
    var head = new THREE.Group(); head.position.y = 1.56 + up; head.rotation.order = 'YXZ'; grp.add(head);
    var HB = new Builder();
    HB.geo(new THREE.SphereGeometry(0.108, 12, 9), 0, 0.12, 0, skin, 0, 0, 0, 1, 1.08, 1);
    HB.geo(new THREE.SphereGeometry(0.114, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.135, -0.01, hair);
    HB.box(0.03, 0.04, 0.04, 0, 0.11, 0.105, skin);
    var hm = new THREE.Mesh(HB.build(), personMat); hm.castShadow = true; head.add(hm);
    function arm(sx) {
      var a = new THREE.Group(); a.position.set(sx * 0.215, 1.43 + up, 0); grp.add(a);
      var AB = new Builder();
      AB.geo(cap(0.056, 0.16), 0, -0.11, 0, shirt);
      AB.geo(cap(0.045, 0.36), 0, -0.38, 0, skin);
      AB.geo(new THREE.SphereGeometry(0.052, 8, 6), 0, -0.6, 0, skin);
      var am = new THREE.Mesh(AB.build(), personMat); am.castShadow = true; a.add(am);
      return a;
    }
    var P = { root: grp, head: head, armR: arm(-1), armL: arm(1), tR: { x: 0, z: -0.12 }, tL: { x: 0, z: 0.12 }, hold: 0, flag: null };
    P.armR.rotation.z = -0.12; P.armL.rotation.z = 0.12;
    if (o.flag) {
      var fcv = canvas(32, 32), fg = fcv.getContext('2d');
      for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { fg.fillStyle = (i + j) % 2 ? '#ffd23f' : '#e0262f'; fg.fillRect(i * 8, j * 8, 8, 8); }
      var fl = new THREE.Group(); fl.position.y = -0.62; P.armR.add(fl);
      var stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 5), personMat); stick.position.y = -0.2; fl.add(stick);
      var fm = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshStandardMaterial({ map: texOf(fcv), side: THREE.DoubleSide, roughness: 0.8 }));
      fm.position.set(0, -0.3, 0.17); fm.rotation.y = Math.PI / 2; fl.add(fm); P.flag = fl;
    }
    root.add(grp);
    return P;
  }
  function placePerson(P, sx, sy, sz, faceX, faceY) {
    VB.toThree(sx, sy, sz, P.root.position);
    P.root.rotation.y = Math.atan2(faceX, -faceY); // modelo mira a +Z local; sim (fx,fy) -> three (fx, -fy)
    P.sim = { x: sx, y: sy, z: sz };
  }
  function buildOfficials(S) {
    personMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, envMapIntensity: 0.5 });
    var ref = { shirt: '#1d2a44', collar: '#f1efe8', pants: '#16191f', skin: '#d9a77f', hair: '#2a1c12' };
    // Silla del 1.er árbitro (junto al poste del lado -y), plataforma a 1.25 m
    var ry = -(C.HW + 1.62), steel = col('#3a4350'), padc = col('#1f5076');
    for (var lx = -1; lx <= 1; lx += 2) for (var ly = -1; ly <= 1; ly += 2) S.sbox(0.06, 0.06, 1.25, lx * 0.32, ry + ly * 0.32, 0.625, steel);
    S.sbox(0.76, 0.76, 0.08, 0, ry, 1.25, steel);
    S.sbox(0.76, 0.06, 0.95, 0, ry + 0.38, 1.7, steel);             // barandilla trasera
    for (var rl = -1; rl <= 1; rl += 2) S.sbox(0.06, 0.76, 0.06, rl * 0.38, ry, 2.15, steel);
    S.sbox(0.7, 0.12, 1.15, 0, ry - 0.36, 0.62, padc);               // protección frontal acolchada
    for (var st = 0; st < 5; st++) S.sbox(0.5, 0.05, 0.03, 0, ry + 0.42, 0.22 + st * 0.22, steel); // escalera
    R1 = makePerson(ref); placePerson(R1, 0, ry, 1.29, 0, 1); refs.push(R1);
    // 2.º árbitro de pie junto al poste opuesto
    R2 = makePerson(ref); placePerson(R2, 0, C.HW + 1.55, 0, 0, -1); refs.push(R2);
    // Mesa del anotador detrás del 2.º árbitro
    var ty = C.HW + 3.6, tabc = col('#121a26');
    S.sbox(2.8, 0.7, 0.06, 0, ty, 0.76, col('#1a2433'));
    S.sbox(2.8, 0.05, 0.72, 0, ty - 0.33, 0.38, tabc);
    for (var c = -1; c <= 1; c += 2) {
      var sc = makePerson({ shirt: '#22304a', pants: '#16191f', skin: c > 0 ? '#c68b5e' : '#f0c9a6', hair: c > 0 ? '#111' : '#6b4a2a', seated: true });
      placePerson(sc, c * 0.6, ty + 0.5, 0, 0, -1); refs.push(sc);
      S.sbox(0.44, 0.44, 0.05, c * 0.6, ty + 0.62, 0.45, steel); S.sbox(0.44, 0.05, 0.45, c * 0.6, ty + 0.84, 0.7, steel);
      S.sbox(0.05, 0.05, 0.45, c * 0.6, ty + 0.62, 0.22, steel);
      // portátil/acta
      S.sbox(0.32, 0.24, 0.02, c * 0.6, ty - 0.05, 0.8, col('#d8dde4'));
    }
    // Jueces de línea en las esquinas diagonales (a la derecha de cada árbitro)
    var lj = { shirt: '#eeeeea', collar: '#1d2a44', pants: '#16191f', skin: '#e6b48a', hair: '#3a2618', flag: true };
    var J1 = makePerson(lj); placePerson(J1, C.HL + 1.4, -(C.HW + 1.4), 0, -0.7, 0.7); J1.lines = [0, -1]; judges.push(J1);
    lj.skin = '#8d5a3b'; lj.hair = '#111111';
    var J2 = makePerson(lj); placePerson(J2, -(C.HL + 1.4), C.HW + 1.4, 0, 0.7, -0.7); J2.lines = [1, 1]; judges.push(J2);
  }
  function angWrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function damp(a, b, rate, dt) { return a + (b - a) * (1 - Math.exp(-rate * dt)); }
  function updateOfficials(g, dt, rdt) {
    var b = g.ball, tb = _v2; VB.toThree(b.x, b.y, b.z, tb);
    var k = rdt > 0 ? rdt : 0;
    for (var i = 0; i < refs.length; i++) {
      var P = refs[i], hp = P.head;
      P.head.getWorldPosition(_v);
      var dx = tb.x - _v.x, dy = tb.y - _v.y - 0.12, dz = tb.z - _v.z;
      var yaw = angWrap(Math.atan2(dx, dz) - P.root.rotation.y);
      yaw = Math.max(-1.25, Math.min(1.25, yaw));
      var pitch = -Math.atan2(dy, Math.hypot(dx, dz)); pitch = Math.max(-0.6, Math.min(0.5, pitch));
      hp.rotation.y = damp(hp.rotation.y, yaw, 7, k); hp.rotation.x = damp(hp.rotation.x, pitch, 7, k);
      if (P.hold > 0) P.hold -= dt; else { P.tR.x = 0; P.tR.z = -0.12; P.tL.x = 0; P.tL.z = 0.12; }
      P.armR.rotation.x = damp(P.armR.rotation.x, P.tR.x, 9, k); P.armR.rotation.z = damp(P.armR.rotation.z, P.tR.z, 9, k);
      P.armL.rotation.x = damp(P.armL.rotation.x, P.tL.x, 9, k); P.armL.rotation.z = damp(P.armL.rotation.z, P.tL.z, 9, k);
    }
    for (var j = 0; j < judges.length; j++) {
      var J = judges[j];
      if (J.hold > 0) J.hold -= dt; else { J.tR.x = 0; J.tR.z = -0.12; J.tL.x = 0; J.tL.z = 0.12; }
      var wave = J.waving > 0 ? Math.sin(ctx.time * 14) * 0.5 : 0; if (J.waving > 0) J.waving -= dt;
      J.armR.rotation.x = damp(J.armR.rotation.x, J.tR.x, 10, k); J.armR.rotation.z = damp(J.armR.rotation.z, J.tR.z + wave, 10, k);
      J.armL.rotation.x = damp(J.armL.rotation.x, J.tL.x, 10, k); J.armL.rotation.z = damp(J.armL.rotation.z, J.tL.z, 10, k);
      J.head.getWorldPosition(_v);
      var ddx = tb.x - _v.x, ddz = tb.z - _v.z;
      var jy = Math.max(-1.3, Math.min(1.3, angWrap(Math.atan2(ddx, ddz) - J.root.rotation.y)));
      J.head.rotation.y = damp(J.head.rotation.y, jy, 6, k);
    }
    // 2.º árbitro: se coloca hacia el lado del equipo receptor durante el saque
    if (R2 && g.mode === 'serve') {
      var recv = 1 - (g.serving === 1 ? 1 : 0), want = (recv === 0 ? 1 : -1) * 0.7;
      R2.sim.x = damp(R2.sim.x, want, 2, k); VB.toThree(R2.sim.x, R2.sim.y, R2.sim.z, R2.root.position);
    }
  }
  /** Señales oficiales: el 1.er árbitro extiende el brazo hacia el equipo que sacará. */
  function refSignal(e, g) {
    if (!R1) return;
    // R1 mira hacia +y: su mano derecha queda hacia +x (equipo 0)
    if (e.team === 0) { R1.tR.x = 0; R1.tR.z = -1.5; R1.tL.z = 0.12; } else { R1.tL.x = 0; R1.tL.z = 1.5; R1.tR.z = -0.12; }
    R1.hold = 1.6;
  }
  function judgeSignal(x, y, inside, antenna) {
    var best = null, bd = 1e9;
    for (var j = 0; j < judges.length; j++) { var J = judges[j], d = Math.hypot(J.sim.x - x, J.sim.y - y); if (d < bd) { bd = d; best = J; } }
    if (!best) return;
    if (antenna) { best.tR.x = 0; best.tR.z = -2.9; best.waving = 1.4; }
    else if (inside) { best.tR.x = -0.75; best.tR.z = -0.15; }   // bandera hacia el suelo: dentro
    else { best.tR.x = 0; best.tR.z = -3.0; }                    // bandera arriba: fuera
    best.hold = 1.7;
  }

  /* =====================================================================
   * GRADAS + PÚBLICO (InstancedMesh animado en el shader: cero CPU)
   * ===================================================================== */
  var crowdMeshes = [], crowdU = null, crowdHeads = [];
  var SHIRTS = {
    t0: ['#ff5b3a', '#ff7a3d', '#ff9a3d', '#e84a2c', '#ffb13d'],
    t1: ['#3f8cff', '#2c63d6', '#6fa8ff', '#1f4fb8'],
    n: ['#f2efe8', '#2b3442', '#1f2833', '#6b7d8f', '#c9c2b0', '#3a4f66', '#7ee0c3', '#ffd23f', '#8a4f7d', '#d9d4c8', '#44505e', '#a33a3a', '#2f6b55']
  };
  var SKINS = ['#f0c9a6', '#e6b48a', '#d29a6e', '#c68b5e', '#a8714a', '#8d5a3b', '#6b4329', '#f3d2b5'];
  function crowdGeometry() {
    // Figura sentada mirando a +Z local; base (cadera) en y = 0.
    // color.r = camiseta, color.g = piel, color.b = oscuro (pantalón/pelo). aArm = ±1 en brazos.
    var parts = [];
    function push(geo, x, y, z, part, arm, sx, sy, sz, rx) {
      _e.set(rx || 0, 0, 0); _q.setFromEuler(_e); _s.set(sx || 1, sy || 1, sz || 1); _p.set(x, y, z); _m.compose(_p, _q, _s);
      geo.applyMatrix4(_m); parts.push({ g: geo, part: part, arm: arm || 0 });
    }
    push(new THREE.BoxGeometry(0.38, 0.15, 0.44), 0, 0.06, 0.14, 2);                       // muslos
    push(new THREE.BoxGeometry(0.34, 0.42, 0.13), 0, -0.2, 0.34, 2);                      // piernas
    push(new THREE.CylinderGeometry(0.17, 0.2, 0.56, 7, 1, false), 0, 0.38, 0, 0, 0, 1, 1, 0.68); // torso
    var head = new THREE.SphereGeometry(0.118, 7, 5);
    push(head, 0, 0.8, 0.0, 1, 0, 1, 1.08, 1);
    push(new THREE.BoxGeometry(0.1, 0.5, 0.11), 0.235, 0.39, 0.03, 0, 1, 1, 1, 1, -0.25);   // brazos
    push(new THREE.BoxGeometry(0.1, 0.5, 0.11), -0.235, 0.39, 0.03, 0, -1, 1, 1, 1, -0.25);
    var pos = [], nor = [], colr = [], arm = [], idx = [], off = 0;
    for (var i = 0; i < parts.length; i++) {
      var gg = parts[i].g, p = gg.attributes.position, n = gg.attributes.normal;
      for (var k = 0; k < p.count; k++) {
        var x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        pos.push(x, y, z); nor.push(n.getX(k), n.getY(k), n.getZ(k));
        var pt = parts[i].part;
        if (pt === 1 && y > 0.83 && z < 0.07) pt = 2; // pelo en la parte alta/trasera de la cabeza
        if (parts[i].arm && y < 0.2) pt = 1;          // manos
        colr.push(pt === 0 ? 1 : 0, pt === 1 ? 1 : 0, pt === 2 ? 1 : 0);
        arm.push(parts[i].arm);
      }
      var ix = gg.index.array; for (var j = 0; j < ix.length; j++) idx.push(ix[j] + off);
      off += p.count;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.setAttribute('aArm', new THREE.Float32BufferAttribute(arm, 1));
    geo.setIndex(idx); return geo;
  }
  function crowdMaterial() {
    crowdU = { uTime: { value: 0 }, uCheer: { value: new THREE.Vector2() }, uWave: { value: new THREE.Vector2() }, uTension: { value: 0 } };
    var m = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xc4c4c4 }); // grada algo más oscura que la pista (look TV)
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = crowdU.uTime; sh.uniforms.uCheer = crowdU.uCheer; sh.uniforms.uWave = crowdU.uWave; sh.uniforms.uTension = crowdU.uTension;
      sh.vertexShader = [
        'attribute vec4 aAnim;', 'attribute vec3 aSkin;', 'attribute float aArm;',
        'uniform float uTime;', 'uniform vec2 uCheer;', 'uniform vec2 uWave;', 'uniform float uTension;', sh.vertexShader].join('\n')
        .replace('#include <beginnormal_vertex>', [
          'float cTeam = aAnim.z;',
          'float cheer = cTeam < 0.25 ? uCheer.x : (cTeam > 0.75 ? uCheer.y : max(uCheer.x, uCheer.y) * 0.55);',
          'cheer *= aAnim.y;',
          'float wd = abs(fract(aAnim.w - uWave.x + 0.5) - 0.5);',
          'float wave = uWave.y * smoothstep(0.045, 0.0, wd);',
          'float act = max(cheer, wave);',
          'float armUp = clamp(act * 1.4, 0.0, 1.0) * (0.82 + 0.18 * sin(uTime * 11.0 + aAnim.x * 3.0));',
          'float clap = uTension * (1.0 - act) * 0.35 * (0.5 + 0.5 * sin(uTime * 13.0 + aAnim.x * 7.0));',
          'float ang = aArm * (armUp * 2.75 + clap);',
          'float ca = cos(ang), sa = sin(ang);',
          'vec3 objectNormal = vec3( normal );',
          'if (aArm != 0.0) objectNormal.xy = vec2(objectNormal.x * ca - objectNormal.y * sa, objectNormal.x * sa + objectNormal.y * ca);'
        ].join('\n'))
        .replace('#include <begin_vertex>', [
          'vec3 transformed = vec3( position );',
          'if (aArm != 0.0) { vec2 pv = transformed.xy - vec2(aArm * 0.235, 0.62); transformed.xy = vec2(pv.x * ca - pv.y * sa, pv.x * sa + pv.y * ca) + vec2(aArm * 0.235, 0.62); }',
          'float bob = sin(uTime * (1.1 + aAnim.y * 0.7) + aAnim.x) * 0.014 + uTension * sin(uTime * 4.0 + aAnim.x) * 0.02;',
          'float hop = abs(sin(uTime * 8.0 + aAnim.x)) * 0.17 * cheer;',
          'float rise = smoothstep(0.05, 0.6, act) * 0.36;',
          'transformed.y += bob + hop + rise;'
        ].join('\n'))
        .replace('#include <color_vertex>', [
          '#ifdef USE_INSTANCING_COLOR',
          'vColor = color.r * instanceColor.xyz + color.g * aSkin + color.b * vec3(0.035, 0.038, 0.045);',
          '#else',
          'vColor = color;',
          '#endif'
        ].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'vb-crowd-1'; };
    return m;
  }
  function buildStands(S, E) {
    var stepA = col(PAL.step), stepT = col(PAL.stepTop), seatA = col(PAL.seatA), seatB = col(PAL.seatB), seatC = col(PAL.seatC);
    var barrier = col(PAL.barrier), cove = col('#ffcf9a'), aisle = col('#2a3546'), wall = col('#0f1620'), aisleLight = col('#7fc8ff');
    var seats = [[], [], [], []];
    var aislesL = [-21, -14, -7, 0, 7, 14, 21], aislesE = [-5.6, 0, 5.6];
    function inAisle(v, list) { for (var i = 0; i < list.length; i++) if (Math.abs(v - list[i]) < 0.55) return true; return false; }
    // ----- laterales (s = signo de y) -----
    for (var s = -1; s <= 1; s += 2) {
      var mi = s > 0 ? 0 : 1;
      for (var r = 0; r < ROWS_L; r++) {
        var y0 = SY0 + r * ROW_D, top = 0.5 + r * ROW_H, yc = y0 + ROW_D / 2;
        S.sbox(2 * LATX, ROW_D, top, 0, s * yc, top / 2, r % 2 ? stepA : stepT);
        // asientos por bloques entre pasillos
        var bx0 = -LATX + 0.3;
        for (var ai = 0; ai <= aislesL.length; ai++) {
          var bx1 = ai < aislesL.length ? aislesL[ai] - 0.55 : LATX - 0.3;
          var sc = (r === 4 || r === 5) ? seatC : (r > 9 ? seatB : seatA);
          if (bx1 - bx0 > 0.4) {
            S.sbox(bx1 - bx0, 0.42, 0.08, (bx0 + bx1) / 2, s * (y0 + 0.36), top + 0.42, sc);
            S.sbox(bx1 - bx0, 0.06, 0.42, (bx0 + bx1) / 2, s * (y0 + 0.62), top + 0.66, sc);
          }
          if (ai < aislesL.length) {
            S.sbox(1.0, ROW_D, 0.02, aislesL[ai], s * yc, top + 0.01, aisle);
            E.sbox(0.5, 0.02, 0.02, aislesL[ai], s * (y0 + 0.02), top + 0.03, aisleLight);
            bx0 = aislesL[ai] + 0.55;
          }
        }
        for (var x = -LATX + 0.3 + SEAT_W / 2; x < LATX - 0.3; x += SEAT_W) {
          if (inAisle(x, aislesL)) continue;
          seats[mi].push({ x: x + (rnd() - 0.5) * 0.06, y: s * (y0 + 0.42), z: top + 0.46, fx: 0, fy: -s });
        }
      }
      var yb = SY0 + ROWS_L * ROW_D, tb = 0.5 + ROWS_L * ROW_H;
      S.sbox(2 * LATX, 0.4, tb + 2.6, 0, s * (yb + 0.2), (tb + 2.6) / 2, wall);               // muro trasero
      S.sbox(2 * LATX + 1, 0.5, 1.15, 0, s * (SY0 - 0.3), 0.575, barrier);                    // antepecho
      E.sbox(2 * LATX + 1, 0.04, 0.035, 0, s * (SY0 - 0.56), 1.13, cove);                    // línea de luz
      // vomitorios (oscuros) en el antepecho
      for (var v = -1; v <= 1; v += 2) S.sbox(2.2, 0.06, 2.2, v * 10.5, s * (SY0 - 0.02), 1.1, col('#06090e'));
    }
    // ----- fondos (s = signo de x) -----
    for (var e = -1; e <= 1; e += 2) {
      var me = e > 0 ? 2 : 3;
      for (var r2 = 0; r2 < ROWS_E; r2++) {
        var x0 = SX0 + r2 * ROW_D, top2 = 0.5 + r2 * ROW_H, xc = x0 + ROW_D / 2;
        S.sbox(ROW_D, 2 * ENDY, top2, e * xc, 0, top2 / 2, r2 % 2 ? stepA : stepT);
        var by0 = -ENDY + 0.3;
        for (var aj = 0; aj <= aislesE.length; aj++) {
          var by1 = aj < aislesE.length ? aislesE[aj] - 0.55 : ENDY - 0.3;
          var sc2 = (r2 === 4 || r2 === 5) ? seatC : (r2 > 8 ? seatB : seatA);
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
          seats[me].push({ x: e * (x0 + 0.42), y: y + (rnd() - 0.5) * 0.06, z: top2 + 0.46, fx: -e, fy: 0 });
        }
      }
      var xb = SX0 + ROWS_E * ROW_D, tb2 = 0.5 + ROWS_E * ROW_H;
      S.sbox(0.4, 2 * ENDY + 0.8, tb2 + 2.2, e * (xb + 0.2), 0, (tb2 + 2.2) / 2, wall);
      S.sbox(0.5, 2 * ENDY + 0.8, 1.15, e * (SX0 - 0.3), 0, 0.575, barrier);
      E.sbox(0.035, 2 * ENDY + 0.8, 0.035, e * (SX0 - 0.56), 0, 1.13, cove);
      // paredes laterales de la grada de fondo
      for (var sw = -1; sw <= 1; sw += 2) S.sbox(xb - SX0 + 0.6, 0.3, tb2 + 0.4, e * (SX0 + (xb - SX0) / 2), sw * (ENDY + 0.2), (tb2 + 0.4) / 2, wall);
    }
    return seats;
  }
  function buildCrowd(seats) {
    var baseGeo = crowdGeometry(), mat = crowdMaterial();
    var c = new THREE.Color();
    crowdHeads.length = 0;
    for (var m = 0; m < 4; m++) {
      var list = seats[m];
      // mezcla aleatoria (para que `count` reducido quite gente repartida) y aforo ~88 %
      for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
      var n = Math.floor(list.length * 0.88);
      var geo = baseGeo.clone();
      var anim = new Float32Array(n * 4), skin = new Float32Array(n * 3);
      var mesh = new THREE.InstancedMesh(geo, mat, n);
      var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9;
      for (var k = 0; k < n; k++) {
        var st = list[k];
        // afición: el fondo +x y la mitad +x de las laterales animan al equipo 0 (local)
        var home = st.x > 2 ? 0.62 : st.x < -2 ? 0.2 : 0.4, away = st.x < -2 ? 0.5 : st.x > 2 ? 0.08 : 0.2;
        if (m === 2) { home = 0.75; away = 0.05; } if (m === 3) { home = 0.22; away = 0.55; }
        var rr = rnd(), team = rr < home ? 0 : rr < home + away ? 1 : 0.5;
        var shirt = team === 0 ? pick(SHIRTS.t0) : team === 1 ? pick(SHIRTS.t1) : pick(SHIRTS.n);
        c.set(shirt).multiplyScalar(0.7 + rnd() * 0.35); mesh.setColorAt(k, c);
        c.set(pick(SKINS)); skin[k * 3] = c.r; skin[k * 3 + 1] = c.g; skin[k * 3 + 2] = c.b;
        anim[k * 4] = rnd() * 6.283; anim[k * 4 + 1] = 0.55 + rnd() * 0.45; anim[k * 4 + 2] = team;
        anim[k * 4 + 3] = Math.atan2(st.y, st.x) / 6.2832 + 0.5;
        var yaw = Math.atan2(st.fx, -st.fy), sc = 0.92 + rnd() * 0.16;
        VB.toThree(st.x, st.y, st.z, _p); _e.set(0, yaw + (rnd() - 0.5) * 0.25, 0); _q.setFromEuler(_e); _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s); mesh.setMatrixAt(k, _m);
        if (_p.x < minx) minx = _p.x; if (_p.x > maxx) maxx = _p.x; if (_p.y < miny) miny = _p.y; if (_p.y > maxy) maxy = _p.y; if (_p.z < minz) minz = _p.z; if (_p.z > maxz) maxz = _p.z;
        if (k % 23 === 0) crowdHeads.push(_p.x, _p.y + 0.95, _p.z);
      }
      geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 4));
      geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2),
        Math.hypot(maxx - minx, maxy - miny, maxz - minz) / 2 + 1.5);
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.full = n; mesh.name = 'crowd' + m;
      root.add(mesh); crowdMeshes.push(mesh);
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
    { name: 'VOLEY 3D', fg: '#0e1118', bg: ['#ffd23f', '#ffb03d'], deco: 'ball' }
  ];
  var led = { cv: null, tex: [], mcv: null, mtex: [], mats: [], msgT: 0, scroll: 0, msgOn: false, refl: [] };
  function drawDeco(g, kind, x, y, h, color) {
    g.save(); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = h * 0.08;
    if (kind === 'flake') { for (var i = 0; i < 3; i++) { g.save(); g.translate(x, y); g.rotate(i * Math.PI / 3); g.beginPath(); g.moveTo(-h * 0.32, 0); g.lineTo(h * 0.32, 0); g.stroke(); g.restore(); } }
    else if (kind === 'bolt') { g.beginPath(); g.moveTo(x + h * 0.1, y - h * 0.38); g.lineTo(x - h * 0.16, y + h * 0.05); g.lineTo(x + h * 0.02, y + h * 0.05); g.lineTo(x - h * 0.1, y + h * 0.38); g.lineTo(x + h * 0.18, y - h * 0.06); g.lineTo(x, y - h * 0.06); g.closePath(); g.fill(); }
    else if (kind === 'sun') { g.beginPath(); g.arc(x, y + h * 0.15, h * 0.22, Math.PI, 0); g.fill(); for (var k = 0; k < 5; k++) { var a = Math.PI + (k + 0.5) * Math.PI / 5; g.beginPath(); g.moveTo(x + Math.cos(a) * h * 0.28, y + h * 0.15 + Math.sin(a) * h * 0.28); g.lineTo(x + Math.cos(a) * h * 0.4, y + h * 0.15 + Math.sin(a) * h * 0.4); g.stroke(); } }
    else if (kind === 'wave') { for (var w = 0; w < 2; w++) { g.beginPath(); for (var t = 0; t <= 20; t++) { var xx = x - h * 0.35 + t * h * 0.035, yy = y - h * 0.08 + w * h * 0.2 + Math.sin(t / 20 * Math.PI * 3) * h * 0.07; if (t) g.lineTo(xx, yy); else g.moveTo(xx, yy); } g.stroke(); } }
    else if (kind === 'leaf') { g.beginPath(); g.moveTo(x, y - h * 0.35); g.quadraticCurveTo(x + h * 0.3, y, x, y + h * 0.35); g.quadraticCurveTo(x - h * 0.3, y, x, y - h * 0.35); g.fill(); }
    else if (kind === 'dots') { for (var dx = 0; dx < 3; dx++) for (var dy = 0; dy < 3; dy++) { g.beginPath(); g.arc(x + (dx - 1) * h * 0.18, y + (dy - 1) * h * 0.18, h * 0.05, 0, 6.283); g.fill(); } }
    else if (kind === 'ball') { g.beginPath(); g.arc(x, y, h * 0.3, 0, 6.283); g.stroke(); g.beginPath(); g.arc(x - h * 0.3, y - h * 0.3, h * 0.42, 0.1, 1.45); g.stroke(); g.beginPath(); g.arc(x + h * 0.32, y + h * 0.05, h * 0.4, 2.2, 3.5); g.stroke(); }
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
    // rejilla de píxeles LED
    g.fillStyle = 'rgba(0,0,0,0.16)';
    var px = Math.max(2, Math.round(H / 26));
    for (var y = 0; y < H; y += px) g.fillRect(0, y, W, 1);
  }
  function drawMsg(cv, text, color) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height;
    var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, color); gr.addColorStop(1, '#0b0f18');
    g.fillStyle = '#0b0f18'; g.fillRect(0, 0, W, H);
    g.fillStyle = gr; g.globalAlpha = 0.85; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    g.font = 'italic 900 ' + Math.round(H * 0.66) + 'px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'left';
    var unit = g.measureText(text).width + H * 2.2, n = Math.ceil(W / unit);
    unit = W / n; // repetición exacta: la textura enlaza sin costura
    for (var i = 0; i < n; i++) {
      var x = i * unit;
      g.fillStyle = '#ffffff'; g.fillText(text, x + H * 0.6, H * 0.55);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (var c = 0; c < 3; c++) { var cx = x + unit - H * 1.35 + c * H * 0.32; g.beginPath(); g.moveTo(cx, H * 0.25); g.lineTo(cx + H * 0.18, H * 0.5); g.lineTo(cx, H * 0.75); g.lineTo(cx + H * 0.08, H * 0.5); g.closePath(); g.fill(); }
    }
    g.fillStyle = 'rgba(0,0,0,0.16)';
    var px = Math.max(2, Math.round(H / 26)); for (var y = 0; y < H; y += px) g.fillRect(0, y, W, 1);
  }
  function ledTex(cv, rep) { var t = texOf(cv); t.wrapS = THREE.RepeatWrapping; t.repeat.set(rep, 1); return t; }
  /** Valla LED en el suelo. (cx,cy) centro en sim, len a lo largo, normal hacia la pista (nx,ny). */
  function ledBoard(S, cx, cy, len, nx, ny, h, z0, speed, rows) {
    var meterPerSeg = h * (led.cv.width / BRANDS.length) / led.cv.height;
    var rep = len / (meterPerSeg * BRANDS.length);
    var t = ledTex(led.cv, rep), mt = ledTex(led.mcv, len / (h * led.mcv.width / led.mcv.height));
    var mat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, h), mat);
    VB.toThree(cx + nx * 0.07, cy + ny * 0.07, z0 + h / 2, mesh.position);
    mesh.rotation.order = 'YXZ'; mesh.rotation.y = Math.atan2(nx, -ny); mesh.rotation.x = rows ? 0 : -0.16;
    root.add(mesh);
    var along = Math.abs(nx) > 0.5;
    // carcasa
    if (!rows) S.sbox(along ? 0.3 : len + 0.1, along ? len + 0.1 : 0.3, h + 0.12, cx - nx * 0.06, cy - ny * 0.06, z0 + h / 2, col('#0a0d12'));
    var L = { mat: mat, t: t, mt: mt, speed: speed, refl: null };
    led.tex.push(t); led.mtex.push(mt); led.mats.push(L);
    t.offset.x = rnd();
    return L;
  }
  /** Reflejo falso de la valla en el suelo brillante (tira aditiva con degradado). */
  function ledReflection(cx, cy, len, nx, ny, L) {
    var t = L.t;
    var m = new THREE.ShaderMaterial({
      uniforms: { map: { value: t }, rep: { value: t.repeat.x }, off: { value: t.offset }, k: { value: 0.22 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float rep; uniform vec2 off; uniform float k; varying vec2 vUv;' +
        'void main(){ vec3 c = texture2D(map, vec2(vUv.x * rep + off.x, 1.0 - vUv.y * 0.9)).rgb; float f = pow(1.0 - vUv.y, 2.2);' +
        ' gl_FragColor = vec4(c * c * f * k, 1.0); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    var p = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.6), m);
    p.rotation.order = 'YXZ'; p.rotation.y = Math.atan2(nx, -ny); p.rotation.x = -Math.PI / 2;
    VB.toThree(cx + nx * 0.85, cy + ny * 0.85, 0.004, p.position);
    p.renderOrder = 1; root.add(p); led.refl.push(m); L.refl = m;
    return p;
  }
  function buildLED(S) {
    var hi = !ctx.isMobile;
    led.cv = canvas(hi ? 4096 : 2048, hi ? 128 : 64); drawBrands(led.cv);
    led.mcv = canvas(hi ? 2048 : 1024, hi ? 128 : 64); drawMsg(led.mcv, 'PALAU DEL MAR', '#146a86');
    var h = 0.86;
    ledReflection(0, BY, 2 * FZX, 0, -1, ledBoard(S, 0, BY, 2 * FZX, 0, -1, h, 0.04, 0.012));
    ledReflection(0, -BY, 2 * FZX, 0, 1, ledBoard(S, 0, -BY, 2 * FZX, 0, 1, h, 0.04, -0.012));
    ledReflection(BX, 0, 2 * FZY, -1, 0, ledBoard(S, BX, 0, 2 * FZY, -1, 0, h, 0.04, 0.016));
    ledReflection(-BX, 0, 2 * FZY, 1, 0, ledBoard(S, -BX, 0, 2 * FZY, 1, 0, h, 0.04, -0.016));
    // frontal de la mesa del anotador
    ledBoard(S, 0, C.HW + 3.6 - 0.36, 2.7, 0, -1, 0.62, 0.06, 0.02, true);
    // anillos LED en lo alto de las gradas (ribbon boards)
    var yb = SY0 + ROWS_L * ROW_D, tb = 0.5 + ROWS_L * ROW_H;
    ledBoard(S, 0, yb, 2 * LATX, 0, -1, 0.75, tb + 0.9, -0.006, true);
    ledBoard(S, 0, -yb, 2 * LATX, 0, 1, 0.75, tb + 0.9, 0.006, true);
    var xb = SX0 + ROWS_E * ROW_D, tb2 = 0.5 + ROWS_E * ROW_H;
    ledBoard(S, xb, 0, 2 * ENDY + 0.8, -1, 0, 0.7, tb2 + 0.8, 0.008, true);
    ledBoard(S, -xb, 0, 2 * ENDY + 0.8, 1, 0, 0.7, tb2 + 0.8, -0.008, true);
  }
  function ledMessage(text, color, dur) {
    drawMsg(led.mcv, text, color);
    for (var i = 0; i < led.mtex.length; i++) led.mtex[i].needsUpdate = true;
    led.msgT = dur; setLedMode(true);
  }
  function setLedMode(on) {
    if (led.msgOn === on) return; led.msgOn = on;
    for (var i = 0; i < led.mats.length; i++) {
      var L = led.mats[i], t = on ? L.mt : L.t; L.mat.map = t;
      if (L.refl) { L.refl.uniforms.map.value = t; L.refl.uniforms.rep.value = t.repeat.x; L.refl.uniforms.off.value = t.offset; }
    }
  }
  function updateLED(dt) {
    if (led.msgT > 0) { led.msgT -= dt; if (led.msgT <= 0) setLedMode(false); }
    var sp = led.msgOn ? 6 : 1;
    for (var i = 0; i < led.mats.length; i++) {
      var L = led.mats[i], t = led.msgOn ? L.mt : L.t;
      t.offset.x = (t.offset.x + L.speed * sp * dt) % 1;
    }
  }

  /* =====================================================================
   * VIDEOMARCADORES (fondos) y MARCADOR CENTRAL COLGADO
   * ===================================================================== */
  var SB = { names: ['TÚ', 'CPU'], score: [0, 0], sets: [0, 0], setNo: 1, serving: 0, msg: '', msgSub: '', msgCol: '#ff6b3d', msgT: 0, tag: '', dirty: true };
  var screens = { big: null, bigTex: null, hung: null, hungTex: null, mats: [], flash: 0 };
  function drawScore(cv, compact) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height;
    var bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d1626'); bg.addColorStop(1, '#070b13');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // franja superior
    var hb = H * 0.17;
    var gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#0b3a4f'); gr.addColorStop(0.5, '#146a86'); gr.addColorStop(1, '#0b3a4f');
    g.fillStyle = gr; g.fillRect(0, 0, W, hb);
    g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '800 ' + Math.round(hb * 0.62) + 'px ' + FONT; g.fillText('PALAU DEL MAR', H * 0.06, hb * 0.54);
    g.textAlign = 'right'; g.fillStyle = '#ffd23f'; g.fillText('SET ' + SB.setNo, W - H * 0.06, hb * 0.54);
    // equipos
    var mid = W / 2, y = hb + (H - hb) * 0.47;
    for (var t = 0; t < 2; t++) {
      var side = t === 0 ? -1 : 1, cx = mid + side * W * 0.25, colr = TEAMC[t];
      g.fillStyle = colr; g.fillRect(t === 0 ? 0 : W - W * 0.012, hb, W * 0.012, H - hb);
      g.textAlign = 'center'; g.fillStyle = '#ffffff';
      g.font = '800 ' + Math.round(H * 0.13) + 'px ' + FONT; g.fillText(SB.names[t], cx, hb + H * 0.11);
      g.font = '900 ' + Math.round(H * (compact ? 0.42 : 0.46)) + 'px ' + FONT; g.fillStyle = '#ffffff';
      g.fillText(String(SB.score[t]), cx, y + H * 0.04);
      // sets ganados (puntos)
      for (var k = 0; k < 2; k++) {
        g.beginPath(); g.arc(cx + (k - 0.5) * H * 0.09, H * 0.9, H * 0.028, 0, 6.283);
        g.fillStyle = k < SB.sets[t] ? colr : 'rgba(255,255,255,0.18)'; g.fill();
      }
      if (SB.serving === t) {
        g.font = '800 ' + Math.round(H * 0.13) + 'px ' + FONT;
        var nw = g.measureText(SB.names[t]).width;
        g.beginPath(); g.arc(cx - nw / 2 - H * 0.07, hb + H * 0.11, H * 0.03, 0, 6.283);
        g.fillStyle = '#ffd23f'; g.fill();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = '800 ' + Math.round(H * 0.2) + 'px ' + FONT; g.textAlign = 'center'; g.fillText('–', mid, y);
    if (SB.tag) {
      g.fillStyle = '#ffd23f'; g.font = '800 ' + Math.round(H * 0.08) + 'px ' + FONT; g.fillText(SB.tag, mid, H * 0.9);
    }
    // mensaje superpuesto
    if (SB.msgT > 0 && SB.msg) {
      var by = hb + (H - hb) * 0.2, bh = (H - hb) * 0.6;
      g.fillStyle = 'rgba(5,8,14,0.82)'; g.fillRect(0, by, W, bh);
      g.fillStyle = SB.msgCol; g.fillRect(0, by, W, H * 0.015); g.fillRect(0, by + bh - H * 0.015, W, H * 0.015);
      g.fillStyle = '#ffffff'; g.font = 'italic 900 ' + Math.round(bh * (SB.msgSub ? 0.5 : 0.62)) + 'px ' + FONT;
      g.fillText(SB.msg, mid, by + bh * (SB.msgSub ? 0.4 : 0.52));
      if (SB.msgSub) { g.fillStyle = SB.msgCol; g.font = '800 ' + Math.round(bh * 0.2) + 'px ' + FONT; g.fillText(SB.msgSub, mid, by + bh * 0.8); }
    }
    // retícula LED
    g.fillStyle = 'rgba(0,0,0,0.18)'; var px = Math.max(2, Math.round(H / 90)); for (var yy = 0; yy < H; yy += px) g.fillRect(0, yy, W, 1);
  }
  function buildScreens(S, E) {
    var hi = !ctx.isMobile;
    screens.big = canvas(hi ? 1024 : 768, hi ? 384 : 288); screens.bigTex = texOf(screens.big);
    screens.hung = canvas(hi ? 512 : 384, hi ? 288 : 216); screens.hungTex = texOf(screens.hung);
    var frame = col('#0b0e14');
    // videomarcadores en las paredes de los fondos
    for (var e = -1; e <= 1; e += 2) {
      var m = new THREE.MeshBasicMaterial({ map: screens.bigTex, toneMapped: false });
      var p = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.25), m);
      VB.toThree(e * (HALL_X - 0.6), 0, SCR_Z, p.position); p.rotation.y = e > 0 ? -Math.PI / 2 : Math.PI / 2; root.add(p);
      screens.mats.push(m);
      S.sbox(0.5, 14.6, 5.85, e * (HALL_X - 0.35), 0, SCR_Z, frame);
      E.sbox(0.05, 14.6, 0.06, e * (HALL_X - 0.62), 0, SCR_Z - 2.95, col('#ff7a45'));
      E.sbox(0.05, 14.6, 0.06, e * (HALL_X - 0.62), 0, SCR_Z + 2.95, col('#7fc8ff'));
    }
    // marcador central colgado (4 caras)
    var hz = 11.4, hw = 4.2, hh = 2.36, hd = 2.8;
    var hm = new THREE.MeshBasicMaterial({ map: screens.hungTex, toneMapped: false }); screens.mats.push(hm);
    for (var f = 0; f < 4; f++) {
      // caras: +x / -x (miran a los fondos, ancho = hd) y +y / -y (miran a las laterales, ancho = hw)
      var nx = [1, -1, 0, 0][f], ny = [0, 0, 1, -1][f];
      var pl = new THREE.Mesh(new THREE.PlaneGeometry(f < 2 ? hd : hw, hh), hm), dist = f < 2 ? hw / 2 : hd / 2;
      VB.toThree(nx * (dist + 0.01), ny * (dist + 0.01), hz, pl.position);
      pl.rotation.y = Math.atan2(nx, -ny); root.add(pl);
    }
    S.sbox(hw + 0.2, hd + 0.2, hh + 0.2, 0, 0, hz, frame);
    S.sbox(hw - 0.4, hd - 0.4, 0.6, 0, 0, hz - hh / 2 - 0.3, frame);
    E.sbox(hw + 0.22, hd + 0.22, 0.05, 0, 0, hz + hh / 2 + 0.1, col('#7fc8ff'));
    for (var c = -1; c <= 1; c += 2) for (var d = -1; d <= 1; d += 2) S.sbox(0.03, 0.03, HALL_H - hz - hh / 2, c * 1.5, d * 1.0, (HALL_H + hz + hh / 2) / 2, col('#2a2f38'));
  }
  function redrawScreens() {
    drawScore(screens.big, false); screens.bigTex.needsUpdate = true;
    drawScore(screens.hung, true); screens.hungTex.needsUpdate = true;
    SB.dirty = false;
  }
  function scoreFromGame(g) {
    if (!g) return;
    SB.names = g.demo ? ['LOCAL', 'VISITA'] : ['TÚ', 'CPU'];
    SB.score[0] = g.score[0]; SB.score[1] = g.score[1]; SB.sets[0] = g.sets[0]; SB.sets[1] = g.sets[1];
    SB.setNo = g.setNo || 1; SB.serving = g.serving === 1 ? 1 : 0;
    SB.tag = g.matchPoint >= 0 && g.mode !== 'over' ? 'PUNTO DE PARTIDO' : g.setPoint >= 0 && g.mode !== 'over' ? 'PUNTO DE SET' : '';
    SB.dirty = true;
  }
  function screenMsg(text, sub, color, dur) { SB.msg = text; SB.msgSub = sub || ''; SB.msgCol = color; SB.msgT = dur; SB.dirty = true; screens.flash = 1; }

  /* =====================================================================
   * TECHO, PAREDES, CERCHAS, FOCOS, HACES DE LUZ, BANDEROLAS
   * ===================================================================== */
  var halos = null, cones = [], coneMat = null;
  function bannerTex(title, sub, c1, c2) {
    var cv = canvas(256, 512), g = cv.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(16, 16, 224, 4); g.fillRect(16, 492, 224, 4);
    g.fillStyle = '#ffd23f'; g.beginPath(); for (var i = 0; i < 5; i++) { var a = -Math.PI / 2 + i * 4 * Math.PI / 5, r = 34; g.lineTo(128 + Math.cos(a) * r, 120 + Math.sin(a) * r); } g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 64px ' + FONT; g.fillText(title, 128, 260);
    g.font = '700 30px ' + FONT; g.fillText(sub, 128, 330);
    return texOf(cv);
  }
  function buildHall(S, E) {
    var wallMat = new THREE.MeshStandardMaterial({ color: '#0c111a', roughness: 0.95, side: THREE.BackSide, envMapIntensity: 0.2 });
    var shell = new THREE.Mesh(new THREE.BoxGeometry(2 * HALL_X, HALL_H, 2 * HALL_Y), wallMat); shell.position.y = HALL_H / 2 - 0.01; root.add(shell);
    var pil = col('#141b26'), strip = col('#3d6f9a'), warm = col('#ffb878');
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
    halos = new THREE.Points(hg, new THREE.PointsMaterial({ size: 3.4, map: radialTex([[0, 'rgba(255,240,215,0.85)'], [0.2, 'rgba(255,225,180,0.28)'], [1, 'rgba(255,220,170,0)']]),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true }));
    halos.frustumCulled = false; root.add(halos);
    // haces de luz volumétricos (conos aditivos muy sutiles)
    coneMat = new THREE.ShaderMaterial({
      uniforms: { k: { value: 0.05 } },
      vertexShader: 'varying float vH; varying vec3 vN; varying vec3 vV; varying float vD;' +
        'void main(){ vH = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float k; varying float vH; varying vec3 vN; varying vec3 vV; varying float vD;' +
        'void main(){ float e = pow(abs(dot(vN, vV)), 1.6); float f = smoothstep(0.0, 0.85, vH) * (1.0 - smoothstep(0.92, 1.0, vH));' +
        ' float near = smoothstep(9.0, 22.0, vD);' +
        ' gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * e * f * near * k, 1.0); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    var cg = new THREE.CylinderGeometry(0.35, 2.2, lz - 0.3, 20, 1, true); cg.translate(0, -(lz - 0.3) / 2, 0);
    var conePos = [[-9, 7.2], [-3, 7.2], [3, 7.2], [9, 7.2], [-9, -7.2], [-3, -7.2], [3, -7.2], [9, -7.2]];
    for (var c = 0; c < conePos.length; c++) {
      var cm = new THREE.Mesh(cg, coneMat); VB.toThree(conePos[c][0], conePos[c][1], lz - 0.1, cm.position);
      cm.rotation.order = 'YXZ'; cm.rotation.x = conePos[c][1] > 0 ? -0.16 : 0.16; // inclinados hacia la pista
      cm.renderOrder = 5; root.add(cm); cones.push(cm);
    }
    // banderolas de títulos (ficticios) colgadas en las paredes laterales
    var BAN = [['LIGA', '2019', '#146a86', '#0b3a4f'], ['COPA', '2021', '#c4532f', '#6b2412'], ['LIGA', '2023', '#146a86', '#0b3a4f'], ['SUPERCOPA', '2024', '#2a55c9', '#13265e'], ['COPA', '2025', '#c4532f', '#6b2412']];
    for (var b = 0; b < BAN.length; b++) {
      var bm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4), new THREE.MeshStandardMaterial({ map: bannerTex(BAN[b][0], BAN[b][1], BAN[b][2], BAN[b][3]), roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.3 }));
      VB.toThree(-12 + b * 6, HALL_Y - 0.9, 14.2, bm.position); root.add(bm);
    }
    // nombre del pabellón en la pared lateral opuesta (letras retroiluminadas)
    var nc = canvas(2048, 256), ng = nc.getContext('2d');
    ng.font = '900 200px ' + FONT; ng.textAlign = 'center'; ng.textBaseline = 'middle';
    ng.shadowColor = 'rgba(255,170,110,0.9)'; ng.shadowBlur = 30; ng.fillStyle = '#ffe7cf'; ng.fillText('PALAU  DEL  MAR', 1024, 135);
    var nm = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.75), new THREE.MeshBasicMaterial({ map: texOf(nc), transparent: true, toneMapped: false, depthWrite: false }));
    VB.toThree(0, -(HALL_Y - 0.7), 13.5, nm.position); nm.rotation.y = Math.PI; root.add(nm);
  }

  /* =====================================================================
   * LUCES Y MAPA DE ENTORNO
   * ===================================================================== */
  function buildLights(q) {
    hemi = new THREE.HemisphereLight(0xfff1e0, 0x1a2230, 0.32); root.add(hemi);
    keyLight = new THREE.DirectionalLight(0xfff0dc, 1.55);
    VB.toThree(7, -9, 26, keyLight.position); keyLight.target.position.set(0, 0, 0);
    keyLight.castShadow = !!q.shadows;
    var sc = keyLight.shadow.camera; sc.left = -18; sc.right = 18; sc.top = 13; sc.bottom = -13; sc.near = 8; sc.far = 55;
    keyLight.shadow.mapSize.set(q.shadowSize, q.shadowSize); keyLight.shadow.bias = -0.0005; keyLight.shadow.normalBias = 0.025;
    root.add(keyLight); root.add(keyLight.target);
    fillLight = new THREE.DirectionalLight(0xb9d2ff, 0.38); VB.toThree(-10, 12, 14, fillLight.position); root.add(fillLight);
    // contraluz cálido desde el fondo rival: perfila a los jugadores vistos de espaldas
    rimLight = new THREE.DirectionalLight(0xffd2a0, 0.65); VB.toThree(-22, 3, 9, rimLight.position); root.add(rimLight);
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
    flashes.frustumCulled = false; root.add(flashes);
  }
  function updateFlashes(rdt) {
    if (!flashes || !flashes.visible) return;
    var colr = flashes.geometry.attributes.color.array, any = false;
    flRate = Math.max(0, flRate - rdt * 6);
    var p = (0.35 + flRate) * rdt;
    for (var i = 0; i < FL_N; i++) {
      if (flLife[i] <= 0 && Math.random() < p / FL_N * 6) flLife[i] = 0.09;
      var v = 0;
      if (flLife[i] > 0) { flLife[i] -= rdt; v = Math.max(0, flLife[i] / 0.09); any = true; }
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
    var pp = ctx.params || {}, msaa = pp.msaa != null ? (+pp.msaa | 0) : 4, u8 = THREE.UnsignedByteType;
    P.rt = new THREE.WebGLRenderTarget(4, 4, { type: u8, samples: msaa, encoding: THREE.sRGBEncoding });
    P.rt.texture.encoding = THREE.sRGBEncoding;
    P.a1 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.b1 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.a2 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.b2 = new THREE.WebGLRenderTarget(4, 4, { type: u8, depthBuffer: false });
    P.scene = new THREE.Scene(); P.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    P.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); P.quad.frustumCulled = false; P.scene.add(P.quad);
    P.bright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.8 } },
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
      uniforms: { tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, exposure: { value: 1.0 }, bloom: { value: 0.9 },
        vig: { value: 0.32 }, aspect: { value: 1.7 }, time: { value: 0 } },
      vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
      fragmentShader: [
        'uniform sampler2D tScene; uniform sampler2D tB1; uniform sampler2D tB2; uniform float exposure; uniform float bloom; uniform float vig; uniform float aspect; uniform float time; varying vec2 vUv;',
        'vec3 toSRGB(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }',
        'void main(){',
        ' vec3 c = texture2D(tScene, vUv).rgb;',
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
    for (var i = 0; i < led.mats.length; i++) led.mats[i].mat.color.setScalar(boost * 0.95);
    for (var j = 0; j < screens.mats.length; j++) screens.mats[j].color.setScalar(boost);
    if (emissiveMesh) emissiveMesh.material.color.setScalar(active ? 2.2 : 1.0);
    if (halos) halos.material.opacity = active ? 0.55 : 1.0;
  }

  // ---------- Estado runtime ----------
  var emissiveMesh = null;
  var RT = { cheerT: [0, 0], cheerMax: [1, 1], waveAmp: 0, waveX: 0, waveT: 0, menuWave: 18, tension: 0 };
  function teamName(t, g) { return g && g.demo ? (t === 0 ? 'LOCAL' : 'VISITA') : (t === 0 ? 'TÚ' : 'CPU'); }
  var REASON = { 'in': 'DENTRO', out: 'FUERA', antenna: 'ANTENA', 'double': 'DOBLES', four: '4 TOQUES', net: 'RED' };

  function onEvents(g, events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.type) {
        case 'newMatch': case 'newSet': scoreFromGame(g); break;
        case 'serveReady':
          scoreFromGame(g); SB.serving = e.team;
          if (e.matchPoint >= 0) ledMessage('PUNTO DE PARTIDO', TEAMC[e.matchPoint], 3.2);
          else if (e.setPoint >= 0) ledMessage('PUNTO DE SET', TEAMC[e.setPoint], 3.2);
          break;
        case 'point':
          if (e.score) { SB.score[0] = e.score[0]; SB.score[1] = e.score[1]; } else scoreFromGame(g);
          SB.serving = e.team; SB.dirty = true;
          var w = e.team, mul = e.matchWon ? 3.5 : e.setWon ? 2 : 1;
          RT.cheerT[w] = 2.4 * mul; RT.cheerMax[w] = 1;
          RT.cheerT[1 - w] = Math.min(RT.cheerT[1 - w], 0.0);
          flRate = Math.max(flRate, e.matchWon ? 30 : 12);
          if (!e.setWon && !e.matchWon) {
            ledMessage('PUNTO · ' + teamName(w, g), TEAMC[w], 2.6);
            screenMsg('PUNTO ' + teamName(w, g), REASON[e.reason] || '', TEAMC[w], 2.4);
          }
          refSignal(e, g);
          if (e.reason === 'antenna') judgeSignal(0, g.ball.y, false, true);
          break;
        case 'land': judgeSignal(e.x, e.y, e.inside, false); break;
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
          RT.waveAmp = 1; RT.waveT = 10; flRate = 40;
          break;
        case 'block':
          RT.cheerT[e.team] = Math.max(RT.cheerT[e.team], 0.9);
          if (!led.msgOn) ledMessage('¡BLOQUEO!', TEAMC[e.team], 1.4);
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

  // ---------- Interfaz del módulo ----------
  VB.Arena = {
    init: function (c) {
      ctx = c; THREE = c.THREE; C = VB.C;
      _m = new THREE.Matrix4(); _m3 = new THREE.Matrix3(); _q = new THREE.Quaternion(); _e = new THREE.Euler(); _v = new THREE.Vector3();
      _v2 = new THREE.Vector3(); _s = new THREE.Vector3(); _p = new THREE.Vector3(); _sz = new THREE.Vector2(); UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
      root = new THREE.Group(); root.name = 'arena'; ctx.scene.add(root);
      var fogc = new THREE.Color(0x0a0f18);
      ctx.scene.fog = new THREE.Fog(fogc, 34, 95);
      ctx.scene.background = fogc;
      var S = new Builder(), E = new Builder(), SC = new Builder();
      buildFloor();
      root.add(buildNet(SC));
      buildOfficials(SC);
      buildLED(S);
      var seats = buildStands(S, E);
      buildCrowd(seats);
      buildScreens(S, E);
      buildHall(S, E);
      buildLights(c.quality || { shadows: true, shadowSize: 2048 });
      buildFlashes();
      // fusión estática: 1 malla iluminada + 1 emisiva
      var sm = new THREE.Mesh(S.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, envMapIntensity: 0.45 }));
      sm.receiveShadow = true; sm.castShadow = false; sm.name = 'static'; root.add(sm);
      // utillaje junto a la pista (cinta, postes, silla, mesa): sí proyecta sombra
      var scm = new THREE.Mesh(SC.build(), sm.material); scm.castShadow = true; scm.receiveShadow = true; scm.name = 'props'; root.add(scm);
      emissiveMesh = new THREE.Mesh(E.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }));
      emissiveMesh.name = 'emissive'; root.add(emissiveMesh);
      buildEnvironment();
      redrawScreens();
      // la fuente de la UI puede llegar tarde: repintar textos
      try {
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
          try { drawBrands(led.cv); for (var i = 0; i < led.tex.length; i++) led.tex[i].needsUpdate = true; SB.dirty = true;
            drawFloor(floorCanvas, floorPpm); floorTex.needsUpdate = true; } catch (e) { }
        });
      } catch (e) { }
      this.setQuality(c.quality);
    },
    onGameStart: function (g) {
      RT.cheerT[0] = RT.cheerT[1] = 0; RT.waveAmp = 0; RT.waveT = 0; netRip.t = 9; led.msgT = 0; setLedMode(false);
      SB.msgT = 0; SB.msg = ''; scoreFromGame(g);
    },
    onState: function (s) { if (s === 'menu') RT.menuWave = 6; },
    setQuality: function (q) {
      if (!q || !keyLight) return;
      keyLight.castShadow = !!q.shadows;
      if (keyLight.shadow.mapSize.x !== q.shadowSize) {
        keyLight.shadow.mapSize.set(q.shadowSize, q.shadowSize);
        if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
      }
      var dens = q.crowdDensity == null ? 1 : q.crowdDensity;
      for (var i = 0; i < crowdMeshes.length; i++) crowdMeshes[i].count = Math.max(1, Math.floor(crowdMeshes[i].userData.full * dens));
      for (var c = 0; c < cones.length; c++) cones[c].visible = q.rank >= 1;
      if (coneMat) coneMat.uniforms.k.value = q.rank >= 2 ? 0.04 : 0.032;
      if (flashes) flashes.visible = q.rank >= 1;
      for (var r = 0; r < led.refl.length; r++) led.refl[r].uniforms.k.value = q.rank >= 1 ? 0.22 : 0.15;
      setPost(wantPost(q));
    },
    resize: function () { postResize(); },
    /** Por frame. dt = tiempo de JUEGO (0 en pausa); la animación ambiental usa tiempo real. */
    update: function (g, dt, events) {
      if (!g) return;
      if (events && events.length) onEvents(g, events);
      var rdt = ctx.realDt || 0;
      // público: alegría por equipo, ola, tensión en punto de set/partido
      for (var t = 0; t < 2; t++) { if (RT.cheerT[t] > 0) RT.cheerT[t] = Math.max(0, RT.cheerT[t] - rdt); }
      crowdU.uTime.value = ctx.time;
      crowdU.uCheer.value.set(Math.min(1, RT.cheerT[0] / 0.8), Math.min(1, RT.cheerT[1] / 0.8));
      if (ctx.state === 'menu' || g.demo) { RT.menuWave -= rdt; if (RT.menuWave <= 0) { RT.menuWave = 45; RT.waveT = 9; } }
      if (RT.waveT > 0) { RT.waveT -= rdt; RT.waveX = (RT.waveX + rdt * 0.11) % 1; }
      var wa = RT.waveT > 0 ? Math.min(1, RT.waveT / 1.5) : 0;
      crowdU.uWave.value.set(RT.waveX, wa);
      var tens = (g.matchPoint >= 0 || g.setPoint >= 0) && g.mode !== 'over' ? 1 : 0;
      RT.tension += (tens - RT.tension) * Math.min(1, rdt * 2); crowdU.uTension.value = RT.tension;
      updateLED(rdt);
      if (SB.msgT > 0) { SB.msgT -= rdt; if (SB.msgT <= 0) SB.dirty = true; }
      if (SB.dirty) redrawScreens();
      if (screens.flash > 0) {
        screens.flash = Math.max(0, screens.flash - rdt * 1.5);
        var fb = (post ? 1.55 : 1) * (1 + screens.flash * 0.6);
        for (var j = 0; j < screens.mats.length; j++) screens.mats[j].color.setScalar(fb);
      }
      updateNet(dt > 0 ? dt : 0, g);
      updateOfficials(g, dt, rdt);
      updateFlashes(rdt);
    },
    // ---- añadidos opcionales (ver notes/arena.md) ----
    /** Límites útiles para la cámara (coordenadas de sim). */
    bounds: { freeX: FZX, freeY: FZY, boardsX: BX, boardsY: BY, standsX: SX0, standsY: SY0, hallX: HALL_X, hallY: HALL_Y, hallH: HALL_H },
    /** Fuerza un mensaje en las vallas LED. */
    message: function (text, team, dur) { if (led.mcv) ledMessage(String(text), TEAMC[team === 1 ? 1 : 0], dur || 2.5); },
    /** Hace saltar al público de un equipo (0/1) durante `sec` segundos. */
    cheer: function (team, sec) { RT.cheerT[team === 1 ? 1 : 0] = sec || 2; },
    /** Lanza la ola en la grada. */
    wave: function (sec) { RT.waveT = sec || 8; },
    /** ¿Post-proceso activo? */
    postActive: function () { return !!post && ctx.renderFn === renderPost; }
  };
})();
