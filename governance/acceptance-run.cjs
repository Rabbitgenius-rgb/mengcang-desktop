const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { _electron: electron } = require('../源码/node_modules/playwright');
const { acceptanceProfile } = require('../源码/desktop/acceptance-profile.cjs');
const root = path.resolve(__dirname, '..');

async function candidateLaunch(executablePath, runsRoot) {
  const source = path.join(root, '源码');
  let config;
  let args = [];
  if (executablePath) {
    const supplied = await fs.realpath(executablePath);
    const app = supplied.endsWith('.app') ? supplied : path.resolve(supplied, '../../..');
    assert.ok(app.endsWith('.app'), '请指定治理候选 .app 或其中的可执行文件');
    const plist = path.join(app, 'Contents/Info.plist');
    const plistField = (key) => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
    assert.equal(plistField('CFBundleIdentifier'), 'com.rabbit.mengcang.governance', '仅可启动治理候选版验收');
    executablePath = path.join(app, 'Contents/MacOS', plistField('CFBundleExecutable'));
    assert.ok(supplied === app || supplied === executablePath, '可执行文件与候选包不匹配');
    const asar = await import(createRequire(path.join(source, 'package.json')).resolve('@electron/asar'));
    const archive = path.join(app, 'Contents/Resources/app.asar');
    config = JSON.parse(asar.extractFile(archive, 'candidate-config.json'));
    asar.statFile(archive, 'acceptance-profile.cjs');
    assert.ok(asar.extractFile(archive, 'main.cjs').toString().includes('mengcang-acceptance-run'), '此候选包不支持独立验收');
  } else {
    const resources = path.join(source, 'desktop/build/app');
    executablePath = path.join(source, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    config = JSON.parse(await fs.readFile(path.join(resources, 'candidate-config.json'), 'utf8'));
    assert.ok((await fs.readFile(path.join(resources, 'main.cjs'), 'utf8')).includes('mengcang-acceptance-run'), '请先重建支持独立验收的桌面资源');
    await fs.access(path.join(resources, 'acceptance-profile.cjs'));
    args = [resources];
  }
  assert.equal(config.acceptanceRunsRoot, runsRoot, '此候选版未绑定本仓库的独立验收目录');
  return { config, executablePath, args };
}

async function createAcceptanceRun({ executablePath } = {}) {
  const runsRoot = path.join(root, 'qa/acceptance-runs');
  const candidate = await candidateLaunch(executablePath, runsRoot);
  await fs.mkdir(runsRoot, { recursive: true, mode: 0o700 });
  assert.equal(await fs.realpath(runsRoot), runsRoot);
  const directory = await fs.mkdtemp(path.join(runsRoot, 'run-'));
  const vaultPath = path.join(directory, 'vault');
  const cards = path.join(vaultPath, '01_sources/cards/text');
  await fs.mkdir(cards, { recursive: true });
  await fs.writeFile(path.join(cards, 'source.md'), '---\ntype: material\ntitle: 治理验收来源\n---\n这是隔离验收资料。\n', { flag: 'wx' });
  function profilePath(profile = 'desktop') {
    assert.match(profile, /^[a-z][a-z0-9-]{0,39}$/);
    return path.join(directory, profile, 'profile');
  }
  async function launch(profile = 'desktop') {
    const userDataPath = profilePath(profile);
    const base = path.dirname(userDataPath);
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    assert.equal(await fs.realpath(base), base);
    for (const child of ['profile', 'bridge', 'companion']) await fs.mkdir(path.join(base, child), { recursive: true, mode: 0o700 });
    const selector = path.basename(directory) + '/' + profile;
    const active = acceptanceProfile(candidate.config, selector);
    assert.equal(active.userDataPath, userDataPath);
    const app = await electron.launch({ executablePath: candidate.executablePath, args: [...candidate.args, '--mengcang-acceptance-run=' + selector] });
    try {
      assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userDataPath, '启动目录与本次验收不符');
      return app;
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  return { directory, vaultPath, profilePath, launch };
}

async function requireBenchmarkRun(resources) {
  const config = JSON.parse(await fs.readFile(path.join(resources, 'candidate-config.json'), 'utf8'));
  const runs = path.join(root, 'qa/benchmark-runs');
  const run = path.dirname(config.userDataPath);
  assert.equal(path.dirname(run), runs, '请先准备独立性能资料目录');
  assert.match(path.basename(run), /^run-[a-zA-Z0-9]{6}$/);
  assert.equal(await fs.realpath(run), run);
  for (const [field, name] of Object.entries({
    userDataPath: 'profile',
    vaultPath: 'vault',
    recallBridgeDirectory: 'bridge',
    recallCompanionDirectory: 'companion',
  })) {
    assert.equal(config[field], path.join(run, name));
    await fs.mkdir(config[field], { recursive: true, mode: 0o700 });
    assert.equal(await fs.realpath(config[field]), config[field]);
  }
  return config.userDataPath;
}

module.exports = { createAcceptanceRun, requireBenchmarkRun };
