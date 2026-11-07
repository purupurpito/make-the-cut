#!/usr/bin/env node
/* Plano del CAMBIO DE CAMPO (camera.js 'court'): juega en vivo (autopilot) hasta el evento courtChange y graba
 * cada frame (plano, posición, giro/cabeceo, base de control) + capturas en momentos clave.
 * Uso: node tools/courttest.js [set|eight] [WxH=1280x720] [touch=0]   (de camera_input) */
'use strict';
const path = require('path'), fs = require('fs');
const CDP = require(path.join(__dirname, 'cdp.js'));
const MODE = process.argv[2] || 'set', SIZE = process.argv[3] || '1280x720', TOUCH = process.argv[4] === '1';
const OUT = path.join(__dirname, 'out', 'ci', 'shots', 'court-' + MODE + '-' + SIZE + (TOUCH ? '-t' : ''));
fs.mkdirSync(OUT, { recursive: true });
let fails = 0, oks = 0;
function check(name, cond, info) { if (cond) { oks++; console.log('  ok   ' + name); } else { fails++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); } }
const REC = `
window.__rec = []; window.__cc = null;
(function () {
  var v = null, last = performance.now();
  function f(now) {
    requestAnimationFrame(f);
    if (!window.VB || !VB.ctx || !VB.ctx.camera || !VB.CameraRig) return;
    if (!v) v = new VB.ctx.THREE.Vector3();
    var c = VB.ctx.camera; c.getWorldDirection(v);
    var g = VB.ctx.game, b = VB.CameraRig.getBasis(), d = VB.CameraRig.getDebug();
    var r = { t: now, dt: VB.ctx.realDt, shot: VB.CameraRig.getShot(), x: c.position.x, y: c.position.y, z: c.position.z,
              yaw: Math.atan2(v.z, v.x), pitch: Math.asin(Math.max(-1, Math.min(1, v.y))), fov: c.fov, mode: g && g.mode,
              bfx: b.fx, bfy: b.fy, ccU: d.ccU, st: VB.ctx.state };
    last = now; window.__rec.push(r); if (window.__rec.length > 6000) window.__rec.shift();
  }
  requestAnimationFrame(f);
})();
`;
(async () => {
  const page = await CDP.open({ size: SIZE, touch: TOUCH, init: REC });
  const E = s => page.evalJs(s);
  try {
    await page.navigate('debug=setpoint&live=1&seed=7');
    await CDP.sleep(2500);
    if (MODE === 'eight') await E(`(function(){var g=VB.ctx.game; g.setNo=3; g.sets=[1,1]; g.setScores=[[25,20],[20,25]]; g.score=[7,7]; g.setPoint=-1; return 1})()`);
    // esperar al plano 'court'
    let t0 = Date.now(), seen = false;
    while (Date.now() - t0 < 150000) {
      const s = await E('VB.CameraRig.getShot()');
      if (s === 'court') { seen = true; break; }
      await CDP.sleep(25);
    }
    check('aparece el plano court tras courtChange', seen);
    if (!seen) throw new Error('sin plano court');
    const tS = Date.now();
    const marks = [0, 500, 1000, 1500, 2000, 2400, 2900, 3500];
    for (const m of marks) {
      const wt = tS + m - Date.now(); if (wt > 0) await CDP.sleep(wt);
      const info = await E(`JSON.stringify([VB.CameraRig.getShot(), VB.ctx.game.mode, +VB.CameraRig.getDebug().ccU.toFixed(2)])`);
      await page.shot(path.join(OUT, String(m).padStart(4, '0') + '.png'));
      console.log('  captura +' + m + ' ms', info);
    }
    await CDP.sleep(1500);
    const rec = await E('window.__rec');
    // análisis: desde 1 s antes del court hasta el final
    const iC = rec.findIndex(r => r.shot === 'court');
    let iE = iC; while (iE < rec.length && rec[iE].shot === 'court') iE++;
    let iF = iE; while (iF < rec.length && rec[iF].t - rec[iE].t < 2200) iF++;
    const seg = rec.slice(Math.max(0, iC - 120), iF);
    const bad = [];
    let maxYawRate = 0, maxPitchRate = 0, maxMove = 0, cuts = [], prev = null, courtFrames = 0, courtDur = 0, afterServe = null;
    const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    for (const r of seg) {
      if (prev && r.dt > 0 && r.dt < 0.1) {
        const dyaw = Math.abs(wrap(r.yaw - prev.yaw)) / r.dt * 180 / Math.PI, dp = Math.abs(r.pitch - prev.pitch) / r.dt * 180 / Math.PI;
        const mv = Math.hypot(r.x - prev.x, r.y - prev.y, r.z - prev.z);
        if ((dyaw > 62 || dp > 62) && mv <= 2.5 && (r.shot === 'court' || prev.shot === 'court' || afterServe !== null)) bad.push([r.shot, +dyaw.toFixed(0), +dp.toFixed(0), +r.dt.toFixed(3), +r.ccU.toFixed(2)]);
        if (mv > 2.5) cuts.push({ from: prev.shot, to: r.shot, mv: +mv.toFixed(1) });
        else if (r.shot === 'court' || prev.shot === 'court' || (afterServe !== null && r.t - afterServe < 2500)) {
          maxYawRate = Math.max(maxYawRate, dyaw); maxPitchRate = Math.max(maxPitchRate, dp); maxMove = Math.max(maxMove, mv / r.dt);
        }
        if (prev.shot === 'court' && r.shot !== 'court') afterServe = r.t;
      }
      if (r.shot === 'court') { courtFrames++; courtDur += r.dt; }
      prev = r;
    }
    console.log('  court: ' + courtFrames + ' frames, ' + courtDur.toFixed(2) + ' s; giro máx ' + maxYawRate.toFixed(0) + '°/s, cabeceo máx ' + maxPitchRate.toFixed(0) + '°/s, velocidad máx ' + maxMove.toFixed(1) + ' m/s');
    console.log('  cortes', JSON.stringify(cuts));
    console.log('  frames > 62°/s', bad.length, JSON.stringify(bad.slice(0, 12)));
    check('dura >= 1,6 s', courtDur >= 1.6, courtDur);
    check('un único corte (reacción -> grúa); la vuelta al saque sin corte', cuts.filter(c => !(c.from === 'point' && c.to === 'point')).length <= 1 && cuts.every(c => c.to === 'court' || (c.from === 'point' && c.to === 'point')), cuts);
    check('giro y cabeceo <= 62°/s fuera de cortes (grúa + bajada al saque)', maxYawRate <= 62 && maxPitchRate <= 62, { maxYawRate, maxPitchRate });
    const last = rec[iF - 1];
    check('después: plano de saque', /^serve/.test(last.shot), last.shot);
    check('base de control tras el cambio = hacia la red (-1, 0) ±26°', last.bfx < -0.89 && Math.abs(last.bfy) < 0.44, { fx: last.bfx, fy: last.bfy });
    const during = rec.filter(r => r.shot === 'court');
    const b0 = during[0];
    check('base de control congelada durante la grúa', during.every(r => r.bfx === b0.bfx && r.bfy === b0.bfy));
    check('sin NaN', rec.every(r => r.x === r.x && r.yaw === r.yaw));
    if (page.errors.length) { console.log('ERRORES EN LA PÁGINA (pueden ser de otros módulos en edición):\n' + page.errors.slice(0, 4).join('\n')); fails++; }
  } catch (e) { fails++; console.log('EXCEPCIÓN', e && e.stack || e); }
  page.close();
  console.log((fails ? 'FALLOS: ' + fails : 'TODO OK') + ' (' + oks + ' ok)');
  process.exit(fails ? 1 : 0);
})();
