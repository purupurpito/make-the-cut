#!/usr/bin/env node
/* VOLEY 3D — tools/drive6.js  (owner: sim desde el 11-nov-2026; antes ui_main)
 * 6 contra 6 con HUMANO (sprint 3) en el juego REAL (Chrome headless vía DevTools, como tools/drive.js), con teclado:
 * menú → JUGAR → tarjeta «6 contra 6» → preparación (fila Formato en 6 contra 6, Escenario y Controlar fijos; ←/→ en Formato
 * cambia a 2 contra 2 y vuelve) → ¡A JUGAR! → partido 6v6 en el pabellón llevando al receptor (n.º 2) → juega con el teclado
 * (flechas mantenidas al balón cuando es suyo y, si no, a su sitio de la formación, VB.AI6.spot: el personaje ya no se mueve
 * solo; J en la ventana de golpeo, Espacio para rematar y bloquear, C = «¡Pídela!») hasta jugar puntos y sacar él (saque humano
 * con la rotación) → pausa → seguir.
 * Comprueba: sin errores JS, puntos jugados, toques del humano, saque humano, control fijo (sin eventos switch), pabellón, que el
 * personaje no se mueve solo (quieto unos segundos sin balón suyo: no se desplaza) y la marca de posición (fx posMark).
 * Capturas en tools/out/arte/6v6s3/drive6-<W>x<H>-*.png. TOUCH=1 emula pantalla táctil (el teclado sigue mandando).
 * Uso: node tools/drive6.js [W=1280] [H=720] [segundos reales=70] [query extra]
 * Sale con 1 si hay excepciones o el flujo no avanza.
 */
'use strict';
const fs = require('fs'), path = require('path');
const W = +(process.argv[2] || 1280), H = +(process.argv[3] || 720), SECS = +(process.argv[4] || 70);
const EXTRA = process.argv[5] || '';
const OUT = path.join(__dirname, 'out', 'arte', '6v6s3');
fs.mkdirSync(OUT, { recursive: true });
const CDP = require('./cdp.js');
let page = null;
process.on('exit', () => { if (page) page.close(); });
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, (SECS + 200) * 1000).unref();

const sleep = ms => new Promise(r => setTimeout(r, ms));
let send;
async function evalJs(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result && r.result.value; }
const KEYS = { ' ': ['Space', 32], Enter: ['Enter', 13], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], p: ['KeyP', 80], j: ['KeyJ', 74], c: ['KeyC', 67], Escape: ['Escape', 27] };
async function key(type, k) { const [code, kc] = KEYS[k]; await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: kc, text: type === 'keyDown' && k.length === 1 ? k : undefined }); }
async function press(k, ms) { await key('keyDown', k); await sleep(ms || 60); await key('keyUp', k); }
// en partido: con TOUCH=1, dedos de verdad sobre el overlay: joystick (arrastre en la mitad izquierda) y botones GOLPEAR/SACAR,
// SALTAR, ⇄ (varios dedos a la vez, como tools/touchplay.js); sin TOUCH, el teclado (flechas mantenidas)
const TOUCH = process.env.TOUCH === '1', BTN = { j: '.vt-hit', ' ': '.vt-jump', c: '.vt-sw' };
// CDP: touchStart/touchMove llevan TODOS los dedos apoyados; touchEnd solo los que se levantan
const fingers = new Map(), JOY = 1, TAP = 5;
const tpt = (id, p) => ({ x: p.x, y: p.y, id, radiusX: 9, radiusY: 9, force: 1 });
async function touchSend(type) { await send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers].map(([id, p]) => tpt(id, p)) }); }
async function fdown(id, x, y) { fingers.set(id, { x, y }); await touchSend('touchStart'); }
async function fmove(id, x, y) { fingers.set(id, { x, y }); await touchSend('touchMove'); }
async function fup(id) { const p = fingers.get(id); if (!p) return; fingers.delete(id); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [tpt(id, p)] }); }
async function act(k, ms) {
  if (!TOUCH) return press(k, ms);
  if (!BTN[k]) return sleep(ms || 40);
  const r = await evalJs("(function(){var e=document.querySelector('" + BTN[k] + "');if(!e)return null;var b=e.getBoundingClientRect(),cs=getComputedStyle(e);return b.width>0&&cs.display!=='none'&&cs.visibility!=='hidden'?{x:b.left+b.width/2,y:b.top+b.height/2}:null})()");
  if (!r) return;
  await fdown(TAP, r.x, r.y); await sleep(ms || 50); await fup(TAP);
  touches++;
}
let touches = 0;
// movimiento: dirección de pantalla (ux derecha, uy abajo) y distancia; null = soltar. Teclado: flechas mantenidas (hasta 2, en
// diagonal); táctil: el joystick arrastrado hacia ahí (cerca, suave; lejos, a fondo)
const held = new Set(); let joyOn = false, joyR = 58, jx0 = 0, jy0 = 0, moves = 0;
async function steer(m) {
  if (TOUCH) {
    if (!m) { if (joyOn) { await fup(JOY); joyOn = false; } return; }
    const k = Math.min(1, 0.45 + m.d * 0.35) * joyR * 0.95;
    if (!joyOn) { await fdown(JOY, jx0, jy0); joyOn = true; await sleep(16); }
    await fmove(JOY, jx0 + m.ux * k, jy0 + m.uy * k); moves++; return;
  }
  const want = new Set();
  if (m) { if (Math.abs(m.ux) > 0.38) want.add(m.ux > 0 ? 'ArrowRight' : 'ArrowLeft'); if (Math.abs(m.uy) > 0.38) want.add(m.uy > 0 ? 'ArrowDown' : 'ArrowUp'); }
  for (const k of [...held]) if (!want.has(k)) { held.delete(k); await key('keyUp', k); }
  for (const k of want) if (!held.has(k)) { held.add(k); await key('keyDown', k); moves++; }
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, 'drive6-' + W + 'x' + H + '-' + name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('captura', f); }
async function waitFor(expr, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(120); } return false; }

// Saque humano (solo si saca SU jugador, g.ctrl): espera el silbato, J lanza y J golpea en el momento ideal
async function serve(onReady) {
  if (!(await waitFor("(function(g){return g.mode!=='serve'||g.serveAuth})(VB.ctx.game)", 4000))) return 'sinsilbato';
  if (!(await evalJs("(function(g){return g.mode==='serve'&&g.server===g.ctrl&&g.serveState==='ready'})(VB.ctx.game)"))) return 'nosaque';
  await steer(null);
  if (onReady) await onReady();
  await act('ArrowRight', 200);   // se desplaza por el fondo
  await act('j', 40);
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    const t = await evalJs("(function(g){if(g.mode!=='serve'||g.serveState!=='toss')return -9;var w=VB.Sim.hitWindow(g,g.server);return w?w.t/Math.max(0.05,VB.ctx.timeScale):-9})(VB.ctx.game)");
    if (t === -9 || t == null) break;
    if (t > 0.25) { await sleep(60); continue; }
    await sleep(Math.max(0, t * 1000 - 25)); await act('j', 40); return 'ok';
  }
  return 'ok';
}
// decisión de este instante (en la página): flecha hacia el balón si es suyo, saltar (remate o bloqueo), segundos hasta el
// instante ideal de pulsar J y si toca pedir el balón (C)
const DECIDE = `(function(){var g=VB.ctx.game,p=g.ctrl,S=VB.Sim,o={m:g.mode,mv:null,jump:false,press:9,ask:false,mark:false};
  if(g.mode==='serve'){o.m=g.server===p?'serve':'wait';return JSON.stringify(o);}
  if(g.mode!=='rally')return JSON.stringify(o);
  var ts=Math.max(0.05,VB.ctx.timeScale||1),job=g.jobs[0]===p,w=S.hitWindow(g,p);
  var b=VB.CameraRig.getBasis(),tg=job?S.focusPoint(g):VB.AI6.spot(g,p),tx=tg.x+(job?0.2:0),ty=tg.y,dx=tx-p.x,dy=ty-p.y,d=Math.hypot(dx,dy);
  if(p.z<=0.05&&d>(job?0.4:0.5)){var sx=dx*b.rx+dy*b.ry,sy=dx*b.fx+dy*b.fy,l=Math.hypot(sx,sy)||1;o.mv={ux:sx/l,uy:-sy/l,d:d};}
  if(job){
    if(w.attack&&p.z===0&&w.jumpT<0.14&&w.jumpT>-0.1)o.jump=true;
    if(w.reach||w.canReach||Math.hypot(g.ball.x-p.x,g.ball.y-p.y)<2.6)o.press=w.press/ts;}
  if(!job&&p.front&&p.z===0&&g.touchTeam===1&&g.touches===2&&Math.abs(p.x)<1.4){for(var i=0;i<g.teams[1].length;i++){var q=g.teams[1][i];if(q.z>0.4&&q.vz<1.2&&Math.abs(q.x)<4)o.jump=true;}}
  if(p.front&&g.touchTeam===0&&g.touches===1&&g.time-g.ask6>3)o.ask=true;
  var dbg=VB.FX&&VB.FX._dbg&&VB.FX._dbg();if(dbg&&dbg.decOrder){for(var k=0;k<dbg.decOrder.length;k++){var q=dbg.decOrder[k];if(q.name==='posMark'&&q.visible)o.mark=true;}}
  return JSON.stringify(o);})()`;

(async () => {
  let fail = 0; const check = (c, m) => { if (!c) { fail++; console.error('FALLO:', m); } else console.log('ok:', m); };
  try {
    page = await CDP.open({ size: W + 'x' + H, touch: process.env.TOUCH === '1' }); send = page.send;
    await page.navigate(EXTRA);
    await sleep(3000);
    check(await evalJs("VB.ctx.state==='menu'&&VB.ctx.game.demo"), 'arranca en el menú');
    // JUGAR → tarjetas; → → hasta «6 contra 6»; Intro → preparación con Formato en 6 contra 6
    await press('Enter'); await sleep(450);
    check(await evalJs("VB.UI.menuPage()==='play'&&document.activeElement.id==='btnQuick'"), 'JUGAR abre los modos');
    await press('ArrowRight'); await sleep(150); await press('ArrowRight'); await sleep(200);
    check(await evalJs("document.activeElement.id==='btn6v6'&&!document.getElementById('btn6v6').disabled"), 'la tarjeta 6 contra 6 está activa y se llega con →');
    await press('Enter'); await sleep(500);
    check(await evalJs("VB.UI.menuPage()==='quick'&&VB.ctx.settings.format==='6v6'&&document.getElementById('fmtVal').textContent==='6 contra 6'"), 'la tarjeta abre la preparación con Formato «6 contra 6»');
    check(await evalJs("document.getElementById('optVenue').classList.contains('lock')&&document.getElementById('venueVal').textContent==='Pabellón'&&document.getElementById('ctrlVal').textContent==='Receptor'"), '6v6: Escenario fijo en Pabellón y Controlar fijo en Receptor');
    // ←/→ en la fila Formato (↑ desde ¡A JUGAR! hasta la primera fila)
    for (let i = 0; i < 5; i++) { await press('ArrowUp'); await sleep(110); }
    check(await evalJs("document.activeElement.id==='optFmt'"), '↑ llega a la fila Formato (la primera)');
    await press('ArrowLeft'); await sleep(250);
    check(await evalJs("VB.ctx.settings.format==='2v2'&&!document.getElementById('optVenue').classList.contains('lock')&&document.getElementById('fmtVal').textContent==='2 contra 2'"), '← en Formato pasa a 2 contra 2 (Escenario se desbloquea)');
    await press('ArrowRight'); await sleep(250);
    check(await evalJs("VB.ctx.settings.format==='6v6'"), '→ vuelve a 6 contra 6');
    await press('ArrowDown'); await sleep(110); await press('ArrowLeft'); await sleep(250);
    // (en 6v6 la fila Escenario —fija en Pabellón— se oculta y en su sitio sale Cámara: 3ª persona / Televisión, ajuste cam6)
    check(await evalJs("document.getElementById('optVenue').hidden&&!document.getElementById('optCam6').hidden&&document.activeElement.id==='optCam6'&&VB.ctx.settings.cam6==='tv'&&document.getElementById('cam6Val').textContent==='Televisión'&&document.getElementById('venueVal').textContent==='Pabellón'"), '6v6: Escenario oculto y en su sitio la fila Cámara (← de 3ª persona da la vuelta a Televisión)');
    await press('ArrowRight'); await sleep(250);
    check(await evalJs("VB.ctx.settings.cam6==='3p'&&document.getElementById('cam6Val').textContent==='3ª persona'"), '→ en Cámara vuelve a 3ª persona');
    await shot('menu');
    for (let i = 0; i < 8 && !(await evalJs("document.activeElement.id==='btnGo'")); i++) { await press('ArrowDown'); await sleep(110); }
    check(await evalJs("document.activeElement.id==='btnGo'"), '↓ vuelve a ¡A JUGAR!');
    await press('Enter'); await sleep(500);
    if (await evalJs("VB.UI.isPanelOpen&&VB.UI.isPanelOpen()")) { await press('ArrowDown'); await sleep(150); await press('Enter'); } // «Primer partido» → Jugar ya
    check(await waitFor("VB.ctx.state==='playing'&&!VB.ctx.game.demo", 9000), 'empieza el partido');
    check(await evalJs("(function(g){return g.size===6&&!g.watch&&!g.autopilot&&g.ctrlMode==='one'&&g.ctrl.role==='OH'&&g.ctrl.num===2&&VB.Arena.venue()==='hall'})(VB.ctx.game)"),
      'partido 6v6 humano: llevas al receptor n.º 2, en el pabellón');
    await sleep(600); await press('Escape'); await sleep(50); await press('p'); await sleep(300);   // (salta la presentación si la hay)
    if (await evalJs("VB.ctx.state==='paused'")) { await press('p'); await sleep(300); }
    if (TOUCH) { // el menú se ha llevado con el teclado: un toque en la pista (arriba, lejos de los botones) devuelve el dispositivo al táctil
      const p = { x: Math.round(W * 0.55), y: Math.round(H * 0.3), id: 4, radiusX: 9, radiusY: 9, force: 1 };
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] }); await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [p] }); await sleep(400);
    }
    await evalJs(`window.__s6={hits:0,pts:0,serves:0,sok:0,sw:0,blk:0,spk:0,ask:0,lastAsk:-9};(function(){var o=VB.Sim.step;VB.Sim.step=function(g,dt,i){var n=g.events.length;o(g,dt,i);
      for(var k=n;k<g.events.length;k++){var e=g.events[k],s=window.__s6;if(e.type==='hit'&&e.human){s.hits++;if(e.kind==='serve')s.sok++;if(e.kind==='spike')s.spk++;}
      if(e.type==='point')s.pts++;if(e.type==='serveReady'&&e.player===g.ctrl)s.serves++;if(e.type==='switch')s.sw++;if(e.type==='block'&&e.human)s.blk++;}
      if(g.ask6!==window.__s6.lastAsk){window.__s6.lastAsk=g.ask6;if(g.ask6>0)window.__s6.ask++;}};})()`);
    if (TOUCH) { joyR = (await evalJs("(function(){var b=document.querySelector('.vt-base');return b?b.getBoundingClientRect().width/2:58})()")) || 58; jx0 = Math.round(W * 0.2); jy0 = Math.round(H * 0.62); }
    const still = { done: false, d: 0, n: 0 }; let markSeen = 0;
    const t0 = Date.now(); let shotServe = false, shotRally = false, rallyT = 0, lastAsk = 0;
    while (Date.now() - t0 < SECS * 1000 || (!(await evalJs('window.__s6.sok')) && Date.now() - t0 < (SECS + 90) * 1000)) {
      if (await evalJs("VB.ctx.state==='paused'")) { await press('p'); await sleep(200); continue; }
      const d = JSON.parse(await evalJs(DECIDE));
      if (d.m === 'serve') { await serve(async () => { if (!shotServe) { shotServe = true; await sleep(400); await shot('saque'); } }); continue; }
      if (d.m !== 'rally') { await steer(null); await sleep(150); continue; }
      // sin saque humano a mitad de prueba y sacando su equipo (el colocador no pierde el saque): deja de jugar para que el equipo
      // pierda el saque y, al recuperarlo, rote y saque el n.º 2
      if (Date.now() - t0 > SECS * 500 && (await evalJs('!window.__s6.sok&&VB.ctx.game.serving===0'))) { await steer(null); await sleep(150); continue; }
      // personaje sin movimientos solos: una vez, ~2 s sin tocar nada con el balón en el campo rival y sin balón suyo → no se desplaza
      if (!still.done && Date.now() - t0 > 8000 && (await evalJs('(function(g){return g.mode==="rally"&&g.touchTeam===1&&g.jobs[0]!==g.ctrl&&g.ctrl.z===0})(VB.ctx.game)'))) {
        await steer(null); await sleep(150);
        const a = await evalJs('(function(g){return {x:g.ctrl.x,y:g.ctrl.y}})(VB.ctx.game)');
        let maxD = 0, ok = 0;
        for (let k = 0; k < 10; k++) {
          await sleep(180);
          const c = await evalJs('(function(g){return {x:g.ctrl.x,y:g.ctrl.y,mode:g.mode,job:g.jobs[0]===g.ctrl}})(VB.ctx.game)');
          if (c.mode !== 'rally' || c.job) break;
          maxD = Math.max(maxD, Math.hypot(c.x - a.x, c.y - a.y)); ok++;
        }
        if (ok >= 4) { still.done = true; still.d = maxD; still.n = ok; }
        continue;
      }
      if (!rallyT) rallyT = Date.now();
      if (!shotRally && Date.now() - rallyT > 1500 && (await evalJs('VB.ctx.game.touchTeam===0&&VB.ctx.game.touches>=1'))) { shotRally = true; await shot('peloteo'); }
      if (d.ask && Date.now() - lastAsk > 4000) { lastAsk = Date.now(); await act('c', 40); }
      if (d.jump) await act(' ', 40);
      await steer(d.mv);
      if (d.mark) markSeen++;
      if (d.press < 0.32 && d.press > -0.08) { await sleep(Math.max(0, d.press * 1000 - 30)); await act('j', 35); continue; }
      await sleep(40);
    }
    await steer(null);
    const s = await evalJs('window.__s6');
    console.log('6v6 humano:', JSON.stringify(s));
    check(s.pts >= 3, 'se juegan puntos (' + s.pts + ')');
    check(s.hits >= 2, 'el humano toca el balón (' + s.hits + ' toques, ' + s.spk + ' remates, ' + s.blk + ' bloqueos)');
    check(s.serves >= 1 && s.sok >= 1, 'saque humano con la rotación (' + s.serves + ' turnos, ' + s.sok + ' sacados)');
    check(s.sw === 0, 'control fijo: sin eventos switch en 6v6');
    check(moves > 5, (TOUCH ? 'el joystick mueve' : 'las flechas mueven') + ' al personaje (' + moves + ' órdenes)');
    check(still.done && still.d < 0.15, 'sin tocar nada, el personaje no se mueve solo (' + (still.done ? still.d.toFixed(2) + ' m en ' + still.n + ' muestras' : 'sin muestra') + ')');
    check(markSeen > 0, 'marca de posición en el suelo cuando estás lejos de tu sitio (' + markSeen + ' muestras)');
    check(s.ask >= 1, (TOUCH ? '⇄' : 'C') + ' pide el balón («¡Pídela!», g.ask6: ' + s.ask + ')');
    if (TOUCH) check(touches > 0 && (await evalJs('VB.Input.overlayShown()')), 'táctil: overlay en partido y toques de dedo (' + touches + ')');
    if (!shotRally) await shot('peloteo');
    await press('p'); await waitFor("VB.ctx.state==='paused'", 6000);
    check(await evalJs("VB.ctx.state==='paused'"), 'P pausa');
    await press('p'); await waitFor("VB.ctx.state==='playing'", 6000);
    check(await evalJs("VB.ctx.state==='playing'"), 'P reanuda');
  } catch (e) { fail++; console.error('ERROR del driver:', e); }
  if (page.errors.length) { fail++; console.error('ERRORES EN LA PÁGINA:\n' + page.errors.slice(0, 10).join('\n')); }
  else console.log('sin errores de página');
  console.log(fail ? fail + ' FALLOS' : 'TODO OK');
  process.exit(fail ? 1 : 0);
})();
