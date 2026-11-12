#!/usr/bin/env node
/* Pruebas de TECLAS REASIGNABLES (E3, sprint 5) de js/input.js con teclas REALES (Input.dispatchKeyEvent de Chrome):
 * captureNext + rebind + setSetting('keys'), intercambio, reservadas, borrar la 2ª tecla, la 1ª no se quita, valores
 * corruptos o repetidos, captura sin fuga de pulsaciones (ni el partido ni los menús la ven), nombres de tecla y glifos,
 * restablecer. Uso: node tools/keytest.js   (de camera_input) */
'use strict';
const path = require('path');
const CDP = require(path.join(__dirname, 'cdp.js'));
let fails = 0, oks = 0;
function check(name, cond, info) { if (cond) { oks++; console.log('  ok   ' + name); } else { fails++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); } }
// e.code → {key, vk} para Input.dispatchKeyEvent
const KEYS = {
  KeyJ: ['j', 74], KeyL: ['l', 76], KeyK: ['k', 75], KeyX: ['x', 88], KeyW: ['w', 87], KeyV: ['v', 86], Space: [' ', 32], Tab: ['Tab', 9],
  Backspace: ['Backspace', 8], Escape: ['Escape', 27], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], Enter: ['Enter', 13]
};
(async () => {
  const page = await CDP.open({ size: '1280x720' });
  const E = s => page.evalJs(s);
  const dbg = () => E('VB.Input._debug()');
  const wait = ms => CDP.sleep(ms || 70);
  const key = async (code, type) => {
    const k = KEYS[code];
    const o = { type, code, key: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] };
    if (type === 'keyDown' && k[0].length === 1) o.text = k[0];
    await page.send('Input.dispatchKeyEvent', o);
  };
  const tap = async code => { await key(code, 'keyDown'); await wait(); await key(code, 'keyUp'); await wait(); };
  const setKeys = async v => { await E(`(VB.ctx.actions.setSetting('keys', ${JSON.stringify(v)}), 1)`); await wait(); };
  const binds = () => E('VB.Input.bindings().keys');
  const rebind = async (act, slot, code) => JSON.parse(await E(`JSON.stringify(VB.Input.rebind('key', ${JSON.stringify(act)}, ${slot}, ${JSON.stringify(code)}))`));
  const startCap = () => E(`window.__cap = null; window.__capCancel = VB.Input.captureNext('key', function (v, why) { window.__cap = { v: v, why: why }; }); 1`);
  try {
    await page.navigate('debug=serve&live=1&autoplay=0&seed=7');
    await wait(3000);
    check('arranca en partido', (await E('VB.ctx.state')) === 'playing');
    check('VB.Input expone OPTS, bindings, rebind, captureNext, keyName, padName',
      await E(`!!(VB.Input.OPTS && VB.Input.bindings && VB.Input.rebind && VB.Input.captureNext && VB.Input.keyName && VB.Input.padName)`));
    await setKeys({});
    let k = await binds();
    check('de fábrica: J/X golpear, Espacio saltar, K colocar, W/↑ arriba', k.hit.join() === 'KeyJ,KeyX' && k.jump.join() === 'Space,' && k.jset.join() === 'KeyK,' && k.up.join() === 'KeyW,ArrowUp', k);

    console.log('1) reasignar Golpear → L con captureNext (tecla real) y rebind');
    let s0 = (await dbg()).stats;
    await startCap(); await wait();
    check('captura viva', await E('VB.Input.capturing()'));
    await tap('KeyL');
    let cap = await E('window.__cap');
    check('captureNext devuelve KeyL', cap && cap.v === 'KeyL' && cap.why === 'key', cap);
    let d = await dbg();
    check('la tecla capturada no llega al partido (sin flanco de golpear ni de ninguna acción)', d.stats.out.hit === s0.out.hit && d.stats.out.jump === s0.out.jump && !d.cap, d.stats.out);
    let r = await rebind('hit', 0, cap.v);
    check('rebind hit[0] = KeyL sin error ni intercambio', r.err === '' && r.swap === null && r.keys.hit.join() === 'KeyL,KeyX', r);
    await setKeys(r.keys);
    s0 = (await dbg()).stats;
    await tap('KeyL');
    d = await dbg(); check('L golpea', d.stats.out.hit === s0.out.hit + 1, d.stats.out);
    s0 = d.stats;
    await tap('KeyJ');
    d = await dbg(); check('J ya no golpea', d.stats.out.hit === s0.out.hit, d.stats.out);
    s0 = d.stats;
    await tap('KeyX');
    d = await dbg(); check('X (2ª tecla) sigue golpeando', d.stats.out.hit === s0.out.hit + 1, d.stats.out);
    check('glifo de golpear en teclado = L', (await E(`VB.Input.glyph('hit', 'keyboard')`)) === 'L');
    const pk = await E(`(document.getElementById('promptKey') || {}).textContent || ''`);
    console.log('  (info) #promptKey = «' + pk + '» (lo rehace ui.js con GLYPH al recibir onSettings(\'keys\'))');

    console.log('2) intercambio K ↔ Espacio');
    await setKeys({});
    r = await rebind('jump', 0, 'KeyK');
    check('Saltar ← K: Colocar recibe Espacio (swap)', r.err === '' && r.keys.jump[0] === 'KeyK' && r.keys.jset[0] === 'Space' && r.swap && r.swap.act === 'jset' && r.swap.slot === 0 && r.swap.code === 'Space', r);
    await setKeys(r.keys);
    s0 = (await dbg()).stats;
    await tap('Space');
    d = await dbg(); check('Espacio = colocar (jset; también salta en el suelo)', d.stats.out.jset === s0.out.jset + 1, d.stats.out);

    console.log('3) reservadas, vacías y la 1ª tecla');
    await setKeys({});
    r = await rebind('hit', 0, 'Tab'); check('Tab reservada', r.err === 'reserved', r);
    r = await rebind('hit', 1, 'Escape'); check('Esc reservada', r.err === 'reserved', r);
    r = await rebind('hit', 0, 'F5'); check('F5 reservada', r.err === 'reserved', r);
    r = await rebind('hit', 0, 'KeyF'); check('F (pantalla completa) reservada', r.err === 'reserved', r);
    r = await rebind('hit', 0, ''); check('la 1ª tecla no se puede quitar («primary»)', r.err === 'primary', r);
    r = await rebind('jump', 1, 'KeyJ');
    check('intercambio que dejaría Golpear sin 1ª tecla → «empty»', r.err === 'empty', r);
    await startCap(); await wait();
    await tap('Backspace');
    cap = await E('window.__cap');
    check('Retroceso en la captura → cb(\'\', \'clear\')', cap && cap.v === '' && cap.why === 'clear', cap);
    r = await rebind('hit', 1, cap.v);
    check('borra solo la 2ª tecla de Golpear', r.err === '' && r.keys.hit && r.keys.hit.join() === 'KeyJ,', r);
    await setKeys(r.keys);
    s0 = (await dbg()).stats;
    await tap('KeyX');
    d = await dbg(); check('X ya no golpea', d.stats.out.hit === s0.out.hit, d.stats.out);
    k = await binds(); check('bindings: hit = [KeyJ, \'\'] (se guarda la casilla vacía)', k.hit.join() === 'KeyJ,', k.hit);
    await startCap(); await wait();
    await tap('Escape');
    cap = await E('window.__cap');
    check('Esc en la captura → cb(null, \'cancel\') y no pausa', cap && cap.v === null && cap.why === 'cancel' && (await E('VB.ctx.state')) === 'playing', { cap, st: await E('VB.ctx.state') });
    await startCap(); await wait();
    await tap('Tab');
    cap = await E('window.__cap');
    check('Tab en la captura llega como código (rebind dirá «reservada»)', cap && cap.v === 'Tab', cap);

    console.log('4) valores guardados corruptos o repetidos');
    await setKeys('x'); k = await binds();
    check('keys = \'x\' → de fábrica', k.hit.join() === 'KeyJ,KeyX' && k.jump.join() === 'Space,', k);
    await setKeys({ hit: [123] }); k = await binds();
    check('keys = {hit:[123]} → de fábrica', k.hit.join() === 'KeyJ,KeyX', k.hit);
    await setKeys(null); k = await binds();
    check('keys = null → de fábrica', k.hit.join() === 'KeyJ,KeyX', k.hit);
    await setKeys({ hit: ['KeyW', ''], nada: ['KeyQ'] }); k = await binds();
    check('W para golpear: Arriba se queda con ↑ (sin repetidas) y la acción desconocida se ignora', k.hit.join() === 'KeyW,' && k.up.join() === 'ArrowUp,' && !k.nada, k);
    s0 = (await dbg()).stats;
    await tap('KeyW');
    d = await dbg(); check('W golpea', d.stats.out.hit === s0.out.hit + 1, d.stats.out);
    await setKeys({ hit: ['Tab', 'KeyL'] }); k = await binds();
    check('reservada guardada (Tab) → esa casilla vuelve a la de fábrica (J); la 2ª, L', k.hit.join() === 'KeyJ,KeyL', k.hit);

    console.log('5) captura en un menú: ui.onKey no se mueve');
    await setKeys({});
    await page.navigate('debug=settings&panel=set');
    await wait(2500);
    const focusId = () => E(`(function(){var a=document.activeElement;if(!a)return '';return (a.id||'')+'|'+(a.getAttribute('data-opt')||a.getAttribute('data-sl')||a.getAttribute('data-tab')||'')+'|'+(a.textContent||'').slice(0,24);})()`);
    const ok0 = await E(`!!VB.UI && VB.UI.isPanelOpen ? VB.UI.isPanelOpen() : !!document.querySelector('.panel:not([hidden])')`);
    let f0 = await focusId();
    await tap('ArrowDown'); await wait();
    let f1 = await focusId();
    const moves = f1 !== f0;
    console.log('  (info) panel abierto ' + ok0 + '; foco «' + f0 + '» → «' + f1 + '» con ↓ sin captura');
    await startCap(); await wait();
    f0 = await focusId();
    await tap('ArrowDown'); await wait();
    f1 = await focusId();
    cap = await E('window.__cap');
    check('con la captura, ↓ se captura y el foco del menú no cambia', cap && cap.v === 'ArrowDown' && f0 === f1, { cap, f0, f1, movesWithout: moves });
    await startCap(); await wait();
    f0 = await focusId();
    await tap('Enter'); await wait();
    cap = await E('window.__cap');
    check('Intro en la captura se traga (código Enter) y no acepta en el menú', cap && cap.v === 'Enter' && (await focusId()) === f0, cap);
    await startCap();
    await E(`window.dispatchEvent(new Event('blur')); 1`); await wait();
    cap = await E('window.__cap');
    check('perder el foco cancela la captura', cap && cap.why === 'cancel' && !(await E('VB.Input.capturing()')), cap);
    await E(`window.__cap = null; VB.Input.captureNext('key', function (v, why) { window.__cap = { v: v, why: why }; throw new Error('cb de prueba'); }); 1`);
    await tap('KeyL');
    const after = await E('VB.Input.capturing()');
    check('una excepción en el callback no deja la captura viva', !after && (await E('window.__cap')).v === 'KeyL');
    page.errors.splice(0).forEach(x => { if (!/cb de prueba/.test(x)) page.errors.push(x); });
    console.log('  esperando el tiempo agotado (6 s)…');
    await startCap(); await CDP.sleep(6400);
    cap = await E('window.__cap');
    check('6 s sin tecla → cb(null, \'timeout\')', cap && cap.v === null && cap.why === 'timeout', cap);

    console.log('6) nombres de tecla y restablecer');
    const names = await E(`['Space','ArrowUp','Numpad4','ShiftLeft','ShiftRight','KeyQ','Digit7','Semicolon',''].map(VB.Input.keyName)`);
    check('keyName: Espacio, ↑, Num 4, Mayús, Mayús der., Q, 7, Ñ (o la del sistema), — (vacía)',
      names[0] === 'Espacio' && names[1] === '↑' && names[2] === 'Num 4' && names[3] === 'Mayús' && names[4] === 'Mayús der.' && names[5] === 'Q' && names[6] === '7' && names[7].length === 1 && names[8] === '—', names);
    await setKeys({ hit: ['KeyL', 'KeyX'] });
    await setKeys({});
    k = await binds();
    check('restablecer (keys = {}) → de fábrica, glifo J', k.hit.join() === 'KeyJ,KeyX' && (await E(`VB.Input.glyph('hit','keyboard')`)) === 'J', k.hit);
    if (page.errors.length) { fails++; console.log('ERRORES EN LA PÁGINA:\n' + page.errors.join('\n')); }
  } catch (e) { fails++; console.log('EXCEPCIÓN', e && e.stack || e); }
  page.close();
  console.log((fails ? 'FALLOS: ' + fails : 'TODO OK') + ' (' + oks + ' ok)');
  process.exit(fails ? 1 : 0);
})();
