import { doc, ui, saveUi, save, newId } from '../store.js';
import { stackBar, meter } from '../charts.js';
import { money, pct, fmtDate, fmtMonth, relDays, esc, ICON, openSheet, toast, $ } from '../ui.js';
import { daysBetween, yearOf } from '../domain/dates.js';
import { taxYear } from '../domain/taxdata.js';
import { parseCents } from '../domain/money.js';
import { bucketColor, notice, statusPill } from './common.js';
import { liveAccountFor, openBuySheet, removeContribution } from './invest.js';
import { model } from '../model.js';

function paycheckList(m) {
  const seen = new Set();
  const list = [];
  for (const u of m.unsent) if (!seen.has(u.date)) { seen.add(u.date); list.push({ date: u.date, index: u.index }); }
  for (const p of m.upcoming) if (!seen.has(p.date)) { seen.add(p.date); list.push(p); }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

export function planView(m) {
  if (!m.hasIncome) {
    return { title: 'Plan', html: notice({ icon: ICON.info, text: 'Add your salary to see where each paycheck goes — or import your data file.', actions: '<button class="btn small primary" data-action="incomes">Add salary</button><button class="btn small" data-action="import">Import</button>' }) };
  }
  const list = paycheckList(m);
  const sel = list.find(p => p.date === ui.planDate) || list.find(p => p.date >= m.today) || list[0];
  const plan = m.planFor(sel);
  const pay = plan.pay;
  const days = daysBetween(m.today, sel.date);
  let html = `<div class="chips">${list.map(p => {
    const pl = p.date === sel.date ? plan : null;
    const unsent = m.unsent.some(u => u.date === p.date);
    return `<button class="chip${p.date === sel.date ? ' on' : ''}" data-action="pick-paycheck" data-date="${p.date}">${esc(fmtDate(p.date))}${unsent ? ' •' : ''}</button>`;
  }).join('')}</div>`;

  if (!pay) return { title: 'Plan', html: html + notice({ text: 'No salary covers this date.' }) };

  const lines = (plan.lines || []).filter(l => l.cents > 0 || (l.plannedCents || 0) > 0);
  const bucket = id => m.bucketById[id];
  const sentCount = lines.filter(l => l.cents > 0 && plan.done[l.bucketId] > 0).length;
  const toSend = lines.filter(l => l.cents > 0).length;
  const assigned = (plan.lines || []).reduce((a, l) => a + l.cents, 0);

  html += `<div class="card">
    <div class="eyebrow">${esc(fmtDate(sel.date, { weekday: true }))} · ${esc(relDays(days))} · paycheck ${sel.index} of the month</div>
    <div class="between" style="align-items:flex-end;margin:4px 0 12px">
      <div class="big" style="font-size:36px">${money(pay.takeHomeCents)}</div>
      ${pay.source === 'stub' ? statusPill('good', 'Pay stub') : `<button data-action="incomes">${statusPill('warn', 'Estimate')}</button>`}
    </div>
    ${plan.lines ? stackBar(lines.filter(l => l.cents > 0).map(l => ({ cents: l.cents, color: bucketColor(bucket(l.bucketId)), label: bucket(l.bucketId)?.label })), { tall: true }) : ''}
    <div class="small ink2 mt8">${plan.phase ? `${esc(plan.phase.label)}${plan.extended ? ' (continuing past its end date)' : ''}` : 'No plan phase covers this date — everything goes to the residual bucket.'}</div>
  </div>`;

  if (plan.error) html += notice({ icon: ICON.alert, text: esc(plan.error), actions: '<button class="btn small" data-action="edit-phases">Fix plan</button>' });

  if (plan.lines) {
    html += `<div class="card">
      <div class="card-h"><h2>Transfers</h2><span class="small muted">${sentCount}/${toSend} sent</span></div>
      <div class="legend" style="margin-top:0">${lines.map(l => {
        const b = bucket(l.bucketId);
        const done = plan.done[l.bucketId] || 0;
        const notes = (plan.notices || []).filter(n => n.bucketId === l.bucketId);
        const inbound = (plan.notices || []).filter(n => n.to === l.bucketId);
        const sub = l.residual ? 'Gets whatever is left' : b.purpose || '';
        const diff = done > 0 && done !== l.cents ? `sent ${money(done)}` : l.plannedCents != null && l.plannedCents !== l.cents ? `planned ${money(l.plannedCents)}` : '';
        return `<div class="legend-row">
          <span class="sw" style="background:${bucketColor(b)}"></span>
          <button class="lbl" style="text-align:left" data-action="edit-sent" data-date="${sel.date}" data-bucket="${esc(b.id)}" data-cents="${l.cents}">
            ${esc(b.label)}<small>${esc(sub)}</small>
            ${notes.map(n => `<small style="color:var(--ink-2)">↳ ${n.reason === 'limit' ? 'Maxed for the year' : `At its ${money(n.capCents, { whole: true })} target`} — ${money(n.cents)} to ${esc(bucket(n.to)?.label)}</small>`).join('')}
            ${inbound.map(n => `<small style="color:var(--ink-2)">↳ includes ${money(n.cents)} from ${esc(bucket(n.bucketId)?.label)}</small>`).join('')}
            ${doc.contributions.some(c => c.paycheck === sel.date && c.bucketId === l.bucketId && c.pendingBuy) ? '<small style="color:var(--ink-2)">↳ buy not logged yet — tap Log buy in Invest</small>' : ''}
          </button>
          <span class="val">${money(l.cents)}${diff ? `<small>${esc(diff)}</small>` : ''}</span>
          ${l.cents > 0 ? `<button class="tick${done > 0 ? ' on' : ''}" data-action="toggle-sent" data-date="${sel.date}" data-bucket="${esc(b.id)}" data-cents="${l.cents}" aria-label="Mark ${esc(b.label)} as sent">${ICON.check}</button>` : '<span style="width:30px"></span>'}
        </div>`;
      }).join('')}</div>
      <div class="between mt12">
        ${assigned === pay.takeHomeCents ? statusPill('good', `All ${money(pay.takeHomeCents)} assigned`) : statusPill('bad', `Off by ${money(pay.takeHomeCents - assigned)}`)}
        ${sentCount < toSend ? `<button class="btn small" data-action="send-all" data-date="${sel.date}" data-index="${sel.index}">Mark all sent</button>` : ''}
      </div>
    </div>`;
  }

  // pre-tax
  if (pay.deferralCents > 0) {
    const k = m.buckets.find(b => b.kind === 'pretax');
    const limit = taxYear(yearOf(sel.date)).limits.k401;
    const ytd = m.ytd[k?.id] || 0;
    html += `<div class="card">
      <div class="card-h"><h2>401(k) · before tax</h2><span class="small muted">not part of take-home</span></div>
      <div class="legend" style="margin-top:0">
        <div class="legend-row"><span class="sw" style="background:${bucketColor(k)}"></span><span class="lbl">Your deferral<small>${pct(pay.income.deferralRate, 0)} of gross</small></span><span class="val">${money(plan.deferralCents ?? pay.deferralCents)}</span></div>
        <div class="legend-row"><span class="sw" style="background:${bucketColor(k)};opacity:.5"></span><span class="lbl">Employer match<small>${pct(pay.income.matchRate, 0)} of gross, per paycheck</small></span><span class="val">${money(plan.matchCents ?? pay.matchCents)}</span></div>
      </div>
      <div class="mt12">${meter(ytd / limit, { color: bucketColor(k), thin: true })}</div>
      <div class="meter-legend"><span>${money(ytd, { whole: true })} deferred in ${yearOf(m.today)}</span><span>limit ${money(limit, { whole: true })}</span></div>
    </div>`;
  }

  html += taxCard(pay);
  if (plan.phase) {
    html += `<div class="card">
      <div class="card-h"><h2>${esc(plan.phase.label)}</h2><button class="link" data-action="edit-phases">Edit plan${ICON.chevR}</button></div>
      <div class="small ink2">${esc(fmtDate(plan.phase.startDate, { year: true }))} – ${esc(fmtDate(plan.phase.endDate, { year: true }))}</div>
      ${plan.phase.note ? `<p class="note mt8" style="margin-bottom:0">${esc(plan.phase.note)}</p>` : ''}
    </div>`;
  } else {
    html += `<button class="btn block" data-action="edit-phases">Edit plan</button>`;
  }
  return { title: 'Plan', html };
}

function taxCard(pay) {
  const c = pay.pay;
  const pp = c.perPaycheck;
  const parts = [
    { key: 'take', label: 'Take-home', cents: pp.takeHome, color: 'var(--s1)' },
    { key: '401k', label: '401(k)', cents: pp.deferral, color: 'var(--s8)' },
    { key: 'other', label: 'Other pre-tax (benefits)', cents: pp.otherPreTax, color: 'var(--base)' },
    { key: 'fica', label: 'Social Security & Medicare', cents: pp.fica, color: 'var(--t1)' },
    { key: 'fed', label: 'Federal income tax', cents: pp.federal, color: 'var(--t2)' },
    { key: 'ny', label: 'New York State', cents: pp.state, color: 'var(--t3)' },
    { key: 'nyc', label: 'New York City', cents: pp.city, color: 'var(--t4)' },
  ].filter(p => p.cents > 0);
  const mr = c.marginal;
  const keep = Math.round((1 - mr.total) * 100);
  const keepAfter = Math.round((1 - c.headroom.rateAfter) * 100);
  const stubDiff = pay.source === 'stub' ? pay.takeHomeCents - pay.estimatedTakeHomeCents : 0;
  return `<div class="card">
    <div class="card-h"><h2>Where gross pay goes</h2><span class="small muted">${money(pp.gross)} per paycheck</span></div>
    ${stackBar(parts, { tall: true })}
    <div class="legend">${parts.map(p => `<div class="legend-row"><span class="sw" style="background:${p.color}"></span><span class="lbl">${esc(p.label)}</span><span class="val">${money(p.cents)}<small>${pct(p.cents / pp.gross)}</small></span></div>`).join('')}</div>
    <div class="tiles mt12" style="margin-bottom:0">
      <div class="tile" style="box-shadow:none;background:var(--surface-2)"><div class="tile-label">Marginal rate</div><div class="tile-value">${pct(mr.total)}</div><div class="tile-note">${pct(mr.federal, 0)} fed · ${pct(mr.state, 1)} NY · ${pct(mr.city, 2)} NYC</div></div>
      <div class="tile" style="box-shadow:none;background:var(--surface-2)"><div class="tile-label">Effective rate</div><div class="tile-value">${pct((pp.fica + pp.federal + pp.state + pp.city) / pp.gross)}</div><div class="tile-note">all taxes ÷ gross</div></div>
    </div>
    ${pay.income.deferralRate > 0 ? `<p class="note mt12" style="margin-bottom:0">Each extra $100 into the 401(k) costs about <strong class="ink2">$${keep}</strong> of take-home${c.headroom.usableCents > 0 ? ` for the next ${money(c.headroom.usableCents, { whole: true })} a year; after that, about $${keepAfter}` : ''}.</p>` : ''}
    ${stubDiff ? `<p class="note mt8" style="margin-bottom:0">Your pay stub is ${money(Math.abs(stubDiff))} ${stubDiff < 0 ? 'lower' : 'higher'} than this estimate — usually benefits deductions. The plan uses your stub.</p>` : ''}
    <p class="note mt8" style="margin-bottom:0">Estimate for a single filer in NYC${c.estimatedTables ? ` using ${c.year} tables (newer ones aren’t published yet)` : ''}. Ignores credits and other income — your pay stub is the authority.</p>
  </div>`;
}

/** A transfer marked as sent. Money headed to an investment account waits there as cash until you log the buy. */
function addSent(date, bucketId, cents) {
  const c = { id: newId('c'), bucketId, date, cents, paycheck: date, at: Date.now() };
  if (liveAccountFor(bucketId)) c.pendingBuy = true;
  doc.contributions.push(c);
  return c;
}

/** Existing sent records for a paycheck + bucket; false if one has a logged buy and you'd rather keep it. */
function clearSent(date, bucketId) {
  const existing = doc.contributions.filter(c => c.paycheck === date && c.bucketId === bucketId);
  const withBuys = existing.filter(c => c.buyIds?.length);
  if (withBuys.length) {
    const what = doc.purchases.filter(p => withBuys.some(c => c.buyIds.includes(p.id))).map(p => `${p.ticker} ${+p.shares.toFixed(4)} sh`).join(', ');
    if (!confirm(`This also removes the buy you logged (${what}) from your holdings. Continue?`)) return false;
  }
  for (const c of existing) removeContribution(c);
  return true;
}

export const planActions = {
  'pick-paycheck': el => { ui.planDate = el.dataset.date; saveUi(); return 'render'; },
  'open-paycheck': el => { ui.planDate = el.dataset.date; ui.tab = 'plan'; saveUi(); return 'render'; },
  'toggle-sent': (el, m) => {
    const { date, bucket } = el.dataset;
    const on = doc.contributions.some(c => c.paycheck === date && c.bucketId === bucket);
    if (on) {
      if (!clearSent(date, bucket)) return;
      save();
      return 'render';
    }
    const c = addSent(date, bucket, Number(el.dataset.cents));
    save();
    const acct = liveAccountFor(bucket);
    if (acct) setTimeout(() => openBuySheet(model(), acct.id, c.id), 60);
    return 'render';
  },
  'send-all': (el, m) => {
    const sel = { date: el.dataset.date, index: Number(el.dataset.index) };
    const plan = m.planFor(sel);
    let toLog = 0;
    for (const l of plan.lines || []) {
      if (l.cents > 0 && !(plan.done[l.bucketId] > 0)) { if (addSent(sel.date, l.bucketId, l.cents).pendingBuy) toLog++; }
    }
    save();
    toast(toLog ? `Marked as sent — log ${toLog} buy${toLog > 1 ? 's' : ''} in Invest when ${toLog > 1 ? 'they fill' : 'it fills'}` : 'All transfers marked as sent');
    return 'render';
  },
  'edit-sent': (el, m) => {
    const { date, bucket } = el.dataset;
    const b = m.bucketById[bucket];
    if (doc.contributions.some(c => c.paycheck === date && c.bucketId === bucket && c.buyIds?.length)) {
      toast('This transfer has a logged buy — untick it first to change the amount.', true);
      return;
    }
    const done = doc.contributions.filter(c => c.paycheck === date && c.bucketId === bucket).reduce((a, c) => a + c.cents, 0);
    openSheet({
      title: b.label,
      submitLabel: 'Save',
      body: `<p class="note" style="text-align:center;margin-top:8px">How much did you actually send from the ${esc(fmtDate(date))} paycheck?</p>
        <div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" value="${((done || Number(el.dataset.cents)) / 100).toFixed(2)}"></div>
        <p class="note" style="text-align:center">Planned: ${money(Number(el.dataset.cents))}. Enter 0 to mark it as not sent.</p><p class="err" id="s-err"></p>`,
      onSubmit: form => {
        const c = parseCents(form.elements.amount.value);
        if (!Number.isFinite(c) || c < 0) { $('#s-err', form).textContent = 'Enter an amount.'; return false; }
        if (!clearSent(date, bucket)) return false;
        const added = c > 0 ? addSent(date, bucket, c) : null;
        save();
        window.dispatchEvent(new Event('ledger:render'));
        const acct = added && liveAccountFor(bucket);
        if (acct) setTimeout(() => openBuySheet(model(), acct.id, added.id), 260);
      },
    });
  },
};
