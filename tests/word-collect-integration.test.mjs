// Neus — Watchword collection pipeline integration test
//
// Drives the end-to-end data flow that runs in the browser, using jsdom's
// DOMParser (no real browser / network needed):
//   feed XML  -> RSSPoller.parseFeed  (mirrored from index.html)
//             -> inbound.fetched normalization (word:{term} auto-tag)
//             -> WordExporter.toDossier
// Fixtures mimic the real shapes returned by the search feeds Neus queries.

import { describe, it, expect } from 'vitest';

// ===== Mirrored from index.html (RSSPoller / normalizeUrl / normalization) =====
function decodeEntities(s){ if(!s||s.indexOf('&')<0)return s; const ta=document.createElement('textarea'); ta.innerHTML=s; return ta.value; }
function normalizeUrl(url){ try{ const u=new URL(url); u.hash=''; ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'].forEach(p=>u.searchParams.delete(p)); return u.toString(); }catch{ return url; } }
function parseFeed(xml, source){
  const doc=new DOMParser().parseFromString(xml,'text/xml');
  const hadError=!!doc.querySelector('parsererror');
  let nodes=[...doc.querySelectorAll('item, entry')];
  if(nodes.length===0){ if(hadError)throw new Error('XML parse error'); return []; }
  const items=[];
  for(const item of nodes){
    try{
      const get=(sel)=>{ try{ return item.querySelector(sel)?.textContent?.trim()||''; }catch{ return ''; } };
      const link=item.querySelector('link[href]')?.getAttribute('href')||get('link')||'';
      const title=decodeEntities(get('title'))||'(untitled)';
      const summaryRaw=get('description')||get('summary')||get('content');
      const summary=decodeEntities(summaryRaw).replace(/<[^>]+>/g,'').trim().slice(0,500);
      const pubDate=get('pubDate')||get('published')||get('updated')||get('dc\\:date');
      items.push({ raw:{
        title, link:normalizeUrl(link), summary,
        publishedAt: pubDate?Date.parse(pubDate)||undefined:undefined,
        author: decodeEntities(get('author > name')||get('author')||get('dc\\:creator')||''),
      }, source });
    }catch{/* skip malformed */}
  }
  return items;
}

// Mirrors the inbound.fetched -> event.normalized handler (word tagging branch)
let counter=0;
function normalize(raw, source){
  const autoTags=source.wordTerm?['word:'+source.wordTerm]:[];
  return {
    id:`ev${++counter}`, timestamp:Date.now(), publishedAt:raw.publishedAt,
    source:{ id:source.id, type:source.type||'rss', name:source.name, url:source.url },
    content:{ title:raw.title, snippet:raw.summary||'', summary:undefined },
    meta:{ autoTags, userTags:[], score:50, author:raw.author||undefined },
    state:{ read:false, starred:false, archived:false }, url:raw.link,
  };
}

// Mirrors WordExporter.toDossier
const isoDate=(ms)=>new Date(ms).toISOString();
function toDossier(word, events){
  const fm=['---',`term: ${word.term}`,`lang: ${word.lang||'en'}`,`generated_at: ${isoDate(0)}`,`items: ${events.length}`,'---'].join('\n');
  const parts=[fm,'',`# ${word.term}`,''];
  if(word.wiki?.extract){ parts.push('## 定義','',word.wiki.extract,''); if(word.wiki.url)parts.push(`[Wikipedia](${word.wiki.url})`,''); }
  parts.push(`## 収集アイテム (${events.length})`,'');
  const groups=new Map();
  for(const ev of events){ const k=ev.source.name||'other'; if(!groups.has(k))groups.set(k,[]); groups.get(k).push(ev); }
  for(const[name,list]of groups){ parts.push(`### ${name}`,''); for(const ev of list){ const d=ev.publishedAt?isoDate(ev.publishedAt).slice(0,10):''; parts.push(`- [${ev.content.title}](${ev.url||''})${d?` — ${d}`:''}`); if(ev.content.snippet)parts.push(`  - ${ev.content.snippet.slice(0,200)}`); } parts.push(''); }
  return parts.join('\n');
}

// ===== Realistic feed fixtures for the term "WebGPU" =====
const googleNewsRss=`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>"WebGPU" - Google News</title>
<item><title>WebGPU ships in Firefox &amp; Safari</title><link>https://news.google.com/articles/abc?oc=5&amp;utm_source=news</link><pubDate>Thu, 02 Jan 2026 09:00:00 GMT</pubDate><description>&lt;a&gt;Major browsers&lt;/a&gt; now ship WebGPU.</description><source url="https://example.com">Example</source></item>
<item><title>Benchmarks: WebGPU vs WebGL</title><link>https://news.google.com/articles/def</link><pubDate>Wed, 01 Jan 2026 12:00:00 GMT</pubDate><description>Performance comparison.</description></item>
</channel></rss>`;

// Reddit's search .rss is Atom
const redditAtom=`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>WebGPU search</title>
<entry><title>Show: my WebGPU renderer</title><link href="https://www.reddit.com/r/webgpu/comments/1"/><published>2026-01-02T08:00:00Z</published><summary>I built a renderer.</summary><author><name>/u/dev</name></author></entry>
</feed>`;

const arxivAtom=`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv Query</title>
<entry><title>Efficient WebGPU compute kernels</title><link href="http://arxiv.org/abs/2601.00001v1"/><published>2026-01-01T00:00:00Z</published><summary>We present compute kernels.</summary><author><name>A. Researcher</name></author></entry>
</feed>`;

const wikipediaJson={ title:'WebGPU', extract:'WebGPU is a JavaScript API for accelerated graphics and compute.', content_urls:{ desktop:{ page:'https://en.wikipedia.org/wiki/WebGPU' } }, thumbnail:{ source:'https://upload.wikimedia.org/x.png' } };

const word={ term:'WebGPU', normalized:'webgpu', lang:'en', sources:{wikipedia:true,news:true,reddit:true,arxiv:true} };
const src=(label)=>({ id:'word:w1', type:'word', name:`${word.term} · ${label}`, url:'https://feed', wordTerm:word.normalized });

describe('watchword collection pipeline (integration)', () => {
  it('parses each search feed into items', () => {
    expect(parseFeed(googleNewsRss, src('Google News'))).toHaveLength(2);
    expect(parseFeed(redditAtom, src('Reddit'))).toHaveLength(1);
    expect(parseFeed(arxivAtom, src('arXiv'))).toHaveLength(1);
  });

  it('normalizes feed items into word-tagged events with clean URLs', () => {
    const items=[
      ...parseFeed(googleNewsRss, src('Google News')),
      ...parseFeed(redditAtom, src('Reddit')),
      ...parseFeed(arxivAtom, src('arXiv')),
    ];
    const events=items.map(({raw,source})=>normalize(raw,source));
    expect(events).toHaveLength(4);
    // Every collected event carries the word: auto-tag and source.type 'word'
    expect(events.every(e=>e.meta.autoTags.includes('word:webgpu'))).toBe(true);
    expect(events.every(e=>e.source.type==='word')).toBe(true);
    // Tracking params stripped, entities decoded
    const gn=events[0];
    expect(gn.content.title).toBe('WebGPU ships in Firefox & Safari');
    expect(gn.url).not.toContain('utm_source');
    expect(gn.content.snippet).toBe('Major browsers now ship WebGPU.');
    // Atom published date parsed
    expect(events[2].publishedAt).toBe(Date.parse('2026-01-02T08:00:00Z'));
  });

  it('produces a dossier with the Wikipedia definition and items grouped by source', () => {
    const items=[
      ...parseFeed(googleNewsRss, src('Google News')),
      ...parseFeed(redditAtom, src('Reddit')),
      ...parseFeed(arxivAtom, src('arXiv')),
    ];
    const events=items.map(({raw,source})=>normalize(raw,source));
    const w={ ...word, wiki:{ title:wikipediaJson.title, extract:wikipediaJson.extract, url:wikipediaJson.content_urls.desktop.page } };
    const md=toDossier(w, events);
    expect(md).toContain('# WebGPU');
    expect(md).toContain('## 定義');
    expect(md).toContain('WebGPU is a JavaScript API for accelerated graphics and compute.');
    expect(md).toContain('[Wikipedia](https://en.wikipedia.org/wiki/WebGPU)');
    expect(md).toContain('## 収集アイテム (4)');
    expect(md).toContain('### WebGPU · Google News');
    expect(md).toContain('### WebGPU · Reddit');
    expect(md).toContain('### WebGPU · arXiv');
    expect(md).toContain('- [WebGPU ships in Firefox & Safari]');
    expect(md).toContain('- [Efficient WebGPU compute kernels](http://arxiv.org/abs/2601.00001v1) — 2026-01-01');
  });
});
