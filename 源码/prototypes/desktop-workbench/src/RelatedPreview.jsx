import React,{useEffect,useRef,useState} from 'react';
import {IconX,IconArrowLeft,IconArrowRight,IconExternalLink} from '@tabler/icons-react';
import {Art} from './common.jsx';
import MarkdownContent from './MarkdownContent.jsx';
import {notePresentation} from './notePresentation.js';
import {normalizeRecord,readableError,valueOf} from './desktopModel.js';

export default function RelatedPreview({path,records,api,connected,onClose,onOpen,onPreview,canBack,onBack}) {
  const known=records.find(item=>item.path===path),[loaded,setLoaded]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),closeRef=useRef(null);
  useEffect(()=>{const previous=document.activeElement;closeRef.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  useEffect(()=>{let active=true;setLoaded(null);setError('');setLoading(connected);if(connected)api.readNote(path).then(valueOf).then(result=>{if(active)setLoaded(normalizeRecord(result.note || result,api));}).catch(e=>{if(active)setError(readableError(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,connected,api]);
  const item=loaded || known,body=item?notePresentation(item.raw || item):{};
  async function openSource(method){try{valueOf(await api[method](path));}catch(e){setError(readableError(e));}}
  return <aside className="desktop-related-preview" aria-label="相关内容预览"><header><div><button className="icon-btn" disabled={!canBack} aria-label="返回上一份预览" onClick={onBack}><IconArrowLeft size={17}/></button><span>相关内容预览</span></div><button ref={closeRef} className="icon-btn" aria-label="关闭预览，回到原笔记" onClick={onClose}><IconX size={19}/></button></header><div className="desktop-preview-scroll" key={path}>
    {loading&&<p className="desktop-draft-status" role="status">正在读取最新内容…</p>}{error&&<p className="desktop-inline-warning" role="status">{error}{known?' 下方保留已读取版本。':''}</p>}
    {item?<><span className="eyebrow">{item.kind==='entry'?'灵感':item.kind==='book'?'藏书':'素材笔记'}</span><h2>{item.title}</h2>{item.assetUrl&&<Art real src={item.assetUrl} alt={item.title}/>}<div className="collections-tags">{item.tags?.map(tag=><span className="chip" key={tag}>{tag}</span>)}</div>{body.caption&&<p className="desktop-preview-caption">{body.caption}</p>}<MarkdownContent text={body.body || ''} onNavigate={onPreview}/>{body.rawShare&&<details className="materials-share"><summary>原始分享文字</summary><MarkdownContent text={body.rawShare}/></details>}<div className="desktop-preview-sources"><button className="text-btn" onClick={()=>openSource('openNote')}>在 Obsidian 中打开<IconExternalLink size={13}/></button>{item.raw?.url&&<button className="text-btn" onClick={()=>openSource('openSourceLink')}>查看原链接<IconExternalLink size={13}/></button>}{(item.raw?.attachmentPath||item.raw?.originalPath)&&item.kind!=='web'&&<button className="text-btn" onClick={()=>openSource('openOriginal')}>{item.kind==='book'?'打开原书':'查看原图'}<IconExternalLink size={13}/></button>}</div></>:!loading&&!error&&<p className="desktop-inline-warning">这份内容尚未缓存，请连接 Obsidian 后重试。</p>}
  </div><footer><span>原笔记仍在当前工作区</span><button className="btn btn-primary" onClick={()=>onOpen(path)}>完整打开<IconArrowRight size={14}/></button></footer></aside>;
}
