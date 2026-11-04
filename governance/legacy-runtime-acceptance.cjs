const { _electron: electron } = require('../源码/node_modules/playwright');
const { build } = require('../源码/node_modules/esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

(async () => {
  const root = path.resolve(__dirname, '..');
  const qa = path.join(root, 'qa');
  const archive = path.resolve(process.argv[2] || path.resolve(root, '../../work/desktop-logic-fix-20261103/desktop-source'));
  const legacyApp = path.join(qa, 'legacy-rollback-app');
  const modernApp = path.join(qa, 'legacy-rollback-modern-app');
  const vault = path.join(qa, 'legacy-rollback-vault');
  const executablePath = path.join(root, '源码/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const errors = [];
  const assertQa = (target) => assert.ok(path.resolve(target).startsWith(qa + path.sep), '回退验收仅允许 qa 隔离路径');
  function configuration(name, prefix) {
    const config = {
      name,
      userDataPath: path.join(qa, `${prefix}-profile`),
      vaultPath: vault,
      recallBridgeDirectory: path.join(qa, `${prefix}-bridge`),
      recallCompanionDirectory: path.join(qa, `${prefix}-companion`),
    };
    Object.entries(config).forEach(([key, value]) => {
      if (key !== 'name') assertQa(value);
    });
    return config;
  }
  const modernConfig = configuration('梦藏回退数据验收', 'legacy-rollback-modern');
  const legacyConfig = configuration('梦藏旧版回退验收', 'legacy-rollback');
  for (const target of [
    legacyApp,
    modernApp,
    vault,
    ...[modernConfig, legacyConfig].flatMap((c) =>
      Object.entries(c)
        .filter(([k]) => k !== 'name')
        .map(([, v]) => v),
    ),
  ]) {
    assertQa(target);
    await fs.rm(target, { recursive: true, force: true });
  }
  await fs.mkdir(path.join(vault, '01_sources/cards/text'), { recursive: true });
  await fs.cp(archive, legacyApp, { recursive: true });
  await fs.cp(path.join(root, '源码/desktop/build/app'), modernApp, { recursive: true });
  for (const [dir, config] of [
    [modernApp, modernConfig],
    [legacyApp, legacyConfig],
  ]) {
    assertQa(dir);
    await fs.writeFile(path.join(dir, 'candidate-config.json'), JSON.stringify(config));
  }
  await build({
    stdin: {
      contents: `export {createWorkspaceStoreV3} from './src/sublime/workspaceStoreV3.js';export {createWorkspaceStore as createLegacyStore} from './src/sublime/workspaceStore.js';export {createWorkspaceState,workspaceReducer} from './src/sublime/workspaceModel.js';export {createWorkspaceSession} from './src/sublime/workspacePersistence.js';export {createRecallLibrary} from './src/sublime/recallLibrary.js';export {createAttachmentStore} from './src/sublime/attachmentStore.js';export {exportLegacyWorkspace} from './src/sublime/workspaceBackup.js';`,
      resolveDir: path.join(root, '源码/prototypes/desktop-workbench'),
    },
    bundle: true,
    format: 'esm',
    outfile: path.join(modernApp, 'renderer/legacy-rollback-fixture.js'),
  });
  async function launch(dir) {
    assertQa(dir);
    const config = JSON.parse(await fs.readFile(path.join(dir, 'candidate-config.json'), 'utf8'));
    for (const key of ['userDataPath', 'vaultPath', 'recallBridgeDirectory', 'recallCompanionDirectory']) assertQa(config[key]);
    const app = await electron.launch({ executablePath, args: [dir] });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
    return { app, page };
  }
  let context = await launch(modernApp);
  let exported;
  try {
    exported = await context.page.evaluate(async () => {
      const q = await import('/legacy-rollback-fixture.js');
      const identity = 'isolated-legacy-rollback-source';
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
      let state = q.createWorkspaceState();
      state = [
        {
          type: 'card.upsert',
          card: {
            id: 'rollback-source',
            title: '回退验收原始图片',
            type: 'image',
            body: '迁移前原始正文',
            image: png,
            attachment: { name: 'concept.png', type: 'image/png', size: 68, dataUrl: png },
          },
        },
        { type: 'card.save', id: 'rollback-source', saved: true },
        { type: 'card.note', id: 'rollback-source', note: '迁移前备注' },
        { type: 'collection.upsert', collection: { id: 'rollback-collection', title: '回退验收收藏集', cardIds: ['rollback-source'] } },
      ].reduce(q.workspaceReducer, state);
      const old = q.createLegacyStore(identity);
      await old.update(() => state);
      const before = await old.loadSnapshot();
      const files = q.createAttachmentStore();
      const store = q.createWorkspaceStoreV3(identity, { attachments: files });
      await store.load();
      if (JSON.stringify(await old.loadSnapshot()) !== JSON.stringify(before)) throw Error('迁移改写v2原记录');
      const session = q.createWorkspaceSession(store);
      await session.load();
      await session.commit((value) =>
        [
          { type: 'card.upsert', card: { id: 'rollback-new', title: '迁移后新增的回退笔记', type: 'text', body: '这张卡是在v3迁移完成后新增的。' } },
          { type: 'card.save', id: 'rollback-new', saved: true },
          { type: 'card.note', id: 'rollback-source', note: '迁移后修改的备注：保留原附件和旧版回看。' },
          { type: 'card.favorite', id: 'rollback-source', value: true },
        ].reduce(q.workspaceReducer, value),
      );
      const recall = q.createRecallLibrary({ session, workspaceId: identity });
      const recallIds = {};
      for (const [index, name] of ['未读', '已读', '归档'].entries()) {
        const result = await recall.call('capture', {
          requestId: crypto.randomUUID(),
          text: `旧版回退${name}摘录正文`,
          title: `回退验收${name}摘录`,
          externalSource: {
            version: 1,
            provider: 'deepseek-harness',
            instanceId: 'rollback',
            sessionId: 'rollback',
            messageId: 'm' + index,
            eventSeq: index + 1,
            turn: 1,
            sessionTitle: '旧版回退验收',
          },
        });
        recallIds[name] = result.item.id;
      }
      await session.commit((value) =>
        [
          { type: 'card.hide', id: recallIds['归档'], value: true },
          { type: 'draft.set', key: 'recall-workbench-v1', value: { read: { [recallIds['已读']]: true }, note: '回退验收便笺' } },
        ].reduce(q.workspaceReducer, value),
      );
      await session.settled();
      const current = await store.load();
      const json = await q.exportLegacyWorkspace(current, files);
      await store.close();
      await old.close();
      return { json, recallIds, png, migrationPreservedV2: true };
    });
  } finally {
    await context.app.close();
  }
  const backupPath = path.join(qa, 'legacy-rollback-compatible.json');
  assertQa(backupPath);
  await fs.writeFile(backupPath, exported.json);
  const expected = JSON.parse(exported.json);
  assert.equal(expected.cards.length, 5);
  assert.equal(expected.annotations['rollback-source'].note, '迁移后修改的备注：保留原附件和旧版回看。');
  assert.equal(expected.cards.find((c) => c.id === 'rollback-source').attachment.dataUrl, exported.png);
  context = await launch(legacyApp);
  try {
    await context.page.getByRole('button', { name: '本机工具', exact: true }).click();
    await context.page.getByRole('menuitem', { name: '粘贴备份内容', exact: true }).click();
    await context.page.getByRole('textbox', { name: '备份 JSON 内容', exact: true }).fill(exported.json);
    await context.page.getByRole('button', { name: '预览备份', exact: true }).click();
    await context.page.getByRole('button', { name: '合并备份', exact: true }).click();
    await context.page.getByText('备份已合并 · 当前状态已保留', { exact: true }).waitFor();
  } finally {
    await context.app.close();
  }
  context = await launch(legacyApp);
  let readback;
  try {
    const page = context.page;
    const search = page.getByRole('textbox', { name: /搜索/ }).first();
    await search.fill('迁移后新增的回退笔记');
    await page.getByRole('button', { name: /打开 迁移后新增的回退笔记/ }).click();
    await page.getByText('这张卡是在v3迁移完成后新增的。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await search.fill('回退验收原始图片');
    await page.getByRole('button', { name: /打开 回退验收原始图片/ }).click();
    await page.getByRole('button', { name: '整理', exact: true }).click();
    assert.equal(await page.getByPlaceholder('写下备注…').inputValue(), expected.annotations['rollback-source'].note);
    await page.keyboard.press('Escape');
    readback = await page.evaluate(async () => {
      const status = await window.mengcang.status();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('mengcang-sublime-workspace-v1', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const raw = await new Promise((resolve, reject) => {
        const tx = db.transaction('workspaces', 'readonly');
        const request = tx.objectStore('workspaces').get(status.data.identity.id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return raw;
    });
    assert.equal(readback.format, 'workspace-storage-v2');
    assert.equal(readback.state.cards.length, 5);
    const restoredImage = readback.state.cards.find((c) => c.id === 'rollback-source');
    assert.equal(restoredImage.body, '迁移前原始正文');
    assert.equal(restoredImage.attachment.dataUrl, exported.png);
    assert.ok(readback.state.favoriteIds.includes('rollback-source'));
    assert.ok(readback.state.collections.find((c) => c.id === 'rollback-collection').cardIds.includes('rollback-source'));
    assert.ok(readback.state.hiddenIds.includes(exported.recallIds['归档']));
    assert.deepEqual(readback.state.drafts['recall-workbench-v1'].read, expected.drafts['recall-workbench-v1'].read);
    await page.getByRole('button', { name: '回看', exact: true }).click();
    await page.getByRole('button', { name: '打开笔记：回退验收未读摘录', exact: true }).waitFor();
    await page.getByRole('button', { name: '打开笔记：回退验收已读摘录', exact: true }).waitFor();
    const filter = page.getByRole('group', { name: '回看筛选', exact: true });
    await filter.getByRole('button', { name: /未读/ }).click();
    await page.getByRole('button', { name: '打开笔记：回退验收未读摘录', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '打开笔记：回退验收已读摘录', exact: true }).count(), 0);
    await filter.getByRole('button', { name: /已读/ }).click();
    await page.getByRole('button', { name: '打开笔记：回退验收已读摘录', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '打开笔记：回退验收未读摘录', exact: true }).count(), 0);
    await page.getByRole('button', { name: /^已归档 1$/ }).click();
    await page.getByRole('button', { name: '打开笔记：回退验收归档摘录', exact: true }).waitFor();
  } finally {
    await context.app.close();
  }
  assert.deepEqual(errors, []);
  const oldMetadata = JSON.parse(await fs.readFile(path.join(legacyApp, 'package.json'), 'utf8'));
  const originalHash = crypto
    .createHash('sha256')
    .update(await fs.readFile(path.join(archive, 'main.cjs')))
    .digest('hex');
  assert.equal(
    crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(legacyApp, 'main.cjs')))
      .digest('hex'),
    originalHash,
  );
  const result = {
    legacyRuntime: { version: oldMetadata.version, archive: path.relative(root, archive), mainUnmodified: true },
    isolatedProfiles: true,
    migrationPreservedV2: exported.migrationPreservedV2,
    compatibilityJsonBytes: Buffer.byteLength(exported.json),
    importedUsingOldUi: true,
    restartedOldRuntime: true,
    newCardFoundInOldUi: true,
    changedNoteShownInOldUi: true,
    originalBodyAndAttachmentPreserved: true,
    attachmentBytesVerified: Buffer.from(exported.png.split(',')[1], 'base64').length,
    favoriteAndCollectionPreserved: true,
    unreadReadArchivedVerifiedInOldUi: true,
    cards: readback.state.cards.length,
    errors,
    scope: '归档0.9.0应用资源使用当前Electron运行；独立小库验证，不代表500MiB旧版降级或正式安装版验收。',
  };
  await fs.writeFile(path.join(root, '验收记录/governance-legacy-runtime.json'), JSON.stringify(result, null, 2));
  console.log(result);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
