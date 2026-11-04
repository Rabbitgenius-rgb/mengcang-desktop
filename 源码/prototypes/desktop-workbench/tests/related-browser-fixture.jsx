import React from 'react';
import {createRoot} from 'react-dom/client';
import SublimeWorkspace from '../src/sublime/SublimeWorkspace.jsx';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';

const identity='qa-related-browser-20261101-v2',session=createWorkspaceSession(createWorkspaceStore(identity));
function image(){
 const c=document.createElement('canvas');c.width=640;c.height=430;const x=c.getContext('2d');
 x.fillStyle='#e9eee2';x.fillRect(0,0,640,430);x.strokeStyle='#6e846c';x.lineWidth=3;x.beginPath();x.moveTo(195,215);x.lineTo(445,215);x.stroke();
 for(const [cx,label] of [[175,'资料'],[465,'联系']]){x.fillStyle='#fff';x.beginPath();x.arc(cx,215,95,0,Math.PI*2);x.fill();x.fillStyle='#435044';x.font='30px sans-serif';x.fillText(label,cx-30,225);}
 x.font='16px sans-serif';x.fillText('合成图示 · 仅用于隔离验收',30,390);return c.toDataURL('image/png');
}
const pic=image(),source={id:'related-anchor',type:'text',title:'让资料之间产生联系',body:'这是一份合成验收素材。\n\n阅读、收集与重新发现，可以让原本分散的想法产生联系。',sourceUrl:'https://example.org/related-reference'};
const same=Array.from({length:9},(_,i)=>({id:'related-same-'+i,type:i%2?'image':'highlight',title:'同一网页的素材 '+i,body:'合成来源中的不同摘录 '+i,sourceUrl:source.sourceUrl,...(i%2?{image:pic}:{})}));
const topics=['连接想法的白板','留住阅读时的疑问','从图像看见联系','收藏之后的整理','设计研究的线索','旧笔记的新用途','让来源可以追溯','回看与再次发现','将灵感放在一起','知识之间的路径','创作之前的阅读','打开一个新问题','图像也是一种笔记','整理的边界'];
const others=topics.map((title,i)=>({id:'related-other-'+i,title,type:i%3===0?'image':i%3===1?'text':'article',body:'合成验收正文。'+title+'，不只是把材料留在一个地方。\n\n当我们重新翻阅过去的收集，可能会发现之前忽略的联系。卡片应当保留足够的原文和出处，让阅读在这里继续。\n\n每一条资料来自独立来源，切换筛选不会改变已经保存的内容。',sourceTitle:'隔离测试来源 '+(i+1),sourceUrl:'https://example.org/material-'+i,...(i%3===0?{image:pic}:{})}));
source.tags=['信息结构'];for(const card of others)card.tags=['信息结构'];
await session.load();if(!session.state.savedIds.includes(source.id))await session.commit([source,...same,...others].flatMap(card=>[{type:'card.upsert',card},{type:'card.save',id:card.id,saved:true}]).concat([{type:'draft.set',key:'appearance',value:'light'}]));
if(!location.hash)history.replaceState(null,'','#/card/'+source.id);
let embeds=0;const api={intelligenceStatus:async()=>({settings:{nativeEnabled:true},busy:false}),intelligenceRequest:async({action,texts})=>{
 if(action!=='embed')throw Error('fixture allows local embeddings only');embeds++;return {embeddings:texts.map(t=>({id:t.id,model:'isolated-fixture',language:'zh',vector:[1,.25]}))};
}};
function Fixture(){return <><SublimeWorkspace identity={{id:identity}} items={[]} api={api}/><aside style={{position:'fixed',right:18,bottom:20,zIndex:300,padding:'9px 14px',background:'#fff',border:'1px solid #ccd2cc',borderRadius:10,font:'12px/1.6 system-ui',color:'#344034'}}>隔离验收 · 合成资料 · 不读取正式资料库<button onClick={()=>{location.hash='#/card/'+source.id;}}>回到参考卡</button></aside></>}
createRoot(document.getElementById('root')).render(<Fixture/>);
document.body.style.margin='0';
