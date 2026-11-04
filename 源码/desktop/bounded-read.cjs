'use strict';
async function readBoundedFile(file,{maxBytes,code='FILE_TOO_LARGE',message='文件超过读取上限'}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new TypeError('maxBytes must be a nonnegative safe integer');
 const fail=()=>Object.assign(new Error(message),{code});
 const info=await file.stat();
 if(!info.isFile())throw Object.assign(new Error('只能读取普通文件'),{code:'NOT_A_FILE'});
 if(info.size>maxBytes)throw fail();
 const chunks=[];let size=0;
 while(true){
  const buffer=Buffer.alloc(Math.min(64*1024,maxBytes+1-size));
  const {bytesRead}=await file.read(buffer,0,buffer.length,null);
  if(!Number.isSafeInteger(bytesRead)||bytesRead<0||bytesRead>buffer.length)throw new Error('Invalid file read length');
  if(!bytesRead)break;
  size+=bytesRead;if(size>maxBytes)throw fail();chunks.push(buffer.subarray(0,bytesRead));
 }
 return Buffer.concat(chunks,size);
}
module.exports={readBoundedFile};
