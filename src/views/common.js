// Pieces shared by several screens.
import { esc, money, fmtDate, ICON } from '../ui.js';
import { categoryById } from '../domain/spending.js';
import { seriesColor } from '../charts.js';

export const bucketColor = b => seriesColor(b?.color || 1);

export function txRow(t, m) {
  const cat = categoryById(t.category);
  const credit = t.cents < 0;
  const from = t.fundedBy ? m.bucketById[t.fundedBy]?.label : null;
  const sub = t.work
    ? `Work · ${t.reimbursedOn ? `reimbursed ${esc(fmtDate(t.reimbursedOn))}` : 'waiting to be reimbursed'}`
    : `${esc(cat.label)}${from ? ` · from ${esc(from)}` : ''}`;
  return `<button class="row" data-action="edit-tx" data-id="${esc(t.id)}">
    <span class="avatar">${t.work ? '💼' : cat.emoji}</span>
    <span class="row-main">
      <span class="row-title" style="display:block">${esc(t.item)}</span>
      <span class="row-sub" style="display:block">${sub}</span>
    </span>
    <span class="row-end"><span class="v${credit ? ' good' : t.work ? ' muted' : ''}" style="display:block">${credit ? '+' + money(-t.cents) : money(t.cents)}</span></span>
  </button>`;
}

/** Newest first; undated items sort to the end of their month. */
export function sortTx(list) {
  return [...list].sort((a, b) => {
    const ka = a.undated ? a.date.slice(0, 7) + '-00' : a.date;
    const kb = b.undated ? b.date.slice(0, 7) + '-00' : b.date;
    return kb.localeCompare(ka) || (b.createdAt || 0) - (a.createdAt || 0);
  });
}

export function statusPill(kind, text) {
  const icon = kind === 'good' ? ICON.check : kind === 'bad' ? ICON.alert : kind === 'warn' ? ICON.alert : ICON.clock;
  return `<span class="pill ${kind}">${icon}${esc(text)}</span>`;
}

export function notice({ icon = ICON.info, text, actions = '', tone = '' }) {
  return `<div class="notice"><span class="ico ${tone}">${icon}</span><div style="flex:1;min-width:0"><p>${text}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</div></div>`;
}

export const dateLabel = (iso, today) => {
  if (iso === today) return 'Today';
  return fmtDate(iso, { weekday: true });
};

export function deltaHtml(cents, base, label) {
  if (cents == null) return '';
  const up = cents >= 0;
  const frac = base ? cents / Math.abs(base) : null;
  return `<span class="delta ${up ? 'good' : 'bad'}">${up ? ICON.up : ICON.down}${money(Math.abs(cents), { whole: true })}${frac != null ? ` (${(Math.abs(frac) * 100).toFixed(1)}%)` : ''}</span><span>${esc(label)}</span>`;
}
