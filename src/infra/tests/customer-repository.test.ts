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
    // El setDoc real con `{ merge: true }` funde sobre el doc existente. Sin
    // esto, cualquier escritura parcial borraba el payload cifrado y un test
    // podía pasar por el motivo equivocado (o reventar al descifrar).
    setDoc: async (ref: any, data: any, options?: { merge?: boolean }) => {
      if (options?.merge) {
        store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...data });
      } else {
        store.set(ref.path, data);
      }
    },
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

  /** Pisa el contador del doc como lo haría un lavado, saltándose el ledger. */
  const forceAccumulatedWashes = (customerId: string, washes: number) => {
    const key = `workspaces/${workspaceId}/customers/${customerId}`;
    store.set(key, { ...(store.get(key) ?? {}), accumulatedWashes: washes });
  };

  it('recomputeLoyalty con ledger vacío deja el contador en 0', async () => {
    const customerId = await repo.create(samplePII);
    // Contador desincronizado: el lavado ya no está en el ledger (se anuló o se
    // importó mal), pero el doc del cliente sigue diciendo 1.
    forceAccumulatedWashes(customerId, 1);

    await repo.recomputeLoyalty(customerId);

    const found = await repo.findById(customerId);
    expect(found?.accumulatedWashes).toBe(0);
    // Y el write no se llevó por delante el resto del doc: el payload sigue ahí
    // y se descifra. Un `setDoc` sin merge habría dejado un cliente sin nombre.
    expect(found?.displayName).toBe(samplePII.displayName);
  });

  it('recomputeLoyalty no resucita un cliente borrado', async () => {
    const customerId = await repo.create(samplePII);
    await repo.delete(customerId);

    await repo.recomputeLoyalty(customerId);

    // Un doc fantasma con solo `accumulatedWashes` rompería el descifrado de
    // TODA la lista de clientes: no se escribe si el cliente ya no existe.
    expect(store.has(`workspaces/${workspaceId}/customers/${customerId}`)).toBe(false);
  });
});
