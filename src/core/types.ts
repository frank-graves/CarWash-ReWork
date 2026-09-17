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

export type OperatorRole = 'owner' | 'admin' | 'staff';

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
  rolePublic: OperatorRole;     // 'owner' | 'admin' | 'staff' en claro. Firestore
                                // Rules lo lee sin descifrar.
  createdAt: Timestamp;
  schemaVersion: 4;             // v4: inviteId opcional (alta por invite vs bootstrap)
  inviteId?: string;            // presente SOLO si el alta vino de un invite.
                                // Ausente = creado por el bootstrap del owner.
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

/**
 * Documento de invitación de enrollment. Vive en
 * `workspaces/{workspaceId}/invites/{inviteId}`. El inviteId actúa como
 * capability token: quien lo conozca puede leer el blob y descifrarlo si
 * además tiene el code. Un solo uso: se borra al enrolar.
 */
export interface InviteDocument {
  inviteId: string;
  blobInvite: string;      // AES-GCM(sobre del vault, keyInvite) en Base64
  inviteSalt: string;      // Base64 del salt de PBKDF2 para keyInvite
  ivInvite: string;        // Base64 del IV de AES-GCM
  targetRole: OperatorRole; // Rol que tendrá el nuevo operador
  createdBy: string;       // UID del operador que generó el invite
  createdAt: Timestamp;
  expiresAt: Timestamp;
  schemaVersion: 1;
}
