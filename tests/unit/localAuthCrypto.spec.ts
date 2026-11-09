import { expect, test } from '@playwright/test'
import { hashPassword, normalizeEmail, randomToken, tokenHash, tokenMatches, verifyPassword } from '../../server/auth/crypto'

test('normalizes company email and rejects malformed identifiers', () => {
  expect(normalizeEmail('  Staff@Example.com ')).toBe('staff@example.com')
  for (const email of ['', 'name', 'a@b', 'a@@example.com']) expect(() => normalizeEmail(email)).toThrow()
})

test('passwords use salted Argon2id and enforce minimum length', async () => {
  await expect(hashPassword('123456789')).rejects.toThrow('Password length is invalid')
  const minimum = await hashPassword('1234567890')
  expect(await verifyPassword(minimum, '1234567890')).toBe(true)
  const first = await hashPassword('example password 123')
  const second = await hashPassword('example password 123')
  expect(first).toMatch(/^\$argon2id\$/)
  expect(first).not.toBe(second)
  expect(await verifyPassword(first, 'example password 123')).toBe(true)
  expect(await verifyPassword(first, 'wrong password')).toBe(false)
})

test('tokens are random, hashed, and checked without storing raw values', () => {
  const first = randomToken()
  const second = randomToken()
  expect(first).not.toBe(second)
  expect(tokenMatches(first, tokenHash(first))).toBe(true)
  expect(tokenMatches(second, tokenHash(first))).toBe(false)
  expect(tokenMatches(first, 'invalid')).toBe(false)
})
