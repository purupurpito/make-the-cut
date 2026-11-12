#!/usr/bin/env node
/* VOLEY 3D — tools/gymtest.js (owner: ui_main)
 * Pruebas del Entrenamiento (E6). Tres partes:
 *  1) SIN navegador (siempre): js/gym.js en vm con un localStorage falso y un VB.Prog falso: DRILLS/MEDALS/XP, medalOf en los
 *     umbrales, record (récord, intentos, medalla nueva, XP una sola vez por nivel y a los dos jugadores, y nunca dos veces),
 *     recordRally, count (de 15), nextOf, validación de load (JSON roto, claves desconocidas, topes).
 *  2) CON navegador (tools/cdp.js; NOCDP=1 la salta): para cada ejercicio, ?drill=<id>&gymauto=1&seed=7 hasta drillEnd → hoja
 *     .drill visible con total y botones, voley3d.gym actualizado (intentos +1) y la experiencia del escuadrón sube EXACTAMENTE lo
 *     de las medallas nuevas (ni XP de partido ni cobro doble; 'serve' se juega dos veces). Peloteo libre: 25 s sin final y con el
 *     marcador a 0. VB.Account._mergeGym une por máximo. Sin errores JS.
 *  3) Navegación real (teclado, TOUCH=1 a 844×390 y mando falso): menú › Jugar › Entrenamiento › fila › ejercicio › pausa ›
 *     «Salir al entrenamiento».
 *  Si main.js/ui.js aún no tienen el modo (g.drill con ?drill=), las partes 2 y 3 se saltan con un aviso (STRICT=1: fallo).
 * Uso: node tools/gymtest.js [ejercicios=serve,recv,set,atk,block]     Sale con 1 si falla algo.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const LIST = (process.argv[2] || 'serve,recv,set,atk,block').split(',').filter(Boolean);
let fail = 0;
const check = (c, m) => { if (!c) { fail++; console.error('FALLO:', m); } else console.log('ok:', m); return !!c; };
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, 20 * 60e3).unref();

// ---------------------------------------------------------------- 1) sin navegador
console.log('== gym.js ==');
function sandbox() {
  const store = {}, xp = [0, 0];
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const VB = { Prog: { addXP: (i, n) => { xp[i] += n; } } };
  const window = { VB, localStorage };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'gym.js'), 'utf8'), { window, VB });
  return { G: VB.Gym, store, xp };
}
{
  const { G, store, xp } = sandbox();
  check(G && G.DRILLS.length === 6 && G.DRILLS.map(d => d.id).join() === 'serve,recv,set,atk,block,free', 'DRILLS en orden (6 filas)');
  check(G.DRILLS.every(d => d.name && d.short && d.help && d.help.length <= 60 && !/·|1\.er|2\.º/.test(d.name + d.help)), 'nombres y ayudas cortas, sin «·» ni ordinales con punto');
  check(JSON.stringify(G.MEDALS.block) === '[6,11,16]' && JSON.stringify(G.MEDALS.serve) === '[12,18,24]' && JSON.stringify(G.MEDALS.recv) === '[18,24,28]' && JSON.stringify(G.XP) === '[30,50,80]', 'MEDALS (recalibrados por simtest «Gimnasio») y XP');
  check(JSON.stringify(G.medalsOf('set')) === '[16,22,27]' && G.medalsOf('free') === null, 'medalsOf (reserva sin VB.DRILL)');
  check([11, 12, 17, 18, 23, 24, 30].map(t => G.medalOf('serve', t)).join() === '0,1,1,2,2,3,3' && G.medalOf('block', 16) === 3 && G.medalOf('block', 15) === 2 && G.medalOf('free', 30) === 0, 'medalOf en los umbrales');
  let r = G.record('serve', 13);
  check(r.best === 13 && r.isBest && r.medal === 1 && r.newMedal && r.xp === 30 && r.n === 1, 'record: 1r intento, bronce, +30');
  check(xp[0] === 30 && xp[1] === 30, 'XP a los dos jugadores');
  r = G.record('serve', 13);
  check(!r.isBest && !r.newMedal && r.xp === 0 && r.n === 2 && xp[0] === 30, 'mismo total: sin récord ni XP');
  r = G.record('serve', 25);
  check(r.isBest && r.prev === 13 && r.medal === 3 && r.newMedal && r.xp === 130 && xp[1] === 160, 'de bronce a oro: cobra plata y oro (50 + 80)');
  r = G.record('serve', 5);
  check(r.best === 25 && r.medal === 0 && !r.newMedal && r.xp === 0 && xp[0] === 160, 'total bajo: no quita récord ni medalla');
  check(G.get('serve').m === 3 && G.get('serve').n === 4 && G.get('serve').t > 0, 'get: medalla, intentos y fecha del récord');
  check(G.count() === 3, 'count: 3 de 15');
  G.record('block', 12); check(G.count() === 5, 'count: 5 tras plata en bloqueo');
  check(G.recordRally(9).isBest && !G.recordRally(4).isBest && G.bestRally() === 9, 'recordRally: mejor peloteo');
  check(G.nextOf('serve') === 'recv' && G.nextOf('block') === 'serve' && G.nextOf('free') === null, 'nextOf');
  const s = JSON.parse(store['voley3d.gym']);
  check(s.v === 1 && s.xp.serve === 3 && s.d.serve.b === 25 && s.free.rally === 9, 'formato guardado v1 {v, d, free, xp}');
  // validación
  store['voley3d.gym'] = '{roto';
  check(G.load().d && !Object.keys(G.load().d).length, 'JSON roto → vacío');
  store['voley3d.gym'] = JSON.stringify({ v: 1, d: { serve: { b: 99, m: 7, n: -3, t: 'x' }, hack: { b: 1 } }, free: { rally: 1e9 }, xp: { serve: 9, zzz: 1 }, extra: 1 });
  const L = G.load();
  check(L.d.serve.b === 40 && L.d.serve.m === 3 && L.d.serve.n === 0 && L.d.serve.t === 0 && !L.d.hack && L.free.rally === 999 && L.xp.serve === 3 && !L.xp.zzz && !L.extra, 'load: topes y claves desconocidas fuera');
  const xs = xp[0]; G.record('serve', 30);
  check(xp[0] === xs, 'xp cobrado = 3 en el guardado: no vuelve a cobrar');
  check(G.record('nada', 20).xp === 0 && G.record('free', 20).medal === 0, 'ids sin medallas: sin efecto');
}
{ // sin VB.Prog: no peta
  const store = {}; const window = { VB: {}, localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: () => { } } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'gym.js'), 'utf8'), { window, VB: window.VB });
  check(window.VB.Gym.record('atk', 24).xp === 160, 'sin VB.Prog: record funciona (la XP se informa igual)');
}

// ---------------------------------------------------------------- 2) y 3) con navegador
async function browser() {
  const CDP = require('./cdp.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = sel => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e||e.hidden)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity>0.05;})()`;
  const waitFor = async (pg, expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await pg.evalJs(expr)) return true; } catch (e) { } await sleep(150); } return false; };
  const ready = pg => waitFor(pg, 'window.VB&&VB.ctx&&VB.ctx.state', 20000);
  // experiencia acumulada de un atleta (niveles pasados + xp del nivel), para comparar sin depender de subidas de nivel
  const XPJS = `(function(){var n=VB.Prog.need,q=VB.Prog.squad();return q.slice(0,2).map(function(a){var s=a.xp;for(var l=0;l<a.lvl;l++)s+=n(l);return s;});})()`;
  const GYMJS = `(function(){try{return JSON.parse(localStorage.getItem('voley3d.gym')||'null')}catch(e){return null}})()`;
  const NOINTRO = `(function(){try{localStorage.setItem('voley3d.guided','{"done":true}');localStorage.setItem('voley3d.install','1')}catch(e){}})();`;   // (install: sin el aviso de instalar del móvil, que a veces se abría justo antes del toque en «Jugar»)
  let pg;
  try {
    pg = await CDP.open({ size: '1280x720', init: [NOINTRO] });
    await pg.navigate('drill=serve&gymauto=1&seed=7&nonews=1'); await ready(pg); await sleep(2500);
    const has = await pg.evalJs('!!(VB.Gym&&VB.ctx.game&&VB.ctx.game.drill)');
    if (!has) {
      const m = 'main.js/ui.js aún sin el Entrenamiento (?drill= no crea g.drill o falta VB.Gym en index.html): pruebas del navegador saltadas';
      if (process.env.STRICT === '1') check(false, m); else console.log('AVISO: ' + m);
      return;
    }
    // fusión de la cuenta (apagada, pero escrita)
    const mg = await pg.evalJs(`(function(){var f=VB.Account&&VB.Account._mergeGym;if(!f)return 'sin _mergeGym';
      var a=JSON.stringify({v:1,d:{serve:{b:20,m:2,n:3,t:5},atk:{b:9,m:0,n:1,t:7}},free:{rally:4},xp:{serve:2}}),
          b=JSON.stringify({v:1,d:{serve:{b:25,m:3,n:1,t:9},recv:{b:12,m:1,n:2,t:3}},free:{rally:11},xp:{serve:3,recv:1}});
      var o=JSON.parse(f(a,b));return JSON.stringify([o.d.serve,o.d.atk.b,o.d.recv.m,o.free.rally,o.xp.serve,o.xp.recv,f(a,a)===a,VB.Account._gymSync]);})()`);
    check(mg === '[{"b":25,"m":3,"n":3,"t":9},9,1,11,3,1,true,false]', 'VB.Account._mergeGym une por máximo y GYM_SYNC sigue apagado: ' + mg);
    const runs = LIST.concat(LIST.includes('serve') ? ['serve'] : []);
    for (let i = 0; i < runs.length; i++) {
      const id = runs[i], again = i >= LIST.length;
      const x0 = await pg.evalJs(XPJS), g0 = (await pg.evalJs(GYMJS)) || { d: {}, xp: {} };
      await pg.navigate('drill=' + id + '&gymauto=1&seed=' + (again ? 8 : 7) + '&nonews=1'); await ready(pg);
      pg.errors.length = 0;
      const t0 = Date.now();
      const ended = await waitFor(pg, 'VB.ctx.state==="over"&&VB.ctx.game&&VB.ctx.game.drill&&VB.ctx.game.drill.done', 240000);
      const secs = Math.round((Date.now() - t0) / 1000);
      if (!check(ended, id + (again ? ' (2ª pasada)' : '') + ': llega drillEnd y el estado pasa a «over» (' + secs + ' s)')) continue;
      await sleep(1500);
      const sheet = await pg.evalJs(`(function(){var e=document.querySelector('#end.drill')||document.querySelector('.sheet.drill');if(!e)return null;
        var r=e.getBoundingClientRect();return {vis:r.width>0&&r.height>0&&!e.hidden&&getComputedStyle(e).display!=='none',txt:e.textContent.replace(/\\s+/g,' ').slice(0,200),
        btns:[].slice.call(e.querySelectorAll('button')).filter(function(b){return b.offsetParent}).length};})()`);
      const total = await pg.evalJs('VB.ctx.game.drill.total');
      check(sheet && sheet.vis && sheet.btns >= 3 && sheet.txt.indexOf(String(total)) >= 0, id + ': hoja .drill visible con el total ' + total + ' y ' + (sheet ? sheet.btns : 0) + ' botones');
      const g1 = (await pg.evalJs(GYMJS)) || { d: {}, xp: {} }, x1 = await pg.evalJs(XPJS);
      const n0 = (g0.d[id] || {}).n || 0, n1 = (g1.d[id] || {}).n || 0;
      check(n1 === n0 + 1 && ((g1.d[id] || {}).b || 0) >= total, id + ': voley3d.gym apunta el intento (' + n0 + ' → ' + n1 + ') y el récord');
      let exp = 0; for (let lv = ((g0.xp || {})[id] || 0) + 1; lv <= ((g1.xp || {})[id] || 0); lv++) exp += [30, 50, 80][lv - 1];
      check(x1[0] - x0[0] === exp && x1[1] - x0[1] === exp, id + ': experiencia +' + (x1[0] - x0[0]) + '/+' + (x1[1] - x0[1]) + ' (esperada +' + exp + ' por medallas nuevas, nada más)');
      check(!pg.errors.length, id + ': sin errores JS' + (pg.errors.length ? ': ' + pg.errors.slice(0, 2).join(' | ') : ''));
    }
    // peloteo libre
    await pg.navigate('drill=free&gymauto=1&seed=7&nonews=1'); await ready(pg); pg.errors.length = 0;
    await sleep(25000);
    const fr = await pg.evalJs('JSON.stringify({s:VB.ctx.state,sc:VB.ctx.game.score,st:VB.ctx.game.sets,d:VB.ctx.game.drill&&VB.ctx.game.drill.kind})');
    const F = JSON.parse(fr);
    check(F.d === 'free' && F.s !== 'over' && F.sc.join() === '0,0' && F.st.join() === '0,0', 'peloteo libre: sin final y marcador a 0 (' + fr + ')');
    check(!pg.errors.length, 'peloteo libre: sin errores JS');
    pg.close(); pg = null;
    await navFlows(CDP, sleep, vis, waitFor, ready, NOINTRO);
  } finally { if (pg) pg.close(); }
}

/** Navegación real: teclado (1280×720), táctil (844×390) y mando falso. */
async function navFlows(CDP, sleep, vis, waitFor, ready, NOINTRO) {
  const PAD = fs.readFileSync(path.join(__dirname, 'padplay.js'), 'utf8').match(/const PAD = `([\s\S]*?)`;/)[1].replace('__PADID__', JSON.stringify('Mando virtual de pruebas (STANDARD GAMEPAD)'));
  // elemento visible por selector o por texto; devuelve su centro y lo enfoca
  const find = (sel, text) => `(function(){var L=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)})).filter(function(e){
      var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&e.offsetParent!==null&&${text ? 'new RegExp(' + JSON.stringify(text) + ',"i").test(e.textContent)' : 'true'};});
    var e=L[0];if(!e)return null;try{e.focus();}catch(x){}var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,f:document.activeElement===e};})()`;
  for (const mode of ['teclado', 'táctil', 'mando']) {
    const touch = mode === 'táctil';
    const pg = await CDP.open({ size: touch ? '844x390' : '1280x720', touch, init: [NOINTRO].concat(mode === 'mando' ? [PAD] : []) });
    try {
      await pg.navigate('nonews=1'); await ready(pg); await sleep(2500);
      if (mode === 'mando') { await pg.evalJs('__pad.connect()'); await sleep(300); }
      const key = async (k, code, vk) => {
        await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: k === 'Enter' ? '\r' : undefined });
        await sleep(60); await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250);
      };
      const pad = async b => { await pg.evalJs(`__pad.set(null,{${b}:1})`); await sleep(110); await pg.evalJs(`__pad.set(null,{${b}:0})`); await sleep(260); };
      const tap = async (x, y) => {
        await pg.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60);
        await pg.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
      };
      const act = async (sel, text, what) => {
        const p = await pg.evalJs(find(sel, text));
        if (!check(p, mode + ': encuentro ' + what)) return false;
        if (touch) await tap(p.x, p.y); else if (mode === 'mando') await pad(0); else await key('Enter', 'Enter', 13);
        return true;
      };
      if (!await act('button,.mode', '^\\s*Jugar', '«Jugar» en el menú')) continue;
      if (!await act('#btnGym,.m-gym', '', 'la tarjeta Entrenamiento')) continue;
      check(await waitFor(pg, vis('#mpGym'), 3000), mode + ': página Entrenamiento (#mpGym)');
      if (!await act('#mpGym .mi', '', 'la 1ª fila de ejercicio')) continue;
      check(await waitFor(pg, 'VB.ctx.game&&VB.ctx.game.drill&&VB.ctx.state!=="menu"', 8000), mode + ': empieza el ejercicio');
      await sleep(3500);
      if (touch) { const p = await pg.evalJs(find('#btnPause,.pause-btn,[data-act="pause"]', '')); if (p) await tap(p.x, p.y); else await pg.evalJs('VB.ctx.actions.pause()'); }
      else if (mode === 'mando') await pad(9); else await key('Escape', 'Escape', 27);
      check(await waitFor(pg, 'VB.ctx.state==="paused"', 3000), mode + ': pausa');
      await sleep(400);
      if (!await act('button', 'Salir al entrenamiento', '«Salir al entrenamiento» en la pausa')) continue;
      check(await waitFor(pg, 'VB.ctx.state==="menu"&&' + vis('#mpGym'), 6000), mode + ': vuelve a la página Entrenamiento');
      check(!pg.errors.length, mode + ': sin errores JS' + (pg.errors.length ? ': ' + pg.errors.slice(0, 2).join(' | ') : ''));
    } finally { pg.close(); }
  }
}

(async () => {
  if (process.env.NOCDP !== '1') {
    console.log('== navegador ==');
    try { await browser(); } catch (e) { check(false, 'navegador: ' + (e && e.stack || e)); }
  }
  console.log(fail ? '== ' + fail + ' FALLOS ==' : '== gymtest OK ==');
  process.exit(fail ? 1 : 0);
})();
