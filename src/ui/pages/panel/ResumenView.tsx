// src/ui/pages/panel/ResumenView.tsx
// La vista de arranque del panel: cómo va el negocio sin abrir un solo filtro.
//
// Se bootstrapea Firebase sola (es un singleton ya resuelto por `mountApp`, así
// que cuesta un microtask) porque no necesita nada que el shell no tenga ya en
// Firestore. Lo que NO hace es suscribirse a clientes: los KPIs de clientes
// salen de las placas que aparecen en el ledger de la semana, y esa lista ya
// viene en el mismo snapshot. Una segunda suscripción para contar cuatro
// clientes sería una lectura por cada cambio de cualquier otro.

import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase, type FirebaseRuntime } from '@infra/firebase-bootstrap';
import { TransactionRepository } from '@infra/transaction-repository';
import { Vault } from '@infra/vault';
import type { WashTransactionView } from '@core/types';
import { calculateWage } from '@core/wages';
import styles from './DashboardShell.module.css';

// El filtro de rango es fase 3; hoy la vista lee siempre los últimos 7 días.
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;

// 50 lavados cubren la semana entera de un lavadero de barrio. El gráfico solo
// mira siete días: pedir 200 era traer un mes de cifrado para tirar el 85%.
const RECENT_LIMIT = 50;

interface Bar {
  /** Clave estable para el render: día (timestamp) o índice de día de semana. */
  key: number;
  label: string;
  value: number;
  isToday: boolean;
}

function startOfDay(date: Date): Date {
  const mark = new Date(date);
  mark.setHours(0, 0, 0, 0);
  return mark;
}

function soles(amount: number): string {
  return amount.toFixed(2);
}

/**
 * El borde de la ventana de siete días, en milisegundos. Lo comparten los KPIs
 * y los gráficos: si cada uno lo recalculara por su cuenta, un `Date.now()`
 * distinto a cada lado del cambio de día bastaría para que la nómina no cuadre
 * con el conteo de lavados que el mismo panel muestra.
 */
function windowStart(now: number): number {
  return startOfDay(new Date(now - (WINDOW_DAYS - 1) * DAY_MS)).getTime();
}

/**
 * Los siete días de la ventana, del más viejo a hoy. Debajo de la fecha va el
 * total del día; el pico se marca en el label, que es lo único que se lee de
 * reojo desde la puerta del local.
 */
function revenueBars(rows: readonly WashTransactionView[], now: number): Bar[] {
  const today = startOfDay(new Date(now)).getTime();
  const bars: Bar[] = [];

  for (let back = WINDOW_DAYS - 1; back >= 0; back -= 1) {
    const day = startOfDay(new Date(now - back * DAY_MS));
    // El `??` es para el compilador, no para el navegador: getDay() siempre
    // devuelve 0..6, pero una tupla indexada por number es `| undefined`.
    bars.push({
      key: day.getTime(),
      label: WEEKDAYS[day.getDay()] ?? '·',
      value: 0,
      isToday: day.getTime() === today,
    });
  }

  const index = new Map(bars.map((bar) => [bar.key, bar]));
  for (const tx of rows) {
    if (tx.wasFree) continue;
    const bucket = index.get(startOfDay(tx.createdAt).getTime());
    if (bucket) bucket.value += tx.cost;
  }

  return bars;
}

/** Domingo → sábado sobre la misma ventana: así se ve qué días trabaja la gente. */
function weekdayBars(rows: readonly WashTransactionView[], now: number): Bar[] {
  const cutoff = startOfDay(new Date(now - (WINDOW_DAYS - 1) * DAY_MS)).getTime();
  const todayWeekday = new Date(now).getDay();
  const bars: Bar[] = WEEKDAYS.map((label, weekday) => ({
    key: weekday,
    label,
    value: 0,
    isToday: weekday === todayWeekday,
  }));

  for (const tx of rows) {
    if (tx.createdAt.getTime() < cutoff) continue;
    const bucket = bars[tx.createdAt.getDay()];
    if (bucket) bucket.value += 1;
  }

  return bars;
}

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
  /** Clase extra para el relleno. El `| undefined` está porque el índice del
   *  módulo CSS va con `noUncheckedIndexedAccess`: una clase que no exista es
   *  `undefined` en silencio, y más vale que el tipo lo diga. */
  fill?: string | undefined;
  unit: string;
}) {
  const ceiling = Math.max(...bars.map((bar) => bar.value), 0);

  return (
    <div class={styles.vbars} role="img" aria-label={`${unit} de los últimos siete días`}>
      {bars.map((bar) => {
        const percent = ceiling > 0 ? Math.round((bar.value / ceiling) * 100) : 0;
        const peak = bar.key === peakKey && bar.value > 0;
        const classes = [styles.vbar, peak ? styles.vbarPeak : ''].filter(Boolean).join(' ');

        return (
          <div key={bar.key} class={classes} title={bar.isToday ? 'hoy' : undefined}>
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

    // La suscripción vive solo mientras la vista está montada: cambiar de
    // pestaña en el panel no debe seguir pagando lecturas de Firestore.
    return unsubscribe;
  });

  const window7 = useComputed(() => {
    const since = windowStart(Date.now());
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

  // La nómina se calcula sobre la misma ventana que los otros KPIs, no sobre
  // `ledger` entero: media semana de lecturas cobraría lavados que el panel no
  // está mostrando. Tampoco se cachea: el `reduce` sobre 50 filas es más barato
  // que el signal que habría que invalidar para ahorrarlo.
  const wages = useComputed(() =>
    ledger.value
      .filter((tx) => tx.createdAt.getTime() >= windowStart(Date.now()))
      .reduce((sum, tx) => sum + calculateWage(tx.vehicleKind, tx.serviceTier), 0),
  );

  const revenue = useComputed(() => revenueBars(ledger.value, Date.now()));
  const weekdays = useComputed(() => weekdayBars(ledger.value, Date.now()));

  const revenuePeak = useComputed(() => peakKeyOf(revenue.value));
  const weekdayPeak = useComputed(() => peakKeyOf(weekdays.value));

  const revenueTotal = useComputed(() =>
    revenue.value.reduce((sum, bar) => sum + bar.value, 0),
  );

  // Un gráfico de ceros no dice "no hay datos", dice "no vendimos nada". Cuando
  // la semana está vacía o la conexión falló, el hueco lo ocupa una frase.
  const notice = useComputed(() => {
    if (trouble.value) return trouble.value;
    if (loading.value) return 'Cargando la semana…';
    if (window7.value.washes === 0) return 'Sin lavados en la última semana.';
    return '';
  });

  return (
    <div class={`${styles.panel} ${styles.rowsKpi}`}>
      <section class={styles.kpis} aria-label="Indicadores de los últimos siete días">
        <div class={`${styles.kpi} ${styles.kpiSuccess}`}>
          <span class={styles.kpiLabel}>Lavados</span>
          <span class={styles.kpiValue}>{window7.value.washes}</span>
          <span class={styles.kpiFoot}>últimos 7 días</span>
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

        {/* Suma el papel de tarifas sobre la misma ventana que los otros KPIs.
            El foot cuenta lavados y no un porcentaje del ingreso: un ratio se
            rompe con las cortesías (se pagan, no se cobran) y con una semana
            sin ingresos. */}
        <div class={`${styles.kpi} ${styles.kpiAmber}`}>
          <span class={styles.kpiLabel}>Nómina est.</span>
          <span class={styles.kpiValue}>S/ {soles(wages.value)}</span>
          <span class={styles.kpiFoot}>sobre {window7.value.washes} lavados</span>
          {/* ponytail: full_deluxe paga 0 hasta que el dueño defina tarifa. */}
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
              <Bars bars={revenue.value} peakKey={revenuePeak.value} unit="Ingresos" />
            )}
          </div>
        </section>

        <section class={styles.card}>
          <header class={styles.cardHead}>
            <h2 class={styles.cardTitle}>Lavados por día de semana</h2>
            <span class={styles.cardHint}>demanda</span>
          </header>
          <div class={styles.cardBody}>
            {notice.value ? (
              <div class={styles.empty}>{notice.value}</div>
            ) : (
              <Bars
                bars={weekdays.value}
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
