import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {rejectAiRequest}=require('../../desktop/ai-policy.cjs');
export default function discoveryVite(){return {name:'local-discovery-ai-disabled',configureServer(server){server.middlewares.use('/__discovery/analyze',(_req,res)=>{
 res.statusCode=403;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 try{rejectAiRequest();}catch(error){res.end(JSON.stringify({error:error.message,code:error.code}));}
 });}};}
