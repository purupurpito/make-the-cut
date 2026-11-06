# notes/sim.md — simulación, reglas, IA (owner: sim)

Ficheros: `js/sim.js`, `js/ai.js`, `tools/simtest.js`. Las interfaces de CONTRACT.md §4 siguen intactas;
todo lo de abajo son AÑADIDOS (campos/funciones/eventos opcionales). Fecha: 2026-11-06 (actualizado tras Review 2).

Verificación: `node tools/simtest.js` (20 min demo + matriz de 4 niveles × (IA + 3 bots), 30 min por casilla en
paralelo, ~45 s con 16 núcleos) → `TODO OK`. Rápido sin matriz: `node tools/simtest.js 10 12345 0`.
Herramientas de medida de la revisión 2 (no se suben): `tools/out/r2/balance.js` (balance multi-semilla),
`tools/out/r2/democmp.js` (estadísticas CPU vs CPU de dos versiones), `tools/out/r2/riskcal.js` (calibración del saque).

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
**8 segundos** y **balón que cae tras el lanzamiento** (`serve`), saque/balón a la red, balón en la cinta que pasa,
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
usa el perfil `hard` (el Normal anterior: peloteos largos y vistosos).
Bots que juegan SOLO con la entrada real, 3 semillas × 30 min por casilla, % de puntos del humano:

| bot | Fácil | Normal | Difícil | Experto |
|---|---|---|---|---|
| novato (σ 120 ms, no apunta, no bloquea) | 66 % | 39 % | 31 % | 20 % |
| medio (σ 65 ms, apunta al hueco 30 %) | 87 % | 60 % (~100 % partidos) | 51 % | 35 % |
| perfecto (σ 20 ms, apunta al hueco 60 %) | 94 % | 83 % | 71 % | 63 % |

CPU vs CPU (demo, 3 semillas × 20 min): 4,7-5,0 puntos/min, rally mediana 5,2-6,2 s, 43-46 % de remates son punto,
aces ~5-6 %. `createGame({rookie:true})`: la CPU saca más suave y el humano tiene la ayuda de timing de Fácil (solo
en Fácil/Normal).

## 2. Añadidos al estado (solo lectura para los demás)
- `g.difficulty` (`'easy'|'normal'|'hard'|'expert'`), `g.prof[team]`, **`g.tm`** (`{assist, swing, lock}` del humano).
- **`g.defRole`** (`''|'dig'|'block'`, ver arriba). **`g.recvRisk`** (dificultad del último saque para el receptor).
- **`g.blockBy`** (último jugador que bloqueó), **`g.courtSwap3`** (ya se cambió de campo a los 8 del 3.º).
- Saque, gesto, balón, jugador, `digMargin`, `jobMem...`, `lastLand`: sin cambios (ver CONTRACT §4.2).
- `p.shot` nuevo valor `'body'` (con `p.lastAction` = `'pass'|'set'|'free'` según el toque y `p.anim = 0,12`).
- `g.stats` (solo tests): `blockKinds.touch`, `body`, `courtChanges`.

## 3. Añadidos a eventos
- `hit`: `shot` nuevo **`'body'`** (contacto con el cuerpo sin gesto; `kind` según el toque, `grade:'poor'`).
- `block`: `result` nuevo **`'touch'`** (toque de bloqueo que sigue a su campo frenado; ni `stuff` ni `soft`).
- `switch`: `+ reason:'defense'` cuando el juego pasa el control al defensor al colocar la CPU (auto:true).
- **Nuevo** `courtChange {setNo, why:'set'|'eight', score:[a,b], sets:[a,b], pause (s)}`.
- `point.text`: "La CPU manda el balón fuera" sustituye a "Balón fuera de la CPU".

## 4. Funciones nuevas en `VB.Sim` / `VB`
- `VB.DIFF_ORDER`, `VB.TIMING` (= `VB.Sim.TIMING`).
- Internos para tests: `_inBlockVol(q, ball)`, `_serveRisk(g, team)`, `_recvFail(risk, prof)`, `_refreshPred(g)`.
- `VB.AI.openSpot(g, p, minDepth, out, atk)`: `atk` = remate (evita las manos del bloqueador rival).

## 5. Peticiones a otros propietarios (revisión 2)
Todas aplicadas en la integración tras Review 2 (ver el log). Pendiente para sim (peticiones de otros owners a sim.js):
- (ui_main) `point.text` de `reason:'out'`: la UI ya pinta su propio subtítulo de árbitro desde `lastKind`; si se quiere que el texto
  de sim sirva tal cual a cualquier consumidor: "Fuera" / "Remate fuera"… sin "de la CPU". Opcional.
- (ui_main) Detección de contacto con la antena en `stepBall` (balón que toca la antena sin cruzar) → `point.reason:'antenna'`,
  texto "Balón toca la antena". Hoy solo se pita el cruce por fuera.
- (arena, opcional) `Sim.aimPoint(g, out)` puro con el objetivo previsto del golpe humano para el input actual (mismas fórmulas que
  `doServe`/`attackTarget`); fx.js lo usa si existe y deja de duplicar las fórmulas.

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
