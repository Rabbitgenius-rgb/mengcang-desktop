const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { build } = require('../源码/node_modules/esbuild');
const { createAcceptanceRun } = require('./acceptance-run.cjs');
const JSZip = require('../源码/prototypes/desktop-workbench/node_modules/jszip');

const root = path.resolve(__dirname, '..');
const sourceId = '01_sources/cards/text/source.md';
const originalIds = ['star-only', 'hidden-only', 'collection-only'].map((name) => '01_sources/cards/text/' + name + '.md');
const linkedBody = '旧库万维网文章的关联草稿正文';
const cardBody = '旧库卡片草稿的完整正文';

(async () => {
  assert.ok(process.argv[2], '请指定打包后的治理候选版');
  const source = await createAcceptanceRun({ executablePath: process.argv[2] });
  const target = await createAcceptanceRun({ executablePath: process.argv[2] });
  for (const run of [source, target]) {
    const origin = run === source ? '旧库' : '目标库';
    await fs.writeFile(path.join(run.vaultPath, sourceId), '---\ntype: material\ntitle: ' + origin + '旅行清单\n---\n' + origin + '的不同原文。\n');
    for (const id of originalIds)
      await fs.writeFile(
        path.join(run.vaultPath, id),
        '---\ntype: material\ntitle: ' + origin + path.basename(id, '.md') + '\n---\n' + origin + '不同资料。\n',
      );
  }
  const bundle = await build({
    stdin: {
      contents: `export * from './governance/fixtures.mjs';
      export {createWorkspaceStoreV3} from './源码/prototypes/desktop-workbench/src/sublime/workspaceStoreV3.js';
      export {workspaceReducer} from './源码/prototypes/desktop-workbench/src/sublime/workspaceModel.js';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'crossDraftFixtures',
  });
  const file = path.join(source.directory, '关联画布与纯标记备份.zip');
  const errors = [];
  const result = {};
  let app, page;
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function launch(run, profile) {
    app = await run.launch(profile);
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForURL('mengcang://app/**');
    await page.addInitScript({ content: bundle.outputFiles[0].text + ';globalThis.crossDraftFixtures=crossDraftFixtures;' });
    await page.reload();
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
  }
  async function close() {
    if (app) await app.close();
    app = null;
  }
  async function state() {
    return page.evaluate(async () => crossDraftFixtures.inspectLibrary((await window.mengcang.status()).data.identity.id));
  }
  async function menu(name) {
    await button('本机工具').click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  async function recovery() {
    await button('本机工具').click();
    await page.getByRole('menuitem', { name: /^恢复草稿/ }).click();
    await page.getByRole('dialog', { name: '恢复草稿' }).waitFor();
  }
  async function copyRecovery(text) {
    await recovery();
    const row = page.locator('.sw-recovery-draft').filter({ hasText: text });
    assert.ok(await row.count(), '应能找到匹配的恢复稿 ' + text);
    await row.first().getByRole('button', { name: '另存副本', exact: true }).click();
  }
  async function openOriginal() {
    await button('资料库').first().click();
    await page.getByRole('textbox', { name: /搜索/ }).first().fill('目标库旅行清单');
    await page
      .getByRole('button', { name: /打开 目标库旅行清单/ })
      .first()
      .click();
  }
  function markerCopies(saved) {
    return originalIds.map((id) => {
      const matches = Object.values(saved.drafts).filter((record) => record?.value?.backupOriginalState?.id === id);
      assert.equal(matches.length, 1, '标记资料应该只有一份独立恢复记录 ' + id);
      const record = matches[0];
      assert.equal(record.key, 'new:text');
      assert.ok(record.recoveryOnly && record.conflict && record.value.body.trim());
      return record.value;
    });
  }
  try {
    await launch(source, 'source');
    await page.evaluate(
      async ({ sourceId, originalIds, linkedBody, cardBody }) => {
        const identity = (await window.mengcang.status()).data.identity.id;
        await crossDraftFixtures.seedLibrary(identity);
        const store = crossDraftFixtures.createWorkspaceStoreV3(identity);
        await store.update((saved) => {
          const actions = [
            { type: 'card.favorite', id: originalIds[0], value: true },
            { type: 'card.hide', id: originalIds[1], hidden: true },
            { type: 'collection.upsert', collection: { id: 'native-only-collection', title: '旧库原文归属', cardIds: [originalIds[2]] } },
            {
              type: 'draft.set',
              key: 'linked-note-draft:' + sourceId,
              value: { id: 'linked-note:foreign-unsaved', createdAt: '2026-11-04T00:00:00.000Z', title: '旧库关联想法', body: linkedBody },
            },
            {
              type: 'draft.set',
              key: 'window-draft:old:board%3Aold-board',
              value: {
                key: 'board:old-board',
                value: {
                  id: 'old-board',
                  title: '跨库画布恢复稿',
                  collectionId: 'qa-collection',
                  nodes: [
                    { id: 'native', itemPath: sourceId, x: 0, y: 0 },
                    { id: 'local', itemPath: 'qa-note', x: 200, y: 120 },
                  ],
                  edges: [{ id: 'old-link', from: 'native', to: 'local' }],
                },
                base: { entity: 'board:old-board', version: 1 },
                conflict: false,
              },
            },
            {
              type: 'draft.set',
              key: 'window-draft:old:new%3Atext',
              value: {
                key: 'new:text',
                value: { title: '跨库新卡恢复稿', body: cardBody, sourceCardId: sourceId },
                base: null,
                conflict: false,
              },
            },
            { type: 'draft.set', key: 'recall-workbench-v1', value: { read: { [saved.cards.find((card) => card.title === '治理回看摘录 1').id]: true } } },
          ];
          return actions.reduce(crossDraftFixtures.workspaceReducer, saved);
        });
        store.close();
      },
      { sourceId, originalIds, linkedBody, cardBody },
    );
    await page.reload();
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialogSync = () => file;
    }, file);
    await menu('导出完整备份');
    await page.getByRole('dialog', { name: '导出完整备份' }).waitFor();
    let zip;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        zip = await JSZip.loadAsync(await fs.readFile(file));
        break;
      } catch (error) {
        if (attempt === 99) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.ok(manifest.sourceIdentity && manifest.originalFingerprints[sourceId]);
    assert.equal(manifest.state.annotations[originalIds[0]], undefined);
    assert.equal(manifest.state.annotations[originalIds[1]], undefined);
    assert.ok(!manifest.state.annotations[originalIds[2]]?.note);
    await close();

    for (const profile of ['restore', 'merge']) {
      await launch(target, profile);
      if (profile === 'merge') {
        await page.evaluate(
          async ({ sourceId }) => {
            const identity = (await window.mengcang.status()).data.identity.id;
            const store = crossDraftFixtures.createWorkspaceStoreV3(identity);
            await store.update((saved) =>
              [
                { type: 'card.upsert', card: { id: 'target-only', title: '目标库已有资料', type: 'text', body: '目标库自己的正文' } },
                { type: 'card.save', id: 'target-only', saved: true },
                { type: 'card.note', id: sourceId, note: '目标原文已有备注' },
              ].reduce(crossDraftFixtures.workspaceReducer, saved),
            );
            store.close();
          },
          { sourceId },
        );
        await page.reload();
      }
      await page.locator('input[type=file][accept*=".zip"]').setInputFiles(file);
      await page.getByRole('dialog', { name: '导入备份' }).waitFor();
      await button(profile === 'restore' ? '恢复备份' : '合并备份').click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      let saved = await state();
      assert.equal(saved.drafts['linked-note-draft:' + sourceId], undefined);
      assert.ok(!saved.cards.some((card) => card.id === 'linked-note:foreign-unsaved'));
      for (const id of originalIds) assert.ok(!saved.favoriteIds.includes(id) && !saved.hiddenIds.includes(id));
      const copies = markerCopies(saved);
      assert.equal(copies[0].backupOriginalState.favorite, true);
      assert.equal(copies[1].backupOriginalState.hidden, true);
      assert.ok(
        copies[2].backupOriginalState.collections.some((collection) => collection.id === 'native-only-collection' && collection.title === '旧库原文归属'),
      );
      assert.deepEqual(saved.drafts['recall-workbench-v1'], manifest.state.drafts['recall-workbench-v1']);
      assert.deepEqual(
        saved.hiddenIds.filter((id) => saved.cards.some((card) => card.id === id)),
        manifest.state.hiddenIds.filter((id) => manifest.state.cards.some((card) => card.id === id)),
      );
      if (profile === 'merge') {
        assert.equal(saved.annotations[sourceId].note, '目标原文已有备注');
        assert.equal(saved.cards.find((card) => card.id === 'target-only').body, '目标库自己的正文');
      }
      await close();
      await launch(target, profile);
      saved = await state();
      assert.deepEqual(markerCopies(saved), copies);

      await openOriginal();
      await button('写关联笔记').click();
      assert.equal(await page.getByRole('textbox', { name: '笔记正文', exact: true }).inputValue(), '');
      await button('关闭').click();
      await copyRecovery(linkedBody);
      await button('保存').click();
      await button('整理').waitFor();
      saved = await state();
      const independent = saved.cards.find((card) => card.body === linkedBody);
      assert.ok(independent && !independent.sourceCardId);

      await copyRecovery('跨库画布恢复稿');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      saved = await state();
      const board = saved.boards.find((board) => board.title.includes('跨库画布恢复稿'));
      assert.ok(board);
      assert.deepEqual(
        board.nodes.map((node) => node.itemPath),
        ['qa-note'],
      );
      assert.deepEqual(board.edges, []);
      const boardDraft = Object.values(saved.drafts).find((record) => record?.key === 'board:old-board');
      assert.ok(boardDraft.value.backupSourceReferences);
      assert.ok(JSON.stringify(boardDraft.value.backupSourceReferences).includes(sourceId));

      await button('从画布返回').click();
      saved = await state();
      for (const record of Object.values(saved.drafts).filter((record) => record?.value?.body === cardBody)) assert.ok(!record.value.sourceCardId);
      await copyRecovery(cardBody);
      await button('保存').click();
      await button('整理').waitFor();
      saved = await state();
      const restoredCard = saved.cards.find((card) => card.body === cardBody);
      assert.ok(restoredCard && !restoredCard.sourceCardId);
      await recovery();
      for (const value of copies)
        await page
          .locator('.sw-recovery-draft')
          .filter({ hasText: value.body.slice(0, 80) })
          .waitFor();
      await page.keyboard.press('Escape');
      await close();
      await launch(target, profile);
      saved = await state();
      assert.ok(saved.cards.some((card) => card.body === linkedBody && !card.sourceCardId));
      assert.ok(saved.boards.some((board) => board.nodes.length === 1 && board.nodes[0].itemPath === 'qa-note'));
      assert.deepEqual(markerCopies(saved), copies);
      assert.deepEqual(saved.drafts['recall-workbench-v1'], manifest.state.drafts['recall-workbench-v1']);
      result[profile] = {
        linkedDraftDetachedAndSavedIndependently: true,
        boardCopyRetainsOnlyLocalNode: true,
        newCardDraftDetached: true,
        allThreeMarkerRecoveriesVisibleAndPersistent: true,
        recallReadAndArchivePreserved: true,
      };
      await close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(target.directory, '跨库草稿与标记验收.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ source: source.directory, target: target.directory, result }));
  } catch (error) {
    if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(0, 2800));
    throw error;
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
