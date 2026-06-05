#!/usr/bin/env node
// Download all R6 rank icons from stats.cc into public/icons/ranks/.
// Run: node scripts/scrape-rank-icons.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons', 'ranks');

// Per-division tiers Copper..Diamond plus Champion. Note: `v7-` slugs are NEWER models
// (current Y10+ artwork). Non-prefixed slugs are OLDER models. We download both so the
// extension can render any historical rank a player might have.
//
// Despite shipping per-division Champion icons, the popup renderer overrides ALL Champion
// divisions to the single `champion-star` icon (legacy, distinctive). If you ever want to
// surface the new per-division Champion artwork, edit `resolveIconSlug` in statscc-rank.ts.
const TIERS = ['copper', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'champion'];
const DIVISIONS = ['v', 'iv', 'iii', 'ii', 'i'];
const V7_PREFIX = 'v7-';

const SLUGS = (() => {
  const s = new Set();
  for (const tier of TIERS) {
    for (const div of DIVISIONS) {
      s.add(`${tier}-${div}`);
      s.add(`${V7_PREFIX}${tier}-${div}`);
    }
  }
  s.add('unranked');
  s.add(`${V7_PREFIX}unranked`);
  s.add('champion-star');
  return [...s].sort();
})();

const BASE = 'https://static.stats.cc/siege/ranks';

async function downloadOne(slug) {
  const url = `${BASE}/${slug}-small.webp`;
  const out = join(OUT_DIR, `${slug}-small.webp`);
  if (existsSync(out)) return { slug, status: 'skipped' };

  const res = await fetch(url);
  if (!res.ok) return { slug, status: `http_${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  return { slug, status: 'downloaded', bytes: buf.length };
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const results = [];
  // Run in small batches to avoid rate-limiting.
  const BATCH = 8;
  for (let i = 0; i < SLUGS.length; i += BATCH) {
    const chunk = SLUGS.slice(i, i + BATCH);
    const settled = await Promise.all(chunk.map(downloadOne));
    results.push(...settled);
  }

  const downloaded = results.filter((r) => r.status === 'downloaded');
  const skipped = results.filter((r) => r.status === 'skipped');
  const failed = results.filter((r) => r.status.startsWith('http_'));
  const totalBytes = downloaded.reduce((sum, r) => sum + (r.bytes ?? 0), 0);

  console.log(`Downloaded ${downloaded.length} (${(totalBytes / 1024).toFixed(1)} KB)`);
  console.log(`Skipped ${skipped.length} (already on disk)`);
  if (failed.length) {
    console.log(`Failed ${failed.length}:`);
    for (const f of failed) console.log(`  ${f.slug}: ${f.status}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
