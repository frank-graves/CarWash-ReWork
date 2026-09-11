// src/infra/session-key.ts
// La clave maestra vive únicamente en RAM. Nunca toca localStorage ni sessionStorage.
// Si el navegador se cierra, la clave se pierde y los datos quedan sellados para siempre.
// Es el precio de la privacidad radical.
//
// Aquí no se deriva nada: la única puerta por la que una clave entra en la sesión es
// `adoptKey`, y quien la deriva es la bóveda. Un solo modelo de seguridad, no dos.

import { SessionLockedError } from '@infra/errors';

let sessionKey: CryptoKey | null = null;

export class SessionKeyManager {
  /**
   * Adopta una clave ya descifrada por la bóveda. Este módulo no sabe —ni quiere
   * saber— cómo se derivó el PIN ni dónde vive el blob.
   */
  static adoptKey(key: CryptoKey): void {
    sessionKey = key;
  }

  static lock(): void {
    // JS no permite borrar memoria, pero al perder la referencia
    // el Garbage Collector reclamará el CryptoKey eventualmente.
    sessionKey = null;
  }

  static isUnlocked(): boolean {
    return sessionKey !== null;
  }

  static getKey(): CryptoKey {
    if (!sessionKey) {
      throw new SessionLockedError();
    }
    return sessionKey;
  }
}
