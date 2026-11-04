// A small inert article tree, never arbitrary HTML or site CSS/scripts.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_ARTICLE'});};
const badUnicode=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function shape(value,keys,label){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))fail(`${label}格式无效`);}
function text(value,max,label){if(typeof value!=='string'||value.length>max||value.includes('\0')||badUnicode.test(value))fail(`${label}无效`);return value;}
function url(value){
 text(value,4096,'文章链接');let parsed;try{parsed=new URL(value);}catch{fail('文章链接无效');}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||/[\x00-\x20\x7f]/.test(value)||[...parsed.searchParams.keys()].some(key=>/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i.test(key)))fail('文章链接不是可保存的普通网页地址');
 return parsed.href;
}
function defaultAttachment(raw){
 shape(raw,['name','type','size','dataUrl'],'文章图片附件');
 const name=text(raw.name,1000,'图片名称'),type=text(raw.type,100,'图片类型'),dataUrl=text(raw.dataUrl,Math.ceil(10*1024*1024/3)*4+200,'图片文件');
 if(!['image/png','image/jpeg','image/gif','image/webp','image/avif'].includes(type)||!Number.isSafeInteger(raw.size)||raw.size<1||raw.size>10*1024*1024||!dataUrl.startsWith(`data:${type};base64,`))fail('文章图片附件无效');
 return {name,type,size:raw.size,dataUrl};
}
export function normalizeArticleModel(raw,{normalizeAttachment=defaultAttachment}={}){
 shape(raw,['version','blocks'],'文章内容');if(raw.version!==1||!Array.isArray(raw.blocks)||!raw.blocks.length||raw.blocks.length>1200)fail('文章区块数量无效');
 const ids=new Set();let count=0,runs=0,images=0,rows=0,cells=0;
 const normalizeRuns=(raw,{empty=false}={})=>{
  if(!Array.isArray(raw)||(!empty&&!raw.length)||raw.length>512||(runs+=raw.length)>10000)fail('文章文字区块无效');
  return raw.map(run=>{
   shape(run,['text','href','strong','em'],'文章行内文字');const value={text:text(run.text,50000,'文章文字')};count+=value.text.length;if(count>100000)fail('文章文字超过保存上限');
   if(run.href!==undefined)value.href=url(run.href);
   for(const key of ['strong','em'])if(run[key]!==undefined){if(typeof run[key]!=='boolean')fail('文字格式无效');if(run[key])value[key]=true;}
   return value;
  });
 };
 const blocks=raw.blocks.map(block=>{
  shape(block,['id','type','runs','level','src','alt','caption','attachment','imageError','marker','depth','rows','imagesAfter'],'文章区块');
  const id=text(block.id,100,'文章区块标识');if(!/^[a-zA-Z0-9_-]+$/.test(id)||ids.has(id))fail('文章区块标识重复或无效');ids.add(id);
  const type=block.type;if(!['paragraph','heading','quote','list-item','code','image','table'].includes(type))fail('文章区块类型无效');
  const value={id,type};
  if(type!=='table'&&(block.rows!==undefined||block.imagesAfter!==undefined))fail('此区块不支持表格字段');
  if(type!=='list-item'&&(block.marker!==undefined||block.depth!==undefined))fail('此区块不支持列表字段');
  if(type==='image'){
   if(++images>40||block.runs!==undefined||block.level!==undefined)fail('文章图片区块无效');
   value.src=block.src?url(block.src):'';value.alt=text(block.alt??'',2000,'图片说明');value.caption=text(block.caption??'',2000,'图注');
   if(block.attachment!==undefined)value.attachment=normalizeAttachment(block.attachment);
   if(block.imageError!==undefined)value.imageError=text(block.imageError,500,'图片保存提示');
   if(!value.src&&!value.attachment&&!value.imageError)fail('文章图片缺少来源');
  }else if(type==='table'){
   if(['runs','level','src','alt','caption','attachment','imageError'].some(key=>block[key]!==undefined))fail('表格区块包含不支持的字段');
   if(!Array.isArray(block.rows)||!block.rows.length||(rows+=block.rows.length)>200)fail('文章表格行数超过上限');
   value.rows=block.rows.map(row=>{
    shape(row,['cells'],'文章表格行');
    if(!Array.isArray(row.cells)||!row.cells.length||row.cells.length>100||(cells+=row.cells.length)>2000)fail('文章表格单元格数量无效');
    let columns=0;
    return {cells:row.cells.map(cell=>{
     shape(cell,['runs','header','colspan','rowspan'],'文章表格单元格');
     if(typeof cell.header!=='boolean')fail('文章表格表头标识无效');
     const result={runs:normalizeRuns(cell.runs,{empty:true}),header:cell.header};
     for(const key of ['colspan','rowspan'])if(cell[key]!==undefined){if(!Number.isSafeInteger(cell[key])||cell[key]<1||cell[key]>100)fail('文章表格跨行跨列无效');if(cell[key]>1)result[key]=cell[key];}
     columns+=result.colspan||1;if(columns>200)fail('文章表格列数超过上限');
     return result;
    })};
   });
   if(block.imagesAfter!==undefined){if(typeof block.imagesAfter!=='boolean')fail('文章表格图片位置提示无效');if(block.imagesAfter)value.imagesAfter=true;}
  }else{
   if(block.src!==undefined||block.alt!==undefined||block.caption!==undefined||block.attachment!==undefined||block.imageError!==undefined)fail('文字区块不能携带图片');
   value.runs=normalizeRuns(block.runs);
   if(type==='heading'){if(!Number.isSafeInteger(block.level)||block.level<1||block.level>6)fail('文章标题层级无效');value.level=block.level;}
   else if(block.level!==undefined)fail('此区块不支持标题层级');
   if(type==='list-item'){
    if(block.marker!==undefined){value.marker=text(block.marker,32,'列表编号');if(/[\x00-\x1f\x7f]/.test(value.marker))fail('列表编号须为单行文字');}
    if(block.depth!==undefined){if(!Number.isSafeInteger(block.depth)||block.depth<0||block.depth>20)fail('列表层级无效');value.depth=block.depth;}
   }
  }
  return value;
 });
 return {version:1,blocks};
}
export function articlePlainText(article){return article?.blocks?.filter(block=>block.type!=='image').map(block=>block.type==='table'?block.rows.map(row=>row.cells.map(cell=>cell.runs.map(run=>run.text).join('')).join('\t')).join('\n'):`${block.type==='list-item'&&block.marker?block.marker+' ':''}${(block.runs||[]).map(run=>run.text).join('')}`).join('\n\n')||'';}
