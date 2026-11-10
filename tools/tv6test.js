#!/usr/bin/env node
/* VOLEY 3D — tools/tv6test.js  (owner: camera_input)
 * Cámara de televisión del 6v6 (espectador, sprint 2; camera.js 'tv'): abre ?format=6v6, empieza el partido (CPU contra CPU con el
 * HUD de partido) y durante N s, cada 100 ms con el plano 'tv' (pasados 4 s: la transición desde el menú es larga), proyecta los pies
 * y la cabeza de todos los jugadores en pista y el balón. Comprueba:
 *   - JUG    todos los jugadores dentro del cuadro en el 100 % de los frames
 *   - BALON  balón dentro del cuadro en >= 98 % de los frames
 *   - LIMITES cámara dentro del pabellón (|x| <= 15,2, z <= 19)
 *   - ESTADO g.size 6, g.watch, sin mandos táctiles a la vista, rótulos LOC / VIS, sin errores de página
 * Uso: node tools/tv6test.js [WxH=1280x720] [segundos=40] [semilla=11]   (TOUCH=1 emula táctil)
 */
'use strict';
const CDP = require('./cdp.js');
const SIZE = process.argv[2] || '1280x720', SECS = +(process.argv[3] || 40), SEED = +(process.argv[4] || 11);
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, SECS * 1000 + 90000).unref();
const EXPR = `new Promise(function(r){
  var c=VB.ctx; c.actions.startMatch({points:11});
  var t0=performance.now(),n=0,out=0,ballOut=0,maxX=0,maxZ=0,log=[],v=new c.THREE.Vector3();
  var iv=setInterval(function(){
    if(VB.CameraRig.getDebug().shot!=='tv'||performance.now()-t0<4000)return; n++;
    var cam=c.camera,g=c.game,bad=false; cam.updateMatrixWorld(true);
    maxX=Math.max(maxX,Math.abs(cam.position.x)); maxZ=Math.max(maxZ,cam.position.y);
    for(var i=0;i<g.players.length;i++){var p=g.players[i];
      for(var k=0;k<2;k++){VB.toThree(p.x,p.y,k?1.9:0,v);v.project(cam);
        if(Math.abs(v.x)>1||Math.abs(v.y)>1){bad=true;if(log.length<8)log.push(g.mode+' id'+p.id+' ('+p.x.toFixed(1)+','+p.y.toFixed(1)+') '+(k?'cabeza':'pies')+' ndc '+v.x.toFixed(2)+','+v.y.toFixed(2));}}}
    if(bad)out++;
    var b=g.ball; VB.toThree(b.x,b.y,b.z,v); v.project(cam); if(Math.abs(v.x)>1||Math.abs(v.y)>1) ballOut++;
  },100);
  setTimeout(function(){clearInterval(iv);var g=c.game;
    r({frames:n,out:out,ballOut:ballOut,maxX:maxX,maxZ:maxZ,size:g.size,watch:!!g.watch,n0:(document.getElementById('sbName0')||{}).textContent,
       n1:(document.getElementById('sbName1')||{}).textContent,touchShown:!!(VB.Input&&VB.Input._debug&&VB.Input._debug().shown),score:g.score.join('-'),log:log});},SECS*1000);
})`;
(async () => {
  let bad = 0, page;
  const ok = (name, cond, info) => { console.log((cond ? 'ok   ' : 'FALLO ') + name + (info ? '  ' + info : '')); if (!cond) bad++; };
  try {
    page = await CDP.open({ size: SIZE, touch: process.env.TOUCH === '1' });
    await page.navigate('format=6v6&seed=' + SEED); await CDP.sleep(3000);
    const v = await page.evalJs(EXPR.replace('SECS*1000', String(SECS * 1000)), true);
    console.log('tamaño ' + SIZE + ', ' + v.frames + ' frames con el plano tv, marcador ' + v.score);
    ok('JUG', v.frames > 50 && v.out === 0, v.out + ' frames con alguien fuera' + (v.log.length ? '\n     ' + v.log.join('\n     ') : ''));
    ok('BALON', v.ballOut <= v.frames * 0.02, (100 * v.ballOut / Math.max(1, v.frames)).toFixed(1) + ' % fuera');
    ok('LIMITES', v.maxX <= 15.2 && v.maxZ <= 19, 'x ' + v.maxX.toFixed(2) + ', z ' + v.maxZ.toFixed(2));
    ok('ESTADO', v.size === 6 && v.watch && v.n0 === 'LOC' && v.n1 === 'VIS' && !v.touchShown, 'size ' + v.size + ', watch ' + v.watch + ', ' + v.n0 + '/' + v.n1 + ', mandos ' + v.touchShown);
    ok('ERRORES', !page.errors.length, page.errors.slice(0, 3).join(' | '));
  } catch (e) { bad++; console.error('ERROR:', e && e.message || e); }
  if (page) page.close();
  console.log(bad ? bad + ' FALLOS' : 'TODO OK');
  process.exit(bad ? 1 : 0);
})();
