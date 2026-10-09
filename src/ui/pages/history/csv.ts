import type { WashTransactionView } from '@core/types';
import { VEHICLE_LABELS, SERVICE_LABELS } from '@ui/pages/wash/vehicleLabels';

function escapeCsvField(field: string | number | boolean): string {
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

export function transactionsToCsv(transactions: WashTransactionView[]): string {
  const BOM = '\uFEFF';
  const headers = ['Fecha', 'Cliente', 'Placa', 'Vehículo', 'Servicio', 'Lavador', 'Pago', 'Costo', 'Gratis'];
  
  const rows = transactions.map(tx => [
    formatDate(tx.createdAt),
    tx.customerName,
    tx.customerPlate,
    VEHICLE_LABELS[tx.vehicleKind],
    SERVICE_LABELS[tx.serviceTier],
    tx.washerNames.join(' / '),
    tx.paidWith === 'yape' ? 'Yape' : 'Efectivo',
    tx.cost.toFixed(2),
    tx.wasFree ? 'Sí' : 'No'
  ].map(escapeCsvField).join(','));

  return BOM + headers.join(',') + '\n' + rows.join('\n');
}
