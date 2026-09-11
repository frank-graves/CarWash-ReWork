import { useSignal } from '@preact/signals';
import { Vault } from '@infra/vault';
import { translateError } from '@ui/i18n/es';
import styles from './PinChangeForm.module.css';

const PIN_PATTERN = /^[0-9]{6}$/;

export function PinChangeForm() {
  const current = useSignal('');
  const next = useSignal('');
  const confirm = useSignal('');
  const working = useSignal(false);
  const error = useSignal('');
  const success = useSignal('');

  const valid = PIN_PATTERN.test(current.value)
    && PIN_PATTERN.test(next.value)
    && PIN_PATTERN.test(confirm.value)
    && next.value === confirm.value
    && current.value !== next.value;

  const handleSubmit = async () => {
    if (!valid) return;
    if (current.value === next.value) {
      error.value = 'El nuevo PIN debe ser distinto al actual.';
      return;
    }
    working.value = true;
    error.value = '';
    success.value = '';
    try {
      await Vault.changePin(current.value, next.value);
      success.value = 'PIN actualizado';
      current.value = '';
      next.value = '';
      confirm.value = '';
      window.setTimeout(() => { success.value = ''; }, 2400);
    } catch (e) {
      error.value = translateError(e);
    } finally {
      working.value = false;
    }
  };

  return (
    <div class={styles.form}>
      <label class={styles.field}>
        <span class={styles.label}>PIN actual</span>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autocomplete="current-password"
          class={styles.input}
          value={current.value}
          onInput={(e) => { current.value = e.currentTarget.value.replace(/\D/g, ''); }}
        />
      </label>

      <label class={styles.field}>
        <span class={styles.label}>Nuevo PIN</span>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autocomplete="new-password"
          class={styles.input}
          value={next.value}
          onInput={(e) => { next.value = e.currentTarget.value.replace(/\D/g, ''); }}
        />
      </label>

      <label class={styles.field}>
        <span class={styles.label}>Confirmar PIN</span>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autocomplete="new-password"
          class={styles.input}
          value={confirm.value}
          onInput={(e) => { confirm.value = e.currentTarget.value.replace(/\D/g, ''); }}
        />
      </label>

      {error.value && <p class={styles.error}>{error.value}</p>}
      {success.value && <p class={styles.success}>{success.value}</p>}

      <button
        type="button"
        class={styles.submit}
        onClick={handleSubmit}
        disabled={!valid || working.value}
      >
        {working.value ? 'Actualizando…' : 'Cambiar PIN'}
      </button>
    </div>
  );
}
