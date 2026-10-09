import { render } from 'preact';
import { effect } from '@preact/signals';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { Vault } from '@infra/vault';
import { appPhase } from '@ui/appState';
import { AppShell } from '@ui/pages/AppShell';
import { DashboardShell } from '@ui/pages/panel/DashboardShell';
import { BootstrapWizard } from '@ui/pages/bootstrap/BootstrapWizard';
import { EnrollmentWizard } from '@ui/pages/enroll/EnrollmentWizard';
import { UnlockScreen } from '@ui/pages/unlock/UnlockScreen';
import { translateError } from '@ui/i18n/es';
import { applyTheme, readStoredTheme } from '@ui/theme';
import styles from './boot.module.css';

/** Qué shell se pinta cuando la fase es 'app'. */
type ShellMode = 'staff' | 'panel';

declare global {
  interface Window {
    __ecwHideSplash?: () => void;
  }
}

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

function renderPhase(
  root: HTMLElement,
  phase: 'wizard' | 'enroll' | 'unlock' | 'app',
  mode: ShellMode,
): void {
  if (phase === 'wizard') render(<BootstrapWizard />, root);
  else if (phase === 'enroll') render(<EnrollmentWizard />, root);
  else if (phase === 'unlock') render(<UnlockScreen />, root);
  else if (mode === 'panel') render(<DashboardShell />, root);
  else render(<AppShell />, root);
}

// Un frame de espera para que el render que acabamos de pedir llegue al DOM:
// sin él, el splash se va antes de que haya nada debajo y se ve el flash que
// venía a tapar. Si el navegador no trae rAF (nadie, hoy), el fallback directo.
function liftSplash(): void {
  const go = () => window.__ecwHideSplash?.();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  else go();
}

// Aviso de último recurso. HTML crudo a propósito, sin clases ni imports del
// sistema de diseño: el fallo típico (un chunk que desapareció tras un deploy)
// significa que los CSS/JS del bundle tampoco están, así que este bloque tiene
// que verse igual sin ellos.
function renderBootFallback(root: HTMLElement): void {
  root.innerHTML =
    '<div style="padding:2rem;font-family:system-ui;text-align:center">' +
    '<p>No se pudo abrir la app.</p>' +
    '<p style="font-size:.875rem;color:#666">Probá recargar. Si el problema sigue, borrá los datos del sitio.</p>' +
    '<button onclick="location.reload()">Recargar</button>' +
    '</div>';
}

// `mountApp` solo blinda el arranque: si algo revienta fuera de los errores ya
// previstos (bootstrap, bóveda), la pantalla no queda en negro y cae al aviso.
export async function mountApp(root: HTMLElement, mode: ShellMode = 'staff'): Promise<void> {
  try {
    await runBoot(root, mode);
  } catch {
    renderBootFallback(root);
    liftSplash();
  }
}

async function runBoot(root: HTMLElement, mode: ShellMode = 'staff'): Promise<void> {
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
    // El aviso de avería vive debajo del splash: retirarlo también aquí, o el
    // operador se queda cinco segundos mirando un logo sobre una app rota.
    liftSplash();
    return;
  }

  let deviceReady = false;
  try {
    deviceReady = await Vault.isDeviceInitialized();
  } catch (thrown) {
    render(<FaultState title="La bóveda no responde" detail={translateError(thrown)} />, root);
    liftSplash();
    return;
  }

  // /panel monta el mismo trío bóveda-PIN-rules, pero no sabe crear una bóveda:
  // no tiene wizard ni enrollment. Un dispositivo vacío que entre directo al
  // panel va a la raíz, donde el ritual sí existe de principio a fin.
  if (mode === 'panel' && !deviceReady) {
    window.location.href = '/';
    return;
  }

  // Re-render reactivo: cada transición de fase sustituye el árbol de
  // componentes SIN recargar la página. Recargar mataba la Master Key en
  // RAM y provocaba un loop infinito en unlock. El modo viaja en la closure,
  // así que bloquear desde el panel lleva a ESTE UnlockScreen y desbloquear
  // devuelve al panel: `appPhase` es el mismo signal para los dos shells.
  effect(() => {
    const phase = appPhase.value;
    if (phase !== null) renderPhase(root, phase, mode);
  });

  if (!deviceReady) appPhase.value = 'wizard';
  else if (!Vault.isUnlocked()) appPhase.value = 'unlock';
  else appPhase.value = 'app';

  liftSplash();
}
