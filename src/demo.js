// Demo mode: open the app with ?demo to show it off with made-up numbers. It never reads or writes
// the real data on the device (see store.js and prices.js); refreshing starts the demo over.
// Everything below is invented — none of it comes from anyone's real finances.
import { addDays, addMonths, paydaysBetween, monthKey, iso, parts } from './domain/dates.js';
import { payFor } from './domain/allocation.js';

export const DEMO = (() => { try { return new URLSearchParams(location.search).has('demo'); } catch { return false; } })();

const P = (p1, p2 = p1) => ({ p1, p2 });
const now = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

/** Fixed prices so the demo needs no API key (roughly market levels; not live). */
const PRICES = { VOO: [640.12, 0.52], QQQM: [255.4, -0.36], VXUS: [72.05, 0.43] };
export const demoQuotes = () => Object.fromEntries(Object.entries(PRICES).map(([t, [c, dp]]) =>
  [t, { c, d: +(c * dp / 100).toFixed(2), dp, t: Math.floor(Date.now() / 1000) - 900 }]));
const TARGET_FUND = { ticker: 'VFFVX', price: 62.4, label: 'Target 2055 fund' };

// A small seeded random number generator, so the demo looks the same every time.
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// [item, category, min $, max $, weight, card]
const SHOPS = [
  ['Chipotle', 'food', 11, 16, 3, 'gold'], ['Sweetgreen', 'food', 13, 18, 2, 'gold'], ['Starbucks', 'food', 4.5, 8, 3, 'gold'],
  ['Joe’s Pizza', 'food', 4, 9, 2, 'gold'], ['Dinner with friends', 'food', 35, 75, 1, 'gold'], ['Drinks', 'nightlife', 25, 60, 1, 'gold'],
  ['Trader Joe’s', 'groceries', 30, 85, 2, 'bcp'], ['Uber', 'transport', 12, 32, 1.5, 'bcp'], ['OMNY subway', 'transport', 2.9, 2.9, 2, 'bcp'],
  ['Amazon', 'shopping', 15, 45, 1, 'cfu'], ['CVS', 'health', 8, 25, 0.5, 'cfu'], ['Movie tickets', 'fun', 18, 30, 0.4, 'cfu'],
];
const RECURRING = [['Netflix', 'bills', 15.49, 5, 'bcp'], ['Spotify', 'bills', 11.99, 12, 'bcp'], ['Gym membership', 'health', 89, 1, 'cfu']];

export function demoDoc(today = now()) {
  const rand = rng(20261023);
  const between = (a, b) => Math.round((a + (b - a) * rand()) * 100);
  const ids = { n: 0 };
  const id = p => `${p}demo${(ids.n++).toString(36)}`;
  const start = addMonths(today, -4);
  const yearStart = `${parts(today).y}-01-01`;

  const config = {
    profile: { payPeriodsPerYear: 24, filing: 'single', state: 'NY', city: 'NYC', payRule: '15th and last business day' },
    incomes: [{ id: 'job', label: 'Analyst', from: addMonths(yearStart, -12), annualGrossCents: 7200000, deferralRate: 0.06, matchRate: 0.04, otherPreTaxDeductionsCents: 0, actualTakeHomeCents: null }],
    buckets: [
      { id: 'roth', label: 'Roth IRA', kind: 'limited', assetClass: 'equity', limitKey: 'ira', color: 1, expectedAnnualReturn: 0.07, lockedUntilAge: 59.5, account: 'roth', purpose: 'Retirement investing' },
      { id: 'brokerage', label: 'Brokerage', kind: 'investment', assetClass: 'equity', isResidual: true, color: 2, expectedAnnualReturn: 0.07, account: 'taxable', purpose: 'Long-term growth · gets whatever is left' },
      { id: 'emergency', label: 'Emergency fund', kind: 'capped', assetClass: 'cash', targetCents: 1500000, color: 3, expectedAnnualReturn: 0.04, purpose: 'High-yield savings · 6 months of costs' },
      { id: 'travel', label: 'Travel fund', kind: 'revolving', assetClass: 'cash', color: 5, expectedAnnualReturn: 0.04, purpose: 'Trips' },
      { id: 'spending', label: 'Spending money', kind: 'expense', isSpending: true, color: 7, purpose: 'Daily & social spending' },
      { id: 'k401', label: '401(k)', kind: 'pretax', assetClass: 'equity', limitKey: 'k401', color: 8, expectedAnnualReturn: 0.07, lockedUntilAge: 59.5, account: '401k', purpose: 'Pre-tax · paid by payroll' },
    ],
    phases: [{
      id: 'plan', label: 'Steady plan', startDate: addMonths(yearStart, -12), endDate: addMonths(yearStart, 36).slice(0, 4) + '-12-31',
      amounts: { roth: P(30000), emergency: P(25000), travel: P(10000), spending: P(55000) },
      note: 'Roth $300, emergency $250 and travel $100 a paycheck; $1,100 a month to spend; the rest is invested.',
    }],
    sweeps: [{ id: 'roth-maxed', watch: 'roth', to: 'brokerage' }, { id: 'emergency-full', watch: 'emergency', to: 'brokerage' }],
    events: [{ id: 'trip', label: 'Japan trip', date: addMonths(today, 7).slice(0, 8) + '10', outflowCents: 320000, fromBucket: 'travel', note: 'Two weeks in Tokyo and Kyoto.' }],
    budgetOverrides: {},
    todos: [{ id: 'demo', text: 'This is a demo with made-up numbers. Tap around — nothing you change is saved.' }],
    investGoalCents: 10000000,
  };

  // ---- investments (shares and cost basis)
  const accounts = [
    { id: 'roth', name: 'Roth IRA', cash: 0, holdings: [{ ticker: 'VOO', shares: 14.2, costCents: 815000 }, { ticker: 'QQQM', shares: 9.5, costCents: 205000 }, { ticker: 'VXUS', shares: 18, costCents: 118000 }],
      targets: [{ label: 'S&P 500', tickers: ['VOO'], pct: 70 }, { label: 'Nasdaq-100', tickers: ['QQQM'], pct: 20 }, { label: 'International', tickers: ['VXUS'], pct: 10 }] },
    { id: 'taxable', name: 'Brokerage', cash: 0, incomeCents: 8500, holdings: [{ ticker: 'VOO', shares: 10.1, costCents: 590000 }, { ticker: 'QQQM', shares: 12, costCents: 270000 }],
      targets: [{ label: 'S&P 500', tickers: ['VOO'], pct: 75 }, { label: 'Nasdaq-100', tickers: ['QQQM'], pct: 25 }] },
    { id: '401k', name: '401(k)', cash: 0, holdings: [{ ticker: TARGET_FUND.ticker, shares: 95, costCents: 540000 }], targets: [] },
  ];
  const tickerMeta = { [TARGET_FUND.ticker]: { manual: TARGET_FUND.price, label: TARGET_FUND.label } };
  const purchases = [
    { id: id('b'), accountId: 'roth', ticker: 'VOO', date: addDays(today, -23), shares: 0.47, costCents: 30000, batch: 'demo1' },
    { id: id('b'), accountId: 'taxable', ticker: 'QQQM', date: addDays(today, -23), shares: 3.2, costCents: 81700, batch: 'demo2' },
  ];

  // ---- cash balances, then the transfers sent since
  const snapDate = addDays(today, -40);
  const snapshots = [
    { id: id('s'), bucketId: 'emergency', date: snapDate, cents: 980000 },
    { id: id('s'), bucketId: 'travel', date: snapDate, cents: 52000 },
  ];
  const pay = payFor(today, config.incomes, 24);
  const residual = Math.max(0, (pay?.takeHomeCents || 0) - 120000);
  const contributions = [];
  const paydays = paydaysBetween(addDays(snapDate, 1), today);
  paydays.forEach((pd, i) => {
    const lines = { roth: 30000, emergency: 25000, travel: 10000, spending: 55000, brokerage: residual };
    for (const [bucketId, cents] of Object.entries(lines)) {
      if (i === paydays.length - 1 && bucketId === 'brokerage') continue; // leave one to show the reminder
      contributions.push({ id: id('c'), bucketId, date: pd.date, cents, paycheck: pd.date, at: Date.parse(pd.date + 'T12:00:00') });
    }
  });

  // ---- four months of everyday spending
  const transactions = [];
  let created = Date.parse(start + 'T09:00:00');
  const push = t => transactions.push({ id: id('t'), createdAt: (created += 60000), ...t });
  const weights = SHOPS.reduce((s, x) => s + x[4], 0);
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const day = parts(d).d;
    for (const [item, category, cents, dom, card] of RECURRING) if (day === dom) push({ date: d, item, category, cents: Math.round(cents * 100), card });
    const n = rand() < 0.15 ? 0 : rand() < 0.55 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      let r = rand() * weights, s = SHOPS[0];
      for (const x of SHOPS) { r -= x[4]; if (r <= 0) { s = x; break; } }
      push({ date: d, item: s[0], category: s[1], cents: between(s[2], s[3]), card: s[5] });
    }
  }
  push({ date: addDays(today, -18), item: 'Amazon return', category: 'credits', cents: -2899, card: 'cfu' });
  push({ date: addDays(today, -52), item: 'Amtrak to Boston', category: 'transport', cents: 12900, card: 'bcp', work: true, reimbursedOn: addDays(today, -30) });
  push({ date: addDays(today, -6), item: 'Client lunch', category: 'food', cents: 6420, card: 'gold', work: true });

  // ---- cards (Gold opened 9 months ago, BCP 15 months ago)
  const goldOpened = addMonths(today, -9).slice(0, 7), bcpOpened = addMonths(today, -15).slice(0, 7);
  const cards = [
    { id: 'demo-gold', catalogId: 'amex-gold', opened: goldOpened, activated: [], rewardsOverride: { [goldOpened + '-01']: 14200 },
      creditsUsed: { uber: Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => [addMonths(today, -k).slice(0, 7), 1000])), resy: { [`${parts(today).y}-H${parts(today).m <= 6 ? 1 : 2}`]: 5000 } } },
    { id: 'demo-bcp', catalogId: 'amex-bcp', opened: bcpOpened, firstYearFree: true, activated: [], creditsUsed: { disney: { [monthKey(addMonths(today, -1))]: 1000 } } },
    { id: 'demo-cfu', catalogId: 'chase-freedom-unlimited', activated: [], creditsUsed: {} },
  ];
  const cardIds = { gold: 'demo-gold', bcp: 'demo-bcp', cfu: 'demo-cfu' };
  for (const t of transactions) { t.cardId = cardIds[t.card]; delete t.card; }

  const loans = [{ id: 'roommate', name: 'Roommate', direction: 'owed-to-me', includeInNetWorth: false,
    entries: [{ id: id('l'), item: 'Concert tickets', cents: 8500 }, { id: id('l'), item: 'Paid back', cents: -4000 }] }];

  const history = demoHistory({ today, accounts, tickerMeta, snapshots, contributions, rand, residual });

  return {
    app: 'ledger', version: 2, demo: true, config, accounts, tickerMeta, snapshots, contributions, transactions, loans, history,
    dividends: [], purchases, dividendChecks: {}, cards, cardPrefs: {}, dismissed: [],
  };
}

/** Daily net-worth history for the charts: steady saving plus a wandering market. */
function demoHistory({ today, accounts, tickerMeta, snapshots, contributions, rand, residual }) {
  const price = t => tickerMeta[t]?.manual ?? PRICES[t]?.[0] ?? 0;
  const value = a => Math.round(a.holdings.reduce((s, h) => s + h.shares * price(h.ticker) * 100, 0));
  const acct = id => accounts.find(a => a.id === id);
  const cashNow = id => snapshots.find(s => s.bucketId === id).cents + contributions.filter(c => c.bucketId === id).reduce((s, c) => s + c.cents, 0);
  const now = { roth: value(acct('roth')), brokerage: value(acct('taxable')), k401: value(acct('401k')), emergency: cashNow('emergency'), travel: cashNow('travel') };
  const perDay = { roth: 60000 / 30.4, brokerage: (residual * 2) / 30.4, k401: 60000 / 30.4, emergency: 50000 / 30.4, travel: 20000 / 30.4 };
  const cost = accounts.reduce((s, a) => s + a.holdings.reduce((x, h) => x + h.costCents, 0), 0) - (acct('taxable').incomeCents || 0);
  const N = 150;
  const mkt = [1];
  for (let i = 1; i <= N; i++) mkt.push(mkt[i - 1] * (1 + (rand() - 0.47) * 0.018));
  const out = [];
  for (let i = 0; i < N; i++) {
    const back = N - i, date = addDays(today, -back), f = mkt[i] / mkt[N];
    const byBucket = {};
    for (const [b, v] of Object.entries(now)) {
      const base = Math.max(0, v - perDay[b] * back);
      byBucket[b] = Math.round(['roth', 'brokerage', 'k401'].includes(b) ? base * f : base);
    }
    const equity = byBucket.roth + byBucket.brokerage + byBucket.k401;
    const invIn = Math.round(cost - (perDay.roth + perDay.brokerage + perDay.k401) * back);
    out.push({ date, total: Object.values(byBucket).reduce((s, v) => s + v, 0), byBucket, invIn, invRet: equity - invIn });
  }
  return out;
}
