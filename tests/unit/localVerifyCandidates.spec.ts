import { createHash } from 'node:crypto'
import { expect,test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { verifyCandidatesAgainstWorkbook } from '../../server/import/verifyCandidates'
import { analyzeMasterWorkbook } from '../../src/services/import'
import { buildMasterImportPayload } from '../../src/services/importPersistence'
import { LOCAL_APPROVED_BUNDLE_SKUS, LOCAL_APPROVED_SKU_CATEGORIES, LOCAL_SKU_COMPONENTS } from '../../src/services/import/localPolicy'

test('server-side workbook check detects altered, omitted and reviewed candidates',async()=>{
  const book=XLSX.utils.book_new()
  const price=XLSX.utils.aoa_to_sheet([[],[],[],[],[null,'사방넷품번','구분','카테고리','모델명','구성 상세',null,'구성수'],[null,'1001','단품','냉동용기','상품','AL00 1개',null,1]])
  const codes=XLSX.utils.aoa_to_sheet([[],[],[null,null,'상품명','옵션명','상품코드'],[null,'냉동용기'],[null,null,'상품','라벤더','AL00']])
  const products=XLSX.utils.aoa_to_sheet([[],[],['마스터 상품명',null,'사방넷 품번코드']])
  XLSX.utils.book_append_sheet(book,price,'단가표');XLSX.utils.book_append_sheet(book,codes,'코드DB');XLSX.utils.book_append_sheet(book,products,'상품DB')
  const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer
  const hash=createHash('sha256').update(bytes).digest('hex')
  const preview=await analyzeMasterWorkbook(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS})
  const stored=buildMasterImportPayload(preview,hash).p_candidates.map(item=>({kind:item.kind,candidate_ordinal:item.candidateOrdinal,source_sheet:item.sourceSheet,source_row:item.sourceRow,source_block:item.sourceBlock,candidate_status:item.status,issue_codes:[...item.issueCodes],normalized_values:item.normalizedValues,reviewed_values:null}))
  expect(await verifyCandidatesAgainstWorkbook(bytes,hash,stored)).toBe(true)
  expect(await verifyCandidatesAgainstWorkbook(bytes,hash,stored.slice(1))).toBe(false)
  expect(await verifyCandidatesAgainstWorkbook(bytes,hash,stored.map((item,index)=>index===0?{...item,normalized_values:{...item.normalized_values,productName:'임의 변경'}}:item))).toBe(false)
  expect(await verifyCandidatesAgainstWorkbook(bytes,hash,stored.map((item,index)=>index===0?{...item,reviewed_values:{productName:'임의 변경'}}:item))).toBe(false)
})
