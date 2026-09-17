import { signal } from '@preact/signals';

/** Fase actual de la aplicación. Null durante el arranque inicial. */
export type AppPhase = 'wizard' | 'enroll' | 'unlock' | 'app';
export const appPhase = signal<AppPhase | null>(null);
