'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth, useAuth } from '@/components/AuthProvider';
import ItemCard from '@/components/ItemCard';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, CATEGORY_EMOJI, COLORS, STATUSES } from '@/lib/constants';
import { BUILDINGS } from '@/lib/campus';

const EMPTY = { category: '', color: '', building: '', status: '', q: '', mine: false };

// 색상 칩의 점 색. 시안 기준이며 DB 색상값(COLORS)과 같은 이름을 쓴다.
const COLOR_HEX = {
  검정: '#0f172a', 흰색: '#ffffff', 회색: '#94a3b8', 빨강: '#ef4444', 주황: '#f97316', 노랑: '#eab308',
  초록: '#16a34a', 파랑: '#2563eb', 남색: '#1e3a8a', 보라: '#8b5cf6', 분홍: '#f472b6', 갈색: '#92400e',
  베이지: '#d6c7a8', 은색: 'linear-gradient(135deg, #e2e8f0, #94a3b8)', 금색: 'linear-gradient(135deg, #fde68a, #d97706)',
  투명: '#f1f5f9', 기타: '#cbd5e1',
};

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
  const pick = (k, v) => setF({ ...f, [k]: v });
  const hasFilter = Boolean(f.q || f.category || f.color || f.building || f.mine || f.status !== '보관중');

  return (
    <>
      <section className="hero">
        <span className="hero-pill">✨ 가천대 글로벌캠퍼스 전용 분실물 네트워크</span>
        <h1 className="hero-title">잃어버린 물건을 찾고 계신가요?</h1>
        <p>캠퍼스 건물 번호(1~22)·광장(A~F)과 색상 필터로 빠르게 검색하거나 분실 알림을 등록해 두세요.</p>
        <div className="hero-actions">
          <Link href="/alerts" className="btn ghost-light">🔔 분실 알림 설정</Link>
          <Link href="/items/new" className="btn white">+ 습득물 등록</Link>
        </div>
      </section>

      <section className="filter-panel">
        <input placeholder="찾는 물건을 검색하세요 (예: 에어팟, 지갑)" value={f.q} onChange={set('q')} />

        <div className="chips">
          <button type="button" className={`chip ${!f.category ? 'on' : ''}`} onClick={() => pick('category', '')}>전체</button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className={`chip ${f.category === c ? 'on' : ''}`} onClick={() => pick('category', c)}>
              {CATEGORY_EMOJI[c]} {c}
            </button>
          ))}
        </div>

        <div className="row">
          <select value={f.building} onChange={set('building')}>
            <option value="">전체 건물·광장</option>
            {BUILDINGS.map((b) => <option key={b.name}>{b.name}</option>)}
          </select>
          <select value={f.status} onChange={set('status')}>
            <option value="">전체 상태</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="color-row">
          <span className="color-label">🎨 색상</span>
          <div className="chips">
            <button type="button" className={`chip dark ${!f.color ? 'on' : ''}`} onClick={() => pick('color', '')}>전체</button>
            {COLORS.map((c) => (
              <button key={c} type="button" className={`chip dark ${f.color === c ? 'on' : ''}`} onClick={() => pick('color', c)}>
                <span className="swatch" style={{ background: COLOR_HEX[c] }} /> {c}
              </button>
            ))}
          </div>
        </div>

        <label className="check"><input type="checkbox" checked={f.mine} onChange={set('mine')} /> 내가 등록한 것만</label>
      </section>

      {error && <p className="error">{error}</p>}
      {items !== null && !error && <p className="count-label">등록된 습득물 <b>{items.length}</b>건</p>}

      {items === null ? <p className="muted center">불러오는 중…</p>
        : items.length === 0 ? (hasFilter
          ? <p className="muted center">조건에 맞는 물건이 없어요.</p>
          : (
            <div className="card empty-state">
              <div className="empty-icon">📦</div>
              <h2>아직 등록된 습득물이 없습니다</h2>
              <p className="muted">습득물을 등록하면 AI 자동 태깅으로 물건 정보가 입력됩니다.</p>
              <div className="empty-actions">
                <Link href="/items/new" className="btn primary">+ 첫 습득물 등록하기</Link>
                <Link href="/alerts" className="btn">🔔 분실 알림 등록</Link>
              </div>
            </div>
          ))
        : <div className="grid">{items.map((it) => <ItemCard key={it.id} item={it} />)}</div>}
    </>
  );
}

export default function Page() {
  return <RequireAuth><Feed /></RequireAuth>;
}
