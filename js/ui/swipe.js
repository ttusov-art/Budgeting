// Swipe left / right on the page to move between screens (phones).
//
// A touch counts as a swipe only when it is clearly sideways and
// deliberate, so normal scrolling up and down never switches screens.

import { isFormOpen } from './form.js';

const MIN_DISTANCE = 40;   // px sideways before it counts
const MAX_TIME = 1000;     // ms; slower drags are probably reading/scrolling
const SIDEWAYS_RATIO = 1.2; // sideways movement must beat up/down movement

/**
 * installSwipe(element, { onLeft, onRight })
 * onLeft  = finger moved right-to-left (go to the next screen)
 * onRight = finger moved left-to-right (go to the previous screen)
 */
export function installSwipe(element, { onLeft, onRight }) {
  let start = null;

  element.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || isFormOpen() || startsOnControl(e.target)) {
      start = null;
      return;
    }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });

  element.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const quick = Date.now() - start.time <= MAX_TIME;
    start = null;
    if (!quick || Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SIDEWAYS_RATIO) return;
    if (dx < 0) onLeft();
    else onRight();
  }, { passive: true });

  element.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}

// Don't treat dragging inside an input (e.g. selecting text) as a swipe.
function startsOnControl(target) {
  return Boolean(target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
}
