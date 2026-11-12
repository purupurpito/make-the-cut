/* VOLEY 3D — js/venue-canrebot.js (owner: arena)
 * Sede de pabellón «Poliesportiu Can Rebot» (12-nov-2026): el polideportivo municipal del barrio, DE DÍA, donde empieza
 * todo (guiño: «rebot» = rebote). Es el polo opuesto al Palau nocturno: luz cálida de sol, poco público y suelo de colores.
 * En la Carrera de pista, la sede de las divisiones bajas.
 *
 * Pabellón ≠ Palau: monta su grupo sobre la base y oculta lo que no usa (def.hide). Todo con el kit K (notes/arena.md «Sedes»):
 * lo que se crea con él se libera al salir; la tarima de Palau se REPINTA (def.floor, mismo lienzo: 0 dibujos y 0 memoria) y
 * vuelve a la de Palau al salir.
 * - Suelo sintético verde con la pista de vóley en terracota y, debajo de las líneas FIVB, las de baloncesto (amarillo) y
 *   balonmano / fútbol sala (azul) desvaídas, grano de goma y barniz mate. Fuera de la tarima, el resto de la pista de balonmano
 *   y el cemento de los bordes en una malla propia (sustituye a `outerFloor`).
 * - Gimnasio en UNA malla toon (+ tinta en media/alta): zócalo teal y pared crema, espalderas de madera, colchonetas, canastas
 *   plegadas, puertas de almacén, grada telescópica de 6 filas en el lado del 1r árbitro (la que se ve en el menú), puertas de
 *   vestuarios, máquina de bebidas, vitrina de trofeos y reloj en el otro lateral, techo en dientes de sierra con cerchas.
 * - Emisiva (1 dibujo, sin tono): lucernarios de los dientes de sierra, ventanales altos, 8 campanas industriales, la máquina de
 *   bebidas y las salidas de emergencia.
 * - Haces de sol que bajan de los lucernarios (media y alta), en el sentido de la luz principal (sol alto desde +x).
 * - Marcador de pared de SEGMENTOS en los dos fondos (dígitos rojos y ámbar sobre negro; def.drawScore pinta su lienzo).
 * - Rótulos de dibujo (1 dibujo, toon con textura): letrero pintado en la pared, pancartas en la grada, carteles.
 * - Público: ~110 vecinos y familias en la grada (instanciado del pabellón con el muñeco cabezón; 1 dibujo).
 * Dibujos (baja): suelo exterior, estática, emisiva, rótulos, marcador y público = 6 en lugar de las ~15 piezas de Palau ocultas.
 */
(function () {
  'use strict';
  var VB = window.VB; if (!VB || !VB.Arena || !VB.Arena.registerMap) return;
  var PI = Math.PI;

  // ---------- medidas del gimnasio (sim: x a lo largo de la pista, y a lo ancho, z arriba) ----------
  var WX = 21.6;                 // paredes de los fondos (balonmano 40 × 20 con 1,6 m de margen)
  var YS = -17.2, YN = 13.4;     // pared tras la grada (lado −y, el del 1r árbitro) y pared de los vestuarios (+y)
  var EAVE = 9.0, RISE = 2.2, NT = 6, TW = 2 * WX / NT, TOP = EAVE + RISE + 0.3; // dientes de sierra: 6 de 7,2 m
  var BY0 = 11.9, RD = 0.8, RZ = 0.42, NR = 6, BXH = 13.4; // grada telescópica: primera fila, fondo y alto de fila, filas, medio largo

  // ---------- paleta ----------
  var PALC = {
    free: '#2e9a6b', border: '#27855c', court: '#d8673b', attack: '#c95c33', cement: '#8f9196',
    basket: 'rgba(242,194,48,0.5)', hand: 'rgba(58,111,216,0.5)',
    teal: '#2a8c8c', cream: '#efe3c8', wood: '#c58a4a', woodL: '#dba468', woodD: '#8a5a32', mat: '#2a4fa0', matD: '#21407f',
    chapa: '#6f7d93', chapaD: '#5a6880', truss: '#3f4a5c', steel: '#8a94a2', dark: '#1d1e24', white: '#f4f1e8',
    deck: '#6b707a', panel: '#5a616d', rubber: '#3e434c', seatA: '#c58a4a', seatB: '#e8504a', door: '#2a4fa0', red: '#d8342c',
    orange: '#e8642a', board: '#dfeef5', gray: '#9aa0a8',
    glass: '#8cc4ea', lamp: '#fff1c8', exit: '#36d67a'
  };
  var STREET = ['#3a5a8c', '#8c3a3a', '#e0d6c0', '#6a8c4a', '#444a55', '#c97a3a', '#f4f2ec', '#e8c14a', '#7a5a9c', '#2f8f8f', '#d8d0f0', '#a0522d'];
  var PANTS = ['#2e4466', '#1f2a3d', '#4a4f5a', '#6b5a48', '#2b2b33', '#3f5f8f', '#5a6a4a'];
  var BEAM_K = 0.05; // haces de sol (aditivos, media y alta): por debajo del umbral del bloom de alta
  var CR = { cv: null, tex: null, pcv: null, ptex: null, floorMat: null, cones: null, score: null };

  /* ---------- suelo: líneas de los otros deportes (las comparten la tarima repintada y el suelo exterior) ---------- */
  function sportLines(g, X, Y, ppm, lwMin) {
    var lw = Math.max(lwMin, 0.05 * ppm);
    function poly(pts) { g.beginPath(); for (var i = 0; i < pts.length; i++) { var p = pts[i]; if (i) g.lineTo(X(p[0]), Y(p[1])); else g.moveTo(X(p[0]), Y(p[1])); } g.stroke(); }
    function rectL(x0, y0, x1, y1) { poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]); }
    g.save(); g.lineWidth = lw; g.lineJoin = 'round';
    // balonmano / fútbol sala (azul): pista de 40 × 20, área de 6 m, línea discontinua de 9 m y marca de 7 m
    g.strokeStyle = PALC.hand;
    rectL(-20, -10, 20, 10); poly([[0, -10], [0, 10]]);
    for (var e = -1; e <= 1; e += 2) {
      [6, 9].forEach(function (r) {
        var pts = [];
        for (var a = 0; a <= 40; a++) { // cuarto de círculo (centro en el poste), recta entre postes y el otro cuarto
          var t = a / 40, ang = t * PI, yy, xx;
          if (t < 0.5) { yy = 1.5 + r * Math.cos(ang); xx = 20 - r * Math.sin(ang); }
          else { yy = -1.5 + r * Math.cos(ang); xx = 20 - r * Math.sin(ang); }
          if (Math.abs(yy) > 10) continue;
          if (a === 20) pts.push([e * (20 - r), 1.5]);
          pts.push([e * xx, yy]);
        }
        if (r === 9) g.setLineDash([0.15 * ppm, 0.15 * ppm]);
        poly(pts); g.setLineDash([]);
      });
      poly([[e * 13, -0.5], [e * 13, 0.5]]);
    }
    // baloncesto (amarillo): pista de 28 × 15, círculo central, zona, tiro libre y triple
    g.strokeStyle = PALC.basket;
    rectL(-14, -7.5, 14, 7.5);
    g.beginPath(); g.arc(X(0), Y(0), 1.8 * ppm, 0, 2 * PI); g.stroke();
    for (var b = -1; b <= 1; b += 2) {
      rectL(b * 14, -2.45, b * 8.2, 2.45);
      g.beginPath(); g.arc(X(b * 8.2), Y(0), 1.8 * ppm, 0, 2 * PI); g.stroke();
      var tp = [[b * 14, -6.6]];
      for (var k = 0; k <= 32; k++) { var yy2 = -6.6 + 13.2 * k / 32; tp.push([b * (12.425 - Math.sqrt(6.75 * 6.75 - yy2 * yy2)), yy2]); }
      tp.push([b * 14, 6.6]); poly(tp);
    }
    g.restore();
  }
  /** Grano de goma: patrón de motas claras y oscuras (un mosaico de 96 px). */
  function grain(g, rnd, a) {
    var pc = document.createElement('canvas'); pc.width = pc.height = 96; var pg = pc.getContext('2d');
    for (var i = 0; i < 700; i++) { pg.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')'; pg.fillRect(rnd() * 96, rnd() * 96, 1 + rnd() * 1.5, 1 + rnd() * 1.5); }
    return g.createPattern(pc, 'repeat');
  }
  /** Tarima (lienzo de la pista de Palau, ±16,6 × ±10,6 m): todo menos las líneas FIVB (arena.js las pinta encima). */
  function floor(g, h) {
    var X = h.X, Y = h.Y, rect = h.rect, ppm = h.ppm, C = h.C, rnd = h.rnd;
    g.fillStyle = PALC.border; g.fillRect(0, 0, h.W, h.H);
    g.fillStyle = PALC.free; rect(-h.FZX, -h.FZY, h.FZX, h.FZY);
    g.fillStyle = PALC.court; rect(-C.HL, -C.HW, C.HL, C.HW);
    g.fillStyle = PALC.attack; rect(-C.ATTACK, -C.HW, C.ATTACK, C.HW);
    g.fillStyle = grain(g, rnd, 0.07); g.fillRect(0, 0, h.W, h.H);
    // logotipos municipales en la zona libre (como el Palau, pero pintados en blanco sobre el verde)
    g.save(); g.fillStyle = 'rgba(255,255,255,0.2)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 ' + Math.round(1.0 * ppm) + 'px ' + h.FONT;
    for (var s = -1; s <= 1; s += 2) { g.save(); g.translate(X(s * 15.2), Y(0)); g.rotate(-s * PI / 2); g.fillText('CAN REBOT', 0, 0); g.restore(); }
    g.font = '900 ' + Math.round(0.9 * ppm) + 'px ' + h.FONT; g.fillText('POLIESPORTIU  MUNICIPAL  CAN  REBOT', X(0), Y(-8.4));
    g.restore();
    sportLines(g, X, Y, ppm, 1.5);
    // barniz mate: dos franjas diagonales apenas más claras sobre la pista
    g.save(); g.beginPath(); g.rect(X(-C.HL), Y(C.HW), 2 * C.HL * ppm, 2 * C.HW * ppm); g.clip(); g.fillStyle = 'rgba(255,240,225,0.06)';
    for (var gl = -1; gl <= 1; gl += 2) {
      var gx = X(gl * 4.6);
      g.beginPath(); g.moveTo(gx - 0.6 * ppm, Y(C.HW)); g.lineTo(gx + 0.6 * ppm, Y(C.HW)); g.lineTo(gx - 1.9 * ppm, Y(-C.HW)); g.lineTo(gx - 3.1 * ppm, Y(-C.HW)); g.fill();
    }
    g.restore();
    // filo de tinta alrededor de la pista (por fuera de las líneas, como en el Palau)
    g.fillStyle = 'rgba(29,21,48,0.45)'; var ik = 0.035;
    rect(-C.HL - ik, C.HW, C.HL + ik, C.HW + ik); rect(-C.HL - ik, -C.HW - ik, C.HL + ik, -C.HW);
    rect(-C.HL - ik, -C.HW, -C.HL, C.HW); rect(C.HL, -C.HW, C.HL + ik, C.HW);
  }
  /** Suelo exterior (todo el gimnasio, debajo de la tarima): cemento junto a las paredes y bajo la grada, sintético verde. */
  function drawOuter(cv, rnd, FONT) {
    var g = cv.getContext('2d'), ppm = cv.width / (2 * WX);
    function X(x) { return (x + WX) * ppm; }
    function Y(y) { return (YN - y) * ppm; }
    g.fillStyle = PALC.cement; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = PALC.border; g.fillRect(X(-WX + 0.7), Y(YN - 0.7), (2 * WX - 1.4) * ppm, (YN - 0.7 + BY0 - 0.1) * ppm);
    g.fillStyle = PALC.free; g.fillRect(X(-15.5), Y(9.5), 31 * ppm, 19 * ppm);
    g.fillStyle = grain(g, rnd, 0.06); g.fillRect(0, 0, cv.width, cv.height);
    sportLines(g, X, Y, ppm, 1.2);
    void FONT;
  }

  /* ---------- marcador de pared de segmentos ---------- */
  var SEG = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  function seg7(g, x, y, w, h, d, on, off) {
    var t = w * 0.2, hs = (h - t) / 2, gp = Math.max(1, w * 0.025), lit = d >= 0 ? SEG[d] : '';
    function hor(x0, y0, L) { return [[x0 + gp, y0 + t / 2], [x0 + t / 2 + gp, y0], [x0 + L - t / 2 - gp, y0], [x0 + L - gp, y0 + t / 2], [x0 + L - t / 2 - gp, y0 + t], [x0 + t / 2 + gp, y0 + t]]; }
    function ver(x0, y0, L) { return [[x0 + t / 2, y0 + gp], [x0 + t, y0 + t / 2 + gp], [x0 + t, y0 + L - t / 2 - gp], [x0 + t / 2, y0 + L - gp], [x0, y0 + L - t / 2 - gp], [x0, y0 + t / 2 + gp]]; }
    var P = { a: hor(x, y, w), g: hor(x, y + hs, w), d: hor(x, y + 2 * hs, w), f: ver(x, y, hs + t), b: ver(x + w - t, y, hs + t), e: ver(x, y + hs, hs + t), c: ver(x + w - t, y + hs, hs + t) };
    g.save(); g.transform(1, 0, -0.08, 1, (y + h) * 0.08, 0); // cursiva de marcador de pabellón
    for (var s in P) {
      var pts = P[s]; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath();
      g.fillStyle = lit.indexOf(s) >= 0 ? on : off; g.fill();
    }
    g.restore();
  }
  function fitFont(g, text, weight, size, maxW, FONT) {
    g.font = weight + ' ' + Math.round(size) + 'px ' + FONT; var w = g.measureText(text).width;
    if (w > maxW) { size = size * maxW / w; g.font = weight + ' ' + Math.round(size) + 'px ' + FONT; }
  }
  function drawScore(K, SB) {
    var cv = CR.cv; if (!cv) return;
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, k = W / 512, FONT = K.FONT, RED = '#ff3b2f', REDo = '#3a0f0c', AMB = '#ffb02e', AMBo = '#3a2408';
    g.fillStyle = '#0b0b0e'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a2a32'; g.lineWidth = 4 * k; g.strokeRect(3 * k, 3 * k, W - 6 * k, H - 6 * k);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (var t = 0; t < 2; t++) {
      var cx = W * (t ? 0.76 : 0.24);
      g.fillStyle = AMB; fitFont(g, SB.names[t], '800', 34 * k, 150 * k, FONT); g.fillText(SB.names[t], cx, 28 * k);
      if (SB.serving === t) { var nw = g.measureText(SB.names[t]).width; g.beginPath(); g.arc(cx + (t ? 1 : -1) * (nw / 2 + 14 * k), 28 * k, 7 * k, 0, 2 * PI); g.fill(); }
      var sc = SB.score[t] | 0, d1 = sc >= 10 ? Math.floor(sc / 10) % 10 : -1, d0 = sc % 10, dw = 64 * k, dh = 118 * k, y0 = 58 * k;
      seg7(g, cx - dw - 7 * k, y0, dw, dh, d1, RED, REDo); seg7(g, cx + 7 * k, y0, dw, dh, d0, RED, REDo);
      seg7(g, cx - 11 * k, 196 * k, 22 * k, 40 * k, SB.sets[t] | 0, AMB, AMBo); // sets ganados
    }
    g.fillStyle = AMB; g.font = '800 ' + Math.round(18 * k) + 'px ' + FONT; g.fillText('SET', W / 2, 74 * k);
    seg7(g, W / 2 - 15 * k, 92 * k, 30 * k, 54 * k, Math.min(9, SB.setNo | 0), AMB, AMBo);
    g.fillStyle = 'rgba(255,176,46,0.55)'; g.font = '700 ' + Math.round(14 * k) + 'px ' + FONT; g.fillText('SETS', W / 2, 216 * k);
    if (SB.tag) { g.fillStyle = AMB; fitFont(g, SB.tag, '900', 22 * k, 150 * k, FONT); g.fillText(SB.tag, W / 2, 172 * k); }
    // avisos (PUNTO PARA…, CAMBIO DE CAMPO): rótulo ámbar sobre la franja central
    if (SB.msgT > 0 && SB.msg) {
      g.fillStyle = '#0b0b0e'; g.fillRect(10 * k, 52 * k, W - 20 * k, 140 * k);
      g.fillStyle = SB.msgCol || AMB; g.fillRect(10 * k, 52 * k, W - 20 * k, 5 * k); g.fillRect(10 * k, 187 * k, W - 20 * k, 5 * k);
      g.fillStyle = AMB; fitFont(g, SB.msg, 'italic 900', (SB.msgSub ? 54 : 66) * k, W * 0.9, FONT); g.fillText(SB.msg, W / 2, (SB.msgSub ? 108 : 122) * k);
      if (SB.msgSub) { g.fillStyle = RED; fitFont(g, SB.msgSub, '800', 26 * k, W * 0.88, FONT); g.fillText(SB.msgSub, W / 2, 158 * k); }
    }
    if (CR.tex) CR.tex.needsUpdate = true;
  }

  /* ---------- rótulos de dibujo (atlas de 1024 × 512 en escritorio) ---------- */
  var ATL = {
    sign: [0, 0, 1024, 128], club: [0, 128, 512, 256], anims: [512, 128, 1024, 256],
    v1: [0, 256, 256, 320], v2: [256, 256, 512, 320], mag: [512, 256, 768, 320], calc: [768, 256, 1024, 320],
    strip: [0, 320, 1024, 384], poster: [0, 384, 512, 512], crest: [512, 384, 768, 512]
  };
  function drawPrints(cv, FONT) {
    var g = cv.getContext('2d'), k = cv.width / 1024;
    function R(r) { return [r[0] * k, r[1] * k, (r[2] - r[0]) * k, (r[3] - r[1]) * k]; }
    function txt(s, x, y, size, maxW, col, weight) { g.fillStyle = col; fitFont(g, s, weight || '900', size * k, maxW * k, FONT); g.fillText(s, x * k, y * k); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // letrero pintado en la pared crema de la grada
    var r = R(ATL.sign); g.fillStyle = PALC.cream; g.fillRect(r[0], r[1], r[2], r[3]);
    txt('POLIESPORTIU MUNICIPAL', 310, 66, 76, 540, PALC.teal); txt('CAN REBOT', 830, 64, 92, 300, '#e8504a');
    g.fillStyle = PALC.teal; g.fillRect(40 * k, 112 * k, 944 * k, 6 * k);
    var bc = 638; g.beginPath(); g.arc(bc * k, 64 * k, 30 * k, 0, 2 * PI); g.fillStyle = '#ffc93c'; g.fill();
    g.strokeStyle = '#1d1530'; g.lineWidth = 4 * k; g.stroke(); g.beginPath(); g.moveTo((bc - 28) * k, 54 * k); g.quadraticCurveTo(bc * k, 74 * k, (bc + 28) * k, 54 * k); g.stroke();
    g.beginPath(); g.moveTo(bc * k, 34 * k); g.quadraticCurveTo((bc - 14) * k, 64 * k, bc * k, 94 * k); g.stroke();
    // pancartas de tela pintadas a mano
    function cloth(rr, bg, fg, s1, s2) {
      var q = R(rr); g.fillStyle = bg; g.fillRect(q[0], q[1], q[2], q[3]);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5 * k; g.setLineDash([14 * k, 10 * k]); g.strokeRect(q[0] + 10 * k, q[1] + 10 * k, q[2] - 20 * k, q[3] - 20 * k); g.setLineDash([]);
      g.save(); g.translate(q[0] + q[2] / 2, q[1] + q[3] / 2); g.rotate(-0.03);
      g.fillStyle = fg; fitFont(g, s1, 'italic 900', 70 * k, q[2] * 0.84, FONT); g.fillText(s1, 0, s2 ? -10 * k : 2 * k);
      if (s2) { fitFont(g, s2, '800', 24 * k, q[2] * 0.8, FONT); g.fillText(s2, 0, 38 * k); }
      g.restore();
    }
    cloth(ATL.club, '#e8504a', '#ffffff', 'CV CAN REBOT', 'DES DE 1987 · EL VÒLEI DEL BARRI');
    cloth(ATL.anims, '#ffc93c', '#1d1530', 'ÀNIMS EQUIP!', '');
    // carteles
    function plate(rr, bg, fg, s) { var q = R(rr); g.fillStyle = bg; g.fillRect(q[0], q[1], q[2], q[3]); g.fillStyle = fg; fitFont(g, s, '800', 40 * k, q[2] * 0.86, FONT); g.fillText(s, q[0] + q[2] / 2, q[1] + q[3] / 2 + 2 * k); }
    plate(ATL.v1, '#f4f1e8', '#2a4fa0', 'VESTUARI 1'); plate(ATL.v2, '#f4f1e8', '#2a4fa0', 'VESTUARI 2');
    plate(ATL.mag, '#3f4a5c', '#f4f1e8', 'MAGATZEM'); plate(ATL.calc, '#ffffff', '#d8342c', 'SENSE CALÇAT DE CARRER');
    var sq = R(ATL.strip); g.fillStyle = '#d8342c'; g.fillRect(sq[0], sq[1], sq[2], sq[3]); txt('POLIESPORTIU CAN REBOT', 512, 352, 44, 900, '#ffffff', '800');
    // cartel del torneo de barrio y escudo del club
    var pq = R(ATL.poster); g.fillStyle = '#2a8c8c'; g.fillRect(pq[0], pq[1], pq[2], pq[3]);
    g.fillStyle = '#ffc93c'; g.fillRect(pq[0], pq[1] + pq[3] - 22 * k, pq[2], 22 * k);
    txt('TORNEIG DE BARRI', 256, 424, 50, 470, '#ffffff'); txt('DISSABTE · 10 H · ENTRADA LLIURE', 256, 468, 26, 470, '#ffc93c', '800');
    var cq = R(ATL.crest); g.fillStyle = PALC.cream; g.fillRect(cq[0], cq[1], cq[2], cq[3]);
    g.beginPath(); var cx = cq[0] + cq[2] / 2, cy = cq[1] + 58 * k;
    g.moveTo(cx - 52 * k, cy - 46 * k); g.lineTo(cx + 52 * k, cy - 46 * k); g.lineTo(cx + 52 * k, cy + 6 * k); g.quadraticCurveTo(cx + 46 * k, cy + 48 * k, cx, cy + 62 * k); g.quadraticCurveTo(cx - 46 * k, cy + 48 * k, cx - 52 * k, cy + 6 * k); g.closePath();
    g.fillStyle = '#e8504a'; g.fill(); g.lineWidth = 6 * k; g.strokeStyle = '#1d1530'; g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(cx - 8 * k, cy - 46 * k, 16 * k, 106 * k);
    txt('CVCR', 640, 494, 26, 120, '#1d1530', '900');
  }

  /* ---------- construcción ---------- */
  function build(G, K) {
    var THREE = K.THREE, col = K.col, rnd = K.rnd, BG = K.BGEO, BOX = K.UNIT_BOX, AT = K.at;
    var S = new K.Builder(), E = new K.Builder(), c = {};
    for (var nm in PALC) if (PALC[nm].charAt(0) === '#') c[nm] = col(PALC[nm]);
    function bx(B, x0, x1, y0, y1, z0, z1, cc) { B.sbox(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, cc); }
    function rod(B, ax, ay, az, bx2, by, bz, r, cc, g) { K.objM(0, 0, 0, 1); K.lrod(B, ax, az, -ay, bx2, bz, -by, r, cc, g); }
    function pt(B, g, x, y, z, cc, rx, ry, rz, w, h, d) { K.objM(0, 0, 0, 1); K.part(B, g, x, z, -y, cc, rx, ry, rz, w, h, d); }
    function roofZ(x) { var u = (x + WX) / TW; return EAVE + RISE * (u - Math.floor(u)); }

    // ---- paredes: zócalo teal hasta 1,2 m con su listón de madera, crema por encima ----
    for (var e = -1; e <= 1; e += 2) {
      var xf = e * WX, xo = e * (WX + 0.3);
      bx(S, xf, xo, YS - 0.3, YN + 0.3, 0, 1.2, c.teal); bx(S, xf, xo, YS - 0.3, YN + 0.3, 1.2, TOP, c.cream);
      bx(S, xf - e * 0.04, xf, YS, YN, 1.17, 1.26, c.wood);
    }
    [YS, YN].forEach(function (yw) {
      var s = yw > 0 ? 1 : -1;
      bx(S, -WX - 0.3, WX + 0.3, yw, yw + s * 0.3, 0, 1.2, c.teal); bx(S, -WX - 0.3, WX + 0.3, yw, yw + s * 0.3, 1.2, TOP, c.cream);
      bx(S, -WX, WX, yw - s * 0.04, yw, 1.17, 1.26, c.wood);
      // ventanales altos (cristal en la emisiva, carpintería blanca en la estática)
      for (var wx = -18; wx <= 18.01; wx += 3) {
        bx(E, wx - 1.15, wx + 1.15, yw - s * 0.05, yw - s * 0.02, 6.3, 8.4, c.glass);
        bx(S, wx - 1.32, wx + 1.32, yw - s * 0.16, yw, 6.14, 6.3, c.white); bx(S, wx - 1.3, wx + 1.3, yw - s * 0.1, yw, 8.4, 8.52, c.white);
        bx(S, wx - 1.3, wx - 1.15, yw - s * 0.1, yw, 6.3, 8.4, c.white); bx(S, wx + 1.15, wx + 1.3, yw - s * 0.1, yw, 6.3, 8.4, c.white);
        bx(S, wx - 0.03, wx + 0.03, yw - s * 0.08, yw, 6.3, 8.4, c.white); bx(S, wx - 1.15, wx + 1.15, yw - s * 0.08, yw, 7.32, 7.38, c.white);
      }
    });

    // ---- techo en dientes de sierra: chapa con nervios, lucernarios verticales (mirando a +x, por donde entra el sol) y cerchas ----
    var span = YN - YS + 0.6, yc = (YN + YS) / 2, ang = Math.atan2(RISE, TW), L = Math.hypot(TW, RISE), sn = Math.sin(ang), cs = Math.cos(ang);
    for (var k = 0; k < NT; k++) {
      var x0 = -WX + k * TW, x1 = x0 + TW, xm = (x0 + x1) / 2, zm = EAVE + RISE / 2;
      pt(S, BOX, xm - sn * 0.06, yc, zm + cs * 0.06, c.chapa, 0, 0, ang, L, 0.12, span);
      for (var ry = YS + 0.6; ry < YN; ry += 1.25) pt(S, BOX, xm + sn * 0.03, ry, zm - cs * 0.03, c.chapaD, 0, 0, ang, L, 0.07, 0.1);
      if (k < NT - 1) {
        bx(E, x1 - 0.02, x1 + 0.02, YS, YN, EAVE, EAVE + RISE, c.glass);
        for (var my = YS + 1.4; my < YN - 0.5; my += 1.53) bx(S, x1 - 0.07, x1 - 0.02, my - 0.04, my + 0.04, EAVE, EAVE + RISE, c.truss);
        bx(S, x1 - 0.1, x1 + 0.02, YS, YN, EAVE - 0.06, EAVE + 0.04, c.truss);
        // cercha bajo el lucernario: cordones y celosía
        var zb = EAVE - 0.95, nW = 12;
        rod(S, x1, YS, zb, x1, YN, zb, 0.07, c.truss); rod(S, x1, YS, EAVE - 0.05, x1, YN, EAVE - 0.05, 0.06, c.truss);
        for (var j = 0; j <= nW; j++) {
          var y0 = YS + (YN - YS) * j / nW, y1 = YS + (YN - YS) * (j + 1) / nW;
          rod(S, x1, y0, zb, x1, y0, EAVE - 0.05, 0.035, c.truss);
          if (j < nW) rod(S, x1, j % 2 ? y0 : y1, zb, x1, j % 2 ? y1 : y0, EAVE - 0.05, 0.03, c.truss);
        }
      }
    }

    // ---- 8 campanas industriales (carcasa en la estática, bombilla en la emisiva) ----
    [-10.8, -3.6, 3.6, 10.8].forEach(function (lx) {
      [-4.8, 4.8].forEach(function (ly) {
        rod(S, lx, ly, 7.75, lx, ly, roofZ(lx) - 0.05, 0.015, c.dark);
        pt(S, BG.cone6, lx, ly, 7.55, c.teal, 0, 0, 0, 0.55, 0.42, 0.55);
        pt(S, BG.cyl, lx, ly, 7.8, c.dark, 0, 0, 0, 0.1, 0.12, 0.1);
        pt(E, BG.sph6, lx, ly, 7.35, c.lamp, 0, 0, 0, 0.4, 0.08, 0.4);
      });
    });

    // ---- fondos: espalderas, colchonetas, canasta plegada, marcador; puertas de almacén (−x) y salidas de emergencia ----
    function wallBars(e, y0, y1) {
      var xf = e * WX;
      for (var y = y0; y <= y1 + 0.01; y += 0.96) bx(S, xf - e * 0.17, xf - e * 0.02, y - 0.045, y + 0.045, 0, 2.75, c.wood);
      for (var i = 0; i < 16; i++) rod(S, xf - e * 0.1, y0, 0.24 + i * 0.16, xf - e * 0.1, y1, 0.24 + i * 0.16, 0.022, c.woodL);
      bx(S, xf - e * 0.19, xf - e * 0.02, y0 - 0.05, y1 + 0.05, 2.72, 2.84, c.woodD);
    }
    function basket(e) {
      var xf = e * WX, px = xf - e * 1.5;
      for (var s = -1; s <= 1; s += 2) { rod(S, xf, s * 0.75, 6.3, px, s * 0.75, 7.7, 0.05, c.steel); rod(S, xf, s * 0.75, 8.7, px, s * 0.75, 7.7, 0.05, c.steel); }
      rod(S, px, -0.85, 7.7, px, 0.85, 7.7, 0.05, c.steel);
      // tablero de metacrilato plegado hacia el techo (horizontal), marco negro, cuadro naranja y aro colgando
      bx(S, px, px - e * 1.05, -0.9, 0.9, 7.78, 7.82, c.board);
      bx(S, px, px - e * 1.05, -0.92, -0.86, 7.76, 7.84, c.dark); bx(S, px, px - e * 1.05, 0.86, 0.92, 7.76, 7.84, c.dark);
      bx(S, px - e * 1.0, px - e * 1.07, -0.92, 0.92, 7.76, 7.84, c.dark);
      bx(S, px - e * 0.35, px - e * 0.8, -0.3, 0.3, 7.755, 7.775, c.orange);
      pt(S, BG.torus, px - e * 0.6, 0, 7.5, c.orange, 0, 0, 0, 0.23, 0.23, 0.23);
    }
    function matLean(e, y) { var xf = e * WX; pt(S, BOX, xf - e * 0.36, y, 0.99, c.mat, 0, 0, -e * 0.2, 0.2, 2.0, 1.0); pt(S, BOX, xf - e * 0.47, y, 0.99, c.white, 0, 0, -e * 0.2, 0.02, 2.0, 1.0); }
    function matPile(x, y, n) { for (var i = 0; i < n; i++) { bx(S, x - 1.0, x + 1.0, y - 0.5, y + 0.5, i * 0.2, i * 0.2 + 0.19, i % 2 ? c.matD : c.mat); bx(S, x - 1.0, x + 1.0, y - 0.51, y + 0.51, i * 0.2 + 0.08, i * 0.2 + 0.11, c.white); } }
    function exitDoor(e, y) {
      var xf = e * WX;
      bx(S, xf - e * 0.06, xf, y - 0.95, y + 0.95, 0, 2.3, c.white); bx(S, xf - e * 0.09, xf, y - 0.85, y + 0.85, 0, 2.2, c.gray);
      bx(S, xf - e * 0.12, xf - e * 0.08, y - 0.7, y + 0.7, 1.0, 1.06, c.steel); bx(S, xf - e * 0.1, xf - e * 0.08, y - 0.01, y + 0.01, 0, 2.2, c.dark);
      bx(E, xf - e * 0.12, xf - e * 0.04, y - 0.32, y + 0.32, 2.45, 2.68, c.exit);
    }
    wallBars(1, -9.6, 9.6); wallBars(-1, -5.8, 5.8);
    basket(1); basket(-1);
    matLean(1, -7.4); matLean(1, -6.3); matLean(1, 7.1); matLean(-1, 4.6);
    matPile(WX - 1.4, -11.0, 5); matPile(-WX + 1.5, 9.8, 4);
    exitDoor(1, 11.4); exitDoor(-1, -11.6); exitDoor(1, -14.6);
    [-9.6, 9.6].forEach(function (y) { // puertas enrollables del almacén (−x)
      var xf = -WX;
      bx(S, xf, xf + 0.08, y - 1.6, y + 1.6, 0, 3.15, c.white); bx(S, xf, xf + 0.1, y - 1.45, y + 1.45, 0, 3.0, c.gray);
      for (var z = 0.25; z < 3.0; z += 0.25) bx(S, xf, xf + 0.12, y - 1.45, y + 1.45, z, z + 0.035, col('#80868e'));
    });
    // marcadores: carcasa negra y franja roja (la pantalla y el rótulo van en sus mallas)
    for (var e2 = -1; e2 <= 1; e2 += 2) {
      var xs = e2 * WX;
      bx(S, xs - e2 * 0.22, xs, -2.05, 2.05, 3.55, 5.65, c.dark); bx(S, xs - e2 * 0.22, xs, -2.05, 2.05, 5.65, 5.95, c.red);
      rod(S, xs - e2 * 0.1, -1.6, 5.95, xs - e2 * 0.02, -1.6, 6.4, 0.02, c.steel); rod(S, xs - e2 * 0.1, 1.6, 5.95, xs - e2 * 0.02, 1.6, 6.4, 0.02, c.steel);
    }

    // ---- grada telescópica de 6 filas (lado −y): tarimas, asientos moldeados por filas de colores, pasillo y barandillas ----
    var seats = [];
    for (var r = 0; r < NR; r++) {
      var yf = -(BY0 + r * RD), yb = yf - RD, zt = 0.12 + r * RZ, zs = zt + 0.42, ys = yf - 0.48, sc = r % 2 ? c.seatB : c.seatA, scD = sc.clone().multiplyScalar(0.78);
      bx(S, -BXH, BXH, yb, yf, 0, zt, c.deck);
      bx(S, -BXH, BXH, yf - 0.05, yf + 0.004, zt - 0.05, zt + 0.004, c.panel);
      [[-BXH + 0.1, -0.55], [0.55, BXH - 0.1]].forEach(function (h) {
        bx(S, h[0], h[1], ys - 0.19, ys + 0.19, zs - 0.06, zs, sc);
        bx(S, h[0], h[1], ys - 0.25, ys - 0.19, zs - 0.04, zs + 0.3, scD);
        bx(S, h[0], h[1], ys + 0.1, ys + 0.14, zt, zs - 0.06, c.rubber);
        for (var sx = h[0]; sx <= h[1] + 0.01; sx += 0.56) bx(S, sx - 0.016, sx + 0.016, ys - 0.24, ys + 0.2, zs - 0.05, zs + 0.012, c.dark);
      });
      // pasillo central: medio peldaño con cantonera amarilla
      bx(S, -0.55, 0.55, yf - 0.4, yf, zt, zt + 0.21, c.deck); bx(S, -0.55, 0.55, yf - 0.05, yf + 0.004, zt + 0.16, zt + 0.214, col('#ffc93c'));
      bx(S, -0.55, 0.55, yf - 0.05, yf + 0.004, zt - 0.05, zt + 0.004, col('#ffc93c'));
      for (var s2 = -1; s2 <= 1; s2 += 2) bx(S, s2 * BXH, s2 * (BXH + 0.08), yb, yf, 0, zt + 0.62, c.panel);
      // asientos ocupados: más gente en el centro y abajo (vecinos y familias)
      for (var px = -BXH + 0.38; px < BXH - 0.2; px += 0.56) {
        if (Math.abs(px) < 0.75) continue;
        var p = 0.62 - 0.045 * r - 0.022 * Math.abs(px);
        if (rnd() < p) seats.push({ x: px + (rnd() - 0.5) * 0.08, y: ys - 0.03, z: zs, fx: 0, fy: 1, row: r });
      }
    }
    var ztop = 0.12 + (NR - 1) * RZ, yback = -(BY0 + NR * RD);
    bx(S, -BXH - 0.08, BXH + 0.08, yback - 0.08, yback, 0, ztop + 1.0, c.panel);
    for (var s3 = -1; s3 <= 1; s3 += 2) {
      rod(S, s3 * (BXH + 0.04), -BY0, 0.95, s3 * (BXH + 0.04), yback, ztop + 0.95, 0.03, c.steel);
      rod(S, s3 * 0.6, -BY0, 1.0, s3 * 0.6, yback, ztop + 1.0, 0.025, c.steel);
    }
    for (var rx2 = -BXH; rx2 <= BXH + 0.01; rx2 += 2.68) rod(S, rx2, yback + 0.06, ztop + 1.0, rx2, yback + 0.06, ztop + 1.85, 0.03, c.steel);
    rod(S, -BXH, yback + 0.06, ztop + 1.85, BXH, yback + 0.06, ztop + 1.85, 0.03, c.steel);

    // ---- banquillos y tarima de la cámara de TV (los suplentes, entrenadores y cámara de Palau siguen ahí) ----
    var CR0 = AT.CREW_RISER, CBY = AT.CREW_BENCH_Y;
    for (var t = 0; t < 2; t++) {
      var sx2 = t === 0 ? 1 : -1, bxc = sx2 * AT.CREW_BENCH_X, seatZ = CR0 + 0.45;
      S.cbox(3.3, 0.8, CR0, bxc - sx2 * 0.25, 10.62, CR0 / 2, c.rubber, 0.04, 0.02);
      S.cbox(2.2, 0.4, 0.06, bxc, CBY + 0.12, seatZ, c.wood, 0.03, 0.02);
      S.cbox(2.2, 0.06, 0.4, bxc, CBY + 0.36, seatZ + 0.3, c.woodD, 0.02, 0.02);
      for (var lg = -1; lg <= 1; lg += 2) { bx(S, bxc + lg * 1.0 - 0.02, bxc + lg * 1.0 + 0.02, CBY - 0.06, CBY + 0.3, CR0, seatZ - 0.03, c.steel); }
    }
    S.cbox(1.2, 0.8, 0.42, -2.7, -10.62, 0.21, c.rubber, 0.04, 0.02);

    // ---- lateral de los vestuarios (+y): puertas, máquina de bebidas, fuente, vitrina, corcho, reloj y extintores ----
    [-10.5, 10.5].forEach(function (x) {
      bx(S, x - 0.68, x + 0.68, YN - 0.05, YN, 0, 2.36, c.white); bx(S, x - 0.56, x + 0.56, YN - 0.08, YN, 0, 2.24, c.door);
      bx(S, x + 0.36, x + 0.48, YN - 0.12, YN - 0.07, 1.0, 1.06, c.steel);
    });
    (function vending(x) {
      bx(S, x - 0.5, x + 0.5, YN - 0.85, YN, 0, 1.95, c.red); bx(S, x - 0.52, x + 0.52, YN - 0.87, YN, 1.95, 2.05, c.dark);
      bx(E, x - 0.44, x + 0.14, YN - 0.88, YN - 0.86, 0.8, 1.82, col('#fff4dc'));
      var dc = ['#e8504a', '#2fb6c9', '#ffc93c', '#7ad36a'];
      for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) bx(S, x - 0.4 + j * 0.13, x - 0.31 + j * 0.13, YN - 0.9, YN - 0.88, 0.9 + i * 0.24, 1.08 + i * 0.24, col(dc[(i + j) % 4]));
      bx(S, x + 0.2, x + 0.42, YN - 0.88, YN - 0.86, 1.0, 1.6, c.dark); bx(S, x - 0.4, x + 0.12, YN - 0.88, YN - 0.86, 0.22, 0.44, c.dark);
    })(-15.6);
    bx(S, -13.9, -13.5, YN - 0.35, YN, 0.6, 1.0, c.white); bx(S, -13.85, -13.55, YN - 0.36, YN - 0.3, 0, 0.6, c.steel); // fuente
    (function trophies(x) {
      bx(S, x - 1.12, x + 1.12, YN - 0.5, YN, 0, 2.05, c.woodD);
      bx(S, x - 1.0, x + 1.0, YN - 0.46, YN - 0.42, 0.1, 1.95, col('#2a2f3a'));
      [0.75, 1.3, 1.85].forEach(function (z, i) {
        bx(S, x - 1.0, x + 1.0, YN - 0.48, YN - 0.06, z - 0.025, z + 0.015, c.woodL);
        for (var q = 0; q < 5; q++) {
          var cx = x - 0.8 + q * 0.4 + (i % 2) * 0.12, gold = col(q % 3 ? '#e8c14a' : '#cfd6de');
          pt(S, BG.cyl, cx, YN - 0.27, z + 0.06, c.dark, 0, 0, 0, 0.06, 0.08, 0.06);
          pt(S, BG.cyl, cx, YN - 0.27, z + 0.17, gold, 0, 0, 0, 0.03, 0.14, 0.03);
          pt(S, BG.sph6, cx, YN - 0.27, z + 0.28, gold, 0, 0, 0, 0.09, 0.08, 0.09);
        }
      });
      bx(S, x - 1.12, x + 1.12, YN - 0.52, YN - 0.48, 1.98, 2.05, c.woodD);
    })(15.4);
    bx(S, -8.4, -6.2, YN - 0.04, YN, 1.4, 2.5, col('#b8875a')); // corcho con papeles
    ['#fff3c4', '#ffd3d8', '#cfe9ff', '#ffffff', '#d8f5c8'].forEach(function (pc, i) { bx(S, -8.25 + i * 0.42, -7.95 + i * 0.42, YN - 0.06, YN - 0.04, 1.6 + (i % 2) * 0.35, 2.0 + (i % 2) * 0.35, col(pc)); });
    pt(S, BG.cyl, 0, YN - 0.05, 6.0, c.dark, PI / 2, 0, 0, 0.5, 0.06, 0.5); pt(S, BG.cyl, 0, YN - 0.09, 6.0, c.white, PI / 2, 0, 0, 0.44, 0.04, 0.44); // reloj
    bx(S, -0.02, 0.02, YN - 0.13, YN - 0.11, 6.0, 6.32, c.dark); bx(S, 0, 0.24, YN - 0.13, YN - 0.11, 5.98, 6.02, c.dark);
    [-19.6, 19.6].forEach(function (x) { pt(S, BG.cyl, x, YN - 0.14, 0.95, c.red, 0, 0, 0, 0.1, 0.5, 0.1); pt(S, BG.cyl, x, YN - 0.14, 1.25, c.dark, 0, 0, 0, 0.04, 0.12, 0.04); });

    // ---- mallas ----
    var stat = new THREE.Mesh(S.build(), K.toonMat({ vertexColors: true }));
    stat.name = 'canrebotStatic'; stat.receiveShadow = true; stat.castShadow = false; G.add(stat); K.ink(stat);
    var em = new THREE.Mesh(E.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }));
    em.name = 'canrebotEmissive'; G.add(em);
    // suelo exterior (sustituye a outerFloor): lienzo pequeño, mismas líneas de balonmano que la tarima
    var oppm = K.ctx.isMobile ? 10 : 14, ocv = K.canvas(Math.round(2 * WX * oppm), Math.round((YN - YS) * oppm));
    drawOuter(ocv, rnd, K.FONT);
    var otex = K.texOf(ocv);
    var fm = CR.floorMat = K.toonMat({ map: otex });
    var of = new THREE.Mesh(new THREE.PlaneGeometry(2 * WX, YN - YS), fm);
    of.rotation.x = -PI / 2; VB.toThree(0, (YN + YS) / 2, -0.005, of.position); of.receiveShadow = true; of.name = 'canrebotFloor'; G.add(of);
    // público de la grada
    K.crowd(seats, { shirts: STREET, pants: PANTS, hatP: 0.05, name: 'canrebotCrowd', fan: function (st) { return st.x < -4 ? 0 : st.x > 4 ? 1 : 0.5; },
      sphere: new THREE.Sphere(new THREE.Vector3(0, 1.6, BY0 + NR * RD / 2), BXH + 3) });
    // marcadores de segmentos (los dos fondos, mismo lienzo): 1 dibujo
    var hi = !K.ctx.isMobile; CR.cv = K.canvas(hi ? 512 : 384, hi ? 256 : 192); drawScore(K, K.SB);
    CR.tex = K.texOf(CR.cv);
    var SQ = [], SU = [], SN = [], SI = [];
    function quad(L, cx, cy, cz, w, h, n, uv) {
      var nx = n === '+x' ? 1 : n === '-x' ? -1 : 0, ny = n === '+y' ? 1 : n === '-y' ? -1 : 0, rx = -ny, ryy = nx, v = new THREE.Vector3(), b = L.P.length / 3;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
        VB.toThree(cx + rx * q[0] * w / 2, cy + ryy * q[0] * w / 2, cz + q[1] * h / 2, v); L.P.push(v.x, v.y, v.z);
        VB.toThree(nx, ny, 0, v); L.N.push(v.x, v.y, v.z);
        L.U.push(q[0] < 0 ? uv[0] : uv[2], q[1] < 0 ? uv[1] : uv[3]);
      });
      L.I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    function geoOf(L) {
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(L.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(L.N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(L.U, 2)); g.setIndex(L.I); g.computeBoundingSphere(); return g;
    }
    var LS = { P: SQ, N: SN, U: SU, I: SI };
    quad(LS, WX - 0.235, 0, 4.6, 3.7, 1.85, '-x', [0, 0, 1, 1]); quad(LS, -WX + 0.235, 0, 4.6, 3.7, 1.85, '+x', [0, 0, 1, 1]);
    var sm = new THREE.Mesh(geoOf(LS), new THREE.MeshBasicMaterial({ map: CR.tex, toneMapped: false }));
    sm.material.color.setScalar(0.886); sm.name = 'canrebotScore'; G.add(sm); CR.score = sm;
    // rótulos (atlas toon con textura): letrero de la pared de la grada, pancartas, carteles y franjas de los marcadores
    CR.pcv = K.canvas(hi ? 1024 : 512, hi ? 512 : 256); drawPrints(CR.pcv, K.FONT); CR.ptex = K.texOf(CR.pcv);
    function uvOf(r) { return [r[0] / 1024, 1 - r[3] / 512, r[2] / 1024, 1 - r[1] / 512]; }
    var LP = { P: [], N: [], U: [], I: [] };
    quad(LP, 0, YS + 0.02, 4.85, 12, 1.5, '+y', uvOf(ATL.sign));
    quad(LP, -6.9, yback + 0.11, ztop + 1.45, 3.6, 0.9, '+y', uvOf(ATL.anims)); quad(LP, 6.9, yback + 0.11, ztop + 1.45, 3.6, 0.9, '+y', uvOf(ATL.club));
    quad(LP, 0, YN - 0.03, 3.6, 4.4, 1.1, '-y', uvOf(ATL.club));
    quad(LP, -10.5, YN - 0.03, 2.62, 1.2, 0.3, '-y', uvOf(ATL.v1)); quad(LP, 10.5, YN - 0.03, 2.62, 1.2, 0.3, '-y', uvOf(ATL.v2));
    quad(LP, -4.6, YN - 0.03, 1.95, 1.5, 0.37, '-y', uvOf(ATL.calc)); quad(LP, -4.6, YN - 0.03, 0.95, 1.2, 0.3, '-y', uvOf(ATL.poster));
    quad(LP, 4.6, YN - 0.03, 1.9, 1.6, 0.4, '-y', uvOf(ATL.poster)); quad(LP, 2.4, YN - 0.03, 2.0, 0.7, 0.35, '-y', uvOf(ATL.crest));
    [-9.6, 9.6].forEach(function (y) { quad(LP, -WX + 0.13, y, 3.4, 1.2, 0.3, '+x', uvOf(ATL.mag)); });
    quad(LP, WX - 0.225, 0, 5.8, 4.0, 0.25, '-x', uvOf(ATL.strip)); quad(LP, -WX + 0.225, 0, 5.8, 4.0, 0.25, '+x', uvOf(ATL.strip));
    quad(LP, WX - 0.03, 0, 6.85, 2.0, 1.0, '-x', uvOf(ATL.crest)); quad(LP, -WX + 0.03, 0, 6.85, 2.0, 1.0, '+x', uvOf(ATL.crest));
    var pm = new THREE.Mesh(geoOf(LP), K.toonMat({ map: CR.ptex })); pm.name = 'canrebotPrints'; pm.receiveShadow = true; G.add(pm);
    // haces de sol que bajan de los lucernarios (media y alta), en el sentido de la luz principal
    var beams = [];
    [-7.2, 0, 7.2].forEach(function (x1) { [-6.5, 5.5].forEach(function (y) { beams.push({ a: [x1 - 0.2, y, EAVE + 1.0], b: [x1 - 7.6, y - 1.6, 0], r0: 1.0, r1: 2.0 }); }); });
    var cm = CR.cones = K.coneMesh(beams, PALC.lamp, BEAM_K); cm.name = 'canrebotBeams'; G.add(cm);
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (CR.pcv && CR.ptex) { drawPrints(CR.pcv, K.FONT); CR.ptex.needsUpdate = true; } if (CR.cv) drawScore(K, K.SB); }); } catch (e3) { }
  }

  function quality(q, L, K) {
    if (CR.cones) CR.cones.visible = q && q.rank >= 1;
    if (CR.floorMat && L) CR.floorMat.color.setScalar(L.floor * LOOK.floorK);
    void K;
  }
  function step(t, rdt, g, K) {
    var M = K.mood();
    // el marcador se enciende un poco con el destello del punto (como los videomarcadores del Palau)
    if (CR.score) { var v = 0.886 * (1 + 0.22 * M.pf * K.soft()); if (Math.abs(CR.score.material.color.r - v) > 1e-3) CR.score.material.color.setScalar(v); }
    if (CR.cones && CR.cones.visible) CR.cones.material.uniforms.k.value = BEAM_K * (1 - 0.25 * M.tense) * (1 + 0.4 * M.win);
  }
  function dispose() { CR.cv = CR.tex = CR.pcv = CR.ptex = CR.floorMat = CR.cones = CR.score = null; }

  // luz de día: sol cálido y alto que entra por los lucernarios desde +x (keyDir con la distancia de la principal del Palau)
  var LOOK = {
    fog: '#d9cdb4', near: 36, far: 110, hemi: 0xf3e6c8, ground: 0x8f6a4a, key: 0xfff1c8, fill: 0xcfe3ff, rim: 0xfff6e4,
    keyK: 1.0, hemiK: 2.3, fillK: 1.1, rimK: 0.9, floorK: 1.12, haze: '#d9cdb4', hazeK: 0.04, crowdLight: 1.0, crowdDim: 0.12,
    keyDir: [15, 5, 23]
  };

  VB.Arena.registerMap({
    id: 'canrebot', kind: 'hall', seed: 5150871,
    hide: ['outerFloor', 'ledBoards', 'ledRefl', 'crowd0', 'crowd1', 'crowd2', 'crowd3', 'crowdImp', 'flags', 'endScreen', 'hungScreens', 'hallShell',
      'halos', 'lightCones', 'banners', 'hallName', 'camFlashes', 'static', 'emissive'],
    look: LOOK, floor: floor, floorLine: '#ffffff',
    score: { x: WX - 0.235, y: 0, z: 4.6, w: 3.7, h: 1.85 }, drawScore: drawScore,
    build: build, quality: quality, step: step, dispose: dispose
  });
})();
