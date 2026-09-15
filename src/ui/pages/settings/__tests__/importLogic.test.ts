// src/ui/pages/settings/__tests__/importLogic.test.ts
// El parser del importador histórico. Nada de Firebase ni de DOM: entra un
// string y sale qué se puede cargar y qué no. El reloj va congelado porque la
// única validación que depende de él es "no aceptar fechas futuras".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseImportJson } from '../importLogic';

const VALID_ENTRY = {
  plate: 'abc-123',
  date: '2026-03-15',
  vehicleKind: 'auto',
  serviceTier: 'premium',
  cost: 55,
  paidWith: 'efectivo',
};

function entryWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...VALID_ENTRY, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseImportJson', () => {
  it('rechaza el campo vacío sin intentar parsear', () => {
    const result = parseImportJson('   ');

    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(-1);
    expect(result.errors[0]?.reason).toContain('vacío');
  });

  it('rechaza un JSON malformado', () => {
    const result = parseImportJson('[{"plate": "ABC-123",}]');

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.index).toBe(-1);
    expect(result.errors[0]?.reason).toContain('JSON inválido');
  });

  it('rechaza un JSON que no sea un array', () => {
    const result = parseImportJson('{"plate": "ABC-123"}');

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.index).toBe(-1);
    expect(result.errors[0]?.reason).toContain('array');
  });

  it('acepta una entrada válida y normaliza placa y fecha', () => {
    const result = parseImportJson(JSON.stringify([VALID_ENTRY]));

    expect(result.errors).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
    const only = result.valid[0];
    expect(only?.plate).toBe('ABC-123');
    expect(only?.date).toBeInstanceOf(Date);
    expect(only?.date.getFullYear()).toBe(2026);
    expect(only?.date.getMonth()).toBe(2);
    expect(only?.date.getDate()).toBe(15);
    expect(only?.vehicleKind).toBe('auto');
    expect(only?.serviceTier).toBe('premium');
    expect(only?.paidWith).toBe('efectivo');
  });

  it('marca la entrada sin placa con su índice', () => {
    const result = parseImportJson(
      JSON.stringify([entryWith({ plate: '   ' })]),
    );

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.index).toBe(0);
    expect(result.errors[0]?.reason).toContain('placa');
  });

  it('rechaza fechas con formato inválido o imposibles', () => {
    const result = parseImportJson(
      JSON.stringify([
        entryWith({ date: '2026-13-40' }),
        entryWith({ date: 'ayer' }),
        entryWith({ date: '' }),
      ]),
    );

    expect(result.valid).toHaveLength(0);
    expect(result.errors.map((e) => e.index)).toEqual([0, 1, 2]);
    for (const error of result.errors) {
      expect(error.reason).toContain('Fecha inválida');
    }
  });

  it('rechaza una fecha futura', () => {
    const result = parseImportJson(JSON.stringify([entryWith({ date: '2099-01-01' })]));

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.index).toBe(0);
    expect(result.errors[0]?.reason).toContain('futura');
  });

  it('rechaza un vehículo fuera del enum', () => {
    const result = parseImportJson(JSON.stringify([entryWith({ vehicleKind: 'camion' })]));

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.reason).toContain('Vehículo inválido');
  });

  it('rechaza un costo negativo', () => {
    const result = parseImportJson(JSON.stringify([entryWith({ cost: -5 })]));

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.reason).toContain('Costo inválido');
  });

  it('rechaza un método de pago fuera del enum', () => {
    const result = parseImportJson(JSON.stringify([entryWith({ paidWith: 'tarjeta' })]));

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.reason).toContain('Método de pago inválido');
  });

  it('deja wasFree en false cuando el campo no viene', () => {
    const result = parseImportJson(JSON.stringify([VALID_ENTRY]));

    expect(result.valid[0]?.wasFree).toBe(false);
  });

  it('corta el lote por encima del máximo de entradas', () => {
    const oversized = Array.from({ length: 501 }, () => VALID_ENTRY);
    const result = parseImportJson(JSON.stringify(oversized));

    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(-1);
    expect(result.errors[0]?.reason).toContain('Máximo 500');
  });

  it('separa válidas de inválidas en un lote mezclado', () => {
    const result = parseImportJson(
      JSON.stringify([VALID_ENTRY, entryWith({ cost: 'cincuenta' })]),
    );

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.plate).toBe('ABC-123');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
  });

  it('rechaza un día que no existe en el calendario', () => {
    const result = parseImportJson(JSON.stringify([entryWith({ date: '2026-02-30' })]));

    expect(result.valid).toHaveLength(0);
    expect(result.errors[0]?.index).toBe(0);
    expect(result.errors[0]?.reason).toContain('Fecha inválida');
  });
});
