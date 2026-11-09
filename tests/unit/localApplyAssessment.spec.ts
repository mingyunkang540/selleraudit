import { expect, test } from '@playwright/test'
import { assessLocalProducts } from '../../src/services/import/localApplyAssessment'
import type { MasterImportApplyPreview, SavedImportCandidate } from '../../src/services/importPersistence'

function candidate(id:string,kind:SavedImportCandidate['kind'],sourceRow:number,normalizedValues:Record<string,unknown>):SavedImportCandidate {
  return {id,kind,sourceRow,normalizedValues,candidateOrdinal:1,validationRevision:1,sourceSheet:'단가표',sourceBlock:null,sourceFieldMap:{},candidateStatus:'VALID',issueCodes:[],rawImportRowId:id,supportingRawRowIds:[],reviewedValues:null,reviewNote:null,reviewRevision:0,reviewedBy:null,reviewedAt:null}
}
test('assessment associates SKU conflicts with every dependent product and propagates shared codes',()=>{
  const items=[candidate('p1','PRODUCT',6,{sabangnetCode:'1',productName:'첫 상품'}),candidate('p2','PRODUCT',7,{sabangnetCode:'2',productName:'둘째'}),candidate('p3','PRODUCT',8,{sabangnetCode:'2',productName:'같은 품번'}),candidate('b1','BOM_COMPONENT',6,{productSourceRow:6,skuCode:'BAD',quantity:1}),candidate('b2','BOM_COMPONENT',7,{productSourceRow:7,skuCode:'OK',quantity:1}),candidate('b3','BOM_COMPONENT',8,{productSourceRow:8,skuCode:'OK',quantity:1}),candidate('ok','SKU',10,{skuCode:'OK'})]
  const rows=items.map(item=>({candidateId:item.id,kind:item.kind,status:'NEW' as const,businessKey:''}))
  const preview={rows:[...rows,{candidateId:'sku',kind:'SKU',status:'CONFLICT',businessKey:'BAD'},{candidateId:'p3',kind:'PRODUCT',status:'CONFLICT',businessKey:'2'}]} as MasterImportApplyPreview
  // Duplicate IDs are rejected by the real persistence layer. Replace the
  // matching status as a real preview would instead of duplicating a row.
  preview.rows=preview.rows.filter((row,index)=>row.candidateId!=='p3'||index===preview.rows.length-1)
  const result=assessLocalProducts(items,preview)
  expect(result[0].reasons).toContain('SKU BAD에 충돌이 있습니다.')
  expect(result[1].reasons).toContain('같은 품번의 다른 행을 함께 확인해야 합니다.')
  expect(result[2].reasons).toContain('상품 자체를 적용할 수 없습니다.')
})
test('assessment holds different channel compositions, incomplete components and unlisted bundles',()=>{
  const items=[candidate('p1','PRODUCT',6,{sabangnetCode:'X',productName:'공통'}),candidate('p2','PRODUCT',7,{sabangnetCode:'X',productName:'아쿠아'}),candidate('p3','PRODUCT',8,{sabangnetCode:null,productName:'미등록'}),candidate('p4','PRODUCT',9,{sabangnetCode:'Y',productName:'묶음'}),candidate('b1','BOM_COMPONENT',6,{productSourceRow:6,skuCode:'AL00',quantity:1}),candidate('b2','BOM_COMPONENT',7,{productSourceRow:7,skuCode:'AQ00',quantity:1}),candidate('b3','BOM_COMPONENT',8,{productSourceRow:8,skuCode:'AL00',quantity:1}),candidate('b4','BOM_COMPONENT',9,{productSourceRow:9,skuCode:'AL502',quantity:1})]
  const preview={rows:items.map(item=>({candidateId:item.id,kind:item.kind,status:item.id==='b3'?'SKIPPED_DEPENDENCY':'NEW',businessKey:''}))} as MasterImportApplyPreview
  const result=assessLocalProducts(items,preview)
  expect(result[0].reasons.join()).toContain('채널 또는 옵션별 구성')
  expect(result[1].reasons.join()).toContain('채널 또는 옵션별 구성')
  expect(result[2].reasons.join()).toContain('사방넷 품번이 없는 구성')
  expect(result[2].reasons.join()).toContain('구성품을 적용할 수 없습니다')
  expect(result[3].reasons.join()).toContain('AL502')
})
