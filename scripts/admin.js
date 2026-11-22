import { applicationDefault, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cliAccessToken, cliGoogleAuth } from './cli-credential.js';
let localCliDatabase;
export function services() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID before accessing cloud data.');
  if (!getApps().length) initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: process.env.FIREBASE_USE_CLI_LOGIN === '1' ? { getAccessToken: cliAccessToken } : applicationDefault() }) });
  const useCli = process.env.FIREBASE_USE_CLI_LOGIN === '1' && !process.env.FIRESTORE_EMULATOR_HOST;
  const db = useCli ? localCliDatabase ||= new Firestore({ projectId, auth: cliGoogleAuth(projectId), preferRest: true }) : getFirestore();
  return { db, auth: getAuth(), projectId };
}
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function writeJson(path, data) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(data, null, 2)}\n`); }
export function arg(name, fallback) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; }
export const flag = name => process.argv.includes(`--${name}`);
export async function commitObservation(tx, db, value, privateData, before = null, privateBefore = null, actorUid = 'system:import') {
  const mutationId = randomUUID(), next = { ...value, version: (before?.version || 0) + 1, updatedAt: new Date().toISOString(), lastMutationId: mutationId };
  const p = { ...privateData, ownerId: value.ownerId, version: next.version };
  tx.set(db.doc(`observations/${value.id}`), next); tx.set(db.doc(`privateObservations/${value.id}`), p);
  tx.set(db.doc(`history/${value.id}/entries/${mutationId}`), { actorUid, before, after: next, privateBefore, privateAfter: p, committedAt: FieldValue.serverTimestamp() });
  return { value: next, privateData: p };
}
export async function collectionRows(db, name) { return (await db.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() })); }
