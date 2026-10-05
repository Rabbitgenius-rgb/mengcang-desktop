import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as podcast from '../src/sublime/podcastClips.js';
import * as transcription from '../src/sublime/podcastTranscription.js';
import * as model from '../src/sublime/workspaceModel.js';
import * as attachment from '../src/sublime/attachmentPreview.js';
import {captureAiSource} from '../src/sublime/intelligenceDrafts.js';
import {fingerprintWorkspaceAttachment} from '../src/sublime/attachmentFingerprint.js';
import {createHash} from 'node:crypto';
const compiled=(await transform(await readFile(new URL('../src/sublime/PodcastClips.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
// Small signature fixtures only: no real audio decoding, engines or services.
const synth=marker=>{const bytes=Buffer.alloc(48);bytes.write('RIFF',0);bytes.writeUInt32LE(40,4);bytes.write('WAVE',8);bytes[44]=marker;return {name:'same.wav',type:'audio/wav',size:bytes.length,dataUrl:`data:audio/wav;base64,${bytes.toString('base64')}`};};
const a=synth(1),b=synth(2);
const source=file=>({id:'audio-source',title:'节目',type:'audio',attachment:file});
const baseDraft={sourceId:'audio-source',attachment:null,start:'00:01',end:'00:02',transcript:'WEBVTT\n\n00:01.000 --> 00:02.000\n只属于原音频 A 的字幕',transcriptName:'A.srt',note:'保留我的备注'};
const hash=async file=>(await captureAiSource({id:'audio',type:'audio',title:'节目',attachment:file})).attachmentMeta.sha256;
const hashA=await hash(a),hashB=await hash(b);
const makeClip=(sha256=hashA)=>({...podcast.buildPodcastClip({sourceCard:source(a),sourceAudioSha256:sha256,start:1,end:2,cues:podcast.parseTimedTranscript(baseDraft.transcript),note:baseDraft.note}),id:'clip'});
const upsert=(state,card)=>model.workspaceReducer(state,{type:'card.upsert',card});
function find(node,predicate){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return null;}return predicate(node)?node:find(node.props?.children,predicate);}
const text=node=>node==null?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
function editor(props,{component='default',helpers={}}={}){
 const slots=[],blobs=[],revoked=[];let cursor=0,pending=[],changed=false,tree,latestHash;
 const checkedHelpers={...podcast,...helpers,podcastAudioSha256:file=>{latestHash=(helpers.podcastAudioSha256||podcast.podcastAudioSha256)(file);return latestHash;}};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:fn=>fn(),
  useRef:value=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},
  useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(value!==slots[index].value){slots[index].value=value;changed=true;}}];},
  useEffect:(effect,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((item,index)=>item!==previous.deps?.[index])){slots[index]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect();});}}
 };
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Error,TextEncoder,Number,Blob,crypto:globalThis.crypto,URL:{createObjectURL:blob=>{const url=`blob:synthetic-${blobs.length}`;blobs.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)},require:name=>name==='react'?react:name==='./podcastClips.js'?checkedHelpers:name==='./podcastTranscription.js'?transcription:name==='./workspaceModel.js'?model:name==='./attachmentPreview.js'?attachment:name==='@tabler/icons-react'?new Proxy({},{get:()=>()=>null}):name.endsWith('.css')?{}:(()=>{throw Error(`Unexpected import ${name}`);})()});
 function render(){let count=0;do{assert.ok(++count<10,'effects settle');changed=false;cursor=0;tree=module.exports[component](props);const effects=pending;pending=[];for(const effect of effects)effect();}while(changed);return tree;}
 return {render,props,blobs,revoked,get tree(){return tree;},ready:async()=>{render();for(;;){const request=latestHash;await request?.catch(()=>{});render();if(latestHash===request)return;}},label:name=>find(tree,node=>node.props?.['aria-label']===name),button:name=>find(tree,node=>node.type==='button'&&text(node)===name),dispose(){for(const slot of slots)slot?.cleanup?.();}};
}


test('new clip fingerprints survive normalization and backup merging without copying audio into every clip',()=>{
 const clip=makeClip();assert.equal(clip.sourceAudioSha256,hashA);assert.equal(clip.attachment,undefined);
 const backup=upsert(upsert(model.createWorkspaceState(),source(a)),clip),current=upsert(model.createWorkspaceState(),source(b));
 const restored=model.parseWorkspaceBackup(model.serializeWorkspace(backup));assert.equal(restored.cards.find(card=>card.id==='clip').sourceAudioSha256,hashA);
 const merged=model.mergeWorkspaceBackup(current,restored),saved=merged.cards.find(card=>card.id==='clip');assert.equal(saved.sourceAudioSha256,hashA);assert.equal(saved.body,'只属于原音频 A 的字幕');assert.equal(saved.attachment,null);assert.equal(merged.cards[0].attachment.dataUrl,b.dataUrl);
 assert.throws(()=>upsert(current,{...clip,sourceAudioSha256:'not-a-sha256'}),/音频.*指纹/);
 assert.equal(upsert(current,{...clip,sourceAudioSha256:hashA.toUpperCase()}).cards.find(card=>card.id==='clip').sourceAudioSha256,hashA);
 const legacy=makeClip('');assert.equal(legacy.sourceAudioSha256,undefined);
});

test('refreshed source audio blocks saving old subtitles until explicit review, preserving the draft and resetting playback metadata',async()=>{
 let saved,changed;const form=editor({cards:[source(a)],draft:{...baseDraft,sourceAudioSha256:hashA},onDraftChange:value=>changed=value,onSave:async value=>saved=value,onCancel:()=>{}});
 await form.ready();form.label('播客音频播放器').props.onLoadedMetadata({currentTarget:{duration:100}});form.render();
 form.props.cards=[source(b)];await form.ready();assert.ok(text(form.tree).includes('音频已变化'));assert.equal(form.label('片段开始时间').props.value,'00:01');assert.equal(form.label('片段结束时间').props.value,'00:02');assert.ok(text(form.tree).includes('只属于原音频 A 的字幕'));assert.equal(text(form.tree).includes('/ 01:40'),false);
 assert.equal(form.button('保存片段').props.disabled,true);await form.button('保存片段').props.onClick();assert.equal(saved,undefined);assert.equal(changed,undefined,'a passive source change must not rewrite the shared draft');
 await form.button('已核对当前音频，保留字幕与时间').props.onClick();await form.ready();assert.equal(form.button('保存片段').props.disabled,false);await form.button('保存片段').props.onClick();assert.equal(saved.sourceAudioSha256,hashB);assert.equal(saved.body,'只属于原音频 A 的字幕');assert.equal(saved.caption,baseDraft.note);assert.equal(saved.attachment,undefined);form.dispose();
});

test('new selections bind a compact fingerprint and an old unversioned draft requires an honest explicit review',async()=>{
 let changed;const fresh=editor({cards:[source(a)],onDraftChange:value=>changed=value,onCancel:()=>{}});await fresh.ready();fresh.label('资料库音频').props.onChange({target:{value:'audio-source'}});await fresh.ready();assert.equal(changed.sourceAudioSha256,'','passive hashing must not rewrite the shared draft');fresh.label('片段备注').props.onChange({target:{value:'Explicit new note'}});await fresh.ready();assert.equal(changed.sourceAudioSha256,hashA);assert.equal(changed.attachment,null);fresh.dispose();
 const old=editor({cards:[source(a)],draft:baseDraft,onCancel:()=>{}});await old.ready();assert.ok(text(old.tree).includes('旧草稿未记录音频版本'));assert.equal(old.button('保存片段').props.disabled,true);old.dispose();
});

for(const [file,expected] of [[a,'verified'],[b,'mismatch']])test(`saved playback checks fingerprint before creating playable media: ${expected}`,async()=>{
 const form=editor({attachment:file,sourceLocation:'音频片段 00:01–00:02',sourceAudioSha256:hashA},{component:'PodcastClipPlayback'});form.render();assert.equal(form.label('片段音频播放器'),null);await form.ready();
 if(expected==='verified'){assert.ok(form.label('片段音频播放器'));assert.equal(form.button('试听已保存片段').props.disabled,false);}
 else{assert.equal(form.label('片段音频播放器'),null);assert.equal(form.blobs.length,0);assert.ok(text(form.tree).includes('原音频已变化'));}
 form.dispose();
});

test('legacy saved clips stay manually playable with an unverified-version warning; no false historical hash is created',async()=>{
 const form=editor({attachment:b,sourceLocation:'音频片段 00:01–00:02'},{component:'PodcastClipPlayback'});await form.ready();assert.ok(form.label('片段音频播放器'));assert.ok(text(form.tree).includes('旧片段版本未核验'));assert.equal(form.button('试听当前来源音频（未核验）').props.disabled,false);form.dispose();
});

test('stale audio digests cannot enable playback after a source replacement',async()=>{
 let resolveFirst;const form=editor({attachment:a,sourceLocation:'音频片段 00:01–00:02',sourceAudioSha256:hashA},{component:'PodcastClipPlayback',helpers:{podcastAudioSha256:file=>file.dataUrl===a.dataUrl?new Promise(resolve=>resolveFirst=resolve):Promise.resolve(hashB)}});form.render();form.props.attachment=b;await form.ready();resolveFirst(hashA);await form.ready();assert.equal(form.label('片段音频播放器'),null);assert.equal(form.blobs.length,0);form.dispose();
});


test('an already verified player stops and revokes its old URL as soon as the referenced bytes change',async()=>{
 const form=editor({attachment:a,sourceLocation:'音频片段 00:01–00:02',sourceAudioSha256:hashA},{component:'PodcastClipPlayback'});await form.ready();let paused=0;form.label('片段音频播放器').props.ref.current={pause:()=>paused++};assert.equal(form.blobs.length,1);
 form.props.attachment=b;form.render();assert.equal(form.label('片段音频播放器'),null);assert.deepEqual(form.revoked,['blob:synthetic-0']);assert.ok(paused>0);await form.ready();assert.equal(form.label('片段音频播放器'),null);assert.equal(form.blobs.length,1);form.dispose();
});

test('renaming identical audio remains verified, missing audio preserves the saved range, and digest failure never plays',async()=>{
 const form=editor({attachment:{...a,name:'renamed.wav'},sourceLocation:'音频片段 00:01–00:02',sourceAudioSha256:hashA},{component:'PodcastClipPlayback'});await form.ready();assert.ok(form.label('片段音频播放器'));form.props.attachment=null;await form.ready();assert.equal(form.label('片段音频播放器'),null);assert.ok(text(form.tree).includes('时间标记和摘录已保留'));form.dispose();
 const broken=editor({attachment:a,sourceLocation:'音频片段 00:01–00:02',sourceAudioSha256:hashA},{component:'PodcastClipPlayback',helpers:{podcastAudioSha256:async()=>{throw Error('合成摘要失败');}}});await broken.ready();assert.equal(broken.label('片段音频播放器'),null);assert.equal(broken.blobs.length,0);assert.ok(text(broken.tree).includes('合成摘要失败'));broken.dispose();
});

test('losing a source while its initial fingerprint is pending does not silently bind old input to a replacement',async()=>{
 let releaseFirst,changed;const form=editor({cards:[source(a)],onDraftChange:value=>changed=value,onCancel:()=>{}},{helpers:{podcastAudioSha256:file=>file.dataUrl===a.dataUrl?new Promise(resolve=>releaseFirst=resolve):Promise.resolve(hashB)}});form.render();form.label('资料库音频').props.onChange({target:{value:'audio-source'}});form.render();
 form.label('片段开始时间').props.onChange({target:{value:'00:05'}});form.render();form.props.cards=[source(b)];await form.ready();releaseFirst(hashA);await form.ready();assert.equal(form.button('保存片段').props.disabled,true);assert.equal(form.label('片段开始时间').props.value,'00:05');assert.equal(changed.sourceAudioSha256,'');form.dispose();
});

test('automatic titles reserve space for the time range within the card title limit and preserve full source names',()=>{
 for(const title of ['长'.repeat(1000),'🎧'.repeat(500)]){
  const clip=podcast.buildPodcastClip({sourceCard:{...source(a),title},sourceAudioSha256:hashA,start:1,end:2});
  assert.ok(clip.title.length<=1000);assert.ok(clip.title.endsWith(' · 00:01–00:02'));assert.equal(clip.sourceTitle,title);assert.equal(clip.title.isWellFormed(),true);assert.doesNotThrow(()=>upsert(model.createWorkspaceState(),{...clip,id:'long-title-clip'}));
 }
});


test('the shared attachment digest preserves AI metadata and validates raw bytes instead of a supplied hash',async()=>{
 const result=await fingerprintWorkspaceAttachment({...a,sha256:'0'.repeat(64)}),captured=await captureAiSource({id:'audio',attachment:a,type:'audio'});
 assert.deepEqual(result,captured.attachmentMeta);assert.equal(result.sha256,createHash('sha256').update(attachment.attachmentBytes(a)).digest('hex'));assert.equal(JSON.stringify(result).includes('base64'),false);
 await assert.rejects(fingerprintWorkspaceAttachment({...a,size:a.size+1}),/字节数与内容不匹配/);
 const helperCode=(await transform(await readFile(new URL('../src/sublime/attachmentFingerprint.js',import.meta.url),'utf8'),{format:'cjs'})).code,module={exports:{}};
 vm.runInNewContext(helperCode,{module,exports:module.exports,Error,require:name=>name==='./workspaceModel.js'?model:(()=>{throw Error(name);})()});
 await assert.rejects(module.exports.fingerprintWorkspaceAttachment(a),/当前环境无法核验原文件/);
});

test('an unavailable editor source cannot be saved and does not erase subtitle or time inputs',async()=>{
 let changed;const form=editor({cards:[source(a)],draft:{...baseDraft,sourceAudioSha256:hashA},onDraftChange:value=>changed=value,onCancel:()=>{}});await form.ready();form.props.cards=[];await form.ready();assert.equal(form.button('保存片段').props.disabled,true);assert.equal(form.label('播客音频播放器'),null);assert.equal(form.label('片段开始时间').props.value,baseDraft.start);assert.ok(text(form.tree).includes('只属于原音频 A 的字幕'));assert.ok(text(form.tree).includes('来源音频已不可用'));assert.equal(changed,undefined);form.dispose();
});


for(const trigger of ['source-replaced','initial-hash'])test(`passive ${trigger} never rewrites a newer shared podcast draft`,async()=>{
 let state=model.normalizeWorkspaceState({drafts:{podcastClip:{...baseDraft,...(trigger==='source-replaced'?{sourceAudioSha256:hashA}:{})}}}),release;
 const draft=state.drafts.podcastClip;
 const form=editor({cards:[source(a)],draft,onDraftChange:value=>{state=model.workspaceReducer(state,{type:'draft.set',key:'podcastClip',value});},onCancel:()=>{}},{helpers:trigger==='initial-hash'?{podcastAudioSha256:()=>new Promise(resolve=>release=resolve)}:{}});
 if(trigger==='source-replaced')await form.ready();else form.render();
 const newer={...draft,sourceId:trigger==='initial-hash'?'other-source':draft.sourceId,note:'Newer window note',transcript:'WEBVTT\n\n00:03.000 --> 00:04.000\nNewer subtitles',start:'00:03',end:'00:04'};
 state=model.workspaceReducer(state,{type:'draft.set',key:'podcastClip',value:newer});
 if(trigger==='source-replaced')form.props.cards=[source(b)];else release(hashA);
 await form.ready();assert.deepEqual(state.drafts.podcastClip,newer);assert.equal(form.label('片段开始时间').props.value,'00:01');form.dispose();
});

test('saving after passive hashing compares the last actually submitted complete draft',async()=>{
 let submitted,context;const form=editor({cards:[source(a)],onDraftChange:value=>submitted=structuredClone(value),onSave:async(_value,value)=>context=value,onCancel:()=>{}});await form.ready();form.label('资料库音频').props.onChange({target:{value:'audio-source'}});await form.ready();
 assert.equal(submitted.sourceAudioSha256,'');await form.button('保存片段').props.onClick();assert.deepEqual(structuredClone(context.formSnapshot),submitted);form.dispose();
});


for(const action of ['transcribe','recover'])test(`own ${action} result updates the expected persisted draft before saving`,async()=>{
 let context;const restored={...baseDraft,sourceAudioSha256:hashA,transcript:'WEBVTT\n\n00:01.000 --> 00:02.000\nAccepted own result',transcriptName:'Own result',transcriptionRequestId:'own-request',transcriptionPhase:'complete'};
 const form=editor({cards:[source(a)],draft:{...baseDraft,sourceAudioSha256:hashA},transcribeAudio:async()=>({text:restored.transcript,draft:restored}),transcriptionDrafts:[{id:'own-request',phase:'complete',sourceSnapshot:{title:'Synthetic audio'},transcript:restored.transcript}],onRecoverTranscription:async()=>restored,onSave:async(_value,next)=>context=next,onCancel:()=>{}});
 await form.ready();await form.button(action==='transcribe'?'调用 API 转录（需确认）':'核对原音频并恢复字幕').props.onClick();await form.ready();await form.button('保存片段').props.onClick();assert.deepEqual(structuredClone(context.formSnapshot),restored);form.dispose();
});
