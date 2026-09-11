// src/infra/settings-repository.ts
// Configuración mutable del workspace. Hoy solo precios, mañana horarios o impuestos.
// Vive en un documento único para evitar queries y mantener la atomicidad de los cambios.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { PRICE_MATRIX } from '@core/pricing';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import type { PriceMatrix, WorkspaceSettings } from '@core/types';

export class SettingsRepository {
  private readonly docPath: string;

  constructor(
    private readonly runtime: FirebaseRuntime,
    private readonly workspaceId: string
  ) {
    // 4 segmentos = colección/doc/colección/doc. Válido en Firestore.
    this.docPath = `workspaces/${this.workspaceId}/settings/pricing`;
  }

  async getPriceMatrix(): Promise<PriceMatrix> {
    const snap = await getDoc(doc(this.runtime.db, this.docPath));
    if (!snap.exists()) {
      return PRICE_MATRIX;
    }
    const data = snap.data() as WorkspaceSettings;
    return data.priceMatrix;
  }

  async updatePriceMatrix(matrix: PriceMatrix, operatorId: string): Promise<void> {
    // La jefa puede cambiar números, pero no la estructura del negocio.
    // Si añade un vehículo nuevo, eso requiere un deploy de código.
    const defaultVehicles = Object.keys(PRICE_MATRIX);
    const incomingVehicles = Object.keys(matrix);

    if (defaultVehicles.length !== incomingVehicles.length) {
      throw new Error('Estructura de precios inválida');
    }

    for (const vehicle of defaultVehicles) {
      // La fila se guarda en una constante: `noUncheckedIndexedAccess` no deja
      // encadenar `matrix[vehicle][tier]` sin comprobar la fila antes.
      const incomingRow = matrix[vehicle];
      if (!incomingRow) throw new Error('Estructura de precios inválida');

      const defaultTiers = Object.keys(PRICE_MATRIX[vehicle as keyof typeof PRICE_MATRIX]);
      const incomingTiers = Object.keys(incomingRow);

      if (defaultTiers.length !== incomingTiers.length) {
        throw new Error('Estructura de precios inválida');
      }

      for (const tier of defaultTiers) {
        if (typeof incomingRow[tier] !== 'number') {
          throw new Error('Estructura de precios inválida');
        }
      }
    }

    const settings: WorkspaceSettings = {
      priceMatrix: matrix,
      updatedAt: serverTimestamp(),
      updatedBy: operatorId,
    };

    await setDoc(doc(this.runtime.db, this.docPath), settings, { merge: false });
  }
}
