'use client';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/AuthProvider';
import AlertForm from '@/components/AlertForm';

export default function Page() {
  const router = useRouter();
  return <div className="modal-overlay"><RequireAuth><AlertForm onClose={() => router.back()} /></RequireAuth></div>;
}
