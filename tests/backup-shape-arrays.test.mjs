// Neus — restore validation must cover the array/object fields the UI dereferences.
//
// Reproduced against the real validators extracted from index.html:
//   meta.userTags = {}  -> validEvent() returned true, then renderTags() hit
//                          "(ev.meta.userTags || []).map is not a function"
//   links = {}          -> validEvent() returned true, then renderVaultLinks() hit
//                          "(ev.links || []).filter is not a function"
// A malformed backup is destructive even when the write is atomic: the transaction succeeds,
// and the malformed record is what every later render reads.

import { describe, it, expect } from 'vitest';
import { extractConst, evaluate, source } from './helpers/from-source.mjs';

const html = source();
const { validEvent, validWord } = evaluate(
  [extractConst('safeHref'), extractConst('isObj'), extractConst('isStrArray'), extractConst('optStrArray'), extractConst('optNum'), extractConst('validEvent'), extractConst('validWord')].join('\n'),
  ['validEvent', 'validWord']);

const baseEvent = () => ({
  id: 'e1', timestamp: 1, hash: 'h1', url: 'https://example.test/a',
  content: { title: 'title', snippet: 'snippet' },
  source: { id: 's1', type: 'rss', name: 'source' },
  meta: { autoTags: [], userTags: [], score: 50, keywordMatched: { watch: ['rust'], block: [] } },
  user: {}, state: { read: false, starred: false, archived: false }, links: [],
});

const baseWord = () => ({
  id: 'w1', term: 'rust', normalized: 'rust', lang: 'en', note: 'why?',
  sources: { wikipedia: true }, enabled: true, createdAt: 1, reviewedAt: 1,
  verdict: { status: 'open', note: '' }, falsifier: '',
  questions: [{ id: 'q1', text: 'is it safe?', createdAt: 1, resolvedAt: null }],
  questionHistory: [{ text: 'why?', at: 1 }],
  verdictHistory: [{ status: 'open', note: '', at: null }], wiki: null, lastErrors: null,
});

const mutate = (base, path, value) => {
  const out = base();
  let host = out;
  for (const key of path.slice(0, -1)) host = host[key];
  host[path[path.length - 1]] = value;
  return out;
};

describe('backup event shape — arrays the render path dereferences', () => {
  it('accepts a well-formed event and the legacy-tolerant minimum shape', () => {
    expect(validEvent(baseEvent())).toBe(true);
    expect(validEvent({ id: 'old', timestamp: 1, content: {}, source: {}, state: {}, meta: {} })).toBe(true);
  });

  it.each([
    ['userTags is an object', ['meta', 'userTags'], { not: 'an array' }],
    ['autoTags is a string', ['meta', 'autoTags'], 'not-an-array'],
    ['links is an object', ['links'], { not: 'an array' }],
    ['links contains a non-string', ['links'], ['https://example.test', 42]],
    ['keywordMatched is a string', ['meta', 'keywordMatched'], 'bad'],
    ['keywordMatched.watch is an object', ['meta', 'keywordMatched'], { watch: {}, block: [] }],
    ['keywordMatched.block contains a non-string', ['meta', 'keywordMatched'], { watch: [], block: ['ok', 7] }],
  ])('rejects a backup when %s', (_name, path, value) => {
    expect(validEvent(mutate(baseEvent, path, value))).toBe(false);
  });

  it('the rejected shapes are reachable crashes, not theoretical type purity', () => {
    const badTags = mutate(baseEvent, ['meta', 'userTags'], { not: 'an array' });
    expect(() => (badTags.meta.userTags || []).map(String)).toThrow(TypeError);
    const badLinks = mutate(baseEvent, ['links'], { not: 'an array' });
    expect(() => (badLinks.links || []).filter(Boolean)).toThrow(TypeError);
    const badLinkItem = mutate(baseEvent, ['links'], [42]);
    expect(() => (badLinkItem.links || []).filter(l => l.startsWith('vault:'))).toThrow(TypeError);
  });
});

describe('backup word shape — arrays and scalars the word view dereferences', () => {
  it('accepts a well-formed word and a minimal older word shape', () => {
    expect(validWord(baseWord())).toBe(true);
    expect(validWord({ id: 'old', term: 'old', normalized: 'old' })).toBe(true);
  });

  it.each([
    ['questions is an object', ['questions'], { not: 'an array' }],
    ['questions contains null', ['questions'], [null]],
    ['a question has no text string', ['questions'], [{ id: 'q1', text: 42 }]],
    ['questionHistory is an object', ['questionHistory'], { not: 'an array' }],
    ['questionHistory contains null', ['questionHistory'], [null]],
    ['verdictHistory is an object', ['verdictHistory'], { not: 'an array' }],
    ['verdictHistory contains null', ['verdictHistory'], [null]],
    ['note is a number', ['note'], 42],
    ['falsifier is a number', ['falsifier'], 42],
    ['sources is a string', ['sources'], 'bad'],
  ])('rejects a backup when %s', (_name, path, value) => {
    expect(validWord(mutate(baseWord, path, value))).toBe(false);
  });

  it('the rejected word shapes break the same rendering paths the backup restores into', () => {
    const badQuestions = mutate(baseWord, ['questions'], { not: 'an array' });
    expect(() => (badQuestions.questions || []).filter(q => !q.resolvedAt)).toThrow(TypeError);
    const nullQuestion = mutate(baseWord, ['questions'], [null]);
    expect(() => (nullQuestion.questions || []).map(q => q.text)).toThrow(TypeError);
    const badNote = mutate(baseWord, ['note'], 42);
    expect(() => badNote.note.slice(0, 80)).toThrow(TypeError);
  });
});

describe('wiring — the restore path still rejects before replacing anything', () => {
  it('runs the strengthened validators before Store.replaceAll', () => {
    const validateAt = html.indexOf('backup has malformed events');
    const replaceAt = html.indexOf('await Store.replaceAll({events:dump.events');
    expect(validateAt).toBeGreaterThan(-1);
    expect(replaceAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(replaceAt);
  });
});
