#!/usr/bin/env node
/* VOLEY 3D — tools/perf.js (owner: ui_main)
 * Rendimiento "de móvil medio" medido de verdad en Chrome (DevTools Protocol):
 *   viewport de móvil + devicePixelRatio + táctil + User-Agent Android + CPU frenada (Emulation.setCPUThrottlingRate),
 *   un partido REAL en vivo (autopilot: el equipo humano lo juega la IA, con el HUD de partido) durante N s por calidad.
 * Por cada nivel (auto / high / medium / low) informa: fps medio, fps p5 (= 1000 / frame p95), tiempo de frame p95/p99/máx,
 *   coste JS por frame (ctx.frameMs), tareas largas (> 50 ms), crecimiento del heap JS y ritmo de asignación,
 *   recolecciones (MinorGC / MajorGC por traza de V8), renderer.info (draw calls, triángulos, texturas, geometrías, programas),
 *   pixelRatio y tamaño del lienzo, y lo que hizo la calidad adaptativa (VB.ctx.qLog: cambios con su instante).
 * Imprime una tabla y escribe el JSON en tools/out/perf/.
 *
 * Uso: node tools/perf.js [WxH=844x390] [segundos=20] [niveles=auto,high,medium,low] [cpu=4] [dpr=2.75]
 * Variables: GL=swiftshader (render por software) · SCENE=match|rally (match = partido real con autopilot, por defecto;
 *   rally = ?debug=rally&live=1) · WARM=s de calentamiento antes de medir (10: fuera la compilación del menú y la síntesis de audio; 45 con ALLOC/RETAIN) · TRACE=0 sin traza de GC ·
 *   DESKTOP=1 sin emulación de móvil (escritorio, dpr 1) · STRICT=1 sale con 1 si no se cumplen los objetivos o si la medida
 *   no es válida (CPU del PC anfitrión > HOSTMAX % de media durante el nivel; 80 por defecto).
 * Cada nivel mide también la CPU del PC anfitrión (os.cpus, todas las CPU): con el PC cargado los fps caen a la mitad (39 vs 86
 *   fps el mismo comando con 93-99 % frente a 50-72 %), así que la tabla y el JSON la llevan y avisan.
 * Objetivos (CONTRACT §2 y TRASPASO): medium/low ≥ 55 fps; low ≤ 150k triángulos y ≤ 60 draw calls; medium ≤ 350k triángulos;
 *   heap estable (sin crecimiento sostenido) y pocas recolecciones.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const CDP = require('./cdp.js');
const SIZE = process.argv[2] || '844x390', SECS = +(process.argv[3] || 20);
const LEVELS = (process.argv[4] || 'auto,high,medium,low').split(',').filter(Boolean);
const THR = +(process.argv[5] || 4), DESKTOP = process.env.DESKTOP === '1';
const DPR = DESKTOP ? 1 : +(process.argv[6] || 2.75);
// ALLOC/RETAIN: calentamiento por defecto 45 s (V8 sube de nivel por número de llamadas: con 4 s se mide código aún sin optimizar; notes/arena.md)
const SCENE = process.env.SCENE || 'match', WARM = +(process.env.WARM || ((process.env.ALLOC === '1' || process.env.RETAIN === '1') ? 45 : 10)), TRACE = process.env.TRACE !== '0';
const OUTDIR = path.join(__dirname, 'out', 'perf');
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, (LEVELS.length * (SECS + WARM + 40) + 90) * 1000).unref();

// Contadores dentro de la página, instalados ANTES que los scripts del juego. Búferes tipados preasignados:
// medir no debe asignar memoria por frame (si no, ensuciaría la medida de asignaciones del propio juego).
const INIT = `(function(){
  var N = 1 << 15, ts = new Float64Array(N), ws = new Float32Array(N), n = 0, on = false;
  ts.fill(0); ws.fill(0); // que el almacén se cree ya (si no, aparece como memoria retenida durante la medida)
  var lt = { n: 0, ms: 0, max: 0 };
  function tick(t) { requestAnimationFrame(tick); if (!on || n >= N) return; var c = window.VB && VB.ctx; ts[n] = t; ws[n] = c && c.frameMs || 0; n++; }
  requestAnimationFrame(tick);
  try { new PerformanceObserver(function (l) { if (!on) return; l.getEntries().forEach(function (e) { lt.n++; lt.ms += e.duration; if (e.duration > lt.max) lt.max = e.duration; }); }).observe({ entryTypes: ['longtask'] }); } catch (e) { }
  window.__perf = {
    start: function () { n = 0; on = true; lt.n = 0; lt.ms = 0; lt.max = 0; },
    stop: function () { on = false; },
    dump: function () { return { ts: Array.prototype.slice.call(ts.subarray(0, n)), ws: Array.prototype.slice.call(ws.subarray(0, n)), lt: lt }; }
  };
})();`;

const INFO = `(function(){var c=VB.ctx,r=c.renderer,i=r.info,cv=c.canvas;return {calls:i.render.calls,tri:i.render.triangles,pts:i.render.points,lines:i.render.lines,
  tex:i.memory.textures,geo:i.memory.geometries,prog:i.programs?i.programs.length:0,level:c.quality.level,pr:r.getPixelRatio(),cw:cv.width,ch:cv.height,
  shadow:r.shadowMap.enabled?(c.quality.shadowSize):0,state:c.state,mode:c.game&&c.game.mode,frozen:c.frozen,mobile:c.isMobile,touch:c.isTouch,
  dpr:devicePixelRatio,post:!!c.renderFn,fps:c.fps}})()`;

const PROFILE = process.env.PROFILE === '1';
// Perfil de CPU (muestreo): tiempo propio por función y por fichero, para saber QUÉ módulo gasta el frame
function topFns(p, n) {
  const byId = new Map(); for (const nd of p.nodes) byId.set(nd.id, nd);
  const self = new Map(); const dtSum = p.timeDeltas.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < p.samples.length; i++) { const id = p.samples[i]; self.set(id, (self.get(id) || 0) + (p.timeDeltas[i] || 0)); }
  const fn = new Map(), file = new Map();
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame, f = (cf.url || '').split('/').pop().split('?')[0] || '(' + (cf.functionName || 'nativo') + ')';
    const k = (cf.functionName || '(anónima)') + ' ' + f + ':' + (cf.lineNumber + 1);
    fn.set(k, (fn.get(k) || 0) + us); file.set(f, (file.get(f) || 0) + us);
  }
  const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => [k, Math.round(us / dtSum * 1000) / 10]);
  return { files: top(file), fns: top(fn) };
}
// ALLOC=1: todo lo asignado (también lo ya recogido) · RETAIN=1: solo lo que SIGUE VIVO al acabar (fugas)
const RETAIN = process.env.RETAIN === '1', ALLOC = process.env.ALLOC === '1' || RETAIN;
const span0 = () => SECS;
// Asignaciones muestreadas (HeapProfiler, incluidas las ya recogidas por el GC): KB/s por función y por fichero
function topAlloc(p, n, secs) {
  const fn = new Map(), file = new Map();
  (function walk(nd, stack) {
    const cf = nd.callFrame, f = (cf.url || '').split('/').pop().split('?')[0] || '(' + (cf.functionName || 'nativo') + ')';
    if (nd.selfSize) {
      const k = (cf.functionName || '(anónima)') + ' ' + f + ':' + (cf.lineNumber + 1) + (stack ? '  ← ' + stack : '');
      fn.set(k, (fn.get(k) || 0) + nd.selfSize);
      // fichero del juego más cercano en la pila (three.min.js asigna a petición de un módulo)
      const own = /\.js$/.test(f) && f !== 'three.min.js' ? f : (stack.match(/(\w+\.js)/) || [, f])[1];
      file.set(own, (file.get(own) || 0) + nd.selfSize);
    }
    const here = /\.js$/.test(f) && f !== 'three.min.js' ? (cf.functionName || '(anónima)') + ' ' + f + ':' + (cf.lineNumber + 1) : stack;
    for (const c of nd.children || []) walk(c, here);
  })(p.head, '');
  const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, b]) => [k, Math.round(b / 1024 / secs * 10) / 10]);
  return { files: top(file), fns: top(fn) };
}
// CPU del anfitrión: ocupación media de todas las CPU entre dos muestras de os.cpus()
const HOSTMAX = +(process.env.HOSTMAX || 80);
function cpuSnap() { let idle = 0, tot = 0; for (const c of os.cpus()) { const t = c.times; idle += t.idle; tot += t.user + t.nice + t.sys + t.idle + t.irq; } return { idle, tot }; }
function cpuBusy(a, b) { const dt = b.tot - a.tot; return dt > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / dt)) : 0; }
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const r1 = x => Math.round(x * 10) / 10;

async function runLevel(page, level) {
  const q = [];
  if (SCENE === 'rally') q.push('debug=rally', 'live=1', 'aq=1');
  if (level !== 'auto') q.push('quality=' + level);
  await page.navigate(q.join('&'));
  await CDP.sleep(1500);
  if (SCENE !== 'rally') {
    const ok = await page.evalJs("(function(){if(!window.VB||!VB.ctx||!VB.ctx.actions)return false;VB.ctx.actions.startMatch({autopilot:true});return VB.ctx.state})()");
    if (ok !== 'playing') throw new Error('no arranca el partido: ' + ok);
  }
  await CDP.sleep(WARM * 1000);
  const qLog0 = (await page.evalJs('JSON.stringify(VB.ctx.qLog||[])')) || '[]';
  // --- medir
  const gc = { minor: 0, major: 0, minorMs: 0, majorMs: 0 };
  let traceDone = null;
  if (TRACE) {
    traceDone = new Promise(r => page.on('Tracing.tracingComplete', r));
    await page.send('Tracing.start', { categories: 'v8', transferMode: 'ReportEvents' });
  }
  const heap = [], infos = [];
  // memoria RETENIDA: heap tras un GC completo al empezar y al acabar (los dientes de sierra no cuentan)
  const gcHeap = async () => { try { await page.send('HeapProfiler.collectGarbage'); return (await page.send('Runtime.getHeapUsage')).usedSize; } catch (e) { return 0; } };
  const kept0 = await gcHeap();
  if (ALLOC) { await page.send('HeapProfiler.enable'); await page.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: !RETAIN, includeObjectsCollectedByMinorGC: !RETAIN }); }
  if (PROFILE) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 500 }); await page.send('Profiler.start'); }
  const met = async () => { const m = {}; for (const x of (await page.send('Performance.getMetrics')).metrics) m[x.name] = x.value; return m; };
  await page.send('Performance.enable', { timeDomain: 'threadTicks' }).catch(() => page.send('Performance.enable'));
  const m0 = await met();
  await page.evalJs('__perf.start()');
  const t0 = Date.now();
  let nextInfo = 0;
  const host0 = cpuSnap(); let hostPrev = host0, hostMax = 0, nextHost = 1000;
  while (Date.now() - t0 < SECS * 1000) {
    if (Date.now() - t0 >= nextHost) { nextHost += 1000; const hs = cpuSnap(); hostMax = Math.max(hostMax, cpuBusy(hostPrev, hs)); hostPrev = hs; }
    try { const h = await page.send('Runtime.getHeapUsage'); heap.push([Date.now() - t0, h.usedSize]); } catch (e) { }
    if (Date.now() - t0 >= nextInfo) { nextInfo += 1000; try { infos.push(await page.evalJs(INFO)); } catch (e) { } }
    await CDP.sleep(200);
  }
  await page.evalJs('__perf.stop()');
  const hostAvg = cpuBusy(host0, cpuSnap());
  const kept1 = await gcHeap();
  const m1 = await met();
  const per = k => ((m1[k] || 0) - (m0[k] || 0)) * 1000 / SECS; // ms de hilo principal por segundo
  const mt = { script: r1(per('ScriptDuration')), layout: r1(per('LayoutDuration')), style: r1(per('RecalcStyleDuration')), task: r1(per('TaskDuration')),
    layouts: Math.round(((m1.LayoutCount || 0) - (m0.LayoutCount || 0)) / SECS), styles: Math.round(((m1.RecalcStyleCount || 0) - (m0.RecalcStyleCount || 0)) / SECS) };
  mt.other = r1(mt.task - mt.script - mt.layout - mt.style);
  let prof = null, alloc = null;
  if (ALLOC) { const a = await page.send('HeapProfiler.stopSampling'); alloc = topAlloc(a.profile, 25, span0()); }
  if (PROFILE) { const p = await page.send('Profiler.stop'); prof = topFns(p.profile, 22); }
  if (TRACE) { await page.send('Tracing.end'); await Promise.race([traceDone, CDP.sleep(15000)]); }
  const d = await page.evalJs('__perf.dump()');
  const qLog = JSON.parse((await page.evalJs('JSON.stringify(VB.ctx.qLog||[])')) || '[]');
  const end = await page.evalJs(INFO);
  // --- calcular
  const dts = []; for (let i = 1; i < d.ts.length; i++) dts.push(d.ts[i] - d.ts[i - 1]);
  const span = d.ts.length > 1 ? (d.ts[d.ts.length - 1] - d.ts[0]) / 1000 : 1;
  const ws = d.ws.filter(x => x > 0);
  let up = 0, drops = 0; for (let i = 1; i < heap.length; i++) { const dd = heap[i][1] - heap[i - 1][1]; if (dd > 0) up += dd; else if (dd < -20000) drops++; }
  // crecimiento SOSTENIDO: mínimo del último tercio menos mínimo del primero (los dientes de sierra del GC no cuentan)
  const third = Math.max(1, Math.floor(heap.length / 3));
  const minOf = a => a.length ? Math.min(...a.map(x => x[1])) : 0;
  const growth = minOf(heap.slice(-third)) - minOf(heap.slice(0, third));
  // cifras de render del nivel FINAL (no las de antes de un cambio de calidad)
  { const lv = infos.filter(i => i.level === end.level); if (lv.length) infos.splice(0, infos.length, ...lv); }
  return {
    level, scene: SCENE, secs: r1(span), frames: d.ts.length,
    hostCpu: hostAvg, hostCpuMax: Math.max(hostMax, hostAvg), hostCpus: os.cpus().length, valid: hostAvg <= HOSTMAX,
    fps: r1((d.ts.length - 1) / span), fpsP5: r1(1000 / Math.max(1, pct(dts, 0.95))),
    ftP50: r1(pct(dts, 0.5)), ftP95: r1(pct(dts, 0.95)), ftP99: r1(pct(dts, 0.99)), ftMax: r1(Math.max(0, ...dts)),
    over20: dts.filter(x => x > 20).length, over33: dts.filter(x => x > 33.4).length,
    jsAvg: r1(avg(ws)), jsP95: r1(pct(ws, 0.95)),
    longTasks: d.lt.n, longMs: Math.round(d.lt.ms), longMax: Math.round(d.lt.max),
    heapStartMB: heap.length ? r1(heap[0][1] / 1048576) : 0, heapEndMB: heap.length ? r1(heap[heap.length - 1][1] / 1048576) : 0,
    heapGrowthKB: Math.round(growth / 1024), keptKB: Math.round((kept1 - kept0) / 1024), keptMB: r1(kept1 / 1048576), allocKBs: Math.round(up / 1024 / span), heapDrops: drops,
    gc: TRACE ? gc : null,
    calls: Math.round(avg(infos.map(i => i.calls))), callsMax: Math.max(0, ...infos.map(i => i.calls)),
    triK: Math.round(avg(infos.map(i => i.tri)) / 1000), triMaxK: Math.round(Math.max(0, ...infos.map(i => i.tri)) / 1000),
    textures: end.tex, geometries: end.geo, programs: end.prog,
    endLevel: end.level, pixelRatio: r1(end.pr * 100) / 100, canvas: end.cw + 'x' + end.ch, shadow: end.shadow, post: end.post,
    mobile: end.mobile, touch: end.touch, dpr: end.dpr, state: end.state,
    qLogWarm: JSON.parse(qLog0), qLog, profile: prof, alloc, main: mt,
    _gcHook: gc
  };
}

(async () => {
  let page, fail = 0;
  const results = [];
  try {
    page = await CDP.open({ size: SIZE, touch: !DESKTOP, mobile: !DESKTOP, dpr: DPR, ua: DESKTOP ? undefined : CDP.ANDROID_UA, throttle: THR, init: [INIT] });
    let cur = null;
    page.on('Tracing.dataCollected', p => {
      if (!cur) return;
      for (const e of p.value) {
        if (e.name === 'MinorGC') { cur.minor++; cur.minorMs += (e.dur || 0) / 1000; }
        else if (e.name === 'MajorGC') { cur.major++; cur.majorMs += (e.dur || 0) / 1000; }
      }
    });
    console.log(`perf: ${SIZE} dpr ${DPR} cpu ×${THR} ${process.env.GL || 'GPU'} · ${SCENE} · ${SECS} s por nivel (+${WARM} s de calentamiento)` + (DESKTOP ? ' · escritorio' : ' · móvil emulado'));
    for (const lv of LEVELS) {
      const gc = { minor: 0, major: 0, minorMs: 0, majorMs: 0 }; cur = gc;
      process.stdout.write('  midiendo ' + lv + '… ');
      const r = await runLevel(page, lv);
      r.gc = TRACE ? { minor: gc.minor, major: gc.major, minorMs: r1(gc.minorMs), majorMs: r1(gc.majorMs) } : null; delete r._gcHook;
      cur = null;
      results.push(r);
      console.log(r.fps + ' fps · CPU del PC ' + r.hostCpu + ' % (máx. ' + r.hostCpuMax + ' %)' + (r.valid ? '' : ' ⚠ PC CARGADO: medida no válida'));
    }
  } catch (e) { fail++; console.error('\nERROR:', e && e.stack || e); }
  if (page && page.errors.length) { fail++; console.error('ERRORES EN LA PÁGINA:\n' + page.errors.slice(0, 8).join('\n')); }
  if (page) page.close();
  if (!results.length) process.exit(1);
  // --- tabla
  const cols = [['nivel', r => r.level + (r.endLevel !== r.level ? '→' + r.endLevel : '')], ['fps', r => r.fps], ['p5fps', r => r.fpsP5], ['host%', r => r.hostCpu + '/' + r.hostCpuMax + (r.valid ? '' : '!')], ['ft95', r => r.ftP95], ['ft99', r => r.ftP99],
    ['>33ms', r => r.over33], ['js ms', r => r.jsAvg + '/' + r.jsP95], ['long', r => r.longTasks + (r.longTasks ? '(' + r.longMax + ')' : '')],
    ['heap MB', r => r.heapStartMB + '→' + r.heapEndMB], ['retenido KB', r => r.keptKB], ['asig KB/s', r => r.allocKBs],
    ['GC m/M', r => r.gc ? r.gc.minor + '/' + r.gc.major : '-'], ['draw', r => r.calls + '/' + r.callsMax], ['tri k', r => r.triK + '/' + r.triMaxK],
    ['hilo ms/s js+lay+sty+otro', r => r.main.script + '+' + r.main.layout + '+' + r.main.style + '+' + r.main.other], ['lay/sty/s', r => r.main.layouts + '/' + r.main.styles], ['tex', r => r.textures], ['geo', r => r.geometries], ['prog', r => r.programs], ['pr', r => r.pixelRatio], ['lienzo', r => r.canvas], ['sombra', r => r.shadow]];
  const rows = [cols.map(c => c[0])].concat(results.map(r => cols.map(c => String(c[1](r)))));
  const wd = cols.map((_, i) => Math.max(...rows.map(rw => rw[i].length)));
  console.log('\n' + rows.map((rw, k) => rw.map((v, i) => v.padStart(wd[i])).join('  ') + (k === 0 ? '\n' + wd.map(w => '-'.repeat(w)).join('  ') : '')).join('\n'));
  for (const r of results) {
    const lg = r.qLogWarm.concat(r.qLog.slice(r.qLogWarm.length));
    if (lg.length) console.log('  ' + r.level + ' · calidad adaptativa: ' + lg.map(e => `${e.t}s ${e.why}→${e.level}${e.scale < 1 ? '×' + e.scale : ''} (${e.fps} fps, pr ${e.pr})`).join(' · '));
  }
  // --- objetivos
  const issues = [], invalid = results.filter(r => !r.valid);
  if (invalid.length) console.log(`
⚠ MEDIDA NO VÁLIDA en ${invalid.map(r => r.level + ' (' + r.hostCpu + ' %)').join(', ')}: la CPU del PC anfitrión pasó del ${HOSTMAX} % de media.
  Los fps de esos niveles dependen de lo que más esté corriendo en el PC: repetir con el PC libre.`);
  for (const r of results) {
    const lv = r.endLevel;
    if ((r.level === 'medium' || r.level === 'low' || r.level === 'auto') && r.fps < 55) issues.push(`${r.level}: ${r.fps} fps < 55` + (r.valid ? '' : ` (CPU del PC ${r.hostCpu} %: no válido)`));
    if (lv === 'low' && r.triMaxK > 150) issues.push(`${r.level}: ${r.triMaxK}k triángulos > 150k en baja`);
    if (lv === 'low' && r.callsMax > 60) issues.push(`${r.level}: ${r.callsMax} draw calls > 60 en baja`);
    if (lv === 'medium' && r.triMaxK > 350) issues.push(`${r.level}: ${r.triMaxK}k triángulos > 350k en media`);
    // umbral 2 MB: los búferes de medida (~0,4 MB) y el calentamiento de cachés de V8/three (0,4-1 MB, no crece con el tiempo:
    // 20 s → 0,4-1,1 MB, 60 s → 0,9 MB) aparecen como retenidos sin ser una fuga
    if (r.keptKB > 2048) issues.push(`${r.level}: tras GC completo el heap retiene ${r.keptKB} KB más que al empezar (${r.secs} s)`);
  }
  for (const r of results) if (r.profile) {
    console.log('\n  perfil ' + r.level + ' (% del tiempo muestreado del hilo principal):');
    console.log('    ficheros: ' + r.profile.files.map(x => x[0] + ' ' + x[1] + '%').join(' · '));
    for (const x of r.profile.fns) console.log('    ' + String(x[1]).padStart(5) + '%  ' + x[0]);
  }
  for (const r of results) if (r.alloc) {
    console.log('\n  asignaciones ' + r.level + ' (KB/s muestreados):');
    console.log('    ficheros: ' + r.alloc.files.map(x => x[0] + ' ' + x[1]).join(' · '));
    for (const x of r.alloc.fns) console.log('    ' + String(x[1]).padStart(7) + '  ' + x[0]);
  }
  console.log(issues.length ? '\nOBJETIVOS NO CUMPLIDOS:\n  ' + issues.join('\n  ') : '\nobjetivos cumplidos' + (invalid.length ? ' (pero con el PC cargado: ver aviso)' : ''));
  fs.mkdirSync(OUTDIR, { recursive: true });
  const f = path.join(OUTDIR, `perf-${SIZE}-dpr${DPR}-cpu${THR}-${SCENE}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(f, JSON.stringify({ size: SIZE, dpr: DPR, cpu: THR, gl: process.env.GL || 'gpu', scene: SCENE, secs: SECS, desktop: DESKTOP, at: new Date().toISOString(), results, issues, hostMax: HOSTMAX, invalid: invalid.map(r => r.level) }, null, 1));
  console.log('JSON:', f);
  process.exit(fail || (process.env.STRICT === '1' && (issues.length || invalid.length)) ? 1 : 0);
})();
