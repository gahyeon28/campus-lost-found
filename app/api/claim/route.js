// 수령 신청: 퀴즈 답이 정답과 글자로 같으면 바로, 다르면 AI가 같은 뜻인지 판단한 뒤 DB에 결과를 기록한다.
// 정답은 이 서버 안에서만 읽고 브라우저로 보내지 않는다.
import { requireUser, adminClient, json } from '@/lib/server';
import { visionProvider } from '@/lib/tagging';
import { MAX_ANSWER_LENGTH, exactMatch, judgeAnswer } from '@/lib/quiz';

export async function POST(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: '학교 이메일로 로그인해야 합니다.' }, 401);
  const { itemId, answer } = await req.json().catch(() => ({}));
  if (!Number.isInteger(itemId)) return json({ error: '잘못된 요청입니다.' }, 400);

  const admin = adminClient();
  const { data: check, error } = await admin.rpc('claim_check', { p_item_id: itemId, p_user_id: user.id });
  if (error) return json({ error: error.message }, 500);
  if (!check.ok) return json(check);

  let correct = true;
  if (check.quiz) {
    const ans = String(answer ?? '').trim();
    if (!ans) return json({ ok: false, message: '정답을 입력해주세요.' });
    if (ans.length > MAX_ANSWER_LENGTH) return json({ ok: false, message: `답변은 ${MAX_ANSWER_LENGTH}자 이내로 적어주세요.` });

    const [{ data: item }, { data: secret }] = await Promise.all([
      admin.from('items').select('quiz_question').eq('id', itemId).single(),
      admin.from('item_secrets').select('answer').eq('item_id', itemId).single(),
    ]);
    if (!item || !secret) return json({ error: '퀴즈 정보를 찾을 수 없습니다.' }, 500);

    correct = exactMatch(ans, secret.answer);
    if (!correct && visionProvider()) {
      try {
        correct = await judgeAnswer(item.quiz_question, secret.answer, ans);
      } catch (err) {
        console.error('퀴즈 AI 판단 실패', err.message);
        // AI 쪽 문제로 기회를 깎지 않는다
        return json({ ok: false, retry: true, message: 'AI가 답을 확인하지 못했어요. 잠시 후 다시 시도해주세요. 남은 기회는 줄지 않았어요.' });
      }
    }
  }

  const { data: result, error: claimError } = await admin.rpc('claim_item_judged', {
    p_item_id: itemId, p_user_id: user.id, p_correct: correct,
  });
  if (claimError) return json({ error: claimError.message }, 500);
  return json(result);
}
