// Everything the screens show, derived from the stored ledger on each change. Nothing here is saved.
import { doc, docVersion } from './store.js';
import { prices, accountValue, latestQuoteTime } from './prices.js';
import { bucketBalances, netWorth, ytdAll, runwayMonths, loanBalance } from './domain/balances.js';
import { project } from './domain/projection.js';
import { payFor, phaseOn, allocatePaycheck, validatePhases, isAsset, bucketCap, plannedFor, AllocationError } from './domain/allocation.js';
import { monthlyBudget, monthSummary } from './domain/spending.js';
import { nextPayday, paydaysBetween, paydaysInMonth, addDays, addMonths, monthKey, yearOf, parts, daysBetween } from './domain/dates.js';
import { taxYear } from './domain/taxdata.js';
import { todayISO } from './ui.js';

let cache = null;

export function model() {
  const today = todayISO();
  const key = `${docVersion()}|${prices.lastRefresh}|${today}`;
  if (cache && cache.key === key) return cache.m;
  const m = build(today);
  cache = { key, m };
  return m;
}
export const invalidate = () => { cache = null; };

const centsOf = bal => Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, v.cents]));

function build(today) {
  const config = doc.config;
  const buckets = config.buckets;
  const bucketById = Object.fromEntries(buckets.map(b => [b.id, b]));
  const periods = config.profile?.payPeriodsPerYear || 24;
  const accountValues = Object.fromEntries(doc.accounts.map(a => [a.id, accountValue(a, doc.tickerMeta)]));
  const ledgerAt = asOf => bucketBalances({ config, snapshots: doc.snapshots, contributions: doc.contributions, transactions: doc.transactions, accountValues, asOf });
  const balances = ledgerAt(today);
  const nw = netWorth(balances, buckets, doc.loans);
  const ytd = ytdAll({ config, contributions: doc.contributions, asOf: today });
  const phaseErrors = validatePhases(config.phases);
  const hasIncome = config.incomes.some(i => i.annualGrossCents > 0);
  const hasData = hasIncome || doc.snapshots.length > 0 || doc.transactions.length > 0 || Object.values(accountValues).some(a => a.hasPositions);

  // Transfers already made for paydays that haven't happened yet (e.g. buying early on a market dip).
  // They're in today's balances, so the projection mustn't add them again on the payday.
  const sentAhead = {};
  for (const c of doc.contributions) {
    if (!c.paycheck || c.paycheck <= today || c.date > today) continue;
    (sentAhead[c.paycheck] ||= {})[c.bucketId] = (sentAhead[c.paycheck][c.bucketId] || 0) + c.cents;
  }

  const projections = {};
  const projection = months => {
    if (!hasIncome) return null;
    if (!projections[months]) {
      projections[months] = project({ config, startDate: today, endDate: addMonths(today, months), balances: centsOf(balances), ytd, sentAhead });
    }
    return projections[months];
  };

  const doneFor = date => {
    const out = {};
    for (const c of doc.contributions) if (c.paycheck === date) out[c.bucketId] = (out[c.bucketId] || 0) + c.cents;
    return out;
  };

  /** The allocation for one payday: simulated for future paychecks, from the ledger for past ones. */
  const planFor = pd => {
    const pay = payFor(pd.date, config.incomes, periods);
    const { phase, extended } = phaseOn(pd.date, config.phases);
    const base = { ...pd, pay, phase, extended, done: doneFor(pd.date) };
    if (!pay) return base;
    if (pd.date > today) {
      const months = Math.max(2, Math.ceil(daysBetween(today, pd.date) / 30) + 1);
      const pc = projection(Math.max(24, months))?.paychecks.find(p => p.date === pd.date);
      if (pc) return { ...base, lines: pc.lines, notices: pc.notices, deferralCents: pc.deferralCents, matchCents: pc.matchCents };
    }
    const asOf = addDays(pd.date, -1);
    try {
      const r = allocatePaycheck({
        takeHomeCents: pay.takeHomeCents, index: pd.index, date: pd.date, buckets, phase,
        sweeps: config.sweeps, balances: centsOf(ledgerAt(asOf)), ytd: ytdAll({ config, contributions: doc.contributions, asOf }),
      });
      return { ...base, lines: r.lines, notices: r.notices, deferralCents: pay.deferralCents, matchCents: pay.matchCents };
    } catch (e) {
      if (!(e instanceof AllocationError)) throw e;
      return { ...base, error: e.message };
    }
  };

  const next = nextPayday(today);
  const recentPaydays = paydaysBetween(addDays(today, -62), addDays(today, -1));
  const upcoming = paydaysBetween(today, addMonths(today, 4)).slice(0, 8);

  // Paychecks whose transfers you haven't marked as sent yet (only ones covered by your plan).
  const unsent = [];
  if (hasIncome) {
    for (const pd of recentPaydays) {
      const plan = planFor(pd);
      if (!plan.lines || !plan.phase || plan.extended) continue;
      const open = plan.lines.filter(l => l.cents > 0 && !(plan.done[l.bucketId] > 0));
      if (open.length) unsent.push({ ...pd, open: open.length });
    }
  }

  // Monthly burn: what the plan sends to expense buckets this month.
  const { y, m } = parts(today);
  let burn = 0;
  for (const pd of paydaysInMonth(y, m)) {
    const { phase } = phaseOn(pd.date, config.phases);
    for (const b of buckets) if (b.kind === 'expense') burn += plannedFor(phase, b.id, pd.index);
  }
  if (!burn) burn = monthlyBudget(config, monthKey(today)).cents;
  const runway = runwayMonths(balances, buckets, burn);

  const currentIncome = config.incomes.filter(i => i.from <= today).sort((a, b) => b.from.localeCompare(a.from))[0];
  const liveTickers = [...new Set(doc.accounts.flatMap(a => a.holdings.map(h => h.ticker)).filter(t => !Number.isFinite(doc.tickerMeta[t]?.manual)))];

  // Goals: every target and limit in the plan, with when the projection says you'll get there.
  const goals = () => {
    const proj = projection(Math.max(36, monthsUntilLastEvent(config, today)));
    const ms = proj?.milestones || [];
    const out = [];
    for (const b of buckets) {
      const bal = balances[b.id]?.cents ?? 0;
      if (b.kind === 'capped' && Number.isInteger(b.targetCents)) {
        const hit = ms.find(x => x.bucketId === b.id && x.type === 'target');
        out.push({ bucket: b, kind: 'target', current: bal, target: b.targetCents, eta: bal >= b.targetCents ? 'done' : hit?.date || null });
      } else if (b.kind === 'limited' || (b.kind === 'pretax' && (ytd[b.id] > 0 || (currentIncome?.deferralRate || 0) > 0))) {
        const cap = bucketCap(b.kind === 'pretax' ? { ...b, kind: 'limited' } : b, yearOf(today));
        if (!cap) continue;
        const hit = ms.find(x => x.bucketId === b.id && x.type === 'limit' && x.year === yearOf(today));
        const nextYear = ms.find(x => x.bucketId === b.id && x.type === 'limit' && x.year === yearOf(today) + 1);
        out.push({ bucket: b, kind: 'limit', current: ytd[b.id] || 0, target: cap.cents, year: yearOf(today), eta: (ytd[b.id] || 0) >= cap.cents ? 'done' : hit?.date || null, nextYear, estimatedLimit: taxYear(yearOf(today) + 1).estimated });
      }
    }
    return out;
  };

  return {
    today, config, buckets, bucketById, periods, accountValues, balances, nw, ytd, phaseErrors,
    hasIncome, hasData, projection, planFor, next, upcoming, recentPaydays, unsent, burn, runway, goals, liveTickers,
    quoteTime: latestQuoteTime(liveTickers),
    monthBudget: month => monthlyBudget(config, month),
    monthSummary: month => monthSummary(doc.transactions, month),
    ledgerAt,
    loans: doc.loans.map(l => ({ ...l, balance: loanBalance(l) })),
  };
}

function monthsUntilLastEvent(config, today) {
  const last = (config.events || []).map(e => e.date).sort().pop();
  if (!last || last <= today) return 0;
  const a = parts(today), b = parts(last);
  return (b.y - a.y) * 12 + (b.m - a.m) + 2;
}

/** The phase covering today's date, if any. */
export const currentPhase = m => phaseOn(m.today, m.config.phases);
