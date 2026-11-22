'use client';
import { RequireAuth } from '@/components/AuthProvider';
import ItemForm from '@/components/ItemForm';

export default function Page() {
  return <RequireAuth><ItemForm /></RequireAuth>;
}
