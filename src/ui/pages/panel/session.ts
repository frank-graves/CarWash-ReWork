// src/ui/pages/panel/session.ts
// Estado de sesión del panel que NO vive en el shell porque más de una
// vista lo necesita. Cuando Firestore devuelve permission-denied, la
// uid anónima dejó de ser miembro del workspace (expulsión o enrolamiento
// roto). Ninguna request va a funcionar: hay que forzar wipe + re-enrolar.
//
// Simetría con range.ts: un módulo de estado compartido por el panel,
// no un signal dentro del shell.

import { signal } from '@preact/signals';

/** El usuario perdió acceso al workspace desde este dispositivo. */
export const sessionRevoked = signal(false);

/** El usuario sigue teniendo acceso, pero la red no responde. */
export const offline = signal(false);
