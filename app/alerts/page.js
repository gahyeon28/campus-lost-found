'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth, useAuth } from '@/components/AuthProvider';
import { formatDateTime } from '@/components/ItemCard';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, COLORS } from '@/lib/constants';
import { BUILDINGS } from '@/lib/campus';

const EMPTY = { keywords: '', category: '', color: '', building: '', lost_from: '' };

function Alerts() {
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [watches, setWatches] = useState([]);
  const [notis, setNotis] = useState([]);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const [w, n] = await Promise.all([
      sb.from('watches').select('*').order('created_at', { ascending: false }),
      sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    setWatches(w.data || []);
    setNotis(n.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

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
    load();
  }

  async function toggle(w) {
    await supabase().from('watches').update({ active: !w.active }).eq('id', w.id);
    load();
  }

  async function remove(w) {
    await supabase().from('watches').delete().eq('id', w.id);
    load();
  }

  async function readAll() {
    await supabase().from('notifications').update({ read: true }).eq('read', false);
    load();
  }

  return (
    <>
      <h2>🔔 분실 알림</h2>
      <p className="muted">잃어버린 물건의 키워드를 등록해 두면, 조건이 맞는 습득물이 올라올 때 메일과 알림함으로 알려드려요.</p>

      <form onSubmit={add} className="card">
        <label>키워드 * (쉼표로 구분, 하나라도 포함되면 알림)
          <input value={form.keywords} onChange={set('keywords')} placeholder="예: 에어팟, 이어폰" />
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
          <label>건물
            <select value={form.building} onChange={set('building')}>
              <option value="">상관없음</option>
              {BUILDINGS.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          </label>
          <label>잃어버린 날짜 (이후 습득분만)
            <input type="date" value={form.lost_from} onChange={set('lost_from')} />
          </label>
        </div>
        {msg && <p className={msg.error ? 'error' : 'ok'}>{msg.error || msg.ok}</p>}
        <button className="primary">알림 등록</button>
      </form>

      <div className="section card">
        <h3>내 알림 조건</h3>
        {watches.length === 0 ? <p className="muted">등록된 알림이 없어요.</p> : (
          <div className="list">
            {watches.map((w) => (
              <div key={w.id} className="list-item">
                <div>
                  <b>{w.keywords.join(', ')}</b>
                  <div className="muted">
                    {[w.category, w.color, w.building, w.lost_from && `${w.lost_from} 이후`].filter(Boolean).join(' · ') || '추가 조건 없음'}
                    {!w.active && ' · 꺼짐'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => toggle(w)}>{w.active ? '끄기' : '켜기'}</button>
                  <button className="danger" onClick={() => remove(w)}>삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>알림함</h3>
          {notis.some((n) => !n.read) && <button className="link" onClick={readAll}>모두 읽음</button>}
        </div>
        {notis.length === 0 ? <p className="muted">받은 알림이 없어요.</p> : (
          <div className="list">
            {notis.map((n) => (
              <Link key={n.id} href={n.item_id ? `/items/${n.item_id}` : '#'} className={`list-item ${n.read ? '' : 'unread'}`}>
                <div>
                  <div>{n.read ? '' : '🔵 '}{n.title}</div>
                  <div className="muted">{n.body}</div>
                </div>
                <span className="muted">{formatDateTime(n.created_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function Page() {
  return <RequireAuth><Alerts /></RequireAuth>;
}
