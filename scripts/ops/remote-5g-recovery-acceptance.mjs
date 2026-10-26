/* global process, Buffer, fetch */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, unlink, rmdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import {
  assert, backupSource, BUCKET, CONTENT_TYPE, digest, FIXTURE_PREFIX, loadOps,
  objectBytesOrNull, parseEnv, PROJECT_REF, PROJECT_URL, removeExactObject,
  restoreSource, safeError, verifyRemoteProject, fetchSource, readBackup, assertBytes,
  writeEvidenceSnapshot,
} from './_shared/sourceRecovery.mjs'

const workspaceId = 'bfa4dc64-f4f9-428e-b8f9-61ff36d27db8'
const evidencePath = resolve(process.env.TEMP ?? '.', 'selleraudit-5g-recovery-acceptance.json')
let evidence = { projectRef: PROJECT_REF, workspaceId, stage: 'PRECHECK', sourceFileId: null }
let evidenceReserved = false

async function save() {
  await writeEvidenceSnapshot(evidencePath, evidence, !evidenceReserved)
  evidenceReserved = true
}
async function sourceCount(admin) {
  const { count, error } = await admin.from('import_source_files').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
  assert(!error && Number.isInteger(count), 'SOURCE_COUNT_FAILED')
  return count
}
async function objectFolderNames(admin) {
  const { data, error } = await admin.storage.from(BUCKET).list(workspaceId, { limit: 1000 })
  assert(!error && Array.isArray(data) && data.length < 1000, 'OBJECT_INVENTORY_FAILED')
  return data.map(item => item.name).sort()
}
async function logIds(admin, id) {
  const { data, error } = await admin.from('activity_logs').select('id,workspace_id,action_type,entity_type,entity_id')
    .eq('workspace_id', workspaceId).eq('entity_id', id)
  assert(!error && Array.isArray(data), 'ACTIVITY_LOOKUP_FAILED')
  assert(data.every(row => row.action_type === 'IMPORT_SOURCE_VERIFIED' &&
    row.entity_type === 'IMPORT_SOURCE_FILE' && row.entity_id === id), 'UNEXPECTED_ACTIVITY')
  return data.map(row => row.id)
}
async function reconcile() {
  assert(existsSync(evidencePath), 'ACCEPTANCE_EVIDENCE_MISSING')
  const recorded = JSON.parse(await readFile(evidencePath, 'utf8'))
  const { admin, env } = await loadOps()
  verifyRemoteProject(env)
  assert(recorded.projectRef === PROJECT_REF && recorded.workspaceId === workspaceId &&
    typeof recorded.originalFilename === 'string' &&
    recorded.originalFilename.startsWith(FIXTURE_PREFIX), 'RECONCILE_EVIDENCE_INVALID')
  const { data, error } = await admin.from('import_source_files')
    .select('id,workspace_id,original_filename,storage_bucket,storage_object_path')
    .eq('workspace_id', workspaceId).eq('original_filename', recorded.originalFilename)
  assert(!error && Array.isArray(data) && data.length <= 1, 'RECONCILE_AMBIGUOUS')
  const source = data[0]
  if (source) {
    assert(source.storage_bucket === BUCKET &&
      source.storage_object_path === `${workspaceId}/${source.id}/source.xlsx` &&
      (!recorded.sourceFileId || recorded.sourceFileId === source.id), 'RECONCILE_PATH_MISMATCH')
  }
  process.stdout.write(`RECONCILE stage=${recorded.stage} sourceFileId=${source?.id ?? 'absent'} ` +
    `filename=${recorded.originalFilename} objectPath=${source?.storage_object_path ?? 'absent'}\n`)
}
async function main() {
  assert(process.argv.length === 2, 'USAGE_NO_ARGUMENTS_EXPECTED')
  assert(!existsSync(evidencePath), 'EXISTING_ACCEPTANCE_EVIDENCE')
  const { admin, env } = await loadOps()
  verifyRemoteProject(env)
  assert(process.env.SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL === 'YES', 'DESTRUCTIVE_FLAG_MISSING')
  const app = parseEnv(await readFile(resolve('.env.local'), 'utf8'))
  const qa = parseEnv(await readFile(resolve('.env.remote-test.local.txt'), 'utf8'))
  assert(app.VITE_SUPABASE_URL === PROJECT_URL && app.VITE_SUPABASE_PUBLISHABLE_KEY, 'WRONG_PROJECT')
  const client = createClient(PROJECT_URL, app.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: login, error: loginError } = await client.auth.signInWithPassword({
    email: qa.SELLERAUDIT_ADMIN_EMAIL, password: qa.SELLERAUDIT_ADMIN_PASSWORD,
  })
  assert(!loginError && login?.session && login?.user, 'ADMIN_AUTH_FAILED')
  const beforeCount = await sourceCount(admin)
  const beforeFolders = await objectFolderNames(admin)
  evidence = { ...evidence, beforeCount, beforeFolders, stage: 'ADMIN_AUTH_PASS' }
  await save()

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['5G recovery fixture'], ['exact path restore']]), '단가표')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const hash = digest(bytes)
  const filename = `${FIXTURE_PREFIX}${randomUUID()}.xlsx`
  evidence = { ...evidence, originalFilename: filename, stage: 'REGISTERING' }
  await save()
  const { data: registered, error: registerError } = await client.rpc('register_master_import_source', {
    p_workspace_id: workspaceId, p_original_filename: filename,
    p_client_observed_byte_size: bytes.length, p_client_observed_sha256: hash,
  })
  assert(!registerError && Array.isArray(registered) && registered.length === 1, 'FIXTURE_REGISTER_FAILED')
  const result = registered[0]
  assert(result.bucket === BUCKET && result.object_path === `${workspaceId}/${result.source_file_id}/source.xlsx`,
    'FIXTURE_PATH_INVALID')
  evidence = { ...evidence, sourceFileId: result.source_file_id, bucket: result.bucket,
    objectPath: result.object_path, originalFilename: filename, stage: 'REGISTERED' }
  await save()
  const upload = await client.storage.from(BUCKET).upload(result.object_path, bytes,
    { contentType: CONTENT_TYPE, upsert: false })
  assert(!upload.error, 'FIXTURE_UPLOAD_FAILED')
  evidence.stage = 'UPLOADED'; await save()
  const { data: verified, error: verifyError } = await client.functions.invoke('verify-master-import-source',
    { body: { sourceFileId: result.source_file_id } })
  assert(!verifyError && verified?.status === 'VERIFIED' && verified.serverSha256 === hash &&
    verified.serverByteSize === bytes.length, 'FIXTURE_VERIFY_FAILED')
  const rowBefore = await fetchSource(admin, result.source_file_id)
  evidence.stage = 'VERIFIED'; await save()
  process.stdout.write(`FIXTURE VERIFIED sourceFileId=${rowBefore.id} objectPath=${rowBefore.storage_object_path}\n`)

  const backup = await backupSource(admin, rowBefore.id)
  const checked = await readBackup(rowBefore)
  assert(backup.manifest.backupSha256 === hash && checked.manifest.backupByteSize === bytes.length,
    'BACKUP_INTEGRITY_FAILED')
  evidence = { ...evidence, backupSha256: backup.manifest.backupSha256,
    backupByteSize: backup.manifest.backupByteSize, backupDirectory: backup.directory, stage: 'BACKED_UP' }
  await save()
  process.stdout.write(`BACKUP VERIFIED sha256=${hash} bytes=${bytes.length}\n`)
  await restoreSource(admin, env, rowBefore.id, { deleteFirst: true })
  evidence.stage = 'RESTORED'; await save()
  const rowAfter = await fetchSource(admin, rowBefore.id)
  assert(JSON.stringify(rowAfter) === JSON.stringify(rowBefore), 'SOURCE_METADATA_CHANGED')
  const actual = await objectBytesOrNull(admin, rowAfter)
  assert(actual !== null, 'RESTORED_OBJECT_MISSING')
  assertBytes(actual, hash, bytes.length)
  process.stdout.write(`EXACT DELETE/MISSING/RESTORE PASS objectPath=${rowAfter.storage_object_path}\n`)

  const signedResult = await client.functions.invoke('create-master-source-download-url',
    { body: { sourceFileId: rowAfter.id } })
  assert(!signedResult.error && signedResult.data?.expiresIn === 60 &&
    typeof signedResult.data.url === 'string', 'SIGNED_URL_FAILED')
  const response = await fetch(signedResult.data.url)
  assert(response.ok, 'SIGNED_DOWNLOAD_FAILED')
  assertBytes(Buffer.from(await response.arrayBuffer()), hash, bytes.length)
  evidence.stage = 'SIGNED_DOWNLOAD_VERIFIED'; await save()
  process.stdout.write('ADMIN SIGNED DOWNLOAD HASH/SIZE PASS\n')

  const batches = await admin.from('import_batches').select('id').eq('source_file_id', rowAfter.id)
  assert(!batches.error && batches.data.length === 0, 'FIXTURE_REFERENCED_BY_BATCH')
  const logs = await logIds(admin, rowAfter.id)
  evidence.activityLogIds = logs; evidence.stage = 'CLEANUP_READY'; await save()
  verifyRemoteProject(env)
  await removeExactObject(admin, rowAfter)
  assert(await objectBytesOrNull(admin, rowAfter) === null, 'CLEANUP_OBJECT_STILL_PRESENT')
  evidence.stage = 'OBJECT_CLEANED'; await save()
  for (const id of logs) {
    const removed = await admin.from('activity_logs').delete().eq('id', id)
      .eq('workspace_id', workspaceId).eq('entity_id', rowAfter.id).select('id')
    assert(!removed.error && removed.data.length === 1, 'ACTIVITY_CLEANUP_FAILED')
  }
  evidence.stage = 'LOGS_CLEANED'; await save()
  const removed = await admin.from('import_source_files').delete().eq('id', rowAfter.id)
    .eq('workspace_id', workspaceId).select('id')
  assert(!removed.error && removed.data.length === 1, 'SOURCE_CLEANUP_FAILED')
  evidence.stage = 'SOURCE_CLEANED'; await save()
  const sourceCheck = await admin.from('import_source_files').select('id').eq('id', rowAfter.id)
  assert(!sourceCheck.error && sourceCheck.data.length === 0 &&
    await objectBytesOrNull(admin, rowAfter) === null &&
    (await logIds(admin, rowAfter.id)).length === 0, 'EXACT_CLEANUP_VERIFICATION_FAILED')
  assert((await sourceCount(admin)) === beforeCount &&
    JSON.stringify(await objectFolderNames(admin)) === JSON.stringify(beforeFolders),
  'OTHER_DATA_CHANGED')
  const fixtureDir = backup.directory
  assert(fixtureDir === resolve('.seller-audit-backups', rowAfter.id), 'LOCAL_BACKUP_PATH_INVALID')
  await unlink(join(fixtureDir, 'source.xlsx'))
  await unlink(join(fixtureDir, 'manifest.json'))
  await rmdir(fixtureDir)
  assert(!existsSync(fixtureDir), 'LOCAL_BACKUP_CLEANUP_FAILED')
  evidence.stage = 'PASS'; await save()
  process.stdout.write(`REMOTE 5G PASS sourceFileId=${rowAfter.id} logs=${logs.join(',') || 'none'} ` +
    'source=0 object=0 logs=0 localBackup=absent otherData=unchanged\n')
  await unlink(evidencePath)
}
const action = process.argv.length === 3 && process.argv[2] === '--reconcile' ? reconcile : main
action().catch(error => {
  process.stderr.write(`REMOTE 5G HOLD stage=${evidence.stage} code=${safeError(error)} ` +
    `sourceFileId=${evidence.sourceFileId ?? 'unknown'} ` +
    `filename=${evidence.originalFilename ?? 'unknown'} evidence=${evidencePath}\n`)
  process.exitCode = 1
})
