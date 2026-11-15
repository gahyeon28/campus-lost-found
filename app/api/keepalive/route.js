// Vercel Cron이 5일마다(매월 1·6·11·16·21·26·31일) 호출: Supabase 무료 프로젝트가 7일간 요청이 없어 일시 정지되는 것을 막는다.
import { adminClient, json } from '@/lib/server';

export async function GET(req) {
  // CRON_SECRET을 설정하면 Vercel이 보내는 요청만 받는다.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  const { error } = await adminClient().from('allowed_domains').select('domain', { head: true, count: 'exact' });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, at: new Date().toISOString() });
}
