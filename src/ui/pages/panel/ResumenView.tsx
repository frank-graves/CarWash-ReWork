// src/ui/pages/panel/ResumenView.tsx
// La vista de arranque del panel: cómo va el día sin abrir un solo filtro.
//
// Recibe runtime y workspaceId del shell en vez de bootstrapear Firebase por su
// cuenta: el shell ya los tiene y ya validó el rol. Dos llamadas a
// bootstrapFirebase en la misma pantalla serían dos awaits y un listener de
// auth de más para ver el mismo objeto.

import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { CustomerRepository } from '@infra/customer-repository';
import { TransactionRepository } from '@infra/transaction-repository';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import type { CustomerView, WashTransactionView } from '@core/types';
import { SERVICE_LABELS, VEHICLE_LABELS } from '../wash/vehicleLabels';
import styles from './DashboardShell.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;
const RECENT_ROWS = 8;
// El premio es el séptimo sello: seis lavados pagados y el de cortesía.
const STAMP_SLOTS = [0, 1, 2, 3, 4, 5, 6] as const;
const READY_MARK = 6;

function startOfDay(date: Date): Date {
  const mark = new Date(date);
  mark.setHours(0, 0, 0, 0);
  return mark;
}

function clockOf(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function soles(amount: number): string {
  return amount.toFixed(2);
}

export function ResumenView({ runtime, workspaceId }: Props) {
  const ledger = useSignal<WashTransactionView[]>([]);
  const roster = useSignal<CustomerView[]>([]);
  const loading = useSignal(true);

  useSignalEffect(() => {
    const transactions = new TransactionRepository(runtime, workspaceId);
    const customers = new CustomerRepository(runtime, workspaceId);

    // 200 es el techo honesto: una semana de un lavadero de barrio cabe de sobra
    // y el gráfico solo mira siete días. El rail filtra por fecha en cliente.
    const offLedger = transactions.subscribeRecent(200, (rows) => {
      ledger.value = rows;
      loading.value = false;
    });
    const offRoster = customers.subscribeAll((rows) => {
      roster.value = rows;
    });

    return () => {
      offLedger();
      offRoster();
    };
  });

  const today = useComputed(() => {
    const since = startOfDay(new Date()).getTime();
    let revenue = 0;
    let washes = 0;
    let free = 0;

    for (const tx of ledger.value) {
      if (tx.createdAt.getTime() < since) continue;
      washes += 1;
      if (tx.wasFree) free += 1;
      else revenue += tx.cost;
    }

    const paid = washes - free;
    return {
      revenue,
      washes,
      free,
      // Ticket promedio sobre lo que entró a caja: incluir el de cortesía
      // hundiría el número y no significa nada para el negocio.
      avgTicket: paid > 0 ? revenue / paid : 0,
      ready: roster.value.filter((customer) => customer.accumulatedWashes === READY_MARK).length,
    };
  });

  const week = useComputed(() => {
    const buckets: { label: string; key: number; total: number }[] = [];
    const now = Date.now();

    for (let back = 6; back >= 0; back -= 1) {
      const day = startOfDay(new Date(now - back * DAY_MS));
      // El `??` es para el compilador, no para el navegador: getDay() siempre
      // devuelve 0..6, pero una tupla indexada por number es `| undefined`.
      buckets.push({
        label: WEEKDAYS[day.getDay()] ?? '·',
        key: day.getTime(),
        total: 0,
      });
    }

    for (const tx of ledger.value) {
      if (tx.wasFree) continue;
      const key = startOfDay(tx.createdAt).getTime();
      const bucket = buckets.find((candidate) => candidate.key === key);
      if (bucket) bucket.total += tx.cost;
    }

    const max = Math.max(...buckets.map((bucket) => bucket.total), 1);
    const width = 100;
    const height = 40;
    const pad = 5;
    const points = buckets.map((bucket, index) => ({
      x: (index / (buckets.length - 1)) * width,
      y: pad + (1 - bucket.total / max) * (height - pad * 2),
    }));

    const line = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');

    return {
      buckets,
      points,
      line,
      area: `${line} L${width},${height} L0,${height} Z`,
      total: buckets.reduce((sum, bucket) => sum + bucket.total, 0),
    };
  });

  const readyCustomers = useComputed(() =>
    roster.value
      .filter((customer) => customer.accumulatedWashes === READY_MARK)
      .sort((a, b) => (b.lastWashAt?.getTime() ?? 0) - (a.lastWashAt?.getTime() ?? 0))
      .slice(0, 5),
  );

  const weekWashers = useComputed(() => {
    const cutoff = Date.now() - 7 * DAY_MS;
    const tally = new Map<string, number>();

    for (const tx of ledger.value) {
      if (tx.createdAt.getTime() < cutoff) continue;
      tally.set(tx.washerName, (tally.get(tx.washerName) ?? 0) + 1);
    }

    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  });

  const recent = useComputed(() => ledger.value.slice(0, RECENT_ROWS));

  return (
    <div class={styles.shell}>
      <div class={styles.mainCol}>
        <section class={styles.kpis} aria-label="Indicadores del día">
          <div class={`${styles.kpi} ${styles.kpiAccent}`}>
            <span class={styles.kpiLabel}>Facturación hoy</span>
            <span class={styles.kpiValue}>
              S/ {soles(today.value.revenue)}
            </span>
            <span class={styles.kpiFoot}>
              {today.value.free > 0
                ? `${today.value.free} de cortesía`
                : 'todos pagados'}
            </span>
          </div>

          <div class={styles.kpi}>
            <span class={styles.kpiLabel}>Lavados hoy</span>
            <span class={styles.kpiValue}>{today.value.washes}</span>
            <span class={styles.kpiFoot}>
              {today.value.washes === 1 ? 'un vehículo' : 'vehículos'}
            </span>
          </div>

          <div class={styles.kpi}>
            <span class={styles.kpiLabel}>Ticket promedio</span>
            <span class={styles.kpiValue}>
              S/ {soles(today.value.avgTicket)}
            </span>
            <span class={styles.kpiFoot}>sobre lavados pagados</span>
          </div>

          <div class={today.value.ready > 0 ? `${styles.kpi} ${styles.kpiAmber}` : styles.kpi}>
            <span class={styles.kpiLabel}>Listos para el 7mo</span>
            <span class={styles.kpiValue}>{today.value.ready}</span>
            <span class={styles.kpiFoot}>clientes con 6 sellos</span>
          </div>
        </section>

        <section class={styles.card}>
          <header class={styles.cardHead}>
            <h2 class={styles.cardTitle}>Ingresos · últimos 7 días</h2>
            <span class={styles.cardHint}>S/ {soles(week.value.total)} acumulado</span>
          </header>

          <div class={styles.chartWrap}>
            <svg
              class={styles.chartSvg}
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              role="img"
              aria-label="Ingresos de los últimos siete días"
            >
              <defs>
                <linearGradient id="ecwPanelGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="rgb(var(--color-accent-rgb) / 0.30)" />
                  <stop offset="100%" stop-color="rgb(var(--color-accent-rgb) / 0)" />
                </linearGradient>
              </defs>
              <line class={styles.chartGrid} x1="0" y1="20" x2="100" y2="20" />
              <path class={styles.chartArea} fill="url(#ecwPanelGradient)" d={week.value.area} />
              <path class={styles.chartLine} d={week.value.line} vector-effect="non-scaling-stroke" />
              {week.value.points.map((point, index) => (
                <circle
                  key={index}
                  class={styles.chartDot}
                  cx={point.x}
                  cy={point.y}
                  r="1.6"
                  style={{ animationDelay: `${index * 70}ms` }}
                />
              ))}
            </svg>

            <div class={styles.chartAxis}>
              {week.value.buckets.map((bucket, index) => (
                <span
                  key={bucket.key}
                  class={index === week.value.buckets.length - 1 ? styles.axisActive : undefined}
                >
                  {bucket.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section class={styles.table} aria-label="Últimos lavados">
          <div class={`${styles.row} ${styles.headRow}`}>
            <span>Hora</span>
            <span>Cliente</span>
            <span>Placa</span>
            <span>Servicio</span>
            <span class={styles.headNum}>Costo</span>
          </div>

          {loading.value ? (
            <div class={styles.empty}>Cargando el día…</div>
          ) : recent.value.length === 0 ? (
            <div class={styles.empty}>Sin lavados todavía. La tablet está limpia.</div>
          ) : (
            recent.value.map((tx) => (
              <div key={tx.transactionId} class={styles.row}>
                <span class={styles.cellDate}>{clockOf(tx.createdAt)}</span>
                <span class={styles.cellName}>{tx.customerName}</span>
                <span class={styles.cellPlate}>{tx.customerPlate}</span>
                <span class={styles.cellService}>
                  {VEHICLE_LABELS[tx.vehicleKind]} · {SERVICE_LABELS[tx.serviceTier]}
                </span>
                <span class={tx.wasFree ? `${styles.cellMoney} ${styles.freeCell}` : styles.cellMoney}>
                  S/ {soles(tx.cost)}
                  {tx.wasFree && <span class={styles.freeMark}>✱</span>}
                </span>
              </div>
            ))
          )}
        </section>
      </div>

      <aside class={styles.rail}>
        <section class={styles.railCard}>
          <h3 class={styles.railTitle}>Listos para el 7mo</h3>
          <ul class={styles.railList}>
            {readyCustomers.value.length === 0 ? (
              <li class={styles.railEmpty}>Nadie con 6 sellos todavía.</li>
            ) : (
              readyCustomers.value.map((customer) => (
                <li key={customer.customerId} class={styles.railItem}>
                  <span class={styles.name}>{customer.displayName}</span>
                  {/* Seis llenos y el séptimo en ámbar: el premio ya está ganado,
                      solo falta que vuelva a cobrarlo. */}
                  <span class={styles.stamps} aria-hidden="true">
                    {STAMP_SLOTS.map((slot) => {
                      const filled = slot < customer.accumulatedWashes;
                      const isPrize = slot === READY_MARK;
                      const classes = [
                        styles.stamp,
                        isPrize ? styles.stampFree : '',
                        filled ? styles.stampFilled : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return <span key={slot} class={classes} />;
                    })}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section class={styles.railCard}>
          <h3 class={styles.railTitle}>Lavadores · 7 días</h3>
          <ul class={styles.railList}>
            {weekWashers.value.length === 0 ? (
              <li class={styles.railEmpty}>Sin actividad esta semana.</li>
            ) : (
              weekWashers.value.map(([washer, count]) => (
                <li key={washer} class={styles.railItem}>
                  <span class={styles.name}>{washer}</span>
                  <span class={styles.meta}>
                    {count} {count === 1 ? 'lavado' : 'lavados'}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </aside>
    </div>
  );
}
