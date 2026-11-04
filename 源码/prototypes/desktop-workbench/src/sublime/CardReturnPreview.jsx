import React,{useEffect,useState} from 'react';
import {relatedCardPreview} from './relatedBrowser.js';
export default function CardReturnPreview({card,root}){
 const [visible,setVisible]=useState(false),preview=relatedCardPreview(card);
 useEffect(()=>{
  setVisible(false);const container=root.current,target=container?.querySelector('.sw-detail-card');
  if(!target||typeof IntersectionObserver!=='function')return;
  const observer=new IntersectionObserver(([entry])=>setVisible(!entry.isIntersecting&&entry.boundingClientRect.bottom<=110),{root:container,rootMargin:'-100px 0px 0px 0px'});
  observer.observe(target);return()=>observer.disconnect();
 },[card.id,root]);
 if(!visible)return null;
 return <button className="sw-current-preview" type="button" aria-label={'回到当前资料：'+card.title} title={'回到当前资料：'+card.title} onClick={()=>{const target=root.current?.querySelector('.sw-detail-card');if(target)root.current.scrollTo({top:root.current.scrollTop+target.getBoundingClientRect().top-root.current.getBoundingClientRect().top-115,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}}>{preview.image?<img src={preview.image} alt="当前资料缩略图"/>:<span>{preview.text||card.title}</span>}</button>;
}
