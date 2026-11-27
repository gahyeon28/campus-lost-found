'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { supabase } from '@/lib/supabase';

const TABS = [
  ['/', '습득물'],
  ['/alerts', '분실 알림'],
  ['/inbox', '내 알림함'],
];

const ICON = {
  refresh: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
};

function IconButton({ label, path, onClick }) {
  return (
    <button type="button" className="icon-btn-outline" aria-label={label} onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </button>
  );
}

export default function Nav() {
  const { user } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase().from('notifications').select('id', { count: 'exact', head: true }).eq('read', false)
      .then(({ count }) => setUnread(count || 0));
  }, [user, path]);

  useEffect(() => {
    if (!user) return setIsAdmin(false);
    supabase().rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, [user]);

  return (
    <header className="nav">
      <div className="nav-top">
        <Link href="/" className="brand">
          <span className="brand-logo">📍</span>
          <span>가천 <em>분실물 찾기</em></span>
        </Link>
        {user && (
          <div className="nav-actions">
            <IconButton label="새로고침" path={ICON.refresh} onClick={() => router.refresh()} />
            <IconButton label="로그아웃" path={ICON.logout} onClick={() => supabase().auth.signOut()} />
            <Link href="/items/new" className="btn-cta">+ 습득물 등록</Link>
          </div>
        )}
      </div>
      {user && (
        <nav className="nav-tabs">
          {TABS.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? 'active' : ''}>
              {label}
              {href === '/inbox' && unread > 0 && <span className="dot">{unread}</span>}
            </Link>
          ))}
          {isAdmin && <Link href="/admin" className={path === '/admin' ? 'active' : ''}>관리자</Link>}
        </nav>
      )}
    </header>
  );
}
