#!/usr/bin/env node
/* VOLEY 3D — tools/venuetest.js (owner: arena)
 * Ciclo de sedes sin fugas: en el menú (con la demo de fondo) recorre N vueltas de todas las sedes disponibles
 * (VB.Venues.list: pabellones y playas) como lo hace main.js al forzar una sede (onSettings de arena) y vuelve a Palau del Mar.
 * Al final renderer.info.memory.geometries / textures y el número de programas deben volver a los de partida (tolerancia 0).
 * Uso: node tools/venuetest.js [vueltas=3] [WxH=960x540]   (SETTINGS=1: por ctx.actions.setSetting, que rehace la demo
 *      del menú con equipaciones al azar: el número de texturas de los atletas puede variar ±1-2 sin que haya fuga)
 * Sale con 1 si hay fugas o errores de JS en la página.
 */
'use strict';
const CDP = require('./cdp.js');
const LAPS = +(process.argv[2] || 3), SIZE = process.argv[3] || '960x540';
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, 240000).unref();
const EXPR = `(async function (laps) {
  var c = VB.ctx, r = c.renderer, A = c.actions, V = VB.Venues, DIRECT = ${process.env.SETTINGS === '1' ? 'false' : 'true'};
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function mem() { return { geo: r.info.memory.geometries, tex: r.info.memory.textures, prog: (r.info.programs || []).length, map: VB.Arena.map() }; }
  async function go(id) {
    var kind = V.kindOf(id);
    // como main.js forceVenue (sin rehacer la demo: su equipación al azar cambia el número de texturas de los atletas)
    if (DIRECT) VB.Arena.onSettings(Object.assign({}, c.settings, { arena: kind, forceMap: id }), 'arena');
    else { A.setSetting(kind === 'beach' ? 'mapBeach' : 'mapHall', id); A.setSetting('arena', kind); }
    await wait(700);
    if (VB.Arena.map() !== id) throw new Error('no montó ' + id + ' (está ' + VB.Arena.map() + ')');
  }
  var seq = V.list('hall').concat(V.list('beach'));
  await go('palau'); await go('platja'); await go('palau'); await wait(500);
  var base = mem(), log = [];
  for (var l = 0; l < laps; l++) { for (var i = 0; i < seq.length; i++) { await go(seq[i]); log.push(seq[i] + ':' + JSON.stringify(mem())); } await go('palau'); }
  await wait(500);
  return { seq: seq, base: base, end: mem(), log: log };
})(${LAPS})`;
(async () => {
  let code = 0, page;
  try {
    page = await CDP.open({ size: SIZE });
    await page.navigate('map=hall&seed=7'); await CDP.sleep(5000);
    const v = await page.evalJs(EXPR, true);
    console.log('sedes:', v.seq.join(' → '));
    for (const ln of v.log) console.log('  ' + ln);
    console.log('base:', JSON.stringify(v.base)); console.log('fin: ', JSON.stringify(v.end));
    const ok = v.base.geo === v.end.geo && v.base.tex === v.end.tex && v.base.prog === v.end.prog;
    console.log(ok ? '== sin fugas ==' : '== FUGA ==');
    if (!ok) code = 1;
    if (page.errors.length) { console.error('ERRORES EN LA PÁGINA:\n' + page.errors.slice(0, 10).join('\n')); code = 1; }
  } catch (e) { console.error(e && e.message || e); code = 1; }
  if (page) page.close();
  process.exit(code);
})();
