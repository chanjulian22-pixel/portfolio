import { doc, ui, saveUi, save, newId } from '../store.js';
import { chart, meter } from '../charts.js';
import { money, fmtDate, fmtMonth, esc, ICON, openSheet, toast, todayISO, $, $$ } from '../ui.js';
import { monthKey, parts, daysInMonth, addMonths } from '../domain/dates.js';
import { CATEGORIES, categoryById, suggestCategory, monthlyBudget, outstandingWork } from '../domain/spending.js';
import { parseCents } from '../domain/money.js';
import { txRow, sortTx, dateLabel } from './common.js';

const curMonth = m => {
  const now = monthKey(m.today);
  return ui.spendMonth && ui.spendMonth <= now ? ui.spendMonth : now;
};

export function spendingView(m) {
  const month = curMonth(m);
  const isNow = month === monthKey(m.today);
  const s = m.monthSummary(month);
  const bud = m.monthBudget(month);
  const budget = bud.cents;
  const { d } = parts(m.today);
  const pm = parts(month + '-01');
  const days = daysInMonth(pm.y, pm.m);
  const pace = isNow ? d / days : null;
  const left = budget - s.spent;
  const over = budget > 0 && s.spent > budget;

  let html = `
    <div class="between" style="margin:2px 0 10px">
      <button class="icon-btn" data-action="spend-month" data-dir="-1" aria-label="Previous month">${ICON.chevL}</button>
      <div style="font-weight:650;font-size:17px">${fmtMonth(month)}</div>
      <button class="icon-btn" data-action="spend-month" data-dir="1" aria-label="Next month" ${isNow ? 'disabled style="opacity:.25"' : ''}>${ICON.chevR}</button>
    </div>
    <div class="card">
      <div class="between" style="align-items:flex-end">
        <div><div class="eyebrow">Spent</div><div class="big" style="font-size:36px;margin-top:2px">${money(s.spent)}</div></div>
        <button class="text-btn" style="text-align:right;padding:0;height:auto" data-action="edit-budget" data-month="${month}">
          <div class="eyebrow">Budget</div><div class="mid" style="color:var(--ink)">${budget ? money(budget, { whole: true }) : 'Set'}</div>
        </button>
      </div>
      ${budget ? `<div class="mt12">${meter(s.spent / budget, { color: over ? 'var(--bad-mark)' : 'var(--ink)', pace })}</div>
      <div class="meter-legend"><span>${left >= 0 ? `<strong>${money(left)}</strong> left` : `<strong class="bad">${money(-left)}</strong> over`}</span>
      <span>${isNow && left > 0 ? `${money(Math.floor(left / (days - d + 1)), { whole: true })}/day · ${days - d + 1} days` : `${s.count} transactions`}</span></div>` : ''}
      <p class="note" style="margin:10px 0 0">${bud.source === 'plan' ? 'Budget comes from what your plan sends to spending money this month.' : bud.source === 'override' ? 'Custom budget for this month.' : 'No plan covers this month — tap Budget to set one.'}${s.credits ? ` Includes ${money(s.credits)} of refunds and paybacks.` : ''}</p>
    </div>`;

  const owed = outstandingWork(doc.transactions);
  if (owed.items.length) {
    html += `<div class="notice"><span class="ico">💼</span><div style="flex:1;min-width:0"><p><strong>Work owes you ${money(owed.cents)}</strong> for ${owed.items.length} expense${owed.items.length > 1 ? 's' : ''} (oldest ${esc(fmtDate(owed.oldest))}). Not counted in your spending.</p>
      <div class="actions"><button class="btn small" data-action="work-reimbursed">Mark reimbursed</button></div></div></div>`;
  }

  // six-month trend
  const months = [];
  for (let k = 5; k >= 0; k--) months.push(addMonths(month + '-01', -k).slice(0, 7));
  const bars = months.map(mk => {
    const sum = m.monthSummary(mk);
    const b = m.monthBudget(mk).cents;
    return { key: mk, label: fmtMonth(mk, { short: true, year: false }), value: Math.max(0, sum.spent), target: b || null, highlight: mk === month };
  });
  if (bars.some(b => b.value > 0)) {
    html += `<div class="card">
      <div class="card-h"><h2>Last 6 months</h2><span class="chart-legend" style="margin:0"><span><i class="box" style="background:var(--s1)"></i>Spent</span><span><i style="background:var(--ink);opacity:.55;height:2px;width:12px"></i>Budget</span></span></div>
      ${chart({
        type: 'bars', height: 150, label: 'Spending per month vs budget', color: 'var(--s1)', dimColor: 'color-mix(in srgb, var(--s1) 38%, var(--surface))', bars,
        tooltip: b => `<b>${esc(money(b.value, { whole: true }))}</b>${esc(fmtMonth(b.key))}${b.target ? ` · budget ${esc(money(b.target, { whole: true }))}` : ''}`,
        onTap: b => { if (b.key !== ui.spendMonth) { ui.spendMonth = b.key; saveUi(); setTimeout(() => window.dispatchEvent(new Event('ledger:render')), 250); } },
      })}
      <details class="data"><summary>Show as table</summary><table><tr><th>Month</th><th>Spent</th><th>Budget</th></tr>
        ${bars.map(b => `<tr><td>${esc(fmtMonth(b.key, { short: true }))}</td><td>${money(b.value)}</td><td>${b.target ? money(b.target) : '—'}</td></tr>`).join('')}</table></details>
    </div>`;
  }

  // categories
  const cats = Object.entries(s.byCategory).filter(([id, c]) => id !== 'credits' && c > 0).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;
  const credits = s.byCategory.credits || 0;
  if (cats.length || credits) {
    html += `<div class="card"><div class="card-h"><h2>By category</h2>${ui.spendCat ? `<button class="link" data-action="spend-cat" data-id="">Clear filter</button>` : ''}</div>
      ${cats.map(([id, c]) => {
        const cat = categoryById(id);
        const dim = ui.spendCat && ui.spendCat !== id;
        return `<button class="hbar${dim ? ' dim' : ''}" data-action="spend-cat" data-id="${id}">
          <span class="em">${cat.emoji}</span>
          <span class="body"><span class="top-line"><span>${esc(cat.label)}</span><span>${money(c)}</span></span>
          <span class="track" style="display:block"><i style="width:${(c / maxCat * 100).toFixed(1)}%"></i></span></span>
        </button>`;
      }).join('')}
      ${credits < 0 ? `<button class="hbar${ui.spendCat && ui.spendCat !== 'credits' ? ' dim' : ''}" data-action="spend-cat" data-id="credits"><span class="em">↩️</span><span class="body"><span class="top-line"><span>Refunds & paybacks</span><span class="good">+${money(-credits)}</span></span></span></button>` : ''}
    </div>`;
  }

  // transactions
  const q = (ui.spendQuery || '').trim().toLowerCase();
  let list = doc.transactions.filter(t => monthKey(t.date) === month);
  if (ui.spendCat) list = list.filter(t => (t.category || 'other') === ui.spendCat);
  if (q) list = doc.transactions.filter(t => String(t.item).toLowerCase().includes(q) && (!ui.spendCat || t.category === ui.spendCat));
  list = sortTx(list);
  const groups = [];
  for (const t of list) {
    const key = t.undated ? `u${t.date.slice(0, 7)}` : t.date;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) groups.push(g = { key, t, items: [] });
    g.items.push(t);
  }
  html += `<div class="search">${ICON.search}<input class="input" id="spend-q" type="search" placeholder="Search all transactions" value="${esc(ui.spendQuery || '')}" autocomplete="off"></div>`;
  html += `<div class="card flush">${groups.length ? groups.map(g => {
    const total = g.items.reduce((a, t) => a + t.cents, 0);
    const label = g.t.undated ? `${fmtMonth(g.t.date.slice(0, 7), { short: true })} · date not recorded` : dateLabel(g.t.date, m.today);
    return `<div class="day-h"><span>${esc(label)}</span><span class="num">${money(total)}</span></div><div class="rows" style="margin:0">${g.items.map(t => txRow(t, m)).join('')}</div>`;
  }).join('') : `<div class="empty"><div class="em">🧾</div>${q ? 'No matches.' : 'No transactions yet this month.'}<br>Tap + to add one.</div>`}</div>`;

  return { title: 'Spending', html, fab: true, after: () => {
    const input = $('#spend-q');
    if (!input) return;
    input.addEventListener('input', () => {
      ui.spendQuery = input.value;
      clearTimeout(input._t);
      input._t = setTimeout(() => { window.dispatchEvent(new CustomEvent('ledger:render', { detail: { keepFocus: 'spend-q' } })); }, 250);
    });
  } };
}

// ---------------------------------------------------------------- add / edit
export function openTxSheet(m, tx = null, defaults = {}) {
  const isNew = !tx;
  const t = tx || { date: todayISO(), cents: 0, item: '', category: '', ...defaults };
  let sign = t.cents < 0 ? -1 : 1;
  let category = t.category || '';
  let picked = !!t.category;
  const items = [...new Set(sortTx(doc.transactions).map(x => x.item))].slice(0, 80);
  const funders = m.buckets.filter(b => b.kind === 'revolving' || (b.assetClass === 'cash' && b.kind !== 'pretax'));

  const catGrid = () => CATEGORIES.map(c => `<button type="button" data-cat="${c.id}" class="${c.id === category ? 'on' : ''}"><span>${c.emoji}</span>${esc(c.label.split(' ')[0])}</button>`).join('');
  openSheet({
    title: isNew ? 'New transaction' : 'Edit transaction',
    submitLabel: 'Save',
    body: `
      <div class="seg" id="tx-sign"><button type="button" data-s="1" class="${sign > 0 ? 'on' : ''}">Spent</button><button type="button" data-s="-1" class="${sign < 0 ? 'on' : ''}">Money back</button></div>
      <div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${t.cents ? (Math.abs(t.cents) / 100).toFixed(2) : ''}"></div>
      <label class="field"><span>What was it?</span><input name="what" list="tx-items" autocomplete="off" autocapitalize="sentences" maxlength="80" placeholder="e.g. Chipotle" value="${esc(t.item)}"></label>
      <datalist id="tx-items">${items.map(i => `<option value="${esc(i)}">`).join('')}</datalist>
      <div class="field"><span>Category</span><div class="cat-grid" id="tx-cats">${catGrid()}</div></div>
      <div class="grid2">
        <label class="field"><span>Date</span><input name="date" type="date" value="${esc(t.date)}" ${t.undated ? 'disabled' : ''}></label>
        <label class="field"><span>Paid from</span><select name="fundedBy"><option value="">Spending money</option>${funders.map(b => `<option value="${esc(b.id)}" ${t.fundedBy === b.id ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="undated" ${t.undated ? 'checked' : ''}> No exact date (counts toward the month)</label>
      <label class="check"><input type="checkbox" name="work" ${t.work ? 'checked' : ''}> 💼 Work expense — I’ll be reimbursed</label>
      <label class="check" id="tx-reimb" ${t.work && !isNew ? '' : 'hidden'}><input type="checkbox" name="reimbursed" ${t.reimbursedOn ? 'checked' : ''}> Already reimbursed</label>
      <p class="note">Paying from a fund like Travel takes it out of that fund’s balance instead of your spending budget. Work expenses don’t count as spending; they’re tracked until you’re paid back.</p>
      <p class="err" id="tx-err"></p>
      ${isNew ? '' : `<button type="button" class="btn danger block mt16" id="tx-del">${ICON.trash}Delete transaction</button>`}`,
    onMount: (root, sheet) => {
      const f = sheet.form.elements;
      const amount = f.amount;
      if (isNew) setTimeout(() => amount.focus(), 350);
      const recat = () => {
        if (picked) return;
        const c = toCents();
        category = suggestCategory(f.what.value, Number.isFinite(c) ? c * sign : sign, doc.transactions);
        $('#tx-cats', root).innerHTML = catGrid();
      };
      const toCents = () => Math.abs(parseCents(amount.value));
      $('#tx-sign', root).addEventListener('click', e => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        sign = Number(b.dataset.s);
        $$('#tx-sign button', root).forEach(x => x.classList.toggle('on', x === b));
        if (sign < 0 && !picked) { category = 'credits'; $('#tx-cats', root).innerHTML = catGrid(); } else recat();
      });
      $('#tx-cats', root).addEventListener('click', e => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        category = b.dataset.cat;
        picked = true;
        $('#tx-cats', root).innerHTML = catGrid();
      });
      f.what.addEventListener('input', recat);
      f.undated.addEventListener('change', () => { f.date.disabled = f.undated.checked; });
      f.work.addEventListener('change', () => { if (!isNew) $('#tx-reimb', root).hidden = !f.work.checked; });
      $('#tx-del', root)?.addEventListener('click', () => {
        if (!confirm(`Delete “${t.item}”?`)) return;
        doc.transactions = doc.transactions.filter(x => x.id !== t.id);
        save();
        sheet.close();
        window.dispatchEvent(new Event('ledger:render'));
      });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#tx-err', form).textContent = msg; return false; };
      const c = Math.abs(parseCents(f.amount.value));
      if (!Number.isFinite(c) || c === 0) return err('Enter an amount.');
      const undated = f.undated.checked;
      const date = undated ? (t.date || todayISO()).slice(0, 7) + '-01' : f.date.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('Pick a date.');
      const item = f.what.value.trim() || 'Untitled';
      const cents = c * sign;
      const work = f.work.checked;
      if (work && sign < 0) return err('No need to log the reimbursement itself — mark the work expense as reimbursed instead.');
      const rec = {
        ...t, id: t.id || newId('t'), date, cents, item,
        category: category || suggestCategory(item, cents, doc.transactions),
        fundedBy: work ? undefined : f.fundedBy.value || undefined, undated: undated || undefined,
        work: work || undefined,
        reimbursedOn: work ? (f.reimbursed.checked ? t.reimbursedOn || todayISO() : undefined) : undefined,
        createdAt: t.createdAt || Date.now(),
      };
      if (isNew) doc.transactions.push(rec);
      else doc.transactions = doc.transactions.map(x => x.id === rec.id ? rec : x);
      save();
      toast(isNew ? `Added ${item}` : 'Saved');
      window.dispatchEvent(new Event('ledger:render'));
    },
  });
}

/** Tick off the work expenses a reimbursement covered. */
export function openReimburseSheet() {
  const { items } = outstandingWork(doc.transactions);
  openSheet({
    title: 'Mark reimbursed', submitLabel: 'Save',
    body: `
      <p class="note" style="margin:4px 4px 12px">Tick the expenses your reimbursement covered.</p>
      <div class="card flush"><div class="rows plain" style="margin:0">${items.map(t => `<label class="row" style="cursor:pointer">
        <input type="checkbox" name="r_${esc(t.id)}" checked style="width:22px;height:22px;accent-color:var(--ink);flex:none">
        <span class="row-main"><span class="row-title" style="display:block">${esc(t.item)}</span><span class="row-sub" style="display:block">${esc(t.undated ? fmtMonth(t.date.slice(0, 7)) : fmtDate(t.date, { weekday: true }))}</span></span>
        <span class="row-end"><span class="v">${money(t.cents, { mask: false })}</span></span></label>`).join('') || '<div class="empty">Nothing outstanding.</div>'}</div></div>
      <div class="between mt12" style="margin:12px 4px"><span class="ink2">Reimbursed</span><strong id="r-total" class="num"></strong></div>`,
    onMount: (root, sheet) => {
      const total = () => {
        const sel = items.filter(t => sheet.form.elements['r_' + t.id]?.checked).reduce((s, t) => s + t.cents, 0);
        $('#r-total', root).textContent = money(sel, { mask: false });
      };
      root.addEventListener('change', total);
      total();
    },
    onSubmit: form => {
      const today = todayISO();
      let n = 0;
      for (const t of items) if (form.elements['r_' + t.id]?.checked) { t.reimbursedOn = today; n++; }
      if (!n) return;
      save();
      toast(`${n} expense${n > 1 ? 's' : ''} marked reimbursed`);
      window.dispatchEvent(new Event('ledger:render'));
    },
  });
}

function openBudgetSheet(m, month) {
  const plan = monthlyBudget({ ...doc.config, budgetOverrides: {} }, month);
  const cur = doc.config.budgetOverrides?.[month];
  openSheet({
    title: `${fmtMonth(month)} budget`,
    submitLabel: 'Save',
    body: `
      <div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" placeholder="0" value="${Number.isInteger(cur) ? (cur / 100).toFixed(2) : plan.cents ? (plan.cents / 100).toFixed(2) : ''}"></div>
      <p class="note" style="text-align:center">${plan.source === 'plan' ? `Your plan sends <strong>${money(plan.cents)}</strong> to spending money this month.` : 'No plan phase covers this month.'}<br>Set a custom amount for rollovers or one-off months.</p>
      ${Number.isInteger(cur) ? '<button type="button" class="btn block mt16" id="b-reset">Use the plan amount</button>' : ''}
      <p class="err" id="b-err"></p>`,
    onMount: (root, sheet) => {
      $('#b-reset', root)?.addEventListener('click', () => {
        delete doc.config.budgetOverrides[month];
        save(); sheet.close(); window.dispatchEvent(new Event('ledger:render'));
      });
    },
    onSubmit: form => {
      const c = parseCents(form.elements.amount.value);
      if (!Number.isFinite(c) || c < 0) { $('#b-err', form).textContent = 'Enter an amount.'; return false; }
      doc.config.budgetOverrides = doc.config.budgetOverrides || {};
      if (plan.source === 'plan' && c === plan.cents) delete doc.config.budgetOverrides[month];
      else doc.config.budgetOverrides[month] = c;
      save();
      window.dispatchEvent(new Event('ledger:render'));
    },
  });
}

export const spendingActions = {
  'spend-month': (el, m) => {
    const now = monthKey(m.today);
    const cur = curMonth(m);
    const next = addMonths(cur + '-01', Number(el.dataset.dir)).slice(0, 7);
    if (next > now) return;
    ui.spendMonth = next; ui.spendCat = ''; saveUi();
    return 'render';
  },
  'spend-cat': el => { ui.spendCat = ui.spendCat === el.dataset.id ? '' : el.dataset.id; saveUi(); return 'render'; },
  'edit-tx': (el, m) => { const t = doc.transactions.find(x => x.id === el.dataset.id); if (t) openTxSheet(m, t); },
  'edit-budget': (el, m) => openBudgetSheet(m, el.dataset.month),
  'work-reimbursed': () => openReimburseSheet(),
};
