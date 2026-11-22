import { services, writeJson, arg } from './admin.js';
const { db, auth, projectId } = services(), documents = [];
// Bound all concurrent Firestore requests, including recursively discovered collections.
const waiting = []; let active = 0;
async function request(action) {
  if (active >= 8) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try { return await action(); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}
async function walk(collection) {
  // Audit entries have intentionally nonexistent parent documents. Query snapshots alone miss those parents.
  const refs = await request(() => collection.listDocuments());
  for (let start = 0; start < refs.length; start += 100) {
    for (const document of await request(() => db.getAll(...refs.slice(start, start + 100)))) {
      if (document.exists) documents.push({ path: document.ref.path, data: document.data() });
    }
  }
  await Promise.all(refs.map(async ref => {
    const children = await request(() => ref.listCollections());
    await Promise.all(children.map(walk));
  }));
}
await Promise.all((await request(() => db.listCollections())).map(walk));
documents.sort((a, b) => a.path.localeCompare(b.path));
const users = []; let page;
do { page = await auth.listUsers(1000, page?.pageToken); users.push(...page.users.map(u => u.toJSON())); } while (page.pageToken);
await writeJson(arg('out', 'var/backup.json'), { schemaVersion: 1, projectId, exportedAt: new Date().toISOString(), documents, users });
console.log(JSON.stringify({ documents: documents.length, users: users.length, output: arg('out', 'var/backup.json') }));
