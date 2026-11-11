// Synthetic preview data for the frontend redesign. Not part of the desktop build entry.
import React from 'react';
import {createRoot} from 'react-dom/client';
import SublimeWorkspace from '../src/sublime/SublimeWorkspace.jsx';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import '../src/workspaceReset.css';

const identity='qa-redesign-preview-20261105-v6',session=createWorkspaceSession(createWorkspaceStore(identity));
const img=async name=>{const blob=await (await fetch('/assets/inspiration-'+name)).blob();return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});};
const raw=[
 {id:'rd-1',type:'article',title:'为什么卡片笔记比文件夹更耐用',body:'卢曼的卡片盒并不依赖分类，而是依赖卡片之间的链接。\n\n每一张卡片只写一个想法，并用编号指向上下文。时间久了，系统会长出意料之外的路径。',sourceTitle:'少数派',sourceUrl:'https://example.org/zettel',image:img('article-DNTtDhJZ.avif'),tags:['写作','方法']},
 {id:'rd-2',type:'highlight',title:'摘录 · 《设计中的设计》',body:'设计不是一种技能，而是捕捉事物本质的感觉和洞察力。',sourceTitle:'原研哉',tags:['设计']},
 {id:'rd-3',type:'image',title:'京都町屋的格子窗',body:'光线被木格切成细条，室内一直保持柔和的明暗。',image:img('image-DJx0yAgh.avif'),sourceTitle:'自拍 · 京都',tags:['建筑','光']},
 {id:'rd-4',type:'text',title:'今天的想法',body:'资料库不该只是仓库，应该能在打开时提醒我：上周收下的东西和今天的问题有关。',tags:['产品']},
 {id:'rd-5',type:'link',title:'Are.na — 一个慢速的互联网',body:'把收藏变成频道，频道之间可以互相引用。',sourceTitle:'are.na',sourceUrl:'https://www.are.na',image:img('website-DQCABkUC.avif'),tags:['参考']},
 {id:'rd-6',type:'audio',title:'播客片段 · 关于注意力',body:'主持人提到：注意力不是被偷走的，而是被我们分配出去的。',sourceTitle:'忽左忽右',image:img('audio-BQ4iBmk-.avif'),tags:['注意力']},
 {id:'rd-7',type:'highlight',title:'摘录 · 《写作这回事》',body:'如果你没有时间阅读，你就没有时间（也没有工具）写作。',sourceTitle:'斯蒂芬·金',image:img('highlight-CJ83Yr0g.avif'),tags:['写作']},
 {id:'rd-8',type:'text',title:'待整理：排版笔记',body:'中文正文 15–16px，行高 1.75；英文混排时数字与西文两侧留空。',image:img('text-BCUMTc7F.avif'),tags:['排版']},
 {id:'rd-9',type:'article',title:'Bear 的编辑器为什么让人愿意写',body:'它把 Markdown 符号淡化成灰色，正文成为唯一主角。工具栏只在需要时出现。',sourceTitle:'Medium',sourceUrl:'https://example.org/bear',tags:['写作','工具']},
 {id:'rd-10',type:'link',title:'Readwise Reader',body:'高亮、标签、回顾，三件事放在同一个阅读器里。',sourceTitle:'readwise.io',sourceUrl:'https://readwise.io/read',tags:['工具','阅读']},
];
let seq=0;const receipt=(n,day)=>({requestId:'00000000-0000-4000-8000-00000000000'+n,payloadHash:String(n).repeat(64),savedAt:'2026-11-0'+day+'T09:00:00.000Z'});const thread=(sessionId,sessionTitle)=>({version:1,provider:'deepseek-harness',instanceId:'fixture',sessionId,messageId:'m'+(++seq),eventSeq:seq,turn:seq,sessionTitle});
raw.push(
 {id:'rc-1',type:'highlight',title:'注意力是一种分配',body:'注意力不是被偷走的，而是被我们分配出去的。\n\n如果把打开手机看作一次支出，就能开始记账。',recallReceipt:receipt(1,3),externalSource:thread('s1','和 AI 聊注意力管理')},
 {id:'rc-2',type:'highlight',title:'卡片之间的链接比分类更重要',body:'卢曼的卡片盒依赖卡片之间的链接，而不是目录。',recallReceipt:receipt(2,2),externalSource:thread('s2','卡片笔记方法')},
 {id:'rc-3',type:'highlight',title:'写作前先读',body:'如果你没有时间阅读，你就没有时间写作。',recallReceipt:receipt(3,1),externalSource:thread('s2','卡片笔记方法')},
);
const cards=await Promise.all(raw.map(async (c,i)=>({...c,createdAt:new Date(Date.UTC(2026,9,30-i*2,8)).toISOString(),...(c.image?{image:await c.image}:{})})));
await session.load();
if(!session.state.savedIds.includes('rd-1'))await session.commit(cards.flatMap(card=>[{type:'card.upsert',card},{type:'card.save',id:card.id,saved:true}]));
const api={intelligenceStatus:async()=>({settings:{},busy:false})};
createRoot(document.getElementById('root')).render(<SublimeWorkspace identity={{id:identity}} items={[]} api={api}/>);
