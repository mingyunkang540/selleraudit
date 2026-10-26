/* global process */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

function readEnv(filename) {
  const values = {}
  for (const line of readFileSync(resolve(filename), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const raw = match[2].trim()
    values[match[1]] = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1) : raw
  }
  return values
}

const app = readEnv('.env.local')
const qa = readEnv('.env.remote-test.local.txt')
if (app.VITE_SUPABASE_URL !== 'https://yzpkhvuftusnshdqfnim.supabase.co' || !app.VITE_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Remote 5E target is not the expected Development project.')
}

let failures = 0
for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'DISABLED']) {
  const email = qa[`SELLERAUDIT_${role}_EMAIL`]
  const password = qa[`SELLERAUDIT_${role}_PASSWORD`]
  if (!email || !password) throw new Error(`${role} local acceptance credentials are missing.`)
  const client = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user || !data.session) {
    process.stdout.write(`${role} LIVE AUTH FAIL (${error?.code ?? 'no session'})\n`)
    failures += 1
    continue
  }
  const { data: members, error: membershipError } = await client.from('workspace_members')
    .select('workspace_id,role,status').eq('user_id', data.user.id)
  if (membershipError) throw new Error(`${role} membership lookup failed: ${membershipError.code}`)
  const membershipMatches = role === 'DISABLED'
    ? !members?.some(member => member.status === 'ACTIVE')
    : members?.some(member => member.role === role && member.status === 'ACTIVE')
  if (!membershipMatches) {
    process.stdout.write(`${role} LIVE AUTH FAIL (unexpected visible membership)\n`)
    failures += 1
    await client.auth.signOut()
    continue
  }
  await client.auth.signOut()
  process.stdout.write(`${role} LIVE AUTH PASS\n`)
}
if (failures) process.exitCode = 1
