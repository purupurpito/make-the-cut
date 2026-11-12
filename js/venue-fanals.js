/* VOLEY 3D — js/venue-fanals.js (owner: arena)
 * Sede de playa «Cala dels Fanals» (12-nov-2026): vóley playa de NOCHE en una cala cerrada entre promontorios (la D5
 * «playa nocturna» del backlog; la sede de las grandes citas de la Carrera de playa). Guiño: «fanals» = faroles, y la
 * pesca de luz con barcas de lámpara.
 *
 * Es una PIEL del constructor de playa de arena.js (registerMap con P sobre los parámetros de Platja Llarga) + sus piezas
 * propias en build(G, K, B). Todo con el kit K (ver notes/arena.md «Sedes»): lo que se crea con él se libera al salir.
 * - Cielo azul tinta con estrellas y luna (uniformes uStars / uMoon del cielo de playa: 0 programas nuevos), sin nubes.
 * - Mar oscuro con la rielada de luna (uGlint del mar de playa) y la ola que rompe.
 * - Telón propio: dos promontorios violáceos que cierran la cala, torre de vigía en ruinas, ventanas cálidas en la ladera
 *   y la bocana del puerto con una luz roja y otra verde.
 * - 4 torres de focos de celosía en las esquinas (estática) con 6 cabezas cada una; guirnalda de farolillos de papel en
 *   catenaria alrededor de la arena; faroles de pie; chiringuito con tira de bombillas; 3 barcas de pesca de luz fondeadas.
 * - Arena horneada por vértice: clara bajo los focos y lila azulada fuera. Cinta lima, lonas azul marino con el tajo dorado.
 * - Luz de tensión: en punto de set los focos y la guirnalda bajan un 10 %; en la victoria un barrido recorre la guirnalda.
 * Dibujos (baja): cielo, telón, mar, arena, pista, lona, estática, público, red, marcador, halos y emisiva (sin nubes,
 * gaviotas ni barcas animadas). Media y alta: + tinta + haces de los focos + flashes de móvil.
 */
(function () {
  'use strict';
  var VB = window.VB; if (!VB || !VB.Arena || !VB.Arena.registerMap) return;
  var PI = Math.PI;

  var NIGHT = {
    sky: { zen: '#0f1438', hor: '#3a2a6b', fog: '#1a2452', sun: '#fff4d6' },
    sun: [-0.95, -0.27, 0.085],         // la luna: baja sobre el mar, a un lado del fondo rival (en el plano de saque)
    glintDir: [-0.99, -0.27, 0.022],     // la rielada sale hacia ella (más rasante para que caiga en el agua lejana)
    stars: 1, moon: 1, glint: '#9fc4ff', glintK: 0.85,
    hemi: 0xb8c0ec, ground: 0x6a6096, key: 0xf4f8ff, fill: 0xffcf6a, rim: 0x9fc4ff,
    keyK: 1.08, hemiK: 0.92, fillK: 0.9, rimK: 1.3, floorK: 0.64,
    near: 40, far: 160, haze: '#1a2452', hazeK: 0.2, crowdLight: 0.78,
    deep: '#0d2a4a', shal: '#1d4a6a', foam: '#cfe0ff', tint: '#ffffff',
    sand: [0.73, 0.66, 0.56]
  };
  var LANTERN = ['#ff6b5a', '#ffd23f', '#2fd6c9', '#ff7aa8', '#fff3dc'];
  var WARM = '#ffcf6a', HEAD = '#f4f8ff';
  var FL = { flashes: null, life: null, cones: null, halos: null, EU: null };

  /* ---------- telón: promontorios de la cala, torre de vigía, ventanas y la bocana ---------- */
  function backdrop(g, W, H, k, h) {
    var phi = h.phi, rnd = h.rnd, TAU = h.TAU;
    // perfil: lomas bajas tierra adentro, promontorios altos que cierran la cala y caen al agua a ±2,85 rad (mar a ±π)
    function prof(px) {
      var a = Math.abs(phi(px)), n = 0.5 + 0.3 * h.wav(px, 9, 0) + 0.2 * h.wav(px, 23, 1);
      if (a < 1.75) return 46 + 26 * n;
      if (a < 2.3) { var u = (a - 1.75) / 0.55; return 46 + 26 * n + u * u * (3 - 2 * u) * (58 + 18 * n); }
      if (a < 2.86) { var w = (a - 2.3) / 0.56; return (104 + 40 * n) * (1 - Math.pow(w, 1.6)) + 8 * n * (1 - w); }
      return 0;
    }
    function fillProf(color, sc, dy) {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, H);
      for (var x = 0; x <= W; x += 4) g.lineTo(x, H - (prof(x) * sc + dy) * k);
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    fillProf('#4a3f7a', 1, 1.5);          // filo de luna (arista clara)
    fillProf('#2a2350', 1, 0);            // masa de roca
    fillProf('#221d44', 0.62, -4);        // falda más oscura (ladera de abajo)
    // estratos y grietas de la roca (rayas oblicuas apenas más claras)
    g.strokeStyle = 'rgba(90,78,140,0.35)'; g.lineWidth = 1.2 * k;
    for (var i = 0; i < (h.hi ? 260 : 130); i++) {
      var x0 = rnd() * W, top = prof(x0); if (top < 20) continue;
      var y0 = H - top * k * (0.25 + rnd() * 0.65), L = (6 + rnd() * 14) * k;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + L * 0.8, y0 + L * 0.35); g.stroke();
    }
    // ventanas cálidas en la ladera de tierra adentro (pocas: un pueblo que duerme)
    for (var w2 = 0; w2 < (h.hi ? 70 : 36); w2++) {
      var wx = rnd() * W, a = Math.abs(phi(wx)); if (a > 1.6) continue;
      var wy = H - prof(wx) * k * (0.12 + rnd() * 0.5);
      g.fillStyle = rnd() < 0.8 ? '#ffcf6a' : '#ffe9b0'; g.fillRect(wx, wy, 2.2 * k, 2.6 * k);
    }
    // torre de vigía en ruinas en lo alto de un promontorio (lado y < 0 de la sim)
    var tx = 0, bd = 9;
    for (var sx = 0; sx < W; sx += 2) { var dd = Math.abs(phi(sx) - 2.15); if (dd < bd) { bd = dd; tx = sx; } }
    var tb = H - prof(tx) * k;
    g.fillStyle = '#2a2350'; g.fillRect(tx - 6 * k, tb - 22 * k, 12 * k, 23 * k);
    g.beginPath(); g.moveTo(tx - 6 * k, tb - 22 * k); g.lineTo(tx - 3 * k, tb - 27 * k); g.lineTo(tx + 1 * k, tb - 23 * k); g.lineTo(tx + 6 * k, tb - 25 * k); g.lineTo(tx + 6 * k, tb - 22 * k); g.fill();
    g.fillStyle = '#4a3f7a'; g.fillRect(tx - 6 * k, tb - 22 * k, 1.6 * k, 22 * k);
    g.fillStyle = '#141130'; g.fillRect(tx - 1.2 * k, tb - 15 * k, 2.4 * k, 4 * k);
    // bocana del puerto: espigón bajo y faro lejano con la luz roja (y < 0) y la verde (y > 0) al pie de los promontorios
    [[-2.8, '#ff4a3a'], [2.8, '#4dff8a']].forEach(function (e) {
      var fx = 0, best = 9;
      for (var s2 = 0; s2 < W; s2 += 2) { var d2 = Math.abs(phi(s2) - e[0]); if (d2 < best) { best = d2; fx = s2; } }
      var base = H - 9 * k;
      g.fillStyle = '#2a2350'; g.fillRect(fx - 26 * k * Math.sign(e[0]), base, 26 * k, 3 * k);
      g.fillStyle = '#e8e6f2'; g.fillRect(fx - 1.6 * k, base - 12 * k, 3.2 * k, 12 * k);
      var gr = g.createRadialGradient(fx, base - 13 * k, 0, fx, base - 13 * k, 7 * k); gr.addColorStop(0, e[1]); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(fx - 7 * k, base - 20 * k, 14 * k, 14 * k);
    });
    // pie fundido con la bruma de la noche
    g.globalCompositeOperation = 'source-atop';
    var fg = g.createLinearGradient(0, H * 0.5, 0, H); fg.addColorStop(0, 'rgba(26,36,82,0)'); fg.addColorStop(1, 'rgba(26,36,82,0.8)');
    g.fillStyle = fg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    void TAU;
  }

  /* ---------- arena horneada: clara bajo los focos, lila azulada fuera, franja mojada junto al agua ---------- */
  function sand(x, y, kk, wet) {
    var dx = Math.max(0, Math.abs(x) - 10), dy = Math.max(0, Math.abs(y) - 6), r = Math.hypot(dx * 0.85, dy);
    var lit = 1 - Math.min(1, Math.max(0, (r - 4) / 12)); lit = lit * lit * (3 - 2 * lit);
    var c0 = [0.9, 0.82, 0.7], c1 = [0.5, 0.48, 0.68], o = [];
    for (var i = 0; i < 3; i++) o.push((c1[i] + (c0[i] - c1[i]) * lit) * (0.94 + (kk - 0.93) * 0.8) * (1 - wet * (0.28 + i * 0.03)));
    return o;
  }

  /* ---------- piezas propias ---------- */
  function build(G, K, B) {
    var THREE = K.THREE, col = K.col, rnd = K.rnd, part = K.part, lrod = K.lrod, objM = K.objM, BG = K.BGEO, BOX = K.UNIT_BOX;
    var E = new K.Builder(), gl = [], halo = [], haloS = [];
    function glRange(v0, ph) { for (var v = v0; v < E.v; v++) gl[v] = ph; }
    function addHalo(x, y, z, s) { halo.push(x, z, -y); haloS.push(s); }
    var alu = col('#9aa6b4'), aluD = col('#6f7b8c'), dark = col('#2a2d3a'), head = col(HEAD), wood = col('#6e4a2e'), woodD = col('#4f3420'), cable = col('#2a2440');

    // 4 torres de focos de celosía en las esquinas (fuera de la zona libre y de las gradas)
    var TOW = [[-18.6, 12.6], [-18.6, -12.6], [19.4, 13.2], [19.4, -13.6]], cones = [], Ht = 12.5;
    TOW.forEach(function (T) {
      var tx = T[0], ty = T[1], dl = Math.hypot(tx, ty), fx = -tx / dl, fy = -ty / dl, yaw = Math.atan2(fx, -fy);
      objM(tx, ty, yaw, 1);
      var b0 = 0.75, b1 = 0.3, n = 8, C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (var c = 0; c < 4; c++) lrod(B, C4[c][0] * b0, 0, C4[c][1] * b0, C4[c][0] * b1, Ht, C4[c][1] * b1, 0.055, alu);
      for (var i = 0; i < n; i++) {
        var y0 = Ht * i / n, y1 = Ht * (i + 1) / n, w0 = b0 + (b1 - b0) * i / n, w1 = b0 + (b1 - b0) * (i + 1) / n;
        for (var j = 0; j < 4; j++) {
          var a = C4[j], b = C4[(j + 1) % 4], f = i % 2;
          lrod(B, (f ? a : b)[0] * w0, y0, (f ? a : b)[1] * w0, (f ? b : a)[0] * w1, y1, (f ? b : a)[1] * w1, 0.022, aluD);
          lrod(B, a[0] * w1, y1, a[1] * w1, b[0] * w1, y1, b[1] * w1, 0.025, alu);
        }
      }
      part(B, BOX, 0, 0.12, 0, dark, 0, 0, 0, 1.9, 0.24, 1.9);                         // zapata de hormigón
      part(B, BOX, 0, Ht, 0, alu, 0, 0, 0, 3.3, 0.1, 1.1);                              // plataforma
      lrod(B, -1.6, Ht + 0.05, -0.5, 1.6, Ht + 0.05, -0.5, 0.025, alu); lrod(B, -1.6, Ht + 0.55, -0.5, 1.6, Ht + 0.55, -0.5, 0.025, alu);
      var tilt = Math.atan2(Ht, dl * 0.75), sum = [0, 0, 0];
      for (var r = 0; r < 2; r++) for (var q = 0; q < 3; q++) {
        var lx = (q - 1) * 1.02, ly = Ht + 0.75 + r * 0.82, lz = 0.25 - r * 0.42;
        part(B, BOX, lx, ly, lz, dark, tilt, 0, 0, 0.84, 0.66, 0.34);                    // carcasa
        lrod(B, lx, ly - 0.42, lz - 0.08, lx, Ht + 0.05, lz - 0.3, 0.025, aluD);          // brazo
        var fz = lz + 0.18 * Math.cos(tilt), fyy = ly - 0.18 * Math.sin(tilt), v0 = E.v;
        part(E, BOX, lx, fyy, fz, head, tilt, 0, 0, 0.7, 0.52, 0.03);                    // cara del foco (emisiva)
        glRange(v0, -1);
        var sx = tx + lx * (-fy) + fz * fx, sy = ty + lx * fx + fz * fy;
        addHalo(sx, sy, fyy, 0.62 + rnd() * 0.1); sum[0] += sx; sum[1] += sy; sum[2] += fyy;
      }
      cones.push({ a: [sum[0] / 6, sum[1] / 6, sum[2] / 6], b: [tx * 0.18, ty * 0.25, 0], r0: 0.9, r1: 4.6 });
    });

    // guirnalda de farolillos de papel en catenaria (palos de madera; cables en la estática, farolillos en la emisiva)
    var gph = 0;
    function pole(x, y, h) { objM(0, 0, 0, 1); lrod(B, x, 0, -y, x, h, -y, 0.06, wood, BG.cyl); part(B, BG.sph6, x, h + 0.04, -y, woodD, 0, 0, 0, 0.08, 0.08, 0.08); }
    function span(x0, y0, x1, y1, h, sag) {
      objM(0, 0, 0, 1);
      var L = Math.hypot(x1 - x0, y1 - y0), ns = 8, n = Math.max(3, Math.round(L / 1.05)), px = x0, py = y0, pz = h;
      for (var s = 1; s <= ns; s++) {
        var t = s / ns, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t, cz = h - sag * 4 * t * (1 - t);
        lrod(B, px, pz, -py, cx, cz, -cy, 0.012, cable); px = cx; py = cy; pz = cz;
      }
      for (var i = 1; i < n; i++) {
        var u = i / n, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u, z = h - sag * 4 * u * (1 - u) - 0.2, c = col(LANTERN[(gph + i) % LANTERN.length]);
        part(B, BOX, x, z + 0.17, -y, cable, 0, 0, 0, 0.07, 0.05, 0.07);               // remate del farolillo
        var v0 = E.v; part(E, BG.sph6, x, z, -y, c, 0, rnd() * 3, 0, 0.16, 0.2, 0.16); glRange(v0, gph * 3 + i);
        addHalo(x, y, z, 0.2);
      }
      gph += n;
    }
    var GY = 11.4, GH = 4.3;
    [-1, 1].forEach(function (s) {
      var xs = [-17.2, -8.6, 0, 8.6, 17.2];
      xs.forEach(function (x) { pole(x, s * GY, GH); });
      for (var i = 0; i < xs.length - 1; i++) span(xs[i], s * GY, xs[i + 1], s * GY, GH, 0.62);
    });
    pole(-17.2, 0, GH);
    span(-17.2, -GY, -17.2, 0, GH, 0.7); span(-17.2, 0, -17.2, GY, GH, 0.7);
    span(17.2, GY, 24.0, 2.6, GH, 0.6); pole(24.0, 2.6, GH);                           // hacia el chiringuito

    // faroles de pie en el camino de la arena a las gradas
    [[12.6, 12.6], [15.8, 12.4], [-12.6, 12.6], [-12.6, -12.8], [12.6, -12.8], [22.4, -1.6], [22.4, -9.4]].forEach(function (p) {
      objM(0, 0, 0, 1);
      lrod(B, p[0], 0, -p[1], p[0], 1.45, -p[1], 0.035, dark, BG.cyl);
      part(B, BOX, p[0], 1.72, -p[1], dark, 0, 0, 0, 0.26, 0.05, 0.26); part(B, BG.cone4, p[0], 1.82, -p[1], dark, PI / 4, 0, 0, 0.22, 0.14, 0.22);
      var v0 = E.v; part(E, BOX, p[0], 1.58, -p[1], col(WARM), 0, 0, 0, 0.19, 0.24, 0.19); glRange(v0, -1);
      addHalo(p[0], p[1], 1.58, 0.36);
    });

    // chiringuito con tira de bombillas
    K.props.chiringuito(B, 25, -5.5, PI / 2 + 0.25);
    for (var bq = 0; bq < 9; bq++) { var v1 = E.v; part(E, BG.sph6, -2.0 + bq * 0.5, 2.62, -1.98, col(bq % 2 ? WARM : '#fff3dc'), 0, 0, 0, 0.07, 0.08, 0.07); glRange(v1, -1); }
    var v2 = E.v; part(E, BOX, 0, 1.9, 1.42, col('#ffcf6a'), 0, 0, 0, 2.6, 0.5, 0.02); glRange(v2, -1); // ventana del fondo (luz del interior)

    // barcas de pesca de luz fondeadas (quietas): casco de llaüt, caseta y lámpara de proa
    var HULL = ['#2f5d8a', '#8a3a32', '#2f7a6a'];
    [[-47, 15, 0.4], [-63, -7, -0.2], [-41, -23, 0.9]].forEach(function (b, i) {
      objM(b[0], b[1], b[2], 1.1);
      var hc = col(HULL[i]);
      part(B, BOX, 0, 0.18, 0, hc, 0, 0, 0, 3.6, 0.55, 1.2); part(B, BG.cone4, 2.1, 0.18, 0, hc, PI / 4, 0, -PI / 2, 0.64, 0.64, 0.64);
      part(B, BOX, 0.1, 0.47, 0, col('#f2c14e'), 0, 0, 0, 3.7, 0.07, 1.22);
      part(B, BOX, -0.7, 0.85, 0, col('#e8e6f2'), 0, 0, 0, 1.0, 0.7, 0.9);
      lrod(B, 1.5, 0.45, 0, 1.6, 2.4, 0, 0.035, col('#5a4632'));
      var v3 = E.v; part(E, BG.sph6, 1.62, 2.35, 0, col('#fff3c4'), 0, 0, 0, 0.16, 0.16, 0.16); glRange(v3, -1);
      // posición del farol en la sim: el objM gira en y (yaw) y escala 1,1
      var c = Math.cos(b[2]), s = Math.sin(b[2]);
      addHalo(b[0] + 1.62 * 1.1 * c, b[1] + 1.62 * 1.1 * s, 2.35 * 1.1, 0.75);
    });

    // rocas de la cala: peñascos en la orilla a los lados y las faldas de los promontorios (de cerca, con paralaje)
    var R1 = col('#3a3166'), R2 = col('#2a2350'), R3 = col('#4a3f7a');
    [[-26, 31, 3.2], [-23, -33, 2.6], [-30, 24, 1.6], [-28, -27, 1.9], [-21, 38, 2.2], [32, 22, 2.8], [34, -24, 3.0]].forEach(function (r) {
      objM(r[0], r[1], rnd() * 6, 1);
      part(B, BG.sph, 0, -0.2 * r[2], 0, R1, 0, 0, 0.2, r[2] * 1.3, r[2] * 0.75, r[2]);
      part(B, BG.sph, r[2] * 0.6, -0.1, r[2] * 0.4, R3, 0, 0.5, 0, r[2] * 0.6, r[2] * 0.5, r[2] * 0.55);
    });
    [[-70, 70, 26], [-95, 58, 30], [-60, -72, 24], [-88, -62, 32], [-118, 44, 22], [-112, -48, 26]].forEach(function (r) {
      objM(r[0], r[1], rnd() * 6, 1);
      part(B, BG.sph, 0, -r[2] * 0.25, 0, R2, 0, 0, 0, r[2] * 1.1, r[2] * 0.75, r[2] * 0.9);
      part(B, BG.sph, r[2] * 0.5, r[2] * 0.1, r[2] * 0.2, R1, 0, 0.7, 0, r[2] * 0.55, r[2] * 0.55, r[2] * 0.5);
    });
    // pinos en la ladera de tierra adentro
    [[25, 16, 7.4], [29, -15, 8.2], [31, 6, 7.0], [23, -19, 6.8], [35, -4, 8.6]].forEach(function (p) { K.props.pine(B, p[0], p[1], p[2], rnd() * 6); });

    // emisiva: focos, farolillos, faroles, bombillas, ventanas y lámparas de las barcas (1 dibujo, sin tono; barrido en el shader)
    var eg = E.build(), ga = new Float32Array(eg.attributes.position.count);
    for (var gi = 0; gi < ga.length; gi++) ga[gi] = gl[gi] == null ? -1 : gl[gi];
    eg.setAttribute('aGl', new THREE.BufferAttribute(ga, 1));
    var EU = FL.EU = { uK: { value: 1 }, uW: { value: 0 }, uT: { value: 0 } };
    var em = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
    em.onBeforeCompile = function (sh) {
      sh.uniforms.uK = EU.uK; sh.uniforms.uW = EU.uW; sh.uniforms.uT = EU.uT;
      sh.vertexShader = 'attribute float aGl; varying float vGl;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGl = aGl;');
      sh.fragmentShader = 'uniform float uK; uniform float uW; uniform float uT; varying float vGl;\n' + sh.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n float vbG = step(0.0, vGl); float vbS = fract(vGl * 0.012 - uT * 0.32) - 0.5; vbS = exp(-vbS * vbS * 70.0);\n' +
        ' diffuseColor.rgb *= uK * (1.0 + vbG * uW * (0.85 * vbS + 0.15 * sin(uT * 5.0 + vGl * 1.7)));');
    };
    em.customProgramCacheKey = function () { return 'vb-fanals-emis'; };
    var emesh = new THREE.Mesh(eg, em); emesh.name = 'fanalsEmissive'; emesh.frustumCulled = false; G.add(emesh);

    // halos de los focos, farolillos y lámparas (1 dibujo)
    var hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(halo, 3)); hg.setAttribute('aS', new THREE.Float32BufferAttribute(haloS, 1));
    var hm = K.haloMaterial(K.radialTex([[0, 'rgba(240,246,255,0.8)'], [0.2, 'rgba(210,225,255,0.26)'], [1, 'rgba(200,215,255,0)']]));
    var hp = FL.halos = new THREE.Points(hg, hm); hp.name = 'fanalsHalos'; hp.frustumCulled = false; G.add(hp);

    // haces de los focos (media y alta)
    var cm = FL.cones = K.coneMesh(cones, HEAD, 0.03); cm.name = 'fanalsCones'; G.add(cm);

    // flashes de móvil en la grada (media y alta): el material de los flashes del pabellón (mismo programa)
    var seats = K.seats || [], NF = Math.min(48, seats.length), fp = new Float32Array(NF * 3), fc = new Float32Array(NF * 3);
    for (var f = 0; f < NF; f++) { var st = seats[Math.floor(rnd() * seats.length)], tv = new THREE.Vector3(); VB.toThree(st.x, st.y, st.z + 0.95, tv); fp[f * 3] = tv.x; fp[f * 3 + 1] = tv.y; fp[f * 3 + 2] = tv.z; }
    var fgm = new THREE.BufferGeometry(); fgm.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fgm.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    var fl = FL.flashes = new THREE.Points(fgm, new THREE.PointsMaterial({ size: 0.7, map: K.radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(220,235,255,0.5)'], [1, 'rgba(200,220,255,0)']]),
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    fl.name = 'fanalsFlashes'; fl.frustumCulled = false; G.add(fl); FL.life = new Float32Array(NF);
  }

  function quality(q) {
    var hi = q && q.rank >= 1;
    if (FL.cones) FL.cones.visible = hi;
    if (FL.flashes) FL.flashes.visible = hi;
  }

  function step(t, rdt, g, K) {
    var M = K.mood(), soft = K.soft();
    if (FL.EU) { FL.EU.uT.value = t % 3600; FL.EU.uK.value = 1 - 0.1 * M.tense; FL.EU.uW.value = M.win * soft; }
    if (FL.halos) FL.halos.material.uniforms.opacity.value = (1 - 0.1 * M.tense) * (1 + 0.25 * M.pf * soft);
    if (FL.cones) FL.cones.material.uniforms.k.value = 0.03 * (1 - 0.1 * M.tense) * (1 + 0.5 * M.win);
    var fl = FL.flashes; if (!fl || !fl.visible) return;
    var colr = fl.geometry.attributes.color.array, life = FL.life, n = life.length, any = false, sf = soft < 1;
    var dur = sf ? 0.3 : 0.08, amp = (sf ? 0.3 : 0.75), p = (0.5 + 1.6 * M.pf + 0.8 * M.win) * rdt * (sf ? 0.4 : 1);
    for (var i = 0; i < n; i++) {
      if (life[i] <= 0 && Math.random() < p / n * 5) life[i] = dur;
      var v = 0;
      if (life[i] > 0) { life[i] -= rdt; var u = life[i] / dur; v = u > 0 ? amp * (sf ? Math.sin(u * Math.PI) : u) : 0; }
      if (colr[i * 3] !== v) { colr[i * 3] = colr[i * 3 + 1] = colr[i * 3 + 2] = v; any = true; }
    }
    if (any) fl.geometry.attributes.color.needsUpdate = true;
  }

  function dispose() { FL.flashes = FL.life = FL.cones = FL.halos = FL.EU = null; }

  VB.Arena.registerMap({
    id: 'fanals', kind: 'beach', seed: 7712031,
    P: {
      looks: { noche: NIGHT },
      clouds: false, gulls: false, boats: false, surf: 1,
      tape: '#d7ff3a', tapeEdge: 'rgba(30,40,12,0.6)', attackCord: 'rgba(200,240,60,0.5)',
      brand: { name: 'CALA DELS FANALS', fg: '#e8c14a', bg: ['#141a3e', '#1b2350'], deco: 'cut' },
      bannerBg: ['#141a3e', '#1b2350'], bannerFg: '#ffffff', bannerCut: '#e8c14a', bannerHem: 'rgba(232,193,74,0.75)', bannerFrame: '#9aa6b4',
      bcol: { canA: '#1b2350', canB: '#e8c14a', coral: '#e8c14a', padA: '#1b2350', padW: '#e8c14a', netTop: '#e8c14a', post: '#4a4f62', bag: '#3a3f6a' },
      stands: { frame: '#5a6688', can: ['#f4f2ec', '#8a6cff', '#2fb6c9'] },
      score: { frame: '#e8c14a', cab: '#1b2350', top: '#1b2350', cut: '#e8c14a' },
      crowd: { shirts: ['#ff8a6e', '#ffe066', '#5fe0f0', '#ff9cc0', '#9be88a', '#ffffff', '#8aa6ff', '#ffc870', '#7c5cff', '#3fd0ff', '#c9a8ff'], hatP: 0 },
      benchUmbrella: false,
      props: function () { },     // sin palmeras, sombrillas ni dunas: la cala tiene lo suyo (build)
      sand: sand, sandTile: '#eed9b6',
      backdrop: backdrop
    },
    build: build, quality: quality, step: step, dispose: dispose
  });
})();
