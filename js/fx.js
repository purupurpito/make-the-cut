/* =====================================================================
 * VOLEY 3D — js/fx.js   (owner: arena)
 * Balón (esfera-cubo con 6 grupos de 3 paneles, como un balón real, con
 * efecto según el toque: liftado en el remate, casi sin giro en el saque
 * flotante), sombra de contacto, aro de caída que se cierra según el
 * tiempo que falta, línea de altura, estela tipo cinta en remates/saques
 * potentes, destellos, ondas de choque, chispas aditivas, marcas en el
 * suelo (blanca dentro / roja fuera), polvo al aterrizar y confeti.
 * Coordenadas de sim -> three con VB.toThree. Sin asignaciones por frame.
 * ===================================================================== */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  var THREE, ctx, C, Sim, root;
  var ballPivot, ball, ballMat, ballShadow, dropLine, marker, markerMat, focusRing;
  var spinQ, squashQ, tmpQ, tv, tv2, tv3, axis, UPV;
  var spin = { rate: 0, sign: 1, wob: 0 }, squash = { t: 0, k: 0 }, heat = 0;
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
  /** Atenúa destellos muy cerca de la cámara (golpes del propio jugador): que no tapen la jugada. */
  function nearFade(p) { var d = ctx.camera.position.distanceTo(p); return Math.max(0.12, Math.min(1, (d - 2) / 6)); }
  function flashAt(x, y, z, size, dur, r, g, b) {
    var f = flashPool[flashHead]; flashHead = (flashHead + 1) % FLASH_N;
    VB.toThree(x, y, z, f.s.position); f.t = dur; f.d = dur; f.size = size; f.s.material.color.setRGB(r, g, b); f.s.visible = true;
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
  function markAt(x, y, inside, speed) {
    var m = markPool[markHead]; markHead = (markHead + 1) % MARK_N;
    m.m.position.x = x; m.m.position.z = -y; m.t = 2.8; m.d = 2.8;
    var s = 0.42 + Math.min(0.25, speed * 0.02); m.m.scale.set(s, s, s);
    if (inside) m.m.material.color.setRGB(1, 0.97, 0.9); else m.m.material.color.setRGB(1, 0.18, 0.12);
    m.m.visible = true;
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
      ball = new THREE.Mesh(ballGeometry(C.BR), ballMat); ball.castShadow = true; ballPivot.add(ball);

      // sombra de contacto (siempre en vertical bajo el balón: legibilidad)
      ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: radialTex([[0, 'rgba(0,0,0,0.85)'], [0.45, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
      ballShadow.rotation.x = -Math.PI / 2; ballShadow.position.y = 0.012; ballShadow.renderOrder = 2; root.add(ballShadow);

      // línea vertical tenue balón -> suelo (lectura de altura)
      var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      dropLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
      dropLine.frustumCulled = false; root.add(dropLine);

      // marcador de caída: retícula que se cierra según el tiempo que falta
      var mcv = canvas(256, 256), g = mcv.getContext('2d');
      g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 100, 0, 6.283); g.stroke();
      g.lineWidth = 4; g.globalAlpha = 0.6; g.beginPath(); g.arc(128, 128, 74, 0, 6.283); g.stroke(); g.globalAlpha = 1;
      g.lineWidth = 10; for (var k = 0; k < 4; k++) { var a = k * Math.PI / 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.lineTo(128 + Math.cos(a) * 126, 128 + Math.sin(a) * 126); g.stroke(); }
      var cg = g.createRadialGradient(128, 128, 0, 128, 128, 30); cg.addColorStop(0, 'rgba(255,255,255,0.95)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg; g.fillRect(98, 98, 60, 60);
      markerMat = new THREE.MeshBasicMaterial({ map: tex(mcv), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 });
      marker = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), markerMat);
      marker.rotation.x = -Math.PI / 2; marker.position.y = 0.016; marker.renderOrder = 3; root.add(marker);

      // aro del punto donde jugará el balón tu equipo (1 m / 3 m)
      focusRing = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: ringTex(0.8, 0.86, 0.05), transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }));
      focusRing.rotation.x = -Math.PI / 2; focusRing.position.y = 0.014; focusRing.renderOrder = 2; root.add(focusRing);

      // estela tipo cinta (aditiva, orientada a cámara)
      tPts = new Float32Array(TN * 3); tPos = new Float32Array(TN * 6); tCols = new Float32Array(TN * 6);
      var tg = new THREE.BufferGeometry(), idx = [];
      for (var i = 0; i < TN - 1; i++) { var a0 = i * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
      tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(tCols, 3)); tg.setIndex(idx);
      trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      trail.frustumCulled = false; trail.visible = false; trail.renderOrder = 6; root.add(trail);

      // chispas
      var sPos = new Float32Array(SPARK_N * 3), sCol = new Float32Array(SPARK_N * 3);
      for (var j = 0; j < SPARK_N; j++) { sp.push({ x: 0, y: 0, z: -50, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1, grav: 9 }); sPos[j * 3 + 1] = -50; }
      var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
      sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.13, map: radialTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64),
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sparks.frustumCulled = false; sparks.renderOrder = 7; root.add(sparks);

      // destellos y ondas de choque (sprites aditivos)
      var flashTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,240,210,0.85)'], [0.5, 'rgba(255,200,140,0.18)'], [1, 'rgba(255,180,120,0)']]);
      for (var f = 0; f < FLASH_N; f++) {
        var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        s.visible = false; s.renderOrder = 8; root.add(s); flashPool.push({ s: s, t: 0, d: 1, size: 1, near: 1 });
      }
      var shockTex = ringTex(0.78, 0.86, 0.1);
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
      var markTex = radialTex([[0, 'rgba(255,255,255,0.9)'], [0.55, 'rgba(255,255,255,0.55)'], [0.8, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
      for (var mI = 0; mI < MARK_N; mI++) {
        var mm = new THREE.Mesh(ripGeo, new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false, opacity: 0.6 }));
        mm.rotation.x = -Math.PI / 2; mm.position.y = 0.015; mm.visible = false; mm.renderOrder = 2; root.add(mm); markPool.push({ m: mm, t: 0, d: 1 });
      }
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
      for (var f = 0; f < FLASH_N; f++) { flashPool[f].t = 0; flashPool[f].s.visible = false; }
      for (var w = 0; w < WAVE_N; w++) { wavePool[w].t = 0; wavePool[w].s.visible = false; }
      for (var r = 0; r < RIP_N; r++) { ripPool[r].t = 0; ripPool[r].m.visible = false; }
      for (var m = 0; m < MARK_N; m++) { markPool[m].t = 0; markPool[m].m.visible = false; }
      confAlive = 0; conf.count = 0; conf.visible = false;
    },
    /** Partículas en coordenadas de simulación (interfaz del contrato). */
    burst: function (x, y, z, n, power) { burstAt(x, y, z, n, power, 1, 0.92, 0.7, 1, 9); },
    /** Confeti del color de un equipo (opcional). */
    confetti: function (team, n) { confetti(team === 1 ? 1 : 0, n || 400); },
    /** Malla del balón (opcional, para otros módulos). */
    ballObject: function () { return ballPivot; },
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
      var sq = squash.t > 0 ? Math.sin((1 - squash.t / 0.12) * Math.PI) * squash.k : 0;
      ballPivot.quaternion.copy(squashQ); ballPivot.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
      // la malla compensa la orientación del pivote para mantener el giro en mundo
      ball.quaternion.copy(squashQ).invert().multiply(spinQ);
      ballMat.emissiveIntensity = heat * 0.9;

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
      // ---- marcador de caída ----
      marker.visible = inPlay && b.vz < 6 && b.z > 0.5;
      if (marker.visible) {
        Sim.predictLanding(g, land);
        marker.position.x = land.x; marker.position.z = -land.y;
        var tt = Math.min(1, Math.max(0, land.t) / 1.3), sc = 0.55 + tt * 0.75 + Math.sin(ctx.time * 9) * 0.03;
        marker.scale.set(sc, sc, sc); marker.rotation.z = ctx.time * 0.8;
        var mine = land.x > 0;
        if (g.demo) markerMat.color.setRGB(0.9, 0.95, 1);
        else if (mine) markerMat.color.setRGB(1, 0.86, 0.42);
        else markerMat.color.setRGB(0.55, 0.8, 1);
        var out = Math.abs(land.x) > C.HL + C.BR || Math.abs(land.y) > C.HW + C.BR;
        markerMat.opacity = (mine && !g.demo ? 0.95 : 0.55) * (out ? 0.55 : 1);
      }
      var showFocus = inPlay && !g.demo && g.jobs && g.jobs[0] && Sim.focusPoint;
      focusRing.visible = !!showFocus;
      if (showFocus) {
        var fp = Sim.focusPoint(g);
        if (fp) { focusRing.position.x = fp.x; focusRing.position.z = -fp.y; var fs = 1 + Math.sin(ctx.time * 6) * 0.05; focusRing.scale.set(fs, fs, fs); }
        else focusRing.visible = false;
      }

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
      // ---- destellos / ondas / marcas ----
      for (var f = 0; f < FLASH_N; f++) {
        var F = flashPool[f]; if (!F.s.visible) continue;
        if (dt > 0) F.t -= dt;
        if (F.t <= 0) { F.s.visible = false; continue; }
        var u = F.t / F.d, fsz = F.size * (0.55 + (1 - u) * 0.7) * (0.5 + 0.5 * F.near); F.s.scale.set(fsz, fsz, 1); F.s.material.opacity = u * F.near;
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
        if (Mk.t <= 0) { Mk.m.visible = false; continue; }
        Mk.m.material.opacity = 0.65 * Math.min(1, Mk.t / 0.8);
      }
      updateConfetti(dt);
    },
    _event: function (e, g) {
      var T = TEAM_LIN;
      switch (e.type) {
        case 'hit': {
          var tc = T[e.team === 1 ? 1 : 0], qv = e.quality == null ? 0.8 : e.quality;
          var k = e.kind;
          if (k === 'spike') {
            spin.rate = 32 + qv * 14; spin.sign = 1; spin.wob = 0;
            flashAt(e.x, e.y, e.z, 1.8 + qv * 0.8, 0.16, 1, 0.92, 0.8);
            shockAt(e.x, e.y, e.z, 2.6 + qv, 0.32, tc.r, tc.g, tc.b);
            burstAt(e.x, e.y, e.z, 26, 5.5, 1, 0.82, 0.5, 0.6, 7);
            burstAt(e.x, e.y, e.z, 10, 3.5, tc.r, tc.g, tc.b, 0.4, 7);
            startTrail(1, 0.62, 0.32, 0.17, 1);
            squash.t = 0.12; squash.k = 0.32; heat = 1;
          } else if (k === 'serve') {
            var fast = (e.speed || 0) > 13 || e.serveType === 'jump' || e.style === 'jump';
            var floatS = e.serveType === 'float' || e.style === 'float' || e.float === true;
            spin.rate = floatS ? 0.4 : fast ? 26 : 14; spin.sign = 1; spin.wob = floatS ? 1.8 : 0;
            flashAt(e.x, e.y, e.z, fast ? 1.5 : 1.0, 0.12, 1, 0.95, 0.85);
            burstAt(e.x, e.y, e.z, fast ? 16 : 8, fast ? 4 : 2.6, 1, 0.9, 0.7, 0.6, 8);
            if (fast) { shockAt(e.x, e.y, e.z, 2, 0.26, 1, 0.9, 0.7); startTrail(1, 0.86, 0.6, 0.12, 0.8); heat = 0.4; }
            else trailA = 0;
            squash.t = 0.12; squash.k = fast ? 0.25 : 0.15;
          } else if (k === 'set') {
            spin.rate = 3; spin.sign = -1; spin.wob = 0;
            flashAt(e.x, e.y, e.z, 0.7, 0.08, 0.85, 0.92, 1);
            burstAt(e.x, e.y, e.z, 4, 1.4, 0.8, 0.9, 1, 0.8, 6);
            trailA = 0; squash.t = 0.1; squash.k = 0.08;
          } else { // pass / free
            spin.rate = 6 + Math.random() * 6; spin.sign = -1; spin.wob = 0;
            flashAt(e.x, e.y, e.z, 0.9, 0.09, 0.9, 0.95, 1);
            burstAt(e.x, e.y, e.z, 6, 1.8, 0.85, 0.92, 1, 0.8, 7);
            trailA = 0; squash.t = 0.1; squash.k = 0.14;
          }
          // orientación del aplastamiento: eje Y local según la dirección de salida
          tv.set(g.ball.vx, g.ball.vz, -g.ball.vy); if (tv.lengthSq() < 1e-6) tv.set(0, 1, 0); tv.normalize();
          squashQ.setFromUnitVectors(UPV, tv);
          break;
        }
        case 'block': {
          var tb = T[e.team === 1 ? 1 : 0];
          flashAt(e.x, e.y, e.z, 1.7, 0.14, 1, 1, 1);
          shockAt(e.x, e.y, e.z, 2.4, 0.3, tb.r, tb.g, tb.b);
          burstAt(e.x, e.y, e.z, 20, 4, 1, 0.95, 0.85, 0.5, 8);
          trailA = 0; squash.t = 0.12; squash.k = 0.3; spin.rate = 10; spin.sign = -1;
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
          markAt(e.x, e.y, e.inside, sp2);
          burstAt(e.x, e.y, 0.05, 10 + Math.min(14, sp2), 1.5 + sp2 * 0.15, 0.95, 0.9, 0.8, 1.2, 9);
          trailA = Math.min(trailA, 0.25);
          if (sp2 > 8) shockAt(e.x, e.y, 0.15, 1.6, 0.25, 1, 0.9, 0.8);
          break;
        }
        case 'bounce':
          if ((e.speed || 0) > 2.5) rippleAt(e.x, e.y, 0.9, 0.45, 1, 1, 1, 0.4);
          break;
        case 'landPlayer':
          if (e.player) rippleAt(e.player.x, e.player.y, 1.0, 0.4, 0.9, 0.9, 0.95, 0.35);
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
