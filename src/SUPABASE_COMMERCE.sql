-- ============================================================================
-- GFC commerce + Discord-auth security migration
-- Run once in Supabase SQL Editor BEFORE enabling Discord sign-in.
--
-- IMPORTANT: replace ADMIN_USER_UUID below with the UUID of the existing admin
-- from Authentication -> Users, then run that INSERT separately.
-- ============================================================================

create extension if not exists pgcrypto;

-- Explicit administrator allowlist. A public Discord login is authenticated,
-- but it is NOT an administrator unless its UUID is present here.
create table if not exists public.gfc_admins ((user_id = auth.uid(55ebd09c-781d-4adb-b110-73e04d4f0a44));
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.gfc_admins enable row level security;
drop policy if exists "admins can read own role" on public.gfc_admins;
create policy "admins can read own role" on public.gfc_admins
  for select to authenticated using (user_id = auth.uid());

-- Run after replacing the UUID:
-- insert into public.gfc_admins (user_id)
-- values ('ADMIN_USER_UUID') on conflict do nothing;

-- Replace the old any-authenticated-user write rules on the shared site blob.
drop policy if exists "auth insert" on public.site;
drop policy if exists "auth update" on public.site;
drop policy if exists "admin insert" on public.site;
drop policy if exists "admin update" on public.site;

create policy "admin insert" on public.site for insert to authenticated
  with check (exists (select 1 from public.gfc_admins a where a.user_id = auth.uid()));
create policy "admin update" on public.site for update to authenticated
  using (exists (select 1 from public.gfc_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.gfc_admins a where a.user_id = auth.uid()));

-- One order owns one or more seats. ticket_seats supplies the unique constraint
-- that prevents double-booking under concurrent requests.
create table if not exists public.ticket_orders (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  seats text[] not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid','cancelled','expired','refunded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create table if not exists public.ticket_seats (
  order_id uuid not null references public.ticket_orders(id) on delete cascade,
  event_id text not null,
  seat text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (event_id, seat)
);

alter table public.ticket_orders enable row level security;
alter table public.ticket_seats enable row level security;
drop policy if exists "users read own ticket orders" on public.ticket_orders;
create policy "users read own ticket orders" on public.ticket_orders
  for select to authenticated using (user_id = auth.uid());

create or replace function public.get_gfc_reserved_seats(p_event_id text)
returns table (seat text)
language sql security definer set search_path = public
as $$
  select ts.seat
  from public.ticket_seats ts
  join public.ticket_orders o on o.id = ts.order_id
  where ts.event_id = p_event_id
    and o.status in ('paid','pending')
    and (o.status = 'paid' or o.expires_at > now());
$$;

create or replace function public.reserve_gfc_tickets(p_event_id text, p_seats text[])
returns table (booking_ref uuid, amount numeric, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event jsonb;
  v_price numeric;
  v_order uuid := gen_random_uuid();
  v_exp timestamptz := now() + interval '15 minutes';
  v_seat text;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_event_id is null or coalesce(array_length(p_seats,1),0) not between 1 and 8 then
    raise exception 'Choose between 1 and 8 seats';
  end if;
  if (select count(distinct upper(x)) from unnest(p_seats) x) <> array_length(p_seats,1) then
    raise exception 'Duplicate seat';
  end if;

  select event into v_event
  from public.site s,
       lateral jsonb_array_elements(coalesce(s.data->'upcomingFights','[]'::jsonb)) event
  where s.id = 1 and coalesce(event->>'ticketId','') = p_event_id
    and coalesce((event->'tickets'->>'enabled')::boolean,false)
  limit 1;
  if v_event is null then raise exception 'Event is not on sale'; end if;
  v_price := greatest(coalesce((v_event->'tickets'->>'price')::numeric,0),0);

  -- Release expired unpaid holds before applying the uniqueness constraint.
  delete from public.ticket_orders where status = 'pending' and expires_at <= now();

  foreach v_seat in array p_seats loop
    v_seat := upper(trim(v_seat));
    if v_seat !~ '^[A-Z0-9]{1,4}[0-9]{1,3}$' then raise exception 'Invalid seat %', v_seat; end if;
  end loop;

  insert into public.ticket_orders (id,event_id,user_id,seats,amount,status,expires_at)
  values (v_order,p_event_id,v_user,(select array_agg(upper(trim(x))) from unnest(p_seats) x),v_price*array_length(p_seats,1),'pending',v_exp);
  foreach v_seat in array p_seats loop
    insert into public.ticket_seats (order_id,event_id,seat,user_id,expires_at)
    values (v_order,p_event_id,upper(trim(v_seat)),v_user,v_exp);
  end loop;
  return query select v_order, v_price*array_length(p_seats,1), v_exp;
end;
$$;

create table if not exists public.membership_orders (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','active','cancelled','expired','refunded')),
  created_at timestamptz not null default now()
);
alter table public.membership_orders enable row level security;
drop policy if exists "users read own membership orders" on public.membership_orders;
create policy "users read own membership orders" on public.membership_orders
  for select to authenticated using (user_id = auth.uid());

create or replace function public.start_gfc_membership(p_plan_id text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_plan jsonb; v_id uuid := gen_random_uuid(); v_price numeric;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select plan into v_plan from public.site s,
    lateral jsonb_array_elements(coalesce(s.data->'membershipPlans','[]'::jsonb)) plan
    where s.id=1 and coalesce(plan->>'id','')=p_plan_id limit 1;
  if v_plan is null then raise exception 'Unknown membership plan'; end if;
  v_price := greatest(coalesce((v_plan->>'price')::numeric,0),0);
  insert into public.membership_orders (id,plan_id,user_id,amount) values (v_id,p_plan_id,v_user,v_price);
  return v_id;
end;
$$;

revoke all on function public.reserve_gfc_tickets(text,text[]) from public;
revoke all on function public.start_gfc_membership(text) from public;
grant execute on function public.get_gfc_reserved_seats(text) to anon, authenticated;
grant execute on function public.reserve_gfc_tickets(text,text[]) to authenticated;
grant execute on function public.start_gfc_membership(text) to authenticated;

-- Payment provider webhooks must change pending -> paid/active from a trusted
-- server or Edge Function using the service role. Never expose that key here.
