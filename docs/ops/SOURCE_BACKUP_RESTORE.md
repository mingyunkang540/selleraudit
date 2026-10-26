# Master source backup and exact-path recovery rehearsal (5G)

This procedure backs up one `VERIFIED` Master Workbook SourceFile and rehearses recovery of a dedicated development fixture. A [Supabase Database backup](https://supabase.com/docs/guides/platform/backups) covers Storage metadata, not Storage object bytes. `.seller-audit-backups` is a local rehearsal artifact, not an off-site, durable, or production backup.

## Trusted boundary

Run from the repository root in a trusted local terminal. Put `SELLERAUDIT_OPS_SUPABASE_URL`, `SELLERAUDIT_OPS_PROJECT_REF`, `SELLERAUDIT_OPS_PROJECT_NAME`, and `SELLERAUDIT_OPS_SUPABASE_SECRET_KEY` in ignored `.env.ops.local`; never use a `VITE_` prefix. Values must identify `selleraudit-dev` / `yzpkhvuftusnshdqfnim`. Keep the file private. The secret key is used only by these local scripts. They check the authenticated Supabase CLI project list before destructive work and never print the key or signed URL. The normal application uses its existing public key and ADMIN Auth session.

## Backup one SourceFile

```powershell
node scripts/ops/backup-master-source.mjs --source-file-id <uuid>
```

The command requires `source_type=MASTER_WORKBOOK`, `verification_status=VERIFIED`, server SHA-256 and byte size, and the expected private bucket/path. It downloads precisely that object and verifies both byte facts against the DB row. It writes `.seller-audit-backups/<sourceFileId>/source.xlsx` and `manifest.json` through a partial directory, then renames only after verification. An existing backup directory stops the command; there is no overwrite switch. The original filename is metadata only, never a filesystem path component.

Manifest version 1 records project ref, SourceFile/workspace IDs, bucket and exact object path, original filename, server-verified and backup SHA-256/size, and backup timestamp. It has no credentials, session tokens, Authorization headers, or signed URLs. Keep the binary and manifest together; a manifest without matching bytes is unusable.

## Development fixture rehearsal and retry

```powershell
$env:SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL='YES'
node scripts/ops/remote-5g-recovery-acceptance.mjs
Remove-Item Env:SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL
```

The acceptance command creates a small `__SELLERAUDIT_5G_RECOVERY__*.xlsx` through the existing ADMIN register → private upload → Edge verification flow. It creates no ImportBatch. It backs up the exact source, rechecks the manifest and bytes, removes that one Storage object through the [Storage API](https://supabase.com/docs/guides/storage/management/delete-objects), confirms absence, and uploads the same bytes at the same bucket/path with `upsert: false`. It then downloads the object through trusted Storage access and the existing ADMIN signed-download function, checking SHA-256 and size in both cases. It compares the SourceFile row before/after and checks unrelated source count and workspace object-folder inventory. Only after full verification does it delete the exact fixture object, recorded ActivityLog IDs, SourceFile ID, and local fixture backup. The private evidence file in `%TEMP%` holds IDs and stage for failure recovery; it contains no secret. An existing evidence file blocks a second acceptance run.

For an interrupted restore, retain the original backup directory and evidence file. Inspect the printed `RECOVERY REQUIRED` metadata and resolve the cause. Retry only the same fixture, manifest, bytes, bucket, and object path:

```powershell
$env:SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL='YES'
node scripts/ops/restore-master-source-rehearsal.mjs --source-file-id <fixture-uuid>
Remove-Item Env:SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL
```

Retry checks whether the exact object is already present. Matching bytes count as already restored; different bytes stop the command. It never overwrites. `--delete-first` is reserved for a fresh fixture rehearsal when the verified object is still present; it removes only that exact object and checks absence before upload. A failed restore after deletion prints `RECOVERY REQUIRED` with safe IDs/path/hash/size/error code and preserves the backup. Do not delete the backup until trusted and signed-download checks succeed.

If acceptance stops during fixture registration, the evidence file retains the unique filename written before the RPC. Run `node scripts/ops/remote-5g-recovery-acceptance.mjs --reconcile` to look up the exact Workspace + filename and recover the SourceFile ID/path. This read-only command does not delete or resume the fixture.

Cleanup is limited to the exact recorded fixture IDs/path and happens only after successful recovery checks. If acceptance stops partway through cleanup, use the `%TEMP%` evidence file to inspect the exact remaining IDs. Do not sweep a prefix or a folder. Use Storage API deletion rather than SQL deletion of `storage.objects`.

The DB `verification_status=VERIFIED` records successful verification at a point in time. It can remain `VERIFIED` while an object is missing after privileged deletion; it is not a continuous integrity monitor. Future source revalidation and review consistency work must address that separately. This 5G procedure adds no migration, RLS policy, Edge Function, UI change, scheduler, retention cleanup, or Apply flow. Before production use, choose a durable/off-site destination, retention and access policy, restore drills, and operational ownership. The existing leaked-password-protection warning remains a separate pre-Pilot decision.
