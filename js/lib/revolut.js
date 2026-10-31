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
  amount: ['amount', 'betrag', 'money in/out', 'money in / out', 'geld ein/aus', 'ein-/ausgang'],
  moneyIn: ['money in', 'paid in', 'eingang'],
  moneyOut: ['money out', 'paid out', 'ausgang'],
  fee: ['fee', 'fees', 'gebühr', 'gebuehr', 'gebühren'],
  category: ['category', 'kategorie'],
  currency: ['currency', 'währung', 'waehrung'],
  state: ['state', 'status'],
  balance: ['balance', 'saldo', 'kontostand'],
};

// Windows-1252 characters above 0xFF and the byte each one stands for.
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/**
 * Repair "mojibake": UTF-8 text that was once read as Windows-1252/Latin-1,
 * e.g. "-â‚¬33.94" → "-€33.94", "BÃ¤ckerei" → "Bäckerei".
 * Revolut's statement files can arrive like this. Text that is fine is returned unchanged.
 */
export function repairEncoding(text) {
  if (!/[ÂÃâ][\u0080-\u00bf\u0152-\u2122]/.test(text)) return text;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code <= 0xff) bytes[i] = code;
    else if (CP1252[ch] !== undefined) bytes[i] = CP1252[ch];
    else return text; // a real character outside Latin-1: not mojibake, leave it
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

/** Split CSV text into rows of fields. Handles quotes and "" inside quotes. */
export function parseCsv(text) {
  // Remove the BOM marker and repair garbled characters line by line,
  // so one unusual line can't stop the rest from being repaired.
  const clean = text.replace(/^\uFEFF/, '').split('\n').map(repairEncoding).join('\n');
  // Comma is Revolut's default; some exports (or Excel re-saves) use semicolons or tabs.
  // Look at a larger sample, because the first lines can be a title without separators.
  const sample = clean.slice(0, 20000);
  const count = (ch) => sample.split(ch).length;
  const sep = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');

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

const MONTHS = {
  jan: 1, feb: 2, mar: 3, mär: 3, maer: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12,
};
const TIME = '(\\d{1,2}:\\d{2}(?::\\d{2})?)';

/**
 * Dates as Revolut writes them, in any of these forms (time optional):
 *   2026-10-28 14:23:11 · 28.10.2026 14:23 · 28/10/2026 · Oct 28, 2026 · 28 Oct 2026
 * → { date: "2026-10-28", time: "14:23:11" }, or null.
 */
export function parseDateTime(text) {
  const s = (text || '').trim();
  const out = (y, mo, d, t) => {
    const month = Number(mo);
    const day = Number(d);
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
    return { date: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, time: t || '' };
  };
  let m = s.match(new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})(?:[ T]${TIME})?`));
  if (m) return out(m[1], m[2], m[3], m[4]);
  m = s.match(new RegExp(`^(\\d{1,2})[./](\\d{1,2})[./](\\d{4})(?:,?\\s+${TIME})?`));
  if (m) return out(m[3], m[2], m[1], m[4]);
  m = s.match(new RegExp(`^([A-Za-zÄäÖöÜü]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?:,?\\s+${TIME})?`));
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return out(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2], m[4]);
  m = s.match(new RegExp(`^(\\d{1,2})\\.?\\s+([A-Za-zÄäÖöÜü]{3,9})\\.?,?\\s+(\\d{4})(?:,?\\s+${TIME})?`));
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return out(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1], m[4]);
  return null;
}

const CURRENCY_CODES = ['EUR', 'SEK', 'USD', 'GBP', 'NOK', 'DKK', 'CHF', 'PLN', 'CZK', 'HUF'];

/** Currency written inside an amount ("-€23.45", "SEK -100", "-100 kr"), or null. */
export function currencyInText(text) {
  const t = (text || '').toUpperCase();
  if (t.includes('€')) return 'EUR';
  if (t.includes('£')) return 'GBP';
  if (t.includes('$')) return 'USD';
  const code = CURRENCY_CODES.find((c) => t.includes(c));
  if (code) return code;
  if (/\bKR\b/.test(t)) return 'SEK';
  return null;
}

/** Amount text with currency signs and codes → cents (negative = money out). */
export function parseAmount(text) {
  let t = (text || '').replace(/[\u2212\u2013]/g, '-').replace(/\u00a0/g, ' ');
  t = t.replace(/€|£|\$|\bkr\b/gi, '');
  for (const c of CURRENCY_CODES) t = t.replace(new RegExp(c, 'gi'), '');
  t = t.replace(/^\s*\((.*)\)\s*$/, '-$1'); // (23.45) = minus
  // Drop anything else that isn't part of the number (stray symbols, spaces, "+").
  t = t.replace(/[^0-9.,-]/g, '');
  if (/^-?$/.test(t)) return null;
  return parseCents(t);
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

/** Is this row a transactions header? (has a date, a description and an amount-like column) */
function headerColumns(row) {
  const header = row.map((h) => (h || '').trim().toLowerCase());
  const col = {};
  for (const [name, options] of Object.entries(COLUMNS)) col[name] = header.findIndex((h) => options.includes(h));
  const hasAmount = col.amount >= 0 || col.moneyOut >= 0;
  const hasDate = col.started >= 0 || col.completed >= 0;
  return hasAmount && hasDate && col.description >= 0 ? col : null;
}

/**
 * Read a Revolut CSV. Returns { transactions, skipped, otherCurrency, error }.
 *
 * Works with both kinds of export:
 *  - the plain transaction export (header in the first row, with State/Product columns)
 *  - the app's "Custom statement" (a long introduction about the account(s), then one or more
 *    sections, each with a "Date, Description, Category, Money in/out, Balance, …" header)
 *
 * transactions: outgoing EUR payments only, as
 *   { key, date, time, description, category, amount (positive cents incl. fee), currency, type }
 * otherCurrency: { SEK: 12, … } — payments in other currencies that were left out.
 */
export function parseRevolut(text, { currency: wanted = 'EUR' } = {}) {
  const rows = parseCsv(text);
  const transactions = [];
  const otherCurrency = {};
  const reasons = { incoming: 0, unreadable: 0, unfinished: 0, exchange: 0 };
  const seen = {}; // identical purchases in one file (same day, shop, amount, balance) get a counter
  let skipped = 0;
  let sections = 0;

  for (let i = 0; i < rows.length; i++) {
    const col = headerColumns(rows[i]);
    if (!col) continue;
    sections++;

    // The account currency of this section: the nearest currency code above the header
    // (the statement's introduction names the account), unless the rows say otherwise.
    let sectionCurrency = null;
    for (let j = i - 1; j >= Math.max(0, i - 60) && !sectionCurrency; j--) {
      if (headerColumns(rows[j])) break; // stop at the previous section
      const line = rows[j].join(' ').toUpperCase();
      sectionCurrency = CURRENCY_CODES.find((c) => new RegExp(`\\b${c}\\b`).test(line)) || null;
    }

    const get = (row, name) => (col[name] >= 0 ? (row[col[name]] || '').trim() : '');
    for (let r = i + 1; r < rows.length; r++) {
      const row = rows[r];
      if (headerColumns(row)) break; // next section starts
      const when = parseDateTime(get(row, 'started') || get(row, 'completed'));
      if (!when) continue; // titles, totals, blank lines between sections

      let amountText = get(row, 'amount');
      let amount = parseAmount(amountText);
      if (amount === null && col.moneyOut >= 0 && get(row, 'moneyOut')) {
        amountText = get(row, 'moneyOut');
        amount = -Math.abs(parseAmount(amountText) || 0);
      }
      const fee = Math.abs(parseAmount(get(row, 'fee')) || 0);
      const type = get(row, 'type').toUpperCase();
      const state = get(row, 'state').toUpperCase();
      const product = get(row, 'product').toLowerCase();
      const description = get(row, 'description');
      const currency = (get(row, 'currency') || currencyInText(amountText) || sectionCurrency || wanted).toUpperCase();

      const outgoing = amount !== null && amount < 0;
      const finished = !state || ['COMPLETED', 'ABGESCHLOSSEN', 'ERLEDIGT'].includes(state);
      const mainAccount = !product || ['current', 'aktuell', 'girokonto', 'konto'].includes(product);
      const exchange = ['EXCHANGE', 'UMTAUSCH', 'WECHSEL'].includes(type) || /^exchanged to\b/i.test(description);
      if (!outgoing || !finished || !mainAccount || exchange) {
        skipped++;
        if (amount === null) reasons.unreadable++;
        else if (!outgoing) reasons.incoming++;
        else if (exchange) reasons.exchange++;
        else reasons.unfinished++;
        continue;
      }
      if (currency !== wanted) {
        otherCurrency[currency] = (otherCurrency[currency] || 0) + 1;
        continue;
      }
      // Fingerprint from normalised values, so the same purchase gets the same key
      // in every export format (plain export or custom statement).
      const base = [when.date, description.trim().toLowerCase(), amount, parseAmount(get(row, 'balance')) ?? ''].join('|');
      seen[base] = (seen[base] || 0) + 1;
      transactions.push({
        key: transactionKey([base, seen[base]]),
        date: when.date,
        time: when.time,
        description,
        category: get(row, 'category'),
        amount: -amount + fee,
        currency,
        type,
      });
    }
  }

  if (!sections) {
    const preview = rows.slice(0, 3).map((r) => r.filter(Boolean).join(', ')).join(' | ');
    return {
      transactions: [], skipped: 0, otherCurrency,
      error: `No transaction list found in this file. It should contain a header like "Date, Description, …, Money in/out". The file starts with: ${preview.slice(0, 160)}`,
    };
  }
  return { transactions, skipped, otherCurrency, reasons, error: null };
}
