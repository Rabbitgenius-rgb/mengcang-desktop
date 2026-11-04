import mammoth from 'mammoth/mammoth.browser.js';
import {validateDocxPreviewExpansion,MAX_WORD_PREVIEW_CHARACTERS} from './attachmentPreview.js';
self.onmessage=async event=>{
  try{
    await validateDocxPreviewExpansion(event.data);
    const result=await mammoth.extractRawText({arrayBuffer:event.data}),text=String(result.value || '');
    self.postMessage({ok:true,value:{text:text.slice(0,MAX_WORD_PREVIEW_CHARACTERS),truncated:text.length>MAX_WORD_PREVIEW_CHARACTERS,warnings:(result.messages || []).map(message=>String(message.message || '')).filter(Boolean).slice(0,5)}});
  }
  catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}
};
