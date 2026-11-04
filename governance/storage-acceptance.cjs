const { _electron: electron } = require('../源码/node_modules/playwright');
const { build } = require('../源码/node_modules/esbuild');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    source = path.join(root, '源码'),
    dir = path.join(source, 'desktop/build/app');
  const benchmarkProfile = await require('./acceptance-run.cjs').requireBenchmarkRun(dir);
  await build({
    stdin: {
      contents: `export {createWorkspaceStoreV3} from './src/sublime/workspaceStoreV3.js';export {createWorkspaceStore as createLegacyStore} from './src/sublime/workspaceStore.js';export {workspaceReducer,createWorkspaceState,parseWorkspaceBackup} from './src/sublime/workspaceModel.js';export * from './src/sublime/attachmentStore.js';export * from './src/sublime/workspaceBackup.js';`,
      resolveDir: path.join(source, 'prototypes/desktop-workbench'),
    },
    bundle: true,
    format: 'esm',
    outfile: path.join(dir, 'renderer/acceptance.js'),
  });
  const starts = [],
    content = [];
  for (let run = 0; run < 3; run++) {
    const t = Date.now(),
      app = await electron.launch({ executablePath: path.join(source, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [dir] });
    try {
      assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), benchmarkProfile);
      const page = await app.firstWindow();
      await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
      await page.getByRole('button', { name: /打开 隔离性能样本 0/ }).waitFor();
      starts.push(Date.now() - t);
      if (run === 0)
        content.push(
          await page.evaluate(async () => {
            const q = await import('/acceptance.js'),
              files = q.createAttachmentStore(),
              status = await window.mengcang.status();
            const store = q.createWorkspaceStoreV3(status.data.identity.id, { attachments: files }),
              state = await store.load();
            let total = 0;
            for (const card of state.cards) {
              const bytes = await q.readAttachmentBytes(card.attachment);
              if (bytes.length !== 50 * 1024 * 1024 || bytes[12] !== Number(card.id.split('-')[1])) throw Error('附件内容读回不同');
              total += bytes.length;
            }
            try {
              await q.exportLegacyWorkspace(state, files);
              throw Error('超过旧版限额却允许降级');
            } catch (error) {
              if (error.code !== 'LEGACY_BACKUP_TOO_LARGE') throw error;
            }
            return { cards: state.cards.length, bytesVerified: total, tooLargeDowngradeBlocked: true };
          }),
        );
      if (run === 2)
        content.push(
          await page.evaluate(async () => {
            const q = await import('/acceptance.js'),
              files = q.createAttachmentStore();
            const id = 'isolated-migration-acceptance-' + crypto.randomUUID();
            const old = q.createLegacyStore(id);
            let initial = q.createWorkspaceState();
            const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
            const actions = [
              {
                type: 'card.upsert',
                card: { id: 'source', title: '迁移来源', body: '原文', attachment: { name: 'concept.png', type: 'image/png', size: 68, dataUrl: png } },
              },
              { type: 'card.save', id: 'source', saved: true },
              { type: 'card.note', id: 'source', note: '原备注' },
              { type: 'draft.set', key: 'recall-workbench-v1', value: { reviewedIds: ['source'], archivedIds: ['history'], retained: '回看状态' } },
            ];
            initial = actions.reduce(q.workspaceReducer, initial);
            await old.update(() => initial);
            const before = await old.loadSnapshot(),
              modern = q.createWorkspaceStoreV3(id, { attachments: files });
            await modern.load();
            if (JSON.stringify(await old.loadSnapshot()) !== JSON.stringify(before)) throw Error('迁移改写旧版本');
            await modern.update((state) =>
              [
                { type: 'card.upsert', card: { id: 'after-migration', title: '迁移后新增', body: '新增正文' } },
                { type: 'card.save', id: 'after-migration', saved: true },
                { type: 'card.note', id: 'source', note: '迁移后修改备注' },
              ].reduce(q.workspaceReducer, state),
            );
            const current = await modern.load();
            const zip = await q.exportWorkspaceZip(current, files, { type: 'uint8array' }),
              parsed = await q.importWorkspaceBackup(zip, files);
            const legacyText = await q.exportLegacyWorkspace(current, files),
              restored = q.parseWorkspaceBackup(legacyText);
            const oldRestored = q.createLegacyStore('isolated-old-version-restored');
            await oldRestored.update(() => restored);
            const readback = await oldRestored.load();
            if (
              readback.cards.length !== 2 ||
              readback.annotations.source.note !== '迁移后修改备注' ||
              readback.cards[0].attachment.dataUrl !== png ||
              JSON.stringify(readback.drafts) !== JSON.stringify(initial.drafts)
            )
              throw Error('降级读回遗漏资料');
            if (!parsed.state.cards.some((card) => card.id === 'after-migration')) throw Error('ZIP遗漏新增');
            return { migrationPreservedV2: true, zipReadback: true, oldVersionReadback: true, postMigrationCard: true, notesAndRecall: true };
          }),
        );
    } finally {
      await app.close();
    }
  }
  assert.ok(
    starts.every((ms) => ms < 1500),
    JSON.stringify(starts),
  );
  const result = { coldStartsMs: starts, content };
  await fs.writeFile(path.join(root, '验收记录/governance-storage-acceptance.json'), JSON.stringify(result, null, 2));
  console.log(result);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
