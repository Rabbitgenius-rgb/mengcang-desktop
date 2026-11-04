const { _electron: electron } = require('../源码/node_modules/playwright');
const { build } = require('../源码/node_modules/esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const qa = path.join(root, 'qa');
  const input = process.argv[2];
  assert.ok(input, 'Provide the archived 0.9.0 application resource directory.');
  const appDir = path.join(qa, 'legacy-cold-app');
  const vault = path.join(qa, 'legacy-cold-vault');
  await fs.mkdir(path.join(vault, '01_sources/cards/text'), { recursive: true });
  await fs.writeFile(path.join(vault, '01_sources/cards/text/source.md'), '---\ntype: material\ntitle: 冷启动隔离来源\n---\n合成验收资料。\n');
  await fs.cp(input, appDir, { recursive: true });
  await build({
    stdin: {
      contents: "export {createWorkspaceStore} from './src/sublime/workspaceStore.js';export {createWorkspaceState} from './src/sublime/workspaceModel.js';",
      resolveDir: path.join(root, '源码/prototypes/desktop-workbench'),
    },
    bundle: true,
    format: 'esm',
    outfile: path.join(appDir, 'renderer/legacy-cold-fixture.js'),
  });
  const executablePath = path.join(root, '源码/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const runId = Date.now().toString();
  const results = [];
  for (const sizeMiB of [10, 50, 150]) {
    const config = {
      name: '梦藏冷启动隔离验收',
      userDataPath: path.join(qa, `legacy-cold-profile-${runId}-${sizeMiB}`),
      vaultPath: vault,
      recallBridgeDirectory: path.join(qa, `legacy-cold-bridge-${runId}-${sizeMiB}`),
      recallCompanionDirectory: path.join(qa, `legacy-cold-companion-${runId}-${sizeMiB}`),
    };
    for (const target of [appDir, ...Object.values(config).slice(1)]) assert.ok(target.startsWith(qa + path.sep));
    await fs.writeFile(path.join(appDir, 'candidate-config.json'), JSON.stringify(config));
    let app = await electron.launch({ executablePath, args: [appDir] });
    try {
      const page = await app.firstWindow();
      await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
      await page.evaluate(async (size) => {
        const { createWorkspaceStore, createWorkspaceState } = await import('/legacy-cold-fixture.js');
        const status = await window.mengcang.status();
        const store = createWorkspaceStore(status.data.identity.id);
        const state = createWorkspaceState();
        const chunkMiB = Math.min(50, size);
        for (let i = 0; i < Math.ceil(size / chunkMiB); i++) {
          const bytes = new Uint8Array(chunkMiB * 1024 * 1024);
          bytes.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
          bytes[12] = i;
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(new Blob([bytes], { type: 'audio/wav' }));
          });
          const id = `cold-${size}-${i}`;
          state.cards.push({
            id,
            type: 'audio',
            title: `冷启动${size}MiB样本 ${i}`,
            body: `已持久化的${size}MiB冷启动基线`,
            attachment: { name: `${id}.wav`, type: 'audio/wav', size: bytes.length, dataUrl },
          });
          state.savedIds.push(id);
        }
        await store.update(() => state);
        store.close();
      }, sizeMiB);
    } finally {
      await app.close();
    }
    const start = Date.now();
    app = await electron.launch({ executablePath, args: [appDir] });
    try {
      const page = await app.firstWindow();
      const firstCard = page.getByRole('button', { name: new RegExp(`打开 冷启动${sizeMiB}MiB样本 0`) });
      await firstCard.waitFor({ timeout: 60000 });
      const restartToLibraryOperableMs = Date.now() - start;
      await firstCard.click();
      await page.getByRole('button', { name: '整理', exact: true }).waitFor();
      const readback = await page.evaluate(async (size) => {
        const { createWorkspaceStore } = await import('/legacy-cold-fixture.js');
        const status = await window.mengcang.status();
        const store = createWorkspaceStore(status.data.identity.id);
        const state = await store.load();
        let bytesVerified = 0;
        for (const [index, card] of state.cards.entries()) {
          const raw = atob(card.attachment.dataUrl.split(',')[1]);
          if (raw.length !== card.attachment.size || raw.charCodeAt(12) !== index) throw Error('附件读回不一致');
          bytesVerified += raw.length;
        }
        if (bytesVerified !== size * 1024 * 1024) throw Error('资料库大小读回不一致');
        store.close();
        return { cards: state.cards.length, bytesVerified };
      }, sizeMiB);
      results.push({ sizeMiB, restartToLibraryOperableMs, detailOpened: true, ...readback });
      console.log(results.at(-1));
    } finally {
      await app.close();
    }
  }
  await fs.writeFile(
    path.join(root, '验收记录/governance-cold-baseline.json'),
    JSON.stringify(
      {
        runtime: 'archived-0.9.0-v2',
        samplesPerSize: 1,
        osCachesCleared: false,
        timingBoundary: 'process launch to persisted sample card visible; card detail operation then verified',
        results,
      },
      null,
      2,
    ) + '\n',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
