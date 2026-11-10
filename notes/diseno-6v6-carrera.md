# Diseño: modo 6v6, estadísticas de jugador y modo Carrera

Documento de diseño (9-nov-2026) para los sprints que siguen al de «Gráficos cartoonish». Solo diseño: nada de esto está
empezado. Basado en el código real de `js/sim.js`, `js/ai.js`, `js/players.js`, `js/camera.js`, `js/ui.js` y en el
backlog de `TRASPASO.md` («Modo 6v6», «Posiciones y estadísticas», «Modo Carrera», «Error arbitral y challenge por nivel»).
Los números de línea son orientativos (versión del 9-nov-2026).

Principio rector (de Ferran): **se mantiene el motor de toques y reglas, que ya funciona bien**. El 6v6 es una capa encima:
más jugadores, rotaciones, roles e IA de equipo. El 2v2 actual tiene que seguir dando EXACTAMENTE lo mismo con las mismas semillas.

---

## 0. Punto de partida (lo que ya hay y condiciona el diseño)

- **La pista ya es reglamentaria**: `VB.C.HL = 9`, `VB.C.HW = 4.5` (18 × 9 m), red masculina 2,43, línea de 3 m (`C.ATTACK`).
  El 2v2 se juega en pista de pista cubierta, no de playa. El 6v6 **no necesita agrandar el campo** (el TRASPASO dice «campo
  más grande»: lo que crece es el número de jugadores, la zona libre ya existe; el sacador sale a `x = ±10.3`).
- **Acoplamiento a 2 jugadores por equipo** (lo que hay que generalizar):
  - sim.js: `mkPlayer` usa `id = team * 2 + idx`; `createGame` crea `teams[2][2]`; `other(g, p)` (l. 279) devuelve «el compañero»;
    bucles fijos `for (i = 0; i < 4; i++)` en `checkBlock` (626), `checkBody` (686), `setupServe` (1357), `stepServe` (1546),
    `step` (1592, 1600, 1646); `serveRisk` recorre `i < 2` receptores (1483); `digMargin` (445); `serverIdx[t] = (… + 1) % 2` en
    `point` (1103), `nextSet` y `newGame`; `setupServe` coloca a mano sacador, compañero y los 2 receptores (1354-1356);
    `updateDefense` (1678) reparte bloqueo/defensa entre humano y compañero.
  - ai.js (todo el fichero está afinado para 2): `openSpot` y `serveTarget` miran `opp[0]`/`opp[1]`; `computeJob` compara a `a` y `bb`;
    `pos` es una máquina de estados «yo / mi compañero»; `update` comprueba atacantes y bloqueadores con `opp[0]`, `opp[1]`, `k < 2`.
  - camera.js: ~20 bucles `for (o = 0; o < 4; o++)` sobre `g.players` (encuadre de grupo, oclusión, hero shot, plano del punto,
    clinch) y `mateOf(g)` (l. 313). `players.js` ya recorre `g.players.length` en `onGameStart` (3174), pero usa
    `g.teams[t][0] === p ? 1 : 0` para «el compañero» en celebraciones y miradas (2112, 2262, 2270).
  - ui.js: las estadísticas del partido ya son por jugador (`stats.p[id]` con `pts, kills, blocks, aces`, l. 552) y el MVP
    sale de ahí: sirve tal cual para 12 jugadores y para la valoración de Carrera.
- **Perfiles por equipo, no por jugador**: `g.prof[team]` (`VB.DIFF.easy…expert`, `mate`, `demo`) con `react, speed, timing,
  err, block, dig, recv, spike, jserve, jumpServe, tip, aimNoise, netErr, blockReact, atkErr, srvErr, seam`. Es justo la
  superficie donde engancharán las estadísticas de jugador (§2).
- **Control Uno** ya existe (`g.ctrlMode === 'one'`, contrato del sprint: `createGame({ctrl:'one', ctrlIdx})`): la IA juega
  todo lo que no es del humano, incluido el saque del compañero. Es la base del control de un solo jugador en 6v6.
- **Presupuesto de rendimiento** (notes/players.md, notes/arena.md, `tools/perf.js`): baja ≤ 60 draw calls y ≤ 150 k
  triángulos; media ≤ 350 k; ≥ 55 fps en media/baja (844×390, dpr 2,75, CPU ×4). Hoy, en peloteo: baja 31-39 llamadas /
  81-113 k triángulos, media 40-58 / 190-250 k. Cada atleta = 1 SkinnedMesh (1 dibujo + 1 de sombra), alta ~11 k, media
  ~4,8 k, baja ~3,8 k triángulos; `Players.update` ≈ 0,40 ms/frame para 4 atletas.

---

## 1. Modo 6v6

### 1.1 Modelo de datos (sim.js)

`createGame(opts)` acepta `opts.format = '2v2' | '6v6'` (por defecto `'2v2'`, comportamiento actual byte a byte).

Estado nuevo en `game` (solo con `format === '6v6'`, el resto de campos siguen igual):

| campo | descripción |
|---|---|
| `format` | `'2v2'` \| `'6v6'` |
| `size` | jugadores en pista por equipo (2 o 6). Todo bucle `< 4` pasa a `< g.players.length` |
| `teams[t]` | los 6 EN PISTA (orden fijo de índice, no de zona) |
| `roster[t]` | plantilla completa (12-14): en pista + banquillo. Los del banquillo no se simulan (`p.bench = true`) |
| `rot[t]` | array de 6 referencias indexado por zona − 1: `rot[t][0]` = zona 1 (sacador), `[1]` = zona 2 … `[5]` = zona 6 |
| `libero[t]` | jugador líbero (o null) y `liberoFor[t]`: el central al que sustituye ahora |
| `subs[t]`, `timeouts[t]` | cambios (6/set) y tiempos muertos (2/set) restantes |
| `setPlan[t]` | decisión del colocador en curso `{to: jugador, tempo: 'high'\|'shoot'\|'quick'\|'pipe', x, y}` |

Campos nuevos del jugador (`mkPlayer`): `role` (`'S'` colocador, `'OPP'` opuesto, `'MB'` central, `'OH'` receptor/punta,
`'L'` líbero), `zone` (1-6, se recalcula en cada rotación), `front` (bool: zonas 2-3-4), `st` (estadísticas, §2),
`toX` (x del despegue del último salto, para la falta de ataque de zaguero), `name` (Carrera). `id` pasa a
`team * 16 + idx` (en 2v2 sigue siendo `team * 2 + idx`: `idBase = g.size === 2 ? 2 : 16`). Los `.id` se usan como clave en
players.js (`byId`), audio.js, input.js y ui.js: ninguno asume que sean contiguos salvo `byId` (array disperso: vale).

`other(g, p)` se mantiene para 2v2. Se añaden helpers puros:

```js
function mates(g, p)          // compañeros en pista (array cacheado por equipo, sin asignar por frame)
function nearestMate(g, p, x, y)
function zoneOf(g, p)         // 1..6 (rot[t].indexOf(p) + 1)
function zonePos(t, zone, out)// punto base de la zona en coords de sim (tabla ZONE abajo)
function isFront(g, p)        // zona 2, 3 o 4
```

Lateral relativo al equipo: el equipo 0 mira hacia `-x` y su derecha es `+y` (CONTRACT §3); el equipo 1 mira a `+x` y su
derecha es `-y`. Con `yl` = lateral local (+ = derecha del equipo) y `d` = distancia a la red: `x = side(t) * d`, `y = side(t) * yl`.

```js
// zonas reglamentarias (d = metros desde la red, yl = lateral local, + = derecha)
var ZONE = [null, {d: 7.5, yl: 3}, {d: 1.5, yl: 3}, {d: 1.5, yl: 0}, {d: 1.5, yl: -3}, {d: 7.5, yl: -3}, {d: 7.5, yl: 0}];
```

### 1.2 Rotaciones y sistema 5-1

- **Rotación**: `rotate(g, t)` desplaza `rot[t]` una posición en sentido horario (el de zona 2 pasa a zona 1 y saca). Se llama
  en `point()` donde hoy está `g.serverIdx[w] = (g.serverIdx[w] + 1) % 2` (l. 1103) cuando `g.size === 6`. El sacador del
  6v6 es siempre `rot[t][0]`; `serverIdx` queda solo para 2v2. `nextSet` reinicia la rotación inicial del set (alineación
  `lineup[t]`, la que eligió el entrenador/Carrera) y el saque alterno ya existente.
- **Alineación por defecto 5-1** (orden de rotación partiendo de zona 1): S, OH1, MB1, OPP, OH2, MB2. Así colocador y opuesto
  están siempre enfrentados, y cada pareja (OH, MB) también.
- **Líbero**: entra automáticamente por el central que está en zona de zagueros (5, 6, 1), salvo cuando ese central saca (regla
  FIVB: el líbero no saca; el central saca y sale al perder el saque). Implementación: en `setupServe` y tras `rotate`,
  `liberoSwap(g, t)` intercambia la referencia en `rot[t]`/`teams[t]` con `roster[t]` (el que sale queda `bench = true`). Evento
  nuevo `{type:'libero', team, inP, outP}` (UI: aviso pequeño; players.js: teletransporte con fundido, o paseo por la zona de cambio
  del líbero si sobra tiempo de pausa). Sin contar como cambio.
- **Formaciones** (tablas de datos en `js/ai6.js`, ver 1.4): por rotación (1-6) y fase:
  - `RECV[rot]`: recepción en «W» con 3 receptores (OH1, OH2, L), colocador escondido junto a la red o detrás de su delantero,
    opuesto y central delantero pegados a la red, preparados para atacar. 6 rotaciones × 6 puntos `{d, yl}`.
  - `SERVE[rot]`: equipo que saca: todos en su zona base legal y, nada más golpear el sacador, al «cambio» de especialistas.
  - `BASE`: tras el saque cada uno se va a su puesto de especialidad: delanteros S/OPP en zona 2, MB en 3, OH en 4; zagueros
    OPP/S en 1, L en 5 (o 6), OH en 6 (según sistema; v1: L en 5, OH zaguero en 6, S/OPP zaguero en 1).
- **Falta de posición** (reglamento 7.4-7.5, solapamiento en el momento del saque): `checkOverlap(g, t)` en `doServe` (l. 1417)
  compara cada par adelante/atrás y derecha/izquierda con la regla del pie más cercano. La IA nunca la comete (sale de la
  tabla). Para el humano: en Fácil/Normal `setupServe` le coloca y un «imán» suave le impide solaparse hasta el golpe de saque;
  en Difícil/Experto puede cometerla: `fault(g, 1 - t, 'rotation', 'Falta de posición', p, 'pos')`.

### 1.3 Reglas nuevas (sim.js, encima del motor actual)

Se mantienen tal cual: 3 toques, dobles (texto «Dobles»), red, antena, invasión, bloqueo geométrico (`checkBlock` ya es por
jugador), contacto con el cuerpo, 8 s de saque («Falta de saque: 8 segundos»), challenge y error arbitral.

| regla | dónde | detalle |
|---|---|---|
| Ataque de zaguero | `hit()`, con `isAttackContact(p, b)` | zaguero (`!p.front`) que completa un ataque con el balón entero por encima de la red habiendo despegado delante de la línea de 3 m (`|p.toX| < C.ATTACK`, se guarda en `jump()`) → `fault(…, 'backAttack', 'Ataque de zaguero')`. Como `atkServe`, solo es falta si el balón cruza la red o lo toca el rival |
| Bloqueo de zaguero | `checkBlock` | zaguero o líbero que participa en un bloqueo con contacto → `'Bloqueo de zaguero'` / `'Bloqueo del líbero'` |
| Líbero | `hit()`, `doServe`, IA | no saca, no bloquea, no ataca por encima de la red; si coloca de dedos DELANTE de la línea de 3 m, el atacante no puede rematar por encima de la red (`g.liberoSet = true` hasta el siguiente toque) |
| Falta de posición | `doServe` | §1.2 |
| Tiempos muertos | `step` en `'point'` | 2/set; la CPU pide uno con racha rival ≥ 3 (`g.streakN`) o al llegar el rival a 21. Pausa de 30 s acortada a ~6 s de presentación (cámara de banquillo), saltable con `skipHold` |
| Cambios | v2 (Carrera) | 6/set, cambio de vuelta en la misma posición; v1 sin cambios salvo el líbero |

Los textos nuevos se añaden a `outText`/`fault` en castellano y con el vocabulario del árbitro (Ferran los revisa).

### 1.4 IA de posiciones (nuevo `js/ai6.js`, propietario sim)

CONTRACT §1 exige pasar por `notes/ui_main.md` para un JS nuevo (index.html carga la lista fija; orden: después de `ai.js`).
Se separa porque `ai.js` está afinado y medido para 2v2 (notes/sim.md R6): mezclar las dos lógicas con `if` lo volvería
inmantenible y arriesgaría la regresión. Se REUTILIZA `AI.update` (movimiento, salto, timing aleatorio, plancha, toque
desviado), que solo cambia en tres puntos de despacho:

```js
// ai.js
var J = g.size === 6 && VB.AI6 ? VB.AI6 : null;
g.jobs[t] = J ? J.computeJob(g, t) : computeJob(g, t);   // (en sim.step)
var tg = J ? J.pos(g, p) : pos(g, p);                     // (en update)
// y en la decisión del toque: J ? J.decide(g, p, w) : (código actual)
```

`VB.AI6 = { computeJob, pos, decide, chooseAttacker, blockPlan, FORM }`:

- **`computeJob(g, t)`** (quién va al balón), por número de toque:
  - 1.er toque (recepción/defensa): coste = `AI.timeTo(g, p, pr1.x, pr1.y)` + penalización de rol: colocador +0,35 s (que
    no reciba si hay otro), central delantero +0,25 s, líbero −0,10 s, OH receptor −0,05 s; con la histéresis y la «memoria
    por trayectoria» de `computeJob` actual (`jobMem`, `jobSwT`, `jobHop`), generalizada de 2 a N candidatos (mejor y segundo).
  - 2.º toque: el colocador si no hizo el 1.º y llega (`timeTo < pr3.t + 0.1`); si no, el líbero (colocación de dedos con la
    regla de 3 m) y si no, el opuesto o el más cercano («colocador de emergencia»: siempre bola alta a zona 4).
  - 3.er toque: el elegido por `chooseAttacker` en el momento del 2.º toque (`g.setPlan[t].to`).
- **`chooseAttacker(g, t)`** (el colocador decide al tocar): opciones válidas según rotación (delanteros OH, MB, OPP; zagueros
  OH/OPP en «pipe» desde detrás de 3 m). Peso = calidad de la recepción (`grade` del 1.er toque: `poor` → solo bola alta a
  punta u opuesto), estadística de ataque del atacante, bloqueadores rivales delante (su `y` frente al destino) y un poco de
  azar según `aimNoise` del colocador. Devuelve `{to, tempo, x, y}`:
  - `high` (bola alta a punta): `launchApex` con ápice 3,8-4,2 m en `yl = -3.6, d = 0.8`;
  - `shoot` (tensa al opuesto): ápice 3,0 m en `yl = +3.6`;
  - `quick` (rápida del central, 1.er tiempo): ápice 2,85 m a 0,8-1,2 m del colocador; el central salta ANTES del toque de
    colocación (salto programado como el de la IA actual con `pr3`, pero con la predicción del destino planificado);
  - `pipe`: ápice 3,4 m en `d = 3.6, yl = 0`, atacante zaguero despegando detrás de la línea.
  El colocador también puede **atacar de segunda** (dejada a 2.º toque) si es delantero: prob. `tip × 0.5` con el bloqueo rival
  abierto. Con humano colocador, ver 1.5.
- **`pos(g, p)`** (dónde estar): tabla de fases → `setTg(x, y, attack, block)` como ahora.
  - Recepción: `FORM.RECV[rotación][zona]`. Saque propio: `FORM.SERVE` y al golpear, `BASE`.
  - Ataque propio (balón en nuestro campo): atacantes a su punto de batida (`d = 3.5-4`, en su carril), colocador a
    «penetración» (`d = 0.6, yl = +1.0`), el resto a **cobertura** en semicírculo de 1,5-2 m alrededor del atacante elegido.
  - Ataque rival: `blockPlan(g, t)` reparte los 3 delanteros. v1: bloqueo «de zona» (cada delantero frente a su carril) + el
    central sigue la colocación con retardo `blockReact + (1 - st.block) * 0.15` (bloqueo de lectura); doble bloqueo en las
    puntas si el central llega, triple ocasional en bola alta. `g.blockOff` pasa a ser por jugador (`p.blockOff`).
    Zagueros a la defensa «perímetro»: tabla `FORM.DEF[zonaDeAtaque]` (4, 3, 2, pipe) con el líbero en 5 o 6 y la línea
    cubierta según dónde cierra el bloqueo (la idea de «defensor algo a la diagonal» de `pos` actual, en 3 jugadores).
  - Transición: tras defender, los delanteros se abren a la línea de 3 m para tener carrera de batida.
- **`decide(g, p, w)`** (qué hace con el balón): 1.er toque → al punto de colocación (`d = 0.8, yl = +0.8`, «zona 2,5»), con error
  según `st.recv`/`st.dig`; 2.º → `chooseAttacker`; 3.º → la lógica actual de remate/dejada (`openSpot` con N defensores
  y lectura del bloqueo). `openSpot` y `serveTarget` se generalizan a N rivales (bucle sobre `g.teams[1 - t]`, sin asignar).

Coste de CPU: `AI.update` corre a 120 Hz por jugador; con 11 jugadores IA la función pesa poco (sin asignaciones; `pos` es
aritmética con tablas). Objetivo medido con simtest: ≤ 0,6 ms de sim por frame de 60 Hz en el PC (×4 en móvil emulado → ≤ 2,4 ms).

### 1.5 Control de un solo jugador en 6v6

En 6v6 el control es siempre «Uno» (cambiar de jugador sería poco habitual). Se elige **posición**, no dorsal:
`createGame({format:'6v6', ctrl:'one', ctrlRole:'OH'|'S'|'OPP'|'MB'|'L'})`, ajuste `ctx.settings.ctrlRole6` (main.js lo pasa).
`g.ctrl` = el jugador de ese rol (OH1 si hay dos). El `ctrlIdx` del contrato del sprint sigue sirviendo para el 2v2.

- **v1: solo Receptor (OH)**: recibe, defiende, ataca, bloquea y saca; está siempre en pista. Colocador en v2 (S3).
  **Central y líbero no en v1**: el central pasa 3 rotaciones en el banquillo (sustituido por el líbero) y el líbero nunca
  ataca. Cuando el humano está fuera de pista (Carrera, como suplente o central): cámara TV (`courtShot`/`reviewShot` ya
  existen) y botón «Avanzar» que acelera la sim (`ctx.timeScale` a ×3, ya lo gestiona camera.js) hasta que vuelve a entrar.
- **Quién toca**: `AI6.computeJob` trata al humano como un candidato más, pero con dos reglas: (1) si el balón cae en su
  «área de responsabilidad» (celda de la formación, ±1,5 m) es suyo aunque un compañero llegue algo antes (sesgo como el
  `bias` actual de 0,12 s, aquí 0,25 s); (2) si el humano está pulsando GOLPEAR cerca del balón, se lo queda («¡mía!»). Si no
  va, la IA juega y no hay cambio de control. Evento `switch` desaparece en 6v6.
- **Ayudas** (Ajustes · Juego, por defecto activas en Fácil/Normal):
  - **Posición asistida**: sin entrada de stick, el humano se desliza a su `AI6.pos` (reutiliza `assistMove`, l. 1334).
  - **Marca de posición**: aro en el suelo en su punto táctico (players.js ya tiene el `marker`; o FX con la misma textura del aro
    de recepción), visible solo cuando está a más de 1,2 m.
  - **«¡Pídela!»**: el botón de cambiar jugador (⇄ / tecla de cambio / LB) se reutiliza en 6v6: durante nuestra recepción sube el
    peso del humano en `chooseAttacker` (×2,5) y muestra un bocadillo «¡Aquí!». Texto de controles y tutorial adaptados.
- **Saque**: cuando `rot[0][0] === g.ctrl` saca el humano con el flujo actual (`stepServe`, ritual solo CPU); si no, saca la IA.
- **Colocador humano (v2)**: al tocar de 2.º, la dirección del stick elige el destino (izquierda → punta, adelante → rápida,
  derecha → opuesto, atrás → pipe; sin dirección → lo que elegiría la IA) y el timing da la calidad de la colocación (ápice y
  precisión), como el remate apuntado. Retícula: la diana de `g.aim3` reutilizada con el radio de la dispersión.
- Métrica de diversión a vigilar (simtest con bot): toques del humano por rally ≥ 0,7 como OH; si baja, subir el sesgo de responsabilidad.

### 1.6 Cámara (camera.js, propietario camera_input)

- Sustituir los bucles `< 4` por `g.players.length` y `mateOf(g)` por «el compañero más cercano entre cámara y jugador» (para
  `mateLo`/`mateUp`, la oclusión del compañero). Con 6 compañeros, la oclusión mira solo los 2 más cercanos al eje cámara-jugador.
- `gameplayShot`: más campo de visión por defecto (`fovFor` con margen para ver la red entera y al colocador); detrás del humano
  a mayor distancia en recepción (ver su zona y el saque), y el empuje actual hacia la red en ataque.
- `groupCenter`, `pickHero`, `planPoint`, `clinch*`: con 12 jugadores, el «grupo» es solo el equipo que celebra; héroe = autor
  del punto (ya viene en el evento `point`).
- Planos nuevos: `bench` (tiempo muerto / líbero / humano fuera de pista) y `tv` alta lateral para «Avanzar».

### 1.7 Atletas, arena y FX con 12 jugadores

- **players.js**: `onGameStart` ya construye un rig por jugador. Cambios: «el compañero» de celebraciones y miradas pasa a
  `nearestMate`; celebración de equipo en corro (6 rigs hacia un punto común); camiseta de **líbero** de color contrastado
  (`setKit` deriva una cuarta equipación: base = acento del equipo o el complementario, y valida contra la del rival como hace
  ya con la CPU); animaciones nuevas: carrera de batida de 3 pasos, salto de colocación, desplazamiento lateral de bloqueo
  (paso cruzado), postura de cobertura, rápida del central (brazo antes del toque).
- **arena.js**: banquillos con suplentes (impostores del atlas del público, 0-1 dibujos), 4 jueces de línea en las esquinas
  solo en competiciones «altas» (enlaza con §3.5), marcador colgado con la rotación (opcional).
- **ui.js**: marcador con el sacador por dorsal, indicador de rotación (mini pista 6 puntos, solo en escritorio/pausa), panel de
  estadísticas por jugador al final (ya existe `stats.p`); menú: fila «Formato: 2 contra 2 / 6 contra 6» y, en 6v6, la fila
  de control muestra la posición («Receptor», luego «Colocador»…). Debe caber a 844×390.

### 1.8 Rendimiento con 12 atletas + público

Coste añadido por 8 atletas más (mediciones de notes/players.md):

| calidad | dibujos atletas (cuerpo + sombra) | triángulos atletas | contornos cartoon |
|---|---|---|---|
| alta | +16 | +88 k (8 × 11 k) | +8 |
| media | +16 | +38 k (8 × 4,8 k) | +8 |
| baja | +8 (sin sombra de los lejanos) | +30 k (8 × 3,8 k) | 0 (desactivados en baja) |

Baja quedaría en ~47-55 llamadas y ~115-145 k triángulos: dentro de 60 / 150 k, pero justo. Medidas, por orden:
1. **LOD por distancia** en players.js: atletas del equipo rival y los que estén a > 14 m de la cámara usan el nivel inferior
   (el mecanismo `screenLod`/`lodFrac` ya existe; aquí al revés: bajar, no subir).
2. **Sombras**: en media/baja, `castShadow` solo para los 4-6 atletas más cercanos a la cámara; el resto, mancha de sombra en el
   suelo en un `InstancedMesh` de FX (1 dibujo para todos).
3. **Público**: con 6v6, `crowdDensity` media 0,7 → 0,6 y baja 0,4 → 0,3 (arena `setQuality`); en la calidad adaptativa,
   `ctx.quality` sigue siendo la fuente.
4. `Players.update` (0,40 ms con 4) → ~1,2 ms con 12: animación procedural de los lejanos a 30 Hz (frame par/impar) si hace falta.
Escena de prueba nueva `?debug=rally6` (ui_main) para `tools/perf.js 844x390 20 medium,low 4 2.75` y `tools/shot.js rally6`.

---

## 2. Estadísticas de jugador

### 2.1 Atributos

Escala 1-99 (`p.st`), con normalización `s(k) = (st[k] - 1) / 98`:

| atributo | clave | qué mueve |
|---|---|---|
| Altura | `h` (cm, 175-215, fijo) | alcance de remate/bloqueo y altura de contacto |
| Salto | `jump` | `vz` inicial del salto |
| Velocidad | `speed` | carrera y plancha |
| Reacción | `react` | retardo de lectura tras cada toque |
| Recepción | `recv` | saque recibido: calidad y fallo |
| Defensa | `dig` | defensa de remate, alcance de plancha |
| Colocación | `set` | precisión del 2.º toque, tempos disponibles |
| Ataque | `spike` | velocidad del remate |
| Control | `ctl` | dispersión del remate, error no forzado, lectura del bloqueo, dejadas |
| Bloqueo | `block` | prob. de cerrar, tamaño de manos, reacción del bloqueo |
| Saque | `serve` | potencia, error, prob. de saque en salto, baile del flotante |

Valoración global por rol `ovr(p)` = media ponderada (tabla `VB.ROLE_W`: p. ej. OH recv 0,22 / spike 0,2 / dig 0,15…;
MB block 0,3 / spike 0,2 / jump 0,15; S set 0,45; L recv 0,4 / dig 0,4).

### 2.2 Cómo entran en la sim (sim.js)

Una sola función nueva que mezcla el perfil del equipo (nivel de dificultad) con las estadísticas del jugador; TODOS los
`g.prof[p.team]` / `g.prof[t]` de sim.js y ai.js que se refieren a un jugador pasan a `profOf(g, p)`:

```js
function profOf(g, p) { return p.prof || g.prof[p.team]; }   // 2v2 sin estadísticas: idéntico a hoy
function statProf(base, st) {                                 // se calcula una vez en createGame (y al cambiar st)
  return {
    speed: base.speed * (0.9 + 0.2 * s(st.speed)),
    react: base.react + 0.10 * (0.5 - s(st.react)),
    timing: base.timing * (1.25 - 0.5 * s(st.ctl)),
    recv: clamp(base.recv + 0.12 * (s(st.recv) - 0.5), 0.4, 0.98),
    dig: clamp(base.dig + 0.2 * (s(st.dig) - 0.5), 0.1, 0.8),
    block: clamp(base.block + 0.25 * (s(st.block) - 0.5), 0.05, 0.75),
    spike: base.spike + 4 * (s(st.spike) - 0.5),
    atkErr: base.atkErr * (1.4 - 0.8 * s(st.ctl)),
    jserve: base.jserve + 3.5 * (s(st.serve) - 0.5),
    srvErr: base.srvErr * (1.4 - 0.8 * s(st.serve)),
    jumpServe: clamp(base.jumpServe + 0.5 * (s(st.serve) - 0.6), 0, 0.9),
    /* … resto de campos copiados de base */ };
}
```

Física por jugador (pequeña, para que se vea en pantalla sin romper el timing):
- `jump()` (l. 1209): `p.vz = C.JUMP_V * p.jk`, con `p.jk = 0.92 + 0.16 * s(st.jump)` (~±8 % de altura de vuelo).
- Alcance vertical: `blockTop(qb)` y la altura ideal de contacto de remate (`C.ZC.spike`) suman `(h - 195) / 100 * 0.9`.
  players.js escala el rig con la altura (ya hay escala por rig; las proporciones cartoon del sprint actual se respetan).
- `canReach` / `canDive`: `C.REACH` y `C.DIVE` × `(0.95 + 0.1 * s(st.dig))` en defensa.

**Humano**: la habilidad del jugador (timing) sigue mandando, las estadísticas solo inclinan: ventanas `W_PERFECT`/`W_GOOD`
× `(0.88 + 0.24 * s(stat del toque))` (recepción → `recv`, colocación → `set`, remate → `ctl`), velocidad de remate con
`spike`, `spikeSpread(q)` × `(1.2 - 0.4 * s(ctl))`, altura de salto con `jump`, carrera con `speed`. Con estadísticas bajas
el jugador de Carrera se siente torpe pero jugable (ventana perfecta 0,031 s frente a 0,035 de hoy en el peor caso).

Pruebas (tools/simtest.js, propietario sim): (a) 2v2 sin estadísticas = resultados idénticos a la versión anterior con las
mismas semillas (huella de `g.stats` por semilla); (b) monotonía: equipo con +15 en todo gana ≥ 60 % de los puntos a igualdad
de nivel en 200 partidos CPU contra CPU; (c) cada atributo mueve su métrica (recepción → % de recepción perfecta, etc.).

---

## 3. Modo Carrera

### 3.1 Bucle de juego

Un jugador modesto (OVR ~38) se inscribe en un club de liga baja, juega partidos 6v6 controlando solo a su jugador, gana
experiencia y estadísticas, recibe ofertas de equipos mejores y, si «pasa el corte», es convocado por la selección para la
Liga de Naciones y los Juegos. El nombre del juego («Make the Cut») ES este modo.

Temporada = pretemporada (entrenamiento + elegir oferta) → liga regular → fase final → verano (selección, si convocado).

### 3.2 Estructura (datos procedurales y ficticios)

Clubes, ciudades y jugadores **inventados** (generados con semilla; sin clubes ni personas reales). Para las competiciones
de selecciones se usan nombres genéricos («Liga de Naciones», «Juegos Olímpicos» → mejor «Juegos» o «Torneo Olímpico» en el
texto visible si algún día se vende; ver la nota de marcas del TRASPASO).

| nivel | competición (ficticia) | equipos | OVR medio rival | ref (§3.5) | sede |
|---|---|---|---|---|---|
| 1 | Liga Regional | 8 | 35-45 | baja | pabellón pequeño, poco público |
| 2 | Primera Nacional | 8 | 45-55 | media | |
| 3 | Superliga 2 | 10 | 55-63 | media | |
| 4 | Superliga | 10 | 62-70 | alta | jueces de línea |
| 5 | Liga Élite (extranjera) | 10 | 70-80 | muy alta | pabellón grande, challenge |
| S1 | Liga de Naciones (selección) | 16 → final a 8 | 72-85 | muy alta | |
| S2 | Torneo Olímpico (cada 4 temporadas) | 12 | 78-90 | olímpica | |

Liga a una vuelta (7-9 jornadas) + final a 4 para no eternizar la temporada. Los partidos en los que no juega el humano se
resuelven con `quickSim` (§3.4).

### 3.3 Jugador, progresión y ofertas

- **Creación**: nombre, dorsal (1-99), posición (v1: Receptor; v2: todas), altura (175-205 según posición), mano (cosmética).
  Estadísticas iniciales 30-45 con un «potencial» oculto 70-92.
- **Experiencia por partido**: valoración 0-10 a partir de `ui.js stats.p[id]` ampliado (kills, aces, bloqueos, recepciones
  perfectas/fallidas, errores, `grade` de los toques del humano) → XP. La XP se reparte en los atributos que el jugador usa
  (aprendizaje por uso: recibir mucho sube `recv`) + puntos libres.
- **Entrenamiento semanal**: entre jornadas, elegir foco (salto, ataque, recepción, saque, bloqueo, físico) → +XP en ese
  grupo; opcional: minijuego de entrenamiento con la escena `toss`/`jumpserve` existente (sacar a dianas) para bonificar.
- **Curva de edad**: 18-24 mejora rápida, 25-30 meseta, 31+ baja `speed`/`jump`. Retirada a elección a partir de 33.
- **Rol en el club**: titular si su OVR ≥ el del titular de su puesto − 2; si no, suplente (entra en tramos de set o en sets
  perdidos; fuera de pista: «Avanzar», §1.5). La confianza del entrenador (0-100) sube con buenas valoraciones.
- **Ofertas**: al final de la temporada (y una ventana a mitad): cada club de nivel L ≥ actual evalúa
  `interés = OVR + 0,8 × valoración media − umbral(L) + ruido`; con interés > 0 ofrece `{club, nivel, rol prometido, años}`
  (sueldo solo cosmético). El jugador acepta una o se queda. Nunca más de 3 ofertas a la vez.
- **Selección**: convocatoria si OVR ≥ 68 y juega en nivel ≥ 4 como titular, o valoración media ≥ 7,5 en nivel ≥ 3 → Liga de
  Naciones en verano. Torneo Olímpico en las temporadas `n % 4 === 3` si fue convocado ese año. Palmarés en el perfil.

### 3.4 Implementación

- **`js/career.js`** (nuevo, puro como sim.js: sin DOM ni THREE, cargable en node; propietario a decidir: sim o un
  especialista nuevo «career»; añadir en index.html vía notes/ui_main.md). API:
  `VB.Career = { newCareer(opts), load(), save(c), nextEvent(c), matchOpts(c) → opts de Sim.createGame, applyResult(c, stats),
  quickSim(teamA, teamB, rng) → {sets, setScores}, offers(c), accept(c, i), train(c, focus), standings(c, comp) }`.
- **`quickSim`**: punto a punto Bernoulli con `pSideout = 0.62 + 0.004 × (OVRrecibe − OVRsaca)` (acotado 0,5-0,75),
  sets a 25 y 15. Sin coste de render; una temporada entera se resuelve en milisegundos.
- **Partido de Carrera**: `matchOpts(c)` → `Sim.createGame({format:'6v6', ctrl:'one', ctrlRole, teams:[datos], ref:REF[nivel],
  points:25, seed})` con los rosters y `st` de cada jugador; main.js arranca el partido igual que el rápido y, en `gameOver`,
  `VB.Career.applyResult`.
- **Guardado**: `localStorage['mtc.career']` con `{v: 1, seed, season, week, player:{name,num,role,h,age,st,pot,xp,conf},
  club, comps:[…], history:[…], offers:[…]}` (solo datos; los clubes y jugadores rivales se regeneran desde `seed` + cambios
  guardados como diferencias). Siempre en try/catch; si `localStorage` falla (incógnito), aviso «La carrera no se podrá
  guardar en este navegador» y se juega igual. Campo `v` para migraciones.
- **UI (ui.js / index.html)**: entrada «Carrera» en el menú junto a «Partido rápido»; pantalla central de Carrera (próximo
  partido, clasificación, jugador, entrenamiento, ofertas, palmarés) en paneles de estilo cómic del sprint cartoon; debe caber
  en 844×390 (pestañas horizontales, una columna).

### 3.5 Error arbitral y challenge por competición (tabla del TRASPASO, concretada)

Hoy: `VB.REF_ERR = {d1: 0.02, p1: 0.35, d2: 0.05, p2: 0.15, d3: 0.10, p3: 0.05}` (prob. de cantar al revés según la distancia
del bote a la línea) y `VB.CHAL = {perSet: 2, …}`. Se añade `createGame({ref})` → `g.ref` y `refErrP(dist)` (l. 976) pasa a
leer `g.ref || REF_ERR`; `canChallenge` devuelve 0 si `g.ref.chal === 0` (la UI ya oculta el botón sin challenges).

| competición | `p1` (≤ 2 cm) | `p2` (≤ 5 cm) | `p3` (≤ `d3`) | `d3` | challenge/set | jueces de línea | nota |
|---|---|---|---|---|---|---|---|
| Partido rápido | 0,35 | 0,15 | 0,05 | 0,10 | 2 | no | el actual, sin cambios |
| Ligas bajas (1) | 0,55 | 0,40 | 0,22 | 0,25 | 0 | no | se nota jugando: errores sin remedio |
| Ligas medias (2-3) | 0,45 | 0,25 | 0,12 | 0,15 | 0 | no | |
| Ligas altas (4) | 0,20 | 0,08 | 0,02 | 0,10 | 0 | sí (4) | los jueces de línea reducen el error |
| Ligas muy altas (5, Liga de Naciones) | 0,20 | 0,08 | 0,02 | 0,10 | 2 | sí | el challenge corrige |
| Olímpicas | 0,05 | 0,01 | 0 | 0,05 | 2 | sí | casi nunca hace falta |

Objetivo de afinado (simtest con piloto, como el de TRASPASO: hoy 1 mal cantado en 30 partidos): ligas bajas ≥ 1 error visible
por partido de 3 sets; olímpicas < 1 cada 20 partidos. La revisión en vídeo (`reviewShot`) solo existe donde hay challenge.

---

## 4. Plan por sprints

Estimación relativa en puntos (1 = un arreglo pequeño; el sprint de remate apuntado + challenge ≈ 8). Cada sprint deja el
juego publicable y con todas las pruebas en verde (`simtest` TODO OK, `console.sh all` sin errores, `perf.js` «objetivos cumplidos»).

| # | sprint | contenido | módulos | puntos | depende de |
|---|---|---|---|---|---|
| 1 | Sim a N jugadores — **HECHO 10-nov-2026** | bucles `< 4` → `players.length`, `mates/nearestMate`, `id` con base, `rot` y `size`, `profOf` (sin estadísticas aún); camera.js y players.js sin el «compañero» fijo. 2v2 idéntico | sim, camera_input, players | 5 | — |
| 2 | 6v6 jugable (CPU contra CPU) — **HECHO 10-nov-2026** (espectador con `?format=6v6`; sin demo del menú en 6v6) | `format:'6v6'`, rotaciones, líbero, formaciones, reglas de zaguero/posición, `ai6.js` v1 (recepción → colocador → bola alta/opuesto, bloqueo de zona, defensa perímetro), 12 rigs, `?debug=rally6`, demo del menú opcional en 6v6 | sim, players, ui_main, camera_input | 13 | 1 |
| 3 | 6v6 con humano (Receptor) | control Uno por rol, responsabilidad/«¡mía!», posición asistida, marca de posición, «¡Pídela!», cámara de 6v6, menú «Formato», tutorial y controles en 6v6 | sim, camera_input, ui_main, players | 8 | 2 |
| 4 | Rendimiento y arte de 12 atletas — **PARCIAL** (adelantado en el sprint 2: LOD lejano, sombras parciales, líbero con camiseta; falta baja ≤ 35 llamadas, banquillos, público) | LOD por distancia, sombras parciales + manchas instanciadas, densidad de público, contornos cartoon por calidad, líbero con camiseta propia, banquillos | players, arena, ui_main | 5 | 2 (y el sprint cartoon) |
| 5 | IA de equipo avanzada | tempos (rápida, tensa, pipe), ataque de segunda, bloqueo de lectura y doble/triple, cobertura, transición, tiempos muertos de la CPU, colocador humano | sim, players (animaciones), camera_input | 8 | 3 |
| 6 | Estadísticas + árbitro por competición | `p.st`, `statProf`, física por jugador, ventanas del humano, pruebas de monotonía, `g.ref` y tabla §3.5, jueces de línea en arena | sim, arena, players | 5 | 1 (mejor tras 3) |
| 7 | Carrera: núcleo | `career.js`, creación de jugador, liga regional + calendario, `quickSim`, guardado, pantalla de Carrera, jugar jornada, valoración y XP | nuevo career, ui_main, sim | 13 | 3, 6 |
| 8 | Carrera: progresión y mercado | entrenamiento, edad, titular/suplente y «Avanzar», ofertas y fichajes, niveles 2-5, sedes por nivel (`VB.Arena.setVenue({size, crowd, linesmen})`) | career, ui_main, arena, camera_input | 8 | 7 |
| 9 | Carrera: selección | convocatoria, Liga de Naciones, Torneo Olímpico, palmarés, otras posiciones jugables (colocador, opuesto; central/líbero con «Avanzar») | career, ui_main, sim | 8 | 5, 8 |

**Estado (10-nov-2026, tras la revisión del sprint 2)**: sprints 1 y 2 hechos y revisados (2v2 idéntico: huella de 150 partidas en
simtest y diferencial estado a estado contra el código de antes). Objetivos medibles del riesgo 3, todos en simtest: side-out ~63 %,
mediana del rally 5-6,5 s, 0 faltas de posición/zaguero de la IA, líbero bien, colocador ~85-88 % de 2.os toques. Riesgo 2: perf.js
con `EXTRA=format=6v6` cumple con un tope provisional de 45 llamadas en baja (2v2 sigue en 35), pendiente de ratificar o de la malla
única del sprint 4. Lo que falta para el sprint 3 está en TRASPASO («Modo 6v6»).

**Orden recomendado**: 1 → 2 → 3 → 4 → 6 → 7 → 5 → 8 → 9. Se adelanta Carrera (7) a la IA avanzada (5) porque es lo que más
ilusión le hace a Ferran y la IA v1 basta para jugarla; 4 va pronto porque el móvil es el primer sitio donde el 6v6 puede
fallar. 6 y 4 son independientes y pueden ir en paralelo (propietarios distintos).

**Riesgos y mitigación**

1. **Regresión del 2v2** (el riesgo mayor del sprint 1): todo lo nuevo detrás de `g.size === 6` / `p.prof`; simtest guarda la
   huella de 50 semillas antes del refactor y exige igualdad exacta después. Nada de reordenar llamadas a `g.rng`.
2. **Rendimiento en móvil** con 12 atletas + público + contornos: medir con `perf.js` al final del sprint 2 (antes de pulir)
   y aplicar §1.8 por orden; si baja no cumple, en baja 6v6 los 6 rivales usan siempre la malla baja y sin contorno.
3. **Afinado de la IA de equipo**: es lo que más tiempo puede comer (el 2v2 necesitó varias revisiones, notes/sim.md R1-R6).
   Fijar objetivos medibles desde el principio en simtest: side-out 58-66 %, mediana del rally 5-8 s, 0 faltas de posición y de
   zaguero de la IA, el líbero nunca delante ni sacando, ≥ 70 % de 2.os toques del colocador.
4. **Aburrimiento con un solo jugador**: pocos toques por rally. Medir toques del humano por rally (objetivo ≥ 0,7 como
   receptor) y usar responsabilidad + «¡Pídela!»; dejar central/líbero para cuando exista «Avanzar».
5. **camera.js es grande (3,5 k líneas) y fino**: el sprint 1 solo cambia bucles y el compañero; los planos nuevos van en 3.
6. **Guardado frágil** (`localStorage` puede no existir o vaciarse): aviso claro; más adelante, exportar/importar la carrera
   como texto copiable en un panel (sin `prompt`).
7. **Nombres reales**: clubes, jugadores y competiciones ficticios; «Liga de Naciones» / «Juegos» como texto visible si algún
   día hay uso comercial.
8. **Gasto de tokens** (motivo de los sprints): los sprints 2 y 7 son los grandes; se pueden partir en dos mitades
   (2a: rotaciones + reglas + formaciones estáticas; 2b: `ai6.js` en juego).

**Interfaces que habrá que añadir al CONTRACT (§4) cuando se empiece**: `createGame({format, ctrlRole, teams, ref})`,
estado `g.size, g.rot, g.roster, g.libero, g.setPlan, g.ref`, jugador `role, zone, front, st, prof, name`, eventos
`libero`, `timeout`, `rotation` (con `team`, `rot` en dorsales), `VB.Sim.profOf/mates/zoneOf`, `VB.AI6`, `VB.Career`,
`VB.Arena.setVenue`, `ctx.settings.format`, `ctx.settings.ctrlRole6`.
