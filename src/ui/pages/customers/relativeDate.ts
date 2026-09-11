export function formatRelativeDate(date: Date | null): string {
  if (!date) return 'sin lavados';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return 'hoy';
  if (diffDays === 1) return 'ayer';
  if (diffDays < 7) return `hace ${diffDays} días`;
  
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return `hace ${diffWeeks} semanas`;
  
  const diffMonths = Math.floor(diffDays / 30);
  if (diffDays < 365) return `hace ${diffMonths} meses`;
  
  return 'hace más de un año';
}
