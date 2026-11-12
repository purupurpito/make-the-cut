#!/usr/bin/env node
/* VOLEY 3D — tools/animtest.js (owner: players)
 * E2 (sprint 5): variedad de la animación medida en partidos autopilot reales (por DevTools, tools/cdp.js).
 * Juega partidos de N s (pabellón y playa, varias semillas) llamando a VB.Players.update con los eventos de la sim y muestrea
 * VB.Players._anim en cada frame. Comprueba (spec E2 §6.2):
 *   - contactos: >= 6 cvar distintos por partido; 'dig' en >= 80 % de los hit.dig; spikeLine y spikeCross; 'pokey' con cada hit.pokey
 *   - plancha: 'miss' con cada dive.miss; 'side' >= 1 en el total
 *   - aterrizaje: 'stumble' en >= 50 % de los saques en salto; playa: <= 1 llamada a FX.dust por caída
 *   - celebraciones: >= 14 variantes distintas en total; 0 repeticiones seguidas por jugador
 *   - espera: >= 3 'idle' distintos por jugador (en total); ningún idle en 'rally' ni en el sacador
 *   - dejar pasar: 'leave' solo con la decisión de la IA (g._lv / VB.AI.leaving) en los 0,35 s anteriores
 *   - firma y rival: con setSignature/setRival salen 'firma', 'pique' o 'rabia'
 *   - gimnasio (si la sim tiene drills): tras drillStage, sin dvar/lvar ni celebración
 * Uso: node tools/animtest.js [s=240] [semillas=7,99] [mapas=hall,beach] [diff=hard]
 * Sale con 1 si algo falla. Imprime "TODO OK".
 */
'use strict';
const CDP = require('./cdp.js');
const [SECS = '240', SEEDS = '7,99', MAPS = 'hall,beach', DIFF = 'hard'] = process.argv.slice(2);

function page(SECS, SEED, DIFF, VENUE, SIG, RIVAL) {
  var ctx = VB.ctx, S = VB.Sim, P = VB.Players, orig = P.__orig || P.update; P.__orig = orig;
  P.update = function () { if (window.__on) return orig.apply(P, arguments); };   // el bucle de main.js no pinta mientras medimos
  ctx.frozen = true;
  P.setVenue(VENUE === 'beach' ? 'beach' : 'hall');
  if (P.setSignature) P.setSignature(SIG || '');
  var g = S.createGame({ demo: false, autopilot: true, seed: SEED, difficulty: DIFF, venue: VENUE === 'beach' ? 'beach' : undefined }); ctx.game = g;
  if (P.setRival) P.setRival(RIVAL ? g.teams[1][0].num : -1);
  ['Arena', 'FX', 'Players'].forEach(function (m) { try { VB[m].onGameStart && VB[m].onGameStart(g); } catch (e) { } });
  var dustN = 0, dust0 = VB.FX && VB.FX.dust;
  if (dust0) VB.FX.dust = function () { dustN++; return dust0.apply(VB.FX, arguments); };
  var R = { cv: {}, cvN: 0, dig: [0, 0], pokey: [0, 0], line: 0, cross: 0, miss: [0, 0], side: 0, dv: {}, js: [0, 0], lvN: {}, dustBad: 0, lands: 0,
    cel: {}, celRep: 0, idle: {}, idleBad: [], leaveBad: 0, leaveN: 0, lvOnN: 0, fx: {}, firma: 0, pique: 0, rabia: 0, pts: 0, err: '' };
  var lastCel = [], lvT = [-9, -9], pending = [], ev = [], fxo = [];
  function A(p) { return P._anim(p); }
  try {
    for (var s = 0; s < 120 * SECS && !g.finished; s++) {
      S.step(g, 1 / 120, null); S.drainEvents(g, ev);
      if (s % 2) continue;
      // decisión de dejar pasar de la IA (para comparar con leave)
      for (var t = 0; t < 2; t++) {
        var on = false;
        if (VB.AI && VB.AI.leaving) on = !!VB.AI.leaving(g, t);
        else { var L = g._lv && g._lv[t]; on = !!(L && L.on && L.t === g.lastTouchT); }
        if (on) { lvT[t] = g.time; R.lvOnN++; }
      }
      var d0 = dustN, landsF = 0;
      for (var j = 0; j < ev.length; j++) if (ev[j].type === 'landPlayer') landsF++;
      window.__on = true;
      try { orig.call(P, g, 1 / 60, ev); } finally { window.__on = false; }
      if (VENUE === 'beach' && landsF) { R.lands += landsF; if (dustN - d0 > landsF) R.dustBad++; }
      fxo.length = 0; P.drainFx(fxo); for (var f = 0; f < fxo.length; f++) R.fx[fxo[f].type] = (R.fx[fxo[f].type] || 0) + 1;
      for (j = 0; j < ev.length; j++) {
        var e = ev[j], a = e.player ? A(e.player) : null;
        if (e.type === 'hit' && a) {
          if (a.cvar) { R.cv[a.cvar] = (R.cv[a.cvar] || 0) + 1; }
          if (e.dig) { R.dig[1]++; if (a.cvar === 'dig') R.dig[0]++; }
          if (e.pokey) { R.pokey[1]++; if (a.cvar === 'pokey') R.pokey[0]++; }
          if (a.cvar === 'spikeLine') R.line++; if (a.cvar === 'spikeCross') R.cross++;
          if (e.kind === 'serve' && e.shot === 'jump') pending.push({ p: e.player, t: g.time, k: 'js' });
        }
        if (e.type === 'dive' && a) { R.dv[a.dvar] = (R.dv[a.dvar] || 0) + 1; if (e.miss) { R.miss[1]++; if (a.dvar === 'miss') R.miss[0]++; } if (a.dvar === 'side') R.side++; }
        if (e.type === 'landPlayer' && a) {
          R.lvN[a.lvar] = (R.lvN[a.lvar] || 0) + 1;
          for (var q = pending.length - 1; q >= 0; q--) if (pending[q].p === e.player && pending[q].k === 'js') { R.js[1]++; if (a.lvar === 'stumble') R.js[0]++; pending.splice(q, 1); }
        }
        if (e.type === 'point' && !e.matchWon) {
          R.pts++;
          for (var k = 0; k < g.players.length; k++) {
            var ak = A(g.players[k]), id = ak.celV || ak.celId;
            if (!id) continue;
            R.cel[id] = (R.cel[id] || 0) + 1;
            if (lastCel[k] === id) R.celRep++;
            lastCel[k] = id;
            if (id === 'firma') R.firma++; if (id === 'pique') R.pique++; if (id === 'rabia') R.rabia++;
          }
        }
      }
      ev.length = 0;
      for (var pi = 0; pi < g.players.length; pi++) {
        var pl = g.players[pi], an = A(pl);
        if (an.idle) {
          var ki = pl.team + ':' + pl.idx; (R.idle[ki] = R.idle[ki] || {})[an.idle] = 1;
          if (g.mode === 'rally' || (g.mode === 'serve' && g.server === pl)) if (R.idleBad.length < 5) R.idleBad.push([g.mode, an.idle, pl.id]);
        }
        if (an.leave) { R.leaveN++; if (g.time - lvT[pl.team] > 0.35) R.leaveBad++; }
      }
    }
  } catch (e) { R.err = String(e && e.stack || e).slice(0, 400); }
  if (dust0) VB.FX.dust = dust0;
  R.time = +g.time.toFixed(1);
  return JSON.stringify(R);
}

function gymPage(SEED) {
  var ctx = VB.ctx, S = VB.Sim, P = VB.Players, orig = P.__orig || P.update; P.__orig = orig;
  P.update = function () { if (window.__on) return orig.apply(P, arguments); };
  if (!S.drillStage || !VB.DRILL) return JSON.stringify({ skip: 'sin drills en la sim' });
  ctx.frozen = true; P.setVenue('');
  var out = { kinds: {}, bad: [], stages: 0 };
  ['atk', 'block', 'recv'].forEach(function (kind) {
    var g; try { g = S.createGame({ demo: false, autopilot: true, seed: SEED, difficulty: 'normal', drill: kind }); } catch (e) { out.bad.push(kind + ': ' + e); return; }
    if (!g.drill) { out.bad.push(kind + ': sin g.drill'); return; }
    ctx.game = g; ['Arena', 'FX', 'Players'].forEach(function (m) { try { VB[m].onGameStart && VB[m].onGameStart(g); } catch (e) { } });
    var ev = [], n = 0, cel = 0;
    for (var s = 0; s < 120 * 90 && !g.drill.done; s++) {
      S.step(g, 1 / 120, null); S.drainEvents(g, ev); if (s % 2) continue;
      var st = ev.some(function (e) { return e.type === 'drillStage'; });
      window.__on = true; try { orig.call(P, g, 1 / 60, ev); } finally { window.__on = false; }
      ev.length = 0;
      for (var i = 0; i < g.players.length; i++) {
        var a = P._anim(g.players[i]);
        if (st && (a.dvar || a.lvar || a.celV || a.idle)) out.bad.push(kind + ' tras drillStage: ' + JSON.stringify(a));
        if (a.idle) out.bad.push(kind + ': idle en el gimnasio');
      }
      if (st) { n++; out.stages++; }
    }
    out.kinds[kind] = n;
  });
  out.bad = out.bad.slice(0, 6);
  return JSON.stringify(out);
}

(async () => {
  const pg = await CDP.open({ size: '640x360' });
  let bad = 0;
  const fail = (m) => { bad++; console.log('  FALLO ' + m); };
  const tot = { cel: {}, idle: {}, side: 0, celRep: 0 };
  const runs = [];
  for (const map of MAPS.split(',')) for (const sd of SEEDS.split(',')) runs.push({ map, sd: +sd });
  let i = 0;
  for (const r of runs) {
    await pg.navigate('debug=rally&quality=low' + (r.map === 'beach' ? '&map=beach' : ''));
    await CDP.sleep(2500);
    // 1r partido de cada mapa con firma; el 2º con rival personal
    const sig = i % 2 === 0 ? 'saludo' : '', riv = i % 2 === 1;
    const res = await pg.evalJs('(' + page.toString() + `)(${+SECS}, ${r.sd}, '${DIFF}', '${r.map}', '${sig}', ${riv})`);
    i++;
    let o; try { o = JSON.parse(res); } catch (e) { fail('respuesta: ' + String(res).slice(0, 200)); continue; }
    const cvN = Object.keys(o.cv).length;
    console.log(`[${r.map} semilla ${r.sd}] ${o.time} s, ${o.pts} puntos${sig ? ', firma «' + sig + '»' : ''}${riv ? ', rival personal' : ''}`);
    console.log('  cvar ' + JSON.stringify(o.cv));
    console.log('  dive ' + JSON.stringify(o.dv) + '  land ' + JSON.stringify(o.lvN) + '  fx ' + JSON.stringify(o.fx));
    console.log('  cel  ' + JSON.stringify(o.cel));
    if (o.err) fail('excepción: ' + o.err);
    if (cvN < 6) fail(`solo ${cvN} cvar distintos (>= 6)`);
    if (o.dig[1] && o.dig[0] / o.dig[1] < 0.8) fail(`dig ${o.dig[0]}/${o.dig[1]} (< 80 %)`); else console.log(`  ok dig ${o.dig[0]}/${o.dig[1]}`);
    if (!(o.line > 0 && o.cross > 0)) fail(`remates paralela ${o.line} / diagonal ${o.cross} (deben salir los dos)`); else console.log(`  ok paralela ${o.line} · diagonal ${o.cross}`);
    if (o.pokey[0] !== o.pokey[1]) fail(`pokey ${o.pokey[0]}/${o.pokey[1]}`); else if (o.pokey[1]) console.log(`  ok pokey ${o.pokey[0]}/${o.pokey[1]}`);
    if (o.miss[0] !== o.miss[1]) fail(`plancha fallida ${o.miss[0]}/${o.miss[1]}`); else console.log(`  ok plancha fallida ${o.miss[0]}/${o.miss[1]}`);
    if (o.js[1] && o.js[0] / o.js[1] < 0.5) fail(`stumble en saque en salto ${o.js[0]}/${o.js[1]} (< 50 %)`); else console.log(`  ok stumble en saque en salto ${o.js[0]}/${o.js[1]}`);
    if (r.map === 'beach') { if (o.dustBad) fail(`polvo: ${o.dustBad} caídas con más de una llamada a FX.dust (de ${o.lands})`); else console.log(`  ok polvo <= 1 por caída (${o.lands} caídas)`); }
    if (o.idleBad.length) fail('idle fuera de la espera: ' + JSON.stringify(o.idleBad));
    if (o.leaveBad) fail(`leave sin decisión de la IA: ${o.leaveBad} frames (de ${o.leaveN})`); else console.log(`  ok leave ${o.leaveN} frames, siempre con la IA dejándola (IA ${o.lvOnN})`);
    if (sig && !o.firma) fail('la firma no salió'); else if (sig) console.log(`  ok firma ${o.firma}`);
    if (riv && !(o.pique + o.rabia)) fail('el rival personal no hizo pique ni rabia'); else if (riv) console.log(`  ok rival: pique ${o.pique} · rabia ${o.rabia}`);
    for (const k in o.cel) tot.cel[k] = (tot.cel[k] || 0) + o.cel[k];
    for (const k in o.idle) { tot.idle[k] = tot.idle[k] || {}; Object.assign(tot.idle[k], o.idle[k]); }
    tot.side += o.side; tot.celRep += o.celRep;
  }
  const celN = Object.keys(tot.cel).length;
  console.log('[total] celebraciones ' + celN + ' distintas: ' + JSON.stringify(tot.cel));
  if (celN < 14) fail(`solo ${celN} celebraciones distintas (>= 14)`);
  if (tot.celRep) fail(`${tot.celRep} celebraciones repetidas seguidas`); else console.log('  ok 0 repetidas seguidas');
  if (!tot.side) fail('ninguna plancha lateral'); else console.log(`  ok planchas laterales ${tot.side}`);
  const idleS = Object.keys(tot.idle).map(k => k + ':' + Object.keys(tot.idle[k]).length);
  console.log('  idle por jugador ' + JSON.stringify(tot.idle));
  for (const k in tot.idle) if (Object.keys(tot.idle[k]).length < 3) fail(`jugador ${k}: ${Object.keys(tot.idle[k]).length} idle distintos (>= 3)`);
  if (Object.keys(tot.idle).length < 4) fail('menos de 4 jugadores con gestos de espera: ' + idleS.join(' '));
  // gimnasio
  await pg.navigate('debug=rally&quality=low'); await CDP.sleep(2000);
  const gy = JSON.parse(await pg.evalJs('(' + gymPage.toString() + ')(7)'));
  if (gy.skip) console.log('[gimnasio] SALTADO: ' + gy.skip);
  else { console.log('[gimnasio] drillStage por ejercicio ' + JSON.stringify(gy.kinds)); if (gy.bad.length) fail('gimnasio: ' + gy.bad.join(' | ')); else if (!gy.stages) fail('gimnasio: ningún drillStage'); else console.log('  ok tras drillStage sin dvar/lvar/celebración/idle'); }
  if (pg.errors.length) fail('errores JS: ' + pg.errors.slice(0, 3).join(' | '));
  pg.close();
  console.log(bad ? `== ${bad} FALLOS ==` : 'TODO OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
