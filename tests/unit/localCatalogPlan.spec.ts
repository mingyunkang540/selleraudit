import { expect,test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { analyzeMasterWorkbook } from '../../src/services/import'
import { planLocalCatalog } from '../../src/services/import/localCatalogPlan'

async function fixture(){
  const book=XLSX.utils.book_new()
  const products=XLSX.utils.aoa_to_sheet<unknown>([])
  XLSX.utils.sheet_add_aoa(products,[['사방넷품번','구분','카테고리','모델명','구성 상세',null,'구성수']],{origin:'B5'})
  XLSX.utils.sheet_add_aoa(products,[
    [null,'세트','세트','미등록 세트','AL00 1개',null,1],
    ['100526','세트','세트','옵션 A','AL00 2개',null,2],
    ['100526','세트','세트','옵션 B','AL01 2개',null,2],
    ['100999','단품','기타','다른 상품','UNKNOWN 1개',null,1],
  ],{origin:'B6'})
  const codes=XLSX.utils.aoa_to_sheet<unknown>([])
  XLSX.utils.sheet_add_aoa(codes,[['입고일','상품명','옵션명','상품코드']],{origin:'B3'})
  XLSX.utils.sheet_add_aoa(codes,[['냉동용기'],[null,'A','색상','AL00'],[null,'B','색상','AL01']],{origin:'B4'})
  const legacy=XLSX.utils.aoa_to_sheet<unknown>([])
  XLSX.utils.sheet_add_aoa(legacy,[['마스터 상품명','단품 상품명','사방넷 품번코드']],{origin:'A3'})
  XLSX.utils.book_append_sheet(book,products,'단가표');XLSX.utils.book_append_sheet(book,codes,'코드DB');XLSX.utils.book_append_sheet(book,legacy,'상품DB')
  return analyzeMasterWorkbook(XLSX.write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer,'fixture.xlsx')
}

test('owner-confirmed unlisted set and collection options retain their individual components',async()=>{
  const preview=await fixture()
  const plan=planLocalCatalog(preview,{unlistedRows:[6],collections:[{code:'100526',rows:[7,8]}]})
  expect(plan.unlisted[0].components.map(item=>[item.skuCode,item.quantity])).toEqual([['AL00',1]])
  expect(plan.collections[0].options.map(item=>[item.component.skuCode,item.component.quantity])).toEqual([['AL00',2],['AL01',2]])
  expect(plan.remainingIssues.map(issue=>issue.code)).toContain('UNKNOWN_SKU')
  expect(plan.remainingIssues.some(issue=>issue.code==='MISSING_REQUIRED_FIELD' && issue.sourceRow===6)).toBe(false)
  expect(plan.remainingIssues.some(issue=>issue.code==='DUPLICATE_BUSINESS_KEY' && issue.observedValue==='100526')).toBe(false)
  expect(preview.issues.some(issue=>issue.code==='DUPLICATE_BUSINESS_KEY')).toBe(true)
  expect(()=>planLocalCatalog(preview,{unlistedRows:[6],collections:[{code:'100526',rows:[7]}]})).toThrow()
  expect(()=>planLocalCatalog(preview,{unlistedRows:[7],collections:[]})).toThrow()
  const ambiguous={...preview,bomComponents:preview.bomComponents.map(component=>component.productSourceRow===8?{...component,skuCode:'AL00'}:component)}
  expect(()=>planLocalCatalog(ambiguous,{unlistedRows:[6],collections:[{code:'100526',rows:[7,8]}]})).toThrow('Ambiguous option composition')
  const wrongQuantity={...preview,bomComponents:preview.bomComponents.map(component=>component.productSourceRow===8?{...component,quantity:3}:component)}
  expect(()=>planLocalCatalog(wrongQuantity,{unlistedRows:[6],collections:[{code:'100526',rows:[7,8]}]})).toThrow('Ambiguous option composition')
})

test('confirmed aqua channel variant keeps its own SKU and rejects ambiguous variants',async()=>{
  const base=await fixture()
  const common={...base.products[1],sourceRow:20,sabangnetCode:'AQUA',productName:'점보',sourceChannel:'공통',sourceQuantity:2}
  const channel={...common,sourceRow:21,sourceChannel:'오늘의집_아쿠아'}
  const commonBom={...base.bomComponents.find(item=>item.productSourceRow===7)!,productSourceRow:20,sourceRow:20,skuCode:'AL00',quantity:2}
  const aquaBom={...commonBom,productSourceRow:21,sourceRow:21,skuCode:'AQ00'}
  const lavender={...base.skus[0],skuCode:'AL00',modelName:'점보',color:'라벤더',status:'VALID' as const}
  const aqua={...lavender,skuCode:'AQ00',color:'아쿠아'}
  const duplicate={...base.issues.find(issue=>issue.code==='DUPLICATE_BUSINESS_KEY')!,sourceRow:20,observedValue:'AQUA',relatedRows:[20,21]}
  const preview={...base,products:[common,channel],bomComponents:[commonBom,aquaBom],skus:[lavender,aqua],issues:[duplicate]}
  const decision={unlistedRows:[],collections:[],channelVariants:[{commonRow:20,channelRow:21}]}
  const plan=planLocalCatalog(preview,decision)
  expect(plan.channelVariants[0].commonComponent.skuCode).toBe('AL00')
  expect(plan.channelVariants[0].channelComponent.skuCode).toBe('AQ00')
  expect(plan.remainingIssues).toHaveLength(0)
  expect(()=>planLocalCatalog({...preview,bomComponents:[commonBom,{...aquaBom,skuCode:'AQ01'}]},decision)).toThrow('Invalid channel composition')
  expect(()=>planLocalCatalog({...preview,skus:[lavender,{...aqua,modelName:'다른 모델'}]},decision)).toThrow('Unverified channel SKU')
  expect(()=>planLocalCatalog({...preview,products:[...preview.products,{...channel,sourceRow:22}]},decision)).toThrow('Incomplete channel variant')
})
