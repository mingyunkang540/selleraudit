import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterImportPreview, RawCellValue, RawImportCell } from '../types/import'

type ImportClient = Pick<SupabaseClient, 'from' | 'rpc'>
type Row = Record<string, unknown>

export const MASTER_IMPORT_SOURCE_SCOPE_KEY = 'WORKBOOK'
export const MASTER_IMPORT_PARSER_VERSION = 'master-v1.0.0'

export interface SavedImportBatch {
  id: string
  sourceFilename: string
  createdAt: string
  status: string
  rowCount: number
  productCount: number
  skuCount: number
  bomCount: number
  validCount: number
  warningCount: number
  errorCount: number
  deferredCount: number
  createdBy: string | null
}

export interface SavedImportIssue {
  id: string
  severity: string
  issueCode: string
  blockingScope: string
  sourceSheet: string | null
  sourceRow: number | null
  fieldPath: string | null
  observedValue: unknown
  expectedRule: string
  message: string
  rawImportRowId: string | null
  relatedRawRowIds: string[]
  status: string
}

export interface SavedRawImportRow {
  id: string
  sourceSheet: string
  originalRowNumber: number
  sourceBlock: string | null
  rawCells: RawImportCell[]
}

export interface ImportPersistence {
  saveMasterDryRun(preview: MasterImportPreview, hash: string): Promise<string>
  listSavedMasterImports(): Promise<SavedImportBatch[]>
  loadSavedImportIssues(batchId: string): Promise<SavedImportIssue[]>
  loadRawImportRow(rowId: string): Promise<SavedRawImportRow>
}

export class ImportPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ImportPersistenceError'
  }
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function field(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${key}`)
  return value
}

function optionalField(row: Row, key: string): string | null {
  const value = row[key]
  if (value === null) return null
  return field(row, key)
}

function count(row: Row, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${key}`)
  return value
}

function optionalRowNumber(row: Row, key: string): number | null {
  if (row[key] === null) return null
  const value = count(row, key)
  if (value === 0) throw new Error(`Invalid ${key}`)
  return value
}

function validateWorkspace(row: Row, workspaceId: string): void {
  if (field(row, 'workspace_id') !== workspaceId) throw new Error('Wrong workspace')
}

function normalizeError(error: unknown, message: string): ImportPersistenceError {
  return new ImportPersistenceError(message, { cause: error })
}

function asRows(data: unknown): Row[] {
  if (!Array.isArray(data) || !data.every(isRow)) throw new Error('Invalid response rows')
  return data
}

function mapBatch(row: Row, workspaceId: string): SavedImportBatch {
  validateWorkspace(row, workspaceId)
  if (field(row, 'source_type') !== 'MASTER_WORKBOOK') throw new Error('Wrong import source')
  const createdAt = field(row, 'created_at')
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid timestamp')
  return {
    id: field(row, 'id'), sourceFilename: field(row, 'source_filename'), createdAt,
    status: field(row, 'status'), rowCount: count(row, 'row_count'),
    productCount: count(row, 'product_candidate_count'), skuCount: count(row, 'sku_candidate_count'),
    bomCount: count(row, 'bom_candidate_count'), validCount: count(row, 'valid_count'),
    warningCount: count(row, 'warning_count'), errorCount: count(row, 'error_count'),
    deferredCount: count(row, 'deferred_count'), createdBy: optionalField(row, 'created_by'),
  }
}

function mapIssue(row: Row, workspaceId: string, batchId: string): SavedImportIssue {
  validateWorkspace(row, workspaceId)
  if (field(row, 'import_batch_id') !== batchId) throw new Error('Wrong import batch')
  const relatedRawRowIds = row.related_raw_row_ids
  if (!Array.isArray(relatedRawRowIds) || !relatedRawRowIds.every(value => typeof value === 'string')) {
    throw new Error('Invalid related rows')
  }
  return {
    id: field(row, 'id'), severity: field(row, 'severity'), issueCode: field(row, 'issue_code'),
    blockingScope: field(row, 'blocking_scope'), sourceSheet: optionalField(row, 'source_sheet'),
    sourceRow: optionalRowNumber(row, 'source_row'), fieldPath: optionalField(row, 'field_path'),
    observedValue: row.observed_value, expectedRule: field(row, 'expected_rule'),
    message: field(row, 'message'), rawImportRowId: optionalField(row, 'raw_import_row_id'),
    relatedRawRowIds, status: field(row, 'status'),
  }
}

function mapRawRow(row: Row, workspaceId: string): SavedRawImportRow {
  validateWorkspace(row, workspaceId)
  if (!Array.isArray(row.raw_cells)) throw new Error('Invalid raw cells')
  const originalRowNumber = count(row, 'original_row_number')
  if (originalRowNumber === 0) throw new Error('Invalid original row number')
  return {
    id: field(row, 'id'), sourceSheet: field(row, 'source_sheet'), originalRowNumber,
    sourceBlock: optionalField(row, 'source_block'), rawCells: row.raw_cells.map(mapRawCell),
  }
}

const rawCellTypes = new Set<RawImportCell['originalType']>([
  'BLANK', 'STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'FORMULA', 'ERROR',
])

function cellValue(value: unknown): value is RawCellValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
}

function mapRawCell(value: unknown): RawImportCell {
  if (!isRow(value) || typeof value.address !== 'string' || !value.address.trim() ||
    !rawCellTypes.has(value.originalType as RawImportCell['originalType']) ||
    !cellValue(value.originalValue) || !cellValue(value.cachedValue) ||
    !(value.formulaText === null || typeof value.formulaText === 'string') ||
    !(value.errorCode === null || typeof value.errorCode === 'string')) {
    throw new Error('Invalid raw cell')
  }
  return {
    address: value.address, originalType: value.originalType as RawImportCell['originalType'],
    originalValue: value.originalValue as RawCellValue, cachedValue: value.cachedValue as RawCellValue,
    formulaText: value.formulaText as string | null, errorCode: value.errorCode as string | null,
  }
}

export function buildMasterImportPayload(preview: MasterImportPreview, hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new ImportPersistenceError('파일 SHA-256 값이 올바르지 않습니다.')
  if (!preview.workbook.fileName.trim()) throw new ImportPersistenceError('파일 이름이 없습니다.')
  if (preview.summary.rowCount !== preview.rawRows.length ||
    preview.summary.productCount !== preview.products.length ||
    preview.summary.skuCount !== preview.skus.length ||
    preview.summary.bomCount !== preview.bomComponents.length ||
    preview.summary.validCount + preview.summary.warningCount +
      preview.summary.errorCount + preview.summary.deferredCount !==
      preview.products.length + preview.skus.length + preview.bomComponents.length) {
    throw new ImportPersistenceError('분석 결과의 건수가 일치하지 않습니다.')
  }
  const rowKeys = new Set<string>()
  for (const row of preview.rawRows) {
    if (!row.sourceSheet.trim() || !Number.isSafeInteger(row.originalRowNumber) || row.originalRowNumber < 1) {
      throw new ImportPersistenceError('원본 행 위치가 올바르지 않습니다.')
    }
    const key = JSON.stringify([row.sourceSheet, row.originalRowNumber])
    if (rowKeys.has(key)) throw new ImportPersistenceError('중복된 원본 행 위치가 있습니다.')
    rowKeys.add(key)
  }
  for (const issue of preview.issues) {
    if (issue.sourceRow !== null && !rowKeys.has(JSON.stringify([issue.sourceSheet, issue.sourceRow]))) {
      throw new ImportPersistenceError('이슈의 원본 행을 찾을 수 없습니다.')
    }
  }
  return {
    p_source_filename: preview.workbook.fileName,
    p_source_file_hash: hash,
    p_summary: {
      productCount: preview.summary.productCount, skuCount: preview.summary.skuCount,
      bomCount: preview.summary.bomCount, validCount: preview.summary.validCount,
      warningCount: preview.summary.warningCount, errorCount: preview.summary.errorCount,
      deferredCount: preview.summary.deferredCount,
    },
    p_raw_rows: preview.rawRows.map(row => ({
      sourceSheet: row.sourceSheet, originalRowNumber: row.originalRowNumber,
      sourceBlock: row.sourceBlock, rawCells: row.rawCells,
    })),
    p_issues: preview.issues.map(issue => ({
      code: issue.code, severity: issue.severity, blockingScope: issue.blockingScope,
      sourceSheet: issue.sourceSheet, sourceRow: issue.sourceRow, fieldPath: issue.fieldPath,
      observedValue: issue.observedValue, expectedRule: issue.expectedRule,
      message: issue.message, relatedRows: issue.relatedRows,
    })),
  }
}

export function createImportPersistence({ supabase, workspaceId }: {
  supabase: ImportClient
  workspaceId: string
}): ImportPersistence {
  if (!workspaceId.trim()) throw new ImportPersistenceError('워크스페이스를 선택해 주세요.')
  return {
    async saveMasterDryRun(preview, hash) {
      const payload = buildMasterImportPayload(preview, hash)
      try {
        const { data, error } = await supabase.rpc('persist_master_import_dry_run', {
          p_workspace_id: workspaceId, ...payload,
        })
        if (error) throw error
        if (typeof data !== 'string' || !data.trim()) throw new Error('Invalid batch id')
        return data
      } catch (error) { throw normalizeError(error, 'Dry-run 저장에 실패했습니다.') }
    },
    async listSavedMasterImports() {
      try {
        const { data, error } = await supabase.from('import_batches')
          .select('id,workspace_id,source_type,source_filename,created_at,status,row_count,product_candidate_count,sku_candidate_count,bom_candidate_count,valid_count,warning_count,error_count,deferred_count,created_by')
          .eq('workspace_id', workspaceId).eq('source_type', 'MASTER_WORKBOOK')
          .order('created_at', { ascending: false }).limit(20)
        if (error) throw error
        return asRows(data).map(row => mapBatch(row, workspaceId))
      } catch (error) { throw normalizeError(error, '저장된 Dry-run 목록을 불러오지 못했습니다.') }
    },
    async loadSavedImportIssues(batchId) {
      if (!batchId.trim()) throw new ImportPersistenceError('저장 기록을 선택해 주세요.')
      try {
        const { data: batch, error: batchError } = await supabase.from('import_batches')
          .select('id').eq('workspace_id', workspaceId).eq('source_type', 'MASTER_WORKBOOK')
          .eq('id', batchId).single()
        if (batchError || !batch) throw batchError ?? new Error('Batch not found')
        const issues: SavedImportIssue[] = []
        const pageSize = 500
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await supabase.from('import_validation_issues')
            .select('id,workspace_id,import_batch_id,raw_import_row_id,related_raw_row_ids,issue_code,severity,blocking_scope,source_sheet,source_row,field_path,observed_value,expected_rule,message,status')
            .eq('workspace_id', workspaceId).eq('import_batch_id', batchId)
            .order('id', { ascending: true }).range(offset, offset + pageSize - 1)
          if (error) throw error
          const page = asRows(data)
          issues.push(...page.map(row => mapIssue(row, workspaceId, batchId)))
          if (page.length < pageSize) return issues
        }
      } catch (error) { throw normalizeError(error, '저장된 검증 이슈를 불러오지 못했습니다.') }
    },
    async loadRawImportRow(rowId) {
      if (!rowId.trim()) throw new ImportPersistenceError('원본 행을 선택해 주세요.')
      try {
        const { data, error } = await supabase.from('raw_import_rows')
          .select('id,workspace_id,source_sheet,original_row_number,source_block,raw_cells')
          .eq('workspace_id', workspaceId).eq('id', rowId).single()
        if (error) throw error
        if (!isRow(data)) throw new Error('Invalid response row')
        return mapRawRow(data, workspaceId)
      } catch (error) { throw normalizeError(error, '원본 행을 불러오지 못했습니다.') }
    },
  }
}
