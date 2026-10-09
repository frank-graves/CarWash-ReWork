// firestore.rules.test.ts
// Tests de las reglas de seguridad de Firestore. Corren contra el emulador
// (puerto 8080) usando @firebase/rules-unit-testing. NO usan los mocks de
// `firebase/firestore` que usa el resto de la suite: acá lo que se prueba
// es exactamente lo que Firestore va a hacer en producción.
//
// Cómo correrlos:
//   Terminal A: pnpm exec firebase emulators:start --only firestore
//   Terminal B: pnpm run test:rules
//
// El runner de vitest para estos tests es vitest.rules.config.ts, separado
// del principal, porque necesita el emulador corriendo (no mocks) y un
// timeout más alto para el arranque del emulador.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'carwash-rules-test';
const WORKSPACE = 'ws-test-001';
const OWNER_UID = 'owner-uid-1';
const ADMIN_UID = 'admin-uid-1';
const STAFF_UID = 'staff-uid-1';
const STRANGER_UID = 'stranger-uid-1';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Helper: siembra el estado inicial como admin (bypassa rules). */
async function seed(data: {
  workspace?: { ownerUid?: string };
  operators?: Array<{ uid: string; rolePublic?: string | null }>;
  invites?: Array<{ id: string; targetRole: string; expiresAt: Date | null }>;
}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    if (data.workspace) {
      await setDoc(doc(db, 'workspaces', WORKSPACE), {
        name: 'Test Workspace',
        ownerUid: data.workspace.ownerUid ?? OWNER_UID,
        createdAt: serverTimestamp(),
        schemaVersion: 1,
      });
    }
    for (const op of data.operators ?? []) {
      const payload: Record<string, unknown> = {
        operatorId: op.uid,
        payload: 'encrypted-blob',
        createdAt: serverTimestamp(),
        schemaVersion: 4,
      };
      // null explícito = el campo NO existe (legacy v2), no `rolePublic: null`.
      if (op.rolePublic !== null) payload.rolePublic = op.rolePublic;
      await setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', op.uid), payload);
    }
    for (const inv of data.invites ?? []) {
      const payload: Record<string, unknown> = {
        inviteId: inv.id,
        blobInvite: 'blob',
        inviteSalt: 'salt',
        ivInvite: 'iv',
        targetRole: inv.targetRole,
        createdBy: OWNER_UID,
        createdAt: serverTimestamp(),
        schemaVersion: 1,
      };
      if (inv.expiresAt !== null) {
        payload.expiresAt = Timestamp.fromDate(inv.expiresAt);
      }
      await setDoc(doc(db, 'workspaces', WORKSPACE, 'invites', inv.id), payload);
    }
  });
}

// =========================================================================
// isWorkspaceMember exige rolePublic válido
// =========================================================================

describe('isWorkspaceMember exige rolePublic válido', () => {
  it('owner puede leer washers', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'washers', 'w1'), { name: 'Miguel' }));
  });

  it('admin puede leer washers', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: ADMIN_UID, rolePublic: 'admin' },
      ],
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'washers', 'w2'), { name: 'Luis' }));
  });

  it('staff puede leer washers', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(STAFF_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'washers', 'w3'), { name: 'Gisela' }));
  });

  it('operador SIN rolePublic no es miembro (legacy v2 sin migrar)', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: null }],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'washers', 'w4'), { name: 'No' }));
  });

  it('rolePublic corrupto no es miembro', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'garbage' }],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'washers', 'w5'), { name: 'No' }));
  });

  it('usuario anónimo sin operator doc no es miembro', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
    });
    const db = testEnv.authenticatedContext(STRANGER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'washers', 'w6'), { name: 'No' }));
  });
});

// =========================================================================
// operators.create — bootstrap y enrollment
// =========================================================================

describe('operators.create — bootstrap', () => {
  it('owner con ownerUid == uid puede crear su propio doc owner', async () => {
    await seed({ workspace: { ownerUid: OWNER_UID } });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', OWNER_UID), {
      operatorId: OWNER_UID,
      payload: 'blob',
      rolePublic: 'owner',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
    }));
  });

  it('uid distinto a ownerUid NO puede crear un doc owner', async () => {
    await seed({ workspace: { ownerUid: OWNER_UID } });
    const db = testEnv.authenticatedContext(STRANGER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STRANGER_UID), {
      operatorId: STRANGER_UID,
      payload: 'blob',
      rolePublic: 'owner',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
    }));
  });

  it('uid igual a operatorId con rol != owner sin invite falla', async () => {
    await seed({ workspace: { ownerUid: OWNER_UID } });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', OWNER_UID), {
      operatorId: OWNER_UID,
      payload: 'blob',
      rolePublic: 'admin',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
    }));
  });

  it('campos extra en el create fallan (hasOnly)', async () => {
    await seed({ workspace: { ownerUid: OWNER_UID } });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', OWNER_UID), {
      operatorId: OWNER_UID,
      payload: 'blob',
      rolePublic: 'owner',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
      evilField: 'oops',
    }));
  });
});

describe('operators.create — enrollment por invite', () => {
  it('invite vigente con targetRole == rolePublic permite el alta', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
      invites: [{
        id: 'inv-vivo',
        targetRole: 'staff',
        expiresAt: new Date(Date.now() + 3600_000),
      }],
    });
    const db = testEnv.authenticatedContext(STRANGER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STRANGER_UID), {
      operatorId: STRANGER_UID,
      payload: 'blob',
      rolePublic: 'staff',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
      inviteId: 'inv-vivo',
    }));
  });

  it('invite EXPIRADO no permite el alta', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
      invites: [{
        id: 'inv-muerto',
        targetRole: 'staff',
        expiresAt: new Date(Date.now() - 3600_000),
      }],
    });
    const db = testEnv.authenticatedContext(STRANGER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STRANGER_UID), {
      operatorId: STRANGER_UID,
      payload: 'blob',
      rolePublic: 'staff',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
      inviteId: 'inv-muerto',
    }));
  });

  it('invite SIN expiresAt no permite el alta (legacy pre-fix)', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
      invites: [{ id: 'inv-sin-fecha', targetRole: 'staff', expiresAt: null }],
    });
    const db = testEnv.authenticatedContext(STRANGER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STRANGER_UID), {
      operatorId: STRANGER_UID,
      payload: 'blob',
      rolePublic: 'staff',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
      inviteId: 'inv-sin-fecha',
    }));
  });

  it('targetRole != rolePublic falla', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
      invites: [{
        id: 'inv-admin',
        targetRole: 'admin',
        expiresAt: new Date(Date.now() + 3600_000),
      }],
    });
    const db = testEnv.authenticatedContext(STRANGER_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STRANGER_UID), {
      operatorId: STRANGER_UID,
      payload: 'blob',
      rolePublic: 'staff',
      createdAt: serverTimestamp(),
      schemaVersion: 4,
      inviteId: 'inv-admin',
    }));
  });
});

// =========================================================================
// operators.delete — expulsión por owner
// =========================================================================

describe('operators.delete — expulsión', () => {
  it('owner borra a otro operator', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(deleteDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STAFF_UID)));
  });

  it('owner NO puede borrarse a sí mismo (lockout)', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(deleteDoc(doc(db, 'workspaces', WORKSPACE, 'operators', OWNER_UID)));
  });

  it('admin NO puede borrar a nadie', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: ADMIN_UID, rolePublic: 'admin' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STAFF_UID)));
  });

  it('staff NO puede borrar a nadie', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(STAFF_UID).firestore();
    await assertFails(deleteDoc(doc(db, 'workspaces', WORKSPACE, 'operators', OWNER_UID)));
  });
});

// =========================================================================
// operators.update — cambio de rol
// =========================================================================

describe('operators.update — cambio de rol', () => {
  it('owner cambia rolePublic de otro operator', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STAFF_UID), {
      rolePublic: 'admin',
    }));
  });

  it('owner agregando campo extra falla (hasOnly)', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(updateDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STAFF_UID), {
      rolePublic: 'admin',
      updatedAt: serverTimestamp(),
    }));
  });

  it('staff NO puede auto-ascenderse', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(STAFF_UID).firestore();
    await assertFails(updateDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STAFF_UID), {
      rolePublic: 'owner',
    }));
  });

  it('backfill v2 (sin rolePublic) SÍ puede auto-asignarse owner', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: null },
      ],
    });
    const db = testEnv.authenticatedContext(STAFF_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, 'workspaces', WORKSPACE, 'operators', STAFF_UID), {
      rolePublic: 'owner',
      schemaVersion: 4,
    }));
  });
});

// =========================================================================
// invites — create con techo según rol
// =========================================================================

describe('invites.create', () => {
  it('owner puede crear invite admin', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'invites', 'i1'), {
      inviteId: 'i1',
      targetRole: 'admin',
      blobInvite: 'x',
      inviteSalt: 'y',
      ivInvite: 'z',
      createdBy: OWNER_UID,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 3600_000)),
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    }));
  });

  it('admin NO puede crear invite admin', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: ADMIN_UID, rolePublic: 'admin' },
      ],
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'invites', 'i2'), {
      inviteId: 'i2',
      targetRole: 'admin',
      blobInvite: 'x',
      inviteSalt: 'y',
      ivInvite: 'z',
      createdBy: ADMIN_UID,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 3600_000)),
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    }));
  });

  it('admin SÍ puede crear invite staff', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: ADMIN_UID, rolePublic: 'admin' },
      ],
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'invites', 'i3'), {
      inviteId: 'i3',
      targetRole: 'staff',
      blobInvite: 'x',
      inviteSalt: 'y',
      ivInvite: 'z',
      createdBy: ADMIN_UID,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 3600_000)),
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    }));
  });

  it('staff NO puede crear invites', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    const db = testEnv.authenticatedContext(STAFF_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'invites', 'i4'), {
      inviteId: 'i4',
      targetRole: 'staff',
      blobInvite: 'x',
      inviteSalt: 'y',
      ivInvite: 'z',
      createdBy: STAFF_UID,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 3600_000)),
      createdAt: serverTimestamp(),
      schemaVersion: 1,
    }));
  });
});

// =========================================================================
// settings — solo owner escribe
// =========================================================================

describe('settings.write — solo owner', () => {
  it('owner escribe pricing', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WORKSPACE, 'settings', 'pricing'), {
      priceMatrix: {},
    }));
  });

  it('admin NO escribe pricing', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: ADMIN_UID, rolePublic: 'admin' },
      ],
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WORKSPACE, 'settings', 'pricing'), {
      priceMatrix: {},
    }));
  });
});

// =========================================================================
// transactions — inmutables
// =========================================================================

describe('transactions — inmutables', () => {
  it('owner NO puede updatear una transacción', async () => {
    await seed({
      workspace: {},
      operators: [{ uid: OWNER_UID, rolePublic: 'owner' }],
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workspaces', WORKSPACE, 'transactions', 'tx1'), {
        transactionId: 'tx1',
        cost: 30,
      });
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(updateDoc(doc(db, 'workspaces', WORKSPACE, 'transactions', 'tx1'), {
      cost: 999,
    }));
  });

  it('admin puede borrar una transacción', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: ADMIN_UID, rolePublic: 'admin' },
      ],
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workspaces', WORKSPACE, 'transactions', 'tx2'), {
        transactionId: 'tx2',
      });
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(deleteDoc(doc(db, 'workspaces', WORKSPACE, 'transactions', 'tx2')));
  });

  it('staff NO puede borrar una transacción', async () => {
    await seed({
      workspace: {},
      operators: [
        { uid: OWNER_UID, rolePublic: 'owner' },
        { uid: STAFF_UID, rolePublic: 'staff' },
      ],
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workspaces', WORKSPACE, 'transactions', 'tx3'), {
        transactionId: 'tx3',
      });
    });
    const db = testEnv.authenticatedContext(STAFF_UID).firestore();
    await assertFails(deleteDoc(doc(db, 'workspaces', WORKSPACE, 'transactions', 'tx3')));
  });
});
