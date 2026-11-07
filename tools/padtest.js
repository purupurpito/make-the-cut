#!/usr/bin/env node
/* Pruebas de mando con un navigator.getGamepads() FALSO (inyectado antes de cargar la página) sobre js/input.js:
 * conexión a mitad de partido, zona muerta, flancos, varios mandos, desconexión (con y sin evento) -> pausa,
 * mapeo no estándar (botones + eje hat). Uso: node tools/padtest.js   (de camera_input) */
'use strict';
const path = require('path');
const CDP = require(path.join(__dirname, 'cdp.js'));
let fails = 0, oks = 0;
function check(name, cond, info) { if (cond) { oks++; console.log('  ok   ' + name); } else { fails++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); } }
const INIT = `
window.__pads = [null, null, null, null];
try { Object.defineProperty(Navigator.prototype, 'getGamepads', { value: function () { return window.__pads.slice(); }, configurable: true }); } catch (e) {}
window.__mk = function (i, mapping, nb, na, id) {
  var p = { index: i, id: id || ('Mando falso ' + i), connected: true, mapping: mapping, timestamp: 0, buttons: [], axes: [], vibrationActuator: null };
  for (var b = 0; b < nb; b++) p.buttons.push({ pressed: false, touched: false, value: 0 });
  for (var a = 0; a < na; a++) p.axes.push(0);
  return p;
};
window.__ev = function (type, p) { var e = new Event(type); Object.defineProperty(e, 'gamepad', { value: p }); window.dispatchEvent(e); };
window.__connect = function (p) { window.__pads[p.index] = p; window.__ev('gamepadconnected', p); return 1; };
window.__disconnect = function (i, silent) { var p = window.__pads[i]; p.connected = false; window.__pads[i] = null; if (!silent) window.__ev('gamepaddisconnected', p); return 1; };
window.__btn = function (i, b, on) { var x = window.__pads[i].buttons[b]; x.pressed = !!on; x.value = on ? 1 : 0; return 1; };
window.__ax = function (i, a, v) { window.__pads[i].axes[a] = v; return 1; };
`;
(async () => {
  const page = await CDP.open({ size: '1280x720', init: INIT });
  const E = s => page.evalJs(s);
  const dbg = () => E('VB.Input._debug()');
  const wait = ms => CDP.sleep(ms || 80);
  try {
    await page.navigate('debug=serve&seed=7');
    await wait(3000);
    check('arranca en partido', (await E('VB.ctx.state')) === 'playing');
    let d = await dbg();
    check('sin mando: no se lee el mando', d.pad.idx === -1 && d.device === 'keyboard', d.pad);

    console.log('1) conexión a mitad de partido + zona muerta');
    await E(`__connect(__mk(0, 'standard', 17, 4, 'Xbox falso (STANDARD GAMEPAD)'))`); await wait();
    d = await dbg(); check('mando conectado y elegido', d.pad.idx === 0 && d.pad.known, d.pad);
    await E(`__ax(0, 0, 0.12); __ax(0, 1, -0.1)`); await wait();
    d = await dbg(); check('stick en reposo con deriva (0,12/-0,10): sin movimiento', d.mx === 0 && d.my === 0, { mx: d.mx, my: d.my });
    await E(`__ax(0, 0, 0.16); __ax(0, 1, 0.08)`); await wait();
    d = await dbg(); check('radio 0,175 < zona muerta 0,18: sin movimiento', d.mx === 0 && d.my === 0, { mx: d.mx, my: d.my });
    await E(`__ax(0, 0, 0.3); __ax(0, 1, 0)`); await wait();
    // (un empujón suave mueve, pero no cambia el dispositivo activo: eso pide > 0,5 o un botón; así una deriva no esconde
    //  los controles táctiles ni cambia los glifos)
    d = await dbg(); check('justo fuera de la zona muerta: respuesta pequeña y continua (0 < mx < 0,2) sin robar el dispositivo', d.mx > 0 && d.mx < 0.2 && d.device !== 'gamepad', { mx: d.mx, dev: d.device });
    await E(`__ax(0, 0, 0.6); __ax(0, 1, 0)`); await wait();
    d = await dbg(); check('stick > 0,5: el mando pasa a ser el dispositivo activo', d.device === 'gamepad' && d.mx > 0.3, { mx: d.mx, dev: d.device });
    await E(`__ax(0, 0, 0.7071); __ax(0, 1, -0.7071)`); await wait();
    d = await dbg(); check('diagonal a fondo: |v| ~ 1, arriba-derecha', Math.abs(Math.hypot(d.mx, d.my) - 1) < 0.02 && d.mx > 0.68 && d.my > 0.68, { mx: d.mx, my: d.my });
    await E(`__ax(0, 0, 0); __ax(0, 1, 0)`); await wait();

    console.log('2) flancos A / B / RB');
    let s0 = (await dbg()).stats;
    await E(`__btn(0, 0, 1)`); await wait(); await wait();
    d = await dbg(); check('A = golpear (un flanco aunque se mantenga)', d.stats.out.hit === s0.out.hit + 1, d.stats.out);
    await E(`__btn(0, 0, 0); __btn(0, 1, 1)`); await wait(); await E(`__btn(0, 1, 0); __btn(0, 5, 1)`); await wait(); await E(`__btn(0, 5, 0)`); await wait();
    d = await dbg(); check('B = saltar, RB = cambiar', d.stats.out.jump === s0.out.jump + 1 && d.stats.out.sw === s0.out.sw + 1, d.stats.out);
    await E(`__btn(0, 12, 1)`); await wait();
    d = await dbg(); check('cruceta arriba = my 1', d.my === 1 && d.mx === 0, { mx: d.mx, my: d.my });
    await E(`__btn(0, 12, 0)`); await wait();

    console.log('3) segundo mando: manda el que se usa');
    await E(`__connect(__mk(1, 'standard', 17, 4))`); await wait();
    d = await dbg(); check('al conectar el 2.º sin usarlo, sigue el 1.º', d.pad.idx === 0, d.pad);
    s0 = d.stats;
    await E(`__btn(1, 0, 1)`); await wait();
    d = await dbg(); check('pulsar A en el 2.º: pasa a mandar y su A cuenta', d.pad.idx === 1 && d.stats.out.hit === s0.out.hit + 1, { pad: d.pad, out: d.stats.out });
    await E(`__btn(1, 0, 0)`); await wait();

    console.log('4) desconexión del mando activo en pleno partido -> pausa');
    await E(`__disconnect(1)`); await wait(150);
    d = await dbg();
    let st = await E('VB.ctx.state');
    check('pausa al perder el mando con el que se jugaba', st === 'paused' && d.stats.padPause === 1, { st, pp: d.stats.padPause, pad: d.pad });
    check('el dispositivo vuelve a teclado', d.device === 'keyboard', d.device);
    // reanudar con Start del mando 0 que queda
    await E(`__btn(0, 9, 1)`); await wait(); await E(`__btn(0, 9, 0)`); await wait(150);
    st = await E('VB.ctx.state');
    check('Start del otro mando reanuda', st === 'playing', st);
    d = await dbg(); check('ahora manda el mando 0', d.pad.idx === 0, d.pad);

    console.log('5) desconexión SIN evento (algunos navegadores) -> pausa igual');
    await E(`__disconnect(0, true)`); await wait(150);
    st = await E('VB.ctx.state'); d = await dbg();
    check('detectada por sondeo: pausa', st === 'paused' && d.stats.padPause === 2 && d.pad.idx === -1, { st, pp: d.stats.padPause, pad: d.pad });
    await E(`VB.ctx.actions.resume()`); await wait(100);

    console.log('6) mando olvidado: jugando con teclado, desconectar no pausa');
    await E(`__connect(__mk(2, 'standard', 17, 4))`); await wait();
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 }); await wait();
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 }); await wait();
    await E(`__disconnect(2)`); await wait(150);
    st = await E('VB.ctx.state');
    check('con el teclado en uso no se pausa', st === 'playing', st);

    console.log('7) mapeo NO estándar (DirectInput genérico, 12 botones, eje hat)');
    await E(`__connect(__mk(3, '', 12, 10, 'USB Gamepad (Vendor: 0079 Product: 0006)'))`); await wait();
    await E(`__ax(3, 9, 0.0)`); await wait();
    d = await dbg(); check('hat en 0 SIN haber visto su reposo: no se lee como "abajo"', d.my === 0 && d.mx === 0, { mx: d.mx, my: d.my });
    await E(`__ax(3, 9, 1.2857)`); await wait();
    d = await dbg(); check('hat en reposo (1,29): sin movimiento', d.mx === 0 && d.my === 0);
    await E(`__ax(3, 9, -1)`); await wait(); d = await dbg(); const up = [d.mx, d.my];
    await E(`__ax(3, 9, -0.428571)`); await wait(); d = await dbg(); const right = [d.mx, d.my];
    await E(`__ax(3, 9, 0.142857)`); await wait(); d = await dbg(); const down = [d.mx, d.my];
    await E(`__ax(3, 9, 0.714286)`); await wait(); d = await dbg(); const left = [d.mx, d.my];
    await E(`__ax(3, 9, -0.714286)`); await wait(); d = await dbg(); const ur = [d.mx, d.my];
    await E(`__ax(3, 9, 1.2857)`); await wait();
    check('hat: arriba/derecha/abajo/izquierda/diagonal', up[1] === 1 && right[0] === 1 && down[1] === -1 && left[0] === -1 && ur[0] > 0.7 && ur[1] > 0.7, { up, right, down, left, ur });
    s0 = (await dbg()).stats;
    await E(`__btn(3, 9, 1)`); await wait(); await E(`__btn(3, 9, 0)`); await wait(150);
    st = await E('VB.ctx.state');
    check('Start (botón 9) pausa', st === 'paused', st);
    await E(`__btn(3, 9, 1)`); await wait(); await E(`__btn(3, 9, 0)`); await wait(150);
    s0 = (await dbg()).stats;
    await E(`__btn(3, 0, 1)`); await wait(); await E(`__btn(3, 0, 0); __btn(3, 2, 1)`); await wait(); await E(`__btn(3, 2, 0)`); await wait();
    d = await dbg(); check('botón 0 golpea, botón 2 salta', d.stats.out.hit === s0.out.hit + 1 && d.stats.out.jump === s0.out.jump + 1, d.stats.out);
    check('mapping no estándar registrado', d.pad.mapping === '' && /0079/.test(d.pad.id), d.pad);

    console.log('8) mapeo NO estándar tipo XInput (11 botones: Start = 7)');
    await E(`__disconnect(3)`); await wait(150);
    if ((await E('VB.ctx.state')) === 'paused') await E(`VB.ctx.actions.resume()`);
    await E(`__connect(__mk(0, '', 11, 6, 'xinput'))`); await wait();
    await E(`__btn(0, 0, 1)`); await wait(); await E(`__btn(0, 0, 0)`); await wait();
    await E(`__btn(0, 7, 1)`); await wait(); await E(`__btn(0, 7, 0)`); await wait(150);
    st = await E('VB.ctx.state');
    check('Start (botón 7) pausa en mandos XInput no estándar', st === 'paused', st);
    console.log('stats', JSON.stringify((await dbg()).stats));
    if (page.errors.length) { fails++; console.log('ERRORES EN LA PÁGINA:\n' + page.errors.join('\n')); }
  } catch (e) { fails++; console.log('EXCEPCIÓN', e && e.stack || e); }
  page.close();
  console.log((fails ? 'FALLOS: ' + fails : 'TODO OK') + ' (' + oks + ' ok)');
  process.exit(fails ? 1 : 0);
})();
