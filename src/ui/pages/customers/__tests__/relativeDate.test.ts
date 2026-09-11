import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeDate } from '../relativeDate';

describe('formatRelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "sin lavados" for null', () => {
    expect(formatRelativeDate(null)).toBe('sin lavados');
  });

  it('returns "hoy" for same day', () => {
    expect(formatRelativeDate(new Date('2026-09-10T08:00:00Z'))).toBe('hoy');
  });

  it('returns "ayer" for 1 day ago', () => {
    expect(formatRelativeDate(new Date('2026-09-09T12:00:00Z'))).toBe('ayer');
  });

  it('returns "hace N días" for 2-6 days', () => {
    expect(formatRelativeDate(new Date('2026-09-07T12:00:00Z'))).toBe('hace 3 días');
  });

  it('returns "hace N semanas" for 7-29 days', () => {
    expect(formatRelativeDate(new Date('2026-08-27T12:00:00Z'))).toBe('hace 2 semanas');
  });

  it('returns "hace N meses" for 30-364 days', () => {
    expect(formatRelativeDate(new Date('2026-07-10T12:00:00Z'))).toBe('hace 2 meses');
  });

  it('returns "hace más de un año" for > 365 days', () => {
    expect(formatRelativeDate(new Date('2025-09-09T12:00:00Z'))).toBe('hace más de un año');
  });
});
