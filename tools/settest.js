#!/usr/bin/env node
/* MAKE THE CUT — tools/settest.js (owner: ui_main)
 * Pruebas de los AJUSTES DE PC (E3, sprint 5) y de la parte de Ajustes de E7, con Chrome (tools/cdp.js):
 *   a) las 7 pestañas y sus filas; las filas ★ (data-need) se esconden si su módulo no las soporta (OPTS borrados a mano)
 *   b) teclado (↓ hasta la fila, → cambia el valor), mando falso (stick y A/B, el de padplay) y toque (segmento y pista)
 *   c) persistencia: sobreviven a una recarga; las claves del dispositivo van en voley3d.device y NO en voley3d.settings
 *   d) valores corruptos → por defecto, sin errores
 *   e) migración {sfxVol:0.6} → crowdVol 0,51 (y el bus del público de audio.js a 0,51)
 *   f) resScale 0.7 → pixelRatio = min(dpr, tope) × 0,7, y la ayuda «Fija: W × H píxeles»
 *   g) fpsCap 30 en debug=rally&live=1&aq=1 → ctx.fps entre 27 y 33 durante 6 s, sin bajadas de calidad
 *   h) showFps → #fps visible con «NN fps | Nivel»
 *   i) restablecer el apartado con doble pulsación
 *   j) pila de vuelta: Ajustes › Juego › Controles › Volver → Ajustes en Juego con el foco en «Controles»
 *   k) Controles: reasignar Golpear con una tecla REAL (captura), glifo nuevo, Esc cancela sin cerrar el panel, restablecer
 *   l) pestañas compactas a 667×375 con el HUD al 130 %: caben sin desplazar y la elegida lleva su etiqueta
 *   m) título de la pestaña (menú, punto, pausa, final) y ctx.reduceMotion con «Menos movimiento»
 * Uso: node tools/settest.js        Variables: ONLY=a,c,f (solo esas)
 */
'use strict';
const path = require('path'), fs = require('fs');
const CDP = require(path.join(__dirname, 'cdp.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, oks = 0;
function check(name, cond, info) { if (cond) { oks++; console.log('  ok   ' + name); } else { fails++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } return !!cond; }
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = k => !ONLY.length || ONLY.indexOf(k) >= 0;
const KEYS = { ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowLeft: ['ArrowLeft', 37], Enter: ['Enter', 13], Escape: ['Escape', 27], KeyL: ['l', 76], KeyJ: ['j', 74], KeyE: ['e', 69] };
const PAD = fs.readFileSync(path.join(__dirname, 'padplay.js'), 'utf8').match(/const PAD = `([\s\S]*?)`;/)[1].replace('__PADID__', JSON.stringify('Mando virtual de pruebas (STANDARD GAMEPAD)'));

(async () => {
  let page;
  const errs = [];
  try {
    page = await CDP.open({ size: '1280x720', init: [PAD] });
    const E = s => page.evalJs(s);
    const J = async s => JSON.parse(await E('JSON.stringify(' + s + ')'));
    const waitFor = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await E(expr)) return true; } catch (e) { } await sleep(100); } return false; };
    const ready = () => waitFor('!!(window.VB && VB.ctx && VB.ctx.state && VB.UI && VB.UI._settings)', 20000);
    const key = async (code, type) => { const k = KEYS[code]; const o = { type, code, key: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] }; if (type === 'keyDown' && k[0].length === 1) o.text = k[0]; await page.send('Input.dispatchKeyEvent', o); };
    const tap = async code => { await key(code, 'keyDown'); await sleep(60); await key(code, 'keyUp'); await sleep(120); };
    const fresh = async (q, store) => {
      await E(`(function(){ try { localStorage.clear(); ${store ? Object.keys(store).map(k => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof store[k] === 'string' ? store[k] : JSON.stringify(store[k]))});`).join('') : ''} } catch (e) {} return 1; })()`);
      await page.navigate(q); await ready(); await sleep(1500);
    };
    const S = () => J('VB.ctx.settings');
    const LS = async k => { const v = await E(`localStorage.getItem(${JSON.stringify(k)})`); try { return JSON.parse(v); } catch (e) { return v; } };
    const vis = sel => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e||e.closest('[hidden]'))return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()`;
    const tab = async id => { await E(`document.getElementById('setTabs-${id}').click(), 1`); await sleep(350); };

    await page.navigate('nonews=1'); await ready();
    check('arranca (VB.ctx, VB.UI._settings, resetSettings)', await E('!!(VB.ctx.actions.resetSettings && VB.UI._settings && VB.UI.openAbout)'));

    if (want('a')) {
      console.log('a) pestañas, filas y data-need');
      await fresh('debug=settings&panel=set&nonews=1');
      const tabs = await J(`[].map.call(document.querySelectorAll('#setTabs .tab'), function (b) { return b.getAttribute('data-tab'); })`);
      check('7 pestañas en orden (audio, image, cam, game, a11y, kit, info)', tabs.join() === 'audio,image,cam,game,a11y,kit,info', tabs);
      const rows = { audio: ['volume', 'sfxVol', 'crowdVol', 'musicVol'], image: ['quality', 'resScale', 'fpsCap', 'showFps', 'beachLight'], cam: ['camSens', 'camDist', 'camCuts', 'cam6'],
        game: ['showHelp', 'coachTips', 'aimSet', 'msTiming'], a11y: ['camStable', 'rumble', 'hudScale', 'softFlash', 'lessMotion', 'cbColors', 'ballStyle'], kit: ['kitShirt', 'kitAccent', 'kitShorts', 'kitPattern'] };
      for (const t of Object.keys(rows)) {
        await tab(t);
        const seen = await J(`[].filter.call(document.querySelectorAll('#optList .opt-g[data-tab="${t}"] .opt[data-opt]'), function (b) { return !b.closest('[hidden]') && b.offsetParent; }).map(function (b) { return b.getAttribute('data-opt'); })`);
        check('pestaña ' + t + ': filas ' + rows[t].join(', '), rows[t].every(k => seen.indexOf(k) >= 0), seen);
        check('pestaña ' + t + ': «Restablecer este apartado»', await E(vis(`.opt-g[data-tab="${t}"] .opt-reset`)));
      }
      await tab('info');
      const info = await J(`[document.getElementById('optVer').textContent, document.getElementById('optSave').textContent, [].map.call(document.querySelectorAll('.opt-g[data-tab="info"] [data-go]'), function (b) { return b.getAttribute('data-go'); })]`);
      check('Info: versión, progreso, Novedades y Créditos', /^0\.9\.\d+ \(\d+ [a-z]{3} \d{4}\)$/.test(info[0]) && /Guardado en/.test(info[1]) && info[2].join() === 'news,credits', info);
      await tab('cam');
      await E(`window.__o = VB.CameraRig.OPTS; VB.CameraRig.OPTS = []; window.__f = VB.FX.OPTS; VB.FX.OPTS = ['cbColors']; VB.ctx.actions.setSetting('camSens', 1.1); 1`);
      await sleep(200);
      const hid = await J(`[document.querySelector('[data-opt="camDist"]').hidden, document.querySelector('[data-opt="camCuts"]').hidden, document.querySelector('[data-opt="ballStyle"]').hidden, document.querySelector('[data-opt="cbColors"]').hidden]`);
      check('sin OPTS de cámara: Distancia y Planos ocultas; FX sin ballStyle: Balón oculta y Daltonismo visible', hid.join() === 'true,true,true,false', hid);
      await E(`VB.CameraRig.OPTS = window.__o; VB.FX.OPTS = window.__f; VB.ctx.actions.setSetting('camSens', 1); 1`); await sleep(200);
      check('con OPTS de vuelta, las filas reaparecen', !(await E(`document.querySelector('[data-opt="camDist"]').hidden`)));
    }

    if (want('b')) {
      console.log('b) teclado, mando y toque');
      await fresh('debug=settings&panel=set&nonews=1');
      await tab('image');
      await E(`document.querySelector('#setTabs .tab.on').focus(), 1`);
      let ok = false;
      for (let i = 0; i < 8 && !ok; i++) { await tap('ArrowDown'); ok = await E(`document.activeElement && document.activeElement.getAttribute('data-opt') === 'fpsCap'`); }
      check('teclado: ↓ llega a «Fotogramas»', ok);
      await tap('ArrowRight');
      check('teclado: → pone el tope a 30', (await S()).fpsCap === 30);
      await tap('ArrowRight');
      check('teclado: → otra vez vuelve a Máx.', (await S()).fpsCap === 0);
      // mando falso
      await E('__pad.connect(), 1'); await sleep(300);
      await E(`document.querySelector('[data-opt="showFps"]').focus(), 1`);
      await E('__pad.set([1,0])'); await sleep(140); await E('__pad.set([0,0])'); await sleep(250);
      check('mando: stick → cambia «Ver FPS»', (await S()).showFps === true);
      await E('__pad.set([1,0])'); await sleep(140); await E('__pad.set([0,0])'); await sleep(250);
      await E(`__pad.set(null,{5:1})`); await sleep(110); await E(`__pad.set(null,{5:0})`); await sleep(300);
      check('mando: RB pasa a la pestaña Cámara', (await J('VB.UI._settings().tab')) === 'cam');
      await E(`document.querySelector('[data-opt="camCuts"]').focus(), 1`);
      await E(`__pad.set(null,{0:1})`); await sleep(110); await E(`__pad.set(null,{0:0})`); await sleep(300);
      check('mando: A sobre «Planos de tele» → Menos', (await S()).camCuts === 'less');
      await E(`__pad.set(null,{1:1})`); await sleep(110); await E(`__pad.set(null,{1:0})`); await sleep(400);
      check('mando: B cierra Ajustes', !(await E('VB.UI.isPanelOpen()')));
      await E('__pad.disconnect(), 1'); await sleep(200);
      // toque / ratón: segmento y pista
      await page.navigate('debug=settings&panel=set&nonews=1'); await ready(); await sleep(1200);
      await tab('cam');
      const seg = await J(`(function(){ var s = document.querySelector('[data-seg="camDist"] [data-i="2"]').getBoundingClientRect(); return [s.left + s.width / 2, s.top + s.height / 2]; })()`);
      for (const t of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: seg[0], y: seg[1], button: 'left', clickCount: 1 });
      await sleep(300);
      check('clic en el segmento «Lejos»', (await S()).camDist === 'far');
      await tab('audio');
      const trk = await J(`(function(){ var r = document.querySelector('[data-sl="crowdVol"] .trk').getBoundingClientRect(); return [r.left + r.width * 0.4, r.top + r.height / 2]; })()`);
      for (const t of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: trk[0], y: trk[1], button: 'left', clickCount: 1 });
      await sleep(300);
      const cv = (await S()).crowdVol;
      check('clic en la pista del público al 40 % → 0,4', Math.abs(cv - 0.4) < 0.051, cv);
    }

    if (want('c')) {
      console.log('c) persistencia y guardado por dispositivo');
      await fresh('nonews=1');
      await E(`(function(){ var A = VB.ctx.actions; A.setSetting('resScale', 0.85); A.setSetting('fpsCap', 30); A.setSetting('showFps', true); A.setSetting('touchSize', 1.15); A.setSetting('padDead', 0.25);
        A.setSetting('camDist', 'near'); A.setSetting('crowdVol', 0.4); A.setSetting('volume', 0.7); A.setSetting('keys', {hit:['KeyL','KeyX']}); A.setSetting('lessMotion', 'on'); return 1; })()`);
      await page.navigate('nonews=1'); await ready(); await sleep(1000);
      const s = await S();
      check('tras recargar: resScale, fpsCap, showFps, touchSize, padDead', s.resScale === 0.85 && s.fpsCap === 30 && s.showFps === true && s.touchSize === 1.15 && s.padDead === 0.25, s);
      check('tras recargar: camDist, crowdVol, volume, keys, lessMotion', s.camDist === 'near' && s.crowdVol === 0.4 && s.volume === 0.7 && s.keys.hit && s.keys.hit[0] === 'KeyL' && s.lessMotion === 'on', s);
      const st = await LS('voley3d.settings'), dv = await LS('voley3d.device');
      check('voley3d.device = {resScale, fpsCap, showFps, touchSize, padDead}', dv && dv.resScale === 0.85 && dv.fpsCap === 30 && dv.showFps === true && dv.touchSize === 1.15 && dv.padDead === 0.25, dv);
      check('voley3d.settings sin las claves del dispositivo', st && !['resScale', 'fpsCap', 'showFps', 'touchSize', 'padDead'].some(k => k in st) && st.camDist === 'near', st && Object.keys(st));
      check('ctx.reduceMotion = true con «Menos movimiento: Sí»', (await E('VB.ctx.reduceMotion')) === true && (await E('Object.prototype.hasOwnProperty.call(VB.ctx, "reduceMotion")')));
      await E(`VB.ctx.actions.setSetting('lessMotion', 'off'), 1`);
      check('ctx.reduceMotion = false con «No»', (await E('VB.ctx.reduceMotion')) === false);
    }

    if (want('d')) {
      console.log('d) valores corruptos');
      const before = errs.length;
      await fresh('nonews=1', { 'voley3d.settings': { resScale: 3, keys: 'x', padKeys: { hit: [99] }, volume: 'alto', crowdVol: -5, camDist: 'lejisimos', lessMotion: 7, ballStyle: null, cbColors: 'si', sfxVol: 0.5 }, 'voley3d.device': { padDead: -1, fpsCap: 45, touchSize: 2, showFps: 'si', resScale: 3 } });
      let s = await S();
      check('resScale 3 → 0; keys "x" → {}; padKeys {hit:[99]} → {}', s.resScale === 0 && JSON.stringify(s.keys) === '{}' && JSON.stringify(s.padKeys) === '{}', s);
      check('padDead -1 → 0,18; fpsCap 45 → 0; touchSize 2 → 1; showFps "si" → false', s.padDead === 0.18 && s.fpsCap === 0 && s.touchSize === 1 && s.showFps === false, s);
      check('volume "alto" → 1; crowdVol -5 → 0; camDist → normal; lessMotion → auto; ballStyle → clasico; cbColors → false', s.volume === 1 && s.crowdVol === 0 && s.camDist === 'normal' && s.lessMotion === 'auto' && s.ballStyle === 'clasico' && s.cbColors === false, s);
      await fresh('nonews=1', { 'voley3d.settings': { keys: { hit: [123] } } });
      s = await S();
      check('keys {hit:[123]} → {}', JSON.stringify(s.keys) === '{}', s.keys);
      await fresh('nonews=1', { 'voley3d.settings': 'null', 'voley3d.device': '{rota' });
      s = await S();
      check('ajustes "null" y dispositivo roto → por defecto', s.resScale === 0 && s.crowdVol === 0.85 && s.volume === 1, s);
      check('sin errores JS con valores corruptos', page.errors.length === before, page.errors.slice(before));
    }

    if (want('e')) {
      console.log('e) migración del volumen del público');
      await fresh('nonews=1', { 'voley3d.settings': { sfxVol: 0.6 } });
      const s = await S(), au = await E(`VB.Audio && VB.Audio.getVolume ? VB.Audio.getVolume('crowd') : null`);
      check('{sfxVol: 0.6} → crowdVol 0,51', s.crowdVol === 0.51, s.crowdVol);
      check('VB.Audio.getVolume("crowd") = 0,51', Math.abs(au - 0.51) < 1e-6, au);
      await fresh('nonews=1', { 'voley3d.settings': { sfxVol: 0.6, crowdVol: 0.3 } });
      check('con crowdVol guardado no se migra', (await S()).crowdVol === 0.3);
    }

    if (want('f')) {
      console.log('f) resolución fija');
      await fresh('debug=rally&live=1&nonews=1');
      await E(`VB.ctx.actions.setSetting('resScale', 0.7), 1`); await sleep(300);
      const r = await J(`(function(){ var c = VB.ctx, q = c.quality, cap = c.isMobile ? (q.mobilePixelRatio || q.pixelRatio) : Math.min(2, q.pixelRatio); return [c.renderer.getPixelRatio(), Math.min(devicePixelRatio || 1, cap) * 0.7, c.renderScale]; })()`);
      check('pixelRatio = min(dpr, tope) × 0,7', Math.abs(r[0] - r[1]) < 1e-6 && r[2] === 0.7, r);
      await E(`VB.UI.openAbout && 0; VB.ctx.actions.pause(); 1`); await sleep(300);
      await E(`document.getElementById('btnPSettings').click(), 1`); await sleep(400); await tab('image');
      const note = await E(`document.getElementById('resNote').textContent`);
      check('ayuda «Fija: W × H píxeles»', /^Fija: \d+ × \d+ píxeles$/.test(note), note);
      await E(`VB.ctx.actions.setSetting('resScale', 0), 1`); await sleep(300);
      const r2 = await J(`[VB.ctx.renderer.getPixelRatio(), VB.ctx.renderScale, document.getElementById('resNote').textContent]`);
      check('Auto: escala 1 y «Auto: … (ahora 100 %)»', r2[1] === 1 && /^Auto: .*ahora 100 %/.test(r2[2]), r2);
    }

    if (want('g')) {
      console.log('g) tope de 30 fps');
      await fresh('debug=rally&live=1&aq=1&aqwarm=0&nonews=1', { 'voley3d.device': { fpsCap: 30 } });
      await sleep(2500);
      const fps = [];
      for (let i = 0; i < 6; i++) { await sleep(1000); fps.push(Math.round(await E('VB.ctx.fps'))); }
      const q = await J('VB.ctx.qLog.filter(function (e) { return /baja/.test(e.why); })');
      check('ctx.fps entre 27 y 33 durante 6 s', fps.every(f => f >= 27 && f <= 33), fps);
      check('sin bajadas de calidad («baja») con el tope', q.length === 0, q);
      await E(`VB.ctx.actions.setSetting('fpsCap', 0), 1`); await sleep(4500);
      const f2 = await E('VB.ctx.fps');
      check('sin tope vuelve a ir por encima de 40 fps', f2 > 40, f2);
    }

    if (want('h')) {
      console.log('h) contador de FPS');
      await fresh('debug=serve&nonews=1');
      check('#fps oculto por defecto', await E(`document.getElementById('fps').hidden`));
      await E(`VB.ctx.actions.setSetting('showFps', true), 1`); await sleep(2800);
      const t = await E(`document.getElementById('fps').hidden ? '' : document.getElementById('fps').textContent`);
      check('showFps → #fps visible con «NN fps | Nivel»', /^\d+ fps \| (Alta|Media|Baja)$/.test(t), t);
      await E(`VB.ctx.actions.setSetting('showFps', false), 1`); await sleep(200);
      check('showFps false → oculto', await E(`document.getElementById('fps').hidden`));
    }

    if (want('i')) {
      console.log('i) restablecer el apartado');
      await fresh('debug=settings&panel=set&nonews=1');
      await E(`(function(){ var A = VB.ctx.actions; A.setSetting('cbColors', true); A.setSetting('hudScale', 1.3); A.setSetting('lessMotion', 'on'); A.setSetting('camDist', 'far'); return 1; })()`);
      await tab('a11y');
      await E(`document.querySelector('.opt-g[data-tab="a11y"] .opt-reset').click(), 1`); await sleep(200);
      const armed = await J(`[document.querySelector('.opt-g[data-tab="a11y"] .opt-reset').textContent, VB.ctx.settings.cbColors]`);
      check('1ª pulsación: «Pulsa otra vez para restablecer» y nada cambia', /otra vez/.test(armed[0]) && armed[1] === true, armed);
      await E(`document.querySelector('.opt-g[data-tab="a11y"] .opt-reset').click(), 1`); await sleep(300);
      const s = await S();
      check('2ª pulsación: Accesibilidad a sus valores por defecto', s.cbColors === false && s.hudScale === 1 && s.lessMotion === 'auto', s);
      check('los demás apartados no cambian (camDist sigue en «far»)', s.camDist === 'far');
      await E(`(function(){ var b = document.querySelector('.opt-g[data-tab="a11y"] .opt-reset'); b.click(); return 1; })()`); await sleep(3300);
      check('sin la 2ª pulsación, a los 3 s vuelve el texto', /^Restablecer este apartado$/.test(await E(`document.querySelector('.opt-g[data-tab="a11y"] .opt-reset').textContent`)));
    }

    if (want('j')) {
      console.log('j) pila de vuelta entre paneles');
      await fresh('debug=settings&panel=set&nonews=1');
      await tab('game');
      await E(`document.querySelector('[data-go="ctl"]').focus(), 1`); await tap('Enter'); await sleep(400);
      let st = await J('VB.UI._settings()');
      check('Ajustes › Controles: panel ctl con Ajustes en la pila', st.panel === 'ctl' && st.stack.join() === 'set', st);
      await tap('Escape'); await sleep(500);
      st = await J('VB.UI._settings()');
      const foc = await E(`document.activeElement && document.activeElement.getAttribute('data-go')`);
      check('Esc vuelve a Ajustes en la pestaña Juego con el foco en «Controles»', st.panel === 'set' && st.tab === 'game' && st.stack.length === 0 && foc === 'ctl', [st, foc]);
      await tab('info');
      await E(`document.querySelector('[data-go="credits"]').click(), 1`); await sleep(400);
      st = await J('VB.UI._settings()');
      check('Info › Créditos abre Acerca de (Créditos) apilando Ajustes', st.panel === 'about' && st.stack.join() === 'set' && (await E(vis('#pnAbout'))) && /Creado por/i.test(await E(`document.getElementById('abBody').textContent`)), st);
      await E(`document.getElementById('btnAbOk').click(), 1`); await sleep(400);
      st = await J('VB.UI._settings()');
      check('«Entendido» vuelve a Ajustes › Info', st.panel === 'set' && st.tab === 'info', st);
      await tap('Escape'); await sleep(400);
      check('Esc en Ajustes cierra el panel', !(await E('VB.UI.isPanelOpen()')));
    }

    if (want('k')) {
      console.log('k) Controles: reasignar con una tecla real');
      await fresh('debug=controls&panel=ctl&nonews=1');
      const edit = await E(`!!document.querySelector('#ctlGrid .kslot[data-kind="key"][data-act="hit"][data-slot="0"]')`);
      if (!check('teclado editable (VB.Input.captureNext)', edit)) throw new Error('sin kslot');
      check('11 acciones con 2 teclas', (await E(`document.querySelectorAll('#ctlGrid .kslot[data-kind="key"]').length`)) === 22);
      await E(`document.querySelector('.kslot[data-act="hit"][data-slot="0"]').focus(), 1`);
      await tap('Enter'); await sleep(150);
      const cap = await J(`[VB.UI._settings().capturing, document.querySelector('.kslot.cap') ? document.querySelector('.kslot.cap').textContent : '', document.getElementById('ctlMsg').textContent]`);
      check('Intro sobre la tecla → «Pulsa una tecla…» y el pie «Esc cancela | Retroceso borra»', cap[0] && /Pulsa una tecla/.test(cap[1]) && /Esc cancela/.test(cap[2]) && /Retroceso borra/.test(cap[2]), cap);
      await tap('KeyL'); await sleep(250);
      let s = await S();
      check('L → Golpear: keys.hit = [KeyL, KeyX]', s.keys && s.keys.hit && s.keys.hit.join() === 'KeyL,KeyX', s.keys);
      const g = await J('VB.UI._settings()');
      check('el glifo de golpear del teclado pasa a «L»', g.glyph.hit === 'L' && !g.capturing, g);
      check('mensaje «L para Golpear y sacar»', /L para Golpear y sacar/.test(await E(`document.getElementById('ctlMsg').textContent`)));
      check('el panel sigue abierto y el foco en la misma tecla', (await E('VB.UI._settings().panel')) === 'ctl' && (await E(`document.activeElement && document.activeElement.getAttribute('data-act') === 'hit' && document.activeElement.textContent === 'L'`)));
      await tap('Enter'); await sleep(150); await tap('Escape'); await sleep(300);
      s = await S();
      check('Esc cancela la captura sin cerrar Controles ni cambiar teclas', (await E('VB.UI._settings().panel')) === 'ctl' && s.keys.hit.join() === 'KeyL,KeyX' && /Sin cambios/.test(await E(`document.getElementById('ctlMsg').textContent`)));
      await E(`document.querySelector('.kslot[data-act="jump"][data-slot="0"]').focus(), 1`);
      await tap('Enter'); await sleep(150); await tap('KeyL'); await sleep(300);
      s = await S();
      check('L en Saltar: se intercambian (Saltar = L, Golpear = Espacio) con «Cambiadas: …»', s.keys.jump && s.keys.jump[0] === 'KeyL' && s.keys.hit[0] === 'Space' && /Cambiadas: L para Saltar, Espacio para Golpear y sacar/.test(await E(`document.getElementById('ctlMsg').textContent`)), [s.keys, await E(`document.getElementById('ctlMsg').textContent`)]);
      await E(`document.querySelector('#ctlGrid .opt-reset[data-reset="keys"]').click(), 1`); await sleep(100);
      await E(`document.querySelector('#ctlGrid .opt-reset[data-reset="keys"]').click(), 1`); await sleep(300);
      s = await S();
      check('«Restablecer teclas» (doble) → keys {} y glifo J', JSON.stringify(s.keys) === '{}' && (await J('VB.UI._settings().glyph.hit')) === 'J', s.keys);
      // mando
      await E(`document.getElementById('ctlTabs-gamepad').click(), 1`); await sleep(300);
      check('pestaña Mando: 5 botones, Zona muerta y Vibración', (await E(`document.querySelectorAll('#ctlGrid .kslot[data-kind="pad"]').length`)) === 5 && (await E(vis('[data-opt="padDead"]'))) && (await E(vis('#ctlGrid [data-opt="rumble"]'))));
      await E(`document.querySelector('[data-opt="padDead"]').focus(), 1`); await tap('ArrowRight');
      check('Zona muerta → 25 % (pasos de 5)', (await S()).padDead === 0.25, (await S()).padDead);
      await E(`document.getElementById('ctlTabs-touch').click(), 1`); await sleep(300);
      check('pestaña Táctil: «Tamaño de botones»', await E(vis('#ctlGrid [data-opt="touchSize"]')));
    }

    if (want('l')) {
      console.log('l) pestañas compactas a 667×375 con el HUD al 130 %');
      await page.setSize('667x375', false);
      await fresh('debug=settings&panel=set&nonews=1', { 'voley3d.settings': { hudScale: 1.3 } });
      for (const t of ['audio', 'a11y', 'info']) {
        await tab(t);
        const r = await J(`(function(){ var row = document.querySelector('#setTabs .tb-row'), on = document.querySelector('#setTabs .tab.on .tb-t'); return { compact: VB.UI._settings().compact, fit: row.scrollWidth <= row.clientWidth + 2, label: on ? getComputedStyle(on).display !== 'none' : false, sw: document.scrollingElement.scrollWidth, w: innerWidth }; })()`);
        check('667×375 HUD 130 % pestaña ' + t + ': compacta, cabe, con etiqueta y sin desplazamiento horizontal', r.compact && r.fit && r.label && r.sw <= r.w, r);
      }
      await page.setSize('1280x720', false);
      await page.navigate('debug=settings&panel=set&nonews=1'); await ready(); await sleep(1200);
      const r2 = await J(`(function(){ var row = document.querySelector('#setTabs .tb-row'); return { compact: VB.UI._settings().compact, fit: row.scrollWidth <= row.clientWidth + 2 }; })()`);
      check('1280×720: las 7 etiquetas enteras', !r2.compact && r2.fit, r2);
    }

    if (want('m')) {
      console.log('m) título de la pestaña');
      await fresh('nonews=1');
      check('menú: «Make the Cut»', (await E('document.title')) === 'Make the Cut', await E('document.title'));
      await page.navigate('debug=point&nonews=1'); await ready(); await sleep(2500);
      const tp = await E('document.title');
      check('punto: «Set N | a-b — Make the Cut»', /^Set \d \| \d+-\d+ — Make the Cut$/.test(tp), tp);
      await E('VB.ctx.actions.pause(), 1'); await sleep(700);
      check('pausa: «Pausa — Make the Cut»', (await E('document.title')) === 'Pausa — Make the Cut', await E('document.title'));
      await page.navigate('debug=over&nonews=1'); await ready(); await sleep(3000);
      const to = await E('document.title');
      check('final: «¡Victoria! a-b» o «Derrota a-b»', /^(¡Victoria!|Derrota) \d-\d — Make the Cut$/.test(to), to);
    }
    errs.push.apply(errs, page.errors);
  } catch (e) { fails++; console.log('  FAIL excepción: ' + (e && e.stack || e)); if (page) errs.push.apply(errs, page.errors); }
  finally { if (page) page.close(); }
  const real = errs.filter(t => !/favicon/i.test(t));
  check('sin errores JS en toda la prueba', real.length === 0, real.slice(0, 4));
  console.log(fails ? '== settest: ' + fails + ' FALLOS (' + oks + ' ok) ==' : '== settest OK (' + oks + ' comprobaciones) ==');
  process.exit(fails ? 1 : 0);
})();
