'use client';
import { RequireAuth } from '@/components/AuthProvider';
import Feed from '@/components/Feed';

export default function Page() {
  return <RequireAuth><Feed /></RequireAuth>;
}
