import type { CSSProperties } from 'react'
import type { SellerData } from '../../types/domain'
import { ChannelBadge, DataTable, EmptyState, IssueBadge, KpiCard, PageHeader, StatusBadge } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { getCellStatus } from '../../lib/selectors'
import { formatDateTime, issueLabels } from '../../lib/display'

export function Dashboard({ data }: { data: SellerData }) {
  const openIssues = data.issues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS')
  const mapped = data.offers.filter(o => o.masterProductId).length
  const mappingRate = data.offers.length ? Math.round(mapped / data.offers.length * 100) : 0
  const health = data.offers.length ? Math.max(0, Math.round((data.offers.length - openIssues.length) / data.offers.length * 100)) : 0
  const summaries = (['PRICE_MISMATCH', 'UNMATCHED', 'MISSING_CHANNEL', 'INACTIVE_MISMATCH'] as const).map(type => ({ type, count: openIssues.filter(i => i.issueType === type).length }))
  const recent = [...data.issues].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)).slice(0, 5)
  const channelRows = data.channels.map(channel => {
    const states = data.products.map(p => getCellStatus(data, p.id, channel.id))
    return { channel, normal: states.filter(s => s === 'NORMAL').length, review: states.filter(s => s === 'REVIEW' || s === 'PRICE_MISMATCH').length, missing: states.filter(s => s === 'MISSING').length }
  })
  return <>
    <PageHeader eyebrow="WORKSPACE OVERVIEW" title="대시보드" description="흩어진 상품 데이터를 한눈에. 오늘 확인할 사항을 살펴보세요." actions={<a className="button button-primary" href="#/mapping"><Icon name="link" size={16} />미매칭 확인하기<Icon name="arrow" size={16} /></a>} />
    <div className="overview-note"><span className="live-dot" />데모 워크스페이스의 상품 운영 현황<span className="overview-date">샘플 데이터 · 2026.10.09 기준</span></div>
    <section className="kpi-grid" aria-label="주요 지표">
      <KpiCard label="전체 판매상품" value={data.products.length} icon={<Icon name="box" />} detail="사방넷 품번 기준" href="#/products" />
      <KpiCard label="실물 SKU" value={data.skus.length} icon={<Icon name="layers" />} detail="물류 · 재고의 최소 단위" href="#/skus" accent="purple" />
      <KpiCard label="채널 등록 상품" value={data.listings.length} icon={<Icon name="grid" />} detail={`${data.channels.length}개 채널 · ${data.offers.length}개 판매 옵션`} href="#/channels" accent="teal" />
      <KpiCard label="확인 필요한 이슈" value={openIssues.length} icon={<Icon name="shield" />} detail={`미처리 ${data.issues.filter(i => i.status === 'OPEN').length}건 · 확인중 ${data.issues.filter(i => i.status === 'IN_PROGRESS').length}건`} href="#/audit" accent="orange" />
    </section>
    <div className="dashboard-analysis">
      <section className="panel channel-chart-panel"><div className="section-heading"><div><h2>채널별 등록 현황</h2><p>판매상품 기준으로 채널 연결 상태를 비교합니다.</p></div><a className="text-link" href="#/channels">전체 보기<Icon name="chevron" size={14} /></a></div>
        <div className="chart-legend"><span><i className="legend-dot green" />정상</span><span><i className="legend-dot orange" />확인필요</span><span><i className="legend-dot gray" />미등록</span></div>
        <div className="bar-chart" role="img" aria-label={channelRows.map(r => `${r.channel.channelName}: 정상 ${r.normal}, 확인필요 ${r.review}, 미등록 ${r.missing}`).join('. ')}>
          {channelRows.map(r => <div className="bar-chart-row" key={r.channel.id}><ChannelBadge channel={r.channel} /><div className="stacked-bar">{[{ value: r.normal, tone: 'green' }, { value: r.review, tone: 'orange' }, { value: r.missing, tone: 'gray' }].map(s => <span className={`bar-segment ${s.tone}`} key={s.tone} style={{ width: `${data.products.length ? s.value / data.products.length * 100 : 0}%` }} />)}</div><span className="chart-value">{r.normal + r.review}<small> / {data.products.length}</small></span></div>)}
        </div><div className="chart-footnote"><Icon name="clock" size={14} />등록 상태는 샘플 데이터와 저장된 검수 이슈를 반영합니다.</div>
      </section>
      <section className="panel health-panel"><div className="section-heading"><h2>상품 데이터 건강도</h2><span className="subtle-tag">데모 지표</span></div><div className="health-visual"><div className="health-ring" style={{ '--score': `${health}%` } as CSSProperties}><div><Icon name="shield" size={23} /><strong>{health}<small> / 100</small></strong><span>상품 데이터 건강도</span></div></div></div><div className="health-caption">작은 확인이 더 정확한 데이터를 만듭니다.</div><div className="health-stat"><span>상품 연결률</span><strong>{mappingRate}<small>%</small></strong></div><div className="mini-progress"><span style={{ width: `${mappingRate}%` }} /></div><p className="health-explanation">건강도는 전체 옵션 대비 미해결 이슈 수를 이용한 데모 지표입니다.</p></section>
    </div>
    <section className="action-section"><div className="section-heading"><div className="heading-inline"><h2>오늘 확인할 사항</h2><span className="subtle-tag">미해결 이슈</span></div><a className="text-link" href="#/audit">검수 센터로 이동<Icon name="arrow" size={15} /></a></div><div className="action-grid">{summaries.map(s => <a className="action-card" href={s.type === 'UNMATCHED' ? '#/mapping' : `#/audit?type=${s.type}`} key={s.type}><span className={`action-symbol ${s.type.toLowerCase()}`}><Icon name={s.type === 'UNMATCHED' ? 'link' : s.type === 'MISSING_CHANNEL' ? 'grid' : 'alert'} size={19} /></span><div><span>{issueLabels[s.type]}</span><strong>{s.count}<small>건</small></strong></div><Icon name="chevron" size={16} /></a>)}</div></section>
    <section className="panel recent-panel"><div className="section-heading"><div className="heading-inline"><h2>최근 발견 이슈</h2><span className="count-pill">{data.issues.length}</span></div><a className="text-link" href="#/audit">전체 보기<Icon name="chevron" size={14} /></a></div>{recent.length ? <DataTable><thead><tr><th>발견일시</th><th>이슈 유형</th><th>판매상품</th><th>채널</th><th>상세 내용</th><th>처리 상태</th></tr></thead><tbody>{recent.map(issue => {
      const product = data.products.find(p => p.id === issue.productId)
      const listing = data.listings.find(l => l.id === issue.listingId)
      const channel = data.channels.find(c => c.id === (issue.channelId ?? listing?.channelId))
      return <tr key={issue.id}><td className="muted nowrap">{formatDateTime(issue.detectedAt)}</td><td><IssueBadge type={issue.issueType} /></td><td>{product ? <a className="product-name-link" href={`#/products/${product.id}`}>{product.productName}<span className="small-code">{product.sabangnetCode}</span></a> : <span className="muted">연결되지 않은 상품</span>}</td><td>{channel ? <ChannelBadge channel={channel} /> : <span className="muted">—</span>}</td><td className="description-cell">{issue.description}</td><td><StatusBadge status={issue.status} /></td></tr>
    })}</tbody></DataTable> : <EmptyState title="발견된 이슈가 없습니다" description="상품 이슈가 발견되면 이곳에서 확인할 수 있습니다." />}</section>
    <footer className="page-footer"><span>하나의 상품, 하나의 기준.</span><span>SellerAudit Foundation · v0.1</span></footer>
  </>
}
