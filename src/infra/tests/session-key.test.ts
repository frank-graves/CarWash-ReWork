// src/infra/tests/session-key.test.ts
// SessionKeyManager ya no deriva nada: solo custodia la referencia a la clave.
// Los tres tests cubren las tres transiciones posibles de ese contrato.

import { beforeEach, describe, expect, it } from 'vitest';
import { SessionLockedError } from '@infra/errors';
import { SessionKeyManager } from '@infra/session-key';

function freshAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

describe('SessionKeyManager', () => {
  beforeEach(() => {
    SessionKeyManager.lock();
  });

  it('getKey sin adoptKey lanza SessionLockedError', () => {
    expect(SessionKeyManager.isUnlocked()).toBe(false);
    expect(() => SessionKeyManager.getKey()).toThrow(SessionLockedError);
  });

  it('adoptKey abre la sesión y getKey devuelve la misma referencia', async () => {
    const key = await freshAesKey();
    SessionKeyManager.adoptKey(key);

    expect(SessionKeyManager.isUnlocked()).toBe(true);
    expect(SessionKeyManager.getKey()).toBe(key);
  });

  it('lock remueve la clave y cierra la sesión', async () => {
    SessionKeyManager.adoptKey(await freshAesKey());
    SessionKeyManager.lock();

    expect(SessionKeyManager.isUnlocked()).toBe(false);
    expect(() => SessionKeyManager.getKey()).toThrow(SessionLockedError);
  });
});
