// Small DOM helpers shared by the screens.

import { getSettings } from '../state.js';

/** Make text safe to put inside HTML (names and notes are typed by people). */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Coloured initials badge for a payer: 't', 'k' or 'wallet'. */
export function payerBadge(payer) {
  const s = getSettings();
  const label = payer === 'wallet' ? 'W' : s.initials[payer] || '?';
  const title = payerName(payer);
  return `<span class="badge ${esc(payer)}" title="Paid by ${esc(title)}">${esc(label)}</span>`;
}

export function payerName(payer) {
  if (payer === 'wallet') return 'shared wallet';
  return getSettings().names[payer] || payer;
}

/** Options for the "who pays" choice in forms. */
export function payerOptions() {
  const s = getSettings();
  return [
    { value: 't', label: s.names.t },
    { value: 'k', label: s.names.k },
    { value: 'wallet', label: 'Wallet' },
  ];
}

let toastTimer = null;
/** Short message at the bottom; optional action button (e.g. Undo). */
export function toast(message, action, ms = null) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.run();
      el.classList.remove('show');
    });
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || (action ? 5000 : 2500));
}
