import { readJson, writeJson } from './admin.js';
const current = await readJson('public/data/catalog.json'), official = await readJson('data/catalog-additions.json');
const collectionIds = { 'hymns-1985': 'hymns', 'childrens-songbook': 'children', 'hymns-for-home-and-church': 'home-church' };
const result = new Map(current.map(s => [`${s.collection}:${s.number}`, s]));
for (const s of official.songs) {
  const collection = collectionIds[s.collectionId], key = `${collection}:${s.number}`, before = result.get(key);
  result.set(key, { collection, number: String(s.number), title: s.title, beatUnit: before?.beatUnit || null, tempoLow: before?.tempoLow || null, tempoHigh: before?.tempoHigh || null, ...(before?.tempoAlternatives ? { tempoAlternatives: before.tempoAlternatives } : {}), officialUrl: s.officialUrl });
}
await writeJson('public/data/catalog.json', [...result.values()]);
console.log(JSON.stringify({ songs: result.size, collections: Object.keys(collectionIds).length }));
