#!/usr/bin/env node
/* VOLEY 3D — tools/eval.js  (owner: ui_main)
 * Abre index.html?<query> en Chrome headless (viewport EXACTO, GPU real), espera y evalúa una expresión JS en la página.
 * Uso: node tools/eval.js "<query>" "<expresión>" [espera_ms=5000] [WxH=640x360]
 * Ej.: node tools/eval.js "debug=rally" "JSON.stringify(VB.ctx.renderer.info.render)"
 * Si la expresión devuelve una Promise, espera a que se resuelva. SHOT=ruta.png hace además una captura DESPUÉS de evaluar
 * (útil para aislar artefactos: ocultar un grupo, mover la cámara, inyectar eventos…). TOUCH=1 emula táctil.
 */
'use strict';
const path = require('path');
const CDP = require('./cdp.js');
const Q = process.argv[2] || '', EXPR = process.argv[3] || 'VB.ctx.state';
const WAIT = +(process.argv[4] || 5000), SIZE = process.argv[5] || '640x360';
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, WAIT + 90000).unref();
(async () => {
  let code = 0, page;
  try {
    page = await CDP.open({ size: SIZE, touch: process.env.TOUCH === '1' });
    await page.navigate(Q); await CDP.sleep(WAIT);
    const v = await page.evalJs(EXPR, true);
    console.log(typeof v === 'string' ? v : JSON.stringify(v));
    if (process.env.SHOT) { await CDP.sleep(+(process.env.SHOT_WAIT || 150)); console.error('captura', await page.shot(path.resolve(process.env.SHOT))); }
    if (page.errors.length) console.error('ERRORES EN LA PÁGINA:\n' + page.errors.slice(0, 10).join('\n'));
  } catch (e) { console.error(e && e.message || e); code = 1; }
  if (page) page.close();
  process.exit(code);
})();
