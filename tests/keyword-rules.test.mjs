// Neus — KeywordRules unit tests
// Covers all match modes (contains/exact/prefix/suffix/word/regex)
// and scope/case/action handling.

import { describe, it, expect } from 'vitest';

// ===== Pure functions mirrored from KeywordRules in index.html =====

function getEventText(ev, scope) {
  const parts = [];
  if (scope === 'title' || scope === 'all') parts.push(ev.content.title || '');
  if (scope === 'snippet' || scope === 'all') parts.push(ev.content.snippet || '');
  if (scope === 'summary' || scope === 'all') parts.push(ev.content.summary || '');
  if (scope === 'tags' || scope === 'all') parts.push((ev.meta.userTags||[]).join(' '), (ev.meta.autoTags||[]).join(' '));
  if (scope === 'source' || scope === 'all') parts.push(ev.source.name || '');
  return parts.join(' ');
}

function matchRule(text, rule) {
  if (!text || !rule.pattern) return false;
  if (rule.mode === 'regex') {
    try { return new RegExp(rule.pattern, rule.case ? '' : 'i').test(text); }
    catch { return false; }
  }
  let t = text, p = rule.pattern;
  if (!rule.case) { t = t.toLowerCase(); p = p.toLowerCase(); }
  switch (rule.mode) {
    case 'contains': return t.includes(p);
    case 'exact': return t.trim() === p;
    case 'prefix': return t.startsWith(p);
    case 'suffix': return t.endsWith(p);
    case 'word': {
      const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, rule.case ? '' : 'i');
      return re.test(text);
    }
    default: return false;
  }
}

function applyRules(ev, rules) {
  const matched = { watch: [], block: [] };
  for (const r of rules.watch) if (matchRule(getEventText(ev, r.scope || 'all'), r)) matched.watch.push(r);
  for (const r of rules.block) if (matchRule(getEventText(ev, r.scope || 'all'), r)) matched.block.push(r);
  let skip = false;
  for (const r of matched.block) {
    if (r.action === 'delete') { skip = true; break; }
    if (r.action === 'archive') { ev.state.archived = true; ev.state.archivedAt = Date.now(); }
  }
  if (!skip) {
    for (const r of matched.watch) {
      if (r.action === 'star') ev.state.starred = true;
      if (r.action === 'highlight') ev.meta.score = Math.min(100, (ev.meta.score || 50) + 30);
      if (r.action === 'tag') {
        const tag = `watch:${r.pattern}`;
        if (!(ev.meta.autoTags || []).includes(tag)) ev.meta.autoTags = [...(ev.meta.autoTags || []), tag];
      }
    }
  }
  if (matched.watch.length > 0 || matched.block.length > 0) {
    ev.meta.keywordMatched = { watch: matched.watch.map(r => r.pattern), block: matched.block.map(r => r.pattern) };
  }
  return { matched, skip };
}

function fixtureEvent(overrides = {}) {
  const base = {
    id: 'test-1', timestamp: Date.now(),
    source: { id: 'hn', type: 'rss', name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
    content: { title: 'Rust 1.85 released with async fn improvements', snippet: 'New release of the Rust programming language', summary: 'Async fn now supports trait', body: '' },
    meta: { autoTags: ['rust', 'async'], userTags: ['programming'], score: 50, author: 'team' },
    user: {}, state: { read: false, starred: false, archived: false, exported: false },
    links: [], url: 'https://example.com/post', hash: 'abc',
  };
  return { ...base, ...overrides, content: { ...base.content, ...(overrides.content||{}) }, meta: { ...base.meta, ...(overrides.meta||{}) }, state: { ...base.state, ...(overrides.state||{}) } };
}

// ===== TESTS =====

describe('matchRule — contains mode', () => {
  it('matches substring', () => {
    expect(matchRule('Hello World', { pattern: 'world', mode: 'contains', case: false })).toBe(true);
  });
  it('respects case=true', () => {
    expect(matchRule('Hello World', { pattern: 'world', mode: 'contains', case: true })).toBe(false);
    expect(matchRule('Hello World', { pattern: 'World', mode: 'contains', case: true })).toBe(true);
  });
  it('returns false for empty text', () => {
    expect(matchRule('', { pattern: 'world', mode: 'contains' })).toBe(false);
  });
  it('returns false for empty pattern', () => {
    expect(matchRule('Hello', { pattern: '', mode: 'contains' })).toBe(false);
  });
});

describe('matchRule — exact mode', () => {
  it('matches exact text', () => {
    expect(matchRule('Rust', { pattern: 'rust', mode: 'exact', case: false })).toBe(true);
  });
  it('trims input before comparison', () => {
    expect(matchRule('  Rust  ', { pattern: 'rust', mode: 'exact', case: false })).toBe(true);
  });
  it('rejects partial match', () => {
    expect(matchRule('Rust Programming', { pattern: 'rust', mode: 'exact', case: false })).toBe(false);
  });
});

describe('matchRule — prefix / suffix mode', () => {
  it('prefix: matches start', () => {
    expect(matchRule('Rust programming', { pattern: 'rust', mode: 'prefix', case: false })).toBe(true);
    expect(matchRule('My Rust code', { pattern: 'rust', mode: 'prefix', case: false })).toBe(false);
  });
  it('suffix: matches end', () => {
    expect(matchRule('using async', { pattern: 'async', mode: 'suffix', case: false })).toBe(true);
    expect(matchRule('async fn', { pattern: 'async', mode: 'suffix', case: false })).toBe(false);
  });
});

describe('matchRule — word mode (boundary)', () => {
  it('matches whole word only', () => {
    expect(matchRule('I love AI tools', { pattern: 'AI', mode: 'word', case: false })).toBe(true);
  });
  it('does not match substring of larger word', () => {
    expect(matchRule('SaiD He', { pattern: 'AI', mode: 'word', case: false })).toBe(false);
    expect(matchRule('Painting', { pattern: 'AI', mode: 'word', case: false })).toBe(false);
  });
  it('escapes regex special chars in pattern', () => {
    expect(matchRule('version 1.0 released', { pattern: '1.0', mode: 'word', case: false })).toBe(true);
  });
});

describe('matchRule — regex mode', () => {
  it('matches regex pattern', () => {
    expect(matchRule('Rust 1.85 released', { pattern: 'Rust \\d+\\.\\d+', mode: 'regex', case: false })).toBe(true);
  });
  it('respects case flag', () => {
    expect(matchRule('rust', { pattern: 'Rust', mode: 'regex', case: true })).toBe(false);
    expect(matchRule('rust', { pattern: 'Rust', mode: 'regex', case: false })).toBe(true);
  });
  it('returns false on invalid regex (no throw)', () => {
    expect(matchRule('text', { pattern: '[unclosed', mode: 'regex' })).toBe(false);
  });
  it('supports anchors', () => {
    expect(matchRule('Rust release', { pattern: '^Rust', mode: 'regex', case: false })).toBe(true);
    expect(matchRule('Hello Rust', { pattern: '^Rust', mode: 'regex', case: false })).toBe(false);
  });
});

describe('getEventText — scope handling', () => {
  const ev = fixtureEvent();
  it('scope=title returns title only', () => {
    expect(getEventText(ev, 'title')).toBe(ev.content.title);
  });
  it('scope=summary returns summary only', () => {
    expect(getEventText(ev, 'summary')).toBe(ev.content.summary);
  });
  it('scope=source returns source name', () => {
    expect(getEventText(ev, 'source')).toBe('Hacker News');
  });
  it('scope=tags returns user+auto tags', () => {
    const txt = getEventText(ev, 'tags');
    expect(txt).toContain('rust');
    expect(txt).toContain('programming');
  });
  it('scope=all combines everything', () => {
    const txt = getEventText(ev, 'all');
    expect(txt).toContain('Rust 1.85');
    expect(txt).toContain('Hacker News');
    expect(txt).toContain('rust');
  });
});

describe('applyRules — watch actions', () => {
  it('highlight increases score by 30', () => {
    const ev = fixtureEvent();
    applyRules(ev, { watch: [{ pattern: 'rust', mode: 'contains', scope: 'title', action: 'highlight' }], block: [] });
    expect(ev.meta.score).toBe(80);
  });
  it('highlight caps at 100', () => {
    const ev = fixtureEvent({ meta: { score: 90, autoTags: [], userTags: [] } });
    applyRules(ev, { watch: [{ pattern: 'rust', mode: 'contains', scope: 'title', action: 'highlight' }], block: [] });
    expect(ev.meta.score).toBe(100);
  });
  it('star sets starred=true', () => {
    const ev = fixtureEvent();
    applyRules(ev, { watch: [{ pattern: 'rust', mode: 'contains', scope: 'all', action: 'star' }], block: [] });
    expect(ev.state.starred).toBe(true);
  });
  it('tag appends watch:pattern auto-tag', () => {
    const ev = fixtureEvent();
    applyRules(ev, { watch: [{ pattern: 'rust', mode: 'contains', scope: 'all', action: 'tag' }], block: [] });
    expect(ev.meta.autoTags).toContain('watch:rust');
  });
  it('non-matching rule has no effect', () => {
    const ev = fixtureEvent();
    const before = ev.meta.score;
    applyRules(ev, { watch: [{ pattern: 'python', mode: 'contains', scope: 'all', action: 'highlight' }], block: [] });
    expect(ev.meta.score).toBe(before);
    expect(ev.meta.keywordMatched).toBeUndefined();
  });
});

describe('applyRules — block actions', () => {
  it('archive sets archived=true', () => {
    const ev = fixtureEvent();
    const { skip } = applyRules(ev, { watch: [], block: [{ pattern: 'rust', mode: 'contains', scope: 'all', action: 'archive' }] });
    expect(skip).toBe(false);
    expect(ev.state.archived).toBe(true);
    expect(ev.state.archivedAt).toBeGreaterThan(0);
  });
  it('delete returns skip=true', () => {
    const ev = fixtureEvent();
    const { skip } = applyRules(ev, { watch: [], block: [{ pattern: 'rust', mode: 'contains', scope: 'all', action: 'delete' }] });
    expect(skip).toBe(true);
  });
  it('delete short-circuits later rules', () => {
    const ev = fixtureEvent();
    applyRules(ev, { watch: [], block: [
      { pattern: 'rust', mode: 'contains', scope: 'all', action: 'delete' },
      { pattern: 'rust', mode: 'contains', scope: 'all', action: 'archive' },
    ] });
    expect(ev.state.archived).toBe(false); // delete先勝、archive未実行
  });
  it('block runs before watch', () => {
    const ev = fixtureEvent();
    const { skip } = applyRules(ev, {
      watch: [{ pattern: 'rust', mode: 'contains', scope: 'all', action: 'star' }],
      block: [{ pattern: 'rust', mode: 'contains', scope: 'all', action: 'delete' }],
    });
    expect(skip).toBe(true);
    expect(ev.state.starred).toBe(false); // watch未実行
  });
});

describe('applyRules — keywordMatched metadata', () => {
  it('records matched patterns', () => {
    const ev = fixtureEvent();
    applyRules(ev, {
      watch: [{ pattern: 'rust', mode: 'contains', scope: 'all', action: 'highlight' }],
      block: [{ pattern: 'crypto', mode: 'contains', scope: 'all', action: 'archive' }],
    });
    expect(ev.meta.keywordMatched.watch).toEqual(['rust']);
    expect(ev.meta.keywordMatched.block).toEqual([]); // 'crypto' not in event
  });
  it('does not set keywordMatched when no rules match', () => {
    const ev = fixtureEvent();
    applyRules(ev, { watch: [{ pattern: 'java', mode: 'contains', scope: 'all', action: 'star' }], block: [] });
    expect(ev.meta.keywordMatched).toBeUndefined();
  });
});

describe('applyRules — integration scenarios', () => {
  it('multiple watch rules accumulate', () => {
    const ev = fixtureEvent();
    applyRules(ev, {
      watch: [
        { pattern: 'rust', mode: 'contains', scope: 'all', action: 'highlight' },
        { pattern: 'async', mode: 'contains', scope: 'all', action: 'star' },
      ],
      block: [],
    });
    expect(ev.meta.score).toBe(80);
    expect(ev.state.starred).toBe(true);
  });
  it('scope=title regex finds version pattern', () => {
    const ev = fixtureEvent();
    applyRules(ev, {
      watch: [{ pattern: '\\d+\\.\\d+', mode: 'regex', scope: 'title', case: false, action: 'highlight' }],
      block: [],
    });
    expect(ev.meta.keywordMatched.watch).toContain('\\d+\\.\\d+');
  });
  it('blocks NFT-related sources by scope=source', () => {
    const ev = fixtureEvent({ source: { id: 'x', type: 'rss', name: 'NFT Daily', url: '' } });
    const { skip } = applyRules(ev, { watch: [], block: [{ pattern: 'NFT', mode: 'word', scope: 'source', case: false, action: 'delete' }] });
    expect(skip).toBe(true);
  });
  it('empty rules: no-op', () => {
    const ev = fixtureEvent();
    const before = JSON.stringify(ev);
    applyRules(ev, { watch: [], block: [] });
    expect(JSON.stringify(ev)).toBe(before);
  });
});
