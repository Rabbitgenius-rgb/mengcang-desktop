import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attachmentAccept,attachmentBytes,attachmentKind,fileTypeFor,extractDocxPlainText,inspectDocxPreviewArchive,MAX_WORD_PREVIEW_BYTES} from '../src/sublime/attachmentPreview.js';
const require=createRequire(import.meta.url),JSZip=require('jszip');

async function wordFixture(){
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>原文 &amp; source &lt;script&gt;</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
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
