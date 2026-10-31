// A tiny vibration when a button is tapped (Android phones).
// It can be switched off per phone in Settings. Browsers without vibration
// (iPhone, computers) simply skip it.

import * as state from '../state.js';

// The shortest buzz most phones still notice. Below ~5 ms many motors don't move at all.
export const TAP_MS = 8;

// Everything that acts like a button.
const TAPPABLE = 'button, a.btn, .tabs a, .row-btn, .seg label, label.btn, summary';

export const canVibrate = () => typeof navigator.vibrate === 'function';

export function installHaptics() {
  if (!canVibrate()) return;
  // Capture phase: buzz before the button does its work (which may redraw the page).
  document.addEventListener('click', (e) => {
    if (state.getDevice().vibrate === false) return;
    const el = e.target.closest?.(TAPPABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    navigator.vibrate(TAP_MS);
  }, true);
}
