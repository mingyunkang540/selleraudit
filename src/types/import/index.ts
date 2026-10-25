export const MASTER_IMPORT_ERROR_CODES = [
  'SOURCE_SCHEMA_MISMATCH',
  'MISSING_REQUIRED_FIELD',
  'INVALID_DATA_TYPE',
  'DUPLICATE_BUSINESS_KEY',
  'UNKNOWN_SKU',
  'UNPARSEABLE_BOM',
  'INVALID_QUANTITY',
  'BOM_QUANTITY_MISMATCH',
  'EXCEL_CELL_ERROR',
  'FORMULA_CACHE_UNTRUSTED',
] as const

export type MasterImportErrorCode = (typeof MASTER_IMPORT_ERROR_CODES)[number]
export type MasterImportStatus = 'VALID' | 'WARNING' | 'ERROR' | 'DEFERRED'
export type ImportIssueSeverity = 'WARNING' | 'ERROR'
export type ImportBlockingScope = 'NONE' | 'CANDIDATE' | 'BATCH'
export type RawCellType = 'BLANK' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'FORMULA' | 'ERROR'
export type RawCellValue = string | number | boolean | null

export interface RawImportCell {
  readonly address: string
  readonly originalType: RawCellType
  readonly originalValue: RawCellValue
  readonly formulaText: string | null
  readonly cachedValue: RawCellValue
  readonly errorCode: string | null
}

export interface RawImportRow {
  readonly sourceSheet: string
  readonly originalRowNumber: number
  readonly sourceBlock: string
  readonly rawCells: readonly RawImportCell[]
}

export interface MasterCandidateBase {
  readonly id: string
  readonly sourceSheet: string
  readonly sourceRow: number
  readonly sourceBlock: string
  readonly sourceFieldMap: Readonly<Record<string, string>>
  readonly status: MasterImportStatus
  readonly issueCodes: readonly MasterImportErrorCode[]
}

export interface ProductCandidate extends MasterCandidateBase {
  readonly kind: 'PRODUCT'
  readonly sabangnetCode: string | null
  readonly productName: string | null
  readonly category: string | null
  readonly productType: string | null
  readonly rawBomText: string | null
  readonly sourceQuantity: number | null
  readonly sourceChannel: string | null
  readonly variantOfSourceRow: number | null
}

export interface SkuCandidate extends MasterCandidateBase {
  readonly kind: 'SKU'
  readonly skuCode: string
  readonly modelName: string | null
  readonly color: string | null
  readonly sourceCategory: string | null
  readonly registryStatus: 'BOM_REGISTRY' | 'DEFERRED_SOURCE_BLOCK' | 'DEFERRED_INTERMEDIATE_BUNDLE'
}

export interface BomCandidate extends MasterCandidateBase {
  readonly kind: 'BOM_COMPONENT'
  readonly productCode: string | null
  readonly productSourceRow: number
  readonly skuCode: string
  readonly quantity: number
  readonly rawToken: string
}

export interface MasterImportIssue {
  readonly id: string
  readonly code: MasterImportErrorCode
  readonly severity: ImportIssueSeverity
  readonly blockingScope: ImportBlockingScope
  readonly sourceSheet: string
  readonly sourceRow: number | null
  readonly fieldPath: string | null
  readonly observedValue: RawCellValue | readonly RawCellValue[]
  readonly message: string
  readonly expectedRule: string
  readonly relatedRows: readonly number[]
}

export interface MasterWorkbookMetadata {
  readonly fileName: string
  readonly sheetNames: readonly string[]
  readonly requiredSheets: readonly string[]
  readonly schemaValid: boolean
}

export interface MasterImportSummary {
  readonly rowCount: number
  readonly productCount: number
  readonly skuCount: number
  readonly bomCount: number
  readonly validCount: number
  readonly warningCount: number
  readonly errorCount: number
  readonly deferredCount: number
  readonly blockingCount: number
}

export interface MasterImportPreview {
  readonly workbook: MasterWorkbookMetadata
  readonly rawRows: readonly RawImportRow[]
  readonly products: readonly ProductCandidate[]
  readonly skus: readonly SkuCandidate[]
  readonly bomComponents: readonly BomCandidate[]
  readonly issues: readonly MasterImportIssue[]
  readonly summary: MasterImportSummary
  readonly blocked: boolean
}

export type MasterImportParseErrorCode = 'UNSUPPORTED_FILE_TYPE' | 'WORKBOOK_READ_FAILED'

export class MasterImportParseError extends Error {
  readonly code: MasterImportParseErrorCode

  constructor(code: MasterImportParseErrorCode, message: string) {
    super(message)
    this.name = 'MasterImportParseError'
    this.code = code
  }
}
