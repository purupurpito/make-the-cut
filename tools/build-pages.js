#!/usr/bin/env node
/* VOLEY 3D — tools/build-pages.js (owner: ui_main)
 * Genera la versión para GitHub Pages en _site/ a partir de index.html (formato Artifact, sin doctype/html/head/body):
 * envuelve el contenido en un documento HTML5 completo (modo estándar, lang="es", charset) y copia js/.
 * Lo usa .github/workflows/pages.yml en cada push a main. Uso local: node tools/build-pages.js [salida=_site]
 * E7 (sprint 5): lee la versión de js/version.js (vm, sin DOM) e inyecta en el <head> la descripción, Open Graph, Twitter card,
 * canonical y window.__vbBuild = {v, sha, date} (sha = GITHUB_SHA de Actions, 7 caracteres; NO se llama a git). Quita el favicon
 * con data URI de index.html (en Pages manda icon.svg) y amplía el manifest (description, id, categories).
 * Guardas que hacen FALLAR el build: VB.VERSION ausente o no semver, CHANGELOG[0].v !== VERSION, falta pages/og.png, y un index
 * con más (o menos) de un rel="icon".
 * PAGES_URL=<url> cambia la dirección pública (por defecto https://purupurpito.github.io/make-the-cut/).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), OUT = path.resolve(ROOT, process.argv[2] || '_site');
function fail(msg) { console.error('build-pages: ' + msg); process.exit(1); }
const srcRaw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// El favicon con data URI de index.html (para file:// y el Artifact) sobra en Pages: manda icon.svg.
// (los valores entre comillas pueden llevar «>» sin escapar dentro del SVG, por eso se recorre atributo a atributo)
const linkTag = /[ \t]*<link\b(?:[^>"']|"[^"]*"|'[^']*')*>[ \t]*\r?\n?/gi;
const noDataIcon = s => s.replace(linkTag, t => /\brel=["'](?:shortcut )?icon["']/i.test(t) && /\bhref=["']\s*data:/i.test(t) ? '' : t);
const src = noDataIcon(srcRaw);
if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(srcRaw)) throw new Error('index.html ya trae doctype/html/head/body: revisa el formato Artifact');

// ---- versión: una sola fuente, js/version.js
const VBV = {};
try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'version.js'), 'utf8'), { VB: VBV, window: { VB: VBV } }); }
catch (e) { fail('no se puede leer js/version.js (' + e.message + ')'); }
const VERSION = VBV.VERSION;
if (typeof VERSION !== 'string' || !/^\d+\.\d+\.\d+$/.test(VERSION)) fail('VB.VERSION falta o no es semver x.y.z: ' + VERSION);
const C0 = Array.isArray(VBV.CHANGELOG) && VBV.CHANGELOG[0];
if (!C0 || C0.v !== VERSION) fail('CHANGELOG[0].v (' + (C0 && C0.v) + ') no coincide con VERSION ' + VERSION + ': añade arriba la entrada de la versión');
if (!fs.existsSync(path.join(ROOT, 'pages', 'og.png'))) fail('falta pages/og.png (se genera con node tools/og-image.js)');

let BASE = process.env.PAGES_URL || 'https://purupurpito.github.io/make-the-cut/';
if (!BASE.endsWith('/')) BASE += '/';
const DESC = 'Vóley cartoon en 3D: partidos 2 contra 2 y 6 contra 6, pista cubierta y playa, y una Carrera con fichajes, fama y ' +
  'Salón de la Fama. Gratis en móvil y ordenador, con mando, teclado o táctil.';
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const SHA = String(process.env.GITHUB_SHA || '').replace(/[^0-9a-f]/gi, '').slice(0, 7);
const OG_IMG = BASE + 'og.png?v=' + VERSION;
const metaTags = [
  '<meta name="description" content="' + attr(DESC) + '">',
  '<link rel="canonical" href="' + attr(BASE) + '">',
  '<meta property="og:type" content="website"><meta property="og:site_name" content="Make the Cut"><meta property="og:locale" content="es_ES">',
  '<meta property="og:title" content="Make the Cut"><meta property="og:description" content="' + attr(DESC) + '">',
  '<meta property="og:url" content="' + attr(BASE) + '"><meta property="og:image" content="' + attr(OG_IMG) + '">',
  '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
    '<meta property="og:image:alt" content="Logotipo de Make the Cut: el rótulo partido por un remate">',
  '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' + attr(OG_IMG) + '">',
  '<meta name="application-name" content="Make the Cut">',
  '<script>window.__vbBuild=' + JSON.stringify({ v: VERSION, sha: SHA, date: new Date().toISOString() }).replace(/</g, '\\u003c') + '</script>'
].join('\n');

// Las etiquetas de cabecera iniciales (title, meta, link) van al <head>; el resto (style, marcado, scripts) al <body>.
const m = /^(\s*(?:<title>[\s\S]*?<\/title>|<meta\b[^>]*>|<link\b[^>]*>)\s*)+/i.exec(src);
let head = m ? m[0] : '', body = src.slice(head.length);
// Además, TODAS las líneas que son solo una etiqueta <meta>/<link> (p. ej. el viewport, que en index.html va tras el primer
// <script>) suben al <head>: un <meta name="viewport"> en el <body> lo ignoran los móviles (zoom con doble toque).
const lone = /^[ \t]*<(?:meta|link)\b[^>]*>[ \t]*\r?\n/gim;
head += (body.match(lone) || []).join(''); body = body.replace(lone, '');
// Versión instalable (PWA): «Añadir a pantalla de inicio» abre el juego a pantalla completa, sin barra de direcciones
// (en iPhone es la única forma: Safari no tiene API de pantalla completa para páginas).
const pwa = '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon.svg" type="image/svg+xml">\n' +
  '<link rel="apple-touch-icon" href="icon-180.png">\n<meta name="mobile-web-app-capable" content="yes">\n' +
  '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n' +
  '<meta name="apple-mobile-web-app-title" content="Make the Cut">';
const html = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n' + head.trim() + '\n' + pwa + '\n' + metaTags +
  '\n</head>\n<body>\n' + body.trim() + '\n</body>\n</html>\n';
const manifest = { id: './', name: 'Make the Cut', short_name: 'Make the Cut', description: DESC, categories: ['games', 'sports'],
  lang: 'es', start_url: './', scope: './', display: 'fullscreen',
  orientation: 'landscape', background_color: '#070b14', theme_color: '#070b14',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }] };
// Cada script lleva ?v=<hash de su contenido>: así el navegador (y la caché de 10 min de GitHub Pages) no sirve un js viejo
// con un index nuevo. El index.html sí puede tardar esos 10 min en renovarse; los js que referencia son siempre los suyos.
const crypto = require('crypto');
const ver = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'js', f))).digest('hex').slice(0, 8);
const htmlV = html.replace(/src="js\/([A-Za-z0-9_-]+\.js)"/g, (m, f) => 'src="js/' + f + '?v=' + ver(f) + '"');
const icons = (htmlV.match(/<link\b[^>]*\brel=["'](?:shortcut )?icon["']/gi) || []).length;
if (icons !== 1) fail('el index de Pages tiene ' + icons + ' rel="icon" (debe haber uno, icon.svg)');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'js'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), htmlV);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
for (const f of fs.readdirSync(path.join(ROOT, 'pages'))) fs.copyFileSync(path.join(ROOT, 'pages', f), path.join(OUT, f)); // iconos y og.png
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(OUT, 'js', f));
console.log('Pages listo en ' + OUT + ' (' + fs.readdirSync(path.join(OUT, 'js')).length + ' scripts, v' + VERSION + (SHA ? ' ' + SHA : '') + ')');
