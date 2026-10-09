// src/ui/pages/panel/PagosView.tsx
// La foto de cobranza del rango activo: cuánto entró, por qué canal y cuánto
// pesa cada uno. La única pregunta que se hace acá es "¿Yape le está comiendo
// el efectivo?", así que el donut y las barras giran alrededor de la misma
// proporción y el rango global (topbar del shell) manda.

import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase, type FirebaseRuntime } from '@infra/firebase-bootstrap';
import { isNetworkError, isPermissionDenied } from '@infra/errors';
import { TransactionRepository } from '@infra/transaction-repository';
import { Vault } from '@infra/vault';
import type { PaymentMethod, WashTransactionView } from '@core/types';
import { activeRange, rangeStart } from './range';
import { offline, sessionRevoked } from './session';
import styles from './DashboardShell.module.css';

// Mismo techo que el resto del panel: la deuda conocida de "Siempre" aplica
// igual, pero para el rango por defecto (semana) sobra.
const RECENT_LIMIT = 50;

// El dasharray del donut se calcula sobre la circunferencia real del anillo:
// 2πr con el mismo radio que el <circle>. Repetirlo en cada render invita a
// que el SVG y la matemática se desincronicen.
const DONUT_RADIUS = 48;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

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
  const pagos = useComputed(() => {
    const since = rangeStart(activeRange.value);
    const efectivo: MethodStat = { revenue: 0, washes: 0 };
    const yape: MethodStat = { revenue: 0, washes: 0 };
    let total = 0;
    let paidWashes = 0;

    for (const tx of ledger.value) {
      if (tx.createdAt.getTime() < since) continue;
      // Un lavado de cortesía no pasó por caja: contarlo acá inflaría el ticket
      // promedio con plata que nunca entró.
      if (tx.wasFree) continue;
      const stat = tx.paidWith === 'yape' ? yape : efectivo;
      stat.revenue += tx.cost;
      stat.washes += 1;
      total += tx.cost;
      paidWashes += 1;
    }

    return {
      efectivo,
      yape,
      total,
      paidWashes,
      ticket: paidWashes > 0 ? total / paidWashes : 0,
      yapeShare: total > 0 ? yape.revenue / total : 0,
    };
  });

  // Ticket promedio por canal: se deriva acá y no en el useComputed porque
  // solo lo consume una card; el guard de división por cero es idéntico al
  // del total.
  const yapeCount = pagos.value.yape.washes;
  const cashCount = pagos.value.efectivo.washes;
  const yapeAvg = yapeCount > 0 ? pagos.value.yape.revenue / yapeCount : 0;
  const cashAvg = cashCount > 0 ? pagos.value.efectivo.revenue / cashCount : 0;
  const comparison = compareTickets(yapeAvg, cashAvg, yapeCount, cashCount);

  return (
    <div class={`${styles.panel} ${styles.rowsKpi}`}>
      <section class={styles.kpis} aria-label="Indicadores de cobranza del rango activo">
        <div class={`${styles.kpi} ${styles.kpiAccent}`}>
          <span class={styles.kpiLabel}>Total</span>
          <span class={styles.kpiValue}>S/ {soles(pagos.value.total)}</span>
          <span class={styles.kpiFoot}>{pagos.value.paidWashes} lavados</span>
        </div>

        <div class={styles.kpi}>
          <span class={styles.kpiLabel}>Efectivo</span>
          <span class={styles.kpiValue}>S/ {soles(pagos.value.efectivo.revenue)}</span>
          <span class={styles.kpiFoot}>{pagos.value.efectivo.washes} lavados</span>
        </div>

        <div class={styles.kpi}>
          <span class={styles.kpiLabel}>Yape</span>
          <span class={styles.kpiValue}>S/ {soles(pagos.value.yape.revenue)}</span>
          <span class={styles.kpiFoot}>{pagos.value.yape.washes} lavados</span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiInfo}`}>
          <span class={styles.kpiLabel}>Ticket prom.</span>
          <span class={styles.kpiValue}>S/ {soles(pagos.value.ticket)}</span>
          <span class={styles.kpiFoot}>por lavado</span>
        </div>
      </section>

      <section class={styles.card}>
        <header class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Métodos de pago</h2>
          <span class={styles.cardHint}>del rango</span>
        </header>
        <div class={styles.cardBody}>
          <div class={`${styles.subgrid} ${styles.cols2}`}>
            <div class={styles.table}>
              <div class={`${styles.pagosRow} ${styles.pagosRowHead}`}>
                <span>Método</span>
                <span>Lavados</span>
                <span>Ingreso</span>
                <span>%</span>
              </div>
              {(['efectivo', 'yape'] as const).map((method) => {
                const stat = pagos.value[method];
                const pct = pagos.value.total > 0
                  ? Math.round((stat.revenue / pagos.value.total) * 100)
                  : 0;
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

            <Donut share={pagos.value.yapeShare} hasData={pagos.value.total > 0} />
          </div>
        </div>
      </section>

      <section class={styles.card}>
        <header class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Ticket promedio por método</h2>
          <span class={styles.cardHint}>S/ por lavado</span>
        </header>
        <div class={styles.ticketGrid}>
          <div class={`${styles.ticketCell} ${styles.ticketCellAccent}`}>
            <span class={styles.ticketLabel}>Yape</span>
            <span class={styles.ticketValue}>S/ {yapeAvg.toFixed(2)}</span>
            <span class={styles.ticketFoot}>{yapeCount} lavados</span>
          </div>
          <div class={`${styles.ticketCell} ${styles.ticketCellMuted}`}>
            <span class={styles.ticketLabel}>Efectivo</span>
            <span class={styles.ticketValue}>S/ {cashAvg.toFixed(2)}</span>
            <span class={styles.ticketFoot}>{cashCount} lavados</span>
          </div>
        </div>
        <p class={styles.ticketNote}>{comparison}</p>
      </section>
    </div>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────

// La comparación solo tiene sentido con los dos canales poblados: con uno
// vacío, "Yape cobra más" mediría contra la nada. El umbral de 50 céntimos
// separa una diferencia real de ruido de redondeo.
function compareTickets(
  yapeAvg: number,
  cashAvg: number,
  yapeCount: number,
  cashCount: number,
): string {
  if (yapeCount === 0 || cashCount === 0) {
    const missing = yapeCount === 0 ? 'Yape' : 'Efectivo';
    return `Sin datos de ${missing} en este rango`;
  }
  const diff = yapeAvg - cashAvg;
  if (diff > 0.5) return `Yape cobra S/ ${diff.toFixed(2)} más por lavado`;
  if (diff < -0.5) return `Yape cobra S/ ${Math.abs(diff).toFixed(2)} menos por lavado`;
  return 'Tickets parecidos entre métodos';
}

// Donut de dos <circle>: el de abajo es el aro completo (el "resto") y el de
// arriba se recorta con dasharray a la porción de Yape. Rotado -90° para que
// el corte arranque a las 12 en punto, como cualquier reloj.
function Donut({ share, hasData }: { share: number; hasData: boolean }) {
  const pct = Math.round(share * 100);
  const dash = share * DONUT_CIRCUMFERENCE;

  return (
    <div class={styles.donutWrap}>
      <svg
        class={styles.donutSvg}
        viewBox="0 0 120 120"
        width="120"
        height="120"
        role="img"
        aria-label={hasData ? `Yape: ${pct}% del ingreso del rango` : 'Sin cobros en el rango'}
      >
        <circle
          cx="60"
          cy="60"
          r={DONUT_RADIUS}
          fill="none"
          stroke="var(--color-border)"
          stroke-width="12"
        />
        {hasData && share > 0 && (
          <circle
            cx="60"
            cy="60"
            r={DONUT_RADIUS}
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="12"
            stroke-dasharray={`${dash} ${DONUT_CIRCUMFERENCE}`}
            stroke-dashoffset="0"
            transform="rotate(-90 60 60)"
          />
        )}
      </svg>

      <div class={styles.donutCenter}>
        <strong>{hasData ? `${pct}%` : '—'}</strong>
        <span>Yape</span>
      </div>
    </div>
  );
}
