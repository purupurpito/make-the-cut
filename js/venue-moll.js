/* VOLEY 3D — js/venue-moll.js (owner: arena)
 * Sede de playa «Moll de la Sorra» (12-nov-2026): torneo urbano de vóley playa sobre una ISLA DE ARENA traída al muelle de
 * un puerto inventado. Sede intermedia de la Carrera de playa. De día (o de tarde, con el sol bajo entre las grúas).
 *
 * Es una PIEL del constructor de playa de arena.js (registerMap con P sobre los parámetros de Platja Llarga) + sus piezas
 * propias en build(G, K, B), todas en la estática de la playa (0 dibujos nuevos). Lo que se distingue de Platja:
 * - Suelo de HORMIGÓN del muelle (pintor propio del mosaico, `tile`: losas con juntas, manchas y grietas) y, encima, la
 *   isla de arena (pintada debajo de las cintas en la capa de la pista, `courtBase`: 0 dibujos) con su bordillo de tablones.
 * - Al fondo no hay playa abierta: el canto del muelle (cantil, norays y defensas de neumático) y el agua de la dársena,
 *   más baja que el muelle y sin ola que rompa (uSurf 0; la orilla de la malla del mar queda debajo del hormigón).
 * - Dos grúas pórtico inventadas: la teal en nuestro muelle (con un contenedor colgado del carro sobre el agua) y la coral
 *   en el muelle de enfrente, con la pluma hacia nosotros; pilas de contenedores, tinglados, un ferri blanco atracado,
 *   un remolcador rojo y dos veleros amarrados.
 * - Telón propio: la ciudad (bloques de pisos, torre moderna, campanario, antenas), la zona portuaria con silos y grúas
 *   lejanas, y la escollera con los faros de la bocana. De tarde se repinta con las ventanas encendidas (`relight`).
 * - Gradas: las de aluminio de siempre + una fila de contenedores apilados (2 de alto) detrás, con terraza y público
 *   encima y escalera metálica. Food trucks, bancos de palés, jardineras con olivos, farolas de puerto, banderines y la
 *   cabina de comentaristas sobre un contenedor en la esquina.
 * - Cinta azul intenso, lonas y red en teal y coral, sin barcas animadas (las del puerto están amarradas, en la estática).
 * Dibujos (baja): cielo, nubes, telón, agua, suelo, pista, lona, estática, público, red y marcador (gaviotas en media/alta
 * como en Platja). Sin llaüts animados: 1 menos que Platja.
 */
(function () {
  'use strict';
  var VB = window.VB; if (!VB || !VB.Arena || !VB.Arena.registerMap) return;
  var PI = Math.PI;

  var QX = -29;               // canto del muelle (sim): el hormigón llega hasta aquí; el agua, 1,1 m más abajo
  var WATER_Z = -1.1;
  var IX = 16.3, IY = 10.05;  // isla de arena (media longitud / anchura): dentro de la capa de la pista (16,6 × 10,6)
  var SAND_C = '#efd29c';

  var LOOKS = {
    dia: {
      sky: { zen: '#8fc6ee', hor: '#d6ecf7', fog: '#d6e4ec', sun: '#fff3c4' }, sun: [-0.74, 0.42, 0.52],
      hemi: 0xd6ecf7, ground: 0xd8cdb8, key: 0xfff1d8, fill: 0xcfe4ff, rim: 0xd6ecf7, keyK: 1, hemiK: 1, floorK: 0.9,
      near: 60, far: 210, deep: '#2f7f86', shal: '#4fa7a0', foam: '#e8f4f2', tint: '#ffffff',
      glint: '#ffffff', glintK: 0.35, sand: [0.9, 0.83, 0.68]
    },
    tarde: {
      // sol bajo detrás de la grúa teal (a la izquierda del mar desde la cámara de juego), rielada naranja hacia él
      sky: { zen: '#3b4fa0', hor: '#ff9a5c', fog: '#f2b98e', sun: '#ffe2a8' }, sun: [-0.86, -0.46, 0.15], glintDir: [-0.88, -0.46, 0.09],
      hemi: 0xffd9bc, ground: 0xd9a77e, key: 0xffbf7a, fill: 0xb9c6ff, rim: 0xffb070, keyK: 1.08, hemiK: 0.82, floorK: 0.92,
      near: 55, far: 200, deep: '#2a4f7e', shal: '#4f8f98', foam: '#fff1dc', tint: '#ffcfb0',
      glint: '#e88a4f', glintK: 0.9, sand: [0.92, 0.8, 0.64]
    }
  };
  var CONT = ['#e0a33a', '#b5532e', '#24406e', '#3f9e5a', '#19a39a', '#ff6f4f', '#e8e2d6', '#24406e', '#e0a33a'];

  /* ---------- telón: ciudad, zona portuaria y escollera con la bocana ---------- */
  function backdrop(g, W, H, k, h) {
    var phi = h.phi, rnd = h.rnd, pick = h.pick, TAU = h.TAU, eve = h.mode === 'tarde';
    function A(px) { return Math.abs(phi(px)); }
    function at(target) { var bx = 0, bd = 9; for (var s = 0; s < W; s += 2) { var d = Math.abs(phi(s) - target); if (d < bd) { bd = d; bx = s; } } return bx; }
    // sierra lejana (más baja hacia el mar; la bocana, abierta)
    function sier(px) {
      var a = A(px), n = 0.5 + 0.3 * h.wav(px, 5, 0) + 0.2 * h.wav(px, 13, 1);
      if (a < 2.0) return 96 + 80 * n;
      if (a < 2.95) { var u = (a - 2.0) / 0.95; return (96 + 80 * n) * (1 - u) + (26 + 22 * n) * u; }
      return Math.max(0, (26 + 22 * n) * (1 - (a - 2.95) / 0.12));
    }
    function fillF(color, f, sc, dy) {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, H);
      for (var x = 0; x <= W; x += 6) g.lineTo(x, H - (f(x) * sc + dy) * k);
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    fillF('#bccfe4', sier, 1, 0);
    fillF('#aec6cc', function (x) { var a = A(x); return a < 2.2 ? (60 + 30 * (0.5 + 0.5 * h.wav(x, 11, 2))) * (a < 1.9 ? 1 : 1 - (a - 1.9) / 0.3) : 0; }, 1, 0);
    var WIN_D = 'rgba(110,125,150,0.38)';
    function windows(x0, y0, w, hh) {
      if (!h.hi && !eve) return;
      for (var wy = y0 + 3 * k; wy < y0 + hh - 3 * k; wy += 5.5 * k) for (var wx = x0 + 2 * k; wx < x0 + w - 2 * k; wx += 4.5 * k) {
        if (eve) { var r = rnd(); g.fillStyle = r < 0.34 ? '#ffd68a' : r < 0.42 ? '#ffe9b8' : 'rgba(70,72,110,0.45)'; }
        else g.fillStyle = WIN_D;
        g.fillRect(wx, wy, 1.8 * k, 2.4 * k);
      }
    }
    // ciudad tierra adentro: bloques de pisos velados, con depósitos y antenas en los terrados
    var BLK = ['#b9c1cd', '#97a4b8', '#c9d0da', '#a8b3c3', '#d6d0c4', '#bcc5d0'], x0 = 0, base = H - 8 * k;
    while (x0 < W) {
      var w = (12 + rnd() * 26) * k, a = A(x0);
      if (a < 1.85) {
        var hh = (40 + rnd() * 62 + (rnd() < 0.1 ? 46 : 0)) * k * (a > 1.5 ? 0.55 : 1);
        g.fillStyle = pick(BLK); g.fillRect(x0, base - hh, w, hh + 8 * k);
        g.fillStyle = 'rgba(90,100,125,0.18)'; g.fillRect(x0 + w - 2 * k, base - hh, 2 * k, hh); // arista en sombra
        windows(x0, base - hh, w, hh);
        if (rnd() < 0.3) { g.fillStyle = '#9aa6b6'; g.fillRect(x0 + w * 0.3, base - hh - 3 * k, 4 * k, 3 * k); }
        if (rnd() < 0.18) { g.strokeStyle = '#8a96a8'; g.lineWidth = 1 * k; g.beginPath(); g.moveTo(x0 + w * 0.7, base - hh); g.lineTo(x0 + w * 0.7, base - hh - 12 * k); g.stroke(); g.fillStyle = '#e8504a'; g.fillRect(x0 + w * 0.7 - 1 * k, base - hh - 13 * k, 2 * k, 2 * k); }
      }
      x0 += w + (rnd() < 0.12 ? rnd() * 14 * k : 0);
    }
    // torre moderna de cristal y campanario (dos referencias que se reconocen de lejos)
    var tx = at(0.35), th = 200 * k;
    g.fillStyle = '#8fa6c2'; g.fillRect(tx - 12 * k, base - th, 24 * k, th);
    g.fillStyle = 'rgba(255,255,255,0.35)'; for (var ty = base - th + 4 * k; ty < base; ty += 7 * k) g.fillRect(tx - 12 * k, ty, 24 * k, 1.4 * k);
    g.fillStyle = '#7389a6'; g.fillRect(tx + 6 * k, base - th, 6 * k, th);
    g.fillStyle = '#8a96a8'; g.fillRect(tx - 1 * k, base - th - 26 * k, 2 * k, 26 * k);
    if (eve) { for (var ey = base - th + 6 * k; ey < base; ey += 7 * k) for (var ex = -10; ex < 6; ex += 4) if (rnd() < 0.45) { g.fillStyle = '#ffd68a'; g.fillRect(tx + ex * k, ey, 2.6 * k, 2.2 * k); } }
    var cx = at(-0.75), cb = base - 50 * k;
    g.fillStyle = '#e6dac4'; g.fillRect(cx - 8 * k, cb - 80 * k, 16 * k, 82 * k);
    g.fillStyle = '#d4977c'; g.beginPath(); g.moveTo(cx - 9 * k, cb - 80 * k); g.lineTo(cx, cb - 108 * k); g.lineTo(cx + 9 * k, cb - 80 * k); g.fill();
    g.fillStyle = 'rgba(90,90,110,0.5)'; g.fillRect(cx - 3 * k, cb - 70 * k, 6 * k, 10 * k);
    // zona portuaria a los lados: tinglados, silos y grúas lejanas en silueta
    for (var q = 0; q < (h.hi ? 46 : 26); q++) {
      var qx = rnd() * W, qa = A(qx); if (qa < 1.9 || qa > 2.75) continue;
      var qw = (14 + rnd() * 26) * k, qh = (8 + rnd() * 8) * k;
      g.fillStyle = rnd() < 0.5 ? '#b5bfca' : '#c3ccd5'; g.fillRect(qx, base - qh, qw, qh + 8 * k);
      g.fillStyle = 'rgba(80,92,110,0.25)'; g.fillRect(qx, base - qh, qw, 2 * k);
    }
    [[2.2, 1], [-2.25, -1]].forEach(function (s) {
      var sx = at(s[0]);
      for (var i = 0; i < 4; i++) { var px = sx + i * 9 * k * s[1]; g.fillStyle = i % 2 ? '#d4d8dd' : '#c8cdd4'; g.fillRect(px - 4 * k, base - 36 * k, 8 * k, 36 * k); g.beginPath(); g.ellipse(px, base - 36 * k, 4 * k, 2 * k, 0, 0, TAU); g.fill(); }
    });
    [2.42, 2.55, -2.4, -2.6].forEach(function (p, i) {
      var gx = at(p), gh = (30 + (i % 2) * 8) * k, gc = i % 2 ? '#a9b8c6' : '#9fb0c0';
      g.strokeStyle = gc; g.lineWidth = 2 * k; g.beginPath();
      g.moveTo(gx - 6 * k, base); g.lineTo(gx - 6 * k, base - gh); g.moveTo(gx + 6 * k, base); g.lineTo(gx + 6 * k, base - gh);
      g.moveTo(gx - 22 * k, base - gh); g.lineTo(gx + 26 * k, base - gh); g.moveTo(gx - 4 * k, base - gh); g.lineTo(gx, base - gh - 12 * k); g.lineTo(gx + 6 * k, base - gh);
      g.moveTo(gx, base - gh - 12 * k); g.lineTo(gx + 26 * k, base - gh); g.stroke();
    });
    // escollera de la bocana y los dos faros (rojo en y < 0, verde en y > 0)
    g.fillStyle = '#9aa3ad';
    for (var bx = 0; bx < W; bx += 3) { var ba = A(bx); if (ba > 2.55 && ba < 3.06) g.fillRect(bx, base - (4 + 2 * Math.sin(bx * 0.7)) * k, 3, 12 * k); }
    [[-3.06, '#e8504a'], [3.06, '#3fae49']].forEach(function (e) {
      var fx = at(e[0]);
      g.fillStyle = '#f2f1ec'; g.fillRect(fx - 2.4 * k, base - 22 * k, 4.8 * k, 18 * k);
      g.fillStyle = e[1]; g.fillRect(fx - 2.4 * k, base - 17 * k, 4.8 * k, 4 * k); g.fillRect(fx - 3 * k, base - 26 * k, 6 * k, 4 * k);
      if (eve) { var gr = g.createRadialGradient(fx, base - 24 * k, 0, fx, base - 24 * k, 7 * k); gr.addColorStop(0, e[1]); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(fx - 7 * k, base - 31 * k, 14 * k, 14 * k); }
    });
    // pie fundido con la bruma (la tinta de la luz lo tiñe de tarde)
    g.globalCompositeOperation = 'source-atop';
    var fg = g.createLinearGradient(0, H * 0.62, 0, H); fg.addColorStop(0, 'rgba(214,228,236,0)'); fg.addColorStop(1, 'rgba(214,228,236,0.6)');
    g.fillStyle = fg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }

  /* ---------- hormigón del muelle (mosaico de 7,5 m: 3 × 3 losas con juntas, manchas, grietas y áridos) ---------- */
  function tile(g, N, h) {
    var rnd = h.rnd, wrapAt = h.wrapAt;
    g.fillStyle = '#b8b5b0'; g.fillRect(0, 0, N, N);
    for (var i = 0; i < 34; i++) {
      var bx = rnd() * N, by = rnd() * N, br = 30 + rnd() * 80, lt = rnd() < 0.5;
      wrapAt(bx, by, br, function (X, Y) { var gr = g.createRadialGradient(X, Y, 0, X, Y, br); gr.addColorStop(0, lt ? 'rgba(255,252,244,0.12)' : 'rgba(110,100,88,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - br, Y - br, br * 2, br * 2); });
    }
    for (var k = 0; k < 4200; k++) { g.fillStyle = rnd() < 0.55 ? 'rgba(95,88,80,0.28)' : 'rgba(255,253,246,0.4)'; g.fillRect(Math.floor(rnd() * N), Math.floor(rnd() * N), 1, 1); }
    // manchas de aceite y de óxido (pocas)
    for (var o = 0; o < 3; o++) {
      var ox = rnd() * N, oy = rnd() * N, orr = 10 + rnd() * 18, rust = o === 2;
      wrapAt(ox, oy, orr, function (X, Y) { var gr = g.createRadialGradient(X, Y, 0, X, Y, orr); gr.addColorStop(0, rust ? 'rgba(160,90,50,0.22)' : 'rgba(60,55,60,0.24)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - orr, Y - orr, orr * 2, orr * 2); });
    }
    // grietas finas
    g.strokeStyle = 'rgba(110,104,96,0.45)'; g.lineWidth = 1;
    for (var c = 0; c < 6; c++) {
      var cx = rnd() * N, cy = rnd() * N; g.beginPath(); g.moveTo(cx, cy);
      for (var s = 0; s < 5; s++) { cx += (rnd() - 0.5) * 30; cy += (rnd() - 0.5) * 30; g.lineTo(cx, cy); }
      g.stroke();
    }
    // juntas de las losas (2,5 m): línea oscura con su filo claro
    var step = N / 3;
    for (var j = 0; j < 3; j++) {
      var p = Math.round(j * step);
      g.fillStyle = 'rgba(128,122,114,0.85)'; g.fillRect(p, 0, 2, N); g.fillRect(0, p, N, 2);
      g.fillStyle = 'rgba(255,252,244,0.35)'; g.fillRect(p + 2, 0, 1, N); g.fillRect(0, p + 2, N, 1);
    }
  }
  function sand(x, y, kk) {
    // hormigón: variación suave (el mosaico ya lleva el color); algo más oscuro junto al canto del muelle (salitre)
    var k = 0.9 + (kk - 0.93) * 1.1, edge = Math.max(0, Math.min(1, (x - QX) / 4));
    k *= 0.9 + 0.1 * edge;
    return [k, k * 0.99, k * 0.97];
  }

  /* ---------- isla de arena (debajo de las cintas, en la capa de la pista) ---------- */
  function courtBase(g, h) {
    var X = h.X, Y = h.Y, ppm = h.ppm, rnd = h.rnd;
    var x0 = X(-IX), x1 = X(IX), y0 = Y(IY), y1 = Y(-IY), w = x1 - x0, hh = y1 - y0;
    g.save(); g.beginPath(); g.rect(x0, y0, w, hh); g.clip();
    g.fillStyle = SAND_C; g.fillRect(x0, y0, w, hh);
    for (var i = 0; i < 70; i++) {
      var bx = x0 + rnd() * w, by = y0 + rnd() * hh, br = (1.2 + rnd() * 3) * ppm, lt = rnd() < 0.5;
      var gr = g.createRadialGradient(bx, by, 0, bx, by, br); gr.addColorStop(0, lt ? 'rgba(255,246,226,0.25)' : 'rgba(196,160,108,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    var n = Math.round(w * hh / 55);
    for (var k = 0; k < n; k++) { g.fillStyle = rnd() < 0.55 ? 'rgba(170,128,72,0.3)' : 'rgba(255,250,236,0.5)'; g.fillRect(x0 + rnd() * w, y0 + rnd() * hh, rnd() < 0.8 ? 1 : 2, 1); }
    // arena amontonada contra el bordillo: borde algo más oscuro (0,45 m) con una línea de sombra pegada a los tablones
    var e = 0.45 * ppm;
    [[x0, y0, w, e, 0, 1], [x0, y1 - e, w, e, 0, -1], [x0, y0, e, hh, 1, 0], [x1 - e, y0, e, hh, -1, 0]].forEach(function (b) {
      var gx = b[4] ? (b[4] > 0 ? b[0] : b[0] + b[2]) : 0, gy = b[5] ? (b[5] > 0 ? b[1] : b[1] + b[3]) : 0;
      var gr = b[4] ? g.createLinearGradient(gx, 0, gx + b[4] * e, 0) : g.createLinearGradient(0, gy, 0, gy + b[5] * e);
      gr.addColorStop(0, 'rgba(120,88,52,0.42)'); gr.addColorStop(0.18, 'rgba(176,136,86,0.22)'); gr.addColorStop(1, 'rgba(176,136,86,0)');
      g.fillStyle = gr; g.fillRect(b[0], b[1], b[2], b[3]);
    });
    g.restore();
  }

  /* ---------- piezas propias (todo en la estática B: 0 dibujos) ---------- */
  function build(G, K, B) {
    var col = K.col, rnd = K.rnd, part = K.part, lrod = K.lrod, objM = K.objM, BG = K.BGEO, BOX = K.UNIT_BOX;
    var WH = col('#ffffff');
    function sb(lx, ly, lz, cx, cy, cz, c) { B.sbox(lx, ly, lz, cx, cy, cz, c); }
    function rod(x0, y0, z0, x1, y1, z1, r, c, gg) { objM(0, 0, 0, 1); lrod(B, x0, z0, -y0, x1, z1, -y1, r, c, gg); }
    var dark = col('#2b2b33'), steel = col('#3d4a57'), white = col('#f4f4ee'), glass = col('#9fd6ff'), glassD = col('#34445a');
    var wood = col('#9a6a3e'), woodL = col('#b98a55'), conc = col('#a9a49c'), cop = col('#d9d4cc'), wall = col('#8f8a84'), wet = col('#4f5a62');

    // agua de la dársena: más baja que el muelle y con la orilla de la malla escondida debajo del hormigón
    var sea = G.getObjectByName('beachSea');
    if (sea) { sea.position.y = WATER_Z; if (sea.material.uniforms && sea.material.uniforms.uShore) sea.material.uniforms.uShore.value = QX + 4; }
    var sg = G.getObjectByName('beachSand');
    if (sg) {
      var pa = sg.geometry.attributes.position;
      for (var pi = 0; pi < pa.count; pi++) if (pa.getX(pi) < QX) pa.setX(pi, QX);
      pa.needsUpdate = true; sg.geometry.computeBoundingSphere();
    }

    // canto del muelle: cantil, paramento con la franja mojada, norays y defensas de neumático
    sb(0.9, 340, 0.2, QX - 0.25, 0, 0.1, cop);
    sb(0.6, 340, 1.6, QX - 0.4, 0, -0.8, wall);
    sb(0.62, 340, 0.32, QX - 0.4, 0, -0.95, wet);
    for (var by = -64; by <= 64; by += 8) {
      rod(QX + 0.45, by, 0, QX + 0.45, by, 0.5, 0.16, dark);
      part(B, BG.sph6, QX + 0.45, 0.52, -by, dark, 0, 0, 0, 0.23, 0.12, 0.23);
    }
    for (var ty = -60; ty <= 60; ty += 6) sb(0.3, 0.7, 1.3, QX - 0.82, ty, -0.45, dark);   // defensas de goma
    // escalas de gato en el paramento
    [-30, 4, 34].forEach(function (y) { rod(QX - 0.72, y - 0.22, -1.1, QX - 0.72, y - 0.22, 0.2, 0.025, steel); rod(QX - 0.72, y + 0.22, -1.1, QX - 0.72, y + 0.22, 0.2, 0.025, steel); for (var r = 0; r < 4; r++) rod(QX - 0.72, y - 0.22, -1 + r * 0.32, QX - 0.72, y + 0.22, -1 + r * 0.32, 0.02, steel); });

    // muelle de enfrente (otro canto, tinglados y farolas altas)
    var concF = col('#b3aea6');
    sb(19, 300, 1.7, -102.5, 0, -0.85, concF);
    sb(0.6, 300, 0.22, -93.3, 0, 0.11, cop);
    sb(0.08, 300, 0.32, -92.97, 0, -0.95, wet);
    [[-62, '#c9cfd8'], [-86, '#b8c2d0'], [64, '#c9cfd8'], [88, '#d8dde4']].forEach(function (s) {
      var c = col(s[1]);
      sb(11, 22, 8, -106, s[0], 4, c); sb(11.4, 22.4, 0.6, -106, s[0], 8.3, col('#7f8a99'));
      sb(0.1, 5, 5.5, -100.45, s[0] - 5, 2.75, col('#5d6878')); sb(0.1, 5, 5.5, -100.45, s[0] + 5, 2.75, col('#5d6878'));
    });
    [-110, -40, 30, 110].forEach(function (y) { rod(-95, y, 0, -95, y, 22, 0.25, steel); sb(0.8, 2.6, 0.5, -95, y, 22.2, steel); });

    /* contenedor marítimo de 20 pies (6,06 × 2,44 × 2,59): caja, largueros de arriba y abajo y, cerca, postes y ondas */
    function container(cx, cy, z0, alongY, c, det) {
      var L = 6.06, Wd = 2.44, Hc = 2.59, lx = alongY ? Wd : L, ly = alongY ? L : Wd, cc = col(c), dk = cc.clone().multiplyScalar(0.7), lt = cc.clone().lerp(WH, 0.16);
      sb(lx, ly, Hc, cx, cy, z0 + Hc / 2, cc);
      sb(lx + 0.04, ly + 0.04, 0.14, cx, cy, z0 + Hc - 0.07, dk);
      sb(lx + 0.04, ly + 0.04, 0.16, cx, cy, z0 + 0.08, dk);
      if (!det) return;
      for (var sx = -1; sx <= 1; sx += 2) for (var sy = -1; sy <= 1; sy += 2) sb(0.16, 0.16, Hc, cx + sx * (lx / 2 - 0.06), cy + sy * (ly / 2 - 0.06), z0 + Hc / 2, dk);
      for (var i = 0; i < 6; i++) {
        var a = -L / 2 + (i + 0.5) * L / 6;
        for (var f = -1; f <= 1; f += 2) {
          if (alongY) sb(0.06, 0.32, Hc - 0.4, cx + f * Wd / 2, cy + a, z0 + Hc / 2, lt);
          else sb(0.32, 0.06, Hc - 0.4, cx + a, cy + f * Wd / 2, z0 + Hc / 2, lt);
        }
      }
    }

    /* grúa pórtico inventada: u = eje de la pluma (+ hacia el agua), dir = +1 si el agua está hacia -x */
    function crane(cx, cy, dir, hex, det) {
      var c = col(hex), cD = c.clone().multiplyScalar(0.78);
      function X(u) { return cx - dir * u; }
      var LEG = 7, ZP = 13.6, ZG = 20.0, GY = 2.2, U0 = -14, U1 = 40;
      for (var lu = -1; lu <= 1; lu += 2) for (var ly = -1; ly <= 1; ly += 2) {
        sb(0.9, 0.9, ZP, X(lu * 4), cy + ly * LEG, ZP / 2, c);
        sb(1.5, 2.8, 1.0, X(lu * 4), cy + ly * LEG, 0.5, dark);                       // bogie
        rod(X(lu * 4), cy + ly * LEG, ZP + 0.5, X(lu * 4), cy + ly * GY, ZG, 0.42, c); // tronco que se estrecha hasta la pluma
      }
      for (var su = -1; su <= 1; su += 2) {
        sb(1.2, 2 * LEG + 1.2, 1.2, X(su * 4), cy, ZP, c);                              // vigas del pórtico (a lo largo del muelle)
        rod(X(su * 4), cy - LEG, 2.4, X(su * 4), cy + LEG, ZP - 0.8, 0.16, cD);          // cruces de arriostrado
        rod(X(su * 4), cy + LEG, 2.4, X(su * 4), cy - LEG, ZP - 0.8, 0.16, cD);
      }
      for (var sy2 = -1; sy2 <= 1; sy2 += 2) sb(9.2, 1.0, 1.0, cx, cy + sy2 * LEG, ZP, c);
      // pluma: dos vigas de celosía (cordones y diagonales) con travesaños
      var um = (U0 + U1) / 2, ul = U1 - U0;
      for (var gy = -1; gy <= 1; gy += 2) {
        var yy = cy + gy * GY;
        sb(ul, 0.9, 0.36, X(um), yy, ZG + 1.45, c); sb(ul, 0.9, 0.36, X(um), yy, ZG + 0.15, c);
        for (var u = U0; u < U1 - 0.1; u += 3) { rod(X(u), yy, ZG + 0.2, X(u + 1.5), yy, ZG + 1.4, 0.13, cD); rod(X(u + 1.5), yy, ZG + 1.4, X(u + 3), yy, ZG + 0.2, 0.13, cD); }
        sb(0.6, 0.9, 1.6, X(U1), yy, ZG + 0.8, c);
      }
      for (var tu = U0; tu <= U1; tu += 6) sb(0.4, 2 * GY + 0.9, 0.4, X(tu), cy, ZG + 0.15, c);
      // caseta de máquinas (atrás), castillete en A, tirantes y punta de la pluma
      sb(6.2, 5.6, 3.2, X(-8.5), cy, ZG + 3.3, white); sb(6.4, 5.8, 0.4, X(-8.5), cy, ZG + 5.0, c);
      for (var ay = -1; ay <= 1; ay += 2) {
        var yA = cy + ay * GY;
        rod(X(-6), yA, ZG + 1.6, X(-1), yA, ZG + 11.5, 0.38, c); rod(X(4), yA, ZG + 1.6, X(-1), yA, ZG + 11.5, 0.38, c);
        rod(X(-1), yA, ZG + 11.3, X(U1), yA, ZG + 1.6, 0.11, steel); rod(X(-1), yA, ZG + 11.3, X(20), yA, ZG + 1.6, 0.11, steel);
        rod(X(-1), yA, ZG + 11.3, X(U0), yA, ZG + 1.6, 0.11, steel);
      }
      sb(1.0, 2 * GY + 1.0, 1.0, X(-1), cy, ZG + 11.5, c);
      // carro con la cabina del gruista y el contenedor colgado del spreader (sobre el agua)
      var ut = det ? 18 : 30, xt = X(ut);
      sb(3.0, 2 * GY - 1.0, 1.0, xt, cy, ZG - 0.4, white);
      sb(2.0, 1.6, 1.6, xt + dir * 1.2, cy - 1.0, ZG - 1.7, white); sb(2.05, 1.65, 0.7, xt + dir * 1.2, cy - 1.0, ZG - 1.5, glassD);
      if (det) {
        var zc = 9.6;
        container(xt, cy, zc, false, '#e0a33a', true);
        sb(6.3, 2.6, 0.3, xt, cy, zc + 2.59 + 0.25, dark);
        for (var kx = -1; kx <= 1; kx += 2) for (var ky = -1; ky <= 1; ky += 2) rod(xt + kx * 2.6, cy + ky * 1.0, zc + 2.95, xt + kx * 1.0, cy + ky * 0.9, ZG - 0.9, 0.03, dark);
      }
    }
    crane(-23.5, -25, 1, '#19a39a', true);
    crane(-101, 7, -1, '#ff6f4f', false);

    // pilas de contenedores: bajo la grúa teal (nuestro muelle) y en el muelle de enfrente
    var ci = 0;
    function cpick() { ci++; return CONT[(ci * 5 + Math.floor(rnd() * 3)) % CONT.length]; }
    [-20.6, -23.4].forEach(function (x, r) {
      for (var y = -37; y >= -62; y -= 6.25) { var n = 1 + Math.floor(rnd() * (r ? 3.2 : 2.6)); for (var l = 0; l < n; l++) container(x, y, l * 2.59, true, cpick(), true); }
    });
    container(-23.5, -25, 0, false, '#24406e', true);  // uno en el suelo entre las patas de la grúa
    [-97.6, -100.4].forEach(function (x, r) {
      [[-14, -46], [18, 50]].forEach(function (blk) {
        for (var y = blk[0]; Math.abs(y) <= Math.abs(blk[1]); y += (blk[1] > blk[0] ? 6.25 : -6.25)) {
          var n = 1 + Math.floor(rnd() * (r ? 4 : 3)); for (var l = 0; l < n; l++) container(x, y, l * 2.59, true, cpick(), false);
        }
      });
    });

    // ferri blanco atracado (a la derecha del mar desde la cámara de juego), con amarras a los norays
    objM(-36.2, 47, PI / 2, 1);
    var navy = col('#1f2a44'), coral = col('#ff6f4f'), orange = col('#ff8a2a');
    part(B, BOX, -2, 1.55, 0, white, 0, 0, 0, 44, 5.3, 11);
    part(B, BOX, 20, 1.55, 0, white, 0, PI / 4, 0, 7.78, 5.3, 7.78);
    part(B, BOX, -2, -0.45, 0, navy, 0, 0, 0, 44.1, 1.3, 11.1);
    part(B, BOX, 20, -0.45, 0, navy, 0, PI / 4, 0, 7.86, 1.3, 7.86);
    part(B, BOX, -2, 3.55, 0, coral, 0, 0, 0, 44.12, 0.35, 11.12);
    part(B, BOX, 20, 3.55, 0, coral, 0, PI / 4, 0, 7.88, 0.35, 7.88);
    part(B, BOX, -4, 5.6, 0, white, 0, 0, 0, 32, 2.8, 10);
    part(B, BOX, -4, 5.7, 0, glassD, 0, 0, 0, 32.1, 0.9, 10.1);
    part(B, BOX, -4, 8.3, 0, white, 0, 0, 0, 24, 2.6, 9.2);
    part(B, BOX, -4, 8.4, 0, glassD, 0, 0, 0, 24.1, 0.8, 9.3);
    part(B, BOX, 5, 10.6, 0, white, 0, 0, 0, 6, 2.0, 10.8);
    part(B, BOX, 5.8, 10.75, 0, glassD, 0, 0, 0, 4.6, 0.7, 10.9);
    part(B, BOX, -8, 12.2, 0, white, 0, 0, 0, 4, 5.4, 3.2);
    part(B, BOX, -8, 13.1, 0, coral, 0, 0, 0, 4.05, 1.1, 3.25);
    part(B, BOX, -8, 14.95, 0, dark, 0, 0, 0, 4.06, 0.4, 3.26);
    lrod(B, 5, 11.6, 0, 5, 16, 0, 0.08, steel);
    for (var lb = 0; lb < 4; lb++) for (var ls = -1; ls <= 1; ls += 2) part(B, BOX, -14 + lb * 5.2, 7.6, ls * 4.9, orange, 0, 0, 0, 3.6, 0.9, 1.1);
    part(B, BOX, -24.3, 2.2, 0, dark, 0, 0, 0, 0.5, 3.6, 8.6);   // portalón de popa
    rod(-30.5, 68, 3.6, -28.6, 72, 0.55, 0.05, col('#f2ead8')); rod(-30.5, 26, 3.6, -28.6, 24, 0.55, 0.05, col('#f2ead8'));
    rod(-30.5, 40, 3.6, -28.6, 40, 0.55, 0.05, col('#f2ead8'));

    // remolcador rojo amarrado (a la izquierda) y dos veleros abarloados (a la derecha, antes del ferri)
    objM(-32.6, -21, PI / 2, 1);
    var red = col('#d8342c');
    part(B, BOX, 0, 0.2, 0, red, 0, 0, 0, 9, 2.6, 4.2); part(B, BOX, 4.5, 0.2, 0, red, 0, PI / 4, 0, 2.97, 2.6, 2.97);
    part(B, BOX, 0.4, 1.2, 0, dark, 0, 0, 0, 9.4, 0.4, 4.5); part(B, BOX, 4.5, 1.2, 0, dark, 0, PI / 4, 0, 3.2, 0.4, 3.2);
    part(B, BOX, -0.6, 2.4, 0, white, 0, 0, 0, 4.2, 1.8, 3.0); part(B, BOX, 0.4, 3.9, 0, white, 0, 0, 0, 2.4, 1.2, 3.2);
    part(B, BOX, 0.4, 4.0, 0, glassD, 0, 0, 0, 2.45, 0.45, 3.25);
    part(B, BOX, -1.9, 4.0, 0, red, 0, 0, 0, 0.9, 1.6, 1.1); part(B, BOX, -1.9, 4.85, 0, dark, 0, 0, 0, 0.92, 0.2, 1.12);
    lrod(B, 0.4, 4.5, 0, 0.4, 7, 0, 0.05, steel);
    [[-31.4, 12.6, '#f4f4ee', 1], [-34.4, 13.1, '#1e4fd8', 0.92]].forEach(function (s, i) {
      objM(s[0], s[1], PI / 2 + i * 0.03, s[3]);
      var hc = col(s[2]);
      part(B, BOX, 0, -0.5, 0, hc, 0, 0, 0, 7, 1.2, 2.6); part(B, BOX, 3.5, -0.5, 0, hc, 0, PI / 4, 0, 1.84, 1.2, 1.84);
      part(B, BOX, 0.2, -0.2, 0, i ? white : navy, 0, 0, 0, 7.05, 0.12, 2.65);
      part(B, BOX, -0.6, 0.3, 0, white, 0, 0, 0, 2.8, 0.55, 1.8);
      lrod(B, 0.8, 0, 0, 0.8, 11.5, 0, 0.06, col('#dfe4ea'));
      lrod(B, 0.8, 1.25, 0, -2.6, 1.25, 0, 0.05, col('#dfe4ea')); lrod(B, 0.8, 1.42, 0, -2.4, 1.42, 0, 0.13, col(i ? '#ff6f4f' : '#1e4fd8'));
      lrod(B, 0.8, 11.4, 0, 4.4, 0.1, 0, 0.012, steel); lrod(B, 0.8, 11.4, 0, -3.4, 0.1, 0, 0.012, steel);
    });

    // isla de arena: bordillo de tablones (la arena está pintada en la capa de la pista)
    for (var s = -1; s <= 1; s += 2) {
      sb(2 * IX + 0.28, 0.14, 0.22, 0, s * (IY + 0.07), 0.11, wood); sb(2 * IX + 0.3, 0.17, 0.03, 0, s * (IY + 0.07), 0.235, woodL);
      sb(0.14, 2 * IY, 0.22, s * (IX + 0.07), 0, 0.11, wood); sb(0.17, 2 * IY, 0.03, s * (IX + 0.07), 0, 0.235, woodL);
    }

    // gradas de contenedores (2 de alto) detrás de las de aluminio: terraza con barandilla, dos filas de público y escalera
    var seats = K.seats || [], seats0 = seats.length, deck = col('#5d6878'), deck2 = col('#6f7b8c'), bench = col('#c58a4a'), rail = col('#e9eef3');
    var STC = [['#24406e', '#e0a33a', '#19a39a'], ['#ff6f4f', '#3f9e5a', '#24406e']];
    for (var sd = -1; sd <= 1; sd += 2) {
      var cy = sd * (16.75 + 1.22), zt = 5.18;
      for (var i = 0; i < 3; i++) { var cx = (i - 1) * 6.1; container(cx, cy, 0, false, STC[sd > 0 ? 0 : 1][i], true); container(cx, cy, 2.59, false, STC[sd > 0 ? 1 : 0][(i + 1) % 3], true); }
      sb(18.6, 2.62, 0.08, 0, cy, zt + 0.04, deck);
      sb(18.3, 1.1, 0.42, 0, sd * 18.6, zt + 0.08 + 0.21, deck2);
      var yb0 = sd * 17.3, yb1 = sd * 18.55, zb0 = zt + 0.08 + 0.45, zb1 = zb0 + 0.42;
      sb(18.0, 0.36, 0.05, 0, yb0, zb0 - 0.025, bench); sb(18.0, 0.1, 0.42, 0, yb0 + sd * 0.05, zb0 - 0.26, dark);
      sb(18.0, 0.36, 0.05, 0, yb1, zb1 - 0.025, bench); sb(18.0, 0.1, 0.42, 0, yb1 + sd * 0.05, zb1 - 0.26, dark);
      var yf = sd * 16.78, yk = sd * 19.12;
      for (var px = -9.2; px <= 9.21; px += 2.3) { rod(px, yf, zt, px, yf, zt + 1.05, 0.035, rail); rod(px, yk, zt + 0.5, px, yk, zt + 1.6, 0.035, rail); }
      rod(-9.3, yf, zt + 1.05, 9.3, yf, zt + 1.05, 0.03, rail); rod(-9.3, yf, zt + 0.55, 9.3, yf, zt + 0.55, 0.022, rail);
      rod(-9.3, yk, zt + 1.6, 9.3, yk, zt + 1.6, 0.03, rail);
      for (var si = -8.7; si < 8.75; si += 0.56) {
        // una fila de público en la terraza (la de atrás, más alta: se ve por encima de la barandilla)
        if (rnd() < 0.62) seats.push({ x: si + (rnd() - 0.5) * 0.1, y: yb1, z: zb1, fx: 0, fy: -sd, row: 6 });
      }
      // escalera metálica de dos tramos en el extremo de tierra
      var ys = sd * 17.95, z1 = 2.59;
      for (var f = 0; f < 2; f++) {
        var xa = f ? 12.9 : 15.9, xb = f ? 9.9 : 12.9, za = f ? z1 : 0, zb = f ? zt : z1;
        for (var e2 = -1; e2 <= 1; e2 += 2) { rod(xa, ys + e2 * 0.5, za, xb, ys + e2 * 0.5, zb, 0.05, steel); rod(xa, ys + e2 * 0.55, za + 1.0, xb, ys + e2 * 0.55, zb + 1.0, 0.03, rail); }
        for (var st = 1; st < 8; st++) { var tt = st / 8; sb(0.3, 1.0, 0.05, xa + (xb - xa) * tt, ys, za + (zb - za) * tt, steel); }
      }
      sb(1.4, 1.2, 0.1, 12.9, ys, z1, steel); rod(12.9, ys - 0.5, 0, 12.9, ys - 0.5, z1, 0.06, steel); rod(12.9, ys + 0.5, 0, 12.9, ys + 0.5, z1, 0.06, steel);
    }

    // presupuesto de triángulos (el público es lo más caro): la grada de aluminio cede asientos a la terraza y el total
    // queda como el de Platja (+ 8)
    var extra = seats.length - seats0 - 8;
    for (var rm = 0; rm < extra && seats0 > 0; rm++) { seats.splice(Math.floor(rnd() * seats0), 1); seats0--; }

    // cabina de comentaristas sobre un contenedor azul en la esquina (con la cámara de TV en el terrado)
    container(19.8, 14.2, 0, false, '#24406e', true);
    sb(3.6, 2.2, 2.2, 19.4, 14.2, 2.59 + 1.1, white); sb(3.65, 2.25, 0.8, 19.4, 14.2, 2.59 + 1.5, glassD);
    sb(4.0, 2.6, 0.16, 19.4, 14.2, 2.59 + 2.28, col('#19a39a'));
    rod(20.6, 14.6, 4.9, 20.6, 14.6, 6.2, 0.04, dark); sb(0.7, 0.35, 0.4, 20.6, 14.6, 6.4, dark);

    // farolas de puerto y banderines triangulares en cuerda (laterales y fondo rival; nunca sobre la pista)
    var PEN = [col('#ff6f4f'), col('#19a39a'), col('#ffd23f'), col('#f4f4ee')], pk = 0;
    function lamp(x, y, hgt) {
      rod(x, y, 0, x, y, hgt, 0.09, steel); sb(0.36, 0.36, 0.5, x, y, 0.25, conc);
      rod(x, y, hgt - 0.1, x + 0.9, y, hgt + 0.15, 0.04, steel); rod(x, y, hgt - 0.1, x - 0.9, y, hgt + 0.15, 0.04, steel);
      sb(0.6, 0.28, 0.16, x + 1.0, y, hgt + 0.12, steel); sb(0.6, 0.28, 0.16, x - 1.0, y, hgt + 0.12, steel);
      sb(0.5, 0.22, 0.03, x + 1.0, y, hgt + 0.03, col('#fff3d6')); sb(0.5, 0.22, 0.03, x - 1.0, y, hgt + 0.03, col('#fff3d6'));
    }
    function bunting(x0, y0, x1, y1, h, sag) {
      var L = Math.hypot(x1 - x0, y1 - y0), ns = 10, px = x0, py = y0, pz = h, a = Math.atan2(y1 - y0, x1 - x0), n = Math.max(3, Math.round(L / 0.75));
      for (var s2 = 1; s2 <= ns; s2++) { var t = s2 / ns, qx = x0 + (x1 - x0) * t, qy = y0 + (y1 - y0) * t, qz = h - sag * 4 * t * (1 - t); rod(px, py, pz, qx, qy, qz, 0.012, dark); px = qx; py = qy; pz = qz; }
      for (var i2 = 1; i2 < n; i2++) {
        var u = i2 / n, bx = x0 + (x1 - x0) * u, by2 = y0 + (y1 - y0) * u, bz = h - sag * 4 * u * (1 - u);
        objM(0, 0, 0, 1); part(B, BG.cone4, bx, bz - 0.2, -by2, PEN[pk++ % PEN.length], PI, a, 0, 0.17, 0.4, 0.015);
      }
    }
    var LY = 11.3, LH = 7.2, BH = 6.1, XS = [-17.3, -8.6, 0, 8.6, 17.3];
    for (var s3 = -1; s3 <= 1; s3 += 2) {
      XS.forEach(function (x) { lamp(x, s3 * LY, LH); });
      for (var j = 0; j < XS.length - 1; j++) bunting(XS[j], s3 * LY, XS[j + 1], s3 * LY, BH, 0.55);
    }
    bunting(-17.3, -LY, -17.3, LY, BH, 1.0);
    [[-26, 14], [-26, -14], [-26, 40], [22, 18], [26, -16], [-8, 24], [8, -24]].forEach(function (p) { lamp(p[0], p[1], 8.5); });

    // food trucks, bancos de palés y jardineras con olivos (lado de tierra, detrás de nuestro fondo)
    function truck(x, y, hex, acc) {
      objM(x, y, -PI / 2, 1);
      var cc = col(hex), ac = col(acc);
      part(B, BOX, -0.4, 1.75, 0, cc, 0, 0, 0, 4.6, 2.5, 2.3); part(B, BOX, -0.4, 3.06, 0, white, 0, 0, 0, 4.7, 0.12, 2.4);
      part(B, BOX, -0.4, 1.0, 0, ac, 0, 0, 0, 4.62, 0.28, 2.32);
      part(B, BOX, 2.6, 1.4, 0, cc, 0, 0, 0, 1.5, 1.8, 2.2); part(B, BOX, 3.36, 1.85, 0, glassD, 0, 0, 0, 0.04, 0.75, 2.0);
      for (var wx = -1; wx <= 1; wx += 2) for (var wz = -1; wz <= 1; wz += 2) part(B, BG.cyl, wx > 0 ? 2.4 : -1.9, 0.42, wz * 1.1, dark, PI / 2, 0, 0, 0.42, 0.24, 0.42);
      part(B, BOX, -0.6, 2.05, 1.16, glassD, 0, 0, 0, 2.8, 1.0, 0.04); part(B, BOX, -0.6, 1.5, 1.32, white, 0, 0, 0, 3.0, 0.08, 0.36);
      part(B, BOX, -0.6, 2.78, 1.55, ac, 0.5, 0, 0, 3.1, 0.05, 0.95);
      part(B, BOX, -0.6, 3.5, 0, ac, 0, 0, 0, 2.2, 0.6, 0.1);   // rótulo en el techo
    }
    truck(24.2, -4.6, '#ff6f4f', '#ffd23f'); truck(24.2, 4.4, '#19a39a', '#ff6f4f');
    [[20.6, -4.2], [20.6, 4.2], [21.4, 0]].forEach(function (p, i) {
      sb(1.2, 2.4, 0.3, p[0], p[1], 0.15, wood); sb(1.2, 2.4, 0.12, p[0], p[1], 0.36, woodL);
      sb(1.1, 2.3, 0.1, p[0], p[1], 0.47, col(i % 2 ? '#19a39a' : '#ff6f4f'));
    });
    function olive(x, y) {
      sb(1.3, 1.3, 0.8, x, y, 0.4, conc); sb(1.36, 1.36, 0.08, x, y, 0.82, cop);
      objM(x, y, rnd() * PI, 1);
      lrod(B, 0, 0.8, 0, 0.3, 2.3, 0.1, 0.1, col('#7a6a52')); lrod(B, 0.2, 1.8, 0, -0.5, 2.6, -0.2, 0.08, col('#7a6a52'));
      part(B, BG.sph6, 0.3, 2.75, 0.1, col('#6f8f4a'), 0, 0, 0, 0.85, 0.5, 0.8); part(B, BG.sph6, -0.35, 2.6, -0.25, col('#809e58'), 0, 0.6, 0, 0.6, 0.4, 0.55);
      part(B, BG.sph6, 0.1, 3.05, 0.35, col('#5f7f40'), 0, 0.3, 0, 0.5, 0.32, 0.45);
    }
    // tinglado viejo del puerto (lado de tierra, lejos) con ventanales en arco y un paseo de palmeras delante
    var shed = col('#e6d6bc'), roof = col('#b5532e'), win = col('#5d6878');
    sb(10, 70, 8, 58, 0, 4, shed); sb(10.6, 70.6, 0.5, 58, 0, 8.25, roof);
    B.box(5.9, 0.3, 70.8, 55.5, 9.35, 0, roof, 0, 0, 0.36); B.box(5.9, 0.3, 70.8, 60.5, 9.35, 0, roof, 0, 0, -0.36);
    sb(0.2, 70, 1.6, 58, 0, 9.3, shed);
    for (var wy = -32; wy <= 32; wy += 4) { sb(0.08, 2.4, 3.6, 52.96, wy, 3.6, win); sb(0.08, 1.6, 0.6, 52.96, wy, 5.7, win); }
    [-27, -9, 9, 27].forEach(function (y, i) { K.props.palm(B, 44, y + (i % 2) * 1.5, 7 + (i % 3) * 0.8, 0.1, rnd() * 6); });
    [[21.5, -9], [21.5, 9], [-19.5, 13.4], [-19.5, -13.4], [11.6, 11.8], [-11.6, -11.8], [17.5, -1.5]].forEach(function (p) { olive(p[0], p[1]); });
  }

  VB.Arena.registerMap({
    id: 'moll', kind: 'beach', seed: 5520417,
    P: {
      looks: LOOKS,
      clouds: true, gulls: true, boats: false, surf: 0,
      tape: '#1e4fd8', tapeEdge: 'rgba(12,30,90,0.55)', attackCord: 'rgba(30,79,216,0.5)',
      brand: { name: 'MOLL DE LA SORRA', fg: '#ffffff', bg: ['#127f78', '#19a39a'], deco: 'cut' },
      bannerCut: '#ffd23f', bannerFrame: '#3d4a57',
      bcol: { canA: '#f4f4ee', canB: '#19a39a', coral: '#ff6f4f', padA: '#19a39a', padW: '#1f2a44', netTop: '#ffd23f', post: '#3d4a57', bag: '#24406e' },
      stands: { frame: '#24406e', can: ['#f4f4ee', '#19a39a', '#ff6f4f'] },
      score: { frame: '#19a39a', cab: '#24406e', top: '#ff6f4f', cut: '#f4f4ee' },
      crowd: { shirts: ['#ff6f4f', '#19a39a', '#ffd23f', '#1e4fd8', '#f4f4ee', '#3f9e5a', '#ff9cc0', '#2b2b33', '#e0a33a', '#8fc6ee', '#c9a8ff'], hatP: 0.3,
        hats: ['#1e4fd8', '#ff6f4f', '#19a39a', '#ffd23f', '#f4f4ee', '#2b2b33'] },
      benchUmbrella: true,
      props: function () { },     // sin palmeras ni sombrillas de Platja: el muelle tiene lo suyo (build)
      sand: sand, sandTile: '#b8b5b0', tile: tile, courtBase: courtBase,
      backdrop: backdrop, relight: true
    },
    build: build
  });
})();
