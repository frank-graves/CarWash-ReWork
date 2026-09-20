// src/ui/pages/panel/DashboardShell.tsx
// El shell de gestión. Vive en `/panel`, comparte bóveda, PIN y rules con `/`,
// y existe solo para owner y admin: el mostrador no entra aquí.
//
// La navegación es de un solo nivel y sin router: `activeView` es un signal y
// el contenido se cambia con un condicional. Para un puñado de vistas en una
// tablet, un router con historial sería un árbol de dependencias a cambio de
// nada que el operador note.

import { signal, useSignalEffect } from '@preact/signals';
import type { ComponentChild } from 'preact';
import { doc, getDoc } from 'firebase/firestore';
import { bootstrapFirebase, type FirebaseRuntime } from '@infra/firebase-bootstrap';
import { OperatorRepository } from '@infra/operator-repository';
import { Vault } from '@infra/vault';
import { appPhase } from '@ui/appState';
import { applyTheme, cycleTheme, readStoredTheme, type Theme } from '@ui/theme';
import type { OperatorRole } from '@core/types';
import { HistoryPage } from '@ui/pages/history/HistoryPage';
import { ResumenView } from './ResumenView';
import { ComingSoonView } from './ComingSoonView';
import styles from './DashboardShell.module.css';

type View =
  | 'resumen'
  | 'historial'
  | 'rendimiento'
  | 'servicios'
  | 'pagos'
  | 'lealtad'
  | 'inventario'
  | 'alertas';

const activeView = signal<View>('resumen');
const businessName = signal('Cargando…');
const operatorName = signal('Cargando…');
const currentRole = signal<OperatorRole | null>(null);
const theme = signal<Theme>(readStoredTheme());
const trouble = signal('');

// Runtime y workspace se guardan en signals de módulo, no en props del shell:
// el shell no los usa para pintar la cabecera, pero `ResumenView` los necesita
// para suscribirse al ledger, y pasarlos por JSX encadenaría dos re-renders por
// cada snapshot que llega de Firestore.
const runtime = signal<FirebaseRuntime | null>(null);
const workspaceId = signal<string | null>(null);

const VIEW_GROUPS: readonly {
  label: string;
  items: readonly { id: View; label: string; comingSoon: boolean }[];
}[] = [
  {
    label: 'Operación',
    items: [
      { id: 'resumen', label: 'Resumen', comingSoon: false },
      { id: 'historial', label: 'Historial', comingSoon: false },
    ],
  },
  {
    label: 'Métricas',
    items: [
      { id: 'rendimiento', label: 'Rendimiento', comingSoon: true },
      { id: 'servicios', label: 'Servicios', comingSoon: true },
      { id: 'pagos', label: 'Pagos', comingSoon: true },
    ],
  },
  {
    label: 'Clientes',
    items: [{ id: 'lealtad', label: 'Lealtad', comingSoon: true }],
  },
  {
    label: 'Almacén',
    items: [
      { id: 'inventario', label: 'Inventario', comingSoon: true },
      { id: 'alertas', label: 'Alertas', comingSoon: true },
    ],
  },
];

// Cada vista trae su propio dibujo. Son 16×16 con stroke heredado del color del
// item, así que el estado activo los pinta sin una sola regla extra.
const VIEW_ICONS: Record<View, () => ComponentChild> = {
  resumen: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  ),
  historial: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 4 4 5-7" />
    </svg>
  ),
  rendimiento: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  servicios: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
      <circle cx="6.5" cy="16.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  ),
  pagos: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M2 10h20" />
    </svg>
  ),
  lealtad: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  inventario: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  alertas: () => (
    <svg class={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

const VIEW_HINTS: Record<View, string> = {
  resumen: 'el día de hoy, de un vistazo',
  historial: 'todo el ledger, con filtros',
  rendimiento: 'lavadores y operadores · 7 días',
  servicios: 'vehículos, servicios y demanda cruzada',
  pagos: 'yape contra efectivo',
  lealtad: 'sellos, premios y riesgo de churn',
  inventario: 'insumos, stock y reposición',
  alertas: 'lo que pide atención hoy',
};

const VIEW_TITLES: Record<View, string> = {
  resumen: 'Resumen',
  historial: 'Historial',
  rendimiento: 'Rendimiento',
  servicios: 'Servicios & Vehículos',
  pagos: 'Métodos de pago',
  lealtad: 'Lealtad',
  inventario: 'Inventario',
  alertas: 'Alertas',
};

const ROLE_LABELS: Record<OperatorRole, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  staff: 'Staff',
};

/** AQ de "Ana Quispe"; con un solo nombre, la única inicial que hay. */
function initialsOf(fullName: string): string {
  const [first, second] = fullName.trim().split(/\s+/).filter(Boolean);
  if (!first) return '·';
  const marks = second ? first.charAt(0) + second.charAt(0) : first.charAt(0);
  return marks.toUpperCase();
}

export function DashboardShell() {
  useSignalEffect(() => {
    const load = async () => {
      // El estado vive en el módulo y sobrevive a los cambios de fase: sin
      // limpiarlo, el aviso de la sesión anterior seguiría en pantalla.
      trouble.value = '';
      try {
        const rt = await bootstrapFirebase();
        const uid = rt.auth.currentUser?.uid;
        const ws = await Vault.getWorkspaceId();

        // Sin uid ni workspace no hay a quién autorizar. Al mostrador.
        if (!uid || !ws) {
          window.location.href = '/';
          return;
        }

        const roster = await new OperatorRepository(rt, ws).listAll();
        const me = roster.find((operator) => operator.id === uid);

        // El panel es de gestión. Un staff que escriba /panel a mano vuelve a
        // la app de registro; el rol se decide aquí, no en el <script> de la
        // página, porque las rules son las que mandan y la UI solo las refleja.
        if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
          window.location.href = '/';
          return;
        }

        const workspace = await getDoc(doc(rt.db, 'workspaces', ws));

        runtime.value = rt;
        workspaceId.value = ws;
        currentRole.value = me.role;
        operatorName.value = me.displayName;
        businessName.value = workspace.exists()
          ? (workspace.data() as { name: string }).name
          : 'Exclusivo Car Wash';
        document.title = 'Exclusivo Car Wash — Panel';
      } catch {
        // Un fallo de red no debe dejar el panel en blanco sin decir por qué.
        trouble.value = 'Sin conexión con el servidor';
        operatorName.value = '—';
      }
    };
    void load();
  });

  const handleThemeToggle = () => {
    const next = cycleTheme(theme.value);
    applyTheme(next);
    theme.value = next;
  };

  const handleLock = () => {
    Vault.lock();
    // Mismo pacto que en AppShell: el signal de fase es compartido, así que
    // bloquear aquí lleva a UnlockScreen y desbloquear devuelve al panel.
    appPhase.value = 'unlock';
  };

  const openRegister = () => {
    window.location.href = '/';
  };

  // Nada se pinta hasta saber el rol: un panel a medio construir que después se
  // convierte en un redirect es peor que un segundo de "verificando".
  if (currentRole.value === null) {
    return (
      <div class={styles.gate}>
        <span class={styles.gateMark}>ECW</span>
        <p class={styles.gateText}>{trouble.value || 'Verificando acceso al panel…'}</p>
      </div>
    );
  }

  const role = currentRole.value;

  return (
    <div class={styles.app}>
      <aside class={styles.sidebar}>
        <div class={styles.sidebarBrand}>
          <div class={styles.brandName}>
            <span class={styles.brandDot}>ECW</span>
            {businessName.value}
          </div>
          <div class={styles.brandSub}>Plataforma · v0.0.1</div>
        </div>

        {VIEW_GROUPS.map((group) => (
          <nav key={group.label} class={styles.navSection} aria-label={group.label}>
            <span class={styles.navLabel}>{group.label}</span>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                class={
                  activeView.value === item.id
                    ? `${styles.navItem} ${styles.navItemActive}`
                    : styles.navItem
                }
                aria-current={activeView.value === item.id ? 'page' : undefined}
                onClick={() => {
                  activeView.value = item.id;
                }}
              >
                {VIEW_ICONS[item.id]()}
                {item.label}
                {item.comingSoon && <span class={`${styles.navBadge} ${styles.navBadgeMuted}`}>soon</span>}
              </button>
            ))}
          </nav>
        ))}

        <div class={styles.sidebarFoot}>
          <div class={styles.operatorChip}>
            <span class={styles.avatar}>{initialsOf(operatorName.value)}</span>
            <div class={styles.operatorMeta}>
              <span class={styles.operatorName}>{operatorName.value}</span>
              <span class={styles.operatorRole}>{ROLE_LABELS[role]}</span>
            </div>
          </div>
          <button
            type="button"
            class={styles.iconBtn}
            onClick={handleThemeToggle}
            aria-label={`Cambiar tema. Actual: ${theme.value}`}
            title="Cambiar tema"
          >
            {theme.value === 'light' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            )}
            {theme.value === 'dark' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            {theme.value === 'system' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3v18M3 12h18" />
              </svg>
            )}
          </button>
          <button
            type="button"
            class={styles.iconBtn}
            onClick={handleLock}
            aria-label="Bloquear"
            title="Bloquear"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
        </div>
      </aside>

      <div class={styles.mainArea}>
        <header class={styles.topbar}>
          <div class={styles.topbarLeft}>
            <span class={styles.topbarTitle}>{VIEW_TITLES[activeView.value]}</span>
            <span class={styles.topbarSub}>{VIEW_HINTS[activeView.value]}</span>
          </div>
          <div class={styles.topbarActions}>
            <button type="button" class={styles.actionBtn} onClick={openRegister}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Registrar lavado
            </button>
          </div>
        </header>

        {trouble.value && <p class={styles.trouble}>{trouble.value}</p>}

        <main class={styles.content}>
          {activeView.value === 'resumen' && runtime.value && workspaceId.value && (
            <ResumenView runtime={runtime.value} workspaceId={workspaceId.value} />
          )}
          {activeView.value === 'historial' && <HistoryPage viewerRole={currentRole.value} />}
          {activeView.value !== 'resumen' && activeView.value !== 'historial' && (
            <ComingSoonView viewId={activeView.value} />
          )}
        </main>
      </div>
    </div>
  );
}
