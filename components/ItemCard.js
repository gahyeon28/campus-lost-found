import Link from 'next/link';
import { CATEGORY_EMOJI } from '@/lib/constants';
import { imageUrl } from '@/lib/supabase';

const STATUS_CLASS = { 보관중: 'b-keep', '수령 대기': 'b-wait', '수령 완료': 'b-done', '장기 미수령': 'b-long' };

export function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_CLASS[status] || ''}`}>{status}</span>;
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function Thumb({ item, tall }) {
  const src = imageUrl(item.image_path);
  return src
    ? <img className={`thumb ${tall ? 'tall' : ''}`} src={src} alt={item.title} />
    : <div className={`thumb empty ${tall ? 'tall' : ''}`}>{CATEGORY_EMOJI[item.category] || '📦'}</div>;
}

export default function ItemCard({ item }) {
  return (
    <Link href={`/items/${item.id}`} className="card item-card">
      <Thumb item={item} />
      <div className="item-title">{item.title}</div>
      <div className="badges">
        <StatusBadge status={item.display_status} />
        <span className="badge b-cat">{CATEGORY_EMOJI[item.category]} {item.category}</span>
        {item.color && <span className="badge b-color">{item.color}</span>}
        {item.quiz_question && <span className="badge b-quiz">🔐 퀴즈</span>}
      </div>
      <div className="meta">📍 {item.building} · 🕘 {formatDateTime(item.found_at)}</div>
    </Link>
  );
}
