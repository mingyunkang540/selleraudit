import { useEffect,useRef,useState } from 'react'
import type { ImportPersistence,LocalInitialPlan,LocalInitialResult } from '../../services/importPersistence'

export function LocalInitialApply({batchId,persistence,onMasterApplied}:{batchId:string;persistence:ImportPersistence;onMasterApplied?:()=>void}) {
  const [plan,setPlan]=useState<LocalInitialPlan|null>(null)
  const [result,setResult]=useState<LocalInitialResult|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [confirm,setConfirm]=useState(false)
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(()=>{if(confirm)dialog.current?.showModal()},[confirm])
  const load=async()=>{
    if(!persistence.previewLocalInitial)return
    setBusy(true);setError('');setPlan(null)
    try{setPlan(await persistence.previewLocalInitial(batchId))}catch{setError('등록 계획을 만들지 못했습니다. 현재 기준으로 다시 검증한 기록인지 확인해 주세요.')}
    finally{setBusy(false)}
  }
  const apply=async()=>{
    if(!plan||!persistence.applyLocalInitial)return
    setBusy(true);setError('')
    try{setResult(await persistence.applyLocalInitial(batchId,plan.fingerprint));setConfirm(false);onMasterApplied?.()}catch{setConfirm(false);setPlan(null);setError('등록하지 못했습니다. 원본이나 데이터가 바뀌었을 수 있습니다. 등록 계획을 다시 확인해 주세요.')}
    finally{setBusy(false)}
  }
  return <section className="import-review-section" aria-label="가능한 상품 등록">
    <h3>가능한 상품 등록</h3><p>원본을 서버에서 다시 분석합니다. 상품과 구성품을 함께 등록하며, 확인이 필요한 상품은 제외합니다. 기존 정보를 덮어쓰지 않습니다.</p>
    {!result && <button type="button" className="button" disabled={busy} onClick={()=>void load()}>{busy?'확인 중…':'등록 계획 확인'}</button>}
    {error && <p className="import-error" role="alert">{error}</p>}
    {plan && !result && <><p>등록 대상 상품 {plan.products.length}행 · 필요한 SKU {plan.skuCount}개 · 제외 {plan.excluded.length}행</p>
      <p>모음전, 채널별 상품, AL502·AL510 묶음 구성과 기존 정보가 다른 상품은 이번 등록에서 제외합니다.</p>
      <details><summary>등록 대상과 구성 보기</summary><ul>{plan.products.map(item=><li key={item.row}>{item.row}행 · {item.code} · {item.name} · {item.components.map(component=>`${component.sku} ${component.quantity}개`).join(', ')}</li>)}</ul></details>
      <details><summary>제외 대상과 사유 보기</summary><ul>{plan.excluded.map(item=><li key={item.row}>{item.row}행 · {item.name??'(상품명 없음)'} · {item.reasons.join(' / ')}</li>)}</ul></details>
      <button type="button" className="button button-primary" disabled={busy||!plan.products.length} onClick={()=>setConfirm(true)}>확인한 상품 등록</button></>}
    {confirm && plan && <dialog ref={dialog} className="confirm-dialog" onCancel={event=>{event.preventDefault();if(!busy)setConfirm(false)}}><h3>확인한 상품 등록</h3><p>상품 {plan.products.length}행을 검토하여 등록하고, {plan.excluded.length}행은 제외합니다. 기존 상품과 SKU는 덮어쓰지 않습니다.</p><button type="button" className="button" disabled={busy} onClick={()=>setConfirm(false)}>취소</button> <button type="button" className="button button-primary" disabled={busy} onClick={()=>void apply()}>{busy?'등록 중…':'등록 확정'}</button></dialog>}
    {result && <><p role="status">등록 완료: 신규 상품 {result.productsCreated}개 · 신규 SKU {result.skusCreated}개 · 신규 구성 {result.componentsCreated}개 · 제외 {result.excluded.length}행</p><a href="#/products" className="button button-primary">등록된 상품 보기</a></>}
  </section>
}
