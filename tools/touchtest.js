#!/usr/bin/env node
/* Pruebas táctiles REALES (Input.dispatchTouchEvent -> touch + pointer events de Chrome) del overlay de js/input.js.
 * Uso: node tools/touchtest.js [WxH=844x390]   (de camera_input) */
'use strict';
const path = require('path');
const CDP = require(path.join(__dirname, 'cdp.js'));
const SIZE = process.argv[2] || '844x390';
const OUT = path.join(__dirname, 'out', 'ci', 'shots');
try { require('fs').mkdirSync(OUT, { recursive: true }); } catch (e) { }
let fails = 0, oks = 0;
function check(name, cond, info) { if (cond) { oks++; console.log('  ok   ' + name); } else { fails++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); } }
(async () => {
  const page = await CDP.open({ size: SIZE, touch: true, throttle: +(process.env.THROTTLE || 1), dpr: +(process.env.DPR || 1) });
  const { w: W, h: H } = CDP.parseSize(SIZE);
  const dbg = () => page.evalJs('VB.Input._debug()');
  const wait = ms => CDP.sleep(ms || 60);
  const touch = async (type, pts) => { await page.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p[0], y: p[1], id: p[2], radiusX: 6, radiusY: 6, force: 1 })) }); await wait(50); };
  try {
    await page.navigate('debug=serve&seed=7');
    await wait(3500);
    let d = await dbg();
    check('overlay visible en táctil', d.shown, { shown: d.shown, device: d.device });
    const G = d.geo, hit = [G.hit.cx, G.hit.cy], jump = [G.jump.cx, G.jump.cy], sw = [G.sw.cx, G.sw.cy], pz = [G.pause.cx, G.pause.cy];
    console.log('  geo', JSON.stringify(G), 'R', d.R);

    // 1) multitáctil: joystick + GOLPEAR a la vez
    console.log('1) joystick + botón a la vez');
    await touch('touchStart', [[150, H - 120, 1]]);
    await touch('touchMove', [[175, H - 120, 1]]); await touch('touchMove', [[205, H - 120, 1]]);
    let s0 = (await dbg()).stats;
    await touch('touchStart', [[205, H - 120, 1], [hit[0], hit[1], 2]]);
    d = await dbg();
    check('joystick activo con el 2.º dedo en GOLPEAR', d.joy !== null && d.mx > 0.5, { joy: d.joy, mx: d.mx });
    check('GOLPEAR pulsado (hitDown) a la vez', d.hitDown && d.stats.press.hit === s0.press.hit + 1, d.stats.press);
    check('el flanco llega a poll() (out.hit)', d.stats.out.hit >= s0.out.hit + 1, d.stats.out);
    await touch('touchMove', [[205, H - 170, 1], [hit[0] + 3, hit[1], 2]]);
    d = await dbg();
    check('mover el joystick con GOLPEAR mantenido: my > 0 (hacia la red)', d.my > 0.3 && d.hitDown, { mx: d.mx, my: d.my });
    await page.shot(path.join(OUT, 'touch-multi-' + SIZE + '.png'));
    await touch('touchEnd', [[hit[0] + 3, hit[1], 2]]);   // (CDP: touchEnd lleva los dedos que se levantan)
    d = await dbg();
    check('suelto GOLPEAR, el joystick sigue', !d.hitDown && d.joy !== null, { hitDown: d.hitDown, joy: d.joy });
    await touch('touchEnd', []);
    d = await dbg();
    check('suelto todo', d.joy === null && d.ptrs.length === 0 && d.mx === 0, d);

    // 2) deslizar de SALTAR a GOLPEAR
    console.log('2) deslizar SALTAR -> GOLPEAR');
    s0 = (await dbg()).stats;
    await touch('touchStart', [[jump[0], jump[1], 3]]);
    d = await dbg(); check('SALTAR pulsado', d.jumpDown && d.stats.press.jump === s0.press.jump + 1);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[jump[0] + (hit[0] - jump[0]) * i / 6, jump[1] + (hit[1] - jump[1]) * i / 6, 3]]);
    d = await dbg();
    check('al llegar a GOLPEAR: golpe pulsado y salto soltado', d.hitDown && !d.jumpDown && d.stats.press.hit === s0.press.hit + 1 && d.stats.slide === s0.slide + 1, { hitDown: d.hitDown, jumpDown: d.jumpDown, st: d.stats });
    await touch('touchEnd', []);

    // 3) desde zona vacía de la derecha hasta GOLPEAR; 4) salir del botón a zona vacía lo mantiene
    console.log('3) zona vacía -> GOLPEAR; 4) GOLPEAR -> zona vacía');
    s0 = (await dbg()).stats;
    const empty = [Math.round(W * 0.66), Math.round(H * 0.35)];
    await touch('touchStart', [[empty[0], empty[1], 4]]);
    d = await dbg(); check('dedo en zona vacía: sin botón ni joystick', d.ptrs.length === 1 && d.ptrs[0].role === 'none' && d.joy === null, d.ptrs);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[empty[0] + (hit[0] - empty[0]) * i / 6, empty[1] + (hit[1] - empty[1]) * i / 6, 4]]);
    d = await dbg(); check('llega a GOLPEAR deslizando: pulsa', d.hitDown && d.stats.press.hit === s0.press.hit + 1);
    await touch('touchMove', [[empty[0], empty[1], 4]]);
    d = await dbg(); check('sale a zona vacía: sigue pulsado (perdona el pulgar)', d.hitDown);
    await touch('touchEnd', []);
    d = await dbg(); check('al levantar: suelto', !d.hitDown && d.ptrs.length === 0);

    // 5) cancelación del sistema (touchcancel -> pointercancel)
    console.log('5) touchcancel');
    await touch('touchStart', [[140, H - 110, 5]]); await touch('touchMove', [[190, H - 110, 5]]);
    await touch('touchStart', [[190, H - 110, 5], [hit[0], hit[1], 6]]);
    await touch('touchCancel', []);
    d = await dbg(); check('touchcancel suelta joystick y botón', d.joy === null && !d.hitDown && d.ptrs.length === 0 && d.mx === 0, d);

    // 6) dedo perdido: el pointerup no llega nunca (lo bloqueamos en window/captura); touchend dice 0 dedos
    console.log('6) dedo perdido (sin pointerup)');
    await page.evalJs(`window.__blk = e => e.stopImmediatePropagation(); ['pointerup','pointercancel','lostpointercapture'].forEach(t => window.addEventListener(t, window.__blk, true)); 1`);
    s0 = (await dbg()).stats;
    await touch('touchStart', [[150, H - 120, 7]]); await touch('touchMove', [[200, H - 120, 7]]);
    await touch('touchStart', [[200, H - 120, 7], [hit[0], hit[1], 8]]);
    await touch('touchEnd', []);
    await wait(250);
    d = await dbg();
    check('barrido de dedos perdidos: todo suelto', d.joy === null && !d.hitDown && d.ptrs.length === 0 && d.stats.lost === s0.lost + 1, { joy: d.joy, hitDown: d.hitDown, ptrs: d.ptrs, lost: d.stats.lost });
    await page.evalJs(`['pointerup','pointercancel','lostpointercapture'].forEach(t => window.removeEventListener(t, window.__blk, true)); 1`);

    // 7) dos dedos en GOLPEAR
    console.log('7) dos dedos en GOLPEAR');
    await touch('touchStart', [[hit[0] - 12, hit[1], 9]]); await touch('touchStart', [[hit[0] - 12, hit[1], 9], [hit[0] + 12, hit[1], 10]]);
    await touch('touchEnd', [[hit[0] + 12, hit[1], 10]]);  // (levanta el 10)
    d = await dbg(); check('suelto uno: sigue pulsado', d.hitDown);
    await touch('touchEnd', []);
    d = await dbg(); check('suelto el otro: suelto', !d.hitDown);

    // 8) 2.º dedo en la mitad izquierda hereda el joystick
    console.log('8) herencia del joystick');
    s0 = (await dbg()).stats;
    await touch('touchStart', [[140, H - 110, 11]]);
    await touch('touchStart', [[140, H - 110, 11], [300, H - 160, 12]]);
    await touch('touchEnd', [[140, H - 110, 11]]);
    d = await dbg(); check('el 2.º dedo pasa a ser el joystick', d.joy !== null && d.stats.promote === s0.promote + 1 && Math.abs(d.ox - 300) < 2, { joy: d.joy, ox: d.ox, st: d.stats.promote });
    await touch('touchMove', [[350, H - 160, 12]]);
    d = await dbg(); check('y lo mueve', d.mx > 0.5, { mx: d.mx });
    await touch('touchEnd', []);

    // 9) pérdida de foco con el dedo puesto + adopción al mover
    console.log('9) blur con el dedo puesto + adopción');
    s0 = (await dbg()).stats;
    await touch('touchStart', [[150, H - 120, 13]]);
    await page.evalJs(`window.dispatchEvent(new Event('blur')); 1`); await wait(60);
    d = await dbg(); check('blur suelta el joystick', d.joy === null && d.ptrs.length === 0);
    await touch('touchMove', [[170, H - 120, 13]]); await touch('touchMove', [[220, H - 120, 13]]);
    d = await dbg(); check('el dedo que sigue puesto se adopta como joystick al moverse', d.joy !== null && d.stats.adopt === s0.adopt + 1 && d.mx > 0.3, { joy: d.joy, adopt: d.stats.adopt, mx: d.mx });
    await touch('touchEnd', []);

    // 10) barra del navegador (cambio pequeño de alto) con el dedo puesto: sigue, base dentro
    console.log('10) cambio pequeño de tamaño');
    await touch('touchStart', [[150, H - 60, 14]]);
    await page.setSize(W + 'x' + (H - 40)); await wait(300);
    d = await dbg(); check('joystick sigue tras -40 px de alto y su base queda dentro', d.joy !== null && d.oy <= H - 40 - d.R - 8 + 0.5, { joy: d.joy, oy: d.oy, R: d.R });
    await touch('touchEnd', []);
    await page.setSize(SIZE); await wait(300);

    // 11) giro a vertical con el dedo puesto y vuelta
    console.log('11) giro con el dedo puesto');
    await touch('touchStart', [[150, H - 120, 15]]); await touch('touchMove', [[200, H - 120, 15]]);
    await touch('touchStart', [[200, H - 120, 15], [hit[0], hit[1], 16]]);
    await page.setSize(H + 'x' + W); await wait(400);
    d = await dbg(); check('en vertical: overlay oculto y todo suelto', !d.shown && d.joy === null && !d.hitDown && d.ptrs.length === 0, { shown: d.shown, joy: d.joy, ptrs: d.ptrs });
    await page.setSize(SIZE); await wait(400);
    d = await dbg(); check('vuelta a horizontal: overlay visible, nada pegado', d.shown && d.joy === null && !d.hitDown && d.mx === 0, { shown: d.shown, joy: d.joy, mx: d.mx });
    await touch('touchEnd', []);
    await touch('touchStart', [[150, H - 120, 17]]); await touch('touchMove', [[200, H - 120, 17]]);
    d = await dbg(); check('tras el giro, un toque nuevo funciona', d.joy !== null && d.mx > 0.3);
    await touch('touchEnd', []);

    // 12) zonas seguras (notch): base del joystick fuera del notch
    console.log('12) zonas seguras');
    let saOk = true;
    try { await page.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 44, right: 44, top: 0, bottom: 21 } }); }
    catch (e) { saOk = false; console.log('  (sin Emulation.setSafeAreaInsetsOverride: se simula con CSS)', e.message); }
    if (!saOk) await page.evalJs(`var s=document.createElement('style');s.textContent='.vt-safe{padding:0 44px 21px 44px!important}';document.head.appendChild(s);1`);
    await page.setSize(SIZE); await wait(400);
    d = await dbg();
    check('insets leídos', d.safe.l === 44 && d.safe.b === 21, d.safe);
    await touch('touchStart', [[8, H - 4, 18]]);
    d = await dbg(); check('joystick nace fuera del notch/barra', d.joy !== null && d.ox >= 44 + d.R + 8 - 0.5 && d.oy <= H - 21 - d.R - 8 + 0.5, { ox: d.ox, oy: d.oy, R: d.R });
    await page.shot(path.join(OUT, 'touch-safe-' + SIZE + '.png'));
    await touch('touchEnd', []);
    if (saOk) { const g2 = (await dbg()).geo; check('botones respetan el inset derecho (CSS env)', g2.hit.cx + g2.hit.r <= W - 44 - 10, g2.hit); }
    else console.log('  (botones con env(): no comprobable sin el override)');

    // 13) pausa (al final: oculta el overlay)
    console.log('13) pausa');
    { const g3 = (await dbg()).geo; pz[0] = g3.pause.cx; pz[1] = g3.pause.cy; }
    await touch('touchStart', [[pz[0], pz[1], 19]]); await touch('touchEnd', []);
    await wait(100);
    const st = await page.evalJs('VB.ctx.state');
    check('botón de pausa pausa', st === 'paused', st);
    d = await dbg(); check('en pausa: overlay oculto y nada pegado', !d.shown && d.ptrs.length === 0);
    console.log('stats', JSON.stringify(d.stats));
    if (page.errors.length) { fails++; console.log('ERRORES EN LA PÁGINA:\n' + page.errors.join('\n')); }
  } catch (e) { fails++; console.log('EXCEPCIÓN', e && e.stack || e); }
  page.close();
  console.log((fails ? 'FALLOS: ' + fails : 'TODO OK') + ' (' + oks + ' ok)');
  process.exit(fails ? 1 : 0);
})();
