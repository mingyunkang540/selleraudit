import { useCallback, useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { EmptyState, PageHeader } from './components/ui'
import { Icon } from './components/Icon'
import { Dashboard } from './features/dashboard/Dashboard'
import { ProductDetail, ProductMaster } from './features/products'
import { SkuMaster } from './features/skus'
import { ChannelMatrix } from './features/channels'
import { MappingCenter } from './features/mapping'
import { AuditCenter } from './features/audit'
import { MasterImport } from './features/import/MasterImport'
import { Settings } from './pages/Settings'
import { useRoute } from './hooks/useRoute'
import { createMockRepository } from './services/mockRepository'
import type { IssueStatus, SellerData } from './types/domain'

// Resolve browser storage inside each operation so unavailable storage reaches the error UI.
const repository = {
  load: () => createMockRepository().load(),
  mapOffer: (offerId: string, productId: string) => createMockRepository().mapOffer(offerId, productId),
  updateIssueStatus: (issueId: string, status: IssueStatus) => createMockRepository().updateIssueStatus(issueId, status),
}
export default function App() {
  const [data, setData] = useState<SellerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const route = useRoute()
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setData(await repository.load()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => repository.load()).then(next => { if (active) { setData(next); setLoading(false) } }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : '데이터를 불러오지 못했습니다.'); setLoading(false) } })
    const onStorage = (event: StorageEvent) => { if (event.key?.startsWith('seller-audit:') || event.key === null) void refresh() }
    window.addEventListener('storage', onStorage)
    return () => { active = false; window.removeEventListener('storage', onStorage) }
  }, [refresh])
  if (loading && !data) return <div className="app-loading" role="status"><span className="loading-logo"><Icon name="layers" size={28} /></span><h1>SellerAudit</h1><p>상품 데이터를 불러오고 있습니다…</p><span className="loading-bar" /></div>
  if (error || !data) return <div className="app-error"><Icon name="alert" size={36} /><h1>데이터를 불러오지 못했습니다</h1><p role="alert">{error ?? '저장된 데이터를 확인해 주세요.'}</p><p className="muted">브라우저 저장소 사용 여부를 확인해 주세요. 기존 데이터는 자동으로 삭제하지 않습니다.</p><button className="button button-primary" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" size={16} />{loading ? '확인 중…' : '다시 시도'}</button></div>
  const path = route.split('?')[0]
  const onMap = async (offerId: string, productId: string) => { const next = await repository.mapOffer(offerId, productId); setData(next) }
  const onUpdateIssue = async (issueId: string, status: IssueStatus) => { const next = await repository.updateIssueStatus(issueId, status); setData(next) }
  let page
  if (path === '/dashboard' || path === '/') page = <Dashboard data={data} />
  else if (path === '/products') page = <ProductMaster data={data} />
  else if (path.startsWith('/products/')) page = <ProductDetail key={path} data={data} productId={path.slice('/products/'.length)} />
  else if (path === '/skus') page = <SkuMaster data={data} />
  else if (path === '/channels') page = <ChannelMatrix data={data} />
  else if (path === '/mapping') page = <MappingCenter data={data} onMap={onMap} />
  else if (path === '/audit') page = <AuditCenter key={route} data={data} onUpdateIssue={onUpdateIssue} />
  else if (path === '/import/master') page = <MasterImport />
  else if (path === '/settings/channels' || path === '/settings/workspace') page = <Settings data={data} section={path.split('/')[2]} />
  else page = <><PageHeader title="페이지를 찾을 수 없습니다" description="주소를 확인하거나 대시보드로 이동해 주세요." /><div className="panel"><EmptyState title="요청한 페이지가 없습니다" action={<a className="button button-primary" href="#/dashboard">대시보드로 이동</a>} /></div></>
  return <Layout data={data} route={route}>{page}</Layout>
}
