// Gross pay -> take-home. Single filer, NY State + NYC. An estimator, not tax preparation:
// ignores credits, itemized deductions, other income and the 0.9% additional Medicare tax.
//
// Order matters (see docs/tax-engine.md in the planning notes):
//   pre-tax 401(k) deferrals reduce income tax but NOT FICA;
//   NYC tax uses the New York State taxable base.
import { applyRate, roundDiv } from './money.js';
import { taxYear } from './taxdata.js';

const RATE_SCALE = 100000;
const scaledRate = r => Math.round(r * RATE_SCALE);

/** Progressive tax on `taxableCents`, summed exactly then rounded half-up to the cent once. */
export function applyBrackets(taxableCents, brackets) {
  if (taxableCents <= 0) return 0;
  let units = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [floor, rate] = brackets[i];
    if (taxableCents <= floor) break;
    const ceil = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    units += (Math.min(taxableCents, ceil) - floor) * scaledRate(rate);
  }
  return roundDiv(units, RATE_SCALE);
}

/** The bracket the next dollar of *reduction* comes out of (the one strictly below `taxableCents`). */
function bracketBelow(taxableCents, brackets) {
  let idx = -1;
  for (let i = 0; i < brackets.length; i++) if (brackets[i][0] < taxableCents) idx = i;
  return idx;
}

function marginalAt(w2WagesCents, t) {
  const fedTaxable = w2WagesCents - t.fedStandardDeduction;
  const stateTaxable = w2WagesCents - t.nyStandardDeduction;
  const fi = bracketBelow(fedTaxable, t.fedBrackets);
  const si = bracketBelow(stateTaxable, t.nyBrackets);
  const ci = bracketBelow(stateTaxable, t.nycBrackets);
  const federal = fi < 0 ? 0 : t.fedBrackets[fi][1];
  const state = si < 0 ? 0 : t.nyBrackets[si][1];
  const city = ci < 0 ? 0 : t.nycBrackets[ci][1];
  return { federal, state, city, total: federal + state + city, fedTaxable, fedFloor: fi < 0 ? 0 : t.fedBrackets[fi][0] };
}

/**
 * @param {object} p
 * @param {number} p.annualGrossCents
 * @param {number} [p.deferralRate] pre-tax 401(k) election, e.g. 0.10
 * @param {number} [p.otherPreTaxDeductionsCents] annual dental/vision/transit (Section 125/132: reduce FICA and income tax)
 * @param {number} p.year tax year
 * @param {number} [p.payPeriodsPerYear]
 */
export function computePay({ annualGrossCents, deferralRate = 0, otherPreTaxDeductionsCents = 0, year, payPeriodsPerYear = 24 }) {
  const t = taxYear(year);
  const gross = annualGrossCents;
  const deferral = Math.min(applyRate(gross, deferralRate), t.limits.k401);
  const otherPreTax = otherPreTaxDeductionsCents;

  const ficaWages = gross - otherPreTax;
  const socialSecurity = applyRate(Math.min(ficaWages, t.socialSecurityWageBase), t.socialSecurityRate);
  const medicare = applyRate(ficaWages, t.medicareRate);
  const fica = socialSecurity + medicare;

  const w2Wages = gross - deferral - otherPreTax;
  const fedTaxable = Math.max(0, w2Wages - t.fedStandardDeduction);
  const federal = applyBrackets(fedTaxable, t.fedBrackets);
  const stateTaxable = Math.max(0, w2Wages - t.nyStandardDeduction);
  const state = applyBrackets(stateTaxable, t.nyBrackets);
  const city = applyBrackets(stateTaxable, t.nycBrackets);
  const takeHome = gross - deferral - otherPreTax - fica - federal - state - city;

  // Per paycheck: each component rounded on its own, take-home is what's left.
  const per = x => roundDiv(x, payPeriodsPerYear);
  const pp = {
    gross: per(gross), deferral: per(deferral), otherPreTax: per(otherPreTax),
    fica: per(fica), federal: per(federal), state: per(state), city: per(city),
  };
  pp.takeHome = pp.gross - pp.deferral - pp.otherPreTax - pp.fica - pp.federal - pp.state - pp.city;

  const marginal = marginalAt(w2Wages, t);
  const bracketRoom = Math.max(0, marginal.fedTaxable - marginal.fedFloor);
  const k401Room = Math.max(0, t.limits.k401 - deferral);
  const after = marginalAt(w2Wages - bracketRoom, t);

  return {
    year: t.year,
    estimatedTables: t.estimated,
    annual: { gross, deferral, otherPreTax, ficaWages, socialSecurity, medicare, fica, w2Wages, fedTaxable, federal, stateTaxable, state, city, takeHome },
    perPaycheck: pp,
    marginal: { federal: marginal.federal, state: marginal.state, city: marginal.city, total: marginal.total },
    headroom: {
      bracketCents: bracketRoom,          // extra deferral still saved at the current federal rate
      usableCents: Math.min(bracketRoom, k401Room),
      k401RoomCents: k401Room,
      rateAfter: after.total,
    },
  };
}

/** Combined federal + state + city rate on the next dollar deferred. */
export function getMarginalRate(annualGrossCents, deferralCents, year) {
  const t = taxYear(year);
  return marginalAt(annualGrossCents - deferralCents, t).total;
}
