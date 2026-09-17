// src/infra/tests/invite-repository.test.ts
// Mismo patrón que washer-repository.test.ts: store en memoria + vi.mock de
// firebase/firestore. Aquí hay una diferencia: el repositorio usa `Timestamp`
// como VALOR (`Timestamp.fromMillis`), no solo como tipo, así que el mock tiene
// que traer la clase. Se declara dentro del factory a propósito: una clase a
// nivel de módulo estaría en TDZ cuando vitest ejecuta el factory.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteExpiredError, InviteNotFoundError } from '@infra/errors';
import { InviteRepository } from '@infra/invite-repository';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';

const store = new Map<string, Record<string, unknown>>();

vi.mock('firebase/firestore', () => {
  class MockTimestamp {
    constructor(private readonly ms: number) {}

    static fromMillis(ms: number): MockTimestamp {
      return new MockTimestamp(ms);
    }

    toMillis(): number {
      return this.ms;
    }

    toDate(): Date {
      return new Date(this.ms);
    }
  }

  return {
    collection: (_db: unknown, path: string) => ({ path }),
    doc: (_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` }),
    getDoc: async (ref: { path: string }) => {
      const data = store.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    },
    setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
      store.set(ref.path, { ...data });
    },
    deleteDoc: async (ref: { path: string }) => {
      store.delete(ref.path);
    },
    getDocs: async (q: { path: string }) => {
      const results = Array.from(store.entries()).filter(([key]) => key.startsWith(q.path));
      return {
        empty: results.length === 0,
        // Firestore devuelve en `doc.id` solo el último segmento del path.
        docs: results.map(([fullPath, data]) => ({
          id: fullPath.split('/').pop() ?? fullPath,
          data: () => data,
        })),
      };
    },
    serverTimestamp: () => new MockTimestamp(Date.now()),
    Timestamp: MockTimestamp,
  };
});

const mockRuntime = {
  app: {},
  db: {},
  auth: { currentUser: { uid: 'op-1' } },
} as unknown as FirebaseRuntime;

const WORKSPACE = 'ws-test-001';
const INVITES_PATH = `workspaces/${WORKSPACE}/invites`;

const VALID_INVITE = {
  inviteId: 'inv-1',
  blobInvite: 'YmxvYg==',
  inviteSalt: 'c2FsdA==',
  ivInvite: 'aXY=',
  targetRole: 'admin',
  createdBy: 'op-1',
  expiresInHours: 24,
} as const;

beforeEach(() => {
  store.clear();
});

describe('InviteRepository', () => {
  it('create + getById devuelven el mismo paquete de conexión', async () => {
    const repo = new InviteRepository(mockRuntime, WORKSPACE);

    await repo.create(VALID_INVITE);
    const invite = await repo.getById('inv-1');

    expect(invite.inviteId).toBe('inv-1');
    expect(invite.blobInvite).toBe('YmxvYg==');
    expect(invite.inviteSalt).toBe('c2FsdA==');
    expect(invite.ivInvite).toBe('aXY=');
    expect(invite.targetRole).toBe('admin');
    expect(invite.createdBy).toBe('op-1');
    expect(invite.schemaVersion).toBe(1);
    // 24h de validez: tiene que quedar futuro, o el invite nace caducado.
    expect(invite.expiresAt.toMillis()).toBeGreaterThan(Date.now());
  });

  it('getById sobre un invite expirado lanza InviteExpiredError', async () => {
    const repo = new InviteRepository(mockRuntime, WORKSPACE);
    store.set(`${INVITES_PATH}/inv-viejo`, {
      inviteId: 'inv-viejo',
      expiresAt: { toMillis: () => Date.now() - 60_000 },
    });

    await expect(repo.getById('inv-viejo')).rejects.toThrow(InviteExpiredError);
  });

  it('getById sobre un inviteId desconocido lanza InviteNotFoundError', async () => {
    const repo = new InviteRepository(mockRuntime, WORKSPACE);

    await expect(repo.getById('no-existe')).rejects.toThrow(InviteNotFoundError);
  });

  it('delete borra el invite: un solo uso', async () => {
    const repo = new InviteRepository(mockRuntime, WORKSPACE);
    await repo.create(VALID_INVITE);

    await repo.delete('inv-1');

    expect(store.has(`${INVITES_PATH}/inv-1`)).toBe(false);
    await expect(repo.getById('inv-1')).rejects.toThrow(InviteNotFoundError);
  });
});

describe('InviteRepository.listActive', () => {
  it('devuelve solo invites no expirados, ordenados por expiración', async () => {
    const base = {
      blobInvite: '',
      inviteSalt: '',
      ivInvite: '',
      targetRole: 'staff',
      createdBy: 'op-1',
      createdAt: { toMillis: () => Date.now() },
      schemaVersion: 1,
    };
    store.set(`${INVITES_PATH}/luego`, {
      ...base,
      inviteId: 'luego',
      expiresAt: { toMillis: () => Date.now() + 7_200_000 },
    });
    store.set(`${INVITES_PATH}/vivo`, {
      ...base,
      inviteId: 'vivo',
      expiresAt: { toMillis: () => Date.now() + 3_600_000 },
    });
    store.set(`${INVITES_PATH}/muerto`, {
      ...base,
      inviteId: 'muerto',
      expiresAt: { toMillis: () => Date.now() - 60_000 },
    });

    const active = await new InviteRepository(mockRuntime, WORKSPACE).listActive();

    expect(active.map((invite) => invite.inviteId)).toEqual(['vivo', 'luego']);
  });
});
