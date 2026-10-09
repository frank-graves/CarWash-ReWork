export class DuplicatePlateError extends Error {
  constructor(plate: string) {
    super(`La placa ${plate} ya está registrada.`);
    this.name = 'DuplicatePlateError';
  }
}

export class SessionLockedError extends Error {
  constructor() {
    super('La sesión está bloqueada.');
    this.name = 'SessionLockedError';
  }
}

export class FirebaseConfigError extends Error {
  constructor(key: string) {
    super(`Falta la variable de entorno ${key}.`);
    this.name = 'FirebaseConfigError';
  }
}

export class WasherInUseError extends Error {
  constructor() {
    super('Este lavador tiene lavados registrados y no se puede eliminar.');
    this.name = 'WasherInUseError';
  }
}

export class InsufficientRoleError extends Error {
  constructor(requiredRole: string) {
    super(`Requiere rol ${requiredRole}.`);
    this.name = 'InsufficientRoleError';
  }
}

export class InviteNotFoundError extends Error {
  constructor() {
    super('El código de conexión no existe o ya fue utilizado.');
    this.name = 'InviteNotFoundError';
  }
}

export class InviteExpiredError extends Error {
  constructor() {
    super('El código de conexión ha expirado. Pedí uno nuevo.');
    this.name = 'InviteExpiredError';
  }
}

/**
 * Devuelve true si el error viene de Firestore por permisos insuficientes.
 * El SDK modular (firebase@^12) lanza un objeto con `code` como string
 * cuando la request falla por reglas: 'permission-denied'. No es
 * instancia de una clase específica en todos los entornos (a veces es
 * FirebaseError, a veces un objeto plano), por eso chequeamos la
 * propiedad, no el constructor.
 */
export function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'permission-denied'
  );
}

/**
 * True si el error es de red, no de permisos. Los códigos que Firestore
 * usa para indicar que la request no llegó al servidor son estos tres.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const code = (err as { code: unknown }).code;
  return (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'network-request-failed'
  );
}
