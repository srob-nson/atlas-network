import { spawnSync } from 'node:child_process';

// These checks share a disposable Chrome profile and must run in sequence.
const tests = ['physical', 'validation', 'entities', 'persistence', 'hierarchy', 'rack-alignment', 'floor-navigation', 'interactions', 'floor-connect', 'floor-outline'];
for (const test of tests) {
  console.log(`\nBrowser: ${test}`);
  const result = spawnSync(process.execPath, [`tests/browser-${test}.mjs`], { stdio: 'inherit', timeout: 45000 });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
