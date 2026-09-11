// src/infra/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { PrivacyVault } from '@infra/crypto';
import { hashPlate } from '@infra/hashing';

describe('PrivacyVault', () => {
  const samplePII = {
    displayName: 'Juan Pérez',
    plate: 'ABC-123',
    phone: '+51999888777',
  };

  // Antes estas pruebas sacaban la clave de PrivacyVault.deriveKey, borrado por
  // código muerto: la derivación canónica vive en vault.ts con 200k iteraciones.
  // Para un round-trip basta una clave AES-GCM, generada igual que freshHmacKey().
  function freshAesKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
  }

  it('preserva la integridad del objeto en un ciclo encrypt -> decrypt', async () => {
    const key = await freshAesKey();
    const bundle = await PrivacyVault.encryptPayload(samplePII, key);
    const decrypted = await PrivacyVault.decryptPayload(bundle, key);
    
    expect(decrypted).toEqual(samplePII);
  });

  it('falla al descifrar con una clave distinta (el tag GCM no valida)', async () => {
    const keyA = await freshAesKey();
    const keyB = await freshAesKey();
    
    const bundle = await PrivacyVault.encryptPayload(samplePII, keyA);
    
    await expect(PrivacyVault.decryptPayload(bundle, keyB)).rejects.toThrow();
  });

  it('detecta alteraciones en el ciphertext (integridad GCM)', async () => {
    const key = await freshAesKey();
    const bundle = await PrivacyVault.encryptPayload(samplePII, key);
    
    // Bit-flip en el último carácter del base64 (corrompe el ciphertext o el tag MAC)
    const tamperedBundle = bundle.slice(0, -1) + (bundle.endsWith('A') ? 'B' : 'A');
    
    await expect(PrivacyVault.decryptPayload(tamperedBundle, key)).rejects.toThrow();
  });

  it('genera ciphertexts distintos para el mismo input (IV aleatorio)', async () => {
    const key = await freshAesKey();
    const bundle1 = await PrivacyVault.encryptPayload(samplePII, key);
    const bundle2 = await PrivacyVault.encryptPayload(samplePII, key);
    
    expect(bundle1).not.toBe(bundle2);
  });
});

describe('hashPlate', () => {
  function freshHmacKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }

  it('normaliza la placa y firma HMAC-SHA256: hex de 64 caracteres que depende de la clave', async () => {
    const hmacKey = await freshHmacKey();
    const otherKey = await freshHmacKey();

    const hash1 = await hashPlate(' abc-123 ', hmacKey);
    const hash2 = await hashPlate('ABC-123', hmacKey);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    // Sin la clave no hay huella: es lo que impide revertir placas por brute-force
    // sobre un espacio de pocos millones de combinaciones.
    expect(await hashPlate('ABC-123', otherKey)).not.toBe(hash1);
  });
});
