import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {filterWorkspaceGroups,cardCapturePayload,buildOfflineCardHTML} from '../src/sublime/workspaceView.js';
const {validateCaptureInput}=createRequire(import.meta.url)('../../../src/desktop-connector/capture.js');
test('group search uses title and description, pinned order survives shuffle',()=>{
 const groups=[{id:'one',title:'写作',description:'倾听相关'},{id:'two',title:'倾听',pinned:true},{id:'three',title:'图像'}];
 assert.deepEqual(filterWorkspaceGroups(groups,'倾听',{pinned:true,shuffle:3}).map(x=>x.id),['two','one']);
 assert.equal(filterWorkspaceGroups(groups,'no-match').length,0);
 assert.equal(groups[0].id,'one');
});
test('capture preserves independent provenance fields',()=>{
 const card={title:'摘录',body:'正文',caption:'原注释',sourceUrl:'https://example.com/page',sourceTitle:'书名',author:'作者',page:'7',sourceLocation:'Location 12',importFingerprint:'highlight-v1:fixture',tags:['阅读']};
 const operationId='00000000-0000-4000-8000-000000000001';
 const payload=cardCapturePayload(card,{operationId,caption:''});
 assert.deepEqual(payload,{...card,page:7,operationId,caption:''});
 const validated=validateCaptureInput(payload);assert.equal(validated.page,7);assert.equal(validated.sourceLocation,'Location 12');
 const range=validateCaptureInput(cardCapturePayload({...card,page:'7–8'},{operationId}));assert.equal(range.page,null);assert.equal(range.sourceLocation,'Page 7–8 · Location 12');
});
test('offline share is inert, self contained, and omits personal note by default',()=>{
 const card={title:'</title><script>bad()</script>',body:'<img src=x onerror=bad()>',caption:'PRIVATE NOTE',sourceUrl:'javascript:alert(1)',image:'https://remote.example/tracker.png',attachment:{name:'a.pdf',type:'application/pdf',dataUrl:'data:application/pdf;base64,JVBERg=='}};
 const html=buildOfflineCardHTML(card);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('PRIVATE NOTE'));assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('remote.example'));
 assert.ok(html.includes('&lt;img'));assert.ok(html.includes('Content-Security-Policy'));assert.ok(html.includes('data:application/pdf;base64,JVBERg=='));
 assert.ok(buildOfflineCardHTML(card,{includeNote:true,includeAttachment:false}).includes('PRIVATE NOTE'));
 assert.ok(!buildOfflineCardHTML(card,{includeAttachment:false}).includes('data:application/pdf'));
});
