// Merging records from two places (this phone and the Google Sheet).
//
// Every piece of data is a "record" with an id and an updatedAt timestamp.
// Deleting sets deleted: true instead of removing it, so the deletion
// can travel to the other phone too. When the same record was changed
// in both places, the newer change wins ("last write wins").

/** true when `incoming` should replace `local` */
export function isNewer(incoming, local) {
  if (!local) return true;
  return (incoming.updatedAt || '') > (local.updatedAt || '');
}

/**
 * Merge a list of incoming records into a map of local records.
 * Returns { records, changedIds } and does not modify the input map.
 */
export function mergeRecords(localMap, incomingList) {
  const records = { ...localMap };
  const changedIds = [];
  for (const rec of incomingList) {
    if (!rec || !rec.id) continue;
    if (isNewer(rec, records[rec.id])) {
      records[rec.id] = rec;
      changedIds.push(rec.id);
    }
  }
  return { records, changedIds };
}
