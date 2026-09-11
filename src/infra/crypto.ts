// src/infra/crypto.ts
// Bóveda criptográfica local. Todo el PII se sella aquí antes de tocar la red.
// Usamos Web Crypto API nativa para evitar dependencias de 500KB como crypto-js.

const cryptoEngine = globalThis.crypto;
const IV_LENGTH_BYTES = 12; // Estándar NIST para GCM

export class PrivacyVault {
  /**
   * Sella un objeto arbitrario. El IV viaja junto al ciphertext en el mismo bundle
   * porque GCM lo requiere para el descifrado y no es secreto.
   */
  static async encryptPayload(data: unknown, key: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(data));
    const iv = cryptoEngine.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

    const ciphertext = await cryptoEngine.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
    );

    // Concatenamos IV + Ciphertext para tener un único blob transportable
    const bundle = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    bundle.set(iv, 0);
    bundle.set(new Uint8Array(ciphertext), iv.byteLength);

    return this.toBase64(bundle);
  }

  static async decryptPayload(bundle: string, key: CryptoKey): Promise<unknown> {
    const rawBundle = this.fromBase64(bundle);
    
    const iv = rawBundle.slice(0, IV_LENGTH_BYTES);
    const ciphertext = rawBundle.slice(IV_LENGTH_BYTES);

    const plaintextBuffer = await cryptoEngine.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(plaintextBuffer);
    
    try {
      return JSON.parse(jsonStr);
    } catch {
      throw new Error('El payload descifrado no es JSON válido. Posible corrupción de datos.');
    }
  }

  // Conversión Base64 nativa. btoa/atob fallan con bytes > 255 o Unicode directo,
  // por lo que forzamos la conversión a string binario puro.
  private static toBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    return btoa(binary);
  }

  private static fromBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}