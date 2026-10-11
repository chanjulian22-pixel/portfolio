import { doc, ui, saveUi } from '../store.js';
import { chart, meter } from '../charts.js';
import { money, compact, pct, fmtDate, fmtMonth, esc, ICON } from '../ui.js';
import { monthsBetween, daysBetween } from '../domain/dates.js';
import { phaseOn, plannedFor } from '../domain/allocation.js';
import { bucketColor, notice } from './common.js';

function milestoneText(ms, m) {
  const b = m.bucketById[ms.bucketId];
  if (ms.type === 'target') return `${b?.label} reaches ${money(ms.cents, { whole: true })}`;
  if (ms.type === 'limit') return `${b?.label} maxed for ${ms.year}`;
  return `${ms.label}${ms.cents ? ` · −${money(ms.cents, { whole: true })}` : ''}`;
}

export function goalsView(m) {
  if (!m.hasIncome) return { title: 'Goals', html: notice({ icon: ICON.info, text: 'Goals and projections need your salary and plan. Import your data file or add your salary in Settings.', actions: '<button class="btn small" data-action="import">Import</button>' }) };
  const horizon = ui.goalHorizon || 24;
  const proj = m.projection(horizon);
  const last = proj.points[proj.points.length - 1];
  const first = proj.points[0];

  const spec = {
    type: 'lines', stacked: true, height: 200, label: 'Projected balances: contributions and growth',
    series: [
      { key: 'principal', label: 'Contributions', color: 'var(--s1)', area: true, areaOpacity: .14, points: proj.points.map(p => ({ x: p.date, y: p.principal })) },
      { key: 'growth', label: 'Growth', color: 'var(--s3)', area: true, areaOpacity: .22, points: proj.points.map(p => ({ x: p.date, y: Math.max(0, p.growth) })) },
    ],
    marks: proj.milestones.filter(x => x.type !== 'limit' || x.year > Number(m.today.slice(0, 4))).slice(0, 6).map(x => ({ x: x.date })),
    tooltip: ({ x, values }) => {
      const tot = values.reduce((a, v) => a + v.y, 0);
      return `<b>${esc(money(tot, { whole: true }))}</b>${esc(fmtMonth(x.slice(0, 7)))}` + values.map(v => `<div class="k"><i style="background:${v.color}"></i>${esc(money(v.y, { whole: true }))} ${esc(v.label.toLowerCase())}</div>`).join('');
    },
  };
  const growthShare = last.total ? last.growth / last.total : 0;
  let html = `<section class="hero">
    <div class="eyebrow">Projected by ${esc(fmtMonth(last.date.slice(0, 7)))}</div>
    <div class="hero-value">${money(last.total, { whole: true })}</div>
    <div class="hero-sub"><span class="delta good">${ICON.up}${money(last.total - first.total, { whole: true })}</span><span>from today · ${pct(growthShare, 1)} of the total is market growth</span></div>
  </section>
  <div class="card">
    <div class="between" style="margin-bottom:10px">
      <div class="chart-legend" style="margin:0"><span><i class="box" style="background:var(--s1)"></i>Contributions</span><span><i class="box" style="background:var(--s3)"></i>Growth</span></div>
      <div class="seg" style="width:150px">${[[12, '1Y'], [24, '2Y'], [60, '5Y']].map(([n, l]) => `<button type="button" class="${horizon === n ? 'on' : ''}" data-action="goal-horizon" data-n="${n}">${l}</button>`).join('')}</div>
    </div>
    ${chart(spec)}
    <p class="note" style="margin:10px 0 0">Every paycheck run through your plan, with caps, limits and sweeps, then grown monthly at each bucket’s expected return. ${proj.points.some(p => p.date > lastPhaseEnd(m)) ? `After ${esc(fmtDate(lastPhaseEnd(m), { year: true }))} the last phase is assumed to continue.` : ''}</p>
    <details class="data"><summary>Show as table</summary><table><tr><th>Month</th><th>Contributed</th><th>Growth</th><th>Total</th></tr>
      ${proj.points.filter((p, i) => i === 0 || p.date.slice(5, 7) % 3 === 0 || i === proj.points.length - 1).map(p => `<tr><td>${esc(fmtMonth(p.date.slice(0, 7), { short: true }))}</td><td>${compact(p.principal)}</td><td>${compact(p.growth)}</td><td>${compact(p.total)}</td></tr>`).join('')}</table></details>
  </div>`;

  // runway
  if (m.runway != null) {
    html += `<div class="tiles">
      <div class="tile"><div class="tile-label">${ICON.shield.replace('<svg', '<svg width="14" height="14"')}Emergency runway</div><div class="tile-value">${m.runway.toFixed(1)} mo</div><div class="tile-note">${esc(m.buckets.filter(b => b.assetClass === 'cash' && b.kind !== 'revolving').map(b => b.label).join(' + '))} ÷ ${money(m.burn, { whole: true })}/mo</div></div>
      <div class="tile"><div class="tile-label">${ICON.coins.replace('<svg', '<svg width="14" height="14"')}Accessible</div><div class="tile-value">${money(m.nw.accessible, { whole: true })}</div><div class="tile-note">excludes retirement accounts</div></div>
    </div>`;
  }

  // goals
  const goals = m.goals();
  const { phase } = phaseOn(m.today, m.config.phases);
  html += `<div class="card"><div class="card-h"><h2>Targets</h2></div>${goals.map(g => {
    const frac = g.target ? g.current / g.target : 0;
    const b = g.bucket;
    const monthly = phase ? plannedFor(phase, b.id, 1) + plannedFor(phase, b.id, 2) : 0;
    const eta = g.eta === 'done' ? `<span class="pill good">${ICON.check}${g.kind === 'limit' ? 'Maxed' : 'Reached'}</span>`
      : g.eta ? `<span class="pill">${ICON.flag}${esc(fmtMonth(g.eta.slice(0, 7), { short: true }))}</span>` : '';
    const nextYear = g.kind === 'limit' && g.nextYear ? `<div class="small muted mt8">${g.year + 1}: on plan to max by ${esc(fmtDate(g.nextYear.date, { year: true }))}${g.estimatedLimit ? ' (assuming the limit stays the same)' : ''}.</div>` : '';
    return `<div style="padding:12px 0;border-top:1px solid var(--hairline)">
      <div class="between" style="margin-bottom:4px"><span class="row-flex" style="gap:8px"><span class="dot" style="background:${bucketColor(b)}"></span><strong style="font-weight:620">${esc(b.label)}${g.kind === 'limit' ? ` ${g.year}` : ''}</strong></span>${eta}</div>
      <div class="between small ink2" style="margin-bottom:8px"><span style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.kind === 'limit' ? (b.kind === 'pretax' ? 'Employee deferral limit' : 'Annual contribution limit') : b.purpose || 'Target')}</span><span class="num" style="white-space:nowrap;flex:none">${money(g.current, { whole: true })} / ${money(g.target, { whole: true })}</span></div>
      ${meter(frac, { color: bucketColor(b) })}
      ${monthly && g.eta !== 'done' ? `<div class="small muted mt8">${money(monthly)} a month on the current plan</div>` : ''}
      ${nextYear}
    </div>`;
  }).join('')}</div>`;

  // events
  for (const e of m.config.events || []) {
    if (e.date < m.today) continue;
    const months = monthsBetween(m.today, e.date);
    html += `<div class="card">
      <div class="card-h"><h2>${esc(e.label)}</h2><span class="pill">${ICON.clock}${months} months</span></div>
      <div class="between"><div><div class="mid">${money(e.outflowCents || 0, { whole: true })}</div><div class="small muted">around ${esc(fmtDate(e.date, { year: true }))}</div></div>
      ${Object.entries(e.setTargets || {}).map(([id, c]) => `<div style="text-align:right"><div class="small muted">${esc(m.bucketById[id]?.label)} target then</div><div style="font-weight:650">${money(c, { whole: true })}</div></div>`).join('')}</div>
      ${e.note ? `<p class="note mt12" style="margin-bottom:0">${esc(e.note)}</p>` : ''}
    </div>`;
  }

  // milestones
  if (proj.milestones.length) {
    html += `<div class="card"><div class="card-h"><h2>Milestones</h2><span class="small muted">on the current plan</span></div>
      ${proj.milestones.map(ms => `<div class="row-flex" style="padding:9px 0;border-top:1px solid var(--hairline)">
        <span class="dot" style="background:${ms.bucketId ? bucketColor(m.bucketById[ms.bucketId]) : 'var(--ink)'}"></span>
        <span style="flex:1;min-width:0;font-size:15px">${esc(milestoneText(ms, m))}</span>
        <span class="small muted num">${esc(fmtDate(ms.date, { year: true }))}</span>
      </div>`).join('')}
    </div>`;
  }
  if (proj.errors.length) html += notice({ icon: ICON.alert, text: `${proj.errors.length} paycheck${proj.errors.length > 1 ? 's' : ''} in this window can’t be allocated: ${esc(proj.errors[0].message)}` });
  return { title: 'Goals', html };
}

function lastPhaseEnd(m) {
  return (m.config.phases || []).map(p => p.endDate).sort().pop() || m.today;
}

export const goalsActions = {
  'goal-horizon': el => { ui.goalHorizon = Number(el.dataset.n); saveUi(); return 'render'; },
};
