import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { CustomerRepository } from '@infra/customer-repository';
import { DuplicatePlateError } from '@infra/errors';
import { translateError } from '@ui/i18n/es';
import type { CustomerView } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './EditCustomerModal.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
  customer: CustomerView;
  onClose: () => void;
  onUpdated: (customer: CustomerView) => void;
}

export function EditCustomerModal({ runtime, workspaceId, customer, onClose, onUpdated }: Props) {
  const name = useSignal(customer.displayName);
  const plate = useSignal(customer.plate);
  const phone = useSignal(customer.phone);
  const saving = useSignal(false);
  const error = useSignal('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!name.value.trim() || !plate.value.trim()) return;
    saving.value = true;
    error.value = '';

    try {
      const repo = new CustomerRepository(runtime, workspaceId);
      await repo.update(customer.customerId, {
        displayName: name.value.trim(),
        plate: plate.value.trim().toUpperCase(),
        phone: phone.value.trim(),
      });
      
      const updated = await repo.findById(customer.customerId);
      if (updated) onUpdated(updated);
    } catch (e) {
      if (e instanceof DuplicatePlateError) {
        error.value = 'Esa placa ya pertenece a otro cliente.';
      } else {
        error.value = translateError(e);
      }
    } finally {
      saving.value = false;
    }
  };

  return (
    <div class={styles.overlay} onClick={onClose}>
      <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 class={styles.title}>Editar cliente</h2>
        
        <label class={styles.label}>
          Nombre
          <input
            ref={nameRef}
            type="text"
            class={styles.input}
            value={name.value}
            onInput={(e) => { name.value = e.currentTarget.value; }}
          />
        </label>

        <label class={styles.label}>
          Placa
          <input
            type="text"
            class={styles.input}
            value={plate.value}
            onInput={(e) => { plate.value = e.currentTarget.value; }}
          />
        </label>

        <label class={styles.label}>
          Teléfono (Opcional)
          <input
            type="tel"
            class={styles.input}
            value={phone.value}
            onInput={(e) => { phone.value = e.currentTarget.value; }}
          />
        </label>

        {error.value && <p class={styles.error}>{error.value}</p>}

        <div class={styles.actions}>
          <button type="button" class={styles.btnCancel} onClick={onClose}>Cancelar</button>
          <button
            type="button"
            class={styles.btnSave}
            onClick={handleSave}
            disabled={saving.value || !name.value.trim() || !plate.value.trim()}
          >
            {saving.value ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
