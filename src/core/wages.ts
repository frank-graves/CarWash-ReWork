// src/core/wages.ts
// Tarifas del papel "PAGOS PARA PERSONAL".
// Motos: pago entero a UNA persona.
// Auto/camioneta/SUV: pago entero al pool de N lavadores, se divide.

import type { ServiceTier, VehicleKind } from './types';

export const WAGE_MATRIX: Readonly<
  Record<VehicleKind, Partial<Record<ServiceTier, number>>>
> = {
  auto:              { basico: 10,  intermedio: 12, premium: 18, deluxe: 24, full_deluxe: 100 },
  camioneta_cerrada: { basico: 12,  intermedio: 14, premium: 20, deluxe: 30, full_deluxe: 100 },
  pickup:            { basico: 14,  intermedio: 20, premium: 26, deluxe: 36, full_deluxe: 100 },
  mototaxi:          { basico: 2.5, completo: 4,   full_moto: 5.5 },
  moto_lineal:       { basico: 2.5, completo: 4,   full_moto: 5.5 },
};

/**
 * Total que el negocio paga por UNA lavada (pool completo).
 * Devuelve 0 si la combinación no está en el papel. No tira excepción:
 * se llama sobre el ledger histórico.
 * ponytail: lavado gratis paga tarifa completa. Confirmar con el dueño.
 */
export function calculateWage(vehicle: VehicleKind, tier: ServiceTier): number {
  return WAGE_MATRIX[vehicle]?.[tier] ?? 0;
}

/**
 * Pago que le toca a CADA lavador de una lavada.
 * Motos: siempre entero. Si el operador registra 2 por error, se divide.
 */
export function calculateSplitWage(
  vehicle: VehicleKind,
  tier: ServiceTier,
  washerCount: number,
): number {
  const total = calculateWage(vehicle, tier);
  if (washerCount <= 1) return total;
  return total / washerCount;
}
