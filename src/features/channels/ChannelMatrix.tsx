import { useMemo, useState } from 'react'
import { ChannelBadge, DataTable, Drawer, EmptyState, FilterBar, PageHeader, ProductThumb, SearchInput, SelectField, StatusBadge } from '../../components/ui'
import { formatDate, formatMoney, getCellStatus, getOfferDetails, getProductComponents, searchProducts } from '../../lib/selectors'
import type { CellStatus, Channel, Product, SellerData } from '../../types/domain'
import './operations.css'

const statusOptions = [
  { value: 'ALL', label: '상태 전체' },
  { value: 'NORMAL', label: '정상' },
  { value: 'MISSING', label: '미등록' },
  { value: 'PRICE_MISMATCH', label: '가격 이상' },
  { value: 'REVIEW', label: '확인 필요' },
]

interface SelectedCell { product: Product; channel: Channel }

export function ChannelMatrix({ data }: { data: SellerData }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [selected, setSelected] = useState<SelectedCell | null>(null)
  const products = useMemo(() => searchProducts(data, query).filter((product) =>
    status === 'ALL' || data.channels.some((channel) => getCellStatus(data, product.id, channel.id) === status),
  ), [data, query, status])

  return <div className="feature-page channel-matrix-page">
    <PageHeader eyebrow="운영 현황" title="채널 상품 매트릭스" description="기준 상품별 등록 여부와 가격 상태를 6개 판매채널에서 비교합니다." />
    <section className="panel">
      <FilterBar>
        <SearchInput value={query} onChange={setQuery} placeholder="상품명, 사방넷 품번, SKU 검색" />
        <SelectField value={status} onChange={setStatus} label="셀 상태" options={statusOptions} />
        {(query || status !== 'ALL') && <button className="button button-small" onClick={() => { setQuery(''); setStatus('ALL') }}>필터 초기화</button>}
        <span className="muted matrix-result-count">상품 {products.length.toLocaleString()}개</span>
      </FilterBar>
      {data.channels.length === 0 ? <EmptyState title="등록된 채널이 없습니다" description="채널 설정에서 판매채널을 먼저 등록해 주세요." /> : products.length === 0 ? <EmptyState title="조건에 맞는 상품이 없습니다" description="검색어나 셀 상태 필터를 변경해 보세요." /> :
        <DataTable minWidth={1130}>
          <thead><tr><th>기준 상품</th><th>구성</th>{data.channels.map((channel) => <th key={channel.id}><ChannelBadge channel={channel} /></th>)}</tr></thead>
          <tbody>{products.map((product) => {
            const componentCount = getProductComponents(data, product.id).length
            return <tr key={product.id}>
              <td><div className="product-cell"><ProductThumb name={product.productName} /><div><a className="text-link" href={`#/products/${product.id}`}>{product.productName}</a><span className="mono">{product.sabangnetCode}</span></div></div></td>
              <td><span>{componentCount} SKU</span><small className="muted">{product.productType === 'SET' ? '세트' : '단품'}</small></td>
              {data.channels.map((channel) => <MatrixCell key={channel.id} data={data} product={product} channel={channel} onOpen={() => setSelected({ product, channel })} />)}
            </tr>
          })}</tbody>
        </DataTable>}
    </section>
    {selected && <CellDrawer data={data} product={selected.product} channel={selected.channel} onClose={() => setSelected(null)} />}
  </div>
}

function MatrixCell({ data, product, channel, onOpen }: { data: SellerData; product: Product; channel: Channel; onOpen: () => void }) {
  const details = getOfferDetails(data, product.id).filter((detail) => detail.channel.id === channel.id)
  const cellStatus = getCellStatus(data, product.id, channel.id)
  const prices = [...new Set(details.map((detail) => detail.offer.salePrice ?? detail.offer.normalPrice).filter((price): price is number => price !== null))]
  return <td><button className={`matrix-cell matrix-cell-${cellStatus.toLowerCase()}`} onClick={onOpen} aria-label={`${product.productName}, ${channel.channelName} 상세`}>
    <StatusBadge status={cellStatus} />
    <strong>{details.length === 0 ? '등록 없음' : prices.length === 0 ? '가격 미입력' : prices.length === 1 ? formatMoney(prices[0]) : `${formatMoney(Math.min(...prices))}~`}</strong>
    <small>{details.length > 1 ? `옵션 ${details.length}개` : details.length === 1 ? details[0].listing.channelProductId : '원인 확인'}</small>
  </button></td>
}

function CellDrawer({ data, product, channel, onClose }: { data: SellerData; product: Product; channel: Channel; onClose: () => void }) {
  const details = getOfferDetails(data, product.id).filter((detail) => detail.channel.id === channel.id)
  const cellStatus: CellStatus = getCellStatus(data, product.id, channel.id)
  return <Drawer title={`${product.productName} · ${channel.channelName}`} subtitle={`사방넷 품번 ${product.sabangnetCode}`} onClose={onClose}>
    <div className="status-summary"><span>셀 판정</span><StatusBadge status={cellStatus} /><strong>{details.length}개 옵션</strong></div>
    {details.length === 0 ? <div className="notice"><strong>이 채널에 연결된 판매 옵션이 없습니다.</strong><p>채널 상품이 아직 수집되지 않았거나 매핑되지 않은 옵션일 수 있습니다. 매핑 센터에서 미매칭 판매상품을 확인해 주세요.</p><a className="text-link" href="#/mapping">매핑 센터로 이동</a></div> : <div className="drawer-stack">
      {details.map(({ offer, listing }) => <article className="offer-card" key={offer.id}>
        <div className="offer-card-heading"><div><strong>{listing.productName}</strong><span className="mono">상품번호 {listing.channelProductId} · 옵션 {offer.channelOptionId}</span></div><StatusBadge status={offer.status} /></div>
        <dl className="detail-grid">
          <div><dt>옵션명</dt><dd>{offer.optionName ?? '단일 옵션'}</dd></div><div><dt>판매자 코드</dt><dd>{offer.sellerCode ?? '-'}</dd></div>
          <div><dt>정상가</dt><dd>{formatMoney(offer.normalPrice)}</dd></div><div><dt>판매가</dt><dd>{formatMoney(offer.salePrice)}</dd></div>
          <div><dt>최근 동기화</dt><dd>{formatDate(listing.lastSyncedAt)}</dd></div><div><dt>Listing 상태</dt><dd><StatusBadge status={listing.status} /></dd></div>
        </dl>
      </article>)}
    </div>}
  </Drawer>
}
