import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { analyzeMasterWorkbook } from '../../src/services/import/index.ts'
import { buildMasterImportPayload } from '../../src/services/importPersistence.ts'
import { LOCAL_APPROVED_BUNDLE_SKUS, LOCAL_APPROVED_SKU_CATEGORIES, LOCAL_SKU_COMPONENTS, LOCAL_NON_COUNTED_SKUS } from '../../src/services/import/localPolicy.ts'

export interface StoredCandidateSnapshot {
  kind:string; candidate_ordinal:number; source_sheet:string; source_row:number; source_block:string|null
  candidate_status:string; issue_codes:string[]; normalized_values:unknown; reviewed_values:unknown
}

// This is one safeguard for a future server-side apply; it does not authorize
// or perform a database write. Reviewed values require separate revalidation.
export async function verifyCandidatesAgainstWorkbook(bytes:Buffer,hash:string,stored:readonly StoredCandidateSnapshot[]):Promise<boolean> {
  if(!/^[0-9a-f]{64}$/.test(hash) || createHash('sha256').update(bytes).digest('hex')!==hash)return false
  const input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
  const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
  if(!preview.workbook.schemaValid || stored.some(item=>item.reviewed_values!==null && item.reviewed_values!==undefined))return false
  const expected=buildMasterImportPayload(preview,hash).p_candidates
  if(expected.length!==stored.length)return false
  const byKey=new Map(stored.map(item=>[`${item.kind}:${item.candidate_ordinal}`,item]))
  if(byKey.size!==stored.length)return false
  return expected.every(candidate=>{
    const item=byKey.get(`${candidate.kind}:${candidate.candidateOrdinal}`)
    return !!item && item.source_sheet===candidate.sourceSheet && item.source_row===candidate.sourceRow && item.source_block===candidate.sourceBlock && item.candidate_status===candidate.status && isDeepStrictEqual(item.issue_codes,candidate.issueCodes) && isDeepStrictEqual(item.normalized_values,candidate.normalizedValues)
  })
}
