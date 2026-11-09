#!/usr/bin/env node
/* VOLEY 3D — tools/camtest.js  (owner: camera_input)
 * Regresión AUTOMÁTICA de la cámara: partidos en vivo con autopilot (debug=rally&live=1) en varios tamaños y semillas,
 * con un registro por frame tomado justo después de VB.CameraRig.update (posición, giro, cabeceo, FOV, plano, cortes,
 * proyección de balón y jugadores). Comprueba:
 *   - BOUNDS   la cámara dentro del pabellón: |x| <= 15,2, |y| <= 10,4, z <= 19 en todos los frames
 *   - CUTS     todo salto > 2 m entre frames es un corte deliberado (getDebug().cutN sube en ese frame)
 *   - SERVECUT a <= 3 frames de cada corte punto -> saque, la cámara a < 0,5 m de su posición asentada
 *   - SETTLE   saque rival: asentada >= 0,4 s antes del lanzamiento (velocidad < 0,3 m/s, |dFOV/dt| < 1°/s)
 *   - MONO     en las transiciones deslizadas hacia el saque rival, FOV y cabeceo monótonos (sin vuelta > 1,5°)
 *   - REVERSE  cabeceo en el saque rival sin vaivenes (inversiones > 0,6° por minuto = 0)
 *   - HERO     plano de reacción (kill/ace/block): >= 0,5 s tras el corte el que anotó >= 30 % del alto, la figura
 *              más grande, cámara a <= 70° de su frente y el perdedor <= 60 % de su altura (>= 90 % de los puntos)
 *   - SCORER   el héroe del plano es el que anotó (sacador en el ace; si no, el último del equipo que gana que tocó)
 *   - BBOX     ningún frame de transición con un jugador ocupando > 35 % de la pantalla
 *   - NEXTCUT  getDebug().nextCutIn >= 0,15 s el frame 0,15 s antes de cada corte de vuelta al saque y 0 en el corte
 *   - BALL     % de frames de juego (rally/attack/defend) con el balón fuera de cuadro (por plano; aviso > 3 %)
 *   - FOVRATE  ritmo de FOV en táctil (informativo)
 *   (ola 2)
 *   - FOLLOW   CAM-08: bote dentro tras un remate propio del jugador controlado en el 60 % central y sin corte desde el contacto (>= 90 %)
 *   - FOVPUMP  CAM-11 (táctil): ritmo de FOV en rally/attack p50 <= 2°/s, p95 <= 12°/s; balón fuera 0; balón tras el HUD 0
 *   - WIDE     CAM-12 (aspecto > 2): balón fuera 0, cerca del borde <= 2 %, cadera del jugador en cuadro 100 %
 *   - SPIKER   CAM-13: rematador rival >= 18 % del alto (táctil 16 %) en el contacto (>= 90 %); en defensa jugador en pantalla, FOV p95 <= 12°/s
 *   - CUTAWAY  CAM-14: con cutaway, el sacador rival >= 40 % del alto >= 0,8 s y la vuelta >= 0,5 s antes del lanzamiento
 *   - CUTCOUNT admite los cortes nuevos: clinch (x2, cierre de set/partido) y cutaway + serve
 *   (ola 3, CAM-20: toda la dirección de cámara protegida)
 *   - SERVE    CAM-15: saque propio asentado: sacador (hombros) en x 0,08..0,60 NDC (pantalla baja/táctil: -0,02..0,60) (con el salto en el aire, solo los oficiales) con cabeza y hombros en cuadro, línea de fondo
 *              lejana >= 0,5 NDC (salvo con el lanzamiento en salto en el aire), ningún oficial cortado por un borde; balón >= 3,5 m de la lente
 *   - BOARD    CAM-19: en los planos point/court/clinch/over el marcador colgado entero o fuera (por arriba, >= 2° sobre el borde)
 *   - CLUTTER  CAM-18: tras el corte de reacción, el balón nunca > 4 % del alto a < 15 % de un borde o bajo la cinta; cabezas de los
 *              protagonistas nunca bajo VB.UI.bannerRect()
 *   - BLOCK    CAM-17: de -0,6 s a +0,5 s de cada bloqueo, giro combinado <= 40°/s (sin cortes) y el balón en cuadro en el bloqueo
 *   - MENU     CAM-16 (partida aparte por tamaño, 60 s de menú): >= 5 tipos de plano, ningún corte a ±0,3 s de un golpe ni plano
 *              < 6 s, giro <= 25°/s dentro de los planos, balón y jugadores activos en NDC x > -0,3 en >= 90 % de los frames
 *   - INTRO    CAM-16 playIntro: la presentación acaba a < 0,1 m del encuadre del saque, sin corte
 *   - CLINCH   CAM-09 (partida aparte, debug=setpoint): cierre de set con seguimiento y órbita del héroe >= 1,8 s antes de la grúa
 *   - FEEL     CAM-04: hit-stop de 60 ms = 60 ms ±1 frame con timeScale 0 y vuelta en ~80 ms; punch de FOV < 10 % a los 200 ms
 * camBreak (pruebas de la prueba): CAMBREAK=clinch|serve|board|menu|block|clutter|hitstop|intro|cut añade &camBreak=… y camera.js
 * rompe A PROPÓSITO esa regla; `node tools/camtest.js selftest` comprueba que cada una hace fallar a su comprobación (sale 1 si alguna no).
 * Uso: node tools/camtest.js [segundos=75] [semillas=7,12345,3] [tamaños=1280x720,1680x720,1024x768,844x390t]
 *   SPEED=2 (reloj de rAF ×N: la partida va N veces más rápida a ~160 fps reales, dt de cámara 1/80 s)
 *   PAR=4 (navegadores a la vez) · STRICT=1 (sale con 1 si algo falla; por defecto también) · QUIET=1
 *   STRICT2=1 (también cuentan fovpumpX —CAM-11 p50/HUD— y spikerAll —CAM-13 agregado—, informativas por defecto)
 *   ONLY=bounds,cuts,... (solo esas comprobaciones) · LOG=1 (vuelca el registro de cada partida en tools/out/camtest/)
 *   DIFF=expert (nivel de la CPU: más puntos suyos = más saques rivales para SETTLE/MONO)
 *   PAGE_ROOT=carpeta (prueba otra copia del proyecto, p. ej. con un parche pedido a otro owner)
 * Escribe SOLO en tools/out/camtest/. Duración por defecto (12 partidas de 75 s a ×2, 4 a la vez): ~4-5 min.
 */
'use strict';
const path = require('path'), fs = require('fs');
const CDP = require(path.join(__dirname, 'cdp.js'));
const SELFTEST = process.argv[2] === 'selftest';
const SECS = SELFTEST ? 0 : +(process.argv[2] || 75);
const SEEDS = (process.argv[3] || '7,12345,3').split(',').map(Number);
const SIZES = (process.argv[4] || '1280x720,1680x720,1024x768,844x390t').split(',');
const SPEED = +(process.env.SPEED || 2), PAR = +(process.env.PAR || 4);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const OUT = path.join(__dirname, 'out', 'camtest');
process.setMaxListeners(64);   // (cdp.js añade un 'exit' por navegador)
fs.mkdirSync(OUT, { recursive: true });
const on = k => !ONLY || ONLY.includes(k);
const wantJob = k => !ONLY || (k === 'menu' ? on('menu') || on('intro') : k === 'setend' ? on('clinch') : k === 'feel' ? on('feel') : false);
// Comprobaciones con aceptación aún parcial (CAM-11 p50/HUD, CAM-13 agregado): informativas salvo con STRICT2=1. Así la puerta por defecto
// sale con 0 cuando pasa todo lo cerrado (CAM-01…10/12/14) y sigue cazando regresiones; con STRICT2=1 cuentan como fallo.
const SOFT = { fovpumpX: 1, spikerAll: 1 }, STRICT2 = process.env.STRICT2 === '1';
const CAMBREAK = process.env.CAMBREAK ? '&camBreak=' + process.env.CAMBREAK : '';
const EXTRA_JOBS = (process.env.EXTRA_JOBS || 'menu,setend,feel').split(',').filter(Boolean);
const soft = k => !STRICT2 && !!SOFT[k];

// Registro en la página: se envuelve CameraRig.update (main.js la busca en cada frame) y se anota el estado de cámara
// ya aplicado en ESE frame. El reloj de rAF se multiplica por SPEED (todo el juego va más rápido sin perder frames).
const INIT = (speed) => `
(function(){
  if (window.__camtestInit) return; window.__camtestInit = true;
  var SPEED = ${speed};
  if (SPEED !== 1) { var _raf = window.requestAnimationFrame.bind(window), t0 = -1;
    window.requestAnimationFrame = function (cb) { return _raf(function (t) { if (t0 < 0) t0 = t; cb(t0 + (t - t0) * SPEED); }); }; }
  window.__R = []; window.__E = [];
  var v = null, w = null, hooked = false;
  function ndc(x, y, z) { w.set(x, z, -y); w.project(VB.ctx.camera); return w; }
  function hook() {
    if (hooked || !window.VB || !VB.CameraRig || !VB.CameraRig.update || !VB.ctx || !VB.ctx.camera) return;
    hooked = true;
    var up = VB.CameraRig.update;
    v = new VB.ctx.THREE.Vector3(); w = new VB.ctx.THREE.Vector3();
    VB.CameraRig.update = function (g, realDt, events) {
      var r = up.apply(this, arguments);
      try {
        var c = VB.ctx.camera, d = VB.CameraRig.getDebug ? VB.CameraRig.getDebug() : {};
        c.getWorldDirection(v);
        var ev = '';
        for (var i = 0; i < events.length; i++) {
          var e = events[i];
          if (e.type === 'point') { ev += 'P'; window.__E.push({ f: window.__R.length, type: 'point', how: e.how, team: e.team, reason: e.reason, setWon: e.setWon, matchWon: e.matchWon,
            lp: g.lastPlayer && g.lastPlayer.num, srv: g.server && g.server.num }); }
          else if (e.type === 'toss') { ev += 'T'; window.__E.push({ f: window.__R.length, type: 'toss', team: e.team }); }
          else if (e.type === 'serveReady') { ev += 'S'; window.__E.push({ f: window.__R.length, type: 'serveReady', team: e.team, num: e.player && e.player.num }); }
          else if (e.type === 'courtChange') { ev += 'C'; }
          else if ((e.type === 'hit' || e.type === 'block') && e.player) { window.__E.push({ f: window.__R.length, type: 'touch', team: e.team, num: e.player.num, human: !!e.human, blk: e.type === 'block' ? 1 : 0 }); }
        }
        // balón en cuadro
        var b = g.ball, bn0 = ndc(b.x, b.y, b.z), bn = { x: bn0.x, y: bn0.y, z: bn0.z }, bin = bn.z < 1 && Math.abs(bn.x) <= 1 && Math.abs(bn.y) <= 1 ? 1 : 0;
        // jugadores: alto en pantalla (fracción), centro, caja (fracción del área), ángulo cámara-frente
        var pl = [], maxBox = 0;
        for (var k = 0; k < 4; k++) {
          var p = g.players[k], rig = VB.Players && VB.Players.rigOf ? VB.Players.rigOf(p) : null, sc = rig && rig.scale ? rig.scale : 1;
          // posición VISUAL (sim + desfase del rig: convergencia del choque de manos, plancha)
          var vx0 = p.x + (rig && rig.offX ? rig.offX : 0), vy0 = p.y + (rig && rig.offY ? rig.offY : 0);
          var f = ndc(vx0, vy0, p.z), fz = f.z, fy = f.y, fx = f.x;
          var h = ndc(vx0, vy0, p.z + 1.9 * sc), hy = h.y, hx = h.x, hz = h.z;
          var hgt = (fz < 1 && hz < 1) ? (hy - fy) / 2 : 0;
          var cx = (fx + hx) / 2, inF = fz < 1 && hz < 1 && Math.abs(cx) < 1 && hy > -1 && fy < 1 ? 1 : 0;
          var halfW = Math.abs(hgt) * 0.25 * (VB.ctx.height / Math.max(1, VB.ctx.width)) * 2;   // ancho ≈ 0,25 del alto
          var box = 0;
          if (hgt > 0) {
            var x0 = Math.max(-1, cx - halfW), x1 = Math.min(1, cx + halfW), y0 = Math.max(-1, fy), y1 = Math.min(1, hy);
            if (x1 > x0 && y1 > y0) box = (x1 - x0) * (y1 - y0) / 4;
          }
          if (box > maxBox) maxBox = box;
          var face = rig && typeof rig.yaw === 'number' ? rig.yaw : NaN;
          var cam = Math.atan2((-c.position.z) - vy0, c.position.x - vx0);
          var dA = face === face ? Math.abs(Math.atan2(Math.sin(cam - face), Math.cos(cam - face))) * 180 / Math.PI : -1;
          pl.push([p.num, +hgt.toFixed(3), inF, +dA.toFixed(0), p.team, +p.x.toFixed(2), +p.y.toFixed(2), +hy.toFixed(3)]);
        }
        // (ola 2) remates rivales: alto del rematador en el contacto (CAM-13); botes: dónde cae en pantalla (CAM-08)
        for (var i2 = 0; i2 < events.length; i2++) {
          var e2 = events[i2];
          if (e2.type === 'hit' && e2.kind === 'spike' && e2.team === 1 && e2.player) {
            var sp = pl.filter(function (q) { return q[0] === e2.player.num && q[4] === 1; })[0];
            window.__E.push({ f: window.__R.length, type: 'rspike', h: sp ? sp[1] : 0, inF: sp ? sp[2] : 0, num: e2.player.num });
          } else if (e2.type === 'hit' && e2.kind === 'spike' && e2.team === 0) {
            window.__E.push({ f: window.__R.length, type: 'ospike', ctrl: e2.player === g.ctrl ? 1 : 0, human: e2.human ? 1 : 0 });
          } else if (e2.type === 'land') {
            var ln = ndc(e2.x, e2.y, 0.11), lin = ln.z < 1 ? 1 : 0;
            window.__E.push({ f: window.__R.length, type: 'land', nx: +ln.x.toFixed(3), ny: +ln.y.toFixed(3), front: lin, inside: !!e2.inside, lk: g.lastKind, lt: g.lastTeam,
              ft: d.ft ? d.ft.on : -1 });
          }
        }
        // balón tras el HUD (marcador, franja de toques, aviso, botones táctiles): rects cacheados cada 15 frames
        var hudHit = 0, bpx = (bn.x + 1) / 2 * VB.ctx.width, bpy = (1 - bn.y) / 2 * VB.ctx.height;
        if (!window.__hudR || (window.__R.length % 15) === 0) {
          var rs = [], sel = ['#sb', '#touchbar:not(.off)', '#prompt:not(.off)', '#touch.on .vt-btn'];
          for (var s = 0; s < sel.length; s++) { var els = document.querySelectorAll(sel[s]);
            for (var q = 0; q < els.length; q++) { var el = els[q]; if (!el.offsetWidth || getComputedStyle(el).visibility === 'hidden' || +getComputedStyle(el).opacity < 0.05) continue;
              var rr = el.getBoundingClientRect(); rs.push([rr.left, rr.top, rr.right, rr.bottom, sel[s].charAt(1)]); } }
          window.__hudR = rs;
        }
        if (bin) for (var hq = 0; hq < window.__hudR.length; hq++) { var H = window.__hudR[hq]; if (bpx >= H[0] && bpx <= H[2] && bpy >= H[1] && bpy <= H[3]) { hudHit = H[4]; break; } }
        // jugador controlado: cadera en cuadro (CAM-12/13)
        var cp = g.ctrl, chip0 = cp ? ndc(cp.x, cp.y, cp.z + 0.95) : null, chip = chip0 ? { x: chip0.x, y: chip0.y, z: chip0.z } : null, chIn = chip && chip.z < 1 && Math.abs(chip.x) <= 1 && Math.abs(chip.y) <= 1 ? 1 : 0;
        var chd = cp ? ndc(cp.x, cp.y, cp.z + 1.75) : null, chdIn = chd && chd.z < 1 && Math.abs(chd.x) <= 1 && Math.abs(chd.y) <= 1 ? 1 : 0;
        // (ola 3) composición del saque propio, marcador colgado, balón/cinta del plano de reacción, plano del menú
        var shN = VB.CameraRig.getShot ? VB.CameraRig.getShot() : '', xs = null, brd = -1, pc = null;
        var W = VB.ctx.width, H = VB.ctx.height;
        if (shN === 'serveUs' && g.server && g.server.team === 0) {
          var sv = g.server, rq = VB.Players && VB.Players.rigOf ? VB.Players.rigOf(sv) : null, sq = rq && rq.scale || 1, yawC = Math.atan2(-v.z, v.x), rxs = Math.sin(yawC), rys = -Math.cos(yawC);
          var sL = ndc(sv.x - rxs * 0.24, sv.y - rys * 0.24, sv.z + 1.45 * sq), sLx = sL.x, sLy = sL.y, sLz = sL.z;
          var sR = ndc(sv.x + rxs * 0.24, sv.y + rys * 0.24, sv.z + 1.45 * sq), sRx = sR.x, sRy = sR.y, sRz = sR.z;
          var sH = ndc(sv.x, sv.y, sv.z + 1.92 * sq), sHx = sH.x, sHy = sH.y, sHz = sH.z;
          var inA = function (x, y, z) { return z < 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1; };
          var farY = ndc(-9, 0, 0).y, bDst = Math.hypot(b.x - c.position.x, b.y + c.position.z, b.z - c.position.y);
          // oficiales (VB.Arena._dbg: árbitros, anotadores, jueces de línea): caja recortada por un borde = cortado
          var offC = 0, A0 = window.__offs || (window.__offs = (VB.Arena && VB.Arena._dbg ? (VB.Arena._dbg().refs || []).concat(VB.Arena._dbg().judges || []) : []));
          for (var oi = 0; oi < A0.length; oi++) { var so = A0[oi].sim; if (!so) continue; var r1 = so.z > 0.5, z0 = r1 ? 0 : so.z, z1 = so.z + (r1 ? 1.85 : Math.abs(so.y) > 8 ? 1.35 : A0[oi].lines ? 2.25 : 1.85), ro = r1 ? 0.55 : 0.4;
            var X0 = 9, X1 = -9, Y0 = 9, Y1 = -9, beh = false;
            for (var ok8 = 0; ok8 < 8; ok8++) { var pp = ndc(so.x + Math.cos(ok8 * 0.785) * ro, so.y + Math.sin(ok8 * 0.785) * ro, (ok8 & 1) ? z1 : z0); if (pp.z >= 1) { beh = true; break; } X0 = Math.min(X0, pp.x); X1 = Math.max(X1, pp.x); Y0 = Math.min(Y0, pp.y); Y1 = Math.max(Y1, pp.y);
              pp = ndc(so.x + Math.cos(ok8 * 0.785) * ro, so.y + Math.sin(ok8 * 0.785) * ro, (ok8 & 1) ? z0 : z1); if (pp.z >= 1) { beh = true; break; } X0 = Math.min(X0, pp.x); X1 = Math.max(X1, pp.x); Y0 = Math.min(Y0, pp.y); Y1 = Math.max(Y1, pp.y); }
            if (beh) continue; var outO = X1 < -1 || X0 > 1 || Y1 < -1 || Y0 > 1, inO = X0 >= -1 && X1 <= 1 && Y0 >= -1 && Y1 <= 1; if (!outO && !inO) { offC++; window.__offI = oi + ':' + so.x.toFixed(1) + ',' + so.y.toFixed(1) + ' x' + X0.toFixed(2) + '..' + X1.toFixed(2) + ' y' + Y0.toFixed(2) + '..' + Y1.toFixed(2); } }
          xs = [+((sLx + sRx) / 2).toFixed(3), inA(sLx, sLy, sLz) && inA(sRx, sRy, sRz) && inA(sHx, sHy, sHz) ? 1 : 0, +farY.toFixed(3), +bDst.toFixed(2), offC, g.serveJump && g.serveState === 'toss' && !b.held ? 1 : 0, offC ? window.__offI : ''];
        }
        if (shN === 'point' || shN === 'court' || shN === 'clinch' || shN === 'over') {
          var LMh = VB.Arena && VB.Arena.landmarks && VB.Arena.landmarks.scoreHung, hx0 = LMh ? LMh.x : 0, hy0 = LMh ? LMh.y : 0;
          var bx0 = 9, bx1 = -9, by0 = 9, by1 = -9, bfr = 0, bbh = 0;
          for (var kb = 0; kb < 8; kb++) { var pb = ndc(hx0 + ((kb & 1) ? 2.25 : -2.25), hy0 + ((kb & 2) ? 2.25 : -2.25), (kb & 4) ? 12.7 : 9.5); if (pb.z >= 1) { bbh++; continue; } bfr++; bx0 = Math.min(bx0, pb.x); bx1 = Math.max(bx1, pb.x); by0 = Math.min(by0, pb.y); by1 = Math.max(by1, pb.y); }
          var thb = Math.tan(c.fov * Math.PI / 360), m2 = Math.tan(Math.atan(thb) + 2 * Math.PI / 180) / thb;
          var bIn = !bbh && bx0 >= -1 && bx1 <= 1 && by0 >= -1 && by1 <= 1, bOut = bfr === 0 || bx1 < -1 || bx0 > 1 || by1 < -1 || (by0 > 1 && (by0 >= m2 * 0.985 || bx1 < -1 || bx0 > 1));
          brd = bIn || bOut ? 0 : 1;
        }
        if (shN === 'point') {
          var dist = Math.hypot(b.x - c.position.x, b.y + c.position.z, b.z - c.position.y), dia = 2 * VB.C.BR / dist / (2 * Math.tan(c.fov * Math.PI / 360));
          var brr = VB.UI && VB.UI.bannerRect ? VB.UI.bannerRect() : null, hh = 0, pfp = d.pf;
          if (brr && pfp) for (var kh = 0; kh < 4; kh++) { var ph = g.players[kh]; if (!(ph.num === pfp.hero && ph.team === pfp.team) && !(ph.num === pfp.vic && ph.team !== pfp.team) && !(pfp.both && ph.team === pfp.team)) continue;
            var rh = VB.Players.rigOf(ph), shh = rh && rh.scale || 1, hn = ndc(ph.x + (rh && rh.offX || 0), ph.y + (rh && rh.offY || 0), (ph.z || 0) + 1.82 * shh); if (hn.z >= 1) continue;
            var hpx = (hn.x + 1) / 2 * W, hpy = (1 - hn.y) / 2 * H; if (hpx >= brr.left && hpx <= brr.right && hpy >= brr.top && hpy <= brr.bottom) hh++; }
          pc = [+dia.toFixed(4), Math.round(bpx), Math.round(bpy), brr ? [Math.round(brr.left), Math.round(brr.top), Math.round(brr.right), Math.round(brr.bottom)] : 0, hh];
        }
        window.__R.push({ xs: xs, brd: brd, pc: pc, blk: typeof d.blk === 'number' ? +d.blk.toFixed(2) : 0, mt: d.menu || '', W: W, H: H, t: +VB.ctx.time.toFixed(4), dt: +(realDt || 0).toFixed(4), shot: VB.CameraRig.getShot ? VB.CameraRig.getShot() : '',
          bx: +bn.x.toFixed(3), by: +bn.y.toFixed(3), hud: hudHit, chIn: chIn, chdIn: chdIn, chx: chip ? +chip.x.toFixed(2) : 9, chy: chip ? +chip.y.toFixed(2) : 9, chz: chip ? +chip.z.toFixed(3) : 9, sw: d.sx != null && g.ctrl ? +(d.sx - g.ctrl.x).toFixed(2) : 0, tt: g.touchTeam, tc: g.touches,
          dx: d.x ? d.x.map(function (v) { return +v.toFixed(2); }) : null, fw: typeof d.fovWant === 'number' ? +d.fovWant.toFixed(2) : -1, fbo: typeof d.fovBoost === 'number' ? +d.fovBoost.toFixed(2) : -1, ft: d.ft ? d.ft.on : -1, cl: d.clinch ? d.clinch.phase : '',
          x: +c.position.x.toFixed(3), y: +(-c.position.z).toFixed(3), z: +c.position.y.toFixed(3),
          yaw: +Math.atan2(-v.z, v.x).toFixed(4), pitch: +Math.asin(Math.max(-1, Math.min(1, v.y))).toFixed(4), fov: +c.fov.toFixed(3),
          mode: g.mode, sv: g.serving, ss: g.serveState || '', ts: +(VB.ctx.timeScale).toFixed(3),
          cutN: typeof d.cutN === 'number' ? d.cutN : -1, nci: typeof d.nextCutIn === 'number' ? +d.nextCutIn.toFixed(3) : -9,
          lck: d.lastCut ? d.lastCut.kind : '', bin: bin, ev: ev, maxBox: +maxBox.toFixed(3),
          hero: d.pf && d.pf.hero != null ? d.pf.hero : null, vic: d.pf && d.pf.vic != null ? d.pf.vic : null,
          hs: (function () { var h = VB.CameraRig.heroShot ? VB.CameraRig.heroShot() : null; return h ? (h.conv ? 2 : 1) : 0; })(),
          aw: VB.Players && VB.Players.heroShotAware ? 1 : 0,
          pl: pl, touch: VB.Input && VB.Input.overlayShown ? (VB.Input.overlayShown() ? 1 : 0) : 0, st: VB.ctx.state });
      } catch (err) { window.__R.push({ err: String(err) }); }
      return r;
    };
  }
  var iv = setInterval(function () { hook(); if (hooked) clearInterval(iv); }, 20);
})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const DEG = 180 / Math.PI;

async function runOne(size, seed, kind) {
  kind = kind || 'match';
  const touch = /t$/.test(size), sz = size.replace(/t$/, '');
  const page = await CDP.open({ size: sz, touch, init: INIT(kind === 'feel' ? 1 : SPEED) });
  const R = [], E = [];
  let extra = null;
  try {
    if (kind !== 'match') { extra = await runExtra(page, kind, seed); return { size, seed, touch, kind, R: extra.R, E: extra.E, X: extra.X, errors: page.errors.slice() }; }
    const q = 'debug=rally&live=1&seed=' + seed + (process.env.CAMDBG ? '&camdbg=1' : '') + (process.env.DIFF ? '&diff=' + process.env.DIFF : '') + CAMBREAK;
    if (process.env.PAGE_ROOT) {
      // (pruebas de integración: otra copia del proyecto, p. ej. con el parche que se pide a otro owner)
      await page.send('Page.navigate', { url: require('url').pathToFileURL(path.join(path.resolve(process.env.PAGE_ROOT), 'index.html')).href + '?' + q });
      await sleep(2500);
    } else await page.navigate(q);
    const tEnd = Date.now() + SECS * 1000 / SPEED + 1500;
    while (Date.now() < tEnd) {
      await sleep(1500);
      const chunk = await page.evalJs('(function(){var r=window.__R, e=window.__E; window.__R=[]; window.__E=[]; return JSON.stringify([r,e]);})()');
      const [r, e] = JSON.parse(chunk);
      const base = R.length;
      for (const x of e) { x.f += base; E.push(x); }
      for (const x of r) R.push(x);
    }
  } finally { page.close(); }
  return { size, seed, touch, kind, R, E, errors: page.errors.slice() };
}
/** Partidas aparte (ola 3): 'menu' (60 s de menú + presentación del partido), 'setend' (cierre de set desde debug=setpoint), 'feel' (hit-stop
 *  y punch inyectados en un peloteo). Devuelven el registro como las de partido y, en X, datos propios. */
async function runExtra(page, kind, seed) {
  const R = [], E = [], X = {};
  const pull = async () => { const [r, e] = JSON.parse(await page.evalJs('(function(){var r=window.__R, e=window.__E; window.__R=[]; window.__E=[]; return JSON.stringify([r,e]);})()'));
    const base = R.length; for (const x of e) { x.f += base; E.push(x); } for (const x of r) R.push(x); };
  if (kind === 'menu') {
    await page.navigate('debug=menu&live=1&seed=' + seed + CAMBREAK); await sleep(1200); await page.evalJs('window.__R=[];window.__E=[];1');
    const tEnd = Date.now() + 60000 / SPEED; while (Date.now() < tEnd) { await sleep(1500); await pull(); }
    X.menuEnd = R.length;
    // presentación del partido: partido humano con la tarjeta (sin depuración no hay escena congelada)
    await page.navigate('intro=1' + CAMBREAK); await sleep(5000); await page.evalJs('window.__R=[];window.__E=[];1');
    await page.evalJs('VB.ctx.actions.startMatch({})'); await sleep(4200 / SPEED + 1500); await pull();
  } else if (kind === 'setend') {
    await page.navigate('debug=setpoint&live=1&seed=' + seed + CAMBREAK); await sleep(1500);
    const tEnd = Date.now() + 70000 / SPEED; let saw = false, after = 0;
    while (Date.now() < tEnd) { await sleep(1200); await pull(); if (R.some(r => r.shot === 'court')) saw = true; if (saw && R.length && R[R.length - 1].shot !== 'court' && R[R.length - 1].shot !== 'point' && ++after > 2) break; }
  } else if (kind === 'feel') {
    await page.navigate('debug=rally&live=1&seed=' + seed + CAMBREAK); await sleep(2500);
    const res = await page.evalJs(`new Promise(function (res) {
      var T = [], t0 = performance.now(), ph = 0, out = {};
      function f() { var now = performance.now(), d = VB.CameraRig.getDebug(); T.push([now, VB.ctx.timeScale, d.punch || 0, d.hitStop || 0]);
        if (ph === 0 && now - t0 > 300) { ph = 1; out.hs0 = now; VB.CameraRig.hitStop(60, 'perfect'); out.req = now; }
        if (ph === 1 && now - out.hs0 > 700) { ph = 2; out.p0 = now; VB.CameraRig.punch(3); }
        if (ph === 2 && now - out.p0 > 600) { out.T = T; res(JSON.stringify(out)); return; }
        requestAnimationFrame(f); }
      requestAnimationFrame(f); })`, true);
    const o = JSON.parse(res), T = o.T;
    // hit-stop: tiempo real con timeScale 0 (desde el frame en que se pide), y hasta volver a 1
    let z0 = -1, z1 = -1, back = -1, firstRun = -1; for (let i = 0; i < T.length; i++) { const [t, ts] = T[i]; if (t < o.hs0 || t > o.hs0 + 600) continue; if (ts === 0 && z0 < 0) z0 = t; if (ts === 0) z1 = t; if (z1 > 0 && ts > 0 && firstRun < 0 && t > z1) firstRun = t; if (z1 > 0 && ts >= 0.999 && back < 0 && t > z1) back = t; }
    const ds = []; for (let i = 1; i < T.length; i++) ds.push(T[i][0] - T[i - 1][0]); ds.sort((a, b) => a - b); const fr = ds[Math.floor(ds.length / 2)] || 16;
    const pk = T.find(x => x[0] >= o.p0 && x[2] > 0), pt0 = pk ? pk[0] : o.p0, at200 = T.filter(x => x[0] >= pt0 + 200).map(x => x[2])[0];
    // (frame más largo dentro de la congelación: con el PC cargado un solo frame lento estira el tiempo real con timeScale 0)
    let mg = 0; for (let i = 1; i < T.length; i++) if (T[i][0] >= o.hs0 && T[i][0] <= (firstRun > 0 ? firstRun : o.hs0 + 300)) mg = Math.max(mg, T[i][0] - T[i - 1][0]);
    X.feel = { maxGap: +mg.toFixed(1), zero: z0 > 0 && firstRun > 0 ? +(firstRun - o.req).toFixed(1) : 0, ease: back > 0 ? +(back - z1).toFixed(1) : -1, frame: +fr.toFixed(1), punch200: at200 == null ? -1 : +at200.toFixed(3) };
  }
  return { R, E, X };
}

function analyze(run) {
  const { R, E } = run, res = {};
  const add = (k, ok, info) => { if (!on(k)) return; (res[k] = res[k] || { ok: true, info: [] }); if (!ok) res[k].ok = false; if (info != null) res[k].info.push(info); };
  if (!R.length) { add('bounds', false, 'sin registro'); return res; }
  const errs = R.filter(r => r.err); if (errs.length) add('bounds', false, 'error del registro: ' + errs[0].err);
  const F = R.filter(r => !r.err);
  const hasCut = F.some(r => r.cutN >= 0);
  // BOUNDS
  let nb = 0, worst = null;
  for (const r of F) if (r.st === 'playing' && (Math.abs(r.x) > 15.2 || Math.abs(r.y) > 10.4 || r.z > 19)) { nb++; if (!worst || Math.abs(r.x) > Math.abs(worst.x)) worst = r; }
  add('bounds', nb === 0, nb ? nb + ' frames fuera (peor x ' + worst.x + ' y ' + worst.y + ' z ' + worst.z + ' plano ' + worst.shot + ')' : 'ok');
  // CUTS: saltos > 2 m
  let jumps = 0, unl = [], cuts = 0;
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1], b = F[i];
    const mv = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const cut = hasCut && b.cutN > a.cutN;
    if (cut) cuts++;
    // salto = > 2 m en un frame Y más rápido que el tope del rig (40 m/s; ×1,4 de margen): con SPEED=2 y un frame de 50 ms, la
    // cámara puede recorrer 2 m sin cortar
    if (mv > 2 && (cut || mv / Math.max(1e-3, b.dt) > 56)) { jumps++; if (!cut) unl.push(a.shot + '>' + b.shot + ' ' + mv.toFixed(1) + 'm'); }
  }
  // CUTCOUNT: por cada punto (salvo el que cierra el partido), cada corte cuenta una sola vez: 'point' (si lo hay) y uno de vuelta ('serve' o 'court')
  if (hasCut) {
    let bad = [], np = 0;
    for (const e of E) {
      if (e.type !== 'point' || e.matchWon) continue;
      let i = e.f, kinds = [];
      while (i + 1 < F.length && !(/^serve/.test(F[i + 1].shot) && F[i].shot !== F[i + 1].shot && F[i].shot !== 'court') && !(F[i].shot === 'court' && /^serve/.test(F[i + 1].shot))) {
        if (F[i + 1].cutN > F[i].cutN) kinds.push(F[i + 1].lck);
        i++;
        if (F[i].t - F[e.f].t > 12) break;
      }
      if (i + 1 < F.length && F[i + 1].cutN > F[i].cutN) kinds.push(F[i + 1].lck);
      if (i + 1 >= F.length) continue;   // (el registro acaba antes del saque)
      np++;
      // cada corte cuenta UNA vez y en orden: [point?] + [serve|court?] (el plano de víctima puede llegar deslizando: sin 'point';
      // la vuelta puede ser una transición fija: sin 'serve')
      // (ola 2: cierre de set/partido 'clinch' x<=2 antes de la grúa; cutaway al sacador rival 'cutaway' seguido del corte 'serve')
      const cnt = k => kinds.filter(x => x === k).length, ci = kinds.indexOf('cutaway');
      const okK = kinds.length >= 1 && kinds.length <= 4 && kinds.every(k => ['point', 'serve', 'court', 'clinch', 'cutaway'].includes(k)) &&
        cnt('point') <= 1 && cnt('serve') <= 1 && cnt('court') <= 1 && cnt('cutaway') <= 1 && cnt('clinch') <= 2 && (ci < 0 || (ci === kinds.length - 1 && kinds[ci - 1] === 'serve')) &&
        (kinds.indexOf('point') <= 0) && !(cnt('serve') && cnt('court'));
      if (!okK) bad.push(kinds.join('+') + ' @' + F[e.f].t.toFixed(1));
    }
    add('cutcount', bad.length === 0, np + ' puntos' + (bad.length ? '; cortes: ' + bad.slice(0, 5).join(', ') : ' sin cortes duplicados ni fuera de orden'));
  }
  add('cuts', unl.length === 0 && hasCut, (hasCut ? '' : 'sin getDebug().cutN; ') + jumps + ' saltos > 2 m, ' + cuts + ' cortes' + (unl.length ? '; SIN CORTE: ' + unl.slice(0, 6).join(', ') : ''));
  // SERVECUT y NEXTCUT: cortes cuyo destino es un plano de saque
  let sc = 0, scBad = [], ncBad = [];
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1], b = F[i];
    const isServeCut = /^serve/.test(b.shot) && a.shot !== b.shot && (hasCut ? b.cutN > a.cutN : Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 2);
    if (!isServeCut) continue;
    sc++;
    // posición asentada: 0,6 s (de juego) después del corte o el frame anterior al lanzamiento/cambio de plano
    let j = i, ref = null;
    while (j < F.length && F[j].shot === b.shot && F[j].t - b.t < 0.6 && F[j].ss !== 'toss') j++;
    ref = F[Math.min(j, F.length - 1) - (j > i ? 1 : 0)];
    const k3 = F[Math.min(i + 3, F.length - 1)];
    const d3 = Math.hypot(k3.x - ref.x, k3.y - ref.y, k3.z - ref.z);
    if (d3 > 0.5) scBad.push(b.shot + ' d=' + d3.toFixed(2) + ' @' + b.t.toFixed(1));
    if (hasCut) {
      // último frame que está >= 0,15 s (reales) antes del corte (tiempo hasta el corte = suma de los dt posteriores)
      let k = i, rem = 0;
      while (k > 1 && rem < 0.15) { rem += F[k].dt; k--; }
      const pre = F[k], cutF = b;
      // (nci debe anunciar el corte con >= 0,15 s; tolerancia de 1 frame por la cuantización del paso de sim)
      let tol = 0.012; for (let q = k + 1; q <= i; q++) tol = Math.max(tol, F[q].dt);   // (±1 frame: el mayor dt del tramo)
      if (!(pre.nci >= 0.15 - tol) || !(F[i].nci <= 0.02 && F[i].nci >= 0)) ncBad.push('pre ' + pre.nci + ' (faltaban ' + rem.toFixed(3) + ') cut ' + cutF.nci + ' @' + b.t.toFixed(1));
    }
  }
  add('servecut', scBad.length === 0, sc + ' cortes al saque' + (scBad.length ? '; lejos de su sitio: ' + scBad.slice(0, 5).join(', ') : ''));
  if (hasCut) add('nextcut', ncBad.length === 0, sc + ' cortes al saque' + (ncBad.length ? '; aviso tardío: ' + ncBad.slice(0, 5).join(', ') : ''));
  else add('nextcut', false, 'sin getDebug().nextCutIn');
  // SETTLE: lanzamientos rivales
  let ns = 0, sBad = [];
  for (const e of E) {
    if (e.type !== 'toss' || e.team !== 1) continue;
    const i = e.f; if (i < 5 || i >= F.length) continue;
    ns++;
    let k = i, acc = 0, vmax = 0, fmax = 0, start = null;
    while (k > 1 && acc < 0.4) {
      const a = F[k - 1], b = F[k], dt = b.dt || 1e-3;
      if (b.dt > 0 && b.st === 'playing') {
        vmax = Math.max(vmax, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt);
        fmax = Math.max(fmax, Math.abs(b.fov - a.fov) / dt);
      }
      if (!/^serve/.test(b.shot)) { start = b.shot; break; }
      acc += b.dt; k--;
    }
    if (vmax >= 0.3 || fmax >= 1 || start) sBad.push('v ' + vmax.toFixed(2) + ' m/s fov ' + fmax.toFixed(2) + '°/s' + (start ? ' (plano ' + start + ' a < 0,4 s)' : '') + ' @' + F[i].t.toFixed(1));
  }
  add('settle', sBad.length === 0, ns + ' saques rivales' + (sBad.length ? '; sin asentar: ' + sBad.slice(0, 5).join(', ') : ''));
  // MONO: transiciones (deslizadas) al saque rival: desde el cambio de plano hasta el lanzamiento
  let mBad = [], nMono = 0;
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1], b = F[i];
    if (b.shot !== 'serveThem' || a.shot === 'serveThem') continue;
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 2) continue; // corte: no hay transición
    nMono++;
    let j = i; const fs = [], ps = [];
    while (j < F.length && F[j].shot === 'serveThem' && F[j].ss !== 'toss') { fs.push(F[j].fov); ps.push(F[j].pitch * DEG); j++; }
    const rev = arr => { let lo = arr[0], hi = arr[0], dir = 0, worst = 0, ext = arr[0];
      for (const v of arr) { if (dir >= 0 && v > ext) { ext = v; } if (dir <= 0 && v < ext) { ext = v; }
        if (dir === 0 && Math.abs(v - arr[0]) > 0.3) { dir = v > arr[0] ? 1 : -1; ext = v; }
        else if (dir > 0 && ext - v > worst) worst = ext - v; else if (dir < 0 && v - ext > worst) worst = v - ext; }
      return worst; };
    const rf = rev(fs), rp = rev(ps);
    if (rf > 1.5 || rp > 1.5) mBad.push('fov ' + rf.toFixed(1) + '° pitch ' + rp.toFixed(1) + '° @' + b.t.toFixed(1));
  }
  add('mono', mBad.length === 0, nMono + ' transiciones deslizadas' + (mBad.length ? '; vuelta: ' + mBad.slice(0, 5).join(', ') : ''));
  // REVERSE: inversiones de cabeceo (> 0,6°) en serveThem
  let revN = 0, stT = 0;
  { let dir = 0, ext = null, prevShot = '';
    for (const r of F) {
      if (r.shot !== 'serveThem' || r.st !== 'playing') { prevShot = r.shot; dir = 0; ext = null; continue; }
      stT += r.dt;
      const p = r.pitch * DEG;
      if (ext === null || prevShot !== 'serveThem') { ext = p; dir = 0; prevShot = r.shot; continue; }
      if (dir === 0) { if (Math.abs(p - ext) > 0.6) { dir = p > ext ? 1 : -1; ext = p; } }
      else if (dir > 0) { if (p > ext) ext = p; else if (ext - p > 0.6) { revN++; dir = -1; ext = p; } }
      else { if (p < ext) ext = p; else if (p - ext > 0.6) { revN++; dir = 1; ext = p; } }
      prevShot = r.shot;
    } }
  add('reverse', revN === 0, revN + ' inversiones de cabeceo en ' + stT.toFixed(0) + ' s de saque rival (' + (stT > 0 ? (revN / stT * 60).toFixed(1) : 0) + '/min)');
  // HERO
  let hN = 0, hOk = 0, hBad = [], hFaceOnly = 0, hScorer = 0, sN = 0, sOk = 0, scBadH = [];
  const lastT = [null, null];
  for (const e of E) {
    if (e.type === 'touch') { lastT[e.team] = e.num; continue; }
    if (e.type === 'serveReady') { lastT[0] = lastT[1] = null; continue; }
    if (e.type !== 'point' || !['kill', 'ace', 'block'].includes(e.how) || e.matchWon) continue;
    // primer frame del plano de reacción tras el corte + 0,5 s
    let i = e.f; while (i < F.length && F[i].shot !== 'point' && i - e.f < 400) i++;
    if (i >= F.length || F[i].shot !== 'point') continue;
    // instante del corte: subida de cutN en el plano point (o el propio comienzo si no hay cutN)
    let c = i; const n0 = F[i].cutN;
    while (c < F.length && F[c].shot === 'point' && F[c].cutN === n0 && hasCut) c++;
    if (c >= F.length || F[c].shot !== 'point') c = i;
    let j = c, acc = 0; while (j < F.length && acc < 0.5 && F[j].shot === 'point') { acc += F[j].dt * (F[j].ts > 0 ? 1 : 1); j++; }
    if (j >= F.length || F[j].shot !== 'point') continue;
    const r = F[j]; hN++;
    const heroNum = r.hero;
    // SCORER: el héroe es el que anotó (el sacador en el ace; si no, el último del equipo que gana que tocó: remate, bloqueo…)
    const scorerNum = e.how === 'ace' ? e.srv : lastT[e.team];
    if (scorerNum != null) { sN++; if (heroNum === scorerNum) sOk++; else scBadH.push(e.how + ' héroe #' + heroNum + ' anotó #' + scorerNum + ' @' + r.t.toFixed(1)); }
    const hp = r.pl.find(q => q[0] === heroNum && q[4] === e.team);
    if (heroNum == null || !hp) { hBad.push(e.how + ' sin héroe @' + r.t.toFixed(1)); continue; }
    const others = r.pl.filter(q => q !== hp);
    const losers = r.pl.filter(q => q[4] !== e.team);
    const big = others.every(q => q[1] <= hp[1] || !q[2]);
    const lose = losers.every(q => !q[2] || q[1] <= 0.6 * hp[1]);
    const headOk = hp[7] <= 0.75;                       // franja del rótulo: la cabeza por debajo de 0,25 NDC desde arriba
    const scorer = heroNum === (e.how === 'ace' ? e.srv : e.lp) || e.how === 'block' || e.how === 'kill';
    if (heroNum === (e.how === 'ace' ? e.srv : e.lp)) hScorer++;
    const okBut = hp[2] && hp[1] >= 0.30 && big && lose && headOk;
    const ok = okBut && hp[3] >= 0 && hp[3] <= 70;
    if (okBut && !ok) hFaceOnly++;
    const bigger = others.filter(q => q[2] && q[1] > hp[1]).map(q => '#' + q[0] + (q[4] === e.team ? 'mate' : 'rival') + ' ' + q[1]).join(',');
    if (ok) hOk++; else hBad.push(e.how + ' #' + heroNum + ' h ' + hp[1] + ' in ' + hp[2] + ' ang ' + hp[3] + ' big ' + big + (bigger ? '(' + bigger + ')' : '') + ' los ' + lose + (lose ? '' : '(' + losers.filter(q => q[2] && q[1] > 0.6 * hp[1]).map(q => '#' + q[0] + ' ' + q[1]).join(',') + ')') + ' head ' + hp[7] + ' hs ' + r.hs + '/' + r.aw + ' @' + r.t.toFixed(1));
  }
  // (por partida solo informa; el criterio, >= 90 % de los puntos, se aplica al final sumando las semillas de cada tamaño)
  add('hero', true, hOk + '/' + hN + ' planos de héroe bien (' + hFaceOnly + ' fallan solo por el frente > 70°)' + (hBad.length ? '; ' + hBad.slice(0, 8).join(' | ') : ''));
  if (res.hero) { res.hero.ok = true; res.hero.n = hN; res.hero.okN = hOk; }
  add('scorer', sOk === sN, sOk + '/' + sN + ' planos de héroe con el que anotó' + (scBadH.length ? "; " + scBadH.slice(0, 5).join(", ") : ""));
  // BBOX en transiciones (primeros 1,2 s de un plano nuevo sin corte)
  let bbBad = 0, bbWorst = 0;
  for (let i = 1; i < F.length; i++) {
    if (F[i].shot === F[i - 1].shot) continue;
    let j = i, acc = 0;
    while (j < F.length && acc < 1.2 && F[j].shot === F[i].shot) { if (F[j].maxBox > 0.35) { bbBad++; bbWorst = Math.max(bbWorst, F[j].maxBox); } acc += F[j].dt; j++; }
  }
  add('bbox', bbBad === 0, bbBad + ' frames de transición con un jugador > 35 % de la pantalla' + (bbBad ? ' (máx ' + (bbWorst * 100).toFixed(0) + ' %)' : ''));
  // BALL fuera de cuadro por plano
  const by = {};
  for (const r of F) { if (r.st !== 'playing' || r.mode !== 'rally') continue; const o = by[r.shot] = by[r.shot] || [0, 0]; o[0]++; if (!r.bin) o[1]++; }
  const ballInfo = Object.keys(by).map(k => k + ' ' + (by[k][1] / by[k][0] * 100).toFixed(1) + '%').join(', ');
  const ballBad = Object.keys(by).some(k => ['rally', 'attack', 'defend'].includes(k) && by[k][0] > 200 && by[k][1] / by[k][0] > 0.03);
  // (21:9: el FOV vertical queda corto en la defensa hasta CAM-12, "Ultrawide: vertical-minimum FOV": aviso, no fallo)
  const wide = (() => { const m = run.size.replace(/t$/, '').split('x'); return +m[0] / +m[1] > 2.05; })();
  if (wide && ballBad) { add('ball', true, 'AVISO (CAM-12) balón fuera de cuadro: ' + ballInfo); }
  else add('ball', !ballBad, 'balón fuera de cuadro: ' + ballInfo);
  // FOVRATE (informativo) en táctil durante el juego
  if (run.touch) {
    let sum = 0, n = 0, mxr = 0;
    for (let i = 1; i < F.length; i++) { const a = F[i - 1], b = F[i]; if (b.mode !== 'rally' || a.shot !== b.shot || !(b.dt > 0)) continue; const r = Math.abs(b.fov - a.fov) / b.dt; sum += r; n++; mxr = Math.max(mxr, r); }
    add('fovrate', true, 'FOV táctil en juego: medio ' + (n ? (sum / n).toFixed(2) : 0) + '°/s, máx ' + mxr.toFixed(1) + '°/s');
  }
  // CUTAWAY (CAM-14): saque rival con cutaway: el sacador >= 40 % del alto >= 0,8 s y el corte de vuelta >= 0,5 s antes del lanzamiento
  { let n = 0, ok = 0, bad = [], srv = null;
    for (const e of E) {
      if (e.type === 'serveReady') { srv = e.team === 1 ? e : null; continue; }
      if (e.type !== 'toss' || e.team !== 1 || !srv) continue;
      let i = srv.f, big = 0, hadCw = false, backAt = -1;
      for (; i < e.f && i < F.length; i++) { const r = F[i]; if (r.shot === 'cutaway') { hadCw = true; const sp = r.pl.find(q => q[0] === srv.num && q[4] === 1); if (sp && sp[2] && sp[1] >= 0.4) big += r.dt; } else if (hadCw && backAt < 0) backAt = i; }
      srv = null; if (!hadCw) continue;
      n++; let lead = 0; if (backAt >= 0) for (let k = backAt; k < e.f && k < F.length; k++) lead += F[k].dt;
      if (big >= 0.8 && lead >= 0.5) ok++; else bad.push('sacador ' + big.toFixed(2) + ' s, vuelta ' + lead.toFixed(2) + ' s antes @' + (F[Math.min(e.f, F.length - 1)] || {}).t);
    }
    const rs = E.filter(e => e.type === 'toss' && e.team === 1).length;
    add('cutaway', bad.length === 0, ok + '/' + n + ' cutaways bien (' + rs + ' saques rivales)' + (bad.length ? '; ' + bad.slice(0, 4).join(' | ') : '')); }
  const pct = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
  const asp = (() => { const m = run.size.replace(/t$/, '').split('x'); return +m[0] / +m[1]; })();
  // FOLLOW (CAM-08): bote dentro tras un remate NUESTRO del jugador controlado: el bote en el 60 % central de la pantalla, sin corte
  // entre el contacto y el bote (agregado por tamaño: >= 90 %)
  { let n = 0, ok = 0, bad = [], lastSp = null;
    for (const e of E) {
      if (e.type === 'ospike') { lastSp = e.ctrl ? e : null; continue; }
      if (e.type === 'touch' && e.team === 1) { lastSp = null; continue; }
      if (e.type !== 'land' || !lastSp) continue;
      const sp = lastSp; lastSp = null;
      if (!(e.inside && e.lt === 0 && e.lk === 'spike') || e.f >= F.length || sp.f >= F.length) continue;
      n++;
      const cutBetween = hasCut && F[e.f].cutN !== F[sp.f].cutN;
      const good = e.front && Math.abs(e.nx) <= 0.6 && Math.abs(e.ny) <= 0.6 && !cutBetween;
      if (good) ok++; else bad.push('ndc ' + e.nx + ',' + e.ny + (e.front ? '' : ' detrás') + (cutBetween ? ' CORTE' : '') + ' ft ' + e.ft + ' @' + F[e.f].t.toFixed(1));
    }
    add('follow', true, ok + '/' + n + ' botes de remate propio en el 60 % central' + (bad.length ? '; ' + bad.slice(0, 5).join(' | ') : ''));
    if (res.follow) { res.follow.n = n; res.follow.okN = ok; } }
  // juego: frames de rally por plano
  const G = F.filter(r => r.st === 'playing' && r.mode === 'rally');
  // FOVPUMP (CAM-11, táctil): ritmo de FOV en rally/attack p50 <= 2°/s y p95 <= 12°/s; balón fuera 0 %; balón tras el HUD 0
  if (run.touch) {
    const rates = []; let off = 0, n = 0, hud = 0, hudK = {};
    for (let i = 1; i < F.length; i++) {
      const a = F[i - 1], b = F[i];
      if (b.st !== 'playing' || b.mode !== 'rally' || a.mode !== 'rally' || !(b.dt > 0)) continue;
      if (['rally', 'attack', 'defend'].includes(b.shot)) { n++; if (!b.bin) off++; if (b.hud) { hud++; hudK[b.hud] = (hudK[b.hud] || 0) + 1; } }
      if ((b.shot === 'rally' || b.shot === 'attack') && a.shot === b.shot) rates.push(Math.abs(b.fov - a.fov) / b.dt);
    }
    const p50 = pct(rates, 0.5), p95 = pct(rates, 0.95);
    // (puerta: p95 y balón fuera; p50 y balón tras el HUD van aparte en fovpumpX, informativa salvo STRICT2=1)
    add('fovpump', p95 <= 12 && off === 0, 'FOV rally/attack p95 ' + p95.toFixed(1) + '°/s · balón fuera ' + off + '/' + n);
    if (on('fovpump')) { res.fovpumpX = { ok: p50 <= 2 && hud === 0, info: ['p50 ' + p50.toFixed(2) + '°/s (<= 2) · tras el HUD ' + hud + (hud ? ' ' + JSON.stringify(hudK) : '')] }; }
  }
  // WIDE (CAM-12, aspecto > 2 sin táctil): balón fuera 0 %, cerca del borde (|ndc| > 0,9) <= 2 %, cadera del jugador en cuadro 100 %
  if (asp > 2.0 && !run.touch) {
    // (frames a <= 0,4 s de juego tras un frame lento del PC —dt > 4x la mediana y > 50 ms—: la cámara, con el dt recortado, va un
    // frame por detrás de unos jugadores que sí avanzaron; no es un fallo del encuadre. Se cuentan aparte)
    const dts = G.map(r => r.dt).filter(v => v > 0).sort((a, b) => a - b), mdt = dts[Math.floor(dts.length / 2)] || 1 / 60;
    let hT = -9, n = 0, off = 0, edge = 0, hipOut = 0, hitchN = 0;
    for (const r of G) {
      if (r.dt > Math.max(0.05, 4 * mdt)) hT = r.t;
      if (!['rally', 'attack', 'defend'].includes(r.shot)) continue;
      if (r.t - hT <= 0.4) { hitchN++; continue; }
      n++; if (!r.bin) off++; else if (Math.abs(r.bx) > 0.9 || Math.abs(r.by) > 0.9) edge++;
      if (!r.chIn) hipOut++;
    }
    add('wide', off === 0 && edge <= 0.02 * n && hipOut === 0, 'balón fuera ' + off + '/' + n + ' · borde ' + (n ? (edge / n * 100).toFixed(1) : 0) + ' % · cadera fuera ' + hipOut + (hitchN ? ' · ' + hitchN + ' frames tras un tirón del PC sin contar' : ''));
  }
  // SPIKER (CAM-13): remate rival: el rematador >= 18 % del alto (táctil 16 %) en el contacto (agregado >= 90 %); en defensa el
  // jugador controlado en pantalla 100 %, ritmo de FOV p95 <= 12°/s y balón fuera 0 %
  // (la aceptación pide 16:9 y 844x390 táctil; en 4:3 y 21:9 solo se informa)
  const spkReq = run.touch || (asp > 1.6 && asp < 1.9);
  { const thr = run.touch ? 0.16 : 0.18; let n = 0, ok = 0, hs = [];
    for (const e of E) { if (e.type !== 'rspike') continue; n++; hs.push(e.h); if (e.inF && e.h >= thr) ok++; }
    const rates = []; let dn = 0, cOut = 0, bOff = 0;
    for (let i = 1; i < F.length; i++) {
      const a = F[i - 1], b = F[i];
      if (b.st !== 'playing' || b.mode !== 'rally' || b.shot !== 'defend') continue;
      dn++; if (!b.chdIn && !b.chIn) cOut++; if (!b.bin) bOff++;
      if (a.shot === 'defend' && b.dt > 0) rates.push(Math.abs(b.fov - a.fov) / b.dt);
    }
    const p95 = pct(rates, 0.95);
    add('spiker', cOut === 0 && p95 <= 12 && bOff === 0, ok + '/' + n + ' remates rivales con el rematador >= ' + (thr * 100) + ' % (mediana ' + (pct(hs, 0.5) * 100).toFixed(1) + ' %) · defensa: jugador fuera ' + cOut + '/' + dn +
      ' · FOV p95 ' + p95.toFixed(1) + '°/s · balón fuera ' + bOff);
    if (res.spiker && spkReq) { res.spiker.n = n; res.spiker.okN = ok; } }
  analyzeW3(run, F, E, res, add);
  return res;
}
/** Comprobaciones de la ola 3 sobre una partida de juego: SERVE, BOARD, CLUTTER, BLOCK. */
function analyzeW3(run, F, E, res, add) {
  // SERVE (CAM-15): frames de saque propio asentados (>= 0,6 s en el plano; en el aire solo cuenta el salto), y balón >= 3,5 m siempre
  { let n = 0, bad = [], near = 0, st = -1;
    for (let i = 0; i < F.length; i++) {
      const r = F[i]; if (r.shot !== 'serveUs' || !r.xs || r.st !== 'playing') { st = -1; continue; }
      if (st < 0 || F[i - 1].shot !== 'serveUs') st = i;
      if (r.xs[3] < 3.5) near++;
      let acc = 0; for (let k = st + 1; k <= i; k++) acc += F[k].dt; if (acc < 0.6) continue;
      n++; const sx = r.xs[0], inF = r.xs[1], far = r.xs[2], offC = r.xs[4], jump = r.xs[5];
      // (pantalla baja/táctil: el sacador puede ir casi al centro —entre el joystick y los botones—; es lo que deja fuera de cuadro al
      // juez de línea cercano, que está a su misma profundidad y salía de ~150 px encima del joystick)
      const sxMin = run.touch || +run.size.replace(/t$/, '').split('x')[1] < 480 ? -0.02 : 0.08;
      const why = (!jump && (sx < sxMin || sx > 0.6) ? 'sx ' + sx : '') + (!jump && !inF ? ' cortado' : '') + (!jump && far < 0.5 ? ' fondo ' + far : '') + (offC ? ' oficial cortado ' + r.xs[6] + (r.ss ? ' ' + r.ss : '') : '');
      if (why) bad.push(why.trim() + ' @' + r.t.toFixed(1));
    }
    add('serve', bad.length === 0 && near === 0, n + ' frames de saque propio asentados' + (near ? ' · balón a < 3,5 m en ' + near : '') + (bad.length ? ' · ' + bad.length + ' mal: ' + bad.slice(0, 4).join(' | ') : '')); }
  // BOARD (CAM-19)
  { let n = 0, bad = 0, ex = ''; for (const r of F) { if (!(r.brd >= 0)) continue; n++; if (r.brd) { bad++; if (!ex) ex = r.shot + ' @' + r.t.toFixed(1); } }
    add('board', bad === 0, n + ' frames de punto/grúa/cierre/final' + (bad ? ' · marcador cortado en ' + bad + ' (' + ex + ')' : '')); }
  // CLUTTER (CAM-18): tras el corte de reacción de cada punto
  { let n = 0, badB = 0, badH = 0, ex = [];
    for (const e of E) {
      if (e.type !== 'point' || e.f >= F.length) continue;
      let i = e.f, cut = false; const c0 = F[i].cutN;
      for (; i < F.length && i - e.f < 900; i++) {
        const r = F[i]; if (i > e.f && r.shot !== 'point') break;
        if (!cut && r.cutN > c0 && r.lck === 'point') cut = true;
        if (!cut || !r.pc) continue;
        n++; const dia = r.pc[0], px = r.pc[1], py = r.pc[2], ban = r.pc[3], hh = r.pc[4], W = r.W, H = r.H;
        const edge = px < 0.15 * W || px > 0.85 * W || py < 0.15 * H || py > 0.85 * H, onB = ban && px >= ban[0] && px <= ban[2] && py >= ban[1] && py <= ban[3];
        if (r.bin && dia > 0.04 && (edge || onB)) { badB++; if (ex.length < 3) ex.push('balón ' + (dia * 100).toFixed(1) + '%H ' + (onB ? 'cinta' : 'borde') + ' @' + r.t.toFixed(1)); }
        if (hh) { badH++; if (ex.length < 3) ex.push('cabeza bajo la cinta @' + r.t.toFixed(1)); }
      }
    }
    add('clutter', badB === 0 && badH === 0, n + ' frames tras el corte de reacción' + (badB || badH ? ' · balón ' + badB + ' · cabezas ' + badH + ' · ' + ex.join(' | ') : '')); }
  // BLOCK (CAM-17): giro combinado <= 40°/s de -0,6 a +0,5 s del bloqueo (planos de juego, sin cortes); balón en cuadro en el bloqueo
  { let nB = 0, bad = [], maxR = 0;
    for (const e of E) {
      if (e.type !== 'touch' || !e.blk) continue;
      const i0 = e.f; if (i0 >= F.length) continue;
      nB++;
      if (!F[i0].bin) bad.push('balón fuera en el bloqueo @' + F[i0].t.toFixed(1));
      let a = i0, acc = 0; while (a > 1 && acc < 0.6) { acc += F[a].dt; a--; }
      let b = i0; acc = 0; while (b < F.length - 1 && acc < 0.5) { b++; acc += F[b].dt; }
      for (let k = a + 1; k <= b; k++) {
        const p = F[k - 1], q = F[k]; if (!(q.dt > 0) || q.cutN > p.cutN || ['rally', 'attack', 'defend'].indexOf(q.shot) < 0 || q.shot !== p.shot) continue;
        const rr = Math.hypot(Math.abs(wrap(q.yaw - p.yaw)), Math.abs(q.pitch - p.pitch)) / q.dt * DEG;
        if (rr > maxR) maxR = rr;
        if (rr > 40.5) { bad.push('giro ' + rr.toFixed(0) + '°/s @' + q.t.toFixed(1)); break; }
      }
    }
    add('block', bad.length === 0, nB + ' bloqueos · giro máx ' + maxR.toFixed(0) + '°/s' + (bad.length ? ' · ' + bad.slice(0, 4).join(' | ') : '')); }
}
/** MENU + INTRO (CAM-16). */
function analyzeMenu(run) {
  const res = {}, add = (k, ok, info) => { if (!on(k)) return; res[k] = { ok: ok, info: [info] }; };
  const F = run.R.filter(r => !r.err), end = run.X.menuEnd, M = [], tOf = [];
  let t = 0;
  for (let i = 0; i < end && i < F.length; i++) { const r = F[i]; if (r.st === 'menu') { t += r.dt; M.push(r); } tOf.push(t); }
  const I = F.slice(end);
  if (on('menu')) {
    let T = 0; const TT = M.map(r => (T += r.dt));
    const cuts = []; for (let i = 1; i < M.length; i++) if (M[i].cutN > M[i - 1].cutN) cuts.push(i);
    const types = new Set(M.map(r => r.mt).filter(Boolean));
    const hitT = run.E.filter(e => e.type === 'touch' && e.f < end).map(e => tOf[Math.min(e.f, tOf.length - 1)]);
    const near = cuts.filter(c => hitT.some(h => Math.abs(h - TT[c]) <= 0.3)).length;
    let short = 0; for (let k = 1; k < cuts.length; k++) if (TT[cuts[k]] - TT[cuts[k - 1]] < 5.95) short++;
    let turnBad = 0, maxT = 0;
    for (let i = 1; i < M.length; i++) { if (M[i].cutN > M[i - 1].cutN || !(M[i].dt > 0)) continue; const rr = Math.hypot(wrap(M[i].yaw - M[i - 1].yaw), M[i].pitch - M[i - 1].pitch) / M[i].dt * DEG; if (rr > maxT) maxT = rr; if (rr > 26.5) turnBad++; }
    // balón y los dos jugadores más cercanos al balón (los de r.pl con su altura en pantalla > 0) en NDC x > -0,3 si están en cuadro
    let lit = 0; for (const r of M) { if (!r.bin || r.bx > -0.3) lit++; }
    const litP = M.length ? lit / M.length : 0;
    add('menu', types.size >= 5 && near === 0 && short === 0 && turnBad === 0 && litP >= 0.9 && cuts.length >= 4, 'giro > 26,5°/s en ' + turnBad + ' · ' +
      (TT.length ? (TT[TT.length - 1].toFixed(0) + ' s · ' + types.size + ' tipos (' + [...types].join(',') + ') · ' + cuts.length + ' cortes · a ±0,3 s de un golpe ' + near + ' · cortos ' + short + ' · giro máx ' + maxT.toFixed(1) + '°/s · balón en la parte libre ' + (litP * 100).toFixed(0) + ' %') : 'sin menú'));
  }
  if (on('intro')) {
    const k0 = I.findIndex(r => r.shot === 'intro'); let k1 = k0; while (k1 >= 0 && k1 < I.length && I[k1].shot === 'intro') k1++;
    if (k0 < 0 || k1 >= I.length) add('intro', false, 'sin plano de presentación (' + I.length + ' frames)');
    else { const a = I[k1 - 1], b = I[k1], jump = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), cut = b.cutN > a.cutN;
      add('intro', jump < 0.1 && !cut && /^serve/.test(b.shot), 'presentación ' + (k1 - k0) + ' frames → ' + b.shot + ' · salto ' + jump.toFixed(3) + ' m' + (cut ? ' · CORTE ' + b.lck : '')); }
  }
  return res;
}
/** CLINCH (CAM-09): cierre de set desde debug=setpoint. */
function analyzeSetend(run) {
  const res = {}, F = run.R.filter(r => !r.err);
  if (!on('clinch')) return res;
  const i0 = F.findIndex(r => r.cl === 'hero'); let i1 = i0; while (i1 >= 0 && i1 < F.length && F[i1].cl === 'hero') i1++;
  const tr = F.some(r => r.cl === 'track' || r.cl === 'hold'), court = F.some(r => r.shot === 'court');
  let dur = 0; if (i0 >= 0) for (let k = i0 + 1; k < i1; k++) dur += F[k].dt;
  const bb = F.filter(r => r.brd === 1).length;
  res.clinch = { ok: i0 >= 0 && dur >= 1.8 && tr && court && bb === 0, info: ['cierre: ' + (tr ? 'seguimiento/espera' : 'SIN seguimiento') + ' · órbita del héroe ' + dur.toFixed(2) + ' s (>= 1,8) · grúa ' + (court ? 'sí' : 'NO') + ' · marcador cortado ' + bb] };
  return res;
}
/** FEEL (CAM-04). */
function analyzeFeel(run) {
  const res = {}, f = run.X && run.X.feel; if (!on('feel') || !f) return res;
  // (un frame lento del PC —otras pruebas a la vez— dentro de la congelación se descuenta: el juego la corta a su nominal + 2 frames)
  const hitch = f.maxGap > 2.5 * f.frame ? f.maxGap - f.frame : 0, tol = Math.max(20, 2 * f.frame + 2) + hitch;
  res.feel = { ok: Math.abs(f.zero - 60) <= tol && f.ease > 30 && f.ease < 240 && f.punch200 >= 0 && f.punch200 < 0.6, info: ['hit-stop ' + f.zero + ' ms con timeScale 0 (60 ±' + tol.toFixed(0) + (hitch ? ', con un frame lento del PC de ' + f.maxGap + ' ms' : '') + ') · vuelta ' + f.ease + ' ms (80 nominal; < 240) · punch de 3° a los 200 ms ' + f.punch200 + '° (< 0,6)'] };
  return res;
}


/* SELFTEST (CAM-20): cada regla rota a propósito con &camBreak=… debe hacer fallar a su comprobación (camtest sale 1). Cada caso es una
 * ejecución corta de esta misma herramienta con ONLY=<comprobación>. Sale 1 si alguna rotura NO se detecta. */
const BREAKS = [
  ['clinch', 'clinch', '1280x720', '7', 20, 'setend'], ['board', 'clinch', '1280x720', '7', 20, 'setend'],
  ['serve', 'serve', '1280x720', '7', 40, ''], ['cut', 'cuts', '1280x720', '7', 40, ''],
  ['block', 'block', '1280x720,844x390t', '7,12345', 75, ''], ['clutter', 'clutter', '844x390t', '12345,3', 75, ''],
  ['menu', 'menu', '1280x720', '7', 20, 'menu'], ['intro', 'intro', '1280x720', '7', 20, 'menu'], ['hitstop', 'feel', '1280x720', '7', 20, 'feel']];
async function selftest() {
  const { spawnSync } = require('child_process'), t0 = Date.now(); let missed = 0;
  for (const [brk, only, sizes, seeds, secs, extra] of BREAKS) {
    const env = Object.assign({}, process.env, { CAMBREAK: brk, ONLY: only, EXTRA_JOBS: extra, QUIET: '1' });
    const r = spawnSync(process.execPath, [__filename, String(secs), seeds, sizes], { env, encoding: 'utf8', timeout: 600000 });
    const caught = r.status === 1, line = (r.stdout || '').split('\n').filter(l => /FAIL/.test(l)).slice(0, 2).join(' / ');
    if (!caught) missed++;
    console.log((caught ? 'ok   ' : 'FAIL ') + ('camBreak=' + brk).padEnd(18) + (caught ? 'detectado por ' + only + ': ' + line.trim().slice(0, 150) : 'NO detectado (sale ' + r.status + ')'));
  }
  console.log('\nSELFTEST (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s): ' + (missed ? missed + ' roturas sin detectar' : 'todas las roturas detectadas'));
  process.exit(missed ? 1 : 0);
}
if (SELFTEST) { selftest(); } else
(async () => {
  const t0 = Date.now(), jobs = [];
  for (const s of SIZES) { for (const sd of SEEDS) jobs.push([s, sd, 'match']); for (const k of EXTRA_JOBS) if (wantJob(k)) jobs.push([s, SEEDS[0], k]); }
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [s, sd, kd] = jobs[next++];
      let run;
      // (tope por partida: un Chrome colgado no deja la prueba esperando para siempre)
      let tmo; const lim = SECS * 1000 / SPEED + 90000;
      try { run = await Promise.race([runOne(s, sd, kd), new Promise((_, rej) => { tmo = setTimeout(() => rej(new Error('partida colgada (> ' + (lim / 1000).toFixed(0) + ' s)')), lim); })]); }
      catch (e) { clearTimeout(tmo); results.push({ size: s, seed: sd, res: { run: { ok: false, info: [String(e && e.message || e)] } } });
        if (process.env.QUIET !== '1') console.log('\n== ' + s + ' semilla ' + sd + '\n  FAIL run      ' + (e && e.message || e)); continue; }
      clearTimeout(tmo);
      const res = kd === 'menu' ? analyzeMenu(run) : kd === 'setend' ? analyzeSetend(run) : kd === 'feel' ? analyzeFeel(run) : analyze(run);
      if (run.errors.length) res.pageErrors = { ok: false, info: run.errors.slice(0, 3) };
      if (process.env.LOG === '1') fs.writeFileSync(path.join(OUT, 'rec-' + s + '-' + sd + '.json'), JSON.stringify({ R: run.R, E: run.E }));
      results.push({ size: s, seed: sd, frames: run.R.length, res });
      if (process.env.QUIET !== '1') {
        console.log('\n== ' + s + (kd !== 'match' ? ' [' + kd + ']' : '') + ' semilla ' + sd + ' (' + run.R.length + ' frames, ' + run.R.reduce((a, r) => a + (r.dt || 0), 0).toFixed(0) + ' s reales de cámara)');
        for (const k of Object.keys(res)) console.log('  ' + (res[k].ok ? 'ok   ' : soft(k) ? 'info ' : 'FAIL ') + k.padEnd(9) + res[k].info.join(' · '));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAR, jobs.length) }, worker));
  // HERO agregado por tamaño (todas las semillas): >= 90 % de los planos de kill/ace/block bien
  for (const key of ['hero', 'follow', 'spiker']) {
    if (!on(key)) continue;
    const hBy = {};
    for (const r of results) { const h = r.res[key]; if (!h || h.n == null) continue; const o = hBy[r.size] = hBy[r.size] || [0, 0]; o[0] += h.okN; o[1] += h.n; }
    for (const sz of Object.keys(hBy)) {
      const [ok, n] = hBy[sz], good = n === 0 || ok / n >= 0.9;
      results.push({ size: sz, seed: 'todas', res: { [key + 'All']: { ok: good, info: [ok + '/' + n] } } });
      console.log('  ' + (good ? 'ok   ' : soft(key + 'All') ? 'info ' : 'FAIL ') + key + ' ' + sz + ' (todas las semillas): ' + ok + '/' + n + ' (' + (n ? (ok / n * 100).toFixed(0) : 100) + ' %)');
    }
  }
  let fails = 0; const sum = {};
  for (const r of results) for (const k of Object.keys(r.res)) { sum[k] = sum[k] || [0, 0]; sum[k][0]++; if (!r.res[k].ok) { sum[k][1]++; if (!soft(k)) fails++; } }
  console.log('\nRESUMEN (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s, ' + results.length + ' partidas, ×' + SPEED + ')');
  for (const k of Object.keys(sum)) console.log('  ' + (sum[k][1] ? (soft(k) ? 'info ' : 'FAIL ') : 'ok   ') + k.padEnd(9) + (sum[k][0] - sum[k][1]) + '/' + sum[k][0] + (soft(k) ? ' (informativa; STRICT2=1 la exige)' : ''));
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 1));
  console.log(fails ? 'FALLOS: ' + fails : 'TODO OK');
  process.exit(fails && process.env.STRICT !== '0' ? 1 : 0);
})();
