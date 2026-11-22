import { readJson, writeJson } from './admin.js';
import { copyFile, access } from 'node:fs/promises';
const config = process.env.PUBLIC_APP_CONFIG ? JSON.parse(process.env.PUBLIC_APP_CONFIG) : await readJson('public/config.example.json');
await writeJson('public/config.json', config);
try { await access('public/data/snapshot.json'); } catch { try { await copyFile('public/data/initial-history.json', 'public/data/snapshot.json'); } catch { await copyFile('public/data/snapshot.example.json', 'public/data/snapshot.json'); } }
