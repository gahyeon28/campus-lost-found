'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { SCHOOL_DOMAIN, isSchoolEmail } from '@/lib/constants';

export default function LoginPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  async function sendCode(e) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!isSchoolEmail(addr)) return setMsg({ error: `학교 이메일(@${SCHOOL_DOMAIN})만 사용할 수 있어요.` });
    setBusy(true);
    const { error } = await supabase().auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return setMsg({ error: error.message.includes('Database error') ? '학교 이메일로만 가입할 수 있어요.' : error.message });
    setSent(true);
    setMsg({ ok: '인증 코드를 보냈어요. 메일함(스팸함 포함)을 확인해주세요.' });
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setMsg({ error: '코드가 맞지 않거나 만료되었어요.' });
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="hero">
        <h1>🔎 교내 분실물 스마트 찾기</h1>
        <p>학교 이메일로 로그인한 학생·교직원만 이용할 수 있어요.</p>
      </div>
      <div className="card">
        {!sent ? (
          <form onSubmit={sendCode}>
            <label>
              학교 이메일
              <input type="email" required placeholder={`@${SCHOOL_DOMAIN}`} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <button className="primary" disabled={busy}>{busy ? '보내는 중…' : '인증 코드 받기'}</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="muted">{email} 로 보낸 코드를 입력하세요.</p>
            <label>
              인증 코드
              <input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,10}" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className="primary" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(''); setMsg(null); }}>이메일 다시 입력</button>
          </form>
        )}
        {msg && <p className={msg.error ? 'error' : 'ok'}>{msg.error || msg.ok}</p>}
      </div>
    </div>
  );
}
