const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const JSZip = require('../源码/prototypes/desktop-workbench/node_modules/jszip');
const { createAcceptanceRun } = require('./acceptance-run.cjs');

const v2 = 'mengcang-sublime-workspace-v1';
const v3 = 'mengcang-sublime-workspace-v3';
const note = '新库独有的迁移验收笔记';
const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const sha = createHash('sha256').update(original).digest('hex');
const raw = {
  format: 'workspace-storage-v2',
  revision: 17,
  entityVersions: { 'card:original': 17 },
  state: {
    schemaVersion: 1,
    version: 1,
    cards: [{ id: 'original', type: 'text', title: '旧版迁移样本', body: '旧版迁移样本' }],
    savedIds: ['original'],
    favoriteIds: [],
    hiddenIds: [],
    annotations: {},
    collections: [],
    boards: [],
    drafts: {
      legacyDiscoveryImported: true,
      draftWithFile: {
        attachment: { name: 'draft.png', type: 'image/png', size: original.length, dataUrl: 'data:image/png;base64,' + original.toString('base64') },
      },
    },
  },
};

(async () => {
  assert.ok(process.argv[2], '请指定已打包的治理候选版');
  const run = await createAcceptanceRun({ executablePath: process.argv[2] });
  const file = path.join(run.directory, '只读库完整备份.zip');
  const storedFile = path.join(run.profilePath('migration'), 'attachments-v3', sha);
  const result = {},
    errors = [];
  let app, page, id;
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function launch() {
    app = await run.launch('migration');
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForURL('mengcang://app/**');
    await button('本机工具').waitFor();
    await button('资料库').first().click();
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
    const current = await page.evaluate(async () => (await window.mengcang.status()).data.identity.id);
    if (id) assert.equal(current, id);
    else id = current;
  }
  async function close() {
    if (app) await app.close();
    app = null;
  }
  async function record(database, store, operation = 'get', value, key = id) {
    return page.evaluate(
      async ({ database, store, key, operation, value }) => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(database);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          return await new Promise((resolve, reject) => {
            const tx = db.transaction(store, operation === 'get' ? 'readonly' : 'readwrite');
            const entries = tx.objectStore(store);
            const req = operation === 'put' ? entries.put(value, key) : operation === 'delete' ? entries.delete(key) : entries.get(key);
            tx.oncomplete = () => resolve(req.result);
            tx.onabort = tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { database, store, key, operation, value },
    );
  }
  async function menu(name) {
    await button('本机工具').click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  async function cleanup() {
    await menu('清理旧版迁移副本');
    await button('确认清理旧副本').click();
  }
  const hasNote = () => page.getByRole('button', { name: new RegExp('打开 ' + note) }).first();
  try {
    // The helper provides a new, verified test profile. Remove only its
    // empty bootstrap marker so the next real start performs the v2 migration.
    await launch();
    assert.equal(await record(v2, 'workspaces'), undefined);
    const initial = await record(v3, 'meta');
    assert.ok(initial && !initial.legacySource.present && !initial.savedIds.length);
    await record(v2, 'workspaces', 'put', raw);
    await record(v3, 'meta', 'delete');
    await close();

    await launch();
    await page
      .getByRole('button', { name: /打开 旧版迁移样本/ })
      .first()
      .waitFor();
    assert.deepEqual(await fs.readFile(storedFile), original);
    await button('添加卡片').click();
    await page.getByRole('menuitem', { name: '写笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '卡片正文', exact: true }).fill(note);
    await button('保存').click();
    await button('整理').waitFor();
    const damaged = { ...raw, state: { ...raw.state, schemaVersion: 999 } };
    await record(v2, 'workspaces', 'put', damaged);
    await close();

    await launch();
    await page
      .getByText(/旧版迁移副本无法读取/)
      .first()
      .waitFor();
    await hasNote().waitFor();
    await app.evaluate(({ dialog }, dest) => {
      dialog.showSaveDialogSync = () => dest;
    }, file);
    await menu('导出完整备份');
    await page.getByRole('dialog').waitFor();
    let zip;
    for (let i = 0; i < 80 && !zip; i++) {
      try {
        zip = await JSZip.loadAsync(await fs.readFile(file));
      } catch (error) {
        if (i === 79) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.ok(manifest.state.cards.some((card) => card.body === note));
    assert.equal(manifest.state.drafts.draftWithFile.attachment.dataUrl.$attachment.sha256, sha);
    assert.deepEqual(await zip.file('attachments/' + sha).async('nodebuffer'), original);
    assert.deepEqual(await record(v2, 'workspaces'), damaged);
    result.damagedOldCopy = { readOnlyNotice: true, newCardInLibraryAndZip: true, draftOriginalExported: true, damagedRecordRetained: true };
    await record(v2, 'workspaces', 'put', raw);
    await close();

    await launch();
    await close();
    await launch();
    assert.equal((await record(v3, 'meta')).successfulStartIds.length, 3);
    const broken = Buffer.from(original);
    broken[broken.length - 1] ^= 1;
    await fs.writeFile(storedFile, broken);
    await cleanup();
    await page
      .getByRole('dialog')
      .getByRole('alert')
      .filter({ hasText: /附件校验失败/ })
      .waitFor();
    assert.deepEqual(await record(v2, 'workspaces'), raw);
    assert.ok(!(await record(v3, 'meta')).legacyCleaned);
    await button('取消').click();
    result.corruptDraftFileBlockedCleanup = true;
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(file);
    await page.getByRole('dialog', { name: '导入备份' }).waitFor();
    await button('合并备份').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await fs.readFile(storedFile), original);
    await cleanup();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await record(v2, 'workspaces'), undefined);
    assert.ok((await record(v3, 'meta')).legacyCleaned);
    assert.deepEqual((await record(v2 + '-migration-backups', 'backups', 'get', undefined, JSON.stringify([id, 17]))).raw, raw);
    await close();
    await launch();
    await hasNote().waitFor();
    assert.deepEqual(await fs.readFile(storedFile), original);
    assert.deepEqual(errors, []);
    result.afterZipRepair = { validatedOriginalThenCleanedOldCopy: true, separateMigrationBackupRetained: true, restartedWithNewCardAndDraftFile: true };
    await fs.writeFile(path.join(run.directory, '迁移清理验收.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ run: run.directory, result }));
  } catch (error) {
    if (page && !page.isClosed()) console.error('界面', (await page.locator('body').innerText()).slice(0, 1800));
    throw error;
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
