begin;

create table public.import_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
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
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint import_candidates_batch_fkey
    foreign key (workspace_id, import_batch_id)
    references public.import_batches(workspace_id, id)
    on delete restrict,
  constraint import_candidates_raw_row_fkey
    foreign key (workspace_id, import_batch_id, raw_import_row_id)
    references public.raw_import_rows(workspace_id, import_batch_id, id)
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

alter table public.import_validation_issues
  add column review_revision integer not null default 0
    check (review_revision >= 0);

comment on table public.import_candidates is
  'Immutable normalized Product, SKU, and BOM candidate snapshots for one validation revision. Human overrides are stored separately and never apply master data.';
comment on column public.import_candidates.normalized_values is
  'Immutable parser output for this validation revision; human corrections belong in reviewed_values.';
comment on column public.import_candidates.source_sheet is
  'Immutable client-observed source sheet, verified against raw_import_row_id by the trusted persistence RPC.';
comment on column public.import_candidates.source_row is
  'Immutable positive source row, verified against raw_import_row_id by the trusted persistence RPC.';
comment on column public.import_candidates.reviewed_values is
  'ADMIN-authored field allowlist overrides. These values do not change candidate_status or Product/SKU/BOM master data.';
comment on column public.import_candidates.review_note is
  'Required human review evidence note; excluded from activity log payloads.';
comment on column public.import_validation_issues.review_revision is
  'Optimistic concurrency revision for trusted human issue review.';

create index import_candidates_workspace_batch_idx
  on public.import_candidates(workspace_id, import_batch_id);
create index import_candidates_batch_revision_kind_idx
  on public.import_candidates(import_batch_id, validation_revision, kind);
create index import_candidates_workspace_status_idx
  on public.import_candidates(workspace_id, candidate_status);
create index import_candidates_reviewed_by_idx
  on public.import_candidates(reviewed_by)
  where reviewed_by is not null;

alter table public.import_candidates enable row level security;

create policy import_candidates_active_editor_select
on public.import_candidates for select to authenticated
using (
  seller_audit_private.has_active_workspace_role(
    workspace_id,
    array['ADMIN', 'EDITOR']::text[]
  )
);

revoke all on table public.import_candidates from public, anon, authenticated;
grant select on table public.import_candidates to authenticated;
grant all on table public.import_candidates to service_role;

create function seller_audit_private.preserve_import_candidate_snapshot()
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

revoke all on function seller_audit_private.preserve_import_candidate_snapshot()
  from public, anon, authenticated;
grant execute on function seller_audit_private.preserve_import_candidate_snapshot()
  to service_role;

create trigger import_candidates_preserve_snapshot
before update on public.import_candidates
for each row execute function seller_audit_private.preserve_import_candidate_snapshot();

-- The 5C six-argument route remains present for historical database
-- compatibility, but browser actors may no longer create snapshot-less batches.
revoke execute on function public.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb
) from authenticated;
revoke execute on function seller_audit_private.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb
) from authenticated;

create function seller_audit_private.persist_master_import_dry_run(
  p_workspace_id uuid,
  p_source_filename text,
  p_source_file_hash text,
  p_summary jsonb,
  p_raw_rows jsonb,
  p_candidates jsonb,
  p_issues jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_candidate jsonb;
  v_supporting_row jsonb;
  v_raw_row_id uuid;
  v_supporting_raw_row_id uuid;
  v_supporting_raw_row_ids uuid[];
  v_source_sheet text;
  v_source_row integer;
  v_kind text;
  v_status text;
  v_normalized jsonb;
  v_product_count integer;
  v_sku_count integer;
  v_bom_count integer;
  v_valid_count integer;
  v_warning_count integer;
  v_error_count integer;
  v_deferred_count integer;
begin
  if jsonb_typeof(p_candidates) is distinct from 'array' then
    raise exception 'Candidates must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_summary) is distinct from 'object' then
    raise exception 'Summary must be a JSON object.' using errcode = '22023';
  end if;

  select
    count(*) filter (where value->>'kind' = 'PRODUCT'),
    count(*) filter (where value->>'kind' = 'SKU'),
    count(*) filter (where value->>'kind' = 'BOM_COMPONENT'),
    count(*) filter (where value->>'status' = 'VALID'),
    count(*) filter (where value->>'status' = 'WARNING'),
    count(*) filter (where value->>'status' = 'ERROR'),
    count(*) filter (where value->>'status' = 'DEFERRED')
  into
    v_product_count, v_sku_count, v_bom_count,
    v_valid_count, v_warning_count, v_error_count, v_deferred_count
  from jsonb_array_elements(p_candidates);

  if not (
    p_summary ?& array[
      'productCount', 'skuCount', 'bomCount', 'validCount',
      'warningCount', 'errorCount', 'deferredCount'
    ]
    and (p_summary->>'productCount') ~ '^\d+$'
    and (p_summary->>'skuCount') ~ '^\d+$'
    and (p_summary->>'bomCount') ~ '^\d+$'
    and (p_summary->>'validCount') ~ '^\d+$'
    and (p_summary->>'warningCount') ~ '^\d+$'
    and (p_summary->>'errorCount') ~ '^\d+$'
    and (p_summary->>'deferredCount') ~ '^\d+$'
  ) then
    raise exception 'Summary counts must be nonnegative integers.' using errcode = '22023';
  end if;

  if v_product_count <> (p_summary->>'productCount')::integer
     or v_sku_count <> (p_summary->>'skuCount')::integer
     or v_bom_count <> (p_summary->>'bomCount')::integer
     or v_valid_count <> (p_summary->>'validCount')::integer
     or v_warning_count <> (p_summary->>'warningCount')::integer
     or v_error_count <> (p_summary->>'errorCount')::integer
     or v_deferred_count <> (p_summary->>'deferredCount')::integer then
    raise exception 'Candidate snapshot counts do not match the import summary.'
      using errcode = '22023';
  end if;

  -- Validate every candidate before creating any durable record. The outer RPC
  -- transaction remains atomic even if a later provenance lookup fails.
  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if jsonb_typeof(v_candidate) <> 'object'
       or not (v_candidate ?& array[
         'kind', 'candidateOrdinal', 'sourceSheet', 'sourceRow', 'sourceBlock',
         'sourceFieldMap', 'status', 'issueCodes', 'normalizedValues', 'supportingRows'
       ])
       or coalesce(v_candidate->>'kind', '') not in ('PRODUCT', 'SKU', 'BOM_COMPONENT')
       or jsonb_typeof(v_candidate->'candidateOrdinal') <> 'number'
       or coalesce(v_candidate->>'candidateOrdinal', '') !~ '^\d+$'
       or (v_candidate->>'candidateOrdinal')::numeric < 1
       or coalesce(btrim(v_candidate->>'sourceSheet'), '') = ''
       or jsonb_typeof(v_candidate->'sourceRow') <> 'number'
       or coalesce(v_candidate->>'sourceRow', '') !~ '^\d+$'
       or (v_candidate->>'sourceRow')::numeric < 1
       or jsonb_typeof(v_candidate->'sourceBlock') not in ('string', 'null')
       or jsonb_typeof(v_candidate->'sourceFieldMap') <> 'object'
       or jsonb_typeof(v_candidate->'normalizedValues') <> 'object'
       or coalesce(v_candidate->>'status', '') not in ('VALID', 'WARNING', 'ERROR', 'DEFERRED')
       or jsonb_typeof(v_candidate->'issueCodes') <> 'array'
       or jsonb_typeof(v_candidate->'supportingRows') <> 'array'
       or exists (
         select 1 from jsonb_each(v_candidate->'sourceFieldMap') f
         where jsonb_typeof(f.value) <> 'string'
       )
       or exists (
         select 1 from jsonb_array_elements(v_candidate->'issueCodes') code
         where jsonb_typeof(code) <> 'string' or btrim(code #>> '{}') = ''
       ) then
      raise exception 'Invalid candidate payload.' using errcode = '22023';
    end if;

    v_kind := v_candidate->>'kind';
    v_normalized := v_candidate->'normalizedValues';

    if v_kind = 'PRODUCT' and (
      not (v_normalized ?& array[
        'sabangnetCode', 'productName', 'category', 'productType', 'rawBomText',
        'sourceQuantity', 'sourceChannel', 'variantOfSourceRow'
      ])
      or exists (
        select 1 from jsonb_object_keys(v_normalized) k
        where k not in (
          'sabangnetCode', 'productName', 'category', 'productType', 'rawBomText',
          'sourceQuantity', 'sourceChannel', 'variantOfSourceRow'
        )
      )
      or jsonb_typeof(v_normalized->'sabangnetCode') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'productName') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'category') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'productType') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'rawBomText') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'sourceQuantity') not in ('number', 'null')
      or jsonb_typeof(v_normalized->'sourceChannel') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'variantOfSourceRow') not in ('number', 'null')
      or (jsonb_typeof(v_normalized->'variantOfSourceRow') = 'number' and (
        coalesce(v_normalized->>'variantOfSourceRow', '') !~ '^\d+$'
        or (v_normalized->>'variantOfSourceRow')::numeric < 1
      ))
    ) then
      raise exception 'Invalid PRODUCT normalizedValues.' using errcode = '22023';
    end if;

    if v_kind = 'SKU' and (
      not (v_normalized ?& array['skuCode', 'modelName', 'color', 'sourceCategory', 'registryStatus'])
      or exists (
        select 1 from jsonb_object_keys(v_normalized) k
        where k not in ('skuCode', 'modelName', 'color', 'sourceCategory', 'registryStatus')
      )
      or jsonb_typeof(v_normalized->'skuCode') <> 'string'
      or btrim(v_normalized->>'skuCode') = ''
      or jsonb_typeof(v_normalized->'modelName') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'color') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'sourceCategory') not in ('string', 'null')
      or coalesce(v_normalized->>'registryStatus', '') not in (
        'BOM_REGISTRY', 'DEFERRED_SOURCE_BLOCK', 'DEFERRED_INTERMEDIATE_BUNDLE'
      )
    ) then
      raise exception 'Invalid SKU normalizedValues.' using errcode = '22023';
    end if;

    if v_kind = 'BOM_COMPONENT' and (
      not (v_normalized ?& array[
        'productCode', 'productSourceRow', 'skuCode', 'quantity', 'rawToken'
      ])
      or exists (
        select 1 from jsonb_object_keys(v_normalized) k
        where k not in ('productCode', 'productSourceRow', 'skuCode', 'quantity', 'rawToken')
      )
      or jsonb_typeof(v_normalized->'productCode') not in ('string', 'null')
      or jsonb_typeof(v_normalized->'productSourceRow') <> 'number'
      or coalesce(v_normalized->>'productSourceRow', '') !~ '^\d+$'
      or (v_normalized->>'productSourceRow')::numeric < 1
      or jsonb_typeof(v_normalized->'skuCode') <> 'string'
      or btrim(v_normalized->>'skuCode') = ''
      or jsonb_typeof(v_normalized->'quantity') <> 'number'
      or (v_normalized->>'quantity')::numeric <= 0
      or jsonb_typeof(v_normalized->'rawToken') <> 'string'
    ) then
      raise exception 'Invalid BOM_COMPONENT normalizedValues.' using errcode = '22023';
    end if;

    if exists (
      select 1 from jsonb_array_elements(v_candidate->'supportingRows') supporting
      where jsonb_typeof(supporting) <> 'number'
         or coalesce(supporting #>> '{}', '') !~ '^\d+$'
         or (supporting #>> '{}')::numeric < 1
    ) then
      raise exception 'Invalid supporting row reference.' using errcode = '22023';
    end if;
  end loop;

  v_batch_id := seller_audit_private.persist_master_import_dry_run(
    p_workspace_id,
    p_source_filename,
    p_source_file_hash,
    p_summary,
    p_raw_rows,
    p_issues
  );

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    v_source_sheet := v_candidate->>'sourceSheet';
    v_source_row := (v_candidate->>'sourceRow')::integer;
    v_kind := v_candidate->>'kind';
    v_status := v_candidate->>'status';

    select r.id into v_raw_row_id
    from public.raw_import_rows r
    where r.workspace_id = p_workspace_id
      and r.import_batch_id = v_batch_id
      and r.source_sheet = v_source_sheet
      and r.original_row_number = v_source_row;

    if not found then
      raise exception 'Candidate source row is missing from this import batch.' using errcode = '23503';
    end if;

    v_supporting_raw_row_ids := '{}'::uuid[];
    for v_supporting_row in
      select value from jsonb_array_elements(v_candidate->'supportingRows')
    loop
      if (v_supporting_row #>> '{}')::integer = v_source_row then
        raise exception 'Supporting row must differ from the candidate source row.' using errcode = '22023';
      end if;

      select r.id into v_supporting_raw_row_id
      from public.raw_import_rows r
      where r.workspace_id = p_workspace_id
        and r.import_batch_id = v_batch_id
        and r.source_sheet = v_source_sheet
        and r.original_row_number = (v_supporting_row #>> '{}')::integer;

      if not found then
        raise exception 'Candidate supporting row is missing from this import batch.' using errcode = '23503';
      end if;
      if v_supporting_raw_row_id = any(v_supporting_raw_row_ids) then
        raise exception 'Candidate supporting rows must be unique.' using errcode = '22023';
      end if;
      v_supporting_raw_row_ids := array_append(v_supporting_raw_row_ids, v_supporting_raw_row_id);
    end loop;

    insert into public.import_candidates (
      workspace_id,
      import_batch_id,
      raw_import_row_id,
      supporting_raw_row_ids,
      validation_revision,
      candidate_ordinal,
      kind,
      source_sheet,
      source_row,
      source_block,
      source_field_map,
      normalized_values,
      candidate_status,
      issue_codes
    ) values (
      p_workspace_id,
      v_batch_id,
      v_raw_row_id,
      v_supporting_raw_row_ids,
      1,
      (v_candidate->>'candidateOrdinal')::integer,
      v_kind,
      v_source_sheet,
      v_source_row,
      v_candidate->>'sourceBlock',
      v_candidate->'sourceFieldMap',
      v_candidate->'normalizedValues',
      v_status,
      array(select value #>> '{}' from jsonb_array_elements(v_candidate->'issueCodes'))
    );
  end loop;

  return v_batch_id;
end;
$$;

revoke all on function seller_audit_private.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function seller_audit_private.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated, service_role;

create function public.persist_master_import_dry_run(
  p_workspace_id uuid,
  p_source_filename text,
  p_source_file_hash text,
  p_summary jsonb,
  p_raw_rows jsonb,
  p_candidates jsonb,
  p_issues jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select seller_audit_private.persist_master_import_dry_run(
    p_workspace_id,
    p_source_filename,
    p_source_file_hash,
    p_summary,
    p_raw_rows,
    p_candidates,
    p_issues
  );
$$;

revoke all on function public.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_master_import_dry_run(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated, service_role;

create function seller_audit_private.review_import_candidate(
  p_candidate_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_reviewed_values jsonb,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_ref uuid;
  v_candidate_id uuid;
  v_candidate_workspace_id uuid;
  v_candidate_kind text;
  v_candidate_validation_revision integer;
  v_candidate_review_revision integer;
  v_batch_status text;
  v_batch_validation_revision integer;
  v_review_note text := nullif(btrim(p_resolution), '');
  v_reviewed_field_names jsonb;
begin
  if v_actor is null then
    raise exception 'Candidate is not accessible or does not exist.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_reviewed_values) is distinct from 'object' then
    raise exception 'Reviewed values must be a JSON object.' using errcode = '22023';
  end if;
  if p_expected_validation_revision is null or p_expected_validation_revision < 1
     or p_expected_review_revision is null or p_expected_review_revision < 0 then
    raise exception 'Expected revisions are invalid.' using errcode = '22023';
  end if;
  if p_reviewed_values = '{}'::jsonb and v_review_note is null then
    raise exception 'An empty candidate review is not allowed.' using errcode = '22023';
  end if;
  if p_reviewed_values <> '{}'::jsonb and v_review_note is null then
    raise exception 'Candidate review resolution is required.' using errcode = '22023';
  end if;

  select c.id, c.workspace_id, c.kind, c.validation_revision, c.review_revision,
         b.status, b.validation_revision, wm.actor_ref
  into v_candidate_id, v_candidate_workspace_id, v_candidate_kind,
       v_candidate_validation_revision, v_candidate_review_revision,
       v_batch_status, v_batch_validation_revision, v_actor_ref
  from public.import_candidates c
  join public.import_batches b
    on b.workspace_id = c.workspace_id and b.id = c.import_batch_id
  join public.workspace_members wm
    on wm.workspace_id = c.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role = 'ADMIN'
  where c.id = p_candidate_id
  for update of c;

  if not found then
    raise exception 'Candidate is not accessible or does not exist.' using errcode = 'P0002';
  end if;
  if v_batch_status <> 'REVIEW_REQUIRED' then
    raise exception 'Candidate batch is not reviewable.' using errcode = '55000';
  end if;
  if v_candidate_validation_revision <> v_batch_validation_revision
     or v_candidate_validation_revision <> p_expected_validation_revision then
    raise exception 'Candidate validation revision is stale.' using errcode = '40001';
  end if;
  if v_candidate_review_revision <> p_expected_review_revision then
    raise exception 'Candidate review revision is stale.' using errcode = '40001';
  end if;

  if v_candidate_kind = 'PRODUCT' then
    if exists (
      select 1 from jsonb_object_keys(p_reviewed_values) k
      where k not in (
        'sabangnetCode', 'productName', 'category', 'productType', 'rawBomText',
        'sourceQuantity', 'sourceChannel'
      )
    )
    or jsonb_typeof(p_reviewed_values->'sabangnetCode') not in ('string', 'null')
       and p_reviewed_values ? 'sabangnetCode'
    or jsonb_typeof(p_reviewed_values->'productName') not in ('string', 'null')
       and p_reviewed_values ? 'productName'
    or jsonb_typeof(p_reviewed_values->'category') not in ('string', 'null')
       and p_reviewed_values ? 'category'
    or jsonb_typeof(p_reviewed_values->'productType') not in ('string', 'null')
       and p_reviewed_values ? 'productType'
    or jsonb_typeof(p_reviewed_values->'rawBomText') not in ('string', 'null')
       and p_reviewed_values ? 'rawBomText'
    or jsonb_typeof(p_reviewed_values->'sourceQuantity') not in ('number', 'null')
       and p_reviewed_values ? 'sourceQuantity'
    or jsonb_typeof(p_reviewed_values->'sourceChannel') not in ('string', 'null')
       and p_reviewed_values ? 'sourceChannel' then
      raise exception 'PRODUCT reviewed values contain an unknown field or invalid type.' using errcode = '22023';
    end if;
  elsif v_candidate_kind = 'SKU' then
    if exists (
      select 1 from jsonb_object_keys(p_reviewed_values) k
      where k not in ('skuCode', 'modelName', 'color', 'sourceCategory')
    )
    or (p_reviewed_values ? 'skuCode' and (
      jsonb_typeof(p_reviewed_values->'skuCode') <> 'string'
      or btrim(p_reviewed_values->>'skuCode') = ''
    ))
    or (p_reviewed_values ? 'modelName'
      and jsonb_typeof(p_reviewed_values->'modelName') not in ('string', 'null'))
    or (p_reviewed_values ? 'color'
      and jsonb_typeof(p_reviewed_values->'color') not in ('string', 'null'))
    or (p_reviewed_values ? 'sourceCategory'
      and jsonb_typeof(p_reviewed_values->'sourceCategory') not in ('string', 'null')) then
      raise exception 'SKU reviewed values contain an unknown field or invalid type.' using errcode = '22023';
    end if;
  else
    if exists (
      select 1 from jsonb_object_keys(p_reviewed_values) k
      where k not in ('skuCode', 'quantity')
    )
    or (p_reviewed_values ? 'skuCode' and (
      jsonb_typeof(p_reviewed_values->'skuCode') <> 'string'
      or btrim(p_reviewed_values->>'skuCode') = ''
    ))
    or (p_reviewed_values ? 'quantity' and (
      jsonb_typeof(p_reviewed_values->'quantity') <> 'number'
      or (p_reviewed_values->>'quantity')::numeric <= 0
    )) then
      raise exception 'BOM_COMPONENT reviewed values contain an unknown field or invalid type.' using errcode = '22023';
    end if;
  end if;

  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  into v_reviewed_field_names
  from jsonb_object_keys(p_reviewed_values) k;

  update public.import_candidates
  set reviewed_values = p_reviewed_values,
      review_note = v_review_note,
      review_revision = review_revision + 1,
      reviewed_by = v_actor,
      reviewed_at = now()
  where id = v_candidate_id;

  insert into public.activity_logs (
    workspace_id, actor_user_id, actor_ref, action_type, entity_type,
    entity_id, changed_fields, correlation_id
  ) values (
    v_candidate_workspace_id,
    v_actor,
    v_actor_ref,
    'IMPORT_REVIEWED',
    'IMPORT_CANDIDATE',
    v_candidate_id,
    jsonb_build_object(
      'validationRevision', v_candidate_validation_revision,
      'reviewRevision', v_candidate_review_revision + 1,
      'candidateKind', v_candidate_kind,
      'reviewedFieldNames', v_reviewed_field_names
    ),
    gen_random_uuid()
  );
end;
$$;

create function public.review_import_candidate(
  p_candidate_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_reviewed_values jsonb,
  p_resolution text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select seller_audit_private.review_import_candidate(
    p_candidate_id,
    p_expected_validation_revision,
    p_expected_review_revision,
    p_reviewed_values,
    p_resolution
  );
$$;

create function seller_audit_private.review_import_validation_issue(
  p_issue_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_status text,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_ref uuid;
  v_issue_id uuid;
  v_issue_workspace_id uuid;
  v_issue_code text;
  v_issue_status text;
  v_issue_validation_revision integer;
  v_issue_review_revision integer;
  v_batch_status text;
  v_batch_validation_revision integer;
  v_resolution text := nullif(btrim(p_resolution), '');
begin
  if v_actor is null then
    raise exception 'Validation issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('OPEN', 'RESOLVED', 'ACKNOWLEDGED', 'DEFERRED') then
    raise exception 'Invalid validation issue status.' using errcode = '22023';
  end if;
  if p_expected_validation_revision is null or p_expected_validation_revision < 1
     or p_expected_review_revision is null or p_expected_review_revision < 0 then
    raise exception 'Expected revisions are invalid.' using errcode = '22023';
  end if;
  if p_status <> 'OPEN' and v_resolution is null then
    raise exception 'Issue review resolution is required.' using errcode = '22023';
  end if;
  if p_status = 'OPEN' then
    v_resolution := null;
  end if;

  select i.id, i.workspace_id, i.issue_code, i.status,
         i.validation_revision, i.review_revision,
         b.status, b.validation_revision, wm.actor_ref
  into v_issue_id, v_issue_workspace_id, v_issue_code, v_issue_status,
       v_issue_validation_revision, v_issue_review_revision,
       v_batch_status, v_batch_validation_revision, v_actor_ref
  from public.import_validation_issues i
  join public.import_batches b
    on b.workspace_id = i.workspace_id and b.id = i.import_batch_id
  join public.workspace_members wm
    on wm.workspace_id = i.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role = 'ADMIN'
  where i.id = p_issue_id
  for update of i;

  if not found then
    raise exception 'Validation issue is not accessible or does not exist.' using errcode = 'P0002';
  end if;
  if v_batch_status <> 'REVIEW_REQUIRED' then
    raise exception 'Validation issue batch is not reviewable.' using errcode = '55000';
  end if;
  if v_issue_validation_revision <> v_batch_validation_revision
     or v_issue_validation_revision <> p_expected_validation_revision then
    raise exception 'Validation issue revision is stale.' using errcode = '40001';
  end if;
  if v_issue_review_revision <> p_expected_review_revision then
    raise exception 'Validation issue review revision is stale.' using errcode = '40001';
  end if;

  update public.import_validation_issues
  set status = p_status,
      resolution = v_resolution,
      review_revision = review_revision + 1,
      reviewed_by = v_actor,
      reviewed_at = now()
  where id = v_issue_id;

  insert into public.activity_logs (
    workspace_id, actor_user_id, actor_ref, action_type, entity_type,
    entity_id, changed_fields, correlation_id
  ) values (
    v_issue_workspace_id,
    v_actor,
    v_actor_ref,
    'IMPORT_REVIEWED',
    'IMPORT_VALIDATION_ISSUE',
    v_issue_id,
    jsonb_build_object(
      'validationRevision', v_issue_validation_revision,
      'reviewRevision', v_issue_review_revision + 1,
      'issueCode', v_issue_code,
      'statusFrom', v_issue_status,
      'statusTo', p_status
    ),
    gen_random_uuid()
  );
end;
$$;

create function public.review_import_validation_issue(
  p_issue_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_status text,
  p_resolution text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select seller_audit_private.review_import_validation_issue(
    p_issue_id,
    p_expected_validation_revision,
    p_expected_review_revision,
    p_status,
    p_resolution
  );
$$;

revoke all on function seller_audit_private.review_import_candidate(
  uuid, integer, integer, jsonb, text
) from public, anon, authenticated;
revoke all on function seller_audit_private.review_import_validation_issue(
  uuid, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function seller_audit_private.review_import_candidate(
  uuid, integer, integer, jsonb, text
) to authenticated, service_role;
grant execute on function seller_audit_private.review_import_validation_issue(
  uuid, integer, integer, text, text
) to authenticated, service_role;

revoke all on function public.review_import_candidate(
  uuid, integer, integer, jsonb, text
) from public, anon, authenticated;
revoke all on function public.review_import_validation_issue(
  uuid, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function public.review_import_candidate(
  uuid, integer, integer, jsonb, text
) to authenticated, service_role;
grant execute on function public.review_import_validation_issue(
  uuid, integer, integer, text, text
) to authenticated, service_role;

commit;
