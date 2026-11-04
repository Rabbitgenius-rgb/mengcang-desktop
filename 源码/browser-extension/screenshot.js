// Capture only the explicitly selected web tab. A window screenshot API targets
// its active tab, so a tab switch (including a switch away and back) invalidates it.
const changed = () => new Error('页面或标签已经切换，未保存截图。请在目标网页重新截图。');
export function captureAllowed(value) {
  try {
    const u=new URL(value);
    return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&
      ![...u.searchParams.keys()].some(k=>/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i.test(k))&&
      u.hostname!=='chromewebstore.google.com'&&!(u.hostname==='chrome.google.com'&&u.pathname.startsWith('/webstore'))&&
      !(u.hostname==='microsoftedge.microsoft.com'&&u.pathname.startsWith('/addons'));
  } catch {return false;}
}
export async function captureBoundTab(tabs,tab) {
  if (!Number.isInteger(tab?.id)||!Number.isInteger(tab.windowId)||!captureAllowed(tab.url))
    throw new Error('只能截取普通网页的可见内容。');
  let invalid=false;
  const active=e=>{if(e.windowId===tab.windowId&&e.tabId!==tab.id)invalid=true;};
  const update=(id,info)=>{if(id===tab.id&&(info.url||info.status==='loading'))invalid=true;};
  const removed=id=>{if(id===tab.id)invalid=true;};
  const events=[[tabs.onActivated,active],[tabs.onUpdated,update],[tabs.onRemoved,removed]];
  for(const [e,fn] of events)e?.addListener(fn);
  async function verify(){
    const [t]=await tabs.query({active:true,windowId:tab.windowId});
    if(invalid||!t||t.id!==tab.id||t.url!==tab.url||t.pendingUrl)throw changed();
  }
  try{
    await verify();
    const dataUrl=await tabs.captureVisibleTab(tab.windowId,{format:'png'});
    await verify();
    if(!dataUrl?.startsWith('data:image/png;base64,'))throw new Error('没有取得网页画面，请重新截图。');
    return {tabId:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title||new URL(tab.url).hostname,dataUrl};
  }finally{for(const [e,fn] of events)e?.removeListener(fn);}
}
export function pixelRect(region,width,height){
  if(!region)return {x:0,y:0,w:width,h:height};
  const {left,top,right,bottom}=region;
  if(![left,top,right,bottom].every(Number.isFinite) || left<0 || top<0 || right>1 || bottom>1 || right<=left || bottom<=top)
    throw new Error('请在预览上拖出要保存的区域。');
  const x=Math.floor(left*width),y=Math.floor(top*height);
  return {x,y,w:Math.ceil(right*width)-x,h:Math.ceil(bottom*height)-y};
}
export const screenshotSize=url=>{const s=url.slice(url.indexOf(',')+1);return s.length*3/4-(s.endsWith('==')?2:s.endsWith('=')?1:0);};
export function maxScreenshotBytes(options) {
  // Existing native input limit is 1 MiB including base64 and all UTF-8 metadata.
  const reserved=new TextEncoder().encode(JSON.stringify(options)).length+48*1024;
  return Math.min(660*1024,Math.floor((1024*1024-reserved)*.75)-3);
}
export async function screenshotFile(snapshot,region,options){
  const budget=maxScreenshotBytes(options);
  if(budget<24*1024)throw new Error('本次备注或收藏集选择过长，请缩短后再保存截图。');
  const file=(url,type)=>({name:region?'网页选区.'+(type==='image/png'?'png':'jpg'):'网页截图.'+(type==='image/png'?'png':'jpg'),type,size:screenshotSize(url),dataUrl:url});
  if(!region && screenshotSize(snapshot.dataUrl)<=budget)return file(snapshot.dataUrl,'image/png');
  const img=new Image();img.src=snapshot.dataUrl;await img.decode();
  const r=pixelRect(region,img.naturalWidth,img.naturalHeight),canvas=document.createElement('canvas');
  for(let step=0;step<7;step++){
    const ratio=.78**step;
    canvas.width=Math.max(1,Math.round(r.w*ratio));canvas.height=Math.max(1,Math.round(r.h*ratio));
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,r.x,r.y,r.w,r.h,0,0,canvas.width,canvas.height);
    if(step===0&&region){const png=canvas.toDataURL('image/png');if(png.startsWith('data:image/png;')&&screenshotSize(png)<=budget)return file(png,'image/png');}
    for(const quality of [.92,.79]){
      const jpeg=canvas.toDataURL('image/jpeg',quality);
      if(jpeg.startsWith('data:image/jpeg;')&&screenshotSize(jpeg)<=budget)return file(jpeg,'image/jpeg');
    }
  }
  throw new Error('截图仍然过大，请框选较小的区域。');
}
