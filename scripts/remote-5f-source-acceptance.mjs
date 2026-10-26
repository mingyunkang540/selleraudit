/* global process, fetch */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const projectUrl = 'https://yzpkhvuftusnshdqfnim.supabase.co'
const workspaceId = 'bfa4dc64-f4f9-428e-b8f9-61ff36d27db8'
const foreignWorkspaceId = '5dd0c635-ac80-42ed-98a3-0f8cce4ab94a'
const bucket = 'seller-audit-import-sources'
const evidencePath = resolve(process.env.TEMP ?? '.', 'selleraudit-5f-source-acceptance.json')
const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function env(path) {
  return Object.fromEntries(readFileSync(resolve(path), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) return []
    const raw = match[2].trim()
    return [[match[1], (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw]]
  }))
}

function check(value, label) { if (!value) throw new Error(label) }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function save(evidence) { writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { flag: 'w' }) }

async function main() {
  check(!existsSync(evidencePath), 'Existing 5F evidence file must be cleaned first')
  const app = env('.env.local')
  const qa = env('.env.remote-test.local.txt')
  check(app.VITE_SUPABASE_URL === projectUrl && app.VITE_SUPABASE_PUBLISHABLE_KEY, 'Target project mismatch')
  const evidence = { projectRef: 'yzpkhvuftusnshdqfnim', workspaceId, sources: [], batches: [] }
  save(evidence)
  const clients = {}
  for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'DISABLED']) {
    const client = createClient(projectUrl, app.VITE_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.signInWithPassword({
      email: qa[`SELLERAUDIT_${role}_EMAIL`], password: qa[`SELLERAUDIT_${role}_PASSWORD`],
    })
    check(!error && data.user && data.session, `${role} live Auth failed`)
    clients[role] = { client, userId: data.user.id }
  }
  process.stdout.write('LIVE AUTH: ADMIN/EDITOR/VIEWER/DISABLED PASS\n')
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['5F fixture'], ['source bytes']]), '단가표')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const hash = digest(bytes)

  async function register(role, claimedHash = hash) {
    const filename = `__SELLERAUDIT_5F_${role}_${randomUUID()}.xlsx`
    const { data, error } = await clients[role].client.rpc('register_master_import_source', {
      p_workspace_id: workspaceId, p_original_filename: filename,
      p_client_observed_byte_size: bytes.length, p_client_observed_sha256: claimedHash,
    })
    check(!error && Array.isArray(data) && data.length === 1, `${role} registration failed`)
    const source = data[0]
    check(source.bucket === bucket && source.object_path === `${workspaceId}/${source.source_file_id}/source.xlsx`,
      `${role} opaque path failed`)
    evidence.sources.push({ id: source.source_file_id, path: source.object_path, role, filename })
    save(evidence)
    return source
  }

  async function upload(role, source) {
    const { error } = await clients[role].client.storage.from(bucket).upload(source.object_path, bytes,
      { contentType, upsert: false })
    check(!error, `${role} Storage upload failed (${error?.statusCode ?? 'unknown'})`)
  }

  async function verify(role, source) {
    const { data, error } = await clients[role].client.functions.invoke('verify-master-import-source',
      { body: { sourceFileId: source.source_file_id } })
    check(!error && data?.sourceFileId === source.source_file_id, `${role} Edge verification failed`)
    return data
  }

  const adminSource = await register('ADMIN')
  await upload('ADMIN', adminSource)
  const adminVerified = await verify('ADMIN', adminSource)
  check(adminVerified.status === 'VERIFIED' && adminVerified.serverSha256 === hash &&
    adminVerified.serverByteSize === bytes.length, 'ADMIN server hash mismatch')
  check((await verify('ADMIN', adminSource)).status === 'VERIFIED', 'VERIFIED retry not idempotent')
  process.stdout.write('ADMIN UPLOAD/VERIFY + SERVER SHA-256 MATCH + IDEMPOTENT PASS\n')

  const editorSource = await register('EDITOR')
  await upload('EDITOR', editorSource)
  const editorVerified = await verify('EDITOR', editorSource)
  check(editorVerified.status === 'VERIFIED' && editorVerified.serverSha256 === hash,
    'EDITOR upload/verify failed')
  process.stdout.write('EDITOR UPLOAD/VERIFY PASS\n')

  const viewerRegister = await clients.VIEWER.client.rpc('register_master_import_source', {
    p_workspace_id: workspaceId, p_original_filename: 'viewer-denied.xlsx',
    p_client_observed_byte_size: bytes.length, p_client_observed_sha256: hash,
  })
  check(Boolean(viewerRegister.error), 'VIEWER registration allowed')
  const viewerUpload = await clients.VIEWER.client.storage.from(bucket).upload(adminSource.object_path, bytes,
    { contentType, upsert: false })
  check(Boolean(viewerUpload.error), 'VIEWER upload allowed')
  const disabledRegister = await clients.DISABLED.client.rpc('register_master_import_source', {
    p_workspace_id: workspaceId, p_original_filename: 'disabled-denied.xlsx',
    p_client_observed_byte_size: bytes.length, p_client_observed_sha256: hash,
  })
  check(Boolean(disabledRegister.error), 'DISABLED registration allowed')
  process.stdout.write('VIEWER/DISABLED REGISTRATION + VIEWER UPLOAD DENY PASS\n')

  const unauth = await fetch(`${projectUrl}/storage/v1/object/authenticated/${bucket}/${adminSource.object_path}`)
  check(!unauth.ok, 'Unauthenticated private download allowed')
  const directRead = await clients.ADMIN.client.storage.from(bucket).download(adminSource.object_path)
  check(Boolean(directRead.error), 'Direct browser Storage read allowed')
  const { data: signed, error: signedError } = await clients.ADMIN.client.functions.invoke(
    'create-master-source-download-url', { body: { sourceFileId: adminSource.source_file_id } })
  check(!signedError && signed?.expiresIn === 60 && typeof signed.url === 'string', 'Signed URL issuance failed')
  const signedDownload = await fetch(signed.url)
  check(signedDownload.ok && digest(Buffer.from(await signedDownload.arrayBuffer())) === hash,
    'Signed URL download bytes mismatch')
  process.stdout.write('PRIVATE DIRECT READ DENY + SHORT SIGNED DOWNLOAD PASS\n')

  const overwrite = await clients.ADMIN.client.storage.from(bucket).upload(adminSource.object_path, bytes,
    { contentType, upsert: false })
  check(Boolean(overwrite.error), 'Object overwrite allowed')
  const update = await clients.ADMIN.client.storage.from(bucket).update(adminSource.object_path, bytes,
    { contentType })
  check(Boolean(update.error), 'Object update allowed')
  process.stdout.write('OVERWRITE/UPDATE DENY PASS\n')

  const mismatchSource = await register('ADMIN', '0'.repeat(64))
  await upload('ADMIN', mismatchSource)
  const mismatch = await verify('ADMIN', mismatchSource)
  check(mismatch.status === 'HASH_MISMATCH' && mismatch.serverSha256 === hash,
    'Hash mismatch protection failed')
  const retryMismatch = await clients.ADMIN.client.functions.invoke('verify-master-import-source',
    { body: { sourceFileId: mismatchSource.source_file_id } })
  check(Boolean(retryMismatch.error), 'Hash mismatch was silently retried')
  process.stdout.write('HASH MISMATCH PROTECTION PASS\n')

  const summary = { productCount: 1, skuCount: 0, bomCount: 0,
    validCount: 1, warningCount: 0, errorCount: 0, deferredCount: 0 }
  const raw = [{ sourceSheet: '단가표', originalRowNumber: 1,
    sourceBlock: 'PRICE_TABLE', rawCells: [{ address: 'A1', originalType: 'STRING',
      originalValue: '5F', formulaText: null, cachedValue: null, errorCode: null }] }]
  const candidates = [{ kind: 'PRODUCT', candidateOrdinal: 1, sourceSheet: '단가표', sourceRow: 1,
    sourceBlock: 'PRICE_TABLE', sourceFieldMap: { productName: 'A1' }, status: 'VALID',
    issueCodes: [], supportingRows: [], normalizedValues: {
      sabangnetCode: '5F-ACCEPTANCE', productName: 'Fixture', category: null,
      productType: null, rawBomText: null, sourceQuantity: 1,
      sourceChannel: null, variantOfSourceRow: null,
    } }]
  const payload = { p_workspace_id: workspaceId, p_source_file_id: adminSource.source_file_id,
    p_summary: summary, p_raw_rows: raw, p_candidates: candidates, p_issues: [] }
  const pending = await clients.ADMIN.client.rpc('persist_verified_master_import_dry_run',
    { ...payload, p_source_file_id: mismatchSource.source_file_id })
  check(Boolean(pending.error), 'Hash mismatch source persisted')
  const old = await clients.ADMIN.client.rpc('persist_master_import_dry_run', {
    p_workspace_id: workspaceId, p_source_filename: 'unverified.xlsx', p_source_file_hash: hash,
    p_summary: summary, p_raw_rows: raw, p_candidates: candidates, p_issues: [],
  })
  check(Boolean(old.error), 'Old unverified RPC still callable')
  const { data: batchId, error: batchError } = await clients.ADMIN.client.rpc(
    'persist_verified_master_import_dry_run', payload)
  check(!batchError && typeof batchId === 'string', 'Verified Batch persistence failed')
  evidence.batches.push({ id: batchId, sourceFileId: adminSource.source_file_id })
  save(evidence)
  const { data: batches, error: readError } = await clients.ADMIN.client.from('import_batches')
    .select('id,source_file_id,source_file_hash,source_hash_verification,status,validation_revision')
    .eq('id', batchId)
  check(!readError && batches?.length === 1 && batches[0].source_file_id === adminSource.source_file_id &&
    batches[0].source_file_hash === hash && batches[0].source_hash_verification === 'SERVER_VERIFIED' &&
    batches[0].status === 'REVIEW_REQUIRED', 'Batch/source trust linkage failed')
  const { data: savedCandidates, error: candidateError } = await clients.ADMIN.client.from('import_candidates')
    .select('id,review_revision').eq('import_batch_id', batchId)
  check(!candidateError && savedCandidates?.length === 1, 'Candidate atomic persistence failed')
  const editorReview = await clients.EDITOR.client.rpc('review_import_candidate', {
    p_candidate_id: savedCandidates[0].id, p_expected_validation_revision: 1,
    p_expected_review_revision: 0, p_reviewed_values: { productName: 'Editor denied' },
    p_resolution: 'Editor denial fixture',
  })
  check(Boolean(editorReview.error), 'EDITOR review allowed')
  const adminReview = await clients.ADMIN.client.rpc('review_import_candidate', {
    p_candidate_id: savedCandidates[0].id, p_expected_validation_revision: 1,
    p_expected_review_revision: 0, p_reviewed_values: { productName: 'Admin reviewed' },
    p_resolution: 'Verified source fixture',
  })
  check(!adminReview.error, 'ADMIN verified review failed')
  const foreignRegister = await clients.ADMIN.client.rpc('register_master_import_source', {
    p_workspace_id: foreignWorkspaceId, p_original_filename: 'foreign-denied.xlsx',
    p_client_observed_byte_size: bytes.length, p_client_observed_sha256: hash,
  })
  check(Boolean(foreignRegister.error), 'Cross-workspace registration allowed')
  const foreignPersist = await clients.ADMIN.client.rpc('persist_verified_master_import_dry_run',
    { ...payload, p_workspace_id: foreignWorkspaceId })
  check(Boolean(foreignPersist.error), 'Cross-workspace persistence allowed')
  process.stdout.write('VERIFIED BATCH + OLD RPC DENY + ADMIN REVIEW + EDITOR DENY + CROSS WORKSPACE PASS\n')
  process.stdout.write(`EVIDENCE: ${evidencePath}\n`)
}

async function post() {
  check(existsSync(evidencePath), '5F evidence file missing')
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  check(evidence.projectRef === 'yzpkhvuftusnshdqfnim' && evidence.workspaceId === workspaceId,
    'Evidence target mismatch')
  const app = env('.env.local')
  const qa = env('.env.remote-test.local.txt')
  check(app.VITE_SUPABASE_URL === projectUrl, 'Target project mismatch')
  const clients = {}
  for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'DISABLED']) {
    const client = createClient(projectUrl, app.VITE_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await client.auth.signInWithPassword({
      email: qa[`SELLERAUDIT_${role}_EMAIL`], password: qa[`SELLERAUDIT_${role}_PASSWORD`],
    })
    check(!error, `${role} live Auth failed`)
    clients[role] = client
  }
  const adminSource = evidence.sources.find(source => source.role === 'ADMIN')
  const batch = evidence.batches[0]
  check(adminSource && batch, 'Primary fixture missing')
  for (const role of ['VIEWER', 'DISABLED']) {
    const verifyResult = await clients[role].functions.invoke('verify-master-import-source',
      { body: { sourceFileId: adminSource.id } })
    check(Boolean(verifyResult.error), `${role} verification allowed`)
    const downloadResult = await clients[role].functions.invoke('create-master-source-download-url',
      { body: { sourceFileId: adminSource.id } })
    check(Boolean(downloadResult.error), `${role} source download allowed`)
    const sourceRead = await clients[role].from('import_source_files').select('id').eq('id', adminSource.id)
    check(!sourceRead.error && sourceRead.data?.length === 0, `${role} source metadata leaked`)
  }
  const anonymousVerify = await fetch(`${projectUrl}/functions/v1/verify-master-import-source`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceFileId: adminSource.id }),
  })
  check(anonymousVerify.status === 401, 'Anonymous verification allowed')
  process.stdout.write('VIEWER/DISABLED VERIFY/DOWNLOAD/METADATA + ANON VERIFY DENY PASS\n')

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['5F size fixture']]), '단가표')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const sizeHash = digest(bytes)
  async function register(filename, size) {
    const { data, error } = await clients.ADMIN.rpc('register_master_import_source', {
      p_workspace_id: workspaceId, p_original_filename: filename,
      p_client_observed_byte_size: size, p_client_observed_sha256: sizeHash,
    })
    check(!error && data?.length === 1, 'Technical fixture registration failed')
    const source = data[0]
    evidence.sources.push({ id: source.source_file_id, path: source.object_path, role: 'ADMIN', filename })
    save(evidence)
    return source
  }
  const pending = await register(`__SELLERAUDIT_5F_PENDING_${randomUUID()}.xlsx`, bytes.length)
  for (const role of ['VIEWER', 'DISABLED']) {
    const attempt = await clients[role].storage.from(bucket).upload(pending.object_path, bytes,
      { contentType, upsert: false })
    check(Boolean(attempt.error), `${role} fresh-path upload allowed`)
  }
  const missing = await clients.ADMIN.functions.invoke('verify-master-import-source',
    { body: { sourceFileId: pending.source_file_id } })
  check(!missing.error && missing.data?.status === 'VERIFICATION_FAILED', 'Missing object did not fail safe')
  const wrongSize = await register(`__SELLERAUDIT_5F_SIZE_${randomUUID()}.xlsx`, bytes.length - 1)
  const sizeUpload = await clients.ADMIN.storage.from(bucket).upload(wrongSize.object_path, bytes,
    { contentType, upsert: false })
  check(!sizeUpload.error, 'Wrong-size fixture upload failed')
  const sizeResult = await clients.ADMIN.functions.invoke('verify-master-import-source',
    { body: { sourceFileId: wrongSize.source_file_id } })
  check(!sizeResult.error && sizeResult.data?.status === 'VERIFICATION_FAILED',
    'Server byte-size mismatch was accepted')
  process.stdout.write('VIEWER/DISABLED FRESH PATH UPLOAD DENY + MISSING/SIZE FAIL SAFE PASS\n')

  const batchRead = await clients.ADMIN.from('import_batches').select('id,source_file_id,source_file_hash')
    .eq('id', batch.id)
  const rawRead = await clients.ADMIN.from('raw_import_rows').select('id').eq('import_batch_id', batch.id)
  const candidateRead = await clients.ADMIN.from('import_candidates').select('id').eq('import_batch_id', batch.id)
  const issueRead = await clients.ADMIN.from('import_validation_issues').select('id').eq('import_batch_id', batch.id)
  const verifiedLog = await clients.ADMIN.from('activity_logs').select('id')
    .eq('entity_id', adminSource.id).eq('action_type', 'IMPORT_SOURCE_VERIFIED')
  check(batchRead.data?.length === 1 && rawRead.data?.length === 1 &&
    candidateRead.data?.length === 1 && issueRead.data?.length === 0 &&
    verifiedLog.data?.length === 1, 'Atomic persistence or verified log mismatch')
  const foreignRead = await clients.ADMIN.from('import_source_files').select('id')
    .eq('workspace_id', foreignWorkspaceId)
  check(!foreignRead.error && foreignRead.data?.length === 0, 'Cross-workspace source metadata leaked')
  const masterTables = ['products', 'skus', 'product_components', 'channels',
    'channel_listings', 'channel_offers', 'aliases', 'audit_issues']
  for (const table of masterTables) {
    const read = await clients.ADMIN.from(table).select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
    check(!read.error && read.count === 0, `Master table changed: ${table}`)
  }
  process.stdout.write('ATOMIC BATCH/RAW/CANDIDATE/LOG + CROSS WORKSPACE + MASTER UNCHANGED PASS\n')
  process.stdout.write(`EVIDENCE: ${evidencePath}\n`)
}

async function finish() {
  check(existsSync(evidencePath), '5F evidence file missing')
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  check(evidence.projectRef === 'yzpkhvuftusnshdqfnim' && evidence.workspaceId === workspaceId,
    'Evidence target mismatch')
  check(!evidence.batches.some(batch => batch.kind === 'ISSUE_REVIEW'), 'Issue fixture already created')
  const app = env('.env.local')
  const qa = env('.env.remote-test.local.txt')
  check(app.VITE_SUPABASE_URL === projectUrl, 'Target project mismatch')
  const clients = {}
  for (const role of ['ADMIN', 'EDITOR']) {
    const client = createClient(projectUrl, app.VITE_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await client.auth.signInWithPassword({
      email: qa[`SELLERAUDIT_${role}_EMAIL`], password: qa[`SELLERAUDIT_${role}_PASSWORD`],
    })
    check(!error, `${role} live Auth failed`)
    clients[role] = client
  }
  const source = evidence.sources.find(item => item.role === 'ADMIN' && item.filename.includes('_ADMIN_'))
  check(source, 'Verified ADMIN source missing')
  const payload = {
    p_workspace_id: workspaceId, p_source_file_id: source.id,
    p_summary: { productCount: 1, skuCount: 0, bomCount: 0,
      validCount: 0, warningCount: 0, errorCount: 1, deferredCount: 0 },
    p_raw_rows: [{ sourceSheet: '단가표', originalRowNumber: 6, sourceBlock: 'PRICE_TABLE',
      rawCells: [{ address: 'B6', originalType: 'STRING', originalValue: '5F-ISSUE',
        formulaText: null, cachedValue: null, errorCode: null }] }],
    p_candidates: [{ kind: 'PRODUCT', candidateOrdinal: 1, sourceSheet: '단가표', sourceRow: 6,
      sourceBlock: 'PRICE_TABLE', sourceFieldMap: { sabangnetCode: 'B6' }, status: 'ERROR',
      issueCodes: ['DUPLICATE_BUSINESS_KEY'], supportingRows: [], normalizedValues: {
        sabangnetCode: '5F-ISSUE', productName: '5F issue fixture', category: null,
        productType: null, rawBomText: null, sourceQuantity: 1, sourceChannel: null,
        variantOfSourceRow: null,
      } }],
    p_issues: [{ code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blockingScope: 'CANDIDATE',
      sourceSheet: '단가표', sourceRow: 6, fieldPath: 'sabangnetCode', observedValue: '5F-ISSUE',
      expectedRule: 'Business keys must be unique.', message: '5F issue review fixture.',
      relatedRows: [] }],
  }
  const { data: batchId, error: persistError } = await clients.ADMIN.rpc(
    'persist_verified_master_import_dry_run', payload)
  check(!persistError && typeof batchId === 'string', 'Issue Batch persistence failed')
  evidence.batches.push({ id: batchId, sourceFileId: source.id, kind: 'ISSUE_REVIEW' })
  save(evidence)
  const issueRead = await clients.ADMIN.from('import_validation_issues')
    .select('id,status,review_revision').eq('import_batch_id', batchId)
  check(!issueRead.error && issueRead.data?.length === 1 && issueRead.data[0].review_revision === 0,
    'Issue fixture read failed')
  const issue = issueRead.data[0]
  const editorReview = await clients.EDITOR.rpc('review_import_validation_issue', {
    p_issue_id: issue.id, p_expected_validation_revision: 1,
    p_expected_review_revision: 0, p_status: 'RESOLVED', p_resolution: 'EDITOR denied',
  })
  check(Boolean(editorReview.error), 'EDITOR Issue review allowed')
  const afterDeny = await clients.ADMIN.from('import_validation_issues')
    .select('status,review_revision').eq('id', issue.id).single()
  check(!afterDeny.error && afterDeny.data.review_revision === 0,
    'Denied EDITOR Issue review mutated state')
  const adminReview = await clients.ADMIN.rpc('review_import_validation_issue', {
    p_issue_id: issue.id, p_expected_validation_revision: 1,
    p_expected_review_revision: 0, p_status: 'RESOLVED', p_resolution: 'Verified source fixture',
  })
  check(!adminReview.error, 'ADMIN Issue review failed')
  const afterAdmin = await clients.ADMIN.from('import_validation_issues')
    .select('status,review_revision').eq('id', issue.id).single()
  check(!afterAdmin.error && afterAdmin.data.status === 'RESOLVED' &&
    afterAdmin.data.review_revision === 1, 'ADMIN Issue review state mismatch')
  process.stdout.write('VERIFIED ISSUE: ADMIN REVIEW PASS; EDITOR DENY PASS\n')

  const foreignPath = `${foreignWorkspaceId}/${randomUUID()}/source.xlsx`
  const bytes = new Uint8Array([1, 2, 3])
  for (const role of ['ADMIN', 'EDITOR']) {
    const upload = await clients[role].storage.from(bucket).upload(foreignPath, bytes,
      { contentType, upsert: false })
    check(Boolean(upload.error), `${role} cross-workspace upload allowed`)
    const verify = await clients[role].functions.invoke('verify-master-import-source',
      { body: { sourceFileId: randomUUID() } })
    check(Boolean(verify.error), `${role} foreign-source verification allowed`)
    const download = await clients[role].functions.invoke('create-master-source-download-url',
      { body: { sourceFileId: randomUUID() } })
    check(Boolean(download.error), `${role} foreign-source download allowed`)
  }
  process.stdout.write('CROSS-WORKSPACE PATH UPLOAD + UNKNOWN SOURCE VERIFY/DOWNLOAD DENY PASS\n')
  process.stdout.write(`EVIDENCE: ${evidencePath}\n`)
}

async function smoke() {
  const app = env('.env.local')
  const qa = env('.env.remote-test.local.txt')
  check(app.VITE_SUPABASE_URL === projectUrl, 'Target project mismatch')
  const unknownId = randomUUID()
  for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'DISABLED']) {
    const client = createClient(projectUrl, app.VITE_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } })
    const signIn = await client.auth.signInWithPassword({
      email: qa[`SELLERAUDIT_${role}_EMAIL`], password: qa[`SELLERAUDIT_${role}_PASSWORD`],
    })
    check(!signIn.error, `${role} live Auth failed`)
    for (const name of ['verify-master-import-source', 'create-master-source-download-url']) {
      const result = await client.functions.invoke(name, { body: { sourceFileId: unknownId } })
      check(Boolean(result.error), `${role} unknown source accepted by ${name}`)
    }
  }
  process.stdout.write('DEPLOYED EDGE V2: FOUR ROLES UNKNOWN SOURCE DENY PASS\n')
}

const actions = { post, finish, smoke }
const action = actions[process.argv[2]] ?? main
action().catch(error => {
  process.stderr.write(`REMOTE 5F ACCEPTANCE FAILED: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
