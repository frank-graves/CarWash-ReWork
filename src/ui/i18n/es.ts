// src/ui/i18n/es.ts
// Los errores de dominio viven en inglés (infraestructura) y el operador trabaja en
// español. La traducción es responsabilidad de la capa UI: aquí y solo aquí.
//
// Es un mapa mínimo, no un sistema i18n. Cuando haya un segundo idioma, esto se
// convierte en catálogos por locale; hoy sería ingeniería para nadie.

const MESSAGES: Readonly<Record<string, string>> = {
  'Invalid PIN': 'PIN incorrecto',
};

const ERROR_NAMES: Readonly<Record<string, string>> = {
  SessionLockedError: 'La sesión está bloqueada',
  FirebaseConfigError: 'Falta configuración de Firebase. Contacta al soporte.',
};

/**
 * Devuelve el mensaje en español de los errores conocidos. Los mensajes que ya
 * vienen en español desde `vault.ts` pasan tal cual: traducir lo que ya está
 * traducido es la forma más rápida de perder matices.
 */
export function translateError(thrown: unknown): string {
  if (!(thrown instanceof Error)) {
    return 'Error inesperado';
  }

  const byName = ERROR_NAMES[thrown.name];
  if (byName !== undefined) return byName;

  const byMessage = MESSAGES[thrown.message];
  if (byMessage !== undefined) return byMessage;

  return thrown.message;
}
