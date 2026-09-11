// src/ui/pages/unlock/UnlockScreen.tsx
// La puerta. Un PIN de 6 dígitos, sin botón de confirmar: cuando entran los seis
// dígitos se intenta. Un toque menos, cada mañana, para siempre.
//
// La frase de recuperación vive detrás de un enlace discreto. No es una función que
// se use a diario y no debe parecerlo: la mitad del trabajo de esta pantalla es que
// nadie descubra el PIN mirando por encima del hombro.

import { signal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { Vault } from '@infra/vault';
import { appPhase } from '@ui/appState';
import { translateError } from '@ui/i18n/es';
import styles from './UnlockScreen.module.css';

const PIN_SLOTS = [0, 1, 2, 3, 4, 5] as const;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const pin = signal('');
const error = signal('');
const lockoutMs = signal(0);
const attempting = signal(false);
const showRecovery = signal(false);
const recPhrase = signal('');
const newPin = signal('');
const confirmNewPin = signal('');
const isWorking = signal(false);

export function UnlockScreen() {
  const attempt = async (candidate: string) => {
    attempting.value = true;
    error.value = '';
    try {
      await Vault.unlockWithPin(candidate);
      // Ya no recargamos: cambiamos de fase y el árbol se sustituye. Los dígitos se
      // borran antes de salir porque el estado vive en el módulo y sobreviviría al
      // remonte: con seis dígitos dentro, el disparo automático volvería a abrir la
      // puerta sola y "Bloquear" dejaría de bloquear.
      pin.value = '';
      appPhase.value = 'app';
    } catch (thrown) {
      error.value = translateError(thrown);
      pin.value = '';
      lockoutMs.value = await Vault.getLockoutRemainingMs();
    } finally {
      attempting.value = false;
    }
  };

  // Cada montaje empieza con la puerta cerrada y sin rastro del intento anterior.
  // Antes lo limpiaba el reload; ahora que la fase solo repinta, lo limpiamos aquí.
  // Va antes del disparo automático a propósito: el orden de los efectos decide
  // quién ve los seis dígitos viejos.
  useEffect(() => {
    pin.value = '';
    error.value = '';
    attempting.value = false;
    showRecovery.value = false;
    recPhrase.value = '';
    newPin.value = '';
    confirmNewPin.value = '';
    isWorking.value = false;
  }, []);

  // Disparo automático al sexto dígito. `attempting` se lee aquí a propósito:
  // así el propio intento rearma el efecto y nunca se dispara dos veces.
  useSignalEffect(() => {
    if (pin.value.length !== PIN_SLOTS.length || attempting.value || lockoutMs.value > 0) return;
    void attempt(pin.value);
  });

  // Un solo contador para toda la pantalla: el aviso de bloqueo se actualiza solo,
  // sin que el operador tenga que recargar para descubrir que ya puede entrar.
  useSignalEffect(() => {
    let alive = true;
    const tick = async () => {
      const remaining = await Vault.getLockoutRemainingMs();
      if (alive) lockoutMs.value = remaining;
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  });

  const phraseBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!showRecovery.value) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') showRecovery.value = false;
    };
    window.addEventListener('keydown', onKey);
    phraseBox.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [showRecovery.value]);

  const push = (digit: string) => {
    if (pin.value.length < PIN_SLOTS.length && lockoutMs.value === 0) pin.value += digit;
  };

  const pop = () => {
    pin.value = pin.value.slice(0, -1);
  };

  const openRecovery = () => {
    error.value = '';
    recPhrase.value = '';
    newPin.value = '';
    confirmNewPin.value = '';
    showRecovery.value = true;
  };

  const resetWithPhrase = async () => {
    if (recPhrase.value.trim().split(/\s+/).length !== 12) {
      error.value = 'La frase de recuperación son 12 palabras';
      return;
    }
    if (newPin.value.length !== PIN_SLOTS.length) {
      error.value = 'El PIN nuevo son 6 dígitos';
      return;
    }
    if (newPin.value !== confirmNewPin.value) {
      error.value = 'Los dos PINs nuevos no coinciden';
      return;
    }

    error.value = '';
    isWorking.value = true;
    try {
      await Vault.resetWithRecovery(recPhrase.value, newPin.value);
      // La frase, el PIN nuevo y el modal se van con la fase: no tienen por qué
      // quedarse ni en memoria ni en pantalla para el siguiente bloqueo.
      recPhrase.value = '';
      newPin.value = '';
      confirmNewPin.value = '';
      showRecovery.value = false;
      appPhase.value = 'app';
    } catch (thrown) {
      error.value = translateError(thrown);
      isWorking.value = false;
    }
  };

  const locked = lockoutMs.value > 0;

  return (
    <div class={styles.unlock}>
      <h1 class={styles.title}>Desbloquear</h1>

      <div class={styles.dots} aria-hidden="true">
        {PIN_SLOTS.map((slot) => (
          <div
            key={slot}
            class={slot < pin.value.length ? `${styles.dot} ${styles.filled}` : styles.dot}
          />
        ))}
      </div>

      {error.value && (
        <p class={styles.error} role="alert">
          {error.value}
        </p>
      )}
      {locked && <p class={styles.lockout}>Bloqueado {Math.ceil(lockoutMs.value / 1000)}s</p>}

      <div class={styles.pad}>
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            class={styles.key}
            onClick={() => push(digit)}
            disabled={locked}
          >
            {digit}
          </button>
        ))}
        <div class={styles.keySpacer} aria-hidden="true" />
        <button type="button" class={styles.key} onClick={() => push('0')} disabled={locked}>
          0
        </button>
        <button
          type="button"
          class={`${styles.key} ${styles.keyGhost}`}
          onClick={pop}
          disabled={locked}
          aria-label="Borrar el último dígito"
        >
          ←
        </button>
      </div>

      <button type="button" class={styles.link} onClick={openRecovery}>
        He olvidado el PIN
      </button>

      {showRecovery.value && (
        <div class={styles.modalOverlay}>
          <div class={styles.modal} role="dialog" aria-modal="true" aria-label="Restablecer PIN">
            <h2 class={styles.modalTitle}>Restablecer PIN</h2>
            <p class={styles.modalHint}>
              Escribe las 12 palabras de tu papel, en orden. Da igual mayúsculas, tildes o comas.
            </p>
            <textarea
              ref={phraseBox}
              class={styles.textarea}
              placeholder="agua aire ala alba …"
              value={recPhrase.value}
              spellcheck={false}
              autocomplete="off"
              onInput={(event) => {
                recPhrase.value = event.currentTarget.value;
              }}
            />
            <input
              class={styles.input}
              type="password"
              inputMode="numeric"
              maxLength={PIN_SLOTS.length}
              autocomplete="off"
              placeholder="PIN nuevo (6 dígitos)"
              value={newPin.value}
              onInput={(event) => {
                newPin.value = event.currentTarget.value.replace(/\D/g, '');
              }}
            />
            <input
              class={styles.input}
              type="password"
              inputMode="numeric"
              maxLength={PIN_SLOTS.length}
              autocomplete="off"
              placeholder="Repite el PIN nuevo"
              value={confirmNewPin.value}
              onInput={(event) => {
                confirmNewPin.value = event.currentTarget.value.replace(/\D/g, '');
              }}
            />

            {error.value && (
              <p class={styles.error} role="alert">
                {error.value}
              </p>
            )}

            <div class={styles.modalActions}>
              <button
                type="button"
                class={styles.btnSecondary}
                onClick={() => {
                  showRecovery.value = false;
                }}
                disabled={isWorking.value}
              >
                Cancelar
              </button>
              <button
                type="button"
                class={styles.btn}
                onClick={resetWithPhrase}
                disabled={isWorking.value}
              >
                {isWorking.value ? 'Restableciendo…' : 'Restablecer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
