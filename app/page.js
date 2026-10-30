'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth, useAuth } from '@/components/AuthProvider';
import ItemCard from '@/components/ItemCard';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, COLORS, STATUSES } from '@/lib/constants';
import { BUILDINGS } from '@/lib/campus';

const EMPTY = { category: '', color: '', building: '', status: '', q: '', mine: false };

function Feed() {
  const { user } = useAuth();
  const [f, setF] = useState({ ...EMPTY, status: '보관중' });
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let query = supabase().from('items_view').select('*').order('found_at', { ascending: false }).limit(200);
    if (f.category) query = query.eq('category', f.category);
    if (f.color) query = query.eq('color', f.color);
    if (f.building) query = query.eq('building', f.building);
    if (f.status) query = query.eq('display_status', f.status);
    if (f.mine) query = query.eq('owner_id', user.id);
    const q = f.q.replace(/[,()%*\\]/g, ' ').trim(); // PostgREST or() 문법 깨지는 문자 제거
    if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,brand.ilike.%${q}%`);

    let alive = true;
    const t = setTimeout(() => {
      query.then(({ data, error }) => {
        if (!alive) return; // 필터를 빠르게 바꿨을 때 늦게 온 이전 결과 무시
        setError(error?.message || null);
        setItems(data || []);
      });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [f, user.id]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <>
      <div className="hero">
        <h1>🔎 교내 습득물 피드</h1>
        <p>잃어버린 물건이 있나요? 아래에서 찾아보고, 없으면 <Link href="/alerts"><b>분실 알림</b></Link>을 걸어두세요.</p>
      </div>

      <div className="filters">
        <input placeholder="검색 (예: 에어팟, 지갑)" value={f.q} onChange={set('q')} />
        <select value={f.category} onChange={set('category')}>
          <option value="">전체 카테고리</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={f.color} onChange={set('color')}>
          <option value="">전체 색상</option>
          {COLORS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={f.building} onChange={set('building')}>
          <option value="">전체 건물</option>
          {BUILDINGS.map((b) => <option key={b.name}>{b.name}</option>)}
        </select>
        <select value={f.status} onChange={set('status')}>
          <option value="">전체 상태</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={f.mine} onChange={set('mine')} /> 내가 등록한 것만</label>
      </div>

      {error && <p className="error">{error}</p>}
      {items === null ? <p className="muted center">불러오는 중…</p>
        : items.length === 0 ? <p className="muted center">조건에 맞는 물건이 없어요.</p>
        : <div className="grid">{items.map((it) => <ItemCard key={it.id} item={it} />)}</div>}
    </>
  );
}

export default function Page() {
  return <RequireAuth><Feed /></RequireAuth>;
}
