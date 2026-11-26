'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth, useAuth } from '@/components/AuthProvider';
import AlertForm from '@/components/AlertForm';
import { formatDateTime } from '@/components/ItemCard';
import { supabase } from '@/lib/supabase';

function Alerts() {
  const { user } = useAuth();
  const [watches, setWatches] = useState([]);
  const [notis, setNotis] = useState([]);

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
      <AlertForm onSaved={load} />

      <div className="section card">
        <h3>내 알림 조건 ({watches.length}건)</h3>
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
