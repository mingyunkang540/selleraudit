import { expect, test, type Page, type Route } from '@playwright/test'
import * as XLSX from 'xlsx'

type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'
type WorkspaceFixture = { id: string; name: string; role: Role; productName?: string }
type ImportFixture = {
  batches: Array<Record<string, unknown>>
  issuesByBatch?: Record<string, Array<Record<string, unknown>>>
  rawRowsById?: Record<string, Record<string, unknown>>
  rpcError?: string
  rpcGate?: Promise<void>
  rawReads?: { count: number }
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
  await page.route('http://127.0.0.1:54321/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/auth/v1/token') return json(route, session)
    if (url.pathname === '/auth/v1/user') return json(route, user)
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' })
    if (!url.pathname.startsWith('/rest/v1/')) return json(route, { message: 'unexpected test request' }, 404)

    const table = url.pathname.slice('/rest/v1/'.length)
    if (table === 'rpc/persist_master_import_dry_run') {
      if (imports.rpcGate) await imports.rpcGate
      if (imports.rpcError) return json(route, { message: imports.rpcError }, 400)
      const payload = request.postDataJSON() as Record<string, unknown>
      const summary = payload.p_summary as Record<string, number>
      const rawRows = payload.p_raw_rows as unknown[]
      const batchId = `batch-${imports.batches.length + 1}`
      imports.batches.unshift({
        id: batchId, workspace_id: payload.p_workspace_id, source_type: 'MASTER_WORKBOOK',
        source_filename: payload.p_source_filename, created_at: '2026-10-25T09:00:00.000Z',
        status: 'REVIEW_REQUIRED', row_count: rawRows.length,
        product_candidate_count: summary.productCount, sku_candidate_count: summary.skuCount,
        bom_candidate_count: summary.bomCount, valid_count: summary.validCount,
        warning_count: summary.warningCount, error_count: summary.errorCount,
        deferred_count: summary.deferredCount, created_by: user.id,
      })
      return json(route, batchId)
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
    if (table === 'import_validation_issues') {
      const batchId = selected(url, 'import_batch_id')
      return json(route, batchId ? imports.issuesByBatch?.[batchId] ?? [] : [])
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

test('opens a shared saved issue and fetches its raw row only on demand', async ({ page }) => {
  const rawReads = { count: 0 }
  const batchId = 'batch-shared'
  const rawRowId = 'raw-100526'
  const imports: ImportFixture = {
    batches: [{
      id: batchId, workspace_id: 'workspace-a', source_type: 'MASTER_WORKBOOK',
      source_filename: 'shared-master.xlsx', created_at: '2026-10-25T08:30:00.000Z',
      status: 'REVIEW_REQUIRED', row_count: 3, product_candidate_count: 3,
      sku_candidate_count: 2, bom_candidate_count: 3, valid_count: 3,
      warning_count: 0, error_count: 5, deferred_count: 0, created_by: user.id,
    }],
    issuesByBatch: {
      [batchId]: [{
        id: 'issue-duplicate', workspace_id: 'workspace-a', import_batch_id: batchId,
        raw_import_row_id: rawRowId, related_raw_row_ids: [rawRowId],
        issue_code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blocking_scope: 'CANDIDATE',
        source_sheet: '단가표', source_row: 6, field_path: 'sabangnetCode',
        observed_value: '100526', expected_rule: '사방넷 품번은 한 상품을 식별해야 합니다.',
        message: '사방넷 품번 100526이 중복되었습니다.', status: 'OPEN',
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
  await expect(detail).toContainText('DUPLICATE_BUSINESS_KEY')
  await expect(detail).toContainText('Candidate 전체 Snapshot은 현재 브라우저 Dry-run 세션에서만 제공됩니다.')
  await expect(detail.getByRole('tab')).toHaveCount(0)
  await expect(detail.getByRole('button', { name: /적용|Apply/i })).toHaveCount(0)
  expect(rawReads.count).toBe(0)

  await page.getByRole('button', { name: 'DUPLICATE_BUSINESS_KEY 원본 상세' }).click()
  await expect(page.getByRole('dialog')).toContainText('저장된 원본 행')
  await expect(page.getByRole('dialog')).toContainText('#REF!')
  await expect(page.getByRole('dialog')).toContainText('수식: =A1/B1')
  expect(rawReads.count).toBe(1)
})
