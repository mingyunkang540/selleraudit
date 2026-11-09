import {useState} from 'react'

type Plan={fingerprint:string;listings:number;mapped:number;unmatchedSingles:number;optionsNeedReview:number;sourceModifiedAt:string}
type Result={listings:number;offers:number;mapped:number;unmatchedSingles:number;optionsNeedReview:number}
export function OwnedStoreImport({onApplied}:{onApplied?:()=>void}){
 const [busy,setBusy]=useState(false),[result,setResult]=useState<Result|null>(null),[error,setError]=useState('')
 async function run(){
  setBusy(true);setError('')
  try{
   const sessionResponse=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(!sessionResponse.ok)throw new Error('관리자 로그인 상태를 확인해 주세요.')
   const session=await sessionResponse.json() as {csrf:string;user:{role:string}};if(session.user.role!=='ADMIN')throw new Error('관리자 권한이 필요합니다.')
   const planResponse=await fetch('/api/import/owned-store/plan',{credentials:'same-origin',cache:'no-store'});if(!planResponse.ok)throw new Error('자사몰 자료를 확인하지 못했습니다. 이미 등록됐거나 자료가 변경됐는지 확인해 주세요.')
   const plan=await planResponse.json() as Plan
   const response=await fetch('/api/import/owned-store/apply',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({confirmed:true,fingerprint:plan.fingerprint})})
   if(!response.ok)throw new Error('등록하지 못했습니다. 중복 등록이나 변경된 자료를 확인해 주세요. 다시 누르기 전 등록 상태를 확인해 주세요.')
   setResult(await response.json() as Result);onApplied?.()
  }catch(cause){setError(cause instanceof Error?cause.message:'등록하지 못했습니다.')}
  finally{setBusy(false)}
 }
 return <section className="panel" style={{padding:20,marginBottom:16}}><div className="section-heading"><div><h2>자사몰 상품 불러오기</h2><p>준비된 자사몰 상품목록을 불러오고 확인된 단품만 상품 마스터에 연결합니다. 옵션별 상세가 필요한 상품은 검수 대상으로 남깁니다.</p><p>상품목록 기준: 2026년 11월 2일 · 실시간 연동 아님</p></div><button type="button" className="button button-primary" onClick={()=>void run()} disabled={busy||!!result}>{busy?'등록 중…':result?'등록 완료':'자사몰 상품 등록'}</button></div>{result&&<p role="status">상품 {result.listings}건 등록 · 단품 {result.offers}건 중 {result.mapped}건 연결 · 단품 미연결 {result.unmatchedSingles}건 · 옵션 확인 {result.optionsNeedReview}건</p>}{error&&<p role="alert">{error}</p>}</section>
}
