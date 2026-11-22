import { defineConfig } from 'vite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
export default defineConfig({ base: './', build: { target: 'es2022' }, plugins: [{ name: 'offline-shell', async closeBundle() {
  const walk = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
  const files = (await walk('dist')).filter(p => !p.endsWith('sw.js'));
  const hash = createHash('sha256'); for (const file of files) hash.update(await readFile(file));
  let sw = await readFile('public/sw.js', 'utf8'); sw = sw.replace('__BUILD_ID__', hash.digest('hex').slice(0, 16)).replace('__ASSET_MANIFEST__', JSON.stringify(files.map(p => `./${p.replaceAll('\\', '/').replace(/^dist\//, '')}`)));
  await writeFile('dist/sw.js', sw);
} }] });
