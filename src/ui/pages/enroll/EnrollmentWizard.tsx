// src/ui/pages/enroll/EnrollmentWizard.tsx
// El otro camino del arranque: esta tablet no forja la bóveda, se une a la que ya
// existe. Necesita el paquete de conexión (workspaceId + inviteId + code), un PIN
// local nuevo y un nombre para el historial.
//
// Un dispositivo enrolado NO tiene frase de recuperación: eso se avisa aquí
// arriba, antes de que escriba el PIN, y no después.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { InviteRepository } from '@infra/invite-repository';
import { OperatorRepository } from '@infra/operator-repository';
import { Vault } from '@infra/vault';
import { appPhase } from '@ui/appState';
import { PinPad } from '@ui/components/PinPad';
import { translateError } from '@ui/i18n/es';
import styles from './EnrollmentWizard.module.css';

type Stage = 'code' | 'identity' | 'working';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_SHAPE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const PIN_LENGTH = 6;

interface ParsedPackage {
  workspaceId: string;
  inviteId: string;
  code: string;
}

/**
 * El paquete llega como `ECW.<workspaceId>.<inviteId>.<code>`. Se parte por
 * puntos y se valida cada pieza por forma: un pegado a medias se detecta aquí,
 * con un mensaje que dice qué falta, en vez de fallar tres pantallas después.
 */
function parsePackage(raw: string): ParsedPackage | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 4) return null;
  const [prefix, workspaceId, inviteId, code] = parts;
  if (prefix !== 'ECW') return null;
  if (!workspaceId || !UUID.test(workspaceId)) return null;
  if (!inviteId || !UUID.test(inviteId)) return null;
  if (!code || !CODE_SHAPE.test(code)) return null;
  return { workspaceId, inviteId, code };
}

const stage = signal<Stage>('code');
const rawPackage = signal('');
const parsedPackage = signal<ParsedPackage | null>(null);
const displayName = signal('');
const pin = signal('');
const confirmPin = signal('');
const error = signal('');
const isWorking = signal(false);

export function EnrollmentWizard() {
  // Igual que el wizard de bootstrap: el estado vive en el módulo y sobrevive al
  // remonte, así que cada montaje limpia lo suyo. Un nombre o un PIN de la sesión
  // anterior en pantalla sería una fuga silenciosa.
  useEffect(() => {
    stage.value = 'code';
    rawPackage.value = '';
    parsedPackage.value = null;
    displayName.value = '';
    pin.value = '';
    confirmPin.value = '';
    error.value = '';
    isWorking.value = false;
  }, []);

  const submitCode = () => {
    const parsed = parsePackage(rawPackage.value);
    if (!parsed) {
      error.value = 'Esto no parece un código de conexión. Copialo entero, desde ECW.';
      return;
    }
    error.value = '';
    parsedPackage.value = parsed;
    stage.value = 'identity';
  };

  const enroll = async (): Promise<void> => {
    const parsed = parsedPackage.value;
    if (!parsed) return;

    try {
      const runtime = await bootstrapFirebase();
      const inviteRepo = new InviteRepository(runtime, parsed.workspaceId);
      // El invite se lee ANTES de tocar la bóveda: si expiró o ya se usó, el
      // dispositivo queda como estaba y no hay nada que deshacer.
      const invite = await inviteRepo.getById(parsed.inviteId);

      await Vault.enrollFromInvite({
        workspaceId: parsed.workspaceId,
        blobInvite: invite.blobInvite,
        inviteSalt: invite.inviteSalt,
        ivInvite: invite.ivInvite,
        code: parsed.code,
        newPin: pin.value,
      });

      await new OperatorRepository(runtime, parsed.workspaceId)
        .ensureBootstrap(displayName.value.trim(), invite.targetRole, parsed.inviteId);

      // El invite es de un solo uso, pero borrarlo exige ser owner/admin: si este
      // dispositivo entra como staff, la regla lo rechaza y lo limpia un dueño.
      inviteRepo.delete(parsed.inviteId).catch(() => undefined);

      appPhase.value = 'app';
    } catch (thrown) {
      // Rollback duro. Si `enrollFromInvite` funcionó y lo que falló fue el alta
      // del operador, este dispositivo tiene bóveda y workspaceId pero no doc en
      // `operators/`: en el próximo arranque el shell lo pinta como "Operador sin
      // registrar" y no habría forma de reintentar. Mejor volver a cero.
      await Vault.wipeDevice().catch(() => undefined);
      error.value = translateError(thrown);
      stage.value = 'code';
      // Sin esto el botón "Unirme" queda deshabilitado para siempre tras el primer
      // fallo: `isWorking` se puso en true al pasar a 'working' y nadie lo bajaba.
      isWorking.value = false;
    }
  };

  const submitIdentity = () => {
    if (displayName.value.trim().length < 3) {
      error.value = 'Tu nombre necesita al menos 3 letras';
      return;
    }
    if (pin.value.length !== PIN_LENGTH) {
      error.value = 'El PIN son 6 dígitos';
      return;
    }
    if (pin.value !== confirmPin.value) {
      error.value = 'Los dos PINs no coinciden';
      return;
    }
    error.value = '';
    isWorking.value = true;
    stage.value = 'working';
    void enroll();
  };

  return (
    <div class={styles.wizard}>
      <header class={styles.header}>
        <h1 class={styles.title}>
          {stage.value === 'code'
            ? 'Unirme con un código'
            : stage.value === 'identity'
              ? 'Tus datos'
              : 'Uniendo…'}
        </h1>
        {stage.value === 'identity' && (
          <p class={styles.subtitle}>Últimos datos antes de entrar</p>
        )}
      </header>

      <div class={styles.content}>
        {stage.value === 'code' && (
          <div class={styles.step}>
            <label class={styles.label} for="paquete">
              Código de conexión
            </label>
            <textarea
              id="paquete"
              class={styles.textarea}
              placeholder="ECW.8f14e45f-ceea-467a-9c1a-2a1b3c4d5e6f.7b2c9d10-3f4a-4b5c-8d6e-1a2b3c4d5e6f.ABCD-EFGH-JKLM"
              value={rawPackage.value}
              spellcheck={false}
              autocomplete="off"
              onInput={(event) => {
                rawPackage.value = event.currentTarget.value;
              }}
            />
            <p class={styles.hint}>
              Te lo pasa un dueño del negocio. Son tres partes separadas por puntos:
              no hace falta que lo escribas a mano, pegalo entero.
            </p>
          </div>
        )}

        {stage.value === 'identity' && (
          <div class={styles.step}>
            <label class={styles.label} for="nombre-operador">
              Tu nombre
            </label>
            <input
              id="nombre-operador"
              class={styles.input}
              type="text"
              value={displayName.value}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => {
                displayName.value = event.currentTarget.value;
              }}
            />

            <PinPad value={pin} label="PIN local (6 dígitos)" />
            <PinPad value={confirmPin} label="Repite el PIN" />

            <div class={styles.warnBanner}>
              Este dispositivo no tendrá frase de recuperación. Si olvidás el PIN, vas a
              necesitar que un dueño te genere un código nuevo.
            </div>
          </div>
        )}

        {stage.value === 'working' && (
          <div class={styles.step}>
            <p class={styles.hint}>Cifrando tu bóveda local. Esto tarda unos segundos.</p>
          </div>
        )}

        {error.value && (
          <p class={styles.error} role="alert">
            {error.value}
          </p>
        )}
      </div>

      <div class={styles.actions}>
        {stage.value === 'code' && (
          <div class={styles.actionsRow}>
            {/* Sin esta salida, el que abrió "Unirme" por error quedaba encerrado
                aquí: el código se lo tiene que dar otro, y recargar la página es
                la clase de instrucción que nadie da por teléfono. */}
            <button
              type="button"
              class={styles.btnSecondary}
              onClick={() => {
                appPhase.value = 'wizard';
              }}
              disabled={isWorking.value}
            >
              Volver
            </button>
            <button
              type="button"
              class={styles.btn}
              onClick={submitCode}
              disabled={isWorking.value}
            >
              Continuar
            </button>
          </div>
        )}

        {stage.value === 'identity' && (
          <div class={styles.actionsRow}>
            <button
              type="button"
              class={styles.btnSecondary}
              onClick={() => {
                error.value = '';
                pin.value = '';
                confirmPin.value = '';
                stage.value = 'code';
              }}
              disabled={isWorking.value}
            >
              Volver
            </button>
            <button
              type="button"
              class={styles.btn}
              onClick={submitIdentity}
              disabled={isWorking.value}
            >
              Unirme
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
