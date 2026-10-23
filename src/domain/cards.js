// Credit cards: which card earns the most on a purchase, what each card has earned, statement
// credits, and whether an annual fee is paying for itself. Pure functions; card terms come from
// src/data/cards.json (the catalog) merged with the cards you own.
import { addMonths, addDays, iso, daysBetween } from './dates.js';
import { categorize } from './spending.js';

/** What the card networks reward — coarser than spending categories, finer where cards differ. */
export const REWARD_CATS = [
  { id: 'dining', label: 'Dining & bars', emoji: '🍽️' },
  { id: 'groceries', label: 'Groceries', emoji: '🛒' },
  { id: 'gas', label: 'Gas', emoji: '⛽' },
  { id: 'rideshare', label: 'Uber & Lyft', emoji: '🚕' },
  { id: 'transit', label: 'Trains, buses, tolls, parking', emoji: '🚆' },
  { id: 'flights', label: 'Flights (direct)', emoji: '✈️' },
  { id: 'hotels', label: 'Hotels (direct)', emoji: '🏨' },
  { id: 'portal', label: 'Travel via the card’s portal', emoji: '🧳' },
  { id: 'streaming', label: 'Streaming', emoji: '📺' },
  { id: 'drugstore', label: 'Drugstores', emoji: '💊' },
  { id: 'other', label: 'Everything else', emoji: '💳' },
];
export const rewardCatById = id => REWARD_CATS.find(c => c.id === id) || REWARD_CATS[REWARD_CATS.length - 1];

export const NETWORKS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover' };

const SUPERSTORE = 'Card issuers count superstores and warehouse clubs as general purchases, not groceries.';
const list = (cat, rows) => rows.map(([name, re]) => ({ name, re, cat }));
/**
 * Stores and brands, matched against normalized text (lowercase, no apostrophes). The first match
 * wins, so stores that aren't what they look like come first. `only`: the card networks accepted.
 */
export const MERCHANTS = [
  { id: 'costco', name: 'Costco', re: /\bcostco\b/, cat: 'other', only: ['visa'], note: `Costco warehouses take only Visa cards. ${SUPERSTORE}` },
  { id: 'walmart', name: 'Walmart', re: /\bwalmart\b/, cat: 'other', note: SUPERSTORE },
  { id: 'target', name: 'Target', re: /\btarget\b/, cat: 'other', note: SUPERSTORE },
  { id: 'bjs', name: 'BJ’s', re: /\bbjs\b/, cat: 'other', note: SUPERSTORE },
  { id: 'samsclub', name: 'Sam’s Club', re: /\bsams club\b/, cat: 'other', note: SUPERSTORE },
  { id: 'wholefoods', name: 'Whole Foods', re: /\bwhole foods\b|\bamazon fresh\b/, cat: 'groceries' },
  { id: 'amazon', name: 'Amazon', re: /\bamazon\b/, cat: 'other' },
  { id: 'airbnb', name: 'Airbnb', re: /\bairbnb\b/, cat: 'other', note: 'Most cards don’t count Airbnb as a hotel.' },
  // delivery apps count as restaurants
  { id: 'ubereats', name: 'Uber Eats', re: /\buber ?eats\b/, cat: 'dining' },
  { id: 'doordash', name: 'DoorDash', re: /\bdoor ?dash\b/, cat: 'dining' },
  { id: 'grubhub', name: 'Grubhub / Seamless', re: /\bgrub ?hub\b|\bseamless\b/, cat: 'dining' },
  { id: 'uber', name: 'Uber', re: /\buber\b/, cat: 'rideshare' },
  { id: 'lyft', name: 'Lyft', re: /\blyft\b/, cat: 'rideshare' },
  { id: 'dunkin', name: 'Dunkin’', re: /\bdunkin\b/, cat: 'dining' },
  { id: 'fiveguys', name: 'Five Guys', re: /\bfive guys\b/, cat: 'dining' },
  { id: 'cheesecake', name: 'The Cheesecake Factory', re: /\bcheesecake factory\b/, cat: 'dining' },
  { id: 'bww', name: 'Buffalo Wild Wings', re: /\bbuffalo wild wings\b|\bbww\b/, cat: 'dining' },
  { id: 'wonder', name: 'Wonder', re: /^wonder\b/, cat: 'dining' },
  ...list('dining', [['Starbucks', /\bstarbucks\b/], ['Chipotle', /\bchipotle\b/], ['Sweetgreen', /\bsweetgreen\b/], ['Cava', /\bcava\b/],
    ['Shake Shack', /\bshake shack\b/], ['McDonald’s', /\bmcdonalds\b/], ['Chick-fil-A', /\bchick ?fil ?a\b/], ['Panera', /\bpanera\b/],
    ['Popeyes', /\bpopeyes\b/], ['Wendy’s', /\bwendys\b/], ['Jersey Mike’s', /\bjersey mikes\b/], ['Joe & The Juice', /\bjoe (and )?the juice\b/], ['Pret', /\bpret\b/]]),
  ...list('groceries', [['Trader Joe’s', /\btrader joes?\b/], ['Wegmans', /\bwegmans\b/], ['ShopRite', /\bshop ?rite\b/], ['Stop & Shop', /\bstop (and )?shop\b/],
    ['Key Food', /\bkey food\b/], ['C-Town', /\bc ?town\b/], ['Food Bazaar', /\bfood bazaar\b/], ['Fairway', /\bfairway\b/], ['Morton Williams', /\bmorton williams\b/],
    ['Gristedes', /\bgristedes\b/], ['H Mart', /\bh ?mart\b/], ['Aldi', /\baldi\b/], ['Lidl', /\blidl\b/], ['Kroger', /\bkroger\b/], ['Safeway', /\bsafeway\b/],
    ['Publix', /\bpublix\b/], ['Foodtown', /\bfood ?town\b/], ['Acme', /\bacme\b/], ['FreshDirect', /\bfresh ?direct\b/], ['Food Emporium', /\bfood emporium\b/]]),
  ...list('gas', [['Shell', /\bshell\b/], ['Exxon', /\bexxon\b/], ['Mobil', /\bmobil\b/], ['BP', /\bbp\b/], ['Chevron', /\bchevron\b/], ['Sunoco', /\bsunoco\b/],
    ['Citgo', /\bcitgo\b/], ['Speedway', /\bspeedway\b/], ['Gulf', /\bgulf\b/], ['Valero', /\bvalero\b/]]),
  ...list('transit', [['NJ Transit', /\bnj ?transit\b/], ['MTA / OMNY', /\bmta\b|\bomny\b|\bmetro ?card\b/], ['PATH', /\bpath\b/], ['LIRR', /\blirr\b/],
    ['Metro-North', /\bmetro ?north\b/], ['Amtrak', /\bamtrak\b/], ['E-ZPass', /\be ?z ?pass\b/], ['Citi Bike', /\bciti ?bike\b/], ['SpotHero', /\bspot ?hero\b/]]),
  ...list('flights', [['Delta', /\bdelta\b/], ['United Airlines', /\bunited air/], ['JetBlue', /\bjet ?blue\b/], ['American Airlines', /\bamerican air/],
    ['Southwest', /\bsouthwest\b/], ['Alaska Airlines', /\balaska air/], ['Spirit Airlines', /\bspirit air/], ['Frontier Airlines', /\bfrontier air/]]),
  ...list('hotels', [['Marriott', /\bmarriott\b/], ['Hilton', /\bhilton\b/], ['Hyatt', /\bhyatt\b/], ['IHG / Holiday Inn', /\bihg\b|\bholiday inn\b/],
    ['Wyndham', /\bwyndham\b/], ['Best Western', /\bbest western\b/]]),
  { id: 'disney', name: 'Disney+ / Hulu / ESPN+', re: /\bdisney\b|\bhulu\b|\bespn\b/, cat: 'streaming' },
  ...list('streaming', [['Netflix', /\bnetflix\b/], ['Spotify', /\bspotify\b/], ['HBO Max', /\bhbo\b/], ['YouTube TV / Premium', /\byoutube\b/],
    ['Peacock', /\bpeacock\b/], ['Paramount+', /\bparamount\b/], ['Apple TV / Music', /\bapple (tv|music)\b/], ['SiriusXM', /\bsirius/]]),
  ...list('drugstore', [['CVS', /\bcvs\b/], ['Walgreens', /\bwalgreens\b/], ['Rite Aid', /\brite aid\b/], ['Duane Reade', /\bduane reade\b/]]),
  { id: 'stubhub', name: 'StubHub', re: /\bstub ?hub\b|\bviagogo\b/, cat: 'other' },
];
for (const x of MERCHANTS) x.id ||= x.name.toLowerCase().replace(/[^a-z0-9]+/g, '');

const norm = text => String(text || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9+]+/g, ' ').trim();

/** The store or brand in some text ("Trader Joe's", "uber eats order"), or null. */
export function merchantFor(text) {
  const s = norm(text);
  return s ? MERCHANTS.find(x => x.re.test(s)) || null : null;
}

// Plain words, for when no store matches ("dinner", "gas", "parking").
const KEYWORDS = [
  ['dining', /\b(restaurants?|dinner|lunch|breakfast|brunch|coffee|cafe|bars?|drinks?|beers?|pizza|sushi|takeout|food|bagels?|deli|tacos?|burgers?|bakery)\b/],
  ['groceries', /\b(grocery|groceries|supermarket)\b/],
  ['gas', /\b(gas|fuel)\b/],
  ['rideshare', /\b(taxi|cab|rideshare)\b/],
  ['transit', /\b(train|bus|subway|metro|tolls?|parking|ferry)\b/],
  ['flights', /\b(flights?|airlines?|airfare|plane)\b/],
  ['hotels', /\b(hotels?|motel|resort)\b/],
  ['streaming', /\bstreaming\b/],
  ['drugstore', /\b(pharmacy|drugstore)\b/],
];

/**
 * Best guess at the reward category for a purchase you're about to make: a known store, then how
 * you categorized the same thing before, then plain words. Null when it can't tell.
 */
export function guessRewardCat(text, txs = []) {
  const brand = merchantFor(text);
  if (brand) return brand.cat;
  const key = String(text || '').trim().toLowerCase();
  if (!key) return null;
  for (let i = txs.length - 1; i >= 0; i--) {
    const t = txs[i];
    if (t.cents > 0 && t.category && String(t.item || '').trim().toLowerCase() === key) return rewardCatFor(t);
  }
  const s = norm(text);
  for (const [cat, re] of KEYWORDS) if (re.test(s)) return cat;
  const category = categorize(text, 1);
  return category === 'other' ? null : rewardCatFor({ category, item: text });
}

/** Map a logged transaction to a reward category, from the store, its spending category and what it was. */
export function rewardCatFor(t) {
  const brand = merchantFor(t.item);
  if (brand) return brand.cat;
  const s = String(t.item || '').toLowerCase();
  switch (t.category) {
    case 'food':
    case 'nightlife': return 'dining';
    case 'groceries': return 'groceries';
    case 'transport':
      if (/\buber\b|\blyft\b|taxi|\bcab\b/.test(s)) return 'rideshare';
      if (/\bgas\b|fuel|shell|exxon|mobil|\bbp\b|chevron|sunoco|wawa gas/.test(s)) return 'gas';
      return 'transit';
    case 'travel':
      if (/flight|airline|airfare|delta|united|jetblue|american air|southwest|alaska air|spirit|frontier/.test(s)) return 'flights';
      if (/hotel|marriott|hilton|hyatt|ihg|holiday inn|sheraton|westin/.test(s)) return 'hotels';
      return 'other';
    case 'health': return /\bcvs\b|walgreens|rite aid|duane reade|pharmacy/.test(s) ? 'drugstore' : 'other';
    case 'bills': return /netflix|spotify|hulu|disney|\bmax\b|hbo|youtube|peacock|paramount|apple tv|espn/.test(s) ? 'streaming' : 'other';
    default: return 'other';
  }
}

export const quarterOf = d => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

/** A card you own, merged with its catalog terms. Null when the catalog entry isn't available. */
export function resolveCard(owned, catalog) {
  const base = owned.catalogId ? catalog?.cards?.find(c => c.id === owned.catalogId) : null;
  if (owned.catalogId && !base) return null;
  const custom = owned.custom || {};
  return {
    ...base,
    id: owned.id,
    catalogId: owned.catalogId || null,
    name: base?.name || custom.name || 'Card',
    short: owned.nickname || base?.short || custom.name || 'Card',
    issuer: base?.issuer || custom.issuer || '',
    network: base?.network || custom.network || null,
    program: base?.program || custom.program || 'cash',
    annualFeeCents: Number.isInteger(owned.feeCents) ? owned.feeCents : base?.annualFeeCents ?? custom.annualFeeCents ?? 0,
    firstYearFree: owned.firstYearFree ?? base?.firstYearFree ?? false,
    earn: base?.earn || custom.earn || [{ cat: 'other', rate: 1 }],
    rotating: base?.rotating || [],
    credits: base?.credits || [],
    opened: owned.opened || null,
    owned,
  };
}

/** What one reward unit is worth in cents: 1 for cash back, your value for points. */
export function pointCents(card, catalog, prefs = {}) {
  if (card.program === 'cash') return 1;
  if (Number.isFinite(card.owned?.custom?.pointCents)) return card.owned.custom.pointCents;
  return prefs[card.program] ?? catalog?.programs?.[card.program]?.cents ?? 1;
}

function rules(card, cat, date, merchant) {
  const fallback = card.earn.find(r => r.cat === 'other') || { cat: 'other', rate: 1 };
  const base = card.earn.find(r => r.cat === cat && (!r.merchants || r.merchants.includes(merchant))) || fallback;
  const rot = (card.rotating || []).find(r => r.quarter === quarterOf(date) && r.cats.includes(cat)) || null;
  return { base, rot, fallback };
}
const capKey = (rule, date) => `${rule.cat}|${rule.capPer === 'quarter' ? quarterOf(date) : date.slice(0, 4)}`;
const isActivated = (card, quarter) => !!card.owned?.activated?.includes(quarter);

/**
 * Reward units earned on one purchase (points, or cents of cash back — both are cents × rate ÷ 100),
 * consuming caps in `used`. A rotating bonus only applies once activated (unless `assumeActivated`).
 */
function earnOn(card, cat, date, cents, used, assumeActivated = false, merchant = null) {
  const { base, rot, fallback } = rules(card, cat, date, merchant);
  let units = 0, left = cents;
  if (rot && (assumeActivated || isActivated(card, rot.quarter))) {
    const k = `rot|${rot.quarter}`;
    const take = Math.min(left, Math.max(0, rot.capCents - (used[k] || 0)));
    units += take * rot.rate / 100;
    used[k] = (used[k] || 0) + take;
    left -= take;
  }
  if (left > 0 && base.capCents) {
    const k = capKey(base, date);
    const take = Math.min(left, Math.max(0, base.capCents - (used[k] || 0)));
    units += take * base.rate / 100;
    used[k] = (used[k] || 0) + take;
    left -= take;
    units += left * fallback.rate / 100;
  } else if (left > 0) {
    units += left * base.rate / 100;
  }
  return units;
}

/**
 * Walk a card's purchases in date order (caps carry across the whole history) and total what was
 * earned between `from` and `to`. Returns units and their value in cents.
 */
export function earnings(card, txs, { from = '0000-01-01', to = '9999-12-31', valueCents = 1 } = {}) {
  const used = {};
  let units = 0;
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!(t.cents > 0) || t.date > to) continue;
    const u = earnOn(card, rewardCatFor(t), t.date, t.cents, used, false, merchantFor(t.item)?.id);
    if (t.date >= from) units += u;
  }
  return { units, cents: Math.round(units * valueCents), used };
}

/** How much of each cap a card has used by `today`. */
function capUsage(card, txs, today) {
  return earnings(card, txs.filter(t => t.date <= today), { to: today }).used;
}

/**
 * Your cards ranked for a purchase category today. `merchant` (from merchantFor) applies store-only
 * rates and credits, and puts cards the store doesn't accept last.
 * @returns {{card, rate, pct, afterPct, note, capLeftCents, activate, blocked, perks: string[]}[]}
 */
export function bestCards(cards, cat, { today, txs = [], catalog, prefs = {}, merchant = null }) {
  const out = cards.map(card => {
    const mine = txs.filter(t => t.cardId === card.id);
    const used = capUsage(card, mine, today);
    const { base, rot, fallback } = rules(card, cat, today, merchant?.id);
    let rate = base.rate, note = base.note || '', capLeft = null, activate = null, after = null;
    if (base.capCents) {
      capLeft = Math.max(0, base.capCents - (used[capKey(base, today)] || 0));
      if (capLeft === 0) { rate = fallback.rate; note = `Cap reached for the year — ${fallback.rate}x until January`; capLeft = null; }
      else after = fallback.rate;
    }
    if (rot) {
      const rotLeft = Math.max(0, rot.capCents - (used[`rot|${rot.quarter}`] || 0));
      if (rotLeft > 0 && rot.rate > rate) {
        after = rate;
        rate = rot.rate;
        note = `Quarterly bonus: ${rot.label}`;
        capLeft = rotLeft;
        if (!isActivated(card, rot.quarter)) activate = rot.activate || 'Activate this quarter’s bonus';
      }
    }
    const pc = pointCents(card, catalog, prefs);
    const blocked = merchant?.only && card.network && !merchant.only.includes(card.network) ? `${merchant.name} doesn’t take ${NETWORKS[card.network] || card.network}` : null;
    return { card, rate, pct: rate * pc / 100, afterPct: after != null ? after * pc / 100 : null, note, capLeftCents: capLeft, activate, blocked, perks: creditHints(card, cat, today, merchant?.id) };
  });
  return out.sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || b.pct - a.pct || (a.card.annualFeeCents - b.card.annualFeeCents));
}

/** What a purchase of `cents` earns with one ranked card, in cents of value (caps included). */
export function valueOn(r, cents) {
  if (r.capLeftCents != null && cents > r.capLeftCents) return Math.round(r.capLeftCents * r.pct + (cents - r.capLeftCents) * (r.afterPct ?? r.pct));
  return Math.round(cents * r.pct);
}

// ---------------------------------------------------------------- credits
/** The period a credit belongs to on `date` — the key credit usage is stored under. */
export function periodKey(per, date, opened) {
  const y = date.slice(0, 4), m = Number(date.slice(5, 7));
  switch (per) {
    case 'month': return date.slice(0, 7);
    case 'quarter': return quarterOf(date);
    case 'half': return `${y}-H${m <= 6 ? 1 : 2}`;
    case 'cardyear': return opened ? `cy:${cardYearOf(opened, date).start}` : y;
    case 'every4': {
      // 4-year windows from the card's opening; counted toward the first card year of each window
      if (!opened) return `e4:${Math.floor(Number(y) / 4) * 4}-01-01`;
      const oy = Number(opened.slice(0, 4));
      const cy = Number(cardYearOf(opened, date).start.slice(0, 4));
      return `e4:${iso(oy + Math.floor((cy - oy) / 4) * 4, Number(opened.slice(5, 7)), 1)}`;
    }
    default: return y;
  }
}

/** First day of a credit period, so usage can be attributed to a card year. */
export function periodStart(key) {
  if (/^\d{4}-\d{2}$/.test(key)) return key + '-01';
  if (/^\d{4}-Q\d$/.test(key)) return `${key.slice(0, 4)}-${String((Number(key.slice(6)) - 1) * 3 + 1).padStart(2, '0')}-01`;
  if (/^\d{4}-H\d$/.test(key)) return `${key.slice(0, 4)}-${key.endsWith('1') ? '01' : '07'}-01`;
  if (key.startsWith('cy:') || key.startsWith('e4:')) return key.slice(3);
  if (/^\d{4}$/.test(key)) return key + '-01-01';
  return null;
}

export const periodLabel = per => ({ month: 'this month', quarter: 'this quarter', half: 'this half-year', year: 'this year', cardyear: 'this card year', every4: 'every 4 years' }[per] || per);
export const perYear = per => ({ month: 12, quarter: 4, half: 2, year: 1, cardyear: 1, every4: 0.25 }[per] || 1);

/** Last day of the credit period that contains `date` — when unused money disappears. */
export function periodEnd(per, date, opened) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  switch (per) {
    case 'month': return addDays(addMonths(date.slice(0, 7) + '-01', 1), -1);
    case 'quarter': return addDays(addMonths(iso(y, (Math.floor((m - 1) / 3) + 1) * 3, 1), 1), -1);
    case 'half': return m <= 6 ? `${y}-06-30` : `${y}-12-31`;
    case 'cardyear': return opened ? cardYearOf(opened, date).end : `${y}-12-31`;
    case 'every4': return null;
    default: return `${y}-12-31`;
  }
}

/** Amount of a credit used in its current period. */
export function creditUsedNow(card, credit, today) {
  return card.owned?.creditsUsed?.[credit.id]?.[periodKey(credit.per, today, card.opened)] || 0;
}

/** Credits that apply to a purchase (by store when the credit is store-only) with money left this period. */
function creditHints(card, cat, today, merchant) {
  return (card.credits || []).filter(c => c.merchants ? c.merchants.includes(merchant) : c.cats?.includes(cat)).map(c => {
    const left = c.cents - creditUsedNow(card, c, today);
    return left > 0 ? `$${(left / 100).toFixed(left % 100 ? 2 : 0)} ${c.label} left ${periodLabel(c.per)}${c.if ? ` ${c.if}` : ''}` : null;
  }).filter(Boolean);
}

/** Total credits used in periods that start inside [from, to]. */
export function creditsInRange(card, from, to) {
  let total = 0;
  for (const [id, byPeriod] of Object.entries(card.owned?.creditsUsed || {})) {
    if (!(card.credits || []).some(c => c.id === id)) continue;
    for (const [key, cents] of Object.entries(byPeriod)) {
      const start = periodStart(key);
      if (start && start >= from && start <= to) total += cents;
    }
  }
  return total;
}

// ---------------------------------------------------------------- annual fee
function cardYearOf(opened, today) {
  const om = Number(opened.slice(5, 7));
  let start = iso(Number(today.slice(0, 4)), om, 1);
  if (start > today) start = iso(Number(today.slice(0, 4)) - 1, om, 1);
  return { start, end: addDays(addMonths(start, 12), -1) };
}

/** The card's current account year (fees renew on the anniversary month). */
export function cardYear(card, today) {
  if (!card.opened) {
    const y = today.slice(0, 4);
    return { start: `${y}-01-01`, end: `${y}-12-31`, renews: `${Number(y) + 1}-01-01`, isFirstYear: false, feeCents: card.annualFeeCents, nextFeeCents: card.annualFeeCents, guessed: true };
  }
  const { start, end } = cardYearOf(card.opened, today);
  const isFirstYear = start.slice(0, 7) === card.opened || start < card.opened + '-01';
  const feeCents = card.firstYearFree && isFirstYear ? 0 : card.annualFeeCents;
  return { start, end, renews: addMonths(start, 12), isFirstYear, feeCents, nextFeeCents: card.annualFeeCents, guessed: false };
}

/**
 * Is the annual fee paying for itself this card year?
 * rewards: estimated from purchases logged on the card, or the points / cash back you enter from
 * your statement (stored as reward units, so a changed point value applies to it too),
 * credits: statement credits you've marked as used, vsNoFee: extra earned versus putting the same
 * purchases on your best no-fee card.
 */
export function feeStatus(card, { txs = [], today, catalog, prefs = {}, others = [] }) {
  const yr = cardYear(card, today);
  const mine = txs.filter(t => t.cardId === card.id);
  const pc = pointCents(card, catalog, prefs);
  const est = earnings(card, mine, { from: yr.start, to: today, valueCents: pc });
  const override = card.owned?.rewardsOverride?.[yr.start];
  const rewards = Number.isFinite(override) ? Math.round(override * pc) : est.cents;
  const credits = creditsInRange(card, yr.start, yr.end);
  const total = rewards + credits;
  const days = daysBetween(yr.start, yr.end) + 1;
  const elapsed = Math.min(1, (daysBetween(yr.start, today) + 1) / days);
  const projected = elapsed >= 0.08 ? Math.round(total / elapsed) : null;
  const target = yr.feeCents || yr.nextFeeCents;
  const status = !target ? 'no-fee' : total >= target ? 'covered' : projected != null && projected >= target ? 'on-pace' : projected == null ? 'early' : 'behind';
  // versus the same purchases on your best no-fee card
  const inYear = mine.filter(t => t.date >= yr.start && t.date <= today);
  let alt = 0;
  for (const o of others.filter(o => o.id !== card.id && !o.annualFeeCents)) {
    alt = Math.max(alt, earnings(o, inYear, { valueCents: pointCents(o, catalog, prefs) }).cents);
  }
  return { ...yr, rewardsCents: rewards, rewardsEstimated: !Number.isFinite(override), rewardsUnits: Number.isFinite(override) ? override : Math.round(est.units), creditsCents: credits, totalCents: total, projectedCents: projected, targetCents: target, status, elapsed, vsNoFeeCents: est.cents - alt + credits, purchases: inYear.length };
}

/**
 * Would a card pay for itself on your spending? Uses the best of your current cards per category
 * as the baseline, so only the extra rewards count.
 * @param {Record<string, number>} spend annual cents per reward category
 */
export function simulateCard(card, current, spend, { creditCents = 0, catalog, prefs = {}, today }) {
  const best = (cards, cat, cents) => Math.max(0, ...cards.map(c => {
    const used = {};
    return earnOn(c, cat, today, cents, used, true) * pointCents(c, catalog, prefs);
  }));
  let withNew = 0, without = 0;
  const rows = [];
  for (const [cat, cents] of Object.entries(spend)) {
    if (!(cents > 0)) continue;
    const a = best(current, cat, cents);
    const b = Math.max(a, best([card], cat, cents));
    without += a;
    withNew += b;
    rows.push({ cat, cents, extra: Math.round(b - a) });
  }
  const extraRewards = Math.round(withNew - without);
  const fee = card.annualFeeCents;
  return { extraRewardsCents: extraRewards, creditCents, feeCents: fee, netCents: extraRewards + creditCents - fee, rows };
}
