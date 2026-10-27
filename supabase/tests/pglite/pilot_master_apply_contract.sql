-- Pilot Master Apply v1 contract: create-only classification, authorization,
-- source trust, conflicts, idempotency, atomicity, counters, and audit.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000601'),
  ('00000000-0000-0000-0000-000000000602'),
  ('00000000-0000-0000-0000-000000000603'),
  ('00000000-0000-0000-0000-000000000604'),
  ('00000000-0000-0000-0000-000000000605');

insert into public.workspaces (id, name) values
  ('10000000-0000-0000-0000-000000000601', 'Apply Workspace A'),
  ('10000000-0000-0000-0000-000000000602', 'Apply Workspace B');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000601', 'ADMIN', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000602', 'EDITOR', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000603', 'VIEWER', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000604', 'VIEWER', 'DISABLED'),
  ('10000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000605', 'ADMIN', 'ACTIVE');

insert into public.import_source_files (
  id, workspace_id, original_filename, storage_object_path,
  client_observed_byte_size, client_observed_sha256,
  server_verified_byte_size, server_verified_sha256,
  server_verified_storage_object_id, verification_status,
  created_by, verified_by, verified_at
) values
  ('20000000-0000-0000-0000-000000000601', '10000000-0000-0000-0000-000000000601',
   '__6a_a__.xlsx', '10000000-0000-0000-0000-000000000601/20000000-0000-0000-0000-000000000601/source.xlsx',
   10, repeat('a', 64), 10, repeat('a', 64), gen_random_uuid(), 'VERIFIED',
   '00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000601', now()),
  ('20000000-0000-0000-0000-000000000602', '10000000-0000-0000-0000-000000000602',
   '__6a_b__.xlsx', '10000000-0000-0000-0000-000000000602/20000000-0000-0000-0000-000000000602/source.xlsx',
   10, repeat('b', 64), 10, repeat('b', 64), gen_random_uuid(), 'VERIFIED',
   '00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000605', now());

-- Happy path has three NEW rows plus each conservative skip state.
insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename,
  source_file_hash, parser_version, status, validation_revision,
  row_count, valid_count, warning_count, error_count, deferred_count,
  remaining_count, created_by, source_file_id, source_hash_verification
) values (
  '30000000-0000-0000-0000-000000000601',
  '10000000-0000-0000-0000-000000000601', 'MASTER_WORKBOOK', 'MASTER',
  '__6a_happy__.xlsx', repeat('a', 64), 'master-v1', 'REVIEW_REQUIRED', 1,
  7, 4, 1, 1, 1, 7, '00000000-0000-0000-0000-000000000601',
  '20000000-0000-0000-0000-000000000601', 'SERVER_VERIFIED'
);

insert into public.raw_import_rows (
  id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
)
select
  ('40000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000601',
  '30000000-0000-0000-0000-000000000601',
  case when n <= 2 then 'MASTER' else 'BOM' end, n, '[]'::jsonb
from generate_series(1, 7) n;

insert into public.import_candidates (
  id, workspace_id, import_batch_id, raw_import_row_id, validation_revision,
  candidate_ordinal, kind, source_sheet, source_row, source_field_map,
  normalized_values, candidate_status, reviewed_values, review_note,
  review_revision, reviewed_by, reviewed_at
) values
  ('50000000-0000-0000-0000-000000000601', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000601', '40000000-0000-0000-0000-000000000001', 1,
   1, 'PRODUCT', 'MASTER', 1, '{}',
   '{"sabangnetCode":"P-ORIGINAL","productName":"Original","category":"old","productType":"SET","variantOfSourceRow":null}', 'VALID',
   '{"sabangnetCode":"P-6A","productName":"Reviewed Product","category":null}', 'reviewed', 1, '00000000-0000-0000-0000-000000000601', now()),
  ('50000000-0000-0000-0000-000000000602', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000601', '40000000-0000-0000-0000-000000000002', 1,
   2, 'SKU', 'MASTER', 2, '{}',
   '{"skuCode":"SKU-6A","modelName":"Pilot SKU","color":"purple"}', 'VALID', null, null, 0, null, null),
  ('50000000-0000-0000-0000-000000000603', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000601', '40000000-0000-0000-0000-000000000003', 1,
   3, 'BOM_COMPONENT', 'BOM', 3, '{}',
   '{"productCode":"STALE","productSourceRow":1,"skuCode":"SKU-6A","quantity":2}', 'VALID', null, null, 0, null, null),
  ('50000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000601', '40000000-0000-0000-0000-000000000004', 1,
   4, 'PRODUCT', 'BOM', 4, '{}', '{"sabangnetCode":"W","productName":"Warning","productType":"SINGLE","variantOfSourceRow":null}', 'WARNING', null, null, 0, null, null),
  ('50000000-0000-0000-0000-000000000605', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000601', '40000000-0000-0000-0000-000000000005', 1,
   5, 'SKU', 'BOM', 5, '{}', '{"skuCode":"E","modelName":"Error"}', 'ERROR', null, null, 0, null, null),
  ('50000000-0000-0000-0000-000000000606', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000601', '40000000-0000-0000-0000-000000000006', 1,
   6, 'BOM_COMPONENT', 'BOM', 6, '{}', '{"productCode":"P-6A","productSourceRow":1,"skuCode":"SKU-6A","quantity":1}', 'DEFERRED', null, null, 0, null, null),
  ('50000000-0000-0000-0000-000000000607', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000601', '40000000-0000-0000-0000-000000000007', 1,
   7, 'BOM_COMPONENT', 'BOM', 7, '{}', '{"productCode":"P-6A","productSourceRow":1,"skuCode":"SKU-6A","quantity":0}', 'VALID', null, null, 0, null, null);

set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin
    perform public.preview_master_import_apply('30000000-0000-0000-0000-000000000601');
    raise exception 'Expected anonymous preview denial.';
  exception when insufficient_privilege then null;
  end;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000602', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000601');
  if not (v->>'canApply')::boolean
     or (v->>'productNew')::integer <> 1
     or (v->>'skuNew')::integer <> 1
     or (v->>'bomNew')::integer <> 1
     or (v->>'productSkipped')::integer <> 1
     or (v->>'skuSkipped')::integer <> 1
     or (v->>'bomSkipped')::integer <> 2
     or (select count(*) from jsonb_array_elements(v->'rows') row where row->>'status' = 'NEW') <> 3
     or (select count(*) from jsonb_array_elements(v->'rows') row
         where row->>'candidateId' = '50000000-0000-0000-0000-000000000601'
           and row->>'businessKey' = 'P-6A') <> 1 then
    raise exception 'EDITOR happy-path preview classification failed: %', v;
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000601');
    raise exception 'Expected EDITOR apply denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000603', false);
do $$ begin
  begin
    perform public.preview_master_import_apply('30000000-0000-0000-0000-000000000601');
    raise exception 'Expected VIEWER preview denial.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000604', false);
do $$ begin
  begin
    perform public.preview_master_import_apply('30000000-0000-0000-0000-000000000601');
    raise exception 'Expected DISABLED preview denial.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000605', false);
do $$ begin
  begin
    perform public.preview_master_import_apply('30000000-0000-0000-0000-000000000601');
    raise exception 'Expected cross-workspace preview denial.';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', false);
do $$
declare v jsonb;
begin
  v := public.apply_master_import_batch('30000000-0000-0000-0000-000000000601');
  if v->>'finalBatchStatus' <> 'PARTIALLY_APPLIED'
     or (v->>'appliedCount')::integer <> 3
     or (v->>'remainingCount')::integer <> 4 then
    raise exception 'Apply result counters failed: %', v;
  end if;
  if (select product_name from public.products where workspace_id = '10000000-0000-0000-0000-000000000601' and sabangnet_code = 'P-6A') <> 'Reviewed Product'
     or (select category from public.products where workspace_id = '10000000-0000-0000-0000-000000000601' and sabangnet_code = 'P-6A') is not null
     or (select count(*) from public.skus where workspace_id = '10000000-0000-0000-0000-000000000601' and sku_code = 'SKU-6A') <> 1
     or (select quantity from public.product_components where workspace_id = '10000000-0000-0000-0000-000000000601') <> 2
     or (select applied_count from public.import_batches where id = '30000000-0000-0000-0000-000000000601') <> 3
     or (select remaining_count from public.import_batches where id = '30000000-0000-0000-0000-000000000601') <> 4
     or (select count(*) from public.activity_logs where entity_id = '30000000-0000-0000-0000-000000000601' and action_type = 'IMPORT_APPLIED') <> 1 then
    raise exception 'Atomic create-only apply state is incorrect.';
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000601');
    raise exception 'Expected completed batch retry denial.';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select count(*) from public.products where workspace_id = '10000000-0000-0000-0000-000000000601' and sabangnet_code = 'P-6A') <> 1
     or (select count(*) from public.activity_logs where entity_id = '30000000-0000-0000-0000-000000000601' and action_type = 'IMPORT_APPLIED') <> 1 then
    raise exception 'Apply retry created duplicate state.';
  end if;
end;
$$;
reset role;

-- Equivalent master data is UNCHANGED; a differing quantity is CONFLICT and
-- therefore blocks the whole batch without updating the existing component.
insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename, source_file_hash,
  parser_version, status, validation_revision, row_count, valid_count, remaining_count,
  created_by, source_file_id, source_hash_verification
) values (
  '30000000-0000-0000-0000-000000000602', '10000000-0000-0000-0000-000000000601',
  'MASTER_WORKBOOK', 'MASTER', '__6a_conflict__.xlsx', repeat('a', 64), 'master-v1',
  'REVIEW_REQUIRED', 1, 3, 3, 3, '00000000-0000-0000-0000-000000000601',
  '20000000-0000-0000-0000-000000000601', 'SERVER_VERIFIED'
);
insert into public.raw_import_rows (id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells) values
  ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000602', 'S', 1, '[]'),
  ('40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000602', 'S', 2, '[]'),
  ('40000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000602', 'S', 3, '[]');
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000602', '40000000-0000-0000-0000-000000000011', 1, 1, 'PRODUCT', 'S', 1, '{}', '{"sabangnetCode":"P-6A","productName":"Reviewed Product","category":null,"productType":"SET","variantOfSourceRow":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000602', '40000000-0000-0000-0000-000000000012', 1, 2, 'SKU', 'S', 2, '{}', '{"skuCode":"SKU-6A","modelName":"Pilot SKU","color":"purple"}', 'VALID'),
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000602', '40000000-0000-0000-0000-000000000013', 1, 3, 'BOM_COMPONENT', 'S', 3, '{}', '{"productCode":"P-6A","productSourceRow":1,"skuCode":"SKU-6A","quantity":3}', 'VALID');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000602');
  if (v->>'productUnchanged')::integer <> 1
     or (v->>'skuUnchanged')::integer <> 1
     or (v->>'bomConflict')::integer <> 1
     or (v->>'canApply')::boolean then
    raise exception 'UNCHANGED / BOM conflict preview failed: %', v;
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000602');
    raise exception 'Expected conflict apply denial.';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select quantity from public.product_components where workspace_id = '10000000-0000-0000-0000-000000000601') <> 2 then
    raise exception 'Conflict changed existing BOM.';
  end if;
end;
$$;
reset role;

-- Product and SKU values with the same business keys are conflicts. No
-- automatic UPDATE is permitted.
insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename, source_file_hash,
  parser_version, status, validation_revision, row_count, valid_count, remaining_count,
  created_by, source_file_id, source_hash_verification
) values (
  '30000000-0000-0000-0000-000000000605', '10000000-0000-0000-0000-000000000601',
  'MASTER_WORKBOOK', 'MASTER', '__6a_master_conflict__.xlsx', repeat('a', 64), 'master-v1',
  'REVIEW_REQUIRED', 1, 2, 2, 2, '00000000-0000-0000-0000-000000000601',
  '20000000-0000-0000-0000-000000000601', 'SERVER_VERIFIED'
);
insert into public.raw_import_rows (id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells) values
  ('40000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000605', 'C', 1, '[]'),
  ('40000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000605', 'C', 2, '[]');
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000605', '40000000-0000-0000-0000-000000000041', 1, 1, 'PRODUCT', 'C', 1, '{}', '{"sabangnetCode":"P-6A","productName":"Must Not Replace","category":null,"productType":"SET","variantOfSourceRow":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000605', '40000000-0000-0000-0000-000000000042', 1, 2, 'SKU', 'C', 2, '{}', '{"skuCode":"SKU-6A","modelName":"Pilot SKU","color":"different"}', 'VALID');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000605');
  if (v->>'productConflict')::integer <> 1
     or (v->>'skuConflict')::integer <> 1
     or (v->>'canApply')::boolean then
    raise exception 'Product/SKU conflict preview failed: %', v;
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000605');
    raise exception 'Expected Product/SKU conflict denial.';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select product_name from public.products where workspace_id = '10000000-0000-0000-0000-000000000601' and sabangnet_code = 'P-6A') <> 'Reviewed Product'
     or (select color from public.skus where workspace_id = '10000000-0000-0000-0000-000000000601' and sku_code = 'SKU-6A') <> 'purple' then
    raise exception 'Conflict mutated Product or SKU.';
  end if;
end $$;
reset role;

-- A fully identical Product/SKU/BOM preview is idempotent: all UNCHANGED,
-- no duplicate insert, and no apply because there is no NEW row.
insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename, source_file_hash,
  parser_version, status, validation_revision, row_count, valid_count, remaining_count,
  created_by, source_file_id, source_hash_verification
) values (
  '30000000-0000-0000-0000-000000000606', '10000000-0000-0000-0000-000000000601',
  'MASTER_WORKBOOK', 'MASTER', '__6a_unchanged__.xlsx', repeat('a', 64), 'master-v1',
  'REVIEW_REQUIRED', 1, 3, 3, 3, '00000000-0000-0000-0000-000000000601',
  '20000000-0000-0000-0000-000000000601', 'SERVER_VERIFIED'
);
insert into public.raw_import_rows (id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells) values
  ('40000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000606', 'I', 1, '[]'),
  ('40000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000606', 'I', 2, '[]'),
  ('40000000-0000-0000-0000-000000000053', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000606', 'I', 3, '[]');
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000606', '40000000-0000-0000-0000-000000000051', 1, 1, 'PRODUCT', 'I', 1, '{}', '{"sabangnetCode":"P-6A","productName":"Reviewed Product","category":null,"productType":"SET","variantOfSourceRow":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000606', '40000000-0000-0000-0000-000000000052', 1, 2, 'SKU', 'I', 2, '{}', '{"skuCode":"SKU-6A","modelName":"Pilot SKU","color":"purple"}', 'VALID'),
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000606', '40000000-0000-0000-0000-000000000053', 1, 3, 'BOM_COMPONENT', 'I', 3, '{}', '{"productCode":"P-6A","productSourceRow":1,"skuCode":"SKU-6A","quantity":2}', 'VALID');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000606');
  if (v->>'productUnchanged')::integer <> 1
     or (v->>'skuUnchanged')::integer <> 1
     or (v->>'bomUnchanged')::integer <> 1
     or (v->>'canApply')::boolean then
    raise exception 'Idempotent UNCHANGED preview failed: %', v;
  end if;
end $$;
reset role;

-- An OPEN BATCH issue blocks an otherwise valid and trusted NEW candidate.
insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename, source_file_hash,
  parser_version, status, validation_revision, row_count, valid_count, remaining_count,
  created_by, source_file_id, source_hash_verification
) values (
  '30000000-0000-0000-0000-000000000607', '10000000-0000-0000-0000-000000000601',
  'MASTER_WORKBOOK', 'MASTER', '__6a_blocked__.xlsx', repeat('a', 64), 'master-v1',
  'REVIEW_REQUIRED', 1, 1, 1, 1, '00000000-0000-0000-0000-000000000601',
  '20000000-0000-0000-0000-000000000601', 'SERVER_VERIFIED'
);
insert into public.raw_import_rows (id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells)
values ('40000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000607', 'B', 1, '[]');
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000607', '40000000-0000-0000-0000-000000000061', 1, 1,
  'PRODUCT', 'B', 1, '{}', '{"sabangnetCode":"BLOCKED","productName":"Blocked","category":null,"productType":"SINGLE","variantOfSourceRow":null}', 'VALID');
insert into public.import_validation_issues (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision,
  issue_code, severity, blocking_scope, expected_rule, message, status
) values (
  '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000607',
  '40000000-0000-0000-0000-000000000061', 1, 'BLOCK', 'ERROR', 'BATCH',
  'Batch issue must be resolved.', 'Blocked.', 'OPEN'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000607');
  if (v->>'blockingBatchIssues')::integer <> 1 or (v->>'canApply')::boolean then
    raise exception 'OPEN BATCH issue gate failed: %', v;
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000607');
    raise exception 'Expected blocker apply denial.';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
reset role;

-- Trust and OPEN BATCH issue gates independently disable an otherwise NEW preview.
insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename, source_file_hash,
  parser_version, status, validation_revision, row_count, valid_count, remaining_count, created_by,
  source_hash_verification
) values (
  '30000000-0000-0000-0000-000000000603', '10000000-0000-0000-0000-000000000601',
  'MASTER_WORKBOOK', 'MASTER', '__6a_client__.xlsx', repeat('c', 64), 'master-v1',
  'REVIEW_REQUIRED', 1, 1, 1, 1, '00000000-0000-0000-0000-000000000601', 'CLIENT_OBSERVED'
);
insert into public.raw_import_rows (id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells)
values ('40000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000603', 'S', 1, '[]');
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000603', '40000000-0000-0000-0000-000000000021', 1, 1,
  'PRODUCT', 'S', 1, '{}', '{"sabangnetCode":"CLIENT","productName":"Client","category":null,"productType":"SINGLE","variantOfSourceRow":null}', 'VALID');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', false);
do $$ begin
  if (public.preview_master_import_apply('30000000-0000-0000-0000-000000000603')->>'canApply')::boolean then
    raise exception 'CLIENT_OBSERVED batch was applyable.';
  end if;
end $$;
reset role;

-- Force a database error at the last insert and prove Product/SKU/log/batch rollback.
create function pg_temp.reject_6a_component() returns trigger language plpgsql as $$
begin raise exception 'forced component failure'; end $$;
create trigger reject_6a_component before insert on public.product_components
for each row execute function pg_temp.reject_6a_component();

insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename, source_file_hash,
  parser_version, status, validation_revision, row_count, valid_count, remaining_count,
  created_by, source_file_id, source_hash_verification
) values (
  '30000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000601',
  'MASTER_WORKBOOK', 'MASTER', '__6a_rollback__.xlsx', repeat('a', 64), 'master-v1',
  'REVIEW_REQUIRED', 1, 3, 3, 3, '00000000-0000-0000-0000-000000000601',
  '20000000-0000-0000-0000-000000000601', 'SERVER_VERIFIED'
);
insert into public.raw_import_rows (id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells) values
  ('40000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000604', 'R', 1, '[]'),
  ('40000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000604', 'R', 2, '[]'),
  ('40000000-0000-0000-0000-000000000033', '10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000604', 'R', 3, '[]');
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000604', '40000000-0000-0000-0000-000000000031', 1, 1, 'PRODUCT', 'R', 1, '{}', '{"sabangnetCode":"ROLLBACK-P","productName":"Rollback","category":null,"productType":"SET","variantOfSourceRow":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000604', '40000000-0000-0000-0000-000000000032', 1, 2, 'SKU', 'R', 2, '{}', '{"skuCode":"ROLLBACK-S","modelName":"Rollback","color":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000601', '30000000-0000-0000-0000-000000000604', '40000000-0000-0000-0000-000000000033', 1, 3, 'BOM_COMPONENT', 'R', 3, '{}', '{"productCode":"ROLLBACK-P","productSourceRow":1,"skuCode":"ROLLBACK-S","quantity":1}', 'VALID');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', false);
do $$ begin
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000604');
    raise exception 'Expected forced atomic failure.';
  exception when raise_exception then
    if sqlerrm <> 'forced component failure' then raise; end if;
  end;
  if exists (select 1 from public.products where workspace_id = '10000000-0000-0000-0000-000000000601' and sabangnet_code = 'ROLLBACK-P')
     or exists (select 1 from public.skus where workspace_id = '10000000-0000-0000-0000-000000000601' and sku_code = 'ROLLBACK-S')
     or exists (select 1 from public.activity_logs where entity_id = '30000000-0000-0000-0000-000000000604' and action_type = 'IMPORT_APPLIED')
     or (select status from public.import_batches where id = '30000000-0000-0000-0000-000000000604') <> 'REVIEW_REQUIRED' then
    raise exception 'Apply SQL failure did not roll back atomically.';
  end if;
end $$;
reset role;

drop trigger reject_6a_component on public.product_components;
drop function pg_temp.reject_6a_component();

select 'PASS'::text as pilot_master_apply_contract;
rollback;
