import { useMemo, useState } from 'react'
import { ChannelBadge, DataTable, EmptyState, IssueBadge, PageHeader, ProductThumb, StatusBadge } from '../../components/ui'
import { formatDate, formatMoney, getCellStatus, getOfferDetails, getProductComponents } from '../../lib/selectors'
import type { AuditIssue, SellerData } from '../../types/domain'

type DetailTab = 'INFO' | 'BOM' | 'CHANNELS' | 'ISSUES'

function issueMatchesProduct(issue: AuditIssue, productId: string, listingIds: Set<string>, offerIds: Set<string>) {
  if (issue.productId !== null && issue.productId !== productId) return false
  if (issue.offerId !== null) return offerIds.has(issue.offerId)
  if (issue.listingId !== null) return listingIds.has(issue.listingId)
  return issue.productId === productId
}

export function ProductDetail({ data, productId }: { data: SellerData; productId: string }) {
  const [tab, setTab] = useState<DetailTab>('INFO')
  const product = data.products.find((item) => item.id === productId)
  const details = useMemo(() => getOfferDetails(data, productId), [data, productId])
  const components = useMemo(() => getProductComponents(data, productId), [data, productId])
  const listingIds = useMemo(() => new Set(details.map((detail) => detail.listing.id)), [details])
  const offerIds = useMemo(() => new Set(details.map((detail) => detail.offer.id)), [details])
  const issues = useMemo(() => data.issues.filter((issue) => issueMatchesProduct(issue, productId, listingIds, offerIds))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)), [data.issues, listingIds, offerIds, productId])

  if (!product) return <>
    <PageHeader eyebrow="PRODUCT 360" title="상품을 찾을 수 없습니다" description="요청한 판매상품이 없거나 삭제되었습니다." actions={<a className="button" href="#/products">목록으로</a>} />
    <section className="panel"><EmptyState title="판매상품 정보가 없습니다." description="상품 목록에서 다시 선택해 주세요." action={<a className="button button-primary" href="#/products">판매상품 마스터로 이동</a>} /></section>
  </>

  return <>
    <PageHeader eyebrow="PRODUCT 360" title={product.productName} description={`사방넷 품번 ${product.sabangnetCode} · SKU, 채널 판매정보와 검수 이력을 한 화면에서 확인합니다.`} actions={<a className="button" href="#/products">목록으로</a>} />
    <section className="panel product-hero">
      <div className="product-cell"><ProductThumb name={product.productName} size={76} /><div><span className="mono muted">{product.sabangnetCode}</span><h2>{product.productName}</h2><div className="badge-row"><StatusBadge status={product.status} /><StatusBadge status={product.productType} /></div></div></div>
      <div className="detail-grid">
        <span className="stat-chip"><small>정상가</small><strong>{formatMoney(product.normalPrice)}</strong></span>
        <span className="stat-chip"><small>구성 SKU</small><strong>{components.length}</strong></span>
        <span className="stat-chip"><small>등록 채널</small><strong>{new Set(details.map((detail) => detail.channel.id)).size} / {data.channels.length}</strong></span>
        <span className="stat-chip"><small>검수 이력</small><strong>{issues.length}</strong></span>
      </div>
    </section>
    <nav className="tabs" aria-label="상품 상세 섹션">
      {([['INFO', '기본 정보'], ['BOM', 'SKU 구성'], ['CHANNELS', '채널 등록 정보'], ['ISSUES', `이슈 이력 ${issues.length}`]] as const).map(([value, label]) => <button key={value} className={`tab ${tab === value ? 'active' : ''}`} type="button" aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    {tab === 'INFO' && <section className="panel"><h2 className="section-heading">기본 정보</h2><div className="info-grid">
      <div className="info-item"><span>사방넷 품번</span><strong className="mono">{product.sabangnetCode}</strong></div>
      <div className="info-item"><span>상품명</span><strong>{product.productName}</strong></div>
      <div className="info-item"><span>카테고리</span><strong>{product.category ?? '미지정'}</strong></div>
      <div className="info-item"><span>상품 구분</span><StatusBadge status={product.productType} /></div>
      <div className="info-item"><span>정상가</span><strong>{formatMoney(product.normalPrice)}</strong></div>
      <div className="info-item"><span>상태</span><StatusBadge status={product.status} /></div>
      <div className="info-item"><span>최근 수정일</span><strong>{formatDate(product.updatedAt)}</strong></div>
    </div></section>}
    {tab === 'BOM' && <section className="panel"><h2 className="section-heading">SKU 구성 (BOM)</h2>{components.length > 0 ? <DataTable minWidth={640}><thead><tr><th>SKU 코드</th><th>모델명</th><th>색상</th><th className="align-right">구성 수량</th><th>상태</th></tr></thead><tbody>{components.map(({ component, sku }) => <tr key={component.id}><td className="mono"><strong>{sku.skuCode}</strong></td><td>{sku.modelName}</td><td>{sku.color ?? '-'}</td><td className="align-right"><strong>{component.quantity}</strong>개</td><td><StatusBadge status={sku.status} /></td></tr>)}</tbody></DataTable> : <EmptyState title="SKU 구성정보가 없습니다." description="이 판매상품의 BOM이 아직 등록되지 않았습니다." />}</section>}
    {tab === 'CHANNELS' && <section className="panel"><h2 className="section-heading">채널 등록 정보</h2><DataTable minWidth={1040}><thead><tr><th>채널</th><th>채널 상품번호</th><th>채널 상품명</th><th>옵션</th><th className="align-right">정상가</th><th className="align-right">판매가</th><th>상태</th><th>최근 동기화</th></tr></thead><tbody>{data.channels.map((channel) => {
      const channelDetails = details.filter((detail) => detail.channel.id === channel.id)
      if (channelDetails.length === 0) return <tr key={channel.id}><td><ChannelBadge channel={channel} /></td><td colSpan={5} className="muted">아직 연결된 판매상품이 없습니다.</td><td><StatusBadge status="MISSING" /></td><td>-</td></tr>
      return channelDetails.map((detail, index) => <tr key={detail.offer.id}><td>{index === 0 && <ChannelBadge channel={channel} />}</td><td className="mono">{detail.listing.productUrl ? <a className="text-link" href={detail.listing.productUrl} target="_blank" rel="noreferrer">{detail.listing.channelProductId}</a> : detail.listing.channelProductId}</td><td>{detail.listing.productName}</td><td>{detail.offer.optionName ?? '기본 옵션'}</td><td className="align-right mono">{formatMoney(detail.offer.normalPrice)}</td><td className="align-right mono">{formatMoney(detail.offer.salePrice)}</td><td><StatusBadge status={getCellStatus(data, product.id, channel.id)} /></td><td>{formatDate(detail.listing.lastSyncedAt)}</td></tr>)
    })}</tbody></DataTable></section>}
    {tab === 'ISSUES' && <section className="panel"><h2 className="section-heading">이슈 이력</h2>{issues.length > 0 ? <DataTable minWidth={760}><thead><tr><th>발견일</th><th>유형</th><th>내용</th><th>심각도</th><th>처리 상태</th></tr></thead><tbody>{issues.map((issue) => <tr key={issue.id}><td>{formatDate(issue.detectedAt)}</td><td><IssueBadge type={issue.issueType} /></td><td><strong>{issue.title}</strong><br /><span className="muted">{issue.description}</span></td><td><StatusBadge status={issue.severity} /></td><td><StatusBadge status={issue.status} /></td></tr>)}</tbody></DataTable> : <EmptyState title="발견된 이슈가 없습니다." description="현재 이 상품과 연결된 검수 이력이 없습니다." />}</section>}
  </>
}
