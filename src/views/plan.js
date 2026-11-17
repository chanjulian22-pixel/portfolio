import { doc, ui, saveUi, save } from '../store.js';
import { stackBar, meter } from '../charts.js';
import { money, pct, fmtDate, relDays, esc, ICON, openSheet, toast, $ } from '../ui.js';
import { daysBetween, yearOf, addDays } from '../domain/dates.js';
import { taxYear } from '../domain/taxdata.js';
import { parseCents } from '../domain/money.js';
import { openLines } from '../domain/paychecks.js';
import { bucketColor, notice, statusPill } from './common.js';
import { liveAccountFor, openBuySheet, removeContribution, addSent } from './invest.js';
import { model } from '../model.js';

// The paycheck you picked. Kept for this visit only, so each launch opens on the next paycheck.
let picked = null;
export const showPaycheck = date => { picked = date; };

const isDone = l => l.state === 'full' || l.state === 'catchup';

/** Recent paychecks, then upcoming ones — plus an older one if that's what you're looking at. */
function paycheckList(m) {
  const list = [...m.pastPaydays.filter(p => p.date >= addDays(m.today, -62)), ...m.upcoming];
  if (picked && !list.some(p => p.date === picked)) {
    const old = m.pastPaydays.find(p => p.date === picked);
    if (old) list.unshift(old);
  }
  return list;
}

export function planView(m) {
  if (!m.hasIncome) {
    return { title: 'Plan', html: notice({ icon: ICON.info, text: 'Add your salary to see where each paycheck goes — or import your data file.', actions: '<button class="btn small primary" data-action="incomes">Add salary</button><button class="btn small" data-action="import">Import</button>' }) };
  }
  const list = paycheckList(m);
  const sel = list.find(p => p.date === picked) || list.find(p => p.date >= m.today) || list[list.length - 1];
  const plan = m.planFor(sel);
  const pay = plan.pay;
  const days = daysBetween(m.today, sel.date);
  const past = sel.date < m.today;
  let html = `<div class="chips" id="pay-chips">
    ${m.pastPaydays.length ? `<button class="chip" data-action="paycheck-history" aria-label="All past paychecks">${ICON.clock.replace('<svg', '<svg width="15" height="15" style="display:inline-block;vertical-align:-2px"')} Past</button>` : ''}
    ${list.map(p => {
      const open = m.unsent.some(u => u.date === p.date);
      const mark = p.date >= m.today ? '' : open ? ' •' : ' ✓';
      return `<button class="chip${p.date === sel.date ? ' on' : ''}" data-action="pick-paycheck" data-date="${p.date}">${esc(fmtDate(p.date))}${mark}</button>`;
    }).join('')}</div>`;
  const after = () => {
    // keep the selected paycheck in view (past ones sit to its left)
    const on = $('#pay-chips .chip.on'), box = on?.parentElement;
    if (box) box.scrollLeft += on.getBoundingClientRect().left - box.getBoundingClientRect().left - 70;
  };

  if (!pay) return { title: 'Plan', html: html + notice({ text: 'No salary covers this date.' }), after };

  const lines = (plan.lines || []).filter(l => l.cents > 0 || (l.plannedCents || 0) > 0 || l.sentCents > 0);
  const bucket = id => m.bucketById[id];
  const toSend = lines.filter(l => l.cents > 0 || l.sentCents > 0);
  const sentCount = toSend.filter(isDone).length;
  const open = openLines(lines);
  const assigned = (plan.lines || []).reduce((a, l) => a + (l.residual ? l.cents : Math.max(l.cents, l.sentCents || 0)), 0);
  const sentTotal = lines.reduce((a, l) => a + (l.sentCents || 0), 0);

  html += `<div class="card">
    <div class="eyebrow">${esc(fmtDate(sel.date, { weekday: true, year: past ? true : 'auto' }))} · ${esc(relDays(days))} · paycheck ${sel.index} of the month</div>
    <div class="between" style="align-items:flex-end;margin:4px 0 12px">
      <div class="big" style="font-size:36px">${money(pay.takeHomeCents)}</div>
      ${pay.source === 'stub' ? statusPill('good', 'Pay stub') : `<button data-action="incomes">${statusPill('warn', 'Estimate')}</button>`}
    </div>
    ${plan.lines ? stackBar(lines.filter(l => l.cents > 0).map(l => ({ cents: l.cents, color: bucketColor(bucket(l.bucketId)), label: bucket(l.bucketId)?.label })), { tall: true }) : ''}
    <div class="small ink2 mt8">${plan.phase ? `${esc(plan.phase.label)}${plan.extended ? ' (continuing past its end date)' : ''}` : 'No plan phase covers this date — everything goes to the residual bucket.'}</div>
    ${past && plan.lines ? `<div class="small muted">You sent ${money(sentTotal)} of this paycheck${open.length ? ` · ${money(open.reduce((a, l) => a + l.leftCents, 0))} still to go` : ''}.</div>` : ''}
  </div>`;

  if (plan.error) html += notice({ icon: ICON.alert, text: esc(plan.error), actions: '<button class="btn small" data-action="edit-phases">Fix plan</button>' });

  if (plan.lines) {
    html += `<div class="card">
      <div class="card-h"><h2>Transfers</h2><span class="small muted">${sentCount}/${toSend.length} sent</span></div>
      <div class="legend" style="margin-top:0">${lines.map(l => {
        const b = bucket(l.bucketId);
        const sent = l.sentCents || 0;
        const notes = (plan.notices || []).filter(n => n.bucketId === l.bucketId);
        const inbound = (plan.notices || []).filter(n => n.to === l.bucketId);
        const sub = l.residual ? 'Gets whatever is left' : b.purpose || '';
        const diff = l.state === 'partial' ? `sent ${money(sent)} · ${money(l.leftCents)} left`
          : sent > 0 && sent !== l.cents ? `sent ${money(sent)}`
          : !l.catchUpCents && l.plannedCents != null && l.plannedCents !== l.cents ? `planned ${money(l.plannedCents)}` : '';
        return `<div class="legend-row">
          <span class="sw" style="background:${bucketColor(b)}"></span>
          <button class="lbl" style="text-align:left" data-action="edit-sent" data-date="${sel.date}" data-bucket="${esc(b.id)}" data-cents="${l.cents}">
            ${esc(b.label)}<small>${esc(sub)}</small>
            ${notes.map(n => `<small style="color:var(--ink-2)">↳ ${n.reason === 'limit' ? 'Maxed for the year' : `At its ${money(n.capCents, { whole: true })} target`} — ${money(n.cents)} to ${esc(bucket(n.to)?.label)}</small>`).join('')}
            ${inbound.map(n => `<small style="color:var(--ink-2)">↳ includes ${money(n.cents)} from ${esc(bucket(n.bucketId)?.label)}</small>`).join('')}
            ${l.catchUpCents ? `<small style="color:var(--ink-2)">↳ includes ${money(l.catchUpCents)} catch-up — an earlier paycheck this month was raised after it was sent</small>` : ''}
            ${l.state === 'catchup' ? `<small style="color:var(--ink-2)">↳ ${money(l.leftCents)} short of the plan — your next paycheck makes it up</small>` : ''}
            ${l.overSentCents ? `<small style="color:var(--ink-2)">↳ ${money(l.overSentCents)} less than usual — that much extra went to another bucket</small>` : ''}
            ${doc.contributions.some(c => c.paycheck === sel.date && c.bucketId === l.bucketId && c.pendingBuy) ? '<small style="color:var(--ink-2)">↳ buy not logged yet — tap Log buy in Invest</small>' : ''}
          </button>
          <span class="val">${money(l.cents)}${diff ? `<small>${esc(diff)}</small>` : ''}</span>
          ${l.cents > 0 || sent > 0 ? `<button class="tick${isDone(l) ? ' on' : l.state === 'partial' ? ' part' : ''}" data-action="toggle-sent" data-date="${sel.date}" data-bucket="${esc(b.id)}" data-state="${l.state}" data-left="${l.leftCents}" aria-label="${isDone(l) ? `${esc(b.label)} sent — tap to undo` : l.state === 'partial' ? `${esc(b.label)} partly sent` : `Mark ${esc(b.label)} as sent`}">${ICON.check}</button>` : '<span style="width:30px"></span>'}
        </div>`;
      }).join('')}</div>
      <div class="between mt12">
        ${assigned === pay.takeHomeCents ? statusPill('good', `All ${money(pay.takeHomeCents)} assigned`) : statusPill('bad', `Off by ${money(Math.abs(pay.takeHomeCents - assigned))}`)}
        ${open.length ? `<button class="btn small" data-action="send-all" data-date="${sel.date}" data-index="${sel.index}">Mark ${open.length === toSend.length ? 'all' : 'the rest'} sent</button>` : ''}
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
  return { title: 'Plan', html, after };
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

/** Mark `cents` as sent and, for an investment account, ask what was bought. */
function sendNow(date, bucketId, cents, delay = 60) {
  const c = addSent(date, bucketId, cents);
  save();
  const acct = liveAccountFor(bucketId);
  if (acct) setTimeout(() => openBuySheet(model(), acct.id, c.id), delay);
}

/** Part of a transfer has gone out: send the rest, call it done, or undo it. */
function openPartialSheet(m, date, bucketId, left) {
  const b = m.bucketById[bucketId];
  const sent = doc.contributions.filter(c => c.paycheck === date && c.bucketId === bucketId).reduce((a, c) => a + c.cents, 0);
  openSheet({
    title: b.label,
    body: `<p class="note" style="text-align:center;margin:8px 4px 16px">You’ve sent ${money(sent, { mask: false })} from the ${esc(fmtDate(date))} paycheck. ${money(left, { mask: false })} of the plan is left.</p>
      <button type="button" class="btn primary block" data-do="rest">${ICON.check}I’ve sent the other ${money(left, { mask: false })}</button>
      <button type="button" class="btn block mt12" data-do="final">That’s all I’m sending this time</button>
      <button type="button" class="btn danger block mt12" data-do="undo">Undo — nothing was sent</button>`,
    onMount: (root, sheet) => root.addEventListener('click', e => {
      const what = e.target.closest('[data-do]')?.dataset.do;
      if (!what) return;
      if (what === 'undo' && !clearSent(date, bucketId)) return;
      if (what === 'final') doc.contributions.filter(c => c.paycheck === date && c.bucketId === bucketId).forEach(c => { c.final = true; });
      sheet.close();
      if (what === 'rest') sendNow(date, bucketId, left, 260);
      save();
      window.dispatchEvent(new Event('ledger:render'));
    }),
  });
}

/** Every past paycheck, newest first, with whether its transfers went out. */
function openPaycheckHistory(m) {
  const rows = [...m.pastPaydays].reverse().map(pd => {
    const plan = m.planFor(pd);
    const lines = (plan.lines || []).filter(l => l.cents > 0 || l.sentCents > 0);
    const sent = lines.reduce((a, l) => a + (l.sentCents || 0), 0);
    const open = openLines(lines);
    const status = !plan.pay ? 'No salary on record' : !lines.length ? '' : !open.length ? `All sent · ${money(sent)}` : sent ? `${money(sent)} sent · ${money(open.reduce((a, l) => a + l.leftCents, 0))} to go` : 'Nothing marked as sent';
    return `<button type="button" class="row" data-pick="${pd.date}">
      <span class="avatar round" style="${open.length ? '' : 'background:var(--ink);color:var(--surface)'}">${open.length ? ICON.clock.replace('<svg', '<svg width="18" height="18"') : ICON.check.replace('<svg', '<svg width="18" height="18"')}</span>
      <span class="row-main"><span class="row-title" style="display:block">${esc(fmtDate(pd.date, { weekday: true, year: true }))}</span><span class="row-sub" style="display:block">${esc(status)}</span></span>
      <span class="row-end"><span class="v">${plan.pay ? money(plan.pay.takeHomeCents) : '—'}</span></span></button>`;
  });
  openSheet({
    title: 'Past paychecks',
    body: `<div class="card flush"><div class="rows" style="margin:0">${rows.join('') || '<div class="empty">No past paychecks yet.</div>'}</div></div>
      <p class="note mt12">Each one shows the plan as it stands now next to what you actually sent. Tap one to open it.</p>`,
    onMount: (root, sheet) => root.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      picked = b.dataset.pick;
      sheet.close();
      window.dispatchEvent(new Event('ledger:render'));
    }),
  });
}

export const planActions = {
  'pick-paycheck': el => { picked = el.dataset.date; return 'render'; },
  'open-paycheck': el => { picked = el.dataset.date; ui.tab = 'plan'; saveUi(); return 'render'; },
  'paycheck-history': (el, m) => openPaycheckHistory(m),
  'toggle-sent': (el, m) => {
    const { date, bucket, state } = el.dataset;
    if (state === 'partial') { openPartialSheet(m, date, bucket, Number(el.dataset.left)); return; }
    if (state === 'full' || state === 'catchup') {
      if (!clearSent(date, bucket)) return;
      save();
      return 'render';
    }
    sendNow(date, bucket, Number(el.dataset.left));
    return 'render';
  },
  'send-all': (el, m) => {
    const sel = { date: el.dataset.date, index: Number(el.dataset.index) };
    const plan = m.planFor(sel);
    let toLog = 0;
    for (const l of openLines(plan.lines)) { if (addSent(sel.date, l.bucketId, l.leftCents).pendingBuy) toLog++; }
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
