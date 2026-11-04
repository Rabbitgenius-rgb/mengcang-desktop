import React,{useEffect,useRef,useState} from 'react';
import {IconPalette,IconCheck,IconArrowUpRight,IconRefresh,IconMessageCircle,IconFileText,IconBulb} from '@tabler/icons-react';
import {FLOAT_PRESETS,DEFAULT_FLOAT_APPEARANCE,presetAppearance,normalizeFloatAppearance,floatCSS} from '../../../../shared/float-appearance.mjs';
import {valueOf} from '../desktopModel.js';
import './floatStyleLibrary.css';
const key='mengcang-float-style-preview-v1';
function demoStyle(){try{return normalizeFloatAppearance(JSON.parse(localStorage.getItem(key)));}catch{return {...DEFAULT_FLOAT_APPEARANCE};}}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export default function FloatStyleLibrary({api,demo}){
 const [saved,setSaved]=useState(null),[draft,setDraft]=useState(DEFAULT_FLOAT_APPEARANCE),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[issue,setIssue]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),mounted=useRef(true);
 async function load(){setLoading(true);setIssue('');try{const result=demo?demoStyle():valueOf(await api.floatAppearanceGet());if(mounted.current){setSaved(result);setDraft(result);}}catch(e){if(mounted.current)setIssue(e.message||'未能连接浮窗');}finally{if(mounted.current)setLoading(false);}}
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[api,demo]);
 function change(next){setDraft(current=>({...current,...next,preset:'custom'}));setNotice('');}
 async function apply(){if(lock.current)return;lock.current=true;setBusy(true);setIssue('');setNotice('');try{const next=normalizeFloatAppearance(draft);let result;if(demo){localStorage.setItem(key,JSON.stringify(next));result=next;}else result=valueOf(await api.floatAppearanceSet(next));if(mounted.current){setSaved(result);setDraft(result);setNotice(demo?'已保存预览风格；桌面版会应用到真实浮窗。':'已应用到浮窗，重启后仍会保留。');}}catch(e){if(mounted.current)setIssue(e.message||'应用失败，调整仍保留在页面中');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 async function show(){setIssue('');try{if(demo){setNotice('右侧是浮窗样式预览；桌面版可直接打开真实浮窗。');return;}valueOf(await api.floatAppearanceShow());}catch(e){setIssue(e.message||'未能打开浮窗');}}
 const dirty=saved&&!equal(saved,draft),activeName=FLOAT_PRESETS.find(p=>p.id===saved?.preset)?.name||'自定义风格';
 return <main className="rw-styles">
  <header className="rw-page-header"><div className="rw-title-group"><IconPalette size={21} stroke={1.6}/><h1>风格库</h1></div><button className="rw-secondary" onClick={()=>void show()} disabled={loading||busy}>查看浮窗<IconArrowUpRight size={15}/></button></header>
  <div className="rw-style-heading"><div><h2>让浮窗，成为你喜欢的样子。</h2><p>选一种风格，或从颜色与细节开始调整。</p></div><span className="rw-style-current">当前使用 <b>{saved?activeName:'尚未连接'}</b></span></div>
  {issue&&<div className="rw-style-error" role="alert"><span>{issue}</span>{!saved&&<button className="rw-text-button" onClick={()=>void load()} disabled={loading}><IconRefresh size={14}/>重新连接</button>}</div>}
  <div className="rw-style-layout">
   <section className="rw-style-options" aria-label="浮窗风格设置">
    <h3>预设风格</h3><div className="rw-style-presets" role="group" aria-label="预设风格">{FLOAT_PRESETS.map(p=><button key={p.id} className={`rw-style-preset ${draft.preset===p.id?'selected':''}`} aria-pressed={draft.preset===p.id} disabled={loading||busy} onClick={()=>{setDraft(presetAppearance(p.id));setNotice('');}} title={p.description}><span className="rw-style-swatch" style={{background:p.background,color:p.text}}><span>Aa</span><i style={{background:p.accent}}/></span><span>{p.name}</span>{draft.preset===p.id&&<IconCheck className="rw-preset-check" size={13}/>}</button>)}</div>
    <div className="rw-style-section-title"><h3>自由调整</h3><span>先预览，再应用</span></div>
    <fieldset disabled={loading||busy} className="rw-style-fields">
     <div className="rw-style-colors">{[['background','背景颜色'],['text','文字颜色'],['accent','强调颜色']].map(([id,label])=><label key={id}>{label}<span><input type="color" aria-label={label} value={draft[id]} onChange={e=>change({[id]:e.target.value})}/><code>{draft[id].toUpperCase()}</code></span></label>)}</div>
     <label className="rw-style-slider"><span>背景不透明度<output>{draft.opacity}%</output></span><input type="range" min="20" max="100" step="1" aria-label="背景不透明度" value={draft.opacity} onChange={e=>change({opacity:Number(e.target.value)})}/><small>只调整背景，文字保持清晰。</small></label>
     <label className="rw-style-slider"><span>圆角<output>{draft.radius}px</output></span><input type="range" min="0" max="28" step="1" aria-label="浮窗圆角" value={draft.radius} onChange={e=>change({radius:Number(e.target.value)})}/></label>
     <label className="rw-style-shadow"><span>浮窗阴影<small>让浮窗与桌面有一点距离</small></span><input type="checkbox" role="switch" aria-label="浮窗阴影" checked={draft.shadow} onChange={e=>change({shadow:e.target.checked})}/></label>
    </fieldset>
    <footer className="rw-style-actions"><button className="rw-secondary" disabled={!dirty||loading||busy} onClick={()=>{setDraft(saved);setNotice('');}}>还原调整</button><button className="rw-primary" disabled={!saved||!dirty||loading||busy} onClick={()=>void apply()}>{busy?'正在应用…':'应用到浮窗'}<IconCheck size={15}/></button></footer>
    <p className="rw-style-feedback" role="status">{loading?'正在读取浮窗风格…':notice||(dirty?'有尚未应用的调整':'风格保存在本机，对浮窗和贴出的便签生效。')}</p>
   </section>
   <aside className="rw-style-preview-column" aria-label="浮窗样式预览"><div className="rw-style-preview-label"><span>样式预览</span><small>示例内容</small></div><div className="rw-style-desktop"><div className="rw-style-desktop-line"/><div className="rw-float-mock" style={floatCSS(draft)}><div className="rw-float-caption"><span>对话脉络</span><span>共 3 条标记</span></div><h3>关于阅读与生活的思考</h3><div className="rw-float-mock-row"><IconFileText size={18}/><span>给阅读留一点空白</span><i/></div><div className="rw-float-mock-row"><IconBulb size={18}/><span>让想法慢慢生长</span><i/></div><div className="rw-float-mock-row"><IconMessageCircle size={18}/><span>回看，获得新的理解</span></div><div className="rw-float-status"><span/>已连接</div></div><div className="rw-style-note-mock" style={floatCSS(draft)}><strong>留给下一次的想法</strong><p>有些连接，会在重读时出现。</p><span>跳回原对话 ↗</span></div></div><p className="rw-style-preview-hint">真实浮窗会透出你当前的桌面背景。</p></aside>
  </div>
 </main>;
}
