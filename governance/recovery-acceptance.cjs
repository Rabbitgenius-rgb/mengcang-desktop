const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const JSZip = require('../源码/prototypes/desktop-workbench/node_modules/jszip');
const { build } = require('../源码/node_modules/esbuild');
const { createAcceptanceRun } = require('./acceptance-run.cjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceId = '01_sources/cards/text/source.md';
const originalNote = '原始资料的恢复验收备注';
const root = path.resolve(__dirname, '..');

(async () => {
  assert.ok(process.argv[2], '请指定已打包的新候选版');
  const run = await createAcceptanceRun({ executablePath: process.argv[2] });
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
    globalName: 'recoveryTest',
  });
  const errors = [];
  let app, page;
  async function launch(profile) {
    app = await run.launch(profile);
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForURL('mengcang://app/**');
    await page.addInitScript({ content: bundle.outputFiles[0].text + ';globalThis.recoveryTest=recoveryTest;' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: /搜索/ }).first().waitFor();
  }
  async function close() {
    const current = app;
    app = null;
    if (current) await current.close();
  }
  async function state() {
    return page.evaluate(async () => recoveryTest.inspectLibrary((await window.mengcang.status()).data.identity.id));
  }
  async function library() {
    await page.getByRole('button', { name: '资料库', exact: true }).first().click();
  }
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function menu(name) {
    await button('本机工具').click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  async function openCard(name) {
    await library();
    await page.getByRole('textbox', { name: /搜索/ }).first().fill(name);
    await page
      .getByRole('button', { name: new RegExp('打开 ' + name) })
      .first()
      .click();
  }
  async function importFile(file, expectDialog = true) {
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(file);
    if (expectDialog) await page.getByRole('dialog', { name: '导入备份' }).waitFor();
  }
  const filename = path.join(run.directory, '工作区.zip');
  const attachmentDir = path.join(run.profilePath('target'), 'attachments-v3');
  async function filenames() {
    try {
      return (await fs.readdir(attachmentDir)).sort();
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }
  const result = {};
  try {
    await launch('source');
    await page.evaluate(async () => {
      const id = (await window.mengcang.status()).data.identity.id;
      await recoveryTest.seedLibrary(id);
      const store = recoveryTest.createWorkspaceStoreV3(id);
      // 10 ms of 8-bit mono PCM silence, including a complete WAV header.
      const wav = new Uint8Array(44 + 80);
      const header = new DataView(wav.buffer);
      for (const [offset, text] of [
        [0, 'RIFF'],
        [8, 'WAVEfmt '],
        [36, 'data'],
      ])
        wav.set(new TextEncoder().encode(text), offset);
      for (const [offset, value] of [
        [4, wav.length - 8],
        [16, 16],
        [24, 8000],
        [28, 8000],
        [40, 80],
      ])
        header.setUint32(offset, value, true);
      for (const [offset, value] of [
        [20, 1],
        [22, 1],
        [32, 1],
        [34, 8],
      ])
        header.setUint16(offset, value, true);
      wav.fill(128, 44);
      const attachment = { name: 'recovery.wav', type: 'audio/wav', size: wav.length, dataUrl: 'data:audio/wav;base64,' + btoa(String.fromCharCode(...wav)) };
      await store.update((state) =>
        [
          { type: 'card.upsert', card: { id: 'retry-wav', title: '原件入库重试样本', type: 'audio', body: 'test', attachment } },
          { type: 'card.save', id: 'retry-wav', saved: true },
          { type: 'draft.set', key: 'recall-workbench-v1', value: { read: { [state.cards.find((c) => c.title === '治理回看摘录 1').id]: true } } },
        ].reduce(recoveryTest.workspaceReducer, state),
      );
      store.close();
    });
    await page.reload();
    await openCard('原件入库重试样本');
    await button('更多').first().click();
    await page.getByRole('menuitem', { name: '存入梦藏仓库', exact: true }).click();
    await page.getByRole('checkbox', { name: /同时保存原文件/ }).check();
    const notes = path.join(run.vaultPath, '01_sources/cards/text');
    const mode = (await fs.stat(notes)).mode & 0o777;
    try {
      await fs.chmod(notes, 0o500);
      await button('确认保存新笔记').click();
      await page
        .getByText(/EACCES|permission denied|EPERM/i)
        .first()
        .waitFor();
    } finally {
      await fs.chmod(notes, mode);
    }
    const pending = (await state()).drafts['vault:retry-wav'];
    assert.ok(pending.operationId && !pending.savedPath);
    await button('确认保存新笔记').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const done = (await state()).drafts['vault:retry-wav'];
    assert.equal(done.operationId, pending.operationId);
    assert.ok(done.savedPath);
    assert.equal((await fs.readdir(notes)).filter((name) => name.includes(done.operationId)).length, 1);
    result.retrySameOperation = true;
    await openCard('治理验收来源');
    await button('整理').click();
    await page.getByPlaceholder('写下备注…').fill(originalNote);
    await page.getByRole('switch', { name: '标星', exact: true }).click();
    await button('保存更改').click();
    await button('更多').first().click();
    await page.getByRole('menuitem', { name: '归档卡片', exact: true }).click();
    const before = await state();
    assert.equal(before.annotations[sourceId].note, originalNote);
    assert.ok(before.hiddenIds.includes(sourceId) && before.favoriteIds.includes(sourceId));
    await library();
    await app.evaluate(({ dialog }, dest) => {
      dialog.showSaveDialogSync = () => dest;
    }, filename);
    await menu('导出完整备份');
    await page.getByRole('dialog').waitFor();
    await page.waitForFunction(() => typeof window.mengcang !== 'undefined');
    let zip;
    for (let i = 0; i < 80 && !zip; i++) {
      try {
        zip = await JSZip.loadAsync(await fs.readFile(filename));
      } catch (e) {
        if (i === 79) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.equal(manifest.attachments.length, 2);
    await close();
    await launch('target');
    await importFile(filename);
    assert.deepEqual(await filenames(), []);
    await page.keyboard.press('Escape');
    assert.deepEqual(await filenames(), []);
    const badFile = path.join(run.directory, '损坏的第二个附件.zip');
    const reparse = await JSZip.loadAsync(await fs.readFile(filename));
    const badEntry = 'attachments/' + manifest.attachments[1].sha256;
    const badMember = await reparse.file(badEntry).async('nodebuffer');
    badMember[badMember.length - 1] ^= 1;
    reparse.file(badEntry, badMember);
    await fs.writeFile(badFile, await reparse.generateAsync({ type: 'nodebuffer' }));
    await importFile(badFile, false);
    await page
      .getByText(/无法读取备份.*校验|附件.*校验失败/)
      .first()
      .waitFor();
    assert.deepEqual(await filenames(), []);
    result.previewCancelAndFailedZipWriteNoFiles = true;
    const image = manifest.attachments.find((a) => a.type === 'image/png');
    const healthy = await zip.file('attachments/' + image.sha256).async('nodebuffer');
    await fs.mkdir(attachmentDir, { recursive: true });
    const broken = Buffer.from(healthy);
    broken[broken.length - 1] ^= 1;
    const imagePath = path.join(attachmentDir, image.sha256);
    await fs.writeFile(imagePath, broken, { flag: 'wx' });
    await importFile(filename);
    assert.ok((await fs.readFile(imagePath)).equals(broken));
    await button('恢复备份').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await close();
    await launch('target');
    const recovered = await state();
    assert.equal(recovered.annotations[sourceId].note, originalNote);
    assert.ok(recovered.favoriteIds.includes(sourceId) && recovered.hiddenIds.includes(sourceId));
    assert.deepEqual(recovered.hiddenIds, before.hiddenIds);
    assert.deepEqual(recovered.drafts['recall-workbench-v1'], before.drafts['recall-workbench-v1']);
    assert.deepEqual(
      recovered.cards.map((c) => c.id),
      before.cards.map((c) => c.id),
    );
    for (const ref of manifest.attachments) assert.equal(hash(await fs.readFile(path.join(attachmentDir, ref.sha256))), ref.sha256);
    assert.ok((await fs.readFile(imagePath)).equals(healthy));
    result.afterRestart = {
      originalNote: true,
      originalFavorite: true,
      originalHidden: true,
      recallArchive: true,
      recallReadState: true,
      allAttachmentHashesMatch: true,
      repairedImageBytes: healthy.length,
    };
    await menu('已归档卡片');
    await page.getByText('治理验收来源', { exact: true }).first().waitFor();
    await openCard('万维网概念图');
    await page.waitForFunction(() => [...document.images].some((im) => im.complete && im.naturalWidth === 800));
    await button('整理').click();
    await page.getByPlaceholder('写下备注…').fill('恢复后在目标库写的备注');
    await button('保存更改').click();
    await library();
    await importFile(filename);
    assert.equal(await button('恢复备份').count(), 0);
    await button('合并备份').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await state()).annotations['qa-image'].note, '恢复后在目标库写的备注');
    result.nonEmptyMergePreservesNewerNote = true;
    await menu('关于本机资料库');
    await page.getByText(/每个附件最多 64 MiB/).waitFor();
    await page.keyboard.press('Escape');
    await menu('粘贴备份内容');
    assert.match(await page.getByRole('dialog').innerText(), /旧版兼容/);
    result.helpVerified = true;
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(run.directory, '恢复验收.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ run: run.directory, result }));
  } catch (e) {
    if (page && !page.isClosed()) console.error('界面', (await page.locator('body').innerText()).slice(0, 3800));
    throw e;
  } finally {
    await close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
