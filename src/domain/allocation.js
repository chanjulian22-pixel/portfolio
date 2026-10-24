// Paycheck -> bucket allocation. Every dollar of take-home lands in exactly one bucket;
// the residual bucket absorbs whatever the targets leave, including rounding.
import { computePay } from './tax.js';
import { taxYear } from './taxdata.js';
import { addDays, yearOf } from './dates.js';
import { applyRate, sum } from './money.js';

export class AllocationError extends Error {
  constructor(message, detail) { super(message); this.name = 'AllocationError'; this.detail = detail; }
}

/** Buckets that take money out of each paycheck (pre-tax 401(k) is paid by payroll, not by you). */
export const isAllocatable = b => b.kind !== 'pretax';
export const isAsset = b => b.kind !== 'expense';

/** The salary in effect on `date`: the latest income whose `from` is on or before it. */
export function incomeOn(date, incomes) {
  let hit = null;
  for (const inc of incomes) if (inc.from <= date && (!hit || inc.from >= hit.from)) hit = inc;
  return hit;
}

/** Take-home and pre-tax amounts for the paycheck on `date`. */
export function payFor(date, incomes, payPeriodsPerYear = 24) {
  const income = incomeOn(date, incomes);
  if (!income || !(income.annualGrossCents > 0)) return null;
  const pay = computePay({
    annualGrossCents: income.annualGrossCents,
    deferralRate: income.deferralRate || 0,
    otherPreTaxDeductionsCents: income.otherPreTaxDeductionsCents || 0,
    year: yearOf(date),
    payPeriodsPerYear,
  });
  const fromStub = Number.isInteger(income.actualTakeHomeCents) && income.actualTakeHomeCents > 0;
  const grossPP = pay.perPaycheck.gross;
  const deferralCents = pay.perPaycheck.deferral;
  // Employer match is per pay period: min(what you deferred, matchRate × this period's gross).
  const matchCents = Math.min(deferralCents, applyRate(grossPP, income.matchRate || 0));
  return {
    income,
    pay,
    takeHomeCents: fromStub ? income.actualTakeHomeCents : pay.perPaycheck.takeHome,
    estimatedTakeHomeCents: pay.perPaycheck.takeHome,
    source: fromStub ? 'stub' : 'estimate',
    deferralCents,
    matchCents,
  };
}

/** The phase covering `date`. Past the last phase, the last one keeps applying (flagged as extended). */
export function phaseOn(date, phases) {
  const sorted = [...phases].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const hit = sorted.find(p => p.startDate <= date && date <= p.endDate);
  if (hit) return { phase: hit, extended: false };
  const last = sorted[sorted.length - 1];
  if (last && date > last.endDate) return { phase: last, extended: true };
  return { phase: null, extended: false };
}

/** Phases must tile the timeline: no gaps, no overlaps, start <= end. Returns human-readable problems. */
export function validatePhases(phases) {
  const errs = [];
  const sorted = [...phases].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const p of sorted) if (p.startDate > p.endDate) errs.push(`“${p.label}” ends before it starts.`);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    const expected = addDays(prev.endDate, 1);
    if (cur.startDate < expected) errs.push(`“${prev.label}” and “${cur.label}” overlap.`);
    else if (cur.startDate > expected) errs.push(`Gap between “${prev.label}” and “${cur.label}” (${expected} to ${addDays(cur.startDate, -1)}).`);
  }
  return errs;
}

/** What stops a bucket from taking more: a balance target (capped) or an annual limit (limited). */
export function bucketCap(bucket, year, targetOverrides = {}) {
  if (bucket.kind === 'capped') {
    const cents = targetOverrides[bucket.id] ?? bucket.targetCents;
    return Number.isInteger(cents) ? { type: 'target', cents } : null;
  }
  if (bucket.kind === 'limited') {
    const cents = Number.isInteger(bucket.annualLimitCents) ? bucket.annualLimitCents
      : bucket.limitKey ? taxYear(year).limits[bucket.limitKey] : null;
    return Number.isInteger(cents) ? { type: 'limit', cents } : null;
  }
  return null;
}

/** The planned amount for a bucket on paycheck 1 or 2 of the month. */
export function plannedFor(phase, bucketId, index) {
  const a = phase?.amounts?.[bucketId];
  if (!a) return 0;
  return (index === 1 ? a.p1 : a.p2) || 0;
}

/**
 * Allocate one paycheck.
 * @param {object} p
 * @param {number} p.takeHomeCents
 * @param {1|2} p.index paycheck of the month
 * @param {string} p.date ISO date of the paycheck (for annual limits)
 * @param {object[]} p.buckets
 * @param {object|null} p.phase
 * @param {object[]} [p.sweeps] [{ watch, to }]
 * @param {Record<string, number>} [p.balances] current balances, for capped buckets
 * @param {Record<string, number>} [p.ytd] contributions so far this calendar year, for limited buckets
 * @param {Record<string, number>} [p.targetOverrides] e.g. a target raised by a future event
 */
export function allocatePaycheck({ takeHomeCents, index, date, buckets, phase, sweeps = [], balances = {}, ytd = {}, targetOverrides = {}, extra = {} }) {
  const allocatable = buckets.filter(isAllocatable);
  const residuals = allocatable.filter(b => b.isResidual);
  if (residuals.length !== 1) throw new AllocationError('Exactly one bucket must receive the residual.', { residuals: residuals.map(b => b.id) });
  const residual = residuals[0];
  if (residual.kind !== 'investment') throw new AllocationError('The residual bucket must be an investment bucket.', { residual: residual.id });

  const year = yearOf(date);
  const byId = Object.fromEntries(allocatable.map(b => [b.id, b]));
  const amounts = Object.fromEntries(allocatable.map(b => [b.id, 0]));
  const notices = [];

  const room = b => {
    const cap = bucketCap(b, year, targetOverrides);
    if (!cap) return Infinity;
    const used = cap.type === 'target' ? (balances[b.id] || 0) : (ytd[b.id] || 0);
    return Math.max(0, cap.cents - used - amounts[b.id]);
  };

  // Put `cents` into a bucket; anything over its cap follows the bucket's sweep (or falls to the residual).
  const place = (id, cents, seen = new Set()) => {
    if (cents <= 0) return;
    const b = byId[id];
    if (!b || b === residual) return; // the residual takes whatever is left at the end
    const fits = Math.min(cents, room(b));
    amounts[id] += fits;
    const over = cents - fits;
    if (over > 0) {
      const sweep = sweeps.find(s => s.watch === id);
      const dest = sweep && byId[sweep.to] && !seen.has(sweep.to) ? sweep.to : residual.id;
      const cap = bucketCap(b, year, targetOverrides);
      notices.push({ bucketId: id, to: dest, cents: over, reason: cap?.type === 'limit' ? 'limit' : 'target', capCents: cap?.cents });
      seen.add(id);
      place(dest, over, seen);
    }
  };

  const planned = {};
  for (const b of allocatable) {
    if (b === residual) continue;
    planned[b.id] = plannedFor(phase, b.id, index);
    place(b.id, planned[b.id] + (extra[b.id] || 0)); // `extra`: catch-up owed from an earlier paycheck
  }

  const committed = sum(allocatable.filter(b => b !== residual).map(b => amounts[b.id]));
  const residualCents = takeHomeCents - committed;
  if (residualCents < 0) {
    throw new AllocationError(
      `Targets add up to more than this paycheck by ${((-residualCents) / 100).toFixed(2)}.`,
      { overBy: -residualCents, lines: allocatable.filter(b => amounts[b.id] > 0).map(b => ({ id: b.id, cents: amounts[b.id] })) },
    );
  }
  amounts[residual.id] = residualCents;

  const lines = allocatable.map(b => ({
    bucketId: b.id,
    cents: amounts[b.id],
    plannedCents: b === residual ? null : planned[b.id],
    catchUpCents: b === residual ? 0 : extra[b.id] || 0,
    residual: b === residual,
  }));
  const total = sum(lines.map(l => l.cents));
  if (total !== takeHomeCents) throw new AllocationError('Allocation does not balance.', { total, takeHomeCents });
  return { lines, residualBucketId: residual.id, residualCents, totalCents: total, notices };
}
