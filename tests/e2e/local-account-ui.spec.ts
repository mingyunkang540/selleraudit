import { expect, test } from '@playwright/test'

test('활성화 화면을 열고 로그인으로 돌아갈 수 있다', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ status: 401, json: { error: 'login' } }))
  await page.goto('/')
  await page.getByRole('button', { name: '활성화 코드로 계정 설정' }).click()
  await expect(page.getByRole('heading', { name: '계정 활성화' })).toBeVisible()
  await expect(page.getByLabel('일회용 활성화 코드')).toBeVisible()
  await page.getByRole('button', { name: '로그인으로 돌아가기' }).click()
  await expect(page.getByRole('heading', { name: 'SellerAudit 로그인' })).toBeVisible()
})

test('로컬 워크스페이스 정보와 계정 관리 연결을 표시한다', async ({ page }) => {
  const workspace = { id: 'w', name: '작업 공간', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') return route.fulfill({ json: { user: { userId: 'u', workspaceId: 'w', role: 'ADMIN', email: 'admin@example.com', displayName: '관리자' }, csrf: 'fake' } })
    if (path === '/api/employees') return route.fulfill({ json: { employees: [{id:'u',email:'admin@example.com',display_name:'관리자',status:'ACTIVE',membership_status:'ACTIVE',role:'ADMIN',online:true},{id:'v',email:'viewer@example.com',display_name:'직원',status:'ACTIVE',membership_status:'ACTIVE',role:'VIEWER',online:false}] } })
    if (path === '/api/auth/presence') return route.fulfill({json:{ok:true}})
    if (path === '/api/data') return route.fulfill({ json: { workspace, products: [], skus: [], components: [], channels: [], listings: [], offers: [], aliases: [], issues: [] } })
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '상품 조회 화면 열기' }).click()
  await page.getByRole('link', { name: '워크스페이스', exact: true }).click()
  await expect(page.getByText('서버 PC의 로컬 데이터베이스')).toBeVisible()
  await expect(page.getByText('Supabase 개발 프로젝트')).toHaveCount(0)
  await page.getByRole('button', { name: /계정 관리/ }).click()
  await expect(page.getByRole('heading', { name: '계정 관리' })).toBeVisible()
  await expect(page.getByRole('row',{name:/관리자.*접속 중/})).toBeVisible()
  await expect(page.getByRole('row',{name:/직원.*접속 확인 안 됨/})).toBeVisible()
})
