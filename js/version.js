/* MAKE THE CUT — js/version.js (owner: ui_main)
 * Una sola fuente para el número de versión, las novedades y los créditos. Solo datos: sin DOM y sin red.
 * Se carga el primero después de three.js (antes de account.js). Lo leen ui.js (panel «Acerca de», pestaña Info de Ajustes,
 * #btnVer de la portada, aviso de novedades una vez por versión), main.js (ctx.bootInfo.version) y tools/build-pages.js (con vm:
 * metadatos de Pages y guardas del build) y tools/abouttest.js.
 * REGLA DE VERSIONADO: cada publicación con un cambio que se vea en el juego sube VERSION y añade su entrada ARRIBA de CHANGELOG
 * (la más nueva primero). build-pages falla si CHANGELOG[0].v !== VERSION o si VERSION no es semver (x.y.z).
 * Textos (notes/ui_main.md, «Textos: guía de estilo»): frases cortas, sin el punto medio como pegamento, ordinales «1r» «2º»,
 * género neutro, sin nombres reales ni patrocinadores de verdad. Este fichero no lleva arrobas ni la palabra del programa de
 * navegación web (tools/abouttest.js lo comprueba en todo el fichero, comentarios incluidos).
 * 1.0.0 (12-nov-2026, decisión de Ferran): cierre del sprint 5. Sin créditos a herramientas de IA (Ferran, 12-nov-2026).
 */
(function () {
  'use strict';
  var VB = window.VB = window.VB || {};

  VB.VERSION = '1.0.1';
  VB.VERSION_DATE = '2026-11-12';

  /** Novedades: {v, d:'AAAA-MM-DD', t (título corto), items[] (frases de 90 caracteres como mucho)}. La más nueva primero. */
  VB.CHANGELOG = [
    {
      v: '1.0.1', d: '2026-11-12', t: 'Arreglos de línea y marcador',
      items: [
        'Arreglado: el challenge da dentro si cualquier parte del balón toca la línea.',
        'Marcador más discreto mientras se juega el punto.',
        'Playa: colocar de dedos a destiempo puede costar dobles.'
      ]
    },
    {
      v: '1.0.0', d: '2026-11-12', t: 'Juego completo',
      items: [
        'Entrenamiento: 5 ejercicios con medallas y peloteo libre.',
        'Carrera de pista 6 contra 6 con ligas de 28 países.',
        'Interfaz nueva con grafismo de tele deportiva.',
        'Teclas y botones reasignables, y más ajustes de cámara e imagen.',
        'Faro, tu mentor, y noticias y fichas de clubes en la Carrera.',
        'Finta, golpe colocado y colocación dirigida para quien quiera más.',
        'Fama, patrocinadores, decisiones y un rival personal en la Carrera.',
        'Premios de temporada, 28 logros y el Salón de la Fama al retirarte.',
        '6 contra 6: juega de receptor, colocador, opuesto o central.',
        'Bloqueo activo: salta y pulsa GOLPEAR justo cuando remata el rival.',
        'Vóley playa en Platja Llarga, con luz de día o de tarde.',
        'Personajes y logotipo nuevos.',
        'Cuentas: guarda tu progreso y sigue en otro dispositivo.'
      ]
    }
  ];

  var MIT_THREE = 'The MIT License\n\n' +
    'Copyright © 2010-2023 Three.js Authors\n\n' +
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated ' +
    'documentation files (the "Software"), to deal in the Software without restriction, including without limitation the ' +
    'rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit ' +
    'persons to whom the Software is furnished to do so, subject to the following conditions:\n\n' +
    'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the ' +
    'Software.\n\n' +
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE ' +
    'WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR ' +
    'COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR ' +
    'OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';

  var OFL = 'Barlow y Barlow Condensed: Copyright 2017 The Barlow Project Authors (github.com/jpt/barlow).\n\n' +
    'Se distribuyen con la SIL Open Font License, versión 1.1. Se pueden usar, estudiar, modificar y redistribuir ' +
    'libremente, también dentro de otro software, siempre que no se vendan solas y que las versiones modificadas no usen ' +
    'el nombre reservado de la fuente.\n\n' +
    'Texto completo de la licencia: openfontlicense.org';

  /** Créditos. by: solo el nombre (sin apellidos ni correo). tools: líneas de «Hecho con». */
  VB.CREDITS = {
    by: 'Ferran',
    tools: [
      'three.js r149 (motor 3D, licencia MIT)',
      'Sonido y gráficos generados por código, sin grabaciones',
      'Guardado en la nube con Firebase'
    ],
    fonts: 'Barlow y Barlow Condensed, de The Barlow Project Authors (SIL Open Font License 1.1). ' +
      'El logotipo usa sus letras pasadas a trazos.',
    licenses: {
      three: MIT_THREE,   // año comprobado en la cabecera de three.min.js 0.149.0 (cdnjs): «Copyright 2010-2023 Three.js Authors»
      threeLine: 'three.js: Copyright © 2010-2023 Three.js Authors. Licencia MIT.',
      ofl: OFL
    },
    note: 'Clubes, jugadores y patrocinadores son inventados. Cualquier parecido es casualidad.'
  };
})();
