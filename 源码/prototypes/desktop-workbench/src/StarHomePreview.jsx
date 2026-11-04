import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import SublimeWorkspace from './sublime/SublimeWorkspace.jsx';
import {ErrorBoundary} from './ErrorBoundary.jsx';
import './styles.css';

const api={async readingSource(id){const response=await fetch('/__star-preview/book/'+encodeURIComponent(id));const value=await response.json();if(!response.ok)throw Error(value.error||'原书暂不可读取。');return value;}};
function Preview(){
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;fetch('/__star-preview/library').then(r=>{if(!r.ok)throw Error('无法读取本地资料快照。');return r.json();}).then(data=>{if(active)setSnapshot(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 if(!snapshot)return <div style={{padding:64,color:'#ddd',background:'#07090c',minHeight:'100vh'}}>{error||'正在展开你的星空…'}</div>;
 return <><SublimeWorkspace standalone items={snapshot.cards} identity={{id:'star-home-review-20261023'}} api={api}/><div style={{position:'fixed',left:12,bottom:8,zIndex:102,fontSize:9,color:'#7f8792',pointerEvents:'none'}}>本地预览 · 真实资料快照 · {new Date(snapshot.capturedAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</div></>;
}
const previewRoot=import.meta.hot?.data.root||createRoot(document.getElementById('root'));
if(import.meta.hot)import.meta.hot.data.root=previewRoot;
previewRoot.render(<React.StrictMode><ErrorBoundary><Preview/></ErrorBoundary></React.StrictMode>);
