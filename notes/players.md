# notes/players.md — atletas y animación (owner: players)

Fichero: `js/players.js`. Interfaces de CONTRACT.md §4 intactas. Fecha: 2026-11-06 (pasada de cierre).

## Estado
- Atletas procedurales: UNA SkinnedMesh por atleta (piel rígida por hueso, ~10k triángulos, 1 dibujo + 1 sombra), atlas por jugador, brillo de contorno en el shader estándar,
  IK de dos huesos para brazos y piernas, pose objetivo por capas amortiguada, pies sin patinar.
- **Dorsales** (pendiente de foundation): HECHO. Número grande en la espalda y pequeño en el pecho, blanco con filo del color
  oscuro del equipo, pegado a la curva del tronco; se redibuja cuando la UI ha cargado Barlow Condensed (sin peticiones nuevas).
- Peticiones de `notes/sim.md` §5 "players": todas HECHAS y comprobadas con capturas cercanas:
  1. `toss`: flotante = brazo izquierdo sube con el balón, derecho armado atrás (arco), golpe al bajar el balón;
     saque en salto = lanzamiento alto, carrera con brazos atrás, en el aire pose de remate (no de bloqueo).
     Arreglado en esta pasada: mientras el balón del lanzamiento SUBE, `hitWindow().t` es negativo (ya cruzó la altura de contacto
     de subida) y el brazo se soltaba 0,5 s antes de tiempo; ahora se usa el tiempo hasta la bajada.
  2. `dive`: salida rápida hacia el balón (ya lanzado en el contacto), cuerpo horizontal con brazos estirados, tumbado mientras
     `p.down > 0` y se levanta al acabar. Dirección: `dive.dir`.
  3. Dejada (`shot === 'tip'`): brazo extendido arriba con empuje de muñeca, sin latigazo ni giro de tronco.
  4. `grade === 'perfect'` en remate/saque: latigazo más largo y cruzado, más cierre de tronco. `point.how === 'block'`:
     el bloqueador "ruge" (cae, abre los brazos con los puños cerrados, pecho fuera); su compañero celebra a su manera.
- Plancha cosmética: si el balón cae dentro a 0,9–3,4 m del defensor más cercano que no llegó, se lanza igualmente (solo visual).

## API (sin cambios de firma; todo opcional)
- `VB.Players.rigOf(p)` → rig con `root, body, pelvis, chest, head, handL, handR, footL, footR` (Object3D) y `scale`.
- `VB.Players.handWorld(p, right?, out?)` → posición mundial (Three) de la mano derecha (o izquierda con `right === false`).
- `VB.Players.rigs` (array de rigs del partido actual).
- `setQuality(q)`: en calidad baja solo baja el filtrado anisótropo del atlas (cada atleta ya es 1 dibujo + 1 sombra).

## Problemas conocidos
- Al levantarse de la plancha (≈0,55 s) la sim ya puede mover al jugador: se ve un breve deslizamiento mientras se incorpora.
- El trayecto del brazo del armado al contacto es una interpolación de la posición de la mano: puede rozar la cabeza un par de frames.

## Peticiones a otros owners
Ninguna pendiente.

## Aplicado (log)
- 6-nov-2026 (Integrate, PC de casa): escenas `toss`, `jumpserve` y `dive` ya están en main.js (`tools/shot.sh toss|jumpserve|dive`).

- 6-nov-2026 (Review 1, fixer players):
  - Coste: medido a `quality=low` en `debug=rally`: 4 mallas de atletas en el pase principal y 4 en sombras (antes 71 + 40).
  - Remate: armado "arco y flecha" real (mano junto a la oreja, codo alto y atrás, tronco girado y arqueado, rodillas atrás),
    latigazo en arco cúbico de ~0,15 s hasta el contacto previsto (antes 0,2 s lineal: se leía como empujón a dos manos),
    contacto con el brazo estirado delante del hombro derecho, izquierda recogida al pecho, acompañamiento en 0,14 s cruzando
    hasta la cadera izquierda. Despegue: los dos brazos vienen estirados de atrás y suben por delante (arco).
  - Bloqueo: comprobado con `debug=block` y `debug=spike`: manos por encima de la cinta (~3,0 m) y 0,15-0,2 m al otro lado de la red.
    En postura de red (espera del ataque rival) el paso lateral ya no baja las manos a la carrera.
  - Comprobación con tira de fotogramas: `tools/out/fix-players/film.js` (reproduce la jugada con la misma semilla y cámara
    relativa al jugador; uso en la cabecera del fichero).

## Aplicado (log, integración tras Review 1)
- main.js `debug=jumpserve`: 145 pasos tras el lanzamiento (antes 105): sacador a ~1 m en el aire, armado, contacto a ~0,12 s
  (150 dejaba el contacto a 0,075 s, ya en pleno latigazo). Comprobado con captura y en node (el balón aún no se ha golpeado).

## Aplicado (log, Review 2, fixer players)
- Recepción de antebrazos (`passPose`): plataforma con brazos RECTOS (manos a un brazo exacto del centro de hombros, calculado con
  `shoulderC`), muñecas juntas, hombros encogidos; la altura se busca con piernas/cadera. Ángulo de plataforma limitado a
  [-49º, -11º] (balón alto: plataforma alta a la altura del pecho con el tronco algo atrás); el acompañamiento sale de las piernas
  (+6º de plataforma como mucho). Nunca manos juntas delante de la cara. 3er toque `free` con `shot:'forearm'` usa también la plataforma.
- Bloqueo: de frente a la red en el aire (giro limitado a ±10º), hombros a las orejas, brazos rectos y paralelos inclinados 20-40º
  hacia el rival según la distancia a la red (se echa hasta 0,5 m hacia la red, solo visual); manos ~0,1-0,25 m al otro lado.
- Remate: armado "arco y flecha" más legible (mano junto a la oreja, codo alto, abierto y atrás). Acompañamiento sin "plegarse":
  pecho <= ~27º, cabeza arriba, brazo cruzando a la cadera izquierda, izquierda recogida. Contacto bajo para el salto: el cuerpo
  visual baja hasta 0,22 m (anticipado con la predicción) para golpear con el brazo estirado en vez de con el codo junto a la cabeza.
- Saque flotante: contacto con el brazo totalmente estirado arriba-delante y muñeca firme, sin acompañamiento (~0,16 s), la
  izquierda cae al costado; el brazo arma en arco por el lado de la cabeza (ya no cruza la cara). Saque en salto: arco y flecha.
- Plancha: en ~0,1-0,2 s el cuerpo va horizontal a 0,25-0,4 m del suelo con los brazos estirados (mano derecha plana delante),
  piernas detrás; cae de pecho y se desliza 0,12 m; luego se levanta como antes.
- Modelo: antebrazos más gruesos (0,05→0,037 m), brazo algo más grueso, mano "manopla" (palma ancha y plana con cápsulas, dedos de
  punta redonda algo abiertos, pulgar marcado). El "cinturón" de la cintura era el pantalón que asomaba por la camiseta (parpadeo):
  bajo de la camiseta algo abierto y cintura del pantalón más estrecha, ribete del bajo fino en tono de la camiseta (sin franja
  oscura de 18 px). Dorsal del pecho más ancho (la curva lo estrechaba). Postura de red: manos a la altura del hombro, delante.
- Comprobado con tiras de fotogramas (`tools/out/fix2-players/film.js`, `LOOKZ=` altura del punto de mira) y primeros planos
  (`tools/out/fix2-players/close.sh`), `console.sh` sin errores en rally/spike/block/dive/jumpserve/toss/point, simtest rápido OK.

## Aplicado (log, integración tras Review 2)
- 6-nov-2026 (integración tras Review 2): reacción a `hit.shot === 'body'` (se encoge, gira el tronco apartándose, manos al pecho; antes salía la pose de
  antebrazos); marcador blanco (petición de arena) y cono oculto en el aire / con el saque lanzado; con `VB.FX.dust` las planchas
  cosméticas (evento `land`) sueltan polvo a los ~0,18 s (`r.cosDust`). `block.result 'touch'` usa el gesto de 'soft'.
