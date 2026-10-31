// Month helpers. A month is identified by a "month key": "2026-10".
// Keys sort correctly as plain strings, which keeps comparisons simple.

/** Date → "2026-10" (local time) */
export function monthKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Date → "2026-10-31" (local time) */
export function dateKeyOf(date) {
  const d = String(date.getDate()).padStart(2, '0');
  return `${monthKeyOf(date)}-${d}`;
}

/** "2026-10" + 3 → "2027-01" */
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Number of months from a to b ("2026-10" → "2027-01" is 3) */
export function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  // Day 0 of the next month is the last day of this month.
  return new Date(y, m, 0).getDate();
}

/** "2026-10" → "October 2026" */
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** "2026-10-31" → "Sat 31 Oct" */
export function shortDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

/**
 * How many days of the month count as "elapsed" on a given day.
 * Today counts as elapsed (like the sheet: on the 31st it is 31 of 31).
 * Past months are fully elapsed, future months not at all.
 */
export function daysElapsed(monthKey, todayKey) {
  const todayMonth = todayKey.slice(0, 7);
  if (monthKey < todayMonth) return daysInMonth(monthKey);
  if (monthKey > todayMonth) return 0;
  return Number(todayKey.slice(8, 10));
}
