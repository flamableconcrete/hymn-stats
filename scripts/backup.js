import { services, writeJson, arg } from './admin.js';
const { db, auth, projectId } = services(), documents = [];
async function walk(collection) {
  // Audit entries have intentionally nonexistent parent documents. Query snapshots alone miss those parents.
  for (const ref of await collection.listDocuments()) {
    const document = await ref.get();
    if (document.exists) documents.push({ path: ref.path, data: document.data() });
    for (const child of await ref.listCollections()) await walk(child);
  }
}
for (const collection of await db.listCollections()) await walk(collection);
const users = []; let page;
do { page = await auth.listUsers(1000, page?.pageToken); users.push(...page.users.map(u => u.toJSON())); } while (page.pageToken);
await writeJson(arg('out', 'var/backup.json'), { schemaVersion: 1, projectId, exportedAt: new Date().toISOString(), documents, users });
console.log(JSON.stringify({ documents: documents.length, users: users.length, output: arg('out', 'var/backup.json') }));
