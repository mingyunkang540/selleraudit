import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterImportPreview, RawCellValue, RawImportCell, ProductCandidate, SkuCandidate, BomCandidate } from '../types/import'

type ImportClient = Pick<SupabaseClient, 'from' | 'rpc' | 'storage' | 'functions'>
type Row = Record<string, unknown>

export const MASTER_IMPORT_SOURCE_SCOPE_KEY = 'WORKBOOK'
export const MASTER_IMPORT_PARSER_VERSION = 'master-v1.0.0'

export interface SavedImportBatch {
  id: string
  validationRevision: number
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
  sourceFileId: string | null
  sourceHashVerification: 'CLIENT_OBSERVED' | 'SERVER_VERIFIED'
  sourceHash: string
  parserVersion: string
}

export interface SavedImportSource {
  id: string
  originalFilename: string
  verificationStatus: 'PENDING_UPLOAD' | 'VERIFIED' | 'HASH_MISMATCH' | 'VERIFICATION_FAILED'
  serverSha256: string | null
  serverByteSize: number | null
  verifiedAt: string | null
}

export interface VerifiedImportSource {
  id: string
  serverSha256: string
  serverByteSize: number
}

export interface SavedImportIssue {
  id: string
  validationRevision: number
  reviewRevision: number
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
  resolution: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export interface SavedImportCandidate {
  id: string
  kind: 'PRODUCT' | 'SKU' | 'BOM_COMPONENT'
  candidateOrdinal: number
  validationRevision: number
  sourceSheet: string
  sourceRow: number
  sourceBlock: string | null
  sourceFieldMap: Record<string, string>
  normalizedValues: Record<string, unknown>
  candidateStatus: 'VALID' | 'WARNING' | 'ERROR' | 'DEFERRED'
  issueCodes: string[]
  rawImportRowId: string
  supportingRawRowIds: string[]
  reviewedValues: Record<string, unknown> | null
  reviewNote: string | null
  reviewRevision: number
  reviewedBy: string | null
  reviewedAt: string | null
}

export type IssueReviewStatus = 'OPEN' | 'RESOLVED' | 'ACKNOWLEDGED' | 'DEFERRED'

export interface SavedRawImportRow {
  id: string
  sourceSheet: string
  originalRowNumber: number
  sourceBlock: string | null
  rawCells: RawImportCell[]
}

export type MasterImportApplyKind = 'PRODUCT' | 'SKU' | 'BOM_COMPONENT'
export type MasterImportApplyStatus = 'NEW' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT' |
  'SKIPPED_WARNING' | 'SKIPPED_ERROR' | 'SKIPPED_DEFERRED' |
  'SKIPPED_INVALID' | 'SKIPPED_DEPENDENCY'

export interface MasterImportApplyChange {
  before: string | number | boolean | null
  after: string | number | boolean | null
}

export interface MasterImportApplyRow {
  candidateId: string
  kind: MasterImportApplyKind
  status: MasterImportApplyStatus
  businessKey: string
  reason?: string
  changes?: Record<string, MasterImportApplyChange>
}

export interface MasterImportApplyCounts {
  productNew: number
  productUpdate: number
  productUnchanged: number
  productConflict: number
  productSkipped: number
  skuNew: number
  skuUpdate: number
  skuUnchanged: number
  skuConflict: number
  skuSkipped: number
  bomNew: number
  bomUpdate: number
  bomUnchanged: number
  bomConflict: number
  bomSkipped: number
  blockingBatchIssues: number
}

export interface MasterImportApplyPreview extends MasterImportApplyCounts {
  batchId: string
  canApply: boolean
  rows: MasterImportApplyRow[]
}

export interface MasterImportApplyResult extends MasterImportApplyCounts {
  batchId: string
  finalBatchStatus: 'APPLIED' | 'PARTIALLY_APPLIED'
  appliedCount: number
  remainingCount: number
}

export interface ImportPersistence {
  prepareSourceFile(file: File, hash: string, onStage?: (stage: 'UPLOADING' | 'VERIFYING') => void): Promise<VerifiedImportSource>
  saveMasterDryRun(preview: MasterImportPreview, sourceFileId: string, hash: string): Promise<string>
  loadSourceFile(sourceFileId: string): Promise<SavedImportSource>
  createSourceDownloadUrl(sourceFileId: string): Promise<string>
  listSavedMasterImports(): Promise<SavedImportBatch[]>
  loadSavedImportIssues(batchId: string): Promise<SavedImportIssue[]>
  loadSavedImportCandidates(batchId: string): Promise<SavedImportCandidate[]>
  loadRawImportRow(rowId: string): Promise<SavedRawImportRow>
  reviewCandidate(candidateId: string, expectedValidationRevision: number, expectedReviewRevision: number,
    reviewedValues: Record<string, unknown>, resolution: string): Promise<void>
  reviewIssue(issueId: string, expectedValidationRevision: number, expectedReviewRevision: number,
    status: IssueReviewStatus, resolution: string | null): Promise<void>
  previewMasterImportApply(batchId: string): Promise<MasterImportApplyPreview>
  applyMasterImportBatch(batchId: string): Promise<MasterImportApplyResult>
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

function optionalText(row: Row, key: string): string | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`Invalid ${key}`)
  return value
}

function object(row: Row, key: string): Row {
  const value = row[key]
  if (!isRow(value)) throw new Error(`Invalid ${key}`)
  return value
}

function stringArray(row: Row, key: string): string[] {
  const value = row[key]
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`Invalid ${key}`)
  return value
}

function optionalTimestamp(row: Row, key: string): string | null {
  const value = optionalText(row, key)
  if (value !== null && !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${key}`)
  return value
}

function count(row: Row, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${key}`)
  return value
}

const applyCountKeys = [
  'productNew', 'productUpdate', 'productUnchanged', 'productConflict', 'productSkipped',
  'skuNew', 'skuUpdate', 'skuUnchanged', 'skuConflict', 'skuSkipped',
  'bomNew', 'bomUpdate', 'bomUnchanged', 'bomConflict', 'bomSkipped', 'blockingBatchIssues',
] as const

function mapApplyCounts(row: Row): MasterImportApplyCounts {
  return Object.fromEntries(applyCountKeys.map(key => [key, count(row, key)])) as unknown as MasterImportApplyCounts
}

function mapApplyRow(value: unknown): MasterImportApplyRow {
  if (!isRow(value)) throw new Error('Invalid apply row')
  const kind = field(value, 'kind')
  const status = field(value, 'status')
  if (!['PRODUCT', 'SKU', 'BOM_COMPONENT'].includes(kind) || ![
    'NEW', 'UPDATE', 'UNCHANGED', 'CONFLICT', 'SKIPPED_WARNING', 'SKIPPED_ERROR',
    'SKIPPED_DEFERRED', 'SKIPPED_INVALID', 'SKIPPED_DEPENDENCY',
  ].includes(status)) throw new Error('Invalid apply row state')
  const reason = value.reason == null ? undefined : field(value, 'reason')
  let changes: MasterImportApplyRow['changes']
  if (value.changes != null) {
    if (!isRow(value.changes)) throw new Error('Invalid apply row changes')
    const allowedFields = kind === 'PRODUCT' ? ['productName', 'category'] : kind === 'SKU' ? ['modelName', 'color'] : ['quantity']
    changes = Object.fromEntries(Object.entries(value.changes).map(([key, rawChange]) => {
      if (!allowedFields.includes(key) || !isRow(rawChange) || !Object.hasOwn(rawChange, 'before') || !Object.hasOwn(rawChange, 'after')) {
        throw new Error('Invalid apply row change')
      }
      const validValue = (candidate: unknown): candidate is string | number | boolean | null =>
        candidate === null || ['string', 'number', 'boolean'].includes(typeof candidate)
      if (!validValue(rawChange.before) || !validValue(rawChange.after) ||
        (typeof rawChange.before === 'number' && !Number.isFinite(rawChange.before)) ||
        (typeof rawChange.after === 'number' && !Number.isFinite(rawChange.after))) {
        throw new Error('Invalid apply row change value')
      }
      return [key, { before: rawChange.before, after: rawChange.after }]
    }))
    if (status !== 'UPDATE' || Object.keys(changes).length === 0) throw new Error('Invalid apply row changes')
  } else if (status === 'UPDATE') throw new Error('Missing apply row changes')
  return {
    candidateId: field(value, 'candidateId'), kind: kind as MasterImportApplyKind,
    status: status as MasterImportApplyStatus, businessKey: field(value, 'businessKey'),
    ...(reason ? { reason } : {}),
    ...(changes ? { changes } : {}),
  }
}

function mapApplyPreview(data: unknown, batchId: string): MasterImportApplyPreview {
  if (!isRow(data) || field(data, 'batchId') !== batchId || typeof data.canApply !== 'boolean' || !Array.isArray(data.rows)) {
    throw new Error('Invalid apply preview')
  }
  return { batchId, canApply: data.canApply, ...mapApplyCounts(data), rows: data.rows.map(mapApplyRow) }
}

function mapApplyResult(data: unknown, batchId: string): MasterImportApplyResult {
  if (!isRow(data) || field(data, 'batchId') !== batchId) throw new Error('Invalid apply result')
  const finalBatchStatus = field(data, 'finalBatchStatus')
  if (!['APPLIED', 'PARTIALLY_APPLIED'].includes(finalBatchStatus)) throw new Error('Invalid final batch status')
  return {
    batchId, ...mapApplyCounts(data), finalBatchStatus: finalBatchStatus as MasterImportApplyResult['finalBatchStatus'],
    appliedCount: count(data, 'appliedCount'), remainingCount: count(data, 'remainingCount'),
  }
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
    id: field(row, 'id'), validationRevision: count(row, 'validation_revision'),
    sourceFilename: field(row, 'source_filename'), createdAt,
    status: field(row, 'status'), rowCount: count(row, 'row_count'),
    productCount: count(row, 'product_candidate_count'), skuCount: count(row, 'sku_candidate_count'),
    bomCount: count(row, 'bom_candidate_count'), validCount: count(row, 'valid_count'),
    warningCount: count(row, 'warning_count'), errorCount: count(row, 'error_count'),
    deferredCount: count(row, 'deferred_count'), createdBy: optionalField(row, 'created_by'),
    sourceFileId: row.source_file_id == null ? null : field(row, 'source_file_id'),
    sourceHashVerification: row.source_hash_verification === 'SERVER_VERIFIED' ? 'SERVER_VERIFIED' : 'CLIENT_OBSERVED',
    sourceHash: typeof row.source_file_hash === 'string' ? row.source_file_hash : '',
    parserVersion: typeof row.parser_version === 'string' ? row.parser_version : '',
  }
}

function mapIssue(row: Row, workspaceId: string, batchId: string): SavedImportIssue {
  validateWorkspace(row, workspaceId)
  if (field(row, 'import_batch_id') !== batchId) throw new Error('Wrong import batch')
  const relatedRawRowIds = stringArray(row, 'related_raw_row_ids')
  return {
    id: field(row, 'id'), validationRevision: count(row, 'validation_revision'),
    reviewRevision: count(row, 'review_revision'),
    severity: field(row, 'severity'), issueCode: field(row, 'issue_code'),
    blockingScope: field(row, 'blocking_scope'), sourceSheet: optionalField(row, 'source_sheet'),
    sourceRow: optionalRowNumber(row, 'source_row'), fieldPath: optionalField(row, 'field_path'),
    observedValue: row.observed_value, expectedRule: field(row, 'expected_rule'),
    message: field(row, 'message'), rawImportRowId: optionalField(row, 'raw_import_row_id'),
    relatedRawRowIds, status: field(row, 'status'), resolution: optionalText(row, 'resolution'),
    reviewedBy: optionalField(row, 'reviewed_by'), reviewedAt: optionalTimestamp(row, 'reviewed_at'),
  }
}

function mapCandidate(row: Row, workspaceId: string, batchId: string): SavedImportCandidate {
  validateWorkspace(row, workspaceId)
  if (field(row, 'import_batch_id') !== batchId) throw new Error('Wrong import batch')
  const kind = field(row, 'kind')
  const candidateStatus = field(row, 'candidate_status')
  const candidateOrdinal = count(row, 'candidate_ordinal')
  const sourceRow = count(row, 'source_row')
  if (!['PRODUCT', 'SKU', 'BOM_COMPONENT'].includes(kind) ||
    !['VALID', 'WARNING', 'ERROR', 'DEFERRED'].includes(candidateStatus) ||
    candidateOrdinal === 0 || sourceRow === 0) throw new Error('Invalid candidate')
  const sourceFieldMap = object(row, 'source_field_map')
  if (!Object.values(sourceFieldMap).every(value => typeof value === 'string')) throw new Error('Invalid source field map')
  const reviewedValues = row.reviewed_values === null ? null : object(row, 'reviewed_values')
  return {
    id: field(row, 'id'), kind: kind as SavedImportCandidate['kind'], candidateOrdinal,
    validationRevision: count(row, 'validation_revision'),
    sourceSheet: field(row, 'source_sheet'), sourceRow, sourceBlock: optionalText(row, 'source_block'),
    sourceFieldMap: sourceFieldMap as Record<string, string>, normalizedValues: object(row, 'normalized_values'),
    candidateStatus: candidateStatus as SavedImportCandidate['candidateStatus'],
    issueCodes: stringArray(row, 'issue_codes'), rawImportRowId: field(row, 'raw_import_row_id'),
    supportingRawRowIds: stringArray(row, 'supporting_raw_row_ids'), reviewedValues,
    reviewNote: optionalText(row, 'review_note'), reviewRevision: count(row, 'review_revision'),
    reviewedBy: optionalField(row, 'reviewed_by'), reviewedAt: optionalTimestamp(row, 'reviewed_at'),
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

function candidatePayload(candidate: ProductCandidate | SkuCandidate | BomCandidate, candidateOrdinal: number) {
  const normalizedValues = candidate.kind === 'PRODUCT' ? {
    sabangnetCode: candidate.sabangnetCode, productName: candidate.productName,
    category: candidate.category, productType: candidate.productType,
    rawBomText: candidate.rawBomText, sourceQuantity: candidate.sourceQuantity,
    sourceChannel: candidate.sourceChannel, variantOfSourceRow: candidate.variantOfSourceRow,
  } : candidate.kind === 'SKU' ? {
    skuCode: candidate.skuCode, modelName: candidate.modelName, color: candidate.color,
    sourceCategory: candidate.sourceCategory, registryStatus: candidate.registryStatus,
  } : {
    productCode: candidate.productCode, productSourceRow: candidate.productSourceRow,
    skuCode: candidate.skuCode, quantity: candidate.quantity, rawToken: candidate.rawToken,
  }
  return {
    kind: candidate.kind, candidateOrdinal, sourceSheet: candidate.sourceSheet,
    sourceRow: candidate.sourceRow, sourceBlock: candidate.sourceBlock,
    sourceFieldMap: candidate.sourceFieldMap, status: candidate.status,
    issueCodes: candidate.issueCodes, normalizedValues,
    supportingRows: candidate.kind === 'PRODUCT' && candidate.variantOfSourceRow !== null &&
      candidate.variantOfSourceRow !== candidate.sourceRow ? [candidate.variantOfSourceRow] : [],
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
  const candidates = [
    ...preview.products.map((candidate, index) => candidatePayload(candidate, index + 1)),
    ...preview.skus.map((candidate, index) => candidatePayload(candidate, index + 1)),
    ...preview.bomComponents.map((candidate, index) => candidatePayload(candidate, index + 1)),
  ]
  for (const candidate of candidates) {
    if (!rowKeys.has(JSON.stringify([candidate.sourceSheet, candidate.sourceRow]))) {
      throw new ImportPersistenceError('후보의 원본 행을 찾을 수 없습니다.')
    }
    for (const supportingRow of candidate.supportingRows) {
      if (!rowKeys.has(JSON.stringify([candidate.sourceSheet, supportingRow]))) {
        throw new ImportPersistenceError('후보의 추가 원본 행을 찾을 수 없습니다.')
      }
    }
  }
  const statusCounts = {
    VALID: candidates.filter(candidate => candidate.status === 'VALID').length,
    WARNING: candidates.filter(candidate => candidate.status === 'WARNING').length,
    ERROR: candidates.filter(candidate => candidate.status === 'ERROR').length,
    DEFERRED: candidates.filter(candidate => candidate.status === 'DEFERRED').length,
  }
  if (statusCounts.VALID !== preview.summary.validCount ||
    statusCounts.WARNING !== preview.summary.warningCount ||
    statusCounts.ERROR !== preview.summary.errorCount ||
    statusCounts.DEFERRED !== preview.summary.deferredCount) {
    throw new ImportPersistenceError('후보 상태별 건수가 일치하지 않습니다.')
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
    p_candidates: candidates,
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
    async prepareSourceFile(file, hash, onStage) {
      if (!file.name || file.name.length > 255 || !/\.xlsx$/i.test(file.name) || /[/\\]/.test(file.name) ||
        Array.from(file.name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
        !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 52428800 || !/^[0-9a-f]{64}$/.test(hash)) {
        throw new ImportPersistenceError('원본 파일 이름, 크기 또는 SHA-256 값이 올바르지 않습니다.')
      }
      try {
        const { data: rows, error: registrationError } = await supabase.rpc('register_master_import_source', {
          p_workspace_id: workspaceId,
          p_original_filename: file.name,
          p_client_observed_byte_size: file.size,
          p_client_observed_sha256: hash,
        })
        if (registrationError) throw registrationError
        const registration = asRows(rows)[0]
        if (!registration) throw new Error('Missing source registration')
        const id = field(registration, 'source_file_id')
        const bucket = field(registration, 'bucket')
        const path = field(registration, 'object_path')
        if (bucket !== 'seller-audit-import-sources' || path !== `${workspaceId}/${id}/source.xlsx`) {
          throw new Error('Unexpected source path')
        }
        onStage?.('UPLOADING')
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false,
        })
        if (uploadError) throw uploadError
        onStage?.('VERIFYING')
        const { data: verification, error: verifyError } = await supabase.functions.invoke('verify-master-import-source', {
          body: { sourceFileId: id },
        })
        if (verifyError) throw verifyError
        if (!isRow(verification) || verification.status !== 'VERIFIED' ||
          verification.sourceFileId !== id || verification.serverSha256 !== hash ||
          verification.serverByteSize !== file.size) {
          throw new ImportPersistenceError(verification && isRow(verification) && verification.status === 'HASH_MISMATCH'
            ? '업로드된 원본 파일의 서버 검증값이 브라우저에서 계산한 값과 일치하지 않습니다.'
            : '원본 파일을 서버에서 확인하지 못했습니다. 다시 검증하거나 새로 업로드해 주세요.')
        }
        return { id, serverSha256: hash, serverByteSize: file.size }
      } catch (error) {
        if (error instanceof ImportPersistenceError) throw error
        throw normalizeError(error, '원본 등록·업로드·서버 검증에 실패했습니다.')
      }
    },
    async saveMasterDryRun(preview, sourceFileId, hash) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sourceFileId)) {
        throw new ImportPersistenceError('서버 검증된 원본 ID가 필요합니다.')
      }
      const payload = buildMasterImportPayload(preview, hash)
      try {
        const { data, error } = await supabase.rpc('persist_verified_master_import_dry_run', {
          p_workspace_id: workspaceId, p_source_file_id: sourceFileId,
          p_summary: payload.p_summary, p_raw_rows: payload.p_raw_rows,
          p_candidates: payload.p_candidates, p_issues: payload.p_issues,
        })
        if (error) throw error
        if (typeof data !== 'string' || !data.trim()) throw new Error('Invalid batch id')
        return data
      } catch (error) { throw normalizeError(error, 'Dry-run 저장에 실패했습니다.') }
    },
    async loadSourceFile(sourceFileId) {
      try {
        const { data, error } = await supabase.from('import_source_files')
          .select('id,workspace_id,original_filename,verification_status,server_verified_sha256,server_verified_byte_size,verified_at')
          .eq('workspace_id', workspaceId).eq('id', sourceFileId).single()
        if (error || !isRow(data)) throw error ?? new Error('Source file missing')
        validateWorkspace(data, workspaceId)
        const status = field(data, 'verification_status')
        if (!['PENDING_UPLOAD', 'VERIFIED', 'HASH_MISMATCH', 'VERIFICATION_FAILED'].includes(status)) {
          throw new Error('Invalid verification status')
        }
        return {
          id: field(data, 'id'), originalFilename: field(data, 'original_filename'),
          verificationStatus: status as SavedImportSource['verificationStatus'],
          serverSha256: optionalText(data, 'server_verified_sha256'),
          serverByteSize: data.server_verified_byte_size === null ? null : count(data, 'server_verified_byte_size'),
          verifiedAt: optionalTimestamp(data, 'verified_at'),
        }
      } catch (error) { throw normalizeError(error, '원본 파일 정보를 불러오지 못했습니다.') }
    },
    async createSourceDownloadUrl(sourceFileId) {
      try {
        const { data, error } = await supabase.functions.invoke('create-master-source-download-url', {
          body: { sourceFileId },
        })
        if (error || !isRow(data) || typeof data.url !== 'string' || !data.url.startsWith('https://')) {
          throw error ?? new Error('Download URL missing')
        }
        return data.url
      } catch (error) { throw normalizeError(error, '원본 파일 다운로드 링크를 만들지 못했습니다.') }
    },
    async listSavedMasterImports() {
      try {
        const { data, error } = await supabase.from('import_batches')
          .select('id,workspace_id,source_type,source_filename,source_file_hash,source_file_id,source_hash_verification,parser_version,created_at,status,validation_revision,row_count,product_candidate_count,sku_candidate_count,bom_candidate_count,valid_count,warning_count,error_count,deferred_count,created_by')
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
            .select('id,workspace_id,import_batch_id,raw_import_row_id,related_raw_row_ids,validation_revision,review_revision,issue_code,severity,blocking_scope,source_sheet,source_row,field_path,observed_value,expected_rule,message,status,resolution,reviewed_by,reviewed_at')
            .eq('workspace_id', workspaceId).eq('import_batch_id', batchId)
            .order('id', { ascending: true }).range(offset, offset + pageSize - 1)
          if (error) throw error
          const page = asRows(data)
          issues.push(...page.map(row => mapIssue(row, workspaceId, batchId)))
          if (page.length < pageSize) return issues
        }
      } catch (error) { throw normalizeError(error, '저장된 검증 이슈를 불러오지 못했습니다.') }
    },
    async loadSavedImportCandidates(batchId) {
      if (!batchId.trim()) throw new ImportPersistenceError('저장 기록을 선택해 주세요.')
      try {
        const { data: batch, error: batchError } = await supabase.from('import_batches')
          .select('id').eq('workspace_id', workspaceId).eq('source_type', 'MASTER_WORKBOOK')
          .eq('id', batchId).single()
        if (batchError || !batch) throw batchError ?? new Error('Batch not found')
        const candidates: SavedImportCandidate[] = []
        const pageSize = 500
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await supabase.from('import_candidates')
            .select('id,workspace_id,import_batch_id,raw_import_row_id,supporting_raw_row_ids,validation_revision,candidate_ordinal,kind,source_sheet,source_row,source_block,source_field_map,normalized_values,candidate_status,issue_codes,reviewed_values,review_note,review_revision,reviewed_by,reviewed_at')
            .eq('workspace_id', workspaceId).eq('import_batch_id', batchId)
            .order('id', { ascending: true }).range(offset, offset + pageSize - 1)
          if (error) throw error
          const page = asRows(data)
          candidates.push(...page.map(row => mapCandidate(row, workspaceId, batchId)))
          if (page.length < pageSize) return candidates
        }
      } catch (error) { throw normalizeError(error, '저장된 후보를 불러오지 못했습니다.') }
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
    async reviewCandidate(candidateId, expectedValidationRevision, expectedReviewRevision, reviewedValues, resolution) {
      if (!candidateId.trim() || !Number.isSafeInteger(expectedValidationRevision) || expectedValidationRevision < 1 ||
        !Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision < 0 || !isRow(reviewedValues) ||
        !resolution.trim()) throw new ImportPersistenceError('후보 검토 입력이 올바르지 않습니다.')
      try {
        const { error } = await supabase.rpc('review_import_candidate', {
          p_candidate_id: candidateId, p_expected_validation_revision: expectedValidationRevision,
          p_expected_review_revision: expectedReviewRevision, p_reviewed_values: reviewedValues,
          p_resolution: resolution,
        })
        if (error) throw error
      } catch (error) { throw normalizeError(error, '후보 검토 저장에 실패했습니다. 최신 기록을 다시 확인해 주세요.') }
    },
    async reviewIssue(issueId, expectedValidationRevision, expectedReviewRevision, status, resolution) {
      if (!issueId.trim() || !Number.isSafeInteger(expectedValidationRevision) || expectedValidationRevision < 1 ||
        !Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision < 0 ||
        !['OPEN', 'RESOLVED', 'ACKNOWLEDGED', 'DEFERRED'].includes(status) ||
        (status !== 'OPEN' && !resolution?.trim())) {
        throw new ImportPersistenceError('이슈 검토 입력이 올바르지 않습니다.')
      }
      try {
        const { error } = await supabase.rpc('review_import_validation_issue', {
          p_issue_id: issueId, p_expected_validation_revision: expectedValidationRevision,
          p_expected_review_revision: expectedReviewRevision, p_status: status,
          p_resolution: status === 'OPEN' ? null : resolution,
        })
        if (error) throw error
      } catch (error) { throw normalizeError(error, '이슈 검토 저장에 실패했습니다. 최신 기록을 다시 확인해 주세요.') }
    },
    async previewMasterImportApply(batchId) {
      if (!batchId.trim()) throw new ImportPersistenceError('저장 기록을 선택해 주세요.')
      try {
        const { data, error } = await supabase.rpc('preview_master_import_apply', { p_batch_id: batchId })
        if (error) throw error
        return mapApplyPreview(data, batchId)
      } catch (error) { throw normalizeError(error, 'Master 적용 미리보기를 불러오지 못했습니다.') }
    },
    async applyMasterImportBatch(batchId) {
      if (!batchId.trim()) throw new ImportPersistenceError('저장 기록을 선택해 주세요.')
      try {
        const { data, error } = await supabase.rpc('apply_master_import_batch', { p_batch_id: batchId })
        if (error) throw error
        return mapApplyResult(data, batchId)
      } catch (error) { throw normalizeError(error, 'Master 적용에 실패했습니다. 배치 상태와 충돌 여부를 다시 확인해 주세요.') }
    },
  }
}
