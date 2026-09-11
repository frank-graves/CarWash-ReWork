import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { CustomerRepository } from '@infra/customer-repository';
import { translateError } from '@ui/i18n/es';
import type { CustomerView } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './CustomerAutocomplete.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
  onSelect: (customer: CustomerView) => void;
  onRequestNew: (plate: string) => void;
}

export function CustomerAutocomplete({ runtime, workspaceId, onSelect, onRequestNew }: Props) {
  const query = useSignal('');
  const searching = useSignal(false);
  const notFound = useSignal(false);
  const error = useSignal('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = async () => {
    const plate = query.value.trim();
    if (!plate) return;

    searching.value = true;
    notFound.value = false;
    error.value = '';

    try {
      const repo = new CustomerRepository(runtime, workspaceId);
      const customer = await repo.findByPlate(plate);
      if (customer) {
        onSelect(customer);
        query.value = '';
      } else {
        notFound.value = true;
      }
    } catch (e) {
      error.value = translateError(e);
    } finally {
      searching.value = false;
    }
  };

  // El handler de Preact no recibe un KeyboardEvent a secas: recibe un evento ya
  // apuntado al input, y con ese tipo `currentTarget` deja de ser un EventTarget
  // genérico. Sin esto, cualquier lectura del elemento exige un cast.
  const handleKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div class={styles.container}>
      <div class={styles.searchRow}>
        <input
          ref={inputRef}
          type="text"
          class={styles.input}
          placeholder="Buscar por placa..."
          value={query.value}
          onInput={(e) => {
            query.value = e.currentTarget.value;
            notFound.value = false;
          }}
          onKeyDown={handleKeyDown}
          disabled={searching.value}
        />
        <button
          type="button"
          class={styles.btn}
          onClick={handleSearch}
          disabled={searching.value || !query.value.trim()}
        >
          {searching.value ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {error.value && <p class={styles.error}>{error.value}</p>}

      {notFound.value && (
        <div class={styles.notFound}>
          <p>No se encontró la placa "{query.value}".</p>
          <button
            type="button"
            class={styles.btnSecondary}
            onClick={() => onRequestNew(query.value)}
          >
            Registrar cliente nuevo
          </button>
        </div>
      )}
    </div>
  );
}
