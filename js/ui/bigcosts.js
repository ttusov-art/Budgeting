// Big costs screen: expenses spread over several months.
//  - One-off: e.g. a 600 € washing machine spread over 3 months.
//  - Recurring bill: e.g. 360 € yearly insurance → 30 € set aside every month.

import * as state from '../state.js';
import { spreadSharesForMonth } from '../lib/budget.js';
import { formatCents } from '../lib/money.js';
import { monthLabel, addMonths } from '../lib/months.js';
import { esc, payerBadge, payerName, payerOptions, toast } from './dom.js';
import { openForm } from './form.js';

export function render(main, ctx) {
  const spreads = state.getSpreads();
  const shareNow = new Map(spreadSharesForMonth(spreads, ctx.month).map((s) => [s.id, s.amount]));

  const active = spreads.filter((s) => !isFinished(s, ctx.month));
  const finished = spreads.filter((s) => isFinished(s, ctx.month));

  main.innerHTML = `
    <div class="stack">
      <section class="card">
        <div class="card-head">
          <h2>Big costs</h2>
          <button class="btn small-btn" data-act="add" title="Add big cost (N)">+ Add <kbd>N</kbd></button>
        </div>
        <p class="muted small" style="margin-top:0">Spread a big purchase over a few months, or set aside a monthly share for
          yearly and quarterly bills. Each month's share is added to that month's household total.</p>
        ${active.length ? `<ul class="list">${active.map((s) => row(s, shareNow.get(s.id))).join('')}</ul>` : '<p class="empty">No big costs yet.</p>'}
      </section>
      ${finished.length ? `
      <section class="card">
        <h2>Finished</h2>
        <ul class="list">${finished.map((s) => row(s, null)).join('')}</ul>
      </section>` : ''}
    </div>`;

  main.querySelector('[data-act="add"]').addEventListener('click', () => editSpread(ctx));
  main.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => editSpread(ctx, state.allRecords()[btn.dataset.edit]));
  });
}

function lastMonth(s) {
  if (s.kind === 'oneoff') return addMonths(s.start, Math.max(1, s.months) - 1);
  return s.end || null;
}

function isFinished(s, month) {
  const last = lastMonth(s);
  return Boolean(last && last < month);
}

function row(s, shareThisMonth) {
  const last = lastMonth(s);
  const when = s.kind === 'oneoff'
    ? `${s.months} month${s.months > 1 ? 's' : ''}: ${monthLabel(s.start)} – ${monthLabel(last)}`
    : `${s.period === 12 ? 'Yearly' : s.period === 3 ? 'Quarterly' : `Every ${s.period} months`}, from ${monthLabel(s.start)}${last ? ` to ${monthLabel(last)}` : ''}`;
  const share = shareThisMonth != null ? `${formatCents(shareThisMonth)} this month` : '';
  return `<li class="row">
    <button class="row-btn" data-edit="${esc(s.id)}">
      ${payerBadge(s.payer)}
      <span class="grow"><span class="title">${esc(s.name)}</span><br>
        <span class="sub">${esc(when)} · paid by ${esc(payerName(s.payer))}</span></span>
      <span class="amount" style="text-align:right">${formatCents(s.amount)}<br><span class="sub">${esc(share)}</span></span>
    </button></li>`;
}

export async function editSpread(ctx, existing = null) {
  const values = await openForm({
    title: existing ? 'Edit big cost' : 'Add big cost',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'Washing machine, car insurance…', autofocus: true },
      { name: 'kind', label: 'Type', type: 'choice', value: existing?.kind ?? 'oneoff',
        options: [{ value: 'oneoff', label: 'One-off purchase' }, { value: 'periodic', label: 'Recurring bill' }] },
      { name: 'amount', label: 'Full amount', type: 'money', required: true, value: existing?.amount ?? null,
        hint: 'One-off: the total price. Recurring: the amount of one bill.' },
      { name: 'months', label: 'Spread over how many months', type: 'number', min: 1, value: existing?.months ?? 3, showIf: { field: 'kind', value: 'oneoff' } },
      { name: 'period', label: 'A bill every', type: 'choice', value: existing?.period ?? 12, showIf: { field: 'kind', value: 'periodic' },
        options: [{ value: 12, label: '12 months' }, { value: 6, label: '6 months' }, { value: 3, label: '3 months' }] },
      { name: 'start', label: 'First month', type: 'text', inputType: 'month', required: true, value: existing?.start ?? ctx.month,
        hint: 'Format 2026-10 if your browser shows a text field.' },
      { name: 'payer', label: 'Paid from', type: 'choice', options: payerOptions(), value: existing?.payer ?? state.getDevice().me },
      ...(existing?.kind === 'periodic' ? [{ name: 'stop', label: 'Stop setting aside after this month', type: 'checkbox', value: Boolean(existing.end) }] : []),
    ],
    deleteLabel: existing ? 'Delete' : null,
  });
  if (!values) return;
  if (values.__delete) {
    state.remove(existing.id);
    toast(`${existing.name} deleted`, { label: 'Undo', run: state.undo });
    return;
  }
  if (!/^\d{4}-\d{2}$/.test(values.start)) {
    toast('First month must look like 2026-10');
    return;
  }
  const rec = {
    id: existing?.id || state.newId('sp'), type: 'spread',
    name: values.name, kind: values.kind, amount: values.amount,
    months: Math.max(1, Math.round(values.months || 1)), period: values.period || 12,
    start: values.start, payer: values.payer,
    end: values.kind === 'periodic' && values.stop ? (existing?.end || ctx.month) : null,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  state.put(rec);
  toast(existing ? 'Saved' : `${values.name} added`);
}
