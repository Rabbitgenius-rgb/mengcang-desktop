import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile), root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts/install-native-host.mjs');
test('dry run writes nothing; isolated installation is self-contained and backs up own registration', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-extension-install-'));
  try {
    const {stdout} = await exec(process.execPath, [script, '--home', home, '--dry-run']); const plan = JSON.parse(stdout);
    await assert.rejects(fs.stat(plan.hostDirectory), {code: 'ENOENT'});
    await exec(process.execPath, [script, '--home', home]);
    assert((await fs.stat(path.join(plan.hostDirectory, 'launch-host'))).mode & 0o100);
    for (const file of plan.manifestFiles) {
      const value = JSON.parse(await fs.readFile(file)); assert.deepEqual(value.allowed_origins, [`chrome-extension://${plan.extensionId}/`]); assert(value.path.startsWith(plan.hostDirectory));
    }
    assert((await fs.stat(path.join(plan.hostDirectory, 'clipper-host.cjs'))).size > 10000);
    await exec(process.execPath, [script, '--home', home]);
    assert((await fs.readdir(path.dirname(plan.manifestFiles[0]))).some(name => name.includes('.backup-')));
  } finally {await fs.rm(home, {recursive: true, force: true});}
});
test('installer never replaces a host registered for another extension', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-extension-foreign-'));
  try {
    const {stdout} = await exec(process.execPath, [script, '--home', home, '--dry-run']); const plan = JSON.parse(stdout);
    const file = plan.manifestFiles[0], original = JSON.stringify({name: plan.hostName, allowed_origins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']});
    await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, original);
    await assert.rejects(exec(process.execPath, [script, '--home', home]));
    assert.equal(await fs.readFile(file, 'utf8'), original); await assert.rejects(fs.stat(plan.hostDirectory), {code: 'ENOENT'});
  } finally {await fs.rm(home, {recursive: true, force: true});}
});
