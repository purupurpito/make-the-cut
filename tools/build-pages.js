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
const head = m ? m[0] : '', body = src.slice(head.length);
const html = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n' + head.trim() +
  '\n<meta name="description" content="Vóley 2 contra 2 en 3D en el navegador: teclado, mando y táctil.">\n</head>\n<body>\n' + body.trim() + '\n</body>\n</html>\n';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'js'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(OUT, 'js', f));
console.log('Pages listo en ' + OUT + ' (' + fs.readdirSync(path.join(OUT, 'js')).length + ' scripts)');
