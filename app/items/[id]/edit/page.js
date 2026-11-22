'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { RequireAuth, useAuth } from '@/components/AuthProvider';
import ItemForm from '@/components/ItemForm';
import { supabase } from '@/lib/supabase';

function Edit() {
  const { id } = useParams();
  const { user } = useAuth();
  const [item, setItem] = useState(undefined);

  useEffect(() => {
    supabase().from('items_view').select('*').eq('id', id).maybeSingle().then(({ data }) => setItem(data));
  }, [id]);

  if (item === undefined) return <p className="muted center">불러오는 중…</p>;
  if (!item || item.owner_id !== user.id) return <p className="muted center">내가 등록한 게시물만 수정할 수 있어요.</p>;
  if (item.status !== '보관중') return <p className="muted center">수령 신청이 들어온 뒤에는 수정할 수 없어요.</p>;
  return <ItemForm item={item} />;
}

export default function Page() {
  return <RequireAuth><Edit /></RequireAuth>;
}
