# notes/carrera.md — Modo Carrera 2v2 (owner: ui_main)

Ficheros: `js/career.js` (VB.Career, datos y reglas, sin DOM; se carga en node), `js/career-ui.js` (VB.CareerUI, pantallas; crea su
DOM `#career` y su `<style id="careerCss">`), `js/main.js` (arranque de los partidos de Carrera), `index.html` (fila «02 Carrera»
del menú y los dos `<script>`), `tools/careertest.js` (prueba en node). Guardado: `localStorage['voley3d.career']` (una sola carrera).

Mezcla pedida por Ferran: el bucle del modo carrera tipo FIFA (club, temporada, jornadas, nota del partido, objetivos, entrenador,
ofertas, ascensos) + insignias que se desbloquean haciendo cosas (VB.Badges, ver js/badges.js). Todo inventado: clubes, ciudades,
ligas, copas y nombres de jugadores.

## Bucle

1. **Crear jugador**: nombre (18 car.), dorsal 1-99, rol y puntos por set (11/15/21/25; 15 por defecto). Control: siempre solo
   tu jugador (v2; antes había «Los dos»). Media inicial 35 con el perfil del rol:
   - Atacante: salto +6, potencia +7, control +3, bloqueo +4, saque +1 · recepción −7, defensa −4, colocación −10.
   - Universal: casi plano (velocidad y reacción +2, bloqueo −3).
   - Colocador-receptor: colocación +9, recepción +7, defensa +4, reacción +2 · salto −5, potencia −8, bloqueo −7, saque −4.
   El atleta es el de VB.Prog (`newAthlete`): `st, lvl, xp, pts, matches, bp, bd, beq` + `name, num, role, roleKey, age` (18 años).
2. **Club**: lo eliges tú entre las ofertas de inicio (v2, ver §Gestión; antes te tocaba uno de los 2-3 peores de la Regional). El club pone compañero con el rol complementario
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
