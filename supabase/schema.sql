-- ============================================================
-- 교내 분실물 스마트 찾기 — Supabase 스키마
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

-- 화면에 보여줄 상태: 보관중인데 습득 후 30일이 지나면 '장기 미수령'
create or replace view public.items_view with (security_invoker = true) as
select i.*,
       case when i.status = '보관중' and i.found_at < now() - interval '30 days'
            then '장기 미수령' else i.status end as display_status
from public.items i;

-- ── 2. 신고 ──────────────────────────────────────────────────
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.items on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users on delete cascade,
  reason      text not null check (reason in ('허위 게시물','부적절한 사진/내용','개인정보 노출','이미 반환됨','기타')),
  detail      text not null default '' check (char_length(detail) <= 300),
  created_at  timestamptz not null default now(),
  unique (item_id, reporter_id)
);

-- ── 3. 분실 알림(키워드 구독) & 알림함 ───────────────────────
create table if not exists public.watches (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  email      text not null default (auth.jwt() ->> 'email'),
  keywords   text[] not null check (cardinality(keywords) between 1 and 10),
  category   text,
  color      text,
  building   text,
  lost_from  date,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

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

-- ── 4. 권한 (RLS) ────────────────────────────────────────────
alter table public.allowed_domains enable row level security;
alter table public.items           enable row level security;
alter table public.item_secrets    enable row level security;
alter table public.claim_attempts  enable row level security;
alter table public.reports         enable row level security;
alter table public.watches         enable row level security;
alter table public.notifications   enable row level security;

-- Supabase는 새 테이블에 ALL 권한을 기본 부여하므로 먼저 회수하고 필요한 것만 다시 준다.
revoke all on public.allowed_domains, public.items, public.items_view, public.item_secrets,
              public.claim_attempts, public.reports, public.watches, public.notifications
  from anon, authenticated;

grant select, delete on public.items to authenticated;
grant select on public.items_view to authenticated;
grant select, insert (item_id, reason, detail) on public.reports to authenticated;
grant select, delete, insert (keywords, category, color, building, lost_from), update (active)
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
    reporter_id = auth.uid() and public.is_school_email()
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
  if v_quiz is not null and coalesce(trim(p_answer), '') = '' then
    raise exception '확인 퀴즈의 정답을 입력해주세요.';
  end if;
  if v_img is not null and v_img not like auth.uid()::text || '/%' then
    raise exception '잘못된 이미지 경로입니다.';
  end if;
  if (p ->> 'found_at')::timestamptz > now() + interval '10 minutes' then
    raise exception '습득 시각이 미래일 수 없습니다.';
  end if;

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

-- 수령 신청: 퀴즈가 있으면 정답 확인 (3회 오답 시 잠금)
create or replace function public.claim_item(p_item_id bigint, p_answer text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item   public.items;
  v_answer text;
  v_tries  int;
  v_user   text := normalize_answer(p_answer);
  v_right  text;
begin
  if auth.uid() is null or not public.is_school_email() then
    raise exception '학교 이메일로 로그인해야 합니다.';
  end if;
  select * into v_item from public.items where id = p_item_id and not hidden for update;
  if not found then return jsonb_build_object('ok', false, 'message', '물건을 찾을 수 없습니다.'); end if;
  if v_item.owner_id = auth.uid() then
    return jsonb_build_object('ok', false, 'message', '내가 등록한 물건은 신청할 수 없습니다.');
  end if;
  if v_item.status <> '보관중' then
    return jsonb_build_object('ok', false, 'message', '이미 수령 신청이 진행 중이거나 완료된 물건입니다.');
  end if;

  if v_item.quiz_question is not null then
    select count(*) into v_tries from public.claim_attempts where item_id = p_item_id and user_id = auth.uid();
    if v_tries >= 3 then
      return jsonb_build_object('ok', false, 'locked', true,
        'message', '오답 3회로 온라인 신청이 잠겼습니다. 등록자에게 직접 문의해주세요.');
    end if;
    select answer into v_answer from public.item_secrets where item_id = p_item_id;
    v_right := normalize_answer(v_answer);
    -- 정확히 일치하거나 정답 뒤에 조사·어미 정도만 붙은 경우만 허용 ("카드" ≠ "체크카드")
    if v_user = '' or not (v_user = v_right or (position(v_right in v_user) > 0 and length(v_user) <= length(v_right) + 3)) then
      insert into public.claim_attempts (item_id, user_id) values (p_item_id, auth.uid());
      return jsonb_build_object('ok', false, 'left', 2 - v_tries, 'locked', v_tries + 1 >= 3,
        'message', case when v_tries + 1 >= 3 then '오답 3회로 온라인 신청이 잠겼습니다.'
                        else format('정답이 아닙니다. 남은 기회 %s회', 2 - v_tries) end);
    end if;
  end if;

  update public.items set status = '수령 대기', claimant_id = auth.uid(), claimed_at = now()
   where id = p_item_id;
  insert into public.notifications (user_id, item_id, title, body)
  values (v_item.owner_id, p_item_id, '수령 신청이 들어왔어요',
          format('''%s''에 수령 신청이 들어왔습니다. 주인에게 전달되면 수령 완료를 눌러주세요.', v_item.title));
  return jsonb_build_object('ok', true, 'message', '수령 신청이 완료되었습니다.');
end;
$$;

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

-- 신고 3건이 쌓이면 자동 숨김
create or replace function public.on_report()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_title text;
begin
  if (select count(*) from public.reports where item_id = new.item_id) >= 3 then
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
      and (w.color    is null or w.color    = v_item.color)
      and (w.building is null or w.building = v_item.building)
      and (w.lost_from is null or v_item.found_at >= w.lost_from)
      and exists (select 1 from unnest(w.keywords) k where position(lower(trim(k)) in v_text) > 0)
  ), noti as (
    insert into public.notifications (user_id, item_id, title, body)
    select distinct m.user_id, v_item.id, '찾던 물건과 비슷한 습득물이 등록됐어요',
           format('''%s'' · %s · %s', v_item.title, v_item.building, to_char(v_item.found_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'))
    from matched m
  )
  select distinct on (m.email) m.email, m.keywords from matched m;
end;
$$;

-- 함수 실행 권한: 기본(public) 권한을 회수하고 필요한 것만 부여
revoke execute on function public.create_item(jsonb, text), public.claim_item(bigint, text),
  public.complete_item(bigint), public.cancel_claim(bigint), public.notify_matches(bigint, uuid),
  public.on_report(), public.enforce_school_email(), public.is_school_email(text)
  from public, anon;
grant execute on function public.create_item(jsonb, text), public.claim_item(bigint, text),
  public.complete_item(bigint), public.cancel_claim(bigint), public.is_school_email(text)
  to authenticated;
revoke execute on function public.notify_matches(bigint, uuid) from authenticated;
grant execute on function public.notify_matches(bigint, uuid) to service_role;

-- ── 6. 사진 저장소 ───────────────────────────────────────────
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
