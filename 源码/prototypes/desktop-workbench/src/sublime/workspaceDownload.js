export function requestWorkspaceDownload(text,name,type='application/json',env=globalThis){
 const url=env.URL.createObjectURL(new Blob([text],{type})),anchor=env.document.createElement('a');
 let released=false,unsubscribe;
 const release=()=>{if(released)return;released=true;env.URL.revokeObjectURL(url);unsubscribe?.();env.removeEventListener?.('pagehide',release);};
 try{
  // A native save panel can stay open indefinitely; elapsed time is not completion.
  unsubscribe=env.mengcang?.subscribe?.(event=>{if(event.type==='download-finished'&&event.url===url)release();});
  env.addEventListener?.('pagehide',release,{once:true});
  anchor.href=url;anchor.download=name;env.document.body.appendChild(anchor);anchor.click();
 }catch(error){release();throw error;}finally{anchor.remove();}
}
