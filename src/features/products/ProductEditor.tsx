import {useState} from 'react'
import {Drawer} from '../../components/ui'
import type {Product,SellerData} from '../../types/domain'

const labels={cost:'총원가',normal:'정상가',regular:'상시가',basic:'기본 행사가',medium:'중형 행사가',large:'대형 행사가',live:'원데이/라이브 행사가',group:'공구가'} as const
type PriceKey=keyof typeof labels
export type MasterPriceValues=Record<PriceKey,number|null>
export type ProductEditInput={id?:string;expectedUpdatedAt?:string;sabangnetCode:string;productName:string;category:string|null;productType:'SINGLE'|'SET';status:'ACTIVE'|'INACTIVE'|'DRAFT';prices:MasterPriceValues|null;components:{skuId:string;quantity:number}[]}
export type MasterPriceRow={productId:string;values:MasterPriceValues|null;options:{name:string;values:MasterPriceValues}[]}
export function ProductEditor({data,product,price,onClose,onSave}:{data:SellerData;product:Product|null;price?:MasterPriceRow;onClose:()=>void;onSave:(input:ProductEditInput)=>Promise<void>}){
 const [code,setCode]=useState(product?.sabangnetCode??''),[name,setName]=useState(product?.productName??''),[category,setCategory]=useState(product?.category??''),[type,setType]=useState<'SINGLE'|'SET'>(product?.productType??'SINGLE'),[status,setStatus]=useState<'ACTIVE'|'INACTIVE'|'DRAFT'>(product?.status??'ACTIVE')
 const [components,setComponents]=useState(()=>data.components.filter(c=>c.productId===product?.id).map(c=>({skuId:c.skuId,quantity:String(c.quantity)})))
 const [prices,setPrices]=useState(()=>Object.fromEntries((Object.keys(labels) as PriceKey[]).map(k=>[k,price?.values?.[k]===null||price?.values?.[k]===undefined?'':String(price.values[k])])) as Record<PriceKey,string>)
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const optionPrices=Boolean(price?.options.length),linked=product?data.offers.filter(o=>o.masterProductId===product.id).length:0
 async function save(){
  const values=Object.fromEntries((Object.keys(labels) as PriceKey[]).map(k=>[k,prices[k].trim()===''?null:Number(prices[k])])) as MasterPriceValues
  if(!name.trim()){setError('판매상품명을 입력해 주세요.');return}
  if(!components.length){setError('SKU 추가를 눌러 구성 상품을 선택해 주세요.');return}
  if(components.some(c=>!c.skuId)){setError('추가한 구성의 SKU를 선택해 주세요.');return}
  if(components.some(c=>!/^\d+$/.test(c.quantity)||Number(c.quantity)<1)){setError('구성 수량은 1 이상의 정수로 입력해 주세요.');return}
  if(new Set(components.map(c=>c.skuId)).size!==components.length){setError('같은 SKU가 중복되었습니다. 한 줄로 합쳐 수량을 입력해 주세요.');return}
  if(Object.values(values).some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0))){setError('가격은 0 이상의 정수로 입력해 주세요.');return}
  setBusy(true);setError('')
  try{await onSave({id:product?.id,expectedUpdatedAt:product?.updatedAt,sabangnetCode:code.trim(),productName:name.trim(),category:category.trim()||null,productType:type,status,prices:optionPrices?null:values,components:components.map(c=>({skuId:c.skuId,quantity:Number(c.quantity)}))});onClose()}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false)}
 }
 return <Drawer title={product?'상품 마스터 수정':'상품 마스터 추가'} subtitle="상품명과 구성 SKU는 필수입니다. 나머지 정보는 나중에 입력할 수 있습니다." onClose={()=>!busy&&onClose()}><div className="product-editor">
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {linked>0&&<p className="notice">이 상품에 연결된 채널 옵션 {linked}개가 있습니다. 품번이나 구성을 변경하면 연결 상품과 가격을 다시 확인해 주세요. 별도로 등록한 구성 옵션은 자동으로 변경되지 않습니다.</p>}
  <div className="product-editor-grid"><label>사방넷 품번 (선택) <input value={code} maxLength={100} onChange={e=>setCode(e.target.value)} /></label><label>판매상품명 <input value={name} maxLength={200} onChange={e=>setName(e.target.value)} /></label><label>카테고리 (선택) <input value={category} maxLength={100} onChange={e=>setCategory(e.target.value)} /></label><label>상품 구분 <select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="SINGLE">단품</option><option value="SET">세트</option></select></label><label>상태 <select value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="ACTIVE">판매중</option><option value="INACTIVE">판매중지</option><option value="DRAFT">초안</option></select></label></div>
  <h3>구성 SKU</h3>{components.map((c,index)=><div className="configuration-component" key={index}><label><span className="sr-only">SKU {index+1}</span><select value={c.skuId} onChange={e=>setComponents(current=>current.map((x,i)=>i===index?{...x,skuId:e.target.value}:x))}><option value="">SKU 선택</option>{data.skus.filter(s=>s.status==='ACTIVE'||components.some(c=>c.skuId===s.id)).map(s=><option key={s.id} value={s.id}>{s.skuCode} · {s.modelName}{s.color?` (${s.color})`:''}{s.status!=='ACTIVE'?' · 판매중지':''}</option>)}</select></label><label>수량 <input aria-label={`SKU ${index+1} 수량`} type="number" min="1" value={c.quantity} onChange={e=>setComponents(current=>current.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/></label><button type="button" className="button button-small" aria-label={`SKU ${index+1} 삭제`} onClick={()=>setComponents(current=>current.filter((_,i)=>i!==index))}>삭제</button></div>)}<button type="button" className="button button-small" onClick={()=>setComponents(current=>[...current,{skuId:'',quantity:'1'}])}>SKU 추가</button>
  <h3>가격</h3>{optionPrices?<p className="notice">이 상품은 모음전 옵션별 가격을 사용하므로 여기서는 가격을 변경하지 않습니다.</p>:<><p className="muted">확인되지 않은 가격은 비워 두세요.</p><div className="configuration-prices">{(Object.keys(labels) as PriceKey[]).map(k=><label key={k}>{labels[k]} <input type="number" min="0" step="1" value={prices[k]} onChange={e=>setPrices({...prices,[k]:e.target.value})} placeholder="미입력" /></label>)}</div></>}
  <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="button button-primary" disabled={busy} onClick={()=>void save()}>{busy?'저장 중…':'상품 저장'}</button></div>
 </div></Drawer>
}
