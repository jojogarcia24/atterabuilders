-- ================================================================
-- ATERRA BUILDERS — Supabase schema
-- Run in the Supabase SQL editor (or as a migration).
-- Covers: lead capture (inquiries + subscribers), engagement
-- tracking + hot-lead heat score, web-push, and RLS.
-- ================================================================

-- ---------- extensions ----------
create extension if not exists pgcrypto;

-- ================================================================
-- 1. PROFILES / ADMIN HELPER
-- ================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       text default 'client',      -- 'client' | 'agent' | 'admin'
  phone      text,
  created_at timestamptz not null default now()
);

-- auto-create a profile row when a user signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ================================================================
-- 2. LEAD CAPTURE  (public forms write here with the anon key)
-- ================================================================
create table if not exists public.inquiries (
  id           uuid primary key default gen_random_uuid(),
  first_name   text,
  last_name    text,
  name         text,
  email        text,
  phone        text,
  project_type text,
  message      text,
  source_url   text,
  status       text not null default 'new',   -- 'new' | 'contacted' | 'won' | 'archived'
  created_at   timestamptz not null default now()
);
create index if not exists inquiries_created_idx on public.inquiries(created_at desc);

create table if not exists public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  source_url text,
  created_at timestamptz not null default now(),
  unique (email)
);
create index if not exists subscribers_created_idx on public.subscribers(created_at desc);

-- ================================================================
-- 3. ENGAGEMENT + ALERTS + PUSH  (service-role function writes these)
-- ================================================================
create table if not exists public.page_engagement (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  path          text,
  url           text,
  title         text,
  listing_id    text,
  kind          text not null default 'page',   -- 'page' | 'property'
  dwell_seconds integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists page_engagement_user_idx    on public.page_engagement(user_id);
create index if not exists page_engagement_created_idx  on public.page_engagement(created_at);
create index if not exists page_engagement_listing_idx  on public.page_engagement(listing_id);

create table if not exists public.engagement_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  listing_id text,
  created_at timestamptz not null default now()
);
create index if not exists engagement_alerts_user_idx on public.engagement_alerts(user_id, listing_id, created_at);

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null,
  p256dh       text,
  auth         text,
  subscription jsonb not null,
  user_agent   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (user_id, endpoint)
);

-- ================================================================
-- 4. FAVORITES  (feeds the heat score)
-- ================================================================
create table if not exists public.saved_listings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  listing_id text not null,
  address    text,
  price      numeric,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

-- ================================================================
-- 5. AGENTS / CLIENT ROUTING  (optional — for multi-agent routing)
-- ================================================================
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text, email text, phone text,
  ghl_user_id text
);
create table if not exists public.agent_clients (
  id uuid primary key default gen_random_uuid(),
  agent_user_id  uuid,
  client_user_id uuid,
  created_at timestamptz default now()
);

-- ================================================================
-- 6. RLS
-- ================================================================
alter table public.profiles          enable row level security;
alter table public.inquiries         enable row level security;
alter table public.subscribers       enable row level security;
alter table public.page_engagement   enable row level security;
alter table public.engagement_alerts enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.saved_listings    enable row level security;

-- profiles: a user reads/updates their own; admins read all
drop policy if exists prof_self_read   on public.profiles;
drop policy if exists prof_self_update on public.profiles;
drop policy if exists prof_admin_read  on public.profiles;
create policy prof_self_read   on public.profiles for select using ( id = auth.uid() );
create policy prof_self_update on public.profiles for update using ( id = auth.uid() ) with check ( id = auth.uid() );
create policy prof_admin_read  on public.profiles for select using ( is_admin() );

-- inquiries: ANYONE (anon) may insert; only admins may read/update.
drop policy if exists inq_anon_insert on public.inquiries;
drop policy if exists inq_admin_read  on public.inquiries;
drop policy if exists inq_admin_update on public.inquiries;
create policy inq_anon_insert on public.inquiries for insert to anon, authenticated with check ( true );
create policy inq_admin_read  on public.inquiries for select using ( is_admin() );
create policy inq_admin_update on public.inquiries for update using ( is_admin() ) with check ( is_admin() );

-- subscribers: ANYONE may insert; only admins may read.
drop policy if exists sub_anon_insert on public.subscribers;
drop policy if exists sub_admin_read  on public.subscribers;
create policy sub_anon_insert on public.subscribers for insert to anon, authenticated with check ( true );
create policy sub_admin_read  on public.subscribers for select using ( is_admin() );

-- page_engagement / engagement_alerts: admin read only (service-role writes; no insert policy on purpose).
drop policy if exists eng_admin_read on public.page_engagement;
create policy eng_admin_read on public.page_engagement for select using ( is_admin() );
drop policy if exists ea_admin_read on public.engagement_alerts;
create policy ea_admin_read on public.engagement_alerts for select using ( is_admin() );

-- push_subscriptions: a user manages only their own devices.
drop policy if exists ps_own_all on public.push_subscriptions;
create policy ps_own_all on public.push_subscriptions
  for all to authenticated using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- saved_listings: owner full CRUD; admins read.
drop policy if exists sl_select_own on public.saved_listings;
drop policy if exists sl_insert_own on public.saved_listings;
drop policy if exists sl_update_own on public.saved_listings;
drop policy if exists sl_delete_own on public.saved_listings;
drop policy if exists sl_admin_read on public.saved_listings;
create policy sl_select_own on public.saved_listings for select using ( auth.uid() = user_id );
create policy sl_insert_own on public.saved_listings for insert with check ( auth.uid() = user_id );
create policy sl_update_own on public.saved_listings for update using ( auth.uid() = user_id ) with check ( auth.uid() = user_id );
create policy sl_delete_own on public.saved_listings for delete using ( auth.uid() = user_id );
create policy sl_admin_read  on public.saved_listings for select using ( is_admin() );

-- ================================================================
-- 7. HEAT-SCORE RPC
-- ================================================================
create or replace function public.get_lead_scores()
 returns table(user_id uuid, full_name text, email text, phone text, score integer,
   property_views integer, distinct_properties integer, favorites integer,
   visit_days integer, total_seconds bigint, last_seen timestamptz,
   agent_user_id uuid, recent_properties jsonb, favorite_listings jsonb)
 language sql stable security definer set search_path to 'public'
as $function$
  with eng as (
    select user_id,
      sum(dwell_seconds) as total_seconds,
      count(*) filter (where kind='property') as property_views,
      count(distinct listing_id) filter (where kind='property') as distinct_properties,
      count(distinct date(created_at)) as visit_days,
      max(created_at) as last_seen
    from public.page_engagement group by user_id
  ),
  props as (
    select user_id, jsonb_agg(jsonb_build_object(
        'listing_id', listing_id, 'title', title, 'url', url,
        'seconds', seconds, 'last_at', last_at) order by last_at desc) as recent_properties
    from (
      select user_id, listing_id, max(title) as title, max(url) as url,
        sum(dwell_seconds) as seconds, max(created_at) as last_at
      from public.page_engagement
      where kind='property' and listing_id is not null
      group by user_id, listing_id
    ) pp group by user_id
  ),
  favp as (
    select user_id, jsonb_agg(jsonb_build_object(
        'listing_id', listing_id, 'address', address, 'price', price) order by created_at desc) as favorite_listings
    from public.saved_listings where listing_id is not null group by user_id
  ),
  fav as (select user_id, count(*) as favorites from public.saved_listings group by user_id),
  asg as (select distinct on (client_user_id) client_user_id, agent_user_id
          from public.agent_clients where client_user_id is not null)
  select
    p.id, p.full_name, au.email, p.phone,
    least(100, round(
      least(40, coalesce(e.total_seconds,0)/60.0 * 2) +   -- time on site (max 40)
      least(25, coalesce(e.property_views,0) * 5) +        -- properties viewed (max 25)
      least(20, coalesce(f.favorites,0) * 10) +            -- favorites (max 20)
      least(15, coalesce(e.visit_days,0) * 5)              -- return visits (max 15)
    ))::int as score,
    coalesce(e.property_views,0)::int,
    coalesce(e.distinct_properties,0)::int,
    coalesce(f.favorites,0)::int,
    coalesce(e.visit_days,0)::int,
    coalesce(e.total_seconds,0)::bigint,
    e.last_seen,
    asg.agent_user_id,
    coalesce(pr.recent_properties, '[]'::jsonb),
    coalesce(fp.favorite_listings, '[]'::jsonb)
  from public.profiles p
  join auth.users au on au.id = p.id
  left join eng e on e.user_id = p.id
  left join fav f on f.user_id = p.id
  left join props pr on pr.user_id = p.id
  left join favp fp on fp.user_id = p.id
  left join asg on asg.client_user_id = p.id
  where (coalesce(e.total_seconds,0) > 0 or coalesce(f.favorites,0) > 0)
    and (public.is_admin() or asg.agent_user_id = auth.uid())
  order by score desc, e.last_seen desc nulls last;
$function$;

grant execute on function public.get_lead_scores() to authenticated;

-- ================================================================
-- 8. MAKE YOURSELF ADMIN  (run once, after you sign up in the app)
-- ================================================================
-- update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@yourdomain.com');
