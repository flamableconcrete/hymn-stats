// Offline, read-only preview: never writes source sheets or Firestore. Output is an explicit public projection.
import { ensureSourceIds, parseSourceRow } from '../src/importer.js';
import { projectPublic } from '../src/public-data.js';
import { arg, readJson, writeJson } from './admin.js';
const input = await readJson(arg('input', 'var/source.json')), catalog = await readJson('public/data/catalog.json');
const observations = [], events = [], reviews = [];
for (const sheet of input.sheets) {
  const prepared = ensureSourceIds(sheet.values, { dryRun: true });
  for (let n = 1; n < prepared.values.length; n++) {
    const row = prepared.values[n], id = row[prepared.idColumn]; if (!id) continue;
    const parsed = parseSourceRow(row.slice(0, prepared.idColumn), { id, kind: sheet.kind, ownerId: 'private-preview', catalog, sourceKey: String(sheet.sheetId), rowNumber: n + 1 });
    if (!parsed.value.date || !parsed.value.congregation || !parsed.value.items.length) { reviews.push({ row: n + 1, tab: sheet.title, warnings: parsed.warnings }); continue; }
    observations.push(parsed.value); events.push({ id: parsed.value.eventId, selectedObservationId: id, status: 'published', archived: false });
    if (parsed.warnings.length) reviews.push({ row: n + 1, tab: sheet.title, warnings: parsed.warnings });
  }
}
const snapshot = projectPublic(events, observations, catalog);
await writeJson(arg('out', 'var/public-preview.json'), snapshot); await writeJson('var/history-review.json', reviews);
console.log(JSON.stringify({ publicMeetings: snapshot.meetings.length, reviews: reviews.length, output: arg('out', 'var/public-preview.json') }));
