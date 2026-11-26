'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/AuthProvider';
import { formatDateTime } from '@/components/ItemCard';
import { supabase } from '@/lib/supabase';

function Inbox() {
  const [notis, setNotis] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase().from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    setNotis(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function readAll() {
    await supabase().from('notifications').update({ read: true }).eq('read', false);
    load();
  }

  return (
    <>
      <section className="card inbox-head">
        <h2>📥 내 알림함</h2>
        <p className="muted">등록한 분실 알림 조건과 일치하는 습득물이 올라오면 이곳과 학교 메일로 안내됩니다.</p>
      </section>

      {notis === null ? <p className="muted center">불러오는 중…</p>
        : notis.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-icon">📥</div>
            <h2>도착한 알림이 아직 없습니다</h2>
            <p className="muted">분실 알림 조건을 먼저 등록한 뒤 일치하는 습득물을 등록하면 알림이 자동으로 쌓입니다.</p>
            <div className="empty-actions">
              <Link href="/alerts" className="btn primary">🔔 분실 알림 등록</Link>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="inbox-bar">
              <span className="muted">총 {notis.length}건</span>
              {notis.some((n) => !n.read) && <button className="link" onClick={readAll}>모두 읽음</button>}
            </div>
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
          </div>
        )}
    </>
  );
}

export default function Page() {
  return <RequireAuth><Inbox /></RequireAuth>;
}
