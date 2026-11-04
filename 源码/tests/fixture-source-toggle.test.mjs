import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {zstdCompressSync} from 'node:zlib';

const execute=promisify(execFile),id='1f148989-cc67-4d2c-9b9e-38029b21a303';
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'recall-source-toggle-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const script=path.join(root,'scripts/fixture-source-toggle.mjs');await fs.mkdir(path.dirname(script));
 const source=await fs.readFile(new URL('../../scripts/fixture-source-toggle.mjs',import.meta.url),'utf8');
 // Only the network boundary is stubbed. All path validation, compressed
 // fixture validation, hash checks and reversible file operations are real.
 const offline="import {EventEmitter} from 'node:events'; const net={createConnection(){const socket=new EventEmitter();socket.setTimeout=()=>{};socket.destroy=()=>{};queueMicrotask(()=>socket.emit('error',Object.assign(Error('offline'),{code:'ECONNREFUSED'})));return socket;}};";
 await fs.writeFile(script,source.replace("import net from 'node:net';",offline));
 const home=path.join(root,'runtime/harness-home'),directory=path.join(home,'sessions','synthetic-project',id),cache=path.join(home,'storages/session_projcache/sessions',`${id}.json`);
 await fs.mkdir(directory,{recursive:true});await fs.mkdir(path.dirname(cache),{recursive:true});
 const header={type:'session',version:4,id,cwd:path.join(root,'runtime/fixture-project')};
 const log=path.join(directory,'session.v4.jsonl.zstd');
 const bytes=Buffer.concat([zstdCompressSync(Buffer.from(JSON.stringify(header)+'\n')),zstdCompressSync(Buffer.from(JSON.stringify({type:'session/title',title:'回看验收 C · 折叠步骤'})+'\n'))]);
 await fs.writeFile(log,bytes);await fs.writeFile(cache,'{"synthetic":true}');await fs.writeFile(path.join(directory,'session.lock'),'');
 return {root,log,cache,bytes,run:(...args)=>execute(process.execPath,[script,...args]),quarantine:path.join(root,'verification/qa2/source-quarantine')};
}
test('fixed fixture quarantine and restore preserve exact log/cache bytes and keep the lock',async t=>{
 const f=await fixture(t),status=JSON.parse((await f.run('status')).stdout);assert.equal(status.mutated,false);
 await f.run('quarantine','--server-stopped');await assert.rejects(fs.stat(f.log),{code:'ENOENT'});
 assert.deepEqual(await fs.readFile(path.join(f.quarantine,'fixture-c-session.v4.jsonl.zstd')),f.bytes);
 assert.equal((await fs.stat(path.join(path.dirname(f.log),'session.lock'))).isFile(),true);
 await f.run('quarantine','--server-stopped');await f.run('restore','--server-stopped');
 assert.deepEqual(await fs.readFile(f.log),f.bytes);assert.equal(await fs.readFile(f.cache,'utf8'),'{"synthetic":true}');
 assert.equal((await fs.readFile(path.join(f.quarantine,'journal.jsonl'),'utf8')).trim().split('\n').length,3);
});
test('mutation requires explicit stopped-server flag and restore refuses changed quarantine bytes',async t=>{
 const f=await fixture(t);await assert.rejects(f.run('quarantine'),/Explicit --server-stopped/);
 assert.deepEqual(await fs.readFile(f.log),f.bytes);await f.run('quarantine','--server-stopped');
 await fs.appendFile(path.join(f.quarantine,'fixture-c-session.v4.jsonl.zstd'),'changed');
 await assert.rejects(f.run('restore','--server-stopped'),/Quarantined fixture changed/);
 await assert.rejects(fs.stat(f.log),{code:'ENOENT'});
});
test('restore refuses an occupied destination and never overwrites it',async t=>{
 const f=await fixture(t);await f.run('quarantine','--server-stopped');await fs.writeFile(f.log,'new source');
 await assert.rejects(f.run('restore','--server-stopped'),/Original fixture changed/);
 assert.equal(await fs.readFile(f.log,'utf8'),'new source');assert.deepEqual(await fs.readFile(path.join(f.quarantine,'fixture-c-session.v4.jsonl.zstd')),f.bytes);
});
test('a new run snapshots a restored fixture with appended runtime records without changing old evidence',async t=>{
 const f=await fixture(t);await f.run('quarantine','--server-stopped');await f.run('restore','--server-stopped');
 const oldManifest=await fs.readFile(path.join(f.quarantine,'manifest.json')),oldJournal=await fs.readFile(path.join(f.quarantine,'journal.jsonl'));
 const appended=zstdCompressSync(Buffer.from(JSON.stringify({type:'session/end-seed',seq:14})+'\n'));
 await fs.appendFile(f.log,appended);await fs.writeFile(f.cache,'{"synthetic":true,"refreshed":true}');
 const current=await fs.readFile(f.log),status=JSON.parse((await f.run('status')).stdout);
 assert.equal(status.files[0].sourceMatchesSnapshot,false);
 await assert.rejects(f.run('quarantine','--server-stopped'),/new --run label/);
 await f.run('quarantine','--server-stopped','--run','pinned-source');
 assert.deepEqual(await fs.readFile(path.join(f.quarantine,'pinned-source/fixture-c-session.v4.jsonl.zstd')),current);
 await f.run('restore','--server-stopped','--run','pinned-source');
 assert.deepEqual(await fs.readFile(f.log),current);
 assert.deepEqual(await fs.readFile(path.join(f.quarantine,'manifest.json')),oldManifest);
 assert.deepEqual(await fs.readFile(path.join(f.quarantine,'journal.jsonl')),oldJournal);
});
test('a new run requires all prior runs restored even if a replacement original file appears',async t=>{
 const f=await fixture(t);await f.run('quarantine','--server-stopped');
 await assert.rejects(f.run('quarantine','--server-stopped','--run','second'),/previous run is not restored/);
 await fs.writeFile(f.log,f.bytes);await fs.writeFile(f.cache,'{"synthetic":true}');
 await assert.rejects(f.run('quarantine','--server-stopped','--run','second'),/previous run is not restored/);
 await assert.rejects(fs.stat(path.join(f.quarantine,'second')),{code:'ENOENT'});
 assert.deepEqual(await fs.readFile(path.join(f.quarantine,'fixture-c-session.v4.jsonl.zstd')),f.bytes);
});
test('a new run revalidates the fixed fixture header and rejects path labels',async t=>{
 const f=await fixture(t);await f.run('quarantine','--server-stopped');await f.run('restore','--server-stopped');
 const wrongHeader={type:'session',version:4,id,cwd:'/some-other-project'};
 await fs.writeFile(f.log,zstdCompressSync(Buffer.from(JSON.stringify(wrongHeader)+'\n'+JSON.stringify({title:'回看验收 C · 折叠步骤'})+'\n')));
 await assert.rejects(f.run('quarantine','--server-stopped','--run','second'),/not the fixed synthetic fixture/);
 await assert.rejects(f.run('quarantine','--server-stopped','--run','../outside'),/lowercase letters/);
 await assert.rejects(fs.stat(path.join(f.quarantine,'second')),{code:'ENOENT'});
});
