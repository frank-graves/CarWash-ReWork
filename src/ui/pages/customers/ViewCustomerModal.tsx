import type { CustomerView } from '@core/types';
import { LoyaltyStamps } from './LoyaltyStamps';
import { formatRelativeDate } from './relativeDate';
import styles from './ViewCustomerModal.module.css';

interface Props {
  customer: CustomerView;
  onClose: () => void;
  onEdit: (customer: CustomerView) => void;
}

export function ViewCustomerModal({ customer, onClose, onEdit }: Props) {
  const remaining = Math.max(0, 6 - customer.accumulatedWashes);
  const isReady = customer.accumulatedWashes === 6;
  const progressText = isReady
    ? 'Listo para reclamar el 7mo lavado gratis'
    : `Lleva ${customer.accumulatedWashes} de 6 lavados. Le faltan ${remaining} para el próximo gratis.`;

  return (
    <div class={styles.overlay} onClick={onClose}>
      <div
        class={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-customer-title"
      >
        <header class={styles.header}>
          <div>
            <h2 id="view-customer-title" class={styles.name}>
              {customer.displayName}
            </h2>
            <p class={styles.plate}>{customer.plate}</p>
          </div>
        </header>

        <div class={styles.loyaltyBlock}>
          <LoyaltyStamps accumulated={customer.accumulatedWashes} />
          <p class={isReady ? `${styles.progress} ${styles.progressReady}` : styles.progress}>
            {progressText}
          </p>
        </div>

        <dl class={styles.dataGrid}>
          <dt class={styles.dataLabel}>Teléfono</dt>
          <dd class={styles.dataValue}>
            {customer.phone && customer.phone.trim() ? customer.phone : '—'}
          </dd>

          <dt class={styles.dataLabel}>Último lavado</dt>
          <dd class={styles.dataValue}>{formatRelativeDate(customer.lastWashAt)}</dd>

          <dt class={styles.dataLabel}>ID interno</dt>
          <dd class={`${styles.dataValue} ${styles.dataMono}`}>
            {customer.customerId.slice(0, 8)}…
          </dd>
        </dl>

        <div class={styles.actions}>
          <button type="button" class={styles.btnSecondary} onClick={onClose}>
            Cerrar
          </button>
          <button type="button" class={styles.btnPrimary} onClick={() => onEdit(customer)}>
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}
