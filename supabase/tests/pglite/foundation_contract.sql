-- SellerAudit Foundation contract assertions.
--
-- This script is executed by the documented PGlite QA harness after the
-- migration and auth/role compatibility prelude have been loaded. It runs in
-- one transaction and rolls back every fixture.

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

insert into public.workspaces (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Workspace 1'),
  ('10000000-0000-0000-0000-000000000002', 'Workspace 2');

-- These fixtures exercise the post-migration permission model. The legacy
-- OWNER/ADMIN/MEMBER backfill is seeded before the new migration by run.mjs.
insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'ADMIN', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'ADMIN', 'ACTIVE');

insert into public.products (
  id,
  workspace_id,
  sabangnet_code,
  product_name,
  product_type,
  normal_price
) values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '100051',
    '점보 쿨라벤더 1개',
    'SINGLE',
    13300
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    '200051',
    'Other workspace product',
    'SINGLE',
    10000
  );

insert into public.skus (id, workspace_id, sku_code, model_name) values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AL00',
    '점보'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'ZZ00',
    'Other'
  );

insert into public.channels (id, workspace_id, channel_code, channel_name) values
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'NAVER',
    '네이버'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'WCONCEPT',
    'Other workspace channel'
  );

insert into public.channel_listings (
  id,
  workspace_id,
  channel_id,
  channel_product_id,
  product_name
) values
  (
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'N-100',
    '  채널 원문 상품명  '
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    'W-100',
    'Other workspace listing'
  );

insert into public.channel_offers (
  id,
  workspace_id,
  listing_id,
  channel_option_id,
  option_name,
  sale_price
) values
  (
    '60000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    null,
    '  옵션 원문  ',
    12900
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    'SECOND',
    '다른 미매핑 옵션',
    11900
  ),
  (
    '60000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000002',
    'BASE',
    null,
    10000
  );

insert into public.audit_issues (
  id,
  workspace_id,
  issue_type,
  severity,
  listing_id,
  offer_id,
  title,
  description,
  status
) values
  (
    '70000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'UNMATCHED',
    'WARNING',
    '50000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'Exact offer issue',
    'Should resolve when the exact offer is mapped.',
    'OPEN'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'UNMATCHED',
    'WARNING',
    '50000000-0000-0000-0000-000000000001',
    null,
    'Listing issue',
    'Must remain open while matching is offer-specific.',
    'OPEN'
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'UNMATCHED',
    'INFO',
    '50000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'Ignored exact offer issue',
    'A user decision must not be overwritten by mapping.',
    'IGNORED'
  ),
  (
    '70000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000002',
    'UNMATCHED',
    'WARNING',
    '50000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000003',
    'Other workspace issue',
    'Must not be changed by workspace A.',
    'OPEN'
  );

do $$
begin
  begin
    insert into public.product_components (workspace_id, product_id, sku_id, quantity)
    values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      1
    );
    raise exception 'Expected cross-workspace FK violation.';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.product_components (workspace_id, product_id, sku_id, quantity)
    values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      0
    );
    raise exception 'Expected positive quantity check violation.';
  exception
    when check_violation then null;
  end;

  begin
    update public.products
    set normal_price = -1
    where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'Expected nonnegative price check violation.';
  exception
    when check_violation then null;
  end;
end;
$$;

set role anon;

do $$
begin
  begin
    perform 1 from public.products;
    raise exception 'Expected anonymous product access to be denied.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.map_offer(
      '60000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Expected anonymous RPC access to be denied.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.products;
  if v_count <> 0 then
    raise exception 'Missing auth identity exposed % product rows.', v_count;
  end if;

  begin
    perform public.map_offer(
      '60000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Expected map_offer without auth identity to fail.';
  exception
    when sqlstate 'P0002' then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  false
);

do $$
declare
  v_codes text[];
begin
  select array_agg(sabangnet_code order by sabangnet_code)
  into v_codes
  from public.products;

  if v_codes is distinct from array['100051']::text[] then
    raise exception 'RLS tenant isolation failed: %', v_codes;
  end if;

  begin
    insert into public.workspace_members (workspace_id, user_id)
    values (
      '10000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001'
    );
    raise exception 'Expected member self-enrollment to be denied.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.products
    set normal_price = 1
    where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'Expected non-RPC product write to be denied.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.channel_offers
    set master_product_id = '20000000-0000-0000-0000-000000000001'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Expected direct Offer mapping to be denied.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.aliases (
      workspace_id, raw_product_name, raw_option_name, source_channel, master_product_id
    ) values (
      '10000000-0000-0000-0000-000000000001', 'Direct alias', null, 'NAVER',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Expected direct Alias insert to be denied.';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.audit_issues set status = 'RESOLVED'
    where id = '70000000-0000-0000-0000-000000000001';
    raise exception 'Expected direct Issue update to be denied.';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.map_offer(
      '60000000-0000-0000-0000-000000000003',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Expected cross-workspace Offer mapping to be denied.';
  exception when sqlstate 'P0002' then null;
  end;

  begin
    perform public.map_offer(
      '60000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002'
    );
    raise exception 'Expected cross-workspace Product mapping to be denied.';
  exception when foreign_key_violation then null;
  end;

  begin
    perform public.update_issue_status('70000000-0000-0000-0000-000000000004', 'RESOLVED');
    raise exception 'Expected cross-workspace Issue update to be denied.';
  exception when sqlstate 'P0002' then null;
  end;

  if has_column_privilege('authenticated', 'public.channel_offers', 'master_product_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.audit_issues', 'status', 'UPDATE')
     or has_column_privilege('authenticated', 'public.aliases', 'master_product_id', 'INSERT')
     or not has_function_privilege('authenticated', 'public.map_offer(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_issue_status(uuid, text)', 'EXECUTE')
     or has_schema_privilege('anon', 'seller_audit_private', 'USAGE') then
    raise exception 'RPC-only privilege boundary is inconsistent.';
  end if;
end;
$$;

reset role;

create function pg_temp.reject_alias_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Forced alias failure for atomicity test.' using errcode = 'P9001';
end;
$$;

create trigger aliases_force_failure
before insert on public.aliases
for each row execute function pg_temp.reject_alias_insert();

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  false
);

do $$
declare
  v_master_product_id uuid;
  v_alias_count integer;
  v_issue_status text;
begin
  begin
    perform public.map_offer(
      '60000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Expected forced alias failure.';
  exception
    when sqlstate 'P9001' then null;
  end;

  select master_product_id
  into v_master_product_id
  from public.channel_offers
  where id = '60000000-0000-0000-0000-000000000001';

  select count(*)
  into v_alias_count
  from public.aliases;

  select status
  into v_issue_status
  from public.audit_issues
  where id = '70000000-0000-0000-0000-000000000001';

  if v_master_product_id is not null or v_alias_count <> 0 or v_issue_status <> 'OPEN' then
    raise exception 'map_offer did not roll back atomically after alias failure.';
  end if;
end;
$$;

reset role;
drop trigger aliases_force_failure on public.aliases;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  false
);

select public.map_offer(
  '60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001'
);

do $$
declare
  v_offer public.channel_offers%rowtype;
  v_exact_status text;
  v_exact_resolved_at timestamptz;
  v_listing_status text;
  v_ignored_status text;
  v_alias public.aliases%rowtype;
begin
  select * into v_offer
  from public.channel_offers
  where id = '60000000-0000-0000-0000-000000000001';

  select status, resolved_at
  into v_exact_status, v_exact_resolved_at
  from public.audit_issues
  where id = '70000000-0000-0000-0000-000000000001';

  select status into v_listing_status
  from public.audit_issues
  where id = '70000000-0000-0000-0000-000000000002';

  select status into v_ignored_status
  from public.audit_issues
  where id = '70000000-0000-0000-0000-000000000003';

  select * into v_alias
  from public.aliases
  where master_product_id = '20000000-0000-0000-0000-000000000001';

  if v_offer.master_product_id <> '20000000-0000-0000-0000-000000000001'
     or v_offer.channel_option_id <> 'BASE'
     or v_exact_status <> 'RESOLVED'
     or v_exact_resolved_at is null
     or v_listing_status <> 'OPEN'
     or v_ignored_status <> 'IGNORED'
     or v_alias.raw_product_name <> '  채널 원문 상품명  '
     or v_alias.raw_option_name <> '  옵션 원문  '
     or v_alias.source_channel <> 'NAVER' then
    raise exception 'map_offer contract assertion failed.';
  end if;
end;
$$;

select public.update_issue_status(
  '70000000-0000-0000-0000-000000000001',
  'OPEN'
);

do $$
declare
  v_status text;
  v_resolved_at timestamptz;
begin
  select status, resolved_at
  into v_status, v_resolved_at
  from public.audit_issues
  where id = '70000000-0000-0000-0000-000000000001';

  if v_status <> 'OPEN' or v_resolved_at is not null then
    raise exception 'Reopening an issue did not clear resolved_at.';
  end if;

  begin
    perform public.update_issue_status(
      '70000000-0000-0000-0000-000000000001',
      null
    );
    raise exception 'Expected NULL status to be rejected.';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

select public.update_issue_status(
  '70000000-0000-0000-0000-000000000001',
  'RESOLVED'
);

do $$
declare
  v_status text;
  v_resolved_at timestamptz;
begin
  select status, resolved_at
  into v_status, v_resolved_at
  from public.audit_issues
  where id = '70000000-0000-0000-0000-000000000001';

  if v_status <> 'RESOLVED' or v_resolved_at is null then
    raise exception 'Resolving an issue did not set resolved_at.';
  end if;
end;
$$;

reset role;

-- Missing-channel issues retain an explicit target without inventing a listing.
insert into public.channels (id, workspace_id, channel_code, channel_name)
values ('40000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000001', 'COUPANG', '쿠팡');

insert into public.audit_issues
  (workspace_id, product_id, channel_id, issue_type, severity, title, description)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001', 'MISSING_CHANNEL', 'WARNING', '채널 누락 검증', 'No listing exists.');

do $$
begin
  begin
    insert into public.audit_issues
      (workspace_id, product_id, channel_id, issue_type, severity, title, description)
    values
      ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
       '40000000-0000-0000-0000-000000000002', 'MISSING_CHANNEL', 'WARNING', 'Invalid tenant', '');
    raise exception 'Expected cross-workspace issue channel FK rejection.';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.audit_issues
      (workspace_id, listing_id, channel_id, issue_type, severity, title, description)
    values
      ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
       '40000000-0000-0000-0000-000000000003', 'CHANGED_LISTING', 'WARNING', 'Wrong channel', '');
    raise exception 'Expected same-workspace issue channel/listing mismatch rejection.';
  exception when foreign_key_violation then null;
  end;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
begin
  if (select count(*) from public.audit_issues
      where channel_id = '40000000-0000-0000-0000-000000000001'
      and issue_type = 'MISSING_CHANNEL' and listing_id is null) <> 1 then
    raise exception 'Missing-channel issue cannot be filtered by its target channel.';
  end if;
end;
$$;
reset role;

-- A different member can write only within their own workspace through RPCs.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.map_offer(
  '60000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000002'
);
select public.update_issue_status('70000000-0000-0000-0000-000000000004', 'IN_PROGRESS');
do $$
begin
  if (select master_product_id from public.channel_offers
      where id = '60000000-0000-0000-0000-000000000003')
       <> '20000000-0000-0000-0000-000000000002'
     or (select status from public.audit_issues
      where id = '70000000-0000-0000-0000-000000000004') <> 'IN_PROGRESS' then
    raise exception 'Workspace B member RPC write failed.';
  end if;
end;
$$;
reset role;

select 'PASS'::text as foundation_contract;

rollback;
