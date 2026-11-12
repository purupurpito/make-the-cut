/* MAKE THE CUT — js/leagues.js (owner: ui_main, lote C: Carrera de pista)
 * Datos de las ligas de PISTA (6v6) de la Carrera: VB.Leagues. Solo datos, sin lógica (career.js los lee al crear una Carrera de
 * pista y guarda una copia de los clubes en el guardado). Se carga antes de js/career.js (index.html, tools/careertest.js,
 * tools/simtest.js); career.js funciona igual sin este fichero (la Carrera de pista queda desactivada).
 *
 * GENERADO por tools/build-leagues.js a partir de notes/clubes/*.json (investigación de clubes reales 2025-26). NO SE EDITA A MANO:
 * se corrige el JSON y se vuelve a generar. La lista para revisar (club real → nuestro nombre) está en notes/clubes-reales.md.
 * 28 países, 37 ligas, 390 clubes. Aquí no van los nombres reales ni oficiales (llevan patrocinadores), solo los nuestros.
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
  var REGIONS = [
    { region: "Europa", countries: [
      { country: "Italia", code: "IT", tier: 1, divisions: [
        { lvl: 1, name: "IperLega", short: "IPL", strength: 90, clubs: [
            {"name":"Voley Perugia","sponsor":"Salumificio Il Bagher","short":"PER","city":"Perugia","gender":"M","colors":{"shirt":"#111111","shirt2":"#d6001c","libero":"#ffffff"},"liberoEstimated":false,"ovr":93},
            {"name":"Volley Trento","sponsor":"Speck Primo Tempo","short":"TRE","city":"Trento","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#13294b","libero":"#d21f2b"},"liberoEstimated":false,"ovr":91},
            {"name":"Volley Civitanova","sponsor":"Materassi Pallonetto","short":"CIV","city":"Civitanova Marche","gender":"M","colors":{"shirt":"#d50032","shirt2":"#ffffff","libero":"#c6d93a"},"liberoEstimated":false,"ovr":89},
            {"name":"Voley Verona","sponsor":"Pandoro Ace","short":"VER","city":"Verona","gender":"M","colors":{"shirt":"#003da5","shirt2":"#ffd100","libero":"#5ec4e6"},"liberoEstimated":false,"ovr":88},
            {"name":"Placentia Volley","sponsor":"Idraulica La Rete","short":"PIA","city":"Piacenza","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#1f5fb0"},"liberoEstimated":false,"ovr":86},
            {"name":"Mutina Volley","sponsor":"Acetaia Diagonale","short":"MOD","city":"Modena","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#002855","libero":"#92c6e6"},"liberoEstimated":false,"ovr":84},
            {"name":"Volley Conegliano","sponsor":"Chanclas Supersónicas","short":"CON","city":"Conegliano","gender":"W","colors":{"shirt":"#1f3c88","shirt2":"#ffd100","libero":"#1d4fa6"},"liberoEstimated":false,"ovr":95},
            {"name":"Volley Brianza","sponsor":"Mobilificio Muro Alto","short":"BRI","city":"Monza","gender":"MW","colors":{"shirt":"#d6177a","shirt2":"#14213d","libero":"#e6337b"},"liberoEstimated":false,"ovr":90},
            {"name":"Volley Scandicci","sponsor":"Pelletteria Alzata","short":"SCA","city":"Scandicci","gender":"W","colors":{"shirt":"#1b3f8b","shirt2":"#ffffff","libero":"#f4f4f8"},"liberoEstimated":false,"ovr":90},
            {"name":"Volley Novara","sponsor":"Riseria Ricezione","short":"NOV","city":"Novara","gender":"W","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#4a4f55"},"liberoEstimated":false,"ovr":87},
            {"name":"Voley Chieri","sponsor":"Grissini Fuori Tutto","short":"CHI","city":"Chieri","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f5f5f5"},"liberoEstimated":false,"ovr":84},
            {"name":"Volley Vallefoglia","sponsor":"Rodilleras Rodríguez","short":"VAL","city":"Vallefoglia","gender":"W","colors":{"shirt":"#f28c28","shirt2":"#1d1d1b","libero":"#9a2fa6"},"liberoEstimated":false,"ovr":81}
        ] },
        { lvl: 2, name: "IperLega Due", short: "IP2", strength: 76, clubs: [
            {"name":"Milano Power","sponsor":"Panettoneria Set Point","short":"MIL","city":"Milán","gender":"M","colors":{"shirt":"#0b3d91","shirt2":"#ffffff","libero":"#f07a1e"},"liberoEstimated":false,"ovr":82},
            {"name":"Volley Padova","sponsor":"Ferramenta Doppio Tocco","short":"PAD","city":"Padua","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#c8102e","libero":"#a98be0"},"liberoEstimated":false,"ovr":77},
            {"name":"Voley Cisterna","short":"CIS","city":"Cisterna di Latina","gender":"M","colors":{"shirt":"#00205b","shirt2":"#f6eb14","libero":"#8e1f33"},"liberoEstimated":false,"ovr":75},
            {"name":"Voley Cuneo","sponsor":"Marroni Invasione","short":"CUN","city":"Cuneo","gender":"M","colors":{"shirt":"#1f3f9a","shirt2":"#6ec1e4","libero":"#f0782a"},"liberoEstimated":false,"ovr":76},
            {"name":"Volley Grottazzolina","sponsor":"Olive all'Ace","short":"GRO","city":"Grottazzolina","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#f27a22"},"liberoEstimated":false,"ovr":73},
            {"name":"Volley Prata Friuli","sponsor":"Gelateria Fallo di Rete","short":"PRA","city":"Prata di Pordenone","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#003da5","libero":"#f5d21e"},"liberoEstimated":false,"ovr":73},
            {"name":"Bergomum Volley","short":"BER","city":"Bergamo","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#002d72","libero":"#d7263d"},"liberoEstimated":false,"ovr":78},
            {"name":"Volley Firenze","sponsor":"Trippaio La Schiacciata","short":"FIR","city":"Florencia","gender":"W","colors":{"shirt":"#4fa3e0","shirt2":"#ffffff","libero":"#f2f3f8"},"liberoEstimated":false,"ovr":76},
            {"name":"Farfalle Busto","sponsor":"Tintoria Rotazione","short":"BUS","city":"Busto Arsizio","gender":"W","colors":{"shirt":"#e2001a","shirt2":"#ffffff","libero":"#e99a2c"},"liberoEstimated":false,"ovr":77},
            {"name":"Volley Macerata","sponsor":"Ciauscolo Cambio Palla","short":"MAC","city":"Macerata","gender":"W","colors":{"shirt":"#ffd100","shirt2":"#111111","libero":"#7db4da"},"liberoEstimated":false,"ovr":75},
            {"name":"Volley Marignano","sponsor":"Piadineria La Veloce","short":"MAR","city":"San Giovanni in Marignano","gender":"W","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#2a2a2d"},"liberoEstimated":true,"ovr":72},
            {"name":"Volley Brescia","sponsor":"Casoncelli Seconda Linea","short":"BRE","city":"Brescia","gender":"W","colors":{"shirt":"#00539f","shirt2":"#ffffff","libero":"#a61e36"},"liberoEstimated":false,"ovr":72}
        ] }
      ] },
      { country: "Polonia", code: "PL", tier: 1, divisions: [
        { lvl: 1, name: "PlusPlus Liga", short: "PPL", strength: 88, clubs: [
            {"name":"Volley Zawiercie","sponsor":"Kiełbaski Blok","short":"ZAW","city":"Zawiercie","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#00843d","libero":"#ffd100"},"liberoEstimated":true,"ovr":92},
            {"name":"Volley Warszawa","sponsor":"Pączki Zagrywka","short":"WAR","city":"Varsovia","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#001533","libero":"#f2a900"},"liberoEstimated":true,"ovr":90},
            {"name":"Volley Lublin","sponsor":"Seguros Tie-Break","short":"LUB","city":"Lublin","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#00843d","libero":"#ffffff"},"liberoEstimated":true,"ovr":90},
            {"name":"Rezovia","sponsor":"Pierogarnia Kiwka","short":"RES","city":"Rzeszów","gender":"M","colors":{"shirt":"#d50032","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":88},
            {"name":"Volley Jastrzębie","sponsor":"Hydraulika Pod Siatką","short":"JAS","city":"Jastrzębie-Zdrój","gender":"M","colors":{"shirt":"#f47b20","shirt2":"#111111","libero":"#1f2a44"},"liberoEstimated":true,"ovr":85},
            {"name":"Volley Olsztyn","sponsor":"Materace Obrona","short":"OLS","city":"Olsztyn","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#00843d","libero":"#e4002b"},"liberoEstimated":true,"ovr":84},
            {"name":"Volley Bełchatów","sponsor":"Bigosownia Przyjęcie","short":"BEL","city":"Bełchatów","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#111111","libero":"#e4002b"},"liberoEstimated":true,"ovr":83},
            {"name":"Murarze Łódź","sponsor":"Szewc Aut","short":"MUR","city":"Łódź","gender":"W","colors":{"shirt":"#005bac","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":84},
            {"name":"Volley Rzeszów","sponsor":"Ogórki Rozegranie","short":"RZE","city":"Rzeszów","gender":"W","colors":{"shirt":"#e30613","shirt2":"#111111","libero":"#ffffff"},"liberoEstimated":true,"ovr":83},
            {"name":"Volley Łódź","sponsor":"Cukiernia Libero","short":"LKS","city":"Łódź","gender":"W","colors":{"shirt":"#d50032","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":79},
            {"name":"Volley Opole","short":"OPO","city":"Opole","gender":"W","colors":{"shirt":"#00539f","shirt2":"#ffd100","libero":"#ffffff"},"liberoEstimated":true,"ovr":80},
            {"name":"Volley Bielsko","sponsor":"Warsztat Plasowanie","short":"BIE","city":"Bielsko-Biała","gender":"W","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":77}
        ] },
        { lvl: 2, name: "PlusPlus Liga 2", short: "PP2", strength: 75, clubs: [
            {"name":"Volley Kędzierzyn","sponsor":"Twarożek Dwa Odbicia","short":"KED","city":"Kędzierzyn-Koźle","gender":"M","colors":{"shirt":"#005bac","shirt2":"#ffffff","libero":"#e4002b"},"liberoEstimated":true,"ovr":80},
            {"name":"Volley Gdańsk","sponsor":"Śledzie Wystawa","short":"GDA","city":"Gdańsk","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#111111","libero":"#e4002b"},"liberoEstimated":true,"ovr":79},
            {"name":"Volley Suwałki","sponsor":"Rodilleras Rodríguez","short":"SUW","city":"Suwałki","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":72},
            {"name":"Volley Gorzów","sponsor":"Pralnia Pipe","short":"GOR","city":"Gorzów Wielkopolski","gender":"M","colors":{"shirt":"#b87333","shirt2":"#111111","libero":"#00a3e0"},"liberoEstimated":true,"ovr":71},
            {"name":"Volley Chełm","sponsor":"Kapusta Kontra","short":"CHE","city":"Chełm","gender":"M","colors":{"shirt":"#00539f","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":70},
            {"name":"Volley Częstochowa","sponsor":"Obwarzanki Krótka","short":"CZE","city":"Częstochowa","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#005bac","libero":"#e4002b"},"liberoEstimated":true,"ovr":69},
            {"name":"Alchemik Police","sponsor":"Wędzarnia Czapa","short":"ALC","city":"Police","gender":"W","colors":{"shirt":"#ffd100","shirt2":"#003da5","libero":"#e4002b"},"liberoEstimated":true,"ovr":76},
            {"name":"Volley Radom","sponsor":"Lody Ścięcie","short":"RAD","city":"Radom","gender":"W","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":74},
            {"name":"Siatkówka Wrocław","sponsor":"Kwiaciarnia Rotacja","short":"WRO","city":"Wrocław","gender":"W","colors":{"shirt":"#f47b20","shirt2":"#111111","libero":"#00a3e0"},"liberoEstimated":true,"ovr":73},
            {"name":"Volley Bydgoszcz","short":"BYD","city":"Bydgoszcz","gender":"W","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":70},
            {"name":"Volley Mielec","sponsor":"Pizzeria Pod Antenką","short":"MIE","city":"Mielec","gender":"W","colors":{"shirt":"#005bac","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":70},
            {"name":"Volley Mogilno","sponsor":"Chanclas Supersónicas","short":"MOG","city":"Mogilno","gender":"W","colors":{"shirt":"#ffffff","shirt2":"#e30613","libero":"#111111"},"liberoEstimated":true,"ovr":69}
        ] }
      ] },
      { country: "Turquía", code: "TR", tier: 1, divisions: [
        { lvl: 1, name: "Efsaneler Ligi", short: "EFS", strength: 87, clubs: [
            {"name":"Üsküdar Arıları","sponsor":"Simitçi Ace","short":"ARI","city":"Estambul (Üsküdar)","gender":"W","colors":{"shirt":"#ffd100","shirt2":"#111111","libero":"#111111"},"liberoEstimated":true,"ovr":95},
            {"name":"Turuncu Voleybol","sponsor":"Baklavacı Manşet","short":"TUR","city":"Estambul","gender":"W","colors":{"shirt":"#f47b20","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":91},
            {"name":"Kanarya Kadıköy","sponsor":"Lokumcu Servis Atışı","short":"KAN","city":"Estambul (Kadıköy)","gender":"MW","colors":{"shirt":"#ffed00","shirt2":"#002d72","libero":"#ffffff"},"liberoEstimated":false,"ovr":93},
            {"name":"Galata Voleybol","sponsor":"Balıkçı File","short":"GAL","city":"Estambul","gender":"MW","colors":{"shirt":"#a90432","shirt2":"#fdb912","libero":"#ffffff"},"liberoEstimated":true,"ovr":88},
            {"name":"Nilüfer Voleybol","sponsor":"İskender Pas","short":"NIL","city":"Bursa (Nilüfer)","gender":"W","colors":{"shirt":"#6a1b9a","shirt2":"#ffffff","libero":"#1e9e4a"},"liberoEstimated":true,"ovr":80},
            {"name":"Ankara Voleybol","sponsor":"Halıcı Sayı","short":"ANK","city":"Ankara","gender":"W","colors":{"shirt":"#0a2463","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":88},
            {"name":"Kordon İzmir","sponsor":"Boyoz Smaç","short":"KOR","city":"Esmirna","gender":"W","colors":{"shirt":"#e30613","shirt2":"#0057b8","libero":"#ffffff"},"liberoEstimated":true,"ovr":79},
            {"name":"Başkent Voleybol","sponsor":"Tesisat Blok Out","short":"BAS","city":"Ankara","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":89},
            {"name":"Çankaya Voleybol","sponsor":"Seguros Tie-Break","short":"CAN","city":"Ankara","gender":"M","colors":{"shirt":"#005bac","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":86},
            {"name":"Ulus Voleybol","sponsor":"Dönerci Altın Set","short":"ULU","city":"Ankara","gender":"M","colors":{"shirt":"#009a44","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":82},
            {"name":"Genç İstanbul","short":"GEN","city":"Estambul","gender":"M","colors":{"shirt":"#e30613","shirt2":"#111111","libero":"#e30613"},"liberoEstimated":true,"ovr":80},
            {"name":"Bursa Voleybol","short":"BUR","city":"Bursa","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#1e9e4a"},"liberoEstimated":true,"ovr":79}
        ] },
        { lvl: 2, name: "Efsaneler 1. Lig", short: "EF1", strength: 72, clubs: [
            {"name":"Dolmabahçe Voleybol","short":"DOL","city":"Estambul (Beşiktaş)","gender":"W","colors":{"shirt":"#111111","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":73},
            {"name":"Aksaray Voleybol","sponsor":"Pide Çift Vuruş","short":"AKS","city":"Aksaray","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":74},
            {"name":"Yeşilköy Voleybol","sponsor":"Çaycı Libero","short":"YES","city":"Estambul (Yeşilköy)","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":76},
            {"name":"İzmir Körfez","short":"KRF","city":"Esmirna","gender":"W","colors":{"shirt":"#ffd100","shirt2":"#d50032","libero":"#ffffff"},"liberoEstimated":true,"ovr":72},
            {"name":"Aydın Voleybol","short":"AYD","city":"Aydın","gender":"W","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#2b4fa8"},"liberoEstimated":true,"ovr":67},
            {"name":"Angora Voleybol","sponsor":"Kokoreç Plonjon","short":"ANG","city":"Ankara","gender":"W","colors":{"shirt":"#14213d","shirt2":"#ffffff","libero":"#f2a900"},"liberoEstimated":true,"ovr":68},
            {"name":"Bornova Voleybol","sponsor":"Tamirhane Çapraz","short":"BOR","city":"Esmirna","gender":"M","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":75},
            {"name":"Gebze Voleybol","short":"GEB","city":"Gebze","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#1a1a2e"},"liberoEstimated":true,"ovr":70},
            {"name":"Antep Voleybol","short":"ANT","city":"Gaziantep","gender":"M","colors":{"shirt":"#d50032","shirt2":"#111111","libero":"#111111"},"liberoEstimated":true,"ovr":69},
            {"name":"Alanya Voleybol","sponsor":"Chanclas Supersónicas","short":"ALA","city":"Alanya","gender":"M","colors":{"shirt":"#f47b20","shirt2":"#00843d","libero":"#ffffff"},"liberoEstimated":true,"ovr":70},
            {"name":"Metropol İstanbul","short":"MET","city":"Estambul","gender":"M","colors":{"shirt":"#f47b20","shirt2":"#002d72","libero":"#ffffff"},"liberoEstimated":true,"ovr":69},
            {"name":"Akkuş Voleybol","sponsor":"Rodilleras Rodríguez","short":"AKK","city":"Akkuş (Ordu)","gender":"M","colors":{"shirt":"#009a44","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":65}
        ] }
      ] },
      { country: "Rusia", code: "RU", tier: 2, divisions: [
        { lvl: 1, name: "Mega-Liga", short: "MGL", strength: 82, clubs: [
            {"name":"Dynamik Moskva","short":"DYM","city":"Moscú","gender":"MW","colors":{"shirt":"#0039a6","shirt2":"#ffffff","libero":"#9be36b"},"liberoEstimated":true,"ovr":86},
            {"name":"Apogei Kazan","short":"APK","city":"Kazán","gender":"M","colors":{"shirt":"#0055a5","shirt2":"#4fc3f7","libero":"#ffffff"},"liberoEstimated":true,"ovr":86},
            {"name":"Parovoz Novosibirsk","short":"PAR","city":"Novosibirsk","gender":"M","colors":{"shirt":"#d50032","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":84},
            {"name":"Perigei Piter","short":"PRG","city":"San Petersburgo","gender":"M","colors":{"shirt":"#00a3e0","shirt2":"#ffffff","libero":"#0a2463"},"liberoEstimated":true,"ovr":83},
            {"name":"Volei Sosnovy Bor","short":"SOS","city":"Sosnovy Bor","gender":"M","colors":{"shirt":"#0039a6","shirt2":"#ffffff","libero":"#1f3fa8"},"liberoEstimated":true,"ovr":79},
            {"name":"Belogor Belgorod","short":"BLG","city":"Bélgorod","gender":"M","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":79},
            {"name":"Plamya Urengoy","short":"PLA","city":"Novy Urengói","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#f47b20","libero":"#98e2c6"},"liberoEstimated":true,"ovr":79},
            {"name":"Dinamika Kazan","sponsor":"Seguros Tie-Break","short":"DIK","city":"Kazán","gender":"W","colors":{"shirt":"#0039a6","shirt2":"#00843d","libero":"#ffffff"},"liberoEstimated":true,"ovr":85},
            {"name":"Teplovoz Kaliningrad","short":"TEP","city":"Kaliningrado","gender":"W","colors":{"shirt":"#d50032","shirt2":"#111111","libero":"#ffffff"},"liberoEstimated":true,"ovr":78},
            {"name":"Volei Odintsovo","short":"ODI","city":"Odintsovo","gender":"W","colors":{"shirt":"#003da5","shirt2":"#ffd100","libero":"#ffffff"},"liberoEstimated":true,"ovr":83},
            {"name":"Volei Yekaterinburg","sponsor":"Pirozhkovaya Setka","short":"EKA","city":"Ekaterimburgo","gender":"W","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":80},
            {"name":"Volei Neva","short":"NEV","city":"San Petersburgo","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#e30613"},"liberoEstimated":true,"ovr":78}
        ] },
        { lvl: 2, name: "Liga Alfa", short: "ALF", strength: 70, clubs: [
            {"name":"Kuznetsk Kemerovo","short":"KUZ","city":"Kémerovo","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":74},
            {"name":"Volei Nizhny","short":"NIZ","city":"Nizhni Nóvgorod","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#b5e61d"},"liberoEstimated":true,"ovr":71},
            {"name":"Volei Yaroslavl","short":"YAR","city":"Yaroslavl","gender":"M","colors":{"shirt":"#003da5","shirt2":"#e30613","libero":"#ffffff"},"liberoEstimated":true,"ovr":72},
            {"name":"Volei Ufa","short":"UFA","city":"Ufá","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":72},
            {"name":"Volei Orenburg","short":"ORE","city":"Oremburgo","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#111111","libero":"#ffe600"},"liberoEstimated":true,"ovr":70},
            {"name":"Volei Krasnoyarsk","short":"KRS","city":"Krasnoyarsk","gender":"MW","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#9be36b"},"liberoEstimated":true,"ovr":73},
            {"name":"Neitron Saratov","short":"NEI","city":"Sarátov","gender":"W","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":71},
            {"name":"Volei Tula","short":"TUL","city":"Tula","gender":"W","colors":{"shirt":"#e30613","shirt2":"#ffd100","libero":"#ffffff"},"liberoEstimated":true,"ovr":72},
            {"name":"Volei Chelyabinsk","short":"CHL","city":"Cheliábinsk","gender":"W","colors":{"shirt":"#111111","shirt2":"#f2a900","libero":"#ffffff"},"liberoEstimated":true,"ovr":67},
            {"name":"Volei Omsk","short":"OMS","city":"Omsk","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#e30613","libero":"#ffffff"},"liberoEstimated":true,"ovr":69},
            {"name":"Volei Krasnodar","short":"KRD","city":"Krasnodar","gender":"W","colors":{"shirt":"#0039a6","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":68},
            {"name":"Sudoverf Piter","short":"SUD","city":"San Petersburgo","gender":"W","colors":{"shirt":"#0a2463","shirt2":"#ffffff","libero":"#ffd100"},"liberoEstimated":true,"ovr":72}
        ] }
      ] },
      { country: "Francia", code: "FR", tier: 2, divisions: [
        { lvl: 1, name: "Ligue Smash", short: "LSM", strength: 82, clubs: [
            {"name":"Turones Volley","short":"TRN","city":"Tours","gender":"M","colors":{"shirt":"#1d4e9e","shirt2":"#ffffff","libero":"#6e2338"},"liberoEstimated":false,"ovr":85},
            {"name":"Clapàs Volley","short":"CLP","city":"Montpellier","gender":"M","colors":{"shirt":"#003c82","shirt2":"#f58220","libero":"#f4f4f4"},"liberoEstimated":false,"ovr":86},
            {"name":"Volley Tourquennois","short":"TRQ","city":"Tourcoing","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#d7192a"},"liberoEstimated":false,"ovr":82},
            {"name":"Pictaves Volley","sponsor":"Fromagerie Le Contre","short":"PIC","city":"Poitiers","gender":"M","colors":{"shirt":"#111111","shirt2":"#ffffff","libero":"#f2f2f2"},"liberoEstimated":false,"ovr":84},
            {"name":"Orbiters Toulouse","short":"ORB","city":"Toulouse","gender":"M","colors":{"shirt":"#0055a4","shirt2":"#ffffff","libero":"#9cc8e8"},"liberoEstimated":false,"ovr":80},
            {"name":"Singulière Sète Volley","short":"SNG","city":"Sète","gender":"M","colors":{"shirt":"#1b4f9c","shirt2":"#ffffff","libero":"#e5559a"},"liberoEstimated":true,"ovr":80},
            {"name":"Volley Crusoé Robinson","short":"CRU","city":"Le Plessis-Robinson","gender":"M","colors":{"shirt":"#f7c600","shirt2":"#111111","libero":"#f2c21b"},"liberoEstimated":false,"ovr":78},
            {"name":"Mìlhüsa Volley","short":"MLH","city":"Mulhouse","gender":"W","colors":{"shirt":"#111111","shirt2":"#d71920","libero":"#5e5e5e"},"liberoEstimated":false,"ovr":82},
            {"name":"Stanislas Volley Nancy","short":"STN","city":"Nancy","gender":"W","colors":{"shirt":"#e5007e","shirt2":"#111111","libero":"#f5f5f5"},"liberoEstimated":false,"ovr":80},
            {"name":"Mariannes de Seine","short":"MDS","city":"Levallois-Perret","gender":"W","colors":{"shirt":"#1f3a93","shirt2":"#e8559a","libero":"#e6336f"},"liberoEstimated":false,"ovr":80},
            {"name":"Racing Croisette","short":"RCR","city":"Cannes","gender":"W","colors":{"shirt":"#ffd100","shirt2":"#003da5","libero":"#e4002b"},"liberoEstimated":true,"ovr":78},
            {"name":"Voley Le Cannet","short":"VLR","city":"Le Cannet","gender":"W","colors":{"shirt":"#5b2c83","shirt2":"#ffffff","libero":"#eed9b8"},"liberoEstimated":false,"ovr":77}
        ] },
        { lvl: 2, name: "Ligue Smash 2", short: "LS2", strength: 70, clubs: [
            {"name":"Baie des Anges Volley","short":"BDA","city":"Niza","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffd200","libero":"#d22b2b"},"liberoEstimated":false,"ovr":74},
            {"name":"Estérel Cannes Volley","short":"EST","city":"Cannes","gender":"M","colors":{"shirt":"#d2232a","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":74},
            {"name":"Paris Lumière Volley","short":"PLV","city":"París","gender":"M","colors":{"shirt":"#1c2d5a","shirt2":"#c9a227","libero":"#e8dcb0"},"liberoEstimated":false,"ovr":73},
            {"name":"Prétoriens Narbonne","short":"PRE","city":"Narbona","gender":"M","colors":{"shirt":"#e6007e","shirt2":"#111111","libero":"#e1251b"},"liberoEstimated":false,"ovr":72},
            {"name":"Calvimont Volley 52","short":"CLV","city":"Chaumont","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#111111","libero":"#f2efd8"},"liberoEstimated":false,"ovr":72},
            {"name":"Volley Nazairien","short":"NAZ","city":"Saint-Nazaire","gender":"M","colors":{"shirt":"#00539f","shirt2":"#ffffff","libero":"#f5d90a"},"liberoEstimated":true,"ovr":70},
            {"name":"Cità Imperiale Volley","short":"AIA","city":"Ajaccio","gender":"M","colors":{"shirt":"#e2001a","shirt2":"#002f87","libero":"#f5f5f5"},"liberoEstimated":true,"ovr":69},
            {"name":"Anges Biterrois","short":"ANB","city":"Béziers","gender":"W","colors":{"shirt":"#0b1f4b","shirt2":"#2f80ed","libero":"#2a62d0"},"liberoEstimated":true,"ovr":73},
            {"name":"Burdigala Volley","short":"BRD","city":"Burdeos","gender":"W","colors":{"shirt":"#7a1f3d","shirt2":"#1b2a4a","libero":"#e9a83c"},"liberoEstimated":false,"ovr":71},
            {"name":"Fensch Volley","short":"FEN","city":"Terville / Florange","gender":"W","colors":{"shirt":"#0050a0","shirt2":"#ffffff","libero":"#f4f4f4"},"liberoEstimated":false,"ovr":69},
            {"name":"Arvernes Chamalières","short":"ARV","city":"Chamalières","gender":"W","colors":{"shirt":"#d0021b","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":69}
        ] }
      ] },
      { country: "Alemania", code: "DE", tier: 2, divisions: [
        { lvl: 1, name: "Bundesvolley", short: "BVL", strength: 80, clubs: [
            {"name":"Lüne Giganten","short":"LGI","city":"Lüneburg","gender":"M","colors":{"shirt":"#003b7a","shirt2":"#ffffff","libero":"#f2c230"},"liberoEstimated":false,"ovr":84},
            {"name":"Spreeathen Volley","sponsor":"Currywurst Schmetterball","short":"SPR","city":"Berlín","gender":"M","colors":{"shirt":"#ff9500","shirt2":"#231f20","libero":"#ffffff"},"liberoEstimated":false,"ovr":86},
            {"name":"Zeppeliner Volley","short":"ZEP","city":"Friedrichshafen","gender":"M","colors":{"shirt":"#0058b0","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":82},
            {"name":"Rur Power Düren","sponsor":"Rodilleras Rodríguez","short":"RUR","city":"Düren","gender":"M","colors":{"shirt":"#099dad","shirt2":"#000000","libero":"#1aa3a8"},"liberoEstimated":false,"ovr":82},
            {"name":"Giesen Kodiaks","sponsor":"Matratzen Hechtsprung","short":"KOD","city":"Giesen","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":78},
            {"name":"Rokoko Volleys","short":"RKK","city":"Ludwigsburg","gender":"M","colors":{"shirt":"#d2001e","shirt2":"#ffffff","libero":"#3dae3b"},"liberoEstimated":false,"ovr":75},
            {"name":"Kessel Volley Stuttgart","sponsor":"Spätzle Bagger","short":"KES","city":"Stuttgart","gender":"W","colors":{"shirt":"#1352a5","shirt2":"#ffffff","libero":"#f04e23"},"liberoEstimated":false,"ovr":83},
            {"name":"Rennsteig Volley Suhl","sponsor":"Rostbratwurst Block","short":"REN","city":"Suhl","gender":"W","colors":{"shirt":"#004a59","shirt2":"#8ed1fc","libero":"#1e2a4a"},"liberoEstimated":false,"ovr":84},
            {"name":"Schloss Volley Schwerin","sponsor":"Fischbrötchen Netzkante","short":"SLS","city":"Schwerin","gender":"W","colors":{"shirt":"#f5e100","shirt2":"#1e3fa8","libero":"#1f5fc0"},"liberoEstimated":false,"ovr":81},
            {"name":"Elbflorenz Volley","short":"ELB","city":"Dresde","gender":"W","colors":{"shirt":"#111111","shirt2":"#c8102e","libero":"#1c2a4a"},"liberoEstimated":false,"ovr":80},
            {"name":"Volley Monasterium","short":"MON","city":"Münster","gender":"W","colors":{"shirt":"#007a3d","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":76},
            {"name":"Aquis Schwarz","short":"AQS","city":"Aquisgrán","gender":"W","colors":{"shirt":"#111111","shirt2":"#ffffff","libero":"#f39a4a"},"liberoEstimated":false,"ovr":76}
        ] },
        { lvl: 2, name: "Bundesvolley 2", short: "BV2", strength: 68, clubs: [
            {"name":"Ammersee Wellenbrecher","sponsor":"Seguros Tie-Break","short":"AMW","city":"Herrsching","gender":"M","colors":{"shirt":"#1b365d","shirt2":"#ffffff","libero":"#1f3a7a"},"liberoEstimated":false,"ovr":72},
            {"name":"Schwarzwald Volley Freiburg","short":"SWF","city":"Friburgo","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":71},
            {"name":"Netzspringer KW","short":"NSP","city":"Königs Wusterhausen","gender":"M","colors":{"shirt":"#3baa35","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":70},
            {"name":"Fächerstadt Volleys","short":"FCH","city":"Karlsruhe","gender":"M","colors":{"shirt":"#ffd500","shirt2":"#e2001a","libero":"#e8eaee"},"liberoEstimated":false,"ovr":69},
            {"name":"Isar Volleys Haching","short":"ISH","city":"Unterhaching","gender":"M","colors":{"shirt":"#e2001a","shirt2":"#003a80","libero":"#ffffff"},"liberoEstimated":true,"ovr":68},
            {"name":"Leuchtturm Volley","short":"LTV","city":"Warnemünde (Rostock)","gender":"M","colors":{"shirt":"#004b87","shirt2":"#ffffff","libero":"#f39200"},"liberoEstimated":true,"ovr":66},
            {"name":"Kurstadt Volley Wiesbaden","short":"KUR","city":"Wiesbaden","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#f0306e"},"liberoEstimated":false,"ovr":71},
            {"name":"Erfurt Domvolleys","short":"EDV","city":"Erfurt","gender":"W","colors":{"shirt":"#111111","shirt2":"#ffffff","libero":"#2e9e5b"},"liberoEstimated":false,"ovr":69},
            {"name":"Blaufüchse Flacht","sponsor":"Klempnerei Aufschlag","short":"BFX","city":"Weissach-Flacht","gender":"W","colors":{"shirt":"#1d4fa0","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":65},
            {"name":"Aa-Volleys Borken","sponsor":"Senferei Pritsche","short":"AAV","city":"Borken","gender":"W","colors":{"shirt":"#f07d00","shirt2":"#1a1a1a","libero":"#ffffff"},"liberoEstimated":false,"ovr":64},
            {"name":"Elbhafen Volley Hamburg","short":"EHV","city":"Hamburgo","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":62}
        ] }
      ] },
      { country: "España", code: "ES", tier: 3, divisions: [
        { lvl: 1, name: "Hiperliga", short: "HPL", strength: 72, clubs: [
            {"name":"Voley Roque Nublo","sponsor":"Gofio La Plancha","short":"RNB","city":"Las Palmas de Gran Canaria","gender":"M","colors":{"shirt":"#ffe900","shirt2":"#002fa7","libero":"#ffffff"},"liberoEstimated":false,"ovr":75},
            {"name":"Voley Numantia Soria","sponsor":"Torreznos El Remate","short":"NUM","city":"Soria","gender":"M","colors":{"shirt":"#7a1e48","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":73},
            {"name":"Vóley Rusadir","short":"RUS","city":"Melilla","gender":"M","colors":{"shirt":"#2e64fe","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":71},
            {"name":"Vòlei Manacor","sponsor":"Ensaïmades Es Bloqueig","short":"MAN","city":"Manacor","gender":"M","colors":{"shirt":"#e60026","shirt2":"#000000","libero":"#8e5cc8"},"liberoEstimated":false,"ovr":70},
            {"name":"Voley Lagunero","short":"LAG","city":"San Cristóbal de La Laguna","gender":"M","colors":{"shirt":"#1f4e9e","shirt2":"#ffffff","libero":"#4fa8e0"},"liberoEstimated":true,"ovr":67},
            {"name":"Voley Turia","sponsor":"Chanclas Supersónicas","short":"TUA","city":"Teruel","gender":"M","colors":{"shirt":"#e55206","shirt2":"#1a1a1a","libero":"#ffffff"},"liberoEstimated":false,"ovr":67},
            {"name":"Vòlei Ciutadellenc","sponsor":"Formatges Es Mur","short":"CIU","city":"Ciutadella de Menorca","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#1b2a4a"},"liberoEstimated":false,"ovr":73},
            {"name":"Voley Hispalis","sponsor":"Churrería El Saque","short":"HIS","city":"Sevilla","gender":"W","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#e0409a"},"liberoEstimated":false,"ovr":72},
            {"name":"Voley Tamarán","sponsor":"Mojo Picón La Red","short":"TAM","city":"Las Palmas de Gran Canaria","gender":"W","colors":{"shirt":"#ffd100","shirt2":"#005bac","libero":"#c9b3e6"},"liberoEstimated":false,"ovr":70},
            {"name":"Voley Vegueta","sponsor":"Talleres La Colocación","short":"VEG","city":"Las Palmas de Gran Canaria","gender":"W","colors":{"shirt":"#005bac","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":69},
            {"name":"Voley Jarrero","sponsor":"Bodegas La Diagonal","short":"JAR","city":"Haro","gender":"W","colors":{"shirt":"#7b1e3a","shirt2":"#ffffff","libero":"#e86a92"},"liberoEstimated":true,"ovr":68},
            {"name":"Vòlei Santcugatenc","sponsor":"Forn de Pa La Recepció","short":"SCG","city":"Sant Cugat del Vallès","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#111111","libero":"#ffffff"},"liberoEstimated":true,"ovr":67}
        ] },
        { lvl: 2, name: "Hiperliga 2", short: "HL2", strength: 60, clubs: [
            {"name":"Rei en Jaume Vòlei","short":"RJV","city":"Valencia","gender":"M","colors":{"shirt":"#f28c00","shirt2":"#1a1a1a","libero":"#f4b6c4"},"liberoEstimated":false,"ovr":64},
            {"name":"Voley Indalo","sponsor":"Tomates El Líbero","short":"IND","city":"Almería","gender":"M","colors":{"shirt":"#3f8f00","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":63},
            {"name":"Voley Pepinero","sponsor":"Fotocopias La Finta","short":"PEP","city":"Leganés","gender":"M","colors":{"shirt":"#00305e","shirt2":"#ffffff","libero":"#f39200"},"liberoEstimated":true,"ovr":62},
            {"name":"Voley Benidormí","sponsor":"Hamacas El Ace","short":"BND","city":"Benidorm","gender":"M","colors":{"shirt":"#0072bc","shirt2":"#ffd100","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":61},
            {"name":"Voley Sanroqueño","sponsor":"Autoescuela La Rotación","short":"SRQ","city":"San Roque","gender":"M","colors":{"shirt":"#003da5","shirt2":"#ffffff","libero":"#e53935"},"liberoEstimated":true,"ovr":60},
            {"name":"Vòlei Tàrraco","sponsor":"Romesco La Dejada","short":"TRC","city":"Tarragona","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":58},
            {"name":"Voley Nivaria","sponsor":"Plátanos El Pipe","short":"NIV","city":"San Cristóbal de La Laguna","gender":"W","colors":{"shirt":"#1e50a0","shirt2":"#ffffff","libero":"#f39200"},"liberoEstimated":true,"ovr":64},
            {"name":"Voley Isleta","sponsor":"Sancocho El Flotante","short":"ISL","city":"Las Palmas de Gran Canaria","gender":"W","colors":{"shirt":"#00a3e0","shirt2":"#ffffff","libero":"#e4002b"},"liberoEstimated":true,"ovr":63},
            {"name":"Voley Lucus","sponsor":"Pulpería El Bloqueo","short":"LUC","city":"Lugo","gender":"W","colors":{"shirt":"#0033cc","shirt2":"#ffffff","libero":"#e8708a"},"liberoEstimated":true,"ovr":62},
            {"name":"Voley Socuellamino","sponsor":"Quesos El Contraataque","short":"SOC","city":"Socuéllamos","gender":"W","colors":{"shirt":"#ffd100","shirt2":"#1a1a1a","libero":"#ffffff"},"liberoEstimated":true,"ovr":60},
            {"name":"Voley Chicharrero","sponsor":"Barraquito El Toque","short":"CHT","city":"Santa Cruz de Tenerife","gender":"W","colors":{"shirt":"#1e50a0","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":58},
            {"name":"Voley Alcobendense","sponsor":"Colchones La Zambullida","short":"ALB","city":"Alcobendas","gender":"W","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#2456c8"},"liberoEstimated":false,"ovr":57}
        ] }
      ] },
      { country: "Bélgica", code: "BE", tier: 3, divisions: [
        { lvl: 1, name: "Ligue Volley Belga", short: "LVB", strength: 64, clubs: [
            {"name":"Voley Maaseik","sponsor":"Bakkerij Den Ace","short":"MAA","city":"Maaseik","gender":"M","colors":{"shirt":"#e2001a","shirt2":"#ffffff","libero":"#1e8b4c"},"liberoEstimated":false,"ovr":68},
            {"name":"Voley Mandel","sponsor":"Rodilleras Rodríguez","short":"MDL","city":"Roeselare","gender":"M","colors":{"shirt":"#151b54","shirt2":"#ffffff","libero":"#f2f6fa"},"liberoEstimated":false,"ovr":68},
            {"name":"Menen Vauban","sponsor":"Mosselhuis De Muur","short":"MEN","city":"Menen","gender":"M","colors":{"shirt":"#6bc048","shirt2":"#000000","libero":"#ffffff"},"liberoEstimated":false,"ovr":64},
            {"name":"Ajuin Aalst","sponsor":"Frituur De Smash","short":"AAL","city":"Aalst","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#000000","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":62},
            {"name":"Voley Leuven","short":"LEU","city":"Lovaina (Heverlee)","gender":"M","colors":{"shirt":"#1d4e9e","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":66},
            {"name":"Voley Beveren","short":"BEV","city":"Beveren (Kieldrecht)","gender":"W","colors":{"shirt":"#e30613","shirt2":"#000000","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":64},
            {"name":"Voley Oudegem","short":"OUD","city":"Oudegem (Dendermonde)","gender":"W","colors":{"shirt":"#1c0060","shirt2":"#ff0fbb","libero":"#1f2547"},"liberoEstimated":false,"ovr":58},
            {"name":"Voley Carolo","short":"CRL","city":"Charleroi","gender":"W","colors":{"shirt":"#000000","shirt2":"#ffffff","libero":"#f2603a"},"liberoEstimated":true,"ovr":57},
            {"name":"Voley Chapelle","sponsor":"Fromagerie Le Contre","short":"CHP","city":"Chapelle-lez-Herlaimont","gender":"W","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#f2c230"},"liberoEstimated":false,"ovr":56}
        ] }
      ] },
      { country: "Países Bajos", code: "NL", tier: 4, divisions: [
        { lvl: 1, name: "Eredivisión", short: "ERD", strength: 59, clubs: [
            {"name":"Sirius Doetinchem","short":"SIR","city":"Doetinchem","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":63},
            {"name":"Wetgevers Groningen","sponsor":"Bakkerij Bovenhands","short":"WTG","city":"Groninga","gender":"M","colors":{"shirt":"#0d57ff","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":62},
            {"name":"Magneto Apeldoorn","sponsor":"Matrassen Duikbal","short":"MAG","city":"Apeldoorn","gender":"M","colors":{"shirt":"#f5c400","shirt2":"#000000","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":60},
            {"name":"Voley Barneveld","sponsor":"Eierhandel De Opslag","short":"BAR","city":"Barneveld","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":56},
            {"name":"Voley Sliedrecht","short":"SLI","city":"Sliedrecht","gender":"MW","colors":{"shirt":"#ffffff","shirt2":"#000040","libero":"#2e9e4f"},"liberoEstimated":false,"ovr":63},
            {"name":"Artemis 8 Borne","short":"ART","city":"Borne","gender":"W","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#f0559a"},"liberoEstimated":true,"ovr":63},
            {"name":"Voley Sneek","sponsor":"Haringkar Het Blok","short":"SNE","city":"Sneek","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f2f4f8"},"liberoEstimated":true,"ovr":58},
            {"name":"Peelpower Meijel","sponsor":"Seguros Tie-Break","short":"PPW","city":"Meijel","gender":"W","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#1e3a8a"},"liberoEstimated":true,"ovr":57}
        ] }
      ] },
      { country: "Grecia", code: "GR", tier: 3, divisions: [
        { lvl: 1, name: "Liga Helénica", short: "LHE", strength: 65, clubs: [
            {"name":"Panatenea Atenas","short":"PNT","city":"Atenas","gender":"MW","colors":{"shirt":"#134a29","shirt2":"#ffffff","libero":"#6a3fa0"},"liberoEstimated":false,"ovr":70},
            {"name":"Thrylos Pireo","short":"THR","city":"El Pireo","gender":"MW","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#1f2d5a"},"liberoEstimated":false,"ovr":70},
            {"name":"Dikéfalos Salónica","short":"DKS","city":"Salónica","gender":"MW","colors":{"shirt":"#000000","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":68},
            {"name":"Prosfyges Nea Smirni","short":"MNS","city":"Nea Smyrni (Atenas)","gender":"MW","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f06ca8"},"liberoEstimated":false,"ovr":63},
            {"name":"Fénix Syros","short":"FNX","city":"Ermúpoli (Siros)","gender":"M","colors":{"shirt":"#ff0000","shirt2":"#000080","libero":"#ffffff"},"liberoEstimated":false,"ovr":62},
            {"name":"Voley Kefalari","short":"KEF","city":"Kifisiá (Atenas)","gender":"MW","colors":{"shirt":"#0b3d91","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":60},
            {"name":"Enosis Atenas","short":"ENO","city":"Atenas","gender":"W","colors":{"shirt":"#ffd200","shirt2":"#000000","libero":"#6b3fa0"},"liberoEstimated":false,"ovr":64},
            {"name":"Voley Santorini","short":"SAN","city":"Fira (Santorini)","gender":"W","colors":{"shirt":"#0ea5e9","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":60},
            {"name":"Nereida Voula","short":"NER","city":"Voula (Atenas)","gender":"W","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#f06ba8"},"liberoEstimated":false,"ovr":58},
            {"name":"Ares Tesalónica","short":"ARE","city":"Salónica","gender":"W","colors":{"shirt":"#ffd200","shirt2":"#000000","libero":"#f26b21"},"liberoEstimated":true,"ovr":58}
        ] }
      ] },
      { country: "Portugal", code: "PT", tier: 4, divisions: [
        { lvl: 1, name: "Liga Lusa de Vólei", short: "LLV", strength: 60, clubs: [
            {"name":"Leão Lisboa","short":"LEA","city":"Lisboa","gender":"MW","colors":{"shirt":"#008057","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":66},
            {"name":"Águia Lisboa","short":"AGL","city":"Lisboa","gender":"MW","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#d8c9b0"},"liberoEstimated":false,"ovr":66},
            {"name":"Dragão Porto","short":"DRA","city":"Oporto","gender":"W","colors":{"shirt":"#0122eb","shirt2":"#ffffff","libero":"#6e2c45"},"liberoEstimated":false,"ovr":63},
            {"name":"Arsenalistas Braga","short":"ARS","city":"Braga","gender":"W","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":60},
            {"name":"Vólei Matosinhos","short":"MAT","city":"Matosinhos","gender":"MW","colors":{"shirt":"#ff0000","shirt2":"#ffffff","libero":"#1e3a8a"},"liberoEstimated":true,"ovr":59},
            {"name":"Vólei Espinho","short":"ESP","city":"Espinho","gender":"M","colors":{"shirt":"#000000","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":57},
            {"name":"Tigres Espinho","short":"TIG","city":"Espinho","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#000000","libero":"#f59e0b"},"liberoEstimated":true,"ovr":56},
            {"name":"Conquistadores Guimarães","short":"GUI","city":"Guimarães","gender":"MW","colors":{"shirt":"#ffffff","shirt2":"#000000","libero":"#d4af37"},"liberoEstimated":true,"ovr":56},
            {"name":"Vólei Maia","short":"MAI","city":"Maia","gender":"MW","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f59e0b"},"liberoEstimated":true,"ovr":54}
        ] }
      ] },
      { country: "Suiza", code: "CH", tier: 4, divisions: [
        { lvl: 1, name: "Liga Helvética", short: "LHV", strength: 57, clubs: [
            {"name":"Thurgovia Amriswil","sponsor":"Käserei Blockstark","short":"AMR","city":"Amriswil","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f5d000"},"liberoEstimated":false,"ovr":62},
            {"name":"Linth Näfels","short":"NAF","city":"Näfels","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffd200","libero":"#f26a2e"},"liberoEstimated":false,"ovr":60},
            {"name":"Aare Schönenwerd","short":"SWD","city":"Schönenwerd","gender":"M","colors":{"shirt":"#000000","shirt2":"#ffd200","libero":"#f5d80f"},"liberoEstimated":false,"ovr":58},
            {"name":"Obersee Jona","short":"JON","city":"Rapperswil-Jona","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":56},
            {"name":"Chênaie Genève","short":"CHN","city":"Chêne-Bourg (Ginebra)","gender":"M","colors":{"shirt":"#7a1f2b","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":55},
            {"name":"Voley Neuchâtel","sponsor":"Fondue Le Bloc","short":"NEU","city":"Neuchâtel","gender":"W","colors":{"shirt":"#f07d00","shirt2":"#000000","libero":"#a8ddd5"},"liberoEstimated":false,"ovr":62},
            {"name":"Voley Aesch","short":"AES","city":"Aesch (Basilea-Campiña)","gender":"W","colors":{"shirt":"#ff69b4","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":59},
            {"name":"Panteras Düdingen","short":"DUD","city":"Düdingen","gender":"W","colors":{"shirt":"#1a1a1a","shirt2":"#e5007d","libero":"#d6336c"},"liberoEstimated":false,"ovr":58},
            {"name":"Voley Schaffhausen","short":"SHF","city":"Schaffhausen","gender":"W","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#8ed1c6"},"liberoEstimated":false,"ovr":57},
            {"name":"Voley Lemán","sponsor":"Fromagerie La Manchette","short":"GIN","city":"Ginebra","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#f2c200","libero":"#e5487f"},"liberoEstimated":true,"ovr":56}
        ] }
      ] },
      { country: "Austria", code: "AT", tier: 4, divisions: [
        { lvl: 1, name: "Liga Austrovolley", short: "LAV", strength: 54, clubs: [
            {"name":"Voley Hartberg","short":"HAR","city":"Hartberg","gender":"M","colors":{"shirt":"#0033a0","shirt2":"#ff6600","libero":"#f0f0f0"},"liberoEstimated":false,"ovr":61},
            {"name":"Voley Aich-Dob","sponsor":"Bäckerei Aufschlag","short":"AID","city":"Bleiburg","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffd200","libero":"#e2231a"},"liberoEstimated":false,"ovr":58},
            {"name":"Voley Waldviertel","sponsor":"Erdäpfel Netzroller","short":"WAL","city":"Zwettl","gender":"M","colors":{"shirt":"#e30613","shirt2":"#000000","libero":"#e32b2b"},"liberoEstimated":false,"ovr":56},
            {"name":"Voley Ried","sponsor":"Wirtshaus Zum Ass","short":"RIE","city":"Ried im Innkreis","gender":"M","colors":{"shirt":"#00843d","shirt2":"#000000","libero":"#e6e6e6"},"liberoEstimated":true,"ovr":55},
            {"name":"Voley Linz","short":"LIN","city":"Linz","gender":"W","colors":{"shirt":"#ffd200","shirt2":"#000000","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":57},
            {"name":"Falke Wien","short":"FAL","city":"Viena","gender":"MW","colors":{"shirt":"#0033a0","shirt2":"#ffd200","libero":"#f5c800"},"liberoEstimated":true,"ovr":56},
            {"name":"Voley Erzberg","short":"ERZ","city":"Trofaiach","gender":"W","colors":{"shirt":"#7a1f2b","shirt2":"#ffffff","libero":"#1e2a4a"},"liberoEstimated":false,"ovr":55},
            {"name":"Voley Graz","sponsor":"Chanclas Supersónicas","short":"GRA","city":"Graz","gender":"MW","colors":{"shirt":"#000000","shirt2":"#ffffff","libero":"#3ddc3d"},"liberoEstimated":false,"ovr":54}
        ] }
      ] },
      { country: "Chequia", code: "CZ", tier: 4, divisions: [
        { lvl: 1, name: "Extravolej", short: "EXV", strength: 59, clubs: [
            {"name":"Voley Carlsbad","sponsor":"Oplatky Smeč","short":"CAR","city":"Karlovy Vary","gender":"M","colors":{"shirt":"#ffd200","shirt2":"#000000","libero":"#1e40af"},"liberoEstimated":true,"ovr":63},
            {"name":"Leones de Praga","short":"LEO","city":"Praga","gender":"MW","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":61},
            {"name":"Voley Budějovice","sponsor":"Knedlíkárna Blok","short":"BUD","city":"České Budějovice","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f59e0b"},"liberoEstimated":true,"ovr":60},
            {"name":"Voley Kladensko","short":"KLA","city":"Kladno","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#0033a0","libero":"#ffffff"},"liberoEstimated":true,"ovr":56},
            {"name":"Voley Liberec","short":"LIB","city":"Liberec","gender":"MW","colors":{"shirt":"#ffd200","shirt2":"#800000","libero":"#1e40af"},"liberoEstimated":true,"ovr":60},
            {"name":"Fieras Brno","short":"FIE","city":"Brno","gender":"W","colors":{"shirt":"#6b21a8","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":59},
            {"name":"Voley Prostějov","short":"PRO","city":"Prostějov","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#e30613"},"liberoEstimated":true,"ovr":59},
            {"name":"Voley Olomouc","short":"OLO","city":"Olomouc","gender":"W","colors":{"shirt":"#1d4ed8","shirt2":"#ff6600","libero":"#ffffff"},"liberoEstimated":true,"ovr":57},
            {"name":"Campo Real Brno","short":"CRB","city":"Brno","gender":"W","colors":{"shirt":"#0b3d91","shirt2":"#f2c200","libero":"#ffffff"},"liberoEstimated":true,"ovr":56}
        ] }
      ] },
      { country: "Serbia", code: "RS", tier: 3, divisions: [
        { lvl: 1, name: "Hiperliga Srbija", short: "HLS", strength: 62, clubs: [
            {"name":"Panonia Novi Sad","sponsor":"Pekara Smeč","short":"PNS","city":"Novi Sad","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#e31937","libero":"#1e3a8a"},"liberoEstimated":true,"ovr":63},
            {"name":"Crno-Beli Beograd","short":"CBB","city":"Belgrado","gender":"MW","colors":{"shirt":"#000000","shirt2":"#ffffff","libero":"#d4af37"},"liberoEstimated":true,"ovr":62},
            {"name":"Crvena Zora","short":"CZO","city":"Belgrado","gender":"MW","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#1e3a8a"},"liberoEstimated":true,"ovr":62},
            {"name":"Voley Kragujevac","short":"KRA","city":"Kragujevac","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#1e3a8a"},"liberoEstimated":true,"ovr":58},
            {"name":"Voley Novi Pazar","short":"NPZ","city":"Novi Pazar","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":57},
            {"name":"Voley Obrenovac","sponsor":"Ćevapi Kod Bloka","short":"OBR","city":"Obrenovac","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f59e0b"},"liberoEstimated":true,"ovr":62},
            {"name":"Voley Ub","short":"UBB","city":"Ub","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":59},
            {"name":"Ferroviario Lajkovac","short":"FER","city":"Lajkovac","gender":"W","colors":{"shirt":"#0033a0","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":59},
            {"name":"Voley Užice","short":"UZI","city":"Užice","gender":"W","colors":{"shirt":"#0033a0","shirt2":"#c8102e","libero":"#ffffff"},"liberoEstimated":true,"ovr":57}
        ] }
      ] },
      { country: "Eslovenia", code: "SI", tier: 4, divisions: [
        { lvl: 1, name: "Odbojka Liga 1", short: "OL1", strength: 58, clubs: [
            {"name":"Zmaji Ljubljana","sponsor":"Mesnica Bloker","short":"ZMA","city":"Liubliana","gender":"M","colors":{"shirt":"#ff8a00","shirt2":"#1e3c94","libero":"#ffffff"},"liberoEstimated":true,"ovr":66},
            {"name":"Voley Kamnik","sponsor":"Mlekarna Sprejem","short":"KAM","city":"Kamnik","gender":"MW","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":58},
            {"name":"Voley Kanal","sponsor":"Vodoinštalater Servis","short":"KNL","city":"Kanal ob Soči","gender":"M","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#f97316"},"liberoEstimated":true,"ovr":58},
            {"name":"Voley Maribor","sponsor":"Vinoteka Visoka Žoga","short":"MBR","city":"Maribor","gender":"M","colors":{"shirt":"#0047ab","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":56},
            {"name":"Voley Mura","sponsor":"Chanclas Supersónicas","short":"MRA","city":"Murska Sobota","gender":"M","colors":{"shirt":"#00843d","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":55},
            {"name":"Pohorje Maribor","sponsor":"Pekarna Pri Mreži","short":"VIJ","city":"Maribor","gender":"W","colors":{"shirt":"#5b2c83","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":60},
            {"name":"Voley Nova Gorica","sponsor":"Pršutarna Pri Bloku","short":"NGO","city":"Nova Gorica","gender":"W","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#e5007d"},"liberoEstimated":true,"ovr":58},
            {"name":"Capodistria Volley","sponsor":"Ribarnica Blok","short":"CAP","city":"Koper","gender":"W","colors":{"shirt":"#0ea5e9","shirt2":"#ffffff","libero":"#f97316"},"liberoEstimated":true,"ovr":56}
        ] }
      ] },
      { country: "Rumanía", code: "RO", tier: 4, divisions: [
        { lvl: 1, name: "Divizia Alfa", short: "DAL", strength: 60, clubs: [
            {"name":"Voley Galați","short":"GLT","city":"Galați","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":61},
            {"name":"Stelele București","short":"STE","city":"Bucarest","gender":"M","colors":{"shirt":"#d2001f","shirt2":"#0033a0","libero":"#ffd200"},"liberoEstimated":true,"ovr":59},
            {"name":"Voley Zalău","short":"ZAL","city":"Zalău","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#e30613"},"liberoEstimated":true,"ovr":58},
            {"name":"Voley Dej","short":"DEJ","city":"Dej","gender":"M","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#1e3a8a"},"liberoEstimated":true,"ovr":57},
            {"name":"Voley Blaj","short":"BLA","city":"Blaj","gender":"W","colors":{"shirt":"#ffffff","shirt2":"#ff0000","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":63},
            {"name":"Voley Voluntari","short":"VOL","city":"Voluntari","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#f2c200","libero":"#ffffff"},"liberoEstimated":true,"ovr":62},
            {"name":"Câinii Bucarest","short":"CAI","city":"Bucarest","gender":"MW","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#1e3a8a"},"liberoEstimated":true,"ovr":62},
            {"name":"Voley Brașov","short":"BRS","city":"Brașov","gender":"MW","colors":{"shirt":"#ffd200","shirt2":"#000000","libero":"#e30613"},"liberoEstimated":true,"ovr":59},
            {"name":"Voley Bucarest","short":"VBU","city":"Bucarest","gender":"MW","colors":{"shirt":"#0ea5e9","shirt2":"#1a1a1a","libero":"#f2c200"},"liberoEstimated":true,"ovr":57}
        ] }
      ] }
    ], competitions: [
      {"name":"Champions Cup VEC","short":"CCV","kind":"intl","rank":1},
      {"name":"Copa VEC","short":"CVC","kind":"intl","rank":2},
      {"name":"Challenge VEC","short":"CHV","kind":"intl","rank":3},
      {"name":"Mundial de Clubes VBF","short":"MCV","kind":"skip"},
      {"name":"VBN","short":"VBN","kind":"skip"},
      {"name":"Europeo VEC","short":"EUV","kind":"skip"},
      {"name":"Mundial VBF","short":"MUV","kind":"skip"},
      {"name":"Juegos Cuatrienales","short":"JCU","kind":"skip"},
      {"name":"Coppa Tricolore","short":"CTC","kind":"cup","country":"IT"},
      {"name":"Puchar Orła","short":"PUO","kind":"cup","country":"PL"},
      {"name":"Hilal Kupası","short":"HLK","kind":"cup","country":"TR"},
      {"name":"Kubok Volgi","short":"KVG","kind":"cup","country":"RU"},
      {"name":"Copa del Trono","short":"CDT","kind":"cup","country":"ES"},
      {"name":"Hipercopa","short":"HPC","kind":"skip"},
      {"name":"Copa Delfín","short":"CDF","kind":"skip"},
      {"name":"Coupe Hexagone","short":"CHX","kind":"cup","country":"FR"},
      {"name":"Supercoupe Smash","short":"SCS","kind":"skip"},
      {"name":"Netzpokal","short":"BPV","kind":"cup","country":"DE"},
      {"name":"Hyper-Cup","short":"HYC","kind":"skip"},
      {"name":"Copa BeNeVol","short":"BNV","kind":"skip"},
      {"name":"Liga Alpes-Panonia","short":"LAP","kind":"skip"},
      {"name":"Copa Belvolley","short":"CBV","kind":"cup","country":"BE"},
      {"name":"Copa Tulipán","short":"CTU","kind":"cup","country":"NL"},
      {"name":"Copa Helénica","short":"CHE","kind":"cup","country":"GR"},
      {"name":"Taça Lusa","short":"TLU","kind":"cup","country":"PT"},
      {"name":"Copa Helvética","short":"CHL","kind":"cup","country":"CH"},
      {"name":"Copa Austrovolley","short":"CAV","kind":"cup","country":"AT"},
      {"name":"Copa Vltava","short":"CBO","kind":"cup","country":"CZ"},
      {"name":"Copa Šumadija","short":"CSR","kind":"cup","country":"RS"},
      {"name":"Copa Alpes Julianos","short":"CTR","kind":"cup","country":"SI"},
      {"name":"Copa Transilvania","short":"CCP","kind":"cup","country":"RO"}
    ] },
    { region: "América", countries: [
      { country: "Brasil", code: "BR", tier: 1, divisions: [
        { lvl: 1, name: "Hiperliga Brasil", short: "HLB", strength: 88, clubs: [
            {"name":"Vôlei Celeste","sponsor":"Pão de Queijo Cortada","short":"CEL","city":"Contagem (Belo Horizonte)","gender":"M","colors":{"shirt":"#0b3d91","shirt2":"#ffffff","libero":"#1f5bc6"},"liberoEstimated":true,"ovr":93},
            {"name":"Areia Clube","sponsor":"Açaí Bloqueio","short":"ARC","city":"Uberlândia","gender":"MW","colors":{"shirt":"#f2de1b","shirt2":"#111111","libero":"#111111"},"liberoEstimated":false,"ovr":91},
            {"name":"Minas Raquete Clube","sponsor":"Colchões Recepção Macia","short":"MRC","city":"Belo Horizonte","gender":"MW","colors":{"shirt":"#0c2a6b","shirt2":"#ffffff","libero":"#1f4fb8"},"liberoEstimated":false,"ovr":91},
            {"name":"Vôlei Taquaral","sponsor":"Pastelaria Saque Viagem","short":"TAQ","city":"Campinas","gender":"M","colors":{"shirt":"#1e4fa3","shirt2":"#ffffff","libero":"#c9d531"},"liberoEstimated":false,"ovr":89},
            {"name":"Bauru Sem Limites","sponsor":"Coxinha do Levantador","short":"BSL","city":"Bauru","gender":"MW","colors":{"shirt":"#1a1a1a","shirt2":"#ffffff","libero":"#d7262b"},"liberoEstimated":false,"ovr":86},
            {"name":"Vôlei Osasquense","sponsor":"Rodilleras Rodríguez","short":"OSQ","city":"Osasco","gender":"W","colors":{"shirt":"#a53b57","shirt2":"#111111","libero":"#f26b1d"},"liberoEstimated":false,"ovr":87},
            {"name":"Urubu Rio","sponsor":"Biscoito Largadinha","short":"URU","city":"Rio de Janeiro","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#111111","libero":"#6ca8dc"},"liberoEstimated":false,"ovr":88},
            {"name":"Laranjeiras Tricolor","short":"LTR","city":"Rio de Janeiro","gender":"W","colors":{"shirt":"#8a1538","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":83},
            {"name":"Vôlei Carmelitano","short":"CML","city":"Monte Carmelo","gender":"M","colors":{"shirt":"#0b0427","shirt2":"#ffffff","libero":"#f54334"},"liberoEstimated":true,"ovr":81},
            {"name":"Vôlei Suzanense","short":"SUZ","city":"Suzano","gender":"M","colors":{"shirt":"#d71920","shirt2":"#ffffff","libero":"#1d3c8f"},"liberoEstimated":true,"ovr":83},
            {"name":"Vôlei Guaru","sponsor":"Oficina Mecânica Cravada","short":"GRU","city":"Guarulhos","gender":"M","colors":{"shirt":"#165197","shirt2":"#ffffff","libero":"#f7b500"},"liberoEstimated":true,"ovr":82},
            {"name":"Vôlei Cidade Canção","sponsor":"Padaria Meio de Rede","short":"CCA","city":"Maringá","gender":"W","colors":{"shirt":"#bb025f","shirt2":"#050505","libero":"#34a961"},"liberoEstimated":true,"ovr":81}
        ] },
        { lvl: 2, name: "Hiperliga B", short: "HLB2", strength: 73, clubs: [
            {"name":"Aeroespacial Vôlei","sponsor":"Sardinhas do Rodízio","short":"SJC","city":"São José dos Campos","gender":"M","colors":{"shirt":"#1d3a8f","shirt2":"#74b843","libero":"#e6007e"},"liberoEstimated":false,"ovr":76},
            {"name":"Vôlei Goianiense","sponsor":"Pamonharia Bloqueio Duplo","short":"GOI","city":"Goiânia","gender":"M","colors":{"shirt":"#00563b","shirt2":"#ffffff","libero":"#e2f21e"},"liberoEstimated":false,"ovr":78},
            {"name":"Vôlei Juizforano","short":"JFV","city":"Juiz de Fora","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#233ca7","libero":"#821b07"},"liberoEstimated":false,"ovr":72},
            {"name":"Vôlei Cidade das Flores","short":"FLO","city":"Joinville","gender":"M","colors":{"shirt":"#1b4da0","shirt2":"#ffffff","libero":"#f5a623"},"liberoEstimated":true,"ovr":73},
            {"name":"Vôlei Montesclarense","short":"MOC","city":"Montes Claros","gender":"M","colors":{"shirt":"#bdbc02","shirt2":"#2c4a41","libero":"#ffffff"},"liberoEstimated":true,"ovr":71},
            {"name":"Vôlei Alencarino","short":"ALE","city":"Fortaleza","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#ffc20e"},"liberoEstimated":true,"ovr":70},
            {"name":"Vôlei Barueriense","sponsor":"Vassouras Fundo de Quadra","short":"BRU","city":"Barueri","gender":"W","colors":{"shirt":"#d3001a","shirt2":"#ffffff","libero":"#cebfd0"},"liberoEstimated":false,"ovr":75},
            {"name":"Vôlei Mack BH","sponsor":"Chanclas Supersónicas","short":"MCK","city":"Belo Horizonte","gender":"W","colors":{"shirt":"#fefdfa","shirt2":"#000000","libero":"#ddb92f"},"liberoEstimated":false,"ovr":76},
            {"name":"Vôlei Candango","short":"CDG","city":"Brasília (Taguatinga)","gender":"W","colors":{"shirt":"#073d2f","shirt2":"#000000","libero":"#ff9c0a"},"liberoEstimated":false,"ovr":73},
            {"name":"Vôlei Tijucano","short":"TIJ","city":"Rio de Janeiro","gender":"W","colors":{"shirt":"#ffffff","shirt2":"#d0021b","libero":"#1f4e9e"},"liberoEstimated":true,"ovr":72},
            {"name":"Vôlei Sorocabano","short":"SOR","city":"Sorocaba","gender":"W","colors":{"shirt":"#000000","shirt2":"#e6ce38","libero":"#ffffff"},"liberoEstimated":true,"ovr":70},
            {"name":"Araucárias SP","short":"ARA","city":"São Paulo","gender":"W","colors":{"shirt":"#0033a0","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":71}
        ] }
      ] },
      { country: "Argentina", code: "AR", tier: 3, divisions: [
        { lvl: 1, name: "Liga Albiceleste", short: "LAB", strength: 65, clubs: [
            {"name":"Vóley Sanjuanino","sponsor":"Seguros Tie-Break","short":"SJN","city":"San Juan","gender":"M","colors":{"shirt":"#0047ab","shirt2":"#ffd100","libero":"#ffffff"},"liberoEstimated":false,"ovr":70},
            {"name":"Vóley Porteño","short":"POR","city":"Buenos Aires","gender":"M","colors":{"shirt":"#6cace4","shirt2":"#ffd100","libero":"#1e2a4a"},"liberoEstimated":true,"ovr":68},
            {"name":"Núñez Millonario","short":"NUN","city":"Buenos Aires (Núñez)","gender":"MW","colors":{"shirt":"#ffffff","shirt2":"#e1001a","libero":"#e1001a"},"liberoEstimated":true,"ovr":66},
            {"name":"Xeneize Vóley","short":"XEN","city":"Buenos Aires (La Boca)","gender":"MW","colors":{"shirt":"#003c82","shirt2":"#fdb913","libero":"#fdb913"},"liberoEstimated":false,"ovr":67},
            {"name":"Ciclón de Boedo","short":"CIC","city":"Buenos Aires (Boedo)","gender":"MW","colors":{"shirt":"#1f2a5c","shirt2":"#d2122e","libero":"#ffffff"},"liberoEstimated":true,"ovr":64},
            {"name":"Fortín Liniers","short":"FOR","city":"Buenos Aires (Liniers)","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#1d4f91","libero":"#111111"},"liberoEstimated":true,"ovr":62},
            {"name":"Naranja Monteros","short":"NAR","city":"Monteros (Tucumán)","gender":"M","colors":{"shirt":"#f47b20","shirt2":"#111111","libero":"#e8e8e8"},"liberoEstimated":false,"ovr":65},
            {"name":"Lobo Platense","short":"LOB","city":"La Plata","gender":"W","colors":{"shirt":"#ffffff","shirt2":"#001f5b","libero":"#1b1f4b"},"liberoEstimated":true,"ovr":65},
            {"name":"Pincha Platense","short":"PIN","city":"La Plata","gender":"W","colors":{"shirt":"#e30613","shirt2":"#ffffff","libero":"#111111"},"liberoEstimated":true,"ovr":64},
            {"name":"Naranjitas Riojanas","short":"NRJ","city":"La Rioja","gender":"W","colors":{"shirt":"#f58220","shirt2":"#ffffff","libero":"#2e9e48"},"liberoEstimated":false,"ovr":62}
        ] }
      ] },
      { country: "Estados Unidos", code: "US", tier: 3, divisions: [
        { lvl: 1, name: "Liga Estrellas USA", short: "LEU", strength: 68, clubs: [
            {"name":"Volley Austin","short":"AUS","city":"Austin","gender":"W","colors":{"shirt":"#5b2c83","shirt2":"#1b2240","libero":"#f4f1ea"},"liberoEstimated":false,"ovr":74},
            {"name":"Volley Houston","short":"HOU","city":"Houston","gender":"W","colors":{"shirt":"#8dc8e8","shirt2":"#13294b","libero":"#4cc38a"},"liberoEstimated":false,"ovr":73},
            {"name":"Volley Wasatch","short":"SLC","city":"Salt Lake City","gender":"W","colors":{"shirt":"#ffc72c","shirt2":"#13294b","libero":"#ffffff"},"liberoEstimated":true,"ovr":72},
            {"name":"Frisco Pulse","short":"FRI","city":"Frisco (Dallas)","gender":"W","colors":{"shirt":"#0b1f44","shirt2":"#00b5e2","libero":"#ffffff"},"liberoEstimated":false,"ovr":72},
            {"name":"Omaha Hypernovas","short":"OMA","city":"Omaha","gender":"W","colors":{"shirt":"#1b2a55","shirt2":"#ffffff","libero":"#f2f2f2"},"liberoEstimated":true,"ovr":71},
            {"name":"Orlando Asgard","short":"ORL","city":"Orlando","gender":"W","colors":{"shirt":"#1f3a70","shirt2":"#c9b48a","libero":"#2bb3b1"},"liberoEstimated":false,"ovr":71},
            {"name":"Manoa Arcoíris","short":"MNO","city":"Honolulu","gender":"M","colors":{"shirt":"#024731","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":68},
            {"name":"Irvine Aardvarks","short":"IRV","city":"Irvine","gender":"M","colors":{"shirt":"#0064a4","shirt2":"#ffd200","libero":"#ffffff"},"liberoEstimated":true,"ovr":67},
            {"name":"Volley Long Beach","short":"LBC","city":"Long Beach","gender":"M","colors":{"shirt":"#111111","shirt2":"#ffc72c","libero":"#111111"},"liberoEstimated":true,"ovr":67},
            {"name":"Westwood Grizzlies","short":"WWG","city":"Los Ángeles (Westwood)","gender":"M","colors":{"shirt":"#2d68c4","shirt2":"#f2a900","libero":"#ffffff"},"liberoEstimated":true,"ovr":65}
        ] }
      ] },
      { country: "Canadá", code: "CA", tier: 4, divisions: [
        { lvl: 1, name: "Liga del Arce", short: "LDA", strength: 56, clubs: [
            {"name":"Langley Espartanos","short":"LAN","city":"Langley (BC)","gender":"MW","colors":{"shirt":"#002d62","shirt2":"#c99700","libero":"#ffffff"},"liberoEstimated":true,"ovr":61},
            {"name":"Point Grey Thunderbolts","short":"PGT","city":"Vancouver","gender":"MW","colors":{"shirt":"#002145","shirt2":"#f2a900","libero":"#ffffff"},"liberoEstimated":true,"ovr":60},
            {"name":"Edmonton Golden Pandas","short":"EGP","city":"Edmonton","gender":"MW","colors":{"shirt":"#275d38","shirt2":"#f2cd00","libero":"#ffffff"},"liberoEstimated":true,"ovr":60},
            {"name":"Winnipeg Bisontes","short":"WPG","city":"Winnipeg","gender":"MW","colors":{"shirt":"#4a2c2a","shirt2":"#f2c200","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":57},
            {"name":"Sherbrooke Émeraude","short":"SHE","city":"Sherbrooke","gender":"W","colors":{"shirt":"#00573f","shirt2":"#ffc72c","libero":"#f5c518"},"liberoEstimated":false,"ovr":58},
            {"name":"Montréal Internes","short":"MTL","city":"Montreal","gender":"W","colors":{"shirt":"#0b2c6b","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":55},
            {"name":"Québec Rouge-Doré","short":"QRD","city":"Quebec","gender":"MW","colors":{"shirt":"#c8102e","shirt2":"#ffc72c","libero":"#ffffff"},"liberoEstimated":true,"ovr":55},
            {"name":"Calgary Rex","short":"REX","city":"Calgary","gender":"M","colors":{"shirt":"#d6001c","shirt2":"#ffcd00","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":56},
            {"name":"Saskatoon Malamutes","short":"SAS","city":"Saskatoon","gender":"MW","colors":{"shirt":"#006341","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":true,"ovr":54},
            {"name":"Hamilton Plunderers","short":"HAM","city":"Hamilton (ON)","gender":"M","colors":{"shirt":"#7a003c","shirt2":"#fdbf57","libero":"#cfcfcf"},"liberoEstimated":false,"ovr":55}
        ] }
      ] },
      { country: "Perú", code: "PE", tier: 4, divisions: [
        { lvl: 1, name: "Liga Inca de Vóley", short: "LIV", strength: 60, clubs: [
            {"name":"Íntimos Lima","short":"INT","city":"Lima (La Victoria)","gender":"W","colors":{"shirt":"#071241","shirt2":"#ffffff","libero":"#361b78"},"liberoEstimated":true,"ovr":66},
            {"name":"Fray Martín Vóley","short":"FMV","city":"Lima","gender":"W","colors":{"shirt":"#ffffff","shirt2":"#18161b","libero":"#1f4e9e"},"liberoEstimated":true,"ovr":65},
            {"name":"Cremas Lima","short":"CRE","city":"Lima","gender":"W","colors":{"shirt":"#f2e6c9","shirt2":"#8b1e2d","libero":"#f26b1f"},"liberoEstimated":false,"ovr":63},
            {"name":"Gemelos Comas","short":"GEM","city":"Lima (Comas)","gender":"W","colors":{"shirt":"#ffffff","shirt2":"#263680","libero":"#f2c200"},"liberoEstimated":true,"ovr":61},
            {"name":"Remo Chorrillos","short":"REM","city":"Lima (Chorrillos)","gender":"MW","colors":{"shirt":"#87ceeb","shirt2":"#ffffff","libero":"#1a2e6e"},"liberoEstimated":true,"ovr":62},
            {"name":"Minerva Lima","short":"MIN","city":"Lima","gender":"W","colors":{"shirt":"#5e2b7e","shirt2":"#ffffff","libero":"#f2c200"},"liberoEstimated":true,"ovr":59},
            {"name":"Tricolore Lima","short":"TRI","city":"Lima","gender":"W","colors":{"shirt":"#2e2efe","shirt2":"#ffffff","libero":"#008c45"},"liberoEstimated":true,"ovr":58},
            {"name":"Matemáticos Lima","short":"MTM","city":"Lima","gender":"M","colors":{"shirt":"#0b3c5d","shirt2":"#ffffff","libero":"#f2a900"},"liberoEstimated":true,"ovr":52},
            {"name":"Sin Par Lima","short":"SPL","city":"Lima","gender":"M","colors":{"shirt":"#1a1a1a","shirt2":"#e30613","libero":"#ffffff"},"liberoEstimated":true,"ovr":52},
            {"name":"Vóley Huanca","short":"HUA","city":"Huancayo","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#1f4e9e"},"liberoEstimated":true,"ovr":50}
        ] }
      ] }
    ], competitions: [
      {"name":"Hiperliga Brasil","short":"HLB","kind":"skip"},
      {"name":"Hiperliga B","short":"HLB2","kind":"skip"},
      {"name":"Taça Verde-Amarela","short":"TVA","kind":"cup","country":"BR"},
      {"name":"Hipercopa Brasil","short":"HCB","kind":"skip"},
      {"name":"Liga Albiceleste","short":"LAB","kind":"skip"},
      {"name":"Copa Albiceleste","short":"CAB","kind":"cup","country":"AR"},
      {"name":"Liga Estrellas USA","short":"LEU","kind":"skip"},
      {"name":"Liga del Arce","short":"LDA","kind":"skip"},
      {"name":"Liga Inca de Vóley","short":"LIV","kind":"skip"},
      {"name":"Copa del Sur de Clubes","short":"CSC","kind":"intl","rank":1,"zone":"sur"},
      {"name":"Copa Norte de Campeones","short":"CNC","kind":"intl","rank":1,"zone":"norte"},
      {"name":"Mundial de Clubes VBF","short":"MCV","kind":"skip"}
    ] },
    { region: "Asia", countries: [
      { country: "Japón", code: "JP", tier: 2, divisions: [
        { lvl: 1, name: "HV.League", short: "HVL", strength: 80, clubs: [
            {"name":"Naniwa Skybirds","sponsor":"Ramen Receive-ya","short":"NSB","city":"Osaka","gender":"M","colors":{"shirt":"#c8102e","shirt2":"#87cefa","libero":"#ffffff"},"liberoEstimated":true,"ovr":86},
            {"name":"Bluzeon Osaka","short":"BLZ","city":"Osaka","gender":"M","colors":{"shirt":"#0057b8","shirt2":"#ffffff","libero":"#ffc72c"},"liberoEstimated":true,"ovr":86},
            {"name":"Stingz Aichi","sponsor":"Tatami Toss","short":"STZ","city":"Kariya (Aichi)","gender":"M","colors":{"shirt":"#d7001e","shirt2":"#1a1a1a","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":82},
            {"name":"Wolfhounds Nagoya","short":"WHN","city":"Inazawa (Aichi)","gender":"M","colors":{"shirt":"#111111","shirt2":"#d7001e","libero":"#ffffff"},"liberoEstimated":false,"ovr":81},
            {"name":"Thundra Hiroshima","short":"THU","city":"Hiroshima","gender":"M","colors":{"shirt":"#00984a","shirt2":"#ffffff","libero":"#f5a800"},"liberoEstimated":true,"ovr":78},
            {"name":"Tokyo Grand Bears","short":"TGB","city":"Tokio","gender":"M","colors":{"shirt":"#121f5a","shirt2":"#e4007a","libero":"#f5c400"},"liberoEstimated":true,"ovr":78},
            {"name":"Sprinx Saga","sponsor":"Onigiri Ace Mart","short":"SPX","city":"Tosu (Saga)","gender":"W","colors":{"shirt":"#0050a0","shirt2":"#111111","libero":"#ff8c00"},"liberoEstimated":true,"ovr":83},
            {"name":"Marvelia Osaka","short":"MRV","city":"Osaka","gender":"W","colors":{"shirt":"#202020","shirt2":"#00873c","libero":"#ffffff"},"liberoEstimated":true,"ovr":81},
            {"name":"Red Comets Kawasaki","sponsor":"Takoyaki Spike","short":"RCK","city":"Kawasaki","gender":"W","colors":{"shirt":"#d11d58","shirt2":"#000b38","libero":"#f5c400"},"liberoEstimated":true,"ovr":82},
            {"name":"Blue Lynx Kahoku","sponsor":"Udon Libero Honpo","short":"BLX","city":"Kahoku (Ishikawa)","gender":"W","colors":{"shirt":"#00398f","shirt2":"#db0069","libero":"#e4007f"},"liberoEstimated":false,"ovr":79},
            {"name":"Vittorina Himeji","short":"VIT","city":"Himeji (Hyogo)","gender":"W","colors":{"shirt":"#ff1493","shirt2":"#111111","libero":"#ffffff"},"liberoEstimated":false,"ovr":77},
            {"name":"Queenzy Kariya","short":"QZK","city":"Kariya (Aichi)","gender":"W","colors":{"shirt":"#6a3d9a","shirt2":"#ffffff","libero":"#f2b700"},"liberoEstimated":true,"ovr":76}
        ] },
        { lvl: 2, name: "VL Next", short: "VLN", strength: 63, clubs: [
            {"name":"Spearz Osaka","sponsor":"Sushi Saabu","short":"SPZ","city":"Osaka","gender":"M","colors":{"shirt":"#f08200","shirt2":"#1a1a1a","libero":"#ffffff"},"liberoEstimated":true,"ovr":68},
            {"name":"Hokkaido Gold Stars","short":"HGS","city":"Sapporo","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#1a1a1a","libero":"#0072ce"},"liberoEstimated":true,"ovr":66},
            {"name":"Rêveurs Tochigi","short":"RVT","city":"Utsunomiya (Tochigi)","gender":"M","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#f97316"},"liberoEstimated":true,"ovr":64},
            {"name":"Vierzehn Mie","short":"VZM","city":"Yokkaichi (Mie)","gender":"M","colors":{"shirt":"#f08300","shirt2":"#ffffff","libero":"#003d7c"},"liberoEstimated":true,"ovr":65},
            {"name":"Fragola Kagoshima","short":"FRA","city":"Kagoshima","gender":"M","colors":{"shirt":"#1e88e5","shirt2":"#2e7d32","libero":"#e53950"},"liberoEstimated":true,"ovr":64},
            {"name":"Red Spirals Kawasaki","sponsor":"Seguros Tie-Break","short":"RSP","city":"Kawasaki","gender":"M","colors":{"shirt":"#e60012","shirt2":"#ffffff","libero":"#222222"},"liberoEstimated":true,"ovr":63},
            {"name":"Shinshu Brilliant Rams","short":"SBR","city":"Nagano","gender":"W","colors":{"shirt":"#e8679a","shirt2":"#1f2a5c","libero":"#ffffff"},"liberoEstimated":true,"ovr":64},
            {"name":"Riorena Gifu","sponsor":"Sento Blocking-yu","short":"RIO","city":"Gifu","gender":"W","colors":{"shirt":"#00a0e9","shirt2":"#ffffff","libero":"#f4a300"},"liberoEstimated":true,"ovr":62},
            {"name":"Laulani Fukuoka","sponsor":"Gyoza Pipe Kitchen","short":"LAF","city":"Fukuoka","gender":"W","colors":{"shirt":"#111111","shirt2":"#00a48e","libero":"#30d5c8"},"liberoEstimated":false,"ovr":61},
            {"name":"Green Leaves Kumamoto","short":"GLK","city":"Uki (Kumamoto)","gender":"W","colors":{"shirt":"#111111","shirt2":"#d0021b","libero":"#ffffff"},"liberoEstimated":true,"ovr":60},
            {"name":"Breeze Hamamatsu","short":"BRH","city":"Hamamatsu","gender":"W","colors":{"shirt":"#30bfc4","shirt2":"#ffffff","libero":"#f06292"},"liberoEstimated":true,"ovr":59},
            {"name":"Kurashiki Flare","short":"KFL","city":"Kurashiki (Okayama)","gender":"W","colors":{"shirt":"#e85a1b","shirt2":"#1a1a1a","libero":"#ffffff"},"liberoEstimated":true,"ovr":58}
        ] }
      ] },
      { country: "Corea del Sur", code: "KR", tier: 3, divisions: [
        { lvl: 1, name: "VK-League", short: "VKL", strength: 67, clubs: [
            {"name":"Incheon Cranes","sponsor":"Kimchi Block","short":"ICR","city":"Incheon","gender":"M","colors":{"shirt":"#0078c1","shirt2":"#0b2d6b","libero":"#c8102e"},"liberoEstimated":false,"ovr":70},
            {"name":"Cheonan Skyrunners","sponsor":"Tteokbokki Spike","short":"CSR","city":"Cheonan","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#007bc1","libero":"#0067b1"},"liberoEstimated":false,"ovr":69},
            {"name":"Uijeongbu Starlights","sponsor":"Bibimbap Libero","short":"USL","city":"Uijeongbu","gender":"M","colors":{"shirt":"#f8b500","shirt2":"#7c7366","libero":"#ffffff"},"liberoEstimated":true,"ovr":66},
            {"name":"Baegu Seoul","sponsor":"Hotteok Ace","short":"BSE","city":"Seúl","gender":"M","colors":{"shirt":"#0000ff","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":66},
            {"name":"Suwon Vortex","sponsor":"Jjimjil Net Spa","short":"SVX","city":"Suwon","gender":"M","colors":{"shirt":"#ff0000","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":65},
            {"name":"Baegu Gimcheon","sponsor":"Mandu Serve","short":"BGC","city":"Gimcheon","gender":"W","colors":{"shirt":"#44427f","shirt2":"#ffffff","libero":"#7ec8e3"},"liberoEstimated":false,"ovr":68},
            {"name":"Hangang Seoul","sponsor":"Dakgalbi Receive","short":"HAN","city":"Seúl","gender":"W","colors":{"shirt":"#003e7e","shirt2":"#00a9e0","libero":"#7b8fd4"},"liberoEstimated":false,"ovr":68},
            {"name":"Paldal Suwon","sponsor":"Bingsu Dig Café","short":"PAL","city":"Suwon","gender":"W","colors":{"shirt":"#1f255e","shirt2":"#ffffff","libero":"#1e6b52"},"liberoEstimated":true,"ovr":67},
            {"name":"Incheon Pink Tarantulas","sponsor":"Gimbap Pipe Shop","short":"IPT","city":"Incheon","gender":"W","colors":{"shirt":"#ff66b3","shirt2":"#151b54","libero":"#a79bd9"},"liberoEstimated":true,"ovr":66},
            {"name":"Hwaseong Altissimo","sponsor":"Rodilleras Rodríguez","short":"HAL","city":"Hwaseong","gender":"W","colors":{"shirt":"#00abeb","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":65}
        ] }
      ] },
      { country: "China", code: "CN", tier: 3, divisions: [
        { lvl: 1, name: "CV Hyper League", short: "CVH", strength: 68, clubs: [
            {"name":"Paiqiu Shanghai","sponsor":"Kouqiu Baozi","short":"SHA","city":"Shanghái","gender":"W","colors":{"shirt":"#0050b5","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":false,"ovr":74},
            {"name":"Paiqiu Jiangsu","sponsor":"Lanwang Jiaozi","short":"JSU","city":"Nankín","gender":"W","colors":{"shirt":"#c8102e","shirt2":"#ffffff","libero":"#f2c400"},"liberoEstimated":true,"ovr":73},
            {"name":"Paiqiu Tianjin","sponsor":"Faqiu Mahua","short":"TIA","city":"Tianjin","gender":"M","colors":{"shirt":"#00a3e0","shirt2":"#ffffff","libero":"#e4002b"},"liberoEstimated":true,"ovr":72},
            {"name":"Paiqiu Beijing","sponsor":"Chanclas Supersónicas","short":"BEI","city":"Pekín","gender":"W","colors":{"shirt":"#0b5394","shirt2":"#ffffff","libero":"#f6b26b"},"liberoEstimated":true,"ovr":70},
            {"name":"Paiqiu Liaoning","sponsor":"Erchuan Huoguo","short":"LIA","city":"Liaoning","gender":"W","colors":{"shirt":"#1f4e9c","shirt2":"#ffffff","libero":"#f39800"},"liberoEstimated":true,"ovr":67},
            {"name":"Paiqiu Shandong","short":"SDG","city":"Jinan","gender":"W","colors":{"shirt":"#f39800","shirt2":"#ffffff","libero":"#1f4e9c"},"liberoEstimated":true,"ovr":67},
            {"name":"Paiqiu Fujian","short":"FUJ","city":"Fuzhou","gender":"W","colors":{"shirt":"#008c45","shirt2":"#ffffff","libero":"#e4002b"},"liberoEstimated":true,"ovr":64},
            {"name":"Paiqiu Hubei","short":"HUB","city":"Wuhan","gender":"M","colors":{"shirt":"#1e3a8a","shirt2":"#ffffff","libero":"#f59e0b"},"liberoEstimated":true,"ovr":69},
            {"name":"Paiqiu Guangdong","short":"GDG","city":"Taishan","gender":"M","colors":{"shirt":"#e60012","shirt2":"#ffd100","libero":"#111111"},"liberoEstimated":true,"ovr":65},
            {"name":"Paiqiu Zhejiang","short":"ZHE","city":"Hangzhou","gender":"M","colors":{"shirt":"#00a651","shirt2":"#ffffff","libero":"#ed1c24"},"liberoEstimated":true,"ovr":64}
        ] }
      ] },
      { country: "Irán", code: "IR", tier: 3, divisions: [
        { lvl: 1, name: "Persian Hyper League", short: "PHL", strength: 67, clubs: [
            {"name":"Valibal Sirjan","sponsor":"Kebab Sirjan Smash","short":"SRJ","city":"Sirjan","gender":"M","colors":{"shirt":"#0d47a1","shirt2":"#ffffff","libero":"#1f2a44"},"liberoEstimated":false,"ovr":71},
            {"name":"Valibal Yazd","sponsor":"Yazd Baklava Block","short":"YAZ","city":"Yazd","gender":"M","colors":{"shirt":"#00796b","shirt2":"#ffffff","libero":"#1a1a1a"},"liberoEstimated":true,"ovr":73},
            {"name":"Valibal Urmia","short":"URM","city":"Urmia","gender":"M","colors":{"shirt":"#c62828","shirt2":"#ffffff","libero":"#8db6d6"},"liberoEstimated":true,"ovr":66},
            {"name":"Valibal Ardakan","sponsor":"Pesteh Pass","short":"ARD","city":"Ardakan","gender":"M","colors":{"shirt":"#d32f2f","shirt2":"#ffffff","libero":"#1565c0"},"liberoEstimated":true,"ovr":67},
            {"name":"Spadana Isfahan","short":"SPD","city":"Isfahán","gender":"M","colors":{"shirt":"#ffd200","shirt2":"#0047ab","libero":"#e53935"},"liberoEstimated":true,"ovr":66},
            {"name":"Valibal Gorgan","short":"GRG","city":"Gorgan","gender":"M","colors":{"shirt":"#2e7d32","shirt2":"#ffffff","libero":"#f57c00"},"liberoEstimated":true,"ovr":63},
            {"name":"Omid Tehran","short":"OMI","city":"Teherán","gender":"M","colors":{"shirt":"#6a1b9a","shirt2":"#ffffff","libero":"#fdd835"},"liberoEstimated":true,"ovr":62},
            {"name":"Narenji Tehran","sponsor":"Sangak Spike","short":"NRT","city":"Teherán","gender":"M","colors":{"shirt":"#ff4f00","shirt2":"#ffffff","libero":"#003a70"},"liberoEstimated":true,"ovr":63},
            {"name":"Tochal Tehran","sponsor":"Ash Reshteh Ace","short":"TOC","city":"Teherán","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#7cb9e8","libero":"#e53935"},"liberoEstimated":true,"ovr":61}
        ] }
      ] },
      { country: "Catar", code: "QA", tier: 4, divisions: [
        { lvl: 1, name: "Doha Volley League", short: "DVL", strength: 65, clubs: [
            {"name":"Arabi Doha","short":"ARB","city":"Doha","gender":"M","colors":{"shirt":"#e2001a","shirt2":"#ffffff","libero":"#1b2a4a"},"liberoEstimated":true,"ovr":72},
            {"name":"Voley Wakrah","short":"WAK","city":"Al Wakrah","gender":"M","colors":{"shirt":"#5bb7e5","shirt2":"#ffffff","libero":"#0b2d6b"},"liberoEstimated":true,"ovr":66},
            {"name":"Shurta Doha","short":"SHU","city":"Doha","gender":"M","colors":{"shirt":"#0b2d6b","shirt2":"#ffffff","libero":"#4fc3e8"},"liberoEstimated":true,"ovr":68},
            {"name":"Voley Rayyan","short":"RAY","city":"Al Rayyan","gender":"M","colors":{"shirt":"#d50032","shirt2":"#111111","libero":"#111111"},"liberoEstimated":false,"ovr":71},
            {"name":"Sadd Doha","short":"SAD","city":"Doha","gender":"M","colors":{"shirt":"#ffffff","shirt2":"#111111","libero":"#0057b8"},"liberoEstimated":true,"ovr":62},
            {"name":"Doha Qataris","short":"QAT","city":"Doha","gender":"M","colors":{"shirt":"#5b2c83","shirt2":"#f7941d","libero":"#ffffff"},"liberoEstimated":true,"ovr":61},
            {"name":"Voley Gharafa","short":"GHA","city":"Al Gharafa (Doha)","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#0057b8","libero":"#e4002b"},"liberoEstimated":true,"ovr":61},
            {"name":"Ahliya Doha","short":"AHL","city":"Doha","gender":"M","colors":{"shirt":"#006b3f","shirt2":"#ffffff","libero":"#f2c300"},"liberoEstimated":true,"ovr":59}
        ] }
      ] },
      { country: "Filipinas", code: "PH", tier: 4, divisions: [
        { lvl: 1, name: "Archipelago Volleyball League", short: "AVL", strength: 54, clubs: [
            {"name":"Kool Smashers Manila","sponsor":"Adobo Ace","short":"KSM","city":"Gran Manila","gender":"W","colors":{"shirt":"#ff007f","shirt2":"#2e5090","libero":"#ffffff"},"liberoEstimated":false,"ovr":58},
            {"name":"Metro Spikers","sponsor":"Halo-Halo Block","short":"MSP","city":"Gran Manila","gender":"W","colors":{"shirt":"#e31b23","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":56},
            {"name":"Heavy Hitters Manila","sponsor":"Lechon Libero","short":"HHM","city":"Gran Manila","gender":"W","colors":{"shirt":"#d11f37","shirt2":"#111111","libero":"#111111"},"liberoEstimated":false,"ovr":57},
            {"name":"Manila Angelz","sponsor":"Pandesal Pass Bakery","short":"AGZ","city":"Gran Manila","gender":"W","colors":{"shirt":"#ff0000","shirt2":"#111111","libero":"#ffffff"},"liberoEstimated":false,"ovr":56},
            {"name":"Swift Foxes Manila","sponsor":"Sari-Sari Serve","short":"SFX","city":"Gran Manila","gender":"W","colors":{"shirt":"#ff8000","shirt2":"#111111","libero":"#ffffff"},"liberoEstimated":false,"ovr":54},
            {"name":"Flying Giants","sponsor":"Turon Toss","short":"FLG","city":"Gran Manila","gender":"W","colors":{"shirt":"#550000","shirt2":"#6d14c4","libero":"#ffffff"},"liberoEstimated":false,"ovr":54},
            {"name":"Power Chargers","sponsor":"Chanclas Supersónicas","short":"PWC","city":"Gran Manila","gender":"W","colors":{"shirt":"#0057b8","shirt2":"#ffd100","libero":"#ffffff"},"liberoEstimated":false,"ovr":52},
            {"name":"Crown Crushers","sponsor":"Videoke Block","short":"CCR","city":"Gran Manila","gender":"M","colors":{"shirt":"#ffd100","shirt2":"#111111","libero":"#ffffff"},"liberoEstimated":true,"ovr":56},
            {"name":"Spin Medics","sponsor":"Barberya Spike","short":"SPM","city":"Gran Manila","gender":"M","colors":{"shirt":"#6a1b9a","shirt2":"#ffffff","libero":"#1f3d2b"},"liberoEstimated":true,"ovr":52},
            {"name":"Bay Sealions","sponsor":"Bangus Net Fishery","short":"BAY","city":"Gran Manila","gender":"M","colors":{"shirt":"#0a2240","shirt2":"#ffffff","libero":"#ffffff"},"liberoEstimated":false,"ovr":50}
        ] }
      ] }
    ], competitions: [
      {"name":"HV.League","short":"HVL","kind":"skip"},
      {"name":"VL Next","short":"VLN","kind":"skip"},
      {"name":"VK-League","short":"VKL","kind":"skip"},
      {"name":"CV Hyper League","short":"CVH","kind":"skip"},
      {"name":"Persian Hyper League","short":"PHL","kind":"skip"},
      {"name":"Doha Volley League","short":"DVL","kind":"skip"},
      {"name":"Archipelago Volleyball League","short":"AVL","kind":"skip"},
      {"name":"Champions Cup Asia","short":"CCA","kind":"intl","rank":1},
      {"name":"Chrysanthemum Cup","short":"CHR","kind":"cup","country":"JP"},
      {"name":"VKL Cup","short":"VKC","kind":"cup","country":"KR"},
      {"name":"Mundial de Clubes VBF","short":"MCV","kind":"skip"},
      {"name":"VBN","short":"VBN","kind":"skip"}
    ] }
  ];
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
