import type { PaymentMethod, ServiceTier, VehicleKind } from '@core/types';

export interface RawImportEntry {
  plate: string;
  date: string;
  vehicleKind: string;
  serviceTier: string;
  cost: number;
  paidWith: string;
  wasFree?: boolean;
}

export interface ValidatedImportEntry {
  plate: string;
  date: Date;
  vehicleKind: VehicleKind;
  serviceTier: ServiceTier;
  cost: number;
  paidWith: PaymentMethod;
  wasFree: boolean;
}

export interface ParseResult {
  valid: ValidatedImportEntry[];
  errors: Array<{ index: number; reason: string; raw: unknown }>;
}

const VEHICLE_KINDS: readonly VehicleKind[] = [
  'auto', 'camioneta_cerrada', 'pickup', 'mototaxi', 'moto_lineal',
];
const SERVICE_TIERS: readonly ServiceTier[] = [
  'basico', 'intermedio', 'premium', 'deluxe', 'full_deluxe', 'completo', 'full_moto',
];
const PAYMENT_METHODS: readonly PaymentMethod[] = ['yape', 'efectivo'];

const MAX_ENTRIES = 500;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte 'YYYY-MM-DD' a Date en hora LOCAL. Mismo patrón que el date
 * picker de WashRegistrationPage: construir con componentes explícitos para
 * no caer en la trampa del UTC midnight del `new Date(str)` crudo.
 */
function parseLocalDate(value: string): Date | null {
  if (!DATE_REGEX.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  const date = new Date(y, m - 1, d);
  // Validación: 2026-02-30 debe fallar (JS lo normaliza a 2026-03-02).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseImportJson(raw: string): ParseResult {
  const errors: ParseResult['errors'] = [];
  const valid: ValidatedImportEntry[] = [];

  if (!raw.trim()) {
    return { valid, errors: [{ index: -1, reason: 'El campo está vacío.', raw: null }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      valid,
      errors: [{
        index: -1,
        reason: 'JSON inválido. Revisá comas, comillas y llaves.',
        raw: null,
      }],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      valid,
      errors: [{ index: -1, reason: 'El JSON debe ser un array [ ... ].', raw: null }],
    };
  }

  if (parsed.length > MAX_ENTRIES) {
    return {
      valid,
      errors: [{
        index: -1,
        reason: `Máximo ${MAX_ENTRIES} registros por importación. Dividí el lote.`,
        raw: null,
      }],
    };
  }

  const today = todayUtcMidnight();

  parsed.forEach((entry, index) => {
    // Con llaves y sin devolver el `push`: `reject` tiene que ser void, o el
    // `return reject(...)` de cada validación devuelve un número y TS7030
    // (`noImplicitReturns`, activo en el tsconfig strictest) marca el callback
    // entero por no devolver siempre lo mismo.
    const reject = (reason: string): void => {
      errors.push({ index, reason, raw: entry });
    };

    if (typeof entry !== 'object' || entry === null) {
      return reject('No es un objeto.');
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.plate !== 'string' || !e.plate.trim()) {
      return reject('Falta la placa.');
    }
    if (typeof e.date !== 'string') {
      return reject('Falta la fecha.');
    }
    const date = parseLocalDate(e.date);
    if (!date) {
      return reject('Fecha inválida o formato incorrecto (esperado YYYY-MM-DD).');
    }
    if (date.getTime() > today.getTime()) {
      return reject('Fecha futura no permitida.');
    }
    if (typeof e.vehicleKind !== 'string' || !VEHICLE_KINDS.includes(e.vehicleKind as VehicleKind)) {
      return reject(`Vehículo inválido: "${String(e.vehicleKind)}".`);
    }
    if (typeof e.serviceTier !== 'string' || !SERVICE_TIERS.includes(e.serviceTier as ServiceTier)) {
      return reject(`Servicio inválido: "${String(e.serviceTier)}".`);
    }
    if (typeof e.cost !== 'number' || !Number.isFinite(e.cost) || e.cost < 0) {
      return reject('Costo inválido.');
    }
    if (typeof e.paidWith !== 'string' || !PAYMENT_METHODS.includes(e.paidWith as PaymentMethod)) {
      return reject(`Método de pago inválido: "${String(e.paidWith)}".`);
    }

    const wasFree = e.wasFree === true;

    valid.push({
      plate: e.plate.trim().toUpperCase(),
      date,
      vehicleKind: e.vehicleKind as VehicleKind,
      serviceTier: e.serviceTier as ServiceTier,
      cost: e.cost,
      paidWith: e.paidWith as PaymentMethod,
      wasFree,
    });
  });

  return { valid, errors };
}
