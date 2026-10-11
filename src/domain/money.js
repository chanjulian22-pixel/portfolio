// Money is always integer cents. Floats only appear when parsing user input or applying rates,
// and are rounded back to cents immediately.

/** Parse "$1,234.56" / "1234.5" / 12 into integer cents. Returns NaN when unparseable. */
export function parseCents(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : NaN;
  const s = String(input ?? '').replace(/[$,\s]/g, '');
  if (!/^-?\d*\.?\d*$/.test(s) || s === '' || s === '-' || s === '.') return NaN;
  return Math.round(parseFloat(s) * 100);
}

export const isCents = v => Number.isInteger(v);

export const sum = arr => arr.reduce((a, b) => a + b, 0);

/** Integer division rounded half-up, for non-negative numerators. */
export function roundDiv(numerator, denominator) {
  if (numerator < 0) return -roundDiv(-numerator, denominator);
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** cents × rate, rounded half-up to the cent. Rates are converted to parts-per-100,000 so the math stays integer. */
export function applyRate(cents, rate) {
  return roundDiv(cents * Math.round(rate * 100000), 100000);
}

/**
 * Split `totalCents` across weights so the parts sum to exactly the total
 * (largest-remainder method). Zero total weight splits evenly.
 */
export function splitByWeights(totalCents, weights) {
  const n = weights.length;
  if (!n) return [];
  const w = weights.map(x => (x > 0 ? x : 0));
  const wSum = sum(w);
  const basis = wSum > 0 ? w : w.map(() => 1);
  const bSum = wSum > 0 ? wSum : n;
  const raw = basis.map(x => (totalCents * x) / bSum);
  const parts = raw.map(Math.floor);
  let left = totalCents - sum(parts);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) parts[order[k][1]]++;
  return parts;
}
