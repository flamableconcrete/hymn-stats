export const COLLECTIONS = { hymns: 'Hymns (1985)', 'home-church': 'Hymns—For Home and Church', children: "Children’s Songbook", other: 'Other music' };
export const MEETING_TYPES = ['Sacrament meeting', 'Primary', 'Ward council', 'Bishopric meeting', 'Stake conference', 'Baptism', 'Priesthood meeting', 'Relief Society', 'Sunday School', 'Other'];
export const ROLES = ['Opening', 'Sacrament', 'Congregational hymn', 'Closing', 'Other'];
export const clone = (value) => structuredClone(value);
export const normalize = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function makeItem(role = 'Other') {
  return { id: crypto.randomUUID(), role, collection: 'hymns', number: '', title: '', performanceType: 'congregational', status: 'planned', beatUnit: 'quarter', segments: [], bpmOverride: null, verses: '' };
}
export function makeObservation(ownerId, defaults = {}) {
  const type = defaults.meetingType || 'Sacrament meeting';
  return { id: crypto.randomUUID(), eventId: crypto.randomUUID(), ownerId, date: today(), congregation: defaults.congregation || '', meetingType: type,
    status: 'draft', items: (type === 'Sacrament meeting' ? ROLES.slice(0, 4) : ['Opening', 'Closing']).map(makeItem),
    stood: '', sacramentReady: '', sundayType: '', holiday: '', notes: '', archived: false, version: 0 };
}
export function validateObservation(o) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '') || !Number.isFinite(Date.parse(`${o.date}T12:00:00Z`)) || new Date(`${o.date}T12:00:00Z`).toISOString().slice(0, 10) !== o.date) errors.push('Choose a meeting date.');
  if (!normalize(o.congregation)) errors.push('Enter a congregation.');
  if (!normalize(o.meetingType)) errors.push('Choose a meeting type.');
  if (!o.items?.some(i => normalize(i.number) || normalize(i.title))) errors.push('Add at least one hymn or song by number or title.');
  if (o.items?.some(i => (normalize(i.number) || normalize(i.title)) && i.status === 'planned')) errors.push('Mark each entered item as performed, partly performed, or skipped before finishing.');
  for (const item of o.items || []) {
    if (item.bpmOverride != null && item.bpmOverride !== '' && (!Number.isFinite(Number(item.bpmOverride)) || Number(item.bpmOverride) < 20 || Number(item.bpmOverride) > 300)) errors.push('Tempo must be between 20 and 300 BPM.');
  }
  return [...new Set(errors)];
}
export function segmentBpm(taps) {
  if (taps.length < 3) return null;
  const elapsed = taps.at(-1) - taps[0];
  const result = 60000 * (taps.length - 1) / elapsed;
  return Number.isFinite(result) && result >= 20 && result <= 300 ? Math.round(result * 10) / 10 : null;
}
export function mean(values) { const a = values.map(Number).filter(Number.isFinite); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
export const BEAT_FACTORS = { eighth: 0.5, quarter: 1, half: 2, 'dotted-quarter': 1.5, 'dotted-half': 3, unknown: 0 };
export function convertBpm(bpm, from, to) { return BEAT_FACTORS[from] && BEAT_FACTORS[to] ? Number(bpm) * BEAT_FACTORS[from] / BEAT_FACTORS[to] : null; }
export function itemBpm(i) { return i.bpmOverride !== null && i.bpmOverride !== '' && i.bpmOverride !== undefined ? Number(i.bpmOverride) : mean((i.segments || []).map(s => convertBpm(s.bpm, s.beatUnit || i.beatUnit, i.beatUnit)).filter(x => x !== null)); }
export function resolveConflicts(merged, choices) {
  let value = clone(merged.value);
  for (const conflict of merged.conflicts) {
    if (choices[conflict.path] !== 'remote') continue;
    if (!conflict.path) { value = clone(conflict.remote); continue; }
    const order = conflict.path.endsWith(' (order)'), path = conflict.path.replace(/ \(order\)$/, '');
    const keys = [...path.matchAll(/([^.[\]]+)|\[([^\]]+)\]/g)].map(m => ({ key: m[1] || m[2], id: !!m[2] }));
    let cursor = value;
    for (const part of keys.slice(0, -1)) cursor = part.id ? cursor.find(x => x.id === part.key) : cursor[part.key];
    const last = keys.at(-1);
    if (order) { const array = cursor[last.key]; cursor[last.key] = conflict.remote.map(id => array.find(x => x.id === id)).filter(Boolean).concat(array.filter(x => !conflict.remote.includes(x.id))); }
    else if (last.id) { const index = cursor.findIndex(x => x.id === last.key); if (conflict.remote === undefined) { if (index >= 0) cursor.splice(index, 1); } else if (index < 0) cursor.push(clone(conflict.remote)); else cursor[index] = clone(conflict.remote); }
    else if (conflict.remote === undefined) delete cursor[last.key]; else cursor[last.key] = clone(conflict.remote);
  }
  return value;
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// Merge individual object fields and item IDs, never array positions. A conflicting field stays local until reviewed.
export function mergeThreeWay(base, local, remote, path = '') {
  if (same(local, remote)) return { value: clone(local), conflicts: [] };
  if (same(base, local)) return { value: clone(remote), conflicts: [] };
  if (same(base, remote)) return { value: clone(local), conflicts: [] };
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote) && [...base, ...local, ...remote].every(x => x && typeof x === 'object' && x.id)) {
    const order = local.map(x => x.id).concat(remote.filter(r => !local.some(l => l.id === r.id)).map(x => x.id));
    const value = [], conflicts = [];
    for (const id of order) {
      const b = base.find(x => x.id === id), l = local.find(x => x.id === id), r = remote.find(x => x.id === id);
      if (!b) { if (l && r) { const m = mergeThreeWay({}, l, r, `${path}[${id}]`); value.push(m.value); conflicts.push(...m.conflicts); } else value.push(clone(l || r)); continue; }
      if (!l || !r) { if (same(b, l || r)) continue; conflicts.push({ path: `${path}[${id}]`, base: b, local: l, remote: r }); if (l) value.push(clone(l)); continue; }
      const m = mergeThreeWay(b, l, r, `${path}[${id}]`); value.push(m.value); conflicts.push(...m.conflicts);
    }
    const originalOrder = base.map(x => x.id).filter(id => local.some(x => x.id === id) && remote.some(x => x.id === id));
    const localOrder = local.map(x => x.id).filter(id => originalOrder.includes(id));
    const remoteOrder = remote.map(x => x.id).filter(id => originalOrder.includes(id));
    if (!same(localOrder, originalOrder) && !same(remoteOrder, originalOrder) && !same(localOrder, remoteOrder)) conflicts.push({ path: `${path} (order)`, base: originalOrder, local: localOrder, remote: remoteOrder });
    const preferredOrder = same(localOrder, originalOrder) && !same(remoteOrder, originalOrder) ? remote.map(x => x.id) : order;
    const reordered = preferredOrder.map(id => value.find(x => x.id === id)).filter(Boolean).concat(value.filter(x => !preferredOrder.includes(x.id)));
    return { value: reordered, conflicts };
  }
  if (base && local && remote && !Array.isArray(local) && typeof base === 'object' && typeof local === 'object' && typeof remote === 'object') {
    const value = {}, conflicts = [];
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      if (['version', 'updatedAt', 'lastMutationId'].includes(key)) { if (remote[key] !== undefined) value[key] = clone(remote[key]); continue; }
      const m = mergeThreeWay(base[key], local[key], remote[key], path ? `${path}.${key}` : key);
      if (m.value !== undefined) value[key] = m.value;
      conflicts.push(...m.conflicts);
    }
    return { value, conflicts };
  }
  return { value: clone(local), conflicts: [{ path, base, local, remote }] };
}
export function songKey(i) { return i.catalogPending ? `pending:${i.id}` : normalize(i.number) ? `${i.collection}:${normalize(i.number)}` : `title:${normalize(i.title).toLowerCase()}`; }
export function songLabel(i, catalog = []) { const found = catalog.find(s => s.collection === i.collection && String(s.number) === String(i.number)); return i.title || found?.title || (i.number ? `Hymn ${i.number}` : 'Untitled musical number'); }
export function statistics(meetings, catalog = [], filters = {}) {
  const rows = meetings.filter(m => !m.archived && (!filters.congregation || m.congregation === filters.congregation) && (!filters.meetingType || m.meetingType === filters.meetingType) && (!filters.from || m.date >= filters.from) && (!filters.to || m.date <= filters.to));
  const songs = new Map(), years = new Map();
  for (const m of rows) {
    years.set(m.date.slice(0, 4), (years.get(m.date.slice(0, 4)) || 0) + 1);
    for (const i of m.items || []) {
      if (!['performed', 'partial'].includes(i.status) || !normalize(i.number || i.title)) continue;
      if ((filters.performanceType || 'congregational') !== 'all' && i.performanceType !== (filters.performanceType || 'congregational')) continue;
      const key = songKey(i), s = songs.get(key) || { key, label: songLabel(i, catalog), number: i.number, collection: i.collection, meetings: new Set(), performances: 0, lastRecorded: '', tempos: [] };
      s.meetings.add(m.id); s.performances++; s.lastRecorded = s.lastRecorded > m.date ? s.lastRecorded : m.date;
      const bpm = itemBpm(i); if (bpm != null) s.tempos.push({ bpm, beatUnit: i.beatUnit });
      songs.set(key, s);
    }
  }
  return { meetingCount: rows.length, songs: [...songs.values()].map(s => ({ ...s, meetings: s.meetings.size })).sort((a, b) => b.meetings - a.meetings || b.performances - a.performances || a.label.localeCompare(b.label)), years: [...years].sort(([a], [b]) => a.localeCompare(b)), rows };
}
