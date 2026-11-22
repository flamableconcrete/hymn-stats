import { clone, convertBpm, itemBpm, mean, normalize, songKey, songLabel } from './domain.js';

const approved = new Set(['id', 'role', 'collection', 'number', 'performanceType', 'status', 'beatUnit', 'verses']);
export function projectPublic(events, observations, catalog = [], generatedAt = new Date().toISOString()) {
  const byId = new Map(observations.map(o => [o.id, o])), meetings = [], warnings = [];
  for (const e of events) {
    if (e.archived || e.status !== 'published') continue;
    const selected = byId.get(e.selectedObservationId);
    if (!selected || selected.eventId !== e.id || selected.status !== 'published' || selected.archived) { warnings.push(`Meeting ${e.id} needs a valid selected report.`); continue; }
    const related = observations.filter(o => o.eventId === e.id && o.status === 'published' && !o.archived);
    const items = selected.items.filter(i => normalize(i.number || i.title)).map(i => {
      const out = {};
      for (const key of approved) if (i[key] !== undefined) out[key] = clone(i[key]);
      const matched = catalog.find(s => s.collection === i.collection && String(s.number) === String(i.number));
      out.title = matched?.title || (i.titleNeedsReview ? i.publicTitle || 'Special musical number (title under review)' : songLabel(i, catalog));
      out.catalogPending = !!i.titleNeedsReview;
      // IDs for native shared items are preferred. Legacy fallback requires unique role+song in both reports.
      const tempos = [];
      for (const report of related) {
        let candidate = report.items.find(x => x.id === i.id);
        if (!candidate) {
          const matches = report.items.filter(x => x.role === i.role && songKey(x) === songKey(i));
          if (matches.length === 1 && selected.items.filter(x => x.role === i.role && songKey(x) === songKey(i)).length === 1) candidate = matches[0];
        }
        if (candidate && ['performed', 'partial'].includes(candidate.status)) { const bpm = itemBpm(candidate); if (bpm != null) { const converted = convertBpm(bpm, candidate.beatUnit, i.beatUnit); if (converted != null) tempos.push(converted); } }
      }
      out.bpmOverride = mean(tempos); out.tempoObservers = tempos.length;
      out.tempoRange = tempos.length ? [Math.min(...tempos), Math.max(...tempos)] : null;
      return out;
    });
    meetings.push({ id: e.id, date: selected.date, congregation: selected.congregation, meetingType: selected.meetingType, sundayType: selected.sundayType || '', holiday: selected.holiday || '', stood: selected.stood || '', sacramentReady: selected.sacramentReady || '', items });
    if (related.some(r => JSON.stringify(r.items.map(x => [songKey(x), x.role, x.status])) !== JSON.stringify(selected.items.map(x => [songKey(x), x.role, x.status])))) warnings.push(`Meeting ${e.id} has differing hymn reports.`);
  }
  return { schemaVersion: 1, generatedAt, meetings: meetings.sort((a, b) => b.date.localeCompare(a.date)), warnings };
}
export function csv(rows, columns) {
  const escape = x => { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
  return [columns.map(escape).join(','), ...rows.map(r => columns.map(c => escape(r[c])).join(','))].join('\r\n');
}
