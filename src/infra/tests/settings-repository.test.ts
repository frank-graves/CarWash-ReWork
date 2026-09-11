// src/infra/tests/settings-repository.test.ts
// El repositorio de precios no cifra nada: solo valida la forma de la matriz y
// la guarda. El mock de Firestore es el mínimo que necesita (doc/getDoc/setDoc).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRICE_MATRIX } from '@core/pricing';
import { SettingsRepository } from '@infra/settings-repository';
import type { PriceMatrix } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

const store = new Map<string, Record<string, unknown>>();

vi.mock('firebase/firestore', async () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  getDoc: async (ref: { path: string }) => {
    const data = store.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  setDoc: async (
    ref: { path: string },
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ) => {
    const previous = options?.merge ? store.get(ref.path) ?? {} : {};
    store.set(ref.path, { ...previous, ...data });
  },
  serverTimestamp: () => new Date(),
}));

const mockRuntime = {
  app: {},
  db: {},
  auth: { currentUser: { uid: 'op-1' } },
} as unknown as FirebaseRuntime;

const WORKSPACE = 'ws-test-001';

/** Copia mutable de la matriz compilada: mismo shape, números tocables. */
function fullMatrix(): Record<string, Record<string, number>> {
  const clone: Record<string, Record<string, number>> = {};
  for (const vehicle of Object.keys(PRICE_MATRIX) as (keyof typeof PRICE_MATRIX)[]) {
    clone[vehicle] = Object.fromEntries(
      Object.entries(PRICE_MATRIX[vehicle]).map(([tier, price]) => [tier, price ?? 0])
    );
  }
  return clone;
}

beforeEach(() => {
  store.clear();
});

describe('SettingsRepository', () => {
  it('sin documento guardado devuelve la matriz compilada', async () => {
    const repo = new SettingsRepository(mockRuntime, WORKSPACE);

    expect(await repo.getPriceMatrix()).toEqual(PRICE_MATRIX);
  });

  it('updatePriceMatrix + getPriceMatrix hace round-trip', async () => {
    const repo = new SettingsRepository(mockRuntime, WORKSPACE);
    const matrix: PriceMatrix = {
      ...fullMatrix(),
      auto: { basico: 35, intermedio: 40, premium: 55, deluxe: 90, full_deluxe: 220 },
    };

    await repo.updatePriceMatrix(matrix, 'op-1');
    const stored = await repo.getPriceMatrix();

    expect(stored).toEqual(matrix);
    expect(stored.auto?.basico).toBe(35);
    expect(store.size).toBe(1);
  });

  it('rechaza una matriz a la que le faltan vehículos', async () => {
    const repo = new SettingsRepository(mockRuntime, WORKSPACE);
    const incompleta = fullMatrix();
    delete incompleta.mototaxi;

    await expect(repo.updatePriceMatrix(incompleta, 'op-1')).rejects.toThrow(
      'Estructura de precios inválida'
    );
    // Y no escribe nada a medias.
    expect(store.size).toBe(0);
  });

  it('rechaza una matriz a la que le falta un tier', async () => {
    const repo = new SettingsRepository(mockRuntime, WORKSPACE);
    const incompleta = fullMatrix();
    const auto = incompleta.auto;
    if (!auto) throw new Error('La matriz de prueba no tiene auto');

    delete auto.premium;

    await expect(repo.updatePriceMatrix(incompleta, 'op-1')).rejects.toThrow(
      'Estructura de precios inválida'
    );
    expect(store.size).toBe(0);
  });
});
