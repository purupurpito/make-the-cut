#!/usr/bin/env node
/* VOLEY 3D — tools/padplay.js (owner: ui_main)
 * Juega con un MANDO falso de mapeo estándar (W3C "standard"): se sustituye navigator.getGamepads con
 * Page.addScriptToEvaluateOnNewDocument (antes que el juego) y se mueven ejes y botones a lo largo del tiempo.
 * Comprueba: conexión (gamepadconnected) · menú con stick (elegir) y A/B (aceptar/volver), stick ←/→ cambia el nivel ·
 *   JUGAR → "Jugar ya" con el stick + A · saque (A lanza, A golpea) · stick hacia el balón · toques con A ·
 *   RB cambia de jugador · Start pausa y reanuda · Select silencia y vuelve a activar el sonido · glifos de mando en el HUD ·
 *   vibración pedida en los toques propios (vibrationActuator.playEffect) · desconexión sin errores.
 * Capturas en tools/out/padplay/. Sale con 1 si falla algo.
 * Uso: node tools/padplay.js [W=1280] [H=720] [segundos de juego=30] [toques mínimos=3]
 * PADID="<id del mando>" cambia el id del mando falso (UI-22: con un id de la familia PlayStation, p. ej.
 *   "DualSense Wireless Controller (Vendor: 054c Product: 0ce6)", los glifos esperados son ✕ ○ □ △ en vez de A B X Y).
 * GL=swiftshader para software (añade quality=low&maxdt=0.25).
 */
'use strict';
const fs = require('fs'), path = require('path');
const CDP = require('./cdp.js');
const W = +(process.argv[2] || 1280), H = +(process.argv[3] || 720), SECS = +(process.argv[4] || 30), MIN_TOUCHES = +(process.argv[5] || 3);
const SOFT = process.env.GL === 'swiftshader', EXTRA = SOFT ? 'quality=low&maxdt=0.25' : '';
const PADID = process.env.PADID || 'Mando virtual de pruebas (STANDARD GAMEPAD)';
const PS = !/xbox|045e/i.test(PADID) && /054c|dualsense|dualshock|wireless controller|playstation/i.test(PADID);
const GL_HIT = PS ? '✕' : 'A', GL_JUMP = PS ? '○' : 'B';
const OUT = path.join(__dirname, 'out', 'padplay');
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, (SECS + 150) * 1000).unref();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Mando virtual: el estado lo escribe el script (window.__pad.set/press); getGamepads() devuelve una instantánea
// con la forma de un Gamepad real (id, index, connected, mapping 'standard', timestamp, axes, buttons, vibrationActuator).
const PAD = `(function(){
  var S = { on: false, axes: [0, 0, 0, 0], btn: [], t: 0, rumble: 0 };
  for (var i = 0; i < 17; i++) S.btn.push(0);
  var act = { type: 'dual-rumble', playEffect: function () { S.rumble++; return Promise.resolve('complete'); }, reset: function () { return Promise.resolve('complete'); } };
  function snap() {
    var b = []; for (var i = 0; i < 17; i++) b.push({ pressed: S.btn[i] > 0.5, touched: S.btn[i] > 0, value: S.btn[i] });
    return { id: __PADID__, index: 0, connected: S.on, mapping: 'standard', timestamp: S.t, axes: S.axes.slice(), buttons: b, vibrationActuator: act, hapticActuators: [] };
  }
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: function () { return [S.on ? snap() : null, null, null, null]; } }); } catch (e) { }
  function fire(type) { var ev = new Event(type); try { Object.defineProperty(ev, 'gamepad', { value: snap() }); } catch (e) { } window.dispatchEvent(ev); }
  window.__pad = {
    connect: function () { S.on = true; S.t = performance.now(); fire('gamepadconnected'); },
    disconnect: function () { S.on = false; fire('gamepaddisconnected'); },
    set: function (axes, btns) { if (axes) for (var i = 0; i < axes.length; i++) S.axes[i] = axes[i]; if (btns) for (var k in btns) S.btn[+k] = btns[k]; S.t = performance.now(); },
    rumbles: function () { return S.rumble; }
  };
})();`;
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

(async () => {
  let fail = 0, step = 0, page;
  const check = (c, m) => { if (!c) { fail++; console.error('FALLO:', m); } else console.log('ok:', m); return !!c; };
  fs.mkdirSync(OUT, { recursive: true });
  try {
    page = await CDP.open({ size: W + 'x' + H, init: [PAD.replace('__PADID__', JSON.stringify(PADID))] });
    const { evalJs } = page;
    const shot = async n => page.shot(path.join(OUT, String(++step).padStart(2, '0') + '-' + n + '.png'));
    const waitFor = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(80); } return false; };
    // pulsación: se mantiene ~5 frames (main lee el flanco en Input.poll del siguiente frame)
    const press = async (b, ms) => { await evalJs(`__pad.set(null,{${BTN[b]}:1})`); await sleep(ms || 90); await evalJs(`__pad.set(null,{${BTN[b]}:0})`); await sleep(60); };
    const stick = async (x, y, ms) => { await evalJs(`__pad.set([${x},${y}])`); if (ms) { await sleep(ms); await evalJs('__pad.set([0,0])'); await sleep(80); } };
    const focused = () => evalJs('(document.activeElement&&document.activeElement.id)||""');

    await page.navigate(EXTRA);
    await sleep(2500);
    check(await evalJs("VB.ctx.state==='menu'"), 'arranca en el menú');
    await evalJs('__pad.connect()'); await sleep(300);
    const info = await evalJs('VB.Input.padInfo?JSON.stringify(VB.Input.padInfo()):"(sin padInfo)"');
    console.log('mando:', info);
    // cualquier entrada del mando lo convierte en el dispositivo activo
    await stick(0, 0.9, 120);
    check(await waitFor("VB.ctx.inputDevice==='gamepad'", 1500), 'el mando pasa a ser el dispositivo activo');
    // ---- menú: stick abajo/arriba elige, ←/→ cambia valor, A acepta, B vuelve
    await stick(0, 0, 0); await sleep(200);
    let f0 = await focused();
    for (let i = 0; i < 6 && f0 !== 'btnPlay'; i++) { await stick(0, -0.95, 110); f0 = await focused(); }
    check(f0 === 'btnPlay', 'el stick lleva el foco a JUGAR (' + f0 + ')');
    await stick(0, 0.95, 110);
    const f1 = await focused();
    check(f1 === 'optDiff', 'stick abajo → NIVEL (' + f1 + ')');
    const nh = await evalJs("(document.getElementById('navHint')||{}).textContent||''");
    check(/Stick/.test(nh) && /aceptar/.test(nh), 'la ayuda del menú muestra los botones del mando (' + nh.trim().slice(0, 50) + ')');
    const d0 = await evalJs('VB.ctx.settings.difficulty');
    await stick(0.95, 0, 110);
    const d1 = await evalJs('VB.ctx.settings.difficulty');
    check(d1 !== d0, 'stick → cambia el nivel (' + d0 + ' → ' + d1 + ')');
    for (let i = 0; i < 5 && (await evalJs('VB.ctx.settings.difficulty')) !== 'easy'; i++) await stick(-0.95, 0, 110);
    await shot('menu');
    // Ajustes con A y vuelta con B
    let fs_ = await focused();
    for (let i = 0; i < 8 && fs_ !== 'btnSettings'; i++) { await stick(0, 0.95, 110); fs_ = await focused(); }
    await press('A'); await sleep(350);
    check(await evalJs("VB.UI.isPanelOpen()&&!document.getElementById('pnSet').hidden"), 'A en AJUSTES abre el panel');
    await shot('ajustes');
    await press('B'); await sleep(350);
    check(await evalJs("!VB.UI.isPanelOpen()&&!document.getElementById('menu').hidden"), 'B cierra el panel');
    // JUGAR
    let fp = await focused();
    for (let i = 0; i < 8 && fp !== 'btnPlay'; i++) { await stick(0, -0.95, 110); fp = await focused(); }
    await press('A'); await sleep(450);
    if (await evalJs("!document.getElementById('pnFirst').hidden")) {
      let ff = await focused();
      for (let i = 0; i < 4 && ff !== 'btnFirstPlay'; i++) { await stick(0, 0.95, 110); ff = await focused(); }
      check(ff === 'btnFirstPlay', 'primer partido: stick hasta "Jugar ya"');
      await press('A');
    }
    check(await waitFor("VB.ctx.state==='playing'", 5000), 'A en JUGAR empieza el partido');
    await evalJs(`(function(){var T=window.__pp={hits:0,serves:0,tosses:0,swManual:0,points:0,rally:0};var o=VB.Sim.step;VB.Sim.step=function(g,dt,i){var n=g.events.length;o(g,dt,i);
      for(var k=n;k<g.events.length;k++){var e=g.events[k];if(e.type==='hit'&&e.human){T.hits++;if(e.kind==='serve')T.serves++;}if(e.type==='toss'&&e.human)T.tosses++;
      if(e.type==='switch'&&!e.auto)T.swManual++;if(e.type==='point')T.points++;}T.rally=g.mode==='rally'&&g.rally?g.rally.hits:0;};})()`);
    await sleep(500);
    // ---- saque: A lanza, A golpea cuando el balón llega a la mano
    async function serve() {
      if (!(await waitFor("(function(g){return g.mode!=='serve'||g.serveAuth})(VB.ctx.game)", 5000))) return 'sinsilbato';
      if (!(await evalJs("(function(g){return g.mode==='serve'&&g.server&&g.server.team===0&&g.serveState==='ready'})(VB.ctx.game)"))) return 'nosaque';
      await press('A', 60);
      const t0 = Date.now();
      while (Date.now() - t0 < 2600) {
        const t = await evalJs("(function(g){if(g.mode!=='serve'||g.serveState!=='toss')return -9;var w=VB.Sim.hitWindow(g,g.server);return w?w.t/Math.max(0.05,VB.ctx.timeScale):-9})(VB.ctx.game)");
        if (t === -9 || t == null) break;
        if (t > 0.22) { await sleep(50); continue; }
        await sleep(Math.max(0, t * 1000 - 40)); await press('A', 60); return 'ok';
      }
      return 'sintiempo';
    }
    let sv = 'nosaque';
    for (let i = 0; i < 3 && sv === 'nosaque'; i++) { sv = await serve(); if (sv === 'nosaque') await sleep(400); }
    await sleep(400);
    let pp = JSON.parse(await evalJs('JSON.stringify(__pp)'));
    check(pp.tosses >= 1 && pp.serves >= 1, 'saque con A: lanza y golpea (' + sv + ', toss ' + pp.tosses + ', saques ' + pp.serves + ')');
    const pk = await evalJs("(document.getElementById('promptKey')||{}).textContent||''");
    await shot('saque');
    // ---- juego: stick hacia el balón, A en el momento, RB para cambiar
    let samples = 0, toward = 0, rbTried = 0, lastRb = 0; const glyphs = {};
    const t0 = Date.now();
    // un peloteo largo (bot contra la CPU) puede llenar los SECS sin un solo punto: se alarga hasta 25 s más mientras no haya punto
    let ptsSeen = 0, ptsAt = 0;
    while (Date.now() - t0 < SECS * 1000 || (!ptsSeen && Date.now() - t0 < (SECS + 25) * 1000)) {
      if (!ptsSeen && Date.now() - ptsAt > 1000) { ptsAt = Date.now(); ptsSeen = +(await evalJs('__pp.points')) || 0; }
      const s = await evalJs(`(function(){var g=VB.ctx.game,p=g.ctrl;if(VB.ctx.state!=='playing')return {st:1};
        if(g.mode==='serve')return {serve:1};if(g.mode!=='rally')return {idle:1};
        var f=VB.Sim.focusPoint(g),b=VB.CameraRig.getBasis(),dx=f.x+0.2-p.x,dy=f.y-p.y,d=Math.hypot(dx,dy);
        var sx=dx*b.rx+dy*b.ry,sy=dx*b.fx+dy*b.fy,l=Math.hypot(sx,sy)||1,w=VB.Sim.hitWindow(g,p),ts=Math.max(0.05,VB.ctx.timeScale);
        var sp=Math.hypot(p.vx||0,p.vy||0),dot=sp>0.2?((p.vx||0)*dx+(p.vy||0)*dy)/(sp*(d||1)):0;
        var pk=document.getElementById('promptKey'),pr=document.getElementById('prompt');
        return {d:d,ax:sx/l,ay:-sy/l,dot:dot,w:w&&w.canReach&&!w.active&&w.t>0?w.press/ts:9,rec:VB.Sim.canReach(g,p),
          glyph:pr&&!pr.classList.contains('off')?pk.textContent:''}})()`);
      if (s.st || s.idle) { await stick(0, 0); await sleep(120); continue; }
      if (s.serve) { await stick(0, 0); const r = await serve(); if (r !== 'ok') await sleep(200); continue; }
      if (s.glyph) { glyphs[s.glyph] = (glyphs[s.glyph] || 0) + 1; }
      if (s.d > 0.35) { const k = Math.min(1, 0.5 + s.d * 0.3); await stick(s.ax * k, s.ay * k); samples++; if (s.dot > 0.3 || s.d < 0.6) toward++; }
      else await stick(0, 0);
      if (s.w < 0.09 && s.w > -0.05) { await press('A', 50); }
      if (Date.now() - lastRb > 8000 && !s.rec && s.d > 3) { lastRb = Date.now(); await press('RB', 60); rbTried++; }
      await sleep(20);
    }
    await stick(0, 0);
    pp = JSON.parse(await evalJs('JSON.stringify(__pp)'));
    const rum = await evalJs('__pad.rumbles()');
    console.log('juego: toques humanos', pp.hits, '· saques', pp.serves, '· cambios RB', pp.swManual, '(intentos ' + rbTried + ') · puntos', pp.points,
      '· hacia el balón', samples ? Math.round(toward / samples * 100) + '%' : '-', '· vibraciones', rum, '· glifos del aviso', JSON.stringify(glyphs));
    check(samples > 20 && toward / samples >= 0.5, 'el stick lleva al jugador hacia el balón (' + toward + '/' + samples + ')');
    check(pp.hits - pp.serves >= MIN_TOUCHES, 'al menos ' + MIN_TOUCHES + ' toques humanos con A (' + (pp.hits - pp.serves) + ')');
    // un peloteo vivo muy largo (bot preciso contra la CPU) también demuestra que se juega: cuenta si lleva >= 20 toques
    check(pp.points >= 1 || pp.rally >= 20, 'se juegan puntos (' + pp.points + (pp.points ? '' : ', peloteo en curso de ' + pp.rally + ' toques') + ')');
    check(rbTried === 0 || pp.swManual >= 1, 'RB cambia de jugador');
    check(rum > 0, 'el mando vibra en los toques propios (' + rum + ' efectos)');
    const gk = Object.keys(glyphs);
    check(gk.length > 0 && gk.every(k => k === GL_HIT || k === GL_JUMP || k === ''), 'los avisos del HUD usan los glifos del mando ' + (PS ? 'PlayStation ✕ ○' : 'A B') + ' (' + (gk.join(',') || pk) + ')');
    await shot('juego');
    // ---- Start pausa / reanuda
    await waitFor("VB.ctx.state==='playing'", 3000);
    await press('START');
    check(await waitFor("VB.ctx.state==='paused'", 2000), 'Start pausa');
    await sleep(300); await shot('pausa');
    // UI-22: el panel de controles enseña los glifos del mando conectado (abierto desde la pausa)
    const ctl = await evalJs("(function(){document.getElementById('btnPControls').click();var r=document.getElementById('ctlGrid').textContent;var on=(document.querySelector('.ctl-tab.on')||{}).getAttribute?document.querySelector('.ctl-tab.on').getAttribute('data-ctl'):'';VB.UI.back();return JSON.stringify({on:on,txt:r})})()");
    const cj = JSON.parse(ctl);
    check(cj.on === 'gamepad' && cj.txt.indexOf(GL_HIT) >= 0 && (PS ? cj.txt.indexOf('A') < 0 || !/A/.test(cj.txt) : true), 'el panel de controles abre en Mando con ' + GL_HIT + ' (' + cj.txt.slice(0, 60) + '…)');
    await sleep(200);
    const fpz = await focused();
    check(/btnResume|btnP|btnRestart|btnQuit/.test(fpz), 'en la pausa hay foco para el mando (' + fpz + ')');
    await press('START');
    check(await waitFor("VB.ctx.state==='playing'", 2000), 'Start reanuda');
    // B en la pausa también vuelve al juego
    await press('START'); await waitFor("VB.ctx.state==='paused'", 2000); await press('B');
    check(await waitFor("VB.ctx.state==='playing'", 2000), 'B en la pausa reanuda');
    // ---- Select silencia y vuelve a activar el sonido
    const m0 = await evalJs('VB.ctx.settings.muted');
    await press('SELECT'); await sleep(150);
    const m1 = await evalJs('VB.ctx.settings.muted');
    await press('SELECT'); await sleep(150);
    const m2 = await evalJs('VB.ctx.settings.muted');
    check(m1 === !m0 && m2 === m0, 'Select silencia y reactiva el sonido (' + m0 + ' → ' + m1 + ' → ' + m2 + ')');
    // ---- desconexión: jugando CON el mando, el partido se pausa (input.js) y el teclado sigue sirviendo
    await evalJs('__pad.disconnect()'); await sleep(400);
    check(await evalJs("VB.ctx.state==='paused'"), 'desconectar el mando en pleno partido lo pausa');
    await shot('mando-desconectado');
    const kick = await evalJs("(document.querySelector('#pause .sh-k')||{}).textContent||''");
    check(/mando desconectado/i.test(kick), 'la pausa dice "Mando desconectado" (' + kick + ')');
    const dv = await evalJs("JSON.stringify({d:VB.ctx.inputDevice,c:VB.Input.padInfo().connected})");
    check(/"d":"(keyboard|touch)","c":false/.test(dv), 'tras desconectar, el dispositivo activo deja de ser el mando (' + dv + ')');
    await evalJs('__pad.connect()'); await sleep(250); await press('START');
    check(await waitFor("VB.ctx.state==='playing'", 2000), 'al reconectar, Start reanuda');
    check(await evalJs("VB.ctx.inputDevice==='gamepad'||VB.Input.padInfo().connected"), 'el mando reconectado vuelve a ser el activo');
  } catch (e) { fail++; console.error('ERROR del driver:', e && e.stack || e); }
  if (page && page.errors.length) { fail++; console.error('ERRORES EN LA PÁGINA:\n' + page.errors.slice(0, 8).join('\n')); }
  else console.log('sin errores de página');
  console.log('capturas en', OUT);
  if (page) page.close();
  console.log(fail ? fail + ' FALLOS' : 'TODO OK');
  process.exit(fail ? 1 : 0);
})();
