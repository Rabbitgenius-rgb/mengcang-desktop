import JSZip from 'jszip';
export async function epubFixture({version='3',malicious=false,doctype=false,extra={},chapter2Text='第二章：云散月现。另一条中文摘录。'}={}){
  const zip=new JSZip();
  // EPUB requires this to be the first ZIP member, stored without compression.
  // Keep this override even though the remaining book uses DEFLATE.
  zip.file('mimetype','application/epub+zip',{compression:'STORE'});
  zip.file('META-INF/container.xml','<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OPS/package.opf',`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>梦藏 EPUB 中文验收</dc:title><dc:creator>本机合成样本</dc:creator></metadata><manifest><item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="image" href="images/test.png" media-type="image/png"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>`);
  const unsafe=malicious?'<script>window.EPUB_ATTACK=true</script><style>body {background:url(https://evil.test/pixel)}</style><iframe src="https://evil.test/frame"/><svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg><a href="https://evil.test/">远程链接</a><img src="https://evil.test/pixel"/><img src="../../../../secret.png"/><a href="javascript:alert(1)">危险链接</a><p onclick="evil()" style="background:red" class="unsafe">安全正文</p>':'';
  const declaration=doctype?'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">':'';
  zip.file('OPS/text/one.xhtml',`${declaration}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>开篇</title></head><body><h1 id="start">第一章 春日</h1><p>春日的花朵向远方展开。中文摘录与 English café。</p><p><a href="two.xhtml#note">第二章脚注</a></p><ol><li>中国花卉</li><li>作品来源</li></ol><img src="../images/test.png" alt="本机测试图片"/>${unsafe}</body></html>`);
  zip.file('OPS/text/two.xhtml',`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章 月色</h1><p>${chapter2Text}</p><p id="note">脚注：保留原著来源。</p><a href="one.xhtml#start">返回第一章</a></body></html>`);
  if(version==='3')zip.file('OPS/nav.xhtml','<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/one.xhtml#start">开篇 春日</a><ol><li><a href="text/two.xhtml#note">脚注</a></li></ol></li><li><a href="text/two.xhtml">第二章 月色</a></li></ol></nav></body></html>');
  else zip.file('OPS/package.opf',(await zip.file('OPS/package.opf').async('string')).replace(' properties="nav"',''));
  zip.file('OPS/toc.ncx','<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="one"><navLabel><text>第一章 NCX</text></navLabel><content src="text/one.xhtml"/></navPoint><navPoint id="two"><navLabel><text>第二章 NCX</text></navLabel><content src="text/two.xhtml#note"/></navPoint></navMap></ncx>');
  zip.file('OPS/images/test.png',Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cI1sAAAAASUVORK5CYII='),char=>char.charCodeAt(0)));
  for(const [name,value] of Object.entries(extra))zip.file(name,value);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
