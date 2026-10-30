'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const AuthContext = createContext({ user: null, loading: true });

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, loading: true });

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setState({ user: data.session?.user ?? null, loading: false }));
    const { data } = sb.auth.onAuthStateChange((_event, session) => setState({ user: session?.user ?? null, loading: false }));
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// 로그인하지 않았으면 /login 으로 보낸다.
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);
  if (loading || !user) return <p className="muted center">불러오는 중…</p>;
  return children;
}
