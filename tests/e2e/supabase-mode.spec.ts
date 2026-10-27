import { expect, test, type Page, type Route } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createHash } from 'node:crypto'

type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'
type WorkspaceFixture = { id: string; name: string; role: Role; productName?: string }
type ImportFixture = {
  batches: Array<Record<string, unknown>>
  issuesByBatch?: Record<string, Array<Record<string, unknown>>>
  candidatesByBatch?: Record<string, Array<Record<string, unknown>>>
  rawRowsById?: Record<string, Record<string, unknown>>
  rpcError?: string
  rpcGate?: Promise<void>
  candidateReviewGate?: Promise<void>
  rawReads?: { count: number }
  candidateReviews?: Array<Record<string, unknown>>
  issueReviews?: Array<Record<string, unknown>>
  sources?: Record<string, Record<string, unknown>>
  applyPreviewsByBatch?: Record<string, Record<string, unknown>>
  applyResultsByBatch?: Record<string, Record<string, unknown>>
  previewGateByBatch?: Record<string, Promise<void>>
  applyCalls?: Array<Record<string, unknown>>
}

const user = {
  id: '00000000-0000-4000-8000-000000000099',
  email: 'pilot@selleraudit.test',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-10-25T00:00:00.000Z',
  updated_at: '2026-10-25T00:00:00.000Z',
}

const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
}

function selected(url: URL, field: string): string | null {
  const raw = url.searchParams.get(field)
  return raw?.startsWith('eq.') ? raw.slice(3) : null
}

function product(workspace: WorkspaceFixture) {
  const timestamp = '2026-10-25T00:00:00.000Z'
  return {
    id: `product-${workspace.id}`, workspace_id: workspace.id, sabangnet_code: workspace.id === 'workspace-a' ? 'A-001' : 'B-001',
    product_name: workspace.productName, category: null, product_type: 'SINGLE', normal_price: 10000,
    status: 'ACTIVE', created_at: timestamp, updated_at: timestamp,
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installFakeSupabase(page: Page, workspaces: WorkspaceFixture[], imports: ImportFixture = { batches: [] }) {
  const sourceRegistrations = new Map<string, { id: string; workspaceId: string; filename: string; clientHash: string; bytes?: Buffer; serverHash?: string }>()
  await page.route('http://127.0.0.1:54321/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/auth/v1/token') return json(route, session)
    if (url.pathname === '/auth/v1/user') return json(route, user)
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' })
    if (url.pathname.startsWith('/storage/v1/object/seller-audit-import-sources/')) {
      const path = url.pathname.slice('/storage/v1/object/seller-audit-import-sources/'.length)
      const registration = sourceRegistrations.get(path)
      if (!registration) return json(route, { message: 'unregistered path' }, 403)
      if (registration.bytes) return json(route, { message: 'object exists' }, 409)
      const posted = request.postDataBuffer() ?? Buffer.alloc(0)
      const form = await new Request('http://fixture.local', {
        method: 'POST', headers: { 'content-type': request.headers()['content-type'] },
        body: posted.buffer.slice(posted.byteOffset, posted.byteOffset + posted.byteLength) as ArrayBuffer,
      }).formData()
      const uploadedFile = [...form.values()].find(value => value instanceof File)
      registration.bytes = uploadedFile ? Buffer.from(await uploadedFile.arrayBuffer()) : Buffer.alloc(0)
      registration.serverHash = createHash('sha256').update(registration.bytes).digest('hex')
      return json(route, { path })
    }
    if (url.pathname === '/functions/v1/verify-master-import-source') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const source = [...sourceRegistrations.values()].find(item => item.id === payload.sourceFileId)
      if (!source || !source.bytes) return json(route, { status: 'VERIFICATION_FAILED' })
      const status = source.serverHash === source.clientHash ? 'VERIFIED' : 'HASH_MISMATCH'
      imports.sources ??= {}
      imports.sources[source.id] = {
        id: source.id, workspace_id: source.workspaceId, original_filename: source.filename,
        verification_status: status, server_verified_sha256: source.serverHash,
        server_verified_byte_size: source.bytes.length, verified_at: '2026-10-25T09:00:00.000Z',
      }
      return json(route, { status, sourceFileId: source.id,
        serverSha256: source.serverHash, serverByteSize: source.bytes.length })
    }
    if (!url.pathname.startsWith('/rest/v1/')) return json(route, { message: 'unexpected test request' }, 404)

    const table = url.pathname.slice('/rest/v1/'.length)
    if (table === 'rpc/register_master_import_source') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const id = `00000000-0000-4000-8000-${String(sourceRegistrations.size + 1).padStart(12, '0')}`
      const workspaceId = String(payload.p_workspace_id)
      const path = `${workspaceId}/${id}/source.xlsx`
      sourceRegistrations.set(path, { id, workspaceId, filename: String(payload.p_original_filename),
        clientHash: String(payload.p_client_observed_sha256) })
      return json(route, [{ source_file_id: id, bucket: 'seller-audit-import-sources', object_path: path }])
    }
    if (table === 'rpc/persist_verified_master_import_dry_run') {
      if (imports.rpcGate) await imports.rpcGate
      if (imports.rpcError) return json(route, { message: imports.rpcError }, 400)
      const payload = request.postDataJSON() as Record<string, unknown>
      const summary = payload.p_summary as Record<string, number>
      const rawRows = payload.p_raw_rows as unknown[]
      const candidates = payload.p_candidates as Array<Record<string, unknown>>
      const source = imports.sources?.[String(payload.p_source_file_id)]
      if (!source || source.verification_status !== 'VERIFIED') return json(route, { message: 'verified source required' }, 400)
      const batchId = `batch-${imports.batches.length + 1}`
      imports.batches.unshift({
        id: batchId, workspace_id: payload.p_workspace_id, source_type: 'MASTER_WORKBOOK',
        source_filename: source.original_filename, source_file_id: source.id,
        source_file_hash: source.server_verified_sha256, source_hash_verification: 'SERVER_VERIFIED',
        parser_version: 'master-v1.0.0', created_at: '2026-10-25T09:00:00.000Z',
        status: 'REVIEW_REQUIRED', validation_revision: 1, row_count: rawRows.length,
        product_candidate_count: summary.productCount, sku_candidate_count: summary.skuCount,
        bom_candidate_count: summary.bomCount, valid_count: summary.validCount,
        warning_count: summary.warningCount, error_count: summary.errorCount,
        deferred_count: summary.deferredCount, created_by: user.id,
      })
      imports.candidatesByBatch ??= {}
      imports.candidatesByBatch[batchId] = candidates.map((candidate, index) => ({
        id: `candidate-${batchId}-${index + 1}`, workspace_id: payload.p_workspace_id,
        import_batch_id: batchId, raw_import_row_id: `raw-${index + 1}`, supporting_raw_row_ids: [],
        validation_revision: 1, candidate_ordinal: candidate.candidateOrdinal,
        kind: candidate.kind, source_sheet: candidate.sourceSheet, source_row: candidate.sourceRow,
        source_block: candidate.sourceBlock, source_field_map: candidate.sourceFieldMap,
        normalized_values: candidate.normalizedValues, candidate_status: candidate.status,
        issue_codes: candidate.issueCodes, reviewed_values: null, review_note: null,
        review_revision: 0, reviewed_by: null, reviewed_at: null,
      }))
      return json(route, batchId)
    }
    if (table === 'rpc/review_import_candidate') {
      if (imports.candidateReviewGate) await imports.candidateReviewGate
      const payload = request.postDataJSON() as Record<string, unknown>
      const candidate = Object.values(imports.candidatesByBatch ?? {}).flat()
        .find(row => row.id === payload.p_candidate_id)
      if (!candidate) return json(route, { message: 'candidate not found' }, 404)
      if (candidate.validation_revision !== payload.p_expected_validation_revision ||
        candidate.review_revision !== payload.p_expected_review_revision) {
        return json(route, { message: 'stale candidate review' }, 409)
      }
      candidate.reviewed_values = payload.p_reviewed_values
      candidate.review_note = payload.p_resolution
      candidate.review_revision = Number(candidate.review_revision) + 1
      candidate.reviewed_by = user.id
      candidate.reviewed_at = '2026-10-25T10:00:00.000Z'
      imports.candidateReviews?.push(payload)
      return json(route, null)
    }
    if (table === 'rpc/review_import_validation_issue') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const issue = Object.values(imports.issuesByBatch ?? {}).flat()
        .find(row => row.id === payload.p_issue_id)
      if (!issue) return json(route, { message: 'issue not found' }, 404)
      if (issue.validation_revision !== payload.p_expected_validation_revision ||
        issue.review_revision !== payload.p_expected_review_revision) {
        return json(route, { message: 'stale issue review' }, 409)
      }
      issue.status = payload.p_status
      issue.resolution = payload.p_resolution
      issue.review_revision = Number(issue.review_revision) + 1
      issue.reviewed_by = user.id
      issue.reviewed_at = '2026-10-25T10:00:00.000Z'
      imports.issueReviews?.push(payload)
      return json(route, null)
    }
    if (table === 'rpc/preview_master_import_apply') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const batchId = String(payload.p_batch_id)
      if (imports.previewGateByBatch?.[batchId]) await imports.previewGateByBatch[batchId]
      const preview = imports.applyPreviewsByBatch?.[batchId]
      return preview ? json(route, preview) : json(route, { message: 'preview unavailable' }, 400)
    }
    if (table === 'rpc/apply_master_import_batch') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const batchId = String(payload.p_batch_id)
      const result = imports.applyResultsByBatch?.[batchId]
      if (!result) return json(route, { message: 'apply unavailable' }, 400)
      imports.applyCalls?.push(payload)
      const batch = imports.batches.find(item => item.id === batchId)
      if (batch) batch.status = result.finalBatchStatus
      const workspace = workspaces.find(item => item.id === batch?.workspace_id)
      if (workspace && Number(result.productNew) > 0) workspace.productName = '신규 적용 상품'
      return json(route, result)
    }
    if (table === 'workspace_members') {
      return json(route, workspaces.map(workspace => ({ workspace_id: workspace.id, role: workspace.role, status: 'ACTIVE' })))
    }
    if (table === 'workspaces') {
      const workspaceId = selected(url, 'id')
      const rows = workspaceId
        ? workspaces.filter(workspace => workspace.id === workspaceId).map(workspace => ({
          id: workspace.id, name: workspace.name, created_at: '2026-10-25T00:00:00.000Z', updated_at: '2026-10-25T00:00:00.000Z',
        }))
        : workspaces.map(workspace => ({ id: workspace.id, name: workspace.name }))
      return json(route, rows)
    }
    if (table === 'products') {
      const workspaceId = selected(url, 'workspace_id')
      const workspace = workspaces.find(item => item.id === workspaceId)
      return json(route, workspace?.productName ? [product(workspace)] : [])
    }
    if (table === 'import_batches') {
      const workspaceId = selected(url, 'workspace_id')
      const batchId = selected(url, 'id')
      const rows = imports.batches.filter(batch =>
        (!workspaceId || batch.workspace_id === workspaceId) && (!batchId || batch.id === batchId))
      if (request.headers().accept?.includes('application/vnd.pgrst.object+json')) return json(route, rows[0] ?? null, rows.length ? 200 : 406)
      return json(route, rows.slice(0, Number(url.searchParams.get('limit') ?? 20)))
    }
    if (table === 'import_source_files') {
      const sourceId = selected(url, 'id')
      const source = sourceId ? imports.sources?.[sourceId] : undefined
      return json(route, source ?? null, source ? 200 : 406)
    }
    if (table === 'import_validation_issues') {
      const batchId = selected(url, 'import_batch_id')
      return json(route, batchId ? imports.issuesByBatch?.[batchId] ?? [] : [])
    }
    if (table === 'import_candidates') {
      const batchId = selected(url, 'import_batch_id')
      return json(route, batchId ? imports.candidatesByBatch?.[batchId] ?? [] : [])
    }
    if (table === 'raw_import_rows') {
      if (imports.rawReads) imports.rawReads.count += 1
      const rowId = selected(url, 'id')
      const row = rowId ? imports.rawRowsById?.[rowId] : undefined
      return json(route, row ?? null, row ? 200 : 406)
    }
    if (['skus', 'product_components', 'channels', 'channel_listings', 'channel_offers', 'aliases', 'audit_issues'].includes(table)) {
      return json(route, [])
    }
    return json(route, { message: `unexpected table ${table}` }, 404)
  })
}

function sanitizedMasterWorkbook(): Buffer {
  const price: unknown[][] = Array.from({ length: 9 }, () => [])
  price[4][1] = '사방넷품번'; price[4][2] = '구분'; price[4][3] = '카테고리'
  price[4][4] = '모델명'; price[4][5] = '구성 상세'; price[4][7] = '구성수'
  price[5][1] = '100526'; price[5][2] = '단품'; price[5][3] = '냉동용기'; price[5][4] = '상품 A'; price[5][5] = 'AL00 1개'; price[5][7] = 1
  price[6][1] = '100526'; price[6][2] = '단품'; price[6][3] = '냉동용기'; price[6][4] = '상품 B'; price[6][5] = 'AQ01 1개'; price[6][7] = 1
  price[7][1] = '100900'; price[7][2] = '단품'; price[7][3] = '냉동용기'; price[7][4] = '미확인 SKU'; price[7][5] = 'AL24 1개'; price[7][7] = 1
  const codes: unknown[][] = Array.from({ length: 7 }, () => [])
  codes[2][2] = '상품명'; codes[2][3] = '옵션명'; codes[2][4] = '상품코드'
  codes[3][1] = '냉동용기'; codes[4][2] = '점보'; codes[4][3] = '라벤더'; codes[4][4] = 'AL00'
  codes[5][2] = '1호'; codes[5][3] = '아쿠아'; codes[5][4] = 'AQ01'
  const products: unknown[][] = Array.from({ length: 4 }, () => [])
  products[2][0] = '마스터 상품명'; products[2][2] = '사방넷 품번코드'
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(price), '단가표')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(codes), '코드DB')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(products), '상품DB')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer
}

async function login(page: Page) {
  await page.getByLabel('이메일').fill(user.email)
  await page.getByLabel('비밀번호').fill('test-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
}

async function analyzeFixture(page: Page, fileName = 'sanitized-master.xlsx') {
  await page.getByLabel('Master Excel 파일').setInputFiles({
    name: fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: sanitizedMasterWorkbook(),
  })
  await page.getByRole('button', { name: '분석 시작' }).click()
  await expect(page.getByText('Master 분석 결과')).toBeVisible()
}

function savedReviewFixture(): ImportFixture {
  const batchId = 'batch-review'
  const rawRowId = 'raw-100526'
  const sourceFileId = '00000000-0000-4000-8000-000000000111'
  return {
    batches: [{
      id: batchId, workspace_id: 'workspace-a', source_type: 'MASTER_WORKBOOK',
      source_file_id: sourceFileId, source_file_hash: 'a'.repeat(64),
      source_hash_verification: 'SERVER_VERIFIED', parser_version: 'master-v1.0.0',
      source_filename: 'review-master.xlsx', created_at: '2026-10-25T08:30:00.000Z',
      status: 'REVIEW_REQUIRED', validation_revision: 1, row_count: 1,
      product_candidate_count: 1, sku_candidate_count: 0, bom_candidate_count: 0,
      valid_count: 0, warning_count: 0, error_count: 1, deferred_count: 0, created_by: user.id,
    }],
    sources: { [sourceFileId]: {
      id: sourceFileId, workspace_id: 'workspace-a', original_filename: 'review-master.xlsx',
      verification_status: 'VERIFIED', server_verified_sha256: 'a'.repeat(64),
      server_verified_byte_size: 1024, verified_at: '2026-10-25T08:29:00.000Z',
    } },
    candidatesByBatch: {
      [batchId]: [{
        id: 'candidate-100526', workspace_id: 'workspace-a', import_batch_id: batchId,
        raw_import_row_id: rawRowId, supporting_raw_row_ids: [], validation_revision: 1,
        candidate_ordinal: 1, kind: 'PRODUCT', source_sheet: '단가표', source_row: 6,
        source_block: 'PRICE_TABLE', source_field_map: { sabangnetCode: 'B6', productName: 'E6' },
        normalized_values: {
          sabangnetCode: '100526', productName: '충돌 상품', category: '냉동용기',
          productType: '단품', rawBomText: 'AL00 1개', sourceQuantity: 1,
          sourceChannel: '쿠팡', variantOfSourceRow: null,
        },
        candidate_status: 'ERROR', issue_codes: ['DUPLICATE_BUSINESS_KEY'],
        reviewed_values: null, review_note: null, review_revision: 0,
        reviewed_by: null, reviewed_at: null,
      }],
    },
    issuesByBatch: {
      [batchId]: [{
        id: 'issue-duplicate', workspace_id: 'workspace-a', import_batch_id: batchId,
        raw_import_row_id: rawRowId, related_raw_row_ids: [rawRowId],
        validation_revision: 1, review_revision: 0,
        issue_code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blocking_scope: 'CANDIDATE',
        source_sheet: '단가표', source_row: 6, field_path: 'sabangnetCode',
        observed_value: '100526', expected_rule: '사방넷 품번은 한 상품을 식별해야 합니다.',
        message: '사방넷 품번 100526이 중복되었습니다.', status: 'OPEN', resolution: null,
        reviewed_by: null, reviewed_at: null,
      }],
    },
    rawRowsById: {
      [rawRowId]: {
        id: rawRowId, workspace_id: 'workspace-a', source_sheet: '단가표',
        original_row_number: 6, source_block: 'PRICE_TABLE', raw_cells: [{
          address: 'B6', originalType: 'STRING', originalValue: '100526',
          formulaText: null, cachedValue: null, errorCode: null,
        }],
      },
    },
    candidateReviews: [],
    issueReviews: [],
    rawReads: { count: 0 },
  }
}

function applyPreview(batchId: string, overrides: Record<string, unknown> = {}) {
  return {
    batchId, canApply: true,
    productNew: 1, productUnchanged: 0, productConflict: 0, productSkipped: 0,
    skuNew: 1, skuUnchanged: 0, skuConflict: 0, skuSkipped: 0,
    bomNew: 1, bomUnchanged: 0, bomConflict: 0, bomSkipped: 0,
    blockingBatchIssues: 0,
    rows: [
      { candidateId: 'candidate-product', kind: 'PRODUCT', status: 'NEW', businessKey: '100001' },
      { candidateId: 'candidate-sku', kind: 'SKU', status: 'NEW', businessKey: 'AL00' },
      { candidateId: 'candidate-bom', kind: 'BOM_COMPONENT', status: 'NEW', businessKey: '100001 / AL00' },
    ],
    ...overrides,
  }
}

function withApplyPreview(imports: ImportFixture, batchId = 'batch-review') {
  imports.applyPreviewsByBatch = { [batchId]: applyPreview(batchId) }
  imports.applyResultsByBatch = { [batchId]: {
    batchId, productNew: 1, productUnchanged: 0, productConflict: 0, productSkipped: 0,
    skuNew: 1, skuUnchanged: 0, skuConflict: 0, skuSkipped: 0,
    bomNew: 1, bomUnchanged: 0, bomConflict: 0, bomSkipped: 0,
    blockingBatchIssues: 0, finalBatchStatus: 'APPLIED', appliedCount: 3, remainingCount: 0,
  } }
  imports.applyCalls = []
  return imports
}

test('shows the login gate when no Supabase session exists', async ({ page }) => {
  await installFakeSupabase(page, [])
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'SellerAudit 로그인' })).toBeVisible()
})

test('shows the authenticated membership role after login', async ({ page }) => {
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Alpha Workspace', role: 'EDITOR' }])
  await page.goto('/')
  await login(page)
  await expect(page.getByText('EDITOR · 개발 환경')).toBeVisible()
})

test('restores an authenticated session after reload', async ({ page }) => {
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Alpha Workspace', role: 'EDITOR' }])
  await page.goto('/')
  await login(page)
  await expect(page.getByText('EDITOR · 개발 환경')).toBeVisible()
  await page.reload()
  await expect(page.getByText('EDITOR · 개발 환경')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'SellerAudit 로그인' })).toHaveCount(0)
})

test('shows the no-workspace state when the user has no active membership', async ({ page }) => {
  await installFakeSupabase(page, [])
  await page.goto('/')
  await login(page)
  await expect(page.getByRole('heading', { name: '접근 가능한 워크스페이스가 없습니다' })).toBeVisible()
})

test('returns to the login gate after logout', async ({ page }) => {
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Alpha Workspace', role: 'ADMIN' }])
  await page.goto('/')
  await login(page)
  await page.getByRole('button', { name: /pilot@selleraudit\.test/ }).click()
  await expect(page.getByRole('heading', { name: 'SellerAudit 로그인' })).toBeVisible()
})

test('replaces old workspace data after switching workspaces', async ({ page }) => {
  await installFakeSupabase(page, [
    { id: 'workspace-a', name: 'Alpha Workspace', role: 'EDITOR', productName: 'Alpha 전용 상품' },
    { id: 'workspace-b', name: 'Beta Workspace', role: 'EDITOR', productName: 'Beta 전용 상품' },
  ])
  await page.goto('/#/products')
  await login(page)
  await expect(page.getByText('Alpha 전용 상품')).toBeVisible()
  await page.getByLabel('워크스페이스 선택').selectOption('workspace-b')
  await expect(page.getByText('Beta 전용 상품')).toBeVisible()
  await expect(page.getByText('Alpha 전용 상품')).toHaveCount(0)
})

test('hides write navigation and blocks import routes for VIEWER membership', async ({ page }) => {
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Viewer Workspace', role: 'VIEWER' }])
  await page.goto('/#/import/master')
  await login(page)
  await expect(page.getByText('VIEWER · 개발 환경')).toBeVisible()
  await expect(page.getByRole('link', { name: '데이터 가져오기' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '접근할 수 없습니다' })).toBeVisible()
  await expect(page.getByText('읽기 전용 계정입니다')).toBeVisible()
  await expect(page.getByRole('button', { name: '검증 결과 저장' })).toHaveCount(0)
})

for (const role of ['ADMIN', 'EDITOR'] as const) {
  test(`${role} can persist a Dry-run and see it in shared history`, async ({ page }) => {
    const imports: ImportFixture = { batches: [] }
    await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Import Workspace', role }], imports)
    await page.goto('/#/import/master')
    await login(page)
    await analyzeFixture(page, `${role.toLowerCase()}-master.xlsx`)

    const save = page.getByRole('button', { name: '검증 결과 저장' })
    await expect(save).toBeEnabled()
    await save.click()

    const savePanel = page.getByRole('region', { name: '검증 결과 중앙 저장' })
    await expect(savePanel.getByText('검증 결과가 중앙 저장소에 저장되었습니다.')).toBeVisible()
    await expect(savePanel.getByText('Batch ID: batch-1')).toBeVisible()
    await expect(savePanel.getByText('상태: REVIEW_REQUIRED')).toBeVisible()
    await expect(savePanel.getByRole('button', { name: '저장 완료' })).toBeDisabled()
    await expect(page.getByRole('region', { name: '최근 저장된 Master 검증' })).toContainText(`${role.toLowerCase()}-master.xlsx`)
    expect(imports.batches).toHaveLength(1)
    const persistedCandidates = imports.candidatesByBatch?.['batch-1'] ?? []
    expect(persistedCandidates).toHaveLength(8)
    expect(persistedCandidates.filter(candidate => candidate.kind === 'PRODUCT')).toHaveLength(3)
    expect(persistedCandidates.filter(candidate => candidate.kind === 'SKU')).toHaveLength(2)
    expect(persistedCandidates.filter(candidate => candidate.kind === 'BOM_COMPONENT')).toHaveLength(3)
  })
}

test('does not show a fake success state when persistence fails', async ({ page }) => {
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Import Workspace', role: 'EDITOR' }], {
    batches: [], rpcError: 'forced atomic rollback',
  })
  await page.goto('/#/import/master')
  await login(page)
  await analyzeFixture(page)
  await page.getByRole('button', { name: '검증 결과 저장' }).click()

  await expect(page.getByRole('alert')).toContainText('검증 결과를 저장하지 못했습니다.')
  await expect(page.getByText('기존 Master 데이터는 변경되지 않았습니다.')).toBeVisible()
  await expect(page.getByText('검증 결과가 중앙 저장소에 저장되었습니다.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '검증 결과 저장' })).toBeEnabled()
})

test('an old save cannot mark a newly analyzed preview as saved', async ({ page }) => {
  let releaseSave!: () => void
  const imports: ImportFixture = { batches: [], rpcGate: new Promise<void>(resolve => { releaseSave = resolve }) }
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Import Workspace', role: 'EDITOR' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await analyzeFixture(page, 'first-master.xlsx')
  await page.getByRole('button', { name: '검증 결과 저장' }).click()
  await expect(page.getByRole('button', { name: '저장 중…' })).toBeDisabled()

  await analyzeFixture(page, 'second-master.xlsx')
  releaseSave()
  await expect(page.getByRole('region', { name: '최근 저장된 Master 검증' })).toContainText('first-master.xlsx')
  const panel = page.getByRole('region', { name: '검증 결과 중앙 저장' })
  await expect(panel.getByText('검증 결과가 중앙 저장소에 저장되었습니다.')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '검증 결과 저장' })).toBeEnabled()
  expect(imports.batches).toHaveLength(1)
})

test('ADMIN can review a saved candidate while preserving the parser value', async ({ page }) => {
  const imports = savedReviewFixture()
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Review Workspace', role: 'ADMIN' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()

  const detail = page.getByRole('region', { name: '저장된 Batch 상세' })
  await expect(detail.getByRole('heading', { name: '저장된 후보' })).toBeVisible()
  expect(imports.rawReads?.count).toBe(0)
  await detail.getByRole('button', { name: '후보 상세' }).click()

  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: '원본 증거' })).toBeVisible()
  await expect.poll(() => imports.rawReads?.count).toBe(1)
  await expect(drawer.getByRole('heading', { name: 'Parser 정규화 값' })).toBeVisible()
  const parserValues = drawer.getByRole('heading', { name: 'Parser 정규화 값' }).locator('..')
  await expect(parserValues.getByText('100526', { exact: true })).toBeVisible()
  await drawer.getByRole('textbox', { name: '사방넷 품번', exact: true }).fill('100999')
  await drawer.getByLabel('검토 근거').fill('원본 소유자 확인 완료')
  await drawer.getByRole('button', { name: '검토 저장' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(detail.getByText('검토됨 · r1')).toBeVisible()
  expect(imports.candidateReviews).toEqual([expect.objectContaining({
    p_candidate_id: 'candidate-100526', p_expected_validation_revision: 1,
    p_expected_review_revision: 0, p_reviewed_values: { sabangnetCode: '100999' },
    p_resolution: '원본 소유자 확인 완료',
  })])

  await detail.getByRole('button', { name: '후보 상세' }).click()
  const reopenedDrawer = page.getByRole('dialog')
  const reopenedParserValues = reopenedDrawer.getByRole('heading', { name: 'Parser 정규화 값' }).locator('..')
  await expect(reopenedParserValues.getByText('100526', { exact: true })).toBeVisible()
  await expect(reopenedDrawer.getByRole('textbox', { name: '사방넷 품번', exact: true })).toHaveValue('100999')
})

test('ADMIN keeps explicit null override when saving another reviewed field', async ({ page }) => {
  const imports = savedReviewFixture()
  const candidate = imports.candidatesByBatch?.['batch-review']?.[0]
  if (!candidate) throw new Error('missing review fixture')
  candidate.reviewed_values = { category: null }
  candidate.review_note = '기존 검토 근거'
  candidate.review_revision = 1
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Review Workspace', role: 'ADMIN' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  await page.getByRole('region', { name: '저장된 Batch 상세' }).getByRole('button', { name: '후보 상세' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByLabel('카테고리 검토 방식')).toHaveValue('clear')
  await drawer.getByRole('textbox', { name: '상품명', exact: true }).fill('확인된 상품명')
  await drawer.getByLabel('검토 근거').fill('원본 소유자 확인 완료')
  await drawer.getByRole('button', { name: '검토 저장' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(imports.candidateReviews).toEqual([expect.objectContaining({
    p_reviewed_values: { productName: '확인된 상품명', category: null },
    p_expected_review_revision: 1,
  })])
})

test('ADMIN can explicitly clear an optional reviewed field', async ({ page }) => {
  const imports = savedReviewFixture()
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Review Workspace', role: 'ADMIN' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  await page.getByRole('region', { name: '저장된 Batch 상세' }).getByRole('button', { name: '후보 상세' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('카테고리 검토 방식').selectOption('clear')
  await drawer.getByLabel('검토 근거').fill('공식 원본에 카테고리 값 없음')
  await drawer.getByRole('button', { name: '검토 저장' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(imports.candidateReviews).toEqual([expect.objectContaining({ p_reviewed_values: { category: null } })])
})

test('a save from a previous batch cannot replace the newly selected batch details', async ({ page }) => {
  const imports = savedReviewFixture()
  let releaseReview!: () => void
  imports.candidateReviewGate = new Promise<void>(resolve => { releaseReview = resolve })
  const secondBatch = { ...imports.batches[0], id: 'batch-second', source_filename: 'second-master.xlsx' }
  const secondCandidate = { ...imports.candidatesByBatch?.['batch-review']?.[0], id: 'candidate-second', import_batch_id: 'batch-second', normalized_values: {
    sabangnetCode: '200000', productName: '두 번째 상품', category: null, productType: '단품', rawBomText: null,
    sourceQuantity: null, sourceChannel: null, variantOfSourceRow: null,
  } }
  imports.batches.push(secondBatch)
  imports.candidatesByBatch!['batch-second'] = [secondCandidate]
  imports.issuesByBatch!['batch-second'] = []
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Review Workspace', role: 'ADMIN' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  await page.getByRole('region', { name: '저장된 Batch 상세' }).getByRole('button', { name: '후보 상세' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('textbox', { name: '사방넷 품번', exact: true }).fill('100999')
  await drawer.getByLabel('검토 근거').fill('원본 확인')
  await drawer.getByRole('button', { name: '검토 저장' }).click()
  await expect(drawer.getByRole('button', { name: '저장 중…' })).toBeDisabled()
  await drawer.getByRole('button', { name: '닫기' }).click()
  await page.getByRole('button', { name: 'second-master.xlsx 배치 상세 보기' }).click()
  const detail = page.getByRole('region', { name: '저장된 Batch 상세' })
  await expect(detail).toContainText('Batch ID: batch-second')
  await expect(detail).toContainText('두 번째 상품')
  releaseReview()
  await expect.poll(() => imports.candidateReviews?.length).toBe(1)
  await expect(detail).toContainText('Batch ID: batch-second')
  await expect(detail).toContainText('두 번째 상품')
  await expect(detail).not.toContainText('충돌 상품')
})

test('ADMIN can record an issue resolution without changing the batch lifecycle', async ({ page }) => {
  const imports = savedReviewFixture()
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Review Workspace', role: 'ADMIN' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  await page.getByRole('region', { name: '저장된 Batch 상세' }).getByRole('button', { name: '이슈 상세' }).click()

  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('처리 상태').selectOption('RESOLVED')
  await drawer.getByLabel('처리 근거 (필수)').fill('공식 원본에서 중복 품번을 확인함')
  await drawer.getByRole('button', { name: '이슈 결정 저장' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  const detail = page.getByRole('region', { name: '저장된 Batch 상세' })
  await expect(detail.getByText('해결', { exact: true })).toBeVisible()
  await expect(detail.getByText('REVIEW_REQUIRED', { exact: true })).toBeVisible()
  expect(imports.issueReviews).toEqual([expect.objectContaining({
    p_issue_id: 'issue-duplicate', p_expected_validation_revision: 1,
    p_expected_review_revision: 0, p_status: 'RESOLVED',
    p_resolution: '공식 원본에서 중복 품번을 확인함',
  })])
})

test('EDITOR can inspect candidate evidence but cannot edit reviews', async ({ page }) => {
  const imports = savedReviewFixture()
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Review Workspace', role: 'EDITOR' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  await page.getByRole('region', { name: '저장된 Batch 상세' }).getByRole('button', { name: '후보 상세' }).click()

  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('EDITOR는 검토 내용을 조회할 수 있으며 변경할 수 없습니다.')).toBeVisible()
  const parserValues = drawer.getByRole('heading', { name: 'Parser 정규화 값' }).locator('..')
  await expect(parserValues.getByText('100526', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: '검토 저장' })).toHaveCount(0)
  await expect(drawer.getByLabel('사방넷 품번')).toHaveCount(0)
})

test('ADMIN can confirm Pilot Apply and open the Product master from the success result', async ({ page }) => {
  const imports = withApplyPreview(savedReviewFixture())
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Apply Workspace', role: 'ADMIN' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()

  const preview = page.getByRole('region', { name: 'Master 적용 미리보기' })
  await expect(preview).toContainText('Product')
  await expect(preview).toContainText('100001')
  await preview.getByRole('button', { name: 'Master에 적용' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Master에 적용' })
  await expect(confirmation).toContainText('기존 Master 데이터는 수정하거나 삭제하지 않습니다.')
  await expect(confirmation).toContainText('신규 Product')
  await confirmation.getByRole('button', { name: '적용 확인' }).click()

  const result = page.getByRole('region', { name: 'Master 적용 결과' })
  await expect(result).toContainText('Master 적용 완료')
  await expect(result).toContainText('Product 1건 · SKU 1건 · BOM 1건 생성')
  expect(imports.applyCalls).toEqual([{ p_batch_id: 'batch-review' }])
  await result.getByRole('link', { name: '상품 마스터 보기' }).click()
  await expect(page).toHaveURL(/#\/products$/)
  await expect(page.getByRole('heading', { level: 1, name: '판매상품 마스터' })).toBeVisible()
  await expect(page.getByText('신규 적용 상품', { exact: true })).toBeVisible()
})

test('EDITOR sees Apply Preview without an Apply button, and conflicts disable ADMIN Apply', async ({ page }) => {
  const editorImports = withApplyPreview(savedReviewFixture())
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Apply Workspace', role: 'EDITOR' }], editorImports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  const editorPreview = page.getByRole('region', { name: 'Master 적용 미리보기' })
  await expect(editorPreview.getByText('미리보기만 가능')).toBeVisible()
  await expect(editorPreview.getByRole('button', { name: 'Master에 적용' })).toHaveCount(0)

  const conflictImports = withApplyPreview(savedReviewFixture())
  conflictImports.applyPreviewsByBatch!['batch-review'] = applyPreview('batch-review', {
    canApply: false, productNew: 0, productConflict: 1,
    rows: [{ candidateId: 'candidate-product', kind: 'PRODUCT', status: 'CONFLICT', businessKey: '100526', reason: '기존 상품명이 다릅니다.' }],
  })
  await page.unrouteAll({ behavior: 'wait' })
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Apply Workspace', role: 'ADMIN' }], conflictImports)
  await page.reload()
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  const conflictPreview = page.getByRole('region', { name: 'Master 적용 미리보기' })
  await expect(conflictPreview).toContainText('Master 적용이 차단되었습니다.')
  await expect(conflictPreview.getByRole('button', { name: 'Master에 적용' })).toBeDisabled()
})

test('a delayed preview from the previous batch cannot replace the current batch preview', async ({ page }) => {
  const imports = savedReviewFixture()
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const secondBatch = { ...imports.batches[0], id: 'batch-second', source_filename: 'second-master.xlsx' }
  imports.batches.push(secondBatch)
  imports.candidatesByBatch!['batch-second'] = [{
    ...imports.candidatesByBatch!['batch-review'][0], id: 'candidate-second', import_batch_id: 'batch-second',
  }]
  imports.issuesByBatch!['batch-second'] = []
  imports.applyPreviewsByBatch = {
    'batch-review': applyPreview('batch-review', { rows: [{ candidateId: 'first', kind: 'PRODUCT', status: 'NEW', businessKey: 'FIRST-STALE' }] }),
    'batch-second': applyPreview('batch-second', { rows: [{ candidateId: 'second', kind: 'PRODUCT', status: 'NEW', businessKey: 'SECOND-CURRENT' }] }),
  }
  imports.previewGateByBatch = { 'batch-review': firstGate }
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Apply Workspace', role: 'ADMIN' }], imports)
  await page.goto('/#/import/master')
  await login(page)
  await page.getByRole('button', { name: 'review-master.xlsx 배치 상세 보기' }).click()
  await page.getByRole('button', { name: 'second-master.xlsx 배치 상세 보기' }).click()
  const detail = page.getByRole('region', { name: '저장된 Batch 상세' })
  await expect(detail).toContainText('SECOND-CURRENT')
  releaseFirst()
  await expect(detail).toContainText('SECOND-CURRENT')
  await expect(detail).not.toContainText('FIRST-STALE')
})

test('shows the snapshot unavailable notice for a legacy batch without candidates', async ({ page }) => {
  const rawReads = { count: 0 }
  const batchId = 'batch-shared'
  const rawRowId = 'raw-100526'
  const imports: ImportFixture = {
    batches: [{
      id: batchId, workspace_id: 'workspace-a', source_type: 'MASTER_WORKBOOK',
      source_filename: 'shared-master.xlsx', created_at: '2026-10-25T08:30:00.000Z',
      status: 'REVIEW_REQUIRED', validation_revision: 1, row_count: 3, product_candidate_count: 3,
      sku_candidate_count: 2, bom_candidate_count: 3, valid_count: 3,
      warning_count: 0, error_count: 5, deferred_count: 0, created_by: user.id,
    }],
    issuesByBatch: {
      [batchId]: [{
        id: 'issue-duplicate', workspace_id: 'workspace-a', import_batch_id: batchId,
        raw_import_row_id: rawRowId, related_raw_row_ids: [rawRowId],
        validation_revision: 1, review_revision: 0,
        issue_code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blocking_scope: 'CANDIDATE',
        source_sheet: '단가표', source_row: 6, field_path: 'sabangnetCode',
        observed_value: '100526', expected_rule: '사방넷 품번은 한 상품을 식별해야 합니다.',
        message: '사방넷 품번 100526이 중복되었습니다.', status: 'OPEN', resolution: null,
        reviewed_by: null, reviewed_at: null,
      }],
    },
    rawRowsById: {
      [rawRowId]: {
        id: rawRowId, workspace_id: 'workspace-a', source_sheet: '단가표',
        original_row_number: 6, source_block: 'PRICE_TABLE', raw_cells: [{
          address: 'F6', originalType: 'ERROR', originalValue: '#REF!',
          formulaText: '=A1/B1', cachedValue: '#DIV/0!', errorCode: '#REF!',
        }],
      },
    },
    rawReads,
  }
  await installFakeSupabase(page, [{ id: 'workspace-a', name: 'Shared Workspace', role: 'EDITOR' }], imports)
  await page.goto('/#/import/master')
  await login(page)

  const history = page.getByRole('region', { name: '최근 저장된 Master 검증' })
  await expect(history).toContainText('shared-master.xlsx')
  expect(rawReads.count).toBe(0)
  await page.getByRole('button', { name: 'shared-master.xlsx 배치 상세 보기' }).click()

  const detail = page.getByRole('region', { name: '저장된 Batch 상세' })
  await expect(detail).toContainText('Candidate Snapshot이 없는 이전 Batch입니다.')
  await expect(detail).toContainText('원본 Candidate 상세를 중앙 DB에서 재현할 수 없습니다.')
  await expect(detail.getByRole('button', { name: '후보 상세' })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: /적용|Apply/i })).toHaveCount(0)
  expect(rawReads.count).toBe(0)
})
