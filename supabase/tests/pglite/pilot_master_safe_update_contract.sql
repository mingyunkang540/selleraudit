-- Pilot Master Safe Update v1 contract: safe UPDATE classification and diffs,
-- atomic CREATE + UPDATE, immutable business keys, authorization, and audit.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000701'),
  ('00000000-0000-0000-0000-000000000702'),
  ('00000000-0000-0000-0000-000000000703'),
  ('00000000-0000-0000-0000-000000000704'),
  ('00000000-0000-0000-0000-000000000705');

insert into public.workspaces (id, name) values
  ('10000000-0000-0000-0000-000000000701', 'Safe Update Workspace A'),
  ('10000000-0000-0000-0000-000000000702', 'Safe Update Workspace B');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000701', 'ADMIN', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000702', 'EDITOR', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000703', 'VIEWER', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000704', 'VIEWER', 'DISABLED'),
  ('10000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000705', 'ADMIN', 'ACTIVE');

insert into public.import_source_files (
  id, workspace_id, original_filename, storage_object_path,
  client_observed_byte_size, client_observed_sha256,
  server_verified_byte_size, server_verified_sha256,
  server_verified_storage_object_id, verification_status,
  created_by, verified_by, verified_at
) values
  ('20000000-0000-0000-0000-000000000701', '10000000-0000-0000-0000-000000000701',
   '__6b_a__.xlsx', '10000000-0000-0000-0000-000000000701/20000000-0000-0000-0000-000000000701/source.xlsx',
   10, repeat('a', 64), 10, repeat('a', 64), gen_random_uuid(), 'VERIFIED',
   '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000701', now()),
  ('20000000-0000-0000-0000-000000000702', '10000000-0000-0000-0000-000000000702',
   '__6b_b__.xlsx', '10000000-0000-0000-0000-000000000702/20000000-0000-0000-0000-000000000702/source.xlsx',
   10, repeat('b', 64), 10, repeat('b', 64), gen_random_uuid(), 'VERIFIED',
   '00000000-0000-0000-0000-000000000705', '00000000-0000-0000-0000-000000000705', now());

insert into public.products (
  id, workspace_id, sabangnet_code, product_name, category, product_type, normal_price, status
) values (
  '60000000-0000-0000-0000-000000000701', '10000000-0000-0000-0000-000000000701',
  'P-6B', 'Old Product', 'old-category', 'SINGLE', 12000, 'ACTIVE'
);
insert into public.skus (id, workspace_id, sku_code, model_name, color, status) values (
  '70000000-0000-0000-0000-000000000701', '10000000-0000-0000-0000-000000000701',
  'SKU-6B', 'Old Model', 'old-color', 'ACTIVE'
);
insert into public.product_components (id, workspace_id, product_id, sku_id, quantity) values (
  '80000000-0000-0000-0000-000000000701', '10000000-0000-0000-0000-000000000701',
  '60000000-0000-0000-0000-000000000701', '70000000-0000-0000-0000-000000000701', 1
);

-- Every fixture below uses a new Batch. Existing master-only rows omitted from
-- a workbook remain untouched because Apply never scans for deletes.
insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename, source_file_hash,
  parser_version, status, validation_revision, row_count, valid_count, remaining_count,
  created_by, source_file_id, source_hash_verification
) values
  ('30000000-0000-0000-0000-000000000701', '10000000-0000-0000-0000-000000000701',
   'MASTER_WORKBOOK', 'MASTER', '__6b_update__.xlsx', repeat('a', 64), 'master-v1',
   'REVIEW_REQUIRED', 1, 3, 3, 3, '00000000-0000-0000-0000-000000000701',
   '20000000-0000-0000-0000-000000000701', 'SERVER_VERIFIED'),
  ('30000000-0000-0000-0000-000000000702', '10000000-0000-0000-0000-000000000701',
   'MASTER_WORKBOOK', 'MASTER', '__6b_conflict__.xlsx', repeat('a', 64), 'master-v1',
   'REVIEW_REQUIRED', 1, 1, 1, 1, '00000000-0000-0000-0000-000000000701',
   '20000000-0000-0000-0000-000000000701', 'SERVER_VERIFIED'),
  ('30000000-0000-0000-0000-000000000703', '10000000-0000-0000-0000-000000000701',
   'MASTER_WORKBOOK', 'MASTER', '__6b_new_keys__.xlsx', repeat('a', 64), 'master-v1',
   'REVIEW_REQUIRED', 1, 3, 3, 3, '00000000-0000-0000-0000-000000000701',
   '20000000-0000-0000-0000-000000000701', 'SERVER_VERIFIED'),
  ('30000000-0000-0000-0000-000000000704', '10000000-0000-0000-0000-000000000701',
   'MASTER_WORKBOOK', 'MASTER', '__6b_rollback__.xlsx', repeat('a', 64), 'master-v1',
   'REVIEW_REQUIRED', 1, 3, 3, 3, '00000000-0000-0000-0000-000000000701',
   '20000000-0000-0000-0000-000000000701', 'SERVER_VERIFIED'),
  ('30000000-0000-0000-0000-000000000705', '10000000-0000-0000-0000-000000000701',
   'MASTER_WORKBOOK', 'MASTER', '__6b_unchanged__.xlsx', repeat('a', 64), 'master-v1',
   'REVIEW_REQUIRED', 1, 3, 3, 3, '00000000-0000-0000-0000-000000000701',
   '20000000-0000-0000-0000-000000000701', 'SERVER_VERIFIED');

insert into public.raw_import_rows (
  id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
)
select
  ('40000000-0000-0000-' || right(b.id::text, 4) || '-' || lpad(n::text, 12, '0'))::uuid,
  b.workspace_id, b.id, case when n <= 2 then 'MASTER' else 'BOM' end, n, '[]'::jsonb
from public.import_batches b
cross join lateral generate_series(1, b.row_count) n
where b.id in (
  '30000000-0000-0000-0000-000000000701',
  '30000000-0000-0000-0000-000000000702',
  '30000000-0000-0000-0000-000000000703',
  '30000000-0000-0000-0000-000000000704',
  '30000000-0000-0000-0000-000000000705'
);

-- Safe update: reviewed explicit null overrides category/color; only the
-- changed fields may appear in Preview and per-entity ActivityLog evidence.
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status,
  reviewed_values, review_note, review_revision, reviewed_by, reviewed_at
) values
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000701', '40000000-0000-0000-0701-000000000001', 1, 1,
   'PRODUCT', 'MASTER', 1, '{}',
   '{"sabangnetCode":"P-6B","productName":"New Product","category":"ignored","productType":"SINGLE","variantOfSourceRow":null}', 'VALID',
   '{"category":null}', 'clear category', 1, '00000000-0000-0000-0000-000000000701', now()),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000701', '40000000-0000-0000-0701-000000000002', 1, 2,
   'SKU', 'MASTER', 2, '{}',
   '{"skuCode":"SKU-6B","modelName":"New Model","color":"ignored"}', 'VALID',
   '{"color":null}', 'clear color', 1, '00000000-0000-0000-0000-000000000701', now()),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000701', '40000000-0000-0000-0701-000000000003', 1, 3,
   'BOM_COMPONENT', 'BOM', 3, '{}',
   '{"productCode":"P-6B","productSourceRow":1,"skuCode":"SKU-6B","quantity":2}', 'VALID',
   null, null, 0, null, null);

-- Product Type changes remain a blocking conflict.
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000702', '40000000-0000-0000-0702-000000000001', 1, 1,
   'PRODUCT', 'MASTER', 1, '{}',
   '{"sabangnetCode":"P-6B","productName":"Old Product","category":"old-category","productType":"SET","variantOfSourceRow":null}', 'VALID');

-- Business-key changes are NEW rows, never renames of existing rows.
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000703', '40000000-0000-0000-0703-000000000001', 1, 1,
   'PRODUCT', 'MASTER', 1, '{}',
   '{"sabangnetCode":"P-6B-NEW","productName":"Renamed Product","category":null,"productType":"SINGLE","variantOfSourceRow":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000703', '40000000-0000-0000-0703-000000000002', 1, 2,
   'SKU', 'MASTER', 2, '{}',
   '{"skuCode":"SKU-6B-NEW","modelName":"Renamed Model","color":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000703', '40000000-0000-0000-0703-000000000003', 1, 3,
   'BOM_COMPONENT', 'BOM', 3, '{}',
   '{"productCode":"P-6B-NEW","productSourceRow":1,"skuCode":"SKU-6B-NEW","quantity":1}', 'VALID');

set role authenticated;

-- EDITOR may inspect UPDATE diffs but cannot apply them.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000702', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000701');
  if not (v->>'canApply')::boolean
     or (v->>'productUpdate')::integer <> 1
     or (v->>'skuUpdate')::integer <> 1
     or (v->>'bomUpdate')::integer <> 1
     or (select count(*) from jsonb_array_elements(v->'rows') r
         where r->>'status' = 'UPDATE' and r->'changes' <> '{}'::jsonb) <> 3
     or (select r->'changes'->'productName'->>'before' from jsonb_array_elements(v->'rows') r
         where r->>'kind' = 'PRODUCT') <> 'Old Product'
     or (select r->'changes'->'productName'->>'after' from jsonb_array_elements(v->'rows') r
         where r->>'kind' = 'PRODUCT') <> 'New Product'
     or (select r->'changes'->'category'->'after' from jsonb_array_elements(v->'rows') r
         where r->>'kind' = 'PRODUCT') is distinct from 'null'::jsonb
     or (select r->'changes'->'color'->'after' from jsonb_array_elements(v->'rows') r
         where r->>'kind' = 'SKU') is distinct from 'null'::jsonb then
    raise exception 'Safe UPDATE preview or explicit reviewed null failed: %', v;
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000701');
    raise exception 'Expected EDITOR Apply denial.';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000703', false);
do $$ begin
  begin
    perform public.preview_master_import_apply('30000000-0000-0000-0000-000000000701');
    raise exception 'Expected VIEWER denial.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000704', false);
do $$ begin
  begin
    perform public.preview_master_import_apply('30000000-0000-0000-0000-000000000701');
    raise exception 'Expected DISABLED denial.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000705', false);
do $$ begin
  begin
    perform public.preview_master_import_apply('30000000-0000-0000-0000-000000000701');
    raise exception 'Expected cross-workspace denial.';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000702');
  if (v->>'productConflict')::integer <> 1
     or (v->>'canApply')::boolean
     or (select r->>'reason' from jsonb_array_elements(v->'rows') r limit 1)
       <> 'Product Type changes are not applied automatically.' then
    raise exception 'Product Type conflict classification failed: %', v;
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000702');
    raise exception 'Expected conflict Apply denial.';
  exception when object_not_in_prerequisite_state then null;
  end;

  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000703');
  if (v->>'productNew')::integer <> 1
     or (v->>'skuNew')::integer <> 1
     or (v->>'bomNew')::integer <> 1
     or not (v->>'canApply')::boolean then
    raise exception 'Business-key change was not classified as NEW: %', v;
  end if;
  v := public.apply_master_import_batch('30000000-0000-0000-0000-000000000703');
  if (v->>'appliedCount')::integer <> 3
     or (select count(*) from public.products
         where workspace_id = '10000000-0000-0000-0000-000000000701'
           and sabangnet_code in ('P-6B', 'P-6B-NEW')) <> 2
     or (select count(*) from public.skus
         where workspace_id = '10000000-0000-0000-0000-000000000701'
           and sku_code in ('SKU-6B', 'SKU-6B-NEW')) <> 2
     or (select count(*) from public.product_components
         where workspace_id = '10000000-0000-0000-0000-000000000701') <> 2 then
    raise exception 'Business-key NEW Apply renamed or deleted existing Master rows: %', v;
  end if;
end $$;

-- Apply the safe updates and prove UUID preservation, counters, restricted
-- field mutation, per-entity evidence, and summary evidence.
do $$
declare v jsonb;
begin
  v := public.apply_master_import_batch('30000000-0000-0000-0000-000000000701');
  if v->>'finalBatchStatus' <> 'APPLIED'
     or (v->>'appliedCount')::integer <> 3
     or (v->>'remainingCount')::integer <> 0 then
    raise exception 'Safe UPDATE apply counters failed: %', v;
  end if;
  if (select id from public.products where workspace_id = '10000000-0000-0000-0000-000000000701' and sabangnet_code = 'P-6B')
       <> '60000000-0000-0000-0000-000000000701'
     or (select product_name from public.products where id = '60000000-0000-0000-0000-000000000701') <> 'New Product'
     or (select category from public.products where id = '60000000-0000-0000-0000-000000000701') is not null
     or (select product_type from public.products where id = '60000000-0000-0000-0000-000000000701') <> 'SINGLE'
     or (select normal_price from public.products where id = '60000000-0000-0000-0000-000000000701') <> 12000
     or (select id from public.skus where workspace_id = '10000000-0000-0000-0000-000000000701' and sku_code = 'SKU-6B')
       <> '70000000-0000-0000-0000-000000000701'
     or (select model_name from public.skus where id = '70000000-0000-0000-0000-000000000701') <> 'New Model'
     or (select color from public.skus where id = '70000000-0000-0000-0000-000000000701') is not null
     or (select id from public.product_components
         where workspace_id = '10000000-0000-0000-0000-000000000701'
           and product_id = '60000000-0000-0000-0000-000000000701'
           and sku_id = '70000000-0000-0000-0000-000000000701')
       <> '80000000-0000-0000-0000-000000000701'
     or (select quantity from public.product_components where id = '80000000-0000-0000-0000-000000000701') <> 2 then
    raise exception 'Safe UPDATE changed identity, forbidden fields, or wrong values.';
  end if;
  if (select applied_count from public.import_batches where id = '30000000-0000-0000-0000-000000000701') <> 3
     or (select count(*) from public.activity_logs
         where changed_fields->>'sourceBatchId' = '30000000-0000-0000-0000-000000000701'
           and action_type in ('MASTER_PRODUCT_UPDATED', 'MASTER_SKU_UPDATED', 'MASTER_BOM_UPDATED')) <> 3
     or (select count(*) from public.activity_logs
         where entity_id = '30000000-0000-0000-0000-000000000701'
           and action_type = 'IMPORT_APPLIED'
           and changed_fields->>'productUpdated' = '1'
           and changed_fields->>'skuUpdated' = '1'
           and changed_fields->>'bomUpdated' = '1') <> 1
     or exists (
       select 1 from public.activity_logs
       where changed_fields->>'sourceBatchId' = '30000000-0000-0000-0000-000000000701'
         and (changed_fields ? 'reviewNote' or changed_fields ? 'rawCells')
     ) then
    raise exception 'Safe UPDATE audit contract failed.';
  end if;
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000701');
    raise exception 'Expected completed Batch retry denial.';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

-- Populate an UNCHANGED batch after the successful update.
reset role;
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000705', '40000000-0000-0000-0705-000000000001', 1, 1,
   'PRODUCT', 'MASTER', 1, '{}', '{"sabangnetCode":"P-6B","productName":"New Product","category":null,"productType":"SINGLE","variantOfSourceRow":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000705', '40000000-0000-0000-0705-000000000002', 1, 2,
   'SKU', 'MASTER', 2, '{}', '{"skuCode":"SKU-6B","modelName":"New Model","color":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000705', '40000000-0000-0000-0705-000000000003', 1, 3,
   'BOM_COMPONENT', 'BOM', 3, '{}', '{"productCode":"P-6B","productSourceRow":1,"skuCode":"SKU-6B","quantity":2}', 'VALID');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', false);
do $$
declare v jsonb;
begin
  v := public.preview_master_import_apply('30000000-0000-0000-0000-000000000705');
  if (v->>'productUnchanged')::integer <> 1
     or (v->>'skuUnchanged')::integer <> 1
     or (v->>'bomUnchanged')::integer <> 1
     or (v->>'canApply')::boolean then
    raise exception 'UNCHANGED preview contract failed: %', v;
  end if;
end $$;

-- A late BOM SQL failure must roll back earlier Product/SKU updates and every
-- ActivityLog in the transaction.
reset role;
insert into public.import_candidates (
  workspace_id, import_batch_id, raw_import_row_id, validation_revision, candidate_ordinal,
  kind, source_sheet, source_row, source_field_map, normalized_values, candidate_status
) values
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000704', '40000000-0000-0000-0704-000000000001', 1, 1,
   'PRODUCT', 'MASTER', 1, '{}', '{"sabangnetCode":"P-6B","productName":"Must Roll Back","category":"rollback","productType":"SINGLE","variantOfSourceRow":null}', 'VALID'),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000704', '40000000-0000-0000-0704-000000000002', 1, 2,
   'SKU', 'MASTER', 2, '{}', '{"skuCode":"SKU-6B","modelName":"Must Roll Back","color":"rollback"}', 'VALID'),
  ('10000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000704', '40000000-0000-0000-0704-000000000003', 1, 3,
   'BOM_COMPONENT', 'BOM', 3, '{}', '{"productCode":"P-6B","productSourceRow":1,"skuCode":"SKU-6B","quantity":3}', 'VALID');

reset role;
create function pg_temp.reject_6b_component_update() returns trigger language plpgsql as $$
begin raise exception 'forced 6B component update failure'; end $$;
create trigger reject_6b_component_update before update on public.product_components
for each row execute function pg_temp.reject_6b_component_update();
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', false);

do $$ begin
  begin
    perform public.apply_master_import_batch('30000000-0000-0000-0000-000000000704');
    raise exception 'Expected forced 6B rollback.';
  exception when raise_exception then
    if sqlerrm <> 'forced 6B component update failure' then raise; end if;
  end;
  if (select product_name from public.products where id = '60000000-0000-0000-0000-000000000701') <> 'New Product'
     or (select model_name from public.skus where id = '70000000-0000-0000-0000-000000000701') <> 'New Model'
     or (select quantity from public.product_components where id = '80000000-0000-0000-0000-000000000701') <> 2
     or exists (select 1 from public.activity_logs
       where changed_fields->>'sourceBatchId' = '30000000-0000-0000-0000-000000000704')
     or exists (select 1 from public.activity_logs
       where entity_id = '30000000-0000-0000-0000-000000000704' and action_type = 'IMPORT_APPLIED')
     or (select status from public.import_batches where id = '30000000-0000-0000-0000-000000000704') <> 'REVIEW_REQUIRED' then
    raise exception 'Failed safe UPDATE did not roll back Master, logs, and Batch.';
  end if;
end $$;

reset role;
drop trigger reject_6b_component_update on public.product_components;
drop function pg_temp.reject_6b_component_update();

select 'PASS'::text as pilot_master_safe_update_contract;
rollback;
