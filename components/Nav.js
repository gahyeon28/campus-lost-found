'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { supabase } from '@/lib/supabase';

const LINKS = [
  ['/', '🏠 피드'],
  ['/items/new', '📦 습득물 등록'],
  ['/alerts', '🔔 분실 알림'],
];

export default function Nav() {
  const { user } = useAuth();
  const path = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    supabase().from('notifications').select('id', { count: 'exact', head: true }).eq('read', false)
      .then(({ count }) => setUnread(count || 0));
  }, [user, path]);

  return (
    <header className="nav">
      <Link href="/" className="brand">🔎 분실물 스마트 찾기</Link>
      {user && (
        <nav>
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? 'active' : ''}>
              {label}
              {href === '/alerts' && unread > 0 && <span className="dot">{unread}</span>}
            </Link>
          ))}
          <button className="link" onClick={() => supabase().auth.signOut()}>로그아웃</button>
        </nav>
      )}
    </header>
  );
}
