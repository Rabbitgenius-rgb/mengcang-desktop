import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getDocument,PDFDataRangeTransport} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {clampPdfPage,pdfBookOptions,createPdfBookSource,pdfReaderViewport,pdfTextMatches,pdfSearchSegments,searchPdfDocument,PdfSearchCancelled,pdfReaderOutline,pdfDestinationPage,pdfSelection,pdfSafeLink,pdfLinkRect,pdfKeyboardPagingAllowed} from '../src/reader/pdfReaderModel.js';

test('native PDF source uses only an opaque local grant with range loading and scripting disabled',()=>{
 const options=pdfBookOptions({url:'mengcang-reader://source/a_b-123'},'/pdf-assets/');assert.equal(options.disableAutoFetch,true);assert.equal(options.disableStream,true);assert.equal(options.rangeChunkSize,256*1024);assert.equal(options.isEvalSupported,false);assert.equal(options.enableXfa,false);
 for(const url of ['https://example.com/book.pdf','file:///private/book.pdf','mengcang-reader://other/abc','mengcang-reader://source/abc?path=/private','mengcang-reader://source/a/b','mengcang-reader://source/../path'])assert.throws(()=>pdfBookOptions({url}),/本机图书/);
});
test('workspace PDF bytes stay exact and source remains unchanged',()=>{
 const data=Buffer.from('%PDF-1.7 exact original'),source={sourceKey:'card:file',name:'原件.pdf',type:'application/pdf',size:data.length,dataUrl:'data:application/pdf;base64,'+data.toString('base64')},before=structuredClone(source);
 assert.deepEqual(Buffer.from(pdfBookOptions(source).data),data);assert.deepEqual(source,before);
 assert.throws(()=>pdfBookOptions({...source,size:data.length+1}),/大小|字节数/);
});
test('page locations and canvas size are bounded while width/whole-page fits differ',()=>{
 assert.equal(clampPdfPage(0,24),1);assert.equal(clampPdfPage(99,24),24);assert.equal(clampPdfPage('3.9',24),3);assert.equal(clampPdfPage(NaN,24),1);
 const page={getViewport:({scale})=>({width:600*scale,height:900*scale,scale})},width=pdfReaderViewport(page,{width:1200,height:700},1,'width',2),whole=pdfReaderViewport(page,{width:1200,height:700},1,'page',2),large=pdfReaderViewport(page,{width:4000,height:700},3,'width',2);
 assert.ok(width.viewport.height>whole.viewport.height);assert.ok(whole.viewport.height<=660);assert.ok(large.width*large.height<=6000000);
});
test('full search reaches pages and text beyond the old preview limits without a silent partial index',async()=>{
 const read=[],progress=[];const pdf={numPages:2003,getPage:async page=>{read.push(page);return {getTextContent:async()=>({items:[{str:page===2003?'z'.repeat(1000005)+' FINAL 中文终章':'usual'}]}),cleanup(){}};}};
 const result=await searchPdfDocument(pdf,'中文终章',{onPage:item=>progress.push(item.page),yieldControl:async()=>{}});
 assert.equal(read.length,2003);assert.deepEqual(result.matches,[{page:2003,offset:1000012,length:4}]);assert.equal(result.searchedPages,2003);assert.equal(progress.at(-1),2003);
});
test('a cancelled search cannot publish a page that completed after cancellation',async()=>{
 let cancel=false,release,events=[];const gate=new Promise(resolve=>release=resolve);
 const job=searchPdfDocument({numPages:2,getPage:async()=>({getTextContent:async()=>{await gate;return {items:[{str:'hit'}]};}})},'hit',{cancelled:()=>cancel,onPage:value=>events.push(value),yieldControl:async()=>{}});
 cancel=true;release();await assert.rejects(job,PdfSearchCancelled);assert.deepEqual(events,[]);
});
test('literal matching preserves Unicode source offsets and cross-run highlight text',()=>{
 const text='🙂 İ and ORIGIN, origin. <b> [x].';assert.deepEqual(pdfTextMatches(text,'origin',7).map(item=>item.offset),[9,17]);assert.equal(pdfTextMatches(text,'[x].').length,1);
 const content={items:[{type:'beginMarkedContent'},{str:'a quiet '},{str:'ori'},{str:'gin'}]},segments=pdfSearchSegments(content,'origin',8);
 assert.equal(segments.flat().filter(part=>part.matched).map(part=>part.text).join(''),'origin');assert.equal(segments.flat().filter(part=>part.active).map(part=>part.text).join(''),'origin');assert.equal(segments.flat().map(part=>part.text).join(''),'a quiet origin');
});
test('real PDF parser search reads its text and obtains its true page count without OCR',async()=>{
 const bytes=await fs.readFile(new URL('../../../tests/fixtures/discovery-excerpt.pdf',import.meta.url));
 const task=getDocument({...pdfBookOptions({name:'fixture.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')},fileURLToPath(new URL('../node_modules/pdfjs-dist/',import.meta.url))),useSystemFonts:false});
 try{const pdf=await task.promise,result=await searchPdfDocument(pdf,'quiet',{yieldControl:async()=>{}});assert.equal(result.searchedPages,pdf.numPages);assert.ok(result.matches.length>0);assert.equal(result.matches[0].page,1);}finally{await task.destroy();}
});
test('nested outline resolves named and explicit destinations while malformed entries remain readable',async()=>{
 const pdf={numPages:10,getOutline:async()=>[{title:'第一章',dest:'one',items:[{title:'小节',dest:[{num:8},'Fit']}]},{title:'失效书签',dest:'missing'}],getDestination:async value=>value==='one'?[0,'Fit']:null,getPageIndex:async ref=>ref.num-1};
 const outline=await pdfReaderOutline(pdf);assert.equal(outline[0].page,1);assert.equal(outline[0].children[0].page,8);assert.equal(outline[1].page,null);assert.equal(await pdfDestinationPage(pdf,[10]),null);
});
test('selection belongs to this page, clips normalized rectangles and never truncates oversized text',()=>{
 const node={},layer={contains:item=>item===node,getBoundingClientRect:()=>({left:10,top:20,width:100,height:100})},selection={isCollapsed:false,rangeCount:1,toString:()=> '原始选文\n',getRangeAt:()=>({startContainer:node,endContainer:node,getClientRects:()=>[{left:0,top:30,width:200,height:20}]})};
 assert.deepEqual(pdfSelection(selection,layer,4),{text:'原始选文\n',locator:{page:4,rects:[{x:0,y:.1,width:1,height:.19999999999999998}]},label:'第 4 页'});
 assert.equal(pdfSelection({...selection,getRangeAt:()=>({...selection.getRangeAt(),endContainer:{}})},layer,4),null);assert.throws(()=>pdfSelection({...selection,toString:()=> 'x'.repeat(100001)},layer,4),/缩小选区/);
});
test('PDF links reject executable/local URLs and keyboard shortcuts leave editing and focused controls alone',()=>{
 assert.equal(pdfSafeLink('https://example.com/a'),'https://example.com/a');for(const url of ['javascript:alert(1)','file:///private/a','data:text/html,evil','ftp://example.com'])assert.equal(pdfSafeLink(url),null);
 const viewport={width:100,height:200,convertToViewportRectangle:()=>[10,20,50,60]};assert.deepEqual(pdfLinkRect([1,2,3,4],viewport),{x:.1,y:.1,width:.4,height:.2});assert.equal(pdfLinkRect([NaN,2,3,4],viewport),null);
 assert.equal(pdfKeyboardPagingAllowed({target:{closest:()=>null}}),true);assert.equal(pdfKeyboardPagingAllowed({target:{closest:()=>({})}}),false);assert.equal(pdfKeyboardPagingAllowed({ctrlKey:true,target:{closest:()=>null}}),false);
});

test('custom-scheme range bridge requests only the initial chunk and demanded ranges, then aborts pending reads',async()=>{
 const length=2000000,requests=[],failures=[],events=[];let pending;
 class Transport{constructor(length,initial,done,name){Object.assign(this,{length,initial,done,name});}onDataRange(begin,bytes){events.push({begin,length:bytes.length});}}
 const fetcher=async(url,options)=>{
  requests.push(options);if(options.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Length':String(length),'Accept-Ranges':'bytes'}});
  const [,begin,end]=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range).map(Number);
  if(begin===999999)return new Promise((_resolve,reject)=>{pending=options.signal;options.signal.addEventListener('abort',()=>reject(Error('intentional abort')));});
  return new Response(new Uint8Array(end-begin+1),{status:206,headers:{'Content-Range':`bytes ${begin}-${end}/${length}`,'Content-Length':String(end-begin+1)}});
 };
 const loader=createPdfBookSource({name:'large.pdf',size:length,url:'mengcang-reader://source/abc'},{RangeTransport:Transport,fetcher,onError:value=>failures.push(value)}),options=await loader.options;
 assert.equal(requests.length,2);assert.equal(requests[1].headers.Range,'bytes=0-262143');assert.equal(options.url,undefined);assert.equal(options.range.length,length);assert.equal(options.range.initial.length,262144);assert.equal(options.range.done,true);
 options.range.requestDataRange(400000,600000);await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(events,[{begin:400000,length:200000}]);
 options.range.requestDataRange(999999,1000020);await new Promise(resolve=>setTimeout(resolve,0));loader.abort();assert.equal(pending.aborted,true);await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(failures,[]);
});
test('range bridge rejects whole-file fallbacks or changed lengths instead of accepting a huge response',async()=>{
 let gets=0;const common={RangeTransport:class{},fetcher:async(_url,options)=>options.method==='HEAD'?new Response(null,{status:200,headers:{'Content-Length':'2000000','Accept-Ranges':'bytes'}}):(gets++,new Response(new Uint8Array(1),{status:200,headers:{'Content-Length':'1'}}))};
 await assert.rejects(createPdfBookSource({size:2000000,url:'mengcang-reader://source/abc'},common).options,/页块不可用/);assert.equal(gets,1);
 await assert.rejects(createPdfBookSource({size:4,url:'mengcang-reader://source/abc'},common).options,/原件已更改/);assert.equal(gets,1);
});
test('real PDF.js consumes custom source through the explicit range transport',async()=>{
 const bytes=await fs.readFile(new URL('../../../tests/fixtures/discovery-excerpt.pdf',import.meta.url)),requests=[];
 const loader=createPdfBookSource({name:'fixture.pdf',size:bytes.length,url:'mengcang-reader://source/test'},{RangeTransport:PDFDataRangeTransport,assetBase:fileURLToPath(new URL('../node_modules/pdfjs-dist/',import.meta.url)),fetcher:async(_url,options)=>{
  requests.push(options.method);if(options.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Length':String(bytes.length),'Accept-Ranges':'bytes'}});
  const [,first,last]=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range),start=Number(first),end=Number(last);return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
 }});
 const task=getDocument({...await loader.options,useSystemFonts:false});try{const pdf=await task.promise;assert.ok(pdf.numPages>=1);const result=await searchPdfDocument(pdf,'quiet',{yieldControl:async()=>{}});assert.ok(result.matches.length>0);assert.deepEqual(requests,['HEAD','GET']);}finally{loader.abort();await task.destroy();}
});
