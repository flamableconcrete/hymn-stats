import { GoogleAuth } from 'google-auth-library';
import { ensureSourceIds, columnLetter, hash, parseSourceRow, planImport, sourceCells } from '../src/importer.js';
import { arg, flag, readJson, writeJson, services, commitObservation } from './admin.js';

const dryRun = !flag('apply'), spreadsheetId = process.env.SOURCE_SPREADSHEET_ID;
const mappings = JSON.parse(process.env.IMPORT_MAPPINGS_JSON || '[{"title":"Sacrament Meeting","kind":"sacrament"},{"title":"Other Meetings","kind":"other"}]');
const ownerId = process.env.IMPORT_OWNER_UID || (dryRun ? 'preview-owner' : '');
if (!ownerId) throw new Error('Set IMPORT_OWNER_UID to the account that owns the historical observations.');
const catalog = await readJson('public/data/catalog.json');
let sheets, googleClient;
async function api(path, options = {}) {
  googleClient ||= await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient();
  const token = await googleClient.getAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}`, { ...options, headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) throw new Error(`Sheets request failed (${response.status}). No source deletion is inferred.`);
  return response.json();
}
if (arg('input')) sheets = (await readJson(arg('input'))).sheets;
else {
  if (!spreadsheetId) throw new Error('Set SOURCE_SPREADSHEET_ID or supply --input with a private source snapshot.');
  const metadata = await api('?fields=spreadsheetId,sheets.properties'); sheets = [];
  for (const mapping of mappings) {
    const p = metadata.sheets.find(s => s.properties.title === mapping.title)?.properties;
    if (!p) throw new Error(`Configured source tab not found: ${mapping.title}. Import aborted before writing.`);
    const range = `'${p.title.replaceAll("'", "''")}'!A1:${columnLetter(p.gridProperties.columnCount - 1)}${p.gridProperties.rowCount}`;
    const data = await api(`/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
    sheets.push({ ...p, ...mapping, values: data.values || [] });
  }
}
const normalized = sheets.map(s => ({ ...s, prepared: ensureSourceIds(s.values, { dryRun }) }));
// Validate the entire input before assigning any source IDs or writing any Firestore record.
const allIds = normalized.flatMap(s => s.prepared.values.slice(1).map(r => r[s.prepared.idColumn]).filter(Boolean));
if (new Set(allIds).size !== allIds.length) throw new Error('Duplicate source IDs across tabs. No import was applied.');
if (!dryRun) {
  if (arg('input')) throw new Error('Applying a private snapshot cannot assign stable source IDs. Apply directly from Sheets instead.');
  for (const s of normalized) {
    if (s.prepared.idColumn >= s.gridProperties.columnCount) await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ appendDimension: { sheetId: s.sheetId, dimension: 'COLUMNS', length: s.prepared.idColumn - s.gridProperties.columnCount + 1 } }] }) });
    if (s.prepared.updates.length) await api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: s.prepared.updates.map(u => ({ range: `'${s.title.replaceAll("'", "''")}'!${columnLetter(u.column)}${u.row}`, values: [[u.value]] })) }) });
  }
}
const { db } = dryRun ? {} : services(), results = [], seen = new Set();
for (const s of normalized) {
  const sourceKey = `${spreadsheetId || 'snapshot'}:${s.sheetId}`;
  for (let n = 1; n < s.prepared.values.length; n++) {
    const full = s.prepared.values[n], id = full[s.prepared.idColumn]; if (!id) continue;
    seen.add(id); const row = sourceCells(full, s.prepared.idColumn);
    const parsed = parseSourceRow(row, { id, kind: s.kind, ownerId, catalog, sourceKey, rowNumber: n + 1 });
    if (dryRun) { results.push({ id, action: 'preview', ...parsed }); continue; }
    const sourceHash = hash(row);
    const result = await db.runTransaction(async tx => {
      const importRef = db.doc(`imports/${id}`), reportRef = db.doc(`observations/${id}`), pRef = db.doc(`privateObservations/${id}`);
      const [previousDoc, reportDoc, privateDoc] = await Promise.all([tx.get(importRef), tx.get(reportRef), tx.get(pRef)]);
      const previous = previousDoc.data(), current = reportDoc.exists ? { value: reportDoc.data(), privateData: privateDoc.data() || {} } : null;
      const plan = planImport(previous, current, parsed.value, parsed.privateData, sourceHash);
      const eventRef = db.doc(`events/${plan.value?.eventId || current?.value.eventId || parsed.value.eventId}`), event = await tx.get(eventRef);
      if (plan.action === 'unchanged') { if (previous?.missing) tx.update(importRef, { missing: false }); return 'unchanged'; }
      const issueRef = db.doc(`importIssues/${id}`);
      if (plan.action === 'conflict') {
        tx.set(issueRef, { type: 'Conflicting source correction', status: 'open', reportId: id, sourceKey, sourceHash, incoming: parsed.value, incomingPrivate: parsed.privateData, expectedVersion: current.value.version, message: 'The spreadsheet and website both changed. Review the differences before applying this source correction.', details: plan.conflicts }); return 'conflict';
      }
      const committed = await commitObservation(tx, db, plan.value, plan.privateData, current?.value || null, current?.privateData || null);
      if (!event.exists) tx.set(eventRef, { date: committed.value.date, congregation: committed.value.congregation, meetingType: committed.value.meetingType, creatorUid: committed.value.ownerId, selectedObservationId: committed.value.status === 'published' ? id : '', status: committed.value.status, archived: false });
      else if (event.data().selectedObservationId === id) tx.update(eventRef, { date: committed.value.date, congregation: committed.value.congregation, meetingType: committed.value.meetingType, status: committed.value.status });
      tx.set(importRef, { sourceKey, sourceHash, sourceValue: parsed.value, sourcePrivate: parsed.privateData, missing: false, lastImportedAt: new Date().toISOString() });
      tx.set(issueRef, { status: 'resolved', reportId: id }, { merge: true }); return plan.action;
    });
    results.push({ id, action: result, warnings: parsed.warnings });
  }
  if (!dryRun) {
    const known = await db.collection('imports').where('sourceKey', '==', sourceKey).get();
    for (const entry of known.docs) if (!seen.has(entry.id) && !entry.data().missing) {
      const batch = db.batch(); batch.update(entry.ref, { missing: true }); batch.set(db.doc(`importIssues/${entry.id}`), { type: 'Missing source row', status: 'open', sourceKey, reportId: entry.id, message: 'This source row is missing. The website record has been retained. Archive it only after reviewing the deletion.' }); await batch.commit();
    }
  }
}
await writeJson(arg('out', 'var/import-report.json'), { dryRun, generatedAt: new Date().toISOString(), results });
console.log(JSON.stringify({ dryRun, rows: results.length, counts: results.reduce((a, r) => ({ ...a, [r.action]: (a[r.action] || 0) + 1 }), {}), report: arg('out', 'var/import-report.json') }));
