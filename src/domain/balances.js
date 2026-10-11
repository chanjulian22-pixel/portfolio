// Where each bucket stands today, derived from the ledger. Nothing here is stored.
import { payFor, isAsset } from './allocation.js';
import { paydaysBetween, addDays, yearOf, iso } from './dates.js';
import { taxYear } from './taxdata.js';

/** 401(k) money payroll moved for paydays in (afterDate, upToDate]: employee deferral + employer match. */
export function payrollK401(incomes, afterDate, upToDate, periods = 24) {
  let deferral = 0, match = 0;
  if (!afterDate || upToDate <= afterDate) return { deferral, match };
  const ytdByYear = {};
  for (const p of paydaysBetween(addDays(afterDate, 1), upToDate)) {
    const pay = payFor(p.date, incomes, periods);
    if (!pay) continue;
    const y = yearOf(p.date);
    const limit = taxYear(y).limits.k401;
    const used = ytdByYear[y] || 0;
    const d = Math.max(0, Math.min(pay.deferralCents, limit - used));
    ytdByYear[y] = used + d;
    deferral += d;
    match += Math.min(d, pay.matchCents);
  }
  return { deferral, match };
}

function latestSnapshot(snapshots, bucketId, asOf) {
  let hit = null;
  for (const s of snapshots) {
    if (s.bucketId !== bucketId || s.date > asOf) continue;
    if (!hit || s.date > hit.date || (s.date === hit.date && (s.at || 0) > (hit.at || 0))) hit = s;
  }
  return hit;
}

/**
 * Balance of every asset bucket as of `asOf`.
 *  - A bucket linked to an investment account that has positions uses that account's live value.
 *  - Otherwise: the latest balance you entered + transfers logged since (+ payroll for the 401(k)),
 *    minus spending paid out of that bucket (e.g. a trip paid from the travel fund).
 */
export function bucketBalances({ config, snapshots = [], contributions = [], transactions = [], accountValues = {}, asOf }) {
  const out = {};
  const periods = config.profile?.payPeriodsPerYear || 24;
  for (const b of config.buckets) {
    if (!isAsset(b)) continue;
    const live = b.account ? accountValues[b.account] : null;
    if (live && live.hasPositions) {
      out[b.id] = { cents: live.cents, source: 'live', priced: live.priced };
      continue;
    }
    const snap = latestSnapshot(snapshots, b.id, asOf);
    const since = snap ? snap.date : null;
    let cents = snap ? snap.cents : 0;
    let added = 0;
    for (const c of contributions) {
      if (c.bucketId !== b.id || c.date > asOf || (since && c.date <= since)) continue;
      added += c.cents;
    }
    let spent = 0;
    for (const t of transactions) {
      if (t.fundedBy !== b.id || t.date > asOf || (since && t.date <= since)) continue;
      spent += t.cents;
    }
    let payroll = 0;
    if (b.kind === 'pretax') {
      // No balance entered yet: count every paycheck since the first salary on record.
      const firstIncome = config.incomes.map(i => i.from).sort()[0];
      const k = payrollK401(config.incomes, since || (firstIncome ? addDays(firstIncome, -1) : asOf), asOf, periods);
      payroll = k.deferral + k.match;
    }
    cents += added + payroll - spent;
    out[b.id] = {
      cents,
      source: snap ? (added || payroll || spent ? 'derived' : 'snapshot') : (added || payroll ? 'derived' : 'none'),
      snapshotDate: since,
      snapshotCents: snap ? snap.cents : null,
      addedCents: added + payroll - spent,
    };
  }
  return out;
}

/** Contributions to a bucket in calendar `year` up to `asOf` (what counts toward an annual limit). */
export function ytdContributions({ config, contributions = [], bucketId, year, asOf }) {
  const bucket = config.buckets.find(b => b.id === bucketId);
  if (bucket?.kind === 'pretax') {
    return payrollK401(config.incomes, iso(year - 1, 12, 31), asOf, config.profile?.payPeriodsPerYear || 24).deferral;
  }
  let total = 0;
  for (const c of contributions) {
    if (c.bucketId === bucketId && yearOf(c.date) === year && c.date <= asOf) total += c.cents;
  }
  return total;
}

/** Year-to-date contributions for every limited / pre-tax bucket. */
export function ytdAll({ config, contributions, asOf }) {
  const year = yearOf(asOf);
  const out = {};
  for (const b of config.buckets) {
    if (b.kind === 'limited' || b.kind === 'pretax') out[b.id] = ytdContributions({ config, contributions, bucketId: b.id, year, asOf });
  }
  return out;
}

/** What you owe (positive) on each loan: sum of its entries. */
export const loanBalance = loan => loan.entries.reduce((a, e) => a + e.cents, 0);

/**
 * Net worth and its slices.
 * Loans count only when the loan says so (your spreadsheet's net worth left family loans out).
 */
export function netWorth(balances, buckets, loans = []) {
  let assets = 0, invested = 0, cash = 0, retirement = 0;
  for (const b of buckets) {
    const bal = balances[b.id];
    if (!bal) continue;
    assets += bal.cents;
    if (b.assetClass === 'equity') invested += bal.cents;
    if (b.assetClass === 'cash') cash += bal.cents;
    if (b.lockedUntilAge) retirement += bal.cents;
  }
  let liabilities = 0;
  for (const l of loans) if (l.includeInNetWorth) liabilities += (l.direction === 'owed-to-me' ? -1 : 1) * loanBalance(l);
  return { total: assets - liabilities, assets, invested, cash, retirement, accessible: assets - retirement, liabilities };
}

/** Months your emergency cash covers at the current monthly burn. */
export function runwayMonths(balances, buckets, monthlyBurnCents) {
  if (!(monthlyBurnCents > 0)) return null;
  let emergency = 0;
  for (const b of buckets) if (b.assetClass === 'cash' && b.kind !== 'revolving' && balances[b.id]) emergency += balances[b.id].cents;
  return emergency / monthlyBurnCents;
}
