import * as XLSX from 'xlsx'
import type { CellObject, WorkBook, WorkSheet } from 'xlsx'
import type {
  ProductCandidate,
  RawCellType,
  RawCellValue,
  RawImportCell,
  RawImportRow,
  SkuCandidate,
} from '../../types/import'

export const REQUIRED_MASTER_SHEETS = Object.freeze(['단가표', '코드DB', '상품DB'] as const)
export const SUPPORTED_BOM_SKU_CATEGORIES = Object.freeze(['냉동용기', '구성품'] as const)

const REQUIRED_HEADERS = Object.freeze([
  { sheet: '단가표', address: 'B5', expected: '사방넷품번' },
  { sheet: '단가표', address: 'E5', expected: '모델명' },
  { sheet: '단가표', address: 'F5', expected: '구성 상세' },
  { sheet: '단가표', address: 'H5', expected: '구성수' },
  { sheet: '코드DB', address: 'C3', expected: '상품명' },
  { sheet: '코드DB', address: 'D3', expected: '옵션명' },
  { sheet: '코드DB', address: 'E3', expected: '상품코드' },
  { sheet: '상품DB', address: 'A3', expected: '마스터 상품명' },
  { sheet: '상품DB', address: 'C3', expected: '사방넷 품번코드' },
] as const)

const PRODUCT_COLUMNS = Object.freeze(Array.from({ length: 42 }, (_, index) => XLSX.utils.encode_col(index)))
const SKU_COLUMNS = Object.freeze(Array.from({ length: 24 }, (_, index) => XLSX.utils.encode_col(index + 1)))

export interface MasterWorkbookCapture {
  readonly workbook: WorkBook
  readonly schemaErrors: readonly string[]
  readonly rawRows: readonly RawImportRow[]
  readonly products: readonly ProductCandidate[]
  readonly skus: readonly SkuCandidate[]
}

function asRawValue(value: CellObject['v']): RawCellValue {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

function cellType(cell: CellObject | undefined): RawCellType {
  if (!cell || cell.t === 'z') return 'BLANK'
  if (cell.f) return 'FORMULA'
  if (cell.t === 's') return 'STRING'
  if (cell.t === 'n') return 'NUMBER'
  if (cell.t === 'b') return 'BOOLEAN'
  if (cell.t === 'd') return 'DATE'
  if (cell.t === 'e') return 'ERROR'
  return 'BLANK'
}

function errorText(cell: CellObject | undefined): string | null {
  if (!cell || cell.t !== 'e') return null
  return cell.w ?? String(cell.v ?? 'UNKNOWN_EXCEL_ERROR')
}

export function captureRawCell(sheet: WorkSheet, address: string): RawImportCell {
  const cell = sheet[address] as CellObject | undefined
  const formula = cell?.f ?? null
  return Object.freeze({
    address,
    originalType: cellType(cell),
    originalValue: formula ? null : asRawValue(cell?.v),
    formulaText: formula,
    cachedValue: formula ? asRawValue(cell?.v) : null,
    errorCode: errorText(cell),
  })
}

function captureRow(sheet: WorkSheet, sheetName: string, row: number, sourceBlock: string, columns: readonly string[]): RawImportRow {
  return Object.freeze({
    sourceSheet: sheetName,
    originalRowNumber: row,
    sourceBlock,
    rawCells: Object.freeze(columns.map((column) => captureRawCell(sheet, `${column}${row}`))),
  })
}

function normalizedText(sheet: WorkSheet, address: string): string | null {
  const cell = sheet[address] as CellObject | undefined
  if (!cell || cell.t === 'e' || cell.v == null) return null
  const value = String(cell.v).trim()
  return value.length > 0 ? value : null
}

function normalizedProductType(sheet: WorkSheet, address: string): string | null {
  const value = normalizedText(sheet, address)
  if (value === '단품') return 'SINGLE'
  if (value === '세트') return 'SET'
  return value
}

function normalizedNumber(sheet: WorkSheet, address: string): number | null {
  const cell = sheet[address] as CellObject | undefined
  if (!cell || cell.t === 'e' || cell.v == null || cell.v === '') return null
  const value = Number(cell.v)
  return Number.isFinite(value) ? value : null
}

function normalizedProductCode(sheet: WorkSheet, address: string): string | null {
  const cell = sheet[address] as CellObject | undefined
  if (!cell || cell.t === 'e' || cell.v == null) return null
  if (cell.t === 's') {
    const value = String(cell.v).trim()
    return /^\d+$/.test(value) ? value : null
  }
  if (cell.t === 'n' && typeof cell.v === 'number' && Number.isSafeInteger(cell.v) && cell.v >= 0) {
    const displayed = cell.w?.trim()
    if (displayed && /^\d+$/.test(displayed)) return displayed
    return String(cell.v)
  }
  return null
}

function lastRow(sheet: WorkSheet): number {
  const reference = sheet['!ref']
  return reference ? XLSX.utils.decode_range(reference).e.r + 1 : 0
}

export function inspectMasterSchema(workbook: WorkBook): readonly string[] {
  const errors: string[] = []
  for (const sheetName of REQUIRED_MASTER_SHEETS) {
    if (!workbook.SheetNames.includes(sheetName)) errors.push(`필수 Sheet '${sheetName}'이 없습니다.`)
  }
  for (const header of REQUIRED_HEADERS) {
    const sheet = workbook.Sheets[header.sheet]
    if (!sheet) continue
    if (normalizedText(sheet, header.address) !== header.expected) {
      errors.push(`${header.sheet}!${header.address} Header가 '${header.expected}'이 아닙니다.`)
    }
  }
  return Object.freeze(errors)
}

function readProducts(sheet: WorkSheet): { rawRows: RawImportRow[]; products: ProductCandidate[] } {
  const rawRows: RawImportRow[] = []
  const products: ProductCandidate[] = []
  const endRow = lastRow(sheet)

  for (let row = 6; row <= endRow; row += 1) {
    const candidateAddresses = ['B', 'C', 'D', 'E', 'F', 'H'].map((column) => `${column}${row}`)
    if (candidateAddresses.every((address) => normalizedText(sheet, address) == null)) continue
    const sourceChannel = normalizedText(sheet, `AH${row}`)
    const sourceBlock = `product-channel:${sourceChannel ?? 'unspecified'}`
    rawRows.push(captureRow(sheet, '단가표', row, sourceBlock, PRODUCT_COLUMNS))
    products.push({
      id: `product-단가표-${row}`,
      kind: 'PRODUCT',
      sourceSheet: '단가표',
      sourceRow: row,
      sourceBlock,
      sourceFieldMap: Object.freeze({
        sabangnetCode: `B${row}`,
        productType: `C${row}`,
        category: `D${row}`,
        productName: `E${row}`,
        rawBomText: `F${row}`,
        sourceQuantity: `H${row}`,
      }),
      sabangnetCode: normalizedProductCode(sheet, `B${row}`),
      productName: normalizedText(sheet, `E${row}`),
      category: normalizedText(sheet, `D${row}`),
      productType: normalizedProductType(sheet, `C${row}`),
      rawBomText: normalizedText(sheet, `F${row}`),
      sourceQuantity: normalizedNumber(sheet, `H${row}`),
      sourceChannel,
      variantOfSourceRow: null,
      status: 'VALID',
      issueCodes: Object.freeze([]),
    })
  }
  return { rawRows, products }
}

function readSkus(sheet: WorkSheet): { rawRows: RawImportRow[]; skus: SkuCandidate[] } {
  const rawRows: RawImportRow[] = []
  const skus: SkuCandidate[] = []
  const endRow = lastRow(sheet)
  let sourceCategory: string | null = null

  for (let row = 4; row <= endRow; row += 1) {
    const modelName = normalizedText(sheet, `C${row}`)
    const code = normalizedText(sheet, `E${row}`)
    const categoryMarker = normalizedText(sheet, `B${row}`)
    if (categoryMarker && !modelName && !code) sourceCategory = categoryMarker.trim()
    const sourceBlock = `inventory-code-list:${sourceCategory ?? 'uncategorized'}`
    const hasEvidence = SKU_COLUMNS.some((column) => normalizedText(sheet, `${column}${row}`) != null)
    if (hasEvidence) rawRows.push(captureRow(sheet, '코드DB', row, sourceBlock, SKU_COLUMNS))
    if (!code || !modelName || !/^[★]?[A-Z][A-Z0-9]*$/.test(code)) continue
    const isSupportedCategory = sourceCategory != null && SUPPORTED_BOM_SKU_CATEGORIES.includes(
      sourceCategory as (typeof SUPPORTED_BOM_SKU_CATEGORIES)[number],
    )
    const registryStatus = !isSupportedCategory
      ? 'DEFERRED_SOURCE_BLOCK'
      : modelName.includes('+')
        ? 'DEFERRED_INTERMEDIATE_BUNDLE'
        : 'BOM_REGISTRY'

    skus.push(Object.freeze({
      id: `sku-코드DB-${row}`,
      kind: 'SKU',
      sourceSheet: '코드DB',
      sourceRow: row,
      sourceBlock,
      sourceFieldMap: Object.freeze({ skuCode: `E${row}`, modelName: `C${row}`, color: `D${row}`, sourceCategory: `B${row}` }),
      skuCode: code,
      modelName,
      color: normalizedText(sheet, `D${row}`),
      sourceCategory,
      registryStatus,
      status: registryStatus === 'BOM_REGISTRY' ? 'VALID' : 'DEFERRED',
      issueCodes: Object.freeze([]),
    }))
  }
  return { rawRows, skus }
}

export function captureMasterWorkbook(input: ArrayBuffer): MasterWorkbookCapture {
  const workbook = XLSX.read(input, { type: 'array', cellDates: true, cellFormula: true, cellNF: true, sheetStubs: true })
  const schemaErrors = inspectMasterSchema(workbook)
  const productResult = workbook.Sheets['단가표'] ? readProducts(workbook.Sheets['단가표']) : { rawRows: [], products: [] }
  const skuResult = workbook.Sheets['코드DB'] ? readSkus(workbook.Sheets['코드DB']) : { rawRows: [], skus: [] }

  return {
    workbook,
    schemaErrors,
    rawRows: Object.freeze([...productResult.rawRows, ...skuResult.rawRows]),
    products: Object.freeze(productResult.products),
    skus: Object.freeze(skuResult.skus),
  }
}
