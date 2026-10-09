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
  deleteDoc,
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

  /**
   * Alta del operador activo. Dos caminos con el mismo write:
   *   - bootstrap del negocio: `role: 'owner'`, sin `inviteId`;
   *   - enrollment: el rol y el `inviteId` que traía el paquete de conexión.
   * La ausencia de `inviteId` es lo que la rule lee como "vino del bootstrap".
   */
  async ensureBootstrap(
    operatorName: string,
    role: OperatorRole,
    inviteId?: string,
  ): Promise<string> {
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
      rolePublic: role,
      createdAt: serverTimestamp(),
      schemaVersion: 4,
      // El spread condicional omite la key cuando no hay invite: `undefined` en
      // un setDoc no viaja, así que la rule puede distinguir "sin invite" con
      // `keys().hasAny(['inviteId'])` en vez de mirar un valor centinela.
      ...(inviteId ? { inviteId } : {}),
    });

    return uid;
  }

  /**
   * Cambia el rol de otro operador. El write lleva SOLO `rolePublic`: la regla
   * exige `affectedKeys().hasOnly(['rolePublic'])` en la rama de owner, así que
   * un `updatedAt` de cortesía aquí sería un permission-denied.
   */
  async updateRole(operatorId: string, newRole: OperatorRole): Promise<void> {
    await setDoc(
      doc(this.runtime.db, this.collectionPath, operatorId),
      { rolePublic: newRole },
      { merge: true },
    );
  }

  /**
   * Expulsa a un operador: borra su doc de `operators/{uid}`. La rule exige
   * que sea owner y que no se borre a sí mismo. El dispositivo del expulsado
   * queda con bóveda intacta pero sin acceso al workspace: `isWorkspaceMember`
   * deja de encontrarlo en Firestore y sus writes fallan con permission-denied.
   * No hay undo desde la app: para volver a entrar necesita un código de
   * conexión nuevo de otro owner/admin.
   */
  async expel(operatorId: string): Promise<void> {
    await deleteDoc(doc(this.runtime.db, this.collectionPath, operatorId));
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
    // El guard va por `rolePublic` y NO por schemaVersion: al empezar a dejar los
    // docs nuevos en v4, un chequeo `=== 3` dejaba de reconocer los ya migrados y
    // este método reescribía `rolePublic: 'owner'` en CADA arranque del shell —
    // ascendiendo a cualquier admin/staff y, con las rules nuevas, muriendo con
    // permission-denied (la cabecera se quedaba en "Sin conexión"). Un doc que ya
    // tiene rol no se toca nunca más.
    if (data.rolePublic !== undefined) return;

    await setDoc(
      operatorRef,
      {
        rolePublic: 'owner',
        schemaVersion: 4,
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
