// Swipe left / right on the page to move between screens (phones).
//
// The page follows your finger while you swipe, so you can see the swipe
// was noticed. When you let go:
//   - a real swipe with a screen on that side → the page slides out, the next one comes in
//   - a swipe at the first/last screen → the page bounces back off the edge
//   - too short or too slow → the page glides back into place
// Normal scrolling up and down never moves the page sideways.

import { isFormOpen } from './form.js';

const MIN_DISTANCE = 40;    // px sideways before it counts as a swipe
const MAX_TIME = 1000;      // ms; slower drags are probably reading/scrolling
const SIDEWAYS_RATIO = 1.2; // sideways movement must beat up/down movement
const DECIDE_AFTER = 10;    // px of movement before deciding "sideways or scrolling"

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * installSwipe(listenOn, { target, canGo, onLeft, onRight })
 *  target  = the element that moves with the finger (the page content)
 *  canGo(step) = is there a screen in that direction? (+1 next, −1 previous)
 *  onLeft  = finger moved right-to-left (go to the next screen)
 *  onRight = finger moved left-to-right (go to the previous screen)
 */
export function installSwipe(listenOn, { target, canGo, onLeft, onRight }) {
  let start = null;   // where and when the finger went down
  let sideways = null; // null = not decided yet, true = swiping, false = scrolling
  let offset = 0;     // how far the page is currently pulled sideways (px)

  listenOn.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || isFormOpen() || startsOnControl(e.target)) {
      start = null;
      return;
    }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, time: Date.now() };
    sideways = null;
    offset = 0;
  }, { passive: true });

  listenOn.addEventListener('touchmove', (e) => {
    if (!start || sideways === false) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (sideways === null) {
      if (Math.abs(dx) < DECIDE_AFTER && Math.abs(dy) < DECIDE_AFTER) return;
      sideways = Math.abs(dx) > Math.abs(dy) * SIDEWAYS_RATIO;
      if (!sideways) return;
    }
    // Follow the finger: freely towards a neighbouring screen,
    // with "rubber band" resistance towards an edge.
    const step = dx < 0 ? 1 : -1;
    offset = canGo(step) ? dx * 0.5 : Math.sign(dx) * Math.min(60, Math.abs(dx) * 0.25);
    if (!reducedMotion()) target.style.transform = `translateX(${offset}px)`;
  }, { passive: true });

  listenOn.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const quick = Date.now() - start.time <= MAX_TIME;
    const wasSideways = sideways;
    start = null;
    sideways = null;

    const isSwipe = quick && Math.abs(dx) >= MIN_DISTANCE && Math.abs(dx) >= Math.abs(dy) * SIDEWAYS_RATIO;
    if (!isSwipe) {
      if (wasSideways) settle(target, offset, 'cancel');
      return;
    }
    const step = dx < 0 ? 1 : -1;
    if (canGo(step)) {
      slideOut(target, offset, step, step > 0 ? onLeft : onRight);
    } else {
      settle(target, offset, 'bounce', -step);
    }
  }, { passive: true });

  listenOn.addEventListener('touchcancel', () => {
    if (start && sideways) settle(target, offset, 'cancel');
    start = null;
  }, { passive: true });
}

/** Slide the page out towards the side, then switch screens. */
function slideOut(target, from, step, go) {
  target.dataset.swipeFeedback = 'go';
  if (reducedMotion()) {
    target.style.transform = '';
    go();
    return;
  }
  const animation = target.animate([
    { transform: `translateX(${from}px)`, opacity: 1 },
    { transform: `translateX(${-step * 80}px)`, opacity: 0.2 },
  ], { duration: 120, easing: 'ease-in' });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    target.style.transform = '';
    go();
  };
  animation.finished.then(finish, finish);
  setTimeout(finish, 250); // safety net if the animation is interrupted
}

/**
 * Move the page back to its place.
 * 'bounce' = hit the first/last screen: overshoot towards the edge, then spring back.
 * 'cancel' = not a swipe after all: just glide back.
 */
function settle(target, from, kind, edgeDirection = 0) {
  target.dataset.swipeFeedback = kind;
  target.style.transform = '';
  if (reducedMotion()) return;
  const frames = kind === 'bounce'
    ? [
      { transform: `translateX(${from}px)` },
      { transform: `translateX(${edgeDirection * 36}px)`, offset: 0.35 },
      { transform: `translateX(${-edgeDirection * 8}px)`, offset: 0.7 },
      { transform: 'translateX(0)' },
    ]
    : [{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }];
  target.animate(frames, { duration: kind === 'bounce' ? 420 : 180, easing: 'ease-out' });
}

// Don't treat dragging inside an input (e.g. selecting text) as a swipe.
function startsOnControl(target) {
  return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
}
