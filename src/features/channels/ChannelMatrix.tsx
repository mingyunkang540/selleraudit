import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChannelBadge, ConfirmDialog, DataTable, Drawer, EmptyState, FilterBar, PageHeader, ProductThumb, SearchInput, SelectField, StatusBadge } from '../../components/ui'
import { formatDate, formatMoney, getOfferDetails, getProductComponents, searchProducts } from '../../lib/selectors'
import type { CellStatus, Channel, Product, SellerData } from '../../types/domain'
import { priceStatus } from './priceStatus'
import {matrixStatus,type MatrixProductPrice} from './matrixStatus'
import {ChannelCoupons} from './ChannelCoupons'
import {ChannelFees} from './ChannelFeePanel'
import {ChannelProductExport} from './ChannelProductExport'
import {calculateChannelFee,type ChannelFee} from './channelFees'
import {applyCoupon,companyCouponCost,koreaDate,type Coupon} from './coupons'
import {expectedMargin} from './margin'
import {channelPromotionStatus,optionPromotionStatus,promotionLabel} from './promotionStatus'
import type {ConfigurationData,ProductConfiguration} from '../products/configurationTypes'
import './operations.css'

const statusOptions = [
  { value: 'ALL', label: '상태 전체' },
  { value: 'NORMAL', label: '정상' },
  { value: 'MISSING', label: '미등록' },
  { value: 'PRICE_MISMATCH', label: '가격 이상' },
  { value: 'REVIEW', label: '확인 필요' },
  { value: 'REGULAR', label: '상시' },
  { value: 'PROMOTION', label: '행사중' },
]

interface SelectedCell { product: Product; channel: Channel }

type EventPriceKey='basic'|'medium'|'large'|'live'|'group'
type ProductPrice = MatrixProductPrice
const eventPriceOptions:{value:EventPriceKey;label:string}[]=[{value:'basic',label:'기본 행사가'},{value:'medium',label:'중형 행사가'},{value:'large',label:'대형 행사가'},{value:'live',label:'원데이/라이브'},{value:'group',label:'공구가'}]
function showMasterPrice(price:ProductPrice|undefined,key:'regular'|EventPriceKey){
  if(!price?.options.length)return formatMoney(price?.values?.[key]??null)
  const values=price.options.map(option=>option.values[key]);if(values.some(value=>value===null))return '옵션별 확인 필요'
  const amounts=values as number[],min=Math.min(...amounts),max=Math.max(...amounts)
  return min===max?formatMoney(min):`${formatMoney(min)} ~ ${formatMoney(max)}`
}
export function ChannelMatrix({ data, local=false,configurationData=null,configurationError=false,onBindConfiguration,onUnmap }: { data: SellerData; local?:boolean;configurationData?:ConfigurationData|null;configurationError?:boolean;onBindConfiguration?: (offerId:string,configurationId:string)=>Promise<void>; onUnmap?: (offerId:string,productId:string)=>Promise<void> }) {
  const [priceRows,setPriceRows]=useState<ProductPrice[]|null>(null)
  const [priceError,setPriceError]=useState(false)
  const [couponData,setCouponData]=useState<{coupons:Coupon[];revision:string}|null>(null)
  const [couponError,setCouponError]=useState(false)
  const [feeData,setFeeData]=useState<{fees:ChannelFee[];revision:string}|null>(null)
  const [feeError,setFeeError]=useState(false)
  const [now,setNow]=useState(()=>new Date())
  const refreshCoupons=useCallback(async()=>{const response=await fetch('/api/channel-coupons',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('unavailable');setCouponData(await response.json() as {coupons:Coupon[];revision:string});setCouponError(false)},[])
  const refreshFees=useCallback(async()=>{const response=await fetch('/api/channel-fees',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('unavailable');setFeeData(await response.json() as {fees:ChannelFee[];revision:string});setFeeError(false)},[])
  useEffect(()=>{if(!local)return;void Promise.resolve().then(refreshCoupons).catch(()=>setCouponError(true));const timer=window.setInterval(()=>setNow(new Date()),60000);return ()=>window.clearInterval(timer)},[local,refreshCoupons])
  useEffect(()=>{if(local)void Promise.resolve().then(refreshFees).catch(()=>setFeeError(true))},[local,refreshFees])
  useEffect(()=>{ if(!local)return; const controller=new AbortController(); void fetch('/api/product-prices',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('unavailable');return r.json() as Promise<{products:ProductPrice[];sourceUnavailable?:boolean}>}).then(r=>{setPriceRows(r.products);setPriceError(Boolean(r.sourceUnavailable))}).catch(()=>{if(!controller.signal.aborted){setPriceRows([]);setPriceError(true)}});return ()=>controller.abort() },[local])
  const prices=useMemo(()=>new Map((priceRows??[]).map(row=>[row.productId,row])),[priceRows])
  const statusFor=useCallback((product:Product,channel:Channel):CellStatus=>matrixStatus(data,product,channel,local,prices,configurationData),[data,local,prices,configurationData])
  const promotionFor=useCallback((product:Product,channel:Channel)=>{const coupon=couponData?.coupons.filter(c=>c.channelId===channel.id&&koreaDate(now)>=c.startDate&&koreaDate(now)<=c.endDate);return channelPromotionStatus(getOfferDetails(data,product.id).filter(d=>d.channel.id===channel.id),product.id,prices.get(product.id),configurationError?null:configurationData,couponData!==null&&!couponError,coupon,now)},[data,prices,configurationData,configurationError,couponData,couponError,now])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [eventPrice,setEventPrice]=useState<EventPriceKey>('basic')
  const [hiddenChannelIds,setHiddenChannelIds]=useState<string[]>([])
  const visibleChannels=useMemo(()=>data.channels.filter(channel=>!hiddenChannelIds.includes(channel.id)),[data.channels,hiddenChannelIds])
  const [selected, setSelected] = useState<SelectedCell | null>(null)
  const naverSync=data.listings.filter(listing=>data.channels.some(channel=>channel.id===listing.channelId&&channel.channelCode==='NAVER')&&listing.lastSyncedAt).map(listing=>listing.lastSyncedAt!).sort().at(-1)
  const noOptions=useMemo(()=>{
    if(data.listingIdsWithoutOffers){const trulyMissing=new Set(data.listingIdsWithoutOffers);return data.listings.filter(listing=>listing.status==='ACTIVE'&&trulyMissing.has(listing.id))}
    const listingIds=new Set(data.offers.map(offer=>offer.listingId))
    return data.listings.filter(listing=>listing.status==='ACTIVE'&&!listingIds.has(listing.id))
  },[data.listings,data.offers,data.listingIdsWithoutOffers])
  const products = useMemo(() => searchProducts(data, query).filter((product) =>
    status === 'ALL' || visibleChannels.some((channel) => {if(status==='REGULAR'||status==='PROMOTION'){const promotion=promotionFor(product,channel);return promotion===status||promotion==='MIXED'}return statusFor(product,channel)===status}),
  ), [data, query, status, statusFor, promotionFor, visibleChannels])

  return <div className="feature-page channel-matrix-page">
    <PageHeader title="채널 상품 매트릭스" description={`상품별 등록 여부와 가격 상태를 ${data.channels.length}개 판매채널에서 비교합니다.`} />
    <ChannelProductExport data={data} configurationData={configurationError?null:configurationData} coupons={local&&couponData&&!couponError?couponData.coupons:null} prices={prices} now={now} loading={local&&((couponData===null&&!couponError)||(configurationData===null&&!configurationError)||(priceRows===null&&!priceError))} />
    {local&&couponData&&<ChannelCoupons data={data} coupons={couponData.coupons} revision={couponData.revision} onChange={refreshCoupons} editable={Boolean(onUnmap)} />}
    {local&&feeData&&<ChannelFees channels={data.channels} fees={feeData.fees} revision={feeData.revision} onChange={refreshFees} editable={Boolean(onUnmap)} />}
    {local&&feeError&&<p className="error-banner" role="alert">채널 수수료 정보를 불러오지 못해 예상 마진을 계산할 수 없습니다.</p>}
    {local&&couponError&&<p className="error-banner" role="alert">쿠폰 정보를 불러오지 못해 쿠폰 적용 후 가격을 표시할 수 없습니다.</p>}
    {local&&priceError&&<p className="error-banner" role="alert">마스터 원본 가격을 불러오지 못했습니다. 확인된 가격만 표시합니다.</p>}
    {local&&(couponError||feeError||priceError||configurationError)&&<div><button type="button" className="button button-small" onClick={()=>window.location.reload()}>정보 다시 불러오기</button></div>}
    {local&&noOptions.length>0&&<section className="panel"><details><summary>옵션 상세 자료가 필요한 채널 상품 {noOptions.length}개</summary><p className="muted">상품 정보만 가져온 상태입니다. 옵션과 구성은 아직 연결되지 않아 매트릭스에서 미등록으로 보일 수 있습니다.</p><ul>{noOptions.map(listing=><li key={listing.id}>{data.channels.find(channel=>channel.id===listing.channelId)?.channelName} · {listing.productName} <span className="mono">({listing.channelProductId})</span></li>)}</ul></details></section>}
    <section className="panel">
      {local && <details className="matrix-guide"><summary>가격 상태와 예상 마진 기준</summary><div><p>채널 판매가가 정상가보다 높거나 원데이/라이브 행사가보다 낮으면 비정상입니다. 기준 가격이 없으면 확인이 필요합니다.</p><p>쿠폰 적용 후 최종가가 상시가보다 낮으면 행사중, 같거나 높으면 상시입니다. 옵션별 상태가 다르면 혼합으로 표시합니다.</p><p>예상 마진은 채널 판매가에서 총원가, 쿠폰 자사 부담금, 채널 수수료를 뺀 금액입니다. 수수료는 쿠폰 적용 후 고객 결제 예상가를 기준으로 계산합니다.</p></div></details>}
      {local&&data.listings.some(listing=>data.channels.some(channel=>channel.id===listing.channelId&&channel.channelCode==='NAVER'))&&<p className="matrix-source-note">스마트스토어 가격은 {naverSync?`${formatDate(naverSync)}에 가져온 엑셀`:'가져온 엑셀'} 기준입니다. 예약 할인 기간이 바뀌면 화면을 새로고침해 주세요. 채널의 최신 변경은 자동 반영되지 않습니다.</p>}
      <FilterBar>
        <SearchInput value={query} onChange={setQuery} placeholder="상품명, 사방넷 품번, SKU 검색" />
        <SelectField value={status} onChange={setStatus} label="셀 상태" options={local?statusOptions:statusOptions.filter(item=>!['REGULAR','PROMOTION'].includes(item.value))} />
        {local&&<label className="matrix-event-select"><span>행사가</span><select aria-label="행사가" value={eventPrice} onChange={event=>setEventPrice(event.target.value as EventPriceKey)}>{eventPriceOptions.map(option=><option value={option.value} key={option.value}>{option.label}</option>)}</select></label>}
        <details className="matrix-channel-select"><summary>채널 선택 ({visibleChannels.length}/{data.channels.length})</summary><div className="matrix-channel-menu"><button type="button" className="button button-small" onClick={()=>setHiddenChannelIds([])}>전체 선택</button>{data.channels.map(channel=><label key={channel.id}><input type="checkbox" checked={!hiddenChannelIds.includes(channel.id)} onChange={event=>setHiddenChannelIds(current=>event.target.checked?current.filter(id=>id!==channel.id):[...current,channel.id])} /> {channel.channelName}</label>)}</div></details>
        {(query || status !== 'ALL' || hiddenChannelIds.length>0) && <button className="button button-small" onClick={() => { setQuery(''); setStatus('ALL');setHiddenChannelIds([]) }}>필터 초기화</button>}
        <span className="muted matrix-result-count">상품 {products.length.toLocaleString()}개</span>
      </FilterBar>
      {data.channels.length === 0 ? <EmptyState title="등록된 채널이 없습니다" description="채널 설정에서 판매채널을 먼저 등록해 주세요." /> : visibleChannels.length===0 ? <EmptyState title="표시할 채널을 선택해 주세요" action={<button className="button" type="button" onClick={()=>setHiddenChannelIds([])}>전체 채널 보기</button>} /> : products.length === 0 ? <EmptyState title="조건에 맞는 상품이 없습니다" action={<button className="button" type="button" onClick={()=>{setQuery('');setStatus('ALL')}}>검색·상태 초기화</button>} /> :
        <DataTable minWidth={1130}>
          <thead><tr><th>기준 상품</th><th>구성</th>{visibleChannels.map((channel) => <th key={channel.id}><ChannelBadge channel={channel} /></th>)}</tr></thead>
          <tbody>{products.map((product) => {
            const componentCount = getProductComponents(data, product.id).length
            return <tr key={product.id}>
              <td><div className="product-cell"><ProductThumb productId={product.id} name={product.productName} /><div><a className="text-link" href={`#/products/${product.id}`}>{product.productName}</a><span className="mono">{product.sabangnetCode}</span></div></div></td>
              <td><span>{componentCount} SKU</span><small className="muted">{product.productType === 'SET' ? '세트' : '단품'}</small></td>
              {visibleChannels.map((channel) => <MatrixCell key={channel.id} data={data} product={product} channel={channel} cellStatus={statusFor(product,channel)} promotion={local?promotionFor(product,channel):null} price={prices.get(product.id)} configs={configurationData?.configurations.filter(c=>c.productId===product.id)??[]} configurationReady={configurationData!==null&&!configurationError} couponReady={couponData!==null&&!couponError} feeReady={feeData!==null&&!feeError} feeRate={feeData?(feeData.fees.find(f=>f.channelId===channel.id)?.rate??0):null} local={local} eventPrice={eventPrice} coupon={couponData?.coupons.filter(c=>c.channelId===channel.id&&koreaDate(now)>=c.startDate&&koreaDate(now)<=c.endDate)} now={now} onOpen={() => setSelected({ product, channel })} />)}
            </tr>
          })}</tbody>
        </DataTable>}
    </section>
    {selected && <CellDrawer data={data} product={selected.product} channel={selected.channel} cellStatus={statusFor(selected.product,selected.channel)} price={prices.get(selected.product.id)} configurationData={configurationData} configurationError={configurationError} onBindConfiguration={onBindConfiguration} local={local} onUnmap={onUnmap} couponReady={couponData!==null&&!couponError} feeReady={feeData!==null&&!feeError} feeRate={feeData?(feeData.fees.find(f=>f.channelId===selected.channel.id)?.rate??0):null} coupon={couponData?.coupons.filter(c=>c.channelId===selected.channel.id&&koreaDate(now)>=c.startDate&&koreaDate(now)<=c.endDate)} now={now} onClose={() => setSelected(null)} />}
  </div>
}

function MatrixCell({ data, product, channel, cellStatus, promotion, price, configs,configurationReady,couponReady,feeReady,feeRate,local, eventPrice, coupon,now,onOpen }: { data: SellerData; product: Product; channel: Channel; cellStatus:CellStatus; promotion:ReturnType<typeof channelPromotionStatus>; price?:ProductPrice;configs:ProductConfiguration[];configurationReady:boolean;couponReady:boolean;feeReady:boolean;feeRate:number|null;local:boolean;eventPrice:EventPriceKey;coupon?:Coupon[];now:Date; onOpen: () => void }) {
  const details = getOfferDetails(data, product.id).filter((detail) => detail.channel.id === channel.id)
  const prices = [...new Set(details.map((detail) => detail.offer.salePrice ?? detail.offer.normalPrice).filter((price): price is number => price !== null))]
  const active=details.filter(d=>d.offer.status==='ACTIVE'&&d.listing.status==='ACTIVE')
  const couponResults=active.map(d=>applyCoupon(d.offer.salePrice,coupon,product.id,now))
  const couponPrices=couponResults.map((value,index)=>value??active[index].offer.salePrice).filter((value):value is number=>value!==null)
  const anyCoupon=couponResults.some(value=>value!==null)
  const scopedCoupons=coupon?.filter(c=>!c.productIds||c.productIds.includes(product.id))??[]
  const inCouponScope=scopedCoupons.length>0
  const couponLabel=scopedCoupons.length===1?`${scopedCoupons[0].name} 적용 후`:'쿠폰 적용 후'
  const cost=configurationReady&&!configs.length&&!price?.options.length?price?.values?.cost??null:null
  const expenses=active.map(d=>companyCouponCost(d.offer.salePrice,coupon,product.id,now))
  const fees=active.map(d=>calculateChannelFee(d.offer.salePrice,feeRate,coupon,product.id,now))
  const margins=active.map((d,index)=>expectedMargin(d.offer.salePrice,cost,expenses[index],fees[index]))
  const knownMargins=margins.filter((value):value is number=>value!==null)
  const marginLabel=!active.length?'—':!configurationReady?'구성 정보 확인 필요':!couponReady?'쿠폰 정보 확인 필요':!feeReady?'수수료 정보 확인 필요':feeRate===null?'채널 수수료 미입력':configs.length||price?.options.length?'구성별 원가 확인 필요':cost===null?'총원가 확인 필요':active.some(d=>d.offer.salePrice===null)?'판매가 확인 필요':expenses.some(value=>value===null)?'쿠폰 부담 비율 확인 필요':knownMargins.length===1||Math.min(...knownMargins)===Math.max(...knownMargins)?formatMoney(knownMargins[0]):`${formatMoney(Math.min(...knownMargins))} ~ ${formatMoney(Math.max(...knownMargins))}`
  return <td><button className={`matrix-cell matrix-cell-${cellStatus.toLowerCase()}`} onClick={onOpen} aria-label={`${product.productName}, ${channel.channelName} 상세`}>
    <span className="matrix-cell-content"><span className="matrix-channel-price">
    <StatusBadge status={cellStatus} label={cellStatus==='PRICE_MISMATCH'?'비정상':undefined} />
    {promotion&&<span className={`promotion-label promotion-${promotion.toLowerCase()}`}>판매 상태: {promotionLabel[promotion]}</span>}
    <strong>{details.length === 0 ? '등록 없음' : details.some(detail=>detail.offer.status==='ACTIVE'&&detail.offer.salePrice===null) ? '판매가 확인 필요' : prices.length === 0 ? '가격 미입력' : prices.length === 1 ? formatMoney(prices[0]) : `${formatMoney(Math.min(...prices))}~`}</strong>
    <small>{details.length > 1 ? `옵션 ${details.length}개` : details.length === 1 ? details[0].listing.channelProductId : '원인 확인'}</small>{coupon&&inCouponScope&&active.length>0&&<small className="coupon-price">{couponLabel} {active.some(d=>d.offer.salePrice===null)?'가격 확인 필요':!anyCoupon?'최소 구매금액 미충족':couponPrices.length===1||Math.min(...couponPrices)===Math.max(...couponPrices)?formatMoney(couponPrices[0]):`${formatMoney(Math.min(...couponPrices))} ~ ${formatMoney(Math.max(...couponPrices))}`}{anyCoupon&&couponResults.some(value=>value===null)?' (일부 미적용)':''}</small>}</span>
    {local&&<span className="matrix-master-prices"><span>상시가 <b>{configs.length?'구성별 확인':showMasterPrice(price,'regular')}</b></span><span>{eventPriceOptions.find(option=>option.value===eventPrice)?.label} <b>{configs.length?'구성별 확인':showMasterPrice(price,eventPrice)}</b></span>{active.length>0&&<span>예상 마진 <b>{marginLabel}</b></span>}</span>}
    </span>
  </button></td>
}

function CellDrawer({ data, product, channel, cellStatus, price, configurationData,configurationError,onBindConfiguration,local, onUnmap,couponReady,feeReady,feeRate,coupon,now,onClose }: { data: SellerData; product: Product; channel: Channel; cellStatus:CellStatus; price?:ProductPrice;configurationData:ConfigurationData|null;configurationError:boolean;onBindConfiguration?: (offerId:string,configurationId:string)=>Promise<void>; local:boolean; onUnmap?: (offerId:string,productId:string)=>Promise<void>;couponReady:boolean;feeReady:boolean;feeRate:number|null;coupon?:Coupon[];now:Date; onClose: () => void }) {
  const [confirm,setConfirm]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const values=price?.options.length?null:price?.values
  const configs=configurationData?.configurations.filter(c=>c.productId===product.id)??[]
  const cost=configurationData&&!configurationError&&!configs.length&&!price?.options.length?price?.values?.cost??null:null
  const [choices,setChoices]=useState<Record<string,string>>({})
  async function unmap(){if(!confirm||!onUnmap)return;setBusy(true);setError('');try{await onUnmap(confirm,product.id);setConfirm(null)}catch(e){setError(e instanceof Error?e.message:'매핑 해제에 실패했습니다.')}finally{setBusy(false)}}
  const details = getOfferDetails(data, product.id).filter((detail) => detail.channel.id === channel.id)
  const scopedCoupons=(coupon??[]).filter(c=>!c.productIds||c.productIds.includes(product.id))
  const couponLabel=scopedCoupons.length===1?`${scopedCoupons[0].name} 적용 후`:'쿠폰 적용 후'
  return <Drawer title={`${product.productName} · ${channel.channelName}`} subtitle={`사방넷 품번 ${product.sabangnetCode}`} onClose={onClose}>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {local && (configurationError?<p role="alert">상품 구성 옵션을 불러오지 못해 가격 확인이 필요합니다.</p>:configs.length?<p className="muted">상품 구성 옵션별 가격을 기준으로 판정합니다.</p>:<p className="muted">마스터 정상가 {formatMoney(values?.normal??null)} · 원데이/라이브 행사가 {formatMoney(values?.live??null)} {price?.options.length ? '· 옵션별 가격은 확인이 필요합니다.' : ''}</p>)}
    <div className="status-summary"><span>셀 판정</span><StatusBadge status={cellStatus} label={cellStatus==='PRICE_MISMATCH'?'비정상':undefined} /><strong>{details.length}개 옵션</strong></div>
    {details.length === 0 ? <div className="notice"><strong>이 채널에 연결된 판매 옵션이 없습니다.</strong><p>채널 상품이 아직 수집되지 않았거나 매핑되지 않은 옵션일 수 있습니다. 매핑 센터에서 미매칭 판매상품을 확인해 주세요.</p><a className="text-link" href="#/mapping">매핑 센터로 이동</a></div> : <div className="drawer-stack">
      {details.map(({ offer, listing, channel:offerChannel }) => {const binding=configurationData?.bindings.find(b=>b.offerId===offer.id),config=configs.find(c=>c.id===binding?.configurationId),optionStatus=!configurationData||(configs.length>0&&!config)?'REVIEW':priceStatus(offer.salePrice,config?config.prices.normal:values?.normal??null,config?config.prices.live:values?.live??null),promotion=optionPromotionStatus({offer,listing,channel:offerChannel},product.id,price,configurationError?null:configurationData,couponReady,coupon,now);return <article className="offer-card" key={offer.id}>
        <div className="offer-card-heading"><div><strong>{listing.productName}</strong><span className="mono">상품번호 {listing.channelProductId} · 옵션 {offer.channelOptionId}</span></div><StatusBadge status={offer.status} /></div>
        <dl className="detail-grid">
          <div><dt>옵션명</dt><dd>{offer.optionName ?? '단일 옵션'}</dd></div><div><dt>판매자 코드</dt><dd>{offer.sellerCode ?? '-'}</dd></div>
          <div><dt>정상가</dt><dd>{formatMoney(offer.normalPrice)}</dd></div><div><dt>판매가</dt><dd>{formatMoney(offer.salePrice)}</dd></div>
          {local&&<div><dt>예상 마진 (판매가 − 총원가 − 쿠폰 자사 부담금 − 채널 수수료)</dt><dd>{configurationError||!configurationData?'구성 정보 확인 필요':!couponReady?'쿠폰 정보 확인 필요':!feeReady?'수수료 정보 확인 필요':feeRate===null?'채널 수수료 미입력':configs.length||price?.options.length?'구성별 원가 확인 필요':cost===null?'총원가 확인 필요':offer.salePrice===null?'판매가 확인 필요':companyCouponCost(offer.salePrice,coupon,product.id,now)===null?'쿠폰 부담 비율 확인 필요':formatMoney(expectedMargin(offer.salePrice,cost,companyCouponCost(offer.salePrice,coupon,product.id,now),calculateChannelFee(offer.salePrice,feeRate,coupon,product.id,now)))}</dd></div>}
          {local&&<div><dt>채널 수수료{feeRate!==null?` (${feeRate}%)`:''}</dt><dd>{!feeReady?'수수료 정보 확인 필요':feeRate===null?'미입력':!couponReady?'쿠폰 정보 확인 필요':offer.salePrice===null?'판매가 확인 필요':formatMoney(calculateChannelFee(offer.salePrice,feeRate,coupon,product.id,now))}</dd></div>}
          {local&&couponReady&&coupon&&offer.status==='ACTIVE'&&listing.status==='ACTIVE'&&applyCoupon(offer.salePrice,coupon,product.id,now)!==null&&<div><dt>쿠폰 자사 부담금</dt><dd>{companyCouponCost(offer.salePrice,coupon,product.id,now)===null?'부담 비율 확인 필요':formatMoney(companyCouponCost(offer.salePrice,coupon,product.id,now))}</dd></div>}
          {coupon&&offer.status==='ACTIVE'&&listing.status==='ACTIVE'&&applyCoupon(offer.salePrice,coupon,product.id,now)!==null&&<div><dt>{couponLabel}</dt><dd>{formatMoney(applyCoupon(offer.salePrice,coupon,product.id,now))}</dd></div>}
          <div><dt>최근 동기화</dt><dd>{formatDate(listing.lastSyncedAt)}</dd></div><div><dt>Listing 상태</dt><dd><StatusBadge status={listing.status} /></dd></div>
        </dl>
        {local && <p>가격 판정: <StatusBadge status={offer.status==='ACTIVE'&&listing.status==='ACTIVE'?optionStatus:'REVIEW'} label={optionStatus==='PRICE_MISMATCH'?'비정상':undefined} />{config&&<> · {config.name} · 정상가 {formatMoney(config.prices.normal)} · 원데이/라이브 {formatMoney(config.prices.live)}</>}</p>}
        {local&&offer.status==='ACTIVE'&&listing.status==='ACTIVE'&&<p>판매 상태: {promotionLabel[promotion]}</p>}
        {local&&configs.length>0&&<div><p>연결된 구성: {config?.name??'선택 필요'}</p>{config&&<p className="muted">{config.components.map(item=>`${data.skus.find(s=>s.id===item.skuId)?.skuCode??'확인 필요'} × ${item.quantity}`).join(', ')}</p>}{onBindConfiguration&&offer.status==='ACTIVE'&&<><label>구성 옵션 <select value={choices[offer.id]??config?.id??''} onChange={e=>setChoices({...choices,[offer.id]:e.target.value})}><option value="">선택</option>{configs.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label> <button className="button button-small" type="button" disabled={busy||!(choices[offer.id]??config?.id)} onClick={()=>{const id=choices[offer.id]??config?.id;if(!id)return;setBusy(true);setError('');void onBindConfiguration(offer.id,id).catch(e=>setError(e instanceof Error?e.message:'연결하지 못했습니다.')).finally(()=>setBusy(false))}}>구성 연결</button></>}</div>}
        {onUnmap && <button type="button" className="button button-small" onClick={()=>{setError('');setConfirm(offer.id)}}>매핑 해제</button>}
      </article>})}
    </div>}
    {confirm && <ConfirmDialog title="매핑을 해제할까요?" description="이 판매 옵션을 미매칭 상태로 되돌립니다. 다른 판매 옵션과 상품 정보는 유지됩니다." onClose={()=>!busy&&setConfirm(null)} onConfirm={()=>void unmap()} busy={busy} confirmLabel="매핑 해제">{error && <div className="error-banner" role="alert">{error}</div>}</ConfirmDialog>}
  </Drawer>
}
