import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SellerData } from '../types/domain'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { Drawer, EmptyState, ProductThumb, SearchInput } from './ui'
import { searchProducts } from '../lib/selectors'

const groups: { label: string; items: { path: string; label: string; icon: IconName }[] }[] = [
  { label: '', items: [{ path: '/dashboard', label: '대시보드', icon: 'dashboard' }] },
  { label: '상품', items: [{ path: '/products', label: '상품 마스터', icon: 'box' }, { path: '/skus', label: 'SKU 관리', icon: 'layers' }] },
  { label: '채널', items: [{ path: '/channels', label: '채널별 상품 현황', icon: 'grid' }] },
  { label: '검수', items: [{ path: '/mapping', label: '매핑 센터', icon: 'link' }, { path: '/audit', label: '검수 센터', icon: 'shield' }] },
  { label: '데이터', items: [{ path: '/import/master', label: '데이터 가져오기', icon: 'layers' }] },
  { label: '설정', items: [{ path: '/settings/channels', label: '판매채널', icon: 'settings' }, { path: '/settings/workspace', label: '워크스페이스', icon: 'layers' }] },
]
function GlobalSearch({ data, onClose }: { data: SellerData; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const results = searchProducts(data, query).slice(0, 12)
  return <Drawer title="통합 상품 검색" subtitle="사방넷 품번, 상품명, SKU, 채널 상품번호로 찾으세요." onClose={onClose}><SearchInput value={query} onChange={setQuery} label="전체 상품 검색" placeholder="예: 100051, AL00, 점보" /><p className="search-hint">{query ? `검색 결과 ${searchProducts(data, query).length}개` : '최근 등록된 판매상품'}</p><div className="global-results">{results.map(p => <a href={`#/products/${p.id}`} onClick={onClose} key={p.id}><ProductThumb name={p.productName} /><span><strong>{p.productName}</strong><span className="small-code">{p.sabangnetCode}</span></span><Icon name="arrow" size={16} /></a>)}</div>{results.length === 0 && <EmptyState title="검색 결과가 없습니다" description="다른 품번이나 SKU 코드를 입력해 보세요." />}</Drawer>
}
export function Layout({ data, route, children }: { data: SellerData; route: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const basePath = route.split('?')[0]
  const current = groups.flatMap(g => g.items).find(i => basePath === i.path || (i.path === '/products' && basePath.startsWith('/products/')))
  const unmatched = data.offers.filter(o => !o.masterProductId).length
  const pending = data.issues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS').length
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true) } if (e.key === 'Escape') setMenuOpen(false) }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [])
  useEffect(() => { document.title = `${current?.label ?? '상품'} · SellerAudit`; document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }); window.scrollTo(0, 0) }, [route, current?.label])
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>본문으로 이동</a>{menuOpen && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}><a className="brand" href="#/dashboard" onClick={() => setMenuOpen(false)}><span className="brand-mark"><Icon name="layers" size={22} /></span><span>Seller<span className="brand-light">Audit</span><small>PRODUCT OPERATIONS</small></span></a><div className="workspace-switch"><span className="workspace-initial">S</span><div><strong>{data.workspace.name}</strong><small>데모 워크스페이스</small></div><span className="demo-dot" /></div><nav className="sidebar-nav" aria-label="주 메뉴">{groups.map(group => <div className="nav-group" key={group.label}>{group.label && <p className="nav-group-label">{group.label}</p>}{group.items.map(item => { const active = basePath === item.path || (item.path === '/products' && basePath.startsWith('/products/')); return <a href={`#${item.path}`} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} key={item.path} onClick={() => setMenuOpen(false)}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.path === '/mapping' && unmatched > 0 && <span className="nav-count">{unmatched}</span>}{item.path === '/audit' && pending > 0 && <span className="nav-count nav-count-alert">{pending}</span>}</a> })}</div>)}</nav><div className="sidebar-bottom"><div className="foundation-note"><Icon name="shield" size={18} /><div><strong>흩어진 상품, 하나의 기준</strong><span>SellerAudit Foundation</span></div></div><a className="profile" href="#/settings/workspace" onClick={() => setMenuOpen(false)}><span className="profile-avatar">MD</span><span><strong>데모 관리자</strong><small>상품 운영팀</small></span><Icon name="settings" size={16} /></a></div></aside>
    <div className="main-shell"><header className="topbar"><button className="icon-button mobile-menu" aria-label="메뉴 열기" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="breadcrumbs"><Icon name="dashboard" size={15} /><span>워크스페이스</span><Icon name="chevron" size={12} /><strong>{current?.label ?? '상품 상세'}</strong></div><button className="global-search-trigger" onClick={() => setSearchOpen(true)}><Icon name="search" size={16} /><span>전체 상품 검색</span><kbd>Ctrl K</kbd></button><div className="topbar-status"><span className="demo-dot" />데모 모드</div><a className="top-avatar" href="#/settings/workspace" aria-label="워크스페이스 정보">MD</a></header><main id="main-content" className="page-content" tabIndex={-1}>{children}</main></div>{searchOpen && <GlobalSearch data={data} onClose={() => setSearchOpen(false)} />}</div>
}
