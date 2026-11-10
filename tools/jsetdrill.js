/* VOLEY 3D — tools/jsetdrill.js (owner: ui_main; lo usan drive.js, touchplay.js y padplay.js)
 * Ejercicio de COLOCACIÓN EN SALTO en el juego REAL con el dispositivo de cada herramienta: con el partido en peloteo,
 * prepara (solo estado de la sim, como las escenas de depuración) un 2.º toque propio: el compañero acaba de recibir y el
 * balón va alto hacia tu jugador (n.º 1), junto a la red. La herramienta pulsa SALTAR cuando toca y, ya en el aire, COLOCAR
 * con su dispositivo (tecla K / clic central / botón táctil COLOCAR / botón X del mando). Cuenta los eventos `hit` con
 * `jset` del humano y si el compañero remata después.
 * Uso: const drill = require('./jsetdrill.js');
 *      const r = await drill(evalJs, { jump: async () => …, set: async () => …, serve: async () => 'ok'|…, check?: async () => {…} }, { tries: 4 });
 *      r = { tries, jsets, spikes, ready, setOn (botón táctil visto), prompt (aviso de dos opciones visto) }
 */
'use strict';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOOK = `(function(){if(window.__jd)return;var J=window.__jd={jsets:0,spikes:0,after:false};var o=VB.Sim.step;
  VB.Sim.step=function(g,dt,i){var n=g.events.length;o(g,dt,i);for(var k=n;k<g.events.length;k++){var e=g.events[k];
    if(e.type==='hit'&&e.jset&&e.human){J.jsets++;J.after=true;}else if(e.type==='hit'&&J.after){if(e.team===0&&e.kind==='spike')J.spikes++;J.after=false;}}};})()`;
// prepara el 2.º toque (devuelve false si ahora no hay peloteo)
const STAGE = `(function(){var g=VB.ctx.game,C=VB.C;if(!g||VB.ctx.state!=='playing'||g.mode!=='rally'||g.review)return false;
  var h=g.teams[0][0],m=g.teams[0][1],b=g.ball,G=C.G;
  for(var i=0;i<4;i++){var q=g.players[i];q.z=0;q.vz=0;q.down=0;q.lvx=q.lvy=0;q.jvx=q.jvy=0;q.cool=0;}
  m.x=5.5;m.y=-1.4;h.x=2.1;h.y=0.6;g.teams[1][0].x=-6.2;g.teams[1][0].y=-2.2;g.teams[1][1].x=-6.2;g.teams[1][1].y=2.2;
  b.held=null;b.x=m.x;b.y=m.y;b.z=0.9;b.dip=0;b.wobA=0;
  var vz=Math.sqrt(2*G*(4.4-0.9)),T=vz/G+Math.sqrt(2*(4.4-1.9)/G);b.vx=(1.9-b.x)/T;b.vy=(h.y-b.y)/T;b.vz=vz;
  g.touchTeam=0;g.touches=1;g.lastPlayer=m;g.lastTeam=0;g.lastKind='pass';g.lastShot='forearm';g.lastTouchT=g.time;
  g.hitBuf=0;g.swingLive=false;g.swingLock=0;g.ctrl=h;g.defRole='';g.atkServe=null;return true;})()`;
// estado del intento: s hasta que el balón baja a la altura de contacto en salto (reloj real), en el aire, jsetReady, press
const POLL = `(function(){var g=VB.ctx.game,C=VB.C,S=VB.Sim,p=g.ctrl,b=g.ball,ts=Math.max(0.05,VB.ctx.timeScale);
  if(!g||g.mode!=='rally')return {gone:1};var zc=1.07+2.2,d=b.vz*b.vz-2*C.G*(zc-b.z),tt=d>0?(b.vz+Math.sqrt(d))/C.G/ts:9;
  var w=S.hitWindow(g,p),set=document.querySelector('#touch .vt-set'),pr=document.getElementById('prompt');
  return {tt:tt,vz:b.vz,air:p.z>0.3,ground:p.z===0&&p.vz===0,ready:!!S.jsetReady(g),press:w&&isFinite(w.press)?w.press/ts:9,
    setOn:!!(set&&set.classList.contains('on')),two:!!(pr&&pr.classList.contains('two')&&!pr.classList.contains('off')),last:g.lastPlayer===p};})()`;

module.exports = async function jsetDrill(evalJs, io, opts) {
  opts = opts || {};
  const tries = opts.tries || 4, r = { tries: 0, jsets: 0, spikes: 0, ready: 0, setOn: 0, prompt: 0 };
  await evalJs(HOOK);
  for (let k = 0; k < tries; k++) {
    const want = (await evalJs('__jd.jsets')) + 1;
    // hasta tener peloteo (sacando si es nuestro saque)
    let ok = false;
    for (let t0 = Date.now(); Date.now() - t0 < 12000 && !ok;) {
      const m = await evalJs("(function(){var g=VB.ctx.game;if(VB.ctx.state!=='playing')return 'x';if(g.mode==='serve')return g.server&&g.server.team===0&&g.server===g.ctrl&&g.serveState==='ready'?'mine':'serve';return g.mode})()");
      if (m === 'rally') ok = await evalJs(STAGE);
      else if (m === 'mine' && io.serve) await io.serve();
      else await sleep(120);
    }
    if (!ok) continue;
    r.tries++;
    let jumped = false, setP = false, sawReady = false, sawOn = false, sawTwo = false;
    for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
      const s = await evalJs(POLL);
      if (!s || s.gone || s.last) break;
      if (s.ready) sawReady = true; if (s.setOn) sawOn = true; if (s.two) sawTwo = true;
      if (!jumped && s.ground && s.vz < 2.5 && s.tt < 0.5) { await io.jump(); jumped = true; continue; }
      if (jumped && s.air && s.ready && !setP && s.press < 0.16) { if (io.beforeSet) await io.beforeSet(s); await io.set(); setP = true; }
      await sleep(10);
    }
    await sleep(900);
    if (sawReady) r.ready++; if (sawOn) r.setOn++; if (sawTwo) r.prompt++;
    if ((await evalJs('__jd.jsets')) >= want) r.jsets++;
    if (opts.stopAfter && r.jsets >= opts.stopAfter) break;
  }
  r.spikes = await evalJs('__jd.spikes');
  return r;
};
