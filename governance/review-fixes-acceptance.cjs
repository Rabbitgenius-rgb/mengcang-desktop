const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { build } = require('../源码/node_modules/esbuild');
const { createAcceptanceRun } = require('./acceptance-run.cjs');
const JSZip = require('../源码/prototypes/desktop-workbench/node_modules/jszip');
const root = path.resolve(__dirname, '..');
const sourceId = '01_sources/cards/text/source.md',
  newer = '已保存的新备注',
  stale = '旧窗口里尚未提交的备注';
(async () => {
  const run = await createAcceptanceRun({ executablePath: process.argv[2] });
  const foreign = await createAcceptanceRun({ executablePath: process.argv[2] });
  await fs.writeFile(path.join(foreign.vaultPath, sourceId), '---\ntype: material\ntitle: 另一座资料库的旅行清单\n---\n另一篇完全无关的旅行笔记。\n');
  const bundle = await build({
    stdin: {
      contents: `export * from './governance/fixtures.mjs';
 export {createWorkspaceStoreV3} from './源码/prototypes/desktop-workbench/src/sublime/workspaceStoreV3.js';
 export {createWorkspaceSession} from './源码/prototypes/desktop-workbench/src/sublime/workspacePersistence.js';
 export {workspaceReducer} from './源码/prototypes/desktop-workbench/src/sublime/workspaceModel.js';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'safetyFixtures',
  });
  let app, page;
  const errors = [],
    result = {};
  const file = path.join(run.directory, '带原卡状态与旧稿的备份.zip');
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function launch(profile, scope = run) {
    app = await scope.launch(profile);
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForURL('mengcang://app/**');
    await page.addInitScript({ content: bundle.outputFiles[0].text + ';globalThis.safetyFixtures=safetyFixtures;' });
    await page.reload();
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
  }
  async function close() {
    if (app) await app.close();
    app = null;
  }
  async function state() {
    return page.evaluate(async () => safetyFixtures.inspectLibrary((await window.mengcang.status()).data.identity.id));
  }
  async function menu(name) {
    await button('本机工具').click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  async function importBackup() {
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(file);
    await page.getByRole('dialog', { name: '导入备份' }).waitFor();
  }
  async function restore() {
    await button('恢复备份').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  async function exportBackup(dest) {
    await app.evaluate(({ dialog }, dest) => {
      dialog.showSaveDialogSync = () => dest;
    }, dest);
    await menu('导出完整备份');
    await page.getByRole('dialog', { name: '导出完整备份' }).waitFor();
    for (let i = 0; i < 100; i++) {
      try {
        return await JSZip.loadAsync(await fs.readFile(dest));
      } catch (e) {
        if (i === 99) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
  try {
    await launch('source');
    await page.evaluate(
      async ({ sourceId, newer, stale }) => {
        const id = (await window.mengcang.status()).data.identity.id;
        await safetyFixtures.seedLibrary(id);
        const store = safetyFixtures.createWorkspaceStoreV3(id);
        await store.update((s) => safetyFixtures.workspaceReducer(s, { type: 'card.note', id: sourceId, note: '初稿' }));
        const author = safetyFixtures.createWorkspaceSession(store, { sessionId: 'old-author' });
        await author.load();
        author.beginEdit('note:' + sourceId);
        await author.commit({ type: 'draft.set', key: 'note:' + sourceId, value: { note: stale, private: false } });
        await store.update((s) =>
          [
            { type: 'card.note', id: sourceId, note: newer },
            { type: 'card.favorite', id: sourceId, value: true },
            { type: 'card.hide', id: sourceId, hidden: true },
            { type: 'draft.set', key: 'recall-workbench-v1', value: { read: { [s.cards.find((c) => c.title === '治理回看摘录 1').id]: true } } },
          ].reduce(safetyFixtures.workspaceReducer, s),
        );
        store.close();
      },
      { sourceId, newer, stale },
    );
    await page.reload();
    const zip = await exportBackup(file);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.ok(manifest.sourceIdentity && manifest.originalFingerprints[sourceId]);
    await close();
    await launch('target');
    await button('本机工具').click();
    await page.getByLabel('主题', { exact: true }).selectOption('light');
    await page.keyboard.press('Escape');
    await importBackup();
    assert.equal(await button('恢复备份').count(), 1);
    await restore();
    await close();
    await launch('target');
    let saved = await state();
    assert.equal(saved.annotations[sourceId].note, newer);
    assert.ok(saved.favoriteIds.includes(sourceId) && saved.hiddenIds.includes(sourceId));
    assert.equal(saved.drafts.appearance, 'light');
    const draft = Object.values(saved.drafts).find((d) => d?.value?.note === stale);
    assert.ok(draft && draft.recoveryOnly && draft.conflict && draft.base === null && draft.adoptedFrom === null);
    await menu('恢复草稿 · 1');
    await page.getByText(/旧窗口里尚未提交的备注/).waitFor();
    assert.equal(await button('恢复编辑').count(), 0);
    await button('另存副本').click();
    await button('保存').click();
    await button('整理').waitFor();
    saved = await state();
    assert.equal(saved.annotations[sourceId].note, newer);
    assert.ok(saved.cards.some((c) => c.body === stale));
    result.staleDraftSavedOnlyAsCopy = true;
    result.appearanceAndOriginalFlagsRestored = true;
    assert.deepEqual(saved.drafts['recall-workbench-v1'], manifest.state.drafts['recall-workbench-v1']);
    result.recallPreserved = true;
    await close();
    await launch('foreign', foreign);
    await importBackup();
    await restore();
    await close();
    await launch('foreign', foreign);
    saved = await state();
    assert.ok(!saved.annotations[sourceId] && !saved.favoriteIds.includes(sourceId) && !saved.hiddenIds.includes(sourceId));
    assert.ok(Object.values(saved.drafts).some((d) => d?.key === 'new:text' && d.value.body === newer));
    assert.ok(saved.cards.some((c) => c.id === 'qa-image'));
    result.foreignOriginalUntouchedAndNoteRetained = true;
    await close();
    await launch('target');
    await page.evaluate(async () => {
      const identity = (await window.mengcang.status()).data.identity.id;
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('mengcang-sublime-workspace-v1');
        r.onsuccess = () => res(r.result);
        r.onerror = rej;
      });
      await new Promise((res, rej) => {
        const t = db.transaction('workspaces', 'readwrite');
        t.objectStore('workspaces').put({ schemaVersion: 999 }, identity);
        t.oncomplete = res;
        t.onabort = rej;
      });
      db.close();
    });
    await close();
    await launch('target');
    await page
      .getByText(/旧版迁移副本无法读取/)
      .first()
      .waitFor();
    await exportBackup(path.join(run.directory, '只读操作前.zip'));
    await button('关闭对话框').click();
    await importBackup();
    assert.ok(await button('合并备份').isDisabled());
    await button('关闭对话框').click();
    await exportBackup(path.join(run.directory, '只读操作后.zip'));
    await button('关闭对话框').click();
    await close();
    result.readOnlyExportAndNormalQuit = true;
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(run.directory, '复审重点验收.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ run: run.directory, foreign: foreign.directory, result }));
  } catch (e) {
    if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(0, 2000));
    throw e;
  } finally {
    if (app) await close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
