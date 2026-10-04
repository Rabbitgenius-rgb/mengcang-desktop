'use strict';
// Native, offline preview only. Never launches Office, executes macros, or uses AI.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const runFile = promisify(execFile);
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DATA_LENGTH = Math.ceil(MAX_FILE_BYTES / 3) * 4;
const fail=(message,code='FILE_PREVIEW_FAILED')=>Object.assign(new Error(message),{code});

function decodeAttachment(value) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.dataUrl !== 'string') throw fail('附件数据无效，原文件仍可下载。','INVALID_ATTACHMENT');
  const extension=path.extname(value.name).toLowerCase();
  if (!['.doc','.heic','.heif'].includes(extension)) throw fail('此入口只预览 DOC、HEIC 和 HEIF；原文件仍可下载。','UNSUPPORTED_FORMAT');
  if (value.dataUrl.length > MAX_DATA_LENGTH + 200) throw fail('附件超过 64 MiB 预览上限，原文件仍可下载。','FILE_TOO_LARGE');
  const match=/^data:([^;,]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.dataUrl);
  if (!match || match[2].length % 4 !== 0) throw fail('附件编码无效，原文件仍可下载。','INVALID_ATTACHMENT');
  const bytes=Buffer.from(match[2],'base64');
  if (!bytes.length || bytes.length>MAX_FILE_BYTES || value.size !== undefined && value.size !== bytes.length || bytes.toString('base64')!==match[2]) throw fail('附件长度与原文件不一致，原文件仍可下载。','INVALID_ATTACHMENT');
  if (extension==='.doc') {
    if (bytes.length<8 || bytes.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1') throw fail('文件不是受支持的旧版 Word DOC 格式，原文件仍可下载。','INVALID_FORMAT');
  } else {
    const brand=bytes.subarray(8,Math.min(64,bytes.length)).toString('ascii');
    if (bytes.length<16 || bytes.subarray(4,8).toString('ascii')!=='ftyp' || !/(?:heic|heix|hevc|hevx|mif1|msf1)/.test(brand)) throw fail('文件不是受支持的 HEIC/HEIF 图像，原文件仍可下载。','INVALID_FORMAT');
  }
  return {bytes,extension};
}

function createNativePreview({platform=process.platform,run=runFile,tmpRoot=os.tmpdir()}={}) {
  return async function preview(value) {
    if (platform!=='darwin') throw fail('此预览需要 macOS 的本机转换工具，原文件仍可下载。','UNSUPPORTED_PLATFORM');
    const {bytes,extension}=decodeAttachment(value);
    const directory=await fs.mkdtemp(path.join(tmpRoot,'mengcang-preview-'));
    await fs.chmod(directory,0o700);
    try {
      const input=path.join(directory,`source${extension}`);
      await fs.writeFile(input,bytes,{mode:0o600});
      if (extension==='.doc') {
        const result=await run('/usr/bin/textutil',['-format','doc','-convert','txt','-encoding','UTF-8','-noload','-nostore','-stdout','--',input],{timeout:12000,maxBuffer:2*1024*1024,encoding:'utf8',windowsHide:true});
        const text=String(result.stdout || '').replace(/\r\n?/g,'\n').trim();
        if (!text) throw fail('文档没有可读取的文字，可能为空或已加密；原文件仍可下载。','EMPTY_CONTENT');
        const truncated=text.length>50000;
        return {kind:'text',body:text.slice(0,50000),truncated,warnings:truncated?['预览截取前 50000 字；完整原文件可下载。']:[]};
      }
      const properties=await run('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight',input],{timeout:8000,maxBuffer:65536,encoding:'utf8',windowsHide:true});
      const width=Number(/pixelWidth:\s*(\d+)/.exec(properties.stdout)?.[1]),height=Number(/pixelHeight:\s*(\d+)/.exec(properties.stdout)?.[1]);
      if (!width || !height || width*height>40000000 || width>30000 || height>30000) throw fail('图像尺寸超出本机预览上限，原文件仍可下载。','IMAGE_TOO_LARGE');
      const output=path.join(directory,'preview.png');
      await run('/usr/bin/sips',['-Z','1600','-s','format','png',input,'--out',output],{timeout:12000,maxBuffer:65536,encoding:'utf8',windowsHide:true});
      const info=await fs.stat(output);
      if (info.size>10*1024*1024) throw fail('转换后的图像超过预览上限，原文件仍可下载。','FILE_TOO_LARGE');
      const png=await fs.readFile(output);
      if (png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw fail('未得到可用的图像预览，原文件仍可下载。','INVALID_PREVIEW');
      return {kind:'image',dataUrl:`data:image/png;base64,${png.toString('base64')}`,warnings:width>1600 || height>1600?['预览长边缩至 1600 像素，原文件保持原尺寸。']:[]};
    } catch(error) {
      if (error.code && ['FILE_PREVIEW_FAILED','EMPTY_CONTENT','IMAGE_TOO_LARGE','FILE_TOO_LARGE','INVALID_PREVIEW'].includes(error.code)) throw error;
      throw fail(error.killed?'本机转换超时，原文件仍可下载。':'本机无法预览此附件，可能格式损坏、已加密或系统不支持；原文件仍可下载。');
    } finally {await fs.rm(directory,{recursive:true,force:true});}
  };
}
module.exports={previewNativeAttachment:createNativePreview(),createNativePreview,decodeAttachment,MAX_FILE_BYTES};
