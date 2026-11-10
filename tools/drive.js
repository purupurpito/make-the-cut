#!/usr/bin/env node
/* VOLEY 3D — tools/drive.js  (owner: ui_main)
 * Conduce el juego REAL en Chrome headless vía DevTools Protocol (sin dependencias:
 * usa el WebSocket nativo de node >= 22) y simula a un jugador con teclado:
 * menú -> Intro -> saque (silbato, J lanza, J golpea) -> moverse/golpear (J o clic izquierdo; Espacio salta) ->
 * colocación en salto (tools/jsetdrill.js: Espacio y, en el aire, K; luego clic derecho y clic central) -> pausa -> seguir.
 * Captura errores de consola/excepciones y hace capturas en tools/out/drive-*.png.
 * Uso: node tools/drive.js [W=1280] [H=720] [segundos reales=40] [query extra, p. ej. "quality=low"]
 * Con GPU no hace falta nada más; con GL=swiftshader (sin GPU) conviene pasar "quality=low&maxdt=0.25".
 * Sale con 1 si hay excepciones o el flujo no avanza.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out');
const SOFT = process.env.GL === 'swiftshader';
const W = +(process.argv[2] || 1280), H = +(process.argv[3] || 720), SECS = +(process.argv[4] || 40);
const EXTRA = process.argv[5] != null ? process.argv[5] : (SOFT ? 'quality=low&maxdt=0.25' : '');
fs.mkdirSync(OUT, { recursive: true });
const CDP = require('./cdp.js'); // Chrome con GPU y viewport exacto (GL=swiftshader para software)
let page = null;
function killChrome() { if (page) page.close(); }
process.on('exit', killChrome); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, (SECS + 120) * 1000).unref();

const sleep = ms => new Promise(r => setTimeout(r, ms));
let send, errors = [], logs = [];
async function evalJs(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result && r.result.value; }
const KEYS = { ' ': ['Space', 32], Enter: ['Enter', 13], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], p: ['KeyP', 80], j: ['KeyJ', 74], c: ['KeyC', 67], k: ['KeyK', 75] };
async function key(type, k) { const [code, kc] = KEYS[k]; await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: kc, text: type === 'keyDown' && k.length === 1 ? k : undefined }); }
async function press(k, ms) { await key('keyDown', k); await sleep(ms || 60); await key('keyUp', k); }
// clic izquierdo (golpear) en el centro de la pista, como un ratón de verdad (pointerType 'mouse')
async function click(ms) {
  const o = { x: Math.round(W / 2), y: Math.round(H * 0.55), button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed', buttons: 1 }, o)); await sleep(ms || 40);
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased', buttons: 0 }, o));
}
// botón del ratón (pointerType 'mouse'): 'middle' = COLOCAR (rueda), 'right' = saltar
async function mclick(button, ms) {
  const o = { x: Math.round(W / 2), y: Math.round(H * 0.55), button, clickCount: 1 }, bits = button === 'middle' ? 4 : button === 'right' ? 2 : 1;
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed', buttons: bits }, o)); await sleep(ms || 40);
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased', buttons: 0 }, o));
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, 'drive-' + name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('captura', f); }
async function waitFor(expr, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(150); } return false; }
// Saque humano en dos pulsaciones: espera el silbato, J lanza y J golpea en el momento ideal
// (VB.Sim.hitWindow da los segundos que faltan). Devuelve 'ok' | 'nosaque' (no era saque humano).
async function serve() {
  if (!(await waitFor("(function(g){return g.mode!=='serve'||g.serveAuth})(VB.ctx.game)", 4000))) return 'sinsilbato';
  if (!(await evalJs("(function(g){return g.mode==='serve'&&g.server&&g.server.team===0&&g.serveState==='ready'})(VB.ctx.game)"))) return 'nosaque';
  await press('j', 40);
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    const t = await evalJs("(function(g){if(g.mode!=='serve'||g.serveState!=='toss')return -9;var w=VB.Sim.hitWindow(g,g.server);return w?w.t/Math.max(0.05,VB.ctx.timeScale):-9})(VB.ctx.game)");
    if (t === -9 || t == null) break;
    if (t > 0.25) { await sleep(80); continue; }
    await sleep(Math.max(0, t * 1000 - 25)); await press('j', 40); return 'ok';
  }
  return 'ok';
}
const state = () => evalJs('JSON.stringify({s:VB.ctx.state,m:VB.ctx.game&&VB.ctx.game.mode,sc:VB.ctx.game&&VB.ctx.game.score,sets:VB.ctx.game&&VB.ctx.game.sets,demo:VB.ctx.game&&VB.ctx.game.demo,fps:VB.ctx.fps,q:VB.ctx.quality&&VB.ctx.quality.level})').then(JSON.parse);

(async () => {
  let fail = 0; const check = (c, m) => { if (!c) { fail++; console.error('FALLO:', m); } else console.log('ok:', m); };
  try {
    page = await CDP.open({ size: W + 'x' + H }); send = page.send; errors = page.errors; logs = page.logs;
    await page.navigate(EXTRA);
    await sleep(3000);
    let st = await state(); check(st.s === 'menu' && st.demo, 'arranca en el menú con demo detrás (' + JSON.stringify(st) + ')');
    await shot('1-menu');
    await press('Enter');
    // perfil nuevo: la primera vez JUGAR ofrece "Ver cómo se juega" / "Jugar ya" (foco en el tutorial)
    await sleep(500);
    if (await evalJs("VB.UI.isPanelOpen&&VB.UI.isPanelOpen()")) {
      check(await evalJs("!document.getElementById('pnFirst').hidden"), 'primer partido: aparece la elección tutorial / jugar ya');
      await press('ArrowDown'); await sleep(150); await press('Enter');
    }
    await waitFor("VB.ctx.state==='playing'", 8000);
    st = await state(); console.log('tras Intro', JSON.stringify(st), await evalJs('document.activeElement && document.activeElement.id')); check(st.s === 'playing' && !st.demo && st.m === 'serve', 'Intro empieza el partido con saque humano');
    await press('ArrowLeft', 300);
    await shot('2-saque');
    const sv = await serve(); console.log('saque:', sv);
    await waitFor("VB.ctx.game.mode!=='serve'", 8000);
    st = await state();
    const tA = await evalJs('VB.ctx.game.time'), fA = await evalJs('VB.ctx.frame'); await sleep(2000);
    const tB = await evalJs('VB.ctx.game.time'), fB = await evalJs('VB.ctx.frame');
    console.log('en 2 s reales: tiempo de juego', (tB - tA).toFixed(2) + ' s,', ((fB - fA) / 2).toFixed(1) + ' fps'); check(st.m === 'rally', 'J lanza y J saca (modo rally)');
    // jugar: perseguir el punto de caída con las flechas y golpear a menudo
    const t0 = Date.now(); let points = 0, lastSc = '0-0', hits = 0;
    await evalJs('window.__hits=0;window.__pts=0;(function(){var o=VB.Sim.step;VB.Sim.step=function(g,dt,i){var n=g.events.length;o(g,dt,i);for(var k=n;k<g.events.length;k++){var e=g.events[k];if(e.type==="hit"&&e.human)window.__hits++;if(e.type==="point")window.__pts++;}};})()');
    while (Date.now() - t0 < SECS * 1000) {
      // dirección hacia el foco (en coordenadas de cámara) calculada en la página
      const dir = await evalJs(`(function(){var g=VB.ctx.game,p=g.ctrl,f=VB.Sim.focusPoint(g),b=VB.CameraRig.getBasis();
        if(g.mode==='serve') return 'serve';
        var dx=f.x+0.2-p.x,dy=f.y-p.y; var sx=dx*b.rx+dy*b.ry, sy=dx*b.fx+dy*b.fy; var l=Math.hypot(sx,sy);
        if(l<0.25) return 'none'; return Math.abs(sx)>Math.abs(sy)?(sx>0?'ArrowRight':'ArrowLeft'):(sy>0?'ArrowUp':'ArrowDown');})()`);
      if (dir === 'serve') { if ((await serve()) !== 'ok') await sleep(200); continue; }
      if (dir !== 'none') await press(dir, 90);
      if (Math.random() < 0.5) await press('j', 30); else await click(30);   // golpear: tecla o clic izquierdo
      if (Math.random() < 0.05) await press(' ', 30);                        // Espacio salta
    }
    hits = await evalJs('window.__hits'); points = await evalJs('window.__pts');
    st = await state(); console.log('estado', JSON.stringify(st), 'toques humanos', hits, 'puntos', points);
    check(points > 0, 'se juegan puntos');
    check(hits > 0, 'el humano llega a tocar el balón');
    const mclk = await evalJs('VB.Input._debug().stats.mouse.hit');
    check(mclk > 0, 'el clic izquierdo en la pista cuenta como golpear (' + mclk + ' clics)');
    await shot('3-juego');
    // colocación en salto: teclado (Espacio + K en el aire) y ratón (clic derecho + clic central en el aire)
    const drill = require('./jsetdrill.js');
    const shotSet = async () => { const r = await send('Page.captureScreenshot', { format: 'png' }); const d = path.join(OUT, 'colocar'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'drive-' + W + 'x' + H + '-aviso.png'), Buffer.from(r.data, 'base64')); };
    let shotDone = false;
    const dk = await drill(evalJs, { jump: () => press(' ', 30), set: () => press('k', 30), serve, beforeSet: async (s) => { if (!shotDone && s.two) { shotDone = true; await shotSet(); } } }, { tries: 4, stopAfter: 2 });
    console.log('colocación en salto (teclado):', JSON.stringify(dk));
    check(dk.jsets >= 1, 'Espacio y K en el aire: colocación en salto (' + dk.jsets + '/' + dk.tries + ', remates del compañero ' + dk.spikes + ')');
    check(dk.prompt >= 1, 'en el aire el aviso ofrece las dos opciones (Rematar / Colocar)');
    const dm = await drill(evalJs, { jump: () => mclick('right', 30), set: () => mclick('middle', 30), serve }, { tries: 4, stopAfter: 1 });
    console.log('colocación en salto (ratón):', JSON.stringify(dm));
    check(dm.jsets >= 1 && (await evalJs('VB.Input._debug().stats.mouse.jset')) > 0, 'clic derecho y clic central en el aire: colocación en salto (' + dm.jsets + '/' + dm.tries + ')');
    await press('p'); await waitFor("VB.ctx.state==='paused'", 8000);
    st = await state(); check(st.s === 'paused', 'P pausa');
    await shot('4-pausa');
    await press('p'); await waitFor("VB.ctx.state==='playing'", 8000);
    st = await state(); check(st.s === 'playing', 'P reanuda');
  } catch (e) { fail++; console.error('ERROR del driver:', e); }
  if (errors.length) { fail++; console.error('ERRORES EN LA PÁGINA:\n' + errors.slice(0, 10).join('\n')); }
  else console.log('sin errores de página');
  killChrome();
  console.log(fail ? fail + ' FALLOS' : 'TODO OK');
  process.exit(fail ? 1 : 0);
})();
