// Read exported candidate JSON only. Never opens IndexedDB or calls a live API.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseWorkspaceBackup} from '../prototypes/desktop-workbench/src/sublime/workspaceModel.js';
import {normalizeRecallCapture} from '../src/recall/contract.mjs';

const candidate=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=path.join(candidate,'verification');
const [mode,first,second,third]=process.argv.slice(2);
if(mode==='--help'||!mode){
  console.log('inspect <backup.json>\ncompare <expected-backup.json> <actual-backup.json>\nrequest <pristine-backup.json> <card-id> <output.json>\nAll files must be within candidate/verification. request writes one original capture only after checking its stored receipt hash.');
  process.exit(0);
}
const hash=value=>createHash('sha256').update(value).digest('hex');
function allowed(file){const resolved=path.resolve(file||'');if(!resolved.startsWith(evidence+path.sep))throw Error('Use a file inside candidate/verification');return resolved;}
async function read(file){const resolved=await fs.realpath(allowed(file));allowed(resolved);return parseWorkspaceBackup(await fs.readFile(resolved,'utf8'));}
const recall=state=>state.cards.filter(card=>card.externalSource&&card.recallReceipt).sort((a,b)=>a.id.localeCompare(b.id));
const comparable=(state,card)=>({id:card.id,title:card.title,body:card.body,externalSource:card.externalSource,recallReceipt:card.recallReceipt,recallDue:card.recallDue,saved:state.savedIds.includes(card.id),hidden:state.hiddenIds.includes(card.id),collectionIds:state.collections.filter(collection=>collection.cardIds.includes(card.id)).map(collection=>collection.id).sort()});
const summary=(state,card)=>({id:card.id,title:card.title,bodySha256:hash(card.body),due:card.recallDue,sourceSha256:hash(JSON.stringify(card.externalSource)),requestId:card.recallReceipt.requestId,payloadHash:card.recallReceipt.payloadHash,saved:state.savedIds.includes(card.id),hidden:state.hiddenIds.includes(card.id)});
const expected=await read(first),cards=recall(expected);assert.ok(cards.length,'The exported backup has no recall cards');
if(mode==='inspect')console.log(JSON.stringify({recallCards:cards.map(card=>summary(expected,card))},null,2));
else if(mode==='compare'){
  const actual=await read(second),actualCards=recall(actual);
  assert.deepEqual(actualCards.map(card=>comparable(actual,card)),cards.map(card=>comparable(expected,card)));
  console.log(JSON.stringify({passed:true,recallCardCount:cards.length,compared:['id','title','body','externalSource','recallReceipt','recallDue','saved','hidden','collectionIds']},null,2));
}else if(mode==='request'){
  const card=cards.find(card=>card.id===second);assert.ok(card,'Requested recall card is absent');
  const capture=normalizeRecallCapture({requestId:card.recallReceipt.requestId,text:card.body,title:card.title,externalSource:card.externalSource});
  assert.equal(hash(JSON.stringify(capture)),card.recallReceipt.payloadHash,'Card has been edited since capture; use its pristine exported backup, never guess the original request');
  const output=allowed(third),parent=await fs.realpath(path.dirname(output));allowed(path.join(parent,path.basename(output)));
  await fs.writeFile(output,JSON.stringify(capture,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({prepared:true,submitted:false,path:output,requestId:capture.requestId},null,2));
}else throw Error('Unknown command; use --help');
