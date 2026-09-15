import type { CustomerView } from '@core/types';
import { LoyaltyStamps } from './LoyaltyStamps';
import { formatRelativeDate } from './relativeDate';
import styles from './CustomerCard.module.css';

interface Props {
  customer: CustomerView;
  onView: (customer: CustomerView) => void;
}

export function CustomerCard({ customer, onView }: Props) {
  // 6 lavados acumulados: el séptimo es gratis. Los sellos ya lo insinúan, pero
  // en una lista de veinte tarjetas el ojo necesita el atajo del borde ámbar.
  const isReadyForReward = customer.accumulatedWashes === 6;
  const cardClass = isReadyForReward
    ? `${styles.card} ${styles.readyForReward}`
    : styles.card;

  return (
    <div class={cardClass}>
      {isReadyForReward && (
        <span class={styles.rewardBadge}>PRÓXIMO GRATIS</span>
      )}
      <div class={styles.name}>{customer.displayName}</div>
      <div class={styles.plate}>{customer.plate}</div>
      <hr class={styles.divider} />
      <div class={styles.bottomRow}>
        <LoyaltyStamps accumulated={customer.accumulatedWashes} />
        <div class={styles.bottomRight}>
          <div class={styles.date}>{formatRelativeDate(customer.lastWashAt)}</div>
          <button
            type="button"
            class={styles.viewBtn}
            onClick={() => onView(customer)}
            aria-label={`Ver cliente ${customer.displayName}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
