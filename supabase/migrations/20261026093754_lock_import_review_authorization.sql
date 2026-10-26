-- Serialize human-review authorization with membership and batch changes.
-- The original 5E migration is already deployed, so this additive migration
-- replaces only the private SECURITY DEFINER implementations.

create or replace function seller_audit_private.review_import_candidate(
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
  for update of wm, b, c;

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

create or replace function seller_audit_private.review_import_validation_issue(
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
  for update of wm, b, i;

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

-- CREATE OR REPLACE preserves the original signatures and grants. Keep the
-- private entry points closed to untrusted callers if future defaults change.
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
