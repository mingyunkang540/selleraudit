import { expect, test } from '@playwright/test'
import { priceStatus } from '../../src/features/channels/priceStatus'

test('channel price is abnormal only outside confirmed normal and live prices', () => {
  expect(priceStatus(101,100,50)).toBe('PRICE_MISMATCH')
  expect(priceStatus(49,100,50)).toBe('PRICE_MISMATCH')
  expect(priceStatus(100,100,50)).toBe('NORMAL')
  expect(priceStatus(50,100,50)).toBe('NORMAL')
  expect(priceStatus(75,100,50)).toBe('NORMAL')
  expect(priceStatus(75,null,50)).toBe('REVIEW')
  expect(priceStatus(null,100,50)).toBe('REVIEW')
  expect(priceStatus(75,50,100)).toBe('REVIEW')
})
