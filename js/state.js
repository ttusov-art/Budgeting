// The app's data model, and the only place that changes it.
//
// All data is a flat collection of "records" (see README for the list).
// UI modules read through the getters below and change data through
// put() / remove(); they never touch storage directly.

import * as storage from './storage.js';
import { mergeRecords } from './lib/merge.js';
import { addMonths, dateKeyOf, daysInMonth } from './lib/months.js';
import {
  monthPlan, spreadSharesForMonth, walletStartBalance, lastBalance, budgetFingerprint, lockDecision,
  walletSpent, closeFingerprint, closeDecision,
} from './lib/budget.js';

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

/** For device-only data kept elsewhere (purchases inbox): tell the screens to redraw. */
export function notifyChange() {
  notify();
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

function commit(changes, { recordUndo = true } = {}) {
  // Nothing may change the wallet of a month that both have closed down
  // (this also catches undo/redo of older steps).
  const list = changes.filter((r) => !blockedByClose(r));
  if (!list.length) return [];
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

/** Like put(), but not an undo step (used for automatic changes such as locking after both agreed). */
function putQuietly(...changes) {
  const list = changes.map((c) => ({ ...(records[c.id] || {}), ...c, deleted: false }));
  return commit(list, { recordUndo: false });
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
  const done = commit(list, { recordUndo: false });
  redoStack.push(step);
  return done.length > 0;
}

export function redo() {
  const step = redoStack.pop();
  if (!step) return false;
  const done = commit(step.after.map((r) => ({ ...r })), { recordUndo: false });
  undoStack.push(step);
  return done.length > 0;
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

/**
 * Has each person done their wallet transfer this month? { t: bool, k: bool }
 * One record per person, so both phones can tick at the same time.
 */
export function getTransfersDone(key) {
  const result = { t: false, k: false };
  for (const p of ['t', 'k']) {
    const r = records[`transfer:${key}:${p}`];
    if (r && !r.deleted) result[p] = Boolean(r.done);
  }
  return result;
}

export function setTransferDone(key, person, done) {
  put({ id: `transfer:${key}:${person}`, type: 'transfer', month: key, person, done });
}

/**
 * Carry-over into a month: typed on the Month screen (override), or
 * automatically the balance of the previous month's last check-in.
 */
export function carryOverFor(key) {
  const m = getMonth(key);
  const prevKey = addMonths(key, -1);
  const auto = lastBalance(checkinsFor(prevKey));
  const overridden = Boolean(m) && m.carryOver !== undefined && m.carryOver !== null;
  return {
    amount: overridden ? m.carryOver : (auto ? auto.balance : 0),
    overridden,
    auto, // { balance, date } or null
    prevKey,
  };
}

/** Everything calculated for one month: the plan, carry-over and the wallet's start balance. */
export function planFor(key) {
  const m = getMonth(key) || { walletBudget: 0 };
  const fixed = fixedFor(key);
  // A locked month keeps the big-cost shares it had when it was locked,
  // so editing a big cost later doesn't change an agreed budget.
  const spreadShares = m.locked && Array.isArray(m.lockedShares) ? m.lockedShares : spreadSharesForMonth(getSpreads(), key);
  const plan = monthPlan({ fixed, spreadShares, walletBudget: m.walletBudget || 0, incomes: getIncomes(key) });
  const carry = carryOverFor(key);
  const startBalance = walletStartBalance({ plan, carryOver: carry.amount, fixed });
  return { m, fixed, spreadShares, plan, carry, startBalance };
}

/** Is the month's budget agreed and locked? */
export const isLocked = (key) => Boolean(getMonth(key)?.locked);

/** Fingerprint of the numbers being agreed for a month (see budgetFingerprint). */
export function monthFingerprint(key) {
  const m = getMonth(key) || {};
  const shares = m.locked && Array.isArray(m.lockedShares) ? m.lockedShares : spreadSharesForMonth(getSpreads(), key);
  return budgetFingerprint({
    fixed: fixedFor(key), incomes: getIncomes(key), walletBudget: m.walletBudget || 0,
    carryOver: carryOverFor(key).amount, spreadShares: shares,
  });
}

/** Each person's vote for a month: { want: 'lock'|'unlock', fp, at } or null. One record per person. */
export function getLockVotes(key) {
  const votes = { t: null, k: null };
  for (const p of ['t', 'k']) {
    const r = records[`lockvote:${key}:${p}`];
    if (r && !r.deleted) votes[p] = { want: r.want, fp: r.fp, at: r.at };
  }
  return votes;
}

/** This phone's owner votes to lock (approving the current numbers), to unlock, or withdraws (null). */
export function voteLock(key, want) {
  put({
    id: `lockvote:${key}:${device.me}`, type: 'lockvote', month: key, person: device.me,
    want, fp: want === 'lock' ? monthFingerprint(key) : null, at: new Date().toISOString(),
  });
  applyLockVotes(key);
}

/** Lock status for the screen: { locked, status: { t, k } }. */
export function lockInfo(key) {
  const locked = isLocked(key);
  return { locked, ...lockDecision({ locked, votes: getLockVotes(key), currentFp: monthFingerprint(key) }) };
}

/**
 * Lock or unlock when both votes agree. Runs on whichever phone notices first
 * (after a vote or after a sync); doing it twice is harmless.
 */
export function applyLockVotes(key) {
  const { action } = lockInfo(key);
  if (action === 'lock') {
    putQuietly({
      id: `month:${key}`, type: 'month', month: key, locked: true, lockedAt: new Date().toISOString(),
      lockedShares: spreadSharesForMonth(getSpreads(), key),
    });
  } else if (action === 'unlock') {
    putQuietly({ id: `month:${key}`, type: 'month', month: key, locked: false, lockedShares: null });
  }
  return action;
}

// ---------- closing down a month's wallet ----------
//
// When a month is over, both people close down its wallet: the first one enters
// the Revolut balance at the end of the month (the "final check-in"), and each
// confirms that all their purchases from that month are sorted. Once both have
// closed down with the same numbers, the month is closed: its final result is
// kept, and nothing in its wallet can change until both agree to reopen it.

const finalId = (key) => `checkin:${key}:final`;
const lastDayOf = (key) => `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;

/** The month's final check-in (balance at the end of the month), or null. */
export function getFinalCheckin(key) {
  const r = records[finalId(key)];
  return r && !r.deleted ? r : null;
}

/**
 * The month's final result: { finalBalance, finalDate, spent, budget }, or null without a final balance.
 * `fin` can stand in for the final check-in (to work out the result before saving it).
 */
export function closingResult(key, fin = getFinalCheckin(key)) {
  if (!fin) return null;
  const { m, startBalance } = planFor(key);
  const { spent } = walletSpent({
    checkins: [fin], startBalance, topups: topupsFor(key),
    expenses: getExpenses(), settlements: getSettlements(), monthKey: key,
  });
  return { finalBalance: fin.balance, finalDate: fin.date, spent, budget: m.walletBudget || 0 };
}

export const isClosed = (key) => Boolean(getMonth(key)?.closed);

/** A month can be closed down once it is over, if it had a wallet budget. */
export const canCloseDown = (key, todayKey) => key < todayKey.slice(0, 7) && (getMonth(key)?.walletBudget || 0) > 0;

/** Last month, if it still needs closing down (reminder in the new month), else null. */
export function monthToClose(todayKey) {
  const prev = addMonths(todayKey.slice(0, 7), -1);
  return canCloseDown(prev, todayKey) && !isClosed(prev) ? prev : null;
}

/** Each person's close-down vote: { want: 'close'|'reopen', fp, at } or null. One record per person. */
export function getCloseVotes(key) {
  const votes = { t: null, k: null };
  for (const p of ['t', 'k']) {
    const r = records[`closevote:${key}:${p}`];
    if (r && !r.deleted) votes[p] = { want: r.want, fp: r.fp, at: r.at };
  }
  return votes;
}

/** Close-down status for the screen: { closed, result, action, status: { t, k } }. */
export function closeInfo(key) {
  const closed = isClosed(key);
  const result = closingResult(key);
  const currentFp = result ? closeFingerprint(result) : null;
  return { closed, result, ...closeDecision({ closed, votes: getCloseVotes(key), currentFp }) };
}

/**
 * This phone's owner closes down the month (with the final balance), asks to
 * reopen it, or withdraws (want = null). One change, one undo step.
 */
export function voteClose(key, want, finalBalance = null) {
  const changes = [];
  let fin = getFinalCheckin(key);
  if (want === 'close' && finalBalance !== null && (!fin || fin.balance !== finalBalance)) {
    fin = {
      id: finalId(key), type: 'checkin', month: key, date: lastDayOf(key), balance: finalBalance,
      spent: null, final: true, createdAt: new Date().toISOString(),
    };
    changes.push(fin);
  }
  const result = want === 'close' ? closingResult(key, fin) : null;
  changes.push({
    id: `closevote:${key}:${device.me}`, type: 'closevote', month: key, person: device.me,
    want, fp: result ? closeFingerprint(result) : null, at: new Date().toISOString(),
  });
  put(...changes);
  return applyCloseVotes(key);
}

/**
 * Close or reopen when both votes agree. Runs on whichever phone notices first
 * (after a vote or after a sync); doing it twice is harmless.
 * The result is kept on the month record, so it stays exactly as agreed.
 */
export function applyCloseVotes(key) {
  const { action, result } = closeInfo(key);
  if (action === 'close') {
    putQuietly({ id: `month:${key}`, type: 'month', month: key, closed: true, closedAt: new Date().toISOString(), closedResult: result });
  } else if (action === 'reopen') {
    putQuietly({ id: `month:${key}`, type: 'month', month: key, closed: false, closedResult: null });
  }
  return action;
}

/**
 * Would this change touch the wallet of a closed month? Check-ins, added money and
 * common purchases are fixed then. Linking a common purchase to a withdrawal is
 * still fine: it doesn't change what the month spent.
 */
export function blockedByClose(rec) {
  if (!['checkin', 'topup', 'expense'].includes(rec.type)) return false;
  const old = records[rec.id];
  if (![rec.month, old?.month].some((k) => k && isClosed(k))) return false;
  if (rec.type !== 'expense' || !old) return true;
  return old.month !== rec.month || old.date !== rec.date || old.amount !== rec.amount
    || Boolean(old.deleted) !== Boolean(rec.deleted);
}

// ---------- common purchases paid with private money ----------

/** Common purchases (shared), newest first. Optionally only one month's. */
export const getExpenses = (key = null) => live('expense').filter((r) => !key || r.month === key).sort(byDate);
/** Withdrawals from the shared pocket (shared), newest first. */
export const getSettlements = () => live('settlement').sort(byDate);

/** One person's common purchases that haven't been withdrawn yet. */
export const pendingExpenses = (person) => live('expense').filter((e) => e.person === person && !e.settlementId).sort(byDate);

/**
 * Record that `person` withdrew their pending common purchases from the pocket.
 * One change (one undo step): the withdrawal plus a link on each purchase.
 */
export function settleExpenses(person) {
  const pending = pendingExpenses(person);
  if (!pending.length) return null;
  const today = dateKeyOf(new Date());
  const parts = {};
  for (const e of pending) parts[e.month] = (parts[e.month] || 0) + e.amount;
  const settlement = {
    id: newId('st'), type: 'settlement', month: today.slice(0, 7), date: today,
    createdAt: new Date().toISOString(), person,
    amount: pending.reduce((a, e) => a + e.amount, 0),
    count: pending.length, parts,
  };
  put(settlement, ...pending.map((e) => ({ id: e.id, settlementId: settlement.id })));
  return settlement;
}

export const fixedFor = (key) => live('fixed').filter((r) => r.month === key).sort(byOrder);
export const checkinsFor = (key) => live('checkin').filter((r) => r.month === key).sort(byDate);
export const topupsFor = (key) => live('topup').filter((r) => r.month === key).sort(byDate);
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
