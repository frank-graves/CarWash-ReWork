import { describe, expect, it } from 'vitest';
import { calculateSplitWage, calculateWage } from '../wages';

describe('calculateWage', () => {
  it('devuelve la tarifa del papel', () => {
    expect(calculateWage('auto', 'basico')).toBe(10);
    expect(calculateWage('auto', 'deluxe')).toBe(24);
    expect(calculateWage('camioneta_cerrada', 'premium')).toBe(20);
    expect(calculateWage('pickup', 'deluxe')).toBe(36);
    expect(calculateWage('mototaxi', 'completo')).toBe(4);
    expect(calculateWage('moto_lineal', 'full_moto')).toBe(5.5);
  });

  it('full_deluxe paga 100 en todos los vehículos que lo soportan', () => {
    expect(calculateWage('auto', 'full_deluxe')).toBe(100);
    expect(calculateWage('camioneta_cerrada', 'full_deluxe')).toBe(100);
    expect(calculateWage('pickup', 'full_deluxe')).toBe(100);
  });

  it('devuelve 0 para combinaciones imposibles', () => {
    expect(calculateWage('mototaxi', 'premium')).toBe(0);
    expect(calculateWage('moto_lineal', 'deluxe')).toBe(0);
  });

  it('mototaxi y moto_lineal pagan lo mismo', () => {
    expect(calculateWage('mototaxi', 'basico'))
      .toBe(calculateWage('moto_lineal', 'basico'));
  });
});

describe('calculateSplitWage', () => {
  it('con 1 lavador devuelve el total', () => {
    expect(calculateSplitWage('auto', 'premium', 1)).toBe(18);
  });

  it('con 2 lavadores divide en partes iguales', () => {
    expect(calculateSplitWage('auto', 'deluxe', 2)).toBe(12);
  });

  it('con 3 lavadores divide en tercios', () => {
    expect(calculateSplitWage('pickup', 'deluxe', 3)).toBe(12);
  });

  it('con 0 lavadores no divide por cero', () => {
    expect(calculateSplitWage('auto', 'basico', 0)).toBe(10);
  });

  it('full_deluxe se reparte entre N', () => {
    expect(calculateSplitWage('camioneta_cerrada', 'full_deluxe', 2)).toBe(50);
    expect(calculateSplitWage('pickup', 'full_deluxe', 4)).toBe(25);
  });
});
