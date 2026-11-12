/* MAKE THE CUT — js/career-ui.js (owner: ui_main)
 * Pantallas del modo Carrera de VÓLEY PLAYA (VB.CareerUI): crear carrera, hub (Partido · Mensajes · Jugador · Club · Liga ·
 * Palmarés), fin de temporada y ofertas. Sprint playa (10-nov-2026): textos de playa (circuitos, arena, sets a 21), sin selector
 * de puntos, ficha del compañero con media respecto al club, puntos fuertes y flojos y forma (mateLine). Crea su propio DOM (#career) y su propio <style> desde aquí para no chocar con index.html, con las
 * variables del estilo cartoon del menú (--tk, --tp, --tp2, --cel-a, --t0, --gold, --display, --ui, --ring1, --ring2).
 * Datos y reglas: js/career.js (VB.Career). Los partidos los arranca main.js (ctx.actions.startCareerMatch).
 *
 * Entrada: botón #btnCareer del menú (index.html). Ratón, táctil (botones ≥ 44 px) y teclado/mando: ↑/↓ (y ←/→) mueven el foco,
 * Intro acepta, Esc vuelve; con mando main.js llama a VB.CareerUI.nav(it, dt) mientras está abierta (en lugar de VB.UI.nav).
 * Mientras está abierta, las teclas no llegan a ui.js ni a input.js (escucha en captura sobre window): así escribir el nombre no
 * silencia el juego con la M ni el menú se mueve por detrás.
 */
(function () {
  'use strict';
  /** Ordinal corto: 1r, 2º, 3r, 4º… Nunca «1.er». */
  function ordn(n) { return n + (n === 1 || n === 3 ? 'r' : 'º'); }
  var VB = window.VB = window.VB || {};
  var root = null, body = null, head = null, tabsEl = null, subEl = null, styleEl = null;
  var view = 'hub', tab = 'match', open = false, lastFocus = null, tblLvl = -1, armT = 0, armTo = 0, confirmStep = 0, freshLast = false;
  // (sin «Controlar»: en la Carrera solo se controla a tu jugador)
  var form = { name: '', num: 1, role: 'atk' }, badgeMsg = '', note = '', yrs = {};   // (sin puntos por set: vóley playa, siempre a 21)
  // Pestañas (móvil primero): 6 apartados y, dentro, sub-pestañas. Las dos barras son el componente común de ui.js
  // (VB.UI.tabs, como Jugadores y Ajustes; drawBar): Q/E y LB/RB cambian de apartado, RePág/AvPág y LT/RT de sub-pestaña, ←/→
  // con el foco en una pestaña, tocar y deslizar el dedo sobre el contenido. Sin ui.js (pruebas): botones sueltos (tabsBar).
  // «Fama» (career-life-ui.js): seguidores, patrocinio, rival, tienda, logros y legado
  var TABS = [['match', 'Partido'], ['inbox', 'Mensajes'], ['player', 'Jugador'], ['club', 'Club'], ['life', 'Fama'], ['league', 'Liga'], ['honors', 'Palmarés']];
  var SUBS = {   // (Jugador: el mismo orden que Jugadores del menú, Físico · Defensa · Ataque, que sale de VB.Prog.GROUPS)
    player: [['phys', 'Físico'], ['def', 'Defensa'], ['atk', 'Ataque'], ['badges', 'Insignias'], ['train', 'Entreno']],
    club: [['info', 'Ficha'], ['mate', 'Compañero'], ['contract', 'Contrato'], ['offers', 'Ofertas']],
    league: [['table', 'Clasificación'], ['cal', 'Calendario']],
    honors: [['titles', 'Palmarés'], ['seasons', 'Temporadas'], ['opts', 'Opciones']],
    life: [['fame', 'Fama'], ['shop', 'Tienda'], ['goals', 'Logros'], ['legacy', 'Legado']]
  };
  var sub = { player: 'phys', club: 'info', league: 'table', honors: 'titles', life: 'fame', pick: 0 };
  function LUI() { return VB.CareerLife && VB.CareerLifeUI || null; }
  var HLP = { esc: function (s) { return esc(s); }, sp: function (a, k) { return sp(a, k); } };
  var tabsApi = null, subApi = null, rejArm = 0, stayArm = 0, offArm = -1;   // offArm: oferta de mitad de temporada pendiente de confirmar
  var GROUP_OF = { atk: 'Ataque', def: 'Defensa', phys: 'Físico' };
  var TIER_C = ['#6b6390', '#d58a4a', '#c9d3de', '#ffd23f'];
  var TIER_N = ['Bloqueada', 'Bronce', 'Plata', 'Oro'];

  function C() { return VB.Career; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  /** Separadores con diseño (ui.js VB.UI.sep; trozos YA escapados): 'd' rombo, 'v' raya fina, 's' barra, 'c' pastillas. */
  function sp(parts, kind) {
    parts = parts.filter(function (p) { return p !== '' && p != null; });
    return VB.UI && VB.UI.sep ? VB.UI.sep(parts, kind, true) : parts.join(' · ');
  }
  var SV = '<span class="sep sep-v"><span class="sr">, </span></span>'; // raya fina suelta (entre trozos que ya son HTML)
  function hex(n) { return '#' + ('000000' + ((n >>> 0) & 0xffffff).toString(16)).slice(-6); }
  function dec(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }
  function snd(k) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui(k || 'click'); } catch (e) { } }
  function diffName(k) { return (VB.DIFF && VB.DIFF[k] && VB.DIFF[k].name) || k; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function kitSw(k, big) {
    var s = hex(k.shirt), a = hex(k.accent), sh = hex(k.shorts), bg;
    if (k.pattern === 'franjas') bg = 'linear-gradient(180deg,' + s + ' 0 48%,' + a + ' 48% 62%,' + s + ' 62% 68%,' + a + ' 68% 73%,' + sh + ' 73%)';
    else if (k.pattern === 'rayas') bg = 'repeating-linear-gradient(90deg,' + s + ' 0 6px,' + a + ' 6px 8px),' + s;
    else if (k.pattern === 'liso') bg = 'linear-gradient(180deg,' + s + ' 0 72%,' + sh + ' 72%)';
    else bg = 'linear-gradient(160deg,' + s + ' 0 40%,' + a + ' 40% 52%,' + s + ' 52% 72%,' + sh + ' 72%)';
    return '<i class="cr-kit' + (big ? ' big' : '') + '" style="background:' + bg + '" aria-hidden="true"></i>';
  }
  function notaCls(n) { return n >= 8 ? 'n-top' : n >= 7 ? 'n-good' : n >= 6 ? 'n-ok' : n >= 5 ? 'n-meh' : 'n-bad'; }
  /** «del Circuito Regional» / «de la Superliga de Playa». */
  function deL(L) { return (L.art === 'el' ? 'del ' : 'de la ') + L.name; }
  function lab(k) { var LB = VB.Prog && VB.Prog.LABEL; return (LB && LB[k] || k).toLowerCase(); }
  /** «+4 sobre el club» / «−3 bajo el club» / «al nivel del club» (desvío de la media del compañero respecto a la del club). */
  function vsClub(d) { return d >= 2 ? '+' + d + ' sobre el club' : d <= -2 ? '−' + (-d) + ' bajo el club' : 'al nivel del club'; }
  /** Desvío con signo: «+4», «−3», «±0». */
  function sgn(d) { return d > 0 ? '+' + d : d < 0 ? '−' + (-d) : '±0'; }
  /** Objetivo en corto para la tabla de Comparar (la frase entera va en la ficha de la oferta). */
  function objShort(t) {
    t = String(t || '');
    if (!t) return '—';
    if (/^Ganar/.test(t)) return 'Campeón';
    if (/^Subir/.test(t)) return 'Ascenso';
    var m = /entre los (\d+) primeros/.exec(t);
    if (m) return 'Top ' + m[1];
    if (/descenso/.test(t)) return 'Salvarse';
    return t.replace(/\s*\(.*\)$/, '');
  }
  /** Ficha corta de un compañero m del club de media clubOvr: línea de pastillas (rol, media y desvío, estilo[, forma]) y una frase
   *  con sus puntos fuertes y flojos (VB.Career.mateProfile). withForm: enseña la forma (solo compañeros de tu plantilla). */
  function mateLine(m, clubOvr, withForm) {
    var pr = C().mateProfile(m), d = pr.ovr - clubOvr, tag = d >= 3 ? 'g' : d <= -3 ? 'r' : '';
    // (el desvío va en su propia pastilla, verde o roja si se nota: antes era una pastilla dentro de la de la media y se salía
    // de la columna de la oferta)
    var chips = [esc(m.role), 'Media ' + pr.ovr, { h: esc(vsClub(d)), c: tag ? 'dv ' + tag : 'dv' }, esc(m.style || '')];
    if (withForm) chips.push('Forma: ' + esc(C().formText(m.form | 0)));
    var h = '<p class="muted" style="margin:2px 0 0">' + sp(chips, 'c') + '</p>';
    var s = pr.strong.length ? 'Fuerte en ' + pr.strong.map(lab).join(', ').replace(/, ([^,]*)$/, ' y $1') : '', w = pr.weak.length ? 'flojo en ' + pr.weak.map(lab).join(', ').replace(/, ([^,]*)$/, ' y $1') : '';
    if (s || w) h += '<p class="muted" style="margin:2px 0 0">' + esc(s ? s + (w ? '; ' + w : '') : w.charAt(0).toUpperCase() + w.slice(1)) + '.</p>';
    return h;
  }

  // =================================================================== estilos
  var CSS = [
    '#career{position:absolute;inset:0;z-index:16;display:flex;justify-content:center;box-sizing:border-box;',
    ' padding:calc(10px + var(--st,0px)) calc(14px + var(--sr,0px)) calc(10px + var(--sbm,0px)) calc(14px + var(--sl,0px));',
    ' background:linear-gradient(90deg,rgba(29,21,48,.95),rgba(29,21,48,.86) 60%,rgba(29,21,48,.7));color:var(--fg,#f7f2ea);font-family:var(--ui);',
    ' opacity:0;transition:opacity .25s ease}',
    '#career.in{opacity:1}',
    '#career[hidden]{display:none}',
    '#career *{box-sizing:border-box}',
    '#career .cr-in{width:min(1000px,100%);height:100%;display:flex;flex-direction:column;gap:8px;min-height:0}',
    // pantallas grandes (index.html le pone zoom:var(--vs) y height:calc(100% / var(--vs))): en el Chrome actual (zoom estándar) el
    // % ya se resuelve sin zoom y la Carrera se quedaba en la mitad de arriba a 2560×1440 (medido: 825 de 1420 px). Alto completo:
    '#app #career .cr-in{height:100%}',
    // a 2560×1440 la cabecera quedaba pegada al borde de arriba: algo de aire en pantallas grandes
    '@media (min-width:1800px) and (min-height:1000px){#career{padding-top:calc(26px + var(--st,0px))}}',
    '#career button{font:800 17px/1.1 var(--display);letter-spacing:.05em;text-transform:uppercase;color:#fff;border:0;border-radius:12px;min-height:44px;padding:0 16px;cursor:pointer;',
    ' background:var(--cel-a);box-shadow:inset 0 0 0 2.5px var(--tk),3px 4px 0 var(--tk);text-shadow:var(--ring1),1.5px 2px 0 var(--tk);transition:transform .12s,box-shadow .12s,background .15s}',
    '#career button:hover{transform:translateY(-1px)}',
    '#career button:active{transform:translateY(2px);box-shadow:inset 0 0 0 2.5px var(--tk),1px 1px 0 var(--tk)}',
    '#career button:focus{outline:none}',
    '#career button:focus-visible,#career button.kf,#career input:focus-visible{outline:none;box-shadow:inset 0 0 0 2.5px var(--tk),inset 0 0 0 5px #ffb238,3px 4px 0 var(--tk)}',
    '#career button.pri{background:linear-gradient(180deg,#ff8040 0 50%,#f65d1d 50% 100%);box-shadow:inset 0 0 0 2.5px var(--tk),inset 0 4px 0 rgba(255,255,255,.25),4px 5px 0 var(--tk)}',
    '#career button.pri:focus-visible,#career button.pri.kf{box-shadow:inset 0 0 0 2.5px var(--tk),inset 0 0 0 5px #fff,4px 5px 0 var(--tk)}',
    '#career button.warn{background:linear-gradient(180deg,#d8364a 0 50%,#b51f33 50% 100%)}',
    '#career button[disabled]{opacity:.45;cursor:default;transform:none}',
    '#career button[aria-pressed="true"]{background:linear-gradient(180deg,#ffd23f 0 50%,#f2b51c 50% 100%);color:var(--tk);text-shadow:none}',
    '#career .cr-head{display:flex;align-items:center;gap:12px;flex:none}',
    '#career .cr-title{flex:1;min-width:0}',
    '#career .cr-title small{display:block;font:800 12px var(--display);letter-spacing:.3em;text-transform:uppercase;color:#ffd23f;text-shadow:var(--ring1)}',
    '#career .cr-title b{display:block;font:900 26px/1.05 var(--display);letter-spacing:.04em;text-transform:uppercase;text-shadow:var(--ring2),2px 3px 0 var(--tk);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#career .cr-ovr{text-align:center;font:900 30px/1 var(--display);color:var(--gold);text-shadow:var(--ring2),2px 3px 0 var(--tk)}',
    '#career .cr-ovr small{display:block;font:800 10px var(--display);letter-spacing:.24em;color:#d6d0f5;text-shadow:var(--ring1)}',
    '#career .cr-tabs{display:flex;gap:6px;overflow-x:auto;flex:none;padding:2px 4px 6px 2px;scrollbar-width:none}',
    '#career .cr-tabs[hidden]{display:none}',
    '#career .cr-tabs::-webkit-scrollbar{display:none}',
    // (sin ui.js —pruebas—: botones sueltos; con ui.js las barras son el componente común VB.UI.tabs, estilos más abajo)
    '#career .cr-tabs:not(.tabs) button{flex:none;font-size:16px;padding:0 14px}',
    '#career .cr-tabs:not(.tabs) button[aria-selected="true"]{background:linear-gradient(180deg,#ff8040 0 50%,#f65d1d 50% 100%)}',
    '#career .cr-tabs .dot,#career .cr-sub .dot{display:inline-block;width:9px;height:9px;margin-left:2px;border-radius:50%;background:#ff8040;box-shadow:0 0 0 1.5px var(--tk);vertical-align:2px}',
    // pestañas con el componente común (index.html «MENÚS v2»: .tabs/.tb-row/.tab/.tb-k); #career button pesa más (id): se rehace aquí
    '#career .tabs{margin:0;padding:0;overflow:visible}',
    '#career .tabs .tab{flex:1 0 auto;min-height:40px;padding:6px 12px;border-radius:11px;font:800 15px/1 var(--display);letter-spacing:.08em;color:#cfc8f2;background:transparent;box-shadow:none;text-shadow:none;transform:none;gap:6px}',
    '#career .tabs .tab:hover:not(.on){background:rgba(255,255,255,.09);color:#fff}',
    '#career .tabs .tab.on{color:var(--tk);background:linear-gradient(180deg,#ffd23f 0 50%,#ffc21a 50% 100%);box-shadow:inset 0 0 0 2px var(--tk),2px 3px 0 var(--tk)}',
    '#career .tabs .tab.kf,#career .tabs .tab:focus-visible{outline:3px solid #fff;outline-offset:1px}',
    '#career .tabs .tb-k{min-height:0;height:30px;min-width:32px;padding:0 7px;border-radius:9px;font:800 13px/1 var(--display);letter-spacing:.04em;color:var(--tk);background:#fff7e8;box-shadow:inset 0 0 0 1.5px var(--tk),0 3px 0 var(--tk);text-shadow:none}',
    '#career .tabs .tb-k:empty,#career .tabs.tb-touch .tb-k{display:none}',
    // segundo nivel (sub-pestañas): la misma barra, más baja y sin pistas de tecla (Q/E cambian el primer nivel; RePág/AvPág y LT/RT el segundo)
    '#career .cr-sub.tabs .tb-row{background:rgba(29,21,48,.35);box-shadow:inset 0 0 0 1.5px rgba(29,21,48,.9)}',
    '#career .cr-sub.tabs .tab{min-height:36px;font-size:13.5px;padding:5px 10px}',
    '#career .cr-sub.tabs .tb-k{display:none}',
    '.is-touch #career .tabs .tab,.is-touch #career .cr-sub.tabs .tab{min-height:44px}',
    '#career .cr-body{flex:1;min-height:0;overflow:auto;padding:4px 6px 14px 2px;overscroll-behavior:contain}',
    '#app.cr-on #menu,#app.cr-on .hud-btns{visibility:hidden}',
    '#career .bd-msg{min-height:1.4em;margin:6px 0 0;font:700 13.5px var(--ui);color:#ffd23f}',
    '#career .card{background:linear-gradient(180deg,rgba(58,49,104,.97),rgba(46,39,86,.97) 90px);border-radius:14px;box-shadow:0 0 0 2.5px var(--tk),4px 5px 0 var(--tk);padding:12px 14px;margin:0 0 12px}',
    '#career h3{margin:0 0 8px;font:800 13px var(--display);letter-spacing:.3em;text-transform:uppercase;color:var(--amber,#ffb238);text-shadow:var(--ring1)}',
    '#career p{margin:4px 0;line-height:1.4;color:#e8e3fb}',
    '#career .muted{color:#b9b0e6;font-size:13.5px}',
    '#career .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '#career .grow{flex:1}',
    '#career .vs{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:center}',
    '#career .team{display:flex;align-items:center;gap:10px;min-width:0}',
    '#career .team.r{flex-direction:row-reverse;text-align:right}',
    '#career .team b{display:block;font:900 22px/1.05 var(--display);text-transform:uppercase;letter-spacing:.03em;text-shadow:var(--ring1),2px 2px 0 var(--tk);overflow:hidden;text-overflow:ellipsis}',
    '#career .team small{display:block;font:600 13px var(--ui);color:#cfc8f2}',
    '#career .vs-mid{font:900 26px var(--display);color:#ffd23f;text-shadow:var(--ring2)}',
    '#career .cr-kit{flex:none;display:inline-block;width:34px;height:40px;border-radius:9px 9px 6px 6px;box-shadow:0 0 0 2px var(--tk),2px 3px 0 var(--tk)}',
    '#career .cr-kit.big{width:48px;height:56px}',
    '#career .kit-mini{width:16px;height:18px;border-radius:5px 5px 3px 3px;box-shadow:0 0 0 1.5px var(--tk);vertical-align:-3px;margin-right:6px}',
    '#career .acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}',
    '#career .acts button{flex:1 1 180px}',
    '#career .nota{flex:none;display:grid;place-items:center;width:64px;height:64px;border-radius:50%;font:900 28px var(--display);color:#fff;text-shadow:var(--ring2);box-shadow:0 0 0 2.5px var(--tk),3px 4px 0 var(--tk)}',
    '#career .nota span{display:block;text-align:center;line-height:.9}',
    '#career .nota small{display:block;font:800 9px var(--display);letter-spacing:.2em;margin-top:3px}',
    '#career .n-top{background:#2fbf71}#career .n-good{background:#6cc24a}#career .n-ok{background:#d9a520}#career .n-meh{background:#e07b2b}#career .n-bad{background:#d8364a}',
    '#career .tag{display:inline-block;padding:3px 9px;border-radius:999px;font:800 12px var(--display);letter-spacing:.12em;text-transform:uppercase;background:var(--tp2);box-shadow:0 0 0 1.5px var(--tk);margin:2px 4px 2px 0}',
    '#career .tag.g{background:#2f8f5a}#career .tag.r{background:#a8283a}#career .tag.y{background:#b8860b}',
    '#career .chip.dv.g{background:#2f8f5a;color:#fff}#career .chip.dv.r{background:#a8283a;color:#fff}',
    '#career table{width:100%;border-collapse:collapse;font:600 14px var(--ui)}',
    '#career th{font:800 11px var(--display);letter-spacing:.18em;text-transform:uppercase;color:#b9b0e6;text-align:right;padding:4px 6px}',
    '#career td{padding:7px 6px;text-align:right;border-top:1px solid rgba(255,255,255,.08);font-variant-numeric:tabular-nums}',
    '#career th.l,#career td.l{text-align:left}',
    '#career td.club{text-align:left;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0;width:50%}',
    '#career tr.me td{background:rgba(255,128,64,.22)}',
    '#career tr.up td:first-child{box-shadow:inset 4px 0 0 #4be0a0}',
    '#career tr.cup td:first-child{box-shadow:inset 4px 0 0 #ffd23f}',
    '#career tr.down td:first-child{box-shadow:inset 4px 0 0 #ff5a6e}',
    '#career td.pts{font:900 17px var(--display);color:#ffd23f}',
    '#career .lg-sw{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}',
    '#career .lg-sw button{font-size:14px;min-height:44px;padding:0 10px}',
    '#career .cal{display:grid;gap:6px}',
    '#career .cal-r{display:grid;grid-template-columns:3.2em minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 8px;border-radius:10px;background:rgba(0,0,0,.18)}',
    '#career .cal-r.next{background:rgba(255,128,64,.25);box-shadow:inset 0 0 0 2px #ff8040}',
    '#career .cal-r b{font:900 15px var(--display);letter-spacing:.06em;color:#b9b0e6}',
    '#career .cal-r .res{font:800 15px var(--display);letter-spacing:.06em}',
    '#career span.w{color:#4be0a0}#career span.l{color:#ff7a8a}',   // (span: th.l / td.l son «alineado a la izquierda», no derrota)
    '#career .grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}',
    '#career .attr{display:grid;grid-template-columns:minmax(0,7.4em) minmax(0,1fr) 2.2em 60px;gap:8px;align-items:center;min-height:44px}',
    '#career .attr .bar{height:10px;border-radius:6px;background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);overflow:hidden}',
    '#career .attr .bar i{display:block;height:100%;background:var(--t0)}',
    '#career .attr b{font:900 18px var(--display);text-align:right}',
    '#career .attr button{min-height:44px;padding:0 6px;font:800 18px/1 var(--ui);letter-spacing:0;text-shadow:none;text-transform:uppercase}',
    '#career .xp{height:10px;border-radius:6px;background:rgba(0,0,0,.4);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);margin:6px 0}',
    '#career .xp i{display:block;height:100%;background:linear-gradient(90deg,#ffd23f,#ff8040)}',
    '#career .bdg{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}',
    '#career .bd{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px;align-items:center;text-align:left;text-transform:none;letter-spacing:0;font:600 13px/1.25 var(--ui);padding:8px 10px;min-height:64px}',
    '#career .bd .ic{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:rgba(0,0,0,.35);box-shadow:0 0 0 2px var(--tk)}',
    '#career .bd .ic svg{width:28px;height:28px}',
    '#career .bd strong{display:block;font:800 16px var(--display);letter-spacing:.04em;text-transform:uppercase}',
    '#career .bd .pg{display:block;height:6px;border-radius:4px;background:rgba(0,0,0,.4);overflow:hidden;margin-top:4px}',
    '#career .bd .pg i{display:block;height:100%;background:#ffd23f}',
    '#career .bd.lock{opacity:.6}',
    '#career .bd[aria-pressed="true"]{background:linear-gradient(180deg,rgba(255,210,63,.32),rgba(255,160,40,.22));color:#fff;text-shadow:var(--ring1)}',
    '#career .bd[aria-pressed="true"] strong::after{content:"equipada";margin-left:6px;padding:1px 6px;border-radius:999px;font:800 10.5px var(--ui);background:#ffd23f;color:var(--tk);box-shadow:0 0 0 1.5px var(--tk);vertical-align:.1em}',
    '#career .new{animation:crPop .5s cubic-bezier(.2,1.4,.4,1) both}',
    '@keyframes crPop{from{transform:scale(.85);opacity:0}to{transform:none;opacity:1}}',
    '#career .offer{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.1)}',
    '#career .offer:first-of-type{border-top:0}',
    '#career .meter{height:12px;border-radius:7px;background:rgba(0,0,0,.4);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}',
    '#career .meter i{display:block;height:100%}',
    // crear
    '#career .cf{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:12px 18px;align-items:start}',
    '#career .cf>.card{grid-column:1/-1;margin:0}',
    '#career .cf-col{display:grid;gap:12px;min-width:0}',
    '#career .cf label{display:block;font:800 13px var(--display);letter-spacing:.24em;text-transform:uppercase;color:#ffd23f;text-shadow:var(--ring1);margin-bottom:6px}',
    '#career .cf input{width:100%;min-height:48px;border-radius:12px;border:0;padding:0 14px;font:700 20px var(--ui);color:#fff;background:rgba(0,0,0,.35);box-shadow:inset 0 0 0 2.5px var(--tk),inset 0 0 0 4px rgba(255,255,255,.08)}',
    '#career .seg{display:flex;gap:8px;flex-wrap:wrap}',
    '#career .seg button{flex:1 1 0;min-width:64px}',
    '#career .roles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
    '#career .roles button{display:block;text-align:left;padding:10px 12px;min-height:84px}',
    '#career .roles button small{display:block;margin-top:4px;font:600 12.5px var(--ui);letter-spacing:0;text-transform:none;color:inherit;opacity:.9}',
    '#career .stp{display:flex;align-items:center;gap:10px}',
    '#career .stp b{min-width:2.4em;text-align:center;font:900 32px var(--display);color:#ffd23f;text-shadow:var(--ring2)}',
    '#career .stp button{width:52px;padding:0;font-size:26px}',
    // (auto-fill con 128 px por casilla: con 5 columnas fijas, en columnas estrechas quedaba «Colocación25» pegado)
    '#career .prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:4px 14px;font:600 12.5px var(--ui);color:#cfc8f2}',
    '#career .prev span{display:flex;justify-content:space-between;gap:10px;min-width:0}',
    '#career .prev b{flex:none}',
    '#career .prev b{color:#fff}',
    '#career .bench{margin-top:8px;padding:8px 10px;border-radius:12px;background:rgba(224,123,43,.18);box-shadow:inset 0 0 0 2px #e07b2b}',
    '#career .bench p{margin:0}',
    '#career .fact b .mline{display:block;margin-top:3px}',
    '#career .confirm{margin-top:10px;padding:10px;border-radius:12px;background:rgba(168,40,58,.25);box-shadow:inset 0 0 0 2px #d8364a}',
    // gestión (v2): sub-pestañas, fichas de oferta, bandeja, entrenamiento
    '#career .cr-sub{display:flex;gap:6px;overflow-x:auto;flex:none;padding:0 4px 4px 2px;scrollbar-width:none}',
    '#career .cr-sub::-webkit-scrollbar{display:none}',
    '#career .cr-sub[hidden]{display:none}',
    '#career .cr-sub:not(.tabs) button{flex:none;font-size:14px;min-height:44px;padding:0 12px;border-radius:999px;background:rgba(58,49,104,.97);text-shadow:var(--ring1)}',
    '#career .cr-sub:not(.tabs) button[aria-selected="true"]{background:linear-gradient(180deg,#ffd23f 0 50%,#f2b51c 50% 100%);color:var(--tk);text-shadow:none}',
    '#career .stars{color:#ffd23f;letter-spacing:.08em;text-shadow:var(--ring1);white-space:nowrap}',
    '#career .stars .off{color:rgba(255,255,255,.22)}',
    '#career .fact{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0}',
    '#career .fact div{padding:7px 10px;border-radius:10px;background:rgba(0,0,0,.2);min-width:0}',
    '#career .fact small{display:block;font:800 10.5px var(--display);letter-spacing:.2em;text-transform:uppercase;color:#b9b0e6}',
    '#career .fact b{display:block;font:700 15px/1.25 var(--ui);color:#fff;overflow-wrap:anywhere}',
    '#career .bigname{font:900 24px/1.05 var(--display);text-transform:uppercase;letter-spacing:.03em;margin:0;text-shadow:var(--ring1),2px 2px 0 var(--tk)}',
    '#career .msg{padding:9px 10px;border-radius:10px;background:rgba(0,0,0,.18);margin:0 0 8px}',
    '#career .msg.unread{background:rgba(255,128,64,.18);box-shadow:inset 3px 0 0 #ff8040}',
    '#career .msg b{display:block;font:800 15.5px var(--display);letter-spacing:.03em;text-transform:uppercase}',
    '#career .msg p{margin:3px 0 0}',
    '#career .msg small{font:700 11.5px var(--ui);color:#b9b0e6}',
    '#career .tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}',
    '#career .tgrid button{display:block;text-align:left;padding:8px 12px;min-height:64px}',
    '#career .tgrid button small{display:block;margin-top:4px;font:600 12.5px var(--ui);letter-spacing:0;text-transform:none;opacity:.9}',
    '#career .pbar{display:grid;grid-template-columns:minmax(0,6.5em) minmax(0,1fr) 3.4em;gap:8px;align-items:center;margin:6px 0}',
    '#career .pbar .bar{height:10px;border-radius:6px;background:rgba(0,0,0,.4);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}',
    '#career .pbar .bar i{display:block;height:100%;background:#4be0a0}',
    '#career .pbar b{font:800 14px var(--display);text-align:right}',
    '#career .mate{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.1)}',
    '#career .mate:first-of-type{border-top:0}',
    '#career .pick-acts{display:flex;gap:10px;flex-wrap:wrap}',
    '#career .pick-acts button{flex:1 1 200px}',
    '#career .note{min-height:1.4em;margin:6px 0 0;font:700 13.5px var(--ui);color:#ffd23f}',
    '#career td button{min-height:40px;font-size:13px;padding:0 10px}',
    // pantallas bajas (teléfono apaisado)
    '@media (max-height:520px){',
    ' #career .cr-in{gap:5px}',
    ' #career .cr-title b{font-size:20px}',
    ' #career .cr-title small{font-size:10.5px;letter-spacing:.22em}',
    ' #career .cr-ovr{font-size:24px}',
    ' #career .cr-tabs{padding-bottom:4px}',
    ' #career .cr-tabs button{font-size:14.5px;padding:0 11px}',
    ' #career .card{padding:9px 11px;margin-bottom:9px}',
    ' #career .team b{font-size:18px}',
    ' #career .cr-kit.big{width:38px;height:44px}',
    ' #career .nota{width:54px;height:54px;font-size:24px}',
    ' #career .roles button{min-height:70px}',
    ' #career .cr-sub{padding-bottom:3px}',
    ' #career .cr-head button{min-height:44px}',
    ' #career .tabs .tb-row{padding:2px}',
    ' #career .bigname{font-size:20px}',
    ' #career .fact{gap:6px;margin:6px 0}',
    ' #career .fact div{padding:5px 8px}',
    '}',
    // teléfono apaisado (≤ 420 px de alto): «‹ Jugar» y la media a la izquierda de la barra de apartados, en la misma fila (sin el
    // título: el nombre y el club salen en las tarjetas). Antes: cabecera + 2 filas de pestañas dejaban ~210 px de contenido
    '@media (max-height:420px){',
    ' #career .cr-in{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr);gap:5px 8px}',
    ' #career .cr-head{grid-column:1;grid-row:1;gap:8px}',
    ' #career .cr-head .cr-title{display:none}',
    ' #career .cr-head .cr-ovr{font-size:20px}',
    ' #career .cr-head .cr-ovr small{font-size:8.5px;letter-spacing:.16em}',
    ' #career .cr-tabs{grid-column:2;grid-row:1;padding:0}',
    ' #career .cr-sub{grid-column:1/-1;grid-row:2;padding:0}',
    ' #career .cr-body{grid-column:1/-1;grid-row:3}',
    ' #career .cr-in:has(>.cr-tabs[hidden]) .cr-head{grid-column:1/-1}',
    ' #career .cr-in:has(>.cr-tabs[hidden]) .cr-head .cr-title{display:block}',
    ' #career .card.offer-full{display:flex;flex-direction:column}',
    ' #career .card.offer-full>.row{order:-2}',
    ' #career .card.offer-full>.acts{order:-1;margin:8px 0 4px}',
    '}',
    '.is-touch #career td button{min-height:44px}',
    '@media (max-width:700px){',
    ' #career .grid2,#career .cf{grid-template-columns:minmax(0,1fr)}',
    ' #career .roles{grid-template-columns:minmax(0,1fr)}',
    ' #career .roles button{min-height:56px}',
    ' #career .prev{grid-template-columns:repeat(2,minmax(0,1fr))}',
    ' #career td.hide-s,#career th.hide-s{display:none}',
    '}',
    '@media (prefers-reduced-motion:reduce){#career,#career *{transition:none!important;animation:none!important}}',
    // Hoja final de un partido de Carrera en teléfonos (≤ 420 px de alto; main.js marca #end.career en careerEndSheet): con la nota,
    // la XP, la subida de nivel y las insignias, «Menú principal» quedaba fuera a 667×375 (hoja de 424 px en 341). Sin «Jugada más
    // larga» (la Carrera ya da la nota) y los dos botones en una fila (el largo en dos líneas): cabe entera (350 en 341, el
    // botón entero a la vista; medido en notes/carrera.md).
    '@media (max-height:420px){',
    ' #end.career .end-rec>span{display:none}',
    ' #end.career .end-xp,#end.career .end-bd{margin-top:2px}',
    ' #end.career .end-sets{margin-top:4px}',
    ' #end.career .row-btn{display:flex;gap:8px;margin-top:8px}',
    ' #end.career .row-btn button{flex:1 1 0;min-width:0;padding:4px 8px;white-space:normal;line-height:1.05;font-size:14px;letter-spacing:.03em}',
    ' #end.career #btnAgain{flex-grow:1.25}',
    // (la hoja queda más baja que la columna de estadísticas: sin este alto mínimo «Ver celebración», abajo a la derecha, pisaba «Mejor racha»; con insignias ya crece sola)
    ' #end.career .sheet{min-height:min(334px,100%)}',
    '}'
  ].join('\n');

  // =================================================================== construcción
  function build() {
    if (root) return;
    ensureCss();
    root = document.createElement('div'); root.id = 'career'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Carrera');
    root.innerHTML = '<div class="cr-in"><div class="cr-head"></div><div class="cr-tabs" id="crTabs" role="tablist" aria-label="Secciones de la Carrera"></div>' +
      '<div class="cr-sub" id="crSub" role="tablist" aria-label="Apartados" hidden></div><div class="cr-body" id="crBody"></div></div>';
    (document.getElementById('app') || document.body).appendChild(root);
    head = root.querySelector('.cr-head'); tabsEl = root.querySelector('.cr-tabs'); subEl = root.querySelector('.cr-sub'); body = root.querySelector('.cr-body');
    root.addEventListener('click', onClick);
    root.addEventListener('input', function (e) { if (e.target && e.target.id === 'crName') form.name = e.target.value; });
    root.addEventListener('pointerdown', function () { var k = root.querySelectorAll('.kf'); for (var i = 0; i < k.length; i++) k[i].classList.remove('kf'); }, { passive: true });
    window.addEventListener('keydown', onKey, true);
    // deslizar el dedo sobre el contenido (≥ 56 px en horizontal, como VB.UI.tabs): sub-pestaña si la hay, si no apartado / oferta.
    // Aquí y no en el componente porque las dos barras comparten el mismo contenido (.cr-body)
    var sw0 = null;
    body.classList.add('tab-swipe');
    body.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || (e.target.closest && e.target.closest('input,table,.lg-sw,.seg'))) { sw0 = null; return; }
      sw0 = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    }, { passive: true });
    body.addEventListener('pointerup', function (e) {
      if (!sw0 || e.pointerId !== sw0.id) return;
      var dx = e.clientX - sw0.x, dy = e.clientY - sw0.y, dt = performance.now() - sw0.t; sw0 = null;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 700) { var tb = barApi('sub'); if (tb) tb.step(dx < 0 ? 1 : -1, 'swipe'); }
    }, { passive: true });
    body.addEventListener('pointercancel', function () { sw0 = null; }, { passive: true });
  }

  // =================================================================== render
  function render() {
    if (!root) return;
    try { renderInner(); }
    catch (e) {   // guardado raro que career.js no ha sabido reparar: no dejar el hub vacío y sin salida
      try { if (window.console) console.error('CareerUI.render', e); } catch (e2) { }
      renderBroken();
    }
  }
  function renderBroken() {
    head.innerHTML = '<button data-act="close" aria-label="Volver a Jugar">‹ Jugar</button><div class="cr-title"><small>Carrera</small><b>Guardado dañado</b></div>';
    tabsEl.hidden = true; tabsEl.innerHTML = ''; subEl.hidden = true; subEl.innerHTML = '';
    body.innerHTML = '<div class="card"><h3>No se puede abrir la carrera</h3><p>La carrera guardada en este navegador está dañada y no se ha podido reparar.</p>' +
      '<p class="muted">Puedes borrarla y empezar otra.</p><div class="acts"><button class="warn" data-act="broken">' +
      (confirmStep === 2 ? (device() === 'touch' ? 'Toca otra vez para borrar' : 'Pulsa otra vez para borrar') : 'Borrar la carrera dañada') + '</button><button data-act="close">Volver al menú</button></div></div>';
  }
  function renderInner() {
    var c = C() && C().get();
    if (view === 'create' || !c) { renderCreate(c); return; }
    if (c.phase === 'pick') { renderPick(c); return; }
    var k = C().myClub(c), L = C().league(k.lvl);
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'match';
    head.innerHTML = '<button data-act="close" aria-label="Volver a Jugar">‹ Jugar</button>' +
      '<div class="cr-title"><small>' + sp(['Carrera', 'Temporada ' + c.season, esc(L.name)], 'd') + '</small><b>' + sp([esc(c.player.name), esc(k.name)], 's') + '</b></div>' +
      '<div class="cr-ovr">' + C().playerOvr(c) + '<small>TU MEDIA</small></div>';
    // bandeja: lo no leído se marca como leído ANTES de pintar (el contador ya no sigue en la pestaña mientras la miras); el
    // resaltado de lo nuevo se conserva en este pintado (freshIds)
    var freshIds = {};
    if (tab === 'inbox' && C().readAll) { (c.inbox || []).forEach(function (m) { if (!m.r) freshIds[m.id] = 1; }); if (C().unread(c)) C().readAll(); }
    var un = C().unread ? C().unread(c) : 0, offN = c.offers && c.offers.length;
    tabsEl.hidden = false;
    drawBar('tab', TABS.filter(function (t) { return t[0] !== 'life' || LUI(); }).map(function (t) {
      var dot = (t[0] === 'player' && c.player.pts > 0) || (t[0] === 'club' && (c.window === 'mid' || c.phase === 'off') && offN) || (t[0] === 'match' && c.phase === 'off') ||
        (t[0] === 'life' && !!(c.life && c.life.spOffers && c.life.spOffers.length));
      return [t[0], t[1] + (t[0] === 'inbox' && un ? ' (' + un + ')' : ''), dot];
    }), tab);
    var sl = SUBS[tab];
    if (sl) {
      subEl.hidden = false;
      drawBar('sub', sl.map(function (s) {
        var dot = (s[0] === 'offers' && (offN || c.phase === 'off')) || (tab === 'player' && GROUP_OF[s[0]] && c.player.pts > 0);
        return [s[0], s[1], dot];
      }), sub[tab]);
    } else { subEl.hidden = true; }
    var h = '';
    if (tab === 'match') h = renderMatch(c);
    else if (tab === 'inbox') h = renderInbox(c, freshIds);
    else if (tab === 'player') h = renderPlayer(c);
    else if (tab === 'club') h = renderClub(c);
    else if (tab === 'league') h = sub.league === 'cal' ? renderCal(c) : renderTable(c);
    else if (tab === 'life') h = LUI() ? LUI().render(c, sub.life, HLP) : '';
    else h = renderHonors(c);
    body.innerHTML = h;
  }
  /** Barra de pestañas con el componente común (VB.UI.tabs). which = 'tab' (primer nivel: apartados del hub, u ofertas al elegir
   *  club) | 'sub' (sub-pestañas). items = [[id, texto ya escapado, punto?]]. Cada barra se crea una vez y luego se repinta con
   *  refresh (la pestaña elegida la manda career-ui: api.cur). Sin VB.UI.tabs (pruebas sin ui.js): botones sueltos (tabsBar). */
  function drawBar(which, items, sel) {
    var host = which === 'sub' ? subEl : tabsEl;
    if (!(VB.UI && VB.UI.tabs)) { host.innerHTML = tabsBar(items, sel, which === 'sub' || pickView() ? 'sub' : 'tab'); return; }
    var list = items.map(function (t) { return { id: String(t[0]), label: t[1] + (t[2] ? ' <i class="dot" aria-hidden="true"></i>' : '') }; });
    var api = which === 'sub' ? subApi : tabsApi;
    if (!api) {
      api = VB.UI.tabs(host, list, { value: String(sel), label: which === 'sub' ? 'Apartados' : 'Secciones de la Carrera', wrap: true, sound: false,
        onChange: function (id, dir, how) { snd('click'); if (which === 'tab' && !pickView()) setTab(id); else setSub(id); } });
      if (which === 'sub') subApi = api; else tabsApi = api;
    } else { api.cur = String(sel); api.refresh(list); }
  }
  function pickView() { var c = C() && C().get(); return !!(c && c.phase === 'pick' && view !== 'create'); }
  /** Barra visible del nivel pedido ('sub' cae al primer nivel si no hay sub-pestañas), o null. */
  function barApi(which) {
    if (which === 'sub' && subApi && !subEl.hidden) return subApi;
    return tabsApi && !tabsEl.hidden ? tabsApi : null;
  }
  /** Barra de pestañas sin ui.js: items = [[id, texto, punto?]], attr = 'tab' (apartados) | 'sub' (sub-pestañas). */
  function tabsBar(items, sel, attr) {
    return items.map(function (t) {
      return '<button role="tab" data-' + attr + '="' + t[0] + '" aria-selected="' + (String(sel) === String(t[0])) + '">' + t[1] + (t[2] ? '<i class="dot" aria-hidden="true"></i>' : '') + '</button>';
    }).join('');
  }
  function stars(n) { var s = ''; for (var i = 0; i < 5; i++) s += i < n ? '★' : '<span class="off">★</span>'; return '<span class="stars" aria-label="Prestigio ' + n + ' de 5">' + s + '</span>'; }
  function eur(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €'; }
  function money(v) { return eur(v) + ' al mes'; }
  function fact(label, val) { return '<div><small>' + esc(label) + '</small><b>' + val + '</b></div>'; }
  function teamBlock(c, club, right, extra) {
    return '<div class="team' + (right ? ' r' : '') + '">' + kitSw(club.kit, true) + '<span style="min-width:0"><b>' + esc(club.name) + '</b><small>' + extra + '</small></span></div>';
  }
  function lastCard(c) {
    var s = c.last; if (!s) return '';
    var rv = C().club(c, s.rival), sc = s.setScores.map(function (x) { return x[0] + '-' + x[1]; }).join(', ');
    if (s.bench) {   // jornada en el banquillo: sin nota ni experiencia
      return '<div class="card' + (freshLast ? ' new' : '') + '"><h3>' + sp(esc(s.label).split(' · '), 'v') + ' <span class="tag r">Banquillo</span></h3>' +
        '<p style="font:800 20px var(--display);text-transform:uppercase;letter-spacing:.04em;margin:0"><span class="' + (s.win ? 'w' : 'l') + '">' + (s.win ? 'Victoria' : 'Derrota') + ' ' + s.sets[0] + '-' + s.sets[1] + '</span> contra ' + esc(rv ? rv.name : s.rivalName) + '</p>' +
        '<p class="muted">' + sc + '</p><p>Jugaron ' + esc(c.mate.name.split(' ')[0]) + (s.sub ? ' y ' + esc(s.sub) : '') + '. Tú, al banquillo: sin nota ni experiencia, pero descansas, entrenas y cobras.</p>' +
        (s.train && s.train.gains && s.train.gains.length ? '<p>' + s.train.gains.map(function (k) { var LB = VB.Prog && VB.Prog.LABEL || {}; return '<span class="tag g">Entreno: +1 ' + esc(LB[k] || k) + '</span>'; }).join('') + '</p>' : '') + '</div>';
    }
    var h = '<div class="card' + (freshLast ? ' new' : '') + '"><h3>' + sp(esc(s.label).split(' · '), 'v') + (s.sim ? ' <span class="tag">Simulado</span>' : '') + '</h3><div class="row">' +
      '<div class="nota ' + notaCls(s.nota) + '" aria-label="Nota ' + dec(s.nota) + '"><span>' + dec(s.nota) + '<small>NOTA</small></span></div>' +
      '<div class="grow"><p style="font:800 20px var(--display);text-transform:uppercase;letter-spacing:.04em;margin:0"><span class="' + (s.win ? 'w' : 'l') + '">' + (s.win ? 'Victoria' : 'Derrota') + ' ' + s.sets[0] + '-' + s.sets[1] + '</span> contra ' + esc(rv ? rv.name : s.rivalName) + '</p>' +
      '<p class="muted">' + sc + '</p>' +
      '<p>' + plural(s.me.kills + s.me.aces + s.me.blocks, 'punto', 'puntos') + ' (' + s.me.kills + ' de ataque, ' + s.me.blocks + ' de bloqueo, ' + plural(s.me.aces, 'ace', 'aces') + ')' + SV +
      sp([plural(s.me.assists, 'asistencia', 'asistencias'), plural(s.me.errors, 'error', 'errores')], 'v') + '</p></div></div>' +
      '<p><span class="tag y">+' + s.xp + ' XP</span>' + (s.lvlUp ? '<span class="tag g">¡Nivel ' + s.lvl + '! +' + s.ptsGained + ' puntos de mejora</span>' : '') + '</p>';
    if (s.badges && s.badges.length && VB.Badges) h += '<p>' + s.badges.map(function (u) { return '<span class="tag y">' + esc(VB.Badges.label(u)) + '</span>'; }).join('') + '</p>';
    if (LUI()) h += LUI().lastExtra(c, s, HLP);   // reto, seguidores, dinero, duelo y logros
    if (s.train && s.train.gains && s.train.gains.length) {   // mejoras gratis del entrenamiento de la semana
      var LB = VB.Prog && VB.Prog.LABEL || {};
      h += '<p>' + s.train.gains.map(function (k) { return '<span class="tag g">Entreno: +1 ' + esc(LB[k] || k) + '</span>'; }).join('') + '</p>';
    }
    if (s.round && s.round.length > 1) {
      h += '<p class="muted" style="margin-top:8px">Resto de la jornada: ' + sp(s.round.filter(function (m) { return m.a !== c.myClub && m.b !== c.myClub; }).map(function (m) {
        var a = C().club(c, m.a), b = C().club(c, m.b); return esc(a.short) + ' ' + m.s[0] + '-' + m.s[1] + ' ' + esc(b.short);
      }), 'v') + '</p>';
    }
    return h + '</div>';
  }
  function renderMatch(c) {
    var h = '';
    if (c.phase === 'off') return renderSeasonEnd(c);
    var n = C().next(c);
    if (n) {
      // posiciones solo con la liga empezada (en la jornada 1 la tabla vacía daba «6º» contra «3r»)
      var pm = C().posOf(c, n.me.id), pr = C().posOf(c, n.rival.id), lg = c.phase === 'league' && c.week > 0;
      h += '<div class="card"><h3>' + sp(esc(n.label).split(' · '), 'v') + '</h3><div class="vs">' +
        // («Pareja»: la fuerza de los dos —teamOvr— y la del rival; la media de la cabecera es solo la tuya)
        teamBlock(c, n.me, false, sp([lg ? ordn(pm) : '', 'Pareja ' + n.ovrMe, n.atHome ? 'En casa' : 'Fuera'], 'c')) +
        '<div class="vs-mid">VS</div>' +
        teamBlock(c, n.rival, true, sp([lg ? ordn(pr) : '', 'Pareja ' + n.ovrRival, 'IA ' + esc(n.diffName || diffName(n.diff))], 'c')) + '</div>' +
        '<p class="muted" style="margin-top:8px">Vóley playa en la arena de Platja Llarga: al mejor de 3 sets a ' + C().PTS + ', el tercero a ' + C().PTS3 + '. Tú llevas a ' + esc(c.player.name) + ' (dorsal ' + c.player.num + ') y a tu pareja la lleva la IA.</p>' +
        // (la pareja, en pastillas: antes era una lista metida en un paréntesis)
        '<p class="muted" style="margin-top:4px">' + (function () {
          var mo = C().mateOvr(c), dd = mo - C().clubOvr(n.me), tg = dd >= 3 ? 'g' : dd <= -3 ? 'r' : '';
          return sp(['Pareja: ' + esc(c.mate.name), esc(c.mate.role), 'Media ' + mo, { h: esc(vsClub(dd)), c: tg ? 'dv ' + tg : 'dv' }, 'Forma: ' + esc(C().formText(c.mate.form | 0)).toLowerCase()], 'c');
        })() + '</p>' +
        '<p class="muted">' + sp(['Entreno: ' + esc(C().TRAIN[c.train].name), 'Fatiga ' + (c.fatigue | 0) + (C().fatigueMalus(c) ? ' (−' + C().fatigueMalus(c) + ' en tus atributos)' : ''),
          'Química ' + (c.mate.chem | 0) + (C().chemBonus(c) ? ' (+' + C().chemBonus(c) + ')' : '')], 'v') + '</p>' +
        (n.bench
          // el entrenador te sienta (rol de rotación con poca confianza, o titular con el entrenador descontento): sin partido
          ? '<div class="bench"><p><b>Esta jornada no juegas.</b> ' + esc(C().benchWhy ? C().benchWhy(c) : '') + ' La juega ' + esc(c.mate.name) + ' con uno de la plantilla; tú descansas (fatiga −' + C().BENCH_REST + '), entrenas y cobras.</p></div>' +
            '<div class="acts"><button class="pri" data-act="bench">Ver la jornada</button></div></div>'
          : '<div class="acts"><button class="pri" data-act="play">Jugar partido</button><button data-act="sim">Simular <small style="font:600 12px var(--ui);text-transform:none;letter-spacing:0">(mitad de XP)</small></button></div></div>');
    }
    if (LUI()) h += LUI().matchCards(c, HLP);   // reto de la jornada y decisión pendiente
    var lastUn = (c.inbox || []).filter(function (m) { return !m.r; }).slice(-1)[0];
    if (lastUn) h += '<div class="card"><h3>Mensajes <span class="muted">(' + plural(C().unread(c), 'sin leer', 'sin leer') + ')</span></h3>' + msgHTML(lastUn) + '<div class="acts"><button data-tab="inbox">Ver mensajes</button></div></div>';
    if (c.window === 'mid' && c.offers && c.offers.length) h += '<div class="card new"><h3>Ventana de fichajes</h3><p>' + plural(c.offers.length, 'club quiere', 'clubes quieren') + ' ficharte ya. Las ofertas caducan al jugar o simular el siguiente partido.</p><div class="acts"><button data-tab="club" data-s="offers">Ver ofertas</button></div></div>';
    h += lastCard(c);
    if (!c.last) h += '<div class="card"><h3>Objetivo del club</h3><p>' + esc(c.objective.text) + '</p><p class="muted">El entrenador valora tus notas y los resultados. Al final de la temporada llegan ofertas de clubes mejores si juegas bien.</p></div>';
    freshLast = false;
    return h;
  }
  function renderSeasonEnd(c) {
    var r = c.review || {}, k = C().myClub(c), L = C().league(r.lvl != null ? r.lvl : k.lvl);
    var h = '<div class="card new"><h3>Fin de la temporada ' + r.season + '</h3>' +
      '<p style="font:900 24px var(--display);text-transform:uppercase;letter-spacing:.04em;margin:0">' + ordn(r.pos) + ' ' + esc(deL(L)) + '</p><p>' +
      (r.champion ? '<span class="tag y">Campeón ' + esc(deL(L)) + '</span>' : '') + (r.cup ? '<span class="tag y">Campeón del ' + esc(L.cup) + '</span>' : '') +
      (r.move > 0 ? '<span class="tag g">Ascenso</span>' : r.move < 0 ? '<span class="tag r">Descenso</span>' : '') +
      '<span class="tag ' + (r.objOk ? 'g' : 'r') + '">Objetivo ' + (r.objOk ? 'cumplido' : 'no cumplido') + '</span></p>' +
      '<p class="muted">' + sp(['Objetivo: ' + esc(r.objective), 'Nota media ' + dec(r.nota), 'Entrenador: ' + esc(C().coachText(c.coach))], 'v') + '</p></div>';
    var rn = r.renew, ct = c.contract, nOf = (c.offers || []).length;
    // las ofertas viven en Club › Ofertas (en el móvil quedaban 1000 px más abajo, tras «Seguir en…»): aquí, un aviso arriba
    if (nOf) h += '<div class="card"><h3>Ofertas <span class="muted">(' + plural(nOf, 'club te quiere', 'clubes te quieren') + ')</span></h3><p class="muted">Míralas antes de decidir: si sigues en tu club, se pierden.</p>' +
      '<div class="acts"><button class="pri" data-tab="club" data-s="offers">Ver ofertas</button></div></div>';
    h += '<div class="card"><h3>' + (rn ? 'Tu club te ofrece renovar' : 'Tu club') + '</h3>' +
      (rn ? '<p>' + sp([esc(rn.role), money(rn.salary)], 'c') + '</p><p class="muted">Se te acaba el contrato. Si sigues, firmas por:</p>' + yearsSeg('renew', yrs.renew || rn.years)
        : '<p class="muted">' + (ct ? 'Te ' + (ct.left - 1 === 1 ? 'queda 1 temporada' : 'quedan ' + (ct.left - 1) + ' temporadas') + ' de contrato.' : '') + '</p>') +
      // con ofertas, «Seguir» pide confirmación (dos pulsaciones en 3 s): un toque despistado ya no las rechaza todas
      '<div class="acts"><button class="' + (stayArm && nOf ? 'warn' : nOf ? '' : 'pri') + '" data-act="stay">' + (stayArm && nOf ? (device() === 'touch' ? 'Toca otra vez: rechazas ' : 'Pulsa otra vez: rechazas ') + plural(nOf, 'oferta', 'ofertas')
        : (rn ? 'Renovar con ' : 'Seguir en ') + esc(k.name) + (r.move ? (r.move > 0 ? ' (sube)' : ' (baja)') : '')) + '</button></div></div>';
    return h;
  }
  /** Selector de duración del contrato (1-3 temporadas). key = id del club o 'renew'. */
  function yearsSeg(key, v) {
    return '<div class="seg" role="group" aria-label="Duración del contrato">' + [1, 2, 3].map(function (y) {
      return '<button data-act="yrs" data-y="' + y + '" data-key="' + key + '" aria-pressed="' + (v === y) + '">' + plural(y, 'temporada', 'temporadas') + '</button>';
    }).join('') + '</div>';
  }
  /** Ficha de una oferta (inicio, mitad y fin de temporada): club, prestigio, liga, media, estilo, ciudad, compañero, objetivo, rol,
   *  sueldo y contrato. full = ficha grande (una por pestaña al elegir club). */
  function offerCard(c, o, i, full) {
    var k = C().club(c, o.club), f = C().clubInfo(c, k, o.lvl != null ? o.lvl : k.lvl, o.q), mp = o.mateP, y = yrs[o.club] || o.years || 1;
    var h = '<div class="' + (full ? 'card offer-full' : 'offer-x') + '"' + (full ? '' : ' style="padding:8px 0;border-top:1px solid rgba(255,255,255,.1)"') + '><div class="row">' + kitSw(k.kit, full) +
      '<div class="grow" style="min-width:0"><p class="bigname"' + (full ? '' : ' style="font-size:18px"') + '>' + esc(k.name) + '</p><p class="muted" style="margin:2px 0 0">' +
      sp([stars(f.stars), esc(f.league), esc(f.beach || k.city)], 'v') + '</p></div></div>';
    var rl = Math.max(0, C().ROLE_LV.indexOf(o.role)), early = !o.trial && C().earlyExit && C().earlyExit(c), cov = o.ovr != null ? o.ovr : f.ovr;
    h += '<div class="fact">' + fact('Media del club', cov) + fact('Estilo', esc(f.style) + styleTrain(f.style)) +
      // el compañero que te dan al firmar, con su nivel respecto al club (un buen compañero es un argumento para fichar)
      fact('Compañero', mp ? esc(mp.name) + mateLine(mp, cov, false) : 'Media ~' + o.mate) +
      (o.objective ? fact('Objetivo', esc(o.objective)) : '') +
      fact('Rol prometido', esc(o.role) + (o.firm ? ' <span class="muted">(firme)</span>' : '') + ' <span class="muted">(entrenador: ' + ((C().ROLE_COACH || [45, 55, 65])[rl] - (early ? C().EARLY_COACH : 0) - (o.negNo ? C().NEG_COACH : 0)) + ' de confianza)</span>') +
      (o.salary ? fact('Sueldo (ficticio)', money(o.salary) + (c.contract && c.contract.salary && c.phase !== 'pick' ? ' <span class="muted">(ahora ' + eur(c.contract.salary) + ')</span>' : '')) : '') + '</div>';
    // lo que significa el rol prometido (ya no es solo texto: rotación = alguna jornada al banquillo; titular incumplido = te vas sin pegas)
    if (!o.trial && C().ROLE_HINT) h += '<p class="muted" style="margin:0 0 6px"><b>' + esc(o.role) + ':</b> ' + esc(C().ROLE_HINT[rl]) + '</p>';
    if (early) h += '<p class="muted"><b>Tienes contrato en vigor:</b> si fichas, el club de ahora pone pegas y el entrenador nuevo empieza con ' + C().EARLY_COACH + ' menos de confianza (no pasa si te declaras transferible en Club › Contrato).</p>';
    if (o.negNo) h += '<p class="muted">Negociación rechazada: si firmas, el entrenador empieza con ' + C().NEG_COACH + ' menos de confianza.</p>';
    if (o.trial) h += '<p class="muted">Es una <b>prueba</b>: te fichan si la superas (probabilidad ~' + Math.round(o.chance * 100) + ' %). Si no, pierdes esta oferta y sigues con las demás. Contrato de 1 temporada. Ojo: ' + esc(C().lname(C().league(1))) + ' es una categoría por encima: la IA rival juega en Normal (en Normal suave contra los clubes más flojos).</p>';
    else h += '<p class="muted" style="margin-top:6px">Duración del contrato:</p>' + yearsSeg(o.club, y);
    var canNeg = !o.trial && !o.firm && o.role !== 'Titular indiscutible';
    if (offArm === i && c.window === 'mid') {   // fichar a mitad de temporada: confirmación con lo que cambia
      var mk = C().myClub(c), nl = C().league(f.lvl);
      return h + '<div class="confirm" role="alertdialog" aria-label="Confirmar fichaje"><p><b>¿Fichar ya por ' + esc(k.name) + '?</b> Dejas ' + esc(mk.name) + ' a mitad de temporada y juegas lo que queda ' +
        (f.lvl !== mk.lvl ? (nl.art === 'el' ? 'en el ' : 'en la ') + esc(nl.name) + ' con su calendario' : 'con su calendario') + ', con ' + (mp ? esc(mp.name) : 'otra pareja') + ' (química desde cero). ' +
        (early ? 'Sales con contrato en vigor: el entrenador nuevo empieza con ' + C().EARLY_COACH + ' menos de confianza. ' : '') + 'No se puede deshacer.</p>' +
        '<div class="acts"><button class="pri" data-act="offer" data-i="' + i + '">Sí, fichar</button><button data-act="offno">Cancelar</button></div></div></div>';
    }
    h += '<div class="acts"><button class="pri" data-act="offer" data-i="' + i + '">' + (o.trial ? 'Hacer la prueba' : 'Firmar') + '</button>' +
      (canNeg ? '<button data-act="neg" data-i="' + i + '" title="Si no sale, el entrenador empieza con menos confianza">Pedir más rol</button>' : '') + '</div></div>';
    return h;
  }
  /** «(entrenos +6 por semana en defensa)»: lo que suman los entrenamientos del club con ese estilo (VB.Career.STYLE_TRAIN). */
  function styleTrain(style) {
    var g = C().STYLE_TRAIN && C().STYLE_TRAIN[style];
    return g ? ' <span class="muted">(entrenos +' + C().STYLE_PROG + ' por semana en ' + esc(GROUP_OF[g]).toLowerCase() + ')</span>' : '';
  }
  function offersHTML(c) {
    if (!c.offers || !c.offers.length) return '<p class="muted">Ningún club ha hecho una oferta. Mejora tu media y tus notas para llamar la atención' + (c.listed ? '' : ', o declárate transferible en Club › Contrato') + '.</p>';
    var h = c.offers.map(function (o, i) { return offerCard(c, o, i, false); }).join('') + '<p class="note" role="status" aria-live="polite">' + esc(note) + '</p>';
    note = '';
    return h;
  }
  function renderTable(c) {
    var k = C().myClub(c), lvl = tblLvl >= 0 ? tblLvl : k.lvl, L = C().league(lvl), t = C().table(c, lvl), top = lvl === C().LEAGUES.length - 1, low = lvl === 0;
    var h = '<div class="card"><div class="lg-sw" role="group" aria-label="Liga">' + C().LEAGUES.map(function (x) {
      return '<button data-act="lvl" data-l="' + x.lvl + '" aria-pressed="' + (x.lvl === lvl) + '">' + esc(x.short) + '</button>';
    }).join('') + '</div><h3>' + sp([esc(L.name), c.phase === 'league' ? 'Jornada ' + Math.min(c.week, C().WEEKS) + ' de ' + C().WEEKS : 'Temporada regular acabada'], 'd') + '</h3>' +
      '<table><thead><tr><th class="l">#</th><th class="l">Club</th><th>PJ</th><th>G</th><th>P</th><th class="hide-s">Sets</th><th class="hide-s">Puntos</th><th>Pts</th></tr></thead><tbody>';
    t.forEach(function (r) {
      var cl = C().club(c, r.id), cls = [];
      if (r.id === c.myClub) cls.push('me');
      if (!top && r.pos <= 2) cls.push('up'); else if (r.pos <= 4) cls.push('cup');
      if (!low && r.pos >= 7) cls.push('down');
      h += '<tr class="' + cls.join(' ') + '"><td class="l">' + r.pos + '</td><td class="club">' + kitSw(cl.kit).replace('cr-kit', 'cr-kit kit-mini') + esc(cl.name) + '</td><td>' + r.pj + '</td><td>' + r.g + '</td><td>' + r.p + '</td><td class="hide-s">' + r.sf + '-' + r.sc + '</td><td class="hide-s">' + r.pf + '-' + r.pc + '</td><td class="pts">' + r.pts + '</td></tr>';
    });
    h += '</tbody></table><p class="muted" style="margin-top:8px">' + (top ? '' : '<span class="tag g">1-2 ascienden</span>') + '<span class="tag y">1-4 juegan el open</span>' + (low ? '' : '<span class="tag r">7-8 descienden</span>') +
      ' Puntos: 3 por ganar 2-0, 2 por ganar 2-1 y 1 por perder 1-2.</p></div>';
    return h;
  }
  function renderCal(c) {
    var k = C().myClub(c), s = c.sched[k.lvl], h = '<div class="card"><h3>' + sp(['Calendario', esc(C().league(k.lvl).name)], 'd') + '</h3><div class="cal">';
    s.forEach(function (wk, w) {
      var m = null, i; for (i = 0; i < wk.length; i++) if (wk[i][0] === k.id || wk[i][1] === k.id) { m = wk[i]; break; }
      if (!m) return;
      var home = m[0] === k.id, rv = C().club(c, home ? m[1] : m[0]), r = c.res[k.lvl][w] && c.res[k.lvl][w][i], res = '';
      if (r) { var mine = r.a === k.id ? r.s : [r.s[1], r.s[0]], win = mine[0] > mine[1]; res = '<span class="res ' + (win ? 'w' : 'l') + '">' + (win ? 'G ' : 'P ') + mine[0] + '-' + mine[1] + '</span>'; }
      else res = '<span class="muted">' + (c.phase === 'league' && w === c.week ? 'Próximo' : 'Pendiente') + '</span>';
      h += '<div class="cal-r' + (c.phase === 'league' && w === c.week ? ' next' : '') + '"><b>J' + (w + 1) + '</b><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + kitSw(rv.kit).replace('cr-kit', 'cr-kit kit-mini') + (home ? 'vs ' : 'en ') + esc(rv.name) + '</span>' + res + '</div>';
    });
    h += '</div>';
    if (c.cup) {
      var cu = c.cup, nm = function (id) { var x = C().club(c, id); return x ? esc(x.short) : '?'; }, line = function (m, r) { return nm(m[0]) + (r ? ' ' + r.s[0] + '-' + r.s[1] + ' ' : ' — ') + nm(m[1]); };
      h += '<h3 style="margin-top:12px">' + esc(C().league(cu.lvl).cup) + '</h3><p>Semifinales: ' + sp(cu.semis.map(function (m, j) { return line(m, cu.res[0] && cu.res[0][j]); }), 'v') + '</p>' +
        (cu.final ? '<p>Final: ' + line(cu.final, cu.res[1] && cu.res[1][0]) + (cu.champion >= 0 ? SV + 'Campeón: ' + nm(cu.champion) : '') + '</p>' : '');
    }
    return h + '</div>';
  }
  function renderPlayer(c) {
    var s = sub.player;
    if (s === 'badges') return renderBadges(c);
    if (s === 'train') return renderTrain(c);
    var a = c.player, P = VB.Prog, need = C().need(a.lvl), h = '<div class="card"><div class="row">' + kitSw(C().myClub(c).kit) +
      '<div class="grow" style="min-width:0"><p class="bigname" style="font-size:20px">' + sp([esc(a.name), 'n.º ' + a.num], 's') + '</p><p class="muted" style="margin:0">' + sp([esc(a.role), a.age + ' años', 'Nivel ' + a.lvl, plural(a.matches | 0, 'partido', 'partidos')], 'c') + '</p></div></div>' +
      '<div class="xp" role="progressbar" aria-valuemin="0" aria-valuemax="' + need + '" aria-valuenow="' + a.xp + '" aria-label="Experiencia"><i style="width:' + Math.round(100 * a.xp / need) + '%"></i></div>' +
      '<p class="muted">' + sp([a.xp + ' / ' + need + ' XP para el nivel ' + (a.lvl + 1), 'Puntos de mejora: <b style="color:#ffd23f">' + a.pts + '</b>'], 'v') + '</p>';
    // solo el grupo de la sub-pestaña (Ataque / Defensa / Físico; los de VB.Prog.GROUPS)
    var groups = (P && P.GROUPS ? P.GROUPS : [['Ataque', ['set', 'spike', 'ctl', 'serve']], ['Defensa', ['recv', 'dig', 'block']], ['Físico', ['jump', 'speed', 'react']]]).filter(function (g) { return g[0] === GROUP_OF[s]; });
    groups.forEach(function (g) {
      h += '<h3 style="margin-top:10px">' + esc(g[0]) + '</h3>';
      g[1].forEach(function (k) {
        var v = a.st[k], cost = C().cost(v), can = v < 99 && a.pts >= cost, lab = P && P.LABEL ? P.LABEL[k] : k;
        h += '<div class="attr" title="' + esc(P && P.HINT ? P.HINT[k] : '') + '"><span>' + esc(lab) + '</span><span class="bar"><i style="width:' + v + '%"></i></span><b>' + v + '</b>' +
          '<button data-act="up" data-k="' + k + '"' + (can ? '' : ' disabled') + ' aria-label="Mejorar ' + esc(lab) + ' (' + plural(cost, 'punto', 'puntos') + ')">' + (v >= 99 ? 'máx' : '+' + cost) + '</button></div>';
      });
    });
    var tg = { atk: 'atk', def: 'def', phys: 'phys' }[s];
    h += '<p class="muted" style="margin-top:8px">Entreno: ' + esc(C().TRAIN[c.train].name) + SV + 'progreso de ' + esc(GROUP_OF[s]).toLowerCase() + ' ' + (c.tp && c.tp[tg] | 0) + ' / ' + C().TRAIN_NEED +
      ' (al llegar, +1 gratis en el más bajo del grupo)</p></div>';
    return h;
  }
  function renderBadges(c) {
    var a = c.player, h = '<div class="card"><h3>' + sp(['Insignias', VB.Badges ? (VB.Badges.equipped(a).length + ' de ' + VB.Badges.slots(a) + ' huecos') : 'no disponibles'], 'd') + '</h3>';
    if (VB.Badges) {
      h += '<p class="muted">Se desbloquean jugando (bronce, plata y oro). Toca una desbloqueada para equiparla o quitarla. Más huecos cada 5 niveles.</p><div class="bdg">';
      VB.Badges.LIST.forEach(function (b) {
        var pr = VB.Badges.progress(a, b.id), on = VB.Badges.equipped(a).indexOf(b.id) >= 0, lv = pr.lvl;
        h += '<button class="bd' + (lv ? '' : ' lock') + '" data-act="badge" data-id="' + b.id + '" aria-pressed="' + on + '"' + (lv ? '' : ' aria-disabled="true"') + '>' +
          '<span class="ic" style="color:' + TIER_C[lv] + '">' + b.icon + '</span><span style="min-width:0"><strong>' + esc(b.name) + '</strong>' +
          '<span style="color:' + TIER_C[lv] + ';font-weight:800">' + TIER_N[lv] + '</span>' + SV + esc(lv ? b.desc + ' (' + b.fx[lv - 1] + ')' : b.cond) +
          '<span class="pg"><i style="width:' + Math.round(pr.frac * 100) + '%"></i></span><span class="muted">' + (pr.next != null ? pr.n + ' / ' + pr.next + ' ' + esc(pr.unit) : 'Nivel máximo') + '</span></span></button>';
      });
      h += '</div><p class="bd-msg" role="status" aria-live="polite">' + esc(badgeMsg) + '</p>';
    }
    badgeMsg = '';
    return h + '</div>';
  }
  function meter(v, label, col) {
    return '<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + v + '" aria-label="' + esc(label) + '"><i style="width:' + v + '%;background:' + col + '"></i></div>';
  }
  /** Jugador › Entreno: enfoque de la semana, progreso por grupo y fatiga. */
  function renderTrain(c) {
    var T = C().TRAIN, f = c.fatigue | 0, fm = C().fatigueMalus(c), fc = f > 60 ? '#d8364a' : f > C().FAT_FREE ? '#e07b2b' : '#2fbf71';
    var h = '<div class="card"><h3>Enfoque de la semana</h3><p class="muted">Se aplica tras cada partido (jugado o simulado). Cada ' + C().TRAIN_NEED + ' de progreso, +1 gratis en el atributo más bajo de ese grupo. Los enfoques cansan; Equilibrado no. Descansar recupera y en verano la fatiga vuelve a 0.' + (C().STYLE_TRAIN && C().STYLE_TRAIN[C().clubInfo(c, C().myClub(c)).style] ? ' Los entrenos de tu club suman +' + C().STYLE_PROG + ' por semana en ' + esc(GROUP_OF[C().STYLE_TRAIN[C().clubInfo(c, C().myClub(c)).style]]).toLowerCase() + '.' : '') + '</p><div class="tgrid" role="group" aria-label="Enfoque de entrenamiento">' +
      C().TRAIN_KEYS.map(function (k) {
        var t = T[k], gs = Object.keys(t.prog), pr = gs.length > 1 ? '+' + t.prog[gs[0]] + ' a cada grupo' : gs.length ? '+' + t.prog[gs[0]] + ' por semana' : '';
        // «Salto, velocidad y reacción (cansa). +60 por semana, fatiga +12»
        var fat = t.fat ? (pr ? ', fatiga ' : 'Fatiga ') + (t.fat > 0 ? '+' : '') + t.fat : '';
        return '<button data-act="train" data-t="' + k + '" aria-pressed="' + (c.train === k) + '">' + esc(t.name) + '<small>' + esc(t.hint) + (pr || fat ? '. ' + pr + fat : '') + '</small></button>';
      }).join('') + '</div></div>';
    h += '<div class="card"><h3>Progreso</h3>' + ['phys', 'def', 'atk'].map(function (g) {
      var v = c.tp && c.tp[g] | 0;
      return '<div class="pbar"><span>' + esc(GROUP_OF[g]) + '</span><span class="bar"><i style="width:' + Math.round(100 * v / C().TRAIN_NEED) + '%"></i></span><b>' + v + '</b></div>';
    }).join('') +
      '<h3 style="margin-top:10px">' + sp(['Fatiga', f + ' de 100'], 'd') + '</h3>' + meter(f, 'Fatiga', fc) +
      '<p class="muted">' + (fm ? 'Rindes menos: −' + fm + ' en todos tus atributos en el próximo partido. Una semana de Descanso la baja ' + (-T.rest.fat) + '.' : 'Por debajo de ' + C().FAT_FREE + ' no afecta al juego.') + '</p>' +
      // fisio: lo pagas con lo que ahorras del sueldo (una vez por jornada)
      (C().physio && c.phase !== 'off' ? '<div class="acts"><button data-act="physio"' + (f > 0 ? '' : ' disabled') + '>Fisio <small style="font:600 12px var(--ui);text-transform:none;letter-spacing:0">(−' + C().PHYSIO_FAT + ' de fatiga, ' + eur(C().physioCost(c)) + ')</small></button></div>' +
        '<p class="muted">' + sp(['Ahorros ' + eur(c.money || 0), 'una sesión por jornada'], 'v') + '</p><p class="note" role="status" aria-live="polite">' + esc(note) + '</p>' : '') + '</div>';
    note = '';
    return h;
  }
  function renderClub(c) {
    var s = sub.club;
    if (s === 'mate') return renderMate(c);
    if (s === 'contract') return renderContract(c);
    if (s === 'offers') {
      return '<div class="card"><h3>' + (c.window === 'mid' ? 'Ventana de fichajes' : 'Ofertas') + '</h3>' +
        (c.window === 'mid' || c.phase === 'off' ? offersHTML(c) + (c.window === 'mid' && c.offers.length ? '<div class="acts"><button data-act="stay">Rechazar las ofertas</button></div>' : '')
          : '<p class="muted">Las ofertas llegan a mitad de temporada (tras la jornada ' + C().MID_WEEK + ', solo con una nota media de ' + (c.listed ? '6,5' : '7') + ' o más) y al acabarla. Cuentan tu media, tu nota media, la confianza del entrenador, tus insignias y si te has declarado transferible.</p>') + '</div>';
    }
    var k = C().myClub(c), L = C().league(k.lvl), f = C().clubInfo(c, k), coach = c.coach, cc = coach < 30 ? '#d8364a' : coach < 50 ? '#e07b2b' : coach < 70 ? '#d9a520' : '#2fbf71';
    var ref = C().REF[L.ref];
    var h = '<div class="card"><div class="row">' + kitSw(k.kit, true) + '<div class="grow" style="min-width:0"><p class="bigname">' + esc(k.name) + '</p>' +
      '<p class="muted" style="margin:2px 0 0">' + sp([stars(f.stars), esc(L.name), esc(k.city)], 'v') + '</p></div></div>' +
      '<div class="fact">' + fact('Media del club', C().clubOvr(k)) + fact('Posición', c.phase === 'league' && c.week === 0 ? '—' : ordn(C().posOf(c, k.id))) + fact('Sede', esc(f.beach || k.city)) + fact('Estilo', esc(f.style) + styleTrain(f.style)) +
      // (el compañero, con pastillas como en la oferta; antes rol, media y desvío iban metidos en un paréntesis)
      fact('Compañero', esc(c.mate.name) + (function () {
        var mo = C().mateOvr(c), dd = mo - C().clubOvr(k), tg = dd >= 3 ? 'g' : dd <= -3 ? 'r' : '';
        return '<span class="mline">' + sp([esc(c.mate.role), 'Media ' + mo, { h: esc(vsClub(dd)), c: tg ? 'dv ' + tg : 'dv' }], 'c') + '</span>';
      })()) +
      fact('Objetivo', esc(c.objective.text)) + fact('Arbitraje', esc(ref.name)) + '</div>' +
      '<h3 style="margin-top:10px">' + sp(['Entrenador', esc(C().coachText(coach))], 'd') + '</h3>' + meter(coach, 'Confianza del entrenador', cc) +
      '<p class="muted">' + sp(['Nota media de la temporada: ' + dec(C().avgNota(c)), 'Forma (3 últimos): ' + dec(C().form(c))], 'v') + '</p></div>';
    return h;
  }
  /** Club › Compañero: el actual (química) y la plantilla para pedir cambio. */
  function renderMate(c) {
    var m = c.mate, ch = m.chem | 0, cb = C().chemBonus(c), k = C().myClub(c), co = C().clubOvr(k), mo = C().mateOvr(c), mf = m.form | 0;
    var h = '<div class="card"><h3>Tu pareja</h3><p class="bigname" style="font-size:20px">' + sp([esc(m.name), 'n.º ' + m.num], 's') + '</p>' + mateLine(m, co, true) +
      '<p class="muted">' + (mo - co <= -3 ? 'Con una pareja floja tendrás más trabajo y más protagonismo: la IA se la jugará menos y tú llevarás el peso.' : mo - co >= 3 ? 'Con una pareja buena tienes más ayuda: recibe, defiende y remata por encima del nivel del club.' : 'Una pareja al nivel del club: ni carga ni muleta.') +
      (mf ? ' Su forma (' + esc(C().formText(mf)).toLowerCase() + ') ' + (mf > 0 ? 'suma +' : 'resta −') + Math.abs(mf) + ' a todos sus atributos en el próximo partido; cambia tras cada partido.' : ' Su forma cambia tras cada partido y suma o resta hasta ' + C().FORM_MAX + ' a sus atributos.') + '</p>' +
      '<h3 style="margin-top:10px">' + sp(['Química', ch + ' de 100'], 'd') + '</h3>' + meter(ch, 'Química con el compañero', '#4be0a0') +
      '<p class="muted">Sube cada partido juntos (+5 jugado, +3 simulado). ' + (cb ? 'Ahora suma +' + cb + ' a los dos en reacción, colocación y recepción.' : 'A partir de 30 suma +1 a los dos en reacción, colocación y recepción (hasta +3).') + '</p></div>';
    h += '<div class="card"><h3>Plantilla</h3><p class="muted">Puedes pedir jugar con otro compañero del club' + (c.coach < C().MATE_COACH ? ', pero el entrenador aún no te deja (necesitas su confianza: «Tiene dudas» o mejor).' : '. La química se guarda con cada uno; las medias y los puntos fuertes son de verdad en el partido.') + '</p>' +
      (c.squad || []).map(function (s, i) {
        var so = C().ovrOf(s.st), d = so - mo;
        return '<div class="mate"><div style="min-width:0"><b style="font:800 17px var(--display);text-transform:uppercase">' + esc(s.name) + '</b>' + mateLine(s, co, true) +
          '<p class="muted" style="margin:2px 0 0">' + sp([(d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + ' respecto a ' + esc(m.name.split(' ')[0]), 'Química ' + (s.chem | 0)], 'c') + '</p></div><button data-act="mate" data-i="' + i + '"' + (c.coach < C().MATE_COACH ? ' disabled' : '') + '>Elegir</button></div>';
      }).join('') + '<p class="note" role="status" aria-live="polite">' + esc(note) + '</p></div>';
    note = '';
    return h;
  }
  /** Club › Contrato: rol, años y sueldo; pedir el traspaso. */
  function renderContract(c) {
    var ct = c.contract || {};
    var rl = C().roleIdx ? C().roleIdx(c) : 1, brk = c.broken === c.season;
    var h = '<div class="card"><h3>Contrato</h3><div class="fact">' + fact('Rol', esc(ct.role || '—')) + fact('Quedan', plural(ct.left | 0, 'temporada', 'temporadas') + ' (con esta)') +
      fact('Sueldo (ficticio)', ct.salary ? money(ct.salary) : '—') + fact('Ahorros', eur(c.money || 0)) + fact('Firmado', 'Temporada ' + (ct.since || 1) + ', ' + plural(ct.years | 0, 'temporada', 'temporadas')) + '</div>' +
      (C().ROLE_HINT ? '<p><b>' + esc(ct.role || '') + ':</b> ' + esc(C().ROLE_HINT[rl]) + ((c.stats.bench | 0) ? ' Esta temporada, ' + plural(c.stats.bench | 0, 'jornada', 'jornadas') + ' en el banquillo.' : '') + '</p>' : '') +
      (brk ? '<p class="bench" style="margin:6px 0"><b>Promesa incumplida.</b> Te fichó como titular y te ha sentado: hasta final de temporada puedes irte sin pegas y los clubes se interesan más por ti.</p>' : '') +
      '<p class="muted">Cobras el sueldo cada jornada (la mitad del mensual) y lo ahorras: sirve para el fisio (Jugador › Entreno). Al acabar la última temporada del contrato, el club te propone renovar (el rol depende de la confianza del entrenador) y eliges la duración.</p></div>';
    h += '<div class="card"><h3>' + sp(['Traspaso', c.listed ? 'Transferible' : 'No transferible'], 'd') + '</h3>' +
      (c.listed ? '<p>Estás en la lista de transferibles: llegan más ofertas (a mitad de temporada basta con una nota media de 6,5).</p><div class="acts"><button data-act="transfer" data-on="0">Retirar la petición</button></div>'
        : '<p class="muted">Si te declaras transferible, los clubes se interesan más por ti, pero el entrenador pierde confianza (−8).</p><div class="acts"><button class="warn" data-act="transfer" data-on="1">Pedir el traspaso</button></div>') + '</div>';
    return h;
  }
  /** Mensajes: entrenador, agente, ofertas, objetivos. Lo nuevo resaltado (se marca como leído al verlo). */
  var MSG_K = { coach: 'Entrenador', agent: 'Agente', offer: 'Ofertas', obj: 'Objetivo', club: 'Club', train: 'Preparador físico', fans: 'Fama' };
  function msgHTML(m, fresh) {
    return '<div class="msg' + (m.r && !(fresh && fresh[m.id]) ? '' : ' unread') + '"><small>' + sp([esc(MSG_K[m.k] || 'Club'), 'T' + m.s + (m.ph === 'pick' ? '' : ' J' + Math.min(m.w, C().WEEKS))], 'v') + '</small><b>' + esc(m.t) + '</b><p>' + esc(m.x) + '</p></div>';
  }
  function renderInbox(c, fresh) {
    var l = (c.inbox || []).slice().reverse();
    return '<div class="card"><h3>Mensajes <span class="muted">(' + l.length + ')</span></h3>' + (l.length ? l.map(function (m) { return msgHTML(m, fresh); }).join('') : '<p class="muted">Sin mensajes.</p>') + '</div>';
  }
  function renderHonors(c) {
    var T = c.career, s = sub.honors, h = '';
    if (s === 'titles') {
      h = '<div class="card"><h3>Palmarés</h3>';
      h += c.trophies.length ? c.trophies.map(function (t) { return '<p><span class="tag ' + (t.kind === 'ascenso' ? 'g' : 'y') + '">' + (t.kind === 'liga' ? 'Campeón' : t.kind === 'copa' ? 'Open' : t.kind === 'premio' ? 'Premio' : 'Ascenso') + '</span> ' + sp([esc(t.name), 'T' + t.season, esc(t.club)], 'v') + '</p>'; }).join('') : '<p class="muted">Aún sin títulos.</p>';
      h += '<h3 style="margin-top:10px">Totales de la carrera</h3><p>' + sp([plural(T.played, 'partido', 'partidos') + ' (' + plural(T.won, 'ganado', 'ganados') + ', ' + plural(T.sim, 'simulado', 'simulados') + ((T.bench | 0) ? ', ' + (T.bench | 0) + ' en el banquillo' : '') + ')', plural(T.pts, 'punto', 'puntos'), T.kills + ' remates punto', plural(T.aces, 'ace', 'aces'), T.blocks + ' bloqueos', plural(T.assists, 'asistencia', 'asistencias')], 'v') + '</p></div>';
      return h;
    }
    if (s === 'seasons') {
      return '<div class="card"><h3>Temporadas</h3>' + (c.history.length ? '<table><thead><tr><th class="l">T</th><th class="l">Club</th><th>Pos.</th><th class="hide-s">Open</th><th>Nota</th><th>Media</th></tr></thead><tbody>' + c.history.map(function (r) {
        return '<tr><td class="l">' + r.season + '</td><td class="club">' + esc(r.clubName) + ' <span class="muted">(' + esc(C().league(r.lvl).short) + ')</span></td><td>' + ordn(r.pos) + (r.move > 0 ? ' ↑' : r.move < 0 ? ' ↓' : '') + '</td><td class="hide-s">' + esc(r.cup) + '</td><td>' + dec(r.nota) + '</td><td>' + r.ovr + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted">Tu primera temporada está en marcha.</p>') + '</div>';
    }
    // abandonar (doble confirmación, sin confirm())
    h += '<div class="card"><h3>Opciones</h3>';
    if (!confirmStep) h += '<button class="warn" data-act="quit1">Abandonar carrera</button>';
    else h += '<div class="confirm"><p><b>¿Seguro?</b> Se borra la carrera entera: jugador, insignias, temporadas y palmarés. No se puede deshacer.</p><div class="acts">' +
      '<button class="warn" data-act="quit2">' + (confirmStep === 2 ? (device() === 'touch' ? 'Toca otra vez para borrar' : 'Pulsa otra vez para borrar') : 'Sí, abandonar') + '</button><button data-act="quit0">Cancelar</button></div></div>';
    return h + '</div>';
  }
  function device() { return (VB.ctx && VB.ctx.inputDevice) || 'keyboard'; }

  // ---------------------------------------------------------------- elegir club (inicio sin club)
  /** Una pestaña por oferta (ficha completa) y «Comparar» (tabla). Debajo: pedir más tiempo / rechazar todas. */
  function renderPick(c) {
    var offs = c.offers || [];
    if (sub.pick !== 'cmp' && !(+sub.pick >= 0 && +sub.pick < offs.length)) sub.pick = 0;
    head.innerHTML = '<button data-act="close" aria-label="Volver a Jugar">‹ Jugar</button>' +
      '<div class="cr-title"><small>' + sp(['Carrera', 'Temporada 1', 'Ofertas'], 'd') + '</small><b>' + sp([esc(c.player.name), 'Elige club'], 's') + '</b></div>' +
      '<div class="cr-ovr">' + C().playerOvr(c) + '<small>TU MEDIA</small></div>';
    tabsEl.hidden = false;
    // una pestaña por oferta con el nombre del club (antes tres letras: «SAL · PRUEBA», «ARE»…) y «Comparar»
    drawBar('tab', offs.map(function (o, i) { var k = C().club(c, o.club); return [i, esc(k.name) + (o.trial ? ' (prueba)' : ''), false]; }).concat([['cmp', 'Comparar', false]]), sub.pick);
    subEl.hidden = true;
    var h = '';
    if (sub.pick === 'cmp') {
      h += '<div class="card"><h3>Comparar ofertas</h3><table><thead><tr><th class="l">Club</th><th class="hide-s">Liga</th><th>Media</th><th>Compañero</th><th class="hide-s">Rol</th><th class="hide-s">Objetivo</th><th>Sueldo</th><th class="hide-s">Años</th><th></th></tr></thead><tbody>' +
        offs.map(function (o, i) {
          var k = C().club(c, o.club), f = C().clubInfo(c, k);
          return '<tr><td class="club">' + kitSw(k.kit).replace('cr-kit', 'cr-kit kit-mini') + esc(k.name) + '<br><span class="muted">' + stars(f.stars) + '</span></td><td class="hide-s">' + esc(C().league(o.lvl).short) + (o.trial ? ' (prueba)' : '') + '</td><td>' + o.ovr + '</td><td>' + o.mate + (o.ovr != null && o.mate != null ? ' <span class="muted">(' + sgn(o.mate - o.ovr) + ')</span>' : '') +
            '</td><td class="hide-s">' + esc(o.role) + '</td><td class="hide-s l">' + esc(objShort(o.objective)) + '</td><td>' + Math.round(o.salary) + ' €/mes</td><td class="hide-s">' + (o.trial ? 1 : (yrs[o.club] || o.years || 1)) +
            '</td><td><button data-sub="' + i + '" aria-label="Ver ' + esc(k.name) + '">Ver</button></td></tr>';
        }).join('') + '</tbody></table><p class="muted">Sueldo ficticio, en euros al mes. Los años del contrato los eliges al firmar.</p></div>';
    } else if (offs.length) h += offerCard(c, offs[+sub.pick], +sub.pick, true);
    h += '<p class="note" role="status" aria-live="polite">' + esc(note) + '</p>';
    note = '';
    // lo último que te ha dicho tu agente (en esta fase no hay bandeja: antes se leía después de firmar, cuando ya no servía)
    var lm = (c.inbox || []).slice(-1)[0];
    if (lm) { h += '<div class="card">' + msgHTML(lm) + '</div>'; if (!lm.r && C().readMsg) C().readMsg(lm.id); }
    var armed = rejArm && performance.now() - rejArm < 3000;
    h += '<div class="card"><h3>¿Ninguna te convence?</h3><p class="muted">' + (c.pick.more ? 'Ya has pedido más tiempo.' : 'Si pides más tiempo, el club con menos interés retira su oferta y llama otro.') +
      ' Si rechazas todas, se pierden para siempre' + (offs.some(function (o) { return o.trial; }) ? ' (también la prueba ' + esc(deL(C().league(1))) + ')' : '') + ' y llegan otras de clubes más modestos ' + esc(deL(C().league(0))) + ', aunque con algo más de interés por ti.</p><div class="pick-acts">' + (c.pick.more ? '' : '<button data-act="more">Pedir más tiempo</button>') +
      '<button class="warn" data-act="reject">' + (armed ? (device() === 'touch' ? 'Toca otra vez para rechazarlas' : 'Pulsa otra vez para rechazarlas') : 'Rechazar todas') + '</button></div></div>';
    body.innerHTML = h;
  }

  // ---------------------------------------------------------------- crear
  function renderCreate(c) {
    var R = C().ROLES, st = C().genSt(C().START_OVR, form.role, null), P = VB.Prog;
    head.innerHTML = '<button data-act="' + (c ? 'hub' : 'close') + '" aria-label="Volver">‹ Volver</button><div class="cr-title"><small>' + sp(['Carrera', 'Vóley playa 2 contra 2'], 'd') + '</small><b>Crea tu jugador</b></div>';
    tabsEl.hidden = true; tabsEl.innerHTML = ''; subEl.hidden = true; subEl.innerHTML = '';
    var h = '<div class="cf">' + (!c && C().lost && C().lost() ? '<div class="card confirm"><p><b>Tu carrera guardada estaba dañada</b> y no se ha podido recuperar. Hay una copia aparte en este navegador (voley3d.career.bak).</p></div>' : '') +
      '<div class="card"><p>Vóley playa en la arena de Platja Llarga. Empiezas con una media de ' + C().START_OVR + ' y sin pareja: al crear tu jugador te llegan ofertas de clubes de playa del <b>' + esc(C().league(0).name) + '</b> y eliges tú. Juega (o simula) cada jornada, entrena, sube de nivel, desbloquea insignias y gánate ofertas de clubes mejores hasta el <b>' + esc(C().league(4).name) + '</b>. Controlas solo a tu jugador; a tu pareja la lleva la IA, y cada club te ofrece una distinta: mírala bien antes de firmar.</p></div>' +
      '<div class="cf-col"><div><label for="crName">Nombre</label><input id="crName" maxlength="18" autocomplete="off" spellcheck="false" placeholder="Tu nombre" value="' + esc(form.name) + '"></div>' +
      '<div><label>Dorsal</label><div class="stp"><button data-act="num" data-d="-1" aria-label="Dorsal anterior">−</button><b aria-live="polite">' + form.num + '</b><button data-act="num" data-d="1" aria-label="Dorsal siguiente">+</button></div></div>' +
      '<div><label>Rol</label><div class="roles" role="group" aria-label="Rol">' + ['atk', 'uni', 'cr'].map(function (k) {
        return '<button data-act="role" data-r="' + k + '" aria-pressed="' + (form.role === k) + '">' + esc(R[k].name) + '<small>' + esc(R[k].hint) + '</small></button>';
      }).join('') + '</div><div class="prev" style="margin-top:8px">' + C().KEYS.map(function (k) { return '<span>' + esc(P && P.LABEL ? P.LABEL[k] : k) + ' <b>' + st[k] + '</b></span>'; }).join('') + '</div></div></div>' +
      '<div class="cf-col"><div><label>Reglas de playa</label><p class="muted" style="margin:0">' + sp(['Sets a ' + C().PTS, 'el 3r a ' + C().PTS3], 'v') + '. Pista de 16 × 8, cambio de campo cada 7 puntos (5 en el tercero), el bloqueo cuenta como toque y la dejada va de nudillos. ' + C().WEEKS + ' jornadas a doble vuelta y el open de los 4 primeros.</p></div>' +
      (c ? '<div class="card confirm"><p>Ya tienes una carrera guardada. Para empezar otra, abandónala antes en Palmarés › Opciones.</p></div>' :
        '<div class="acts"><button class="pri" data-act="create">Crear y ver ofertas</button></div>') +
      '</div></div>';
    body.innerHTML = h;
  }

  // =================================================================== acciones
  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.closest('.tabs')) return;   // barras de pestañas: las lleva el componente (VB.UI.tabs → onChange de drawBar)
    var act = b.getAttribute('data-act'), t = b.getAttribute('data-tab'), sv = b.getAttribute('data-sub'), c = C() && C().get();
    if (t) { setTab(t, b.getAttribute('data-s')); snd('click'); return; }
    if (sv != null) { setSub(sv); snd('click'); return; }
    if (act && act.indexOf('lf-') === 0 && LUI()) {   // vida de la Carrera (career-life-ui.js)
      var lr = LUI().act(act, b);
      if (lr === 'retired') { snd('start'); form.name = ''; view = 'create'; tab = 'match'; render(); focusFirst(); syncMenu(); return; }
      if (lr) { snd('click'); keepFocus(b, render); syncMenu(); }
      return;
    }
    switch (act) {
      case 'close': snd('back'); close(); return;
      case 'hub': snd('back'); view = 'hub'; render(); focusFirst(); return;
      case 'num': form.num = ((form.num - 1 + (+b.getAttribute('data-d')) + 99) % 99) + 1; snd('select'); keepFocus(b, render); return;
      case 'role': form.role = b.getAttribute('data-r'); snd('select'); keepFocus(b, render); return;
      case 'create': {
        var inp = root.querySelector('#crName'); if (inp) form.name = inp.value;
        if (!String(form.name).trim()) { if (inp) { inp.focus(); inp.placeholder = 'Escribe un nombre'; } snd('back'); return; }
        C().create({ name: form.name, num: form.num, role: form.role });   // (playa: siempre a 21)
        yrs = {}; sub.pick = 0; note = '';
        snd('start'); view = 'hub'; tab = 'match'; render(); focusFirst(); syncMenu(); return;
      }
      // ---- gestión (v2)
      case 'yrs': yrs[b.getAttribute('data-key')] = +b.getAttribute('data-y'); snd('select'); keepFocus(b, render); return;
      case 'more': {
        var mr = C().moreTime(); if (!mr) { snd('back'); return; }
        var gk = C().club(c, mr.gone), ak = C().club(c, mr.added);
        note = gk.name + ' retira su oferta; llega la de ' + ak.name + '.';
        sub.pick = c.offers.findIndex(function (o) { return o.club === mr.added; }); snd('click'); render(); focusTab(); syncMenu(); return;
      }
      case 'reject':   // dos pulsaciones en 3 s (se pierden para siempre, también la prueba de la Nacional)
        if (!(rejArm && performance.now() - rejArm < 3000)) {
          rejArm = performance.now(); snd('click'); render(); focusSel('[data-act="reject"]');
          setTimeout(function () { if (rejArm && performance.now() - rejArm >= 2900) { rejArm = 0; if (open && pickView()) { render(); focusSel('[data-act="reject"]'); } } }, 3000);
          return;
        }
        rejArm = 0; C().rejectAll(); note = 'Han llegado ' + c.offers.length + ' ofertas nuevas.'; sub.pick = 0; snd('click'); render(); focusTab(); syncMenu(); return;
      case 'neg': {
        var ng = C().negotiate(+b.getAttribute('data-i')), oo = c.offers[+b.getAttribute('data-i')];
        note = ng === 'ok' ? 'Aceptan: firmarías como ' + oo.role.toLowerCase() + '.' : ng === 'no' ? 'No mejoran la oferta: la tomas como está o la dejas.' : '';
        snd(ng === 'ok' ? 'toggle' : 'back'); render(); focusSel('[data-act="offer"][data-i="' + b.getAttribute('data-i') + '"]'); syncMenu(); return;
      }
      case 'train': if (C().setTraining(b.getAttribute('data-t'))) snd('toggle'); keepFocus(b, render); return;
      case 'mate': {
        var cm = C().changeMate(+b.getAttribute('data-i'));
        note = cm === 'ok' ? 'Ahora juegas con ' + c.mate.name + '.' : cm === 'coach' ? 'El entrenador no te deja: gánate antes su confianza.' : '';
        snd(cm === 'ok' ? 'toggle' : 'back'); render(); focusSel('[data-act="mate"]'); syncMenu(); return;
      }
      case 'transfer': C().requestTransfer(b.getAttribute('data-on') === '1'); snd('click'); render(); focusSel('[data-act="transfer"]'); syncMenu(); return;
      case 'play': snd('start'); play(); return;
      case 'bench': {   // jornada sin ti (el entrenador te sienta): se simula y se enseña el resultado
        var bs = C().benchNext(c); if (!bs) return;
        snd('click'); freshLast = true; tab = 'match'; render(); syncMenu(); focusTab(); return;
      }
      case 'physio': {
        var ph = C().physio(), pc = C().physioCost(c);
        note = ph === 'ok' ? 'El fisio te deja como nuevo: fatiga −' + C().PHYSIO_FAT + ' (' + eur(pc) + ').' : ph === 'done' ? 'Ya has ido al fisio esta jornada.' : ph === 'none' ? 'No tienes fatiga.' : ph === 'money' ? 'No te llega: cuesta ' + eur(pc) + '.' : '';
        snd(ph === 'ok' ? 'toggle' : 'back'); keepFocus(b, render); return;
      }
      case 'sim': {
        var s = C().simulateNext(c); if (!s) return;
        // el foco se queda en «Simular» (antes saltaba a «Jugar partido» y un segundo Intro arrancaba un partido; al acabar la
        // temporada caía en «Seguir en…» y otro Intro rechazaba todas las ofertas). Si ya no hay «Simular»: la pestaña.
        snd('click'); freshLast = true; tab = 'match'; render(); syncMenu();
        var sb = root.querySelector('[data-act="sim"]');
        if (sb) focusEl(sb, kbNav); else focusTab();
        return;
      }
      case 'broken':
        if (confirmStep === 2 && performance.now() - armT < 3000) { confirmStep = 0; C().abandon(); snd('back'); form.name = ''; view = 'create'; render(); focusFirst(); syncMenu(); return; }
        confirmStep = 2; armT = performance.now(); snd('click'); render(); focusSel('[data-act="broken"]'); return;
      case 'stay':
        if (c && c.phase === 'off' && c.offers && c.offers.length && !(stayArm && performance.now() - stayArm < 3000)) {
          stayArm = performance.now(); snd('click'); render(); focusSel('[data-act="stay"]');
          setTimeout(function () { if (stayArm && performance.now() - stayArm >= 2900) { stayArm = 0; if (open) { render(); focusSel('[data-act="stay"]'); } } }, 3000);
          return;
        }
        stayArm = 0; C().stay(yrs.renew); yrs = {}; snd('click'); tab = 'match'; render(); focusFirst(); syncMenu(); return;
      case 'offer': {
        var oi = +b.getAttribute('data-i'), of = c.offers[oi]; if (!of) return;
        // a mitad de temporada, primero la confirmación (antes se fichaba con un solo toque)
        if (c.window === 'mid' && offArm !== oi) { offArm = oi; snd('click'); render(); focusSel('[data-act="offer"][data-i="' + oi + '"]'); return; }
        offArm = -1;
        var wasPick = c.phase === 'pick', okf = C().acceptOffer(oi, yrs[of.club]);
        if (okf) { yrs = {}; note = ''; snd('start'); tab = 'match'; render(); focusFirst(); syncMenu(); return; }
        if (wasPick && of.trial) { note = 'No has superado la prueba de ' + C().club(c, of.club).name + '. Te quedan las otras ofertas.'; sub.pick = 0; snd('back'); render(); focusTab(); syncMenu(); }
        return;
      }
      case 'offno': { var ai = offArm; offArm = -1; snd('back'); render(); focusSel('[data-act="offer"][data-i="' + ai + '"]'); return; }
      case 'lvl': tblLvl = +b.getAttribute('data-l'); snd('select'); keepFocus(b, render); return;
      case 'up': if (C().bump(b.getAttribute('data-k'))) { snd('click'); keepFocus(b, render); syncMenu(); } else snd('back'); return;
      case 'badge': {
        var bid = b.getAttribute('data-id'), r = C().toggleBadge(bid);
        if (!r && VB.Badges && c) {   // antes solo sonaba: ahora se explica por qué no se ha podido
          var bp = c.player;
          badgeMsg = !VB.Badges.level(bp, bid) ? 'Aún está bloqueada: ' + (VB.Badges.BY[bid] ? VB.Badges.BY[bid].cond.toLowerCase() : 'sigue jugando') + '.'
            : 'No quedan huecos libres: quita una equipada antes (tienes ' + VB.Badges.slots(bp) + '; uno más cada 5 niveles).';
        }
        snd(r ? 'toggle' : 'back'); keepFocus(b, render); return;
      }
      case 'quit1': confirmStep = 1; snd('click'); render(); focusSel('[data-act="quit0"]'); return;
      case 'quit0': confirmStep = 0; clearTimeout(armTo); snd('back'); render(); focusSel('[data-act="quit1"]'); return;
      case 'quit2':
        if (confirmStep === 2 && performance.now() - armT < 3000) {
          confirmStep = 0; C().abandon(); snd('back'); form.name = ''; view = 'create'; render(); focusFirst(); syncMenu(); return;
        }
        confirmStep = 2; armT = performance.now(); clearTimeout(armTo);
        armTo = setTimeout(function () { if (confirmStep === 2) { confirmStep = 1; if (open && tab === 'honors') render(); } }, 3000);
        snd('click'); render(); focusSel('[data-act="quit2"]'); return;
    }
  }
  function setTab(t, s) {
    tab = t; confirmStep = 0; offArm = -1; if (t !== 'league') tblLvl = -1;
    if (s && SUBS[t] && SUBS[t].some(function (x) { return x[0] === s; })) sub[t] = s;
    render(); var tb = tabsEl.querySelector('[data-tab="' + t + '"]'); if (tb) { focusEl(tb, kbNav); try { tb.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { } } body.scrollTop = 0;
  }
  /** Sub-pestaña del apartado actual (o la oferta al elegir club: un índice o 'cmp'). */
  function setSub(v) {
    var c = C() && C().get(), pk = c && c.phase === 'pick' && view !== 'create';
    if (pk) sub.pick = v === 'cmp' ? 'cmp' : +v;
    else if (SUBS[tab]) { sub[tab] = v; confirmStep = 0; offArm = -1; if (v !== 'table') tblLvl = -1; }
    render();
    var id = pk ? sub.pick : v, bar = pk ? tabsEl : subEl, sb = bar.querySelector('[data-sub="' + id + '"],[data-tab="' + id + '"]');
    if (sb) { focusEl(sb, kbNav); try { sb.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { } }
    body.scrollTop = 0;
  }
  /** ←/→ con el foco en una pestaña: la siguiente de su barra (apartados o sub-pestañas). Devuelve true si lo ha hecho. */
  function cycleTab(a, d) {
    if (!a || !a.getAttribute) return false;
    // componente común: la barra a la que pertenece la pestaña enfocada
    if (tabsApi && tabsEl.contains(a) && a.getAttribute('role') === 'tab') { tabsApi.step(d, 'key'); return true; }
    if (subApi && subEl.contains(a) && a.getAttribute('role') === 'tab') { subApi.step(d, 'key'); return true; }
    if (VB.UI && VB.UI.tabs) return false;   // (con el componente, un botón del contenido con data-tab no es una pestaña)
    var bar = a.parentNode, attr = a.getAttribute('data-tab') != null ? 'tab' : a.getAttribute('data-sub') != null && bar && bar.getAttribute('role') === 'tablist' ? 'sub' : '';
    if (!attr) return false;
    var l = bar.querySelectorAll('[data-' + attr + ']'), i = Array.prototype.indexOf.call(l, a), n = l[(i + d + l.length) % l.length];
    if (!n) return false;
    if (attr === 'tab') setTab(n.getAttribute('data-tab')); else setSub(n.getAttribute('data-sub'));
    return true;
  }
  function keepFocus(b, fn) {
    var sel = selectorOf(b); fn();
    var nb = sel ? root.querySelector(sel) : null;
    if (nb && !nb.disabled) focusEl(nb, kbNav); else focusFirst();
  }
  function selectorOf(b) {
    var attrs = ['data-act', 'data-k', 'data-id', 'data-r', 'data-p', 'data-c', 'data-l', 'data-d', 'data-i', 'data-tab', 'data-sub', 'data-t', 'data-y', 'data-key', 'data-on'], s = 'button';
    attrs.forEach(function (a) { var v = b.getAttribute(a); if (v != null) s += '[' + a + '="' + v + '"]'; });
    return s;
  }
  function focusSel(sel) { var b = root.querySelector(sel); if (b) focusEl(b, kbNav); }
  function play() {
    var go = function () { if (VB.ctx && VB.ctx.actions && VB.ctx.actions.startCareerMatch) VB.ctx.actions.startCareerMatch(); };
    close(true);
    var w = false; try { w = !!(VB.UI && VB.UI.wipe && VB.UI.wipe(2, go)); } catch (e) { w = false; }
    if (!w) go();
  }

  // =================================================================== foco y teclado/mando
  var kbNav = false;
  function focusables() {
    if (!root) return [];
    var all = root.querySelectorAll('button, input'), out = [];
    // (data-skip: pestañas no elegidas y pistas Q/E del componente; solo la pestaña elegida entra en ↑/↓, así ↓ baja al contenido)
    for (var i = 0; i < all.length; i++) { var n = all[i]; if (!n.disabled && !n.hasAttribute('data-skip') && !n.closest('[hidden]') && n.offsetParent !== null) out.push(n); }
    return out;
  }
  function focusEl(n, kb) {
    if (!n) return;
    var prev = root.querySelectorAll('.kf'); for (var i = 0; i < prev.length; i++) prev[i].classList.remove('kf');
    try { n.focus({ preventScroll: true }); } catch (e) { }
    if (kb) n.classList.add('kf');
    try { n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
  }
  function focusFirst() {
    setTimeout(function () {
      if (!open) return;
      // fin de temporada: el foco va a la pestaña (no a «Seguir en…», que rechaza todas las ofertas) y se ve la tarjeta del resumen
      var c = null; try { c = C() && C().get(); } catch (e) { c = null; }
      if (c && view === 'hub' && c.phase === 'off' && !root.querySelector('[data-act="play"]')) { focusTab(); return; }
      if (c && view === 'hub' && c.phase === 'pick') { focusTab(); return; }   // eligiendo club: la pestaña de la oferta (no «Firmar» de golpe)
      var pref = root.querySelector('[data-act="play"]') || root.querySelector('[data-act="stay"]') || root.querySelector('#crName') || root.querySelector('[data-act="create"]');
      if (!pref && view === 'hub') { focusTab(); return; }   // (p. ej. reabrir en Mensajes: la pestaña, no «‹ Jugar»)
      focusEl(pref || focusables()[0], kbNav);
    }, 60);
  }
  function focusTab() {
    var tb = tabsEl && !tabsEl.hidden ? (tabsEl.querySelector('[data-tab="' + tab + '"]') || tabsEl.querySelector('[aria-selected="true"]')) : null;
    if (tb) focusEl(tb, kbNav); else { var f = focusables()[0]; if (f) focusEl(f, kbNav); }
    body.scrollTop = 0;
  }
  function move(d) {
    var L = focusables(); if (!L.length) return;
    var i = L.indexOf(document.activeElement);
    i = i < 0 ? 0 : (i + d + L.length) % L.length;
    kbNav = true; focusEl(L[i], true);
    try { if (VB.Audio && VB.Audio.hover) VB.Audio.hover(); } catch (e) { }
  }
  function back() {
    if (confirmStep) { confirmStep = 0; render(); focusSel('[data-act="quit1"]'); snd('back'); return true; }
    var c = C() && C().get();
    if (view === 'create' && c) { view = 'hub'; render(); focusFirst(); snd('back'); return true; }
    snd('back'); close(); return true;
  }
  function onKey(e) {
    if (!open) return;
    var k = e.key, a = document.activeElement, inInput = a && a.tagName === 'INPUT';
    e.stopPropagation();   // ni ui.js (menú de detrás) ni input.js (M = silencio, P = pausa…) mientras está abierta
    if (k === 'Escape') { e.preventDefault(); back(); return; }
    if (k === 'Enter') {
      if (inInput) { e.preventDefault(); var cb = root.querySelector('[data-act="create"]'); if (cb) cb.click(); return; }
      if (a && a.tagName === 'BUTTON' && root.contains(a)) return;   // el navegador lo pulsa
      e.preventDefault(); focusFirst(); return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); move(k === 'ArrowDown' ? 1 : -1); return; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && !inInput) {
      e.preventDefault();
      var d = k === 'ArrowRight' ? 1 : -1;
      if (cycleTab(a, d)) return;
      move(d); return;
    }
    // como en Jugadores y Ajustes: Q/E cambian de apartado (o de oferta al elegir club) estés donde estés; RePág/AvPág, de
    // sub-pestaña (o de apartado si no hay). No mientras se escribe el nombre
    if (!inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var lvl = k === 'q' || k === 'Q' || k === 'e' || k === 'E' ? 'tab' : k === 'PageUp' || k === 'PageDown' ? 'sub' : '';
      var tb = lvl ? barApi(lvl) : null;
      if (tb) { e.preventDefault(); kbNav = true; tb.step(k === 'q' || k === 'Q' || k === 'PageUp' ? -1 : 1, 'key'); return; }
    }
    if (k === 'Tab') { kbNav = true; }
  }
  var rep = { y: 0, x: 0, ty: 0, tx: 0 };
  function axis(v, key, tkey, dt) {
    var dir = v > 0.55 ? 1 : v < -0.55 ? -1 : 0;
    if (dir !== rep[key]) { rep[key] = dir; rep[tkey] = 0.38; return dir; }
    if (!dir) return 0;
    rep[tkey] -= dt; if (rep[tkey] <= 0) { rep[tkey] = 0.14; return dir; }
    return 0;
  }
  /** Gatillos LT (−1) / RT (+1) del mando recién pulsados (botones 6/7 del mapeo estándar); 0 si nada nuevo. */
  var trigPrev = 0;
  function padTrig() {
    var d = 0;
    try {
      var ps = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]; if (!p || !p.buttons) continue;
        var l = p.buttons[6], r = p.buttons[7];
        if (l && (l.pressed || l.value > 0.5)) d = -1; else if (r && (r.pressed || r.value > 0.5)) d = 1;
        if (d) break;
      }
    } catch (e) { d = 0; }
    var edge = d && d !== trigPrev ? d : 0; trigPrev = d; return edge;
  }
  /** Mando (main.js la llama en vez de VB.UI.nav mientras la Carrera está abierta). */
  function nav(it, dt) {
    if (!open || !it) return;
    if (it.device !== 'gamepad') { rep.y = rep.x = 0; return; }
    kbNav = true;
    var dy = axis(it.my || 0, 'y', 'ty', dt || 0.016), dx = axis(it.mx || 0, 'x', 'tx', dt || 0.016);
    if (dy) move(-dy);
    if (dx) {
      var a = document.activeElement;
      if (!cycleTab(a, dx)) move(dx);
    }
    // LB/RB (o Y): apartado (como en los paneles de ui.js); LT/RT: sub-pestaña. Bordes de subida leídos aquí (input.js no los da)
    if (it.switchPlayer) { var tb = barApi('tab'); if (tb) tb.step(VB.UI && VB.UI.padTabDir ? VB.UI.padTabDir() : 1, 'pad'); }
    var tr = padTrig();
    if (tr) { var sb = barApi('sub'); if (sb) sb.step(tr, 'pad'); }
    if (it.hit || it.confirm) { var f = document.activeElement; if (f && root.contains(f) && f.tagName === 'BUTTON') f.click(); else focusFirst(); }
    else if (it.jump) back();
  }

  // =================================================================== abrir / cerrar
  function show(v) {
    build();
    var c = C() && C().get();
    view = v || (c ? 'hub' : 'create');
    if (view === 'hub' && !c) view = 'create';
    if (!open) lastFocus = document.activeElement;
    open = true; confirmStep = 0;
    var app = document.getElementById('app'); if (app) app.classList.add('cr-on');
    render(); syncMenu();
    root.hidden = false; root.classList.remove('in');
    requestAnimationFrame(function () { if (root) root.classList.add('in'); });
    focusFirst();
  }
  function close(toPlay) {
    if (!root || !open) return;
    open = false; root.hidden = true; root.classList.remove('in'); confirmStep = 0;
    var app = document.getElementById('app'); if (app) app.classList.remove('cr-on');
    var k = root.querySelectorAll('.kf'); for (var i = 0; i < k.length; i++) k[i].classList.remove('kf');
    syncMenu();
    if (!toPlay) { var b = document.getElementById('btnCareer'); setTimeout(function () { if (b && !open) { try { b.focus({ preventScroll: true }); } catch (e) { } if (kbNav) b.classList.add('kf'); } }, 40); }
  }
  /** Subtítulo de la fila «Carrera» del menú. */
  function syncMenu() { try { syncMenu0(); } catch (e) { } }
  function syncMenu0() {
    var s = document.getElementById('careerSub'); if (!s || !C()) return;
    var c = C().get(), t;
    // una pastilla con el dato suelto (temporada y jornada, ofertas) y detrás el texto: «T1 J3  Rocaverde — Castelnube»; sin
    // carrera, una frase corta como la de Partido rápido
    var chip = '';
    if (!c) t = C().lost && C().lost() ? 'Guardado dañado: crea otro jugador' : 'Vóley playa: crea tu jugador, elige club y ficha';
    else if (c.phase === 'pick') { chip = plural((c.offers || []).length, 'oferta', 'ofertas'); t = 'Elige club'; }
    else if (c.phase === 'off') { chip = 'T' + c.season; t = 'Fin de temporada, ofertas'; }
    else { var n = C().next(c); chip = 'T' + c.season + (n ? (n.kind === 'league' ? ' J' + (n.week + 1) : (n.round === 0 ? ' Semifinal' : ' Final')) : ''); t = n ? C().myClub(c).short + ' — ' + n.rival.short : C().myClub(c).name; }
    var h = (chip ? sp([chip], 'c') : '') + esc(t); if (s._crH !== h) { s._crH = h; s.innerHTML = h; }
  }
  /** El <style> de la Carrera, una vez (al cargar: también lleva la hoja final del partido de Carrera, #end.career). */
  function ensureCss() {
    if (styleEl) return;
    styleEl = document.createElement('style'); styleEl.id = 'careerCss'; styleEl.textContent = CSS;
    document.head ? document.head.appendChild(styleEl) : document.body.appendChild(styleEl);
  }
  function init() {
    ensureCss();
    var b = document.getElementById('btnCareer');
    if (b && !b._cr) { b._cr = 1; b.addEventListener('click', function () { snd('click'); kbNav = !!(b.classList.contains('kf')); show(); }); }
    syncMenu();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);

  VB.CareerUI = {
    /** Abre la Carrera ('hub' | 'create'; sin argumento: el hub si hay carrera, si no crear). opts.fresh = acaba de jugarse un partido. */
    open: function (v, opts) { if (opts && opts.fresh) { freshLast = true; tab = 'match'; } show(v); },
    close: function () { close(); },
    isOpen: function () { return open; },
    nav: nav,
    back: function () { return open ? back() : false; },
    render: function () { if (open) render(); },
    syncMenu: syncMenu,
    _state: function () { return { open: open, view: view, tab: tab, confirm: confirmStep }; },
    _tab: function (t) { if (open) setTab(t); }
  };
})();
