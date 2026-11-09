-- Local table-only baseline adapted from the 6B source migrations.
-- No local authentication, business RPCs, RLS, upload, or Apply is provided.
-- app_users is a foreign-key identity placeholder, not an authentication implementation.
CREATE TABLE seller_audit_local.app_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

create table seller_audit_local.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table seller_audit_local.workspace_members (
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
  user_id uuid not null references seller_audit_local.app_users(id) on delete cascade,
  role text not null default 'MEMBER' constraint workspace_members_role_check check (role in ('OWNER', 'ADMIN', 'MEMBER')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table seller_audit_local.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
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

create table seller_audit_local.skus (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
  sku_code text not null check (btrim(sku_code) <> ''),
  model_name text not null check (btrim(model_name) <> ''),
  color text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skus_workspace_sku_code_key unique (workspace_id, sku_code),
  constraint skus_workspace_id_id_key unique (workspace_id, id)
);

create table seller_audit_local.product_components (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
  product_id uuid not null,
  sku_id uuid not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint product_components_product_fkey
    foreign key (workspace_id, product_id)
    references seller_audit_local.products(workspace_id, id)
    on delete cascade,
  constraint product_components_sku_fkey
    foreign key (workspace_id, sku_id)
    references seller_audit_local.skus(workspace_id, id)
    on delete restrict,
  constraint product_components_workspace_product_sku_key
    unique (workspace_id, product_id, sku_id)
);

create table seller_audit_local.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
  channel_code text not null check (btrim(channel_code) <> ''),
  channel_name text not null check (btrim(channel_name) <> ''),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  created_at timestamptz not null default now(),
  constraint channels_workspace_channel_code_key unique (workspace_id, channel_code),
  constraint channels_workspace_id_id_key unique (workspace_id, id)
);

create table seller_audit_local.channel_listings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
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
    references seller_audit_local.channels(workspace_id, id)
    on delete cascade,
  constraint channel_listings_workspace_channel_product_key
    unique (workspace_id, channel_id, channel_product_id),
  constraint channel_listings_workspace_id_id_key unique (workspace_id, id)
);

create table seller_audit_local.channel_offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
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
    references seller_audit_local.channel_listings(workspace_id, id)
    on delete cascade,
  constraint channel_offers_master_product_fkey
    foreign key (workspace_id, master_product_id)
    references seller_audit_local.products(workspace_id, id)
    on delete restrict,
  constraint channel_offers_workspace_listing_option_key
    unique (workspace_id, listing_id, channel_option_id),
  constraint channel_offers_workspace_listing_id_key
    unique (workspace_id, listing_id, id),
  constraint channel_offers_workspace_id_id_key unique (workspace_id, id)
);

create table seller_audit_local.aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
  raw_product_name text not null,
  raw_option_name text,
  source_channel text,
  master_product_id uuid not null,
  created_at timestamptz not null default now(),
  constraint aliases_master_product_fkey
    foreign key (workspace_id, master_product_id)
    references seller_audit_local.products(workspace_id, id)
    on delete cascade,
  constraint aliases_source_channel_fkey
    foreign key (workspace_id, source_channel)
    references seller_audit_local.channels(workspace_id, channel_code),
  constraint aliases_source_unique
    unique nulls not distinct (workspace_id, raw_product_name, raw_option_name, source_channel)
);

create table seller_audit_local.audit_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete cascade,
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
    references seller_audit_local.products(workspace_id, id)
    on delete cascade,
  constraint audit_issues_listing_fkey
    foreign key (workspace_id, listing_id)
    references seller_audit_local.channel_listings(workspace_id, id)
    on delete cascade,
  constraint audit_issues_offer_listing_fkey
    foreign key (workspace_id, listing_id, offer_id)
    references seller_audit_local.channel_offers(workspace_id, listing_id, id)
    on delete cascade
);

create function seller_audit_local.set_updated_at()
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

create function seller_audit_local.normalize_channel_option_id()
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
before update on seller_audit_local.workspaces
for each row execute function seller_audit_local.set_updated_at();

create trigger products_set_updated_at
before update on seller_audit_local.products
for each row execute function seller_audit_local.set_updated_at();

create trigger skus_set_updated_at
before update on seller_audit_local.skus
for each row execute function seller_audit_local.set_updated_at();

create trigger channel_listings_set_updated_at
before update on seller_audit_local.channel_listings
for each row execute function seller_audit_local.set_updated_at();

create trigger channel_offers_normalize_option_id
before insert or update of channel_option_id on seller_audit_local.channel_offers
for each row execute function seller_audit_local.normalize_channel_option_id();

create trigger channel_offers_set_updated_at
before update on seller_audit_local.channel_offers
for each row execute function seller_audit_local.set_updated_at();

create index workspace_members_user_id_idx
  on seller_audit_local.workspace_members(user_id);

create index product_components_workspace_sku_idx
  on seller_audit_local.product_components(workspace_id, sku_id);

create index channel_offers_workspace_master_product_idx
  on seller_audit_local.channel_offers(workspace_id, master_product_id)
  where master_product_id is not null;

create index aliases_workspace_master_product_idx
  on seller_audit_local.aliases(workspace_id, master_product_id);

create index aliases_workspace_source_channel_idx
  on seller_audit_local.aliases(workspace_id, source_channel)
  where source_channel is not null;

create index audit_issues_workspace_product_idx
  on seller_audit_local.audit_issues(workspace_id, product_id)
  where product_id is not null;

create index audit_issues_workspace_listing_offer_idx
  on seller_audit_local.audit_issues(workspace_id, listing_id, offer_id)
  where listing_id is not null;

create index audit_issues_workspace_status_detected_idx
  on seller_audit_local.audit_issues(workspace_id, status, detected_at desc);

alter table seller_audit_local.channel_listings
  add constraint channel_listings_workspace_channel_id_key unique (workspace_id, channel_id, id);

alter table seller_audit_local.audit_issues add column channel_id uuid;

alter table seller_audit_local.audit_issues
  add constraint audit_issues_channel_fkey foreign key (workspace_id, channel_id)
    references seller_audit_local.channels(workspace_id, id) on delete cascade,
  add constraint audit_issues_channel_listing_fkey foreign key (workspace_id, channel_id, listing_id)
    references seller_audit_local.channel_listings(workspace_id, channel_id, id) on delete cascade;

create index audit_issues_workspace_channel_idx
  on seller_audit_local.audit_issues(workspace_id, channel_id) where channel_id is not null;

alter table seller_audit_local.workspace_members
  drop constraint workspace_members_role_check;

alter table seller_audit_local.workspace_members
  add column status text,
  add column updated_at timestamptz not null default now();

alter table seller_audit_local.workspace_members
  alter column role set default 'VIEWER',
  alter column status set default 'INVITED',
  alter column status set not null,
  add constraint workspace_members_role_check
    check (role in ('ADMIN', 'EDITOR', 'VIEWER')),
  add constraint workspace_members_status_check
    check (status in ('INVITED', 'ACTIVE', 'DISABLED'));

create trigger workspace_members_set_updated_at
before update on seller_audit_local.workspace_members
for each row execute function seller_audit_local.set_updated_at();

create table seller_audit_local.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete restrict,
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
  created_by uuid references seller_audit_local.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  applied_at timestamptz,
  constraint import_batches_workspace_id_id_key unique (workspace_id, id)
);

create table seller_audit_local.raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete restrict,
  import_batch_id uuid not null,
  source_sheet text not null check (btrim(source_sheet) <> ''),
  original_row_number integer not null check (original_row_number > 0),
  source_block text,
  raw_cells jsonb not null check (jsonb_typeof(raw_cells) = 'array'),
  created_at timestamptz not null default now(),
  constraint raw_import_rows_batch_fkey
    foreign key (workspace_id, import_batch_id)
    references seller_audit_local.import_batches(workspace_id, id)
    on delete restrict,
  constraint raw_import_rows_batch_sheet_row_key
    unique (import_batch_id, source_sheet, original_row_number),
  constraint raw_import_rows_workspace_batch_id_key
    unique (workspace_id, import_batch_id, id)
);

create table seller_audit_local.import_validation_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete restrict,
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
  reviewed_by uuid references seller_audit_local.app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint import_validation_issues_batch_fkey
    foreign key (workspace_id, import_batch_id)
    references seller_audit_local.import_batches(workspace_id, id)
    on delete restrict,
  constraint import_validation_issues_raw_row_fkey
    foreign key (workspace_id, import_batch_id, raw_import_row_id)
    references seller_audit_local.raw_import_rows(workspace_id, import_batch_id, id)
    on delete restrict
);

create table seller_audit_local.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete restrict,
  actor_user_id uuid references seller_audit_local.app_users(id) on delete set null,
  actor_ref uuid not null,
  action_type text not null check (btrim(action_type) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid,
  changed_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(changed_fields) = 'object'),
  correlation_id uuid,
  created_at timestamptz not null default now()
);

create index import_batches_workspace_created_idx
  on seller_audit_local.import_batches(workspace_id, created_at desc);

create index import_batches_workspace_status_idx
  on seller_audit_local.import_batches(workspace_id, status);

create index import_batches_source_lookup_idx
  on seller_audit_local.import_batches(
    workspace_id,
    source_type,
    source_scope_key,
    source_file_hash
  );

create index import_batches_created_by_idx
  on seller_audit_local.import_batches(created_by)
  where created_by is not null;

create index import_validation_issues_workspace_batch_idx
  on seller_audit_local.import_validation_issues(workspace_id, import_batch_id);

create index import_validation_issues_workspace_status_idx
  on seller_audit_local.import_validation_issues(workspace_id, status);

create index import_validation_issues_batch_revision_idx
  on seller_audit_local.import_validation_issues(import_batch_id, validation_revision);

create index import_validation_issues_reviewed_by_idx
  on seller_audit_local.import_validation_issues(reviewed_by)
  where reviewed_by is not null;

create index activity_logs_workspace_created_idx
  on seller_audit_local.activity_logs(workspace_id, created_at desc);

create index activity_logs_workspace_action_created_idx
  on seller_audit_local.activity_logs(workspace_id, action_type, created_at desc);

create index activity_logs_actor_user_idx
  on seller_audit_local.activity_logs(actor_user_id)
  where actor_user_id is not null;

alter table seller_audit_local.import_batches
  add column product_candidate_count integer not null default 0
    check (product_candidate_count >= 0),
  add column sku_candidate_count integer not null default 0
    check (sku_candidate_count >= 0),
  add column bom_candidate_count integer not null default 0
    check (bom_candidate_count >= 0);

alter table seller_audit_local.import_validation_issues
  add column source_sheet text,
  add column source_row integer,
  add constraint import_validation_issues_source_location_check check (
    (source_row is null and (source_sheet is null or btrim(source_sheet) <> ''))
    or (source_row > 0 and source_sheet is not null and btrim(source_sheet) <> '')
  );

alter table seller_audit_local.workspace_members
  add column actor_ref uuid not null default gen_random_uuid();

create table seller_audit_local.import_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete restrict,
  import_batch_id uuid not null,
  raw_import_row_id uuid not null,
  supporting_raw_row_ids uuid[] not null default '{}'::uuid[],
  validation_revision integer not null check (validation_revision > 0),
  candidate_ordinal integer not null check (candidate_ordinal > 0),
  kind text not null check (kind in ('PRODUCT', 'SKU', 'BOM_COMPONENT')),
  source_sheet text not null check (btrim(source_sheet) <> ''),
  source_row integer not null check (source_row > 0),
  source_block text,
  source_field_map jsonb not null check (jsonb_typeof(source_field_map) = 'object'),
  normalized_values jsonb not null check (jsonb_typeof(normalized_values) = 'object'),
  candidate_status text not null check (candidate_status in ('VALID', 'WARNING', 'ERROR', 'DEFERRED')),
  issue_codes text[] not null default '{}'::text[],
  reviewed_values jsonb check (reviewed_values is null or jsonb_typeof(reviewed_values) = 'object'),
  review_note text,
  review_revision integer not null default 0 check (review_revision >= 0),
  reviewed_by uuid references seller_audit_local.app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint import_candidates_batch_fkey
    foreign key (workspace_id, import_batch_id)
    references seller_audit_local.import_batches(workspace_id, id)
    on delete restrict,
  constraint import_candidates_raw_row_fkey
    foreign key (workspace_id, import_batch_id, raw_import_row_id)
    references seller_audit_local.raw_import_rows(workspace_id, import_batch_id, id)
    on delete restrict,
  constraint import_candidates_revision_kind_ordinal_key
    unique (workspace_id, import_batch_id, validation_revision, kind, candidate_ordinal),
  constraint import_candidates_review_state_check check (
    (review_revision = 0 and reviewed_values is null and review_note is null
      and reviewed_by is null and reviewed_at is null)
    or
    (review_revision > 0 and reviewed_values is not null
      and review_note is not null and btrim(review_note) <> ''
      and reviewed_at is not null)
  )
);

alter table seller_audit_local.import_validation_issues
  add column review_revision integer not null default 0
    check (review_revision >= 0);

create index import_candidates_workspace_batch_idx
  on seller_audit_local.import_candidates(workspace_id, import_batch_id);

create index import_candidates_batch_revision_kind_idx
  on seller_audit_local.import_candidates(import_batch_id, validation_revision, kind);

create index import_candidates_workspace_status_idx
  on seller_audit_local.import_candidates(workspace_id, candidate_status);

create index import_candidates_reviewed_by_idx
  on seller_audit_local.import_candidates(reviewed_by)
  where reviewed_by is not null;

create function seller_audit_local.preserve_import_candidate_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.import_batch_id is distinct from old.import_batch_id
     or new.raw_import_row_id is distinct from old.raw_import_row_id
     or new.supporting_raw_row_ids is distinct from old.supporting_raw_row_ids
     or new.validation_revision is distinct from old.validation_revision
     or new.candidate_ordinal is distinct from old.candidate_ordinal
     or new.kind is distinct from old.kind
     or new.source_sheet is distinct from old.source_sheet
     or new.source_row is distinct from old.source_row
     or new.source_block is distinct from old.source_block
     or new.source_field_map is distinct from old.source_field_map
     or new.normalized_values is distinct from old.normalized_values
     or new.candidate_status is distinct from old.candidate_status
     or new.issue_codes is distinct from old.issue_codes
     or new.created_at is distinct from old.created_at then
    raise exception 'Import candidate normalized snapshot is immutable.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger import_candidates_preserve_snapshot
before update on seller_audit_local.import_candidates
for each row execute function seller_audit_local.preserve_import_candidate_snapshot();

create index import_candidates_raw_row_fk_idx
  on seller_audit_local.import_candidates(workspace_id, import_batch_id, raw_import_row_id);

create table seller_audit_local.import_source_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references seller_audit_local.workspaces(id) on delete restrict,
  source_type text not null default 'MASTER_WORKBOOK' check (source_type = 'MASTER_WORKBOOK'),
  original_filename text not null check (
    length(original_filename) between 1 and 255
    and original_filename ~* '\.xlsx$'
    and original_filename !~ '[[:cntrl:]/\\]'
  ),
  storage_bucket text not null default 'seller-audit-import-sources'
    check (storage_bucket = 'seller-audit-import-sources'),
  storage_object_path text not null unique,
  content_type text not null default 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    check (content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  client_observed_byte_size bigint not null check (client_observed_byte_size between 1 and 52428800),
  client_observed_sha256 text not null check (client_observed_sha256 ~ '^[0-9a-f]{64}$'),
  server_verified_byte_size bigint check (server_verified_byte_size between 1 and 52428800),
  server_verified_sha256 text check (server_verified_sha256 ~ '^[0-9a-f]{64}$'),
  server_verified_storage_object_id uuid,
  verification_status text not null default 'PENDING_UPLOAD'
    check (verification_status in ('PENDING_UPLOAD', 'VERIFIED', 'HASH_MISMATCH', 'VERIFICATION_FAILED')),
  verification_error_code text,
  created_by uuid not null references seller_audit_local.app_users(id) on delete restrict,
  verified_by uuid references seller_audit_local.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint import_source_files_workspace_id_id_key unique (workspace_id, id),
  constraint import_source_files_verified_fields_check check (
    verification_status <> 'VERIFIED' or (
      server_verified_byte_size = client_observed_byte_size
      and server_verified_sha256 = client_observed_sha256
      and verified_by is not null and verified_at is not null
    )
  )
);

create index import_source_files_workspace_created_idx
  on seller_audit_local.import_source_files(workspace_id, created_at desc);



alter table seller_audit_local.import_batches
  add column source_file_id uuid,
  add column source_hash_verification text not null default 'CLIENT_OBSERVED'
    check (source_hash_verification in ('CLIENT_OBSERVED', 'SERVER_VERIFIED')),
  add constraint import_batches_source_file_fkey
    foreign key (workspace_id, source_file_id)
    references seller_audit_local.import_source_files(workspace_id, id) on delete restrict,
  add constraint import_batches_verified_source_check check (
    (source_hash_verification = 'CLIENT_OBSERVED' and source_file_id is null)
    or (source_hash_verification = 'SERVER_VERIFIED' and source_file_id is not null)
  );

create index import_batches_source_file_idx on seller_audit_local.import_batches(source_file_id)
  where source_file_id is not null;
