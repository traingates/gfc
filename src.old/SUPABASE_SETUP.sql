-- ============================================================================
--  GFC — Supabase setup
--  Run this once in your Supabase project:  SQL Editor → New query → paste →
--  Run.  It creates a single-row table that holds the whole site's data, and
--  locks it down so ANYONE can read the site but only a LOGGED-IN admin can
--  change it.
-- ============================================================================

-- 1. One row (id = 1) holds the entire site data blob as JSON.
create table if not exists public.site (
  id         integer primary key default 1,
  data       jsonb   not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint site_single_row check (id = 1)
);

-- Seed the single row so the first read succeeds.
insert into public.site (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- 2. Turn on Row Level Security (nothing is allowed until a policy says so).
alter table public.site enable row level security;

-- 3. READ: anyone (logged in or not) can load the site data.
drop policy if exists "public read" on public.site;
create policy "public read"
  on public.site
  for select
  to anon, authenticated
  using (true);

-- 4. WRITE: only an explicitly allowlisted administrator can insert/update.
-- This distinction matters because ordinary members also authenticate with
-- Discord and must never gain access to the content manager.
create table if not exists public.gfc_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.gfc_admins enable row level security;
drop policy if exists "admins can read own role" on public.gfc_admins;
create policy "admins can read own role" on public.gfc_admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "auth insert" on public.site;
drop policy if exists "admin insert" on public.site;
create policy "admin insert"
  on public.site
  for insert
  to authenticated
  with check (exists (select 1 from public.gfc_admins a where a.user_id = auth.uid()));

drop policy if exists "auth update" on public.site;
drop policy if exists "admin update" on public.site;
create policy "admin update"
  on public.site
  for update
  to authenticated
  using (exists (select 1 from public.gfc_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.gfc_admins a where a.user_id = auth.uid()));

-- ============================================================================
--  After running this:
--   • Authentication → Users → Add user  (your email + password, confirmed).
--     That becomes your admin login.
--   • Copy that user's UUID and allowlist it:
--       insert into public.gfc_admins (user_id)
--       values ('PASTE-ADMIN-USER-UUID') on conflict do nothing;
--   • Turn OFF public sign-ups so no one else can register:
--     Authentication → Sign In / Providers → Email → disable "Allow new users
--     to sign up".
--   • Project Settings → API → copy the Project URL and the anon public key
--     into index.html (window.GFC_CLOUD), then redeploy.
-- ============================================================================
