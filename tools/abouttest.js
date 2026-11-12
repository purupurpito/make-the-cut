#!/usr/bin/env node
/* VOLEY 3D — tools/abouttest.js (owner: ui_main)
 * Pruebas de E7 (escaparate: versión, novedades, créditos, metadatos de Pages). Dos partes:
 *  1) SIN navegador (siempre): js/version.js en vm (semver, CHANGELOG ordenado y con [0].v === VERSION, fechas válidas, items de
 *     90 caracteres como mucho, nada de «1.er» «2.º» «3.er», «·», «navegador» ni arrobas en todo el fichero, CREDITS.by === 'Ferran',
 *     línea MIT de three.js con el año de la cabecera de three.min.js 0.149.0) y tools/build-pages.js en una carpeta temporal
 *     (description, og:title, og:image absoluta, twitter:card, canonical, theme-color, __vbBuild con el sha de GITHUB_SHA, un solo
 *     rel="icon" y ninguno con data:, manifest con description/id/categories, og.png de 1200×630 leyendo el IHDR) y sus guardas
 *     (versión que no cuadra con el CHANGELOG, sin og.png) en una copia mínima del proyecto.
 *  2) CON navegador (tools/cdp.js; NOCDP=1 la salta): (a) perfil limpio, sin aviso y seen = VERSION; (b) jugador que vuelve con
 *     seen viejo: Novedades sale sola una vez; (c) con TOUCH y el aviso de instalar abierto no sale encima; (d) document.title en
 *     menú, punto, pausa y final; (e) mando falso: Ajustes › Info › Créditos y B vuelve a Ajustes/Info.
 *     Si ui.js aún no tiene la parte de E7 (VB.UI.openAbout / _about), la parte 2 se salta con un aviso (STRICT=1 la da por fallo).
 * Uso: node tools/abouttest.js     Sale con 1 si falla algo.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let fail = 0;
const check = (c, m) => { if (!c) { fail++; console.error('FALLO:', m); } else console.log('ok:', m); return !!c; };
const semv = v => String(v).split('.').map(Number);
const cmpV = (a, b) => { a = semv(a); b = semv(b); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
function pngSize(f) { const b = fs.readFileSync(f); return b.toString('ascii', 12, 16) === 'IHDR' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0]; }

// ---------------------------------------------------------------- 1) sin navegador
console.log('== version.js ==');
const VFILE = path.join(ROOT, 'js', 'version.js'), vsrc = fs.readFileSync(VFILE, 'utf8');
const VB = {}; vm.runInNewContext(vsrc, { VB, window: { VB } });
check(/^\d+\.\d+\.\d+$/.test(VB.VERSION || ''), 'VERSION semver: ' + VB.VERSION);
check(validDate(VB.VERSION_DATE), 'VERSION_DATE válida: ' + VB.VERSION_DATE);
const CL = VB.CHANGELOG || [];
check(CL.length > 0 && CL[0].v === VB.VERSION, 'CHANGELOG[0].v === VERSION');
check(CL[0] && CL[0].d === VB.VERSION_DATE, 'CHANGELOG[0].d === VERSION_DATE');
let ord = true, dates = true, items = true, longest = 0;
CL.forEach((e, i) => {
  if (!validDate(e.d) || !e.t || !Array.isArray(e.items) || !e.items.length) dates = false;
  if (i && (cmpV(CL[i - 1].v, e.v) <= 0 || CL[i - 1].d < e.d)) ord = false;
  (e.items || []).forEach(t => { longest = Math.max(longest, String(t).length); if (typeof t !== 'string' || t.length > 90 || !t.trim()) items = false; });
});
check(ord, 'CHANGELOG de más nueva a más vieja (versión y fecha)');
check(dates, 'entradas con fecha válida, título e items');
check(items, 'items de 90 caracteres como mucho (el más largo: ' + longest + ')');
const bad = [['1.er', /1\.er/], ['2.º', /2\.º/], ['3.er', /3\.er/], ['«·»', /·/], ['navegador', /navegador/i], ['arroba', /@/]].filter(([, r]) => r.test(vsrc)).map(x => x[0]);
check(!bad.length, 'version.js sin ordinales con punto, punto medio, «navegador» ni arrobas' + (bad.length ? ' (hay: ' + bad.join(', ') + ')' : ''));
const CR = VB.CREDITS || {};
check(CR.by === 'Ferran', 'CREDITS.by === «Ferran»');
check((CR.tools || []).some(t => /three\.js r149.*MIT/.test(t)), 'créditos con la línea de three.js r149 (MIT)');
check(/Copyright © 2010-2023 Three\.js Authors/.test((CR.licenses || {}).three || '') && /MIT License/.test(CR.licenses.three) &&
  /WITHOUT WARRANTY OF ANY KIND/.test(CR.licenses.three), 'licencia MIT de three.js completa, 2010-2023 (cabecera de three.min.js 0.149.0)');
check(/Open Font License/.test(CR.fonts || '') && /Open Font License/.test((CR.licenses || {}).ofl || ''), 'tipografía y resumen de la OFL');
check(/inventados/.test(CR.note || ''), 'aviso de clubes y jugadores inventados');

console.log('== build-pages ==');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vbabout-'));
function runBuild(root, out, env) {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'build-pages.js'), out], { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
try {
  const site = path.join(tmp, 'site');
  const r = runBuild(ROOT, site, { GITHUB_SHA: 'abcdef1234567890', PAGES_URL: '' });
  check(r.code === 0, 'build-pages sale con 0' + (r.code ? ': ' + r.out.trim() : ''));
  if (r.code === 0) {
    const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    const head = (/<head>([\s\S]*?)<\/head>/.exec(html) || [])[1] || '';
    check(/<meta name="description" content="[^"]{60,}">/.test(head), 'head: description');
    check(/<meta property="og:title" content="Make the Cut">/.test(head), 'head: og:title');
    check(/<meta property="og:image" content="https:\/\/[^"]+\/og\.png\?v=\d+\.\d+\.\d+">/.test(head), 'head: og:image absoluta');
    check(/<meta property="og:image:width" content="1200">/.test(head) && /og:image:height" content="630"/.test(head), 'head: og:image 1200×630');
    check(/<meta name="twitter:card" content="summary_large_image">/.test(head), 'head: twitter:card summary_large_image');
    check(/<link rel="canonical" href="https:\/\/[^"]+\/">/.test(head), 'head: canonical');
    check(/<meta name="theme-color"/.test(head), 'head: theme-color');
    const vb = /window\.__vbBuild=(\{[^<]*\})/.exec(head);
    let b = null; try { b = vb && JSON.parse(vb[1]); } catch (e) { }
    check(b && b.v === VB.VERSION && b.sha === 'abcdef1' && !isNaN(Date.parse(b.date)), 'head: __vbBuild {v, sha de 7, date}');
    const icons = html.match(/<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*>/gi) || [];
    check(icons.length === 1 && /icon\.svg/.test(icons[0]), 'un solo rel="icon" (icon.svg)');
    check(!/<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*href=["']data:/i.test(html), 'ningún favicon con data: en _site');
    const man = JSON.parse(fs.readFileSync(path.join(site, 'manifest.webmanifest'), 'utf8'));
    check(man.description && man.id === './' && (man.categories || []).includes('games'), 'manifest con description, id y categories');
    const og = path.join(site, 'og.png');
    check(fs.existsSync(og) && pngSize(og).join('x') === '1200x630', 'og.png en _site, 1200×630 (IHDR: ' + (fs.existsSync(og) ? pngSize(og).join('×') : '-') + ')');
  }
  check(pngSize(path.join(ROOT, 'pages', 'og.png')).join('x') === '1200x630', 'pages/og.png 1200×630');

  // guardas, en una copia mínima del proyecto (index de una línea, version.js tocado)
  const mini = (ver, cl, og, idx) => {
    const d = fs.mkdtempSync(path.join(tmp, 'mini-'));
    for (const s of ['tools', 'js', 'pages']) fs.mkdirSync(path.join(d, s));
    fs.copyFileSync(path.join(ROOT, 'tools', 'build-pages.js'), path.join(d, 'tools', 'build-pages.js'));
    fs.writeFileSync(path.join(d, 'js', 'version.js'), `VB.VERSION=${JSON.stringify(ver)};VB.CHANGELOG=[{v:${JSON.stringify(cl)},d:'2026-01-01',t:'x',items:['x']}];`);
    if (og) fs.copyFileSync(path.join(ROOT, 'pages', 'og.png'), path.join(d, 'pages', 'og.png'));
    fs.writeFileSync(path.join(d, 'index.html'), idx || '<title>Make the Cut</title>\n<meta name="theme-color" content="#070b14">\n<p>hola</p>\n');
    return d;
  };
  let d = mini('1.2.3', '1.2.2', true);
  check(runBuild(d, path.join(d, '_s')).code === 1, 'guarda: CHANGELOG[0].v distinto de VERSION hace fallar el build');
  d = mini('1.2', '1.2', true);
  check(runBuild(d, path.join(d, '_s')).code === 1, 'guarda: VERSION no semver hace fallar el build');
  d = mini('1.2.3', '1.2.3', false);
  check(runBuild(d, path.join(d, '_s')).code === 1, 'guarda: sin pages/og.png falla el build');
  d = mini('1.2.3', '1.2.3', true, '<title>Make the Cut</title>\n<meta name="theme-color" content="#070b14">\n' +
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'><circle r=\'4\' fill=\'%2300aa99\'/></svg>">\n<p>hola</p>\n');
  const rr = runBuild(d, path.join(d, '_s'));
  const ih = rr.code === 0 ? fs.readFileSync(path.join(d, '_s', 'index.html'), 'utf8') : '';
  check(rr.code === 0 && !/data:image/.test(ih) && /href="icon\.svg"/.test(ih), 'favicon con data URI (con «>» dentro) quitado en Pages');
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
}

// ---------------------------------------------------------------- 2) con navegador
async function browser() {
  const CDP = require('./cdp.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const V = VB.VERSION;
  const returning = `(function(){try{if(sessionStorage.getItem('vbAboutInit'))return;sessionStorage.setItem('vbAboutInit','1');
    localStorage.setItem('voley3d.record',JSON.stringify({played:3,won:1}));localStorage.setItem('voley3d.seen',JSON.stringify({v:'0.0.1'}));}catch(e){}})();`;
  const vis = sel => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e||e.hidden)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';})()`;
  const waitFor = async (pg, expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await pg.evalJs(expr)) return true; } catch (e) { } await sleep(100); } return false; };
  const ready = pg => waitFor(pg, 'window.VB&&VB.ctx&&VB.ctx.state&&VB.UI', 20000);
  let pg;
  try {
    // (a) perfil limpio
    pg = await CDP.open({ size: '1280x720' });
    await pg.navigate(''); await ready(pg);
    if (!(await pg.evalJs('!!(VB.UI&&VB.UI.openAbout&&VB.UI._about)'))) {
      const m = 'ui.js aún sin la parte de E7 (VB.UI.openAbout / VB.UI._about): pruebas del navegador saltadas';
      if (process.env.STRICT === '1') check(false, m); else console.log('AVISO: ' + m);
      return;
    }
    await sleep(4200);
    const a = await pg.evalJs('JSON.stringify({ab:VB.UI._about(),seen:localStorage.getItem("voley3d.seen")})');
    const A = JSON.parse(a); let seen = null; try { seen = JSON.parse(A.seen); } catch (e) { }
    check(A.ab.auto !== 'shown' && seen && seen.v === V, '(a) perfil limpio: sin novedades y voley3d.seen = ' + V + ' (' + a + ')');
    pg.close();
    // (b) jugador que vuelve
    pg = await CDP.open({ size: '1280x720', init: [returning] });
    await pg.navigate(''); await ready(pg);
    const shown = await waitFor(pg, 'VB.UI.isPanelOpen&&VB.UI.isPanelOpen()&&' + vis('#pnAbout'), 7000);
    check(shown, '(b) jugador que vuelve: Novedades se abre sola (#pnAbout)');
    const s2 = await pg.evalJs('localStorage.getItem("voley3d.seen")');
    check(/"v":"/.test(s2 || '') && JSON.parse(s2).v === V, '(b) seen marcado al abrir: ' + s2);
    await pg.navigate(''); await ready(pg); await sleep(4500);
    check(!(await pg.evalJs(vis('#pnAbout'))), '(b) tras recargar ya no sale');
    pg.close();
    // (c) táctil con el aviso de instalar abierto
    pg = await CDP.open({ size: '844x390', touch: true, init: [returning] });
    await pg.navigate(''); await ready(pg);
    const inst = await pg.evalJs('!!(VB.Install&&VB.Install._as)&&(VB.Install._as("ios"),true)');
    if (inst) { await sleep(4800); check(!(await pg.evalJs(vis('#pnAbout'))), '(c) con el aviso de instalar abierto, Novedades no sale encima'); }
    else console.log('AVISO: (c) sin VB.Install._as: saltada');
    pg.close();
    // (d) título de la pestaña
    pg = await CDP.open({ size: '1280x720' });
    await pg.navigate('nonews=1'); await ready(pg); await sleep(800);
    check((await pg.evalJs('document.title')) === 'Make the Cut', '(d) menú: «Make the Cut»');
    await pg.navigate('debug=point'); await ready(pg); await sleep(3500);
    const tp = await pg.evalJs('document.title');
    check(/Set 1 \|/.test(tp), '(d) debug=point: «' + tp + '»');
    await pg.navigate('debug=serve'); await ready(pg); await sleep(3500);
    await pg.evalJs('VB.ctx.actions&&VB.ctx.actions.pause&&VB.ctx.actions.pause()'); await sleep(900);
    const tz = await pg.evalJs('document.title');
    check(tz === 'Pausa — Make the Cut', '(d) pausa: «' + tz + '»');
    await pg.navigate('debug=over'); await ready(pg); await sleep(3500);
    const to = await pg.evalJs('document.title');
    check(/^(¡Victoria!|Derrota)/.test(to), '(d) debug=over: «' + to + '»');
    pg.close();
    // (e) mando falso: Ajustes › Info › Créditos › B
    const PAD = fs.readFileSync(path.join(__dirname, 'padplay.js'), 'utf8').match(/const PAD = `([\s\S]*?)`;/)[1].replace('__PADID__', JSON.stringify('Mando virtual de pruebas (STANDARD GAMEPAD)'));
    pg = await CDP.open({ size: '1280x720', init: [PAD] });
    await pg.navigate('nonews=1&panel=set&tab=info'); await ready(pg); await sleep(1500);
    await pg.evalJs('__pad.connect()'); await sleep(300);
    const press = async b => { await pg.evalJs(`__pad.set(null,{${b}:1})`); await sleep(100); await pg.evalJs(`__pad.set(null,{${b}:0})`); await sleep(250); };
    const focused = await pg.evalJs(`(function(){var g=document.querySelector('.opt-g[data-tab="info"]');if(!g)return false;var b=[].slice.call(g.querySelectorAll('button,.opt')).filter(function(x){return /Créditos/.test(x.textContent)})[0];if(!b)return false;b.focus();return document.activeElement===b;})()`);
    check(focused, '(e) Ajustes › Info con la fila «Créditos»');
    if (focused) {
      await press(0);
      const ok = await waitFor(pg, vis('#pnAbout'), 2000);
      check(ok, '(e) A en «Créditos» abre Acerca de');
      await press(1);
      const back = await waitFor(pg, '!' + vis('#pnAbout') + '&&' + vis('.opt-g[data-tab="info"]'), 2000);
      check(back, '(e) B vuelve a Ajustes en la pestaña Info');
    }
    if (pg.errors.length) check(false, 'errores JS: ' + pg.errors.slice(0, 3).join(' | '));
  } finally { if (pg) pg.close(); }
}

(async () => {
  if (process.env.NOCDP !== '1') {
    console.log('== navegador ==');
    try { await browser(); } catch (e) { check(false, 'navegador: ' + (e && e.message || e)); }
  }
  console.log(fail ? '== ' + fail + ' FALLOS ==' : '== abouttest OK ==');
  process.exit(fail ? 1 : 0);
})();
