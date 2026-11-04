const { _electron: electron } = require('../源码/node_modules/playwright');
const fs = require('node:fs/promises'),
  path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..'),
    input = process.argv[2];
  if (!input) throw Error('请提供已归档的0.9.0应用资源目录');
  const run = await fs.mkdtemp(path.join(root, 'qa/reference-'));
  const appDir = path.join(run, 'app');
  const vault = path.join(run, 'vault');
  const cards = path.join(vault, '01_sources/cards/text');
  await fs.mkdir(cards, { recursive: true });
  await fs.writeFile(path.join(cards, 'source.md'), '---\ntype: material\ntitle: 治理验收来源\n---\n这是隔离验收资料。\n', { flag: 'wx' });
  await fs.cp(input, appDir, { recursive: true });
  await fs.writeFile(
    path.join(appDir, 'candidate-config.json'),
    JSON.stringify({
      name: '梦藏界面对照',
      userDataPath: path.join(run, 'profile'),
      vaultPath: vault,
      recallBridgeDirectory: path.join(run, 'bridge'),
      recallCompanionDirectory: path.join(run, 'companion'),
    }),
  );
  const app = await electron.launch({
    executablePath: path.join(root, '源码/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [appDir],
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
    const out = path.join(root, '验收记录/界面对照/0.9.0');
    await fs.mkdir(out, { recursive: true });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(out, `library-${width}.png`) });
      await page.getByRole('button', { name: '打开 治理验收来源 · 原始资料', exact: true }).click();
      await page.getByRole('button', { name: '整理', exact: true }).waitFor();
      await page.screenshot({ path: path.join(out, `detail-${width}.png`) });
      await page.getByRole('button', { name: '整理', exact: true }).click();
      await page.getByText('给这张卡加备注', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(out, `organize-${width}.png`) });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '返回', exact: true }).click();
    }
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
