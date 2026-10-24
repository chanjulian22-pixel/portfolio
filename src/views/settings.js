import { doc, ui, saveUi, save, newId, exportJSON, importJSON } from '../store.js';
import { prices, setKey, testKey } from '../prices.js';
import { money, pct, fmtDate, esc, ICON, openSheet, toast, todayISO, $, $$ } from '../ui.js';
import { computePay } from '../domain/tax.js';
import { payFor, validatePhases, isAllocatable, isAsset } from '../domain/allocation.js';
import { addDays, addMonths, yearOf } from '../domain/dates.js';
import { parseCents } from '../domain/money.js';
import { loanBalance } from '../domain/balances.js';
import { bucketColor } from './common.js';
import { DEMO } from '../demo.js';

const rerender = () => window.dispatchEvent(new Event('ledger:render'));
const dollars = c => (Number.isInteger(c) ? (c / 100).toFixed(2) : '');
const navRow = (action, icon, title, sub) => `<button type="button" class="row" data-action="${action}"><span class="avatar">${icon}</span><span class="row-main"><span class="row-title" style="display:block">${title}</span><span class="row-sub" style="display:block">${sub}</span></span><span class="chev">${ICON.chevR}</span></button>`;

export function openSettings(m) {
  openSheet({ title: 'Settings', body: settingsBody(m), live: settingsBody });
}

function settingsBody(m) {
  const inc = m.config.incomes.filter(i => i.from <= m.today).sort((a, b) => b.from.localeCompare(a.from))[0] || m.config.incomes[0];
  return `
      <div class="group-h">Your plan</div>
      <div class="card flush"><div class="rows plain" style="margin:0">
        ${navRow('incomes', '💼', 'Income', inc ? `${money(inc.annualGrossCents, { whole: true, mask: false })}/yr · ${m.config.incomes.length} on record` : 'Add your salary')}
        ${navRow('buckets', '🪣', 'Buckets & targets', `${m.buckets.length} buckets`)}
        ${navRow('edit-phases', '🗓️', 'Plan phases', m.phaseErrors.length ? `${m.phaseErrors.length} problem${m.phaseErrors.length > 1 ? 's' : ''} to fix` : `${m.config.phases.length} phases`)}
        ${navRow('balances', '🏦', 'Update balances', 'Cash, savings and anything without live prices')}
        ${navRow('loans', '🤝', 'Loans & IOUs', m.loans.length ? m.loans.map(l => `${l.name} ${money(l.balance, { mask: false })}`).join(' · ') : 'None')}
      </div></div>
      <div class="group-h">Prices</div>
      <div class="card flush"><div class="rows plain" style="margin:0">${navRow('settings-prices', '📈', 'Live prices', prices.key ? (prices.keyRejected ? 'Key rejected' : 'Finnhub connected') : 'Add a free Finnhub key')}</div></div>
      <div class="group-h">Appearance</div>
      <div class="card"><div class="seg">${['system', 'light', 'dark'].map(t => `<button type="button" data-action="theme" data-v="${t}" class="${(ui.theme || 'system') === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="group-h">Data</div>
      <div class="card flush"><div class="rows plain" style="margin:0">
        ${navRow('export', '⬆️', 'Export backup', 'Save a copy to Files')}
        ${navRow('import', '⬇️', 'Import file', 'A backup or your prepared data file')}
        ${navRow('erase', '🗑️', 'Erase everything', 'Remove all data from this phone')}
      </div></div>
      <p class="note" style="margin:16px 4px">Everything is stored only on this phone. Ticker symbols go to Finnhub for prices; nothing else leaves the device. Tax figures are estimates for a single NYC filer — your pay stub is the authority.</p>`;
}

// ---------------------------------------------------------------- income
function openIncomes(m) {
  openSheet({ title: 'Income', body: incomesBody(m), live: incomesBody });
}

function incomesBody(m) {
  const list = [...doc.config.incomes].sort((a, b) => a.from.localeCompare(b.from));
  return `<div class="card flush"><div class="rows plain" style="margin:0">${list.map(i => {
      const pay = payFor(i.from, [i], m.periods);
      return `<button type="button" class="row" data-action="income" data-id="${esc(i.id)}"><span class="row-main"><span class="row-title" style="display:block">${esc(i.label || 'Salary')} · ${money(i.annualGrossCents, { whole: true, mask: false })}</span>
        <span class="row-sub" style="display:block">From ${esc(fmtDate(i.from, { year: true }))} · ${pay ? `${money(pay.takeHomeCents, { mask: false })} per paycheck ${pay.source === 'stub' ? '(stub)' : '(estimate)'}` : ''}</span></span><span class="chev">${ICON.chevR}</span></button>`;
    }).join('') || '<div class="empty">No salary yet.</div>'}</div></div>
    <button type="button" class="btn block mt12" data-action="income" data-id="">${ICON.plus}Add salary or raise</button>
    <p class="note mt12">Each entry applies from its date until the next one. Take-home is estimated from 2026 NY/NYC tax tables until you enter the real number from a pay stub.</p>`;
}

function openIncome(m, id) {
  const i = doc.config.incomes.find(x => x.id === id) || { id: '', label: '', from: todayISO(), annualGrossCents: 0, deferralRate: 0, matchRate: 0, otherPreTaxDeductionsCents: 0, actualTakeHomeCents: null };
  openSheet({
    title: i.id ? 'Edit salary' : 'New salary', submitLabel: 'Save',
    body: `
      <label class="field"><span>Name</span><input name="label" maxlength="40" value="${esc(i.label)}" placeholder="e.g. New role"></label>
      <div class="grid2">
        <label class="field"><span>Starts</span><input name="from" type="date" value="${esc(i.from)}"></label>
        <label class="field"><span>Annual gross ($)</span><input name="gross" inputmode="decimal" value="${i.annualGrossCents ? (i.annualGrossCents / 100).toFixed(0) : ''}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>401(k) deferral %</span><input name="def" inputmode="decimal" value="${+(i.deferralRate * 100).toFixed(2) || ''}" placeholder="0"></label>
        <label class="field"><span>Employer match %</span><input name="match" inputmode="decimal" value="${+(i.matchRate * 100).toFixed(2) || ''}" placeholder="0"></label>
      </div>
      <label class="field"><span>Other pre-tax deductions ($ per year)</span><input name="other" inputmode="decimal" value="${i.otherPreTaxDeductionsCents ? (i.otherPreTaxDeductionsCents / 100).toFixed(2) : ''}" placeholder="dental, vision, transit"></label>
      <div class="card" style="background:var(--surface);padding:14px 16px"><div class="between"><span class="small muted">Estimated take-home</span><strong id="inc-est">—</strong></div><div class="small muted mt8" id="inc-detail"></div></div>
      <label class="field"><span>Actual take-home from a pay stub ($ per paycheck)</span><input name="actual" inputmode="decimal" value="${dollars(i.actualTakeHomeCents)}" placeholder="optional — overrides the estimate"></label>
      <p class="err" id="i-err"></p>
      ${i.id ? `<button type="button" class="btn danger block" id="i-del">${ICON.trash}Delete</button>` : ''}`,
    onMount: (root, sheet) => {
      const f = sheet.form.elements;
      const est = () => {
        const gross = parseCents(f.gross.value);
        if (!Number.isFinite(gross) || gross <= 0) { $('#inc-est', root).textContent = '—'; $('#inc-detail', root).textContent = ''; return; }
        const r = computePay({ annualGrossCents: gross, deferralRate: (Number(f.def.value) || 0) / 100, otherPreTaxDeductionsCents: parseCents(f.other.value) || 0, year: yearOf(f.from.value || todayISO()), payPeriodsPerYear: m.periods });
        $('#inc-est', root).textContent = money(r.perPaycheck.takeHome, { mask: false }) + ' / paycheck';
        $('#inc-detail', root).textContent = `${money(r.annual.takeHome, { whole: true, mask: false })} a year · marginal rate ${pct(r.marginal.total)}${r.estimatedTables ? ` · using ${r.year} tables` : ''}`;
      };
      for (const n of ['gross', 'def', 'other', 'from']) f[n].addEventListener('input', est);
      est();
      $('#i-del', root)?.addEventListener('click', () => {
        if (!confirm('Delete this salary?')) return;
        doc.config.incomes = doc.config.incomes.filter(x => x.id !== i.id);
        save(); sheet.close(); rerender();
      });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#i-err', form).textContent = msg; return false; };
      const gross = parseCents(f.gross.value);
      if (!Number.isFinite(gross) || gross <= 0) return err('Enter your annual gross salary.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from.value)) return err('Pick a start date.');
      const def = Number(f.def.value || 0), match = Number(f.match.value || 0);
      if (!(def >= 0 && def <= 100) || !(match >= 0 && match <= 100)) return err('Percentages should be between 0 and 100.');
      const actual = f.actual.value.trim() ? parseCents(f.actual.value) : null;
      if (actual != null && !(actual > 0)) return err('Take-home should be a dollar amount.');
      const rec = {
        ...i, id: i.id || newId('i'), label: f.label.value.trim(), from: f.from.value, annualGrossCents: gross,
        deferralRate: def / 100, matchRate: match / 100, otherPreTaxDeductionsCents: parseCents(f.other.value) || 0, actualTakeHomeCents: actual,
      };
      if (doc.config.incomes.some(x => x.id !== rec.id && x.from === rec.from)) return err('Another salary already starts on that date.');
      doc.config.incomes = doc.config.incomes.filter(x => x.id !== rec.id).concat(rec);
      save(); rerender();
    },
  });
}

// ---------------------------------------------------------------- buckets
const KIND_LABEL = { investment: 'Investment', capped: 'Savings target', limited: 'Annual limit', revolving: 'Revolving fund', expense: 'Expense', pretax: 'Pre-tax (payroll)' };

function openBuckets(m) {
  openSheet({ title: 'Buckets & targets', body: bucketsBody(), live: bucketsBody });
}

function bucketsBody() {
  return `<p class="note" style="margin:4px 4px 12px">Every dollar of take-home goes to exactly one bucket. The bucket marked “gets the rest” absorbs whatever the targets leave.</p>
      <div class="card flush"><div class="rows plain" style="margin:0">${doc.config.buckets.map(b => `<button type="button" class="row" data-action="bucket" data-id="${esc(b.id)}">
        <span class="dot" style="background:${bucketColor(b)};width:12px;height:12px"></span>
        <span class="row-main"><span class="row-title" style="display:block">${esc(b.label)}</span><span class="row-sub" style="display:block">${esc(KIND_LABEL[b.kind] || b.kind)}${b.isResidual ? ' · gets the rest' : ''}${b.kind === 'capped' ? ` · target ${money(b.targetCents, { whole: true, mask: false })}` : ''}${b.kind === 'limited' ? ` · ${b.limitKey === 'ira' ? 'IRA limit' : b.limitKey === 'k401' ? '401(k) limit' : money(b.annualLimitCents, { whole: true, mask: false }) + '/yr'}` : ''}</span></span>
        <span class="chev">${ICON.chevR}</span></button>`).join('')}</div></div>
      <button type="button" class="btn block mt12" data-action="bucket" data-id="">${ICON.plus}Add bucket</button>`;
}

function openBucket(m, id) {
  // A new bucket takes an unused chart colour, or shares the least-used one past eight buckets.
  const uses = c => doc.config.buckets.filter(b => b.color === c).length;
  const free = [1, 2, 3, 4, 5, 6, 7, 8].sort((x, y) => uses(x) - uses(y) || x - y)[0];
  const b = doc.config.buckets.find(x => x.id === id) || { id: '', label: '', kind: 'capped', assetClass: 'cash', color: free, expectedAnnualReturn: 0.04, purpose: '' };
  if (!b.id && doc.config.buckets.length >= 12) { toast('Up to 12 buckets — combine some first.', true); return; }
  const sweep = doc.config.sweeps.find(s => s.watch === b.id);
  const others = doc.config.buckets.filter(x => x.id !== b.id && isAllocatable(x) && x.kind !== 'expense');
  openSheet({
    title: b.id ? b.label : 'New bucket', submitLabel: 'Save',
    body: `
      <label class="field"><span>Name</span><input name="label" maxlength="40" value="${esc(b.label)}" placeholder="e.g. House fund"></label>
      <label class="field"><span>Purpose</span><input name="purpose" maxlength="80" value="${esc(b.purpose || '')}" placeholder="What it's for"></label>
      <label class="field"><span>Type</span><select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${b.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div data-show="capped"><label class="field"><span>Target balance ($)</span><input name="target" inputmode="decimal" value="${dollars(b.targetCents)}"></label></div>
      <div data-show="limited"><label class="field"><span>Annual limit</span><select name="limitKey"><option value="ira" ${b.limitKey === 'ira' ? 'selected' : ''}>IRS IRA limit</option><option value="k401" ${b.limitKey === 'k401' ? 'selected' : ''}>IRS 401(k) limit</option><option value="" ${!b.limitKey ? 'selected' : ''}>Custom amount</option></select></label>
        <label class="field"><span>Custom limit ($ per year)</span><input name="limit" inputmode="decimal" value="${dollars(b.annualLimitCents)}"></label></div>
      <div data-show="capped limited"><label class="field"><span>When it’s full, send its share to</span><select name="sweep"><option value="">Whatever gets the rest</option>${others.map(o => `<option value="${esc(o.id)}" ${sweep?.to === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label></div>
      <div data-show="investment capped limited revolving pretax"><div class="grid2">
        <label class="field"><span>Asset class</span><select name="assetClass"><option value="equity" ${b.assetClass === 'equity' ? 'selected' : ''}>Stocks</option><option value="cash" ${b.assetClass === 'cash' ? 'selected' : ''}>Cash</option></select></label>
        <label class="field"><span>Expected return %/yr</span><input name="ret" inputmode="decimal" value="${+((b.expectedAnnualReturn || 0) * 100).toFixed(2)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="locked" ${b.lockedUntilAge ? 'checked' : ''}> Retirement account (locked until 59½)</label></div>
      <div data-show="investment"><label class="check"><input type="checkbox" name="residual" ${b.isResidual ? 'checked' : ''}> Gets whatever is left of each paycheck</label></div>
      <div data-show="expense"><label class="check"><input type="checkbox" name="spending" ${b.isSpending ? 'checked' : ''}> This is my spending budget</label></div>
      <p class="err" id="b-err"></p>
      ${b.id && !b.isResidual ? `<button type="button" class="btn danger block" id="b-del">${ICON.trash}Delete bucket</button>` : ''}`,
    onMount: (root, sheet) => {
      const f = sheet.form.elements;
      const sync = () => $$('[data-show]', root).forEach(el => { el.hidden = !el.dataset.show.split(' ').includes(f.kind.value); });
      f.kind.addEventListener('change', sync);
      sync();
      $('#b-del', root)?.addEventListener('click', () => {
        if (!confirm(`Delete ${b.label}? It’s removed from every plan phase.`)) return;
        doc.config.buckets = doc.config.buckets.filter(x => x.id !== b.id);
        for (const p of doc.config.phases) delete p.amounts?.[b.id];
        doc.config.sweeps = doc.config.sweeps.filter(s => s.watch !== b.id && s.to !== b.id);
        save(); sheet.close(); rerender();
      });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#b-err', form).textContent = msg; return false; };
      const label = f.label.value.trim();
      if (!label) return err('Give it a name.');
      const kind = f.kind.value;
      const rec = { ...b, id: b.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 5), label, kind, purpose: f.purpose.value.trim() };
      if (kind === 'capped') {
        const t = parseCents(f.target.value);
        if (!(t > 0)) return err('Enter a target balance.');
        rec.targetCents = t;
      } else delete rec.targetCents;
      if (kind === 'limited') {
        rec.limitKey = f.limitKey.value || undefined;
        if (!rec.limitKey) { const l = parseCents(f.limit.value); if (!(l > 0)) return err('Enter the annual limit.'); rec.annualLimitCents = l; } else delete rec.annualLimitCents;
      } else { delete rec.limitKey; delete rec.annualLimitCents; }
      if (kind !== 'expense') {
        rec.assetClass = f.assetClass.value;
        rec.expectedAnnualReturn = (Number(f.ret.value) || 0) / 100;
        rec.lockedUntilAge = f.locked.checked ? 59.5 : undefined;
      } else { delete rec.assetClass; delete rec.expectedAnnualReturn; delete rec.lockedUntilAge; }
      rec.isResidual = kind === 'investment' && f.residual.checked ? true : undefined;
      rec.isSpending = kind === 'expense' && f.spending.checked ? true : undefined;
      if (b.isResidual && !rec.isResidual) return err('One bucket must get the rest — mark another one first.');
      if (rec.isResidual) for (const x of doc.config.buckets) if (x.id !== rec.id) delete x.isResidual;
      doc.config.buckets = b.id ? doc.config.buckets.map(x => x.id === b.id ? rec : x) : doc.config.buckets.concat(rec);
      doc.config.sweeps = doc.config.sweeps.filter(s => s.watch !== rec.id);
      if ((kind === 'capped' || kind === 'limited') && f.sweep.value) doc.config.sweeps.push({ id: newId('w'), watch: rec.id, to: f.sweep.value });
      save(); rerender();
    },
  });
}

// ---------------------------------------------------------------- phases
export function openPhases(m) {
  openSheet({ title: 'Plan phases', body: phasesBody(m), live: phasesBody });
}

function phasesBody(m) {
  const errs = validatePhases(doc.config.phases);
  const list = [...doc.config.phases].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return `<p class="note" style="margin:4px 4px 12px">A phase sets how much each bucket gets from the 1st and 2nd paycheck of each month, for a date range. Phases should follow each other with no gaps.</p>
      ${errs.map(e => `<div class="notice"><span class="ico bad">${ICON.alert}</span><p>${esc(e)}</p></div>`).join('')}
      <div class="card flush"><div class="rows plain" style="margin:0">${list.map(p => `<button type="button" class="row" data-action="phase" data-id="${esc(p.id)}">
        <span class="row-main"><span class="row-title" style="display:block">${esc(p.label)}</span><span class="row-sub" style="display:block">${esc(fmtDate(p.startDate, { year: true }))} – ${esc(fmtDate(p.endDate, { year: true }))}${p.startDate <= m.today && m.today <= p.endDate ? ' · current' : ''}</span></span>
        <span class="chev">${ICON.chevR}</span></button>`).join('') || '<div class="empty">No phases yet.</div>'}</div></div>
      <button type="button" class="btn block mt12" data-action="phase" data-id="">${ICON.plus}Add phase</button>`;
}

function openPhase(m, id, copyFrom = null) {
  const sorted = [...doc.config.phases].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const last = sorted[sorted.length - 1];
  const src = doc.config.phases.find(x => x.id === id);
  const start = last ? addDays(last.endDate, 1) : m.today.slice(0, 8) + '01';
  const p = src || {
    id: '', label: copyFrom ? `${copyFrom.label} (copy)` : '', startDate: start, endDate: addDays(addMonths(start, 3), -1),
    amounts: copyFrom ? JSON.parse(JSON.stringify(copyFrom.amounts)) : {}, note: '',
  };
  const rows = doc.config.buckets.filter(b => isAllocatable(b) && !b.isResidual);
  const residual = doc.config.buckets.find(b => b.isResidual);
  openSheet({
    title: src ? 'Edit phase' : 'New phase', submitLabel: 'Save',
    body: `
      <label class="field"><span>Name</span><input name="label" maxlength="60" value="${esc(p.label)}" placeholder="e.g. Jan–Apr 2027"></label>
      <div class="grid2"><label class="field"><span>Starts</span><input name="start" type="date" value="${esc(p.startDate)}"></label><label class="field"><span>Ends</span><input name="end" type="date" value="${esc(p.endDate)}"></label></div>
      <div class="card" style="padding:14px">
        <div class="amount-grid"><span class="h">Bucket</span><span class="h" style="text-align:right">1st paycheck</span><span class="h" style="text-align:right">2nd paycheck</span>
        ${rows.map(b => `<span class="row-flex" style="gap:8px;min-width:0"><span class="dot" style="background:${bucketColor(b)}"></span><span style="font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.label)}</span></span>
          <input name="p1_${esc(b.id)}" inputmode="decimal" value="${dollars(p.amounts?.[b.id]?.p1 || 0)}"><input name="p2_${esc(b.id)}" inputmode="decimal" value="${dollars(p.amounts?.[b.id]?.p2 || 0)}">`).join('')}
        <span class="row-flex" style="gap:8px"><span class="dot" style="background:${bucketColor(residual)}"></span><strong style="font-size:14.5px">${esc(residual?.label || 'Rest')}</strong></span><strong class="num" id="r1" style="text-align:right">—</strong><strong class="num" id="r2" style="text-align:right">—</strong>
        <span class="small muted">Take-home</span><span class="small muted num" id="th1" style="text-align:right"></span><span class="small muted num" id="th2" style="text-align:right"></span>
        </div>
      </div>
      <p class="note">${esc(residual?.label || 'The residual bucket')} gets whatever’s left, worked out from your take-home on the phase’s start date. Savings targets and annual limits still apply on top of this.</p>
      <label class="field"><span>Note</span><textarea name="note" maxlength="300" placeholder="Why this phase exists">${esc(p.note || '')}</textarea></label>
      <p class="err" id="p-err"></p>
      ${src ? `<div class="grid2"><button type="button" class="btn" id="p-copy">Duplicate</button><button type="button" class="btn danger" id="p-del">${ICON.trash}Delete</button></div>` : ''}`,
    onMount: (root, sheet) => {
      const f = sheet.form.elements;
      const preview = () => {
        const pay = payFor(f.start.value, doc.config.incomes, m.periods);
        const th = pay?.takeHomeCents;
        for (const i of [1, 2]) {
          let used = 0;
          for (const b of rows) { const c = parseCents(f[`p${i}_${b.id}`].value || '0'); if (Number.isFinite(c)) used += c; }
          const el = $(`#r${i}`, root);
          if (th == null) { el.textContent = '—'; continue; }
          const left = th - used;
          el.textContent = money(left, { mask: false });
          el.style.color = left < 0 ? 'var(--bad)' : '';
          $(`#th${i}`, root).textContent = money(th, { mask: false });
        }
      };
      root.addEventListener('input', preview);
      preview();
      $('#p-del', root)?.addEventListener('click', () => {
        if (!confirm(`Delete “${p.label}”?`)) return;
        doc.config.phases = doc.config.phases.filter(x => x.id !== p.id);
        save(); sheet.close(); rerender();
      });
      $('#p-copy', root)?.addEventListener('click', () => { sheet.close(); setTimeout(() => openPhase(m, '', p), 220); });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#p-err', form).textContent = msg; return false; };
      const label = f.label.value.trim();
      if (!label) return err('Give the phase a name.');
      if (!(f.start.value && f.end.value) || f.end.value < f.start.value) return err('Check the dates.');
      const amounts = {};
      for (const b of rows) {
        const p1 = parseCents(f[`p1_${b.id}`].value || '0'), p2 = parseCents(f[`p2_${b.id}`].value || '0');
        if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 < 0 || p2 < 0) return err(`Check the amounts for ${b.label}.`);
        if (p1 || p2) amounts[b.id] = { p1, p2 };
      }
      const pay = payFor(f.start.value, doc.config.incomes, m.periods);
      if (pay) {
        for (const i of [1, 2]) {
          const used = Object.values(amounts).reduce((a, x) => a + (i === 1 ? x.p1 : x.p2), 0);
          if (used > pay.takeHomeCents) return err(`Paycheck ${i} plans ${money(used, { mask: false })} but take-home is ${money(pay.takeHomeCents, { mask: false })}.`);
        }
      }
      const rec = { ...p, id: p.id || newId('p'), label, startDate: f.start.value, endDate: f.end.value, amounts, note: f.note.value.trim() };
      const next = doc.config.phases.filter(x => x.id !== rec.id).concat(rec);
      const problems = validatePhases(next);
      doc.config.phases = next;
      save(); rerender();
      if (problems.length) toast(problems[0], true);
    },
  });
}

// ---------------------------------------------------------------- balances
function openBalances(m) {
  const list = m.buckets.filter(b => isAsset(b));
  openSheet({
    title: 'Update balances', submitLabel: 'Save',
    body: `<p class="note" style="margin:4px 4px 12px">Enter what each account shows today. Buckets linked to an investment account with holdings use live prices instead.</p>
      <div class="card">${list.map(b => {
        const bal = m.balances[b.id];
        const live = bal?.source === 'live';
        return `<label class="field"><span class="row-flex" style="gap:8px"><span class="dot" style="background:${bucketColor(b)}"></span>${esc(b.label)}</span>
          ${live ? `<div class="input" style="display:flex;align-items:center;color:var(--muted)">${money(bal.cents, { mask: false })} · live</div>` : `<input name="b_${esc(b.id)}" inputmode="decimal" placeholder="${dollars(bal?.cents ?? 0)}" data-current="${bal?.cents ?? 0}">`}
          ${!live && bal?.snapshotDate ? `<div class="hint">Last entered ${esc(fmtDate(bal.snapshotDate, { year: true }))}: ${money(bal.snapshotCents, { mask: false })}${bal.addedCents ? ` · ${money(bal.addedCents, { sign: true, mask: false })} since` : ''}</div>` : ''}</label>`;
      }).join('')}</div>
      <p class="note">Leave a field empty to keep the current figure. Transfers you mark as sent in Plan are added on top of the last balance you enter.</p>`,
    onSubmit: form => {
      let n = 0;
      for (const b of list) {
        const el = form.elements[`b_${b.id}`];
        if (!el || !el.value.trim()) continue;
        const c = parseCents(el.value);
        if (!Number.isFinite(c)) continue;
        doc.snapshots.push({ id: newId('s'), bucketId: b.id, date: m.today, cents: c, at: Date.now() });
        n++;
      }
      if (n) { save(); toast(`Updated ${n} balance${n > 1 ? 's' : ''}`); rerender(); }
    },
  });
}

// ---------------------------------------------------------------- loans
export function openLoans(m) {
  openSheet({ title: 'Loans & IOUs', body: loansBody(), live: loansBody });
}

function loansBody() {
  return `<div class="card flush"><div class="rows plain" style="margin:0">${doc.loans.map(l => `<button type="button" class="row" data-action="loan" data-id="${esc(l.id)}">
      <span class="avatar round">🤝</span><span class="row-main"><span class="row-title" style="display:block">${esc(l.name)}</span><span class="row-sub" style="display:block">${l.direction === 'i-owe' ? 'You owe' : 'Owes you'} · ${l.entries.length} entries${l.includeInNetWorth ? ' · in net worth' : ''}</span></span>
      <span class="row-end"><span class="v">${money(loanBalance(l))}</span></span></button>`).join('') || '<div class="empty">No loans.</div>'}</div></div>
      <button type="button" class="btn block mt12" data-action="loan" data-id="">${ICON.plus}New loan</button>`;
}

function openLoan(m, id) {
  const l = doc.loans.find(x => x.id === id);
  if (!l) {
    openSheet({
      title: 'New loan', submitLabel: 'Create',
      body: `<label class="field"><span>Who</span><input name="name" maxlength="40" placeholder="e.g. Sam"></label>
        <div class="seg" id="dir"><button type="button" class="on" data-d="i-owe">I owe them</button><button type="button" data-d="owed-to-me">They owe me</button></div>
        <div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" placeholder="0.00"></div><p class="err" id="l-err"></p>`,
      onMount: root => $('#dir', root).addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; $$('#dir button', root).forEach(x => x.classList.toggle('on', x === b)); }),
      onSubmit: form => {
        const name = form.elements.name.value.trim();
        const c = parseCents(form.elements.amount.value);
        if (!name || !(c > 0)) { $('#l-err', form).textContent = 'Enter a name and amount.'; return false; }
        const direction = $('#dir .on', form).dataset.d;
        doc.loans.push({ id: newId('loan'), name, direction, includeInNetWorth: true, entries: [{ id: newId('l'), date: m.today, item: 'Starting balance', cents: c }] });
        save(); rerender();
      },
    });
    return;
  }
  const entries = [...l.entries].reverse();
  openSheet({
    title: l.name, submitLabel: 'Add',
    body: `
      <div style="text-align:center;padding:8px 0 4px"><div class="eyebrow">${l.direction === 'i-owe' ? 'You owe' : 'Owes you'}</div><div class="hero-value" style="font-size:38px">${money(loanBalance(l), { mask: false })}</div></div>
      <div class="seg" id="kind"><button type="button" class="on" data-k="-1">${l.direction === 'i-owe' ? 'Paid back / covered' : 'They paid back'}</button><button type="button" data-k="1">${l.direction === 'i-owe' ? 'Borrowed more' : 'Lent more'}</button></div>
      <div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" placeholder="0.00"></div>
      <label class="field"><span>For</span><input name="what" maxlength="60" placeholder="e.g. Groceries"></label>
      <label class="check"><input type="checkbox" name="nw" ${l.includeInNetWorth ? 'checked' : ''}> Count this loan in net worth</label>
      <p class="err" id="l-err"></p>
      <div class="group-h">History</div>
      <div class="card flush"><div class="rows plain" style="margin:0">${entries.map(e => `<div class="row"><span class="row-main"><span class="row-title" style="display:block">${esc(e.item)}</span><span class="row-sub" style="display:block">${e.date ? esc(fmtDate(e.date, { year: true })) : 'from spreadsheet'}</span></span>
        <span class="row-end"><span class="v ${e.cents < 0 ? 'good' : ''}">${money(e.cents, { sign: true, mask: false })}</span></span><button type="button" class="icon-btn" data-del="${esc(e.id)}" aria-label="Delete entry" style="width:32px;height:32px;color:var(--muted)">${ICON.x}</button></div>`).join('')}</div></div>
      <button type="button" class="btn danger block mt16" id="loan-del">${ICON.trash}Delete loan</button>`,
    onMount: (root, sheet) => {
      $('#kind', root).addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; $$('#kind button', root).forEach(x => x.classList.toggle('on', x === b)); });
      sheet.form.elements.nw.addEventListener('change', e => { l.includeInNetWorth = e.target.checked; save(); rerender(); });
      root.addEventListener('click', e => {
        const d = e.target.closest('[data-del]');
        if (!d || !confirm('Delete this entry?')) return;
        l.entries = l.entries.filter(x => x.id !== d.dataset.del);
        save(); sheet.close(); rerender(); setTimeout(() => openLoan(m, l.id), 230);
      });
      $('#loan-del', root).addEventListener('click', () => {
        if (!confirm(`Delete the loan with ${l.name}?`)) return;
        doc.loans = doc.loans.filter(x => x !== l);
        save(); sheet.close(); rerender();
      });
    },
    onSubmit: (form, sheet) => {
      const c = parseCents(form.elements.amount.value);
      if (!(c > 0)) { $('#l-err', form).textContent = 'Enter an amount.'; return false; }
      const k = Number($('#kind .on', form).dataset.k);
      l.entries.push({ id: newId('l'), date: m.today, item: form.elements.what.value.trim() || (k < 0 ? 'Paid back' : 'Borrowed'), cents: k * c });
      save(); rerender();
      setTimeout(() => openLoan(m, l.id), 230);
    },
  });
}

// ---------------------------------------------------------------- prices
export function openPrices() {
  openSheet({
    title: 'Live prices', submitLabel: 'Save',
    body: `<p class="note" style="margin:4px 4px 12px">Prices come from Finnhub’s free plan (60 requests a minute). Sign up at <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io</a> and paste your API key. It’s stored only on this phone.</p>
      <label class="field"><span>Finnhub API key</span><input name="key" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="-webkit-text-security:disc" value="${esc(prices.key)}" placeholder="Paste your key"></label>
      <p class="note" id="key-status">${prices.key ? (prices.keyRejected ? 'Finnhub rejected this key.' : 'Key saved on this phone.') : ''}</p>`,
    onSubmit: async (form) => {
      const k = form.elements.key.value.trim();
      setKey(k);
      if (!k) { toast('Key removed'); rerender(); return; }
      $('#key-status', form).textContent = 'Checking…';
      const r = await testKey(k);
      prices.keyRejected = !r.ok;
      toast(r.msg, !r.ok);
      window.dispatchEvent(new CustomEvent('ledger:render', { detail: { refreshPrices: 'all' } }));
      return r.ok;
    },
  });
}

// ---------------------------------------------------------------- data
async function exportBackup() {
  const name = `ledger-backup-${todayISO()}.json`;
  const file = new File([exportJSON()], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function importFile(file) {
  if (DEMO) { toast('Importing is off in the demo — open the app without ?demo to use your own data.'); return; }
  const text = await file.text();
  let summary;
  try {
    const peek = JSON.parse(text);
    if (peek.kind === 'additions') {
      const n = Array.isArray(peek.transactions) ? peek.transactions.length : 0;
      if (!confirm(`Add ${n} transaction${n === 1 ? '' : 's'} from ${peek.label || 'this file'}? Nothing already on this phone is replaced, and anything you’ve already logged isn’t added twice.`)) return;
      const r = importJSON(text);
      toast(`Added ${r.added}${r.matched ? `, matched ${r.matched} you’d logged` : ''}${r.already ? `, ${r.already} already here` : ''}${r.cardsAdded ? ` · added ${r.cardsAdded} card${r.cardsAdded === 1 ? '' : 's'}` : ''}`);
      window.dispatchEvent(new Event('ledger:render'));
      return;
    }
    const what = peek.kind === 'seed' ? 'your prepared data file' : 'this backup';
    if (doc.transactions.length || doc.config.incomes.length) {
      if (!confirm(`Replace your plan, transactions, balances and loans with ${what}? Holdings you entered on this phone are kept.`)) return;
    }
    summary = importJSON(text);
  } catch (e) {
    toast(e.message || 'Couldn’t read that file.', true);
    return;
  }
  toast(`Imported ${summary.transactions} transactions and ${summary.phases} plan phases`);
  window.dispatchEvent(new CustomEvent('ledger:render', { detail: { refreshPrices: 'all' } }));
}

function erase() {
  if (DEMO) { location.reload(); return; } // the demo starts over; real data is never touched
  if (!confirm('Erase all Ledger data on this phone? Export a backup first if you might want it.')) return;
  if (!confirm('Really erase everything? This can’t be undone.')) return;
  for (const k of ['ledger.v2', 'ledger.ui', 'pt.state.v1', 'pt.quotes.v1', 'pt.ui.v1']) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  location.reload();
}

export const settingsActions = {
  settings: (el, m) => openSettings(m),
  'settings-prices': () => openPrices(),
  incomes: (el, m) => openIncomes(m),
  income: (el, m) => openIncome(m, el.dataset.id),
  buckets: (el, m) => openBuckets(m),
  bucket: (el, m) => openBucket(m, el.dataset.id),
  'edit-phases': (el, m) => openPhases(m),
  phase: (el, m) => openPhase(m, el.dataset.id),
  balances: (el, m) => openBalances(m),
  loans: (el, m) => openLoans(m),
  loan: (el, m) => openLoan(m, el.dataset.id),
  export: () => exportBackup(),
  import: () => document.getElementById('import-file').click(),
  erase: () => erase(),
  theme: el => { ui.theme = el.dataset.v; saveUi(); window.dispatchEvent(new Event('ledger:theme')); return 'render'; },
};
