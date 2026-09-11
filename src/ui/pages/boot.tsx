import { render } from 'preact';
import { effect } from '@preact/signals';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { Vault } from '@infra/vault';
import { appPhase } from '@ui/appState';
import { AppShell } from '@ui/pages/AppShell';
import { BootstrapWizard } from '@ui/pages/bootstrap/BootstrapWizard';
import { UnlockScreen } from '@ui/pages/unlock/UnlockScreen';
import { translateError } from '@ui/i18n/es';
import { applyTheme, readStoredTheme } from '@ui/theme';
import styles from './boot.module.css';

function FaultState({ title, detail }: { title: string; detail: string }) {
  return (
    <div class={styles.fault}>
      <h1 class={styles.faultTitle}>{title}</h1>
      <p class={styles.faultDetail}>{detail}</p>
      <p class={styles.faultHint}>
        Si el error habla de configuración, revisa las variables <code>PUBLIC_FIREBASE_*</code> del
        entorno y recarga la página.
      </p>
    </div>
  );
}

function renderPhase(root: HTMLElement, phase: 'wizard' | 'unlock' | 'app'): void {
  if (phase === 'wizard') render(<BootstrapWizard />, root);
  else if (phase === 'unlock') render(<UnlockScreen />, root);
  else render(<AppShell />, root);
}

export async function mountApp(root: HTMLElement): Promise<void> {
  // El tema guardado se aplica antes del primer render: sin esto, la preferencia
  // del operador solo existiría hasta que recargara, y la tablet arrancaría con el
  // tema del sistema hasta que alguien volviera a tocar el selector.
  applyTheme(readStoredTheme());

  try {
    await bootstrapFirebase();
  } catch (thrown) {
    render(
      <FaultState title="Sin conexión con la base de datos" detail={translateError(thrown)} />,
      root,
    );
    return;
  }

  let deviceReady = false;
  try {
    deviceReady = await Vault.isDeviceInitialized();
  } catch (thrown) {
    render(<FaultState title="La bóveda no responde" detail={translateError(thrown)} />, root);
    return;
  }

  // Re-render reactivo: cada transición de fase sustituye el árbol de
  // componentes SIN recargar la página. Recargar mataba la Master Key en
  // RAM y provocaba un loop infinito en unlock.
  effect(() => {
    const phase = appPhase.value;
    if (phase !== null) renderPhase(root, phase);
  });

  if (!deviceReady) appPhase.value = 'wizard';
  else if (!Vault.isUnlocked()) appPhase.value = 'unlock';
  else appPhase.value = 'app';
}
