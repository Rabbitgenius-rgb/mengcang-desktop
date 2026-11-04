import React from 'react';
import {createRoot} from 'react-dom/client';
import SublimeWorkspace from '../src/sublime/SublimeWorkspace.jsx';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import {workspaceReducer} from '../src/sublime/workspaceModel.js';
import {articlePlainText} from '../../../src/clipper/article.mjs';

// This dedicated browser-only identity never reads the desktop/Vault identity.
const identity='qa-article-reader-fixes-20261101';
const sourceUrl=new URL('/tests/article-source-fixture.html',location.href).href;
const quote='这一句用来验证高亮保存与原文定位。';
const refinedQuote='保留原文的位置，才能在再次阅读时接上之前的思考。';
const longParagraph=index=>`合成长文第 ${index+1} 段。`+'阅读不必一次完成，留下的线索能帮助下一次接续思考。'.repeat(12);
function diagram(){
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=460;const c=canvas.getContext('2d');
 c.fillStyle='#e8eee1';c.fillRect(0,0,960,460);c.strokeStyle='#8eab77';c.lineWidth=3;c.beginPath();c.moveTo(270,230);c.lineTo(690,230);c.stroke();
 for(const [x,label,sub] of [[130,'阅读','遇见一段文字'],[410,'高亮','保留来源位置'],[690,'回看','重新连接想法']]){c.fillStyle='#fff';c.beginPath();c.roundRect(x-50,140,230,180,24);c.fill();c.fillStyle='#33412e';c.font='34px sans-serif';c.fillText(label,x+10,215);c.fillStyle='#7b8874';c.font='19px sans-serif';c.fillText(sub,x-13,265);}
 c.fillStyle='#7b8874';c.font='16px sans-serif';c.fillText('合成图示 · 仅供隔离阅读验收',40,420);
 const dataUrl=canvas.toDataURL('image/png');return {name:'qa-reading-diagram.png',type:'image/png',size:atob(dataUrl.split(',')[1]).length,dataUrl};
}
const article={version:1,blocks:[
 {id:'qa-heading',type:'heading',level:2,runs:[{text:'保存之后，还能继续阅读'}]},
 {id:'qa-first',type:'paragraph',runs:[{text:quote},{text:' 高亮不只是摘下一段文字，还应保留它从哪里来。再次打开文章时，文字与想法可以重新接续。'}]},
 {id:'qa-image',type:'image',src:'https://example.org/qa-reading-diagram.png',alt:'阅读、高亮与回看的合成流程图',caption:'这是明确标注的合成图示，不读取真实用户素材。',attachment:diagram()},
 {id:'qa-second',type:'paragraph',runs:[{text:'保留原文的位置，才能在再次阅读时接上之前的思考。',strong:true}]},
 {id:'qa-link',type:'paragraph',runs:[{text:'这是一条安全的来源链接：'},{text:'Example Domain',href:'https://example.org/'}]},
 {id:'qa-quote',type:'quote',runs:[{text:'收藏不等于结束。让留下的材料，成为下一次思考的开端。',em:true}]},
 {id:'qa-missing',type:'image',src:'https://example.org/not-downloaded.png',alt:'未下载原图',imageError:'合成验收：原图片未保存，验证失败占位提示。'},
 {id:'qa-structures',type:'heading',level:2,runs:[{text:'编号、表格与长文'}]},
 {id:'qa-step-3',type:'list-item',marker:'3.',depth:0,runs:[{text:'先保留可核对的原文'}]},
 {id:'qa-step-a',type:'list-item',marker:'a.',depth:1,runs:[{text:'记录来源与上下文'}]},
 {id:'qa-step-7',type:'list-item',marker:'7.',depth:0,runs:[{text:'再次阅读时整理自己的想法'}]},
 {id:'qa-table',type:'table',imagesAfter:true,rows:[
  {cells:[{header:true,rowspan:2,runs:[{text:'材料'}]},{header:true,colspan:2,runs:[{text:'保留内容'}]}]},
  {cells:[{header:true,runs:[{text:'原文'}]},{header:true,runs:[{text:'我的想法'}]}]},
  {cells:[{header:false,runs:[{text:'网页'}]},{header:false,runs:[{text:'来源链接',href:'https://example.org/'}]},{header:false,runs:[]}]},
  {cells:[{header:false,runs:[{text:'文章'}]},{header:false,runs:[{text:'正文与图文'}]},{header:false,runs:[{text:'可在阅读中留下备注'}]}]},
 ]},
 {id:'qa-table-image',type:'image',src:'https://example.org/qa-reading-diagram.png',alt:'表内合成流程图',caption:'表内合成图片按原顺序单独展示。',attachment:diagram()},
 {id:'qa-legacy-list',type:'list-item',runs:[{text:'旧版未记录编号的列表仍显示圆点'}]},
 ...Array.from({length:80},(_,index)=>({id:'qa-long-'+index,type:'paragraph',runs:[{text:longParagraph(index)}]})),
]};
const source={id:'qa-reader-article',type:'article',origin:'local',title:'让阅读留下线索',body:articlePlainText(article),article,author:'合成作者 · 本机验收',sourceTitle:'隔离原网页',sourceUrl,tags:[]};
const legacy={id:'qa-reader-legacy',type:'article',origin:'local',title:'旧纯文字文章',body:'这是一张旧版文章卡片，没有结构化图文字段。\n\n原来的文字仍然保留，并可以在阅读模式中打开。',sourceUrl:new URL('/tests/article-source-fixture.html?legacy=1',location.href).href,sourceTitle:'隔离原网页',tags:[]};
const seeded={id:'qa-reader-old-highlight',type:'highlight',origin:'local',title:'保留原文的位置',body:'保留原文的位置，才能在再次阅读时接上之前的思考。',sourceUrl,sourceTitle:'隔离原网页',sourceCardId:source.id,webAnchor:{version:1,exact:'保留原文的位置，才能在再次阅读时接上之前的思考。',prefix:'',suffix:''},caption:'这是已有高亮，点击可回到正文。',tags:[]};
const session=createWorkspaceSession(createWorkspaceStore(identity));await session.load();
if(!session.state.cards.some(card=>card.id===source.id))await session.commit([{type:'card.upsert',card:source},{type:'card.save',id:source.id,saved:true},{type:'card.upsert',card:legacy},{type:'card.save',id:legacy.id,saved:true},{type:'card.upsert',card:seeded},{type:'card.save',id:seeded.id,saved:true},{type:'draft.set',key:'appearance',value:'light'}]);
if(!location.hash)history.replaceState(null,'','#/card/'+source.id);
function selectQuote(refined=false){
 const text=refined?refinedQuote:quote;
 const body=document.querySelector('.ar-body'),block=body?.querySelector(`[data-article-block="${refined?'qa-second':'qa-first'}"]`);if(!block)return;
 const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node;
 block.scrollIntoView({block:'center',behavior:'auto'});
 while((node=walker.nextNode())){const at=node.nodeValue.indexOf(text);if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+text.length);const selected=getSelection();selected.removeAllRanges();selected.addRange(range);body.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));break;}
}
async function editBody(restore=false){await session.commit(current=>{const card=current.cards.find(item=>item.id===source.id);return workspaceReducer(current,{type:'card.upsert',card:{...card,body:restore?source.body:'这段文字是编辑后的当前正文。\n\n原始图文与原图片仍然保留，切换快照可再次查看。'}});});}
function Fixture(){return <><SublimeWorkspace identity={{id:identity}} items={[]} standalone={false}/><details className="qa-reader-tools" data-mengcang-ui="true"><summary>隔离阅读验收工具</summary><p>独立 identity：{identity}。仅合成数据，不读取或修改桌面资料。长文80段，含编号、嵌套列表和真实表格。</p><button onClick={()=>{location.hash='#/card/'+source.id;}}>打开图文长文章</button><button onClick={()=>selectQuote(false)}>选择长文开头首句</button><button onClick={()=>selectQuote(true)}>改选另一句（保留备注）</button><button onClick={()=>document.querySelector('[data-article-block="qa-structures"]')?.scrollIntoView({block:'start'})}>查看编号与表格</button><button onClick={()=>{location.hash='#/card/'+legacy.id;}}>打开旧文字文章</button><button onClick={()=>editBody(false)}>模拟编辑正文</button><button onClick={()=>editBody(true)}>还原合成正文</button></details></>}
createRoot(document.getElementById('root')).render(<Fixture/>);
const style=document.createElement('style');style.textContent='body{margin:0}.qa-reader-tools{position:fixed;z-index:300;right:18px;bottom:20px;background:#263429;color:#fff;border:1px solid #596e5c;border-radius:12px;padding:12px 16px;font:12px/1.6 system-ui;width:220px;box-shadow:0 8px 30px #0002}.qa-reader-tools summary{cursor:pointer}.qa-reader-tools button{display:block;width:100%;border:1px solid #667b66;background:#354638;color:#fff;border-radius:7px;padding:8px;margin-top:7px;text-align:left;font:inherit;cursor:pointer}.qa-reader-tools p{font-size:11px;color:#b4c3b4}';document.head.append(style);
