import { buildMasterImportPayload, ImportPersistenceError, mapApplyPreview, mapApplyResult, mapBatch, mapCandidate, mapIssue, mapRawRow } from './importPersistence'
import type { ImportPersistence, SavedImportSource, LocalInitialPlan, LocalInitialResult } from './importPersistence'
import { LOCAL_MASTER_PARSER_VERSION } from './import/localPolicy'

type Row=Record<string,unknown>
function rows(value:unknown):Row[] {if(!Array.isArray(value)||!value.every(x=>x&&typeof x==='object'&&!Array.isArray(x)))throw new Error('Invalid response');return value as Row[]}
function object(value:unknown):Row {if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid response');return value as Row}
export function createLocalImportPersistence(workspaceId:string,csrf:string):ImportPersistence {
  const call=async(path:string,method='GET',body?:object):Promise<unknown>=>{
    const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})})
    if(!response.ok)throw new ImportPersistenceError('로컬 Import 요청을 처리하지 못했습니다.')
    return response.json() as Promise<unknown>
  }
  return {
    async previewLocalInitial(batchId){
      const value=object(await call(`/api/import/batches/${encodeURIComponent(batchId)}/initial-plan`))
      if(typeof value.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(value.fingerprint)||!Number.isSafeInteger(value.skuCount)||!Array.isArray(value.products)||!Array.isArray(value.excluded))throw new Error('Invalid plan')
      const products=rows(value.products).map(item=>{
        if(!Number.isSafeInteger(item.row)||typeof item.code!=='string'||typeof item.name!=='string'||!Array.isArray(item.components))throw new Error('Invalid product')
        const components=rows(item.components).map(component=>{if(typeof component.sku!=='string'||!Number.isSafeInteger(component.quantity)||Number(component.quantity)<1)throw new Error('Invalid component');return {sku:component.sku,quantity:Number(component.quantity)}})
        return {row:Number(item.row),code:item.code,name:item.name,components}
      })
      const excluded=rows(value.excluded).map(item=>{if(!Number.isSafeInteger(item.row)||(item.name!==null&&typeof item.name!=='string')||!Array.isArray(item.reasons)||!item.reasons.every(reason=>typeof reason==='string'))throw new Error('Invalid exclusion');return {row:Number(item.row),name:item.name as string|null,reasons:item.reasons as string[]}})
      return {fingerprint:value.fingerprint,skuCount:Number(value.skuCount),products,excluded} satisfies LocalInitialPlan
    },
    async applyLocalInitial(batchId,fingerprint){
      const value=object(await call(`/api/import/batches/${encodeURIComponent(batchId)}/initial-apply`,'POST',{confirmed:true,fingerprint}))
      if(!Number.isSafeInteger(value.productsCreated)||!Number.isSafeInteger(value.skusCreated)||!Number.isSafeInteger(value.componentsCreated)||!Array.isArray(value.excluded)||!['APPLIED','PARTIALLY_APPLIED'].includes(String(value.status)))throw new Error('Invalid result')
      const excluded=rows(value.excluded).map(item=>{if(!Number.isSafeInteger(item.row)||(item.name!==null&&typeof item.name!=='string')||!Array.isArray(item.reasons)||!item.reasons.every(reason=>typeof reason==='string'))throw new Error('Invalid exclusion');return {row:Number(item.row),name:item.name as string|null,reasons:item.reasons as string[]}})
      return {productsCreated:Number(value.productsCreated),skusCreated:Number(value.skusCreated),componentsCreated:Number(value.componentsCreated),excluded,status:value.status as LocalInitialResult['status']}
    },
    async createCorrectedSource(sourceFileId,edits,newSkus,batchId,ignoredIssues){
      const result=object(await call('/api/import/corrections','POST',{sourceFileId,edits,newSkus,batchId,ignoredIssues}))
      if(typeof result.id!=='string'||typeof result.serverSha256!=='string'||typeof result.serverByteSize!=='number')throw new Error('Invalid correction response')
      return {id:result.id,serverSha256:result.serverSha256,serverByteSize:result.serverByteSize}
    },
    async prepareSourceFile(file,hash,onStage){
      onStage?.('UPLOADING')
      const response=await fetch('/api/import/sources',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','X-CSRF-Token':csrf,'X-Source-Filename':encodeURIComponent(file.name),'X-Source-Sha256':hash},body:file})
      onStage?.('VERIFYING')
      if(!response.ok)throw new ImportPersistenceError('원본 저장 또는 서버 검증에 실패했습니다.')
      const data=object(await response.json())
      if(typeof data.id!=='string'||data.serverSha256!==hash||data.serverByteSize!==file.size)throw new ImportPersistenceError('서버 검증 결과가 일치하지 않습니다.')
      return {id:data.id,serverSha256:hash,serverByteSize:file.size}
    },
    async saveMasterDryRun(preview,sourceFileId,hash){
      const p=buildMasterImportPayload(preview,hash)
      const result=object(await call('/api/import/batches','POST',{sourceFileId,parserVersion:LOCAL_MASTER_PARSER_VERSION,summary:p.p_summary,rawRows:p.p_raw_rows,candidates:p.p_candidates,issues:p.p_issues}))
      if(typeof result.id!=='string')throw new Error('Invalid batch')
      return result.id
    },
    async loadSourceFile(id){
      const row=object(await call(`/api/import/sources/${encodeURIComponent(id)}`))
      if(row.workspace_id!==workspaceId||row.id!==id||typeof row.original_filename!=='string'||!['PENDING_UPLOAD','VERIFIED','HASH_MISMATCH','VERIFICATION_FAILED'].includes(String(row.verification_status)))throw new Error('Invalid source')
      const correction=row.correction && typeof row.correction==='object' && !Array.isArray(row.correction) ? row.correction as Row : null
      const excludedRows=correction && Array.isArray(correction.excludedRows) ? correction.excludedRows.filter((item:unknown):item is {sheet:string;row:number}=>!!item && typeof item==='object' && typeof (item as Row).sheet==='string' && Number.isSafeInteger((item as Row).row)) : []
      const history=correction?.ignoredHistory ?? correction?.ignoredIssues
      const reasons=Array.isArray(history)?history.flatMap((item:unknown)=>item && typeof item==='object' && typeof (item as Row).reason==='string'?[(item as Row).reason as string]:[]):[]
      return {id,originalFilename:row.original_filename,verificationStatus:row.verification_status as SavedImportSource['verificationStatus'],serverSha256:row.server_verified_sha256 as string|null,serverByteSize:row.server_verified_byte_size as number|null,verifiedAt:row.verified_at as string|null,...(correction && typeof correction.originalSourceId==='string'?{correction:{originalSourceId:correction.originalSourceId,excludedRows,reasons}}:{})}
    },
    async createSourceDownloadUrl(id){return `/api/import/sources/${encodeURIComponent(id)}/download`},
    async listSavedMasterImports(){return rows(await call('/api/import/batches')).map(row=>mapBatch(row,workspaceId))},
    async loadSavedImportIssues(batchId){return rows(await call(`/api/import/batches/${encodeURIComponent(batchId)}/issues`)).map(row=>mapIssue(row,workspaceId,batchId))},
    async loadSavedImportCandidates(batchId){return rows(await call(`/api/import/batches/${encodeURIComponent(batchId)}/candidates`)).map(row=>mapCandidate(row,workspaceId,batchId))},
    async loadRawImportRow(rowId){return mapRawRow(object(await call(`/api/import/raw/${encodeURIComponent(rowId)}`)),workspaceId)},
    async reviewCandidate(id,validationRevision,reviewRevision,reviewedValues,resolution){await call(`/api/import/candidates/${encodeURIComponent(id)}/review`,'POST',{validationRevision,reviewRevision,reviewedValues,resolution})},
    async reviewIssue(id,validationRevision,reviewRevision,status,resolution){await call(`/api/import/issues/${encodeURIComponent(id)}/review`,'POST',{validationRevision,reviewRevision,status,resolution})},
    async previewMasterImportApply(batchId){return mapApplyPreview(await call(`/api/import/batches/${encodeURIComponent(batchId)}/preview`),batchId)},
    async applyMasterImportBatch(batchId){return mapApplyResult(await call(`/api/import/batches/${encodeURIComponent(batchId)}/apply`,'POST',{confirmed:true}),batchId)},
  }
}
