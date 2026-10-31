// Storage on this device (localStorage). The data is small (a few
// thousand records at most), so localStorage is simple and fast enough.
// Only this module touches localStorage.

const KEYS = {
  records: 'hb.records',     // all records: { id: record }
  dirty: 'hb.dirty',         // ids changed here and not yet sent to the Sheet
  cursor: 'hb.cursor',       // server time of the last successful sync
  device: 'hb.device',       // this device's own settings (sync URL, key, who am I)
  lastSync: 'hb.lastSync',   // when this device last synced (for display)
  inbox: 'hb.inbox',         // imported bank transactions (this phone only, never synced)
  shops: 'hb.shops',         // remembered choice per shop: 'common' | 'personal' (this phone only)
  lastSorted: 'hb.lastSorted', // when this phone's purchases were last fully sorted (ISO time)
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('Could not save to this device', err);
    return false;
  }
}

export const loadRecords = () => read(KEYS.records, {});
export const saveRecords = (records) => write(KEYS.records, records);

export const loadDirty = () => new Set(read(KEYS.dirty, []));
export const saveDirty = (set) => write(KEYS.dirty, [...set]);

export const loadCursor = () => read(KEYS.cursor, '');
export const saveCursor = (cursor) => write(KEYS.cursor, cursor);

export const loadLastSync = () => read(KEYS.lastSync, '');
export const saveLastSync = (iso) => write(KEYS.lastSync, iso);

export const loadInbox = () => read(KEYS.inbox, {});
export const saveInbox = (inbox) => write(KEYS.inbox, inbox);
export const loadShops = () => read(KEYS.shops, {});
export const saveShops = (shops) => write(KEYS.shops, shops);
export const loadLastSorted = () => read(KEYS.lastSorted, '');
export const saveLastSorted = (iso) => write(KEYS.lastSorted, iso);

export const loadDevice = () => ({ syncUrl: '', syncKey: '', me: 't', ...read(KEYS.device, {}) });
export const saveDevice = (device) => write(KEYS.device, device);

/** Ask Chrome to keep our data even when the phone runs low on space. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {
    // Not supported: nothing to do.
  }
}

/** Remove everything this app stored on this device. */
export function clearDevice() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
}

/** Backup file content (records only; the sync key is deliberately left out). */
export function buildBackup(records, appVersion) {
  return JSON.stringify({
    app: 'household-budget',
    version: appVersion,
    exportedAt: new Date().toISOString(),
    records: Object.values(records),
  }, null, 2);
}

/** Parse a backup file; returns the list of records or throws. */
export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data.app !== 'household-budget' || !Array.isArray(data.records)) {
    throw new Error('This is not a Household Budget backup file.');
  }
  return data.records;
}
