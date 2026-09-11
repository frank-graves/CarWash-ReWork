import { useSignal } from '@preact/signals';
import { applyTheme, readStoredTheme, type Theme } from '@ui/theme';
import styles from './ThemeToggle.module.css';

const OPTIONS: readonly { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Oscuro' },
  { id: 'light', label: 'Claro' },
  { id: 'system', label: 'Sistema' },
];

export function ThemeToggle() {
  const current = useSignal<Theme>(readStoredTheme());

  const pick = (theme: Theme) => {
    applyTheme(theme);
    current.value = theme;
  };

  return (
    <div class={styles.rail} role="radiogroup" aria-label="Tema de la aplicación">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={current.value === option.id}
          class={current.value === option.id ? `${styles.option} ${styles.active}` : styles.option}
          onClick={() => pick(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
