/**
 * Computes overdue status, remaining days, and styling for a debt's due date.
 */
export function getDueDateInfo(dueDate?: string | null, status?: string) {
  if (!dueDate || status === 'settled' || status === 'declined') return null;

  const now = new Date();
  const due = new Date(dueDate);

  // Compare calendar days
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const diffDays = Math.round((dueDay - nowDay) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      text: `Overdue by ${Math.abs(diffDays)}d`,
      isOverdue: true,
      className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    };
  } else if (diffDays === 0) {
    return {
      text: 'Due Today',
      isOverdue: false,
      className: 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40 animate-pulse',
    };
  } else if (diffDays <= 7) {
    return {
      text: `Due in ${diffDays}d`,
      isOverdue: false,
      className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    };
  } else {
    return {
      text: `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      isOverdue: false,
      className: 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline-variant)]/30',
    };
  }
}
