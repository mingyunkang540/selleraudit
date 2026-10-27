/* global process, fetch, setTimeout */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import {
  assert, BUCKET, CONTENT_TYPE, digest, loadOps, parseEnv, PROJECT_REF, PROJECT_URL,
  verifyRemoteProject, writeEvidenceSnapshot,
} from './ops/_shared/sourceRecovery.mjs'

const WORKSPACE = 'bfa4dc64-f4f9-428e-b8f9-61ff36d27db8'
const FOREIGN_WORKSPACE = '5dd0c635-ac80-42ed-98a3-0f8cce4ab94a'
const PREFIX = '__SELLERAUDIT_6A_APPLY__'
const EVIDENCE_PATH = resolve(process.env.TEMP ?? '.', 'selleraudit-6a-apply-acceptance.json')
const TABLES = ['products', 'skus', 'product_components', 'import_batches', 'raw_import_rows',
  'import_candidates', 'import_validation_issues', 'activity_logs', 'import_source_files']
let evidence
let reserved = false

async function save() {
  await writeEvidenceSnapshot(EVIDENCE_PATH, evidence, !reserved)
  reserved = true
}
function client(key) {
  return createClient(PROJECT_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
async function login(role, app, qa) {
  const c = client(app.VITE_SUPABASE_PUBLISHABLE_KEY)
  const { data, error } = await c.auth.signInWithPassword({
    email: qa[`SELLERAUDIT_${role}_EMAIL`], password: qa[`SELLERAUDIT_${role}_PASSWORD`],
  })
  assert(!error && data?.user && data?.session, `${role}_LIVE_AUTH_FAILED`)
  return c
}
async function rows(admin, table, column, value, fields = '*') {
  const { data, error } = await admin.from(table).select(fields).eq(column, value)
  assert(!error && Array.isArray(data), `READ_${table.toUpperCase()}_FAILED`)
  return data
}
async function counts(admin) {
  const result = {}
  for (const table of TABLES) {
    const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE)
    assert(!error && Number.isInteger(count), `COUNT_${table.toUpperCase()}_FAILED`)
    result[table] = count
  }
  return result
}
function workbook(code, sku, name) {
  const book = XLSX.utils.book_new()
  const products = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(products, [[
    '사방넷품번', '구분', '카테고리', '모델명', '구성 상세', null, '구성수',
  ]], { origin: 'B5' })
  XLSX.utils.sheet_add_aoa(products, [[code, '단품', 'Pilot QA', name, `${sku} 1개`, null, 1]],
    { origin: 'B6' })
  XLSX.utils.book_append_sheet(book, products, '단가표')
  const codes = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(codes, [[
    '입고일', '상품명', '옵션명', '상품코드', '입고예정수량', '박스당 수량', '입고박스 수', '비고1', '포장작업 코드',
  ]], { origin: 'B3' })
  XLSX.utils.sheet_add_aoa(codes, [['냉동용기']], { origin: 'B4' })
  XLSX.utils.sheet_add_aoa(codes, [['Pilot model', 'Pilot color', sku]], { origin: 'C23' })
  XLSX.utils.book_append_sheet(book, codes, '코드DB')
  const legacy = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(legacy, [['마스터 상품명', '단품 상품명', '사방넷 품번코드']],
    { origin: 'A3' })
  XLSX.utils.book_append_sheet(book, legacy, '상품DB')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
async function waitForServer() {
  const vite = spawn(process.execPath,
    ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4186', '--strictPort'],
    { stdio: 'ignore', env: { ...process.env, VITE_DATA_SOURCE: 'supabase' }, windowsHide: true })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:4186')).ok) return vite } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  vite.kill()
  throw new Error('VITE_START_FAILED')
}
async function requireSource(admin, filename) {
  const sources = await rows(admin, 'import_source_files', 'original_filename', filename,
    'id,workspace_id,original_filename,verification_status,server_verified_sha256,storage_bucket,storage_object_path')
  assert(sources.length === 1 && sources[0].workspace_id === WORKSPACE &&
    sources[0].storage_bucket === BUCKET &&
    sources[0].storage_object_path === `${WORKSPACE}/${sources[0].id}/source.xlsx`, 'SOURCE_IDENTITY_FAILED')
  return sources[0]
}
async function capture(admin) {
  for (const item of evidence.fixtures) {
    const sources = await rows(admin, 'import_source_files', 'original_filename', item.filename,
      'id,workspace_id,original_filename,verification_status,server_verified_sha256,storage_bucket,storage_object_path')
    assert(sources.length <= 1, 'AMBIGUOUS_SOURCE')
    if (!sources.length) continue
    const source = sources[0]
    assert(source.workspace_id === WORKSPACE && source.storage_bucket === BUCKET &&
      source.storage_object_path === `${WORKSPACE}/${source.id}/source.xlsx`, 'SOURCE_IDENTITY_FAILED')
    item.sourceId = source.id
    item.storagePath = source.storage_object_path
    const batches = await rows(admin, 'import_batches', 'source_file_id', source.id,
      'id,workspace_id,source_file_id,source_filename,status')
    assert(batches.length <= 1 && batches.every(batch => batch.workspace_id === WORKSPACE &&
      batch.source_filename === item.filename), 'AMBIGUOUS_BATCH')
    item.batchId = batches[0]?.id ?? null
    if (!item.batchId) continue
    item.rawIds = (await rows(admin, 'raw_import_rows', 'import_batch_id', item.batchId, 'id')).map(row => row.id)
    item.candidateIds = (await rows(admin, 'import_candidates', 'import_batch_id', item.batchId, 'id')).map(row => row.id)
    item.issueIds = (await rows(admin, 'import_validation_issues', 'import_batch_id', item.batchId, 'id')).map(row => row.id)
  }
  const main = evidence.fixtures[0]
  evidence.productIds = (await rows(admin, 'products', 'sabangnet_code', evidence.code,
    'id,workspace_id,sabangnet_code,product_name')).filter(row => row.workspace_id === WORKSPACE &&
    row.product_name === evidence.productName).map(row => row.id)
  evidence.skuIds = (await rows(admin, 'skus', 'sku_code', evidence.sku,
    'id,workspace_id,sku_code')).filter(row => row.workspace_id === WORKSPACE).map(row => row.id)
  if (evidence.productIds.length === 1) {
    evidence.componentIds = (await rows(admin, 'product_components', 'product_id', evidence.productIds[0],
      'id,workspace_id,product_id,sku_id')).filter(row => row.workspace_id === WORKSPACE &&
      evidence.skuIds.includes(row.sku_id)).map(row => row.id)
  }
  const entityIds = evidence.fixtures.flatMap(item => [item.sourceId, item.batchId]).filter(Boolean)
  evidence.activityLogIds = []
  for (const id of entityIds) {
    const logs = await rows(admin, 'activity_logs', 'entity_id', id,
      'id,workspace_id,action_type,entity_type,entity_id')
    assert(logs.every(row => row.workspace_id === WORKSPACE &&
      ['IMPORT_SOURCE_VERIFIED', 'IMPORT_VALIDATED', 'IMPORT_APPLIED'].includes(row.action_type)),
    'UNEXPECTED_ACTIVITY')
    evidence.activityLogIds.push(...logs.map(row => row.id))
  }
  assert(!main.batchId || main.sourceId, 'INCOMPLETE_SOURCE_EVIDENCE')
  await save()
}
async function browserHappy(admin, qa, bytes) {
  let browser
  const vite = await waitForServer()
  try {
    browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4186/#/import/master')
    await page.getByLabel('이메일').fill(qa.SELLERAUDIT_ADMIN_EMAIL)
    await page.getByLabel('비밀번호').fill(qa.SELLERAUDIT_ADMIN_PASSWORD)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await page.getByRole('heading', { name: 'Master Excel 분석' }).waitFor({ timeout: 30000 })
    evidence.stage = 'ADMIN_BROWSER_AUTH'; await save()
    await page.getByLabel('Master Excel 파일').setInputFiles({
      name: evidence.fixtures[0].filename, mimeType: CONTENT_TYPE, buffer: bytes,
    })
    await page.getByRole('button', { name: '분석 시작' }).click()
    await page.getByRole('heading', { name: 'Master 분석 결과' }).waitFor({ timeout: 60000 })
    await page.locator('.import-progress').filter({ hasText: '서버 검증 완료' })
      .waitFor({ timeout: 30000 })
    const source = await requireSource(admin, evidence.fixtures[0].filename)
    assert(source.verification_status === 'VERIFIED' &&
      source.server_verified_sha256 === digest(bytes), 'BROWSER_SOURCE_VERIFY_FAILED')
    await capture(admin)
    evidence.stage = 'BROWSER_SOURCE_VERIFIED'; await save()
    await page.getByRole('button', { name: '검증 결과 저장' }).click()
    await page.getByText('검증 결과가 중앙 저장소에 저장되었습니다.').waitFor({ timeout: 30000 })
    await capture(admin)
    assert(evidence.fixtures[0].batchId && evidence.fixtures[0].candidateIds.length === 3,
      'BROWSER_PERSIST_FAILED')
    evidence.stage = 'BROWSER_PERSISTED'; await save()
    await page.getByRole('button', {
      name: `${evidence.fixtures[0].filename} 배치 상세 보기`,
    }).click()
    const preview = page.getByRole('region', { name: 'Master 적용 미리보기' })
    await preview.getByRole('button', { name: 'Master에 적용' }).waitFor({ timeout: 30000 })
    assert(await preview.getByText('신규 1').count() === 3, 'BROWSER_PREVIEW_COUNTS_FAILED')
    evidence.stage = 'BROWSER_PREVIEW_PASS'; await save()
    await preview.getByRole('button', { name: 'Master에 적용' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '적용 확인' }).click()
    await page.getByText('Master 적용 완료').waitFor({ timeout: 30000 })
    await capture(admin)
    assert(evidence.productIds.length === 1 && evidence.skuIds.length === 1 &&
      evidence.componentIds.length === 1, 'BROWSER_APPLY_ROWS_FAILED')
    evidence.stage = 'BROWSER_APPLIED'; await save()
    await page.getByRole('link', { name: '상품 마스터 보기' }).click()
    await page.getByRole('heading', { name: '판매상품 마스터' }).waitFor({ timeout: 30000 })
    await page.getByLabel('판매상품 검색').fill(evidence.code)
    await page.getByRole('link', { name: evidence.code }).waitFor({ timeout: 30000 })
    await page.getByRole('link', { name: evidence.code }).click()
    await page.getByRole('heading', { name: evidence.productName, exact: true }).first()
      .waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: 'SKU 구성' }).click()
    await page.getByRole('heading', { name: 'SKU 구성 (BOM)' }).waitFor()
    await page.getByText(evidence.sku, { exact: true }).first().waitFor()
    await page.goto('http://127.0.0.1:4186/#/skus')
    await page.getByRole('heading', { name: '실물 SKU 마스터' }).waitFor()
    await page.getByLabel('SKU 검색').fill(evidence.sku)
    await page.getByText(evidence.sku, { exact: true }).first().waitFor()
    evidence.stage = 'BROWSER_MASTER_UI_PASS'; await save()
    await context.close()
  } finally {
    if (browser) await browser.close()
    vite.kill()
  }
}

async function conflictAndRoles(admin, app, qa, bytes) {
  const auth = {}
  for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'DISABLED']) auth[role] = await login(role, app, qa)
  const item = evidence.fixtures[1]
  const hash = digest(bytes)
  const { data: registered, error: regError } = await auth.ADMIN.rpc('register_master_import_source', {
    p_workspace_id: WORKSPACE, p_original_filename: item.filename,
    p_client_observed_byte_size: bytes.length, p_client_observed_sha256: hash,
  })
  assert(!regError && registered?.length === 1, 'CONFLICT_REGISTER_FAILED')
  item.sourceId = registered[0].source_file_id
  item.storagePath = registered[0].object_path
  await save()
  const upload = await auth.ADMIN.storage.from(BUCKET).upload(item.storagePath, bytes,
    { contentType: CONTENT_TYPE, upsert: false })
  assert(!upload.error, 'CONFLICT_UPLOAD_FAILED')
  const verified = await auth.ADMIN.functions.invoke('verify-master-import-source',
    { body: { sourceFileId: item.sourceId } })
  assert(!verified.error && verified.data?.status === 'VERIFIED', 'CONFLICT_VERIFY_FAILED')
  const payload = {
    p_workspace_id: WORKSPACE, p_source_file_id: item.sourceId,
    p_summary: { productCount: 1, skuCount: 0, bomCount: 0,
      validCount: 1, warningCount: 0, errorCount: 0, deferredCount: 0 },
    p_raw_rows: [{ sourceSheet: '단가표', originalRowNumber: 6, sourceBlock: 'PRICE_TABLE',
      rawCells: [{ address: 'B6', originalType: 'STRING', originalValue: evidence.code,
        formulaText: null, cachedValue: null, errorCode: null }] }],
    p_candidates: [{ kind: 'PRODUCT', candidateOrdinal: 1, sourceSheet: '단가표', sourceRow: 6,
      sourceBlock: 'PRICE_TABLE', sourceFieldMap: { sabangnetCode: 'B6', productName: 'E6' },
      status: 'VALID', issueCodes: [], supportingRows: [], normalizedValues: {
        sabangnetCode: evidence.code, productName: `${evidence.productName} CONFLICT`,
        category: 'Pilot QA', productType: 'SINGLE', rawBomText: null,
        sourceQuantity: 1, sourceChannel: null, variantOfSourceRow: null,
      } }], p_issues: [],
  }
  const persisted = await auth.ADMIN.rpc('persist_verified_master_import_dry_run', payload)
  assert(!persisted.error && typeof persisted.data === 'string', 'CONFLICT_PERSIST_FAILED')
  item.batchId = persisted.data
  await capture(admin)
  const preview = await auth.ADMIN.rpc('preview_master_import_apply', { p_batch_id: item.batchId })
  assert(!preview.error && preview.data?.productConflict === 1 && !preview.data.canApply,
    'CONFLICT_PREVIEW_FAILED')
  const apply = await auth.ADMIN.rpc('apply_master_import_batch', { p_batch_id: item.batchId })
  assert(Boolean(apply.error), 'CONFLICT_APPLY_ALLOWED')
  const existing = await rows(admin, 'products', 'id', evidence.productIds[0], 'id,product_name')
  assert(existing.length === 1 && existing[0].product_name === evidence.productName,
    'EXISTING_PRODUCT_CHANGED')
  const editorPreview = await auth.EDITOR.rpc('preview_master_import_apply', { p_batch_id: item.batchId })
  assert(!editorPreview.error && editorPreview.data?.productConflict === 1,
    'EDITOR_PREVIEW_FAILED')
  const editorApply = await auth.EDITOR.rpc('apply_master_import_batch', { p_batch_id: item.batchId })
  assert(Boolean(editorApply.error), 'EDITOR_APPLY_ALLOWED')
  for (const role of ['VIEWER', 'DISABLED']) {
    const p = await auth[role].rpc('preview_master_import_apply', { p_batch_id: item.batchId })
    const a = await auth[role].rpc('apply_master_import_batch', { p_batch_id: item.batchId })
    assert(Boolean(p.error) && Boolean(a.error), `${role}_APPLY_BOUNDARY_FAILED`)
  }
  const foreign = await admin.from('import_batches').insert({
    workspace_id: FOREIGN_WORKSPACE, source_type: 'MASTER_WORKBOOK', source_scope_key: 'WORKBOOK',
    source_filename: item.filename, source_file_hash: hash, parser_version: 'master-v1.0.0',
    status: 'REVIEW_REQUIRED', validation_revision: 1,
  }).select('id,workspace_id')
  assert(!foreign.error && foreign.data?.length === 1, 'FOREIGN_FIXTURE_FAILED')
  evidence.foreignBatchId = foreign.data[0].id
  await save()
  const foreignPreview = await auth.ADMIN.rpc('preview_master_import_apply',
    { p_batch_id: evidence.foreignBatchId })
  const foreignApply = await auth.ADMIN.rpc('apply_master_import_batch',
    { p_batch_id: evidence.foreignBatchId })
  assert(Boolean(foreignPreview.error) && Boolean(foreignApply.error), 'CROSS_WORKSPACE_ALLOWED')
  evidence.stage = 'REMOTE_CONTRACT_PASS'; await save()
}

async function removeId(admin, table, id, workspace = WORKSPACE) {
  const { data, error } = await admin.from(table).delete().eq('id', id).eq('workspace_id', workspace)
    .select('id')
  assert(!error && data?.length === 1, `DELETE_${table.toUpperCase()}_FAILED`)
}
async function cleanup() {
  assert(existsSync(EVIDENCE_PATH), 'EVIDENCE_MISSING')
  evidence = JSON.parse(await readFile(EVIDENCE_PATH, 'utf8'))
  reserved = true
  assert(evidence.projectRef === PROJECT_REF && evidence.workspaceId === WORKSPACE &&
    evidence.fixtures?.length === 2 && evidence.fixtures.every(item => item.filename.startsWith(PREFIX)),
  'EVIDENCE_TARGET_INVALID')
  const { admin, env } = await loadOps()
  verifyRemoteProject(env)
  await capture(admin)
  assert(evidence.productIds.length <= 1 && evidence.skuIds.length <= 1 &&
    evidence.componentIds.length <= 1, 'AMBIGUOUS_MASTER_IDS')
  const exact = {
    productIds: [...evidence.productIds], skuIds: [...evidence.skuIds],
    componentIds: [...evidence.componentIds], activityLogIds: [...evidence.activityLogIds],
    fixtures: evidence.fixtures.map(item => ({ ...item,
      rawIds: [...(item.rawIds ?? [])], candidateIds: [...(item.candidateIds ?? [])],
      issueIds: [...(item.issueIds ?? [])] })), foreignBatchId: evidence.foreignBatchId,
  }
  for (const id of evidence.componentIds) await removeId(admin, 'product_components', id)
  for (const id of evidence.productIds) await removeId(admin, 'products', id)
  for (const id of evidence.skuIds) await removeId(admin, 'skus', id)
  for (const item of evidence.fixtures) {
    for (const id of item.candidateIds ?? []) await removeId(admin, 'import_candidates', id)
    for (const id of item.issueIds ?? []) await removeId(admin, 'import_validation_issues', id)
    for (const id of item.rawIds ?? []) await removeId(admin, 'raw_import_rows', id)
  }
  for (const id of evidence.activityLogIds) await removeId(admin, 'activity_logs', id)
  for (const item of evidence.fixtures) {
    if (item.batchId) await removeId(admin, 'import_batches', item.batchId)
  }
  if (evidence.foreignBatchId) await removeId(admin, 'import_batches', evidence.foreignBatchId, FOREIGN_WORKSPACE)
  for (const item of evidence.fixtures) {
    if (!item.sourceId) continue
    assert(item.storagePath === `${WORKSPACE}/${item.sourceId}/source.xlsx`, 'STORAGE_PATH_INVALID')
    const removed = await admin.storage.from(BUCKET).remove([item.storagePath])
    assert(!removed.error, 'STORAGE_REMOVE_FAILED')
    await removeId(admin, 'import_source_files', item.sourceId)
  }
  evidence.stage = 'EXACT_ROWS_REMOVED'; await save()
  const after = await counts(admin)
  assert(JSON.stringify(after) === JSON.stringify(evidence.beforeCounts), 'PRE_POST_COUNTS_DIFFER')
  for (const [table, ids] of [
    ['products', exact.productIds], ['skus', exact.skuIds],
    ['product_components', exact.componentIds], ['activity_logs', exact.activityLogIds],
    ['import_batches', exact.fixtures.map(item => item.batchId).filter(Boolean)],
    ['raw_import_rows', exact.fixtures.flatMap(item => item.rawIds)],
    ['import_candidates', exact.fixtures.flatMap(item => item.candidateIds)],
    ['import_validation_issues', exact.fixtures.flatMap(item => item.issueIds)],
    ['import_source_files', exact.fixtures.map(item => item.sourceId).filter(Boolean)],
  ]) {
    for (const id of ids) assert((await rows(admin, table, 'id', id, 'id')).length === 0,
      `EXACT_${table.toUpperCase()}_REMAINS`)
  }
  if (exact.foreignBatchId) assert((await rows(admin, 'import_batches', 'id', exact.foreignBatchId,
    'id')).length === 0, 'FOREIGN_BATCH_REMAINS')
  for (const item of evidence.fixtures) {
    assert((await rows(admin, 'import_source_files', 'original_filename', item.filename, 'id')).length === 0,
      'SOURCE_REMAINS')
    if (item.storagePath) {
      const folder = await admin.storage.from(BUCKET).list(`${WORKSPACE}/${item.sourceId}`)
      assert(!folder.error && !folder.data?.some(row => row.name === 'source.xlsx'), 'OBJECT_REMAINS')
    }
  }
  evidence.stage = 'CLEANUP_PASS'; await save()
  process.stdout.write(`REMOTE 6A CLEANUP PASS product=${evidence.productIds.join(',') || 'none'} ` +
    `sku=${evidence.skuIds.join(',') || 'none'} component=${evidence.componentIds.join(',') || 'none'} ` +
    `batches=${evidence.fixtures.map(item => item.batchId).filter(Boolean).join(',')} ` +
    `sources=${evidence.fixtures.map(item => item.sourceId).filter(Boolean).join(',')} ` +
    'exact fixture rows=0 objects=0 pre/post counts equal\n')
  await unlink(EVIDENCE_PATH)
}

async function run() {
  assert(!existsSync(EVIDENCE_PATH), 'EXISTING_EVIDENCE_REQUIRES_RECONCILIATION')
  const { admin, env } = await loadOps()
  verifyRemoteProject(env)
  const app = parseEnv(await readFile(resolve('.env.local'), 'utf8'))
  const qa = parseEnv(await readFile(resolve('.env.remote-test.local.txt'), 'utf8'))
  assert(app.VITE_SUPABASE_URL === PROJECT_URL && app.VITE_DATA_SOURCE === 'supabase' &&
    app.VITE_SUPABASE_PUBLISHABLE_KEY, 'APP_TARGET_INVALID')
  const unique = randomUUID().replaceAll('-', '')
  const code = `9${BigInt(`0x${unique.slice(0, 14)}`).toString(10)}`
  const sku = `QA${unique.slice(0, 12).toUpperCase()}`
  const productName = `Pilot Apply ${unique.slice(0, 8)}`
  const bytes = workbook(code, sku, productName)
  evidence = { projectRef: PROJECT_REF, workspaceId: WORKSPACE, stage: 'PRECHECK', code, sku,
    productName, beforeCounts: await counts(admin), productIds: [], skuIds: [], componentIds: [],
    activityLogIds: [], foreignBatchId: null, fixtures: [
      { filename: `${PREFIX}${unique}.xlsx`, sourceId: null, batchId: null },
      { filename: `${PREFIX}${unique}_CONFLICT.xlsx`, sourceId: null, batchId: null },
    ] }
  await save()
  await browserHappy(admin, qa, bytes)
  await conflictAndRoles(admin, app, qa, bytes)
  await capture(admin)
  const batch = await rows(admin, 'import_batches', 'id', evidence.fixtures[0].batchId,
    'id,status,applied_count,remaining_count')
  const appliedLogs = await rows(admin, 'activity_logs', 'entity_id', evidence.fixtures[0].batchId,
    'id,action_type')
  assert(batch.length === 1 && batch[0].status === 'APPLIED' && batch[0].applied_count === 3 &&
    batch[0].remaining_count === 0 &&
    appliedLogs.filter(row => row.action_type === 'IMPORT_APPLIED').length === 1,
  'APPLY_COUNTS_OR_LOG_FAILED')
  const authAdmin = await login('ADMIN', app, qa)
  const retry = await authAdmin.rpc('apply_master_import_batch',
    { p_batch_id: evidence.fixtures[0].batchId })
  assert(Boolean(retry.error), 'RETRY_ALLOWED')
  evidence.stage = 'REMOTE_PASS_CLEANUP_READY'; await save()
  process.stdout.write('REMOTE 6A LIVE AUTH/SOURCE/PERSIST/PREVIEW/APPLY/UI/CONFLICT/ROLES PASS\n')
  await cleanup()
}

const action = process.argv[2] === '--cleanup' ? cleanup : process.argv.length === 2 ? run : null
if (!action) throw new Error('USAGE: node scripts/remote-6a-apply-acceptance.mjs [--cleanup]')
action().catch(error => {
  process.stderr.write(`REMOTE 6A HOLD stage=${evidence?.stage ?? 'UNKNOWN'} ` +
    `code=${error?.code ?? (error instanceof Error ? error.message.split('\n')[0] : 'UNKNOWN')} ` +
    `evidence=${EVIDENCE_PATH}\n`)
  process.exitCode = 1
})
