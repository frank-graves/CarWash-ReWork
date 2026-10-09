// src/ui/pages/panel/PagosView.tsx
// La foto de cobranza del rango activo: cuánto entró, por qué canal y cuánto
// pesa cada uno. La única pregunta que se hace acá es "¿Yape le está comiendo
// el efectivo?", así que la barra apilada, la tabla y el gráfico de evolución
// giran alrededor de la misma proporción y el rango global (topbar del shell)
// manda. El donut que había antes se fue: la barra apilada dice lo mismo con
// menos tinta.

import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase, type FirebaseRuntime } from '@infra/firebase-bootstrap';
import { isNetworkError, isPermissionDenied } from '@infra/errors';
import { TransactionRepository } from '@infra/transaction-repository';
import { Vault } from '@infra/vault';
import type { PaymentMethod, WashTransactionView } from '@core/types';
import { activeRange, bucketIndexOf, bucketsFor, rangeStart, type Bucket } from './range';
import { offline, sessionRevoked } from './session';
import styles from './DashboardShell.module.css';

// Mismo techo que el resto del panel: la deuda conocida de "Siempre" aplica
// igual, pero para el rango por defecto (semana) sobra.
const RECENT_LIMIT = 50;

// Debajo de 12% un segmento de la barra no tiene sitio para su etiqueta; la
// proporción igual se lee en la tabla de abajo.
const LABEL_MIN_PCT = 12;

// Umbral de "datos suficientes" para atreverse a concluir algo del reparto.
const INSIGHT_MIN_WASHES = 10;

const METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
};

function soles(amount: number): string {
  return amount.toFixed(2);
}

/** Lo que aporta cada canal de cobro en el rango: plata y lavados pagados. */
interface MethodStat {
  revenue: number;
  washes: number;
}

/** Lo que entró por cada canal dentro de un bucket: la serie de la evolución. */
interface BucketSeries {
  efectivo: number;
  yape: number;
}

export function PagosView() {
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
      } catch (err) {
        // El overlay del shell tapa esta vista: acá solo se marcan los signals.
        if (isPermissionDenied(err)) {
          sessionRevoked.value = true;
        } else if (isNetworkError(err)) {
          offline.value = true;
        } else {
          trouble.value = 'No se pudo abrir el detalle de pagos. Revisá la conexión.';
        }
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

  // El reparto por canal depende del rango: useComputed re-evalúa solo cuando
  // activeRange o el ledger cambian, sin que la vista tenga que escuchar nada.
  // Los totales y la serie de buckets salen de la misma pasada: recorrer el
  // ledger dos veces para armar el gráfico sería trabajo regalado.
  const pagos = useComputed(() => {
    const since = rangeStart(activeRange.value);
    const buckets = bucketsFor(activeRange.value);
    const series: BucketSeries[] = buckets.map(() => ({ efectivo: 0, yape: 0 }));
    const efectivo: MethodStat = { revenue: 0, washes: 0 };
    const yape: MethodStat = { revenue: 0, washes: 0 };
    let total = 0;
    let paidWashes = 0;

    for (const tx of ledger.value) {
      if (tx.createdAt.getTime() < since) continue;
      // Un lavado de cortesía no pasó por caja: contarlo acá inflaría el
      // reparto con plata que nunca entró.
      if (tx.wasFree) continue;
      const stat = tx.paidWith === 'yape' ? yape : efectivo;
      stat.revenue += tx.cost;
      stat.washes += 1;
      total += tx.cost;
      paidWashes += 1;

      const slot = series[bucketIndexOf(buckets, tx.createdAt.getTime())];
      if (slot) slot[tx.paidWith] += tx.cost;
    }

    return { efectivo, yape, total, paidWashes, buckets, series };
  });

  const { efectivo, yape, total, paidWashes, buckets, series } = pagos.value;
  const cashPct = total > 0 ? Math.round((efectivo.revenue / total) * 100) : 0;
  const yapePct = total > 0 ? 100 - cashPct : 0;
  // El canal con más plata manda; el empate se dice, no se desempata a dedo.
  const cashDominant = efectivo.revenue >= yape.revenue;
  const dominantLabel = total > 0 ? (cashDominant ? 'Efectivo' : 'Yape') : '—';
  const dominantFoot = total === 0
    ? 'Sin datos'
    : efectivo.revenue === yape.revenue
      ? 'Empate en ingreso'
      : `${Math.max(cashPct, yapePct)}% del ingreso`;
  const insight = paidWashes < INSIGHT_MIN_WASHES
    ? `Aún pocos datos: ${paidWashes} de ${INSIGHT_MIN_WASHES} lavados para sacar conclusiones.`
    : `Yape pesa ${yapePct}% del ingreso y efectivo ${cashPct}%.`;

  return (
    <div class={`${styles.panel} ${styles.rowsKpi}`}>
      <section class={`${styles.kpis} ${styles.kpis3}`} aria-label="Indicadores de cobranza del rango activo">
        <div class={`${styles.kpi} ${styles.kpiAccent}`}>
          <span class={styles.kpiLabel}>Total</span>
          <span class={styles.kpiValue}>S/ {soles(total)}</span>
          <span class={styles.kpiFoot}>{paidWashes} lavados</span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiSuccess}`}>
          <span class={styles.kpiLabel}>Lavados</span>
          <span class={styles.kpiValue}>{paidWashes}</span>
          <span class={styles.kpiFoot}>cobrados en el rango</span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiInfo}`}>
          <span class={styles.kpiLabel}>Método dominante</span>
          <span class={`${styles.kpiValue} ${styles.kpiValueText}`}>{dominantLabel}</span>
          <span class={styles.kpiFoot}>{dominantFoot}</span>
        </div>
      </section>

      <section class={styles.card}>
        <header class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Reparto por método</h2>
          <span class={styles.cardHint}>según ingreso</span>
        </header>
        <div class={styles.cardBody}>
          <StackBar cashPct={cashPct} yapePct={yapePct} total={total} />

          <div class={styles.table}>
            <div class={`${styles.pagosRow} ${styles.pagosRowHead}`}>
              <span>Método</span>
              <span>Lavados</span>
              <span>Ingreso</span>
              <span>%</span>
            </div>
            {(['efectivo', 'yape'] as const).map((method) => {
              const stat = method === 'efectivo' ? efectivo : yape;
              const pct = total > 0 ? Math.round((stat.revenue / total) * 100) : 0;
              return (
                <div key={method} class={styles.pagosRow}>
                  <span class={styles.cellName}>{METHOD_LABELS[method]}</span>
                  <span class={styles.cellNum}>{stat.washes}</span>
                  <span class={styles.cellMoney}>S/ {soles(stat.revenue)}</span>
                  <span class={styles.cellNum}>{pct}%</span>
                </div>
              );
            })}
          </div>

          <p class={styles.insight}>{insight}</p>
        </div>
      </section>

      <section class={styles.card}>
        <header class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Evolución</h2>
          <span class={styles.cardHint}>yape arriba · efectivo abajo</span>
        </header>
        <div class={styles.cardBody}>
          <EvolutionChart buckets={buckets} series={series} />
        </div>
      </section>
    </div>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────

// Barra apilada del reparto. Con plata en caja los dos segmentos se pintan a
// escala; sin cobros no hay proporción que mostrar y se dice "Sin datos" en
// vez de pintar un 0% que parece un dato.
function StackBar({ cashPct, yapePct, total }: {
  cashPct: number;
  yapePct: number;
  total: number;
}) {
  if (total <= 0) {
    return (
      <div class={styles.stack}>
        <span class={styles.stackEmpty}>Sin datos</span>
      </div>
    );
  }

  return (
    <div
      class={styles.stack}
      role="img"
      aria-label={`Efectivo ${cashPct}% y Yape ${yapePct}% del ingreso del rango`}
    >
      <div class={styles.stackEf} style={{ width: `${cashPct}%` }}>
        {cashPct >= LABEL_MIN_PCT ? `Efectivo ${cashPct}%` : ''}
      </div>
      <div class={styles.stackYa} style={{ width: `${yapePct}%` }}>
        {yapePct >= LABEL_MIN_PCT ? `Yape ${yapePct}%` : ''}
      </div>
    </div>
  );
}

// Evolución del ingreso: un par de barras apiladas por bucket, Yape arriba y
// efectivo abajo. La altura se mide contra el bucket más alto (efectivo + Yape)
// para que el pico toque el borde del gráfico y el resto se lea en proporción.
function EvolutionChart({ buckets, series }: {
  buckets: Bucket[];
  series: BucketSeries[];
}) {
  const ceiling = Math.max(1, ...series.map((slice) => slice.efectivo + slice.yape));

  return (
    <>
      <div class={styles.chart} role="img" aria-label="Evolución del ingreso por período">
        {buckets.map((bucket, index) => {
          const slice = series[index];
          if (!slice) return null;
          return (
            <div
              key={bucket.start}
              class={styles.chartCol}
              title={`${bucket.label}: Efectivo S/ ${soles(slice.efectivo)} · Yape S/ ${soles(slice.yape)}`}
            >
              {slice.yape > 0 && (
                <span class={styles.chartBarYa} style={{ height: `${(slice.yape / ceiling) * 100}%` }} />
              )}
              {slice.efectivo > 0 && (
                <span class={styles.chartBarEf} style={{ height: `${(slice.efectivo / ceiling) * 100}%` }} />
              )}
            </div>
          );
        })}
      </div>
      <div class={styles.chartLabels}>
        {buckets.map((bucket) => (
          <span key={bucket.start}>{bucket.label}</span>
        ))}
      </div>
    </>
  );
}
