#!/usr/bin/env node
/**
 * Run `vite build` with ANALYZE=1 to emit bundle-stats.html + .json.
 * Cross-platform wrapper so the `analyze` npm script works on Windows and
 * POSIX shells without needing cross-env.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ANALYZE: '1' },
});

process.exit(result.status ?? 1);
