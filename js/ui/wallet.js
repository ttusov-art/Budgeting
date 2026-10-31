// Wallet screen: how the everyday spending is going this month.
// Weekly check-ins (balance left in the wallet) plus optional single purchases.

import * as state from '../state.js';
import { spentSoFar, walletPace, checkinSpent } from '../lib/budget.js';
import { formatCents, formatCentsWhole } from '../lib/money.js';
import { dateKeyOf, shortDateLabel, monthLabel, daysInMonth } from '../lib/months.js';
import { esc, toast } from './dom.js';
import { openForm } from './form.js';

export function render(main, ctx) {
  const { month, todayKey } = ctx;
  const { m, startBalance } = state.planFor(month);
  const budget = m.walletBudget || 0;
  const checkins = state.checkinsFor(month);
  const purchases = state.purchasesFor(month);
  const { spent, lastCheckin, purchasesSince } = spentSoFar(checkins, purchases, startBalance);

  if (!budget) {
    main.innerHTML = `
      <div class="stack">
        <section class="card">
          <h2>No wallet budget for ${esc(monthLabel(month))} yet</h2>
          <p class="muted">Set up the month first: the wallet budget and the fixed costs. It takes a minute,
          and next month you can copy it.</p>
          <a class="btn primary" href="#month">Set up the month</a>
        </section>
        ${entriesCard(checkins, purchases, startBalance)}
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
  else if (p.aheadBy >= 0) paceText = `${formatCents(p.aheadBy)} under plan`;
  else paceText = `${formatCents(-p.aheadBy)} over plan`;
  const pacePct = p.elapsed > 0 ? `${(p.pace * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % of the planned pace so far` : '';

  const lastText = lastCheckin
    ? `Last check-in ${shortDateLabel(lastCheckin.date)}: `
      + (lastCheckin.balance != null ? `${formatCents(lastCheckin.balance)} in the wallet` : `${formatCents(lastCheckin.spent)} spent`)
      + (purchasesSince ? ` + ${purchasesSince} purchase${purchasesSince > 1 ? 's' : ''} since` : '')
    : purchases.length ? `${purchases.length} purchase${purchases.length > 1 ? 's' : ''} logged, no check-in yet` : 'No check-in yet this month';

  main.innerHTML = `
    <div class="stack">
      <section class="card hero" aria-label="Wallet status">
        <div class="label">Left in the wallet</div>
        <div class="big num ${p.remaining < 0 ? 'negative' : ''}" data-testid="remaining">${formatCents(p.remaining)}</div>
        <div class="muted">spent <span class="num">${formatCents(spent)}</span> of <span class="num">${formatCents(budget)}</span></div>
        <div class="meter" role="img" aria-label="Spent ${Math.round(fillPct)} % of the budget; plan for today is ${Math.round(markPct)} %">
          <div class="meter-fill ${level === 'good' ? '' : level}" style="width:${fillPct}%"></div>
          <div class="meter-mark" style="left:calc(${markPct}% - 1px)" title="Plan for today"></div>
        </div>
        <div class="meter-legend"><span>Day ${p.elapsed} of ${p.days}</span><span>▮ plan for today: ${formatCentsWhole(p.expected)}</span></div>
        <div class="pace-pill ${level}" data-testid="pace"><span>${esc(paceText)}</span>${pacePct ? `<span class="pace-sub">${esc(pacePct)}</span>` : ''}</div>
      </section>

      <div class="btn-row grow">
        <button class="btn primary" data-act="checkin" title="Check in (C)">Check in <kbd>C</kbd></button>
        <button class="btn" data-act="purchase" title="Add purchase (N)">Add purchase <kbd>N</kbd></button>
      </div>
      <p class="muted small" style="margin-top:8px">${esc(lastText)}</p>

      <section class="card">
        <h2>Budget vs. actual</h2>
        <div class="stats">
          ${stat('Daily budget', formatCentsWhole(p.dailyBudget))}
          ${stat('Actual per day', formatCentsWhole(p.actualDaily))}
          ${stat('Can spend per day', p.daysLeft > 0 ? formatCentsWhole(p.perDayLeft) : '—')}
          ${stat('Weekly budget', formatCentsWhole(p.weeklyBudget))}
          ${stat('Actual per week', formatCentsWhole(p.actualWeekly))}
          ${stat('Days left', String(p.daysLeft))}
        </div>
      </section>

      ${entriesCard(checkins, purchases, startBalance)}
    </div>`;

  main.querySelector('[data-act="checkin"]').addEventListener('click', () => checkIn(ctx));
  main.querySelector('[data-act="purchase"]').addEventListener('click', () => addPurchase(ctx));
  bindEntries(main);
}

function stat(k, v) {
  return `<div class="stat"><div class="k">${esc(k)}</div><div class="v num">${esc(v)}</div></div>`;
}

function entriesCard(checkins, purchases, startBalance) {
  const entries = [
    ...checkins.map((c) => ({ ...c, kind: 'checkin' })),
    ...purchases.map((p) => ({ ...p, kind: 'purchase' })),
  ].sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));

  const s = state.getSettings();
  const rows = entries.map((e) => {
    const who = s.initials[e.by] || '';
    let title;
    let amount;
    if (e.kind === 'checkin' && e.balance != null) {
      title = `Check-in: ${formatCents(e.balance)} in the wallet`;
      amount = `${formatCents(checkinSpent(e, startBalance))} spent`;
    } else if (e.kind === 'checkin') {
      title = 'Check-in: spent so far';
      amount = formatCents(e.spent);
    } else {
      title = esc(e.note || 'Purchase');
      amount = formatCents(e.amount);
    }
    return `<li class="row">
      <button class="row-btn" data-edit="${esc(e.id)}" data-kind="${e.kind}">
        <span class="badge">${e.kind === 'checkin' ? '✓' : '+'}</span>
        <span class="grow"><span class="title">${title}</span><br><span class="sub">${esc(shortDateLabel(e.date))}${who ? ' · ' + esc(who) : ''}</span></span>
        <span class="amount">${amount}</span>
      </button></li>`;
  }).join('');

  return `<section class="card">
    <h2>This month's entries</h2>
    ${rows ? `<ul class="list">${rows}</ul>` : '<p class="empty">Nothing yet. Check in once a week, or add purchases as you go.</p>'}
  </section>`;
}

function bindEntries(main) {
  main.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = state.allRecords()[btn.dataset.edit];
      if (rec.type === 'checkin') checkIn(null, rec);
      else addPurchase(null, rec);
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
    title: existing ? 'Edit check-in' : 'Weekly check-in',
    fields: [
      { name: 'balance', label: 'Balance left in the wallet', type: 'money', required: true, allowNegative: true,
        value: existing ? (existing.balance ?? (start - (existing.spent || 0))) : null, autofocus: true,
        hint: `The wallet started ${monthLabel(month)} with ${formatCents(start)}. The difference counts as spent.` },
      { name: 'date', label: 'As of', type: 'date', required: true, value: existing?.date ?? defaultDate(ctx) },
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

export async function addPurchase(ctx, existing = null) {
  const values = await openForm({
    title: existing ? 'Edit purchase' : 'Add purchase',
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, value: existing?.amount ?? null, autofocus: true },
      { name: 'note', label: 'What for (optional)', type: 'text', value: existing?.note ?? '', placeholder: 'Groceries, market…' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: existing?.date ?? defaultDate(ctx) },
    ],
    deleteLabel: existing ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    state.remove(existing.id);
    toast('Purchase deleted', { label: 'Undo', run: state.undo });
    return;
  }
  state.put({
    id: existing?.id || state.newId('pu'), type: 'purchase',
    month: values.date.slice(0, 7), date: values.date, amount: values.amount, note: values.note,
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
  toast(existing ? 'Purchase updated' : `Added ${formatCents(values.amount)}`);
}
