import { useEffect, useMemo, useState } from 'react'
import { ChannelBadge, ConfirmDialog, EmptyState, PageHeader, ProductThumb, SearchInput, StatusBadge } from '../../components/ui'
import { getMockCandidates } from '../../mock'
import { formatMoney } from '../../lib/selectors'
import type { ChannelOffer, Product, SellerData } from '../../types/domain'
import type {ProductConfiguration} from '../products/configurationTypes'
import '../channels/operations.css'

type OhouseCandidate={productCode:string;optionCode:string;candidateCode:string}
export function MappingCenter({ data, onMap, onMapConfiguration,configurations=[],configurationAvailable=true,onArchive,onArchiveOffer, readOnly = false, showDemoRecommendations = true,local=false }: { data: SellerData; onMap: (offerId: string, productId: string) => Promise<void>; onMapConfiguration?: (offerId:string,configurationId:string)=>Promise<void>; configurations?:ProductConfiguration[];configurationAvailable?:boolean;onArchive?: (offerIds:string[])=>Promise<void>;onArchiveOffer?:(offerId:string)=>Promise<void>; readOnly?: boolean; showDemoRecommendations?: boolean;local?:boolean }) {
  const [includeInactive,setIncludeInactive]=useState(false)
  const unmatched = useMemo(() => data.offers.filter((offer) => offer.masterProductId === null && (!local || offer.status==='ACTIVE' || (includeInactive&&offer.status==='INACTIVE'))), [data.offers,local,includeInactive])
  const inactiveCount=local?data.offers.filter(offer=>offer.masterProductId===null&&offer.status==='INACTIVE').length:0
  const deletableIds=local?data.offers.filter(offer=>offer.masterProductId===null&&offer.status==='INACTIVE').map(offer=>offer.id):[]
  const [archiveSelection,setArchiveSelection]=useState<string[]|null>(null)
  const [removeSelection,setRemoveSelection]=useState<{id:string;name:string;option:string}|null>(null)
  const [sourceCandidates,setSourceCandidates]=useState<OhouseCandidate[]>([])
  useEffect(()=>{if(!local)return;const controller=new AbortController();void fetch('/api/ohouse-candidates',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(response=>response.ok?response.json():Promise.reject(new Error('unavailable'))).then(result=>{if(Array.isArray(result.candidates))setSourceCandidates(result.candidates as OhouseCandidate[])}).catch(()=>{});return ()=>controller.abort()},[local])
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(unmatched[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [candidate, setCandidate] = useState<{ offerId: string; productId: string } | null>(null)
  const [configurationChoice,setConfigurationChoice]=useState<{offerId:string;productId:string;id:string}|null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const filteredOffers = unmatched.filter((offer) => {
    const listing = data.listings.find((item) => item.id === offer.listingId)
    return `${listing?.productName ?? ''} ${listing?.channelProductId ?? ''} ${offer.optionName ?? ''}`.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR'))
  })
  const effectiveSelectedOfferId = selectedOfferId && filteredOffers.some(offer => offer.id === selectedOfferId) ? selectedOfferId : filteredOffers[0]?.id ?? null
  const candidateId = candidate?.offerId === effectiveSelectedOfferId ? candidate?.productId : null
  function setCandidateId(productId: string | null) {
    setCandidate(productId && effectiveSelectedOfferId ? { offerId: effectiveSelectedOfferId, productId } : null)
  }
  function searchOffers(value: string) {
    setQuery(value); setCandidate(null); setProductQuery(''); setConfirming(false); setError('')
  }
  const selectedOffer = unmatched.find((offer) => offer.id === effectiveSelectedOfferId) ?? null
  const listing = selectedOffer ? data.listings.find((item) => item.id === selectedOffer.listingId) : undefined
  const channel = listing ? data.channels.find((item) => item.id === listing.channelId) : undefined
  const sourceCandidate=channel?.channelCode==='OHOUSE'&&listing&&selectedOffer?sourceCandidates.find(item=>item.productCode===listing.channelProductId&&item.optionCode===selectedOffer.channelOptionId):undefined
  const sourceProduct=sourceCandidate?data.products.find(item=>item.sabangnetCode===sourceCandidate.candidateCode&&item.status==='ACTIVE'):undefined
  const recommendations = selectedOffer && showDemoRecommendations ? getMockCandidates(data, selectedOffer.id) : []
  const fallbackProducts = data.products.filter((product) => `${product.sabangnetCode} ${product.productName}`.toLocaleLowerCase('ko-KR').includes(productQuery.trim().toLocaleLowerCase('ko-KR')))
  const target = data.products.find((product) => product.id === candidateId)
  const targetConfigs=configurations.filter(c=>c.productId===target?.id)
  const configurationId=configurationChoice?.offerId===selectedOffer?.id&&configurationChoice?.productId===target?.id?configurationChoice?.id??'':''

  async function confirmMapping() {
    if (readOnly) return
    if (!selectedOffer || !target) return
    const completedId = selectedOffer.id
    const visibleIndex = unmatched.findIndex((offer) => offer.id === completedId)
    setBusy(true); setError('')
    try {
      if(targetConfigs.length){if(!configurationId||!onMapConfiguration)throw new Error('구성 옵션을 선택해 주세요.');await onMapConfiguration(completedId,configurationId)}else await onMap(completedId, target.id)
      const remaining = unmatched.filter((offer) => offer.id !== completedId)
      setSelectedOfferId(remaining[Math.min(visibleIndex, remaining.length - 1)]?.id ?? null)
      setCandidateId(null); setProductQuery(''); setConfirming(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '매핑을 저장하지 못했습니다. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  async function confirmArchive(){
    if(!onArchive||!archiveSelection?.length)return
    setBusy(true);setError('')
    try{await onArchive(archiveSelection);setArchiveSelection(null);setSelectedOfferId(null);setCandidateId(null)}
    catch(reason){setError(reason instanceof Error?reason.message:'미사용 옵션을 삭제 처리하지 못했습니다.')}
    finally{setBusy(false)}
  }
  async function confirmRemove(){
    if(!onArchiveOffer||!removeSelection)return
    setBusy(true);setError('')
    try{await onArchiveOffer(removeSelection.id);setRemoveSelection(null);setSelectedOfferId(null);setCandidateId(null)}
    catch(reason){setError(reason instanceof Error?reason.message:'미매칭 품목을 삭제하지 못했습니다.')}
    finally{setBusy(false)}
  }

  return <div className="feature-page mapping-page">
    <PageHeader title="매핑 센터" description={readOnly ? '미매칭 판매 옵션을 조회합니다. 현재 계정은 읽기 전용입니다.' : '미매칭 판매 옵션을 기준 상품에 연결합니다.'} />
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className={`mapping-layout${filteredOffers.length === 0 ? ' mapping-layout-empty' : ''}`}>
      <section className="panel mapping-queue"><div className="section-heading"><div><h2>미매칭 판매상품</h2><p className="muted">처리 대기 {unmatched.length}개</p>{local&&inactiveCount>0&&<label><input type="checkbox" checked={includeInactive} onChange={event=>setIncludeInactive(event.target.checked)} /> 미사용 옵션 {inactiveCount}개 포함</label>}</div></div>{onArchive&&deletableIds.length>0&&<p><button type="button" className="button button-small" onClick={()=>{setError('');setArchiveSelection(deletableIds)}}>미사용 옵션 {deletableIds.length}개 일괄 삭제</button></p>}<SearchInput label="미매칭 상품 검색" value={query} onChange={searchOffers} placeholder="채널 상품명, 상품번호 검색" />
        {filteredOffers.length === 0 ? <EmptyState title={unmatched.length ? '검색 결과가 없습니다' : '매핑할 상품이 없습니다'} description={!unmatched.length ? '현재 처리할 미매칭 판매 옵션이 없습니다.' : undefined} action={unmatched.length&&query ? <button className="button" type="button" onClick={()=>searchOffers('')}>전체 상품 보기</button> : undefined} /> : <div className="queue-list">{filteredOffers.map((offer) => <OfferButton key={offer.id} data={data} offer={offer} active={offer.id === effectiveSelectedOfferId} onClick={() => { setSelectedOfferId(offer.id); setCandidateId(null); setError('') }} />)}</div>}
      </section>
      {filteredOffers.length > 0 && <section className="panel mapping-detail">
        {!selectedOffer || !listing || !channel ? <EmptyState title={filteredOffers.length ? '판매상품을 선택해 주세요' : '표시할 판매상품이 없습니다'} description={filteredOffers.length ? '대기 목록에서 확인할 판매 옵션을 선택하세요.' : undefined} /> : <>
          <div className="section-heading"><div><h2>판매상품 상세</h2><p className="muted">연결할 기준 상품을 선택해 주세요.</p></div><ChannelBadge channel={channel} /></div>
          <div className="source-card"><ProductThumb name={listing.productName} size={54} /><div><strong>{listing.productName}</strong><span>{selectedOffer.optionName ?? '단일 옵션'}</span><span className="mono">채널 상품번호 {listing.channelProductId} · 옵션 {selectedOffer.channelOptionId}</span></div><div><StatusBadge status="OPEN" label="미매칭" /><strong>{formatMoney(selectedOffer.salePrice)}</strong></div></div>
          {onArchiveOffer&&<div className="mapping-actions"><span className="muted">선택한 미매칭 품목을 목록에서 삭제합니다.</span><button type="button" className="button button-small" disabled={busy} onClick={()=>{setError('');setRemoveSelection({id:selectedOffer.id,name:listing.productName,option:selectedOffer.optionName??'단일 옵션'})}}>미매칭 품목 삭제</button></div>}
          {readOnly ? <div className="notice">읽기 전용 계정에서는 매핑을 저장할 수 없습니다.</div> : <>
            {local&&<div className="notice">기준 상품을 연결해도 옵션의 SKU 구성은 자동으로 확정되지 않습니다. 구성과 추가옵션 여부를 확인해 주세요.</div>}
            {sourceProduct&&<div className="fallback-search"><h3>마스터 상품번호 기준 후보</h3><p className="muted">채널 상품번호가 일치하는 후보입니다. 옵션 색상과 구성이 같은지 확인해 주세요.</p><div className="candidate-grid compact-candidates"><ProductCandidate product={sourceProduct} selected={candidateId===sourceProduct.id} onSelect={()=>setCandidateId(sourceProduct.id)} /></div></div>}
            {showDemoRecommendations && <><div className="section-heading candidate-heading"><div><h3>추천 기준 상품</h3><p className="muted">고정 시드로 제공되는 데모 후보이며 자동 매칭 결과가 아닙니다.</p></div><span className="badge badge-purple">데모 추천</span></div>{recommendations.length === 0 ? <div className="notice">이 판매상품에는 데모 추천 후보가 없습니다. 아래 전체 상품 검색을 이용해 주세요.</div> : <div className="candidate-grid">{recommendations.map((candidate) => { const product = data.products.find((item) => item.id === candidate.productId); return product && <ProductCandidate key={product.id} product={product} selected={candidateId === product.id} score={`${Math.round(candidate.confidence * 100)}% · 데모 추천`} onSelect={() => setCandidateId(product.id)} /> })}</div>}</>}
            <div className="fallback-search"><h3>기준 상품 검색</h3><SearchInput label="기준 상품 검색" value={productQuery} onChange={setProductQuery} placeholder="상품명 또는 사방넷 품번 검색" />{productQuery && <div className="candidate-grid compact-candidates">{fallbackProducts.slice(0, 8).map((product) => <ProductCandidate key={product.id} product={product} selected={candidateId === product.id} onSelect={() => setCandidateId(product.id)} />)}{fallbackProducts.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}</div>}</div>
            {targetConfigs.length>0&&<label>상품 구성 옵션 <select aria-label="상품 구성 옵션" value={configurationId} onChange={e=>setConfigurationChoice({offerId:selectedOffer.id,productId:target!.id,id:e.target.value})}><option value="">구성 옵션 선택</option>{targetConfigs.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            {local&&!configurationAvailable&&<div className="notice">상품 구성 옵션을 확인할 수 없어 매핑을 잠시 사용할 수 없습니다.</div>}
            <div className="mapping-actions"><span className="muted">{target ? `${target.sabangnetCode} ${target.productName}${configurationId?` · ${targetConfigs.find(c=>c.id===configurationId)?.name}`:''} 선택됨` : '연결할 기준 상품을 선택하세요.'}</span><button className="button button-primary" disabled={!target || busy || !configurationAvailable || (targetConfigs.length>0&&!configurationId)} onClick={() => setConfirming(true)}>매핑 저장</button></div>
          </>}
        </>}
      </section>}
    </div>
    {!readOnly && confirming && selectedOffer && listing && channel && target && <ConfirmDialog title="판매상품을 연결할까요?" description={`${channel.channelName}의 “${listing.productName}${selectedOffer.optionName ? ` / ${selectedOffer.optionName}` : ''}”을(를) “${target.sabangnetCode} ${target.productName}${configurationId?` / ${targetConfigs.find(c=>c.id===configurationId)?.name}`:''}”에 연결합니다.`} onClose={() => !busy && setConfirming(false)} onConfirm={confirmMapping} busy={busy}>{error && <div className="error-banner" role="alert">{error}</div>}</ConfirmDialog>}
    {archiveSelection&&<ConfirmDialog title="미사용 옵션을 일괄 삭제할까요?" description={`전체 채널의 미매칭 미사용 옵션 ${archiveSelection.length}개를 삭제 처리합니다. 검색 필터와 관계없이 적용되며 기록은 보관됩니다.`} confirmLabel="일괄 삭제" onClose={()=>!busy&&setArchiveSelection(null)} onConfirm={()=>void confirmArchive()} busy={busy}>{error&&<div className="error-banner" role="alert">{error}</div>}</ConfirmDialog>}
    {removeSelection&&<ConfirmDialog title="미매칭 품목을 삭제할까요?" description={`“${removeSelection.name} / ${removeSelection.option}”을 SellerAudit 목록에서 삭제합니다. 채널의 실제 상품은 변경되지 않으며 처리 기록은 보관됩니다.`} confirmLabel="삭제" onClose={()=>!busy&&setRemoveSelection(null)} onConfirm={()=>void confirmRemove()} busy={busy}>{error&&<div className="error-banner" role="alert">{error}</div>}</ConfirmDialog>}
  </div>
}

function OfferButton({ data, offer, active, onClick }: { data: SellerData; offer: ChannelOffer; active: boolean; onClick: () => void }) {
  const listing = data.listings.find((item) => item.id === offer.listingId)
  const channel = data.channels.find((item) => item.id === listing?.channelId)
  if (!listing || !channel) return null
  return <button className={`queue-item ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}><ChannelBadge channel={channel} compact /><span><strong>{listing.productName}</strong><small>{offer.optionName ?? '단일 옵션'} · {listing.channelProductId}</small></span><span>{formatMoney(offer.salePrice)}</span></button>
}

function ProductCandidate({ product, selected, score, onSelect }: { product: Product; selected: boolean; score?: string; onSelect: () => void }) {
  return <button className={`candidate-card ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onSelect}><ProductThumb productId={product.id} name={product.productName} /><span><strong>{product.productName}</strong><small className="mono">{product.sabangnetCode}</small></span>{score && <em>{score}</em>}<span className="candidate-check">{selected ? '선택됨' : '선택'}</span></button>
}
