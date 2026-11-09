/* VOLEY 3D — tools/cdp.js (owner: ui_main)
 * Cliente mínimo del DevTools Protocol para las herramientas (sin dependencias: WebSocket nativo de node >= 22).
 * - open({ size:'1280x720', touch:false }) lanza Chrome headless (GPU real; GL=swiftshader para software),
 *   se conecta a la pestaña y fija el VIEWPORT EXACTO con Emulation.setDeviceMetricsOverride
 *   (--window-size en Chrome headless de Windows deja ~16x151 px de marco: 1280x720 → 1264x569).
 * - Recoge errores de la página (excepciones, console.error, [VB][ERROR]) y el log de consola.
 * - Opciones de móvil (perf.js / touchplay.js): dpr (devicePixelRatio), mobile (viewport de móvil; por defecto = touch),
 *   ua (User-Agent), throttle (Emulation.setCPUThrottlingRate), init (scripts para Page.addScriptToEvaluateOnNewDocument,
 *   se ejecutan antes que la página: mando falso, contadores…), flags (banderas extra de Chrome).
 * Devuelve { send, evalJs, navigate, shot, setSize, on, errors, logs, close }.
 * Perfiles temporales (vb3c-* en %TEMP%): close() mata el árbol de Chrome y borra el perfil de forma SÍNCRONA, con hasta 5
 * reintentos (200, 400, 600… ms) porque Windows tarda en soltar los ficheros tras taskkill; así sirve también a los que llaman
 * close() y process.exit() seguidos. Devuelve además una Promise que se resuelve tras el evento 'exit' de Chrome y un último
 * intento de borrado (para quien quiera esperarla). open() barre los vb3c-* de más de 8 min que ningún proceso vivo usa
 * (sweepDead: herramientas muertas sin close(); repaso cada 2 min como mucho), los de más de 1 h que hayan dejado procesos muertos y,
 * si alguno sigue abierto por un Chrome huérfano (o una vez por hora), mata esos huérfanos (killOrphans; ver tools/clean.js).
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const CH = require('./chrome.js');
// VB_ROOT=carpeta: abre la página de otra copia del proyecto (instantánea estable mientras otros editan sus ficheros)
const ROOT = process.env.VB_ROOT ? path.resolve(process.env.VB_ROOT) : path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sleepSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { const t = Date.now() + ms; while (Date.now() < t) { } } }

/** Borra una carpeta con reintentos síncronos (Windows suelta los ficheros de Chrome con retraso). true = ya no existe. */
function rmProfile(dir) {
  for (let i = 0; i <= 5; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    if (!fs.existsSync(dir)) return true;
    if (i < 5) sleepSync(200 * (i + 1));
  }
  return false;
}

/** Barre perfiles vb3c-* de más de maxAgeMs (por defecto 1 h) que dejaron herramientas muertas o interrumpidas.
 *  Si alguno no se deja borrar (un Chrome huérfano lo tiene abierto) o hace más de 1 h del último repaso, busca también
 *  los procesos huérfanos (killOrphans) y vuelve a intentarlo. */
function sweepProfiles(maxAgeMs) {
  const tmp = os.tmpdir(), age = maxAgeMs == null ? 3600e3 : maxAgeMs, lim = Date.now() - age, stop = Date.now() + 1500;
  let n = 0, stuck = 0;
  let names = [];
  try { names = fs.readdirSync(tmp); } catch (e) { return 0; }
  for (const nm of names) {
    if (!/^vb3c-/.test(nm)) continue;
    if (Date.now() > stop) break;                       // como mucho 1,5 s por arranque: el resto, en el siguiente
    const d = path.join(tmp, nm);
    try {
      if (!fs.statSync(d).isDirectory() || fs.statSync(d).mtimeMs > lim) continue;
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      if (fs.existsSync(d)) stuck++; else n++;
    } catch (e) { stuck++; }
  }
  // perfiles muertos de menos de 1 h (sin proceso vivo): como mucho un repaso cada 2 min (listar procesos cuesta ~1 s),
  // o al momento si ya hay 4 o más esperando
  if (maxAgeMs == null) {
    let dead = 0; const dlim = Date.now() - 8 * 60e3;
    for (const nm of names) { if (!/^vb3c-/.test(nm)) continue; try { const st = fs.statSync(path.join(tmp, nm)); if (st.mtimeMs < dlim && st.mtimeMs > lim) dead++; } catch (e) { } }
    const dstamp = path.join(tmp, 'vb3-dead.stamp');
    let ddue = dead >= 4;
    if (dead && !ddue) { try { ddue = Date.now() - fs.statSync(dstamp).mtimeMs > 120e3; } catch (e) { ddue = true; } }
    if (ddue) { try { fs.writeFileSync(dstamp, String(Date.now())); } catch (e) { } n += sweepDead().removed; }
  }
  // repaso de procesos: con perfiles atascados, o una vez por hora (los huérfanos sin carpeta también gastan memoria)
  const stamp = path.join(tmp, 'vb3-orphans.stamp');
  let due = stuck > 0;
  try { due = due || Date.now() - fs.statSync(stamp).mtimeMs > 3600e3; } catch (e) { due = true; }
  if (due) {
    try { fs.writeFileSync(stamp, String(Date.now())); } catch (e) { }
    const k = killOrphans(age);
    if (k.killed.length) for (const nm of k.profiles) { const d = path.join(tmp, nm); if (fs.existsSync(d) && rmProfile(d)) n++; }
  }
  return n;
}

/** Perfiles vb3c-* MUERTOS: de más de deadMs (8 min por defecto) y que ningún proceso vivo tiene en su línea de órdenes
 *  (--user-data-dir). Son de herramientas que murieron sin close() (timeout del que las lanzó, Ctrl+C, varias en paralelo):
 *  con la regla de 1 h una sesión con muchos agentes llegó a dejar 48 carpetas de 27-70 MB (≈3 GB) en 25 min. Un perfil vivo
 *  siempre tiene su Chrome en marcha, así que nunca se toca; si no se puede listar procesos, no se borra nada.
 *  Devuelve {removed, stuck, live, checked} (DRY=true: solo cuenta en checked). */
function sweepDead(deadMs, dry) {
  const tmp = os.tmpdir(), lim = Date.now() - (deadMs == null ? 8 * 60e3 : deadMs), out = { removed: 0, stuck: 0, live: 0, checked: [] };
  let names = [];
  try { names = fs.readdirSync(tmp).filter(n => /^vb3c-/.test(n)); } catch (e) { return out; }
  const old = [];
  for (const nm of names) { try { const st = fs.statSync(path.join(tmp, nm)); if (st.isDirectory() && st.mtimeMs < lim) old.push(nm); } catch (e) { } }
  if (!old.length) return out;
  const rows = listVbProcs();
  if (!rows) return out;
  const live = new Set(rows.map(r => r.profile));
  for (const nm of old) {
    if (live.has(nm)) { out.live++; continue; }
    out.checked.push(nm);
    if (dry) continue;
    if (rmProfile(path.join(tmp, nm))) out.removed++; else out.stuck++;
  }
  return out;
}

/** Procesos (Chrome y sus hijos: GPU, crashpad…) que siguen vivos con un perfil vb3c-* de una herramienta que ya murió.
 *  Huérfano = el proceso tiene más de maxAgeMs (1 h por defecto) Y su carpeta de perfil también (o ya no existe): nunca toca
 *  el Chrome de otra herramienta que esté en marcha. Los mata con taskkill /T /F (Windows) o SIGKILL. Devuelve
 *  {found:[{pid, name, created, profile}], killed:[pid], profiles:[nombre]}. DRY=true solo lista. */
/** Procesos vivos cuya línea de órdenes nombra un perfil vb3c-*: [{pid, name, created, profile}], o null si no se pudo listar
 *  (en ese caso nadie debe borrar nada por «no tener proceso»). */
function listVbProcs() {
  const { spawnSync } = require('child_process');
  let rows = [];
  try {
    if (process.platform === 'win32') {
      const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vb3c-' } | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.Name, " +
        "[int64](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds), ([regex]'vb3c-[A-Za-z0-9]+').Match($_.CommandLine).Value }";
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      if (r.error || r.status !== 0) return null;
      rows = String(r.stdout || '').split(/\r?\n/).filter(Boolean).map(l => { const p = l.trim().split('|'); return { pid: +p[0], name: p[1], created: +p[2], profile: p[3] }; });
    } else {
      const r = spawnSync('ps', ['-eo', 'pid=,etimes=,args='], { encoding: 'utf8', timeout: 15000 });
      if (r.error || r.status !== 0) return null;
      rows = String(r.stdout || '').split('\n').map(l => { const m = /^\s*(\d+)\s+(\d+)\s+(.*vb3c-([A-Za-z0-9]+).*)$/.exec(l); return m ? { pid: +m[1], name: m[3].split(' ')[0], created: Date.now() - m[2] * 1000, profile: 'vb3c-' + m[4] } : null; }).filter(Boolean);
    }
  } catch (e) { return null; }
  return rows;
}

function killOrphans(maxAgeMs, dry) {
  const age = maxAgeMs == null ? 3600e3 : maxAgeMs, lim = Date.now() - age, out = { found: [], killed: [], profiles: [] };
  const { spawnSync } = require('child_process');
  const rows = listVbProcs();
  if (!rows) return out;
  const me = new Set([process.pid, process.ppid]);
  for (const r of rows) {
    if (!r.pid || me.has(r.pid) || !r.profile || !/^vb3c-/.test(r.profile) || !(r.created < lim)) continue;
    if (!/chrome|msedge|chromium/i.test(r.name)) continue;            // solo navegadores (nunca la shell que lo listó)
    let dirOld = true;
    try { dirOld = fs.statSync(path.join(os.tmpdir(), r.profile)).mtimeMs < lim; } catch (e) { dirOld = true; }
    if (!dirOld) continue;
    out.found.push(r);
  }
  for (const r of out.found) {
    if (out.profiles.indexOf(r.profile) < 0) out.profiles.push(r.profile);
    if (dry) continue;
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(r.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else process.kill(r.pid, 'SIGKILL');
      out.killed.push(r.pid);
    } catch (e) { }
  }
  if (out.killed.length) sleepSync(400);                         // Windows suelta los ficheros con algo de retraso
  return out;
}

function parseSize(s) { const m = String(s || '1280x720').split(/[x,]/); return { w: +m[0] || 1280, h: +m[1] || 720 }; }

async function open(opts) {
  opts = opts || {};
  const sz = parseSize(opts.size);
  if (!process.env.VB_NOSWEEP) sweepProfiles();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vb3c-'));
  // Puerto 0: Chrome elige uno libre y lo escribe en <perfil>/DevToolsActivePort. Con un puerto al azar (9000-9899) dos
  // herramientas en paralelo podían coincidir y una se conectaba a la pestaña de la OTRA (capturas con el tamaño ajeno).
  const chrome = CH.launch(prof, 0, sz.w + ',' + (sz.h + 160), opts.flags);
  let port = 0;
  let exited = false, closed = false, closing = null;
  const exitP = new Promise(r => { chrome.once('exit', () => { exited = true; r(); }); chrome.once('error', () => { exited = true; r(); }); });
  function close() {
    if (closing) return closing;
    closed = true;
    try { ws && ws.close(); } catch (e) { }
    CH.kill(chrome);
    const gone = rmProfile(prof);                      // síncrono: vale aunque se llame process.exit() justo después
    if (process.env.VB_PROFDEBUG) console.error('[cdp] perfil ' + prof + (gone ? ' borrado' : ' NO borrado'));
    closing = Promise.race([exitP, sleep(3000)]).then(() => { if (fs.existsSync(prof)) rmProfile(prof); });
    return closing;
  }
  process.on('exit', () => { if (!closed) close(); });
  let ws, id = 0; const pending = new Map(), errors = [], logs = [], listeners = {};
  function on(method, fn) { (listeners[method] = listeners[method] || []).push(fn); }
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    if (!port) { try { port = +fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').trim().split(/\s+/)[0] || 0; } catch (e) { } if (!port) continue; }
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page'); } catch (e) { }
  }
  if (!target) { close(); throw new Error('Chrome no arranca'); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method && listeners[m.method]) for (const fn of listeners[m.method]) { try { fn(m.params); } catch (e) { } }
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
  let touch = !!opts.touch, dpr = +opts.dpr || 1, mobile = opts.mobile != null ? !!opts.mobile : touch;
  async function setSize(size, t, d) {
    const s = parseSize(size); if (t != null) { touch = !!t; if (opts.mobile == null) mobile = touch; } if (d != null) dpr = +d || 1;
    const land = s.w >= s.h;
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: dpr, mobile, screenWidth: s.w, screenHeight: s.h,
      screenOrientation: mobile ? { type: land ? 'landscapePrimary' : 'portraitPrimary', angle: land ? 90 : 0 } : undefined });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  if (opts.ua) await send('Emulation.setUserAgentOverride', { userAgent: opts.ua, platform: /Android/.test(opts.ua) ? 'Linux armv8l' : undefined });
  for (const src of [].concat(opts.init || [])) await send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  if (opts.throttle && +opts.throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: +opts.throttle });
  await setSize(opts.size, touch);
  async function navigate(query) {
    const loaded = new Promise(r => { const prev = ws.onmessage; ws.onmessage = ev => { prev(ev); try { if (JSON.parse(ev.data).method === 'Page.loadEventFired') { ws.onmessage = prev; r(); } } catch (e) { } }; });
    await send('Page.navigate', { url: CH.pageUrl(ROOT, query) });
    await Promise.race([loaded, sleep(20000)]);
    // al navegar Chrome puede cambiar de proceso de render y el freno de CPU se pierde: se vuelve a aplicar
    if (throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  let throttle = +opts.throttle || 1;
  async function setThrottle(rate) { throttle = +rate || 1; await send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  /** Captura PNG. clip opcional {x, y, width, height, scale} en px CSS (recorte ampliado para mirar detalles). */
  async function shot(file, clip) {
    const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip: Object.assign({ scale: 1 }, clip) } : { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  /** Secuencia de fotogramas reales del compositor (Page.startScreencast) durante ms: [{t (ms desde el inicio), data (Buffer
   *  JPEG/PNG)}]. Para mirar movimiento (cortinillas, transiciones): una captura suelta no enseña los fotogramas intermedios.
   *  opts: {format:'jpeg'|'png', quality, max (fotogramas), dir (si se da, los guarda como f000.jpg…), start: async fn (se llama
   *  ya grabando, p. ej. para pulsar un botón)}. */
  async function frames(ms, o) {
    o = o || {};
    const out = [], fmt = o.format || 'jpeg', t0 = Date.now();
    on('Page.screencastFrame', p => {
      if (!recording) return;
      out.push({ t: Date.now() - t0, data: Buffer.from(p.data, 'base64') });
      send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => { });
    });
    let recording = true;
    await send('Page.startScreencast', { format: fmt, quality: o.quality || 80, everyNthFrame: 1 });
    if (o.start) await o.start();
    await sleep(ms);
    recording = false;
    await send('Page.stopScreencast').catch(() => { });
    const list = o.max ? out.slice(0, o.max) : out;
    if (o.dir) { fs.mkdirSync(o.dir, { recursive: true }); list.forEach((f, i) => fs.writeFileSync(path.join(o.dir, 'f' + String(i).padStart(3, '0') + '-' + f.t + 'ms.' + (fmt === 'png' ? 'png' : 'jpg')), f.data)); }
    return list;
  }
  return { send, evalJs, navigate, shot, frames, setSize, setThrottle, on, errors, logs, close, sleep };
}

// Navegador de un móvil Android de gama media (perf.js, touchplay.js)
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
module.exports = { open, sleep, parseSize, ROOT, ANDROID_UA, sweepProfiles, sweepDead, listVbProcs, rmProfile, killOrphans };
