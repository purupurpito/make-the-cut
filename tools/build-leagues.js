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
  'Üsküdar Arıları': 'Nombre nuevo de la verificación (antes aludía al apodo de Fenerbahçe); ya buscado (oleadas 11-nov): libre.',
  'Angora Voleybol': 'Club nuevo de la verificación (İlbank sustituye a Keçiören); nombre ya buscado (oleadas 11-nov): libre.',
  'Sudoverf Piter': 'Club nuevo de la verificación (Korabelka sustituye a Murom); nombre ya buscado (libre), colores estimados.',
  'Volley Jastrzębie': 'Colores: Wikipedia da verde, negro y amarillo (los del club); aquí van naranja y negro (la marca JSW). Elegir.',
  'Volley Verona': 'Casi igual que el real («Verona Volley», mismas palabras en otro orden).',
  'Volley Cisterna': 'Casi igual que el real («Cisterna Volley»).', 'Volley Cuneo': 'Casi igual que el real; además falta Cuneo Granda (10ª de la Serie A1), que chocaría.',
  'Volley Chieri': 'Casi igual que el real («Chieri ’76»).', 'Volley Perugia': 'Casi igual que «Perugia Volley» (Black Angels, otro club).',
  'Yeşilköy Voleybol': 'En el límite: guiña al barrio de la sede de THY, que es también el del antiguo aeropuerto.',
  'Voley Hispalis': 'Club real dudoso: dataproject dice «Fundación Cajasol Andalucía» y es.wikipedia «F. Unicaja Andalucía VB» (Dos Hermanas).',
  'Voley Tamarán': 'Club real probable: J.A.V. Olímpico (Emalsa Gran Canaria), por confirmar.',
  'Aiacciu Volley': 'Ajaccio no jugó la Ligue A 2025-26 (sería Ligue B); Royan, que sube, podría sustituirlo.',
  'Rennsteig Volley Suhl': 'Colores de Brandfetch: pueden ser los del patrocinador (Lotto Thüringen).',
  'Rei en Jaume Vòlei': 'Empató 10-12 con Teruel (Voley Turia): Conqueridor (6º) está en la 2ª y Teruel (7º) en la 1ª; se pueden cambiar.',
  'Menen Vauban': 'Tectum Achel jugó la Copa VEC 2025-26 y no está: podría sustituir a Menen.',
  'Voley Sliedrecht': 'Sin confirmar que tuviera equipo en la Eredivisie de hombres 2025-26.',
  'Volley Salt Lake': 'Mismas palabras que «Salt Lake Volleyball» (la prensa llama así al equipo real). Alternativa sin buscar: «Volley Wasatch».',
  'Frisco Pulse': 'Conserva «Pulse»: el real, Dallas Pulse, juega en Frisco y la prensa lo llama «Frisco’s Dallas Pulse». Alternativa buscada: «Frisco Pulsar».',
  'Vôlei Cidade Canção': 'Colores (magenta y negro) sin fuente.',
  'Vôlei Montesclarense': 'Sin confirmar que jugara la Superliga B 2025-26.', 'Vôlei Alencarino': 'Sin confirmar que jugara la Superliga B 2025-26.',
  'Araucárias SP': 'Sin confirmar que jugara la Superliga B 2025-26.',
  'Metro Spikers': 'Nombre genérico; además Cignal se dio de baja temporal en enero de 2026.',
  'Heavy Hitters Manila': 'Nombre genérico.', 'Manila Angelz': 'Petro Gazz se dio de baja temporal en 2026.',
  'Bay Sealions': 'Navy ya no figura en la Spikers’ Turf.',
  'Vòlei Manacor': 'Casi igual que el real (CV Manacor; voleimanacor.club puede ser su marca). Es el ejemplo de Ferran.',
  'Capodistria Volley': 'Muy cerca del nombre registrado del club real («Club di pallavolo Koper-Capodistria»).',
  'Voley Rayyan': 'ovr 74, por encima de las ligas medias de Europa (63-70); campeón de Asia 2025. Ferran puede bajarlo.',
  'Valibal Sirjan': 'ovr 76, por encima de las ligas medias de Europa; Ferran puede bajarlo.',
  // oleadas de búsqueda (11-nov): nombres dudosos
  'Laranjeiras Tricolor': '«Tricolor das Laranjeiras» es el apodo muy conocido del Fluminense (mismas palabras); no es nombre oficial.',
  'Vôlei Joseense': 'Existió «Vôlei Feminino Joseense» (São José dos Campos, 2019-20). Alternativa buscada: «Aeroespacial Vôlei».',
  'Orlando Valquirias': 'Traducción literal de Orlando Valkyries (misma ciudad). Alternativa buscada: «Kissimmee Valquirias».',
  'Manoa Rainbows': 'La prensa llama «Rainbows» a Hawái (antes «Hawaii Rainbows»). Alternativa sin buscar: «Manoa Arcoíris».',
  'Montréal Carabines': 'A una letra del real, Montréal Carabins. Alternativa sin buscar: «Montréal Mousquetaires».',
  'Voley Maaseik': 'Casi la traducción de «Volleybalclub Maaseik» (el real). Se podría usar el pabellón (Steengoed Arena).',
  'Voley Roeselare': 'La prensa llama «Volley Roeselare» al real (Knack); además existe «Polonia Volley Roeselare».',
  'Voley Leuven': 'El real es «Volley Haasrode Leuven»: solo le falta Haasrode. Se puede dejar.',
  'Voley Chapelle': 'Parecidos: «La Chapelle Volley Ball» (Francia) y el real Tchalou Chapelle-lez-Herlaimont. Se puede dejar.',
  'Lykurgos Groningen': 'Transliteración griega del real «Lycurgus Groningen»: suena casi igual.',
  'Milo Nea Smirni': 'Casi «AONS Milon Nea Smyrni» (el real en la CEV). Alternativa buscada: «Prosfyges Nea Smirni».',
  'Tigres Espinho': '«Tigres da Costa Verde» es el apodo del SC Espinho y existe «Escola de Formação de Espinho - Os Tigres» (balonmano playa).',
  'Voley Ginebra': 'Casi la traducción de «Genève Volley» (el real), con el orden cambiado.',
  'Voley Kladno': 'Mismas ideas que el real «Kladno volejbal cz», en otro orden. Alternativa sin buscar: «Mineros de Kladno».',
  'Branič Maribor': 'A una letra de los muchos «Branik Maribor» (también OK Branik de vóley). Alternativa sin buscar: «Pohorje Maribor».',
  'Voley Zalău': 'La prensa llama «Volei Zalău» al real (Volei Municipal Zalău). Alternativa sin buscar: «Sălaj Zalău».',
  'Montpelhièr Volley': 'Es «Montpellier Volley» (el real) en occitano. Alternativa sin buscar: «Clapas Volley».',
  'Volaro Le Cannet': 'A una letra del real, Volero Le Cannet. Alternativas sin buscar: «Volantes Le Cannet», «Riviera Le Cannet Volley».',
};
const COMP_DOUBT = {
  'Champions Cup VEC': 'Ferran pidió «Champions Cup», pero ese nombre a secas es oficial en rugby (EPCR) y en fútbol (CONCACAF), y fue el de la propia CEV hasta 2000. Se usa «Champions Cup VEC» en todos los ficheros.',
  'Mundial de Clubes VBF': 'Unificado: antes «World Club Cup» (Asia) y «Mundial VBC de Clubes» (América).',
  'Coppa Tricolore': 'Nueva del integrador; una búsqueda, sin competición oficial con ese nombre.', 'Puchar Orła': 'Nueva del integrador; una búsqueda, sin coincidencias.',
  'Hilal Kupası': 'Nueva del integrador; una búsqueda, sin coincidencias.', 'Kubok Volgi': 'Nueva del integrador; una búsqueda, sin coincidencias.',
  // oleadas de búsqueda (11-nov): nombres dudosos
  'Copa del Sur de Clubes': 'Hubo una «Copa del Sur» de fútbol (Buenos Aires, 1964 y 1968) y existe la «Copa Sur» brasileña; «de Clubes» la diferencia.',
  'Copa Bohemia': 'Hubo una copa de fútbol de Bohemia (1906-1946) y Bohemia es marca de cerveza. Alternativas sin buscar: «Copa Moldava», «Copa de Praga».',
  'Copa Srbija': 'Casi la traducción del real «Kup Srbije». Alternativas sin buscar: «Copa Danubio Serbio», «Copa Šumadija».',
  'Copa Triglav': 'Triglav es la gran aseguradora eslovena (patrocinadora habitual). Alternativas sin buscar: «Copa Alpes Julianos».',
  'Copa Carpatos': 'Casi la traducción de la Coupe des Carpathes (ciclismo) y del Carpathian Trophy (balonmano). Alternativa sin buscar: «Copa Transilvania».',
  'Bundespokal Volley': 'La DVV ya organiza un «Bundespokal» de vóley juvenil. Alternativa (solo Wikipedia): «Netzpokal».',
  'Hyper-Cup': '«Hyper Cup» es un modo de juego de videojuegos de fútbol de Konami; no es competición real.'
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
        if (k.sponsor) { const ms = SPONSOR_RE.exec(k.sponsor); if (ms) err(id + ': el patrocinador inventado «' + k.sponsor + '» lleva «' + ms[2] + '» (marca real)'); if (k.sponsor.length > 28) err(id + ': patrocinador demasiado largo'); }
        if (!/^(M|W|MW)$/.test(k.gender)) err(id + ': gender ' + k.gender);
        dd.clubs.push({ name: k.name, sponsor: k.sponsor || undefined, short: k.short, city: k.city, gender: k.gender,
          colors: { shirt: k.colors.shirt.toLowerCase(), shirt2: k.colors.shirt2.toLowerCase(), libero: k.colors.libero.toLowerCase() }, liberoEstimated: !!k.liberoEstimated, ovr: k.ovr });
      }
      out.divisions.push(dd);
    }
    regions[reg].countries.push(out);
  }
  for (const x of j.competitions) {
    if (!x.kind) err(f + ': competición sin kind: ' + x.name);
    if (SPONSOR_RE.test(x.name)) err(f + ': patrocinador en la competición «' + x.name + '»');
    // (patrocinadores inventados de los clubes: se comprueban abajo, en el bucle de clubes)
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
 *     clubs:[{name, sponsor?, short, city, gender, colors:{shirt, shirt2, libero}, liberoEstimated, ovr}]}]}],
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
md.push('- Búsqueda entre comillas pendiente en los clubes marcados «pendiente» (columna «Búsqueda»: sobre todo Francia y Alemania, más los dudosos) y en algunas competiciones.');
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

// ------------------------------------------------------------------ notes/clubes-revision.json (para la página web de revisión)
// Lo mismo que la lista de arriba, en JSON: competiciones y clubes con el nombre real, el nuestro, si ya se buscó, la duda (⚠) y una nota
// corta (160 caracteres como mucho) sacada de check/note.
function shortNote(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  let m = /«([^»]+)» no existe como club ni competición oficial\..*?nombre anterior, «([^»]+)», chocaba: (.*?)(?: Nota anterior:|$)/.exec(t);
  if (m) t = 'Cambiado: antes «' + m[2] + '», que chocaba. ' + m[3];
  else if ((m = /^(Búsqueda web del nombre exacto|Búsqueda entre comillas sin coincidencias)[^:]*:.*?Resultado: (.*)$/.exec(t))) t = (/^Búsqueda entre/.test(m[1]) ? 'Libre (solo Wikipedia): ' : 'Libre: ') + m[2];
  else if ((m = /^No comprobado por búsqueda como libre[^:]*: DUDOSO\..*?Resultado: (.*)$/.exec(t))) t = 'Dudoso: ' + m[1];
  if (t.length <= 160) return t;
  const cut = t.slice(0, 159); return cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)).replace(/[\s,;:.]+$/, '') + '…';
}
const rev = { generated: '2026-11-11', competitions: [], countries: [] };
for (const key in compSeen) {
  const { x } = compSeen[key];
  rev.competitions.push({ real: x.real || '', name: x.name, short: x.short, note: shortNote(x.note), doubt: COMP_DOUBT[x.name] || null, searched: searched(x.note || '') });
}
for (const r of order) for (const co of regions[r].countries) {
  const s = co._src;
  rev.countries.push({ country: co.country, code: co.code, region: r, tier: co.tier, divisions: s.divisions.map(sd => ({
    lvl: sd.lvl, name: sd.name, short: sd.short, strength: sd.strength,
    clubs: sd.clubs.slice().sort((a, b) => b.ovr - a.ovr).map(k => ({ real: k.real || '', official: k.official || '', name: k.name, short: k.short, city: k.city || '',
      colors: { shirt: k.colors.shirt.toLowerCase(), shirt2: k.colors.shirt2.toLowerCase(), libero: k.colors.libero.toLowerCase() },
      liberoEstimated: !!k.liberoEstimated, ovr: k.ovr, sponsor: k.sponsor || null, searched: searched(k.check || ''), doubt: DOUBT[k.name] || null, note: shortNote(k.check) })) })) });
}
fs.writeFileSync(path.join(ROOT, 'notes', 'clubes-revision.json'), JSON.stringify(rev, null, 1) + '\n');
console.log('notes/clubes-revision.json: ' + rev.competitions.length + ' competiciones, ' + rev.countries.length + ' países');
