-- ============================================================
-- The Family Fridge — Postgres schema for Supabase
--
-- Run this once in the Supabase SQL editor (or via `supabase db
-- push`). It is written to be re-runnable: every object is created
-- with "if not exists" or dropped first, so applying it twice is
-- harmless.
--
-- Identity lives in Supabase's own auth.users. Everything here is
-- about WHICH FAMILY you belong to and what is on their door.
-- Row level security is the real boundary: every policy below is
-- ultimately "are you a member of this household?".
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- People
-- ------------------------------------------------------------

-- One row per signed-in account, mirroring auth.users so that the
-- rest of the schema can reference it and so members can see each
-- other's names without read access to auth.users.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Display name per account. Magnet colour lives on the membership, so the same person can be a different colour in each household.';

-- ------------------------------------------------------------
-- Households — the private family group
-- ------------------------------------------------------------

create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 60),
  -- Which door the family sees. Values match the [data-finish] blocks
  -- in web/fridge.css.
  finish     text not null default 'steel'
             check (finish in ('steel','enamel','graphite','slate','mint','butter','coral','oak')),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Re-runnable on a database created before finishes existed.
alter table public.households
  add column if not exists finish text not null default 'steel';
do $$ begin
  alter table public.households add constraint households_finish_check
    check (finish in ('steel','enamel','graphite','slate','mint','butter','coral','oak'));
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.member_role as enum ('owner', 'member');
exception when duplicate_object then null;
end $$;

create table if not exists public.memberships (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.member_role not null default 'member',
  color        text not null default '#c0392f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);

-- ------------------------------------------------------------
-- Invitations — how someone joins a specific household
-- ------------------------------------------------------------

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email        text not null check (position('@' in email) > 1),
  token_hash   text not null unique,
  role         public.member_role not null default 'member',
  -- When true the invitation only works for someone signed in with
  -- this exact address. Relaxed deliberately for Apple's private
  -- relay addresses, where the invited address never matches.
  email_locked boolean not null default true,
  invited_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles (id) on delete set null,
  revoked_at   timestamptz
);

create index if not exists invitations_household_idx on public.invitations (household_id);

-- One live invitation per address per household; spent ones may pile up.
create unique index if not exists invitations_pending_idx
  on public.invitations (household_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- ------------------------------------------------------------
-- What is on the door
-- ------------------------------------------------------------

create table if not exists public.notes (
  household_id uuid not null references public.households (id) on delete cascade,
  -- Client-generated so a note can be drawn the instant it is made.
  -- The key is (household, id), not id alone: ids are minted offline
  -- and some are fixed ('calendar'), so two families are entitled to
  -- the same one.
  id           text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind         text not null check (kind in ('sticky','reminder','event','announce','list','memory','calendar')),
  body         text not null default '',
  title        text,
  pen          text,
  paper        text,
  sticker      text,
  tilt         real not null default 0,
  x            real not null default 0.1,
  y            real not null default 0.1,
  raised       bigint not null default 0,
  done         boolean not null default false,
  date         text check (date is null or date ~ '^\d{4}-\d{2}-\d{2}$'),
  time         text check (time is null or time ~ '^\d{2}:\d{2}$'),
  items        jsonb not null default '[]'::jsonb,
  -- A photo in the storage bucket, as "<household id>/<file>". The
  -- bytes never live in this table; only the pointer does.
  image        text check (image is null or image ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,80}$'),
  -- How the polaroid window is cropped: square, landscape or portrait.
  shape        text check (shape is null or shape in ('','wide','tall')),
  -- The colour behind a sticker, when a polaroid has no photo yet.
  tint         text,
  author_id    uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (household_id, id)
);

-- Re-runnable on a database created before photos existed.
alter table public.notes add column if not exists image text;
alter table public.notes add column if not exists shape text;
alter table public.notes add column if not exists tint text;

create index if not exists notes_household_idx on public.notes (household_id);
create index if not exists notes_household_updated_idx on public.notes (household_id, updated_at desc);

create table if not exists public.replies (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  note_id      text not null,
  author_id    uuid references public.profiles (id) on delete set null,
  body         text not null check (length(body) between 1 and 400),
  created_at   timestamptz not null default now(),
  -- Carries the household in the key, so a reply cannot be filed
  -- against another family's note even by a buggy caller.
  foreign key (household_id, note_id)
    references public.notes (household_id, id) on delete cascade
);

create index if not exists replies_note_idx on public.replies (household_id, note_id, created_at);
create index if not exists replies_household_idx on public.replies (household_id);

-- ------------------------------------------------------------
-- Photo storage
--
-- Private bucket. No policies are granted to the `authenticated` role:
-- the server reads and writes it with the service role, and checks
-- household membership itself on every request (server/src/routes/
-- photos.js), which is the same check the note policies make. Signed
-- URLs are avoided on purpose — they expire, and a note keeps its photo
-- for years.
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fridge-photos', 'fridge-photos', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- Membership tests
--
-- security definer, so a policy on memberships can ask about
-- memberships without recursing into its own policy. search_path is
-- pinned because a definer function inherits the caller's otherwise.
-- ------------------------------------------------------------

create or replace function public.is_member(h uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
    where household_id = h and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(h uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
    where household_id = h and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Does this account share any household with the current user?
create or replace function public.shares_household(other uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid() and theirs.user_id = other
  );
$$;

revoke all on function public.is_member(uuid) from public;
revoke all on function public.is_owner(uuid) from public;
revoke all on function public.shares_household(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;
grant execute on function public.shares_household(uuid) to authenticated;

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.households  enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.notes       enable row level security;
alter table public.replies     enable row level security;

-- profiles: yourself, and anyone you share a door with.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_household(id));

drop policy if exists profiles_write_own on public.profiles;
create policy profiles_write_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- households: members read; anyone may start one; owners rename it.
drop policy if exists households_read on public.households;
create policy households_read on public.households for select to authenticated
  using (public.is_member(id));

drop policy if exists households_create on public.households;
create policy households_create on public.households for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists households_update on public.households;
create policy households_update on public.households for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

drop policy if exists households_delete on public.households;
create policy households_delete on public.households for delete to authenticated
  using (public.is_owner(id));

-- memberships: members see the family; you may claim your own
-- founding membership; owners remove people; anyone may leave.
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated
  using (public.is_member(household_id));

drop policy if exists memberships_found on public.memberships;
create policy memberships_found on public.memberships for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.households hh
      where hh.id = household_id and hh.created_by = auth.uid()
    )
  );

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated
  using (user_id = auth.uid() or public.is_owner(household_id))
  with check (user_id = auth.uid() or public.is_owner(household_id));

drop policy if exists memberships_remove on public.memberships;
create policy memberships_remove on public.memberships for delete to authenticated
  using (user_id = auth.uid() or public.is_owner(household_id));

-- invitations: the family sees and writes its own. Redeeming one is
-- done by the server with the service role, because the invitee is
-- by definition not a member yet and so matches no policy here.
drop policy if exists invitations_read on public.invitations;
create policy invitations_read on public.invitations for select to authenticated
  using (public.is_member(household_id));

drop policy if exists invitations_create on public.invitations;
create policy invitations_create on public.invitations for insert to authenticated
  with check (public.is_member(household_id) and invited_by = auth.uid());

drop policy if exists invitations_revoke on public.invitations;
create policy invitations_revoke on public.invitations for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_member(household_id));

-- notes and replies: the household, and only the household.
drop policy if exists notes_read on public.notes;
create policy notes_read on public.notes for select to authenticated
  using (public.is_member(household_id));

drop policy if exists notes_create on public.notes;
create policy notes_create on public.notes for insert to authenticated
  with check (public.is_member(household_id));

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated
  using (public.is_member(household_id));

drop policy if exists replies_read on public.replies;
create policy replies_read on public.replies for select to authenticated
  using (public.is_member(household_id));

drop policy if exists replies_create on public.replies;
create policy replies_create on public.replies for insert to authenticated
  with check (public.is_member(household_id) and author_id = auth.uid());

-- Your own words are yours to take back; an owner can tidy up.
drop policy if exists replies_delete on public.replies;
create policy replies_delete on public.replies for delete to authenticated
  using (author_id = auth.uid() or public.is_owner(household_id));

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------

-- A profile for every new account, whichever way they signed up.
-- Google and Apple put the name in different metadata keys, and Apple
-- often sends no name at all after the very first sign-in, so the
-- email's local part is the last resort.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  guess text;
begin
  guess := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Someone'
  );

  insert into public.profiles (id, display_name, email)
  values (new.id, left(guess, 40), new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the email in step if the account's address changes.
drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

drop trigger if exists replies_household on public.replies;
drop function if exists public.reply_household_guard();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Grants. RLS decides the rows; these decide the tables.
-- ------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles    to authenticated;
grant select, insert, update, delete on public.households  to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select, insert, update, delete on public.notes       to authenticated;
grant select, insert, delete         on public.replies     to authenticated;

-- The anonymous role needs nothing: every route requires a session.
revoke all on all tables in schema public from anon;
