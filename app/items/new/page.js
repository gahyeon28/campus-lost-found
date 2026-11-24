'use client';
import { RequireAuth } from '@/components/AuthProvider';
import Feed from '@/components/Feed';
import ItemForm from '@/components/ItemForm';

// 등록 폼은 피드 위에 떠 있는 오버레이로 보여준다 (배경은 피드 그대로)
export default function Page() {
  return (
    <RequireAuth>
      <Feed />
      <div className="modal-overlay"><ItemForm /></div>
    </RequireAuth>
  );
}
