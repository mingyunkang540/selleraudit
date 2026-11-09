import {useState} from 'react'
import type {Product,SellerData} from '../../types/domain'
import {formatMoney} from '../../lib/selectors'
import {configurationPriceLabels,type ConfigurationPriceKey,type ConfigurationPrices,type ProductConfiguration} from './configurationTypes'

const keys=Object.keys(configurationPriceLabels) as ConfigurationPriceKey[]
type Draft={id?:string;name:string;prices:Record<ConfigurationPriceKey,string>;components:{skuId:string;quantity:string}[]}
type SaveInput={id?:string;productId:string;name:string;prices:ConfigurationPrices;components:{skuId:string;quantity:number}[]}
export function ProductConfigurations({data,product,configurations,readOnly,onSave}:{data:SellerData;product:Product;configurations:ProductConfiguration[];readOnly:boolean;onSave:(input:SaveInput)=>Promise<void>}){
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const emptyPrices=()=>Object.fromEntries(keys.map(key=>[key,''])) as Draft['prices']
 function create(){setError('');setDraft({name:'',prices:emptyPrices(),components:data.components.filter(c=>c.productId===product.id).map(c=>({skuId:c.skuId,quantity:String(c.quantity)}))})}
 function edit(c:ProductConfiguration){setError('');setDraft({id:c.id,name:c.name,prices:Object.fromEntries(keys.map(k=>[k,c.prices[k]===null?'':String(c.prices[k])])) as Draft['prices'],components:c.components.map(x=>({skuId:x.skuId,quantity:String(x.quantity)}))})}
 async function save(){
  if(!draft)return
  const prices=Object.fromEntries(keys.map(k=>[k,draft.prices[k].trim()===''?null:Number(draft.prices[k])])) as ConfigurationPrices
  if(!draft.name.trim()||!draft.components.length||draft.components.some(c=>!c.skuId||!/^\d+$/.test(c.quantity)||Number(c.quantity)<1)||new Set(draft.components.map(c=>c.skuId)).size!==draft.components.length||keys.some(k=>prices[k]!==null&&(!Number.isSafeInteger(prices[k])||Number(prices[k])<0))){setError('옵션 이름, 중복 없는 SKU와 수량, 가격을 확인해 주세요.');return}
  setBusy(true);setError('')
  try{await onSave({id:draft.id,productId:product.id,name:draft.name.trim(),prices,components:draft.components.map(c=>({skuId:c.skuId,quantity:Number(c.quantity)}))});setDraft(null)}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false)}
 }
 return <section className="panel"><div className="section-heading"><div><h2>상품 구성 옵션</h2><p className="muted">사방넷 품번은 유지하면서 구성과 가격을 옵션별로 관리합니다. 모르는 가격은 비워 두세요.</p></div>{!readOnly&&!draft&&<button type="button" className="button" onClick={create}>구성 옵션 추가</button>}</div>
  {configurations.length===0?<p className="muted">등록된 구성 옵션이 없습니다.</p>:<div className="drawer-stack">{configurations.map(c=><article className="offer-card" key={c.id}><div className="offer-card-heading"><strong>{c.name}</strong>{!readOnly&&<button className="button button-small" type="button" onClick={()=>edit(c)}>수정</button>}</div><p>{c.components.map(part=>`${data.skus.find(s=>s.id===part.skuId)?.skuCode??'확인 필요'} × ${part.quantity}`).join(', ')}</p><p className="muted">정상가 {formatMoney(c.prices.normal)} · 원데이/라이브 {formatMoney(c.prices.live)}</p></article>)}</div>}
  {draft&&<div className="offer-card"><h3>{draft.id?'구성 옵션 수정':'구성 옵션 추가'}</h3>{error&&<p className="error-banner" role="alert">{error}</p>}<label>옵션 이름 <input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} /></label><h4>구성 SKU</h4>{draft.components.map((c,index)=><div key={index} className="configuration-component"><label><span className="sr-only">SKU {index+1}</span><select value={c.skuId} onChange={e=>setDraft({...draft,components:draft.components.map((row,i)=>i===index?{...row,skuId:e.target.value}:row)})}><option value="">SKU 선택</option>{data.skus.filter(s=>s.status==='ACTIVE').map(s=><option key={s.id} value={s.id}>{s.skuCode} · {s.modelName}{s.color?` (${s.color})`:''}</option>)}</select></label><label>수량 <input type="number" min="1" value={c.quantity} onChange={e=>setDraft({...draft,components:draft.components.map((row,i)=>i===index?{...row,quantity:e.target.value}:row)})} /></label><button type="button" className="button button-small" onClick={()=>setDraft({...draft,components:draft.components.filter((_,i)=>i!==index)})}>삭제</button></div>)}<button type="button" className="button button-small" onClick={()=>setDraft({...draft,components:[...draft.components,{skuId:'',quantity:'1'}]})}>SKU 추가</button><h4>옵션별 가격</h4><div className="configuration-prices">{keys.map(key=><label key={key}>{configurationPriceLabels[key]} <input type="number" min="0" step="1" value={draft.prices[key]} onChange={e=>setDraft({...draft,prices:{...draft.prices,[key]:e.target.value}})} placeholder="확인 필요" /></label>)}</div><div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={()=>setDraft(null)}>취소</button><button type="button" className="button button-primary" disabled={busy} onClick={()=>void save()}>{busy?'저장 중…':'확정'}</button></div></div>}
 </section>
}
