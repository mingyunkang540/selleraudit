import { expect, test, type Page, type Route } from '@playwright/test'

type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'
type WorkspaceFixture = { id: string; name: string; role: Role; productName?: string }

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

async function installFakeSupabase(page: Page, workspaces: WorkspaceFixture[]) {
  await page.route('http://127.0.0.1:54321/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/auth/v1/token') return json(route, session)
    if (url.pathname === '/auth/v1/user') return json(route, user)
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' })
    if (!url.pathname.startsWith('/rest/v1/')) return json(route, { message: 'unexpected test request' }, 404)

    const table = url.pathname.slice('/rest/v1/'.length)
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
    if (['skus', 'product_components', 'channels', 'channel_listings', 'channel_offers', 'aliases', 'audit_issues'].includes(table)) {
      return json(route, [])
    }
    return json(route, { message: `unexpected table ${table}` }, 404)
  })
}

async function login(page: Page) {
  await page.getByLabel('이메일').fill(user.email)
  await page.getByLabel('비밀번호').fill('test-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
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
})
