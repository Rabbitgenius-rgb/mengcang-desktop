'use strict';
const {callPrivate}=require('../shared/private-rpc.cjs');
function createFloatAppearanceClient({directory}){
 const call=async(method,params={})=>{if(!directory)throw Error('浮窗尚未连接，请先打开梦藏回看浮窗');try{return await callPrivate({directory,service:'sticky',method,params});}catch(e){if(['SERVICE_UNAVAILABLE','METHOD_NOT_FOUND','CONNECTION_CLOSED'].includes(e.code))throw Error('浮窗尚未连接，请先打开或更新梦藏回看浮窗后重试');throw e;}};
 return {get:()=>call('appearanceGet'),set:value=>call('appearanceSet',value),show:()=>call('appearanceShow')};
}
module.exports={createFloatAppearanceClient};
