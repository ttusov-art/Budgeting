// Weekly sorting of purchases paid with private money.
//
// Imported bank transactions live ONLY on this phone (the "inbox").
// Marking one as common creates a shared "expense" record (synced to the
// other phone); personal ones never leave this phone.
// The app also remembers per shop what you chose, to suggest it next time.

import * as state from './state.js';
import * as storage from './storage.js';
import { parseRevolut, merchantKey } from './lib/revolut.js';

const KEEP_DAYS = 180;
export const REMIND_AFTER_DAYS = 7; // remind to sort when the last full sort is older than this // sorted transactions older than this are forgotten (only their keys matter)

let inbox = storage.loadInbox(); // { key: { key, date, time, description, amount, personal?: true } }
let shops = storage.loadShops(); // { merchantKey: 'common' | 'personal' }

function save() {
  storage.saveInbox(inbox);
  storage.saveShops(shops);
  // Nothing left to sort after this change (or after an import with nothing new): remember when.
  if (toSort().length === 0) storage.saveLastSorted(new Date().toISOString());
  state.notifyChange();
}

/**
 * When this phone last had everything sorted, and whether a reminder is due.
 * { at: ISO | '', daysAgo: number | null, overdue: boolean }
 * No reminder before the first sort on this phone.
 */
export function sortStatus(now = new Date()) {
  const at = storage.loadLastSorted();
  if (!at) return { at: '', daysAgo: null, overdue: false };
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const daysAgo = Math.round((day(now) - day(new Date(at))) / 86400000);
  return { at, daysAgo, overdue: daysAgo > REMIND_AFTER_DAYS };
}

/** "today", "yesterday", "3 days ago" */
export function daysAgoLabel(n) {
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

/** After "Forget this phone": start from what storage now holds (nothing). */
export function reloadLocal() {
  inbox = storage.loadInbox();
  shops = storage.loadShops();
}

const expenseId = (key) => `ex_${key}`;

/** 'common' | 'personal' | 'settled' | 'new' — common is read from the shared record, so undo/sync stay consistent. */
export function statusOf(tx) {
  const e = state.allRecords()[expenseId(tx.key)];
  if (e && !e.deleted) return 'common';
  if (tx.settled) return 'settled';
  return tx.personal ? 'personal' : 'new';
}

/** Suggestion from earlier choices for the same shop, or null. */
export function suggestionFor(tx) {
  return shops[merchantKey(tx.description)] || null;
}

const inMonth = (month) => (tx) => !month || tx.date.slice(0, 7) === month;

/** Transactions still waiting to be sorted, newest first. With a month ('2026-10'), only that month's. */
export function toSort(month = null) {
  return Object.values(inbox)
    .filter((tx) => statusOf(tx) === 'new' && inMonth(month)(tx))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

/**
 * Read a Revolut CSV and add new transactions to the inbox.
 * With { month: '2026-10' } only that month's transactions are taken; new ones
 * from other months are counted in otherMonths ({ '2026-09': 3 }) and left out.
 * Returns { added, known, skipped, otherMonths, error }.
 */
export function importCsv(text, { month = null } = {}) {
  const result = parseRevolut(text);
  if (result.error) return { added: 0, known: 0, skipped: 0, otherCurrency: {}, otherMonths: {}, error: result.error };
  let added = 0;
  let known = 0;
  const otherMonths = {};
  for (const tx of result.transactions) {
    if (inbox[tx.key] || state.allRecords()[expenseId(tx.key)]) {
      known++;
      continue;
    }
    const txMonth = tx.date.slice(0, 7);
    if (month && txMonth !== month) {
      otherMonths[txMonth] = (otherMonths[txMonth] || 0) + 1;
      continue;
    }
    inbox[tx.key] = { key: tx.key, date: tx.date, time: tx.time, description: tx.description, amount: tx.amount, category: tx.category || '' };
    added++;
  }
  prune();
  save(); // an import with nothing new also counts as "checked and sorted"
  return { added, known, skipped: result.skipped, reasons: result.reasons || {}, otherCurrency: result.otherCurrency || {}, otherMonths, error: null };
}

/** Months (other than the given one) that still have purchases to sort: { '2026-09': 2 }. */
export function toSortElsewhere(month) {
  const out = {};
  for (const tx of toSort()) {
    const m = tx.date.slice(0, 7);
    if (m !== month) out[m] = (out[m] || 0) + 1;
  }
  return out;
}

/** Mark one transaction as 'common' or 'personal' (or back to 'new'). */
export function choose(key, choice, { remember = true } = {}) {
  const tx = inbox[key];
  if (!tx) return;
  const existing = state.allRecords()[expenseId(key)];
  if (existing && !existing.deleted && existing.settlementId) return; // already withdrawn: fixed

  if (choice === 'common') {
    tx.personal = false;
    state.put({
      id: expenseId(key), type: 'expense', month: tx.date.slice(0, 7), date: tx.date,
      createdAt: new Date().toISOString(), description: tx.description, amount: tx.amount,
      person: state.getDevice().me, settlementId: null, source: 'revolut',
    });
  } else {
    if (existing && !existing.deleted) state.remove(expenseId(key));
    tx.personal = choice === 'personal';
  }
  if (remember && choice !== 'new') shops[merchantKey(tx.description)] = choice;
  save();
}

/** Apply the remembered choice to every unsorted transaction that has one. Returns how many. */
export function acceptSuggestions(month = null) {
  let n = 0;
  for (const tx of toSort(month)) {
    const s = suggestionFor(tx);
    if (s) {
      choose(tx.key, s, { remember: false });
      n++;
    }
  }
  return n;
}

/**
 * "Already settled before …": clear every unsorted purchase on or before `dateKey`
 * without deciding common/personal and without teaching the shop memory anything.
 * For purchases that were balanced out some other way (e.g. before using the app).
 * Returns the keys that were cleared, so the step can be undone.
 */
export function settleUpTo(dateKey) {
  const keys = toSort().filter((tx) => tx.date <= dateKey).map((tx) => tx.key);
  for (const key of keys) inbox[key].settled = true;
  if (keys.length) save();
  return keys;
}

/** Undo settleUpTo: put those purchases back into "To sort". */
export function unsettle(keys) {
  for (const key of keys) if (inbox[key]) delete inbox[key].settled;
  save();
}

/** Purchases sorted as personal or cleared as already settled (still known in detail), newest first. */
export function sortedAway(month = null) {
  return Object.values(inbox)
    .filter((tx) => tx.description && ['personal', 'settled'].includes(statusOf(tx)) && inMonth(month)(tx))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

/** Put purchases (personal or already settled) back into "To sort". The shop memory is left as it is. */
export function backToSort(keys) {
  for (const key of keys) {
    const tx = inbox[key];
    if (!tx) continue;
    tx.personal = false;
    delete tx.settled;
  }
  save();
}

/** Common purchase typed in by hand (cash, or missing from the export). */
export function addManual({ date, description, amount }) {
  state.put({
    id: state.newId('ex'), type: 'expense', month: date.slice(0, 7), date,
    createdAt: new Date().toISOString(), description, amount,
    person: state.getDevice().me, settlementId: null, source: 'manual',
  });
}

/** The inbox entry behind a shared expense on this phone, if any. */
export function inboxEntryFor(expense) {
  return expense.id.startsWith('ex_rv') ? inbox[expense.id.slice(3)] || null : null;
}

// Forget the details of old, sorted transactions; keep only their key so they are never imported again.
function prune() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const [key, tx] of Object.entries(inbox)) {
    if (tx.date < cutoff && statusOf(tx) !== 'new') inbox[key] = { key, date: tx.date, time: '', description: '', amount: 0, personal: tx.personal };
  }
}
