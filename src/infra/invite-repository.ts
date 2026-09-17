// src/infra/invite-repository.ts
// Invitaciones de enrollment: el paquete que permite a un segundo dispositivo
// unirse al workspace. El `inviteId` funciona como capability token — quien lo
// conoce puede leer el doc, y sin el `code` el blob no dice nada.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { InviteExpiredError, InviteNotFoundError } from '@infra/errors';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import type { InviteDocument, OperatorRole } from '@core/types';

export interface CreateInviteInput {
  inviteId: string;
  blobInvite: string;
  inviteSalt: string;
  ivInvite: string;
  targetRole: OperatorRole;
  createdBy: string;
  expiresInHours: number;
}

export class InviteRepository {
  private readonly collectionPath: string;

  constructor(
    private readonly runtime: FirebaseRuntime,
    private readonly workspaceId: string,
  ) {
    this.collectionPath = `workspaces/${this.workspaceId}/invites`;
  }

  async create(input: CreateInviteInput): Promise<void> {
    const now = Date.now();
    const expiresAt = Timestamp.fromMillis(now + input.expiresInHours * 60 * 60 * 1000);

    const inviteDoc: Omit<InviteDocument, 'createdAt'> = {
      inviteId: input.inviteId,
      blobInvite: input.blobInvite,
      inviteSalt: input.inviteSalt,
      ivInvite: input.ivInvite,
      targetRole: input.targetRole,
      createdBy: input.createdBy,
      expiresAt,
      schemaVersion: 1,
    };

    await setDoc(doc(this.runtime.db, this.collectionPath, input.inviteId), {
      ...inviteDoc,
      createdAt: serverTimestamp(),
    });
  }

  /**
   * Lee un invite por su ID. El ID actúa como capability token: si lo
   * conocés, podés leerlo. Si expiró, lanza InviteExpiredError. Si no
   * existe, lanza InviteNotFoundError.
   */
  async getById(inviteId: string): Promise<InviteDocument> {
    const snap = await getDoc(doc(this.runtime.db, this.collectionPath, inviteId));
    if (!snap.exists()) {
      throw new InviteNotFoundError();
    }
    const data = snap.data() as InviteDocument;
    if (data.expiresAt.toMillis() < Date.now()) {
      // Un invite caducado es basura: nadie lo va a usar. Se deja que el
      // llamador decida borrarlo (el importador de enrollment lo hace).
      throw new InviteExpiredError();
    }
    return data;
  }

  async delete(inviteId: string): Promise<void> {
    await deleteDoc(doc(this.runtime.db, this.collectionPath, inviteId));
  }

  /**
   * Invites vivos, del que expira antes al que expira después. Sin `orderBy` ni
   * `where`: el filtro por `expiresAt` se hace en cliente porque un `where`
   * sobre un campo que cambia con el reloj no es algo que Firestore pueda
   * indexar de verdad, y la colección de un negocio local son un puñado de docs.
   */
  async listActive(): Promise<InviteDocument[]> {
    const snap = await getDocs(collection(this.runtime.db, this.collectionPath));
    const now = Date.now();
    return snap.docs
      .map((d) => d.data() as InviteDocument)
      .filter((invite) => invite.expiresAt.toMillis() > now)
      .sort((a, b) => a.expiresAt.toMillis() - b.expiresAt.toMillis());
  }
}
