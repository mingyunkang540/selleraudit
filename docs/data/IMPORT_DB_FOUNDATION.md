# Import DB Foundation and Workspace Roles

## Purpose

`20261025090000_import_foundation_and_roles.sql` adds the database boundary for a future central Import workflow. It does **not** connect the React app to Supabase, persist the browser Dry-run, upload a file, implement an Import writer, or apply Product/SKU/BOM candidates. The app still uses `MockRepository` and `localStorage`.

## WorkspaceMember Role Migration

Existing `OWNER` and `ADMIN` rows become `ADMIN`; existing `MEMBER` rows become `VIEWER`. All existing membership rows become `ACTIVE`. The new `role` and `status` checks permit only `ADMIN/EDITOR/VIEWER` and `INVITED/ACTIVE/DISABLED`. New rows default to `VIEWER` and `INVITED`, so a future trusted administrator must explicitly activate them. `updated_at` changes on role or status updates through the existing timestamp trigger. Membership writes remain unavailable to authenticated clients.

The last ACTIVE ADMIN protection and concurrent role-management workflow belong to a future trusted membership RPC. This migration provides no invitation or role-change API.

## RLS Rules and Role Permission Summary

All existing business tables and the four new tables have RLS. Policies consult the **current** `auth.uid()` and `workspace_members.status = 'ACTIVE'` for the target `workspace_id`; a still-valid Auth session does not restore a disabled membership. Only the member's own ACTIVE membership row is readable. `anon` has no table or business RPC access.

| Operation | ACTIVE ADMIN | ACTIVE EDITOR | ACTIVE VIEWER | INVITED / DISABLED |
| --- | --- | --- | --- | --- |
| Existing business data and `import_batches` SELECT | Yes, own Workspace | Yes, own Workspace | Yes, own Workspace | No |
| `raw_import_rows`, `import_validation_issues` SELECT | Yes, own Workspace | Yes, own Workspace | No | No |
| `activity_logs` SELECT | Yes, own Workspace | No | No | No |
| `map_offer`, `update_issue_status` | Yes, own Workspace | Yes, own Workspace | No | No |
| Import/ActivityLog direct INSERT, UPDATE, DELETE | No | No | No | No |

The existing public RPC names remain stable. Their private `SECURITY DEFINER` implementations now check ACTIVE `ADMIN/EDITOR` against the target row's Workspace before writing; mapping, Alias upsert, and exact-Offer Audit Issue resolution remain one atomic call. Privileged functions use an empty `search_path`, schema-qualified objects, and restricted `EXECUTE` grants. The new membership helper only answers whether the **current actor** holds one of the requested roles in the given Workspace.

## New Tables and Import Write Boundary

| Table | Purpose | Main constraints |
| --- | --- | --- |
| `import_batches` | One Import attempt and lifecycle counters | Workspace key; source/status checks; nonblank scope, filename, parser version; lowercase 64-character SHA-256; nonnegative counters |
| `raw_import_rows` | Immutable physical source-row evidence | Same-Workspace Batch FK; unique `(import_batch_id, source_sheet, original_row_number)`; positive row number; `raw_cells` JSON array |
| `import_validation_issues` | Pre-Apply source-data findings, separate from `audit_issues` | Same-Workspace and same-Batch composite FKs; revision, severity, blocking scope and status checks; nonblank code/rule/message |
| `activity_logs` | Human action history, separate from both Issue tables | Workspace key; required opaque `actor_ref`; `changed_fields` JSON object; nullable Auth actor FK |

`import_batches` permits repeated attempts for the same `(workspace_id, source_type, source_scope_key, source_file_hash)`; the combination is indexed for lookup, **not unique**. Apply idempotency and lifecycle transitions are not implemented. The Issue `related_raw_row_ids` UUID array has no element-level FK; a future trusted writer must verify that every referenced row belongs to the same Workspace and Batch. The DB stores no original Excel binary or Storage object. A browser-provided SHA-256 is not proof of a stored server-side file.

No authenticated role has direct DML on Import or ActivityLog tables. Future trusted writers must validate the source catalog, candidate decisions, transition rules, actor, and file hash before writing. `activity_logs.changed_fields` is reserved for changed-field summaries, never full row snapshots, raw Excel rows, passwords, tokens, service keys, or complete files. The schema alone cannot inspect JSON contents for every prohibited value; the future writer must enforce that privacy contract.

## Index and Delete / Retention Policy

The migration adds Batch indexes for Workspace chronology, Workspace status, and nonunique source/hash lookup; Issue indexes for Workspace/Batch, Workspace/status, and Batch/revision; ActivityLog indexes for Workspace chronology and Workspace/action chronology. Partial indexes on non-null `created_by`, `reviewed_by`, and `actor_user_id` support the Auth-user foreign keys and `ON DELETE SET NULL` handling. Existing `workspace_members_user_id_idx` and Raw composite unique indexes serve membership lookup and Raw FK lookup without redundant indexes.

New historical Workspace, Batch, Raw and Issue relationships use `ON DELETE RESTRICT`. Auth user references (`created_by`, `reviewed_by`, `actor_user_id`) use `ON DELETE SET NULL`, while ActivityLog's opaque `actor_ref` remains. Authenticated clients cannot delete these records. Retention duration, legal deletion/export, and a privileged purge procedure are **not** defined; a later trusted process must delete in an explicit Issue → Raw → Batch → Workspace order after approval and backup checks. Existing Foundation FK delete policies are unchanged by this migration.

## Security Decisions and Tests

The isolated PGlite contract checks sequential migration and conservative role/status backfill; ACTIVE versus INVITED/DISABLED reads; ADMIN/EDITOR versus VIEWER RPC calls; cross-Workspace and cross-Batch composite FKs; Raw and Issue confidentiality; ADMIN-only log reads; direct write denial; Raw uniqueness; hash/quantity checks; and the original mapping atomicity. PGlite does not emulate the Supabase Auth service, PostgREST, project Data API exposure settings, or a production backup/restore run. The existing `public` grants are explicit; a future project must verify its Data API exposure configuration separately.

## Current Stop Line

Only DB schema, RLS, grants, RPC authorization hardening, and local contract tests are in scope. No Supabase project is connected, and no Auth UI, employee account, Storage bucket, Import upload/writer/Apply, ActivityLog event recording, or company deployment is provided. The [Internal Pilot readiness gate](../INTERNAL_PILOT_ARCHITECTURE.md#9-pilot-readiness-gate) remains open.
