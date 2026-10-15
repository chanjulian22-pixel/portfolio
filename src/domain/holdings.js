// Share-count changes you log from brokerage receipts (buys, dividend reinvestments), cost basis,
// and how much of an account is your money vs. returns. Pure functions — no storage.
//
// Cost basis follows brokerage convention: a buy adds what you paid, and a reinvested dividend
// adds its amount too (it's a purchase). That's why returns = price gain + dividend income:
// reinvested dividends sit inside cost basis, so they never show up in the price gain.

const roundShares = n => Math.round(n * 1e6) / 1e6;
const known = c => Number.isInteger(c);

function addPosition(holdings, ticker, shares, costCents = 0) {
  const next = holdings.map(h => ({ ...h }));
  const h = next.find(x => x.ticker === ticker);
  if (h) {
    h.shares = roundShares(h.shares + shares);
    if (known(h.costCents)) h.costCents += costCents; // unknown cost basis stays unknown
  } else {
    next.push({ ticker, shares: roundShares(shares), ...(costCents > 0 ? { costCents } : {}) });
  }
  return next;
}

/**
 * Buys made with one transfer. Shares and cost basis go up; whatever of the transfer wasn't spent
 * stays in the account as cash (spending more than the transfer uses cash already there).
 * @param {{holdings: {ticker: string, shares: number, costCents?: number}[], cash?: number, buys: {ticker: string, shares: number, costCents: number}[], sentCents: number}} p
 */
export function applyBuys({ holdings, cash = 0, buys, sentCents }) {
  let next = holdings;
  let spent = 0;
  for (const b of buys) {
    next = addPosition(next, b.ticker, b.shares, b.costCents);
    spent += b.costCents;
  }
  const leftoverCents = sentCents - spent;
  // Spending a few cents more than the transfer is normal (spare cash already in the account that
  // Ledger may not know about), so cash floors at zero rather than going negative.
  const newCash = Math.max(0, cash + leftoverCents);
  return { holdings: next, cash: newCash, leftoverCents, cashDeltaCents: newCash - cash, spentCents: spent };
}

/** Reverse applyBuys (when a transfer is un-marked as sent). Pass the cashDeltaCents applyBuys returned. */
export function undoBuys({ holdings, cash = 0, buys, cashDeltaCents, leftoverCents = 0 }) {
  let next = holdings;
  for (const b of buys) next = addPosition(next, b.ticker, -b.shares, -b.costCents);
  const delta = Number.isInteger(cashDeltaCents) ? cashDeltaCents : leftoverCents;
  return { holdings: next.filter(h => h.shares > 1e-9), cash: Math.max(0, cash - delta) };
}

/** A dividend: reinvested → more shares (and cost basis); paid out → more cash. */
export function applyDividend({ holdings, cash = 0, ticker, cents, shares = 0 }) {
  if (shares > 0) return { holdings: addPosition(holdings, ticker, shares, cents), cash };
  return { holdings: holdings.map(h => ({ ...h })), cash: cash + cents };
}

/**
 * Your money vs. returns for one account.
 *   returns  = Σ (market value − cost basis) + dividend income
 *   put in   = account value − returns
 * @param {object} p
 * @param {{valueCents: number, costCents?: number}[]} p.positions
 * @param {number} [p.otherCents] cash and transfers not yet invested (all your money)
 * @param {number} [p.incomeCents] dividends/interest received (to date + logged since)
 * @returns {{known: boolean, ...}} known=false when a position has no price or cost basis
 */
export function accountReturns({ positions, otherCents = 0, incomeCents = 0 }) {
  if (!positions.length || positions.some(p => !known(p.costCents) || !Number.isFinite(p.valueCents))) {
    return { known: false, missing: positions.filter(p => !known(p.costCents)).length };
  }
  const market = positions.reduce((a, p) => a + p.valueCents, 0);
  const cost = positions.reduce((a, p) => a + p.costCents, 0);
  const gain = market - cost;
  const value = market + otherCents;
  const returns = gain + incomeCents;
  const invested = value - returns;
  return { known: true, valueCents: value, costCents: cost, gainCents: gain, incomeCents, returnCents: returns, investedCents: invested, returnPct: invested > 0 ? returns / invested : 0 };
}
