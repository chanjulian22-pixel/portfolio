// Shared UI helpers: escaping, formatting, icons, sheets, toasts.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- formatting ----------
export const view = { hidden: false };
const MASK = '••••';
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const shFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

/** Integer cents -> "$1,234.56". `whole` drops cents, `sign` adds +/−. */
export function money(cents, { whole = false, sign = false, mask = true } = {}) {
  if (cents == null || Number.isNaN(cents)) return '—';
  if (mask && view.hidden) return '$' + MASK;
  const v = Math.abs(cents) / 100;
  const body = (whole ? usd0 : usd).format(v);
  if (sign) return (cents > 0 ? '+' : cents < 0 ? '−' : '') + body;
  return cents < 0 ? '−' + body : body;
}
export function compact(cents, { mask = true } = {}) {
  if (mask && view.hidden) return '$' + MASK;
  const v = cents / 100;
  if (Math.abs(v) < 1000) return usd0.format(v);
  return compactFmt.format(v);
}
export const shares = n => view.hidden ? MASK : shFmt.format(n);
export function pct(x, digits = 1, { sign = false } = {}) {
  if (x == null || !Number.isFinite(x)) return '—';
  const s = (Math.abs(x) * 100).toFixed(digits) + '%';
  if (!sign) return (x < 0 ? '−' : '') + s;
  return (x > 0 ? '+' : x < 0 ? '−' : '') + s;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d: d || 1 }; };
export function fmtDate(iso, { year = 'auto', weekday = false } = {}) {
  if (!iso) return '';
  const { y, m, d } = p(iso);
  const showYear = year === true || (year === 'auto' && y !== new Date().getFullYear());
  const wd = weekday ? DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ', ' : '';
  return `${wd}${MONTHS[m - 1]} ${d}${showYear ? `, ${y}` : ''}`;
}
export const fmtMonth = (key, { short = false, year = true } = {}) => {
  const { y, m } = p(key.length === 7 ? key + '-01' : key);
  return `${short ? MONTHS[m - 1] : MONTHS_LONG[m - 1]}${year ? ` ${short ? "'" + String(y).slice(2) : y}` : ''}`;
};
export function relDays(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export function timeAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} d ago`;
}

// ---------- icons (24px line set) ----------
const svg = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  home: svg('<path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.5 9v10.2c0 .5.4.8.8.8H10v-5.5h4V20h3.7c.5 0 .8-.3.8-.8V9"/>'),
  spending: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>'),
  plan: svg('<path d="M12 3v6"/><path d="M12 9c0 3-6 3-6 7v4"/><path d="M12 9c0 3 6 3 6 7v4"/><path d="M12 9v11"/>'),
  invest: svg('<path d="M3.5 17.5 9 12l3.5 3.5L20.5 7.5"/><path d="M15 7.5h5.5V13"/>'),
  goals: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>'),
  gear: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  refresh: svg('<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 3.5v5h-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
  chevR: svg('<path d="M9 6l6 6-6 6"/>', 2),
  chevL: svg('<path d="M15 6l-6 6 6 6"/>', 2),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>', 2.6),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>', 2),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 2.2),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>', 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  alert: svg('<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.3v.2"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  bank: svg('<path d="M3 9.5 12 4l9 5.5M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20.5h18"/>'),
  coins: svg('<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 15.4c.9 1.2 3.2 2.1 6 2.1 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.8-2.2-4.3-2.4"/>'),
  shield: svg('<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.4 7.5 9.5 4.3-1.1 7.5-5 7.5-9.5V6z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
};

// ---------- toast ----------
let toastTimer;
export function toast(msg, isErr = false) {
  let t = document.getElementById('toast');
  if (!t) {
    t = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
  }
  // Inside an open sheet the toast must live in the dialog (top layer) to be visible.
  const host = [...document.querySelectorAll('dialog[open]:not(.closing)')].pop() || document.body;
  if (t.parentElement !== host) host.appendChild(t);
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- sheets ----------
/**
 * Full-height sheet with Cancel · Title · Save.
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.body HTML
 * @param {string} [o.submitLabel] omit for a read-only sheet (shows "Done")
 * @param {(form: HTMLFormElement, sheet) => (boolean|void|Promise)} [o.onSubmit] return false to keep open
 * @param {(root: HTMLElement, sheet) => void} [o.onMount]
 * @param {() => void} [o.onClose]
 * @param {(model) => string} [o.live] rebuild the body whenever the app re-renders (for list screens)
 */
export function openSheet({ title, body, submitLabel, onSubmit, onMount, onClose, live }) {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.innerHTML = `
    <form class="sheet-panel" novalidate>
      <div class="sheet-bar">
        <div class="left">${submitLabel ? '<button type="button" class="text-btn" data-sheet-close>Cancel</button>' : ''}</div>
        <h2>${esc(title)}</h2>
        <div class="right">${submitLabel
          ? `<button type="submit" class="text-btn strong">${esc(submitLabel)}</button>`
          : '<button type="button" class="text-btn strong" data-sheet-close>Done</button>'}</div>
      </div>
      <div class="sheet-body">${body}</div>
    </form>`;
  document.body.appendChild(d);
  const form = d.querySelector('form');
  const onRendered = e => { if (live && d.isConnected) sheet.setBody(live(e.detail.model)); };
  const sheet = {
    el: d, form,
    close() {
      if (!d.isConnected || d.classList.contains('closing')) return;
      d.classList.add('closing');
      window.removeEventListener('ledger:rendered', onRendered);
      const t = d.querySelector('#toast');
      if (t) document.body.appendChild(t);
      setTimeout(() => { d.close(); d.remove(); onClose?.(); }, 200);
    },
    setBody(html) {
      const b = d.querySelector('.sheet-body');
      const top = b.scrollTop;
      b.innerHTML = html;
      b.scrollTop = top;
    },
  };
  if (live) window.addEventListener('ledger:rendered', onRendered);
  d.addEventListener('cancel', e => { e.preventDefault(); sheet.close(); });
  d.addEventListener('click', e => {
    if (e.target.closest('[data-sheet-close]')) sheet.close();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!onSubmit) return sheet.close();
    const ok = await onSubmit(form, sheet);
    if (ok !== false) sheet.close();
  });
  d.showModal();
  onMount?.(d.querySelector('.sheet-body'), sheet);
  return sheet;
}

/** Promise-based confirm that fits the app (native confirm() is fine on iOS, and blocks less code). */
export const confirmAction = msg => window.confirm(msg);
