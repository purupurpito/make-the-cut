#!/usr/bin/env node
/* VOLEY 3D — tools/build-pages.js (owner: ui_main)
 * Genera la versión para GitHub Pages en _site/ a partir de index.html (formato Artifact, sin doctype/html/head/body):
 * envuelve el contenido en un documento HTML5 completo (modo estándar, lang="es", charset) y copia js/.
 * Lo usa .github/workflows/pages.yml en cada push a main. Uso local: node tools/build-pages.js [salida=_site]
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.resolve(ROOT, process.argv[2] || '_site');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(src)) throw new Error('index.html ya trae doctype/html/head/body: revisa el formato Artifact');
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
const html = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n' + head.trim() + '\n' + pwa +
  '\n</head>\n<body>\n' + body.trim() + '\n</body>\n</html>\n';
const manifest = { name: 'Make the Cut', short_name: 'Make the Cut', lang: 'es', start_url: './', scope: './', display: 'fullscreen',
  orientation: 'landscape', background_color: '#070b14', theme_color: '#070b14',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }] };
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'js'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
for (const f of fs.readdirSync(path.join(ROOT, 'pages'))) fs.copyFileSync(path.join(ROOT, 'pages', f), path.join(OUT, f)); // iconos
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(OUT, 'js', f));
console.log('Pages listo en ' + OUT + ' (' + fs.readdirSync(path.join(OUT, 'js')).length + ' scripts)');
