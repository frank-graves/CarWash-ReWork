import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase, type FirebaseRuntime } from '@infra/firebase-bootstrap';
import { TransactionRepository } from '@infra/transaction-repository';
import { Vault } from '@infra/vault';
import type { PaymentMethod, WashTransactionView } from '@core/types';
import { SERVICE_LABELS, VEHICLE_LABELS } from '../wash/vehicleLabels';
import { ExportButton } from './ExportButton';
import styles from './HistoryPage.module.css';

type DateRange = 'today' | 'week' | 'month' | 'all';
type PaymentFilter = PaymentMethod | 'all';

const DATE_CHIPS: readonly { id: DateRange; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'all', label: 'Todo' },
];

function normalizeNeedle(raw: string): string {
  return raw.trim().toLowerCase();
}

function isPaymentFilter(raw: string): raw is PaymentFilter {
  return raw === 'all' || raw === 'yape' || raw === 'efectivo';
}

function startOfToday(): Date {
  const mark = new Date();
  mark.setHours(0, 0, 0, 0);
  return mark;
}

function daysAgo(days: number): Date {
  const mark = new Date();
  mark.setDate(mark.getDate() - days);
  return mark;
}

function monthsAgo(months: number): Date {
  const mark = new Date();
  mark.setMonth(mark.getMonth() - months);
  return mark;
}

function insideRange(date: Date, range: DateRange): boolean {
  if (range === 'all') return true;
  if (range === 'today') return date >= startOfToday();
  if (range === 'week') return date >= daysAgo(7);
  return date >= monthsAgo(1);
}

function formatShortDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

export function HistoryPage() {
  const runtime = useSignal<FirebaseRuntime | null>(null);
  const workspaceId = useSignal<string | null>(null);
  const transactions = useSignal<WashTransactionView[]>([]);
  const loading = useSignal(true);
  const trouble = useSignal('');

  const dateRange = useSignal<DateRange>('all');
  const customerFilter = useSignal('');
  const washerFilter = useSignal('all');
  const paymentFilter = useSignal<PaymentFilter>('all');
  const repaintKey = useSignal(0);

  useSignalEffect(() => {
    const boot = async () => {
      try {
        runtime.value = await bootstrapFirebase();
        workspaceId.value = await Vault.getWorkspaceId();
      } catch {
        trouble.value = 'No se pudo abrir el historial. Revisa la conexión.';
        loading.value = false;
      }
    };

    void boot();
  });

  useSignalEffect(() => {
    if (!runtime.value || !workspaceId.value) return;

    loading.value = true;
    const ledger = new TransactionRepository(runtime.value, workspaceId.value);
    const unsubscribe = ledger.subscribeRecent(200, (freshRows) => {
      transactions.value = freshRows;
      loading.value = false;
    });

    // La suscripción vive solo mientras la pestaña existe; dejarla colgada duplica
    // lecturas de Firestore en tablets donde el operador cambia de tab por hábito.
    return unsubscribe;
  });

  const washerNames = useComputed(() => {
    const seen = new Set<string>();
    for (const tx of transactions.value) {
      if (tx.washerName.trim()) seen.add(tx.washerName);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  });

  const filteredTransactions = useComputed(() => {
    const plateNeedle = normalizeNeedle(customerFilter.value);
    const wantedWasher = washerFilter.value;
    const wantedPayment = paymentFilter.value;
    const wantedRange = dateRange.value;

    return transactions.value.filter((tx) => {
      if (!insideRange(tx.createdAt, wantedRange)) return false;

      if (plateNeedle && !normalizeNeedle(tx.customerPlate).includes(plateNeedle)) {
        return false;
      }

      if (wantedWasher !== 'all' && tx.washerName !== wantedWasher) {
        return false;
      }

      if (wantedPayment !== 'all' && tx.paidWith !== wantedPayment) {
        return false;
      }

      return true;
    });
  });

  const touchFilters = () => {
    repaintKey.value += 1;
  };

  const selectRange = (range: DateRange) => {
    dateRange.value = range;
    touchFilters();
  };

  const selectWasher = (raw: string) => {
    washerFilter.value = raw;
    touchFilters();
  };

  const selectPayment = (raw: string) => {
    if (!isPaymentFilter(raw)) return;
    paymentFilter.value = raw;
    touchFilters();
  };

  const writePlateNeedle = (raw: string) => {
    customerFilter.value = raw;
    touchFilters();
  };

  return (
    <div class={styles.container}>
      <header class={styles.header}>
        <div class={styles.filterDeck} aria-label="Filtros de historial">
          <div class={styles.chipRail} aria-label="Rango de fechas">
            {DATE_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                class={dateRange.value === chip.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                onClick={() => selectRange(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <label class={styles.field}>
            <span class={styles.fieldLabel}>Cliente</span>
            <input
              type="text"
              class={styles.input}
              placeholder="Placa..."
              value={customerFilter.value}
              onInput={(event) => writePlateNeedle(event.currentTarget.value)}
            />
          </label>

          <label class={styles.field}>
            <span class={styles.fieldLabel}>Lavador</span>
            <select
              class={styles.select}
              value={washerFilter.value}
              onChange={(event) => selectWasher(event.currentTarget.value)}
            >
              <option value="all">Todos</option>
              {washerNames.value.map((washerName) => (
                <option key={washerName} value={washerName}>
                  {washerName}
                </option>
              ))}
            </select>
          </label>

          <label class={styles.field}>
            <span class={styles.fieldLabel}>Pago</span>
            <select
              class={styles.select}
              value={paymentFilter.value}
              onChange={(event) => selectPayment(event.currentTarget.value)}
            >
              <option value="all">Todos</option>
              <option value="yape">Yape</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </label>
        </div>

        <ExportButton transactions={filteredTransactions.value} />
      </header>

      {trouble.value && <p class={styles.trouble}>{trouble.value}</p>}

      <div key={repaintKey.value} class={styles.tableStage}>
        {loading.value ? (
          <div class={styles.empty}>Cargando lavados recientes…</div>
        ) : filteredTransactions.value.length === 0 ? (
          <div class={styles.empty}>
            {transactions.value.length === 0
              ? 'Sin lavados. La tablet está limpia.'
              : 'Ningún lavado coincide. Prueba con menos filtros.'}
          </div>
        ) : (
          <div class={styles.table} role="table" aria-label="Historial de lavados">
            {filteredTransactions.value.map((tx) => (
              <div key={tx.transactionId} class={styles.row} role="row">
                <time class={styles.date} dateTime={tx.createdAt.toISOString()}>
                  {formatShortDate(tx.createdAt)}
                </time>

                <span class={styles.customerName}>{tx.customerName}</span>
                <span class={styles.plate}>{tx.customerPlate}</span>

                <span class={styles.service}>
                  {VEHICLE_LABELS[tx.vehicleKind]} <span class={styles.dot}>·</span>{' '}
                  {SERVICE_LABELS[tx.serviceTier]}
                </span>

                <span class={styles.payment}>{tx.paidWith === 'yape' ? 'Yape' : 'Efectivo'}</span>

                <span class={tx.wasFree ? `${styles.cost} ${styles.freeCost}` : styles.cost}>
                  S/ {tx.cost.toFixed(2)}
                  {tx.wasFree && <span class={styles.freeMark}>✱</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
