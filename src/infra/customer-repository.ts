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
  Timestamp,
  type QuerySnapshot,
} from 'firebase/firestore';
import type {
  CustomerDocument,
  CustomerPII,
  CustomerView,
} from '@core/types';
import { isEligibleForFreeWash, nextAccumulatedValue } from '@core/loyalty';
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

  /**
   * Recalcula el contador de lealtad desde el ledger del cliente. Necesario
   * cuando se importan lavados retroactivos en desorden: el contador es una
   * denormalización, y el orden de llegada de las escrituras no refleja el
   * orden cronológico real de los lavados.
   *
   * Ordena las transacciones por createdAt ascendente, aplica la lógica
   * `nextAccumulatedValue` una por una, y escribe el contador final.
   * Con el ledger vacío escribe 0 (es el caso de anular el último lavado), y
   * no toca nada si el cliente ya no existe.
   *
   * El query se hace por customerId sin orderBy para no requerir índice
   * compuesto. El orden se aplica en cliente sobre un array que para un car
   * wash local rara vez supera el centenar de items.
   */
  async recomputeLoyalty(customerId: string): Promise<void> {
    const transactionsPath = `workspaces/${this.workspaceId}/transactions`;

    const q = query(
      collection(this.runtime.db, transactionsPath),
      where('customerId', '==', customerId),
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      // Sin transacciones, el contador correcto es 0. El `return` anterior
      // dejaba el valor previo intacto — y tras anular el único lavado de un
      // cliente, ese valor previo era justamente el que había que borrar.
      //
      // El chequeo de existencia no es paranoia: un `merge: true` sobre un doc
      // que ya no existe lo resucita con un solo campo, sin `payload`, y ese
      // fantasma hace fallar el descifrado de la lista ENTERA de clientes.
      const customerRef = doc(this.runtime.db, this.collectionPath, customerId);
      const stillAlive = await getDoc(customerRef);
      if (!stillAlive.exists()) return;

      await setDoc(customerRef, { accumulatedWashes: 0 }, { merge: true });
      return;
    }

    interface LedgerEntry {
      createdAt: Date;
      wasFree: boolean;
    }

    const entries: LedgerEntry[] = snap.docs.map((d) => {
      const data = d.data() as { createdAt: Timestamp; wasFree: boolean };
      return {
        createdAt: data.createdAt.toDate(),
        wasFree: data.wasFree,
      };
    });

    entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let counter = 0;
    for (const entry of entries) {
      counter = nextAccumulatedValue(counter, entry.wasFree);
    }

    await setDoc(
      doc(this.runtime.db, this.collectionPath, customerId),
      { accumulatedWashes: counter },
      { merge: true },
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
