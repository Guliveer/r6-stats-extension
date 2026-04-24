import { spawnSync } from 'node:child_process';

const entries = ['popup', 'service-worker', 'content', 'content-statscc'];

for (const entry of entries) {
  const result = spawnSync('npx', ['vite', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_ENTRY: entry },
    shell: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
