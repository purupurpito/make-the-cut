#!/usr/bin/env node
/* MAKE THE CUT — tools/build-leagues.js (owner: ui_main, lote C: Carrera de pista)
 * Junta los cinco ficheros de investigación (notes/clubes/*.json) en los datos del juego y en la lista de revisión:
 *   - js/leagues.js            VB.Leagues: 3 regiones (Europa, América, Asia) con países, divisiones, clubes y competiciones. Solo lo que
 *                              usa el juego: SIN el nombre real ni el oficial de los clubes (llevan patrocinadores) ni las notas.
 *   - notes/clubes-reales.md   para que Ferran lo revise: competiciones (real → nuestro) y una tabla por liga (club real → nuestro nombre,
 *                              colores, ovr, nombre oficial y comprobación), con ⚠ en los casos dudosos.
 * Comprueba antes de escribir: nombres de club únicos en todo el juego, abreviaturas únicas (en todo el juego, para que las copas
 * internacionales no las repitan), colores hex, ovr y fuerza 0-100, ningún «masculino/femenino» y ningún patrocinador conocido.
 * Uso: node tools/build-leagues.js [--check]   (--check: solo comprueba, no escribe). Sale con 1 si algo falla.
 * Los datos se corrigen en notes/clubes/*.json (la fuente) y se vuelve a ejecutar este script.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'notes', 'clubes');
const FILES = ['elite-europa', 'fra-ale-esp', 'europa-media', 'america', 'asia'];   // la élite primero: sus copas europeas mandan
const CONT = { Europa: 'IT PL TR FR DE RU ES BE NL GR PT CH AT CZ RS SI RO', 'América': 'BR AR US CA PE', Asia: 'JP KR CN IR QA PH' };
const CHECK_ONLY = process.argv.includes('--check');

// Patrocinadores y marcas que aparecen en los nombres reales: ningún nombre nuestro puede llevarlos (palabra entera, sin mayúsculas).
const SPONSORS = ['Sir Safety', 'Sir Susa', 'Itas', 'Lube', 'Cucine', 'Rana', 'Gas Sales', 'Bluenergy', 'Valsa', 'Imoco', 'Prosecco', 'Numia', 'Savino', 'Igor',
  'Gorgonzola', 'Reale Mutua', 'Fenera', 'Megabox', 'Allianz', 'Sonepar', 'Acqua San Bernardo', 'Yuasa', 'Tinet', 'Eurotek', 'UYBA', 'CBF', 'Balducci', 'Valsabbina',
  'Aluron', 'Warta', 'PGE', 'GiEK', 'Bogdanka', 'Asseco', 'Indykpol', 'Developres', 'Energa', 'Trefl', 'Malow', 'Cuprum', 'Stilon', 'InPost', 'ITA Tools', 'Hagric',
  'Grupa Azoty', 'Azoty', 'VakıfBank', 'Vakıf', 'Eczacıbaşı', 'Dynavit', 'Medicana', 'Zeren', 'Aras', 'Kargo', 'Ziraat', 'Bankkart', 'Halkbank', 'Spor Toto',
  'Kuzeyboru', 'THY', 'Türk Hava', 'Altekma', 'ON Hotels', 'Kuşgöz', 'İlbank', 'Ak Bars', 'NTMK', 'Gazprom', 'Alterna', 'Spacer', 'Recycling', 'Helios', 'WWK',
  'Binder', 'Skurios', 'Palmberg', 'Lotto', 'Conectabalear', 'Herce', 'Pamesa', 'Cajasol', 'Emalsa', 'Volkswagen', 'OCISA', 'DSV', 'Unicaja', 'Servigroup',
  'Bus Leader', 'Instercap', 'Asisa', "Libby's", 'Sayre', 'Emevé', 'Kiele', 'Cuesta Piedra', 'Greenyard', 'Knack', 'Decospan', 'Lindemans', 'Asterix', 'Advisie',
  'Viteos', 'Lindaren', 'Infomaniak', 'ČEZ', 'Jihostroj', 'TENT', 'Mozzart', 'Calcit', 'Alpacem', 'i-Vent', 'Panvita', 'Pomgrad', 'GEN-I', 'OTP', 'Arcada',
  'Sada', 'Dentil', 'Itambé', 'Gerdau', 'Renata', 'Sesi', 'Sesc', 'Vedacit', 'Unilife', 'Viapol', 'Saneago', 'Batavo', 'Ypê', 'Renasce', 'UPCN', 'Korean Air',
  'Hyundai', 'KB', 'Woori', 'WON', 'KEPCO', 'Hi-pass', 'GS Caltex', 'KIXX', 'Hillstate', 'Heungkuk', 'IBK', 'Suntory', 'JTEKT', 'Hisamitsu', 'NEC', 'PFU',
  'Kubota', 'Fujitsu', 'Creamline', 'Cignal', 'PLDT', 'Petro Gazz', 'Farm Fresh', 'Choco Mucho', 'Akari', 'Criss Cross', 'Savouge', 'Foolad', 'Shahdab',
  'Chadormalu', 'Saipa', 'Paykan', 'Ubest', 'Zenith Steel', 'BAIC', 'Bohai', 'Donggang'];
const SPONSOR_RE = new RegExp('(^|[^\\p{L}])(' + SPONSORS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')([^\\p{L}]|$)', 'iu');

// Dudas que debe decidir Ferran (de los informes de los verificadores y del integrador), por nombre nuestro.
const DOUBT = {
  'Üsküdar Arıları': 'Nombre nuevo de la verificación (antes aludía al apodo de Fenerbahçe); sin buscar.',
  'Angora Voleybol': 'Club nuevo de la verificación (İlbank sustituye a Keçiören); nombre sin buscar.',
  'Sudoverf Piter': 'Club nuevo de la verificación (Korabelka sustituye a Murom); nombre sin buscar y colores estimados.',
  'Volley Jastrzębie': 'Colores: Wikipedia da verde, negro y amarillo (los del club); aquí van naranja y negro (la marca JSW). Elegir.',
  'Volley Verona': 'Casi igual que el real («Verona Volley», mismas palabras en otro orden).',
  'Volley Cisterna': 'Casi igual que el real («Cisterna Volley»).', 'Volley Cuneo': 'Casi igual que el real; además falta Cuneo Granda (10ª de la Serie A1), que chocaría.',
  'Volley Chieri': 'Casi igual que el real («Chieri ’76»).', 'Volley Perugia': 'Casi igual que «Perugia Volley» (Black Angels, otro club).',
  'Yeşilköy Voleybol': 'En el límite: guiña al barrio de la sede de THY, que es también el del antiguo aeropuerto.',
  'Voley Hispalis': 'Club real dudoso: dataproject dice «Fundación Cajasol Andalucía» y es.wikipedia «F. Unicaja Andalucía VB» (Dos Hermanas).',
  'Voley Tamarán': 'Club real probable: J.A.V. Olímpico (Emalsa Gran Canaria), por confirmar.',
  'Aiacciu Volley': 'Ajaccio no jugó la Ligue A 2025-26 (sería Ligue B); Royan, que sube, podría sustituirlo.',
  'Rennsteig Volley Suhl': 'Colores de Brandfetch: pueden ser los del patrocinador (Lotto Thüringen).',
  'Borkener Kuriosen': '«Skurios»: si es un patrocinador y no la marca del club, hay que cambiar el nombre.',
  'Rei en Jaume Vòlei': 'Empató 10-12 con Teruel (Voley Turia): Conqueridor (6º) está en la 2ª y Teruel (7º) en la 1ª; se pueden cambiar.',
  'Voley Menen': 'Tectum Achel jugó la Copa VEC 2025-26 y no está: podría sustituir a Menen.',
  'Dínamo Bucarest': 'Es solo la forma española del nombre real. Alternativa propuesta: «Câinii Bucarest».',
  'Voley Sliedrecht': 'Sin confirmar que tuviera equipo en la Eredivisie de hombres 2025-26.',
  'Volley Salt Lake': 'Mismas palabras que «Salt Lake Volleyball» (la prensa llama así al equipo real). Alternativa sin buscar: «Volley Wasatch».',
  'Frisco Pulse': 'Conserva «Pulse», la palabra del nombre real (Dallas Pulse).',
  'Vôlei Cidade Canção': 'Colores (magenta y negro) sin fuente.',
  'Vôlei Montesclarense': 'Sin confirmar que jugara la Superliga B 2025-26.', 'Vôlei Alencarino': 'Sin confirmar que jugara la Superliga B 2025-26.',
  'Araucárias SP': 'Sin confirmar que jugara la Superliga B 2025-26.',
  'Incheon Jumbo Jets': '«Jumbos» es el apodo del club, pero alude a los aviones del patrocinador (Korean Air).',
  'Metro Spikers': 'Nombre genérico; además Cignal se dio de baja temporal en enero de 2026.',
  'Heavy Hitters Manila': 'Nombre genérico.', 'Manila Angelz': 'Petro Gazz se dio de baja temporal en 2026.',
  'Bay Sealions': 'Navy ya no figura en la Spikers’ Turf.',
  'Partisan Beograd': 'Es la traducción literal de «Partizan»: casi igual que el real.',
  'Sunwings Osaka': '«Sun» de Sunbirds, que a su vez viene de Suntory (el patrocinador): guiño indirecto.',
  'Vòlei Manacor': 'Casi igual que el real (CV Manacor; voleimanacor.club puede ser su marca). Es el ejemplo de Ferran.',
  'Capodistria Volley': 'Muy cerca del nombre registrado del club real («Club di pallavolo Koper-Capodistria»).',
  'Voley Rayyan': 'ovr 74, por encima de las ligas medias de Europa (63-70); campeón de Asia 2025. Ferran puede bajarlo.',
  'Valibal Sirjan': 'ovr 76, por encima de las ligas medias de Europa; Ferran puede bajarlo.'
};
const COMP_DOUBT = {
  'Champions Cup VEC': 'Ferran pidió «Champions Cup», pero ese nombre a secas es oficial en rugby (EPCR) y en fútbol (CONCACAF), y fue el de la propia CEV hasta 2000. Se usa «Champions Cup VEC» en todos los ficheros.',
  'Mundial de Clubes VBF': 'Unificado: antes «World Club Cup» (Asia) y «Mundial VBC de Clubes» (América).',
  'Coppa Tricolore': 'Nueva del integrador; una búsqueda, sin competición oficial con ese nombre.', 'Puchar Orła': 'Nueva del integrador; una búsqueda, sin coincidencias.',
  'Hilal Kupası': 'Nueva del integrador; una búsqueda, sin coincidencias.', 'Kubok Volgi': 'Nueva del integrador; una búsqueda, sin coincidencias.'
};
// Clubes reales que faltan (para la sección de dudas)
const MISSING = [
  'Rusia: Nova (8º) y Gazprom-Yugra (10º) acabaron por encima de Gorky, Ufa, Orenburg y Yaroslavich, que sí están.',
  'Italia: Cuneo Granda (10ª de la Serie A1); su nombre chocaría con «Volley Cuneo».',
  'Bélgica: Tectum Achel (jugó la Copa VEC 2025-26).',
  'Francia: Royan (sube para 2026-27); las Neptunes de Nantes, Saint-Dié y Évreux (no se pudo ver la liga de mujeres 2025-26).',
  'Alemania: las listas consultadas eran de 2026-27; no se sabe si Vilsbiburg jugó la 2025-26.',
  'Japón (2ª), Canadá y la liga peruana de hombres: plantillas 2025-26 sin verificar.'
];

const errs = [], warns = [];
const regions = {}, order = [], allNames = {}, allShorts = {};
const compSeen = {};
function err(m) { errs.push(m); }
const hexOk = s => /^#[0-9a-f]{6}$/i.test(String(s));
function contOf(code) { for (const r in CONT) if ((' ' + CONT[r] + ' ').includes(' ' + code + ' ')) return r; return null; }

const src = FILES.map(f => ({ f, j: JSON.parse(fs.readFileSync(path.join(DIR, f + '.json'), 'utf8')) }));
for (const { f, j } of src) {
  for (const co of j.countries) {
    const reg = contOf(co.code); if (!reg) { err(f + ': país ' + co.code + ' sin continente'); continue; }
    if (!regions[reg]) { regions[reg] = { region: reg, countries: [], competitions: [] }; order.push(reg); }
    if (regions[reg].countries.some(x => x.code === co.code)) { err('país repetido ' + co.code); continue; }
    const out = { country: co.country, code: co.code, tier: co.tier | 0, divisions: [], _src: co };
    for (const d of co.divisions) {
      if (!(d.strength >= 0 && d.strength <= 100)) err(co.code + d.lvl + ': fuerza ' + d.strength);
      if (SPONSOR_RE.test(d.name)) err(co.code + d.lvl + ': patrocinador en la liga «' + d.name + '»');
      const dd = { lvl: d.lvl, name: d.name, short: d.short, strength: d.strength, clubs: [] };
      const inLg = {};
      for (const k of d.clubs) {
        const id = co.code + d.lvl + ' ' + k.name, n = k.name.toLowerCase();
        if (allNames[n]) err('nombre repetido: ' + k.name + ' (' + allNames[n] + ' y ' + co.code + d.lvl + ')'); allNames[n] = co.code + d.lvl;
        if (inLg[k.short]) err('abreviatura repetida en ' + co.code + d.lvl + ': ' + k.short);
        inLg[k.short] = 1;
        if (allShorts[k.short]) err('abreviatura repetida en el juego: ' + k.short + ' (' + allShorts[k.short] + ' y ' + id + ')'); allShorts[k.short] = id;
        if (!/^[A-ZÀ-Ž0-9]{2,4}$/.test(k.short)) err(id + ': abreviatura «' + k.short + '»');
        if (!k.colors || !hexOk(k.colors.shirt) || !hexOk(k.colors.shirt2) || !hexOk(k.colors.libero)) err(id + ': colores');
        if (!(k.ovr >= 0 && k.ovr <= 100)) err(id + ': ovr ' + k.ovr);
        if (n === String(k.real || '').toLowerCase() || n === String(k.official || '').toLowerCase()) err(id + ': igual que el nombre real u oficial');
        const m = SPONSOR_RE.exec(k.name); if (m) err(id + ': lleva «' + m[2] + '» (patrocinador)');
        if (!/^(M|W|MW)$/.test(k.gender)) err(id + ': gender ' + k.gender);
        dd.clubs.push({ name: k.name, short: k.short, city: k.city, gender: k.gender,
          colors: { shirt: k.colors.shirt.toLowerCase(), shirt2: k.colors.shirt2.toLowerCase(), libero: k.colors.libero.toLowerCase() }, liberoEstimated: !!k.liberoEstimated, ovr: k.ovr });
      }
      out.divisions.push(dd);
    }
    regions[reg].countries.push(out);
  }
  for (const x of j.competitions) {
    if (!x.kind) err(f + ': competición sin kind: ' + x.name);
    if (SPONSOR_RE.test(x.name)) err(f + ': patrocinador en la competición «' + x.name + '»');
    const regs = [...new Set(j.countries.map(co => contOf(co.code)))];
    const reg = x.country ? contOf(x.country) : regs[0];
    const key = reg + '|' + x.name;
    if (compSeen[key]) { if (compSeen[key].short !== x.short) err('competición «' + x.name + '» con dos abreviaturas'); continue; }
    compSeen[key] = { short: x.short, real: x.real, x };
    const c = { name: x.name, short: x.short, kind: x.kind };
    if (x.rank) c.rank = x.rank; if (x.zone) c.zone = x.zone; if (x.country) c.country = x.country;
    regions[reg].competitions.push(c);
  }
}
if (/masculin|femenin/i.test(JSON.stringify(order.map(r => regions[r]), (k, v) => k === '_src' ? undefined : v))) err('«masculino/femenino» en los datos del juego');
// cada región: una sola internacional por rango y zona
for (const r of order) {
  const seen = {};
  regions[r].competitions.filter(c => c.kind === 'intl').forEach(c => { const k = c.rank + '|' + (c.zone || ''); if (seen[k]) err(r + ': dos internacionales de rango ' + k + ' (' + seen[k] + ', ' + c.name + ')'); seen[k] = c.name; });
  regions[r].competitions.filter(c => c.kind === 'cup').forEach(c => { if (!regions[r].countries.some(co => co.code === c.country)) err('copa de ' + c.country + ' sin país'); });
}

// ------------------------------------------------------------------ resumen
let nClubs = 0, nLeagues = 0, nCountries = 0;
for (const r of order) for (const co of regions[r].countries) { nCountries++; for (const d of co.divisions) { nLeagues++; nClubs += d.clubs.length; } }
console.log(nCountries + ' países, ' + nLeagues + ' ligas, ' + nClubs + ' clubes; regiones: ' + order.map(r => r + ' (' + regions[r].countries.length + ')').join(', '));
if (errs.length) { console.log('FALLOS:\n  ' + errs.join('\n  ')); process.exit(1); }
console.log('Comprobado: nombres y abreviaturas únicos, colores, ovr, sin patrocinadores conocidos ni «masculino/femenino».');
if (CHECK_ONLY) process.exit(0);

// ------------------------------------------------------------------ js/leagues.js
function clubLine(k) { return '            ' + JSON.stringify(k); }
let js = `/* MAKE THE CUT — js/leagues.js (owner: ui_main, lote C: Carrera de pista)
 * Datos de las ligas de PISTA (6v6) de la Carrera: VB.Leagues. Solo datos, sin lógica (career.js los lee al crear una Carrera de
 * pista y guarda una copia de los clubes en el guardado). Se carga antes de js/career.js (index.html, tools/careertest.js,
 * tools/simtest.js); career.js funciona igual sin este fichero (la Carrera de pista queda desactivada).
 *
 * GENERADO por tools/build-leagues.js a partir de notes/clubes/*.json (investigación de clubes reales 2025-26). NO SE EDITA A MANO:
 * se corrige el JSON y se vuelve a generar. La lista para revisar (club real → nuestro nombre) está en notes/clubes-reales.md.
 * ${nCountries} países, ${nLeagues} ligas, ${nClubs} clubes. Aquí no van los nombres reales ni oficiales (llevan patrocinadores), solo los nuestros.
 *
 * Esquema (una región por continente; el campo gender es solo un dato interno de la fuente: ningún texto del juego lo enseña):
 *   {region, countries:[{country, code, tier, divisions:[{lvl, name, short, strength,
 *     clubs:[{name, short, city, gender, colors:{shirt, shirt2, libero}, liberoEstimated, ovr}]}]}],
 *    competitions:[{name, short, kind, rank?, zone?, country?}]}
 *   - lvl 1 = 1ª división, 2 = 2ª. strength 0-100 (nivel de la división); ovr 0-100 (nivel del club).
 *   - competitions: kind 'intl' (copa de clubes del continente; rank 1 la grande, 2 la segunda, 3 no se juega; zone 'sur'/'norte' en
 *     América), 'cup' (copa nacional de country; sin ella, «Copa Nacional») o 'skip' (ligas, supercopas, selecciones, Mundial de Clubes:
 *     solo para la lista de nombres).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var VB = root.VB = root.VB || {};
  var REGIONS = [\n`;
js += order.map(r => {
  const R = regions[r];
  const cos = R.countries.map(co => '      { country: ' + JSON.stringify(co.country) + ', code: ' + JSON.stringify(co.code) + ', tier: ' + co.tier + ', divisions: [\n' +
    co.divisions.map(d => '        { lvl: ' + d.lvl + ', name: ' + JSON.stringify(d.name) + ', short: ' + JSON.stringify(d.short) + ', strength: ' + d.strength + ', clubs: [\n' +
      d.clubs.map(clubLine).join(',\n') + '\n        ] }').join(',\n') + '\n      ] }').join(',\n');
  const comps = R.competitions.map(c => '      ' + JSON.stringify(c)).join(',\n');
  return '    { region: ' + JSON.stringify(r) + ', countries: [\n' + cos + '\n    ], competitions: [\n' + comps + '\n    ] }';
}).join(',\n');
js += `\n  ];
  VB.Leagues = {
    provisional: false,
    regions: REGIONS,
    /** Añade (o sustituye, por nombre de región) una región con el esquema de arriba. */
    add: function (rg) {
      if (!rg || !Array.isArray(rg.countries)) return false;
      for (var i = 0; i < REGIONS.length; i++) if (REGIONS[i].region === rg.region) { REGIONS[i] = rg; return true; }
      REGIONS.push(rg); return true;
    }
  };
})();
`;
fs.writeFileSync(path.join(ROOT, 'js', 'leagues.js'), js);
console.log('js/leagues.js: ' + Math.round(js.length / 1024) + ' KB');

// ------------------------------------------------------------------ notes/clubes-reales.md
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const sw = h => '![](https://placehold.co/12x12/' + h.slice(1) + '/' + h.slice(1) + '.png) `' + h.toUpperCase() + '`';
const searched = ch => /Integrador, búsqueda web/.test(ch) || (/(Búsqueda web del nombre exacto|búsqueda entre comillas sin)/i.test(ch) && !/(SIN COMPROBAR|no pude buscar|No comprobado por búsqueda|Búsqueda web PENDIENTE)/i.test(ch));
const GEN = { M: 'hombres', W: 'mujeres', MW: 'los dos' };
let nDoubt = 0, nPend = 0;
const md = [];
md.push('# Clubes reales → Make the Cut: lista para que la revise Ferran');
md.push('');
md.push('Generada el 11-nov-2026 por `tools/build-leagues.js` a partir de `notes/clubes/*.json` (cinco investigaciones verificadas). Es la');
md.push('misma lista que lleva el juego (`js/leagues.js`): ' + nCountries + ' países, ' + nLeagues + ' ligas y ' + nClubs + ' clubes. Para cambiar algo, se corrige');
md.push('el JSON y se vuelve a ejecutar `node tools/build-leagues.js`; el detalle de cada investigación sigue en `notes/clubes/*.md`.');
md.push('');
md.push('**Cómo se lee**');
md.push('- Una liga por país y división, mixta: mezcla los clubes fuertes de las ligas reales de hombres y de mujeres de 2025-26. La columna');
md.push('  «Fuente» (equipo real de hombres, de mujeres o los dos) es solo un dato interno para ver el reparto; el juego no lo enseña nunca.');
md.push('- Colores: camiseta / segundo color / líbero. «≈» = color del líbero propuesto (no se encontró el real).');
md.push('- «Búsqueda»: ✔ = buscado entre comillas sin encontrar ningún club oficial con ese nombre; «pendiente» = sin buscar todavía (se');
md.push('  agotó el cupo de búsquedas de los investigadores).');
md.push('- **⚠** = caso dudoso que debe decidir Ferran (está explicado en la columna «Notas» y resumido en «Decisiones para Ferran»).');
md.push('');
// decisiones
md.push('## Decisiones para Ferran');
md.push('');
md.push('**Nombres y datos dudosos (⚠ en las tablas)**');
const doubtList = [];
for (const r of order) for (const co of regions[r].countries) for (const d of co.divisions) for (const k of d.clubs) if (DOUBT[k.name]) doubtList.push('- ' + co.country + ', ' + d.name + ': **' + k.name + '**. ' + DOUBT[k.name]);
md.push(...doubtList);
md.push('');
md.push('**Competiciones**');
for (const n in COMP_DOUBT) md.push('- **' + n + '**: ' + COMP_DOUBT[n]);
md.push('');
md.push('**Clubes reales que faltan**');
MISSING.forEach(m => md.push('- ' + m));
md.push('');
md.push('**Otros**');
md.push('- Búsqueda entre comillas pendiente en la mayoría de los clubes (columna «Búsqueda») y en casi todas las competiciones.');
md.push('- Colores estimados: muchos de Polonia (2ª), Turquía, Rusia, China, Irán, Catar y Filipinas; el líbero, en casi todos los clubes.');
md.push('- Niveles de Catar e Irán (74-76) por encima de las ligas medias de Europa: se pueden bajar si pesa más ser una liga pequeña.');
md.push('');
// competiciones
md.push('## Competiciones (real → nuestro)');
md.push('');
md.push('| Real | Nuestro | Abrev. | Qué hace el juego | Notas |');
md.push('|---|---|---|---|---|');
const KIND = c => c.kind === 'intl' ? (c.rank <= 2 ? 'Copa internacional ' + (c.rank === 1 ? 'grande (1r y 2º de cada 1ª)' : 'segunda (3r y 4º)') + (c.zone ? ', zona ' + c.zone : '') : 'Solo el nombre (3ª copa, no se juega)')
  : c.kind === 'cup' ? 'Copa nacional (' + c.country + ')' : 'Solo el nombre';
for (const key in compSeen) {
  const { x } = compSeen[key], d = COMP_DOUBT[x.name];
  md.push('| ' + esc(x.real) + ' | ' + (d ? '⚠ ' : '') + '**' + esc(x.name) + '** | ' + esc(x.short) + ' | ' + KIND(x) + ' | ' + esc(d || x.note) + ' |');
}
md.push('');
md.push('Las ligas (filas de abajo) también cambian de nombre: Superliga → Hiperliga, SuperLega → IperLega, PlusLiga → PlusPlus Liga, etc.');
md.push('');
// ligas
for (const r of order) {
  md.push('## ' + r);
  md.push('');
  for (const co of regions[r].countries) {
    const s = co._src;
    md.push('### ' + co.country + ' (' + co.code + ')');
    md.push('');
    for (let i = 0; i < co.divisions.length; i++) {
      const d = co.divisions[i], sd = s.divisions[i], g = { M: 0, W: 0, MW: 0 };
      d.clubs.forEach(k => g[k.gender]++);
      md.push('#### ' + (d.lvl === 1 ? '1ª' : '2ª') + ': ' + d.name + ' (' + d.short + '), fuerza ' + d.strength);
      md.push('');
      md.push('Real: ' + esc(sd.real) + '. Reparto: ' + g.M + ' de hombres, ' + g.W + ' de mujeres' + (g.MW ? ', ' + g.MW + ' con los dos' : '') + '.' + (sd.note ? ' ' + esc(sd.note) : ''));
      md.push('');
      md.push('| Club real | Nuestro nombre | Ciudad | Camiseta | 2º color | Líbero | ovr | Fuente | Nombre oficial | Búsqueda | Notas |');
      md.push('|---|---|---|---|---|---|---|---|---|---|---|');
      const sc = sd.clubs.slice().sort((a, b) => b.ovr - a.ovr);
      for (const k of sc) {
        const dbt = DOUBT[k.name], srch = searched(k.check || '');
        if (dbt) nDoubt++; if (!srch) nPend++;
        md.push('| ' + esc(k.real) + ' | ' + (dbt ? '⚠ ' : '') + '**' + esc(k.name) + '** (' + k.short + ') | ' + esc(k.city) + ' | ' + sw(k.colors.shirt) + ' | ' + sw(k.colors.shirt2) + ' | ' + sw(k.colors.libero) + (k.liberoEstimated ? ' ≈' : '') +
          ' | ' + k.ovr + ' | ' + GEN[k.gender] + ' | ' + esc(k.official) + ' | ' + (srch ? '✔' : 'pendiente') + ' | ' + (dbt ? '**⚠ ' + esc(dbt) + '** ' : '') + esc(k.check) + ' |');
      }
      md.push('');
    }
  }
}
fs.writeFileSync(path.join(ROOT, 'notes', 'clubes-reales.md'), md.join('\n') + '\n');
console.log('notes/clubes-reales.md: ' + nDoubt + ' clubes con ⚠, ' + nPend + ' con la búsqueda pendiente');
