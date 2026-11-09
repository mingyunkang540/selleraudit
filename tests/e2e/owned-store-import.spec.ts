import { expect, test } from '@playwright/test'
import { createSeedData } from '../../src/mock'

test('가져오기 화면에서 이전 자사몰 일회성 등록 기능을 표시하지 않는다', async ({ page }) => {
  const data = createSeedData()
  let oldImportRequested = false
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/import/owned-store/')) oldImportRequested = true
    if (path === '/api/auth/session') return route.fulfill({ json: { openMode: true, user: { userId: 'u', workspaceId: data.workspace.id, role: 'ADMIN', email: 'admin@example.com', displayName: 'Admin' }, csrf: 'fake', importEnabled: true } })
    if (path === '/api/data') return route.fulfill({ json: data })
    return route.fulfill({ json: { configurations: [], bindings: [], employees: [], batches: [] } })
  })
  await page.goto('/#/import/master')
  await expect(page.getByRole('heading', { name: 'Master Excel 분석' })).toBeVisible()
  await expect(page.getByRole('button', { name: '자사몰 상품 등록' })).toHaveCount(0)
  expect(oldImportRequested).toBe(false)
})
