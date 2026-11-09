import { expect, test } from '@playwright/test'
import { createSeedData } from '../../src/mock'

test('가격 정보를 불러오지 못하면 채널 현황에 임시 수치를 표시하지 않는다', async ({ page }) => {
  const data = createSeedData()
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') return route.fulfill({ json: { openMode: true, user: { userId: 'u', workspaceId: data.workspace.id, role: 'ADMIN', email: 'admin@example.com', displayName: '관리자' }, csrf: 'fake' } })
    if (path === '/api/data') return route.fulfill({ json: data })
    if (path === '/api/product-configurations') return route.fulfill({ json: { configurations: [], bindings: [] } })
    if (path === '/api/product-prices') return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
  await page.goto('/#/dashboard')
  await expect(page.getByText('가격 또는 구성 정보를 불러오지 못해 채널별 상태를 확인할 수 없습니다.')).toBeVisible()
  await expect(page.getByRole('img', { name: /정상 .*미등록/ })).toHaveCount(0)
})
