// supabase/schema.sql 을 실제 Postgres(PGlite)에서 실행해 보안 규칙과 상태 흐름을 검증한다.
// Supabase 전용 객체(auth.uid, auth.jwt, storage 등)는 아래 STUB 으로 흉내 낸다.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
grant usage on schema public, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant insert, select on storage.objects to authenticated;
grant usage, select on all sequences in schema storage to authenticated;
`;

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  .replace(/allowed_domains \(domain\) values \('[^']+'\)/, "allowed_domains (domain) values ('school.ac.kr')")
  .replace(/admins \(email\) values \('[^']+'\)/, "admins (email) values ('admin@school.ac.kr')");

const FINDER = { id: '11111111-1111-1111-1111-111111111111', email: 'finder@school.ac.kr' };
const OWNER = { id: '22222222-2222-2222-2222-222222222222', email: 'owner@stu.school.ac.kr' };
const OTHER = { id: '33333333-3333-3333-3333-333333333333', email: 'other@school.ac.kr' };
const R4 = { id: '44444444-4444-4444-4444-444444444444', email: 'r4@school.ac.kr' };
const ADMIN = { id: '55555555-5555-5555-5555-555555555555', email: 'admin@school.ac.kr' };

let db;

async function as(user, sql, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    user ? JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }) : '',
  ]);
  await db.exec(user === 'service' ? 'set role service_role' : user ? 'set role authenticated' : 'set role anon');
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const newItem = (extra = {}) => JSON.stringify({
  title: '흰색 에어팟 프로', category: '전자기기', color: '흰색', brand: 'Apple', tags: ['이어폰'],
  description: '투명 케이스', building: '중앙도서관', location_detail: '3층 열람실',
  storage_type: '근처 공용 장소에 맡김', storage_detail: '3층 안내데스크',
  lat: 37.5, lng: 127.0, found_at: new Date().toISOString(), ...extra,
});

before(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(schema);
  await db.exec(schema); // 두 번 실행해도 안전한지
  for (const u of [FINDER, OWNER, OTHER, R4, ADMIN]) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  }
});

test('학교 메일이 아니면 가입 자체가 막힌다', async () => {
  await assert.rejects(db.query(`insert into auth.users values (gen_random_uuid(), 'x@gmail.com')`), /학교 이메일/);
  await assert.rejects(db.query(`insert into auth.users values (gen_random_uuid(), 'x@evilschool.ac.kr')`), /학교 이메일/);
});

test('비로그인(anon)은 아무것도 읽을 수 없다', async () => {
  await assert.rejects(as(null, 'select * from items_view'), /permission denied/);
});

test('등록 → 퀴즈 정답이 노출되지 않음 → 오답 3회 잠금', async () => {
  const [{ id }] = await as(FINDER, `select create_item($1::jsonb, '고양이') as id`,
    [newItem({ quiz_question: '케이스 스티커 모양은?' })]);

  const [row] = await as(OTHER, 'select * from items_view where id = $1', [id]);
  assert.equal(row.display_status, '보관중');
  assert.equal(row.quiz_question, '케이스 스티커 모양은?');
  assert.equal('answer' in row, false);
  await assert.rejects(as(OTHER, 'select * from item_secrets'), /permission denied/);

  // 직접 상태 조작 불가
  await assert.rejects(as(OTHER, `update items set status = '수령 완료' where id = $1`, [id]), /permission denied/);

  const tries = [];
  for (const a of ['카드', '고양', '강아지']) tries.push((await as(OTHER, 'select claim_item($1, $2) r', [id, a]))[0].r);
  assert.equal(tries[0].ok, false);
  assert.equal(tries[2].locked, true);
  const [{ r: locked }] = await as(OTHER, `select claim_item($1, '고양이') r`, [id]);
  assert.equal(locked.ok, false, '잠긴 뒤에는 정답도 거부');

  const [{ r: ok }] = await as(OWNER, `select claim_item($1, ' 고양이요 ') r`, [id]);
  assert.equal(ok.ok, true, '정답 + 어미는 허용');
  const notis = await as(FINDER, 'select * from notifications');
  assert.ok(notis.some((n) => n.title.includes('수령 신청')));

  await assert.rejects(as(OTHER, 'select complete_item($1)', [id]), /바꿀 수 없는/);
  await as(OWNER, 'select complete_item($1)', [id]);
  const [done] = await as(OTHER, 'select display_status from items_view where id = $1', [id]);
  assert.equal(done.display_status, '수령 완료');
});

test('퀴즈 없는 물건은 바로 수령 대기, 취소하면 다시 보관중', async () => {
  const [{ id }] = await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: '검정 우산', category: '기타' })]);
  const [{ r }] = await as(OTHER, 'select claim_item($1) r', [id]);
  assert.equal(r.ok, true);
  const [{ r: dup }] = await as(OWNER, 'select claim_item($1) r', [id]);
  assert.equal(dup.ok, false, '중복 신청 불가');
  await as(FINDER, 'select cancel_claim($1)', [id]);
  const [row] = await as(FINDER, 'select status, claimant_id from items_view where id = $1', [id]);
  assert.deepEqual(row, { status: '보관중', claimant_id: null });
});

test('30일 지난 보관중 물건은 장기 미수령으로 표시', async () => {
  const old = new Date(Date.now() - 31 * 86400e3).toISOString();
  const [{ id }] = await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: '오래된 텀블러', category: '기타', found_at: old })]);
  const [row] = await as(OTHER, 'select display_status from items_view where id = $1', [id]);
  assert.equal(row.display_status, '장기 미수령');
});

test('잘못된 입력은 거부', async () => {
  await assert.rejects(as(FINDER, 'select create_item($1::jsonb)', [newItem({ quiz_question: '질문만' })]), /정답/);
  await assert.rejects(as(FINDER, 'select create_item($1::jsonb)', [newItem({ image_path: `${OTHER.id}/a.jpg` })]), /이미지 경로/);
  await assert.rejects(as(FINDER, 'select create_item($1::jsonb)', [newItem({ category: '음식' })]), /check/);
  const future = new Date(Date.now() + 86400e3).toISOString();
  await assert.rejects(as(FINDER, 'select create_item($1::jsonb)', [newItem({ found_at: future })]), /미래/);
});

test('신고 3건이면 숨김, 본인 글은 신고 불가', async () => {
  const [{ id }] = await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: '가짜 게시물' })]);
  await assert.rejects(as(FINDER, `insert into reports (item_id, reason) values ($1, '허위 게시물')`, [id]), /row-level security/);
  for (const u of [OWNER, OTHER]) await as(u, `insert into reports (item_id, reason) values ($1, '허위 게시물')`, [id]);
  await assert.rejects(as(OTHER, `insert into reports (item_id, reason) values ($1, '기타')`, [id]), /duplicate/);
  assert.equal((await as(OTHER, 'select id from items_view where id = $1', [id])).length, 1);
  await as(R4, `insert into reports (item_id, reason) values ($1, '허위 게시물')`, [id]);
  assert.equal((await as(OTHER, 'select id from items_view where id = $1', [id])).length, 0, '다른 사람에겐 숨김');
  assert.equal((await as(FINDER, 'select id from items_view where id = $1', [id])).length, 1, '작성자는 볼 수 있음');
});

test('분실 알림: 조건에 맞는 사람에게만 1회 발송, 남의 메일로 구독 불가', async () => {
  await as(OWNER, `insert into watches (keywords, category, color) values ('{에어팟}', '전자기기', '흰색')`);
  await as(OTHER, `insert into watches (keywords, color) values ('{에어팟}', '검정')`); // 색상 불일치
  await as(R4, `insert into watches (keywords) values ('{지갑}')`); // 키워드 불일치
  await assert.rejects(as(OTHER, `insert into watches (keywords, email) values ('{a}', 'victim@school.ac.kr')`), /permission denied/);

  await assert.rejects(as(FINDER, 'select * from notify_matches(1, $1)', [FINDER.id]), /permission denied/);

  const [{ id }] = await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: '에어팟 2세대' })]);
  const sent = await as('service', 'select * from notify_matches($1, $2)', [id, FINDER.id]);
  assert.deepEqual(sent.map((s) => s.email), [OWNER.email]);
  assert.equal((await as('service', 'select * from notify_matches($1, $2)', [id, FINDER.id])).length, 0, '중복 발송 없음');
  const notis = await as(OWNER, 'select * from notifications where item_id = $1', [id]);
  assert.equal(notis.length, 1);
  assert.equal((await as(OTHER, 'select * from notifications where item_id = $1', [id])).length, 0);
});

test('사진은 내 폴더에만 올릴 수 있다', async () => {
  await as(FINDER, `insert into storage.objects (bucket_id, name) values ('item-images', $1)`, [`${FINDER.id}/a.jpg`]);
  await assert.rejects(
    as(FINDER, `insert into storage.objects (bucket_id, name) values ('item-images', $1)`, [`${OTHER.id}/a.jpg`]),
    /row-level security/,
  );
});

test('퀴즈 물건의 상세 위치는 작성자·통과자·관리자에게만 보인다', async () => {
  const [{ id }] = await as(FINDER, `select create_item($1::jsonb, '고양이') as id`,
    [newItem({ title: '위치 비공개 에어팟', quiz_question: '스티커 모양은?' })]);
  const sel = 'select location_detail, storage_detail, lat, lng, location_locked, building from items_view where id = $1';

  const [stranger] = await as(OTHER, sel, [id]);
  assert.deepEqual(stranger, { location_detail: '', storage_detail: '', lat: null, lng: null, location_locked: true, building: '중앙도서관' });
  await assert.rejects(as(OTHER, 'select location_detail from items where id = $1', [id]), /permission denied/);
  await assert.rejects(as(OTHER, 'select * from items'), /permission denied/);

  const [owner] = await as(FINDER, sel, [id]);
  assert.equal(owner.location_detail, '3층 열람실');
  assert.equal(owner.location_locked, false);
  const [admin] = await as(ADMIN, sel, [id]);
  assert.equal(admin.storage_detail, '3층 안내데스크');

  await as(OWNER, `select claim_item($1, '고양이')`, [id]);
  const [claimant] = await as(OWNER, sel, [id]);
  assert.equal(claimant.location_detail, '3층 열람실', '퀴즈 통과 후 공개');
  assert.equal((await as(OTHER, sel, [id]))[0].location_locked, true);

  const [{ id: plain }] = await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: '흔한 우산', category: '기타' })]);
  assert.equal((await as(OTHER, sel, [plain]))[0].location_detail, '3층 열람실', '퀴즈 없는 물건은 공개');

  // 작성자는 여전히 자기 게시물을 지울 수 있다
  await as(FINDER, 'delete from items where id = $1', [plain]);
  assert.equal((await as(FINDER, 'select id from items_view where id = $1', [plain])).length, 0);
});

test('관리자 기능: 일반 사용자는 못 쓰고, 관리자는 신고 처리·정지할 수 있다', async () => {
  for (const fn of ['admin_reported_items()', 'admin_users()', `admin_ban('${OTHER.id}')`, 'admin_set_hidden(1, false)', 'admin_delete_item(1)']) {
    await assert.rejects(as(OTHER, `select * from ${fn}`), /관리자만/);
  }
  assert.equal((await as(OTHER, 'select is_admin() a'))[0].a, false);
  assert.equal((await as(ADMIN, 'select is_admin() a'))[0].a, true);

  const [{ id }] = await as(R4, 'select create_item($1::jsonb) as id', [newItem({ title: '허위 게시물 테스트' })]);
  for (const u of [FINDER, OWNER, OTHER]) await as(u, `insert into reports (item_id, reason) values ($1, '허위 게시물')`, [id]);

  const reported = await as(ADMIN, 'select * from admin_reported_items()');
  const row = reported.find((r) => r.item_id == id);
  assert.equal(Number(row.report_count), 3);
  assert.equal(row.hidden, true);
  assert.equal(row.owner_email, R4.email);
  assert.equal(row.reports.length, 3);
  assert.equal((await as(ADMIN, 'select id from items_view where id = $1', [id])).length, 1, '관리자는 숨김 게시물도 봄');

  const users = await as(ADMIN, 'select * from admin_users()');
  assert.ok(users.some((u) => u.email === R4.email && Number(u.reports_received) >= 3));
  assert.ok(users.some((u) => u.email === OTHER.email && Number(u.locked_items) >= 1), '퀴즈 잠김 기록도 보임');

  // 정지 → 등록·수령 신청·신고 불가, 게시물 숨김
  await as(ADMIN, `select admin_ban($1, '허위 게시물 반복')`, [R4.id]);
  await assert.rejects(as(R4, 'select create_item($1::jsonb)', [newItem()]), /정지/);
  const [{ id: open }] = await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: '정지 테스트용' })]);
  assert.equal((await as(R4, 'select claim_item($1) r', [open]))[0].r.ok, false);
  await assert.rejects(as(R4, `insert into reports (item_id, reason) values ($1, '기타')`, [open]), /row-level security/);
  assert.ok((await as(R4, 'select * from notifications')).some((n) => n.title.includes('정지')));
  await assert.rejects(as(ADMIN, `select admin_ban($1)`, [ADMIN.id]), /관리자는 정지/);

  await as(ADMIN, 'select admin_unban($1)', [R4.id]);
  await as(R4, 'select create_item($1::jsonb)', [newItem({ title: '정지 해제 후 등록' })]);

  // 숨김 해제 시 신고 정리 → 다른 사람에게 다시 보임
  await as(ADMIN, 'select admin_set_hidden($1, false)', [id]);
  assert.equal((await as(OTHER, 'select id from items_view where id = $1', [id])).length, 1);
  assert.equal((await as(ADMIN, 'select * from admin_reported_items()')).filter((r) => r.item_id == id).length, 0);

  await as(ADMIN, 'select admin_delete_item($1)', [id]);
  assert.equal((await as(ADMIN, 'select id from items_view where id = $1', [id])).length, 0);
});

test('공용 장소에 맡기면 맡긴 곳 입력 필수, 퀴즈 물건도 그 자리에 둘 수 있음', async () => {
  const [{ id }] = await as(FINDER, `select create_item($1::jsonb, '고양이') as id`,
    [newItem({ title: '그 자리에 둔 퀴즈 물건', quiz_question: 'q', storage_type: '발견한 자리에 그대로', storage_detail: '', location_detail: '2층 벤치' })]);
  assert.equal((await as(OTHER, 'select location_detail from items_view where id = $1', [id]))[0].location_detail, '', '상세 위치는 숨김');
  await assert.rejects(as(FINDER, 'select create_item($1::jsonb)', [newItem({ storage_detail: '  ' })]), /맡긴 장소/);
  await as(FINDER, 'select create_item($1::jsonb)', [newItem({ title: '그대로 둔 우산', storage_type: '발견한 자리에 그대로', storage_detail: '' })]);
});

test('수령 대기는 한 사람당 3건까지', async () => {
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: `묶기 테스트 ${i}` })]))[0].id);
  for (const id of ids.slice(0, 3)) assert.equal((await as(R4, 'select claim_item($1) r', [id]))[0].r.ok, true);
  const [{ r }] = await as(R4, 'select claim_item($1) r', [ids[3]]);
  assert.equal(r.ok, false);
  assert.match(r.message, /3건/);
  await as(R4, 'select cancel_claim($1)', [ids[0]]);
  assert.equal((await as(R4, 'select claim_item($1) r', [ids[3]]))[0].r.ok, true, '취소하면 다시 신청 가능');
});

test('AI 태깅 하루 사용 한도: 서버만 호출 가능, 한도까지만 허용', async () => {
  await assert.rejects(as(OTHER, `select consume_tag_quota($1, 2)`, [OTHER.id]), /permission denied/);
  const use = async () => (await as('service', `select consume_tag_quota($1, 2) ok`, [OTHER.id]))[0].ok;
  assert.deepEqual([await use(), await use(), await use()], [true, true, false]);
  assert.equal((await as('service', `select consume_tag_quota($1, 2) ok`, [FINDER.id]))[0].ok, true, '사람마다 따로 셈');
  await assert.rejects(as(OTHER, 'select * from tag_usage'), /permission denied/);
});

test('AI 판단 수령 신청: 서버만 호출, 오답은 기회 차감, 정답이면 수령 대기', async () => {
  const [{ id }] = await as(FINDER, `select create_item($1::jsonb, '고양이') as id`,
    [newItem({ title: 'AI 판단 테스트', quiz_question: '스티커 모양은?' })]);
  await assert.rejects(as(OTHER, 'select claim_check($1, $2)', [id, OTHER.id]), /permission denied/);
  await assert.rejects(as(OTHER, 'select claim_item_judged($1, $2, true)', [id, OTHER.id]), /permission denied/);
  await assert.rejects(as(OTHER, 'select claim_core($1, $2, null, true)', [id, OTHER.id]), /permission denied/);

  const check = async (u) => (await as('service', 'select claim_check($1, $2) r', [id, u.id]))[0].r;
  assert.deepEqual(await check(OWNER), { ok: true, quiz: true });
  assert.equal((await check(FINDER)).ok, false, '본인 글');

  const judged = async (u, ok) => (await as('service', 'select claim_item_judged($1, $2, $3) r', [id, u.id, ok]))[0].r;
  assert.equal((await judged(OWNER, false)).left, 2);
  assert.equal((await judged(OWNER, true)).ok, true);
  assert.equal((await as(OTHER, 'select display_status from items_view where id = $1', [id]))[0].display_status, '수령 대기');
  assert.equal((await as(OWNER, 'select location_detail from items_view where id = $1', [id]))[0].location_detail, '3층 열람실');
});

test('분실 알림 동의어 매칭, 색 미입력 물건도 매칭, 짧은 단어 오탐 없음', async () => {
  // 앞 테스트의 구독: OWNER {에어팟, 전자기기, 흰색}, OTHER {에어팟, 검정}, R4 {지갑}
  const [{ id }] = await as(FINDER, 'select create_item($1::jsonb) as id',
    [newItem({ title: '갤럭시 버즈', description: '케이스 없음', tags: [], color: '' })]);
  const sent = (await as('service', 'select * from notify_matches($1, $2)', [id, FINDER.id])).map((r) => r.email).sort();
  assert.deepEqual(sent, [OTHER.email, OWNER.email].sort(), '버즈 ↔ 에어팟, 색 미입력은 색 조건 통과');

  const [{ id: wallet }] = await as(FINDER, 'select create_item($1::jsonb) as id',
    [newItem({ title: '검정 반지갑', category: '지갑/카드', color: '검정', description: '', tags: [] })]);
  assert.deepEqual((await as('service', 'select * from notify_matches($1, $2)', [wallet, FINDER.id])).map((r) => r.email), [R4.email]);

  await assert.rejects(as(OTHER, 'select * from keyword_synonyms'), /permission denied/);
  await assert.rejects(db.query(`insert into keyword_synonyms values ('폰', '휴대폰')`), /check/);
});

test('게시물 수정: 작성자만, 보관중일 때만, 퀴즈 정답 유지/변경과 잠금 초기화', async () => {
  const [{ id }] = await as(FINDER, `select create_item($1::jsonb, '고양이') as id`,
    [newItem({ title: '수정 전 에어팟', quiz_question: '스티커 모양은?' })]);
  const edit = (u, extra, ans = null) => as(u, 'select update_item($1, $2::jsonb, $3)', [id, newItem({ quiz_question: '스티커 모양은?', ...extra }), ans]);

  await assert.rejects(edit(OTHER, { title: '남이 수정' }), /내가 등록한/);
  for (const a of ['강아지', '토끼', '곰']) await as(OWNER, 'select claim_item($1, $2)', [id, a]);
  assert.equal((await as('service', 'select claim_check($1, $2) r', [id, OWNER.id]))[0].r.locked, true);

  await edit(FINDER, { title: '수정 후 에어팟', location_detail: '4층' }); // 정답 비워 두면 유지
  const [row] = await as(FINDER, 'select title, location_detail, quiz_question from items_view where id = $1', [id]);
  assert.deepEqual(row, { title: '수정 후 에어팟', location_detail: '4층', quiz_question: '스티커 모양은?' });
  assert.equal((await as('service', 'select claim_check($1, $2) r', [id, OWNER.id]))[0].r.locked, true, '퀴즈 그대로면 잠금 유지');

  await edit(FINDER, { title: '수정 후 에어팟' }, '강아지'); // 정답 변경 → 잠금 초기화
  assert.equal((await as(OWNER, `select claim_item($1, '강아지') r`, [id]))[0].r.ok, true);
  await assert.rejects(edit(FINDER, { title: '수령 대기 중 수정' }), /수정할 수 없습니다/);

  const [{ id: plain }] = await as(FINDER, 'select create_item($1::jsonb) as id', [newItem({ title: '퀴즈 없는 물건' })]);
  await assert.rejects(as(FINDER, 'select update_item($1, $2::jsonb)', [plain, newItem({ quiz_question: '새 질문' })]), /정답/);
  await assert.rejects(as(FINDER, 'select update_item($1, $2::jsonb)', [plain, newItem({ storage_detail: '' })]), /맡긴 장소/);
  await assert.rejects(as(FINDER, 'select check_item_payload($1::jsonb)', [newItem()]), /permission denied/);
});

test('관리 기능 보강: 관리자 추가·삭제, 처리 기록, 신고 기록 보존', async () => {
  for (const fn of ['admin_list_admins()', 'admin_logs_list()', `admin_add_admin('x@school.ac.kr')`]) {
    await assert.rejects(as(OTHER, `select * from ${fn}`), /관리자만/);
  }
  await assert.rejects(as(ADMIN, `select admin_add_admin('someone@gmail.com')`), /학교 이메일/);
  await as(ADMIN, `select admin_add_admin(' Finder@School.ac.kr ')`);
  assert.ok((await as(ADMIN, 'select * from admin_list_admins()')).some((r) => r.email === FINDER.email));
  assert.equal((await as(FINDER, 'select is_admin() a'))[0].a, true);
  await assert.rejects(as(ADMIN, `select admin_add_admin($1)`, [FINDER.email]), /이미/);
  await assert.rejects(as(ADMIN, `select admin_remove_admin($1)`, [ADMIN.email]), /자기 자신/);
  await as(ADMIN, `select admin_remove_admin($1)`, [FINDER.email]);
  assert.equal((await as(FINDER, 'select is_admin() a'))[0].a, false);

  // 신고 → 자동 숨김 → 숨김 해제해도 신고 기록은 남고(reviewed), 같은 사람이 다시 신고 가능
  const [{ id }] = await as(R4, 'select create_item($1::jsonb) as id', [newItem({ title: '기록 보존 테스트' })]);
  for (const u of [FINDER, OWNER, OTHER]) await as(u, `insert into reports (item_id, reason) values ($1, '허위 게시물')`, [id]);
  await as(ADMIN, 'select admin_set_hidden($1, false)', [id]);
  assert.equal((await as('service', 'select count(*)::int n from reports where item_id = $1 and reviewed', [id]))[0].n, 3);
  assert.equal((await as(ADMIN, 'select * from admin_reported_items()')).filter((r) => r.item_id == id).length, 0);
  await as(FINDER, `insert into reports (item_id, reason) values ($1, '기타')`, [id]);
  await assert.rejects(as(FINDER, `insert into reports (item_id, reason) values ($1, '기타')`, [id]), /duplicate/);
  assert.equal((await as(OTHER, 'select id from items_view where id = $1', [id])).length, 1, '검토 후 신고 1건으로는 다시 숨겨지지 않음');

  await as(ADMIN, 'select admin_delete_item($1)', [id]);
  const logs = await as(ADMIN, 'select * from admin_logs_list()');
  const actions = logs.map((l) => l.action);
  for (const a of ['게시물 삭제', '숨김 해제', '관리자 삭제', '관리자 추가']) assert.ok(actions.includes(a), a);
  assert.equal(logs.find((l) => l.action === '게시물 삭제').target, '기록 보존 테스트');
  assert.ok(logs.every((l) => l.admin_email === ADMIN.email));
  await assert.rejects(as(ADMIN, 'select * from admin_logs'), /permission denied/);
  await assert.rejects(as(ADMIN, `select log_admin('가짜', 'x')`), /permission denied/);
});
