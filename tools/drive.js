#!/usr/bin/env node
/* VOLEY 3D — tools/drive.js  (owner: ui_main)
 * Conduce el juego REAL en Chrome headless vía DevTools Protocol (sin dependencias:
 * usa el WebSocket nativo de node >= 22) y simula a un jugador con teclado:
 * menú -> Intro -> saque con Espacio -> moverse/golpear -> pausa -> seguir.
 * Captura errores de consola/excepciones y hace capturas en tools/out/drive-*.png.
 * Uso: node tools/drive.js [W=960] [H=540] [segundos reales=40] [query extra, por defecto "quality=low&maxdt=0.25"]
 * Sale con 1 si hay excepciones o el flujo no avanza.
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out');
const W = +(process.argv[2] || 960), H = +(process.argv[3] || 540), SECS = +(process.argv[4] || 40), EXTRA = process.argv[5] || 'quality=low&maxdt=0.25';
const PORT = 9300 + Math.floor(Math.random() * 500);
fs.mkdirSync(OUT, { recursive: true });
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vb3d-'));
const CH = require('./chrome.js'); // Chrome con GPU (GL=swiftshader para software)
const chrome = CH.launch(prof, PORT, W + ',' + H);
function killChrome() { CH.kill(chrome); }
process.on('exit', killChrome); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, (SECS + 120) * 1000).unref();

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(), errors = [], logs = [];
function send(method, params) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
}
async function evalJs(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result && r.result.value; }
const KEYS = { ' ': ['Space', 32], Enter: ['Enter', 13], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], p: ['KeyP', 80], k: ['KeyK', 75], c: ['KeyC', 67] };
async function key(type, k) { const [code, kc] = KEYS[k]; await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: kc, text: type === 'keyDown' && k.length === 1 ? k : undefined }); }
async function press(k, ms) { await key('keyDown', k); await sleep(ms || 60); await key('keyUp', k); }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, 'drive-' + name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('captura', f); }
async function waitFor(expr, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(150); } return false; }
const state = () => evalJs('JSON.stringify({s:VB.ctx.state,m:VB.ctx.game&&VB.ctx.game.mode,sc:VB.ctx.game&&VB.ctx.game.score,sets:VB.ctx.game&&VB.ctx.game.sets,demo:VB.ctx.game&&VB.ctx.game.demo,fps:VB.ctx.fps,q:VB.ctx.quality&&VB.ctx.quality.level})').then(JSON.parse);

(async () => {
  let fail = 0; const check = (c, m) => { if (!c) { fail++; console.error('FALLO:', m); } else console.log('ok:', m); };
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e) { }
    }
    if (!target) throw new Error('Chrome no arranca');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled') {
        const txt = m.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
        logs.push(m.params.type + ': ' + txt);
        if (m.params.type === 'error' || /\[VB\]\[ERROR\]/.test(txt)) errors.push(txt);
      }
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: CH.pageUrl(ROOT, EXTRA) });
    await sleep(3000);
    let st = await state(); check(st.s === 'menu' && st.demo, 'arranca en el menú con demo detrás (' + JSON.stringify(st) + ')');
    await shot('1-menu');
    await press('Enter'); await waitFor("VB.ctx.state==='playing'", 8000);
    st = await state(); console.log('tras Intro', JSON.stringify(st), await evalJs('document.activeElement && document.activeElement.id')); check(st.s === 'playing' && !st.demo && st.m === 'serve', 'Intro empieza el partido con saque humano');
    await press('ArrowLeft', 300);
    await shot('2-saque');
    await press(' '); await waitFor("VB.ctx.game.mode!=='serve'", 8000);
    st = await state();
    const tA = await evalJs('VB.ctx.game.time'), fA = await evalJs('VB.ctx.frame'); await sleep(2000);
    const tB = await evalJs('VB.ctx.game.time'), fB = await evalJs('VB.ctx.frame');
    console.log('en 2 s reales: tiempo de juego', (tB - tA).toFixed(2) + ' s,', ((fB - fA) / 2).toFixed(1) + ' fps (SwiftShader es lento; usar maxdt=0.25)'); check(st.m === 'rally', 'Espacio saca (modo rally)');
    // jugar: perseguir el punto de caída con las flechas y golpear a menudo
    const t0 = Date.now(); let points = 0, lastSc = '0-0', hits = 0;
    await evalJs('window.__hits=0;window.__pts=0;(function(){var o=VB.Sim.step;VB.Sim.step=function(g,dt,i){var n=g.events.length;o(g,dt,i);for(var k=n;k<g.events.length;k++){var e=g.events[k];if(e.type==="hit"&&e.human)window.__hits++;if(e.type==="point")window.__pts++;}};})()');
    while (Date.now() - t0 < SECS * 1000) {
      // dirección hacia el foco (en coordenadas de cámara) calculada en la página
      const dir = await evalJs(`(function(){var g=VB.ctx.game,p=g.ctrl,f=VB.Sim.focusPoint(g),b=VB.CameraRig.getBasis();
        if(g.mode==='serve') return 'serve';
        var dx=f.x+0.2-p.x,dy=f.y-p.y; var sx=dx*b.rx+dy*b.ry, sy=dx*b.fx+dy*b.fy; var l=Math.hypot(sx,sy);
        if(l<0.25) return 'none'; return Math.abs(sx)>Math.abs(sy)?(sx>0?'ArrowRight':'ArrowLeft'):(sy>0?'ArrowUp':'ArrowDown');})()`);
      if (dir === 'serve') { await press(' '); await sleep(250); continue; }
      if (dir !== 'none') await press(dir, 90);
      await press(' ', 30);
      if (Math.random() < 0.05) await press('k', 30);
    }
    hits = await evalJs('window.__hits'); points = await evalJs('window.__pts');
    st = await state(); console.log('estado', JSON.stringify(st), 'toques humanos', hits, 'puntos', points);
    check(points > 0, 'se juegan puntos');
    check(hits > 0, 'el humano llega a tocar el balón');
    await shot('3-juego');
    await press('p'); await waitFor("VB.ctx.state==='paused'", 8000);
    st = await state(); check(st.s === 'paused', 'P pausa');
    await shot('4-pausa');
    await press('p'); await waitFor("VB.ctx.state==='playing'", 8000);
    st = await state(); check(st.s === 'playing', 'P reanuda');
  } catch (e) { fail++; console.error('ERROR del driver:', e); }
  if (errors.length) { fail++; console.error('ERRORES EN LA PÁGINA:\n' + errors.slice(0, 10).join('\n')); }
  else console.log('sin errores de página');
  try { ws && ws.close(); } catch (e) { }
  killChrome(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { }
  console.log(fail ? fail + ' FALLOS' : 'TODO OK');
  process.exit(fail ? 1 : 0);
})();
