import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import * as attachments from '../src/sublime/attachmentStore.js';
import * as model from '../src/sublime/workspaceModel.js';
import * as view from '../src/sublime/workspaceView.js';
import * as discovery from '../src/discoveryModel.js';
import * as external from '../src/sublime/externalContext.js';
import * as publishable from '../src/sublime/publishableCollection.js';
import * as desktop from '../src/desktopModel.js';
const require=createRequire(import.meta.url);
const compile=async name=>(await transform(await readFile(new URL('../src/sublime/workspace/'+name,import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const [actionsCode,dialogCode]=await Promise.all([compile('useShareExport.jsx'),compile('renderNewBoardDialogs.jsx')]);
function load(code,files,downloads){
 const module={exports:{}};
 const modules={
  '../attachmentStore.js':attachments,
  '.././workspaceModel.js':model,
  '../workspaceModel.js':model,
  '.././SublimeEditors.jsx':{},
  '../../discoveryModel.js':discovery,
  '.././workspaceView.js':view,
  '../workspaceView.js':view,
  '.././externalContext.js':external,
  '.././publishableCollection.js':publishable,
  '../../desktopModel.js':desktop,
  './constants.js':{uid:()=> 'isolated',attachmentFiles:files,download:(text,name,type)=>downloads.push({text,name,type})},
 };
 vm.runInNewContext(code,{module,exports:module.exports,URL,Error,location:{href:'https://isolated.test/',origin:'https://isolated.test'},require:name=>name==='react'?require('react'):Object.hasOwn(modules,name)?modules[name]:(()=>{throw Error('Unexpected export dependency '+name);})()});
 return module.exports;
}
function find(node,predicate){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const match=find(child,predicate);if(match)return match;}return null;}return predicate(node)?node:find(node.props?.children,predicate);}
for(const kind of ['audio','pdf'])test(`v3 ${kind} offline card embeds its original bytes and text collection preserves the attachment notice`,async()=>{
 const files=attachments.createAttachmentStore({indexedDB:new IDBFactory()});
 try{
  const bytes=Buffer.from(kind==='audio'?'RIFF\0\0\0\0WAVEsynthetic':'%PDF-1.7\nsynthetic document\n%%EOF'),type=kind==='audio'?'audio/wav':'application/pdf';
  const dataUrl=`data:${type};base64,${bytes.toString('base64')}`,ref=await files.put({type,size:bytes.length,dataUrl});
  const url=await files.url(ref),card={id:'isolated-'+kind,type:kind==='audio'?'audio':'file',title:'合成导出资料',body:'Original text',attachment:{name:kind==='audio'?'original.wav':'original.pdf',type,size:bytes.length,dataUrl:url}};
  const downloads=[],issues=[];let modal={type:'share',card,includeAttachment:true,includeNote:false};
  const exported=load(actionsCode,files,downloads),actions=exported.useShareExport({epoch:{current:1},modal,setSaving(){},session:{writing:0},setError:value=>issues.push(value),setModal:updater=>{modal=updater(modal);},notify(){}});
  await actions.exportShare();
  assert.deepEqual(issues,[]);assert.equal(downloads.length,1);assert.equal(downloads[0].type,'text/html');assert.ok(downloads[0].text.includes(dataUrl));assert.equal(card.attachment.dataUrl,url);
  modal={type:'export',format:'markdown',cards:[card],text:'Original preview',count:1};
  const rendered=load(dialogCode,files,downloads).renderNewBoardDialogs({modal,exportText:actions.exportText,setModal:updater=>{modal=updater(modal);},setError:value=>issues.push(value)});
  await find(rendered,node=>node.props?.['aria-label']==='导出格式').props.onChange({target:{value:'html'}});
  assert.deepEqual(issues,[]);assert.equal(modal.format,'html');assert.equal(modal.text.includes(dataUrl),false);assert.ok(modal.text.includes('原文件未包含在此合集页面中'));assert.equal(card.attachment.dataUrl,url);
 }finally{await files.dispose();}
});
