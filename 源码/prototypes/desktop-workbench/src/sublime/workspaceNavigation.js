const stateKey='mengcangSublimeNavigation';
export function workspaceRouteHash(route){
 return `#/${route.page}${route.id?'/'+encodeURIComponent(route.id):''}${route.page==='card'&&Number(route.sourcePage)>1?'?page='+Number(route.sourcePage):''}`;
}
export function readWorkspaceNavigation(state,identity,hash){
 const saved=state?.[stateKey];
 return saved?.identity===identity&&saved.hash===hash?structuredClone(saved):null;
}
export function createWorkspaceNavigation({history,location,identity,snapshot,restore,fallback,safeFallback=()=>({route:{page:'library',id:'',sourcePage:1},filters:{},shuffle:0,collectionQuery:'',selected:[],selectionMode:false})}){
 function record(){
  const saved=readWorkspaceNavigation(history.state,identity,location.hash);
  const entry={...structuredClone(snapshot()),identity,hash:location.hash,canGoBack:saved?.canGoBack||false};
  history.replaceState({...history.state,[stateKey]:entry},'');
  return entry;
 }
 function open(route,overrides={}){
  const current=record(),hash=workspaceRouteHash(route);
  if(hash===location.hash&&!Object.keys(overrides).length)return;
  const next={...current,...structuredClone(overrides),route,selected:[],selectionMode:false,scrollTop:0,scrollLeft:0,hash,canGoBack:true};
  history.pushState({...history.state,[stateKey]:next},'',hash);restore(next);
 }
 function restoreCurrent(){
  const foreign=history.state?.[stateKey];
  if(foreign?.identity&&foreign.identity!==identity){const safe={...safeFallback(),identity,scrollTop:0,scrollLeft:0,canGoBack:false};safe.hash=workspaceRouteHash(safe.route);history.replaceState({...history.state,[stateKey]:safe},'',safe.hash);restore(safe);return;}
  const entry=readWorkspaceNavigation(history.state,identity,location.hash);restore(entry||{...snapshot(),route:fallback(),selected:[],selectionMode:false,scrollTop:0,scrollLeft:0,canGoBack:false});
 }
 function back(){const current=record();if(current.canGoBack)history.back();else open({page:'library',id:'',sourcePage:1});}
 return {record,open,back,restoreCurrent};
}
