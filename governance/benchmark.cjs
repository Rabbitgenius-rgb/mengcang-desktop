const { _electron: electron } = require('../源码/node_modules/playwright');
const { build } = require('../源码/node_modules/esbuild');
const fs = require('node:fs/promises'),
  path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..'),
    source = path.join(root, '源码'),
    dir = path.join(source, 'desktop/build/app');
  const benchmarkProfile = await require('./acceptance-run.cjs').requireBenchmarkRun(dir);
  await build({
    stdin: {
      contents: process.argv.includes('--v3')
        ? "export {createWorkspaceStoreV3 as createWorkspaceStore} from './src/sublime/workspaceStoreV3.js';export {workspaceReducer,createWorkspaceState} from './src/sublime/workspaceModel.js';"
        : "export {createWorkspaceStore} from './src/sublime/workspaceStore.js';export {workspaceReducer,createWorkspaceState} from './src/sublime/workspaceModel.js';",
      resolveDir: path.join(source, 'prototypes/desktop-workbench'),
    },
    bundle: true,
    format: 'esm',
    outfile: path.join(dir, 'renderer/bench.js'),
  });
  const results = [];
  for (const size of process.argv.includes('--v3') ? [500] : [10, 50, 150]) {
    const start = Date.now();
    const app = await electron.launch({ executablePath: path.join(source, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [dir] });
    try {
      if ((await app.evaluate(({ app }) => app.getPath('userData'))) !== benchmarkProfile) throw Error('性能运行使用了非验收资料目录。');
      const page = await app.firstWindow();
      await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
      const boot = Date.now() - start;
      const sample = await page.evaluate(
        async ({ size }) => {
          const { createWorkspaceStore, workspaceReducer, createWorkspaceState } = await import('/bench.js');
          const status = await window.mengcang.status();
          const store = createWorkspaceStore(status.data.identity.id);
          let state = createWorkspaceState();
          const part = Math.min(size, 50),
            count = Math.ceil(size / part);
          for (let i = 0; i < count; i++) {
            const data = new Uint8Array(Math.min(part, size - i * part) * 1024 * 1024);
            data.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
            data[12] = i;
            const text = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(new Blob([data]));
            });
            const attachment = { name: `audio-${i}.wav`, type: 'audio/wav', size: data.length, dataUrl: 'data:audio/wav;base64,' + text };
            state.cards.push({ id: 'audio-' + i, type: 'audio', title: '隔离性能样本 ' + i, attachment });
            state.savedIds.push('audio-' + i);
          }
          await store.update(() => state);
          state = null;
          const star = [],
            save = [];
          for (let i = 0; i < 20; i++) {
            let t = performance.now();
            await store.update((s) => workspaceReducer(s, { type: 'card.favorite', id: 'audio-0', value: i % 2 === 0 }));
            star.push(performance.now() - t);
            t = performance.now();
            await store.update((s) => workspaceReducer(s, { type: 'card.upsert', card: { id: 'audio-0', body: '保存 ' + i } }));
            save.push(performance.now() - t);
          }
          const persisted = await store.load();
          if (persisted.cards.length !== count || persisted.cards[0].body !== '保存 19') throw Error('性能验收读回失败');
          store.close();
          return { sizeMiB: size, star, save };
        },
        { size },
      );
      results.push({ ...sample, isolatedAppStartMs: boot });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await app.close();
    }
  }
  await fs.writeFile(
    path.join(root, '验收记录', process.argv.includes('--v3') ? 'governance-performance-v3.json' : 'governance-performance-baseline.json'),
    JSON.stringify(results, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
