import { doc, ui, saveUi, save } from '../store.js';
import { chart, meter, stackBar } from '../charts.js';
import { money, compact, fmtDate, fmtMonth, relDays, esc, ICON, $ } from '../ui.js';
import { daysBetween, monthKey, parts, paydaysInMonth, addDays, addMonths, daysInMonth } from '../domain/dates.js';
import { isAsset } from '../domain/allocation.js';
import { txRow, sortTx, notice, bucketColor, deltaHtml } from './common.js';
import { dividendCheck, pendingBuys, returnsFor } from './invest.js';
import { outstandingWork } from '../domain/spending.js';
import { cardAlerts } from './cards.js';

export function homeView(m) {
  if (!m.hasData) return { title: 'Ledger', html: onboarding() };
  let html = '';
  html += netWorthSection(m);
  html += tiles(m);
  html += spendingCard(m);
  html += paycheckCard(m);
  html += alertsCard(m);
  html += goalsCard(m);
  html += recentCard(m);
  return { title: greeting(), html, fab: true };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function onboarding() {
  return `
    <section class="hero"><div class="hero-value" style="font-size:34px">Welcome to Ledger</div>
      <p class="ink2" style="margin:6px 0 0">Your money in one place: paychecks, spending, investments and goals. Everything stays on this phone.</p></section>
    <div class="card">
      <div class="row-flex"><span class="avatar round">1</span><div class="row-main"><div class="row-title">Import your data file</div><div class="row-sub">Your plan, spreadsheet history and balances</div></div></div>
      <button class="btn primary block mt12" data-action="import">Import data file</button>
    </div>
    <div class="card">
      <div class="row-flex"><span class="avatar round">2</span><div class="row-main"><div class="row-title">Or start from scratch</div><div class="row-sub">Add your salary and savings buckets</div></div></div>
      <button class="btn block mt12" data-action="settings">Open settings</button>
    </div>
    <div class="card">
      <div class="row-flex"><span class="avatar round">3</span><div class="row-main"><div class="row-title">Live prices</div><div class="row-sub">Add a free Finnhub key for stock & ETF prices</div></div></div>
      <button class="btn block mt12" data-action="settings-prices">Add API key</button>
    </div>`;
}

// ---------------------------------------------------------------- net worth
function netWorthSection(m) {
  const horizon = ui.horizon || 24;
  const proj = m.projection(horizon);
  const liab = m.nw.liabilities;
  const hist = doc.history.filter(h => h.date < m.today).sort((a, b) => a.date.localeCompare(b.date));
  const actual = [...hist.map(h => ({ x: h.date, y: h.total })), { x: m.today, y: m.nw.total }];
  const projected = proj ? proj.points.map(p => ({ x: p.date, y: p.total - liab })) : [];
  if (projected.length) projected[0] = { x: m.today, y: m.nw.total };

  // Change vs about a month ago, else vs the first point on record.
  const monthAgo = addDays(m.today, -28);
  const ref = [...hist].reverse().find(h => h.date <= monthAgo) || hist[0];
  const delta = ref ? m.nw.total - ref.total : null;
  const deltaLabel = ref ? (ref.date === hist[0]?.date && ref.date > addDays(m.today, -45) ? `since ${fmtDate(ref.date)}` : `since ${fmtDate(ref.date)}`) : '';

  const spec = {
    type: 'lines', height: 190, label: 'Net worth over time, with projection', yZero: true,
    todayX: projected.length ? m.today : null,
    series: [
      { key: 'actual', label: 'Net worth', color: 'var(--s1)', points: actual, area: true, endDot: m.today },
      { key: 'proj', label: 'Projected', color: 'var(--s1)', points: projected, dashed: true },
    ],
    tooltip: ({ x, values }) => {
      const v = values.find(v => v.key === 'actual') || values[0];
      return `<b>${esc(money(v.y, { whole: true }))}</b>${esc(fmtDate(x, { year: true }))}${x > m.today ? ' · projected' : ''}`;
    },
    onScrub: info => {
      const lab = $('#nw-label'), val = $('#nw-value'), sub = $('#nw-sub');
      if (!lab) return;
      if (!info) { lab.textContent = 'Net worth'; val.textContent = money(m.nw.total); sub.style.visibility = ''; return; }
      const v = info.values.find(v => v.key === 'actual') || info.values[0];
      lab.textContent = info.x > m.today ? `Projected · ${fmtMonth(info.x.slice(0, 7))}` : info.x === m.today ? 'Net worth · today' : `Net worth · ${fmtDate(info.x, { year: true })}`;
      val.textContent = money(v.y);
      sub.style.visibility = 'hidden';
    },
  };
  const end = projected[projected.length - 1];
  return `
    <section class="hero">
      <div class="eyebrow" id="nw-label">Net worth</div>
      <div class="hero-value" id="nw-value">${money(m.nw.total)}</div>
      <div class="hero-sub" id="nw-sub">${deltaHtml(delta, ref?.total, deltaLabel)}</div>
    </section>
    <div class="card">
      <div class="between" style="margin-bottom:10px">
        <div class="chart-legend" style="margin:0"><span><i style="background:var(--s1)"></i>Actual</span>${projected.length ? '<span style="color:var(--ink-2)"><i class="dash" style="color:var(--s1)"></i>Projected</span>' : ''}</div>
        <div class="seg" style="width:150px">${[[12, '1Y'], [24, '2Y'], [60, '5Y']].map(([n, l]) => `<button type="button" class="${horizon === n ? 'on' : ''}" data-action="horizon" data-n="${n}">${l}</button>`).join('')}</div>
      </div>
      ${chart(spec)}
      ${end ? `<p class="note" style="margin:10px 0 0">On plan, about <strong class="ink2">${compact(end.y)}</strong> by ${fmtMonth(end.x.slice(0, 7))}${proj ? `, of which ${compact(proj.points[proj.points.length - 1].growth)} is market growth` : ''}.</p>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- KPI tiles
function tiles(m) {
  const { y, m: mo } = parts(m.today);
  const month = monthKey(m.today);
  let planned = 0, payroll = 0;
  for (const pd of paydaysInMonth(y, mo)) {
    const plan = m.planFor(pd);
    for (const l of plan.lines || []) if (isAsset(m.bucketById[l.bucketId])) planned += l.cents;
    planned += (plan.deferralCents || 0) + (plan.matchCents || 0);
    if (pd.date <= m.today) payroll += (plan.deferralCents || 0) + (plan.matchCents || 0);
  }
  let saved = payroll;
  for (const c of doc.contributions) {
    if (monthKey(c.date) === month && c.date <= m.today && isAsset(m.bucketById[c.bucketId])) saved += c.cents;
  }
  const owe = m.loans.filter(l => l.direction === 'i-owe').reduce((a, l) => a + l.balance, 0);
  const small = icon => icon.replace('<svg', '<svg width="14" height="14"');
  // Each cash bucket gets its own tile (e.g. an emergency reserve and an instant-access account are different jobs).
  const cashTiles = m.buckets.filter(b => b.assetClass === 'cash' && b.kind !== 'revolving' && m.balances[b.id]).map(b => {
    const bal = m.balances[b.id].cents;
    const note = Number.isInteger(b.targetCents) && b.targetCents > 0
      ? `${Math.round((bal / b.targetCents) * 100)}% of ${money(b.targetCents, { whole: true })} target`
      : (b.purpose || '').split('·')[0].trim();
    return `<button class="tile" data-tab="goals" style="text-align:left"><div class="tile-label"><span class="dot" style="background:${bucketColor(b)}"></span>${esc(b.label)}</div><div class="tile-value">${money(bal, { whole: true })}</div><div class="tile-note">${esc(note)}</div></button>`;
  });
  const runwayFrom = m.buckets.filter(b => b.assetClass === 'cash' && b.kind !== 'revolving').map(b => b.label).join(' + ');
  // Returns on the stock accounts (Roth, taxable, 401(k)) where cost basis is known
  const equityAccts = m.buckets.filter(b => b.assetClass === 'equity' && b.account).map(b => doc.accounts.find(a => a.id === b.account)).filter(a => a?.holdings.length);
  const eqRets = equityAccts.map(a => returnsFor(a, m.today)).filter(r => r.known);
  const eqReturn = eqRets.reduce((s, r) => s + r.returnCents, 0);
  const investedNote = eqRets.length ? `${money(eqReturn, { whole: true, sign: true })} returns` : 'Roth, taxable & 401(k)';
  return `<div class="tiles">
    <button class="tile" data-tab="invest" style="text-align:left"><div class="tile-label">${small(ICON.invest)}Invested</div><div class="tile-value">${money(m.nw.invested, { whole: true })}</div><div class="tile-note${eqRets.length ? (eqReturn >= 0 ? ' good' : ' bad') : ''}">${esc(investedNote)}</div></button>
    <button class="tile" data-tab="plan" style="text-align:left"><div class="tile-label">${small(ICON.coins)}Saved in ${fmtMonth(month, { short: true, year: false })}</div><div class="tile-value">${money(saved, { whole: true })}</div><div class="tile-note">${planned ? `of ${money(planned, { whole: true })} planned` : 'Mark transfers in Plan'}</div></button>
    ${cashTiles.join('')}
    ${m.runway != null ? `<button class="tile" data-tab="goals" style="text-align:left"><div class="tile-label">${small(ICON.shield)}Runway</div><div class="tile-value">${m.runway.toFixed(1)} months</div><div class="tile-note">${esc(runwayFrom)} ÷ ${money(m.burn, { whole: true })}/mo</div></button>` : ''}
    <button class="tile" data-action="loans" style="text-align:left"><div class="tile-label">${small(ICON.bank)}You owe</div><div class="tile-value">${money(owe, { whole: true })}</div><div class="tile-note">${m.loans.length ? esc(m.loans.map(l => l.name).join(', ')) : 'No loans'}</div></button>
  </div>`;
}

// ---------------------------------------------------------------- spending
function spendingCard(m) {
  const month = monthKey(m.today);
  const s = m.monthSummary(month);
  const budget = m.monthBudget(month).cents;
  const { y, m: mo, d } = parts(m.today);
  const days = daysInMonth(y, mo);
  const left = budget - s.spent;
  const daysLeft = days - d + 1;
  const pace = d / days;
  const over = budget > 0 && s.spent > budget;
  const ahead = budget > 0 && s.spent > budget * pace * 1.1;
  const status = !budget ? '' : over ? `<span class="pill bad">${ICON.alert}Over budget</span>` : ahead ? `<span class="pill warn">${ICON.alert}Ahead of pace</span>` : `<span class="pill good">${ICON.check}On track</span>`;
  return `<button class="card" data-tab="spending" style="display:block;width:100%;text-align:left">
    <div class="card-h"><h2>Spending in ${fmtMonth(month, { year: false })}</h2><span class="link">See all${ICON.chevR}</span></div>
    <div class="between" style="align-items:flex-end;margin-bottom:12px">
      <div><div class="big">${money(s.spent)}</div><div class="small ink2">${budget ? `of ${money(budget, { whole: true })} budget` : 'No budget set'}</div></div>
      ${status}
    </div>
    ${budget ? meter(s.spent / budget, { color: over ? 'var(--bad-mark)' : 'var(--ink)', pace }) : ''}
    ${budget ? `<div class="meter-legend"><span>${left >= 0 ? `${money(left, { whole: true })} left` : `${money(-left, { whole: true })} over`}</span><span>${left > 0 ? `${money(Math.floor(left / daysLeft), { whole: true })}/day for ${daysLeft} days` : `${daysLeft} days left`}</span></div>` : ''}
  </button>`;
}

// ---------------------------------------------------------------- next paycheck
function paycheckCard(m) {
  if (!m.hasIncome || !m.next) return '';
  const plan = m.planFor(m.next);
  if (!plan.pay) return '';
  const days = daysBetween(m.today, m.next.date);
  const lines = (plan.lines || []).filter(l => l.cents > 0);
  const parts = lines.map(l => ({ cents: l.cents, color: bucketColor(m.bucketById[l.bucketId]), label: m.bucketById[l.bucketId]?.label }));
  const sent = lines.filter(l => plan.done[l.bucketId] > 0).length;
  return `<button class="card" data-tab="plan" style="display:block;width:100%;text-align:left">
    <div class="card-h"><h2>Next paycheck</h2><span class="link">${esc(fmtDate(m.next.date, { weekday: true }))} · ${relDays(days)}${ICON.chevR}</span></div>
    <div class="between" style="align-items:flex-end;margin-bottom:12px">
      <div><div class="big">${money(plan.pay.takeHomeCents)}</div><div class="small ink2">${plan.pay.source === 'stub' ? 'Take-home from your pay stub' : 'Estimated take-home'}</div></div>
      <span class="small muted">${sent}/${lines.length} sent</span>
    </div>
    ${stackBar(parts)}
    <div class="chart-legend">${lines.slice(0, 6).map(l => `<span><i class="box" style="background:${bucketColor(m.bucketById[l.bucketId])}"></i>${esc(m.bucketById[l.bucketId]?.label)} ${money(l.cents, { whole: true })}</span>`).join('')}</div>
    ${plan.error ? `<p class="err mt8">${esc(plan.error)}</p>` : ''}
  </button>`;
}

// ---------------------------------------------------------------- alerts
export function alerts(m) {
  const out = [];
  const check = dividendCheck(m);
  if (check) out.push({ icon: ICON.coins, text: `<strong>Dividend check for ${esc(fmtMonth(check.month, { year: false }))}.</strong> ${esc(check.funds.map(f => f.ticker).join(', '))} paid this month — take a couple of minutes to log the reinvestments from your Schwab receipts.`, action: `<button class="btn small primary" data-action="dividend-check" data-month="${check.month}">Log dividends</button>` });
  const owed = outstandingWork(doc.transactions);
  if (owed.items.length) out.push({ icon: ICON.bank, text: `<strong>Work owes you ${money(owed.cents)}</strong> for ${owed.items.length} expense${owed.items.length > 1 ? 's' : ''}, the oldest from ${esc(fmtDate(owed.oldest))}.`, action: '<button class="btn small" data-action="work-reimbursed">Mark reimbursed</button>' });
  const waiting = doc.accounts.flatMap(a => pendingBuys(a.id).map(c => ({ a, c })));
  if (waiting.length) out.push({ icon: ICON.invest, text: `${waiting.length} transfer${waiting.length > 1 ? 's' : ''} waiting to be logged as a buy (${esc(waiting.map(w => `${w.a.name} ${money(w.c.cents)}`).join(', '))}).`, action: '<button class="btn small" data-tab="invest">Open Invest</button>' });
  for (const e of m.phaseErrors) out.push({ tone: 'bad', icon: ICON.alert, text: `Plan problem: ${esc(e)}`, action: '<button class="btn small" data-action="edit-phases">Fix plan</button>' });
  for (const u of m.unsent) out.push({ icon: ICON.clock, text: `${u.open} transfer${u.open > 1 ? 's' : ''} from your ${esc(fmtDate(u.date))} paycheck ${u.open > 1 ? 'aren’t' : 'isn’t'} marked as sent.`, action: `<button class="btn small" data-action="open-paycheck" data-date="${u.date}">Review</button>` });
  if (m.hasIncome && m.next) {
    const plan = m.planFor(m.next);
    for (const n of plan.notices || []) {
      const from = m.bucketById[n.bucketId], to = m.bucketById[n.to];
      out.push({ icon: ICON.arrow, text: `${esc(from?.label)} is ${n.reason === 'limit' ? 'maxed for the year' : `at its ${money(n.capCents, { whole: true })} target`}, so ${money(n.cents)} goes to ${esc(to?.label)} on ${esc(fmtDate(m.next.date))}.` });
    }
  }
  const stale = m.buckets.filter(b => {
    const bal = m.balances[b.id];
    return bal && bal.source !== 'live' && b.kind !== 'pretax' && bal.snapshotDate && daysBetween(bal.snapshotDate, m.today) > 45;
  });
  if (stale.length) {
    const oldest = stale.map(b => m.balances[b.id].snapshotDate).sort()[0];
    out.push({ icon: ICON.clock, text: `${esc(stale.map(b => b.label).join(', '))} ${stale.length > 1 ? 'were' : 'was'} last entered ${esc(fmtDate(oldest, { year: true }))}. They’re shown as that plus transfers since — no interest or market moves.`, action: '<button class="btn small" data-action="balances">Update balances</button>' });
  }
  const cur = m.config.incomes.filter(i => i.from <= m.today).sort((a, b) => b.from.localeCompare(a.from))[0];
  const nextInc = m.config.incomes.filter(i => i.from > m.today).sort((a, b) => a.from.localeCompare(b.from))[0];
  if (nextInc && !Number.isInteger(nextInc.actualTakeHomeCents)) out.push({ icon: ICON.info, text: `From ${esc(fmtDate(nextInc.from))} your take-home is an estimate. Enter your first pay stub to make it exact.`, action: '<button class="btn small" data-action="incomes">Income</button>' });
  else if (cur && !Number.isInteger(cur.actualTakeHomeCents)) out.push({ icon: ICON.info, text: 'Your take-home is an estimate. Enter the number from a pay stub.', action: '<button class="btn small" data-action="incomes">Income</button>' });
  const proj = m.projection(24);
  if (proj?.errors.length) out.push({ tone: 'bad', icon: ICON.alert, text: `Your plan over-commits ${proj.errors.length} paycheck${proj.errors.length > 1 ? 's' : ''} (first ${esc(fmtDate(proj.errors[0].date))}): ${esc(proj.errors[0].message)}`, action: '<button class="btn small" data-action="edit-phases">Fix plan</button>' });
  const missed = proj?.paychecks.filter(p => p.missedMatchCents > 0) || [];
  if (missed.length) out.push({ tone: 'bad', icon: ICON.alert, text: `You’d hit the 401(k) limit early and miss ${money(missed.reduce((a, p) => a + p.missedMatchCents, 0))} of employer match.` });
  out.push(...cardAlerts(m));
  for (const t of m.config.todos || []) {
    if (doc.dismissed.includes(t.id)) continue;
    out.push({ icon: ICON.flag, text: esc(t.text), action: `<button class="btn small" data-action="dismiss-todo" data-id="${esc(t.id)}">${ICON.check}Done</button>` });
  }
  return out;
}

function alertsCard(m) {
  const list = alerts(m);
  if (!list.length) return '';
  const shown = ui.showAllAlerts ? list : list.slice(0, 3);
  return `<div class="card">
    <div class="card-h"><h2>Heads up</h2>${list.length > 3 ? `<button class="link" data-action="toggle-alerts">${ui.showAllAlerts ? 'Show less' : `All ${list.length}`}</button>` : ''}</div>
    ${shown.map(a => `<div class="row-flex" style="align-items:flex-start;padding:8px 0;border-top:1px solid var(--hairline)">
      <span style="width:20px;flex:none;color:${a.tone === 'bad' ? 'var(--bad)' : 'var(--ink-2)'}">${a.icon.replace('<svg', '<svg width="18" height="18"')}</span>
      <div style="flex:1;min-width:0;font-size:14.5px">${a.text}${a.action ? `<div class="mt8">${a.action}</div>` : ''}</div>
    </div>`).join('')}
  </div>`;
}

// ---------------------------------------------------------------- goals preview
function goalsCard(m) {
  const goals = m.goals().slice(0, 3);
  if (!goals.length) return '';
  return `<button class="card" data-tab="goals" style="display:block;width:100%;text-align:left">
    <div class="card-h"><h2>Goals</h2><span class="link">See all${ICON.chevR}</span></div>
    ${goals.map(g => {
      const frac = g.target ? g.current / g.target : 0;
      const label = g.kind === 'limit' ? `${g.bucket.label} ${g.year}` : g.bucket.label;
      const eta = g.eta === 'done' ? (g.kind === 'limit' ? 'Maxed' : 'Reached') : g.eta ? `~${fmtMonth(g.eta.slice(0, 7), { short: true })}` : '';
      return `<div style="padding:8px 0">
        <div class="between small" style="margin-bottom:6px"><span style="font-weight:600;font-size:14.5px">${esc(label)}</span><span class="ink2 num">${money(g.current, { whole: true })} / ${money(g.target, { whole: true })}${eta ? ` · ${esc(eta)}` : ''}</span></div>
        ${meter(frac, { color: bucketColor(g.bucket), thin: true })}
      </div>`;
    }).join('')}
  </button>`;
}

// ---------------------------------------------------------------- recent
function recentCard(m) {
  const recent = sortTx(doc.transactions).slice(0, 5);
  if (!recent.length) return '';
  return `<div class="card flush">
    <div class="card-h"><h2>Recent transactions</h2><button class="link" data-tab="spending">See all${ICON.chevR}</button></div>
    <div class="rows" style="margin:0">${recent.map(t => txRow(t, m)).join('')}</div>
  </div>`;
}

export const homeActions = {
  horizon: el => { ui.horizon = Number(el.dataset.n); saveUi(); return 'render'; },
  'toggle-alerts': () => { ui.showAllAlerts = !ui.showAllAlerts; saveUi(); return 'render'; },
  'dismiss-todo': el => { doc.dismissed.push(el.dataset.id); save(); return 'render'; },
};
