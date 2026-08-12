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

-- handle_new_user is only a trigger function; it must not be a public RPC.
-- Revoking EXECUTE does not affect the trigger (triggers run regardless).
revoke execute on function public.handle_new_user() from public, anon, authenticated;

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

-- Private investor deal-room access links (magic-link tokens). The serverless
-- function validates a token with the service role; admins manage rows via RLS.
create table if not exists public.investor_links (
  id             uuid primary key default gen_random_uuid(),
  token          text unique not null,
  name           text,
  email          text,
  phone          text,
  note           text,                       -- free-form label
  deck           text not null default 'investor',  -- 'investor' | 'partner'
  active         boolean not null default true,
  view_count     integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now(),
  -- Deck-engagement heat (mirrors the Elite Living deal platform). Written by
  -- the invest-engagement function; used to fire the "going deep" Voss alert.
  first_viewed_at       timestamptz,
  total_dwell_seconds   integer not null default 0,   -- MAX active reading time across sessions
  sections_viewed       jsonb   not null default '{}'::jsonb, -- { "<section label>": <seconds>, ... }
  engagement_level      text,                          -- last alerted level: 'warm' | 'hot'
  engagement_notified_at timestamptz                   -- debounce: last Voss alert for this link
);
create index if not exists investor_links_token_idx on public.investor_links(token);
create index if not exists investor_links_created_idx on public.investor_links(created_at desc);

-- Idempotent upgrade for projects created before deck-engagement shipped.
alter table public.investor_links add column if not exists first_viewed_at        timestamptz;
alter table public.investor_links add column if not exists total_dwell_seconds    integer not null default 0;
alter table public.investor_links add column if not exists sections_viewed        jsonb   not null default '{}'::jsonb;
alter table public.investor_links add column if not exists engagement_level       text;
alter table public.investor_links add column if not exists engagement_notified_at timestamptz;

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
alter table public.investor_links    enable row level security;
alter table public.page_engagement   enable row level security;
alter table public.engagement_alerts enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.saved_listings    enable row level security;
alter table public.agents            enable row level security;
alter table public.agent_clients     enable row level security;

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

-- investor_links: admins manage; the serverless function uses the service role
-- (bypasses RLS) to validate a token without exposing the table to the public.
drop policy if exists il_admin_all on public.investor_links;
create policy il_admin_all on public.investor_links for all using ( is_admin() ) with check ( is_admin() );

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

-- agents: admins manage all; an agent may read their own row.
drop policy if exists agents_admin_all on public.agents;
drop policy if exists agents_self_read on public.agents;
create policy agents_admin_all on public.agents
  for all using ( is_admin() ) with check ( is_admin() );
create policy agents_self_read on public.agents
  for select to authenticated using ( user_id = auth.uid() );

-- agent_clients: admins manage all; an agent may read their own assignments.
drop policy if exists agent_clients_admin_all on public.agent_clients;
drop policy if exists agent_clients_self_read on public.agent_clients;
create policy agent_clients_admin_all on public.agent_clients
  for all using ( is_admin() ) with check ( is_admin() );
create policy agent_clients_self_read on public.agent_clients
  for select to authenticated using ( agent_user_id = auth.uid() );

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

-- admin-gated RPC: keep it off the anon role (still gates on is_admin() internally).
revoke execute on function public.get_lead_scores() from public, anon;
grant  execute on function public.get_lead_scores() to authenticated;

-- list admins (with email) for the admin Team tab — admin-only
create or replace function public.list_admins()
returns table(id uuid, full_name text, email text, role text, created_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, p.full_name, au.email, p.role, p.created_at
  from public.profiles p
  join auth.users au on au.id = p.id
  where p.role = 'admin' and public.is_admin()
  order by p.created_at asc;
$$;
-- admin-gated RPC: keep it off the anon role (still gates on is_admin() internally).
revoke execute on function public.list_admins() from public, anon;
grant  execute on function public.list_admins() to authenticated;

-- ================================================================
-- 8. MAKE YOURSELF ADMIN  (run once, after you sign up in the app)
-- ================================================================
-- update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@yourdomain.com');

-- ================================================================
-- 9. CONSTRUCTION LOAN PACKAGES  (per-project underwriting module)
--    Admin-gated via is_admin(); powers the "Loan Packages" admin tab.
-- ================================================================

-- keep updated_at fresh on projects
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  name             text not null,
  status           text not null default 'draft',   -- 'draft' | 'active' | 'submitted' | 'closed'
  -- property snapshot
  address          text,
  borrower         text,
  scope            text,
  square_footage   numeric,
  stories          numeric,
  beds_baths       text,
  lot_size         text,
  term_months      integer default 8,
  start_date       date,
  completion_date  date,
  -- deal inputs (the yellow cells)
  purchase_price   numeric not null default 0,
  closing_costs    numeric not null default 0,
  arv_per_sf       numeric not null default 0,
  interest_rate    numeric not null default 0.095,
  points_pct       numeric not null default 0.015,
  admin_fee        numeric not null default 5000,
  contingency_rate numeric not null default 0.05,
  selling_cost_pct numeric not null default 0.03,
  escrow_interest  boolean not null default false,  -- false = borrower pays interest monthly
  -- underwriting thresholds (editable per project)
  rules            jsonb not null default '{
    "max_ltc": 0.85, "max_ltarv": 0.75, "min_contingency": 0.05,
    "min_margin": 0.15, "min_equity": 0.15, "max_cost_per_sf": 250,
    "max_line_share": 0.15, "max_dumpster": 20000
  }'::jsonb,
  notes            text
);
create index if not exists projects_created_idx on public.projects(created_at desc);

drop trigger if exists projects_touch_updated on public.projects;
create trigger projects_touch_updated
  before update on public.projects
  for each row execute function public.touch_updated_at();

create table if not exists public.project_budget_lines (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  division     text,                 -- e.g. '30 — FOUNDATION & STRUCTURE'
  line_item    text,
  amount       numeric not null default 0,
  draw_number  integer,              -- 1..6 (null = unassigned)
  scope_notes  text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists pbl_project_idx on public.project_budget_lines(project_id, sort_order);

alter table public.projects             enable row level security;
alter table public.project_budget_lines enable row level security;

drop policy if exists projects_admin_all on public.projects;
create policy projects_admin_all on public.projects
  for all using ( is_admin() ) with check ( is_admin() );

drop policy if exists pbl_admin_all on public.project_budget_lines;
create policy pbl_admin_all on public.project_budget_lines
  for all using ( is_admin() ) with check ( is_admin() );
