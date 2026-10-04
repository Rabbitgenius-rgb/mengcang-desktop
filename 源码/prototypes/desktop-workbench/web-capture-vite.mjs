import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {captureWebPage} = require('../../desktop/web-capture.cjs');
const {previewNativeAttachment} = require('../../desktop/native-file-preview.cjs');

export function captureMiddleware(capture = captureWebPage, {maxInputBytes=8192, wholeValue=false}={}) {
  return async (req,res) => {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const send = (status, value) => {res.statusCode=status;res.end(JSON.stringify(value));};
    const host = String(req.headers.host || '');
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host) || req.headers.origin !== `http://${host}` || req.headers['x-mengcang-capture'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') return send(403,{ok:false,error:{code:'FORBIDDEN',message:'网页采集仅接受本机界面的显式请求。'}});
    if (req.method !== 'POST' || !String(req.headers['content-type'] || '').startsWith('application/json')) return send(405,{ok:false,error:{code:'INVALID_REQUEST',message:'请从网页采集按钮提交链接。'}});
    let timer;
    try {
      const raw = await new Promise((resolve,reject) => {
        const chunks=[];let length=0;
        timer=setTimeout(()=>reject(new Error('请求输入超时。')),5000);
        req.on('data',chunk=>{length+=chunk.length;if(length>maxInputBytes)reject(new Error('请求超出大小限制。'));else chunks.push(chunk);});
        req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error',reject);
      });
      clearTimeout(timer);
      const value=JSON.parse(raw);
      const data=await capture(wholeValue?value:value.url);
      send(200,{ok:true,data});
    } catch(error) {send(400,{ok:false,error:{code:error.code || 'WEB_CAPTURE_FAILED',message:error.message || '网页采集未完成。'}});}
    finally {clearTimeout(timer);}
  };
}

export default function webCaptureVite() {
  const install=server=>{server.middlewares.use('/__web-capture',captureMiddleware());server.middlewares.use('/__file-preview',captureMiddleware(previewNativeAttachment,{maxInputBytes:90*1024*1024,wholeValue:true}));};
  return {name:'local-public-web-capture',configureServer:install,configurePreviewServer:install};
}
