import {normalizeAnchorText, textFragmentUrl} from '../../../../src/clipper/anchors.mjs';
import {articleOriginalLocation, articlePageUrl, articleReaderModel} from './articleReaderModel.js';
import {valueOf} from '../desktopModel.js';

// Compares a saved excerpt, optional article snapshots, and the newly fetched
// source page. A paragraph number alone is never enough to infer a match.
const paragraphs = value => String(value || '').split(/\n\s*\n+/u).map(normalizeAnchorText).filter(Boolean);
const commonWords=new Set(['the','and','for','from','with','that','this','was','are','not','can','has','its','you','your','www','http','https']);
const tokens = value => [...new Set((value.match(/[A-Za-z][A-Za-z0-9]{2,}|[0-9]{4,}/gu) || []).map(token => token.toLowerCase()).filter(token=>!commonWords.has(token)))];
const count = (haystack, needle) => {let total=0,at=-1;while((at=haystack.indexOf(needle,at+1))!==-1)total++;return total;};
function uniquePositions(parts) {
 const result=new Map();
 parts.forEach((part,index)=>tokens(part).forEach(token=>{
  if(result.has(token))result.set(token,-1);
  else result.set(token,index);
 }));
 return result;
}
function uniqueFragment(paragraph,original) {
 const value=normalizeAnchorText(paragraph),whole=normalizeAnchorText(original).toLowerCase();
 // Text-fragment boundaries must end at a word boundary. Prefer a complete
 // sentence, then a longer bounded prefix, never an inferred translation.
 const first=value.match(/^.{25,}?[.!?](?=\s|$)/u)?.[0];
 const bounded=value.length<=150?value:value.slice(0,150).replace(/\s+\S*$/u,'');
 for(const candidate of [first?.length<=150?first:'',bounded])if(candidate&&candidate.length>=25&&count(whole,candidate.toLowerCase())===1)return candidate;
 return '';
}
function translatedParagraph(localBody, originalBody, quote) {
 const local=paragraphs(localBody),original=paragraphs(originalBody),selected=local.map((part,index)=>part.includes(quote)?index:-1).filter(index=>index>=0);
 if(selected.length!==1)return '';
 const target=selected[0],localTokens=uniquePositions(local),originalTokens=uniquePositions(original),left=new Map(),right=new Map();
 for(const [token,li] of localTokens) {
  const ri=originalTokens.get(token);
  if(li<0||ri===undefined||ri<0)continue;
  if(!left.has(li))left.set(li,new Set());left.get(li).add(ri);
  if(!right.has(ri))right.set(ri,new Set());right.get(ri).add(li);
 }
 const marks=[...left].flatMap(([li,values])=>values.size===1?[{li,ri:[...values][0]}]:[])
  .filter(({li,ri})=>Math.abs(li-target)<30 && right.get(ri)?.size===1 && right.get(ri).has(li));
 const results=new Set();
 for(const l of marks)for(const r of marks) {
  if(!(l.li<target&&target<r.li)||r.li-l.li>30||r.li-l.li!==r.ri-l.ri)continue;
  if(marks.some(m=>m.li>l.li&&m.li<r.li&&m.ri!==l.ri+m.li-l.li))continue;
  const index=l.ri+target-l.li;
  if(index<0||index>=original.length)continue;
  const localTerms=new Set(tokens(local[target]));
  if(!tokens(original[index]).some(token=>localTerms.has(token)))continue;
  const fragment=uniqueFragment(original[index],originalBody);if(fragment)results.add(fragment);
 }
 return results.size===1?[...results][0]:'';
}

// Older web highlights can retain a short surrounding text window even when
// the complete translated article was never saved. Only accept a paragraph
// bounded by unique matching landmarks on both sides, corroborated by every
// non-translated identifier in the quotation itself. Ambiguity must fail.
function paragraphFromExcerptContext(anchor,originalBody) {
 const quote=normalizeAnchorText(anchor?.exact),prefix=normalizeAnchorText(anchor?.prefix),suffix=normalizeAnchorText(anchor?.suffix);
 const han=(quote.match(/[\u3400-\u9fff]/gu)||[]).length,quoteTerms=tokens(quote);
 if(han<10||!quoteTerms.length||!prefix||!suffix)return '';
 const original=paragraphs(originalBody),positions=uniquePositions(original);
 const preceding=tokens(prefix).map(token=>positions.get(token)).filter(index=>Number.isSafeInteger(index)&&index>=0);
 const following=tokens(suffix).map(token=>positions.get(token)).filter(index=>Number.isSafeInteger(index)&&index>=0);
 if(!preceding.length||!following.length)return '';
 const ordered=indices=>indices.every((index,i)=>i===0||indices[i-1]<=index);
 if(!ordered(preceding)||!ordered(following))return '';
 const left=Math.max(...preceding),right=Math.min(...following);
 if(right-left<2||right-left>30)return '';
 const overlap=(a,b)=>{const haystack=new Set(tokens(b));return tokens(a).filter(token=>haystack.has(token)).length;};
 if(overlap(prefix,original[left])<2||overlap(suffix,original[right])<2)return '';
 const minimum=Math.max(45,Math.floor(han*.65)),maximum=Math.max(200,han*24);
 const matches=original.slice(left+1,right).filter(part=>{
  if(part.length<minimum||part.length>maximum)return false;
  const terms=new Set(tokens(part));
  return quoteTerms.every(term=>terms.has(term));
 });
 if(matches.length!==1)return '';
 return uniqueFragment(matches[0],originalBody);
}

// Use the translation to find evidence in the page. Only text copied from a
// single, distinguishable source sentence can become a browser text fragment.
const stopWords = new Set('a an and are as at be been being but by can could did do does for from had has have he her here him his how if in into is it its may might my of on or our she should so some than that the their them then there these they this those to us was we were what when where which who will with would you your'.split(' '));
const sentenceSegmenter = new Intl.Segmenter('en', {granularity: 'sentence'});
const sentencesOf = text => Array.from(sentenceSegmenter.segment(text), part => part.segment.trim()).filter(Boolean);

function englishTerms(value) {
 const words = value.toLowerCase().match(/[a-z]+/gu) || [];
 return words.filter(word => word.length >= 3 && !stopWords.has(word)).map(word => {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 5 && /(sses|xes|ches|shes)$/u.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
 });
}

function translatedSentenceMatch(translation, candidates) {
 const words = englishTerms(translation);
 const terms = [...new Set(words)];
 if (terms.length < 4) return null;
 const pairs = new Set(words.slice(1).map((word, i) => words[i] + ' ' + word));
 const weights = terms.map(term => 1 + Math.log((1 + candidates.length) /
  (1 + candidates.filter(candidate => candidate.terms.has(term)).length)));
 const total = weights.reduce((sum, weight) => sum + weight, 0);
 const negative = /\b(?:not|never|cannot|without)\b|n['’]t\b/iu;
 const ranked = candidates.map((candidate, index) => {
  const matched = terms.filter(term => candidate.terms.has(term)).length;
  const coverage = terms.reduce((sum,term,i) => sum + (candidate.terms.has(term) ? weights[i] : 0), 0) / total;
  const phrase = candidate.words.some((word,i) => i > 0 && pairs.has(candidate.words[i-1] + ' ' + word));
  return {index, matched, coverage, phrase, polarityMatches: negative.test(translation) === negative.test(candidate.text)};
 }).sort((a,b) => b.coverage - a.coverage);
 const [best, next] = ranked;
 if (!best || best.matched < 4 || best.coverage < 0.68 || !best.phrase || !best.polarityMatches) return null;
 if (next && best.coverage - next.coverage < 0.16) return null;
 return best.index;
}

export function resolveTranslatedOriginalWebPosition(excerpt, page, translated) {
 const source = articlePageUrl(excerpt?.sourceUrl);
 if (!source || source !== articlePageUrl(page?.sourceUrl) || page?.truncated || typeof page?.body !== 'string') return null;
 if (!/\p{Script=Han}/u.test(excerpt?.webAnchor?.exact || '') || typeof translated !== 'string' || translated.length > 12000) return null;
 const candidates = paragraphs(page.body).flatMap(sentencesOf).map(text => {
  const words = englishTerms(text);
  return {text, words, terms: new Set(words)};
 });
 const translatedSentences = sentencesOf(translated);
 const matches = translatedSentences.map(sentence => translatedSentenceMatch(sentence, candidates)).filter(index => index !== null);
 if (!matches.length) return null;
 // Reliable sentences from one excerpt must point to a single passage in reading order.
 if (matches.some((index, i) => i && index < matches[i-1]) || matches.at(-1) - matches[0] > translatedSentences.length + 1) return null;
 const exact = uniqueFragment(candidates[matches[0]].text, page.body);
 if (!exact) return null;
 try {
  return {url: textFragmentUrl(excerpt.sourceUrl, {version:1, exact, prefix:'', suffix:''}), kind:'translated-api', sourceSentence:exact};
 } catch { return null; }
}

export function resolveOriginalWebPosition(excerpt, library, page) {
 const source=articlePageUrl(excerpt?.sourceUrl),returned=articlePageUrl(page?.sourceUrl);
 if(!source||source!==returned||typeof page?.body!=='string'||!excerpt?.webAnchor?.exact)return null;
 const quote=normalizeAnchorText(excerpt.webAnchor.exact),body=normalizeAnchorText(page.body);
 // Preserve existing direct text-fragment behavior when the source contains
 // the same text. If it is repeated, retain the original contextual anchor.
 if(!quote)return null;
 if(body.includes(quote)) {
  const url=articleOriginalLocation(excerpt.sourceUrl,excerpt.webAnchor);
  return url?{url,kind:'direct'}:null;
 }
 if(page.truncated)return null;
 const candidates=(library||[]).filter(card=>card.type==='article'&&articlePageUrl(card.sourceUrl)===source&&
   (!excerpt.sourceCardId||card.id===excerpt.sourceCardId)&&typeof card.body==='string'&&
   !articleReaderModel(card).hasEditedBody&&normalizeAnchorText(card.body).includes(quote));
 let exact,kind;
 if(candidates.length){
  const found=candidates.map(card=>translatedParagraph(card.body,page.body,quote));
  if(found.some(value=>!value)||new Set(found).size!==1)return null;
  exact=found[0];kind='translated';
 }else{
  exact=paragraphFromExcerptContext(excerpt.webAnchor,page.body);kind='translated-context';
  if(!exact)return null;
 }
 try{return {url:textFragmentUrl(excerpt.sourceUrl,{version:1,exact,prefix:'',suffix:''}),kind};}catch{return null;}
}

export async function findOriginalWebPosition(excerpt, library, api, isCurrent = () => true) {
 const pageUrl = articlePageUrl(excerpt?.sourceUrl);
 if (!pageUrl || !api?.webCapture) throw Error('暂时无法读取原网页。');
 const page = valueOf(await api.webCapture(pageUrl));
 const existing = resolveOriginalWebPosition(excerpt, library, page);
 if (existing) return existing;
 const quote = normalizeAnchorText(excerpt?.webAnchor?.exact);
 const canTranslate = isCurrent() && typeof api.intelligenceRequest === 'function' &&
  /\p{Script=Han}/u.test(quote) && quote.length >= 10 && quote.length <= 2000 &&
  !page?.truncated && articlePageUrl(page?.sourceUrl) === pageUrl &&
  typeof page?.body === 'string' && /\b(?:the|with|and|that|this|from)\b/iu.test(page.body);
 if (canTranslate) {
  const translation = valueOf(await api.intelligenceRequest({action:'translatePosition', text:quote}));
  if (isCurrent()) {
   const matched = resolveTranslatedOriginalWebPosition(excerpt, page, translation?.text);
   if (matched) return matched;
  }
 }
 throw Error('未能可靠匹配原文位置。');
}
