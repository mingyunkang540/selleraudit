begin;

-- Keep exposed RPCs SECURITY INVOKER. Their trusted implementations remain
-- role-checked SECURITY DEFINER functions in the non-exposed private schema.
alter function public.register_master_import_source(uuid, text, bigint, text)
  set schema seller_audit_private;
alter function public.persist_verified_master_import_dry_run(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) set schema seller_audit_private;

alter function public.review_import_candidate(uuid, integer, integer, jsonb, text)
  rename to review_import_candidate_verified;
alter function public.review_import_candidate_verified(uuid, integer, integer, jsonb, text)
  set schema seller_audit_private;
alter function public.review_import_validation_issue(uuid, integer, integer, text, text)
  rename to review_import_validation_issue_verified;
alter function public.review_import_validation_issue_verified(uuid, integer, integer, text, text)
  set schema seller_audit_private;

create function public.register_master_import_source(
  p_workspace_id uuid,
  p_original_filename text,
  p_client_observed_byte_size bigint,
  p_client_observed_sha256 text
)
returns table (source_file_id uuid, bucket text, object_path text)
language sql security invoker set search_path = ''
as $$
  select * from seller_audit_private.register_master_import_source(
    p_workspace_id, p_original_filename,
    p_client_observed_byte_size, p_client_observed_sha256
  );
$$;

create function public.persist_verified_master_import_dry_run(
  p_workspace_id uuid,
  p_source_file_id uuid,
  p_summary jsonb,
  p_raw_rows jsonb,
  p_candidates jsonb,
  p_issues jsonb
)
returns uuid
language sql security invoker set search_path = ''
as $$
  select seller_audit_private.persist_verified_master_import_dry_run(
    p_workspace_id, p_source_file_id, p_summary,
    p_raw_rows, p_candidates, p_issues
  );
$$;

create function public.review_import_candidate(
  p_candidate_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_reviewed_values jsonb,
  p_resolution text
)
returns void
language sql security invoker set search_path = ''
as $$
  select seller_audit_private.review_import_candidate_verified(
    p_candidate_id, p_expected_validation_revision,
    p_expected_review_revision, p_reviewed_values, p_resolution
  );
$$;

create function public.review_import_validation_issue(
  p_issue_id uuid,
  p_expected_validation_revision integer,
  p_expected_review_revision integer,
  p_status text,
  p_resolution text
)
returns void
language sql security invoker set search_path = ''
as $$
  select seller_audit_private.review_import_validation_issue_verified(
    p_issue_id, p_expected_validation_revision,
    p_expected_review_revision, p_status, p_resolution
  );
$$;

revoke all on function public.register_master_import_source(uuid, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.persist_verified_master_import_dry_run(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.review_import_candidate(
  uuid, integer, integer, jsonb, text
) from public, anon, authenticated;
revoke all on function public.review_import_validation_issue(
  uuid, integer, integer, text, text
) from public, anon, authenticated;

grant execute on function public.register_master_import_source(uuid, text, bigint, text)
  to authenticated;
grant execute on function public.persist_verified_master_import_dry_run(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.review_import_candidate(
  uuid, integer, integer, jsonb, text
) to authenticated;
grant execute on function public.review_import_validation_issue(
  uuid, integer, integer, text, text
) to authenticated;

revoke all on function seller_audit_private.register_master_import_source(
  uuid, text, bigint, text
) from public, anon, authenticated;
revoke all on function seller_audit_private.persist_verified_master_import_dry_run(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function seller_audit_private.review_import_candidate_verified(
  uuid, integer, integer, jsonb, text
) from public, anon, authenticated;
revoke all on function seller_audit_private.review_import_validation_issue_verified(
  uuid, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function seller_audit_private.register_master_import_source(
  uuid, text, bigint, text
) to authenticated;
grant execute on function seller_audit_private.persist_verified_master_import_dry_run(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function seller_audit_private.review_import_candidate_verified(
  uuid, integer, integer, jsonb, text
) to authenticated;
grant execute on function seller_audit_private.review_import_validation_issue_verified(
  uuid, integer, integer, text, text
) to authenticated;

commit;
