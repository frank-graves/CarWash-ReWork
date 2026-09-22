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
    <section class={`${styles.card} ${styles.soonCard}`}>
      {/* Reloj: lo único que esta pantalla promete es tiempo. */}
      <svg
        class={styles.soonGlyph}
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>

      <h2 class={styles.soonTitle}>{copy?.title ?? 'En construcción'}</h2>

      <p class={styles.soonText}>
        Próximamente —{' '}
        {copy?.description ??
          'esta vista todavía no está construida. El dato ya está en Firestore: falta la pantalla.'}
      </p>

      <span class={`${styles.badge} ${styles.badgeMuted} ${styles.soonBadge}`}>en desarrollo</span>
    </section>
  );
}
