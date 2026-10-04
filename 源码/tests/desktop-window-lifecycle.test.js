'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const aiPolicy = require('../desktop/ai-policy.cjs');

const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve=yes;reject=no; }); return { promise, resolve, reject }; }
function harness({ smoke = false } = {}) {
  const ready = deferred(), created = deferred(), windows = [], handlers = new Map(), protocols = new Map(), errors = [], timers = new Set();
  let readyTask;
  const app = new EventEmitter();
  Object.assign(app, {
    setName() {}, requestSingleInstanceLock: () => true, getPath: () => '/synthetic/user-data',
    commandLine: { hasSwitch: name => smoke && name === 'smoke-test' },
    whenReady: () => ({ then(callback) { readyTask=ready.promise.then(callback);return readyTask; } }),
    quit() {}, exit() {},
  });
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options=options;this.visible=false;this.minimized=false;this.destroyed=false;this.shows=0;this.restores=0;this.focuses=0;this.load=deferred();
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { send() {}, setWindowOpenHandler() {}, isDestroyed:()=>this.destroyed, mainFrame:{}, session: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } }) });
      this.routesReady = protocols.has('mengcang') && handlers.has('mengcang:status');
      windows.push(this);created.resolve(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    restore() { this.restores++;this.minimized=false; }
    show() { this.shows++;const changed=!this.visible;this.visible=true;if(changed)this.emit('show'); }
    focus() { this.focuses++; }
    loadURL(url) { this.url=url;return this.load.promise; }
    destroy() { this.destroyed=true;this.emit('closed'); }
  }
  class FakeGateway extends EventEmitter { status() { return { paired:false,connected:false }; } connect() { return Promise.resolve(); } dispose() {} }
  const electron = {
    app, BrowserWindow:FakeWindow, ipcMain:{handle(name,fn){handlers.set(name,fn);}},
    protocol:{registerSchemesAsPrivileged(){},handle(name,fn){protocols.set(name,fn);}},
    safeStorage:{isEncryptionAvailable(){throw Error('The test must not access credentials');}},
    dialog:{showErrorBox(...args){errors.push(args);}}, shell:{},
    Menu:{buildFromTemplate:items=>items,setApplicationMenu(){}}, powerMonitor:new EventEmitter(),
  };
  const security = { PRODUCTION_VAULT:'/synthetic/vault', trustedFrame:event=>event?.syntheticTrusted===true, createPrivateWriteQueue:()=>({failed:0,drain:async()=>{},retryFailures:async()=>{}}) };
  const mockFs = {existsSync:()=>false,promises:{mkdir:async()=>{}}};
  const requireMock = id => id==='electron'?electron:id==='node:fs'?mockFs:id==='./intelligence-bridge.cjs'?{registerIntelligence:async()=>{}}:id==='./local-gateway.cjs'?{LocalVaultGateway:FakeGateway}:id==='./discovery.cjs'?{analyze(){throw Error('Window lifecycle tests must not launch native analysis');}}:id==='./renderer-quit.cjs'?require('../desktop/renderer-quit.cjs'):id==='./download-lifecycle.cjs'?require('../desktop/download-lifecycle.cjs'):id==='./ai-policy.cjs'?aiPolicy:id==='./security.cjs'?security:require(id);
  vm.runInNewContext(source, { require:requireMock,__dirname:'/synthetic/app',console,URL,structuredClone,Buffer,
    setTimeout:(callback,milliseconds)=>{const timer={callback,milliseconds};timers.add(timer);return timer;},clearTimeout:timer=>timers.delete(timer),
  }, {filename:'desktop/main.cjs'});
  return {app,windows,handlers,errors,timers,
    async start() { ready.resolve();return Promise.race([created.promise,readyTask.then(()=>{if(!windows.length)throw Error('Startup failed before window creation: '+JSON.stringify(errors));return windows[0];})]); },
    async finish(window) { window.load.resolve();await window.load.promise;await Promise.resolve(); },
    get readyTask() { return readyTask; },
  };
}

test('successful initial load reveals the window when ready-to-show is absent', async () => {
  const f=harness(), window=await f.start();
  assert.equal(window.options.show,false);assert.equal(window.shows,0);assert.equal(window.routesReady,true);
  await f.finish(window);await f.readyTask;
  assert.equal(window.shows,1);assert.equal(window.focuses,1);assert.equal(window.visible,true);
  window.emit('ready-to-show');assert.equal(window.shows,1);assert.deepEqual(f.errors,[]);
});

test('ready-to-show followed by successful load reveals only once', async () => {
  const f=harness(), window=await f.start();window.emit('ready-to-show');
  assert.equal(window.shows,1);await f.finish(window);await f.readyTask;
  assert.equal(window.shows,1);assert.equal(window.focuses,1);
});

test('activate restores hidden or minimized windows without creating windows or rebinding listeners', async () => {
  const f=harness(), window=await f.start();await f.finish(window);await f.readyTask;
  const listeners=()=>JSON.stringify({close:window.listenerCount('close'),closed:window.listenerCount('closed'),show:window.listenerCount('show'),ready:window.listenerCount('ready-to-show'),navigate:window.webContents.listenerCount('will-navigate')});
  const before=listeners();window.visible=false;f.app.emit('activate');
  assert.equal(window.visible,true);assert.equal(window.restores,0);assert.equal(window.shows,2);assert.equal(window.focuses,2);
  window.minimized=true;f.app.emit('activate');assert.equal(window.minimized,false);assert.equal(window.restores,1);assert.equal(window.shows,3);assert.equal(window.focuses,3);
  f.app.emit('second-instance');assert.equal(window.shows,4);assert.equal(window.focuses,4);
  assert.equal(f.windows.length,1);assert.equal(listeners(),before);assert.equal(f.app.listenerCount('activate'),1);assert.equal(f.app.listenerCount('second-instance'),1);
});

test('smoke mode never restores, shows or focuses on startup or activation', async () => {
  const f=harness({smoke:true}), window=await f.start();window.emit('ready-to-show');await f.finish(window);await f.readyTask;
  window.minimized=true;f.app.emit('activate');f.app.emit('second-instance');
  assert.equal(window.shows,0);assert.equal(window.focuses,0);assert.equal(window.restores,0);assert.equal(f.windows.length,1);
});

test('activation before startup registration cannot create a premature duplicate window', async () => {
  const f=harness();f.app.emit('activate');f.app.emit('second-instance');assert.equal(f.windows.length,0);
  const window=await f.start();assert.equal(window.routesReady,true);assert.equal(f.windows.length,1);await f.finish(window);await f.readyTask;
});

test('late load completion from a destroyed window cannot reveal its replacement', async () => {
  const f=harness(), oldWindow=await f.start();oldWindow.destroy();f.app.emit('activate');
  assert.equal(f.windows.length,2);const replacement=f.windows[1];
  await f.finish(oldWindow);await f.readyTask;assert.equal(oldWindow.shows,0);assert.equal(replacement.shows,0);
  await f.finish(replacement);assert.equal(replacement.shows,1);assert.equal(replacement.focuses,1);assert.equal(replacement.visible,true);
});

test('registered AI handlers reject trusted requests and still enforce frame authorization', async () => {
  const f=harness(), window=await f.start();await f.finish(window);await f.readyTask;
  for(const name of ['discoveryAnalyze','discoveryExtract']) {
    const handler=f.handlers.get(`mengcang:${name}`);
    assert.equal(typeof handler,'function');
    const denied=await handler({syntheticTrusted:true},{enabled:true,operationId:'synthetic'});
    assert.equal(denied.ok,false);assert.equal(denied.error.code,'AI_DISABLED');
    assert.match(denied.error.message,/AI/);
    const untrusted=await handler({syntheticTrusted:false},{});
    assert.equal(untrusted.ok,false);assert.equal(untrusted.error.code,'FORBIDDEN');
  }
});

test('desktop resource copy includes the policy required by its entry point', async t => {
  const root=path.resolve(__dirname,'..');
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'mengcang-bundle-policy-'));
  t.after(()=>fs.rmSync(target,{recursive:true,force:true}));
  const buildSource=fs.readFileSync(path.join(root,'scripts/build-desktop.mjs'),'utf8');
  const copyStep=buildSource.match(/^for \(const file of \[[^\n]+\]\) await fs\.copyFile[^\n]+;$/m)?.[0];
  assert.ok(copyStep,'the production desktop resource copy step must be present');
  await vm.runInNewContext(`(async()=>{${copyStep}})()`,{fs:fs.promises,path,root,target});
  const bundledEntry=fs.readFileSync(path.join(target,'main.cjs'),'utf8');
  assert.match(bundledEntry,/require\(['"]\.\/ai-policy\.cjs['"]\)/);
  assert.equal(fs.readFileSync(path.join(target,'ai-policy.cjs'),'utf8'),fs.readFileSync(path.join(root,'desktop/ai-policy.cjs'),'utf8'));
  const bundledPolicy=require(path.join(target,'ai-policy.cjs'));
  assert.equal(bundledPolicy.AI_ENABLED,false);
  assert.throws(()=>bundledPolicy.rejectAiRequest(),{code:'AI_DISABLED'});
});
