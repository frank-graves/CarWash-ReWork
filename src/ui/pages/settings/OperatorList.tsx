import { useSignal, useSignalEffect } from '@preact/signals';
import { OperatorRepository } from '@infra/operator-repository';
import { translateError } from '@ui/i18n/es';
import type { OperatorView } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './OperatorList.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
}

export function OperatorList({ runtime, workspaceId }: Props) {
  const operators = useSignal<OperatorView[]>([]);
  const loading = useSignal(true);
  const error = useSignal('');

  useSignalEffect(() => {
    const repo = new OperatorRepository(runtime, workspaceId);
    repo.listAll()
      .then((list) => { operators.value = list; })
      .catch((e) => { error.value = translateError(e); })
      .finally(() => { loading.value = false; });
  });

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
              <span class={op.role === 'owner' ? `${styles.badge} ${styles.owner}` : `${styles.badge} ${styles.staff}`}>
                {op.role}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error.value && <p class={styles.error}>{error.value}</p>}

      <p class={styles.note}>
        Para añadir operadores, contacta con soporte. Disponible en la próxima versión.
      </p>
    </div>
  );
}
