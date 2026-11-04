const { chromium } = require('../源码/node_modules/playwright');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    client = path.join(root, '源码/prototypes/desktop-workbench/dist/client'),
    out = path.join(root, '验收记录/浏览器验收');
  await fs.mkdir(out, { recursive: true });
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
  const server = http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(client, '.' + (name === '/' ? '/index.html' : name));
      if (!file.startsWith(client + path.sep)) throw Error();
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(),
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
    const tools = page.getByRole('button', { name: '本机工具', exact: true });
    await tools.click();
    await page.getByRole('menu').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'menuitem');
    const first = await page.evaluate(() => document.activeElement.textContent);
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.evaluate(() => document.activeElement.textContent), first);
    await page.keyboard.press('Escape');
    assert.equal(await tools.evaluate((e) => e === document.activeElement), true);
    await page.getByRole('button', { name: '添加卡片', exact: true }).click();
    await page.getByRole('menuitem', { name: '写笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '卡片正文', exact: true }).fill('浏览器验收笔记\n\n原始正文保留。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '整理', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '整理', exact: true }).waitFor();
    await page.getByRole('button', { name: '整理', exact: true }).click();
    await page.getByRole('button', { name: '收藏集', exact: true }).last().click();
    await page.getByRole('button', { name: '新建收藏集', exact: true }).click();
    await page.getByRole('textbox', { name: '新收藏集名称', exact: true }).fill('浏览器验收收藏集');
    await page.getByRole('button', { name: '保存更改', exact: true }).click();
    await page.getByRole('button', { name: '浏览器验收收藏集', exact: true }).waitFor();
    await tools.click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: '导出完整备份', exact: true }).click();
    const file = await download;
    assert.ok(file.suggestedFilename().endsWith('.zip'));
    const zip = await require('../源码/prototypes/desktop-workbench/node_modules/jszip').loadAsync(await fs.readFile(await file.path()));
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.ok(manifest.state.cards.some((c) => c.body.includes('原始正文保留')));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '资料库', exact: true }).click();
    const layouts = [];
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(out, `library-${width}.png`) });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth || document.querySelector('.sublime-workspace').scrollWidth > innerWidth,
      );
      assert.equal(overflow, false);
      layouts.push({ width, height, noHorizontalOverflow: true });
    }
    assert.deepEqual(errors, []);
    const result = { checks: ['菜单键盘与Esc返焦', '新建保存并刷新读回', '收藏集创建与归属', '完整ZIP导出读回'], layouts, errors };
    await fs.writeFile(path.join(root, '验收记录/governance-browser-acceptance.json'), JSON.stringify(result, null, 2));
    console.log(result);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
