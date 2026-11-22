import { services, arg, commitObservation } from './admin.js';
import { planImport } from '../src/importer.js';
const { db } = services(), id = arg('id'), choice = arg('choice');
if (!id || !['website', 'spreadsheet'].includes(choice)) throw new Error('Usage: --id SOURCE_ID --choice website|spreadsheet');
await db.runTransaction(async tx => {
  const issueRef = db.doc(`importIssues/${id}`), importRef = db.doc(`imports/${id}`), reportRef = db.doc(`observations/${id}`), privateRef = db.doc(`privateObservations/${id}`);
  const [i, baseline, r, p] = await Promise.all([tx.get(issueRef), tx.get(importRef), tx.get(reportRef), tx.get(privateRef)]);
  const issue = i.data(); if (!issue || issue.status !== 'open' || !issue.incoming) throw new Error('No open source correction found.');
  if (r.data().version !== issue.expectedVersion) throw new Error('The report changed again. Rerun the import before resolving this issue.');
  const eventRef = db.doc(`events/${r.data().eventId}`), event = await tx.get(eventRef);
  const plan = planImport(baseline.data(), { value: r.data(), privateData: p.data() || {} }, issue.incoming, issue.incomingPrivate, issue.sourceHash);
  if (choice === 'spreadsheet') {
    // Keep non-conflicting website changes. Choose source values only at conflicting fields.
    const { resolveConflicts } = await import('../src/domain.js');
    const merged = plan.merged || { value: { ...issue.incoming, eventId: r.data().eventId, ownerId: r.data().ownerId }, conflicts: [] };
    const privateMerged = plan.privateMerged || { value: issue.incomingPrivate, conflicts: [] };
    const value = resolveConflicts(merged, Object.fromEntries(merged.conflicts.map(c => [c.path, 'remote']))), priv = resolveConflicts(privateMerged, Object.fromEntries(privateMerged.conflicts.map(c => [c.path, 'remote'])));
    await commitObservation(tx, db, value, priv, r.data(), p.data() || null, 'system:import-review');
    if (event.exists && event.data().selectedObservationId === id) tx.update(eventRef, { date: value.date, congregation: value.congregation, meetingType: value.meetingType });
  }
  tx.set(importRef, { ...baseline.data(), sourceHash: issue.sourceHash, sourceValue: issue.incoming, sourcePrivate: issue.incomingPrivate, missing: false, lastImportedAt: new Date().toISOString() });
  tx.update(issueRef, { status: 'resolved', resolution: choice, resolvedAt: new Date().toISOString() });
});
console.log('Import correction resolved.');
