import test from 'node:test';
import assert from 'node:assert/strict';
import {noteLinks,noteLinkPresentation} from '../src/sublime/workspaceView.js';

test('same-host sources display distinct paths and saved page attribution',()=>{
 const first='https://example.com/ocr-test',second='https://example.com/scan-page-2';
 const card={ocrText:`${first}\n${second}`,documentIndex:{pages:[{page:1,text:first},{page:2,text:second}]}};
 const before=structuredClone(card),links=noteLinkPresentation(card);
 assert.deepEqual(links.map(link=>[link.label,link.description]),[
  ['example.com/ocr-test',`第 1 页 · ${first}`],
  ['example.com/scan-page-2',`第 2 页 · ${second}`],
 ]);
 assert.deepEqual(links.map(link=>link.target),noteLinks(card).map(link=>link.target));
 assert.deepEqual(card,before);
});

test('named source keeps its title while repeated URL collects unique sorted page numbers',()=>{
 const url='https://example.test/chapter?q=1#part';
 const card={body:`[原著章节](${url})\n[[项目|项目说明]]`,sourceUrl:url,documentIndex:{pages:[{page:2,text:url},{page:1,text:url},{page:2,text:url},{page:0,text:url}]}};
 const [link,internal]=noteLinkPresentation(card);
 assert.equal(link.label,'原著章节');assert.deepEqual(link.pages,[1,2]);
 assert.equal(link.description,`第 1、2 页 · ${url}`);
 assert.deepEqual(internal,{kind:'internal',target:'项目',label:'项目说明'});
});

test('explicit domain titles stay named while automatic domain labels expand paths',()=>{
 const url='https://example.com/my-chosen-source';
 assert.equal(noteLinkPresentation({body:`[example.com](${url})`})[0].label,'example.com');
 assert.equal(noteLinkPresentation({sourceUrl:url,sourceTitle:'example.com'})[0].label,'example.com');
 assert.equal(noteLinkPresentation({ocrText:url})[0].label,'example.com/my-chosen-source');
 assert.deepEqual(noteLinks({body:`[example.com](${url})`}),[{kind:'external',target:url,label:'example.com'}]);
});

test('unpaged OCR and document summaries do not invent page attribution',()=>{
 const url='https://example.test/中文?q=a%20b#片段';
 const card={ocrText:url,documentIndex:{text:url,pageCount:3,pages:[{page:2,text:'这一页没有来源网址。'}]}};
 const [link]=noteLinkPresentation(card);
 assert.equal(link.target,url);assert.deepEqual(link.pages,[]);
 assert.equal(link.label,'example.test/中文?q=a%20b#%E7%89%87%E6%AE%B5');
 assert.equal(link.description,link.target);
});

test('display projection retains unsafe URL exclusions and ignores URLs in page code',()=>{
 const url='https://example.test/a%ZZ';
 const card={body:`${url}\nhttps://user:pass@private.test/`,documentIndex:{pages:[{page:1,text:`\`${url}\`\n![图](https://image.test/a.png)`}]}};
 const links=noteLinkPresentation(card);
 assert.equal(links.length,1);assert.equal(links[0].label,'example.test/a%ZZ');
 assert.deepEqual(links[0].pages,[]);
});
