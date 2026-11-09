import { useEffect,useState } from 'react'
import { DataTable } from '../../components/ui'

type Component={sku:string;quantity:number}
type Extensions={
  bundles:({id:string;name:string;category:string|null}&Component)[]
  options:({productId:string;name:string}&Component)[]
  variants:({productId:string;channel:string}&Component)[]
  assemblies:({assembly:string}&Component)[]
}
function useExtensions(enabled:boolean){
  const [data,setData]=useState<Extensions|null>(null);const [error,setError]=useState(false)
  useEffect(()=>{if(!enabled)return;const controller=new AbortController()
    void fetch('/api/catalog-extensions',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('unavailable');return response.json() as Promise<Extensions>}).then(setData).catch(()=>{if(!controller.signal.aborted)setError(true)})
    return ()=>controller.abort()
  },[enabled])
  return {data,error}
}
export function LocalUnlistedBundles({enabled}:{enabled:boolean}){
  const {data,error}=useExtensions(enabled)
  if(!enabled)return null
  if(error)return <section className="panel" role="alert">미등록 세트 정보를 불러오지 못했습니다.</section>
  if(!data?.bundles.length)return null
  const groups=new Map<string,{name:string;category:string|null;components:Component[]}>()
  for(const item of data.bundles){const group=groups.get(item.id)??{name:item.name,category:item.category,components:[]};group.components.push(item);groups.set(item.id,group)}
  return <section className="panel"><h2 className="section-heading">사방넷 미등록 세트</h2><p className="muted">사방넷 품번 없이 내부 구성만 관리합니다.</p><DataTable minWidth={640}><thead><tr><th>세트명</th><th>카테고리</th><th>구성 SKU</th></tr></thead><tbody>{[...groups].map(([id,item])=><tr key={id}><td>{item.name}</td><td>{item.category??'-'}</td><td>{item.components.map(c=>`${c.sku} × ${c.quantity}`).join(', ')}</td></tr>)}</tbody></DataTable></section>
}
export function LocalProductComposition({enabled,productId,skuCodes}:{enabled:boolean;productId:string;skuCodes:string[]}){
  const {data,error}=useExtensions(enabled)
  if(!enabled)return null
  if(error)return <section className="panel" role="alert">추가 구성 정보를 불러오지 못했습니다.</section>
  if(!data)return null
  const options=data.options.filter(x=>x.productId===productId);const variants=data.variants.filter(x=>x.productId===productId);const assemblies=data.assemblies.filter(x=>skuCodes.includes(x.assembly))
  if(!options.length&&!variants.length&&!assemblies.length)return null
  return <section className="panel"><h2 className="section-heading">추가 구성 정보</h2>
    {options.length>0&&<><h3>모음전 옵션</h3><ul>{options.map(x=><li key={`${x.name}-${x.sku}`}>{x.name}: {x.sku} × {x.quantity}</li>)}</ul></>}
    {variants.length>0&&<><h3>원본 채널별 구성</h3><p className="muted">원본에 표시된 채널 정보입니다. 채널 상품 연동 여부와는 별개입니다.</p><ul>{variants.map(x=><li key={`${x.channel}-${x.sku}`}>{x.channel}: {x.sku} × {x.quantity}</li>)}</ul></>}
    {assemblies.length>0&&<><h3>묶음 SKU의 실물 구성</h3><ul>{assemblies.map(x=><li key={`${x.assembly}-${x.sku}`}>{x.assembly}: {x.sku} × {x.quantity}</li>)}</ul></>}
  </section>
}
