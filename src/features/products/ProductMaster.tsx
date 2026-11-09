import { useCallback, useEffect, useMemo, useState } from 'react'
import { DataTable, EmptyState, FilterBar, PageHeader, Pagination, ProductThumb, SearchInput, SelectField, StatusBadge } from '../../components/ui'
import { formatMoney, getOfferDetails, getProductComponents, searchProducts } from '../../lib/selectors'
import type { EntityStatus, Product, SellerData } from '../../types/domain'
import { LocalUnlistedBundles } from './LocalCatalogExtensions'
import {ProductEditor,type ProductEditInput,type MasterPriceRow} from './ProductEditor'
import './product-master.css'

type PriceKey='cost'|'normal'|'regular'|'basic'|'medium'|'large'|'live'|'group'
type EventPriceKey='basic'|'medium'|'large'|'live'|'group'
type MissingFilter='ALL'|'ANY'|'CODE'|'CATEGORY'|'cost'|'normal'|'regular'|'event'
type PriceValues=Record<PriceKey,number|null>
type ProductPrices={productId:string;values:PriceValues|null;options:{name:string;values:PriceValues}[];manual?:boolean}
type SortKey = 'name' | 'code' | 'type' | 'sku' | 'cost' | 'normal' | 'regular' | 'event' | 'channels' | 'status'
const collator = new Intl.Collator('ko-KR', { numeric:true, sensitivity:'base' })
const typeLabel = { SINGLE:'단품', SET:'세트' } as const
const statusLabel = { ACTIVE:'판매중', INACTIVE:'판매중지', DRAFT:'초안' } as const

export function ProductMaster({ data,local=false,readOnly=true,onSaveProduct }: { data: SellerData;local?:boolean;readOnly?:boolean;onSaveProduct?:(input:ProductEditInput)=>Promise<void> }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | EntityStatus>('ALL')
  const [productType, setProductType] = useState<'ALL' | Product['productType']>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sort, setSort] = useState<{key:SortKey;direction:'ascending'|'descending'}|null>(null)
  const [eventPrice,setEventPrice]=useState<EventPriceKey>('basic')
  const [missing,setMissing]=useState<MissingFilter>('ALL')
  const [priceRows,setPriceRows]=useState<ProductPrices[]>([])
  const [priceError,setPriceError]=useState(false)
  const [priceSync,setPriceSync]=useState<{warning:boolean;skipped:number;updated:number}|null>(null)
  const [priceReady,setPriceReady]=useState(false)
  const [editor,setEditor]=useState<{product:Product|null}|null>(null)
  useEffect(()=>{
    if(!local)return
    const controller=new AbortController()
    void fetch('/api/product-prices',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('unavailable');return response.json() as Promise<{products:ProductPrices[];sourceUnavailable?:boolean;syncWarning?:boolean;syncSkipped?:number;syncUpdated?:number}>}).then(result=>{setPriceRows(result.products);setPriceError(Boolean(result.sourceUnavailable));setPriceSync(result.syncUpdated===undefined?null:{warning:Boolean(result.syncWarning),skipped:result.syncSkipped??0,updated:result.syncUpdated});setPriceReady(true)}).catch(()=>{if(!controller.signal.aborted){setPriceError(true);setPriceReady(false)}})
    return ()=>controller.abort()
  },[local])
  const prices=useMemo(()=>new Map(priceRows.map(item=>[item.productId,item])),[priceRows])
  const priceFor=useCallback((product:Product,key:PriceKey):number|null=>local?(prices.get(product.id)?.values?.[key]??null):(key==='normal'?product.normalPrice:null),[local,prices])
  const hasMissingPrice=useCallback((product:Product,key:PriceKey):boolean=>{
    const item=prices.get(product.id)
    if(local&&item?.options.length)return item.options.some(option=>option.values[key]===null)
    return priceFor(product,key)===null
  },[local,prices,priceFor])

  const products = useMemo(() => {
    const filtered = searchProducts(data, query).filter((product) =>
    (status === 'ALL' || product.status === status) &&
    (productType === 'ALL' || product.productType === productType) &&
    (missing==='ALL' || (missing==='CODE' ? !product.sabangnetCode.trim() : missing==='CATEGORY' ? !product.category?.trim() : missing==='ANY' ? !product.sabangnetCode.trim() || !product.category?.trim() || (local && (['cost','normal','regular',eventPrice] as PriceKey[]).some(key=>hasMissingPrice(product,key))) : hasMissingPrice(product,missing==='event'?eventPrice:missing))),
    )
    if (!sort) return [...filtered].sort((a,b)=>Number(Boolean(a.sabangnetCode))-Number(Boolean(b.sabangnetCode)))
    const value = (product:Product):string|number|null => {
      switch(sort.key) {
        case 'name': return product.productName
        case 'code': return product.sabangnetCode
        case 'type': return typeLabel[product.productType]
        case 'sku': return getProductComponents(data,product.id).map(({sku})=>sku.modelName).join(', ')
        case 'cost': return priceFor(product,'cost')
        case 'normal': return priceFor(product,'normal')
        case 'regular': return priceFor(product,'regular')
        case 'event': return priceFor(product,eventPrice)
        case 'channels': return new Set(getOfferDetails(data,product.id).map(({channel})=>channel.id)).size
        case 'status': return statusLabel[product.status]
      }
    }
    const values=new Map(filtered.map(product=>[product.id,value(product)]))
    return [...filtered].sort((a,b)=>{
      const left=values.get(a.id)??null;const right=values.get(b.id)??null
      if(left===null)return right===null?0:1
      if(right===null)return -1
      const result=typeof left==='number'&&typeof right==='number'?left-right:collator.compare(String(left),String(right))
      return sort.direction==='ascending'?result:-result
    })
  }, [data, productType, query, status, sort, priceFor, eventPrice, missing, local, hasMissingPrice])

  const lastPage = Math.max(1, Math.ceil(products.length / pageSize))
  const currentPage = Math.min(page, lastPage)
  const visibleProducts = products.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const heading=(key:SortKey,label:string,align?:string)=><th className={align} aria-sort={sort?.key===key?sort.direction:undefined}><button className="product-sort" type="button" aria-label={`${label} 정렬`} onClick={()=>{setSort(current=>({key,direction:current?.key===key&&current.direction==='ascending'?'descending':'ascending'}));setPage(1)}}><span>{label}</span><span className="product-sort-arrows" aria-hidden="true"><span className={sort?.key===key&&sort.direction==='ascending'?'active':''}>▲</span><span className={sort?.key===key&&sort.direction==='descending'?'active':''}>▼</span></span></button></th>
  const priceCell=(product:Product,key:PriceKey)=>{
    const item=prices.get(product.id)
    if(local&&item?.options.length)return <details className="product-option-prices"><summary>옵션별</summary><ul>{item.options.map(option=><li key={option.name}><span>{option.name}</span><strong>{formatMoney(option.values[key])}</strong></li>)}</ul></details>
    const value=priceFor(product,key)
    return <span title={local&&!item?'원본 상품과 일치하는 가격을 확인하지 못했습니다.':undefined}>{value===null?'미입력':formatMoney(value)}</span>
  }

  return <>
    <PageHeader title="판매상품 마스터" description="판매상품과 구성 SKU, 채널 연결 상태를 관리합니다." actions={local&&!readOnly&&onSaveProduct?<button type="button" className="button button-primary" onClick={()=>setEditor({product:null})}>상품 추가</button>:undefined} />
    <section className="panel product-master-panel">
      <FilterBar>
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="사방넷 품번, 상품명, SKU, 채널 상품으로 검색" label="판매상품 검색" />
        <SelectField value={status} onChange={(value) => { setStatus(value as typeof status); setPage(1) }} label="판매상품 상태" options={[
          { value: 'ALL', label: '상태 전체' }, { value: 'ACTIVE', label: '판매중' },
          { value: 'INACTIVE', label: '판매중지' }, { value: 'DRAFT', label: '초안' },
        ]} />
        <SelectField value={productType} onChange={(value) => { setProductType(value as typeof productType); setPage(1) }} label="상품 구분" options={[
          { value: 'ALL', label: '상품구분 전체' }, { value: 'SINGLE', label: '단품' }, { value: 'SET', label: '세트' },
        ]} />
        <SelectField value={missing} onChange={(value)=>{setMissing(value as MissingFilter);setPage(1)}} label="미입력 항목" options={[
          {value:'ALL',label:'입력 상태 전체'}, {value:'ANY',label:'미입력 전체'}, {value:'CODE',label:'사방넷 품번 미입력'}, {value:'CATEGORY',label:'카테고리 미입력'},
          ...(local?[{value:'cost',label:'총원가 미입력'},{value:'normal',label:'정상가 미입력'},{value:'regular',label:'상시가 미입력'},{value:'event',label:'선택한 행사가 미입력'}]:[]),
        ]} />
        <label className="product-event-selector"><span>행사가</span><select value={eventPrice} onChange={event=>{setEventPrice(event.target.value as EventPriceKey);setPage(1)}}><option value="basic">기본행사가</option><option value="medium">중형행사가</option><option value="large">대형행사가</option><option value="live">원데이/라이브</option><option value="group">공구가</option></select></label>
        {(query || status !== 'ALL' || productType !== 'ALL' || missing !== 'ALL') && <button className="button button-small" type="button" onClick={() => { setQuery(''); setStatus('ALL'); setProductType('ALL'); setMissing('ALL'); setPage(1) }}>필터 초기화</button>}
      </FilterBar>
      {local&&priceError&&<p className="product-price-note" role="alert">원본 가격을 불러오지 못했습니다. 직접 입력한 가격은 표시됩니다.</p>}
      {local&&priceSync&&<p className="product-price-note" role={priceSync.warning?'alert':undefined}>{priceSync.warning?'마스터파일을 확인하지 못해 마지막으로 확인된 가격을 표시합니다.':`마스터파일 가격 반영: ${priceSync.updated}개 상품.`} {priceSync.skipped>0&&`품번·상품명·구성이 달라 확인이 필요한 원본 품번 ${priceSync.skipped}개는 자동 반영하지 않았습니다.`} 직접 입력한 가격은 유지됩니다.</p>}
      {missing==='ANY'&&local&&<p className="product-price-note">미입력 전체는 품번, 카테고리, 총원가, 정상가, 상시가와 현재 선택한 행사가를 확인합니다. 모음전은 한 옵션이라도 미입력이면 표시합니다.</p>}
      {visibleProducts.length > 0 ? <>
        <DataTable minWidth={1350}>
          <thead><tr>{heading('name','판매상품')}{heading('code','사방넷 품번')}{heading('type','상품 구분')}{heading('sku','구성 SKU')}{heading('cost','총원가','align-right')}{heading('normal','정상가','align-right')}{heading('regular','상시가','align-right')}{heading('event','행사가','align-right')}{heading('channels','연결 채널','align-center')}{heading('status','상태')}{local&&!readOnly&&onSaveProduct&&<th>관리</th>}</tr></thead>
          <tbody>{visibleProducts.map((product) => {
            const components = getProductComponents(data, product.id)
            const channelCount = new Set(getOfferDetails(data, product.id).map((detail) => detail.channel.id)).size
            return <tr key={product.id}>
              <td><a className="product-cell text-link" href={`#/products/${product.id}`}><ProductThumb productId={product.id} name={product.productName} /><span><strong>{product.productName}</strong><small>{product.category ?? '카테고리 미지정'}</small></span></a></td>
              <td><a className="text-link mono" href={`#/products/${product.id}`}>{product.sabangnetCode || '미입력'}</a></td>
              <td><StatusBadge status={product.productType} /></td>
              <td>{components.length > 0 ? <span>{components.map(({ component, sku }) => `${sku.modelName} ${component.quantity}개`).join(', ')}</span> : <span className="muted">구성 미등록</span>}</td>
              <td className="align-right mono">{priceCell(product,'cost')}</td>
              <td className="align-right mono">{priceCell(product,'normal')}</td>
              <td className="align-right mono">{priceCell(product,'regular')}</td>
              <td className="align-right mono">{priceCell(product,eventPrice)}</td>
              <td className="align-center"><span className="stat-chip">{channelCount} / {data.channels.length}</span></td>
              <td><StatusBadge status={product.status} /></td>
              {local&&!readOnly&&onSaveProduct&&<td><button type="button" className="button button-small" disabled={!priceReady||(priceError&&!prices.get(product.id)?.manual)} title={!priceReady||priceError&&!prices.get(product.id)?.manual?'가격 정보를 먼저 불러와야 합니다.':undefined} onClick={()=>setEditor({product})}>수정</button></td>}
            </tr>
          })}</tbody>
        </DataTable>
        <Pagination page={currentPage} total={products.length} pageSize={pageSize} onChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1)}} />
      </> : <EmptyState title={query || status !== 'ALL' || productType !== 'ALL' || missing !== 'ALL' ? '조건에 맞는 판매상품이 없습니다.' : '등록된 판매상품이 없습니다.'} description={query ? '다른 품번, 상품명 또는 SKU로 검색해 보세요.' : '필터 조건을 바꾸거나 데이터를 확인해 주세요.'} action={(query || status !== 'ALL' || productType !== 'ALL' || missing !== 'ALL') ? <button className="button" type="button" onClick={() => { setQuery(''); setStatus('ALL'); setProductType('ALL'); setMissing('ALL'); setPage(1) }}>전체 상품 보기</button> : undefined} />}
    </section>
    <LocalUnlistedBundles enabled={local} />
    {editor&&onSaveProduct&&<ProductEditor data={data} product={editor.product} price={editor.product?prices.get(editor.product.id) as MasterPriceRow|undefined:undefined} onClose={()=>setEditor(null)} onSave={async input=>{await onSaveProduct(input);void fetch('/api/product-prices',{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('unavailable');return r.json() as Promise<{products:ProductPrices[];sourceUnavailable?:boolean}>}).then(result=>{setPriceRows(result.products);setPriceError(Boolean(result.sourceUnavailable));setPriceReady(true)}).catch(()=>{setPriceError(true);setPriceReady(false)})}} />}
  </>
}
