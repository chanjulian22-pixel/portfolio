// Persistence. Everything lives in this browser's localStorage on your phone — nothing is sent anywhere
// except ticker symbols to Finnhub for prices. Export a backup from Settings now and then.
import { parseCents } from './domain/money.js';

const KEY = 'ledger.v2';
const UI_KEY = 'ledger.ui';
const V1_STATE = 'pt.state.v1';

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const newId = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A neutral starting point. Your real numbers arrive by importing your private data file. */
export function defaultConfig() {
  return {
    profile: { payPeriodsPerYear: 24 },
    incomes: [],
    buckets: [
      { id: 'roth', label: 'Roth IRA', kind: 'limited', assetClass: 'equity', limitKey: 'ira', color: 1, expectedAnnualReturn: 0.07, lockedUntilAge: 59.5, account: 'roth', purpose: 'Retirement investing' },
      { id: 'brokerage', label: 'Brokerage', kind: 'investment', assetClass: 'equity', isResidual: true, color: 2, expectedAnnualReturn: 0.07, account: 'taxable', purpose: 'Long-term growth · gets whatever is left' },
      { id: 'emergency', label: 'Emergency fund', kind: 'capped', assetClass: 'cash', targetCents: 1000000, color: 3, expectedAnnualReturn: 0.04, purpose: 'Job-loss buffer' },
      { id: 'spending', label: 'Spending money', kind: 'expense', isSpending: true, color: 7, purpose: 'Daily & social spending' },
    ],
    phases: [],
    sweeps: [],
    events: [],
    budgetOverrides: {},
    todos: [],
  };
}
const defaultAccounts = () => [
  { id: 'roth', name: 'Roth IRA', cash: 0, holdings: [], targets: [] },
  { id: 'taxable', name: 'Taxable', cash: 0, holdings: [], targets: [] },
  { id: '401k', name: '401(k)', cash: 0, holdings: [], targets: [] },
];

export function emptyDoc() {
  return {
    app: 'ledger', version: 2,
    config: defaultConfig(),
    accounts: defaultAccounts(),
    tickerMeta: {},
    snapshots: [], contributions: [], transactions: [], loans: [], history: [], dividends: [], purchases: [], dividendChecks: {}, cards: [], cardPrefs: {},
    dismissed: [],
  };
}

const isInt = Number.isInteger;
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoOk = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ticker = t => { const s = String(t ?? '').trim().toUpperCase(); return /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(s) ? s : ''; };

function cleanAccounts(list) {
  if (!Array.isArray(list)) return defaultAccounts();
  return list.filter(a => a && typeof a === 'object' && str(a.id, 40)).map(a => {
    const seen = new Set();
    const holdings = (Array.isArray(a.holdings) ? a.holdings : [])
      .map(h => ({ ticker: ticker(h?.ticker), shares: Number(h?.shares), ...(isInt(h?.costCents) ? { costCents: h.costCents } : {}) }))
      .filter(h => h.ticker && Number.isFinite(h.shares) && h.shares >= 0 && !seen.has(h.ticker) && seen.add(h.ticker));
    const targets = (Array.isArray(a.targets) ? a.targets : []).filter(s => s && Array.isArray(s.tickers) && Number.isFinite(s.pct))
      .map(s => ({ label: str(s.label, 40), tickers: s.tickers.map(ticker).filter(Boolean), pct: s.pct, prefer: ticker(s.prefer) || undefined }));
    const cash = Number(a.cash);
    return {
      id: str(a.id, 40), name: str(a.name, 40) || 'Account', cash: Number.isFinite(cash) && cash > 0 ? Math.round(cash) : 0, holdings, targets,
      // dividends/interest the brokerage says you'd earned before you started logging them here
      ...(isInt(a.incomeCents) && a.incomeCents > 0 ? { incomeCents: a.incomeCents } : {}),
    };
  });
}

/** Validate a document (saved state or an imported file). Returns a clean copy or throws. */
export function sanitizeDoc(d) {
  if (!d || typeof d !== 'object' || d.app !== 'ledger') throw new Error('Not a Ledger file.');
  const c = d.config && typeof d.config === 'object' ? d.config : {};
  const base = defaultConfig();
  const config = {
    profile: { ...base.profile, ...(c.profile || {}) },
    incomes: Array.isArray(c.incomes) ? c.incomes.filter(i => i && isoOk(i.from) && isInt(i.annualGrossCents)) : [],
    buckets: Array.isArray(c.buckets) && c.buckets.length ? c.buckets.filter(b => b && str(b.id, 40) && str(b.label, 60)) : base.buckets,
    phases: Array.isArray(c.phases) ? c.phases.filter(ph => ph && isoOk(ph.startDate) && isoOk(ph.endDate)) : [],
    sweeps: Array.isArray(c.sweeps) ? c.sweeps.filter(s => s && s.watch && s.to) : [],
    events: Array.isArray(c.events) ? c.events.filter(e => e && isoOk(e.date)) : [],
    budgetOverrides: c.budgetOverrides && typeof c.budgetOverrides === 'object' ? Object.fromEntries(Object.entries(c.budgetOverrides).filter(([k, v]) => /^\d{4}-\d{2}$/.test(k) && isInt(v))) : {},
    todos: Array.isArray(c.todos) ? c.todos.filter(t => t && t.id && t.text) : [],
    ...(isInt(c.investGoalCents) && c.investGoalCents > 0 ? { investGoalCents: c.investGoalCents } : {}),
  };
  const rows = (list, ok) => (Array.isArray(list) ? list.filter(x => x && typeof x === 'object' && ok(x)) : []);
  return {
    app: 'ledger', version: 2,
    config,
    accounts: cleanAccounts(d.accounts),
    tickerMeta: d.tickerMeta && typeof d.tickerMeta === 'object' ? d.tickerMeta : {},
    snapshots: rows(d.snapshots, s => s.bucketId && isoOk(s.date) && isInt(s.cents)).map(s => ({ id: s.id || newId('s'), ...s })),
    contributions: rows(d.contributions, s => s.bucketId && isoOk(s.date) && isInt(s.cents)).map(s => ({ id: s.id || newId('c'), ...s })),
    transactions: rows(d.transactions, t => isoOk(t.date) && isInt(t.cents)).map(t => ({ id: t.id || newId('t'), ...t, item: str(t.item, 80) || 'Untitled' })),
    loans: rows(d.loans, l => l.id && Array.isArray(l.entries)).map(l => ({
      ...l, name: str(l.name, 40) || 'Loan', direction: l.direction === 'owed-to-me' ? 'owed-to-me' : 'i-owe',
      entries: l.entries.filter(e => e && isInt(e.cents)).map(e => ({ id: e.id || newId('l'), ...e })),
    })),
    history: rows(d.history, h => isoOk(h.date) && isInt(h.total)),
    dividends: rows(d.dividends, x => x.accountId && isoOk(x.date) && isInt(x.cents)).map(x => ({ id: x.id || newId('d'), ...x })),
    purchases: rows(d.purchases, x => x.accountId && x.ticker && isoOk(x.date) && isInt(x.costCents) && Number.isFinite(x.shares)).map(x => ({ id: x.id || newId('b'), ...x })),
    // Credit cards you own: catalog id (or custom terms), when opened, credits used, quarterly activations
    cards: rows(d.cards, x => typeof x.id === 'string' && (x.catalogId || x.custom)).map(x => ({
      ...x,
      opened: typeof x.opened === 'string' && /^\d{4}-\d{2}$/.test(x.opened) ? x.opened : undefined,
      creditsUsed: x.creditsUsed && typeof x.creditsUsed === 'object' ? x.creditsUsed : {},
      activated: Array.isArray(x.activated) ? x.activated : [],
    })),
    cardPrefs: d.cardPrefs && typeof d.cardPrefs === 'object' ? Object.fromEntries(Object.entries(d.cardPrefs).filter(([, v]) => Number.isFinite(v) && v > 0)) : {},
    dividendChecks: d.dividendChecks && typeof d.dividendChecks === 'object' ? Object.fromEntries(Object.entries(d.dividendChecks).filter(([k]) => /^\d{4}-\d{2}$/.test(k))) : {},
    dismissed: Array.isArray(d.dismissed) ? d.dismissed : [],
  };
}

/** Pull holdings from the first version of the app (same site, same phone) into this one. */
function migrateV1(doc) {
  const v1 = read(V1_STATE, null);
  if (!v1 || !Array.isArray(v1.accounts)) return false;
  let moved = false;
  for (const a of v1.accounts) {
    const holdings = (a.holdings || []).filter(h => h && h.ticker);
    if (!holdings.length && !(a.cash > 0)) continue;
    const target = doc.accounts.find(x => x.id === a.id);
    if (target) { target.holdings = holdings; target.cash = Math.round(a.cash || 0); }
    else doc.accounts.push({ id: a.id, name: a.name, cash: Math.round(a.cash || 0), holdings, targets: [] });
    moved = true;
  }
  if (v1.meta) for (const [t, m] of Object.entries(v1.meta)) {
    doc.tickerMeta[t] = { ...(doc.tickerMeta[t] || {}), ...(Number.isFinite(m.manual) ? { manual: m.manual } : {}), ...(m.label ? { label: m.label } : {}) };
  }
  return moved;
}

function load() {
  const saved = read(KEY, null);
  if (saved) {
    try { return sanitizeDoc(saved); } catch { /* fall through to a fresh doc */ }
  }
  const d = emptyDoc();
  if (migrateV1(d)) d.migratedFromV1 = true;
  return d;
}

export let doc = load();
let version = 0;
export const docVersion = () => version;

export function save() {
  version++;
  const ok = write(KEY, doc);
  return ok;
}

export function replaceDoc(next) {
  doc = next;
  save();
}

export function exportJSON() {
  return JSON.stringify({ ...doc, exported: new Date().toISOString() }, null, 2);
}

/**
 * Add the transactions in an "additions" file (e.g. a work expense report) to what's on this phone.
 * Nothing is replaced. Cards are matched by catalog id and added if missing. A transaction already
 * here (same id, or same date and amount) isn't added twice; a same-day, same-amount purchase you
 * logged yourself is marked as the work expense instead.
 */
export function mergeAdditions(parsed) {
  if (!parsed || parsed.app !== 'ledger' || parsed.kind !== 'additions') throw new Error('Not a Ledger additions file.');
  doc.cards = doc.cards || [];
  let cardsAdded = 0;
  for (const c of Array.isArray(parsed.cards) ? parsed.cards : []) {
    if (!c || typeof c.catalogId !== 'string') continue;
    const opened = typeof c.opened === 'string' && /^\d{4}-\d{2}$/.test(c.opened) ? c.opened : undefined;
    const mine = doc.cards.find(x => x.catalogId === c.catalogId);
    if (mine) { if (!mine.opened && opened) mine.opened = opened; continue; }
    doc.cards.push({ id: newId('card'), catalogId: c.catalogId, opened, ...(typeof c.firstYearFree === 'boolean' ? { firstYearFree: c.firstYearFree } : {}), creditsUsed: {}, activated: [] });
    cardsAdded++;
  }
  const cardFor = catalogId => doc.cards.find(x => x.catalogId === catalogId)?.id;
  let added = 0, matched = 0, already = 0;
  const ids = new Set(doc.transactions.map(t => t.id));
  // Only what was here before this import can be a duplicate (a report can hold two $200 exams on
  // one day), and each of those stands in for one incoming row at most.
  const before = [...doc.transactions];
  const taken = new Set();
  for (const t of Array.isArray(parsed.transactions) ? parsed.transactions : []) {
    if (!t || !isoOk(t.date) || !isInt(t.cents)) continue;
    if (t.id && ids.has(t.id)) { already++; continue; }
    const cardId = t.card ? cardFor(t.card) : undefined;
    const reimbursedOn = isoOk(t.reimbursedOn) ? t.reimbursedOn : undefined;
    const same = before.find(x => !taken.has(x) && x.date === t.date && x.cents === t.cents);
    if (same) {
      taken.add(same);
      if (t.work && !same.work) { same.work = true; delete same.fundedBy; matched++; } else already++;
      if (t.work && reimbursedOn && !same.reimbursedOn) same.reimbursedOn = reimbursedOn;
      if (cardId && !same.cardId) same.cardId = cardId;
      continue;
    }
    const { card, ...rest } = t;
    doc.transactions.push({
      ...rest, id: t.id || newId('t'), item: str(t.item, 80) || 'Untitled', cardId,
      work: t.work ? true : undefined, reimbursedOn: t.work ? reimbursedOn : undefined, createdAt: t.createdAt || Date.now(),
    });
    ids.add(t.id);
    added++;
  }
  save();
  return { kind: 'additions', added, matched, already, cardsAdded };
}

/**
 * Import a Ledger file. Holdings already on this phone are kept when the file has none
 * (so importing your spreadsheet data doesn't wipe shares you entered).
 * An "additions" file is merged instead (see mergeAdditions).
 */
export function importJSON(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file isn’t valid JSON.'); }
  if (parsed?.kind === 'additions') return mergeAdditions(parsed);
  const next = sanitizeDoc(parsed);
  for (const acct of next.accounts) {
    const mine = doc.accounts.find(a => a.id === acct.id);
    if (mine && !acct.holdings.length && mine.holdings.length) { acct.holdings = mine.holdings; acct.cash = mine.cash; if (mine.incomeCents) acct.incomeCents = mine.incomeCents; }
  }
  for (const mine of doc.accounts) {
    if (!next.accounts.some(a => a.id === mine.id) && (mine.holdings.length || mine.cash)) next.accounts.push(mine);
  }
  next.tickerMeta = { ...doc.tickerMeta, ...next.tickerMeta };
  if (!next.history.length) next.history = doc.history;
  if (!next.dividends.length) next.dividends = doc.dividends || [];
  if (!next.purchases.length) next.purchases = doc.purchases || [];
  if (!Object.keys(next.dividendChecks).length) next.dividendChecks = doc.dividendChecks || {};
  if (!next.cards.length) { next.cards = doc.cards || []; next.cardPrefs = doc.cardPrefs || {}; }
  doc = next;
  save();
  return { transactions: next.transactions.length, buckets: next.config.buckets.length, phases: next.config.phases.length };
}

// ---------- UI preferences (per device, non-critical) ----------
export const ui = Object.assign({ tab: 'home', hidden: false, theme: 'system', horizon: 24, goalHorizon: 24 }, read(UI_KEY, {}));
export const saveUi = () => write(UI_KEY, ui);

export { parseCents };
