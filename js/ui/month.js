// Month screen: wallet budget, fixed costs, big-cost shares and
// how much each person deposits into the shared wallet.

import * as state from '../state.js';
import { monthPlan, spreadSharesForMonth } from '../lib/budget.js';
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

  const m = state.getMonth(month) || { walletBudget: 0 };
  const fixed = state.fixedFor(month);
  const shares = spreadSharesForMonth(state.getSpreads(), month);
  const s = state.getSettings();
  const plan = monthPlan({ fixed, spreadShares: shares, walletBudget: m.walletBudget || 0, split: s.split });
  const paidCount = fixed.filter((f) => f.paid).length;

  main.innerHTML = `
    <div class="stack">
      <section class="card" aria-label="Deposits">
        <h2>Deposits into the wallet</h2>
        <div class="deposits">
          ${depositBox('t', s, plan)}
          ${depositBox('k', s, plan)}
        </div>
        <p class="muted small" style="margin:10px 0 0">Each pays their half of the household total, minus the costs they already pay from their own account.</p>
      </section>

      <section class="card">
        <div class="inline-field">
          <label for="wallet-budget">Wallet budget for everyday spending</label>
          <input id="wallet-budget" class="money" inputmode="decimal" autocomplete="off" value="${esc(centsToInput(m.walletBudget || 0))}">
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
          <tr><td>Fixed costs</td><td>${formatCents(plan.fixedTotal)}</td></tr>
          ${plan.spreadTotal ? `<tr><td>Big costs (this month's share)</td><td>${formatCents(plan.spreadTotal)}</td></tr>` : ''}
          <tr><td>Wallet budget</td><td>${formatCents(plan.walletBudget)}</td></tr>
          <tr class="total"><td>Household total</td><td>${formatCents(plan.householdTotal)}</td></tr>
          <tr><td>Half each (${esc(s.initials.t)} / ${esc(s.initials.k)})</td><td>${formatCents(plan.share.t)} / ${formatCents(plan.share.k)}</td></tr>
          <tr><td>Paid from own account</td><td>${formatCents(plan.paid.t)} / ${formatCents(plan.paid.k)}</td></tr>
          ${plan.walletPaidCosts ? `<tr><td>Costs paid from the wallet</td><td>${formatCents(plan.walletPaidCosts)}</td></tr>` : ''}
          <tr class="total"><td>Into the wallet</td><td>${formatCents(plan.walletIn)}</td></tr>
        </table>
      </section>
    </div>`;

  const budgetInput = main.querySelector('#wallet-budget');
  const saveBudget = () => {
    const cents = parseCents(budgetInput.value);
    if (cents === null || cents < 0) {
      budgetInput.value = centsToInput(m.walletBudget || 0);
      toast('Please enter a number, e.g. 950');
      return;
    }
    if (cents !== (m.walletBudget || 0)) {
      state.put({ id: `month:${month}`, type: 'month', month, walletBudget: cents });
      toast('Wallet budget saved');
    }
  };
  budgetInput.addEventListener('change', saveBudget);
  budgetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') budgetInput.blur();
  });

  main.querySelector('[data-act="add-fixed"]').addEventListener('click', () => editFixed(ctx));
  main.querySelectorAll('[data-paid]').forEach((box) => {
    box.addEventListener('change', () => state.put({ id: box.dataset.paid, paid: box.checked }));
  });
  main.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => editFixed(ctx, state.allRecords()[btn.dataset.edit]));
  });
}

function depositBox(p, s, plan) {
  const v = plan.deposit[p];
  return `<div class="deposit ${p}" data-testid="deposit-${p}">
    <div class="who">${esc(s.names[p])} <span class="muted small">${esc(s.initials[p])}</span></div>
    <div class="v num">${formatCents(Math.abs(v))}</div>
    <div class="muted small">${v >= 0 ? 'to deposit' : 'paid more than their share: gets this back'}</div>
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
          ? `Copy the wallet budget and fixed costs from ${esc(monthLabel(prev))}. Everything starts as unpaid, and you can change any amount afterwards.`
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
