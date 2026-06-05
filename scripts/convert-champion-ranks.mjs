#!/usr/bin/env node
// Recompress tracker.gg champion-rank icons to keep the bundle under Chrome Web
// Store's 100 MB limit. Writes the recompressed icons to a sibling `*.compressed`
// directory, then atomically swaps it in once the whole pass is done — avoids the
// "writing back to the file you just read" Windows EPERM dance.

import sharp from 'sharp';
import { readdir, writeFile, mkdir, rm, rename, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, '..', 'public', 'icons', 'ranks', 'champion-ranks');
const NEW_DIR = DIR + '.new';
const OLD_DIR = DIR + '.old';

const VALID = /^\d+\.(?:webp|png)$/;

async function main() {
  if (!existsSync(DIR)) { console.error('No champion-ranks dir'); process.exit(1); }

  // Start fresh: blow away any leftover staging directory from a prior aborted run.
  if (existsSync(NEW_DIR)) await rm(NEW_DIR, { recursive: true, force: true });
  if (existsSync(OLD_DIR)) await rm(OLD_DIR, { recursive: true, force: true });
  await mkdir(NEW_DIR, { recursive: true });

  const files = (await readdir(DIR)).filter((f) => VALID.test(f));
  console.log(`Recompressing ${files.length} files...`);

  const CONCURRENCY = 8;
  let nextIdx = 0;
  let converted = 0;
  let beforeBytes = 0;
  let afterBytes = 0;
  let lastReport = Date.now();

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= files.length) return;
      const name = files[i];
      const srcPath = join(DIR, name);
      try {
        const before = statSync(srcPath).size;
        // Read the bytes ourselves and pass to sharp — keeps sharp from holding a file
        // handle, which on Windows blocks the rename swap at the end of the run.
        const srcBuf = await readFile(srcPath);
        const buffer = await sharp(srcBuf).resize(128, 128).webp({ quality: 50 }).toBuffer();
        beforeBytes += before;
        afterBytes += buffer.length;
        const stem = name.replace(/\.(webp|png)$/, '');
        await writeFile(join(NEW_DIR, stem + '.webp'), buffer);
        converted++;
      } catch (err) {
        console.error(`Failed ${name}: ${err.message}`);
      }
      const now = Date.now();
      if (now - lastReport > 2000) {
        lastReport = now;
        console.log(`progress: converted=${converted}/${files.length}, before=${(beforeBytes / 1024 / 1024).toFixed(1)} MB, after=${(afterBytes / 1024 / 1024).toFixed(1)} MB`);
      }
    }
  });
  await Promise.all(workers);

  // Atomic swap: rename old → .old, new → canonical, then nuke .old.
  await rename(DIR, OLD_DIR);
  await rename(NEW_DIR, DIR);
  await rm(OLD_DIR, { recursive: true, force: true });

  console.log(`\nDone. converted=${converted}, ${(beforeBytes / 1024 / 1024).toFixed(1)} MB → ${(afterBytes / 1024 / 1024).toFixed(1)} MB (${((1 - afterBytes / beforeBytes) * 100).toFixed(0)}% smaller)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
