const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const JSZip = require('../源码/prototypes/desktop-workbench/node_modules/jszip');
const { createAcceptanceRun } = require('./acceptance-run.cjs');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const blank = {
  schemaVersion: 1,
  version: 1,
  cards: [],
  savedIds: [],
  favoriteIds: [],
  hiddenIds: [],
  collections: [],
  boards: [],
  annotations: {},
  drafts: {},
};

(async () => {
  assert.ok(process.argv[2], '请指定已打包的新候选版');
  const run = await createAcceptanceRun({ executablePath: process.argv[2] });
  const members = [1, 2].map((n) => {
    const bytes = Buffer.concat([png, Buffer.from([n])]);
    return { bytes, ref: { sha256: digest(bytes), type: 'image/png', size: bytes.length } };
  });
  const image = (n, inline) => ({
    id: 'image-' + n,
    title: '恢复原图 ' + n,
    body: '独立候选验收配图',
    type: 'image',
    attachment: {
      name: n + '.png',
      type: 'image/png',
      size: members[n - 1].bytes.length,
      dataUrl: inline ? 'data:image/png;base64,' + members[n - 1].bytes.toString('base64') : { $attachment: members[n - 1].ref },
    },
  });
  async function makeBackup(name, cards, format) {
    const state = { ...blank, cards, savedIds: cards.map((card) => card.id) };
    const file = path.join(run.directory, name);
    if (format === 'JSON') await fs.writeFile(file, JSON.stringify(state));
    else {
      const attachments = cards.map((card) => card.attachment.dataUrl.$attachment);
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify({ format: 'mengcang-workspace-backup-v3', version: 3, revision: 0, entityVersions: {}, state, attachments }));
      for (const ref of attachments) zip.file('attachments/' + ref.sha256, members.find((member) => member.ref.sha256 === ref.sha256).bytes);
      await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
    }
    return file;
  }
  const json = await makeBackup('两张原图.json', [image(1, true), image(2, true)], 'JSON');
  const zip = await makeBackup('两张原图.zip', [image(1, false), image(2, false)], 'ZIP');
  const existing = path.join(run.directory, '已在库的同名文字.json');
  await fs.writeFile(
    existing,
    JSON.stringify({
      ...blank,
      cards: [1, 2].map((n) => ({ id: 'image-' + n, title: '本机文字 ' + n, type: 'text', body: '保留最新文字' })),
      savedIds: ['image-1', 'image-2'],
    }),
  );
  const result = {},
    errors = [];
  let app, page, profile;
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function launch(name) {
    profile = name;
    app = await run.launch(name);
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForURL('mengcang://app/**');
    await button('本机工具').waitFor();
    await button('资料库').first().click();
  }
  async function close() {
    if (app) await app.close();
    app = null;
  }
  async function preview(file) {
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(file);
    await page.getByRole('dialog', { name: '导入备份' }).waitFor();
  }
  async function confirm(name = '恢复备份') {
    await button(name).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  const attachmentPath = (ref) => path.join(run.profilePath(profile), 'attachments-v3', ref.sha256);
  async function hashes() {
    try {
      return (await fs.readdir(path.join(run.profilePath(profile), 'attachments-v3'))).sort();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  async function cards() {
    return page.evaluate(async () => {
      const id = (await window.mengcang.status()).data.identity.id;
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('mengcang-sublime-workspace-v3');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('cards');
          const r = tx.objectStore('cards').index('identity').getAll(id);
          tx.oncomplete = () => resolve(r.result.map((record) => record.value));
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
  }
  async function originalsMatch() {
    for (const { ref, bytes } of members) assert.deepEqual(await fs.readFile(attachmentPath(ref)), bytes);
  }
  try {
    for (const [format, file] of [
      ['JSON', json],
      ['ZIP', zip],
    ]) {
      await launch('collision-' + format.toLowerCase());
      await preview(existing);
      await confirm();
      await preview(file);
      assert.match(await page.getByRole('dialog').innerText(), /将新增 0 张卡/);
      await confirm('合并备份');
      assert.deepEqual(await hashes(), []);
      assert.ok((await cards()).every((card) => card.body === '保留最新文字' && !card.attachment));
      result[format + 'ZeroAdditionsNoOrphans'] = true;
      await close();
    }

    await launch('json-repair');
    await fs.mkdir(path.dirname(attachmentPath(members[1].ref)), { recursive: true });
    await fs.writeFile(attachmentPath(members[1].ref), Buffer.alloc(members[1].ref.size), { flag: 'wx' });
    await preview(json);
    assert.equal((await hashes()).length, 1);
    await confirm();
    await originalsMatch();
    await close();
    await launch('json-repair');
    assert.equal((await cards()).length, 2);
    await originalsMatch();
    await page
      .getByRole('button', { name: /打开 恢复原图 2/ })
      .first()
      .click();
    await page.waitForFunction(() => [...document.images].some((image) => image.complete && image.naturalWidth === 1));
    result.legacyJsonDamagedSecondImageRepairedAndReopened = true;
    await close();

    await launch('json-failure');
    await fs.mkdir(path.dirname(attachmentPath(members[1].ref)), { recursive: true });
    await fs.writeFile(attachmentPath(members[1].ref), Buffer.alloc(members[1].ref.size), { flag: 'wx' });
    await preview(json);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'cards') {
          IDBObjectStore.prototype.put = put;
          throw new DOMException('模拟实体事务提交失败', 'QuotaExceededError');
        }
        return put.apply(this, args);
      };
    });
    await button('恢复备份').click();
    await page.waitForFunction(() => document.body.textContent.includes('模拟实体事务提交失败'));
    assert.equal((await cards()).length, 0);
    assert.deepEqual(await hashes(), [members[1].ref.sha256]);
    assert.deepEqual(await fs.readFile(attachmentPath(members[1].ref)), members[1].bytes);
    result.legacyJsonEntityFailureLeavesNoNewFile = true;
    await button('关闭对话框').click();
    await close();

    await launch('quit-during-restore');
    await preview(zip);
    await app.evaluate(({ ipcMain }) => {
      const key = 'mengcang:attachmentRestore';
      const handler = ipcMain._invokeHandlers.get(key);
      if (!handler) throw Error('未找到真实附件恢复处理器');
      globalThis.restoreProbe = { count: 0, held: false };
      ipcMain._invokeHandlers.set(key, async (...args) => {
        globalThis.restoreProbe.count++;
        if (globalThis.restoreProbe.count === 2) {
          globalThis.restoreProbe.held = true;
          await new Promise((resolve) => {
            globalThis.restoreProbe.release = resolve;
          });
        }
        return handler(...args);
      });
    });
    await button('恢复备份').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await app.evaluate(() => globalThis.restoreProbe.held)) break;
      if (attempt === 99) throw Error('未等到第二个恢复附件');
      await page.waitForTimeout(25);
    }
    const closed = app.waitForEvent('close');
    await app.evaluate(({ app }) => app.quit());
    await page.waitForTimeout(150);
    assert.equal(await app.evaluate(() => globalThis.restoreProbe.held), true);
    await app.evaluate(() => globalThis.restoreProbe.release());
    await closed;
    app = null;
    await launch('quit-during-restore');
    assert.equal((await cards()).length, 2);
    await originalsMatch();
    result.realQuitWaitedForSecondAttachmentAndEntityCommit = true;
    await close();
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(run.directory, '附件失败与退出验收.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ run: run.directory, result }));
  } catch (error) {
    console.error('已完成', result);
    if (page && !page.isClosed()) console.error('界面', (await page.locator('body').innerText()).slice(0, 2400));
    throw error;
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
