begin;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('OWNER', 'ADMIN', 'MEMBER')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sabangnet_code text not null check (btrim(sabangnet_code) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  category text,
  product_type text not null check (product_type in ('SINGLE', 'SET')),
  normal_price numeric(14, 2) check (normal_price is null or normal_price >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_workspace_sabangnet_code_key unique (workspace_id, sabangnet_code),
  constraint products_workspace_id_id_key unique (workspace_id, id)
);

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku_code text not null check (btrim(sku_code) <> ''),
  model_name text not null check (btrim(model_name) <> ''),
  color text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skus_workspace_sku_code_key unique (workspace_id, sku_code),
  constraint skus_workspace_id_id_key unique (workspace_id, id)
);

create table public.product_components (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid not null,
  sku_id uuid not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint product_components_product_fkey
    foreign key (workspace_id, product_id)
    references public.products(workspace_id, id)
    on delete cascade,
  constraint product_components_sku_fkey
    foreign key (workspace_id, sku_id)
    references public.skus(workspace_id, id)
    on delete restrict,
  constraint product_components_workspace_product_sku_key
    unique (workspace_id, product_id, sku_id)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_code text not null check (btrim(channel_code) <> ''),
  channel_name text not null check (btrim(channel_name) <> ''),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  created_at timestamptz not null default now(),
  constraint channels_workspace_channel_code_key unique (workspace_id, channel_code),
  constraint channels_workspace_id_id_key unique (workspace_id, id)
);

create table public.channel_listings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null,
  channel_product_id text not null check (btrim(channel_product_id) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  product_url text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_listings_channel_fkey
    foreign key (workspace_id, channel_id)
    references public.channels(workspace_id, id)
    on delete cascade,
  constraint channel_listings_workspace_channel_product_key
    unique (workspace_id, channel_id, channel_product_id),
  constraint channel_listings_workspace_id_id_key unique (workspace_id, id)
);

create table public.channel_offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  listing_id uuid not null,
  channel_option_id text not null default 'BASE' check (btrim(channel_option_id) <> ''),
  option_name text,
  seller_code text,
  normal_price numeric(14, 2) check (normal_price is null or normal_price >= 0),
  sale_price numeric(14, 2) check (sale_price is null or sale_price >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  master_product_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_offers_listing_fkey
    foreign key (workspace_id, listing_id)
    references public.channel_listings(workspace_id, id)
    on delete cascade,
  constraint channel_offers_master_product_fkey
    foreign key (workspace_id, master_product_id)
    references public.products(workspace_id, id)
    on delete restrict,
  constraint channel_offers_workspace_listing_option_key
    unique (workspace_id, listing_id, channel_option_id),
  constraint channel_offers_workspace_listing_id_key
    unique (workspace_id, listing_id, id),
  constraint channel_offers_workspace_id_id_key unique (workspace_id, id)
);

create table public.aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  raw_product_name text not null,
  raw_option_name text,
  source_channel text,
  master_product_id uuid not null,
  created_at timestamptz not null default now(),
  constraint aliases_master_product_fkey
    foreign key (workspace_id, master_product_id)
    references public.products(workspace_id, id)
    on delete cascade,
  constraint aliases_source_channel_fkey
    foreign key (workspace_id, source_channel)
    references public.channels(workspace_id, channel_code),
  constraint aliases_source_unique
    unique nulls not distinct (workspace_id, raw_product_name, raw_option_name, source_channel)
);

create table public.audit_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  issue_type text not null check (issue_type in (
    'UNMATCHED',
    'PRICE_MISMATCH',
    'MISSING_CHANNEL',
    'INACTIVE_MISMATCH',
    'DUPLICATE',
    'NEW_LISTING',
    'CHANGED_LISTING',
    'MISSING_BOM'
  )),
  severity text not null check (severity in ('INFO', 'WARNING', 'ERROR')),
  product_id uuid,
  listing_id uuid,
  offer_id uuid,
  title text not null check (btrim(title) <> ''),
  description text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint audit_issues_target_check check (
    product_id is not null or listing_id is not null or offer_id is not null
  ),
  constraint audit_issues_offer_requires_listing_check check (
    offer_id is null or listing_id is not null
  ),
  constraint audit_issues_resolved_at_check check (
    (status = 'RESOLVED' and resolved_at is not null)
    or (status <> 'RESOLVED' and resolved_at is null)
  ),
  constraint audit_issues_product_fkey
    foreign key (workspace_id, product_id)
    references public.products(workspace_id, id)
    on delete cascade,
  constraint audit_issues_listing_fkey
    foreign key (workspace_id, listing_id)
    references public.channel_listings(workspace_id, id)
    on delete cascade,
  constraint audit_issues_offer_listing_fkey
    foreign key (workspace_id, listing_id, offer_id)
    references public.channel_offers(workspace_id, listing_id, id)
    on delete cascade
);

create index workspace_members_user_id_idx
  on public.workspace_members(user_id);
create index product_components_workspace_sku_idx
  on public.product_components(workspace_id, sku_id);
create index channel_offers_workspace_master_product_idx
  on public.channel_offers(workspace_id, master_product_id)
  where master_product_id is not null;
create index aliases_workspace_master_product_idx
  on public.aliases(workspace_id, master_product_id);
create index aliases_workspace_source_channel_idx
  on public.aliases(workspace_id, source_channel)
  where source_channel is not null;
create index audit_issues_workspace_product_idx
  on public.audit_issues(workspace_id, product_id)
  where product_id is not null;
create index audit_issues_workspace_listing_offer_idx
  on public.audit_issues(workspace_id, listing_id, offer_id)
  where listing_id is not null;
create index audit_issues_workspace_status_detected_idx
  on public.audit_issues(workspace_id, status, detected_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function public.normalize_channel_option_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.channel_option_id is null or btrim(new.channel_option_id) = '' then
    new.channel_option_id := 'BASE';
  end if;
  return new;
end;
$$;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger skus_set_updated_at
before update on public.skus
for each row execute function public.set_updated_at();

create trigger channel_listings_set_updated_at
before update on public.channel_listings
for each row execute function public.set_updated_at();

create trigger channel_offers_normalize_option_id
before insert or update of channel_option_id on public.channel_offers
for each row execute function public.normalize_channel_option_id();

create trigger channel_offers_set_updated_at
before update on public.channel_offers
for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.products enable row level security;
alter table public.skus enable row level security;
alter table public.product_components enable row level security;
alter table public.channels enable row level security;
alter table public.channel_listings enable row level security;
alter table public.channel_offers enable row level security;
alter table public.aliases enable row level security;
alter table public.audit_issues enable row level security;

create policy workspaces_member_select
on public.workspaces for select to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
  )
);

create policy workspace_members_self_select
on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()));

create policy products_member_select
on public.products for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = products.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy skus_member_select
on public.skus for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = skus.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy product_components_member_select
on public.product_components for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = product_components.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy channels_member_select
on public.channels for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = channels.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy channel_listings_member_select
on public.channel_listings for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = channel_listings.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy channel_offers_member_select
on public.channel_offers for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = channel_offers.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy channel_offers_member_update
on public.channel_offers for update to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = channel_offers.workspace_id
      and wm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = channel_offers.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy aliases_member_select
on public.aliases for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = aliases.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy aliases_member_insert
on public.aliases for insert to authenticated
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = aliases.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy aliases_member_update
on public.aliases for update to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = aliases.workspace_id
      and wm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = aliases.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy audit_issues_member_select
on public.audit_issues for select to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = audit_issues.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy audit_issues_member_update
on public.audit_issues for update to authenticated
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = audit_issues.workspace_id
      and wm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = audit_issues.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create function public.map_offer(
  p_offer_id uuid,
  p_master_product_id uuid
)
returns public.channel_offers
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_raw_product_name text;
  v_raw_option_name text;
  v_source_channel text;
  v_offer public.channel_offers%rowtype;
begin
  select
    o.workspace_id,
    l.product_name,
    o.option_name,
    c.channel_code
  into
    v_workspace_id,
    v_raw_product_name,
    v_raw_option_name,
    v_source_channel
  from public.channel_offers o
  join public.channel_listings l
    on l.workspace_id = o.workspace_id
   and l.id = o.listing_id
  join public.channels c
    on c.workspace_id = l.workspace_id
   and c.id = l.channel_id
  where o.id = p_offer_id
  for update of o;

  if not found then
    raise exception 'Offer is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  perform 1
  from public.products p
  where p.workspace_id = v_workspace_id
    and p.id = p_master_product_id;

  if not found then
    raise exception 'Master product is not accessible or does not belong to the offer workspace.'
      using errcode = '23503';
  end if;

  update public.channel_offers
  set master_product_id = p_master_product_id
  where workspace_id = v_workspace_id
    and id = p_offer_id
  returning * into v_offer;

  insert into public.aliases (
    workspace_id,
    raw_product_name,
    raw_option_name,
    source_channel,
    master_product_id
  )
  values (
    v_workspace_id,
    v_raw_product_name,
    v_raw_option_name,
    v_source_channel,
    p_master_product_id
  )
  on conflict on constraint aliases_source_unique
  do update set master_product_id = excluded.master_product_id;

  update public.audit_issues
  set
    status = 'RESOLVED',
    resolved_at = coalesce(resolved_at, now())
  where workspace_id = v_workspace_id
    and issue_type = 'UNMATCHED'
    and status in ('OPEN', 'IN_PROGRESS')
    and offer_id = p_offer_id;

  return v_offer;
end;
$$;

create function public.update_issue_status(
  p_issue_id uuid,
  p_status text
)
returns public.audit_issues
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_issue public.audit_issues%rowtype;
begin
  if p_status is null or p_status not in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED') then
    raise exception 'Invalid issue status: %', p_status using errcode = '22023';
  end if;

  update public.audit_issues
  set
    status = p_status,
    resolved_at = case
      when p_status = 'RESOLVED' then coalesce(resolved_at, now())
      else null
    end
  where id = p_issue_id
  returning * into v_issue;

  if not found then
    raise exception 'Issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  return v_issue;
end;
$$;

revoke all on table
  public.workspaces,
  public.workspace_members,
  public.products,
  public.skus,
  public.product_components,
  public.channels,
  public.channel_listings,
  public.channel_offers,
  public.aliases,
  public.audit_issues
from public, anon, authenticated;

grant usage on schema public to authenticated, service_role;

grant select on table
  public.workspaces,
  public.workspace_members,
  public.products,
  public.skus,
  public.product_components,
  public.channels,
  public.channel_listings,
  public.channel_offers,
  public.aliases,
  public.audit_issues
to authenticated;

grant update (master_product_id) on public.channel_offers to authenticated;
grant insert (
  workspace_id,
  raw_product_name,
  raw_option_name,
  source_channel,
  master_product_id
) on public.aliases to authenticated;
grant update (master_product_id) on public.aliases to authenticated;
grant update (status, resolved_at) on public.audit_issues to authenticated;

grant all on table
  public.workspaces,
  public.workspace_members,
  public.products,
  public.skus,
  public.product_components,
  public.channels,
  public.channel_listings,
  public.channel_offers,
  public.aliases,
  public.audit_issues
to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.normalize_channel_option_id() from public, anon, authenticated;
revoke all on function public.map_offer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_issue_status(uuid, text) from public, anon, authenticated;

grant execute on function public.map_offer(uuid, uuid) to authenticated;
grant execute on function public.update_issue_status(uuid, text) to authenticated;
grant execute on function public.map_offer(uuid, uuid) to service_role;
grant execute on function public.update_issue_status(uuid, text) to service_role;

commit;
