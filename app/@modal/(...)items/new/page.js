'use client';
import { RequireAuth } from '@/components/AuthProvider';
import ItemForm from '@/components/ItemForm';

// 원래 보던 페이지 위에 오버레이로 열린다 (직접 주소로 들어오면 app/items/new/page.js)
export default function Page() {
  return <div className="modal-overlay"><RequireAuth><ItemForm /></RequireAuth></div>;
}
