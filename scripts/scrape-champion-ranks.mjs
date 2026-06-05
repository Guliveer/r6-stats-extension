#!/usr/bin/env node
// Download all tracker.gg champion-ranks PNGs (1..9999) into
// public/icons/ranks/champion-ranks/. These have the leaderboard rank baked into the
// artwork — we ship them so we can swap stats.cc Champion icons (which only show plain
// "Champion" art) onto the more informative tracker.gg variant.
//
// Run: node scripts/scrape-champion-ranks.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons', 'ranks', 'champion-ranks');

const MIN = 1;
const MAX = 9999;
const CONCURRENCY = 20;

async function downloadOne(n) {
  const out = join(OUT_DIR, `${n}.png`);
  if (existsSync(out)) return { n, status: 'skipped' };

  const url = `https://trackercdn.com/cdn/r6.tracker.network/ranks/champion-ranks/${n}.png?v=6`;
  const res = await fetch(url);
  if (!res.ok) return { n, status: `http_${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  return { n, status: 'downloaded', bytes: buf.length };
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;
  let nextN = MIN;
  let lastReport = Date.now();

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const n = nextN++;
      if (n > MAX) return;
      try {
        const r = await downloadOne(n);
        if (r.status === 'downloaded') { downloaded++; totalBytes += r.bytes ?? 0; }
        else if (r.status === 'skipped') skipped++;
        else failed++;
      } catch {
        failed++;
      }
      // Throttle log to once per ~2s to avoid spamming.
      const now = Date.now();
      if (now - lastReport > 2000) {
        lastReport = now;
        console.log(`progress: n≈${n}, downloaded=${downloaded}, skipped=${skipped}, failed=${failed}, ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
      }
    }
  });
  await Promise.all(workers);

  console.log(`\nDone. downloaded=${downloaded}, skipped=${skipped}, failed=${failed}, total ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
