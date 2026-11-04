const { _electron: electron } = require('../源码/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const root = path.resolve(__dirname, '..');
  const app = await electron.launch({
    executablePath: path.join(root, '源码/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [path.join(root, '源码/desktop/build/app')],
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
    const out = path.join(root, 'qa/baseline');
    await fs.mkdir(out, { recursive: true });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(out, `library-${width}.png`) });
    }
    console.log(await page.locator('button').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') || n.textContent).slice(0, 35)));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
