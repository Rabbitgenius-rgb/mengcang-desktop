const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {trackWorkspaceDownloads}=require('../desktop/download-lifecycle.cjs');
function fixture(){const session=new EventEmitter(),contents=new EventEmitter(),events=[];contents.mainFrame={};contents.isDestroyed=()=>false;
 trackWorkspaceDownloads(session,contents,(type,data)=>events.push({type,...data}));
 const item=(origin='mengcang://app',url='blob:mengcang://app/export')=>Object.assign(new EventEmitter(),{getInitiatorOrigin:()=>origin,getURL:()=>url});
 return {session,contents,events,item};
}
test('native download completion and cancellation notify only the corresponding blob',()=>{
 const f=fixture();for(const state of ['completed','cancelled','interrupted']){const item=f.item(undefined,'blob:mengcang://app/'+state);f.session.emit('will-download',{},item,f.contents,f.contents.mainFrame);assert.equal(f.events.length,['completed','cancelled','interrupted'].indexOf(state));item.emit('done',{},state);assert.deepEqual(f.events.at(-1),{type:'download-finished',url:'blob:mengcang://app/'+state,state});}
});
test('foreign frames, origins, windows and remote URLs cannot release workspace downloads',()=>{
 const f=fixture();for(const [item,sender,frame] of [[f.item('https://example.com'),f.contents,f.contents.mainFrame],[f.item(),f.contents,{}],[f.item(),{},f.contents.mainFrame],[f.item(undefined,'https://example.com/file'),f.contents,f.contents.mainFrame]]){f.session.emit('will-download',{},item,sender,frame);item.emit('done',{},'completed');}assert.deepEqual(f.events,[]);
});
test('closing the window detaches the download listener and suppresses late completion',()=>{
 const f=fixture(),item=f.item();f.session.emit('will-download',{},item,f.contents,f.contents.mainFrame);f.contents.isDestroyed=()=>true;f.contents.emit('destroyed');assert.equal(f.session.listenerCount('will-download'),0);item.emit('done',{},'completed');assert.deepEqual(f.events,[]);
});
test('an explicitly chosen native path starts the download, while cancellation writes nothing',()=>{
 for(const destination of ['/tmp/selected.json',undefined]){const session=new EventEmitter(),contents=new EventEmitter(),events=[];contents.mainFrame={};contents.isDestroyed=()=>false;
  let chosenName,saved,cancelled=false;const item=Object.assign(new EventEmitter(),{getInitiatorOrigin:()=> 'mengcang://app',getURL:()=> 'blob:mengcang://app/local',getFilename:()=> '备份.json',setSavePath:path=>{saved=path;},cancel:()=>{cancelled=true;item.emit('done',{},'cancelled');}});
  trackWorkspaceDownloads(session,contents,(type,data)=>events.push({type,...data}),name=>{chosenName=name;return destination;});session.emit('will-download',{},item,contents,contents.mainFrame);
  assert.equal(chosenName,'备份.json');assert.equal(saved,destination);assert.equal(cancelled,!destination);if(!destination)assert.equal(events[0].state,'cancelled');
 }
});
