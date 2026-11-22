import { clone, mergeThreeWay } from './domain.js';
export function planImport(previous, current, incoming, incomingPrivate, sourceHash) {
  if (previous?.sourceHash === sourceHash) return { action: 'unchanged' };
  if (!current) return { action: 'create', value: incoming, privateData: incomingPrivate };
  if (!previous) return { action: 'conflict', conflicts: [{ path: 'source identity', local: current.value, remote: incoming }], message: 'This source ID already belongs to a website record without an import baseline.' };
  const base = clone(previous.sourceValue), source = clone(incoming);
  source.eventId = base.eventId = current.value.eventId; source.ownerId = base.ownerId = current.value.ownerId;
  const merged = mergeThreeWay(base, current.value, source);
  const privateMerged = mergeThreeWay(previous.sourcePrivate || {}, current.privateData || {}, incomingPrivate);
  const conflicts = [...merged.conflicts, ...privateMerged.conflicts.map(c => ({ ...c, path: `private.${c.path}` }))];
  if (conflicts.length) return { action: 'conflict', conflicts, merged, privateMerged };
  const value = merged.value; value.version = current.value.version;
  return { action: 'update', value, privateData: privateMerged.value, merged, privateMerged };
}
