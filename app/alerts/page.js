'use client';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/AuthProvider';
import AlertForm from '@/components/AlertForm';
import { supabase } from '@/lib/supabase';

function Alerts() {
  const [watches, setWatches] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase().from('watches').select('*').order('created_at', { ascending: false });
    setWatches(data || []);
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
                    {[w.category, w.color, w.buildings && `동선: ${w.buildings.join(' → ')}`, w.lost_from && `${w.lost_from} 이후`].filter(Boolean).join(' · ') || '추가 조건 없음'}
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
    </>
  );
}

export default function Page() {
  return <RequireAuth><Alerts /></RequireAuth>;
}
