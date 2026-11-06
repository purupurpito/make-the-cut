/* VOLEY 3D — tools/chrome.js (owner: ui_main)
 * Lanzador común de Chrome headless para tools/drive.js y tools/eval.js.
 * - Busca Chrome en Windows / Mac / Linux (o usa la variable CHROME).
 * - Usa la tarjeta gráfica por defecto (ANGLE d3d11 en Windows, metal en Mac, gl en Linux);
 *   GL=swiftshader fuerza render por software y GL=vulkan|gl|d3d11 fuerza otro backend.
 * - kill() mata el árbol entero de procesos (taskkill /T en Windows, grupo de procesos en POSIX).
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), url = require('url');
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const c = WIN ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ] : MAC ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] :
    ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) { } }
  return 'google-chrome';
}

function gpuFlags() {
  const gl = process.env.GL || (WIN ? 'd3d11' : MAC ? 'metal' : 'gl');
  if (gl === 'swiftshader') return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  return ['--use-gl=angle', '--use-angle=' + gl, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
}

/** Lanza Chrome headless con depuración remota. extra = banderas adicionales. */
function launch(prof, port, size, extra) {
  const args = ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + port, ...gpuFlags(),
    '--mute-audio', '--hide-scrollbars', '--window-size=' + size, ...(extra || []), 'about:blank'];
  return spawn(findChrome(), args, { stdio: 'ignore', detached: !WIN, windowsHide: true });
}

function kill(ch) {
  if (!ch || ch.__dead) return; ch.__dead = true;
  if (WIN) { try { spawnSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) { } return; }
  try { process.kill(-ch.pid, 'SIGKILL'); } catch (e) { try { ch.kill('SIGKILL'); } catch (_) { } }
}

/** URL file:// de index.html con la query dada (válida en Windows y POSIX). */
function pageUrl(root, query) { return url.pathToFileURL(path.join(root, 'index.html')).href + (query ? '?' + query : ''); }

module.exports = { findChrome, gpuFlags, launch, kill, pageUrl };
