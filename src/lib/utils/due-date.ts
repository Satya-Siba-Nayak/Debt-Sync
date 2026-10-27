/**
 * Computes overdue status, remaining days, and styling for a debt's due date.
 * Parses YYYY-MM-DD calendar dates directly to prevent UTC midnight timezone shift bugs.
 */
export function getDueDateInfo(dueDate?: string | null, status?: string) {
  if (!dueDate || status === 'settled' || status === 'declined' || status === 'purged') return null;

  const now = new Date();
  const cleanDateStr = dueDate.trim().split('T')[0];
  const parts = cleanDateStr.split('-').map(Number);

  let due: Date;
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    due = new Date(parts[0], parts[1] - 1, parts[2]);
  } else {
    due = new Date(dueDate);
  }
  if (isNaN(due.getTime())) return null;

  // Compare calendar days in local calendar time
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const diffDays = Math.round((dueDay - nowDay) / (1000 * 60 * 60 * 24));

  // Unaccepted pending requests are not overdue yet
  if (status === 'pending') {
    return {
      text: `Target ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      isOverdue: false,
      className: 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] border-[var(--outline-variant)]/30',
    };
  }

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
