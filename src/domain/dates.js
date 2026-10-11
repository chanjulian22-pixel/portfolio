// Dates are ISO strings ("2027-01-15") everywhere in domain code. No Date objects leak out.

const pad = n => String(n).padStart(2, '0');

export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function parts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d: d || 1 };
}

export const monthKey = s => s.slice(0, 7);
export const yearOf = s => Number(s.slice(0, 4));

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s) {
  const { y, m, d } = parts(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(s, n) {
  const { y, m, d } = parts(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Same day-of-month n months later, clamped to the month's length. */
export function addMonths(s, n) {
  const { y, m, d } = parts(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export const monthStart = s => s.slice(0, 7) + '-01';
export function monthEnd(s) {
  const { y, m } = parts(s);
  return iso(y, m, daysInMonth(y, m));
}

export function daysBetween(a, b) {
  const pa = parts(a), pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function monthsBetween(a, b) {
  const pa = parts(a), pb = parts(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

const isWeekend = s => { const w = weekday(s); return w === 0 || w === 6; };
function previousBusinessDay(s) {
  let t = s;
  while (isWeekend(t)) t = addDays(t, -1);
  return t;
}

/**
 * Semi-monthly paydays: the 15th and the last business day of the month.
 * A 15th that falls on a weekend is paid the Friday before. Bank holidays are not modelled.
 * Paycheck index 1 = mid-month, 2 = end of month.
 */
export function paydaysInMonth(y, m) {
  return [
    { date: previousBusinessDay(iso(y, m, 15)), index: 1 },
    { date: previousBusinessDay(iso(y, m, daysInMonth(y, m))), index: 2 },
  ];
}

/** Every payday with start <= date <= end, in order. */
export function paydaysBetween(start, end) {
  const out = [];
  let { y, m } = parts(start);
  const last = parts(end);
  while (y < last.y || (y === last.y && m <= last.m)) {
    for (const p of paydaysInMonth(y, m)) if (p.date >= start && p.date <= end) out.push(p);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** The first payday on or after `date`. */
export function nextPayday(date) {
  const { y, m } = parts(date);
  for (let k = 0; k < 3; k++) {
    const t = parts(addMonths(iso(y, m, 1), k));
    const hit = paydaysInMonth(t.y, t.m).find(p => p.date >= date);
    if (hit) return hit;
  }
  return null;
}
