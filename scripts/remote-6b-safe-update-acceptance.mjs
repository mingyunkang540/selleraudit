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
const PREFIX = '__SELLERAUDIT_6B_'
const EVIDENCE_PATH = resolve(process.env.TEMP ?? '.', 'selleraudit-6b-safe-update-acceptance.json')
const TABLES = ['products', 'skus', 'product_components', 'import_batches', 'raw_import_rows',
  'import_candidates', 'import_validation_issues', 'activity_logs', 'import_source_files']
const FIXTURE_KINDS = ['CREATE', 'UPDATE', 'OMISSION', 'CONFLICT']
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

function workbook({ code, sku, productName, category, productType, modelName, color, quantity }) {
  const book = XLSX.utils.book_new()
  const products = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(products, [[
    '사방넷품번', '구분', '카테고리', '모델명', '구성 상세', null, '구성수',
  ]], { origin: 'B5' })
  XLSX.utils.sheet_add_aoa(products, [[
    code, productType === 'SET' ? '세트' : '단품', category, productName,
    `${sku} ${quantity}개`, null, quantity,
  ]], { origin: 'B6' })
  XLSX.utils.book_append_sheet(book, products, '단가표')
  const codes = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(codes, [[
    '입고일', '상품명', '옵션명', '상품코드', '입고예정수량', '박스당 수량', '입고박스 수', '비고1', '포장작업 코드',
  ]], { origin: 'B3' })
  XLSX.utils.sheet_add_aoa(codes, [['냉동용기']], { origin: 'B4' })
  XLSX.utils.sheet_add_aoa(codes, [[modelName, color, sku]], { origin: 'C23' })
  XLSX.utils.book_append_sheet(book, codes, '코드DB')
  const legacy = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(legacy, [['마스터 상품명', '단품 상품명', '사방넷 품번코드']],
    { origin: 'A3' })
  XLSX.utils.book_append_sheet(book, legacy, '상품DB')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

function productOnlyWorkbook({ code, productName, category }) {
  const book = XLSX.utils.book_new()
  const products = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(products, [[
    '사방넷품번', '구분', '카테고리', '모델명', '구성 상세', null, '구성수',
  ]], { origin: 'B5' })
  XLSX.utils.sheet_add_aoa(products, [[code, '단품', category, productName]], { origin: 'B6' })
  XLSX.utils.book_append_sheet(book, products, '단가표')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), '코드DB')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), '상품DB')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

async function waitForServer() {
  const vite = spawn(process.execPath,
    ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4186', '--strictPort'],
    { stdio: 'ignore', env: { ...process.env, VITE_DATA_SOURCE: 'supabase' }, windowsHide: true })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:4186')).ok) return vite } catch { /* starting */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  vite.kill()
  throw new Error('VITE_START_FAILED')
}

async function requireSource(admin, filename) {
  const sources = await rows(admin, 'import_source_files', 'original_filename', filename,
    'id,workspace_id,original_filename,verification_status,server_verified_sha256,storage_bucket,storage_object_path')
  assert(sources.length === 1 && sources[0].workspace_id === WORKSPACE &&
    sources[0].storage_bucket === BUCKET &&
    sources[0].storage_object_path === `${WORKSPACE}/${sources[0].id}/source.xlsx`,
  'SOURCE_IDENTITY_FAILED')
  return sources[0]
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))]
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

  evidence.productIds = (await rows(admin, 'products', 'sabangnet_code', evidence.code,
    'id,workspace_id,sabangnet_code,product_name')).filter(row => row.workspace_id === WORKSPACE)
    .map(row => row.id)
  evidence.skuIds = (await rows(admin, 'skus', 'sku_code', evidence.sku,
    'id,workspace_id,sku_code')).filter(row => row.workspace_id === WORKSPACE).map(row => row.id)
  evidence.componentIds = []
  if (evidence.productIds.length === 1 && evidence.skuIds.length === 1) {
    evidence.componentIds = (await rows(admin, 'product_components', 'product_id', evidence.productIds[0],
      'id,workspace_id,product_id,sku_id')).filter(row => row.workspace_id === WORKSPACE &&
      row.sku_id === evidence.skuIds[0]).map(row => row.id)
  }

  const entityIds = uniqueIds([
    ...evidence.fixtures.flatMap(item => [item.sourceId, item.batchId]),
    ...evidence.productIds, ...evidence.skuIds, ...evidence.componentIds,
  ])
  const logIds = []
  for (const id of entityIds) {
    const logs = await rows(admin, 'activity_logs', 'entity_id', id,
      'id,workspace_id,action_type,entity_type,entity_id,changed_fields')
    assert(logs.every(row => row.workspace_id === WORKSPACE && [
      'IMPORT_SOURCE_VERIFIED', 'IMPORT_VALIDATED', 'IMPORT_APPLIED',
      'MASTER_PRODUCT_UPDATED', 'MASTER_SKU_UPDATED', 'MASTER_BOM_UPDATED',
    ].includes(row.action_type)), 'UNEXPECTED_ACTIVITY')
    logIds.push(...logs.map(row => row.id))
  }
  evidence.activityLogIds = uniqueIds(logIds)
  await save()
}

async function browserUploadPersist(page, admin, item, bytes) {
  await page.goto('http://127.0.0.1:4186/#/import/master')
  await page.getByRole('heading', { name: 'Master Excel 분석' }).waitFor({ timeout: 30000 })
  await page.getByLabel('Master Excel 파일').setInputFiles({
    name: item.filename, mimeType: CONTENT_TYPE, buffer: bytes,
  })
  await page.getByRole('button', { name: '분석 시작' }).click()
  await page.getByRole('heading', { name: 'Master 분석 결과' }).waitFor({ timeout: 60000 })
  await page.locator('.import-progress').filter({ hasText: '서버 검증 완료' })
    .waitFor({ timeout: 30000 })
  const source = await requireSource(admin, item.filename)
  item.sourceId = source.id
  item.storagePath = source.storage_object_path
  await save()
  assert(source.verification_status === 'VERIFIED' &&
    source.server_verified_sha256 === digest(bytes), `${item.kind}_BROWSER_SOURCE_VERIFY_FAILED`)
  await page.getByRole('button', { name: '검증 결과 저장' }).click()
  await page.getByText('검증 결과가 중앙 저장소에 저장되었습니다.').waitFor({ timeout: 30000 })
  await capture(admin)
  assert(item.batchId && item.candidateIds.length === 3, `${item.kind}_BROWSER_PERSIST_FAILED`)
  await page.getByRole('button', { name: `${item.filename} 배치 상세 보기` }).click()
  return page.getByRole('region', { name: 'Master 적용 미리보기' })
}

async function browserCreateAndUpdate(admin, app, qa, createBytes, updateBytes) {
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

    const create = evidence.fixtures.find(item => item.kind === 'CREATE')
    const createPreview = await browserUploadPersist(page, admin, create, createBytes)
    await createPreview.getByRole('button', { name: 'Master에 적용' }).waitFor({ timeout: 30000 })
    assert(await createPreview.getByText('신규 1', { exact: true }).count() === 3,
      'CREATE_BROWSER_PREVIEW_COUNTS_FAILED')
    await createPreview.getByRole('button', { name: 'Master에 적용' }).click()
    const createDialog = page.getByRole('dialog')
    await createDialog.getByText('삭제되는 데이터는 없습니다.', { exact: true }).waitFor()
    await createDialog.getByRole('button', { name: '적용 확인' }).click()
    await page.getByText('Master 적용 완료').waitFor({ timeout: 30000 })
    await capture(admin)
    assert(evidence.productIds.length === 1 && evidence.skuIds.length === 1 &&
      evidence.componentIds.length === 1, 'CREATE_BROWSER_APPLY_ROWS_FAILED')
    evidence.originalIds = {
      productId: evidence.productIds[0], skuId: evidence.skuIds[0], componentId: evidence.componentIds[0],
    }
    evidence.stage = 'CREATE_BROWSER_APPLIED'; await save()

    const update = evidence.fixtures.find(item => item.kind === 'UPDATE')
    const updatePreview = await browserUploadPersist(page, admin, update, updateBytes)
    await updatePreview.getByRole('button', { name: 'Master에 적용' }).waitFor({ timeout: 30000 })
    assert(await updatePreview.getByText('변경 1', { exact: true }).count() === 3 &&
      await updatePreview.getByText('신규 0', { exact: true }).count() === 3,
    'UPDATE_BROWSER_PREVIEW_COUNTS_FAILED')
    for (const detail of await updatePreview.getByText('변경 상세', { exact: true }).all()) {
      await detail.click()
    }
    for (const value of [
      evidence.initial.productName, evidence.updated.productName,
      evidence.initial.category, evidence.updated.category,
      evidence.initial.modelName, evidence.updated.modelName,
      evidence.initial.color, evidence.updated.color,
      String(evidence.initial.quantity), String(evidence.updated.quantity),
    ]) await updatePreview.locator('.import-apply-changes').getByText(value, { exact: true }).first()
      .waitFor({ state: 'visible', timeout: 30000 })
    const editor = await login('EDITOR', app, qa)
    const editorPreview = await editor.rpc('preview_master_import_apply', { p_batch_id: update.batchId })
    assert(!editorPreview.error && editorPreview.data?.productUpdate === 1 &&
      editorPreview.data?.skuUpdate === 1 && editorPreview.data?.bomUpdate === 1 &&
      editorPreview.data?.canApply, 'EDITOR_UPDATE_PREVIEW_FAILED')
    const editorApply = await editor.rpc('apply_master_import_batch', { p_batch_id: update.batchId })
    assert(Boolean(editorApply.error), 'EDITOR_UPDATE_APPLY_ALLOWED')
    evidence.stage = 'UPDATE_BROWSER_PREVIEW_PASS'; await save()
    await updatePreview.getByRole('button', { name: 'Master에 적용' }).click()
    const updateDialog = page.getByRole('dialog')
    for (const label of ['변경 Product', '변경 SKU', '변경 BOM']) {
      const row = updateDialog.getByText(label, { exact: true }).locator('..')
      assert(await row.getByText('1', { exact: true }).count() >= 1, 'UPDATE_CONFIRM_COUNTS_FAILED')
    }
    await updateDialog.getByText('삭제되는 데이터는 없습니다.', { exact: true }).waitFor()
    await updateDialog.getByRole('button', { name: '적용 확인' }).click()
    await page.getByText('Master 적용 완료').waitFor({ timeout: 30000 })
    await page.getByText('Product 신규 0 / 변경 1', { exact: true }).waitFor()
    await page.getByText('SKU 신규 0 / 변경 1', { exact: true }).waitFor()
    await page.getByText('BOM 신규 0 / 변경 1', { exact: true }).waitFor()
    await capture(admin)
    assert(evidence.productIds[0] === evidence.originalIds.productId &&
      evidence.skuIds[0] === evidence.originalIds.skuId &&
      evidence.componentIds[0] === evidence.originalIds.componentId,
    'UPDATE_RECREATED_MASTER_ROW')
    evidence.stage = 'UPDATE_BROWSER_APPLIED'; await save()

    await page.getByRole('link', { name: '상품 마스터 보기' }).click()
    await page.getByRole('heading', { name: '판매상품 마스터' }).waitFor({ timeout: 30000 })
    await page.getByLabel('판매상품 검색').fill(evidence.code)
    const productLink = page.getByRole('link', { name: evidence.code })
    await productLink.waitFor({ timeout: 30000 })
    await productLink.click()
    assert(page.url().includes(evidence.originalIds.productId), 'PRODUCT_UI_UUID_FAILED')
    await page.getByRole('heading', { name: evidence.updated.productName, exact: true }).first()
      .waitFor({ timeout: 30000 })
    await page.getByText(evidence.updated.category, { exact: true }).waitFor()
    await page.getByRole('button', { name: 'SKU 구성' }).click()
    const bomSection = page.getByRole('heading', { name: 'SKU 구성 (BOM)' }).locator('..')
    await bomSection.getByText(evidence.sku, { exact: true }).waitFor()
    await bomSection.getByText(evidence.updated.modelName, { exact: true }).waitFor()
    await bomSection.getByText(evidence.updated.color, { exact: true }).waitFor()
    await bomSection.getByText(`${evidence.updated.quantity}개`, { exact: true }).waitFor()
    await page.goto('http://127.0.0.1:4186/#/skus')
    await page.getByRole('heading', { name: '실물 SKU 마스터' }).waitFor()
    await page.getByLabel('SKU 검색').fill(evidence.sku)
    const skuRow = page.locator('tbody tr').filter({ hasText: evidence.sku })
    await skuRow.getByText(evidence.updated.modelName, { exact: true }).waitFor()
    await skuRow.getByText(evidence.updated.color, { exact: true }).waitFor()
    evidence.stage = 'UPDATE_BROWSER_MASTER_UI_PASS'; await save()
    await context.close()
  } finally {
    if (browser) await browser.close()
    vite.kill()
  }
}

async function registerVerifiedSource(authAdmin, item, bytes) {
  const hash = digest(bytes)
  const { data: registered, error: registrationError } = await authAdmin.rpc(
    'register_master_import_source', {
      p_workspace_id: WORKSPACE, p_original_filename: item.filename,
      p_client_observed_byte_size: bytes.length, p_client_observed_sha256: hash,
    })
  assert(!registrationError && registered?.length === 1, `${item.kind}_REGISTER_FAILED`)
  item.sourceId = registered[0].source_file_id
  item.storagePath = registered[0].object_path
  await save()
  const upload = await authAdmin.storage.from(BUCKET).upload(item.storagePath, bytes,
    { contentType: CONTENT_TYPE, upsert: false })
  assert(!upload.error, `${item.kind}_UPLOAD_FAILED`)
  const verified = await authAdmin.functions.invoke('verify-master-import-source',
    { body: { sourceFileId: item.sourceId } })
  assert(!verified.error && verified.data?.status === 'VERIFIED', `${item.kind}_VERIFY_FAILED`)
}

async function applyOmission(admin, app, qa, omissionBytes) {
  const authAdmin = await login('ADMIN', app, qa)
  const item = evidence.fixtures.find(fixture => fixture.kind === 'OMISSION')
  await registerVerifiedSource(authAdmin, item, omissionBytes)
  const payload = {
    p_workspace_id: WORKSPACE, p_source_file_id: item.sourceId,
    p_summary: { productCount: 1, skuCount: 0, bomCount: 0,
      validCount: 1, warningCount: 0, errorCount: 0, deferredCount: 0 },
    p_raw_rows: [{ sourceSheet: '단가표', originalRowNumber: 6, sourceBlock: 'PRICE_TABLE',
      rawCells: [{ address: 'B6', originalType: 'STRING', originalValue: evidence.code,
        formulaText: null, cachedValue: null, errorCode: null }] }],
    p_candidates: [{ kind: 'PRODUCT', candidateOrdinal: 1, sourceSheet: '단가표', sourceRow: 6,
      sourceBlock: 'PRICE_TABLE', sourceFieldMap: { sabangnetCode: 'B6', productName: 'E6', category: 'D6' },
      status: 'VALID', issueCodes: [], supportingRows: [], normalizedValues: {
        sabangnetCode: evidence.code, productName: evidence.updated.productName,
        category: evidence.omissionCategory, productType: 'SINGLE', rawBomText: null,
        sourceQuantity: null, sourceChannel: null, variantOfSourceRow: null,
      } }], p_issues: [],
  }
  const persisted = await authAdmin.rpc('persist_verified_master_import_dry_run', payload)
  assert(!persisted.error && typeof persisted.data === 'string', 'OMISSION_PERSIST_FAILED')
  item.batchId = persisted.data
  await capture(admin)
  const preview = await authAdmin.rpc('preview_master_import_apply', { p_batch_id: item.batchId })
  assert(!preview.error && preview.data?.canApply && preview.data?.productUpdate === 1 &&
    preview.data?.skuUpdate === 0 && preview.data?.bomUpdate === 0 &&
    preview.data?.rows?.length === 1 && preview.data.rows[0].status === 'UPDATE',
  'OMISSION_PREVIEW_FAILED')
  const applied = await authAdmin.rpc('apply_master_import_batch', { p_batch_id: item.batchId })
  assert(!applied.error && applied.data?.productUpdate === 1 &&
    applied.data?.skuUpdate === 0 && applied.data?.bomUpdate === 0,
  'OMISSION_APPLY_FAILED')
  await capture(admin)
  const product = await rows(admin, 'products', 'id', evidence.originalIds.productId,
    'id,product_name,category,product_type')
  const sku = await rows(admin, 'skus', 'id', evidence.originalIds.skuId,
    'id,model_name,color')
  const component = await rows(admin, 'product_components', 'id', evidence.originalIds.componentId,
    'id,product_id,sku_id,quantity')
  assert(product.length === 1 && product[0].category === evidence.omissionCategory &&
    product[0].product_name === evidence.updated.productName && product[0].product_type === 'SINGLE' &&
    sku.length === 1 && sku[0].model_name === evidence.updated.modelName &&
    sku[0].color === evidence.updated.color && component.length === 1 &&
    component[0].product_id === evidence.originalIds.productId &&
    component[0].sku_id === evidence.originalIds.skuId &&
    component[0].quantity === evidence.updated.quantity &&
    evidence.productIds[0] === evidence.originalIds.productId &&
    evidence.skuIds[0] === evidence.originalIds.skuId &&
    evidence.componentIds[0] === evidence.originalIds.componentId,
  'OMISSION_DELETED_OR_CHANGED_SKU_BOM')
  evidence.stage = 'OMISSION_APPLIED_NO_DELETE_PASS'; await save()
}

async function conflictAndRoles(admin, app, qa, conflictBytes) {
  const auth = {}
  for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'DISABLED']) auth[role] = await login(role, app, qa)
  const item = evidence.fixtures.find(fixture => fixture.kind === 'CONFLICT')
  await registerVerifiedSource(auth.ADMIN, item, conflictBytes)
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
        sabangnetCode: evidence.code, productName: evidence.updated.productName,
        category: evidence.updated.category, productType: 'SET', rawBomText: null,
        sourceQuantity: evidence.updated.quantity, sourceChannel: null, variantOfSourceRow: null,
      } }], p_issues: [],
  }
  const persisted = await auth.ADMIN.rpc('persist_verified_master_import_dry_run', payload)
  assert(!persisted.error && typeof persisted.data === 'string', 'CONFLICT_PERSIST_FAILED')
  item.batchId = persisted.data
  await capture(admin)
  const preview = await auth.ADMIN.rpc('preview_master_import_apply', { p_batch_id: item.batchId })
  assert(!preview.error && preview.data?.productConflict === 1 && preview.data?.productUpdate === 0 &&
    !preview.data.canApply && preview.data.rows?.some(row => row.kind === 'PRODUCT' &&
      row.status === 'CONFLICT' && row.reason === 'Product Type changes are not applied automatically.' &&
      !row.changes), 'PRODUCT_TYPE_CONFLICT_PREVIEW_FAILED')
  const apply = await auth.ADMIN.rpc('apply_master_import_batch', { p_batch_id: item.batchId })
  assert(Boolean(apply.error), 'PRODUCT_TYPE_CONFLICT_APPLY_ALLOWED')

  const editorPreview = await auth.EDITOR.rpc('preview_master_import_apply', { p_batch_id: item.batchId })
  assert(!editorPreview.error && editorPreview.data?.productConflict === 1, 'EDITOR_PREVIEW_FAILED')
  const editorApply = await auth.EDITOR.rpc('apply_master_import_batch', { p_batch_id: item.batchId })
  assert(Boolean(editorApply.error), 'EDITOR_APPLY_ALLOWED')
  for (const role of ['VIEWER', 'DISABLED']) {
    const rolePreview = await auth[role].rpc('preview_master_import_apply', { p_batch_id: item.batchId })
    const roleApply = await auth[role].rpc('apply_master_import_batch', { p_batch_id: item.batchId })
    assert(Boolean(rolePreview.error) && Boolean(roleApply.error), `${role}_APPLY_BOUNDARY_FAILED`)
  }

  const foreign = await admin.from('import_batches').insert({
    workspace_id: FOREIGN_WORKSPACE, source_type: 'MASTER_WORKBOOK', source_scope_key: 'WORKBOOK',
    source_filename: item.filename, source_file_hash: digest(conflictBytes),
    parser_version: 'master-v1.0.0', status: 'REVIEW_REQUIRED', validation_revision: 1,
  }).select('id,workspace_id')
  assert(!foreign.error && foreign.data?.length === 1, 'FOREIGN_FIXTURE_FAILED')
  evidence.foreignBatchId = foreign.data[0].id
  await save()
  const foreignPreview = await auth.ADMIN.rpc('preview_master_import_apply',
    { p_batch_id: evidence.foreignBatchId })
  const foreignApply = await auth.ADMIN.rpc('apply_master_import_batch',
    { p_batch_id: evidence.foreignBatchId })
  assert(Boolean(foreignPreview.error) && Boolean(foreignApply.error), 'CROSS_WORKSPACE_ALLOWED')

  const product = await rows(admin, 'products', 'id', evidence.originalIds.productId,
    'id,workspace_id,sabangnet_code,product_name,category,product_type')
  const sku = await rows(admin, 'skus', 'id', evidence.originalIds.skuId,
    'id,workspace_id,sku_code,model_name,color')
  const component = await rows(admin, 'product_components', 'id', evidence.originalIds.componentId,
    'id,workspace_id,product_id,sku_id,quantity')
  assert(product.length === 1 && product[0].product_name === evidence.updated.productName &&
    product[0].category === evidence.omissionCategory && product[0].product_type === 'SINGLE' &&
    sku.length === 1 && sku[0].model_name === evidence.updated.modelName &&
    sku[0].color === evidence.updated.color && component.length === 1 &&
    component[0].quantity === evidence.updated.quantity, 'CONFLICT_OR_OMISSION_CHANGED_MASTER')
  evidence.stage = 'CONFLICT_ROLES_NO_DELETE_PASS'; await save()
}

function assertChange(log, sourceBatchId, expectedFields) {
  const actualFields = log.changed_fields?.fields
  assert(log.changed_fields?.sourceBatchId === sourceBatchId && actualFields &&
    Object.keys(actualFields).length === Object.keys(expectedFields).length,
  `${log.action_type}_DETAIL_FAILED`)
  for (const [field, expected] of Object.entries(expectedFields)) {
    assert(Object.hasOwn(actualFields, field) &&
      actualFields[field]?.before === expected.before &&
      actualFields[field]?.after === expected.after,
    `${log.action_type}_${field}_DETAIL_FAILED`)
  }
}

async function verifyAppliedEvidence(admin, app, qa) {
  const create = evidence.fixtures.find(item => item.kind === 'CREATE')
  const update = evidence.fixtures.find(item => item.kind === 'UPDATE')
  const omission = evidence.fixtures.find(item => item.kind === 'OMISSION')
  for (const [item, appliedCount] of [[create, 3], [update, 3], [omission, 1]]) {
    const batch = await rows(admin, 'import_batches', 'id', item.batchId,
      'id,status,applied_count,remaining_count')
    const logs = await rows(admin, 'activity_logs', 'entity_id', item.batchId,
      'id,action_type,changed_fields')
    assert(batch.length === 1 && batch[0].status === 'APPLIED' &&
      batch[0].applied_count === appliedCount && batch[0].remaining_count === 0 &&
      logs.filter(row => row.action_type === 'IMPORT_APPLIED').length === 1,
    `${item.kind}_APPLY_COUNTS_OR_LOG_FAILED`)
  }
  const updateSummary = (await rows(admin, 'activity_logs', 'entity_id', update.batchId,
    'id,action_type,changed_fields')).find(row => row.action_type === 'IMPORT_APPLIED')
  assert(updateSummary?.changed_fields?.productCreated === 0 &&
    updateSummary.changed_fields.productUpdated === 1 &&
    updateSummary.changed_fields.skuCreated === 0 &&
    updateSummary.changed_fields.skuUpdated === 1 &&
    updateSummary.changed_fields.bomCreated === 0 &&
    updateSummary.changed_fields.bomUpdated === 1 &&
    updateSummary.changed_fields.skipped === 0 &&
    updateSummary.changed_fields.finalBatchStatus === 'APPLIED', 'UPDATE_SUMMARY_LOG_FAILED')

  const expectedLogs = [
    ['MASTER_PRODUCT_UPDATED', evidence.originalIds.productId, {
      productName: { before: evidence.initial.productName, after: evidence.updated.productName },
      category: { before: evidence.initial.category, after: evidence.updated.category },
    }],
    ['MASTER_SKU_UPDATED', evidence.originalIds.skuId, {
      modelName: { before: evidence.initial.modelName, after: evidence.updated.modelName },
      color: { before: evidence.initial.color, after: evidence.updated.color },
    }],
    ['MASTER_BOM_UPDATED', evidence.originalIds.componentId, {
      quantity: { before: evidence.initial.quantity, after: evidence.updated.quantity },
    }],
  ]
  for (const [actionType, entityId, fields] of expectedLogs) {
    const matching = (await rows(admin, 'activity_logs', 'entity_id', entityId,
      'id,action_type,changed_fields')).filter(row => row.action_type === actionType &&
        row.changed_fields?.sourceBatchId === update.batchId)
    assert(matching.length === 1, `${actionType}_COUNT_FAILED`)
    assertChange(matching[0], update.batchId, fields)
  }
  const omissionLogs = (await rows(admin, 'activity_logs', 'entity_id', evidence.originalIds.productId,
    'id,action_type,changed_fields')).filter(row => row.action_type === 'MASTER_PRODUCT_UPDATED' &&
      row.changed_fields?.sourceBatchId === omission.batchId)
  assert(omissionLogs.length === 1, 'OMISSION_PRODUCT_AUDIT_COUNT_FAILED')
  assertChange(omissionLogs[0], omission.batchId, {
    category: { before: evidence.updated.category, after: evidence.omissionCategory },
  })

  const authAdmin = await login('ADMIN', app, qa)
  const retry = await authAdmin.rpc('apply_master_import_batch', { p_batch_id: update.batchId })
  assert(Boolean(retry.error), 'APPLIED_BATCH_RETRY_ALLOWED')
  await capture(admin)
  evidence.stage = 'REMOTE_PASS_CLEANUP_READY'; await save()
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
    evidence.fixtures?.length === FIXTURE_KINDS.length &&
    evidence.fixtures.every(item => FIXTURE_KINDS.includes(item.kind) &&
      item.filename.startsWith(`${PREFIX}${item.kind}__`)), 'EVIDENCE_TARGET_INVALID')
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

  for (const id of exact.componentIds) await removeId(admin, 'product_components', id)
  for (const id of exact.activityLogIds) await removeId(admin, 'activity_logs', id)
  for (const id of exact.productIds) await removeId(admin, 'products', id)
  for (const id of exact.skuIds) await removeId(admin, 'skus', id)
  for (const item of exact.fixtures) {
    for (const id of item.candidateIds) await removeId(admin, 'import_candidates', id)
    for (const id of item.issueIds) await removeId(admin, 'import_validation_issues', id)
    for (const id of item.rawIds) await removeId(admin, 'raw_import_rows', id)
    if (item.batchId) await removeId(admin, 'import_batches', item.batchId)
  }
  if (exact.foreignBatchId) await removeId(admin, 'import_batches', exact.foreignBatchId, FOREIGN_WORKSPACE)
  for (const item of exact.fixtures) {
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
  for (const item of exact.fixtures) {
    assert((await rows(admin, 'import_source_files', 'original_filename', item.filename, 'id')).length === 0,
      'SOURCE_REMAINS')
    if (item.storagePath) {
      const folder = await admin.storage.from(BUCKET).list(`${WORKSPACE}/${item.sourceId}`)
      assert(!folder.error && !folder.data?.some(row => row.name === 'source.xlsx'), 'OBJECT_REMAINS')
    }
  }
  evidence.stage = 'CLEANUP_PASS'; await save()
  process.stdout.write(`REMOTE 6B CLEANUP PASS product=${exact.productIds.join(',') || 'none'} ` +
    `sku=${exact.skuIds.join(',') || 'none'} component=${exact.componentIds.join(',') || 'none'} ` +
    `batches=${exact.fixtures.map(item => item.batchId).filter(Boolean).join(',')} ` +
    `sources=${exact.fixtures.map(item => item.sourceId).filter(Boolean).join(',')} ` +
    `activityLogs=${exact.activityLogIds.join(',')} exact fixture rows=0 objects=0 pre/post counts equal\n`)
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
  const sku = `QB${unique.slice(0, 12).toUpperCase()}`
  const initial = {
    productName: `Pilot Safe Update ${unique.slice(0, 8)}`, category: 'Pilot QA',
    productType: 'SINGLE', modelName: 'Pilot model', color: 'Pilot color', quantity: 1,
  }
  const updated = {
    productName: `${initial.productName} Updated`, category: 'Pilot Updated',
    productType: 'SINGLE', modelName: 'Pilot model updated', color: 'Pilot color updated', quantity: 2,
  }
  const createBytes = workbook({ code, sku, ...initial })
  const updateBytes = workbook({ code, sku, ...updated })
  const omissionCategory = 'Pilot Omission Applied'
  const omissionBytes = productOnlyWorkbook({ code, productName: updated.productName,
    category: omissionCategory })
  const conflictBytes = workbook({ code, sku, ...updated, productType: 'SET' })
  evidence = {
    projectRef: PROJECT_REF, workspaceId: WORKSPACE, stage: 'PRECHECK', code, sku,
    initial, updated, omissionCategory, beforeCounts: await counts(admin), productIds: [], skuIds: [],
    componentIds: [], activityLogIds: [], originalIds: null, foreignBatchId: null,
    fixtures: FIXTURE_KINDS.map(kind => ({
      kind, filename: `${PREFIX}${kind}__${unique}.xlsx`, sourceId: null, batchId: null,
      storagePath: null, rawIds: [], candidateIds: [], issueIds: [],
    })),
  }
  await save()
  await browserCreateAndUpdate(admin, app, qa, createBytes, updateBytes)
  await applyOmission(admin, app, qa, omissionBytes)
  await conflictAndRoles(admin, app, qa, conflictBytes)
  await verifyAppliedEvidence(admin, app, qa)
  process.stdout.write('REMOTE 6B LIVE CREATE/SAFE-UPDATE/SAME-UUID/UI/AUDIT/CONFLICT/ROLES/NO-DELETE PASS\n')
  await cleanup()
}

const action = process.argv[2] === '--cleanup' ? cleanup : process.argv.length === 2 ? run : null
if (!action) throw new Error('USAGE: node scripts/remote-6b-safe-update-acceptance.mjs [--cleanup]')
action().catch(error => {
  process.stderr.write(`REMOTE 6B HOLD stage=${evidence?.stage ?? 'UNKNOWN'} ` +
    `code=${error?.code ?? (error instanceof Error ? error.message.split('\n')[0] : 'UNKNOWN')} ` +
    `evidence=${EVIDENCE_PATH}\n`)
  process.exitCode = 1
})
