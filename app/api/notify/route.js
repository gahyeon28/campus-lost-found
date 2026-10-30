// 습득물 등록 직후 호출: 조건에 맞는 분실 알림 구독자에게 알림함 + 메일 발송
import nodemailer from 'nodemailer';
import { requireUser, adminClient, json } from '@/lib/server';

export async function POST(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: '학교 이메일로 로그인해야 합니다.' }, 401);
  const { itemId } = await req.json().catch(() => ({}));
  if (!Number.isInteger(itemId)) return json({ error: '잘못된 요청입니다.' }, 400);

  // 본인 게시물인지, 이미 발송했는지는 DB 함수가 확인하고 한 번만 결과를 돌려준다.
  const admin = adminClient();
  const { data: targets, error } = await admin.rpc('notify_matches', { p_item_id: itemId, p_owner: user.id });
  if (error) return json({ error: error.message }, 500);
  if (!targets?.length || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return json({ matched: targets?.length || 0, emailed: 0 });
  }

  const { data: item } = await admin.from('items').select('title, building, location_detail, storage_detail').eq('id', itemId).single();
  const link = `${new URL(req.url).origin}/items/${itemId}`;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const results = await Promise.allSettled(targets.map((t) => transport.sendMail({
    from: `"교내 분실물 스마트 찾기" <${process.env.SMTP_USER}>`,
    to: t.email,
    subject: `[분실물 알림] '${t.keywords.join(', ')}'와 비슷한 습득물이 등록됐어요`,
    html: `<p>등록해 둔 키워드 <b>${esc(t.keywords.join(', '))}</b>와 비슷한 물건이 습득되었습니다.</p>
      <p><b>${esc(item.title)}</b><br>📍 ${esc(item.building)} ${esc(item.location_detail)}<br>🏢 ${esc(item.storage_detail)}</p>
      <p><a href="${link}">게시물 확인하기</a></p>
      <p style="color:#888;font-size:12px">알림을 그만 받으려면 사이트의 '분실 알림' 메뉴에서 끄세요.</p>`,
  })));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) console.error('메일 발송 실패', failed.map((f) => f.reason?.message));
  return json({ matched: targets.length, emailed: targets.length - failed.length });
}
