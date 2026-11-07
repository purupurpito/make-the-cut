#!/usr/bin/env node
/* VOLEY 3D — tools/touchplay.js (owner: ui_main)
 * Juega un partido REAL con el dedo: Input.dispatchTouchEvent (DevTools) sobre el overlay táctil de verdad
 * (joystick arrastrando en la mitad izquierda, botones GOLPEAR/SACAR, SALTAR, ⇄ y pausa), en móvil emulado.
 * Comprueba, por cada tamaño:
 *   - menú con toques: JUGAR → (primer partido) "Jugar ya"; Ajustes y vuelta; nivel con un toque
 *   - el overlay táctil aparece en partido; saque por toque (lanzar + golpear con SACAR en el momento justo)
 *   - el joystick mueve al jugador HACIA el balón; al menos MIN toques humanos de balón con GOLPEAR; SALTAR salta; ⇄ cambia
 *   - pausa con el botón táctil y vuelta con "Seguir" tocado; ajustes desde la pausa; salir al menú
 *   - "Gira el móvil" en vertical (390x844): la sim se para; al volver a horizontal sigue
 * Capturas por paso en tools/out/touchplay/<WxH>/. Sale con 1 si falla algo.
 * Uso: node tools/touchplay.js [tamaños=844x390,667x375] [segundos de juego=35] [toques mínimos=3]
 * Variables: DPR=2 (devicePixelRatio) · GL=swiftshader (software; añade quality=low&maxdt=0.25) · EXTRA=query extra.
 */
'use strict';
const fs = require('fs'), path = require('path');
const CDP = require('./cdp.js');
const SIZES = (process.argv[2] || '844x390,667x375').split(',').filter(Boolean);
const SECS = +(process.argv[3] || 35), MIN_TOUCHES = +(process.argv[4] || 3);
const DPR = +(process.env.DPR || 2), SOFT = process.env.GL === 'swiftshader';
const EXTRA = process.env.EXTRA != null ? process.env.EXTRA : (SOFT ? 'quality=low&maxdt=0.25' : '');
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, SIZES.length * (SECS + 150) * 1000).unref();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Contadores de eventos de la sim (se instalan en la página tras cargar; mismo método que drive.js)
const HOOK = `(function(){if(window.__tp)return;var T=window.__tp={hits:0,serves:0,tosses:0,jumps:0,swManual:0,points:0,lastHit:null};
  var o=VB.Sim.step;VB.Sim.step=function(g,dt,i){var n=g.events.length;o(g,dt,i);for(var k=n;k<g.events.length;k++){var e=g.events[k];
    if(e.type==='hit'&&e.human){T.hits++;T.lastHit=e.kind;if(e.kind==='serve')T.serves++;}
    if(e.type==='toss'&&e.human)T.tosses++;
    if(e.type==='jump'&&e.player&&e.player.team===0&&e.player===g.ctrl)T.jumps++;
    if(e.type==='switch'&&!e.auto)T.swManual++;
    if(e.type==='point')T.points++;}};})()`;

async function runSize(size) {
  const [W, H] = size.split('x').map(Number);
  const OUT = path.join(__dirname, 'out', 'touchplay', size);
  fs.mkdirSync(OUT, { recursive: true });
  let fail = 0, step = 0;
  const check = (c, m) => { if (!c) { fail++; console.error('  FALLO:', m); } else console.log('  ok:', m); return !!c; };
  const page = await CDP.open({ size, touch: true, mobile: true, dpr: DPR, ua: CDP.ANDROID_UA });
  const { send, evalJs } = page;
  const shot = async name => { const f = path.join(OUT, String(++step).padStart(2, '0') + '-' + name + '.png'); await page.shot(f); return f; };
  const waitFor = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(100); } return false; };

  // ---- dedos (varios a la vez: joystick + botón) ----
  const fingers = new Map();
  // CDP (medido): touchStart/touchMove llevan TODOS los dedos apoyados; touchEnd lleva SOLO los que se levantan
  // (un touchMove sin un dedo no lo suelta y el botón se queda pulsado).
  const pt = (id, p) => ({ x: p.x, y: p.y, id, radiusX: 9, radiusY: 9, force: 1 });
  async function touchSend(type) { await send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers].map(([id, p]) => pt(id, p)) }); }
  async function down(id, x, y) { fingers.set(id, { x, y }); await touchSend('touchStart'); }
  async function move(id, x, y) { fingers.set(id, { x, y }); await touchSend('touchMove'); }
  async function up(id) {
    const p = fingers.get(id); if (!p) return;
    fingers.delete(id);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pt(id, p)] });
  }
  async function rectOf(sel) {
    return evalJs(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect(),cs=getComputedStyle(e);
      var vis=r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&!e.closest('[hidden]');
      return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,vis:vis,l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
  }
  async function tap(sel, id, ms) {
    const r = await rectOf(sel);
    if (!r || !r.vis) return false;
    id = id == null ? 7 : id;
    await down(id, r.x, r.y); await sleep(ms || 70); await up(id);
    return true;
  }

  try {
    // ================= MENÚ =================
    await page.navigate(EXTRA);
    await sleep(2500);
    const env = await evalJs('JSON.stringify({t:VB.ctx.isTouch,m:VB.ctx.isMobile,dpr:devicePixelRatio,w:innerWidth,h:innerHeight,s:VB.ctx.state})');
    console.log('  entorno', env);
    const E = JSON.parse(env);
    check(E.t && E.m && E.s === 'menu', 'detecta móvil táctil y arranca en el menú');
    check(E.w === W && E.h === H, 'viewport exacto ' + E.w + 'x' + E.h);
    await shot('menu');
    // nivel: un toque cambia la dificultad
    const d0 = await evalJs('VB.ctx.settings.difficulty');
    await tap('#optDiff'); await sleep(250);
    const d1 = await evalJs('VB.ctx.settings.difficulty');
    check(d1 && d1 !== d0, 'tocar NIVEL cambia la dificultad (' + d0 + ' → ' + d1 + ')');
    // vuelve a Fácil (el bot humano no es un jugador de élite)
    for (let i = 0; i < 4 && (await evalJs('VB.ctx.settings.difficulty')) !== 'easy'; i++) { await tap('#optDiff'); await sleep(200); }
    // ajustes y vuelta
    await tap('#btnSettings'); await sleep(450);
    check(await evalJs("VB.UI.isPanelOpen&&VB.UI.isPanelOpen()&&!document.getElementById('pnSet').hidden"), 'tocar AJUSTES abre el panel');
    await shot('ajustes');
    await tap('#btnPanelBack'); await sleep(450);
    check(await evalJs("!(VB.UI.isPanelOpen&&VB.UI.isPanelOpen())&&!document.getElementById('menu').hidden"), 'tocar VOLVER cierra el panel');
    // JUGAR → primer partido: "Ver cómo se juega / Jugar ya"
    await tap('#btnPlay'); await sleep(500);
    if (await evalJs("!document.getElementById('pnFirst').hidden")) {
      console.log('  primer partido: elección tutorial / jugar ya');
      await shot('primer-partido');
      await tap('#btnFirstPlay');
    }
    check(await waitFor("VB.ctx.state==='playing'", 6000), 'tocar JUGAR empieza el partido');
    await evalJs(HOOK);
    await sleep(600);
    check(await waitFor('VB.Input.overlayShown&&VB.Input.overlayShown()', 3000), 'el overlay táctil aparece en partido');
    const rs = { hit: await rectOf('.vt-hit'), jump: await rectOf('.vt-jump'), sw: await rectOf('.vt-sw'), pause: await rectOf('.vt-pause'), zone: await rectOf('.vt-zone') };
    console.log('  botones', Object.entries(rs).map(([k, r]) => r ? k + ' ' + Math.round(r.l) + ',' + Math.round(r.t) + ' ' + Math.round(r.w) + 'x' + Math.round(r.h) : k + ' ?').join(' · '));
    check(rs.hit && rs.hit.vis && rs.jump && rs.jump.vis && rs.pause && rs.pause.vis, 'botones GOLPEAR, SALTAR y pausa visibles');
    check(rs.hit && rs.hit.r <= W && rs.hit.b <= H && rs.pause.t >= 0, 'botones dentro de la pantalla');

    // ================= SAQUE POR TOQUE =================
    // espera el silbato; SACAR lanza; SACAR otra vez cuando hitWindow dice que el balón llega a la mano
    async function serveTouch() {
      if (!(await waitFor("(function(g){return g.mode!=='serve'||g.serveAuth})(VB.ctx.game)", 5000))) return 'sinsilbato';
      if (!(await evalJs("(function(g){return g.mode==='serve'&&g.server&&g.server.team===0&&g.serveState==='ready'})(VB.ctx.game)"))) return 'nosaque';
      const lbl = await evalJs("(document.querySelector('.vt-hit span')||{}).textContent");
      await tap('.vt-hit', 3, 50);
      const t0 = Date.now();
      while (Date.now() - t0 < 2600) {
        const t = await evalJs("(function(g){if(g.mode!=='serve'||g.serveState!=='toss')return -9;var w=VB.Sim.hitWindow(g,g.server);return w?w.t/Math.max(0.05,VB.ctx.timeScale):-9})(VB.ctx.game)");
        if (t === -9 || t == null) break;
        if (t > 0.22) { await sleep(60); continue; }
        await sleep(Math.max(0, t * 1000 - 35)); await tap('.vt-hit', 3, 45); return 'ok:' + lbl;
      }
      return 'sintiempo';
    }
    let sv = 'nosaque';
    for (let i = 0; i < 3 && sv === 'nosaque'; i++) { sv = await serveTouch(); if (sv === 'nosaque') await sleep(400); }
    await sleep(500);
    let tp = JSON.parse(await evalJs('JSON.stringify(window.__tp)'));
    console.log('  saque:', sv, 'lanzamientos', tp.tosses, 'saques', tp.serves);
    check(/^ok:SACAR$/.test(sv), 'el botón dice SACAR en tu saque');
    check(tp.tosses >= 1, 'SACAR lanza el balón (toss humano)');
    check(tp.serves >= 1, 'SACAR en el momento justo golpea el saque');
    await shot('saque');

    // ================= JUEGO: joystick + GOLPEAR =================
    const JOY = 1, BTN = 2;
    const R = await evalJs("(function(){var b=document.querySelector('.vt-base');return b?b.getBoundingClientRect().width/2:58})()") || 58;
    const jx0 = Math.round(W * 0.2), jy0 = Math.round(H * 0.62);
    let joyOn = false, toward = 0, samples = 0, jumpsTried = 0, swTried = 0, lastSw = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < SECS * 1000) {
      // dirección hacia el punto donde hay que jugar el balón, en coordenadas de pantalla (x derecha, y abajo)
      const s = await evalJs(`(function(){var g=VB.ctx.game,p=g.ctrl;if(VB.ctx.state!=='playing')return {st:VB.ctx.state};
        if(g.mode==='serve')return {serve:1,mine:!!(g.server&&g.server.team===0)};
        if(g.mode!=='rally')return {idle:1};
        var f=VB.Sim.focusPoint(g),b=VB.CameraRig.getBasis(),dx=f.x+0.2-p.x,dy=f.y-p.y,d=Math.hypot(dx,dy);
        var sx=dx*b.rx+dy*b.ry,sy=dx*b.fx+dy*b.fy,l=Math.hypot(sx,sy)||1;
        var w=VB.Sim.hitWindow(g,p),ts=Math.max(0.05,VB.ctx.timeScale);
        var sp=Math.hypot(p.vx||0,p.vy||0),dot=sp>0.2?((p.vx||0)*dx+(p.vy||0)*dy)/(sp*(d||1)):0;
        return {d:d,ux:sx/l,uy:-sy/l,dot:dot,sp:sp,w:w&&w.canReach&&!w.active&&w.t>0?(w.press/ts):9,att:!!(w&&w.attack),jt:w&&w.jumpT!=null?w.jumpT/ts:9,mine:g.touchTeam===0||g.touchTeam<0||true,
          rec:VB.Sim.canReach(g,p),ctrl:p.id,air:!p.onGround}})()`);
      if (s.st) { await sleep(150); continue; }
      if (s.serve) {
        if (joyOn) { await up(JOY); joyOn = false; }
        if (s.mine) { const r = await serveTouch(); if (r === 'nosaque' || r === 'sinsilbato') await sleep(200); } else await sleep(150);
        continue;
      }
      if (s.idle) { if (joyOn) { await up(JOY); joyOn = false; } await sleep(120); continue; }
      // joystick: arrastra desde el centro hacia el foco (cerca: suave; lejos: a fondo)
      if (s.d > 0.35) {
        const k = Math.min(1, 0.45 + s.d * 0.35) * R * 0.95;
        const x = jx0 + s.ux * k, y = jy0 + s.uy * k;
        if (!joyOn) { await down(JOY, jx0, jy0); joyOn = true; await sleep(16); }
        await move(JOY, x, y);
        samples++; if (s.dot > 0.3 || s.d < 0.6) toward++;
      } else if (joyOn) { await up(JOY); joyOn = false; }
      // golpear en el momento justo (press = s hasta el instante ideal de pulsar); remate: SALTAR antes
      if (s.att && s.jt > 0 && s.jt < 0.12 && !s.air) { await tap('.vt-jump', BTN, 50); jumpsTried++; }
      else if (s.w < 0.09 && s.w > -0.05) { await tap('.vt-hit', BTN, 45); await sleep(120); }
      // ⇄ cambia de jugador (una vez cada ~8 s, con el balón en campo rival)
      if (Date.now() - lastSw > 8000 && !s.rec && s.d > 3) { lastSw = Date.now(); if (await tap('.vt-sw', BTN, 50)) swTried++; }
      // SALTAR suelto alguna vez (comprobar que el botón salta aunque no sea remate)
      if (jumpsTried < 2 && s.d > 4 && !s.air && Math.random() < 0.03) { await tap('.vt-jump', BTN, 50); jumpsTried++; }
      await sleep(25);
    }
    if (joyOn) await up(JOY);
    tp = JSON.parse(await evalJs('JSON.stringify(window.__tp)'));
    console.log('  juego: toques humanos', tp.hits, '· saques', tp.serves, '· saltos', tp.jumps, '(intentos ' + jumpsTried + ') · cambios', tp.swManual, '(intentos ' + swTried + ') · puntos', tp.points,
      '· hacia el balón', samples ? Math.round(toward / samples * 100) + '%' : '-');
    check(samples > 20 && toward / samples >= 0.5, 'el joystick lleva al jugador hacia el balón (' + toward + '/' + samples + ')');
    check(tp.hits - tp.serves >= MIN_TOUCHES, 'al menos ' + MIN_TOUCHES + ' toques humanos de balón con GOLPEAR (' + (tp.hits - tp.serves) + ')');
    check(tp.points >= 1, 'se juegan puntos (' + tp.points + ')');
    check(jumpsTried === 0 || tp.jumps >= 1, 'SALTAR salta');
    check(swTried === 0 || tp.swManual >= 1, '⇄ cambia de jugador');
    await shot('juego');

    // ================= PAUSA =================
    await waitFor("VB.ctx.state==='playing'", 3000);
    await tap('.vt-pause', 4, 60);
    check(await waitFor("VB.ctx.state==='paused'", 3000), 'el botón táctil de pausa pausa');
    await sleep(400); await shot('pausa');
    const gt = await evalJs('VB.ctx.game.time'); await sleep(600);
    check((await evalJs('VB.ctx.game.time')) === gt, 'en pausa la sim no avanza');
    await tap('#btnPSettings'); await sleep(450);
    check(await evalJs("VB.UI.isPanelOpen&&VB.UI.isPanelOpen()"), 'AJUSTES desde la pausa');
    await tap('#btnPanelBack'); await sleep(450);
    check(await evalJs("VB.ctx.state==='paused'&&!document.getElementById('pause').hidden"), 'VOLVER regresa a la pausa');
    await tap('#btnResume');
    check(await waitFor("VB.ctx.state==='playing'", 3000), 'tocar SEGUIR reanuda');
    await sleep(500);
    check(await waitFor('VB.Input.overlayShown()', 2000), 'el overlay vuelve tras la pausa');

    // ================= VERTICAL =================
    await page.setSize(H + 'x' + W, true); await sleep(900);
    const pr = JSON.parse(await evalJs("JSON.stringify({pb:VB.ctx.portraitBlock,rot:(function(e){if(!e)return false;var cs=getComputedStyle(e);return !e.hidden&&cs.display!=='none'&&cs.visibility!=='hidden'&&e.getBoundingClientRect().width>0})(document.getElementById('rotate')),txt:(document.getElementById('rotate')||{}).textContent,ov:VB.Input.overlayShown()})"));
    const gp0 = await evalJs('VB.ctx.game.time'); await sleep(500); const gp1 = await evalJs('VB.ctx.game.time');
    await shot('vertical');
    check(pr.pb && pr.rot && /gira/i.test(pr.txt || ''), '"Gira el móvil" en vertical ' + H + 'x' + W + ' (' + (pr.txt || '').trim().slice(0, 40) + ')');
    check(gp0 === gp1, 'en vertical la sim se para');
    check(!pr.ov, 'en vertical no hay controles táctiles encima');
    await page.setSize(size, true); await sleep(900);
    const gp2 = await evalJs('VB.ctx.game.time'); await sleep(500);
    check((await evalJs('VB.ctx.game.time')) > gp2 && !(await evalJs('VB.ctx.portraitBlock')), 'al volver a horizontal el partido sigue');
    await shot('horizontal');

    // ================= SALIR AL MENÚ =================
    await tap('.vt-pause', 4, 60); await waitFor("VB.ctx.state==='paused'", 3000); await sleep(350);
    await tap('#btnQuit');
    check(await waitFor("VB.ctx.state==='menu'", 3000), 'SALIR AL MENÚ con un toque');
    await sleep(500); await shot('menu-final');
    check(!(await evalJs('VB.Input.overlayShown()')), 'en el menú no hay controles táctiles');
  } catch (e) { fail++; console.error('  ERROR del driver:', e && e.stack || e); }
  if (page.errors.length) { fail++; console.error('  ERRORES EN LA PÁGINA:\n   ' + page.errors.slice(0, 8).join('\n   ')); }
  else console.log('  sin errores de página');
  console.log('  capturas en', OUT);
  page.close();
  return fail;
}

(async () => {
  let fail = 0;
  for (const s of SIZES) { console.log('== touchplay ' + s + ' (dpr ' + DPR + ')'); fail += await runSize(s); }
  console.log(fail ? fail + ' FALLOS' : 'TODO OK');
  process.exit(fail ? 1 : 0);
})();
