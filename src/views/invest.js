import { doc, ui, saveUi, save, newId } from '../store.js';
import { meter } from '../charts.js';
import { money, shares, pct, fmtDate, timeAgo, esc, ICON, openSheet, toast, $ } from '../ui.js';
import { priceOf, prices } from '../prices.js';
import { rebalance, sleeveWeights } from '../domain/rebalance.js';
import { parseCents } from '../domain/money.js';
import { bucketColor, notice, statusPill } from './common.js';

const normTicker = t => { const s = String(t ?? '').trim().toUpperCase().replace(/\s+/g, ''); return /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(s) ? s : ''; };

export function investView(m) {
  const liveAccts = doc.accounts.map(a => ({ a, v: m.accountValues[a.id], bucket: m.buckets.find(b => b.account === a.id) }));
  const day = liveAccts.reduce((s, x) => s + (x.v.hasPositions ? x.v.dayCents : 0), 0);
  const base = m.nw.invested - day;
  let html = `<section class="hero">
    <div class="eyebrow">Invested</div>
    <div class="hero-value">${money(m.nw.invested)}</div>
    <div class="hero-sub">${day ? `<span class="delta ${day >= 0 ? 'good' : 'bad'}">${day >= 0 ? ICON.up : ICON.down}${money(Math.abs(day))} (${pct(base > 0 ? Math.abs(day) / base : 0, 2)})</span><span>today</span>` : ''}
      <span class="muted small">${prices.refreshing ? 'Updating prices…' : m.quoteTime ? `Prices as of ${new Date(m.quoteTime * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${prices.lastRefresh ? ` · ${timeAgo(prices.lastRefresh)}` : ''}` : ''}</span></div>
  </section>`;
  if (!prices.key) html += notice({ icon: ICON.info, text: '<strong>Connect live prices.</strong> Add your free Finnhub API key to value your holdings.', actions: '<button class="btn small primary" data-action="settings-prices">Add key</button>' });
  else if (prices.keyRejected) html += notice({ icon: ICON.alert, text: 'Finnhub rejected your API key.', actions: '<button class="btn small" data-action="settings-prices">Check key</button>' });

  for (const { a, v, bucket } of liveAccts) html += accountCard(m, a, v, bucket);
  html += `<button class="btn block" data-action="add-account">${ICON.plus}Add account</button>`;
  return { title: 'Invest', html, refresh: true };
}

function accountCard(m, a, v, bucket) {
  const bal = bucket ? m.balances[bucket.id] : null;
  const usesLive = v.hasPositions;
  const value = usesLive ? v.cents : bal?.cents ?? 0;
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
    </div>`;
  if (rows.length) {
    html += `<div class="rows plain" style="margin:0">${rows.map(({ h, p, value: hv }) => {
      const label = doc.tickerMeta[h.ticker]?.label;
      return `<button class="row" data-action="edit-holding" data-acct="${esc(a.id)}" data-ticker="${esc(h.ticker)}">
        <span class="row-main"><span class="row-title" style="display:block">${esc(h.ticker)}${label ? ` <span class="muted" style="font-weight:400">${esc(label)}</span>` : ''}</span>
          <span class="row-sub" style="display:block">${shares(h.shares)} sh${p ? ` × ${money(p.cents, { mask: false })}` : ''}</span></span>
        <span class="row-end">${p ? `<span class="v" style="display:block">${money(hv)}</span><span class="s" style="display:block;${p.live ? `color:var(--${p.changeCents >= 0 ? 'good' : 'bad'})` : ''}">${p.live ? pct(p.changePct, 2, { sign: true }) : 'manual price'}</span>`
          : `<span class="v muted" style="display:block">—</span><span class="s" style="display:block">${prices.refreshing ? 'loading' : 'no price'}</span>`}</span>
      </button>`;
    }).join('')}
    ${a.cash ? `<button class="row" data-action="edit-cash" data-acct="${esc(a.id)}"><span class="row-main"><span class="row-title" style="display:block">Cash</span></span><span class="row-end"><span class="v">${money(a.cash)}</span></span></button>` : ''}
    </div>`;
  }
  html += `<div style="padding:8px 18px 12px;display:flex;gap:8px"><button class="btn small" data-action="add-holding" data-acct="${esc(a.id)}">${ICON.plus}Holding</button>${a.cash ? '' : `<button class="btn small" data-action="edit-cash" data-acct="${esc(a.id)}">${ICON.plus}Cash</button>`}</div>`;

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
  openSheet({
    title: h ? h.ticker : `Add to ${a.name}`,
    submitLabel: 'Save',
    body: `
      <label class="field"><span>Ticker</span><input name="ticker" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="15" placeholder="e.g. VOO" value="${esc(h?.ticker || '')}"></label>
      <label class="field"><span>Shares</span><input name="shares" inputmode="decimal" placeholder="0" value="${h ? h.shares : ''}"></label>
      <label class="check"><input type="checkbox" name="manual" ${Number.isFinite(meta.manual) ? 'checked' : ''}> No live quote (e.g. a 401(k) trust fund) — I’ll enter the price</label>
      <label class="field" id="h-price" ${Number.isFinite(meta.manual) ? '' : 'hidden'}><span>Price per share</span><input name="price" inputmode="decimal" placeholder="0.00" value="${Number.isFinite(meta.manual) ? meta.manual : ''}"></label>
      <label class="field"><span>Name (optional)</span><input name="label" maxlength="60" placeholder="e.g. Vanguard S&amp;P 500 ETF" value="${esc(meta.label || '')}"></label>
      <p class="note">Price and name are shared by this ticker in every account.</p>
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
      });
      $('#h-del', root)?.addEventListener('click', () => {
        if (!confirm(`Remove ${h.ticker} from ${a.name}?`)) return;
        a.holdings = a.holdings.filter(x => x !== h);
        save(); sheet.close(); window.dispatchEvent(new Event('ledger:render'));
      });
      if (!h) setTimeout(() => f.ticker.focus(), 350);
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#h-err', form).textContent = msg; return false; };
      const t = normTicker(f.ticker.value);
      if (!t) return err('Enter a ticker like VOO.');
      const sh = Number(String(f.shares.value).replace(/[,\s]/g, ''));
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
    body: `<div class="amount-input"><span>$</span><input name="amount" inputmode="decimal" placeholder="0.00" value="${a.cash ? (a.cash / 100).toFixed(2) : ''}"></div><p class="err" id="c-err"></p>`,
    onSubmit: form => {
      const raw = form.elements.amount.value.trim();
      const c = raw === '' ? 0 : parseCents(raw);
      if (!Number.isFinite(c) || c < 0) { $('#c-err', form).textContent = 'Enter an amount.'; return false; }
      a.cash = c; save(); window.dispatchEvent(new Event('ledger:render'));
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
        save(); sheet.close(); window.dispatchEvent(new Event('ledger:render'));
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
      save(); window.dispatchEvent(new Event('ledger:render'));
    },
  });
}

export const investActions = {
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
        saveUi(); window.dispatchEvent(new Event('ledger:render'));
      },
    });
  },
};
