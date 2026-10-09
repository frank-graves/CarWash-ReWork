// src/ui/pages/panel/session.ts
// Estado de sesión del panel que NO vive en el shell porque más de una
// vista lo necesita. Cuando Firestore devuelve permission-denied, la
// uid anónima dejó de ser miembro del workspace (expulsión o enrolamiento
// roto). Ninguna request va a funcionar: hay que forzar wipe + re-enrolar.
//
// Simetría con range.ts: un módulo de estado compartido por el panel,
// no un signal dentro del shell.

import { signal } from '@preact/signals';
import { signOut } from 'firebase/auth';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { Vault } from '@infra/vault';

/** El usuario perdió acceso al workspace desde este dispositivo. */
export const sessionRevoked = signal(false);

/** El usuario sigue teniendo acceso, pero la red no responde. */
export const offline = signal(false);

/**
 * Deja el dispositivo limpio y devuelve la app al wizard de enrolamiento.
 *
 * El orden importa y las dos primeras etapas son best-effort: si el wipe o el
 * signOut fallan, igual navegamos, porque quedarse en el overlay es el peor
 * final posible. Lo que NO es opcional es salir de /panel: el wizard vive en
 * '/' y recargar la misma ruta re-sirve el mismo HTML y vuelve al mismo estado.
 */
export async function revokeSessionAndGoHome(): Promise<void> {
  // 1. Borrar la bóveda local. Si falla, seguimos: la sesión de Firebase es
  //    lo crítico.
  try {
    await Vault.wipeDevice();
  } catch {
    // Nada. El wipe es best-effort; la sesión es lo que importa.
  }

  // 2. Cerrar la sesión anónima de Firebase. CRÍTICO: sin esto, la uid anónima
  //    sobrevive en firebaseLocalStorageDb (IndexedDB de Firebase, NO
  //    carwash-vault) y el wizard de enrolamiento reusa la misma uid expulsada
  //    → permission-denied en la próxima request.
  try {
    const runtime = await bootstrapFirebase();
    await signOut(runtime.auth);
  } catch {
    // Idem. Si esto falla, igual navegamos: peor es quedarse acá.
  }

  // 3. Navegación DURA al home. window.location.reload() en la misma ruta NO
  //    sirve: Astro re-sirve /panel con el mismo HTML y el boot vuelve al mismo
  //    estado. El wizard vive en '/'.
  window.location.href = '/';
}
