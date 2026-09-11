// src/core/types.ts
// Contrato inmutable del negocio. Cero dependencias externas.
// Todo lo que cruce el límite de la app debe conformarse a esto.

import type { FieldValue, Timestamp } from 'firebase/firestore';

export type VehicleKind =
  | 'auto'
  | 'camioneta_cerrada'
  | 'pickup'
  | 'mototaxi'
  | 'moto_lineal';

export type ServiceTier =
  | 'basico'
  | 'intermedio'
  | 'premium'
  | 'deluxe'
  | 'full_deluxe'
  | 'completo'
  | 'full_moto';

export type PaymentMethod = 'yape' | 'efectivo';

export type OperatorRole = 'owner' | 'staff';

/** Datos que se cifran antes de tocar Firestore. Nunca viajan en claro. */
export interface CustomerPII {
  displayName: string;
  plate: string;
  phone: string;
}

/** Documento de cliente en Firestore. `payload` es el blob cifrado. */
export interface CustomerDocument {
  customerId: string;
  payload: string;              // AES-GCM(JSON(CustomerPII))
  plateHash: string;            // HMAC-SHA256(plate, hmacKey del vault)
  accumulatedWashes: number;    // 0..6, en claro para lógica de lealtad
  lastResetAt: Timestamp | null;
  lastWashAt: Timestamp | null;
  createdAt: Timestamp;
  schemaVersion: 1;
}

/** Snapshot del cliente en el momento del lavado (por si borra su cuenta). */
export interface CustomerSnapshot {
  displayName: string;
  plate: string;
}

export interface WashTransactionDocument {
  transactionId: string;
  customerId: string;
  customerSnapshot: string;     // AES-GCM(JSON(CustomerSnapshot))
  vehicleKind: VehicleKind;
  serviceTier: ServiceTier;
  cost: number;
  wasFree: boolean;
  paidWith: PaymentMethod;
  registeredById: string;
  registeredByName: string;
  washerId: string;
  washerName: string;
  createdAt: Timestamp;
  schemaVersion: 2;  // bump: se reemplazan operatorId/operatorName
}

export interface OperatorDocument {
  operatorId: string;
  payload: string;              // AES-GCM(JSON({ displayName })) — solo nombre
  rolePublic: OperatorRole;     // 'owner' | 'staff' en claro. Firestore Rules
                                // lo lee sin descifrar.
  createdAt: Timestamp;
  schemaVersion: 3;             // bump: el rol sale del payload a rolePublic
}

export interface OperatorView {
  id: string;
  displayName: string;
  role: OperatorRole;
}

/** Lo que ve la UI. Ensamblado en memoria tras descifrar. */
export interface CustomerView extends CustomerPII {
  customerId: string;
  accumulatedWashes: number;
  isEligibleForFreeWash: boolean;
  lastWashAt: Date | null;
}

export interface WashTransactionView {
  transactionId: string;
  customerName: string;
  customerPlate: string;
  vehicleKind: VehicleKind;
  serviceTier: ServiceTier;
  cost: number;
  wasFree: boolean;
  paidWith: PaymentMethod;
  registeredByName: string;
  washerName: string;
  createdAt: Date;
}

export interface PriceMatrix {
  readonly [vehicle: string]: {
    readonly [tier: string]: number;
  };
}

export interface WorkspaceSettings {
  priceMatrix: PriceMatrix;
  updatedAt: Timestamp | Date | FieldValue;
  updatedBy: string; // operatorId que hizo el último cambio
}
