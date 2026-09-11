// src/infra/customer-repository.ts
// Capa de persistencia para el registro de clientes.
// Todo PII se cifra en cliente antes de cruzar la red.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  orderBy,
  type QuerySnapshot,
} from 'firebase/firestore';
import type {
  CustomerDocument,
  CustomerPII,
  CustomerView,
} from '@core/types';
import { isEligibleForFreeWash } from '@core/loyalty';
import { PrivacyVault } from '@infra/crypto';
import { hashPlate } from '@infra/hashing';
import { SessionKeyManager } from '@infra/session-key';
import { DuplicatePlateError } from '@infra/errors';
import { Vault } from '@infra/vault';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

export class CustomerRepository {
  private readonly collectionPath: string;

  constructor(
    private readonly runtime: FirebaseRuntime,
    private readonly workspaceId: string
  ) {
    this.collectionPath = `workspaces/${this.workspaceId}/customers`;
  }

  async create(pii: CustomerPII): Promise<string> {
    const key = SessionKeyManager.getKey();
    const plateHash = await hashPlate(pii.plate, Vault.getHmacKey());

    const existingQuery = query(
      collection(this.runtime.db, this.collectionPath),
      where('plateHash', '==', plateHash),
      limit(1)
    );
    const existingSnapshot = await getDocs(existingQuery);
    if (!existingSnapshot.empty) {
      throw new DuplicatePlateError(pii.plate);
    }

    const customerId = crypto.randomUUID();
    const payload = await PrivacyVault.encryptPayload(pii, key);

    const baseDoc = {
      customerId,
      payload,
      plateHash,
      accumulatedWashes: 0,
      schemaVersion: 1 as const,
    };

    await setDoc(doc(this.runtime.db, this.collectionPath, customerId), {
      ...baseDoc,
      lastResetAt: null,
      lastWashAt: null,
      createdAt: serverTimestamp(),
    });

    return customerId;
  }

  async update(customerId: string, pii: CustomerPII): Promise<void> {
    const key = SessionKeyManager.getKey();
    const plateHash = await hashPlate(pii.plate, Vault.getHmacKey());

    // Verificar duplicado excluyendo al propio cliente
    const existingQuery = query(
      collection(this.runtime.db, this.collectionPath),
      where('plateHash', '==', plateHash),
      limit(2)
    );
    const existingSnapshot = await getDocs(existingQuery);
    const conflict = existingSnapshot.docs.find(d => d.id !== customerId);
    if (conflict) throw new DuplicatePlateError(pii.plate);

    const payload = await PrivacyVault.encryptPayload(pii, key);
    await setDoc(
      doc(this.runtime.db, this.collectionPath, customerId),
      { payload, plateHash },
      { merge: true }
    );
  }

  async findById(customerId: string): Promise<CustomerView | null> {
    const snap = await getDoc(
      doc(this.runtime.db, this.collectionPath, customerId)
    );
    if (!snap.exists()) return null;
    return this.assembleView(snap.data() as CustomerDocument);
  }

  async findByPlate(plate: string): Promise<CustomerView | null> {
    const plateHash = await hashPlate(plate, Vault.getHmacKey());
    const q = query(
      collection(this.runtime.db, this.collectionPath),
      where('plateHash', '==', plateHash),
      limit(1)
    );
    const snap = await getDocs(q);
    const firstDoc = snap.docs[0];
    if (!firstDoc) return null;
    return this.assembleView(firstDoc.data() as CustomerDocument);
  }

  async listAll(): Promise<CustomerView[]> {
    const q = query(
      collection(this.runtime.db, this.collectionPath),
      orderBy('createdAt', 'asc')
    );
    const snap = await getDocs(q);
    const views = await Promise.all(
      snap.docs.map((d) => this.assembleView(d.data() as CustomerDocument))
    );
    return this.sortViews(views);
  }

  subscribeAll(onChange: (customers: CustomerView[]) => void): () => void {
    const q = query(
      collection(this.runtime.db, this.collectionPath),
      orderBy('createdAt', 'asc')
    );

    return onSnapshot(q, (snapshot: QuerySnapshot) => {
      Promise.all(
        snapshot.docs.map((d) => this.assembleView(d.data() as CustomerDocument))
      )
        .then((views) => onChange(this.sortViews(views)))
        .catch((err) => {
          console.error('[CustomerRepository] decrypt failure', err);
        });
    });
  }

  async delete(customerId: string): Promise<void> {
    await deleteDoc(doc(this.runtime.db, this.collectionPath, customerId));
  }

  private sortViews(views: CustomerView[]): CustomerView[] {
    return views.sort((a, b) => {
      const aTime = a.lastWashAt?.getTime() ?? 0;
      const bTime = b.lastWashAt?.getTime() ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  private async assembleView(docData: CustomerDocument): Promise<CustomerView> {
    const key = SessionKeyManager.getKey();
    const pii = (await PrivacyVault.decryptPayload(
      docData.payload,
      key
    )) as CustomerPII;

    const lastWashAtRaw = docData.lastWashAt as unknown;
    let lastWashAt: Date | null = null;
    if (lastWashAtRaw instanceof Date) {
      lastWashAt = lastWashAtRaw;
    } else if (lastWashAtRaw && typeof lastWashAtRaw === 'object' && 'toDate' in lastWashAtRaw) {
      lastWashAt = (lastWashAtRaw as { toDate: () => Date }).toDate();
    } else if (typeof lastWashAtRaw === 'number') {
      lastWashAt = new Date(lastWashAtRaw);
    }

    return {
      ...pii,
      customerId: docData.customerId,
      accumulatedWashes: docData.accumulatedWashes,
      isEligibleForFreeWash: isEligibleForFreeWash(docData.accumulatedWashes),
      lastWashAt,
    };
  }
}
