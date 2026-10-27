import { expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildMasterImportPayload, createImportPersistence, ImportPersistenceError,
  MASTER_IMPORT_PARSER_VERSION, MASTER_IMPORT_SOURCE_SCOPE_KEY,
} from '../../src/services/importPersistence'
import type { MasterImportPreview } from '../../src/types/import'

const workspaceId = 'workspace-a'
const batchId = 'batch-a'
const hash = 'a'.repeat(64)
const sourceFileId = '00000000-0000-4000-8000-000000000099'

function preview(): MasterImportPreview {
  return {
    workbook: { fileName: '원본.xlsx', sheetNames: ['단가표'], requiredSheets: ['단가표'], schemaValid: true },
    rawRows: [{ sourceSheet: '단가표', originalRowNumber: 6, sourceBlock: 'PRODUCT', rawCells: [
      { address: 'B6', originalType: 'FORMULA', originalValue: null, formulaText: 'A6/0', cachedValue: '#DIV/0!', errorCode: '#DIV/0!' },
      { address: 'C6', originalType: 'ERROR', originalValue: '#REF!', formulaText: null, cachedValue: null, errorCode: '#REF!' },
    ] }],
    products: [{ kind: 'PRODUCT', id: 'p1', sourceSheet: '단가표', sourceRow: 6, sourceBlock: 'PRODUCT',
      sourceFieldMap: {}, status: 'ERROR', issueCodes: ['DUPLICATE_BUSINESS_KEY'], sabangnetCode: '100526',
      productName: '중복', category: null, productType: null, rawBomText: null, sourceQuantity: null,
      sourceChannel: null, variantOfSourceRow: null }],
    skus: [], bomComponents: [],
    issues: [{ id: 'i1', code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blockingScope: 'BATCH',
      sourceSheet: '단가표', sourceRow: 6, fieldPath: 'sabangnetCode', observedValue: '100526',
      message: '중복 품번', expectedRule: '고유 품번', relatedRows: [6] }],
    summary: { rowCount: 1, productCount: 1, skuCount: 0, bomCount: 0,
      validCount: 0, warningCount: 0, errorCount: 1, deferredCount: 0, blockingCount: 1 },
    blocked: true,
  }
}

function batchRow(overrides: Record<string, unknown> = {}) {
  return { id: batchId, workspace_id: workspaceId, source_type: 'MASTER_WORKBOOK',
    source_filename: '원본.xlsx', created_at: '2026-10-25T00:00:00Z', status: 'REVIEW_REQUIRED',
    validation_revision: 1,
    row_count: 1, product_candidate_count: 1, sku_candidate_count: 0, bom_candidate_count: 0,
    valid_count: 0, warning_count: 0, error_count: 1, deferred_count: 0, created_by: 'user-a', ...overrides }
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters = new Map<string, unknown>()
  private start = 0
  private end = Number.MAX_SAFE_INTEGER
  private max = Number.MAX_SAFE_INTEGER
  constructor(private readonly records: Record<string, unknown>[], private readonly ignoreFilters = false) {}
  select() { return this }
  eq(key: string, value: unknown) { this.filters.set(key, value); return this }
  order() { return this }
  range(start: number, end: number) { this.start = start; this.end = end; return this }
  limit(max: number) { this.max = max; return this }
  single() {
    const result = this.rows()
    return Promise.resolve({ data: result[0] ?? null, error: result.length ? null : new Error('not found') })
  }
  private rows() {
    return this.records.filter(row => this.ignoreFilters || [...this.filters].every(([key, value]) => row[key] === value))
      .slice(this.start, this.end + 1).slice(0, this.max)
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows(), error: null }).then(onfulfilled, onrejected)
  }
}

function fakeClient(tables: Record<string, Record<string, unknown>[]>, rpc: (name: string, args: unknown) => unknown = () => ({ data: batchId, error: null })) {
  const calls: { name: string; args: unknown }[] = []
  const supabase = {
    from: (name: string) => new Query(tables[name] ?? []),
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args })
      return rpc(name, args)
    },
  } as unknown as SupabaseClient
  return { supabase, calls }
}

test('maps preview to one atomic payload with immutable candidate snapshots and no actor fields', () => {
  const payload = buildMasterImportPayload(preview(), hash)
  expect(payload.p_summary).toEqual({ productCount: 1, skuCount: 0, bomCount: 0,
    validCount: 0, warningCount: 0, errorCount: 1, deferredCount: 0 })
  expect(payload.p_raw_rows).toHaveLength(1)
  expect(payload.p_raw_rows[0].rawCells).toEqual(preview().rawRows[0].rawCells)
  expect(payload.p_candidates).toEqual([expect.objectContaining({
    kind: 'PRODUCT', candidateOrdinal: 1, sourceSheet: '단가표', sourceRow: 6,
    status: 'ERROR', supportingRows: [], normalizedValues: {
      sabangnetCode: '100526', productName: '중복', category: null, productType: null,
      rawBomText: null, sourceQuantity: null, sourceChannel: null, variantOfSourceRow: null,
    },
  })])
  expect(payload.p_issues).toEqual([expect.objectContaining({
    code: 'DUPLICATE_BUSINESS_KEY', sourceSheet: '단가표', sourceRow: 6,
    observedValue: '100526', relatedRows: [6],
  })])
  expect(Object.keys(payload)).not.toContain('p_products')
  expect(Object.keys(payload)).not.toContain('p_skus')
  expect(Object.keys(payload)).not.toContain('p_bom_components')
  expect(JSON.stringify(payload)).not.toContain('created_by')
  expect(MASTER_IMPORT_SOURCE_SCOPE_KEY).toBe('WORKBOOK')
  expect(MASTER_IMPORT_PARSER_VERSION).toBe('master-v1.0.0')
})

test('rejects malformed hash, summary, duplicate raw keys, and unmatched issue location', () => {
  expect(() => buildMasterImportPayload(preview(), 'BAD')).toThrow(ImportPersistenceError)
  const base = preview()
  expect(() => buildMasterImportPayload({ ...base, summary: { ...base.summary, rowCount: 2 } }, hash)).toThrow(/건수/)
  expect(() => buildMasterImportPayload({ ...base, rawRows: [base.rawRows[0], base.rawRows[0]],
    summary: { ...base.summary, rowCount: 2 } }, hash)).toThrow(/중복/)
  expect(() => buildMasterImportPayload({ ...base, issues: [{ ...base.issues[0], sourceRow: 999 }] }, hash)).toThrow(/원본 행/)
  expect(() => buildMasterImportPayload({ ...base, products: [{ ...base.products[0], sourceRow: 999 }] }, hash)).toThrow(/후보의 원본 행/)
  expect(() => buildMasterImportPayload({ ...base, summary: { ...base.summary, errorCount: 0, validCount: 1 } }, hash)).toThrow(/후보 상태별/)
})

test('candidate ordinals restart per kind and supporting evidence uses a real raw row', () => {
  const base = preview()
  const extra = {
    ...base,
    rawRows: [
      ...base.rawRows,
      { sourceSheet: '단가표', originalRowNumber: 7, sourceBlock: 'PRODUCT', rawCells: [] },
      { sourceSheet: '코드DB', originalRowNumber: 4, sourceBlock: 'SKU', rawCells: [] },
    ],
    products: [{ ...base.products[0], variantOfSourceRow: 7 }],
    skus: [{ kind: 'SKU' as const, id: 's1', sourceSheet: '코드DB', sourceRow: 4,
      sourceBlock: 'SKU', sourceFieldMap: {}, status: 'VALID' as const, issueCodes: [],
      skuCode: 'AL00', modelName: '점보 라벤더', color: '라벤더', sourceCategory: '냉동용기',
      registryStatus: 'BOM_REGISTRY' as const }],
    bomComponents: [{ kind: 'BOM_COMPONENT' as const, id: 'b1', sourceSheet: '단가표', sourceRow: 6,
      sourceBlock: 'PRODUCT', sourceFieldMap: {}, status: 'DEFERRED' as const, issueCodes: [],
      productCode: '100526', productSourceRow: 6, skuCode: 'AL00', quantity: 1, rawToken: 'AL00 1개' }],
    summary: { ...base.summary, rowCount: 3, skuCount: 1, bomCount: 1, validCount: 1, deferredCount: 1 },
  } satisfies MasterImportPreview
  const candidates = buildMasterImportPayload(extra, hash).p_candidates
  expect(candidates.map(candidate => [candidate.kind, candidate.candidateOrdinal])).toEqual([
    ['PRODUCT', 1], ['SKU', 1], ['BOM_COMPONENT', 1],
  ])
  expect(candidates[0].supportingRows).toEqual([7])
  expect(candidates[1].normalizedValues).toEqual({
    skuCode: 'AL00', modelName: '점보 라벤더', color: '라벤더',
    sourceCategory: '냉동용기', registryStatus: 'BOM_REGISTRY',
  })
  expect(candidates[2].normalizedValues).toEqual({
    productCode: '100526', productSourceRow: 6, skuCode: 'AL00', quantity: 1, rawToken: 'AL00 1개',
  })
})

test('save uses trusted RPC and returns batch id; errors do not leak database detail', async () => {
  const fake = fakeClient({})
  const persistence = createImportPersistence({ supabase: fake.supabase, workspaceId })
  await expect(persistence.saveMasterDryRun(preview(), sourceFileId, hash)).resolves.toBe(batchId)
  const payload = buildMasterImportPayload(preview(), hash)
  expect(fake.calls).toEqual([{ name: 'persist_verified_master_import_dry_run', args: {
    p_workspace_id: workspaceId, p_source_file_id: sourceFileId,
    p_summary: payload.p_summary, p_raw_rows: payload.p_raw_rows,
    p_candidates: payload.p_candidates, p_issues: payload.p_issues,
  } }])
  const failed = createImportPersistence({
    supabase: fakeClient({}, () => ({ data: null, error: new Error('secret SQL detail') })).supabase,
    workspaceId,
  })
  await expect(failed.saveMasterDryRun(preview(), sourceFileId, hash)).rejects.toThrow('Dry-run 저장에 실패했습니다.')
})

test('lists only selected workspace Master batches and maps candidate counts', async () => {
  const fake = fakeClient({ import_batches: [batchRow(), batchRow({ id: 'other', source_type: 'SALES_WORKBOOK' }),
    batchRow({ id: 'foreign', workspace_id: 'workspace-b' })] })
  const saved = await createImportPersistence({ supabase: fake.supabase, workspaceId }).listSavedMasterImports()
  expect(saved).toEqual([{ id: batchId, sourceFilename: '원본.xlsx', createdAt: '2026-10-25T00:00:00Z',
    status: 'REVIEW_REQUIRED', validationRevision: 1, rowCount: 1, productCount: 1, skuCount: 0, bomCount: 0,
    validCount: 0, warningCount: 0, errorCount: 1, deferredCount: 0, createdBy: 'user-a',
    sourceFileId: null, sourceHashVerification: 'CLIENT_OBSERVED', sourceHash: '', parserVersion: '' }])
})

test('loads saved issue provenance and raw cells only on explicit detail request', async () => {
  const raw = { id: 'raw-1', workspace_id: workspaceId, source_sheet: '단가표', original_row_number: 6,
    source_block: 'PRODUCT', raw_cells: preview().rawRows[0].rawCells }
  const issue = { id: 'issue-1', workspace_id: workspaceId, import_batch_id: batchId, raw_import_row_id: raw.id,
    related_raw_row_ids: [raw.id], issue_code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blocking_scope: 'BATCH',
    source_sheet: '단가표', source_row: 6, field_path: 'sabangnetCode', observed_value: '100526',
    expected_rule: '고유 품번', message: '중복 품번', status: 'OPEN', validation_revision: 1,
    review_revision: 0, resolution: null, reviewed_by: null, reviewed_at: null }
  const seen: string[] = []
  const fake = fakeClient({ import_batches: [batchRow()], import_validation_issues: [issue], raw_import_rows: [raw] })
  const from = fake.supabase.from.bind(fake.supabase)
  fake.supabase.from = ((name: string) => { seen.push(name); return from(name) }) as typeof fake.supabase.from
  const persistence = createImportPersistence({ supabase: fake.supabase, workspaceId })
  const issues = await persistence.loadSavedImportIssues(batchId)
  expect(issues).toEqual([expect.objectContaining({ issueCode: 'DUPLICATE_BUSINESS_KEY', sourceSheet: '단가표',
    sourceRow: 6, rawImportRowId: raw.id, relatedRawRowIds: [raw.id] })])
  expect(seen).not.toContain('raw_import_rows')
  const rawDetail = await persistence.loadRawImportRow(raw.id)
  expect(rawDetail.rawCells).toEqual(preview().rawRows[0].rawCells)
  expect(seen).toContain('raw_import_rows')
})

test('loads candidate evidence and keeps normalized and reviewed values distinct', async () => {
  const candidate = {
    id: 'candidate-1', workspace_id: workspaceId, import_batch_id: batchId,
    raw_import_row_id: 'raw-1', supporting_raw_row_ids: [], validation_revision: 1,
    candidate_ordinal: 1, kind: 'PRODUCT', source_sheet: '단가표', source_row: 6,
    source_block: 'PRODUCT', source_field_map: { sabangnetCode: 'B6' },
    normalized_values: { sabangnetCode: '100526' }, candidate_status: 'ERROR',
    issue_codes: ['DUPLICATE_BUSINESS_KEY'], reviewed_values: { sabangnetCode: '100999' },
    review_note: '원본 소유자 확인', review_revision: 1, reviewed_by: 'admin-1',
    reviewed_at: '2026-10-25T01:00:00Z',
  }
  const fake = fakeClient({ import_batches: [batchRow()], import_candidates: [candidate] })
  const saved = await createImportPersistence({ supabase: fake.supabase, workspaceId })
    .loadSavedImportCandidates(batchId)
  expect(saved).toEqual([expect.objectContaining({
    id: 'candidate-1', sourceSheet: '단가표', sourceRow: 6, reviewRevision: 1,
    normalizedValues: { sabangnetCode: '100526' }, reviewedValues: { sabangnetCode: '100999' },
  })])
  expect(candidate.normalized_values).toEqual({ sabangnetCode: '100526' })
})

test('rejects cross-workspace or malformed candidate response rows', async () => {
  const base = {
    id: 'candidate-1', workspace_id: workspaceId, import_batch_id: batchId,
    raw_import_row_id: 'raw-1', supporting_raw_row_ids: [], validation_revision: 1,
    candidate_ordinal: 1, kind: 'PRODUCT', source_sheet: '단가표', source_row: 6,
    source_block: 'PRODUCT', source_field_map: {}, normalized_values: {},
    candidate_status: 'VALID', issue_codes: [], reviewed_values: null, review_note: null,
    review_revision: 0, reviewed_by: null, reviewed_at: null,
  }
  for (const row of [{ ...base, workspace_id: 'workspace-b' }, { ...base, source_field_map: [] }]) {
    const fake = fakeClient({ import_batches: [batchRow()] })
    fake.supabase.from = ((name: string) => name === 'import_candidates'
      ? new Query([row], true) : new Query([batchRow()])) as unknown as typeof fake.supabase.from
    await expect(createImportPersistence({ supabase: fake.supabase, workspaceId }).loadSavedImportCandidates(batchId))
      .rejects.toThrow('저장된 후보를 불러오지 못했습니다.')
  }
})

test('review calls use revision guards and report errors without leaking SQL details', async () => {
  const fake = fakeClient({}, () => ({ data: null, error: null }))
  const persistence = createImportPersistence({ supabase: fake.supabase, workspaceId })
  await persistence.reviewCandidate('candidate-1', 1, 0, { sabangnetCode: '100999' }, '소유자 확인')
  await persistence.reviewIssue('issue-1', 1, 0, 'RESOLVED', '소유자 확인')
  expect(fake.calls).toEqual([
    { name: 'review_import_candidate', args: {
      p_candidate_id: 'candidate-1', p_expected_validation_revision: 1,
      p_expected_review_revision: 0, p_reviewed_values: { sabangnetCode: '100999' },
      p_resolution: '소유자 확인',
    } },
    { name: 'review_import_validation_issue', args: {
      p_issue_id: 'issue-1', p_expected_validation_revision: 1,
      p_expected_review_revision: 0, p_status: 'RESOLVED', p_resolution: '소유자 확인',
    } },
  ])
  await expect(persistence.reviewIssue('issue-1', 1, 0, 'DEFERRED', '')).rejects.toThrow('이슈 검토 입력이 올바르지 않습니다.')
  const failed = createImportPersistence({
    supabase: fakeClient({}, () => ({ data: null, error: new Error('secret SQL detail') })).supabase,
    workspaceId,
  })
  await expect(failed.reviewCandidate('candidate-1', 1, 0, {}, '소유자 확인'))
    .rejects.toThrow('후보 검토 저장에 실패했습니다. 최신 기록을 다시 확인해 주세요.')
})

test('rejects cross-workspace response rows even if remote query is compromised', async () => {
  const fake = fakeClient({ import_batches: [batchRow({ workspace_id: 'workspace-b' })] })
  // A hostile result bypasses the fake filter; the mapper still enforces workspace ownership.
  fake.supabase.from = (() => new Query([batchRow({ workspace_id: 'workspace-b' })], true)) as unknown as typeof fake.supabase.from
  await expect(createImportPersistence({ supabase: fake.supabase, workspaceId }).listSavedMasterImports())
    .rejects.toThrow('저장된 Dry-run 목록을 불러오지 못했습니다.')
})

test('malformed stored raw cells fail safely instead of crashing the shared review drawer', async () => {
  for (const malformed of [null, {}, { address: 'A1', originalType: 'ERROR', originalValue: {} }]) {
    const fake = fakeClient({ raw_import_rows: [{
      id: 'raw-bad', workspace_id: workspaceId, source_sheet: '단가표', original_row_number: 6,
      source_block: null, raw_cells: [malformed],
    }] })
    await expect(createImportPersistence({ supabase: fake.supabase, workspaceId }).loadRawImportRow('raw-bad'))
      .rejects.toThrow('원본 행을 불러오지 못했습니다.')
  }
})

const applyCounts = {
  productNew: 1, productUpdate: 1, productUnchanged: 0, productConflict: 0, productSkipped: 1,
  skuNew: 1, skuUpdate: 1, skuUnchanged: 0, skuConflict: 0, skuSkipped: 0,
  bomNew: 1, bomUpdate: 1, bomUnchanged: 0, bomConflict: 0, bomSkipped: 0,
  blockingBatchIssues: 0,
}

test('maps apply preview rows and calls the read-only RPC with only the batch id', async () => {
  const response = { batchId, canApply: true, ...applyCounts, rows: [
    { candidateId: 'candidate-product', kind: 'PRODUCT', status: 'NEW', businessKey: '100001' },
    { candidateId: 'candidate-update', kind: 'PRODUCT', status: 'UPDATE', businessKey: '100002', changes: {
      productName: { before: '점보', after: '점보 냉동용기' }, category: { before: null, after: '보관용기' },
    } },
    { candidateId: 'candidate-warning', kind: 'PRODUCT', status: 'SKIPPED_WARNING', businessKey: '100002', reason: 'VALID 후보만 적용합니다.' },
  ] }
  const fake = fakeClient({}, () => ({ data: response, error: null }))
  await expect(createImportPersistence({ supabase: fake.supabase, workspaceId }).previewMasterImportApply(batchId))
    .resolves.toEqual(response)
  expect(fake.calls).toEqual([{ name: 'preview_master_import_apply', args: { p_batch_id: batchId } }])
})

test('maps apply result counts and never exposes malformed or database error details', async () => {
  const response = { batchId, ...applyCounts, finalBatchStatus: 'PARTIALLY_APPLIED', appliedCount: 3, remainingCount: 1 }
  const fake = fakeClient({}, () => ({ data: response, error: null }))
  await expect(createImportPersistence({ supabase: fake.supabase, workspaceId }).applyMasterImportBatch(batchId))
    .resolves.toEqual(response)
  expect(fake.calls).toEqual([{ name: 'apply_master_import_batch', args: { p_batch_id: batchId } }])

  for (const data of [
    { ...response, batchId: 'other-batch' },
    { ...response, productNew: -1 },
    { ...response, finalBatchStatus: 'REVIEW_REQUIRED' },
  ]) {
    const malformed = fakeClient({}, () => ({ data, error: null }))
    await expect(createImportPersistence({ supabase: malformed.supabase, workspaceId }).applyMasterImportBatch(batchId))
      .rejects.toThrow('Master 적용에 실패했습니다. 배치 상태와 충돌 여부를 다시 확인해 주세요.')
  }
  const failed = fakeClient({}, () => ({ data: null, error: new Error('secret SQL detail') }))
  await expect(createImportPersistence({ supabase: failed.supabase, workspaceId }).previewMasterImportApply(batchId))
    .rejects.toThrow('Master 적용 미리보기를 불러오지 못했습니다.')
})

test('rejects unknown preview row states and batch mismatches', async () => {
  for (const data of [
    { batchId: 'other-batch', canApply: true, ...applyCounts, rows: [] },
    { batchId, canApply: true, ...applyCounts, rows: [{ candidateId: 'candidate-1', kind: 'PRODUCT', status: 'UPDATED', businessKey: '100001' }] },
    { batchId, canApply: true, ...applyCounts, rows: [{ candidateId: 'candidate-1', kind: 'CHANNEL', status: 'NEW', businessKey: '100001' }] },
    { batchId, canApply: true, ...applyCounts, rows: [{ candidateId: 'candidate-1', kind: 'PRODUCT', status: 'UPDATE', businessKey: '100001' }] },
    { batchId, canApply: true, ...applyCounts, rows: [{ candidateId: 'candidate-1', kind: 'PRODUCT', status: 'UPDATE', businessKey: '100001', changes: { productType: { before: 'SINGLE', after: 'SET' } } }] },
    { batchId, canApply: true, ...applyCounts, rows: [{ candidateId: 'candidate-1', kind: 'SKU', status: 'UPDATE', businessKey: 'AL00', changes: { modelName: { before: '점보', after: { secret: true } } } }] },
  ]) {
    const fake = fakeClient({}, () => ({ data, error: null }))
    await expect(createImportPersistence({ supabase: fake.supabase, workspaceId }).previewMasterImportApply(batchId))
      .rejects.toThrow('Master 적용 미리보기를 불러오지 못했습니다.')
  }
})
