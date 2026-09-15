import { useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { Vault } from '@infra/vault';
import { TransactionRepository } from '@infra/transaction-repository';
import { OperatorRepository } from '@infra/operator-repository';
import { WasherRepository } from '@infra/washer-repository';
import { calculatePrice } from '@core/pricing';
import { translateError } from '@ui/i18n/es';
import type { CustomerView, PaymentMethod, ServiceTier, VehicleKind } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import { CustomerAutocomplete } from './CustomerAutocomplete';
import { NewCustomerModal } from './NewCustomerModal';
import { ReceiptModal } from './ReceiptModal';
import { VEHICLE_LABELS, SERVICE_LABELS } from './vehicleLabels';
import { isFormComplete, getAvailableTiers, isFreeWash, type WashFormState } from './formLogic';
import styles from './WashRegistrationPage.module.css';

export function WashRegistrationPage() {
  const runtime = useSignal<FirebaseRuntime | null>(null);
  const workspaceId = useSignal<string | null>(null);
  const activeOperatorId = useSignal<string | null>(null);
  const operators = useSignal<{ id: string; displayName: string }[]>([]);
  const washers = useSignal<{ id: string; displayName: string }[]>([]);

  const customer = useSignal<CustomerView | null>(null);
  const vehicle = useSignal<VehicleKind | null>(null);
  const tier = useSignal<ServiceTier | null>(null);
  const cost = useSignal(0);
  const operatorId = useSignal<string | null>(null);
  const washerId = useSignal<string | null>(null);
  const payment = useSignal<PaymentMethod | null>(null);

  const submitting = useSignal(false);
  const error = useSignal('');
  
  const showNewCustomerModal = useSignal(false);
  const newCustomerPlate = useSignal('');
  
  // Los nombres del snapshot tienen que coincidir con las props de ReceiptModal:
  // un `vehicle`/`tier` desalineado compila en el spread y pinta "undefined" en el recibo.
  const receiptData = useSignal<{
    customer: CustomerView; vehicleKind: VehicleKind; serviceTier: ServiceTier; cost: number; wasFree: boolean;
  } | null>(null);

  useSignalEffect(() => {
    bootstrapFirebase().then(async (rt) => {
      runtime.value = rt;
      const ws = await Vault.getWorkspaceId();
      workspaceId.value = ws;
      if (ws) {
        // Operadores (quién registra) y lavadores (quién lava) son dos listas
        // distintas desde el esquema 2: la tablet la lleva uno, el auto lo lava otro.
        const [ops, lavadores] = await Promise.all([
          new OperatorRepository(rt, ws).listAll(),
          new WasherRepository(rt, ws).listAll(),
        ]);
        operators.value = ops;
        washers.value = lavadores;
        const uid = rt.auth.currentUser?.uid;
        if (uid) {
          activeOperatorId.value = uid;
          operatorId.value = uid;
        }
      }
    });
  });

  // Si cambia el vehículo, reseteamos el tier si ya no es válido para evitar precios rotos.
  useSignalEffect(() => {
    const v = vehicle.value;
    if (v && tier.value) {
      const available = getAvailableTiers(v);
      if (!available.includes(tier.value)) tier.value = null;
    }
  });

  // Auto-relleno de precio cuando vehículo y tier son válidos.
  useSignalEffect(() => {
    const v = vehicle.value;
    const t = tier.value;
    if (v && t) cost.value = calculatePrice(v, t);
  });

  const state: WashFormState = {
    customer: customer.value,
    vehicleKind: vehicle.value,
    serviceTier: tier.value,
    cost: cost.value,
    operatorId: operatorId.value,
    paymentMethod: payment.value,
  };

  // El lavador no vive en WashFormState (es lógica pura ya testeada); se exige aquí.
  const canSubmit = isFormComplete(state) && washerId.value !== null && !submitting.value;
  const freeWash = isFreeWash(state);

  const handleSubmit = async () => {
    const rt = runtime.value;
    const ws = workspaceId.value;
    const pickedCustomer = customer.value;
    const pickedVehicle = vehicle.value;
    const pickedTier = tier.value;
    const pickedPayment = payment.value;
    const pickedOperatorId = operatorId.value;
    const pickedWasherId = washerId.value;

    if (
      !canSubmit ||
      !rt ||
      !ws ||
      !pickedCustomer ||
      !pickedVehicle ||
      !pickedTier ||
      !pickedPayment ||
      !pickedOperatorId ||
      !pickedWasherId
    ) {
      return;
    }

    submitting.value = true;
    error.value = '';
    
    try {
      const operator = operators.value.find(o => o.id === pickedOperatorId);
      const washer = washers.value.find(w => w.id === pickedWasherId);
      const repo = new TransactionRepository(rt, ws);
      
      await repo.record({
        customer: pickedCustomer,
        vehicleKind: pickedVehicle,
        serviceTier: pickedTier,
        cost: cost.value,
        wasFree: freeWash,
        paidWith: pickedPayment,
        registeredBy: { id: pickedOperatorId, name: operator?.displayName ?? 'Desconocido' },
        washer: { id: pickedWasherId, name: washer?.displayName ?? 'Desconocido' },
      });

      receiptData.value = {
        customer: pickedCustomer,
        vehicleKind: pickedVehicle,
        serviceTier: pickedTier,
        cost: cost.value,
        wasFree: freeWash,
      };

      // Reset para el siguiente cliente. El lavador se queda: quien lava el próximo
      // auto suele ser el mismo, y volver a elegirlo es un toque de más por coche.
      customer.value = null;
      vehicle.value = null;
      tier.value = null;
      cost.value = 0;
      payment.value = null;
      operatorId.value = activeOperatorId.value;
    } catch (e) {
      error.value = translateError(e);
    } finally {
      submitting.value = false;
    }
  };

  if (!runtime.value || !workspaceId.value) {
    return <div class={styles.loading}>Cargando entorno de trabajo...</div>;
  }

  return (
    <div class={styles.container}>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>1. Cliente</h3>
        {customer.value ? (
          <div class={styles.selectedCustomer}>
            <div>
              <strong>{customer.value.displayName}</strong>
              <span>{customer.value.plate}</span>
            </div>
            <button type="button" class={styles.btnClear} onClick={() => { customer.value = null; }}>Cambiar</button>
          </div>
        ) : (
          <CustomerAutocomplete
            runtime={runtime.value}
            workspaceId={workspaceId.value}
            onSelect={(c) => { customer.value = c; }}
            onRequestNew={(plate) => {
              newCustomerPlate.value = plate;
              showNewCustomerModal.value = true;
            }}
          />
        )}
      </section>

      {customer.value && (
        <>
          {freeWash && (
            <div class={styles.freeBanner}>
              🎉 ¡Este cliente tiene un lavado GRATIS por lealtad!
            </div>
          )}

          <section class={styles.section}>
            <h3 class={styles.sectionTitle}>2. Vehículo</h3>
            <div class={styles.vehicleGrid}>
              {(Object.keys(VEHICLE_LABELS) as VehicleKind[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  class={`${styles.btnGrid} ${vehicle.value === v ? styles.active : ''}`}
                  onClick={() => { vehicle.value = v; }}
                >
                  {VEHICLE_LABELS[v]}
                </button>
              ))}
            </div>
          </section>

          {vehicle.value && (
            <section class={styles.section}>
              <h3 class={styles.sectionTitle}>3. Servicio</h3>
              <div class={styles.gridButtons}>
                {getAvailableTiers(vehicle.value).map((t) => (
                  <button
                    key={t}
                    type="button"
                    class={`${styles.btnGrid} ${tier.value === t ? styles.active : ''}`}
                    onClick={() => { tier.value = t; }}
                  >
                    {SERVICE_LABELS[t]}
                  </button>
                ))}
              </div>
            </section>
          )}

          {tier.value && (
            <>
              <section class={styles.section}>
                <h3 class={styles.sectionTitle}>4. Costo</h3>
                <input
                  type="number"
                  class={styles.inputCost}
                  value={cost.value}
                  onInput={(e) => { cost.value = parseFloat(e.currentTarget.value) || 0; }}
                  min="0"
                  step="0.5"
                />
              </section>

              <section class={styles.section}>
                <h3 class={styles.sectionTitle}>5. Lavador</h3>
                <select
                  class={styles.select}
                  value={washerId.value ?? ''}
                  onChange={(e) => { washerId.value = e.currentTarget.value; }}
                >
                  <option value="" disabled>Elige quién lavó…</option>
                  {washers.value.map((w) => (
                    <option key={w.id} value={w.id}>{w.displayName}</option>
                  ))}
                </select>
                {washers.value.length === 0 && (
                  <p class={styles.hint}>
                    Todavía no hay lavadores registrados en este negocio.
                  </p>
                )}
              </section>

              <section class={styles.section}>
                <h3 class={styles.sectionTitle}>6. Pago</h3>
                <div class={styles.gridButtons}>
                  <button
                    type="button"
                    class={`${styles.btnGrid} ${payment.value === 'yape' ? styles.active : ''}`}
                    onClick={() => { payment.value = 'yape'; }}
                  >
                    Yape
                  </button>
                  <button
                    type="button"
                    class={`${styles.btnGrid} ${payment.value === 'efectivo' ? styles.active : ''}`}
                    onClick={() => { payment.value = 'efectivo'; }}
                  >
                    Efectivo
                  </button>
                </div>
              </section>

              {error.value && <p class={styles.error}>{error.value}</p>}

              <button
                type="button"
                class={styles.btnSubmit}
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting.value ? 'Registrando...' : 'Registrar Lavado'}
              </button>
            </>
          )}
        </>
      )}

      {showNewCustomerModal.value && (
        <NewCustomerModal
          runtime={runtime.value}
          workspaceId={workspaceId.value}
          initialPlate={newCustomerPlate.value}
          onClose={() => { showNewCustomerModal.value = false; }}
          onCreated={(c) => {
            customer.value = c;
            showNewCustomerModal.value = false;
          }}
        />
      )}

      {receiptData.value && (
        <ReceiptModal
          {...receiptData.value}
          onClose={() => { receiptData.value = null; }}
        />
      )}
    </div>
  );
}
