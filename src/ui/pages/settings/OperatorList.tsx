import { useSignal, useSignalEffect } from '@preact/signals';
import { OperatorRepository } from '@infra/operator-repository';
import { translateError } from '@ui/i18n/es';
import type { OperatorRole, OperatorView } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './OperatorList.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
  currentOperatorId: string;
  viewerRole: OperatorRole;
}

/** Badge por rol. El carmesí (accent) queda reservado para el owner; admin va en ámbar. */
function roleClass(role: OperatorRole, classNames: Record<string, string>): string {
  if (role === 'owner') return `${classNames.badge} ${classNames.owner}`;
  if (role === 'admin') return `${classNames.badge} ${classNames.admin}`;
  return `${classNames.badge} ${classNames.staff}`;
}

/** El `code` de Firebase llega como string suelto: sin `any`, comprobado a mano. */
function isPermissionDenied(thrown: unknown): boolean {
  return (
    typeof thrown === 'object' &&
    thrown !== null &&
    (thrown as { code?: unknown }).code === 'permission-denied'
  );
}

function isOperatorRole(raw: string): raw is OperatorRole {
  return raw === 'owner' || raw === 'admin' || raw === 'staff';
}

export function OperatorList({ runtime, workspaceId, currentOperatorId, viewerRole }: Props) {
  const operators = useSignal<OperatorView[]>([]);
  const loading = useSignal(true);
  const error = useSignal('');
  const busyOperatorId = useSignal<string | null>(null);
  const busyExpelling = useSignal<string | null>(null);

  useSignalEffect(() => {
    const repo = new OperatorRepository(runtime, workspaceId);
    repo.listAll()
      .then((list) => { operators.value = list; })
      .catch((e) => { error.value = translateError(e); })
      .finally(() => { loading.value = false; });
  });

  const changeRole = async (operatorId: string, rawRole: string): Promise<void> => {
    if (!isOperatorRole(rawRole)) return;
    busyOperatorId.value = operatorId;
    error.value = '';
    try {
      const repo = new OperatorRepository(runtime, workspaceId);
      await repo.updateRole(operatorId, rawRole);
      // Refetch en vez de parchear el array en memoria: si otra tablet cambió
      // algo mientras tanto, la lista lo recoge.
      operators.value = await repo.listAll();
    } catch (thrown) {
      error.value = isPermissionDenied(thrown)
        ? 'Solo el dueño puede cambiar roles.'
        : translateError(thrown);
    } finally {
      busyOperatorId.value = null;
    }
  };

  const expel = async (operator: OperatorView): Promise<void> => {
    const ok = window.confirm(
      `¿Expulsar a ${operator.displayName}?\n\n` +
      `Se borra su acceso al workspace en este instante: no va a poder ` +
      `registrar lavados ni ver clientes. Para que vuelva a entrar, ` +
      `vas a tener que generarle un código de conexión nuevo.\n\n` +
      `Su bóveda local queda intacta en su dispositivo.`,
    );
    if (!ok) return;

    busyExpelling.value = operator.id;
    error.value = '';
    try {
      const repo = new OperatorRepository(runtime, workspaceId);
      await repo.expel(operator.id);
      // Refetch en vez de mutar el array: si otra tablet cambió algo mientras
      // tanto, la lista lo recoge.
      operators.value = await repo.listAll();
    } catch (thrown) {
      error.value = isPermissionDenied(thrown)
        ? 'Solo el dueño puede expulsar operadores.'
        : translateError(thrown);
    } finally {
      busyExpelling.value = null;
    }
  };

  return (
    <div class={styles.root}>
      {loading.value ? (
        <p class={styles.muted}>Cargando equipo…</p>
      ) : operators.value.length === 0 ? (
        <p class={styles.muted}>Aún no hay operadores registrados.</p>
      ) : (
        <ul class={styles.list}>
          {operators.value.map((op) => (
            <li key={op.id} class={styles.row}>
              <span class={styles.name}>{op.displayName}</span>
              {op.id === currentOperatorId && <span class={styles.self}>tú</span>}
              {viewerRole === 'owner' && op.id !== currentOperatorId ? (
                <div class={styles.rowActions}>
                  <select
                    class={styles.roleSelect}
                    value={op.role}
                    disabled={busyOperatorId.value === op.id}
                    aria-label={`Rol de ${op.displayName}`}
                    onChange={(event) => {
                      void changeRole(op.id, event.currentTarget.value);
                    }}
                  >
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="staff">staff</option>
                  </select>
                  <button
                    type="button"
                    class={styles.expelBtn}
                    onClick={() => { void expel(op); }}
                    disabled={busyExpelling.value === op.id}
                    aria-label={`Expulsar a ${op.displayName}`}
                    title="Expulsar operador"
                  >
                    {busyExpelling.value === op.id ? '…' : 'Expulsar'}
                  </button>
                </div>
              ) : (
                <span class={roleClass(op.role, styles)}>{op.role}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {error.value && <p class={styles.error}>{error.value}</p>}

      {viewerRole === 'owner' ? (
        <p class={styles.note}>
          Podés cambiar el rol de cualquier operador excepto el tuyo, y expulsar a
          quien ya no trabaja acá. Expulsar borra su acceso al instante — para que
          vuelva a entrar, generá un código de conexión nuevo. Los dispositivos
          nuevos se enrolan con un código de conexión.
        </p>
      ) : (
        <p class={styles.note}>
          Solo el dueño puede cambiar roles. Podés generar códigos de conexión abajo.
        </p>
      )}
    </div>
  );
}
