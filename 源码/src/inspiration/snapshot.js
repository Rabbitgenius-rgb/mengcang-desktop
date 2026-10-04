const fs = require('node:fs');
const { lookup } = require('node:dns/promises');
const { isIP } = require('node:net');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { setYamlFields } = require('./store');

const ORIGINAL_ROOT = '01_sources/_originals/images/web-snapshots';

function isPrivate(address) {
  if (address.includes(':')) return !/^[23][0-9a-f]{3}:/i.test(address);
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b));
}

async function publicUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('仅支持公开网页链接');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local)$/i.test(hostname)) throw new Error('不能抓取本机或内网地址');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivate(item.address))) throw new Error('不能抓取本机或内网地址');
  return url.href;
}

function browserStatus() {
  try {
    const playwright = require('playwright');
    return { ready: fs.existsSync(playwright.chromium.executablePath()), version: require('playwright/package.json').version };
  } catch { return { ready: false, version: '' }; }
}

async function installBrowser(plugin) {
  const cli = require.resolve('playwright/cli');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: plugin.manifest.dir ? path.join(plugin.app.vault.adapter.getBasePath(), plugin.manifest.dir) : undefined,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk.toString()).slice(-3000); });
    child.once('error', reject);
    child.once('close', code => code === 0 && browserStatus().ready ? resolve(true) : reject(new Error(`浏览器组件安装失败：${output.slice(-500) || code}`)));
  });
}

async function capture(plugin, url, previous) {
  if (!browserStatus().ready) throw new Error('请先安装本机截图组件');
  const safe = await publicUrl(url);
  const { chromium } = require('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
    const checks = new Map();
    await context.route('**/*', async route => {
      try {
        const target = new URL(route.request().url());
        if (!checks.has(target.origin)) checks.set(target.origin, publicUrl(target.origin).then(() => true).catch(() => false));
        if (!(await checks.get(target.origin))) return route.abort();
        await route.continue();
      } catch { await route.abort().catch(() => {}); }
    });
    const page = await context.newPage();
    let response;
    let navigationError = false;
    try { response = await page.goto(safe, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch { navigationError = true; }
    if (!/^https?:/.test(page.url())) throw new Error('网页无法打开');
    await page.waitForTimeout(1500);
    const title = (await page.title()).trim();
    const body = (await page.locator('body').innerText({ timeout: 3000 })).slice(0, 20000);
    const statusCode = response?.status() || 0;
    const blocked = [401, 403, 429].includes(statusCode) || /验证码中间页|安全验证|captcha|verify you are human/i.test(title)
      || (body.length < 1200 && /验证码|请完成验证|访问过于频繁|verify you are human/i.test(body));
    const incomplete = navigationError || !body.trim() || /视频数据加载中|正在加载视频/.test(body);
    const status = blocked ? 'blocked' : incomplete ? 'incomplete' : 'ready';
    const capturedAt = new Date().toISOString();
    if (status !== 'ready' && previous?.capture_status === 'ready' && previous?.snapshot_original_path) {
      return { capture_status: 'ready', last_capture_error: `本次为${status === 'blocked' ? '验证页面' : '未加载完成的页面'}，已保留旧快照`, last_capture_attempt: capturedAt };
    }
    const screenshot = await page.screenshot({ fullPage: false, timeout: 10000 });
    const digest = createHash('sha256').update(screenshot).digest('hex').slice(0, 16);
    const filename = `${capturedAt.replace(/[:.]/g, '-')}-${digest}.png`;
    const filePath = `${ORIGINAL_ROOT}/${filename}`;
    await plugin.app.vault.createBinary(filePath, screenshot);
    return { capture_status: status, captured_at: capturedAt, last_capture_attempt: capturedAt,
      page_title: title, http_status: statusCode, snapshot_original_path: filePath,
      cover: `[[${filePath}]]`, last_capture_error: '' };
  } finally { await browser?.close(); }
}

async function captureIntoNote(store, file) {
  const plugin = store.plugin;
  const source = await plugin.app.vault.read(file);
  const fields = require('./store').frontmatterOf(source);
  let patch;
  try { patch = await capture(plugin, fields.source_url, fields); }
  catch (error) { patch = { capture_status: fields.capture_status === 'ready' ? 'ready' : 'failed', last_capture_error: error.message, last_capture_attempt: new Date().toISOString() }; }
  await plugin.app.vault.process(file, current => setYamlFields(current, patch));
  await store.refreshNow();
  return patch;
}

module.exports = { publicUrl, browserStatus, installBrowser, capture, captureIntoNote, ORIGINAL_ROOT };
