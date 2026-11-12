/* VOLEY 3D — js/venue-cupula.js (owner: arena)
 * Sede de pabellón «Cúpula del Far» (12-nov-2026): la arena de espectáculo DE NOCHE de las finales. Sala en penumbra, pista
 * dorada bajo los focos, aro LED cian alrededor del cuenco y, colgado en el centro, un «faro»: linterna-marcador de 8 caras con
 * lentes cuyos haces barren la grada (guiño mediterráneo al Palau del Mar). En la Carrera de pista, finales y clubes de élite.
 *
 * Es una PIEL de Palau (notes/arena.md «Sedes»): reutiliza grada, público, vallas LED, banderas, videomarcadores de los fondos
 * y flashes; repinta la tarima (def.floor), las vallas (def.brands), los estandartes (def.flagPal) y la cabecera de los
 * marcadores (def.screen) en los MISMOS lienzos; recolorea los asientos y la línea de luz del antepecho (K.staticTint) y aplasta
 * las cerchas, el anillo de focos y la caja del marcador colgado de la estática de Palau (K.staticHide). Todo vuelve al salir.
 * Sustituye (def.hide) el cascarón (hallShell), el marcador colgado (hungScreens), banderolas, rótulo, halos y haces de Palau:
 * - `cupulaDome` (1 dibujo, shader propio sin luces, baja con la luz de la grada): paredes, cúpula de paneles hexagonales con
 *   nervios y perforaciones de estrella, óculo encendido, y el utillaje sin luces (cuerpo del faro, linterna, cubierta, péndolas
 *   y el anillo de focos) con el sombreado horneado por cara, como el cascarón de Palau.
 * - `cupulaScreens` (1 dibujo): las 4 caras del faro con el marcador colgado de Palau (su lienzo y su material LED compartidos:
 *   destello del punto y apagado bajo el HUD incluidos).
 * - `cupulaGlow` (1 dibujo, sin tono): aro LED en los muros traseros de las 4 gradas (persecución lenta; 1,5 s del color del que
 *   anota), lentes y linterna del faro, cabezas del anillo de focos.
 * - `cupulaHalos` (1 dibujo): halos del anillo de focos y de la linterna.
 * - `cupulaBeams` (media y alta): 6 haces que salen de las lentes del faro y barren la grada (más deprisa en punto de set).
 * Dibujos: en baja 4 en el sitio de 5 de Palau; en media/alta +haces en el sitio de los de Palau (−1 neto).
 */
(function () {
  'use strict';
  var VB = window.VB; if (!VB || !VB.Arena || !VB.Arena.registerMap) return;
  var PI = Math.PI, TAU = 2 * PI;

  // ---------- medidas (sim: x a lo largo de la pista, y a lo ancho, z arriba) ----------
  var HB = 18.5, DH = 9.5;        // arranque de la cúpula (alto de las paredes) y flecha
  var FHW = 2.45, FCH = 0.6, FZ = 11.4, FH = 2.5; // faro: medio ancho, chaflán, centro de las pantallas, alto del cuerpo
  var LR = 11.5, LZ = 17.2, NL = 12; // anillo de focos: radio, altura, focos
  var SCR_W = 2 * (FHW - FCH) - 0.16, SCR_H = SCR_W * 9 / 16;

  // ---------- paleta ----------
  var PALC = {
    surround: '#140f36', free: '#1c1648', fan: '#2e2676', court: '#ebc863', attack: '#dfba55', edge: '#2a2150',
    body: '#2a2a3a', bodyD: '#1d1d2a', gold: '#e8c14a', goldD: '#b8923a', truss: '#2e2a4a', wall: '#1a1640', wallE: '#181438',
    lens: '#bfefff', lamp: '#fff1c8', head: '#fff3e0', led: '#39e0ff', ledB: '#ff4fa0'
  };
  // asientos: degradado por bloques de azul noche a violeta (los 6 bloques de color de Palau)
  var SEATS = ['#1e2a5a', '#2a2f78', '#3a2f8a', '#4a3596', '#5a3fa0', '#33348a'];
  var BEAM_K = 0.034;
  var CU = { glowU: null, halos: null, cones: null, ph: 0, ringT: 0, ringTeam: 0, pfWas: 0 };

  /* ---------- suelo: zona libre añil con el abanico del faro, pista dorada con barniz brillante ---------- */
  function floor(g, h) {
    var X = h.X, Y = h.Y, rect = h.rect, ppm = h.ppm, C = h.C;
    g.fillStyle = PALC.surround; g.fillRect(0, 0, h.W, h.H);
    g.fillStyle = PALC.free; rect(-h.FZX, -h.FZY, h.FZX, h.FZY);
    // abanico del haz del faro: rayos desde el centro de la pista (se ven en la zona libre, alrededor de la pista)
    g.save(); g.beginPath(); g.rect(X(-h.FZX), Y(h.FZY), 2 * h.FZX * ppm, 2 * h.FZY * ppm); g.clip();
    g.fillStyle = PALC.fan; var R = 40 * ppm;
    for (var k = 0; k < 16; k++) {
      var a0 = k * TAU / 16 + 0.06, a1 = a0 + TAU / 32;
      g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(0) + Math.cos(a0) * R, Y(0) - Math.sin(a0) * R); g.lineTo(X(0) + Math.cos(a1) * R, Y(0) - Math.sin(a1) * R); g.closePath(); g.fill();
    }
    g.restore();
    // pista y zona de ataque
    g.fillStyle = PALC.court; rect(-C.HL, -C.HW, C.HL, C.HW);
    g.fillStyle = PALC.attack; rect(-C.ATTACK, -C.HW, C.ATTACK, C.HW);
    // barniz brillante: franjas diagonales claras (más marcadas que en Palau)
    g.save(); g.beginPath(); g.rect(X(-C.HL), Y(C.HW), 2 * C.HL * ppm, 2 * C.HW * ppm); g.clip(); g.fillStyle = 'rgba(255,252,238,0.14)';
    for (var gl = -1; gl <= 1; gl += 2) {
      var gx = X(gl * 4.6);
      g.beginPath(); g.moveTo(gx - 0.6 * ppm, Y(C.HW)); g.lineTo(gx + 0.5 * ppm, Y(C.HW)); g.lineTo(gx - 1.9 * ppm, Y(-C.HW)); g.lineTo(gx - 3.0 * ppm, Y(-C.HW)); g.fill();
      g.beginPath(); g.moveTo(gx + 0.9 * ppm, Y(C.HW)); g.lineTo(gx + 1.2 * ppm, Y(C.HW)); g.lineTo(gx - 1.2 * ppm, Y(-C.HW)); g.lineTo(gx - 1.5 * ppm, Y(-C.HW)); g.fill();
    }
    g.restore();
    // logotipos de la sede en la zona libre: nombre y la estrella de 8 puntas dorada
    g.save(); g.fillStyle = 'rgba(232,193,74,0.34)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 ' + Math.round(1.0 * ppm) + 'px ' + h.FONT;
    for (var s = -1; s <= 1; s += 2) { g.save(); g.translate(X(s * 12.6), Y(0)); g.rotate(-s * PI / 2); g.fillText('CÚPULA DEL FAR', 0, 0); g.restore(); }
    g.font = '900 ' + Math.round(1.25 * ppm) + 'px ' + h.FONT; g.fillText('CÚPULA  DEL  FAR', X(0), Y(-7.2));
    for (var e = -1; e <= 1; e += 2) star8(g, X(e * 15.4), Y(8.4), 0.9 * ppm, 'rgba(232,193,74,0.42)');
    g.restore();
    // filo oscuro de las líneas (se leen sobre el oro) y de la pista: las líneas blancas las pinta arena.js encima
    g.fillStyle = PALC.edge; var L = 0.05, q = 0.025, HL = C.HL, HW = C.HW, A = C.ATTACK;
    rect(-HL - q, HW - L - q, HL + q, HW + q); rect(-HL - q, -HW - q, HL + q, -HW + L + q);
    rect(-HL - q, -HW - q, -HL + L + q, HW + q); rect(HL - L - q, -HW - q, HL + q, HW + q);
    rect(-L / 2 - q, -HW, L / 2 + q, HW);
    rect(A - L - q, -HW, A + q, HW); rect(-A - q, -HW, -A + L + q, HW);
  }
  function star8(g, x, y, r, col) {
    g.fillStyle = col; g.beginPath();
    for (var i = 0; i < 16; i++) { var a = -PI / 2 + i * PI / 8, rr = i % 2 ? r * 0.42 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }

  /* ---------- cúpula: shader del cascarón de Palau con paneles hexagonales ----------
   * uv.x = tipo: 0 utillaje (color por vértice con el sombreado horneado), 1 cúpula (aP = coordenadas de panel: vuelta y
   * meridiano), 2 paredes, 3 óculo (aP.y = distancia al centro 0..1). Todo baja con la luz de la grada salvo el óculo. */
  var DOME_VS = [
    'attribute vec2 aP; varying vec3 vC; varying vec3 vW; varying float vK; varying vec2 vP;',
    '#include <fog_pars_vertex>',
    'void main(){ vC = color; vK = uv.x; vP = aP; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;',
    ' vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;',
    '#include <fog_vertex>',
    '}'].join('\n');
  var DOME_FS = [
    'uniform float uCrowdLight; uniform float uOc; varying vec3 vC; varying vec3 vW; varying float vK; varying vec2 vP;',
    '#include <fog_pars_fragment>',
    'float vbHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'void main(){',
    ' vec3 c = vC; float house = mix(1.0, uCrowdLight, 0.75);',
    ' if (vK > 0.5 && vK < 1.5) {',
    // rejilla hexagonal (celdas de 1 x 1,732 en coordenadas de panel): centro más cercano de dos rejillas desplazadas
    '  vec2 r = vec2(1.0, 1.7320508); vec2 hh = r * 0.5; vec2 a = mod(vP, r) - hh; vec2 b = mod(vP - hh, r) - hh;',
    '  vec2 gv = dot(a, a) < dot(b, b) ? a : b; vec2 id = vP - gv; vec2 ag = abs(gv);',
    '  float hd = 0.5 - max(dot(ag, vec2(0.5, 0.8660254)), ag.x);',
    '  float fw = fwidth(hd); float seamK = 1.0 - smoothstep(0.08, 0.3, fwidth(vP.x) + fwidth(vP.y));',
    '  float seam = mix(1.0, 0.45 + 0.55 * smoothstep(0.0, fw * 1.5 + 0.03, hd), seamK);',
    '  float t = clamp((vW.y - ' + HB.toFixed(2) + ') / ' + DH.toFixed(2) + ', 0.0, 1.0);',
    '  vec3 base = mix(vec3(0.118, 0.094, 0.314), vec3(0.043, 0.035, 0.125), t);',
    '  float tone = 0.84 + 0.3 * vbHash(id);',
    // nervios: cada 6 celdas de vuelta, una línea violeta clara (con fwidth)
    '  float rq = abs(fract(vP.x / 6.0 + 0.5) - 0.5) * 6.0; float rib = (1.0 - smoothstep(0.04, 0.04 + fwidth(vP.x) * 1.5, rq)) * seamK;',
    '  c = base * tone * seam * house; c = mix(c, vec3(0.23, 0.18, 0.54) * house, rib * 0.8);',
    // perforaciones de estrella: 1 de cada ~8 celdas, un punto frío en el centro (sin luz de la grada: brillan siempre)
    '  float st = step(0.87, vbHash(id + 7.31)); float sd = length(gv); float sw = fwidth(sd);',
    '  c += vec3(0.75, 0.94, 1.0) * st * (1.0 - smoothstep(0.05, 0.05 + sw * 1.5 + 0.01, sd)) * (0.35 + 0.35 * vbHash(id + 2.1)) * seamK;',
    // reflejo del cuenco iluminado en el arranque de la cúpula
    '  c += vec3(0.16, 0.12, 0.36) * exp(-t * 4.0) * 0.35 * house;',
    ' } else if (vK > 1.5 && vK < 2.5) {',
    '  float y = vW.y; float top = smoothstep(9.0, ' + HB.toFixed(2) + ', y);',
    // derrame cian del aro LED de las gradas en la pared de detrás
    '  float spill = exp(-abs(y - 10.2) * 0.7);',
    '  c = vC * (0.75 + 0.45 * top) * house + vec3(0.13, 0.62, 0.78) * spill * 0.07;',
    ' } else if (vK > 2.5) {',
    '  c = vec3(1.0, 0.92, 0.74) * (0.55 + 0.25 * (1.0 - vP.y)) * uOc;',
    ' } else { c *= house; }',
    ' gl_FragColor = vec4(c, 1.0);',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    '#include <fog_fragment>',
    '}'].join('\n');

  function build(G, K) {
    var THREE = K.THREE, col = K.col, AT = K.at, rnd = K.rnd, X = AT.HALL_X, Y = AT.HALL_Y;
    var c = {}; for (var k0 in PALC) c[k0] = col(PALC[k0]);
    var v = new THREE.Vector3();

    // ---- piel de Palau: asientos y línea de luz del antepecho recoloreados; fuera cerchas, anillo de focos y caja del marcador ----
    var seatC = SEATS.map(col);
    K.staticTint('seat', function (x) { return x ? seatC[x.b % seatC.length] : null; });
    var cove = col(PALC.led).multiplyScalar(0.72);
    K.staticTint('cove', function () { return cove; });
    K.staticHide(['truss', 'lampRing', 'hung']);

    /* ---- malla de la cúpula (paredes, cúpula, óculo y utillaje sin luces) ---- */
    var P = [], CC = [], UV = [], AP = [], I = [], n = 0, cc = new THREE.Color();
    function vert(x, y, z, colr, kind, px, py) { VB.toThree(x, y, z, v); P.push(v.x, v.y, v.z); CC.push(colr.r, colr.g, colr.b); UV.push(kind, 0); AP.push(px || 0, py || 0); return n++; }
    // cara plana (puntos en sim, antihorario visto desde fuera de la cara visible), sombreado horneado k
    function face(pts, colr, k, kind) {
      cc.copy(colr).multiplyScalar(k); var b = n;
      for (var i = 0; i < pts.length; i++) vert(pts[i][0], pts[i][1], pts[i][2], cc, kind || 0);
      for (var j = 1; j < pts.length - 1; j++) I.push(b, b + j, b + j + 1);
    }
    function shadeSide(nx, ny) { return 0.5 + 0.16 * (nx * 0.6 - ny * 0.8); } // luz que rebota de la pista, algo más por un lado
    /** Prisma de sección poligonal (pts en sim, antihorario visto desde arriba) entre z0 (escala s0) y z1 (escala s1). */
    function prism(pts, cx, cy, z0, z1, s0, s1, colr, caps) {
      var m = pts.length;
      for (var i = 0; i < m; i++) {
        var p = pts[i], q = pts[(i + 1) % m], nx = q[1] - p[1], ny = -(q[0] - p[0]), L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
        face([[cx + p[0] * s0, cy + p[1] * s0, z0], [cx + q[0] * s0, cy + q[1] * s0, z0], [cx + q[0] * s1, cy + q[1] * s1, z1], [cx + p[0] * s1, cy + p[1] * s1, z1]], colr, shadeSide(nx, ny));
      }
      if (caps !== false) {
        var bot = [], top = [];
        for (var j = m - 1; j >= 0; j--) bot.push([cx + pts[j][0] * s0, cy + pts[j][1] * s0, z0]);
        for (var k = 0; k < m; k++) top.push([cx + pts[k][0] * s1, cy + pts[k][1] * s1, z1]);
        face(bot, colr, 1.0); face(top, colr, 0.35); // abajo la ilumina la pista; arriba, en penumbra
      }
    }
    function ngon(r, m, rot) { var o = []; for (var i = 0; i < m; i++) { var a = (rot || 0) + i * TAU / m; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; }
    function box(x0, x1, y0, y1, z0, z1, colr) { prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0, 0, z0, z1, 1, 1, colr); }
    function rod(ax, ay, az, bx, by, bz, r, colr) { // varilla cuadrada vertical o casi (péndolas)
      var m = 4, pts = ngon(r, m, PI / 4), dx = bx - ax, dy = by - ay;
      for (var i = 0; i < m; i++) {
        var p = pts[i], q = pts[(i + 1) % m], nx = q[1] - p[1], ny = -(q[0] - p[0]), L = Math.hypot(nx, ny); nx /= L; ny /= L;
        face([[ax + p[0], ay + p[1], az], [ax + q[0], ay + q[1], az], [ax + dx + q[0], ay + dy + q[1], bz], [ax + dx + p[0], ay + dy + p[1], bz]], colr, shadeSide(nx, ny));
      }
    }

    // paredes (caras hacia dentro): el cuadro del pabellón de Palau hasta el arranque de la cúpula
    function wall(a, b, colr) { var b0 = n; vert(a[0], a[1], 0, colr, 2); vert(b[0], b[1], 0, colr, 2); vert(b[0], b[1], HB, colr, 2); vert(a[0], a[1], HB, colr, 2); I.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); }
    wall([-X, Y], [X, Y], c.wall); wall([X, -Y], [-X, -Y], c.wall); wall([X, Y], [X, -Y], c.wallE); wall([-X, -Y], [-X, Y], c.wallE);

    // cúpula: anillos que pasan del rectángulo de las paredes (arranque) a una elipse (arriba), 32 puntos por vuelta
    var NS = 8, RING = [];
    (function () {
      var side = [[-X, -Y, X, -Y], [X, -Y, X, Y], [X, Y, -X, Y], [-X, Y, -X, -Y]];
      for (var s = 0; s < 4; s++) for (var j = 0; j < NS; j++) { var t = j / NS, sd = side[s]; RING.push([sd[0] + (sd[2] - sd[0]) * t, sd[1] + (sd[3] - sd[1]) * t]); }
      RING.push(RING[0].slice());
    })();
    var NRG = 9, PHI1 = 1.32, NU = 48, arc = 0, rows = [], prevP = null;
    for (var r = 0; r <= NRG; r++) {
      var ph = PHI1 * r / NRG, s = Math.cos(ph), z = HB + DH * Math.sin(ph), w = Math.pow(1 - s, 0.6), row = [];
      for (var i = 0; i < RING.length; i++) {
        var px = RING[i][0], py = RING[i][1], th = Math.atan2(py / Y, px / X), ex = X * 1.02 * Math.cos(th), ey = Y * 1.02 * Math.sin(th);
        row.push([s * (px + (ex - px) * w), s * (py + (ey - py) * w), z]);
      }
      if (prevP) { var d = 0; for (var q = 0; q < 4; q++) { var a1 = row[q * NS], a0 = prevP[q * NS]; d += Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]); } arc += d / 4; }
      prevP = row; rows.push({ pts: row, v: arc / 1.85 });
    }
    var dv = [];
    for (var r2 = 0; r2 <= NRG; r2++) { var R0 = []; for (var i2 = 0; i2 < RING.length; i2++) { var p2 = rows[r2].pts[i2]; R0.push(vert(p2[0], p2[1], p2[2], c.wall, 1, NU * i2 / (RING.length - 1), rows[r2].v)); } dv.push(R0); }
    for (var r3 = 0; r3 < NRG; r3++) for (var i3 = 0; i3 < RING.length - 1; i3++) {
      var A0 = dv[r3][i3], A1 = dv[r3][i3 + 1], B0 = dv[r3 + 1][i3], B1 = dv[r3 + 1][i3 + 1];
      I.push(A0, B0, B1, A0, B1, A1); // vista desde dentro (abajo)
    }
    // óculo: abanico encendido en lo alto
    var top = rows[NRG].pts, zt = top[0][2] + 0.25, oc = vert(0, 0, zt, c.lamp, 3, 0, 0), ocR = [];
    for (var i4 = 0; i4 < RING.length; i4++) ocR.push(vert(top[i4][0], top[i4][1], top[i4][2], c.lamp, 3, 0, 1));
    for (var i5 = 0; i5 < RING.length - 1; i5++) I.push(oc, ocR[i5 + 1], ocR[i5]);
    // aro de remate del óculo (utillaje dorado oscuro)
    for (var i6 = 0; i6 < RING.length - 1; i6++) {
      var t0 = top[i6], t1 = top[i6 + 1];
      face([[t0[0], t0[1], t0[2] - 0.35], [t1[0], t1[1], t1[2] - 0.35], [t1[0], t1[1], t1[2] + 0.02], [t0[0], t0[1], t0[2] + 0.02]], c.goldD, 0.7);
    }
    // cornisa del arranque de la cúpula (perfil dorado oscuro a lo largo de las 4 paredes)
    [[-X, -Y, X, -Y + 0.5], [-X, Y - 0.5, X, Y], [-X, -Y, -X + 0.5, Y], [X - 0.5, -Y, X, Y]].forEach(function (b) { box(b[0], b[2], b[1], b[3], HB - 0.4, HB, c.goldD); });

    // ---- el faro: cuerpo de 8 caras (4 pantallas y 4 lentes), remates dorados, linterna, cubierta y péndolas ----
    var OCT = [[FHW, -FHW + FCH], [FHW, FHW - FCH], [FHW - FCH, FHW], [-FHW + FCH, FHW], [-FHW, FHW - FCH], [-FHW, -FHW + FCH], [-FHW + FCH, -FHW], [FHW - FCH, -FHW]];
    var z0 = FZ - FH / 2, z1 = FZ + FH / 2;
    prism(OCT, 0, 0, z0, z1, 1, 1, c.body);
    prism(OCT, 0, 0, z0 - 0.7, z0, 0.62, 1, c.bodyD);                 // base en tronco de cono
    prism(OCT, 0, 0, z0 - 0.12, z0, 1.04, 1.04, c.gold);              // remates dorados
    prism(OCT, 0, 0, z1, z1 + 0.14, 1.06, 1.06, c.gold);
    prism(OCT, 0, 0, z1 + 0.14, z1 + 0.3, 1.12, 1.0, c.bodyD);       // cornisa
    var LAN = ngon(1.25, 8, PI / 8), lz0 = z1 + 0.3, lz1 = lz0 + 1.15;
    for (var mu = 0; mu < 8; mu++) { var mp = LAN[mu]; box(mp[0] - 0.07, mp[0] + 0.07, mp[1] - 0.07, mp[1] + 0.07, lz0, lz1, c.bodyD); } // montantes de la linterna
    prism(ngon(1.45, 8, PI / 8), 0, 0, lz1, lz1 + 0.12, 1, 1, c.gold);
    prism(ngon(1.45, 8, PI / 8), 0, 0, lz1 + 0.12, lz1 + 1.0, 1, 0.12, c.body);   // cubierta
    prism(ngon(0.16, 6), 0, 0, lz1 + 1.0, lz1 + 1.45, 1, 0.3, c.gold);              // remate
    var zr = HB + DH * Math.sin(PHI1) - 0.2;
    [[1.6, 1.6], [-1.6, 1.6], [1.6, -1.6], [-1.6, -1.6]].forEach(function (p) { rod(p[0], p[1], z1 + 0.3, p[0] * 0.6, p[1] * 0.6, zr - 2.0, 0.035, c.truss); });
    // anillo de focos alrededor del faro (celosía de dos cordones) con 12 cabezas y sus péndolas
    var NSEG = 24;
    for (var sg = 0; sg < NSEG; sg++) {
      var aa = sg * TAU / NSEG, ab = (sg + 1) * TAU / NSEG;
      [LR - 0.22, LR + 0.22].forEach(function (rr) {
        var pa = [Math.cos(aa) * rr, Math.sin(aa) * rr], pb = [Math.cos(ab) * rr, Math.sin(ab) * rr], tq = 0.07;
        var nx = Math.cos((aa + ab) / 2) * tq, ny = Math.sin((aa + ab) / 2) * tq;
        prism([[pa[0] - nx, pa[1] - ny], [pb[0] - nx, pb[1] - ny], [pb[0] + nx, pb[1] + ny], [pa[0] + nx, pa[1] + ny]], 0, 0, LZ - 0.07, LZ + 0.07, 1, 1, c.truss, false);
      });
    }
    var lamps = [];
    for (var li = 0; li < NL; li++) {
      var la = (li + 0.5) * TAU / NL, lx = Math.cos(la) * LR, ly = Math.sin(la) * LR;
      prism(ngon(0.34, 8), lx, ly, LZ - 0.55, LZ - 0.1, 1, 1, c.bodyD);
      rod(lx, ly, LZ + 0.07, lx * 0.9, ly * 0.9, zr - 3.5, 0.025, c.truss);
      lamps.push([lx, ly, LZ - 0.56]);
    }
    var dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); dg.setAttribute('color', new THREE.Float32BufferAttribute(CC, 3));
    dg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); dg.setAttribute('aP', new THREE.Float32BufferAttribute(AP, 2));
    dg.setIndex(I); dg.computeBoundingSphere();
    var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCrowdLight: { value: 1 }, uOc: { value: 1 } }]);
    U.uCrowdLight = K.crowdLight; CU.domeU = U; // el mismo objeto que la grada
    var dm = new THREE.ShaderMaterial({ uniforms: U, vertexShader: DOME_VS, fragmentShader: DOME_FS, vertexColors: true, fog: true });
    dm.extensions.derivatives = true;
    var dome = new THREE.Mesh(dg, dm); dome.name = 'cupulaDome'; dome.frustumCulled = false; G.add(dome);

    /* ---- pantallas del faro: el marcador colgado de Palau en las 4 caras rectas ---- */
    if (K.hungMat) {
      var SP = [], SU = [], SI = [];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (nn) {
        var nx = nn[0], ny = nn[1], rx = -ny, ry = nx, d = FHW + 0.02, b = SP.length / 3;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
          VB.toThree(nx * d + rx * q[0] * SCR_W / 2, ny * d + ry * q[0] * SCR_W / 2, FZ + q[1] * SCR_H / 2, v); SP.push(v.x, v.y, v.z);
          SU.push(q[0] < 0 ? 0 : 1, q[1] < 0 ? 0 : 1);
        });
        SI.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
      var sg2 = new THREE.BufferGeometry(); sg2.setAttribute('position', new THREE.Float32BufferAttribute(SP, 3)); sg2.setAttribute('uv', new THREE.Float32BufferAttribute(SU, 2));
      sg2.setIndex(SI); sg2.computeBoundingSphere();
      var sm = new THREE.Mesh(sg2, K.hungMat); sm.userData.sharedMat = true; sm.name = 'cupulaScreens'; G.add(sm);
    }

    /* ---- emisiva: aro LED de las gradas, lentes y linterna del faro, cabezas de los focos ---- */
    var E = new K.Builder();
    function glowBox(x0, x1, y0, y1, z0, z1, colr) { E.sbox(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, colr); }
    var led = col(PALC.led).multiplyScalar(0.78), ledB = col(PALC.ledB).multiplyScalar(0.7);
    // aro: dos cintas en el remate de los muros traseros de las gradas (laterales a y = ±24,4; fondos a x = ±28,2)
    var YB = 24.4, XB = 28.2, LX = 28, EY = 11.6, along = 0, TL = [];
    /** Cinta pegada a la cara de un muro (pa → pb sobre la cara, nrm hacia la pista): tira de cuadriláteros de 2 m que miran
     *  a la pista (por las dos caras: 4 triángulos el tramo). La persecución (aRing.y = metros a lo largo del aro) va por vértice. */
    function ribbon(pa, pb, z, hgt, nrm, colr) {
      var L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), m = Math.max(1, Math.round(L / 2)), ox = nrm[0] * 0.05, oy = nrm[1] * 0.05;
      for (var k = 0; k < m; k++) {
        var t0 = k / m, t1 = (k + 1) / m, b = E.v;
        [[t0, z], [t1, z], [t1, z + hgt], [t0, z + hgt]].forEach(function (q) {
          VB.toThree(pa[0] + (pb[0] - pa[0]) * q[0] + ox, pa[1] + (pb[1] - pa[1]) * q[0] + oy, q[1], v); E.p.push(v.x, v.y, v.z);
          VB.toThree(nrm[0], nrm[1], 0, v); E.n.push(v.x, v.y, v.z); E.c.push(colr.r, colr.g, colr.b);
          TL.push([E.v, E.v + 1, along + L * q[0]]); E.v++;
        });
        E.i.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
      }
      along += L;
    }
    for (var sd = -1; sd <= 1; sd += 2) {
      ribbon([-LX, sd * YB], [LX, sd * YB], 9.06, 0.22, [0, -sd], led);
      ribbon([-LX, sd * YB], [LX, sd * YB], 9.4, 0.09, [0, -sd], ledB);
      ribbon([sd * XB, -EY], [sd * XB, EY], 7.62, 0.22, [-sd, 0], led);
      ribbon([sd * XB, -EY], [sd * XB, EY], 7.96, 0.09, [-sd, 0], ledB);
    }
    // lentes del faro en las 4 caras del chaflán: 3 franjas cada una, y el anillo de luz de la base
    var lensC = col(PALC.lens).multiplyScalar(0.78), lampC = col(PALC.lamp).multiplyScalar(0.8), headC = col(PALC.head).multiplyScalar(0.82);
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(function (dq) {
      var cx = dq[0] * (FHW - FCH / 2) , cy = dq[1] * (FHW - FCH / 2), ang = Math.atan2(dq[1], dq[0]), o = 0.03;
      for (var b = 0; b < 3; b++) {
        var zc = FZ - 0.7 + b * 0.7, wq = FCH * 0.62;
        var ex = Math.cos(ang + PI / 2) * wq, ey = Math.sin(ang + PI / 2) * wq, ox = Math.cos(ang) * o, oy = Math.sin(ang) * o;
        quadE([cx - ex + ox, cy - ey + oy], [cx + ex + ox, cy + ey + oy], zc - 0.22, zc + 0.22, ang, lensC);
      }
    });
    function quadE(p0, p1, za, zb, ang, colr) {
      var b = E.v, nx = Math.cos(ang), ny = Math.sin(ang);
      [[p0, za], [p1, za], [p1, zb], [p0, zb]].forEach(function (q) { VB.toThree(q[0][0], q[0][1], q[1], v); E.p.push(v.x, v.y, v.z); VB.toThree(nx, ny, 0, v); E.n.push(v.x, v.y, v.z); E.c.push(colr.r, colr.g, colr.b); });
      E.i.push(b, b + 1, b + 2, b, b + 2, b + 3); E.v += 4;
    }
    // linterna: núcleo cálido y cristales fríos
    var LG = ngon(1.18, 8, PI / 8);
    for (var lg = 0; lg < 8; lg++) { var la0 = LG[lg], la1 = LG[(lg + 1) % 8], an = Math.atan2((la0[1] + la1[1]) / 2, (la0[0] + la1[0]) / 2); quadE(la0, la1, lz0 + 0.05, lz1 - 0.05, an, lg % 2 ? lensC : lampC); }
    // anillo de luz bajo la base del faro (mira a la pista)
    var BR = ngon(FHW * 0.62 - 0.05, 8, PI / 8);
    for (var bq = 0; bq < 8; bq++) { var b0 = BR[bq], b1 = BR[(bq + 1) % 8], an2 = Math.atan2((b0[1] + b1[1]) / 2, (b0[0] + b1[0]) / 2); quadE(b0, b1, z0 - 0.72, z0 - 0.6, an2, lensC); }
    // cabezas del anillo de focos (discos que miran abajo)
    lamps.forEach(function (lp) { E.sbox(0.5, 0.5, 0.03, lp[0], lp[1], lp[2] + 0.01, headC); });
    var eg = E.build(), ar = new Float32Array(eg.attributes.position.count * 2);
    for (var t = 0; t < TL.length; t++) for (var vi = TL[t][0]; vi < TL[t][1]; vi++) { ar[vi * 2] = 1; ar[vi * 2 + 1] = TL[t][2]; }
    eg.setAttribute('aRing', new THREE.BufferAttribute(ar, 2));
    var GU = CU.glowU = { uRingC: { value: new THREE.Color(PALC.led) }, uRingK: { value: 0 }, uT: { value: 0 }, uK: { value: 1 }, uChase: { value: 0.18 } };
    var em = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
    em.onBeforeCompile = function (sh) {
      for (var u in GU) sh.uniforms[u] = GU[u];
      sh.vertexShader = 'attribute vec2 aRing; varying vec2 vRing;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRing = aRing;');
      sh.fragmentShader = 'uniform vec3 uRingC; uniform float uRingK; uniform float uT; uniform float uK; uniform float uChase; varying vec2 vRing;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' +
          ' float vbR = step(0.5, vRing.x); float vbS = 1.0 - uChase + uChase * sin(vRing.y * 0.55 - uT * 2.2);\n' +
          ' vec3 vbRing = mix(diffuseColor.rgb, uRingC * 0.8, uRingK) * vbS;\n' +
          ' diffuseColor.rgb = mix(diffuseColor.rgb * uK, vbRing, vbR);');
    };
    em.customProgramCacheKey = function () { return 'vb-cupula-glow'; };
    var gm = new THREE.Mesh(eg, em); gm.name = 'cupulaGlow'; gm.frustumCulled = false; G.add(gm);

    /* ---- halos: focos del anillo y linterna (1 dibujo) ---- */
    var hp = [], hs = [];
    lamps.forEach(function (lp) { VB.toThree(lp[0], lp[1], lp[2] - 0.1, v); hp.push(v.x, v.y, v.z); hs.push(0.85 + rnd() * 0.25); });
    VB.toThree(0, 0, (lz0 + lz1) / 2, v); hp.push(v.x, v.y, v.z); hs.push(1.5);
    var hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); hg.setAttribute('aS', new THREE.Float32BufferAttribute(hs, 1));
    var hm = K.haloMaterial(K.radialTex([[0, 'rgba(255,244,222,0.8)'], [0.2, 'rgba(255,228,190,0.26)'], [1, 'rgba(255,220,180,0)']]));
    var halos = CU.halos = new THREE.Points(hg, hm); halos.name = 'cupulaHalos'; halos.frustumCulled = false; G.add(halos);

    /* ---- haces del faro (media y alta): 6, desde las lentes de la base hacia la grada; barren despacio ---- */
    var beams = [];
    for (var bi = 0; bi < 6; bi++) {
      var ba = bi * TAU / 6 + PI / 6, ca = Math.cos(ba), sa = Math.sin(ba);
      var fx = Math.abs(ca) > 1e-3 ? 23 / Math.abs(ca) : 99, fy = Math.abs(sa) > 1e-3 ? 19 / Math.abs(sa) : 99, fd = Math.min(fx, fy, 26);
      beams.push({ a: [ca * 1.4, sa * 1.4, z0 - 0.6], b: [ca * fd, sa * fd, 4.2], r0: 0.22, r1: 2.6 });
    }
    var cm = CU.cones = K.coneMesh(beams, PALC.lamp, BEAM_K); cm.name = 'cupulaBeams'; G.add(cm);
  }

  function quality(q) {
    if (CU.cones) CU.cones.visible = q && q.rank >= 1;
  }
  function step(t, rdt, g, K) {
    var M = K.mood(), soft = K.soft();
    // aro LED: 1,5 s del color del que anota (al empezar el destello del punto); en la victoria, persecución viva
    if (M.pf > 0.02 && CU.pfWas <= 0.02) { CU.ringT = 1.5; CU.ringTeam = M.team; }
    CU.pfWas = M.pf;
    if (CU.ringT > 0) CU.ringT = Math.max(0, CU.ringT - rdt);
    if (CU.glowU) {
      var U = CU.glowU, rk = Math.min(1, CU.ringT / 0.35) * Math.min(1, (1.5 - CU.ringT) / 0.25 + 0.2);
      if (CU.ringT > 0 || M.win > 0.01) U.uRingC.value.set(K.TEAMC[CU.ringTeam] || '#39e0ff');
      U.uRingK.value = Math.max(rk, 0.7 * M.win) * soft;
      U.uT.value = (U.uT.value + rdt * (1 + 2.5 * M.win + 0.8 * M.tense)) % 3600;
      U.uChase.value = 0.16 + 0.22 * M.win * soft;
      U.uK.value = 1 + 0.15 * M.pf * soft;
    }
    if (CU.domeU) CU.domeU.uOc.value = 1 - 0.25 * M.tense;
    if (CU.halos) CU.halos.material.uniforms.opacity.value = (1 + 0.6 * M.pf * soft + 0.12 * M.tense);
    var cm = CU.cones;
    if (cm && cm.visible) {
      // barrido lento (fase propia: sin saltos al cambiar de ritmo); más deprisa y marcado en punto de set
      CU.ph = (CU.ph + rdt * (0.32 + 0.9 * M.tense + 0.6 * M.win)) % 3600;
      var u = cm.material.uniforms;
      u.uT.value = CU.ph; u.sweep.value = 0.2 + 0.08 * M.tense + 0.05 * M.win;
      u.k.value = BEAM_K * (1 + 0.6 * M.tense + 0.5 * M.win);
    }
  }
  function dispose() { CU.glowU = CU.halos = CU.cones = CU.domeU = null; CU.ringT = 0; CU.pfWas = 0; }

  // luz de noche: blanca cálida casi cenital sobre la pista, relleno violeta bajo, contraluz magenta; sala en penumbra
  var LOOK = {
    fog: '#1f1846', near: 34, far: 95, hemi: 0x8a7ad8, ground: 0x2a2150, key: 0xfff3e0, fill: 0x6a5ab8, rim: 0xff8fd0,
    keyK: 0.97, hemiK: 0.9, fillK: 0.85, rimK: 0.55, floorK: 1.0, haze: '#2a1f5a', hazeK: 0.4, crowdLight: 0.74, crowdDim: 0.5,
    keyDir: [7, -8, 27]
  };

  // estandartes de la grada: añil con la estrella de 8 puntas dorada (local / visitante conservan su color en la franja)
  var FLAGS = [{ a: '#3a2f8a', b: '#ff6b3d', d: '#141030', k: '#e8c14a', w: '#fff3e0' }, { a: '#1e2a5a', b: '#3f8cff', d: '#0b0920', k: '#e8c14a', w: '#f4f8ff' }];
  FLAGS.points = 8;

  VB.Arena.registerMap({
    id: 'cupula', kind: 'hall', seed: 8812051,
    hide: ['hallShell', 'hungScreens', 'banners', 'hallName', 'halos', 'lightCones'],
    look: LOOK, floor: floor, floorLine: '#ffffff',
    score: { x: 0, y: 0, z: FZ, w: SCR_W, h: SCR_H },
    brands: { 'PALAU DEL MAR': { name: 'CÚPULA DEL FAR', fg: '#39e0ff', bg: ['#0b0920', '#2a1f6a'], deco: 'star8' },
      'MARINA FM': { name: 'MARINA FM', fg: '#ffffff', bg: ['#b8287a', '#ff4fa0'], deco: 'wave' } },
    flagPal: FLAGS,
    screen: { a: '#1e1850', b: '#3a2f8a', fg: '#ffe08a' },
    build: build, quality: quality, step: step, dispose: dispose
  });
})();
