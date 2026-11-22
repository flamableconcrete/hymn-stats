import './style.css';
import { COLLECTIONS, MEETING_TYPES, ROLES, BEAT_FACTORS, makeObservation, makeItem, validateObservation, segmentBpm, itemBpm, clone, mergeThreeWay, resolveConflicts, statistics, songKey, songLabel, normalize, today } from './domain.js';
import { local, download } from './storage.js';
import { Cloud } from './cloud.js';
import { csv } from './public-data.js';

const app = document.querySelector('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dateLabel = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date not set';
const options = (values, selected) => values.map(v => { const [value, label] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${esc(label)}</option>`; }).join('');
const note = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 5h17v22H8a4 4 0 0 1-4-4V5h4v22M15 10v11c-5-2-6 5-2 4 2 0 3-2 3-4v-7l7-2v7c-5-2-6 5-2 4 2 0 3-2 3-4V8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
let config = {}, catalog = [], snapshot = { meetings: [], generatedAt: null }, cloud;
const state = { records: [], user: null, member: null, events: [], filters: {}, search: '', demo: false, syncError: '', loading: true };
let saveTimer, syncing = false, activeTap, runTimer;
const localOwner = `local:${await local.setting('deviceId') || await (async () => { const id = crypto.randomUUID(); await local.setSetting('deviceId', id); return id; })()}`;
const visibleRecords = () => state.records.filter(r => state.member?.role === 'admin' || r.value.ownerId === (state.user?.uid || localOwner));
const active = () => state.records.find(r => r.id === location.hash.split('/')[1]);
const isAdmin = () => state.member?.role === 'admin';
const isLocal = () => !cloud?.ready;
function toast(message, error = false) {
  let box = document.querySelector('#toast'); if (!box) { box = document.createElement('div'); box.id = 'toast'; box.role = 'status'; document.body.append(box); }
  box.className = error ? 'toast error' : 'toast'; box.textContent = message; clearTimeout(box.timer); box.timer = setTimeout(() => box.remove(), 6500);
}
function updateStatus() {
  const element = document.querySelector('#connection');
  if (element) element.textContent = !navigator.onLine ? 'Offline · saving on this device' : syncing ? 'Synchronizing…' : visibleRecords().some(r => r.conflict) ? 'Conflicts need review' : state.syncError ? 'Saved here · sync needs attention' : visibleRecords().some(r => r.dirty) ? 'Saved on this device' : cloud?.ready && state.member ? 'Synchronized' : 'Local workspace';
  const row = active(), saved = document.querySelector('#save-status');
  if (saved && row) saved.textContent = row.localError ? 'Local save failed. Download a copy before leaving.' : row.conflict ? 'Conflicting edits need review' : row.dirty ? 'Saved on this device · not synchronized' : 'Saved and synchronized';
}
function shell(content, tab) {
  app.innerHTML = `<header class="site-header"><a class="brand" href="#explore">${note}<span>Hymn Stats<small>The music we sing together</small></span></a><nav aria-label="Main navigation"><a class="${tab === 'explore' ? 'current' : ''}" href="#explore">Explore</a><a class="${tab === 'log' ? 'current' : ''}" href="#log">My hymn log</a>${isAdmin() || isLocal() ? `<a class="${tab === 'admin' ? 'current' : ''}" href="#admin">${isLocal() ? 'Setup' : 'Admin'}</a>` : ''}</nav><div class="account">${state.user ? `<span>${esc(state.user.displayName || state.user.email)}</span><button class="quiet" data-action="logout">Sign out</button>` : cloud?.ready ? '<button class="button light" data-action="login">Sign in with Google</button>' : '<span class="local-label">Local workspace</span>'}</div></header><div class="connection-bar"><span id="connection" role="status"></span>${state.syncError ? '<button class="text-button" data-action="retry">Retry synchronization</button>' : ''}</div><main id="main">${content}</main><footer>Hymn Stats <span>A record of what we’ve sung, and a little perspective on it.</span></footer>`;
  updateStatus();
}
function trend(years, label = 'Recorded meetings by year') {
  if (!years.length) return '';
  const max = Math.max(...years.map(([, n]) => n)), width = Math.max(300, years.length * 44);
  return `<div class="trend"><svg width="${width}" height="146" viewBox="0 0 ${width} 146" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${years.map(([year, n], index) => { const x = 12 + index * ((width - 24) / years.length), w = Math.min(30, (width - 24) / years.length - 8), h = n / max * 95; return `<g><title>${year}: ${n} recorded meetings</title><rect x="${x}" y="${112 - h}" width="${w}" height="${h}" rx="3"/><text x="${x + w / 2}" y="${106 - h}" text-anchor="middle">${n}</text><text x="${x + w / 2}" y="134" text-anchor="middle">${year}</text></g>`; }).join('')}</svg></div>`;
}
function explorer() {
  const stats = statistics(snapshot.meetings, catalog, state.filters);
  let songs = stats.songs.filter(s => `${s.number} ${s.label}`.toLowerCase().includes(state.search.toLowerCase()));
  if (state.filters.sort === 'recent') songs.sort((a, b) => b.lastRecorded.localeCompare(a.lastRecorded));
  const congregations = [...new Set(snapshot.meetings.map(m => m.congregation))].sort(), types = [...new Set(snapshot.meetings.map(m => m.meetingType))].sort();
  shell(`<section class="page-intro"><div><h1>A little history.<br>A familiar hymn.</h1><p>Explore what we’ve sung, find an old favorite, or see how the music changes over time.</p></div><a class="button" href="#log">Record a meeting</a></section>${state.demo ? '<div class="notice">Sample data preview. These are example meetings, not your historical records. <button class="text-button" data-action="exit-demo">Leave preview</button></div>' : ''}<section class="filter-panel" aria-label="Filter recorded meetings"><label>Congregation<select data-filter="congregation">${options([['', 'All congregations'], ...congregations], state.filters.congregation || '')}</select></label><label>Meeting type<select data-filter="meetingType">${options([['', 'All meeting types'], ...types], state.filters.meetingType || '')}</select></label><label>From<input type="date" data-filter="from" value="${esc(state.filters.from)}"></label><label>Through<input type="date" data-filter="to" value="${esc(state.filters.to)}"></label><label>Music<select data-filter="performanceType">${options([['congregational', 'Congregational singing'], ['choir', 'Choir'], ['solo', 'Solo'], ['instrumental', 'Instrumental'], ['special', 'Special musical numbers'], ['all', 'All performances']], state.filters.performanceType || 'congregational')}</select></label></section><section class="explore-grid"><div class="song-list"><div class="section-title"><h2>Hymns we’ve sung</h2><button class="text-button" data-action="export-public" ${!songs.length ? 'disabled' : ''}>Download CSV</button></div><div class="search-row"><input aria-label="Search hymns" id="song-search" type="search" placeholder="Find a hymn by number or title" value="${esc(state.search)}"><label class="sr-only" for="sort">Sort hymns</label><select id="sort" data-filter="sort">${options([['frequency', 'Most recorded'], ['recent', 'Last recorded']], state.filters.sort || 'frequency')}</select></div><div id="song-results">${songRows(songs)}</div></div><aside class="context-panel"><h2>Among recorded meetings</h2><div class="summary-pair"><strong>${stats.meetingCount}</strong><span>meetings recorded</span></div><div class="summary-pair"><strong>${stats.songs.length}</strong><span>different songs</span></div><h3>Recorded meetings over time</h3>${trend(stats.years)}<p class="muted">Missing records don’t mean a hymn wasn’t sung. Frequency counts meetings containing a song; performance counts are available in each hymn’s history.</p><p class="updated">${snapshot.generatedAt ? `Last refreshed ${esc(new Date(snapshot.generatedAt).toLocaleString())}` : 'No public history has been published yet.'}</p></aside></section>`, 'explore');
}
function songRows(songs) {
  if (!songs.length) return `<div class="empty"><span class="empty-note" aria-hidden="true">♫</span><h3>${snapshot.meetings.length ? 'No hymns match these filters' : 'Your hymn history starts here'}</h3><p>${snapshot.meetings.length ? 'Try another congregation, date range, or song title.' : 'Record a meeting now, or connect your existing history before publishing.'}</p>${!snapshot.meetings.length ? '<button class="button secondary" data-action="demo">Preview sample analysis</button>' : '<button class="text-button" data-action="clear-filters">Clear filters</button>'}</div>`;
  const max = Math.max(...songs.map(s => s.meetings));
  return songs.map(s => `<button class="song-row" data-song-key="${esc(s.key)}"><span class="song-number">${esc(s.number || '♫')}</span><span class="song-name"><strong>${esc(s.label)}</strong><small>${esc(COLLECTIONS[s.collection] || s.collection)} · Last recorded ${dateLabel(s.lastRecorded)}</small><span class="frequency-track"><span style="width:${Math.max(2, s.meetings / max * 100)}%"></span></span></span><span class="song-count"><strong>${s.meetings}</strong><small>${s.meetings === 1 ? 'meeting' : 'meetings'}</small></span></button>`).join('');
}
function logView() {
  const rows = visibleRecords().filter(r => !r.value.archived).sort((a, b) => (b.value.date || '').localeCompare(a.value.date || ''));
  shell(`<section class="page-intro"><div><h1>My hymn log</h1><p>Start with the program. Add what you notice. Come back whenever you need to.</p></div><button class="button" data-action="new">New meeting</button></section>${!cloud.ready ? '<div class="notice">You can record on this device now. Cloud synchronization and publishing will be available once the site is connected.</div>' : state.user && !state.member ? '<div class="notice">Your account is not invited yet. An admin can add your Google email. Your local drafts remain on this device.</div>' : !state.user ? '<div class="notice">Sign in with an invited Google account to synchronize your records. You can still start a local draft.</div>' : ''}<section class="log-list">${rows.length ? rows.map(r => `<a class="log-row" href="#record/${esc(r.id)}"><span class="date-tile"><strong>${r.value.date ? new Date(`${r.value.date}T12:00:00`).getDate() : '—'}</strong><small>${r.value.date ? new Date(`${r.value.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : 'No date'}</small></span><span><strong>${esc(r.value.congregation || 'Congregation not set')}</strong><small>${esc(r.value.meetingType)} · ${r.value.items.filter(i => i.number || i.title).length} musical items</small></span><span class="pill ${r.conflict ? 'warning' : ''}">${r.conflict ? 'Review conflict' : r.value.status === 'draft' ? 'Draft' : r.dirty ? 'Finished · on device' : 'Finished'}</span></a>`).join('') : '<div class="empty"><span class="empty-note" aria-hidden="true">♫</span><h2>Make room for this week’s music</h2><p>Start a meeting and fill it in a little at a time. Every change saves automatically.</p><button class="button" data-action="new">Start a meeting</button></div>'}</section>`, 'log');
}
const yesNo = [['', 'Not recorded'], ['yes', 'Yes'], ['no', 'No'], ['na', 'Not applicable']];
function editor() {
  const r = active();
  if (!r || !visibleRecords().some(x => x.id === r.id)) { location.hash = '#log'; return; }
  const o = r.value, p = r.privateValue || {};
  const standing = o.meetingType.toLowerCase().includes('sacrament') && o.items.some(i => i.role === 'Congregational hymn' && i.performanceType === 'congregational' && i.status !== 'skipped');
  shell(`<a class="back-link" href="#log">Back to my hymn log</a><section class="editor-heading"><div><h1>${o.status === 'draft' ? 'This meeting’s music' : 'Meeting record'}</h1><p id="save-status" role="status"></p></div><span class="pill">${o.status === 'draft' ? 'Draft' : 'Finished · editable'}</span></section>${r.conflict ? '<div class="notice warning">This record has conflicting edits. Your changes are safe on this device. <button class="text-button" data-action="resolve">Review changes</button></div>' : ''}<div id="validation" role="alert"></div><form id="meeting-form" novalidate><section class="meeting-basics"><label>Date<input type="date" data-field="date" value="${esc(o.date)}" required></label><label>Congregation<input data-field="congregation" list="congregations" value="${esc(o.congregation)}" placeholder="Ward, branch, or congregation" required></label><datalist id="congregations">${[...new Set([...snapshot.meetings.map(m => m.congregation), ...visibleRecords().map(r => r.value.congregation)])].filter(Boolean).map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist><label>Meeting type<input data-field="meetingType" list="meeting-types" value="${esc(o.meetingType)}" required></label><datalist id="meeting-types">${MEETING_TYPES.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist></section><section class="music-section"><div class="section-title"><h2>Music for this meeting</h2><span class="muted">In performance order</span></div><datalist id="song-catalog">${catalog.map(s => `<option value="${esc(`${s.number} — ${s.title} (${COLLECTIONS[s.collection]})`)}"></option>`).join('')}</datalist><div class="music-items">${o.items.map((i, n) => itemCard(i, n, o.items.length)).join('')}</div><button class="button secondary add-item" type="button" data-action="add-item">Add musical item</button></section><section class="observations"><h2>Other observations <span class="optional">Optional</span></h2><div class="field-grid">${standing ? `<label>Stood for the congregational hymn<select data-field="stood">${options(yesNo, o.stood)}</select></label>` : ''}${o.meetingType.toLowerCase().includes('sacrament') ? `<label>Sacrament ready when its hymn ended<select data-field="sacramentReady">${options(yesNo, o.sacramentReady)}</select></label>` : ''}<label>Sunday type<input data-field="sundayType" value="${esc(o.sundayType)}" placeholder="Normal, fast Sunday, conference…"></label><label>Holiday or occasion<input data-field="holiday" value="${esc(o.holiday)}" placeholder="Christmas, Easter, ward conference…"></label></div><details><summary>Musicians and private notes</summary><p class="muted">These details stay out of the public site. Admins can view them directly in the record.</p><div class="field-grid"><label>Chorister<input data-private="chorister" value="${esc(p.chorister)}"></label><label>Organist or accompanist<input data-private="organist" value="${esc(p.organist)}"></label></div><label>Private notes<textarea data-private="notes" rows="3">${esc(p.notes)}</textarea></label></details></section></form><div class="editor-actions"><button class="text-button danger" data-action="archive">Archive meeting report</button><div><button class="button secondary" data-action="export-record">Download record</button><button class="button" data-action="finish">${o.status === 'draft' ? 'Finish meeting' : 'Save corrections'}</button></div></div>`, 'log');
}
function itemCard(i, n, count) {
  const bpm = itemBpm(i), title = i.number ? `${i.number}${i.title ? ` — ${i.title}` : ''}` : i.title;
  return `<article class="music-item" data-item-card="${esc(i.id)}"><div class="item-heading"><span class="item-marker" aria-hidden="true">${n + 1}</span><label class="role-label"><span class="sr-only">Musical role</span><select data-item="${esc(i.id)}" data-key="role">${options(ROLES.includes(i.role) ? ROLES : [...ROLES, i.role], i.role)}</select></label><div class="item-tools"><button type="button" class="icon-button" data-action="move-up" data-id="${esc(i.id)}" aria-label="Move item ${n + 1} earlier" ${!n ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="move-down" data-id="${esc(i.id)}" aria-label="Move item ${n + 1} later" ${n === count - 1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-action="remove-item" data-id="${esc(i.id)}" aria-label="Remove item ${n + 1}">×</button></div></div><div class="item-main"><label>Hymn or song<input list="song-catalog" data-song="${esc(i.id)}" value="${esc(title)}" placeholder="Number or song title" autocomplete="off"></label><label>Collection<select data-item="${esc(i.id)}" data-key="collection">${options(Object.entries(COLLECTIONS), i.collection)}</select></label></div><div class="item-secondary"><label>Performed by<select data-item="${esc(i.id)}" data-key="performanceType">${options([['congregational', 'Congregation'], ['choir', 'Choir'], ['solo', 'Soloist'], ['instrumental', 'Instrumental'], ['special', 'Special musical number']], i.performanceType)}</select></label><label>What happened<select data-item="${esc(i.id)}" data-key="status">${options([['planned', 'Planned'], ['performed', 'Performed'], ['partial', 'Partly performed'], ['skipped', 'Skipped']], i.status)}</select></label></div><details><summary>Tempo and verses <span class="tempo-summary" id="bpm-${esc(i.id)}">${bpm == null ? '' : `${Math.round(bpm)} BPM`}</span></summary><div class="tempo-controls"><button type="button" class="button secondary" data-action="tap" data-id="${esc(i.id)}">Tap tempo</button><label>Beat unit<select data-item="${esc(i.id)}" data-key="beatUnit">${options(Object.keys(BEAT_FACTORS).map(v => [v, v.replaceAll('-', ' ')]), i.beatUnit)}</select></label><label>Override BPM<input type="number" min="20" max="300" step="0.1" data-item="${esc(i.id)}" data-key="bpmOverride" value="${esc(i.bpmOverride)}" placeholder="Use sample average"></label></div><p class="muted">${i.segments.length} saved ${i.segments.length === 1 ? 'segment' : 'segments'}. Segments receive equal weight.</p><label>Verses sung<input data-item="${esc(i.id)}" data-key="verses" value="${esc(i.verses)}" placeholder="All verses, 1–3, or another description"></label>${i.titleNeedsReview ? `<label>Public song title<input data-item="${esc(i.id)}" data-key="publicTitle" value="${esc(i.publicTitle)}" placeholder="Enter a title without performer names"></label><p class="muted">This imported title needs review before its original text appears publicly.</p>` : ''}</details></article>`;
}
async function saveRecord(r, schedule = true) {
  r.localRevision = (r.localRevision || 0) + 1; r.dirty = true;
  try { await local.put(r); r.localError = false; } catch (error) { r.localError = true; toast('This device could not save your record. Download a copy before leaving.', true); }
  if (r.value.congregation) await local.setSetting('defaults', { congregation: r.value.congregation, meetingType: r.value.meetingType });
  updateStatus(); if (schedule) { clearTimeout(saveTimer); saveTimer = setTimeout(syncAll, 700); }
}
async function syncAll() {
  if (syncing || !cloud.ready || !state.member || !state.user || !navigator.onLine) return;
  syncing = true; state.syncError = ''; updateStatus();
  try {
    for (const record of visibleRecords().filter(r => r.dirty && !r.conflict)) {
      if (record.value.ownerId.startsWith('local:')) { record.value.ownerId = state.user.uid; record.base.ownerId = state.user.uid; }
      const sent = clone(record), revision = record.localRevision;
      const result = await cloud.sync(sent, state.user);
      if (result.conflict) { record.conflict = result.conflict; await local.put(record); continue; }
      if (revision === record.localRevision) { record.value = result.value; record.privateValue = result.privateValue; record.dirty = false; }
      else { record.value = mergeThreeWay(sent.value, record.value, result.value).value; record.privateValue = mergeThreeWay(sent.privateValue || {}, record.privateValue || {}, result.privateValue).value; }
      record.base = clone(result.value); record.basePrivate = clone(result.privateValue); await local.put(record);
    }
  } catch (error) { state.syncError = error.message; toast(`Your edits are saved on this device. Synchronization needs attention: ${error.message}`, true); }
  finally { syncing = false; updateStatus(); }
}
async function newMeeting() {
  const value = makeObservation(state.member ? state.user.uid : localOwner, await local.setting('defaults') || {});
  const record = { id: value.id, value, privateValue: {}, base: { ...clone(value), version: 0 }, basePrivate: {}, dirty: true, localRevision: 0 };
  state.records.push(record); await saveRecord(record); location.hash = `#record/${value.id}`;
}
function dialog(content, className = '') {
  document.querySelector('dialog')?.remove();
  const d = document.createElement('dialog'); d.className = className; d.innerHTML = `<button class="dialog-close icon-button" data-action="close-dialog" aria-label="Close dialog">×</button>${content}`; document.body.append(d); d.showModal();
  d.addEventListener('close', () => { activeTap = null; d.remove(); }); return d;
}
function tapDialog(id) {
  const item = active().value.items.find(i => i.id === id); activeTap = { id, times: [] };
  if (!BEAT_FACTORS[item.beatUnit]) { activeTap = null; toast('Choose a beat unit before sampling tempo.', true); return; }
  dialog(`<h2>${esc(songLabel(item, catalog))}</h2><p>Tap along with the ${esc(item.beatUnit.replaceAll('-', ' '))}-note beat. Save a few segments throughout the hymn.</p><button class="tap-pad" data-action="beat"><strong id="tap-reading">—</strong><span>BPM</span><small id="tap-count">Tap at least three beats</small></button><div class="dialog-actions"><button class="button secondary" data-action="reset-taps">Start over</button><button class="button" data-action="save-segment" id="save-segment" disabled>Save segment</button></div><div id="segment-list">${segmentList(item)}</div>`, 'tap-dialog');
}
function segmentList(item) { return `<h3>Saved segments</h3>${item.segments.length ? `<div class="segment-list">${item.segments.map(s => `<span>${Math.round(s.bpm)} ${esc((s.beatUnit || item.beatUnit).replaceAll('-', ' '))} BPM <button class="icon-button" data-action="remove-segment" data-id="${esc(s.id)}" aria-label="Discard ${Math.round(s.bpm)} BPM segment">×</button></span>`).join('')}</div>` : '<p class="muted">No segments saved yet.</p>'}<p>Current tempo: <strong>${itemBpm(item) == null ? 'not recorded' : `${Math.round(itemBpm(item))} BPM`}</strong>${item.bpmOverride != null && item.bpmOverride !== '' ? ' (manual override)' : ''}</p>`; }
function conflictDialog() {
  const c = active().conflict, list = [...c.merged.conflicts.map(x => ({ ...x, section: 'public' })), ...c.privateMerged.conflicts.map(x => ({ ...x, section: 'private' }))];
  dialog(`<h2>Review conflicting edits</h2><p>Changes to different fields have already been combined. Choose which value to keep for each conflict.</p><form id="conflict-form">${list.map((x, n) => `<fieldset><legend>${esc(x.section === 'private' ? 'Private details: ' : '')}${esc(x.path)}</legend><label class="radio-choice"><input type="radio" name="conflict-${n}" value="local" checked>My device: ${esc(JSON.stringify(x.local) ?? '(removed)')}</label><label class="radio-choice"><input type="radio" name="conflict-${n}" value="remote">Website: ${esc(JSON.stringify(x.remote) ?? '(removed)')}</label></fieldset>`).join('')}<button class="button" type="submit">Save resolved changes</button></form>`);
  document.querySelector('#conflict-form').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.target), pub = {}, priv = {}; list.forEach((x, n) => { (x.section === 'private' ? priv : pub)[x.path] = form.get(`conflict-${n}`); }); const r = active(); r.value = resolveConflicts(c.merged, pub); r.privateValue = resolveConflicts(c.privateMerged, priv); r.base = clone(c.remote); r.basePrivate = clone(c.remotePrivate); delete r.conflict; await saveRecord(r); document.querySelector('dialog').close(); editor(); };
}
async function finishMeeting(forceSeparate = false) {
  const r = active(), errors = validateObservation(r.value);
  if (errors.length) { document.querySelector('#validation').innerHTML = `<div class="notice warning"><strong>Before finishing:</strong><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`; document.querySelector('#validation').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  if (r.conflict) { conflictDialog(); return; }
  const matches = state.events.filter(e => e.id !== r.value.eventId && e.date === r.value.date && normalize(e.congregation).toLowerCase() === normalize(r.value.congregation).toLowerCase() && normalize(e.meetingType).toLowerCase() === normalize(r.value.meetingType).toLowerCase());
  if (matches.length && !forceSeparate && !r.joinChecked) { dialog(`<h2>Is this the same meeting?</h2><p>Another report exists for this congregation, date, and meeting type. Joining preserves your observations while counting the meeting once.</p>${matches.map(m => `<button class="button match-button" data-action="join" data-id="${esc(m.id)}">Add my report to ${esc(m.meetingType)} on ${dateLabel(m.date)}</button>`).join('')}<button class="button secondary" data-action="separate">This is a separate meeting</button>`); return; }
  r.value.status = 'published'; await saveRecord(r); await syncAll(); editor(); toast(r.dirty ? 'Meeting finished and saved on this device. Publication awaits synchronization and the next public refresh.' : 'Meeting finished. The public site will update at its next refresh.');
}
function songDialog(key) {
  const stats = statistics(snapshot.meetings, catalog, state.filters), song = stats.songs.find(s => s.key === key); if (!song) return;
  const meetings = stats.rows.filter(m => m.items.some(i => songKey(i) === key && ['performed', 'partial'].includes(i.status) && ((state.filters.performanceType || 'congregational') === 'all' || i.performanceType === (state.filters.performanceType || 'congregational'))));
  const years = new Map(); for (const m of meetings) years.set(m.date.slice(0, 4), (years.get(m.date.slice(0, 4)) || 0) + 1);
  dialog(`<p class="muted">${esc(COLLECTIONS[song.collection])}${song.number ? ` · ${esc(song.number)}` : ''}</p><h2>${esc(song.label)}</h2><p><strong>${song.meetings}</strong> recorded meetings · <strong>${song.performances}</strong> performances</p>${trend([...years].sort(), 'Meetings containing this song by year')}<h3>Recorded history</h3><div class="history-list">${meetings.sort((a, b) => b.date.localeCompare(a.date)).map(m => `<div><strong>${dateLabel(m.date)}</strong><span>${esc(m.congregation)}</span><small>${esc(m.meetingType)}</small>${m.items.filter(i => songKey(i) === key).map(i => `<small>${esc(i.role)}${itemBpm(i) != null ? ` · ${Math.round(itemBpm(i))} BPM (${esc(i.beatUnit)}-note beat; ${i.tempoObservers || 1} observers)` : ''}${i.tempoRange && i.tempoRange[0] !== i.tempoRange[1] ? ` · range ${Math.round(i.tempoRange[0])}–${Math.round(i.tempoRange[1])}` : ''}</small>`).join('')}</div>`).join('')}</div><p class="muted">This is a history of recorded observations, not a complete record of every meeting.</p>`);
}
async function adminView() {
  if (!isAdmin() && !isLocal()) { shell('<div class="empty"><h1>Admin access required</h1><p>Sign in with an invited admin account to manage records and publication.</p></div>', 'admin'); return; }
  shell(`<section class="page-intro"><div><h1>${isLocal() ? 'Connect your hymn log' : 'Manage Hymn Stats'}</h1><p>${isLocal() ? 'Your recording workspace is ready. Cloud services still need to be configured before synchronization or publication.' : 'Manage contributors, review records, and refresh the public history.'}</p></div></section>${isLocal() ? '<section class="admin-section"><h2>Cloud setup</h2><p>Follow the repository’s setup guide to configure Firebase, Google sign-in, and the publishing workflow. This local workspace does not publish anything.</p><p>Your drafts will remain available on this device when the cloud connection is added.</p></section>' : `<section class="admin-section"><h2>Public site</h2><p>${snapshot.generatedAt ? `Last snapshot: ${esc(new Date(snapshot.generatedAt).toLocaleString())}` : 'No snapshot published yet.'}</p><div class="button-row"><button class="button" data-action="rebuild" ${!cloud.workflowUrl() ? 'disabled' : ''}>Rebuild public site</button>${cloud.workflowUrl() ? `<a class="button secondary" href="${esc(cloud.workflowUrl())}" target="_blank" rel="noopener noreferrer">Open GitHub workflow</a>` : '<p>Configure the automation repository to enable rebuilding.</p>'}</div><p class="muted">Rebuilding may ask you to authorize GitHub. Its standard repository permission includes private repositories you can access. The token stays in this browser session.</p><p id="run-status" role="status"></p></section><section class="admin-section"><h2>Invite a contributor</h2><form id="invite-form" class="inline-form"><label>Google account email<input name="email" type="email" required placeholder="name@example.com"></label><label>Role<select name="role">${options(['contributor', 'admin'], 'contributor')}</select></label><button class="button" type="submit">Allow this account</button></form><p class="muted">This adds the account to the allowlist. Share the site link with them; no email is sent.</p><div id="member-list"></div></section><section class="admin-section"><h2>Import review</h2><p>Stable source IDs keep repeated imports from creating duplicate reports. Missing rows and conflicting corrections need review.</p><div id="import-issues">Loading import issues…</div></section>`}<section class="admin-section"><h2>Exports and recovery</h2><p>Full exports contain private information. Keep them in a private location.</p><div class="button-row"><button class="button secondary" data-action="export-all">Download ${isLocal() ? 'device records' : 'full data export'}</button><button class="button secondary" data-action="export-private-csv">Download meeting CSV</button></div><p class="muted">Automated private backups and a tested restore procedure are required before retiring the spreadsheet workflow.</p></section>${isAdmin() ? '<section class="admin-section"><h2>Meeting reports</h2><p>Open any report to view musician names, edit its observations, or inspect revision history.</p><div id="admin-reports"></div></section>' : ''}`, 'admin');
  if (!isAdmin()) return;
  const reports = visibleRecords().sort((a, b) => (b.value.date || '').localeCompare(a.value.date || ''));
  document.querySelector('#admin-reports').innerHTML = reports.map(r => `<div class="admin-report"><a href="#record/${esc(r.id)}"><strong>${dateLabel(r.value.date)} · ${esc(r.value.congregation)}</strong><small>${esc(r.value.meetingType)} · Chorister: ${esc(r.privateValue?.chorister || 'not recorded')} · Organist: ${esc(r.privateValue?.organist || 'not recorded')}</small></a><button class="text-button" data-action="history" data-id="${esc(r.id)}">History</button>${r.value.status === 'published' && !r.value.archived ? `<button class="text-button" data-action="select-report" data-id="${esc(r.id)}">Use for public hymn list</button>` : ''}</div>`).join('');
  try {
    const [members, issues] = await Promise.all([cloud.members(), cloud.issues()]);
    const el = document.querySelector('#member-list'); if (!el) return;
    el.innerHTML = members.map(m => `<div class="member-row"><span>${esc(m.email)}</span><label>Access<select data-member-id="${esc(m.id)}" ${m.id === state.user.uid ? 'disabled' : ''}>${options(['contributor', 'admin', 'revoked'], m.role)}</select></label></div>`).join('');
    document.querySelector('#import-issues').innerHTML = issues.length ? issues.map(i => `<div class="notice warning"><strong>${esc(i.type || 'Import issue')}</strong><p>${esc(i.message || 'Review this source record before applying its changes.')}</p><button class="text-button" data-action="import-issue" data-id="${esc(i.id)}">Review issue</button></div>`).join('') : '<p>No open import issues.</p>';
    state.importIssues = issues;
  } catch (error) { toast(error.message, true); }
}
function render() {
  if (location.hash.startsWith('#record/')) editor(); else if (location.hash === '#log') logView(); else if (location.hash === '#admin') adminView(); else explorer();
}
function sample() {
  const make = (date, nums) => ({ id: `example-${date}`, date, congregation: 'Example congregation', meetingType: 'Sacrament meeting', items: nums.map((n, idx) => ({ id: `${date}-${idx}`, collection: 'hymns', number: String(n), title: songLabel({ collection: 'hymns', number: String(n) }, catalog), role: ['Opening', 'Sacrament', 'Closing'][idx], performanceType: 'congregational', status: 'performed', beatUnit: 'quarter', segments: [] })) });
  return { generatedAt: null, meetings: [make('2026-11-08', [6, 169, 26]), make('2026-11-15', [26, 169, 6]), make('2026-11-22', [6, 170, 26])] };
}
document.addEventListener('input', async event => {
  const t = event.target;
  if (t.id === 'song-search') { state.search = t.value; const stats = statistics(snapshot.meetings, catalog, state.filters); let songs = stats.songs.filter(s => `${s.number} ${s.label}`.toLowerCase().includes(state.search.toLowerCase())); if (state.filters.sort === 'recent') songs.sort((a, b) => b.lastRecorded.localeCompare(a.lastRecorded)); document.querySelector('#song-results').innerHTML = songRows(songs); return; }
  const r = active(); if (!r || !t.closest('#meeting-form')) return;
  if (t.dataset.field) r.value[t.dataset.field] = t.value;
  if (t.dataset.private) (r.privateValue ||= {})[t.dataset.private] = t.value;
  if (t.dataset.item) {
    const i = r.value.items.find(x => x.id === t.dataset.item), key = t.dataset.key; i[key] = key === 'bpmOverride' ? t.value === '' ? null : Number(t.value) : t.value;
    if (key === 'publicTitle') { i.title = t.value; i.titleNeedsReview = !normalize(t.value); }
    if (key === 'collection' && i.number) { const found = catalog.find(s => s.collection === i.collection && String(s.number) === i.number); i.title = found?.title || ''; if (found?.beatUnit) i.beatUnit = found.beatUnit; }
    const bpm = itemBpm(i), summary = document.querySelector(`#bpm-${CSS.escape(i.id)}`); if (summary) summary.textContent = bpm == null ? '' : `${Math.round(bpm)} BPM`;
  }
  if (t.dataset.song) {
    const i = r.value.items.find(x => x.id === t.dataset.song), found = catalog.find(s => `${s.number} — ${s.title} (${COLLECTIONS[s.collection]})` === t.value) || catalog.find(s => s.collection === i.collection && (String(s.number) === t.value.trim() || s.title.toLowerCase() === t.value.trim().toLowerCase()));
    if (found) { i.number = String(found.number); i.collection = found.collection; i.title = found.title; if (found.beatUnit) i.beatUnit = found.beatUnit; }
    else if (/^\d+[a-z]?(?:\s*[—-].*)?$/i.test(t.value.trim())) { i.number = t.value.trim().match(/^\d+[a-z]?/i)[0]; i.title = ''; if (Number(i.number) >= 1000 && i.collection === 'hymns') i.collection = 'home-church'; }
    else { i.number = ''; i.title = t.value; }
  }
  await saveRecord(r);
});
document.addEventListener('change', async event => {
  const t = event.target;
  if (t.dataset.filter) { state.filters[t.dataset.filter] = t.value; render(); }
  if (t.dataset.memberId) { try { await cloud.setRole(t.dataset.memberId, t.value); toast('Account access updated.'); } catch (e) { toast(e.message, true); } }
  if (t.dataset.field === 'meetingType') { const r = active(); if (r.value.items.every(i => !i.number && !i.title)) r.value.items = makeObservation(r.value.ownerId, { meetingType: r.value.meetingType }).items; await saveRecord(r); editor(); }
  if (t.dataset.key && ['role', 'collection', 'performanceType', 'status'].includes(t.dataset.key)) editor();
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'meeting-form') event.preventDefault();
  if (event.target.id === 'invite-form') { event.preventDefault(); const data = new FormData(event.target); try { await cloud.invite(data.get('email'), data.get('role')); event.target.reset(); toast('Account allowed. Share the site link with the contributor.'); } catch (e) { toast(e.message, true); } }
});
document.addEventListener('click', async event => {
  const t = event.target.closest('[data-action], [data-song-key]'); if (!t) return;
  if (t.dataset.songKey) { songDialog(t.dataset.songKey); return; }
  event.preventDefault();
  const r = active(), action = t.dataset.action;
  try {
    if (action === 'login') await cloud.login();
    else if (action === 'logout') { await cloud.logout(); location.hash = '#explore'; }
    else if (action === 'new') await newMeeting();
    else if (action === 'retry') await syncAll();
    else if (action === 'add-item') { r.value.items.push(makeItem()); await saveRecord(r); editor(); document.querySelector('.music-item:last-child input').focus(); }
    else if (action === 'remove-item') { r.value.items = r.value.items.filter(i => i.id !== t.dataset.id); await saveRecord(r); editor(); }
    else if (action === 'move-up' || action === 'move-down') { const n = r.value.items.findIndex(i => i.id === t.dataset.id), to = n + (action === 'move-up' ? -1 : 1); [r.value.items[n], r.value.items[to]] = [r.value.items[to], r.value.items[n]]; await saveRecord(r); editor(); }
    else if (action === 'tap') tapDialog(t.dataset.id);
    else if (action === 'close-dialog') document.querySelector('dialog').close();
    else if (action === 'beat') {
      const now = performance.now(); if (activeTap.times.length && now - activeTap.times.at(-1) > 4000) activeTap.times = [];
      activeTap.times.push(now); const bpm = segmentBpm(activeTap.times); document.querySelector('#tap-reading').textContent = bpm == null ? '—' : Math.round(bpm); document.querySelector('#tap-count').textContent = `${activeTap.times.length} taps`; document.querySelector('#save-segment').disabled = bpm == null;
    }
    else if (action === 'reset-taps') { activeTap.times = []; document.querySelector('#tap-reading').textContent = '—'; document.querySelector('#tap-count').textContent = 'Tap at least three beats'; document.querySelector('#save-segment').disabled = true; }
    else if (action === 'save-segment') { const item = r.value.items.find(i => i.id === activeTap.id), bpm = segmentBpm(activeTap.times); if (bpm == null) return; item.segments.push({ id: crypto.randomUUID(), bpm, beatUnit: item.beatUnit, tapCount: activeTap.times.length, durationMs: activeTap.times.at(-1) - activeTap.times[0] }); await saveRecord(r); const id = activeTap.id; document.querySelector('dialog').close(); editor(); tapDialog(id); }
    else if (action === 'remove-segment') { const item = r.value.items.find(i => i.id === activeTap.id); item.segments = item.segments.filter(s => s.id !== t.dataset.id); await saveRecord(r); document.querySelector('#segment-list').innerHTML = segmentList(item); }
    else if (action === 'finish') await finishMeeting();
    else if (action === 'join') { r.value.eventId = t.dataset.id; r.joinChecked = true; document.querySelector('dialog').close(); await saveRecord(r); await finishMeeting(); }
    else if (action === 'separate') { document.querySelector('dialog').close(); await finishMeeting(true); }
    else if (action === 'archive') { r.value.archived = true; await saveRecord(r); location.hash = '#log'; toast('Report archived. Its history is retained.'); }
    else if (action === 'resolve') conflictDialog();
    else if (action === 'export-record') download(r, `hymn-record-${r.value.date}.json`);
    else if (action === 'export-all') { t.disabled = true; download(isAdmin() ? await cloud.exportAll() : { schemaVersion: 1, records: visibleRecords(), exportedAt: new Date().toISOString() }, `hymn-stats-private-${today()}.json`); t.disabled = false; }
    else if (action === 'export-private-csv') download(csv(visibleRecords().map(r => ({ date: r.value.date, congregation: r.value.congregation, meetingType: r.value.meetingType, chorister: r.privateValue?.chorister, organist: r.privateValue?.organist, status: r.value.status })), ['date', 'congregation', 'meetingType', 'chorister', 'organist', 'status']), `hymn-stats-private-${today()}.csv`, 'text/csv');
    else if (action === 'export-public') { const stats = statistics(snapshot.meetings, catalog, state.filters); download(csv(stats.songs.map(s => ({ title: s.label, collection: COLLECTIONS[s.collection], number: s.number, meetings: s.meetings, performances: s.performances, lastRecorded: s.lastRecorded })), ['title', 'collection', 'number', 'meetings', 'performances', 'lastRecorded']), `hymn-history-${today()}.csv`, 'text/csv'); }
    else if (action === 'demo') { state.originalSnapshot = snapshot; snapshot = sample(); state.demo = true; explorer(); }
    else if (action === 'exit-demo') { snapshot = state.originalSnapshot; state.demo = false; state.filters = {}; explorer(); }
    else if (action === 'clear-filters') { state.filters = {}; state.search = ''; explorer(); }
    else if (action === 'history') { const entries = await cloud.history(t.dataset.id); dialog(`<h2>Revision history</h2><div class="history-list">${entries.map(h => `<details><summary>Revision ${h.after.version} · ${esc(h.after.updatedAt || '')}</summary><pre>${esc(JSON.stringify(h, null, 2))}</pre></details>`).join('') || '<p>No revisions found.</p>'}</div>`); }
    else if (action === 'select-report') { const report = state.records.find(x => x.id === t.dataset.id); await cloud.selectReport(report.value.eventId, report.id); toast('Preferred hymn report selected. Rebuild the public site to publish it.'); }
    else if (action === 'rebuild') {
      t.disabled = true; const run = await cloud.rebuild(), element = document.querySelector('#run-status');
      element.innerHTML = `Rebuild requested. <a href="${esc(run.html_url || cloud.workflowUrl())}" target="_blank" rel="noopener noreferrer">View on GitHub</a>`;
      clearInterval(runTimer);
      if (run.workflow_run_id) runTimer = setInterval(async () => { try { const current = await cloud.runStatus(run.workflow_run_id); const status = document.querySelector('#run-status'); if (!status) { clearInterval(runTimer); return; } status.innerHTML = `${current.status === 'completed' ? current.conclusion === 'success' ? 'Rebuild completed.' : `Rebuild ${esc(current.conclusion)}.` : `Rebuild ${esc(current.status)}.`} <a href="${esc(current.html_url)}" target="_blank" rel="noopener noreferrer">View on GitHub</a>`; if (current.status === 'completed') clearInterval(runTimer); } catch (error) { clearInterval(runTimer); toast(error.message, true); } }, 6000);
      t.disabled = false;
    }
    else if (action === 'import-issue') await importIssueDialog(t.dataset.id);
    else if (action === 'resolve-import') { t.disabled = true; await syncAll(); await cloud.resolveImport(t.dataset.id, t.dataset.choice); document.querySelector('dialog').close(); const rows = await cloud.reports(state.user, state.member); for (const remote of rows) { let envelope = state.records.find(r => r.id === remote.value.id); if (envelope?.dirty) continue; const updated = { id: remote.value.id, ...remote, base: clone(remote.value), basePrivate: clone(remote.privateValue), dirty: false }; if (envelope) Object.assign(envelope, updated); else { envelope = updated; state.records.push(envelope); } await local.put(envelope); } await adminView(); toast('Source correction resolved. Rebuild the public site to publish the update.'); }
  } catch (error) { t.disabled = false; toast(error.message, true); }
});
async function importIssueDialog(id) {
  const issue = state.importIssues.find(i => i.id === id);
  dialog(`<h2>${esc(issue.type)}</h2><p>${esc(issue.message)}</p><pre>${esc(JSON.stringify(issue.details || {}, null, 2))}</pre>${issue.incoming ? `<p>Changes to different fields will be combined. Choose which values win in conflicting fields.</p><div class="button-row"><button class="button secondary" data-action="resolve-import" data-id="${esc(id)}" data-choice="website">Keep website values</button><button class="button" data-action="resolve-import" data-id="${esc(id)}" data-choice="spreadsheet">Use spreadsheet values</button></div>` : ''}${issue.reportId ? `<p><a href="#record/${esc(issue.reportId)}">Open report</a> to inspect or archive it. Missing source rows are never deleted automatically.</p>` : ''}`);
}
window.addEventListener('hashchange', () => { document.querySelector('dialog')?.close(); render(); window.scrollTo(0, 0); });
window.addEventListener('online', () => { updateStatus(); syncAll(); }); window.addEventListener('offline', updateStatus);
window.addEventListener('pagehide', () => { if (cloud) cloud.githubToken = null; });
try {
  const get = async (path, fallback) => { try { const res = await fetch(`${import.meta.env.BASE_URL}${path}`); if (!res.ok || !res.headers.get('content-type')?.includes('json')) return fallback; return await res.json(); } catch { return fallback; } };
  [config, catalog, snapshot] = await Promise.all([get('config.json', {}), get('data/catalog.json', []), get('data/snapshot.json', { schemaVersion: 1, generatedAt: null, meetings: [] })]);
  cloud = new Cloud(config); state.records = await local.all(); state.loading = false; render();
  cloud.watch(async (user, member, error) => {
    state.user = user; state.member = member; if (error) state.syncError = error.message;
    if (user && member) {
      for (const r of state.records.filter(x => x.value.ownerId === localOwner)) { r.value.ownerId = user.uid; r.base.ownerId = user.uid; await local.put(r); }
      try {
        const [remoteRecords, events] = await Promise.all([cloud.reports(user, member), cloud.events()]); state.events = events;
        for (const remote of remoteRecords) {
          const existing = state.records.find(r => r.id === remote.value.id);
          if (existing?.dirty) continue;
          const envelope = { id: remote.value.id, ...remote, base: clone(remote.value), basePrivate: clone(remote.privateValue), dirty: false };
          if (existing) Object.assign(existing, envelope); else state.records.push(envelope); await local.put(envelope);
        }
      } catch (e) { state.syncError = e.message; }
      await syncAll();
    }
    render();
  });
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(e => console.warn('Offline shell unavailable:', e.message));
} catch (error) {
  app.innerHTML = `<main class="empty"><h1>Couldn’t open your hymn log</h1><p>${esc(error.message)}</p><p>Enable browser storage and reload. Existing records have not been deleted.</p><button onclick="location.reload()">Reload</button></main>`;
}
