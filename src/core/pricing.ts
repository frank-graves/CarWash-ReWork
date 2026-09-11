// src/core/pricing.ts
import type { VehicleKind, ServiceTier, PriceMatrix } from './types';

export const PRICE_MATRIX: Readonly<
  Record<VehicleKind, Partial<Record<ServiceTier, number>>>
> = {
  auto:              { basico: 30, intermedio: 40, premium: 55, deluxe: 90,  full_deluxe: 220 },
  camioneta_cerrada: { basico: 40, intermedio: 50, premium: 65, deluxe: 100, full_deluxe: 260 },
  pickup:            { basico: 45, intermedio: 65, premium: 80, deluxe: 110, full_deluxe: 260 },
  mototaxi:          { basico: 15, completo: 20, full_moto: 30 },
  moto_lineal:       { basico: 10, completo: 15, full_moto: 25 },
};

export function calculatePrice(vehicle: VehicleKind, tier: ServiceTier): number {
  const price = PRICE_MATRIX[vehicle]?.[tier];
  if (price === undefined) {
    throw new Error(`Combinación inválida: ${vehicle} / ${tier}`);
  }
  return price;
}

export function availableTiersFor(vehicle: VehicleKind): ServiceTier[] {
  return Object.keys(PRICE_MATRIX[vehicle]) as ServiceTier[];
}

export function calculatePriceWithMatrix(
  matrix: PriceMatrix,
  vehicle: VehicleKind,
  tier: ServiceTier
): number {
  const price = matrix[vehicle]?.[tier];
  if (price === undefined) {
    throw new Error(`Combinación inválida: ${vehicle} / ${tier}`);
  }
  return price;
}
