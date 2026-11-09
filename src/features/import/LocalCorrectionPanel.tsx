import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImportPersistence, NewWorkbookSku, SavedImportBatch, SavedImportCandidate, SavedImportIssue, SavedRawImportRow, VerifiedImportSource, WorkbookCorrection } from '../../services/importPersistence'
import { LOCAL_APPROVED_BUNDLE_SKUS, LOCAL_APPROVED_SKU_CATEGORIES, LOCAL_MASTER_PARSER_VERSION, LOCAL_SKU_COMPONENTS, LOCAL_NON_COUNTED_SKUS } from '../../services/import/localPolicy'

const columns = {
  단가표: [['B','사방넷 품번'],['C','구분'],['D','카테고리'],['E','모델명'],['F','구성 상세'],['H','구성수']],
  코드DB: [['C','상품명'],['D','옵션명'],['E','SKU 코드']],
} as const
type IgnoredDecision = { issueId:string; reason:string; rows:number[]; message:string }

function Confirmation({ edits, newSkus, ignored, onCancel, onConfirm }: { edits:readonly WorkbookCorrection[]; newSkus:readonly NewWorkbookSku[]; ignored:readonly IgnoredDecision[]; onCancel:()=>void; onConfirm:()=>void }) {
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(()=>{dialog.current?.showModal()},[])
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="correction-confirm-title" onCancel={event=>{event.preventDefault();onCancel()}}>
    <h2 id="correction-confirm-title">변경 내용 확정</h2>
    <p>아래 내용을 바탕으로 새 검증 기록을 만듭니다. 원본과 Master는 변경되지 않습니다.</p>
    <ul>{edits.map(edit=><li key={`${edit.sheet}:${edit.address}`}>{edit.sheet} {edit.address}: {edit.before || '(빈 값)'} → {edit.after || '(빈 값)'}</li>)}{newSkus.map(sku=><li key={sku.skuCode}>새 SKU {sku.skuCode} · {sku.modelName} · {sku.category}</li>)}{ignored.map(item=><li key={item.issueId}><strong>이번 적용에서 제외:</strong> 단가표 {item.rows.join(', ')}행 · {item.message} · 사유: {item.reason}</li>)}</ul>
    <div className="dialog-actions"><button type="button" className="button" onClick={onCancel}>돌아가기</button><button type="button" className="button button-primary" onClick={onConfirm}>변경 확정 및 재검증</button></div>
  </dialog>
}

export function LocalCorrectionPanel({ batch, candidates, issues, persistence, onComplete }: {
  batch: SavedImportBatch; candidates: readonly SavedImportCandidate[]; issues: readonly SavedImportIssue[]
  persistence: ImportPersistence; onComplete: (id:string) => Promise<void>
}) {
  const rows=useMemo(()=>{
    const byRow=new Map<string,SavedImportCandidate>()
    for(const candidate of candidates)if((candidate.kind==='PRODUCT' && candidate.sourceSheet==='단가표')||(candidate.kind==='SKU' && candidate.sourceSheet==='코드DB'))byRow.set(`${candidate.sourceSheet}:${candidate.sourceRow}`,candidate)
    const issueRows=new Set(issues.map(issue=>`${issue.sourceSheet}:${issue.sourceRow}`))
    return [...byRow.values()].sort((a,b)=>Number(issueRows.has(`${b.sourceSheet}:${b.sourceRow}`))-Number(issueRows.has(`${a.sourceSheet}:${a.sourceRow}`)) || a.sourceSheet.localeCompare(b.sourceSheet) || a.sourceRow-b.sourceRow)
  },[candidates,issues])
  const [rowId,setRowId]=useState('')
  const [raw,setRaw]=useState<SavedRawImportRow|null>(null)
  const [values,setValues]=useState<Record<string,string>>({})
  const [edits,setEdits]=useState<WorkbookCorrection[]>([])
  const [newSkus,setNewSkus]=useState<NewWorkbookSku[]>([])
  const [newSku,setNewSku]=useState<NewWorkbookSku>({category:'냉동용기',skuCode:'',modelName:'',color:''})
  const [ignored,setIgnored]=useState<IgnoredDecision[]>([])
  const [ignoreIssueId,setIgnoreIssueId]=useState<string|null>(null)
  const [ignoreReason,setIgnoreReason]=useState('')
  const [confirming,setConfirming]=useState(false)
  const [pending,setPending]=useState<VerifiedImportSource|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [success,setSuccess]=useState<string|null>(null)
  const rowEditor=useRef<HTMLDivElement>(null)
  const newSkuDirty=Boolean(newSku.skuCode.trim() || newSku.modelName.trim() || newSku.color.trim())
  const draftDirty=Boolean(raw && (raw.sourceSheet==='단가표'||raw.sourceSheet==='코드DB') && columns[raw.sourceSheet].some(([column])=>{
    const address=`${column}${raw.originalRowNumber}`;const cell=raw.rawCells.find(item=>item.address===address)
    if(!cell || ['FORMULA','ERROR','BOOLEAN','DATE'].includes(cell.originalType))return false
    const queued=edits.find(edit=>edit.sheet===raw.sourceSheet&&edit.address===address)
    return (values[address] ?? '') !== (queued?.after ?? String(cell.originalValue ?? ''))
  }))

  const selectRow=async(id:string)=>{
    if(draftDirty){setError('현재 행의 수정값을 먼저 담아 주세요.');return}
    setRowId(id);setRaw(null);setError(null)
    const candidate=rows.find(item=>item.rawImportRowId===id)
    if(!candidate)return
    setBusy(true)
    try {
      const item=await persistence.loadRawImportRow(id)
      setRaw(item)
      setValues(Object.fromEntries(item.rawCells.map(cell=>{
        const queued=edits.find(edit=>edit.sheet===item.sourceSheet && edit.address===cell.address)
        return [cell.address,queued?.after ?? String(cell.originalValue ?? '')]
      })))
      requestAnimationFrame(()=>rowEditor.current?.scrollIntoView({block:'start',behavior:'smooth'}))
    }catch{setError('원본 행을 불러오지 못했습니다.')}
    finally{setBusy(false)}
  }
  const queueRow=()=>{
    if(!raw || (raw.sourceSheet!=='단가표' && raw.sourceSheet!=='코드DB'))return
    const sheet=raw.sourceSheet
    if(sheet==='단가표' && ignored.some(item=>item.rows.includes(raw.originalRowNumber))){setError('제외 예정인 행은 동시에 수정할 수 없습니다. 제외를 취소하거나 다른 행을 선택해 주세요.');return}
    const allowed=columns[sheet].map(([column])=>`${column}${raw.originalRowNumber}`)
    const changed=raw.rawCells.filter(cell=>allowed.includes(cell.address) && !['FORMULA','ERROR','BOOLEAN','DATE'].includes(cell.originalType)).flatMap<WorkbookCorrection>(cell=>{
      const before=String(cell.originalValue ?? '');const after=values[cell.address] ?? ''
      return before===after ? [] : [{sheet,address:cell.address,before,after}]
    })
    setEdits(current=>[...current.filter(edit=>edit.sheet!==sheet || !allowed.includes(edit.address)),...changed])
    setError(null)
  }
  const ignoreIssue=async(issue:SavedImportIssue)=>{
    if(!ignoreReason.trim() || draftDirty)return
    setBusy(true);setError(null)
    try {
      const ids=[...new Set([issue.rawImportRowId,...issue.relatedRawRowIds].filter((id):id is string=>!!id))]
      if(!ids.length)throw new Error('Missing rows')
      const sourceRows=await Promise.all(ids.map(id=>persistence.loadRawImportRow(id)))
      if(sourceRows.some(row=>row.sourceSheet!=='단가표'))throw new Error('Unsupported rows')
      const affected=new Set(sourceRows.map(row=>row.originalRowNumber))
      const productCodes=new Set(candidates.filter(candidate=>candidate.kind==='PRODUCT' && candidate.sourceSheet==='단가표' && affected.has(candidate.sourceRow)).map(candidate=>String(candidate.normalizedValues.sabangnetCode ?? '').trim()).filter(Boolean))
      for(const candidate of candidates)if(candidate.kind==='PRODUCT' && candidate.sourceSheet==='단가표' && productCodes.has(String(candidate.normalizedValues.sabangnetCode ?? '').trim()))affected.add(candidate.sourceRow)
      const rowNumbers=[...affected].sort((a,b)=>a-b)
      if(edits.some(edit=>edit.sheet==='단가표' && rowNumbers.includes(Number(edit.address.replace(/^[A-Z]+/,'')))))throw new Error('Row has edits')
      setIgnored(current=>[...current.filter(item=>item.issueId!==issue.id),{issueId:issue.id,reason:ignoreReason.trim(),rows:rowNumbers,message:issue.message}])
      setIgnoreIssueId(null);setIgnoreReason('')
    }catch{setError('제외할 원본 행을 확인하지 못했거나 해당 행에 수정 예정 값이 있습니다. 수정값을 정리한 후 다시 시도해 주세요.')}
    finally{setBusy(false)}
  }
  const revalidate=async()=>{
    if(!batch.sourceFileId || !persistence.createCorrectedSource || (!edits.length&&!newSkus.length&&!ignored.length))return
    setBusy(true);setError(null)
    try {
      const corrected=pending ?? await persistence.createCorrectedSource(batch.sourceFileId,edits,newSkus,batch.id,ignored.map(item=>({issueId:item.issueId,reason:item.reason})))
      setPending(corrected)
      const url=await persistence.createSourceDownloadUrl(corrected.id)
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store'})
      if(!response.ok)throw new Error('Download failed')
      const bytes=await response.arrayBuffer()
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
      if(bytes.byteLength!==corrected.serverByteSize || digest!==corrected.serverSha256)throw new Error('Hash mismatch')
      const { analyzeMasterWorkbook }=await import('../../services/import')
      const preview=await analyzeMasterWorkbook(bytes,`corrected-${batch.sourceFileId.slice(0,8)}.xlsx`,{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
      const id=await persistence.saveMasterDryRun(preview,corrected.id,digest)
      setSuccess(`새 검증 기록이 저장되었습니다. 차단 이슈 ${preview.summary.blockingCount}건 · 기록 ID ${id}`)
      await onComplete(id)
    }catch{setError('수정본 생성 또는 재검증에 실패했습니다. 입력값과 원본 상태를 확인해 주세요. 수식·병합 셀은 이 화면에서 수정할 수 없습니다.')}
    finally{setBusy(false)}
  }
  const updateAnalysis=async()=>{
    if(!batch.sourceFileId)return
    setBusy(true);setError(null)
    try {
      const url=await persistence.createSourceDownloadUrl(batch.sourceFileId)
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store'})
      if(!response.ok)throw new Error('Download failed')
      const bytes=await response.arrayBuffer()
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
      if(digest!==batch.sourceHash)throw new Error('Hash mismatch')
      const { analyzeMasterWorkbook }=await import('../../services/import')
      const preview=await analyzeMasterWorkbook(bytes,batch.sourceFilename,{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
      const id=await persistence.saveMasterDryRun(preview,batch.sourceFileId,digest)
      setSuccess(`새 검증 기록이 저장되었습니다. 차단 이슈 ${preview.summary.blockingCount}건 · 기록 ID ${id}`)
      await onComplete(id)
    }catch{setError('현재 기준으로 다시 검증하지 못했습니다. 원본과 저장 상태를 확인해 주세요.')}
    finally{setBusy(false)}
  }
  if(batch.parserVersion!==LOCAL_MASTER_PARSER_VERSION)return <section className="import-review-section local-correction" aria-label="직접 수정 및 재검증">
    <h3>직접 수정 및 재검증</h3><p>이 기록은 이전 검증 기준으로 만들어졌습니다. 오류를 처리하기 전에 현재 기준으로 다시 검증해 주세요. 원본과 Master는 변경되지 않습니다.</p>
    <button type="button" className="button button-primary" disabled={busy||!!success} onClick={()=>void updateAnalysis()}>{busy?'검증 중…':'현재 기준으로 다시 검증'}</button>
    {error && <p className="import-error" role="alert">{error}</p>}{success && <p role="status">{success}</p>}
  </section>
  return <section className="import-review-section local-correction" aria-label="직접 수정 및 재검증">
    <h3>직접 수정 및 재검증</h3>
    <p>원본은 보존됩니다. 확인한 값만 수정해 새 검증 기록을 만들며, Master에는 적용되지 않습니다. 수정 예정 값은 재검증을 완료하기 전까지 이 화면에만 남습니다.</p>
    <h4>오류 사유와 처리</h4><p>각 오류를 수정하거나 해당 상품 행을 이번 적용에서 제외할 수 있습니다. 제외하면 같은 상품 품번의 모든 행과 해당 구성품이 빠지고, 그 행의 다른 오류도 함께 제외됩니다.</p>
    <div className="local-correction-issues">{issues.filter(issue=>(issue.blockingScope==='BATCH'||issue.severity==='ERROR') && issue.status==='OPEN').map(issue=>{
      const decision=ignored.find(item=>item.issueId===issue.id)
      const candidate=rows.find(item=>item.sourceSheet===issue.sourceSheet && item.sourceRow===issue.sourceRow)
      const eligible=issue.sourceSheet==='단가표' && !!issue.rawImportRowId
      return <article key={issue.id} className="local-correction-issue"><strong>{issue.sourceSheet ?? '전체'} / {issue.sourceRow ?? '전체'}행 · {issue.issueCode}</strong><p>{issue.message}</p><p>원본 값: {issue.observedValue == null || issue.observedValue === '' ? '(빈 값)' : typeof issue.observedValue === 'object' ? JSON.stringify(issue.observedValue) : String(issue.observedValue)}</p><p>기대 기준: {issue.expectedRule}</p>
        {candidate?.kind==='PRODUCT' && <div><p>상품명: {String(candidate.normalizedValues.productName ?? '(빈 값)')} · 사방넷 품번: {String(candidate.normalizedValues.sabangnetCode ?? '(없음)')}</p><p>구성 상세: {String(candidate.normalizedValues.rawBomText ?? '(빈 값)')}</p><p>엑셀 구성수: {String(candidate.normalizedValues.sourceQuantity ?? '(빈 값)')}</p>{issue.issueCode==='BOM_QUANTITY_MISMATCH' && <p>실물 수량 계산 기준: AL502 1개는 AL05 1개와 A02 1개, AL510 1개는 AL05 1개와 AL10 6개로 계산합니다. SP22 스티커와 E01 박스는 구성수에서 제외합니다.</p>}</div>}
        {decision ? <p>제외 예정: 단가표 {decision.rows.join(', ')}행 · 사유: {decision.reason} <button type="button" disabled={busy||!!pending||!!success} onClick={()=>setIgnored(current=>current.filter(item=>item.issueId!==issue.id))}>취소</button></p> : <div><button type="button" className="button button-small" disabled={busy||!!pending||!!success||!candidate} onClick={()=>{if(candidate)void selectRow(candidate.rawImportRowId)}}>수정하기</button> <button type="button" className="button button-small" disabled={busy||!!pending||!!success||!eligible} onClick={()=>{setIgnoreIssueId(issue.id);setIgnoreReason('')}}>이번 적용에서 제외</button>{!eligible && <small> 이 오류는 전체 구조 또는 지원하지 않는 행에 관련되어 제외할 수 없습니다.</small>}</div>}
        {ignoreIssueId===issue.id && !decision && <div className="local-ignore-reason"><label>제외 사유<input maxLength={500} value={ignoreReason} disabled={busy} onChange={event=>setIgnoreReason(event.target.value)}/></label><button type="button" className="button" disabled={busy||!ignoreReason.trim()||draftDirty} onClick={()=>void ignoreIssue(issue)}>제외할 행 확인</button><button type="button" className="button" disabled={busy} onClick={()=>{setIgnoreIssueId(null);setIgnoreReason('')}}>취소</button></div>}
      </article>
    })}</div>
    <div ref={rowEditor}><label>수정할 원본 행 <select value={rowId} disabled={busy || !!pending || !!success} onChange={event=>void selectRow(event.target.value)}><option value="">행을 선택하세요</option>{rows.map(item=><option key={`${item.sourceSheet}:${item.sourceRow}`} value={item.rawImportRowId}>{item.sourceSheet} / {item.sourceRow}행 · {String(item.normalizedValues.productName ?? item.normalizedValues.modelName ?? '')}{issues.some(issue=>issue.sourceSheet===item.sourceSheet&&issue.sourceRow===item.sourceRow)?' · 이슈 있음':''}</option>)}</select></label></div>
    {raw && (raw.sourceSheet==='단가표'||raw.sourceSheet==='코드DB') && <div className="local-correction-fields">{columns[raw.sourceSheet].map(([column,label])=>{
      const address=`${column}${raw.originalRowNumber}`;const cell=raw.rawCells.find(item=>item.address===address);const locked=!cell || ['FORMULA','ERROR','BOOLEAN','DATE'].includes(cell.originalType)
      return <label key={address}>{label} <small>({address})</small><input value={values[address] ?? ''} disabled={busy||!!pending||!!success||locked} onChange={event=>setValues(current=>({...current,[address]:event.target.value}))}/>{locked && <small>수식 또는 지원하지 않는 셀</small>}</label>
    })}<button type="button" className="button" disabled={busy||!!pending||!!success} onClick={queueRow}>이 행의 수정값 담기</button></div>}
    <details><summary>코드DB에 새 SKU 추가</summary><p>코드DB에 실제로 없는 상품만 추가하세요. 분류와 코드, 상품명을 확인해야 합니다.</p>
      <div className="local-correction-fields"><label>SKU 분류<select disabled={busy||!!pending||!!success} value={newSku.category} onChange={event=>setNewSku(current=>({...current,category:event.target.value}))}>{['냉동용기','구성품',...LOCAL_APPROVED_SKU_CATEGORIES].map(category=><option key={category}>{category}</option>)}</select></label>
        <label>새 SKU 코드<input disabled={busy||!!pending||!!success} value={newSku.skuCode} onChange={event=>setNewSku(current=>({...current,skuCode:event.target.value.toUpperCase()}))}/></label>
        <label>새 SKU 상품명<input disabled={busy||!!pending||!!success} value={newSku.modelName} onChange={event=>setNewSku(current=>({...current,modelName:event.target.value}))}/></label>
        <label>새 SKU 옵션명<input disabled={busy||!!pending||!!success} value={newSku.color} onChange={event=>setNewSku(current=>({...current,color:event.target.value}))}/></label>
        <button type="button" className="button" disabled={busy||!!pending||!!success||!newSku.skuCode.trim()||!newSku.modelName.trim()} onClick={()=>{
          if(!/^[A-Z][A-Z0-9]{0,49}$/.test(newSku.skuCode) || newSkus.some(item=>item.skuCode===newSku.skuCode) || candidates.some(item=>item.kind==='SKU'&&item.normalizedValues.skuCode===newSku.skuCode)){setError('SKU 코드 형식 또는 중복 여부를 확인해 주세요.');return}
          if(newSku.modelName.includes('+') && ['냉동용기','구성품'].includes(newSku.category) && !LOCAL_APPROVED_BUNDLE_SKUS.some(code=>code===newSku.skuCode)){setError('이 묶음 코드의 SKU 인정 여부를 먼저 확인해 주세요.');return}
          setNewSkus(current=>[...current,newSku]);setNewSku(current=>({...current,skuCode:'',modelName:'',color:''}));setError(null)
        }}>새 SKU 담기</button></div></details>
    {(edits.length>0 || newSkus.length>0 || ignored.length>0) && <><h4>수정 예정 {edits.length}건 · 새 SKU {newSkus.length}건 · 제외 결정 {ignored.length}건</h4><ul>{edits.map(edit=><li key={`${edit.sheet}:${edit.address}`}>{edit.sheet} {edit.address}: {edit.before || '(빈 값)'} → {edit.after || '(빈 값)'}</li>)}{newSkus.map(sku=><li key={sku.skuCode}>새 SKU {sku.skuCode} · {sku.modelName} · {sku.category} <button type="button" disabled={busy||!!pending||!!success} onClick={()=>setNewSkus(current=>current.filter(item=>item.skuCode!==sku.skuCode))}>제거</button></li>)}{ignored.map(item=><li key={item.issueId}>제외: 단가표 {item.rows.join(', ')}행 · {item.message}</li>)}</ul>{(draftDirty||newSkuDirty||ignoreIssueId) && <p>현재 입력한 수정값, 새 SKU 또는 제외 사유를 먼저 담거나 취소해 주세요.</p>}<button type="button" className="button button-primary" disabled={busy||!!success||draftDirty||newSkuDirty||!!ignoreIssueId} onClick={()=>setConfirming(true)}>{busy?'재검증 중…':pending?'재검증 저장 다시 시도':'변경 내용 확인'}</button></>}
    {confirming && <Confirmation edits={edits} newSkus={newSkus} ignored={ignored} onCancel={()=>setConfirming(false)} onConfirm={()=>{setConfirming(false);void revalidate()}} />}
    {error && <p className="import-error" role="alert">{error}</p>}{success && <p role="status">{success}</p>}
  </section>
}
