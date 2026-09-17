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
