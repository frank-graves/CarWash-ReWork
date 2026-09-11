// src/ui/pages/wash/__tests__/formLogic.test.ts
// Vive aquí, y no en components/, porque testea la lógica del formulario y no el
// componente: si mañana cambia el markup, estos tests deben seguir en verde.
import { describe, it, expect } from 'vitest';
import { isFormComplete, getAvailableTiers, isFreeWash, type WashFormState } from '../formLogic';
import type { CustomerView } from '@core/types';

const mockCustomer: CustomerView = {
  customerId: '1',
  displayName: 'Juan',
  plate: 'ABC-123',
  phone: '999',
  accumulatedWashes: 6,
  isEligibleForFreeWash: true,
  lastWashAt: null,
};

const baseState: WashFormState = {
  customer: null,
  vehicleKind: null,
  serviceTier: null,
  cost: 0,
  operatorId: null,
  paymentMethod: null,
};

describe('formLogic', () => {
  it('isFormComplete retorna false si falta el cliente', () => {
    const state = { ...baseState, vehicleKind: 'auto' as const, serviceTier: 'basico' as const, operatorId: '1', paymentMethod: 'yape' as const };
    expect(isFormComplete(state)).toBe(false);
  });

  it('isFormComplete retorna true si todo está lleno y costo es 0', () => {
    const state: WashFormState = {
      customer: mockCustomer,
      vehicleKind: 'auto',
      serviceTier: 'basico',
      cost: 0,
      operatorId: '1',
      paymentMethod: 'yape',
    };
    expect(isFormComplete(state)).toBe(true);
  });

  it('getAvailableTiers filtra correctamente para mototaxi', () => {
    const tiers = getAvailableTiers('mototaxi');
    expect(tiers).toContain('completo');
    expect(tiers).not.toContain('premium');
  });

  it('isFreeWash detecta elegibilidad', () => {
    const state = { ...baseState, customer: mockCustomer };
    expect(isFreeWash(state)).toBe(true);
  });
});
