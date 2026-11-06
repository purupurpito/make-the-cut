#!/usr/bin/env node
/* VOLEY 3D — tools/eval.js  (owner: ui_main)
 * Abre index.html?<query> en Chrome headless, espera y evalúa una expresión JS en la página.
 * Uso: node tools/eval.js "<query>" "<expresión>" [espera_ms=5000] [WxH=640x360]
 * Ej.: node tools/eval.js "debug=rally" "JSON.stringify(VB.ctx.renderer.info.render)"
 */
'use strict';
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..'), Q = process.argv[2] || '', EXPR = process.argv[3] || 'VB.ctx.state';
const WAIT = +(process.argv[4] || 5000), SIZE = (process.argv[5] || '640x360').replace('x', ',');
const PORT = 9800 + Math.floor(Math.random() * 150), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vb3e-'));
const CH = require('./chrome.js'); // Chrome con GPU (GL=swiftshader para software)
const ch = CH.launch(prof, PORT, SIZE);
function killChrome() { CH.kill(ch); }
process.on('exit', killChrome); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, WAIT + 90000).unref();

const sleep = ms => new Promise(r => setTimeout(r, ms)); let ws, id = 0; const pend = new Map();
const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
(async () => {
  let code = 0;
  try {
    let t; for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(x => x.type === 'page'); } catch (e) { } }
    ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    await send('Page.navigate', { url: CH.pageUrl(ROOT, Q) }); await sleep(WAIT);
    const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
    if (r.result.exceptionDetails) { console.error(r.result.exceptionDetails.exception.description); code = 1; }
    else console.log(typeof r.result.result.value === 'string' ? r.result.result.value : JSON.stringify(r.result.result.value));
  } catch (e) { console.error(e); code = 1; }
  killChrome(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { }
  process.exit(code);
})();
