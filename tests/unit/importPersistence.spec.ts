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

test('maps preview to one atomic payload without candidate snapshots or actor fields', () => {
  const payload = buildMasterImportPayload(preview(), hash)
  expect(payload.p_summary).toEqual({ productCount: 1, skuCount: 0, bomCount: 0,
    validCount: 0, warningCount: 0, errorCount: 1, deferredCount: 0 })
  expect(payload.p_raw_rows).toHaveLength(1)
  expect(payload.p_raw_rows[0].rawCells).toEqual(preview().rawRows[0].rawCells)
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
})

test('save uses trusted RPC and returns batch id; errors do not leak database detail', async () => {
  const fake = fakeClient({})
  const persistence = createImportPersistence({ supabase: fake.supabase, workspaceId })
  await expect(persistence.saveMasterDryRun(preview(), hash)).resolves.toBe(batchId)
  expect(fake.calls).toEqual([{ name: 'persist_master_import_dry_run', args: {
    p_workspace_id: workspaceId, ...buildMasterImportPayload(preview(), hash),
  } }])
  const failed = createImportPersistence({
    supabase: fakeClient({}, () => ({ data: null, error: new Error('secret SQL detail') })).supabase,
    workspaceId,
  })
  await expect(failed.saveMasterDryRun(preview(), hash)).rejects.toThrow('Dry-run 저장에 실패했습니다.')
})

test('lists only selected workspace Master batches and maps candidate counts', async () => {
  const fake = fakeClient({ import_batches: [batchRow(), batchRow({ id: 'other', source_type: 'SALES_WORKBOOK' }),
    batchRow({ id: 'foreign', workspace_id: 'workspace-b' })] })
  const saved = await createImportPersistence({ supabase: fake.supabase, workspaceId }).listSavedMasterImports()
  expect(saved).toEqual([{ id: batchId, sourceFilename: '원본.xlsx', createdAt: '2026-10-25T00:00:00Z',
    status: 'REVIEW_REQUIRED', rowCount: 1, productCount: 1, skuCount: 0, bomCount: 0,
    validCount: 0, warningCount: 0, errorCount: 1, deferredCount: 0, createdBy: 'user-a' }])
})

test('loads saved issue provenance and raw cells only on explicit detail request', async () => {
  const raw = { id: 'raw-1', workspace_id: workspaceId, source_sheet: '단가표', original_row_number: 6,
    source_block: 'PRODUCT', raw_cells: preview().rawRows[0].rawCells }
  const issue = { id: 'issue-1', workspace_id: workspaceId, import_batch_id: batchId, raw_import_row_id: raw.id,
    related_raw_row_ids: [raw.id], issue_code: 'DUPLICATE_BUSINESS_KEY', severity: 'ERROR', blocking_scope: 'BATCH',
    source_sheet: '단가표', source_row: 6, field_path: 'sabangnetCode', observed_value: '100526',
    expected_rule: '고유 품번', message: '중복 품번', status: 'OPEN' }
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
