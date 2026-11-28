// Insight cards: today at a glance, what's coming up, spending patterns, the month in review, and
// a what-if slider for the forecast.
import { doc, ui, saveUi } from '../store.js';
import { meter, chart } from '../charts.js';
import { money, compact, pct, fmtDate, fmtMonth, relDays, esc, ICON, openSheet, $ } from '../ui.js';
import { safeToSpend, compareToLastMonth, topPlaces, recurringCharges, monthReview } from '../domain/insights.js';
import { addDays, addMonths, daysBetween, monthKey, monthsBetween } from '../domain/dates.js';
import { feeStatus, bonusStatus, creditUsedNow, creditLive, periodEnd } from '../domain/cards.js';
import { openLines } from '../domain/paychecks.js';

const small = icon => icon.replace('<svg', '<svg width="15" height="15" style="display:inline-block;vertical-align:-2px"');

// ---------------------------------------------------------------- Home: today
export function todayCard(m) {
  const month = monthKey(m.today);
  const budget = m.monthBudget(month).cents;
  const spent = m.monthSummary(month).spent;
  const s = safeToSpend({ budgetCents: budget, spentCents: spent, today: m.today });
  const next = m.hasIncome && m.next ? m.planFor(m.next) : null;
  const days = next ? daysBetween(m.today, m.next.date) : null;
  const toSend = next?.lines ? openLines(next.lines).length : 0;
  const owedNow = m.unsent.reduce((a, u) => a + u.open, 0);
  if (!budget && !next) return '';
  return `<div class="tiles" style="margin-top:2px">
    <button class="tile" data-tab="spending" style="text-align:left"><div class="tile-label">${small(ICON.spending)}Safe to spend today</div>
      <div class="tile-value ${s.leftCents < 0 ? 'bad' : ''}">${budget ? money(s.perDayCents) : '—'}</div>
      <div class="tile-note">${budget ? (s.leftCents >= 0 ? `${money(s.leftCents, { whole: true })} left for ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}` : `${money(-s.leftCents, { whole: true })} over this month’s budget`) : 'Set a budget in Spending'}</div></button>
    ${next?.pay ? `<button class="tile" data-action="open-paycheck" data-date="${m.next.date}" style="text-align:left"><div class="tile-label">${small(ICON.plan)}${days === 0 ? 'Payday today' : `Payday ${esc(relDays(days))}`}</div>
      <div class="tile-value">${money(next.pay.takeHomeCents, { whole: true })}</div>
      <div class="tile-note">${owedNow ? `${owedNow} earlier transfer${owedNow > 1 ? 's' : ''} still to send` : days === 0 && toSend ? `${toSend} transfer${toSend > 1 ? 's' : ''} to make` : esc(fmtDate(m.next.date, { weekday: true }))}</div></button>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- Home: coming up
/** Dated things in the next ~7 weeks: paydays, card fees, bonus deadlines, credits about to lapse, plan events. */
export function upcomingItems(m, days = 50) {
  const until = addDays(m.today, days);
  const out = [];
  if (m.hasIncome) for (const pd of m.upcoming.filter(p => p.date <= until).slice(0, 2)) {
    const plan = m.planFor(pd);
    if (plan.pay) out.push({ date: pd.date, icon: '💵', title: 'Paycheck', sub: `${money(plan.pay.takeHomeCents)} take-home`, action: `data-action="open-paycheck" data-date="${pd.date}"` });
  }
  for (const c of m.cards) {
    const opts = { txs: doc.transactions, today: m.today, catalog: m.catalog, prefs: m.cardPrefs, others: m.cards };
    if (c.annualFeeCents > 0) {
      const s = feeStatus(c, opts);
      if (s.renews > m.today && s.renews <= until && !s.guessed) out.push({ date: s.renews, icon: '💳', title: `${c.short} annual fee`, sub: `${money(s.nextFeeCents, { whole: true })} · this year it’s earned you ${money(s.totalCents, { whole: true })}`, action: `data-action="card-detail" data-id="${esc(c.id)}"` });
    }
    const b = bonusStatus(c, opts);
    if (b?.active && b.by <= until) out.push({ date: b.by, icon: '⭐', title: `${c.short} welcome bonus deadline`, sub: `${money(b.leftCents, { whole: true })} still to spend`, action: 'data-action="open-cards"' });
    for (const cr of c.credits || []) {
      if (cr.per === 'month' || cr.per === 'every4' || !creditLive(cr, m.today) || c.owned.ignoreCredits?.includes(cr.id)) continue;
      const left = cr.cents - creditUsedNow(c, cr, m.today, doc.transactions);
      const ends = periodEnd(cr.per, m.today, c.opened);
      if (left > 0 && ends && ends <= until) out.push({ date: ends, icon: '🎁', title: `${cr.label} runs out`, sub: `${money(left, { whole: true })} unused on your ${c.short}`, action: 'data-action="open-cards"' });
    }
  }
  for (const e of m.config.events || []) if (e.date >= m.today && e.date <= until) out.push({ date: e.date, icon: '📌', title: e.label, sub: e.outflowCents ? `${money(e.outflowCents, { whole: true })} planned` : '', action: 'data-tab="goals"' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function upcomingCard(m) {
  const list = upcomingItems(m);
  if (!list.length) return '';
  const shown = ui.allUpcoming ? list : list.slice(0, 4);
  return `<div class="card flush">
    <div class="card-h"><h2>Coming up</h2>${list.length > 4 ? `<button class="link" data-action="toggle-upcoming">${ui.allUpcoming ? 'Show less' : `All ${list.length}`}</button>` : ''}</div>
    <div class="rows" style="margin:0">${shown.map(x => `<button class="row" ${x.action}>
      <span class="avatar">${x.icon}</span>
      <span class="row-main"><span class="row-title" style="display:block;white-space:normal">${esc(x.title)}</span><span class="row-sub" style="display:block;white-space:normal">${esc(x.sub)}</span></span>
      <span class="row-end"><span class="v" style="display:block">${esc(fmtDate(x.date))}</span><span class="s" style="display:block">${esc(relDays(daysBetween(m.today, x.date)))}</span></span></button>`).join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------- Spending: insights
export function spendingInsights(m, month) {
  const isNow = month === monthKey(m.today);
  const places = topPlaces(doc.transactions, month, 4);
  const cmp = isNow ? compareToLastMonth(doc.transactions, m.today) : null;
  const subs = isNow ? recurringCharges(doc.transactions, m.today) : [];
  if (!places.length && !subs.length) return '';
  const up = cmp && cmp.deltaCents > 0;
  return `<div class="card">
    <div class="card-h"><h2>Insights</h2><button class="link" data-action="month-review" data-month="${month}">Month in review${ICON.chevR}</button></div>
    ${cmp?.hasBefore ? `<div class="between" style="align-items:flex-end;margin-bottom:6px"><div><div class="mid ${up ? 'bad' : 'good'}">${money(Math.abs(cmp.deltaCents), { whole: true })} ${up ? 'more' : 'less'}</div>
        <div class="small ink2">than ${esc(fmtMonth(cmp.prev, { year: false }))} at this point (${money(cmp.beforeCents, { whole: true })})</div></div></div>
      ${cmp.categories.slice(0, 3).map(c => `<div class="between small" style="padding:3px 0"><span>${c.emoji} ${esc(c.label)}</span><span class="num ${c.deltaCents > 0 ? 'bad' : 'good'}">${money(c.deltaCents, { whole: true, sign: true })}</span></div>`).join('')}` : ''}
    ${places.length ? `<div style="font-weight:650;margin:${cmp?.hasBefore ? 14 : 0}px 0 6px">Where it went</div>
      ${places.map(p => `<div style="padding:5px 0"><div class="between small" style="margin-bottom:5px"><span style="font-size:14.5px">${esc(p.item)}${p.count > 1 ? ` <span class="muted">× ${p.count}</span>` : ''}</span><span class="num ink2">${money(p.cents)}</span></div>${meter(p.cents / places[0].cents, { color: 'var(--s1)', thin: true })}</div>`).join('')}` : ''}
    ${subs.length ? `<div style="font-weight:650;margin:14px 0 2px">Every month</div>
      ${subs.slice(0, 6).map(s => `<div class="between small" style="padding:4px 0"><span style="font-size:14.5px">${esc(s.item)}</span><span class="num ink2">${money(s.cents)}</span></div>`).join('')}
      <div class="small muted mt8">${money(subs.reduce((a, s) => a + s.cents, 0), { whole: true })} a month comes back like clockwork — ${money(subs.reduce((a, s) => a + s.cents, 0) * 12, { whole: true })} a year.</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- month in review
export function openMonthReview(m, month) {
  const body = mk => {
    const r = monthReview({ transactions: doc.transactions, contributions: doc.contributions, history: doc.history, buckets: m.buckets, month: mk, budgetCents: m.monthBudget(mk).cents });
    const line = (label, value, sub = '', cls = '') => `<div class="legend-row"><span class="lbl">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="val ${cls}">${value}</span></div>`;
    const canNext = mk < monthKey(m.today);
    return `<div class="between" style="margin:2px 0 10px">
        <button type="button" class="icon-btn" data-go="${addMonths(mk + '-01', -1).slice(0, 7)}" aria-label="Previous month">${ICON.chevL}</button>
        <div style="font-weight:650;font-size:17px">${esc(fmtMonth(mk))}${mk === monthKey(m.today) ? ' · so far' : ''}</div>
        <button type="button" class="icon-btn" ${canNext ? `data-go="${addMonths(mk + '-01', 1).slice(0, 7)}"` : 'disabled style="opacity:.25"'} aria-label="Next month">${ICON.chevR}</button></div>
      <div class="card"><div class="legend" style="margin-top:0">
        ${line('Spent', money(r.spentCents), `${r.count} purchase${r.count === 1 ? '' : 's'}${r.budgetCents ? ` · budget ${money(r.budgetCents, { whole: true })}` : ''}`)}
        ${r.underBudgetCents != null ? line(r.underBudgetCents >= 0 ? 'Under budget' : 'Over budget', money(Math.abs(r.underBudgetCents)), '', r.underBudgetCents >= 0 ? 'good' : 'bad') : ''}
        ${line('Saved and invested', money(r.savedCents), r.investedCents ? `${money(r.investedCents)} of it into investments` : 'transfers you marked as sent')}
        ${r.netWorthChangeCents != null ? line('Net worth', money(r.netWorthChangeCents, { sign: true }), 'change over the month, markets included', r.netWorthChangeCents >= 0 ? 'good' : 'bad') : ''}
        ${r.workCents ? line('Paid for work', money(r.workCents), 'reimbursable, not your spending') : ''}
        ${r.forOthersCents ? line('Bought for others', money(r.forOthersCents), 'against loans') : ''}
      </div></div>
      ${r.categories.length ? `<div class="group-h">Top categories</div><div class="card">${r.categories.map(c => `<div style="padding:5px 0"><div class="between small" style="margin-bottom:5px"><span style="font-size:14.5px">${c.emoji} ${esc(c.label)}</span><span class="num ink2">${money(c.cents)} · ${pct(r.spentCents > 0 ? c.cents / r.spentCents : 0, 0)}</span></div>${meter(c.cents / r.categories[0].cents, { color: 'var(--s1)', thin: true })}</div>`).join('')}</div>` : '<p class="note">Nothing logged this month.</p>'}
      ${r.biggest ? `<p class="note">Biggest purchase: <strong class="ink2">${esc(r.biggest.item)}</strong>, ${money(r.biggest.cents)} on ${esc(fmtDate(r.biggest.date))}.</p>` : ''}`;
  };
  let cur = month || monthKey(m.today);
  openSheet({
    title: 'Month in review', body: body(cur),
    onMount: (root, sheet) => root.addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (b) { cur = b.dataset.go; sheet.setBody(body(cur)); }
    }),
  });
}

// ---------------------------------------------------------------- Goals: at different returns
const RATES = [0.04, 0.06, 0.08, 0.10];
const RATE_COLORS = ['var(--s4)', 'var(--s3)', 'var(--s1)', 'var(--s2)'];
/** Your invested money (stock buckets) under a range of yearly returns, with a slider for any rate. */
export function returnsCard(m) {
  if (!m.hasIncome) return '';
  const ids = m.buckets.filter(b => b.assetClass === 'equity').map(b => b.id);
  const inv = p => ids.reduce((s, id) => s + (p.byBucket[id] || 0), 0);
  const horizon = ui.retHorizon || 10;
  const end = addMonths(m.today, horizon * 12);
  const planRate = m.buckets.find(b => b.isResidual)?.expectedAnnualReturn ?? 0.07;
  const runs = RATES.map(r => ({ r, proj: m.atReturn(r, horizon * 12) }));
  const series = runs.map((x, i) => ({ key: String(x.r), label: `${Math.round(x.r * 100)}% a year`, color: RATE_COLORS[i], dashed: x.r !== planRate,
    points: x.proj.points.filter((p, k) => k === 0 || p.date.slice(5, 7) === '12' || p.date === end || k % 6 === 0).map(p => ({ x: p.date, y: inv(p) })) }));
  return `<div class="card">
    <div class="card-h"><h2>At different returns</h2>
      <div class="seg" style="width:130px">${[[5, '5Y'], [10, '10Y'], [20, '20Y']].map(([n, l]) => `<button type="button" class="${horizon === n ? 'on' : ''}" data-action="ret-horizon" data-n="${n}">${l}</button>`).join('')}</div></div>
    ${chart({ type: 'lines', height: 190, yZero: true, label: 'Invested money at 4, 6, 8 and 10 percent a year', series,
      tooltip: ({ x, values }) => `<div>${esc(fmtMonth(x.slice(0, 7)))}</div>` + [...values].sort((a, b) => b.y - a.y).map(v => `<div class="k"><i style="background:${v.color}"></i><b style="display:inline">${esc(compact(v.y))}</b>&nbsp;at ${esc(v.label)}</div>`).join('') })}
    <div class="chart-legend">${runs.map((x, i) => `<span><i style="background:${RATE_COLORS[i]}"></i>${Math.round(x.r * 100)}%${x.r === planRate ? ' (your plan)' : ''}</span>`).join('')}</div>
    <div class="legend" id="ret-rows"></div>
    <div class="between mt12"><span class="ink2">Try any return</span><strong id="ret-pick">${Math.round(planRate * 100)}% a year</strong></div>
    <input type="range" id="ret-range" min="0" max="15" step="0.5" value="${planRate * 100}" style="width:100%;margin:10px 0 2px;accent-color:var(--ink)" aria-label="Yearly return">
    <div class="between small muted"><span>0%</span><span>15%</span></div>
    <div class="legend" id="ret-out"></div>
    <p class="note" style="margin:10px 0 0">Your plan uses ${Math.round(planRate * 100)}% for stocks. The US stock market has averaged roughly 10% a year over the long run (about 7% after inflation), but single years swing far more than that. Cash and savings keep their own rates here.</p>
  </div>`;
}
export function mountReturns(m) {
  const range = $('#ret-range');
  if (!range) return;
  const ids = m.buckets.filter(b => b.assetClass === 'equity').map(b => b.id);
  const inv = p => ids.reduce((s, id) => s + (p.byBucket[id] || 0), 0);
  const goal = doc.config.investGoalCents || 10000000;
  const horizon = ui.retHorizon || 10;
  const row = (label, sub, val) => `<div class="legend-row"><span class="lbl">${label}<small>${sub}</small></span><span class="val">${val}</span></div>`;
  const describe = proj => {
    const last = proj.points[proj.points.length - 1];
    const hit = proj.points.find(p => inv(p) >= goal);
    const putIn = ids.reduce((s, id) => s + (last.principalByBucket[id] || 0), 0);
    return { value: inv(last), putIn, growth: inv(last) - putIn, hit: hit?.date };
  };
  $('#ret-rows').innerHTML = RATES.map(r => {
    const d = describe(m.atReturn(r, horizon * 12));
    return row(`${Math.round(r * 100)}% a year`, `${compact(goal, { mask: false })} invested ${d.hit ? fmtMonth(d.hit.slice(0, 7), { short: true }) : `not within ${horizon} years`}`, `${compact(d.value)}<small>in ${horizon} years</small>`);
  }).join('');
  const draw = () => {
    const r = Number(range.value) / 100;
    $('#ret-pick').textContent = `${+(r * 100).toFixed(1)}% a year`;
    const d = describe(m.atReturn(r, horizon * 12));
    $('#ret-out').innerHTML = row(`In ${horizon} years`, `${money(d.putIn, { whole: true })} you put in + ${money(d.growth, { whole: true })} growth`, compact(d.value))
      + row(`${compact(goal, { mask: false })} invested`, 'when you get there at this return', d.hit ? esc(fmtMonth(d.hit.slice(0, 7), { short: true })) : '—');
  };
  let t;
  range.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 60); });
  draw();
}

// ---------------------------------------------------------------- Goals: what if
export function whatIfCard(m) {
  if (!m.hasIncome) return '';
  return `<div class="card">
    <div class="card-h"><h2>What if…</h2><span class="small muted">try it — nothing is saved</span></div>
    <div class="between"><span class="ink2">I spend</span><strong id="wi-label">the same as planned</strong></div>
    <input type="range" id="wi-range" min="-300" max="500" step="25" value="0" style="width:100%;margin:12px 0 4px;accent-color:var(--ink)" aria-label="Change in monthly spending">
    <div class="between small muted"><span>$300 more</span><span>$500 less a month</span></div>
    <div class="legend" id="wi-out"></div>
  </div>`;
}
export function mountWhatIf(m) {
  const range = $('#wi-range');
  if (!range) return;
  const goal = doc.config.investGoalCents || 10000000;
  const ids = m.buckets.filter(b => b.assetClass === 'equity').map(b => b.id);
  const inv = p => ids.reduce((s, id) => s + (p.byBucket[id] || 0), 0);
  const hitDate = proj => proj.points.find(p => inv(p) >= goal)?.date || null;
  const base = m.projection(120);
  const baseHit = hitDate(base);
  const at = (proj, months) => { const d = addMonths(m.today, months); return proj.points.filter(p => p.date <= d).pop(); };
  const draw = () => {
    const delta = Number(range.value) * 100; // cents a month moved from spending to investing
    $('#wi-label').textContent = delta === 0 ? 'the same as planned' : `${money(Math.abs(delta), { whole: true, mask: false })} ${delta > 0 ? 'less' : 'more'} a month`;
    const alt = delta === 0 ? base : m.whatIf(delta, 120);
    const hit = hitDate(alt);
    const diff = baseHit && hit ? monthsBetween(hit, baseHit) : null;
    const row = (label, sub, val, cls = '') => `<div class="legend-row"><span class="lbl">${label}<small>${sub}</small></span><span class="val ${cls}">${val}</span></div>`;
    const cls = delta > 0 ? 'good' : delta < 0 ? 'bad' : '';
    $('#wi-out').innerHTML = [5, 10].map(y => {
      const a = at(alt, y * 12), b = at(base, y * 12);
      return row(`In ${y} years`, delta ? `${money(a.total - b.total, { whole: true, sign: true })} vs your plan` : 'on your plan', compact(a.total), cls);
    }).join('') + row(`${compact(goal, { mask: false })} invested`, diff ? `${Math.abs(diff)} month${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'sooner' : 'later'}` : baseHit ? 'same month' : 'beyond 10 years on this plan', hit ? esc(fmtMonth(hit.slice(0, 7), { short: true })) : '—', cls);
  };
  range.addEventListener('input', draw);
  draw();
}

export const insightActions = {
  'toggle-upcoming': () => { ui.allUpcoming = !ui.allUpcoming; saveUi(); return 'render'; },
  'ret-horizon': el => { ui.retHorizon = Number(el.dataset.n); saveUi(); return 'render'; },
  'month-review': (el, m) => openMonthReview(m, el.dataset.month),
};
