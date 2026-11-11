#!/usr/bin/env node
/* VOLEY 3D — tools/cam6test.js  (owner: camera_input)
 * Cámara del 6v6 con humano (camera.js 'tp' = 3ª persona, por defecto; CAM6=tv para la de televisión). Juega un partido 6v6 EN VIVO
 * (autopilot: la IA mueve también al humano, que hace de todo; la cámara le sigue igual que si jugaras) y, frame a frame:
 *   - JUG     el jugador que llevas (pies y cabeza) dentro del cuadro en los planos de juego (>= 99 % de los frames)
 *   - BALON   balón dentro del cuadro en el peloteo (>= 95 %; detrás de la cámara cuenta como fuera)
 *   - SUAVE   sin saltos fuera de los cortes anotados: velocidad de la cámara <= 14 m/s, giro <= 75°/s, lente <= 16°/s (p99)
 *   - LIMITES cámara dentro del pabellón (|x| <= 15,2, |y| <= 10,2, z <= 19)
 *   - CORTES  plano de reacción tras los puntos (getShot 'point' con corte 'point') y vuelta al saque por corte
 * Con SHOTS=carpeta captura los momentos (saque propio, saque de un compañero —al lanzar y en el golpe—, saque rival, recepción, colocación, remate propio, bloqueo, punto, fin de set):
 * congela el juego un instante (ctx.frozen) tras el evento, hace la foto y sigue.
 * Uso: node tools/cam6test.js [WxH=1280x720] [segundos=90] [semilla=11] [puntos=7]   (TOUCH=1 táctil; CAM6=tv|3p; SHOTS=dir)
 */
'use strict';
const path = require('path'), fs = require('fs');
const CDP = require('./cdp.js');
const SIZE = process.argv[2] || '1280x720', SECS = +(process.argv[3] || 90), SEED = +(process.argv[4] || 11), PTS = +(process.argv[5] || 7);
const CAM6 = process.env.CAM6 === 'tv' ? 'tv' : '3p', SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, SECS * 1000 * 3 + 120000).unref();
const HOOK = `(function(){
  var c=VB.ctx, CR=VB.CameraRig, orig=CR.update, v=new c.THREE.Vector3(), M=window.__m={n:0,pOut:0,bN:0,bOut:0,maxX:0,maxY:0,maxZ:0,sp:[],yr:[],fr:[],cuts:0,react:0,back:0,shots:{},log:[],logJ:[],moments:{}};
  var last=null, lastCut=-1, pend=[], want=${SHOTS ? 'true' : 'false'}, done={}, srvT=false;
  function sched(name,delay){ if(!want||done[name])return; done[name]=1; pend.push({name:name,t:performance.now()+delay}); }
  CR.update=function(g,dt,ev){ orig.apply(CR,arguments);
    try{
      var d=CR.getDebug(), shot=d.shot, cam=c.camera; cam.updateMatrixWorld(true);
      for(var i=0;i<ev.length;i++){var e=ev[i];
        if(e.type==='hit'&&e.kind==='serve'){srvT=e.team===1;}
        if(e.type==='toss'&&g.server===g.ctrl) sched('saque-propio',350);
        if(e.type==='toss'&&e.team===0&&g.server!==g.ctrl){ sched('saque-companero-0',60); sched('saque-companero',350); }
        if(e.type==='toss'&&e.team===1) sched('saque-rival',300);
        if(e.type==='hit'&&e.team===0&&e.touch===1&&srvT){ sched('recepcion',300); }
        if(e.type==='hit'&&e.kind!=='serve') srvT=srvT&&false;
        if(e.type==='hit'&&e.team===0&&e.touch===2) sched('colocacion',350);
        if(e.type==='hit'&&e.kind==='spike'&&e.player===g.ctrl) sched('remate-propio',90);
        if(e.type==='block'&&e.team===0) sched('bloqueo',60);
        if(e.type==='point'&&!(e.setWon||e.matchWon)) sched(e.team===0?'punto-ganado':'punto-perdido',1150);
        if(e.type==='point'&&(e.setWon||e.matchWon)) sched('fin-de-set',1150);
      }
      var now=performance.now();
      for(var k=0;k<pend.length;k++){ if(now>=pend[k].t&&!window.__cap&&!c.frozen){ window.__cap=pend[k].name; window.__capShot=shot; c.frozen=true; pend.splice(k,1); break; } }
      if(c.frozen) { last=null; return; }
      var cut=d.cutN!==lastCut; if(cut&&lastCut>=0){M.cuts++; var lc=d.lastCut||{}; if(lc.kind==='point')M.react++; if(lc.kind==='serve'&&lc.from==='point')M.back++;} lastCut=d.cutN;
      M.shots[shot]=(M.shots[shot]||0)+1;
      var px=cam.position.x, py=-cam.position.z, pz=cam.position.y;
      M.maxX=Math.max(M.maxX,Math.abs(px)); M.maxY=Math.max(M.maxY,Math.abs(py)); M.maxZ=Math.max(M.maxZ,pz);
      var play=(shot==='tp'||shot==='tv')&&(g.mode==='rally'||g.mode==='serve');
      if(play&&g.ctrl){ M.n++; var p=g.ctrl, bad=false;
        var why='';for(var h=0;h<2;h++){ VB.toThree(p.x,p.y,(p.z||0)+(h?1.85:0),v); v.project(cam); if(v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1){ bad=true; why+=(h?'cabeza ':'pies ')+v.x.toFixed(2)+','+v.y.toFixed(2)+' '; } }
        if(bad){M.pOut++; if(M.logJ.length<14)M.logJ.push('jug '+shot+':'+(d.tp?d.tp.ph:'')+' '+g.mode+' ('+p.x.toFixed(1)+','+p.y.toFixed(1)+','+(p.z||0).toFixed(1)+') '+why+'t'+g.time.toFixed(1));}
        if(g.mode==='rally'){ M.bN++; var b=g.ball; VB.toThree(b.x,b.y,b.z,v); v.project(cam); if(v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1){M.bOut++; if(M.log.length<14&&(M.log.length<3||g.time-(M.lastB||0)>0.6)){M.lastB=g.time;M.log.push('balon '+shot+':'+(d.tp?d.tp.ph:'')+' ('+b.x.toFixed(1)+','+b.y.toFixed(1)+','+b.z.toFixed(1)+') ndc '+(v.z>1?'detrás':v.x.toFixed(2)+','+v.y.toFixed(2))+' t'+g.time.toFixed(1));}} }
      }
      if(last&&!cut&&dt>0.004&&(shot==='tp'||shot==='tv')){
        var dpos=Math.hypot(px-last.x,py-last.y,pz-last.z)/dt; M.sp.push(dpos);
        var q=cam.quaternion, dq=Math.abs(q.x*last.qx+q.y*last.qy+q.z*last.qz+q.w*last.qw); M.yr.push(2*Math.acos(Math.min(1,dq))/dt*57.3);
        var frr=Math.abs(cam.fov-last.f)/dt; if(Math.abs(d.punch||0)>0.01||Math.abs(last.pu||0)>0.01)frr=0; M.fr.push(frr); if(frr>60&&M.log.length<20)M.log.push('lente '+shot+' '+g.mode+' '+last.f.toFixed(1)+'→'+cam.fov.toFixed(1)+' dt '+dt.toFixed(3)+' t'+g.time.toFixed(1));
      }
      var qq=cam.quaternion; last={x:px,y:py,z:pz,qx:qq.x,qy:qq.y,qz:qq.z,qw:qq.w,f:cam.fov,pu:d.punch||0};
    }catch(err){ M.err=String(err&&err.stack||err); }
  };
  // (táctil: un toque de dedo antes de empezar, para que salgan los mandos táctiles como al jugar con el dedo; input.js los enseña con it.device 'touch')
  if (${process.env.TOUCH === '1' ? 'true' : 'false'}) { try { window.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })); } catch (er) { } }
  c.actions.startMatch({autopilot:true,format:'6v6',points:${PTS}});
  return c.game.size;
})()`;
function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
(async () => {
  let bad = 0, page;
  const ok = (name, cond, info) => { console.log((cond ? 'ok   ' : 'FALLO ') + name + (info ? '  ' + info : '')); if (!cond) bad++; };
  try {
    page = await CDP.open({ size: SIZE, touch: process.env.TOUCH === '1' });
    await page.navigate('seed=' + SEED + '&cam6=' + CAM6); await CDP.sleep(3000);
    const sz = await page.evalJs(HOOK);
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const t0 = Date.now(), shotsDone = [];
    while (Date.now() - t0 < SECS * 1000) {
      await CDP.sleep(60);
      if (!SHOTS) continue;
      const cap = await page.evalJs('window.__cap?window.__cap+"|"+window.__capShot:""');
      if (cap) {
        const [name, sh] = cap.split('|');
        await CDP.sleep(120);
        const f = path.join(SHOTS, CAM6 + '-' + name + '.png'); await page.shot(f); shotsDone.push(name + '(' + sh + ')');
        await page.evalJs('window.__cap="";VB.ctx.frozen=false;1');
      }
      if (await page.evalJs('VB.ctx.state!=="playing"')) break;
    }
    const M = await page.evalJs('JSON.stringify(window.__m)').then(JSON.parse);
    const st = await page.evalJs('VB.ctx.game.score.join("-")+" sets "+VB.ctx.game.sets.join("-")');
    console.log('6v6 ' + SIZE + (process.env.TOUCH === '1' ? ' táctil' : '') + ', cámara ' + CAM6 + ', g.size ' + sz + ', marcador ' + st + ', planos ' + JSON.stringify(M.shots));
    if (M.err) ok('sin excepciones en la sonda', false, M.err);
    const pOut = M.pOut / Math.max(1, M.n), bOut = M.bOut / Math.max(1, M.bN);
    ok('JUG', pOut <= 0.01, (100 * pOut).toFixed(2) + ' % de ' + M.n + ' frames fuera');
    ok('BALON', bOut <= 0.05, (100 * bOut).toFixed(2) + ' % de ' + M.bN + ' frames del peloteo fuera');
    const s99 = pct(M.sp, 0.99), y99 = pct(M.yr, 0.99), f99 = pct(M.fr, 0.99);
    ok('SUAVE', s99 <= 14 && y99 <= 75 && f99 <= 16, 'p99 ' + s99.toFixed(1) + ' m/s, giro ' + y99.toFixed(0) + '°/s, lente ' + f99.toFixed(1) + '°/s (máx ' + Math.max(0, ...M.sp).toFixed(1) + ' m/s, ' + Math.max(0, ...M.yr).toFixed(0) + '°/s, ' + Math.max(0, ...M.fr).toFixed(1) + '°/s)');
    ok('LIMITES', M.maxX <= 15.21 && M.maxY <= 10.21 && M.maxZ <= 19.01, '|x| ' + M.maxX.toFixed(2) + ' |y| ' + M.maxY.toFixed(2) + ' z ' + M.maxZ.toFixed(2));
    if (CAM6 === '3p') ok('CORTES', M.react > 0 && M.back > 0, M.cuts + ' cortes: ' + M.react + ' al plano de reacción, ' + M.back + ' de vuelta al saque');
    if (M.log.length) console.log('  ' + M.log.join('\n  '));
    if (M.logJ.length) console.log('  ' + M.logJ.join('\n  '));
    if (SHOTS) console.log('capturas (' + shotsDone.length + '): ' + shotsDone.join(', ') + ' → ' + SHOTS);
    if (page.errors.length) { ok('sin errores de página', false, page.errors.slice(0, 5).join(' | ')); }
  } catch (e) { console.error(e && e.stack || e); bad++; }
  if (page) page.close();
  console.log(bad ? '== HAY FALLOS ==' : '== TODO OK ==');
  process.exit(bad ? 1 : 0);
})();
