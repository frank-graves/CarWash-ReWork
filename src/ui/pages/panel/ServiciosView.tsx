// src/ui/pages/panel/ServiciosView.tsx
// Qué se lava y qué se vende: el cruce vehículo × servicio del rango activo,
// más los dos rankings que salen de la misma tabla. Todo se agrupa en memoria
// sobre el mismo ledger que alimenta el resumen, porque el negocio es chico y
// una lectura más chica que 50 no paga el costo de una consulta nueva.

import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase, type FirebaseRuntime } from '@infra/firebase-bootstrap';
import { isNetworkError, isPermissionDenied } from '@infra/errors';
import { TransactionRepository } from '@infra/transaction-repository';
import { Vault } from '@infra/vault';
import { availableTiersFor } from '@core/pricing';
import type { ServiceTier, VehicleKind, WashTransactionView } from '@core/types';
import { VEHICLE_LABELS, SERVICE_LABELS } from '@ui/pages/wash/vehicleLabels';
import { activeRange, rangeStart } from './range';
import { offline, sessionRevoked } from './session';
import styles from './DashboardShell.module.css';

const RECENT_LIMIT = 50;

// El orden natural del negocio: de menor a mayor servicio. Es el orden de las
// columnas de la matriz y el que un operador lee de izquierda a derecha.
const SERVICE_ORDER: readonly ServiceTier[] = [
  'basico',
  'intermedio',
  'premium',
  'deluxe',
  'full_deluxe',
  'completo',
  'full_moto',
];

const VEHICLE_ORDER: readonly VehicleKind[] = [
  'auto',
  'camioneta_cerrada',
  'pickup',
  'mototaxi',
  'moto_lineal',
];

/** La matriz se lee en lavados o en soles; el toggle solo cambia el lente. */
type HeatMode = 'Lavados' | 'Ingreso';

function soles(amount: number): string {
  return amount.toFixed(2);
}

/** Una celda de la matriz: cuántas veces salió esa combinación y por cuánto. */
interface CellStat {
  washes: number;
  revenue: number;
}

/** Una barra horizontal: etiqueta, valor con el que se mide y texto a la derecha. */
interface BarRow {
  key: string;
  label: string;
  value: number;
  text: string;
}

export function ServiciosView() {
  const runtime = useSignal<FirebaseRuntime | null>(null);
  const workspaceId = useSignal<string | null>(null);
  const ledger = useSignal<WashTransactionView[]>([]);
  const loading = useSignal(true);
  const trouble = useSignal('');
  const mode = useSignal<HeatMode>('Lavados');

  useSignalEffect(() => {
    const boot = async () => {
      try {
        runtime.value = await bootstrapFirebase();
        workspaceId.value = await Vault.getWorkspaceId();
      } catch (err) {
        // El overlay del shell cubre esta vista: acá solo se marcan los signals.
        if (isPermissionDenied(err)) {
          sessionRevoked.value = true;
        } else if (isNetworkError(err)) {
          offline.value = true;
        } else {
          trouble.value = 'No se pudo abrir servicios y vehículos. Revisá la conexión.';
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

  // Todo el cruce se arma de una sola pasada sobre el ledger. Un solo
  // useComputed para la matriz, los totales, los dos rankings y el insight:
  // separarlos obligaría a recorrer el mismo array varias veces por cambio de
  // rango, y el techo de la escala de calor también sale de esta pasada.
  const stats = useComputed(() => {
    const since = rangeStart(activeRange.value);
    const cells = new Map<string, CellStat>();
    const vehicleTotals = new Map<VehicleKind, CellStat>();
    const serviceTotals = new Map<ServiceTier, CellStat>();
    let washes = 0;
    let revenue = 0;
    let bestVehicle: VehicleKind | null = null;
    let bestService: ServiceTier | null = null;
    let bestRevenue = 0;

    for (const tx of ledger.value) {
      if (tx.createdAt.getTime() < since) continue;

      washes += 1;

      const key = `${tx.vehicleKind}|${tx.serviceTier}`;
      const cell = cells.get(key) ?? { washes: 0, revenue: 0 };
      cell.washes += 1;
      const vehicleTotal = vehicleTotals.get(tx.vehicleKind) ?? { washes: 0, revenue: 0 };
      vehicleTotal.washes += 1;
      const serviceTotal = serviceTotals.get(tx.serviceTier) ?? { washes: 0, revenue: 0 };
      serviceTotal.washes += 1;

      // El cortesía cuenta como demanda (es un lavado), pero no como ingreso.
      if (!tx.wasFree) {
        cell.revenue += tx.cost;
        vehicleTotal.revenue += tx.cost;
        serviceTotal.revenue += tx.cost;
        revenue += tx.cost;
        // La combinación que más plata deja se recuerda al vuelo: recorrer la
        // matriz otra vez solo para encontrarla sería una segunda pasada.
        if (cell.revenue > bestRevenue) {
          bestRevenue = cell.revenue;
          bestVehicle = tx.vehicleKind;
          bestService = tx.serviceTier;
        }
      }

      cells.set(key, cell);
      vehicleTotals.set(tx.vehicleKind, vehicleTotal);
      serviceTotals.set(tx.serviceTier, serviceTotal);
    }

    // El techo de la escala de calor: la celda más alta de cada lente. Con 1 de
    // piso, una matriz vacía no divide por cero.
    let maxWashes = 1;
    let maxRevenue = 1;
    for (const cell of cells.values()) {
      if (cell.washes > maxWashes) maxWashes = cell.washes;
      if (cell.revenue > maxRevenue) maxRevenue = cell.revenue;
    }

    // Los vehículos se ordenan por ingreso del rango: el más rentable arriba.
    const vehiclesByRevenue = [...VEHICLE_ORDER].sort(
      (a, b) => (vehicleTotals.get(b)?.revenue ?? 0) - (vehicleTotals.get(a)?.revenue ?? 0),
    );

    const vehicleBars: BarRow[] = vehiclesByRevenue.map((vehicle) => {
      const value = vehicleTotals.get(vehicle)?.revenue ?? 0;
      return {
        key: vehicle,
        label: VEHICLE_LABELS[vehicle],
        value,
        text: `S/ ${soles(value)}`,
      };
    });

    const serviceBars: BarRow[] = [...SERVICE_ORDER]
      .sort((a, b) => (serviceTotals.get(b)?.revenue ?? 0) - (serviceTotals.get(a)?.revenue ?? 0))
      .slice(0, 5)
      .map((tier) => {
        const value = serviceTotals.get(tier)?.revenue ?? 0;
        return {
          key: tier,
          label: SERVICE_LABELS[tier],
          value,
          text: `S/ ${soles(value)}`,
        };
      });

    // El insight nombra el cruce que concentra la plata, no el servicio ni el
    // vehículo sueltos: eso es lo que la matriz existe para responder.
    const insight = bestVehicle && bestService && revenue > 0
      ? `${VEHICLE_LABELS[bestVehicle]} + ${SERVICE_LABELS[bestService]} concentra ${Math.round((bestRevenue / revenue) * 100)}% del ingreso.`
      : 'Sin ventas en este rango.';

    return {
      cells,
      washes,
      revenue,
      vehiclesByRevenue,
      vehicleTotals,
      serviceTotals,
      maxWashes,
      maxRevenue,
      vehicleBars,
      serviceBars,
      insight,
      topService: topBy(serviceTotals, SERVICE_ORDER),
      topVehicle: topBy(vehicleTotals, VEHICLE_ORDER),
    };
  });

  const topServiceLabel = stats.value.topService
    ? SERVICE_LABELS[stats.value.topService.key]
    : '—';
  const topVehicleLabel = stats.value.topVehicle
    ? VEHICLE_LABELS[stats.value.topVehicle.key]
    : '—';

  return (
    <div class={`${styles.panel} ${styles.rowsKpi}`}>
      <section class={styles.kpis} aria-label="Indicadores de servicios del rango activo">
        <div class={`${styles.kpi} ${styles.kpiSuccess}`}>
          <span class={styles.kpiLabel}>Lavados</span>
          <span class={styles.kpiValue}>{stats.value.washes}</span>
          <span class={styles.kpiFoot}>en el rango</span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiAccent}`}>
          <span class={styles.kpiLabel}>Ingreso</span>
          <span class={styles.kpiValue}>S/ {soles(stats.value.revenue)}</span>
          <span class={styles.kpiFoot}>del rango</span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiInfo}`}>
          <span class={styles.kpiLabel}>Servicio top</span>
          <span class={`${styles.kpiValue} ${styles.kpiValueText}`}>{topServiceLabel}</span>
          <span class={styles.kpiFoot}>
            {stats.value.topService ? `${stats.value.topService.washes} lavados` : 'sin datos'}
          </span>
        </div>

        <div class={`${styles.kpi} ${styles.kpiAmber}`}>
          <span class={styles.kpiLabel}>Vehículo top</span>
          <span class={`${styles.kpiValue} ${styles.kpiValueText}`}>{topVehicleLabel}</span>
          <span class={styles.kpiFoot}>
            {stats.value.topVehicle ? `${stats.value.topVehicle.washes} lavados` : 'sin datos'}
          </span>
        </div>
      </section>

      <section class={styles.card}>
        <header class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Demanda cruzada</h2>
          <div class={styles.seg} role="group" aria-label="Métrica de la matriz">
            {(['Lavados', 'Ingreso'] as const).map((option) => (
              <button
                key={option}
                type="button"
                class={mode.value === option ? styles.segOn : undefined}
                onClick={() => {
                  mode.value = option;
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </header>
        <div class={styles.cardBody}>
          <HeatMatrix
            vehicles={stats.value.vehiclesByRevenue}
            cells={stats.value.cells}
            vehicleTotals={stats.value.vehicleTotals}
            serviceTotals={stats.value.serviceTotals}
            maxWashes={stats.value.maxWashes}
            maxRevenue={stats.value.maxRevenue}
            totalWashes={stats.value.washes}
            totalRevenue={stats.value.revenue}
            mode={mode.value}
          />
          <p class={styles.insight}>{stats.value.insight}</p>
        </div>
      </section>

      <div class={`${styles.subgrid} ${styles.cols2}`}>
        <section class={styles.card}>
          <header class={styles.cardHead}>
            <h2 class={styles.cardTitle}>Top vehículos</h2>
            <span class={styles.cardHint}>por ingreso</span>
          </header>
          <div class={styles.cardBody}>
            <HBars rows={stats.value.vehicleBars} total={stats.value.revenue} />
          </div>
        </section>

        <section class={styles.card}>
          <header class={styles.cardHead}>
            <h2 class={styles.cardTitle}>Top servicios</h2>
            <span class={styles.cardHint}>por ingreso</span>
          </header>
          <div class={styles.cardBody}>
            <HBars rows={stats.value.serviceBars} total={stats.value.revenue} />
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────

/** La primera clave del orden dado que más lavados acumula, o null si nada. */
function topBy<K extends string>(
  totals: Map<K, CellStat>,
  order: readonly K[],
): { key: K; washes: number } | null {
  let best: K | null = null;
  let bestCount = 0;
  for (const key of order) {
    const count = totals.get(key)?.washes ?? 0;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (best === null) return null;
  return { key: best, washes: bestCount };
}

/** Matriz de calor vehículo × servicio, con fila de totales y lente conmutable. */
function HeatMatrix({
  vehicles,
  cells,
  vehicleTotals,
  serviceTotals,
  maxWashes,
  maxRevenue,
  totalWashes,
  totalRevenue,
  mode,
}: {
  vehicles: readonly VehicleKind[];
  cells: Map<string, CellStat>;
  vehicleTotals: Map<VehicleKind, CellStat>;
  serviceTotals: Map<ServiceTier, CellStat>;
  maxWashes: number;
  maxRevenue: number;
  totalWashes: number;
  totalRevenue: number;
  mode: HeatMode;
}) {
  const ceiling = mode === 'Lavados' ? maxWashes : maxRevenue;
  const fmt = (value: number): string =>
    mode === 'Lavados' ? String(value) : `S/ ${soles(value)}`;

  return (
    <div class={styles.matrixScroll}>
      <table class={styles.matrix} aria-label="Demanda por vehículo y servicio">
        <thead>
          <tr>
            <th scope="col" class={styles.matrixHead}>
              Vehículo
            </th>
            {SERVICE_ORDER.map((tier) => (
              <th key={tier} scope="col" class={styles.matrixHead}>
                {SERVICE_LABELS[tier]}
              </th>
            ))}
            <th scope="col" class={styles.matrixHead}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => {
            const available = availableTiersFor(vehicle);
            const vehicleTotal = vehicleTotals.get(vehicle);
            const rowTotal = mode === 'Lavados'
              ? (vehicleTotal?.washes ?? 0)
              : (vehicleTotal?.revenue ?? 0);
            return (
              <tr key={vehicle}>
                <th scope="row" class={styles.matrixLabel}>
                  {VEHICLE_LABELS[vehicle]}
                </th>
                {SERVICE_ORDER.map((tier) => {
                  // Un tier que el vehículo no ofrece no es "cero lavados": es
                  // una casilla que el negocio no puede llenar, y se raya.
                  if (!available.includes(tier)) {
                    return (
                      <td key={tier} class={styles.matrixCellEmpty} title="No aplica" />
                    );
                  }
                  const cell = cells.get(`${vehicle}|${tier}`);
                  const washes = cell?.washes ?? 0;
                  const cellRevenue = cell?.revenue ?? 0;
                  const value = mode === 'Lavados' ? washes : cellRevenue;
                  if (value === 0) {
                    return (
                      <td key={tier} class={styles.matrixCell}>
                        <span class={styles.matrixCellMoney}>–</span>
                      </td>
                    );
                  }
                  // El fondo sube con el valor (15%–75% del acento) sin llegar
                  // nunca a tapar el número.
                  const intensity = Math.round(15 + (value / ceiling) * 60);
                  return (
                    <td
                      key={tier}
                      class={styles.matrixCell}
                      style={{
                        background: `color-mix(in srgb, var(--color-accent) ${intensity}%, transparent)`,
                      }}
                    >
                      <b>{fmt(value)}</b>
                      <small>
                        {mode === 'Lavados'
                          ? `S/ ${soles(cellRevenue)}`
                          : `${washes} ${washes === 1 ? 'lavado' : 'lavados'}`}
                      </small>
                    </td>
                  );
                })}
                <td class={styles.totalCell}>{fmt(rowTotal)}</td>
              </tr>
            );
          })}
          <tr class={styles.totalRow}>
            <td class={styles.totalCell}>Total</td>
            {SERVICE_ORDER.map((tier) => {
              const serviceTotal = serviceTotals.get(tier);
              const value = mode === 'Lavados'
                ? (serviceTotal?.washes ?? 0)
                : (serviceTotal?.revenue ?? 0);
              return (
                <td key={tier} class={styles.totalCell}>
                  {fmt(value)}
                </td>
              );
            })}
            <td class={styles.totalCell}>
              {fmt(mode === 'Lavados' ? totalWashes : totalRevenue)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function HBars({ rows, total }: { rows: readonly BarRow[]; total: number }) {
  const ceiling = Math.max(...rows.map((row) => row.value), 0);

  return (
    <div class={styles.hbars} role="img" aria-label={`Ingresos por categoría: S/ ${soles(total)}`}>
      {rows.map((row) => {
        const percent = ceiling > 0 ? Math.round((row.value / ceiling) * 100) : 0;
        return (
          <div key={row.key} class={styles.hbar}>
            <div class={styles.hbarTop}>
              <span>{row.label}</span>
              <span>{row.text}</span>
            </div>
            <div class={styles.hbarTrack}>
              <span class={styles.hbarFill} style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
