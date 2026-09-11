import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { PRICE_MATRIX, availableTiersFor } from '@core/pricing';
import { SettingsRepository } from '@infra/settings-repository';
import { translateError } from '@ui/i18n/es';
import { VEHICLE_LABELS, SERVICE_LABELS } from '@ui/pages/wash/vehicleLabels';
import type { PriceMatrix, ServiceTier, VehicleKind } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './PricingEditor.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
  operatorId: string;
}

// La matriz es readonly por contrato; para editar se clona a tipos mutables.
type MutableRow = Record<string, number>;
type MutableMatrix = Record<string, MutableRow>;

function cloneMatrix(source: PriceMatrix): MutableMatrix {
  const clone: MutableMatrix = {};
  for (const vehicle of Object.keys(source)) {
    clone[vehicle] = { ...source[vehicle] };
  }
  return clone;
}

// Headers = UNIÓN de los tiers de todos los vehículos (7 columnas, no 5). Auto tiene
// cinco, pero 'completo' y 'full_moto' solo existen en moto: usar los tiers de un
// único vehículo dejaría esas tarifas sin celda donde editarse.
const TIER_COLUMNS: readonly ServiceTier[] = Array.from(
  new Set(
    (Object.keys(PRICE_MATRIX) as VehicleKind[]).flatMap((vehicle) => availableTiersFor(vehicle))
  )
);

export function PricingEditor({ runtime, workspaceId, operatorId }: Props) {
  const matrix = useSignal<PriceMatrix>(cloneMatrix(PRICE_MATRIX));
  const baseline = useSignal<PriceMatrix>(cloneMatrix(PRICE_MATRIX));
  const loading = useSignal(true);
  const saving = useSignal(false);
  const feedback = useSignal('');

  useSignalEffect(() => {
    const repo = new SettingsRepository(runtime, workspaceId);
    repo.getPriceMatrix()
      .then((remote) => {
        matrix.value = cloneMatrix(remote);
        baseline.value = cloneMatrix(remote);
      })
      .catch(() => {
        feedback.value = 'No se pudieron cargar los precios. Se muestran los de fábrica.';
      })
      .finally(() => { loading.value = false; });
  });

  const isDirty = useComputed(() => {
    const m = matrix.value;
    const b = baseline.value;
    for (const vehicle of Object.keys(b)) {
      // Las filas se guardan en constantes: `noUncheckedIndexedAccess` no deja
      // encadenar b[vehicle][tier] sin comprobar la fila antes.
      const baselineRow = b[vehicle];
      const currentRow = m[vehicle];
      if (!baselineRow) continue;
      for (const tier of Object.keys(baselineRow)) {
        if (currentRow?.[tier] !== baselineRow[tier]) return true;
      }
    }
    return false;
  });

  const vehicles = Object.keys(PRICE_MATRIX) as VehicleKind[];

  const handleChange = (vehicle: VehicleKind, tier: ServiceTier, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;

    if (parsed === 0) {
      const ok = window.confirm(
        `¿Poner el precio de ${VEHICLE_LABELS[vehicle]} · ${SERVICE_LABELS[tier]} en 0?\n\n` +
        `Si es una promoción temporal, considera dejarlo como estaba y aplicar un ` +
        `descuento manual al registrar.`,
      );
      if (!ok) return;
    }

    const next = cloneMatrix(matrix.value);
    next[vehicle] = { ...next[vehicle], [tier]: parsed };
    matrix.value = next;
  };

  const handleSave = async () => {
    saving.value = true;
    feedback.value = '';
    try {
      const repo = new SettingsRepository(runtime, workspaceId);
      await repo.updatePriceMatrix(matrix.value, operatorId);
      baseline.value = cloneMatrix(matrix.value);
      feedback.value = 'Precios actualizados';
      window.setTimeout(() => { feedback.value = ''; }, 2200);
    } catch (e) {
      feedback.value = translateError(e);
    } finally {
      saving.value = false;
    }
  };

  if (loading.value) {
    return <div class={styles.loading}>Leyendo precios…</div>;
  }

  return (
    <div class={styles.root}>
      {/* El número de columnas de tier viaja al CSS como custom property: la rejilla
          y los headers salen de la misma constante, sin contar a mano en dos sitios. */}
      <div
        class={styles.table}
        role="table"
        aria-label="Matriz de precios"
        style={{ '--tier-columns': String(TIER_COLUMNS.length) }}
      >
        <div class={styles.row} role="row">
          <span class={styles.headCell} role="columnheader">Vehículo</span>
          {TIER_COLUMNS.map((tier) => (
            <span key={tier} class={styles.headCell} role="columnheader">
              {SERVICE_LABELS[tier]}
            </span>
          ))}
        </div>

        {vehicles.map((vehicle) => (
          <div key={vehicle} class={styles.row} role="row">
            <span class={styles.labelCell} role="rowheader">{VEHICLE_LABELS[vehicle]}</span>
            {TIER_COLUMNS.map((tier) => {
              const price = matrix.value[vehicle]?.[tier];
              if (price === undefined) {
                // Este vehículo no ofrece este servicio: la celda se queda vacía pero
                // ocupa su columna, para que la rejilla no se desplace.
                return <span key={tier} class={styles.cell} aria-hidden="true" />;
              }
              return (
                <label key={tier} class={styles.cell}>
                  <span class={styles.cellTier}>{SERVICE_LABELS[tier]}</span>
                  <span class={styles.currency}>S/</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    class={styles.input}
                    value={price}
                    onInput={(e) => handleChange(vehicle, tier, e.currentTarget.value)}
                    aria-label={`Precio de ${VEHICLE_LABELS[vehicle]} ${SERVICE_LABELS[tier]}`}
                  />
                </label>
              );
            })}
          </div>
        ))}
      </div>

      <div class={styles.footer}>
        <span class={feedback.value ? `${styles.feedback} ${styles.visible}` : styles.feedback}>
          {feedback.value || '\u00A0'}
        </span>
        <button
          type="button"
          class={styles.save}
          onClick={handleSave}
          disabled={!isDirty.value || saving.value}
        >
          {saving.value ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
