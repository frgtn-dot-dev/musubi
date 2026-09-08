import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = resolve(root, 'scripts/fixtures/query-string-native.cjs');
// Bound the process: a decoder regression must fail rather than hang CI.
const node = spawnSync(process.execPath, [fixture], { timeout: 10_000, encoding: 'utf8' });
assert.equal(node.status, 0, node.error?.message ?? node.stderr);

const require = createRequire(import.meta.url);
const Metro = require('metro');
const config = require('../apps/client/metro.config.js');
config.maxWorkers = 2;
config.reporter = { update() {} };
const { code } = await Metro.runBuild(config, {
  entry: fixture,
  platform: 'ios',
  dev: false,
  minify: true,
});
const sandbox = { console, setTimeout, clearTimeout, performance };
vm.runInNewContext(code, sandbox, { timeout: 10_000 });
assert.equal(sandbox.__musubiQueryStringVerified, true);
console.log('Query-string Node and native Metro runtime compatibility: OK');
