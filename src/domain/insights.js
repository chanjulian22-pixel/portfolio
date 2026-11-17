// What your numbers mean: today's safe-to-spend, how this month compares with last, the places and
// subscriptions your money goes to, and a month in review. Pure functions over the ledger.
import { countsAsSpending, categoryById } from './spending.js';
import { addMonths, daysInMonth, parts, monthKey } from './dates.js';

const day = s => Number(s.slice(8, 10));
const key = t => String(t.item || '').trim().toLowerCase();

/** What you can spend today and still land on budget: what's left ÷ days left (today included). */
export function safeToSpend({ budgetCents, spentCents, today }) {
  const { y, m, d } = parts(today);
  const daysLeft = daysInMonth(y, m) - d + 1;
  const left = budgetCents - spentCents;
  return { leftCents: left, daysLeft, perDayCents: budgetCents > 0 ? Math.max(0, Math.floor(left / daysLeft)) : null };
}

/** This month so far against last month at the same day, overall and for the categories that moved most. */
export function compareToLastMonth(transactions, today) {
  const month = monthKey(today), prev = addMonths(month + '-01', -1).slice(0, 7);
  const upTo = day(today);
  const now = {}, before = {};
  let a = 0, b = 0;
  for (const t of transactions) {
    if (!countsAsSpending(t) || t.category === 'credits') continue;
    const mk = monthKey(t.date);
    // undated entries count from day one of their month
    if (mk === month) { a += t.cents; now[t.category || 'other'] = (now[t.category || 'other'] || 0) + t.cents; }
    else if (mk === prev && (t.undated || day(t.date) <= upTo)) { b += t.cents; before[t.category || 'other'] = (before[t.category || 'other'] || 0) + t.cents; }
  }
  const cats = [...new Set([...Object.keys(now), ...Object.keys(before)])]
    .map(id => ({ id, label: categoryById(id).label, emoji: categoryById(id).emoji, nowCents: now[id] || 0, beforeCents: before[id] || 0, deltaCents: (now[id] || 0) - (before[id] || 0) }))
    .filter(c => Math.abs(c.deltaCents) >= 500)
    .sort((x, y) => Math.abs(y.deltaCents) - Math.abs(x.deltaCents));
  return { month, prev, nowCents: a, beforeCents: b, deltaCents: a - b, hasBefore: b > 0, categories: cats };
}

/** Where the month's spending went, by place. */
export function topPlaces(transactions, month, n = 5) {
  const by = new Map();
  for (const t of transactions) {
    if (monthKey(t.date) !== month || !countsAsSpending(t) || !(t.cents > 0)) continue;
    const k = key(t);
    const e = by.get(k) || { item: t.item, cents: 0, count: 0 };
    e.cents += t.cents; e.count++;
    by.set(k, e);
  }
  return [...by.values()].sort((x, y) => y.cents - x.cents).slice(0, n);
}

/**
 * Charges that come back every month for about the same amount (subscriptions, memberships):
 * the same name in at least 3 of the last 4 months, within 15% of each other.
 */
export function recurringCharges(transactions, today) {
  const months = [0, 1, 2, 3].map(k => addMonths(monthKey(today) + '-01', -k).slice(0, 7));
  const by = new Map();
  for (const t of transactions) {
    if (!(t.cents > 0) || t.work || t.loanId || !months.includes(monthKey(t.date))) continue;
    const k = key(t);
    if (!k) continue;
    (by.get(k) || by.set(k, []).get(k)).push(t);
  }
  const out = [];
  for (const list of by.values()) {
    const perMonth = new Map();
    for (const t of list) if (!perMonth.has(monthKey(t.date))) perMonth.set(monthKey(t.date), t);
    if (perMonth.size < 3 || list.length > perMonth.size + 1) continue; // several a month is a habit, not a bill
    const amounts = [...perMonth.values()].map(t => t.cents);
    const lo = Math.min(...amounts), hi = Math.max(...amounts);
    if (hi > lo * 1.15) continue;
    const last = [...perMonth.values()].sort((x, y) => y.date.localeCompare(x.date))[0];
    out.push({ item: last.item, cents: last.cents, lastDate: last.date, months: perMonth.size });
  }
  return out.sort((x, y) => y.cents - x.cents);
}

/** Things you buy often, for one-tap logging: name, usual category, and the amount when it's always the same. */
export function frequentItems(transactions, today, n = 6) {
  const since = addMonths(today, -3);
  const by = new Map();
  for (const t of transactions) {
    if (t.date < since || !(t.cents > 0) || t.work || t.loanId) continue;
    const k = key(t);
    if (!k || k === 'untitled') continue;
    const e = by.get(k) || { item: t.item, category: t.category, count: 0, amounts: new Set(), last: '' };
    e.count++; e.amounts.add(t.cents);
    if (t.date >= e.last) { e.last = t.date; e.category = t.category; e.cardId = t.cardId; }
    by.set(k, e);
  }
  return [...by.values()].filter(e => e.count >= 2).sort((x, y) => y.count - x.count || y.last.localeCompare(x.last)).slice(0, n)
    .map(e => ({ item: e.item, category: e.category, count: e.count, cents: e.amounts.size === 1 ? [...e.amounts][0] : null }));
}

/** One month in numbers. `history` is the app's daily net-worth record. */
export function monthReview({ transactions, contributions, history, buckets, month, budgetCents }) {
  const isAsset = id => { const b = buckets.find(x => x.id === id); return b && b.kind !== 'expense'; };
  const isEquity = id => buckets.find(x => x.id === id)?.assetClass === 'equity';
  let spent = 0, count = 0, biggest = null, work = 0, forOthers = 0;
  const byCat = {};
  for (const t of transactions) {
    if (monthKey(t.date) !== month) continue;
    if (t.work) { work += t.cents; continue; }
    if (t.loanId) { forOthers += t.cents; continue; }
    if (t.fundedBy) continue;
    spent += t.cents; count++;
    if (t.cents > 0) {
      byCat[t.category || 'other'] = (byCat[t.category || 'other'] || 0) + t.cents;
      if (!biggest || t.cents > biggest.cents) biggest = t;
    }
  }
  let saved = 0, invested = 0;
  for (const c of contributions) {
    if (monthKey(c.paycheck || c.date) !== month || !isAsset(c.bucketId)) continue;
    saved += c.cents;
    if (isEquity(c.bucketId)) invested += c.cents;
  }
  const inMonth = history.filter(h => monthKey(h.date) === month);
  const before = [...history].filter(h => h.date < month + '-01').pop() || inMonth[0];
  const after = inMonth[inMonth.length - 1];
  const categories = Object.entries(byCat).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([id, cents]) => ({ id, label: categoryById(id).label, emoji: categoryById(id).emoji, cents }));
  return {
    month, spentCents: spent, budgetCents, underBudgetCents: budgetCents ? budgetCents - spent : null, count, biggest, categories,
    savedCents: saved, investedCents: invested, workCents: work, forOthersCents: forOthers,
    netWorthChangeCents: before && after && after !== before ? after.total - before.total : null,
  };
}
