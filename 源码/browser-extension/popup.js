import {screenshotFile} from './screenshot.js';
import {visibleJobs} from './jobs.js';
const $ = id => document.getElementById(id);
const kinds = {link: '网页', article: '文章', image: '图片', highlight: '高亮', screenshot:'截图'};
const UPDATE_NOTICE = '扩展更新尚未生效，请关闭面板后在扩展管理页重新加载梦藏';
const UI_PROTOCOL = 4, activeJobButtons = new Set();
let compatible = false, busy = false, collections = [], missingCollections = new Set(), nextCollectionOffset = null, selectedCollections = new Set(['browser-clips-v1']), autoSite = null, page = null;
let preferredReceipt='', relatedKey='', relatedRun=0, preview=null, region=null, drag=null;
async function send(request) {
  const response = await chrome.runtime.sendMessage({...request, uiProtocol: UI_PROTOCOL});
  if (!response?.ok) throw new Error(response?.error || '扩展连接暂不可用，请关闭面板后重试。');
  return response.data;
}
function message(text, error = false) {$('message').textContent = text; $('message').classList.toggle('error', error);}
function formOptions() {return {note: $('note').value, favorite: $('favorite').checked, collectionIds: [...selectedCollections]};}
function lock(value) {busy = value; for (const element of document.querySelectorAll('button,textarea,input')) element.disabled = value || !compatible || activeJobButtons.has(element); $('refresh').disabled = value; if (!value && compatible) {$('auto-site').disabled = !autoSite || !page; $('commit-crop').disabled=!region;}}
function saveOptions() {if (busy || !compatible || !page) return; void send({action: 'settings', options: formOptions()}).catch(error => message(error.message, true));}
function renderCollections() {
  const target = $('collection-list'); target.replaceChildren();
  const labels = [];
  for (const collection of collections) {
    const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
    input.type = 'checkbox'; input.value = collection.id; input.checked = selectedCollections.has(collection.id);
    input.addEventListener('change', () => {if (busy || !compatible) return; if (input.checked) selectedCollections.add(collection.id); else selectedCollections.delete(collection.id); $('collection-count').textContent = selectedCollections.size ? `已选 ${selectedCollections.size}` : '不加入收藏集'; saveOptions();});
    text.textContent = collection.title; label.append(input, text); labels.push(label);
  }
  const known = new Set(collections.map(item => item.id));
  for (const id of selectedCollections) if (!known.has(id)) {
    const row = document.createElement('div'), text = document.createElement('span'), remove = document.createElement('button');
    row.className = 'missing-collection';
    text.textContent = `${missingCollections.has(id) ? '已删除的收藏集' : '尚未核实的收藏集'} · ${id}`;
    remove.type = 'button'; remove.textContent = '解除选择'; remove.setAttribute('aria-label', `解除收藏集选择：${id}`);
    remove.addEventListener('click', () => {if (busy || !compatible) return; selectedCollections.delete(id); renderCollections(); saveOptions();});
    row.append(text, remove); target.append(row);
  }
  target.append(...labels);
  $('collection-count').textContent = selectedCollections.size ? `已选 ${selectedCollections.size}` : '不加入收藏集';
  $('more-collections').hidden = nextCollectionOffset == null;
}
function renderJobs(jobs) {
  const target = $('jobs'); target.replaceChildren(); activeJobButtons.clear();
  if (!jobs.length) {const p = document.createElement('p'); p.className = 'empty'; p.textContent = '在网页上遇见值得留下的内容，就从这里收录。'; target.append(p); return;}
  for (const job of visibleJobs(jobs)) {
    const row = document.createElement('div'); row.className = 'job';
    const icon = document.createElement('span'); icon.className = 'job-icon'; icon.textContent = job.status === 'saved' ? '✓' : '·'; icon.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div'); content.className = 'job-content';
    const title = document.createElement('div'); title.className = 'job-title'; title.textContent = `${kinds[job.kind] || '素材'} · ${job.title || '未命名素材'}`; title.title = job.title || '未命名素材';
    const note = document.createElement('div'); note.className = 'job-note';
    note.textContent = job.status === 'saved' ? (job.result?.duplicate ? '已保存 · 原条目已保留' : '已保存到梦藏') : job.active ? '正在保存，请等待回执' : job.error || '保存结果尚未确认，可使用原请求重试';
    content.append(title, note);
    if (job.warnings?.length) {const warning = document.createElement('div'); warning.className = 'job-note warning'; warning.textContent = job.warnings.join(' '); content.append(warning);}
    row.append(icon, content);
    if (job.status !== 'saved') {
      const actions = document.createElement('div'), retry = document.createElement('button'), discard = document.createElement('button'), confirmation = document.createElement('div');
      actions.className = 'job-actions'; retry.type = discard.type = 'button'; retry.className = discard.className = 'retry';
      retry.textContent = '重试'; retry.setAttribute('aria-label', `重试保存：${job.title || '素材'}`);
      retry.addEventListener('click', () => {if (!job.active) return operation({action: 'retry', requestId: job.requestId});});
      discard.textContent = '放弃'; discard.setAttribute('aria-label', `放弃本机待办：${job.title || '素材'}`);
      confirmation.className = 'job-confirm'; confirmation.hidden = true;
      const warning = document.createElement('p'), confirm = document.createElement('button'), cancel = document.createElement('button');
      warning.textContent = '只移除此本机待办，不会删除梦藏资料。未收到回执的内容可能已经保存；重新收录可能新增卡片。';
      confirm.type = cancel.type = 'button'; confirm.textContent = '确认放弃'; cancel.textContent = '继续保留';
      confirm.addEventListener('click', () => {if (!job.active) return operation({action: 'discard', requestId: job.requestId, confirmed: true});});
      cancel.addEventListener('click', () => {if (!busy && compatible) confirmation.hidden = true;});
      discard.addEventListener('click', () => {if (!busy && compatible && !job.active) confirmation.hidden = false;});
      if (job.active) for (const button of [retry, discard, confirm]) {activeJobButtons.add(button); button.disabled = true;}
      confirmation.append(warning, confirm, cancel); actions.append(retry, discard); row.append(actions, confirmation);
    }
    target.append(row);
  }
}
function renderHighlights(items, restored, error) {
  const target = $('highlights'); target.replaceChildren(); $('highlight-count').textContent = items.length ? `${items.length} 条` : '';
  $('highlight-state').textContent = error || (items.length ? `${restored?.matched || 0} 条已显示${restored?.missing ? `，${restored.missing} 条原文已变化或尚未加载` : ''}` : '选中文字后保存，便能在这里再次定位。');
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'highlight-row';
    const quote = document.createElement('p'); quote.textContent = item.text || item.title; quote.title = item.text || item.title;
    const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = item.found ? '定位' : '重试定位'; locate.setAttribute('aria-label', `定位高亮：${item.text || item.title}`);
    locate.addEventListener('click', async () => {if (busy || !compatible) return; lock(true); try {await send({action: 'locate', id: item.id}); message('已定位到原网页中的高亮。');} catch (error) {message(error.message, true);} finally {lock(false);}});
    row.append(quote, locate); target.append(row);
  }
}
async function refresh(updateOptions = false) {
  const value = await send({action: 'status'});
  compatible = value?.uiProtocol === UI_PROTOCOL;
  if (!compatible) {
    clearRelated(); closeCrop(); page = null; autoSite = null; collections = []; nextCollectionOffset = null;
    $('connection').textContent = UPDATE_NOTICE; message(UPDATE_NOTICE, true);
    $('collection-list').replaceChildren(); $('collection-count').textContent = '更新后读取'; $('collection-error').textContent = ''; $('more-collections').hidden = true;
    renderHighlights([], null, '更新完成后读取本页高亮。'); renderJobs(Array.isArray(value?.jobs) ? value.jobs : []);
    lock(busy);
    return;
  }
  if ($('message').textContent === UPDATE_NOTICE) message('');
  $('connection').textContent = value.connection?.ready ? '已连接梦藏资料库' : value.error || '请打开梦藏，等待资料库加载完成';
  page = value.page; autoSite = value.autoSite;
  if (updateOptions) {selectedCollections = new Set(value.options?.collectionIds || ['browser-clips-v1']); $('note').value = value.options?.note || ''; $('favorite').checked = !!value.options?.favorite;}
  collections = [...new Map([...(value.collectionPage?.items || []), ...(value.collectionSelection?.items || [])].map(item => [item.id, item])).values()];
  missingCollections = new Set(value.collectionSelection?.checked ? value.collectionSelection.missingIds : []);
  nextCollectionOffset = value.collectionPage?.nextOffset ?? null;
  $('collection-error').textContent = value.collectionError || ''; renderCollections();
  $('auto-site').textContent = autoSite?.enabled ? '关闭此网站自动高亮' : '开启此网站自动高亮'; $('auto-site').disabled = busy || !autoSite || !page;
  if (value.captureError) message(value.captureError, true);
  renderHighlights(value.highlights || [], value.restore, value.highlightError); renderJobs(value.jobs || []);
  const receiptJobs=(value.jobs||[]).filter(j=>j.status==='saved' && j.result?.workspaceId && j.result.workspaceId===value.connection?.workspaceId);
  const latest=receiptJobs.find(j=>j.requestId===preferredReceipt)||receiptJobs.at(-1);
  if(latest)void showRelated(latest);else clearRelated();
}
async function operation(request) {
  if (busy) return;
  if (!compatible) {message(UPDATE_NOTICE, true); lock(false); return;}
  if (request.action === 'capture') request.options = formOptions();
  if (request.action !== 'save-screenshot') closeCrop();
  lock(true); message(request.action === 'restore' ? '正在显示本页高亮…' : request.action === 'discard' ? '正在移除本机待办…' : '正在保存，请稍候…');
  let saved = false;
  try {
    const value = await send(request); saved = !!value.result;
    if(saved){
      preferredReceipt=value.result.captureReceipt?.requestId||value.job?.params?.requestId||request.requestId||'';
      if(preferredReceipt&&value.result.workspaceId)void showRelated({requestId:preferredReceipt,title:value.result.item?.title,result:value.result},true);
    }
    message(value.discarded ? '已移除本机待办，梦藏中已保存的资料保留。' : value.result?.duplicate ? '这条内容已经保存在梦藏中。' : request.action === 'restore' ? '已重新显示本页高亮。' : '已保存到梦藏。');
  } catch (error) {message(error.message, true);}
  finally {try {await refresh(saved);} catch (error) {message(error.message, true);} lock(false);}
}
function clearRelated(){++relatedRun;relatedKey='';$('related-panel').hidden=true;$('related-items').replaceChildren();}
async function showRelated(job,force=false){
  const key=job.result.workspaceId+'|'+job.requestId;
  if(!force&&relatedKey===key)return;
  const run=++relatedRun;relatedKey=key;
  $('related-panel').hidden=false;$('related-for').textContent='刚收录：'+(job.title||'未命名资料');
  const target=$('related-items');target.replaceChildren();target.textContent='正在查找…';
  try{
    const result=await send({action:'related',requestId:job.requestId});
    if(run!==relatedRun)return;
    if(result.workspaceId!==job.result.workspaceId||!Array.isArray(result.items))throw Error('相关资料暂时不可用。');
    target.replaceChildren();
    if(!result.items.length){target.textContent='库中暂时没有找到相关资料。';return;}
    for(const card of result.items.slice(0,3)){
      const row=document.createElement('button'),title=document.createElement('strong'),hint=document.createElement('small');
      row.type='button';row.className='related-row';row.setAttribute('aria-label','在梦藏打开：'+card.title);
      title.textContent=card.title;hint.textContent=card.type+' · '+card.reason;row.append(title,hint);
      row.addEventListener('click',async()=>{
        if(busy||run!==relatedRun)return;
        try{await send({action:'open-related',requestId:job.requestId,cardId:card.id});}
        catch(e){if(run===relatedRun){message(e.message,true);void showRelated(job,true);}}
      });target.append(row);
    }
  }catch(e){
    if(run!==relatedRun)return;
    target.replaceChildren();const tip=document.createElement('p'),retry=document.createElement('button');
    tip.textContent='剪藏已保存。'+e.message;retry.type='button';retry.className='text-button';retry.textContent='重新查找';
    retry.addEventListener('click',()=>showRelated(job,true));target.append(tip,retry);
  }
}
function closeCrop(){preview=null;region=null;drag=null;$('crop-panel').hidden=true;$('crop-image').removeAttribute?.('src');}
function drawCrop(){
  const box=$('crop-box');box.hidden=!region;
  if(region){const {left,right,top,bottom}=region;Object.assign(box.style,{left:(100*left)+'%',top:(100*top)+'%',width:(100*(right-left))+'%',height:(100*(bottom-top))+'%'});}
  $('crop-info').textContent=region?'已选中区域，可重新拖动。':'拖动或按方向键开始框选。';
  $('commit-crop').disabled=busy||!region;
}
async function saveSnapshot(snapshot,selection,selected){
  const attachment=await screenshotFile(snapshot,selection,selected);
  const {tabId,windowId,url,title}=snapshot;
  lock(false);
  await operation({action:'save-screenshot',source:{tabId,windowId,url,title},mode:selection?'region':'viewport',attachment,options:selected});
}
async function startShot(crop){
  if(busy||!compatible||!page)return;
  closeCrop();lock(true);message('正在截取网页可见区域…');
  try{
    const selected=formOptions(), snapshot=await send({action:'snapshot',expectedUrl:page.url});
    if(!crop){await saveSnapshot(snapshot,null,selected);return;}
    const img=$('crop-image');img.src=snapshot.dataUrl;await img.decode();
    preview=snapshot;$('crop-panel').hidden=false;drawCrop();message('');$('crop-stage').focus();
  }catch(e){message(e.message,true);}finally{lock(false);}
}
const clamp=(n,min=0,max=1)=>Math.min(max,Math.max(min,n));
function point(event){const r=$('crop-stage').getBoundingClientRect();return {x:clamp((event.clientX-r.left)/r.width),y:clamp((event.clientY-r.top)/r.height)};}
function setRegion(a,b){const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),top=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y);region=(right-left>.008&&bottom-top>.008)?{left,right,top,bottom}:null;drawCrop();}
const stage=$('crop-stage');
stage.addEventListener('pointerdown',e=>{if(!preview||busy||e.button!==0)return;e.preventDefault();stage.focus();stage.setPointerCapture(e.pointerId);drag={id:e.pointerId,p:point(e)};region=null;drawCrop();});
stage.addEventListener('pointermove',e=>{if(drag?.id===e.pointerId)setRegion(drag.p,point(e));});
stage.addEventListener('pointerup',e=>{if(drag?.id===e.pointerId){setRegion(drag.p,point(e));drag=null;}});
stage.addEventListener('pointercancel',()=>{drag=null;region=null;drawCrop();});
stage.addEventListener('keydown',e=>{
  if(!preview||busy)return;
  if(e.key==='Escape'){e.preventDefault();closeCrop();return;}
  const d={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]}[e.key];if(!d)return;e.preventDefault();
  const v=region||{left:.2,right:.8,top:.2,bottom:.8},w=v.right-v.left,h=v.bottom-v.top;
  if(e.shiftKey)region={...v,right:clamp(v.right+d[0],v.left+.01,1),bottom:clamp(v.bottom+d[1],v.top+.01,1)};
  else {const left=clamp(v.left+d[0],0,1-w),top=clamp(v.top+d[1],0,1-h);region={left,top,right:left+w,bottom:top+h};}
  drawCrop();
});
$('save-screenshot').addEventListener('click',()=>startShot(false));$('crop-screenshot').addEventListener('click',()=>startShot(true));
$('cancel-crop').addEventListener('click',()=>{closeCrop();message('');});
$('commit-crop').addEventListener('click',async()=>{if(!preview||!region||busy)return;const shot=preview,selection=region;lock(true);
  try{await saveSnapshot(shot,selection,formOptions());closeCrop();}catch(e){message(e.message,true);}finally{lock(false);}
});
$('save-page').addEventListener('click', () => operation({action: 'capture', kind: 'link'}));
$('save-article').addEventListener('click', () => operation({action: 'capture', kind: 'article'}));
$('save-selection').addEventListener('click', () => operation({action: 'capture', kind: 'highlight'}));
$('restore-highlights').addEventListener('click', () => operation({action: 'restore'}));
$('note').addEventListener('input', saveOptions); $('favorite').addEventListener('change', saveOptions);
$('refresh').addEventListener('click', () => {if (!busy) {lock(true); refresh().catch(error => message(error.message, true)).finally(() => lock(false));}});
$('more-collections').addEventListener('click', async () => {if (busy || !compatible || nextCollectionOffset == null) return; lock(true); try {const result = await send({action: 'collections', offset: nextCollectionOffset}); collections = [...new Map([...collections, ...result.items].map(item => [item.id, item])).values()]; nextCollectionOffset = result.nextOffset ?? null; renderCollections();} catch (error) {message(error.message, true);} finally {lock(false);}});
$('auto-site').addEventListener('click', () => {
  if (busy || !compatible || !autoSite || !page) return;
  const target = {...autoSite}, enabled = !target.enabled;
  // permissions.request is started directly from the user's click, preserving
  // Chrome's gesture requirement. Only this exact scheme and host is requested.
  const permission = enabled && !target.allowed ? chrome.permissions.request({origins: [target.pattern]}) : Promise.resolve(true);
  lock(true);
  void permission.then(async granted => {if (!granted) {message('未启用自动高亮。点开扩展仍可显示本页已存高亮。'); return;} await send({action: 'auto-site', enabled, pattern: target.pattern}); message(enabled ? '此网站已开启自动高亮。其他网站不受影响。' : '已关闭此网站自动高亮并撤销对应权限。');}).catch(error => message(error.message, true)).finally(async () => {try {await refresh();} catch (error) {message(error.message, true);} lock(false);});
});
lock(true); refresh(true).catch(error => message(error.message, true)).finally(() => lock(false));
