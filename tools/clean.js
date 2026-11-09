/* VOLEY 3D — tools/clean.js (owner: ui_main)
 * Limpieza de lo que dejan las herramientas de DevTools cuando se interrumpen (Ctrl+C, cuelgue, PC apagado):
 * - procesos de Chrome huérfanos con un perfil vb3c-* (más de AGE minutos, y su carpeta también) → taskkill /T /F;
 * - carpetas vb3c-* de %TEMP% de más de DEAD minutos (8 por defecto) que ningún proceso vivo usa (herramienta muerta sin close());
 * - carpetas vb3c-* de %TEMP% de más de AGE minutos.
 * Nunca toca el Chrome de una herramienta en marcha (proceso o carpeta recientes).
 * Uso: node tools/clean.js            (AGE=60 por defecto)
 *      AGE=10 node tools/clean.js     (umbral en minutos)
 *      DEAD=5 node tools/clean.js     (umbral en minutos para carpetas sin proceso vivo)
 *      DRY=1 node tools/clean.js      (solo lista)
 * cdp.js ya hace esto solo al abrir (sweepProfiles: perfiles atascados o una vez por hora); esto es para hacerlo a mano.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const CDP = require('./cdp.js');
const AGE = (+(process.env.AGE || 60) || 60) * 60e3, DEAD = (+(process.env.DEAD || 8) || 8) * 60e3, DRY = !!process.env.DRY;

function listProfiles() {
  try { return fs.readdirSync(os.tmpdir()).filter(n => /^vb3c-/.test(n)).map(n => { const d = path.join(os.tmpdir(), n); let m = 0; try { m = fs.statSync(d).mtimeMs; } catch (e) { } return { n, d, m }; }); } catch (e) { return []; }
}
const before = listProfiles();
const k = CDP.killOrphans(AGE, DRY);
for (const r of k.found) console.log((DRY ? 'huérfano ' : 'cerrado  ') + r.pid + ' ' + r.name + ' · ' + r.profile + ' · desde ' + new Date(r.created).toISOString().replace('T', ' ').slice(0, 16));
// carpetas muertas (sin Chrome vivo) de más de DEAD minutos: no hace falta esperar a la hora
const dd = CDP.sweepDead(DEAD, DRY);
if (DRY) for (const n of dd.checked) console.log('carpeta muerta ' + n);
let removed = dd.removed, kept = 0, stuck = dd.stuck;
const lim = Date.now() - AGE;
for (const p of listProfiles()) {
  if (p.m > lim) { kept++; continue; }
  if (DRY) { console.log('carpeta vieja ' + p.n); continue; }
  if (CDP.rmProfile(p.d)) removed++; else { stuck++; console.log('NO se deja borrar ' + p.n); }
}
console.log('procesos huérfanos: ' + k.found.length + (DRY ? '' : ' (cerrados ' + k.killed.length + ')') + ' · carpetas vb3c-*: ' + before.length + ' → ' + listProfiles().length +
  (DRY ? ' (muertas ' + dd.checked.length + ')' : ' (borradas ' + removed + ', recientes ' + kept + (dd.live ? ', en uso ' + dd.live : '') + (stuck ? ', atascadas ' + stuck : '') + ')'));
process.exit(stuck ? 1 : 0);
