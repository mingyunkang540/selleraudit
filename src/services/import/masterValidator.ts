import { parseBom, REQUIRED_MASTER_SHEETS, type MasterWorkbookCapture } from '../../adapters/master'
import type {
  BomCandidate,
  ImportBlockingScope,
  ImportIssueSeverity,
  MasterImportErrorCode,
  MasterImportIssue,
  MasterImportPreview,
  MasterImportStatus,
  ProductCandidate,
  RawCellValue,
  RawImportRow,
  SkuCandidate,
} from '../../types/import'

interface IssueInput {
  readonly code: MasterImportErrorCode
  readonly severity?: ImportIssueSeverity
  readonly blockingScope?: ImportBlockingScope
  readonly sourceSheet: string
  readonly sourceRow: number | null
  readonly fieldPath: string | null
  readonly observedValue: RawCellValue | readonly RawCellValue[]
  readonly message: string
  readonly expectedRule: string
  readonly relatedRows?: readonly number[]
}

interface ValidationState {
  readonly issues: MasterImportIssue[]
  issueSequence: number
}

const REQUIRED_PRODUCT_FIELDS = Object.freeze([
  { property: 'sabangnetCode', column: 'B', label: '사방넷품번' },
  { property: 'productType', column: 'C', label: '구분' },
  { property: 'category', column: 'D', label: '카테고리' },
  { property: 'productName', column: 'E', label: '모델명' },
  { property: 'rawBomText', column: 'F', label: '구성 상세' },
  { property: 'sourceQuantity', column: 'H', label: '구성수' },
] as const)

function addIssue(state: ValidationState, input: IssueInput): MasterImportIssue {
  state.issueSequence += 1
  const issue = Object.freeze({
    id: `master-issue-${state.issueSequence}`,
    code: input.code,
    severity: input.severity ?? 'ERROR',
    blockingScope: input.blockingScope ?? 'BATCH',
    sourceSheet: input.sourceSheet,
    sourceRow: input.sourceRow,
    fieldPath: input.fieldPath,
    observedValue: input.observedValue,
    message: input.message,
    expectedRule: input.expectedRule,
    relatedRows: Object.freeze([...(input.relatedRows ?? (input.sourceRow == null ? [] : [input.sourceRow]))]),
  })
  state.issues.push(issue)
  return issue
}

function statusFromCodes(codes: readonly MasterImportErrorCode[], issueByCode: ReadonlyMap<MasterImportErrorCode, ImportIssueSeverity>): MasterImportStatus {
  if (codes.some((code) => issueByCode.get(code) === 'ERROR')) return 'ERROR'
  if (codes.some((code) => issueByCode.get(code) === 'WARNING')) return 'WARNING'
  return 'VALID'
}

function rawRowByLocation(rawRows: readonly RawImportRow[]): Map<string, RawImportRow> {
  return new Map(rawRows.map((row) => [`${row.sourceSheet}:${row.originalRowNumber}`, row]))
}

function validateCellEvidence(
  state: ValidationState,
  rawRows: ReadonlyMap<string, RawImportRow>,
  sheet: string,
  row: number,
  address: string,
  fieldPath: string,
  candidateCodes: MasterImportErrorCode[],
): void {
  const cell = rawRows.get(`${sheet}:${row}`)?.rawCells.find((candidate) => candidate.address === address)
  if (!cell) return
  if (cell.errorCode != null) {
    candidateCodes.push('EXCEL_CELL_ERROR')
    addIssue(state, {
      code: 'EXCEL_CELL_ERROR', sourceSheet: sheet, sourceRow: row, fieldPath,
      observedValue: cell.errorCode, message: `${address} 셀에 Excel 오류가 있습니다.`,
      expectedRule: '필수 Master 값은 Excel 오류가 아닌 확정 값이어야 합니다.',
    })
  } else if (cell.originalType === 'FORMULA') {
    candidateCodes.push('FORMULA_CACHE_UNTRUSTED')
    addIssue(state, {
      code: 'FORMULA_CACHE_UNTRUSTED', severity: 'WARNING', sourceSheet: sheet, sourceRow: row, fieldPath,
      observedValue: cell.cachedValue, message: `${address} 셀은 수식의 저장된 결과를 사용합니다.`,
      expectedRule: '필수 Master 값의 수식은 원본 소유자가 재계산해 저장한 결과여야 합니다.',
    })
  }
}

function productIdentity(product: ProductCandidate): string {
  return JSON.stringify([
    product.productType,
    product.category,
    product.productName,
    product.rawBomText,
    product.sourceQuantity,
  ])
}

function validateProducts(
  capture: MasterWorkbookCapture,
  state: ValidationState,
): { products: ProductCandidate[]; bomComponents: BomCandidate[] } {
  const evidence = rawRowByLocation(capture.rawRows)
  const productCodes = new Map<number, MasterImportErrorCode[]>()
  const variantRows = new Map<number, number>()
  const issueSeverity = new Map<MasterImportErrorCode, ImportIssueSeverity>()
  const skuRegistry = new Set(capture.skus
    .filter((sku) => sku.registryStatus === 'BOM_REGISTRY')
    .map((sku) => sku.skuCode))
  const bomComponents: BomCandidate[] = []

  for (const product of capture.products) {
    const codes: MasterImportErrorCode[] = []
    productCodes.set(product.sourceRow, codes)

    for (const field of REQUIRED_PRODUCT_FIELDS) {
      const address = `${field.column}${product.sourceRow}`
      validateCellEvidence(state, evidence, '단가표', product.sourceRow, address, field.property, codes)
      if (product[field.property] == null) {
        const rawCell = evidence.get(`단가표:${product.sourceRow}`)?.rawCells.find((cell) => cell.address === address)
        const rawValue = rawCell?.originalValue ?? rawCell?.cachedValue ?? null
        const isBlank = rawValue == null || (typeof rawValue === 'string' && rawValue.trim() === '')
        if (rawCell?.errorCode == null && !isBlank) {
          codes.push('INVALID_DATA_TYPE')
          addIssue(state, {
            code: 'INVALID_DATA_TYPE', sourceSheet: '단가표', sourceRow: product.sourceRow,
            fieldPath: field.property, observedValue: rawValue,
            message: `${field.label} 값을 허용된 타입으로 해석할 수 없습니다.`,
            expectedRule: field.property === 'sourceQuantity'
              ? `${field.label} 값은 양의 정수여야 합니다.`
              : `${field.label} 값은 손실 없이 문자열로 보존할 수 있어야 합니다.`,
          })
        } else if (rawCell?.errorCode == null && isBlank) {
          codes.push('MISSING_REQUIRED_FIELD')
          addIssue(state, {
            code: 'MISSING_REQUIRED_FIELD', sourceSheet: '단가표', sourceRow: product.sourceRow,
            fieldPath: field.property, observedValue: null,
            message: `${field.label} 값이 없습니다.`, expectedRule: `${field.label} 값은 Product 후보에 필수입니다.`,
          })
        }
      }
    }

    if (product.sourceQuantity != null && (!Number.isInteger(product.sourceQuantity) || product.sourceQuantity <= 0)) {
      codes.push('INVALID_QUANTITY')
      addIssue(state, {
        code: 'INVALID_QUANTITY', sourceSheet: '단가표', sourceRow: product.sourceRow,
        fieldPath: 'sourceQuantity', observedValue: product.sourceQuantity,
        message: '구성수는 양의 정수여야 합니다.', expectedRule: 'sourceQuantity must be a positive integer.',
      })
    }
  }

  const byBusinessKey = new Map<string, ProductCandidate[]>()
  for (const product of capture.products) {
    if (!product.sabangnetCode) continue
    const group = byBusinessKey.get(product.sabangnetCode) ?? []
    group.push(product)
    byBusinessKey.set(product.sabangnetCode, group)
  }
  for (const [businessKey, group] of byBusinessKey) {
    if (group.length < 2) continue
    const identities = new Map<string, ProductCandidate[]>()
    for (const product of group) {
      const identity = productIdentity(product)
      const matching = identities.get(identity) ?? []
      matching.push(product)
      identities.set(identity, matching)
    }
    const channelScopes = new Set(group.map((product) => product.sourceChannel))
    if (identities.size === 1 && channelScopes.size === group.length) {
      const sourceRow = group[0].sourceRow
      for (const variant of group.slice(1)) variantRows.set(variant.sourceRow, sourceRow)
      continue
    }
    const relatedRows = group.map((product) => product.sourceRow)
    for (const product of group) productCodes.get(product.sourceRow)?.push('DUPLICATE_BUSINESS_KEY')
    addIssue(state, {
      code: 'DUPLICATE_BUSINESS_KEY', sourceSheet: '단가표', sourceRow: relatedRows[0], fieldPath: 'sabangnetCode',
      observedValue: businessKey, relatedRows,
      message: `서로 다른 상품 ${group.length}개가 사방넷 품번 ${businessKey}을 사용합니다.`,
      expectedRule: '서로 다른 Product 후보는 동일한 사방넷 품번을 공유할 수 없습니다.',
    })
  }

  for (const product of capture.products) {
    const productIssueCodes = productCodes.get(product.sourceRow) ?? []
    if (!product.rawBomText) continue
    const parsed = parseBom(product.rawBomText)
    if (parsed.tokens.length === 0 || parsed.unparsedText.length > 0) {
      productIssueCodes.push('UNPARSEABLE_BOM')
      addIssue(state, {
        code: 'UNPARSEABLE_BOM', sourceSheet: '단가표', sourceRow: product.sourceRow, fieldPath: 'rawBomText',
        observedValue: product.rawBomText, message: '구성 상세에서 SKU 코드와 수량을 확정할 수 없습니다.',
        expectedRule: 'BOM은 CODE N개 형식의 쉼표 구분 토큰이어야 합니다.',
      })
    }

    let parsedTotal = 0
    parsed.tokens.forEach((token, tokenIndex) => {
      const componentCodes: MasterImportErrorCode[] = []
      if (!token.validQuantity) {
        componentCodes.push('INVALID_QUANTITY')
        productIssueCodes.push('INVALID_QUANTITY')
        addIssue(state, {
          code: 'INVALID_QUANTITY', sourceSheet: '단가표', sourceRow: product.sourceRow,
          fieldPath: `rawBomText[${tokenIndex}].quantity`, observedValue: token.quantity,
          message: `${token.rawToken}의 수량이 양의 정수가 아닙니다.`, expectedRule: 'BOM quantity must be a positive integer.',
        })
      } else {
        parsedTotal += token.quantity
      }
      if (!skuRegistry.has(token.skuCode)) {
        componentCodes.push('UNKNOWN_SKU')
        productIssueCodes.push('UNKNOWN_SKU')
        addIssue(state, {
          code: 'UNKNOWN_SKU', sourceSheet: '단가표', sourceRow: product.sourceRow,
          fieldPath: `rawBomText[${tokenIndex}].skuCode`, observedValue: token.skuCode,
          message: `${token.skuCode}가 지원되는 코드DB SKU block의 후보에 없습니다.`,
          expectedRule: 'BOM 코드는 냉동용기 또는 구성품 block의 SKU 후보와 정확히 일치해야 합니다. 그 밖의 block은 원본 소유자 확인 전 보류합니다.',
        })
      }
      const uniqueCodes = [...new Set(componentCodes)]
      for (const code of uniqueCodes) issueSeverity.set(code, 'ERROR')
      bomComponents.push(Object.freeze({
        id: `bom-단가표-${product.sourceRow}-${tokenIndex + 1}`,
        kind: 'BOM_COMPONENT', sourceSheet: '단가표', sourceRow: product.sourceRow,
        sourceBlock: product.sourceBlock,
        sourceFieldMap: Object.freeze({ rawToken: `F${product.sourceRow}`, sourceQuantity: `H${product.sourceRow}` }),
        productCode: product.sabangnetCode, productSourceRow: product.sourceRow,
        skuCode: token.skuCode, quantity: token.quantity, rawToken: token.rawToken,
        status: statusFromCodes(uniqueCodes, issueSeverity), issueCodes: Object.freeze(uniqueCodes),
      }))
    })

    if (
      parsed.unparsedText.length === 0 && parsed.tokens.length > 0 &&
      parsed.tokens.every((token) => token.validQuantity) &&
      product.sourceQuantity != null && parsedTotal !== product.sourceQuantity
    ) {
      productIssueCodes.push('BOM_QUANTITY_MISMATCH')
      addIssue(state, {
        code: 'BOM_QUANTITY_MISMATCH', sourceSheet: '단가표', sourceRow: product.sourceRow,
        fieldPath: 'sourceQuantity', observedValue: Object.freeze([parsedTotal, product.sourceQuantity]),
        message: `BOM 수량 합계 ${parsedTotal}개와 구성수 ${product.sourceQuantity}개가 다릅니다.`,
        expectedRule: '파싱된 BOM 수량 합계는 단가표 구성수와 같아야 합니다.',
      })
    }
  }

  for (const issue of state.issues) issueSeverity.set(issue.code, issue.severity)
  const products = capture.products.map((product) => {
    const uniqueCodes = [...new Set(productCodes.get(product.sourceRow) ?? [])]
    return Object.freeze({
      ...product,
      variantOfSourceRow: variantRows.get(product.sourceRow) ?? null,
      status: statusFromCodes(uniqueCodes, issueSeverity),
      issueCodes: Object.freeze(uniqueCodes),
    })
  })
  return { products, bomComponents }
}

function validateSkuEvidence(
  capture: MasterWorkbookCapture,
  state: ValidationState,
): SkuCandidate[] {
  const evidence = rawRowByLocation(capture.rawRows)
  return capture.skus.map((sku) => {
    const codes: MasterImportErrorCode[] = []
    validateCellEvidence(state, evidence, '코드DB', sku.sourceRow, `E${sku.sourceRow}`, 'skuCode', codes)
    const uniqueCodes = [...new Set(codes)]
    const issueSeverity = new Map(uniqueCodes.map((code) => [code, code === 'FORMULA_CACHE_UNTRUSTED' ? 'WARNING' as const : 'ERROR' as const]))
    const status = uniqueCodes.length > 0
      ? statusFromCodes(uniqueCodes, issueSeverity)
      : sku.registryStatus === 'BOM_REGISTRY' ? 'VALID' : 'DEFERRED'
    return Object.freeze({ ...sku, status, issueCodes: Object.freeze(uniqueCodes) })
  })
}
function schemaIssues(capture: MasterWorkbookCapture, state: ValidationState): void {
  for (const schemaError of capture.schemaErrors) {
    addIssue(state, {
      code: 'SOURCE_SCHEMA_MISMATCH', sourceSheet: 'Workbook', sourceRow: null, fieldPath: null,
      observedValue: schemaError, message: schemaError,
      expectedRule: `필수 Sheet(${REQUIRED_MASTER_SHEETS.join(', ')})와 core header 위치가 지원 계약과 일치해야 합니다.`,
    })
  }
}

function summaryStatusCount(items: readonly { status: MasterImportStatus }[], status: MasterImportStatus): number {
  return items.filter((item) => item.status === status).length
}

export function validateMasterCapture(capture: MasterWorkbookCapture, fileName: string): MasterImportPreview {
  const state: ValidationState = { issues: [], issueSequence: 0 }
  schemaIssues(capture, state)
  const { products, bomComponents } = validateProducts(capture, state)
  const skus = validateSkuEvidence(capture, state)
  const allCandidates = [...products, ...skus, ...bomComponents]
  const issues = Object.freeze([...state.issues])
  const blockingCount = issues.filter((issue) => issue.blockingScope === 'BATCH').length

  return Object.freeze({
    workbook: Object.freeze({
      fileName,
      sheetNames: Object.freeze([...capture.workbook.SheetNames]),
      requiredSheets: REQUIRED_MASTER_SHEETS,
      schemaValid: capture.schemaErrors.length === 0,
    }),
    rawRows: capture.rawRows,
    products: Object.freeze(products),
    skus: Object.freeze(skus),
    bomComponents: Object.freeze(bomComponents),
    issues,
    summary: Object.freeze({
      rowCount: capture.rawRows.length,
      productCount: products.length,
      skuCount: skus.length,
      bomCount: bomComponents.length,
      validCount: summaryStatusCount(allCandidates, 'VALID'),
      warningCount: summaryStatusCount(allCandidates, 'WARNING'),
      errorCount: summaryStatusCount(allCandidates, 'ERROR'),
      deferredCount: summaryStatusCount(allCandidates, 'DEFERRED'),
      blockingCount,
    }),
    blocked: blockingCount > 0,
  })
}
