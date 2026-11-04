import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImportText, exportSelectedItems, dedupeImports, importFingerprint} from '../src/discoveryModel.js';

test('browser HTML bookmarks import safe links and descriptions without running HTML or fetching resources', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
  <DL><p><DT><A HREF="https://example.test/a?x=1&amp;y=2" ADD_DATE="1700000000">Title &amp; &lt;literal&gt;</A>
  <DD>Own <b>description</b><br>second line
  <DT><A href='https://example.test/b'>Second</A>
  <DT><A href="&#106;avascript:alert(1)">Unsafe</A>
  <DT><A href="https://user:secret@example.test/">Credentials</A>
  <script><a href="https://example.test/script">Must not import</a>globalThis.executed=true</script></DL>`;
  const before = globalThis.executed;
  const parsed = parseImportText(html, 'auto', {filename:'bookmarks.html'});
  assert.equal(globalThis.executed, before);
  assert.deepEqual(parsed.map(record => [record.title, record.sourceUrl, record.body]), [['Title & <literal>', 'https://example.test/a?x=1&y=2', ''], ['Second', 'https://example.test/b', '']]);
  assert.equal(parsed[0].caption, 'Own description\nsecond line');
  assert.equal(parsed[0].date, '2023-11-14T22:13:20.000Z');
  assert.equal(parsed[0].type, 'link');
  assert.deepEqual(parseImportText('<a href="data:text/html,evil">Evil</a>', 'bookmarks'), []);
});

test('Title and URL CSV, generic JSON links, and plain URL lists do not invent article bodies', () => {
  const csv = 'Title,URL,Description\r\n"Title, one",https://example.test/bookmark,"note, preserved"\r\nSecond,https://example.test/two,\r\n';
  const parsed = parseImportText(csv, 'auto');
  assert.equal(parsed.length, 2);assert.equal(parsed[0].title, 'Title, one');
  assert.equal(parsed[0].body, '');assert.equal(parsed[0].caption, 'note, preserved');assert.equal(parsed[0].type, 'link');
  const generic = parseImportText(JSON.stringify({bookmarks:[{title:'URL only', url:'https://example.test/url', description:'Original note'}]}), 'json');
  assert.equal(generic[0].sourceUrl, 'https://example.test/url');assert.equal(generic[0].body, '');
  assert.equal(generic[0].caption, 'Original note');
  assert.equal(parseImportText('["https://example.test/string"]','json')[0].sourceUrl,'https://example.test/string');
  assert.equal(parseImportText('https://example.test/one\nhttps://example.test/two', 'auto').length, 2);
  assert.throws(()=>parseImportText('[{"title":"Unsafe","url":"javascript:evil"}]','json'), /没有可导入/);
});

test('X archive JSON wrappers and Instagram saved records retain original content and their actual source links', () => {
  const tweet = {tweet:{id_str:'1234567890', full_text:'  Original tweet\r\nsecond line  ', created_at:'2026-10-01', entities:{urls:[{expanded_url:'https://example.test/external'}]}}};
  const [parsed] = parseImportText(`window.YTD.tweets.part0 = ${JSON.stringify([tweet])};`, 'auto');
  assert.equal(parsed.body, tweet.tweet.full_text);assert.equal(parsed.sourceUrl, 'https://x.com/i/web/status/1234567890');
  assert.equal(parsed.sourceTitle, 'X');assert.equal(parsed.type, 'social');assert.equal(parsed.date, '2026-10-01');
  assert.throws(()=>parseImportText('window.YTD.tweets.part0 = []; globalThis.executed = true;', 'json'), /JSON|Unexpected/);
  const instagram = {saved_saved_media:[{title:'Saved post', string_map_data:{'Saved on':{href:'https://www.instagram.com/p/synthetic/', timestamp:1700000000}, 'Media owner':{value:'Original author'}}}]};
  const [saved] = parseImportText(JSON.stringify(instagram), 'json');
  assert.equal(saved.title, 'Saved post');assert.equal(saved.sourceUrl, 'https://www.instagram.com/p/synthetic/');
  assert.equal(saved.body, '');assert.equal(saved.sourceTitle, 'Instagram');assert.equal(saved.type, 'social');
  assert.equal(saved.author,'Original author');
});

test('public JSON, CSV, and Markdown multi-card exports round-trip independent source page, location, date, OCR and byte-exact text', () => {
  const cards = [
    {id:'a', title:'Quoted "title"', sourceTitle:' Book \\ title\nsecond ', author:' Author ', sourceUrl:'https://example.test/a', page:'7', sourceLocation:'Location 123-124', date:'2026-09-29', type:'highlight', body:'  第一行\r\n```\n## 2. fake card\n最后\n  ', caption:' Note\r\nend ', ocrText:'Previously stored OCR',tags:['Reading','标签,带逗号']},
    {id:'b', title:'Second', sourceTitle:'Book two', author:'Author two', sourceUrl:'https://example.test/b', page:'8', sourceLocation:'125-126', date:'2026-09-30', type:'article', body:'第二条正文\n', caption:'', ocrText:'',tags:[]},
  ];
  for (const format of ['json','csv','markdown']) {
    const exported = exportSelectedItems(cards,cards.map(card=>card.id),format);
    const parsed = parseImportText(exported,format);
    assert.equal(parsed.length, 2, format);
    for(let i=0;i<cards.length;i++) {
      for(const field of ['title','sourceTitle','author','sourceUrl','page','sourceLocation','date','type','body','caption','ocrText']) assert.equal(parsed[i][field],cards[i][field], `${format} ${field}`);
      assert.deepEqual(parsed[i].tags,cards[i].tags);
      assert.equal(parsed[i].fingerprint,importFingerprint(cards[i]));
    }
    assert.equal(dedupeImports(parsed,cards).duplicates,2);
  }
  const malformed=exportSelectedItems(cards,['a'],'markdown').replace(/`{4}text/, '```wrong');
  assert.throws(()=>parseImportText(malformed,'markdown'), /围栏/);
});

test('Readwise Location remains a location, physical Page stays separate, and legacy fingerprints still deduplicate', () => {
  const csv='Book Title,Author,Highlight,Note,Location,Page,Date,URL\r\nBook,Author,"  原文\r\n第二行  ",Note,Location 123-124,7,2026-10-02,https://example.test/book';
  const [parsed] = parseImportText(csv,'csv');
  assert.equal(parsed.body,'  原文\r\n第二行  ');assert.equal(parsed.page,'7');assert.equal(parsed.sourceLocation,'Location 123-124');
  assert.equal(parsed.type,'highlight');assert.equal(parsed.date,'2026-10-02');
  assert.equal(dedupeImports([{...parsed,caption:'Changed note'}],[{body:'Original DB may include wrapper',fields:{import_fingerprint:parsed.fingerprint}}]).duplicates,1);
  const [locationOnly]=parseImportText('Book Title,Highlight,Location\nBook,Original,123-124','csv');
  assert.equal(locationOnly.page,'');assert.equal(locationOnly.sourceLocation,'123-124');
  const legacy={...locationOnly,page:'123-124',sourceLocation:''};
  assert.equal(locationOnly.fingerprint,importFingerprint(legacy));
  assert.notEqual(importFingerprint({...parsed,page:'8'}),parsed.fingerprint);
});

test('workspace exports preserve an explicitly empty source title and existing import identity', async () => {
  const {normalizeWorkspaceState, exportCards} = await import('../src/sublime/workspaceModel.js');
  const cards = normalizeWorkspaceState({cards:[{id:'local', title:'My own note', body:'Original words', sourceTitle:''}]}).cards;
  for (const format of ['json','csv','markdown']) {
    const [record] = parseImportText(exportCards(cards,format),format);
    assert.equal(record.sourceTitle,'',format);
    assert.equal(record.fingerprint,importFingerprint(cards[0]),format);
    assert.equal(dedupeImports([record],cards).duplicates,1,format);
  }
});

test('source-title inference remains available for legacy records that omit the field', () => {
  assert.equal(parseImportText('[{"title":"Legacy book","body":"Quote"}]','json')[0].sourceTitle,'Legacy book');
  assert.equal(parseImportText('[{"title":"Card title","sourceTitle":"Explicit book","body":"Quote"}]','json')[0].sourceTitle,'Explicit book');
  assert.equal(parseImportText('{"books":[{"title":"Parent book","highlights":[{"text":"Quote"}]}]}','json')[0].sourceTitle,'Parent book');
});

for (const separator of ['\u2028','\u2029']) test(`workspace Markdown metadata retains Unicode separator U+${separator.charCodeAt(0).toString(16)}`, async () => {
  const {normalizeWorkspaceState, exportCards} = await import('../src/sublime/workspaceModel.js');
  for (const field of ['title','sourceTitle','author','page','sourceLocation','date','type','tags']) {
    const value=`before${separator}after`;
    const cards = normalizeWorkspaceState({cards:[{id:'first',title:'First',body:'Original first', [field]:field==='tags'?[value]:value},{id:'second',title:'Second',body:'Original second'}]}).cards;
    const parsed = parseImportText(exportCards(cards,'markdown'),'markdown');
    assert.equal(parsed.length,2,field);
    assert.deepEqual(parsed[0][field],cards[0][field],field);
    assert.equal(parsed[0].body,cards[0].body,field);
    assert.equal(parsed[1].body,cards[1].body,field);
  }
});

test('bodyless workspace cards retain their saved OCR and caption in each ordinary import format', async () => {
  const {normalizeWorkspaceState, serializeWorkspace, exportCards} = await import('../src/sublime/workspaceModel.js');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAusB9Wl6rN8AAAAASUVORK5CYII=';
  const attachment={name:'synthetic.png',type:'image/png',size:Buffer.from(png,'base64').length,dataUrl:`data:image/png;base64,${png}`};
  const state=normalizeWorkspaceState({cards:[
    {id:'ocr',title:'OCR image',type:'image',body:'',sourceUrl:'',ocrText:'Stored OCR\r\n完整尾字',caption:'Original caption',attachment},
    {id:'caption',title:'Caption-only image',type:'image',body:'',caption:'Caption text only',attachment},
    {id:'normal',title:'Normal',body:'Usual body'},
  ]});
  const cards=normalizeWorkspaceState(JSON.parse(serializeWorkspace(state))).cards;
  for(const format of ['json','csv','markdown']) {
    const parsed=parseImportText(exportCards(cards,format),format);
    assert.equal(parsed.length,3,format);
    for(let i=0;i<cards.length;i++) for(const key of ['title','body','caption','ocrText','sourceTitle']) assert.equal(parsed[i][key],cards[i][key],`${format} ${i} ${key}`);
    assert.equal(dedupeImports(parsed,cards).duplicates,3,format);
  }
});

test('newly supported text-only payloads have distinct identities without changing ordinary highlight identities', () => {
  const first={title:'Image',body:'',sourceUrl:'',ocrText:'First OCR',caption:'First caption'};
  const variants=[first,{...first,title:'Second image',ocrText:'Second OCR'},{...first,caption:'Second caption'},{...first,ocrText:'',caption:'Standalone note'}];
  assert.equal(dedupeImports(variants).items.length,4);
  assert.equal(dedupeImports(variants.slice(1),[first]).items.length,3);
  assert.equal(dedupeImports([{...first,title:'Renamed',date:'2026-10-05'}],[first]).duplicates,1);
  for(const ordinary of [{body:'Quote',caption:'Note',ocrText:'OCR'},{body:'',sourceUrl:'https://example.test/item',caption:'Note',ocrText:'OCR'}]) {
    assert.equal(importFingerprint(ordinary),importFingerprint({...ordinary,caption:'Changed note',ocrText:'Changed OCR',date:'Changed date'}));
  }
  assert.equal(parseImportText('[{"caption":"Only note"}]','json')[0].type,'text');
  assert.equal(parseImportText('[{"ocrText":"Only OCR"}]','json')[0].type,'text');
  assert.throws(()=>parseImportText('[{"title":"Empty","caption":"  ","ocrText":"\\n"}]','json'),/没有可导入/);
});

test('comment cleanup cannot expose genuine management sections by creating or removing a code fence', () => {
  const examples=[
    'Visible\n```md\n<!-- comment start\n```\ncomment end -->\n## 整理说明\nPRIVATE_MANAGEMENT\n## Visible\nTail',
    'Visible\n``<!-- comment -->`md\n## 整理说明\nPRIVATE_MANAGEMENT\n```\n## Visible\nTail',
    'Visible\n```md\n<!-- mengcang-relations:start -->\n```\n<!-- mengcang-relations:end -->\n## 整理说明\nPRIVATE_MANAGEMENT\n## Visible\nTail',
  ];
  for(const body of examples) for(const format of ['json','csv','markdown']) {
    const output=exportSelectedItems([{id:'safe',title:'Synthetic safety sample',body}],['safe'],format);
    assert.ok(!output.includes('PRIVATE_MANAGEMENT'),format);
    assert.ok(!output.includes('comment start'),format);
    assert.ok(!output.includes('mengcang-relations'),format);
  }
});
