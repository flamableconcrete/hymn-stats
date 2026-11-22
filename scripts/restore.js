import { Timestamp } from 'firebase-admin/firestore';
import { services, readJson, arg } from './admin.js';
const { db, auth, projectId } = services();
if (arg('confirm-project') !== projectId) throw new Error('Pass --confirm-project with the exact target FIREBASE_PROJECT_ID. Restore is allowed only into an empty target.');
for (const collection of await db.listCollections()) if (!(await collection.limit(1).get()).empty) throw new Error('Target Firestore database is not empty. Use a new empty project to avoid overwriting records.');
if ((await auth.listUsers(1)).users.length) throw new Error('Target Firebase Authentication is not empty. Restore into a new empty project.');
const backup = await readJson(arg('file', 'var/backup.json'));
if (backup.schemaVersion !== 1 || !Array.isArray(backup.documents) || !Array.isArray(backup.users)) throw new Error('Unsupported backup format.');
function revive(value) {
  if (value && typeof value === 'object' && '_seconds' in value && '_nanoseconds' in value && Object.keys(value).length === 2) return new Timestamp(value._seconds, value._nanoseconds);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  return value;
}
for (let offset = 0; offset < backup.users.length; offset += 1000) {
  const records = backup.users.slice(offset, offset + 1000).map(u => ({ uid: u.uid, email: u.email, emailVerified: u.emailVerified, displayName: u.displayName, photoURL: u.photoURL, disabled: u.disabled, customClaims: u.customClaims, providerData: u.providerData })).map(u => Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)));
  const result = await auth.importUsers(records); if (result.failureCount) throw new Error(`Authentication restore failed for ${result.failureCount} accounts. Review the target before retrying.`);
}
for (let offset = 0; offset < backup.documents.length; offset += 400) { const batch = db.batch(); for (const record of backup.documents.slice(offset, offset + 400)) batch.set(db.doc(record.path), revive(record.data)); await batch.commit(); }
console.log(JSON.stringify({ restoredDocuments: backup.documents.length, restoredUsers: backup.users.length, projectId }));
