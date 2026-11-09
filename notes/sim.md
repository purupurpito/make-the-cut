# notes/sim.md — simulación, reglas, IA (owner: sim)

Ficheros: `js/sim.js`, `js/ai.js`, `tools/simtest.js`. Las interfaces de CONTRACT.md §4 siguen intactas;
todo lo de abajo son AÑADIDOS (campos/funciones/eventos opcionales). Fecha: 2026-11-07 (revisión 3, cierre de pendientes; R4: ronda de verificación de reglas).

Verificación: `node tools/simtest.js` (20 min demo + fuzz + matriz 4 niveles × (IA + 4 bots) × 4 semillas × 20 min,
en paralelo, ~70 s con 16 núcleos) → `TODO OK`. Rápido sin matriz: `node tools/simtest.js 10 12345 0`.
Afinado: `SIMTEST_ONLY=matrix MATRIX_FILTER='novato vs easy|medio vs normal' node tools/simtest.js 5 777 20 12`
(solo esas casillas, 12 semillas: ~1 200 puntos por casilla, ±1,4 puntos de %).

## P1. Pulido, ola 1: presentación del punto (SIM-01, SIM-02, SIM-03; owner sim, 2026-11-07)
Todo AÑADIDO y determinista: no gasta azar ni cambia la simulación. Con `g.present` en false (demo, autopilot, simtest) la
salida de `node tools/simtest.js 10 12345 0` es idéntica línea a línea a la de antes (solo hay líneas nuevas).
**Para que el lead lo pase a CONTRACT §4.2/§4.3** (texto listo):

> `point` añade: `highlight` (0..1, lo grande que ha sido el punto), `digs` (int: defensas de remate del peloteo), `streak`
> (int ≥ 1: puntos seguidos del que puntúa en este set, este incluido), `savedSetPoint` (bool: el que puntúa tenía en contra
> punto de set o de partido), `signal` (señal del árbitro: `'in'|'out'|'touched'|'four'|'double'|'net'|'under'|'antenna'|
> 'attackFault'|'delay8'|'serveFault'`), `touchedOut` (bool, true ⇔ `signal === 'touched'`), `landSide` (campo donde botó el
> balón: 0 = x > 0, 1 = x < 0; -1 si el punto no es por bote), `hold` (s de pausa hasta el siguiente saque o `gameOver`;
> `g.timer` arranca con este valor). `setWon`/`matchWon` ya son correctos en el propio evento (antes se rellenaban justo
> después de emitirlo; para los que leen el array de eventos del frame no cambia nada). `g.lastPoint` copia `team, reason,
> text, how, highlight, digs, streak, savedSetPoint, signal, touchedOut, landSide, hold, setWon, matchWon`.
> Estado nuevo en `game`: `present` (bool), `hold` (s de la pausa en curso), `streakTeam/streakN`, `rally.digs`,
> `atkHuman/atkGrade`. Funciones nuevas: `VB.Sim.skipHold(g)`, `VB.Sim.highlightOf(o)`; constantes `VB.HOLD`.

### SIM-01 — `highlight` y contexto
**Fórmula sustituida en SIM-05 (ver §P3).** Fórmula original (`highlightOf`, redondeada a milésimas, recortada a 0..1):
| término | valor |
|---|---|
| base | 0,15 |
| peloteo largo | +0,03 por toque a partir del 5.º (`rallyHits − 4`), máx. 0,35 (el saque no cuenta como toque en `rallyHits`) |
| defensas de remate (`digs`) | +0,12 cada una, máx. 0,24 |
| `how 'block'` (bloqueo directo) | +0,25 |
| `how 'ace'` | +0,2 |
| remate `perfect` del humano que es punto (`how 'kill'`) | +0,2 |
| jugado con punto de set (de cualquiera) | +0,15 |
| jugado con punto de partido | **+0,30** más (se suma al de set) |
| `savedSetPoint` | +0,15 |
| `streak ≥ 3` | +0,1 |
| `how 'error'` sin cerrar set ni partido | tope 0,35 |

**Desviación deliberada del enunciado**: el punto de partido vale +0,30 (no +0,25). Con +0,25 el remate perfecto del humano en
punto de partido daba 0,15 + 0,2 + 0,15 + 0,25 = **0,75** y no cumplía la aceptación (≥ 0,8). Se ha cargado la diferencia al
punto de partido (el momento más raro y más grande) y no al remate perfecto, para no subir la frecuencia de los puntos
grandes en el juego normal: probado con +0,25 al remate perfecto, el bot «bueno» contra Normal pasaba del 26 % al 33 % de
puntos ≥ 0,55. Bloqueo directo con punto de partido: 0,85; salvando el del rival: 1,0.

Definiciones:
- **`digs`**: primer toque (`kind 'pass'`, toque 1) controlado de un remate rival: no cuenta el desviado (`shot 'shank'`) ni el
  rebote en el cuerpo (`'body'`); sí la plancha, el que llega frenado por el propio bloqueo (`block 'touch'`) y la cobertura de
  un bloqueo directo rival (`block 'stuff'`). La recepción del saque no cuenta. Se cuentan los de los dos equipos.
- **`streak`**: se reinicia en cada set (`newSet`/`newMatch`): un parcial de TV es dentro del set.
- **`savedSetPoint`**: `g.setPoint === 1 − team` (el punto de set/partido se calcula en `serveReady`).
- **remate perfecto del humano**: `how 'kill'` cuyo último ataque (`g.atkHow 'kill'`) fue del humano con nota `perfect`
  (también cuando el rival lo toca y lo desvía, el block-out, etc.).

Distribución medida (`tools/out/sim-p1/hlsweep.js`, `tools/out/sim-p1/hlhuman.js`):
| partido | puntos | media | p50 | p90 | ≥ 0,55 |
|---|---|---|---|---|---|
| demo CPU vs CPU, 36 semillas × 20 min | 3 970 | **0,289** (peor semilla 0,323) | 0,18 | 0,54 | 8,1 % |
| demo, 40 semillas × 10 min | 2 572 | 0,282 (peor 0,345) | 0,15 | 0,51 | 7,3 % |
| bot novato vs Fácil (4 × 20 min) | 406 | 0,33 | 0,31 | 0,61 | 13 % |
| bot medio vs Normal | 376 | 0,37 | 0,35 | 0,67 | 19 % |
| bot bueno vs Normal | 382 | 0,42 | 0,40 | 0,74 | 26 % |
| bot perfecto vs Experto | 295 | 0,56 | 0,53 | 0,94 | 47 % |

**Para SIM-05 (calibración, ola 3)**: en partidos humanos los puntos «grandes» (≥ 0,55 → pausa de 2,4 s) son frecuentes en
cuanto el jugador es bueno, porque remate perfecto (0,35) + una defensa (0,12) + dos toques de peloteo (0,06) ya llegan.
Propuesta a medir entonces: contar como `digs` solo las defensas de remate de ≥ 13 m/s o en plancha, y subir el umbral de
peloteo largo a partir del 7.º toque; objetivo ≤ 15 % de puntos grandes para un jugador bueno. No se ha tocado ahora para
no mover el contrato que las demás ramas están empezando a usar.

### SIM-02 — señal del árbitro
| `signal` | cuándo |
|---|---|
| `in` | `reason 'in'` (también el balón a la red que cae dentro de su propio campo) |
| `out` | `reason 'out'` y el último contacto NO fue del equipo que recibía |
| `touched` | `reason 'out'` y el último contacto fue del equipo que recibía el ataque/saque rival: su bloqueo (`lastKind 'block'`: block-out, toque de bloqueo que sale) o su primer toque (`lastKind 'pass'` con `touches 1`: recepción/defensa, también desviada, en plancha o de rebote en el cuerpo). `touchedOut = true` |
| `four`, `double`, `net`, `under`, `antenna` | el `reason` del mismo nombre |
| `attackFault` | `reason 'attackServe'` y `'block'` (bloqueo del saque) |
| `delay8` | `reason 'serve'` por la regla de 8 s (texto «Falta de saque: 8 segundos») |
| `serveFault` | `reason 'serve'` porque el lanzamiento cae sin golpearlo |

Un segundo/tercer toque propio que sale (colocación, remate) es `out`, no `touched`. `landSide` lo da `g.lastLand` del mismo
paso. Textos del árbitro sin cambios («Dobles: el mismo jugador toca dos veces», «Falta de saque: 8 segundos», «Ataque sobre
el saque», `POINT_TEXTS` igual).

### SIM-03 — pausa de presentación y `skipHold`
`point.hold` = `g.timer` al pitar (incluye el cambio de campo):
| caso | sin `g.present` (como siempre) | con `g.present` |
|---|---|---|
| punto normal | 1,9 | 1,9 |
| `highlight ≥ 0,55` (`VB.HOLD.bigAt`) | 1,9 | **2,4** |
| set ganado (incluye el cambio de campo) | 3,6 | **3,4** |
| partido ganado (modo `'over'` hasta `gameOver`) | 2,2 | **4,2** |
| 8 puntos del set decisivo | 1,9 + 1,4 | (1,9 o 2,4) + 1,4 |

Nota sobre el set: el enunciado pedía 3,4 s (creía que hoy era 1,9); hoy ya era 3,6 s con el cambio de campo. Se aplica 3,4
como pide la aceptación: la grúa del cambio de campo de camera.js (empieza a 1,45 s reales y dura 2,4) acaba a ~3,85 s reales,
y 3,4 s de juego con la cámara lenta del set (×0,5 los primeros 0,8 s reales) son ~3,9 s reales: cabe justa. Si CAM-09 quiere
más, es un número (`VB.HOLD.set`).
`g.present`: `createGame({present:true})` o `g.present = true` después de crearlo (main.js, partidos humanos). La demo del menú y
el autopilot no lo llevan.
`VB.Sim.skipHold(g)` → bool: en `'point'`/`'over'`, si han pasado ≥ 0,8 s de la pausa (`g.hold − g.timer`), recorta `g.timer`
a 0,3 s como mucho y devuelve true; si no, false. Nunca baja de 0,3 s, no hace nada en `'serve'`/`'rally'` ni con el partido
ya terminado (`g.finished`). El orden de eventos al acabar la pausa no cambia (`newSet`, `serveReady` o `gameOver`).

### simtest (nuevo)
- Cada punto de TODAS las partidas (demo, fuzz, matriz, partido con `present`) pasa `pointFieldIssues`: highlight en [0,1],
  `digs`/`streak` enteros ≥ 0 (racha contrastada con un recuento propio por set), `savedSetPoint` contra el `serveReady`,
  errores ≤ 0,35, `signal` de la lista cerrada y coherente con `reason`, `touched` ⇔ `touchedOut`, 8 s ⇔ `delay8` con el reloj a
  0, `landSide` = campo del bote, `hold` según la tabla y `g.timer === hold`, `g.lastPoint` copia el evento.
- Demo: highlight medio ≤ 0,35 (con ≥ 110 puntos; en pruebas cortas el tope se abre con √(110/n): 10 min ≈ 0,376) y puntos
  grandes entre el 1 y el 25 %. El suelo del 1 % solo se exige con ≥ 100 puntos de demo (guarda de tamaño de muestra añadida
  en la integración, no un aflojamiento silencioso): con ~8 % de puntos grandes, 0 de 61 sale ~1 de cada 160 semillas (semilla
  22 a 10 min dio 0/61). El techo del 25 % se exige siempre. Ver `tools/simtest.js` (comentario «suelo del 1 %»).
- Casos: 12 señales montadas (fuera / tocado / dentro / 8 s / no golpea / bloqueo del saque / debajo / antena) con `landSide`;
  remate perfecto del humano con punto de partido (0,8), bloqueo directo con punto de partido propio (0,85) y salvándolo (1,0);
  fórmula en 6 extremos; `digs` (remate y toque de bloqueo sí, saque y cuerpo no) y `streak` (corta la del rival); pausa con
  `present` (set 3,4: `skipHold` false a 0,5 s, true a 0,9 s y saque a los 0,3 s; normal 1,9; grande 2,4; partido 4,2 con
  `gameOver` a los 0,3 s del skip; 8 del 3.er set +1,4; sin `present` 3,6; sin efecto en saque/peloteo).
- Partido humano de 6 min con `present: true` (bot bueno vs Normal).

Herramientas de medida: `node tools/out/sim-p1/hlsweep.js [semillas] [min] [desde]` (demo) y
`HLARGS='bueno normal 4 20' node tools/out/sim-p1/hlhuman.js` (bots de simtest con `present`).

## P2. Pulido, ola 2: ritual del sacador CPU (SIM-04; owner sim, 2026-11-08)
Entre el silbato y el lanzamiento, el sacador de la CPU (también el equipo 0 en autopilot y los dos equipos de la demo) bota el balón
1-3 veces con un estilo PROPIO de cada jugador y lanza a una hora fija y anunciada. El humano no hace ritual: su saque no cambia.
**Para que el lead lo pase a CONTRACT §4.2/§4.3** (texto listo):

> Estado nuevo en `game`: `seed` (int, semilla del partido), `serveNo` (saques puestos), `cpuTossIn` (s de juego hasta el lanzamiento
> programado de la CPU, decrece de forma monótona desde el `serveReady` y vale 0 en el paso del `toss` y hasta que acaba el saque; -1 con
> sacador humano y fuera de `'serve'`; `g.timer` vale lo mismo en el saque de la CPU), `ritual` (objeto persistente, solo lectura:
> `{on, phase:'none'|'wait'|'pre'|'dribble'|'post'|'done', t (s desde el silbato), dur (s silbato → lanzamiento, 0,8-1,6), bounces (1-3),
> n (botes ya hechos), u (0..1 dentro del bote en curso), player, rx, ry (punto del bote, sim), cyc, td, tu (periodo, bajada, subida, s),
> v0, vu, vc, vi (empujón, subida, recogida, contra el suelo; m/s), pre, post, still, press (punto de set/partido)}`).
> `serveClock` corre también para la CPU tras el silbato (la CPU lanza siempre con ≥ 6,3 s; la UI y el audio solo lo muestran al humano).
> Durante el ritual `ball.held` sigue siendo el sacador; el balón NO está en la mano en `'dribble'` (bota delante de él) y `ball.vx/vy/vz`
> llevan la velocidad real del bote. `VB.Sim._holdPos(g, p, out)` es el punto de la MANO izquierda (con el balón en `'wait'/'pre'/'post'/'done'`;
> en los botes se aparta 0,30 m a la izquierda y vuelve a por el balón al final de cada bote). Constantes `VB.RITUAL`.
> Funciones: `VB.Sim.ritualAt(g, t, out?)` → posición del balón del ritual en el instante `t` (s desde el silbato) sin tocar nada, o null.
> `createGame({ritual:false})` = sin ritual (pruebas: el flujo anterior, byte a byte).
> Evento nuevo `dribble {player, team, x, y, n (1..of), of (botes de este ritual), speed (m/s contra el suelo), last (bool)}` en cada contacto
> del balón con el suelo (en ese paso `ball.z === BR`).

### Cómo es
- Fases: `'wait'` (balón en la mano antes del silbato, 0,7 s; demo 0,35) → `'pre'` (0,16-0,22 s: baja el balón de la mano, 1,28 m, a 1,0 m y
  llega ya empujándolo hacia abajo: curva de Hermite con la velocidad del bote al final, sin tirón) → `'dribble'` (n botes, cada uno: bajada
  empujada en caída libre, 17 ms en el suelo para que todo frame de 60 Hz pintado vea el contacto, subida con restitución 0,8 hasta la mano
  con velocidad pequeña) → `'post'` (0,22 s: lo sube a la mano con la velocidad de la recogida) → `'done'` (0,12-0,38 s quieto, mirando al
  campo) → `toss`. El balón es función pura del tiempo del ritual (`ritualBall`); el lanzamiento sale del mismo punto de la mano de siempre.
- Botes delante y algo a la izquierda del sacador (0,42 m hacia la red, 0,12 m a la izquierda), donde la mano izquierda ya tenía el balón.
- Estilo por jugador (hash de `seed` + `player.id`, sin gastar `g.rng`): botes base (30 % uno, 45 % dos, 25 % tres), tempo (periodo del bote
  0,50-0,60 s con 1 bote, 0,40-0,46 con 2, 0,33-0,37 con 3), bajada y pausa final propias. Por saque (hash de `seed`, jugador y `serveNo`):
  11 % uno menos, 11 % uno más, ±6 % de tempo. **Con punto de set o de partido (de cualquiera) bota uno más y se queda 0,12 s más
  concentrado** (hasta 3 botes y 1,6 s). Se ve: en una partida cada jugador repite su número de botes el 83-100 % de las veces.
- Duración (silbato → lanzamiento) 0,8-1,6 s; lanzamiento entre 1,5 y 2,3 s desde `serveReady` en partido (antes, 1,3 s fijos; demo
  1,2-1,5 s, antes 0,9); nunca después de
  `RITUAL.tossBy` (4,5 s). **Demo del menú**: como mucho 2 botes y ~1,1 s (comprime los tiempos muertos como ya hacía con el silbato):
  5,4 puntos/min de mediana (antes 5,7; con el ritual completo bajaba a 5,25 y la peor semilla a 10 min se acercaba al mínimo del simtest, 4,5).

### Semillas (desplazamiento documentado)
El ritual no gasta el azar del partido (simtest lo prueba: con y sin ritual el generador está en el mismo punto tras el primer
lanzamiento), pero NO se pueden conservar los resultados de cada semilla: el lanzamiento de la CPU llega más tarde, la altura de salida del
balón lleva el vaivén de la mano (`sin(g.time·3,1)`) y las diferencias de coma flotante del tiempo cambian el peloteo desde el primer saque
de la CPU. Con `createGame({ritual:false})` la salida de `node tools/simtest.js 10 12345 0` es idéntica línea a línea a la de antes (solo
aparece el contador `"dribble":0`). La matriz de equilibrio queda dentro del ruido de muestreo (4 semillas, ±2,5 puntos de %): novato vs
Fácil 49,4 % (antes 48,5), vs Normal 35,2 % (33,9); medio vs Normal 50,0 % (53,0), vs Fácil 77,3 % (73,5).

### Verificación
- `node tools/simtest.js` completo, semillas 12345, 1 y 2 → TODO OK (≈ 38 s). Rápido (`10 <seed> 0`) con 12345, 1, 2, 3, 22, 777 → TODO OK.
- **Aviso para SIM-05 (no lo causa SIM-04)**: `node tools/simtest.js 20 3` (completo, semilla 3) falla en la matriz «novato vs Fácil» = 51,6 %
  (banda 0,40-0,51). Con la copia SIN ritual (`tools/out/sim-w2/simtest_noritual.js 20 3`) la misma casilla da 53,2 %: también falla. Es el ruido
  de 4 semillas × 20 min (±2,5 puntos) contra una banda cuyo techo está a ~1σ de la media (48-49 %). Medido con/sin ritual en las semillas 3, 1, 2,
  12345: 51,6/46,5/44,8/49,4 % frente a 53,2/43,2/45,9/48,5 %. No se ha tocado la banda (sería aflojar una prueba sin calibrar): para SIM-05.
- simtest, en CADA saque de todas las partidas (demo, fuzz, `present`, matriz de 4 niveles × IA y 4 bots): `cpuTossIn` monótono y 0 en el
  toss, lanzamiento a `whistleAt + dur` (± 1,5 pasos) y ≤ 4,5 s, **reloj de 8 s ≥ 3 s al lanzar** (mínimo medido 6,38 s), tantos `dribble`
  como botes y cada uno con el balón en el suelo, el balón baja al suelo y vuelve a ≥ 0,95 m, `ball.held` = sacador, duración 0,8-1,6 y 1-3
  botes; humano sin ritual (`cpuTossIn -1`, sin `dribble`); fuera del saque `cpuTossIn -1`. Casos: sin gastar `g.rng`, determinista y con
  estilo por jugador, punto de set, balón puro/continuo (paso máx. < 0,08 m a 120 Hz; mano = balón fuera de los botes), humano, demo corta.
- Película en el navegador (`debug=rally&live=1`, eval por frame): balón 1,27 → 0,21 (suelo) → 0,98 → 0,21 → 0,98 → 1,27 con 2 botes,
  `cpuTossIn` monótono. **Desviación de la aceptación**: pedía z «por debajo de 0,15»; `ball.z` es el CENTRO y el balón tiene radio
  `C.BR = 0,21` (exagerado por legibilidad), así que en el suelo `z = 0,21` exacto (el balón toca el parqué; por debajo atravesaría el suelo).
- Capturas: `tools/out/sim-w2/front0/*.png` (de frente, congelado en cada fase), `zoom1/*.png` (sacador CPU visto desde nuestra recepción,
  cámara lenta), `cast1/*.jpg` (screencast a ritmo real). Cámara durante el saque rival: cabeceo ±0,003°, FOV fijo (igual que sin ritual).
- `node tools/drive.js` TODO OK (saque humano igual), `bash tools/console.sh all` sin errores.
- Herramientas: `tools/out/sim-w2/probe.js [seed] [min] [demo|auto]`, `film.expr` (eval), `cast.js`, `zoom.js`, `side.js`, `ppm.js`, `camserve.js`.

### Para los demás (detalle en sus notes)
- players (PLY-16): la palma izquierda ya sigue `_holdPos` (mano) y el balón bota solo; falta la mano que empuja por ARRIBA y las rodillas.
- audio: `dribble` ya suena (AUD-05). camera_input: `g.cpuTossIn` ya existe (1,5-2,3 s tras `serveReady`; antes 1,3).

## P3. Pulido, ola 3: calibración del highlight y simtest (SIM-05; owner sim, 2026-11-08)
**Sustituye la fórmula de §P1/SIM-01** (la tabla de allí queda como historia). Todo sigue siendo puro y determinista; solo cambia el
NÚMERO `highlight` (y con él la pausa de 2,4 s de `g.present`). **Para que el lead lo pase a CONTRACT §4.2/§4.3** (texto listo):

> `point` añade `clutch` (bool: final apretado — con el marcador de ANTES del punto, el que va delante está en los últimos 8 puntos del
> set, ≥ 17 de 25 o ≥ 7 de 15, y la diferencia es de 2 o menos). `g.lastPoint` también lo copia. `highlight` usa los pesos de
> `VB.HL` (solo lectura). Función nueva: `VB.Sim.clutchOf(s0, s1, target)`. Umbrales que pueden usar los demás: `VB.HOLD.bigAt`
> (0,55, «punto grande»: cinta grande, pausa larga) y 0,8 («enorme»: casi solo en punto de set/partido).

### Fórmula (`highlightOf`, `VB.HL`)
| término | antes (SIM-01) | ahora |
|---|---|---|
| base | 0,15 | 0,15 |
| peloteo largo | +0,03/toque desde el 5.º, máx. 0,35 | +0,025/toque desde el 5.º, máx. 0,35 |
| defensas de remate | +0,12 c/u, máx. 0,24 | +0,08 c/u, máx. 0,3 |
| **tope conjunto de la jugada** (peloteo + defensas) | — (0,59) | **0,4**: con la base, una jugada épica sola llega a 0,55 justo |
| bloqueo directo | +0,25 | **+0,4** (un punto de bloqueo siempre es grande: 0,55) |
| ace | +0,2 | +0,25 |
| remate perfecto del humano | +0,2 | **+0,1** |
| punto de set | +0,15 | +0,15, o **final apretado +0,28**, el mayor de los dos (no se suman: el 24-23 nunca vale menos que el 23-22) |
| punto de partido | +0,30 | **+0,45** |
| salvar punto de set/partido | +0,15 | +0,15 |
| racha ≥ 3 | +0,1 | +0,1 |
| error que no cierra set/partido | tope 0,35 | tope 0,35 |

Momentos de la aceptación de SIM-01 (siguen ≥ 0,8): remate perfecto del humano con punto de partido 0,85 (0,95 si además el marcador
está apretado); bloqueo directo con punto de partido 1,0 (propio y salvándolo).

### Por qué así (medido)
Antes, en CPU vs CPU solo el **8,9 %** de los puntos llegaban a 0,55 (demo, 160 partidos) y la cinta grande dependía sobre todo del
remate perfecto del HUMANO (+0,2: el 35 % de los puntos del bot «bueno» lo tenían), así que la UI tuvo que inventar reglas propias
(jugada ≥ 10 toques, racha 3/5…). Los términos nuevos premian lo que hace grande un punto en cualquier partido: el **marcador apretado
al final del set** (además, un partido igualado tiene más momentos grandes que una paliza), el **bloqueo directo** y la **jugada épica**;
el tope conjunto evita que los peloteos largos con defensas disparen puntos de 0,8 a mitad de set (antes eran la mayoría de los ≥ 0,8
fuera de punto de set). Herramientas: `tools/out/sim-w3/rec.js` graba rasgos por punto (`node rec.js demo|auto:<nivel>|bot:<bot>:<nivel>
<partidos> <desde>`), `grid*.js` barren pesos sobre los rasgos sin volver a simular, `an2.js` resume.

Partidos COMPLETOS; highlight ≥ 0,55 / ≥ 0,8 fuera de punto de set o partido:
| partidos | puntos | antes | **ahora** |
|---|---|---|---|
| demo CPU vs CPU, 160 partidos | 16 943 | 8,9 % / 0,6 % | **19,6 % / 3,2 %** (grupos de 20 partidos: 17,6-20,9 %) |
| autopilot (IA compañero) vs Normal, 40 | 3 400 | 16,0 % / 2,5 % | **20,2 % / 2,6 %** |
| autopilot vs Difícil, 20 | 2 065 | 17,4 % / 2,4 % | 25,2 % / 4,4 % |
| autopilot vs Fácil, 20 | 1 284 | 9,4 % / 0,6 % | 12,0 % / 0,9 % |
| bot novato vs Fácil, 12 | 1 219 | 10,9 % / 1,6 % | 19,9 % / 2,9 % |
| bot medio vs Normal, 12 | 1 270 | 18,3 % / 4,1 % | 25,0 % / 5,4 % |
| bot bueno vs Normal, 12 | 878 | **27,7 % / 8,2 %** | **23,2 % / 2,3 %** |
| bot perfecto vs Experto, 8 | 710 | 42,4 % / 20,7 % | 44,5 % / 11,0 % |

Lectura: CPU vs CPU entra en la banda pedida (15-25 %, < 5 % de ≥ 0,8); para el jugador bueno la pausa larga sale MENOS que antes
(27,7 → 23,2 %) y los «enormes» fuera de punto de set bajan de 8,2 a 2,3 %. Histograma de la demo (160 partidos): 0,1-0,2 43 % ·
0,2-0,3 11 % · 0,3-0,4 11 % · 0,4-0,5 14 % · 0,5-0,6 9 % · 0,6-0,7 6 % · 0,7-0,8 2 % · 0,8-0,9 2 % · 0,9-1 3 %. Puntos grandes por
cómo (demo): bloqueo ~49 %, remate ~46 % (casi todos con final apretado, racha o jugada larga), ace ~5 %.

### simtest
- **Calibración** (sección nueva, siempre salvo `SIMTEST_ONLY=matrix`, también en el modo rápido): 20 partidos COMPLETOS de demo
  (semillas `SEED + 7919·k`) en paralelo (~4 s). Imprime el histograma por décimas, % ≥ 0,55 (banda **15-25 %**), % ≥ 0,8 fuera de
  punto de set/partido (**< 5 %**), rango por partido, grandes por cómo, % de finales apretados, señales, `landSide`, pausas y ritual.
  Falso fallo estimado: 0 de 20 000 remuestreos de los 160 partidos medidos (media 19,6 %, σ 1,1; ≥ 0,8: 3,1 %, σ 0,4).
- **Cobertura en partido real** (esos 20 partidos): cada punto pasa `pointFieldIssues` con el ritual vigilado por `ritualChecker`;
  además tienen que aparecer las señales `in`/`out`/`touched` y `landSide` 0, 1 y -1; solo pausas de la tabla de la demo (1,65, +1,4 del
  cambio a los 8, 3,6 de set, 2,2 de partido, y al menos un set y un partido); todos los saques de la CPU y exactamente un `dribble` por
  bote programado.
- **`pointFieldIssues` recompone el highlight**: con lo que el test sabe por su cuenta (cómo, toques, defensas, racha contada, punto de
  set/partido del `serveReady`, final apretado calculado del marcador, salvado, set/partido ganado; el remate perfecto del humano lo lee
  de `g`) llama a `S.highlightOf` y exige el MISMO número en cada punto de todas las partidas (demo, fuzz, `present`, matriz,
  calibración). Comprueba también `clutch` y que `g.lastPoint` lo copia.
- **Determinismo**: el primer partido de la calibración se repite dos veces en el hilo principal y su traza (marcador, cómo, highlight,
  señal, `landSide`, pausa, `clutch`, defensas, racha y cada `dribble` con su velocidad) es idéntica carácter a carácter a la del worker;
  otra semilla da otra traza. Un partido humano de 4 min con `present: true` (bot bueno) repetido da la misma secuencia de highlight y
  el mismo `g.time` final (la pausa depende del highlight).
- Fórmula fijada en 14 casos (antes 6): bloqueo solo 0,55, final apretado 0,43 (con punto de set también 0,43: no se suman), punto de
  set solo 0,3, remate perfecto 0,25 y con punto de partido 0,85, jugada épica 0,55, error con todo 0,35, etc.
- La comprobación de la demo de `MIN` minutos pasa a ser de cordura (media ≤ 0,337 + 4σ; grandes entre 1 % y 19,6 % + 4σ; abiertas
  con √(110/n)): un solo partido no puede llevar la banda 15-25 % (σ por partido 4,8 puntos; rango medido 5,8-35,3 %).

### Verificación
`node tools/simtest.js` completo con las semillas 1, 7, 99 y 12345 → **TODO OK** (calibración 19,3 / 21,0 / 19,6 / 20,2 %; ≥ 0,8 sin
punto de set 2,8 / 3,1 / 3,8 / 3,3 %; determinismo OK; matriz sin cambios: el highlight no toca el juego sin `present`).
`node tools/simtest.js 10 12345 0` → TODO OK. `bash tools/console.sh all` → sin errores JS. `node tools/drive.js` → TODO OK. En la
página real (demo del menú) `VB.ctx.game.lastPoint` lleva `clutch` y el highlight nuevo (ace con racha de 4: 0,5). Salidas:
`tools/out/sim-w3/full_*.txt`, `fast_12345.txt`, `console_all.txt`, `drive.txt`.

### Para los demás (detalle en sus notes)
- ui_main (UI-03): `tierOf` puede quedarse en `highlight >= VB.HOLD.bigAt` (+ ace y punto de set salvado); las reglas propias
  (jugada ≥ 10 toques, racha 3/5) ya están dentro del número. `e.clutch` sirve para un subtítulo «Final apretado».
- audio (AUD-07): `hlOf` de reserva copia la fórmula vieja; solo se usa sin `e.highlight` (ya nunca). Opcional: `e.clutch` para tensión.

## R6. Demo CPU vs CPU dependiente de la semilla (fixer sim, 2026-11-07)
**Síntoma**: `node tools/simtest.js 20 99 0` → «ningún partido completo ni dos sets» y «remates punto 37 %»; `10 99 0` / `10 4242 0`
→ «muy pocos puntos» (44). Demo con 93 puntos en 20 min, mediana de rally 8,06 s (antes ~5 s).

**Causa raíz** (medida con las copias `tools/out/sim.before*.js` + `ai.before*.js`, 20-45 semillas × 20 min, `tools/out/demofix/sweep.js`):

| versión | puntos/min | rally mediana (rango por semilla) | remates punto | planchas/punto | semillas con mediana > 6,5 s |
|---|---|---|---|---|---|
| antes de la revisión 1 | 6,9 | 5,0 (4,9-5,1) | 66 % | 0,05 | 0/25 |
| revisión 1 (antes de la 2) | 5,4 | 5,0 (4,9-7,2) | 48 % | 0,31 | 1/25 |
| actual, demo = Difícil de la rev. 2 congelado | 4,7 | 5,8 (5,0-8,7) | 43 % | 0,55 | 18/45 |
| **R6** (perfil demo propio) | **5,7** | **5,0 (4,9-5,5)** | **52 %** | 0,33 | 0/105 |

La demo usaba `VB.DIFF.demo` = el Normal/Difícil de la revisión 1 (`dig` 0,51, `block` 0,42, `tip` 0,12), afinado con el modelo de
defensa de entonces. La revisión 2 cambió mecánicas compartidas que alargan la defensa CPU vs CPU: bloqueo geométrico (siempre hay
contacto; los resultados `touch` —defendible con P = 0,08 + dig— y `soft` devuelven el balón jugable), contacto con el cuerpo, y
las planchas salvan buena parte de los remates «defendibles» (en la demo, 239 de 342 defensas eran planchas). La revisión 3
«congeló» ese perfil pensando que así la demo no cambiaba, pero ya había cambiado en la revisión 2: con 43 % de remates punto solo
~50 % de los peloteos acababa en el primer ataque. La duración del peloteo es bimodal (un ataque ≈ 4-5,5 s; dos ≈ 7-9 s; casi
nada a 6 s), así que con esa fracción en el 50 % la mediana saltaba de un modo al otro según la semilla (5,1 frente a 8,7 s) y los
puntos por partido quedaban justo en el límite de «dos sets en 20 min».

**Arreglo (solo la demo; Fácil/Normal/Difícil/Experto y `mate` intactos)**: `VB.DIFF.demo` = `dig` 0,51 → **0,37**, `spike` 16,6 →
**17,4**, `block` 0,42 → **0,58** (más bloqueo directo), `atkErr` 0,08 → **0,15**, `tip` 0,12 → **0,04** (la dejada CPU vs CPU se
defiende siempre y alargaba el peloteo sin dar puntos). El error de ataque y el bloqueo directo acortan el peloteo SIN subir el % de
remates punto (lo que permite volver al ritmo sin pasarse de 60 %). Ahora ~65 % de los peloteos acaba en el primer ataque.
Medido con 105 semillas: 20 min → mediana por semilla 4,9-5,5 s, remates punto 41-61 %, mínimo 104 puntos, siempre ≥ 2 sets o
partido; 10 min → mínimo 50 puntos, remates punto 38-65 %. Aces ~6 %, planchas 0,33 por punto, bloqueos ~36 por 20 min.

**simtest**:
1. Banda de «remates que son punto» consciente del tamaño de muestra: 0,38-0,65 con ≥ 165 remates (20 min: igual que antes, ±3,5σ
   alrededor de 0,515); con menos remates se ensancha como √(165/n) (10 min, ~80 remates: 0,32-0,71). Justificación: con el mismo
   perfil, la dispersión por semilla es σ 3,9 puntos a 20 min y 5,5 a 10 min (105 semillas); la banda fija daba falsos fallos a 10 min.
2. «El control salta del bloqueador al defensor durante el ataque de la CPU» solo cuenta cambios AUTOMÁTICOS (`e.auto`). Fallaba
   con la semilla 3 (también antes de R6) porque el fuzz pulsó CAMBIAR él mismo tras el remate: eso es decisión del jugador.

Verificación R6: `for s in 1..20 99 777 4242 12345 2026: node tools/simtest.js 20 $s 0` y `... 10 $s 0` → 50/50 TODO OK
(`tools/out/demofix/sweep-final2.txt`); `node tools/simtest.js` completo → TODO OK, matriz idéntica a R5 (novato:Fácil 46,8 %,
medio:Normal 53,0 %, …; no se ha tocado nada compartido); `tools/shot.sh menu` (demo viva, `tools/out/demofix/menu-9s.png`) y
`tools/console.sh all` → sin errores JS. Barrido rápido de la demo: `node tools/out/demofix/sweep.js 20 1 20 x` (semillas 1-20 + las
cinco de siempre; `DEMO='{"dig":0.4}'` para probar un perfil sin tocar sim.js).

## R5. Ronda 2 de verificación (fixer sim, 2026-11-07)
1. **Novato en Fácil por encima del objetivo** (51-53 % de puntos). `rookieProf(pr, on, diff)`: en **Fácil** el primer partido solo
   cambia el saque de la CPU (suave como antes) y además `srvErr` ×0,65 (los saques a la red regalados no enseñan nada); los extras de
   peloteo (`spike` ×0,9, `atkErr` ×1,4, `aimNoise` ×1,25, `dig` ×0,8, `block` ×0,5) quedan **solo en Normal**. Probado antes
   `atkErr` ×1,2 + `block` ×0,7 (lo sugerido): 50,5/51,4/50,5 % (semillas 999/12345/4242 × 12) — no bastaba; con además `srvErr` ×0,65
   y `dig` ×0,92: ~49,9 %. Medido con el bot nuevo (punto 4), `SIMTEST_ONLY=matrix MATRIX_FILTER='bot novato vs (easy|normal)$|bot medio vs normal'
   node tools/simtest.js 0 <semilla> 20 <n>`:

   | semilla × semillas | novato:Fácil | P(partido) | novato:Normal | medio:Normal |
   |---|---|---|---|---|
   | 999 × 12 | **47,5 %** (1 218 pts) | 31 % | 33,6 % | 51,6 % |
   | 777 × 12 | **48,2 %** | 36 % | 36,2 % | 50,0 % |
   | 12345 × 24 | **47,9 %** (2 428 pts) | 34 % | 35,1 % | 50,5 % |
   | 999 × 24 / 4242 × 24 (fase de ajuste) | 47,3 % / 48,0 % | 30-34 % | | |
   | 12345 × 4 (la de `node tools/simtest.js`) | 46,8 % | 26 % | 33,9 % | 53,0 % |
   | 4242 × 4 (ruido de 4 semillas: ±2,5) | 50,1 % | 51 % | 33,3 % | 51,6 % |

   `SIMTEST_ROOKIE=off` (Fácil sin ayuda de primer partido, 999 × 24): 46,6 %. Banda de simtest `novato:easy` endurecida a **0,40-0,51**
   (antes 0,38-0,55, que admitía valores fuera del objetivo). medio:Normal y novato:Normal no cambian (Normal no se ha tocado).
2. **Ace/kill que roza la cinta**: `point()` ya no exige `!g.netSince` para `how` ace/kill/tip/free/block. Un saque o remate que toca la red
   y cae dentro sin que nadie lo toque es ace/kill legal (antes: `how:'error'` → la UI decía «Falta de saque de la CPU»). El caso «a la red»
   que cae en su propio campo sigue siendo error porque allí `lastTeam !== w`. Prueba nueva en simtest (saque → ace, remate → kill, remate
   que cae en su campo → error para el rival); con el código viejo falla.
3. **`aimPoint` y `hit()` con el mismo criterio de remate**: nuevo `isAttackContact(p, b)` (`p.z > 0,25 && |b.x| < 3,8 && b.z > NET_H + 0,1`)
   compartido. Consecuencia visible (fx): en la subida del salto el aro marca 'free' hasta que el jugador pasa de 0,25 m (antes 0,12) y con el
   balón a menos de 10 cm sobre la cinta o a más de 3,8 m de la red ya no promete 'spike' (que luego salía 'free'). Prueba nueva en simtest
   (5 casos; con el criterio viejo fallan 3: p.z 0,18 / b.z NET_H+0,05 / b.x 4,0).
4. **Bot novato con fallos de tercera persona** (solo el novato; medio/bueno/perfecto igual para que la matriz siga comparable):
   `camYaw` 22° (σ): tras cada cambio de jugador el stick va girado ese ángulo y se corrige en 0,5 s (la cámara se desliza y el pulgar
   sigue con la referencia vieja); `netJump` 0,1: por ataque rival, va a la red a «bloquear» aunque el juego le pida defender, con el
   doble de error de timing; `misSwitch` 0,01 por trayectoria: pulsa CAMBIAR sin querer (en la colocación rival cambia el rol; si queda
   en bloqueo, bloquea). Ahora el novato comete «Toque de red» (9 en 1 200 puntos vs Fácil, 15 vs Normal). «Bloqueo del saque» sigue sin
   salir: los receptores empiezan a 6,5 m de la red y un novato no sube a la red a bloquear el saque. Efecto neto en Fácil ≈ −1,5 a −2
   puntos de % (ruido de ±1,4 con 12 semillas).
5. **Textos del árbitro (pendiente de que decida Ferran; no cambiado)**. Propuesta, que hay que aplicar a la vez en sim.js (texto del
   `fault`), simtest `POINT_TEXTS`, arena.js `REASON` y el tutorial de ui.js:
   - `'Ataque del saque'` → `'Ataque sobre el saque'` (regla 13.3.4: «golpe de ataque sobre el saque del adversario»); arena `'ATAQUE SOBRE EL SAQUE'`.
   - `'Falta de saque: 8 segundos'` → `'Retraso en el saque (8 s)'` (señal oficial «Retraso en la ejecución del saque»); arena `'RETRASO EN EL SAQUE'`.
   - `'Dobles: el mismo jugador toca dos veces'` → `'Doble contacto: el mismo jugador toca dos veces'` (señal oficial; «dobles» es uso
     hablado aceptado); arena `'DOBLE CONTACTO'`, ui.js tutorial `<b>Doble contacto</b>`.
   sim.js: líneas `fault(g, ..., 'attackServe', 'Ataque del saque', ...)` (2 sitios), `fault(g, sv.team, 'serve', 'Falta de saque: 8 segundos', sv)`,
   `fault(g, t, 'double', 'Dobles: el mismo jugador toca dos veces', p)`. El `reason` no cambia (la UI que va por `reason` no se entera).

Verificación R5: `node tools/simtest.js` completo → TODO OK (novato:Fácil 46,8 %, medio:Normal 53,0 %); `node tools/simtest.js 20 999 20 4`
→ TODO OK; `node tools/simtest.js 10 12345 0` → TODO OK.

## R4. Cambios de la ronda de verificación de reglas (2026-11-07)
1. **Balón a la red que cae FUERA en el propio campo**: antes "Saque fuera"/"Remate fuera"/"Colocación fuera"; ahora
   `point {reason:'out', text:'Saque a la red'|'Balón a la red'}` (nunca cruzó la red; el mismo texto que ya tenía el que
   cae dentro del propio campo con `reason:'in'`). simtest admite esos dos textos también en `out` y lo comprueba.
   **Petición a arena** (videomarcador, `pointSub` en js/arena.js ~l.1894): hoy muestra "FUERA" para este caso; para que
   diga "BALÓN/SAQUE A LA RED" como con `reason:'in'`:
   ```js
   function pointSub(e) {
     var net = /a la red/i.test(e.text || '');
     if (e.reason === 'in' || (e.reason === 'out' && net)) {
       if (HOW[e.how]) return HOW[e.how];
       if (e.how === 'error' && net) return e.lastKind === 'serve' ? 'SAQUE A LA RED' : 'BALÓN A LA RED';
     }
     return REASON[e.reason] || '';
   }
   ```
   (ui.js ya usa `e.text` para `reason:'out'`: el cartel dice bien "Balón a la red"; nada que cambiar.)
2. **Ataque del saque (13.3.4) solo si se COMPLETA**: el contacto por encima de la red en zona de ataque sobre el saque
   rival ya no se pita en el toque. Se anota (`g.atkServe = {team, player}`, se borra en cada toque y en `serveReady`) y es
   falta cuando el balón cruza entero el plano de la red (también si pasa por la cinta) o lo toca el bloqueo rival. Una
   recepción alta dirigida al propio campo sigue en juego. Consecuencia para la UI: llega primero el `hit` del humano y el
   `point {reason:'attackServe'}` unos instantes después (al cruzar), no en el mismo paso.
3. **Balón por fuera de la antena hacia la zona libre rival (10.1.2): simplificación deliberada.** La regla permite
   recuperarlo desde la zona libre contraria por el espacio externo del mismo lado; en el juego los jugadores no pueden
   pasar al lado rival (están limitados a su campo), así que ese balón no se puede recuperar nunca y se pita al cruzar el
   plano ("Balón por fuera de la antena"): el resultado es el mismo que con el árbitro esperando, solo que antes.
4. **Primer partido (`rookie`) con efecto real**: `rookieProf` (Fácil/Normal, solo el primer partido según main.js) además
   del saque suave hace que la CPU remate un 10 % más lento, con `atkErr` ×1,4, `aimNoise` ×1,25, `dig` ×0,8 y `block` ×0,5.
   Medido con el bot novato, 12 semillas × 20 min (~1 200 puntos por casilla, ±1,4 puntos de %), `SIMTEST_ROOKIE=all`
   frente a `off`: **Fácil 48,4 % → 50,8 %** (antes de este cambio 47,0 %: sin efecto), **Normal 30,1 % → 38,2 %**
   (antes 32,3 %). Para medirlo: `SIMTEST_ROOKIE=all SIMTEST_ONLY=matrix MATRIX_FILTER='novato vs (easy|normal)' node tools/simtest.js 5 777 20 12`.
5. **simtest**: la matriz aplica `rookie` solo al primer partido de cada casilla (como el juego; antes en todos);
   `SIMTEST_ROOKIE=all|off` para medir. Los bots que bloquean se colocan con error de lectura (`ev·posErr·0,4` en y).
   Pruebas nuevas: ataque del saque pitado al cruzar (no en el contacto), recepción alta del saque hacia el propio campo sin
   falta, balón a la red que cae fuera en su campo (saque/remate/colocación).

## R3. Cambios de la revisión 3 (resumen para integrar)
1. **`VB.Sim.aimPoint(g, out?, move?)`** (nuevo, puro): destino previsto del golpe del HUMANO con la dirección actual,
   mismas fórmulas que `doServe`/`hit` sin el error aleatorio. fx.js ya lo usa automáticamente (su `aimTarget` llama a
   `Sim.aimPoint` si existe): retícula y arco comprobados en la página real (captura `tools/out/simv3/aim_toss.png`). Detalle en §4.
2. **Antena tocada sin cruzar la red** (regla 8.4.3): el balón que da en la antena y vuelve a su campo ya es falta
   (`point reason:'antenna'`, "Balón toca la antena"). Falta del último equipo que tocó: tras un bloqueo, del bloqueador
   (block-out contra la antena = punto del atacante). Antena = varilla en x = 0, y = ±4,505, de la parte baja de la red a 3,23 m.
3. **Cruce por encima de la antena con parte del balón fuera** del espacio de paso (8.4.4, prolongación imaginaria de las
   antenas): falta "Balón por fuera de la antena" aunque el centro vaya por dentro.
4. **`point.antenna`** (nuevo campo, solo con `reason:'antenna'`): `[x, y, z]` donde el balón tocó la antena, o `null` si
   cruzó por fuera (sin contacto). Estado `g.antennaHit` (`{x,y,z}` o null; se borra en `serveReady`).
5. **Textos del árbitro (vocabulario FCVB)**: `point.text` de `reason:'out'` según el último toque, sin "de la CPU":
   "Saque fuera", "Remate fuera", "Dejada fuera", "Recepción fuera" (tras saque), "Defensa fuera" (tras ataque),
   "Colocación fuera", "Toca el bloqueo y sale fuera", "Le da en el cuerpo y sale fuera", "Balón fuera".
   Además "Pasa por debajo de la red" pasa a **"Balón por debajo de la red"** y "Pasa por fuera de la antena" a **"Balón por
   fuera de la antena"**. simtest tiene la lista cerrada de textos válidos por `reason` (`POINT_TEXTS`) y falla con
   cualquier texto nuevo que no esté en ella (comprobado con un texto falso: lo detecta).
6. **Equilibrio con bots humanos realistas** (ver §1 Dificultad): nuevos perfiles Fácil/Normal/Difícil (Experto sin
   cambios); la demo del menú queda congelada en `VB.DIFF.demo` (= el Difícil anterior; desde R6, perfil propio: ver §R6).
7. Estado nuevo `g.aimIn`/`g.aimOn` (dirección de apuntado de la entrada del último paso; lo usa `aimPoint`).

## 0. Cambios de la revisión 2 (resumen para integrar)
1. **Bloqueo geométrico**: si el balón entra en el volumen de las manos SIEMPRE hay contacto; el azar solo decide el
   resultado (`stuff`/`soft`/`tool`/**`touch`** nuevo). Un bloqueo mal medido tiene las manos más bajas y estrechas:
   el balón pasa por encima o por el lado, nunca a través. simtest: "ningún remate atraviesa las manos sin `block`".
2. **Rol defensivo antes del ataque**: al colocar la CPU (~1,5 s antes del remate, mediana medida) el control pasa al
   defensor (`switch {auto:true, reason:'defense'}`) y el compañero IA bloquea. CAMBIAR durante esa colocación =
   bloquear tú (`g.defRole = 'block'`). Nunca hay cambio automático con balón > 12 m/s a < 0,6 s del contacto.
3. `g.pr1/g.pr3` se recalculan al FINAL de cada paso (y tras un toque humano): ya no hay aviso falso "¡Salta! · Bloqueo".
4. **Recepción de la IA continua** (ritmo/tiempo de vuelo, baile del flotante, carrera del receptor, líneas/corto).
5. **4 niveles**: Fácil, Normal (nuevo, intermedio), Difícil (= Normal anterior), Experto (= Difícil anterior).
6. **Contacto con el cuerpo**: el balón ya no atraviesa a un jugador: toque `shot:'body'`.
7. Salto del humano junto a la red con el balón del rival (cualquier toque): la inercia no le mete en la red.
8. **Cambio de campo** (18.2.1 / 18.2.2): evento `courtChange` al acabar cada set y a los 8 del 3.º.
9. **Ayuda de timing por nivel** (`VB.TIMING`, `g.tm`): en Fácil/primer partido el gesto espera más y dura más.
10. Texto: "La CPU manda el balón fuera" (antes "Balón fuera de la CPU").

## 1. Modelo de juego (lo que tiene que saber la UI/tutorial)

### Golpeo por timing (humano)
- GOLPEAR abre un gesto de `g.tm.swing` s. El contacto ocurre cuando el balón está al alcance; si el **momento ideal**
  llega en ≤ `g.tm.assist` s, el gesto lo espera (el contacto se ve en su sitio). Tras un gesto fallido hay `g.tm.lock` s
  de bloqueo (aporrear no sirve). Valores (`VB.TIMING[nivel]`; el primer partido `rookie` en Fácil/Normal usa los de Fácil):

  | nivel | assist | swing | lock |
  |---|---|---|---|
  | Fácil | 0,28 | 0,42 | 0,06 |
  | Normal | 0,22 | 0,36 | 0,09 |
  | Difícil | 0,16 | 0,30 | 0,12 |
  | Experto | 0,14 | 0,27 | 0,14 |

  La NOTA es honesta en todos los niveles (sale del desfase real): en Fácil una pulsación pronta hace contacto, pero 'poor'.
  `C.SWING/C.ASSIST/C.SWING_LOCK` siguen existiendo (= Difícil) por compatibilidad; la sim ya no los usa.
- **Armado del brazo** `C.WINDUP` = 0,07 s: lo ideal es PULSAR 70 ms antes del contacto ideal
  (`te = pulsación + WINDUP − ideal`). Quien pulsa 100-200 ms después de ver "¡Golpea ahora!" (t < 0,22) saca
  'perfect'; pulsar al instante de aparecer el aviso da 'poor' (simtest lo comprueba). `hitWindow().press` = s hasta el
  momento ideal de PULSAR (0 = pulsa ya).
- Momento ideal = instante en que el balón pasa por el punto de contacto del toque (pies + `C.ZC[kind]`:
  recepción 0,85 m, colocación 2,2, ataque desde el suelo 1,5, remate 2,45 sobre los pies en el aire, saque 2,55/2,45).
- `|te| ≤ 0,035` → **perfect**, `≤ 0,10` → **good**, si no **poor**. `quality` (0..1) = timing × distancia al cuerpo ×
  dificultad del balón entrante.
- **Plancha**, **dejada**, **apuntar el remate**, **asistencia de movimiento**: sin cambios (ver CONTRACT / revisión 1).
- **Contacto con el cuerpo (nuevo)**: si el balón va a salir de la "cápsula" del cuerpo de un jugador (radio 0,3 m,
  de 0,2 m a 1,85 m sobre los pies) en su campo y nadie lo está jugando (humano sin gesto en curso; IA que no va a ese
  balón o que está "batida"), es un toque: `hit {shot:'body', grade:'poor', quality ≤ 0,12}`, `kind` según el toque
  del equipo (1 = `'pass'`, 2 = `'set'`, 3 = `'free'`). Cuenta para los 3 toques y para dobles (regla). El balón rebota
  hacia fuera del cuerpo y nunca hacia la red. Se aplica en el ÚLTIMO instante dentro de la cápsula: un humano que
  pulsa algo tarde sigue jugándolo con su gesto.

### Bloqueo (nuevo modelo, revisión 2)
- Volumen de las manos de un jugador en el aire junto a la red: desde la red (2,38 m) hasta `pies + 2,5 + 0,3·qb`;
  ancho (centro del balón) `±(0,42 + 0,25·qb)` en las manos (por encima de pies + 1,95 m) y `±0,3` en el cuerpo
  (cabeza/pecho). `qb` = 1 en el punto alto del salto. `VB.Sim._inBlockVol(q, ball)` da la geometría exacta.
- Si el balón entra → **siempre** contacto. Resultado (por orden, condicionado): `stuff` (directo al campo del atacante,
  más probable con buen `qb`, balón centrado y oficio del bloqueador), `soft` (amortiguado, jugable en su campo),
  `tool` (block-out por el borde de las manos) o **`touch`** (nuevo: toque de bloqueo que NO frena del todo el balón:
  sigue a su campo más lento, más alto y algo desviado; defendible). El bloqueo nunca cuenta como toque.
- Si un balón que tocó el bloqueo cae en el campo del bloqueador (o fuera tras `tool`), el punto es `how:'kill'`.
- La IA rematadora "lee" el bloqueo: evita líneas que crucen la red por las manos del bloqueador (más cuanto mejor el nivel).
  Para el humano, apuntar por fuera del bloqueo compensa (el bot perfecto de simtest lo hace: +15 puntos de % contra Experto).
- Medido: humano colocado perfecto que salta con el aviso → toca 33-46 % de los remates (antes 15-23 %); saltar tarde
  da menos `stuff`. CPU vs CPU: el bloqueo toca ~25 % de los remates.

### Rol defensivo del humano (nuevo, revisión 2)
- `g.defRole`: `''` (fuera de la fase de ataque rival) | `'dig'` | `'block'`.
- Cuando la CPU coloca para atacar (2.º toque, el balón se queda en su campo), `defRole = 'dig'`: si el jugador del
  humano es el más cercano a la red, el control pasa al de atrás (`switch {auto:true, reason:'defense'}`) y el
  compañero IA va al bloqueo. Así la cámara se asienta ~1,5 s antes del remate y el humano conserva
  defensa → (colocación del compañero) → remate.
- Mientras dura esa colocación, **CAMBIAR** intercambia papeles (`defRole = 'block'`: controla al de la red y bloquea;
  defiende la IA). Con `'block'` el control no salta solo al defensor tras el remate.
- Regla general: ningún cambio automático de jugador con el balón a > 12 m/s y a < 0,6 s del contacto (juega el
  compañero IA y el control pasa en el toque siguiente).

### Saque
- Sin cambios para el sacador (ver revisión 1): balón en la mano, silbato, 8 s, flotante (baila) / en salto (liftado).
- **Recepción de la IA (nuevo)**: `g.recvRisk` (0..~1,4) = 0,85·ritmo (tiempo de vuelo: ≤ 1 s = máximo)
  + 0,42·baile del flotante + 0,35·carrera del receptor (margen entre vuelo y lo que tarda en llegar)
  + 0,3·lejos de sus manos + 0,4·cerca de las líneas/fondo/corto. P(fallo) = `(riesgo − 0,25)² × (0,14 + (1 − recv)·1,3)`.
  Un saque que cae fuera no exige recepción (riesgo 0).
- Aces medidos con timing perfecto (150 saques por fila):

  | nivel | flotante sin apuntar | flotante apuntado | salto sin apuntar | salto apuntado |
  |---|---|---|---|---|
  | Fácil | 14 % | 18 % | 39 % | 29 % |
  | Normal | 4-5 % | 9-10 % | 20 % | 15 % |
  | Difícil | 4 % | 8 % | 13 % | 7 % |
  | Experto | 5 % | 5 % | 5 % | 4 % |

### Cambio de campo (nuevo, reglas 18.2.1 / 18.2.2)
- Evento `courtChange {setNo, why:'set'|'eight', score, sets, pause}` al ganar un set que no acaba el partido (pausa del
  set 3,6 s en vez de 2,6) y cuando un equipo llega a 8 en el 3.er set (una vez; +1,4 s de pausa antes del saque).
- Es PRESENTACIÓN: el humano sigue en x > 0 (controles relativos a la cámara). Ver peticiones abajo.

### Reglas implementadas (terminología FCVB)
punto directo, sets a 25 (3º a 15) con 2 de diferencia, punto de set/partido, cambio de saque con rotación del sacador,
3 toques (`four`), dobles (`double`), el bloqueo no cuenta como toque y el bloqueador puede volver a tocar, **bloquear el
saque es falta** (`block`), antena (`antenna`), **por debajo de la red** (`under`), **toque de red** (`net`), línea central,
**8 segundos** y **balón que cae tras el lanzamiento** (`serve`), **antena tocada sin cruzar** y **cruce en parte por fuera sobre la antena** (revisión 3), saque/balón a la red, balón en la cinta que pasa,
**ataque del saque** (`attackServe`, 13.3.4), **penetración**, **llamada de línea** (`C.IN_TOL`), **contacto con
cualquier parte del cuerpo = toque** (nuevo), **cambio de campo** (nuevo).

### IA (lo que se ve)
- Quién va al balón: por tiempo hasta el balón; histéresis del cambio de jugador (0,3 s de ventaja, máx. uno cada 0,5 s).
- Defensa/recepción que la CPU "no va a sacar" (`g.digOk === false`, también en saques): lee tarde, llega tarde, se tira
  y no llega (`dive {miss:true}`) o la toca desviada (`shank`) / le da en el cuerpo (`body`). Nunca se queda quieta.
- El bloqueador IA rival se coloca con un error lateral que depende del nivel (peor bloqueador = manos más lejos del balón).

### Dificultad: 4 niveles
`createGame({difficulty})`: `'easy'|'normal'|'hard'|'expert'` (alias `facil|fácil|medio|dificil|difícil|experto`).
Orden para menús: `VB.DIFF_ORDER` = `['easy','normal','hard','expert']`; nombre visible `VB.DIFF[k].name`
(Fácil/Normal/Difícil/Experto). El compañero IA del humano usa siempre `VB.DIFF.mate`. La demo del menú (CPU vs CPU)
usa el perfil `VB.DIFF.demo` (perfil propio desde R6: ritmo de partido real, ver §R6).
**Revisión 3: bots humanos en tercera persona.** Antes el equilibrio salía de bots con percepción casi perfecta
(reacción fija, error de posición pequeño y constante) y prometía demasiado. Ahora los bots de simtest juegan SOLO con la
entrada real y modelan a un jugador detrás de la cámara:
- reacción tras cada toque ~ lognormal (mediana `react`, dispersión `rlog`) + despistes ocasionales (`lapse`, +0,2-0,5 s);
  hasta reaccionar sigue con el movimiento que llevaba (no se para en seco);
- error de lectura del punto de juego que crece con el vuelo que queda y con la distancia, se corrige al acercarse
  (queda un residuo) y es `depth`× mayor en profundidad (el eje de la cámara: corto/largo es lo difícil);
- malas lecturas (`wrong`): corre 1,3-2,5 m hacia el lado equivocado (corto/largo) y corrige 0,3-0,6 s después;
- timing con σ por habilidad, sesgo a pulsar pronto (`bias`) y σ mayor con balón rápido (`fast`); el salto del bloqueo
  sale cuando VE despegar al rematador (reacción + error) y el novato a veces no salta para rematar (`jumpOk`);
- inercia del stick (`acc`: cambio máximo de la entrada por segundo) y holgura al pararse (`stop`);
- **novato = primera sesión**: `rookie:true` (ayuda de timing de Fácil y saque suave de la CPU, como el primer partido real),
  no bloquea, casi no apunta, saca flotante.

| perfil | reacción (mediana) | error de lectura | malas lecturas | timing σ | inercia stick |
|---|---|---|---|---|---|
| novato (1.ª sesión) | 0,34 s (+10 % despistes) | 1,2 m (×1,6 prof.) | 12 % | 110 ms, pronto 40 ms | 5 /s |
| medio | 0,26 s (+5 %) | 0,8 m (×1,5) | 6 % | 70 ms | 8 /s |
| bueno | 0,20 s (+2 %) | 0,45 m (×1,4) | 2 % | 45 ms | 12 /s |
| perfecto (cota superior) | 0,13 s | 0,12 m | 0 | 20 ms | 40 /s |

Matriz nueva (`node tools/simtest.js`, 4 semillas × 20 min por casilla, ~300-440 puntos; % de puntos del humano):

| bot | Fácil | Normal | Difícil | Experto |
|---|---|---|---|---|
| novato (1.ª sesión) | **47 %** (R5; antes 51-53 %) | 34 % | 19 % | 12 % |
| medio | 74 % | **53 %** | 40 % | 24 % |
| bueno | 84 % | 69 % | 57 % | 39 % |
| perfecto | 94 % | 82 % | 77 % | 58 % |
| IA compañero (autopilot) | 78 % | 58 % | 46 % | 24 % |

Con 12 semillas (~1 200 puntos, ±1,4), R5: novato vs Fácil 47,5-48,2 % (semillas 999/777; 47,9 % con 24 semillas), medio vs Normal
50,0-51,6 %, novato vs Normal 33,6-36,2 %. Objetivos: novato en su primera sesión 40-50 % en
Fácil (gana ~1 de cada 3 partidos), jugador medio ~50 % en Normal, Difícil y Experto claramente más duros (medio 40 % y
24 %; Experto exige incluso al bueno: 39 %, y solo el perfecto le gana).
Ablación (Fácil sin la ventana de ayuda, con el timing de Difícil): el novato falla un 17 % más de gestos
(443 frente a 377) y pierde 1,5 puntos de %; la ayuda quita fallos sin regalar puntos (la nota sigue siendo honesta).
simtest comprueba: novato:easy 0,40-0,51 (R5), medio:normal 0,44-0,57, novato:normal 0,22-0,42, medio:easy > 0,62,
Difícil y Experto al menos 6 puntos por debajo del anterior para el medio, bueno:expert < 0,5, perfecto:expert > 0,5,
novato:expert < 0,25, perfecto > bueno > medio > novato en cada nivel y cada nivel no más fácil que el anterior.

Perfiles retocados (sim.js `VB.DIFF`): **Fácil** `err` 1,6 a 1,35 (la CPU regalaba ~20 % de los puntos mandándolo fuera),
`dig` 0,24 a 0,27, `recv` 0,70 a 0,72, `atkErr` 0,14 a 0,11, `srvErr` 0,15 a 0,12. **Normal**, más cerca de Fácil: `react` 0,18,
`speed` 0,90, `timing` 0,07, `err` 1,1, `block` 0,30, `dig` 0,42, `recv` 0,83, `spike` 15,4, `jserve` 14, `jumpServe` 0,08,
`tip` 0,08, `aimNoise` 1,9, `atkErr` 0,105, `srvErr` 0,12, `seam` 0,08. **Difícil**, algo más suave (el medio caía de 52 %
en Normal a 36 %): `react` 0,13, `dig` 0,48, `spike` 16,2, `jserve` 15,6, `atkErr` 0,09, `block` 0,40. **Experto** igual.
`VB.TIMING` sin cambios. La demo del menú usa `VB.DIFF.demo` (perfil propio desde R6, ver §R6).

(Matriz anterior, revisión 2, con los bots de percepción casi perfecta: novato 66/39/31/20, medio 87/60/51/35,
perfecto 94/83/71/63.)

CPU vs CPU (demo; R6, 105 semillas × 20 min): 5,7 puntos/min, rally mediana 4,9-5,5 s, 41-61 % de remates son punto (52 % de media),
aces ~5-6 %. `createGame({rookie:true})`: la CPU saca más suave y el humano tiene la ayuda de timing de Fácil (solo
en Fácil/Normal).

## 2. Añadidos al estado (solo lectura para los demás)
- **Revisión 3**: `g.antennaHit` (`{x,y,z}` donde el balón tocó la antena en este punto, o null), `g.aimIn` (`[wx,wy]` normalizado) /
  `g.aimOn` (bool): dirección de apuntado de la entrada del último paso. `VB.DIFF.demo` (perfil de la demo del menú).
- `g.difficulty` (`'easy'|'normal'|'hard'|'expert'`), `g.prof[team]`, **`g.tm`** (`{assist, swing, lock}` del humano).
- **`g.defRole`** (`''|'dig'|'block'`, ver arriba). **`g.recvRisk`** (dificultad del último saque para el receptor).
- **`g.blockBy`** (último jugador que bloqueó), **`g.courtSwap3`** (ya se cambió de campo a los 8 del 3.º).
- Saque, gesto, balón, jugador, `digMargin`, `jobMem...`, `lastLand`: sin cambios (ver CONTRACT §4.2).
- `p.shot` nuevo valor `'body'` (con `p.lastAction` = `'pass'|'set'|'free'` según el toque y `p.anim = 0,12`).
- `g.stats` (solo tests): `blockKinds.touch`, `body`, `courtChanges`.

## 3. Añadidos a eventos
- **Revisión 3**: `point.antenna` (solo `reason:'antenna'`): `[x,y,z]` del contacto con la antena o `null` (cruzó por fuera).
  `point.text` de `reason:'out'`: "Saque fuera" / "Remate fuera" / "Dejada fuera" / "Recepción fuera" / "Defensa fuera" /
  "Colocación fuera" / "Toca el bloqueo y sale fuera" / "Le da en el cuerpo y sale fuera" / "Balón fuera"; `under`: "Balón por debajo
  de la red"; `antenna`: "Balón toca la antena" / "Balón por fuera de la antena". Lista cerrada en simtest (`POINT_TEXTS`).
- `hit`: `shot` nuevo **`'body'`** (contacto con el cuerpo sin gesto; `kind` según el toque, `grade:'poor'`).
- `block`: `result` nuevo **`'touch'`** (toque de bloqueo que sigue a su campo frenado; ni `stuff` ni `soft`).
- `switch`: `+ reason:'defense'` cuando el juego pasa el control al defensor al colocar la CPU (auto:true).
- **Nuevo** `courtChange {setNo, why:'set'|'eight', score:[a,b], sets:[a,b], pause (s)}`.
- `point.text`: "La CPU manda el balón fuera" sustituye a "Balón fuera de la CPU".

## 4. Funciones nuevas en `VB.Sim` / `VB`
- **Revisión 3: `VB.Sim.aimPoint(g, out?, move?)`** devuelve `{x, y, kind, mode, aimed, spread, spreadPoor}` o `null`.
  - `kind`: `'serve'` (saque del humano), `'spike'` (remate en el aire, 3.er toque propio), `'tip'` (dejada: gesto en curso con
    `swingShot 'tip'`), `'free'` (3.er toque desde el suelo). `mode`: 1 = vista previa (saque tras el silbato, aún sin lanzar),
    2 = activo. `aimed`: hay dirección (si no, el destino por defecto: saque al centro a 6 m, remate en diagonal).
  - `spread` / `spreadPoor`: dispersión (m, ± por eje) del destino con un toque perfecto / 'poor' (para dimensionar la retícula).
  - `move` (opcional) = entrada de MUNDO del frame (`ctx.simMove`); sin él usa `g.aimIn` del último paso y, si no hay
    dirección, la que se dio durante el gesto (`g.swingAim`), igual que el golpe real.
  - `null` en demo/autopilot, con la CPU sacando, antes del silbato y fuera del 3.er toque propio. Reutiliza un objeto
    interno si no se pasa `out` (sin asignaciones por frame).
  - simtest: el destino (`hit.target`) del saque real apuntado y del remate (con y sin dirección) coincide con `aimPoint`.
- `VB.DIFF_ORDER`, `VB.TIMING` (= `VB.Sim.TIMING`).
- Internos para tests: `_inBlockVol(q, ball)`, `_serveRisk(g, team)`, `_recvFail(risk, prof)`, `_refreshPred(g)`.
- `VB.AI.openSpot(g, p, minDepth, out, atk)`: `atk` = remate (evita las manos del bloqueador rival).

## 5. Peticiones a otros propietarios (revisión 3)
Las tres pendientes de la revisión 2 quedan HECHAS en sim.js (texto de 'out', antena sin cruzar, `Sim.aimPoint`). Opcionales:
- **CONTRACT.md (integrador)**: §4.2, tras la línea "**Revisión 2**", añadir:
  ```
  - **Revisión 3**: `g.antennaHit` (`{x,y,z}` del contacto con la antena en este punto, o null); `g.aimIn`/`g.aimOn` (dirección de
    apuntado de la entrada del último paso); `VB.DIFF.demo` (perfil de la demo del menú, fuera de `VB.DIFF_ORDER`).
  ```
  En "**Funciones añadidas**" añadir `aimPoint(g, out?, move?)` → `{x,y,kind:'serve'|'spike'|'tip'|'free', mode:1|2, aimed, spread, spreadPoor}`
  o null (destino previsto del golpe del humano, sin el error de ejecución). §4.3, fila `point`: añadir al payload
  `antenna ([x,y,z] del contacto con la antena | null = cruzó por fuera; solo con reason 'antenna')` y a "cuándo": "`antenna` = toca la
  antena (aunque no cruce la red) o cruza en todo o en parte por fuera del espacio de paso". §6: el uso de simtest pasa a
  `node tools/simtest.js [min] [seed] [minMatriz=20] [semillas=4]` (+ `SIMTEST_ONLY=matrix`, `MATRIX_FILTER=<regex>`).
- **arena (fx.js, opcional)**: `aimTarget` ya delega en `Sim.aimPoint` (comprobado en la página real); la copia de las fórmulas puede
  quedarse como reserva o borrarse. Si se quiere, escalar la retícula con `r.spread` (0,37 m saque / 0,33 remate) o enseñar la
  dispersión 'poor' (`r.spreadPoor`, ~1 m) en la vista previa del saque. Para usar la entrada de este mismo frame:
  `Sim.aimPoint(g, out, ctx.simMove)`.
- **arena (arena.js, opcional)**: con `point.reason === 'antenna' && point.antenna` (contacto real), hacer vibrar la antena de ese lado
  (`point.antenna[1] < 0` = antena de y negativa) y que el juez de línea agite la bandera como ya hace con la antena.
- **ui_main (opcional)**: el subtítulo de árbitro para `reason:'out'` ya puede usar `e.text` tal cual (mismo vocabulario que `OUTK`,
  y distingue "Recepción fuera"/"Defensa fuera"); el cálculo propio de `ui.js` sigue siendo válido.
- **TRASPASO.md (integrador)**: en "Sin comprobar o pendiente", la línea "Opcional, de sim: ..." queda hecha; y "El equilibrio de
  dificultad sale de bots" pasa a "sale de bots con un modelo de jugador en tercera persona (revisión 3, notes/sim.md §1): falta probarlo
  con jugadores reales".

## Aplicado (log)
- 6-nov-2026 (Integrate, PC de casa): players (toss, saque en salto, plancha, dejada, perfect, celebración del bloqueador), camera_input (temblor por
  power/grade, dive, block stuff), arena/fx (perfect, netTouch, dive, block.result, hit.shot), ui_main (miss, "Espera el silbato",
  drive.js con saque en dos pulsaciones, escenas toss/jumpserve/dive, serveClock:false en serve/hud). Eventos y campos nuevos
  documentados en CONTRACT.md §4.2/§4.3.
- 6-nov-2026 (integración tras Review 1): fx.js aro de caída con `C.IN_TOL`; main.js `rookie` en el primer partido (`isRookie()`, sin récord guardado);
  CONTRACT §4.2/§4.3 (`attackServe`, `dive.miss`, `hitWindow().press`, `digMargin`, `lastLand`, `IN_TOL/WINDUP/ASSIST/SWING/HOLD_*`, `rookie`);
  ui.js tutorial del remate con el apuntado concreto; arena.js videomarcador "ATAQUE DEL SAQUE". El aviso con `w.press` (opcional) NO se cambió:
  el aviso actual (`w.t < 0.22`) ya equivale y simtest lo valida. Petición a players (balón sostenido): ya hecha por players.
  Hecho en sim.js a petición de camera_input: `g.lastLand = {x,y,inside,t}` en el primer bote, `null` en serveReady.
- 6-nov-2026 (Review 2, fixer sim): ver §0. Pendiente de integrar las peticiones de §5.
- 6-nov-2026 (integración tras Review 2): ui.js 4 niveles (desde `VB.DIFF_ORDER`/`VB.DIFF[k].name`, 4 barras en el menú, "Revancha en <nivel+1>" hasta Experto); main.js
  valida `difficulty`/`?diff=` contra los 4 niveles; banner "Cambio de campo" encadenado tras el de SET/PUNTO (+ silbato corto en audio.js
  y mensaje en los videomarcadores de arena.js); callout "Toque de bloqueo" con `result:'touch'`; avisos/consejos según `g.defRole`
  ("¡Salta! · Bloqueo" solo con `'block'` o sin rol; "defiende el aro · tu compañero bloquea · C para bloquear tú"); "DEFENSA" tras
  bloqueo propio; `shot:'body'` → "¡Te ha dado!" + consejo, FX apagado sin destello, golpe sordo en audio, reacción de encogerse en
  players.js; camera.js deslizamiento más largo (0,6-0,85 s) con `switch.reason:'defense'`; tutorial del bloqueo y reglas CUERPO /
  CAMBIO DE CAMPO; CONTRACT §4.2/§4.3 al día. Comprobado con `tools/out/int2/flow3.js` (set 1 → "Cambio de campo / Fin del 1.er set";
  3.er set a los 8 → "Cambio de campo / Set decisivo · 8 puntos") y `tools/out/int2/coach.js` (consejo de defensa en vivo).
- 7-nov-2026 (revisión 3, sim): `Sim.aimPoint`, antena tocada sin cruzar y cruce en parte por fuera sobre la antena, `point.antenna`,
  textos de 'out' por toque y vocabulario revisado con lista cerrada en simtest, bots humanos en tercera persona (4 perfiles, 4
  semillas por casilla, `SIMTEST_ONLY`/`MATRIX_FILTER`), reajuste de Fácil/Normal/Difícil, demo congelada en `VB.DIFF.demo`.
  Comprobado: `node tools/simtest.js` (completo) y `node tools/simtest.js 10 12345 0` dan TODO OK; `tools/console.sh all 1280 720`
  sin errores JS; `node tools/drive.js 1280 720 30` TODO OK; `aimPoint` en la página real (eval.js: vista previa (-6, 0), con
  flechas izquierda+arriba (-7,80, -2,26); en el lanzamiento mode 2) y captura del arco de apuntado `tools/out/simv3/aim_toss.png`.

## Aplicado (log, integración de pendientes)
- 7-nov-2026 (integración de pendientes): CONTRACT §4.2 (Revisión 3: `antennaHit`, `aimIn/aimOn`, `VB.DIFF.demo`, `aimPoint`), §4.3 (`point.antenna`, textos) y §6 (uso de simtest)
  al día. fx.js pasa `ctx.simMove` a `aimPoint`. ui.js usa `e.text` para el subtítulo de 'out' (el cálculo propio queda de reserva).
  arena.js: juez de línea del lado de `point.antenna`. TRASPASO actualizado (pendientes de sim hechos; equilibrio con bots en 3.ª persona).
  Comprobado: `node tools/simtest.js` completo → TODO OK.

## Aplicado (log, integración ronda 1 de verificación, 7-nov-2026)
- R4.1 petición a arena (videomarcador con 'out' + «a la red»): aplicada en arena.js `pointSub` (variante más segura: con `reason 'out'`
  no se usa `HOW`, para no poner «¡ACE!» en un fuera). Comprobado en node: out/«Balón a la red» → BALÓN A LA RED, out/«Saque a la red» →
  SAQUE A LA RED, out/«Recepción fuera»+ace → FUERA.
- simtest (prueba «timing aprendible»): pasa a la ventana única de la señal de golpeo, `press` en (−0,15, 0,24) (la del brillo de input.js
  y ahora también la de ui.js). Medido en el mismo caso de defensa (12 semillas): reacción 0,15 s good · 0,2 y 0,25 s perfect · 0,3 s good
  (con la ventana vieja: 0,1–0,2 perfect, 0,25 good, 0,3 poor). Condición nueva: perfect ≥ 9 a 0,2 y 0,25; perfect+good ≥ 9 a 0,15 y 0,3.
- CONTRACT §4.2 (R4: `g.atkServe`, efecto de `rookie`) y §4.3 (textos «a la red» con 'out', `attackServe` al cruzar) al día.
- `node tools/simtest.js` completo → TODO OK.

## Aplicado (log, integración ronda 2 de verificación, 7-nov-2026)
- CONTRACT §4.2: `rookieProf(pr, on, diff)` (Fácil solo saque; extras de peloteo solo en Normal), línea **R5** (`isAttackContact`, ace/kill que roza la cinta).
- §R5.5 (textos del árbitro): DECIDIDO por Ferran (7-nov-2026): «Ataque sobre el saque» aplicado; «Dobles» y «Falta de saque: 8 segundos» se quedan como están (no cambiar).
- Petición de camera_input (deprecaciones de mapa, para sim/players/integración): aplicada en sim.js con `dblFields(o)` (junto a `emit`): los campos
  enteros de `g`, `g.ball`, `g.pr1/pr3`, `g.rally`, cada jugador (`mkPlayer`) y cada evento pasan por un double al crearse. Misma semántica: la salida
  de `node tools/simtest.js 10 12345 0` es idéntica byte a byte a la de antes y la matriz del simtest completo también. Medido con el log de V8
  (`tools/out/camalloc/deopt3.js`): ya no hay deprecaciones de `step`/`stepServe`/`toss`/`doServe` sobre `g` en mitad del partido. Quedan las de los
  literales de EVENTO (`hit`, `block`, `point`, `land`: ~40-80 mapas por punto; sus mapas se recolectan y se rehacen), sin desoptimizaciones en masa asociadas.
- Comprobado: simtest completo TODO OK (novato Fácil 46,8 %, Normal 33,9 %; medio Normal 53,0 %, Fácil 74,2 %).

## De camera_input (pulido ola 1, CAM-03/05): lo que la cámara lee de `g` (2026-11-07)
- Nada que cambiar para que funcione. La cámara anuncia sus cortes con `g.timer` en `'point'` (s de juego hasta `serveReady`; `skipHold` deja 0,3 s:
  sigue anunciado con margen; **por favor, que un salto futuro nunca ponga `g.timer` por debajo de ~0,2 s**, o la cortinilla de UI-13 no llegaría).
- SIM-04: la transición al saque rival lee `g.cpuTossIn` (s de juego hasta el lanzamiento de la CPU) si existe; hoy el reloj equivalente es `g.timer` en
  `'serve'` con `g.serving === 1` (1,3 s desde `serveReady`). Si el ritual del sacador CPU alarga ese tiempo, basta con exponer `g.cpuTossIn`.

## De players (pulido ola 1), 2026-11-07 — informativo, nada bloquea
1. **Balón en la mano en el frame de `serveReady`**: `setupServe` pone `b.held = sv` pero la posición del balón no se actualiza hasta el
   siguiente `stepBall` (sigue donde rodaba ese frame: arena lo pinta un frame lejos del sacador). Players ya usa `VB.Sim._holdPos`. Si se
   quiere el balón en la mano desde ese mismo frame, al final de `setupServe`: `holdPos(g, sv, b);`.
2. **Altura del contacto del saque flotante** (`ZC.fserve` = 2,55 sobre los pies, y la IA golpea hasta ~2,78 cuando adelanta el golpe): con el
   brazo estirado la palma del atleta llega a ~2,3 m; players sube a puntillas y da un saltito de hasta 0,22 m en los últimos 0,3 s para
   llegar. Si se busca un flotante «de pie» más realista, `ZC.fserve` ≈ 2,40 (opcional; cambia el timing, habría que recalibrar simtest).
3. Las convergencias de PLY-07 leen `g.timer` en 'point' para la vuelta: SIM-03 (pausas largas) les da más tiempo sin cambios.

## Aplicado (log, integración del pulido ola 1, 8-nov-2026, PC de casa)
- Petición de players §1 aplicada: `setupServe` llama a `holdPos(g, sv, b)` (balón en la mano ya en el paso del `serveReady`). Sin azar:
  `simtest 10 12345 0` idéntico línea a línea antes/después. §2 (`ZC.fserve` ≈ 2,40) NO aplicado: cambia el timing y la calibración.
- simtest: el suelo del 1 % de «puntos grandes» de la demo solo se exige con ≥ 100 puntos (semilla 22 a 10 min: 0 de 61 puntos, ~1 de cada 160
  semillas por azar con un 8 % de grandes). Medido después: semillas 1-35 a 10 min y 1-25 a 20 min → TODO OK; completo TODO OK.
- CONTRACT §4.2/§4.3/§5 actualizado con el texto de §P1 (campos del punto, `present`, `skipHold`, `highlightOf`, `VB.HOLD`).
- SIM-03 en main.js ya lo había cableado ui_main (`present: !opts.autopilot`, `skipHold` con GOLPEAR/SALTAR).

## Aplicado (log, integración del pulido ola 2, 8-nov-2026, PC de casa)
- Aviso de ui_main (y del verificador, `verify-w1-feel/srvdrop.js`): la CPU dejaba caer su propio lanzamiento («Falta de saque: el balón cae sin
  golpearlo» a favor del humano), ~0,2 % de los saques, casi todos en Fácil de primer partido. Causa: `g.aiServeTe` se muestreaba en
  (−0,25, 0,25) y la IA solo golpea con `canReach`, que se cierra hacia `w.t ≈ −0,23 s`: con un desfase tardío > 0,23 esperaba hasta que el
  balón caía. Arreglo en `toss()`: `clamp(..., -0.25, 0.2)` (sin cambiar el flujo del azar). `srvdrop2.js`: 13/5880 → 0/5880.
  simtest: comprobación nueva «saque de la CPU: 0 lanzamientos caídos» (4 niveles × primer partido sí/no × 3 semillas, 150 s cada uno).
  Matriz de equilibrio prácticamente igual (novato en Fácil 46,8 % → 48,5 %, medio en Fácil 74,2 → 73,5 %; el resto idéntico).

## De audio (pulido ola 2, AUD-05, 8-nov-2026): `dribble` consumido
- audio.js suena cada `dribble` (SIM-04) como un bote en el parqué más suave que uno de peloteo (-23 frente a -18 LUFS; por encima de los
  botes muertos, -26), en el punto del bote (`x, y` del evento) y con la ganancia por `speed` (velocidad contra el suelo). Uno por evento:
  en 240 s de partido renderizado, 35 botes de la sim → 35 sonidos; en la partida real, 12/12. Nada que pedir.

## De camera_input (pulido ola 2, CAM-09 cierre de set), 2026-11-08 — petición opcional
- `g.cpuTossIn` (SIM-04) consumido: el cutaway al sacador rival (CAM-14) dura `gameToReal(g.cpuTossIn) - 0,55` s (0,95-1,4) y vuelve a la
  recepción ≥ 0,55 s antes del lanzamiento. Gracias: con los 1,3 s de antes no cabía.
- **Pausa del set**: el cierre de set ahora es seguimiento del balón a cámara lenta + órbita de los ganadores (≥ 1,85 s, lo pide CAM-09) y
  DESPUÉS la grúa del cambio de campo. Con `VB.HOLD.set = 3,4` (≈ 3,9 s reales con la cámara lenta) quedan ~1,66 s de grúa (courttest pide ≥ 1,6:
  pasa, justo). Propuesta: `VB.HOLD.set` 3,4 → **4,0** (solo con `present`) para órbita de ~2,2 s y grúa de ~2 s cómodas. La cámara se adapta a
  lo que haya (`point.hold` / `g.timer`): no hace falta coordinar nada más.

## Aplicado (log, integración del pulido ola 2, segunda tanda, 8-nov-2026, PC de casa)
- Petición de camera_input aplicada: `VB.HOLD.set` 3,4 → **4,0** (solo con `present`). simtest: la comprobación de la pausa del set usa
  `VB.HOLD.set` en vez del 3,4 literal (y el texto del informe). Barrido 1-25 × (10 y 20 min) + completo: TODO OK.
- CONTRACT §4.2/§4.3: texto de §P2 pegado (estado `seed/serveNo/cpuTossIn/ritual`, `VB.RITUAL`, `ritualAt`, `createGame({ritual:false})`,
  `serveClock` de la CPU, `_holdPos` = mano) y evento `dribble`.
- Visto en la integración (no cambiado): la escena `debug=ace` sale ahora con un ace cuyo texto es «Balón a la red» (`reason 'in'`, `how 'ace'`:
  la recepción rival a la red y cae en su campo). Es un texto de la lista cerrada y correcto, pero junto a «¡ACE!» se lee raro; para SIM-05 /
  ui_main valorar «Recepción a la red» (añadirlo a `POINT_TEXTS` si se hace).

## Aplicado (log, ola 3 — fixer sim, 8-nov-2026)
- **SIM-04 (regresión del ritmo de la demo)**: con el ritual (2 botes, ≤ 1,1 s, silbato a 0,35) la demo del menú bajó de 113,3 a 107,8 puntos
  de media en 20 min (semillas 1-200, `tools/out/simfix/demosweep.js`) y 4 de 200 semillas (33, 54, 88, 164) no cerraban 2 sets. Arreglo, solo
  con `g.demo` (partido humano y autopilot idénticos): `VB.RITUAL.demoBounces` 2 → **1** (un bote firme), `demoMax` 1,1 → **0,8** (el ciclo mínimo
  `minCyc` puede llevarlo a ~0,84; `minDur` ya no alarga por encima de `demoMax`), silbato de la demo `RITUAL.demoWhistle` = **0,2** s (antes 0,35
  literal) y pausa rutinaria de la demo `RITUAL.demoHold` = **1,65** s (antes 1,9; set 3,6 y partido 2,2 sin cambios). Resultado: 116,3 puntos de
  media, 0/200 semillas sin 2 sets en 20 min, mínimo 107 (10 min: mínimo 48, el umbral es 45). En el navegador (menú): ritual de 1 bote, balón al
  suelo (z = C.BR) y de vuelta, lanzamiento a ~1,0 s del serveReady, 1,63 s reales entre punto y saque. La cámara no hace cutaway en la demo
  (`cutawayNext` excluye `g.demo`); el presupuesto de vuelta al saque con `cpuTossIn` ≈ 1,0 queda en 0,55 s (antes 0,45 con el 0,9 fijo).
- **SIM-05 (matriz con bandas que dependen de la muestra)**: medidas 80 semillas × 20 min por casilla (`SIMTEST_ONLY=matrix node tools/simtest.js
  0 <s> 20 1`, s = 1..80): novato/Fácil 47,0 % (sd de una semilla 5,1), medio/Normal 51,4 (5,3), novato/Normal 36,3 (5,2), medio/Difícil 40,1 (4,0),
  medio Normal−Difícil 11,3 (sd 6,0). Las bandas fijas tenían el borde a ~1,6σ: remuestreando esas semillas, **14,7 %** de las semillas del simtest
  fallaban la matriz sin cambiar nada (las 3 y 99 del verificador). Ahora (`MATRIX_STAT` en simtest): banda = objetivo de diseño ± 3,5·sd/√(semillas
  × min/20) (novato/Fácil 45-49, medio/Normal 47-53, novato/Normal 30-38), diferencias mínimas = min(diseño, media medida − 3,5σ) (medio
  Normal−Difícil, Difícil−Experto, auto Normal−Difícil, Difícil−Experto), y las 6 casillas de banda estrecha juegan el doble de semillas.
  Falso fallo remuestreado: **0,09 %**. Las demás comprobaciones de la matriz (fijas) no cambian. Simtest completo ~45-55 s (antes ~40).
- simtest: la pausa esperada de la demo es `VB.RITUAL.demoHold`; comentario de la prueba 6 del ritual al día.
- Comprobado: simtest completo TODO OK en semillas 3, 99, 33, 1, 7 y 12345; barrido `simtest <10|20> <1..40> 0` → 80/80 TODO OK (puntos de la demo:
  10 min 52-65, mediana 59; 20 min 110-126, mediana 118 ≈ 5,9/min, algo más ágil que HEAD 5,65); drive.js TODO OK; película del ritual en
  `debug=rally&live=1` (2 botes, z 1,0 → 0,21 → 1,0) y en el menú (1 bote) con eval.js.

### Para el lead (CONTRACT §4.2, línea de `VB.RITUAL`), texto propuesto
`VB.RITUAL` (constantes; `tossBy` 4,5 s; demo del menú: `demoBounces` 1, `demoMax` 0,8 s, `demoWhistle` 0,2 s = silbato de la demo, `demoHold` 1,65 s =
pausa rutinaria de la demo).
### Para el lead (aceptación)
- SIM-03: la pausa del set es `VB.HOLD.set` = **4,0** s (pedido por camera_input para CAM-09); el simtest la compara con `VB.HOLD.set`.
- SIM-04: «el balón llega al suelo (z del centro = C.BR = 0,21)», no «por debajo de 0,15» (el centro del balón nunca baja de su radio).

## Aplicado (log, integración de los arreglos tras la verificación de la ola 2, 8-nov-2026 noche, PC de casa)
- CONTRACT §4.2: línea de `VB.RITUAL` con el texto propuesto (demo: `demoBounces` 1, `demoMax` 0,8, `demoWhistle` 0,2, `demoHold` 1,65); §6: `MATRIX_STAT`.
- Barrido de la integración: `simtest <10|20> <1..25> 0` → 50/50 TODO OK; `simtest` completo TODO OK. Textos arbitrales intactos.

## Aplicado (log, integración del pulido ola 3, 9-nov-2026, PC de casa)
- CONTRACT §4.2/§4.3 con el texto de §P3 (`clutch`, `VB.HL`, `clutchOf`, umbrales 0,55/0,8); ui.js usa ya `highlight >= VB.HOLD.bigAt` y el subtítulo «Final apretado».
- simtest completo (semilla por defecto) → TODO OK (calibración 20,2 % / 3,3 %); barrido `simtest <10|20> <1..25> 0` → 50/50 TODO OK.

## Arreglos tras la verificación de la ola 3 (9-nov-2026, PC de casa) — fixer sim
- **IA sin dobles ni 4 toques** (antes ~1/1.800 puntos, igual que HEAD). Causa medida con una sonda (40 semillas × 10 min × demo + autopilot
  vs 4 niveles, 9.645 puntos): los 7 casos venían de `checkBody` (balón que da en el cuerpo), no del reparto de `computeJob` (que ya daba el
  toque siguiente al compañero): (a) recepción desviada que, pasados los 0,5 s de gracia, le cae encima al propio receptor → dobles;
  (b) colocación que en el mismo paso o el siguiente toca al compañero pegado (3.er toque de cuerpo o de antebrazo instantáneo) y luego
  rebota en el colocador → 4 toques. Arreglo:
  - sim.js `checkBody`: un jugador de IA (no `isHuman`) NO recibe toque de cuerpo de su equipo si sería falta (`g.lastPlayer === p` o
    `g.touches >= 3`) o si el compañero acaba de soltar el balón (< 0,3 s). El humano sigue expuesto a la regla.
  - ai.js: `TEAM_GAP` 0,2 s (la IA no toca el balón que el compañero acaba de soltar, salvo que se le vaya: `exiting`) y `dodgeOwnBall`
    (el que acaba de tocar aparta su objetivo a `DODGE_R` 0,9 m del cruce a 1 m de su propio balón: se ve cómo se aparta).
  - simtest: `run()` cuenta los `point` con `reason` 'double'/'four' cometidos por la IA (equipo CPU, demo, autopilot o compañero IA del
    humano; no el jugador que controla el humano) y falla si hay alguno. Cubre la demo, el autopilot (matriz), el fuzz y los bots.
  - Sonda tras el arreglo: 0 dobles y 0 cuatro toques en 9.642 puntos (puntos por configuración ±2 % de antes). simtest completo TODO OK en
    semillas 12345, 1, 7 y 99 (calibración 18,1 % ≥ 0,55; matriz dentro de banda); barrido `simtest 10 <2..42> 0` 12/12 TODO OK; drive.js TODO OK.

### Para el lead (SIM-03: la pausa del set es 4,0 s, no 3,4) — textos exactos
- CONTRACT.md línea 126: `set 3.4` → `set 4.0` (queda `{routine 1.9, big 2.4, bigAt 0.55, set 4.0, match 4.2, eight 1.4, skipAfter 0.8, skipTo 0.3}`).
- notes/camera_input.md:345: `**3,4 al` + `ganar un set** (antes 3,6; …` → `**4,0 al` + `ganar un set** (antes 3,4 y antes 3,6; pedido por CAM-09 …`.
- notes/ui_main.md:324: `3,4 s (set, con el cambio de campo)` → `4,0 s (set, con el cambio de campo)`.
- Aceptación de SIM-03: «un punto `setWon` tiene hold 3,4» pasa a **«hold = `VB.HOLD.set` = 4,0»** (cambio deliberado, CAM-09). El simtest ya lo
  comprueba así: «pausa de presentación (set 4 s; skipHold no a 0,5 s, sí a 0,9 s -> saque en 0.300 s …) OK».

## Aplicado (log, integración de los arreglos tras la verificación de la ola 3, 9-nov-2026, PC de casa)
- SIM-03: aplicados los textos exactos: CONTRACT §4.2 `VB.HOLD` `set 4.0` (y la frase de las pausas: «4,0 s (set…; antes 3,4, cambiado por CAM-09)»), notes/camera_input.md:345 y notes/ui_main.md:324. La aceptación de SIM-03 pasa a «hold = `VB.HOLD.set` = 4,0». SIM-03 queda completo.
- CONTRACT: regla de `checkBody` para la IA, `TEAM_GAP`/`dodgeOwnBall` y la nueva comprobación de simtest (la IA no comete `double`/`four`).
- simtest completo (semilla por defecto) TODO OK (calibración en 20 partidos de demo, 2.029 puntos; determinismo OK); barrido 1..25 × (10 y 20 min) 50/50 TODO OK.
