import { useMemo, useState } from 'react'
import { ChannelBadge, ConfirmDialog, EmptyState, PageHeader, ProductThumb, SearchInput, StatusBadge } from '../../components/ui'
import { getMockCandidates } from '../../mock'
import { formatMoney } from '../../lib/selectors'
import type { ChannelOffer, Product, SellerData } from '../../types/domain'
import '../channels/operations.css'

export function MappingCenter({ data, onMap, readOnly = false, showDemoRecommendations = true }: { data: SellerData; onMap: (offerId: string, productId: string) => Promise<void>; readOnly?: boolean; showDemoRecommendations?: boolean }) {
  const unmatched = useMemo(() => data.offers.filter((offer) => offer.masterProductId === null), [data.offers])
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(unmatched[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [candidate, setCandidate] = useState<{ offerId: string; productId: string } | null>(null)
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
  const recommendations = selectedOffer && showDemoRecommendations ? getMockCandidates(data, selectedOffer.id) : []
  const fallbackProducts = data.products.filter((product) => `${product.sabangnetCode} ${product.productName}`.toLocaleLowerCase('ko-KR').includes(productQuery.trim().toLocaleLowerCase('ko-KR')))
  const target = data.products.find((product) => product.id === candidateId)

  async function confirmMapping() {
    if (readOnly) return
    if (!selectedOffer || !target) return
    const completedId = selectedOffer.id
    const visibleIndex = unmatched.findIndex((offer) => offer.id === completedId)
    setBusy(true); setError('')
    try {
      await onMap(completedId, target.id)
      const remaining = unmatched.filter((offer) => offer.id !== completedId)
      setSelectedOfferId(remaining[Math.min(visibleIndex, remaining.length - 1)]?.id ?? null)
      setCandidateId(null); setProductQuery(''); setConfirming(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '매핑을 저장하지 못했습니다. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }

  return <div className="feature-page mapping-page">
    <PageHeader eyebrow="수동 검수" title="매핑 센터" description={readOnly ? '미매칭 판매 옵션을 조회합니다. 현재 계정은 읽기 전용입니다.' : '미매칭 판매 옵션을 기준 상품에 연결하고 별칭으로 저장합니다.'} />
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="mapping-layout">
      <section className="panel mapping-queue"><div className="section-heading"><div><h2>미매칭 판매상품</h2><p className="muted">처리 대기 {unmatched.length}개</p></div></div><SearchInput value={query} onChange={searchOffers} placeholder="채널 상품명, 상품번호 검색" />
        {filteredOffers.length === 0 ? <EmptyState title={unmatched.length ? '검색 결과가 없습니다' : '모든 상품을 매핑했습니다'} description={unmatched.length ? '다른 검색어를 입력해 보세요.' : '현재 처리할 미매칭 판매 옵션이 없습니다.'} /> : <div className="queue-list">{filteredOffers.map((offer) => <OfferButton key={offer.id} data={data} offer={offer} active={offer.id === effectiveSelectedOfferId} onClick={() => { setSelectedOfferId(offer.id); setCandidateId(null); setError('') }} />)}</div>}
      </section>
      <section className="panel mapping-detail">
        {!selectedOffer || !listing || !channel ? <EmptyState title="판매상품을 선택해 주세요" description="왼쪽 대기 목록에서 확인할 판매 옵션을 선택하세요." /> : <>
          <div className="section-heading"><div><h2>판매상품 상세</h2><p className="muted">연결할 기준 상품을 선택해 주세요.</p></div><ChannelBadge channel={channel} /></div>
          <div className="source-card"><ProductThumb name={listing.productName} size={54} /><div><strong>{listing.productName}</strong><span>{selectedOffer.optionName ?? '단일 옵션'}</span><span className="mono">채널 상품번호 {listing.channelProductId} · 옵션 {selectedOffer.channelOptionId}</span></div><div><StatusBadge status="OPEN" label="미매칭" /><strong>{formatMoney(selectedOffer.salePrice)}</strong></div></div>
          {readOnly ? <div className="notice">읽기 전용 계정에서는 매핑을 저장할 수 없습니다.</div> : <>
            {showDemoRecommendations && <><div className="section-heading candidate-heading"><div><h3>추천 기준 상품</h3><p className="muted">고정 시드로 제공되는 데모 후보이며 자동 매칭 결과가 아닙니다.</p></div><span className="badge badge-purple">데모 추천</span></div>{recommendations.length === 0 ? <div className="notice">이 판매상품에는 데모 추천 후보가 없습니다. 아래 전체 상품 검색을 이용해 주세요.</div> : <div className="candidate-grid">{recommendations.map((candidate) => { const product = data.products.find((item) => item.id === candidate.productId); return product && <ProductCandidate key={product.id} product={product} selected={candidateId === product.id} score={`${Math.round(candidate.confidence * 100)}% · 데모 추천`} onSelect={() => setCandidateId(product.id)} /> })}</div>}</>}
            <div className="fallback-search"><h3>전체 기준 상품 검색</h3><SearchInput value={productQuery} onChange={setProductQuery} placeholder="상품명 또는 사방넷 품번 검색" />{productQuery && <div className="candidate-grid compact-candidates">{fallbackProducts.slice(0, 8).map((product) => <ProductCandidate key={product.id} product={product} selected={candidateId === product.id} onSelect={() => setCandidateId(product.id)} />)}{fallbackProducts.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}</div>}</div>
            <div className="mapping-actions"><span className="muted">{target ? `${target.sabangnetCode} ${target.productName} 선택됨` : '연결할 기준 상품을 선택하세요.'}</span><button className="button button-primary" disabled={!target || busy} onClick={() => setConfirming(true)}>매핑 저장</button></div>
          </>}
        </>}
      </section>
    </div>
    {!readOnly && confirming && selectedOffer && listing && channel && target && <ConfirmDialog title="판매상품을 연결할까요?" description={`${channel.channelName}의 “${listing.productName}${selectedOffer.optionName ? ` / ${selectedOffer.optionName}` : ''}”을(를) “${target.sabangnetCode} ${target.productName}”에 연결하고 별칭으로 저장합니다.`} onClose={() => !busy && setConfirming(false)} onConfirm={confirmMapping} busy={busy}>{error && <div className="error-banner" role="alert">{error}</div>}</ConfirmDialog>}
  </div>
}

function OfferButton({ data, offer, active, onClick }: { data: SellerData; offer: ChannelOffer; active: boolean; onClick: () => void }) {
  const listing = data.listings.find((item) => item.id === offer.listingId)
  const channel = data.channels.find((item) => item.id === listing?.channelId)
  if (!listing || !channel) return null
  return <button className={`queue-item ${active ? 'active' : ''}`} onClick={onClick}><ChannelBadge channel={channel} compact /><span><strong>{listing.productName}</strong><small>{offer.optionName ?? '단일 옵션'} · {listing.channelProductId}</small></span><span>{formatMoney(offer.salePrice)}</span></button>
}

function ProductCandidate({ product, selected, score, onSelect }: { product: Product; selected: boolean; score?: string; onSelect: () => void }) {
  return <button className={`candidate-card ${selected ? 'selected' : ''}`} onClick={onSelect}><ProductThumb name={product.productName} /><span><strong>{product.productName}</strong><small className="mono">{product.sabangnetCode}</small></span>{score && <em>{score}</em>}<span className="candidate-check">{selected ? '선택됨' : '선택'}</span></button>
}
