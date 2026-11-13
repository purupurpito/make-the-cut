# Diseño: titularidad en la Carrera de pista y cambios en el partido 6v6

Documento de diseño (13-nov-2026). Solo diseño: nada de esto está hecho. Petición de Ferran (literal): «en el modo carrera, no
tienes asegurado que vayas a jugar, quizá el titular es otro... sobre todo si acabas de fichar por un club con mejores jugadores que
tú. Además, hay que añadir sustituciones y tal.»

Basado en el código de este día: js/career.js (`BENCH`, `benchFor`, `benchWhy`, `benchNext6`, `PROMOTE_AT`, `promoteCheck6`,
`c.broken`, `roster6`, `matchSetup6`, `genOffers6`, `startOffer6`, `closeMine6`, `simulateNext6`, `ingest`/`newM`/`slotOf`),
js/career-ui.js (`renderMatch6`, Club › Equipo), js/sim.js (`createGame` 6v6, `g.rot`/`g.lineup`/`g.libero`/`g.liberoFor`/`g.roster`,
`applyLibero`, `resetRot`/`nextSet`, `setupServe`, `isHuman`, `g.ctrl`/`g.ctrlBase`), js/ai6.js (todo por `p.role`), js/main.js
(`startCareerMatch`, `careerEvents`, `careerEndSheet`, `g.watch` del espectador), js/players.js (`syncRigs`: «el líbero (o un cambio)
entra/sale de pista sin rehacer a los demás»), js/camera.js (`tp6`: con `g.watch` va el plano 'tv').

Reglas reales que se respetan (FIVB 15.5-15.8, 19.3): 6 cambios por equipo y set; un titular puede salir y volver UNA vez por set y
solo por quien le sustituyó; el suplente entra una vez por set y solo sale por ese titular; el líbero no cuenta como cambio; la
alineación de cada set la decide el entrenador (cambiar titulares ENTRE sets no gasta cambios); el doble cambio colocador/opuesto son
dos cambios. La sustitución excepcional por lesión NO entra en v1 (no hay lesiones dentro del partido; queda anotada para cuando las
haya: «entra cualquiera que no esté en pista, sin contar»).

---

## 0. Decisiones de fondo

1. **Playa: se queda como está.** En vóley playa no existen las sustituciones (reglamento de playa: dos jugadores, sin banquillo) y
   la pareja juega siempre los dos; el sistema actual (rotación por confianza con `BENCH`/`benchFor`, la pareja y 2 alternativas) ya
   expresa «puedes no jugar esta jornada» sin inventar reglas. No se toca nada de la playa (ni textos, ni `benchFor`, ni careertest de
   playa). Todo lo de este documento es de la **pista (6v6)**.
2. **En la pista, el banquillo aleatorio por confianza desaparece**: `next6` deja de llamar a `benchFor` y en su lugar el entrenador
   elige el seis inicial con una **plantilla con profundidad** (§A). La confianza (`c.coach`) sigue existiendo y es uno de los
   ingredientes de esa elección; el rol prometido pasa a ser una ventaja/garantía en esa elección (§A.4). Así no hay dos sistemas que se
   contradigan.
3. **Los cambios en el partido solo existen si la Carrera o el Partido rápido pasan `opts.bench`** a `createGame`. Sin banquillo, el
   6v6 es byte a byte el de hoy (simtest 6v6 CPU: mismos puntos, side-out y `g.rng`), y el 2v2 ni se entera (huella idéntica). Las
   decisiones del entrenador CPU usan `hash01` (como el doble de playa), NUNCA `g.rng`.
4. **En la Carrera eres jugador, no entrenador**: no pides cambios; el entrenador de tu club (CPU) te mete y te saca con reglas que la
   Carrera le pasa (§B.3). En el Partido rápido 6v6 sí puedes pedir cambios para tu equipo desde la pausa (§B.4).
5. **Tus números cuentan solo mientras estás en pista** (ya pasa con `slotOf`: solo cuenta lo de `g.ctrl`, y en el banquillo tu atleta
   no toca el balón); lo nuevo es medir **cuántos puntos jugaste** para la nota, la experiencia, la fama y las estadísticas.

---

## A. Titularidad en la Carrera (pista)

### A.1 Plantilla con profundidad (`c.sq6`)

Sustituye a `roster6` (que inventaba 7 nombres al vuelo cada vez). Se guarda en el guardado de pista (`voley3d.career6`, sin subir
`VER6`; un guardado sin `c.sq6` lo crea al cargar en `sane6`, como `c.life`).

```js
c.sq6 = { club: id, season: n,
  list: [ { id: 'q3', name: 'Nico Serrat', pos: 'OH', num: 7, ovr: 63, form: 1, fat: 20, conf: 55 }, ... ],   // sin ti
  stat: 'start'|'sub'|'out', why: 'texto', wk: wkKey6 de la última elección, ahead: ['q3'],   // última elección (caché por jornada)
  run: 0,          // jornadas seguidas saliendo de inicio por méritos (sin la ventaja del rol): sube a titular con STARTS_PROMOTE
  titBench: 0 }    // jornadas de liga de esta temporada que, con rol Titular, te dejó sin salir de inicio por méritos (promesa)
```

- `squad6(c, k, season)` genera la plantilla de un club (determinista: `rng(hash(c.seed, 'sq6', k.id, season))`), tú aparte:
  - Tamaño por puesto (contándote a ti en el tuyo): **S 2, OPP 2, OH 4, MB 3, L 1** (12). Clubes con `k.ovr >= SQ_BIG` (70) llevan
    **+1 OH y +1 MB** (14): ahí puede haber gente fuera de la convocatoria de 12.
  - Medias: los dos primeros de cada puesto (los «titulares naturales») a `k.ovr + U(-3, +4)`; el resto a `k.ovr + U(-9, -1)`;
    límites 20-99. El líbero, `k.ovr + U(-3, +3)`. Edad no se guarda (no hace falta).
  - `form` −3..+3 (empieza en 0), `fat` 0 (sube 12 por partido jugado de inicio, 6 si entró, baja 15 si no jugó), `conf` del entrenador
    con él: `clamp(50 + 2 × (ovr − k.ovr), 30, 75)`.
  - Nombres de `FIRST`/`LAST` (inventados, como hoy); dorsales únicos 1-20 sin el tuyo ni el 13 (el 13 es del líbero, como en sim.js).
- Se regenera al fichar (`joinClub6`) y en cada verano (`newSeason6`: los que siguen, `ovr ± U(-2, +2)` y `form/fat` a 0; si cambió
  tu puesto con `setPosition6`, se rehace).
- Tras cada jornada (jugada, simulada o sin ti): `squadWeek6(c, played)` → forma de cada uno: paseo ±1 con vuelta hacia 0 (como
  `mateFormStep`), fatiga según si jugó, `conf` ±1 según la forma. Determinista por semilla, temporada y jornada.
- `roster6(c, k)` sigue existiendo (la usan career-ui Club › Equipo y career-life `mate6`): para tu club devuelve la plantilla de
  `c.sq6` con tu fila (`me: true`) y con `stat` por jugador; para otro club, la de `squad6` sin guardar. Mismos campos de hoy
  (`name, pos, posName, ovr, num, me`) más `form`, `stat` ('start'|'sub'|'out'), `slot` (0-5 en la alineación o −1).

### A.2 El entrenador elige el seis de cada jornada (`lineup6(c)`)

Una vez por jornada (caché `c.sq6.wk === wkKey6(c)`; se recalcula si cambia algo: fichaje, temporada) y antes de enseñar el hub.

```
sel(x) = ovr + SEL_FORM × form + (conf − 50) / SEL_CONF − max(0, fat − SEL_FAT0) / SEL_FATK + (salió de inicio la anterior ? SEL_KEEP : 0)
         + ruido determinista ±SEL_NOISE (hash(c.seed, 'sel', wk, id))
SEL_FORM = 0.8, SEL_CONF = 12, SEL_FAT0 = 50, SEL_FATK = 10, SEL_KEEP = 0.75, SEL_NOISE = 0.5
```

- Para ti: `ovr = playerOvr(c)`, `form = clamp((form(c) − 6.5) × 2, −3, 3)` (0 sin notas), `conf = c.coach`, `fat = c.fatigue`.
- Por puesto, los mejores `sel` ocupan las plazas: S 1, OPP 1, OH 2, MB 2, L 1 (el líbero no compite contigo: no es un puesto que
  lleves). De los OH/MB, el de mayor `sel` va al hueco 1 de `ROLES6` (OH1 = índice 1, MB1 = índice 2), el otro al 4 / 5.
- Convocatoria de 12 (11 + líbero): los de peor `sel` de los puestos con más gente se quedan **fuera** (solo pasa en clubes de 14).
  También te quedas fuera si `c.coach < OUT_COACH` (20): «no te convoca».
- **Rol prometido** (§A.4): Titular suma `TIT_BONUS = 3` a tu `sel`; Titular indiscutible sale siempre de inicio salvo
  `c.fatigue >= FAT_REST_TOP` (85).
- **Descanso por fatiga**: si `c.fatigue >= FAT_REST` (80) y no eres indiscutible, el entrenador te deja de suplente esa jornada
  (`why = 'fatiga'`; no cuenta como promesa incumplida).
- Resultado: `{ stat: 'start'|'sub'|'out', why: código, slot: 0..5 | -1, start: [6 entradas en orden ROLES6], bench: [hasta 5],
  out: [...], rival: la entrada de tu puesto que juega en tu lugar (o la que te supera por menos) , gap: sel tuyo − sel de ese rival }`.
  Códigos `why`: 'form' (está en mejor forma), 'ovr' (tiene más media), 'conf' (el entrenador se fía más), 'fatiga', 'new' (acabas de
  llegar: en tu 1ª jornada en un club `conf` cuenta como el `ROLE_COACH` del rol y la ventaja `SEL_KEEP` es de los de casa), 'coach'
  (confianza < 20: no te convoca), 'list' (convocatoria llena). Se elige como `why` el término del rival que más pesa en la diferencia.

`next6(c)` añade `status` ('start' | 'sub' | 'out'), `why` (texto corto, §A.7), `rivalIn` (`{name, pos, ovr, form}` del que juega en
tu lugar) y `gap`. **`n.bench` pasa a ser `status === 'out'`** (lo usan career-life l. 226 y career-world: «no hay partido que jugar»).
Con `status === 'sub'` el partido SÍ se juega (desde el banquillo).

### A.3 Cómo te ganas el puesto

Todo entra por los términos de `sel`, sin sistemas nuevos:
- **Media**: subes atributos (como siempre).
- **Forma**: tus notas recientes (`form(c)`: media de las 3 últimas). Las notas de partidos en los que entraste cuentan igual que las
  de titular; los partidos sin nota (no entraste o jugaste menos de `NOTA_MIN_R`) no entran en `c.notes`.
- **Confianza** (`c.coach`), que ahora se mueve también sin jugar:
  - Jugando: `(nota − 6.2) × 2.5 × share + (win ? 1 : −1) × share` (share = parte de los puntos que estuviste en pista; §A.6).
  - Entrar desde el banquillo y sacar ≥ 7: `+IMPACT_COACH` (2) extra («Buen cambio»).
  - Entrenamiento de la semana siendo suplente o fuera: `+TRAIN_COACH` (1) con un enfoque que no sea Descanso; con Descanso, 0.
  - Que te cambien por jugar mal: −2 (además de lo que diga la nota).
- **Fatiga**: descansar (Descanso, fisio) te pone por delante de un titular reventado (los NPC también se cansan: `fat`).
- **Minutos como suplente**: dan forma (nota) y confianza aunque sean pocos; si no entras, nada se pierde salvo la jornada.

### A.4 Rol prometido (integrado con la elección)

| Rol | En la elección | Promesa | Subida |
|---|---|---|---|
| Rotación | sin ventaja (pura competencia) | ninguna | `STARTS_PROMOTE = 3` jornadas de liga seguidas de inicio por méritos → Titular y sueldo de titular (mensaje de hoy «Te has ganado la titularidad») |
| Titular | `+TIT_BONUS` (3) a tu `sel` | si `titBench >= TIT_BROKEN` (2) en la temporada (suplente o fuera por méritos, no por fatiga ni por tu decisión de descansar) → `c.broken = c.season` (mensaje de hoy «Promesa incumplida») | — |
| Titular indiscutible | sale siempre de inicio (salvo fatiga ≥ 85) y `me.pullAt = 99` (no te cambian por jugar mal) | la confianza no baja de `ROLE_FLOOR[2]` (35) | — |

- `PROMOTE_AT` y `promoteCheck6` (subida por confianza 70) se sustituyen en la pista por la regla de `STARTS_PROMOTE`.
  `promoteCheck` de la playa no cambia.
- `BENCH`, `benchFor`, `benchWhy` siguen solo para la playa. En la pista, `HALL.benchWhy` pasa a ser `whyText6(c)` (texto del estado).
- Nuevos textos de rol para la pista `ROLE_HINT6` (Club › Contrato y ofertas; la playa sigue con `ROLE_HINT`):
  - Rotación: «Compites por el puesto: juega quien llegue mejor (media, forma, confianza y fatiga). Si sales de inicio 3 jornadas
    seguidas, pasas a titular.»
  - Titular: «El entrenador cuenta contigo de inicio salvo que estés muy por debajo o con mucha fatiga. Si te deja 2 jornadas en el
    banquillo, incumple la promesa y puedes irte sin pegas.»
  - Titular indiscutible: «Sales siempre de inicio (salvo con fatiga de 85 o más) y no te cambian por jugar mal. La confianza del
    entrenador nunca baja de 35.»

### A.5 Ofertas coherentes con la plantilla del club

- `depth6(c, k, lid)`: genera `squad6(c, k, temporada de la oferta)` y compara tu `sel` «de recién llegado» (tu media + forma, `conf`
  = `ROLE_COACH` del rol, sin `SEL_KEEP`) con los de tu puesto. Devuelve `{ slots: 1|2, ahead: [{name, ovr}] (los que te superan),
  rank: 1.., start: rank <= slots, gap }`.
- **Rol ofrecido** = el del interés (como hoy) pero **topado por la plantilla**: si `!start && gap < −3` → como mucho Rotación; si
  `!start` (gap −3..0) → como mucho Titular; Titular indiscutible solo con `start && gap >= 3`. `negotiate6` respeta el mismo tope
  («No podemos prometerte eso: por delante tienes a {X}»).
- **Interés** del club: `+FIT_START` (2) si serías titular, `−FIT_DEEP` (2) si serías 3º o peor de tu puesto (los clubes valoran si
  vas a jugar). Afecta a `startOffer6` y `genOffers6`.
- La oferta lleva `depth` y la ficha lo enseña (career-ui): «Serías titular» o «Competencia: Nico Serrat (66) y Leo Brandt (63)».
- **Bienvenida** (`welcome6`): si al llegar no sales de inicio, añade «Aquí tendrás que ganarte el puesto: por delante están {X} ({o})
  e {Y} ({o}).» (o «está {X}» con uno).

### A.6 Minutos, nota, experiencia, fama y estadísticas

- **share** = `meR / rallies` (puntos que estuviste en pista / puntos del partido). `meR` viene del partido (contrato §I.3).
- **Nota**: `rating(mine, …, meR, RATE6[pos])` (se normaliza por los puntos que jugaste, no por los del partido). Con
  `meR < NOTA_MIN_R` (12) → **sin nota** (`nota: null`, la hoja dice «s. c.», sin calificar).
- **Experiencia**: con nota, `xp = round((40 + 22 × nota + (win ? 40 : 0) + 6 × min(pts, 10)) × xpMul6 × (sim ? 0.5 : 1) × (0.35 +
  0.65 × share))`. Sin nota (suplente que no entró o entró poco): `xp = round(BENCH_XP × xpMul6 × (sim ? 0.5 : 1))`, `BENCH_XP = 20`
  («se aprende desde el banquillo»). Fuera de la convocatoria: 0 (como hoy).
- **Química**: +5 si jugaste (sim +3), +2 si estuviste en el banquillo.
- **Fama** (career-life `life(c, 'match', sum, f)`): `sum.bench = true` cuando no hay nota (career-life ya trata `bench` como «sin
  reto ni fama de partido»); con nota y `share < 1`, career-life escala sus deltas de fama por `sum.part.share` (mínimo 0,35).
- **Estadísticas** (`newSeasonStats` de pista, por temporada y carrera): `played` solo si entraste (`meR > 0`); `bench` = jornadas sin
  jugar (fuera de la convocatoria + suplente sin entrar: así las cuentas de career-world `bench1`, Palmarés y totales siguen valiendo);
  nuevos `starts` (de inicio), `subIn` (entraste desde el banquillo), `mr` (puntos en pista) y `rr` (puntos de tus partidos) → «% de
  puntos jugados». `dUse` cuenta todas las jornadas (como hoy).

### A.7 Hub, ficha y mensajes (career-ui.js / career.js)

**Tarjeta del partido** (`renderMatch6`), según `n.status`:
- 'start': como hoy, con una línea «Sales de inicio» (si la jornada anterior no saliste: «Vuelves al seis inicial»).
- 'sub': caja `.bench` (la de hoy) con «**Empiezas en el banquillo.** Sale de inicio {X} ({puesto}, media {o}, {forma}). Tú: media
  {o}, {forma}. El entrenador te meterá si el equipo pierde un set o si {X} no está fino.» (la 2ª frase cambia con las reglas `me`:
  sin `enterLostSet` → «Si el partido lo pide, entrarás.»). Botones «Jugar desde el banquillo» y «Simular» (con «(mitad de XP)»).
- 'out': la caja de hoy con «**Fuera de la convocatoria.** {motivo} Descansas (fatiga −15), entrenas y cobras.» y «Ver la jornada»
  (→ `benchNext6`, que ya existe).

**Club › Equipo** (`renderTeam6`): tabla por puestos (Colocador, Opuesto, Receptor, Central, Líbero) con nombre, dorsal, media, forma
(texto de `FORM_TXT`) y etiqueta de estado «Titular» / «Suplente» / «Fuera»; tu fila resaltada. Encima: «Tu puesto: {k}º de {n}
{puestos en plural}» y, si no sales de inicio, «Para salir de inicio tienes que superar a {X}». Sin «·»: separadores con `sp()`.

**Ficha de oferta**: línea de profundidad (§A.5).

**Resumen tras el partido** (`renderLast`/hoja): «De inicio» / «Entraste en el {ordn(set)} set» / «No llegaste a entrar»,
«{meR} de {rallies} puntos en pista», «Te cambiaron en el {ordn(set)} set». Ordinales con `ordn` («1r», «2º», «3r»).

**Mensajes del entrenador** (`msg(c, 'coach', …)`, solo al cambiar de estado; textos en neutro, sin «él/ella» ni adjetivos con
género):
- A suplente: «Empiezas en el banquillo» — «Esta semana sale de inicio {X}: {motivo}. Estate a punto: si el partido lo pide, entras.»
- A titular: «Sales de inicio» — «Has convencido en los entrenamientos: el próximo partido juegas de inicio en lugar de {X}.»
- Fuera: «Fuera de la convocatoria» — «Esta jornada no entras en la lista de 12. {motivo} Sigue entrenando y volverás.»
- Descanso: «Descansas de inicio» — «Vas con mucha fatiga ({f}). Empiezas en el banquillo para dosificarte.»
- Tras entrar con nota ≥ 7: «Buen cambio» — «Saliste desde el banquillo y cambiaste el partido (nota {n}). Así se gana el puesto.»
- Tras cambiarte con nota < 6: «Te he cambiado» — «Hoy no era tu día y te senté en el {ordn(set)} set. La próxima, más concentración.»
- Motivos (texto corto de `why`): 'form' «llega en mejor forma», 'ovr' «tiene más nivel ahora mismo», 'conf' «el entrenador se fía
  más de su juego», 'fatiga' «vas con mucha fatiga», 'new' «acabas de llegar y aún tienes que ganarte el sitio», 'coach' «el
  entrenador no cuenta contigo», 'list' «la convocatoria está llena».

### A.8 Simular siendo suplente (`simulateNext6`)

- Con `status === 'sub'`: `quickSim` del equipo con el titular de tu puesto (`teamOvr6` usando la media de `rivalIn` en vez de la tuya).
  ¿Entras? `pIn = clamp(0.35 + 0.08 × (gap + 4), 0.1, 0.8)` (+0,2 si tu equipo perdió algún set). Si entras: `share = U(0.25, 0.6)`,
  estadísticas simuladas de hoy × share, nota simulada de hoy si `share × puntos >= NOTA_MIN_R`. Si no: sin nota (`sum.bench`).
  Determinista (`rng(hash(c.seed, 'mine6', …))`).
- Con 'start': como hoy (`share = 1`, y una probabilidad pequeña de que te cambien si la nota simulada < 5,5: `share = U(0.5, 0.8)`).
- Con 'out': `benchNext6` como hoy (texto del motivo nuevo).

---

## B. Cambios en el partido 6v6

### B.1 Banquillo en la sim

- `createGame({format:'6v6', bench: [[B…], [B…]], …})` crea hasta 6 suplentes por equipo (v1: la Carrera y el Partido rápido pasan
  5: S, OPP, OH, MB y OH o MB), con `mk6Fields`, `bench = true`, `p.role = B.role`, `p.num`, `p.name`, sus atributos (`applyAttrs`
  extendido) e insignias. Ids `team × 16 + 7 + i` (el 6 es el líbero; los ids siguen ≤ 15 por equipo). `g.roster[t]` = los 6 + líbero
  + suplentes (los ids de simtest l. 2585 no cambian sin banquillo).
- `g.subsOn = true` solo con banquillo. Estado: `g.subs[t] = { n: usados en el set, pairs: [{ a: titular, b: suplente, back: bool }] }`
  (se vacía en `nextSet`), `g.subQ[t]` (cambio pedido, se aplica en el siguiente balón muerto), `g.coach[t]` (config §B.3).
- Por jugador (solo con `g.subsOn`): `p.perf` (rendimiento del set: +1 punto directo (remate, ace, bloqueo), +0,3 recepción perfecta o
  defensa, −1 error o falta suya, −0,5 recibir un ace o que le bloqueen; se pone a 0 en cada set), `p.tired` 0-1 (+0,006 por punto en
  pista, +0,003 por salto; −0,02 por punto en el banquillo; arranca en `B.fat`/100 o 0), `p.onR` (puntos en pista).
  Efecto del cansancio, pequeño y solo con `g.subsOn`: velocidad × (1 − 0,03 × tired) y salto × (1 − 0,02 × tired).
- Contador del humano: `g.meR` (puntos con tu jugador en pista; cuenta también cuando llevas al líbero que entró por tu central, que
  es como funciona hoy) y `g.rallyN` (puntos del partido).
- **Legalidad** `canSub(g, t, out, inn)` → '' o el motivo: 'off' (sin banquillo), 'max' (6 usados), 'used' (ese suplente ya entró y
  salió en el set), 'pair' (un suplente solo sale por su titular, y un titular solo vuelve por su suplente), 'back' (ese titular ya
  volvió en el set), 'libero' (`out` está fuera por el líbero o `inn`/`out` es el líbero), 'me' (en el Partido rápido no te puedes
  quitar a ti), 'bench' (`out` no está en pista o `inn` no está en el banquillo).
- **Cuándo se aplica**: en balón muerto, justo antes de `setupServe` (y después de `nextSet` si toca), en `applySubs(g)`: primero lo
  pedido (`g.subQ`), luego lo que decida cada entrenador CPU (`VB.AI6.coachPlan(g, t)`). El que entra ocupa la zona del que sale en
  `g.rot[t]` y su hueco en `g.teams[t]`; `refreshTeams`; `applyLibero` (ya lo llama `setupServe`) sigue funcionando porque mira
  `p.role === 'MB'` en zaguero. Con algún cambio, el saque espera `SUB_HOLD = 1.8` s más (para el rótulo y el paseo).
- **Entre sets** (`nextSet`): el entrenador puede cambiar la alineación del set (`g.lineup[t]`) sin gastar cambios (titular con
  `tired >= 0.75` → descansa si hay suplente del puesto más fresco; reglas `me` de §B.3). Evento `lineup`. `resetRot` sigue copiando
  `g.lineup` (y simtest sigue viendo `rot === lineup` en `newSet`).

### B.2 Entrenador CPU (`VB.AI6.coachPlan(g, t)`, en ai6.js)

Devuelve como mucho un cambio (o un doble) por balón muerto y equipo, o null. Solo con `g.subsOn` y `g.coach[t].auto`. Usa `hash01`
con `g.seed`, `g.setNo` y el marcador, nunca `g.rng`. Nunca deja el set sin cambios para las vueltas: no hace cambios «de iniciativa»
si `n >= 4` (salvo vueltas). `iq` 1-3 (Fácil 1, Normal 2, Difícil/Experto 3) decide qué recursos usa. Umbrales escalados por
`k = max(0.6, setTarget / 25)`. Prioridad:

1. **Vueltas obligadas**: sacador especialista que perdió el saque → vuelve el titular; fin del doble cambio (el colocador titular
   vuelve a zaguero, zona 1) → vuelven los dos.
2. **Reglas hacia ti** (equipo 0 en la Carrera; §B.3).
3. **Mal rendimiento**: `p.perf <= −PERF_PULL × k` (`PERF_PULL` 3 con iq ≥ 2; 4 con iq 1), su equipo va perdiendo en el set y hay
   suplente del mismo puesto (u OH↔OPP). Probabilidad 0,6 por balón muerto (hash).
4. **Cansancio**: `tired >= 0.8` y suplente del puesto con `tired < 0.4` (iq ≥ 2).
5. **Doble cambio** (iq 3): el colocador titular acaba de pasar a delantero (zona 4) con el set igualado (diferencia ≤ 2) a partir de
   `0.6 × setTarget`, y hay S y OPP suplentes: entra el OPP suplente por el colocador y el S suplente por el opuesto (2 cambios). Un
   doble por set.
6. **Sacador especialista** (iq 3): final de set apretado (los dos ≥ `setTarget − 4`, diferencia ≤ 2), el que va a sacar tiene
   `st.serve` 8 o más por debajo del mejor sacador del banquillo del mismo puesto (u OH↔OPP): entra a sacar; vuelve al perder el saque.
7. **Partido roto** (iq ≥ 2, `garbage`): diferencia ≥ `8 × k` pasado `0.6 × setTarget` → descanso de un titular cansado.

Los cambios por puesto distinto (salvo OH↔OPP) no se hacen: ai6.js reparte todo por `p.role` y un central en zona de receptor
rompería las formaciones. El doble cambio sí cambia el puesto de zona (S y OPP intercambiados), y ai6 lo soporta porque busca al
colocador por `role === 'S'` y saca la rotación de su zona (`_P[z].role === 'S'`, l. 324).

### B.3 En la Carrera: tú en el banquillo y el entrenador hacia ti

- **Empiezas en el banquillo** (`opts.meBench = i`): `g.ctrlBase = g.ctrl =` ese suplente y `g.ctrlOut = true`. Con `g.ctrlOut`,
  `step` no procesa la entrada del humano (`human = … && !g.ctrlOut`); `isHuman` ya da false (tu atleta no está en pista). main.js pone
  `g.watch = g.watch0 || g.ctrlOut` cada frame: con eso la cámara va a 'tv' (`tp6`), players/fx quitan halo y aro, input oculta los
  mandos táctiles. Al entrar, `g.ctrlOut = false` y todo vuelve (cámara 3ª persona).
- **Reglas `me`** (las calcula la Carrera, §I.1). Con `me` y tu atleta:
  - En el banquillo, te mete: (a) `enterLostSet`: al empezar el set siguiente a uno perdido, en la alineación del set, por el de tu
    puesto con peor `perf` (cambio entre sets: no gasta); (b) `enterBad`: si el titular de tu puesto cumple la regla 3 de §B.2 (te elige
    a ti antes que a otro suplente); (c) `garbage`: partido roto (regla 7), te da minutos.
  - En pista, te saca: `p.perf <= −me.pullAt × k` (con `pullAt` 99, nunca). Si te saca y `me.backNextSet`, vuelves en la alineación del
    set siguiente; si no, solo vuelves por la regla (a)/(b) como cualquier suplente (y con las restricciones de `canSub`).
  - Nunca te usa como sacador especialista ni en el doble cambio (ni te quita para hacerlo).
- **Ver el partido desde el banquillo** (main.js + ui.js): con `g.ctrlOut`, barra abajo «En el banquillo» con «×3» (alterna velocidad
  ×1/×3 con `ctx.timeScale`, con la cámara lenta desactivada), «Saltar hasta que entres» y «Saltar al final». Saltar = main avanza la sim
  sin pintar (patrón `advanceUntil` de las escenas de prueba: trozos de `FF_CHUNK` s de juego por frame, hasta `FF_BUDGET` 8 ms),
  pasando TODOS los eventos a `careerEvents` y al recuento de ui.js, con un velo honesto «Simulando… {marcador} ({ordn(set)} set)»;
  para al llegar un `sub`/`lineup` con `meIn`, o en `gameOver`. Al parar, players.js se resincroniza (`onGameStart(g)`) y la cámara corta.
  Teclado/mando: los dos botones con foco y la tecla de pausa como siempre.
- **Cuando entras o sales**: rótulo de cambio (§B.5) y aviso propio: «¡Entras! Por el {num} {nombre}» / «Te cambian: entra el {num}
  {nombre}» (`callout` 2,2 s, `srSay`).
- **Tus números**: lo que hace tu atleta solo cuenta en pista (ya es así: `slotOf` mira `g.ctrl`, que en el banquillo no toca el
  balón). La Carrera cuenta tus puntos en pista con los eventos (§I.3).

### B.4 Partido rápido 6v6: cambios del humano

- main.js genera el banquillo de los dos equipos (`Sim.defaultBench(t)`: S, OPP, OH, MB, OH con atributos neutros, dorsales 7-12
  salvo los usados) y pasa `bench` siempre en 6v6 con humano (no en el espectador `?format=6v6`, para que tv6test/perf no cambien).
  `coach: [{auto: ajuste, iq}, {auto: true, iq por dificultad}]`.
- Ajuste nuevo (Ajustes · Juego, solo se ve con Formato 6 contra 6): «Cambios de tu equipo: Automáticos / Solo los míos»
  (`ctx.settings.subs6`, 'auto' | 'manual'; por defecto 'auto'). Automáticos = el entrenador CPU de tu equipo también cambia (nunca a ti).
- **Menú Cambios** (pausa; botón «Cambios {quedan}/6» solo en 6v6 con banquillo y fuera de la Carrera): dos columnas, «En pista» (en
  orden de zona: «Z4», dorsal, abreviatura del puesto «Col/Opu/Rec/Cen/Líb», puntos y errores del partido, barra de cansancio) y
  «Banquillo». Tocas uno de pista y luego uno del banquillo: `Sim.requestSub` → «Cambio pedido: entra el {n} por el {n} al acabar la
  jugada» (o el motivo si no vale, §B.6). Tu jugador sale marcado «Tú» y no se puede elegir. «Anular cambio» si hay uno pedido.
  Navegable con teclado y mando (botones con foco, el mismo marco que los paneles de ui.js).

### B.5 Cómo se ve un cambio

- **Rótulo de TV** (ui.js, evento `sub`): banda abajo 2,5 s con el color del equipo: «Cambio | ▲ {num} {nombre} | ▼ {num} {nombre}»
  (▲ verde, ▼ rojo; en estrecho, solo dorsales). Doble cambio: dos filas. Debajo, pequeño, «Cambios: {n}/6».
- **Tablilla** (players.js, opcional y barata): el que entra levanta un brazo con la tablilla del dorsal 1 s (gesto reutilizado del
  de pedir el balón).
- **Paseo** (players.js): el que entra aparece en la zona de cambio (banda, entre la línea de 3 m y la red, del lado de la mesa) y su
  rig camina hasta su sitio de la sim durante `SUB_HOLD` con el desfase visual que ya existe (`r.offX/offY` que se desvanece); el que
  sale queda como «fantasma» 1,2 s caminando a la banda y desaparece (`syncRigs` ya quita su rig; se aplaza). Si sale caro o feo:
  **fundido** honesto de 0,3 s (sale el uno, aparece el otro). Precarga: `onGameStart` crea (sin añadir a la escena) los rigs de
  `g.roster` para que el primer cambio no dé tirón.
- Líbero: sin cambios en v1 (sigue con su aviso propio cuando te afecta).

### B.6 Textos (ui.js)

- Motivos de `canSub`: 'max' «Ya no quedan cambios en este set», 'used' «Ya entró y salió en este set», 'pair' «Solo puede cambiarse
  por el jugador al que sustituyó», 'back' «Ya volvió a pista en este set», 'libero' «Ahora está el líbero: espera a que salga»,
  'me' «Eres tú», 'bench' «No está en pista», 'off' «Este partido no tiene banquillo».
- Rótulo: «Cambio», «Doble cambio», «Sacador» (especialista), «Cambios: 3/6».
- Banquillo: «En el banquillo», «×3», «Saltar hasta que entres», «Saltar al final», «Simulando…», «¡Entras!», «Te cambian».

---

## I. Contrato entre las dos tareas

### I.1 Lo que pone la Carrera en `matchSetup6` (career.js) y main.js pasa a `createGame`

Campos de hoy sin cambios: `format, venue, ctrlRole, ctrl, attrs, badges, nums, points, difficulty, rookie, diffName, chem, fatigue,
ref, kit, rivalKit, career`. Cambios y nuevos:

```js
{
  attrs: [a0, a1],        // a0[i] = atributos del que SALE DE INICIO en el hueco i de ROLES6 (tú en meSlot si meOn)
  nums:  [n0, n1],        // dorsales de los 6 iniciales (tu dorsal en meSlot si meOn)
  badges: [b0, null],     // b0[meSlot] = tus insignias si meOn; si no, todo null (las tuyas van en bench[0][meBench].badges)
  meOn: true | false,     // ¿sales de inicio?
  meSlot: 0..5 | -1,      // tu hueco en ROLES6 si meOn (sustituye al uso 6v6 de ctrlIdx; ctrlIdx = meSlot por compatibilidad)
  ctrlIdx: meSlot,        // (career-life lo usa para tu material; con meOn false vale -1)
  meBench: -1 | 0..5,     // tu índice en bench[0] si !meOn
  names: [[6 nombres], [6 nombres]],    // de los iniciales, orden ROLES6 (tú incluido); los del rival, inventados por semilla
  bench: [[B, …], [B, …]],              // 5 por equipo; B = { role: 'S'|'OPP'|'OH'|'MB', st: {VB.ATTR_KEYS: 1-99}, num: 1-99,
                                        //   name: string, fat: 0-100, badges: obj|null }  (tú, si !meOn, en bench[0][meBench])
  coach: [
    { auto: true, iq: 1|2|3, me: { pullAt: 3|4|5|99, enterLostSet: bool, enterBad: bool, garbage: bool, backNextSet: bool } },
    { auto: true, iq: 1|2|3 }
  ],
  career: { …lo de hoy…, meOn: bool, status: 'start'|'sub' }   // main lo deja en g.career: career.ingest sabe si empiezas en pista
}
```

- `iq`: por la dificultad del partido de ese equipo (`easy` 1, `normal` 2, `hard`/`expert` 3; tu club, por la de su media con
  `difficultyFor6`).
- `me` (la Carrera lo calcula con tu rol, tu confianza y el `gap` de `lineup6`):
  - `pullAt`: Indiscutible 99; Titular 5 (4 si `c.coach < 45`); Rotación 4 (3 si `c.coach < 45`).
  - `enterLostSet`: `gap >= −4`. `enterBad`: true. `garbage`: true. `backNextSet`: `c.coach >= 50`.
- main.js reenvía a `Sim.createGame` tal cual: `bench, meSlot, meBench, names, coach` (y lo de hoy). Sin `bench` (Carrera de playa,
  espectador, pruebas viejas) todo es como hoy.
- La sim usa `meSlot` para elegir tu atleta en 6v6 (hoy coge «el primero de ese puesto»: si eres OH titular en el hueco 4, hace falta).
  Sin `meSlot` ni `meBench`, el de hoy.

### I.2 Lo que hace la sim (estado y eventos que la Carrera puede leer)

- `g.subsOn`, `g.ctrlOut` (tu atleta en el banquillo), `g.meR` (puntos con tu jugador en pista), `g.rallyN` (puntos del partido).
- Evento `{type: 'sub', team, inP, outP, why, n, left, set, score: [a, b], meIn: bool, meOut: bool}`; `why` ∈ 'human' | 'back' |
  'bad' | 'tired' | 'double' | 'doubleBack' | 'serve' | 'serveBack' | 'garbage' | 'meIn' | 'meOut'. Un doble = dos eventos `sub`
  seguidos (why 'double').
- Evento `{type: 'lineup', team, set, ins: [p], outs: [p], meIn: bool, meOut: bool}`: cambios de la alineación de un set (entre sets,
  sin gastar cambios), emitido después de `newSet` y antes del primer `serveReady`.
- `meIn`/`meOut` = `inP === g.ctrlBase` / `outP === g.ctrlBase` (equipo 0).
- API `VB.Sim`: `canSub(g, t, out, inn)`, `requestSub(g, t, out, inn)` (→ '' o motivo), `cancelSub(g, t)`, `subsLeft(g, t)`,
  `benchOf(g, t)`, `subInfo(g, t, p)` → `{state: 'starter'|'in'|'out'|'back'|'bench', canOut, canIn}`, `defaultBench(t)`, `SUB_MAX = 6`.

### I.3 Lo que devuelve el partido a la Carrera (career.js lo cuenta)

- `ingest(evs, g)` (career.js) añade a `M`: `on` (empieza en `g.career.meOn !== false`), `meR` (++ en cada `point` con `on`),
  `setNo` (++ en `newSet`; 1 al empezar), `sets` (sets en los que `on` estuvo alguna vez), `started` (= `on` inicial), `entered`
  (set del primer `meIn`), `pulled` (set del primer `meOut`). `on` cambia con `sub`/`lineup` (`meIn` → true, `meOut` → false).
- `matchDone6(r, stats, g)`: `meR = typeof g.meR === 'number' ? g.meR : M.meR`, `rallies = g.rallyN || M.rallies`. Sin ningún evento
  `sub`/`lineup` y sin `g.meR` (partido sin banquillo) → `meR = rallies` (lo de hoy).
- Devuelve en el resumen (`sum`, que main.js pinta en la hoja final y career-ui en el hub):

```js
sum.part = { status: 'start'|'sub'|'out', started: bool, entered: 0|setNo, pulled: 0|setNo, meR: int, rallies: int,
             share: 0..1, sets: [setNo…] }
sum.nota   // número, o null si meR < NOTA_MIN_R (12): la hoja dice «s. c.»
sum.bench  // true si no hay nota (no entraste, entraste poco o estabas fuera): career-life y career-world ya lo entienden
```

- main.js `careerEndSheet`: con `sum.part`, una línea: «De inicio | {meR} de {rallies} puntos» / «Entraste en el {ordn} set | {meR}
  de {rallies} puntos» / «No llegaste a entrar»; con `pulled`, «Te cambiaron en el {ordn} set». Nota null → «s. c.» y «(menos de 12
  puntos en pista)». Sin `sum.part` (playa), como hoy. Ordinales: «1r, 2º, 3r» (main tiene su helper o usa `VB.Career.ordn` si existe;
  si no, uno local igual a `ordn` de career.js).

---

## T1. taskCareer (js/career.js, js/career-ui.js, js/career-life.js, tools/careertest.js)

1. **Plantilla** (`c.sq6`): `squad6`, `SQ_SIZE = {S: 2, OPP: 2, OH: 4, MB: 3, L: 1}`, `SQ_BIG = 70` (+1 OH +1 MB), `squadWeek6`,
   creación en `joinClub6`/`newSeason6`/`setPosition6`, migración en `sane6` (sin subir `VER6`). `roster6` lee de ahí (§A.1).
2. **Elección** `lineup6(c)` con las constantes de §A.2 (`SEL_*`, `OUT_COACH = 20`, `FAT_REST = 80`, `FAT_REST_TOP = 85`,
   `TIT_BONUS = 3`); caché por `wkKey6`. `next6` → `status/why/rivalIn/gap` y `bench: status === 'out'`; deja de llamar a `benchFor`.
3. **Rol**: `STARTS_PROMOTE = 3`, `TIT_BROKEN = 2`, `promoteCheck6` nuevo (por `c.sq6.run`), `c.broken` por `titBench`, `ROLE_HINT6`
   (exportado como `HALL.ROLE_HINT`), `whyText6` (exportado como `HALL.benchWhy`). Playa intacta.
4. **Confianza sin jugar**: `TRAIN_COACH = 1`, `IMPACT_COACH = 2`, −2 al cambiarte (§A.3).
5. **Ofertas**: `depth6`, tope de rol, `FIT_START = 2`, `FIT_DEEP = 2`, `o.depth`, `negotiate6` con tope, `welcome6` con la competencia
   (§A.5).
6. **matchSetup6** según §I.1: titulares y banquillo desde `lineup6` (atributos con `genSt(ovr + form, pos, r)` + química, como hoy; los
   tuyos con fatiga y química), rival con su plantilla de `squad6` (5 suplentes), `names`, `coach` con `me`, `career.meOn/status`.
   `life(c, 'setup', out)` en career-life: si `out.meOn === false`, tu material y molestias van a `out.bench[0][out.meBench].st` (hoy
   van a `attrs[0][ctrlIdx]`).
7. **ingest/matchDone6/closeMine6/simulateNext6/benchNext6** según §A.6, §A.8 e §I.3 (`NOTA_MIN_R = 12`, `BENCH_XP = 20`); en
   `c.notes` solo partidos con nota (form/avgNota no deben ver null); estadísticas `starts/subIn/mr/rr`; `squadWeek6` en los tres
   cierres; mensajes de §A.7 (solo al cambiar de estado; «Buen cambio» y «Te he cambiado» tras el partido).
8. **career-life.js**: fama escalada por `sum.part.share` (mínimo 0,35) cuando hay nota; `sum.bench` ya cubre el resto. Comprobar
   `mate6` (usa `roster`) y que ningún reto de pista cuente «jornadas jugadas» con los partidos sin nota (el objetivo de patrocinio de
   pista cuenta jornadas: que siga contando las que tu equipo juega, como hoy).
9. **career-ui.js**: `renderMatch6` por estado (§A.7, botón «Jugar desde el banquillo»), Club › Equipo nuevo, ficha de oferta con
   profundidad, Contrato con `ROLE_HINT6` y «Esta temporada: {starts} de inicio, {subIn} desde el banquillo, {bench} sin jugar»,
   resumen tras el partido con `sum.part`, totales con «% de puntos jugados». Sin «·»; ordinales con `ordn`; textos neutros.
10. **careertest.js** (sección nueva «Carrera de pista: titularidad»):
    - `squad6` determinista, tamaños por puesto (12 / 14 con `SQ_BIG`), tú fuera de la lista, dorsales únicos sin el tuyo ni el 13.
    - Fichar por un club muy superior (forzar `k.ovr` +15) → J1 `status 'sub'`, `why 'new'` u 'ovr', bienvenida con «por delante».
    - Subir tu media/forma → pasa a 'start' y llega UN mensaje «Sales de inicio»; bajarla → 'sub' y «Empiezas en el banquillo».
    - Titular: 2 jornadas de suplente por méritos → `c.broken`; por fatiga ≥ 80 no cuenta. Indiscutible: siempre 'start' salvo fatiga ≥ 85.
    - Rotación: 3 inicios seguidos → Titular con sueldo de titular.
    - Club de 14 con `c.coach` < 20 → 'out', `n.bench` true y `benchNext6` como hoy.
    - Ofertas: toda oferta con `depth.start === false && depth.gap < −3` es Rotación; indiscutible solo con `start && gap >= 3`.
    - `matchSetup6`: 6+6 iniciales, 5+5 suplentes, `meOn`/`meSlot`/`meBench` coherentes, `coach[0].me.pullAt === 99` con indiscutible,
      `names` 6+6, tus atributos en tu sitio (inicio o banquillo).
    - `matchDone6` con eventos falsos: empiezas suplente (`g.career.meOn = false`), `sub` `meIn` a mitad → `share ≈ 0,5`, nota con
      `meR`, XP escalada, `starts` 0 y `subIn` 1; sin `meIn` → `nota null`, `sum.bench`, `stats.bench + 1`, `played` igual, XP = `BENCH_XP ×
      xpMul6`, `c.notes` sin entrada; partido sin eventos de cambio y sin `g.meR` → igual que hoy (el test viejo de 7 remates sigue).
    - `simulateNext6` siendo suplente: determinista con la misma semilla; en 40 semillas entra entre el 20 % y el 80 %.
    - Guardado viejo sin `c.sq6` carga y lo crea. `NOWORLD=1` también pasa.
    - Las secciones de playa siguen pasando sin tocarlas.

## T2. taskMatch (js/sim.js, js/ai6.js, js/main.js, js/ui.js, js/players.js, tools/subtest.js)

1. **sim.js**: `opts.bench/meSlot/meBench/names/coach` (§I.1); suplentes (§B.1), `g.subsOn`, `g.subs`, `g.subQ`, `g.coach`, `p.name`,
   `p.perf`, `p.tired` (con su pequeño efecto, solo con `g.subsOn`), `p.onR`, `g.meR`, `g.rallyN`, `g.ctrlOut`; `canSub`/`requestSub`/
   `cancelSub`/`subsLeft`/`benchOf`/`subInfo`/`defaultBench`/`SUB_MAX`; `applySubs` antes de `setupServe` (+`SUB_HOLD = 1.8` s);
   alineación entre sets en `nextSet` (evento `lineup`); eventos `sub`; `step` sin entrada del humano con `g.ctrlOut`. Todo detrás de
   `g.subsOn` (y `g.rot`): sin banquillo, el 6v6 CPU da lo mismo (1289 puntos, side-out 63,2 %) y la huella 2v2 sigue idéntica. Sin `g.rng`
   en nada nuevo (`hash01`). Campos numéricos nuevos con `dblFields` (`p.perf`, `p.tired`).
2. **ai6.js**: `AI6.coachPlan(g, t)` (§B.2 y §B.3), con las constantes `COACH = {perfPull: [4, 3, 3], tired: 0.8, fresh: 0.4,
   doubleFrom: 0.6, serveGap: 8, garbage: 8, reserve: 4}`. Comprobar que las formaciones aguantan el doble cambio (S en zona de
   opuesto) y los cambios OH↔OPP.
3. **main.js**: reenviar los campos nuevos en `startCareerMatch`; `bench` + `coach` en el Partido rápido 6v6 humano (`defaultBench`, ajuste
   `subs6`), no en el espectador; `g.watch0` y `g.watch = g.watch0 || g.ctrlOut` cada frame; «Saltar hasta que entres / al final» y ×3
   (`FF_CHUNK = 2` s, `FF_BUDGET = 8` ms), pasando los eventos a `careerEvents` y a ui.js; resincronizar players/cámara al parar;
   `careerEndSheet` con `sum.part` y nota null (§I.3). Escenas de prueba nuevas para `tools/shot.js`: `sub6` (rótulo de un cambio
   recién hecho), `bench6` (Carrera empezando en el banquillo, barra visible) y `subs6menu` (pausa con el menú Cambios abierto).
4. **ui.js**: rótulo de cambio y contador (§B.5), avisos de entrar/salir, barra del banquillo, botón y panel «Cambios» de la pausa
   (§B.4), ajuste «Cambios de tu equipo», textos de §B.6. Revisar los usos de `g.watch` que significan «espectador de verdad» (récord
   l. 2419, opciones de la hoja l. 2464, rótulos local/visitante l. 532/1688: van con `g.career` primero, pero que usen `g.watch0`).
5. **players.js** (si hace falta): precarga de rigs de `g.roster`, paseo con desfase o fundido de 0,3 s, fantasma del que sale, gesto de
   tablilla (opcional).
6. **tools/subtest.js** (node, carga sim.js + ai.js + ai6.js con `vm` como fingerprint6):
    - Sin `bench`: ni `g.subsOn` ni eventos `sub`; mismo nº de puntos y de llamadas a `g.rng` que el mismo partido antes del cambio
      (guardar la cifra de referencia en el propio test, medida con el código de hoy).
    - Reglas con `requestSub`: el 7º cambio del set → 'max'; titular que vuelve por otro → 'pair'; segunda salida del titular → 'back';
      suplente que ya salió → 'used'; el que está fuera por el líbero → 'libero'; los contadores vuelven a 0 en `newSet`; el líbero no gasta.
    - 40 semillas × partido completo con banquillo y `iq` 1-3: todo cambio legal (validador que rehace las reglas desde los eventos),
      media de cambios por partido entre 1 y 10, algún doble cambio y algún sacador especialista con `iq` 3 (y su vuelta), ningún NaN,
      todos los partidos acaban, side-out dentro de 56-68 %.
    - Carrera: `meBench` → `g.ctrlOut`, `g.ctrl` no está en `g.players`, la entrada del humano no mueve nada; con `enterLostSet` entra al
      perder un set (evento `lineup` con `meIn`); `pullAt` 3 con `perf` forzado → `sub` `meOut`; `pullAt` 99 → nunca; `g.meR` = puntos con
      tu jugador en pista (contado aparte desde los eventos).
    - Partido rápido: `requestSub` se aplica en el siguiente balón muerto; tu jugador → 'me'.
    - Determinismo: misma semilla → mismo registro de cambios.
7. Pruebas a pasar: `node tools/simtest.js` («huella 2v2 idéntica» y los 6v6 de siempre), `node tools/subtest.js`,
   `node tools/fingerprint6.js --variant mastery`, `bash tools/console.sh all`, `bash tools/console.sh all 1280 720 format=6v6`,
   `node tools/drive6.js 1280 720 60` (y `TOUCH=1` 844 390), `tools/tv6test.js`, `tools/cam6test.js`, `tools/perf.js` (6v6 humano con
   12 suplentes precargados: mismos objetivos), capturas de `sub6`, `bench6` y `subs6menu` a 1280×720 y 844×390, mirándolas.

## Fuera de alcance (v1)

Tiempos muertos (no existen aún en la sim), lesiones dentro del partido y su cambio excepcional, el humano entrenador en la Carrera,
cambios por puesto distinto salvo OH↔OPP, segundo líbero, y la playa (sin cambios por reglamento).
