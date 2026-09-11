import { describe, it, expect } from 'vitest';
import { transactionsToCsv } from '../csv';
import type { WashTransactionView } from '@core/types';

const mockTx: WashTransactionView = {
  transactionId: '1',
  customerName: 'Juan "El Rápido" Pérez',
  customerPlate: 'ABC-123',
  vehicleKind: 'auto',
  serviceTier: 'premium',
  cost: 55,
  wasFree: false,
  paidWith: 'yape',
  registeredByName: 'Carlos',
  washerName: 'Miguel',
  createdAt: new Date('2026-09-10T10:30:00Z'),
};

describe('transactionsToCsv', () => {
  it('includes UTF-8 BOM', () => {
    const csv = transactionsToCsv([mockTx]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
  });

  it('formats headers correctly', () => {
    const csv = transactionsToCsv([mockTx]);
    expect(csv).toContain('Fecha,Cliente,Placa,Vehículo,Servicio,Lavador,Pago,Costo,Gratis');
  });

  it('escapes quotes and formats cost without currency symbol', () => {
    const csv = transactionsToCsv([mockTx]);
    expect(csv).toContain('"Juan ""El Rápido"" Pérez"');
    expect(csv).toContain('55.00');
    expect(csv).toContain('No');
    // El esquema 2 separa lavador de operador: la columna "Lavador" lleva al lavador.
    expect(csv).toContain('Miguel');
  });
});
