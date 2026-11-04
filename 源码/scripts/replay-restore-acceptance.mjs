// Explicit QA commands for the independent restore profile only. No raw DB access.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {callPrivate} from '../../shared/private-rpc.cjs';
import {normalizeRecallCapture} from '../src/recall/contract.mjs';
import {parseWorkspaceBackup} from '../prototypes/desktop-workbench/src/sublime/workspaceModel.js';

const candidate=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=path.join(candidate,'verification/qa3');
const mode=process.argv[2];
if(!['read','mark-reviewed','replay'].includes(mode)){
 console.log('read | mark-reviewed | replay\nTarget: runtime/backup-restore-acceptance/bridge only. mark-reviewed writes due=false; replay resubmits the original C request after checking the real edited UI export. Run only after native UI import.');
 process.exit(mode&&mode!=='--help'?1:0);
}
const capture=normalizeRecallCapture(JSON.parse(await fs.readFile(path.join(evidence,'original-capture-c.json'),'utf8')));
assert.equal(capture.requestId,'d643647e-ed1b-4c22-aaf7-82e6c953589b');
const id=`harness-recall:${capture.requestId}`;
const call=(method,params={})=>callPrivate({directory:path.join(candidate,'runtime/backup-restore-acceptance/bridge'),service:'mengcang',method,params});
const status=await call('status');assert.equal(status.ready,true,'Open the independent restore candidate first');
const before=await call('get',{id});assert.equal(before.workspaceId,status.workspaceId);
let result=before;
if(mode==='mark-reviewed')result=await call('setReview',{id,due:false});
if(mode==='replay'){
 const state=parseWorkspaceBackup(await fs.readFile(path.join(evidence,'library-edited-before-replay.json'),'utf8'));
 const expected=state.cards.find(card=>card.id===id);assert(expected,'Export the edited restore library through native UI before replay');
 assert(expected.title!==capture.title&&expected.body!==capture.text,'Edit both the restored C title and body in native UI before replay');
 assert.equal(expected.recallDue,false,'Mark the restored C card reviewed and then export before replay');
 const expectedItem={id,title:expected.title,text:expected.body,savedAt:expected.recallReceipt.savedAt,due:expected.recallDue,externalSource:expected.externalSource};
 assert.deepEqual(before.item,expectedItem,'Live restore card differs from the edited UI export');
 result=await call('capture',capture);assert.equal(result.duplicate,true);assert.deepEqual(result.item,expectedItem,'An old replay changed the edited card');
}
assert.equal(result.workspaceId,status.workspaceId);
console.log(JSON.stringify({recordedAt:new Date().toISOString(),mode,scope:'Independent restore candidate only',...result},null,2));
