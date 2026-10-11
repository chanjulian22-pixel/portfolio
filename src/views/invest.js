import { doc, ui, saveUi, save, newId } from '../store.js';
import { meter, stackBar, chart } from '../charts.js';
import { money, shares, pct, fmtDate, fmtMonth, timeAgo, esc, ICON, openSheet, toast, $ } from '../ui.js';
import { priceOf, prices } from '../prices.js';
import { rebalance, sleeveWeights } from '../domain/rebalance.js';
import { dividendsInYear, dividendCheckMonth, divFreq, fundsDue, DEFAULT_DIV_FREQ } from '../domain/dividends.js';
import { applyBuys, undoBuys, applyDividend, accountReturns } from '../domain/holdings.js';
import { parseCents } from '../domain/money.js';
import { bucketColor, notice } from './common.js';

const normTicker = t => { const s = String(t ?? '').trim().toUpperCase().replace(/\s+/g, ''); return /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(s) ? s : ''; };
const parseShares = v => { const s = String(v ?? '').replace(/[,\s]/g, ''); return s === '' ? NaN : Number(s); };
const rerender = () => window.dispatchEvent(new Event('ledger:render'));
const FREQ_LABEL = { monthly: 'pays monthly', quarterly: 'pays Mar · Jun · Sep · Dec', none: 'no dividends' };

/** The investment account a bucket's money lands in, when that account tracks holdings. */
export function liveAccountFor(bucketId) {
  const b = doc.config.buckets.find(x => x.id === bucketId);
  const id = b?.account || b?.heldIn;
  const a = id && doc.accounts.find(x => x.id === id);
  return a && a.holdings.length ? a : null;
}

/** Transfers marked as sent into an account that haven't been logged as buys yet. */
export const pendingBuys = acctId => doc.contributions
  .filter(c => c.pendingBuy && liveAccountFor(c.bucketId)?.id === acctId)
  .sort((x, y) => x.date.localeCompare(y.date));

/** Your money vs. returns for an account (needs a price and cost basis for every fund). */
export function returnsFor(a, today) {
  const positions = a.holdings.filter(h => h.shares > 0).map(h => {
    const p = priceOf(h.ticker, doc.tickerMeta);
    return { ticker: h.ticker, valueCents: p ? Math.round(h.shares * p.cents) : NaN, costCents: h.costCents };
  });
  const pending = pendingBuys(a.id).filter(c => c.date <= today).reduce((s, c) => s + c.cents, 0);
  const income = (a.incomeCents || 0) + (doc.dividends || []).filter(d => d.accountId === a.id).reduce((s, d) => s + d.cents, 0);
  return accountReturns({ positions, otherCents: (a.cash || 0) + pending, incomeCents: income });
}

/** This month's dividend check, while it's open (the 28th through the 10th) and not done yet. */
export function dividendCheck(m) {
  const month = dividendCheckMonth(m.today);
  if (!month || doc.dividendChecks?.[month]) return null;
  const funds = fundsDue({ accounts: doc.accounts, tickerMeta: doc.tickerMeta, month });
  return funds.length ? { month, funds } : null;
}

/** Remove a sent transfer, undoing any buys logged against it. */
export function removeContribution(c) {
  if (c.buyIds?.length) {
    const buys = doc.purchases.filter(p => c.buyIds.includes(p.id));
    const a = doc.accounts.find(x => x.id === buys[0]?.accountId);
    if (a) {
      const r = undoBuys({ holdings: a.holdings, cash: a.cash, buys, leftoverCents: c.leftoverCents || 0 });
      a.holdings = r.holdings;
      a.cash = r.cash;
    }
    doc.purchases = doc.purchases.filter(p => !c.buyIds.includes(p.id));
  }
  doc.contributions = doc.contributions.filter(x => x !== c);
}

export function investView(m) {
  const liveAccts = doc.accounts.map(a => ({ a, v: m.accountValues[a.id], bucket: m.buckets.find(b => b.account === a.id) }));
  const day = liveAccts.reduce((s, x) => s + (x.v.hasPositions ? x.v.dayCents : 0), 0);
  const base = m.nw.invested - day;
  const year = Number(m.today.slice(0, 4));
  const divYear = dividendsInYear(doc.dividends, year);
  // Put in vs returns, across every account where it's known
  const rets = doc.accounts.filter(a => a.holdings.length).map(a => returnsFor(a, m.today));
  const knownRets = rets.filter(r => r.known);
  const totIn = knownRets.reduce((s, r) => s + r.investedCents, 0);
  const totRet = knownRets.reduce((s, r) => s + r.returnCents, 0);
  let html = `<section class="hero">
    <div class="eyebrow">Invested</div>
    <div class="hero-value">${money(m.nw.invested)}</div>
    <div class="hero-sub">${day ? `<span class="delta ${day >= 0 ? 'good' : 'bad'}">${day >= 0 ? ICON.up : ICON.down}${money(Math.abs(day))} (${pct(base > 0 ? Math.abs(day) / base : 0, 2)})</span><span>today</span>` : ''}
      ${divYear ? `<span>· ${money(divYear)} dividends in ${year}</span>` : ''}
      <span class="muted small">${prices.refreshing ? 'Updating prices…' : m.quoteTime ? `Prices as of ${new Date(m.quoteTime * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${prices.lastRefresh ? ` · ${timeAgo(prices.lastRefresh)}` : ''}` : ''}</span></div>
  </section>`;
  if (knownRets.length) {
    const byAcct = doc.accounts.filter(a => a.holdings.length).map(a => ({ a, r: returnsFor(a, m.today) })).filter(x => x.r.known);
    html += `<div class="card">
      <div class="card-h"><h2>Your money vs. returns</h2><span class="small muted">${knownRets.length < rets.length ? `${knownRets.length} of ${rets.length} accounts` : 'all accounts'}</span></div>
      <div class="tiles" style="margin-bottom:4px">
        <div class="tile" style="box-shadow:none;background:var(--surface-2)"><div class="tile-label"><span class="dot" style="background:var(--s1)"></span>You put in</div><div class="tile-value">${money(totIn, { whole: true })}</div></div>
        <div class="tile" style="box-shadow:none;background:var(--surface-2)"><div class="tile-label"><span class="dot" style="background:var(--s3)"></span>Returns</div><div class="tile-value ${totRet >= 0 ? 'good' : 'bad'}">${money(totRet, { whole: true, sign: true })}</div><div class="tile-note">${pct(totIn > 0 ? totRet / totIn : 0, 1, { sign: true })} overall</div></div>
      </div>
      <div class="between mt16" style="margin-bottom:2px"><span style="font-weight:650">By account</span>
        <span class="chart-legend" style="margin:0"><span><i class="box" style="background:var(--s1)"></i>Put in</span><span><i class="box" style="background:var(--s3)"></i>Returns</span></span></div>
      ${accountBars(byAcct)}
      <div style="font-weight:650;margin:14px 0 8px">Over time</div>
      ${historyChart(m, totIn, totRet, knownRets.length === rets.length)}
      ${knownRets.length < rets.length ? '<p class="note mt12" style="margin-bottom:0">Add cost basis on the other accounts to include them.</p>' : ''}
    </div>`;
  }
  if (!prices.key) html += notice({ icon: ICON.info, text: '<strong>Connect live prices.</strong> Add your free Finnhub API key to value your holdings.', actions: '<button class="btn small primary" data-action="settings-prices">Add key</button>' });
  else if (prices.keyRejected) html += notice({ icon: ICON.alert, text: 'Finnhub rejected your API key.', actions: '<button class="btn small" data-action="settings-prices">Check key</button>' });
  const check = dividendCheck(m);
  if (check) html += notice({ icon: ICON.coins, text: `<strong>Dividend check for ${esc(fmtMonth(check.month, { year: false }))}.</strong> ${esc(check.funds.map(f => f.ticker).join(', '))} paid this month — log the reinvestments from your Schwab receipts.`, actions: `<button class="btn small primary" data-action="dividend-check" data-month="${check.month}">Log dividends</button>` });

  for (const { a, v, bucket } of liveAccts) html += accountCard(m, a, v, bucket);
  html += `<button class="btn block" data-action="add-account">${ICON.plus}Add account</button>`;
  return { title: 'Invest', html, refresh: true };
}

function accountCard(m, a, v, bucket) {
  const bal = bucket ? m.balances[bucket.id] : null;
  const usesLive = v.hasPositions;
  const pending = pendingBuys(a.id);
  const pendingTotal = pending.filter(c => c.date <= m.today).reduce((s, c) => s + c.cents, 0); // same rule as net worth
  const value = usesLive ? v.cents + pendingTotal : bal?.cents ?? 0;
  const rows = a.holdings.map(h => {
    const p = priceOf(h.ticker, doc.tickerMeta);
    return { h, p, value: p ? Math.round(h.shares * p.cents) : null };
  }).sort((x, y) => (y.value ?? -1) - (x.value ?? -1));
  const limitLine = bucket && bucket.kind === 'limited' ? (() => {
    const g = m.goals().find(g => g.bucket.id === bucket.id);
    return g ? `<div class="mt12">${meter(g.current / g.target, { color: bucketColor(bucket), thin: true })}<div class="meter-legend"><span>${g.year} contributions ${money(g.current, { whole: true })} of ${money(g.target, { whole: true })}</span><span>${g.eta === 'done' ? 'Maxed ✓' : `${money(g.target - g.current, { whole: true })} left`}</span></div></div>` : '';
  })() : '';

  let html = `<div class="card flush">
    <div class="card-h" style="align-items:center">
      <div class="row-flex" style="gap:8px">${bucket ? `<span class="dot" style="background:${bucketColor(bucket)}"></span>` : ''}<h2>${esc(a.name)}</h2></div>
      <button class="link" data-action="edit-account" data-id="${esc(a.id)}">Edit${ICON.chevR}</button>
    </div>
    <div style="padding:0 18px 6px">
      <div class="between" style="align-items:flex-end"><div class="big">${money(value)}</div>
        ${usesLive && v.dayCents ? `<span class="delta ${v.dayCents >= 0 ? 'good' : 'bad'} small">${v.dayCents >= 0 ? ICON.up : ICON.down}${money(Math.abs(v.dayCents))}</span>` : ''}</div>
      <div class="small muted">${usesLive ? (bucket ? `Live value · counts as ${esc(bucket.label)}${bal?.carvedCents ? ` (${money(bal.cents)} after ${money(bal.carvedCents)} for ${esc(bal.carvedFor.map(id => m.bucketById[id]?.label).join(', '))})` : ''}` : 'Live value · not linked to a bucket, so not in net worth') : bal ? (bal.source === 'none' ? 'No balance yet — add holdings for a live value' : `From your last balance${bal.snapshotDate ? ` (${esc(fmtDate(bal.snapshotDate))})` : ''} + transfers since — add holdings for a live value`) : 'Add holdings to value this account'}</div>
      ${limitLine}
      ${rows.length ? returnsBlock(m, a) : ''}
    </div>`;
  if (rows.length) {
    html += `<div class="rows plain" style="margin:0">${rows.map(({ h, p, value: hv }) => {
      const label = doc.tickerMeta[h.ticker]?.label;
      return `<button class="row" data-action="edit-holding" data-acct="${esc(a.id)}" data-ticker="${esc(h.ticker)}">
        <span class="row-main"><span class="row-title" style="display:block">${esc(h.ticker)}${label ? ` <span class="muted" style="font-weight:400">${esc(label)}</span>` : ''}</span>
          <span class="row-sub" style="display:block">${shares(h.shares)} sh${p ? ` × ${money(p.cents, { mask: false })}` : ''}</span></span>
        <span class="row-end">${p && Number.isInteger(h.costCents) ? `<span class="v" style="display:block">${money(hv)}</span><span class="s" style="display:block;color:var(--${hv - h.costCents >= 0 ? 'good' : 'bad'})">${money(hv - h.costCents, { sign: true })} (${pct(h.costCents > 0 ? (hv - h.costCents) / h.costCents : 0, 1, { sign: true })})</span>`
          : p ? `<span class="v" style="display:block">${money(hv)}</span><span class="s" style="display:block;${p.live ? `color:var(--${p.changeCents >= 0 ? 'good' : 'bad'})` : ''}">${p.live ? pct(p.changePct, 2, { sign: true }) + ' today' : 'manual price'}</span>`
          : `<span class="v muted" style="display:block">—</span><span class="s" style="display:block">${prices.refreshing ? 'loading' : 'no price'}</span>`}</span>
      </button>`;
    }).join('')}
    ${a.cash ? `<button class="row" data-action="edit-cash" data-acct="${esc(a.id)}"><span class="row-main"><span class="row-title" style="display:block">Cash</span><span class="row-sub" style="display:block">not invested yet</span></span><span class="row-end"><span class="v">${money(a.cash)}</span></span></button>` : ''}
    ${pending.map(c => `<button class="row" data-action="log-buy" data-acct="${esc(a.id)}" data-contrib="${esc(c.id)}">
      <span class="row-main"><span class="row-title" style="display:block">Waiting to be logged</span><span class="row-sub" style="display:block">${esc(fmtDate(c.date))} transfer to ${esc(m.bucketById[c.bucketId]?.label)}</span></span>
      <span class="row-end"><span class="v" style="display:block">${money(c.cents)}</span><span class="s" style="display:block;color:var(--ink)">Log buy ›</span></span>
    </button>`).join('')}
    ${divRow(m, a)}
    </div>`;
  }
  html += rows.length
    ? `<div style="padding:8px 18px 12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-action="log-buy" data-acct="${esc(a.id)}">${ICON.plus}Buy</button><button class="btn small" data-action="log-dividend" data-acct="${esc(a.id)}">${ICON.plus}Dividend</button><button class="btn small" data-action="add-holding" data-acct="${esc(a.id)}">${ICON.plus}Fund</button></div>`
    : `<div style="padding:8px 18px 12px;display:flex;gap:8px"><button class="btn small" data-action="add-holding" data-acct="${esc(a.id)}">${ICON.plus}Holding</button>${a.cash ? '' : `<button class="btn small" data-action="edit-cash" data-acct="${esc(a.id)}">${ICON.plus}Cash</button>`}</div>`;

  if (a.targets?.length) {
    const positions = rows.filter(r => r.value != null).map(r => ({ ticker: r.h.ticker, valueCents: r.value }));
    const w = sleeveWeights({ positions, sleeves: a.targets });
    html += `<div style="padding:4px 18px 8px;border-top:1px solid var(--hairline)">
      <div class="between" style="padding:12px 0 6px"><span style="font-weight:650">Target mix</span><span class="small muted">bar = now · tick = target</span></div>
      ${w.map(s => `<div style="padding:6px 0">
        <div class="between small" style="margin-bottom:6px"><span style="font-size:14.5px">${esc(s.label)} <span class="muted">${esc(s.tickers.join(' + '))}</span></span>
        <span class="num ink2">${positions.length ? pct(s.currentPct, 1) : '—'} <span class="muted">/ ${pct(s.targetPct, 0)}</span></span></div>
        ${meter(s.currentPct, { color: 'var(--s1)', pace: s.targetPct, thin: true })}
      </div>`).join('')}
      ${rebalanceBox(m, a, positions, bucket)}
    </div>`;
  }
  return html + '</div>';
}

/** Part-to-whole: what you put in, and what it has earned on top (a loss shows as a gap). */
function splitBar(inCents, retCents, { tall = true } = {}) {
  return retCents >= 0
    ? stackBar([{ cents: inCents, color: 'var(--s1)', label: 'You put in' }, { cents: retCents, color: 'var(--s3)', label: 'Returns' }], { tall })
    : stackBar([{ cents: inCents + retCents, color: 'var(--s1)', label: 'Value' }, { cents: -retCents, color: 'var(--surface-3)', label: 'Loss' }], { tall });
}

/** One bar per account on a shared scale, so sizes compare: put in + returns. */
function accountBars(list) {
  if (!list.length) return '';
  const max = Math.max(...list.map(x => Math.max(x.r.valueCents, x.r.investedCents)));
  return list.sort((x, y) => y.r.valueCents - x.r.valueCents).map(({ a, r }) => `<div style="padding:7px 0">
    <div class="between small" style="margin-bottom:6px"><span style="font-size:14.5px">${esc(a.name)}</span>
      <span class="num ink2">${money(r.valueCents, { whole: true })} · <span class="${r.returnCents >= 0 ? 'good' : 'bad'}">${money(r.returnCents, { whole: true, sign: true })} (${pct(r.returnPct, 1, { sign: true })})</span></span></div>
    <div style="width:${(Math.max(r.valueCents, r.investedCents) / max * 100).toFixed(1)}%">${splitBar(r.investedCents, r.returnCents, { tall: false })}</div>
  </div>`).join('');
}

/** Put in vs returns over time, from the one-a-day snapshots the app records. */
function historyChart(m, totIn, totRet, complete) {
  const past = doc.history.filter(h => Number.isInteger(h.invIn) && h.date < m.today).map(h => ({ date: h.date, in: h.invIn, ret: h.invRet }));
  const pts = complete ? [...past, { date: m.today, in: totIn, ret: totRet }] : past;
  if (pts.length < 2) {
    return '<p class="note" style="margin:0">Starts today: the app saves one point a day, so this chart fills in as you use it.</p>';
  }
  return chart({
    type: 'lines', stacked: true, height: 170, label: 'What you put in and your returns over time',
    series: [
      { key: 'in', label: 'Put in', color: 'var(--s1)', area: true, areaOpacity: .14, points: pts.map(p => ({ x: p.date, y: p.in })) },
      { key: 'ret', label: 'Returns', color: 'var(--s3)', area: true, areaOpacity: .24, points: pts.map(p => ({ x: p.date, y: Math.max(0, p.ret) })) },
    ],
    tooltip: ({ x }) => {
      const p = pts.find(q => q.date === x);
      return `<b>${esc(money(p.in + p.ret, { whole: true }))}</b>${esc(fmtDate(x, { year: true }))}<div class="k"><i style="background:var(--s1)"></i>${esc(money(p.in, { whole: true }))} put in</div><div class="k"><i style="background:var(--s3)"></i>${esc(money(p.ret, { whole: true, sign: true }))} returns</div>`;
    },
  });
}

/** Totals for the daily history point (only when every account's cost basis is known, so it's consistent). */
export function investmentTotals(today) {
  const rets = doc.accounts.filter(a => a.holdings.length).map(a => returnsFor(a, today));
  if (!rets.length || rets.some(r => !r.known)) return null;
  return { invIn: rets.reduce((s, r) => s + r.investedCents, 0), invRet: rets.reduce((s, r) => s + r.returnCents, 0) };
}

function returnsBlock(m, a) {
  const r = returnsFor(a, m.today);
  if (!r.known) {
    return `<button class="btn small mt12" data-action="cost-basis" data-acct="${esc(a.id)}">${ICON.plus}Add cost basis to see your returns</button>`;
  }
  return `<div class="mt12">${splitBar(r.investedCents, r.returnCents)}
    <div class="meter-legend"><span class="row-flex" style="gap:6px"><span class="dot" style="background:var(--s1)"></span>Put in ${money(r.investedCents)}</span>
      <span class="row-flex" style="gap:6px;font-weight:600"><span class="dot" style="background:var(--s3)"></span><span class="${r.returnCents >= 0 ? 'good' : 'bad'}">${money(r.returnCents, { sign: true })} (${pct(r.returnPct, 1, { sign: true })})</span></span></div>
    <div class="between small muted mt8"><span>${r.incomeCents ? `${money(r.incomeCents)} dividends ${r.gainCents < 0 ? '−' : '+'} ${money(Math.abs(r.gainCents))} price` : `${money(r.gainCents, { sign: true })} price gain`}</span>
      <button class="link" style="font-size:13px" data-action="cost-basis" data-acct="${esc(a.id)}">Cost basis${ICON.chevR.replace('<svg', '<svg width="12" height="12" style="display:inline;vertical-align:-1px"')}</button></div>
  </div>`;
}

/** Cost basis for every fund in one place, plus income earned before you started logging dividends. */
function openCostSheet(m, acctId) {
  const a = doc.accounts.find(x => x.id === acctId);
  if (!a) return;
  openSheet({
    title: `${a.name} cost basis`, submitLabel: 'Save',
    body: `
      <p class="note" style="margin:4px 4px 12px">What you paid for each fund in total, from your brokerage. If it only shows a gain, cost basis = value − gain. From now on, buys and reinvested dividends you log keep it up to date.</p>
      <div class="card">${a.holdings.map(h => {
        const p = priceOf(h.ticker, doc.tickerMeta);
        const v = p ? Math.round(h.shares * p.cents) : null;
        return `<label class="field"><span>${esc(h.ticker)}${v != null ? ` · worth ${money(v, { mask: false })} now` : ''}</span>
          <input name="cb_${esc(h.ticker)}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${Number.isInteger(h.costCents) ? (h.costCents / 100).toFixed(2) : ''}"></label>`;
      }).join('')}</div>
      <label class="field"><span>Dividends & interest earned so far ($)</span>
        <input name="income" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${a.incomeCents ? (a.incomeCents / 100).toFixed(2) : ''}">
        <div class="hint">If your brokerage shows income earned (Chase does for USFR), enter it — it counts as returns, not money you put in. Dividends you log in Ledger are added on top.</div></label>
      <p class="err" id="cb-err"></p>`,
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#cb-err', form).textContent = msg; return false; };
      const next = {};
      for (const h of a.holdings) {
        const raw = f['cb_' + h.ticker].value.trim();
        if (!raw) { next[h.ticker] = undefined; continue; }
        const c = parseCents(raw);
        if (!(c >= 0)) return err(`Check the cost basis for ${h.ticker}.`);
        next[h.ticker] = c;
      }
      const rawInc = f.income.value.trim();
      const inc = rawInc ? parseCents(rawInc) : 0;
      if (!(inc >= 0)) return err('Check the income amount.');
      for (const h of a.holdings) { if (next[h.ticker] == null) delete h.costCents; else h.costCents = next[h.ticker]; }
      if (inc > 0) a.incomeCents = inc; else delete a.incomeCents;
      save();
      toast('Cost basis saved');
      rerender();
    },
  });
}

function divRow(m, a) {
  const list = (doc.dividends || []).filter(d => d.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date));
  if (!list.length) return '';
  const year = Number(m.today.slice(0, 4));
  return `<button class="row" data-action="account-dividends" data-acct="${esc(a.id)}">
    <span class="row-main"><span class="row-title" style="display:block">Dividends</span>
      <span class="row-sub" style="display:block">Last ${money(list[0].cents)} on ${esc(fmtDate(list[0].date))}${list[0].ticker ? ` · ${esc(list[0].ticker)}` : ''}</span></span>
    <span class="row-end"><span class="v good" style="display:block">${money(dividendsInYear(list, year))}</span><span class="s" style="display:block">in ${year}</span></span>
  </button>`;
}

// ---------------------------------------------------------------- log a buy
/**
 * What you bought, from the Schwab receipt. Opened when you mark a transfer to an investment
 * account as sent (pre-filled from your target mix), or from the account's Buy button
 * (spending cash already in the account).
 */
export function openBuySheet(m, acctId, contribId = null) {
  const a = doc.accounts.find(x => x.id === acctId);
  if (!a) return;
  const c = contribId ? doc.contributions.find(x => x.id === contribId) : null;
  const sent = c ? c.cents : 0;
  const positions = a.holdings.map(h => { const p = priceOf(h.ticker, doc.tickerMeta); return p ? { ticker: h.ticker, valueCents: Math.round(h.shares * p.cents) } : null; }).filter(Boolean);
  let rows = [];
  if (sent > 0 && a.targets?.length) {
    rows = rebalance({ positions, sleeves: a.targets, newCashCents: sent }).rows.filter(r => r.investCents > 0).map(r => ({ ticker: r.ticker, cost: r.investCents }));
  } else if (sent > 0) {
    const top = [...positions].sort((x, y) => y.valueCents - x.valueCents)[0]?.ticker || a.holdings[0]?.ticker;
    if (top) rows = [{ ticker: top, cost: sent }];
  }
  rows = rows.map(r => { const p = priceOf(r.ticker, doc.tickerMeta); return { ...r, shares: p ? (r.cost / p.cents).toFixed(4) : '' }; });
  while (rows.length < 3) rows.push({ ticker: '', cost: 0, shares: '' });
  const tickers = [...new Set([...a.holdings.map(h => h.ticker), ...(a.targets || []).flatMap(s => s.tickers)])];
  const bucket = c ? m.bucketById[c.bucketId] : null;

  openSheet({
    title: c ? 'What did you buy?' : `Buy in ${a.name}`,
    submitLabel: 'Save',
    body: `
      <p class="note" style="margin:4px 4px 12px">${c
        ? `${money(sent, { mask: false })} sent to ${esc(bucket?.label || a.name)} on ${esc(fmtDate(c.date))}. Enter the shares and cost from Schwab’s receipt — the rows below are a suggestion${a.targets?.length ? ' from your target mix' : ''} at today’s price.`
        : `Buying with cash already in ${esc(a.name)}${a.cash ? ` (${money(a.cash, { mask: false })} available)` : ''}. Enter the shares and cost from Schwab’s receipt.`}</p>
      <div class="card" style="padding:14px">
        <div class="amount-grid" style="grid-template-columns:1fr 1fr 1fr"><span class="h">Fund</span><span class="h" style="text-align:right">Shares</span><span class="h" style="text-align:right">Cost ($)</span>
        ${rows.map((r, i) => `<input name="tk_${i}" list="buy-tickers" autocapitalize="characters" autocomplete="off" placeholder="—" value="${esc(r.ticker)}" style="text-align:left">
          <input name="sh_${i}" inputmode="decimal" autocomplete="off" placeholder="0.0000" value="${esc(r.shares)}">
          <input name="co_${i}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${r.cost ? (r.cost / 100).toFixed(2) : ''}">`).join('')}
        </div>
        <datalist id="buy-tickers">${tickers.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      </div>
      <div class="small ink2" id="buy-sum" style="margin:0 4px 12px"></div>
      <p class="err" id="buy-err"></p>
      ${c ? '<button type="button" class="btn block" id="buy-later">Log it later</button><p class="note" style="text-align:center">Until you log it, the transfer counts as cash in the account.</p>' : ''}`,
    onMount: (root, sheet) => {
      const f = sheet.form.elements;
      const sum = () => {
        let spent = 0;
        for (let i = 0; i < rows.length; i++) { const v = parseCents(f['co_' + i].value || '0'); if (Number.isFinite(v)) spent += v; }
        const left = sent - spent;
        $('#buy-sum', root).textContent = c
          ? `Spent ${money(spent, { mask: false })} of ${money(sent, { mask: false })}${left > 0 ? ` · ${money(left, { mask: false })} stays as cash` : left < 0 ? ` · ${money(-left, { mask: false })} comes from cash already in the account` : ''}`
          : `Spent ${money(spent, { mask: false })} from the account’s cash`;
      };
      root.addEventListener('input', sum);
      sum();
      $('#buy-later', root)?.addEventListener('click', () => { sheet.close(); toast('Saved — log the buy from Invest when it fills'); });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#buy-err', form).textContent = msg; return false; };
      const buys = [];
      for (let i = 0; i < rows.length; i++) {
        const raw = [f['tk_' + i].value, f['sh_' + i].value, f['co_' + i].value].map(s => s.trim());
        if (!raw.some(Boolean)) continue;
        const t = normTicker(raw[0]), sh = parseShares(raw[1]), co = parseCents(raw[2]);
        if (!t) return err(`Row ${i + 1}: enter the fund’s ticker.`);
        if (!(sh > 0)) return err(`${t}: enter the shares from the receipt.`);
        if (!(co > 0)) return err(`${t}: enter what it cost.`);
        buys.push({ ticker: t, shares: sh, costCents: co });
      }
      if (!buys.length) return err('Enter at least one fund — or tap “Log it later”.');
      const spent = buys.reduce((s, b) => s + b.costCents, 0);
      if (spent - sent > a.cash) return err(`That’s ${money(spent - sent - a.cash, { mask: false })} more than the transfer plus the account’s cash.`);
      const r = applyBuys({ holdings: a.holdings, cash: a.cash, buys, sentCents: sent });
      a.holdings = r.holdings;
      a.cash = r.cash;
      const ids = buys.map(b => {
        const id = newId('b');
        doc.purchases.push({ id, date: m.today, accountId: a.id, ticker: b.ticker, shares: b.shares, costCents: b.costCents, ...(c ? { contributionId: c.id } : {}) });
        return id;
      });
      if (c) { c.pendingBuy = false; c.buyIds = ids; c.leftoverCents = r.leftoverCents; }
      save();
      toast(`Logged ${buys.map(b => `${b.ticker} +${+b.shares.toFixed(4)}`).join(', ')}`);
      rerender();
    },
  });
}

// ---------------------------------------------------------------- log dividends
/** Dividend reinvestments from Schwab receipts — for the monthly check, or one account any time. */
export function openDividendSheet(m, { month = null, acctId = null } = {}) {
  const rows = acctId
    ? doc.accounts.filter(a => a.id === acctId).flatMap(a => a.holdings.filter(h => h.shares > 0).map(h => ({ accountId: a.id, accountName: a.name, ticker: h.ticker })))
    : fundsDue({ accounts: doc.accounts, tickerMeta: doc.tickerMeta, month });
  openSheet({
    title: month ? `${fmtMonth(month, { year: false })} dividends` : 'Log a dividend',
    submitLabel: 'Save',
    body: `
      <p class="note" style="margin:4px 4px 12px">From your Schwab dividend receipts: the amount, and the shares it bought if it was reinvested. Leave shares empty if it was paid as cash, and leave a fund blank if it didn’t pay.</p>
      ${rows.map((r, i) => `<div class="card" style="padding:14px">
        <div class="between"><strong>${esc(r.ticker)}</strong><span class="small muted">${esc(r.accountName)} · ${esc(FREQ_LABEL[divFreq(r.ticker, doc.tickerMeta)])}</span></div>
        <div class="grid2 mt8">
          <label class="field mb0"><span>Amount ($)</span><input name="amt_${i}" inputmode="decimal" autocomplete="off" placeholder="0.00"></label>
          <label class="field mb0"><span>Shares reinvested</span><input name="sh_${i}" inputmode="decimal" autocomplete="off" placeholder="0.0000"></label>
        </div></div>`).join('') || '<div class="empty">No holdings here yet.</div>'}
      <p class="err" id="div-err"></p>
      ${month ? '<button type="button" class="btn block" id="div-none">Nothing was paid this month</button>' : ''}`,
    onMount: (root, sheet) => {
      $('#div-none', root)?.addEventListener('click', () => {
        doc.dividendChecks[month] = true;
        save(); sheet.close(); toast('Dividend check done'); rerender();
      });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#div-err', form).textContent = msg; return false; };
      const entries = [];
      for (let i = 0; i < rows.length; i++) {
        const a = f['amt_' + i].value.trim(), s = f['sh_' + i].value.trim();
        if (!a && !s) continue;
        const cents = parseCents(a);
        if (!(cents > 0)) return err(`${rows[i].ticker}: enter the dividend amount.`);
        const sh = s ? parseShares(s) : 0;
        if (!(sh >= 0)) return err(`${rows[i].ticker}: check the shares.`);
        entries.push({ ...rows[i], cents, shares: sh });
      }
      if (!entries.length) return err(month ? 'Enter at least one dividend, or tap “Nothing was paid this month”.' : 'Enter the dividend amount.');
      for (const e of entries) {
        const acct = doc.accounts.find(x => x.id === e.accountId);
        const r = applyDividend({ holdings: acct.holdings, cash: acct.cash, ticker: e.ticker, cents: e.cents, shares: e.shares });
        acct.holdings = r.holdings;
        acct.cash = r.cash;
        doc.dividends.push({ id: newId('d'), date: m.today, month: month || m.today.slice(0, 7), accountId: e.accountId, ticker: e.ticker, cents: e.cents, shares: e.shares || undefined });
      }
      if (month) doc.dividendChecks[month] = true;
      save();
      toast(`Logged ${money(entries.reduce((s, e) => s + e.cents, 0), { mask: false })} in dividends`);
      rerender();
    },
  });
}

function openDividendsSheet(m, acctId) {
  const a = doc.accounts.find(x => x.id === acctId);
  const body = () => {
    const list = (doc.dividends || []).filter(d => d.accountId === acctId).sort((x, y) => y.date.localeCompare(x.date));
    const years = [...new Set(list.map(d => d.date.slice(0, 4)))];
    return `${years.map(y => `<div class="group-h between"><span>${y}</span><span class="num">${money(dividendsInYear(list, Number(y)), { mask: false })}</span></div>
      <div class="card flush"><div class="rows plain" style="margin:0">${list.filter(d => d.date.startsWith(y)).map(d => `<div class="row">
        <span class="row-main"><span class="row-title" style="display:block">${esc(d.ticker || (d.tickers || []).join(', ') || 'Dividend')}</span><span class="row-sub" style="display:block">${esc(fmtDate(d.date, { year: true }))}${d.shares ? ` · +${+Number(d.shares).toFixed(4)} sh reinvested` : ' · cash'}</span></span>
        <span class="row-end"><span class="v good">${money(d.cents, { mask: false })}</span></span>
        <button type="button" class="icon-btn" data-del-div="${esc(d.id)}" aria-label="Delete" style="width:32px;height:32px;color:var(--muted)">${ICON.x}</button></div>`).join('')}</div></div>`).join('') || '<div class="empty">No dividends logged yet.</div>'}
      <p class="note mt12">Deleting a record here doesn’t change your share count — fix that on the fund if needed.</p>`;
  };
  openSheet({
    title: `${a.name} dividends`, body: body(), live: body,
    onMount: root => root.addEventListener('click', e => {
      const d = e.target.closest('[data-del-div]');
      if (!d || !confirm('Delete this dividend record?')) return;
      doc.dividends = doc.dividends.filter(x => x.id !== d.dataset.delDiv);
      save();
      rerender();
    }),
  });
}

function rebalanceBox(m, a, positions, bucket) {
  ui.rebal = ui.rebal || {};
  let amount = ui.rebal[a.id];
  let hint = '';
  if (!Number.isInteger(amount) && bucket) {
    // Default: what the plan sends this bucket over the next two paychecks.
    amount = 0;
    for (const pd of m.upcoming.slice(0, 2)) amount += (m.planFor(pd).lines || []).find(l => l.bucketId === bucket.id)?.cents || 0;
    hint = amount ? 'next two paychecks' : '';
  }
  amount = amount || 0;
  const r = amount > 0 ? rebalance({ positions, sleeves: a.targets, newCashCents: amount }) : null;
  return `<div style="background:var(--surface-2);border-radius:14px;padding:12px 14px;margin:10px 0 6px">
    <div class="between"><span style="font-weight:650">Next contribution</span>
      <button class="text-btn strong" style="height:auto;padding:0" data-action="rebal-amount" data-acct="${esc(a.id)}">${amount ? money(amount, { mask: false }) : 'Set amount'}${ICON.chevR.replace('<svg', '<svg width="14" height="14" style="display:inline;vertical-align:-2px"')}</button></div>
    ${hint ? `<div class="small muted">${esc(hint)}</div>` : ''}
    ${r ? `<div class="legend" style="margin-top:6px">${r.rows.filter(x => x.investCents > 0).map(x => {
      const p = priceOf(x.ticker, doc.tickerMeta);
      return `<div class="legend-row" style="border-color:var(--hairline)"><span class="lbl">Buy ${esc(x.ticker)}<small>${esc(x.sleeve)}${p ? ` · ≈ ${(x.investCents / p.cents).toFixed(3)} sh` : ''}</small></span><span class="val">${money(x.investCents, { mask: false })}<small>→ ${pct(x.afterPct, 1)}</small></span></div>`;
    }).join('')}</div><p class="note" style="margin:6px 0 0">Fills the most underweight funds first. Nothing gets sold${a.targets.some(s => s.prefer) ? `; new ${esc(a.targets.filter(s => s.prefer).map(s => s.tickers.join('/')).join(', '))} money goes to ${esc(a.targets.filter(s => s.prefer).map(s => s.prefer).join(', '))}` : ''}.</p>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- sheets
function openHoldingSheet(m, acctId, ticker) {
  const a = doc.accounts.find(x => x.id === acctId);
  if (!a) return;
  const h = ticker ? a.holdings.find(x => x.ticker === ticker) : null;
  const meta = (h && doc.tickerMeta[h.ticker]) || {};
  const freq = h ? divFreq(h.ticker, doc.tickerMeta) : 'quarterly';
  openSheet({
    title: h ? h.ticker : `Add to ${a.name}`,
    submitLabel: 'Save',
    body: `
      <label class="field"><span>Ticker</span><input name="ticker" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="15" placeholder="e.g. VOO" value="${esc(h?.ticker || '')}"></label>
      <label class="field"><span>Shares</span><input name="shares" inputmode="decimal" placeholder="0" value="${h ? h.shares : ''}">
        ${h ? '<div class="hint">For a purchase or a dividend, use Buy or Dividend on the account instead — this is for corrections.</div>' : ''}</label>
      <label class="field"><span>Pays dividends</span><select name="divFreq">
        <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Monthly</option>
        <option value="quarterly" ${freq === 'quarterly' ? 'selected' : ''}>Quarterly (Mar, Jun, Sep, Dec)</option>
        <option value="none" ${freq === 'none' ? 'selected' : ''}>Doesn’t pay</option></select>
        <div class="hint">Decides when the monthly dividend check asks about this fund.</div></label>
      <label class="check"><input type="checkbox" name="manual" ${Number.isFinite(meta.manual) ? 'checked' : ''}> No live quote (e.g. a 401(k) trust fund) — I’ll enter the price</label>
      <label class="field" id="h-price" ${Number.isFinite(meta.manual) ? '' : 'hidden'}><span>Price per share</span><input name="price" inputmode="decimal" placeholder="0.00" value="${Number.isFinite(meta.manual) ? meta.manual : ''}"></label>
      <label class="field"><span>Name (optional)</span><input name="label" maxlength="60" placeholder="e.g. Vanguard S&amp;P 500 ETF" value="${esc(meta.label || '')}"></label>
      <p class="note">Price, name and dividend schedule are shared by this ticker in every account.</p>
      <p class="err" id="h-err"></p>
      ${h ? `<button type="button" class="btn danger block mt16" id="h-del">${ICON.trash}Remove ${esc(h.ticker)}</button>` : ''}`,
    onMount: (root, sheet) => {
      const f = sheet.form.elements;
      f.manual.addEventListener('change', () => { $('#h-price', root).hidden = !f.manual.checked; });
      f.ticker.addEventListener('change', () => {
        const t = normTicker(f.ticker.value);
        if (t) f.ticker.value = t;
        const mm = doc.tickerMeta[t];
        if (!h && mm?.label && !f.label.value) f.label.value = mm.label;
        if (!h && t) f.divFreq.value = divFreq(t, doc.tickerMeta);
      });
      $('#h-del', root)?.addEventListener('click', () => {
        if (!confirm(`Remove ${h.ticker} from ${a.name}?`)) return;
        a.holdings = a.holdings.filter(x => x !== h);
        save(); sheet.close(); rerender();
      });
      if (!h) setTimeout(() => f.ticker.focus(), 350);
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#h-err', form).textContent = msg; return false; };
      const t = normTicker(f.ticker.value);
      if (!t) return err('Enter a ticker like VOO.');
      const sh = parseShares(f.shares.value);
      if (!Number.isFinite(sh) || sh < 0) return err('Enter how many shares you own.');
      if (t !== h?.ticker && a.holdings.some(x => x.ticker === t)) return err(`${t} is already in ${a.name}.`);
      let manual;
      if (f.manual.checked) {
        manual = Number(String(f.price.value).replace(/[$,\s]/g, ''));
        if (!Number.isFinite(manual) || manual < 0) return err('Enter the price per share.');
      }
      if (h) { h.ticker = t; h.shares = sh; } else a.holdings.push({ ticker: t, shares: sh });
      const meta2 = { ...(doc.tickerMeta[t] || {}) };
      if (manual != null) meta2.manual = manual; else delete meta2.manual;
      const label = f.label.value.trim();
      if (label) meta2.label = label; else delete meta2.label;
      if (f.divFreq.value === (DEFAULT_DIV_FREQ[t] || 'quarterly')) delete meta2.divFreq; else meta2.divFreq = f.divFreq.value;
      doc.tickerMeta[t] = meta2;
      save();
      window.dispatchEvent(new CustomEvent('ledger:render', { detail: { refreshPrices: manual == null ? [t] : [] } }));
    },
  });
}

function openCashSheet(acctId) {
  const a = doc.accounts.find(x => x.id === acctId);
  openSheet({
    title: `Cash in ${a.name}`, submitLabel: 'Save',
    body: `<div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" placeholder="0.00" value="${a.cash ? (a.cash / 100).toFixed(2) : ''}"></div><p class="note" style="text-align:center">Money in the account that isn’t invested yet.</p><p class="err" id="c-err"></p>`,
    onSubmit: form => {
      const raw = form.elements.amount.value.trim();
      const c = raw === '' ? 0 : parseCents(raw);
      if (!Number.isFinite(c) || c < 0) { $('#c-err', form).textContent = 'Enter an amount.'; return false; }
      a.cash = c; save(); rerender();
    },
  });
}

function openAccountSheet(m, acctId) {
  const a = acctId ? doc.accounts.find(x => x.id === acctId) : null;
  const linked = a ? m.buckets.find(b => b.account === a.id) : null;
  const sleeves = a?.targets?.length ? a.targets : [];
  const sleeveRow = (s, i) => `<div class="grid2" data-sleeve="${i}" style="grid-template-columns:1.2fr 1fr 64px;align-items:end;margin-bottom:8px">
      <label class="field mb0"><span>${i === 0 ? 'Funds' : ''}</span><input name="tk${i}" placeholder="VOO" value="${esc(s.tickers.join(', '))}" autocapitalize="characters"></label>
      <label class="field mb0"><span>${i === 0 ? 'Label' : ''}</span><input name="lb${i}" placeholder="S&amp;P 500" value="${esc(s.label || '')}"></label>
      <label class="field mb0"><span>${i === 0 ? '%' : ''}</span><input name="pc${i}" inputmode="decimal" value="${s.pct ?? ''}"></label>
    </div>`;
  const rowsN = Math.max(4, sleeves.length + 1);
  // Buckets without an account of their own whose money could be sitting in this one.
  const carveable = m.buckets.filter(b => b.kind !== 'expense' && b.kind !== 'pretax' && !b.account);
  openSheet({
    title: a ? a.name : 'New account', submitLabel: 'Save',
    body: `
      <label class="field"><span>Name</span><input name="name" maxlength="40" value="${esc(a?.name || '')}" placeholder="e.g. Fidelity"></label>
      <label class="field"><span>Counts as bucket</span><select name="bucket"><option value="">Not linked (not in net worth)</option>${m.buckets.filter(b => b.kind !== 'expense').map(b => `<option value="${esc(b.id)}" ${linked?.id === b.id ? 'selected' : ''} ${b.account && b.account !== a?.id ? 'disabled' : ''}>${esc(b.label)}${b.account && b.account !== a?.id ? ' (linked elsewhere)' : ''}</option>`).join('')}</select>
        <div class="hint">When linked and the account has holdings, its live value becomes that bucket’s balance.</div></label>
      ${carveable.length ? `<div class="field"><span>This account also holds money for</span>
        ${carveable.map(b => `<label class="check" style="margin:2px 0 6px"><input type="checkbox" name="held_${esc(b.id)}" ${b.heldIn && b.heldIn === a?.id ? 'checked' : ''}> ${esc(b.label)}</label>`).join('')}
        <div class="hint">e.g. a travel fund kept in the same account. Its balance is taken out of this account’s bucket so nothing counts twice.</div></div>` : ''}
      <div class="group-h">Target mix (optional)</div>
      ${Array.from({ length: rowsN }, (_, i) => sleeveRow(sleeves[i] || { tickers: [], label: '', pct: '' }, i)).join('')}
      <p class="note">Several funds in one row share a target (e.g. “QQQ, QQQM”); new money goes to the last one listed. Percents should add to 100.</p>
      <p class="err" id="a-err"></p>
      ${a ? `<button type="button" class="btn danger block mt16" id="a-del">${ICON.trash}Delete account</button>` : ''}`,
    onMount: (root, sheet) => {
      $('#a-del', root)?.addEventListener('click', () => {
        if (!confirm(`Delete ${a.name} and its holdings?`)) return;
        doc.accounts = doc.accounts.filter(x => x !== a);
        for (const b of doc.config.buckets) {
          if (b.account === a.id) delete b.account;
          if (b.heldIn === a.id) delete b.heldIn;
        }
        save(); sheet.close(); rerender();
      });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#a-err', form).textContent = msg; return false; };
      const name = f.name.value.trim();
      if (!name) return err('Give the account a name.');
      const targets = [];
      for (let i = 0; i < rowsN; i++) {
        const tickers = f['tk' + i].value.split(/[,\s]+/).map(normTicker).filter(Boolean);
        if (!tickers.length) continue;
        const p = Number(f['pc' + i].value);
        if (!Number.isFinite(p) || p <= 0) return err(`Enter a percent for ${tickers.join(', ')}.`);
        targets.push({ label: f['lb' + i].value.trim(), tickers, pct: p, ...(tickers.length > 1 ? { prefer: tickers[tickers.length - 1] } : {}) });
      }
      const total = targets.reduce((s, x) => s + x.pct, 0);
      if (targets.length && Math.abs(total - 100) > 0.01) return err(`Target percents add to ${total}%, not 100%.`);
      const acct = a || { id: newId('a'), cash: 0, holdings: [] };
      acct.name = name;
      acct.targets = targets;
      if (!a) doc.accounts.push(acct);
      for (const b of doc.config.buckets) if (b.account === acct.id) delete b.account;
      if (f.bucket.value) doc.config.buckets.find(b => b.id === f.bucket.value).account = acct.id;
      for (const b of doc.config.buckets) {
        const box = f['held_' + b.id];
        if (!box) continue;
        if (box.checked && b.id !== f.bucket.value) b.heldIn = acct.id;
        else if (b.heldIn === acct.id) delete b.heldIn;
      }
      save(); rerender();
    },
  });
}

export const investActions = {
  'cost-basis': (el, m) => openCostSheet(m, el.dataset.acct),
  'log-buy': (el, m) => openBuySheet(m, el.dataset.acct, el.dataset.contrib || null),
  'log-dividend': (el, m) => openDividendSheet(m, { acctId: el.dataset.acct }),
  'dividend-check': (el, m) => openDividendSheet(m, { month: el.dataset.month }),
  'account-dividends': (el, m) => openDividendsSheet(m, el.dataset.acct),
  'add-holding': (el, m) => openHoldingSheet(m, el.dataset.acct, null),
  'edit-holding': (el, m) => openHoldingSheet(m, el.dataset.acct, el.dataset.ticker),
  'edit-cash': el => openCashSheet(el.dataset.acct),
  'edit-account': (el, m) => openAccountSheet(m, el.dataset.id),
  'add-account': (el, m) => openAccountSheet(m, null),
  'rebal-amount': el => {
    const id = el.dataset.acct;
    openSheet({
      title: 'Amount to invest', submitLabel: 'Done',
      body: `<div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" placeholder="0.00" value="${ui.rebal?.[id] ? (ui.rebal[id] / 100).toFixed(2) : ''}"></div><p class="note" style="text-align:center">Leave empty to use what your plan sends here.</p>`,
      onMount: (root, sheet) => setTimeout(() => sheet.form.elements.amount.focus(), 350),
      onSubmit: form => {
        const raw = form.elements.amount.value.trim();
        ui.rebal = ui.rebal || {};
        if (!raw) delete ui.rebal[id]; else { const c = parseCents(raw); if (Number.isFinite(c) && c > 0) ui.rebal[id] = c; }
        saveUi(); rerender();
      },
    });
  },
};
