import { CATEGORIES, COLORS } from './constants.js';

export const TAG_PROMPT = `이 사진은 대학교 캠퍼스에서 주운 분실물입니다. 분실물 게시판 등록 폼을 채울 정보를 JSON 하나로만 답하세요. 다른 글은 쓰지 마세요.
{
  "title": "한국어 물건 이름, 20자 이내 (예: 흰색 에어팟 프로 케이스)",
  "category": ${JSON.stringify(CATEGORIES)} 중 하나,
  "color": ${JSON.stringify(COLORS)} 중 가장 가까운 하나,
  "brand": "보이는 브랜드명, 모르면 빈 문자열",
  "tags": ["검색에 도움이 될 한국어 키워드 3~6개"],
  "description": "겉으로 보이는 특징 한두 문장",
  "quiz_recommended": 고가품이거나 특징이 뚜렷해서 본인 확인 퀴즈가 필요하면 true
}
학생증·카드 번호, 이름 같은 개인정보는 절대 적지 마세요.`;

// GEMINI_API_KEY(무료 한도 있음)가 있으면 Gemini, 없고 ANTHROPIC_API_KEY가 있으면 Claude를 쓴다.
export function visionProvider(env = process.env) {
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.ANTHROPIC_API_KEY) return 'claude';
  return null;
}

async function post(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = new Error(`${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// base64 JPEG 사진을 보내고 모델의 답변 텍스트를 돌려준다.
export async function askVisionModel(image, env = process.env) {
  if (visionProvider(env) === 'gemini') {
    const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest';
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': env.GEMINI_API_KEY },
      {
        contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: TAG_PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 600 },
      },
    );
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  }
  const data = await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    {
      model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: TAG_PROMPT },
        ],
      }],
    },
  );
  return data.content?.map((c) => c.text || '').join('') || '';
}

// 모델 응답에서 JSON을 꺼내 허용된 값만 남긴다. 실패하면 null.
export function parseTags(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    title: str(raw.title, 60),
    category: CATEGORIES.includes(raw.category) ? raw.category : '기타',
    color: COLORS.includes(raw.color) ? raw.color : '',
    brand: str(raw.brand, 40),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => str(t, 20)).filter(Boolean).slice(0, 10) : [],
    description: str(raw.description, 300),
    quiz_recommended: raw.quiz_recommended === true,
  };
}
