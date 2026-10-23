import { doc, ui, saveUi, save } from './store.js';
import { model, invalidate } from './model.js';
import { prices, refreshQuotes } from './prices.js';
import { mountCharts, clearCharts } from './charts.js';
import { $, ICON, toast, view, todayISO } from './ui.js';
import { homeView, homeActions } from './views/home.js';
import { spendingView, spendingActions, openTxSheet } from './views/spending.js';
import { planView, planActions } from './views/plan.js';
import { investView, investActions, investmentTotals } from './views/invest.js';
import { goalsView, goalsActions } from './views/goals.js';
import { settingsActions, importFile } from './views/settings.js';
import { cardActions, openWhichCard } from './views/cards.js';
import { loadCatalog } from './cardsCatalog.js';

const TABS = [
  { id: 'home', label: 'Home', icon: ICON.home, view: homeView },
  { id: 'spending', label: 'Spending', icon: ICON.spending, view: spendingView },
  { id: 'plan', label: 'Plan', icon: ICON.plan, view: planView },
  { id: 'invest', label: 'Invest', icon: ICON.invest, view: investView },
  { id: 'goals', label: 'Goals', icon: ICON.goals, view: goalsView },
];
const ACTIONS = { ...homeActions, ...spendingActions, ...planActions, ...investActions, ...goalsActions, ...settingsActions, ...cardActions };

function applyTheme() {
  const t = ui.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = dark ? '#0b0b0a' : '#f3f3f0';
}

let lastTab = null;
function render(opts = {}) {
  view.hidden = !!ui.hidden;
  invalidate();
  const m = model();
  const tab = TABS.find(t => t.id === ui.tab) || TABS[0];
  clearCharts();
  const out = tab.view(m);
  $('#title').textContent = out.title;
  const main = $('#main');
  main.innerHTML = out.html;
  if (lastTab !== tab.id) {
    main.classList.remove('enter');
    void main.offsetWidth;
    main.classList.add('enter');
    window.scrollTo(0, 0);
  }
  lastTab = tab.id;
  $('#tabbar').innerHTML = TABS.map(t => `<button class="tab${t.id === tab.id ? ' on' : ''}" data-tab="${t.id}" aria-current="${t.id === tab.id ? 'page' : 'false'}">${t.icon}<span>${t.label}</span></button>`).join('');
  $('#fab').hidden = !out.fab;
  $('#btn-hide').innerHTML = ui.hidden ? ICON.eyeOff : ICON.eye;
  $('#btn-hide').setAttribute('aria-label', ui.hidden ? 'Show amounts' : 'Hide amounts');
  $('#btn-refresh').hidden = !prices.key || !m.liveTickers.length;
  mountCharts(main);
  out.after?.();
  if (opts.keepFocus) {
    const el = document.getElementById(opts.keepFocus);
    if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }
  }
  recordHistory(m);
  window.dispatchEvent(new CustomEvent('ledger:rendered', { detail: { model: m } }));
}

/** One net-worth point per day the app is opened — this becomes your history chart. */
function recordHistory(m) {
  if (!m.hasData) return;
  const entry = { date: m.today, total: m.nw.total, assets: m.nw.assets, byBucket: Object.fromEntries(Object.entries(m.balances).map(([k, v]) => [k, v.cents])) };
  const inv = investmentTotals(m.today); // put in vs returns, for the Invest history chart
  if (inv) Object.assign(entry, inv);
  const same = doc.history.filter(h => h.date === m.today);
  if (same.length === 1 && same[0].total === entry.total && same[0].invIn === entry.invIn && same[0].invRet === entry.invRet) return;
  doc.history = doc.history.filter(h => h.date !== m.today).concat(entry).sort((a, b) => a.date.localeCompare(b.date));
  save();
}

async function refreshPrices({ manual = false, tickers = null, quiet = false } = {}) {
  const m = model();
  const list = tickers || m.liveTickers;
  if (!prices.key) { if (manual) toast('Add your Finnhub key in Settings first.'); return; }
  if (!list.length) { if (manual) toast('Add holdings in Invest to see live prices.'); return; }
  $('#btn-refresh').classList.add('spin');
  const r = await refreshQuotes(list);
  $('#btn-refresh').classList.remove('spin');
  const typing = document.activeElement?.closest?.('#main') && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (!typing) render();
  if (r.error === 'auth') toast('Finnhub rejected your API key.', true);
  else if (quiet) return;
  else if (r.error === 'rate') toast('Finnhub rate limit — try again in a minute.', true);
  else if (r.error === 'network') toast('Couldn’t reach Finnhub. Showing last prices.', true);
  else if (r.missing.length && (manual || tickers)) toast(`No live quote for ${r.missing.join(', ')} — set a manual price.`);
  else if (manual) toast('Prices updated');
}

// ---------------------------------------------------------------- events
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn && !tabBtn.closest('dialog')) {
    ui.tab = tabBtn.dataset.tab;
    saveUi();
    render();
    return;
  }
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const fn = ACTIONS[a.dataset.action];
  if (!fn) return;
  e.preventDefault();
  const res = fn(a, model());
  if (res === 'render') render();
});

$('#fab').addEventListener('click', () => openTxSheet(model()));
$('#btn-card').addEventListener('click', () => openWhichCard(model()));
window.addEventListener('ledger:new-tx', e => openTxSheet(model(), null, e.detail || {}));
$('#btn-hide').addEventListener('click', () => { ui.hidden = !ui.hidden; saveUi(); render(); });
$('#btn-refresh').addEventListener('click', () => refreshPrices({ manual: true }));
$('#btn-settings').addEventListener('click', () => ACTIONS.settings(null, model()));
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) await importFile(f);
});

window.addEventListener('ledger:render', e => {
  render(e.detail || {});
  const rp = e.detail?.refreshPrices;
  if (rp && rp.length) refreshPrices({ tickers: rp === 'all' ? null : rp });
});
window.addEventListener('ledger:theme', applyTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => mountCharts($('#main')), 120); });
window.addEventListener('scroll', () => { $('.top').classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });

let lastAuto = 0;
setInterval(() => {
  if (document.visibilityState !== 'visible' || !prices.key || prices.keyRejected) return;
  const n = model().liveTickers.length;
  if (n && Date.now() - lastAuto >= Math.max(60000, n * 1100)) { lastAuto = Date.now(); refreshPrices({ quiet: true }); }
}, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  render();
  if (prices.key && !prices.keyRejected && Date.now() - lastAuto > 30000) { lastAuto = Date.now(); refreshPrices({ quiet: true }); }
});

// ---------------------------------------------------------------- start
// Transfers marked as sent before their payday used to be dated on the payday. Date them when
// they were actually marked, so balances and the projection see that money now.
(function redateEarlyTransfers() {
  const today = todayISO();
  let changed = false;
  for (const c of doc.contributions) {
    if (!c.paycheck || c.date <= today || !c.at) continue;
    const d = new Date(c.at);
    const marked = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (marked < c.date) { c.date = marked; changed = true; }
  }
  if (changed) save();
})();
applyTheme();
render();
loadCatalog().then(ok => { if (ok) render(); }); // card terms (src/data/cards.json), refreshed every launch
if (doc.migratedFromV1) {
  delete doc.migratedFromV1;
  save();
  toast('Brought over your holdings from the previous version');
}
if (prices.key) { lastAuto = Date.now(); refreshPrices({ quiet: true }); }
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
