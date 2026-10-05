import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attachmentAccept,attachmentBytes,attachmentKind,fileTypeFor,extractDocxPlainText,inspectDocxPreviewArchive,validateDocxPreviewExpansion,MAX_WORD_PREVIEW_BYTES} from '../src/sublime/attachmentPreview.js';
const require=createRequire(import.meta.url),JSZip=require('jszip');

async function wordFixture({compression='DEFLATE',streamFiles=false}={}){
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>原文 &amp; source &lt;script&gt;</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({type:'arraybuffer',compression,streamFiles});
}

test('attachment format choices include supported Office, HEIC, video and audio without inferring forbidden MIME',()=>{
  for(const [name,kind] of [['x.doc','word'],['x.docx','word'],['x.heic','heic'],['x.heif','heic'],['x.mp4','video'],['x.mov','video'],['x.mp3','audio'],['x.wav','audio'],['x.flac','audio']])assert.equal(fileTypeFor({name,type:''})?.kind,kind,name);
  assert.equal(fileTypeFor({name:'x.doc',type:'text/html'}),null);
  assert.equal(fileTypeFor({name:'x.svg',type:'image/svg+xml'}),null);
  assert.ok(attachmentAccept().includes('.docx'));
  assert.ok(attachmentAccept().includes('.heic'));
});

test('preview decoding retains every original byte and validates original signature and size',()=>{
  const bytes=Buffer.from('%PDF-1.7\nOriginal source\n%%EOF');
  const attachment={name:'original.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};
  assert.deepEqual(Buffer.from(attachmentBytes(attachment)),bytes);
  assert.equal(attachmentKind(attachment),'pdf');
  assert.throws(()=>attachmentBytes({...attachment,size:attachment.size+1}));
  const html=Buffer.from('<script>execute()</script>');
  assert.throws(()=>attachmentBytes({...attachment,size:html.length,dataUrl:`data:application/pdf;base64,${html.toString('base64')}`}));
});

test('real DOCX extraction returns readable plaintext with original Unicode, line breaks and literal markup',async()=>{
  const buffer=await wordFixture(),result=await extractDocxPlainText(buffer);
  assert.equal(result.text,'原文 & source <script>\n\n第二段\n\n');
  assert.equal(result.truncated,false);
  assert.ok(Array.isArray(result.warnings));
});

test('oversized DOCX expansion is rejected before extraction, while corrupt archives fail explicitly',async()=>{
  const buffer=await wordFixture(),view=new DataView(buffer),bytes=new Uint8Array(buffer);
  for(let offset=0;offset<bytes.length-46;offset++){if(view.getUint32(offset,true)!==0x02014b50)continue;const length=view.getUint16(offset+28,true),name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+length));if(name==='word/document.xml'){view.setUint32(offset+24,MAX_WORD_PREVIEW_BYTES+1,true);break;}}
  assert.throws(()=>inspectDocxPreviewArchive(buffer),/过大/);
  assert.throws(()=>inspectDocxPreviewArchive(new ArrayBuffer(10)),/无效|不受支持/);
});

function wordDirectoryEntry(buffer){
  const view=new DataView(buffer),bytes=new Uint8Array(buffer);
  for(let offset=0;offset<bytes.length-46;offset++)if(view.getUint32(offset,true)===0x02014b50){
    const length=view.getUint16(offset+28,true),name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+length));
    if(name==='word/document.xml')return {view,offset};
  }
  throw Error('Synthetic document entry is missing');
}

test('actual DOCX expansion rejects forged short lengths before the document parser runs',async()=>{
  const buffer=await wordFixture(),{view,offset}=wordDirectoryEntry(buffer);
  view.setUint32(offset+24,1,true);
  assert.doesNotThrow(()=>inspectDocxPreviewArchive(buffer),'metadata alone cannot enforce expansion limits');
  await assert.rejects(validateDocxPreviewExpansion(buffer),/实际解压大小超过声明/);
  await assert.rejects(extractDocxPlainText(buffer),/实际解压大小超过声明/);
});

test('DOCX preflight supports stored and descriptor entries and rejects forged offsets, methods and lengths',async()=>{
  for(const compression of ['STORE','DEFLATE'])for(const streamFiles of [false,true]){
    const buffer=await wordFixture({compression,streamFiles});
    assert.deepEqual(await validateDocxPreviewExpansion(buffer),inspectDocxPreviewArchive(buffer));
    assert.equal((await extractDocxPlainText(buffer)).text,'原文 & source <script>\n\n第二段\n\n');
  }
  for(const field of ['offset','method','length']){
    const buffer=await wordFixture(),{view,offset}=wordDirectoryEntry(buffer);
    if(field==='offset')view.setUint32(offset+42,buffer.byteLength,true);
    if(field==='method')view.setUint16(offset+10,99,true);
    if(field==='length')view.setUint32(offset+24,view.getUint32(offset+24,true)+1,true);
    await assert.rejects(validateDocxPreviewExpansion(buffer),/不完整|压缩格式|实际解压大小/);
  }
});

test('an environment without streaming raw-deflate support fails closed while the original archive stays intact',async()=>{
  const original=globalThis.DecompressionStream,buffer=await wordFixture(),before=Buffer.from(buffer).toString('base64');
  try{
    globalThis.DecompressionStream=class {constructor(){throw Error('Synthetic unsupported runtime');}};
    await assert.rejects(validateDocxPreviewExpansion(buffer),/不支持安全解压/);
    assert.equal(Buffer.from(buffer).toString('base64'),before);
  }finally{globalThis.DecompressionStream=original;}
});

test('DOCX directory boundaries must exactly match the entries the downstream ZIP reader will see',async()=>{
  for(const change of ['count','length','comment']){
    const buffer=await wordFixture(),view=new DataView(buffer);let end=-1;
    for(let offset=buffer.byteLength-22;offset>=0;offset--)if(view.getUint32(offset,true)===0x06054b50){end=offset;break;}
    assert.ok(end>=0);
    if(change==='count'){const fewer=view.getUint16(end+10,true)-1;view.setUint16(end+8,fewer,true);view.setUint16(end+10,fewer,true);}
    if(change==='length')view.setUint32(end+12,view.getUint32(end+12,true)-1,true);
    if(change==='comment')view.setUint16(end+20,1,true);
    await assert.rejects(validateDocxPreviewExpansion(buffer),/目录项数量|压缩格式|不完整/);
  }
});

test('early expansion rejection cancels its reader and releases the stream lock',async()=>{
  const original=globalThis.DecompressionStream,buffer=await wordFixture();let cancelled=0,released=0;
  try{
    globalThis.DecompressionStream=class {
      constructor(){
        this.readable=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10000));},cancel(){cancelled++;}});
        const getReader=this.readable.getReader.bind(this.readable);
        this.readable.getReader=(...args)=>{const reader=getReader(...args),release=reader.releaseLock.bind(reader);reader.releaseLock=()=>{released++;release();};return reader;};
        this.writable=new WritableStream({write(){}});
      }
    };
    await assert.rejects(validateDocxPreviewExpansion(buffer),/实际解压大小超过声明/);
    assert.equal(cancelled,1);assert.equal(released,1);
  }finally{globalThis.DecompressionStream=original;}
});

test('the Word worker validates actual expansion before invoking its statically imported parser',async()=>{
  const mammoth=require('mammoth/mammoth.browser.js'),originalExtract=mammoth.extractRawText;
  const originalSelf=Object.getOwnPropertyDescriptor(globalThis,'self'),messages=[];let parserCalls=0;
  try{
    mammoth.extractRawText=(...args)=>{parserCalls++;return originalExtract(...args);};
    globalThis.self={postMessage(message){messages.push(message);}};
    await import('../src/sublime/attachmentWord.worker.js');
    const forged=await wordFixture(),{view,offset}=wordDirectoryEntry(forged);
    view.setUint32(offset+24,1,true);
    await globalThis.self.onmessage({data:forged});
    assert.equal(parserCalls,0);assert.equal(messages[0].ok,false);assert.match(messages[0].error,/实际解压大小超过声明/);
    await globalThis.self.onmessage({data:await wordFixture()});
    assert.equal(parserCalls,1);assert.equal(messages[1].ok,true);assert.equal(messages[1].value.text,'原文 & source <script>\n\n第二段\n\n');
  }finally{
    mammoth.extractRawText=originalExtract;
    if(originalSelf)Object.defineProperty(globalThis,'self',originalSelf);else delete globalThis.self;
  }
});
