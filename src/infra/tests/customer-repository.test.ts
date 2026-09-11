// src/infra/test/customer-repository.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { CustomerRepository } from '@infra/customer-repository';
import { Vault } from '@infra/vault';
import { DuplicatePlateError } from '@infra/errors';
import type { CustomerPII } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

// Store mutable, reseteado en beforeEach para evitar contaminación.
const store = new Map<string, any>();

const mockFirestore = { type: 'firestore' };
const mockAuth = { currentUser: { uid: 'test-uid' } };
const mockRuntime: FirebaseRuntime = {
  app: {} as any,
  db: mockFirestore as any,
  auth: mockAuth as any,
};

vi.mock('firebase/firestore', async () => {
  return {
    collection: (_db: any, path: string) => ({ path }),
    doc: (_db: any, path: string, id: string) => ({ path: `${path}/${id}` }),
    getDoc: async (ref: any) => {
      const data = store.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    },
    getDocs: async (q: any) => {
      const results = Array.from(store.entries())
        .filter(([key]) => key.startsWith(q.path))
        .filter(([, value]) => {
          if (!q._constraints) return true;
          return q._constraints.every((c: any) =>
            c.filter ? c.filter(value) : true
          );
        });
      return {
        empty: results.length === 0,
        docs: results.map(([id, data]) => ({ id, data: () => data })),
      };
    },
    query: (col: any, ...constraints: any[]) => ({
      path: col.path,
      _constraints: constraints,
    }),
    where: (field: string, op: string, value: any) => ({
      filter: (doc: any) => {
        if (op === '==') return doc[field] === value;
        return true;
      },
    }),
    limit: () => ({ limit: true }),
    orderBy: () => ({ orderBy: true }),
    setDoc: async (ref: any, data: any) => { store.set(ref.path, data); },
    deleteDoc: async (ref: any) => { store.delete(ref.path); },
    onSnapshot: () => () => {},
    serverTimestamp: () => Date.now(),
  };
});

describe('CustomerRepository', () => {
  const workspaceId = 'ws-test-001';
  let repo: CustomerRepository;

  const samplePII: CustomerPII = {
    displayName: 'Juan Pérez',
    plate: 'ABC-123',
    phone: '+51999888777',
  };

  beforeAll(async () => {
    // El repositorio firma las huellas de placa con la clave HMAC de la bóveda:
    // sin bóveda viva no hay huella. La levantamos de verdad sobre fake-indexeddb
    // en vez de inyectar una clave suelta, para no testear un mundo imposible.
    await Vault.initDevice({ workspaceId: crypto.randomUUID(), pin: '123456' });
  });

  beforeEach(() => {
    // Reset del store antes de cada test: cada test arranca con estado limpio.
    // Sin esto, el mock comparte datos entre tests y los DuplicatePlateError
    // se disparan antes del expect, matando el test con unhandled rejection.
    store.clear();
    repo = new CustomerRepository(mockRuntime, workspaceId);
  });

  it('create + findById round-trip preserva PII', async () => {
    const customerId = await repo.create(samplePII);
    const found = await repo.findById(customerId);
    expect(found).not.toBeNull();
    expect(found?.displayName).toBe(samplePII.displayName);
    expect(found?.plate).toBe(samplePII.plate);
    expect(found?.phone).toBe(samplePII.phone);
  });

  it('create con placa duplicada lanza DuplicatePlateError', async () => {
    await repo.create(samplePII);
    await expect(repo.create(samplePII)).rejects.toThrow(DuplicatePlateError);
  });

  it('findByPlate encuentra con placa normalizada', async () => {
    await repo.create(samplePII);
    const found = await repo.findByPlate('abc-123');
    expect(found?.plate).toBe('ABC-123');
  });

  it('delete remueve el doc', async () => {
    const customerId = await repo.create(samplePII);
    await repo.delete(customerId);
    const found = await repo.findById(customerId);
    expect(found).toBeNull();
  });
});
