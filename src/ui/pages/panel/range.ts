// src/ui/pages/panel/range.ts
// El rango temporal activo del panel. Vive en un módulo aparte y no en
// DashboardShell porque dos sitios lo necesitan: el shell (para pintar
// los botones) y ResumenView (para calcular sus buckets). Compartirlo por
// import evita pasarlo como prop a cada vista.

import { signal } from '@preact/signals';

export type Range = 'today' | 'week' | 'month' | 'year' | 'all';

export const RANGE_OPTIONS: readonly { id: Range; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'year', label: 'Año' },
  { id: 'all', label: 'Siempre' },
];

// Semana es el default: la jefa llega a la mañana y quiere ver cómo va la
// semana, no solo el día (que a las 8 AM está vacío). Mes esconde la
// operación del día; Hoy es demasiado volátil.
export const activeRange = signal<Range>('week');

/**
 * Instante de corte del rango, en milisegundos epoch. Todo lo anterior
 * queda fuera. Para 'all' devuelve 0 (incluye todo).
 */
export function rangeStart(range: Range, now: number = Date.now()): number {
  const day = 86_400_000;
  if (range === 'all') return 0;
  if (range === 'today') {
    const mark = new Date(now);
    mark.setHours(0, 0, 0, 0);
    return mark.getTime();
  }
  if (range === 'week') {
    const mark = new Date(now - 6 * day);
    mark.setHours(0, 0, 0, 0);
    return mark.getTime();
  }
  if (range === 'month') {
    const mark = new Date(now - 29 * day);
    mark.setHours(0, 0, 0, 0);
    return mark.getTime();
  }
  // year: mismo punto de inicio que el primer bucket de bucketsFor('year'),
  // que arranca el día 1 del mes actual −11. Sin esto, un lavado de los
  // últimos días del mes de hace 11 meses contaba en KPIs pero no caía en
  // ninguna barra (bucketIndexOf → -1).
  const mark = new Date(now);
  mark.setMonth(mark.getMonth() - 11);
  mark.setDate(1);
  mark.setHours(0, 0, 0, 0);
  return mark.getTime();
}

/**
 * Granularidad de las barras para el rango. Cada bucket tiene su label
 * corto (lo que se pinta debajo de la barra) y su instante de inicio
 * (para agrupar las transacciones que caen dentro).
 *
 * Se generan los buckets desde `now` hacia atrás, del más viejo al más
 * nuevo, que es el orden natural de lectura izquierda a derecha.
 */
export interface Bucket {
  /** Instante de inicio del bucket. Sirve como clave estable para el render. */
  start: number;
  /** Etiqueta corta: '09h', 'lun', '15', 'mar', '2025'. */
  label: string;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;
const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','set','oct','nov','dic'] as const;

export function bucketsFor(range: Range, now: number = Date.now()): Bucket[] {
  const day = 86_400_000;
  const buckets: Bucket[] = [];

  if (range === 'today') {
    // Un bucket por hora, de la hora 0 a la hora actual del día.
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const currentHour = new Date(now).getHours();
    for (let h = 0; h <= currentHour; h += 1) {
      const t = start.getTime() + h * 3_600_000;
      buckets.push({ start: t, label: `${String(h).padStart(2, '0')}h` });
    }
    return buckets;
  }

  if (range === 'week' || range === 'month') {
    // Un bucket por día, del primero al último del rango.
    const totalDays = range === 'week' ? 7 : 30;
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    for (let back = totalDays - 1; back >= 0; back -= 1) {
      const d = new Date(base.getTime() - back * day);
      const label = range === 'week'
        ? (WEEKDAYS[d.getDay()] ?? '·')
        : String(d.getDate());
      buckets.push({ start: d.getTime(), label });
    }
    return buckets;
  }

  if (range === 'year') {
    // Un bucket por mes, del mes actual -11 al actual.
    const cursor = new Date(now);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    for (let back = 11; back >= 0; back -= 1) {
      const d = new Date(cursor);
      d.setMonth(d.getMonth() - back);
      buckets.push({
        start: d.getTime(),
        label: MONTHS[d.getMonth()] ?? '·',
      });
    }
    return buckets;
  }

  // 'all': un bucket por año, del primero con datos al actual. Como no
  // sabemos cuándo empezó el negocio, se generan años hasta cubrir lo
  // que haya en el ledger. Se devuelven en orden ascendente.
  // El llamador filtra los buckets vacíos si quiere.
  const currentYear = new Date(now).getFullYear();
  // Ascendente, del año más viejo al actual: es el orden que espera
  // bucketIndexOf (corta en el primer `start > timestamp`) y el de lectura
  // izquierda→derecha del resto de rangos. La spec lo traía al revés.
  for (let y = currentYear - 4; y <= currentYear; y += 1) {
    const d = new Date(y, 0, 1);
    buckets.push({ start: d.getTime(), label: String(y) });
  }
  return buckets;
}

/**
 * Devuelve el bucket al que pertenece una fecha. Los buckets están en
 * orden ascendente; el último con `start <= timestamp` gana.
 *
 * Recorrido lineal a propósito: son entre 7 y 24 buckets, y una búsqueda
 * binaria sería más código del que ahorra tiempo.
 */
export function bucketIndexOf(buckets: readonly Bucket[], timestamp: number): number {
  let match = -1;
  for (let i = 0; i < buckets.length; i += 1) {
    const b = buckets[i];
    if (b && b.start <= timestamp) match = i;
    else break;
  }
  return match;
}
