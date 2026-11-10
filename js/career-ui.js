/* MAKE THE CUT — js/career-ui.js (owner: ui_main)
 * Pantallas del modo Carrera (VB.CareerUI): crear carrera, hub (Partido · Clasificación · Calendario · Jugador · Club · Palmarés),
 * fin de temporada y ofertas. Crea su propio DOM (#career) y su propio <style> desde aquí para no chocar con index.html, con las
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
  var VB = window.VB = window.VB || {};
  var root = null, body = null, head = null, tabsEl = null, styleEl = null;
  var view = 'hub', tab = 'match', open = false, lastFocus = null, tblLvl = -1, armT = 0, armTo = 0, confirmStep = 0, freshLast = false;
  var form = { name: '', num: 1, role: 'atk', points: 15, ctrl: 'one' }, badgeMsg = '';
  var TABS = [['match', 'Partido'], ['table', 'Clasificación'], ['cal', 'Calendario'], ['player', 'Jugador'], ['club', 'Club'], ['honors', 'Palmarés']];
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
    '#career .cr-tabs::-webkit-scrollbar{display:none}',
    '#career .cr-tabs button{flex:none;font-size:16px;padding:0 14px}',
    '#career .cr-tabs button[aria-selected="true"]{background:linear-gradient(180deg,#ff8040 0 50%,#f65d1d 50% 100%)}',
    '#career .cr-tabs .dot{display:inline-block;width:9px;height:9px;margin-left:6px;border-radius:50%;background:#ffd23f;box-shadow:0 0 0 1.5px var(--tk);vertical-align:2px}',
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
    '#career .w{color:#4be0a0}#career .l{color:#ff7a8a}',
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
    '#career .prev{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px 10px;font:600 12.5px var(--ui);color:#cfc8f2}',
    '#career .prev span{display:flex;justify-content:space-between;gap:6px}',
    '#career .prev b{color:#fff}',
    '#career .confirm{margin-top:10px;padding:10px;border-radius:12px;background:rgba(168,40,58,.25);box-shadow:inset 0 0 0 2px #d8364a}',
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
    '}',
    '@media (max-width:700px){',
    ' #career .grid2,#career .cf{grid-template-columns:minmax(0,1fr)}',
    ' #career .roles{grid-template-columns:minmax(0,1fr)}',
    ' #career .roles button{min-height:56px}',
    ' #career .prev{grid-template-columns:repeat(2,minmax(0,1fr))}',
    ' #career td.hide-s,#career th.hide-s{display:none}',
    '}',
    '@media (prefers-reduced-motion:reduce){#career,#career *{transition:none!important;animation:none!important}}'
  ].join('\n');

  // =================================================================== construcción
  function build() {
    if (root) return;
    styleEl = document.createElement('style'); styleEl.id = 'careerCss'; styleEl.textContent = CSS;
    document.head ? document.head.appendChild(styleEl) : document.body.appendChild(styleEl);
    root = document.createElement('div'); root.id = 'career'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Carrera');
    root.innerHTML = '<div class="cr-in"><div class="cr-head"></div><div class="cr-tabs" role="tablist" aria-label="Secciones de la Carrera"></div><div class="cr-body"></div></div>';
    (document.getElementById('app') || document.body).appendChild(root);
    head = root.querySelector('.cr-head'); tabsEl = root.querySelector('.cr-tabs'); body = root.querySelector('.cr-body');
    root.addEventListener('click', onClick);
    root.addEventListener('input', function (e) { if (e.target && e.target.id === 'crName') form.name = e.target.value; });
    root.addEventListener('pointerdown', function () { var k = root.querySelectorAll('.kf'); for (var i = 0; i < k.length; i++) k[i].classList.remove('kf'); }, { passive: true });
    window.addEventListener('keydown', onKey, true);
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
    head.innerHTML = '<button data-act="close" aria-label="Volver al menú principal">‹ Menú</button><div class="cr-title"><small>Carrera</small><b>Guardado dañado</b></div>';
    tabsEl.hidden = true; tabsEl.innerHTML = '';
    body.innerHTML = '<div class="card"><h3>No se puede abrir la carrera</h3><p>La carrera guardada en este navegador está dañada y no se ha podido reparar.</p>' +
      '<p class="muted">Puedes borrarla y empezar otra.</p><div class="acts"><button class="warn" data-act="broken">' +
      (confirmStep === 2 ? (device() === 'touch' ? 'Toca otra vez para borrar' : 'Pulsa otra vez para borrar') : 'Borrar la carrera dañada') + '</button><button data-act="close">Volver al menú</button></div></div>';
  }
  function renderInner() {
    var c = C() && C().get();
    if (view === 'create' || !c) { renderCreate(c); return; }
    var k = C().myClub(c), L = C().league(k.lvl);
    head.innerHTML = '<button data-act="close" aria-label="Volver al menú principal">‹ Menú</button>' +
      '<div class="cr-title"><small>' + sp(['Carrera', 'Temporada ' + c.season, esc(L.name)], 'd') + '</small><b>' + sp([esc(c.player.name), esc(k.name)], 's') + '</b></div>' +
      '<div class="cr-ovr">' + C().playerOvr(c) + '<small>MEDIA</small></div>';
    var hasOff = (c.offers && c.offers.length) || c.phase === 'off';
    tabsEl.hidden = false;
    tabsEl.innerHTML = TABS.map(function (t) {
      var dot = (t[0] === 'player' && c.player.pts > 0) || (t[0] === 'club' && c.window === 'mid' && c.offers.length) || (t[0] === 'match' && c.phase === 'off');
      return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + (dot ? '<i class="dot" aria-hidden="true"></i>' : '') + '</button>';
    }).join('');
    void hasOff;
    var h = '';
    if (tab === 'match') h = renderMatch(c);
    else if (tab === 'table') h = renderTable(c);
    else if (tab === 'cal') h = renderCal(c);
    else if (tab === 'player') h = renderPlayer(c);
    else if (tab === 'club') h = renderClub(c);
    else h = renderHonors(c);
    body.innerHTML = h;
  }
  function teamBlock(c, club, right, extra) {
    return '<div class="team' + (right ? ' r' : '') + '">' + kitSw(club.kit, true) + '<span style="min-width:0"><b>' + esc(club.name) + '</b><small>' + extra + '</small></span></div>';
  }
  function lastCard(c) {
    var s = c.last; if (!s) return '';
    var rv = C().club(c, s.rival), sc = s.setScores.map(function (x) { return x[0] + '-' + x[1]; }).join(', ');
    var h = '<div class="card' + (freshLast ? ' new' : '') + '"><h3>' + sp(esc(s.label).split(' · '), 'd') + (s.sim ? ' <span class="tag">Simulado</span>' : '') + '</h3><div class="row">' +
      '<div class="nota ' + notaCls(s.nota) + '" aria-label="Nota ' + dec(s.nota) + '"><span>' + dec(s.nota) + '<small>NOTA</small></span></div>' +
      '<div class="grow"><p style="font:800 20px var(--display);text-transform:uppercase;letter-spacing:.04em;margin:0"><span class="' + (s.win ? 'w' : 'l') + '">' + (s.win ? 'Victoria' : 'Derrota') + ' ' + s.sets[0] + '-' + s.sets[1] + '</span> contra ' + esc(rv ? rv.name : s.rivalName) + '</p>' +
      '<p class="muted">' + sc + '</p>' +
      '<p>' + plural(s.me.kills + s.me.aces + s.me.blocks, 'punto', 'puntos') + ' (' + s.me.kills + ' de ataque, ' + s.me.blocks + ' de bloqueo, ' + plural(s.me.aces, 'ace', 'aces') + ')' + SV +
      sp([plural(s.me.assists, 'asistencia', 'asistencias'), plural(s.me.errors, 'error', 'errores')], 'v') + '</p></div></div>' +
      '<p><span class="tag y">+' + s.xp + ' XP</span>' + (s.lvlUp ? '<span class="tag g">¡Nivel ' + s.lvl + '! +' + s.ptsGained + ' puntos de mejora</span>' : '') + '</p>';
    if (s.badges && s.badges.length && VB.Badges) h += '<p>' + s.badges.map(function (u) { return '<span class="tag y">' + esc(VB.Badges.label(u)) + '</span>'; }).join('') + '</p>';
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
      // posiciones solo con la liga empezada (en la jornada 1 la tabla vacía daba «6.º» contra «3.º»)
      var pm = C().posOf(c, n.me.id), pr = C().posOf(c, n.rival.id), lg = c.phase === 'league' && c.week > 0;
      h += '<div class="card"><h3>' + sp(esc(n.label).split(' · '), 'd') + '</h3><div class="vs">' +
        teamBlock(c, n.me, false, sp([lg ? pm + '.º' : '', 'Media ' + n.ovrMe, n.atHome ? 'En casa' : 'Fuera'], 'c')) +
        '<div class="vs-mid">VS</div>' +
        teamBlock(c, n.rival, true, sp([lg ? pr + '.º' : '', 'Media ' + n.ovrRival, 'IA ' + esc(diffName(n.diff))], 'c')) + '</div>' +
        '<p class="muted" style="margin-top:8px">Al mejor de 3 sets a ' + c.points + ' puntos. Juegas con ' + esc(c.player.name) + ' (n.º ' + c.player.num + ')' +
        (c.ctrl === 'both' ? ' y llevas a los dos' : '') + '; tu compañero es ' + esc(c.mate.name) + ' (media ' + C().mateOvr(c) + ').</p>' +
        '<div class="acts"><button class="pri" data-act="play">Jugar partido</button><button data-act="sim">Simular <small style="font:600 12px var(--ui);text-transform:none;letter-spacing:0">(mitad de XP)</small></button></div></div>';
    }
    if (c.window === 'mid' && c.offers && c.offers.length) h += '<div class="card new"><h3>Ventana de fichajes</h3><p>' + plural(c.offers.length, 'club quiere', 'clubes quieren') + ' ficharte ya. Las ofertas caducan al jugar o simular el siguiente partido.</p><div class="acts"><button data-tab="club">Ver ofertas</button></div></div>';
    h += lastCard(c);
    if (!c.last) h += '<div class="card"><h3>Objetivo del club</h3><p>' + esc(c.objective.text) + '</p><p class="muted">El entrenador valora tus notas y los resultados. Al final de la temporada llegan ofertas de clubes mejores si juegas bien.</p></div>';
    freshLast = false;
    return h;
  }
  function renderSeasonEnd(c) {
    var r = c.review || {}, k = C().myClub(c), L = C().league(r.lvl != null ? r.lvl : k.lvl);
    var h = '<div class="card new"><h3>Fin de la temporada ' + r.season + '</h3>' +
      '<p style="font:900 24px var(--display);text-transform:uppercase;letter-spacing:.04em;margin:0">' + r.pos + '.º en la ' + esc(L.name) + '</p><p>' +
      (r.champion ? '<span class="tag y">Campeón de liga</span>' : '') + (r.cup ? '<span class="tag y">Campeón de la ' + esc(L.cup) + '</span>' : '') +
      (r.move > 0 ? '<span class="tag g">Ascenso</span>' : r.move < 0 ? '<span class="tag r">Descenso</span>' : '') +
      '<span class="tag ' + (r.objOk ? 'g' : 'r') + '">Objetivo ' + (r.objOk ? 'cumplido' : 'no cumplido') + '</span></p>' +
      '<p class="muted">' + sp(['Objetivo: ' + esc(r.objective), 'Nota media ' + dec(r.nota), 'Entrenador: ' + esc(C().coachText(c.coach))], 'v') + '</p></div>';
    h += '<div class="card"><h3>Ofertas</h3>' + offersHTML(c) + '<div class="acts"><button class="pri" data-act="stay">Seguir en ' + esc(k.name) + (r.move ? (r.move > 0 ? ' (sube)' : ' (baja)') : '') + '</button></div></div>';
    return h;
  }
  function offersHTML(c) {
    if (!c.offers || !c.offers.length) return '<p class="muted">Ningún club ha hecho una oferta. Mejora tu media y tus notas para llamar la atención.</p>';
    return c.offers.map(function (o, i) {
      var k = C().club(c, o.club), L = C().league(o.lvl != null ? o.lvl : k.lvl); // o.lvl: liga en la que jugarías (al final de temporada, la siguiente)
      return '<div class="offer">' + kitSw(k.kit) + '<div style="min-width:0"><b style="font:800 18px var(--display);text-transform:uppercase;letter-spacing:.03em">' + esc(k.name) + '</b>' +
        '<p class="muted" style="margin:2px 0 0">' + sp([esc(L.name), 'Media del club ' + (o.ovr != null ? o.ovr : C().clubOvr(k)), 'Compañero de media ~' + o.mate, esc(o.role), plural(o.years, 'temporada', 'temporadas')], 'c') + '</p></div>' +
        '<button data-act="offer" data-i="' + i + '">Fichar</button></div>';
    }).join('');
  }
  function renderTable(c) {
    var k = C().myClub(c), lvl = tblLvl >= 0 ? tblLvl : k.lvl, L = C().league(lvl), t = C().table(c, lvl), top = lvl === C().LEAGUES.length - 1, low = lvl === 0;
    var h = '<div class="card"><div class="lg-sw" role="group" aria-label="Liga">' + C().LEAGUES.map(function (x) {
      return '<button data-act="lvl" data-l="' + x.lvl + '" aria-pressed="' + (x.lvl === lvl) + '">' + esc(x.short) + '</button>';
    }).join('') + '</div><h3>' + sp([esc(L.name), c.phase === 'league' ? 'Jornada ' + Math.min(c.week, C().WEEKS) + ' de ' + C().WEEKS : 'Liga acabada'], 'd') + '</h3>' +
      '<table><thead><tr><th class="l">#</th><th class="l">Club</th><th>PJ</th><th>G</th><th>P</th><th class="hide-s">Sets</th><th class="hide-s">Puntos</th><th>Pts</th></tr></thead><tbody>';
    t.forEach(function (r) {
      var cl = C().club(c, r.id), cls = [];
      if (r.id === c.myClub) cls.push('me');
      if (!top && r.pos <= 2) cls.push('up'); else if (r.pos <= 4) cls.push('cup');
      if (!low && r.pos >= 7) cls.push('down');
      h += '<tr class="' + cls.join(' ') + '"><td class="l">' + r.pos + '</td><td class="club">' + kitSw(cl.kit).replace('cr-kit', 'cr-kit kit-mini') + esc(cl.name) + '</td><td>' + r.pj + '</td><td>' + r.g + '</td><td>' + r.p + '</td><td class="hide-s">' + r.sf + '-' + r.sc + '</td><td class="hide-s">' + r.pf + '-' + r.pc + '</td><td class="pts">' + r.pts + '</td></tr>';
    });
    h += '</tbody></table><p class="muted" style="margin-top:8px">' + (top ? '' : '<span class="tag g">1-2 ascienden</span>') + '<span class="tag y">1-4 juegan la copa</span>' + (low ? '' : '<span class="tag r">7-8 descienden</span>') +
      ' ' + sp(['Victoria 2-0 = 3 pts', '2-1 = 2 pts', 'derrota 1-2 = 1 pt'], 'v') + '</p></div>';
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
      var cu = c.cup, nm = function (id) { var x = C().club(c, id); return x ? esc(x.short) : '?'; }, line = function (m, r) { return nm(m[0]) + (r ? ' ' + r.s[0] + '-' + r.s[1] + ' ' : ' - ') + nm(m[1]); };
      h += '<h3 style="margin-top:12px">' + esc(C().league(cu.lvl).cup) + '</h3><p>Semifinales: ' + sp(cu.semis.map(function (m, j) { return line(m, cu.res[0] && cu.res[0][j]); }), 'v') + '</p>' +
        (cu.final ? '<p>Final: ' + line(cu.final, cu.res[1] && cu.res[1][0]) + (cu.champion >= 0 ? SV + 'Campeón: ' + nm(cu.champion) : '') + '</p>' : '');
    }
    return h + '</div>';
  }
  function renderPlayer(c) {
    var a = c.player, P = VB.Prog, need = C().need(a.lvl), h = '<div class="grid2"><div class="card"><h3>Tu jugador</h3><div class="row">' + kitSw(C().myClub(c).kit, true) +
      '<div class="grow"><p style="font:900 24px var(--display);text-transform:uppercase;margin:0">' + sp([esc(a.name), 'n.º ' + a.num], 's') + '</p><p class="muted">' + sp([esc(a.role), a.age + ' años', 'Nivel ' + a.lvl, plural(a.matches | 0, 'partido', 'partidos')], 'c') + '</p></div></div>' +
      '<div class="xp" role="progressbar" aria-valuemin="0" aria-valuemax="' + need + '" aria-valuenow="' + a.xp + '" aria-label="Experiencia"><i style="width:' + Math.round(100 * a.xp / need) + '%"></i></div>' +
      '<p class="muted">' + a.xp + ' / ' + need + ' XP para el nivel ' + (a.lvl + 1) + '</p><p style="font:800 16px var(--display);letter-spacing:.1em;text-transform:uppercase">Puntos de mejora: <b style="color:#ffd23f;font-size:20px">' + a.pts + '</b></p>';
    var groups = P && P.GROUPS ? P.GROUPS : [['Atributos', C().KEYS]];
    groups.forEach(function (g) {
      h += '<h3 style="margin-top:10px">' + esc(g[0]) + '</h3>';
      g[1].forEach(function (k) {
        var v = a.st[k], cost = C().cost(v), can = v < 99 && a.pts >= cost, lab = P && P.LABEL ? P.LABEL[k] : k;
        h += '<div class="attr" title="' + esc(P && P.HINT ? P.HINT[k] : '') + '"><span>' + esc(lab) + '</span><span class="bar"><i style="width:' + v + '%"></i></span><b>' + v + '</b>' +
          '<button data-act="up" data-k="' + k + '"' + (can ? '' : ' disabled') + ' aria-label="Mejorar ' + esc(lab) + ' (' + plural(cost, 'punto', 'puntos') + ')">' + (v >= 99 ? 'máx' : '+' + cost) + '</button></div>';
      });
    });
    h += '</div><div class="card"><h3>' + sp(['Insignias', VB.Badges ? (VB.Badges.equipped(a).length + ' de ' + VB.Badges.slots(a) + ' huecos') : 'no disponibles'], 'd') + '</h3>';
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
    h += '<h3 style="margin-top:12px">Tu compañero</h3><p>' + sp(['<b>' + esc(c.mate.name) + '</b>', 'n.º ' + c.mate.num, esc(c.mate.role), 'media ' + C().mateOvr(c)], 'v') + '</p></div></div>';
    return h;
  }
  function renderClub(c) {
    var k = C().myClub(c), L = C().league(k.lvl), coach = c.coach, cc = coach < 30 ? '#d8364a' : coach < 50 ? '#e07b2b' : coach < 70 ? '#d9a520' : '#2fbf71';
    var ref = C().REF[L.ref];
    var h = '<div class="grid2"><div class="card"><h3>Club</h3><div class="row">' + kitSw(k.kit, true) + '<div class="grow"><p style="font:900 24px var(--display);text-transform:uppercase;margin:0">' + esc(k.name) + '</p>' +
      '<p class="muted">' + sp([esc(k.city), esc(L.name), 'Media ' + C().clubOvr(k), C().posOf(c, k.id) + '.º'], 'c') + '</p></div></div>' +
      '<h3 style="margin-top:10px">Objetivo de la temporada</h3><p>' + esc(c.objective.text) + '</p>' +
      '<h3 style="margin-top:10px">' + sp(['Entrenador', esc(C().coachText(coach))], 'd') + '</h3><div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + coach + '" aria-label="Confianza del entrenador"><i style="width:' + coach + '%;background:' + cc + '"></i></div>' +
      '<p class="muted">' + sp(['Nota media de la temporada: ' + dec(C().avgNota(c)), 'Forma (3 últimos): ' + dec(C().form(c))], 'v') + '</p>' +
      '<h3 style="margin-top:10px">Arbitraje en esta liga</h3><p class="muted">' + sp(esc(ref.name).split(' · '), 'c') + '</p></div>';
    h += '<div class="card"><h3>' + (c.window === 'mid' ? 'Ventana de fichajes' : 'Ofertas') + '</h3>' +
      (c.window === 'mid' || c.phase === 'off' ? offersHTML(c) + (c.window === 'mid' && c.offers.length ? '<div class="acts"><button data-act="stay">Rechazar las ofertas</button></div>' : '')
        : '<p class="muted">Las ofertas llegan a mitad de temporada (tras la jornada ' + C().MID_WEEK + ', solo con una nota media de 7 o más) y al acabarla. Cuentan tu media, tu nota media, la confianza del entrenador y tus insignias.</p>') + '</div></div>';
    return h;
  }
  function renderHonors(c) {
    var T = c.career, h = '<div class="grid2"><div class="card"><h3>Palmarés</h3>';
    h += c.trophies.length ? c.trophies.map(function (t) { return '<p><span class="tag ' + (t.kind === 'ascenso' ? 'g' : 'y') + '">' + (t.kind === 'liga' ? 'Liga' : t.kind === 'copa' ? 'Copa' : 'Ascenso') + '</span> ' + sp([esc(t.name), 'T' + t.season, esc(t.club)], 'v') + '</p>'; }).join('') : '<p class="muted">Aún sin títulos.</p>';
    h += '<h3 style="margin-top:10px">Totales de la carrera</h3><p>' + sp([plural(T.played, 'partido', 'partidos') + ' (' + plural(T.won, 'ganado', 'ganados') + ', ' + plural(T.sim, 'simulado', 'simulados') + ')', plural(T.pts, 'punto', 'puntos'), T.kills + ' remates punto', plural(T.aces, 'ace', 'aces'), T.blocks + ' bloqueos', plural(T.assists, 'asistencia', 'asistencias')], 'v') + '</p></div>';
    h += '<div class="card"><h3>Temporadas</h3>' + (c.history.length ? '<table><thead><tr><th class="l">T</th><th class="l">Club</th><th>Pos.</th><th class="hide-s">Copa</th><th>Nota</th><th>Media</th></tr></thead><tbody>' + c.history.map(function (r) {
      return '<tr><td class="l">' + r.season + '</td><td class="club">' + esc(r.clubName) + ' <span class="muted">(' + esc(C().league(r.lvl).short) + ')</span></td><td>' + r.pos + '.º' + (r.move > 0 ? ' ↑' : r.move < 0 ? ' ↓' : '') + '</td><td class="hide-s">' + esc(r.cup) + '</td><td>' + dec(r.nota) + '</td><td>' + r.ovr + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="muted">Tu primera temporada está en marcha.</p>') + '</div></div>';
    // abandonar (doble confirmación, sin confirm())
    h += '<div class="card"><h3>Opciones</h3>';
    if (!confirmStep) h += '<button class="warn" data-act="quit1">Abandonar carrera</button>';
    else h += '<div class="confirm"><p><b>¿Seguro?</b> Se borra la carrera entera: jugador, insignias, temporadas y palmarés. No se puede deshacer.</p><div class="acts">' +
      '<button class="warn" data-act="quit2">' + (confirmStep === 2 ? (device() === 'touch' ? 'Toca otra vez para borrar' : 'Pulsa otra vez para borrar') : 'Sí, abandonar') + '</button><button data-act="quit0">Cancelar</button></div></div>';
    return h + '</div>';
  }
  function device() { return (VB.ctx && VB.ctx.inputDevice) || 'keyboard'; }

  // ---------------------------------------------------------------- crear
  function renderCreate(c) {
    var R = C().ROLES, st = C().genSt(C().START_OVR, form.role, null), P = VB.Prog;
    head.innerHTML = '<button data-act="' + (c ? 'hub' : 'close') + '" aria-label="Volver">‹ Volver</button><div class="cr-title"><small>' + sp(['Carrera', '2 contra 2'], 'd') + '</small><b>Crea tu jugador</b></div>';
    tabsEl.hidden = true; tabsEl.innerHTML = '';
    var h = '<div class="cf">' + (!c && C().lost && C().lost() ? '<div class="card confirm"><p><b>Tu carrera guardada estaba dañada</b> y no se ha podido recuperar. Hay una copia aparte en este navegador (voley3d.career.bak).</p></div>' : '') +
      '<div class="card"><p>Empiezas en un club modesto de la <b>Liga Regional</b> con una media de ' + C().START_OVR + '. Juega (o simula) cada jornada, sube de nivel, desbloquea insignias y gánate ofertas de clubes mejores hasta el <b>Circuito Mundial</b>.</p></div>' +
      '<div class="cf-col"><div><label for="crName">Nombre</label><input id="crName" maxlength="18" autocomplete="off" spellcheck="false" placeholder="Tu nombre" value="' + esc(form.name) + '"></div>' +
      '<div><label>Dorsal</label><div class="stp"><button data-act="num" data-d="-1" aria-label="Dorsal anterior">−</button><b aria-live="polite">' + form.num + '</b><button data-act="num" data-d="1" aria-label="Dorsal siguiente">+</button></div></div>' +
      '<div><label>Rol</label><div class="roles" role="group" aria-label="Rol">' + ['atk', 'uni', 'cr'].map(function (k) {
        return '<button data-act="role" data-r="' + k + '" aria-pressed="' + (form.role === k) + '">' + esc(R[k].name) + '<small>' + esc(R[k].hint) + '</small></button>';
      }).join('') + '</div><div class="prev" style="margin-top:8px">' + C().KEYS.map(function (k) { return '<span>' + esc(P && P.LABEL ? P.LABEL[k] : k) + ' <b>' + st[k] + '</b></span>'; }).join('') + '</div></div></div>' +
      '<div class="cf-col"><div><label>Puntos por set</label><div class="seg" role="group" aria-label="Puntos por set">' + C().POINTS.map(function (p) {
        return '<button data-act="pts" data-p="' + p + '" aria-pressed="' + (form.points === p) + '">' + p + '</button>';
      }).join('') + '</div><p class="muted">Desempate a ' + Math.min(15, form.points) + '. A 15 la temporada no se hace eterna (14 jornadas + copa).</p></div>' +
      '<div><label>Controlar</label><div class="seg" role="group" aria-label="Controlar"><button data-act="ctrl" data-c="both" title="Controlar a los dos jugadores" aria-pressed="' + (form.ctrl === 'both') + '">A los dos jugadores</button><button data-act="ctrl" data-c="one" title="Controlar un jugador (el tuyo; la IA lleva al compañero)" aria-pressed="' + (form.ctrl === 'one') + '">Un jugador</button></div></div>' +
      (c ? '<div class="card confirm"><p>Ya tienes una carrera guardada. Para empezar otra, abandónala antes en Palmarés › Opciones.</p></div>' :
        '<div class="acts"><button class="pri" data-act="create">Empezar carrera</button></div>') +
      '</div></div>';
    body.innerHTML = h;
  }

  // =================================================================== acciones
  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b || !root.contains(b) || b.disabled) return;
    var act = b.getAttribute('data-act'), t = b.getAttribute('data-tab'), c = C() && C().get();
    if (t) { setTab(t); snd('click'); return; }
    switch (act) {
      case 'close': snd('back'); close(); return;
      case 'hub': snd('back'); view = 'hub'; render(); focusFirst(); return;
      case 'num': form.num = ((form.num - 1 + (+b.getAttribute('data-d')) + 99) % 99) + 1; snd('select'); keepFocus(b, render); return;
      case 'role': form.role = b.getAttribute('data-r'); snd('select'); keepFocus(b, render); return;
      case 'pts': form.points = +b.getAttribute('data-p'); snd('select'); keepFocus(b, render); return;
      case 'ctrl': form.ctrl = b.getAttribute('data-c'); snd('select'); keepFocus(b, render); return;
      case 'create': {
        var inp = root.querySelector('#crName'); if (inp) form.name = inp.value;
        if (!String(form.name).trim()) { if (inp) { inp.focus(); inp.placeholder = 'Escribe un nombre'; } snd('back'); return; }
        C().create({ name: form.name, num: form.num, role: form.role, points: form.points, ctrl: form.ctrl });
        snd('start'); view = 'hub'; tab = 'match'; render(); focusFirst(); syncMenu(); return;
      }
      case 'play': snd('start'); play(); return;
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
      case 'stay': C().stay(); snd('click'); tab = 'match'; render(); focusFirst(); syncMenu(); return;
      case 'offer': if (C().acceptOffer(+b.getAttribute('data-i'))) { snd('start'); tab = 'match'; render(); focusFirst(); syncMenu(); } return;
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
  function setTab(t) { tab = t; confirmStep = 0; if (t !== 'table') tblLvl = -1; render(); var tb = tabsEl.querySelector('[data-tab="' + t + '"]'); if (tb) { focusEl(tb, kbNav); try { tb.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { } } body.scrollTop = 0; }
  function keepFocus(b, fn) {
    var sel = selectorOf(b); fn();
    var nb = sel ? root.querySelector(sel) : null;
    if (nb && !nb.disabled) focusEl(nb, kbNav); else focusFirst();
  }
  function selectorOf(b) {
    var attrs = ['data-act', 'data-k', 'data-id', 'data-r', 'data-p', 'data-c', 'data-l', 'data-d', 'data-i', 'data-tab'], s = 'button';
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
    for (var i = 0; i < all.length; i++) { var n = all[i]; if (!n.disabled && !n.closest('[hidden]') && n.offsetParent !== null) out.push(n); }
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
      var pref = root.querySelector('[data-act="play"]') || root.querySelector('[data-act="stay"]') || root.querySelector('#crName') || root.querySelector('[data-act="create"]') || focusables()[0];
      focusEl(pref, kbNav);
    }, 60);
  }
  function focusTab() {
    var tb = tabsEl && !tabsEl.hidden ? tabsEl.querySelector('[data-tab="' + tab + '"]') : null;
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
      if (a && a.getAttribute && a.getAttribute('data-tab')) { var i = TABS.map(function (t) { return t[0]; }).indexOf(a.getAttribute('data-tab')); setTab(TABS[(i + d + TABS.length) % TABS.length][0]); return; }
      move(d); return;
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
  /** Mando (main.js la llama en vez de VB.UI.nav mientras la Carrera está abierta). */
  function nav(it, dt) {
    if (!open || !it) return;
    if (it.device !== 'gamepad') { rep.y = rep.x = 0; return; }
    kbNav = true;
    var dy = axis(it.my || 0, 'y', 'ty', dt || 0.016), dx = axis(it.mx || 0, 'x', 'tx', dt || 0.016);
    if (dy) move(-dy);
    if (dx) {
      var a = document.activeElement;
      if (a && a.getAttribute && a.getAttribute('data-tab')) { var i = TABS.map(function (t) { return t[0]; }).indexOf(a.getAttribute('data-tab')); setTab(TABS[(i + dx + TABS.length) % TABS.length][0]); }
      else move(dx);
    }
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
    // pastillas en la fila del menú (como JUGAR y Jugadores): trozos con « · » aquí, dibujados por VB.UI.sep
    if (!c) t = C().lost && C().lost() ? 'Guardado dañado · Crea otro jugador' : 'Crea tu jugador · Liga y ofertas';
    else if (c.phase === 'off') t = 'T' + c.season + ' · Fin de temporada · Ofertas';
    else { var n = C().next(c); t = 'T' + c.season + ' · ' + (n ? (n.kind === 'league' ? 'Jornada ' + (n.week + 1) : (n.round === 0 ? 'Semifinal' : 'Final')) + ' · ' + C().myClub(c).short + ' – ' + n.rival.short : C().myClub(c).name); }
    var h = sp(esc(t).split(' · '), 'c'); if (s._crH !== h) { s._crH = h; s.innerHTML = h; }
  }
  function init() {
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
