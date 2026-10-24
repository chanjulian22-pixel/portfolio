// Live quotes from Finnhub's free /quote endpoint. Only ticker symbols and your key leave the phone.
import { DEMO, demoQuotes } from './demo.js';

const QUOTES_KEY = 'pt.quotes.v1';   // shared with the first version of the app
const KEY_KEY = 'pt.finnhubKey';

const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => { if (DEMO) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const prices = {
  // the demo uses fixed sample prices and never touches your saved key
  quotes: DEMO ? demoQuotes() : read(QUOTES_KEY, {}) || {},
  key: DEMO ? '' : String(read(KEY_KEY, '') || ''),
  lastRefresh: 0,
  refreshing: false,
  keyRejected: false,
};

export function setKey(k) {
  prices.key = k.trim();
  prices.keyRejected = false;
  write(KEY_KEY, prices.key);
}

const url = (sym, key) => `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`;

/** Price for a ticker: a manual price wins (funds with no public quote), else the latest live quote. */
export function priceOf(ticker, tickerMeta = {}) {
  const m = tickerMeta[ticker];
  if (m && Number.isFinite(m.manual)) return { cents: Math.round(m.manual * 100), manual: true };
  const q = prices.quotes[ticker];
  if (q && q.c > 0) return { cents: Math.round(q.c * 100), changeCents: Math.round((q.d || 0) * 100), changePct: (q.dp || 0) / 100, t: q.t, live: true };
  return null;
}

/** Value of an investment account: positions × price + cash. */
export function accountValue(acct, tickerMeta) {
  let cents = acct.cash || 0, day = 0, missing = 0;
  for (const h of acct.holdings) {
    const p = priceOf(h.ticker, tickerMeta);
    if (!p) { missing++; continue; }
    cents += Math.round(h.shares * p.cents);
    if (p.live) day += Math.round(h.shares * p.changeCents);
  }
  return { cents, dayCents: day, missing, hasPositions: acct.holdings.length > 0 || (acct.cash || 0) > 0, priced: missing === 0 };
}

/**
 * Refresh quotes for these tickers. Resolves to { ok, missing, error } where error is
 * 'nokey' | 'auth' | 'rate' | 'network' | null.
 */
export async function refreshQuotes(tickers) {
  if (!prices.key) return { ok: 0, missing: [], error: 'nokey' };
  if (prices.refreshing || !tickers.length) return { ok: 0, missing: [], error: null };
  prices.refreshing = true;
  const queue = [...new Set(tickers)];
  const missing = [];
  let ok = 0, netErr = 0, stop = null;
  const worker = async () => {
    while (queue.length && !stop) {
      const sym = queue.shift();
      try {
        const r = await fetch(url(sym, prices.key), { cache: 'no-store' });
        if (r.status === 401) { stop = 'auth'; break; }
        if (r.status === 429) { stop = 'rate'; break; }
        if (r.status >= 500) { netErr++; continue; }
        const j = r.ok ? await r.json() : null; // 403 = not covered by the free plan
        if (j && Number.isFinite(j.c) && j.c > 0) {
          prices.quotes[sym] = { c: j.c, d: Number.isFinite(j.d) ? j.d : 0, dp: Number.isFinite(j.dp) ? j.dp : 0, pc: j.pc, t: j.t || 0 };
          ok++;
        } else {
          delete prices.quotes[sym];
          missing.push(sym);
        }
      } catch {
        netErr++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  prices.refreshing = false;
  write(QUOTES_KEY, prices.quotes);
  if (ok || missing.length) prices.lastRefresh = Date.now();
  prices.keyRejected = stop === 'auth';
  return { ok, missing, error: stop || (netErr && !ok ? 'network' : null) };
}

/** Check a key with one request. */
export async function testKey(k) {
  try {
    const r = await fetch(url('SPY', k), { cache: 'no-store' });
    if (r.status === 401) return { ok: false, msg: 'Finnhub rejected this key. Copy it again from your Finnhub dashboard.' };
    if (r.status === 429) return { ok: true, msg: 'Key saved. Finnhub says too many requests right now.' };
    if (!r.ok) return { ok: true, msg: `Key saved, but Finnhub answered with error ${r.status}.` };
    return { ok: true, msg: 'Key works. Prices are updating.' };
  } catch {
    return { ok: true, msg: 'Key saved, but Finnhub couldn’t be reached. Check your connection.' };
  }
}

/** Newest quote time across the given tickers (unix seconds), for "prices as of". */
export function latestQuoteTime(tickers) {
  let t = 0;
  for (const s of tickers) { const q = prices.quotes[s]; if (q && q.t > t) t = q.t; }
  return t;
}
