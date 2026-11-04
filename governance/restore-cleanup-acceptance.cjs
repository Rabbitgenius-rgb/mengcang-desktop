const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const JSZip = require('../源码/prototypes/desktop-workbench/node_modules/jszip');
const { createAcceptanceRun } = require('./acceptance-run.cjs');
const v2 = 'mengcang-sublime-workspace-v1';
const v3 = 'mengcang-sublime-workspace-v3';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const images = [1, 2].map((number) => {
  const bytes = Buffer.concat([png, Buffer.from([number])]);
  return {
    bytes,
    sha: createHash('sha256').update(bytes).digest('hex'),
    attachment: { name: `race-${number}.png`, type: 'image/png', size: bytes.length, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') },
  };
});
const raw = {
  format: 'workspace-storage-v2',
  revision: 23,
  entityVersions: { 'card:original': 23 },
  state: {
    schemaVersion: 1,
    version: 1,
    cards: [{ id: 'original', type: 'text', title: '恢复与清理竞态样本', body: '仅用于隔离验收' }],
    savedIds: ['original'],
    favoriteIds: [],
    hiddenIds: [],
    annotations: {},
    collections: [],
    boards: [],
    drafts: { legacyDiscoveryImported: true, figures: images.map((image) => image.attachment) },
  },
};

(async () => {
  assert.ok(process.argv[2], '请指定已打包的治理候选版');
  const run = await createAcceptanceRun({ executablePath: process.argv[2] });
  const file = path.join(run.directory, '竞态验收备份.zip');
  let app,
    page,
    id,
    gateInstalled = false;
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function launch() {
    app = await run.launch('race');
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.waitForURL('mengcang://app/**');
    await button('本机工具').waitFor();
    await button('资料库').click();
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
      async ({ database, store, operation, value, key }) => {
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
      { database, store, operation, value, key },
    );
  }
  async function menu(name) {
    await button('本机工具').click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  try {
    await launch();
    assert.equal(await record(v2, 'workspaces'), undefined);
    await record(v2, 'workspaces', 'put', raw);
    await record(v3, 'meta', 'delete');
    await close();
    await launch();
    await page.getByRole('button', { name: /打开 恢复与清理竞态样本/ }).waitFor();
    await app.evaluate(({ dialog }, dest) => {
      dialog.showSaveDialogSync = () => dest;
    }, file);
    await menu('导出完整备份');
    await page.getByRole('dialog').waitFor();
    let zip;
    for (let n = 0; n < 80 && !zip; n++)
      try {
        zip = await JSZip.loadAsync(await fs.readFile(file));
      } catch (error) {
        if (n === 79) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.equal(manifest.attachments.length, 2);
    await close();
    await launch();
    await close();
    await launch();
    assert.equal((await record(v3, 'meta')).successfulStartIds.length, 3);
    const first = manifest.attachments[0];
    const missingPath = path.join(run.profilePath('race'), 'attachments-v3', first.sha256);
    await fs.unlink(missingPath);
    // Delay only the second native restore invocation. The first goes through
    // the packaged application's real handler, and its rollback is also real.
    await app.evaluate(({ ipcMain }) => {
      const method = 'mengcang:attachmentRestore';
      const original = ipcMain._invokeHandlers.get(method);
      if (typeof original !== 'function') throw Error('未找到候选版原生附件恢复入口');
      const gate = { count: 0, paused: false, release: null };
      globalThis.mengcangRaceGate = gate;
      ipcMain.removeHandler(method);
      ipcMain.handle(method, async (...args) => {
        gate.count++;
        if (gate.count === 2) {
          gate.paused = true;
          await new Promise((resolve) => {
            gate.release = resolve;
          });
          return { ok: false, error: { code: 'ACCEPTANCE_WRITE_FAILURE', message: '隔离验收模拟第二个附件写入失败' } };
        }
        return original(...args);
      });
    });
    gateInstalled = true;
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(file);
    await page.getByRole('dialog', { name: '导入备份' }).waitFor();
    await button('合并备份').click();
    for (let n = 0; n < 80; n++) {
      if (await app.evaluate(() => globalThis.mengcangRaceGate.paused)) break;
      if (n === 79) throw Error('恢复未进入第二个附件暂停点');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const firstOriginal = await zip.file('attachments/' + first.sha256).async('nodebuffer');
    assert.deepEqual(await fs.readFile(missingPath), firstOriginal);
    await button('关闭对话框').click();
    await menu('清理旧版迁移副本');
    await button('确认清理旧副本').click();
    await button('正在核验原附件…').waitFor();
    await page.waitForTimeout(150);
    assert.deepEqual(await record(v2, 'workspaces'), raw);
    assert.equal((await record(v3, 'meta')).legacyCleaned, false);
    await app.evaluate(() => globalThis.mengcangRaceGate.release());
    gateInstalled = false;
    await page
      .getByRole('dialog')
      .getByRole('alert')
      .filter({ hasText: /附件校验失败/ })
      .waitFor();
    assert.deepEqual(await record(v2, 'workspaces'), raw);
    assert.equal((await record(v3, 'meta')).legacyCleaned, false);
    await assert.rejects(fs.access(missingPath), { code: 'ENOENT' });
    const backup = (await record(v2 + '-migration-backups', 'backups', 'get', undefined, JSON.stringify([id, 23]))).raw;
    assert.deepEqual(backup, raw);
    await button('取消').click();
    await close();
    await launch();
    await page.getByRole('button', { name: /打开 恢复与清理竞态样本/ }).waitFor();
    assert.deepEqual(await record(v2, 'workspaces'), raw);
    const result = {
      secondNativeAttachmentPaused: true,
      cleanupWaitedForRestore: true,
      firstProvisionalFileRolledBack: true,
      cleanupRejectedMissingOriginal: true,
      legacyAndSeparateBackupRetained: true,
      restartedWithOriginalCard: true,
    };
    await fs.writeFile(path.join(run.directory, '恢复清理竞态验收.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ run: run.directory, result }));
  } catch (error) {
    if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(0, 2200));
    throw error;
  } finally {
    if (gateInstalled && app) await app.evaluate(() => globalThis.mengcangRaceGate?.release?.()).catch(() => {});
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
