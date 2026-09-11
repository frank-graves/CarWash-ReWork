// src/infra/vault.ts
// Bóveda local de dos capas.
//
// La Master Key NO se deriva del PIN: se genera aleatoria y se envuelve dos veces
// —una con la clave derivada del PIN, otra con la derivada de la frase de
// recuperación—. Cambiar el PIN re-envuelve 32 bytes y ya. Los datos del negocio no
// se tocan: ese es todo el motivo del doble blob.
//
// Dentro del mismo sobre viajan dos secretos: la Master Key (cifra el PII) y la
// clave HMAC (firma las huellas de matrícula). Van juntos porque se abren juntos.
//
// El "binding al dispositivo" no es una feature que hayamos añadido: es la
// consecuencia de que blobs y salts vivan en IndexedDB. Borrar el navegador sella
// los datos de la nube para siempre, para el operador y también para nosotros.

import { RECOVERY_WORDS, wordAt } from '@core/wordlist';
import { SessionLockedError } from '@infra/errors';
import { SessionKeyManager } from '@infra/session-key';

export const VAULT_DB_NAME = 'carwash-vault';

const VAULT_STORE = 'keys';

// Modelo de amenaza explícito: un PIN de 6 dígitos son 1M de combinaciones.
// El rate limiting (LOCKOUT_LADDER más abajo) protege contra ataques vía
// UI, pero NO contra un atacante con acceso al archivo de IndexedDB
// (dispositivo robado, backup comprometido). Ese atacante puede hacer
// brute-force offline contra blobPin sin pasar por la aplicación.
// A 200k iteraciones y ~50k hashes/segundo en GPU moderna, son ~5 horas
// por dispositivo. Para un negocio local, aceptable. Si el modelo de
// amenaza escala (múltiples sucursales con datos sensibles), migrar a
// WebAuthn con huella o PIN alfanumérico de 8+ caracteres.
const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // NIST SP 800-38D: 96 bits es el único IV para GCM que no pasa por GHASH
const AES_BITS = 256;
const MASTER_KEY_BYTES = AES_BITS / 8;
const HMAC_KEY_BYTES = 32;
const PHRASE_WORDS = 12;
const PIN_PATTERN = /^[0-9]{6}$/;

// Nombres de slot en un objeto y no repartidos como strings sueltos por el archivo:
// aquí un typo no lo caza el compilador, y un typo en un slot es un dispositivo que
// no abre nunca más.
const Slot = {
  saltPin: 'saltPin',
  saltPhrase: 'saltRec',
  ivPin: 'ivPin',
  ivPhrase: 'ivRec',
  blobPin: 'blobPin',
  blobPhrase: 'blobRec',
  workspaceId: 'workspaceId',
  failedAttempts: 'failedAttempts',
  lockedUntil: 'lockedUntil',
} as const;

type SlotName = (typeof Slot)[keyof typeof Slot];

// --- Conexión ---------------------------------------------------------------

// Una sola conexión cacheada para todo el módulo. Antes abríamos una por lectura
// (nueve por initDevice) y no cerrábamos ninguna: conexiones zombis que bloquean
// cualquier deleteDatabase futuro. Ese fallo se paga en producción, no en los tests.
let connection: Promise<IDBDatabase> | null = null;

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(VAULT_STORE);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB rechazó la apertura de la bóveda'));
    };

    request.onsuccess = () => {
      const db = request.result;
      // Otra pestaña pide un upgrade: soltamos la conexión en vez de bloquearla.
      // Un operador con dos pestañas abiertas no debería congelar la aplicación.
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
  });
}

function vaultDb(): Promise<IDBDatabase> {
  if (connection) return connection;

  const pending = openVault();
  // Una apertura fallida no puede envenenar el módulo para siempre.
  pending.catch(() => {
    if (connection === pending) connection = null;
  });
  connection = pending;
  return pending;
}

async function read<T>(slot: SlotName): Promise<T | undefined> {
  const db = await vaultDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(VAULT_STORE, 'readonly').objectStore(VAULT_STORE).get(slot);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error(`No se pudo leer ${slot} de la bóveda`));
  });
}

async function write(entries: readonly (readonly [SlotName, unknown])[]): Promise<void> {
  const db = await vaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    const store = tx.objectStore(VAULT_STORE);
    for (const [slot, value] of entries) store.put(value, slot);

    // Resolvemos en oncomplete, no en el último onsuccess: en una transacción
    // readwrite el commit todavía puede fallar después de que los puts "terminen".
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('La bóveda rechazó la escritura'));
    tx.onabort = () => reject(tx.error ?? new Error('Escritura de la bóveda abortada'));
  });
}

// --- Criptografía -----------------------------------------------------------

// La clave que firma las huellas de matrícula. Vive al lado de la sesión pero no
// dentro de SessionKeyManager: el gestor de sesión no tiene por qué saber que
// existen HMACs, ni acoplarse a un segundo algoritmo.
let hmacKey: CryptoKey | null = null;

function freshBytes(length: number): Uint8Array<ArrayBuffer> {
  // getRandomValues es el CSPRNG del sistema. Aquí no hay Math.random disfrazado.
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveKey(secret: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: AES_BITS },
    false, // la clave que envuelve tampoco se extrae: solo envuelve y desenvuelve
    ['encrypt', 'decrypt'],
  );
}

function importMasterKey(bytes: BufferSource): Promise<CryptoKey> {
  // La llave que acaba en la sesión es no-extraíble: los bytes crudos de la Master
  // Key solo viven en este hilo el tiempo que dura envolverlos.
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: AES_BITS }, false, [
    'encrypt',
    'decrypt',
  ]);
}

function importHmacKey(bytes: BufferSource): Promise<CryptoKey> {
  // Un solo uso y no extraíble: firmar. Ni leer ni exportar.
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * Devuelve `null` solo si el tag GCM no valida: PIN o frase equivocados.
 *
 * La derivación queda FUERA del try a propósito. Si lo que falla es el motor
 * criptográfico, quiero ver ese error, no un "credencial incorrecta" que me mande
 * a depurar el sitio equivocado durante media tarde.
 */
async function unwrapSecrets(
  secret: string,
  salt: ArrayBuffer,
  iv: ArrayBuffer,
  blob: ArrayBuffer,
): Promise<ArrayBuffer | null> {
  const wrappingKey = await deriveKey(secret, new Uint8Array(salt));
  try {
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      wrappingKey,
      blob,
    );
  } catch {
    return null;
  }
}

// --- Frase de recuperación --------------------------------------------------

function generateRecoveryPhrase(): string {
  const bytes = freshBytes(PHRASE_WORDS);
  const words: string[] = [];
  for (const byte of bytes) words.push(wordAt(byte));
  return words.join(' ');
}

/**
 * Deja la frase en su forma canónica: minúsculas, sin tildes, separada por espacios.
 *
 * El operador la va a teclear una vez, a mano, desde un papel: vendrá con mayúsculas,
 * con comas, con saltos de línea y con "atún" donde la lista dice "atun". Rechazar
 * eso sería rechazar la frase correcta y dejar al negocio fuera de sus datos.
 */
export function normalizePhrase(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function isRecoveryPhrase(canonical: string): boolean {
  const words = canonical.split(' ');
  return words.length === PHRASE_WORDS && words.every((word) => RECOVERY_WORDS.includes(word));
}

// --- Bloqueo por intentos ---------------------------------------------------

interface LockoutRule {
  readonly attempts: number;
  readonly seconds: number;
}

// Escalada. Los cuatro primeros fallos son gratis (dedos gordos, prisa, un niño
// jugando con el móvil); a partir del quinto el coste disuade de verdad. El contador
// NO se resetea al expirar el bloqueo: quien insiste, espera más cada vez.
const LOCKOUT_LADDER: readonly LockoutRule[] = [
  { attempts: 5, seconds: 30 },
  { attempts: 6, seconds: 120 },
  { attempts: 7, seconds: 600 },
  { attempts: 8, seconds: 3600 },
  { attempts: 9, seconds: 86_400 },
];

function lockoutMsFor(failedAttempts: number): number {
  let seconds = 0;
  for (const rule of LOCKOUT_LADDER) {
    if (failedAttempts >= rule.attempts) seconds = rule.seconds;
  }
  return seconds * 1000;
}

async function registerFailure(now: number): Promise<void> {
  const failed = ((await read<number>(Slot.failedAttempts)) ?? 0) + 1;
  const lockout = lockoutMsFor(failed);
  await write([
    [Slot.failedAttempts, failed],
    [Slot.lockedUntil, lockout > 0 ? now + lockout : 0],
  ]);
}

// --- API --------------------------------------------------------------------

export interface VaultInitInput {
  workspaceId: string;
  pin: string;
}

export interface VaultInitResult {
  recoveryPhrase: string;
}

export class Vault {
  /**
   * Primera vez en este dispositivo. Genera la Master Key y la clave HMAC, las
   * envuelve juntas con las dos capas y deja la sesión abierta.
   *
   * La frase de recuperación sale de aquí UNA sola vez: no se guarda en claro en
   * ningún sitio y no hay forma de volver a mostrarla. Quien la pierda, la pierde.
   */
  static async initDevice(input: VaultInitInput): Promise<VaultInitResult> {
    const workspaceId = input.workspaceId.trim();
    if (!workspaceId) throw new Error('Falta el identificador del negocio');
    if (!PIN_PATTERN.test(input.pin)) throw new Error('El PIN debe tener exactamente 6 dígitos');

    // Re-inicializar encima de una bóveda viva dejaría huérfano todo lo cifrado con
    // la Master Key anterior. Para eso está la frase de recuperación, no este método.
    if (await Vault.isDeviceInitialized()) {
      throw new Error('Este dispositivo ya tiene una bóveda configurada');
    }

    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: AES_BITS }, true, [
      'encrypt',
      'decrypt',
    ]);
    const masterKeyBytes = await crypto.subtle.exportKey('raw', masterKey);
    const hmacKeyBytes = freshBytes(HMAC_KEY_BYTES);

    // Dos secretos, un solo sobre. Envolverlos por separado costaría dos wraps más
    // y obligaría al PIN a descifrar dos veces para abrir la misma sesión.
    const combined = new Uint8Array(MASTER_KEY_BYTES + HMAC_KEY_BYTES);
    combined.set(new Uint8Array(masterKeyBytes), 0);
    combined.set(hmacKeyBytes, MASTER_KEY_BYTES);

    const saltPin = freshBytes(SALT_BYTES);
    const saltPhrase = freshBytes(SALT_BYTES);
    const ivPin = freshBytes(IV_BYTES);
    const ivPhrase = freshBytes(IV_BYTES);
    const recoveryPhrase = generateRecoveryPhrase();

    // Dos PBKDF2 de 200k: del orden de un segundo en el hardware objetivo. Bloquea
    // el hilo principal, sí. Es el precio de que un PIN de seis dígitos valga algo.
    const pinKey = await deriveKey(input.pin, saltPin);
    const phraseKey = await deriveKey(recoveryPhrase, saltPhrase);

    const blobPin = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivPin }, pinKey, combined);
    const blobPhrase = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivPhrase },
      phraseKey,
      combined,
    );

    // Una sola transacción: o queda la bóveda entera, o no queda nada. Escribir los
    // nueve slots de uno en uno y morir a mitad dejaba un dispositivo con saltPin
    // pero sin blobPin: imposible de abrir e imposible de resetear. Un ladrillo.
    await write([
      [Slot.saltPin, saltPin.buffer],
      [Slot.saltPhrase, saltPhrase.buffer],
      [Slot.ivPin, ivPin.buffer],
      [Slot.ivPhrase, ivPhrase.buffer],
      [Slot.blobPin, blobPin],
      [Slot.blobPhrase, blobPhrase],
      [Slot.workspaceId, workspaceId],
      [Slot.failedAttempts, 0],
      [Slot.lockedUntil, 0],
    ]);

    // La sesión se abre cuando la bóveda ya está en disco. Al revés, un fallo de
    // escritura nos dejaría operando con claves que nadie podrá volver a abrir.
    SessionKeyManager.adoptKey(await importMasterKey(masterKeyBytes));
    hmacKey = await importHmacKey(hmacKeyBytes);

    return { recoveryPhrase };
  }

  /**
   * Verifica un PIN contra el blobPin y aplica el rate limiting compartido.
   * Extraído para que changePin comparta el mismo lockout que unlockWithPin:
   * antes eran dos puertas al mismo secreto, y solo una tenía freno.
   */
  private static async verifyPin(pin: string): Promise<ArrayBuffer> {
    const now = Date.now();
    const lockedUntil = (await read<number>(Slot.lockedUntil)) ?? 0;
    if (now < lockedUntil) {
      const seconds = Math.ceil((lockedUntil - now) / 1000);
      throw new Error(`Dispositivo bloqueado. Vuelve a intentarlo en ${seconds}s.`);
    }

    const saltPin = await read<ArrayBuffer>(Slot.saltPin);
    const ivPin = await read<ArrayBuffer>(Slot.ivPin);
    const blobPin = await read<ArrayBuffer>(Slot.blobPin);
    if (!saltPin || !ivPin || !blobPin) {
      // Distinguir esto de "PIN incorrecto" ahorra mediodías de soporte telefónico.
      throw new Error('Este dispositivo no tiene una bóveda configurada');
    }

    const combined = await unwrapSecrets(pin, saltPin, ivPin, blobPin);
    if (!combined) {
      // El contador de intentos es telemetría de seguridad, no la operación: si no
      // se puede escribir, el PIN sigue siendo el error que el operador debe ver.
      await registerFailure(now).catch(() => undefined);
      throw new Error('PIN incorrecto');
    }

    await write([
      [Slot.failedAttempts, 0],
      [Slot.lockedUntil, 0],
    ]);
    return combined;
  }

  /**
   * Verifica la frase de recuperación con el mismo rate limiting que el PIN.
   * Sin esto, la frase de 12 palabras era una vía sin coste al mismo secreto.
   */
  private static async verifyPhrase(phrase: string): Promise<ArrayBuffer> {
    const now = Date.now();
    const lockedUntil = (await read<number>(Slot.lockedUntil)) ?? 0;
    if (now < lockedUntil) {
      const seconds = Math.ceil((lockedUntil - now) / 1000);
      throw new Error(`Dispositivo bloqueado. Vuelve a intentarlo en ${seconds}s.`);
    }

    const saltPhrase = await read<ArrayBuffer>(Slot.saltPhrase);
    const ivPhrase = await read<ArrayBuffer>(Slot.ivPhrase);
    const blobPhrase = await read<ArrayBuffer>(Slot.blobPhrase);
    if (!saltPhrase || !ivPhrase || !blobPhrase) {
      throw new Error('Este dispositivo no tiene una bóveda configurada');
    }

    const combined = await unwrapSecrets(phrase, saltPhrase, ivPhrase, blobPhrase);
    if (!combined) {
      await registerFailure(now).catch(() => undefined);
      throw new Error('Frase de recuperación incorrecta');
    }

    await write([
      [Slot.failedAttempts, 0],
      [Slot.lockedUntil, 0],
    ]);
    return combined;
  }

  static async unlockWithPin(pin: string): Promise<void> {
    const combined = await Vault.verifyPin(pin);
    const secrets = new Uint8Array(combined);
    const masterKeyBytes = secrets.slice(0, MASTER_KEY_BYTES);
    const hmacKeyBytes = secrets.slice(MASTER_KEY_BYTES, MASTER_KEY_BYTES + HMAC_KEY_BYTES);
    SessionKeyManager.adoptKey(await importMasterKey(masterKeyBytes));
    hmacKey = await importHmacKey(hmacKeyBytes);
  }

  static async isDeviceInitialized(): Promise<boolean> {
    return (await read<ArrayBuffer>(Slot.saltPin)) !== undefined;
  }

  static async getLockoutRemainingMs(): Promise<number> {
    const lockedUntil = (await read<number>(Slot.lockedUntil)) ?? 0;
    const remaining = lockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Última puerta: la frase de recuperación. Descifra los dos secretos con ella, los
   * vuelve a envolver con un PIN nuevo y rota salt e IV del PIN.
   */
  static async resetWithRecovery(recoveryPhrase: string, newPin: string): Promise<void> {
    const canonical = normalizePhrase(recoveryPhrase);
    if (!isRecoveryPhrase(canonical)) {
      throw new Error('Frase de recuperación inválida');
    }
    if (!PIN_PATTERN.test(newPin)) throw new Error('El nuevo PIN debe tener exactamente 6 dígitos');

    const combined = await Vault.verifyPhrase(canonical);

    // Rotamos también el salt del PIN. Reutilizar el viejo daría dos derivaciones del
    // mismo material contra el mismo salt, y el PBKDF2 extra lo pagamos igual. En el
    // papel cuesta lo mismo; en un análisis, no.
    const saltPin = freshBytes(SALT_BYTES);
    const ivPin = freshBytes(IV_BYTES);
    const pinKey = await deriveKey(newPin, saltPin);
    const blobPin = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivPin }, pinKey, combined);

    await write([
      [Slot.saltPin, saltPin.buffer],
      [Slot.ivPin, ivPin.buffer],
      [Slot.blobPin, blobPin],
      [Slot.failedAttempts, 0],
      [Slot.lockedUntil, 0],
    ]);

    const secrets = new Uint8Array(combined);
    const masterKeyBytes = secrets.slice(0, MASTER_KEY_BYTES);
    const hmacKeyBytes = secrets.slice(MASTER_KEY_BYTES, MASTER_KEY_BYTES + HMAC_KEY_BYTES);
    SessionKeyManager.adoptKey(await importMasterKey(masterKeyBytes));
    hmacKey = await importHmacKey(hmacKeyBytes);
  }

  /**
   * Rotación de PIN rutinaria. La jefa cambia su PIN de 6 dígitos sin necesidad
   * de usar la frase de recuperación de 12 palabras. Re-envuelve los secretos
   * con un salt y un IV frescos, pero la Master Key subyacente no cambia:
   * los datos en la nube no se tocan, solo el candado local.
   *
   * No exige sesión abierta: descifra el blob con el PIN actual, así que sirve
   * también con la tablet recién encendida y bloqueada.
   */
  static async changePin(currentPin: string, newPin: string): Promise<void> {
    if (!PIN_PATTERN.test(newPin)) {
      throw new Error('El nuevo PIN debe tener exactamente 6 dígitos');
    }

    // verifyPin aplica rate limiting compartido con unlockWithPin.
    // Un PIN actual incorrecto cuenta como fallo y alimenta el lockout.
    const combined = await Vault.verifyPin(currentPin);

    // Salt y IV frescos: el PIN nuevo no comparte derivación con el viejo, y el
    // blobPin anterior (si alguien lo copió) no sirve para nada tras la rotación.
    const newSaltPin = freshBytes(SALT_BYTES);
    const newIvPin = freshBytes(IV_BYTES);
    const newPinKey = await deriveKey(newPin, newSaltPin);
    const newBlobPin = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: newIvPin },
      newPinKey,
      combined,
    );

    await write([
      [Slot.saltPin, newSaltPin.buffer],
      [Slot.ivPin, newIvPin.buffer],
      [Slot.blobPin, newBlobPin],
      [Slot.failedAttempts, 0],
      [Slot.lockedUntil, 0],
    ]);

    const secrets = new Uint8Array(combined);
    const masterKeyBytes = secrets.slice(0, MASTER_KEY_BYTES);
    const hmacKeyBytes = secrets.slice(MASTER_KEY_BYTES, MASTER_KEY_BYTES + HMAC_KEY_BYTES);
    SessionKeyManager.adoptKey(await importMasterKey(masterKeyBytes));
    // Re-importar la HMAC key también: changePin puede llamarse tras un
    // lock, y sin esto la sesión queda "unlocked" pero los hashPlate
    // explotan con SessionLockedError.
    hmacKey = await importHmacKey(hmacKeyBytes);
  }

  static lock(): void {
    hmacKey = null;
    SessionKeyManager.lock();
  }

  static isUnlocked(): boolean {
    return SessionKeyManager.isUnlocked();
  }

  static getMasterKey(): CryptoKey {
    return SessionKeyManager.getKey();
  }

  /**
   * La clave que firma las huellas de matrícula. Sin sesión no hay clave: un
   * `plateHash` calculable sin la bóveda abierta no protegería nada.
   */
  static getHmacKey(): CryptoKey {
    if (!hmacKey) {
      throw new SessionLockedError();
    }
    return hmacKey;
  }

  static async getWorkspaceId(): Promise<string | null> {
    return (await read<string>(Slot.workspaceId)) ?? null;
  }

  /**
   * Borra toda la bóveda local. Solo se usa cuando detectamos un bootstrap
   * incompleto (bóveda local sin meta en la nube). No hay recuperación parcial.
   */
  static async wipeDevice(): Promise<void> {
    hmacKey = null;
    SessionKeyManager.lock();
    await closeVaultConnection();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(VAULT_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('No se pudo borrar la bóveda'));
    });
  }
}

/**
 * Suelta la conexión cacheada. Hace falta antes de borrar la base (tests y
 * `wipeDevice`) y para un futuro "borrar la bóveda de este dispositivo" en ajustes.
 */
export async function closeVaultConnection(): Promise<void> {
  const pending = connection;
  connection = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // Nunca llegó a abrirse: no hay nada que cerrar.
  }
}
