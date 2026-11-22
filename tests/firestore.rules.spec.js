import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, writeBatch, updateDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { initializeApp as adminApp } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { makeObservation, makeItem } from '../src/domain.js';
const projectId = 'demo-hymn-stats'; let env;
const identity = email => ({ email, email_verified: true });
before(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile('firestore.rules', 'utf8') } }); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'members', 'owner'), { email: 'owner@example.com', role: 'contributor' });
    await setDoc(doc(ctx.firestore(), 'members', 'other'), { email: 'other@example.com', role: 'contributor' });
    await setDoc(doc(ctx.firestore(), 'members', 'admin'), { email: 'admin@example.com', role: 'admin' });
  });
});
function record() { const o = makeObservation('owner'); o.id = 'report'; o.eventId = 'meeting'; o.date = '2026-11-22'; o.congregation = 'Example ward'; o.items = [{ ...makeItem('Opening'), number: '6', status: 'performed' }]; o.status = 'published'; o.version = 1; o.lastMutationId = 'change-1'; o.updatedAt = '2026-11-22T12:00:00Z'; return o; }
async function create(db, value = record(), privateData = { ownerId: 'owner', version: 1, chorister: 'PRIVATE-NAME' }) {
  const batch = writeBatch(db); batch.set(doc(db, 'observations', value.id), value); batch.set(doc(db, 'privateObservations', value.id), privateData);
  batch.set(doc(db, 'history', value.id, 'entries', value.lastMutationId), { actorUid: 'owner', before: null, after: value, privateBefore: null, privateAfter: privateData, committedAt: serverTimestamp() });
  batch.set(doc(db, 'events', 'meeting'), { date: value.date, congregation: value.congregation, meetingType: value.meetingType, creatorUid: 'owner', selectedObservationId: value.id, status: 'published', archived: false });
  return batch.commit();
}
const dbFor = uid => env.authenticatedContext(uid, identity(`${uid}@example.com`)).firestore();
test('an invited contributor reads absent transaction targets and creates a report only with its matching immutable history entry', async () => { const db = dbFor('owner'); for (const path of ['observations/report', 'privateObservations/report', 'events/meeting']) await assertSucceeds(getDoc(doc(db, path))); await assertFails(setDoc(doc(db, 'observations', 'report'), record())); await assertSucceeds(create(db)); });
test('anonymous visitors cannot read backend records or musician names', async () => { await create(dbFor('owner')); const db = env.unauthenticatedContext().firestore(); for (const path of ['observations/report', 'privateObservations/report', 'events/meeting', 'members/owner', 'history/report/entries/change-1']) await assertFails(getDoc(doc(db, path))); });
test('another contributor can find a published report, but cannot read its private details or change it', async () => { await create(dbFor('owner')); const db = dbFor('other'); await assertSucceeds(getDoc(doc(db, 'observations', 'report'))); await assertFails(getDoc(doc(db, 'privateObservations', 'report'))); await assertFails(updateDoc(doc(db, 'observations', 'report'), { stood: 'yes', version: 2 })); });
test('admins can inspect musician details and histories in the app', async () => { await create(dbFor('owner')); const db = dbFor('admin'); assert.equal((await assertSucceeds(getDoc(doc(db, 'privateObservations', 'report')))).data().chorister, 'PRIVATE-NAME'); await assertSucceeds(getDoc(doc(db, 'history', 'report', 'entries', 'change-1'))); });
test('proper audited corrections succeed; stale versions and altered histories fail', async () => {
  const db = dbFor('owner'); await create(db); const before = (await getDoc(doc(db, 'observations', 'report'))).data(), privateBefore = (await getDoc(doc(db, 'privateObservations', 'report'))).data();
  const after = { ...before, version: 2, lastMutationId: 'change-2', stood: 'yes' }, privateAfter = { ...privateBefore, version: 2 };
  const batch = writeBatch(db); batch.set(doc(db, 'observations', 'report'), after); batch.set(doc(db, 'privateObservations', 'report'), privateAfter); batch.set(doc(db, 'history', 'report', 'entries', 'change-2'), { actorUid: 'owner', before, after, privateBefore, privateAfter, committedAt: serverTimestamp() }); await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(db, 'observations', 'report'), after)); await assertFails(updateDoc(doc(db, 'history', 'report', 'entries', 'change-1'), { actorUid: 'other' })); await assertFails(deleteDoc(doc(db, 'observations', 'report')));
});
test('uninvited and revoked accounts cannot grant themselves membership', async () => { const db = dbFor('stranger'); await assertFails(setDoc(doc(db, 'members', 'stranger'), { role: 'admin', email: 'stranger@example.com' })); await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'members', 'stranger'), { role: 'revoked', email: 'stranger@example.com' })); await assertFails(setDoc(doc(db, 'members', 'stranger'), { role: 'contributor', email: 'stranger@example.com' })); });
test('an email invitation grants only its specified role to its verified account', async () => { await setDoc(doc(dbFor('admin'), 'invitations', 'new@example.com'), { role: 'contributor' }); const db = dbFor('new'); await assertFails(setDoc(doc(db, 'members', 'new'), { role: 'admin', email: 'new@example.com' })); await assertSucceeds(setDoc(doc(db, 'members', 'new'), { role: 'contributor', email: 'new@example.com' })); });
test('full backup restores private records, revision timestamps, roles, and authentication IDs into an empty target', async () => {
  await create(dbFor('owner'));
  await env.withSecurityRulesDisabled(async ctx => {
    await Promise.all(Array.from({ length: 12 }, (_, n) => setDoc(doc(ctx.firestore(), 'recoveryFixtures', `missing-${n}`, 'nested', 'entry'), { n })));
  });
  const auth = adminAuth(adminApp({ projectId }, 'recovery-test'));
  await auth.createUser({ uid: 'owner', email: 'owner@example.com', emailVerified: true });
  await mkdir('var', { recursive: true });
  const options = { env: { ...process.env, FIREBASE_PROJECT_ID: projectId }, encoding: 'utf8', timeout: 60000 };
  let result = spawnSync(process.execPath, ['scripts/backup.js', '--out', 'var/test-backup.json'], options); assert.equal(result.status, 0, result.stderr);
  await env.clearFirestore(); await auth.deleteUser('owner');
  result = spawnSync(process.execPath, ['scripts/restore.js', '--file', 'var/test-backup.json', '--confirm-project', projectId], options); assert.equal(result.status, 0, result.stderr);
  assert.equal((await getDoc(doc(dbFor('owner'), 'privateObservations', 'report'))).data().chorister, 'PRIVATE-NAME');
  assert.equal((await getDoc(doc(dbFor('owner'), 'history', 'report', 'entries', 'change-1'))).data().committedAt.toMillis() > 0, true);
  assert.equal((await auth.getUser('owner')).email, 'owner@example.com');
  await env.withSecurityRulesDisabled(async ctx => {
    for (let n = 0; n < 12; n++) assert.equal((await getDoc(doc(ctx.firestore(), 'recoveryFixtures', `missing-${n}`, 'nested', 'entry'))).data().n, n);
  });
  await auth.deleteUser('owner');
});
