# Puente «Make the Cut» → «Take the Court»

Esta carpeta es el contenido ENTERO del repo nuevo y pequeño **purupurpito/make-the-cut**, que sirve la dirección antigua
`https://purupurpito.github.io/make-the-cut/` cuando el juego ya vive en `https://takethecourt.com/`.

localStorage es de cada origen: las partidas de los jugadores están en `purupurpito.github.io` y el juego nuevo no puede leerlas. El
puente sí, porque está en ese origen: lee SOLO las claves `make-the-cut.*` (y las viejas `voley3d.*`), nunca las de otros proyectos
del mismo origen (farolillo, emPat…), no borra nada, las empaqueta y salta a `https://takethecourt.com/#mig=<paquete>`. El juego
(`js/migrate.js`) las mete, une con lo que haya y enseña «Partida traída de Make the Cut». Diseño completo: `notes/dominio.md` del juego.

| Archivo | Para qué |
|---|---|
| `index.html` | el puente (todo en línea, sin dependencias salvo Google Fonts, que puede fallar sin problema) |
| `404.html` | copia EXACTA de `index.html`: enlaces profundos (`/make-the-cut/netlogs.html`, `/make-the-cut/loquesea`) llevan la ruta |
| `version.json` | `{"v":"1.20.0"}`: las pestañas viejas (1.15.1+) que siguen abiertas ven «Hay una versión nueva» → «Reiniciar» → puente |
| `.nojekyll` | que Pages no pase Jekyll |

**No hay `sw.js`**: el juego nunca registró un service worker ni usó Cache Storage ni IndexedDB (comprobado con grep en `js/` e
`index.html` de la 1.19.2), así que no hay cachés viejas que limpiar ni nada que desregistrar.

Opcional: copiar `icon.svg`, `icon-180.png`, `icon-192.png`, `icon-512.png` y `og.png` desde `pages/` del juego, para que las apps
instaladas viejas y las vistas previas de enlaces antiguos no reciban el HTML del 404. No hace falta para que el puente funcione.

Qué hace en cada caso:
- La sesión de la cuenta (`make-the-cut.account`, con su token) NO viaja: en takethecourt.com se vuelve a entrar y la nube trae lo suyo.
- Con partida: «Make the Cut ahora se llama Take the Court» y, a los 0,9 s, salta con la partida (ruta, `?sala=` y hash conservados).
- Sin partida: el mismo mensaje y salta sin `#mig`.
- Partida de más de 900 000 caracteres empaquetada (Firefox corta las direcciones hacia 1 MB): NO salta. «Descargar mi partida»
  (archivo `.json`) y «Abrir takethecourt.com» (abre `#migfile`, donde se elige el archivo). «Copiar código» solo hasta 200 000.
- App instalada con el nombre viejo (modo standalone): no salta sola; pide instalar otra vez desde takethecourt.com y da el botón,
  el archivo y el código. En iPhone la app instalada guarda aparte de Safari: el código o el archivo son la salida segura, y en el juego se meten en Ajustes › Info › «Traer tu partida» (también sin `#`).
- Siempre hay un botón «Ir a takethecourt.com» y un `<noscript>` con el enlace.

## Publicar (lo hace el lead, en este orden)

Antes de nada: la 1.20.0 terminada en `main`. Funciona también en la dirección antigua (rutas relativas; `js/migrate.js` no hace
nada sin `#mig`), PERO «Compartir» de una sala ya da `https://takethecourt.com/?sala=…`: publicarla justo antes del paso 3 (con 1 y 2
ya hechos), no días antes, o esos enlaces no abrirán hasta que el dominio esté listo.

1. **DNS de takethecourt.com** (se puede dejar hecho días antes):
   - apex `A` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - apex `AAAA` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - `www` `CNAME` → `purupurpito.github.io`
   - Si el DNS es Cloudflare: los registros en «DNS only» (nube gris) hasta que GitHub emita el certificado.
   - GitHub → Settings (de la cuenta) → Pages → **Verified domains** → añadir `takethecourt.com` (registro TXT): nadie más puede
     usar el dominio en Pages.
2. **Firebase y Google Cloud** (antes de cambiar nada, si no Google y la cuenta fallan en el dominio nuevo):
   - Consola de Firebase → Authentication → Settings → **Authorized domains** → añadir `takethecourt.com` (dejar
     `purupurpito.github.io` mientras dure el puente).
   - Google Cloud → APIs y servicios → Credenciales → la clave de la API web: si tiene **restricción por referente HTTP**, añadir
     `https://takethecourt.com/*`. Si no, fallan el correo, el usuario y Firestore (no solo Google).
   - El proyecto (`make-the-cut-vb`), las colecciones y las claves NO cambian: las salas online sirven en los dos orígenes a la vez.
3. **Renombrar el repo** `purupurpito/make-the-cut` → `purupurpito/take-the-court` (Settings → General → Repository name).
   Desde aquí la dirección antigua da 404 hasta el paso 6: hacer 3-6 seguidos.
4. **Dominio propio** en `take-the-court`: Settings → Pages → Custom domain → `takethecourt.com`, o
   `gh api -X PUT repos/purupurpito/take-the-court/pages -f cname=takethecourt.com`.
   OJO: Pages se publica con **Actions** (`.github/workflows/pages.yml`) y en ese modo GitHub **IGNORA el archivo `CNAME`** del
   artefacto (`tools/build-pages.js` lo escribe igual, por documentar y por si un día se publica desde una rama). El dominio solo
   cuenta si se pone en Settings o por la API. Relanzar el workflow (`gh workflow run pages.yml -R purupurpito/take-the-court`) y
   esperar al certificado; luego **Enforce HTTPS** (Settings → Pages, o `gh api -X PUT repos/purupurpito/take-the-court/pages -F https_enforced=true`).
5. **Comprobar** que `https://takethecourt.com/` sirve la 1.20.0 (`https://takethecourt.com/version.json` → `{"v":"1.20.0"}`) con
   certificado válido, y que la cuenta (entrar con usuario y con Google) funciona allí.
6. **Crear el puente**: repo público nuevo `purupurpito/make-the-cut` con el contenido de esta carpeta en la raíz (sin la carpeta
   `bridge/`), por ejemplo:
   ```sh
   mkdir mtc-bridge && cp -r <juego>/bridge/. mtc-bridge/ && cd mtc-bridge
   git init -b main && git add -A && git commit -m "Puente a takethecourt.com"
   gh repo create purupurpito/make-the-cut --public --source . --push
   gh api -X POST repos/purupurpito/make-the-cut/pages -f "source[branch]=main" -f "source[path]=/"
   ```
   Pages **desde la rama** `main` / raíz (sin Actions, sin dominio propio). Tarda 1-2 min.
   Si GitHub se queja de que el nombre está reservado por la redirección del repo renombrado, crear el repo igualmente: un repo
   nuevo con el nombre viejo sustituye a la redirección (los clones que apunten al nombre viejo dejan de redirigir; actualizar
   el remoto local con `git remote set-url origin https://github.com/purupurpito/take-the-court.git`).

### Comprobaciones
- `https://takethecourt.com/` → el juego 1.20.0; `https://www.takethecourt.com/` → redirige al apex.
- `https://purupurpito.github.io/take-the-court/` → redirige a `https://takethecourt.com/`.
- `https://purupurpito.github.io/make-the-cut/` → el puente; con partida, a los 0,9 s el juego y el aviso «Partida traída de Make the Cut».
- `https://purupurpito.github.io/make-the-cut/?sala=ABC123` → `https://takethecourt.com/?sala=ABC123`.
- `https://purupurpito.github.io/make-the-cut/netlogs.html` → `https://takethecourt.com/netlogs.html` (vía 404.html).
- `https://purupurpito.github.io/make-the-cut/version.json` → `{"v":"1.20.0"}`.
- Una pestaña vieja abierta (1.19.x) avisa «Hay una versión nueva»; «Reiniciar» → puente → juego con la partida.
- En el juego nuevo, una segunda visita al puente con el mismo guardado da el mismo paquete (sin hora) y sale «already»: no cambia nada ni enseña el aviso.
- Si algún dato no cabe en un enlace (más de 2 M en una clave o más de 200 claves), el puente no salta: ofrece archivo/código (admiten 5,5 M y 400).
- En local, todo esto lo prueba `node tools/migtest.js` (puente y juego en dos orígenes).

### Si algo sale mal (marcha atrás)
- Antes del paso 6: quitar el dominio (Settings → Pages) y renombrar `take-the-court` → `make-the-cut`: el juego vuelve a la
  dirección antigua tal cual (la 1.20.0 funciona en la subcarpeta; sin `#mig`, `js/migrate.js` no hace nada).
- Después del paso 6: borrar (o archivar y despublicar) el repo puente y hacer lo de arriba. Lo que los jugadores hayan jugado
  entretanto en takethecourt.com se queda en ese origen (no hay puente de vuelta); con cuenta, vuelve al entrar.
- Si solo falla el certificado o el DNS, basta con esperar: el puente no se publica hasta que el paso 5 está bien.

El puente no caduca: dejarlo publicado indefinidamente (no cuesta nada y hay jugadores que vuelven meses después).
