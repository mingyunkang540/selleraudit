import { useMemo, useState } from 'react'
import { DataTable, EmptyState, FilterBar, PageHeader, Pagination, ProductThumb, SearchInput, SelectField, StatusBadge } from '../../components/ui'
import { formatMoney, getOfferDetails, getProductComponents, searchProducts } from '../../lib/selectors'
import type { EntityStatus, Product, SellerData } from '../../types/domain'

const PAGE_SIZE = 10

export function ProductMaster({ data }: { data: SellerData }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | EntityStatus>('ALL')
  const [productType, setProductType] = useState<'ALL' | Product['productType']>('ALL')
  const [page, setPage] = useState(1)

  const products = useMemo(() => searchProducts(data, query).filter((product) =>
    (status === 'ALL' || product.status === status) &&
    (productType === 'ALL' || product.productType === productType),
  ), [data, productType, query, status])

  const lastPage = Math.max(1, Math.ceil(products.length / PAGE_SIZE))
  const currentPage = Math.min(page, lastPage)
  const visibleProducts = products.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return <>
    <PageHeader eyebrow="PRODUCT MASTER" title="판매상품 마스터" description="사방넷 품번을 기준으로 판매상품과 SKU, 채널 연결 상태를 관리합니다." />
    <section className="panel">
      <FilterBar>
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="사방넷 품번, 상품명, SKU, 채널 상품으로 검색" label="판매상품 검색" />
        <SelectField value={status} onChange={(value) => { setStatus(value as typeof status); setPage(1) }} label="판매상품 상태" options={[
          { value: 'ALL', label: '상태 전체' }, { value: 'ACTIVE', label: '판매중' },
          { value: 'INACTIVE', label: '판매중지' }, { value: 'DRAFT', label: '초안' },
        ]} />
        <SelectField value={productType} onChange={(value) => { setProductType(value as typeof productType); setPage(1) }} label="상품 구분" options={[
          { value: 'ALL', label: '상품구분 전체' }, { value: 'SINGLE', label: '단품' }, { value: 'SET', label: '세트' },
        ]} />
        {(query || status !== 'ALL' || productType !== 'ALL') && <button className="button button-small" type="button" onClick={() => { setQuery(''); setStatus('ALL'); setProductType('ALL'); setPage(1) }}>필터 초기화</button>}
      </FilterBar>
      {visibleProducts.length > 0 ? <>
        <DataTable minWidth={900}>
          <thead><tr><th>판매상품</th><th>사방넷 품번</th><th>상품 구분</th><th>구성 SKU</th><th className="align-right">정상가</th><th className="align-center">연결 채널</th><th>상태</th></tr></thead>
          <tbody>{visibleProducts.map((product) => {
            const components = getProductComponents(data, product.id)
            const channelCount = new Set(getOfferDetails(data, product.id).map((detail) => detail.channel.id)).size
            return <tr key={product.id}>
              <td><a className="product-cell text-link" href={`#/products/${product.id}`}><ProductThumb name={product.productName} /><span><strong>{product.productName}</strong><small>{product.category ?? '카테고리 미지정'}</small></span></a></td>
              <td><a className="text-link mono" href={`#/products/${product.id}`}>{product.sabangnetCode}</a></td>
              <td><StatusBadge status={product.productType} /></td>
              <td>{components.length > 0 ? <span className="mono">{components.map(({ component, sku }) => `${sku.skuCode} × ${component.quantity}`).join(', ')}</span> : <span className="muted">구성 미등록</span>}</td>
              <td className="align-right mono">{formatMoney(product.normalPrice)}</td>
              <td className="align-center"><span className="stat-chip">{channelCount} / {data.channels.length}</span></td>
              <td><StatusBadge status={product.status} /></td>
            </tr>
          })}</tbody>
        </DataTable>
        <Pagination page={currentPage} total={products.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </> : <EmptyState title={query || status !== 'ALL' || productType !== 'ALL' ? '조건에 맞는 판매상품이 없습니다.' : '등록된 판매상품이 없습니다.'} description={query ? '다른 품번, 상품명 또는 SKU로 검색해 보세요.' : '필터 조건을 바꾸거나 데이터를 확인해 주세요.'} action={(query || status !== 'ALL' || productType !== 'ALL') ? <button className="button" type="button" onClick={() => { setQuery(''); setStatus('ALL'); setProductType('ALL'); setPage(1) }}>전체 상품 보기</button> : undefined} />}
    </section>
  </>
}
