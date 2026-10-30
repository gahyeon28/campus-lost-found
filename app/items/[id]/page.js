'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { RequireAuth, useAuth } from '@/components/AuthProvider';
import { StatusBadge, Thumb, formatDateTime } from '@/components/ItemCard';
import { supabase } from '@/lib/supabase';
import { CATEGORY_EMOJI, REPORT_REASONS } from '@/lib/constants';

const MapPicker = dynamic(() => import('@/components/MapPicker'), { ssr: false });

function ClaimBox({ item, onDone }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function claim(e) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase().rpc('claim_item', { p_item_id: item.id, p_answer: answer || null });
    setBusy(false);
    if (error) return setMsg({ error: error.message });
    if (data.ok) return onDone(data.message);
    setMsg({ error: data.message, locked: data.locked });
  }

  if (msg?.locked) return <div className="box red">🔒 {msg.error}</div>;
  return (
    <form onSubmit={claim} className="box purple">
      <b>🙋 내 물건이에요 — 수령 신청하기</b>
      {item.quiz_question ? (
        <>
          <span className="muted">등록자가 남긴 본인 확인 질문에 답해주세요. 3번 틀리면 잠겨요.</span>
          <label>Q. {item.quiz_question}<input required value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="정답" /></label>
        </>
      ) : (
        <span className="muted">퀴즈가 없는 물건이에요. 신청 후 위 보관 위치에서 찾아가세요. 허위 신청은 기록이 남아요.</span>
      )}
      {msg?.error && <p className="error">{msg.error}</p>}
      <button className="primary" disabled={busy}>{busy ? '확인 중…' : '수령 신청'}</button>
    </form>
  );
}

function ReportBox({ itemId }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [detail, setDetail] = useState('');
  const [msg, setMsg] = useState(null);

  async function report(e) {
    e.preventDefault();
    const { error } = await supabase().from('reports').insert({ item_id: itemId, reason, detail });
    if (error) setMsg({ error: error.code === '23505' ? '이미 신고한 게시물이에요.' : error.message });
    else setMsg({ ok: '신고가 접수되었어요. 신고가 누적되면 게시물이 숨겨집니다.' });
  }

  if (!open) return <button className="link" onClick={() => setOpen(true)}>🚩 허위 게시물 신고</button>;
  return (
    <form onSubmit={report} className="box red">
      <b>🚩 게시물 신고</b>
      <select value={reason} onChange={(e) => setReason(e.target.value)}>{REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
      <textarea maxLength={300} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="자세한 내용 (선택)" />
      {msg && <p className={msg.error ? 'error' : 'ok'}>{msg.error || msg.ok}</p>}
      {!msg?.ok && <button className="danger">신고하기</button>}
    </form>
  );
}

function Detail() {
  const { id } = useParams();
  const { user } = useAuth();
  const router = useRouter();
  const [item, setItem] = useState(undefined);
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase().from('items_view').select('*').eq('id', id).maybeSingle();
    setItem(data);
  }, [id]);

  useEffect(() => {
    load();
    supabase().from('notifications').update({ read: true }).eq('item_id', id).eq('read', false).then(() => {});
  }, [id, load]);

  async function act(fn, message) {
    const { error } = await supabase().rpc(fn, { p_item_id: item.id });
    setFlash(error ? { error: error.message } : { ok: message });
    load();
  }

  async function remove() {
    if (!window.confirm('이 게시물을 삭제할까요?')) return;
    const { error } = await supabase().from('items').delete().eq('id', item.id);
    if (error) setFlash({ error: error.message });
    else router.push('/');
  }

  if (item === undefined) return <p className="muted center">불러오는 중…</p>;
  if (item === null) return <p className="muted center">게시물이 없거나 숨김 처리되었어요.</p>;

  const isOwner = item.owner_id === user.id;
  const isClaimant = item.claimant_id === user.id;
  const open = item.status === '보관중';

  return (
    <>
      {flash && <div className={`box ${flash.error ? 'red' : 'green'}`} style={{ marginBottom: 14 }}>{flash.error || flash.ok}</div>}
      {item.hidden && <div className="box red" style={{ marginBottom: 14 }}>신고 누적으로 다른 사람에게는 보이지 않는 게시물이에요.</div>}

      <div className="detail">
        <div><Thumb item={item} tall /></div>
        <div className="stack">
          <h2>{item.title}</h2>
          <div className="badges">
            <StatusBadge status={item.display_status} />
            <span className="badge b-cat">{CATEGORY_EMOJI[item.category]} {item.category}</span>
            {item.color && <span className="badge b-color">{item.color}</span>}
            {item.quiz_question && <span className="badge b-quiz">🔐 본인 확인 퀴즈</span>}
          </div>
          <table className="info"><tbody>
            <tr><td>습득 일시</td><td>{formatDateTime(item.found_at)}</td></tr>
            <tr><td>발견 위치</td><td>{item.building} {item.location_detail}</td></tr>
            <tr><td>보관</td><td><b>{item.storage_type}</b>{item.storage_detail && <> · {item.storage_detail}</>}</td></tr>
            {item.brand && <tr><td>브랜드</td><td>{item.brand}</td></tr>}
            {item.tags?.length > 0 && <tr><td>키워드</td><td>{item.tags.join(', ')}</td></tr>}
            {item.description && <tr><td>설명</td><td>{item.description}</td></tr>}
            <tr><td>등록</td><td>{formatDateTime(item.created_at)}{isOwner && ' · 내가 등록'}</td></tr>
          </tbody></table>
        </div>
      </div>

      <div className="section">
        <MapPicker value={item} readOnly height={240} />
      </div>

      <div className="section stack">
        {item.display_status === '장기 미수령' && (
          <div className="box red">습득 후 한 달이 지난 장기 미수령 물건이에요. 주인이 나타나지 않으면 학교 유실물 센터로 옮겨주세요.</div>
        )}
        {item.status === '수령 대기' && (isOwner || isClaimant) && (
          <div className="box purple stack">
            <b>{isOwner ? '🙋 수령 신청이 들어왔어요.' : '⏳ 내가 수령 신청한 물건이에요. 보관 위치에서 찾아가세요.'}</b>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => act('complete_item', '수령 완료로 바뀌었어요. 🎉')}>✅ 수령 완료</button>
              <button onClick={() => act('cancel_claim', '수령 신청을 취소했어요.')}>신청 취소</button>
            </div>
          </div>
        )}
        {item.status === '수령 대기' && !isOwner && !isClaimant && <div className="box purple">다른 사람이 수령 신청한 물건이에요.</div>}
        {open && !isOwner && <ClaimBox item={item} onDone={(m) => { setFlash({ ok: m + ' 보관 위치에서 물건을 찾아가세요.' }); load(); }} />}
        {open && isOwner && <button className="danger" onClick={remove}>게시물 삭제</button>}
        {!isOwner && <ReportBox itemId={item.id} />}
      </div>
    </>
  );
}

export default function Page() {
  return <RequireAuth><Detail /></RequireAuth>;
}
