# Cuentas (Firebase): diseño y estado

**Estado (10-nov-2026):** proyecto e infraestructura creados y probados. **Código del juego sin empezar**: se hace después del
sprint de menús, porque toca `ui.js`, `main.js` e `index.html`.

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
  - `key` es `squad`, `career` o `settings`;
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
