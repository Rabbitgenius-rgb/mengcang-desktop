/** Explicit local preview; the original attachment remains untouched. */
export async function previewNativeAttachment(attachment) {
  if (globalThis.window?.mengcang?.nativeFilePreview) {
    const result=await window.mengcang.nativeFilePreview(attachment);
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || '附件预览未完成，原文件仍可下载。'),{code:result?.error?.code});
    return result.data;
  }
  if (!['localhost','127.0.0.1','[::1]'].includes(globalThis.location?.hostname)) throw new Error('此预览需要 macOS 梦藏桌面版或本机服务，原文件仍可下载。');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await fetch('/__file-preview',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Mengcang-Capture':'1'},body:JSON.stringify(attachment),signal:controller.signal});
    const result=await response.json().catch(()=>null);
    if (!response.ok || !result?.ok) throw Object.assign(new Error(result?.error?.message || '当前环境无法预览此附件，原文件仍可下载。'),{code:result?.error?.code});
    return result.data;
  } catch(error) {if(error.name==='AbortError')throw new Error('本机预览超时，原文件仍可下载。');throw error;}
  finally {clearTimeout(timer);}
}
