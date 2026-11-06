# notes/sim.md — simulación, reglas, IA (owner: sim)

Ficheros: `js/sim.js`, `js/ai.js`, `tools/simtest.js`. Las interfaces de CONTRACT.md §4 siguen intactas;
todo lo de abajo son AÑADIDOS (campos/funciones/eventos opcionales). Fecha: 2026-11-06.

Verificación: `node tools/simtest.js` (20 min demo + matriz de 30 min por casilla en paralelo, ~1-2 min) → `TODO OK`.
Rápido sin matriz: `node tools/simtest.js 10 12345 0`.

## 1. Modelo de juego (lo que tiene que saber la UI/tutorial)

### Golpeo por timing (humano)
- GOLPEAR abre un gesto de `C.SWING` = 0,30 s. El contacto ocurre cuando el balón está al alcance; si el
  **momento ideal** llega en ≤ `C.ASSIST` = 0,05 s, el gesto lo espera (ayuda generosa pero no gratis).
- Momento ideal = instante en que el balón pasa por el punto de contacto del toque (pies + `C.ZC[kind]`:
  recepción 0,85 m, colocación 2,2, ataque desde el suelo 1,5, remate 2,45 sobre los pies en el aire, saque 2,55/2,45).
- `timing` = desfase (s, <0 pronto, >0 tarde). `|te| ≤ 0,035` → **perfect**, `≤ 0,10` → **good**, si no **poor**.
  `quality` (0..1) = timing × distancia al cuerpo × dificultad del balón entrante (remates/saques fuertes).
- Calidad → resultado: dispersión del destino, potencia del remate (13,5..19 m/s humano), riesgo de red/fuera,
  recepción desviada ("shank") si es muy mala, colocación que pasa la red si es muy mala.
- Aporrear no sirve: mientras hay gesto activo, otra pulsación solo cambia el tipo de golpe; tras un gesto
  fallido hay 0,12 s de bloqueo (`C.SWING_LOCK`).
- **Plancha**: si se pulsa GOLPEAR y el balón bajo (< 1,3 m) está fuera del alcance normal pero a ≤ REACH+DIVE (2,4 m),
  el jugador se lanza (evento `dive`), toca con calidad limitada y queda en el suelo 0,9 s (`p.down`).
- **Dejada**: en el aire, SALTAR = dejada (`kind:'free'`, `shot:'tip'`); GOLPEAR = remate. Apuntar: arriba = más
  profundo, izquierda/derecha = lateral (vector de mundo que ya convierte main.js).
- Asistencia de movimiento: a < 1,8 m del punto de contacto, el jugador humano se "imanta" suavemente y frena al llegar
  (salvo que el jugador empuje en dirección contraria).

### Saque
- Tras `serveReady` hay un silbato (`whistle {reason:'serve'}`) a los 0,7 s (0,35 s en demo). **Antes del silbato no se
  puede sacar** (regla). Desde el silbato corren **8 s** (`g.serveClock`, segundos que quedan; falta si llega a 0).
  Se desactiva con `createGame({serveClock:false})` (útil para tutorial).
- `serveState: 'ready'` → el sacador se mueve a lo ancho. **GOLPEAR = lanzar para saque flotante**,
  **SALTAR = lanzar para saque en salto** (la carrera y el salto son automáticos y despegan detrás de la línea).
- `serveState: 'toss'` → el balón está en el aire (`ball.held === null`, `mode` sigue `'serve'`). GOLPEAR en el momento
  justo; la dirección apunta. Si el balón cae sin golpearlo → **falta de saque**.
- Flotante: más lento, **baila** (desvío lateral hasta ~0,5 m, más cuanto mejor el timing; `predictLanding` no lo
  incluye: el aro de caída se moverá en vuelo, es intencionado). En salto: rápido y con liftado (`ball.dip`).

### Reglas implementadas (terminología FCVB)
punto directo (rally point), sets a 25 (3º a 15) con 2 de diferencia, punto de set/partido, cambio de saque con
rotación del sacador dentro del equipo, 3 toques máximo (`four`), dobles (`double`), el bloqueo no cuenta como toque y
el bloqueador puede volver a tocar, **bloquear el saque es falta** (`block`), balón por fuera de la antena o que toca
la antena (`antenna`), **por debajo de la red** (`under`), **toque de red** de un jugador en el aire durante la jugada
(`net`), línea central (no se puede cruzar en el suelo), **8 segundos** y **balón que cae tras el lanzamiento**
(`serve`), saque/balón a la red, balón en la cinta que pasa (legal).

### Dificultad (`createGame({difficulty})`: `'easy'|'normal'|'hard'`, también `'facil'|'fácil'|'dificil'|'difícil'`)
Perfiles en `VB.DIFF` (nombre visible en `VB.DIFF[k].name`: Fácil/Normal/Difícil). Afectan a la CPU: reacción,
velocidad, precisión de timing, bloqueo, defensa, recepción, potencia de remate/saque, saque en salto, dejadas,
puntería y errores no forzados. El compañero IA del humano usa siempre `VB.DIFF.mate` (nivel fijo).
Resultados medidos con bots que juegan SOLO con la entrada real (30 min de juego por casilla, % de puntos del humano):

- novato (σ 120 ms): Fácil ~57 %, Normal ~36 %, Difícil ~22 %
- medio (σ 65 ms): Fácil ~78 %, Normal ~54 %, Difícil ~42 %
- perfecto (σ 20 ms): Fácil ~83 %, Normal ~66 %, Difícil ~57 %

Rally CPU vs CPU: mediana ~5,0 s.

## 2. Añadidos al estado (solo lectura para los demás)
- `g.difficulty` (`'easy'|'normal'|'hard'`), `g.prof[team]` (perfil activo).
- Saque: `g.server` (jugador), `g.serveState` (`'ready'|'toss'`), `g.serveJump`, `g.serveAuth` (ya pitó),
  `g.serveClock` (s que quedan, solo cuenta tras el silbato y con sacador humano), `g.serveT`, `g.tossT`.
- `g.hitBuf`/`g.swingLive`/`g.swingShot` (gesto humano en curso), `g.lastGrade` (calidad del último toque humano),
  `g.lastShot`, `g.lastTouchT` (tiempo del último contacto), `g.netSince` (el balón tocó la red desde el último toque).
- Balón: `ball.dip` (aceleración extra hacia abajo por liftado), `ball.wobA/wobF/wobP` (baile del flotante).
- Jugador: `p.down` (> 0 = en el suelo tras plancha), `p.shot` (subtipo del último toque), `p.grade`,
  `p.jvx/p.jvy` (deriva en el aire), `p.lvx/p.lvy` (impulso de plancha).
- `lastAction` nuevos: **`'toss'`** (lanza el balón para sacar), **`'dive'`** (plancha). La dejada usa `lastAction:'spike'`
  con `p.shot === 'tip'`.

## 3. Añadidos a eventos
- `hit`: `+ grade ('perfect'|'good'|'poor'), timing (s), power (0..1), shot, dive (bool), aim ([x,y]|null), target ([x,y]|null)`.
  `shot`: saque `'float'|'jump'`; recepción `'forearm'|'dig'|'shank'|'dive'`; colocación `'overhead'`; ataque `'power'|'tip'`;
  tercer toque desde el suelo `'overhead'|'forearm'`. **La dejada es `kind:'free', shot:'tip'`** (sin temblor de cámara).
- `block`: `+ result ('stuff' = bloqueo directo al campo rival, 'soft' = toque de bloqueo jugable, 'tool' = block-out), quality, human`.
- `point`: `+ how ('ace'|'kill'|'tip'|'block'|'free'|'error'), player (falta personal o null), lastKind, lastShot`.
  `reason` nuevos: `'net'` (Toque de red), `'serve'` (Falta de saque: 8 segundos / el balón cae sin golpearlo),
  `'under'` (Pasa por debajo de la red), `'block'` (Bloqueo del saque). Textos nuevos: `'Saque a la red'`, `'Balón a la red'`,
  `'Saque fuera'`, `'Balón toca la antena'`.
- Nuevos tipos: `toss {player, team, jump, human}`, `miss {player, reason:'early'|'late'|'far', t2}` (gesto humano sin
  contacto con el balón cerca), `dive {player, x,y,z, dir:[dx,dy]}`, `netTouch {player, x,y,z}` (justo antes del `point`).
- `swing`: `+ shot ('' | 'tip')`. `newMatch`: `+ difficulty`.

## 4. Funciones nuevas en `VB.Sim`
- `hitWindow(g, p?, out?)` → `{t, d, dz, reach, kind, zc, x,y,z, active, canReach, attack, jumpT}`
  - `t`: segundos hasta el momento ideal de contacto de `p` (por defecto `g.ctrl`; <0 = ya pasó). Ideal para un
    anillo de timing que se cierra: perfecto cuando `t` ∈ [−0,035, +0,05].
  - `x,y,z`: dónde estará el balón en ese momento. `reach`: alcanzable desde donde está ahora.
  - `attack` + `jumpT`: si le toca atacar, segundos hasta el despegue ideal ("¡Salta!" cuando `jumpT` ≈ 0).
  - Reutiliza un objeto interno si no se pasa `out` (no guardar la referencia entre frames).
- `predictKind(g,p)`, `canDive(g,p)`, `timingQ(te)`, `gradeOf(q)`, `normDiff(d)`, `DIFF`.
- `VB.AI.serveTarget(g, sv)`, `VB.AI.openSpot(g, p, minDepth, out)`.

## 5. Peticiones a otros propietarios

### players (js/players.js)
1. `lastAction === 'toss'`: brazo izquierdo sube y suelta el balón (el balón ya no está en `held`: `g.serveState === 'toss'`);
   el brazo derecho se arma atrás. En saque en salto (`g.serveJump`) el sacador corre 2 pasos y salta solo: con `act==='jump'`
   y `g.mode==='serve'` usar la pose de remate (brazo armado), no la de bloqueo.
2. `lastAction === 'dive'` y `p.down > 0`: plancha (cuerpo casi horizontal hacia el balón, brazos estirados, luego tumbado
   hasta que `p.down` llega a 0 y se levanta). Dirección: `p.lvx/p.lvy` o el evento `dive.dir`.
3. Dejada (`lastAction==='spike'` y `p.shot==='tip'`): brazo extendido arriba sin el latigazo del remate.
4. Opcional: `p.grade === 'perfect'` → gesto un pelín más enérgico; `point.how === 'block'` → celebración del bloqueador.

### camera_input (js/camera.js)
- Escalar el temblor del remate por `e.power` (0..1) y `e.grade` (`perfect` = el más fuerte). La dejada llega como
  `kind:'free'` (sin temblor). Opcional: temblor pequeño en `dive` y en `block` con `result==='stuff'`.

### arena / fx (js/fx.js)
- `hit` con `grade==='perfect'`: destello mayor / anillo de impacto. `netTouch`: chispa/vibración de la red en `(x,y,z)`.
  `dive`: polvo/deslizamiento en el suelo. El aro de caída (`predictLanding`) en un flotante se moverá en vuelo: es el baile.
- `block.result`: `'stuff'` = impacto fuerte, `'soft'`/`'tool'` = suave.

### ui_main (ui.js / main.js / tools)
- Textos de `point.text` ya en castellano; `how` permite "¡Ace!", "¡Bloqueo!", "Dejada", "Error".
- `miss.reason`: "¡Pronto!" (`early`), "¡Tarde!" (`late`), "No llegas" (`far`).
- La regla de 8 s ya la muestra la UI (`serveClock`); ahora el reloj solo corre tras el silbato, y antes del silbato no
  se puede lanzar: la UI puede mostrar "Espera el silbato" mientras `!g.serveAuth`.
- `tools/drive.js`: el saque ahora son DOS pulsaciones (lanzar + golpear). En la línea
  `await press(' '); await waitFor("VB.ctx.game.mode!=='serve'", 8000);` añadir antes de `waitFor`:
  `await sleep(1000); await press(' ');` (si no, el saque acaba en falta, que también sale de `'serve'`).
  Esperar también a `VB.ctx.game.serveAuth` antes de la primera pulsación: `await waitFor("VB.ctx.game.serveAuth", 3000);`.
- Escenas de depuración sugeridas (probadas en node; el código de `advanceUntil` es el de main.js):
```js
      case 'toss': case 'jumpserve': // saque humano con el balón en el aire (flotante / en salto)
        g = Sim.createGame({ demo: false, seed: sd });
        for (var i = 0; i < 240 && !g.serveAuth; i++) Sim.step(g, STEP, null);
        Sim.step(g, STEP, { move: [0, 0], hit: name === 'toss', jump: name === 'jumpserve', switchPlayer: false });
        for (var j = 0; j < (name === 'toss' ? 50 : 105); j++) Sim.step(g, STEP, null);
        Sim.drainEvents(g, keep); break;
      case 'dive': // plancha (autopilot; con seed=7 ocurre a los ~45 s de juego)
        g = Sim.createGame({ demo: false, autopilot: true, seed: sd });
        keep = advanceUntil(g, function (e) { return e && e.type === 'dive'; }, 0.12, 1200); break;
```
  (`toss` deja el balón a 2,97 m sobre el sacador; `jumpserve` deja al sacador en el aire en x = 9,48, detrás de la línea.)
