/* MAKE THE CUT — js/career-world-ui.js (owner: ui_main)
 * Pantallas del «mundo» de la Carrera (VB.CareerWorldUI, sprint 5), dentro del hub de career-ui.js:
 *  - Partido: tarjeta de Faro, el mentor (.cw-mentor), arriba del todo: retrato SVG, una frase por pantalla, «Seguir»/«Vale» y
 *    «Saltar» (o el botón de la escena en la última frase).
 *  - Palmarés › Opciones: «Escenas del mentor: Sí | No».
 *  - Partido, tras el último resultado: «Titulares» (2 noticias) si hay alguna sin ver (headlines).
 *  - Liga › Noticias (newsHTML) y Liga › Clubes (clubsHTML: lista de una liga o la ficha del club elegido, con «‹ Clubes»).
 * Solo devuelve HTML; las acciones (data-act="cw-…") las atiende career-ui.js (onClick → act). Datos: career-world.js.
 * Mismo contrato que CareerLifeUI: recibe HLP con esc/sp (y kitSw).
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  function W() { return VB.CareerWorld; }
  function C() { return VB.Career; }
  var H = null, li = 0, liKey = '', sel = null, lastSel = null;
  function esc(s) { return H ? H.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }); }
  function sp(a, k) { return H.sp(a, k); }

  // Retrato de Faro (SVG inline, sin red): cabeza redonda, gorra con visera, gafas de sol subidas y silbato. Trazo --tk, acento turquesa.
  var FACE = '<svg class="cw-face" viewBox="0 0 56 56" aria-hidden="true" focusable="false">' +
    '<circle cx="28" cy="28" r="27" fill="#2ec4b6" stroke="var(--tk,#1d1530)" stroke-width="2.5"/>' +
    '<circle cx="28" cy="32" r="15" fill="#e8b48a" stroke="var(--tk,#1d1530)" stroke-width="2.5"/>' +
    '<path d="M12 25c1-9 8-14 16-14s15 5 16 14z" fill="#f7f2ea" stroke="var(--tk,#1d1530)" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<path d="M26 25h22c0 3-3 4-6 4H28z" fill="#1d8a80" stroke="var(--tk,#1d1530)" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<rect x="17" y="18" width="8" height="5" rx="2.5" fill="#1d1530"/><rect x="27" y="18" width="8" height="5" rx="2.5" fill="#1d1530"/>' +
    '<path d="M25 20.5h2" stroke="#1d1530" stroke-width="2"/>' +
    '<circle cx="23" cy="33" r="1.8" fill="#1d1530"/><circle cx="33" cy="33" r="1.8" fill="#1d1530"/>' +
    '<path d="M23 39c3 2.5 7 2.5 10 0" fill="none" stroke="#1d1530" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M20 46l8 4 8-4" fill="none" stroke="#ffd23f" stroke-width="2"/><rect x="25" y="48" width="7" height="5" rx="1.5" fill="#ffd23f" stroke="var(--tk,#1d1530)" stroke-width="1.5"/>' +
    '</svg>';
  var CSS = [
    '#career .cw-mentor{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;align-items:start;',
    ' background:linear-gradient(135deg,rgba(46,196,182,.22),rgba(123,63,209,.16));box-shadow:0 0 0 2.5px var(--tk),4px 5px 0 var(--tk),inset 0 0 0 2px rgba(46,196,182,.6)}',
    '#career .cw-face{width:56px;height:56px;flex:none;display:block}',
    '#career .cw-who{display:block;font:800 11.5px var(--display);letter-spacing:.22em;text-transform:uppercase;color:#7fe6dc;text-shadow:var(--ring1)}',
    '#career .cw-mentor h3{margin:1px 0 2px;display:flex;gap:8px;align-items:baseline}',
    '#career .cw-n{font:700 12px var(--ui);color:var(--soft,#cfc8f2);letter-spacing:0;text-transform:none}',
    '#career .cw-line{font:600 15.5px/1.32 var(--ui);margin:2px 0 0}',
    '#career .cw-mentor .acts{grid-column:1/-1;margin:6px 0 0}',
    // teléfono apaisado: retrato de 40 px, botones a la derecha y la tarjeta ≤ 120 px, para que «Jugar partido» siga a la vista
    '@media (max-height:420px){',
    ' #career .cw-mentor{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:2px 10px;padding:6px 10px;max-height:120px;overflow:hidden}',
    ' #career .cw-face{width:40px;height:40px}',
    ' #career .cw-mentor h3{font-size:15px;margin:0}',
    ' #career .cw-who{display:none}',
    ' #career .cw-line{font-size:13.5px;line-height:1.25;margin:1px 0 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    ' #career .cw-mentor .acts{grid-column:3;grid-row:1;margin:0;display:flex;flex-wrap:nowrap;gap:8px}',
    ' #career .cw-mentor .acts button{flex:none;min-height:44px;min-width:84px;padding:0 12px;font-size:15px}',
    '}',
    '.is-touch #career .cw-mentor .acts button{min-height:44px}',
    '#career .cw-opt{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 0}',
    '#career .cw-opt b{font:800 15.5px var(--display);letter-spacing:.03em;text-transform:uppercase;margin-right:auto}',
    // noticias y clubes (C2): filas-botón planas (no los botones gordos del hub)
    '#career .cw-list{display:grid;gap:6px}',
    '#career button.cw-nb,#career div.cw-nb,#career button.cw-row{display:block;width:100%;text-align:left;min-height:44px;padding:7px 10px;border-radius:10px;background:rgba(0,0,0,.2);box-shadow:none;text-shadow:none;text-transform:none;letter-spacing:0;font:600 14.5px/1.3 var(--ui);color:#fff}',
    '#career button.cw-nb:hover,#career button.cw-row:hover{background:rgba(255,255,255,.08)}',
    '#career .cw-nb small{display:flex;gap:8px;align-items:center;font:800 11px var(--display);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}',
    '#career .cw-nb b{display:block;font:700 14.5px/1.3 var(--ui)}',
    '#career .cw-nb.me{background:rgba(255,210,63,.13);box-shadow:inset 3px 0 0 var(--gold)}',
    '#career .cw-nb.rv{background:rgba(255,90,110,.12);box-shadow:inset 3px 0 0 #ff7a8a}',
    '#career .cw-nb.fresh small::after{content:"";width:8px;height:8px;border-radius:50%;background:#ff8040;box-shadow:0 0 0 1.5px var(--tk)}',
    '#career .cw-mk{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:999px;font:800 10.5px var(--display);letter-spacing:.1em;text-transform:uppercase;background:var(--gold);color:var(--tk);vertical-align:.1em}',
    '#career .cw-mk.rv{background:#ff7a8a}#career .cw-nb small .cw-mk{background:#ff7a8a;margin-left:0}',
    '#career button.cw-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 8px;align-items:center}',
    '#career .cw-row.me{box-shadow:inset 3px 0 0 var(--gold)}#career .cw-row.rv{box-shadow:inset 3px 0 0 #ff7a8a}',
    '#career .cw-row .kit-mini{margin-right:0}',
    '#career .cw-rn{min-width:0}#career .cw-rn b{font:800 15px var(--ui)}',
    '#career .cw-rn small{display:block;margin-top:3px}',
    '#career .cw-go{font:900 20px var(--display);color:var(--muted)}',
    '#career button.cw-back{min-height:44px;font-size:14px;padding:0 12px}',
    '#career .cw-kick{display:block;font:800 11.5px var(--display);letter-spacing:.2em;text-transform:uppercase;color:var(--gold);text-shadow:var(--ring1)}',
    '#career .cw-nick{margin:3px 0 0;font:700 14px var(--ui);color:var(--soft,#cfc8f2)}#career .cw-nick i{font-weight:600}',
    '#career .cw-big{font:900 22px var(--display);letter-spacing:.03em;margin:0}',
    '#career .cw-form{display:flex;gap:6px;align-items:center;margin:8px 0 0}#career .cw-form i{width:14px;height:14px;border-radius:50%;box-shadow:0 0 0 1.5px var(--tk)}',
    '#career .cw-form i.w{background:#4be0a0}#career .cw-form i.l{background:#ff7a8a}#career .cw-form small{margin-left:4px;color:var(--muted);font:600 12.5px var(--ui)}',
    '#career .cw-tl{list-style:none;margin:0 0 6px;padding:0;display:grid;gap:4px}#career .cw-tl li{font:600 14.5px var(--ui)}',
    '#career .cw-head .cw-list{margin-bottom:8px}',
    '#career .cw-nb:focus-visible,#career .cw-nb.kf,#career .cw-row:focus-visible,#career .cw-row.kf{box-shadow:inset 0 0 0 2.5px #ffb238}'
  ].join('\n');
  function css() { if (typeof document === 'undefined' || document.getElementById('careerWorldCss')) return; var s = document.createElement('style'); s.id = 'careerWorldCss'; s.textContent = CSS; document.head.appendChild(s); }

  // ---------------------------------------------------------------- Partido: escena de Faro
  /** Tarjeta del mentor (o '' si no hay escena o están apagadas). La frase actual vive aquí (li); solo «Vale» llama a mentorDone. */
  function mentorCard(c, h0) {
    H = h0; css();
    var sc = W() && W().mentorScene ? W().mentorScene(c) : null; if (!sc || !sc.lines.length) { li = 0; liKey = ''; return ''; }
    var key = sc.id + ':' + (c.world.mentor.q[0].s | 0);
    if (key !== liKey) { liKey = key; li = 0; }
    if (li >= sc.lines.length) li = sc.lines.length - 1;
    var last = li === sc.lines.length - 1, n = sc.lines.length, go = last && sc.act ? sc.act.split(':') : null;
    return '<div class="card cw-mentor" role="region" aria-label="Faro, tu mentor">' + FACE +
      '<div><small class="cw-who">' + sp([esc(sc.who.nick), esc(sc.who.role)], 'd') + '</small>' +
      '<h3>' + esc(sc.title) + (n > 1 ? ' <span class="cw-n">' + (li + 1) + '/' + n + '</span>' : '') + '</h3>' +
      '<p class="cw-line" aria-live="polite">' + esc(sc.lines[li]) + '</p></div>' +
      '<div class="acts"><button class="pri" data-act="cw-next">' + (last ? 'Vale' : 'Seguir') + '</button>' +
      (go ? '<button data-act="cw-go" data-tab-go="' + esc(go[0]) + '" data-s-go="' + esc(go[1] || '') + '">' + esc(sc.actLabel || 'Ver') + '</button>'
        : last ? '' : '<button data-act="cw-skip">Saltar</button>') + '</div></div>';
  }

  // ---------------------------------------------------------------- Palmarés › Opciones
  function optsHTML(c, h0) {
    H = h0; css(); if (!W()) return '';
    var on = W().mentorOn ? W().mentorOn(c) : true;
    return '<div class="cw-opt" role="group" aria-label="Escenas del mentor"><b>Escenas del mentor</b>' +
      '<button data-act="cw-mentor-on" aria-pressed="' + on + '">Sí</button><button data-act="cw-mentor-off" aria-pressed="' + !on + '">No</button></div>' +
      '<p class="muted" style="margin:4px 0 8px">' + (on ? 'Faro sale en Partido en los momentos clave. Lo que saltes queda en Mensajes.' : 'Faro no sale en pantalla: sus consejos llegan a Mensajes.') + '</p>';
  }

  // ---------------------------------------------------------------- E5 (tarea C2): noticias y clubes
  function ordn(n) { return n + (n === 1 || n === 3 ? 'r' : 'º'); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function stars(n) { var s = ''; for (var i = 0; i < 5; i++) s += i < n ? '★' : '<span class="off">★</span>'; return '<span class="stars" aria-label="Prestigio ' + n + ' de 5">' + s + '</span>'; }
  function kitMini(k) { return H && H.kitSw && k ? H.kitSw(k).replace('cr-kit', 'cr-kit kit-mini') : ''; }
  /** Una noticia: botón que abre la ficha de su primer club (si existe) o texto suelto. fresh: sin ver hasta este pintado. */
  function newsItem(c, x, fresh) {
    var id = x.c && x.c.length ? x.c[0] : -1, k = id >= 0 ? C().club(c, id) : null;
    var cls = 'cw-nb' + (x.me === 1 ? ' me' : x.me === 2 ? ' rv' : '') + (fresh ? ' fresh' : '');
    var inner = '<small>' + esc(W().newsWhen(x)) + (x.me === 2 && /^rival/.test(x.k) ? '<span class="cw-mk">Tu rival</span>' : '') + '</small><b>' + esc(x.t) + '</b>';
    return k ? '<button class="' + cls + '" data-act="cw-club" data-id="' + k.id + '" aria-label="' + esc(x.t) + '. Ver la ficha de ' + esc(k.name) + '">' + inner + '</button>'
      : '<div class="' + cls + '">' + inner + '</div>';
  }
  /** Partido, tras el último resultado: las 2 últimas noticias, solo si hay alguna sin ver. */
  function headlines(c, h0) {
    H = h0; css(); var w = W(); if (!w || !w.news || !c) return '';
    var un = w.newsUnseen(c); if (!(un > 0)) return '';
    var l = w.news(c, 2), s0 = c.world ? c.world.newsSeen | 0 : 0;
    return '<div class="card cw-head"><h3>' + sp(['Titulares', plural(un, 'nueva', 'nuevas')], 'v') + '</h3><div class="cw-list">' + l.map(function (x) { return newsItem(c, x, x.id > s0); }).join('') + '</div>' +
      '<div class="acts"><button data-tab="league" data-s="news">Ver noticias</button></div></div>';
  }
  /** Liga › Noticias (de la más nueva a la más vieja). seen0 = newsSeen de antes de marcarlas: resalta las que eran nuevas. */
  function newsHTML(c, h0, seen0) {
    H = h0; css(); var w = W(); if (!w || !c) return '';
    var l = w.news(c), s0 = seen0 != null ? seen0 | 0 : (c.world ? c.world.newsSeen | 0 : 0), me = C().myClub(c);
    if (!l.length) return '<div class="card"><h3>Noticias</h3><p class="muted">Aún no hay noticias. Llegan al cerrar cada jornada: resultados, rachas, líderes y tu rival.</p></div>';
    return '<div class="card"><h3>' + sp(['Noticias', me ? esc(C().league(me.lvl).name) : ''], 'd') + '</h3><div class="cw-list">' + l.map(function (x) { return newsItem(c, x, x.id > s0); }).join('') + '</div>' +
      '<p class="muted" style="margin-top:8px">Toca una noticia para ver la ficha del club. Se guardan las ' + (w.NEWS_MAX || 60) + ' últimas.</p></div>';
  }
  function lgSw(lvl) {
    return '<div class="lg-sw" role="group" aria-label="Liga">' + C().LEAGUES.map(function (x) {
      return '<button data-act="lvl" data-l="' + x.lvl + '" aria-pressed="' + (x.lvl === lvl) + '">' + esc(x.short) + '</button>';
    }).join('') + '</div>';
  }
  /** Liga › Clubes: la lista de una liga (selector compartido con Clasificación) o, con un club elegido, su ficha. */
  function clubsHTML(c, lvl, h0) {
    H = h0; css(); var w = W(); if (!w || !c) return '';
    if (sel != null) { var card = w.clubCard(c, sel); if (card) return cardHTML(c, card); sel = null; }
    var L = C().league(lvl), rows = w.clubRows(c, lvl);
    return '<div class="card">' + lgSw(lvl) + '<h3>' + sp([esc(L.name), plural(rows.length, 'club', 'clubes')], 'd') + '</h3><div class="cw-list">' + rows.map(function (r) {
      var vs = r.vs ? { h: 'Tú ' + r.vs.g + '-' + r.vs.p, c: 'dv' + (r.vs.g > r.vs.p ? ' g' : r.vs.g < r.vs.p ? ' r' : '') } : '';
      var mk = r.mine ? '<span class="cw-mk">Tu club</span>' : r.rival ? '<span class="cw-mk rv">Tu rival juega aquí</span>' : '';
      return '<button class="cw-row' + (r.mine ? ' me' : r.rival ? ' rv' : '') + '" data-act="cw-club" data-id="' + r.id + '">' + kitMini(r.kit) +
        '<span class="cw-rn"><b>' + esc(r.name) + '</b>' + mk + '<small>' + sp([r.pj ? ordn(r.pos) : '', 'Media ' + r.ovr, { h: stars(r.stars) }, vs], 'c') + '</small></span><span class="cw-go" aria-hidden="true">›</span></button>';
    }).join('') + '</div></div>';
  }
  var KIND_T = { liga: 'Liga', copa: 'Open', ascenso: 'Ascenso' };
  function cardHTML(c, k) {
    var lo = k.lore || {}, h = '';
    // 1) cabecera
    h += '<div class="card cw-card"><button class="cw-back" data-act="cw-list">‹ Clubes</button><div class="row" style="margin-top:8px">' + (H.kitSw ? H.kitSw(k.kit, true) : '') +
      '<div class="grow" style="min-width:0"><small class="cw-kick">' + sp([esc(k.league), 'Fundado en ' + lo.founded], 'd') + '</small><p class="bigname" style="font-size:21px">' + esc(k.name) + '</p>' +
      '<p class="cw-nick">' + esc(lo.nick) + ' <i>«' + esc(lo.motto) + '»</i></p></div></div>' +
      '<p class="muted" style="margin-top:6px">' + sp([{ h: stars(k.stars) }, 'Media ' + k.ovr, esc(k.style), esc(k.beach || k.city)], 'c') + '</p>' +
      (k.mine ? '<p><span class="tag g">Tu club</span></p>' : k.rival ? '<p><span class="tag r">Aquí juega tu rival</span></p>' : '') + '</div>';
    // 2) esta temporada
    h += '<div class="card"><h3>Esta temporada</h3>' + (k.pj ? '<p class="cw-big">' + sp([ordn(k.pos), plural(k.pts, 'punto', 'puntos')], 'd') + '</p>' : '<p class="muted">Aún sin jugar en ' + esc(k.league) + '.</p>') +
      (k.form.length ? '<p class="cw-form" aria-label="Últimos ' + k.form.length + ': ' + k.form.map(function (f) { return f ? 'victoria' : 'derrota'; }).join(', ') + '">' + k.form.map(function (f) { return '<i class="' + (f ? 'w' : 'l') + '"></i>'; }).join('') + '<small>Últimos ' + k.form.length + '</small></p>' : '') + '</div>';
    // 3) palmarés: el de tu carrera (anales y tus trofeos «contigo») y lo de antes, inventado
    var old = [lo.oldLg ? plural(lo.oldLg, 'título', 'títulos') : '', lo.oldCup ? plural(lo.oldCup, 'open', 'opens') : ''].filter(function (x) { return x; });
    h += '<div class="card"><h3>Palmarés</h3>' + (k.titles.length ? '<ul class="cw-tl">' + k.titles.map(function (t) {
      return '<li><span class="tag ' + (t.kind === 'ascenso' ? 'g' : 'y') + '">' + esc(KIND_T[t.kind] || t.kind) + '</span>' + esc(t.name) + ' (T' + t.s + ')' + (t.you ? ' <span class="muted">(contigo)</span>' : '') + '</li>';
    }).join('') + '</ul>' : '<p>Nada todavía en tu carrera.</p>') +
      '<p class="muted">' + (old.length ? 'Antes de tu carrera: ' + old.join(' y ') : 'Sin títulos antes de tu carrera') + '.</p></div>';
    // 4) trayectoria (8 últimas temporadas, la más reciente arriba)
    if (k.path.length) {
      h += '<div class="card"><h3>Trayectoria</h3><table><thead><tr><th class="l">T</th><th class="l">Circuito</th><th>Pos.</th></tr></thead><tbody>' + k.path.slice().reverse().map(function (p) {
        return '<tr><td class="l">T' + p.s + '</td><td class="l">' + esc(p.league) + '</td><td>' + ordn(p.pos) + (p.move > 0 ? ' <span class="w" aria-label="ascenso">↑</span>' : p.move < 0 ? ' <span class="l" aria-label="descenso">↓</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    // 5) contra ti
    var v = k.vs, my = k.mySeasons.filter(function (s) { return s >= 1; });
    h += '<div class="card"><h3>Contra ti</h3>' + (v ? '<p>' + sp(['PJ ' + v.pj, 'G ' + v.g, 'P ' + v.p, 'Sets ' + v.sf + '-' + v.sc, 'Último: T' + v.last], 'v') + '</p>'
      : '<p class="muted">' + (k.mine ? 'Es tu club: aquí no hay cara a cara.' : 'Aún no os habéis enfrentado' + (k.since > 1 ? ' desde la temporada ' + k.since : '') + '.') + '</p>') +
      (my.length ? '<p>' + (k.mine ? 'Juegas aquí: ' : 'Jugaste aquí: ') + my.map(function (s) { return 'T' + s; }).join(', ') + '</p>' : '') +
      (k.rival ? '<p>Aquí juega tu rival ' + esc(k.rival.name) + ' (cara a cara ' + k.rival.w + '-' + k.rival.l + ')</p>' : '') + '</div>';
    return h;
  }
  /** career-ui, al entrar en Liga › Clubes desde la barra: vuelve a la lista. */
  function reset() { sel = null; }

  // ---------------------------------------------------------------- acciones (career-ui.js onClick)
  /** Devuelve null si no es suya; si no, {render, focus, tab, s}: career-ui repinta, enfoca el selector o va a la pestaña. */
  function act(a, b) {
    var w = W(); if (!w) return null;
    switch (a) {
      case 'cw-next': {
        var c = C().get(), sc = c && w.mentorScene(c);
        if (sc && li < sc.lines.length - 1) { li++; return { render: true, focus: '[data-act="cw-next"]' }; }
        w.mentorDone(); li = 0; liKey = '';
        return { render: true, focus: '[data-act="cw-next"]' };
      }
      case 'cw-skip': w.mentorSkip(); li = 0; liKey = ''; return { render: true, focus: '[data-act="cw-next"]' };
      case 'cw-go': {
        var t = b && b.getAttribute('data-tab-go'), s = b && b.getAttribute('data-s-go');
        w.mentorDone(); li = 0; liKey = '';
        return { render: false, tab: t || '', s: s || '' };
      }
      case 'cw-mentor-on': w.setMentor(true); return { render: true, focus: '[data-act="cw-mentor-on"]' };
      case 'cw-mentor-off': w.setMentor(false); li = 0; liKey = ''; return { render: true, focus: '[data-act="cw-mentor-off"]' };
      case 'cw-club': {   // ficha de club (desde Clubes, Clasificación, Noticias o Titulares): va a Liga › Clubes
        var id = b ? +b.getAttribute('data-id') : NaN, cc = C().get();
        if (!(id >= 0) || !cc || !C().club(cc, id)) return null;
        sel = id; return { render: true, tab: 'league', s: 'clubs', focus: '[data-act="cw-list"]' };
      }
      case 'cw-list': { var was = sel; sel = null; return { render: true, focus: was != null ? '[data-act="cw-club"][data-id="' + was + '"]' : '' }; }
    }
    return null;
  }
  /** Escape/B: true si cierra algo propio (la ficha de club). career-ui solo lo llama con Liga › Clubes a la vista. */
  function back() { if (sel != null) { lastSel = sel; sel = null; return true; } return false; }
  /** Tras back(): el selector de la fila del club que se cerraba (para devolverle el foco). */
  function focusSel() { return lastSel != null ? '.cw-row[data-id="' + lastSel + '"]' : ''; }

  VB.CareerWorldUI = { mentorCard: mentorCard, optsHTML: optsHTML, headlines: headlines, newsHTML: newsHTML, clubsHTML: clubsHTML, act: act, back: back, focusSel: focusSel, reset: reset, css: css, FACE: FACE,
    isCard: function () { return sel != null; } };
})();
