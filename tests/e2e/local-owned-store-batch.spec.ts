import { expect, test } from '@playwright/test'
import { createSeedData } from '../../src/mock'

test('매핑 화면에 지난 자사몰 일회성 연결을 표시하지 않는다', async ({ page }) => {
  const data = createSeedData()
  let requested = false
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/mapping/own-store-prepared') requested = true
    if (path === '/api/auth/session') return route.fulfill({ json: { openMode: true, user: { userId: 'u', workspaceId: data.workspace.id, role: 'ADMIN', email: 'admin@example.com', displayName: 'Admin' }, csrf: 'fake', importEnabled: true } })
    if (path === '/api/data') return route.fulfill({ json: data })
    if (path === '/api/product-configurations') return route.fulfill({ json: { configurations: [], bindings: [] } })
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
  await page.goto('/#/mapping')
  await expect(page.getByRole('heading', { name: '매핑 센터' })).toBeVisible()
  await expect(page.getByRole('button', { name: '확인된 자사몰 품목 연결' })).toHaveCount(0)
  expect(requested).toBe(false)
})
