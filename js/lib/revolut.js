// Reading a Revolut account statement (CSV export). Pure functions, no DOM.
//
// Revolut's CSV has a header row like:
//   Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
// Columns are found by name (English or German headers), so the order
// doesn't matter. Amounts are negative for money going out.

import { parseCents } from './money.js';

// Possible header names for each column we need (lower case).
const COLUMNS = {
  type: ['type', 'typ', 'art'],
  product: ['product', 'produkt'],
  started: ['started date', 'startdatum', 'start date', 'date', 'datum'],
  completed: ['completed date', 'abschlussdatum', 'completion date'],
  description: ['description', 'beschreibung'],
  amount: ['amount', 'betrag'],
  fee: ['fee', 'gebühr', 'gebuehr', 'gebühren'],
  currency: ['currency', 'währung', 'waehrung'],
  state: ['state', 'status'],
  balance: ['balance', 'saldo', 'kontostand'],
};

/** Split CSV text into rows of fields. Handles quotes and "" inside quotes. */
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, ''); // Excel/BOM marker
  const firstLine = clean.split(/\r?\n/, 1)[0];
  // Comma is Revolut's default; some exports use semicolons.
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** "2026-10-28 14:23:11" or "28.10.2026 14:23" → { date: "2026-10-28", time: "14:23:11" } */
export function parseDateTime(text) {
  const s = (text || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] || '' };
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (m) return { date: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, time: m[4] || '' };
  return null;
}

/** Short stable fingerprint of a transaction, so the same one is never imported twice. */
export function transactionKey(parts) {
  const text = parts.join('|');
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ c;
  }
  return `rv${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/**
 * Normalised shop name for remembering choices:
 * "LIDL 4521 Berlin" → "lidl berlin", "Rewe Markt GmbH*123" → "rewe markt gmbh".
 */
export function merchantKey(description) {
  return (description || '')
    .toLowerCase()
    .replace(/[0-9*#]+/g, ' ')
    .replace(/[^\p{L}\s&.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

/**
 * Read a Revolut CSV. Returns { transactions, skipped, error }.
 * transactions: outgoing payments only, as
 *   { key, date, time, description, amount (positive cents incl. fee), currency, type }
 * Skipped: incoming money, currency exchanges, savings/pocket rows, unfinished payments.
 */
export function parseRevolut(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { transactions: [], skipped: 0, error: 'The file is empty or not a CSV export.' };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [name, options] of Object.entries(COLUMNS)) {
    col[name] = header.findIndex((h) => options.includes(h));
  }
  if (col.amount < 0 || col.description < 0 || (col.started < 0 && col.completed < 0)) {
    return {
      transactions: [], skipped: 0,
      error: `This doesn't look like a Revolut statement. Columns found: ${rows[0].join(', ')}`,
    };
  }

  const get = (row, name) => (col[name] >= 0 ? (row[col[name]] || '').trim() : '');
  const transactions = [];
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const amount = parseCents(get(row, 'amount'));
    const fee = parseCents(get(row, 'fee')) || 0;
    const type = get(row, 'type').toUpperCase();
    const state = get(row, 'state').toUpperCase();
    const product = get(row, 'product').toLowerCase();
    const when = parseDateTime(get(row, 'started') || get(row, 'completed'));

    const outgoing = amount !== null && amount < 0;
    const finished = !state || ['COMPLETED', 'ABGESCHLOSSEN', 'ERLEDIGT'].includes(state);
    const mainAccount = !product || ['current', 'aktuell', 'girokonto', 'konto'].includes(product);
    const exchange = type === 'EXCHANGE' || type === 'UMTAUSCH' || type === 'WECHSEL';
    if (!outgoing || !finished || !mainAccount || exchange || !when) {
      skipped++;
      continue;
    }

    const description = get(row, 'description');
    transactions.push({
      key: transactionKey([get(row, 'started') || get(row, 'completed'), description, get(row, 'amount'), get(row, 'balance')]),
      date: when.date,
      time: when.time,
      description,
      amount: -amount + Math.abs(fee),
      currency: get(row, 'currency') || 'EUR',
      type,
    });
  }
  return { transactions, skipped, error: null };
}
