import { useSignal } from '@preact/signals';
import { CustomerRepository } from '@infra/customer-repository';
import { TransactionRepository } from '@infra/transaction-repository';
import { translateError } from '@ui/i18n/es';
import { parseImportJson, type ParseResult } from './importLogic';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import type { CustomerView } from '@core/types';
import styles from './ImportModal.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
  onClose: () => void;
  onImported: (affectedCustomerIds: string[]) => void;
}

interface ImportFailure {
  index: number;
  reason: string;
}

// El ejemplo va en el placeholder y no como texto de ayuda: el operador copia
// la forma exacta del objeto sin tener que leer nada.
const EXAMPLE = `[
  {
    "plate": "ABC-123",
    "date": "2026-03-15",
    "vehicleKind": "auto",
    "serviceTier": "premium",
    "cost": 55,
    "paidWith": "efectivo",
    "wasFree": false
  }
]`;

export function ImportModal({ runtime, workspaceId, onClose, onImported }: Props) {
  const rawText = useSignal('');
  const phase = useSignal<'idle' | 'importing' | 'done'>('idle');
  const progress = useSignal<{ current: number; total: number } | null>(null);
  const report = useSignal<{ imported: number; failed: ImportFailure[] } | null>(null);
  const error = useSignal('');
  // El plan vive entre "Validar" e "Importar": sin él habría que re-parsear al
  // pulsar el botón y el preview podría decir una cosa y cargarse otra.
  const plan = useSignal<ParseResult | null>(null);
  const importedIds = useSignal<string[]>([]);

  const handleValidate = () => {
    const result = parseImportJson(rawText.value);
    const fatal = result.errors.find((entry) => entry.index === -1);
    if (fatal) {
      error.value = fatal.reason;
      plan.value = null;
      return;
    }
    error.value = '';
    plan.value = result;
  };

  const handleImport = async () => {
    const parsed = plan.value;
    if (!parsed || parsed.valid.length === 0) return;

    phase.value = 'importing';
    error.value = '';
    report.value = null;
    progress.value = { current: 0, total: parsed.valid.length };

    const customers = new CustomerRepository(runtime, workspaceId);
    const ledger = new TransactionRepository(runtime, workspaceId);
    const failures: ImportFailure[] = [];
    // Caché por placa: un histórico trae al mismo cliente varias veces y no
    // tiene sentido releer su doc por cada visita.
    const cache = new Map<string, CustomerView | null>();
    const touched = new Set<string>();
    const importedById = runtime.auth.currentUser?.uid ?? 'imported';
    let imported = 0;

    for (const [index, entry] of parsed.valid.entries()) {
      try {
        let customer = cache.get(entry.plate);
        if (customer === undefined) {
          customer = await customers.findByPlate(entry.plate);
          cache.set(entry.plate, customer);
        }

        if (!customer) {
          failures.push({
            index,
            reason: `No hay ningún cliente con la placa ${entry.plate}.`,
          });
        } else {
          await ledger.record({
            customer,
            vehicleKind: entry.vehicleKind,
            serviceTier: entry.serviceTier,
            cost: entry.cost,
            wasFree: entry.wasFree,
            paidWith: entry.paidWith,
            // El JSON no trae lavador ni operador: el histórico se firma como lo
            // que es, y el registro queda atribuido a quien corrió la importación.
            registeredBy: { id: importedById, name: 'Importación' },
            washer: { id: 'imported', name: 'Histórico' },
            transactionDate: entry.date,
          });
          imported += 1;
          touched.add(customer.customerId);
        }
      } catch (e) {
        // Un fallo de red en la fila 30 no puede tirar las 70 que faltan: se
        // anota y se sigue. El reporte final dice exactamente qué quedó fuera.
        failures.push({ index, reason: translateError(e) });
      }

      progress.value = { current: index + 1, total: parsed.valid.length };
    }

    // El contador es una denormalización y los retroactivos llegan en desorden:
    // un recálculo por cliente afectado, no por lavado.
    for (const customerId of touched) {
      try {
        await customers.recomputeLoyalty(customerId);
      } catch (e) {
        failures.push({
          index: -1,
          reason: `No se pudo recalcular la lealtad de ${customerId.slice(0, 8)}…: ${translateError(e)}`,
        });
      }
    }

    report.value = { imported, failed: failures };
    importedIds.value = Array.from(touched);
    phase.value = 'done';
  };

  const handleFinish = () => {
    onImported(importedIds.value);
  };

  const partial = progress.value;

  return (
    <div
      class={styles.overlay}
      onClick={() => {
        // Cerrar a mitad de importación perdería el hilo del lote en curso.
        if (phase.value !== 'importing') onClose();
      }}
    >
      <div
        class={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <h2 id="import-title" class={styles.title}>Importar histórico</h2>

        {phase.value === 'idle' && !plan.value && (
          <>
            <p class={styles.hint}>
              Pegá un array JSON con los lavados anteriores. Se validan antes de
              tocar nada y podés revisar qué entra y qué no.
            </p>
            <textarea
              class={styles.textarea}
              value={rawText.value}
              placeholder={EXAMPLE}
              spellcheck={false}
              onInput={(e) => { rawText.value = e.currentTarget.value; }}
            />
            {error.value && <p class={styles.error}>{error.value}</p>}
            <div class={styles.actions}>
              <button type="button" class={styles.btnSecondary} onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                class={styles.btnPrimary}
                onClick={handleValidate}
                disabled={!rawText.value.trim()}
              >
                Validar y revisar
              </button>
            </div>
          </>
        )}

        {phase.value === 'idle' && plan.value && (
          <>
            <div class={styles.preview}>
              <strong class={styles.previewCount}>
                {plan.value.valid.length} {plan.value.valid.length === 1 ? 'registro válido' : 'registros válidos'}
                {plan.value.errors.length > 0 && `, ${plan.value.errors.length} con problemas`}
              </strong>
              <p class={styles.hint}>
                Los que tienen problemas se omiten: se importa solo lo válido.
              </p>
            </div>

            {plan.value.errors.length > 0 && (
              <details class={styles.errors}>
                <summary>Ver los {plan.value.errors.length} con problemas</summary>
                <ul class={styles.errorList}>
                  {plan.value.errors.map((entry) => (
                    <li key={entry.index}>
                      #{entry.index + 1}: {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div class={styles.actions}>
              <button
                type="button"
                class={styles.btnSecondary}
                onClick={() => { plan.value = null; }}
              >
                Volver
              </button>
              <button
                type="button"
                class={styles.btnPrimary}
                onClick={handleImport}
                disabled={plan.value.valid.length === 0}
              >
                Importar {plan.value.valid.length} {plan.value.valid.length === 1 ? 'registro' : 'registros'}
              </button>
            </div>
          </>
        )}

        {phase.value === 'importing' && partial && (
          <>
            <p class={styles.hint}>
              Importando {partial.current} de {partial.total}…
            </p>
            <div class={styles.progressBar}>
              <span
                class={styles.progressFill}
                style={{ width: `${Math.round((partial.current / partial.total) * 100)}%` }}
              />
            </div>
            <p class={styles.hint}>
              No cierres esta ventana. Un fallo en un registro no detiene el resto.
            </p>
          </>
        )}

        {phase.value === 'done' && report.value && (
          <>
            <div class={styles.preview}>
              <strong class={styles.previewCount}>
                {report.value.imported} importados
                {report.value.failed.length > 0 && `, ${report.value.failed.length} fallaron`}
              </strong>
              <p class={styles.hint}>
                La lealtad de los clientes afectados quedó recalculada desde el historial.
              </p>
            </div>

            {report.value.failed.length > 0 && (
              <details class={styles.errors} open>
                <summary>Ver los {report.value.failed.length} fallos</summary>
                <ul class={styles.errorList}>
                  {report.value.failed.map((failure) => (
                    <li key={`${failure.index}-${failure.reason}`}>
                      {failure.index >= 0 ? `#${failure.index + 1}: ` : ''}
                      {failure.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div class={styles.actions}>
              <button type="button" class={styles.btnPrimary} onClick={handleFinish}>
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
