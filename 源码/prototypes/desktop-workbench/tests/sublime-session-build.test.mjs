import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

// Match Vite 6's default production targets. Running the actual minified module
// catches optional-call lowering faults that source-module tests cannot expose.
const built = await build({
  entryPoints:[fileURLToPath(new URL('../src/sublime/workspacePersistence.js', import.meta.url))],
  bundle:true, write:false, platform:'browser', format:'cjs', minify:true,
  target:['chrome87','edge88','firefox78','safari14'],
});
// Compile in the current JavaScript realm so strict plain-object validation is
// unchanged. Only the lexical crypto environment differs between these runs.
const runModule = vm.compileFunction(built.outputFiles[0].text,
  ['module','exports','globalThis'], {filename:'production-workspace-session.cjs'});

async function saveDraft(crypto, options) {
  const module = {exports:{}};
  runModule(module, module.exports, {crypto});
  let saved={schemaVersion:1,cards:[],savedIds:[],favoriteIds:[],hiddenIds:[],collections:[],boards:[],annotations:{},drafts:{},version:1};
  let revision=0;
  const snapshot=()=>({state:saved,revision,entityVersions:{}});
  const store = {
    loadSnapshot:async()=>snapshot(),
    update:async updater=>{saved=structuredClone(updater(saved,snapshot()));revision++;return snapshot();},
  };
  const session = module.exports.createWorkspaceSession(store, options);
  await session.load();
  await session.commit({type:'draft.set',key:'new:text',value:{body:'构建后草稿'}});
  const entries = Object.entries(saved.drafts);
  assert.equal(entries.length,1);
  assert.equal(entries[0][1].key,'new:text');
  assert.equal(entries[0][1].value.body,'构建后草稿');
  return entries[0][0];
}

test('production session defaults call the available crypto provider with its receiver',async()=>{
  let calls=0;
  const provider={randomUUID(){assert.equal(this,provider);calls++;return 'compiled-uuid';}};
  assert.equal(await saveDraft(provider), 'window-draft:compiled-uuid:new%3Atext');
  assert.equal(calls,1);
});

test('production session defaults remain usable when crypto is unavailable',async()=>{
  const key = await saveDraft(undefined);
  const match = /^window-draft:(\d+)-([^:]+):new%3Atext$/.exec(key);
  assert.ok(match, 'The fallback keeps the timestamp and random owner parts');
  assert.ok(Number.isFinite(Number(match[1])));
  const random = Number(match[2]);
  assert.ok(Number.isFinite(random) && random >= 0 && random < 1);
});

test('production session respects an explicit owner without generating another identity',async()=>{
  const provider={randomUUID(){throw Error('Explicit sessionId must bypass generation');}};
  assert.equal(await saveDraft(provider,{sessionId:'explicit-session'}), 'window-draft:explicit-session:new%3Atext');
});
