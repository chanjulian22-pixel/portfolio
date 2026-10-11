// Forward model: walk every payday, allocate it with the real engine, fire caps and limits as
// balances cross them, and grow each bucket monthly at its own expected return.
// Principal (what you put in) and growth (what the market adds) are tracked separately —
// over a year or two, almost all of the change is contributions.
import { allocatePaycheck, payFor, phaseOn, bucketCap, isAsset, AllocationError } from './allocation.js';
import { paydaysInMonth, parts, iso, daysInMonth, yearOf } from './dates.js';
import { taxYear } from './taxdata.js';

const monthlyRate = r => (r > 0 ? Math.pow(1 + r, 1 / 12) - 1 : 0);

/**
 * @param {object} p
 * @param {object} p.config
 * @param {string} p.startDate balances are as of this date; paydays strictly after it are simulated
 * @param {string} p.endDate
 * @param {Record<string, number>} p.balances cents per asset bucket
 * @param {Record<string, number>} [p.ytd] contributions so far this year for limited / pre-tax buckets
 */
export function project({ config, startDate, endDate, balances, ytd = {} }) {
  const buckets = config.buckets;
  const assets = buckets.filter(isAsset);
  const periods = config.profile?.payPeriodsPerYear || 24;
  const bal = Object.fromEntries(assets.map(b => [b.id, balances[b.id] || 0]));
  const principal = { ...bal };
  const growth = Object.fromEntries(assets.map(b => [b.id, 0]));
  let year = yearOf(startDate);
  let ytdNow = { ...ytd };
  const targetOverrides = {};
  const events = [...(config.events || [])].filter(e => e.date > startDate && e.date <= endDate).sort((a, b) => a.date.localeCompare(b.date));
  const pending = [...events];
  const milestones = [];
  const paychecks = [];
  const errors = [];
  const reached = new Set();

  const total = obj => Object.values(obj).reduce((a, b) => a + b, 0);
  const snapshot = date => ({ date, total: total(bal), principal: total(principal), growth: total(growth), byBucket: { ...bal } });
  const points = [snapshot(startDate)];

  // Anything already at its cap when the projection starts isn't a future milestone.
  for (const b of assets) {
    const cap = bucketCap(b, year, targetOverrides);
    if (cap?.type === 'target' && bal[b.id] >= cap.cents) reached.add(`${b.id}:target`);
    if (cap?.type === 'limit' && (ytdNow[b.id] || 0) >= cap.cents) reached.add(`${b.id}:limit:${year}`);
  }

  const checkMilestones = date => {
    for (const b of assets) {
      const cap = bucketCap(b, yearOf(date), targetOverrides);
      if (!cap) continue;
      if (cap.type === 'target') {
        const key = `${b.id}:target:${cap.cents}`;
        if (bal[b.id] >= cap.cents && !reached.has(key) && !reached.has(`${b.id}:target`)) {
          reached.add(key);
          milestones.push({ date, type: 'target', bucketId: b.id, cents: cap.cents });
        }
      } else {
        const key = `${b.id}:limit:${yearOf(date)}`;
        if ((ytdNow[b.id] || 0) >= cap.cents && !reached.has(key)) {
          reached.add(key);
          milestones.push({ date, type: 'limit', bucketId: b.id, cents: cap.cents, year: yearOf(date) });
        }
      }
    }
  };

  const applyEventsUpTo = date => {
    while (pending.length && pending[0].date <= date) {
      const e = pending.shift();
      if (e.outflowCents && e.fromBucket && e.fromBucket in bal) {
        bal[e.fromBucket] -= e.outflowCents;
        principal[e.fromBucket] -= e.outflowCents;
      }
      for (const [id, cents] of Object.entries(e.setTargets || {})) {
        targetOverrides[id] = cents;
        reached.delete(`${id}:target`);
      }
      milestones.push({ date: e.date, type: 'event', eventId: e.id, label: e.label, cents: e.outflowCents || 0 });
    }
  };

  let { y, m } = parts(startDate);
  const end = parts(endDate);
  while (y < end.y || (y === end.y && m <= end.m)) {
    for (const p of paydaysInMonth(y, m)) {
      if (p.date <= startDate || p.date > endDate) continue;
      applyEventsUpTo(p.date);
      const py = yearOf(p.date);
      if (py !== year) {
        year = py;
        ytdNow = {};
      }
      const pay = payFor(p.date, config.incomes, periods);
      if (!pay) continue;
      const { phase, extended } = phaseOn(p.date, config.phases || []);
      let result;
      try {
        result = allocatePaycheck({
          takeHomeCents: pay.takeHomeCents, index: p.index, date: p.date, buckets, phase,
          sweeps: config.sweeps, balances: bal, ytd: ytdNow, targetOverrides,
        });
      } catch (err) {
        if (!(err instanceof AllocationError)) throw err;
        errors.push({ date: p.date, message: err.message });
        continue;
      }
      for (const line of result.lines) {
        if (!(line.bucketId in bal)) continue; // expenses leave the system
        bal[line.bucketId] += line.cents;
        principal[line.bucketId] += line.cents;
        const b = buckets.find(x => x.id === line.bucketId);
        if (b.kind === 'limited') ytdNow[b.id] = (ytdNow[b.id] || 0) + line.cents;
      }
      // Payroll 401(k): deferral up to the annual limit, match per period on what was actually deferred.
      const k401 = assets.find(b => b.kind === 'pretax');
      let deferral = 0, match = 0;
      if (k401) {
        const room = Math.max(0, taxYear(py).limits.k401 - (ytdNow[k401.id] || 0));
        deferral = Math.min(pay.deferralCents, room);
        match = Math.min(deferral, pay.matchCents);
        bal[k401.id] += deferral + match;
        principal[k401.id] += deferral + match;
        ytdNow[k401.id] = (ytdNow[k401.id] || 0) + deferral;
      }
      paychecks.push({
        date: p.date, index: p.index, takeHomeCents: pay.takeHomeCents, source: pay.source,
        phaseId: phase?.id || null, extended, lines: result.lines, notices: result.notices,
        deferralCents: deferral, matchCents: match, missedMatchCents: pay.matchCents - match,
      });
      checkMilestones(p.date);
    }
    const monthEnd = iso(y, m, daysInMonth(y, m));
    applyEventsUpTo(monthEnd);
    if (monthEnd > startDate) {
      for (const b of assets) {
        const g = Math.round(bal[b.id] * monthlyRate(b.expectedAnnualReturn || 0));
        bal[b.id] += g;
        growth[b.id] += g;
      }
      points.push(snapshot(monthEnd > endDate ? endDate : monthEnd));
    }
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return { points, paychecks, milestones, errors };
}
