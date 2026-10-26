begin;

-- Private source files are registered by a trusted RPC. Browser roles can only
-- read their own workspace's metadata and upload to the exact registered path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seller-audit-import-sources', 'seller-audit-import-sources', false,
  52428800,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.import_source_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
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
  created_by uuid not null references auth.users(id) on delete restrict,
  verified_by uuid references auth.users(id) on delete set null,
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
  on public.import_source_files(workspace_id, created_at desc);
alter table public.import_source_files enable row level security;
create policy import_source_files_active_editor_select
on public.import_source_files for select to authenticated
using (seller_audit_private.has_active_workspace_role(
  workspace_id, array['ADMIN', 'EDITOR']::text[]
));
revoke all on table public.import_source_files from public, anon, authenticated;
grant select on table public.import_source_files to authenticated;
grant all on table public.import_source_files to service_role;

-- The policy admits only an initial upload by the registering actor. There is
-- deliberately no SELECT, UPDATE, or DELETE policy for browser Storage access.
create policy seller_audit_import_source_registered_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'seller-audit-import-sources'
  and exists (
    select 1 from public.import_source_files s
    where s.storage_bucket = bucket_id
      and s.storage_object_path = name
      and s.verification_status = 'PENDING_UPLOAD'
      and s.created_by = (select auth.uid())
      and seller_audit_private.has_active_workspace_role(
        s.workspace_id, array['ADMIN', 'EDITOR']::text[]
      )
  )
);

create function public.register_master_import_source(
  p_workspace_id uuid,
  p_original_filename text,
  p_client_observed_byte_size bigint,
  p_client_observed_sha256 text
)
returns table (source_file_id uuid, bucket text, object_path text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source_id uuid := gen_random_uuid();
begin
  if v_actor is null or not seller_audit_private.has_active_workspace_role(
    p_workspace_id, array['ADMIN', 'EDITOR']::text[]
  ) then
    raise exception 'Workspace is not accessible.' using errcode = '42501';
  end if;
  if p_original_filename is null or length(p_original_filename) not between 1 and 255
     or p_original_filename !~* '\.xlsx$'
     or p_original_filename ~ '[[:cntrl:]/\\]' then
    raise exception 'Invalid source filename.' using errcode = '22023';
  end if;
  if p_client_observed_byte_size is null or p_client_observed_byte_size not between 1 and 52428800
     or p_client_observed_sha256 is null
     or p_client_observed_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid source size or SHA-256.' using errcode = '22023';
  end if;
  insert into public.import_source_files (
    id, workspace_id, original_filename, storage_object_path,
    client_observed_byte_size, client_observed_sha256, created_by
  ) values (
    v_source_id, p_workspace_id, p_original_filename,
    p_workspace_id::text || '/' || v_source_id::text || '/source.xlsx',
    p_client_observed_byte_size, p_client_observed_sha256, v_actor
  );
  return query select v_source_id, 'seller-audit-import-sources'::text,
    p_workspace_id::text || '/' || v_source_id::text || '/source.xlsx';
end;
$$;
revoke all on function public.register_master_import_source(uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.register_master_import_source(uuid, text, bigint, text)
  to authenticated;

-- Only the Edge Function's service-role client can finalize. The actor is
-- independently checked against current DB membership inside this transaction.
create function public.finalize_master_import_source_verification(
  p_source_file_id uuid,
  p_actor_user_id uuid,
  p_server_verified_byte_size bigint,
  p_server_verified_sha256 text,
  p_storage_object_id uuid,
  p_error_code text default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_source public.import_source_files%rowtype;
  v_actor_ref uuid;
  v_status text;
begin
  select * into v_source from public.import_source_files
  where id = p_source_file_id for update;
  if not found then
    raise exception 'Source file does not exist.' using errcode = 'P0002';
  end if;
  select actor_ref into v_actor_ref from public.workspace_members
  where workspace_id = v_source.workspace_id and user_id = p_actor_user_id
    and status = 'ACTIVE' and role in ('ADMIN', 'EDITOR') for update;
  if not found then
    raise exception 'Actor is not authorized.' using errcode = '42501';
  end if;
  if v_source.verification_status = 'VERIFIED' then
    return 'VERIFIED';
  end if;
  if v_source.verification_status = 'HASH_MISMATCH' then
    raise exception 'Hash mismatch requires a new source file.' using errcode = '55000';
  end if;
  if p_error_code is not null then
    if p_error_code not in ('OBJECT_MISSING', 'DOWNLOAD_FAILED', 'INVALID_OBJECT', 'SIZE_MISMATCH') then
      raise exception 'Invalid verification error code.' using errcode = '22023';
    end if;
    v_status := 'VERIFICATION_FAILED';
  elsif p_server_verified_byte_size is null or p_server_verified_byte_size not between 1 and 52428800
     or p_server_verified_sha256 is null or p_server_verified_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid server verification values.' using errcode = '22023';
  elsif p_server_verified_byte_size <> v_source.client_observed_byte_size then
    v_status := 'VERIFICATION_FAILED';
    p_error_code := 'SIZE_MISMATCH';
  elsif p_server_verified_sha256 <> v_source.client_observed_sha256 then
    v_status := 'HASH_MISMATCH';
  else
    v_status := 'VERIFIED';
  end if;
  update public.import_source_files set
    server_verified_byte_size = p_server_verified_byte_size,
    server_verified_sha256 = p_server_verified_sha256,
    server_verified_storage_object_id = p_storage_object_id,
    verification_status = v_status,
    verification_error_code = p_error_code,
    verified_by = case when v_status = 'VERIFIED' then p_actor_user_id else null end,
    verified_at = case when v_status = 'VERIFIED' then now() else null end,
    updated_at = now()
  where id = p_source_file_id;
  if v_status = 'VERIFIED' then
    insert into public.activity_logs (
      workspace_id, actor_user_id, actor_ref, action_type, entity_type,
      entity_id, changed_fields, correlation_id
    ) values (
      v_source.workspace_id, p_actor_user_id, v_actor_ref,
      'IMPORT_SOURCE_VERIFIED', 'IMPORT_SOURCE_FILE', p_source_file_id,
      jsonb_build_object('sourceFileId', p_source_file_id,
        'verificationStatus', v_status, 'byteSize', p_server_verified_byte_size,
        'hashAlgorithm', 'SHA-256'), gen_random_uuid()
    );
  end if;
  return v_status;
end;
$$;
revoke all on function public.finalize_master_import_source_verification(
  uuid, uuid, bigint, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.finalize_master_import_source_verification(
  uuid, uuid, bigint, text, uuid, text
) to service_role;

alter table public.import_batches
  add column source_file_id uuid,
  add column source_hash_verification text not null default 'CLIENT_OBSERVED'
    check (source_hash_verification in ('CLIENT_OBSERVED', 'SERVER_VERIFIED')),
  add constraint import_batches_source_file_fkey
    foreign key (workspace_id, source_file_id)
    references public.import_source_files(workspace_id, id) on delete restrict,
  add constraint import_batches_verified_source_check check (
    (source_hash_verification = 'CLIENT_OBSERVED' and source_file_id is null)
    or (source_hash_verification = 'SERVER_VERIFIED' and source_file_id is not null)
  );
create index import_batches_source_file_idx on public.import_batches(source_file_id)
  where source_file_id is not null;

-- Revoke both exposed and private legacy entrypoints from browser actors.
revoke execute on function public.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke execute on function seller_audit_private.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;

create function public.persist_verified_master_import_dry_run(
  p_workspace_id uuid,
  p_source_file_id uuid,
  p_summary jsonb,
  p_raw_rows jsonb,
  p_candidates jsonb,
  p_issues jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_source public.import_source_files%rowtype;
  v_batch_id uuid;
begin
  if auth.uid() is null or not seller_audit_private.has_active_workspace_role(
    p_workspace_id, array['ADMIN', 'EDITOR']::text[]
  ) then
    raise exception 'Workspace is not accessible.' using errcode = '42501';
  end if;
  select * into v_source from public.import_source_files
  where id = p_source_file_id and workspace_id = p_workspace_id
    and source_type = 'MASTER_WORKBOOK' for update;
  if not found or v_source.verification_status <> 'VERIFIED'
     or v_source.server_verified_sha256 is null
     or v_source.server_verified_byte_size is null then
    raise exception 'A verified source file is required.' using errcode = '55000';
  end if;
  v_batch_id := seller_audit_private.persist_master_import_dry_run(
    p_workspace_id, v_source.original_filename, v_source.server_verified_sha256,
    p_summary, p_raw_rows, p_candidates, p_issues
  );
  update public.import_batches set
    source_file_id = v_source.id, source_hash_verification = 'SERVER_VERIFIED'
  where id = v_batch_id and workspace_id = p_workspace_id;
  if not found then
    raise exception 'Verified batch linkage failed.' using errcode = '23503';
  end if;
  return v_batch_id;
end;
$$;
revoke all on function public.persist_verified_master_import_dry_run(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_verified_master_import_dry_run(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) to authenticated;

-- Review wrappers own the 5F trust check. The 5E private implementations
-- retain their strict ADMIN/revision checks but are no longer client-callable.
revoke execute on function seller_audit_private.review_import_candidate(
  uuid, integer, integer, jsonb, text
) from public, anon, authenticated;
revoke execute on function seller_audit_private.review_import_validation_issue(
  uuid, integer, integer, text, text
) from public, anon, authenticated;

create or replace function public.review_import_candidate(
  p_candidate_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_reviewed_values jsonb,
  p_resolution text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_batch_id uuid;
begin
  select b.id into v_batch_id
  from public.import_candidates c
  join public.import_batches b
    on b.id = c.import_batch_id and b.workspace_id = c.workspace_id
  join public.import_source_files s
    on s.id = b.source_file_id and s.workspace_id = b.workspace_id
  where c.id = p_candidate_id
    and b.source_hash_verification = 'SERVER_VERIFIED'
    and b.source_file_hash = s.server_verified_sha256
    and s.verification_status = 'VERIFIED'
  for update of b, s;
  if not found then
    raise exception 'A server-verified source is required for new review.' using errcode = '55000';
  end if;
  perform seller_audit_private.review_import_candidate(
    p_candidate_id, p_expected_validation_revision, p_expected_review_revision,
    p_reviewed_values, p_resolution
  );
end;
$$;

create or replace function public.review_import_validation_issue(
  p_issue_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_status text,
  p_resolution text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_batch_id uuid;
begin
  select b.id into v_batch_id
  from public.import_validation_issues i
  join public.import_batches b
    on b.id = i.import_batch_id and b.workspace_id = i.workspace_id
  join public.import_source_files s
    on s.id = b.source_file_id and s.workspace_id = b.workspace_id
  where i.id = p_issue_id
    and b.source_hash_verification = 'SERVER_VERIFIED'
    and b.source_file_hash = s.server_verified_sha256
    and s.verification_status = 'VERIFIED'
  for update of b, s;
  if not found then
    raise exception 'A server-verified source is required for new review.' using errcode = '55000';
  end if;
  perform seller_audit_private.review_import_validation_issue(
    p_issue_id, p_expected_validation_revision, p_expected_review_revision,
    p_status, p_resolution
  );
end;
$$;

commit;
