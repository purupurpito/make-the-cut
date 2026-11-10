# Cuentas (Firebase): diseño y estado

**Estado (10-nov-2026): hecho.** Código en `js/account.js` (VB.Account), cargado justo después de three.js y antes del resto,
para que vea todas las escrituras de los guardados.

## Cómo funciona el código
- **Detección de cambios:** envuelve `Storage.prototype.setItem` y `removeItem`. Cuando el juego escribe una de las cuatro claves
  (`voley3d.squad`, `voley3d.career`, `voley3d.settings`, `voley3d.record`), apunta la hora en `voley3d.account.meta` y, con sesión,
  sube ese documento a los ~1,5 s. El resto del juego no sabe nada de las cuentas.
- **Cuándo se sube:** también al ocultar la pestaña (`keepalive`) y al volver la red. En `voley3d.account.meta.up` queda lo que ya
  está subido.
- **Al entrar en la cuenta** se une lo de este dispositivo con lo de la cuenta, documento a documento:
  - si solo hay en uno de los dos lados, se copia al otro;
  - la primera vez en un dispositivo, el escuadrón se queda con el de más progreso y el récord con el de más partidos;
  - si hay dos Carreras distintas, se pregunta cuál quedarse;
  - si llega algo de la cuenta, la página se recarga con un aviso.
- **Al abrir el juego con sesión** (y al volver a la pestaña) se baja lo que sea más nuevo en la cuenta, comparando con la hora local.
  La recarga solo se hace en el menú, y una vez por sesión de pestaña.
- **Interfaz:** botón «Cuenta» (`#btnAcc`), solo en la página principal del menú y debajo de «Pantalla completa». Un punto indica el
  estado: turquesa sincronizado, amarillo sincronizando, rojo error. Abre el panel `#account` con:
  - sin sesión: entrar o crear cuenta;
  - con sesión: usuario, cuándo se guardó, «Sincronizar ahora», «Cerrar sesión» (lo del dispositivo se queda) y «Borrar la cuenta»
    (pide confirmación; borra los documentos y la cuenta).
- **Probado contra el Firebase real** con `tools/eval.js`:
  - crear una cuenta, subir experiencia y ver que llega;
  - entrar desde un navegador limpio y recibir el progreso;
  - dos Carreras distintas: pregunta con cuál quedarse;
  - borrar la cuenta y comprobar que ya no deja entrar.

  Las cuentas de prueba se borraron.

## Proyecto
- Proyecto Firebase **`make-the-cut-vb`** («Make the Cut»), es de la cuenta de Google de pruebas de Ferran. No escribir su correo en
  ningún fichero. No tiene Analytics.
- Firestore `(default)` en `eur3`. Acceso por usuario y contraseña (proveedor email/password).
- App web `1:676972390856:web:f3dfd69181c99fc36378fd`. La clave web es pública por diseño (va en el cliente, como en emPat Data):
  `apiKey: AIzaSyC59o9QtpUvjWT4g3ouOXinghASTuXZSes`.
- Configuración y reglas en `firebase/`. Se despliegan desde esa carpeta con `npx firebase-tools deploy --only firestore,auth`.
  Tras cambiar las reglas, esperar unos minutos a que se propaguen.

## Modelo (igual que emPat Data, pero sin cifrar)
- La app habla con Firebase por REST, sin librerías:
  - `identitytoolkit` para el alta y la entrada;
  - `securetoken` para renovar el token;
  - Firestore REST para los datos.
- Solo se pide usuario y contraseña, sin correo:
  - el correo es ficticio: `<usuario>@cuentas.make-the-cut.invalid`;
  - usuario en minúsculas, que cumpla `^[a-z0-9][a-z0-9._-]{2,29}$`.
- Documentos `users/{uid}/saves/{key}`:
  - `key` es `squad`, `career`, `settings` o `record`;
  - campos `{data: JSON en texto (≤ 400 kB), updatedAt: ms, v: int}`.
- Las reglas solo dejan leer y escribir al dueño y solo esas claves y campos (`firebase/firestore.rules`).
  Comprobado contra el Firebase real:
  - escribir y leer lo propio da 200;
  - una clave rara, otro usuario o una petición sin token dan 403.
- En el dispositivo, la sesión va en `voley3d.account` con `{user, uid, rt, it, ie}`. Nunca se guarda la contraseña.

## Comportamiento previsto
- **Panel «Cuenta» en el menú:** entrar, crear cuenta, cerrar sesión y borrar cuenta (borra los datos y luego la cuenta).
- **Sin cuenta o sin red**, todo sigue en local como ahora (`voley3d.squad`, `voley3d.career`, ajustes).
- **Al entrar:**
  - se une lo local con lo de la cuenta, documento a documento, y gana el `updatedAt` más reciente;
  - si los dos existen y son distintos, se pregunta cuál quedarse (sobre todo la Carrera).
- **Sincronización:**
  - se sube al acabar un partido, al subir una estadística, en la Carrera tras cada jornada o decisión, y al cambiar un ajuste;
  - con un retardo de unos 2 s y reintento al volver la red o la pestaña.
- **Contraseña olvidada:** no hay recuperación porque no hay correo. Hay que avisarlo al crear la cuenta.
- **Pruebas:** una herramienta tipo `tools/cuentatest.mjs` contra el Firebase de verdad, que borre su cuenta al acabar (como
  `t-cuenta.mjs` de emPat Data).
