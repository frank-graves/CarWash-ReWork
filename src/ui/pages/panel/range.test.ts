// src/ui/pages/panel/range.test.ts
// Fija el contrato del rango del panel: los buckets van en orden ascendente
// (bucketIndexOf corta en el primer `start > timestamp`), y rangeStart cae
// justo donde arranca el primer bucket para que un lavado no cuente en los
// KPIs sin tener barra.

import { describe, expect, it } from 'vitest';
import { bucketsFor, bucketIndexOf, rangeStart, type Range } from './range';

// 2026-10-09 13:00, hora local: fecha fija para que los cortes de mes y año
// no dependan del reloj que corra la suite.
const NOW = new Date(2026, 9, 9, 13, 0, 0).getTime();

const RANGES: readonly Range[] = ['today', 'week', 'month', 'year', 'all'];

/** Primer bucket de un rango, con el guard que exige noUncheckedIndexedAccess. */
function firstBucketOf(range: Range): { buckets: ReturnType<typeof bucketsFor>; first: { start: number } } {
  const buckets = bucketsFor(range, NOW);
  const first = buckets[0];
  if (!first) throw new Error(`bucketsFor('${range}') no devolvió ningún bucket`);
  return { buckets, first };
}

describe("bucketsFor('all')", () => {
  it('devuelve años estrictamente crecientes', () => {
    const { buckets } = firstBucketOf('all');
    for (let i = 1; i < buckets.length; i += 1) {
      const prev = buckets[i - 1];
      const cur = buckets[i];
      if (!prev || !cur) throw new Error('bucket sin start');
      expect(cur.start).toBeGreaterThan(prev.start);
    }
  });

  it('bucketIndexOf(now) devuelve el último índice, no 0', () => {
    const { buckets } = firstBucketOf('all');
    const idx = bucketIndexOf(buckets, NOW);
    expect(idx).not.toBe(0);
    expect(idx).toBe(buckets.length - 1);
  });

  it('un lavado de hace 2 años cae en un bucket intermedio', () => {
    const { buckets } = firstBucketOf('all');
    const twoYearsAgo = new Date(NOW);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const idx = bucketIndexOf(buckets, twoYearsAgo.getTime());
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(buckets.length - 1);
  });
});

describe('rangeStart alineado con el primer bucket', () => {
  it('nunca arranca después del primer bucket, para todo rango', () => {
    for (const range of RANGES) {
      const { first } = firstBucketOf(range);
      expect(rangeStart(range, NOW)).toBeLessThanOrEqual(first.start);
    }
  });

  it('para los rangos con buckets, rangeStart cae exactamente en el primero', () => {
    // Éste es el caso que fallaba antes del fix de 'year': rangeStart caía en
    // `now − 364d`, antes del día 1 del mes −11, y un lavado en ese hueco
    // contaba en los KPIs sin barra (bucketIndexOf → -1). 'all' queda fuera:
    // su rangeStart es 0 por diseño y es deuda declarada.
    for (const range of RANGES) {
      if (range === 'all') continue;
      const { first } = firstBucketOf(range);
      expect(rangeStart(range, NOW)).toBe(first.start);
    }
  });
});
