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
create table if not exists public.gfc_admins (
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
  v_tickets jsonb;
  v_price numeric;
  v_total numeric := 0;
  v_order uuid := gen_random_uuid();
  v_exp timestamptz := now() + interval '15 minutes';
  v_seat text;
  v_row text;
  v_number integer;
  v_type jsonb;
  v_suite jsonb;
  v_normalized text[];
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_event_id is null or coalesce(array_length(p_seats,1),0) not between 1 and 8 then
    raise exception 'Choose between 1 and 8 seats';
  end if;
  select array_agg(upper(trim(x))) into v_normalized from unnest(p_seats) x;
  if (select count(distinct x) from unnest(v_normalized) x) <> array_length(v_normalized,1) then
    raise exception 'Duplicate seat';
  end if;

  select event into v_event
  from public.site s,
       lateral jsonb_array_elements(coalesce(s.data->'upcomingFights','[]'::jsonb)) event
  where s.id = 1 and coalesce(event->>'ticketId','') = p_event_id
    and coalesce((event->'tickets'->>'enabled')::boolean,false)
  limit 1;
  if v_event is null then raise exception 'Event is not on sale'; end if;
  v_tickets := coalesce(v_event->'tickets','{}'::jsonb);
  v_price := greatest(coalesce((v_tickets->>'price')::numeric,0),0);

  -- Release expired unpaid holds before applying the uniqueness constraint.
  delete from public.ticket_orders where status = 'pending' and expires_at <= now();

  foreach v_seat in array v_normalized loop
    if v_seat ~ '^SUITE[0-9]{1,3}$' then
      v_suite := coalesce(v_tickets->'suite','{}'::jsonb);
      v_number := substring(v_seat from '[0-9]+$')::integer;
      if not coalesce((v_suite->>'enabled')::boolean,false)
         or v_number < 1 or v_number > greatest(coalesce((v_suite->>'quantity')::integer,0),0) then
        raise exception 'Invalid suite %', v_seat;
      end if;
      if position(',' || v_seat || ',' in ',' || upper(replace(coalesce(v_suite->>'unavailableSuites',''),' ','')) || ',') > 0 then
        raise exception 'Suite % is unavailable', v_seat;
      end if;
      v_total := v_total + greatest(coalesce((v_suite->>'price')::numeric,0),0);
    else
      if v_seat !~ '^[A-Z]{1,4}[0-9]{1,3}$' then raise exception 'Invalid seat %', v_seat; end if;
      v_row := regexp_replace(v_seat,'[0-9]+$','');
      v_number := substring(v_seat from '[0-9]+$')::integer;
      if not (v_row = any(string_to_array(upper(replace(coalesce(v_tickets->>'rows',''),' ','')),',')))
         or v_number < 1 or v_number > greatest(coalesce((v_tickets->>'seatsPerRow')::integer,0),0) then
        raise exception 'Seat % is outside the configured map', v_seat;
      end if;
      if position(',' || v_seat || ',' in ',' || upper(replace(coalesce(v_tickets->>'unavailableSeats',''),' ','')) || ',') > 0 then
        raise exception 'Seat % is unavailable', v_seat;
      end if;

      v_type := null;
      select category into v_type
      from jsonb_array_elements(coalesce(v_tickets->'seatTypes','[]'::jsonb)) category
      where v_row = any(string_to_array(upper(replace(coalesce(category->>'rows',''),' ','')),','))
      limit 1;
      if v_type is null then
        select category into v_type
        from jsonb_array_elements(coalesce(v_tickets->'seatTypes','[]'::jsonb)) category
        where lower(coalesce(category->>'name','')) = 'regular'
        limit 1;
      end if;
      v_total := v_total + case
        when coalesce((v_type->>'price')::numeric,0) > 0 then (v_type->>'price')::numeric
        else v_price
      end;
    end if;
  end loop;

  insert into public.ticket_orders (id,event_id,user_id,seats,amount,status,expires_at)
  values (v_order,p_event_id,v_user,v_normalized,v_total,'pending',v_exp);
  foreach v_seat in array v_normalized loop
    insert into public.ticket_seats (order_id,event_id,seat,user_id,expires_at)
    values (v_order,p_event_id,v_seat,v_user,v_exp);
  end loop;
  return query select v_order, v_total, v_exp;
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
