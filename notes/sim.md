# notes/sim.md — simulación, reglas, IA (owner: sim)

Ficheros: `js/sim.js`, `js/ai.js`, `tools/simtest.js`. Las interfaces de CONTRACT.md §4 siguen intactas;
todo lo de abajo son AÑADIDOS (campos/funciones/eventos opcionales). Fecha: 2026-11-07 (revisión 3, cierre de pendientes; R4: ronda de verificación de reglas).

Verificación: `node tools/simtest.js` (20 min demo + fuzz + matriz 4 niveles × (IA + 4 bots) × 4 semillas × 20 min,
en paralelo, ~70 s con 16 núcleos) → `TODO OK`. Rápido sin matriz: `node tools/simtest.js 10 12345 0`.
Afinado: `SIMTEST_ONLY=matrix MATRIX_FILTER='novato vs easy|medio vs normal' node tools/simtest.js 5 777 20 12`
(solo esas casillas, 12 semillas: ~1 200 puntos por casilla, ±1,4 puntos de %).

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
- §R5.5 (textos del árbitro): NO aplicado; queda como decisión de Ferran en TRASPASO «Sin comprobar o pendiente».
- Petición de camera_input (deprecaciones de mapa, para sim/players/integración): aplicada en sim.js con `dblFields(o)` (junto a `emit`): los campos
  enteros de `g`, `g.ball`, `g.pr1/pr3`, `g.rally`, cada jugador (`mkPlayer`) y cada evento pasan por un double al crearse. Misma semántica: la salida
  de `node tools/simtest.js 10 12345 0` es idéntica byte a byte a la de antes y la matriz del simtest completo también. Medido con el log de V8
  (`tools/out/camalloc/deopt3.js`): ya no hay deprecaciones de `step`/`stepServe`/`toss`/`doServe` sobre `g` en mitad del partido. Quedan las de los
  literales de EVENTO (`hit`, `block`, `point`, `land`: ~40-80 mapas por punto; sus mapas se recolectan y se rehacen), sin desoptimizaciones en masa asociadas.
- Comprobado: simtest completo TODO OK (novato Fácil 46,8 %, Normal 33,9 %; medio Normal 53,0 %, Fácil 74,2 %).
