import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const services = readdirSync('services', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => entry.name)
  .sort();

let failed = 0;
for (const service of services) {
  console.log(`\n=== ${service} ===`);
  const result = spawnSync('npm', ['test', '--prefix', join('services', service)], {
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`\n${failed} service test suite(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${services.length} service test suites passed.`);
