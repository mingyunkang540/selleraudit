/* global Buffer */
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmdirSync } from 'node:fs'
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertRehearsalGuard, assertTarget, backupDir, backupSource, buildManifest,
  byteFacts, classifyExistingBytes, digest, removeExactObject, restoreExactObject,
  validateManifest, writeEvidenceSnapshot, PROJECT_REF, PROJECT_NAME,
  PROJECT_URL, BUCKET, FIXTURE_PREFIX,
// @ts-expect-error Ops helper is intentionally a Node ESM script without TypeScript declarations.
} from '../../scripts/ops/_shared/sourceRecovery.mjs'

const bytes = Buffer.from('seller audit recovery fixture')
function source() {
  const id = randomUUID(), workspace = randomUUID()
  return {
    id, workspace_id: workspace, source_type: 'MASTER_WORKBOOK',
    original_filename: `${FIXTURE_PREFIX}${randomUUID()}.xlsx`,
    storage_bucket: BUCKET, storage_object_path: `${workspace}/${id}/source.xlsx`,
    verification_status: 'VERIFIED', server_verified_sha256: digest(bytes),
    server_verified_byte_size: bytes.length, opsSecret: 'never-in-manifest',
  }
}
const env = { SELLERAUDIT_OPS_PROJECT_REF: PROJECT_REF, SELLERAUDIT_OPS_PROJECT_NAME: PROJECT_NAME,
  SELLERAUDIT_OPS_SUPABASE_URL: PROJECT_URL, SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL: 'YES' }

test('manifest uses explicit safe fields and exact verified byte facts', () => {
  const row = source()
  const manifest = buildManifest(row, bytes, '2026-10-26T00:00:00.000Z')
  validateManifest(JSON.parse(JSON.stringify(manifest)), row, bytes)
  expect(Object.keys(manifest)).toEqual([
    'formatVersion', 'projectRef', 'sourceFileId', 'workspaceId', 'bucket', 'objectPath',
    'originalFilename', 'serverVerifiedSha256', 'serverVerifiedByteSize', 'backupSha256',
    'backupByteSize', 'backedUpAt',
  ])
  expect(JSON.stringify(manifest)).not.toContain(row.opsSecret)
  expect(JSON.stringify(manifest)).not.toMatch(/password|token|secret|authorization|signed.url/i)
  expect(byteFacts(bytes)).toEqual({ sha256: digest(bytes), byteSize: bytes.length })
  expect(() => buildManifest(row, Buffer.from('wrong'))).toThrow('BYTE_INTEGRITY_MISMATCH')
})

test('project, fixture, and destructive flag guards fail closed', () => {
  const row = source()
  expect(() => assertTarget(env, { id: PROJECT_REF, name: PROJECT_NAME })).not.toThrow()
  expect(() => assertTarget(env, { id: PROJECT_REF, name: 'production' })).toThrow('WRONG_PROJECT')
  expect(() => assertTarget({ ...env, SELLERAUDIT_OPS_PROJECT_REF: 'different' },
    { id: PROJECT_REF, name: PROJECT_NAME })).toThrow('WRONG_PROJECT')
  expect(() => assertRehearsalGuard(env, row)).not.toThrow()
  expect(() => assertRehearsalGuard({ ...env, SELLERAUDIT_ALLOW_RECOVERY_REHEARSAL: '' }, row))
    .toThrow('DESTRUCTIVE_FLAG_MISSING')
  expect(() => assertRehearsalGuard(env, { ...row, original_filename: 'real.xlsx' }))
    .toThrow('NOT_5G_FIXTURE')
})

test('manifest mismatch and existing different bytes cannot restore', () => {
  const row = source()
  const manifest = buildManifest(row, bytes)
  for (const patch of [
    { sourceFileId: randomUUID() }, { bucket: 'other' }, { objectPath: 'other' },
    { backupSha256: '0'.repeat(64) }, { serverVerifiedByteSize: bytes.length + 1 },
  ]) expect(() => validateManifest({ ...manifest, ...patch }, row, bytes)).toThrow('MANIFEST_DB_MISMATCH')
  expect(classifyExistingBytes(null, manifest)).toBe('MISSING')
  expect(classifyExistingBytes(bytes, manifest)).toBe('ALREADY_RESTORED')
  expect(() => classifyExistingBytes(Buffer.from('wrong existing object'), manifest))
    .toThrow('BYTE_INTEGRITY_MISMATCH')
})

test('existing backup directory collides before any remote read', async () => {
  const row = source()
  const directory = backupDir(row.id)
  mkdirSync(directory, { recursive: true })
  try {
    await expect(backupSource({ from: () => { throw Error('unexpected remote read') } }, row.id))
      .rejects.toThrow('BACKUP_ALREADY_EXISTS')
  } finally { rmdirSync(directory) }
})

test('Storage delete accepts an empty success payload and sends only one exact path', async () => {
  const row = source()
  let removed: string[] = []
  const admin = { storage: { from: (bucket: string) => {
    expect(bucket).toBe(BUCKET)
    return { remove: async (paths: string[]) => { removed = paths; return { data: [], error: null } } }
  } } }
  await removeExactObject(admin, row)
  expect(removed).toEqual([row.storage_object_path])
})

function fakeStorage(initial: Buffer | null, uploadFails = false, removeResponseLost = false) {
  let object = initial
  const calls: { removed: string[][]; uploads: Array<{ path: string; upsert: boolean }> } =
    { removed: [], uploads: [] }
  const admin = { storage: { from: (bucket: string) => {
    expect(bucket).toBe(BUCKET)
    return {
      download: async () => object === null
        ? { data: null, error: { statusCode: 404 } }
        : { data: new Blob([new Uint8Array(object)]), error: null },
      remove: async (paths: string[]) => {
        calls.removed.push(paths)
        object = null
        if (removeResponseLost) throw Error('network response lost')
        return { data: [], error: null }
      },
      upload: async (path: string, uploaded: Buffer, options: { upsert: boolean }) => {
        calls.uploads.push({ path, upsert: options.upsert })
        if (uploadFails || object !== null) return { error: { statusCode: 409 } }
        object = uploaded
        return { error: null }
      },
    }
  } } }
  return { admin, calls, current: () => object }
}

test('destructive restore confirms absence then uploads exact path without upsert', async () => {
  const row = source(), storage = fakeStorage(bytes)
  const backup = { manifest: buildManifest(row, bytes), bytes, directory: backupDir(row.id) }
  const result = await restoreExactObject(storage.admin, env, row, backup, { deleteFirst: true })
  expect(result.state).toBe('MISSING')
  expect(storage.calls.removed).toEqual([[row.storage_object_path]])
  expect(storage.calls.uploads).toEqual([{ path: row.storage_object_path, upsert: false }])
  expect(storage.current()).toEqual(bytes)
})

test('failure after deletion warns and preserves backup bytes', async () => {
  const row = source(), storage = fakeStorage(bytes, true)
  const backup = { manifest: buildManifest(row, bytes), bytes, directory: backupDir(row.id) }
  const original = process.stderr.write
  const warnings: string[] = []
  process.stderr.write = ((chunk: string | Uint8Array) => {
    warnings.push(String(chunk)); return true
  }) as typeof process.stderr.write
  try {
    await expect(restoreExactObject(storage.admin, env, row, backup, { deleteFirst: true }))
      .rejects.toThrow('RESTORE_UPLOAD_FAILED')
  } finally { process.stderr.write = original }
  expect(warnings.join('')).toContain('RECOVERY REQUIRED')
  expect(warnings.join('')).toContain(`sourceFileId=${row.id}`)
  expect(backup.bytes).toEqual(bytes)
  expect(storage.current()).toBeNull()
})

test('uncertain delete response still emits recovery warning', async () => {
  const row = source(), storage = fakeStorage(bytes, false, true)
  const backup = { manifest: buildManifest(row, bytes), bytes, directory: backupDir(row.id) }
  const original = process.stderr.write
  const warnings: string[] = []
  process.stderr.write = ((chunk: string | Uint8Array) => {
    warnings.push(String(chunk)); return true
  }) as typeof process.stderr.write
  try {
    await expect(restoreExactObject(storage.admin, env, row, backup, { deleteFirst: true }))
      .rejects.toThrow('network response lost')
  } finally { process.stderr.write = original }
  expect(warnings.join('')).toContain('RECOVERY REQUIRED')
  expect(warnings.join('')).toContain('UNEXPECTED_RESTORE_FAILURE')
  expect(backup.bytes).toEqual(bytes)
  expect(storage.current()).toBeNull()
})

test('retry accepts matching existing bytes and rejects different existing bytes', async () => {
  const row = source(), backup = { manifest: buildManifest(row, bytes), bytes, directory: backupDir(row.id) }
  const exact = fakeStorage(bytes)
  const result = await restoreExactObject(exact.admin, env, row, backup)
  expect(result.state).toBe('ALREADY_RESTORED')
  expect(exact.calls.uploads).toHaveLength(0)
  const wrong = fakeStorage(Buffer.from('other object'))
  const original = process.stderr.write
  process.stderr.write = (() => true) as typeof process.stderr.write
  try {
    await expect(restoreExactObject(wrong.admin, env, row, backup))
      .rejects.toThrow('BYTE_INTEGRITY_MISMATCH')
  } finally { process.stderr.write = original }
  expect(wrong.calls.uploads).toHaveLength(0)
})

test('first evidence reservation is exclusive and later snapshots replace atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seller-audit-5g-evidence-'))
  const path = join(directory, 'evidence.json')
  try {
    await writeEvidenceSnapshot(path, { stage: 'PRECHECK' }, true)
    await expect(writeEvidenceSnapshot(path, { stage: 'SECOND_PROCESS' }, true))
      .rejects.toMatchObject({ code: 'EEXIST' })
    expect(JSON.parse(await readFile(path, 'utf8')).stage).toBe('PRECHECK')
    await writeEvidenceSnapshot(path, { stage: 'REGISTERING' }, false)
    expect(JSON.parse(await readFile(path, 'utf8')).stage).toBe('REGISTERING')
  } finally {
    await unlink(path)
    await rmdir(directory)
  }
})
