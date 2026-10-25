-- Trusted Master dry-run persistence contract assertions.
-- The complete fixture is rolled back after testing.

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000203'),
  ('00000000-0000-0000-0000-000000000204'),
  ('00000000-0000-0000-0000-000000000205');

insert into public.workspaces (id, name) values
  ('10000000-0000-0000-0000-000000000201', 'Persistence Workspace A'),
  ('10000000-0000-0000-0000-000000000202', 'Persistence Workspace B');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000201', 'ADMIN', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202', 'EDITOR', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000203', 'VIEWER', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000204', 'ADMIN', 'DISABLED'),
  ('10000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000205', 'ADMIN', 'ACTIVE');

do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.persist_master_import_dry_run(uuid,text,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.persist_master_import_dry_run(uuid,text,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_table_privilege('authenticated', 'public.import_batches', 'INSERT')
     or has_table_privilege('authenticated', 'public.raw_import_rows', 'INSERT')
     or has_table_privilege('authenticated', 'public.import_validation_issues', 'INSERT')
     or has_table_privilege('authenticated', 'public.activity_logs', 'INSERT') then
    raise exception 'Trusted persistence privilege boundary is inconsistent.';
  end if;

  if exists (
    select 1
    from public.workspace_members
    where actor_ref is null
  ) then
    raise exception 'Membership actor_ref backfill is incomplete.';
  end if;
end;
$$;

set role anon;
do $$
begin
  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000201',
      'anonymous.xlsx',
      repeat('a', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[]',
      '[]'
    );
    raise exception 'Expected anonymous persistence denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ADMIN persists source evidence, representative real validation codes and
-- eight BOM mismatches in one atomic call.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', false);
do $$
declare
  v_batch_id uuid;
  v_bom_issues jsonb;
  v_issues jsonb;
  v_formula jsonb;
  v_primary_raw_id uuid;
  v_related_raw_id uuid;
  v_actor_ref uuid;
begin
  select jsonb_agg(jsonb_build_object(
    'code', 'BOM_QUANTITY_MISMATCH',
    'severity', 'ERROR',
    'blockingScope', 'CANDIDATE',
    'sourceSheet', 'BOM',
    'sourceRow', row_number,
    'fieldPath', 'quantity',
    'observedValue', row_number,
    'expectedRule', 'BOM quantity must match the normalized source.',
    'message', 'BOM quantity mismatch.'
  ) order by row_number)
  into v_bom_issues
  from generate_series(20, 27) as row_number;

  v_issues := jsonb_build_array(
    jsonb_build_object(
      'code', 'DUPLICATE_BUSINESS_KEY',
      'severity', 'ERROR',
      'blockingScope', 'CANDIDATE',
      'sourceSheet', 'Products',
      'sourceRow', 10,
      'fieldPath', 'sabangnetCode',
      'observedValue', '100526',
      'expectedRule', 'Business keys must be unique.',
      'message', 'Duplicate product business key.',
      'relatedRows', jsonb_build_array(11)
    ),
    jsonb_build_object(
      'code', 'UNKNOWN_SKU',
      'severity', 'ERROR',
      'blockingScope', 'CANDIDATE',
      'sourceSheet', 'SKUs',
      'sourceRow', 15,
      'fieldPath', 'skuCode',
      'observedValue', 'AL24',
      'expectedRule', 'BOM references must resolve to a known SKU.',
      'message', 'Unknown SKU reference.'
    )
  ) || v_bom_issues || jsonb_build_array(
    jsonb_build_object(
      'code', 'WORKBOOK_REVIEW_REQUIRED',
      'severity', 'WARNING',
      'blockingScope', 'BATCH',
      'sourceSheet', 'Summary',
      'sourceRow', null,
      'fieldPath', null,
      'observedValue', null,
      'expectedRule', 'Every browser validation remains review-only.',
      'message', 'Manual review is required.'
    )
  );

  v_batch_id := public.persist_master_import_dry_run(
    '10000000-0000-0000-0000-000000000201',
    'master-admin.xlsx',
    repeat('a', 64),
    '{"productCount":215,"skuCount":460,"bomCount":850,"validCount":1514,"warningCount":1,"errorCount":10,"deferredCount":0}',
    '[
      {"sourceSheet":"Products","originalRowNumber":10,"sourceBlock":"PRODUCT","rawCells":[{"address":"A10","originalType":"STRING","originalValue":"100526","formulaText":null,"cachedValue":null,"errorCode":null},{"address":"B10","originalType":"FORMULA","originalValue":null,"formulaText":"=1/0","cachedValue":"#DIV/0!","errorCode":"#DIV/0!"},{"address":"C10","originalType":"ERROR","originalValue":"#REF!","formulaText":null,"cachedValue":null,"errorCode":"#REF!"}]},
      {"sourceSheet":"Products","originalRowNumber":11,"sourceBlock":"PRODUCT","rawCells":[{"column":"A","value":"100526"}]},
      {"sourceSheet":"SKUs","originalRowNumber":15,"sourceBlock":"SKU","rawCells":[{"column":"A","value":"AL24"}]},
      {"sourceSheet":"BOM","originalRowNumber":20,"sourceBlock":"BOM","rawCells":[{"column":"A","value":"AL00"}]},
      {"sourceSheet":"BOM","originalRowNumber":21,"sourceBlock":"BOM","rawCells":[]},
      {"sourceSheet":"BOM","originalRowNumber":22,"sourceBlock":"BOM","rawCells":[]},
      {"sourceSheet":"BOM","originalRowNumber":23,"sourceBlock":"BOM","rawCells":[]},
      {"sourceSheet":"BOM","originalRowNumber":24,"sourceBlock":"BOM","rawCells":[]},
      {"sourceSheet":"BOM","originalRowNumber":25,"sourceBlock":"BOM","rawCells":[]},
      {"sourceSheet":"BOM","originalRowNumber":26,"sourceBlock":"BOM","rawCells":[]},
      {"sourceSheet":"BOM","originalRowNumber":27,"sourceBlock":"BOM","rawCells":[]}
    ]',
    v_issues
  );

  select raw_cells into v_formula
  from public.raw_import_rows
  where import_batch_id = v_batch_id
    and source_sheet = 'Products'
    and original_row_number = 10;

  select id into v_primary_raw_id
  from public.raw_import_rows
  where import_batch_id = v_batch_id
    and source_sheet = 'Products'
    and original_row_number = 10;

  select id into v_related_raw_id
  from public.raw_import_rows
  where import_batch_id = v_batch_id
    and source_sheet = 'Products'
    and original_row_number = 11;

  select actor_ref into v_actor_ref
  from public.workspace_members
  where workspace_id = '10000000-0000-0000-0000-000000000201'
    and user_id = '00000000-0000-0000-0000-000000000201';

  if (select status from public.import_batches where id = v_batch_id) <> 'REVIEW_REQUIRED'
     or (select validation_revision from public.import_batches where id = v_batch_id) <> 1
     or (select source_scope_key from public.import_batches where id = v_batch_id) <> 'WORKBOOK'
     or (select parser_version from public.import_batches where id = v_batch_id) <> 'master-v1.0.0'
     or (select row_count from public.import_batches where id = v_batch_id) <> 11
     or (select product_candidate_count from public.import_batches where id = v_batch_id) <> 215
     or (select sku_candidate_count from public.import_batches where id = v_batch_id) <> 460
     or (select bom_candidate_count from public.import_batches where id = v_batch_id) <> 850
     or (select count(*) from public.import_validation_issues where import_batch_id = v_batch_id and issue_code = 'BOM_QUANTITY_MISMATCH') <> 8
     or (select count(*) from public.import_validation_issues where import_batch_id = v_batch_id and issue_code = 'DUPLICATE_BUSINESS_KEY' and observed_value = '"100526"'::jsonb) <> 1
     or (select count(*) from public.import_validation_issues where import_batch_id = v_batch_id and issue_code = 'UNKNOWN_SKU' and observed_value = '"AL24"'::jsonb) <> 1 then
    raise exception 'ADMIN persisted batch metadata or issue counts are incorrect.';
  end if;

  if v_formula #>> '{0,address}' <> 'A10'
     or v_formula #>> '{0,originalValue}' <> '100526'
     or v_formula #>> '{1,originalType}' <> 'FORMULA'
     or v_formula #>> '{1,formulaText}' <> '=1/0'
     or v_formula #>> '{1,cachedValue}' <> '#DIV/0!'
     or v_formula #>> '{1,errorCode}' <> '#DIV/0!'
     or v_formula #>> '{2,originalType}' <> 'ERROR'
     or v_formula #>> '{2,originalValue}' <> '#REF!'
     or v_formula #>> '{2,errorCode}' <> '#REF!' then
    raise exception 'Formula or Excel error evidence was not preserved: %', v_formula;
  end if;

  if (select raw_import_row_id from public.import_validation_issues
      where import_batch_id = v_batch_id and issue_code = 'DUPLICATE_BUSINESS_KEY') <> v_primary_raw_id
     or not ((select related_raw_row_ids from public.import_validation_issues
      where import_batch_id = v_batch_id and issue_code = 'DUPLICATE_BUSINESS_KEY') @> array[v_related_raw_id])
     or (select raw_import_row_id from public.import_validation_issues
      where import_batch_id = v_batch_id and issue_code = 'WORKBOOK_REVIEW_REQUIRED') is not null then
    raise exception 'Issue-to-raw provenance is incorrect.';
  end if;

  if (select count(*) from public.activity_logs
      where entity_id = v_batch_id and action_type = 'IMPORT_VALIDATED') <> 1
     or (select actor_ref from public.activity_logs where entity_id = v_batch_id) <> v_actor_ref
     or (select changed_fields ? 'rawRows' from public.activity_logs where entity_id = v_batch_id)
     or (select changed_fields ? 'sourceFileHash' from public.activity_logs where entity_id = v_batch_id) then
    raise exception 'IMPORT_VALIDATED activity log contract failed.';
  end if;
end;
$$;
reset role;

-- EDITOR can persist the same observed file hash again. Even a zero-issue
-- browser validation remains REVIEW_REQUIRED until later verification/approval.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', false);
do $$
declare
  v_batch_id uuid;
begin
  v_batch_id := public.persist_master_import_dry_run(
    '10000000-0000-0000-0000-000000000201',
    'master-editor.xlsx',
    repeat('a', 64),
    '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":1,"warningCount":0,"errorCount":0,"deferredCount":0}',
    '[{"sourceSheet":"Products","originalRowNumber":1,"sourceBlock":"PRODUCT","rawCells":[]}]',
    '[]'
  );

  if (select status from public.import_batches where id = v_batch_id) <> 'REVIEW_REQUIRED'
     or (select count(*) from public.import_batches
         where workspace_id = '10000000-0000-0000-0000-000000000201'
           and source_file_hash = repeat('a', 64)) <> 2
     or (select count(*) from public.activity_logs) <> 0 then
    raise exception 'EDITOR persistence, repeat hash, or activity-log RLS contract failed.';
  end if;
end;
$$;
reset role;

-- A missing row-level source reference aborts Batch, Raw, Issue and ActivityLog.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', false);
do $$
declare
  v_batch_count integer;
  v_raw_count integer;
  v_issue_count integer;
  v_log_count integer;
begin
  select count(*) into v_batch_count from public.import_batches;
  select count(*) into v_raw_count from public.raw_import_rows;
  select count(*) into v_issue_count from public.import_validation_issues;
  select count(*) into v_log_count from public.activity_logs;

  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000201',
      'mismatched-counts.xlsx',
      repeat('b', 64),
      '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[{"sourceSheet":"Products","originalRowNumber":1,"sourceBlock":"PRODUCT","rawCells":[]}]',
      '[]'
    );
    raise exception 'Expected inconsistent candidate counts to fail.';
  exception when invalid_parameter_value then null;
  end;

  if (select count(*) from public.import_batches) <> v_batch_count
     or (select count(*) from public.raw_import_rows) <> v_raw_count
     or (select count(*) from public.import_validation_issues) <> v_issue_count
     or (select count(*) from public.activity_logs) <> v_log_count then
    raise exception 'Invalid candidate counts left partial records.';
  end if;

  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000201',
      'must-rollback.xlsx',
      repeat('b', 64),
      '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":1,"deferredCount":0}',
      '[{"sourceSheet":"Products","originalRowNumber":1,"sourceBlock":"PRODUCT","rawCells":[]}]',
      '[{"code":"MISSING_RAW","severity":"ERROR","blockingScope":"CANDIDATE","sourceSheet":"Products","sourceRow":999,"fieldPath":"code","observedValue":"x","expectedRule":"The source row must exist.","message":"Missing raw row."}]'
    );
    raise exception 'Expected missing raw reference failure.';
  exception when foreign_key_violation then null;
  end;

  if (select count(*) from public.import_batches) <> v_batch_count
     or (select count(*) from public.raw_import_rows) <> v_raw_count
     or (select count(*) from public.import_validation_issues) <> v_issue_count
     or (select count(*) from public.activity_logs) <> v_log_count then
    raise exception 'Failed persistence left partial records.';
  end if;

  begin
    insert into public.import_batches (
      workspace_id, source_type, source_scope_key, source_filename,
      source_file_hash, parser_version
    ) values (
      '10000000-0000-0000-0000-000000000201', 'MASTER_WORKBOOK', 'WORKBOOK',
      'direct-client.xlsx', repeat('c', 64), 'master-v1.0.0'
    );
    raise exception 'Expected direct authenticated DML denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Current membership state, not stale client UI state, controls persistence.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', false);
do $$
begin
  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000201', 'viewer.xlsx', repeat('d', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}', '[]', '[]'
    );
    raise exception 'Expected VIEWER persistence denial.';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000204', false);
do $$
begin
  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000201', 'disabled.xlsx', repeat('e', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}', '[]', '[]'
    );
    raise exception 'Expected DISABLED persistence denial.';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', false);
do $$
begin
  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000202', 'cross-workspace.xlsx', repeat('f', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}', '[]', '[]'
    );
    raise exception 'Expected cross-workspace persistence denial.';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;
reset role;

-- Existing RPC grants remain intact after adding the import RPC.
do $$
begin
  if not has_function_privilege('authenticated', 'public.map_offer(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_issue_status(uuid,text)', 'EXECUTE') then
    raise exception 'Existing mapping/audit RPC grants regressed.';
  end if;
end;
$$;

select 'PASS'::text as master_import_persistence_contract;

rollback;
