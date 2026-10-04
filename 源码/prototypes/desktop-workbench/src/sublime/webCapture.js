/** Public-page capture is opt-in and contains no AI or account/session access. */
export async function captureWebPage(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('请填写完整的 HTTP 或 HTTPS 网页链接。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持不含账号密码的 HTTP 或 HTTPS 网页链接。');
  if (globalThis.window?.mengcang?.webCapture) {
    const result = await window.mengcang.webCapture(url.href);
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || '网页采集未完成，请重试。'), {code:result?.error?.code});
    return result.data;
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname)) throw new Error('网页采集需要梦藏桌面版或本机预览服务；当前环境可手动粘贴正文。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch('/__web-capture', {method:'POST', credentials:'omit', headers:{'Content-Type':'application/json', 'X-Mengcang-Capture':'1'}, body:JSON.stringify({url:url.href}), signal:controller.signal});
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw Object.assign(new Error(result?.error?.message || '当前预览服务未提供网页采集；请保留链接并手动填写正文。'), {code:result?.error?.code});
    return result.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('网页采集超时；可以保留链接并手动粘贴正文。');
    throw error;
  } finally { clearTimeout(timer); }
}
