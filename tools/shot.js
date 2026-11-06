#!/usr/bin/env node
/* VOLEY 3D — tools/shot.js (owner: ui_main)
 * Capturas y errores de consola con el VIEWPORT EXACTO (DevTools: Emulation.setDeviceMetricsOverride) y la GPU real.
 * Uso: node tools/shot.js <escena[,escena...]> [W=1280] [H=720] [salida] [params extra]
 *   - una escena: salida = fichero .png (por defecto tools/out/<escena>-WxH.png)
 *   - varias escenas (separadas por comas, o "all"): salida = carpeta (por defecto tools/out/shots-WxH/)
 *   - escena "-" o "none": solo consola, sin captura
 * Variables: WAIT=ms de espera tras cargar (por defecto VTB o 4000) · TOUCH=1 emula pantalla táctil
 *            QUIET=1 no imprime la consola · GL=swiftshader render por software.
 * Imprime "== sin errores JS ==" o "== HAY ERRORES ==" (y sale con 1).
 */
'use strict';
const path = require('path'), fs = require('fs');
const CDP = require('./cdp.js');
const ALL = 'menu,serve,hud,rally,spike,block,point,ace,setpoint,switch,over,mobile,pause,tutorial,controls,settings,toss,jumpserve,dive';
let scenes = (process.argv[2] || 'menu'); if (scenes === 'all') scenes = ALL;
scenes = scenes.split(',').filter(Boolean);
const W = +(process.argv[3] || 1280), H = +(process.argv[4] || 720);
const EXTRA = process.argv[6] || '';
const WAIT = +(process.env.WAIT || process.env.VTB || 4000);
const noShot = scenes.length === 1 && (scenes[0] === '-' || scenes[0] === 'none');
const multi = scenes.length > 1;
let OUT = process.argv[5] || (multi ? path.join(CDP.ROOT, 'tools', 'out', 'shots-' + W + 'x' + H) : path.join(CDP.ROOT, 'tools', 'out', scenes[0] + '-' + W + 'x' + H + '.png'));
OUT = path.resolve(OUT);
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, (WAIT + 30000) * scenes.length + 30000).unref();

(async () => {
  let bad = 0, page;
  try {
    page = await CDP.open({ size: W + 'x' + H, touch: process.env.TOUCH === '1' });
    for (const sc of scenes) {
      page.errors.length = 0; page.logs.length = 0;
      const q = noShot ? EXTRA : 'debug=' + sc + (EXTRA ? '&' + EXTRA : '');
      await page.navigate(q);
      await CDP.sleep(WAIT);
      let info = '';
      try { info = await page.evalJs("(function(){var c=VB.ctx;return c?(innerWidth+'x'+innerHeight+' state='+c.state+' fps='+Math.round(c.fps||0)+' q='+(c.quality&&c.quality.level)):'sin VB.ctx'})()"); } catch (e) { info = 'eval: ' + e.message; }
      let f = '';
      if (!noShot) { f = multi ? path.join(OUT, sc + '.png') : OUT; try { fs.unlinkSync(f); } catch (e) { } await page.shot(f); }
      if (process.env.QUIET !== '1') for (const l of page.logs) console.log('  ' + l);
      const ok = !page.errors.length; if (!ok) bad++;
      console.log((ok ? 'ok   ' : 'ERR  ') + sc.padEnd(10) + ' ' + info + (f ? ' → ' + f : ''));
      if (!ok) console.log('     ' + page.errors.slice(0, 5).join('\n     '));
    }
  } catch (e) { bad++; console.error('ERROR:', e && e.message || e); }
  if (page) page.close();
  console.log(bad ? '== HAY ERRORES ==' : '== sin errores JS ==');
  process.exit(bad ? 1 : 0);
})();
