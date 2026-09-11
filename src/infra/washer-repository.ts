// src/infra/washer-repository.ts
// Registro de lavadores físicos. Separado de operadores porque quien lava
// el auto no siempre es quien tiene permisos para administrar la tablet.

import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  deleteDoc,
  where,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { PrivacyVault } from '@infra/crypto';
import { SessionKeyManager } from '@infra/session-key';
import { WasherInUseError } from '@infra/errors';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

interface WasherPayload {
  displayName: string;
}

interface WasherView {
  id: string;
  displayName: string;
}

export class WasherRepository {
  private readonly collectionPath: string;
  private readonly transactionsPath: string;

  constructor(
    private readonly runtime: FirebaseRuntime,
    private readonly workspaceId: string
  ) {
    this.collectionPath = `workspaces/${this.workspaceId}/washers`;
    this.transactionsPath = `workspaces/${this.workspaceId}/transactions`;
  }

  async create(displayName: string): Promise<string> {
    const id = crypto.randomUUID();
    const key = SessionKeyManager.getKey();
    const payload: WasherPayload = { displayName };
    const encryptedPayload = await PrivacyVault.encryptPayload(payload, key);

    await setDoc(doc(this.runtime.db, this.collectionPath, id), {
      washerId: id,
      payload: encryptedPayload,
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    });

    return id;
  }

  async listAll(): Promise<WasherView[]> {
    const q = query(collection(this.runtime.db, this.collectionPath));
    const snap = await getDocs(q);
    const key = SessionKeyManager.getKey();

    const washers = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const payload = (await PrivacyVault.decryptPayload(
          data.payload as string,
          key
        )) as WasherPayload;
        return {
          id: d.id,
          displayName: payload.displayName,
        };
      })
    );

    return washers.sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }

  async update(washerId: string, displayName: string): Promise<void> {
    const key = SessionKeyManager.getKey();
    const payload: WasherPayload = { displayName };
    const encryptedPayload = await PrivacyVault.encryptPayload(payload, key);

    await setDoc(
      doc(this.runtime.db, this.collectionPath, washerId),
      { payload: encryptedPayload },
      { merge: true }
    );
  }

  async delete(washerId: string): Promise<void> {
    // Un lavador con historial no se borra: se oculta o se marca inactivo.
    // Borrarlo rompería la integridad del ledger de transacciones.
    const q = query(
      collection(this.runtime.db, this.transactionsPath),
      where('washerId', '==', washerId),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      throw new WasherInUseError();
    }

    await deleteDoc(doc(this.runtime.db, this.collectionPath, washerId));
  }
}
