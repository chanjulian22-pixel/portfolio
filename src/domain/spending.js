// Spending: categories, the monthly budget (derived from the paycheck plan), and month summaries.
import { paydaysInMonth, parts, daysInMonth, monthKey } from './dates.js';
import { phaseOn, plannedFor } from './allocation.js';

export const CATEGORIES = [
  { id: 'food', label: 'Food & drink', emoji: '🍔' },
  { id: 'groceries', label: 'Groceries', emoji: '🛒' },
  { id: 'nightlife', label: 'Going out', emoji: '🍻' },
  { id: 'transport', label: 'Transport', emoji: '🚕' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'fun', label: 'Entertainment', emoji: '🎟️' },
  { id: 'gifts', label: 'Gifts', emoji: '🎁' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { id: 'health', label: 'Health & fitness', emoji: '💪' },
  { id: 'bills', label: 'Bills & fees', emoji: '🧾' },
  { id: 'credits', label: 'Refunds & paybacks', emoji: '↩️' },
  { id: 'other', label: 'Other', emoji: '📦' },
];
export const categoryById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

// First match wins, so order matters (a "bus ticket" is transport, a "gift card" is a gift).
const RULES = [
  ['gifts', /\bgift|flowers?\b|necklace|present\b/],
  ['transport', /\buber\b|\blyft\b|\bbus\b|\btrain\b|trolley|amtrak|subway|\bmetro\b|taxi|transportation|parking|\bgas\b|\btolls?\b|\bpath\b|nj transit|citi ?bike|\bmta\b/],
  ['travel', /flight|airport|hotel|airbnb|national park|\bfx\b|travel|\btrip\b|resort|luggage/],
  ['nightlife', /\bbeer|\bbars?\b|drinks?\b|\balc\b|alcohol|going out|cider|wine|cocktail|\bclub\b|happy hour/],
  ['groceries', /grocer|trader joe|whole foods|aldi|safeway|market\b/],
  ['food', /chipotle|shake shack|starbucks|coffee|cafe|popeyes|wendy|chic.?k?.?fil|cava|jersey mike|sushi|brunch|dinner|lunch|breakfast|\bfood\b|froyo|ice cream|\bbec\b|wawa|juice|gatorade|grub ?hub|doordash|seamless|uber ?eats|schmear|bagel|pizza|burger|taco|restaurant|deli|bakery|snack/],
  ['fun', /ticket|yankees|mets|knicks|concert|movie|cinema|museum|show\b|game\b|bowling|golf/],
  ['health', /\bgnc\b|\bgym\b|equinox|\bcvs\b|walgreens|pharmacy|colgate|doctor|dental|medical|vitamin|protein/],
  ['bills', /\bfee\b|annual fee|\bdata\b|phone|subscription|netflix|spotify|hulu|insurance|\bbill\b|icloud|laundry/],
  ['shopping', /amazon|lulu|clothes|shirt|shoes|target|uniqlo|zara|\bshop|apple store/],
  ['credits', /reimburs|refund|cash ?back|credit|payback|paid back|rebate/],
];

/** Best-guess category from the item text. Money coming back (negative) defaults to a credit. */
export function categorize(item, cents) {
  if (cents < 0) return 'credits';
  const s = String(item || '').toLowerCase();
  for (const [id, re] of RULES) if (re.test(s)) return id;
  return 'other';
}

/** Prefer how you categorized the same item before; fall back to the rules. */
export function suggestCategory(item, cents, transactions = []) {
  const key = String(item || '').trim().toLowerCase();
  if (key) {
    for (let i = transactions.length - 1; i >= 0; i--) {
      const t = transactions[i];
      if (t.category && String(t.item || '').trim().toLowerCase() === key && Math.sign(t.cents) === Math.sign(cents || 1)) return t.category;
    }
  }
  return categorize(item, cents);
}

/** Spending budget for a month: what the plan sends to spending buckets that month, unless overridden. */
export function monthlyBudget(config, month) {
  const override = config.budgetOverrides?.[month];
  if (Number.isInteger(override)) return { cents: override, source: 'override' };
  const { y, m } = parts(month + '-01');
  const spendIds = config.buckets.filter(b => b.isSpending).map(b => b.id);
  let cents = 0, any = false;
  for (const p of paydaysInMonth(y, m)) {
    const { phase } = phaseOn(p.date, config.phases || []);
    if (!phase) continue;
    any = true;
    for (const id of spendIds) cents += plannedFor(phase, id, p.index);
  }
  return { cents, source: any ? 'plan' : 'none' };
}

/**
 * Transactions that count against the spending budget: not ones paid out of another bucket (like
 * travel), and not work expenses your employer pays back.
 */
export const countsAsSpending = t => !t.fundedBy && !t.work && !t.loanId;

/** Work expenses you've paid but haven't been reimbursed for yet, oldest first. */
export function outstandingWork(transactions = []) {
  const items = transactions.filter(t => t.work && !t.reimbursedOn && t.cents > 0).sort((a, b) => a.date.localeCompare(b.date));
  return { items, cents: items.reduce((s, t) => s + t.cents, 0), oldest: items[0]?.date || null };
}

/** Totals for one month (`YYYY-MM`). Credits net against spending. */
export function monthSummary(transactions, month) {
  const { y, m } = parts(month + '-01');
  const days = daysInMonth(y, m);
  const byDay = new Array(days).fill(0);
  const byCategory = {};
  let spent = 0, gross = 0, credits = 0, count = 0, undated = 0;
  for (const t of transactions) {
    if (monthKey(t.date) !== month || !countsAsSpending(t)) continue;
    count++;
    spent += t.cents;
    if (t.cents >= 0) gross += t.cents; else credits -= t.cents;
    const cat = t.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + t.cents;
    if (t.undated) undated += t.cents;
    else byDay[Number(t.date.slice(8, 10)) - 1] += t.cents;
  }
  return { month, spent, gross, credits, count, byCategory, byDay, undated, days };
}
