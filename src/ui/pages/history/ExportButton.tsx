import { useSignal, useSignalEffect } from '@preact/signals';
import type { WashTransactionView } from '@core/types';
import { transactionsToCsv } from './csv';
import styles from './ExportButton.module.css';

interface Props {
  transactions: WashTransactionView[];
}

export function ExportButton({ transactions }: Props) {
  // Guardamos la última URL creada para revocarla cuando se reemplace o
  // cuando el componente se desmonte. Sin esto, cada export acumula un
  // blob en memoria hasta que el usuario cierra la pestaña.
  const lastUrl = useSignal<string | null>(null);

  useSignalEffect(() => {
    const url = lastUrl.value;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  });

  const handleExport = () => {
    const ok = window.confirm(
      'Este archivo no está cifrado y contiene datos de clientes en claro.\n' +
      'Se guardará en tu carpeta de Descargas. ¿Continuar?\n\n' +
      'Bórralo cuando termines de usarlo.'
    );
    if (!ok) return;

    const csvContent = transactionsToCsv(transactions);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    lastUrl.value = url;

    // Anchor virtual: se crea, se clickea y se descarta sin tocar el DOM.
    // Anidar <a> dentro de <button> era HTML inválido; esto es equivalente
    // funcional y no depende de la permisividad del motor.
    const virtualAnchor = document.createElement('a');
    virtualAnchor.href = url;
    const today = new Date().toISOString().split('T')[0];
    virtualAnchor.download = `lavados-${today}.csv`;
    virtualAnchor.click();
  };

  return (
    <button type="button" class={styles.btn} onClick={handleExport}>
      <span>↓ exportar.csv</span>
    </button>
  );
}
