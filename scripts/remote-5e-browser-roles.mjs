/* global process, fetch, setTimeout */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

function readEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) return []
    const raw = match[2].trim()
    return [[match[1], ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) ? raw.slice(1, -1) : raw]]
  }))
}

const app = readEnv('.env.local')
const qa = readEnv('.env.remote-test.local.txt')
if (app.VITE_SUPABASE_URL !== 'https://yzpkhvuftusnshdqfnim.supabase.co') throw new Error('Unexpected remote project')
const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], {
  stdio: 'ignore', env: { ...process.env, VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_URL: app.VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: app.VITE_SUPABASE_PUBLISHABLE_KEY },
})
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:4182')).ok) { ready = true; break } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error('Local Vite server did not start')
  browser = await chromium.launch()
  for (const role of ['VIEWER', 'DISABLED']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4182/#/import/master')
    await page.getByLabel('이메일').fill(qa[`SELLERAUDIT_${role}_EMAIL`])
    await page.getByLabel('비밀번호').fill(qa[`SELLERAUDIT_${role}_PASSWORD`])
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    const heading = role === 'VIEWER' ? '접근할 수 없습니다' : '접근 가능한 워크스페이스가 없습니다'
    await page.getByRole('heading', { name: heading }).waitFor({ timeout: 20000 })
    process.stdout.write(`${role} LIVE BROWSER DENY PASS\n`)
    await context.close()
  }
} catch (error) {
  process.stderr.write(`LIVE BROWSER ROLE CHECK FAILED: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  vite.kill()
}
