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
    if (existing.exists()) return uid;

    const key = SessionKeyManager.getKey();
    const payload = { displayName: operatorName };
    const encryptedPayload = await PrivacyVault.encryptPayload(payload, key);

    await setDoc(operatorRef, {
      operatorId: uid,
      payload: encryptedPayload,
      rolePublic: 'owner',
      createdAt: serverTimestamp(),
      schemaVersion: 3,
    });

    return uid;
  }

  /**
   * Migra el doc del operador activo de schemaVersion 2 a 3 añadiendo
   * `rolePublic: 'owner'` en claro. Sin este campo, la regla de settings
   * rechaza con permission-denied al owner legítimo que se registró antes
   * de 5.5c. v2 no distinguía roles, así que el único operador posible es
   * el dueño. No-op si ya es v3.
   *
   * Se llama al arrancar el shell, no desde ensureBootstrap: ese solo corre
   * una vez, y la migración tiene que dispararse en cualquier dispositivo
   * que abra la app con un doc v2.
   */
  async migrateLegacyRole(): Promise<void> {
    const uid = this.runtime.auth.currentUser?.uid;
    if (!uid) return;

    const operatorRef = doc(this.runtime.db, this.collectionPath, uid);
    const existing = await getDoc(operatorRef);
    if (!existing.exists()) return;

    const data = existing.data() as Partial<OperatorDocument>;
    if (data.schemaVersion === 3 && data.rolePublic !== undefined) return;

    await setDoc(
      operatorRef,
      {
        rolePublic: 'owner',
        schemaVersion: 3,
      },
      { merge: true },
    );
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
        )) as { displayName: string };

        // Fallback para docs v2: sin rolePublic en el doc raíz, asumimos owner.
        // Solo pasa en instalaciones creadas antes de 5.5c; los nuevos ya nacen v3.
        const role: OperatorRole = data.rolePublic ?? 'owner';

        return {
          id: d.id,
          displayName: payload.displayName,
          role,
        };
      })
    );

    return operators.sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }
}
