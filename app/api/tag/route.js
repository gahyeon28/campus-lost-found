// 사진 → 이미지 AI 분석(Gemini 또는 Claude) → 등록 폼 자동 입력값
import { requireUser, adminClient, json } from '@/lib/server';
import { askVisionModel, parseTags, visionProvider } from '@/lib/tagging';

export async function POST(req) {
  if (!visionProvider()) return json({ error: 'AI 자동 태깅이 설정되지 않았어요. 직접 입력해주세요.' }, 503);
  const user = await requireUser(req);
  if (!user) return json({ error: '학교 이메일로 로그인해야 합니다.' }, 401);
  // 로그인 화면에서 AI 전송에 동의한 사용자의 사진만 외부 AI로 보낸다
  if (user.user_metadata?.consent_ai !== true) return json({ error: 'AI 자동 입력에 동의하지 않아 직접 입력해주세요.', code: 'NO_CONSENT' }, 403);

  const { image } = await req.json().catch(() => ({}));
  if (typeof image !== 'string' || image.length < 100 || image.length > 4_000_000) {
    return json({ error: '사진이 없거나 너무 큽니다.' }, 400);
  }

  // 무료 한도를 한 사람이 다 쓰지 못하게 1인당 하루 사용 횟수를 제한한다.
  const limit = Number(process.env.TAG_DAILY_LIMIT) || 20;
  const { data: allowed, error: quotaError } = await adminClient().rpc('consume_tag_quota', { p_user_id: user.id, p_limit: limit });
  if (quotaError) return json({ error: 'AI 사용량을 확인하지 못했어요. 직접 입력해주세요.' }, 500);
  if (!allowed) return json({ error: `오늘 AI 자동 입력(하루 ${limit}회)을 모두 썼어요. 직접 입력해주세요.` }, 429);

  let text;
  try {
    text = await askVisionModel(image);
  } catch (err) {
    console.error('Vision API error', err.message);
    const busy = err.status === 429;
    return json({ error: busy ? 'AI 무료 사용량이 잠시 초과됐어요. 잠시 후 다시 시도하거나 직접 입력해주세요.' : 'AI 분석에 실패했어요. 직접 입력해주세요.' }, busy ? 429 : 502);
  }
  const tags = parseTags(text);
  return tags ? json(tags) : json({ error: 'AI 응답을 이해하지 못했어요. 직접 입력해주세요.' }, 502);
}
