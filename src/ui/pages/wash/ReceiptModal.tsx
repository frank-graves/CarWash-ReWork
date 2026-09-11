import type { CustomerView, ServiceTier, VehicleKind } from '@core/types';
import { SERVICE_LABELS, VEHICLE_LABELS } from './vehicleLabels';
import styles from './ReceiptModal.module.css';

interface Props {
  customer: CustomerView;
  vehicleKind: VehicleKind;
  serviceTier: ServiceTier;
  cost: number;
  wasFree: boolean;
  onClose: () => void;
}

export function ReceiptModal({ customer, vehicleKind, serviceTier, cost, wasFree, onClose }: Props) {
  const msg = `Recibo de Lavado\nCliente: ${customer.displayName}\nPlaca: ${customer.plate}\nVehículo: ${VEHICLE_LABELS[vehicleKind]}\nServicio: ${SERVICE_LABELS[serviceTier]}\nCosto: S/ ${cost.toFixed(2)}\n${wasFree ? '¡Lavado Gratis por Lealtad!' : ''}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;

  return (
    <div class={styles.overlay} onClick={onClose}>
      <div class={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 class={styles.title}>¡Lavado Registrado!</h2>
        
        <div class={styles.grid}>
          <div class={styles.row}><span>Cliente:</span><strong>{customer.displayName}</strong></div>
          <div class={styles.row}><span>Placa:</span><strong>{customer.plate}</strong></div>
          <div class={styles.row}><span>Vehículo:</span><strong>{VEHICLE_LABELS[vehicleKind]}</strong></div>
          <div class={styles.row}><span>Servicio:</span><strong>{SERVICE_LABELS[serviceTier]}</strong></div>
          <div class={styles.row}>
            <span>Costo:</span>
            <strong>{wasFree ? 'GRATIS 🎉' : `S/ ${cost.toFixed(2)}`}</strong>
          </div>
        </div>

        {wasFree && (
          <div class={styles.freeBanner}>
            ¡Este lavado fue GRATIS por lealtad!
          </div>
        )}

        <div class={styles.actions}>
          <a href={waUrl} target="_blank" rel="noopener noreferrer" class={styles.btnWa}>
            Compartir por WhatsApp
          </a>
          <button type="button" class={styles.btnClose} onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
