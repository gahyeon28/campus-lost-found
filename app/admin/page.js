'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/AuthProvider';
import { formatDateTime } from '@/components/ItemCard';
import { supabase } from '@/lib/supabase';

// 권한은 DB 함수가 확인한다. 관리자가 아니면 함수가 오류를 돌려주므로 이 화면은 보기만 담당한다.
function Admin() {
  const [isAdmin, setIsAdmin] = useState(null);
  const [tab, setTab] = useState('reports');
  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const [r, u] = await Promise.all([sb.rpc('admin_reported_items'), sb.rpc('admin_users')]);
    if (r.error || u.error) setFlash({ error: (r.error || u.error).message });
    setReports(r.data || []);
    setUsers(u.data || []);
  }, []);

  useEffect(() => {
    supabase().rpc('is_admin').then(({ data }) => {
      setIsAdmin(data === true);
      if (data === true) load();
    });
  }, [load]);

  async function run(fn, args, message, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    const { error } = await supabase().rpc(fn, args);
    setFlash(error ? { error: error.message } : { ok: message });
    load();
  }

  function ban(userId, email) {
    const reason = window.prompt(`${email} 계정을 이용 정지합니다. 사유를 적어주세요.`, '허위 게시물 반복');
    if (reason === null) return;
    run('admin_ban', { p_user_id: userId, p_reason: reason }, `${email} 계정을 정지했어요. 이 사람의 진행 중인 게시물도 숨겨졌어요.`);
  }

  if (isAdmin === null) return <p className="muted center">불러오는 중…</p>;
  if (!isAdmin) return <p className="muted center">관리자만 볼 수 있는 페이지예요.</p>;

  return (
    <>
      <h2>관리자</h2>
      <p className="muted">신고된 게시물과 주의가 필요한 사용자를 관리해요. 처리 결과는 해당 사용자의 알림함으로 전달돼요.</p>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0 16px' }}>
        <button className={tab === 'reports' ? 'primary' : ''} onClick={() => setTab('reports')}>신고된 게시물 ({reports.length})</button>
        <button className={tab === 'users' ? 'primary' : ''} onClick={() => setTab('users')}>주의 사용자 ({users.length})</button>
      </div>

      {flash && <div className={`box ${flash.error ? 'red' : 'green'}`} style={{ marginBottom: 14 }}>{flash.error || flash.ok}</div>}

      {tab === 'reports' && (
        reports.length === 0 ? <p className="muted center">신고된 게시물이 없어요.</p> : (
          <div className="stack">
            {reports.map((r) => (
              <div key={r.item_id} className="card stack">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <Link href={`/items/${r.item_id}`}><b>{r.title}</b></Link>
                    <div className="muted">
                      {r.building} · {r.status} · 등록 {formatDateTime(r.created_at)}
                    </div>
                    <div className="muted">작성자 {r.owner_email}{r.owner_banned && ' (정지됨)'}</div>
                  </div>
                  <div className="badges" style={{ alignItems: 'flex-start' }}>
                    <span className="badge b-long">신고 {r.report_count}건</span>
                    {r.hidden && <span className="badge b-done">숨김</span>}
                  </div>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {r.reports.map((x, i) => (
                    <li key={i}><b>{x.reason}</b>{x.detail && ` · ${x.detail}`} <span className="muted">({formatDateTime(x.at)})</span></li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {r.hidden
                    ? <button onClick={() => run('admin_set_hidden', { p_item_id: r.item_id, p_hidden: false }, '숨김을 해제했어요. 기존 신고는 검토 완료로 정리됐어요.', '숨김을 해제할까요? 기존 신고 기록은 정리됩니다.')}>숨김 해제</button>
                    : <button onClick={() => run('admin_set_hidden', { p_item_id: r.item_id, p_hidden: true }, '게시물을 숨겼어요.')}>숨기기</button>}
                  <button className="danger" onClick={() => run('admin_delete_item', { p_item_id: r.item_id }, '게시물을 삭제했어요.', '이 게시물을 완전히 삭제할까요? 되돌릴 수 없어요.')}>삭제</button>
                  {r.owner_banned
                    ? <button onClick={() => run('admin_unban', { p_user_id: r.owner_id }, '정지를 해제했어요.')}>작성자 정지 해제</button>
                    : <button className="danger" onClick={() => ban(r.owner_id, r.owner_email)}>작성자 이용 정지</button>}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'users' && (
        users.length === 0 ? <p className="muted center">주의가 필요한 사용자가 없어요.</p> : (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="info" style={{ minWidth: 640 }}>
              <thead>
                <tr className="muted" style={{ textAlign: 'left' }}>
                  <th>이메일</th><th>게시물</th><th>받은 신고</th><th>퀴즈 오답</th><th>잠긴 물건</th><th>수령 신청</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td>
                      {u.email}
                      {u.banned && <div className="error">정지됨{u.ban_reason && ` · ${u.ban_reason}`}</div>}
                    </td>
                    <td>{u.item_count}</td>
                    <td>{u.reports_received}</td>
                    <td>{u.failed_attempts}</td>
                    <td>{u.locked_items}</td>
                    <td>{u.claim_count}</td>
                    <td>
                      {u.banned
                        ? <button onClick={() => run('admin_unban', { p_user_id: u.user_id }, '정지를 해제했어요.')}>정지 해제</button>
                        : <button className="danger" onClick={() => ban(u.user_id, u.email)}>이용 정지</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 10 }}>
              잠긴 물건: 퀴즈를 3번 틀려 수령 신청이 잠긴 물건 수. 여러 물건에서 잠겼다면 남의 물건을 노리는 사용자일 수 있어요.
            </p>
          </div>
        )
      )}
    </>
  );
}

export default function Page() {
  return <RequireAuth><Admin /></RequireAuth>;
}
