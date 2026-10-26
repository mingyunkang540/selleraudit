/* global process, fetch, setTimeout */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const projectUrl = 'https://yzpkhvuftusnshdqfnim.supabase.co'
const devWorkspaceId = 'bfa4dc64-f4f9-428e-b8f9-61ff36d27db8'
const qaWorkspaceId = '5dd0c635-ac80-42ed-98a3-0f8cce4ab94a'
const evidencePath = resolve(process.env.TEMP ?? '.', 'selleraudit-5e-editor-acceptance.json')

function readEnv(filename) {
  return Object.fromEntries(readFileSync(resolve(filename), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) return []
    const raw = match[2].trim()
    return [[match[1], (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw]]
  }))
}

class AcceptanceFailure extends Error {}

function verify(value, message) {
  if (!value) throw new AcceptanceFailure(message)
}

function assertRows(result, count, message) {
  verify(!result.error && result.data?.length === count, message)
  return result.data
}

async function signIn() {
  const app = readEnv('.env.local')
  const qa = readEnv('.env.remote-test.local.txt')
  verify(app.VITE_SUPABASE_URL === projectUrl && app.VITE_SUPABASE_PUBLISHABLE_KEY, 'Remote target mismatch')
  verify(qa.SELLERAUDIT_EDITOR_EMAIL && qa.SELLERAUDIT_EDITOR_PASSWORD, 'Local EDITOR credential missing')
  const client = createClient(projectUrl, app.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: qa.SELLERAUDIT_EDITOR_EMAIL, password: qa.SELLERAUDIT_EDITOR_PASSWORD,
  })
  verify(!error && data.user && data.session, `EDITOR authentication failed (${error?.code ?? 'no session'})`)
  return { client, userId: data.user.id, qa, app }
}

async function verifyIdentity(client, userId) {
  const members = assertRows(await client.from('workspace_members')
    .select('workspace_id,role,status').eq('user_id', userId), 1, 'EDITOR membership count failed')
  verify(members[0].workspace_id === devWorkspaceId && members[0].role === 'EDITOR' && members[0].status === 'ACTIVE',
    'EDITOR membership does not match Development workspace')
  const workspaces = assertRows(await client.from('workspaces').select('id,name'), 1, 'EDITOR visible workspace count failed')
  verify(workspaces[0].id === devWorkspaceId && workspaces[0].name === '땡스소윤 DEV', 'EDITOR visible workspace mismatch')
  process.stdout.write('EDITOR LIVE AUTH AND WORKSPACE PASS\n')
}

function fixture(filename) {
  return {
    p_workspace_id: devWorkspaceId,
    p_source_filename: filename,
    p_source_file_hash: 'e'.repeat(64),
    p_summary: { productCount: 1, skuCount: 0, bomCount: 0, validCount: 0, warningCount: 0, errorCount: 1, deferredCount: 0 },
    p_raw_rows: [{ sourceSheet: '단가표', originalRowNumber: 6, sourceBlock: 'PRICE_TABLE', rawCells: [{
      address: 'B6', originalType: 'STRING', originalValue: '5E-EDITOR', formulaText: null, cachedValue: null, errorCode: null,
    }] }],
    p_candidates: [{
      kind: 'PRODUCT', candidateOrdinal: 1, sourceSheet: '단가표', sourceRow: 6,
      sourceBlock: 'PRICE_TABLE', sourceFieldMap: { sabangnetCode: 'B6' }, status: 'ERROR',
      issueCodes: ['DUPLICATE_BUSINESS_KEY'], supportingRows: [],
      normalizedValues: {
        sabangnetCode: '5E-EDITOR', productName: 'EDITOR acceptance 상품', category: '검증', productType: 'SINGLE',
        rawBomText: null, sourceQuantity: 1, sourceChannel: null, variantOfSourceRow: null,
      },
    }],
    p_issues: [{
      code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blockingScope: 'CANDIDATE',
      sourceSheet: '단가표', sourceRow: 6, fieldPath: 'sabangnetCode', observedValue: '5E-EDITOR',
      expectedRule: 'Business keys must be unique.', message: 'EDITOR acceptance validation issue.', relatedRows: [],
    }],
  }
}

async function api() {
  verify(!existsSync(evidencePath), 'Previous EDITOR acceptance evidence file exists; inspect and clean exact IDs first')
  const { client, userId } = await signIn()
  await verifyIdentity(client, userId)
  const filename = `__SELLERAUDIT_5E_EDITOR_LIVE_ACCEPTANCE__${randomUUID()}.xlsx`
  const payload = fixture(filename)
  const { data: batchId, error: saveError } = await client.rpc('persist_master_import_dry_run', payload)
  verify(!saveError && typeof batchId === 'string', `EDITOR candidate persistence failed (${saveError?.code ?? 'no batch id'})`)
  const evidence = { projectUrl, workspaceId: devWorkspaceId, editorUserId: userId, filename, batchId }
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { flag: 'wx' })
  process.stdout.write('EDITOR LIVE PERSIST PASS; exact Batch ID recorded locally\n')

  const batches = assertRows(await client.from('import_batches').select('*').eq('id', batchId), 1, 'EDITOR Batch read failed')
  const raws = assertRows(await client.from('raw_import_rows').select('*').eq('import_batch_id', batchId), 1, 'EDITOR Raw read failed')
  const candidates = assertRows(await client.from('import_candidates').select('*').eq('import_batch_id', batchId), 1, 'EDITOR Candidate read failed')
  const issues = assertRows(await client.from('import_validation_issues').select('*').eq('import_batch_id', batchId), 1, 'EDITOR Issue read failed')
  verify(batches[0].created_by === userId && batches[0].workspace_id === devWorkspaceId &&
    batches[0].source_filename === filename && batches[0].status === 'REVIEW_REQUIRED' &&
    batches[0].validation_revision === 1, 'Created Batch identity or lifecycle mismatch')
  verify(raws[0].workspace_id === devWorkspaceId && candidates[0].workspace_id === devWorkspaceId &&
    issues[0].workspace_id === devWorkspaceId && candidates[0].raw_import_row_id === raws[0].id &&
    issues[0].raw_import_row_id === raws[0].id, 'Created child provenance mismatch')
  verify(candidates[0].normalized_values.sabangnetCode === '5E-EDITOR' && candidates[0].candidate_status === 'ERROR' &&
    candidates[0].reviewed_values === null && candidates[0].review_revision === 0, 'Candidate snapshot mismatch')
  Object.assign(evidence, { rawIds: raws.map(row => row.id), candidateIds: candidates.map(row => row.id), issueIds: issues.map(row => row.id) })
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  process.stdout.write('EDITOR LIVE BATCH/RAW/CANDIDATE/ISSUE READ PASS\n')

  const activityRead = await client.from('activity_logs').select('id').limit(1)
  verify(Boolean(activityRead.error) || activityRead.data?.length === 0, 'EDITOR ActivityLog read was allowed')
  process.stdout.write('EDITOR LIVE ACTIVITYLOG READ DENY PASS\n')

  const originalCandidate = { reviewed_values: candidates[0].reviewed_values, review_note: candidates[0].review_note,
    review_revision: candidates[0].review_revision, reviewed_by: candidates[0].reviewed_by,
    reviewed_at: candidates[0].reviewed_at, normalized_values: candidates[0].normalized_values,
    candidate_status: candidates[0].candidate_status }
  const candidateReview = await client.rpc('review_import_candidate', {
    p_candidate_id: candidates[0].id, p_expected_validation_revision: 1, p_expected_review_revision: 0,
    p_reviewed_values: { sabangnetCode: '5E-EDITOR-REVIEWED' }, p_resolution: 'EDITOR permission acceptance',
  })
  verify(candidateReview.error?.code === 'P0002', `EDITOR Candidate review denial mismatch (${candidateReview.error?.code ?? 'allowed'})`)
  const candidateAfter = assertRows(await client.from('import_candidates').select('*').eq('id', candidates[0].id), 1,
    'Candidate reread failed')[0]
  verify(Object.entries(originalCandidate).every(([key, value]) => JSON.stringify(candidateAfter[key]) === JSON.stringify(value)),
    'Candidate changed after denied EDITOR review')

  const originalIssue = { status: issues[0].status, resolution: issues[0].resolution,
    review_revision: issues[0].review_revision, reviewed_by: issues[0].reviewed_by, reviewed_at: issues[0].reviewed_at }
  const issueReview = await client.rpc('review_import_validation_issue', {
    p_issue_id: issues[0].id, p_expected_validation_revision: 1, p_expected_review_revision: 0,
    p_status: 'RESOLVED', p_resolution: 'EDITOR permission acceptance',
  })
  verify(issueReview.error?.code === 'P0002', `EDITOR Issue review denial mismatch (${issueReview.error?.code ?? 'allowed'})`)
  const issueAfter = assertRows(await client.from('import_validation_issues').select('*').eq('id', issues[0].id), 1,
    'Issue reread failed')[0]
  verify(Object.entries(originalIssue).every(([key, value]) => JSON.stringify(issueAfter[key]) === JSON.stringify(value)),
    'Issue changed after denied EDITOR review')
  process.stdout.write('EDITOR LIVE CANDIDATE/ISSUE REVIEW DENY AND IMMUTABILITY PASS\n')

  for (const table of ['import_batches', 'raw_import_rows', 'import_candidates', 'import_validation_issues']) {
    const response = await client.from(table).select('id').eq('workspace_id', qaWorkspaceId).limit(1)
    verify(Boolean(response.error) || response.data?.length === 0, `EDITOR cross-workspace ${table} read was allowed`)
  }
  const crossSave = await client.rpc('persist_master_import_dry_run', { ...fixture(`__SELLERAUDIT_5E_EDITOR_REJECTED__${randomUUID()}.xlsx`),
    p_workspace_id: qaWorkspaceId })
  verify(Boolean(crossSave.error) && !crossSave.data, 'EDITOR cross-workspace persistence was allowed')
  process.stdout.write('EDITOR LIVE CROSS-WORKSPACE READ/PERSIST DENY PASS\n')
  await client.auth.signOut()
}

async function browser() {
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  verify(evidence.projectUrl === projectUrl && evidence.workspaceId === devWorkspaceId, 'Local evidence target mismatch')
  const { qa, app } = await signIn()
  const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], {
    stdio: 'ignore', env: { ...process.env, VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_URL: projectUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: app.VITE_SUPABASE_PUBLISHABLE_KEY },
  })
  let playwright
  try {
    let ready = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch('http://127.0.0.1:4182')).ok) { ready = true; break } } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    verify(ready, 'Local Vite server did not start')
    playwright = await chromium.launch()
    const context = await playwright.newContext()
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4182/#/import/master')
    await page.getByLabel('이메일').fill(qa.SELLERAUDIT_EDITOR_EMAIL)
    await page.getByLabel('비밀번호').fill(qa.SELLERAUDIT_EDITOR_PASSWORD)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await page.getByRole('heading', { name: 'Master Excel 분석' }).waitFor({ timeout: 20000 })
    const detail = page.getByRole('region', { name: '저장된 Batch 상세' })
    await page.getByRole('button', { name: `${evidence.filename} 배치 상세 보기` }).click()
    await detail.getByText(evidence.batchId).waitFor({ timeout: 20000 })
    await detail.getByRole('button', { name: '후보 상세' }).click()
    let drawer = page.getByRole('dialog')
    await drawer.getByRole('heading', { name: 'Parser 정규화 값' }).waitFor()
    await drawer.getByRole('heading', { name: '사람의 검토값' }).waitFor()
    await drawer.getByText('EDITOR는 검토 내용을 조회할 수 있으며 변경할 수 없습니다.').waitFor()
    verify(await drawer.getByRole('button', { name: '검토 저장' }).count() === 0, 'EDITOR Candidate review button visible')
    await drawer.getByRole('button', { name: '닫기' }).click()
    await detail.getByRole('button', { name: '이슈 상세' }).click()
    drawer = page.getByRole('dialog')
    await drawer.getByText('EDITOR는 이슈 상태와 처리 근거를 조회할 수 있으며 변경할 수 없습니다.').waitFor()
    verify(await drawer.getByRole('button', { name: '이슈 결정 저장' }).count() === 0, 'EDITOR Issue review button visible')
    await context.close()
    process.stdout.write('EDITOR LIVE BROWSER LOGIN/IMPORT/DETAIL/READONLY PASS\n')
  } finally {
    if (playwright) await playwright.close()
    vite.kill()
  }
}

try {
  if (process.argv[2] === 'api') await api()
  else if (process.argv[2] === 'browser') await browser()
  else throw new Error('Specify api or browser')
} catch (error) {
  process.stderr.write(`EDITOR LIVE ACCEPTANCE FAILED: ${error instanceof AcceptanceFailure ? error.message : error instanceof Error ? error.name : 'unknown'}\n`)
  process.exitCode = 1
}
