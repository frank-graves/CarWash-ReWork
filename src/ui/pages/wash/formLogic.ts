import type { CustomerView, PaymentMethod, ServiceTier, VehicleKind } from '@core/types';
import { availableTiersFor } from '@core/pricing';

export interface WashFormState {
  customer: CustomerView | null;
  vehicleKind: VehicleKind | null;
  serviceTier: ServiceTier | null;
  cost: number;
  operatorId: string | null;
  paymentMethod: PaymentMethod | null;
}

export function isFormComplete(state: WashFormState): boolean {
  return (
    state.customer !== null &&
    state.vehicleKind !== null &&
    state.serviceTier !== null &&
    state.operatorId !== null &&
    state.paymentMethod !== null &&
    state.cost >= 0
  );
}

export function getAvailableTiers(vehicle: VehicleKind | null): ServiceTier[] {
  if (!vehicle) return [];
  return availableTiersFor(vehicle);
}

export function isFreeWash(state: WashFormState): boolean {
  return state.customer?.isEligibleForFreeWash ?? false;
}
