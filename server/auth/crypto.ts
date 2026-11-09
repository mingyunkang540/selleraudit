import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'

const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email')
  return email
}

export async function hashPassword(value: string): Promise<string> {
  if (value.length < 10 || Buffer.byteLength(value, 'utf8') > 1024) throw new Error('Password length is invalid')
  return argon2.hash(value, options)
}

export async function verifyPassword(hash: string, value: string): Promise<boolean> {
  if (Buffer.byteLength(value, 'utf8') > 1024) return false
  try { return await argon2.verify(hash, value) } catch { return false }
}

export function randomToken(): string { return randomBytes(32).toString('base64url') }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex') }
export function tokenMatches(token: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false
  return timingSafeEqual(Buffer.from(tokenHash(token), 'hex'), Buffer.from(expected, 'hex'))
}
