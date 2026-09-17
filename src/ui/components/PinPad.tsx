import type { Signal } from '@preact/signals';
import styles from './PinPad.module.css';

const PIN_SLOTS = [0, 1, 2, 3, 4, 5] as const;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function PinPad({ value, label }: { value: Signal<string>; label: string }) {
  const push = (digit: string) => {
    if (value.value.length < PIN_SLOTS.length) value.value += digit;
  };
  const pop = () => {
    value.value = value.value.slice(0, -1);
  };

  return (
    <div class={styles.pinBlock}>
      <span class={styles.label}>{label}</span>
      <div class={styles.pinDots} aria-hidden="true">
        {PIN_SLOTS.map((slot) => (
          <span
            key={slot}
            class={slot < value.value.length ? `${styles.pinDot} ${styles.pinDotFilled}` : styles.pinDot}
          />
        ))}
      </div>
      <div class={styles.pinPad}>
        {DIGITS.map((digit) => (
          <button key={digit} type="button" class={styles.key} onClick={() => push(digit)}>
            {digit}
          </button>
        ))}
        <div class={styles.keySpacer} aria-hidden="true" />
        <button type="button" class={styles.key} onClick={() => push('0')}>
          0
        </button>
        <button
          type="button"
          class={`${styles.key} ${styles.keyGhost}`}
          onClick={pop}
          aria-label="Borrar el último dígito"
        >
          ←
        </button>
      </div>
    </div>
  );
}
