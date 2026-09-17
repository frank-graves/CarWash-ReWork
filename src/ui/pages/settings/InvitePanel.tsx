// src/ui/pages/settings/InvitePanel.tsx
// Genera códigos de conexión para enrolar tablets nuevas. El paquete se muestra
// UNA vez y no se guarda en claro en ningún sitio: ni en localStorage, ni en el
// doc de Firestore. Si el dueño lo pierde antes de compartirlo, genera otro.

import { useSignal, useSignalEffect } from '@preact/signals';
import { InviteRepository } from '@infra/invite-repository';
import { Vault } from '@infra/vault';
import { translateError } from '@ui/i18n/es';
import type { InviteDocument, OperatorRole } from '@core/types';
import type { FirebaseRuntime } from '@infra/firebase-bootstrap';
import styles from './InvitePanel.module.css';

interface Props {
  runtime: FirebaseRuntime;
  workspaceId: string;
  currentRole: OperatorRole;
}

/** Cuánto le queda de vida al invite, en el idioma del operador. */
function expiresIn(date: Date): string {
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return 'expirado';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function InvitePanel({ runtime, workspaceId, currentRole }: Props) {
  const isOpen = useSignal(false);
  const targetRole = useSignal<'admin' | 'staff'>('staff');
  const generated = useSignal<{ packageString: string; expiresAt: Date } | null>(null);
  const error = useSignal('');
  const busy = useSignal(false);
  const activeInvites = useSignal<InviteDocument[]>([]);
  const copied = useSignal(false);

  useSignalEffect(() => {
    const repo = new InviteRepository(runtime, workspaceId);
    repo.listActive()
      .then((list) => { activeInvites.value = list; })
      // Silencioso a propósito: la lista de pendientes es información secundaria y
      // un fallo de red aquí no debe tapar el botón de generar.
      .catch(() => undefined);
  });

  const handleGenerate = async () => {
    busy.value = true;
    error.value = '';
    try {
      const code = Vault.generateInviteCode();
      const blob = await Vault.createInviteBlob(code);
      const inviteId = crypto.randomUUID();
      const createdBy = runtime.auth.currentUser?.uid;
      if (!createdBy) throw new Error('Sin usuario autenticado');

      const inviteRepo = new InviteRepository(runtime, workspaceId);
      await inviteRepo.create({
        inviteId,
        blobInvite: blob.blobInvite,
        inviteSalt: blob.inviteSalt,
        ivInvite: blob.ivInvite,
        targetRole: targetRole.value,
        createdBy,
        expiresInHours: 24,
      });

      generated.value = {
        packageString: `ECW.${workspaceId}.${inviteId}.${code}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      };
      isOpen.value = false;
      activeInvites.value = await inviteRepo.listActive();
    } catch (e) {
      error.value = translateError(e);
    } finally {
      busy.value = false;
    }
  };

  const handleCopy = async () => {
    const gen = generated.value;
    if (!gen) return;
    try {
      await navigator.clipboard.writeText(gen.packageString);
      copied.value = true;
      window.setTimeout(() => { copied.value = false; }, 1800);
    } catch {
      // Clipboard bloqueado (contexto no seguro, permisos): el texto está en
      // pantalla y es seleccionable, así que el operador puede copiarlo a mano.
      error.value = 'No se pudo copiar automáticamente. Seleccionalo y copialo a mano.';
    }
  };

  const handleDelete = async (inviteId: string) => {
    try {
      const repo = new InviteRepository(runtime, workspaceId);
      await repo.delete(inviteId);
      activeInvites.value = await repo.listActive();
    } catch (e) {
      error.value = translateError(e);
    }
  };

  return (
    <div class={styles.panel}>
      <hr class={styles.divider} />

      {!isOpen.value && !generated.value && (
        <button
          type="button"
          class={styles.generateBtn}
          onClick={() => { isOpen.value = true; error.value = ''; }}
        >
          + Generar código de conexión
        </button>
      )}

      {isOpen.value && !generated.value && (
        <div class={styles.form}>
          <label class={styles.fieldLabel}>
            Rol del nuevo dispositivo
            <select
              class={styles.roleSelect}
              value={targetRole.value}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === 'admin' || v === 'staff') targetRole.value = v;
              }}
            >
              {currentRole === 'owner' && <option value="admin">Admin</option>}
              <option value="staff">Staff</option>
            </select>
          </label>
          {error.value && <p class={styles.error}>{error.value}</p>}
          <div class={styles.formActions}>
            <button
              type="button"
              class={styles.btnSecondary}
              onClick={() => { isOpen.value = false; error.value = ''; }}
              disabled={busy.value}
            >
              Cancelar
            </button>
            <button
              type="button"
              class={styles.btnPrimary}
              onClick={handleGenerate}
              disabled={busy.value}
            >
              {busy.value ? 'Generando…' : 'Generar'}
            </button>
          </div>
        </div>
      )}

      {generated.value && (
        <div class={styles.codeReveal}>
          <p class={styles.warn}>Este código se muestra UNA sola vez. Guardalo ahora.</p>
          <div class={styles.codeText}>{generated.value.packageString}</div>
          <div class={styles.codeActions}>
            <button type="button" class={styles.btnSecondary} onClick={handleCopy}>
              {copied.value ? 'Copiado' : 'Copiar'}
            </button>
            <span class={styles.expiresIn}>
              Expira en {expiresIn(generated.value.expiresAt)}
            </span>
          </div>
          <button
            type="button"
            class={styles.btnPrimary}
            onClick={() => { generated.value = null; targetRole.value = 'staff'; }}
          >
            Ya lo compartí
          </button>
        </div>
      )}

      {activeInvites.value.length > 0 && (
        <>
          <p class={styles.listLabel}>Códigos pendientes</p>
          <ul class={styles.list}>
            {activeInvites.value.map((inv) => (
              <li key={inv.inviteId} class={styles.item}>
                <span>
                  <strong>{inv.targetRole}</strong>
                  <span class={styles.itemMeta}>
                    {' · '}expira en {expiresIn(inv.expiresAt.toDate())}
                  </span>
                </span>
                <button
                  type="button"
                  class={styles.deleteBtn}
                  onClick={() => { void handleDelete(inv.inviteId); }}
                  aria-label={`Eliminar invite de ${inv.targetRole}`}
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error.value && generated.value === null && !isOpen.value && (
        <p class={styles.error}>{error.value}</p>
      )}
    </div>
  );
}
