import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags, askVisionModel, visionProvider } from '../lib/tagging.js';

test('키가 있는 쪽으로 요청하고 Gemini를 우선한다', async () => {
  assert.equal(visionProvider({}), null);
  assert.equal(visionProvider({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }), 'gemini');

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = url.includes('googleapis')
      ? { candidates: [{ content: { parts: [{ text: '{"category":"가방"}' }] } }] }
      : { content: [{ type: 'text', text: '{"category":"의류"}' }] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    assert.equal(parseTags(await askVisionModel('IMG', { GEMINI_API_KEY: 'g' })).category, '가방');
    assert.match(calls[0].url, /gemini-flash-lite-latest:generateContent$/);
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'g');
    assert.equal(JSON.parse(calls[0].init.body).contents[0].parts[0].inline_data.data, 'IMG');

    assert.equal(parseTags(await askVisionModel('IMG', { ANTHROPIC_API_KEY: 'a' })).category, '의류');
    assert.match(calls[1].url, /anthropic/);

    globalThis.fetch = async () => new Response('quota', { status: 429 });
    await assert.rejects(askVisionModel('IMG', { GEMINI_API_KEY: 'g' }), (e) => e.status === 429);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('모델 응답의 JSON만 꺼내고 허용된 값만 남긴다', () => {
  const t = parseTags('결과입니다:\n```json\n{"title":"흰색 에어팟","category":"전자기기","color":"흰색","brand":"Apple","tags":["이어폰","무선"],"description":"케이스","quiz_recommended":true}\n```');
  assert.equal(t.category, '전자기기');
  assert.equal(t.color, '흰색');
  assert.deepEqual(t.tags, ['이어폰', '무선']);
  assert.equal(t.quiz_recommended, true);
});

test('목록에 없는 카테고리/색상은 기본값으로', () => {
  const t = parseTags('{"title":"x","category":"음식","color":"하늘색","tags":"아님"}');
  assert.equal(t.category, '기타');
  assert.equal(t.color, '');
  assert.deepEqual(t.tags, []);
});

test('JSON이 아니면 null', () => {
  assert.equal(parseTags('모르겠어요'), null);
  assert.equal(parseTags('{깨진 json'), null);
});
