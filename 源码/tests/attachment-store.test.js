const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createFileAttachmentStore } = require('../desktop/attachment-store.cjs');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const file = { name: 'concept.png', type: 'image/png', size: Buffer.from(png, 'base64').length, dataUrl: `data:image/png;base64,${png}` };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-attachment-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: createFileAttachmentStore({ directory: path.join(directory, 'attachments') }) };
}
test('native attachments deduplicate bytes and preserve each caller file name', async (t) => {
  const { directory, store } = await fixture(t);
  const first = await store.put(file),
    second = await store.put({ ...file, name: 'second-name.png' });
  assert.deepEqual(first, second);
  assert.deepEqual(await store.read(first), Buffer.from(png, 'base64'));
  assert.deepEqual(await fs.readdir(path.join(directory, 'attachments')), [first.sha256]);
  assert.ok((await store.capacity()).availableBytes > 0);
});
test('native attachment access rejects forged paths, executable MIME and invalid input', async (t) => {
  const { store } = await fixture(t),
    ref = await store.put(file);
  await assert.rejects(store.read({ ...ref, sha256: '../outside' }), /引用无效/);
  await assert.rejects(store.read({ ...ref, type: 'text/html' }), /引用无效/);
  await assert.rejects(store.put({ ...file, dataUrl: 'data:image/png;base64,abcd' }), /无效|不匹配/);
  await assert.rejects(store.put({ ...file, size: file.size + 1 }), /不匹配/);
});
test('a corrupt existing attachment is reported and never silently replaced', async (t) => {
  const { directory, store } = await fixture(t),
    ref = await store.put(file);
  const location = path.join(directory, 'attachments', ref.sha256),
    bad = Buffer.alloc(file.size, 7);
  await fs.writeFile(location, bad);
  await assert.rejects(store.read(ref), /校验失败/);
  await assert.rejects(store.put(file), /校验失败/);
  assert.deepEqual(await fs.readFile(location), bad);
});
test('a hash-named symlink cannot expose a file outside the attachment directory', async (t) => {
  const { directory, store } = await fixture(t),
    ref = await store.put(file);
  const outside = path.join(directory, 'outside'),
    location = path.join(directory, 'attachments', ref.sha256);
  await fs.writeFile(outside, 'private unrelated file');
  await fs.unlink(location);
  await fs.symlink(outside, location);
  await assert.rejects(store.read(ref));
  await assert.rejects(store.put(file));
  assert.equal(await fs.readFile(outside, 'utf8'), 'private unrelated file');
});

test('legacy MIME aliases and casing remain valid at the native attachment boundary', async (t) => {
  const { store } = await fixture(t);
  const ref = await store.put({ ...file, type: 'IMAGE/PNG' });
  assert.equal(ref.type, 'image/png');
  assert.deepEqual(await store.read(ref), Buffer.from(png, 'base64'));
});
