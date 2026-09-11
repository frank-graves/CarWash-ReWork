// src/core/loyalty.ts
export const LOYALTY_THRESHOLD = 6;

export function isEligibleForFreeWash(accumulated: number): boolean {
  return accumulated >= LOYALTY_THRESHOLD;
}

/** Devuelve el nuevo contador tras registrar un lavado. */
export function nextAccumulatedValue(current: number, wasFree: boolean): number {
  if (wasFree) return 0;
  return current + 1;
}