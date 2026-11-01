// Closing down a month's wallet once the month is over.
//
// Both people close it down: the first enters the Revolut balance at the end of
// the month, and each confirms that all their purchases from that month are
// sorted. When both agree, the month is closed: the final result is kept and the
// wallet of that month can't change any more, unless both agree to reopen it.
//
// Used by the Wallet screen (the close-down card and the closed result) and by
// the Wallet and Month screens of the new month (the reminder).

import * as state from '../state.js';
import { toSort } from '../purchases.js';
import { formatCents } from '../lib/money.js';
import { monthLabel, shortDateLabel, daysInMonth } from '../lib/months.js';
import { lastBalance } from '../lib/budget.js';
import { esc, toast } from './dom.js';
import { openForm } from './form.js';

const monthName = (key) => monthLabel(key).split(' ')[0];
const lastDayOf = (key) => `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;

/** The message shown when something would change a closed month. */
export function closedMessage(key) {
  return `${monthLabel(key)} is closed down. Both of you can reopen it on its Wallet screen.`;
}

/** "12,30 € under plan" / "4,10 € over plan" */
function planText(budget, spent) {
  const diff = budget - spent;
  return diff >= 0 ? `${formatCents(diff)} under plan` : `${formatCents(-diff)} over plan`;
}

// ---------- reminder in the new month ----------

/** Reminder on the current month's Wallet and Month screens while last month isn't closed. */
export function reminderHtml(ctx) {
  if (ctx.month !== ctx.todayKey.slice(0, 7)) return '';
  const key = state.monthToClose(ctx.todayKey);
  if (!key) return '';
  const { status } = state.closeInfo(key);
  const me = state.getDevice().me;
  const other = me === 't' ? 'k' : 't';
  const names = state.getSettings().names;
  const text = status[me] === 'approved'
    ? `You closed down ${monthName(key)}. Waiting for ${names[other]} →`
    : status[other] === 'approved'
      ? `${names[other]} closed down ${monthName(key)}. Please close it down too →`
      : `${monthLabel(key)} isn't closed down yet. Close it down together →`;
  return `<button type="button" class="notice notice-btn" data-act="goto-close" data-month="${esc(key)}" data-testid="close-reminder">${esc(text)}</button>`;
}

export function bindReminder(main, ctx) {
  main.querySelector('[data-act="goto-close"]')?.addEventListener('click', (e) => {
    ctx.setMonth(e.currentTarget.dataset.month);
    location.hash = 'wallet';
  });
}

// ---------- close-down card (month over, not closed yet) ----------

function voteLine(p, status, closed) {
  const text = {
    approved: '✓ closed down',
    stale: 'closed down with other numbers. Needs to confirm again',
    waiting: closed ? 'happy with the result' : 'not closed down yet',
    reopen: 'asked to reopen',
  }[status[p]];
  return `<li class="vote ${status[p]}" data-testid="close-vote-${p}"><b>${esc(state.getSettings().names[p])}</b> · ${esc(text)}</li>`;
}

export function closeCardHtml(key) {
  const me = state.getDevice().me;
  const { result, status } = state.closeInfo(key);
  const name = monthName(key);
  const resultLine = result ? `<p class="small" style="margin:0 0 6px" data-testid="close-result">
      Final balance on ${esc(shortDateLabel(result.finalDate))}: <b class="num">${formatCents(result.finalBalance)}</b>
      → spent <b class="num">${formatCents(result.spent)}</b> of <span class="num">${formatCents(result.budget)}</span>,
      <b>${esc(planText(result.budget, result.spent))}</b></p>` : '';
  const mine = status[me];
  return `<section class="card close-card" data-testid="close-card">
    <h2>Close down ${esc(name)}</h2>
    <p class="muted small" style="margin-top:0">${esc(name)} is over. When both of you have sorted all your ${esc(name)} purchases,
      close it down. The final balance becomes ${esc(name)}'s result and what next month starts with.
      After that, ${esc(name)}'s wallet can't be changed.</p>
    ${resultLine}
    <ul class="votes">${voteLine('t', status, false)}${voteLine('k', status, false)}</ul>
    <div class="btn-row">
      ${mine === 'approved'
        ? '<button class="btn small-btn" data-close="withdraw">Withdraw my close-down</button>'
        : `<button class="btn primary" data-close="close">${mine === 'stale' ? 'Confirm the new numbers' : `Close down ${esc(name)}`}</button>`}
    </div>
  </section>`;
}

// ---------- closed: the final result ----------

export function closedCardHtml(key, versionTag) {
  const me = state.getDevice().me;
  const other = me === 't' ? 'k' : 't';
  const names = state.getSettings().names;
  const m = state.getMonth(key) || {};
  // The result as both agreed it (kept on the month), else worked out again.
  const r = m.closedResult || state.closingResult(key) || { finalBalance: 0, finalDate: lastDayOf(key), spent: 0, budget: m.walletBudget || 0 };
  const { status } = state.closeInfo(key);
  const when = m.closedAt ? new Date(m.closedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const left = r.budget - r.spent;
  const iAsked = status[me] === 'reopen';
  const theyAsked = status[other] === 'reopen';
  const next = monthLabel(state.addMonths(key, 1)).split(' ')[0];
  return `<section class="card hero closed-card" data-testid="closed-card" aria-label="Final result">
    <div class="hero-top"><span class="label">✓ ${esc(monthName(key))} closed</span>${versionTag}</div>
    <div class="big num ${left < 0 ? 'negative' : ''}" data-testid="final-left">${formatCents(left)}</div>
    <div class="muted">${left >= 0 ? 'left of the budget' : 'over the budget'}: spent <span class="num" data-testid="final-spent">${formatCents(r.spent)}</span>
      of the agreed <span class="num">${formatCents(r.budget)}</span></div>
    <table class="sumtable" style="margin-top:12px">
      <tr><td>Final balance (${esc(shortDateLabel(r.finalDate))})</td><td data-testid="final-balance">${formatCents(r.finalBalance)}</td></tr>
      <tr><td>Carried into ${esc(next)}</td><td>${formatCents(r.finalBalance)}</td></tr>
    </table>
    ${iAsked || theyAsked ? `<ul class="votes">${voteLine('t', status, true)}${voteLine('k', status, true)}</ul>` : ''}
    <div class="btn-row" style="margin-top:10px">
      ${iAsked
        ? '<button class="btn small-btn" data-close="cancel-reopen">Cancel my reopen request</button>'
        : `<button class="btn small-btn" data-close="reopen">${theyAsked ? `Agree to reopen (${esc(names[other])} asked)` : 'Ask to reopen'}</button>`}
    </div>
    <p class="muted small" style="margin:8px 0 0">Closed down by both${when ? ` on ${esc(when)}` : ''}.
      Check-ins, added money and common purchases of this month can't change. Reopens only when both of you agree.</p>
  </section>`;
}

// ---------- buttons ----------

export function bindCard(main, ctx) {
  main.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = ctx.month;
      const other = state.getSettings().names[state.getDevice().me === 't' ? 'k' : 't'];
      switch (btn.dataset.close) {
        case 'close':
          closeDown(ctx);
          break;
        case 'withdraw':
          state.voteClose(key, null);
          toast('Close-down withdrawn');
          break;
        case 'reopen': {
          const action = state.voteClose(key, 'reopen');
          toast(action === 'reopen' ? `${monthLabel(key)} reopened: both agreed` : `Reopen requested. Waiting for ${other}.`);
          break;
        }
        case 'cancel-reopen':
          state.voteClose(key, 'close');
          toast('Reopen request cancelled');
          break;
        default:
      }
    });
  });
}

/**
 * Close down the month on this phone: everything from that month must be sorted
 * here first; then enter (or confirm) the final balance and tick "all sorted".
 */
export async function closeDown(ctx) {
  const key = ctx.month;
  const name = monthName(key);
  const waiting = toSort(key).length;
  if (waiting) {
    const go = await openForm({
      title: `Sort ${name} first`,
      fields: [],
      submitLabel: 'Go to Purchases',
      extraHtml: `<p class="muted" style="margin-top:0" data-testid="close-unsorted">${waiting} purchase${waiting === 1 ? ' from ' + esc(name) + ' is' : 's from ' + esc(name) + ' are'}
        still waiting to be sorted on this phone. Sort them (or clear them as already settled) before closing down.</p>`,
    });
    if (go) location.hash = 'buys';
    return;
  }

  const me = state.getDevice().me;
  const names = state.getSettings().names;
  const fin = state.getFinalCheckin(key);
  const lastDay = lastDayOf(key);
  // Suggest the balance already entered, or a check-in from the last day.
  const last = lastBalance(state.checkinsFor(key));
  const suggested = fin ? fin.balance : (last && last.date === lastDay ? last.balance : null);
  const hint = fin && fin.by !== me
    ? `${names[fin.by] || 'The other one'} entered this. If you change it, ${names[fin.by] || 'they'} must close down again.`
    : `The balance of the shared Revolut account at the end of ${shortDateLabel(lastDay)}, before anything from next month (the statement shows it).`;

  const values = await openForm({
    title: `Close down ${name}`,
    fields: [
      { name: 'balance', label: `Revolut balance at the end of ${shortDateLabel(lastDay)}`, type: 'money', required: true,
        allowNegative: true, value: suggested, autofocus: true, hint },
      { name: 'sorted', label: `All my ${name} purchases are imported and sorted`, type: 'checkbox', required: true },
    ],
    submitLabel: `Close down ${name}`,
  });
  if (!values) return;
  const action = state.voteClose(key, 'close', values.balance);
  const other = names[me === 't' ? 'k' : 't'];
  toast(action === 'close' ? `${monthLabel(key)} closed: both agreed` : `Closed down on your side. Waiting for ${other}.`);
}
