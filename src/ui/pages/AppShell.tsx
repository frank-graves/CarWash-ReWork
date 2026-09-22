// src/ui/pages/AppShell.tsx
import { signal, useSignalEffect } from '@preact/signals';
import { doc, getDoc } from 'firebase/firestore';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { OperatorRepository } from '@infra/operator-repository';
import { Vault } from '@infra/vault';
import { appPhase } from '@ui/appState';
import { applyTheme, cycleTheme, readStoredTheme, type Theme } from '@ui/theme';
import type { OperatorRole, OperatorView } from '@core/types';
import { WashRegistrationPage } from './wash/WashRegistrationPage';
import { CustomersPage } from './customers/CustomersPage';
import { HistoryPage } from './history/HistoryPage';
import { SettingsPage } from './settings/SettingsPage';
import styles from './AppShell.module.css';

type Tab = 'wash' | 'customers' | 'history' | 'settings';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'wash', label: 'Registrar lavado' },
  { id: 'customers', label: 'Clientes' },
  { id: 'history', label: 'Historial' },
  { id: 'settings', label: 'Ajustes' },
];

const activeTab = signal<Tab>('wash');
const businessName = signal('Cargando…');
const operatorName = signal('Cargando…');
const trouble = signal('');
const currentRole = signal<OperatorRole | null>(null);
const theme = signal<Theme>(readStoredTheme());

// Caché del roster para la pantalla de al lado. El panel (/panel) descifra los
// operadores en su propio arranque; si el roster ya está en RAM en esta carga de
// página, no se vuelve a pedir ni a descifrar. Nunca hay dos shells montados a
// la vez, así que la caché solo puede estar fría o ser la de este dispositivo.
export const operatorsCache = signal<OperatorView[] | null>(null);

export function AppShell() {
  useSignalEffect(() => {
    const load = async () => {
      // El estado del módulo sobrevive a los cambios de fase, así que un aviso de
      // error de la sesión anterior seguiría en pantalla después de reconectar.
      trouble.value = '';
      try {
        const runtime = await bootstrapFirebase();
        const uid = runtime.auth.currentUser?.uid;
        const workspaceId = await Vault.getWorkspaceId();
        if (!uid || !workspaceId) return;

        // El documento del workspace y el roster de operadores son dos consultas
        // independientes: en serie eran dos idas y vueltas a Firestore con la
        // tablet esperando de brazos cruzados. En paralelo, una.
        const operatorRepo = new OperatorRepository(runtime, workspaceId);
        const [workspace, operators] = await Promise.all([
          getDoc(doc(runtime.db, 'workspaces', workspaceId)),
          operatorRepo.listAll(),
        ]);

        if (!workspace.exists()) {
          // Bootstrap incompleto: la bóveda local existe pero la nube no tiene
          // el documento del workspace. Es el estado trampa del wizard interrumpido.
          // Wipeamos y devolvemos la app al wizard, sin recargar la página.
          await Vault.wipeDevice();
          appPhase.value = 'wizard';
          return;
        }
        businessName.value = (workspace.data() as { name: string }).name;
        operatorsCache.value = operators;

        const me = operators.find((operator) => operator.id === uid);
        if (me) {
          operatorName.value = me.displayName;
          currentRole.value = me.role;
        } else {
          operatorName.value = 'Operador sin registrar';
          currentRole.value = null;
        }

        // Migración v2 → v4 del operador activo. Va al final y no al principio:
        // necesita el doc del operador que `listAll` acaba de traer, y es no-op
        // la mayoría de las veces (el guard corta con solo leer `rolePublic`).
        // Así la cabecera se pinta antes de que termine la escritura.
        await operatorRepo.migrateLegacyRole();
      } catch {
        // El shell se pinta igual: el operador puede registrar lavados aunque la
        // cabecera no cargue. Un fallo de red no debe dejar la caja cerrada.
        trouble.value = 'Sin conexión con el servidor';
        businessName.value = 'Sin conexión';
        operatorName.value = '—';
      }
    };
    void load();
  });

  const handleLock = () => {
    Vault.lock();
    // La clave en RAM muere con la sesión y volvemos a la puerta cambiando de fase.
    // Recargar la página haría lo mismo pero tirando también la Master Key recién
    // introducida, que era el bucle del que salíamos.
    appPhase.value = 'unlock';
  };

  const handleThemeToggle = () => {
    const next = cycleTheme(theme.value);
    applyTheme(next);
    theme.value = next;
  };

  // Ajustes solo existe para owner y admin: el resto del equipo no tiene por qué
  // tocar precios, lavadores ni el PIN del dispositivo. Quién puede cambiar QUÉ
  // dentro de Ajustes lo decide la propia página con su rol.
  const isManager = currentRole.value === 'owner' || currentRole.value === 'admin';
  const visibleTabs = TABS.filter((tab) => (tab.id === 'settings' ? isManager : true));

  return (
    <div class={styles.shell}>
      <header class={styles.header}>
        <div class={styles.headerLeft}>
          <h1 class={styles.businessName}>{businessName.value}</h1>
          <span class={styles.operator}>{operatorName.value}</span>
        </div>
        <div class={styles.headerRight}>
          <button
            type="button"
            class={styles.themeBtn}
            onClick={handleThemeToggle}
            aria-label={`Cambiar tema. Actual: ${theme.value}`}
          >
            {theme.value === 'light' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            )}
            {theme.value === 'dark' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            {theme.value === 'system' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3v18M3 12h18" />
              </svg>
            )}
          </button>
          <button type="button" class={styles.lockBtn} onClick={handleLock}>
            Bloquear
          </button>
        </div>
      </header>

      {trouble.value && <p class={styles.trouble}>{trouble.value}</p>}

      <nav class={styles.nav} aria-label="Secciones">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            class={activeTab.value === tab.id ? `${styles.tab} ${styles.active}` : styles.tab}
            aria-current={activeTab.value === tab.id ? 'page' : undefined}
            onClick={() => { activeTab.value = tab.id; }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main class={styles.content}>
        {activeTab.value === 'wash' && <WashRegistrationPage />}
        {activeTab.value === 'customers' && <CustomersPage />}
        {activeTab.value === 'history' && <HistoryPage />}
        {activeTab.value === 'settings' && isManager && currentRole.value !== null && (
          <SettingsPage currentRole={currentRole.value} />
        )}
      </main>
    </div>
  );
}
