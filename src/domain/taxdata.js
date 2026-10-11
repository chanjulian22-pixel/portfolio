// Versioned tax tables, keyed by year. Amounts in cents; each bracket is [floorCents, rate].
// Single filer, New York State + New York City resident.
// 2027 tables are published around November 2026 — add them here as a new key.

export const TAX_YEARS = {
  2026: {
    fedStandardDeduction: 1610000,
    fedBrackets: [
      [0, 0.10], [1240000, 0.12], [5040000, 0.22], [10570000, 0.24],
      [20177500, 0.32], [25622500, 0.35], [64060000, 0.37],
    ],
    nyStandardDeduction: 800000,
    nyBrackets: [
      [0, 0.039], [850000, 0.044], [1170000, 0.0515], [1390000, 0.054],
      [8065000, 0.059], [21540000, 0.0685],
    ],
    nycBrackets: [[0, 0.03078], [1200000, 0.03762], [2500000, 0.03819], [5000000, 0.03876]],
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 18450000,
    medicareRate: 0.0145,
    limits: { k401: 2450000, ira: 750000, hsa: 440000 },
    rothPhaseOut: [15300000, 16800000],
  },
};

/** The table for `year`, falling back to the latest published year (flagged as an estimate). */
export function taxYear(year) {
  if (TAX_YEARS[year]) return { ...TAX_YEARS[year], year, estimated: false };
  const known = Object.keys(TAX_YEARS).map(Number).sort((a, b) => a - b);
  const use = known.filter(y => y <= year).pop() ?? known[0];
  return { ...TAX_YEARS[use], year: use, estimated: true };
}
