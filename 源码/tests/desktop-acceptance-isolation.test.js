'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {acceptanceProfile} = require('../desktop/acceptance-profile.cjs');

test('acceptance profiles share only the synthetic vault, and cannot redirect any writable path to trial data', async (t) => {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'mengcang-isolation-'));
  t.after(() => fs.rm(parent, {recursive: true, force: true}));
  const root = path.join(parent, 'runs'), run = path.join(root, 'run-abc123'), trial = path.join(parent, 'trial');
  const config = {acceptanceRunsRoot: root, userDataPath: trial};
  await fs.mkdir(trial);
  for (const folder of ['vault', ...['source', 'target'].flatMap(profile => ['profile', 'bridge', 'companion'].map(child => path.join(profile, child)))]) {
    await fs.mkdir(path.join(run, folder), {recursive: true});
  }
  const a = acceptanceProfile(config, 'run-abc123/source'), b = acceptanceProfile(config, 'run-abc123/target');
  assert.equal(a.vaultPath, b.vaultPath);
  for(const key of ['userDataPath','recallBridgeDirectory','recallCompanionDirectory']) {
    assert.notEqual(a[key],b[key]); assert.ok(a[key].startsWith(path.join(run, 'source') + path.sep));
  }
  assert.throws(() => acceptanceProfile(config, '../trial'), /不支持/);
  assert.throws(() => acceptanceProfile({}, 'run-abc123/source'), /不支持/);
  await fs.rmdir(b.userDataPath);
  await fs.symlink(trial, b.userDataPath);
  assert.throws(() => acceptanceProfile(config, 'run-abc123/target'), /重定向/);
  assert.equal(config.userDataPath, trial);
});
