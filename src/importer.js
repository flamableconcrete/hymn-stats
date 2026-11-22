import { createHash, randomUUID } from 'node:crypto';
import { clone, normalize } from './domain.js';
export { planImport } from './import-plan.js';
export const ID_HEADER = 'Hymn Stats ID';
export function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function columnLetter(index) { let s = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
export function sourceCells(row, idColumn) { const values = Array.from(row, x => x ?? null).filter((_, index) => index !== idColumn); while (values.length && (values.at(-1) === '' || values.at(-1) === null)) values.pop(); return values; }
export function sheetDate(value) {
  if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  const s = normalize(value); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}
export function ensureSourceIds(values, { dryRun = false } = {}) {
  if (!values.length) return { values: [], idColumn: 0, updates: [], addedColumn: false };
  const copy = clone(values), index = copy[0].findIndex(x => normalize(x) === ID_HEADER);
  const idColumn = index >= 0 ? index : Math.max(...copy.map(r => r.length));
  const updates = [], seen = new Set();
  if (index < 0) { copy[0][idColumn] = ID_HEADER; updates.push({ row: 1, column: idColumn, value: ID_HEADER }); }
  for (let n = 1; n < copy.length; n++) {
    if (!copy[n].slice(0, idColumn).some(x => x !== null && x !== undefined && x !== '')) continue;
    let id = copy[n][idColumn];
    if (!id) { id = dryRun ? `preview-${hash(copy[n].slice(0, idColumn)).slice(0, 24)}` : randomUUID(); copy[n][idColumn] = id; updates.push({ row: n + 1, column: idColumn, value: id }); }
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(id))) throw new Error(`Invalid source ID at row ${n + 1}. Review it before importing.`);
    if (seen.has(id)) throw new Error(`Duplicate source ID ${id} at row ${n + 1}. No records were imported.`);
    seen.add(id);
  }
  return { values: copy, idColumn, updates, addedColumn: index < 0 };
}
const truth = value => { const s = normalize(value).toLowerCase(); return ['yes', 'true', 'y'].includes(s) ? 'yes' : ['no', 'false', 'n'].includes(s) ? 'no' : /^(n\/?a|not applicable)$/.test(s) ? 'na' : ''; };
function musicType(kind) { const s = normalize(kind).toLowerCase(); return /choir/.test(s) ? 'choir' : /instrument|horn/.test(s) ? 'instrumental' : /solo/.test(s) ? 'solo' : /special|primary program|christmas selections|lots of/.test(s) ? 'special' : 'congregational'; }
function parsePieces(value) { const s = normalize(value); if (!s) return []; if (/medley/i.test(s)) return [s]; return s.split(/,\s*(?![^()]*\))/).map(normalize).filter(Boolean); }
function importedItems(cell, { id, role, kind = '', tempo, verses = '', catalog }) {
  const exact = catalog.find(s => normalize(s.title).toLowerCase() === normalize(cell).toLowerCase());
  return (exact ? [normalize(cell)] : parsePieces(cell)).map((piece, index) => {
    const children = /children'?s songbook/i.test(piece) || /children'?s songbook/i.test(kind);
    const number = piece.match(/^(\d+[a-z]?)(?:\s*\((?:children'?s songbook)\))?$/i)?.[1] || piece.match(/^choir\s*\((\d+)\)$/i)?.[1] || '';
    const collection = children ? 'children' : Number(number) >= 1000 ? 'home-church' : number ? 'hymns' : 'other';
    const found = number ? catalog.find(s => s.collection === collection && String(s.number) === number) : catalog.find(s => normalize(s.title).toLowerCase() === piece.toLowerCase());
    const type = /medley/i.test(piece) ? 'special' : /^choir\s*\(/i.test(piece) ? 'choir' : musicType(kind);
    const title = found?.title || (number ? '' : piece);
    return { id: `${id}-${role.toLowerCase().replaceAll(' ', '-')}-${index}`, role, collection: found?.collection || collection, number: number || (found ? String(found.number) : ''), title,
      performanceType: type, status: 'performed', beatUnit: found?.tempoAlternatives?.length > 1 ? 'unknown' : found?.beatUnit || 'unknown', segments: [], bpmOverride: Number(tempo) >= 20 && Number(tempo) <= 300 ? Number(tempo) : null, verses: normalize(verses),
      ...(!number && !found ? { titleNeedsReview: true, publicTitle: /medley/i.test(piece) ? 'Medley' : '' } : {}) };
  });
}
export function parseSourceRow(row, { id, kind, ownerId, catalog = [], sourceKey, rowNumber }) {
  const items = [], warnings = [];
  let congregation, meetingType, privateData = {};
  if (kind === 'sacrament') {
    congregation = normalize(row[12]); meetingType = /stake conference/i.test(normalize(row[13])) ? 'Stake conference' : 'Sacrament meeting';
    for (const [column, role] of [[2, 'Opening'], [4, 'Sacrament'], [6, 'Congregational hymn'], [10, 'Closing']]) items.push(...importedItems(row[column], { id, role, kind: column === 6 ? row[8] : '', tempo: row[column + 1], catalog }));
    privateData = { chorister: normalize(row[15]), organist: normalize(row[16]), notes: '', legacy: { sourceKey, rowNumber, raw: Array.from(row, x => x ?? null) } };
  } else {
    congregation = normalize(row[2]); meetingType = normalize(row[3]) || (kind === 'primary' ? 'Primary' : 'Other');
    for (let column = 4; column < row.length; column += 3) items.push(...importedItems(row[column], { id: `${id}-${column}`, role: column === 4 ? 'Opening' : 'Other', tempo: row[column + 1], verses: row[column + 2], catalog }));
    privateData = { chorister: '', organist: '', notes: '', legacy: { sourceKey, rowNumber, raw: Array.from(row, x => x ?? null) } };
  }
  if (!items.length) warnings.push('No identifiable musical item. Preserve for review; do not infer that no music occurred.');
  if (items.some(i => i.titleNeedsReview)) warnings.push('Review free-text titles before publishing original text; they may include performer names.');
  if (items.some(i => i.beatUnit === 'unknown' && i.bpmOverride !== null)) warnings.push('Confirm beat units for historical tempos with multiple reference units.');
  const date = sheetDate(row[1]); if (!date || !congregation) warnings.push('Missing date or congregation.');
  const value = { id, eventId: `event-${id}`, ownerId, date, congregation, meetingType, status: items.length && date && congregation ? 'published' : 'draft', items, stood: kind === 'sacrament' ? truth(row[9]) : '', sacramentReady: kind === 'sacrament' ? truth(row[17]) : '', sundayType: kind === 'sacrament' ? normalize(row[13]) : '', holiday: kind === 'sacrament' ? normalize(row[14]) : '', notes: '', archived: false, version: 0 };
  return { value, privateData, warnings };
}
