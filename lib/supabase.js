import { createClient } from '@supabase/supabase-js';

let client;

// 브라우저용 클라이언트. 빌드(사전 렌더링) 중에는 만들지 않도록 처음 호출될 때 생성한다.
export function supabase() {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
  return client;
}

export function imageUrl(path) {
  return path ? supabase().storage.from('item-images').getPublicUrl(path).data.publicUrl : null;
}

// API 라우트 호출 시 로그인 토큰을 같이 보낸다.
export async function authedFetch(url, body) {
  const { data } = await supabase().auth.getSession();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `요청 실패 (${res.status})`);
  return json;
}
