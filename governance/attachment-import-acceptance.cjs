const { _electron: electron } = require('../源码/node_modules/playwright');
const { build } = require('../源码/node_modules/esbuild');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    qa = path.join(root, 'qa'),
    appDir = path.join(qa, 'import-timing-app'),
    userDataPath = path.join(qa, 'import-timing-profile'),
    vaultPath = path.join(qa, 'import-timing-vault');
  await fs.cp(path.join(root, '源码/desktop/build/app'), appDir, { recursive: true });
  await fs.mkdir(path.join(vaultPath, '01_sources/cards/text'), { recursive: true });
  await fs.writeFile(path.join(vaultPath, '01_sources/cards/text/source.md'), '---\ntitle: 附件计时验收来源\n---\n合成资料。\n');
  const config = {
    name: '梦藏附件计时验收',
    userDataPath,
    vaultPath,
    recallBridgeDirectory: path.join(qa, 'import-timing-bridge'),
    recallCompanionDirectory: path.join(qa, 'import-timing-companion'),
  };
  for (const value of Object.values(config).slice(1)) assert.ok(value.startsWith(qa + path.sep));
  await fs.writeFile(path.join(appDir, 'candidate-config.json'), JSON.stringify(config));
  await build({
    stdin: {
      contents:
        "export {createWorkspaceStoreV3} from './src/sublime/workspaceStoreV3.js';export {workspaceReducer} from './src/sublime/workspaceModel.js';export {readAttachmentBytes} from './src/sublime/attachmentStore.js';",
      resolveDir: path.join(root, '源码/prototypes/desktop-workbench'),
    },
    bundle: true,
    format: 'esm',
    outfile: path.join(appDir, 'renderer/import-timing.js'),
  });
  async function launch() {
    const app = await electron.launch({
      executablePath: path.join(root, '源码/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args: [appDir],
    });
    const page = await app.firstWindow();
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
    return { app, page };
  }
  let { app, page } = await launch();
  let result;
  try {
    result = await page.evaluate(async () => {
      const q = await import('/import-timing.js'),
        status = await window.mengcang.status(),
        store = q.createWorkspaceStoreV3(status.data.identity.id),
        data = new Uint8Array(50 * 1024 * 1024),
        id = crypto.randomUUID();
      data.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
      data.set(new TextEncoder().encode(id), 12);
      const expectedSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (v) => v.toString(16).padStart(2, '0')).join('');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(new Blob([data], { type: 'audio/wav' }));
      });
      await store.load();
      const started = performance.now();
      await store.update((state) =>
        q.workspaceReducer(state, {
          type: 'card.upsert',
          card: {
            id,
            type: 'audio',
            title: '首次附件导入计时',
            attachment: { name: 'first-import.wav', type: 'audio/wav', size: data.length, dataUrl },
          },
        }),
      );
      const importToCommitMs = performance.now() - started;
      store.close();
      return { id, bytes: data.length, expectedSha256, importToCommitMs, samples: 1, preparationExcluded: true };
    });
  } finally {
    await app.close();
  }
  ({ app, page } = await launch());
  try {
    result.afterRestartHashVerified = await page.evaluate(async ({ id, bytes, expectedSha256 }) => {
      const q = await import('/import-timing.js'),
        status = await window.mengcang.status(),
        store = q.createWorkspaceStoreV3(status.data.identity.id),
        state = await store.load(),
        card = state.cards.find((value) => value.id === id),
        data = await q.readAttachmentBytes(card.attachment),
        hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (v) => v.toString(16).padStart(2, '0')).join('');
      store.close();
      return data.length === bytes && hash === expectedSha256;
    }, result);
    assert.equal(result.afterRestartHashVerified, true);
  } finally {
    await app.close();
  }
  await fs.writeFile(path.join(root, '验收记录/governance-attachment-import.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
