/**
 * Household Budget — sync backend for a private Google Sheet.
 *
 * Paste this into Extensions → Apps Script of your budget Sheet,
 * set the script property APP_KEY (see SETUP.md), and deploy as a web app.
 *
 * The Sheet gets one tab, "records", with one row per record:
 *   id | type | month | updatedAt | deleted | by | seq | data (JSON)
 * "seq" is a counter that increases with every write, so each phone can
 * ask "what changed since number N?" without trusting phone clocks.
 */

const SHEET_NAME = 'records';
const HEADERS = ['id', 'type', 'month', 'updatedAt', 'deleted', 'by', 'seq', 'data'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    checkKey_(body.key);

    if (body.action === 'ping') return json_({ ok: true });
    if (body.action === 'sync') return json_(sync_(body));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// Opening the URL in a browser shows only this, never any data.
function doGet() {
  return json_({ ok: true, app: 'household-budget', message: 'Sync endpoint is running.' });
}

function sync_(body) {
  // Only one phone writes at a time.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const props = PropertiesService.getScriptProperties();
    let seq = Number(props.getProperty('SEQ') || 0);

    const values = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
      : [];
    const rowById = {};
    values.forEach(function (row, i) { rowById[row[0]] = i; });

    // 1. Store incoming records that are newer than what the Sheet has.
    const incoming = Array.isArray(body.records) ? body.records : [];
    const appended = [];
    incoming.forEach(function (rec) {
      if (!rec || !rec.id) return;
      const i = rowById[rec.id];
      const existing = i === undefined ? null : values[i];
      if (existing && String(existing[3]) >= String(rec.updatedAt)) return; // Sheet is newer
      seq += 1;
      const row = [rec.id, rec.type || '', rec.month || '', rec.updatedAt || '',
        rec.deleted ? true : false, rec.by || '', seq, JSON.stringify(rec)];
      if (existing) {
        values[i] = row;
        sheet.getRange(i + 2, 1, 1, HEADERS.length).setValues([row]);
      } else {
        rowById[rec.id] = values.length;
        values.push(row);
        appended.push(row);
      }
    });
    if (appended.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, HEADERS.length).setValues(appended);
    }
    props.setProperty('SEQ', String(seq));

    // 2. Return everything that changed since the phone's last sync.
    const since = Number(body.since || 0);
    const changed = values
      .filter(function (row) { return Number(row[6]) > since; })
      .map(function (row) { return JSON.parse(row[7]); });

    return { ok: true, serverTime: seq, records: changed };
  } finally {
    lock.releaseLock();
  }
}

function checkKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!expected || expected.length < 16) throw new Error('APP_KEY is not set up on the script (needs 16+ characters).');
  if (key !== expected) throw new Error('Wrong sync key.');
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create a random key; it is printed in the log. */
function createKey() {
  const bytes = Utilities.getUuid() + Utilities.getUuid();
  const key = bytes.replace(/-/g, '').slice(0, 32);
  PropertiesService.getScriptProperties().setProperty('APP_KEY', key);
  Logger.log('Your sync key (copy it into the app on both phones): ' + key);
}
