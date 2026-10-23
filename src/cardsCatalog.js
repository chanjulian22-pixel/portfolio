// Card terms live in src/data/cards.json in the repo. The app fetches it every launch, so updating
// that one file updates rates on your phone without touching your data. The last good copy is kept
// for offline use.
const KEY = 'ledger.cardsCatalog';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

export const catalogState = { data: read(), error: null };

export async function loadCatalog() {
  try {
    const r = await fetch('src/data/cards.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j?.cards)) throw new Error('Unexpected file');
    catalogState.data = j;
    catalogState.error = null;
    try { localStorage.setItem(KEY, JSON.stringify(j)); } catch { /* storage full */ }
    return true;
  } catch (e) {
    catalogState.error = e.message;
    return false;
  }
}
