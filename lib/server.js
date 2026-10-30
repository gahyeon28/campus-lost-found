// API 라우트(서버)에서만 쓰는 함수
import { createClient } from '@supabase/supabase-js';
import { isSchoolEmail } from './constants.js';

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL;

// 요청의 로그인 토큰을 검증하고 학교 메일 사용자만 돌려준다.
export async function requireUser(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const sb = createClient(url(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user || !isSchoolEmail(data.user.email)) return null;
  return data.user;
}

// RLS를 우회하는 관리자 클라이언트. 절대 브라우저로 보내면 안 된다.
export function adminClient() {
  return createClient(url(), process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export function json(body, status = 200) {
  return Response.json(body, { status });
}
