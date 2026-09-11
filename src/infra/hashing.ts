// src/infra/hashing.ts
// Huellas de matrícula para búsqueda exacta sin revelar la placa real en Firestore.
//
// HMAC y no SHA-256 a secas: el espacio de placas peruanas son unos pocos millones
// de combinaciones, así que un hash sin clave se revierte por fuerza bruta en
// minutos. Con clave, la huella solo la calcula quien tiene la bóveda abierta.

const cryptoEngine = globalThis.crypto;

export async function hashPlate(plate: string, hmacKey: CryptoKey): Promise<string> {
  // "ABC 123", "abc-123" y " ABC-123 " son la misma placa para el negocio.
  const normalized = plate.trim().toUpperCase().replace(/[\s-]/g, '');
  const signature = await cryptoEngine.subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode(normalized)
  );

  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
