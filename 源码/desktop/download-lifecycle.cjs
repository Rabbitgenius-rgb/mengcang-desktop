'use strict';
function trackWorkspaceDownloads(session,contents,notify,choosePath){
 const track=(_event,item,sender,frame)=>{
  if(sender!==contents||(frame&&frame!==contents.mainFrame)||item.getInitiatorOrigin()!=='mengcang://app')return;
  const url=item.getURL();if(!url.startsWith('blob:mengcang://app/'))return;
  item.once('done',(_event,state)=>{if(!contents.isDestroyed())notify('download-finished',{url,state});});
  if(choosePath){const destination=choosePath(item.getFilename());if(destination)item.setSavePath(destination);else item.cancel();}
 };
 session.on('will-download',track);
 contents.once('destroyed',()=>session.removeListener('will-download',track));
}
module.exports={trackWorkspaceDownloads};
