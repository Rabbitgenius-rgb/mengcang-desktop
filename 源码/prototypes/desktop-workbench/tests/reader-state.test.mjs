import test from 'node:test';
import assert from 'node:assert/strict';
import {bookFormat,isReadableBook,normalizeReaderLocation,normalizeReaderLocator,normalizeReaderState,readerStateKey,readerReducer,readerNotesMarkdown,supersedeReaderActions,mergeReaderBackupState} from '../src/reader/readerState.js';
import {createWorkspaceState,workspaceReducer,mergeWorkspaceBackup,previewWorkspaceBackupMerge,serializeWorkspace,parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';

test('null or malformed reader locations normalize safely without crashing a restored book',()=>{
 for(const value of [null,undefined,0,false,'bad',[]]){assert.deepEqual(normalizeReaderLocation(value),{page:1,chapter:0,progress:0});assert.deepEqual(normalizeReaderLocator(value),{page:1,chapter:0,progress:0});}
 const result=normalizeReaderState({location:null,bookmarks:[{id:'bookmark',locator:null}],annotations:[{id:'annotation',locator:null,text:'原文'}]});assert.equal(result.location.page,1);assert.equal(result.bookmarks[0].locator.page,1);assert.equal(result.annotations[0].locator.page,1);
});

test('reader identity retains normal legacy keys and bounds long Chinese and isolated UTF16 IDs without truncating identity',()=>{
 const path='01_sources/books/红楼梦.md',source='a'.repeat(64);assert.equal(readerStateKey(path,source),`reader:${encodeURIComponent(path)}:${source}`);
 for(const id of ['中文'.repeat(750),'中文'.repeat(2048),'x'.repeat(4096),'\ud800','\ud801']){
  const key=readerStateKey(id,source);assert.ok(key.length<=4096);assert.equal(key,readerStateKey(id,source));const state=workspaceReducer(createWorkspaceState(),{type:'draft.set',key,value:normalizeReaderState({note:'完整笔记'})});assert.equal(state.drafts[key].note,'完整笔记');
 }
 assert.notEqual(readerStateKey('中文'.repeat(750),'fixed'),readerStateKey('中文'.repeat(749)+'中美','fixed'));assert.notEqual(readerStateKey('\ud800','fixed'),readerStateKey('\ud801','fixed'));assert.notEqual(readerStateKey('\ud800','fixed'),readerStateKey('\ufffd','fixed'));assert.notEqual(readerStateKey('中文'.repeat(750),'first'),readerStateKey('中文'.repeat(750),'second'));
});

test('trusted MIME controls PDF and EPUB format before filenames, and nonbook MIME never creates a reader entry',()=>{
 assert.equal(bookFormat({type:'application/pdf',name:'renamed.epub'}),'pdf');assert.equal(bookFormat({type:'application/epub+zip',name:'wrong.pdf'}),'epub');assert.equal(bookFormat({type:' APPLICATION/PDF ',name:'wrong.epub'}),'pdf');assert.equal(bookFormat({type:'image/png',name:'image.pdf'}),'');assert.equal(isReadableBook({attachment:{type:'image/png',name:'image.epub'}}),false);assert.equal(bookFormat({name:'legacy.PDF'}),'pdf');assert.equal(bookFormat({name:'legacy.epub'}),'epub');
});

test('newer note, location, settings and per-annotation intent prune only fully superseded failed actions',()=>{
 const older=[{type:'note',note:'A'},{type:'location',location:{page:2}},{type:'settings',settings:{fontSize:18,theme:'dark'}},{type:'annotation.add',annotation:{id:'quote',text:'原文',note:''}},{type:'annotation.note',id:'quote',note:'older'},{type:'annotation.note',id:'other',note:'keep'},{type:'bookmark.add',bookmark:{id:'removed',locator:{page:1}}}];
 const later=[{type:'note',note:'AB'},{type:'location',location:{page:3}},{type:'settings',settings:{fontSize:22}},{type:'annotation.note',id:'quote',note:'newer'},{type:'bookmark.remove',id:'removed'}],before=JSON.stringify({older,later});
 assert.deepEqual(supersedeReaderActions(older,later),[{type:'settings',settings:{theme:'dark'}},older[3],older[5]]);assert.equal(JSON.stringify({older,later}),before);
 assert.deepEqual(supersedeReaderActions([{type:'settings',settings:{theme:'dark'}}],[{type:'settings',settings:{theme:'light'}}]),[]);
});

test('retry compaction flattens batches and handles add/remove lifecycle while preserving an add needed by a later note',()=>{
 const create={type:'annotation.add',annotation:{id:'quote',text:'原文'}},oldNote={type:'annotation.note',id:'quote',note:'A'};
 assert.deepEqual(supersedeReaderActions([{type:'batch',actions:[create,{type:'batch',actions:[oldNote,{type:'note',note:'first'}]}]}],[{type:'batch',actions:[{type:'annotation.note',id:'quote',note:'AB'},{type:'note',note:'second'}]}]),[create]);
 for(const later of [{type:'annotation.remove',id:'quote'},{type:'annotation.add',annotation:{id:'quote',text:'replacement'}}])assert.deepEqual(supersedeReaderActions([create,oldNote,{type:'annotation.remove',id:'quote'}],[later]),[]);
 assert.deepEqual(supersedeReaderActions([{type:'bookmark.add',bookmark:{id:'b'}},{type:'bookmark.remove',id:'b'}],[{type:'bookmark.add',bookmark:{id:'b',label:'new'}}]),[]);
});

test('reader backup union preserves current progress/settings, both note versions and stable bookmark/highlight collisions',()=>{
 const bookmark=(id,label,page)=>({id,label,locator:{page},createdAt:'2026-10-19'}),annotation=(id,text,note)=>({id,label:'第 3 页',locator:{page:3},text,note});
 const current=normalizeReaderState({location:{page:7},settings:{theme:'dark'},note:'当前完整笔记',bookmarks:[bookmark('shared','当前书签',7)],annotations:[annotation('same','当前原文','当前批注')]}),incoming=normalizeReaderState({location:{page:20},settings:{theme:'sepia'},note:'备份中另一版完整笔记',bookmarks:[bookmark('shared','备份书签',20),bookmark('new','备份独有',30)],annotations:[annotation('same','备份原文','备份批注')]}),before=JSON.stringify({current,incoming});
 const merged=mergeReaderBackupState(current,incoming);assert.equal(merged.location.page,7);assert.equal(merged.settings.theme,'dark');assert.match(merged.note,/当前完整笔记/);assert.match(merged.note,/从备份恢复的另一版笔记/);assert.match(merged.note,/备份中另一版完整笔记/);assert.equal(merged.bookmarks.length,3);assert.equal(new Set(merged.bookmarks.map(item=>item.id)).size,3);assert.equal(merged.annotations.length,2);assert.equal(merged.annotations[0].text,'当前原文');assert.equal(merged.annotations[1].text,'备份原文');assert.equal(JSON.stringify({current,incoming}),before);assert.deepEqual(mergeReaderBackupState(merged,incoming),merged);
});

test('a newly restored reader record retains its saved location/theme and exact excerpt source pointer',()=>{
 const key=readerStateKey('book','source-version'),incoming={...createWorkspaceState(),drafts:{[key]:normalizeReaderState({location:{page:42,chapter:2,progress:.4},settings:{theme:'sepia'},note:'恢复完整笔记'}),'reader-excerpt:quote':{cardId:'book',sourceKey:'source-version',format:'pdf',locator:{page:42}}}},snapshot=serializeWorkspace(incoming),merged=mergeWorkspaceBackup(createWorkspaceState(),parseWorkspaceBackup(snapshot));
 assert.deepEqual(merged.drafts[key],incoming.drafts[key]);assert.deepEqual(merged.drafts['reader-excerpt:quote'],incoming.drafts['reader-excerpt:quote']);
 const current={...createWorkspaceState(),drafts:{'reader-excerpt:quote':{cardId:'book',sourceKey:'current-version',format:'pdf',locator:{page:4}}}};assert.deepEqual(mergeWorkspaceBackup(current,incoming).drafts['reader-excerpt:quote'],current.drafts['reader-excerpt:quote']);
});

test('workspace backup merge retains different reading notes and metadata without affecting unrelated drafts',()=>{
 const key=readerStateKey('book','fixed'),current={...createWorkspaceState(),drafts:{[key]:normalizeReaderState({note:'当前笔记'}),appearance:'dark'}},incoming={...createWorkspaceState(),drafts:{[key]:normalizeReaderState({note:'另一版笔记',bookmarks:[{id:'backup-only',label:'第 3 页',locator:{page:3}}]}),appearance:'light'}};
 const merged=mergeWorkspaceBackup(current,incoming);assert.equal(merged.drafts.appearance,'dark');assert.match(merged.drafts[key].note,/当前笔记/);assert.match(merged.drafts[key].note,/另一版笔记/);assert.equal(merged.drafts[key].bookmarks[0].id,'backup-only');assert.equal(previewWorkspaceBackupMerge(current,incoming).mergedReaderRecords,1);assert.deepEqual(mergeWorkspaceBackup(merged,incoming),merged);
});

test('backup reader limits fail before trimming original notes, bookmarks or annotations',()=>{
 const normal=normalizeReaderState({note:'current'});
 for(const input of [{note:'x'.repeat(50001)},{bookmarks:Array.from({length:1001},(_,id)=>({id:String(id)}))},{annotations:[{id:'long',text:'x'.repeat(20001)}]},{bookmarks:[{id:'same'},{id:'same'}]},{version:2}])assert.throws(()=>mergeReaderBackupState(normal,input),/备份|上限/);
 assert.throws(()=>mergeReaderBackupState(normal,{note:'x'.repeat(49999)}),/50000/);
 const full=normalizeReaderState({bookmarks:Array.from({length:1000},(_,id)=>({id:String(id),label:String(id)}))}),before=JSON.stringify(full);assert.throws(()=>mergeReaderBackupState(full,{bookmarks:[{id:'new',label:'新书签'}]}),/数量上限/);assert.equal(JSON.stringify(full),before);
});

test('reader reducer and Markdown export keep exact note and quote content through ordinary saves',()=>{
 let state=readerReducer(undefined,{type:'note',note:'中文笔记\n第二行'});state=readerReducer(state,{type:'annotation.add',annotation:{id:'a',label:'第 2 页',locator:{page:2},text:'原文\n逐字保留',note:'自己的批注'}});state=readerReducer(state,{type:'bookmark.add',bookmark:{id:'b',label:'第 2 页',locator:{page:2}}});const output=readerNotesMarkdown({title:'图书'},state,{name:'book.pdf'});assert.match(output,/中文笔记\n第二行/);assert.match(output,/> 原文\n> 逐字保留/);assert.match(output,/自己的批注/);assert.match(output,/第 2 页/);
});
