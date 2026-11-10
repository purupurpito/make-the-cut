# notes/carrera.md — Modo Carrera 2v2 (owner: ui_main)

Ficheros: `js/career.js` (VB.Career, datos y reglas, sin DOM; se carga en node), `js/career-ui.js` (VB.CareerUI, pantallas; crea su
DOM `#career` y su `<style id="careerCss">`), `js/main.js` (arranque de los partidos de Carrera), `index.html` (fila «02 Carrera»
del menú y los dos `<script>`), `tools/careertest.js` (prueba en node). Guardado: `localStorage['voley3d.career']` (una sola carrera).

Mezcla pedida por Ferran: el bucle del modo carrera tipo FIFA (club, temporada, jornadas, nota del partido, objetivos, entrenador,
ofertas, ascensos) + insignias que se desbloquean haciendo cosas (VB.Badges, ver js/badges.js). Todo inventado: clubes, ciudades,
ligas, copas y nombres de jugadores.

## Bucle

1. **Crear jugador**: nombre (18 car.), dorsal 1-99, rol y puntos por set (11/15/21/25; 15 por defecto) y control
   (Solo tu jugador = `ctrl:'one'`, por defecto; Los dos = `'both'`). Media inicial 35 con el perfil del rol:
   - Atacante: salto +6, potencia +7, control +3, bloqueo +4, saque +1 · recepción −7, defensa −4, colocación −10.
   - Universal: casi plano (velocidad y reacción +2, bloqueo −3).
   - Colocador-receptor: colocación +9, recepción +7, defensa +4, reacción +2 · salto −5, potencia −8, bloqueo −7, saque −4.
   El atleta es el de VB.Prog (`newAthlete`): `st, lvl, xp, pts, matches, bp, bd, beq` + `name, num, role, roleKey, age` (18 años).
2. **Club**: empiezas en uno de los 2-3 peores clubes de la Liga Regional. El club pone compañero con el rol complementario
   (atacante ↔ colocador-receptor; universal ↔ universal) y media = media del club + 3.
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

## Ligas

| nivel | liga | media de los clubes | IA rival (por club) | XP × | arbitraje (`createGame({ref})`) | copa |
|---|---|---|---|---|---|---|
| 0 | Liga Regional | 28-40 | Fácil (todos) | 1 | alto, sin challenge | Copa Regional |
| 1 | Liga Nacional | 38-50 | Normal | 1,5 | medio, sin challenge | Copa Nacional |
| 2 | Superliga | 48-61 | Normal (< 52) / Difícil | 2,1 | medio, sin challenge | Copa de la Superliga |
| 3 | Liga Continental | 58-71 | Difícil | 2,8 | jueces de línea, sin challenge | Copa Continental |
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
  ~+8 de media la 1.ª temporada y la élite (~65-70) hacia la 6.ª-8.ª. Simulando todo te estancas en la Continental (a propósito).

## Nota del partido (1-10, una decimal)

`bruta = 5,4 + (0,055·remates punto + 0,2·aces + 0,2·bloqueos + 0,045·asistencias + 0,035·defensas + 0,03·recepciones perfectas +
0,02·toques perfectos − 0,015·toques malos − 0,17·errores) × 40 / puntos jugados + resultado` (2-0: +0,9; 2-1: +0,6; 1-2: −0,3;
0-2: −0,6) y techo suave por encima de 8,5 (`8,5 + 1,5·(1 − e^(−(bruta − 8,5)/1,5))`). Con «Los dos» cuenta lo de la pareja (remates
×0,85). Antes (remate a 0,32) la nota era casi siempre 10 con control «uno» (15-18 remates punto por partido: medio 27 de 28 partidos
con 10, bueno 28 de 28). Ahora (Regional, temporada 1, 28 partidos por bot): novato 6,14 (4,6-7,9), medio 7,78 (5,7-9,1), bueno
9,10 (7,3-9,7), ningún 10. Errores = faltas personales tuyas y puntos del rival con `how:'error'` cuyo último toque fue tuyo. Asistencia =
`point.assist` (sim) o, sin él, tu colocación (2.º toque) antes del remate punto del compañero. Simulado: 6,1 + 0,04 × diferencia
de fuerza ± 0,6 por el resultado ± 0,8 de azar (3-9,5).

## Entrenador, objetivos y ofertas

- Confianza 0-100 (empieza en 50): `+ (nota − 6,2) × 2,5 ± 1` por partido; ±15 al cumplir o no el objetivo. Textos: Descontento
  (< 30), Tiene dudas, Confía en ti, Pieza clave (≥ 70), Intocable (≥ 85).
- Objetivo según la posición esperada del club por su media: 1-2.º «Subir de categoría» (en el Circuito: «Ganar el Circuito
  Mundial»), 3-4.º «Entre los 4 primeros», 5-6.º «Mitad de tabla», 7-8.º «Evitar el descenso» («No acabar último» en Regional).
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
