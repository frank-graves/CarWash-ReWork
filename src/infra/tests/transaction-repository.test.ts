// src/infra/tests/transaction-repository.test.ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { TransactionRepository } from '@infra/transaction-repository';
import { SessionKeyManager } from '@infra/session-key';
import { PrivacyVault } from '@infra/crypto';
import type { RecordWashInput } from '@infra/transaction-repository';
import type { CustomerView } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

const mockFirestore = {};
const mockAuth = { currentUser: { uid: 'test-uid' } };
const mockRuntime: FirebaseRuntime = {
  app: {} as any,
  db: mockFirestore as any,
  auth: mockAuth as any,
};

// vi.hoisted corre ANTES del hoisting de vi.mock, así que el factory
// puede referenciar __mockStores sin violar Temporal Dead Zone.
// Este hack expone los stores internos del mock a los tests; desaparece
// cuando migremos a @firebase/rules-unit-testing en Fase 5.
const { __mockStores } = vi.hoisted(() => ({
  __mockStores: {
    transactions: new Map<string, any>(),
    customers: new Map<string, any>(),
  },
}));

vi.mock('firebase/firestore', async () => {
  const txStore = __mockStores.transactions;
  const custStore = __mockStores.customers;

  // Timestamp falso con la misma API que el real (.toDate()).
  // Evita importar el módulo real, que arrastraría la cadena de Firebase.
  class MockTimestamp {
    constructor(private readonly date: Date) {}
    toDate(): Date {
      return this.date;
    }
    static fromDate(d: Date): MockTimestamp {
      return new MockTimestamp(d);
    }
  }

  return {
    Timestamp: MockTimestamp,
    collection: (_db: any, path: string) => ({ path }),
    // Dos formas de invocar doc():
    //   doc(db, 'collection/path')                  → path + id autogenerado
    //   doc(db, 'collection/path', 'explicitId')    → path + id explícito
    //   doc(collectionRef)                          → path del ref + id autogenerado
    doc: (arg1: any, arg2?: string, arg3?: string) => {
      // Forma corta: doc(collectionRef)
      if (arg2 === undefined) {
        const basePath = arg1.path;
        const autoId = `auto-${Math.random().toString(36).slice(2, 10)}`;
        return { path: `${basePath}/${autoId}`, id: autoId };
      }
      // Forma larga: doc(db, path) o doc(db, path, id)
      const path = arg2;
      if (arg3 !== undefined) {
        return { path: `${path}/${arg3}`, id: arg3 };
      }
      const autoId = `auto-${Math.random().toString(36).slice(2, 10)}`;
      return { path: `${path}/${autoId}`, id: autoId };
    },
    getDoc: async (ref: any) => {
      const data = custStore.get(ref.path) ?? txStore.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    },
    // Anular un lavado es un borrado real, así que el mock tiene que sacar la
    // key del store: si solo la ignorara, el test de `annul` pasaría sin que
    // el repositorio hubiera borrado nada.
    deleteDoc: async (ref: any) => {
      txStore.delete(ref.path);
    },
    getDocs: async (q: any) => {
      const results = Array.from(txStore.entries())
        .filter(([key]) => key.startsWith(q.path))
        .sort(
          (a, b) =>
            b[1].createdAt.toDate().getTime() -
            a[1].createdAt.toDate().getTime()
        );
      return {
        empty: results.length === 0,
        docs: results.map(([id, data]) => ({ id, data: () => data })),
      };
    },
    query: (col: any, ..._constraints: any[]) => ({ path: col.path }),
    orderBy: () => ({ orderBy: true }),
    limit: () => ({ limit: true }),
    runTransaction: async (_db: any, callback: any) => {
      const mockTx = {
        get: async (ref: any) => ({
          exists: () => custStore.has(ref.path),
          data: () => custStore.get(ref.path),
        }),
        update: (ref: any, data: any) => {
          const current = custStore.get(ref.path) || {};
          custStore.set(ref.path, { ...current, ...data });
        },
        set: (ref: any, data: any) => {
          txStore.set(ref.path, data);
        },
      };
      return callback(mockTx);
    },
    onSnapshot: () => () => {},
    serverTimestamp: () => MockTimestamp.fromDate(new Date()),
  };
});

describe('TransactionRepository', () => {
  const workspaceId = 'ws-test-001';
  let repo: TransactionRepository;

  const mockCustomer: CustomerView = {
    customerId: 'cust-001',
    displayName: 'Juan Pérez',
    plate: 'ABC-123',
    phone: '+51999888777',
    accumulatedWashes: 2,
    isEligibleForFreeWash: false,
    lastWashAt: null,
  };

  beforeAll(async () => {
    // Clave de sesión real para el ciclo cifrado/descifrado del ledger. Ya no hay
    // passphrase: la única que deriva es la bóveda, y aquí basta con una AES-GCM
    // no extraíble para ejercitar el repositorio.
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    SessionKeyManager.adoptKey(key);
  });

  beforeEach(() => {
    // Limpiamos ambos stores y pre-poblamos el cliente que los tests esperan.
    // Sin esto, runTransaction lanza "Customer disappeared mid-transaction".
    __mockStores.transactions.clear();
    __mockStores.customers.clear();
    __mockStores.customers.set(
      `workspaces/${workspaceId}/customers/${mockCustomer.customerId}`,
      {
        customerId: mockCustomer.customerId,
        payload: 'encrypted-placeholder',
        plateHash: 'hash-placeholder',
        accumulatedWashes: 2,
        lastResetAt: null,
        createdAt: Date.now(),
        schemaVersion: 1,
      }
    );

    repo = new TransactionRepository(mockRuntime, workspaceId);
  });

  const baseInput: RecordWashInput = {
    customer: mockCustomer,
    vehicleKind: 'auto',
    serviceTier: 'basico',
    cost: 30,
    wasFree: false,
    paidWith: 'efectivo',
    registeredBy: { id: 'op-001', name: 'Carlos' },
    washers: [{ id: 'wash-001', name: 'Miguel' }],
  };

  it('record con wasFree: false retorna transactionId', async () => {
    const txId = await repo.record(baseInput);
    expect(txId).toBeDefined();
    expect(typeof txId).toBe('string');
  });

  it('record con wasFree: true retorna transactionId', async () => {
    const txId = await repo.record({ ...baseInput, wasFree: true });
    expect(txId).toBeDefined();
  });

  it('listRecent devuelve transacciones', async () => {
    await repo.record(baseInput);
    await repo.record({ ...baseInput, cost: 40 });
    const recent = await repo.listRecent(10);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    expect(recent[0]?.customerName).toBe('Juan Pérez');
    // El esquema 2 separa quién registra de quién lava, y el ledger conserva ambos.
    expect(recent[0]?.registeredByName).toBe('Carlos');
    expect(recent[0]?.washerNames).toEqual(['Miguel']);
  });

  it('annul borra la transacción del ledger', async () => {
    const txId = await repo.record(baseInput);
    expect(
      __mockStores.transactions.has(
        `workspaces/${workspaceId}/transactions/${txId}`,
      ),
    ).toBe(true);

    await repo.annul(txId);

    expect(
      __mockStores.transactions.has(
        `workspaces/${workspaceId}/transactions/${txId}`,
      ),
    ).toBe(false);
  });

  it('record con washers: [] tira error', async () => {
    await expect(repo.record({ ...baseInput, washers: [] }))
      .rejects.toThrow('Falta al menos un lavador');
  });

  it('record con 2 washers guarda dos ids y dos nombres', async () => {
    const txId = await repo.record({
      ...baseInput,
      washers: [
        { id: 'w1', name: 'Gisela' },
        { id: 'w2', name: 'Luis' },
      ],
    });
    const stored = __mockStores.transactions.get(
      `workspaces/${workspaceId}/transactions/${txId}`,
    );
    expect(stored.washerIds).toEqual(['w1', 'w2']);
    expect(stored.washerNames).toEqual(['Gisela', 'Luis']);
  });

  it('v2 → v3: lee washerName (string) y lo expone como array', async () => {
    // El snapshot legacy va cifrado en producción; el mock descifra de verdad,
    // así que el doc inyectado tiene que traer un payload real, no un placeholder.
    const snapshot = await PrivacyVault.encryptPayload(
      { displayName: mockCustomer.displayName, plate: mockCustomer.plate },
      SessionKeyManager.getKey(),
    );
    __mockStores.transactions.set(
      `workspaces/${workspaceId}/transactions/tx-v2`,
      {
        transactionId: 'tx-v2',
        customerId: mockCustomer.customerId,
        customerSnapshot: snapshot,
        vehicleKind: 'auto',
        serviceTier: 'basico',
        cost: 30,
        wasFree: false,
        paidWith: 'efectivo',
        registeredById: 'op-001',
        registeredByName: 'Carlos',
        washerId: 'wash-001',
        washerName: 'Miguel',
        createdAt: { toDate: () => new Date() },
        schemaVersion: 2,
      },
    );
    const recent = await repo.listRecent(10);
    const v2 = recent.find((t) => t.transactionId === 'tx-v2');
    expect(v2?.washerNames).toEqual(['Miguel']);
  });

  it('v1 → v3: sin washer, cae al operatorName', async () => {
    const snapshot = await PrivacyVault.encryptPayload(
      { displayName: mockCustomer.displayName, plate: mockCustomer.plate },
      SessionKeyManager.getKey(),
    );
    __mockStores.transactions.set(
      `workspaces/${workspaceId}/transactions/tx-v1`,
      {
        transactionId: 'tx-v1',
        customerId: mockCustomer.customerId,
        customerSnapshot: snapshot,
        vehicleKind: 'auto',
        serviceTier: 'basico',
        cost: 30,
        wasFree: false,
        paidWith: 'efectivo',
        operatorId: 'op-001',
        operatorName: 'Carlos',
        createdAt: { toDate: () => new Date() },
        schemaVersion: 1,
      },
    );
    const recent = await repo.listRecent(10);
    const v1 = recent.find((t) => t.transactionId === 'tx-v1');
    expect(v1?.washerNames).toEqual(['Carlos']);
  });
});