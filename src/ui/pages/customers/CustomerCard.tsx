import type { CustomerView } from '@core/types';
import { LoyaltyStamps } from './LoyaltyStamps';
import { formatRelativeDate } from './relativeDate';
import styles from './CustomerCard.module.css';

interface Props {
  customer: CustomerView;
  onEdit: (customer: CustomerView) => void;
}

export function CustomerCard({ customer, onEdit }: Props) {
  return (
    <div class={styles.card}>
      <div class={styles.name}>{customer.displayName}</div>
      <div class={styles.plate}>{customer.plate}</div>
      <hr class={styles.divider} />
      <div class={styles.bottomRow}>
        <LoyaltyStamps accumulated={customer.accumulatedWashes} />
        <div class={styles.date}>{formatRelativeDate(customer.lastWashAt)}</div>
      </div>
      <button 
        type="button" 
        class={styles.editBtn} 
        onClick={() => onEdit(customer)}
        aria-label="Editar cliente"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
    </div>
  );
}
