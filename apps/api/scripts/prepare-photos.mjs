// One-off helper: turns the downloaded Wikimedia originals in apps/api/seed-photos into
//  - smaller 1800px JPEGs (so the repo stays light), and
//  - portrait region-card photos in apps/web/public/regions/<slug>.jpg.
// Run from apps/api:  node scripts/prepare-photos.mjs
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.resolve(process.cwd(), 'seed-photos');
const regions = path.resolve(process.cwd(), '../web/public/regions');
await mkdir(regions, { recursive: true });

// region slug -> photo (Akkar has no free photo yet and keeps its colour card)
const REGION_PHOTO = {
  beirut: 'beirut-pigeon-rocks',
  chouf: 'beiteddine-courtyard',
  jbeil: 'byblos-harbour',
  bekaa: 'baalbek-bacchus',
  north: 'qadisha-aerial',
  south: 'sidon-seacastle',
};

for (const [slug, key] of Object.entries(REGION_PHOTO)) {
  const src = path.join(dir, `${key}.jpg`);
  if (!existsSync(src)) { console.log('skip region', slug, '(photo missing)'); continue; }
  const out = await sharp(await readFile(src)).rotate().resize({ width: 720, height: 960, fit: 'cover', position: 'attention' }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  await writeFile(path.join(regions, `${slug}.jpg`), out);
  console.log('region', slug, Math.round(out.length / 1024), 'KB');
}

for (const f of (await import('node:fs')).readdirSync(dir).filter((n) => n.endsWith('.jpg'))) {
  const p = path.join(dir, f);
  const buf = await sharp(await readFile(p)).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  await writeFile(p, buf);
  console.log('shrunk', f, Math.round(buf.length / 1024), 'KB');
}
