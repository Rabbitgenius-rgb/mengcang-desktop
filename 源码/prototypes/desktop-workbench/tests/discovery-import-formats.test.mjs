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
