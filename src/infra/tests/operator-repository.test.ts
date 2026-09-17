// src/infra/tests/operator-repository.test.ts
// Mismo patrón que washer-repository.test.ts: store en memoria + vi.mock de
// firebase/firestore. Aquí interesa el CONTENIDO del setDoc (rol, schemaVersion
// y si viaja o no el inviteId), porque de eso dependen las rules de Firestore.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionKeyManager } from '@infra/session-key';
import { OperatorRepository } from '@infra/operator-repository';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

const store = new Map<string, Record<string, unknown>>();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` }),
  getDoc: async (ref: { path: string }) => {
    const data = store.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async (
    ref: { path: string },
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ) => {
    const previous = options?.merge ? store.get(ref.path) ?? {} : {};
    store.set(ref.path, { ...previous, ...data });
  },
  query: (col: { path: string }) => ({ path: col.path }),
  serverTimestamp: () => Date.now(),
}));

const mockRuntime = {
  app: {},
  db: {},
  auth: { currentUser: { uid: 'op-1' } },
} as unknown as FirebaseRuntime;

const WORKSPACE = 'ws-test-001';
const MY_DOC = `workspaces/${WORKSPACE}/operators/op-1`;

beforeAll(async () => {
  // El payload va cifrado: sin sesión abierta no hay clave.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  SessionKeyManager.adoptKey(key);
});

beforeEach(() => {
  store.clear();
});

describe('OperatorRepository.ensureBootstrap', () => {
  it('el bootstrap del owner firma sin inviteId y en v4', async () => {
    const repo = new OperatorRepository(mockRuntime, WORKSPACE);

    await repo.ensureBootstrap('Ana', 'owner');

    const doc = store.get(MY_DOC);
    expect(doc?.operatorId).toBe('op-1');
    expect(doc?.rolePublic).toBe('owner');
    expect(doc?.schemaVersion).toBe(4);
    expect(typeof doc?.payload).toBe('string');
    // La ausencia de la key es lo que la rule lee como "vino del bootstrap":
    // un `inviteId: undefined` explícito rompería esa distinción.
    expect(doc && 'inviteId' in doc).toBe(false);
  });

  it('el enrollment escribe el rol del invite y su inviteId', async () => {
    const repo = new OperatorRepository(mockRuntime, WORKSPACE);

    await repo.ensureBootstrap('Luis', 'staff', 'invite-abc');

    const doc = store.get(MY_DOC);
    expect(doc?.rolePublic).toBe('staff');
    expect(doc?.schemaVersion).toBe(4);
    expect(doc?.inviteId).toBe('invite-abc');
  });

  it('es idempotente: si el doc ya existe no lo pisa', async () => {
    const repo = new OperatorRepository(mockRuntime, WORKSPACE);
    store.set(MY_DOC, {
      operatorId: 'op-1',
      payload: 'previo',
      rolePublic: 'staff',
      schemaVersion: 4,
    });

    const uid = await repo.ensureBootstrap('Ana', 'owner');

    expect(uid).toBe('op-1');
    expect(store.get(MY_DOC)).toEqual({
      operatorId: 'op-1',
      payload: 'previo',
      rolePublic: 'staff',
      schemaVersion: 4,
    });
  });
});

describe('OperatorRepository.updateRole', () => {
  it('escribe SOLO rolePublic con merge: no toca schemaVersion ni payload', async () => {
    const repo = new OperatorRepository(mockRuntime, WORKSPACE);
    store.set(MY_DOC, {
      operatorId: 'op-1',
      payload: 'cifrado-viejo',
      rolePublic: 'staff',
      schemaVersion: 4,
    });

    await repo.updateRole('op-1', 'admin');

    // La regla exige `affectedKeys().hasOnly(['rolePublic'])`: cualquier campo de
    // más (un `updatedAt` de cortesía, por ejemplo) sería permission-denied.
    expect(store.get(MY_DOC)).toEqual({
      operatorId: 'op-1',
      payload: 'cifrado-viejo',
      rolePublic: 'admin',
      schemaVersion: 4,
    });
  });
});

describe('OperatorRepository.migrateLegacyRole', () => {
  it('migra el doc v2 (sin rol) y no toca uno que ya tiene rol', async () => {
    const repo = new OperatorRepository(mockRuntime, WORKSPACE);

    // Doc legacy: el rol aún no existe en claro.
    store.set(MY_DOC, { operatorId: 'op-1', payload: 'v2', schemaVersion: 2 });
    await repo.migrateLegacyRole();
    expect(store.get(MY_DOC)).toMatchObject({ rolePublic: 'owner', schemaVersion: 4 });

    // Doc con rol (staff enrolado): el guard tiene que dejarlo en paz. Si esto
    // falla, cada arranque del shell reescribe `rolePublic: 'owner'` — ascenso
    // silencioso y, con las rules nuevas, permission-denied en la cabecera.
    store.set(MY_DOC, {
      operatorId: 'op-1',
      payload: 'v4',
      rolePublic: 'staff',
      schemaVersion: 4,
    });
    await repo.migrateLegacyRole();
    expect(store.get(MY_DOC)).toMatchObject({ rolePublic: 'staff', schemaVersion: 4 });
  });
});
