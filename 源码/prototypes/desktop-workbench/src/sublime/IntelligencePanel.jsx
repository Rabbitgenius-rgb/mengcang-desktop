import React,{useEffect,useRef,useState} from 'react';
import {valueOf} from '../desktopModel.js';
import {INSIGHT_LABELS,IMAGE_INSIGHT_MODES,intelligenceText,rankEmbeddings,extractDataPayload,isImageReference,visionImagePayload,sameImageReference,formatImageBytes} from './intelligenceHelpers.js';
import {DEEPSEEK_PRESET,isDeepSeekEndpoint} from './deepseekSettings.js';
import {captureAiSource,normalizeAiRecord,MAX_OCR_TEXT} from './intelligenceDrafts.js';
import './intelligencePanel.css';

const titleFor=mode=>INSIGHT_LABELS[mode]||({Settings:'AI 连接与用量',Insights:'AI 解读','Semantic search':'语义搜索',Related:'关联想法',Discover:'灵感发现',OCR:'图片与扫描 PDF 文字识别',Classification:'分类建议'}[mode]||mode);
export default function IntelligencePanel({mode='Settings',card,cards=[],collections=[],api,onSaveInsight,onApplyClassification,onSaveOcr,onOpen,resultDrafts=[],onResultDraft,isResultDurable,requestIsActive,registerRequest}){
 const [active,setActive]=useState(mode==='Insights'?'The Gist':mode),[selectedId,setSelectedId]=useState(card?.id||cards[0]?.id||'');
 const [status,setStatus]=useState(null),[settings,setSettings]=useState(null),[key,setKey]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[query,setQuery]=useState(''),[models,setModels]=useState([]),[acceptedTags,setAcceptedTags]=useState([]),[acceptedCollections,setAcceptedCollections]=useState([]);
 const [imageState,setImageState]=useState(null);
 const [localDrafts,setLocalDrafts]=useState([]),[draftId,setDraftId]=useState(''),[resultRecord,setResultRecord]=useState(null),[storedPhases,setStoredPhases]=useState(()=>new Set());
 const sourceSnapshots=useRef(new Map()),savedReceipts=useRef(new Map());
 const live=useRef(true),busyLock=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const chosen=selectedId?(cards.find(x=>x.id===selectedId)||(card?.id===selectedId?card:null)):null;
 const generationMode=!!INSIGHT_LABELS[active]||active==='Classification',imageReference=isImageReference(chosen);
 const trackedMode=generationMode||active==='OCR';
 const draftMap=new Map();
 for(const record of [...resultDrafts,...localDrafts]){
  const previous=draftMap.get(record.id);
  const usePrevious=previous&&(previous.updatedAt>record.updatedAt||(previous.phase!=='pending'&&record.phase==='pending'));
  const latest=usePrevious?previous:record;
  draftMap.set(record.id,{...latest,savedCardId:previous?.savedCardId||record.savedCardId||''});
 }
 const modeDrafts=[...draftMap.values()].filter(record=>record.mode===active).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.createdAt.localeCompare(a.createdAt));
 const matchingDrafts=modeDrafts.filter(record=>record.sourceSnapshot?.id===chosen?.id);
 const pendingActive=matchingDrafts.some(record=>record.phase==='pending'&&requestIsActive?.(record.id));
 const draftSignature=modeDrafts.map(record=>`${record.id}:${record.phase}:${record.updatedAt}:${record.savedCardId}`).join('|');
 const resultDurable=!!resultRecord&&(isResultDurable?isResultDurable(resultRecord.id,resultRecord.phase):storedPhases.has(`${resultRecord.id}:${resultRecord.phase}`)||resultDrafts.some(record=>record.id===resultRecord.id&&record.phase===resultRecord.phase));
 function showDraft(record){
  if(!live.current)return;
  const contentChanged=resultRecord?.id!==record?.id||resultRecord?.phase!==record?.phase||JSON.stringify(resultRecord?.result)!==JSON.stringify(record?.result);
  setResultRecord(record);setDraftId(record?.id||'');
  if(!contentChanged)return;
  if(record?.phase==='complete'){
   const restored={...record.result,sourceSnapshot:sourceSnapshots.current.get(record.id)||record.sourceSnapshot};
   setResult(restored);setAcceptedTags(restored.tags||[]);setAcceptedCollections(restored.collectionIds||[]);
  }else{setResult(null);setAcceptedTags([]);setAcceptedCollections([]);}
 }
 useEffect(()=>{
  if(!trackedMode)return;
  const selected=modeDrafts.find(record=>record.id===draftId)||matchingDrafts[0]||null;
  showDraft(selected);
 },[active,chosen?.id,draftId,draftSignature]);
 const currentImage=imageState?.mode===active&&sameImageReference(imageState.source,chosen)?imageState:null;
 useEffect(()=>{
  let cancelled=false;
  if(!generationMode||!imageReference){setImageState(null);return;}
  const source=chosen,selectedMode=active;
  setImageState({source,mode:selectedMode,loading:true});
  (async()=>{
   let attachment=source.attachment;
   if(source.origin==='vault'){
    if(!source.originalPath||!api?.readAttachment)throw Error('图片原文件暂不可读取，请先导入本机原文件。');
    attachment=valueOf(await api.readAttachment(source.path));
   }
   const image=visionImagePayload(attachment);
   if(!cancelled&&live.current)setImageState({source,mode:selectedMode,image,loading:false});
  })().catch(issue=>{if(!cancelled&&live.current)setImageState({source,mode:selectedMode,loading:false,issue:issue.message||'图片原文件读取失败'});});
  return()=>{cancelled=true;};
 },[api,active,generationMode,imageReference,chosen?.id,chosen?.path,chosen?.origin,chosen?.updatedAt,chosen?.originalPath,chosen?.originalMime,chosen?.type,chosen?.attachment?.name,chosen?.attachment?.type,chosen?.attachment?.size,chosen?.attachment?.dataUrl]);
 const savedSettings=status?.settings;
 const imageProviderIssue=savedSettings?.provider==='cli'?'当前 CLI 连接仅支持文字，图片解读请使用支持图片输入的 API。':savedSettings&&isDeepSeekEndpoint(savedSettings.endpoint)&&!['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(savedSettings.model)?'DeepSeek 图片解读需要 deepseek-flash；deepseek-v4-pro 仅支持文字，请在连接设置中切换并保存模型。':'';
 const available=!!api?.intelligenceStatus;
 const refresh=async()=>{if(!available)return;const v=valueOf(await api.intelligenceStatus());if(live.current){setStatus(v);setSettings(v.settings);}return v;};
 useEffect(()=>{refresh().catch(e=>{if(live.current)setError(e.message);});},[]);
 async function work(fn){if(busyLock.current)return;busyLock.current=true;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){if(live.current)setError(e.message||'操作未完成');}finally{if(live.current){await refresh().catch(()=>{});if(live.current)setBusy(false);}busyLock.current=false;}}
 async function request(input){return valueOf(await api.intelligenceRequest(input));}
 async function persistDraft(record){
  const normalized=normalizeAiRecord(record);
  if(live.current)setLocalDrafts(previous=>[...previous.filter(item=>item.id!==normalized.id),normalized]);
  await onResultDraft?.(normalized);
  if(live.current&&onResultDraft)setStoredPhases(previous=>new Set([...previous,`${normalized.id}:${normalized.phase}`]));
  return normalized;
 }
 async function trackedRequest(requestMode,sourceSnapshot,input){
  const now=new Date().toISOString(),id=crypto.randomUUID();
  const pending=normalizeAiRecord({id,mode:requestMode,phase:'pending',sourceSnapshot:await captureAiSource(sourceSnapshot),result:null,createdAt:now,updatedAt:now,savedCardId:'',error:''});
  sourceSnapshots.current.set(id,sourceSnapshot);
  await persistDraft(pending);
  if(live.current)showDraft(pending);
  registerRequest?.(id,true);
  try{
   let data,complete;
   try{
    data=await request(input);
    if(data?.cancelled){const cancelled=Error('本次调用已取消，未自动重试');cancelled.code='AI_CONFIRMATION_REQUIRED';throw cancelled;}
    if(data?.mode!==undefined&&data.mode!==requestMode){const invalid=Error('模型响应的解读方式与本次请求不一致，未自动重试');invalid.code='INVALID_RESPONSE';throw invalid;}
    const {mode:responseMode,...storedResult}=data;
    complete=normalizeAiRecord({...pending,phase:'complete',result:storedResult,updatedAt:new Date().toISOString()});
   }catch(issue){
    const cancelled=issue.code==='AI_CONFIRMATION_REQUIRED'||issue.code==='USER_CANCELLED'||issue.code==='CANCELLED';
    const recoveryText=typeof data?.text==='string'?data.text:requestMode==='Classification'&&data?JSON.stringify({tags:data.tags,collectionIds:data.collectionIds,reason:data.reason},null,2):'';
    const failed=normalizeAiRecord({...pending,phase:'failed',updatedAt:new Date().toISOString(),error:cancelled?'本次调用已取消，未自动重试':issue.message||'本次调用未完成，未自动重试',...(recoveryText?{recoveryText}:{})});
    if(live.current)showDraft(failed);
    await persistDraft(failed);
    throw issue;
   }
   if(live.current)showDraft(complete);
   try{await persistDraft(complete);}catch(issue){throw Error(`AI 已返回，结果草稿尚未保存，请先另存笔记。${issue.message||''}`);}
   return data;
  }finally{registerRequest?.(id,false);}
 }
 async function saveTextResult(){await work(async()=>{
  if(active==='OCR'){if(result.text.length>MAX_OCR_TEXT)throw Error('这份旧识别结果超过 100 万字符，请先复制保留，再拆分文件识别；原草稿不会被截断。');await onSaveOcr(result.sourceSnapshot,result,resultRecord);if(live.current)setMessage('文字已保存到本机卡片');return;}
  const record=resultRecord;
  if(record&&(record.savedCardId||savedReceipts.current.has(record.id))){if(live.current)setMessage('这份解读已保存，请查看已保存笔记');return;}
  const cardId=await onSaveInsight(result.sourceSnapshot,active,result,record);
  if(record){
   savedReceipts.current.set(record.id,cardId||'saved');
   if(cardId){const saved=normalizeAiRecord({...record,savedCardId:cardId,updatedAt:new Date().toISOString()});if(live.current)showDraft(saved);await persistDraft(saved);}
  }
  if(live.current)setMessage('解读已另存为笔记，原文保留');
 });}
 async function saveSettings(event){event.preventDefault();await work(async()=>{valueOf(await api.intelligenceConfigure(settings));if(key){valueOf(await api.intelligenceSetKey(key));setKey('');}setMessage('连接设置已保存；没有调用模型。');});}
 async function execute(){if(pendingActive)return;await work(async()=>{
  setResult(null);
  if(active==='OCR'){if(!chosen)throw Error('请先选择素材');const source=chosen.origin==='vault'&&chosen.originalPath&&api?.readAttachment?{...chosen,attachment:valueOf(await api.readAttachment(chosen.path))}:chosen;await trackedRequest(active,source,{action:'extract',...extractDataPayload(source)});return;}
  if(generationMode){
   if(!chosen)throw Error('请先选择素材');
   let image;
   if(imageReference){
    if(imageProviderIssue)throw Error(imageProviderIssue);
    if(!currentImage||currentImage.loading)throw Error('图片原文件正在准备，请等待预览显示后再调用。');
    if(currentImage.issue)throw Error(currentImage.issue);
    image=visionImagePayload(currentImage.image);
   }else if(IMAGE_INSIGHT_MODES.includes(active))throw Error('请先选择含本机原文件的图片素材，再使用图片解读。');
   const sourceSnapshot=image?{...chosen,attachment:image}:chosen,input={title:chosen.title,text:intelligenceText(chosen),...(image?{image}:{})};
   if(active==='Classification'){await trackedRequest(active,sourceSnapshot,{action:'classify',...input,collections:collections.map(({id,title})=>({id,title}))});return;}
   await trackedRequest(active,sourceSnapshot,{action:'insight',mode:active,...input});return;
  }
  const search=active==='Semantic search';if(search&&!query.trim())throw Error('请用一句话描述想找的内容');if(!search&&!chosen)throw Error('请先选择参考素材');
  const candidates=([...cards,...(!search&&chosen&&!cards.some(x=>x.id===chosen.id)?[chosen]:[])]).filter(x=>intelligenceText(x).trim());if(candidates.length>2000)throw Error('请先从收藏集选择不超过 2000 张卡片进行分析');
  const anchorId='query-'+crypto.randomUUID();let embeddings=[],missing=[];
  for(let start=0;start<candidates.length;start+=128){const data=await request({action:'embed',texts:candidates.slice(start,start+128).map(x=>({id:x.id,text:intelligenceText(x)}))});embeddings.push(...data.embeddings);missing.push(...(data.missingIds||[]));}
  if(search){const data=await request({action:'embed',texts:[{id:anchorId,text:query.trim().slice(0,20000)}]});embeddings.push(...data.embeddings);missing.push(...(data.missingIds||[]));}
  const ranked=rankEmbeddings(embeddings,search?anchorId:chosen.id,{limit:active==='Discover'?60:30});if(live.current)setResult({ranked,missingCount:missing.length,indexed:embeddings.length-(search?1:0),local:true});
  if(live.current&&!ranked.length)setMessage('没有可比较的本机句向量。当前系统可能尚不支持这些文字的语言；没有用关键词结果替代。');
 });}
 const selectMode=value=>{if(value===active)return;setActive(value);setResult(null);setResultRecord(null);setDraftId('');setImageState(null);setAcceptedTags([]);setAcceptedCollections([]);setMessage('');setError('');};
 return <div className="si-panel">
  <nav className="si-tabs" aria-label="智能工具">{['The Gist','Semantic search','Related','Discover','OCR','Classification','Settings'].map(x=><button type="button" className={active===x?'active':''} key={x} disabled={busy} onClick={()=>selectMode(x)}>{titleFor(x)}</button>)}</nav>
  {!available&&<p role="status">请在更新后的梦藏独立应用中使用这些功能。网页预览不会调用模型。</p>}
  {error&&<p className="si-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {status&&<p className="si-muted">本次启动：本机分析 {status.usage?.nativeRequests||0} 次 · 本机转录 {status.usage?.localTranscriptionRequests||0} 次 · 生成请求 {status.usage?.generationRequests||0} 次 · 云端请求 {status.usage?.cloudRequests||0} 次。实际 API / CLI 调用需逐次确认。</p>}
  {active==='Settings'&&settings&&<form onSubmit={saveSettings}>
   <label className="si-check"><input type="checkbox" checked={!!settings.nativeEnabled} onChange={e=>setSettings(s=>({...s,nativeEnabled:e.target.checked}))}/>启用本机 OCR 与句向量分析（不使用云端额度）</label>
   <label className="si-check"><input type="checkbox" checked={!!settings.generationEnabled} onChange={e=>setSettings(s=>({...s,generationEnabled:e.target.checked}))}/>准备 API / CLI 生成连接（每次调用仍需确认）</label>
   <label className="sw-field">连接方式<select aria-label="AI 连接方式" value={settings.provider||'api'} onChange={e=>setSettings(s=>({...s,provider:e.target.value}))}><option value="api">兼容 OpenAI 的 API</option><option value="cli">本机 CLI</option></select></label>
   {settings.provider!=='cli'&&<button type="button" disabled={busy} onClick={()=>{setSettings(s=>({...s,...DEEPSEEK_PRESET}));setMessage('已填入 DeepSeek 地址和模型；请在本机输入密钥并保存，没有调用模型。');}}>填入 DeepSeek 配置</button>}
   {settings.provider!=='cli'?<><label className="sw-field">API 地址<input aria-label="API 地址" value={settings.endpoint||''} placeholder="https://api.openai.com/v1" onChange={e=>setSettings(s=>({...s,endpoint:e.target.value}))}/></label><label className="sw-field">API 密钥<input aria-label="API 密钥" type="password" autoComplete="off" value={key} placeholder={status.hasApiKey?'已安全保存；留空保留':'在本机输入，聊天中无需提供'} onChange={e=>setKey(e.target.value)}/></label>{status.hasApiKey&&<button type="button" disabled={busy} onClick={()=>work(async()=>{valueOf(await api.intelligenceSetKey(''));setMessage('已移除保存的密钥');})}>移除本机密钥</button>}</>:<label className="sw-field">CLI 程序<select aria-label="CLI 程序" value="claude" onChange={()=>{}}><option value="claude">Claude CLI（禁用工具执行）</option></select></label>}
   <label className="sw-field">模型名称<input aria-label="模型名称" value={settings.model||''} onChange={e=>setSettings(s=>({...s,model:e.target.value}))} placeholder="填写服务提供的模型 ID" list="si-model-list"/></label><datalist id="si-model-list">{(isDeepSeekEndpoint(settings.endpoint)?[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]:models).map(m=><option key={m.id} value={m.id}/>)}</datalist>
   {settings.provider!=='cli'&&isDeepSeekEndpoint(settings.endpoint)&&<p className="si-muted">DeepSeek 使用非思考模式完成解读与分类。deepseek-flash 支持文字与图片，deepseek-v4-pro 仅支持文字。当前连接不提供音频转录；音频可使用下方的本机转录。</p>}{settings.provider==='cli'&&<p className="si-muted">当前 CLI 连接仅发送所选素材文字，图片解读请使用支持图片输入的 API。</p>}<p className="si-muted">素材只会在你确认某次调用后发送给所选服务。保存连接设置不会生成内容。第三方 API 或 CLI 的费用以其服务为准。</p>
   <section className="si-result" aria-label="音频转录设置"><h3>音频转录</h3><label className="sw-field">转录方式<select aria-label="转录方式" value={settings.transcriptionProvider||'local'} onChange={e=>setSettings(s=>({...s,transcriptionProvider:e.target.value}))}><option value="local">本机转录</option><option value="api">当前 API 转录</option></select></label>
   {(settings.transcriptionProvider||'local')==='local'?<><label className="si-check"><input aria-label="启用本机音频转录" type="checkbox" checked={!!settings.localTranscriptionEnabled} onChange={e=>setSettings(s=>({...s,localTranscriptionEnabled:e.target.checked}))}/>启用本机音频转录（每次任务仍需确认）</label><p className="si-muted">本机模型：{status.localTranscription?.model||'large-v3-turbo'} · {status.localTranscription?.ready||status.localTranscription?.available?'已准备好':'尚未准备好'}。{status.localTranscription?.message||''}</p><p className="si-muted">音频留在本机，不消耗云端额度。模型在确认任务后按需启动，任务完成或取消后退出并释放内存；此开关不会预先加载模型，也不依赖上方的 API / CLI 生成开关。</p></>:<><label className="sw-field">音频转录模型<input aria-label="音频转录模型" value={settings.transcriptionModel||'whisper-1'} onChange={e=>setSettings(s=>({...s,transcriptionModel:e.target.value}))}/></label><p className="si-muted">使用上方已配置的 API 地址和密钥，实际上传前逐次确认。DeepSeek 官方 API 不提供音频转录；本轮可直接使用本机转录。</p></>}</section>
   <footer><button className="sw-primary" disabled={busy}>保存连接设置</button></footer>
  </form>}
  {active!=='Settings'&&<>
   {!['Semantic search'].includes(active)&&<label className="sw-field">参考素材<select aria-label="参考素材" value={selectedId} disabled={busy} onChange={e=>{if(e.target.value===selectedId)return;setSelectedId(e.target.value);setResult(null);setResultRecord(null);setDraftId('');setImageState(null);setAcceptedTags([]);setAcceptedCollections([]);setMessage('');setError('');}}><option value="">请选择素材</option>{card&&!cards.some(x=>x.id===card.id)&&<option value={card.id}>{card.title||'未命名素材'}</option>}{cards.map(x=><option key={x.id} value={x.id}>{x.title||'未命名素材'}</option>)}</select></label>}
   {INSIGHT_LABELS[active]&&<label className="sw-field">解读方式<select aria-label="解读方式" value={active} disabled={busy} onChange={e=>selectMode(e.target.value)}>{Object.entries(INSIGHT_LABELS).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>}
   {trackedMode&&modeDrafts.length>0&&<label className="sw-field">本机结果草稿<select aria-label="本机结果草稿" value={draftId} disabled={busy} onChange={e=>{const record=modeDrafts.find(item=>item.id===e.target.value);if(record){setError('');setMessage('');showDraft(record);}}}><option value="" disabled>选择历史结果</option>{modeDrafts.map(record=><option key={record.id} value={record.id}>{record.sourceSnapshot.title||'未命名素材'} · {new Date(record.createdAt).toLocaleString()} · {record.phase==='complete'?record.savedCardId?'已保存笔记':'已返回结果':record.phase==='pending'?'未完成':'调用失败'}</option>)}</select></label>}
   {resultRecord&&<p className="si-muted">结果来源：{resultRecord.sourceSnapshot.title||'未命名素材'} · {titleFor(resultRecord.mode)}</p>}
   {resultRecord?.phase==='pending'&&<p role="status" className="si-muted">{requestIsActive?.(resultRecord.id)?'本次调用正在处理，关闭工具后结果仍会保存到本机草稿。':'上次调用未完成，未自动重试。你可核对后手动发起新的调用。'}</p>}
   {resultRecord?.phase==='failed'&&<p role="alert" className="si-error">{resultRecord.error||'本次调用未完成，未自动重试。'}</p>}
   {resultRecord?.recoveryText&&<section className="si-result"><p className="si-muted">服务已返回内容，但未通过结果校验。原文已作为待核对草稿保留，可复制后手工整理；不会自动采用或重新调用。</p><label className="sw-field">待核对的返回原文<textarea aria-label="待核对的返回原文" value={resultRecord.recoveryText} readOnly rows={12}/></label></section>}
   {active==='OCR'&&result?.text?.length>MAX_OCR_TEXT&&<p className="si-muted">这份旧识别草稿超过当前 100 万字符保存上限。全文仍保留，可复制后拆分处理。</p>}
   {resultRecord?.phase==='complete'&&<p className="si-muted">{!onResultDraft?'结果保留于本次会话。':resultDurable?'结果已保存在本机草稿，关闭工具或切换解读方式后可恢复。':'结果已返回，尚未保存到磁盘，请复制或另存笔记；关闭软件后可能丢失。'}</p>}
   {resultRecord&&onResultDraft&&!resultDurable&&<p className="si-muted" role="status">这份结果草稿尚未写入磁盘。重新保存只保留已有内容，不会重新调用服务。<button type="button" disabled={busy||requestIsActive?.(resultRecord.id)} onClick={()=>work(async()=>{await persistDraft(resultRecord);if(live.current)setMessage('结果草稿已保存到本机，没有重新调用服务。');})}>重新保存结果草稿</button></p>}
   {active==='Semantic search'&&<label className="sw-field">描述你想找的内容<input aria-label="语义搜索描述" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!busy){e.preventDefault();execute();}}}/></label>}
   {['Semantic search','Related','Discover'].includes(active)&&<p className="si-muted">比较当前资料库 {cards.length} 张卡片的本机句向量，每张取前 2 万字。不调用云端，也不读取公开社区；结果是待核对的相似素材。</p>}
   {generationMode&&imageReference&&<section className="si-image-preview" aria-label="待发送图片">{currentImage?.image?<><img src={currentImage.image.dataUrl} alt={`待发送原图：${currentImage.image.name}`}/><div><strong>{currentImage.image.name}</strong><small>{formatImageBytes(currentImage.image.size)} · {currentImage.image.type}</small><p className="si-muted">确认本次调用后，这张图片原文件和所选素材文字会发送给当前 API 服务。预览仅在本机准备，不会提前上传。</p></div></>:<p role={currentImage?.issue?'alert':'status'} className={currentImage?.issue?'si-error':'si-muted'}>{currentImage?.issue||'正在准备图片原文件…'}</p>}{imageProviderIssue&&<p className="si-error" role="alert">{imageProviderIssue}</p>}</section>}
   {generationMode&&!imageReference&&IMAGE_INSIGHT_MODES.includes(active)&&<p className="si-error" role="alert">此解读方式需要图片原文件，请先选择图片素材。</p>}
   {INSIGHT_LABELS[active]&&<p className="si-muted">使用所选素材的标题、正文和已提取文字，最多 2 万字{imageReference?'，以及上方预览的图片原文件':''}。生成结果单独保存为文字笔记，原文件保持不变。</p>}
   <button className="sw-primary" type="button" disabled={busy||pendingActive||!available||(generationMode&&imageReference&&(!currentImage?.image||!!currentImage?.issue||!!imageProviderIssue))||(IMAGE_INSIGHT_MODES.includes(active)&&!imageReference)} onClick={execute}>{busy||pendingActive?'正在处理…':INSIGHT_LABELS[active]||active==='Classification'?'准备调用并确认':active==='OCR'?'在本机识别':'在本机查找'}</button>
   {result?.text!==undefined&&<section className="si-result"><label className="sw-field">{active==='OCR'?'识别文字':'生成内容'}<textarea aria-label="智能工具结果" value={result.text} readOnly rows={12}/></label>{active!=='OCR'&&resultRecord?.savedCardId?<button disabled={busy} onClick={()=>onOpen?.(resultRecord.savedCardId)}>查看已保存笔记</button>:<button disabled={busy||!result.text.trim()} onClick={saveTextResult}>{active==='OCR'?'保存识别文字':'另存为解读笔记'}</button>}</section>}
   {result?.ranked&&<section className="si-result" aria-label="语义检索结果"><p>已分析 {result.indexed} 张卡片{result.missingCount?`，${result.missingCount} 份文字没有可用向量`:''}。</p>{result.ranked.map(entry=>{const item=cards.find(x=>x.id===entry.id);return item?<button className="si-match" key={entry.id} onClick={()=>onOpen(item.id)}><strong>{item.title||'未命名素材'}</strong><span>向量相似度 {entry.score.toFixed(3)} · 待人工核对</span><p>{intelligenceText(item).slice(0,180)}</p></button>:null;})}</section>}
   {result?.tags&&<section className="si-result"><p>{result.reason}</p><p>选择要采用的建议：</p>{result.tags.map(tag=><label className="si-check" key={tag}><input type="checkbox" checked={acceptedTags.includes(tag)} onChange={e=>setAcceptedTags(v=>e.target.checked?[...v,tag]:v.filter(x=>x!==tag))}/>{tag}</label>)}{(result.collectionIds||[]).map(id=>{const col=collections.find(x=>x.id===id);return col?<label className="si-check" key={id}><input type="checkbox" checked={acceptedCollections.includes(id)} onChange={e=>setAcceptedCollections(v=>e.target.checked?[...v,id]:v.filter(x=>x!==id))}/>加入收藏集：{col.title}</label>:null;})}<button disabled={busy} onClick={()=>work(async()=>{await onApplyClassification(result.sourceSnapshot,{tags:acceptedTags,collectionIds:acceptedCollections},resultRecord);if(live.current)setMessage('所选分类建议已保存，原文未改动');})}>采用所选建议</button></section>}
  </>}
 </div>;
}
