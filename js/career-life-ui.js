/* MAKE THE CUT — js/career-life-ui.js (owner: carrera)
 * Pantallas de la «vida» de la Carrera (VB.CareerLifeUI), dentro del hub de career-ui.js:
 *  - Partido: tarjeta «Reto de la jornada» (con el duelo contra tu rival) y la decisión pendiente (botones con sus efectos).
 *  - Último partido: reto cumplido o no, seguidores, dinero, duelo y logros.
 *  - Pestaña «Fama»: Fama (seguidores, patrocinio, rival, decisiones) · Tienda (material y servicios) · Logros · Legado (premios,
 *    puntuación de leyenda, retirada y Salón de la Fama).
 * Solo devuelve HTML; las acciones (data-act="lf-…") las atiende career-ui.js (onClick → VB.CareerLifeUI.act). Datos: career-life.js.
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};
  function Lf() { return VB.CareerLife; }
  function C() { return VB.Career; }
  var H = null, retArm = 0, note = '';
  function esc(s) { return H.esc(s); }
  function sp(a, k) { return H.sp(a, k); }
  function eur(v) { return Lf().eur(v); }
  function num(v) { return Lf().num(v); }
  function bar(p, col) { return '<span class="bar"><i style="width:' + Math.round(100 * Math.max(0, Math.min(1, p))) + '%' + (col ? ';background:' + col : '') + '"></i></span>'; }
  var CSS = [
    '#career .lf-big{font:900 30px var(--display);letter-spacing:.02em;margin:0;line-height:1.05;color:#ffd23f;text-shadow:var(--ring1)}',
    '#career .lf-tier{font:800 13px var(--display);letter-spacing:.14em;text-transform:uppercase;color:#b9b0e6}',
    '#career .lf-ch{background:linear-gradient(135deg,rgba(255,210,63,.18),rgba(255,128,64,.12));box-shadow:0 0 0 2.5px var(--tk),4px 5px 0 var(--tk),inset 0 0 0 2px rgba(255,210,63,.55)}',
    '#career .lf-ch b.goal{display:block;font:900 21px var(--display);letter-spacing:.03em;text-transform:uppercase;margin:2px 0 6px}',
    '#career .lf-duel{background:linear-gradient(135deg,rgba(216,54,74,.28),rgba(123,63,209,.2))}',
    '#career .lf-ev p.q{font:600 15px var(--ui);margin:4px 0 8px}',
    '#career .lf-ev .acts button small{display:block;font:600 12px var(--ui);text-transform:none;letter-spacing:0;opacity:.9;margin-top:2px}',
    '#career .lf-up{color:#7ee2a8}#career .lf-dn{color:#ff8a8a}',
    '#career .lf-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)}',
    '#career .lf-item:first-of-type{border-top:0}',
    '#career .lf-item b{font:800 15.5px var(--display);letter-spacing:.03em;text-transform:uppercase}',
    '#career .lf-item small{display:block;color:#b9b0e6;font:600 12.5px var(--ui)}',
    '#career .lf-item button{min-height:44px;min-width:120px}',
    '#career .lf-lock{opacity:.6}',
    '#career .lf-pips{display:inline-flex;gap:3px;vertical-align:-1px;margin-left:6px}#career .lf-pips i{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.18);box-shadow:0 0 0 1.5px var(--tk)}#career .lf-pips i.on{background:#ffd23f}',
    '#career .lf-ach{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}',
    '#career .lf-a{padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.2)}#career .lf-a.done{background:rgba(47,143,90,.28);box-shadow:inset 0 0 0 2px #2f8f5a}',
    '#career .lf-a b{display:block;font:800 14px var(--display);letter-spacing:.04em;text-transform:uppercase}#career .lf-a small{display:block;color:#cfc8f2;font:600 12px var(--ui);margin:1px 0 5px}',
    '#career .lf-a .bar{display:block;height:8px;border-radius:5px;background:rgba(0,0,0,.4);overflow:hidden}#career .lf-a .bar i{display:block;height:100%;background:#ffd23f}',
    '#career .lf-a em{display:block;font:700 11.5px var(--ui);font-style:normal;color:#ffd23f;margin-top:4px}',
    '#career .lf-fm .bar{display:block;height:12px;border-radius:7px;background:rgba(0,0,0,.4);overflow:hidden;margin:6px 0 2px}#career .lf-fm .bar i{display:block;height:100%;background:linear-gradient(90deg,#ff8040,#ffd23f)}'
  ].join('\n');
  function css() { if (document.getElementById('careerLifeCss')) return; var s = document.createElement('style'); s.id = 'careerLifeCss'; s.textContent = CSS; document.head.appendChild(s); }
  function arrow(h) { return h.map(function (x) { return '<span class="' + (x[1] ? 'lf-up' : 'lf-dn') + '">' + esc(x[0]) + ' ' + (x[1] ? '▲' : '▼') + '</span>'; }).join(' '); }

  // ---------------------------------------------------------------- pestaña Partido
  /** Tarjetas del reto y de la decisión pendiente (antes de los mensajes). */
  function matchCards(c, h0) {
    H = h0; css();
    var h = '', ch = Lf().challenge(c), ev = Lf().pendingEvent(c), l = c.life || {};
    if (ev) {
      h += '<div class="card lf-ev new"><h3>' + sp(['Decisión', esc(ev.title)], 'd') + '</h3><p class="q">' + esc(ev.text) + '</p><div class="acts">' +
        ev.opts.map(function (o, i) { return '<button data-act="lf-ans" data-i="' + i + '">' + esc(o.t) + (o.hint.length ? '<small>' + arrow(o.hint) + '</small>' : '') + '</button>'; }).join('') +
        '</div><p class="muted" style="margin:6px 0 0">Si juegas o simulas sin contestar, la oportunidad se pierde.</p></div>';
    }
    if (ch) {
      var rv = l.rival;
      h += '<div class="card lf-ch' + (ch.duel ? ' lf-duel' : '') + '"><h3>' + (ch.duel ? sp(['Duelo', 'contra ' + esc(rv.name)], 'd') : 'Reto de la jornada') + '</h3><b class="goal">' + esc(ch.txt) + '</b><p>' +
        '<span class="tag y">+' + num(ch.fans) + ' seguidores</span><span class="tag y">+' + ch.xp + ' XP</span><span class="tag y">+' + eur(ch.money) + '</span>' + (ch.duel ? '<span class="tag r">Premio doble</span>' : '') + '</p>' +
        '<p class="muted" style="margin:4px 0 0">' + sp([ch.duel ? 'Cara a cara ' + rv.w + '-' + rv.l : '', 'Solo cuenta si juegas el partido', 'Retos cumplidos: ' + (l.chDone | 0)], 'v') + '</p></div>';
    }
    return h;
  }
  /** Líneas extra de la tarjeta del último partido. */
  function lastExtra(c, s, h0) {
    H = h0; var x = s && s.life; if (!x) return '';
    var h = '<p>';
    if (x.ch) h += '<span class="tag ' + (x.ch.ok ? 'g' : 'r') + '">' + (x.ch.ok ? 'Reto cumplido' : 'Reto fallado') + ': ' + esc(x.ch.txt) + ' (' + esc(x.ch.prog) + ')</span>';
    if (x.fans) h += '<span class="tag ' + (x.fans > 0 ? 'y' : 'r') + '">' + (x.fans > 0 ? '+' : '−') + num(Math.abs(x.fans)) + ' seguidores</span>';
    if (x.money) h += '<span class="tag">' + (x.money > 0 ? '+' : '−') + eur(Math.abs(x.money)) + '</span>';
    if (x.duel) h += '<span class="tag ' + (x.duel.win ? 'g' : 'r') + '">' + (x.duel.win ? 'Duelo ganado' : 'Duelo perdido') + ' contra ' + esc(x.duel.name) + ' (' + x.duel.w + '-' + x.duel.l + ')</span>';
    (x.ach || []).forEach(function (a) { h += '<span class="tag g">Logro: ' + esc(a) + '</span>'; });
    return h === '<p>' ? '' : h + '</p>';
  }

  // ---------------------------------------------------------------- pestaña Fama
  function render(c, sub, h0) {
    H = h0; css(); Lf().ensure(c);
    var out = sub === 'shop' ? shop(c) : sub === 'goals' ? goals(c) : sub === 'legacy' ? legacy(c) : fame(c);
    out += '<p class="note" role="status" aria-live="polite">' + esc(note) + '</p>'; note = '';
    return out;
  }
  function fame(c) {
    var f = Lf().fameInfo(c), l = c.life, h = '';
    h += '<div class="card lf-fm"><h3>Seguidores</h3><p class="lf-big">' + num(f.fans) + '</p><p class="lf-tier">' + esc(f.name) + '</p>' +
      (f.next ? bar(f.p) + '<p class="muted" style="margin:0">' + sp(['Siguiente: ' + esc(f.next), 'faltan ' + num(f.to - f.fans)], 'v') + '</p>' : '<p class="muted">Lo máximo. Tu nombre ya es historia del vóley.</p>') +
      '<p class="muted">' + sp([l.streak >= 2 ? 'Racha de ' + l.streak + ' victorias (más seguidores por partido)' : '', 'Mejor racha: ' + (l.best | 0), l.bestNota ? 'Mejor nota: ' + String(l.bestNota).replace('.', ',') : ''], 'v') + '</p>' +
      '<p class="muted">Ganas seguidores con buenas notas, victorias, retos, títulos y premios. La fama trae patrocinadores y hace que los clubes te miren más (+' + String(Lf().offerBonus(c)).replace('.', ',') + ' de interés).</p></div>';
    h += celebCard(c);
    // patrocinio
    h += '<div class="card"><h3>Patrocinio</h3>';
    if (l.sponsor) {
      var s = l.sponsor, g = Lf().sponsorProgress(c);
      h += '<p class="bigname" style="font-size:20px">' + esc(s.name) + '</p><p>' + sp([eur(s.pay) + ' por jornada', 'bonus ' + eur(s.goal.bonus)], 'v') + '</p>' +
        '<div class="pbar"><span>' + esc(s.goal.txt) + '</span>' + bar(g / s.goal.n) + '<b>' + Math.min(g, s.goal.n) + '/' + s.goal.n + '</b></div><p class="muted">El patrocinio dura hasta final de temporada.</p>';
    } else if (!l.spOffers.length) h += '<p class="muted">' + (f.i < 1 ? 'Nadie te patrocina todavía. Llega a «' + esc(Lf().tierName(1)) + '» (' + num(Lf().TIERS[1][0]) + ' seguidores) y empezarán a llamar.' : 'Sin patrocinador esta temporada. Al subir de escalón o en verano llegarán ofertas nuevas.') + '</p>';
    if (l.spOffers.length) {
      h += l.spOffers.map(function (o, i) {
        return '<div class="lf-item"><div><b>' + esc(o.name) + '</b><small>' + sp([eur(o.pay) + ' por jornada', 'bonus de ' + eur(o.goal.bonus) + ' si consigues ' + esc(o.goal.txt)], 'v') + '</small></div><button class="pri" data-act="lf-sp" data-i="' + i + '">Firmar</button></div>';
      }).join('') + '<div class="acts"><button data-act="lf-spno">Rechazar las dos</button></div>';
    }
    h += '</div>';
    // rival
    var rv = l.rival, rk = rv && C().club(c, rv.club);
    h += '<div class="card"><h3>Tu rival</h3>' + (rv && rk ? '<div class="row">' + '<div class="grow"><p class="bigname" style="font-size:20px">' + esc(rv.name) + ' <span class="muted">#' + rv.num + '</span></p><p class="muted" style="margin:2px 0 0">' +
      sp([esc(rk.name), 'Media ' + Lf().rivalOvr(c), 'Rival desde la temporada ' + rv.since], 'v') + '</p></div><div style="text-align:center"><p class="lf-big" style="font-size:26px">' + rv.w + '-' + rv.l + '</p><small class="muted">cara a cara</small></div></div>' +
      '<p class="muted">Cada partido contra ' + esc(rk.name) + ' es un duelo: el reto vale el doble.</p>' : '<p class="muted">Aparecerá cuando juegues tu primera jornada en una liga.</p>') + '</div>';
    // decisiones recientes
    if (l.log && l.log.length) h += '<div class="card"><h3>Tus decisiones</h3>' + l.log.slice(-6).reverse().map(function (x) { return '<p class="muted" style="margin:3px 0">' + sp(['T' + x.s, esc(x.t), '<b style="color:#fff">' + esc(x.o) + '</b>'], 'v') + '</p>'; }).join('') + '</div>';
    return h;
  }
  /** Celebración de firma (sprint 5, E2): «Ninguna» y una fila por celebración (Elegida / Elegir / bloqueada con su escalón). */
  function celebCard(c) {
    if (!Lf().celebs) return '';
    var L = Lf().celebs(c), cur = c.life && c.life.celeb || '', open = L.filter(function (x) { return x.open; }).length;
    function row(id, name, hint, on, lock) {
      return '<div class="lf-item"><div><b>' + esc(name) + '</b><small>' + esc(hint) + '</small></div>' +
        (on ? '<span class="tag g">Elegida</span>' : lock ? '<span class="tag lf-lock">Fama: ' + esc(lock) + '</span>' : '<button data-act="lf-celeb" data-id="' + esc(id) + '">Elegir</button>') + '</div>';
    }
    return '<div class="card" data-nav><h3>' + sp(['Celebración', open + ' de ' + L.length], 'd') + '</h3>' +
      '<p class="muted">Tu gesto en los puntos grandes: remates de los que levantan la grada y el punto que cierra un set.</p>' +
      row('', 'Ninguna', 'La reacción de siempre', !cur, '') +
      L.map(function (x) { return row(x.id, x.name, x.open ? 'Desbloqueada con «' + x.tierName + '»' : 'Se desbloquea con la fama', x.on, x.open ? '' : x.tierName); }).join('') + '</div>';
  }
  function shop(c) {
    var l = c.life, money = +c.money || 0, h = '';
    h += '<div class="card"><h3>' + sp(['Ahorros', eur(money)], 'd') + '</h3><p class="muted">Cobras el sueldo, el patrocinio y los premios de los retos cada jornada. El material suma en tus partidos (como la química) y los servicios se pagan por jornada.</p></div>';
    h += '<div class="card"><h3>Material</h3>' + Lf().GEAR_KEYS.map(function (id) {
      var G = Lf().GEAR[id], lv = l.gear[id] | 0, pr = Lf().gearPrice(c, id), pips = '';
      for (var i = 0; i < Lf().GEAR_MAX; i++) pips += '<i class="' + (i < lv ? 'on' : '') + '"></i>';
      return '<div class="lf-item"><div><b>' + esc(Lf().gearName(c, id)) + '<span class="lf-pips" aria-label="Nivel ' + lv + ' de 3">' + pips + '</span></b><small>' + esc(G.hint) + (lv ? ': +' + lv + ' en el partido' : '') + '</small></div>' +
        (lv >= Lf().GEAR_MAX ? '<span class="tag g">Al máximo</span>' : '<button data-act="lf-buy" data-id="' + id + '"' + (money < pr ? ' aria-disabled="true"' : '') + '>' + (lv ? 'Mejorar' : 'Comprar') + ' <small style="font:600 12px var(--ui);text-transform:none;letter-spacing:0">' + eur(pr) + '</small></button>') + '</div>';
    }).join('') + '</div>';
    h += '<div class="card"><h3>Servicios</h3>' + Lf().SVC_KEYS.map(function (id) {
      var S = Lf().SVC[id], on = !!l.svc[id], cost = Lf().svcCost(c, id);
      return '<div class="lf-item"><div><b>' + esc(S.name) + (on ? ' <span class="tag g">Contratado</span>' : '') + '</b><small>' + sp([esc(S.hint), eur(cost) + ' por jornada'], 'v') + '</small></div>' +
        '<button data-act="lf-svc" data-id="' + id + '" aria-pressed="' + on + '">' + (on ? 'Cancelar' : 'Contratar') + '</button></div>';
    }).join('') + '<p class="muted">' + sp(['Gastado en la carrera: ' + eur(l.spent | 0), 'ganado fuera del sueldo: ' + eur(l.earned | 0)], 'v') + '</p></div>';
    return h;
  }
  function goals(c) {
    var a = Lf().achList(c), done = a.filter(function (x) { return x.done; }).length;
    a.sort(function (x, y) { return (x.done ? 1 : 0) - (y.done ? 1 : 0) || (y.v / y.n) - (x.v / x.n); });
    return '<div class="card"><h3>' + sp(['Logros', done + ' de ' + a.length], 'd') + '</h3><p class="muted">Cada logro da su premio una sola vez: puntos de mejora, seguidores o dinero.</p><div class="lf-ach">' +
      a.map(function (x) {
        var v = x.dec ? String(x.v).replace('.', ',') : num(x.v);
        return '<div class="lf-a' + (x.done ? ' done' : '') + '"><b>' + (x.done ? '✓ ' : '') + esc(x.name) + '</b><small>' + esc(x.d) + '</small>' + (x.done ? '' : bar(x.v / x.n) + '<small style="margin:3px 0 0">' + v + ' de ' + (x.dec ? String(x.n).replace('.', ',') : num(x.n)) + '</small>') + '<em>' + esc(x.reward) + '</em></div>';
      }).join('') + '</div></div>';
  }
  function legacy(c) {
    var l = c.life, sc = Lf().legacyScore(c), t = Lf().legacyTier(sc), age = c.player.age | 0, h = '';
    h += '<div class="card lf-fm"><h3>Legado</h3><p class="lf-big">' + sc + '</p><p class="lf-tier">' + esc(t.name) + '</p>' +
      (t.next ? bar((sc) / t.next[0]) + '<p class="muted" style="margin:0">' + sp(['Siguiente: ' + esc(t.next[1]), 'a ' + t.next[0] + ' puntos'], 'v') + '</p>' : '') +
      '<p class="muted">Suman los títulos (más cuanto más alta la categoría), los premios individuales, la fama, las victorias y los logros.</p></div>';
    h += '<div class="card"><h3>Premios individuales</h3>' + (l.awards.length ? l.awards.slice().reverse().map(function (a) { return '<p><span class="tag y">' + esc(a.name) + '</span> ' + sp(['T' + a.season, esc(a.club)], 'v') + '</p>'; }).join('')
      : '<p class="muted">Aún ninguno. Al final de cada temporada se entregan: MVP, máximo anotador, mejor sacador, muro del año, mejor defensa y revelación. Hay que jugar los partidos: simulando no te ve nadie.</p>') + '</div>';
    h += '<div class="card"><h3>' + sp(['Retirada', age + ' años'], 'd') + '</h3>';
    if (Lf().canRetire(c)) {
      var armed = retArm && performance.now() - retArm < 4000;
      h += '<p>Puedes colgar las rodilleras cuando quieras. Tu carrera pasará al Salón de la Fama de este dispositivo con ' + sc + ' puntos de legado, y podrás empezar otra con algo de fama heredada.</p>' +
        '<div class="acts"><button class="warn" data-act="lf-ret">' + (armed ? 'Pulsa otra vez para retirarte' : 'Retirarse') + '</button></div>';
    } else h += '<p class="muted">Podrás retirarte a partir de los ' + Lf().RETIRE_AGE + ' años. Desde los ' + Lf().DECLINE_AGE + ' el físico empieza a bajar cada verano.</p>';
    h += '</div>';
    var lg = Lf().legends();
    if (lg.length) h += '<div class="card"><h3>Salón de la Fama</h3><table><thead><tr><th class="l">Jugador</th><th>Legado</th><th class="hide-s">Títulos</th><th class="hide-s">Premios</th><th>Temp.</th></tr></thead><tbody>' +
      lg.slice(0, 10).map(function (r) { return '<tr><td class="club">' + esc(r.name) + ' <span class="muted">(' + esc(r.tier) + ')</span></td><td>' + r.score + '</td><td class="hide-s">' + r.titles + '</td><td class="hide-s">' + r.awards + '</td><td>' + r.seasons + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }

  // ---------------------------------------------------------------- acciones (career-ui.js onClick)
  /** Devuelve: 'render' (repinta y deja el foco), 'retired' (la carrera se ha cerrado) o '' (no es mía). */
  function act(a, b) {
    var L = Lf(); if (!L) return '';
    switch (a) {
      case 'lf-ans': { var r = L.answer(+b.getAttribute('data-i')); note = r ? (r.length ? r.join(', ') + '.' : 'Hecho.') : ''; return 'render'; }
      case 'lf-sp': note = L.signSponsor(+b.getAttribute('data-i')) ? '¡Patrocinio firmado!' : ''; return 'render';
      case 'lf-spno': L.declineSponsors(); note = 'Ofertas rechazadas.'; return 'render';
      case 'lf-buy': { var c = C().get(), id = b.getAttribute('data-id'), p = c ? L.gearPrice(c, id) : 0, k = L.buyGear(id);
        note = k === 'ok' ? 'Comprado: ' + L.gearName(c, id) + '.' : k === 'money' ? 'No te llega: cuesta ' + eur(p) + '.' : k === 'max' ? 'Ya está al máximo.' : ''; return 'render'; }
      case 'lf-svc': { var c2 = C().get(), id2 = b.getAttribute('data-id'), k2 = L.toggleSvc(id2);
        note = k2 === 'on' ? 'Contratado: ' + L.SVC[id2].name + '.' : k2 === 'off' ? 'Cancelado: ' + L.SVC[id2].name + '.' : k2 === 'money' ? 'No te llega para la primera jornada (' + eur(L.svcCost(c2, id2)) + ').' : ''; return 'render'; }
      case 'lf-celeb': { var cid = b.getAttribute('data-id') || ''; note = L.setCeleb && L.setCeleb(cid) ? (cid ? 'Celebración elegida.' : 'Sin celebración propia.') : 'Aún no la tienes.'; return 'render'; }
      case 'lf-ret':
        if (retArm && performance.now() - retArm < 4000) { retArm = 0; var rec = L.retire(); return rec ? 'retired' : 'render'; }
        retArm = performance.now(); return 'render';
    }
    return '';
  }
  function setNote(t) { note = t || ''; }

  VB.CareerLifeUI = { matchCards: matchCards, lastExtra: lastExtra, render: render, act: act, setNote: setNote,
    SUBS: [['fame', 'Fama'], ['shop', 'Tienda'], ['goals', 'Logros'], ['legacy', 'Legado']] };
})();
