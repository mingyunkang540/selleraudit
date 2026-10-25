-- SellerAudit Prompt 5A import persistence and role/security contract.
-- Fixtures are isolated in one transaction. Legacy role rows were inserted by
-- run.mjs before the migration so this file can assert the real backfill.

begin;

do $$
declare
  v_roles text[];
  v_statuses text[];
begin
  select array_agg(role order by user_id), array_agg(status order by user_id)
  into v_roles, v_statuses
  from public.workspace_members
  where workspace_id = '10000000-0000-0000-0000-000000000101';

  if v_roles is distinct from array['ADMIN', 'ADMIN', 'VIEWER']::text[]
     or v_statuses is distinct from array['ACTIVE', 'ACTIVE', 'ACTIVE']::text[] then
    raise exception 'Legacy membership migration failed: roles %, statuses %', v_roles, v_statuses;
  end if;

  begin
    update public.workspace_members set role = 'OWNER'
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '00000000-0000-0000-0000-000000000101';
    raise exception 'Expected legacy OWNER role to be rejected.';
  exception when check_violation then null;
  end;

  begin
    update public.workspace_members set role = 'MEMBER'
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '00000000-0000-0000-0000-000000000101';
    raise exception 'Expected legacy MEMBER role to be rejected.';
  exception when check_violation then null;
  end;

  begin
    update public.workspace_members set status = 'UNKNOWN'
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '00000000-0000-0000-0000-000000000101';
    raise exception 'Expected unknown membership status to be rejected.';
  exception when check_violation then null;
  end;

  update public.workspace_members
  set updated_at = '2000-01-01 00:00:00+00'
  where workspace_id = '10000000-0000-0000-0000-000000000101'
    and user_id = '00000000-0000-0000-0000-000000000101';
  if (select updated_at <= '2000-01-01 00:00:00+00'
      from public.workspace_members
      where workspace_id = '10000000-0000-0000-0000-000000000101'
        and user_id = '00000000-0000-0000-0000-000000000101') then
    raise exception 'workspace_members updated_at trigger did not refresh the timestamp.';
  end if;
end;
$$;

do $$
declare
  v_tables text[];
begin
  select array_agg(table_name order by table_name)
  into v_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'activity_logs',
      'import_batches',
      'import_validation_issues',
      'raw_import_rows'
    );

  if v_tables is distinct from array[
    'activity_logs',
    'import_batches',
    'import_validation_issues',
    'raw_import_rows'
  ]::text[] then
    raise exception 'Import foundation tables are incomplete: %', v_tables;
  end if;
end;
$$;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000012'),
  ('00000000-0000-0000-0000-000000000013'),
  ('00000000-0000-0000-0000-000000000014'),
  ('00000000-0000-0000-0000-000000000015'),
  ('00000000-0000-0000-0000-000000000021');

insert into public.workspaces (id, name) values
  ('10000000-0000-0000-0000-000000000011', 'Import Workspace A'),
  ('10000000-0000-0000-0000-000000000021', 'Import Workspace B');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'ADMIN', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', 'EDITOR', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013', 'VIEWER', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000014', 'ADMIN', 'DISABLED'),
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000015', 'VIEWER', 'INVITED'),
  ('10000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000021', 'ADMIN', 'ACTIVE');

insert into public.products (id, workspace_id, sabangnet_code, product_name, product_type) values
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'A-100', 'Workspace A product', 'SINGLE'),
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000021', 'B-100', 'Workspace B product', 'SINGLE');

insert into public.channels (id, workspace_id, channel_code, channel_name) values
  ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'A-CHANNEL', 'A channel'),
  ('40000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000021', 'B-CHANNEL', 'B channel');

insert into public.channel_listings (id, workspace_id, channel_id, channel_product_id, product_name) values
  ('50000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000011', 'A-LIST-1', 'Editor listing'),
  ('50000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000011', 'A-LIST-2', 'Admin listing');

insert into public.channel_offers (id, workspace_id, listing_id, channel_option_id, option_name) values
  ('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000011', 'EDITOR', 'Editor option'),
  ('60000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000012', 'ADMIN', 'Admin option');

insert into public.audit_issues (id, workspace_id, issue_type, severity, listing_id, offer_id, title, description) values
  ('70000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'UNMATCHED', 'WARNING', '50000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000011', 'Editor issue', ''),
  ('70000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', 'UNMATCHED', 'WARNING', '50000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000012', 'Admin issue', '');

insert into public.import_batches (
  id, workspace_id, source_type, source_scope_key, source_filename,
  source_file_hash, parser_version, status, row_count
) values
  ('80000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'MASTER_WORKBOOK', 'MASTER', 'master-a.xlsx', repeat('a', 64), '1.0.0', 'REVIEW_REQUIRED', 1),
  ('80000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', 'MASTER_WORKBOOK', 'MASTER', 'master-a-retry.xlsx', repeat('a', 64), '1.0.0', 'RECEIVED', 1),
  ('80000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000021', 'MASTER_WORKBOOK', 'MASTER', 'master-b.xlsx', repeat('b', 64), '1.0.0', 'READY_TO_APPLY', 1);

insert into public.raw_import_rows (
  id, workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
) values
  ('90000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', '단가표', 6, '[{"address":"B6","value":"100051"}]'),
  ('90000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000012', '단가표', 6, '[{"address":"B6","value":"100051"}]'),
  ('90000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000021', '80000000-0000-0000-0000-000000000021', '단가표', 6, '[{"address":"B6","value":"200051"}]');

insert into public.import_validation_issues (
  id, workspace_id, import_batch_id, raw_import_row_id, issue_code,
  severity, blocking_scope, expected_rule, message
) values
  ('a0000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000011', 'UNKNOWN_SKU', 'ERROR', 'CANDIDATE', 'SKU must exist', 'AL24 is not registered'),
  ('a0000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000021', '80000000-0000-0000-0000-000000000021', '90000000-0000-0000-0000-000000000021', 'DUPLICATE_PRODUCT_CODE', 'ERROR', 'BATCH', 'Product code must be unique', 'Duplicate');

insert into public.activity_logs (
  id, workspace_id, actor_user_id, actor_ref, action_type, entity_type, entity_id, changed_fields
) values
  ('b0000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000011', 'OFFER_MAPPED', 'CHANNEL_OFFER', '60000000-0000-0000-0000-000000000011', '{"master_product_id":{"from":null,"to":"20000000-0000-0000-0000-000000000011"}}'),
  ('b0000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-000000000021', 'IMPORT_CREATED', 'IMPORT_BATCH', '80000000-0000-0000-0000-000000000021', '{}');

-- Database constraints apply to trusted writers as well as authenticated clients.
do $$
begin
  begin
    insert into public.import_batches (
      workspace_id, source_type, source_scope_key, source_filename, source_file_hash, parser_version
    ) values (
      '10000000-0000-0000-0000-000000000011', 'MASTER_WORKBOOK', 'MASTER', 'bad.xlsx', 'abc', '1.0.0'
    );
    raise exception 'Expected malformed SHA-256 to be rejected.';
  exception when check_violation then null;
  end;

  begin
    insert into public.import_batches (
      workspace_id, source_type, source_scope_key, source_filename, source_file_hash, parser_version, row_count
    ) values (
      '10000000-0000-0000-0000-000000000011', 'MASTER_WORKBOOK', 'MASTER', 'negative.xlsx', repeat('c', 64), '1.0.0', -1
    );
    raise exception 'Expected negative import counter to be rejected.';
  exception when check_violation then null;
  end;

  begin
    insert into public.raw_import_rows (
      workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
    ) values (
      '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', '단가표', 6, '[]'
    );
    raise exception 'Expected duplicate batch/sheet/row to be rejected.';
  exception when unique_violation then null;
  end;

  begin
    insert into public.raw_import_rows (
      workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
    ) values (
      '10000000-0000-0000-0000-000000000021', '80000000-0000-0000-0000-000000000011', '단가표', 7, '[]'
    );
    raise exception 'Expected cross-workspace raw-to-batch link to be rejected.';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.raw_import_rows (
      workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
    ) values (
      '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', '단가표', 0, '[]'
    );
    raise exception 'Expected non-positive original row number to be rejected.';
  exception when check_violation then null;
  end;

  begin
    insert into public.raw_import_rows (
      workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
    ) values (
      '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', '단가표', 7, '{}'
    );
    raise exception 'Expected non-array raw_cells to be rejected.';
  exception when check_violation then null;
  end;

  begin
    insert into public.import_validation_issues (
      workspace_id, import_batch_id, raw_import_row_id, issue_code,
      severity, blocking_scope, expected_rule, message
    ) values (
      '10000000-0000-0000-0000-000000000011',
      '80000000-0000-0000-0000-000000000011',
      '90000000-0000-0000-0000-000000000021',
      'CROSS_WORKSPACE', 'ERROR', 'BATCH', 'Same workspace and batch', 'Invalid link'
    );
    raise exception 'Expected cross-workspace validation issue raw link to be rejected.';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.import_validation_issues (
      workspace_id, import_batch_id, issue_code,
      severity, blocking_scope, expected_rule, message
    ) values (
      '10000000-0000-0000-0000-000000000011',
      '80000000-0000-0000-0000-000000000021',
      'CROSS_WORKSPACE_BATCH', 'ERROR', 'BATCH', 'Batch must share the issue workspace', 'Invalid batch link'
    );
    raise exception 'Expected cross-workspace validation issue batch link to be rejected.';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.import_validation_issues (
      workspace_id, import_batch_id, raw_import_row_id, issue_code,
      severity, blocking_scope, expected_rule, message
    ) values (
      '10000000-0000-0000-0000-000000000011',
      '80000000-0000-0000-0000-000000000011',
      '90000000-0000-0000-0000-000000000012',
      'CROSS_BATCH_RAW', 'ERROR', 'BATCH', 'Raw row must share the issue batch', 'Invalid raw batch link'
    );
    raise exception 'Expected cross-batch validation issue raw link to be rejected.';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.activity_logs (
      workspace_id, actor_ref, action_type, entity_type, changed_fields
    ) values (
      '10000000-0000-0000-0000-000000000011', gen_random_uuid(), 'TEST', 'TEST', '[]'
    );
    raise exception 'Expected non-object changed_fields to be rejected.';
  exception when check_violation then null;
  end;

  begin
    delete from public.import_batches
    where id = '80000000-0000-0000-0000-000000000011';
    raise exception 'Expected retained raw/issue history to restrict privileged batch deletion.';
  exception when restrict_violation then null;
  end;

  begin
    delete from public.raw_import_rows
    where id = '90000000-0000-0000-0000-000000000011';
    raise exception 'Expected retained issue history to restrict privileged raw-row deletion.';
  exception when restrict_violation then null;
  end;
end;
$$;

-- ACTIVE VIEWER can read ordinary business data and batch metadata, but not
-- raw/issue details, activity logs, or write RPCs.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', false);
do $$
begin
  if (select count(*) from public.products) <> 1
     or (select count(*) from public.import_batches) <> 2 then
    raise exception 'VIEWER business/batch read contract failed.';
  end if;
  if (select count(*) from public.raw_import_rows) <> 0
     or (select count(*) from public.import_validation_issues) <> 0
     or (select count(*) from public.activity_logs) <> 0 then
    raise exception 'VIEWER saw restricted import details or activity logs.';
  end if;

  begin
    perform public.map_offer('60000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011');
    raise exception 'Expected VIEWER map_offer denial.';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.update_issue_status('70000000-0000-0000-0000-000000000011', 'RESOLVED');
    raise exception 'Expected VIEWER update_issue_status denial.';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;
reset role;

-- ACTIVE EDITOR can read detailed import evidence and use business RPCs, but
-- cannot read activity logs.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
do $$
begin
  if (select count(*) from public.import_batches) <> 2
     or (select count(*) from public.raw_import_rows) <> 2
     or (select count(*) from public.import_validation_issues) <> 1 then
    raise exception 'EDITOR import read contract failed.';
  end if;
  if (select count(*) from public.activity_logs) <> 0 then
    raise exception 'EDITOR saw ADMIN-only activity logs.';
  end if;
end;
$$;
select public.map_offer('60000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011');
select public.update_issue_status('70000000-0000-0000-0000-000000000011', 'OPEN');
reset role;

-- ACTIVE ADMIN can read all scoped import evidence and use both RPCs.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
do $$
begin
  if (select count(*) from public.import_batches) <> 2
     or (select count(*) from public.raw_import_rows) <> 2
     or (select count(*) from public.import_validation_issues) <> 1
     or (select count(*) from public.activity_logs) <> 1 then
    raise exception 'ADMIN import/activity read contract failed.';
  end if;

  if has_table_privilege('authenticated', 'public.import_batches', 'INSERT')
     or has_table_privilege('authenticated', 'public.import_batches', 'UPDATE')
     or has_table_privilege('authenticated', 'public.import_batches', 'DELETE')
     or has_table_privilege('authenticated', 'public.raw_import_rows', 'INSERT')
     or has_table_privilege('authenticated', 'public.raw_import_rows', 'UPDATE')
     or has_table_privilege('authenticated', 'public.raw_import_rows', 'DELETE')
     or has_table_privilege('authenticated', 'public.import_validation_issues', 'INSERT')
     or has_table_privilege('authenticated', 'public.import_validation_issues', 'UPDATE')
     or has_table_privilege('authenticated', 'public.import_validation_issues', 'DELETE')
     or has_table_privilege('authenticated', 'public.activity_logs', 'INSERT')
     or has_table_privilege('authenticated', 'public.activity_logs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.activity_logs', 'DELETE') then
    raise exception 'Authenticated import/activity direct DML privilege is open.';
  end if;

  begin
    insert into public.import_batches (
      workspace_id, source_type, source_scope_key, source_filename, source_file_hash, parser_version
    ) values (
      '10000000-0000-0000-0000-000000000011', 'MASTER_WORKBOOK', 'MASTER', 'client.xlsx', repeat('d', 64), '1.0.0'
    );
    raise exception 'Expected authenticated import batch insert denial.';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.import_batches set status = 'CANCELLED'
    where id = '80000000-0000-0000-0000-000000000011';
    raise exception 'Expected authenticated import batch update denial.';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.import_batches
    where id = '80000000-0000-0000-0000-000000000011';
    raise exception 'Expected authenticated import batch delete denial.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.raw_import_rows (
      workspace_id, import_batch_id, source_sheet, original_row_number, raw_cells
    ) values (
      '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', '단가표', 8, '[]'
    );
    raise exception 'Expected authenticated raw row insert denial.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.import_validation_issues (
      workspace_id, import_batch_id, issue_code, severity, blocking_scope, expected_rule, message
    ) values (
      '10000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011',
      'CLIENT_WRITE', 'ERROR', 'BATCH', 'Trusted writer only', 'Denied'
    );
    raise exception 'Expected authenticated validation issue insert denial.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.activity_logs (
      workspace_id, actor_ref, action_type, entity_type, changed_fields
    ) values (
      '10000000-0000-0000-0000-000000000011', gen_random_uuid(), 'CLIENT_WRITE', 'TEST', '{}'
    );
    raise exception 'Expected authenticated activity log insert denial.';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.activity_logs set changed_fields = '{}'
    where id = 'b0000000-0000-0000-0000-000000000011';
    raise exception 'Expected authenticated activity log update denial.';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.activity_logs
    where id = 'b0000000-0000-0000-0000-000000000011';
    raise exception 'Expected authenticated activity log delete denial.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select public.map_offer('60000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000011');
select public.update_issue_status('70000000-0000-0000-0000-000000000012', 'OPEN');
reset role;

-- DISABLED and INVITED memberships grant no business, import, or RPC access.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000014', false);
do $$
begin
  if (select count(*) from public.products) <> 0
     or (select count(*) from public.import_batches) <> 0 then
    raise exception 'DISABLED member retained read access.';
  end if;
  begin
    perform public.map_offer('60000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011');
    raise exception 'Expected DISABLED map_offer denial.';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.update_issue_status('70000000-0000-0000-0000-000000000011', 'RESOLVED');
    raise exception 'Expected DISABLED update_issue_status denial.';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000015', false);
do $$
begin
  if (select count(*) from public.products) <> 0
     or (select count(*) from public.import_batches) <> 0 then
    raise exception 'INVITED member retained read access.';
  end if;
end;
$$;
reset role;

select 'PASS'::text as import_foundation_contract;

rollback;
