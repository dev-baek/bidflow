import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('existing output and repository paths are rejected before service access', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bidflow-measure-test-'));
  const file = path.join(temp, 'existing.json');
  await writeFile(file, 'keep');
  t.after(async () => { await unlink(file); await rmdir(temp); });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  for (const output of [file, path.join(root, 'never-created-evidence.json')]) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/measure-final-settlement.mjs'), output], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Supply a new external output path/);
  }
  assert.equal(await readFile(file, 'utf8'), 'keep');
});
