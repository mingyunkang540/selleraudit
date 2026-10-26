/* global process, Buffer */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const PROJECT_REF = 'yzpkhvuftusnshdqfnim'
export const PROJECT_NAME = 'selleraudit-dev'
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
export const BUCKET = 'seller-audit-import-sources'
export const FIXTURE_PREFIX = '__SELLERAUDIT_5G_RECOVERY__'
export const BACKUP_ROOT = resolve('.seller-audit-backups')
export const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/i

export class RecoveryError extends Error {
  constructor(code) { super(code); this.name = 'RecoveryError'; this.code = code }
}
export function assert(ok, code) { if (!ok) throw new RecoveryError(code) }
export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
export function byteFacts(bytes) { return { sha256: digest(bytes), byteSize: bytes.length } }
export function assertBytes(bytes, sha256, byteSize) {
  const facts = byteFacts(bytes)
  assert(facts.sha256 === sha256 && facts.byteSize === byteSize, 'BYTE_INTEGRITY_MISMATCH')
  return facts
}
export function parseEnv(contents) {
  return Object.fromEntries(contents.replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) return []
    const raw = match[2].trim()
    return [[match[1], ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) ? raw.slice(1, -1) : raw]]
  }))
}
export async function writeEvidenceSnapshot(path, evidence, first) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  if (first) {
    await writeFile(path, serialized, { flag: 'wx', mode: 0o600 })
    return
  }
  const temporary = `${path}.${randomUUID()}.partial`
  await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) } catch (error) {
    await unlink(temporary)
    throw error
  }
}
export async function loadOps() {
  const path = resolve('.env.ops.local')
  assert(existsSync(path), 'OPS_CREDENTIAL_FILE_MISSING')
  const env = parseEnv(await readFile(path, 'utf8'))
  assert(env.SELLERAUDIT_OPS_SUPABASE_URL === PROJECT_URL &&
    env.SELLERAUDIT_OPS_PROJECT_REF === PROJECT_REF &&
    env.SELLERAUDIT_OPS_PROJECT_NAME === PROJECT_NAME, 'WRONG_PROJECT')
  assert(Boolean(env.SELLERAUDIT_OPS_SUPABASE_SECRET_KEY) &&
    !Object.keys(env).some(key => key.startsWith('VITE_')), 'OPS_SECRET_INVALID')
  const { createClient } = await import('@supabase/supabase-js')
  return { env, admin: createClient(PROJECT_URL, env.SELLERAUDIT_OPS_SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }) }
}
export function assertTarget(env, project) {
  assert(env.SELLERAUDIT_OPS_PROJECT_REF === PROJECT_REF &&
    env.SELLERAUDIT_OPS_PROJECT_NAME === PROJECT_NAME &&
    env.SELLERAUDIT_OPS_SUPABASE_URL === PROJECT_URL &&
    project?.id === PROJECT_REF && project?.name === PROJECT_NAME, 'WRONG_PROJECT')
}
export function verifyRemoteProject(env) {
  let projects
  try {
    const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const output = execFileSync(executable, ['supabase', 'projects', 'list', '--output', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: process.platform === 'win32' })
    projects = JSON.parse(output)
  } catch { throw new RecoveryError('PROJECT_IDENTITY_UNVERIFIED') }
  const project = Array.isArray(projects) ? projects.find(item => item.id === PROJECT_REF) : undefined
  assertTarget(env, project)
}
export function backupDir(sourceFileId) {
  assert(UUID.test(sourceFileId), 'INVALID_SOURCE_FILE_ID')
  return join(BACKUP_ROOT, sourceFileId)
}
export function assertSource(source) {
  assert(source && UUID.test(source.id) && UUID.test(source.workspace_id), 'SOURCE_NOT_FOUND')
  assert(source.source_type === 'MASTER_WORKBOOK' && source.verification_status === 'VERIFIED' &&
    SHA256.test(source.server_verified_sha256 ?? '') &&
    Number.isSafeInteger(source.server_verified_byte_size) && source.server_verified_byte_size >= 0,
  'SOURCE_NOT_VERIFIED')
  assert(source.storage_bucket === BUCKET &&
    source.storage_object_path === `${source.workspace_id}/${source.id}/source.xlsx`, 'SOURCE_PATH_INVALID')
}
export async function fetchSource(admin, sourceFileId) {
  assert(UUID.test(sourceFileId), 'INVALID_SOURCE_FILE_ID')
  const { data, error } = await admin.from('import_source_files').select('*').eq('id', sourceFileId).maybeSingle()
  assert(!error && data, 'SOURCE_LOOKUP_FAILED')
  assertSource(data)
  return data
}
export async function downloadBytes(admin, bucket, objectPath) {
  const { data, error } = await admin.storage.from(bucket).download(objectPath)
  assert(!error && data, 'OBJECT_DOWNLOAD_FAILED')
  return Buffer.from(await data.arrayBuffer())
}
export function buildManifest(source, bytes, backedUpAt = new Date().toISOString()) {
  assertSource(source)
  const facts = assertBytes(bytes, source.server_verified_sha256, source.server_verified_byte_size)
  return {
    formatVersion: 1, projectRef: PROJECT_REF, sourceFileId: source.id,
    workspaceId: source.workspace_id, bucket: source.storage_bucket,
    objectPath: source.storage_object_path, originalFilename: source.original_filename,
    serverVerifiedSha256: source.server_verified_sha256,
    serverVerifiedByteSize: source.server_verified_byte_size,
    backupSha256: facts.sha256, backupByteSize: facts.byteSize, backedUpAt,
  }
}
export function validateManifest(manifest, source, bytes) {
  assertSource(source)
  assert(manifest?.formatVersion === 1 && manifest.projectRef === PROJECT_REF &&
    manifest.sourceFileId === source.id && manifest.workspaceId === source.workspace_id &&
    manifest.bucket === source.storage_bucket && manifest.objectPath === source.storage_object_path &&
    manifest.originalFilename === source.original_filename &&
    manifest.serverVerifiedSha256 === source.server_verified_sha256 &&
    manifest.serverVerifiedByteSize === source.server_verified_byte_size &&
    manifest.backupSha256 === source.server_verified_sha256 &&
    manifest.backupByteSize === source.server_verified_byte_size &&
    typeof manifest.backedUpAt === 'string' && !Number.isNaN(Date.parse(manifest.backedUpAt)),
  'MANIFEST_DB_MISMATCH')
  assertBytes(bytes, manifest.backupSha256, manifest.backupByteSize)
}
export function assertRehearsalGuard(env, source) {
  assert(env.SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL === 'YES', 'DESTRUCTIVE_FLAG_MISSING')
  assert(source.original_filename.startsWith(FIXTURE_PREFIX), 'NOT_5G_FIXTURE')
  assertSource(source)
}
export async function backupSource(admin, sourceFileId) {
  const finalDir = backupDir(sourceFileId)
  assert(!existsSync(finalDir), 'BACKUP_ALREADY_EXISTS')
  const source = await fetchSource(admin, sourceFileId)
  const bytes = await downloadBytes(admin, source.storage_bucket, source.storage_object_path)
  const manifest = buildManifest(source, bytes)
  await mkdir(BACKUP_ROOT, { recursive: true, mode: 0o700 })
  const staging = join(BACKUP_ROOT, `.partial-${sourceFileId}-${randomUUID()}`)
  await mkdir(staging, { mode: 0o700 })
  try {
    await writeFile(join(staging, 'source.xlsx'), bytes, { flag: 'wx', mode: 0o600 })
    const onDisk = await readFile(join(staging, 'source.xlsx'))
    validateManifest(manifest, source, onDisk)
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 })
    assert(!existsSync(finalDir), 'BACKUP_ALREADY_EXISTS')
    await rename(staging, finalDir)
  } catch (error) {
    for (const name of ['source.xlsx', 'manifest.json']) {
      try { await unlink(join(staging, name)) } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') throw cleanupError
      }
    }
    await rmdir(staging)
    throw error
  }
  return { source, manifest, directory: finalDir }
}
export async function readBackup(source) {
  const directory = backupDir(source.id)
  let manifest, bytes
  try {
    manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    bytes = await readFile(join(directory, 'source.xlsx'))
  } catch { throw new RecoveryError('BACKUP_READ_FAILED') }
  validateManifest(manifest, source, bytes)
  return { directory, manifest, bytes }
}
export function classifyExistingBytes(existingBytes, manifest) {
  if (existingBytes === null) return 'MISSING'
  assertBytes(existingBytes, manifest.backupSha256, manifest.backupByteSize)
  return 'ALREADY_RESTORED'
}
export async function objectBytesOrNull(admin, source) {
  const { data, error } = await admin.storage.from(source.storage_bucket).download(source.storage_object_path)
  if (error) {
    if (Number(error.statusCode ?? error.status) === 404 || error.error === 'not_found') return null
    throw new RecoveryError('OBJECT_READ_FAILED')
  }
  return Buffer.from(await data.arrayBuffer())
}
export async function removeExactObject(admin, source) {
  const { error } = await admin.storage.from(source.storage_bucket).remove([source.storage_object_path])
  assert(!error, 'EXACT_OBJECT_DELETE_FAILED')
}
export async function restoreExactObject(admin, env, source, backup, { deleteFirst = false } = {}) {
  assertRehearsalGuard(env, source)
  validateManifest(backup.manifest, source, backup.bytes)
  let deleteAttempted = false
  try {
    let existing = await objectBytesOrNull(admin, source)
    if (deleteFirst) {
      assert(existing !== null, 'OBJECT_MISSING_BEFORE_REHEARSAL')
      assertBytes(existing, backup.manifest.backupSha256, backup.manifest.backupByteSize)
      deleteAttempted = true
      await removeExactObject(admin, source)
      existing = await objectBytesOrNull(admin, source)
      assert(existing === null, 'OBJECT_STILL_PRESENT_AFTER_DELETE')
    }
    const state = classifyExistingBytes(existing, backup.manifest)
    if (state === 'MISSING') {
      const { error } = await admin.storage.from(source.storage_bucket).upload(source.storage_object_path,
        backup.bytes, { contentType: CONTENT_TYPE, upsert: false })
      assert(!error, 'RESTORE_UPLOAD_FAILED')
    } else if (deleteFirst) {
      throw new RecoveryError('EXISTING_OBJECT_COLLISION')
    }
    const restored = await objectBytesOrNull(admin, source)
    assert(restored !== null, 'RESTORED_OBJECT_MISSING')
    assertBytes(restored, backup.manifest.backupSha256, backup.manifest.backupByteSize)
    return { source, manifest: backup.manifest, directory: backup.directory, deleteAttempted, state }
  } catch (error) {
    if (deleteAttempted || !deleteFirst) {
      process.stderr.write(`RECOVERY REQUIRED sourceFileId=${source.id} bucket=${source.storage_bucket} ` +
        `objectPath=${source.storage_object_path} backupDirectory=${backup.directory} ` +
        `backupSha256=${backup.manifest.backupSha256} backupByteSize=${backup.manifest.backupByteSize} ` +
        `code=${error instanceof RecoveryError ? error.code : 'UNEXPECTED_RESTORE_FAILURE'}\n`)
    }
    throw error
  }
}
export async function restoreSource(admin, env, sourceFileId, { deleteFirst = false } = {}) {
  verifyRemoteProject(env)
  const source = await fetchSource(admin, sourceFileId)
  const guardEnv = { ...env,
    SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL: process.env.SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL }
  assertRehearsalGuard(guardEnv, source)
  const backup = await readBackup(source)
  return restoreExactObject(admin, guardEnv, source, backup, { deleteFirst })
}
export function safeError(error) { return error instanceof RecoveryError ? error.code : 'UNEXPECTED_FAILURE' }
