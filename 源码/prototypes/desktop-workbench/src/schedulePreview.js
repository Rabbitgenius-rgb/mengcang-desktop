// This adapter exists only in the browser design preview. The packaged desktop
// chooses DesktopApp and obtains all records from its authenticated connector.
const KEY='mengcang-schedule-preview-v1';
const DRAFTS='mengcang-schedule-preview-drafts-v1';
export const previewScheduleIdentity={name:'设计预览',path:'preview',id:'schedule-preview'};
export function readPreviewSchedules(){try{return JSON.parse(localStorage.getItem(KEY)||'[]');}catch{return [];}}
export function createSchedulePreview(onChange){
  const ok=data=>({ok:true,data});
  const failure=(code,message)=>({ok:false,error:{code,message}});
  return {
    draftGet:async key=>{try{return ok(JSON.parse(localStorage.getItem(DRAFTS)||'{}')[key] || null);}catch{return failure('DRAFT_READ','预览草稿无法读取。');}},
    draftSet:async(key,draft)=>{try{const all=JSON.parse(localStorage.getItem(DRAFTS)||'{}');if(draft===null)delete all[key];else all[key]=draft;localStorage.setItem(DRAFTS,JSON.stringify(all));return ok(true);}catch{return failure('DRAFT_WRITE','浏览器存储失败，请保留当前页面。');}},
    scheduleSave:async input=>{
      try{
        const items=readPreviewSchedules(),previous=items.find(item=>item.id===input.id);
        const fingerprint=JSON.stringify(input.fields);
        if(previous?.lastOperationId===input.operationId){if(previous.lastFingerprint!==fingerprint)return failure('CONFLICT','此操作已经用于其他内容。');return ok({item:previous,operationId:input.operationId});}
        if(input.action==='create'&&previous || input.action==='update'&&(!previous||input.expectedHash!==previous.hash))return failure('CONFLICT','预览记录已变化，请核对后再保存。');
        const now=new Date().toISOString(),fields={...input.fields};
        if(fields.status!=='todo' || previous && previous.status!=='todo')Object.assign(fields,{workState:'idle',focusDate:null,focusOrder:null});
        fields.progressUpdatedAt=fields.progressNote!==(previous?.progressNote || '')?now:previous?.progressUpdatedAt || null;
        const item={schemaVersion:input.schemaVersion || 1,...fields,id:input.id,kind:'schedule',path:`03_projects/_schedule/${input.id}.md`,hash:crypto.randomUUID(),createdAt:previous?.createdAt||now,updatedAt:now,lastOperationId:input.operationId,lastFingerprint:fingerprint};
        const next=previous?items.map(value=>value.id===item.id?item:value):[...items,item];
        localStorage.setItem(KEY,JSON.stringify(next));onChange(next);
        return ok({item,operationId:input.operationId});
      }catch{return failure('SAVE_FAILED','浏览器预览保存失败，草稿仍保留。');}
    },
    readNote:async path=>{const item=readPreviewSchedules().find(item=>item.path===path);return item?ok(item):failure('NOT_FOUND','预览记录不存在。');},
    openNote:async()=>failure('PREVIEW_ONLY','这是浏览器设计预览，尚未连接 Obsidian。'),
  };
}
