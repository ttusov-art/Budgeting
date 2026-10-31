// Month screen: salaries, wallet budget, fixed costs, big-cost shares,
// each person's private money and deposit into the shared wallet.

import * as state from '../state.js';
import { formatCents, parseCents, centsToInput } from '../lib/money.js';
import { monthLabel } from '../lib/months.js';
import { esc, payerBadge, payerOptions, toast } from './dom.js';
import { openForm } from './form.js';

export function render(main, ctx) {
  const { month } = ctx;

  if (!state.monthIsSetUp(month)) {
    renderStart(main, month);
    return;
  }

  const { m, fixed, spreadShares: shares, plan, carry, startBalance } = state.planFor(month);
  const incomes = state.getIncomes(month);
  const s = state.getSettings();
  const paidCount = fixed.filter((f) => f.paid).length;

  main.innerHTML = `
    <div class="stack">
      ${resultCard(s, plan)}

      <section class="card">
        <h2>This month's money</h2>
        <div class="stack">
          ${moneyField('income-t', `${s.names.t}'s salary`, incomes.t)}
          ${moneyField('income-k', `${s.names.k}'s salary`, incomes.k)}
          ${moneyField('wallet-budget', 'Wallet budget for everyday spending', m.walletBudget)}
          ${carryField(carry)}
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Fixed costs <span class="muted small">${paidCount}/${fixed.length} paid</span></h2>
          <button class="btn small-btn" data-act="add-fixed" title="Add fixed cost (F)">+ Add <kbd>F</kbd></button>
        </div>
        ${fixed.length ? `<ul class="list">${fixed.map(fixedRow).join('')}</ul>` : '<p class="empty">No fixed costs yet. Add rent, phone, electricity…</p>'}
      </section>

      ${shares.length ? `
      <section class="card">
        <div class="card-head"><h2>Big costs this month</h2><a class="small" href="#big">Manage</a></div>
        <ul class="list">${shares.map((sh) => `
          <li class="row">${payerBadge(sh.payer)}
            <span class="grow"><span class="title">${esc(sh.name)}</span><br><span class="sub">${esc(sh.note)}</span></span>
            <span class="amount">${formatCents(sh.amount)}</span></li>`).join('')}
        </ul>
      </section>` : ''}

      <section class="card">
        <h2>Summary</h2>
        <table class="sumtable">
          <tr><td>Salaries together</td><td>${formatCents(plan.incomeTotal)}</td></tr>
          <tr><td>− Fixed costs</td><td>${formatCents(plan.fixedTotal)}</td></tr>
          ${plan.spreadTotal ? `<tr><td>− Big costs (this month's share)</td><td>${formatCents(plan.spreadTotal)}</td></tr>` : ''}
          <tr><td>− Wallet budget</td><td>${formatCents(plan.walletBudget)}</td></tr>
          <tr class="total"><td>Leftover</td><td>${formatCents(plan.leftover)}</td></tr>
          <tr><td>Private money each (${esc(s.initials.t)} / ${esc(s.initials.k)})</td><td>${formatCents(plan.privateMoney.t)} / ${formatCents(plan.privateMoney.k)}</td></tr>
        </table>
        <table class="sumtable" style="margin-top:14px">
          <tr><td></td><td>${esc(s.initials.t)} / ${esc(s.initials.k)}</td></tr>
          <tr><td>Salary</td><td>${formatCents(plan.income.t)} / ${formatCents(plan.income.k)}</td></tr>
          <tr><td>− Paid from own account</td><td>${formatCents(plan.paid.t)} / ${formatCents(plan.paid.k)}</td></tr>
          <tr><td>− Private money</td><td>${formatCents(plan.privateMoney.t)} / ${formatCents(plan.privateMoney.k)}</td></tr>
          <tr class="total"><td>Into the wallet</td><td>${formatCents(plan.deposit.t)} / ${formatCents(plan.deposit.k)}</td></tr>
        </table>
        <p class="muted small" style="margin:10px 0 0" data-testid="wallet-start">The wallet starts the month with ${formatCents(startBalance)}${startBalance !== plan.walletBudget ? ' (deposits + carry-over − costs paid from the wallet)' : ''}. Check-ins compare the balance with this.</p>
      </section>
    </div>`;

  // Money fields save when you leave them (or press Enter).
  bindMoney(main, '#wallet-budget', m.walletBudget, (cents) => {
    state.put({ id: `month:${month}`, type: 'month', month, walletBudget: cents });
  });
  // Empty field = automatic carry-over from last month's final check-in.
  bindMoney(main, '#carry-over', carry.overridden ? carry.amount : null, (cents) => {
    state.put({ id: `month:${month}`, type: 'month', month, carryOver: cents });
  }, null);
  for (const p of ['t', 'k']) {
    bindMoney(main, `#income-${p}`, incomes[p], (cents) => state.setIncome(month, p, cents));
  }

  main.querySelector('[data-act="add-fixed"]').addEventListener('click', () => editFixed(ctx));
  main.querySelectorAll('[data-paid]').forEach((box) => {
    box.addEventListener('change', () => state.put({ id: box.dataset.paid, paid: box.checked }));
  });
  main.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => editFixed(ctx, state.allRecords()[btn.dataset.edit]));
  });
}

function moneyField(id, label, cents) {
  return `<div class="inline-field">
    <label for="${id}">${esc(label)}</label>
    <input id="${id}" class="money" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(cents ? centsToInput(cents) : '')}">
  </div>`;
}

/**
 * Save a money field when you leave it. With emptyMeans = null, an empty
 * field saves null (used for "automatic" carry-over); otherwise it saves 0.
 */
function bindMoney(main, selector, oldCents, save, emptyMeans = 0) {
  const input = main.querySelector(selector);
  input.addEventListener('change', () => {
    const empty = input.value.trim() === '';
    const cents = empty ? emptyMeans : parseCents(input.value);
    if (!empty && (cents === null || cents < 0)) {
      input.value = oldCents ? centsToInput(oldCents) : '';
      toast('Please enter a number, e.g. 2450,50');
      return;
    }
    const before = oldCents === undefined ? emptyMeans : oldCents;
    if (cents !== before && !(emptyMeans === 0 && !cents && !before)) {
      save(cents);
      toast('Saved');
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
}

function carryField(carry) {
  const autoText = carry.auto
    ? `Automatic: ${formatCents(carry.auto.balance)} from the last check-in of ${monthLabel(carry.prevKey)} (${carry.auto.date.slice(8)}.${carry.auto.date.slice(5, 7)}.).`
    : `Automatic: nothing, no check-in in ${monthLabel(carry.prevKey)}.`;
  return `<div class="inline-field">
    <label for="carry-over">Carried over from last month</label>
    <input id="carry-over" class="money" inputmode="decimal" autocomplete="off"
      placeholder="${esc(carry.auto ? centsToInput(carry.auto.balance) : '0,00')}"
      value="${esc(carry.overridden ? centsToInput(carry.amount) : '')}">
  </div>
  <p class="muted small" style="margin:-6px 0 0" data-testid="carry-hint">${esc(autoText)}
    ${carry.overridden ? 'You typed your own amount; empty the field to go back to automatic.' : 'Type an amount only to override it.'}
    It adds to the balance, not to the budget.</p>`;
}

function resultCard(s, plan) {
  if (!plan.hasIncomes) {
    return `<section class="card" aria-label="Result">
      <h2>Private money and deposits</h2>
      <p class="muted" style="margin:0">Enter both salaries below to see what stays with each of you and what goes into the wallet.</p>
    </section>`;
  }
  const warn = plan.leftover < 0
    ? `<p class="form-error" style="margin:10px 0 0">Costs and wallet are ${formatCents(-plan.leftover)} more than both salaries together.</p>` : '';
  return `<section class="card" aria-label="Result">
    <h2>Private money each <span class="num" data-testid="private">${formatCents(plan.privateMoney.t)}</span></h2>
    <div class="deposits">
      ${depositBox('t', s, plan)}
      ${depositBox('k', s, plan)}
    </div>
    <p class="muted small" style="margin:10px 0 0">The leftover of both salaries, after costs and the wallet, is split evenly.
      Deposit = salary − own-account costs − private half.</p>
    ${warn}
  </section>`;
}

function depositBox(p, s, plan) {
  const v = plan.deposit[p];
  return `<div class="deposit ${p}" data-testid="deposit-${p}">
    <div class="who">${esc(s.names[p])} <span class="muted small">${esc(s.initials[p])}</span></div>
    <div class="v num">${formatCents(Math.abs(v))}</div>
    <div class="muted small">${v >= 0 ? 'into the wallet' : 'gets back from the wallet'}</div>
  </div>`;
}

function fixedRow(f) {
  return `<li class="row ${f.paid ? 'is-paid' : ''}">
    <input type="checkbox" class="check" data-paid="${esc(f.id)}" ${f.paid ? 'checked' : ''} aria-label="${esc(f.name)} paid">
    <button class="row-btn" data-edit="${esc(f.id)}" aria-label="Edit ${esc(f.name)}">
      ${payerBadge(f.payer)}
      <span class="grow"><span class="title">${esc(f.name)}</span></span>
      <span class="amount">${formatCents(f.amount)}</span>
    </button>
  </li>`;
}

function renderStart(main, month) {
  const prev = state.previousSetUpMonth(month);
  main.innerHTML = `
    <div class="stack">
      <section class="card">
        <h2>Start ${esc(monthLabel(month))}</h2>
        <p class="muted">${prev
          ? `Copy the salaries, wallet budget and fixed costs from ${esc(monthLabel(prev))}. Everything starts as unpaid, and you can change any amount afterwards.`
          : 'This is your first month. Start empty and add the wallet budget and fixed costs.'}</p>
        <div class="btn-row">
          ${prev ? `<button class="btn primary" data-act="copy">Copy from ${esc(monthLabel(prev))}</button>` : ''}
          <button class="btn ${prev ? '' : 'primary'}" data-act="empty">Start empty</button>
        </div>
      </section>
    </div>`;
  const copy = main.querySelector('[data-act="copy"]');
  if (copy) copy.addEventListener('click', () => {
    state.copyMonth(prev, month);
    toast(`Copied from ${monthLabel(prev)}`, { label: 'Undo', run: state.undo });
  });
  main.querySelector('[data-act="empty"]').addEventListener('click', () => {
    state.put({ id: `month:${month}`, type: 'month', month, walletBudget: 0 });
    setTimeout(() => document.getElementById('wallet-budget')?.focus(), 0);
  });
}

export async function editFixed(ctx, existing = null) {
  const month = existing ? existing.month : ctx.month;
  if (!existing && !state.getMonth(month)) {
    state.put({ id: `month:${month}`, type: 'month', month, walletBudget: 0 });
  }
  const values = await openForm({
    title: existing ? 'Edit fixed cost' : 'Add fixed cost',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'Rent', autofocus: true },
      { name: 'amount', label: 'Amount per month', type: 'money', required: true, value: existing?.amount ?? null },
      { name: 'payer', label: 'Paid from', type: 'choice', options: payerOptions(), value: existing?.payer ?? state.getDevice().me },
      ...(existing ? [{ name: 'paid', label: 'Paid this month', type: 'checkbox', value: existing.paid }] : []),
    ],
    deleteLabel: existing ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    state.remove(existing.id);
    toast(`${existing.name} deleted`, { label: 'Undo', run: state.undo });
    return;
  }
  const order = existing ? existing.order : state.fixedFor(month).length;
  state.put({
    id: existing?.id || state.newId('fx'), type: 'fixed', month,
    name: values.name, amount: values.amount, payer: values.payer,
    paid: existing ? values.paid : false, order,
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
  toast(existing ? 'Saved' : `${values.name} added`);
}
