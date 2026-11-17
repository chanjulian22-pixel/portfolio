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
import { catalogState } from './cardsCatalog.js';
import { resolveCard } from './domain/cards.js';
import { lineState, openLines, settleResidual } from './domain/paychecks.js';

let cache = null;

export function model() {
  const today = todayISO();
  const key = `${docVersion()}|${prices.lastRefresh}|${today}`;
  if (cache && cache.key === key) return cache.m;
  const m = buildModel(today);
  cache = { key, m };
  return m;
}
export const invalidate = () => { cache = null; };

const centsOf = bal => Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, v.cents]));

/** The model for a given day (exported so tests can pin the date). */
export function buildModel(today) {
  const config = doc.config;
  const buckets = config.buckets;
  const bucketById = Object.fromEntries(buckets.map(b => [b.id, b]));
  const periods = config.profile?.payPeriodsPerYear || 24;
  const accountValues = Object.fromEntries(doc.accounts.map(a => [a.id, accountValue(a, doc.tickerMeta)]));

  /**
   * Bucket balances as of a date. `excludePaycheck`: leave out the transfers of that payday, to see
   * where things stood before its money arrived (even the part you sent early).
   */
  const ledgerAt = (asOf, { excludePaycheck = null } = {}) => {
    const contributions = excludePaycheck ? doc.contributions.filter(c => c.paycheck !== excludePaycheck) : doc.contributions;
    const out = bucketBalances({ config, snapshots: doc.snapshots, contributions, transactions: doc.transactions, accountValues, asOf });
    if (asOf >= today) return out;
    // An investment account's live value is today's. For a past date, use what was recorded that day.
    let h = null;
    for (const x of doc.history) if (x.byBucket && x.date <= asOf && (!h || x.date >= h.date)) h = x;
    if (!h) return out;
    for (const [id, bal] of Object.entries(out)) {
      if (bal.source !== 'live' || !Number.isInteger(h.byBucket[id])) continue;
      let cents = h.byBucket[id];
      if (excludePaycheck) for (const c of doc.contributions) if (c.paycheck === excludePaycheck && c.bucketId === id && c.date <= h.date) cents -= c.cents;
      out[id] = { ...bal, cents };
    }
    return out;
  };

  const balances = ledgerAt(today);
  const nw = netWorth(balances, buckets, doc.loans, doc.transactions);
  const ytd = ytdAll({ config, contributions: doc.contributions, asOf: today });
  const phaseErrors = validatePhases(config.phases);
  const hasIncome = config.incomes.some(i => i.annualGrossCents > 0);
  const hasData = hasIncome || doc.snapshots.length > 0 || doc.transactions.length > 0 || Object.values(accountValues).some(a => a.hasPositions);

  // Transfers already made for today's or a later payday (e.g. buying early on a market dip).
  // They're in today's balances, so the forecast mustn't add them again on the payday.
  const sentAhead = {};
  for (const c of doc.contributions) {
    if (!c.paycheck || c.paycheck < today || c.date > today) continue;
    (sentAhead[c.paycheck] ||= {})[c.bucketId] = (sentAhead[c.paycheck][c.bucketId] || 0) + c.cents;
  }

  /** What's been marked as sent for a payday, per bucket, and the lines you said are finished. */
  const sentFor = date => {
    const done = {}, final = {};
    for (const c of doc.contributions) {
      if (c.paycheck !== date) continue;
      done[c.bucketId] = (done[c.bucketId] || 0) + c.cents;
      if (c.final) final[c.bucketId] = true;
    }
    return { done, final };
  };
  /** Each planned line with what's been sent and where it stands (none / partial / full / catchup). */
  const withState = (pd, lines, { done, final }) => settleResidual(lines, done).map(l => {
    const sentCents = done[l.bucketId] || 0;
    return { ...l, sentCents, ...lineState({ line: l, sentCents, final: !!final[l.bucketId], payday: pd.date, today }) };
  });

  /** A past payday's plan, from where the buckets stood the day before — leaving out that paycheck's
   *  own transfers, so sending early doesn't change what its plan was. */
  const pastPlan = pd => {
    const pay = payFor(pd.date, config.incomes, periods);
    const { phase, extended } = phaseOn(pd.date, config.phases);
    const sent = sentFor(pd.date);
    const base = { ...pd, pay, phase, extended, done: sent.done };
    if (!pay) return base;
    const asOf = addDays(pd.date, -1);
    try {
      const r = allocatePaycheck({
        takeHomeCents: pay.takeHomeCents, index: pd.index, date: pd.date, buckets, phase, sweeps: config.sweeps,
        balances: centsOf(ledgerAt(asOf, { excludePaycheck: pd.date })),
        ytd: ytdAll({ config, contributions: doc.contributions.filter(c => c.paycheck !== pd.date), asOf }),
      });
      return { ...base, lines: withState(pd, r.lines, sent), notices: r.notices, deferralCents: pay.deferralCents, matchCents: pay.matchCents };
    } catch (e) {
      if (!(e instanceof AllocationError)) throw e;
      return { ...base, error: e.message };
    }
  };

  // A bucket that got less than the plan now says, from a paycheck earlier this month (e.g. you
  // raised spending money after sending it): the next paycheck makes it up, so the plan doesn't
  // quietly invest that money. Lines never sent at all stay on the "not sent" reminder instead.
  const catchUp = {};
  for (const pd of paydaysBetween(today.slice(0, 8) + '01', addDays(today, -1))) {
    const plan = pastPlan(pd);
    if (!plan.lines || !plan.phase || plan.extended) continue;
    for (const l of plan.lines) if (l.state === 'catchup') catchUp[l.bucketId] = (catchUp[l.bucketId] || 0) + l.leftCents;
  }

  const projections = {};
  const projection = months => {
    if (!hasIncome) return null;
    if (!projections[months]) {
      projections[months] = project({ config, startDate: today, endDate: addMonths(today, months), balances: centsOf(balances), ytd, sentAhead, catchUp, includeStart: true });
    }
    return projections[months];
  };

  /** The allocation for one payday: today's and upcoming ones come from the forecast (so they
   *  include any catch-up), past ones from the ledger. */
  const planFor = pd => {
    if (pd.date < today) return pastPlan(pd);
    const pay = payFor(pd.date, config.incomes, periods);
    const { phase, extended } = phaseOn(pd.date, config.phases);
    const sent = sentFor(pd.date);
    const base = { ...pd, pay, phase, extended, done: sent.done };
    if (!pay) return base;
    const months = Math.max(2, Math.ceil(daysBetween(today, pd.date) / 30) + 1);
    const proj = projection(Math.max(24, months));
    const pc = proj?.paychecks.find(p => p.date === pd.date);
    if (pc) return { ...base, lines: withState(pd, pc.lines, sent), notices: pc.notices, deferralCents: pc.deferralCents, matchCents: pc.matchCents };
    const failed = proj?.errors.find(e => e.date === pd.date);
    return failed ? { ...base, error: failed.message } : base;
  };

  const next = nextPayday(today);
  const recentPaydays = paydaysBetween(addDays(today, -62), addDays(today, -1));
  const upcoming = paydaysBetween(today, addMonths(today, 4)).slice(0, 8);
  // Every payday the plan has covered so far, oldest first — past paychecks stay viewable.
  const planStart = [...config.phases.map(p => p.startDate), ...doc.contributions.map(c => c.paycheck).filter(Boolean)].sort()[0];
  const pastPaydays = hasIncome && planStart && planStart < today ? paydaysBetween(planStart, addDays(today, -1)) : [];

  // Recent paychecks with transfers not sent yet, or only partly sent (only ones covered by your plan).
  const unsent = [];
  if (hasIncome) {
    for (const pd of recentPaydays) {
      const plan = pastPlan(pd);
      if (!plan.lines || !plan.phase || plan.extended) continue;
      const open = openLines(plan.lines);
      if (open.length) unsent.push({ ...pd, open: open.length, partial: open.filter(l => l.state === 'partial').length, leftCents: open.reduce((a, l) => a + l.leftCents, 0) });
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

  const catalog = catalogState.data;
  const cards = (doc.cards || []).map(o => resolveCard(o, catalog)).filter(Boolean);

  return {
    catalog, cards, cardPrefs: doc.cardPrefs || {},
    today, config, buckets, bucketById, periods, accountValues, balances, nw, ytd, phaseErrors,
    hasIncome, hasData, projection, planFor, next, upcoming, recentPaydays, pastPaydays, unsent, catchUp, burn, runway, goals, liveTickers,
    quoteTime: latestQuoteTime(liveTickers),
    monthBudget: month => monthlyBudget(config, month),
    monthSummary: month => monthSummary(doc.transactions, month),
    ledgerAt,
    loans: doc.loans.map(l => ({ ...l, balance: loanBalance(l, doc.transactions) })),
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
