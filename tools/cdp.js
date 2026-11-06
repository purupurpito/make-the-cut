/* VOLEY 3D — tools/cdp.js (owner: ui_main)
 * Cliente mínimo del DevTools Protocol para las herramientas (sin dependencias: WebSocket nativo de node >= 22).
 * - open({ size:'1280x720', touch:false }) lanza Chrome headless (GPU real; GL=swiftshader para software),
 *   se conecta a la pestaña y fija el VIEWPORT EXACTO con Emulation.setDeviceMetricsOverride
 *   (--window-size en Chrome headless de Windows deja ~16x151 px de marco: 1280x720 → 1264x569).
 * - Recoge errores de la página (excepciones, console.error, [VB][ERROR]) y el log de consola.
 * Devuelve { send, evalJs, navigate, shot, setSize, errors, logs, close }.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const CH = require('./chrome.js');
const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseSize(s) { const m = String(s || '1280x720').split(/[x,]/); return { w: +m[0] || 1280, h: +m[1] || 720 }; }

async function open(opts) {
  opts = opts || {};
  const sz = parseSize(opts.size);
  const port = 9000 + Math.floor(Math.random() * 900);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vb3c-'));
  const chrome = CH.launch(prof, port, sz.w + ',' + (sz.h + 160), opts.flags);
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    try { ws && ws.close(); } catch (e) { }
    CH.kill(chrome); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { }
  }
  process.on('exit', close);
  let ws, id = 0; const pending = new Map(), errors = [], logs = [];
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page'); } catch (e) { }
  }
  if (!target) { close(); throw new Error('Chrome no arranca'); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const txt = 'Uncaught ' + (d.exception ? d.exception.description : d.text);
      errors.push(txt); logs.push('exception: ' + txt);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = m.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
      logs.push(m.params.type + ': ' + txt);
      if (m.params.type === 'error' || /\[VB\]\[ERROR\]|THREE\.WebGL(Program|Renderer).*(rror|fail)/.test(txt)) errors.push(txt);
    }
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' && /^file:|^https:\/\/(cdnjs|fonts)/.test(e.url || '')) { errors.push('[red] ' + e.text + ' ' + (e.url || '')); }
      if (e.source === 'network') logs.push('net: ' + e.level + ' ' + e.text + ' ' + (e.url || ''));
    }
  };
  function send(method, params) {
    return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  }
  async function evalJs(expr, awaitPromise) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result && r.result.value;
  }
  let touch = !!opts.touch;
  async function setSize(size, t) {
    const s = parseSize(size); if (t != null) touch = !!t;
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: touch, screenWidth: s.w, screenHeight: s.h });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await setSize(opts.size, touch);
  async function navigate(query) {
    const loaded = new Promise(r => { const prev = ws.onmessage; ws.onmessage = ev => { prev(ev); try { if (JSON.parse(ev.data).method === 'Page.loadEventFired') { ws.onmessage = prev; r(); } } catch (e) { } }; });
    await send('Page.navigate', { url: CH.pageUrl(ROOT, query) });
    await Promise.race([loaded, sleep(20000)]);
  }
  async function shot(file) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  return { send, evalJs, navigate, shot, setSize, errors, logs, close, sleep };
}

module.exports = { open, sleep, parseSize, ROOT };
