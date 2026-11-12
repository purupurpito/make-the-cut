#!/usr/bin/env node
/* VOLEY 3D — tools/og-image.js (owner: ui_main)
 * Genera pages/og.png (1200×630), la imagen para compartir en redes (og:image / twitter:image, ver tools/build-pages.js).
 * Saca de index.html el SVG con los <defs> del logotipo (#mtcLogo: trazados, sin fuentes, así que sale igual siempre), monta una
 * página temporal (fondo #070b14 → #2b2547 con viñeta y una red estilizada en diagonal, logo centrado) con el rótulo
 * «VÓLEY 2 CONTRA 2 ◆ CARRERA» en Barlow Condensed 800 cursiva (Google Fonts; si no carga en 6 s, la imagen sale sin rótulo)
 * y la captura con Chrome headless (tools/cdp.js).
 * El PNG se commitea: se regenera a mano cuando cambie el logotipo, nunca en CI.
 * Uso: node tools/og-image.js [salida=pages/og.png]
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const CDP = require('./cdp.js');
const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'pages', 'og.png'));
setTimeout(() => { console.error('TIEMPO AGOTADO'); process.exit(2); }, 90000).unref();

function logoDefs() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const at = src.indexOf('id="mtcLogo"');
  if (at < 0) throw new Error('no encuentro #mtcLogo en index.html');
  const start = src.lastIndexOf('<svg', at), end = src.indexOf('</svg>', at);
  if (start < 0 || end < 0) throw new Error('no encuentro el <svg> del logotipo');
  return src.slice(start, end + 6);
}

function page(defs) {
  // red: franja de malla en diagonal, muy tenue, detrás del logo
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&display=block">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#070b14}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse 75% 85% at 50% 42%,#2b2547 0%,#1a1830 48%,#070b14 100%)}
.net{position:absolute;left:-200px;top:250px;width:1600px;height:150px;transform:rotate(-14deg);opacity:.16;
  background-image:linear-gradient(90deg,#fff8ee 2px,transparent 2px),linear-gradient(0deg,#fff8ee 2px,transparent 2px);
  background-size:26px 26px;border-top:12px solid #fff8ee;border-bottom:4px solid #fff8ee}
.vig{position:absolute;inset:0;box-shadow:inset 0 0 180px 40px rgba(0,0,0,.65)}
.logo{position:absolute;left:50%;top:18px;width:820px;height:515px;transform:translateX(-50%)}
.tag{position:absolute;left:0;right:0;bottom:30px;text-align:center;color:#fff8ee;font:italic 800 46px/1 'Barlow Condensed',sans-serif;
  letter-spacing:.06em;text-transform:uppercase;text-shadow:0 3px 0 #1d1530}
.tag b{color:#ffd23f;font-weight:800;margin:0 .35em}
.nofont .tag{display:none}
</style></head><body>
${defs}
<div class="bg"></div><div class="net"></div><div class="vig"></div>
<svg class="logo" viewBox="0 0 780 490" aria-hidden="true"><use href="#mtcLogo"/></svg>
<div class="tag">Vóley 2 contra 2<b>◆</b>Carrera</div>
<script>
window.__ready = false;
var done = function (ok) { if (!ok) document.documentElement.className = 'nofont'; window.__font = ok; window.__ready = true; };
var t = setTimeout(function () { done(false); }, 6000);
document.fonts.load("italic 800 46px 'Barlow Condensed'").then(function (f) { return document.fonts.ready.then(function () { clearTimeout(t); done(f && f.length > 0); }); }, function () { clearTimeout(t); done(false); });
</script></body></html>`;
}

(async () => {
  let pg, tmp;
  try {
    tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vbog-')), 'og.html');
    fs.writeFileSync(tmp, page(logoDefs()));
    pg = await CDP.open({ size: '1200x630' });
    const loaded = new Promise(r => pg.on('Page.loadEventFired', r));
    await pg.send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
    await Promise.race([loaded, CDP.sleep(20000)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 9000 && !(await pg.evalJs('window.__ready === true'))) await CDP.sleep(100);
    const font = await pg.evalJs('window.__font');
    await CDP.sleep(300);
    await pg.shot(OUT);
    const b = fs.readFileSync(OUT);
    console.log('og.png: ' + OUT + ' (' + b.readUInt32BE(16) + '×' + b.readUInt32BE(20) + ', ' + Math.round(b.length / 1024) + ' KB' +
      (font ? '' : ', SIN rótulo: no cargó Barlow Condensed') + ')');
    if (pg.errors.length) console.log('avisos de la página: ' + pg.errors.join(' | '));
  } catch (e) {
    console.error('og-image: ' + (e && e.stack || e)); process.exitCode = 1;
  } finally {
    if (pg) pg.close();
    if (tmp) try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch (e) { }
  }
})();
