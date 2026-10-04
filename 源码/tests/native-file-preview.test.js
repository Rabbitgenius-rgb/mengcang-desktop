'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const zlib=require('node:zlib');
const run=promisify(execFile);
const {createNativePreview,decodeAttachment,MAX_FILE_BYTES}=require('../desktop/native-file-preview.cjs');
const doc=Buffer.from('d0cf11e0a1b11ae10000000000000000','hex');
const heic=Buffer.from('00000018667479706865696300000000686569636d696631','hex');
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
const attachment=(name,bytes)=>({name,size:bytes.length,dataUrl:`data:application/octet-stream;base64,${bytes.toString('base64')}`});

test('native previews accept only validated DOC/HEIF bytes and reject malformed, mismatched or oversized data',()=>{
  assert.equal(decodeAttachment(attachment('test.doc',doc)).extension,'.doc');
  assert.equal(decodeAttachment(attachment('test.HEIC',heic)).extension,'.heic');
  for(const value of [attachment('test.html',doc),attachment('test.doc',heic),attachment('test.heic',doc),{...attachment('test.doc',doc),size:999},{name:'test.doc',dataUrl:'data:application/msword;base64,not_base64'},{name:'test.doc',dataUrl:`data:application/msword;base64,${'A'.repeat(Math.ceil(MAX_FILE_BYTES/3)*4+201)}`}]) assert.throws(()=>decodeAttachment(value));
});

test('unsupported platforms reject without running a converter',async()=>{
  let calls=0;const preview=createNativePreview({platform:'linux',run:async()=>{calls++;}});
  await assert.rejects(preview(attachment('test.doc',doc)),{code:'UNSUPPORTED_PLATFORM'});assert.equal(calls,0);
});

test('DOC conversion uses fixed offline textutil options, literal filenames, bounded output and cleans temporary files',async()=>{
  const tmpRoot=await fs.mkdtemp(path.join(os.tmpdir(),'mc-native-test-'));
  let runs=0;
  try {
    const preview=createNativePreview({platform:'darwin',tmpRoot,run:async(binary,args,options)=>{runs++;assert.equal(binary,'/usr/bin/textutil');assert.ok(args.includes('-noload'));assert.ok(args.includes('-nostore'));assert.equal(args.at(-2),'--');assert.equal(path.basename(args.at(-1)),'source.doc');assert.equal(options.timeout,12000);assert.ok(options.maxBuffer<=2*1024*1024);assert.deepEqual(await fs.readFile(args.at(-1)),doc);return {stdout:'第一段\r\n第二段'};}});
    assert.deepEqual(await preview(attachment('$(malicious).doc',doc)),{kind:'text',body:'第一段\n第二段',truncated:false,warnings:[]});assert.equal(runs,1);assert.deepEqual(await fs.readdir(tmpRoot),[]);
  } finally {await fs.rm(tmpRoot,{recursive:true,force:true});}
});

test('failed native conversions preserve originals and clear private temporary files',async()=>{
  const tmpRoot=await fs.mkdtemp(path.join(os.tmpdir(),'mc-native-failure-'));
  const original=attachment('test.doc',doc),before=structuredClone(original);
  try {
    const preview=createNativePreview({platform:'darwin',tmpRoot,run:async()=>{throw Object.assign(new Error('converter details must not leak'),{killed:true});}});
    await assert.rejects(preview(original),error=>error.code==='FILE_PREVIEW_FAILED' && /超时/.test(error.message) && !error.message.includes('converter details'));
    assert.deepEqual(original,before);assert.deepEqual(await fs.readdir(tmpRoot),[]);
  } finally {await fs.rm(tmpRoot,{recursive:true,force:true});}
});

test('HEIF conversion checks pixel dimensions before resizing and returns a PNG preview',async()=>{
  const tmpRoot=await fs.mkdtemp(path.join(os.tmpdir(),'mc-image-test-'));let calls=0;
  try {
    const preview=createNativePreview({platform:'darwin',tmpRoot,run:async(binary,args)=>{calls++;assert.equal(binary,'/usr/bin/sips');if(args[0]==='-g')return {stdout:'pixelWidth: 2400\npixelHeight: 1800'};assert.deepEqual(args.slice(0,4),['-Z','1600','-s','format']);await fs.writeFile(args.at(-1),png);return {stdout:''};}});
    const result=await preview(attachment('original.heif',heic));assert.equal(result.kind,'image');assert.equal(result.dataUrl,`data:image/png;base64,${png.toString('base64')}`);assert.match(result.warnings.join(' '),/1600/);assert.equal(calls,2);assert.deepEqual(await fs.readdir(tmpRoot),[]);
    calls=0;const huge=createNativePreview({platform:'darwin',tmpRoot,run:async()=>{calls++;return {stdout:'pixelWidth: 10000\npixelHeight: 10000'};}});
    await assert.rejects(huge(attachment('huge.heif',heic)),{code:'IMAGE_TOO_LARGE'});assert.equal(calls,1);assert.deepEqual(await fs.readdir(tmpRoot),[]);
  } finally {await fs.rm(tmpRoot,{recursive:true,force:true});}
});

test('macOS real textutil DOC fixture roundtrips Unicode content offline',{skip:process.platform!=='darwin'},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mc-word-fixture-'));
  try {
    const input=path.join(directory,'fixture.txt'),output=path.join(directory,'fixture.doc');
    await fs.writeFile(input,'梦藏测试文档\n第二段保持可读。','utf8');
    await run('/usr/bin/textutil',['-convert','doc','-output',output,input],{timeout:10000,maxBuffer:65536});
    const original=await fs.readFile(output);const result=await createNativePreview()(attachment('fixture.doc',original));
    assert.equal(result.kind,'text');assert.match(result.body,/梦藏测试文档/);assert.match(result.body,/第二段保持可读/);assert.deepEqual(await fs.readFile(output),original);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('macOS real HEIC fixture converts to a valid PNG without changing the original',{skip:process.platform!=='darwin'},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mc-heic-fixture-'));
  const chunk=(type,data)=>{const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of content){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const header=Buffer.alloc(4),trailer=Buffer.alloc(4);header.writeUInt32BE(data.length);trailer.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,content,trailer]);};
  try {
    const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=6;
    const pixels=Buffer.alloc(64*(1+64*4));for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=y*(1+64*4)+1+x*4;pixels[i]=120;pixels[i+1]=180;pixels[i+2]=140;pixels[i+3]=255;}
    const input=path.join(directory,'fixture.png'),output=path.join(directory,'fixture.heic');
    await fs.writeFile(input,Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
    await run('/usr/bin/sips',['-s','format','heic',input,'--out',output],{timeout:12000,maxBuffer:65536});
    const original=await fs.readFile(output),result=await createNativePreview()(attachment('fixture.heic',original));
    assert.equal(result.kind,'image');assert.match(result.dataUrl,/^data:image\/png;base64,iVBORw0KGgo/);assert.deepEqual(await fs.readFile(output),original);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
