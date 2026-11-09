import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { parseBom } from '../../src/adapters/master'
import { analyzeMasterWorkbook } from '../../src/services/import'

type ProductFixture = readonly [string | null, string, string, string, string, number | string]

function createWorkbook(products: readonly ProductFixture[], includeVariant = false): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()
  const productsSheet = XLSX.utils.aoa_to_sheet<unknown>([])
  XLSX.utils.sheet_add_aoa(productsSheet, [[
    '사방넷품번', '구분', '카테고리', '모델명', '구성 상세', null, '구성수',
  ]], { origin: 'B5' })
  products.forEach((product, index) => {
    const [code, type, category, name, bom, quantity] = product
    XLSX.utils.sheet_add_aoa(productsSheet, [[code, type, category, name, bom, null, quantity]], { origin: `B${index + 6}` })
  })
  if (includeVariant) {
    XLSX.utils.sheet_add_aoa(productsSheet, [[
      '100051', '단품', '냉동용기', '점보', 'AL00 1개', null, 1,
    ]], { origin: 'B200' })
    XLSX.utils.sheet_add_aoa(productsSheet, [['공통']], { origin: 'AH6' })
    XLSX.utils.sheet_add_aoa(productsSheet, [['오늘의집_아쿠아']], { origin: 'AH200' })
  }
  XLSX.utils.book_append_sheet(workbook, productsSheet, '단가표')

  const codeSheet = XLSX.utils.aoa_to_sheet<unknown>([])
  XLSX.utils.sheet_add_aoa(codeSheet, [[
    '입고일', '상품명', '옵션명', '상품코드', '입고예정수량', '박스당 수량', '입고박스 수', '비고1', '포장작업 코드',
  ]], { origin: 'B3' })
  XLSX.utils.sheet_add_aoa(codeSheet, [['냉동용기']], { origin: 'B4' })
  XLSX.utils.sheet_add_aoa(codeSheet, [['점보', '쿨라벤더', 'AL00']], { origin: 'C23' })
  XLSX.utils.sheet_add_aoa(codeSheet, [['5호+밀큐브6개', '쿨라벤더', 'AL510']], { origin: 'C24' })
  XLSX.utils.sheet_add_aoa(codeSheet, [['1호', '아쿠아', 'AQ01']], { origin: 'C60' })
  XLSX.utils.sheet_add_aoa(codeSheet, [['박스(부자재)']], { origin: 'B61' })
  XLSX.utils.sheet_add_aoa(codeSheet, [['컬러박스A', null, 'E01']], { origin: 'C62' })
  XLSX.utils.book_append_sheet(workbook, codeSheet, '코드DB')

  const legacySheet = XLSX.utils.aoa_to_sheet<unknown>([])
  XLSX.utils.sheet_add_aoa(legacySheet, [['마스터 상품명', '단품 상품명', '사방넷 품번코드']], { origin: 'A3' })
  XLSX.utils.book_append_sheet(workbook, legacySheet, '상품DB')
  return workbook
}

function toArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

test('BOM grammar preserves valid letter-only inventory codes', () => {
  expect(parseBom('IBAN 1개, IBAKL 2개')).toEqual({
    tokens: [
      { skuCode: 'IBAN', quantity: 1, rawToken: 'IBAN 1개', validQuantity: true },
      { skuCode: 'IBAKL', quantity: 2, rawToken: 'IBAKL 2개', validQuantity: true },
    ],
    unparsedText: '',
  })
})

test('master dry-run creates provenance-safe Product, SKU, and BOM candidates', async () => {
  const preview = await analyzeMasterWorkbook(toArrayBuffer(createWorkbook([
    ['100051', '단품', '냉동용기', '점보', 'AL00 1개', 1],
  ])), 'sanitized-master.xlsx')

  expect(preview.workbook.schemaValid).toBe(true)
  expect(preview.products).toHaveLength(1)
  expect(preview.skus).toHaveLength(4)
  expect(preview.bomComponents).toHaveLength(1)
  expect(preview.products[0]).toEqual(expect.objectContaining({
    sabangnetCode: '100051', productName: '점보', productType: 'SINGLE',
    sourceSheet: '단가표', sourceRow: 6, status: 'VALID',
  }))
  expect(preview.skus).toContainEqual(expect.objectContaining({ skuCode: 'AL00', modelName: '점보', sourceRow: 23 }))
  expect(preview.skus).toContainEqual(expect.objectContaining({
    skuCode: 'E01', sourceCategory: '박스(부자재)', registryStatus: 'DEFERRED_SOURCE_BLOCK', status: 'DEFERRED',
  }))
  expect(preview.bomComponents[0]).toEqual(expect.objectContaining({
    productCode: '100051', skuCode: 'AL00', quantity: 1, rawToken: 'AL00 1개', status: 'VALID',
  }))
  expect(preview.rawRows.find((row) => row.sourceSheet === '단가표' && row.originalRowNumber === 6)?.rawCells)
    .toContainEqual(expect.objectContaining({ address: 'B6', originalType: 'STRING', originalValue: '100051' }))
  expect(preview.blocked).toBe(false)
})

test('packaging and logistics code blocks stay deferred and cannot satisfy BOM validation', async () => {
  const preview = await analyzeMasterWorkbook(toArrayBuffer(createWorkbook([
    ['100900', '세트', '혼합세트', 'Packaging reference', 'E01 1개', 1],
  ])), 'sanitized-master.xlsx')

  expect(preview.skus.find((sku) => sku.skuCode === 'E01')).toEqual(expect.objectContaining({
    sourceCategory: '박스(부자재)', registryStatus: 'DEFERRED_SOURCE_BLOCK', status: 'DEFERRED',
  }))
  expect(preview.bomComponents[0]).toEqual(expect.objectContaining({ skuCode: 'E01', status: 'ERROR' }))
  expect(preview.issues).toContainEqual(expect.objectContaining({
    code: 'UNKNOWN_SKU', observedValue: 'E01', blockingScope: 'BATCH',
  }))
  expect(preview.blocked).toBe(true)
})

test('intermediate bundle rows in a supported category stay deferred from BOM registry', async () => {
  const preview = await analyzeMasterWorkbook(toArrayBuffer(createWorkbook([
    ['100902', '세트', '혼합세트', 'Intermediate bundle reference', 'AL510 1개', 1],
  ])), 'sanitized-master.xlsx')

  expect(preview.skus.find((sku) => sku.skuCode === 'AL510')).toEqual(expect.objectContaining({
    sourceCategory: '냉동용기', registryStatus: 'DEFERRED_INTERMEDIATE_BUNDLE', status: 'DEFERRED',
  }))
  expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_SKU', observedValue: 'AL510' }))
  expect(preview.bomComponents[0].status).toBe('ERROR')
})

test('local policy recognizes only the two approved bundle codes as individual SKUs', async () => {
  const book=createWorkbook([['100902','세트','혼합세트','Approved bundles','AL510 1개, AL502 1개, AL999 1개',3]])
  const sheet=book.Sheets['코드DB']
  XLSX.utils.sheet_add_aoa(sheet,[['5호+채반','라벤더','AL502'],['기타+묶음','라벤더','AL999']],{origin:'C25'})
  const preview=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',{approvedBundleSkuCodes:['AL502','AL510']})
  for(const code of ['AL502','AL510']) {
    expect(preview.skus.find(sku=>sku.skuCode===code)?.status).toBe('VALID')
    expect(preview.bomComponents.find(component=>component.skuCode===code)?.status).toBe('VALID')
    expect(preview.issues.some(issue=>issue.code==='UNKNOWN_SKU' && issue.observedValue===code)).toBe(false)
  }
  expect(preview.skus.find(sku=>sku.skuCode==='AL999')?.registryStatus).toBe('DEFERRED_INTERMEDIATE_BUNDLE')
  expect(preview.issues.some(issue=>issue.code==='UNKNOWN_SKU' && issue.observedValue==='AL999')).toBe(true)
})

test('local policy recognizes only confirmed categories while leaving other categories deferred', async () => {
  const book=createWorkbook([['100903','세트','혼합세트','Packaging','E01 1개',1]])
  const policy={approvedSkuCategories:['기타','스티커','박스(부자재)','아이스 땡스보틀','로켓배송']}
  const sheet=book.Sheets['코드DB']
  XLSX.utils.sheet_add_aoa(sheet,[['미확인']],{origin:'B63'})
  XLSX.utils.sheet_add_aoa(sheet,[['기타상품',null,'U01']],{origin:'C64'})
  const preview=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',policy)
  expect(preview.skus.find(sku=>sku.skuCode==='E01')?.status).toBe('VALID')
  expect(preview.bomComponents.find(component=>component.skuCode==='E01')?.status).toBe('VALID')
  expect(preview.skus.find(sku=>sku.skuCode==='U01')?.registryStatus).toBe('DEFERRED_SOURCE_BLOCK')
  const old=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx')
  expect(old.skus.find(sku=>sku.skuCode==='E01')?.status).toBe('DEFERRED')
})

test('local quantity validation expands confirmed bundle contents without changing SKU candidates', async () => {
  const book=createWorkbook([
    ['100910','세트','혼합세트','채반 묶음','AL502 1개',2],
    ['100911','세트','혼합세트','밀큐브 묶음','AL510 1개',7],
    ['100912','세트','혼합세트','밀큐브 두 묶음','AL510 2개',14],
    ['100913','세트','혼합세트','틀린 구성수','AL502 1개',3],
  ])
  const sheet=book.Sheets['코드DB']
  XLSX.utils.sheet_add_aoa(sheet,[['5호+채반','라벤더','AL502'],['5호','라벤더','AL05'],['밀큐브','라벤더','AL10']],{origin:'C25'})
  XLSX.utils.sheet_add_aoa(sheet,[['구성품'],[null,'채반','중','A02']],{origin:'B28'})
  const policy={approvedBundleSkuCodes:['AL502','AL510'],skuComponents:{AL502:[{skuCode:'AL05',quantity:1},{skuCode:'A02',quantity:1}],AL510:[{skuCode:'AL05',quantity:1},{skuCode:'AL10',quantity:6}]}}
  const result=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',policy)
  expect(result.issues.filter(issue=>issue.code==='BOM_QUANTITY_MISMATCH').map(issue=>issue.sourceRow)).toEqual([9])
  expect(result.bomComponents.filter(component=>component.productSourceRow===6).map(component=>[component.skuCode,component.quantity])).toEqual([['AL502',1]])
  expect(result.bomComponents.filter(component=>component.productSourceRow===8).map(component=>[component.skuCode,component.quantity])).toEqual([['AL510',2]])
  const defaultResult=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',{approvedBundleSkuCodes:['AL502','AL510']})
  expect(defaultResult.issues.filter(issue=>issue.code==='BOM_QUANTITY_MISMATCH').map(issue=>issue.sourceRow)).toContain(6)
  const incomplete=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',{...policy,skuComponents:{AL502:[{skuCode:'NOTFOUND',quantity:1}]}})
  expect(incomplete.issues.some(issue=>issue.code==='BUNDLE_COMPOSITION_INVALID'&&issue.sourceRow===6)).toBe(true)
  const cycle=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',{...policy,skuComponents:{AL502:[{skuCode:'AL502',quantity:1}]}})
  expect(cycle.issues.some(issue=>issue.code==='BUNDLE_COMPOSITION_INVALID'&&issue.sourceRow===6)).toBe(true)
})

test('confirmed sticker and box SKUs remain in the BOM but do not count as product units',async()=>{
  const book=createWorkbook([['100920','세트','혼합세트','포장 포함','AL00 1개, SP22 2개, E01 2개',1]])
  XLSX.utils.sheet_add_aoa(book.Sheets['코드DB'],[['스티커'],[null,'스티커',null,'SP22']],{origin:'B63'})
  const policy={approvedSkuCategories:['스티커','박스(부자재)'],nonCountedSkuCodes:['SP22','E01']}
  const result=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',policy)
  expect(result.issues.some(issue=>issue.code==='BOM_QUANTITY_MISMATCH')).toBe(false)
  expect(result.bomComponents.map(item=>[item.skuCode,item.quantity])).toEqual([['AL00',1],['SP22',2],['E01',2]])
  const withoutPolicy=await analyzeMasterWorkbook(toArrayBuffer(book),'fixture.xlsx',{approvedSkuCategories:policy.approvedSkuCategories})
  expect(withoutPolicy.issues.some(issue=>issue.code==='BOM_QUANTITY_MISMATCH')).toBe(true)
})

test('non-empty non-numeric source quantity is invalid data rather than a missing field', async () => {
  const preview = await analyzeMasterWorkbook(toArrayBuffer(createWorkbook([
    ['100901', '단품', '냉동용기', 'Invalid quantity type', 'AL00 1개', 'not-a-number'],
  ])), 'sanitized-master.xlsx')

  expect(preview.issues).toContainEqual(expect.objectContaining({
    code: 'INVALID_DATA_TYPE', sourceRow: 6, fieldPath: 'sourceQuantity', observedValue: 'not-a-number',
  }))
  expect(preview.issues).not.toContainEqual(expect.objectContaining({
    code: 'MISSING_REQUIRED_FIELD', sourceRow: 6, fieldPath: 'sourceQuantity',
  }))
})

test('numeric product code preserves an explicit leading-zero display format', async () => {
  const workbook = createWorkbook([
    ['001234', '단품', '냉동용기', 'Leading zero code', 'AL00 1개', 1],
  ])
  workbook.Sheets['단가표'].B6 = { t: 'n', v: 1234, z: '000000' }

  const preview = await analyzeMasterWorkbook(toArrayBuffer(workbook), 'sanitized-master.xlsx')
  expect(preview.products[0]).toEqual(expect.objectContaining({ sabangnetCode: '001234', status: 'VALID' }))
  expect(preview.rawRows.find((row) => row.sourceSheet === '단가표' && row.originalRowNumber === 6)?.rawCells)
    .toContainEqual(expect.objectContaining({ address: 'B6', originalType: 'NUMBER', originalValue: 1234 }))
})

test('validation distinguishes channel variants from a real duplicate business key', async () => {
  const preview = await analyzeMasterWorkbook(toArrayBuffer(createWorkbook([
    ['100051', '단품', '냉동용기', '점보', 'AL00 1개', 1],
    ['100526', '세트', '단품세트', 'Product A', 'AL00 1개', 1],
    ['100526', '세트', '단품세트', 'Product B', 'AQ01 1개', 1],
  ], true)), 'sanitized-master.xlsx')

  const duplicate = preview.issues.find((issue) => issue.code === 'DUPLICATE_BUSINESS_KEY')
  expect(duplicate).toEqual(expect.objectContaining({ sourceRow: 7, observedValue: '100526', blockingScope: 'BATCH' }))
  expect(duplicate?.relatedRows).toEqual([7, 8])
  expect(preview.products.find((product) => product.sourceRow === 200)).toEqual(expect.objectContaining({
    sabangnetCode: '100051', variantOfSourceRow: 6, status: 'VALID',
  }))
  expect(preview.products.find((product) => product.sourceRow === 6)?.issueCodes).not.toContain('DUPLICATE_BUSINESS_KEY')
})

test('validation blocks unknown SKU, quantity mismatch, blank code, invalid BOM, and invalid quantity', async () => {
  const preview = await analyzeMasterWorkbook(toArrayBuffer(createWorkbook([
    ['100051', '단품', '냉동용기', '점보', 'AL00 1개', 1],
    ['100777', '세트', '혼합세트', 'Unknown SKU set', 'AL24 1개', 1],
    ['100778', '세트', '혼합세트', 'Mismatch set', 'AL00 1개', 2],
    [null, '세트', '혼합세트', 'Blank code set', 'AL00 1개', 1],
    ['100779', '세트', '혼합세트', 'Invalid BOM set', 'D19, AL00', 2],
    ['100780', '세트', '혼합세트', 'Invalid quantity set', 'AL00 0개', 1],
  ])), 'sanitized-master.xlsx')

  const codes = preview.issues.map((issue) => issue.code)
  expect(codes).toContain('UNKNOWN_SKU')
  expect(codes).toContain('BOM_QUANTITY_MISMATCH')
  expect(codes).toContain('MISSING_REQUIRED_FIELD')
  expect(codes).toContain('UNPARSEABLE_BOM')
  expect(codes).toContain('INVALID_QUANTITY')
  expect(preview.issues.find((issue) => issue.code === 'UNKNOWN_SKU')).toEqual(expect.objectContaining({
    sourceRow: 7, observedValue: 'AL24', severity: 'ERROR', blockingScope: 'BATCH',
  }))
  expect(preview.bomComponents.find((component) => component.skuCode === 'AL24')?.status).toBe('ERROR')
  expect(preview.products.find((product) => product.sourceRow === 9)?.sabangnetCode).toBeNull()
  expect(preview.blocked).toBe(true)
})

test('required formula and Excel error cells preserve evidence instead of becoming safe zeroes', async () => {
  const workbook = createWorkbook([
    ['100051', '단품', '냉동용기', '점보', 'AL00 1개', 1],
    ['100052', '단품', '냉동용기', '1호', 'AQ01 1개', 1],
  ])
  const sheet = workbook.Sheets['단가표']
  sheet.B6 = { t: 'n', v: 100051, f: '100000+51' }
  sheet.F7 = { t: 'e', v: 0x17, f: '1/0', w: '#REF!' }

  const preview = await analyzeMasterWorkbook(toArrayBuffer(workbook), 'formula-evidence.xlsx')
  const formulaCell = preview.rawRows.find((row) => row.sourceSheet === '단가표' && row.originalRowNumber === 6)?.rawCells
    .find((cell) => cell.address === 'B6')
  const errorCell = preview.rawRows.find((row) => row.sourceSheet === '단가표' && row.originalRowNumber === 7)?.rawCells
    .find((cell) => cell.address === 'F7')

  expect(formulaCell).toEqual(expect.objectContaining({ originalType: 'FORMULA', formulaText: '100000+51', cachedValue: 100051 }))
  expect(errorCell).toEqual(expect.objectContaining({ originalType: 'FORMULA', formulaText: '1/0', errorCode: '#REF!' }))
  expect(preview.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['FORMULA_CACHE_UNTRUSTED', 'EXCEL_CELL_ERROR']))
})

test('schema mismatch is a reviewable batch issue while unreadable input throws a safe error', async () => {
  const workbook = createWorkbook([['100051', '단품', '냉동용기', '점보', 'AL00 1개', 1]])
  workbook.SheetNames = workbook.SheetNames.filter((sheetName) => sheetName !== '상품DB')
  delete workbook.Sheets['상품DB']

  const preview = await analyzeMasterWorkbook(toArrayBuffer(workbook), 'missing-sheet.xlsx')
  expect(preview.workbook.schemaValid).toBe(false)
  expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_SCHEMA_MISMATCH', blockingScope: 'BATCH' }))
  expect(preview.blocked).toBe(true)

  await expect(analyzeMasterWorkbook(new ArrayBuffer(1), 'master.csv')).rejects.toMatchObject({
    name: 'MasterImportParseError', code: 'UNSUPPORTED_FILE_TYPE',
  })
  await expect(analyzeMasterWorkbook(new ArrayBuffer(0), 'master.xlsx')).rejects.toMatchObject({
    name: 'MasterImportParseError', code: 'WORKBOOK_READ_FAILED',
  })
})
