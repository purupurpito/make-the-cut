/* MAKE THE CUT — tools/leagues-fixture.js (owner: ui_main, lote C)
 * Ligas de PRUEBA inventadas para tools/careertest.js: son los antiguos datos provisionales de js/leagues.js (4 países, ciudades
 * ficticias), que cubren casos que los datos reales no tienen fijos: una liga impar de 9 clubes (descansos), una de 8 (doble vuelta),
 * un país sin 2ª (Brasil aquí), copas nacionales con country. careertest los pone en VB.Leagues.regions para las secciones de la pista
 * y prueba aparte los datos reales de js/leagues.js. Mismo esquema que js/leagues.js (+ real/official/check, como los JSON de notes/clubes).
 */
'use strict';
function K(a) {
  return { real: '(prueba) club inventado', official: '(prueba) ' + a[0], name: a[0], short: a[1], city: a[2], gender: a[3],
    colors: { shirt: a[4], shirt2: a[5], libero: a[6] }, liberoEstimated: true, ovr: a[7], check: 'Prueba: ciudad ficticia, sin club real que comprobar' };
}
function D(lvl, name, short, strength, real, clubs) { return { lvl: lvl, real: real, name: name, short: short, strength: strength, clubs: clubs.map(K) }; }
module.exports = function () {
  return [
    {
      region: 'Europa',
      countries: [
        { country: 'España', code: 'ES', tier: 3, divisions: [
          D(1, 'Hiperliga', 'HPL', 66, '(prueba) Superliga + Superliga Femenina (mezcla)', [
            ['Vòlei Rocaverde', 'ROC', 'Rocaverde', 'M', '#c8102e', '#ffffff', '#7b3fd1', 75],
            ['Voley Puertoluz', 'PTL', 'Puertoluz', 'W', '#0b3d91', '#f2c230', '#ff6a1f', 73],
            ['Club Valdesol', 'VDS', 'Valdesol', 'M', '#f2c230', '#1a1c22', '#2bd96b', 70],
            ['Voley Miraflor', 'MRF', 'Miraflor', 'W', '#1f9a4a', '#ffffff', '#ff3fa4', 68],
            ['Castelnube Vòlei', 'CTN', 'Castelnube', 'M', '#22252c', '#ff5a2c', '#18c8d8', 66],
            ['Voley Brisamar', 'BRS', 'Brisamar', 'W', '#32b5e8', '#0b1f4a', '#ffd23a', 64],
            ['Peñaclara VC', 'PÑC', 'Peñaclara', 'M', '#7b3fd1', '#ffffff', '#f2c230', 62],
            ['Arenalta Voley', 'ARN', 'Arenalta', 'W', '#ff5a2c', '#22252c', '#32b5e8', 61],
            ['Voley Fuenteviva', 'FTV', 'Fuenteviva', 'M', '#ffffff', '#c8102e', '#1f9a4a', 59],
            ['Lomablanca VC', 'LMB', 'Lomablanca', 'W', '#0d6e6e', '#f2f4f8', '#ff8a1e', 58]
          ]),
          D(2, 'Hiperliga 2', 'HP2', 54, '(prueba) Superliga 2 (mezcla)', [
            ['Voley Riosereno', 'RSR', 'Riosereno', 'M', '#b3161d', '#f2c230', '#2bd96b', 60],
            ['Campoalto Vòlei', 'CPA', 'Campoalto', 'W', '#18244a', '#8fd3ff', '#ff3fa4', 58],
            ['Voley Salinera', 'SAL', 'Salinera', 'M', '#f2f4f8', '#0b3d91', '#ff6a1f', 56],
            ['Montecielo VC', 'MTC', 'Montecielo', 'W', '#32b5e8', '#ffffff', '#c8102e', 55],
            ['Voley Villaduna', 'VLD', 'Villaduna', 'M', '#1f9a4a', '#f2c230', '#9a5cff', 53],
            ['Calarrosa Voley', 'CLR', 'Calarrosa', 'W', '#ff3fa4', '#22252c', '#18c8d8', 52],
            ['Vòlei Pinarejo', 'PNR', 'Pinarejo', 'M', '#5a606b', '#ff5a2c', '#ffd23a', 50],
            ['Voley Torremar', 'TRM', 'Torremar', 'W', '#0b1f4a', '#ff5a2c', '#2bd96b', 49],
            ['Olivarda VC', 'OLV', 'Olivarda', 'M', '#7a8f2a', '#ffffff', '#ff3fa4', 48]
          ])
        ] },
        { country: 'Italia', code: 'IT', tier: 1, divisions: [
          D(1, 'IperLega', 'IPL', 90, '(prueba) SuperLega + Serie A1 (mezcla)', [
            ['Volley Altavera', 'ALT', 'Altavera', 'M', '#d8262e', '#ffffff', '#f2c230', 95],
            ['Volley Rivenza', 'RIV', 'Rivenza', 'W', '#0b3d91', '#ffffff', '#ff6a1f', 93],
            ['Pallavolo Velmora', 'VEL', 'Velmora', 'M', '#f2c230', '#0b3d91', '#ff3fa4', 92],
            ['Volley Quintavalle', 'QNT', 'Quintavalle', 'W', '#22252c', '#d9a520', '#18c8d8', 90],
            ['Ardenza Volley', 'ARD', 'Ardenza', 'M', '#1f9a4a', '#ffffff', '#ffd23a', 89],
            ['Volley Solmara', 'SOL', 'Solmara', 'W', '#32b5e8', '#ffffff', '#c8102e', 88],
            ['Lunaport Volley', 'LUN', 'Lunaport', 'M', '#7b3fd1', '#f2c230', '#2bd96b', 87],
            ['Volley Teravento', 'TER', 'Teravento', 'W', '#ff5a2c', '#1a1c22', '#32b5e8', 86],
            ['Pallavolo Ombralia', 'OMB', 'Ombralia', 'M', '#b3161d', '#22252c', '#8fd3ff', 85],
            ['Volley Nevaro', 'NEV', 'Nevaro', 'W', '#f2f4f8', '#0b1f4a', '#ff3fa4', 84],
            ['Calyra Volley', 'CAL', 'Calyra', 'M', '#0d6e6e', '#f2c230', '#ff6a1f', 83],
            ['Volley Marisport', 'MAR', 'Marisport', 'W', '#18244a', '#ff5a2c', '#2bd96b', 82]
          ]),
          D(2, 'IperLega 2', 'IP2', 74, '(prueba) Serie A2 (mezcla)', [
            ['Volley Sankora', 'SAN', 'Sankora', 'M', '#d8262e', '#f2c230', '#18c8d8', 80],
            ['Pallavolo Duneholm', 'DUN', 'Duneholm', 'W', '#1f9a4a', '#22252c', '#ff3fa4', 78],
            ['Volley Kastelheim', 'KAS', 'Kastelheim', 'M', '#0b3d91', '#d9a520', '#2bd96b', 76],
            ['Brennvik Volley', 'BRE', 'Brennvik', 'W', '#ffffff', '#7b3fd1', '#ff6a1f', 75],
            ['Volley Castelmare', 'CSM', 'Castelmare', 'M', '#22252c', '#32b5e8', '#ffd23a', 74],
            ['Pallavolo Fiorenza', 'FIO', 'Fiorenza', 'W', '#7b3fd1', '#ffffff', '#f2c230', 72],
            ['Volley Montenero', 'MTN', 'Montenero', 'M', '#f2c230', '#d8262e', '#18c8d8', 71],
            ['Volley Acquaviva', 'ACQ', 'Acquaviva', 'W', '#32b5e8', '#0b1f4a', '#ff3fa4', 69],
            ['Rocca Volley', 'RCC', 'Roccalta', 'M', '#5a606b', '#ff5a2c', '#2bd96b', 67],
            ['Volley Pietrasanta Sud', 'PSU', 'Pietrabianca', 'W', '#0d6e6e', '#ffffff', '#ff8a1e', 66]
          ])
        ] },
        { country: 'Polonia', code: 'PL', tier: 1, divisions: [
          D(1, 'MegaLiga', 'MGL', 86, '(prueba) PlusLiga + Tauron Liga (mezcla)', [
            ['Siatkówka Brzozów', 'BRZ', 'Brzozówka', 'M', '#f2c230', '#22252c', '#ff3fa4', 92],
            ['Wolanów Volley', 'WOL', 'Wolanów', 'W', '#d8262e', '#ffffff', '#32b5e8', 90],
            ['Siatkówka Lipnik', 'LIP', 'Lipnik', 'M', '#0b3d91', '#f2c230', '#ff6a1f', 88],
            ['Klub Jezioro', 'JEZ', 'Jeziorna', 'W', '#1f9a4a', '#ffffff', '#ffd23a', 86],
            ['Siatkówka Grodek', 'GRO', 'Grodek', 'M', '#22252c', '#d8262e', '#18c8d8', 84],
            ['Volley Sosnowa', 'SOS', 'Sosnowa', 'W', '#32b5e8', '#0b1f4a', '#ff3fa4', 83],
            ['Siatkówka Dębina', 'DEB', 'Dębina', 'M', '#7b3fd1', '#f2c230', '#2bd96b', 81],
            ['Klub Kamionka', 'KAM', 'Kamionka', 'W', '#ff5a2c', '#ffffff', '#0b3d91', 80],
            ['Volley Borówno', 'BOR', 'Borówno', 'M', '#f2f4f8', '#1f9a4a', '#ff6a1f', 79],
            ['Siatkówka Rzeczka', 'RZE', 'Rzeczka', 'W', '#b3161d', '#f2c230', '#18c8d8', 78]
          ])
        ] }
      ],
      competitions: [
        { real: '(prueba) CEV Champions League', name: 'Champions Cup', short: 'CHC', note: 'Campeones y subcampeones de las 1ªs de la región' },
        { real: '(prueba) CEV Cup', name: 'Copa VEC', short: 'VEC', note: '3º y 4º de las 1ªs de la región' },
        { real: '(prueba) Copa del Rey / de la Reina', name: 'Copa de la Corona', short: 'CDC', note: 'Copa nacional de España', country: 'ES' },
        { real: '(prueba) Coppa Italia', name: 'Coppa Tricolore', short: 'CTR', note: 'Copa nacional de Italia', country: 'IT' }
      ]
    },
    {
      region: 'América',
      countries: [
        { country: 'Brasil', code: 'BR', tier: 1, divisions: [
          D(1, 'Hiperliga Brasil', 'HPB', 84, '(prueba) Superliga + Superliga Feminina (mezcla)', [
            ['Vôlei Serrabela', 'SRB', 'Serrabela', 'W', '#1f9a4a', '#f2c230', '#0b3d91', 91],
            ['Vôlei Riacho Alto', 'RIA', 'Riacho Alto', 'M', '#0b3d91', '#ffffff', '#f2c230', 89],
            ['Clube Lagoa Azul', 'LAG', 'Lagoa Azul', 'W', '#32b5e8', '#ffffff', '#ff3fa4', 87],
            ['Vôlei Pedraverde', 'PED', 'Pedraverde', 'M', '#d8262e', '#22252c', '#2bd96b', 85],
            ['Vôlei Campo Sereno', 'CSE', 'Campo Sereno', 'W', '#f2c230', '#1f9a4a', '#7b3fd1', 82],
            ['Mirante Vôlei', 'MIR', 'Mirante', 'M', '#22252c', '#ffffff', '#ff6a1f', 80],
            ['Vôlei Cachoeira Nova', 'CAC', 'Cachoeira Nova', 'W', '#7b3fd1', '#f2c230', '#18c8d8', 78],
            ['Vôlei Ilha Clara', 'ILH', 'Ilha Clara', 'M', '#ff5a2c', '#0b1f4a', '#2bd96b', 76]
          ])
        ] }
      ],
      competitions: [
        { real: '(prueba) Campeonato Sudamericano de Clubes', name: 'Copa Sur de Clubes', short: 'CSC', note: 'Campeones y subcampeones de las 1ªs de la región' }
      ]
    }
  ];
};
