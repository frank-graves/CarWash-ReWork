// src/ui/pages/panel/ComingSoonView.tsx
// El cartel de las vistas que todavía no existen.
//
// Existe para que la navegación del panel no tenga puertas que llevan a la nada:
// un item que se puede pulsar y no responde es peor que un item que dice, con
// todas las letras, qué va a haber ahí y para qué sirve.

import styles from './DashboardShell.module.css';

interface Props {
  viewId: string;
}

const COPY: Record<string, { title: string; description: string }> = {
  rendimiento: {
    title: 'Rendimiento',
    description:
      'Lavados e ingresos por lavador y operador, con la nómina estimada de la semana.',
  },
  servicios: {
    title: 'Servicios & Vehículos',
    description:
      'Ingresos por vehículo y servicio, con la matriz de demanda cruzada.',
  },
  pagos: {
    title: 'Métodos de pago',
    description: 'Proporción Yape vs efectivo y conciliación de caja diaria.',
  },
  lealtad: {
    title: 'Lealtad',
    description:
      'Clientes con 6 sellos, a un paso, y detección de clientes en riesgo de churn.',
  },
  inventario: {
    title: 'Inventario',
    description: 'Insumos, stock actual y umbrales de reposición automática.',
  },
  alertas: {
    title: 'Alertas',
    description:
      'Inventario crítico, clientes en riesgo y avisos operativos del día.',
  },
};

export function ComingSoonView({ viewId }: Props) {
  const copy = COPY[viewId];

  return (
    <section class={styles.soon}>
      <span class={styles.soonIcon} aria-hidden="true">
        {/* Reloj de arena: lo único que esta pantalla promete es tiempo. */}
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M6 2h12M6 22h12" />
          <path d="M6 2v4a6 6 0 0 0 6 6 6 6 0 0 0 6-6V2" />
          <path d="M6 22v-4a6 6 0 0 1 6-6 6 6 0 0 1 6 6v4" />
        </svg>
      </span>

      <span class={`${styles.badge} ${styles.badgeAccent}`}>Próximamente</span>

      <h2 class={styles.soonTitle}>{copy?.title ?? 'En construcción'}</h2>

      <p class={styles.soonText}>
        {copy?.description ??
          'Esta vista todavía no está construida. El dato ya está en Firestore: falta la pantalla.'}
      </p>
    </section>
  );
}
