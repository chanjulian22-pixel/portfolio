// Cards: which card to use for a purchase, annual-fee tracking, statement credits, and
// "would this card pay for itself?". Card terms come from src/data/cards.json (see cardsCatalog.js).
import { doc, ui, saveUi, save, newId } from '../store.js';
import { meter } from '../charts.js';
import { money, pct, fmtDate, fmtMonth, esc, ICON, openSheet, toast, $, $$ } from '../ui.js';
import {
  REWARD_CATS, rewardCatById, rewardCatFor, bestCards, feeStatus, creditUsedNow, periodKey, periodLabel, periodEnd,
  perYear, pointCents, simulateCard, resolveCard, quarterOf, MERCHANTS, NETWORKS, merchantFor, guessRewardCat, valueOn,
} from '../domain/cards.js';
import { parseCents } from '../domain/money.js';
import { addMonths, monthsBetween, daysBetween } from '../domain/dates.js';
import { notice } from './common.js';

const rerender = () => window.dispatchEvent(new Event('ledger:render'));
const rateText = (card, rate) => card.program === 'cash' ? `${+rate}% back` : `${+rate}x ${card.program === 'MR' ? 'Amex points' : card.program === 'UR' ? 'Chase points' : 'points'}`;
const cardDot = (m, card) => `var(--s${(Math.max(0, m.cards.findIndex(c => c.id === card.id)) % 8) + 1})`;
const owned = id => doc.cards.find(c => c.id === id);
const dollars = c => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));

/** Your cards ranked for a purchase, for the add-transaction sheet. */
export function rankForPurchase(m, category, item) {
  const cat = rewardCatFor({ category, item });
  const merchant = merchantFor(item);
  return { cat, merchant, ranked: bestCards(m.cards, cat, { today: m.today, txs: doc.transactions, catalog: m.catalog, prefs: m.cardPrefs, merchant }) };
}

/** The "About to pay?" bar that opens the which-card check (Home and the Cards screen). */
export const payBar = () => `<button class="pay-bar" data-action="which-card">${ICON.spending}<span>About to pay? Find the best card</span></button>`;

// ---------------------------------------------------------------- before you pay
// Reward category → spending category, to start the transaction you log afterwards.
const SPEND_CAT = { dining: 'food', groceries: 'groceries', gas: 'transport', rideshare: 'transport', transit: 'transport', flights: 'travel', hotels: 'travel', portal: 'travel', streaming: 'bills', drugstore: 'health' };

export function openWhichCard(m) {
  if (!m.cards.length) { openAddCard(m); return; }
  let picked = null; // a category tapped by hand wins over the guess
  let best = null, cat = null;
  const names = [...new Set([...MERCHANTS.map(x => x.name), ...[...doc.transactions].reverse().filter(t => t.cents > 0).map(t => t.item)])].slice(0, 250);
  openSheet({
    title: 'Which card?',
    body: `
      <label class="field"><span>Where are you paying?</span><input name="where" list="wc-list" autocomplete="off" autocapitalize="words" maxlength="80" placeholder="e.g. Trader Joe’s, Uber, Shell"></label>
      <datalist id="wc-list">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="chips" id="wc-cats"></div>
      <label class="field"><span>Amount (optional)</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00"></label>
      <div id="wc-out"></div>`,
    onMount: (root, sheet) => {
      const f = sheet.form.elements;
      setTimeout(() => f.where.focus(), 350);
      const draw = () => {
        const text = f.where.value.trim();
        const merchant = merchantFor(text);
        const guess = guessRewardCat(text, doc.transactions);
        // a store it doesn't know is most likely a general purchase; say so and let a tap correct it
        const unsure = !picked && !guess && !!text;
        cat = picked || guess || (text ? 'other' : null);
        const chips = $('#wc-cats', root);
        chips.innerHTML = REWARD_CATS.map(c => `<button type="button" class="chip${c.id === cat ? ' on' : ''}" data-cat="${c.id}">${c.emoji} ${esc(c.label)}</button>`).join('');
        const on = $('.chip.on', chips);
        if (on) chips.scrollLeft += on.getBoundingClientRect().left - chips.getBoundingClientRect().left - 16;
        const out = $('#wc-out', root);
        best = null;
        if (!cat) {
          out.innerHTML = '<p class="note" style="margin:0 4px">Type the store, or tap a category.</p>';
          return;
        }
        const amount = Math.abs(parseCents(f.amount.value));
        const cents = Number.isFinite(amount) && amount > 0 ? amount : 0;
        const ranked = bestCards(m.cards, cat, { today: m.today, txs: doc.transactions, catalog: m.catalog, prefs: m.cardPrefs, merchant });
        if (cents) ranked.sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || valueOn(b, cents) - valueOn(a, cents));
        best = ranked[0];
        const usable = ranked.filter(r => !r.blocked);
        // Plenty of places don't take Amex: name the best card on another network.
        const backup = best.card.network === 'amex' ? usable.find(r => r.card.network && r.card.network !== 'amex') : null;
        const what = `${merchant && merchant.cat === cat ? `${esc(merchant.name)} · ` : ''}${esc(rewardCatById(cat).label)}`;
        // credits waiting on your other cards for this purchase (e.g. Uber Cash on the Gold)
        const elsewhere = usable.filter(r => r !== best && r.perks.length && r.card.id !== best.card.id);
        out.innerHTML = `
          <div class="card">
            <div class="eyebrow">${what}${unsure ? ' · not sure' : !picked && guess && !merchant ? ' · best guess' : ''}</div>
            ${unsure ? '<div class="small ink2 mt8">Don’t know this store. If it’s a restaurant, grocery store or gas station, tap that category above.</div>' : ''}
            <div class="between" style="align-items:flex-end;margin-top:8px">
              <div style="min-width:0"><div class="small ink2">Use</div><div class="big" style="line-height:1.15">${esc(best.card.short)}</div></div>
              <div style="text-align:right;flex:none"><div class="big good">${cents ? money(valueOn(best, cents), { mask: false }) : pct(best.pct)}</div><div class="small ink2">${cents ? `back on ${money(cents, { mask: false })}` : 'back'}</div></div>
            </div>
            ${best.blocked ? `<p class="err mt8" style="margin-bottom:0">${esc(best.blocked)} — none of your cards fit here.</p>` : ''}
            <div class="small ink2 mt8">${esc(rateText(best.card, best.rate))}${best.note ? ` · ${esc(best.note)}` : ''}</div>
            ${best.capLeftCents != null && cents > best.capLeftCents ? `<div class="small ink2">Only ${money(best.capLeftCents, { mask: false })} left at this rate; the rest earns less.</div>` : ''}
            ${best.activate ? `<div class="small mt8" style="font-weight:600">${ICON.alert.replace('<svg', '<svg width="14" height="14" style="display:inline-block;vertical-align:-2px;color:var(--warn-mark)"')} ${esc(best.activate)}</div>` : ''}
            ${best.perks.map(p => `<div class="small good mt8">+ ${esc(p)}</div>`).join('')}
            ${elsewhere.map(r => r.perks.map(p => `<div class="small mt8"><span class="good">+ ${esc(p)}</span> <span class="muted">on your ${esc(r.card.short)}</span></div>`).join('')).join('')}
            ${merchant?.note && merchant.cat === cat ? `<div class="small muted mt8">${esc(merchant.note)}</div>` : ''}
            ${backup ? `<div class="small mt12" style="padding-top:10px;border-top:1px solid var(--hairline)">If they don’t take Amex: <strong>${esc(backup.card.short)}</strong> · ${cents ? `${money(valueOn(backup, cents), { mask: false })} back` : `${pct(backup.pct)} back`}</div>` : ''}
          </div>
          ${ranked.length > 1 ? `<div class="card flush"><div class="rows plain" style="margin:0">${ranked.slice(1).map(r => `<div class="row"${r.blocked ? ' style="opacity:.5"' : ''}>
            <span class="dot" style="background:${cardDot(m, r.card)};width:10px;height:10px"></span>
            <span class="row-main"><span class="row-title" style="display:block">${esc(r.card.short)}</span>
              <span class="row-sub" style="display:block;white-space:normal">${r.blocked ? esc(r.blocked) : esc(rateText(r.card, r.rate))}${r.perks.length && !r.blocked ? ` · ${esc(r.perks[0])}` : ''}</span></span>
            <span class="row-end"><span class="v">${r.blocked ? '—' : cents ? money(valueOn(r, cents), { mask: false }) : pct(r.pct)}</span></span></div>`).join('')}</div></div>` : ''}
          <button type="button" class="btn block" id="wc-log">${ICON.plus}Log this purchase${best.blocked ? '' : ` on ${esc(best.card.short)}`}</button>`;
      };
      root.addEventListener('click', e => {
        const chip = e.target.closest('[data-cat]');
        if (chip) { picked = chip.dataset.cat === cat && picked ? null : chip.dataset.cat; draw(); return; }
        if (e.target.closest('#wc-log')) {
          const amount = Math.abs(parseCents(f.amount.value));
          const detail = { item: f.where.value.trim(), category: SPEND_CAT[cat] || '', cardId: best && !best.blocked ? best.card.id : undefined, cents: Number.isFinite(amount) && amount > 0 ? amount : 0 };
          sheet.close();
          setTimeout(() => window.dispatchEvent(new CustomEvent('ledger:new-tx', { detail })), 230);
        }
      });
      f.where.addEventListener('input', () => { picked = null; draw(); });
      f.amount.addEventListener('input', draw);
      draw();
    },
  });
}

// ---------------------------------------------------------------- view
export function cardsView(m) {
  if (!m.catalog) return notice({ icon: ICON.clock, text: 'Loading card terms…' });
  if (!m.cards.length) {
    return `<div class="card"><div class="empty" style="padding:18px 6px"><div class="em">💳</div>
        Add your credit cards to see which one earns the most on each purchase, and whether each annual fee is paying for itself.</div>
        <button class="btn primary block" data-action="card-add">${ICON.plus}Add a card</button></div>
      ${considerCard(m)}${footer(m)}`;
  }
  return whichCard(m) + feesCard(m) + creditsCard(m) + yourCards(m) + considerCard(m) + footer(m);
}

function whichCard(m) {
  const cat = ui.cardCat || 'dining';
  const ranked = bestCards(m.cards, cat, { today: m.today, txs: doc.transactions, catalog: m.catalog, prefs: m.cardPrefs });
  return `<div class="card flush">
    <div class="card-h"><h2>Which card should I use?</h2></div>
    <div style="padding:6px 18px 2px">${payBar()}</div>
    <div class="chips" style="margin:0;padding:2px 18px 8px">${REWARD_CATS.map(c => `<button class="chip${c.id === cat ? ' on' : ''}" data-action="card-cat" data-id="${c.id}">${c.emoji} ${esc(c.label)}</button>`).join('')}</div>
    <div class="rows" style="margin:0">${ranked.map((r, i) => `<button class="row" style="align-items:flex-start" data-action="card-detail" data-id="${esc(r.card.id)}">
      <span class="avatar round" style="${i === 0 ? 'background:var(--ink);color:var(--surface)' : 'color:var(--ink-2)'};font-size:15px;font-weight:700">${i + 1}</span>
      <span class="row-main">
        <span class="row-title" style="display:block">${esc(r.card.short)}</span>
        <span class="row-sub" style="display:block;white-space:normal">${esc(rateText(r.card, r.rate))}${r.note ? ` · ${esc(r.note)}` : ''}</span>
        ${r.capLeftCents != null ? `<span class="row-sub" style="display:block">${money(r.capLeftCents, { whole: true, mask: false })} left at this rate</span>` : ''}
        ${r.activate ? `<span class="small" style="display:flex;gap:6px;align-items:flex-start;margin-top:6px;font-weight:600;color:var(--ink)"><span style="color:var(--warn-mark);flex:none;margin-top:1px">${ICON.alert.replace('<svg', '<svg width="14" height="14"')}</span>${esc(r.activate)}</span>` : ''}
        ${r.perks.map(p => `<span class="row-sub good" style="display:block;white-space:normal">+ ${esc(p)}</span>`).join('')}
      </span>
      <span class="row-end"><span class="v" style="display:block">${pct(r.pct, 1)}</span><span class="s" style="display:block">back</span></span>
    </button>`).join('')}</div>
    <p class="note" style="margin:4px 18px 12px">Points counted at ${esc(pointsNote(m))}. “Back” is what each $1 earns you.</p>
  </div>`;
}

function pointsNote(m) {
  const progs = [...new Set(m.cards.map(c => c.program).filter(p => p !== 'cash'))];
  if (!progs.length) return 'face value';
  return progs.map(p => `${(m.cardPrefs[p] ?? m.catalog.programs?.[p]?.cents ?? 1).toFixed(2).replace(/0$/, '')}¢ (${p === 'MR' ? 'Amex' : p === 'UR' ? 'Chase' : p})`).join(', ');
}

function statusPill(s) {
  if (s.status === 'covered') return `<span class="pill good">${ICON.check}Fee covered</span>`;
  if (s.status === 'on-pace') return `<span class="pill good">${ICON.check}On pace</span>`;
  if (s.status === 'behind') return `<span class="pill bad">${ICON.alert}Behind</span>`;
  return `<span class="pill">${ICON.clock}Early days</span>`;
}

function feesCard(m) {
  const list = m.cards.filter(c => c.annualFeeCents > 0);
  if (!list.length) return '';
  return `<div class="card">
    <div class="card-h"><h2>Annual fees</h2><span class="small muted">this card year</span></div>
    ${list.map(c => {
      const s = feeStatus(c, { txs: doc.transactions, today: m.today, catalog: m.catalog, prefs: m.cardPrefs, others: m.cards });
      const freeYear = s.isFirstYear && !s.feeCents;
      return `<button class="block-btn" data-action="card-detail" data-id="${esc(c.id)}" style="display:block;width:100%;text-align:left;padding:10px 0;border-top:1px solid var(--hairline)">
        <div class="between" style="margin-bottom:6px"><span class="row-flex" style="gap:8px"><span class="dot" style="background:${cardDot(m, c)}"></span><strong style="font-weight:620">${esc(c.short)}</strong></span>${freeYear ? `<span class="pill">${ICON.clock}Fee-free year</span>` : statusPill(s)}</div>
        ${meter(s.targetCents ? s.totalCents / s.targetCents : 0, { color: cardDot(m, c) })}
        <div class="meter-legend"><span><strong class="ink2">${money(s.totalCents, { whole: true })}</strong> of ${money(s.targetCents, { whole: true })}${freeYear ? ' (next year’s fee)' : ''}</span><span>${s.projectedCents != null ? `on pace for ${money(s.projectedCents, { whole: true })}` : ''}</span></div>
        <div class="small muted mt8">${freeYear ? `No fee until ${esc(fmtMonth(s.renews.slice(0, 7)))}, then ${money(s.nextFeeCents, { whole: true })}` : `${money(s.feeCents, { whole: true })} fee · renews ${esc(fmtDate(s.renews, { year: true }))}`}${s.guessed ? ' · add the month you opened it for exact dates' : ''}</div>
        <div class="small muted">Rewards ${money(s.rewardsCents, { whole: true })}${s.rewardsEstimated ? ` (from ${s.purchases} logged purchase${s.purchases === 1 ? '' : 's'})` : ' (from your statement)'} + credits used ${money(s.creditsCents, { whole: true })}</div>
      </button>`;
    }).join('')}
    <p class="note" style="margin:8px 0 0">Rewards are estimated from purchases you log with each card. If you don’t log everything, enter the rewards from your statement on the card.</p>
  </div>`;
}

function openCredits(m) {
  const out = [];
  for (const c of m.cards) {
    for (const cr of c.credits || []) {
      if (cr.per === 'every4' || c.owned.ignoreCredits?.includes(cr.id)) continue;
      const left = cr.cents - creditUsedNow(c, cr, m.today);
      if (left > 0) out.push({ card: c, credit: cr, left, ends: periodEnd(cr.per, m.today, c.opened) });
    }
  }
  return out.sort((a, b) => (a.ends || '9').localeCompare(b.ends || '9'));
}

function creditsCard(m) {
  const list = openCredits(m);
  if (!list.length) return '';
  const shown = ui.allCredits ? list : list.slice(0, 5);
  const total = list.reduce((s, x) => s + x.left, 0);
  return `<div class="card flush">
    <div class="card-h"><h2>Credits to use</h2><span class="small muted">${money(total, { whole: true })} available</span></div>
    <div class="rows plain" style="margin:0">${shown.map(x => {
      const days = x.ends ? daysBetween(m.today, x.ends) : null;
      return `<div class="row">
        <span class="dot" style="background:${cardDot(m, x.card)};width:10px;height:10px"></span>
        <span class="row-main"><span class="row-title" style="display:block;white-space:normal">${esc(x.credit.label)} <span class="muted" style="font-weight:400">· ${esc(x.card.short)}</span></span>
          <span class="row-sub" style="display:block;white-space:normal">${money(x.left, { mask: false })} left ${esc(periodLabel(x.credit.per))}${x.ends ? ` · ends ${esc(fmtDate(x.ends))}${days != null && days <= 7 ? ` (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`})` : ''}` : ''}</span></span>
        <button class="btn small" data-action="credit-used" data-card="${esc(x.card.id)}" data-credit="${esc(x.credit.id)}">${ICON.check}Used</button>
      </div>`;
    }).join('')}</div>
    ${list.length > 5 ? `<button class="link" style="margin:4px 18px 12px" data-action="credits-all">${ui.allCredits ? 'Show fewer' : `Show all ${list.length}`}</button>` : '<div style="height:6px"></div>'}
  </div>`;
}

function yourCards(m) {
  return `<div class="card flush">
    <div class="card-h"><h2>Your cards</h2></div>
    <div class="rows plain" style="margin:0">${m.cards.map(c => `<button class="row" data-action="card-detail" data-id="${esc(c.id)}">
      <span class="dot" style="background:${cardDot(m, c)};width:12px;height:12px"></span>
      <span class="row-main"><span class="row-title" style="display:block">${esc(c.short)}</span>
        <span class="row-sub" style="display:block">${esc(c.issuer || 'Custom')} · ${c.annualFeeCents ? `${money(c.annualFeeCents, { whole: true, mask: false })}/yr${c.firstYearFree ? ' ($0 first year)' : ''}` : 'no annual fee'}${c.opened ? ` · opened ${esc(fmtMonth(c.opened, { short: true }))}` : ''}</span></span>
      <span class="chev">${ICON.chevR}</span></button>`).join('')}</div>
    <div style="padding:8px 18px 14px"><button class="btn small" data-action="card-add">${ICON.plus}Add a card</button></div>
  </div>`;
}

function considerCard(m) {
  const have = new Set(doc.cards.map(c => c.catalogId));
  const options = (m.catalog?.cards || []).filter(c => !have.has(c.id) && c.annualFeeCents > 0);
  if (!options.length) return '';
  return `<div class="card flush">
    <div class="card-h"><h2>Thinking about a new card?</h2></div>
    <div class="rows plain" style="margin:0">${options.map(c => `<button class="row" data-action="card-simulate" data-catalog="${esc(c.id)}">
      <span class="avatar">💡</span><span class="row-main"><span class="row-title" style="display:block">Would the ${esc(c.short)} pay for itself?</span>
      <span class="row-sub" style="display:block">${money(c.annualFeeCents, { whole: true, mask: false })} fee · checked against your spending and current cards</span></span><span class="chev">${ICON.chevR}</span></button>`).join('')}</div>
  </div>`;
}

function footer(m) {
  const updated = m.catalog?.updated;
  const age = updated ? daysBetween(updated, m.today) : null;
  return `<p class="note" style="margin:4px 4px 16px">${updated ? `Card terms last checked ${esc(fmtDate(updated, { year: true }))}${age > 100 ? ` — that’s ${age} days ago, worth refreshing` : ''}.` : ''}
    Rates and credits change; each card shows its source. <button class="link" style="font-size:13px" data-action="card-points">Point values</button></p>`;
}

// ---------------------------------------------------------------- sheets
function openCardDetail(m, id) {
  const card = m.cards.find(c => c.id === id);
  const o = owned(id);
  if (!card || !o) return;
  const s = feeStatus(card, { txs: doc.transactions, today: m.today, catalog: m.catalog, prefs: m.cardPrefs, others: m.cards });
  const q = quarterOf(m.today);
  const rot = (card.rotating || []).find(r => r.quarter === q);
  const override = o.rewardsOverride?.[s.start];
  const freeYear = s.isFirstYear && !s.feeCents;
  const isCash = card.program === 'cash';
  openSheet({
    title: card.short, submitLabel: 'Save',
    body: `
      <div class="card">
        <div class="small muted">${esc(card.name)}</div>
        ${card.annualFeeCents ? `
          <div class="between mt8" style="align-items:flex-end"><div><div class="big">${money(s.totalCents, { whole: true })}</div><div class="small ink2">value this card year · ${esc(fmtDate(s.start, { year: true }))} – ${esc(fmtDate(s.end, { year: true }))}</div></div>${freeYear ? `<span class="pill">${ICON.clock}Fee-free year</span>` : statusPill(s)}</div>
          <div class="mt12">${meter(s.targetCents ? s.totalCents / s.targetCents : 0, { color: cardDot(m, card) })}</div>
          <div class="legend">
            <div class="legend-row"><span class="lbl">Rewards<small>${s.rewardsEstimated ? `estimated from ${s.purchases} logged purchase${s.purchases === 1 ? '' : 's'}` : 'from your statement'}</small></span><span class="val">${money(s.rewardsCents)}</span></div>
            <div class="legend-row"><span class="lbl">Credits used</span><span class="val">${money(s.creditsCents)}</span></div>
            <div class="legend-row"><span class="lbl">${freeYear ? 'Next year’s fee' : 'Annual fee'}</span><span class="val">−${money(s.targetCents)}</span></div>
            <div class="legend-row"><span class="lbl"><strong>${s.totalCents >= s.targetCents ? 'Ahead by' : 'Still to go'}</strong>${s.projectedCents != null ? `<small>on pace for ${money(s.projectedCents, { whole: true })} by ${esc(fmtDate(s.renews))}</small>` : ''}</span><span class="val ${s.totalCents >= s.targetCents ? 'good' : ''}">${money(Math.abs(s.totalCents - s.targetCents))}</span></div>
          </div>
          ${s.purchases ? `<p class="note mt8" style="margin-bottom:0">Compared with putting the same purchases on your no-fee cards, this card is ${s.vsNoFeeCents >= 0 ? 'ahead' : 'behind'} by <strong class="ink2">${money(Math.abs(s.vsNoFeeCents))}</strong> this year (rewards + credits).</p>` : ''}
          <label class="field mt12"><span>${isCash ? 'Cash back' : 'Points'} earned since ${esc(fmtDate(s.start))} (optional)</span><input name="override" inputmode="${isCash ? 'decimal' : 'numeric'}" placeholder="${isCash ? `${(s.rewardsCents / 100).toFixed(2)} estimated` : `${s.rewardsUnits.toLocaleString()} estimated`}" value="${Number.isFinite(override) ? (isCash ? (override / 100).toFixed(2) : override) : ''}"><div class="hint">From your ${esc(card.issuer || 'card')} account, if you don’t log every purchase here${isCash ? '' : ` · counted at ${pointCents(card, m.catalog, m.cardPrefs)}¢ a point`}.</div></label>`
          : `<p class="note" style="margin:6px 0 0">No annual fee.</p>`}
      </div>
      ${rot ? `<div class="card"><div style="font-weight:650">${esc(q.replace('-', ' '))} bonus: ${+rot.rate}% on ${esc(rot.label)}</div>
        <div class="small muted mt8">Up to ${money(rot.capCents, { whole: true, mask: false })} this quarter. ${esc(rot.activate || '')}</div>
        <label class="check mt12 mb0"><input type="checkbox" name="activated" ${o.activated?.includes(q) ? 'checked' : ''}> I’ve activated it</label></div>` : ''}
      ${(card.credits || []).length ? `<div class="group-h">Credits — how much you’ve used</div><div class="card">${card.credits.map(cr => {
        const used = creditUsedNow(card, cr, m.today);
        return `<div style="padding:8px 0;border-top:1px solid var(--hairline)">
          <div class="between"><strong style="font-weight:600">${esc(cr.label)}</strong><span class="small ink2">${money(cr.cents, { mask: false })} ${esc(periodLabel(cr.per))}</span></div>
          ${cr.note ? `<div class="small muted">${esc(cr.note)}</div>` : ''}
          <div class="row-flex mt8"><input class="input" name="cr_${esc(cr.id)}" inputmode="decimal" placeholder="0" value="${used ? dollars(used) : ''}" style="height:40px;flex:1">
            <button type="button" class="btn small" data-full="${esc(cr.id)}" data-cents="${cr.cents}">All of it</button></div>
          ${cr.per !== 'every4' ? `<label class="check mb0" style="margin-top:6px;font-size:14px"><input type="checkbox" name="ig_${esc(cr.id)}" ${o.ignoreCredits?.includes(cr.id) ? 'checked' : ''}> I don’t use this — no reminders</label>` : ''}
        </div>`;
      }).join('')}</div>` : ''}
      <div class="group-h">How it earns</div>
      <div class="card">${card.earn.map(r => `<div class="between" style="padding:5px 0"><span>${esc(rewardCatById(r.cat).emoji)} ${esc(rewardCatById(r.cat).label)}</span><strong class="num">${esc(rateText(card, r.rate))}</strong></div>${r.note ? `<div class="small muted" style="margin:-2px 0 4px">${esc(r.note)}</div>` : ''}`).join('')}
        ${(card.perks || []).map(p => `<div class="small ink2 mt8">• ${esc(p)}</div>`).join('')}
        ${card.source ? `<p class="note mt12" style="margin-bottom:0">Checked ${esc(fmtDate(card.verified, { year: true }))} · <a href="${esc(card.source)}" target="_blank" rel="noopener">source</a></p>` : ''}</div>
      <div class="group-h">Details</div>
      <label class="field"><span>Nickname</span><input name="nickname" maxlength="30" placeholder="${esc(card.catalogId ? (m.catalog.cards.find(c => c.id === card.catalogId)?.short || '') : card.short)}" value="${esc(o.nickname || '')}"></label>
      <label class="field"><span>Month you opened it</span><input name="opened" type="month" value="${esc(o.opened || '')}"><div class="hint">Annual fees renew on this month.</div></label>
      ${card.annualFeeCents ? `<label class="check"><input type="checkbox" name="fyf" ${card.firstYearFree ? 'checked' : ''}> No annual fee the first year</label>` : ''}
      <p class="err" id="cd-err"></p>
      <button type="button" class="btn danger block mt16" id="cd-del">${ICON.trash}Remove card</button>`,
    onMount: (root, sheet) => {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-full]');
        if (b) sheet.form.elements['cr_' + b.dataset.full].value = dollars(Number(b.dataset.cents));
      });
      $('#cd-del', root).addEventListener('click', () => {
        if (!confirm(`Remove ${card.short}? Purchases logged with it keep their record.`)) return;
        doc.cards = doc.cards.filter(c => c.id !== id);
        save(); sheet.close(); rerender();
      });
    },
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#cd-err', form).textContent = msg; return false; };
      o.nickname = f.nickname.value.trim() || undefined;
      o.opened = f.opened.value || undefined;
      if (f.fyf) o.firstYearFree = f.fyf.checked;
      if (f.override) {
        o.rewardsOverride = o.rewardsOverride || {};
        const raw = f.override.value.trim();
        if (raw) {
          const v = isCash ? parseCents(raw) : Number(raw.replace(/[,s]/g, ''));
          if (!(v >= 0)) return err(`Check the ${isCash ? 'cash back' : 'points'} amount.`);
          o.rewardsOverride[s.start] = isCash ? v : Math.round(v);
        }
        else delete o.rewardsOverride[s.start];
      }
      if (f.activated) {
        o.activated = (o.activated || []).filter(x => x !== q);
        if (f.activated.checked) o.activated.push(q);
      }
      o.ignoreCredits = (card.credits || []).filter(cr => f['ig_' + cr.id]?.checked).map(cr => cr.id);
      o.creditsUsed = o.creditsUsed || {};
      for (const cr of card.credits || []) {
        const raw = f['cr_' + cr.id].value.trim();
        const key = periodKey(cr.per, m.today, o.opened);
        const c = raw ? parseCents(raw) : 0;
        if (!(c >= 0)) return err(`Check the amount for ${cr.label}.`);
        o.creditsUsed[cr.id] = o.creditsUsed[cr.id] || {};
        if (c > 0) o.creditsUsed[cr.id][key] = Math.min(c, cr.cents); else delete o.creditsUsed[cr.id][key];
      }
      save(); toast('Saved'); rerender();
    },
  });
}

function openAddCard(m) {
  const have = new Set(doc.cards.map(c => c.catalogId));
  const list = (m.catalog?.cards || []).filter(c => !have.has(c.id));
  openSheet({
    title: 'Add a card',
    body: `<div class="card flush"><div class="rows plain" style="margin:0">${list.map(c => `<button type="button" class="row" data-pick="${esc(c.id)}">
        <span class="avatar">💳</span><span class="row-main"><span class="row-title" style="display:block">${esc(c.name)}</span>
        <span class="row-sub" style="display:block">${c.annualFeeCents ? `${money(c.annualFeeCents, { whole: true, mask: false })}/yr${c.firstYearFree ? ' · $0 first year' : ''}` : 'No annual fee'} · ${esc(c.program === 'cash' ? 'cash back' : c.program === 'MR' ? 'Amex points' : 'Chase points')}</span></span>
        <span class="chev">${ICON.chevR}</span></button>`).join('')}
      <button type="button" class="row" data-pick="custom"><span class="avatar">✏️</span><span class="row-main"><span class="row-title" style="display:block">Another card</span><span class="row-sub" style="display:block">Enter its rewards yourself</span></span><span class="chev">${ICON.chevR}</span></button>
      </div></div>
      <p class="note mt12">Don’t see your card? Add it as another card, or ask for it to be added to the card list with its full terms.</p>`,
    onMount: (root, sheet) => root.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      sheet.close();
      setTimeout(() => b.dataset.pick === 'custom' ? openCustomCard(m) : openNewCard(m, b.dataset.pick), 230);
    }),
  });
}

function openNewCard(m, catalogId) {
  const c = m.catalog.cards.find(x => x.id === catalogId);
  openSheet({
    title: c.short, submitLabel: 'Add',
    body: `<p class="note" style="margin:4px 4px 12px">${esc(c.name)}</p>
      <label class="field"><span>Month you opened it</span><input name="opened" type="month" value="${esc(m.today.slice(0, 7))}"><div class="hint">Annual fees and some credits renew on this month.</div></label>
      ${c.annualFeeCents ? `<label class="check"><input type="checkbox" name="fyf" ${c.firstYearFree ? 'checked' : ''}> No annual fee the first year</label>` : ''}
      ${c.rotating?.some(r => r.quarter === quarterOf(m.today)) ? `<label class="check"><input type="checkbox" name="activated"> I’ve activated this quarter’s 5% bonus</label>` : ''}
      <label class="field"><span>Nickname (optional)</span><input name="nickname" maxlength="30" placeholder="${esc(c.short)}"></label>`,
    onSubmit: form => {
      const f = form.elements;
      doc.cards.push({
        id: newId('card'), catalogId, opened: f.opened.value || undefined, nickname: f.nickname.value.trim() || undefined,
        ...(f.fyf ? { firstYearFree: f.fyf.checked } : {}), creditsUsed: {}, activated: f.activated?.checked ? [quarterOf(m.today)] : [],
      });
      save(); toast(`Added ${c.short}`); rerender();
    },
  });
}

function openCustomCard(m) {
  const cats = REWARD_CATS.filter(c => c.id !== 'portal');
  openSheet({
    title: 'Another card', submitLabel: 'Add',
    body: `
      <label class="field"><span>Card name</span><input name="name" maxlength="40" placeholder="e.g. Citi Double Cash"></label>
      <div class="grid2">
        <label class="field"><span>Rewards</span><select name="program"><option value="cash">Cash back (%)</option><option value="PTS">Points per $</option></select></label>
        <label class="field"><span>Annual fee ($)</span><input name="fee" inputmode="decimal" placeholder="0"></label>
      </div>
      <label class="field"><span>Network</span><select name="network">${Object.entries(NETWORKS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="field" id="cc-pv" hidden><span>What a point is worth (¢)</span><input name="pv" inputmode="decimal" value="1"></label>
      <div class="group-h">Earning rates (leave blank to use the base rate)</div>
      <div class="card">${cats.map(c => `<div class="between" style="padding:4px 0"><span>${c.emoji} ${esc(c.label)}</span><input class="input" name="r_${c.id}" inputmode="decimal" placeholder="${c.id === 'other' ? '1' : ''}" style="width:90px;height:40px;text-align:right"></div>`).join('')}</div>
      <label class="field mt12"><span>Month you opened it</span><input name="opened" type="month" value="${esc(m.today.slice(0, 7))}"></label>
      <p class="err" id="cc-err"></p>`,
    onMount: (root, sheet) => sheet.form.elements.program.addEventListener('change', e => { $('#cc-pv', root).hidden = e.target.value === 'cash'; }),
    onSubmit: form => {
      const f = form.elements;
      const err = msg => { $('#cc-err', form).textContent = msg; return false; };
      const name = f.name.value.trim();
      if (!name) return err('Give the card a name.');
      const fee = f.fee.value.trim() ? parseCents(f.fee.value) : 0;
      if (!(fee >= 0)) return err('Check the annual fee.');
      const earn = [];
      for (const c of cats) {
        const raw = f['r_' + c.id].value.trim();
        if (!raw && c.id !== 'other') continue;
        const rate = raw ? Number(raw) : 1;
        if (!(rate >= 0)) return err(`Check the rate for ${c.label}.`);
        earn.push({ cat: c.id, rate });
      }
      const pv = Number(f.pv.value);
      doc.cards.push({
        id: newId('card'), opened: f.opened.value || undefined, creditsUsed: {}, activated: [],
        custom: { name, program: f.program.value, network: f.network.value, annualFeeCents: fee, earn, ...(f.program.value !== 'cash' && pv > 0 ? { pointCents: pv } : {}) },
      });
      save(); toast(`Added ${name}`); rerender();
    },
  });
}

/** Spending per reward category over the last 12 months of logged purchases, scaled to a year. */
function yearlySpend(m) {
  const since = addMonths(m.today, -12);
  const txs = doc.transactions.filter(t => t.cents > 0 && t.date > since && t.date <= m.today);
  const first = txs.map(t => t.date).sort()[0];
  const months = first ? Math.min(12, Math.max(1, monthsBetween(first, m.today) + 1)) : 12;
  const spend = {};
  for (const t of txs) { const c = rewardCatFor(t); spend[c] = (spend[c] || 0) + t.cents; }
  for (const k of Object.keys(spend)) spend[k] = Math.round(spend[k] * 12 / months / 100) * 100;
  return { spend, months };
}

function openSimulate(m, catalogId) {
  const card = resolveCard({ id: 'sim', catalogId }, m.catalog);
  const { spend, months } = yearlySpend(m);
  const cats = REWARD_CATS;
  const credits = card.credits || [];
  openSheet({
    title: `Would the ${card.short} pay off?`,
    body: `
      <div class="card" id="sim-out"></div>
      <div class="group-h">Your spending per year</div>
      <p class="note" style="margin:-4px 4px 10px">From the ${months} month${months === 1 ? '' : 's'} of purchases you’ve logged, scaled to a year. Add anything you put on cards but don’t log here — family groceries, work trips, rent.</p>
      <div class="card">${cats.map(c => `<div class="between" style="padding:4px 0"><span>${c.emoji} ${esc(c.label)}</span><input class="input" name="s_${c.id}" inputmode="decimal" value="${spend[c.id] ? Math.round(spend[c.id] / 100) : ''}" placeholder="0" style="width:110px;height:40px;text-align:right"></div>`).join('')}</div>
      ${credits.length ? `<div class="group-h">Credits you’d actually use</div><div class="card">${credits.map(cr => `<label class="check" style="margin:6px 0;align-items:flex-start"><input type="checkbox" name="c_${esc(cr.id)}" ${cr.id === 'travel' ? 'checked' : ''}>
          <span style="flex:1"><span class="between"><span>${esc(cr.label)}</span><strong class="num">${money(Math.round(cr.cents * perYear(cr.per)), { whole: true, mask: false })}/yr</strong></span><span class="small muted" style="display:block">${esc(cr.note || '')}</span></span></label>`).join('')}</div>` : ''}
      <label class="field mt12"><span>Welcome bonus (points, first year only)</span><input name="bonus" inputmode="numeric" placeholder="e.g. 100000"></label>
      ${(card.perks || []).length ? `<p class="note">Also: ${esc(card.perks.join(' · '))}. Not counted above.</p>` : ''}
      <p class="note">Rates checked ${esc(fmtDate(card.verified, { year: true }))} · <a href="${esc(card.source)}" target="_blank" rel="noopener">source</a></p>
      <button type="button" class="btn block mt12" id="sim-add">${ICON.plus}I got it — add to my cards</button>`,
    onMount: (root, sheet) => {
      const calc = () => {
        const f = sheet.form.elements;
        const s = {};
        for (const c of cats) { const v = parseCents(f['s_' + c.id].value || '0'); if (v > 0) s[c.id] = v; }
        const creditCents = credits.filter(cr => f['c_' + cr.id]?.checked).reduce((a, cr) => a + Math.round(cr.cents * perYear(cr.per)), 0);
        const r = simulateCard(card, m.cards, s, { creditCents, catalog: m.catalog, prefs: m.cardPrefs, today: m.today });
        const bonus = Math.round((Number(f.bonus.value) || 0) * pointCents(card, m.catalog, m.cardPrefs));
        const top = r.rows.filter(x => x.extra > 0).sort((a, b) => b.extra - a.extra).slice(0, 3);
        $('#sim-out', root).innerHTML = `
          <div class="eyebrow">Every year, on this spending</div>
          <div class="big ${r.netCents >= 0 ? 'good' : 'bad'}" style="margin:4px 0 2px">${money(r.netCents, { whole: true, sign: true, mask: false })}</div>
          <div class="small ink2">${r.netCents >= 0 ? 'it pays for itself' : 'more than it gives back'}${bonus ? ` · first year ${money(r.netCents + bonus, { whole: true, sign: true, mask: false })} with the bonus` : ''}</div>
          <div class="legend">
            <div class="legend-row"><span class="lbl">Extra rewards<small>vs. using your best current card for each purchase</small></span><span class="val">${money(r.extraRewardsCents, { whole: true, mask: false })}</span></div>
            <div class="legend-row"><span class="lbl">Credits you’d use</span><span class="val">${money(r.creditCents, { whole: true, mask: false })}</span></div>
            <div class="legend-row"><span class="lbl">Annual fee</span><span class="val">−${money(r.feeCents, { whole: true, mask: false })}</span></div>
          </div>
          ${top.length ? `<p class="note mt8" style="margin-bottom:0">Extra rewards mostly from ${esc(top.map(x => `${rewardCatById(x.cat).label.toLowerCase()} (+${money(x.extra, { whole: true, mask: false })})`).join(', '))}.</p>` : '<p class="note mt8" style="margin-bottom:0">On this spending your current cards already earn as much or more in every category.</p>'}
          ${r.netCents < 0 ? `<p class="note mt8" style="margin-bottom:0">To break even you’d need ${money(-r.netCents, { whole: true, mask: false })} more a year in credits or extra rewards.</p>` : ''}`;
      };
      root.addEventListener('input', calc);
      root.addEventListener('change', calc);
      calc();
      $('#sim-add', root).addEventListener('click', () => { sheet.close(); setTimeout(() => openNewCard(m, catalogId), 230); });
    },
  });
}

function openPointValues(m) {
  const progs = Object.entries(m.catalog?.programs || {}).filter(([k]) => k !== 'cash');
  openSheet({
    title: 'Point values', submitLabel: 'Save',
    body: `<p class="note" style="margin:4px 4px 12px">What one point is worth to you, in cents. This decides how points compare with cash back.</p>
      ${progs.map(([k, p]) => `<label class="field"><span>${esc(p.label)}</span><input name="p_${k}" inputmode="decimal" value="${m.cardPrefs[k] ?? p.cents}"><div class="hint">${esc(p.note)}</div></label>`).join('')}`,
    onSubmit: form => {
      doc.cardPrefs = doc.cardPrefs || {};
      for (const [k, p] of progs) {
        const v = Number(form.elements['p_' + k].value);
        if (v > 0 && v !== p.cents) doc.cardPrefs[k] = v; else delete doc.cardPrefs[k];
      }
      save(); rerender();
    },
  });
}

// ---------------------------------------------------------------- reminders for Home
export function cardAlerts(m) {
  const out = [];
  if (!m.cards.length) return out;
  const day = Number(m.today.slice(8, 10));
  const q = quarterOf(m.today);
  for (const c of m.cards) {
    const rot = (c.rotating || []).find(r => r.quarter === q);
    if (rot && !c.owned.activated?.includes(q)) {
      out.push({ icon: ICON.alert, text: `<strong>Activate ${esc(c.short)}’s 5% bonus</strong> on ${esc(rot.label)}. ${esc(rot.activate || '')}`, action: `<button class="btn small" data-action="card-activated" data-card="${esc(c.id)}" data-q="${q}">${ICON.check}Done</button>` });
    }
  }
  const expiring = openCredits(m).filter(x => x.ends && (x.credit.per === 'month' ? day >= 20 : daysBetween(m.today, x.ends) <= 30));
  if (expiring.length) {
    out.push({ icon: ICON.coins, text: `<strong>Card credits ending soon:</strong> ${esc(expiring.slice(0, 4).map(x => `${x.card.short} ${x.credit.label} (${money(x.left, { mask: false })}, ${fmtDate(x.ends)})`).join(', '))}${expiring.length > 4 ? ` and ${expiring.length - 4} more` : ''}.`, action: '<button class="btn small" data-action="open-cards">See credits</button>' });
  }
  const updated = m.catalog?.updated;
  if (updated && daysBetween(updated, m.today) > 100) out.push({ icon: ICON.clock, text: `Card terms were last checked ${esc(fmtDate(updated, { year: true }))}. Rates and credits may have changed.` });
  return out;
}

export const cardActions = {
  'which-card': (el, m) => openWhichCard(m),
  'card-cat': el => { ui.cardCat = el.dataset.id; saveUi(); return 'render'; },
  'card-detail': (el, m) => openCardDetail(m, el.dataset.id),
  'card-add': (el, m) => openAddCard(m),
  'card-simulate': (el, m) => openSimulate(m, el.dataset.catalog),
  'card-points': (el, m) => openPointValues(m),
  'credits-all': () => { ui.allCredits = !ui.allCredits; saveUi(); return 'render'; },
  'credit-used': (el, m) => {
    const card = m.cards.find(c => c.id === el.dataset.card);
    const cr = card?.credits.find(x => x.id === el.dataset.credit);
    const o = owned(el.dataset.card);
    if (!cr || !o) return;
    o.creditsUsed = o.creditsUsed || {};
    (o.creditsUsed[cr.id] ||= {})[periodKey(cr.per, m.today, o.opened)] = cr.cents;
    save();
    toast(`${cr.label} marked as used`);
    return 'render';
  },
  'card-activated': el => {
    const o = owned(el.dataset.card);
    if (!o) return;
    o.activated = [...new Set([...(o.activated || []), el.dataset.q])];
    save();
    return 'render';
  },
  'open-cards': () => { ui.tab = 'spending'; ui.spendView = 'cards'; saveUi(); return 'render'; },
};
