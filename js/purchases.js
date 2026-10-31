// Weekly sorting of purchases paid with private money.
//
// Imported bank transactions live ONLY on this phone (the "inbox").
// Marking one as common creates a shared "expense" record (synced to the
// other phone); personal ones never leave this phone.
// The app also remembers per shop what you chose, to suggest it next time.

import * as state from './state.js';
import * as storage from './storage.js';
import { parseRevolut, merchantKey } from './lib/revolut.js';

const KEEP_DAYS = 180; // sorted transactions older than this are forgotten (only their keys matter)

let inbox = storage.loadInbox(); // { key: { key, date, time, description, amount, personal?: true } }
let shops = storage.loadShops(); // { merchantKey: 'common' | 'personal' }

function save() {
  storage.saveInbox(inbox);
  storage.saveShops(shops);
  state.notifyChange();
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

/** Transactions still waiting to be sorted, newest first. */
export function toSort() {
  return Object.values(inbox)
    .filter((tx) => statusOf(tx) === 'new')
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

/**
 * Read a Revolut CSV and add new transactions to the inbox.
 * Returns { added, known, skipped, error }.
 */
export function importCsv(text) {
  const result = parseRevolut(text);
  if (result.error) return { added: 0, known: 0, skipped: 0, otherCurrency: {}, error: result.error };
  let added = 0;
  let known = 0;
  for (const tx of result.transactions) {
    if (inbox[tx.key] || state.allRecords()[expenseId(tx.key)]) {
      known++;
      continue;
    }
    inbox[tx.key] = { key: tx.key, date: tx.date, time: tx.time, description: tx.description, amount: tx.amount, category: tx.category || '' };
    added++;
  }
  prune();
  save();
  return { added, known, skipped: result.skipped, reasons: result.reasons || {}, otherCurrency: result.otherCurrency || {}, error: null };
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
export function acceptSuggestions() {
  let n = 0;
  for (const tx of toSort()) {
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
export function sortedAway() {
  return Object.values(inbox)
    .filter((tx) => tx.description && ['personal', 'settled'].includes(statusOf(tx)))
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
