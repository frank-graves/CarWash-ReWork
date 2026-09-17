// src/ui/pages/settings/SettingsPage.tsx
// Los ajustes del negocio, en una sola página y por secciones. Cada tarjeta es
// independiente: si una falla, las demás siguen funcionando.
//
// RECONSTRUCCIÓN: la versión de Qwen no llegó en el traspaso. Se ha reescrito a
// partir de lo conocido (useSignal en vez de signal —un `signal()` desnudo crea
// una instancia nueva en cada render—, sin el repositorio huérfano y sin el array
// SECTIONS, con las secciones en JSX). Sustitúyela por la original si reaparece.

import { useSignal, useSignalEffect } from '@preact/signals';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { Vault } from '@infra/vault';
import { ThemeToggle } from './ThemeToggle';
import { PricingEditor } from './PricingEditor';
import { PinChangeForm } from './PinChangeForm';
import { WasherManager } from './WasherManager';
import { OperatorList } from './OperatorList';
import { InvitePanel } from './InvitePanel';
import { ImportModal } from './ImportModal';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import type { OperatorRole } from '@core/types';
import styles from './SettingsPage.module.css';

interface Props {
  currentRole: OperatorRole;
}

export function SettingsPage({ currentRole }: Props) {
  const runtime = useSignal<FirebaseRuntime | null>(null);
  const workspaceId = useSignal<string | null>(null);
  const operatorId = useSignal<string | null>(null);
  const showImport = useSignal(false);

  useSignalEffect(() => {
    bootstrapFirebase().then(async (rt) => {
      runtime.value = rt;
      workspaceId.value = await Vault.getWorkspaceId();
      operatorId.value = rt.auth.currentUser?.uid ?? null;
    });
  });

  // Constantes locales: el editor de precios necesita los tres datos a la vez y
  // así el compilador no tiene que adivinar que ya están cargados.
  const rt = runtime.value;
  const ws = workspaceId.value;
  const op = operatorId.value;

  if (!rt || !ws || !op) {
    return <p class={styles.loading}>Cargando ajustes…</p>;
  }

  return (
    <div class={styles.page}>
      <section class={styles.card}>
        <h2 class={styles.sectionLabel}>Apariencia</h2>
        <p class={styles.sectionHint}>Tema visual de la aplicación.</p>
        <ThemeToggle />
      </section>

      <section class={styles.card}>
        <h2 class={styles.sectionLabel}>Precios</h2>
        <p class={styles.sectionHint}>Matriz de tarifas por vehículo y servicio.</p>
        <PricingEditor runtime={rt} workspaceId={ws} operatorId={op} />
      </section>

      <section class={styles.card}>
        <h2 class={styles.sectionLabel}>Seguridad</h2>
        <p class={styles.sectionHint}>Rotación del PIN de acceso al dispositivo.</p>
        <PinChangeForm />
      </section>

      <section class={styles.card}>
        <h2 class={styles.sectionLabel}>Lavadores</h2>
        <p class={styles.sectionHint}>
          Personas que lavan los autos. No necesitan acceso a la tablet.
        </p>
        <WasherManager runtime={rt} workspaceId={ws} />
      </section>

      <section class={styles.card}>
        <h2 class={styles.sectionLabel}>Equipo</h2>
        <p class={styles.sectionHint}>Operadores con acceso a esta tablet.</p>
        <OperatorList
          runtime={rt}
          workspaceId={ws}
          currentOperatorId={op}
          viewerRole={currentRole}
        />
        <InvitePanel runtime={rt} workspaceId={ws} currentRole={currentRole} />
      </section>

      <section class={styles.card}>
        <h2 class={styles.sectionLabel}>Importar histórico</h2>
        <p class={styles.sectionHint}>
          Cargar lavados registrados en papel o en otro sistema. Pegá un array
          JSON con las transacciones.
        </p>
        <button
          type="button"
          class={styles.importBtn}
          onClick={() => { showImport.value = true; }}
        >
          Abrir importador
        </button>
      </section>

      {showImport.value && (
        <ImportModal
          runtime={rt}
          workspaceId={ws}
          onClose={() => { showImport.value = false; }}
          onImported={() => { showImport.value = false; }}
        />
      )}
    </div>
  );
}
