// "Where should my next contribution go?" — buy-only rebalancing toward target weights.
// Mirrors the spreadsheet tool: new cash fills each fund's gap to target, proportionally,
// without selling anything. A sleeve with `prefer` (e.g. QQQ + QQQM, prefer QQQM) pins the
// other funds at their current value so all new money for that sleeve goes to the preferred one.
import { splitByWeights } from './money.js';

/**
 * @param {object} p
 * @param {{ticker: string, valueCents: number}[]} p.positions current market value per fund
 * @param {{label?: string, tickers: string[], pct: number, prefer?: string}[]} p.sleeves target weights (pct sums to 100)
 * @param {number} p.newCashCents
 */
export function rebalance({ positions, sleeves, newCashCents }) {
  const value = t => positions.filter(p => p.ticker === t).reduce((a, p) => a + p.valueCents, 0);
  const tickers = sleeves.flatMap(s => s.tickers);
  const current = tickers.reduce((a, t) => a + value(t), 0);
  const after = current + newCashCents;

  const rows = [];
  for (const s of sleeves) {
    const sleeveShare = s.pct / 100;
    const inSleeve = s.tickers.reduce((a, t) => a + value(t), 0);
    for (const t of s.tickers) {
      let target;
      if (s.tickers.length === 1) target = sleeveShare;
      else if (s.prefer) {
        target = t === s.prefer
          ? sleeveShare - s.tickers.filter(x => x !== s.prefer).reduce((a, x) => a + (after > 0 ? value(x) / after : 0), 0)
          : (after > 0 ? value(t) / after : 0);
      } else {
        target = inSleeve > 0 ? sleeveShare * value(t) / inSleeve : sleeveShare / s.tickers.length;
      }
      rows.push({ ticker: t, sleeve: s.label || s.tickers.join(' + '), valueCents: value(t), targetPct: target });
    }
  }
  for (const r of rows) r.gapCents = Math.max(0, Math.round(after * r.targetPct - r.valueCents));
  const gaps = rows.map(r => r.gapCents);
  const weights = gaps.some(g => g > 0) ? gaps : rows.map(r => Math.max(0, r.targetPct));
  const invest = splitByWeights(newCashCents, weights);
  rows.forEach((r, i) => {
    r.investCents = invest[i];
    r.currentPct = current > 0 ? r.valueCents / current : 0;
    r.afterCents = r.valueCents + r.investCents;
    r.afterPct = after > 0 ? r.afterCents / after : 0;
  });
  return { rows, currentCents: current, afterCents: after };
}

/** Current vs target weight per sleeve, for the allocation bars. */
export function sleeveWeights({ positions, sleeves }) {
  const value = t => positions.filter(p => p.ticker === t).reduce((a, p) => a + p.valueCents, 0);
  const total = sleeves.flatMap(s => s.tickers).reduce((a, t) => a + value(t), 0);
  return sleeves.map(s => {
    const cents = s.tickers.reduce((a, t) => a + value(t), 0);
    return { label: s.label || s.tickers.join(' + '), tickers: s.tickers, cents, currentPct: total > 0 ? cents / total : 0, targetPct: s.pct / 100 };
  });
}
