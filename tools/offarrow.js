'use strict';
// VOLEY 3D — indicador de borde (UI-10), owner ui_main. Escena reproducible con el jugador fuera de cuadro: ?debug=spike&camyaw=±1.2
// (la cámara se gira tras su update; solo depuración). Comprueba: visible, ángulo de la flecha a ≤ 15° de la recta centro → jugador,
// sin pisar marcador, botones del HUD ni controles táctiles; y oculto sin giro. Capturas en tools/out/offarrow_*.png. Uso: node tools/offarrow.js
const CDP=require('./cdp.js');const path=require('path');
(async()=>{let bad=0;for(const [size,touch] of [['1280x720',false],['844x390',true],['667x375',true]]){
 for(const yaw of [1.2,-1.2,0]){const p=await CDP.open({size,touch});await p.navigate('debug=spike&camyaw='+yaw);await CDP.sleep(3500);
  const r=JSON.parse(await p.evalJs(`(function(){var a=document.getElementById('offArrow'),cs=getComputedStyle(a),q=a.getBoundingClientRect(),o=VB.UI._offArrow(),g=VB.ctx.game,c=g.ctrl;
   var v=new VB.ctx.THREE.Vector3();VB.toThree(c.x,c.y,(c.z||0)+1.0,v);v.project(VB.ctx.camera);var dx=v.x,dy=-v.y;if(v.z>1){dx=-dx;dy=-dy}dx*=innerWidth/2;dy*=innerHeight/2;
   var want=Math.atan2(dy,dx)*57.3,got=o.ang*57.3,d=Math.abs(((want-got)%360+540)%360-180);
   var hits=[];document.querySelectorAll('#sb .sb-body,#sb .sb-top,.hud-btns button,#touch .vt-btn,#touch .vt-base,#touch .vt-knob').forEach(function(e){var b=e.getBoundingClientRect();if(!b.width)return;if(!(b.right<=q.left||b.left>=q.right||b.bottom<=q.top||b.top>=q.bottom))hits.push(e.className||e.id)});
   return JSON.stringify({vis:+cs.opacity>0.5,ang:Math.round(got),want:Math.round(want),diff:Math.round(d),hits:hits})})()`));
  const ok=yaw===0?!r.vis:(r.vis&&r.diff<=15&&!r.hits.length);if(!ok)bad++;
  console.log(ok?'ok ':'MAL',size,'yaw',yaw,JSON.stringify(r));
  if(yaw)await p.shot(path.join(__dirname,'out','offarrow_'+size+'_'+yaw+'.png'));p.close();}}
 console.log(bad?bad+' FALLOS':'TODO OK');process.exit(0)})();
