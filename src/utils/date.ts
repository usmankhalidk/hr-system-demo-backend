/**
 * Format a Date as YYYY-MM-DD using LOCAL timezone (not UTC).
 *
 * Bug: new Date().toISOString().split('T')[0] returns the UTC date,
 * which can be one day behind for UTC+ users (e.g. UTC+5 at midnight).
 * This function always uses the local calendar date.
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayLocal(): string {
  return formatLocalDate(new Date());
}

/** Returns the ISO date string for Monday of the week containing the given date. */
export function mondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return formatLocalDate(d);
}
