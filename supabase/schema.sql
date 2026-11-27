-- ============================================================
-- 교내 분실물 스마트 찾기 — Supabase 스키마
-- 여러 번 실행해도 안전하며, 다시 실행해도 기존 데이터는 지워지지 않는다.
-- ============================================================

-- ── 0. 허용 이메일 도메인 ────────────────────────────────────
create table if not exists public.allowed_domains (
  domain text primary key check (domain = lower(domain) and domain not like '%@%')
);

-- 학교 메일이면 true. 서브도메인(@stu.school.ac.kr)도 허용.
create or replace function public.is_school_email(p_email text default (auth.jwt() ->> 'email'))
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.allowed_domains d
    where split_part(lower(coalesce(p_email, '')), '@', 2) = d.domain
       or split_part(lower(coalesce(p_email, '')), '@', 2) like '%.' || d.domain
  );
$$;

-- 가입 단계에서 학교 메일이 아니면 막는다 (클라이언트 검사만으로는 우회 가능하므로).
create or replace function public.enforce_school_email()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_school_email(new.email) then
    raise exception '학교 이메일로만 가입할 수 있습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_school_email on auth.users;
create trigger enforce_school_email
  before insert or update of email on auth.users
  for each row execute function public.enforce_school_email();

-- 관리자(이메일로 지정)와 이용 정지 사용자
create table if not exists public.admins (
  email text primary key check (email = lower(email) and email like '%@%')
);

create table if not exists public.bans (
  user_id   uuid primary key references auth.users on delete cascade,
  reason    text not null default '' check (char_length(reason) <= 300),
  banned_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins a where a.email = lower(auth.jwt() ->> 'email')) $$;

create or replace function public.is_banned()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.bans b where b.user_id = auth.uid()) $$;

-- ── 1. 습득물 ────────────────────────────────────────────────
create table if not exists public.items (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references auth.users on delete cascade,
  title           text not null check (char_length(title) between 1 and 60),
  category        text not null check (category in ('전자기기','지갑/카드','의류','가방','책/문구','기타')),
  color           text,
  brand           text check (char_length(brand) <= 40),
  tags            text[] not null default '{}' check (cardinality(tags) <= 10),
  description     text not null default '' check (char_length(description) <= 1000),
  building        text not null check (char_length(building) between 1 and 40),
  location_detail text not null default '' check (char_length(location_detail) <= 200),
  storage_type    text not null check (storage_type in ('발견한 자리에 그대로','근처 공용 장소에 맡김')),
  storage_detail  text not null default '' check (char_length(storage_detail) <= 200),
  lat             double precision check (lat between -90 and 90),
  lng             double precision check (lng between -180 and 180),
  found_at        timestamptz not null,
  image_path      text,
  quiz_question   text check (char_length(quiz_question) <= 200),
  status          text not null default '보관중' check (status in ('보관중','수령 대기','수령 완료')),
  claimant_id     uuid references auth.users on delete set null,
  claimed_at      timestamptz,
  completed_at    timestamptz,
  hidden          boolean not null default false,   -- 신고 누적으로 숨김
  notified        boolean not null default false,   -- 분실 알림 발송 여부
  created_at      timestamptz not null default now()
);
create index if not exists items_created_idx on public.items (created_at desc);

-- 퀴즈 정답: 별도 테이블에 두고 아무도 직접 읽지 못하게 한다.
create table if not exists public.item_secrets (
  item_id bigint primary key references public.items on delete cascade,
  answer  text not null check (char_length(answer) between 1 and 100)
);

create table if not exists public.claim_attempts (
  id         bigint generated always as identity primary key,
  item_id    bigint not null references public.items on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists claim_attempts_idx on public.claim_attempts (item_id, user_id);

-- 화면용 조회 창구. 사용자는 items 테이블을 직접 읽지 못하고 이 뷰로만 읽는다.
-- - 숨김 게시물은 작성자와 관리자에게만 보인다.
-- - 퀴즈가 있는 물건의 상세 위치·맡긴 곳·좌표는 작성자, 퀴즈를 통과한 수령 신청자, 관리자에게만 보인다.
-- - 보관중인데 습득 후 30일이 지나면 '장기 미수령'으로 표시한다.
drop view if exists public.items_view;
create view public.items_view as
select i.id, i.owner_id, i.title, i.category, i.color, i.brand, i.tags, i.description, i.building,
       case when v.open then i.location_detail else '' end as location_detail,
       i.storage_type,
       case when v.open then i.storage_detail else '' end as storage_detail,
       case when v.open then i.lat end as lat,
       case when v.open then i.lng end as lng,
       i.found_at, i.image_path, i.quiz_question, i.status, i.claimant_id, i.claimed_at, i.completed_at,
       i.hidden, i.notified, i.created_at,
       not v.open as location_locked,
       case when i.status = '보관중' and i.found_at < now() - interval '30 days'
            then '장기 미수령' else i.status end as display_status
from public.items i
cross join lateral (
  select coalesce(i.quiz_question is null or auth.uid() = i.owner_id or auth.uid() = i.claimant_id
                  or public.is_admin(), false) as open
) v
where public.is_school_email() and (not i.hidden or i.owner_id = auth.uid() or public.is_admin());

-- ── 2. 신고 ──────────────────────────────────────────────────
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.items on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users on delete cascade,
  reason      text not null check (reason in ('허위 게시물','부적절한 사진/내용','개인정보 노출','이미 반환됨','기타')),
  detail      text not null default '' check (char_length(detail) <= 300),
  created_at  timestamptz not null default now()
);
-- 관리자가 검토한 신고는 지우지 않고 reviewed로 남긴다. 검토 뒤에는 같은 사람이 다시 신고할 수 있다.
alter table public.reports add column if not exists reviewed boolean not null default false;
alter table public.reports drop constraint if exists reports_item_id_reporter_id_key;
create unique index if not exists reports_open_unique on public.reports (item_id, reporter_id) where not reviewed;

-- 관리자 처리 기록
create table if not exists public.admin_logs (
  id          bigint generated always as identity primary key,
  admin_email text not null,
  action      text not null,
  target      text not null default '',
  detail      text not null default '',
  created_at  timestamptz not null default now()
);

-- ── 3. 분실 알림(키워드 구독) & 알림함 ───────────────────────
create table if not exists public.watches (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  email      text not null default (auth.jwt() ->> 'email'),
  keywords   text[] not null check (cardinality(keywords) between 1 and 10),
  category   text,
  color      text,
  buildings  text[] check (buildings is null or cardinality(buildings) between 1 and 30), -- 이동 동선(건물 여러 개). null이면 전체
  lost_from  date,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- 예전 '건물 1개' 칸을 동선(건물 여러 개)으로 옮긴다. 이미 옮겼으면 아무것도 하지 않는다.
alter table public.watches add column if not exists buildings text[]
  check (buildings is null or cardinality(buildings) between 1 and 30);
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'watches' and column_name = 'building') then
    update public.watches set buildings = array[building] where building is not null and buildings is null;
    alter table public.watches drop column building;
  end if;
end $$;

create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  item_id    bigint references public.items on delete cascade,
  title      text not null,
  body       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- 분실 알림 동의어: 같은 group에 있는 단어끼리는 같은 물건으로 본다. Table Editor에서 줄을 추가하면 바로 반영된다.
-- 다른 단어 안에 들어가 오탐이 나는 짧은 단어(예: '폰'은 '헤드폰'에 포함)는 넣지 않는다.
create table if not exists public.keyword_synonyms (
  word  text primary key check (word = lower(word) and char_length(word) >= 2),
  grp   text not null
);
insert into public.keyword_synonyms (word, grp) values
  ('에어팟','이어폰'),('airpods','이어폰'),('이어폰','이어폰'),('버즈','이어폰'),('헤드폰','이어폰'),('이어버드','이어폰'),
  ('휴대폰','휴대폰'),('핸드폰','휴대폰'),('아이폰','휴대폰'),('갤럭시','휴대폰'),('스마트폰','휴대폰'),
  ('노트북','노트북'),('맥북','노트북'),('랩탑','노트북'),('그램','노트북'),
  ('아이패드','태블릿'),('태블릿','태블릿'),('갤럭시탭','태블릿'),
  ('충전기','충전기'),('어댑터','충전기'),('케이블','충전기'),('보조배터리','충전기'),
  ('지갑','지갑'),('카드지갑','지갑'),('반지갑','지갑'),('장지갑','지갑'),('월렛','지갑'),
  ('학생증','신분증'),('신분증','신분증'),('사원증','신분증'),
  ('체크카드','카드'),('신용카드','카드'),('교통카드','카드'),('카드','카드'),
  ('우산','우산'),('양산','우산'),('장우산','우산'),
  ('후드','옷'),('후드티','옷'),('맨투맨','옷'),('자켓','옷'),('재킷','옷'),('패딩','옷'),('가디건','옷'),('점퍼','옷'),
  ('가방','가방'),('백팩','가방'),('에코백','가방'),('크로스백','가방'),('파우치','가방'),
  ('교재','책'),('전공서','책'),('전공책','책'),('공책','책'),
  ('텀블러','텀블러'),('물병','텀블러'),('보온병','텀블러'),
  ('안경','안경'),('선글라스','안경')
on conflict (word) do nothing;

-- AI 자동 태깅 사용량 (1인당 하루 횟수 제한용)
create table if not exists public.tag_usage (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);

-- ── 4. 권한 (RLS) ────────────────────────────────────────────
alter table public.allowed_domains enable row level security;
alter table public.items           enable row level security;
alter table public.item_secrets    enable row level security;
alter table public.claim_attempts  enable row level security;
alter table public.reports         enable row level security;
alter table public.watches         enable row level security;
alter table public.notifications   enable row level security;
alter table public.admins          enable row level security;
alter table public.bans            enable row level security;
alter table public.tag_usage       enable row level security;
alter table public.keyword_synonyms enable row level security;
alter table public.admin_logs      enable row level security;

-- Supabase는 새 테이블에 ALL 권한을 기본 부여하므로 먼저 회수하고 필요한 것만 다시 준다.
revoke all on public.allowed_domains, public.items, public.items_view, public.item_secrets,
              public.claim_attempts, public.reports, public.watches, public.notifications,
              public.admins, public.bans, public.tag_usage, public.keyword_synonyms,
              public.admin_logs
  from anon, authenticated;

-- items는 삭제에 필요한 열만 읽을 수 있다 (위치 같은 내용은 items_view로만).
grant select (id, owner_id, status), delete on public.items to authenticated;
grant select on public.items_view to authenticated;
grant select, insert (item_id, reason, detail) on public.reports to authenticated;
grant select, delete, insert (keywords, category, color, buildings, lost_from), update (active)
  on public.watches to authenticated;
grant select, update (read) on public.notifications to authenticated;

drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (public.is_school_email() and (not hidden or owner_id = auth.uid()));

drop policy if exists items_delete on public.items;
create policy items_delete on public.items for delete to authenticated
  using (owner_id = auth.uid() and status = '보관중');

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid());

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid() and public.is_school_email() and not public.is_banned()
    and exists (select 1 from public.items i where i.id = item_id and i.owner_id <> auth.uid())
  );

drop policy if exists watches_own on public.watches;
create policy watches_own on public.watches for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and email = (auth.jwt() ->> 'email') and public.is_school_email());

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 5. 함수 (상태 변경은 모두 여기서만) ──────────────────────
create or replace function public.normalize_answer(t text)
returns text language sql immutable
as $$ select lower(regexp_replace(coalesce(t, ''), '[\s\-_.,!?"''~]', '', 'g')) $$;

-- 등록·수정 공통 입력 검사 (문제가 있으면 예외)
create or replace function public.check_item_payload(p jsonb)
returns void
language plpgsql stable security definer set search_path = public
as $$
declare v_img text := nullif(p ->> 'image_path', '');
begin
  if v_img is not null and v_img not like auth.uid()::text || '/%' then
    raise exception '잘못된 이미지 경로입니다.';
  end if;
  if (p ->> 'found_at')::timestamptz > now() + interval '10 minutes' then
    raise exception '습득 시각이 미래일 수 없습니다.';
  end if;
  if p ->> 'storage_type' = '근처 공용 장소에 맡김' and coalesce(trim(p ->> 'storage_detail'), '') = '' then
    raise exception '맡긴 장소를 적어주세요.';
  end if;
end;
$$;

-- 습득물 등록 (정답 저장까지 한 트랜잭션)
create or replace function public.create_item(p jsonb, p_answer text default null)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id   bigint;
  v_quiz text := nullif(trim(p ->> 'quiz_question'), '');
  v_img  text := nullif(p ->> 'image_path', '');
begin
  if auth.uid() is null or not public.is_school_email() then
    raise exception '학교 이메일로 로그인해야 합니다.';
  end if;
  if public.is_banned() then
    raise exception '이용이 정지된 계정입니다.';
  end if;
  if v_quiz is not null and coalesce(trim(p_answer), '') = '' then
    raise exception '확인 퀴즈의 정답을 입력해주세요.';
  end if;
  perform public.check_item_payload(p);

  insert into public.items (owner_id, title, category, color, brand, tags, description, building,
                            location_detail, storage_type, storage_detail, lat, lng, found_at,
                            image_path, quiz_question)
  values (auth.uid(), trim(p ->> 'title'), p ->> 'category', nullif(p ->> 'color', ''),
          nullif(trim(p ->> 'brand'), ''),
          coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb))), '{}'),
          coalesce(trim(p ->> 'description'), ''), p ->> 'building',
          coalesce(trim(p ->> 'location_detail'), ''), p ->> 'storage_type',
          coalesce(trim(p ->> 'storage_detail'), ''),
          (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          (p ->> 'found_at')::timestamptz, v_img, v_quiz)
  returning id into v_id;

  if v_quiz is not null then
    insert into public.item_secrets (item_id, answer) values (v_id, trim(p_answer));
  end if;
  return v_id;
end;
$$;

-- 습득물 수정: 작성자만, 보관중일 때만. p_answer가 비어 있으면 기존 퀴즈 정답을 유지한다.
-- 퀴즈 질문이나 정답이 바뀌면 이전 오답 기록(잠금)을 초기화한다.
create or replace function public.update_item(p_item_id bigint, p jsonb, p_answer text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.items;
  v_quiz text := nullif(trim(p ->> 'quiz_question'), '');
  v_ans  text := nullif(trim(p_answer), '');
  v_had_secret boolean;
begin
  if auth.uid() is null or not public.is_school_email() then
    raise exception '학교 이메일로 로그인해야 합니다.';
  end if;
  if public.is_banned() then
    raise exception '이용이 정지된 계정입니다.';
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found or v_item.owner_id <> auth.uid() then
    raise exception '내가 등록한 게시물만 수정할 수 있습니다.';
  end if;
  if v_item.status <> '보관중' then
    raise exception '수령 신청이 들어온 뒤에는 수정할 수 없습니다.';
  end if;
  v_had_secret := exists (select 1 from public.item_secrets where item_id = p_item_id);
  if v_quiz is not null and v_ans is null and not v_had_secret then
    raise exception '확인 퀴즈의 정답을 입력해주세요.';
  end if;
  perform public.check_item_payload(p);

  update public.items set
    title = trim(p ->> 'title'), category = p ->> 'category', color = nullif(p ->> 'color', ''),
    brand = nullif(trim(p ->> 'brand'), ''),
    tags = coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb))), '{}'),
    description = coalesce(trim(p ->> 'description'), ''), building = p ->> 'building',
    location_detail = coalesce(trim(p ->> 'location_detail'), ''), storage_type = p ->> 'storage_type',
    storage_detail = coalesce(trim(p ->> 'storage_detail'), ''),
    lat = (p ->> 'lat')::double precision, lng = (p ->> 'lng')::double precision,
    found_at = (p ->> 'found_at')::timestamptz,
    image_path = coalesce(nullif(p ->> 'image_path', ''), v_item.image_path),
    quiz_question = v_quiz
  where id = p_item_id;

  if v_quiz is null then
    delete from public.item_secrets where item_id = p_item_id;
  elsif v_ans is not null then
    insert into public.item_secrets (item_id, answer) values (p_item_id, v_ans)
    on conflict (item_id) do update set answer = excluded.answer;
  end if;
  if v_quiz is distinct from v_item.quiz_question or v_ans is not null then
    delete from public.claim_attempts where item_id = p_item_id;
  end if;
end;
$$;

-- 수령 신청 가능 여부 확인 (정지, 숨김, 본인 글, 상태, 동시 신청 수, 퀴즈 잠금).
-- 가능하면 {ok: true, quiz: 퀴즈 여부}, 아니면 {ok: false, message, locked?}
create or replace function public.claim_check(p_item_id bigint, p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_item public.items;
begin
  if exists (select 1 from public.bans where user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'message', '이용이 정지된 계정입니다.');
  end if;
  select * into v_item from public.items where id = p_item_id and not hidden;
  if not found then return jsonb_build_object('ok', false, 'message', '물건을 찾을 수 없습니다.'); end if;
  if v_item.owner_id = p_user_id then
    return jsonb_build_object('ok', false, 'message', '내가 등록한 물건은 신청할 수 없습니다.');
  end if;
  if v_item.status <> '보관중' then
    return jsonb_build_object('ok', false, 'message', '이미 수령 신청이 진행 중이거나 완료된 물건입니다.');
  end if;
  -- 남의 물건을 여러 개 묶어 두는 것을 막기 위해 수령 대기는 한 사람당 3건까지
  if (select count(*) from public.items where claimant_id = p_user_id and status = '수령 대기') >= 3 then
    return jsonb_build_object('ok', false, 'message', '수령 대기 중인 신청이 3건 있어요. 먼저 수령을 완료하거나 취소해주세요.');
  end if;
  if v_item.quiz_question is not null
     and (select count(*) from public.claim_attempts where item_id = p_item_id and user_id = p_user_id) >= 3 then
    return jsonb_build_object('ok', false, 'locked', true,
      'message', '오답 3회로 온라인 신청이 잠겼습니다. 등록자에게 직접 문의해주세요.');
  end if;
  return jsonb_build_object('ok', true, 'quiz', v_item.quiz_question is not null);
end;
$$;

-- 수령 신청 처리. p_judged가 null이면 정답을 글자로 비교하고, 값이 있으면 서버(AI 판단) 결과를 그대로 쓴다.
create or replace function public.claim_core(p_item_id bigint, p_user_id uuid, p_answer text, p_judged boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_check  jsonb;
  v_item   public.items;
  v_tries  int;
  v_user   text := normalize_answer(p_answer);
  v_right  text;
  v_ok     boolean;
begin
  perform 1 from public.items where id = p_item_id for update; -- 동시에 두 명이 신청하는 경우 대비
  v_check := public.claim_check(p_item_id, p_user_id);
  if not (v_check ->> 'ok')::boolean then return v_check; end if;
  select * into v_item from public.items where id = p_item_id;

  if v_item.quiz_question is not null then
    select count(*) into v_tries from public.claim_attempts where item_id = p_item_id and user_id = p_user_id;
    if p_judged is not null then
      v_ok := p_judged;
    else
      select normalize_answer(answer) into v_right from public.item_secrets where item_id = p_item_id;
      -- 정확히 일치하거나 정답 뒤에 조사·어미 정도만 붙은 경우만 허용 ("카드" ≠ "체크카드")
      v_ok := v_user <> '' and (v_user = v_right or (position(v_right in v_user) > 0 and length(v_user) <= length(v_right) + 3));
    end if;
    if not v_ok then
      insert into public.claim_attempts (item_id, user_id) values (p_item_id, p_user_id);
      return jsonb_build_object('ok', false, 'left', 2 - v_tries, 'locked', v_tries + 1 >= 3,
        'message', case when v_tries + 1 >= 3 then '오답 3회로 온라인 신청이 잠겼습니다.'
                        else format('정답이 아닙니다. 남은 기회 %s회', 2 - v_tries) end);
    end if;
  end if;

  update public.items set status = '수령 대기', claimant_id = p_user_id, claimed_at = now()
   where id = p_item_id;
  insert into public.notifications (user_id, item_id, title, body)
  values (v_item.owner_id, p_item_id, '수령 신청이 들어왔어요',
          format('''%s''에 수령 신청이 들어왔습니다. 주인에게 전달되면 수령 완료를 눌러주세요.', v_item.title));
  return jsonb_build_object('ok', true, 'message', '수령 신청이 완료되었습니다.');
end;
$$;

-- 사용자가 직접 호출: 정답을 글자로만 비교 (퀴즈 없는 물건, AI가 꺼져 있을 때)
create or replace function public.claim_item(p_item_id bigint, p_answer text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_school_email() then
    raise exception '학교 이메일로 로그인해야 합니다.';
  end if;
  return public.claim_core(p_item_id, auth.uid(), p_answer, null);
end;
$$;

-- 서버(/api/claim)만 호출: AI가 판단한 정답 여부로 처리
create or replace function public.claim_item_judged(p_item_id bigint, p_user_id uuid, p_correct boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  return public.claim_core(p_item_id, p_user_id, null, p_correct);
end;
$$;

revoke execute on function public.claim_check(bigint, uuid), public.claim_core(bigint, uuid, text, boolean),
  public.claim_item_judged(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_check(bigint, uuid), public.claim_item_judged(bigint, uuid, boolean) to service_role;

-- 수령 완료: 등록자 또는 신청자
create or replace function public.complete_item(p_item_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.items set status = '수령 완료', completed_at = now()
   where id = p_item_id and status = '수령 대기' and auth.uid() in (owner_id, claimant_id);
  if not found then raise exception '수령 완료로 바꿀 수 없는 상태입니다.'; end if;
end;
$$;

-- 수령 신청 취소: 등록자 또는 신청자 → 다시 보관중
create or replace function public.cancel_claim(p_item_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_item public.items;
begin
  update public.items set status = '보관중', claimant_id = null, claimed_at = null
   where id = p_item_id and status = '수령 대기' and auth.uid() in (owner_id, claimant_id)
  returning * into v_item;
  if not found then raise exception '취소할 수 있는 수령 신청이 없습니다.'; end if;
end;
$$;

-- 서로 다른 3명의 신고가 쌓이면 자동 숨김
create or replace function public.on_report()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_title text;
begin
  -- 신고가 3번 이상 기각된 사람의 신고는 관리자 화면에는 올라가지만 자동 숨김 계산에서는 뺀다.
  if (select count(*) from public.reports r
      where r.item_id = new.item_id and not r.reviewed
        and (select count(*) from public.reports x where x.reporter_id = r.reporter_id and x.reviewed) < 3) >= 3 then
    update public.items set hidden = true where id = new.item_id and not hidden
    returning owner_id, title into v_owner, v_title;
    if v_owner is not null then
      insert into public.notifications (user_id, item_id, title, body)
      values (v_owner, new.item_id, '게시물이 숨김 처리되었어요',
              format('''%s'' 게시물이 신고 누적으로 숨김 처리되었습니다.', v_title));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_report on public.reports;
create trigger on_report after insert on public.reports
  for each row execute function public.on_report();

-- 새 습득물과 맞는 분실 알림을 찾아 알림함에 넣고, 메일 보낼 주소를 돌려준다.
-- 서버(/api/notify)만 service_role 키로 호출한다. 한 번만 발송되도록 notified 플래그를 쓴다.
create or replace function public.notify_matches(p_item_id bigint, p_owner uuid)
returns table (email text, keywords text[])
language plpgsql security definer set search_path = public
as $$
declare v_item public.items; v_text text;
begin
  update public.items set notified = true
   where id = p_item_id and owner_id = p_owner and not notified and not hidden
  returning * into v_item;
  if not found then return; end if;

  v_text := lower(concat_ws(' ', v_item.title, v_item.brand, v_item.description, array_to_string(v_item.tags, ' ')));

  return query
  with matched as (
    select w.user_id, w.email, w.keywords
    from public.watches w
    where w.active
      and w.user_id <> v_item.owner_id
      and (w.category is null or w.category = v_item.category)
      and (w.color    is null or v_item.color is null or w.color = v_item.color) -- 습득자가 색을 안 고른 물건도 놓치지 않게
      and (w.buildings is null or v_item.building = any(w.buildings)) -- 등록한 동선 안의 건물에서 나온 물건만
      and (w.lost_from is null or v_item.found_at >= w.lost_from)
      and exists (
        select 1 from unnest(w.keywords) k
        where position(lower(trim(k)) in v_text) > 0
           or exists (  -- 동의어: '에어팟'으로 등록하면 '버즈', '이어폰'이 들어간 물건도 찾는다
                select 1 from public.keyword_synonyms a
                join public.keyword_synonyms b on b.grp = a.grp
                where a.word = lower(trim(k)) and position(b.word in v_text) > 0)
      )
  ), noti as (
    insert into public.notifications (user_id, item_id, title, body)
    select distinct m.user_id, v_item.id, '찾던 물건과 비슷한 습득물이 등록됐어요',
           format('''%s'' · %s · %s', v_item.title, v_item.building, to_char(v_item.found_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'))
    from matched m
  )
  select distinct on (m.email) m.email, m.keywords from matched m;
end;
$$;

-- AI 태깅 1회 사용: 오늘(한국 시간) 사용 횟수가 한도 미만이면 1 늘리고 true, 아니면 false.
-- 서버(/api/tag)만 service_role 키로 호출한다.
create or replace function public.consume_tag_quota(p_user_id uuid, p_limit int)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  insert into public.tag_usage (user_id, day, count)
  values (p_user_id, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (user_id, day) do update set count = public.tag_usage.count + 1
    where public.tag_usage.count < p_limit
  returning count into v_count;
  return v_count is not null;
end;
$$;
revoke execute on function public.consume_tag_quota(uuid, int) from public, anon, authenticated;
grant execute on function public.consume_tag_quota(uuid, int) to service_role;

-- ── 6. 관리자 기능 (함수 안에서 관리자인지 확인) ────────────
create or replace function public.assert_admin()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 사용할 수 있습니다.'; end if;
end;
$$;

-- 관리자 처리 기록 남기기 (관리자 함수 안에서만 호출)
create or replace function public.log_admin(p_action text, p_target text, p_detail text default '')
returns void
language sql security definer set search_path = public
as $$
  insert into public.admin_logs (admin_email, action, target, detail)
  values (lower(auth.jwt() ->> 'email'), p_action, coalesce(p_target, ''), coalesce(p_detail, ''));
$$;

-- 신고가 1건 이상 들어온 게시물, 신고 많은 순
create or replace function public.admin_reported_items()
returns table (item_id bigint, title text, building text, status text, hidden boolean,
               created_at timestamptz, owner_id uuid, owner_email text, owner_banned boolean,
               report_count bigint, reports jsonb)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
  select i.id, i.title, i.building, i.status, i.hidden, i.created_at, i.owner_id, u.email::text,
         exists (select 1 from public.bans b where b.user_id = i.owner_id),
         count(r.id),
         jsonb_agg(jsonb_build_object('reason', r.reason, 'detail', r.detail, 'at', r.created_at)
                   order by r.created_at desc)
  from public.items i
  join public.reports r on r.item_id = i.id and not r.reviewed
  left join auth.users u on u.id = i.owner_id
  group by i.id, u.email
  order by count(r.id) desc, max(r.created_at) desc;
end;
$$;

-- 주의가 필요한 사용자: 정지됐거나, 내 게시물이 신고됐거나, 퀴즈 오답 기록이 있는 사람
-- 반환 칸이 바뀌어 기존 함수를 지우고 다시 만든다.
drop function if exists public.admin_users();
create or replace function public.admin_users()
returns table (user_id uuid, email text, banned boolean, ban_reason text, item_count bigint,
               reports_received bigint, reports_filed bigint, reports_rejected bigint,
               failed_attempts bigint, locked_items bigint, claim_count bigint)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
  select u.id, u.email::text, b.user_id is not null, b.reason,
         (select count(*) from public.items i where i.owner_id = u.id),
         (select count(*) from public.reports r join public.items i on i.id = r.item_id where i.owner_id = u.id),
         (select count(*) from public.reports r where r.reporter_id = u.id),
         -- reviewed = 관리자가 숨김 해제·신고 기각으로 문제없다고 본 신고
         (select count(*) from public.reports r where r.reporter_id = u.id and r.reviewed),
         (select count(*) from public.claim_attempts c where c.user_id = u.id),
         (select count(*) from (select c.item_id from public.claim_attempts c where c.user_id = u.id
                                group by c.item_id having count(*) >= 3) x),
         (select count(*) from public.items i where i.claimant_id = u.id)
  from auth.users u
  left join public.bans b on b.user_id = u.id
  where b.user_id is not null
     or exists (select 1 from public.reports r join public.items i on i.id = r.item_id where i.owner_id = u.id)
     or exists (select 1 from public.reports r where r.reporter_id = u.id and r.reviewed)
     or exists (select 1 from public.claim_attempts c where c.user_id = u.id)
  order by 3 desc, 8 desc, 6 desc, 9 desc;
end;
$$;

-- 숨김/숨김 해제. 해제하면 검토가 끝난 것으로 보고 기존 신고를 정리한다.
create or replace function public.admin_set_hidden(p_item_id bigint, p_hidden boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_title text; v_was boolean;
begin
  perform public.assert_admin();
  select hidden into v_was from public.items where id = p_item_id;
  update public.items set hidden = p_hidden where id = p_item_id returning owner_id, title into v_owner, v_title;
  if not found then raise exception '게시물을 찾을 수 없습니다.'; end if;
  -- 숨겨지지 않은 게시물에 false를 주면 '신고 기각': 신고만 검토 완료로 돌리고 작성자 알림은 보내지 않는다.
  if not p_hidden then
    update public.reports set reviewed = true where item_id = p_item_id and not reviewed;
  end if;
  perform public.log_admin(case when p_hidden then '게시물 숨김' when v_was then '숨김 해제' else '신고 기각' end,
                           v_title, format('게시물 #%s', p_item_id));
  if v_was = p_hidden then return; end if;
  insert into public.notifications (user_id, item_id, title, body)
  values (v_owner, p_item_id,
          case when p_hidden then '관리자가 게시물을 숨겼어요' else '게시물 숨김이 해제되었어요' end,
          format('''%s'' 게시물이 관리자에 의해 %s되었습니다.', v_title, case when p_hidden then '숨김 처리' else '다시 공개' end));
end;
$$;

create or replace function public.admin_delete_item(p_item_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_title text;
begin
  perform public.assert_admin();
  delete from public.items where id = p_item_id returning title into v_title;
  if not found then raise exception '게시물을 찾을 수 없습니다.'; end if;
  perform public.log_admin('게시물 삭제', v_title, format('게시물 #%s', p_item_id));
end;
$$;

-- 이용 정지: 등록·수령 신청·신고를 막고, 아직 끝나지 않은 그 사람의 게시물을 숨긴다.
create or replace function public.admin_ban(p_user_id uuid, p_reason text default '')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_admin();
  if exists (select 1 from auth.users u join public.admins a on a.email = lower(u.email) where u.id = p_user_id) then
    raise exception '관리자는 정지할 수 없습니다.';
  end if;
  insert into public.bans (user_id, reason) values (p_user_id, coalesce(p_reason, ''))
  on conflict (user_id) do update set reason = excluded.reason, banned_at = now();
  update public.items set hidden = true where owner_id = p_user_id and status <> '수령 완료';
  perform public.log_admin('이용 정지', (select email from auth.users where id = p_user_id), p_reason);
  insert into public.notifications (user_id, title, body)
  values (p_user_id, '이용이 정지되었어요',
          coalesce(nullif(p_reason, ''), '운영 정책 위반') || ' 사유로 게시물 등록, 수령 신청, 신고가 제한됩니다.');
end;
$$;

create or replace function public.admin_unban(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_admin();
  delete from public.bans where user_id = p_user_id;
  if not found then raise exception '정지된 사용자가 아닙니다.'; end if;
  perform public.log_admin('정지 해제', (select email from auth.users where id = p_user_id));
  insert into public.notifications (user_id, title, body)
  values (p_user_id, '이용 정지가 해제되었어요', '다시 모든 기능을 이용할 수 있습니다. 숨겨진 게시물은 관리자 검토 후 공개됩니다.');
end;
$$;

-- 관리자 목록·추가·삭제 (관리자 화면에서)
create or replace function public.admin_list_admins()
returns table (email text)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query select a.email from public.admins a order by a.email;
end;
$$;

create or replace function public.admin_add_admin(p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_email text := lower(trim(p_email));
begin
  perform public.assert_admin();
  if not public.is_school_email(v_email) then
    raise exception '학교 이메일만 관리자로 추가할 수 있습니다.';
  end if;
  insert into public.admins (email) values (v_email) on conflict do nothing;
  if not found then raise exception '이미 관리자입니다.'; end if;
  perform public.log_admin('관리자 추가', v_email);
end;
$$;

create or replace function public.admin_remove_admin(p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_email text := lower(trim(p_email));
begin
  perform public.assert_admin();
  if v_email = lower(auth.jwt() ->> 'email') then
    raise exception '자기 자신은 관리자에서 뺄 수 없습니다. 다른 관리자에게 요청하세요.';
  end if;
  delete from public.admins where email = v_email;
  if not found then raise exception '관리자 목록에 없는 메일입니다.'; end if;
  perform public.log_admin('관리자 삭제', v_email);
end;
$$;

-- 최근 처리 기록 200건
create or replace function public.admin_logs_list()
returns table (admin_email text, action text, target text, detail text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query select l.admin_email, l.action, l.target, l.detail, l.created_at
               from public.admin_logs l order by l.created_at desc, l.id desc limit 200;
end;
$$;

revoke execute on function public.log_admin(text, text, text) from public, anon, authenticated;
revoke execute on function public.admin_list_admins(), public.admin_add_admin(text), public.admin_remove_admin(text),
  public.admin_logs_list() from public, anon;
grant execute on function public.admin_list_admins(), public.admin_add_admin(text), public.admin_remove_admin(text),
  public.admin_logs_list() to authenticated;

-- 함수 실행 권한: 기본(public) 권한을 회수하고 필요한 것만 부여
revoke execute on function public.check_item_payload(jsonb), public.update_item(bigint, jsonb, text) from public, anon;
revoke execute on function public.check_item_payload(jsonb) from authenticated;
revoke execute on function public.create_item(jsonb, text), public.claim_item(bigint, text),
  public.complete_item(bigint), public.cancel_claim(bigint), public.notify_matches(bigint, uuid),
  public.on_report(), public.enforce_school_email(), public.is_school_email(text),
  public.is_admin(), public.is_banned(), public.assert_admin(),
  public.admin_reported_items(), public.admin_users(), public.admin_set_hidden(bigint, boolean),
  public.admin_delete_item(bigint), public.admin_ban(uuid, text), public.admin_unban(uuid)
  from public, anon;
grant execute on function public.update_item(bigint, jsonb, text) to authenticated;
grant execute on function public.create_item(jsonb, text), public.claim_item(bigint, text),
  public.complete_item(bigint), public.cancel_claim(bigint), public.is_school_email(text),
  public.is_admin(), public.is_banned(), public.assert_admin(),
  public.admin_reported_items(), public.admin_users(), public.admin_set_hidden(bigint, boolean),
  public.admin_delete_item(bigint), public.admin_ban(uuid, text), public.admin_unban(uuid)
  to authenticated;
revoke execute on function public.notify_matches(bigint, uuid) from authenticated;
grant execute on function public.notify_matches(bigint, uuid) to service_role;

-- ── 7. 사진 저장소 ───────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "item images upload own folder" on storage.objects;
create policy "item images upload own folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_school_email()
  );

-- ============================================================
-- 학교 도메인 설정
insert into public.allowed_domains (domain) values ('gachon.ac.kr') on conflict do nothing;

-- 관리자 이메일 설정 (실제 관리자 학교 메일로 바꾸기. 여러 명이면 줄을 추가, 소문자로)
insert into public.admins (email) values ('change-me@example.invalid') on conflict do nothing;
-- 실제 관리자가 이미 있으면 예시 주소는 지운다 (업데이트 때 이 파일을 그대로 다시 실행해도 되도록)
delete from public.admins where email = 'change-me@example.invalid'
  and exists (select 1 from public.admins where email <> 'change-me@example.invalid');
