// src/infra/tests/washer-repository.test.ts
// Mismo patrón que customer-repository.test.ts: store en memoria + vi.mock de
// firebase/firestore. El mock entiende `where` y `limit` porque el borrado
// consulta el ledger antes de tocar nada.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WasherInUseError } from '@infra/errors';
import { SessionKeyManager } from '@infra/session-key';
import { WasherRepository } from '@infra/washer-repository';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

const store = new Map<string, Record<string, unknown>>();

interface MockConstraint {
  filter?: (doc: Record<string, unknown>) => boolean;
}

vi.mock('firebase/firestore', async () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` }),
  getDoc: async (ref: { path: string }) => {
    const data = store.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocs: async (q: { path: string; _constraints?: MockConstraint[] }) => {
    const results = Array.from(store.entries())
      .filter(([key]) => key.startsWith(q.path))
      .filter(([, value]) =>
        (q._constraints ?? []).every((constraint) =>
          constraint.filter ? constraint.filter(value) : true
        )
      );
    return {
      empty: results.length === 0,
      // Firestore devuelve en `doc.id` solo el último segmento del path,
      // no la ruta completa. El mock guarda por path, así que hay que
      // extraerlo — de lo contrario listAll() devuelve rutas como "id".
      docs: results.map(([fullPath, data]) => {
        const segments = fullPath.split('/');
        const id = segments[segments.length - 1] ?? fullPath;
        return { id, data: () => data };
      }),
    };
  },
  setDoc: async (
    ref: { path: string },
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ) => {
    // merge: true es lo que usa update(); respetarlo importa: sin esto el test
    // pasaría aunque el repositorio pisara el documento entero.
    const previous = options?.merge ? store.get(ref.path) ?? {} : {};
    store.set(ref.path, { ...previous, ...data });
  },
  deleteDoc: async (ref: { path: string }) => {
    store.delete(ref.path);
  },
  query: (col: { path: string }, ...constraints: MockConstraint[]) => ({
    path: col.path,
    _constraints: constraints,
  }),
  where: (field: string, op: string, value: unknown) => ({
    filter: (doc: Record<string, unknown>) => (op === '==' ? doc[field] === value : true),
  }),
  limit: () => ({ limit: true }),
  serverTimestamp: () => Date.now(),
}));

const mockRuntime = {
  app: {},
  db: {},
  auth: { currentUser: { uid: 'op-1' } },
} as unknown as FirebaseRuntime;

const WORKSPACE = 'ws-test-001';
const LEDGER_PATH = `workspaces/${WORKSPACE}/transactions`;

beforeAll(async () => {
  // Los payloads van cifrados: sin sesión abierta no hay clave.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  SessionKeyManager.adoptKey(key);
});

beforeEach(() => {
  store.clear();
});

describe('WasherRepository', () => {
  it('create + listAll preserva el nombre del lavador', async () => {
    const repo = new WasherRepository(mockRuntime, WORKSPACE);

    const id = await repo.create('Miguel');
    const washers = await repo.listAll();

    expect(washers).toHaveLength(1);
    expect(washers[0]?.id).toBe(id);
    expect(washers[0]?.displayName).toBe('Miguel');
  });

  it('update re-cifra el payload y listAll devuelve el nombre nuevo', async () => {
    const repo = new WasherRepository(mockRuntime, WORKSPACE);
    const id = await repo.create('Miguel');

    await repo.update(id, 'Miguel Ángel');

    const washers = await repo.listAll();
    expect(washers[0]?.displayName).toBe('Miguel Ángel');
  });

  it('delete sobre un lavador sin transacciones lo borra', async () => {
    const repo = new WasherRepository(mockRuntime, WORKSPACE);
    const id = await repo.create('Miguel');

    await repo.delete(id);

    expect(await repo.listAll()).toEqual([]);
  });

  it('delete sobre un lavador con transacciones lanza WasherInUseError', async () => {
    const repo = new WasherRepository(mockRuntime, WORKSPACE);
    const id = await repo.create('Miguel');
    store.set(`${LEDGER_PATH}/tx-1`, {
      transactionId: 'tx-1',
      washerId: id,
      schemaVersion: 2,
    });

    await expect(repo.delete(id)).rejects.toThrow(WasherInUseError);

    // Y el lavador sigue ahí: el error no deja el borrado a medias.
    expect(await repo.listAll()).toHaveLength(1);
  });
});
