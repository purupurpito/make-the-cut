# notes/carrera.md — Modo Carrera: vóley playa 2v2 y pista 6v6 (owner: ui_main)

Ficheros: `js/career.js` (VB.Career, datos y reglas, sin DOM; se carga en node), `js/career-ui.js` (VB.CareerUI, pantallas; crea su
DOM `#career` y su `<style id="careerCss">`), `js/leagues.js` (VB.Leagues, datos de las ligas de pista), `js/main.js` (arranque de
los partidos de Carrera), `index.html` (fila «02 Carrera» del menú y los `<script>`), `tools/careertest.js` (prueba en node).
Guardados: `localStorage['voley3d.career']` (playa, igual que siempre), `['voley3d.career6']` (pista) y `['voley3d.career.mode']`
(cuál de las dos está activa).

## Carrera de pista 6v6 (lote C, 11-nov-2026)

### Diseño
- **Dos Carreras a la vez, guardadas aparte.** Al crear se elige «Playa (2v2)» o «Pista (6v6)» (`modeSeg`). La de playa no cambia:
  ni su guardado (`voley3d.career`, v3), ni su migración, ni su API. La pista va en `voley3d.career6` (v1, `mode: 'hall'`). La
  activa se guarda en `voley3d.career.mode`; sin ese dato, o si la elegida no existe y la otra sí, manda la que exista (por defecto
  la playa). Palmarés › Opciones lleva a la otra Carrera (o a crearla). Un guardado de pista dañado se copia en
  `voley3d.career6.bak` y la activa vuelve a la playa, que no se toca.
- **Fachada (`VB.Career`, final de career.js).** `BEACH` y `HALL` son dos motores con las mismas claves; `VB.Career.<clave>` va
  al activo (getter) y, si el activo no la tiene, a la playa (constantes comunes). `VB.Career.beach` y `VB.Career.hall` dan acceso
  directo. `create({mode})` elige; `matchDone(r, st, g)` va al de `g.career.mode` aunque la activa hubiera cambiado.
- **Mundo.** `buildWorld6` copia en el guardado las ligas (id = código del país + división: `ES1`, `ES2`), los clubes (con su kit
  ya en números), las copas nacionales (`cups[cc]`) y las internacionales por continente (`intl[region]`). Cambiar js/leagues.js no
  rompe una Carrera empezada; la nueva coge los datos nuevos.
  - Región por el código del país (`CONT6`: Europa, América, Asia). Zonas en América (`ZONE6`: sur y norte, cada una con su copa).
  - Competiciones (`compKind6`): manda `kind` ('intl' | 'cup' | 'skip'), `rank` (1 la grande, 2 la segunda), `zone` ('sur', 'norte' o
    lista de códigos) y `country` si vienen; si no, se deduce del nombre real (CEV, AVC, CSV, NORCECA → internacional; Cup, Copa,
    Coppa, Pokal… del país → nacional; supercopas, ligas, selecciones, Mundial de Clubes → fuera). Repetidas en varios ficheros: vale
    la 1ª.
- **Inicio.** Eliges país (por defecto España; agrupados por continente) y puesto. Media 45. Ofertas de 3-4 clubes modestos de la
  2ª (o de la 1ª si el país solo tiene una) y, en la 1ª ronda, quizá una prueba en el más flojo de la 1ª. «Pedir más tiempo» y
  «Rechazar todas», como en la playa.
- **Liga por jornadas** (`sched6`, determinista): hasta 8 clubes a doble vuelta (14 jornadas); con más, a una vuelta (11 jornadas con
  12 clubes, 9 con 9-10). Así una temporada son 11-14 jornadas más 1-3 rondas de cada copa: unas 15-18 partidas, como las 14 de la
  playa. Liga impar: un club descansa cada jornada (`skipBye6`: entrenas, cobras, descansas). Puntos 3/2/1/0 (2-0, 2-1, 1-2).
  Sets a 15 por defecto (21 y 25 a elegir), el 3r a 15.
- **Copas** (al acabar la liga, eliminatoria a un partido, hasta 8 equipos, `buildKOs6`): la nacional (6 primeros de la 1ª + 2
  primeros de la 2ª; sin 2ª, los 8 primeros) y las internacionales de tu continente y zona (`intlFor6`): la grande con el 1r y el 2º
  de cada 1ª, la segunda con el 3r y el 4º. Si tu club está clasificado, entra siempre aunque haya más candidatos que plazas.
- **Ascensos y descensos** en cada país con dos divisiones: 2 y 2 (1 y 1 si las ligas son pequeñas). Las medias de los clubes se
  mueven cada verano (vuelven un 25 % hacia la base, ±2, y ±2 al subir o bajar).
- **Tu puesto** (`positions6`): la lista sale de `VB.Sim.CTRL_ROLES6` (hoy solo `['OH']`); cuando el lote A añada colocador, opuesto
  y central, aparecen solos en crear y en Palmarés › Opciones (`setPosition6`). Si tu puesto deja de estar en sim, juegas de
  receptor sin perder el tuyo (`ctrlRole6`). Perfiles de atributos por puesto en `POS6` (genSt los entiende como los roles de playa).
- **Partido** (`matchSetup6`): `format: '6v6'`, `venue: 'hall'`, `ctrlRole` tu puesto, `ctrlIdx` el hueco de tu puesto en
  `Sim.ROLES6`; atributos de los 12 (compañeros y rivales a la media de su club ±2, química en reacción/colocación/recepción); tu
  dorsal en tu hueco; IA por la media del rival (`DIFF6_AT`, calibrada con los datos reales: < 56 Fácil, 56-61 Normal suave, 62-75
  Normal, 76-87 Difícil, ≥ 88 Experto; de los 390 clubes, 18 / 81 / 182 / 87 / 22); arbitraje por la fuerza de la liga; equipaciones de los dos clubes con camiseta, segundo color y líbero. «Simular» da
  la mitad de XP, como en la playa. Nota con `rating` y un multiplicador por puesto (`RATE6`).
- **Ojeadores y ofertas** (`scoutCheck6`, `genOffers6`): tras una nota ≥ 7,3, a veces viene un ojeador de un club de una liga más
  fuerte (también de fuera): +3 de interés esa temporada. Ofertas a mitad (nota media ≥ 7; de fuera o de una liga más fuerte, ≥ 7,5
  o con ojeador) y a fin de temporada: clubes mejores que el tuyo de ligas como la tuya o más fuertes; umbral = media del club − 5,
  +2 si es de fuera, + (fuerza − 70) / 5 en las ligas de élite. De los clubes que te quieren llegan los 3 más atractivos
  (`appeal`: el interés cuenta hasta 5, y pesan la fuerza de la liga ×0,5 y la media del club ×0,25): con 28 países, ordenar solo
  por interés llenaba la bandeja de un crack de clubes modestos de Irán o Eslovenia; ahora un 90 con notas de 8 recibe Conegliano,
  Perugia y Trento, y un 70 de la Hiperliga, clubes de la 1ª turca o francesa. La ficha enseña país, liga y su nivel, media, puesto, estilo,
  objetivo, rol prometido, sueldo (ficticio: 400 €/mes en una liga de 50, ~2.500 en una de 70, ~15.000 en la élite) y años.
- **Reutilizado de la playa**: atleta y progresión (addXP, bump, insignias), entrenamiento y fatiga (`trainWeek`), contrato, rol
  prometido y banquillo (`benchFor`, `pay`, `earlyExit`, `promoteCheck6`), negociar, transferible, fisio, bandeja (`msg`), nota
  (`ingest`, `rating`) y `quickSim`. La química es la del equipo (sube +5 por partido jugado, +3 simulado; −40 % en verano; a 0 al
  fichar).
- **UI** (career-ui.js): mismas pestañas EA FC. En la pista, Club › Ficha · Equipo · Contrato · Ofertas (Equipo = plantilla
  inventada y química) y Liga › Clasificación · Calendario · Copas. Clasificación de cualquier país y división (tu país primero; en
  el móvil, una fila que se desliza). Capturas en `tools/out/arte/carrera-pista/` (`shots.js`, `REAL=1` con los datos reales).

### Datos reales (integración, 11-nov-2026)
- **Fuente:** `notes/clubes/*.json` (5 investigaciones verificadas: elite-europa, fra-ale-esp, europa-media, america, asia; detalle en
  sus .md). **Lista para Ferran:** `notes/clubes-reales.md` (competiciones real → nuestro y una tabla por liga: club real → nuestro
  nombre, colores con muestra, ovr, nombre oficial, búsqueda y ⚠ en los dudosos, más un resumen «Decisiones para Ferran»).
- **`tools/build-leagues.js`** genera `js/leagues.js` (NO se edita a mano) y `notes/clubes-reales.md` a partir de los JSON.
  Comprueba antes de escribir: nombres de club únicos, abreviaturas únicas en TODO el juego (así `uniqueShorts` no renombra nada y
  las copas internacionales no repiten), colores hex, ovr y fuerza 0-100, ningún «masculino/femenino» y una lista de ~200
  patrocinadores y marcas de los nombres reales (palabra entera). `--check` solo comprueba. Para corregir un club o una copa: el
  JSON y volver a ejecutarlo.
- **js/leagues.js:** 3 regiones (Europa 17 países, América 5, Asia 6), 37 ligas de 8 a 12 clubes, 390 clubes; 1ª y 2ª en Italia,
  Polonia, Turquía, Rusia, Francia, Alemania, España, Brasil y Japón. Sin `real`, `official` ni `check` (llevan patrocinadores):
  solo lo que usa el juego. Cada competición lleva `kind`/`rank`/`zone`/`country`, así que ya no se deduce nada por el nombre.
- **Competiciones unificadas:** Europa «Champions Cup VEC» (CCV, rank 1) + «Copa VEC» (CVC, rank 2) + «Challenge VEC» (CHV, solo
  nombre); América «Copa del Sur de Clubes» (zona sur) y «Copa Norte de Campeones» (zona norte); Asia «Champions Cup Asia»;
  «Mundial de Clubes VBF» igual en los tres (antes «World Club Cup» y «Mundial VBC de Clubes»). Copas nacionales en 21 países;
  nuevas del integrador: Coppa Tricolore (IT), Puchar Orła (PL), Hilal Kupası (TR) y Kubok Volgi (RU), una búsqueda cada una sin
  coincidencias. Sin copa propia (juegan «Copa Nacional»): EE. UU., Canadá, Perú, China, Irán, Catar y Filipinas.
- **Cambios del integrador en los JSON** (anotados en el campo `check`/`note` de cada uno, «[Integrador…]»): 29 abreviaturas que se
  repetían entre países; «Voley Aguere» → «Voley Lagunero» (LAG), porque chocaba con el CV Aguere real de La Laguna; resultados de 20
  búsquedas entre comillas (sin choque salvo Aguere; Manacor, Capodistria y Verona quedan con ⚠ por casi iguales).
- **Pruebas:** `tools/careertest.js` usa en las secciones de pista las ligas de prueba inventadas de `tools/leagues-fixture.js` (los
  antiguos datos provisionales: liga impar de 9, de 8 a doble vuelta, país sin 2ª) y prueba aparte los datos reales («datos reales»:
  28 países, unicidad, nada de nombres reales en el juego, js/leagues.js al día con los JSON, IA por tramos, copas, 2 temporadas,
  crear en cada uno de los 28 países). Capturas finales: `tools/out/arte/carrera-pista/final/shots.js` (1280×720 y 844×390 táctil).

### Pendiente
- **Color del líbero del club (petición al lote A, js/players.js):** `matchSetup6` ya pasa `kit.kitLibero` y `rivalKit.kitLibero`
  (main.js los deja en `opts.kit` y `opts.kit.rival`), pero `liberoKit(team)` de players.js calcula el color solo. Cambio pedido: en
  `setKit(st)`, guardar `st.kitLibero` (equipo 0) y `st.rival.kitLibero` (equipo 1) y, en `liberoKit`, usarlos como camiseta si son
  número y se distinguen de las dos camisetas (`kitDist` ≥ 0,8); si no, el cálculo de ahora. Fuera de la Carrera no cambia nada.
- **Empezar en un país de élite:** con los tramos nuevos la 2ª italiana (72-82) queda mitad Normal, mitad Difícil (antes, toda
  Difícil). Si Ferran la quiere más suave, subir la media inicial allí o bajar los ovr de las 2ªs de élite.
- **Revisión de Ferran** de `notes/clubes-reales.md` (ya está en el juego, pero sin publicar hasta que la revise): ⚠ en 36 clubes y
  en varias competiciones, búsqueda entre comillas pendiente en 204 clubes y en casi todas las copas.
- **Choque de equipaciones:** si la camiseta del rival se parece a la tuya, players.js le pone la de la CPU de siempre (roja); con
  clubes reales sería mejor la 2ª equipación del club (su segundo color). Petición posible al lote A (players.js `setKit`).
- Ligas de 9-10 clubes: 9 jornadas (a una vuelta), frente a 14 de las de 8 y 11 de las de 12. Si se quiere igualar, la opción es
  una vuelta + fase final para 9-10.
- Puestos colocador, opuesto y central: dependen del lote A (la Carrera ya los lee de `CTRL_ROLES6`). Nota y «Simular» de esos
  puestos calibrados por analogía (`RATE6`, `SIM_SHARE6`), sin medir.
- Escudos propios: no hay (la ficha enseña los tres colores del club).

## Vida de la Carrera (12-nov-2026; pedido de Ferran: «que el modo carrera sea más extenso y mejor, más entretenido y "enticing"»)

Ficheros nuevos: `js/career-life.js` (`VB.CareerLife`, datos y reglas, sin DOM, se carga en node) y `js/career-life-ui.js`
(`VB.CareerLifeUI`, HTML de la pestaña «Fama» y de las tarjetas de Partido). index.html los carga entre career.js y career-ui.js.
Estado en `c.life` dentro del mismo guardado (sin subir `VER`: `ensure()` lo crea al vuelo con valores por defecto; un guardado
viejo funciona). career.js solo llama a `life(c, tipo, …)` en 5 puntos (create, matchSetup 'setup', closeMine y benchNext 'match',
endSeason 'season', newSeason 'newSeason') más un sumando en `offerScore`; si career-life.js no está, todo sigue como antes.
**Pensado para la rama `carrera-pista`:** al rebasarla, basta conservar esas llamadas (los textos usan `c.mode === 'hall'` para la pista).

- **Reto de la jornada** (`challengeAt`, determinista por semilla y jornada; se ve en Partido antes de jugar y en `g.career.goal`):
  remates, aces, bloqueos (bloqueador/universal), defensas (defensor/universal), asistencias (defensor), nota, ganar sin ceder set
  (no en la Regional) o ganar con pocos errores. Premio: seguidores, XP y dinero (×2 en el duelo, ×1,5 en el open). Solo jugando.
  Umbrales medidos con el autopiloto (≈ jugador bueno, partidos de Carrera reales en node): cumple ~45-55 % (antes de endurecer, 75 %).
- **Fama** (`c.life.fame`, seguidores): por partido `max(0, nota − 5,5) × 22 + 18 si ganas (+30 en el open)`, × liga (1/2/4/8/15),
  × racha (+5 % por victoria seguida, hasta 6), simulado ×⅓; nota < 5 jugando: −2 %. Títulos, ascensos, premios y logros suman más.
  Escalones: Desconocido, Promesa local (500), Conocido en el circuito (2.000), Figura (7.000), Estrella (20.000), Ídolo (50.000),
  Leyenda viva (120.000). Interés de los clubes `offerBonus` = 0,5 × escalón (máx. 3) + 2 con el agente estrella + 2 con ojeador.
  Medido jugando con el autopiloto: ~3.500 seguidores la 1ª temporada, ~12.000 la 2ª, ~16.000 la 3ª.
- **Patrocinadores INVENTADOS** (`SPONSORS`, gags de vóley: «Horchatería El Bloqueo», «Colchones El Banquillo»…; ninguno guiña a
  una marca real): 2 ofertas al subir de escalón y cada verano desde «Promesa local». Pagan por jornada según el escalón y un
  bonus por un objetivo de temporada (aces, remates, victorias, bloqueos o defensas). Duran una temporada.
- **Decisiones** (`EVENTS`, 40 % tras cada jornada si no hay otra pendiente): rueda de prensa (derrota / victoria), fiesta,
  clínic benéfico, reto viral, pique del rival, pareja de bajón, tele, molestias en el tobillo (jugar tocado: −2 en el siguiente
  partido), ojeador, pancarta, rodaje del anuncio. Cada opción enseña sus efectos con ▲/▼ (entrenador, química, fama, fatiga,
  dinero, entreno, forma de la pareja). Si se juega sin contestar, caduca sin efecto.
- **Rival personal**: un jugador inventado de otro club de tu liga; los partidos contra su club son duelo (cara a cara guardado).
  Al cambiar de liga, la mitad de las veces te sigue (ficha por un club de tu liga nueva) y si no, rival nuevo.
- **Tienda** (Fama › Tienda): material de 3 niveles (1.500 / 6.000 / 24.000 €) que suma +1/+2/+3 en el partido a dos atributos
  (gafas o rodilleras: recepción y defensa; calcetines de arena o zapatillas: salto y velocidad; muñequeras: colocación y control;
  banda elástica: remate y saque), como la química (no toca tu atleta). Servicios por jornada: entrenador personal (+50 % de
  progreso), nutricionista (−5 de fatiga), agente estrella (+2 de interés). Sin dinero se cancelan solos.
- **Premios de la temporada** (`AWARDS`): MVP (nota media y top 2), máximo anotador, mejor sacador, muro del año, mejor defensa
  (por partido, contra rivales simulados) y revelación (una vez, ≤ 23 años, liga nueva). Con más de media temporada simulada no
  hay premios. Medido con el autopiloto: 0-2 por temporada. Van al palmarés (`kind: 'premio'`).
- **Logros** (`ACH`, 28): partidos, victorias, puntos, aces, bloqueos, rachas, retos, duelos, títulos, premios, fama, nivel,
  patrocinio y material; premio una sola vez (puntos de mejora, seguidores o dinero). Con todo simulado la media sube ~+3 en 8
  temporadas por los puntos de los logros (careertest: 64 → 67).
- **Legado**: puntuación por títulos (más en categorías altas), premios, fama, victorias y logros; escalones Jugador de club,
  Referente (60), Ídolo del circuito (150), Leyenda (300), Mito del vóley (500). Desde los 32 años baja el físico cada verano;
  desde los 30 te puedes retirar (doble pulsación): la carrera pasa al **Salón de la Fama** del dispositivo
  (`localStorage['voley3d.legends']`, 20 mejores) y se cierra; la siguiente carrera empieza con 150 seguidores por escalón de legado
  de la mejor leyenda.
- **UI**: pestaña «Fama» (Fama · Tienda · Logros · Legado) entre Club y Liga, con punto si hay ofertas de patrocinio; en Partido,
  la decisión pendiente y la tarjeta del reto (o del duelo); en el último partido, reto cumplido o no, seguidores, dinero, duelo y
  logros; en la hoja final del partido (main.js `careerEndSheet`), una línea con el reto. Mensajes de tipo `fans` («Fama»).

**Sin hacer (ideas para otro sprint)**: enseñar el reto durante el partido (HUD de ui.js, que no es de este lote; el dato ya
está en `g.career.goal`); objetivos de patrocinio para la pista 6v6; selección nacional y torneos de verano.

## Escalón, rol y sueldo, cierre del muñeco (11-nov-2026)

Sin cambiar el formato del guardado (v3; los campos nuevos tienen valor por defecto: `money` 0, `stats.bench` 0).

### Escalón Regional → Nacional (`SOFT`, `softFor`, `difficultyFor`, `diffLabel`, `DIFF_AT`)
Antes: Regional toda Fácil (bot «medio» 99-100 %) y Nacional toda Normal (con la prueba a media 35, 0 de 8). La sim solo tiene
4 perfiles y el único intermedio que existe es **Normal + `rookie`** (`createGame({rookie})`: saque sin salto ni baile, remate ×0,9,
error ×1,4, defensa ×0,8, bloqueo ×0,5 y la ventana de timing de Fácil para ti). En la UI, «IA Normal suave».
- Circuito Regional: club < `SOFT.reg` (34) Fácil; 34-37 Normal suave; ≥ `SOFT.regNormal` (38, el mejor o los dos mejores) Normal.
- Circuito Nacional: < `SOFT.nat` (42, los 2-3 peores) Normal suave; desde 42 Normal.
- Difícil desde 56 (`DIFF_AT`, antes 52): media Superliga en Normal (con 52 el bot medio que subía ganaba 2 de 60 en la Superliga).
- `matchSetup()` devuelve `rookie: true` y `diffName` con el suave. **Falta en main.js** pasar `rookie` a `createGame` (ver «Para el
  integrador»): sin eso, «Normal suave» se juega como Normal pura (el muro de antes en los mejores de la Regional).

Medido (scratchpad `season.js`: temporadas JUGADAS por el bot de simtest con la progresión real, control «uno», 8 carreras por caso;
`bal.js`: partidos sueltos, 12-16 por caso):

| caso | antes | ahora |
|---|---|---|
| Regional, bot medio, temporada 1 | 119-4 (97 %; Fácil 69-0, suave 50-4 con `SOFT.reg` 35 sin Normal) | **94-24 (80 %)**: Fácil 57-0, suave 26-1, Normal 11-23; campeón 3 de 8, 2º 4, 3º 1 |
| Regional, bot novato | 50 % contra Fácil | **39-56 (41 %)**: Fácil 39-12, suave 0-21, Normal 0-23 (mitad de tabla) |
| Regional, bot bueno | 100 % | 100 % (125-0) |
| Nacional (temporada 2 del medio, media ~50) | Normal en todos | Normal 62-51 (55 %), suave 23-1 |
| Superliga (temporada 3 del medio, media ~54) | Difícil 2-58 | Normal 24-23, Difícil 0-26 (con 56 la mitad de la liga es Normal) |
| Superliga, bot bueno | Difícil 79-21 | Normal 64-0, Difícil 30-14 |
| tu media 35 contra el peor de la Nacional (prueba) | Normal (rival 40): 2 de 16 (13 %) | suave (rival 40): 9 de 16 (56 %) |

El compañero sigue notándose sin romper nada (temporada 1 Regional, compañero forzado): medio −7 74 %, auto 80 %, +5 86 %;
novato −7 35 %, auto 41 %, +5 47 %.

### Compañero: techo en el partido (`MATE_CAP`, `mateFormCap`)
El desvío propio sigue en −9..+5 (puede ser mejor que el club y rinde como un jugador medio de su circuito). Lo que lo rompía era sumar
la racha: con +5 y forma +3 la pareja jugaba a +8. Ahora media + racha nunca pasa de club + `MATE_CAP` (6) en el partido ni en
`teamOvr` (se recorta solo la racha buena; la mala y la química, que es de los dos, no).

### Rol prometido y sueldo (`BENCH`, `benchFor`, `benchNext`, `promoteCheck`, `coachFloor`, `pay`, `physio`)
- **Rotación**: con la confianza del entrenador < 60, alguna jornada de liga (35 %, nunca dos seguidas ni la primera en el club) te
  sienta: `next().bench`, `matchSetup()` da null y el hub enseña «Esta jornada no juegas» con el motivo y «Ver la jornada»
  (`benchNext`: la juega tu pareja con el mejor de la plantilla, simulada; sin nota ni XP, descansas −15 de fatiga, entrenas y
  cobras; `simulateNext` también lo deriva). Con 70 de confianza pasas a **titular** y te suben el sueldo (mensaje).
- **Titular**: solo te sienta si está descontento (< 30). Si lo hace, **promesa incumplida** (`c.broken` = temporada): puedes irte sin
  pegas aunque tengas contrato (`earlyExit` false), +3 de interés en las ofertas y a mitad de temporada basta nota 6,5. Mensaje del agente.
- **Titular indiscutible**: nunca al banquillo y la confianza no baja de 35.
- La ficha de la oferta explica cada rol (`ROLE_HINT`) y el sueldo se compara con el tuyo («(ahora 500 €)»).
- **Sueldo**: se cobra cada jornada tuya (la mitad del mensual: 7 sueldos por temporada) en `c.money`. Club › Contrato enseña los
  ahorros; Jugador › Entreno tiene el **fisio** (−30 de fatiga, una vez por jornada, cuesta el 60 % del sueldo base del circuito:
  350 € en la Regional, 900 en la Nacional…).
- Totales de Palmarés y temporadas cuentan los banquillos.

### Fichar a mitad de temporada: confirmación
«Firmar» en la ventana de mitad de temporada ya no ficha a la primera: la ficha enseña un aviso («¿Fichar ya por X? Dejas Y a mitad de
temporada y juegas lo que queda en el Circuito Z con su calendario, con N (química desde cero)», más la pega del contrato si la
hay) con «Sí, fichar» y «Cancelar». Cambiar de pestaña lo cancela. Probado con clics en Chrome (confirmar, cancelar, fichar).

### Cierre del muñeco
- **Palmarés migrado** (`beachTrophies`, en cada `migrate`, idempotente): «Liga Regional» → «Circuito Regional», «Copa Nacional» →
  «Open Nacional», «Ascenso a Superliga» → «Ascenso a la Superliga de Playa»… (también los guardados que ya migraron a v3 con el
  nombre viejo). La etiqueta de la copa en Palmarés dice «Open».
- **Club › Ficha › Compañero**: nombre y debajo pastillas (rol, media, desvío en verde/rojo) en vez del paréntesis.
- **Antetítulo de la hoja final**: comprobado en pantalla a 1280×720, 844×390 y 667×375: «Circuito Regional ◆ Jornada 1 de 14».
- **Hoja final a 667×375**: con nota, XP, subida de nivel y dos insignias la hoja medía 424 px en 341 y «Menú principal» quedaba fuera.
  CSS en career-ui.js (`#end.career`, solo ≤ 420 px de alto; el `<style id="careerCss">` se pone ya al cargar, `ensureCss`): sin
  «Jugada más larga» y los dos botones en una fila → 350 en 341 con «Menú principal» entero a la vista (297-341); a 844×390 cabe
  (302 en 302); a 1280×720 no cambia. **Falta en main.js** marcar `#end` con la clase `career` (ver abajo).

### Para el integrador (main.js, no es mío)
1. `ctx.actions.startCareerMatch`: añadir `rookie: !!m.rookie` a las opciones de `ctx.actions.startMatch({...})`.
2. `startMatch`, en `Sim.createGame({...})`: cambiar `rookie: cs ? false : isRookie()` por `rookie: cs ? !!opts.rookie : isRookie()`.
3. `careerEndSheet(g, s)`: al principio, `var en = $('end'); if (en) en.classList.add('career');` y quitarla al restaurar
   (`restoreEndButtons`: `var e = document.getElementById('end'); if (e) e.classList.remove('career');`).

### Pregunta para Ferran (sin tocar)
**Circuito Mundial**: los 1-2 clubes de élite (media ≥ 80, IA Experto) no los gana nadie (bot medio 0 de 20, bueno 0 de 8 con media 85).
¿Es el reto final o se suaviza (subir `DIFF_AT` de Experto a ~84, o Experto solo en la Final a Cuatro)? Se ha dejado como estaba.

## Sprint playa (10-nov-2026, v3): la Carrera es de VÓLEY PLAYA

Pedido de Ferran: «Te pueden fichar clubes, pero de vóley playa», «nerfear un poco al compañero» y «que puedas tener mejores y
peores compañeros». Guardado `v: 3` (`migrate()` pasa v1 y v2 sin perder nada: ver §Migración).

- **Partidos en la playa.** `matchSetup()` devuelve `venue: 'beach'` y `points: 21` (`VB.Career.VENUE/PTS/PTS3`, de `VB.BEACH`);
  main.js (`startMatch` con `opts.career`) fuerza el escenario Platja Llarga aunque el ajuste «Escenario» sea el pabellón
  (`forceVenue('beach')`: `onSettings(copia de settings con arena 'beach', 'arena')` a todos los módulos, sin tocar `ctx.settings`)
  y lo deshace al volver al menú (`toMenu` → `unforceVenue`; si se cambió el ajuste en la pausa, manda el ajuste). La sim juega con
  reglas de playa (pista 16×8, sets a 21 y el 3r a 15, cambio de campo cada 7/5, bloqueo = toque, pokey, dobles); `quickSim` (resto
  de la jornada y «Simular») también a 21/15. El selector «Puntos por set» de Crear jugador desaparece (`c.points` = 21 siempre).
  La equipación del rival sigue por `Players.setKit({..., rival})` (players.js, de otro dueño): en la playa es camiseta de tirantes
  con los colores del club; si se parece a la tuya, la CPU azul de siempre.
- **Clubes de vóley playa.** Nombres «CV Platja Rocaverde», «Arena Puertoluz Sud», «Dunes Brisamar»… (`PREFIX`/`SUFFIX`) con sede en
  una playa inventada (`club.beach`: «Cala Rocaverde», «Platja Gran de Fuenteviva»…; `clubInfo().beach`; la ficha de la oferta y
  Club › Ficha › «Sede» la enseñan). Circuitos: Circuito Regional / Nacional, Superliga de Playa, Circuito Continental, Circuito
  Mundial (`LEAGUES[].art` = artículo: `lname(L)` «el Circuito…» / «la Superliga…», `toL(L)` «al / a la»; career-ui `deL(L)` «del /
  de la»). La copa de los 4 primeros es el **Open** (Open Regional… Final a Cuatro Mundial). Roles: **Bloqueador** (atk) y
  **Defensor** (cr), Universal; las claves atk/cr/uni se conservan. Estilos del compañero sin repetir el nombre del rol («Muro en la
  red», «Pulpo en la arena»). Textos del hub, las ofertas, los mensajes y Crear jugador hablan de arena, pareja, circuitos y open.
- **Compañero con nivel propio** (§Compañero): media = media del club + desvío propio (`mateOff`: −9..+5, media −2, reparto casi
  plano entre −6 y +1 con colas hasta los extremos —0,25·u₁ + 0,75·u₂—, desviación teórica 3,2; medido en careertest: 60 carreras de
  −7 a +3 (media −2,1, desviación 2,8) y 105 ofertas de inicio de −9 a +4, 29 con compañero a ≤ −5 y 7 a ≥ +3;
  antes siempre +3), rol complementario que se nota (`genSt` con el perfil del rol), `mateProfile(m)` → puntos fuertes y flojos
  (atributos a ≥ 4 de su media), `m.form` (−3..+3: paseo aleatorio tras cada partido tuyo, `mateFormStep`; suma a todos sus
  atributos en `matchSetup` y `FORM_SIM` 0,4 por punto a `teamOvr`; en verano vuelve a 0; `formText`). Las ofertas traen el compañero
  con su desvío (`genOffers` → `newMate(..., ovr + mateOff)`) y la ficha lo enseña (media, «+4 sobre el club» / «−3 bajo el club»,
  fuertes/flojos, estilo): un club con buen compañero es un argumento para fichar. La plantilla (`genSquad`) da dos alternativas a
  ≥ 3 de desvío del titular (cambiar de compañero cambia de verdad los atributos del partido y la fuerza simulada; Club › Compañero
  enseña «+3 respecto a Íñigo»). El club renueva al compañero en verano si queda a `MATE_RENEW` (7) o más por debajo del club.

### Migración v1/v2 → v3 (`migrate`, idempotente; `tools/careertest.js` «Migración de un guardado v2»)
`beachify(o)`: renombra los 40 clubes con una semilla propia (`hash(seed, 'playa')`; nombre, abreviatura única y sede nuevos; id,
nivel, q, equipación, calendario, resultados, contrato, mensajes y jugador intactos), pasa el historial (por id) y el palmarés (por
nombre) al nombre nuevo del mismo club, roles a Bloqueador / Defensor, `form: 0`, `points` 21 y un mensaje «La Carrera se muda a la
playa». Los partidos ya jugados a 15 se quedan; desde ese momento se juega en la arena.

### Compañero: medida del nerf (bot «medio» y «novato» de simtest, control «uno», 84 partidos por caso; `tools/out/carrera-playa/mate_balance.js`)
Puntos por partido (remates + aces + bloqueos) de tu jugador (bot) y del compañero IA, y % de los puntos de la pareja:

| caso | compañero − club | tú | compañero | % pareja (tú / comp.) | puntos pareja |
|---|---|---|---|---|---|
| Regional, pabellón a 15, medio (ANTES) | +3,0 | 17,5 | 9,0 | 58 / 30 | 70,2 % |
| Regional, pabellón a 15, medio | −5,0 | 18,3 | 8,1 | 60 / 27 | 66,4 % |
| Regional, PLAYA a 21, medio, antes | +3,0 | 19,4 | 16,7 | 46 / 40 | 67,4 % |
| Regional, PLAYA a 21, medio, AHORA | −3,6 | 21,3 | 15,3 | 50 / 36 | 66,5 % |
| Regional, PLAYA a 21, novato, antes | +3,0 | 11,7 | 21,1 | 28 / 50 | 50,4 % |
| Regional, PLAYA a 21, novato, AHORA | −3,6 | 12,0 | 20,0 | 28 / 48 | 49,7 % |
| Nacional (tú 42), PLAYA, medio, antes | +3,0 | 15,5 | 16,6 | 38 / 40 | 47,2 % |
| Nacional (tú 42), PLAYA, medio, −5 | −5,0 | 14,7 | 13,1 | 41 / 36 | 44,9 % |
| Nacional (tú 42), PLAYA, medio, AHORA | +1,0 (3 compañeros) | 14,5 | 14,5 | 38,5 / 38,6 | 45,4 % |
| Superliga (tú 50), PLAYA, medio, AHORA | +1,0 | 10,8 | 10,8 | 38 / 38 | 39,6 % |
| Regional, PLAYA, medio, reparto plano (final) | −2,9 | 20,4 | 15,2 | 49 / 36 | 67,3 % |
| Regional, PLAYA, novato, reparto plano (final) | −2,9 | 12,3 | 20,1 | 29 / 47 | 48,3 % |
| Nacional (tú 42), PLAYA, medio, reparto plano (final) | +2,0 | 15,4 | 15,0 | 39 / 38 | 46,0 % |

(Las tres últimas filas, `after_v3b.log`: tras cambiar el reparto del desvío de triangular a casi plano —misma media −2, más
horquilla— los números no se mueven: el compañero IA sigue por debajo o a la par de un jugador medio de su circuito.)

Lectura: en el pabellón el compañero nunca hacía más puntos que un jugador medio; en la PLAYA (el bloqueo cuenta como toque: el
compañero IA bloquea 2-4 puntos por partido) sube su parte y en el Nacional con club + 3 rendía POR ENCIMA de un jugador medio
(16,6 contra 15,5). Diez puntos de media del compañero ≈ 3,5 puntos suyos por partido y ≈ 2 % de los puntos de la pareja: el
atributo pesa poco frente al perfil `DIFF.mate` de la sim (recv 0,85, dig 0,56, atkErr 0,05: entre Normal y Difícil), así que el
nerf por atributos es moderado a propósito (media −2 en vez de +3 = −5 de media: compañero −1,5 puntos por partido, pareja −1..−2 %).
Un novato sigue haciendo menos puntos que su compañero (28 / 48 %): es él quien va corto, no el compañero. Si hiciera falta más,
el sitio es `DIFF.mate` o `statProf` (sim), no la Carrera. La CPU rival no cambia.

Mezcla pedida por Ferran: el bucle del modo carrera tipo FIFA (club, temporada, jornadas, nota del partido, objetivos, entrenador,
ofertas, ascensos) + insignias que se desbloquean haciendo cosas (VB.Badges, ver js/badges.js). Todo inventado: clubes, ciudades,
ligas, copas y nombres de jugadores.

## Bucle

1. **Crear jugador**: nombre (18 car.), dorsal 1-99 y rol (v3: sin puntos por set, vóley playa a 21 y el 3r a 15). Control: siempre solo
   tu jugador (v2; antes había «Los dos»). Media inicial 35 con el perfil del rol:
   - Bloqueador (`atk`; antes «Atacante»): salto +6, potencia +7, control +3, bloqueo +4, saque +1 · recepción −7, defensa −4, colocación −10.
   - Universal: casi plano (velocidad y reacción +2, bloqueo −3).
   - Defensor (`cr`; antes «Colocador-receptor»): colocación +9, recepción +7, defensa +4, reacción +2 · salto −5, potencia −8, bloqueo −7, saque −4.
   El atleta es el de VB.Prog (`newAthlete`): `st, lvl, xp, pts, matches, bp, bd, beq` + `name, num, role, roleKey, age` (18 años).
2. **Club**: lo eliges tú entre las ofertas de inicio (v2, ver §Gestión; antes te tocaba uno de los 2-3 peores de la Regional). El club pone compañero con el rol complementario
   (bloqueador ↔ defensor; universal ↔ universal) y media = media del club + su desvío propio (v3, `mateOff` −9..+5; antes siempre +3).
3. **Temporada**: liga a doble vuelta (método del círculo, 14 jornadas de 4 partidos) en las 5 ligas a la vez + copa de los 4
   primeros de tu liga (semifinales 1-4 y 2-3, final; si no te clasificas se juega sola). Puntos: 2-0 = 3, 2-1 = 2, 1-2 = 1, 0-2 = 0.
   Desempate: puntos, victorias, cociente de sets, cociente de puntos.
4. **Cada jornada**: «Jugar partido» (se juega de verdad) o «Simular» (resultado con `quickSim` según la fuerza de tu pareja y
   tu forma; experiencia a la mitad; para las insignias solo cuentan «partidos jugados» y «victorias»). El resto de partidos de
   todas las ligas se simulan al cerrar el tuyo.
5. **Ventana de mitad de temporada** (tras la jornada 7): ofertas solo con nota media ≥ 7 (saltar de liga exige ≥ 7,5).
   Caducan al jugar o simular el siguiente partido. Aceptar = cambias de club ya y sigues su calendario.
6. **Fin de temporada**: posición, objetivo (cumplido ±15 de confianza del entrenador), campeón de liga/copa, ascensos (los 2
   primeros suben) y descensos (los 2 últimos bajan) de TODAS las ligas, tu club incluido. Hasta 3 ofertas: «Fichar» o «Seguir en
   tu club». Empieza la temporada siguiente (+1 año; calendario nuevo; el club renueva al compañero si se ha quedado 4+ por debajo).

## Gestión (v2, 10-nov-2026; pedido de Ferran: «self-management»)

Guardado `v: 2`. `migrate()` pasa los v1 sin perder nada: un jugador que ya estaba en un club sigue en él (no elige de nuevo),
`ctrl: 'both'` → `'one'`, contrato por defecto (2 temporadas, rol según el entrenador), plantilla nueva, química = 4 × partidos de
la temporada (tope 60), entrenamiento «Equilibrado», fatiga 0 y un mensaje «Novedades en la Carrera». Idempotente.

- **Solo tu jugador**: la Carrera ya no ofrece «Controlar»; `matchSetup().ctrl` siempre `'one'` y la nota es solo tuya.
- **Inicio sin club** (`phase: 'pick'`, `myClub: -1`, `mate: null`, `window: 'start'`): `genStartOffers` da 3-4 clubes de entre
  los 6 peores de la Regional y (75 %) una **prueba** en el peor de la Nacional (`trial`, `chance` = 0,3 + 0,04 × (media − 35), 0,1-0,75).
  Ficha de cada oferta: club, liga, prestigio (`clubInfo().stars` 1-5), media, estilo del club (fijo por nombre), ciudad, compañero
  completo (`mateP`: nombre, rol, media, estilo; es el que te dan al firmar), objetivo, rol prometido, años, sueldo ficticio
  (`SALARY` por liga × nivel × rol). `acceptOffer(i, años)` firma (prueba: si falla, la oferta desaparece y sigues eligiendo);
  `moreTime()` (una vez): el de menos interés se va y llama otro; `rejectAll()`: ofertas nuevas de los 3 peores clubes, sin prueba
  y algo peor pagadas. `create({autoClub: true})` asigna club como antes (solo pruebas).
- **Contrato** `c.contract {club, years, left, role, salary, since}`: `left` cuenta la temporada en curso. Al acabar la última,
  `review.renew` (rol por la confianza: ≥ 70 indiscutible, ≥ 45 titular) y `stay(años)` renueva. El rol fija la confianza inicial
  del entrenador (45/55/65). En 2v2 no hay minutos: el rol es eso y el sueldo (texto).
- **Negociar** `negotiate(i)`: pide un rol más; sale si `interés + 3 + azar(0-4) > umbral` (3 titular, 8 indiscutible); después la
  oferta queda «firme». Las ofertas de mitad/fin de temporada también traen `mateP` y sueldo.
- **Traspaso** `requestTransfer(on)`: −8 de confianza, +5 en `offerScore`, a mitad de temporada basta nota 6,5 (sin él, 7). Se quita
  al cambiar de club; retirarlo da +3.
- **Entrenamiento** `setTraining(k)`: tras cada partido (jugado o simulado) `trainWeek` suma progreso: Equilibrado +15 a Físico,
  Defensa y Ataque (fatiga +4); Físico/Defensa/Ataque +50 a su grupo (fatiga +12); Descanso nada (fatiga −35). Cada 100 → +1 gratis
  en el atributo más bajo del grupo (grupos de `VB.Prog.GROUPS`). Fatiga > 40 → −1..−4 a TODOS tus atributos en el partido
  (`matchSetup`) y −0,5 por punto en `teamOvr`; aviso del preparador al pasar de 60. Curva (careertest, todo simulado, Equilibrado):
  media 39 → 43 → 48 → 51 → 54 → 56 → 59 → 61 en 8 temporadas (antes 57: el entreno suma ~+7 puntos por temporada).
- **Compañero y química**: `c.squad` = otros 2 del club (uno del mismo rol con media del club, un universal −1); se rehace cada
  verano y al fichar. `changeMate(i)` exige confianza ≥ 40; la química se guarda con cada uno. Química +5 por partido jugado, +3
  simulado; `chemBonus` = mín(3, química / 30) suma a los DOS en reacción, colocación y recepción (`matchSetup`, solo ese partido;
  sim.js no se toca) y +0,5 por punto en `teamOvr`.
- **Bandeja** `c.inbox` (tope 40): bienvenida y objetivo, cambios de estado del entrenador (con frase), mitad de temporada (posición
  frente al objetivo y ofertas), fin de temporada (resumen, ofertas, renovación), entrenamiento/fatiga, traspaso, compañero,
  negociación, prueba. `unread`, `readMsg`, `readAll` (la pestaña Mensajes marca como leído al abrirla).

**Interfaz (career-ui.js)**: pestañas Partido · Mensajes (n) · Jugador (Ataque/Defensa/Físico/Insignias/Entreno) · Club
(Ficha/Compañero/Contrato/Ofertas) · Liga (Clasificación/Calendario) · Palmarés (Palmarés/Temporadas/Opciones). Eligiendo club: una
pestaña por oferta + «Comparar» (tabla). ←/→ con el foco en una pestaña pasa a la siguiente de su barra (teclado y stick).
Todas las pestañas salen de `tabsBar()`: cuando el agente de menús publique su componente común (VB.UI.tabs o similar) se cambia
solo esa función. Arreglo: a 2560×1440 la Carrera se quedaba en la mitad de arriba (zoom de index.html + `height: calc(100%/--vs)`);
career-ui.js fuerza `#app #career .cr-in{height:100%}` (medido: 1420 de 1420 px).

## Ligas

(v3, playa: «Liga Regional» → Circuito Regional, «Liga Nacional» → Circuito Nacional, «Superliga» → Superliga de Playa, «Liga
Continental» → Circuito Continental; las copas son «Open …». Los guardados viejos conservan los nombres de entonces en el palmarés.)

| nivel | circuito | media de los clubes | IA rival (por club) | XP × | arbitraje (`createGame({ref})`) | open |
|---|---|---|---|---|---|---|
| 0 | Circuito Regional | 28-40 | Fácil (todos) | 1 | alto, sin challenge | Open Regional |
| 1 | Circuito Nacional | 38-50 | Normal | 1,5 | medio, sin challenge | Open Nacional |
| 2 | Superliga de Playa | 48-61 | Normal (< 52) / Difícil | 2,1 | medio, sin challenge | Open de la Superliga |
| 3 | Circuito Continental | 58-71 | Difícil | 2,8 | jueces de línea, sin challenge | Open Continental |
| 4 | Circuito Mundial | 68-84 | Difícil / Experto (≥ 80) | 3,6 | jueces de línea + challenge | Final a Cuatro Mundial |

La media de un club = `ovr[0] + (ovr[1] − ovr[0]) × q` (q 0..1, su rango dentro de la liga). Cada temporada q da un paseo
aleatorio (±0,12 con vuelta suave a 0,5); el que asciende entra con q 0,12-0,42 y el que desciende con 0,55-0,9.
Rivales en el partido jugado: `attrs[1] = [genSt(media + 1, 'atk'), genSt(media − 1, 'cr')]` (semilla por partido).

### Calibrado (sim en node, autopilot, 15 puntos por set, 8 partidos por caso)

`attrs` del equipo 0 = tu jugador (media «esperada» al llegar a esa liga) + compañero (club + 3); `attrs` del rival como arriba.
El autopilot juega como el bot «medio» de simtest más ~10 puntos de % (autopilot contra Normal con todo a 35: 61,8 % de puntos;
el bot medio contra Normal sin atributos: ~50 %).

| caso | IA rival | % puntos del equipo 0 |
|---|---|---|
| 35+36 contra 28 / 40 | Fácil | 78,9 / 75,0 |
| 42+47 contra 38 | Fácil | 81,1 |
| 42+47 contra 38 / 50 | Normal | 59,2 / 60,5 |
| 50+57 contra 48 / 61 | Normal | 64,3 / 60,4 |
| 50+57 contra 53 | Difícil | 49,5 |
| 58+67 contra 58 / 71 | Difícil | 52,7 / 46,1 |
| 68+79 contra 68 | Difícil | 50,3 |
| 72+80 contra 70 | Difícil | 49,8 |
| 72+80 contra 74 | Experto | 27,5 |
| 85+83 contra 78 | Experto | 31,2 |
| 68+79 contra 84 | Experto | 24,4 |

Conclusión: el perfil de la IA pesa mucho más que los atributos (10 puntos de media ≈ 2-4 % de puntos), así que la dificultad se
escalona por la media del club (`DIFF_AT`: ≥ 80 Experto, ≥ 52 Difícil, ≥ 38 Normal, si no Fácil; en la Regional siempre Fácil) y los atributos afinan dentro.
(Arreglos finales: con la IA Normal, los 1-2 mejores clubes de la Regional eran un muro: el bot medio con tu media 35 ganaba el 100 %
contra los de Fácil y el 10 % contra esos; el novato, del 60 % al 0 %. El salto queda en el ascenso a la Nacional.)
Para una persona «media» (≈ autopilot − 10): Regional ~65 % de puntos (un novato ~48 %: asequible), Nacional ~50 %, Superliga y
Continental 40-45 % (exigen mejorar), Circuito Mundial ~40 % y los 1-2 clubes de élite (Experto) solo con atributos altos,
insignias y buena mano. Herramienta usada (no se sube): un script de 30 líneas que llama a `Sim.createGame({autopilot, attrs,
difficulty, points: 15})` y cuenta puntos; se puede rehacer con `VB.Career.genSt`.

## Progresión (más generosa que la de Partido rápido)

- XP del partido jugado = `(40 + 22 × nota + 40 si ganas + 6 × mín(tus puntos, 10)) × XP de la liga`; simulado, la mitad. (Tope de 10:
  con control «uno» rematas casi todo y la XP jugada se disparaba.) Medido en la Regional, temporada 1 (bots de simtest, 28 partidos):
  jugado 242 (novato) / 299 (medio) / 339 (bueno) XP por partido; simulado 123 (87-155): simular da un 36-51 % de jugar.
- Nivel: `need(lvl) = 140 + 6 × lvl` XP; cada nivel da 4 puntos de mejora (Partido rápido: 80 + 40 × lvl y 3 puntos).
  Coste de subir un atributo: el de VB.Prog (1 hasta 50, 2 hasta 65, 3 hasta 80, 4 después).
- Huecos de insignias: los de VB.Badges (`2 + floor(nivel / 5)`, hasta 6).
- Curva medida en `tools/careertest.js` (todo SIMULADO, mitad de XP, gastando en lo más barato y aceptando la mejor oferta):
  media 39 → 43 → 46 → 50 → 52 → 54 → 56 → 57 en 8 temporadas (Regional → Continental). Jugando los partidos la XP es el doble:
  ~+8 de media la 1ª temporada y la élite (~65-70) hacia la 6ª-8ª. Simulando todo te estancas en la Continental (a propósito).

## Nota del partido (1-10, una decimal)

`bruta = 5,4 + (0,055·remates punto + 0,2·aces + 0,2·bloqueos + 0,045·asistencias + 0,035·defensas + 0,03·recepciones perfectas +
0,02·toques perfectos − 0,015·toques malos − 0,17·errores) × 40 / puntos jugados + resultado` (2-0: +0,9; 2-1: +0,6; 1-2: −0,3;
0-2: −0,6) y techo suave por encima de 8,5 (`8,5 + 1,5·(1 − e^(−(bruta − 8,5)/1,5))`). Con «Los dos» cuenta lo de la pareja (remates
×0,85). Antes (remate a 0,32) la nota era casi siempre 10 con control «uno» (15-18 remates punto por partido: medio 27 de 28 partidos
con 10, bueno 28 de 28). Ahora (Regional, temporada 1, 28 partidos por bot): novato 6,14 (4,6-7,9), medio 7,78 (5,7-9,1), bueno
9,10 (7,3-9,7), ningún 10. Errores = faltas personales tuyas y puntos del rival con `how:'error'` cuyo último toque fue tuyo. Asistencia =
`point.assist` (sim) o, sin él, tu colocación (2º toque) antes del remate punto del compañero. Simulado: 6,1 + 0,04 × diferencia
de fuerza ± 0,6 por el resultado ± 0,8 de azar (3-9,5).

## Entrenador, objetivos y ofertas

- Confianza 0-100 (empieza en 50): `+ (nota − 6,2) × 2,5 ± 1` por partido; ±15 al cumplir o no el objetivo. Textos: Descontento
  (< 30), Tiene dudas, Confía en ti, Pieza clave (≥ 70), Intocable (≥ 85).
- Objetivo según la posición esperada del club por su media: 1-2º «Subir de categoría» (en el Circuito: «Ganar el Circuito
  Mundial»), 3-4º «Entre los 4 primeros», 5-6º «Mitad de tabla», 7-8º «Evitar el descenso» («No acabar último» en Regional).
- Ofertas: `interés = tu media + 6 × (nota media − 6) + (entrenador − 50) / 10 + 0,5 × nivel de insignias equipadas −
  umbral(club) ± 4`, con `umbral = media del club − 5 (+2 si es de la liga de arriba)`; solo clubes mejores que el tuyo (misma
  liga con q mayor o la liga de arriba); a mitad de temporada −3. Se eligen 3 (preferencia por la liga de arriba) y se enseñan de
  mejor a peor club. Rol prometido (Rotación / Titular / Titular indiscutible) y años: solo texto.
- Al acabar la temporada, `endSeason` decide ya el nivel de todos los clubes para la siguiente (`c.pendingQ`: q de los que suben/bajan
  y paseo aleatorio del resto; `applyMoves` lo aplica tal cual), así que la oferta guarda y enseña la media REAL del club (`o.ovr`) y
  del compañero (`o.mate` = `o.ovr` + 3). Antes anunciaba la de antes de los ascensos (oferta de «Media 49 · compañero ~52» → 45 y 48).
- Fichar a mitad de temporada borra la tarjeta del último partido (era de tu club anterior).

## Integración (main.js)

- `ctx.actions.startCareerMatch()`: `VB.Career.matchSetup()` → `startMatch({career, attrs, badges, points, difficulty, ctrl,
  ctrlIdx: 0, kit, ref})` → `Sim.createGame({..., attrs: [[tú, compañero], [rival1, rival2]], badges: [[tus equipadas, null], null],
  ref})` (sim ignora `ref` hasta que lo implemente) y `Players.setKit(equipación del club)`. El juego queda marcado con
  `g.career = {season, week, label, me, rival, meName, rivalName, player, num, mate, …}`: ui.js no reparte experiencia ni
  insignias al escuadrón (`!ctx.game.career`, ya en ui.js).
- Cada frame de un partido de Carrera: `VB.Career.ingest(eventos, g)`. Al llegar `gameOver` (antes de `UI.update`):
  `VB.Career.matchDone({sets, setScores, win}, null, g)`, que llama a `VB.Badges.endMatch(g, win, [tuAtleta, null])` (los
  contadores los lleva badges.js con los eventos que le pasa ui.js) y cierra la jornada.
- Hoja final (solo DOM, tras `showEnd`): «Volver a la Carrera» en vez de «Revancha», sin «Revancha en …», antetítulo con la
  competición, «Gana el <club>» si pierdes y una línea con la nota, la XP y las insignias. «Revancha»/Intro/«Menú principal» →
  `toMenu()` → se abre el hub con el resultado. «Reiniciar partido» (pausa) repite el partido de Carrera; «Salir al menú» lo
  abandona (la jornada sigue pendiente) y vuelve al hub.
- Marcador: la abreviatura del club rival sustituye a «CPU» (DOM, cada 15 frames; ui.js solo reescribe si cambia su valor).
- Partido rápido: `badges: VB.Badges.forSquad()` (o `[[forPlayer(7), forPlayer(11)], null]`), protegido si no hay badges.js;
  `&nobadges=1` lo quita.
- Mando: con la Carrera abierta main.js llama a `VB.CareerUI.nav(it, dt)` en vez de `VB.UI.nav`, y Start = volver.

## Guardado dañado (arreglos finales)
`sane()` repasa todo el guardado (`saneDeep`): clubes (8 por liga, ids, q), compañero, calendario (5 × 14 × 4 con ids de su liga; si
no vale, calendario nuevo desde la jornada 1), resultados, listas, entrenador, objetivo, fase y jornada (`week` > 14 → copa; copa
rota → se rehace; fin de temporada sin resumen → uno mínimo). Lo irreparable (clubes, `myClub` inexistente, JSON roto) no se carga: se
guarda una copia en `voley3d.career.bak`, `VB.Career.lost()` da true y la pantalla de crear lo avisa (y el menú dice «Guardado dañado»).
Si aun así algo falla al pintar, `career-ui.js` enseña una tarjeta «No se puede abrir la carrera» con «Borrar la carrera dañada» (doble
pulsación). Probado en careertest y en Chrome (sin `sched`, sin `res`, `week: 99`, `myClub` inexistente, JSON roto).

## Pendiente (de otros dueños)

Resuelto en la integración del 9-nov-2026 (ver notes/ui_main.md, «Integración sprint Carrera»):
- **sim**: `createGame({ref})` aplica la tabla por liga (`g.refErr`, `g.chalPerSet`; `chal: 0` oculta el contador de challenge) y
  `createGame({nums})` pone tu dorsal y el de tu compañero (`p.num`; la camiseta y la UI ya lo leen).
- **players**: `setKit({..., rival: rivalKit})` viste al rival con la equipación de su club (si se parece a la tuya, la CPU de siempre).
- **ui.js**: marcador, presentación, pausa y hoja final con las abreviaturas de los clubes (`g.career.me/rival`; ya no hace falta
  `setNames`). Los titulares de los banners, el rótulo de revisión del challenge y el
  lector de pantalla dicen «el rival» / la abreviatura del club (arreglos finales, `cpuTxt` en ui.js).
- **career.js**: las ofertas de fin de temporada se miden con la liga de la temporada SIGUIENTE (antes un club que descendía
  ofrecía «Liga Nacional» y fichabas por él en la Regional).

- Sin probar a mano: mando real y táctil real en las pantallas de Carrera (probado: ratón/clic, teclado simulado y el flujo
  jugar → gameOver → hub en Chrome headless).

### Revisión y arreglos (11-nov-2026)
- **Plantilla** (`genSquad`): las dos alternativas quedan siempre dentro de `MATE_OFF` (−9..+5), a ≥ 3 del titular y distintas entre sí
  (`fit`: valor válido más cercano, primero alejándose del titular). Antes, al deshacer el empate entre las dos, la 2ª se movía 3 puntos
  HACIA el titular (p. ej. titular −6 y las dos a −9 → la 2ª en −6, «±0 respecto a Unai»: 56 de 600 a menos de 3) y el clamp dejaba la
  plantilla en −10..+6. Medido en 300 carreras (scratchpad `rv/sq.js`): plantilla −9..+5, |alternativa − titular| mín. 3, media 4,6.
- **Ficha de la oferta** (`mateLine`): el desvío («−7 bajo el club») va en su propia pastilla (verde/roja si se nota, `.chip.dv.g/.r`)
  y no dentro de la de «Media 30» (pastilla dentro de pastilla que se salía de la columna a 1280 y a 844).
- **Hub**: «Tú llevas a Ferran (dorsal 1) y a tu pareja la lleva la IA.» y la pareja en pastillas (Pareja: nombre · rol · Media · desvío ·
  Forma), en vez de una lista metida en un paréntesis («Juegas con Ferran…» se leía como si Ferran fuera el compañero).
- **Comparar ofertas**: columna Objetivo en corto (Campeón / Ascenso / Top 4 / Top 6 / Salvarse / No acabar último; la frase entera
  sigue en la ficha) y Compañero con el desvío («30 (−7)»).
- **Antetítulo de la hoja final** (main.js): la etiqueta `cs.label` («Circuito Regional · Jornada 1 de 14») se pinta con el rombo de
  `VB.UI.sep(…, 'd')`, como el resto de antetítulos; antes salía el «·» crudo.
- CONTRACT.md ya dice que la Carrera juega en la playa (`forceVenue`) y el 6v6 en el pabellón.
- **Pendiente** (de la revisión, sin tocar): con el compañero en lo alto de la horquilla (+4/+5) rinde como un jugador medio de su
  circuito (no por debajo); si se quiere «nunca mejor que un medio», bajar el techo de `MATE_OFF` a ~+3 o tocar `DIFF.mate` (sim).
  El palmarés migrado conserva el nombre antiguo de la competición («Liga Regional») con el club renombrado (se puede defender como
  histórico). En el Circuito Regional con el bot medio se gana el 99-100 % sea cual sea el compañero (dato de equilibrio). El lienzo en
  blanco que vio una vez el revisor (`getUniforms` en un partido de Carrera) casa con el fallo del precompilado tras cambiar la calidad,
  arreglado en main.js (ver TRASPASO); no se ha vuelto a ver.
- **Equipación del rival en la playa** (players.js `setKit`): si el kit del club rival se parece al tuyo (p. ej. dos clubes de rojo),
  players viste a la CPU de azul; con 8 camisetas por liga pasa a menudo. Idea: que `setKit` acepte un color alternativo del club
  (segunda equipación) en vez de caer en la azul de siempre.
- **Nerf del compañero**: el lever por atributos es corto (ver medida). Si Ferran lo sigue viendo fuerte, `DIFF.mate` (sim) o un
  `statProf` con más pendiente por debajo de 50 en recv/dig/err para la IA (sim); la Carrera no toca sim.js ni ai.js.
- Marcador de playa, cámara del cambio de campo y regla de los 5 s del saque (TRASPASO, de otros dueños) afectan ahora a todos
  los partidos de Carrera.
- `tools/out/carrera-playa/`: `mate_balance.js` (medida del compañero), `shots.js` (capturas y comprobación del escenario forzado),
  logs `baseline_*.log`, `beach_offsets.log`, `after_final.log`, `after_v3b.log` (reparto plano) y `run2-*/run3-*.log` (pase final de
  pruebas del 10-nov, 22 h: simtest con huella idéntica, badgetest, careertest, console.sh ×3, perf ×3 «objetivos cumplidos» con la
  máquina a ~50 % de CPU —con el otro agente probando a la vez, a 75-80 %, perf del pabellón y del 6v6 bajaban de 55 fps—, drive,
  touchplay (falló una vez de forma intermitente: 2 toques de 3; repetido OK) y padplay).

## Integración (10-nov-2026): decisiones con efecto y pestañas comunes
- **Fatiga**: Equilibrado ya no cansa (`fat: 0`); los enfoques dan 60 por semana (antes 50) con +12 de fatiga; en verano
  (`newSeason`) la fatiga vuelve a 0 (mensaje «Vacaciones» si pasaba de 40); el preparador avisa **cada vez** que sube la resta.
- **Contrato**: fichar por otro club con contrato en vigor y sin ser transferible (`earlyExit(c)`) se puede, pero el entrenador nuevo
  empieza con `EARLY_COACH` (10) menos de confianza (mensaje del agente; aviso en la ficha). `contract.since` = temporada en la que
  empieza (antes la que acababa).
- **Negociar**: sale si `interés + 0..4 > ROLE_NEED` (antes +3..7: 93 %; ahora 57 % en 127 negociaciones de careertest); si no
  sale, `oferta.negNo` y al firmar el entrenador empieza con `NEG_COACH` (8) menos. La ficha enseña la confianza inicial.
- **Estilo del club** (`STYLE_TRAIN`): sus entrenos suman `STYLE_PROG` (6) por semana a un grupo (Ofensivo → Ataque; Defensivo y
  Saque y bloqueo → Defensa; Juego rápido → Físico; Equilibrado nada), salvo descansando.
- **Traspaso**: la petición caduca con la temporada.
- **UI** (career-ui.js): las dos barras son `VB.UI.tabs` (`#crTabs`, `#crSub`): Q/E y LB/RB (o Y) apartado u oferta; RePág/AvPág y
  LT/RT sub-pestaña; ←/→ con el foco en la pestaña; deslizar sobre `#crBody`; solo la pestaña elegida entra en ↑/↓ (↓ baja al
  contenido). Jugador: Físico · Defensa · Ataque (el orden de Jugadores). Pestañas de oferta con el nombre del club. «‹ Jugar» (antes
  «‹ Menú»). A ≤ 420 px de alto «‹ Jugar» y la media comparten fila con los apartados (contenido 264 px a 844×390 y 249 a 667×375;
  antes 224/209) y en la ficha de oferta «Firmar» sube debajo del nombre. Botones a 44 px en táctil.
- Elegir club: «Rechazar todas» pide una segunda pulsación en 3 s y dice la verdad (se pierden, también la prueba; llegan de clubes
  más modestos con algo más de interés); «Comparar» con objetivo, años y «€/mes»; el último mensaje del agente sale en la pantalla.
- Fin de temporada: las ofertas viven en Club › Ofertas; arriba un aviso «Ver ofertas» y «Seguir en…» pide confirmación si hay ofertas.
- Bandeja: se marca leída al abrirla (el contador ya no se queda); lo nuevo sigue resaltado ese pintado. Partido: «Pareja N» (fuerza
  de los dos) en vez de «Media N»; cabecera «TU MEDIA».
- Pendiente: escalón a la Liga Nacional (IA Normal; con la prueba superada a media 35 el bot medio gana 0 de 8), rol prometido sin
  efecto en minutos, sueldo solo texto, química de suplentes que se pierde cada verano, sin confirmación al firmar en mitad de
  temporada; mando y táctil reales sin probar.
