const { _electron: electron } = require('../源码/node_modules/playwright');
const { build } = require('../源码/node_modules/esbuild');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'),
    source = path.join(root, '源码'),
    dir = path.join(source, 'desktop/build/app'),
    output = path.join(root, '验收记录/桌面验收');
  await fs.mkdir(output, { recursive: true });
  const { outputFiles } = await build({
    entryPoints: [path.join(root, 'governance/fixtures.mjs')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'governanceFixtures',
  });
  const config = JSON.parse(await fs.readFile(path.join(dir, 'candidate-config.json'), 'utf8'));
  assert.ok(config.userDataPath.startsWith(path.join(root, 'qa') + path.sep));
  assert.ok(config.vaultPath.startsWith(path.join(root, 'qa') + path.sep));
  if (process.argv.includes('--fresh')) await fs.rm(config.userDataPath, { recursive: true, force: true });
  const errors = [],
    checks = [];
  async function launch() {
    const app = await electron.launch({
      executablePath:
        (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null) ||
        path.join(source, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args: process.argv[2] && !process.argv[2].startsWith('--') ? [] : [dir],
    });
    const page = await app.firstWindow();
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error('PAGE', e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('CONSOLE', m.text());
    });
    await page.waitForURL('mengcang://app/**');
    await page.waitForLoadState('domcontentloaded');
    await page.addInitScript({ content: outputFiles[0].text + ';globalThis.governanceFixtures=governanceFixtures;' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      await page.getByRole('textbox', { name: /搜索/ }).first().waitFor({ timeout: 10000 });
    } catch (e) {
      console.error(await page.locator('body').innerText());
      await app.close();
      throw e;
    }
    return { app, page };
  }
  let { app, page } = await launch();
  try {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(output, `library-${width}.png`) });
      await page.getByRole('button', { name: '打开 治理验收来源 · 原始资料', exact: true }).click();
      await page.getByRole('button', { name: '整理', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `detail-${width}.png`) });
      await page.getByRole('button', { name: '整理', exact: true }).click();
      await page.getByText('给这张卡加备注', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `organize-${width}.png`) });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '返回', exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(async () => {
      const status = await window.mengcang.status();
      return governanceFixtures.seedLibrary(status.data.identity.id);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
    const search = page.getByRole('textbox', { name: /搜索/ }).first();
    await search.fill('圆圈、节点与链接');
    await page.getByRole('button', { name: /打开 圆圈、节点与链接/ }).click();
    await page.getByRole('heading', { name: '阅读想法' }).waitFor();
    assert.equal(await page.locator('.se-safe-rich ol li').count(), 2);
    assert.ok(await page.locator('.se-safe-rich pre code').count());
    checks.push('关键词搜索与Markdown');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await search.fill('万维网概念图');
    await page.getByRole('button', { name: /打开 万维网概念图/ }).click();
    console.log(
      await page.locator('button,a').evaluateAll((nodes) =>
        nodes
          .map((n) => n.getAttribute('aria-label') || n.textContent)
          .filter(Boolean)
          .slice(0, 35),
      ),
    );
    await page.screenshot({ path: path.join(output, 'concept-detail.png') });
    checks.push('图片详情');
    await page
      .getByRole('button', { name: /放大.*图|查看.*原图/ })
      .first()
      .click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    checks.push('图片放大与Esc');
    await page.getByRole('button', { name: '回到来源文章中的配图', exact: true }).click();
    await page.getByRole('heading', { name: '万维网验收文章', exact: true }).waitFor();
    await page
      .getByRole('button', { name: /本文收藏/ })
      .first()
      .click();
    await page.getByRole('button', { name: /在本文看这段摘录/ }).click();
    await page.getByText('已定位到这段文字。', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: /本文收藏/ })
      .first()
      .click();
    await page.getByRole('button', { name: /在本文看这张图/ }).click();
    checks.push('来源文章与摘录配图定位');
    await page.getByRole('button', { name: '写关联笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '标题（选填）' }).fill('治理验收关联笔记');
    await page.getByRole('textbox', { name: '笔记正文' }).fill('记录圆圈与链接的回读路线');
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    checks.push('关联笔记保存');
    await page.getByRole('button', { name: '整理', exact: true }).click();
    await page.getByPlaceholder('写下备注…').fill('桌面整理验收备注');
    await page.getByRole('switch', { name: '标星', exact: true }).click();
    await page.getByRole('button', { name: '保存更改', exact: true }).click();
    checks.push('备注与标星保存');
    await page.getByRole('button', { name: '资料库', exact: true }).click();
    await search.fill('治理验收关联笔记');
    await page.getByRole('button', { name: /打开 治理验收关联笔记/ }).click();
    await page.getByRole('button', { name: '返回来源：万维网验收文章', exact: true }).click();
    checks.push('关联笔记独立搜索与双向返回');
    await page.getByRole('button', { name: '回看', exact: true }).click();
    await page.getByText('治理回看摘录 1', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'recall.png') });
    checks.push('回看列表');
  } finally {
    await app.close();
  }
  ({ app, page } = await launch());
  try {
    const state = await page.evaluate(async () => {
      const status = await window.mengcang.status();
      return governanceFixtures.inspectLibrary(status.data.identity.id);
    });
    const savedNote = state.cards.find((c) => c.title === '治理验收关联笔记');
    assert.ok(savedNote);
    assert.equal(state.annotations[savedNote.id].note, '桌面整理验收备注');
    assert.ok(state.favoriteIds.includes(savedNote.id));
    assert.equal(state.hiddenIds.length, 1);
    checks.push('关闭重开读回备注标星笔记及回看归档');
  } finally {
    await app.close();
  }
  assert.deepEqual(errors, []);
  const result = { checks, errors };
  await fs.writeFile(path.join(root, '验收记录/governance-desktop-acceptance.json'), JSON.stringify(result, null, 2));
  console.log(result);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
