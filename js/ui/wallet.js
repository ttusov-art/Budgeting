// Wallet screen: how the everyday spending is going this month.
// Check-ins record the actual balance of the shared (Revolut) account.
// Top-ups record personal money added to it. Spending is always compared
// with the agreed wallet budget only; carry-over and top-ups are extra.

import * as state from '../state.js';
import { spentSoFar, walletPace, checkinSpent } from '../lib/budget.js';
import { formatCents, formatCentsWhole } from '../lib/money.js';
import { dateKeyOf, shortDateLabel, monthLabel, daysInMonth } from '../lib/months.js';
import { APP_VERSION } from '../version.js';
import { esc, toast, payerOptions } from './dom.js';
import { openForm } from './form.js';

export function render(main, ctx) {
  const { month, todayKey } = ctx;
  const { m, carry, startBalance } = state.planFor(month);
  const budget = m.walletBudget || 0;
  const checkins = state.checkinsFor(month);
  const topups = state.topupsFor(month);
  const { spent, lastCheckin } = spentSoFar(checkins, startBalance, topups);
  const versionTag = `<span class="version-tag" data-testid="version">v${esc(APP_VERSION)}</span>`;

  if (!budget) {
    main.innerHTML = `
      <div class="stack">
        <div class="page-top">${versionTag}</div>
        <section class="card">
          <h2>No wallet budget for ${esc(monthLabel(month))} yet</h2>
          <p class="muted">Set up the month first: salaries, the wallet budget and the fixed costs.
          Next month you can copy it.</p>
          <a class="btn primary" href="#month">Set up the month</a>
        </section>
        ${entriesCard(checkins, topups, startBalance)}
      </div>`;
    bindEntries(main);
    return;
  }

  const p = walletPace({ budget, spent, monthKey: month, todayKey });
  const level = p.pace <= 1 ? 'good' : p.pace <= 1.1 ? 'warn' : 'bad';
  const fillPct = Math.min(100, Math.max(0, (spent / budget) * 100));
  const markPct = Math.min(100, (p.expected / budget) * 100);

  let paceText;
  if (p.elapsed === 0) paceText = 'Month has not started yet';
  else if (!lastCheckin) paceText = 'No check-in yet this month';
  else if (p.aheadBy >= 0) paceText = `${formatCents(p.aheadBy)} under plan`;
  else paceText = `${formatCents(-p.aheadBy)} over plan`;
  const pacePct = p.elapsed > 0 && lastCheckin
    ? `${(p.pace * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % of the planned pace so far` : '';

  // What the account holds beyond the budget: carry-over and top-ups.
  const topupTotal = topups.reduce((a, t) => a + t.amount, 0);
  const extras = [];
  if (carry.amount) extras.push(`${formatCents(carry.amount)} carried over`);
  if (topupTotal) extras.push(`${formatCents(topupTotal)} topped up`);

  const balanceLine = lastCheckin && lastCheckin.balance != null
    ? `Revolut balance ${formatCents(lastCheckin.balance)} on ${shortDateLabel(lastCheckin.date)}`
    : 'Check in with the Revolut balance to see how you are doing';

  main.innerHTML = `
    <div class="stack">
      <section class="card hero" aria-label="Wallet status">
        <div class="hero-top"><span class="label">Budget left</span>${versionTag}</div>
        <div class="big num ${budget - spent < 0 ? 'negative' : ''}" data-testid="remaining">${formatCents(budget - spent)}</div>
        <div class="muted">spent <span class="num" data-testid="spent">${formatCents(spent)}</span> of the agreed <span class="num">${formatCents(budget)}</span></div>
        <div class="meter" role="img" aria-label="Spent ${Math.round(fillPct)} % of the budget; plan for today is ${Math.round(markPct)} %">
          <div class="meter-fill ${level === 'good' ? '' : level}" style="width:${fillPct}%"></div>
          <div class="meter-mark" style="left:calc(${markPct}% - 1px)" title="Plan for today"></div>
        </div>
        <div class="meter-legend"><span>Day ${p.elapsed} of ${p.days}</span><span>▮ plan for today: ${formatCentsWhole(p.expected)}</span></div>
        <div class="pace-pill ${lastCheckin ? level : ''}" data-testid="pace"><span>${esc(paceText)}</span>${pacePct ? `<span class="pace-sub">${esc(pacePct)}</span>` : ''}</div>
      </section>

      <div class="btn-row grow">
        <button class="btn primary" data-act="checkin" title="Check in the Revolut balance (C)">Check in <kbd>C</kbd></button>
        <button class="btn" data-act="topup" title="Add money (A)">Add money <kbd>A</kbd></button>
      </div>
      <p class="muted small" style="margin-top:8px" data-testid="balance-line">${esc(balanceLine)}${extras.length ? ` · includes ${esc(extras.join(' + '))}` : ''}</p>

      <section class="card">
        <h2>Budget vs. actual</h2>
        <div class="stats">
          ${stat('Daily budget', formatCentsWhole(p.dailyBudget))}
          ${stat('Actual per day', lastCheckin ? formatCentsWhole(p.actualDaily) : '—')}
          ${stat('Can spend per day', p.daysLeft > 0 ? formatCentsWhole(p.perDayLeft) : '—')}
          ${stat('Weekly budget', formatCentsWhole(p.weeklyBudget))}
          ${stat('Actual per week', lastCheckin ? formatCentsWhole(p.actualWeekly) : '—')}
          ${stat('Days left', String(p.daysLeft))}
        </div>
      </section>

      ${entriesCard(checkins, topups, startBalance)}
    </div>`;

  main.querySelector('[data-act="checkin"]').addEventListener('click', () => checkIn(ctx));
  main.querySelector('[data-act="topup"]').addEventListener('click', () => addTopup(ctx));
  bindEntries(main);
}

function stat(k, v) {
  return `<div class="stat"><div class="k">${esc(k)}</div><div class="v num">${esc(v)}</div></div>`;
}

function entriesCard(checkins, topups, startBalance) {
  const entries = [
    ...checkins.map((c) => ({ ...c, kind: 'checkin' })),
    ...topups.map((t) => ({ ...t, kind: 'topup' })),
  ].sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));

  const s = state.getSettings();
  const rows = entries.map((e) => {
    const who = s.initials[e.by] || '';
    let badge;
    let title;
    let amount;
    if (e.kind === 'topup') {
      badge = '+';
      title = `${esc(s.names[e.person] || '?')} added money${e.note ? ': ' + esc(e.note) : ''}`;
      amount = `+${formatCents(e.amount)}`;
    } else if (e.balance != null) {
      badge = '✓';
      title = `Balance ${formatCents(e.balance)}`;
      amount = `${formatCents(checkinSpent(e, startBalance, topups))} spent`;
    } else {
      badge = '✓';
      title = 'Check-in (old style): spent so far';
      amount = formatCents(e.spent);
    }
    return `<li class="row">
      <button class="row-btn" data-edit="${esc(e.id)}">
        <span class="badge">${badge}</span>
        <span class="grow"><span class="title">${title}</span><br><span class="sub">${esc(shortDateLabel(e.date))}${who ? ' · entered by ' + esc(who) : ''}</span></span>
        <span class="amount">${amount}</span>
      </button></li>`;
  }).join('');

  return `<section class="card">
    <h2>This month's entries</h2>
    ${rows ? `<ul class="list">${rows}</ul>` : '<p class="empty">Nothing yet. Check in with the Revolut balance once a week.</p>'}
  </section>`;
}

function bindEntries(main) {
  main.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = state.allRecords()[btn.dataset.edit];
      if (rec.type === 'topup') addTopup(null, rec);
      else checkIn(null, rec);
    });
  });
}

/** Default date for a new entry: today if viewing this month, else the month's last day. */
function defaultDate(ctx) {
  if (!ctx || ctx.todayKey.slice(0, 7) === ctx.month) return ctx ? ctx.todayKey : dateKeyOf(new Date());
  return ctx.month < ctx.todayKey.slice(0, 7) ? `${ctx.month}-${daysInMonth(ctx.month)}` : `${ctx.month}-01`;
}

export async function checkIn(ctx, existing = null) {
  const month = existing ? existing.month : ctx.month;
  const start = state.planFor(month).startBalance;
  const values = await openForm({
    title: existing ? 'Edit check-in' : 'Check in balance',
    fields: [
      { name: 'balance', label: 'Revolut balance now', type: 'money', required: true, allowNegative: true,
        value: existing ? (existing.balance ?? (start - (existing.spent || 0))) : null, autofocus: true,
        hint: `${monthLabel(month)} started with ${formatCents(start)}. Money added with "Add money" is not counted as spending.` },
      { name: 'date', label: 'Date', type: 'date', required: true, value: existing?.date ?? defaultDate(ctx) },
    ],
    deleteLabel: existing ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    state.remove(existing.id);
    toast('Check-in deleted', { label: 'Undo', run: state.undo });
    return;
  }
  state.put({
    id: existing?.id || state.newId('ci'), type: 'checkin',
    month: values.date.slice(0, 7), date: values.date, balance: values.balance, spent: null,
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
  toast(existing ? 'Check-in updated' : 'Checked in');
}

export async function addTopup(ctx, existing = null) {
  const values = await openForm({
    title: existing ? 'Edit added money' : 'Add money to the wallet',
    fields: [
      { name: 'amount', label: 'Amount added', type: 'money', required: true, value: existing?.amount ?? null, autofocus: true,
        hint: 'Personal money put into the shared account. It raises the balance but not the agreed budget.' },
      { name: 'person', label: 'Added by', type: 'choice', options: payerOptions().filter((o) => o.value !== 'wallet'),
        value: existing?.person ?? state.getDevice().me },
      { name: 'note', label: 'Note (optional)', type: 'text', value: existing?.note ?? '' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: existing?.date ?? defaultDate(ctx) },
    ],
    deleteLabel: existing ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    state.remove(existing.id);
    toast('Deleted', { label: 'Undo', run: state.undo });
    return;
  }
  if (values.amount <= 0) {
    toast('Please enter an amount above 0');
    return;
  }
  state.put({
    id: existing?.id || state.newId('tu'), type: 'topup',
    month: values.date.slice(0, 7), date: values.date, amount: values.amount,
    person: values.person, note: values.note,
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
  toast(existing ? 'Updated' : `Added ${formatCents(values.amount)}`);
}
