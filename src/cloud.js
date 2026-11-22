import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, GithubAuthProvider, signInWithPopup, linkWithPopup, reauthenticateWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs, collection, query, where, setDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { clone, mergeThreeWay, resolveConflicts } from './domain.js';
import { planImport } from './import-plan.js';

export class Cloud {
  constructor(config) {
    this.config = config; this.ready = !!config.firebase?.apiKey && !!config.firebase?.projectId;
    if (!this.ready) return;
    const app = initializeApp(config.firebase); this.auth = getAuth(app);
    this.db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  }
  watch(callback) { if (!this.ready) { callback(null, null); return () => {}; } return onAuthStateChanged(this.auth, async user => {
    this.githubToken = null;
    if (!user) return callback(null, null);
    try {
      let member = await getDoc(doc(this.db, 'members', user.uid));
      if (!member.exists()) {
        const invitation = await getDoc(doc(this.db, 'invitations', user.email.toLowerCase()));
        if (invitation.exists()) { await setDoc(doc(this.db, 'members', user.uid), { email: user.email.toLowerCase(), role: invitation.data().role }); member = await getDoc(doc(this.db, 'members', user.uid)); }
      }
      callback(user, member.exists() ? member.data() : null);
    } catch (error) { callback(user, null, error); }
  }); }
  login() { return signInWithPopup(this.auth, new GoogleAuthProvider()); }
  logout() { this.githubToken = null; return signOut(this.auth); }
  async reports(user, member) {
    const q = member.role === 'admin' ? collection(this.db, 'observations') : query(collection(this.db, 'observations'), where('ownerId', '==', user.uid));
    const rows = await getDocs(q), result = [];
    for (const row of rows.docs) { const p = await getDoc(doc(this.db, 'privateObservations', row.id)); result.push({ value: row.data(), privateValue: p.data() || {} }); }
    return result;
  }
  async events() { return (await getDocs(query(collection(this.db, 'events'), where('status', '==', 'published')))).docs.map(d => ({ id: d.id, ...d.data() })); }
  async sync(envelope, user) {
    const id = envelope.id, mutationId = crypto.randomUUID();
    return runTransaction(this.db, async tx => {
      const ref = doc(this.db, 'observations', id), pRef = doc(this.db, 'privateObservations', id);
      const current = await tx.get(ref), currentPrivate = await tx.get(pRef);
      const remote = current.data() || { ...clone(envelope.base), version: 0 };
      const remotePrivate = currentPrivate.data() || {};
      const merged = mergeThreeWay(envelope.base, envelope.value, remote);
      const privateMerged = mergeThreeWay(envelope.basePrivate || {}, envelope.privateValue || {}, remotePrivate);
      if (merged.conflicts.length || privateMerged.conflicts.length) return { conflict: { merged, privateMerged, remote, remotePrivate } };
      const value = merged.value, privateValue = privateMerged.value;
      const eventRef = doc(this.db, 'events', value.eventId), event = await tx.get(eventRef);
      value.version = (remote.version || 0) + 1; value.updatedAt = new Date().toISOString(); value.lastMutationId = mutationId;
      privateValue.ownerId = value.ownerId; privateValue.version = value.version;
      tx.set(ref, value); tx.set(pRef, privateValue);
      tx.set(doc(this.db, 'history', id, 'entries', mutationId), { actorUid: user.uid, before: current.exists() ? remote : null, after: value, privateBefore: currentPrivate.exists() ? remotePrivate : null, privateAfter: privateValue, committedAt: serverTimestamp() });
      if (!event.exists()) tx.set(eventRef, { date: value.date, congregation: value.congregation, meetingType: value.meetingType, creatorUid: value.ownerId, selectedObservationId: value.status === 'published' ? id : '', status: value.status, archived: !!value.archived });
      else if (event.data().selectedObservationId === id || (!event.data().selectedObservationId && event.data().creatorUid === user.uid)) tx.update(eventRef, { date: value.date, congregation: value.congregation, meetingType: value.meetingType, selectedObservationId: value.status === 'published' ? id : '', status: value.status, archived: !!value.archived });
      return { value, privateValue };
    });
  }
  async invite(email, role = 'contributor') { await setDoc(doc(this.db, 'invitations', email.trim().toLowerCase()), { role }); }
  async members() { return (await getDocs(collection(this.db, 'members'))).docs.map(d => ({ id: d.id, ...d.data() })); }
  async setRole(uid, role) { await setDoc(doc(this.db, 'members', uid), { role }, { merge: true }); }
  async history(id) { return (await getDocs(collection(this.db, 'history', id, 'entries'))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.after.version - a.after.version); }
  async issues() { return (await getDocs(query(collection(this.db, 'importIssues'), where('status', '==', 'open')))).docs.map(d => ({ id: d.id, ...d.data() })); }
  async resolveImport(id, choice) {
    const mutationId = crypto.randomUUID();
    await runTransaction(this.db, async tx => {
      const issueRef = doc(this.db, 'importIssues', id), importRef = doc(this.db, 'imports', id), reportRef = doc(this.db, 'observations', id), pRef = doc(this.db, 'privateObservations', id);
      const [issueDoc, baselineDoc, reportDoc, privateDoc] = await Promise.all([tx.get(issueRef), tx.get(importRef), tx.get(reportRef), tx.get(pRef)]);
      const issue = issueDoc.data(), before = reportDoc.data(), privateBefore = privateDoc.data() || null;
      if (issue?.status !== 'open' || !issue.incoming) throw new Error('No open source correction was found.');
      if (before.version !== issue.expectedVersion) throw new Error('The website record changed again. Run import and rebuild to refresh this comparison.');
      const eventRef = doc(this.db, 'events', before.eventId), event = await tx.get(eventRef);
      const plan = planImport(baselineDoc.data(), { value: before, privateData: privateBefore || {} }, issue.incoming, issue.incomingPrivate, issue.sourceHash);
      const merged = plan.merged || { value: { ...issue.incoming, eventId: before.eventId, ownerId: before.ownerId }, conflicts: [] }, privateMerged = plan.privateMerged || { value: issue.incomingPrivate, conflicts: [] };
      const choices = c => Object.fromEntries(c.conflicts.map(x => [x.path, choice === 'spreadsheet' ? 'remote' : 'local']));
      const after = resolveConflicts(merged, choices(merged)), privateAfter = resolveConflicts(privateMerged, choices(privateMerged));
      after.version = before.version + 1; after.lastMutationId = mutationId; after.updatedAt = new Date().toISOString(); privateAfter.ownerId = after.ownerId; privateAfter.version = after.version;
      tx.set(reportRef, after); tx.set(pRef, privateAfter);
      tx.set(doc(this.db, 'history', id, 'entries', mutationId), { actorUid: this.auth.currentUser.uid, before, after, privateBefore, privateAfter, committedAt: serverTimestamp() });
      if (event.exists() && event.data().selectedObservationId === id) tx.update(eventRef, { date: after.date, congregation: after.congregation, meetingType: after.meetingType, status: after.status });
      tx.set(importRef, { ...baselineDoc.data(), sourceHash: issue.sourceHash, sourceValue: issue.incoming, sourcePrivate: issue.incomingPrivate, missing: false, lastImportedAt: new Date().toISOString() });
      tx.update(issueRef, { status: 'resolved', resolution: choice, resolvedAt: new Date().toISOString() });
    });
  }
  async selectReport(eventId, reportId) {
    await runTransaction(this.db, async tx => {
      const ref = doc(this.db, 'observations', reportId), snapshot = await tx.get(ref);
      if (!snapshot.exists() || snapshot.data().eventId !== eventId || snapshot.data().status !== 'published' || snapshot.data().archived) throw new Error('Choose a finished, active report belonging to this meeting.');
      const r = snapshot.data(); tx.update(doc(this.db, 'events', eventId), { selectedObservationId: reportId, date: r.date, congregation: r.congregation, meetingType: r.meetingType, archived: false });
    });
  }
  async joinEvent(report, eventId) { return { ...report, eventId }; }
  async connectGitHub() {
    const provider = new GithubAuthProvider(); provider.addScope('repo');
    const linked = this.auth.currentUser.providerData.some(p => p.providerId === 'github.com');
    const result = await (linked ? reauthenticateWithPopup(this.auth.currentUser, provider) : linkWithPopup(this.auth.currentUser, provider));
    this.githubToken = GithubAuthProvider.credentialFromResult(result)?.accessToken;
    if (!this.githubToken) throw new Error('GitHub did not return an authorization token.');
  }
  workflowUrl() { const g = this.config.github; return g?.owner && g?.repo ? `https://github.com/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/actions/workflows/${encodeURIComponent(g.workflow || 'publish.yml')}` : ''; }
  async rebuild() {
    if (!this.githubToken) await this.connectGitHub();
    const g = this.config.github;
    if (!g?.owner || !g?.repo) throw new Error('The automation repository has not been configured.');
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/actions/workflows/${encodeURIComponent(g.workflow || 'publish.yml')}/dispatches`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: g.ref || 'main' }),
    });
    if (!response.ok) { if (response.status === 401) this.githubToken = null; throw new Error(`GitHub declined the rebuild (${response.status}). Check your repository access and workflow configuration.`); }
    if (response.status === 204) return { html_url: this.workflowUrl() };
    return response.json();
  }
  async runStatus(runId) {
    const g = this.config.github, response = await fetch(`https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/actions/runs/${encodeURIComponent(runId)}`, { headers: { Authorization: `Bearer ${this.githubToken}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error('Could not check the rebuild. Open GitHub to see its status.');
    return response.json();
  }
  async exportAll() {
    const result = {};
    for (const name of ['observations', 'privateObservations', 'events', 'members', 'invitations', 'imports', 'importIssues']) result[name] = (await getDocs(collection(this.db, name))).docs.map(d => ({ id: d.id, data: d.data() }));
    result.history = [];
    for (const record of result.observations) result.history.push({ id: record.id, entries: await this.history(record.id) });
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), ...result };
  }
}
