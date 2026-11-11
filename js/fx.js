/* =====================================================================
 * VOLEY 3D — js/fx.js   (owner: arena)
 * Balón (esfera-cubo con 6 grupos de 3 paneles, como un balón real, con
 * efecto según el toque: liftado en el remate, casi sin giro en el saque
 * flotante), sombra de contacto, aro de caída que se cierra según el
 * tiempo que falta, línea de altura, estela tipo cinta en remates/saques
 * potentes, destellos, ondas de choque, chispas aditivas, marcas en el
 * suelo (blanca dentro / roja fuera), polvo al aterrizar y confeti.
 * Golpes: destello cálido y contenido (no tapa al jugador ni satura el
 * bloom); calidad 'perfect' del humano = anillo dorado + chispas doradas;
 * bloqueo 'stuff' contundente / 'soft'·'tool' suave; chispa en la cinta en
 * el toque de red; polvo de parquet en la plancha.
 * Review 2: una sola sombra (la de contacto), tamaño mínimo en pantalla + contorno del balón, "aro amarillo"
 * (focusRing) como objetivo principal que se cierra con hitWindow().press, retícula + arco de apuntado en saque
 * y remate del humano, huella del bote con filo verde/rojo (llamada de línea).
 * Coordenadas de sim -> three con VB.toThree. Sin asignaciones por frame.
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var THREE, ctx, C, Sim, root;
  var ballPivot, ball, ballMat, dropLine, marker, markerMat, focusRing, focusMat, focusU, focusD = 0, ballOutline;
  // Aro de aproximación (ARN-05): diámetros (m) de la diana y del aro móvil al nacer, y segundos de cierre hasta PULSAR.
  // Los planos miden 1 m: el aro de outlinedRingTex(104) mide 0,8125 m de diámetro y la diana de targetTex 0,875 m.
  var FR_D0 = 0.8, FR_D1 = 2.6, FR_T = 0.9, FR_RING = 0.8125, FR_TGT = 0.875, FR_ON = 0.24, FR_OFF = -0.15;
  var ballBs = 1, ballRim = null; // escala del balón por legibilidad (ARN-06) y uniforme del brillo de borde
  var aimRet, aimMat, aim = { a: 0, x: -6, y: 0, tx: -6, ty: 0, on: false, live: false, kill: 0 }, aimOut = { x: 0, y: 0, spreadNow: -1 };
  var hwOut = { t: 0, press: 0 }, focusVis = false;
  // A4 (remate apuntado): la retícula del remate mide lo que dice Sim.aimPoint().spreadNow (dispersión si pulsaras AHORA).
  // AIM_R1 = radio (m) del aro de aimTex con escala 1 (88/128 de un plano de 1,7 m); mínimo visible AIM_RMIN, tope AIM_RMAX.
  var AIM_R1 = 0.584, AIM_RMIN = 0.25, AIM_RMAX = 2.2, AIM_OR = null, AIM_OK = null, aimR = { r: 0.5, on: false, p: 0, f: 0.5 }; // f: radio REAL de la dispersión (disco del saque dirigible)
  // Saque dirigible (g.aim3.kind === 'serve'): misma diana cartoon con acento turquesa (AIM_SV) para no confundirla con la del
  // remate; dorada (AIM_OK) cuando la dispersión «si pulsaras ahora» es mínima. Desde la cámara de saque la diana está a
  // 9-18 m y se ve muy rasante: radio mínimo según la distancia a la cámara (AIM_SVK·d, con suelo AIM_SVMIN) para que el
  // aro siga siendo legible en 844×390. aimSv = ¿la diana de este frame es la del saque dirigible?
  // aimSvMap = textura propia (aro y marcas más gruesos que aimTex: a 15-20 m el aro de 9 px se quedaba en ~1 px); no gira:
  // se alinea con la mirada de la cámara y se alarga en profundidad (AIM_SVST, hasta ×3) para compensar lo rasante de la vista.
  // AIM_SVPX = radio mínimo del aro en píxeles CSS (de alto de visor) a la distancia de la diana.
  var AIM_SVR = 84 / 256 * 1.7; // radio (m) del aro de aimSvTex con escala 1
  var AIM_SV = null, AIM_SVMIN = 0.45, AIM_SVPX = 24, AIM_SVST = 3, aimSv = false, aimSvMap = null, aimSpMap = null, aimSt = 1;
  var DIG_TIGHT = 0.7; // g.digTight: el aro de golpeo del defensor humano se ve más pequeño tras un remate perfecto
  // B6 (challenge): huella del bote + línea resaltada durante g.review (3 calcomanías más en el lote del suelo, 0 dibujos)
  var aimFill = null; // A4: zona de dispersión del remate (disco tenue bajo la retícula, en el lote de calcomanías)
  var revFill = null, revLine = null, revGlow = null, rv = { on: false, hold: 0, x: 0.5, y: 0.5, res: -1, a: 0.5, k: 0.5, sx: 0.5, sy: 0.5 };
  // caché de hitWindow para el aro amarillo: la trayectoria es balística entre toques, así que «press» baja 1:1 con el
  // tiempo de sim. Se recalcula si cambia el balón (toque, red; la flotación del saque solo lo mece), el jugador, los
  // toques o si salta; cada 0,1 s; y en cada frame cerca del instante de pulsar (|press| < 0,5 s: ahí el relleno es la
  // señal de timing y es exacto). Medido (tools/out/hwcache.js, 60 s): 42 % menos llamadas, error del aro p95 2,6 %.
  var hwC = { press: 1.2, t: -1, p: null, vx: 0, vy: 0, touch: -1, tc: -1 };
  function focusPress(g, p) {
    var b = g.ball, age = g.time - hwC.t;
    if (hwC.p === p && hwC.touch === g.lastTouchT && Math.abs(b.vx - hwC.vx) + Math.abs(b.vy - hwC.vy) < 0.6 && age >= 0 && age < 0.1 &&
        Math.abs(hwC.press - age) > 0.5 && !(p.z > 0 || p.vz > 0) && g.touches === hwC.tc) return hwC.press - age;
    var press = 1.2, hw = Sim.hitWindow(g, p, hwOut);
    if (hw && isFinite(hw.press)) press = hw.press;
    hwC.press = press; hwC.t = g.time; hwC.p = p; hwC.vx = b.vx; hwC.vy = b.vy; hwC.touch = g.lastTouchT; hwC.tc = g.touches;
    return press;
  }
  var AIM_N = 30, aimArc = null; // arco punteado balón -> objetivo (se lee aunque el campo rival salga aplastado)
  var YEL = [1, 0.76, 0.04]; // "aro amarillo" = dónde tienes que jugar el balón (focusRing)
  var spinQ, squashQ, tmpQ, tv, tv2, tv3, axis, UPV;
  var spin = { rate: 0, sign: 1, wob: 0 }, squash = { t: 0, k: 0 }, heat = 0;
  var SQ_MAX = 0.095; // (1 + k/2) / (1 - k) ≈ 1,15: el balón se deforma sin dejar de leerse como balón
  // Campos de las partículas que nacen enteros (Smi) y luego reciben doubles: se generalizan al crear el pool (ver dblFields
  // en sim.js; si no, V8 depreca el mapa con la primera ráfaga de la partida y desoptimiza todo a la vez).
  function dblFields(o) { for (var k in o) { var v = o[k]; if (typeof v === 'number' && (v | 0) === v) { o[k] = 0.5; o[k] = v; } } return o; }
  var land = { x: 0, y: 0, z: 0, t: 0 };
  var qScale = 1; // factor de partículas por calidad

  var TEAM_LIN = null; // colores lineales por equipo

  // ---------- Texturas ----------
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(cv, srgb) { var t = new THREE.CanvasTexture(cv); if (srgb !== false) t.encoding = THREE.sRGBEncoding; return t; }
  function radialTex(stops, size) {
    size = size || 128; var cv = canvas(size, size), g = cv.getContext('2d'), h = size / 2, gr = g.createRadialGradient(h, h, 0, h, h, h);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = gr; g.fillRect(0, 0, size, size); return tex(cv);
  }
  function ringTex(inner, outer, soft) {
    var cv = canvas(256, 256), g = cv.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(Math.max(0, inner - soft), 'rgba(255,255,255,0)');
    gr.addColorStop(inner, 'rgba(255,255,255,1)'); gr.addColorStop(outer, 'rgba(255,255,255,1)');
    gr.addColorStop(Math.min(1, outer + soft), 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return tex(cv);
  }
  /** Aro con filo oscuro (se lee sobre la tarima clara): el blanco se tiñe con material.color, el negro queda negro. */
  function outlinedRingTex(r, w) {
    var cv = canvas(256, 256), g = cv.getContext('2d');
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(12,8,0,0.72)'; g.lineWidth = w + 14; g.beginPath(); g.arc(128, 128, r, 0, 6.283); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = w; g.beginPath(); g.arc(128, 128, r, 0, 6.283); g.stroke();
    return tex(cv);
  }
  /** Retícula de apuntado (saque / remate): aro, 4 marcas y punto central, con filo oscuro. */
  function aimTex() {
    var cv = canvas(256, 256), g = cv.getContext('2d');
    function draw(extra, style) {
      g.strokeStyle = style; g.fillStyle = style; g.lineCap = 'round';
      g.lineWidth = 9 + extra; g.beginPath(); g.arc(128, 128, 88, 0, 6.283); g.stroke();
      for (var k = 0; k < 4; k++) {
        var a = k * Math.PI / 2 + Math.PI / 4;
        g.lineWidth = 10 + extra; g.beginPath(); g.moveTo(128 + Math.cos(a) * 62, 128 + Math.sin(a) * 62); g.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.stroke();
      }
      g.beginPath(); g.arc(128, 128, 13 + extra / 2, 0, 6.283); g.fill();
    }
    draw(10, 'rgba(0,0,0,0.5)'); draw(0, '#ffffff');
    return tex(cv);
  }
  /** Diana del saque dirigible: aro grueso con filo oscuro, 4 marcas hacia dentro (en cruz: no gira) y punto central. */
  function aimSvTex() {
    var cv = canvas(256, 256), g = cv.getContext('2d');
    function draw(extra, style) {
      g.strokeStyle = style; g.fillStyle = style; g.lineCap = 'round';
      g.lineWidth = 22 + extra; g.beginPath(); g.arc(128, 128, 84, 0, 6.283); g.stroke();
      for (var k = 0; k < 4; k++) {
        var a = k * Math.PI / 2;
        g.lineWidth = 18 + extra; g.beginPath(); g.moveTo(128 + Math.cos(a) * 46, 128 + Math.sin(a) * 46); g.lineTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); g.stroke();
      }
      g.beginPath(); g.arc(128, 128, 15 + extra / 2, 0, 6.283); g.fill();
    }
    draw(16, 'rgba(10,6,20,0.62)'); draw(0, '#ffffff');
    return tex(cv);
  }
  /** Relleno de la marca del bote (ARN-04): disco translúcido CLARO teñido con el color de la llamada (material.color),
   *  más denso en el centro y con el borde suave. Antes era una huella marrón oscura que se leía como un «agujero». */
  function fillTex() {
    var cv = canvas(128, 128), g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.86)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.56)');
    gr.addColorStop(0.92, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(cv);
  }
  /** Filo de la marca (ARN-04): aro con filo oscuro y, para FUERA, una X diagonal gruesa sobre la huella (la llamada
   *  del juez de línea por FORMA, legible sin color: daltonismo y escala de grises). El blanco se tiñe con material.color. */
  function markRimTex(cross) {
    var cv = canvas(256, 256), g = cv.getContext('2d'), r = 100, w = 18;
    g.lineCap = 'round';
    function xs(lw, style) {
      g.strokeStyle = style; g.lineWidth = lw; var k = r * 0.62;
      g.beginPath(); g.moveTo(128 - k, 128 - k); g.lineTo(128 + k, 128 + k); g.moveTo(128 + k, 128 - k); g.lineTo(128 - k, 128 + k); g.stroke();
    }
    g.strokeStyle = 'rgba(12,8,0,0.72)'; g.lineWidth = w + 14; g.beginPath(); g.arc(128, 128, r, 0, 6.283); g.stroke();
    if (cross) xs(w + 16, 'rgba(12,8,0,0.78)');
    g.strokeStyle = '#ffffff'; g.lineWidth = w; g.beginPath(); g.arc(128, 128, r, 0, 6.283); g.stroke();
    if (cross) xs(w + 2, '#ffffff');
    return tex(cv);
  }
  /** Diana fija del aro de golpeo (ARN-05): aro fino con 4 marcas HACIA DENTRO (no se confunde con las marcas del bote
   *  ni con colores de equipo) y filo oscuro para leerse sobre la tarima. */
  function targetTex() {
    var cv = canvas(256, 256), g = cv.getContext('2d'), r = 112;
    function draw(ex, style) {
      g.strokeStyle = style; g.lineCap = 'round';
      g.lineWidth = 7 + ex; g.beginPath(); g.arc(128, 128, r, 0, 6.283); g.stroke();
      g.lineWidth = 9 + ex;
      for (var k = 0; k < 4; k++) { var a = k * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.moveTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); g.lineTo(128 + Math.cos(a) * (r - 30), 128 + Math.sin(a) * (r - 30)); g.stroke(); }
    }
    draw(10, 'rgba(10,6,0,0.75)'); draw(0, '#ffffff');
    return tex(cv);
  }
  /** Huella del balón para la revisión del challenge (B6): disco lleno de borde NÍTIDO con filo oscuro (el borde es lo que se
   *  mide contra la línea; el relleno suave de las marcas del bote lo emborronaba). r = 118/128 del plano. */
  function revTex() {
    var cv = canvas(256, 256), g = cv.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.62)'; g.beginPath(); g.arc(128, 128, 114, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(14,10,4,0.85)'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 114, 0, 6.283); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 109, 0, 6.283); g.stroke();
    return tex(cv);
  }
  /** Onda de choque: filo brillante fino con un halo interior muy tenue que cae a 0 (nada de disco gris). */
  function shockRingTex() {
    var cv = canvas(256, 256), g = cv.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.12)');
    gr.addColorStop(0.88, 'rgba(255,255,255,1)'); gr.addColorStop(0.93, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return tex(cv);
  }
  /** Balón: cada cara de la esfera-cubo es un grupo de 3 paneles. Teal (decisión de Ferran, 10-nov-2026): teal, crema y teal oscuro. */
  function ballTexture() {
    var S = 256, cv = canvas(S, S), g = cv.getContext('2d');
    var cols = ['#1cc4b4', '#fffaf0', '#0b8a86'];
    for (var i = 0; i < 3; i++) {
      var x0 = i * S / 3; // CARTOON: paneles planos (el sombreado lo ponen las bandas del toon)
      g.fillStyle = cols[i]; g.fillRect(x0, 0, S / 3 + 1, S);
    }
    // costuras (entre paneles y en el borde del grupo)
    g.fillStyle = 'rgba(29,21,48,0.8)'; // costuras de tinta
    g.fillRect(S / 3 - 3, 0, 6, S); g.fillRect(2 * S / 3 - 3, 0, 6, S);
    g.fillStyle = 'rgba(29,21,48,0.9)'; g.fillRect(0, 0, S, 5); g.fillRect(0, S - 5, S, 5); g.fillRect(0, 0, 5, S); g.fillRect(S - 5, 0, 5, S);
    // logotipo diminuto en el panel blanco
    g.save(); g.translate(S / 2, S / 2); g.rotate(-Math.PI / 2); g.fillStyle = 'rgba(8,92,90,0.55)';
    g.font = '900 22px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SALT·9', 0, 0); g.restore();
    var t = tex(cv); t.anisotropy = 4; return t;
  }
  function shade(hex, k) {
    var c = parseInt(hex.slice(1), 16), r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255;
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v * (1 + k)))); };
    return 'rgb(' + f(r) + ',' + f(gg) + ',' + f(b) + ')';
  }
  function ballGeometry(r) {
    var seg = 10, g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
    var p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal, per = (seg + 1) * (seg + 1);
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i) * 2, y = p.getY(i) * 2, z = p.getZ(i) * 2, face = Math.floor(i / per), u, w;
      // franjas perpendiculares entre caras vecinas (como un balón de 18 paneles)
      if (face < 2) { u = y; w = z; } else if (face < 4) { u = z; w = x; } else { u = x; w = y; }
      // la cara opuesta de cada par (normal negativa) mira al otro lado: sin invertir u, el logo sale en espejo
      if (face % 2 === 1) u = -u;
      uv.setXY(i, u * 0.5 + 0.5, w * 0.5 + 0.5);
      var sx = x * Math.sqrt(Math.max(0, 1 - y * y / 2 - z * z / 2 + y * y * z * z / 3));
      var sy = y * Math.sqrt(Math.max(0, 1 - z * z / 2 - x * x / 2 + z * z * x * x / 3));
      var sz = z * Math.sqrt(Math.max(0, 1 - x * x / 2 - y * y / 2 + x * x * y * y / 3));
      var l = Math.hypot(sx, sy, sz) || 1;
      n.setXYZ(i, sx / l, sy / l, sz / l); p.setXYZ(i, sx / l * r, sy / l * r, sz / l * r);
    }
    g.computeBoundingSphere(); return g;
  }

  // ---------- Pools ----------
  var SPARK_N = 220, sparks, sp = [], spHead = 0, spAlive = 0;
  var FLASH_N = 4, flashPool = [], flashHead = 0;
  var WAVE_N = 4, wavePool = [], waveHead = 0;
  var RIP_N = 6, ripPool = [], ripHead = 0;
  var MARK_N = 4, markPool = [], markHead = 0;
  var TN = 24, trail, tPts, tCols, tPos, trailA = 0, trailCol = null, trailW = 0.16, trailN = 0;
  var CONF_N = 520, conf, confD = [], confAlive = 0;
  var DUST_N = 96, dust, du = [], duHead = 0, duAlive = 0; // polvo (mezcla normal, no aditiva)
  // Pools reservados al máximo (alta) y limitados por calidad: las partículas se reparten en [0, cap) y solo se
  // dibuja/actualiza ese tramo (drawRange). Media 70 %, baja ~40 % (además de qScale, que reduce cada ráfaga).
  var spCap = SPARK_N, duCap = DUST_N, confCap = CONF_N;

  function addSpark(x, y, z, vx, vy, vz, life, r, g, b, grav) {
    var s = sp[spHead]; spHead = (spHead + 1) % spCap;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = life; s.max = life; s.r = r; s.g = g; s.b = b; s.grav = grav;
  }
  function burstAt(x, y, z, n, power, r, g, b, up, grav) {
    if (tbLow && toon && toon.visible) return; // baja: con piezas cartoon vivas no hay chispas (pico de dibujos, ARN-12)
    n = Math.max(1, Math.round(n * qScale));
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, e = Math.random() * 1.3 - 0.25, v = power * (0.35 + Math.random() * 0.85);
      addSpark(x, y, z, Math.cos(a) * Math.cos(e) * v, Math.sin(a) * Math.cos(e) * v, Math.sin(e) * v + (up || 0.8),
        0.25 + Math.random() * 0.35, r, g, b, grav == null ? 9 : grav);
    }
    spAlive = 1; sparks.visible = true;
  }
  /** Polvo de parquet (coords de sim): velo bajo, a ras de suelo, que sale de debajo del cuerpo y se apaga en ~0,3 s.
   *  (x, y) es el punto de referencia; con dirección (dirx, diry) las partículas se reparten a lo largo de la línea del
   *  cuerpo tumbado, de x - dir·back (piernas) a x + dir·fwd (pecho), nunca en la cabeza ni en las manos. Salen sobre
   *  todo hacia los lados (lo que el cuerpo aparta al deslizarse) y un poco hacia delante (push). */
  function dustAt(x, y, n, spread, dirx, diry, push, back, fwd) {
    n = Math.max(2, Math.round(n * qScale));
    var dl = Math.sqrt(dirx * dirx + diry * diry), ux = dl > 1e-4 ? dirx / dl : 0, uy = dl > 1e-4 ? diry / dl : 0;
    back = back || 0; fwd = fwd || 0;
    for (var i = 0; i < n; i++) {
      var d = du[duHead]; duHead = (duHead + 1) % duCap;
      var u = fwd - Math.random() * (back + fwd), side = Math.random() < 0.5 ? -1 : 1;
      var a = Math.random() * 6.283, r0 = 0.06 + Math.random() * 0.1, v = spread * (0.35 + Math.random() * 0.65), f = push * (0.2 + Math.random() * 0.6);
      d.x = x + ux * u + Math.cos(a) * r0; d.y = y + uy * u + Math.sin(a) * r0; d.z = 0.02 + Math.random() * 0.04;
      if (dl > 1e-4) { // perpendicular a la línea del cuerpo (con algo de dispersión) + deslizamiento hacia delante
        var pj = (Math.random() - 0.5) * 0.7;
        d.vx = (-uy * side + ux * pj) * v + ux * f; d.vy = (ux * side + uy * pj) * v + uy * f;
      } else { d.vx = Math.cos(a) * v; d.vy = Math.sin(a) * v; }
      d.vz = 0.06 + Math.random() * 0.16;
      d.life = d.max = 0.22 + Math.random() * 0.18; d.s = 0.55 + Math.random() * 0.45; d.g = 0;
    }
    duAlive = 1;
  }
  /** Atenúa destellos muy cerca de la cámara (golpes del propio jugador): que no tapen la jugada. */
  function nearFade(p) { var d = ctx.camera.position.distanceTo(p); return Math.max(0.12, Math.min(1, (d - 2) / 6)); }
  var FLASH_K = 0.48; // intensidad del destello aditivo (CARTOON: 0,62 → 0,48; el impacto lo cuentan la explosión y las estrellas dibujadas)
  /** ARN-13 «destellos suaves» (ctx.settings.softFlash, Ajustes → Accesibilidad): destellos y ondas de impacto al 40 %. */
  function softK() { var st = ctx.settings; return st && st.softFlash ? 0.4 : 1; }
  function flashAt(x, y, z, size, dur, r, g, b) {
    var f = flashPool[flashHead], k = FLASH_K * softK(); flashHead = (flashHead + 1) % FLASH_N;
    VB.toThree(x, y, z, f.s.position); f.t = dur; f.d = dur; f.size = size; f.s.material.color.setRGB(r * k, g * k, b * k); f.s.visible = true;
    f.near = nearFade(f.s.position);
  }
  function shockAt(x, y, z, size, dur, r, g, b) {
    var w = wavePool[waveHead], k = softK(); waveHead = (waveHead + 1) % WAVE_N;
    VB.toThree(x, y, z, w.s.position); w.t = dur; w.d = dur; w.size = size; w.s.material.color.setRGB(r * k, g * k, b * k); w.s.visible = true;
    w.near = nearFade(w.s.position);
  }
  function rippleAt(x, y, size, dur, r, g, b, op) {
    var w = ripPool[ripHead]; ripHead = (ripHead + 1) % RIP_N;
    w.m.position.x = x; w.m.position.z = -y; w.t = dur; w.d = dur; w.size = size; w.op = op || 0.8;
    w.m.material.color.setRGB(r, g, b); w.m.visible = true;
  }
  /** Marca del bote (la "llamada" del juez de línea): huella oscura en la tarima orientada según el vuelo
   *  + filo de color (verde = dentro, rojo = fuera, mismo C.IN_TOL que el árbitro de sim). Dura 5 s para
   *  cubrir todo el plano del punto; entra con un pulso. */
  var MARK_LIFE = 5.2, MARK_IN = null, MARK_OUT = null, rimInTex = null, rimOutTex = null;
  function markAt(x, y, inside, speed, vx, vy) {
    var m = markPool[markHead]; markHead = (markHead + 1) % MARK_N;
    m.m.position.x = x; m.m.position.z = -y; m.r.position.x = x; m.r.position.z = -y;
    m.t = MARK_LIFE; m.d = MARK_LIFE;
    var s = 0.46 + Math.min(0.16, speed * 0.012), hs = Math.hypot(vx || 0, vy || 0);
    m.s = s; m.stretch = 1 + Math.min(0.18, hs * 0.012); // apenas ovalado: el relleno llena el aro sin salirse
    // óvalo alargado en la dirección del vuelo (sim (vx,vy) -> plano del suelo; rotation.z gira en el plano)
    m.m.rotation.z = hs > 0.1 ? Math.atan2(vy, vx) : 0;
    m.m.scale.set(s * 1.24 * m.stretch, s * 1.24, 1);
    // DENTRO = disco claro verde + aro; FUERA = disco claro rojo + aro con X (forma = llamada; el color es secundario)
    if (inside) { m.r.material.color.setRGB(0.12, 0.9, 0.24); m.m.material.color.copy(MARK_IN); m.r.material.map = rimInTex; }
    else { m.r.material.color.setRGB(1, 0.05, 0.03); m.m.material.color.copy(MARK_OUT); m.r.material.map = rimOutTex; }
    m.inside = !!inside;
    m.m.visible = true; m.r.visible = true;
  }

  /* Calcomanías del suelo en UN dibujo (InstancedMesh): rellenos de las marcas del bote, sus filos, ondas, marcador de caída y
   * retícula de apuntado. Antes cada una era una malla (hasta 4 + 4 + 6 + 2 dibujos; 3-5 en un bote normal, en el mismo frame
   * que el aro y la línea de altura: los picos de dibujos en baja). Las mallas de siempre siguen existiendo FUERA de la escena
   * como «estado» (posición, giro, escala, color, opacidad, textura, visible): el código que las anima no cambia y writeDecals
   * las copia cada frame en instancias, en el orden de antes (rellenos → filos y ondas → marcador → retícula).
   * Atlas 1024×1024 = 4×4 celdas de 256 px (9 usadas: la 8 es la diana del saque dirigible; antes 1024×512 = 4×2) (potencia de 2: cada mip divide las celdas exactamente; con celdas de 272 px y
   * margen los mips no potencia de 2 emborronaban la retícula lejana). */
  var decE = null, decals = null, DEC_CELL = 256, DEC_ROWS = 4, decTex = [], decOrder = [], decSz = [], decM = null, decV = null, decP = null, decQ = null, decY = null;
  var DROP_TONE = 0.763; // la Line de antes pasaba por ACES (blanco 1 → 0,763); el lote no lleva tono: mismo blanco en pantalla
  function buildDecals(texs) {
    var cv = canvas(4 * DEC_CELL, DEC_ROWS * DEC_CELL), g = cv.getContext('2d');
    for (var i = 0; i < texs.length; i++) {
      var cx = (i % 4) * DEC_CELL, cy = Math.floor(i / 4) * DEC_CELL;
      g.drawImage(texs[i].image, cx, cy, 256, 256);
      decTex.push(texs[i]);
    }
    g.fillStyle = '#ffffff'; g.fillRect(2 * DEC_CELL, DEC_CELL, DEC_CELL, DEC_CELL); // celda 6: blanco liso (línea de altura)
    footAtlas(g); // celdas 9-11: huellas de la playa
    var at = tex(cv);
    var N = MARK_N * 2 + RIP_N + 7 + FOOT_N, geo = new THREE.PlaneGeometry(1, 1);
    for (var fI = 0; fI < FOOT_N; fI++) fp.push(dblFields({ x: 0.5, y: 0.5, yaw: 0.5, k: 0, sx: 0.5, sy: 0.5, op: 0.5, t: 0.5 })); for (var fJ = 0; fJ < FOOT_N; fJ++) fp[fJ].t = 0;
    var inst = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      uniforms: { map: { value: at } }, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: 'attribute vec4 aCol; attribute vec2 aCell; varying vec4 vCol; varying vec2 vUv;\n' +
        'void main(){ vCol = aCol; vUv = aCell.x < 0.0 ? vec2(0.625, 1.0 - 1.5 / ' + DEC_ROWS + '.0) : (aCell + uv * 256.0) / vec2(1024.0, ' + DEC_ROWS * DEC_CELL + '.0);\n' +
        ' gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vCol; varying vec2 vUv;\n' +
        'void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vCol.rgb, t.a * vCol.a);\n#include <encodings_fragment>\n}' }), N);
    inst.geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    inst.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage));
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.count = 0; inst.visible = false; inst.frustumCulled = false; inst.renderOrder = 3; inst.name = 'floorDecals';
    root.add(inst); decals = inst;
    for (var m = 0; m < MARK_N; m++) decOrder.push(markPool[m].m);
    for (var r = 0; r < MARK_N; r++) decOrder.push(markPool[r].r);
    for (var p = 0; p < RIP_N; p++) decOrder.push(ripPool[p].m);
    decOrder.push(marker, aimFill, aimRet, revGlow, revLine, revFill);
    // lado del plano de cada malla (marcador 1,15 m, retícula 1,7 m; el resto 1 m; la huella de revisión lleva su escala): el lote usa un plano de 1 m
    for (var z = 0; z < decOrder.length; z++) decSz.push(decOrder[z].geometry.parameters.width || 1);
    decM = new THREE.Matrix4(); decV = new THREE.Vector3(); decP = new THREE.Vector3(); decQ = new THREE.Quaternion(); decY = new THREE.Vector3(0, 1, 0); decE = new THREE.Euler();
  }
  /* ---------- PLAYA: arena que salta y huellas que se desvanecen (solo con VB.Arena.venue() === 'beach') ----------
   * Arena: el MISMO pool de polvo (Points), con gravedad por partícula (arcos cortos que caen) y color de arena seca.
   * Huellas: pies descalzos al correr (cada ~0,6 m, alternando pie), surco de la plancha y cráter del balón; van en el lote
   * de calcomanías (celdas 9-11 del atlas, debajo de todo lo demás): 0 dibujos nuevos. Se apagan en los últimos 2 s. */
  var FOOT_N = 96, footCap = FOOT_N, fp = [], fpHead = 0, fpLast = [], fpAlive = 0, FOOT_LIFE = 6.5;
  var FP_CELL = [9, 10, 11]; // 0 = pie, 1 = surco de la plancha, 2 = cráter del balón
  function onBeach() { var A = VB.Arena; return !!(A && A.venue && A.venue() === 'beach'); }
  function footAtlas(g) {
    var C0 = DEC_CELL, x, y;
    // celda 9: pie descalzo mirando a +u (talón a la izquierda), hundido (oscuro) con el reborde de arena empujada delante
    x = (9 % 4) * C0; y = Math.floor(9 / 4) * C0;
    g.save(); g.translate(x + C0 / 2, y + C0 / 2);
    g.fillStyle = 'rgba(255,246,224,0.55)'; g.beginPath(); g.ellipse(14, 0, 98, 40, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(96,58,26,0.8)';
    g.beginPath(); g.ellipse(-52, 0, 32, 26, 0, 0, Math.PI * 2); g.fill();                     // talón
    g.beginPath(); g.ellipse(18, -3, 56, 33, -0.06, 0, Math.PI * 2); g.fill();                 // planta
    g.beginPath(); g.ellipse(-16, 4, 40, 18, 0, 0, Math.PI * 2); g.fill();                     // arco
    var toes = [[86, -20, 13], [84, 2, 11], [78, 20, 9.5], [70, 33, 8], [61, 43, 7]];
    for (var t = 0; t < toes.length; t++) { g.beginPath(); g.arc(toes[t][0], toes[t][1], toes[t][2], 0, Math.PI * 2); g.fill(); }
    g.restore();
    // celda 10: surco alargado de la plancha (a lo largo de +u) con arena amontonada en el borde delantero
    x = (10 % 4) * C0; y = Math.floor(10 / 4) * C0;
    g.save(); g.translate(x + C0 / 2, y + C0 / 2);
    var gr = g.createRadialGradient(0, 0, 10, 0, 0, 120); gr.addColorStop(0, 'rgba(118,78,40,0.55)'); gr.addColorStop(0.75, 'rgba(118,78,40,0.32)'); gr.addColorStop(1, 'rgba(118,78,40,0)');
    g.scale(1, 0.36); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 120, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,246,224,0.55)'; g.beginPath(); g.ellipse(112, 0, 14, 105, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    // celda 11: cráter del balón (hoyo redondo con reborde claro)
    x = (11 % 4) * C0; y = Math.floor(11 / 4) * C0;
    var gc = g.createRadialGradient(x + C0 / 2, y + C0 / 2, 0, x + C0 / 2, y + C0 / 2, C0 / 2);
    gc.addColorStop(0, 'rgba(110,72,36,0.6)'); gc.addColorStop(0.55, 'rgba(130,88,46,0.45)'); gc.addColorStop(0.72, 'rgba(255,246,224,0.6)'); gc.addColorStop(1, 'rgba(255,246,224,0)');
    g.fillStyle = gc; g.fillRect(x, y, C0, C0);
  }
  /** Huella (coords de sim): kind 0 pie, 1 surco, 2 cráter; yaw en rad de sim; sx, sy = tamaño en m. */
  function footAt(x, y, yaw, kind, sx, sy, op) {
    var f = fp[fpHead]; fpHead = (fpHead + 1) % footCap;
    f.x = x; f.y = y; f.yaw = yaw; f.k = kind; f.sx = sx; f.sy = sy; f.op = op; f.t = FOOT_LIFE; fpAlive = 1;
  }
  /** Arena que salta (coords de sim): n granos en abanico hacia (dirx, diry) (o en corona sin dirección); power ~0,4-1,2. */
  function sandAt(x, y, n, power, dirx, diry, spread) {
    n = Math.max(2, Math.round(n * qScale));
    var dl = Math.sqrt(dirx * dirx + diry * diry), ux = dl > 1e-4 ? dirx / dl : 0, uy = dl > 1e-4 ? diry / dl : 0;
    for (var i = 0; i < n; i++) {
      var d = du[duHead]; duHead = (duHead + 1) % duCap;
      var a = Math.random() * 6.283, r0 = Math.random() * (spread || 0.2), v = power * (0.8 + Math.random() * 1.8);
      d.x = x + Math.cos(a) * r0; d.y = y + Math.sin(a) * r0; d.z = 0.04;
      var hx = Math.cos(a), hy = Math.sin(a);
      if (dl > 1e-4) { hx = hx * 0.55 + ux * 0.9; hy = hy * 0.55 + uy * 0.9; }
      d.vx = hx * v * 0.8; d.vy = hy * v * 0.8; d.vz = power * (1.4 + Math.random() * 2.4);
      d.life = d.max = 0.55 + Math.random() * 0.4; d.s = 0.7 + Math.random() * 0.3; d.g = 9.5;
    }
    duAlive = 1;
  }
  /** Por frame: una huella cada ~0,6 m que recorre cada atleta con los pies en el suelo (alternando pie). */
  function updateFootprints(g, dt) {
    var ps = g.players, n = ps ? ps.length : 0, P = VB.Players, rigs = P && P.rigs;
    for (var i = 0; i < n; i++) {
      var p = ps[i], x = p.x, y = p.y;
      if (rigs) for (var j = 0; j < rigs.length; j++) if (rigs[j] && rigs[j].p === p && rigs[j].root) { x = rigs[j].root.position.x; y = -rigs[j].root.position.z; break; }
      var L = fpLast[i]; if (!L) L = fpLast[i] = { x: x, y: y, side: 1 };
      var dx = x - L.x, dy = y - L.y, d2 = dx * dx + dy * dy;
      if (d2 > 6.25) { L.x = x; L.y = y; continue; }            // recolocación entre puntos: sin rastro
      if ((p.z || 0) > 0.06) { L.x = x; L.y = y; continue; }     // en el aire
      if (d2 < 0.36) continue;
      var dd = Math.sqrt(d2), yaw = Math.atan2(dy, dx), side = L.side = -L.side, ox = -dy / dd * 0.1 * side, oy = dx / dd * 0.1 * side;
      footAt(x + ox, y + oy, yaw + side * 0.08, 0, 0.34, 0.34, 0.9);
      L.x = x; L.y = y;
    }
    if (!fpAlive || !(dt > 0)) return;
    var alive = 0;
    for (var k = 0; k < footCap; k++) { var f = fp[k]; if (f.t > 0) { f.t -= dt; alive++; } }
    if (!alive) fpAlive = 0;
  }
  function writeDecals() {
    if (!decals) return;
    var n = 0, ca = decals.geometry.attributes.aCol, cl = decals.geometry.attributes.aCell, A = ca.array, B = cl.array;
    // línea de altura balón → suelo (antes THREE.Line = 1 dibujo propio): tira vertical que mira a la cámara, ~1,3 px de ancho
    if (dropLine.visible && dropLine.material.opacity > 0.002) {
      var la = dropLine.geometry.attributes.position.array, cam = ctx.camera, h = la[1] - la[4];
      if (h > 0.01) {
        decP.set(la[0], (la[1] + la[4]) * 0.5, la[2]);
        var dx = cam.position.x - decP.x, dz = cam.position.z - decP.z, dist = Math.max(0.5, Math.sqrt(dx * dx + dz * dz + (cam.position.y - decP.y) * (cam.position.y - decP.y)));
        var wpx = 2 * dist * Math.tan(cam.fov * Math.PI / 360) / Math.max(200, ctx.height || 720); // metros por píxel CSS a esa distancia
        decQ.setFromAxisAngle(decY, Math.atan2(dx, dz)); decV.set(1.3 * wpx, h, 1);
        decals.setMatrixAt(n, decM.compose(decP, decQ, decV));
        A[0] = A[1] = A[2] = DROP_TONE; A[3] = dropLine.material.opacity; B[0] = -1; B[1] = -1; // aCell < 0: uv fija en el centro de la celda blanca (sin mips)
        n++;
      }
    }
    // huellas de la playa (debajo de marcas, ondas y aros)
    if (fpAlive) for (var fi = 0; fi < footCap; fi++) {
      var F = fp[fi]; if (F.t <= 0) continue;
      decP.set(F.x, 0.011 + fi * 0.00002, -F.y); decE.set(-Math.PI / 2, 0, F.yaw); decQ.setFromEuler(decE); decV.set(F.sx, F.sy, 1);
      decals.setMatrixAt(n, decM.compose(decP, decQ, decV));
      var cl0 = FP_CELL[F.k]; A[n * 4] = A[n * 4 + 1] = A[n * 4 + 2] = 1; A[n * 4 + 3] = F.op * Math.min(1, F.t / 2);
      B[n * 2] = (cl0 % 4) * DEC_CELL; B[n * 2 + 1] = (DEC_ROWS - 1 - Math.floor(cl0 / 4)) * DEC_CELL;
      n++;
    }
    for (var i = 0; i < decOrder.length; i++) {
      var o = decOrder[i]; if (!o.visible) continue;
      var mt = o.material, op = mt.opacity; if (op <= 0.002) continue;
      var slot = decTex.indexOf(mt.map); if (slot < 0) continue;
      o.updateMatrix(); var sz = decSz[i]; decals.setMatrixAt(n, sz === 1 ? o.matrix : decM.copy(o.matrix).scale(decV.set(sz, sz, 1)));
      A[n * 4] = mt.color.r; A[n * 4 + 1] = mt.color.g; A[n * 4 + 2] = mt.color.b; A[n * 4 + 3] = op;
      B[n * 2] = (slot % 4) * DEC_CELL; B[n * 2 + 1] = (DEC_ROWS - 1 - Math.floor(slot / 4)) * DEC_CELL; // v hacia arriba: fila 0 del lienzo = arriba
      n++;
    }
    decals.count = n; decals.visible = n > 0;
    if (n) { decals.instanceMatrix.needsUpdate = true; ca.needsUpdate = true; cl.needsUpdate = true; }
  }
  /* Destellos y ondas de choque (antes 4 + 4 Sprites: 2-3 dibujos en cada remate, justo en el pico de dibujos) en UN dibujo:
   * carteles orientados a cámara en un InstancedMesh aditivo (con mezcla aditiva el orden no cambia nada). Los Sprites siguen
   * existiendo FUERA de la escena como estado (posición, escala, color, opacidad, visible). Atlas 512×256: destello | onda. */
  var bills = null, billOrder = [];
  function buildBills(flashTex, shockTex) {
    var cv = canvas(512, 256), g = cv.getContext('2d');
    g.drawImage(flashTex.image, 0, 0, 256, 256); g.drawImage(shockTex.image, 256, 0, 256, 256);
    var N = FLASH_N + WAVE_N;
    var inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { map: { value: tex(cv) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: 'attribute vec4 aCol; attribute float aCell; varying vec4 vCol; varying vec2 vUv;\n' +
        'void main(){ vCol = aCol; vUv = vec2((aCell + uv.x) * 0.5, uv.y);\n' +
        ' vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), 1.0);\n' +
        ' vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0); mv.xy += position.xy * sc.xy; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vCol; varying vec2 vUv;\n' +
        'void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vCol.rgb, t.a * vCol.a);\n#include <encodings_fragment>\n}' }), N);
    inst.geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    inst.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.count = 0; inst.visible = false; inst.frustumCulled = false; inst.renderOrder = 8; inst.name = 'impactBills';
    root.add(inst); bills = inst;
    for (var f = 0; f < FLASH_N; f++) billOrder.push(flashPool[f].s);
    for (var w = 0; w < WAVE_N; w++) billOrder.push(wavePool[w].s);
  }
  function writeBills() {
    if (!bills) return;
    var n = 0, ca = bills.geometry.attributes.aCol, cl = bills.geometry.attributes.aCell, A = ca.array;
    for (var i = 0; i < billOrder.length; i++) {
      var o = billOrder[i]; if (!o.visible) continue;
      var mt = o.material, op = mt.opacity; if (op <= 0.002) continue;
      o.updateMatrix(); bills.setMatrixAt(n, o.matrix);
      A[n * 4] = mt.color.r; A[n * 4 + 1] = mt.color.g; A[n * 4 + 2] = mt.color.b; A[n * 4 + 3] = op;
      cl.array[n] = i < FLASH_N ? 0 : 1;
      n++;
    }
    bills.count = n; bills.visible = n > 0;
    if (n) { bills.instanceMatrix.needsUpdate = true; ca.needsUpdate = true; cl.needsUpdate = true; }
  }
  /* ---------------------------------------------------------------------
   * FX CARTOON (9-nov-2026): estrellas de impacto, «explosión» de cómic, nubes de polvo de dibujo, líneas de velocidad y
   * onomatopeya («¡PAM!») en el remate perfecto del humano. Todo en UN InstancedMesh con mezcla normal (no aditiva: el
   * dibujo lleva tinta oscura) y un atlas de lienzo 1024×512 (4×2 celdas de 256 px). 0 dibujos si no hay nada vivo; 1 si hay.
   * Calidad baja: la mitad de estrellas y nubes, sin líneas de velocidad ni onomatopeya. «Destellos suaves» (softFlash):
   * la explosión al 45 % y sin rebote de escala, la onomatopeya más pequeña y translúcida.
   * --------------------------------------------------------------------- */
  var TB_N = 48, toon = null, tb = [], tbHead = 0, tbAlive = 0, tbAtlas = null, tbM = null, tbP = null, tbS = null, tbQ = null;
  var TBK = { star: 0, burst: 1, puff: 2, line: 3, ono: 4, spark: 6 };
  var tbMute = { pop: 1, ox: 0, oy: 0, vx: 0 }; // pieza descartada (calidad baja con el pico de dibujos lleno)
  // tope de tamaño en pantalla por tipo (fracción del alto visible a esa distancia): de cerca no tapan la jugada
  var TB_MAXF = [0.06, 0.17, 0.13, 0.2, 0.1, 0.05, 0.05, 0.05];
  var TB_CELL = [[0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [0, 0, 2, 1], [2, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1]]; // [col, fila (v), ancho, alto] en celdas
  var tbLow = false, speedT = 0, tbRight = null, tbUp = null, ballVel = null; // ballVel: velocidad del balón en coords three
  var INK = '#1d1530';
  function tbStar(g, cx, cy, R, r, n, rot) {
    g.beginPath();
    for (var i = 0; i < n * 2; i++) { var a = rot + i * Math.PI / n, rr = i % 2 ? r : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath();
  }
  function drawToonAtlas(cv) {
    var g = cv.getContext('2d'), C2 = 256; g.clearRect(0, 0, cv.width, cv.height); g.lineJoin = 'round'; g.lineCap = 'round';
    // 0: estrella amarilla de 5 puntas con tinta y brillo
    tbStar(g, 128, 134, 104, 46, 5, -Math.PI / 2); g.fillStyle = '#ffd93b'; g.fill(); g.lineWidth = 14; g.strokeStyle = INK; g.stroke();
    tbStar(g, 112, 112, 30, 14, 5, -Math.PI / 2); g.fillStyle = 'rgba(255,255,240,0.9)'; g.fill();
    // 1: explosión de cómic (picos irregulares, blanco cálido con corazón amarillo)
    var ox = C2;
    g.save(); g.translate(ox + 128, 128);
    g.beginPath(); for (var i = 0; i < 24; i++) { var a = i * Math.PI / 12, rr = i % 2 ? 62 + (i * 37 % 11) : 112 - (i * 53 % 17); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath();
    g.fillStyle = '#fff6dc'; g.fill(); g.lineWidth = 10; g.strokeStyle = INK; g.stroke();
    g.beginPath(); for (var j = 0; j < 16; j++) { var b = j * Math.PI / 8 + 0.2, r2 = j % 2 ? 30 : 58; g.lineTo(Math.cos(b) * r2, Math.sin(b) * r2); } g.closePath();
    g.fillStyle = '#ffcf33'; g.fill();
    g.restore();
    // 2: nube de polvo de dibujo (círculos solapados, tinta, sombra lavanda abajo)
    ox = 2 * C2;
    var P = [[128, 150, 70], [76, 150, 48], [182, 150, 48], [104, 104, 50], [156, 108, 46]];
    g.save(); g.translate(ox, 0);
    g.fillStyle = INK; for (var k = 0; k < P.length; k++) { g.beginPath(); g.arc(P[k][0], P[k][1], P[k][2] + 8, 0, 6.283); g.fill(); }
    g.fillStyle = '#fbf5ea'; for (var k2 = 0; k2 < P.length; k2++) { g.beginPath(); g.arc(P[k2][0], P[k2][1], P[k2][2], 0, 6.283); g.fill(); }
    g.fillStyle = 'rgba(150,130,210,0.45)'; g.beginPath(); g.ellipse(128, 182, 92, 26, 0, 0, 6.283); g.fill();
    g.restore();
    // 3: línea de velocidad (trazo afilado blanco con filo de tinta, a lo largo de x)
    ox = 3 * C2;
    g.save(); g.translate(ox, 0);
    g.beginPath(); g.moveTo(8, 128); g.quadraticCurveTo(128, 104, 248, 122); g.lineTo(248, 134); g.quadraticCurveTo(128, 152, 8, 128); g.closePath();
    g.fillStyle = INK; g.fill();
    g.beginPath(); g.moveTo(26, 128); g.quadraticCurveTo(128, 112, 240, 125); g.lineTo(240, 131); g.quadraticCurveTo(128, 144, 26, 128); g.closePath();
    g.fillStyle = '#ffffff'; g.fill();
    g.restore();
    // 4-5 (fila de abajo, 512×256): «¡PAM!» grueso, amarillo con tinta y sombra desplazada (estilo cómic)
    g.save(); g.translate(256, C2 + 132); g.rotate(-0.08); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 900 170px "Barlow Condensed", "Arial Black", Impact, sans-serif';
    g.lineWidth = 26; g.strokeStyle = INK; g.fillStyle = INK; g.strokeText('¡PAM!', 10, 10); g.fillText('¡PAM!', 10, 10);
    g.strokeText('¡PAM!', 0, 0); g.fillStyle = '#ffd23f'; g.fillText('¡PAM!', 0, 0);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.save(); g.beginPath(); g.rect(-260, -90, 520, 50); g.clip(); g.fillText('¡PAM!', 0, 0); g.restore();
    g.restore();
    // 6: chispa de 4 puntas (toques suaves)
    g.save(); g.translate(2 * C2 + 128, C2 + 128);
    tbStar(g, 0, 0, 100, 22, 4, 0); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 10; g.strokeStyle = INK; g.stroke();
    g.restore();
  }
  function buildToonFx() {
    var cv = canvas(1024, 512); drawToonAtlas(cv); tbAtlas = tex(cv);
    var inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { map: { value: tbAtlas }, uGain: { value: 1 } }, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: 'attribute vec4 aCol; attribute vec4 aCell; attribute float aRot; varying vec4 vCol; varying vec2 vUv;\n' +
        'void main(){ vCol = aCol; vUv = (aCell.xy + uv * aCell.zw) * vec2(0.25, 0.5);\n' +
        ' vec2 sc = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz)); vec2 p = position.xy * sc;\n' +
        ' float c = cos(aRot), s = sin(aRot); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);\n' +
        ' vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0); mv.xy += p; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vCol; varying vec2 vUv;\n' +
        'uniform float uGain;\nvoid main(){ vec4 t = texture2D(map, vUv); float a = t.a * vCol.a; if (a < 0.01) discard; gl_FragColor = vec4(t.rgb * vCol.rgb * uGain, a);\n#include <encodings_fragment>\n}' }), TB_N);
    inst.geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(TB_N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    inst.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(TB_N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    inst.geometry.setAttribute('aRot', new THREE.InstancedBufferAttribute(new Float32Array(TB_N), 1).setUsage(THREE.DynamicDrawUsage));
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.count = 0; inst.visible = false; inst.frustumCulled = false; inst.renderOrder = 9; inst.name = 'toonFx';
    root.add(inst); toon = inst;
    for (var i = 0; i < TB_N; i++) tb.push(dblFields({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0.5, s1: 0.5, rot: 0, vr: 0, kind: 0, r: 1, g: 1, b: 1, a: 1, grav: 0, ox: 0, oy: 0, pop: 1 }));
    tbM = new THREE.Matrix4(); tbP = new THREE.Vector3(); tbS = new THREE.Vector3(); tbQ = new THREE.Quaternion(); tbRight = new THREE.Vector3(); tbUp = new THREE.Vector3();
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { try { drawToonAtlas(cv); tbAtlas.needsUpdate = true; } catch (e) { } }); } catch (e) { }
  }
  /** Nueva pieza (coords de sim para x, y, z y velocidad). */
  function tbAdd(kind, x, y, z, vx, vy, vz, life, s0, s1, rot, vr, r, g, b, a, grav) {
    // baja: si ya se dibujan chispas y destellos a la vez, no se añade el tercer dibujo (ARN-12); la pieza va a un hueco mudo
    if (tbLow && spAlive && bills && bills.visible && !toon.visible) return tbMute;
    var q = tb[tbHead]; tbHead = (tbHead + 1) % TB_N;
    q.kind = kind; q.x = x; q.y = y; q.z = z; q.vx = vx; q.vy = vy; q.vz = vz; q.life = life; q.max = life; q.s0 = s0; q.s1 = s1;
    q.rot = rot; q.vr = vr; q.r = r; q.g = g; q.b = b; q.a = a; q.grav = grav || 0; q.ox = 0; q.oy = 0; q.pop = 1;
    tbAlive = 1; return q;
  }
  function toonOn() { return !!toon; }
  /** Estrellas que salen del impacto (n antes de la calidad). */
  function starsAt(x, y, z, n, power, size) {
    if (!toonOn()) return;
    n = Math.max(1, Math.round(n * (tbLow ? 0.5 : 1)));
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, v = power * (0.6 + Math.random() * 0.6);
      tbAdd(TBK.star, x, y, z, Math.cos(a) * v, Math.sin(a) * v, 1.2 + Math.random() * 1.6, 0.42 + Math.random() * 0.16,
        size * (0.8 + Math.random() * 0.4), size * 0.3, Math.random() * 6.283, (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 5), 1, 1, 1, 1, 5);
    }
  }
  function burstToon(x, y, z, size, dur) {
    if (!toonOn()) return;
    var soft = softK() < 1, q = tbAdd(TBK.burst, x, y, z, 0, 0, 0, dur, size * 0.7, size * (soft ? 0.95 : 1.2), Math.random() * 6.283, 0, 1, 1, 1, soft ? 0.45 : 0.95, 0);
    q.pop = soft ? 0 : 1;
  }
  function sparkToon(x, y, z, n, size) {
    if (!toonOn() || tbLow) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283;
      tbAdd(TBK.spark, x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, z + (Math.random() - 0.3) * 0.2, Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.6, 0.26,
        size, size * 0.2, Math.random(), 4, 1, 1, 1, 0.95, 0);
    }
  }
  /** Nubes de polvo de dibujo a lo largo de (dirx, diry) desde (x, y), en el suelo. */
  function puffsAt(x, y, n, dirx, diry, len, size) {
    if (!toonOn()) return;
    n = Math.max(1, Math.round(n * (tbLow ? 0.5 : 1)));
    var dl = Math.sqrt(dirx * dirx + diry * diry), ux = dl > 1e-4 ? dirx / dl : 0, uy = dl > 1e-4 ? diry / dl : 0;
    for (var i = 0; i < n; i++) {
      var u = n > 1 ? (i / (n - 1) - 0.5) * len : 0, side = (i % 2 ? 1 : -1) * (0.15 + Math.random() * 0.2), a = Math.random() * 6.283;
      var px = x + ux * u - uy * side + (dl > 1e-4 ? 0 : Math.cos(a) * 0.25), py = y + uy * u + ux * side + (dl > 1e-4 ? 0 : Math.sin(a) * 0.25);
      var ov = 0.5 + Math.random() * 0.5;
      tbAdd(TBK.puff, px, py, 0.18 + Math.random() * 0.08, (dl > 1e-4 ? -uy * side : Math.cos(a)) * ov, (dl > 1e-4 ? ux * side : Math.sin(a)) * ov, 0.35 + Math.random() * 0.3,
        0.5 + Math.random() * 0.2, size * (0.55 + Math.random() * 0.25), size * (1.05 + Math.random() * 0.3), (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.2, 1, 0.97, 0.92, 0.95, -0.3);
    }
  }
  /** Líneas de velocidad que siguen al balón durante `dur` s (remates fuertes y saques en salto). */
  function speedLines(n, dur) {
    if (!toonOn() || tbLow) return;
    speedT = dur;
    for (var i = 0; i < n; i++) {
      var q = tbAdd(TBK.line, 0, 0, 0, 0, 0, 0, dur * (0.75 + Math.random() * 0.25), 0.7 + Math.random() * 0.5, 0.5, 0, 0, 1, 1, 1, 0.9, 0);
      var a = (i / n) * 6.283 + Math.random() * 0.6; q.ox = Math.cos(a) * (0.16 + Math.random() * 0.14); q.oy = Math.sin(a) * (0.16 + Math.random() * 0.14); q.vx = 0.35 + Math.random() * 0.5; // vx = retraso tras el balón (m)
    }
  }
  /** «¡PAM!» junto al impacto (remate perfecto del humano). Ajuste opcional ctx.settings.comicText === false lo apaga. */
  function onoAt(x, y, z) {
    if (!toonOn() || tbLow) return;
    var st = ctx.settings; if (st && st.comicText === false) return;
    var soft = softK() < 1;
    var q = tbAdd(TBK.ono, x, y, z + 0.75, 0, 0, 0.35, 0.85, soft ? 0.75 : 1.05, soft ? 0.75 : 1.05, 0, 0, 1, 1, 1, soft ? 0.7 : 1, 0);
    q.pop = soft ? 0 : 1;
  }
  function updateToonFx(dt) {
    if (!toon) return;
    if (!tbAlive) { if (toon.visible) { toon.visible = false; toon.count = 0; } return; }
    var cam = ctx.camera, me = cam.matrixWorld.elements, n = 0, cp = cam.position, vis2 = 2 * Math.tan(cam.fov * Math.PI / 360);
    // con bloom (alta) el dibujo se queda bajo el umbral (0,82): sin halo alrededor de la tinta
    toon.material.uniforms.uGain.value = VB.Arena && VB.Arena.postActive && VB.Arena.postActive() ? 0.8 : 1;
    tbRight.set(me[0], me[1], me[2]); tbUp.set(me[4], me[5], me[6]);
    var A = toon.geometry.attributes.aCol.array, Ce = toon.geometry.attributes.aCell.array, R = toon.geometry.attributes.aRot.array;
    if (speedT > 0 && dt > 0) speedT -= dt;
    // dirección del balón en pantalla (para las líneas de velocidad)
    var bv = ballVel, bl = Math.sqrt(bv.x * bv.x + bv.y * bv.y + bv.z * bv.z), bx = bl > 0.1 ? bv.x / bl : 0, by = bl > 0.1 ? bv.y / bl : 0, bz = bl > 0.1 ? bv.z / bl : 0;
    var lrot = Math.atan2(bx * tbUp.x + by * tbUp.y + bz * tbUp.z, bx * tbRight.x + by * tbRight.y + bz * tbRight.z);
    for (var i = 0; i < TB_N; i++) {
      var q = tb[i]; if (q.life <= 0) continue;
      if (dt > 0) {
        q.life -= dt; if (q.life <= 0) continue;
        if (q.kind !== TBK.line) {
          q.vz -= q.grav * dt; var dr = q.kind === TBK.puff ? 1 - 3 * dt : 1 - 1.5 * dt; q.vx *= dr; q.vy *= dr;
          q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.rot += q.vr * dt;
          if (q.kind === TBK.puff && q.vz < 0.05) q.vz = 0.05;
        }
      }
      var u = 1 - q.life / q.max, s, al = q.a;
      if (q.kind === TBK.star || q.kind === TBK.spark) { s = u < 0.15 ? q.s0 * (0.4 + 4 * u) : q.s0 + (q.s1 - q.s0) * ((u - 0.15) / 0.85); al *= u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3; }
      else if (q.kind === TBK.burst) { s = q.s0 + (q.s1 - q.s0) * Math.sqrt(u); if (q.pop) s *= 1 + 0.25 * Math.sin(Math.min(1, u * 3) * Math.PI); al *= 1 - u * u; }
      else if (q.kind === TBK.puff) { s = q.s0 + (q.s1 - q.s0) * (1 - (1 - u) * (1 - u)); al *= u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45; }
      else if (q.kind === TBK.ono) {
        s = q.s0 * (q.pop ? (u < 0.12 ? 0.35 + 0.8 * (u / 0.12) * 1.15 : u < 0.2 ? 1.27 - (u - 0.12) / 0.08 * 0.27 : 1) : 1);
        al *= u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      } else { // línea de velocidad: detrás del balón, desplazada en el plano de la pantalla
        if (bl < 4) al = 0;
        var lag = q.vx + 0.25;
        q.x = ballPivot.position.x - bx * lag + tbRight.x * q.ox + tbUp.x * q.oy;
        q.z = ballPivot.position.y - by * lag + tbRight.y * q.ox + tbUp.y * q.oy;
        q.y = -(ballPivot.position.z - bz * lag + tbRight.z * q.ox + tbUp.z * q.oy);
        s = q.s0; al *= (1 - u) * Math.min(1, u * 8 + 0.3);
      }
      if (al <= 0.01 || s <= 0.001) continue;
      // coords de sim (x, y, z) -> three (x, z, -y)
      tbP.set(q.x, q.z, -q.y);
      var dcx = tbP.x - cp.x, dcy = tbP.y - cp.y, dcz = tbP.z - cp.z, dc = Math.sqrt(dcx * dcx + dcy * dcy + dcz * dcz), smax = dc * vis2 * TB_MAXF[q.kind];
      if (s > smax) s = smax;
      if (dc < 3) al *= Math.max(0.15, (dc - 1) / 2); // pegado a la cámara: casi transparente
      var cell = TB_CELL[q.kind], w = cell[2], h = cell[3];
      if (q.kind === TBK.line) tbS.set(s, s * 0.07 * 4, 1); else tbS.set(s * w / h, s, 1);
      tbM.compose(tbP, tbQ, tbS); toon.setMatrixAt(n, tbM);
      A[n * 4] = q.r; A[n * 4 + 1] = q.g; A[n * 4 + 2] = q.b; A[n * 4 + 3] = al;
      Ce[n * 4] = cell[0]; Ce[n * 4 + 1] = cell[1]; Ce[n * 4 + 2] = w; Ce[n * 4 + 3] = h;
      R[n] = q.kind === TBK.line ? lrot : q.rot;
      n++;
    }
    toon.count = n; toon.visible = n > 0;
    if (n) { toon.instanceMatrix.needsUpdate = true; toon.geometry.attributes.aCol.needsUpdate = true; toon.geometry.attributes.aCell.needsUpdate = true; toon.geometry.attributes.aRot.needsUpdate = true; }
    else tbAlive = 0;
  }
  function startTrail(r, g, b, width, strength) {
    trailA = strength; trailW = width; trailCol.setRGB(r, g, b); trailN = 0;
    var bp = ballPivot.position;
    for (var i = 0; i < TN; i++) { tPts[i * 3] = bp.x; tPts[i * 3 + 1] = bp.y; tPts[i * 3 + 2] = bp.z; }
  }
  function updateTrail(dt) {
    if (trailA <= 0) { trail.visible = false; return; }
    trail.visible = true;
    if (dt > 0) {
      trailA = Math.max(0, trailA - dt * 1.25);
      tPts.copyWithin(3, 0, (TN - 1) * 3);
      var bp = ballPivot.position; tPts[0] = bp.x; tPts[1] = bp.y; tPts[2] = bp.z; trailN = Math.min(TN, trailN + 1);
    }
    var cam = ctx.camera.position;
    for (var i = 0; i < TN; i++) {
      var j = Math.min(i, Math.max(0, trailN - 1));
      var i0 = Math.max(0, j - 1), i1 = Math.min(TN - 1, j + 1);
      tv.set(tPts[i0 * 3] - tPts[i1 * 3], tPts[i0 * 3 + 1] - tPts[i1 * 3 + 1], tPts[i0 * 3 + 2] - tPts[i1 * 3 + 2]);
      tv2.set(cam.x - tPts[j * 3], cam.y - tPts[j * 3 + 1], cam.z - tPts[j * 3 + 2]);
      tv3.crossVectors(tv, tv2); var l = tv3.length();
      var f = 1 - i / (TN - 1), w = trailW * (ballBs < 1.8 ? ballBs : 1.8) * (0.25 + 0.75 * f) * (l > 1e-6 ? 1 / l : 0);
      tv3.multiplyScalar(w);
      var px = tPts[j * 3], py = tPts[j * 3 + 1], pz = tPts[j * 3 + 2];
      tPos[i * 6] = px + tv3.x; tPos[i * 6 + 1] = py + tv3.y; tPos[i * 6 + 2] = pz + tv3.z;
      tPos[i * 6 + 3] = px - tv3.x; tPos[i * 6 + 4] = py - tv3.y; tPos[i * 6 + 5] = pz - tv3.z;
      var a = trailA * Math.pow(f, 1.6) * (i < trailN ? 1 : 0);
      var cr = trailCol.r * a, cg = trailCol.g * a, cb = trailCol.b * a;
      tCols[i * 6] = cr; tCols[i * 6 + 1] = cg; tCols[i * 6 + 2] = cb; tCols[i * 6 + 3] = cr; tCols[i * 6 + 4] = cg; tCols[i * 6 + 5] = cb;
    }
    trail.geometry.attributes.position.needsUpdate = true; trail.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- Apuntado (saque / remate del humano) ----------
  function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
  /** Dirección de apuntado actual en MUNDO (normalizada) o null. Lee la entrada de mundo que main.js deja
   *  en ctx.simMove (si existe); si no, la última dirección dada durante el gesto (g.swingAim). */
  var _aimDir = [0, 0];
  function aimDir(g) {
    var mv = ctx.simMove;
    if (mv && mv.length >= 2) {
      var l = Math.hypot(mv[0], mv[1]);
      if (l > 0.2) { _aimDir[0] = mv[0] / l; _aimDir[1] = mv[1] / l; return _aimDir; }
      if (!g.swingHasAim) return null;
    }
    if (g.swingHasAim && g.swingAim) { _aimDir[0] = g.swingAim[0]; _aimDir[1] = g.swingAim[1]; return _aimDir; }
    return null;
  }
  /** Objetivo previsto del golpe del humano (coords de sim) o 0 si no toca apuntar.
   *  Devuelve 1 = previsualización (saque aún sin lanzar), 2 = apuntado activo.
   *  Si sim expone Sim.aimPoint(g, out) se usa; si no, reproduce las fórmulas de sim.js
   *  (doServe sin objetivo de IA y attackTarget con dd = 6). Sin el error aleatorio de ejecución. */
  function aimTarget(g, out) {
    if (g.demo || g.autopilot) return 0;
    var b = g.ball, a, tx, ty, mode = 0, a3s = g.aim3;
    aimSv = false;
    // Saque dirigible: sim pone g.aim3 = {on, kind:'serve', x, y} mientras saca el humano. La posición es la de la diana
    // (exacta, sin suavizar) y el radio, la dispersión que da Sim.aimPoint (spreadNow; si no, spread). Sin kind: como antes.
    if (g.mode === 'serve' && a3s && a3s.on && a3s.kind === 'serve' && isFinite(a3s.x) && isFinite(a3s.y)) {
      aimSv = true; out.spreadNow = -1;
      var rs = Sim.aimPoint ? Sim.aimPoint(g, out, ctx.simMove) : null, sn = -1;
      if (rs && rs.kind === 'serve') sn = typeof rs.spreadNow === 'number' && rs.spreadNow >= 0 ? rs.spreadNow : rs.spread;
      out.spreadNow = typeof sn === 'number' && isFinite(sn) && sn >= 0 ? sn : -1; // sin dato (sim antigua): radio por defecto
      out.x = a3s.x; out.y = a3s.y;
      return 2;
    }
    if (g.mode === 'serve') {
      var sv = g.server; if (!sv || sv.team !== 0) return 0;
      mode = g.serveState === 'toss' ? 2 : (g.serveAuth ? 1 : 0);
      if (!mode) return 0;
    } else if (g.mode === 'rally') {
      var hp = g.ctrl, a3 = g.aim3;
      if (a3 && a3.on) mode = 2; // A1: mira libre de sim (atacante humano en el aire en el 3r toque), desde el despegue
      else {
        if (!hp || hp.team !== 0 || hp.z < 0.05 || !(VB.Sim.atkPhase ? VB.Sim.atkPhase(g, 0) : g.touchTeam === 0 && g.touches === 2)) return 0;
        if (g.swingLive && g.swingShot === 'jset') return 0; // colocando en salto: sin retícula de ataque
        if (b.x < -0.2 || b.x > 4.5 || b.z < 1.6) return 0;
        mode = 2;
      }
    } else return 0;
    out.spreadNow = -1;
    if (Sim.aimPoint) {
      var r = Sim.aimPoint(g, out, ctx.simMove); // entrada de MUNDO de este mismo frame (sin ella, la del último paso)
      if (!r) return 0;
      if (r !== out && r.x != null) { out.x = r.x; out.y = r.y; if (r.spreadNow != null) out.spreadNow = r.spreadNow; }
      if (g.mode === 'rally' && g.aim3 && g.aim3.on && isFinite(g.aim3.x) && isFinite(g.aim3.y)) { out.x = g.aim3.x; out.y = g.aim3.y; }
      return mode;
    }
    a = aimDir(g);
    if (g.mode === 'serve') {
      tx = -6; ty = 0;
      if (a) { tx += a[0] * 2.4; ty += a[1] * 3.4; }
      tx = -clampN(-tx, 2, 8.4); ty = clampN(ty, -4, 4);
    } else {
      tx = -6; ty = (g.ctrl.y >= 0 ? -1 : 1) * 1.6; // sin apuntar: diagonal
      if (a) { tx = -5 + a[0] * 3.0; ty = a[1] * 3.7; }
      tx = -clampN(-tx, 1.4, 8.3); ty = clampN(ty, -3.9, 3.9);
    }
    if (g.mode === 'rally' && g.aim3 && g.aim3.on && isFinite(g.aim3.x) && isFinite(g.aim3.y)) { tx = g.aim3.x; ty = g.aim3.y; }
    out.x = tx; out.y = ty;
    return mode;
  }

  // ---------- Revisión del challenge (B6) ----------
  /** Línea más cercana al bote (x, y) en coords de sim: la de fondo (|x| = HL) o la lateral (|y| = HW). Coloca la línea
   *  resaltada encima de la línea pintada (5 cm, por DENTRO de las medidas, como arena.js) y la huella con el radio del balón
   *  hacia la línea (el borde de la huella es el del balón: lo que mide dist), algo alargada a lo largo de la línea. */
  /** Medias medidas de la pista de la partida (playa 8×4; pabellón y 6v6 9×4,5): g.HL/g.HW de la sim, y VB.C sin partida. */
  function courtHL(g) { g = g || (ctx && ctx.game); return g && g.HL > 0 ? g.HL : C.HL; }
  function courtHW(g) { g = g || (ctx && ctx.game); return g && g.HW > 0 ? g.HW : C.HW; }
  function placeReview(x, y) {
    var HL = courtHL(), HW = courtHW();
    var dEnd = HL - Math.abs(x), dSide = HW - Math.abs(y), L = 0.05, LEN = 2.6, end = Math.abs(dEnd) <= Math.abs(dSide);
    var fs = 2 * C.BR * 128 / 114; // plano de la huella: el disco de revTex mide 114/128
    revFill.position.x = x; revFill.position.z = -y; revFill.rotation.z = 0;
    revLine.rotation.z = 0; revGlow.rotation.z = 0;
    if (end) {
      var lx = (x >= 0 ? 1 : -1) * (HL - L / 2), ly = clampN(y, -HW + LEN / 2 - 0.4, HW - LEN / 2 + 0.4);
      revLine.position.x = lx; revLine.position.z = -ly; revLine.scale.set(L + 0.012, LEN, 1);
      revGlow.position.x = lx; revGlow.position.z = -ly; revGlow.scale.set(0.3, LEN * 1.15, 1);
      rv.sx = fs; rv.sy = fs * 1.18; // radio del balón en x (hacia la línea de fondo), 18 % más a lo largo
    } else {
      var sy = (y >= 0 ? 1 : -1) * (HW - L / 2), sx = clampN(x, -HL + LEN / 2 - 0.4, HL - LEN / 2 + 0.4);
      revLine.position.x = sx; revLine.position.z = -sy; revLine.scale.set(LEN, L + 0.012, 1);
      revGlow.position.x = sx; revGlow.position.z = -sy; revGlow.scale.set(LEN * 1.15, 0.3, 1);
      rv.sx = fs * 1.18; rv.sy = fs;
    }
  }
  /** Huella + línea resaltada mientras dura g.review (y ~2 s más tras el resultado, del color de la verdad: verde dentro,
   *  rojo fuera). La huella aparece cuando la cámara ya ha bajado (~0,7 s). Lee g.review con guardas: sin él no hace nada. */
  function updateReview(g, rdt) {
    var R = g.review;
    if (R && isFinite(R.x) && isFinite(R.y)) {
      if (!rv.on || R.x !== rv.x || R.y !== rv.y) { rv.x = R.x; rv.y = R.y; rv.res = -1; placeReview(R.x, R.y); }
      rv.on = true; rv.hold = 2.2;
      rv.k = clampN(((R.t || 0) - 0.55) / 0.35, 0, 1); // aparición de la huella
    } else if (rv.on) {
      rv.hold -= rdt; rv.k = 1;
      if (rv.hold <= 0) rv.on = false;
    }
    rv.a = rv.on ? Math.min(1, rv.a + rdt * 5, rv.hold / 0.5) : 0;
    var vis = rv.a > 0.01;
    revFill.visible = revLine.visible = revGlow.visible = vis;
    if (!vis) return;
    var pul = 0.5 + 0.5 * Math.sin(ctx.time * 6);
    revLine.material.opacity = rv.a * (0.7 + 0.25 * pul);
    revGlow.material.opacity = rv.a * (0.2 + 0.1 * pul);
    var k = rv.k, pop = k < 1 ? 1 + 0.35 * (1 - k) : 1;
    revFill.scale.set(rv.sx * pop, rv.sy * pop, 1);
    revFill.material.opacity = rv.a * 0.95 * k;
    if (rv.res === 1) revFill.material.color.setRGB(0.2, 1, 0.35);
    else if (rv.res === 0) revFill.material.color.setRGB(1, 0.25, 0.18);
    else revFill.material.color.setRGB(0.95, 0.95, 1);
  }
  /** Arco punteado del balón al objetivo, pasando por encima de la red (vista previa de la dirección, no física). */
  function updateAimArc(b, tx, ty, a, col) {
    var cr = col ? col.r : 1, cg = col ? col.g : 0.36, cb = col ? col.b : 0.09;
    var pa = aimArc.geometry.attributes.position.array, ca = aimArc.geometry.attributes.color.array;
    var sx = b.x, sy = b.y, sz = b.z, t0 = sx !== tx ? sx / (sx - tx) : 0.5;
    t0 = clampN(t0, 0.15, 0.85);
    var zNet = sz * (1 - t0), h = Math.max(0.5, (C.NET_H + 0.55 - zNet) / (4 * t0 * (1 - t0)));
    var scroll = (ctx.time * 1.6) % 1;
    for (var i = 0; i < AIM_N; i++) {
      var t = (i + scroll) / AIM_N, x = sx + (tx - sx) * t, y = sy + (ty - sy) * t, z = sz * (1 - t) + 4 * h * t * (1 - t);
      pa[i * 3] = x; pa[i * 3 + 1] = Math.max(0.03, z); pa[i * 3 + 2] = -y;
      var k = a * 0.95 * Math.min(1, 0.3 + t * 4);
      ca[i * 4] = cr; ca[i * 4 + 1] = cg; ca[i * 4 + 2] = cb; ca[i * 4 + 3] = k;
    }
    aimArc.geometry.attributes.position.needsUpdate = true; aimArc.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- Sombras de contacto (ARN-11) ----------
  /* Instancia 0 = balón, 1..4 = atletas. Cada mancha es un plano en el suelo con su matriz (posición, giro, escala
   * elíptica) y un atributo aK = oscurecimiento en el centro (0..1). El fragmento devuelve 1 - aK·perfil y la mezcla
   * multiplica el destino por ese valor (CustomBlending ZERO, SRC_COLOR). El valor sale de linearToOutputTexel(v^2,2):
   * a pantalla (salida sRGB) multiplica por ~v; al destino lineal del post, por v^2,2. Así «un 20 % más oscuro» es lo
   * mismo en baja (sin post) que en alta (con post). */
  // capacidad: balón + 12 atletas (6v6); se dibujan solo 1 + max(4, atletas) (blobs.count): en 2v2, 5 como siempre
  var BLOB_N = 13, blobs = null, blobK = null, blobM = null, blobQ = null, blobS = null, blobP = null;
  var BLOB_VS = 'attribute float aK; varying vec2 vUv; varying float vK;\n' +
    'void main(){ vUv = uv; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }';
  var BLOB_FS = [
    'varying vec2 vUv; varying float vK;',
    'void main(){',
    ' float d = length(vUv - 0.5) * 2.0;',
    // perfil casi gaussiano que llega a 0 justo en el borde del plano (sin filo visible)
    // CARTOON: disco de borde más definido (no gaussiano) y sombra violácea (#2b2547 mezclado), no gris
    ' float sh = 1.0 - smoothstep(0.62, 1.0, d);',
    ' vec3 v = mix(vec3(1.0), vec3(0.42, 0.37, 0.72), clamp(vK * sh * 1.5, 0.0, 1.0));',
    ' gl_FragColor = vec4(pow(v, vec3(2.2)), 1.0);',
    '#include <encodings_fragment>',
    '}'].join('\n');
  function buildBlobs() {
    var geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    blobK = new Float32Array(BLOB_N);
    geo.setAttribute('aK', new THREE.InstancedBufferAttribute(blobK, 1).setUsage(THREE.DynamicDrawUsage));
    var mat = new THREE.ShaderMaterial({ vertexShader: BLOB_VS, fragmentShader: BLOB_FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, toneMapped: false });
    blobs = new THREE.InstancedMesh(geo, mat, BLOB_N);
    blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    blobs.frustumCulled = false; blobs.renderOrder = 2; blobs.name = 'contactBlobs'; blobs.count = 5;
    blobM = new THREE.Matrix4(); blobQ = new THREE.Quaternion(); blobS = new THREE.Vector3(); blobP = new THREE.Vector3();
    for (var i = 0; i < BLOB_N; i++) setBlob(i, 0, 0, 0.01, 0.01, 0, 0);
    root.add(blobs);
  }
  /** (x, y) sim; sx a lo largo de `yaw` (rad, sim), sy de través; k = oscurecimiento en el centro. */
  function setBlob(i, x, y, sx, sy, yaw, k) {
    blobP.set(x, 0.012 + i * 0.0004, -y); blobQ.setFromAxisAngle(UPV, yaw); blobS.set(sx, 1, sy);
    blobM.compose(blobP, blobQ, blobS); blobs.setMatrixAt(i, blobM);
    if (blobK[i] !== k) { blobK[i] = k; blobs.geometry.attributes.aK.needsUpdate = true; }
    blobs.instanceMatrix.needsUpdate = true;
  }
  var BLOB_K = [0.36, 0.3, 0.26]; // oscurecimiento central por calidad [baja, media, alta] (en alta ya hay sombra real nítida)
  var blobKq = BLOB_K[2];
  /** Una mancha suave bajo cada atleta (~0,8 x 0,9 m), más oscura en el centro, que se agranda y se apaga con la altura del
   *  salto (0 a 1,5 m) y se alarga en la dirección del cuerpo cuando está tumbado (plancha). Lee la posición VISUAL del rig
   *  (VB.Players: incluye la convergencia de la celebración y el desfase de la plancha); sin rigs, la de sim. */
  function updateAthleteBlobs(g) {
    var P = VB.Players, rigs = P && P.rigs, ps = g.players, n = ps ? Math.min(BLOB_N - 1, ps.length) : 0, nb = n > 4 ? n : 4;
    if (blobs.count !== nb + 1) blobs.count = nb + 1;
    for (var i = 0; i < n; i++) {
      var p = ps[i], r = null;
      if (rigs) for (var j = 0; j < rigs.length; j++) if (rigs[j] && rigs[j].p === p) { r = rigs[j]; break; }
      var x = p.x, y = p.y, z = p.z > 0 ? p.z : 0, yaw = 0, lie = 0;
      if (r && r.root) { x = r.root.position.x; y = -r.root.position.z; yaw = r.yaw || 0; lie = r.lieW > 0 ? (r.lieW < 1 ? r.lieW : 1) : 0; }
      var hz = clampN(z / 1.5, 0, 1), fade = (1 - hz) * (1 - hz), grow = 1 + 0.35 * hz;
      // tumbado: mancha larga a lo largo del cuerpo y algo adelantada (el pecho), algo más clara (repartida)
      var sx = (0.78 + 1.2 * lie) * grow, sy = (0.92 - 0.2 * lie) * grow;
      var off = 0.85 * lie; // la raíz queda en los pies: el centro del cuerpo tumbado está ~0,85 m por delante
      setBlob(i + 1, x + Math.cos(yaw) * off, y + Math.sin(yaw) * off, sx, sy, yaw, blobKq * fade * (1 - 0.18 * lie));
    }
    for (var k = n; k < nb; k++) setBlob(k + 1, 0, 0, 0.01, 0.01, 0, 0);
  }

  // ---------- Confeti ----------
  var CONF_PAL = [[[1, 0.36, 0.2], [1, 0.62, 0.22], [1, 0.82, 0.25], [1, 1, 1]], [[0.25, 0.55, 1], [0.5, 0.75, 1], [1, 0.82, 0.25], [1, 1, 1]]];
  var cfP = { x: 0, y: 0, z: 0 };
  /** Tamaño del papelito para que en pantalla mida >= ~7 px (no una mota): escala por la distancia a la cámara. */
  function confScale(tx, ty, tz) {
    var cp = ctx.camera.position, dd = Math.sqrt((tx - cp.x) * (tx - cp.x) + (ty - cp.y) * (ty - cp.y) + (tz - cp.z) * (tz - cp.z));
    var px = 0.1 * (ctx.height || 720) / (2 * Math.max(0.5, dd) * Math.tan(ctx.camera.fov * Math.PI / 360));
    return clampN(7 / Math.max(0.1, px), 1, 2.6);
  }
  /** Confeti DENTRO del plano actual (ARN-13): unos cañonazos desde puntos que están en el cuadro de la cámara (parte alta,
   *  a 6-12 m) y una cortina que cae desde justo encima del borde superior. Así la celebración se ve aunque la cámara del
   *  plano de cierre esté lejos de las esquinas de la pista. Coordenadas: se eligen en el espacio de la cámara y se pasan a sim. */
  function confettiInFrame(team, n) {
    var cam = ctx.camera, pal = CONF_PAL[team], start = confAlive;
    cam.updateMatrixWorld();
    var e = cam.matrixWorld.elements, tanV = Math.tan(cam.fov * Math.PI / 360), tanH = tanV * (cam.aspect || 1.78);
    // ejes de la cámara (columnas de matrixWorld): derecha, arriba, atrás
    var rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], bx = e[8], by = e[9], bz = e[10], cp = cam.position;
    var nE = 4, ePts = [];
    for (var k = 0; k < nE; k++) {
      var ex = -0.62 + 1.24 * (k + 0.5) / nE + (Math.random() - 0.5) * 0.12, ey = 0.3 + Math.random() * 0.4, ed = 6.5 + Math.random() * 5;
      // cámara alta mirando hacia abajo: a 6-11 m el punto quedaría casi en el suelo y el papel caería enseguida.
      // Se busca la distancia del rayo a la que está a 3,2-5,5 m de altura (entre 5 y 16 m de la cámara).
      var dyr = -by + ry * ex * tanH + uy * ey * tanV, hh = 3.2 + Math.random() * 2.3;
      if (dyr < -0.02 && cp.y > hh + 0.5) ed = clampN((cp.y - hh) / -dyr, 5, 16);
      ePts.push([ex, ey, ed]);
    }
    for (var i = 0; i < n && confAlive < confCap; i++) {
      var d = confD[confAlive++], curtain = i % 5 >= 3, sx, sy, dist;
      if (curtain) { sx = (Math.random() * 2 - 1) * 1.15; sy = 1.04 + Math.random() * 0.5; dist = 5 + Math.random() * 9; }
      else { var E = ePts[i % nE]; sx = E[0] + (Math.random() - 0.5) * 0.05; sy = E[1] + (Math.random() - 0.5) * 0.05; dist = E[2]; }
      var ox = sx * dist * tanH, oy = sy * dist * tanV;
      var tx = cp.x - bx * dist + rx * ox + ux * oy, ty = cp.y - by * dist + ry * ox + uy * oy, tz = cp.z - bz * dist + rz * ox + uz * oy;
      if (ty < 0.6) ty = 0.6;
      VB.fromThree(tx, ty, tz, cfP);
      d.x = cfP.x; d.y = cfP.y; d.z = cfP.z;
      if (curtain) { d.vx = (Math.random() - 0.5) * 0.8; d.vy = (Math.random() - 0.5) * 0.8; d.vz = -0.6 - Math.random() * 0.8; }
      else { // cañonazo: abanico hacia arriba y hacia fuera
        var a = Math.random() * 6.283, sp = 2.2 + Math.random() * 4.2;
        d.vx = Math.cos(a) * sp; d.vy = Math.sin(a) * sp; d.vz = 2.5 + Math.random() * 4.5;
      }
      d.sc = confScale(tx, ty, tz);
      d.ax = Math.random() - 0.5; d.ay = Math.random() - 0.5; d.az = Math.random() - 0.5;
      var l = Math.hypot(d.ax, d.ay, d.az) || 1; d.ax /= l; d.ay /= l; d.az /= l;
      d.ang = Math.random() * 6.28; d.spin = 6 + Math.random() * 10; d.ph = Math.random() * 6.28; d.life = 6 + Math.random() * 3;
      var c = pal[Math.floor(Math.random() * pal.length)]; conf.setColorAt(confAlive - 1, tv.set(c[0], c[1], c[2]));
    }
    if (conf.instanceColor && confAlive > start) conf.instanceColor.needsUpdate = true;
    conf.count = confAlive; conf.visible = confAlive > 0;
  }
  function confetti(team, n) {
    n = Math.round(n * (qScale > 0.6 ? 1 : 0.5));
    var palette = CONF_PAL[team === 1 ? 1 : 0];
    var start = confAlive;
    for (var i = 0; i < n && confAlive < confCap; i++) {
      var d = confD[confAlive++], cannon = i % 3 === 0;
      d.sc = 1.3;
      if (cannon) { // cañones desde las esquinas de la pista
        var cx = (i % 2 ? 1 : -1) * 10, cy = (i % 4 < 2 ? 1 : -1) * 6;
        d.x = cx; d.y = cy; d.z = 1.0;
        d.vx = -cx * (0.25 + Math.random() * 0.25) + (Math.random() - 0.5) * 3; d.vy = -cy * (0.3 + Math.random() * 0.3) + (Math.random() - 0.5) * 3; d.vz = 9 + Math.random() * 6;
      } else {
        d.x = (Math.random() - 0.5) * 22; d.y = (Math.random() - 0.5) * 14; d.z = 11 + Math.random() * 5;
        d.vx = (Math.random() - 0.5) * 1.5; d.vy = (Math.random() - 0.5) * 1.5; d.vz = -Math.random() * 1.5;
      }
      d.ax = Math.random() - 0.5; d.ay = Math.random() - 0.5; d.az = Math.random() - 0.5;
      var l = Math.hypot(d.ax, d.ay, d.az) || 1; d.ax /= l; d.ay /= l; d.az /= l;
      d.ang = Math.random() * 6.28; d.spin = 6 + Math.random() * 10; d.ph = Math.random() * 6.28; d.life = 7 + Math.random() * 3;
      var c = palette[Math.floor(Math.random() * palette.length)]; conf.setColorAt(confAlive - 1, tv.set(c[0], c[1], c[2]));
    }
    if (conf.instanceColor && confAlive > start) conf.instanceColor.needsUpdate = true;
    conf.count = confAlive; conf.visible = confAlive > 0;
  }
  function updateConfetti(dt) {
    if (confAlive <= 0 || dt <= 0) return;
    var i = 0;
    while (i < confAlive) {
      var d = confD[i];
      d.life -= dt;
      if (d.life <= 0 || d.z < -0.05) {
        // compacta: mueve el último vivo a este hueco
        var last = confD[confAlive - 1]; confD[confAlive - 1] = d; confD[i] = last;
        if (conf.instanceColor) { var ca = conf.instanceColor.array; for (var k = 0; k < 3; k++) { var tmp = ca[i * 3 + k]; ca[i * 3 + k] = ca[(confAlive - 1) * 3 + k]; ca[(confAlive - 1) * 3 + k] = tmp; } conf.instanceColor.needsUpdate = true; }
        confAlive--; continue;
      }
      if (d.z > 0.02) {
        d.vz -= 9 * dt; var drag = d.vz < 0 ? 5.6 : 0.6; // cae a ~1,6 m/s: revolotea (antes 2,8 m/s, caía como piedra) d.vx -= d.vx * drag * 0.4 * dt; d.vy -= d.vy * drag * 0.4 * dt; d.vz -= d.vz * drag * dt;
        d.x += (d.vx + Math.sin(ctx.time * 3 + d.ph) * 0.6) * dt; d.y += (d.vy + Math.cos(ctx.time * 2.6 + d.ph) * 0.6) * dt; d.z += d.vz * dt;
        d.ang += d.spin * dt;
      } else { d.z = 0.012; d.vz = 0; d.ax = 1; d.ay = 0; d.az = 0; d.ang = Math.PI / 2; } // en el suelo, plano
      VB.toThree(d.x, d.y, Math.max(0.012, d.z), tv);
      axis.set(d.ax, d.ay, d.az); tmpQ.setFromAxisAngle(axis, d.ang);
      tv2.set(d.sc, d.sc, d.sc); confM.compose(tv, tmpQ, tv2); conf.setMatrixAt(i, confM);
      i++;
    }
    conf.count = confAlive; conf.visible = confAlive > 0; conf.instanceMatrix.needsUpdate = true;
  }
  var confM = null;

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
  // ---------- Módulo ----------
  VB.FX = {
    init: function (c) {
      ctx = c; THREE = c.THREE; C = VB.C; Sim = VB.Sim;
      tv = new THREE.Vector3(); tv2 = new THREE.Vector3(); tv3 = new THREE.Vector3(); axis = new THREE.Vector3(); UPV = new THREE.Vector3(0, 1, 0);
      spinQ = new THREE.Quaternion(); squashQ = new THREE.Quaternion(); tmpQ = new THREE.Quaternion(); confM = new THREE.Matrix4();
      trailCol = new THREE.Color(1, 0.8, 0.5);
      TEAM_LIN = [new THREE.Color('#ff6a3d'), new THREE.Color('#4f96ff')];
      root = new THREE.Group(); root.name = 'fx'; ctx.scene.add(root);

      // Balón: pivote (aplastamiento orientado) + malla (giro)
      ballPivot = new THREE.Group(); root.add(ballPivot);
      // CARTOON: toon de 3 bandas (VB.TOON de arena.js) con los paneles planos; el brillo de borde y el «calor» siguen igual
      ballMat = new THREE.MeshToonMaterial({ map: ballTexture(), emissive: new THREE.Color(0xff5a20), emissiveIntensity: 0 });
      if (VB.TOON && VB.TOON.gradientMap) ballMat.gradientMap = VB.TOON.gradientMap;
      // castShadow = false: la sombra del mapa de sombras y la de contacto eran DOS manchas separadas en el
      // suelo; la buena para jugar es la de contacto (siempre en vertical bajo el balón).
      // brillo de borde (ARN-06): fresnel cálido y suave que se enciende lejos o con el balón rápido (uniforme uRim)
      ballRim = { value: 0 };
      ballMat.onBeforeCompile = function (sh) {
        sh.uniforms.uRim = ballRim;
        sh.fragmentShader = 'uniform float uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.93, 0.8) * uRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.2);');
      };
      ballMat.customProgramCacheKey = function () { return 'vb-ball-rim-toon'; };
      var bgeo = ballGeometry(C.BR);
      ball = new THREE.Mesh(bgeo, ballMat); ball.castShadow = false; ballPivot.add(ball); ball.name = 'ball';
      // contorno oscuro (cáscara de caras traseras): separa el balón del público, que tiene sus mismos colores.
      // Grosor constante en píxeles (ver update).
      ballOutline = new THREE.Mesh(bgeo, new THREE.MeshBasicMaterial({ color: 0x1d1530, side: THREE.BackSide })); // tinta del cartoon
      ballOutline.renderOrder = 0; ballOutline.name = 'ballOutline'; ballPivot.add(ballOutline);

      // sombras de contacto (ARN-11): la del balón (siempre en vertical bajo él: legibilidad) y una mancha suave bajo cada
      // atleta, en TODOS los niveles, en UNA malla instanciada (1 dibujo para las 5). Mezcla multiplicativa: oscurece la
      // tarima sin taparla (ni las líneas ni las marcas del bote) y se ve igual con o sin post-proceso.
      buildBlobs();

      // línea vertical tenue balón -> suelo (lectura de altura)
      var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      dropLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
      dropLine.frustumCulled = false; dropLine.name = 'dropLine'; // estado: la pinta el lote decals como tira de ~1,3 px (writeDecals)

      // marcador de caída: retícula que se cierra según el tiempo que falta
      // (trazos con filo oscuro: sobre la tarima clara el blanco solo no se leía)
      var mcv = canvas(256, 256), g = mcv.getContext('2d');
      var drawMarker = function (ex, style) {
        g.strokeStyle = style; g.fillStyle = style; g.lineCap = 'round';
        g.lineWidth = 9 + ex; g.beginPath(); g.arc(128, 128, 98, 0, 6.283); g.stroke();
        for (var k = 0; k < 4; k++) { var a = k * Math.PI / 2; g.lineWidth = 9 + ex; g.beginPath(); g.moveTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108); g.lineTo(128 + Math.cos(a) * 122, 128 + Math.sin(a) * 122); g.stroke(); }
        g.beginPath(); g.arc(128, 128, 9 + ex / 2, 0, 6.283); g.fill();
      };
      drawMarker(9, 'rgba(0,0,0,0.5)'); drawMarker(0, '#ffffff');
      markerMat = new THREE.MeshBasicMaterial({ map: tex(mcv), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 });
      marker = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), markerMat);
      marker.rotation.x = -Math.PI / 2; marker.position.y = 0.016; marker.renderOrder = 3; marker.name = 'landMarker'; // lo pinta el lote de calcomanías (decals)

      // "aro amarillo": punto donde tu equipo jugará el balón (1 m / 3 m). Es EL objetivo del jugador
      // (texto del entrenador: "ve al aro amarillo"): amarillo saturado con filo oscuro, se cierra según
      // hitWindow().press y se rellena en el instante de pulsar.
      // ARN-05: aro de aproximación PREDECIBLE. Una diana fija (aro fino con marcas hacia dentro) del tamaño del contacto
      // y un aro móvil que nace a 2,6 m de diámetro cuando faltan 0,9 s para PULSAR y se cierra LINEALMENTE hasta coincidir
      // con la diana justo en press = 0 (hitWindow().press). Se pintan por encima de todo (depthTest off): el atleta que
      // está encima ya no lo tapa. El relleno marca la ventana de pulsar (la de ui.js HINT_OFF/HINT_ON).
      // Las tres capas (relleno de la ventana, diana fija y aro móvil) son concéntricas: UN solo plano con un shader que las
      // compone en orden (relleno → diana → aro, «over» sobre colores ya codificados = lo mismo que tres dibujos seguidos).
      // Antes eran 3 mallas (2-3 dibujos en cada frame de peloteo). La escala del plano es la del aro móvil, que es siempre la
      // mayor (diámetro ≥ FR_D0); las otras capas se muestrean con su propia escala relativa (uS.y = diana, uS.z = relleno).
      focusU = { tRing: { value: outlinedRingTex(104, 14) }, tTgt: { value: targetTex() },
        tFill: { value: radialTex([[0, 'rgba(255,255,255,0.75)'], [0.6, 'rgba(255,255,255,0.45)'], [0.8, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']], 64) },
        uCol: { value: new THREE.Color().setRGB(YEL[0], YEL[1], YEL[2]) }, uOp: { value: new THREE.Vector3(0.92, 0.9, 0) }, uS: { value: new THREE.Vector3(1, 1, 1) } };
      focusMat = new THREE.ShaderMaterial({ uniforms: focusU, transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tRing; uniform sampler2D tTgt; uniform sampler2D tFill; uniform vec3 uCol; uniform vec3 uOp; uniform vec3 uS; varying vec2 vUv;\n' +
          'vec4 lay(sampler2D t, float s, float op) { vec2 q = (vUv - 0.5) * s + 0.5; if (op <= 0.0 || any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) return vec4(0.0);\n' +
          ' vec4 c = texture2D(t, q); c.rgb *= uCol; c.a *= op; return vec4(linearToOutputTexel(vec4(c.rgb, 1.0)).rgb, c.a); }\n' +
          'vec4 over(vec4 top, vec4 dst) { float a = top.a + dst.a * (1.0 - top.a); return a > 1e-5 ? vec4((top.rgb * top.a + dst.rgb * dst.a * (1.0 - top.a)) / a, a) : vec4(0.0); }\n' +
          'void main() { vec4 c = lay(tFill, uS.z, uOp.z); c = over(lay(tTgt, uS.y, uOp.y), c); c = over(lay(tRing, 1.0, uOp.x), c); if (c.a < 0.002) discard; gl_FragColor = c; }' });
      focusRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), focusMat);
      focusRing.rotation.x = -Math.PI / 2; focusRing.position.y = 0.02; focusRing.renderOrder = 10; focusRing.visible = false; focusRing.name = 'focusRing'; root.add(focusRing);

      // retícula de apuntado en el campo rival (saque y remate del humano)
      aimMat = new THREE.MeshBasicMaterial({ map: aimTex(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      aimMat.color.set('#ff6326'); // (setRGB es LINEAL con ColorManagement: (1,0.5,0.24) salía color melocotón pálido)
      AIM_OR = aimMat.color.clone(); AIM_OK = new THREE.Color('#ffe23a'); AIM_SV = new THREE.Color('#1fe0d0'); // naranja → amarillo dorado cuando el timing va a ser perfecto
      aimRet = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), aimMat);
      aimRet.rotation.x = -Math.PI / 2; aimRet.position.y = 0.019; aimRet.renderOrder = 4; aimRet.visible = false; aimRet.name = 'aimRet'; // (decals)
      // puntos opacos con filo oscuro (mezcla normal: el aditivo desaparecía sobre la tarima clara)
      var dcv = canvas(64, 64), dg = dcv.getContext('2d');
      dg.fillStyle = 'rgba(10,6,2,0.6)'; dg.beginPath(); dg.arc(32, 32, 26, 0, 6.283); dg.fill();
      dg.fillStyle = '#ffffff'; dg.beginPath(); dg.arc(32, 32, 18, 0, 6.283); dg.fill();
      var agp = new Float32Array(AIM_N * 3), agc = new Float32Array(AIM_N * 4), ag = new THREE.BufferGeometry();
      ag.setAttribute('position', new THREE.BufferAttribute(agp, 3)); ag.setAttribute('color', new THREE.BufferAttribute(agc, 4));
      aimArc = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.2, map: tex(dcv), vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
      aimArc.frustumCulled = false; aimArc.renderOrder = 7; aimArc.visible = false; aimArc.name = 'aimArc'; root.add(aimArc);

      // estela tipo cinta (aditiva, orientada a cámara)
      tPts = new Float32Array(TN * 3); tPos = new Float32Array(TN * 6); tCols = new Float32Array(TN * 6);
      var tg = new THREE.BufferGeometry(), idx = [];
      for (var i = 0; i < TN - 1; i++) { var a0 = i * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
      tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(tCols, 3)); tg.setIndex(idx);
      // transparent:false a propósito: en r149 un material transparente DoubleSide cambia side y pone needsUpdate dos veces
      // por objeto y frame (recalcula el programa). Aditivo + sin profundidad funciona igual en la lista opaca (renderOrder alto).
      trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: false, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      trail.frustumCulled = false; trail.visible = false; trail.renderOrder = 6; trail.name = 'trail'; root.add(trail);

      // chispas
      var sPos = new Float32Array(SPARK_N * 3), sCol = new Float32Array(SPARK_N * 3);
      for (var j = 0; j < SPARK_N; j++) { sp.push(dblFields({ x: 0, y: 0, z: -50, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1, grav: 9 })); sPos[j * 3 + 1] = -50; }
      var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
      sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.13, map: radialTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64),
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sparks.frustumCulled = false; sparks.visible = false; sparks.renderOrder = 7; sparks.name = 'sparks'; root.add(sparks);

      // destellos y ondas de choque (sprites aditivos)
      var flashTex = radialTex([[0, 'rgba(255,250,235,1)'], [0.1, 'rgba(255,232,190,0.7)'], [0.32, 'rgba(255,190,120,0.16)'], [0.6, 'rgba(255,170,100,0.04)'], [1, 'rgba(255,160,90,0)']]);
      for (var f = 0; f < FLASH_N; f++) {
        var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        s.visible = false; s.renderOrder = 8; s.name = 'flash'; flashPool.push({ s: s, t: 0, d: 1, size: 1, near: 1 }); // estado: lo pinta el lote de destellos (bills)
      }
      var shockTex = shockRingTex();
      for (var w = 0; w < WAVE_N; w++) {
        var ws = new THREE.Sprite(new THREE.SpriteMaterial({ map: shockTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        ws.visible = false; ws.renderOrder = 8; ws.name = 'wave'; wavePool.push({ s: ws, t: 0, d: 1, size: 1, near: 1 }); // (bills)
      }
      buildBills(flashTex, shockTex);
      buildToonFx(); ballVel = new THREE.Vector3();
      // ondas en el suelo (caída del balón, aterrizajes)
      var ripTex = ringTex(0.7, 0.86, 0.12), ripGeo = new THREE.PlaneGeometry(1, 1);
      for (var rI = 0; rI < RIP_N; rI++) {
        var rm = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: ripTex, transparent: true, depthWrite: false, toneMapped: false }));
        rm.rotation.x = -Math.PI / 2; rm.position.y = 0.018; rm.visible = false; rm.renderOrder = 3; rm.name = 'ripple'; ripPool.push({ m: rm, t: 0, d: 1, size: 1, op: 1 }); // (lo pinta el lote decals)
      }
      // marcas del balón en el suelo
      // marcas del bote: huella oscura + filo de color dentro/fuera
      var markTex = fillTex(); rimInTex = markRimTex(false); rimOutTex = markRimTex(true);
      MARK_IN = new THREE.Color().setRGB(0.12, 0.9, 0.24); MARK_OUT = new THREE.Color().setRGB(1, 0.17, 0.11); // lineal: el del aro (rojo algo más claro para no oscurecer)
      for (var mI = 0; mI < MARK_N; mI++) {
        var mm = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }));
        mm.rotation.x = -Math.PI / 2; mm.position.y = 0.015; mm.visible = false; mm.renderOrder = 2; mm.name = 'mark'; // (decals)
        var mr = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: rimInTex, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }));
        mr.rotation.x = -Math.PI / 2; mr.position.y = 0.0155; mr.visible = false; mr.renderOrder = 3; mr.name = 'markRim'; // (decals)
        markPool.push({ m: mm, r: mr, t: 0, d: 1, s: 0.5, stretch: 1 });
      }
      // B6: revisión del challenge. Celda 6 del atlas = blanco liso (línea resaltada), celda 7 = huella nítida.
      var whiteTex = tex(canvas(4, 4)); whiteTex.image.getContext('2d').fillStyle = '#fff'; whiteTex.image.getContext('2d').fillRect(0, 0, 4, 4);
      var rvMk = function (map, y, ro, name) {
        var o = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: map, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
        o.rotation.x = -Math.PI / 2; o.position.y = y; o.visible = false; o.renderOrder = ro; o.name = name; return o; // (decals)
      };
      revGlow = rvMk(markTex, 0.0158, 3, 'revGlow'); revLine = rvMk(whiteTex, 0.0162, 3, 'revLine'); revFill = rvMk(revTex(), 0.0166, 3, 'revMark');
      aimFill = rvMk(markTex, 0.0185, 4, 'aimFill');
      revGlow.material.color.setRGB(0.25, 0.85, 1); revLine.material.color.setRGB(0.55, 0.95, 1);
      aimSpMap = aimMat.map; aimSvMap = aimSvTex();
      buildDecals([ripTex, markTex, rimInTex, rimOutTex, markerMat.map, aimMat.map, whiteTex, revFill.material.map, aimSvMap]);
      // polvo de parquet (plancha, aterrizajes): Points con alfa por vértice y mezcla normal
      var dPos = new Float32Array(DUST_N * 3), dCol = new Float32Array(DUST_N * 4);
      for (var dI = 0; dI < DUST_N; dI++) { du.push(dblFields({ x: 0, y: 0, z: -50, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s: 1, g: 0.5 })); du[du.length - 1].g = 0; dPos[dI * 3 + 1] = -50; }
      var dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dPos, 3)); dg.setAttribute('color', new THREE.BufferAttribute(dCol, 4));
      dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.42, map: radialTex([[0, 'rgba(255,255,255,0.75)'], [0.4, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']], 64),
        vertexColors: true, transparent: true, depthWrite: false }));
      dust.frustumCulled = false; dust.renderOrder = 4; dust.visible = false; dust.name = 'dust'; root.add(dust);
      // confeti
      conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.075, 0.12), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CONF_N);
      for (var q = 0; q < CONF_N; q++) { confD.push(dblFields({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 1, ay: 0, az: 0, ang: 0, spin: 0, ph: 0, life: 0, sc: 1 })); conf.setColorAt(q, tv.set(1, 1, 1)); }
      conf.instanceMatrix.setUsage(THREE.DynamicDrawUsage); conf.count = 0; conf.visible = false; conf.frustumCulled = false; conf.name = 'confetti'; root.add(conf);
      this.setQuality(c.quality);
    },
    setQuality: function (q) {
      var r = !q ? 2 : q.rank;
      qScale = r >= 2 ? 1 : r === 1 ? 0.75 : 0.45;
      blobKq = BLOB_K[r >= 2 ? 2 : r === 1 ? 1 : 0];
      tbLow = r < 1; // FX cartoon: en baja la mitad de estrellas y nubes, sin líneas de velocidad ni onomatopeya
      spCap = r >= 2 ? SPARK_N : r === 1 ? 150 : 90;
      duCap = r >= 2 ? DUST_N : r === 1 ? 72 : 40;
      footCap = r >= 2 ? FOOT_N : r === 1 ? 64 : 40;
      if (fp.length) { for (var fq = footCap; fq < FOOT_N; fq++) fp[fq].t = 0; fpHead %= footCap; }
      confCap = r >= 2 ? CONF_N : r === 1 ? 360 : 200;
      // lo que quede fuera del tramo nuevo se apaga y deja de dibujarse
      if (sparks) {
        var pa = sparks.geometry.attributes.position.array;
        for (var i = spCap; i < SPARK_N; i++) { sp[i].life = 0; pa[i * 3 + 1] = -50; }
        spHead %= spCap; sparks.geometry.setDrawRange(0, spCap); sparks.geometry.attributes.position.needsUpdate = true;
      }
      if (dust) {
        for (var d = duCap; d < DUST_N; d++) du[d].life = 0;
        duHead %= duCap; dust.geometry.setDrawRange(0, duCap);
      }
      if (conf && confAlive > confCap) { confAlive = confCap; conf.count = confAlive; }
    },
    onGameStart: function () {
      trailA = 0; heat = 0; squash.t = 0; spin.rate = 0; hwC.p = null;
      for (var i = 0; i < SPARK_N; i++) sp[i].life = 0;
      for (var dI = 0; dI < DUST_N; dI++) du[dI].life = 0;
      for (var fI = 0; fI < fp.length; fI++) fp[fI].t = 0; fpLast.length = 0; fpAlive = 0;
      for (var f = 0; f < FLASH_N; f++) { flashPool[f].t = 0; flashPool[f].s.visible = false; }
      for (var w = 0; w < WAVE_N; w++) { wavePool[w].t = 0; wavePool[w].s.visible = false; }
      for (var r = 0; r < RIP_N; r++) { ripPool[r].t = 0; ripPool[r].m.visible = false; }
      for (var m = 0; m < MARK_N; m++) { markPool[m].t = 0; markPool[m].m.visible = false; markPool[m].r.visible = false; }
      aimR.on = false; aimFill.visible = false; rv.on = false; rv.hold = 0; rv.a = 0; revFill.visible = revLine.visible = revGlow.visible = false;
      aim.a = 0; aim.on = false; aimRet.visible = false; aimArc.visible = false; focusRing.visible = false;
      confAlive = 0; conf.count = 0; conf.visible = false;
      for (var tI = 0; tI < TB_N; tI++) tb[tI].life = 0;
      speedT = 0; tbAlive = 1;
    },
    /** Partículas en coordenadas de simulación (interfaz del contrato). */
    burst: function (x, y, z, n, power) { burstAt(x, y, z, n, power, 1, 0.92, 0.7, 1, 9); },
    /** Polvo de la tarima (coords de sim), p. ej. planchas cosméticas de players.js. */
    dust: function (x, y, n, dirx, diry) { dustAt(x, y, n || 22, 0.75, dirx || 0, diry || 0, 0.6, 1.5, 0.1); puffsAt(x, y, Math.max(2, Math.round((n || 22) / 6)), dirx || 0, diry || 0, 1.2, 0.45); },
    /** FX cartoon (opcionales): estrellas de impacto, explosión de cómic, nubes de polvo, «¡PAM!» (coords de sim). */
    stars: function (x, y, z, n, size) { starsAt(x, y, z, n || 4, 1.8, size || 0.24); },
    comicBurst: function (x, y, z, size) { burstToon(x, y, z, size || 0.9, 0.16); },
    puffs: function (x, y, n, dirx, diry, size) { puffsAt(x, y, n || 4, dirx || 0, diry || 0, 1.2, size || 0.45); },
    onomatopoeia: function (x, y, z) { onoAt(x, y, z); },
    /** Confeti del color de un equipo (opcional). */
    confetti: function (team, n) { confetti(team === 1 ? 1 : 0, n || 400); },
    /** Malla del balón (opcional, para otros módulos). */
    ballObject: function () { return ballPivot; },
    /** ARN-03: copias de compilación de todos los pools de efectos (ver VB.Arena.prewarmList, que ya las incluye). */
    prewarmList: function () { return root ? prewarmProxies(root, []) : []; },
    /** Solo depuración: escala de legibilidad del balón (ARN-06) y brillo de borde actual. */
    _dbg: function () { return { ballBs: ballBs, rim: ballRim ? ballRim.value : 0, ringD: focusRing && focusRing.visible ? focusD : 0, ringOp: focusU ? focusU.uOp.value.toArray() : null, toon: toon, toonN: toon ? toon.count : 0, decals: decals, decOrder: decOrder, bills: bills, billOrder: billOrder, dropLine: dropLine }; },
    /** Solo depuración (tools/eval.js): objetivo de apuntado que pintaría la retícula. */
    _aimTarget: function (g, out) { out = out || { x: 0, y: 0 }; var m = aimTarget(g, out); return m ? { mode: m, x: out.x, y: out.y } : null; },
    update: function (g, dt, events) {
      if (!g) return;
      var b = g.ball;
      for (var i = 0; i < events.length; i++) this._event(events[i], g);

      // ---- balón: posición, giro con efecto, aplastamiento al golpear ----
      VB.toThree(b.x, b.y, b.z, ballPivot.position);
      if (dt > 0) {
        var hs = Math.hypot(b.vx, b.vy);
        if (b.held) { axis.set(0.3, 1, 0.2).normalize(); tmpQ.setFromAxisAngle(axis, dt * 1.2); spinQ.premultiply(tmpQ); }
        else if (hs > 0.05 || Math.abs(b.vz) > 0.05) {
          // eje = v x abajo (liftado hacia delante); en el suelo, rodadura
          var onFloor = b.z <= C.BR + 0.02 && g.mode !== 'rally';
          var rate = onFloor ? hs / C.BR : spin.rate;
          // v_three = (vx, vz, -vy);  v x (0,-1,0) = (-vy, 0, -vx): eje del liftado (la parte de arriba avanza)
          axis.set(-b.vy, 0, -b.vx); if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1); axis.normalize();
          tmpQ.setFromAxisAngle(axis, rate * spin.sign * dt); spinQ.premultiply(tmpQ);
          if (spin.wob > 0) { axis.set(Math.sin(ctx.time * 7), 0.4, Math.cos(ctx.time * 5)).normalize(); tmpQ.setFromAxisAngle(axis, spin.wob * dt); spinQ.premultiply(tmpQ); }
        }
        spinQ.normalize();
        if (squash.t > 0) squash.t = Math.max(0, squash.t - dt);
        heat = Math.max(0, heat - dt * 2.2);
      }
      var sq = squash.t > 0 ? Math.sin((1 - squash.t / 0.12) * Math.PI) * Math.min(SQ_MAX, squash.k) : 0;
      // ARN-06: tamaño mínimo en pantalla. Diámetro proyectado >= 9,6 px CSS (y >= 1,8 % del alto en pantallas grandes);
      // el radio físico no cambia. Rodilla suave (sin saltos) y escala EXACTAMENTE 1 de cerca (a < 8 m siempre sobra).
      // Lejos (remate de la CPU en el móvil, saque rival) el balón ya no se queda en 6 px perdido entre la grada.
      var cam = ctx.camera, dCam = cam.position.distanceTo(ballPivot.position), tanH = Math.tan(cam.fov * Math.PI / 360), vh = ctx.height || 720;
      var pxAt1 = C.BR * vh / Math.max(0.01, dCam * tanH);                 // diámetro en px CSS con escala 1
      var need = Math.max(9.6, 0.018 * vh) / pxAt1;
      var bs = dCam < 8 || need <= 0.85 ? 1 : need >= 1.15 ? need : 1 + (need - 0.85) * (need - 0.85) / 0.6; // >= need siempre
      if (bs > 3.2) bs = 3.2;
      ballBs = bs;
      var ballPx = pxAt1 * bs * 0.5; // radio en px
      // brillo de borde (fresnel) lejos o a más de 12 m/s: separa el balón del fondo sin llegar al umbral del bloom
      if (ballRim) {
        var bsp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz), rimK = Math.max(clampN((dCam - 9) / 10, 0, 1), clampN((bsp - 12) / 8, 0, 1) * 0.8);
        ballRim.value += (rimK * 0.3 - ballRim.value) * (dt > 0 ? Math.min(1, dt * 10) : 1);
      }
      ballPivot.quaternion.copy(squashQ); ballPivot.scale.set(bs * (1 + sq * 0.5), bs * (1 - sq), bs * (1 + sq * 0.5));
      // contorno de tinta de ~2 px (CARTOON; antes 1,4 px), un poco más fino de cerca
      var ol = 1 + clampN(2.0 / Math.max(1, ballPx), 0.04, 0.24); ballOutline.scale.set(ol, ol, ol);
      // la malla compensa la orientación del pivote para mantener el giro en mundo
      ball.quaternion.copy(squashQ).invert().multiply(spinQ);
      ballMat.emissiveIntensity = heat * 0.25; // filo cálido; los paneles siguen leyéndose

      // ---- sombra de contacto ----
      // ARN-04: el disco de sombra solo mientras el balón vuela; apoyado en el suelo queda un contacto pequeño y suave
      // (antes, el disco oscuro de 0,6 m encima de la marca del bote se leía como un agujero en la tarima).
      var h = Math.max(0, b.z - C.BR), air = clampN((h - 0.03) / 0.3, 0, 1), s = (0.3 + 0.32 * air) / (1 + h * 0.1) * Math.min(bs, 1.8);
      // misma lectura que antes (disco ~0,85 en el centro y opacidad que cae con la altura), ahora como instancia 0
      setBlob(0, b.x, b.y, s, s, 0, 0.85 * Math.max(0.22, 0.95 / (1 + h * 0.22)) * (0.5 + 0.5 * air));
      updateAthleteBlobs(g);

      var inPlay = g.mode === 'rally' && !b.held;
      // ---- línea de altura ----
      dropLine.visible = inPlay && b.z > 1.4;
      if (dropLine.visible) {
        var la = dropLine.geometry.attributes.position.array;
        la[0] = ballPivot.position.x; la[1] = ballPivot.position.y - C.BR; la[2] = ballPivot.position.z; la[3] = la[0]; la[4] = 0.02; la[5] = la[2];
        dropLine.geometry.attributes.position.needsUpdate = true;
        dropLine.material.opacity = Math.min(0.22, (b.z - 1.4) * 0.12);
      }
      // ---- aro amarillo (dónde jugará el balón tu equipo): el objetivo principal ----
      var showFocus = inPlay && !g.demo && !g.watch && g.jobs && g.jobs[0] && Sim.focusPoint;
      var fpt = showFocus ? Sim.focusPoint(g) : null; // (no «fp»: taparía el pool de huellas del módulo)
      focusVis = !!fpt;
      focusRing.visible = focusVis;
      if (focusVis) {
        focusRing.position.x = fpt.x; focusRing.position.z = -fpt.y;
        var press = 1.2;
        if (Sim.hitWindow) press = focusPress(g, g.jobs[0]);
        // aro móvil: diámetro LINEAL en press (2,6 m a 0,9 s -> diana a 0 s); antes de 0,9 s espera a 2,6 m apareciendo
        var fd = FR_D0 + (FR_D1 - FR_D0) * clampN(press / FR_T, 0, 1), fsc = fd / FR_RING;
        // A3/A4: tras un remate perfecto (g.digTight) el aro del defensor humano se ve ×0,7 entero (diana, relleno y aro móvil a la vez:
        // las escalas relativas de uS no cambian, así que el aro sigue cerrándose justo en press = 0)
        var tight = g.digTight === true ? DIG_TIGHT : 1;
        focusRing.scale.set(fsc * tight, fsc * tight, fsc * tight); focusD = fd * tight;
        var fIn = clampN((FR_T + 0.55 - press) / 0.55, 0, 1), fLate = clampN((-press + FR_OFF) / 0.2, 0, 1);
        // escalas relativas al plano (que lleva la del aro): diana FR_D0/FR_TGT, relleno FR_D0·1,12
        focusU.uS.value.set(1, fsc / (FR_D0 / FR_TGT), fsc / (FR_D0 * 1.12));
        // ventana de pulsar (la del aviso «¡Golpea!»): relleno que sube hasta press = 0 y se apaga al cerrarse la ventana
        var now = press > 0 ? clampN(1 - press / FR_ON, 0, 1) : clampN(1 + press / -FR_OFF, 0, 1);
        focusU.uOp.value.set(0.95 * fIn * (1 - 0.75 * fLate), 0.62 + 0.36 * now, now > 0.01 ? 0.55 * now * now : 0);
        focusMat.opacity = focusU.uOp.value.x; // (solo lectura para herramientas: opacidad del aro móvil)
      }
      // ---- marcador de caída (secundario si el aro amarillo está activo) ----
      marker.visible = inPlay && b.vz < 6 && b.z > 0.5;
      if (marker.visible) {
        Sim.predictLanding(g, land);
        marker.position.x = land.x; marker.position.z = -land.y;
        var tt = Math.min(1, Math.max(0, land.t) / 1.3), sc = 0.6 + tt * 0.7 + Math.sin(ctx.time * 9) * 0.03;
        marker.scale.set(sc, sc, sc); marker.rotation.z = ctx.time * 0.8;
        var mine = land.x > 0;
        var tol = C.IN_TOL != null ? C.IN_TOL : 0.03; // mismo umbral que el árbitro de sim
        var out = Math.abs(land.x) > courtHL(g) + tol || Math.abs(land.y) > courtHW(g) + tol; // pista de la partida (playa 16×8)
        var mo;
        if (g.demo) { markerMat.color.setRGB(0.9, 0.95, 1); mo = 0.55; }
        else if (mine && !focusVis) { markerMat.color.setRGB(YEL[0], YEL[1], YEL[2]); mo = 0.95; } // nadie tuyo va: el bote es lo que importa
        else if (mine) { markerMat.color.setRGB(1, 1, 1); mo = 0.6; }                             // blanco: no compite con el aro amarillo
        else { markerMat.color.setRGB(0.55, 0.8, 1); mo = 0.6; }
        markerMat.opacity = mo * (out ? 0.55 : 1);
      }
      // ---- retícula de apuntado (saque / remate del humano) ----
      var am = aimTarget(g, aimOut), rdt = ctx.realDt || 0;
      // A4: en el remate con spreadNow, el RADIO de la diana = dispersión si pulsaras ahora (mín. AIM_RMIN): se encoge hacia el
      // momento perfecto y crece si te pasas. Saque (o sim sin spreadNow): como antes.
      var spr = am === 2 && (g.mode === 'rally' || aimSv) && typeof aimOut.spreadNow === 'number' && aimOut.spreadNow >= 0 && isFinite(aimOut.spreadNow) ? aimOut.spreadNow : -1;
      if (aimSv && spr < 0) spr = 0.6; // saque dirigible con una sim que aún no da la dispersión: aro de tamaño medio
      if (spr >= 0) {
        var rmin = AIM_RMIN;
        aimSt = 1;
        if (aimSv) { // radio mínimo legible (AIM_SVPX px CSS a esa distancia) y alargamiento en profundidad según lo rasante de la vista
          var cm = ctx.camera, cp = cm.position, dxc = aimOut.x - cp.x, dzc = -aimOut.y - cp.z, dc = Math.sqrt(dxc * dxc + dzc * dzc + cp.y * cp.y);
          var mpp = 2 * dc * Math.tan((cm.fov || 54) * Math.PI / 360) / Math.max(200, ctx.height || 720);
          rmin = Math.max(AIM_SVMIN, AIM_SVPX * mpp);
          aimSt = clampN(0.55 * dc / Math.max(0.3, cp.y), 1, AIM_SVST);
        }
        var rt = clampN(spr, rmin, AIM_RMAX);
        var ft = clampN(spr, 0.18, AIM_RMAX);
        if (!aimR.on) { aimR.r = rt; aimR.f = ft; }
        aimR.on = true; aimR.r += (rt - aimR.r) * (1 - Math.exp(-22 * rdt)); aimR.f += (ft - aimR.f) * (1 - Math.exp(-22 * rdt)); aimR.p = spr <= 0.12 ? 1 : 0;
      } else if (!am) aimR.on = aimR.on && aim.a > 0.01; else aimR.on = false;
      if (am) {
        if (!aim.on) { aim.x = aimOut.x; aim.y = aimOut.y; }
        aim.on = true; aim.tx = aimOut.x; aim.ty = aimOut.y;
        var ka = g.aim3 && g.aim3.on ? 1 : 1 - Math.exp(-16 * rdt); aim.x += (aim.tx - aim.x) * ka; aim.y += (aim.ty - aim.y) * ka;
        aim.a = Math.min(am === 2 ? 1 : 0.5, aim.a + rdt * 5);
        if (aim.a > (am === 2 ? 1 : 0.5)) aim.a = am === 2 ? 1 : 0.5;
      } else {
        aim.on = false; aim.a = Math.max(0, aim.a - rdt * (aim.kill > 0 ? 6 : 4));
      }
      if (aim.kill > 0) aim.kill -= rdt;
      aimRet.visible = aim.a > 0.01;
      if (aimRet.visible) {
        aimRet.position.x = aim.x; aimRet.position.z = -aim.y;
        var asz;
        if (aimR.on) { // remate apuntado: tamaño = dispersión; dorado y latido rápido cuando va a ir exacto
          asz = aimR.r / AIM_R1 * (1 + Math.sin(ctx.time * (aimR.p ? 14 : 5)) * (aimR.p ? 0.05 : 0.025));
          if (aimSv) aimMat.color.copy(AIM_SV).lerp(AIM_OK, clampN((0.45 - spr) / 0.2, 0, 1));
          else aimMat.color.copy(AIM_OR).lerp(AIM_OK, clampN((0.45 - aimR.r) / 0.2, 0, 1));
          aimMat.opacity = 0.97 * aim.a;
        } else {
          asz = 1 + (1 - Math.min(1, aim.a * 2)) * 0.35 + Math.sin(ctx.time * 5) * 0.03;
          aimMat.color.copy(AIM_OR); aimMat.opacity = 0.9 * aim.a;
        }
        // saque dirigible: textura gruesa, sin giro, eje local Y del plano hacia donde mira la cámara (alargado ×aimSt)
        var svRot = aimSv ? Math.atan2(ctx.camera.position.x - aim.x, ctx.camera.position.z + aim.y) : 0;
        aimMat.map = aimSv ? aimSvMap : aimSpMap;
        if (aimSv) { aimRet.scale.set(asz * AIM_R1 / AIM_SVR, asz * AIM_R1 / AIM_SVR * aimSt, asz); aimRet.rotation.z = svRot; }
        else { aimRet.scale.set(asz, asz, asz); aimRet.rotation.z = -ctx.time * 0.6; }
        aimFill.visible = aimR.on;
        if (aimR.on) { // disco del radio de la dispersión (el relleno de fillTex llega a ~0,9 del plano)
          // (saque dirigible: el aro tiene un radio mínimo legible; el disco es la dispersión REAL, que se encoge con el buen timing)
          var fz = 2 * (aimSv ? Math.min(aimR.f, aimR.r) : aimR.r) / 0.9; aimFill.position.x = aim.x; aimFill.position.z = -aim.y;
          aimFill.scale.set(fz, aimSv ? fz * aimSt : fz, 1); aimFill.rotation.z = svRot;
          aimFill.material.color.copy(aimMat.color); aimFill.material.opacity = (aimSv ? 0.38 : 0.26) * aim.a;
        }
      }
      // arco: solo con el apuntado activo (balón lanzado / en el aire para rematar)
      if (!aimRet.visible) aimFill.visible = false;
      aimArc.visible = aimRet.visible && aim.on && am === 2 && !b.held;
      if (aimArc.visible) updateAimArc(b, aim.x, aim.y, aim.a, aimSv ? AIM_SV : null);

      updateReview(g, rdt);
      updateTrail(dt);

      // ---- chispas ----
      if (spAlive) {
        var pa = sparks.geometry.attributes.position.array, ca = sparks.geometry.attributes.color.array, alive = 0;
        for (var j = 0; j < spCap; j++) {
          var q = sp[j];
          if (q.life > 0) {
            if (dt > 0) {
              q.life -= dt; q.vz -= q.grav * dt; var dr = 1 - 2.2 * dt; q.vx *= dr; q.vy *= dr;
              q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
              if (q.z < 0.02) { q.z = 0.02; q.vz = Math.abs(q.vz) * 0.3; }
            }
            var k = Math.max(0, q.life / q.max); k = k * k;
            pa[j * 3] = q.x; pa[j * 3 + 1] = q.z; pa[j * 3 + 2] = -q.y;
            ca[j * 3] = q.r * k; ca[j * 3 + 1] = q.g * k; ca[j * 3 + 2] = q.b * k; alive++;
          } else if (pa[j * 3 + 1] !== -50) { pa[j * 3 + 1] = -50; ca[j * 3] = ca[j * 3 + 1] = ca[j * 3 + 2] = 0; }
        }
        sparks.geometry.attributes.position.needsUpdate = true; sparks.geometry.attributes.color.needsUpdate = true;
        if (!alive) { spAlive = 0; sparks.visible = false; } // sin chispas vivas: sin dibujo (antes 1 dibujo del pool entero en cada frame)
      }
      // ---- polvo ----
      if (duAlive) {
        var dp = dust.geometry.attributes.position.array, dc = dust.geometry.attributes.color.array, dAlive = 0, sandy = onBeach();
        var dsz = sandy ? 0.24 : 0.42; if (dust.material.size !== dsz) dust.material.size = dsz; // granos de arena más pequeños que el velo de polvo
        for (var dI = 0; dI < duCap; dI++) {
          var D = du[dI];
          if (D.life > 0) {
            if (dt > 0) {
              D.life -= dt;
              if (D.g > 0) { // arena: arco balístico corto; al tocar el suelo se para y se apaga enseguida
                var gdr = 1 - 0.9 * dt; D.vx *= gdr; D.vy *= gdr; D.vz -= D.g * dt;
                D.x += D.vx * dt; D.y += D.vy * dt; D.z += D.vz * dt;
                if (D.z < 0.03 && D.vz < 0) { D.z = 0.03; D.vx *= 0.2; D.vy *= 0.2; D.vz = 0; D.life = Math.min(D.life, 0.1); }
              } else {
                var ddr = 1 - 3.2 * dt; D.vx *= ddr; D.vy *= ddr; D.vz = D.vz * (1 - 2 * dt) - 0.25 * dt;
                D.x += D.vx * dt; D.y += D.vy * dt; D.z = Math.max(0.04, D.z + D.vz * dt);
              }
            }
            var lk = Math.max(0, D.life / D.max), al = D.g > 0 ? Math.min(1, (1 - lk) * 12) * Math.min(1, lk * 4) * 0.85 * D.s : Math.min(1, (1 - lk) * 8) * lk * 0.42 * D.s;
            dp[dI * 3] = D.x; dp[dI * 3 + 1] = D.z; dp[dI * 3 + 2] = -D.y;
            // serrín de parquet (tono cálido) o arena seca en la playa
            if (sandy) { dc[dI * 4] = 0.98; dc[dI * 4 + 1] = 0.87; dc[dI * 4 + 2] = 0.66; } else { dc[dI * 4] = 0.88; dc[dI * 4 + 1] = 0.72; dc[dI * 4 + 2] = 0.52; }
            dc[dI * 4 + 3] = al; dAlive++;
          } else if (dp[dI * 3 + 1] !== -50) { dp[dI * 3 + 1] = -50; dc[dI * 4 + 3] = 0; }
        }
        dust.geometry.attributes.position.needsUpdate = true; dust.geometry.attributes.color.needsUpdate = true;
        // OJO: hasta el 10-nov-2026 «dAlive++» estaba dentro de un comentario y el polvo NO se veía nunca. Se arregla la cuenta, pero
        // en el pabellón sigue oculto (regla: el pabellón no cambia; encenderlo allí queda como decisión pendiente en TRASPASO.md)
        dust.visible = dAlive > 0 && sandy; if (!dAlive) duAlive = 0;
      }
      // ---- destellos / ondas / marcas ----
      for (var f = 0; f < FLASH_N; f++) {
        var F = flashPool[f]; if (!F.s.visible) continue;
        if (dt > 0) F.t -= dt;
        if (F.t <= 0) { F.s.visible = false; continue; }
        var u = F.t / F.d, fsz = F.size * (0.7 + (1 - u) * 0.45) * (0.5 + 0.5 * F.near); F.s.scale.set(fsz, fsz, 1); F.s.material.opacity = u * u * F.near;
      }
      for (var w = 0; w < WAVE_N; w++) {
        var Wv = wavePool[w]; if (!Wv.s.visible) continue;
        if (dt > 0) Wv.t -= dt;
        if (Wv.t <= 0) { Wv.s.visible = false; continue; }
        var uw = 1 - Wv.t / Wv.d, wsz = Wv.size * (0.2 + uw * 1.0); Wv.s.scale.set(wsz, wsz, 1); Wv.s.material.opacity = (1 - uw) * (1 - uw) * Wv.near;
      }
      for (var r = 0; r < RIP_N; r++) {
        var Rp = ripPool[r]; if (!Rp.m.visible) continue;
        if (dt > 0) Rp.t -= dt;
        if (Rp.t <= 0) { Rp.m.visible = false; continue; }
        var ur = 1 - Rp.t / Rp.d, rsz = Rp.size * (0.15 + Math.sqrt(ur) * 0.85); Rp.m.scale.set(rsz, rsz, rsz); Rp.m.material.opacity = Rp.op * (1 - ur);
      }
      for (var mI = 0; mI < MARK_N; mI++) {
        var Mk = markPool[mI]; if (!Mk.m.visible) continue;
        if (dt > 0) Mk.t -= dt;
        if (Mk.t <= 0) { Mk.m.visible = false; Mk.r.visible = false; continue; }
        var mf = Math.min(1, Mk.t / 1.0), age = Mk.d - Mk.t;
        Mk.m.material.opacity = 0.9 * mf; Mk.r.material.opacity = 0.92 * mf;
        // pulso de entrada del filo (1,7x -> 1x en 0,22 s) y un latido suave mientras dura la repetición
        var pin = age < 0.22 ? 1 + 0.7 * (1 - age / 0.22) * (1 - age / 0.22) : 1 + Math.sin(age * 5) * 0.03;
        var rs = Mk.s * 1.55 * pin; Mk.r.scale.set(rs, rs, rs);
      }
      if (onBeach()) updateFootprints(g, dt); else if (fpAlive) { for (var fz = 0; fz < fp.length; fz++) fp[fz].t = 0; fpAlive = 0; fpLast.length = 0; }
      writeDecals(); writeBills();
      ballVel.set(b.vx, b.vz, -b.vy); updateToonFx(dt);
      updateConfetti(dt);
    },
    _event: function (e, g) {
      var T = TEAM_LIN;
      // calidad baja: donde salen estrellas/explosión de cómic, sustituyen a las chispas, destellos y ondas (sparks e impactBills:
      // 1-2 dibujos menos en el pico; ARN-12 <= 35 dibujos en baja). La explosión de cómic hace de destello.
      var tbSwap = tbLow && !!toon;
      switch (e.type) {
        case 'hit': {
          var tc = T[e.team === 1 ? 1 : 0], qv = e.quality == null ? 0.8 : e.quality;
          var k = e.kind, perfect = e.grade === 'perfect' && !!e.human, tip = k === 'free' && e.shot === 'tip';
          var pw = e.power == null ? qv : e.power;
          if (e.team === 0 && (k === 'serve' || k === 'spike')) aim.kill = 0.3; // la retícula se apaga en el contacto
          if (e.shot === 'body') { // el balón da en el cuerpo sin gesto: golpe apagado y pequeño, sin destello
            spin.rate = 4 + Math.random() * 4; spin.sign = -1; spin.wob = 0;
            burstAt(e.x, e.y, e.z, 2, 1.0, 0.8, 0.82, 0.86, 0.5, 6);
            trailA = 0; squash.t = 0.08; squash.k = 0.04;
          } else if (k === 'spike') {
            spin.rate = 32 + qv * 14; spin.sign = 1; spin.wob = 0;
            if (!tbSwap) {
              flashAt(e.x, e.y, e.z, 1.0 + pw * 0.45, 0.14, 1, 0.9, 0.74);
              shockAt(e.x, e.y, e.z, 1.8 + pw * 0.7, 0.2, tc.r, tc.g, tc.b);
              burstAt(e.x, e.y, e.z, 16 + pw * 10, 4.5 + pw * 1.5, 1, 0.78, 0.45, 0.6, 7);
              burstAt(e.x, e.y, e.z, 8, 3.2, tc.r, tc.g, tc.b, 0.4, 7);
            }
            startTrail(1, 0.94, 0.66, 0.15 + pw * 0.04, 0.75 + pw * 0.3);
            squash.t = 0.12; squash.k = 0.07 + pw * 0.025; heat = 0.6 + pw * 0.4;
            // cartoon: explosión de cómic + estrellas; líneas de velocidad si es fuerte (o perfecto)
            burstToon(e.x, e.y, e.z, 0.7 + pw * 0.35, 0.16);
            starsAt(e.x, e.y, e.z, 3 + Math.round(pw * 2), 1.6 + pw, 0.24);
            if (pw > 0.7 || perfect) speedLines(perfect ? 7 : 5, 0.32);
          } else if (k === 'serve') {
            var jumpS = e.shot === 'jump' || e.serveType === 'jump', floatS = e.shot === 'float' || e.serveType === 'float';
            var fast = jumpS || (!floatS && (e.speed || 0) > 13);
            spin.rate = floatS ? 0.4 : fast ? 26 : 14; spin.sign = 1; spin.wob = floatS ? 1.8 : 0;
            if (!(tbSwap && fast)) flashAt(e.x, e.y, e.z, fast ? 0.95 : 0.6, 0.11, 1, 0.94, 0.8);
            if (!(tbSwap && fast)) burstAt(e.x, e.y, e.z, fast ? 12 : 6, fast ? 3.6 : 2.2, 1, 0.88, 0.66, 0.6, 8);
            if (fast) { if (!tbSwap) shockAt(e.x, e.y, e.z, 1.5, 0.18, 1, 0.9, 0.7); startTrail(1, 0.96, 0.78, 0.12, 0.7); heat = 0.4; burstToon(e.x, e.y, e.z, 0.6, 0.13); starsAt(e.x, e.y, e.z, 2, 1.4, 0.2); }
            else sparkToon(e.x, e.y, e.z, 1, 0.22);
            if (jumpS) speedLines(4, 0.28);
            else trailA = 0;
            squash.t = 0.12; squash.k = fast ? 0.08 : 0.05;
          } else if (k === 'set') {
            spin.rate = 3; spin.sign = -1; spin.wob = 0;
            flashAt(e.x, e.y, e.z, 0.42, 0.07, 0.85, 0.92, 1);
            burstAt(e.x, e.y, e.z, 3, 1.2, 0.8, 0.9, 1, 0.8, 6);
            sparkToon(e.x, e.y, e.z, 1, 0.18);
            trailA = 0; squash.t = 0.1; squash.k = 0.035;
          } else if (tip) { // dejada: toque suave con la punta de los dedos, sin estela
            spin.rate = 2; spin.sign = -1; spin.wob = 0;
            flashAt(e.x, e.y, e.z, 0.36, 0.07, 1, 0.95, 0.85);
            burstAt(e.x, e.y, e.z, 3, 1.0, 1, 0.92, 0.75, 0.6, 6);
            trailA = 0; squash.t = 0.08; squash.k = 0.03;
          } else { // pass / free (recepción, defensa, plancha, balón libre)
            spin.rate = 6 + Math.random() * 6; spin.sign = -1; spin.wob = 0;
            var shank = e.shot === 'shank';
            flashAt(e.x, e.y, e.z, shank ? 0.4 : 0.52, 0.08, 0.92, 0.95, 1);
            burstAt(e.x, e.y, e.z, shank ? 3 : 5, 1.6, 0.85, 0.92, 1, 0.8, 7);
            sparkToon(e.x, e.y, e.z, shank ? 1 : 2, 0.2);
            trailA = 0; squash.t = 0.1; squash.k = 0.06;
          }
          // toque perfecto del humano: anillo dorado y chispas doradas (recompensa visible, sin cegar)
          if (perfect) {
            if (!tbSwap) {
              shockAt(e.x, e.y, e.z, k === 'spike' || k === 'serve' ? 2.3 : 1.6, 0.26, 1, 0.8, 0.28);
              burstAt(e.x, e.y, e.z, k === 'spike' ? 14 : 9, k === 'spike' ? 4.2 : 2.6, 1, 0.78, 0.25, 0.9, 5);
              if (k !== 'set') flashAt(e.x, e.y, e.z, k === 'spike' ? 1.35 : 0.75, 0.1, 1, 0.85, 0.45);
            }
            starsAt(e.x, e.y, e.z, k === 'spike' ? 3 : 2, 2.0, 0.28);
            if (k === 'spike') onoAt(e.x, e.y, e.z); // «¡PAM!» solo en el remate perfecto del humano
          }
          // orientación del aplastamiento: eje Y local según la dirección de salida
          tv.set(g.ball.vx, g.ball.vz, -g.ball.vy); if (tv.lengthSq() < 1e-6) tv.set(0, 1, 0); tv.normalize();
          squashQ.setFromUnitVectors(UPV, tv);
          break;
        }
        case 'block': {
          var tb = T[e.team === 1 ? 1 : 0], res = e.result || 'stuff';
          if (res === 'stuff') { // bloqueo directo: impacto contundente
            if (!tbSwap) {
              flashAt(e.x, e.y, e.z, 1.25, 0.14, 1, 0.97, 0.92);
              shockAt(e.x, e.y, e.z, 2.4, 0.22, tb.r, tb.g, tb.b);
              burstAt(e.x, e.y, e.z, 22, 4.6, 1, 0.95, 0.85, 0.5, 8);
              burstAt(e.x, e.y, e.z, 10, 3.4, tb.r, tb.g, tb.b, 0.4, 8);
            }
            squash.t = 0.12; squash.k = 0.095; spin.rate = 12;
            burstToon(e.x, e.y, e.z, 1.05, 0.18); starsAt(e.x, e.y, e.z, 5, 2.2, 0.26);
          } else { // 'soft' (toque de bloqueo jugable) / 'tool' (block-out): roce
            if (!tbSwap) flashAt(e.x, e.y, e.z, 0.6, 0.09, 0.95, 0.97, 1);
            if (!tbSwap) burstAt(e.x, e.y, e.z, res === 'tool' ? 8 : 5, 2.0, 0.95, 0.95, 1, 0.5, 8);
            starsAt(e.x, e.y, e.z, 2, 1.4, 0.2);
            squash.t = 0.1; squash.k = 0.06; spin.rate = res === 'tool' ? 14 : 6;
          }
          trailA = 0; spin.sign = -1; spin.wob = 0;
          break;
        }
        case 'netTouch': { // un jugador toca la red: chispa fría en la cinta (plano de la red, x = 0)
          var nz = Math.min(C.NET_H, Math.max(1.6, e.z || C.NET_H));
          flashAt(0, e.y, nz, 0.55, 0.1, 0.75, 0.9, 1);
          burstAt(0, e.y, nz, 12, 2.4, 0.7, 0.88, 1, 0.3, 7);
          sparkToon(0, e.y, nz, 2, 0.22);
          break;
        }
        case 'dive': { // plancha: polvo de parquet que sale hacia delante + onda en el suelo
          var dx = e.dir ? e.dir[0] : 0, dy = e.dir ? e.dir[1] : 0, px = e.player ? e.player.x : e.x, py = e.player ? e.player.y : e.y;
          dustAt(px + dx * 0.7, py + dy * 0.7, 22, 0.75, dx, dy, 0.6, 1.5, 0.1); // a lo largo del cuerpo (piernas→pecho)
          rippleAt(px + dx * 0.3, py + dy * 0.3, 1.3, 0.45, 0.95, 0.88, 0.75, 0.3);
          puffsAt(px + dx * 0.8, py + dy * 0.8, 4, dx, dy, 1.4, 0.42); // nubes de dibujo a lo largo del cuerpo
          if (onBeach()) { // playa: arena que salta hacia delante y surco del cuerpo
            sandAt(px + dx * 0.6, py + dy * 0.6, 26, 1.0, dx, dy, 0.5);
            if (dx || dy) footAt(px + dx * 0.85, py + dy * 0.85, Math.atan2(dy, dx), 1, 1.9, 0.78, 0.85);
          }
          break;
        }
        case 'net':
          burstAt(e.x || 0, e.y, e.z, 8, 1.6, 0.9, 0.95, 1, 0.3, 6);
          trailA = Math.min(trailA, 0.3);
          break;
        case 'land': {
          var sp2 = e.speed || 4;
          if (e.inside) rippleAt(e.x, e.y, 1.6 + sp2 * 0.12, 0.6, 1, 0.95, 0.85, 0.9);
          else rippleAt(e.x, e.y, 1.6 + sp2 * 0.12, 0.7, 1, 0.25, 0.18, 0.95);
          markAt(e.x, e.y, e.inside, sp2, g && g.ball ? g.ball.vx : 0, g && g.ball ? g.ball.vy : 0);
          if (!(tbSwap && sp2 > 8)) burstAt(e.x, e.y, 0.05, 10 + Math.min(14, sp2), 1.5 + sp2 * 0.15, 0.95, 0.9, 0.8, 1.2, 9);
          trailA = Math.min(trailA, 0.25);
          if (sp2 > 8) { if (!tbSwap) shockAt(e.x, e.y, 0.15, 1.6, 0.25, 1, 0.9, 0.8); puffsAt(e.x, e.y, 3, 0, 0, 0, 0.4); }
          if (onBeach()) { // playa: corona de arena y cráter del balón
            sandAt(e.x, e.y, 14 + Math.min(12, sp2), 0.45 + Math.min(0.5, sp2 * 0.03), g && g.ball ? g.ball.vx : 0, g && g.ball ? g.ball.vy : 0, 0.15);
            footAt(e.x, e.y, 0, 2, 0.55 + Math.min(0.15, sp2 * 0.01), 0.55 + Math.min(0.15, sp2 * 0.01), 0.85);
          }
          break;
        }
        case 'bounce':
          if ((e.speed || 0) > 2.5) { rippleAt(e.x, e.y, 0.9, 0.45, 1, 1, 1, 0.4); if (onBeach()) sandAt(e.x, e.y, 6, 0.35, 0, 0, 0.1); }
          break;
        case 'landPlayer':
          if (e.player) { rippleAt(e.player.x, e.player.y, 1.0, 0.4, 0.9, 0.9, 0.95, 0.3); dustAt(e.player.x, e.player.y, 5, 0.6, 0, 0, 0); puffsAt(e.player.x, e.player.y, 2, 0, 0, 0, 0.3);
            if (onBeach()) { sandAt(e.player.x, e.player.y, 10, 0.55, 0, 0, 0.25); footAt(e.player.x, e.player.y, 0, 2, 0.75, 0.6, 0.5); } } // playa: arena al caer del salto
          break;
        case 'challenge': // B6: empieza la revisión; las marcas del bote (con la llamada del árbitro) se quitan: manda la huella
          for (var cm = 0; cm < MARK_N; cm++) { markPool[cm].t = 0; markPool[cm].m.visible = false; markPool[cm].r.visible = false; }
          rv.res = -1;
          break;
        case 'challengeResult': // la huella se tiñe con la verdad (verde dentro / rojo fuera) y queda ~2 s
          rv.res = e.truthIn ? 1 : 0;
          if (!rv.on && isFinite(e.x) && isFinite(e.y)) { rv.x = e.x; rv.y = e.y; placeReview(e.x, e.y); rv.on = true; rv.k = 1; rv.hold = 2.2; }
          break;
        case 'set': // set: un poco en el plano + los cañones de las esquinas
          confettiInFrame(e.team === 1 ? 1 : 0, Math.round(70 * (qScale > 0.6 ? 1 : 0.7)));
          confetti(e.team === 1 ? 1 : 0, 110);
          break;
        case 'match': // partido: la mayor parte en el plano actual (se ve en el primer segundo), el resto desde las esquinas
          confettiInFrame(e.team === 1 ? 1 : 0, Math.round(confCap * 0.65));
          confetti(e.team === 1 ? 1 : 0, confCap);
          break;
      }
    }
  };
})();
