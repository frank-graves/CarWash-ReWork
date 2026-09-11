import { useSignal, useSignalEffect } from '@preact/signals';
import { WasherRepository } from '@infra/washer-repository';
import { WasherInUseError } from '@infra/errors';
import { translateError } from '@ui/i18n/es';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './WasherManager.module.css';

interface WasherView { id: string; displayName: string; }

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
}

export function WasherManager({ runtime, workspaceId }: Props) {
  const washers = useSignal<WasherView[]>([]);
  const loading = useSignal(true);
  const error = useSignal('');

  const creating = useSignal(false);
  const newName = useSignal('');

  const editingId = useSignal<string | null>(null);
  const editingName = useSignal('');

  const refresh = async () => {
    try {
      const repo = new WasherRepository(runtime, workspaceId);
      washers.value = await repo.listAll();
    } catch (e) {
      error.value = translateError(e);
    } finally {
      loading.value = false;
    }
  };

  useSignalEffect(() => { void refresh(); });

  const handleCreate = async () => {
    const trimmed = newName.value.trim();
    if (!trimmed) return;
    creating.value = true;
    error.value = '';
    try {
      const repo = new WasherRepository(runtime, workspaceId);
      await repo.create(trimmed);
      newName.value = '';
      await refresh();
    } catch (e) {
      error.value = translateError(e);
    } finally {
      creating.value = false;
    }
  };

  const startEdit = (washer: WasherView) => {
    editingId.value = washer.id;
    editingName.value = washer.displayName;
  };

  const cancelEdit = () => {
    editingId.value = null;
    editingName.value = '';
  };

  const commitEdit = async () => {
    if (!editingId.value) return;
    const trimmed = editingName.value.trim();
    if (!trimmed) return;
    error.value = '';
    try {
      const repo = new WasherRepository(runtime, workspaceId);
      await repo.update(editingId.value, trimmed);
      editingId.value = null;
      editingName.value = '';
      await refresh();
    } catch (e) {
      error.value = translateError(e);
    }
  };

  const handleDelete = async (washer: WasherView) => {
    // Confirmación nativa: es una acción destructiva rara, no merece modal custom.
    const ok = window.confirm(`¿Eliminar a ${washer.displayName}?`);
    if (!ok) return;
    error.value = '';
    try {
      const repo = new WasherRepository(runtime, workspaceId);
      await repo.delete(washer.id);
      await refresh();
    } catch (e) {
      if (e instanceof WasherInUseError) {
        error.value = 'Ese lavador tiene lavados registrados y no se puede eliminar.';
      } else {
        error.value = translateError(e);
      }
    }
  };

  return (
    <div class={styles.root}>
      <div class={styles.createRow}>
        <input
          type="text"
          class={styles.input}
          placeholder="Nombre del lavador"
          value={newName.value}
          onInput={(e) => { newName.value = e.currentTarget.value; }}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
        />
        <button
          type="button"
          class={styles.createBtn}
          onClick={handleCreate}
          disabled={creating.value || !newName.value.trim()}
        >
          + Nuevo lavador
        </button>
      </div>

      {error.value && <p class={styles.error}>{error.value}</p>}

      {loading.value ? (
        <p class={styles.muted}>Cargando…</p>
      ) : washers.value.length === 0 ? (
        <p class={styles.muted}>Sin lavadores todavía. Añade el primero arriba.</p>
      ) : (
        <ul class={styles.list}>
          {washers.value.map((washer) => (
            <li key={washer.id} class={styles.row}>
              {editingId.value === washer.id ? (
                <>
                  <input
                    type="text"
                    class={styles.input}
                    value={editingName.value}
                    onInput={(e) => { editingName.value = e.currentTarget.value; }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitEdit();
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    autofocus
                  />
                  <div class={styles.actions}>
                    <button type="button" class={styles.linkBtn} onClick={commitEdit}>Guardar</button>
                    <button type="button" class={styles.linkBtn} onClick={cancelEdit}>Cancelar</button>
                  </div>
                </>
              ) : (
                <>
                  <span class={styles.name}>{washer.displayName}</span>
                  <div class={styles.actions}>
                    <button type="button" class={styles.linkBtn} onClick={() => startEdit(washer)}>Editar</button>
                    <button type="button" class={`${styles.linkBtn} ${styles.danger}`} onClick={() => handleDelete(washer)}>Borrar</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
