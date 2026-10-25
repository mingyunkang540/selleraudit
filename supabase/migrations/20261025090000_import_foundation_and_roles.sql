begin;

-- Migrate the pilot authorization vocabulary conservatively. Existing members
-- were admitted under the prior model, so they become ACTIVE; future rows start
-- INVITED and must be activated by a later, trusted membership-management flow.
alter table public.workspace_members
  drop constraint workspace_members_role_check;

alter table public.workspace_members
  add column status text,
  add column updated_at timestamptz not null default now();

update public.workspace_members
set role = case role
  when 'OWNER' then 'ADMIN'
  when 'ADMIN' then 'ADMIN'
  when 'MEMBER' then 'VIEWER'
end,
status = 'ACTIVE';

alter table public.workspace_members
  alter column role set default 'VIEWER',
  alter column status set default 'INVITED',
  alter column status set not null,
  add constraint workspace_members_role_check
    check (role in ('ADMIN', 'EDITOR', 'VIEWER')),
  add constraint workspace_members_status_check
    check (status in ('INVITED', 'ACTIVE', 'DISABLED'));

create trigger workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function public.set_updated_at();

-- This helper can answer only whether the current authenticated actor has one
-- of the supplied roles in the target workspace. It cannot inspect another
-- actor's membership and therefore does not create a membership oracle.
create function seller_audit_private.has_active_workspace_role(
  p_workspace_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'ACTIVE'
      and (p_roles is null or wm.role = any (p_roles))
  );
$$;

revoke all on function seller_audit_private.has_active_workspace_role(uuid, text[])
  from public, anon, authenticated;
grant execute on function seller_audit_private.has_active_workspace_role(uuid, text[])
  to authenticated, service_role;

-- Replace legacy membership-exists policies with ACTIVE membership policies.
drop policy workspaces_member_select on public.workspaces;
create policy workspaces_active_member_select
on public.workspaces for select to authenticated
using (seller_audit_private.has_active_workspace_role(id, null));

drop policy workspace_members_self_select on public.workspace_members;
create policy workspace_members_active_self_select
on public.workspace_members for select to authenticated
using (
  user_id = (select auth.uid())
  and status = 'ACTIVE'
);

drop policy products_member_select on public.products;
create policy products_active_member_select
on public.products for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

drop policy skus_member_select on public.skus;
create policy skus_active_member_select
on public.skus for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

drop policy product_components_member_select on public.product_components;
create policy product_components_active_member_select
on public.product_components for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

drop policy channels_member_select on public.channels;
create policy channels_active_member_select
on public.channels for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

drop policy channel_listings_member_select on public.channel_listings;
create policy channel_listings_active_member_select
on public.channel_listings for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

drop policy channel_offers_member_select on public.channel_offers;
create policy channel_offers_active_member_select
on public.channel_offers for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

drop policy aliases_member_select on public.aliases;
create policy aliases_active_member_select
on public.aliases for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

drop policy audit_issues_member_select on public.audit_issues;
create policy audit_issues_active_member_select
on public.audit_issues for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  source_type text not null check (source_type in (
    'MASTER_WORKBOOK',
    'BARCODE_WORKBOOK',
    'CHANNEL_EXPORT',
    'SALES_WORKBOOK',
    'MARKETING_WORKBOOK'
  )),
  source_scope_key text not null check (btrim(source_scope_key) <> ''),
  source_channel text,
  source_filename text not null check (btrim(source_filename) <> ''),
  source_file_hash text not null
    check (source_file_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (btrim(parser_version) <> ''),
  status text not null default 'RECEIVED' check (status in (
    'RECEIVED',
    'VALIDATING',
    'REVIEW_REQUIRED',
    'READY_TO_APPLY',
    'APPLYING',
    'PARTIALLY_APPLIED',
    'APPLIED',
    'FAILED',
    'CANCELLED'
  )),
  validation_revision integer not null default 0 check (validation_revision >= 0),
  row_count integer not null default 0 check (row_count >= 0),
  valid_count integer not null default 0 check (valid_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  deferred_count integer not null default 0 check (deferred_count >= 0),
  applied_count integer not null default 0 check (applied_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  remaining_count integer not null default 0 check (remaining_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  applied_at timestamptz,
  constraint import_batches_workspace_id_id_key unique (workspace_id, id)
);

create table public.raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  import_batch_id uuid not null,
  source_sheet text not null check (btrim(source_sheet) <> ''),
  original_row_number integer not null check (original_row_number > 0),
  source_block text,
  raw_cells jsonb not null check (jsonb_typeof(raw_cells) = 'array'),
  created_at timestamptz not null default now(),
  constraint raw_import_rows_batch_fkey
    foreign key (workspace_id, import_batch_id)
    references public.import_batches(workspace_id, id)
    on delete restrict,
  constraint raw_import_rows_batch_sheet_row_key
    unique (import_batch_id, source_sheet, original_row_number),
  constraint raw_import_rows_workspace_batch_id_key
    unique (workspace_id, import_batch_id, id)
);

create table public.import_validation_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  import_batch_id uuid not null,
  raw_import_row_id uuid,
  related_raw_row_ids uuid[] not null default '{}'::uuid[],
  validation_revision integer not null default 0 check (validation_revision >= 0),
  issue_code text not null check (btrim(issue_code) <> ''),
  severity text not null check (severity in ('INFO', 'WARNING', 'ERROR')),
  blocking_scope text not null check (blocking_scope in ('NONE', 'CANDIDATE', 'BATCH')),
  field_path text,
  observed_value jsonb,
  expected_rule text not null check (btrim(expected_rule) <> ''),
  message text not null check (btrim(message) <> ''),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'RESOLVED', 'ACKNOWLEDGED', 'DEFERRED')),
  resolution text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint import_validation_issues_batch_fkey
    foreign key (workspace_id, import_batch_id)
    references public.import_batches(workspace_id, id)
    on delete restrict,
  constraint import_validation_issues_raw_row_fkey
    foreign key (workspace_id, import_batch_id, raw_import_row_id)
    references public.raw_import_rows(workspace_id, import_batch_id, id)
    on delete restrict
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref uuid not null,
  action_type text not null check (btrim(action_type) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid,
  changed_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(changed_fields) = 'object'),
  correlation_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.import_batches is
  'Metadata and lifecycle counters for one import attempt. No original file binary is stored here.';
comment on column public.import_batches.source_file_hash is
  'Lowercase hexadecimal SHA-256 of the source byte stream; it is indexed for lookup but is not a uniqueness key.';
comment on table public.raw_import_rows is
  'Immutable source-row evidence. Authenticated clients have read-only role-scoped access and no direct write privileges.';
comment on column public.raw_import_rows.raw_cells is
  'Ordered raw cell evidence as a JSON array; source values are not expanded into mutable relational columns.';
comment on table public.import_validation_issues is
  'Import data validation findings before apply; distinct from operational audit_issues.';
comment on column public.import_validation_issues.related_raw_row_ids is
  'Additional evidence row IDs. Array elements are not foreign keys; a future trusted writer must enforce same workspace and batch.';
comment on table public.activity_logs is
  'Immutable human action history; distinct from audit_issues and import_validation_issues.';
comment on column public.activity_logs.changed_fields is
  'Changed fields only. Passwords, auth tokens, service keys, complete raw rows, and file contents must never be stored.';

create index import_batches_workspace_created_idx
  on public.import_batches(workspace_id, created_at desc);
create index import_batches_workspace_status_idx
  on public.import_batches(workspace_id, status);
create index import_batches_source_lookup_idx
  on public.import_batches(
    workspace_id,
    source_type,
    source_scope_key,
    source_file_hash
  );
create index import_batches_created_by_idx
  on public.import_batches(created_by)
  where created_by is not null;

create index import_validation_issues_workspace_batch_idx
  on public.import_validation_issues(workspace_id, import_batch_id);
create index import_validation_issues_workspace_status_idx
  on public.import_validation_issues(workspace_id, status);
create index import_validation_issues_batch_revision_idx
  on public.import_validation_issues(import_batch_id, validation_revision);
create index import_validation_issues_reviewed_by_idx
  on public.import_validation_issues(reviewed_by)
  where reviewed_by is not null;

create index activity_logs_workspace_created_idx
  on public.activity_logs(workspace_id, created_at desc);
create index activity_logs_workspace_action_created_idx
  on public.activity_logs(workspace_id, action_type, created_at desc);
create index activity_logs_actor_user_idx
  on public.activity_logs(actor_user_id)
  where actor_user_id is not null;

alter table public.import_batches enable row level security;
alter table public.raw_import_rows enable row level security;
alter table public.import_validation_issues enable row level security;
alter table public.activity_logs enable row level security;

create policy import_batches_active_member_select
on public.import_batches for select to authenticated
using (seller_audit_private.has_active_workspace_role(workspace_id, null));

create policy raw_import_rows_active_editor_select
on public.raw_import_rows for select to authenticated
using (
  seller_audit_private.has_active_workspace_role(
    workspace_id,
    array['ADMIN', 'EDITOR']::text[]
  )
);

create policy import_validation_issues_active_editor_select
on public.import_validation_issues for select to authenticated
using (
  seller_audit_private.has_active_workspace_role(
    workspace_id,
    array['ADMIN', 'EDITOR']::text[]
  )
);

create policy activity_logs_active_admin_select
on public.activity_logs for select to authenticated
using (
  seller_audit_private.has_active_workspace_role(
    workspace_id,
    array['ADMIN']::text[]
  )
);

revoke all on table
  public.import_batches,
  public.raw_import_rows,
  public.import_validation_issues,
  public.activity_logs
from public, anon, authenticated;

grant select on table
  public.import_batches,
  public.raw_import_rows,
  public.import_validation_issues,
  public.activity_logs
to authenticated;

grant all on table
  public.import_batches,
  public.raw_import_rows,
  public.import_validation_issues,
  public.activity_logs
to service_role;

-- Keep the existing public RPC contract and atomic behavior, but require a
-- currently ACTIVE ADMIN or EDITOR inside the privileged implementation.
create or replace function seller_audit_private.map_offer(
  p_offer_id uuid,
  p_master_product_id uuid
)
returns public.channel_offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace_id uuid;
  v_raw_product_name text;
  v_raw_option_name text;
  v_source_channel text;
  v_offer public.channel_offers%rowtype;
begin
  if v_actor is null then
    raise exception 'Offer is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  select o.workspace_id, l.product_name, o.option_name, c.channel_code
  into v_workspace_id, v_raw_product_name, v_raw_option_name, v_source_channel
  from public.channel_offers o
  join public.channel_listings l
    on l.workspace_id = o.workspace_id and l.id = o.listing_id
  join public.channels c
    on c.workspace_id = l.workspace_id and c.id = l.channel_id
  join public.workspace_members wm
    on wm.workspace_id = o.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role in ('ADMIN', 'EDITOR')
  where o.id = p_offer_id
  for update of o;

  if not found then
    raise exception 'Offer is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  perform 1 from public.products p
  where p.workspace_id = v_workspace_id and p.id = p_master_product_id;
  if not found then
    raise exception 'Master product does not belong to the offer workspace.' using errcode = '23503';
  end if;

  update public.channel_offers
  set master_product_id = p_master_product_id
  where workspace_id = v_workspace_id and id = p_offer_id
  returning * into v_offer;

  insert into public.aliases (
    workspace_id, raw_product_name, raw_option_name, source_channel, master_product_id
  ) values (
    v_workspace_id, v_raw_product_name, v_raw_option_name, v_source_channel, p_master_product_id
  )
  on conflict on constraint aliases_source_unique
  do update set master_product_id = excluded.master_product_id;

  update public.audit_issues
  set status = 'RESOLVED', resolved_at = coalesce(resolved_at, now())
  where workspace_id = v_workspace_id
    and issue_type = 'UNMATCHED'
    and status in ('OPEN', 'IN_PROGRESS')
    and offer_id = p_offer_id;

  return v_offer;
end;
$$;

create or replace function seller_audit_private.update_issue_status(
  p_issue_id uuid,
  p_status text
)
returns public.audit_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace_id uuid;
  v_issue public.audit_issues%rowtype;
begin
  if p_status is null or p_status not in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED') then
    raise exception 'Invalid issue status: %', p_status using errcode = '22023';
  end if;
  if v_actor is null then
    raise exception 'Issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  select i.workspace_id into v_workspace_id
  from public.audit_issues i
  join public.workspace_members wm
    on wm.workspace_id = i.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role in ('ADMIN', 'EDITOR')
  where i.id = p_issue_id
  for update of i;
  if not found then
    raise exception 'Issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;

  update public.audit_issues
  set status = p_status,
      resolved_at = case when p_status = 'RESOLVED' then coalesce(resolved_at, now()) else null end
  where workspace_id = v_workspace_id and id = p_issue_id
  returning * into v_issue;
  return v_issue;
end;
$$;

revoke all on function seller_audit_private.map_offer(uuid, uuid)
  from public, anon, authenticated;
revoke all on function seller_audit_private.update_issue_status(uuid, text)
  from public, anon, authenticated;
grant execute on function seller_audit_private.map_offer(uuid, uuid)
  to authenticated, service_role;
grant execute on function seller_audit_private.update_issue_status(uuid, text)
  to authenticated, service_role;

commit;
