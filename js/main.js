// Starts the app and wires the modules together. Little logic of its own.

import * as state from './state.js';
import * as sync from './sync.js';
import { requestPersistence } from './storage.js';
import { APP_VERSION } from './version.js';
import { monthKeyOf, dateKeyOf, addMonths, monthLabel } from './lib/months.js';
import { toast, esc } from './ui/dom.js';
import { openForm, isFormOpen } from './ui/form.js';
import { installShortcuts, SHORTCUTS } from './ui/shortcuts.js';
import * as walletView from './ui/wallet.js';
import * as monthView from './ui/month.js';
import * as bigView from './ui/bigcosts.js';
import * as settingsView from './ui/settings.js';
import * as purchasesView from './ui/purchases.js';
import { toSort } from './purchases.js';
import { installSwipe } from './ui/swipe.js';

// Order = tab order = swipe order.
const VIEWS = { wallet: walletView, buys: purchasesView, month: monthView, big: bigView, settings: settingsView };

const main = document.getElementById('main');
let currentMonth = monthKeyOf(new Date());

function currentView() {
  const name = location.hash.replace('#', '');
  return VIEWS[name] ? name : 'wallet';
}

function ctx() {
  return { month: currentMonth, todayKey: dateKeyOf(new Date()) };
}

// ---------- rendering ----------

let pendingRender = false;

function render() {
  // Don't redraw under someone who is typing in a field on the page;
  // redraw as soon as they leave the field instead.
  const active = document.activeElement;
  if (active && main.contains(active) && (active.tagName === 'INPUT') && active.type !== 'checkbox' && active.type !== 'radio') {
    pendingRender = true;
    return;
  }
  pendingRender = false;

  const view = currentView();
  document.getElementById('month-title').textContent = monthLabel(currentMonth);
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // Month navigation means nothing on the Settings screen.
  document.querySelector('.month-nav').style.visibility = ['settings', 'buys'].includes(view) ? 'hidden' : 'visible';

  // Badge on the Purchases tab: how many imported purchases still need sorting.
  const waiting = toSort().length;
  const badge = document.getElementById('buys-badge');
  badge.hidden = waiting === 0;
  badge.textContent = waiting > 99 ? '99+' : String(waiting);

  VIEWS[view].render(main, ctx());
}

main.addEventListener('focusout', () => {
  if (pendingRender) setTimeout(render, 0);
});

function setMonth(key) {
  currentMonth = key;
  render();
}

// ---------- sync status chip ----------

function renderSyncChip(status) {
  const chip = document.getElementById('sync-chip');
  const pending = state.pendingCount();
  let text;
  switch (status.kind) {
    case 'off': text = 'Not synced'; break;
    case 'syncing': text = 'Syncing…'; break;
    case 'offline': text = pending ? `Offline · ${pending} waiting` : 'Offline'; break;
    case 'error': text = 'Sync failed'; break;
    case 'ok': text = status.at ? `Synced ${new Date(status.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Synced'; break;
    default: text = sync.isConfigured() ? 'Sync' : 'Not synced';
  }
  chip.textContent = text;
  chip.dataset.kind = sync.isConfigured() ? status.kind : 'off';
  chip.title = status.kind === 'error' ? `Sync failed: ${status.message} (Ctrl+S to retry)` : 'Sync now (Ctrl+S)';
}

// ---------- actions (used by buttons and shortcuts) ----------

function showHelp() {
  openForm({
    title: 'Keyboard shortcuts',
    fields: [],
    submitLabel: 'Close',
    extraHtml: `<dl class="shortcut-list">${SHORTCUTS.map((sc) =>
      `<dt>${sc.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</dt><dd>${esc(sc.label)}</dd>`).join('')}</dl>`,
  });
}

function doUndo() {
  if (state.undo()) toast('Undone');
  else toast('Nothing to undo');
}

function doRedo() {
  if (state.redo()) toast('Redone');
  else toast('Nothing to redo');
}

function doSync() {
  if (!sync.isConfigured()) {
    toast('Sync is not set up yet (Settings)');
    return;
  }
  sync.syncNow().then((ok) => toast(ok ? 'Synced' : 'Sync failed, will retry'));
}

const actions = {
  'view:wallet': () => { location.hash = 'wallet'; },
  'view:month': () => { location.hash = 'month'; },
  'view:big': () => { location.hash = 'big'; },
  'view:settings': () => { location.hash = 'settings'; },
  'view:buys': () => { location.hash = 'buys'; },
  import: () => { if (currentView() !== 'buys') location.hash = 'buys'; setTimeout(purchasesView.openImport, 0); },
  prevMonth: () => setMonth(addMonths(currentMonth, -1)),
  nextMonth: () => setMonth(addMonths(currentMonth, 1)),
  today: () => setMonth(monthKeyOf(new Date())),
  checkin: () => walletView.checkIn(ctx()),
  topup: () => walletView.addTopup(ctx()),
  new: () => { if (currentView() === 'big') bigView.editSpread(ctx()); },
  fixed: () => { location.hash = 'month'; monthView.editFixed(ctx()); },
  help: showHelp,
  undo: doUndo,
  redo: doRedo,
  sync: doSync,
};

// ---------- new version check ----------

async function checkForUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version && version > APP_VERSION) document.getElementById('update-banner').hidden = false;
  } catch {
    // Offline: try again later.
  }
}

/**
 * Reload with the newest files: let the new service worker take over,
 * throw away saved copies, then reload.
 */
async function reloadFresh() {
  const btn = document.getElementById('reload-btn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.installing || reg.waiting) {
          // Wait (max 3 s) until the new service worker controls this page.
          await new Promise((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
            setTimeout(resolve, 3000);
          });
        }
      }
    }
    if (window.caches) {
      for (const key of await caches.keys()) await caches.delete(key);
    }
  } catch {
    // Whatever happens, still reload.
  }
  location.reload();
}

// ---------- start ----------

document.getElementById('prev-month').addEventListener('click', actions.prevMonth);
document.getElementById('next-month').addEventListener('click', actions.nextMonth);
document.getElementById('month-title').addEventListener('click', actions.today);
document.getElementById('sync-chip').addEventListener('click', doSync);
document.getElementById('reload-btn').addEventListener('click', reloadFresh);

// Which way the next screen slides in ('left', 'right' or null).
let slideFrom = null;

window.addEventListener('hashchange', () => {
  render();
  if (slideFrom) {
    main.classList.remove('slide-from-left', 'slide-from-right');
    void main.offsetWidth; // restart the animation
    main.classList.add(`slide-from-${slideFrom}`);
    slideFrom = null;
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

/** Go to the screen `step` places away in tab order (+1 = next, −1 = previous). */
function stepView(step) {
  const names = Object.keys(VIEWS);
  const i = names.indexOf(currentView()) + step;
  if (i < 0 || i >= names.length) return; // already at the first/last screen
  slideFrom = step > 0 ? 'right' : 'left';
  location.hash = names[i];
}

function canStep(step) {
  const names = Object.keys(VIEWS);
  const i = names.indexOf(currentView()) + step;
  return i >= 0 && i < names.length;
}

installSwipe(document.body, {
  target: main,
  canGo: canStep,
  onLeft: () => stepView(1),
  onRight: () => stepView(-1),
});

let renderQueued = false;
state.subscribe(() => {
  // Several changes in one go (e.g. a sync) → one redraw.
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    if (!isFormOpen()) render();
    else pendingRender = true;
  });
  renderSyncChip(sync.getStatus());
  // Once there is data worth keeping, ask Chrome not to clear it.
  requestPersistence();
});
document.getElementById('form-dialog').addEventListener('close', () => {
  if (pendingRender) render();
});

sync.onStatus(renderSyncChip);
installShortcuts(actions);
render();
renderSyncChip(sync.getStatus());
sync.startAutoSync();

checkForUpdate();
setInterval(checkForUpdate, 30 * 60 * 1000);

// Service workers need a secure page: https (GitHub Pages) or localhost.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
