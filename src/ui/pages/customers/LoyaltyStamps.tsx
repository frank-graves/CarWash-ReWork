import styles from './LoyaltyStamps.module.css';

interface Props {
  accumulated: number;
  size?: 'sm' | 'md';
}

export function LoyaltyStamps({ accumulated, size = 'md' }: Props) {
  const stamps = Array.from({ length: 7 }, (_, i) => {
    const isFree = i === 6;
    const isFilled = i < accumulated;
    // Rotación determinística para evocar sellos puestos a mano
    const rotation = isFree ? 0 : (i % 2 === 0 ? -2 : 1.5);
    
    return (
      <div
        key={i}
        class={`${styles.stamp} ${size === 'sm' ? styles.sm : styles.md} ${isFilled ? styles.filled : styles.empty} ${isFree ? styles.free : ''}`}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        {isFree ? '✱' : i + 1}
      </div>
    );
  });

  return <div class={styles.container}>{stamps}</div>;
}
