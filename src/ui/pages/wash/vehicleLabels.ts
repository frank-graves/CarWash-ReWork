import type { ServiceTier, VehicleKind } from '@core/types';

export const VEHICLE_LABELS: Record<VehicleKind, string> = {
  auto: 'Auto',
  camioneta_cerrada: 'Camioneta cerrada',
  pickup: 'Pickup',
  mototaxi: 'Mototaxi',
  moto_lineal: 'Moto lineal',
};

export const SERVICE_LABELS: Record<ServiceTier, string> = {
  basico: 'Básico',
  intermedio: 'Intermedio',
  premium: 'Premium',
  deluxe: 'Deluxe',
  full_deluxe: 'Full Deluxe',
  completo: 'Completo',
  full_moto: 'Full Moto',
};
