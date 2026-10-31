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

const VIEWS = { wallet: walletView, month: monthView, big: bigView, settings: settingsView };

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
  document.querySelector('.month-nav').style.visibility = view === 'settings' ? 'hidden' : 'visible';

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
  prevMonth: () => setMonth(addMonths(currentMonth, -1)),
  nextMonth: () => setMonth(addMonths(currentMonth, 1)),
  today: () => setMonth(monthKeyOf(new Date())),
  checkin: () => walletView.checkIn(ctx()),
  new: () => (currentView() === 'big' ? bigView.editSpread(ctx()) : walletView.addPurchase(ctx())),
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

// ---------- start ----------

document.getElementById('prev-month').addEventListener('click', actions.prevMonth);
document.getElementById('next-month').addEventListener('click', actions.nextMonth);
document.getElementById('month-title').addEventListener('click', actions.today);
document.getElementById('sync-chip').addEventListener('click', doSync);
document.getElementById('reload-btn').addEventListener('click', () => location.reload());

window.addEventListener('hashchange', () => {
  render();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
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

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
