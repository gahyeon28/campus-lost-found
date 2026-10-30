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
  .replace(/values \('[^']+'\) on conflict do nothing;\s*$/, "values ('school.ac.kr') on conflict do nothing;");

const FINDER = { id: '11111111-1111-1111-1111-111111111111', email: 'finder@school.ac.kr' };
const OWNER = { id: '22222222-2222-2222-2222-222222222222', email: 'owner@stu.school.ac.kr' };
const OTHER = { id: '33333333-3333-3333-3333-333333333333', email: 'other@school.ac.kr' };
const R4 = { id: '44444444-4444-4444-4444-444444444444', email: 'r4@school.ac.kr' };

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
  for (const u of [FINDER, OWNER, OTHER, R4]) {
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
  const [row] = await as(FINDER, 'select status, claimant_id from items where id = $1', [id]);
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
