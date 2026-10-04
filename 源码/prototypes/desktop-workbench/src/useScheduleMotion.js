import {useCallback,useEffect,useLayoutEffect,useRef} from 'react';

const rectOf = node => {
  const r=node.getBoundingClientRect();
  return {left:r.left,top:r.top,width:r.width,height:r.height};
};
const keyOf = node => `${node.dataset.scheduleId}:${node.dataset.scheduleLocation}`;
function visibleCards(root) {
  return [...(root?.querySelectorAll('[data-schedule-id][data-schedule-location]') || [])]
    .filter(node=>node.getClientRects().length && node.getBoundingClientRect().width>0);
}

// A user action captures the old geometry; the next changed layout carries the
// same card into its new location. Saves never wait for the visual transition.
export function useScheduleMotion(rootRef,reducedMotion=false) {
  const pending=useRef(null),animations=useRef(new Set()),carriers=useRef(new Set()),reduced=useRef(reducedMotion);
  reduced.current=reducedMotion;
  const stop=useCallback(()=>{pending.current=null;for(const a of animations.current)a.cancel();animations.current.clear();for(const node of carriers.current)node.remove();carriers.current.clear();},[]);
  const capture=useCallback(()=>{
    if(reduced.current || document.hidden)return;
    pending.current={at:performance.now(),cards:visibleCards(rootRef.current).map(node=>({id:node.dataset.scheduleId,location:node.dataset.scheduleLocation,key:keyOf(node),rect:rectOf(node)}))};
  },[rootRef]);
  useEffect(()=>{
    const pause=()=>{if(document.hidden)stop();};
    document.addEventListener('visibilitychange',pause);
    return()=>{document.removeEventListener('visibilitychange',pause);stop();};
  },[stop]);
  useLayoutEffect(()=>{
    if(reducedMotion){stop();return;}
    const before=pending.current;if(!before)return;
    if(performance.now()-before.at>2500){pending.current=null;return;}
    const nodes=visibleCards(rootRef.current),oldByKey=new Map(before.cards.map(card=>[card.key,card]));
    let changed=nodes.length!==before.cards.length;
    const transitions=[];
    for(const node of nodes) {
      const next=rectOf(node),exact=oldByKey.get(keyOf(node));
      const old=exact || before.cards.find(card=>card.id===node.dataset.scheduleId && card.location!=='detail');
      if(!old)continue;
      const dx=old.rect.left-next.left,dy=old.rect.top-next.top;
      if(Math.abs(dx)<1 && Math.abs(dy)<1 && Math.abs(old.rect.width-next.width)<1 && Math.abs(old.rect.height-next.height)<1)continue;
      changed=true;
      if(typeof node.animate!=='function')continue;
      const isDetail=node.dataset.scheduleLocation==='detail';
      // Large inspector forms stay readable while the heading follows the card.
      const from=isDetail?{transform:`translate(${Math.max(-36,Math.min(36,dx))}px,${Math.max(-24,Math.min(24,dy))}px)`,opacity:.25}
        :{transform:`translate(${dx}px,${dy}px) scale(${old.rect.width/next.width},${old.rect.height/next.height})`,opacity:.85};
      transitions.push([node,from,isDetail?260:420,!exact && !isDetail,next]);
    }
    if(!changed)return;
    pending.current=null;
    for(const [node,from,duration,travelling,next] of transitions) {
      let target=node;
      if(travelling){
        target=node.cloneNode(true);
        target.removeAttribute('data-schedule-id');target.removeAttribute('data-schedule-location');target.removeAttribute('aria-pressed');
        target.setAttribute('aria-hidden','true');target.tabIndex=-1;target.inert=true;
        const style=getComputedStyle(node);
        Object.assign(target.style,{position:'fixed',left:`${next.left}px`,top:`${next.top}px`,width:`${next.width}px`,height:`${next.height}px`,margin:'0',zIndex:'90',pointerEvents:'none',font:style.font,color:style.color,backgroundColor:style.backgroundColor,overflow:'hidden',transition:'none'});
        document.body.append(target);carriers.current.add(target);
        const reveal=node.animate([{opacity:0},{opacity:0,offset:.8},{opacity:1}],{duration});
        animations.current.add(reveal);reveal.finished.catch(()=>{}).finally(()=>animations.current.delete(reveal));
      }
      const animation=target.animate([{...from,transformOrigin:'top left'},{transform:'none',opacity:1,transformOrigin:'top left'}],{duration,easing:'cubic-bezier(.22,1,.36,1)'});
      animations.current.add(animation);
      animation.finished.catch(()=>{}).finally(()=>{animations.current.delete(animation);if(travelling){target.remove();carriers.current.delete(target);}});
    }
  });
  return capture;
}
