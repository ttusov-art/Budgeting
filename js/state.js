// The app's data model, and the only place that changes it.
//
// All data is a flat collection of "records" (see README for the list).
// UI modules read through the getters below and change data through
// put() / remove(); they never touch storage directly.

import * as storage from './storage.js';
import { mergeRecords } from './lib/merge.js';
import { addMonths } from './lib/months.js';

let records = storage.loadRecords();
let dirty = storage.loadDirty();
let device = storage.loadDevice();

const listeners = new Set();
const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 50;

// ---------- subscriptions ----------

/** Call fn() after every change. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

// ---------- ids and time ----------

export function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

let lastStamp = '';
/** ISO timestamp that always increases, even for two changes in the same millisecond. */
function stamp() {
  let now = new Date().toISOString();
  if (now <= lastStamp) now = new Date(Date.parse(lastStamp) + 1).toISOString();
  lastStamp = now;
  return now;
}

// ---------- device settings (not synced) ----------

export const getDevice = () => device;

export function setDevice(changes) {
  device = { ...device, ...changes };
  storage.saveDevice(device);
  notify();
}

// ---------- changing data ----------

function commit(list, { recordUndo = true } = {}) {
  const before = list.map((r) => records[r.id] || null);
  const after = [];
  for (const rec of list) {
    const full = { ...rec, updatedAt: stamp(), by: device.me };
    records[full.id] = full;
    dirty.add(full.id);
    after.push(full);
  }
  if (recordUndo) {
    undoStack.push({ before, after });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  storage.saveRecords(records);
  storage.saveDirty(dirty);
  notify();
  return after;
}

/** Create or update one or more records (merging with what is already there). */
export function put(...changes) {
  const list = changes.map((c) => ({ ...(records[c.id] || {}), ...c, deleted: false }));
  return commit(list);
}

/** Mark records as deleted (kept as a "tombstone" so the deletion can sync). */
export function remove(...ids) {
  const list = ids.filter((id) => records[id]).map((id) => ({ ...records[id], deleted: true }));
  return commit(list);
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo() {
  const step = undoStack.pop();
  if (!step) return false;
  // Restoring an old version is itself a new change, so it syncs normally.
  const list = step.before.map((old, i) => old ? { ...old } : { ...step.after[i], deleted: true });
  commit(list, { recordUndo: false });
  redoStack.push(step);
  return true;
}

export function redo() {
  const step = redoStack.pop();
  if (!step) return false;
  commit(step.after.map((r) => ({ ...r })), { recordUndo: false });
  undoStack.push(step);
  return true;
}

// ---------- used by sync.js ----------

export const getDirtyRecords = () => [...dirty].map((id) => records[id]).filter(Boolean);

/** Records arrived from the Sheet. `sent` are the records we just pushed. */
export function applyRemote(incoming, sent) {
  const result = mergeRecords(records, incoming);
  records = result.records;
  // A sent record is no longer dirty unless it was changed again meanwhile.
  for (const s of sent) {
    if (records[s.id] && records[s.id].updatedAt === s.updatedAt) dirty.delete(s.id);
  }
  storage.saveRecords(records);
  storage.saveDirty(dirty);
  if (result.changedIds.length) notify();
  return result.changedIds.length;
}

export const pendingCount = () => dirty.size;

/** Records from a backup file: merged like a sync, and marked to be sent. */
export function importRecords(list) {
  const result = mergeRecords(records, list);
  records = result.records;
  for (const id of result.changedIds) dirty.add(id);
  storage.saveRecords(records);
  storage.saveDirty(dirty);
  notify();
  return result.changedIds.length;
}

export const allRecords = () => records;

/** Forget everything on this device (data on the Sheet is untouched). */
export function resetDevice() {
  storage.clearDevice();
  records = {};
  dirty = new Set();
  device = storage.loadDevice();
  undoStack.length = 0;
  redoStack.length = 0;
  notify();
}

// ---------- reading data ----------

const live = (type) => Object.values(records).filter((r) => r.type === type && !r.deleted);

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || '').localeCompare(b.createdAt || '');
const byDate = (a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || ''));

export function getSettings() {
  const s = records.settings && !records.settings.deleted ? records.settings : {};
  return {
    names: { t: 'Tõnis', k: 'Kristiina', ...(s.names || {}) },
    initials: { t: 'TT', k: 'KM', ...(s.initials || {}) },
  };
}

export function saveSettings(changes) {
  const current = records.settings && !records.settings.deleted ? records.settings : { id: 'settings', type: 'settings' };
  put({ ...current, ...changes });
}

export function getMonth(key) {
  const r = records[`month:${key}`];
  return r && !r.deleted ? r : null;
}

/**
 * Salaries for a month: { t: cents, k: cents }.
 * Each salary is its own record, so both phones can enter theirs at
 * the same time without one overwriting the other.
 */
export function getIncomes(key) {
  const result = { t: 0, k: 0 };
  for (const p of ['t', 'k']) {
    const r = records[`income:${key}:${p}`];
    if (r && !r.deleted) result[p] = r.amount || 0;
  }
  return result;
}

export function setIncome(key, person, cents) {
  put({ id: `income:${key}:${person}`, type: 'income', month: key, person, amount: cents });
}

export const fixedFor = (key) => live('fixed').filter((r) => r.month === key).sort(byOrder);
export const checkinsFor = (key) => live('checkin').filter((r) => r.month === key).sort(byDate);
export const purchasesFor = (key) => live('purchase').filter((r) => r.month === key).sort(byDate);
export const getSpreads = () => live('spread').sort((a, b) => (a.start || '').localeCompare(b.start || ''));

/** Does this month have any setup yet (budget or fixed costs)? */
export const monthIsSetUp = (key) => Boolean(getMonth(key)) || fixedFor(key).length > 0;

/** Most recent month before `key` that has a setup, or null. */
export function previousSetUpMonth(key) {
  const keys = new Set(
    Object.values(records)
      .filter((r) => !r.deleted && (r.type === 'month' || r.type === 'fixed' || r.type === 'income') && r.month < key)
      .map((r) => r.month),
  );
  return [...keys].sort().pop() || null;
}

/** Start a month by copying salaries, budget and fixed costs (all unpaid) from another month. */
export function copyMonth(fromKey, toKey) {
  const from = getMonth(fromKey);
  const changes = [{
    id: `month:${toKey}`, type: 'month', month: toKey,
    walletBudget: from ? from.walletBudget : 0,
  }];
  const incomes = getIncomes(fromKey);
  for (const p of ['t', 'k']) {
    if (incomes[p]) changes.push({ id: `income:${toKey}:${p}`, type: 'income', month: toKey, person: p, amount: incomes[p] });
  }
  for (const f of fixedFor(fromKey)) {
    changes.push({
      id: newId('fx'), type: 'fixed', month: toKey, name: f.name, amount: f.amount,
      payer: f.payer, paid: false, order: f.order, createdAt: new Date().toISOString(),
    });
  }
  put(...changes);
}

export { addMonths };
