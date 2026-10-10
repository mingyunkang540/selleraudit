import { useMemo, useState } from 'react'
import { DataTable, Drawer, EmptyState, FilterBar, PageHeader, Pagination, SearchInput, SelectField, StatusBadge } from '../../components/ui'
import type { EntityStatus, SellerData, Sku } from '../../types/domain'

const PAGE_SIZE = 10

export function SkuMaster({ data }: { data: SellerData }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | EntityStatus>('ALL')
  const [page, setPage] = useState(1)
  const [selectedSku, setSelectedSku] = useState<Sku | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR')
  const skus = useMemo(() => data.skus.filter((sku) =>
    (status === 'ALL' || sku.status === status) &&
    (!normalizedQuery || `${sku.skuCode} ${sku.modelName} ${sku.color ?? ''}`.toLocaleLowerCase('ko-KR').includes(normalizedQuery)),
  ), [data.skus, normalizedQuery, status])
  const lastPage = Math.max(1, Math.ceil(skus.length / PAGE_SIZE))
  const currentPage = Math.min(page, lastPage)
  const visibleSkus = skus.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const linkedProducts = selectedSku ? data.components.filter((component) => component.skuId === selectedSku.id).flatMap((component) => {
    const product = data.products.find((item) => item.id === component.productId)
    return product ? [{ component, product }] : []
  }) : []

  return <>
    <PageHeader eyebrow="SKU MASTER" title="실물 SKU 마스터" description="물류와 재고가 움직이는 최소 단위를 확인하고 판매상품 구성을 추적합니다." />
    <section className="panel">
      <FilterBar>
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="SKU 코드, 모델명, 색상으로 검색" label="SKU 검색" />
        <SelectField value={status} onChange={(value) => { setStatus(value as typeof status); setPage(1) }} label="SKU 상태" options={[
          { value: 'ALL', label: '상태 전체' }, { value: 'ACTIVE', label: '사용중' }, { value: 'INACTIVE', label: '사용중지' }, { value: 'DRAFT', label: '초안' },
        ]} />
        {(query || status !== 'ALL') && <button className="button button-small" type="button" onClick={() => { setQuery(''); setStatus('ALL'); setPage(1) }}>필터 초기화</button>}
      </FilterBar>
      {visibleSkus.length > 0 ? <>
        <DataTable minWidth={760}><thead><tr><th>SKU 코드</th><th>모델명</th><th>색상</th><th className="align-center">연결 판매상품</th><th>상태</th><th><span className="sr-only">상세 보기</span></th></tr></thead><tbody>{visibleSkus.map((sku) => {
          const productCount = new Set(data.components.filter((component) => component.skuId === sku.id).map((component) => component.productId)).size
          return <tr key={sku.id}><td className="mono"><strong>{sku.skuCode}</strong></td><td>{sku.modelName}</td><td>{sku.color ?? '-'}</td><td className="align-center"><span className="stat-chip">{productCount}개</span></td><td><StatusBadge status={sku.status} label={sku.status === 'ACTIVE' ? '사용중' : undefined} /></td><td className="align-right"><button className="button button-small" type="button" onClick={() => setSelectedSku(sku)} aria-label={`${sku.skuCode} 연결 판매상품 보기`}>연결 상품 보기</button></td></tr>
        })}</tbody></DataTable>
        <Pagination page={currentPage} total={skus.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </> : <EmptyState title={query || status !== 'ALL' ? '조건에 맞는 SKU가 없습니다.' : '등록된 SKU가 없습니다.'} description={query ? '다른 SKU 코드, 모델명 또는 색상으로 검색해 보세요.' : '필터 조건을 바꾸거나 데이터를 확인해 주세요.'} action={(query || status !== 'ALL') ? <button className="button" type="button" onClick={() => { setQuery(''); setStatus('ALL'); setPage(1) }}>전체 SKU 보기</button> : undefined} />}
    </section>
    {selectedSku && <Drawer title={`${selectedSku.skuCode} · ${selectedSku.modelName}`} subtitle={selectedSku.color ?? '색상 미지정'} onClose={() => setSelectedSku(null)}>
      <div className="info-grid"><div className="info-item"><span>SKU 코드</span><strong className="mono">{selectedSku.skuCode}</strong></div><div className="info-item"><span>모델명</span><strong>{selectedSku.modelName}</strong></div><div className="info-item"><span>색상</span><strong>{selectedSku.color ?? '-'}</strong></div><div className="info-item"><span>상태</span><StatusBadge status={selectedSku.status} /></div></div>
      <h3 className="section-heading">포함 판매상품</h3>
      {linkedProducts.length > 0 ? <DataTable minWidth={520}><thead><tr><th>사방넷 품번</th><th>판매상품</th><th className="align-right">구성 수량</th></tr></thead><tbody>{linkedProducts.map(({ component, product }) => <tr key={component.id}><td><a className="text-link mono" href={`#/products/${product.id}`} onClick={() => setSelectedSku(null)}>{product.sabangnetCode}</a></td><td><a className="text-link" href={`#/products/${product.id}`} onClick={() => setSelectedSku(null)}>{product.productName}</a></td><td className="align-right"><strong>{component.quantity}</strong>개</td></tr>)}</tbody></DataTable> : <EmptyState title="연결된 판매상품이 없습니다." description="이 SKU를 사용하는 BOM이 아직 등록되지 않았습니다." />}
    </Drawer>}
  </>
}
