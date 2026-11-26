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
  const [agreeReq, setAgreeReq] = useState(false); // 필수: 이메일 수집·이용, 처리방침
  const [agreeAi, setAgreeAi] = useState(false); // 선택: 사진을 AI 자동 태깅 서비스로 전송

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  async function sendCode(e) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!agreeReq) return setMsg({ error: '개인정보 수집·이용에 동의해주세요.' });
    if (!isSchoolEmail(addr)) return setMsg({ error: `학교 이메일(@${SCHOOL_DOMAIN})만 사용할 수 있어요.` });
    setBusy(true);
    const { error } = await supabase().auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true, data: { consent_required_at: new Date().toISOString(), consent_ai: agreeAi } } });
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
    <div className="login-wrap">
      <div className="login-brand">
        <span className="login-logo">📍</span>
        <b className="login-name">가천 <span>분실물 찾기</span></b>
      </div>

      <section className="login-hero">
        <span className="hero-pill">✨ AI 자동 태깅 · 조건 기반 분실 알림 · 본인 확인 퀴즈</span>
        <h1 className="hero-title">가천대 구성원 전용 분실물 플랫폼</h1>
        <p>분실 조건만 등록하면 일치하는 습득물이 올라올 때 바로 알려드립니다.</p>
      </section>

      <div className="card login-card">
        <div className="login-icon">✉️</div>
        <h2>학교 이메일 인증 로그인</h2>
        <p className="muted">허위 게시물 및 무단 수령 방지를 위해 <b style={{ color: 'var(--text)' }}>@{SCHOOL_DOMAIN}</b> 계정으로만 로그인할 수 있습니다.</p>

        {!sent ? (
          <form onSubmit={sendCode} className="stack">
            <label>
              가천대학교 웹메일 주소
              <input type="email" required placeholder={`예: gachon2026@${SCHOOL_DOMAIN}`} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label className="check">
              <input type="checkbox" checked={agreeReq} onChange={(e) => setAgreeReq(e.target.checked)} />
              <span>[필수] 학교 이메일 수집·이용에 동의합니다</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={agreeAi} onChange={(e) => setAgreeAi(e.target.checked)} />
              <span>[선택] 등록한 사진을 AI 자동 태깅 서비스(Gemini·Claude)로 보내는 데 동의합니다</span>
            </label>
            <button className="primary gradient" disabled={busy || !agreeReq}>{busy ? '보내는 중…' : '6자리 인증 코드 받기 →'}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack">
            <p className="muted">{email} 로 보낸 코드를 입력하세요.</p>
            <label>
              인증 코드
              <input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,10}" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className="primary gradient" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(''); setMsg(null); }}>이메일 다시 입력</button>
          </form>
        )}
        {msg && <p className={msg.error ? 'error' : 'ok'}>{msg.error || msg.ok}</p>}
      </div>
    </div>
  );
}
