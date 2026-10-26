-- Candidate snapshot and trusted human review contract assertions.
-- The complete fixture is rolled back after testing.

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000000302'),
  ('00000000-0000-0000-0000-000000000303'),
  ('00000000-0000-0000-0000-000000000304'),
  ('00000000-0000-0000-0000-000000000305');

insert into public.workspaces (id, name) values
  ('10000000-0000-0000-0000-000000000301', 'Candidate Workspace A'),
  ('10000000-0000-0000-0000-000000000302', 'Candidate Workspace B');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000301', 'ADMIN', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000302', 'EDITOR', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000303', 'VIEWER', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000304', 'ADMIN', 'DISABLED'),
  ('10000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000305', 'ADMIN', 'ACTIVE');

do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.persist_master_import_dry_run(uuid,text,text,jsonb,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.persist_master_import_dry_run(uuid,text,text,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.review_import_candidate(uuid,integer,integer,jsonb,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.review_import_validation_issue(uuid,integer,integer,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.review_import_candidate(uuid,integer,integer,jsonb,text)',
       'EXECUTE'
     )
     or position(
       'for update of wm, b, c'
       in lower(pg_get_functiondef(
         'seller_audit_private.review_import_candidate(uuid,integer,integer,jsonb,text)'::regprocedure
       ))
     ) = 0
     or position(
       'for update of wm, b, i'
       in lower(pg_get_functiondef(
         'seller_audit_private.review_import_validation_issue(uuid,integer,integer,text,text)'::regprocedure
       ))
     ) = 0
     or not has_table_privilege('authenticated', 'public.import_candidates', 'SELECT')
     or has_table_privilege('authenticated', 'public.import_candidates', 'INSERT')
     or has_table_privilege('authenticated', 'public.import_candidates', 'UPDATE')
     or has_table_privilege('authenticated', 'public.import_candidates', 'DELETE') then
    raise exception 'Candidate RPC, grant, or legacy route boundary is inconsistent.';
  end if;
end;
$$;

-- ADMIN atomically persists one candidate of every kind with exact status
-- totals and raw provenance.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', false);
do $$
declare
  v_batch_id uuid;
  v_product_id uuid;
  v_issue_id uuid;
  v_product_raw_id uuid;
  v_supporting_raw_id uuid;
  v_normalized jsonb;
  v_products_before integer;
  v_skus_before integer;
  v_components_before integer;
begin
  select count(*) into v_products_before from public.products;
  select count(*) into v_skus_before from public.skus;
  select count(*) into v_components_before from public.product_components;

  v_batch_id := public.persist_master_import_dry_run(
    '10000000-0000-0000-0000-000000000301',
    '__candidate_admin__.xlsx',
    repeat('a', 64),
    '{"productCount":1,"skuCount":1,"bomCount":1,"validCount":1,"warningCount":0,"errorCount":1,"deferredCount":1}',
    '[
      {"sourceSheet":"단가표","originalRowNumber":6,"sourceBlock":"단가표","rawCells":[]},
      {"sourceSheet":"단가표","originalRowNumber":7,"sourceBlock":"단가표","rawCells":[]},
      {"sourceSheet":"SKU","originalRowNumber":3,"sourceBlock":"SKU","rawCells":[]},
      {"sourceSheet":"BOM","originalRowNumber":4,"sourceBlock":"BOM","rawCells":[]}
    ]',
    '[
      {
        "kind":"PRODUCT","candidateOrdinal":1,"sourceSheet":"단가표","sourceRow":6,
        "sourceBlock":"단가표","sourceFieldMap":{"sabangnetCode":"B6","productName":"E6"},
        "status":"ERROR","issueCodes":["DUPLICATE_BUSINESS_KEY"],
        "normalizedValues":{"sabangnetCode":"100526","productName":"기존 이름","category":"용기","productType":"SET","rawBomText":"AL00 1개","sourceQuantity":1,"sourceChannel":null,"variantOfSourceRow":7},
        "supportingRows":[7]
      },
      {
        "kind":"SKU","candidateOrdinal":1,"sourceSheet":"SKU","sourceRow":3,
        "sourceBlock":"SKU","sourceFieldMap":{"skuCode":"A3"},
        "status":"DEFERRED","issueCodes":["UNKNOWN_SKU"],
        "normalizedValues":{"skuCode":"AL24","modelName":null,"color":null,"sourceCategory":"bundle","registryStatus":"DEFERRED_INTERMEDIATE_BUNDLE"},
        "supportingRows":[]
      },
      {
        "kind":"BOM_COMPONENT","candidateOrdinal":1,"sourceSheet":"BOM","sourceRow":4,
        "sourceBlock":"BOM","sourceFieldMap":{"skuCode":"C4","quantity":"D4"},
        "status":"VALID","issueCodes":[],
        "normalizedValues":{"productCode":"100051","productSourceRow":6,"skuCode":"AL00","quantity":1,"rawToken":"AL00 1개"},
        "supportingRows":[]
      }
    ]',
    '[{
      "code":"DUPLICATE_BUSINESS_KEY","severity":"ERROR","blockingScope":"CANDIDATE",
      "sourceSheet":"단가표","sourceRow":6,"fieldPath":"sabangnetCode","observedValue":"100526",
      "expectedRule":"Business keys must be unique.","message":"Duplicate product business key.","relatedRows":[7]
    }]'
  );

  select id, normalized_values into v_product_id, v_normalized
  from public.import_candidates
  where import_batch_id = v_batch_id and kind = 'PRODUCT';
  select id into v_issue_id
  from public.import_validation_issues
  where import_batch_id = v_batch_id;
  perform set_config('seller_audit.test_candidate_id', v_product_id::text, false);
  perform set_config('seller_audit.test_issue_id', v_issue_id::text, false);
  select id into v_product_raw_id from public.raw_import_rows
  where import_batch_id = v_batch_id and source_sheet = '단가표' and original_row_number = 6;
  select id into v_supporting_raw_id from public.raw_import_rows
  where import_batch_id = v_batch_id and source_sheet = '단가표' and original_row_number = 7;

  if (select count(*) from public.import_candidates where import_batch_id = v_batch_id and kind = 'PRODUCT') <> 1
     or (select count(*) from public.import_candidates where import_batch_id = v_batch_id and kind = 'SKU') <> 1
     or (select count(*) from public.import_candidates where import_batch_id = v_batch_id and kind = 'BOM_COMPONENT') <> 1
     or (select count(*) from public.import_candidates where import_batch_id = v_batch_id and candidate_status = 'VALID') <> 1
     or (select count(*) from public.import_candidates where import_batch_id = v_batch_id and candidate_status = 'ERROR') <> 1
     or (select count(*) from public.import_candidates where import_batch_id = v_batch_id and candidate_status = 'DEFERRED') <> 1
     or (select raw_import_row_id from public.import_candidates where id = v_product_id) <> v_product_raw_id
     or not ((select supporting_raw_row_ids from public.import_candidates where id = v_product_id) @> array[v_supporting_raw_id])
     or (select status from public.import_batches where id = v_batch_id) <> 'REVIEW_REQUIRED'
     or (select count(*) from public.activity_logs where entity_id = v_batch_id and action_type = 'IMPORT_VALIDATED') <> 1 then
    raise exception 'ADMIN candidate snapshot persistence is incorrect.';
  end if;

  if (select count(*) from public.products) <> v_products_before
     or (select count(*) from public.skus) <> v_skus_before
     or (select count(*) from public.product_components) <> v_components_before then
    raise exception 'Candidate persistence changed protected master data.';
  end if;

  -- Candidate review records an allowlisted override without changing the
  -- normalized validation snapshot or candidate status.
  perform public.review_import_candidate(
    v_product_id, 1, 0,
    '{"sabangnetCode":"100999"}',
    '원본 소유자 확인 결과 코드 정정'
  );

  if (select review_revision from public.import_candidates where id = v_product_id) <> 1
     or (select reviewed_values->>'sabangnetCode' from public.import_candidates where id = v_product_id) <> '100999'
     or (select reviewed_by from public.import_candidates where id = v_product_id) <> auth.uid()
     or (select reviewed_at from public.import_candidates where id = v_product_id) is null
     or (select normalized_values from public.import_candidates where id = v_product_id) <> v_normalized
     or (select candidate_status from public.import_candidates where id = v_product_id) <> 'ERROR'
     or (select count(*) from public.activity_logs where entity_id = v_product_id and action_type = 'IMPORT_REVIEWED') <> 1 then
    raise exception 'ADMIN candidate review or immutable validation result is incorrect.';
  end if;

  begin
    perform public.review_import_candidate(v_product_id, 1, 0, '{"productName":"stale"}', 'stale');
    raise exception 'Expected stale candidate review denial.';
  exception when serialization_failure then null;
  end;
  begin
    perform public.review_import_candidate(v_product_id, 1, 1, '{"unknown":"x"}', 'unknown field');
    raise exception 'Expected unknown candidate field denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.review_import_candidate(v_product_id, 1, 1, '{"variantOfSourceRow":8}', 'provenance');
    raise exception 'Expected provenance override denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.review_import_candidate(v_product_id, 1, 1, '{"sourceQuantity":"one"}', 'invalid type');
    raise exception 'Expected candidate field type denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.review_import_candidate(v_product_id, 1, 1, '{}'::jsonb, null);
    raise exception 'Expected empty candidate review denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.review_import_candidate(v_product_id, 1, 1, '{"productName":"changed"}', '   ');
    raise exception 'Expected blank review note denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.review_import_candidate(v_product_id, 2, 1, '{"productName":"changed"}', 'wrong revision');
    raise exception 'Expected wrong validation revision denial.';
  exception when serialization_failure then null;
  end;

  -- Issue decisions use their own optimistic revision and do not imply
  -- candidate validity or batch readiness.
  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 0, 'RESOLVED', null);
    raise exception 'Expected RESOLVED note requirement.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 0, 'ACKNOWLEDGED', '   ');
    raise exception 'Expected ACKNOWLEDGED note requirement.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 0, 'DEFERRED', null);
    raise exception 'Expected DEFERRED note requirement.';
  exception when invalid_parameter_value then null;
  end;

  perform public.review_import_validation_issue(
    v_issue_id, 1, 0, 'RESOLVED', '소유자 확인으로 처리 결정 기록'
  );

  if (select status from public.import_validation_issues where id = v_issue_id) <> 'RESOLVED'
     or (select review_revision from public.import_validation_issues where id = v_issue_id) <> 1
     or (select reviewed_by from public.import_validation_issues where id = v_issue_id) <> auth.uid()
     or (select reviewed_at from public.import_validation_issues where id = v_issue_id) is null
     or (select count(*) from public.activity_logs where entity_id = v_issue_id and action_type = 'IMPORT_REVIEWED') <> 1
     or (select status from public.import_batches where id = v_batch_id) <> 'REVIEW_REQUIRED'
     or (select candidate_status from public.import_candidates where id = v_product_id) <> 'ERROR'
     or (select count(*) from public.products) <> v_products_before
     or (select count(*) from public.skus) <> v_skus_before
     or (select count(*) from public.product_components) <> v_components_before then
    raise exception 'ADMIN validation issue review is incorrect.';
  end if;

  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 0, 'OPEN', null);
    raise exception 'Expected stale issue review denial.';
  exception when serialization_failure then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue_id, 2, 1, 'OPEN', null);
    raise exception 'Expected stale issue validation revision denial.';
  exception when serialization_failure then null;
  end;

end;
$$;
reset role;

-- Even a privileged maintenance update cannot rewrite parser provenance.
do $$
declare
  v_product_id uuid;
begin
  select c.id into v_product_id
  from public.import_candidates c
  join public.import_batches b on b.id = c.import_batch_id
  where b.source_filename = '__candidate_admin__.xlsx' and c.kind = 'PRODUCT';
  begin
    update public.import_candidates
    set normalized_values = jsonb_set(normalized_values, '{sabangnetCode}', '"tampered"')
    where id = v_product_id;
    raise exception 'Expected immutable normalized snapshot denial.';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- EDITOR may persist and read snapshots, but cannot review candidates/issues.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', false);
do $$
declare
  v_batch_id uuid;
  v_candidate_id uuid;
  v_issue_id uuid;
begin
  v_batch_id := public.persist_master_import_dry_run(
    '10000000-0000-0000-0000-000000000301', '__candidate_editor__.xlsx', repeat('b', 64),
    '{"productCount":0,"skuCount":1,"bomCount":0,"validCount":1,"warningCount":0,"errorCount":0,"deferredCount":0}',
    '[{"sourceSheet":"SKU","originalRowNumber":9,"sourceBlock":"SKU","rawCells":[]}]',
    '[{"kind":"SKU","candidateOrdinal":1,"sourceSheet":"SKU","sourceRow":9,"sourceBlock":"SKU","sourceFieldMap":{"skuCode":"A9"},"status":"VALID","issueCodes":[],"normalizedValues":{"skuCode":"AL00","modelName":null,"color":null,"sourceCategory":null,"registryStatus":"BOM_REGISTRY"},"supportingRows":[]}]',
    '[]'
  );
  select id into v_candidate_id from public.import_candidates where import_batch_id = v_batch_id;
  select id into v_issue_id from public.import_validation_issues
  where workspace_id = '10000000-0000-0000-0000-000000000301' limit 1;

  if v_candidate_id is null then
    raise exception 'EDITOR candidate persistence failed.';
  end if;
  begin
    perform public.review_import_candidate(v_candidate_id, 1, 0, '{"skuCode":"AL01"}', 'editor');
    raise exception 'Expected EDITOR candidate review denial.';
  exception when no_data_found then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 1, 'OPEN', null);
    raise exception 'Expected EDITOR issue review denial.';
  exception when no_data_found then null;
  end;
end;
$$;
reset role;

-- Workspace B supplies a concrete cross-tenant candidate and issue target.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000305', false);
do $$
declare
  v_batch_id uuid;
  v_candidate_id uuid;
  v_issue_id uuid;
begin
  v_batch_id := public.persist_master_import_dry_run(
    '10000000-0000-0000-0000-000000000302', '__candidate_workspace_b__.xlsx', repeat('c', 64),
    '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":1,"errorCount":0,"deferredCount":0}',
    '[{"sourceSheet":"단가표","originalRowNumber":1,"sourceBlock":"단가표","rawCells":[]}]',
    '[{"kind":"PRODUCT","candidateOrdinal":1,"sourceSheet":"단가표","sourceRow":1,"sourceBlock":"단가표","sourceFieldMap":{},"status":"WARNING","issueCodes":["MISSING_REQUIRED_FIELD"],"normalizedValues":{"sabangnetCode":null,"productName":"B","category":null,"productType":null,"rawBomText":null,"sourceQuantity":null,"sourceChannel":null,"variantOfSourceRow":null},"supportingRows":[]}]',
    '[{"code":"MISSING_REQUIRED_FIELD","severity":"WARNING","blockingScope":"CANDIDATE","sourceSheet":"단가표","sourceRow":1,"fieldPath":"sabangnetCode","observedValue":null,"expectedRule":"Code is required.","message":"Missing code."}]'
  );
  select id into v_candidate_id from public.import_candidates where import_batch_id = v_batch_id;
  select id into v_issue_id from public.import_validation_issues where import_batch_id = v_batch_id;
  perform set_config('seller_audit.test_cross_candidate_id', v_candidate_id::text, false);
  perform set_config('seller_audit.test_cross_issue_id', v_issue_id::text, false);
end;
$$;
reset role;

-- ADMIN A cannot review Workspace B records.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', false);
do $$
declare
  v_candidate_id uuid;
  v_issue_id uuid;
begin
  v_candidate_id := current_setting('seller_audit.test_cross_candidate_id')::uuid;
  v_issue_id := current_setting('seller_audit.test_cross_issue_id')::uuid;
  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000302', 'cross-workspace.xlsx', repeat('9', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[]', '[]', '[]'
    );
    raise exception 'Expected cross-workspace persistence denial.';
  exception when no_data_found then null;
  end;
  begin
    perform public.review_import_candidate(v_candidate_id, 1, 0, '{"productName":"cross"}', 'cross');
    raise exception 'Expected cross-workspace candidate review denial.';
  exception when no_data_found then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 0, 'RESOLVED', 'cross');
    raise exception 'Expected cross-workspace issue review denial.';
  exception when no_data_found then null;
  end;
end;
$$;
reset role;

-- VIEWER and DISABLED actors cannot persist or review and cannot select detail.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000303', false);
do $$
declare
  v_candidate_id uuid;
  v_issue_id uuid;
begin
  v_candidate_id := current_setting('seller_audit.test_candidate_id')::uuid;
  v_issue_id := current_setting('seller_audit.test_issue_id')::uuid;
  -- RLS intentionally hides the candidate/issue, so obtain fixed targets via
  -- security-definer APIs only through calls made with known UUIDs below.
  if (select count(*) from public.import_candidates) <> 0
     or (select count(*) from public.raw_import_rows) <> 0
     or (select count(*) from public.import_validation_issues) <> 0
     or (select count(*) from public.activity_logs) <> 0 then
    raise exception 'VIEWER can read import detail protected by RLS.';
  end if;
  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000301', 'viewer.xlsx', repeat('d', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[]', '[]', '[]'
    );
    raise exception 'Expected VIEWER persistence denial.';
  exception when no_data_found then null;
  end;
  begin
    perform public.review_import_candidate(v_candidate_id, 1, 1, '{"productName":"viewer"}', 'viewer');
    raise exception 'Expected VIEWER candidate review denial.';
  exception when no_data_found then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 1, 'OPEN', null);
    raise exception 'Expected VIEWER issue review denial.';
  exception when no_data_found then null;
  end;
  begin
    insert into public.import_candidates (
      workspace_id, import_batch_id, raw_import_row_id, validation_revision,
      candidate_ordinal, kind, source_field_map, normalized_values, candidate_status
    ) values (
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 1,
      'PRODUCT', '{}', '{}', 'VALID'
    );
    raise exception 'Expected direct candidate INSERT denial.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.import_candidates
    set review_note = 'direct update'
    where id = v_candidate_id;
    raise exception 'Expected direct candidate UPDATE denial.';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.import_candidates where id = v_candidate_id;
    raise exception 'Expected direct candidate DELETE denial.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.import_validation_issues set status = 'RESOLVED';
    raise exception 'Expected direct issue UPDATE denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000304', false);
do $$
declare
  v_candidate_id uuid := current_setting('seller_audit.test_candidate_id')::uuid;
  v_issue_id uuid := current_setting('seller_audit.test_issue_id')::uuid;
begin
  if (select count(*) from public.import_batches) <> 0
     or (select count(*) from public.import_candidates) <> 0 then
    raise exception 'DISABLED actor can read import data.';
  end if;
  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000301', 'disabled.xlsx', repeat('e', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[]', '[]', '[]'
    );
    raise exception 'Expected DISABLED persistence denial.';
  exception when no_data_found then null;
  end;
  begin
    perform public.review_import_candidate(v_candidate_id, 1, 1, '{"productName":"disabled"}', 'disabled');
    raise exception 'Expected DISABLED candidate review denial.';
  exception when no_data_found then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue_id, 1, 1, 'OPEN', null);
    raise exception 'Expected DISABLED issue review denial.';
  exception when no_data_found then null;
  end;
end;
$$;
reset role;

-- Malformed candidate payloads fail atomically without leaving any part of a
-- batch. Each call runs inside its own PL/pgSQL exception subtransaction.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', false);
do $$
declare
  v_batch_count integer;
  v_raw_count integer;
  v_candidate_count integer;
  v_issue_count integer;
  v_log_count integer;
begin
  select count(*) into v_batch_count from public.import_batches;
  select count(*) into v_raw_count from public.raw_import_rows;
  select count(*) into v_candidate_count from public.import_candidates;
  select count(*) into v_issue_count from public.import_validation_issues;
  select count(*) into v_log_count from public.activity_logs;

  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000301', 'count-mismatch.xlsx', repeat('f', 64),
      '{"productCount":2,"skuCount":0,"bomCount":0,"validCount":1,"warningCount":0,"errorCount":0,"deferredCount":1}',
      '[{"sourceSheet":"S","originalRowNumber":1,"sourceBlock":"S","rawCells":[]}]',
      '[{"kind":"PRODUCT","candidateOrdinal":1,"sourceSheet":"S","sourceRow":1,"sourceBlock":"S","sourceFieldMap":{},"status":"VALID","issueCodes":[],"normalizedValues":{"sabangnetCode":"1","productName":"P","category":null,"productType":null,"rawBomText":null,"sourceQuantity":1,"sourceChannel":null,"variantOfSourceRow":null},"supportingRows":[]}]',
      '[]'
    );
    raise exception 'Expected candidate count mismatch denial.';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000301', 'missing-raw.xlsx', repeat('1', 64),
      '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":1,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[{"sourceSheet":"S","originalRowNumber":1,"sourceBlock":"S","rawCells":[]}]',
      '[{"kind":"PRODUCT","candidateOrdinal":1,"sourceSheet":"S","sourceRow":2,"sourceBlock":"S","sourceFieldMap":{},"status":"VALID","issueCodes":[],"normalizedValues":{"sabangnetCode":"1","productName":"P","category":null,"productType":null,"rawBomText":null,"sourceQuantity":1,"sourceChannel":null,"variantOfSourceRow":null},"supportingRows":[]}]',
      '[]'
    );
    raise exception 'Expected unknown candidate raw source denial.';
  exception when foreign_key_violation then null;
  end;

  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000301', 'invalid-shape.xlsx', repeat('2', 64),
      '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":1,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[{"sourceSheet":"S","originalRowNumber":1,"sourceBlock":"S","rawCells":[]}]',
      '[{"kind":"PRODUCT","candidateOrdinal":1,"sourceSheet":"S","sourceRow":1,"sourceBlock":"S","sourceFieldMap":{},"status":"VALID","issueCodes":[],"normalizedValues":{"sabangnetCode":"1","unexpected":"x"},"supportingRows":[]}]',
      '[]'
    );
    raise exception 'Expected invalid normalizedValues denial.';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000301', 'invalid-kind.xlsx', repeat('3', 64),
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":1,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[{"sourceSheet":"S","originalRowNumber":1,"sourceBlock":"S","rawCells":[]}]',
      '[{"kind":"UNKNOWN","candidateOrdinal":1,"sourceSheet":"S","sourceRow":1,"sourceBlock":"S","sourceFieldMap":{},"status":"VALID","issueCodes":[],"normalizedValues":{},"supportingRows":[]}]',
      '[]'
    );
    raise exception 'Expected invalid candidate kind denial.';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.persist_master_import_dry_run(
      '10000000-0000-0000-0000-000000000301', 'invalid-status.xlsx', repeat('4', 64),
      '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[{"sourceSheet":"S","originalRowNumber":1,"sourceBlock":"S","rawCells":[]}]',
      '[{"kind":"PRODUCT","candidateOrdinal":1,"sourceSheet":"S","sourceRow":1,"sourceBlock":"S","sourceFieldMap":{},"status":"UNKNOWN","issueCodes":[],"normalizedValues":{"sabangnetCode":"1","productName":"P","category":null,"productType":null,"rawBomText":null,"sourceQuantity":1,"sourceChannel":null,"variantOfSourceRow":null},"supportingRows":[]}]',
      '[]'
    );
    raise exception 'Expected invalid candidate status denial.';
  exception when invalid_parameter_value then null;
  end;

  if (select count(*) from public.import_batches) <> v_batch_count
     or (select count(*) from public.raw_import_rows) <> v_raw_count
     or (select count(*) from public.import_candidates) <> v_candidate_count
     or (select count(*) from public.import_validation_issues) <> v_issue_count
     or (select count(*) from public.activity_logs) <> v_log_count then
    raise exception 'Malformed candidate persistence left partial records.';
  end if;
end;
$$;
reset role;

select 'PASS'::text as import_candidate_review_contract;

rollback;
