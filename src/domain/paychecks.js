// Where each planned transfer of a paycheck stands: not sent, partly sent, sent, or short in a way
// the next paycheck makes up. Pure functions; "sent" is the total of the transfers you've marked.
import { monthKey } from './dates.js';

/** Close enough to count as sent in full: a few dollars of rounding on a buy is normal. */
export const sentTolerance = cents => Math.max(200, Math.round(cents * 0.005));

/**
 * @param {object} p
 * @param {{cents: number, residual?: boolean}} p.line the planned transfer
 * @param {number} p.sentCents what's been marked as sent for it
 * @param {boolean} [p.final] you said that's all you're sending for it
 * @param {string} p.payday
 * @param {string} p.today
 * @returns {{state: 'none'|'partial'|'full'|'catchup', leftCents: number}}
 *   none: nothing sent · partial: some sent, the rest still to go (shown as a reminder)
 *   catchup: a bucket got less than the plan now says, earlier this month — the next paycheck makes it up
 *   full: done (sent in full, close enough, marked as all, or an older month that's closed)
 */
export function lineState({ line, sentCents = 0, final = false, payday, today }) {
  const left = Math.max(0, line.cents - sentCents);
  if (!(sentCents > 0)) return { state: 'none', leftCents: line.cents };
  if (final || left <= sentTolerance(line.cents)) return { state: 'full', leftCents: 0 };
  if (payday >= today) return { state: 'partial', leftCents: left };   // part sent early
  if (line.residual) return { state: 'partial', leftCents: left };     // the rest is still waiting to be invested
  if (monthKey(payday) === monthKey(today)) return { state: 'catchup', leftCents: left };
  return { state: 'full', leftCents: 0 };
}

/** Lines of a paycheck that still need you: nothing sent, or only part. */
export const openLines = lines => (lines || []).filter(l => l.cents > 0 && (l.state === 'none' || l.state === 'partial'));

/**
 * Sending a bucket more than its planned amount (a catch-up, or on purpose) leaves that much less
 * for the bucket that "gets the rest". Returns the lines with the residual reduced to match.
 * @param {{bucketId: string, cents: number, residual?: boolean}[]} lines
 * @param {Record<string, number>} sent cents already sent per bucket for this paycheck
 */
export function settleResidual(lines, sent = {}) {
  let over = 0;
  for (const l of lines) if (!l.residual) over += Math.max(0, (sent[l.bucketId] || 0) - l.cents);
  if (!over) return lines;
  return lines.map(l => (l.residual ? { ...l, cents: Math.max(0, l.cents - over), overSentCents: over } : l));
}
