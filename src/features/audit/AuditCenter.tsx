import { useMemo, useState } from 'react'
import { ChannelBadge, DataTable, Drawer, EmptyState, FilterBar, IssueBadge, PageHeader, SearchInput, SelectField, StatusBadge } from '../../components/ui'
import { formatDate } from '../../lib/selectors'
import type { AuditIssue, IssueStatus, IssueType, SellerData } from '../../types/domain'
import '../channels/operations.css'

const tabs: Array<{ id: string; label: string; types?: IssueType[] }> = [
  { id: 'ALL', label: '전체' }, { id: 'PRICE', label: '가격', types: ['PRICE_MISMATCH'] }, { id: 'MAPPING', label: '매칭', types: ['UNMATCHED', 'DUPLICATE'] },
  { id: 'CHANNEL', label: '채널누락', types: ['MISSING_CHANNEL'] }, { id: 'STATE', label: '상태', types: ['INACTIVE_MISMATCH'] }, { id: 'BOM', label: '구성', types: ['MISSING_BOM'] },
]
const statusOptions = [{ value: 'ALL', label: '처리 상태 전체' }, { value: 'OPEN', label: '미처리' }, { value: 'IN_PROGRESS', label: '확인중' }, { value: 'RESOLVED', label: '해결완료' }, { value: 'IGNORED', label: '제외' }]
const editableStatuses = statusOptions.slice(1)

function initialAuditTab(): string {
  const issueType = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('type') as IssueType | null
  return tabs.find((item) => issueType && item.types?.includes(issueType))?.id ?? 'ALL'
}

export function AuditCenter({ data, onUpdateIssue, readOnly = false }: { data: SellerData; onUpdateIssue: (issueId: string, status: IssueStatus) => Promise<void>; readOnly?: boolean }) {
  const [tab, setTab] = useState(initialAuditTab), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [channelId, setChannelId] = useState('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null), [draftStatus, setDraftStatus] = useState<IssueStatus>('OPEN')
  const [busyId, setBusyId] = useState<string | null>(null), [error, setError] = useState('')
  const selected = data.issues.find((issue) => issue.id === selectedId) ?? null
  const issues = useMemo(() => data.issues.filter((issue) => {
    const activeTab = tabs.find((item) => item.id === tab)
    if (activeTab?.types && !activeTab.types.includes(issue.issueType)) return false
    if (status !== 'ALL' && issue.status !== status) return false
    const listing = data.listings.find((item) => item.id === issue.listingId)
    if (channelId !== 'ALL' && (issue.channelId ?? listing?.channelId) !== channelId) return false
    const product = data.products.find((item) => item.id === issue.productId)
    const channel = data.channels.find((item) => item.id === (issue.channelId ?? listing?.channelId))
    return `${issue.title} ${issue.description} ${product?.productName ?? ''} ${product?.sabangnetCode ?? ''} ${channel?.channelName ?? ''}`.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR'))
  }), [data, tab, query, status, channelId])

  async function update(issue: AuditIssue, nextStatus: IssueStatus, close = false) {
    if (readOnly) return
    setBusyId(issue.id); setError('')
    try { await onUpdateIssue(issue.id, nextStatus); if (close) setSelectedId(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '이슈 상태를 저장하지 못했습니다. 다시 시도해 주세요.') }
    finally { setBusyId(null) }
  }

  return <div className="feature-page audit-page">
    <PageHeader eyebrow="품질 관리" title="감사(Audit) 센터" description={readOnly ? '이슈를 조회합니다. 현재 계정은 읽기 전용입니다.' : '가격, 매칭, 채널 등록, 판매상태, 상품 구성 이슈를 검수합니다.'} />
    <div className="status-summary audit-summary"><span>미처리 <strong>{data.issues.filter((issue) => issue.status === 'OPEN').length}</strong></span><span>확인중 <strong>{data.issues.filter((issue) => issue.status === 'IN_PROGRESS').length}</strong></span><span>해결완료 <strong>{data.issues.filter((issue) => issue.status === 'RESOLVED').length}</strong></span><span>전체 <strong>{data.issues.length}</strong></span></div>
    <section className="panel">
      <div className="tabs" role="tablist" aria-label="이슈 유형">{tabs.map((item) => { const count = data.issues.filter((issue) => !item.types || item.types.includes(issue.issueType)).length; return <button key={item.id} role="tab" aria-selected={tab === item.id} className={`tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>{item.label}<span>{count}</span></button> })}</div>
      <FilterBar><SearchInput value={query} onChange={setQuery} placeholder="상품명, 품번, 이슈 내용 검색" /><SelectField value={status} onChange={setStatus} label="처리 상태" options={statusOptions} /><SelectField value={channelId} onChange={setChannelId} label="채널" options={[{ value: 'ALL', label: '채널 전체' }, ...data.channels.map((channel) => ({ value: channel.id, label: channel.channelName }))]} />{(query || status !== 'ALL' || channelId !== 'ALL') && <button className="button button-small" onClick={() => { setQuery(''); setStatus('ALL'); setChannelId('ALL') }}>필터 초기화</button>}</FilterBar>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {issues.length === 0 ? <EmptyState title="조건에 맞는 이슈가 없습니다" description="검색어 또는 필터를 변경해 보세요." /> : <DataTable minWidth={1040}><thead><tr><th>발견일</th><th>이슈 유형</th><th>상품</th><th>채널</th><th>상세 내용</th><th>심각도</th><th>처리 상태</th><th></th></tr></thead><tbody>{issues.map((issue) => {
        const product = data.products.find((item) => item.id === issue.productId), listing = data.listings.find((item) => item.id === issue.listingId), channel = data.channels.find((item) => item.id === (issue.channelId ?? listing?.channelId))
        return <tr key={issue.id}><td>{formatDate(issue.detectedAt)}</td><td><IssueBadge type={issue.issueType} /></td><td>{product ? <a className="text-link" href={`#/products/${product.id}`}>{product.productName}<small className="mono">{product.sabangnetCode}</small></a> : listing?.productName ?? '-'}</td><td>{channel ? <ChannelBadge channel={channel} compact /> : '-'}</td><td><strong>{issue.title}</strong><small className="muted issue-description">{issue.description}</small></td><td><StatusBadge status={issue.severity} /></td><td>{readOnly ? <StatusBadge status={issue.status} /> : <select className="inline-status-select" aria-label={`${issue.title} 처리 상태`} value={issue.status} disabled={busyId === issue.id} onChange={(event) => update(issue, event.target.value as IssueStatus)}>{editableStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</td><td><button className="button button-small" onClick={() => { setSelectedId(issue.id); setDraftStatus(issue.status); setError('') }}>상세</button></td></tr>
      })}</tbody></DataTable>}
    </section>
    {selected && <IssueDrawer data={data} issue={selected} draftStatus={draftStatus} setDraftStatus={setDraftStatus} busy={busyId === selected.id} error={error} readOnly={readOnly} onClose={() => setSelectedId(null)} onSave={() => update(selected, draftStatus, true)} />}
  </div>
}

function IssueDrawer({ data, issue, draftStatus, setDraftStatus, busy, error, readOnly, onClose, onSave }: { data: SellerData; issue: AuditIssue; draftStatus: IssueStatus; setDraftStatus: (status: IssueStatus) => void; busy: boolean; error: string; readOnly: boolean; onClose: () => void; onSave: () => void }) {
  const product = data.products.find((item) => item.id === issue.productId), listing = data.listings.find((item) => item.id === issue.listingId), channel = data.channels.find((item) => item.id === (issue.channelId ?? listing?.channelId)), offer = data.offers.find((item) => item.id === issue.offerId)
  return <Drawer title={issue.title} subtitle={`발견일 ${formatDate(issue.detectedAt)}`} onClose={onClose}><div className="status-summary"><IssueBadge type={issue.issueType} /><StatusBadge status={issue.severity} /><StatusBadge status={issue.status} /></div>{error && <div className="error-banner" role="alert">{error}</div>}<div className="notice"><strong>검수 내용</strong><p>{issue.description}</p></div><dl className="detail-grid issue-detail-grid"><div><dt>기준 상품</dt><dd>{product ? <a className="text-link" href={`#/products/${product.id}`}>{product.sabangnetCode} {product.productName}</a> : '-'}</dd></div><div><dt>채널</dt><dd>{channel ? <ChannelBadge channel={channel} /> : '-'}</dd></div><div><dt>채널 상품</dt><dd>{listing?.productName ?? '-'}</dd></div><div><dt>채널 상품번호</dt><dd className="mono">{listing?.channelProductId ?? '-'}</dd></div><div><dt>옵션</dt><dd>{offer?.optionName ?? offer?.channelOptionId ?? '-'}</dd></div><div><dt>해결일</dt><dd>{formatDate(issue.resolvedAt)}</dd></div></dl>{!readOnly && <div className="drawer-save"><label><span>처리 상태</span><select value={draftStatus} disabled={busy} onChange={(event) => setDraftStatus(event.target.value as IssueStatus)}>{editableStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button className="button button-primary" disabled={busy || draftStatus === issue.status} onClick={onSave}>{busy ? '저장 중…' : '상태 저장'}</button></div>}</Drawer>
}
