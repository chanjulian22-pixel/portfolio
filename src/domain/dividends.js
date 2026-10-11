// When funds pay dividends, so the app can remind you to log them.
import { addMonths } from './dates.js';

// Usual schedules. Change any fund's schedule on its edit screen.
export const DEFAULT_DIV_FREQ = { USFR: 'monthly', VOO: 'quarterly', QQQ: 'quarterly', QQQM: 'quarterly', VXUS: 'quarterly' };
export const QUARTER_MONTHS = [3, 6, 9, 12];

/** 'monthly' | 'quarterly' | 'none' — what you set on the fund, else the usual schedule, else quarterly. */
export const divFreq = (ticker, tickerMeta = {}) => tickerMeta[ticker]?.divFreq || DEFAULT_DIV_FREQ[ticker] || 'quarterly';

export function paysInMonth(freq, month) {
  const m = Number(month.slice(5, 7));
  return freq === 'monthly' || (freq === 'quarterly' && QUARTER_MONTHS.includes(m));
}

/** The month to check: from the 28th through the 10th of the next month (pay dates straddle month-end). */
export function dividendCheckMonth(today) {
  const d = Number(today.slice(8, 10));
  if (d >= 28) return today.slice(0, 7);
  if (d <= 10) return addMonths(today.slice(0, 7) + '-01', -1).slice(0, 7);
  return null;
}

/** Funds you hold that pay in `month`, account by account. */
export function fundsDue({ accounts, tickerMeta = {}, month }) {
  const out = [];
  for (const a of accounts) {
    for (const h of a.holdings) {
      if (h.shares > 0 && paysInMonth(divFreq(h.ticker, tickerMeta), month)) out.push({ accountId: a.id, accountName: a.name, ticker: h.ticker });
    }
  }
  return out;
}

/** Dividends recorded for an account (or all accounts) in a calendar year. */
export function dividendsInYear(dividends = [], year, accountId = null) {
  return dividends.filter(d => d.date.startsWith(String(year)) && (!accountId || d.accountId === accountId)).reduce((a, d) => a + d.cents, 0);
}
