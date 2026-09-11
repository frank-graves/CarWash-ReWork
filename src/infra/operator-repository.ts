// src/infra/operator-repository.ts
// Registro de operadores del workspace.
// El bootstrap es idempotente: si el operador ya existe, no hace nada.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { PrivacyVault } from '@infra/crypto';
import { SessionKeyManager } from '@infra/session-key';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import type { OperatorDocument, OperatorRole, OperatorView } from '@core/types';

interface OperatorPayload {
  displayName: string;
  role: OperatorRole;
}

export class OperatorRepository {
  private readonly collectionPath: string;

  constructor(
    private readonly runtime: FirebaseRuntime,
    private readonly workspaceId: string
  ) {
    this.collectionPath = `workspaces/${this.workspaceId}/operators`;
  }

  async ensureBootstrap(operatorName: string): Promise<string> {
    const uid = this.runtime.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No authenticated user to bootstrap as operator');
    }

    const operatorRef = doc(this.runtime.db, this.collectionPath, uid);
    const existing = await getDoc(operatorRef);

    if (existing.exists()) {
      return uid;
    }

    const key = SessionKeyManager.getKey();
    const payload: OperatorPayload = { displayName: operatorName, role: 'owner' };
    const encryptedPayload = await PrivacyVault.encryptPayload(payload, key);

    await setDoc(operatorRef, {
      operatorId: uid,
      payload: encryptedPayload,
      createdAt: serverTimestamp(),
      schemaVersion: 2,
    });

    return uid;
  }

  async listAll(): Promise<OperatorView[]> {
    const q = query(collection(this.runtime.db, this.collectionPath));
    const snap = await getDocs(q);
    const key = SessionKeyManager.getKey();

    const operators = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data() as OperatorDocument;
        const payload = (await PrivacyVault.decryptPayload(
          data.payload,
          key
        )) as Partial<OperatorPayload>;

        // Fallback para schemaVersion 1 (legacy sin role en el payload)
        const role = payload.role ?? 'owner';

        return {
          id: d.id,
          displayName: payload.displayName ?? 'Operador legacy',
          role,
        };
      })
    );

    return operators.sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }
}
