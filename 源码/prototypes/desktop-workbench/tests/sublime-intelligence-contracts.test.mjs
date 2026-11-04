import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {MAX_OCR_TEXT, createWorkspaceState, workspaceReducer, serializeWorkspace, parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';
import {normalizeAiRecord, compactAiSource} from '../src/sublime/intelligenceDrafts.js';
import {buildExternalContextExport} from '../src/sublime/externalContext.js';
import {MAX_TRANSCRIPT_CUES, parseTimedTranscript} from '../src/sublime/podcastClips.js';
import {normalizePodcastTranscription} from '../src/sublime/podcastTranscription.js';

const require = createRequire(import.meta.url);
const {createIntelligenceService, MAX_OCR_TEXT: MAIN_MAX_OCR_TEXT} = require('../../../desktop/intelligence.cjs');
const {normalizeContext} = require('../../../scripts/mengcang-mcp.cjs');
const source = {id:'synthetic-source', origin:'local', type:'text', title:'隔离测试', body:'正文'};
const stamp = '2026-10-04T00:00:00.000Z';
const record = {id:'12345678-1234-4234-8234-123456789abc', mode:'OCR', phase:'complete', sourceSnapshot:source, createdAt:stamp, updatedAt:stamp};
const ogg = Buffer.from('OggSsynthetic-audio');
const attachment = {name:'synthetic.ogg', type:'application/ogg', size:ogg.length, dataUrl:`data:application/ogg;base64,${ogg.toString('base64')}`};

test('OCR contract supports one million exact characters through result, card, backup and explicit export', async () => {
  assert.equal(MAIN_MAX_OCR_TEXT, MAX_OCR_TEXT);
  const text = '识'.repeat(MAX_OCR_TEXT);
  const nativeAnalyze = async () => ({text, engine:'synthetic-only', pages:[]});
  const service = createIntelligenceService({initialSettings:{nativeEnabled:true}, nativeAnalyze});
  const result = await service.request({action:'extract', kind:'image', base64:'eA=='});
  assert.equal(normalizeAiRecord({...record, result}).result.text, text);
  const state = workspaceReducer(createWorkspaceState(), {type:'card.upsert', card:{...source, ocrText:result.text}});
  const card = parseWorkspaceBackup(serializeWorkspace(state)).cards[0];
  assert.equal(card.ocrText, text);
  assert.equal(compactAiSource(card).ocrText, text);
  assert.equal(normalizeContext(JSON.parse(buildExternalContextExport([card]))).cards[0].ocrText, text);
  const oversized = createIntelligenceService({initialSettings:{nativeEnabled:true}, nativeAnalyze:async () => ({text:text+'越', engine:'synthetic-only', pages:[]})});
  await assert.rejects(oversized.request({action:'extract', kind:'image', base64:'eA=='}), /100 万字符.*没有截断/);
  assert.throws(() => workspaceReducer(state, {type:'card.upsert', card:{...source, ocrText:text+'越'}}));
});

test('application/ogg transcribes after confirmation and uses the canonical audio multipart type', async () => {
  let confirmations = 0, body;
  const service = createIntelligenceService({initialSettings:{generationEnabled:true, transcriptionProvider:'api'},
    confirmRequest:async () => {confirmations++; return true;}, getApiKey:async () => 'synthetic-key',
    fetchImpl:async (_url, options) => {body=options.body.toString('utf8'); return new Response(JSON.stringify({text:'合成字幕', segments:[{start:0,end:1,text:'合成字幕'}]}));}});
  const result = await service.request({action:'transcribe', attachment});
  assert.equal(confirmations, 1); assert.match(body, /Content-Type: audio\/ogg\r\n/);
  assert.equal(parseTimedTranscript(result.text)[0].text, '合成字幕');
});

test('twenty thousand provider cues remain valid in the frontend and durable transcription history', async () => {
  assert.equal(MAX_TRANSCRIPT_CUES, 20000);
  const segments = Array.from({length:20000}, (_,index) => ({start:index/10,end:(index+1)/10,text:'x'}));
  const service = createIntelligenceService({initialSettings:{generationEnabled:true, transcriptionProvider:'api'},
    confirmRequest:async () => true, getApiKey:async () => 'synthetic-key',
    fetchImpl:async () => new Response(JSON.stringify({text:'x',segments}))});
  const result = await service.request({action:'transcribe', attachment});
  assert.equal(parseTimedTranscript(result.text).length, 20000);
  const saved = normalizePodcastTranscription({id:record.id,provider:'api',phase:'complete',sourceSnapshot:source,createdAt:stamp,updatedAt:stamp,transcript:result.text});
  assert.equal(saved.transcript, result.text);
  assert.throws(() => parseTimedTranscript(result.text+'\n20001\n00:33:20.000 --> 00:33:21.000\nx\n'), /20000/);
});

test('escaped subtitle growth is rejected by the producer before it becomes an unsavable success', async () => {
  const service = createIntelligenceService({initialSettings:{generationEnabled:true, transcriptionProvider:'api'},
    confirmRequest:async () => true, getApiKey:async () => 'synthetic-key',
    fetchImpl:async () => new Response(JSON.stringify({text:'合成',segments:Array.from({length:10},(_,index)=>({start:index,end:index+1,text:'&'.repeat(50000)}))}))});
  await assert.rejects(service.request({action:'transcribe', attachment}), /2 MiB 保存上限.*没有截断/);
});

test('long OCR remains searchable and survives ordinary JSON CSV and Markdown exports',async()=>{
 const {selectCards,exportCards}=await import('../src/sublime/workspaceModel.js'),ocrText='原'.repeat(100001)+'限定词';
 const state=workspaceReducer(createWorkspaceState(),{type:'card.upsert',card:{...source,ocrText}});
 assert.equal(selectCards(state.cards,state,{query:'限定词'}).length,1);
 for(const format of ['json','csv','markdown'])assert.ok(exportCards(state.cards,format).includes(ocrText));
});
test('keyword relevance shares OCR matching while preserving title priority',async()=>{
 const {selectCards}=await import('../src/sublime/workspaceModel.js'),cards=[{id:'ocr',title:'Image',ocrText:'target'},{id:'title',title:'target'}];
 assert.deepEqual(selectCards(cards,createWorkspaceState(),{query:'target',sort:'relevant'}).map(card=>card.id),['title','ocr']);
});
test('Markdown export handles many backtick runs without argument stack overflow',async()=>{
 const {exportCards}=await import('../src/sublime/workspaceModel.js'),ocrText='`x'.repeat(150000);
 const output=exportCards([{...source,ocrText}],'markdown');assert.ok(output.includes(ocrText));
});
