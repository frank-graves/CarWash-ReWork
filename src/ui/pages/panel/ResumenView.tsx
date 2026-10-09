// src/ui/pages/panel/ResumenView.tsx
// La vista de arranque del panel: cómo va el negocio sin abrir un solo
// filtro. Los KPIs y los gráficos leen del rango global `activeRange`
// (semana por defecto). El rango se cambia desde el topbar del shell.

import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase, type FirebaseRuntime } from '@infra/firebase-bootstrap';
import { TransactionRepository } from '@infra/transaction-repository';
import { Vault } from '@infra/vault';
import type { WashTransactionView } from '@core/types';
import { calculateWage } from '@core/wages';
import { activeRange, bucketsFor, bucketIndexOf, rangeStart } from './range';
import styles from './DashboardShell.module.css';

// 50 lavados cubren la semana larga de un lavadero de barrio. Con el
// filtro "Siempre" no alcanzaría, pero esa es la deuda conocida: cuando
// importe, se sube y se paga una lectura más grande.
const RECENT_LIMIT = 50;

interface Bar {
  key: number;
  label: string;
  value: number;
  isCurrent: boolean;
}

function soles(amount: number): string {
  return amount.toFixed(2);
}

export function ResumenView() {
  const runtime = useSignal<FirebaseRuntime | null>(null);
  const workspaceId = useSignal<string | null>(null);
  const ledger = useSignal<WashTransactionView[]>([]);
  const loading = useSignal(true);
  const trouble = useSignal('');

  useSignalEffect(() => {
    const boot = async () => {
      try {
        runtime.value = await bootstrapFirebase();
        workspaceId.value = await Vault.getWorkspaceId();
      } catch {
        trouble.value = 'No se pudo abrir el resumen. Revisa la conexión.';
        loading.value = false;
      }
    };
    void boot();
  });

  useSignalEffect(() => {
    if (!runtime.value || !workspaceId.value) return;

    loading.value = true;
    const ledgerRepo = new TransactionRepository(runtime.value, workspaceId.value);
    const unsubscribe = ledgerRepo.subscribeRecent(RECENT_LIMIT, (freshRows) => {
      ledger.value = freshRows;
      loading.value = false;
    });
    return unsubscribe;
  });

  // Los tres signals dependen del rango activo: cuando el operador cambia
  // de rango, useComputed re-evalúa solo y la vista se repinta. Es la
  // forma canónica de Preact Signals: la dependencia se declara sola.
  const window7 = useComputed(() => {
    const since = rangeStart(activeRange.value);
    let washes = 0;
    let revenue = 0;
    let free = 0;
    const plates = new Set<string>();

    for (const tx of ledger.value) {
      if (tx.createdAt.getTime() < since) continue;
      washes += 1;
      plates.add(tx.customerPlate);
      if (tx.wasFree) free += 1;
      else revenue += tx.cost;
    }

    return { washes, revenue, free, customers: plates.size };
  });

  const wages = useComputed(() =>
    ledger.value
      .filter((tx) => tx.createdAt.getTime() >= rangeStart(activeRange.value))
      .reduce((sum, tx) => sum + calculateWage(tx.vehicleKind, tx.serviceTier), 0),
  );

  const revenueBars = useComputed<Bar[]>(() => {
    const now = Date.now();
    const buckets = bucketsFor(activeRange.value, now);
    const bars: Bar[] = buckets.map((b) => ({
      key: b.start,
      label: b.label,
      value: 0,
      isCurrent: false,
    }));
    // El bucket actual es el último (buckets generados hasta `now`).
    const current = bars[bars.length - 1];
    if (current) current.isCurrent = true;

    for (const tx of ledger.value) {
      if (tx.wasFree) continue;
      const idx = bucketIndexOf(buckets, tx.createdAt.getTime());
      const bar = bars[idx];
      if (bar) bar.value += tx.cost;
    }
    return bars;
  });

  const weekdayBars = useComputed<Bar[]>(() => {
    const buckets = bucketsFor(activeRange.value, Date.now());
    const bars: Bar[] = buckets.map((b) => ({
      key: b.start,
      label: b.label,
      value: 0,
      isCurrent: false,
    }));
    const current = bars[bars.length - 1];
    if (current) current.isCurrent = true;

    for (const tx of ledger.value) {
      const idx = bucketIndexOf(buckets, tx.createdAt.getTime());
      const bar = bars[idx];
      if (bar) bar.value += 1;
    }
    return bars;
  });

  const revenuePeak = useComputed(() => peakKeyOf(revenueBars.value));
  const weekdayPeak = useComputed(() => peakKeyOf(weekdayBars.value));
  const revenueTotal = useComputed(() =>
    revenueBars.value.reduce((sum, bar) => sum + bar.value, 0),
  );

  const notice = useComputed(() => {
    if (trouble.value) return trouble.value;
    if (loading.value) return 'Cargando…';
    if (window7.value.washes === 0) return 'Sin lavados en este rango.';
    return '';
  });

  return (
    <div class={`${styles.panel} ${styles.rowsKpi}`}>
      <section class={styles.kpis} aria-label="Indicadores del rango activo">
        <div class={`${styles.kpi} ${styles.kpiSuccess}`}>
          <span class={styles.kpiLabel}>Lavados</span>
          <span class={styles.kpiValue}>{window7.value.washes}</span>
          <span class={styles.kpiFoot}>en el rango</span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiAccent}`}>
          <span class={styles.kpiLabel}>Ingreso</span>
          <span class={styles.kpiValue}>S/ {soles(window7.value.revenue)}</span>
          <span class={styles.kpiFoot}>
            {window7.value.free > 0
              ? `${window7.value.free} de cortesía`
              : 'todos pagados'}
          </span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiInfo}`}>
          <span class={styles.kpiLabel}>Clientes</span>
          <span class={styles.kpiValue}>{window7.value.customers}</span>
          <span class={styles.kpiFoot}>placas distintas</span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiAmber}`}>
          <span class={styles.kpiLabel}>Nómina est.</span>
          <span class={styles.kpiValue}>S/ {soles(wages.value)}</span>
          <span class={styles.kpiFoot}>sobre {window7.value.washes} lavados</span>
        </div>
      </section>

      <div class={`${styles.subgrid} ${styles.cols2}`}>
        <section class={styles.card}>
          <header class={styles.cardHead}>
            <h2 class={styles.cardTitle}>Ingresos</h2>
            <span class={styles.cardHint}>S/ {soles(revenueTotal.value)}</span>
          </header>
          <div class={styles.cardBody}>
            {notice.value ? (
              <div class={styles.empty}>{notice.value}</div>
            ) : (
              <Bars bars={revenueBars.value} peakKey={revenuePeak.value} unit="Ingresos" />
            )}
          </div>
        </section>

        <section class={styles.card}>
          <header class={styles.cardHead}>
            <h2 class={styles.cardTitle}>Lavados</h2>
            <span class={styles.cardHint}>por bucket</span>
          </header>
          <div class={styles.cardBody}>
            {notice.value ? (
              <div class={styles.empty}>{notice.value}</div>
            ) : (
              <Bars
                bars={weekdayBars.value}
                peakKey={weekdayPeak.value}
                fill={styles.vbarFillInfo}
                unit="Lavados"
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────

function peakKeyOf(bars: readonly Bar[]): number | null {
  let peak: Bar | null = null;
  for (const bar of bars) {
    if (bar.value > 0 && (peak === null || bar.value > peak.value)) peak = bar;
  }
  return peak?.key ?? null;
}

function Bars({ bars, peakKey, fill, unit }: {
  bars: readonly Bar[];
  peakKey: number | null;
  fill?: string | undefined;
  unit: string;
}) {
  const ceiling = Math.max(...bars.map((bar) => bar.value), 0);

  return (
    <div class={styles.vbars} role="img" aria-label={`${unit} del rango activo`}>
      {bars.map((bar) => {
        const percent = ceiling > 0 ? Math.round((bar.value / ceiling) * 100) : 0;
        const peak = bar.key === peakKey && bar.value > 0;
        const classes = [styles.vbar, peak ? styles.vbarPeak : ''].filter(Boolean).join(' ');

        return (
          <div key={bar.key} class={classes} title={bar.isCurrent ? 'actual' : undefined}>
            <span class={styles.vbarNum}>{Math.round(bar.value)}</span>
            <div class={styles.vbarTrack}>
              <span
                class={fill ? `${styles.vbarFill} ${fill}` : styles.vbarFill}
                style={{ height: `${percent}%` }}
              />
            </div>
            <span class={styles.vbarLabel}>{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}
