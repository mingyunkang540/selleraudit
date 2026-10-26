-- 5F DB metadata and trusted persistence contract. Storage network behavior
-- is intentionally tested against the remote Supabase service, not PGlite.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000401'),
  ('00000000-0000-0000-0000-000000000402'),
  ('00000000-0000-0000-0000-000000000403'),
  ('00000000-0000-0000-0000-000000000404');
insert into public.workspaces (id, name) values
  ('10000000-0000-0000-0000-000000000401', 'Verified source A'),
  ('10000000-0000-0000-0000-000000000402', 'Verified source B');
insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000401', 'ADMIN', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000402', 'EDITOR', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000403', 'VIEWER', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000404', 'ADMIN', 'DISABLED');

do $$
begin
  if (select public from storage.buckets where id = 'seller-audit-import-sources')
    or (select file_size_limit from storage.buckets where id = 'seller-audit-import-sources') <> 52428800
    or not (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'import_source_files')
    or has_table_privilege('authenticated', 'public.import_source_files', 'INSERT')
    or has_table_privilege('authenticated', 'public.import_source_files', 'UPDATE')
    or has_table_privilege('authenticated', 'public.import_source_files', 'DELETE')
    or not has_table_privilege('authenticated', 'public.import_source_files', 'SELECT')
    or has_function_privilege('authenticated', 'public.persist_master_import_dry_run(uuid,text,text,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'seller_audit_private.persist_master_import_dry_run(uuid,text,text,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finalize_master_import_source_verification(uuid,uuid,bigint,text,uuid,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.finalize_master_import_source_verification(uuid,uuid,bigint,text,uuid,text)', 'EXECUTE') then
    raise exception '5F schema, bucket, or privilege boundary failed.';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', false);
do $$
declare v_id uuid; v_path text;
begin
  select source_file_id, object_path into v_id, v_path
  from public.register_master_import_source(
    '10000000-0000-0000-0000-000000000401', '검증.xlsx', 100, repeat('a',64)
  );
  if v_path <> '10000000-0000-0000-0000-000000000401/' || v_id || '/source.xlsx' then
    raise exception 'Opaque source path failed.';
  end if;
  if (select count(*) from public.import_source_files) <> 1 then
    raise exception 'ADMIN source registration not visible.';
  end if;
  insert into storage.objects (bucket_id, name)
    values ('seller-audit-import-sources', v_path);
  if (select count(*) from storage.objects where bucket_id = 'seller-audit-import-sources') <> 0 then
    raise exception 'Authenticated Storage object SELECT leaked.';
  end if;
  begin
    insert into storage.objects (bucket_id, name)
      values ('seller-audit-import-sources',
        '10000000-0000-0000-0000-000000000402/' || v_id || '/source.xlsx');
    raise exception 'Expected cross-workspace Storage INSERT denial.';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name)
      values ('seller-audit-import-sources',
        '10000000-0000-0000-0000-000000000401/' || v_id || '/other.xlsx');
    raise exception 'Expected noncanonical Storage INSERT denial.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_master_import_source(
      '10000000-0000-0000-0000-000000000401', '../bad.xlsx', 100, repeat('a',64));
    raise exception 'Expected filename denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.register_master_import_source(
      '10000000-0000-0000-0000-000000000401', 'bad.xlsx', 0, repeat('a',64));
    raise exception 'Expected size denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.register_master_import_source(
      '10000000-0000-0000-0000-000000000401', 'bad.xlsx', 100, 'BAD');
    raise exception 'Expected hash denial.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.persist_verified_master_import_dry_run(
      '10000000-0000-0000-0000-000000000401', v_id,
      '{"productCount":0,"skuCount":0,"bomCount":0,"validCount":0,"warningCount":0,"errorCount":0,"deferredCount":0}',
      '[]', '[]', '[]');
    raise exception 'Expected pending source denial.';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', false);
select public.register_master_import_source(
  '10000000-0000-0000-0000-000000000401', 'editor.xlsx', 100, repeat('b',64));
do $$
begin
  if (select count(*) from public.import_source_files) <> 2 then
    raise exception 'EDITOR source registration failed.';
  end if;
  begin
    perform public.register_master_import_source(
      '10000000-0000-0000-0000-000000000402', 'foreign.xlsx', 100, repeat('b',64));
    raise exception 'Expected cross-workspace denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', false);
do $$
begin
  if (select count(*) from public.import_source_files) <> 0 then
    raise exception 'VIEWER source detail leaked.';
  end if;
  begin
    perform public.register_master_import_source(
      '10000000-0000-0000-0000-000000000401', 'viewer.xlsx', 100, repeat('c',64));
    raise exception 'Expected VIEWER registration denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000404', false);
do $$
begin
  if (select count(*) from public.import_source_files) <> 0 then
    raise exception 'DISABLED source detail leaked.';
  end if;
  begin
    perform public.register_master_import_source(
      '10000000-0000-0000-0000-000000000401', 'disabled.xlsx', 100, repeat('d',64));
    raise exception 'Expected DISABLED registration denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role service_role;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare v_id uuid; v_status text;
begin
  select id into v_id from public.import_source_files where original_filename = '검증.xlsx';
  v_status := public.finalize_master_import_source_verification(v_id,
    '00000000-0000-0000-0000-000000000401', 100, repeat('a',64), null, null);
  if v_status <> 'VERIFIED' then raise exception 'Server verification failed.'; end if;
  v_status := public.finalize_master_import_source_verification(v_id,
    '00000000-0000-0000-0000-000000000401', 100, repeat('a',64), null, null);
  if v_status <> 'VERIFIED' or (select count(*) from public.activity_logs
    where entity_id = v_id and action_type = 'IMPORT_SOURCE_VERIFIED') <> 1 then
    raise exception 'Server verification not idempotent.';
  end if;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', false);
do $$
declare v_id uuid; v_batch uuid;
begin
  select id into v_id from public.import_source_files where original_filename = '검증.xlsx';
  v_batch := public.persist_verified_master_import_dry_run(
    '10000000-0000-0000-0000-000000000401', v_id,
    '{"productCount":1,"skuCount":0,"bomCount":0,"validCount":1,"warningCount":0,"errorCount":0,"deferredCount":0}',
    '[{"sourceSheet":"S","originalRowNumber":1,"sourceBlock":"S","rawCells":[]}]',
    '[{"kind":"PRODUCT","candidateOrdinal":1,"sourceSheet":"S","sourceRow":1,"sourceBlock":"S","sourceFieldMap":{},"status":"VALID","issueCodes":[],"normalizedValues":{"sabangnetCode":"1","productName":"P","category":null,"productType":null,"rawBomText":null,"sourceQuantity":1,"sourceChannel":null,"variantOfSourceRow":null},"supportingRows":[]}]',
    '[]');
  if not exists (select 1 from public.import_batches where id = v_batch and source_file_id = v_id
    and source_hash_verification = 'SERVER_VERIFIED' and source_file_hash = repeat('a',64)
    and status = 'REVIEW_REQUIRED')
    or (select count(*) from public.import_candidates where import_batch_id = v_batch) <> 1
    or (select count(*) from public.raw_import_rows where import_batch_id = v_batch) <> 1 then
    raise exception 'Verified batch linkage or atomic children failed.';
  end if;
  if (select count(*) from public.products) <> 0
    or (select count(*) from public.skus) <> 0
    or (select count(*) from public.product_components) <> 0 then
    raise exception 'Master write leaked.';
  end if;
end;
$$;
reset role;

-- Existing 5E rows stay readable, but their client-observed hash is not a
-- trust basis for new review mutations after 5F.
set role service_role;
update public.import_batches
set source_file_id = null, source_hash_verification = 'CLIENT_OBSERVED'
where source_filename = '검증.xlsx';
insert into public.import_validation_issues (
  workspace_id, import_batch_id, validation_revision, issue_code,
  severity, blocking_scope, expected_rule, message
)
select workspace_id, id, validation_revision, 'DUPLICATE_BUSINESS_KEY',
  'ERROR', 'CANDIDATE', 'Fixture rule', '5F legacy review fixture'
from public.import_batches where source_filename = '검증.xlsx';
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', false);
do $$
declare v_candidate uuid; v_issue uuid;
begin
  select id into v_candidate from public.import_candidates limit 1;
  select id into v_issue from public.import_validation_issues
    where message = '5F legacy review fixture';
  if v_candidate is null or v_issue is null
    or (select count(*) from public.import_batches
      where source_hash_verification = 'CLIENT_OBSERVED') <> 1 then
    raise exception 'Legacy fixture is not readable.';
  end if;
  begin
    perform public.review_import_candidate(v_candidate, 1, 0,
      '{"productName":"Legacy override"}', 'Legacy review denied');
    raise exception 'Legacy Candidate review was allowed.';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.review_import_validation_issue(v_issue, 1, 0,
      'RESOLVED', 'Legacy review denied');
    raise exception 'Legacy Issue review was allowed.';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;
reset role;

select 'PASS'::text as import_source_verification_contract;
rollback;
