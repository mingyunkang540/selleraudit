import type { CSSProperties } from 'react'
import {useEffect,useMemo,useState} from 'react'
import type { SellerData } from '../../types/domain'
import { ChannelBadge, DataTable, EmptyState, IssueBadge, KpiCard, PageHeader, StatusBadge } from '../../components/ui'
import { Icon } from '../../components/Icon'
import {matrixStatus,type MatrixProductPrice} from '../channels/matrixStatus'
import type {ConfigurationData} from '../products/configurationTypes'
import {calculateHealth} from './health'
import { formatDateTime, issueLabels } from '../../lib/display'

export function Dashboard({ data,local=false,configurationData=null,configurationError=false }: { data: SellerData;local?:boolean;configurationData?:ConfigurationData|null;configurationError?:boolean }) {
  const [priceData,setPriceData]=useState<MatrixProductPrice[]|null>(null)
  const [priceError,setPriceError]=useState(false)
  useEffect(()=>{if(!local)return;const controller=new AbortController();void fetch('/api/product-prices',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('unavailable');return r.json() as Promise<{products:MatrixProductPrice[];sourceUnavailable?:boolean}>}).then(result=>{setPriceData(result.products);setPriceError(Boolean(result.sourceUnavailable))}).catch(()=>{if(!controller.signal.aborted)setPriceError(true)});return ()=>controller.abort()},[local])
  const prices=useMemo(()=>new Map((priceData??[]).map(row=>[row.productId,row])),[priceData])
  const healthReady=!local||(!priceError&&priceData!==null&&!configurationError&&configurationData!==null)
  const openIssues = data.issues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS')
  const mapped = data.offers.filter(o => o.masterProductId).length
  const mappingRate = data.offers.length ? Math.round(mapped / data.offers.length * 100) : 0
  const health = useMemo(()=>healthReady?calculateHealth(data,local,prices,configurationData):null,[data,local,prices,configurationData,healthReady])
  const summaries = (['PRICE_MISMATCH', 'UNMATCHED', 'MISSING_CHANNEL', 'INACTIVE_MISMATCH'] as const).map(type => ({ type, count: openIssues.filter(i => i.issueType === type).length }))
  const recent = [...data.issues].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)).slice(0, 5)
  const channelRows = data.channels.map(channel => {
    const states = data.products.map(p => matrixStatus(data,p,channel,local,prices,configurationData))
    return { channel, normal: states.filter(s => s === 'NORMAL').length, review: states.filter(s => s === 'REVIEW' || s === 'PRICE_MISMATCH').length, missing: states.filter(s => s === 'MISSING').length }
  })
  return <>
    <PageHeader title="대시보드" description="상품과 채널의 운영 현황을 확인하세요." />
    <section className="kpi-grid" aria-label="주요 지표">
      <KpiCard label="전체 판매상품" value={data.products.length} icon={<Icon name="box" />} detail="상품 마스터 기준" href="#/products" />
      <KpiCard label="등록된 SKU" value={data.skus.length} icon={<Icon name="layers" />} detail="등록된 구성품 코드" href="#/skus" accent="purple" />
      <KpiCard label="채널 상품 페이지" value={data.listings.length} icon={<Icon name="grid" />} detail={`${data.channels.length}개 채널 · ${data.offers.length}개 판매 옵션`} href="#/channels" accent="teal" />
      <KpiCard label="확인 필요한 이슈" value={openIssues.length} icon={<Icon name="shield" />} detail={`미처리 ${data.issues.filter(i => i.status === 'OPEN').length}건 · 확인중 ${data.issues.filter(i => i.status === 'IN_PROGRESS').length}건`} href="#/audit" accent="orange" />
    </section>
    <div className="dashboard-analysis">
      <section className="panel channel-chart-panel"><div className="section-heading"><div><h2>채널별 등록 현황</h2><p>판매상품 기준으로 채널 연결 상태를 비교합니다.</p></div><a className="text-link" href="#/channels">전체 보기<Icon name="chevron" size={14} /></a></div>
        {healthReady ? <><div className="chart-legend"><span><i className="legend-dot green" />정상</span><span><i className="legend-dot orange" />확인 필요 · 가격 이상</span><span><i className="legend-dot gray" />미등록</span></div>
        <div className="bar-chart" role="img" aria-label={channelRows.map(r => `${r.channel.channelName}: 정상 ${r.normal}, 확인 필요 또는 가격 이상 ${r.review}, 미등록 ${r.missing}`).join('. ')}>
          {channelRows.map(r => <div className="bar-chart-row" key={r.channel.id}><ChannelBadge channel={r.channel} /><div className="stacked-bar">{[{ value: r.normal, tone: 'green' }, { value: r.review, tone: 'orange' }, { value: r.missing, tone: 'gray' }].map(s => <span className={`bar-segment ${s.tone}`} key={s.tone} style={{ width: `${data.products.length ? s.value / data.products.length * 100 : 0}%` }} />)}</div><span className="chart-value">{r.normal + r.review}<small> / {data.products.length}</small></span></div>)}
        </div></> : <p className="chart-loading" role={priceError||configurationError ? "alert" : "status"}>{priceError||configurationError ? "가격 또는 구성 정보를 불러오지 못해 채널별 상태를 확인할 수 없습니다." : "가격과 구성 정보를 불러오는 중입니다…"}</p>}
      </section>
      <section className="panel health-panel"><div className="section-heading"><h2>상품 데이터 건강도</h2><span className="subtle-tag">참고 지표</span></div><div className="health-visual"><div className="health-ring" style={{ '--score': `${health?.score??0}%` } as CSSProperties}><div><Icon name="shield" size={23} /><strong>{health?.score??'—'}<small> / 100</small></strong><span>상품 데이터 건강도</span></div></div></div><div className="health-caption">매트릭스와 검수 이슈를 함께 반영합니다.</div><div className="health-stat"><span>판매 옵션 연결률</span><strong>{mappingRate}<small>%</small></strong></div><div className="mini-progress"><span style={{ width: `${mappingRate}%` }} /></div>{health?<p className="health-explanation">매트릭스 가격 이상 {health.mismatchCells}칸 · 확인 필요 {health.reviewCells}칸. 영향을 받는 판매 옵션 {health.affected}개와 연결 대상이 없는 미해결 이슈 {health.standaloneIssues}건을 전체 옵션 {health.total}개에 반영합니다. 같은 옵션은 한 번만 계산합니다.</p>:<p className="health-explanation" role={priceError||configurationError?'alert':undefined}>{priceError||configurationError?'가격 또는 구성 정보를 불러오지 못해 건강도를 계산할 수 없습니다.':'건강도 계산에 필요한 가격과 구성 정보를 불러오는 중입니다.'}</p>}</section>
    </div>
    <section className="action-section"><div className="section-heading"><div className="heading-inline"><h2>오늘 확인할 사항</h2><span className="subtle-tag">미해결 이슈</span></div><a className="text-link" href="#/audit">검수 센터로 이동<Icon name="arrow" size={15} /></a></div><div className="action-grid">{summaries.map(s => <a className="action-card" href={s.type === 'UNMATCHED' ? '#/mapping' : `#/audit?type=${s.type}`} key={s.type}><span className={`action-symbol ${s.type.toLowerCase()}`}><Icon name={s.type === 'UNMATCHED' ? 'link' : s.type === 'MISSING_CHANNEL' ? 'grid' : 'alert'} size={19} /></span><div><span>{issueLabels[s.type]}</span><strong>{s.count}<small>건</small></strong></div><Icon name="chevron" size={16} /></a>)}</div></section>
    <section className="panel recent-panel"><div className="section-heading"><div className="heading-inline"><h2>최근 발견 이슈</h2><span className="count-pill">{data.issues.length}</span></div><a className="text-link" href="#/audit">전체 보기<Icon name="chevron" size={14} /></a></div>{recent.length ? <DataTable><thead><tr><th>발견일시</th><th>이슈 유형</th><th>판매상품</th><th>채널</th><th>상세 내용</th><th>처리 상태</th></tr></thead><tbody>{recent.map(issue => {
      const product = data.products.find(p => p.id === issue.productId)
      const listing = data.listings.find(l => l.id === issue.listingId)
      const channel = data.channels.find(c => c.id === (issue.channelId ?? listing?.channelId))
      return <tr key={issue.id}><td className="muted nowrap">{formatDateTime(issue.detectedAt)}</td><td><IssueBadge type={issue.issueType} /></td><td>{product ? <a className="product-name-link" href={`#/products/${product.id}`}>{product.productName}<span className="small-code">{product.sabangnetCode}</span></a> : <span className="muted">연결되지 않은 상품</span>}</td><td>{channel ? <ChannelBadge channel={channel} /> : <span className="muted">—</span>}</td><td className="description-cell">{issue.description}</td><td><StatusBadge status={issue.status} /></td></tr>
    })}</tbody></DataTable> : <EmptyState title="발견된 이슈가 없습니다" description="상품 이슈가 발견되면 이곳에서 확인할 수 있습니다." />}</section>
  </>
}
