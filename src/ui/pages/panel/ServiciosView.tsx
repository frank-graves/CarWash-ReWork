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
  // useComputed para la matriz, los totales y los dos rankings: separarlos
  // obligaría a recorrer el mismo array cuatro veces por cambio de rango.
  const stats = useComputed(() => {
    const since = rangeStart(activeRange.value);
    const cells = new Map<string, CellStat>();
    const vehicleRevenue = new Map<VehicleKind, number>();
    const serviceRevenue = new Map<ServiceTier, number>();
    const vehicleWashes = new Map<VehicleKind, number>();
    const serviceWashes = new Map<ServiceTier, number>();
    let washes = 0;
    let revenue = 0;

    for (const tx of ledger.value) {
      if (tx.createdAt.getTime() < since) continue;

      washes += 1;
      vehicleWashes.set(tx.vehicleKind, (vehicleWashes.get(tx.vehicleKind) ?? 0) + 1);
      serviceWashes.set(tx.serviceTier, (serviceWashes.get(tx.serviceTier) ?? 0) + 1);

      const key = `${tx.vehicleKind}|${tx.serviceTier}`;
      const cell = cells.get(key) ?? { washes: 0, revenue: 0 };
      cell.washes += 1;
      // El cortesía cuenta como demanda (es un lavado), pero no como ingreso.
      if (!tx.wasFree) {
        cell.revenue += tx.cost;
        revenue += tx.cost;
        vehicleRevenue.set(tx.vehicleKind, (vehicleRevenue.get(tx.vehicleKind) ?? 0) + tx.cost);
        serviceRevenue.set(tx.serviceTier, (serviceRevenue.get(tx.serviceTier) ?? 0) + tx.cost);
      }
      cells.set(key, cell);
    }

    // Los vehículos se ordenan por ingreso del rango: el más rentable arriba.
    const vehiclesByRevenue = [...VEHICLE_ORDER].sort(
      (a, b) => (vehicleRevenue.get(b) ?? 0) - (vehicleRevenue.get(a) ?? 0),
    );

    const topService = topBy(serviceWashes, SERVICE_ORDER);
    const topVehicle = topBy(vehicleWashes, VEHICLE_ORDER);

    const vehicleBars: BarRow[] = vehiclesByRevenue.map((vehicle) => {
      const value = vehicleRevenue.get(vehicle) ?? 0;
      return {
        key: vehicle,
        label: VEHICLE_LABELS[vehicle],
        value,
        text: `S/ ${soles(value)}`,
      };
    });

    const serviceBars: BarRow[] = [...SERVICE_ORDER]
      .sort((a, b) => (serviceRevenue.get(b) ?? 0) - (serviceRevenue.get(a) ?? 0))
      .slice(0, 5)
      .map((tier) => {
        const value = serviceRevenue.get(tier) ?? 0;
        return {
          key: tier,
          label: SERVICE_LABELS[tier],
          value,
          text: `S/ ${soles(value)}`,
        };
      });

    return {
      cells,
      washes,
      revenue,
      vehiclesByRevenue,
      vehicleBars,
      serviceBars,
      topService,
      topVehicle,
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
          <span class={styles.cardHint}>vehículo × servicio</span>
        </header>
        <div class={styles.cardBody}>
          <DemandMatrix
            vehicles={stats.value.vehiclesByRevenue}
            cells={stats.value.cells}
          />
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

/** La primera clave del orden dado que más aparece, o null si nada aparece. */
function topBy<K extends string>(
  counts: Map<K, number>,
  order: readonly K[],
): { key: K; washes: number } | null {
  let best: K | null = null;
  let bestCount = 0;
  for (const key of order) {
    const count = counts.get(key) ?? 0;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (best === null) return null;
  return { key: best, washes: bestCount };
}

function DemandMatrix({ vehicles, cells }: {
  vehicles: readonly VehicleKind[];
  cells: Map<string, CellStat>;
}) {
  return (
    <div class={styles.matrix} role="table" aria-label="Lavados por vehículo y servicio">
      <span class={styles.matrixHead} role="columnheader" aria-label="Vehículo" />
      {SERVICE_ORDER.map((tier) => (
        <span key={tier} class={styles.matrixHead} role="columnheader">
          {SERVICE_LABELS[tier]}
        </span>
      ))}

      {vehicles.map((vehicle) => {
        const available = availableTiersFor(vehicle);
        return (
          <div key={vehicle} class={styles.matrixRow} role="row">
            <span class={styles.matrixLabel} role="rowheader">
              {VEHICLE_LABELS[vehicle]}
            </span>
            {SERVICE_ORDER.map((tier) => {
              // Un tier que el vehículo no ofrece no es "cero lavados": es una
              // casilla que el negocio no puede llenar, y se pinta vacía.
              if (!available.includes(tier)) {
                return (
                  <div key={tier} class={styles.matrixCellEmpty} role="cell" />
                );
              }
              const cell = cells.get(`${vehicle}|${tier}`);
              if (!cell || cell.washes === 0) {
                return (
                  <div key={tier} class={styles.matrixCell} role="cell">
                    <span class={styles.matrixCellMoney}>—</span>
                  </div>
                );
              }
              return (
                <div key={tier} class={styles.matrixCell} role="cell">
                  <strong>{cell.washes}</strong>
                  <span class={styles.matrixCellMoney}>S/ {soles(cell.revenue)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
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
