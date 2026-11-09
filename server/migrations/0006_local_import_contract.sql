-- Local import SQL prototype; no upload endpoint until authorization and source tests pass.

create function seller_audit_local.persist_master_import_dry_run(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_source_filename text,
  p_source_file_hash text,
  p_summary jsonb,
  p_raw_rows jsonb,
  p_issues jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
  v_actor_ref uuid;
  v_batch_id uuid;
  v_raw jsonb;
  v_issue jsonb;
  v_related jsonb;
  v_raw_row_id uuid;
  v_related_raw_row_id uuid;
  v_related_raw_row_ids uuid[];
  v_source_sheet text;
  v_source_row integer;
  v_product_count integer;
  v_sku_count integer;
  v_bom_count integer;
  v_valid_count integer;
  v_warning_count integer;
  v_error_count integer;
  v_deferred_count integer;
begin
  if v_actor is null then
    raise exception 'Workspace is not accessible.' using errcode = 'P0002';
  end if;

  -- Lock the membership through the statement so a concurrent role/status
  -- change cannot race the privileged writes.
  select wm.actor_ref
  into v_actor_ref
  from seller_audit_local.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = v_actor
    and wm.status = 'ACTIVE'
    and exists (select 1 from seller_audit_local.app_users u where u.id=wm.user_id and u.status='ACTIVE')
    and wm.role in ('ADMIN', 'EDITOR')
  for share;

  if not found then
    raise exception 'Workspace is not accessible.' using errcode = 'P0002';
  end if;

  if p_source_filename is null or btrim(p_source_filename) = '' then
    raise exception 'Source filename is required.' using errcode = '22023';
  end if;
  if p_source_file_hash is null or p_source_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Source file hash must be a lowercase SHA-256 value.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_summary) <> 'object' then
    raise exception 'Summary must be a JSON object.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_raw_rows) <> 'array' then
    raise exception 'Raw rows must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_issues) <> 'array' then
    raise exception 'Issues must be a JSON array.' using errcode = '22023';
  end if;

  if not (
    p_summary ?& array[
      'productCount', 'skuCount', 'bomCount', 'validCount',
      'warningCount', 'errorCount', 'deferredCount'
    ]
    and jsonb_typeof(p_summary->'productCount') = 'number'
    and jsonb_typeof(p_summary->'skuCount') = 'number'
    and jsonb_typeof(p_summary->'bomCount') = 'number'
    and jsonb_typeof(p_summary->'validCount') = 'number'
    and jsonb_typeof(p_summary->'warningCount') = 'number'
    and jsonb_typeof(p_summary->'errorCount') = 'number'
    and jsonb_typeof(p_summary->'deferredCount') = 'number'
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

  v_product_count := (p_summary->>'productCount')::integer;
  v_sku_count := (p_summary->>'skuCount')::integer;
  v_bom_count := (p_summary->>'bomCount')::integer;
  v_valid_count := (p_summary->>'validCount')::integer;
  v_warning_count := (p_summary->>'warningCount')::integer;
  v_error_count := (p_summary->>'errorCount')::integer;
  v_deferred_count := (p_summary->>'deferredCount')::integer;

  if v_valid_count + v_warning_count + v_error_count + v_deferred_count
     <> v_product_count + v_sku_count + v_bom_count then
    raise exception 'Candidate status counts must equal the total candidate count.'
      using errcode = '22023';
  end if;

  insert into seller_audit_local.import_batches (
    workspace_id,
    source_type,
    source_scope_key,
    source_filename,
    source_file_hash,
    parser_version,
    status,
    validation_revision,
    row_count,
    product_candidate_count,
    sku_candidate_count,
    bom_candidate_count,
    valid_count,
    warning_count,
    error_count,
    deferred_count,
    applied_count,
    failed_count,
    remaining_count,
    created_by,
    validated_at
  ) values (
    p_workspace_id,
    'MASTER_WORKBOOK',
    'WORKBOOK',
    p_source_filename,
    p_source_file_hash,
    'master-v1.0.0',
    'REVIEW_REQUIRED',
    1,
    jsonb_array_length(p_raw_rows),
    v_product_count,
    v_sku_count,
    v_bom_count,
    v_valid_count,
    v_warning_count,
    v_error_count,
    v_deferred_count,
    0,
    0,
    0,
    v_actor,
    now()
  )
  returning id into v_batch_id;

  for v_raw in select value from jsonb_array_elements(p_raw_rows)
  loop
    if jsonb_typeof(v_raw) <> 'object'
       or coalesce(btrim(v_raw->>'sourceSheet'), '') = ''
       or jsonb_typeof(v_raw->'originalRowNumber') <> 'number'
       or coalesce(v_raw->>'originalRowNumber', '') !~ '^\d+$'
       or (v_raw->>'originalRowNumber')::numeric < 1
       or jsonb_typeof(v_raw->'rawCells') <> 'array'
       or (v_raw ? 'sourceBlock' and jsonb_typeof(v_raw->'sourceBlock') not in ('string', 'null')) then
      raise exception 'Invalid raw row payload.' using errcode = '22023';
    end if;

    insert into seller_audit_local.raw_import_rows (
      workspace_id,
      import_batch_id,
      source_sheet,
      original_row_number,
      source_block,
      raw_cells
    ) values (
      p_workspace_id,
      v_batch_id,
      v_raw->>'sourceSheet',
      (v_raw->>'originalRowNumber')::integer,
      v_raw->>'sourceBlock',
      v_raw->'rawCells'
    );
  end loop;

  for v_issue in select value from jsonb_array_elements(p_issues)
  loop
    if jsonb_typeof(v_issue) <> 'object'
       or coalesce(btrim(v_issue->>'code'), '') = ''
       or coalesce(v_issue->>'severity', '') not in ('INFO', 'WARNING', 'ERROR')
       or coalesce(v_issue->>'blockingScope', '') not in ('NONE', 'CANDIDATE', 'BATCH')
       or coalesce(btrim(v_issue->>'expectedRule'), '') = ''
       or coalesce(btrim(v_issue->>'message'), '') = ''
       or (v_issue ? 'sourceSheet' and jsonb_typeof(v_issue->'sourceSheet') not in ('string', 'null'))
       or (v_issue ? 'sourceRow' and jsonb_typeof(v_issue->'sourceRow') not in ('number', 'null'))
       or (v_issue ? 'fieldPath' and jsonb_typeof(v_issue->'fieldPath') not in ('string', 'null'))
       or (v_issue ? 'relatedRows' and jsonb_typeof(v_issue->'relatedRows') <> 'array') then
      raise exception 'Invalid validation issue payload.' using errcode = '22023';
    end if;

    v_source_sheet := nullif(v_issue->>'sourceSheet', '');
    v_source_row := null;
    v_raw_row_id := null;

    if v_issue->'sourceRow' is not null and jsonb_typeof(v_issue->'sourceRow') <> 'null' then
      if coalesce(v_issue->>'sourceRow', '') !~ '^\d+$'
         or (v_issue->>'sourceRow')::numeric < 1
         or coalesce(btrim(v_source_sheet), '') = '' then
        raise exception 'Row-level issue source location is invalid.' using errcode = '22023';
      end if;
      v_source_row := (v_issue->>'sourceRow')::integer;

      select r.id into v_raw_row_id
      from seller_audit_local.raw_import_rows r
      where r.workspace_id = p_workspace_id
        and r.import_batch_id = v_batch_id
        and r.source_sheet = v_source_sheet
        and r.original_row_number = v_source_row;

      if not found then
        raise exception 'Issue source row is missing from this import batch.' using errcode = '23503';
      end if;
    end if;

    v_related_raw_row_ids := '{}'::uuid[];
    for v_related in
      select value from jsonb_array_elements(coalesce(v_issue->'relatedRows', '[]'::jsonb))
    loop
      -- MasterImportPreview represents related rows as row numbers on the
      -- issue's source sheet, rather than as client-controlled database IDs.
      if jsonb_typeof(v_related) <> 'number'
         or coalesce(v_related #>> '{}', '') !~ '^\d+$'
         or (v_related #>> '{}')::numeric < 1
         or coalesce(btrim(v_source_sheet), '') = '' then
        raise exception 'Related row reference is invalid.' using errcode = '22023';
      end if;

      select r.id into v_related_raw_row_id
      from seller_audit_local.raw_import_rows r
      where r.workspace_id = p_workspace_id
        and r.import_batch_id = v_batch_id
        and r.source_sheet = v_source_sheet
        and r.original_row_number = (v_related #>> '{}')::integer;

      if not found then
        raise exception 'Related row is missing from this import batch.' using errcode = '23503';
      end if;
      v_related_raw_row_ids := array_append(v_related_raw_row_ids, v_related_raw_row_id);
    end loop;

    insert into seller_audit_local.import_validation_issues (
      workspace_id,
      import_batch_id,
      raw_import_row_id,
      related_raw_row_ids,
      validation_revision,
      issue_code,
      severity,
      blocking_scope,
      source_sheet,
      source_row,
      field_path,
      observed_value,
      expected_rule,
      message,
      status
    ) values (
      p_workspace_id,
      v_batch_id,
      v_raw_row_id,
      v_related_raw_row_ids,
      1,
      v_issue->>'code',
      v_issue->>'severity',
      v_issue->>'blockingScope',
      v_source_sheet,
      v_source_row,
      v_issue->>'fieldPath',
      v_issue->'observedValue',
      v_issue->>'expectedRule',
      v_issue->>'message',
      'OPEN'
    );
  end loop;

  insert into seller_audit_local.activity_logs (
    workspace_id,
    actor_user_id,
    actor_ref,
    action_type,
    entity_type,
    entity_id,
    changed_fields,
    correlation_id
  ) values (
    p_workspace_id,
    v_actor,
    v_actor_ref,
    'IMPORT_VALIDATED',
    'IMPORT_BATCH',
    v_batch_id,
    jsonb_build_object(
      'sourceType', 'MASTER_WORKBOOK',
      'status', 'REVIEW_REQUIRED',
      'parserVersion', 'master-v1.0.0',
      'rowCount', jsonb_array_length(p_raw_rows),
      'productCount', v_product_count,
      'skuCount', v_sku_count,
      'bomCount', v_bom_count,
      'validCount', v_valid_count,
      'warningCount', v_warning_count,
      'errorCount', v_error_count,
      'deferredCount', v_deferred_count
    ),
    v_batch_id
  );

  return v_batch_id;
end;
$$;

create function seller_audit_local.persist_master_import_dry_run(
  p_actor_id uuid,
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
security invoker
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

  v_batch_id := seller_audit_local.persist_master_import_dry_run(
    p_actor_id, p_workspace_id,
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
    from seller_audit_local.raw_import_rows r
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
      from seller_audit_local.raw_import_rows r
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

    insert into seller_audit_local.import_candidates (
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

create or replace function seller_audit_local.review_import_candidate(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_reviewed_values jsonb,
  p_resolution text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
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
  from seller_audit_local.import_candidates c
  join seller_audit_local.import_batches b
    on b.workspace_id = c.workspace_id and b.id = c.import_batch_id
  join seller_audit_local.workspace_members wm
    on wm.workspace_id = c.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role = 'ADMIN'
  join seller_audit_local.app_users au on au.id=wm.user_id and au.status='ACTIVE'
  join seller_audit_local.import_source_files s on s.id=b.source_file_id and s.workspace_id=b.workspace_id and s.verification_status='VERIFIED' and s.server_verified_sha256=b.source_file_hash and b.source_hash_verification='SERVER_VERIFIED'
  where c.id = p_candidate_id and c.workspace_id = p_workspace_id
  for update of wm, b, c, s, au;

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

  update seller_audit_local.import_candidates
  set reviewed_values = p_reviewed_values,
      review_note = v_review_note,
      review_revision = review_revision + 1,
      reviewed_by = v_actor,
      reviewed_at = now()
  where id = v_candidate_id;

  insert into seller_audit_local.activity_logs (
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

create or replace function seller_audit_local.review_import_validation_issue(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_issue_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_status text,
  p_resolution text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
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
  from seller_audit_local.import_validation_issues i
  join seller_audit_local.import_batches b
    on b.workspace_id = i.workspace_id and b.id = i.import_batch_id
  join seller_audit_local.workspace_members wm
    on wm.workspace_id = i.workspace_id
   and wm.user_id = v_actor
   and wm.status = 'ACTIVE'
   and wm.role = 'ADMIN'
  join seller_audit_local.app_users au on au.id=wm.user_id and au.status='ACTIVE'
  join seller_audit_local.import_source_files s on s.id=b.source_file_id and s.workspace_id=b.workspace_id and s.verification_status='VERIFIED' and s.server_verified_sha256=b.source_file_hash and b.source_hash_verification='SERVER_VERIFIED'
  where i.id = p_issue_id and i.workspace_id = p_workspace_id
  for update of wm, b, i, s, au;

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

  update seller_audit_local.import_validation_issues
  set status = p_status,
      resolution = v_resolution,
      review_revision = review_revision + 1,
      reviewed_by = v_actor,
      reviewed_at = now()
  where id = v_issue_id;

  insert into seller_audit_local.activity_logs (
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

CREATE FUNCTION seller_audit_local.persist_verified_master_import_dry_run(
 p_actor_id uuid, p_workspace_id uuid, p_source_file_id uuid, p_summary jsonb, p_raw_rows jsonb, p_candidates jsonb, p_issues jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE source seller_audit_local.import_source_files%rowtype; batch uuid;
BEGIN
 SELECT * INTO source FROM seller_audit_local.import_source_files WHERE id=p_source_file_id AND workspace_id=p_workspace_id AND source_type='MASTER_WORKBOOK' FOR UPDATE;
 IF NOT FOUND OR source.verification_status <> 'VERIFIED' OR source.server_verified_sha256 IS NULL OR source.server_verified_byte_size IS NULL THEN
   RAISE EXCEPTION 'A verified source file is required' USING errcode='55000';
 END IF;
 batch := seller_audit_local.persist_master_import_dry_run(p_actor_id,p_workspace_id,source.original_filename,source.server_verified_sha256,p_summary,p_raw_rows,p_candidates,p_issues);
 UPDATE seller_audit_local.import_batches SET source_file_id=source.id,source_hash_verification='SERVER_VERIFIED' WHERE id=batch AND workspace_id=p_workspace_id;
 RETURN batch;
END; $$;

REVOKE ALL ON FUNCTION seller_audit_local.persist_master_import_dry_run(uuid,uuid,text,text,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION seller_audit_local.persist_master_import_dry_run(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION seller_audit_local.persist_verified_master_import_dry_run(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION seller_audit_local.review_import_candidate(uuid,uuid,uuid,integer,integer,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION seller_audit_local.review_import_validation_issue(uuid,uuid,uuid,integer,integer,text,text) FROM PUBLIC;
