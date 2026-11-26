'use client';
// 분실 알림 조건 등록 폼 (알림 페이지와 오버레이에서 공용)
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, COLORS } from '@/lib/constants';
import { BUILDINGS } from '@/lib/campus';

const EMPTY = { keywords: '', category: '', color: '', building: '', lost_from: '' };

export default function AlertForm({ onClose, onSaved }) {
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault();
    const keywords = form.keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 10);
    if (!keywords.length) return setMsg({ error: '키워드를 하나 이상 입력해주세요.' });
    const { error } = await supabase().from('watches').insert({
      keywords,
      category: form.category || null,
      color: form.color || null,
      building: form.building || null,
      lost_from: form.lost_from || null,
    });
    if (error) return setMsg({ error: error.message });
    setForm(EMPTY);
    setMsg({ ok: `알림을 등록했어요. 비슷한 습득물이 올라오면 ${user.email} 로 알려드릴게요.` });
    onSaved?.();
  }

  return (
    <form onSubmit={add} className="form-shell">
      <div className="form-head">
        <h2>🔔 조건 기반 분실 알림 등록</h2>
        {onClose && <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>✕</button>}
      </div>
      <p className="muted">키워드, 카테고리, 색상, 건물·광장 조건을 저장해 두면 일치하는 습득물이 등록될 때 학교 메일과 내 알림함으로 즉시 알려드립니다. "에어팟"으로 등록하면 "버즈", "이어폰"처럼 비슷한 말이 들어간 물건도 찾아요.</p>

      <div className="form-body stack">
        <label>물건 키워드 * (쉼표로 구분, 하나라도 포함되면 알림)
          <input value={form.keywords} onChange={set('keywords')} placeholder="예: 스마트폰, 이어폰, 카드지갑" />
        </label>
        <div className="row">
          <label>카테고리
            <select value={form.category} onChange={set('category')}>
              <option value="">상관없음</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>색상
            <select value={form.color} onChange={set('color')}>
              <option value="">상관없음</option>
              {COLORS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>예상 분실 건물·광장
            <select value={form.building} onChange={set('building')}>
              <option value="">전체 건물·광장</option>
              {BUILDINGS.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          </label>
          <label>잃어버린 날짜 (이후 습득분만)
            <input type="date" value={form.lost_from} onChange={set('lost_from')} />
          </label>
        </div>

        <div className="box purple">
          <b>💡 분실 알림 안내</b>
          <p style={{ margin: '6px 0 0' }}>• 표현 차이로 누락되지 않도록 <b>카테고리와 색상을 함께 선택</b>해 두시는 것을 권장합니다.</p>
          <p style={{ margin: '4px 0 0' }}>• 발송된 알림 메일이 스팸함으로 분류될 수 있으므로 가천대 웹메일 스팸함도 함께 확인해 주세요.</p>
        </div>

        {msg && <p className={msg.error ? 'error' : 'ok'}>{msg.error || msg.ok}</p>}
        <div className="form-actions">
          {onClose ? <button type="button" className="btn" onClick={onClose}>취소</button> : <span />}
          <button className="primary">분실 알림 조건 저장하기</button>
        </div>
      </div>
    </form>
  );
}
