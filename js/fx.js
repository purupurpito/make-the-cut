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
  var ballPivot, ball, ballMat, ballShadow, dropLine, marker, markerMat, focusRing, focusMat, focusFill, ballOutline;
  var aimRet, aimMat, aim = { a: 0, x: -6, y: 0, tx: -6, ty: 0, on: false, live: false, kill: 0 }, aimOut = { x: 0, y: 0 };
  var hwOut = { t: 0, press: 0 }, focusVis = false;
  var AIM_N = 30, aimArc = null; // arco punteado balón -> objetivo (se lee aunque el campo rival salga aplastado)
  var YEL = [1, 0.76, 0.04]; // "aro amarillo" = dónde tienes que jugar el balón (focusRing)
  var spinQ, squashQ, tmpQ, tv, tv2, tv3, axis, UPV;
  var spin = { rate: 0, sign: 1, wob: 0 }, squash = { t: 0, k: 0 }, heat = 0;
  var SQ_MAX = 0.095; // (1 + k/2) / (1 - k) ≈ 1,15: el balón se deforma sin dejar de leerse como balón
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
  /** Huella del balón en la tarima: óvalo oscuro con el borde más marcado (como el roce de la goma). */
  function printTex() {
    var cv = canvas(128, 128), g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(46,30,16,0.42)'); gr.addColorStop(0.55, 'rgba(40,26,14,0.62)'); gr.addColorStop(0.74, 'rgba(30,20,10,0.8)');
    gr.addColorStop(0.86, 'rgba(30,20,10,0.25)'); gr.addColorStop(1, 'rgba(30,20,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(cv);
  }
  /** Onda de choque: filo brillante fino con un halo interior muy tenue que cae a 0 (nada de disco gris). */
  function shockRingTex() {
    var cv = canvas(256, 256), g = cv.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.12)');
    gr.addColorStop(0.88, 'rgba(255,255,255,1)'); gr.addColorStop(0.93, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return tex(cv);
  }
  /** Balón: cada cara de la esfera-cubo es un grupo de 3 paneles (colores originales). */
  function ballTexture() {
    var S = 256, cv = canvas(S, S), g = cv.getContext('2d');
    var cols = ['#ff6a3d', '#f7f3ea', '#1d3f7a'];
    for (var i = 0; i < 3; i++) {
      var x0 = i * S / 3, gr = g.createLinearGradient(x0, 0, x0 + S / 3, 0);
      gr.addColorStop(0, shade(cols[i], -0.12)); gr.addColorStop(0.5, cols[i]); gr.addColorStop(1, shade(cols[i], -0.12));
      g.fillStyle = gr; g.fillRect(x0, 0, S / 3 + 1, S);
    }
    // costuras (entre paneles y en el borde del grupo)
    g.fillStyle = 'rgba(20,18,16,0.55)';
    g.fillRect(S / 3 - 2, 0, 4, S); g.fillRect(2 * S / 3 - 2, 0, 4, S);
    g.fillStyle = 'rgba(20,18,16,0.7)'; g.fillRect(0, 0, S, 4); g.fillRect(0, S - 4, S, 4); g.fillRect(0, 0, 4, S); g.fillRect(S - 4, 0, 4, S);
    // sombreado de panel abombado
    var vg = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
    vg.addColorStop(0, 'rgba(255,255,255,0.08)'); vg.addColorStop(1, 'rgba(0,0,0,0.18)'); g.fillStyle = vg; g.fillRect(0, 0, S, S);
    // logotipo diminuto en el panel blanco
    g.save(); g.translate(S / 2, S / 2); g.rotate(-Math.PI / 2); g.fillStyle = 'rgba(29,63,122,0.55)';
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

  function addSpark(x, y, z, vx, vy, vz, life, r, g, b, grav) {
    var s = sp[spHead]; spHead = (spHead + 1) % SPARK_N;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = life; s.max = life; s.r = r; s.g = g; s.b = b; s.grav = grav;
  }
  function burstAt(x, y, z, n, power, r, g, b, up, grav) {
    n = Math.max(1, Math.round(n * qScale));
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, e = Math.random() * 1.3 - 0.25, v = power * (0.35 + Math.random() * 0.85);
      addSpark(x, y, z, Math.cos(a) * Math.cos(e) * v, Math.sin(a) * Math.cos(e) * v, Math.sin(e) * v + (up || 0.8),
        0.25 + Math.random() * 0.35, r, g, b, grav == null ? 9 : grav);
    }
    spAlive = 1;
  }
  /** Polvo de parquet (coords de sim): nube baja que se expande y se desvanece. */
  function dustAt(x, y, n, spread, dirx, diry, push) {
    n = Math.max(2, Math.round(n * qScale));
    for (var i = 0; i < n; i++) {
      var d = du[duHead]; duHead = (duHead + 1) % DUST_N;
      var a = Math.random() * 6.283, v = spread * (0.3 + Math.random() * 0.7), f = push * (0.4 + Math.random() * 0.8);
      d.x = x + Math.cos(a) * 0.15; d.y = y + Math.sin(a) * 0.15; d.z = 0.05 + Math.random() * 0.12;
      d.vx = Math.cos(a) * v + dirx * f; d.vy = Math.sin(a) * v + diry * f; d.vz = 0.35 + Math.random() * 0.6;
      d.life = d.max = 0.7 + Math.random() * 0.6; d.s = 0.5 + Math.random() * 0.5;
    }
    duAlive = 1;
  }
  /** Atenúa destellos muy cerca de la cámara (golpes del propio jugador): que no tapen la jugada. */
  function nearFade(p) { var d = ctx.camera.position.distanceTo(p); return Math.max(0.12, Math.min(1, (d - 2) / 6)); }
  var FLASH_K = 0.62; // intensidad del destello aditivo: solo el núcleo llega al umbral del bloom
  function flashAt(x, y, z, size, dur, r, g, b) {
    var f = flashPool[flashHead]; flashHead = (flashHead + 1) % FLASH_N;
    VB.toThree(x, y, z, f.s.position); f.t = dur; f.d = dur; f.size = size; f.s.material.color.setRGB(r * FLASH_K, g * FLASH_K, b * FLASH_K); f.s.visible = true;
    f.near = nearFade(f.s.position);
  }
  function shockAt(x, y, z, size, dur, r, g, b) {
    var w = wavePool[waveHead]; waveHead = (waveHead + 1) % WAVE_N;
    VB.toThree(x, y, z, w.s.position); w.t = dur; w.d = dur; w.size = size; w.s.material.color.setRGB(r, g, b); w.s.visible = true;
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
  var MARK_LIFE = 5.2;
  function markAt(x, y, inside, speed, vx, vy) {
    var m = markPool[markHead]; markHead = (markHead + 1) % MARK_N;
    m.m.position.x = x; m.m.position.z = -y; m.r.position.x = x; m.r.position.z = -y;
    m.t = MARK_LIFE; m.d = MARK_LIFE;
    var s = 0.46 + Math.min(0.16, speed * 0.012), hs = Math.hypot(vx || 0, vy || 0);
    m.s = s; m.stretch = 1 + Math.min(0.45, hs * 0.03);
    // óvalo alargado en la dirección del vuelo (sim (vx,vy) -> plano del suelo; rotation.z gira en el plano)
    m.m.rotation.z = hs > 0.1 ? Math.atan2(vy, vx) : 0;
    m.m.scale.set(s * m.stretch, s, 1);
    if (inside) m.r.material.color.setRGB(0.12, 0.9, 0.24); else m.r.material.color.setRGB(1, 0.05, 0.03); // lineales: verde / rojo vivos
    m.m.visible = true; m.r.visible = true;
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
      var f = 1 - i / (TN - 1), w = trailW * (0.25 + 0.75 * f) * (l > 1e-6 ? 1 / l : 0);
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
    var b = g.ball, a, tx, ty, mode = 0;
    if (g.mode === 'serve') {
      var sv = g.server; if (!sv || sv.team !== 0) return 0;
      mode = g.serveState === 'toss' ? 2 : (g.serveAuth ? 1 : 0);
      if (!mode) return 0;
    } else if (g.mode === 'rally') {
      var hp = g.ctrl;
      if (!hp || hp.team !== 0 || hp.z < 0.12 || g.touchTeam !== 0 || g.touches !== 2) return 0;
      if (b.x < -0.2 || b.x > 4.5 || b.z < C.NET_H) return 0;
      mode = 2;
    } else return 0;
    if (Sim.aimPoint) {
      var r = Sim.aimPoint(g, out);
      if (!r) return 0;
      if (r !== out && r.x != null) { out.x = r.x; out.y = r.y; }
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
    out.x = tx; out.y = ty;
    return mode;
  }

  /** Arco punteado del balón al objetivo, pasando por encima de la red (vista previa de la dirección, no física). */
  function updateAimArc(b, tx, ty, a) {
    var pa = aimArc.geometry.attributes.position.array, ca = aimArc.geometry.attributes.color.array;
    var sx = b.x, sy = b.y, sz = b.z, t0 = sx !== tx ? sx / (sx - tx) : 0.5;
    t0 = clampN(t0, 0.15, 0.85);
    var zNet = sz * (1 - t0), h = Math.max(0.5, (C.NET_H + 0.55 - zNet) / (4 * t0 * (1 - t0)));
    var scroll = (ctx.time * 1.6) % 1;
    for (var i = 0; i < AIM_N; i++) {
      var t = (i + scroll) / AIM_N, x = sx + (tx - sx) * t, y = sy + (ty - sy) * t, z = sz * (1 - t) + 4 * h * t * (1 - t);
      pa[i * 3] = x; pa[i * 3 + 1] = Math.max(0.03, z); pa[i * 3 + 2] = -y;
      var k = a * 0.95 * Math.min(1, 0.3 + t * 4);
      ca[i * 4] = 1; ca[i * 4 + 1] = 0.36; ca[i * 4 + 2] = 0.09; ca[i * 4 + 3] = k;
    }
    aimArc.geometry.attributes.position.needsUpdate = true; aimArc.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- Confeti ----------
  function confetti(team, n) {
    n = Math.round(n * (qScale > 0.6 ? 1 : 0.5));
    var palette = team === 0 ? [[1, 0.36, 0.2], [1, 0.62, 0.22], [1, 0.82, 0.25], [1, 1, 1]] : [[0.25, 0.55, 1], [0.5, 0.75, 1], [1, 0.82, 0.25], [1, 1, 1]];
    var start = confAlive;
    for (var i = 0; i < n && confAlive < CONF_N; i++) {
      var d = confD[confAlive++], cannon = i % 3 === 0;
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
        d.vz -= 9 * dt; var drag = d.vz < 0 ? 3.2 : 0.6; d.vx -= d.vx * drag * 0.4 * dt; d.vy -= d.vy * drag * 0.4 * dt; d.vz -= d.vz * drag * dt;
        d.x += (d.vx + Math.sin(ctx.time * 3 + d.ph) * 0.6) * dt; d.y += (d.vy + Math.cos(ctx.time * 2.6 + d.ph) * 0.6) * dt; d.z += d.vz * dt;
        d.ang += d.spin * dt;
      } else { d.z = 0.012; d.vz = 0; d.ax = 1; d.ay = 0; d.az = 0; d.ang = Math.PI / 2; } // en el suelo, plano
      VB.toThree(d.x, d.y, Math.max(0.012, d.z), tv);
      axis.set(d.ax, d.ay, d.az); tmpQ.setFromAxisAngle(axis, d.ang);
      tv2.set(1, 1, 1); confM.compose(tv, tmpQ, tv2); conf.setMatrixAt(i, confM);
      i++;
    }
    conf.count = confAlive; conf.visible = confAlive > 0; conf.instanceMatrix.needsUpdate = true;
  }
  var confM = null;

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
      ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.42, metalness: 0, envMapIntensity: 0.9, emissive: new THREE.Color(0xff5a20), emissiveIntensity: 0 });
      // castShadow = false: la sombra del mapa de sombras y la de contacto eran DOS manchas separadas en el
      // suelo; la buena para jugar es la de contacto (siempre en vertical bajo el balón).
      var bgeo = ballGeometry(C.BR);
      ball = new THREE.Mesh(bgeo, ballMat); ball.castShadow = false; ballPivot.add(ball);
      // contorno oscuro (cáscara de caras traseras): separa el balón del público, que tiene sus mismos colores.
      // Grosor constante en píxeles (ver update).
      ballOutline = new THREE.Mesh(bgeo, new THREE.MeshBasicMaterial({ color: 0x0b1222, side: THREE.BackSide }));
      ballOutline.renderOrder = 0; ballPivot.add(ballOutline);

      // sombra de contacto (siempre en vertical bajo el balón: legibilidad)
      ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: radialTex([[0, 'rgba(0,0,0,0.85)'], [0.45, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
      ballShadow.rotation.x = -Math.PI / 2; ballShadow.position.y = 0.012; ballShadow.renderOrder = 2; root.add(ballShadow);

      // línea vertical tenue balón -> suelo (lectura de altura)
      var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      dropLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
      dropLine.frustumCulled = false; root.add(dropLine);

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
      marker.rotation.x = -Math.PI / 2; marker.position.y = 0.016; marker.renderOrder = 3; root.add(marker);

      // "aro amarillo": punto donde tu equipo jugará el balón (1 m / 3 m). Es EL objetivo del jugador
      // (texto del entrenador: "ve al aro amarillo"): amarillo saturado con filo oscuro, se cierra según
      // hitWindow().press y se rellena en el instante de pulsar.
      focusMat = new THREE.MeshBasicMaterial({ map: outlinedRingTex(104, 16), transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false });
      focusMat.color.setRGB(YEL[0], YEL[1], YEL[2]);
      focusRing = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), focusMat);
      focusRing.rotation.x = -Math.PI / 2; focusRing.position.y = 0.017; focusRing.renderOrder = 4; root.add(focusRing);
      focusFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: radialTex([[0, 'rgba(255,255,255,0.75)'], [0.6, 'rgba(255,255,255,0.45)'], [0.8, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']], 64),
        transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      focusFill.material.color.setRGB(YEL[0], YEL[1], YEL[2]);
      focusFill.rotation.x = -Math.PI / 2; focusFill.position.y = 0.0165; focusFill.renderOrder = 3; focusFill.visible = false; root.add(focusFill);

      // retícula de apuntado en el campo rival (saque y remate del humano)
      aimMat = new THREE.MeshBasicMaterial({ map: aimTex(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      aimMat.color.set('#ff6326'); // (setRGB es LINEAL con ColorManagement: (1,0.5,0.24) salía color melocotón pálido)
      aimRet = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), aimMat);
      aimRet.rotation.x = -Math.PI / 2; aimRet.position.y = 0.019; aimRet.renderOrder = 4; aimRet.visible = false; root.add(aimRet);
      // puntos opacos con filo oscuro (mezcla normal: el aditivo desaparecía sobre la tarima clara)
      var dcv = canvas(64, 64), dg = dcv.getContext('2d');
      dg.fillStyle = 'rgba(10,6,2,0.6)'; dg.beginPath(); dg.arc(32, 32, 26, 0, 6.283); dg.fill();
      dg.fillStyle = '#ffffff'; dg.beginPath(); dg.arc(32, 32, 18, 0, 6.283); dg.fill();
      var agp = new Float32Array(AIM_N * 3), agc = new Float32Array(AIM_N * 4), ag = new THREE.BufferGeometry();
      ag.setAttribute('position', new THREE.BufferAttribute(agp, 3)); ag.setAttribute('color', new THREE.BufferAttribute(agc, 4));
      aimArc = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.2, map: tex(dcv), vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
      aimArc.frustumCulled = false; aimArc.renderOrder = 7; aimArc.visible = false; root.add(aimArc);

      // estela tipo cinta (aditiva, orientada a cámara)
      tPts = new Float32Array(TN * 3); tPos = new Float32Array(TN * 6); tCols = new Float32Array(TN * 6);
      var tg = new THREE.BufferGeometry(), idx = [];
      for (var i = 0; i < TN - 1; i++) { var a0 = i * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
      tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(tCols, 3)); tg.setIndex(idx);
      // transparent:false a propósito: en r149 un material transparente DoubleSide cambia side y pone needsUpdate dos veces
      // por objeto y frame (recalcula el programa). Aditivo + sin profundidad funciona igual en la lista opaca (renderOrder alto).
      trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: false, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      trail.frustumCulled = false; trail.visible = false; trail.renderOrder = 6; root.add(trail);

      // chispas
      var sPos = new Float32Array(SPARK_N * 3), sCol = new Float32Array(SPARK_N * 3);
      for (var j = 0; j < SPARK_N; j++) { sp.push({ x: 0, y: 0, z: -50, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1, grav: 9 }); sPos[j * 3 + 1] = -50; }
      var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
      sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.13, map: radialTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64),
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sparks.frustumCulled = false; sparks.renderOrder = 7; root.add(sparks);

      // destellos y ondas de choque (sprites aditivos)
      var flashTex = radialTex([[0, 'rgba(255,250,235,1)'], [0.1, 'rgba(255,232,190,0.7)'], [0.32, 'rgba(255,190,120,0.16)'], [0.6, 'rgba(255,170,100,0.04)'], [1, 'rgba(255,160,90,0)']]);
      for (var f = 0; f < FLASH_N; f++) {
        var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        s.visible = false; s.renderOrder = 8; root.add(s); flashPool.push({ s: s, t: 0, d: 1, size: 1, near: 1 });
      }
      var shockTex = shockRingTex();
      for (var w = 0; w < WAVE_N; w++) {
        var ws = new THREE.Sprite(new THREE.SpriteMaterial({ map: shockTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        ws.visible = false; ws.renderOrder = 8; root.add(ws); wavePool.push({ s: ws, t: 0, d: 1, size: 1, near: 1 });
      }
      // ondas en el suelo (caída del balón, aterrizajes)
      var ripTex = ringTex(0.7, 0.86, 0.12), ripGeo = new THREE.PlaneGeometry(1, 1);
      for (var rI = 0; rI < RIP_N; rI++) {
        var rm = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: ripTex, transparent: true, depthWrite: false, toneMapped: false }));
        rm.rotation.x = -Math.PI / 2; rm.position.y = 0.018; rm.visible = false; rm.renderOrder = 3; root.add(rm); ripPool.push({ m: rm, t: 0, d: 1, size: 1, op: 1 });
      }
      // marcas del balón en el suelo
      // marcas del bote: huella oscura + filo de color dentro/fuera
      var markTex = printTex(), rimTex = outlinedRingTex(100, 18);
      for (var mI = 0; mI < MARK_N; mI++) {
        var mm = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false, opacity: 0.9 }));
        mm.rotation.x = -Math.PI / 2; mm.position.y = 0.015; mm.visible = false; mm.renderOrder = 2; root.add(mm);
        var mr = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: rimTex, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }));
        mr.rotation.x = -Math.PI / 2; mr.position.y = 0.0155; mr.visible = false; mr.renderOrder = 3; root.add(mr);
        markPool.push({ m: mm, r: mr, t: 0, d: 1, s: 0.5, stretch: 1 });
      }
      // polvo de parquet (plancha, aterrizajes): Points con alfa por vértice y mezcla normal
      var dPos = new Float32Array(DUST_N * 3), dCol = new Float32Array(DUST_N * 4);
      for (var dI = 0; dI < DUST_N; dI++) { du.push({ x: 0, y: 0, z: -50, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s: 1 }); dPos[dI * 3 + 1] = -50; }
      var dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dPos, 3)); dg.setAttribute('color', new THREE.BufferAttribute(dCol, 4));
      dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.75, map: radialTex([[0, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], 64),
        vertexColors: true, transparent: true, depthWrite: false }));
      dust.frustumCulled = false; dust.renderOrder = 4; dust.visible = false; root.add(dust);
      // confeti
      conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.075, 0.12), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CONF_N);
      for (var q = 0; q < CONF_N; q++) { confD.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 1, ay: 0, az: 0, ang: 0, spin: 0, ph: 0, life: 0 }); conf.setColorAt(q, tv.set(1, 1, 1)); }
      conf.instanceMatrix.setUsage(THREE.DynamicDrawUsage); conf.count = 0; conf.visible = false; conf.frustumCulled = false; root.add(conf);
      this.setQuality(c.quality);
    },
    setQuality: function (q) { qScale = !q ? 1 : q.rank >= 2 ? 1 : q.rank === 1 ? 0.75 : 0.45; },
    onGameStart: function () {
      trailA = 0; heat = 0; squash.t = 0; spin.rate = 0;
      for (var i = 0; i < SPARK_N; i++) sp[i].life = 0;
      for (var dI = 0; dI < DUST_N; dI++) du[dI].life = 0;
      for (var f = 0; f < FLASH_N; f++) { flashPool[f].t = 0; flashPool[f].s.visible = false; }
      for (var w = 0; w < WAVE_N; w++) { wavePool[w].t = 0; wavePool[w].s.visible = false; }
      for (var r = 0; r < RIP_N; r++) { ripPool[r].t = 0; ripPool[r].m.visible = false; }
      for (var m = 0; m < MARK_N; m++) { markPool[m].t = 0; markPool[m].m.visible = false; markPool[m].r.visible = false; }
      aim.a = 0; aim.on = false; aimRet.visible = false; aimArc.visible = false; focusFill.visible = false;
      confAlive = 0; conf.count = 0; conf.visible = false;
    },
    /** Partículas en coordenadas de simulación (interfaz del contrato). */
    burst: function (x, y, z, n, power) { burstAt(x, y, z, n, power, 1, 0.92, 0.7, 1, 9); },
    /** Polvo de la tarima (coords de sim), p. ej. planchas cosméticas de players.js. */
    dust: function (x, y, n, dirx, diry) { dustAt(x, y, n || 22, 0.9, dirx || 0, diry || 0, 2.4); },
    /** Confeti del color de un equipo (opcional). */
    confetti: function (team, n) { confetti(team === 1 ? 1 : 0, n || 400); },
    /** Malla del balón (opcional, para otros módulos). */
    ballObject: function () { return ballPivot; },
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
      // tamaño mínimo en pantalla: radio >= 1,1 % de la altura del visor (máx. x1,6; el radio físico no cambia).
      // Lejos (saque rival, remate de la CPU en móvil) el balón ya no se queda en 2 px perdido en la grada.
      var cam = ctx.camera, dCam = cam.position.distanceTo(ballPivot.position), tanH = Math.tan(cam.fov * Math.PI / 360);
      var bs = clampN(0.022 * dCam * tanH / C.BR, 1, 1.6);
      var ballPx = C.BR * bs / Math.max(0.01, dCam * tanH) * (ctx.height || 720) * 0.5;
      ballPivot.quaternion.copy(squashQ); ballPivot.scale.set(bs * (1 + sq * 0.5), bs * (1 - sq), bs * (1 + sq * 0.5));
      // contorno de ~1,4 px (más fino de cerca, donde ya se lee solo)
      var ol = 1 + clampN(1.4 / Math.max(1, ballPx), 0.03, 0.2); ballOutline.scale.set(ol, ol, ol);
      // la malla compensa la orientación del pivote para mantener el giro en mundo
      ball.quaternion.copy(squashQ).invert().multiply(spinQ);
      ballMat.emissiveIntensity = heat * 0.25; // filo cálido; los paneles siguen leyéndose

      // ---- sombra de contacto ----
      var h = Math.max(0, b.z - C.BR), s = 0.62 / (1 + h * 0.1);
      ballShadow.position.x = b.x; ballShadow.position.z = -b.y; ballShadow.scale.set(s, s, s);
      ballShadow.material.opacity = Math.max(0.22, 0.95 / (1 + h * 0.22));

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
      var showFocus = inPlay && !g.demo && g.jobs && g.jobs[0] && Sim.focusPoint;
      var fp = showFocus ? Sim.focusPoint(g) : null;
      focusVis = !!fp;
      focusRing.visible = focusVis; focusFill.visible = false;
      if (focusVis) {
        focusRing.position.x = fp.x; focusRing.position.z = -fp.y;
        // se cierra hasta el instante de PULSAR (hitWindow.press) y se rellena en ese momento
        var press = 1.2;
        if (Sim.hitWindow) { var hw = Sim.hitWindow(g, g.jobs[0], hwOut); if (hw && isFinite(hw.press)) press = hw.press; }
        var pk = clampN(press / 1.1, 0, 1), fsz = 0.72 + pk * 0.78 + Math.sin(ctx.time * 7) * 0.025 * pk;
        focusRing.scale.set(fsz, fsz, fsz);
        var now = clampN(1 - Math.abs(press) / 0.22, 0, 1);
        focusMat.opacity = 0.82 + 0.18 * now;
        if (now > 0.01) {
          focusFill.visible = true; focusFill.position.x = fp.x; focusFill.position.z = -fp.y;
          var ffs = fsz * 1.05; focusFill.scale.set(ffs, ffs, ffs); focusFill.material.opacity = 0.55 * now;
        }
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
        var out = Math.abs(land.x) > C.HL + tol || Math.abs(land.y) > C.HW + tol;
        var mo;
        if (g.demo) { markerMat.color.setRGB(0.9, 0.95, 1); mo = 0.55; }
        else if (mine && !focusVis) { markerMat.color.setRGB(YEL[0], YEL[1], YEL[2]); mo = 0.95; } // nadie tuyo va: el bote es lo que importa
        else if (mine) { markerMat.color.setRGB(1, 1, 1); mo = 0.6; }                             // blanco: no compite con el aro amarillo
        else { markerMat.color.setRGB(0.55, 0.8, 1); mo = 0.6; }
        markerMat.opacity = mo * (out ? 0.55 : 1);
      }
      // ---- retícula de apuntado (saque / remate del humano) ----
      var am = aimTarget(g, aimOut), rdt = ctx.realDt || 0;
      if (am) {
        if (!aim.on) { aim.x = aimOut.x; aim.y = aimOut.y; }
        aim.on = true; aim.tx = aimOut.x; aim.ty = aimOut.y;
        var ka = 1 - Math.exp(-16 * rdt); aim.x += (aim.tx - aim.x) * ka; aim.y += (aim.ty - aim.y) * ka;
        aim.a = Math.min(am === 2 ? 1 : 0.5, aim.a + rdt * 5);
        if (aim.a > (am === 2 ? 1 : 0.5)) aim.a = am === 2 ? 1 : 0.5;
      } else {
        aim.on = false; aim.a = Math.max(0, aim.a - rdt * (aim.kill > 0 ? 6 : 4));
      }
      if (aim.kill > 0) aim.kill -= rdt;
      aimRet.visible = aim.a > 0.01;
      if (aimRet.visible) {
        aimRet.position.x = aim.x; aimRet.position.z = -aim.y;
        var asz = 1 + (1 - Math.min(1, aim.a * 2)) * 0.35 + Math.sin(ctx.time * 5) * 0.03;
        aimRet.scale.set(asz, asz, asz); aimRet.rotation.z = -ctx.time * 0.6;
        aimMat.opacity = 0.9 * aim.a;
      }
      // arco: solo con el apuntado activo (balón lanzado / en el aire para rematar)
      aimArc.visible = aimRet.visible && aim.on && am === 2 && !b.held;
      if (aimArc.visible) updateAimArc(b, aim.x, aim.y, aim.a);

      updateTrail(dt);

      // ---- chispas ----
      if (spAlive) {
        var pa = sparks.geometry.attributes.position.array, ca = sparks.geometry.attributes.color.array, alive = 0;
        for (var j = 0; j < SPARK_N; j++) {
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
        if (!alive) spAlive = 0;
      }
      // ---- polvo ----
      if (duAlive) {
        var dp = dust.geometry.attributes.position.array, dc = dust.geometry.attributes.color.array, dAlive = 0;
        for (var dI = 0; dI < DUST_N; dI++) {
          var D = du[dI];
          if (D.life > 0) {
            if (dt > 0) {
              D.life -= dt; var ddr = 1 - 3.2 * dt; D.vx *= ddr; D.vy *= ddr; D.vz = D.vz * (1 - 2 * dt) - 0.25 * dt;
              D.x += D.vx * dt; D.y += D.vy * dt; D.z = Math.max(0.04, D.z + D.vz * dt);
            }
            var lk = Math.max(0, D.life / D.max), al = Math.min(1, (1 - lk) * 6) * Math.sqrt(lk) * 0.7 * D.s;
            dp[dI * 3] = D.x; dp[dI * 3 + 1] = D.z; dp[dI * 3 + 2] = -D.y;
            dc[dI * 4] = 0.97; dc[dI * 4 + 1] = 0.9; dc[dI * 4 + 2] = 0.8; dc[dI * 4 + 3] = al; dAlive++;
          } else if (dp[dI * 3 + 1] !== -50) { dp[dI * 3 + 1] = -50; dc[dI * 4 + 3] = 0; }
        }
        dust.geometry.attributes.position.needsUpdate = true; dust.geometry.attributes.color.needsUpdate = true;
        dust.visible = dAlive > 0; if (!dAlive) duAlive = 0;
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
      updateConfetti(dt);
    },
    _event: function (e, g) {
      var T = TEAM_LIN;
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
            flashAt(e.x, e.y, e.z, 1.0 + pw * 0.45, 0.14, 1, 0.9, 0.74);
            shockAt(e.x, e.y, e.z, 1.8 + pw * 0.7, 0.2, tc.r, tc.g, tc.b);
            burstAt(e.x, e.y, e.z, 16 + pw * 10, 4.5 + pw * 1.5, 1, 0.78, 0.45, 0.6, 7);
            burstAt(e.x, e.y, e.z, 8, 3.2, tc.r, tc.g, tc.b, 0.4, 7);
            startTrail(1, 0.94, 0.66, 0.15 + pw * 0.04, 0.75 + pw * 0.3);
            squash.t = 0.12; squash.k = 0.07 + pw * 0.025; heat = 0.6 + pw * 0.4;
          } else if (k === 'serve') {
            var jumpS = e.shot === 'jump' || e.serveType === 'jump', floatS = e.shot === 'float' || e.serveType === 'float';
            var fast = jumpS || (!floatS && (e.speed || 0) > 13);
            spin.rate = floatS ? 0.4 : fast ? 26 : 14; spin.sign = 1; spin.wob = floatS ? 1.8 : 0;
            flashAt(e.x, e.y, e.z, fast ? 0.95 : 0.6, 0.11, 1, 0.94, 0.8);
            burstAt(e.x, e.y, e.z, fast ? 12 : 6, fast ? 3.6 : 2.2, 1, 0.88, 0.66, 0.6, 8);
            if (fast) { shockAt(e.x, e.y, e.z, 1.5, 0.18, 1, 0.9, 0.7); startTrail(1, 0.96, 0.78, 0.12, 0.7); heat = 0.4; }
            else trailA = 0;
            squash.t = 0.12; squash.k = fast ? 0.08 : 0.05;
          } else if (k === 'set') {
            spin.rate = 3; spin.sign = -1; spin.wob = 0;
            flashAt(e.x, e.y, e.z, 0.42, 0.07, 0.85, 0.92, 1);
            burstAt(e.x, e.y, e.z, 3, 1.2, 0.8, 0.9, 1, 0.8, 6);
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
            trailA = 0; squash.t = 0.1; squash.k = 0.06;
          }
          // toque perfecto del humano: anillo dorado y chispas doradas (recompensa visible, sin cegar)
          if (perfect) {
            shockAt(e.x, e.y, e.z, k === 'spike' || k === 'serve' ? 2.3 : 1.6, 0.26, 1, 0.8, 0.28);
            burstAt(e.x, e.y, e.z, k === 'spike' ? 14 : 9, k === 'spike' ? 4.2 : 2.6, 1, 0.78, 0.25, 0.9, 5);
            if (k !== 'set') flashAt(e.x, e.y, e.z, k === 'spike' ? 1.35 : 0.75, 0.1, 1, 0.85, 0.45);
          }
          // orientación del aplastamiento: eje Y local según la dirección de salida
          tv.set(g.ball.vx, g.ball.vz, -g.ball.vy); if (tv.lengthSq() < 1e-6) tv.set(0, 1, 0); tv.normalize();
          squashQ.setFromUnitVectors(UPV, tv);
          break;
        }
        case 'block': {
          var tb = T[e.team === 1 ? 1 : 0], res = e.result || 'stuff';
          if (res === 'stuff') { // bloqueo directo: impacto contundente
            flashAt(e.x, e.y, e.z, 1.25, 0.14, 1, 0.97, 0.92);
            shockAt(e.x, e.y, e.z, 2.4, 0.22, tb.r, tb.g, tb.b);
            burstAt(e.x, e.y, e.z, 22, 4.6, 1, 0.95, 0.85, 0.5, 8);
            burstAt(e.x, e.y, e.z, 10, 3.4, tb.r, tb.g, tb.b, 0.4, 8);
            squash.t = 0.12; squash.k = 0.095; spin.rate = 12;
          } else { // 'soft' (toque de bloqueo jugable) / 'tool' (block-out): roce
            flashAt(e.x, e.y, e.z, 0.6, 0.09, 0.95, 0.97, 1);
            burstAt(e.x, e.y, e.z, res === 'tool' ? 8 : 5, 2.0, 0.95, 0.95, 1, 0.5, 8);
            squash.t = 0.1; squash.k = 0.06; spin.rate = res === 'tool' ? 14 : 6;
          }
          trailA = 0; spin.sign = -1; spin.wob = 0;
          break;
        }
        case 'netTouch': { // un jugador toca la red: chispa fría en la cinta (plano de la red, x = 0)
          var nz = Math.min(C.NET_H, Math.max(1.6, e.z || C.NET_H));
          flashAt(0, e.y, nz, 0.55, 0.1, 0.75, 0.9, 1);
          burstAt(0, e.y, nz, 12, 2.4, 0.7, 0.88, 1, 0.3, 7);
          break;
        }
        case 'dive': { // plancha: polvo de parquet que sale hacia delante + onda en el suelo
          var dx = e.dir ? e.dir[0] : 0, dy = e.dir ? e.dir[1] : 0, px = e.player ? e.player.x : e.x, py = e.player ? e.player.y : e.y;
          dustAt(px + dx * 0.6, py + dy * 0.6, 22, 0.9, dx, dy, 2.4);
          rippleAt(px + dx * 0.6, py + dy * 0.6, 1.3, 0.45, 0.95, 0.88, 0.75, 0.3);
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
          burstAt(e.x, e.y, 0.05, 10 + Math.min(14, sp2), 1.5 + sp2 * 0.15, 0.95, 0.9, 0.8, 1.2, 9);
          trailA = Math.min(trailA, 0.25);
          if (sp2 > 8) shockAt(e.x, e.y, 0.15, 1.6, 0.25, 1, 0.9, 0.8);
          break;
        }
        case 'bounce':
          if ((e.speed || 0) > 2.5) rippleAt(e.x, e.y, 0.9, 0.45, 1, 1, 1, 0.4);
          break;
        case 'landPlayer':
          if (e.player) { rippleAt(e.player.x, e.player.y, 1.0, 0.4, 0.9, 0.9, 0.95, 0.3); dustAt(e.player.x, e.player.y, 5, 0.7, 0, 0, 0); }
          break;
        case 'set':
          confetti(e.team === 1 ? 1 : 0, 160);
          break;
        case 'match':
          confetti(e.team === 1 ? 1 : 0, CONF_N);
          break;
      }
    }
  };
})();
