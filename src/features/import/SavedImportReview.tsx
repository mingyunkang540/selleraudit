import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DataTable, Drawer, EmptyState, StatusBadge } from '../../components/ui'
import type { ImportPersistence, SavedImportBatch, SavedImportCandidate, SavedImportIssue, SavedImportSource, SavedRawImportRow } from '../../services/importPersistence'

type ReviewRole = 'ADMIN' | 'EDITOR'
type CandidateKindFilter = 'ALL' | SavedImportCandidate['kind']
type CandidateStateFilter = 'ALL' | SavedImportCandidate['candidateStatus'] | 'REVIEWED' | 'UNREVIEWED'
type IssueReviewStatus = 'OPEN' | 'RESOLVED' | 'ACKNOWLEDGED' | 'DEFERRED'

const PAGE_SIZE = 25
const count = (value: number) => value.toLocaleString('ko-KR')
const source = (sheet: string, row: number | null) => `${sheet} / ${row === null ? '전체' : `${row}행`}`
const observed = (value: unknown) => value === null || value === undefined || value === '' ? '—' : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)
const kindLabel: Record<SavedImportCandidate['kind'], string> = { PRODUCT: 'Product', SKU: 'SKU', BOM_COMPONENT: 'BOM' }
const statusLabel: Record<string, string> = { VALID: '정상', WARNING: '주의', ERROR: '오류', DEFERRED: '보류', OPEN: '미처리', RESOLVED: '해결', ACKNOWLEDGED: '확인' }
const issueStatusOptions: { value: IssueReviewStatus; label: string }[] = [
  { value: 'RESOLVED', label: '해결' }, { value: 'ACKNOWLEDGED', label: '확인' },
  { value: 'DEFERRED', label: '보류' }, { value: 'OPEN', label: '다시 열기' },
]
const reviewFields: Record<SavedImportCandidate['kind'], readonly string[]> = {
  PRODUCT: ['sabangnetCode', 'productName', 'category', 'productType', 'rawBomText', 'sourceQuantity', 'sourceChannel'],
  SKU: ['skuCode', 'modelName', 'color', 'sourceCategory'],
  BOM_COMPONENT: ['skuCode', 'quantity'],
}
type ReviewFieldMode = 'inherit' | 'value' | 'clear'
const nullableReviewField = (kind: SavedImportCandidate['kind'], key: string) =>
  kind === 'PRODUCT' || (kind === 'SKU' && key !== 'skuCode')
const fieldLabel: Record<string, string> = {
  sabangnetCode: '사방넷 품번', productName: '상품명', category: '카테고리', productType: '상품 구분', rawBomText: '원본 BOM 문자열',
  sourceQuantity: '원본 수량', sourceChannel: '원본 채널', skuCode: 'SKU 코드', modelName: '모델명', color: '색상', sourceCategory: '원본 카테고리', quantity: '수량',
}

function candidateBusinessKey(candidate: SavedImportCandidate): string {
  const values = candidate.normalizedValues
  if (candidate.kind === 'PRODUCT') return observed(values.sabangnetCode)
  if (candidate.kind === 'SKU') return observed(values.skuCode)
  return `${observed(values.productCode)} / ${observed(values.skuCode)}`
}

function candidateName(candidate: SavedImportCandidate): string {
  const values = candidate.normalizedValues
  if (candidate.kind === 'PRODUCT') return observed(values.productName)
  if (candidate.kind === 'SKU') return observed(values.modelName)
  return `수량 ${observed(values.quantity)}`
}

function ValueList({ values, empty }: { values: Record<string, unknown> | null; empty: string }) {
  if (!values || Object.keys(values).length === 0) return <p className="muted import-review-empty">{empty}</p>
  return <dl className="import-review-values">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{fieldLabel[key] ?? key}</dt><dd>{observed(value)}</dd></div>)}</dl>
}

function RawEvidence({ rawRow, loading, error }: { rawRow: SavedRawImportRow | null; loading: boolean; error: string | null }) {
  if (loading) return <p className="muted" role="status">원본 행을 불러오는 중입니다…</p>
  if (error) return <p className="import-error" role="alert">{error}</p>
  if (!rawRow) return <p className="muted">연결된 원본 행이 없습니다.</p>
  return <><p className="import-raw-source">{rawRow.sourceSheet} / {rawRow.originalRowNumber}행 · {rawRow.sourceBlock ?? '구분 없음'}</p><dl className="import-raw-cells">{rawRow.rawCells.map(cell => <div key={cell.address}><dt>{cell.address} · {cell.originalType}</dt><dd>{String(cell.originalValue ?? cell.cachedValue ?? '빈 값')}{cell.formulaText && <small>수식: {cell.formulaText}</small>}{cell.errorCode && <small>오류: {cell.errorCode}</small>}</dd></div>)}</dl></>
}

function CandidateDetail({ candidate, issues, rawRow, loadingRaw, rawError, role, saving, saveError, onSave, onClose }: {
  candidate: SavedImportCandidate; issues: readonly SavedImportIssue[]; rawRow: SavedRawImportRow | null; loadingRaw: boolean; rawError: string | null
  role: ReviewRole; saving: boolean; saveError: string | null; onSave: (values: Record<string, unknown>, resolution: string) => Promise<void>; onClose: () => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(reviewFields[candidate.kind].map(key => [key, candidate.reviewedValues?.[key] == null ? '' : String(candidate.reviewedValues[key])])))
  const [modes, setModes] = useState<Record<string, ReviewFieldMode>>(() => Object.fromEntries(reviewFields[candidate.kind].map(key => [key,
    !candidate.reviewedValues || !Object.hasOwn(candidate.reviewedValues, key) ? 'inherit' : candidate.reviewedValues[key] === null ? 'clear' : 'value',
  ])))
  const [resolution, setResolution] = useState(candidate.reviewNote ?? '')
  const relatedIssues = issues.filter(issue => candidate.issueCodes.includes(issue.issueCode) || issue.rawImportRowId === candidate.rawImportRowId || issue.relatedRawRowIds.includes(candidate.rawImportRowId))
  const buildValues = () => Object.fromEntries(reviewFields[candidate.kind].flatMap<[string, unknown]>(key => {
    if (modes[key] === 'inherit') return []
    if (modes[key] === 'clear') return [[key, null]]
    const value = draft[key]?.trim() ?? ''
    if (!value) return []
    if (key === 'quantity' || key === 'sourceQuantity') { const parsed = Number(value); return [[key, Number.isFinite(parsed) ? parsed : value]] }
    return [[key, value]]
  }))
  const nextValues = buildValues()
  const priorValues = candidate.reviewedValues ?? {}
  const changed = candidate.reviewedValues === null || Object.keys(nextValues).length !== Object.keys(priorValues).length ||
    Object.entries(nextValues).some(([key, value]) => !Object.hasOwn(priorValues, key) || priorValues[key] !== value) ||
    resolution.trim() !== (candidate.reviewNote ?? '')

  return <Drawer title={`${kindLabel[candidate.kind]} 후보`} subtitle={`${source(candidate.sourceSheet, candidate.sourceRow)} · ${candidateBusinessKey(candidate)}`} onClose={onClose}>
    <div className="import-review-notice"><strong>검토값은 별도 override로 기록됩니다.</strong><span>검토값을 저장해도 마스터 데이터에는 반영되지 않습니다. Batch는 계속 REVIEW_REQUIRED 상태입니다.</span></div>
    <section className="import-review-section"><h3>원본 증거</h3><RawEvidence rawRow={rawRow} loading={loadingRaw} error={rawError} /></section>
    <section className="import-review-section"><h3>Parser 정규화 값</h3><p className="import-review-caption">저장 당시 parser 결과이며 검토값으로 덮어쓰지 않습니다.</p><ValueList values={candidate.normalizedValues} empty="정규화 값이 없습니다." /></section>
    <section className="import-review-section"><div className="import-review-heading"><h3>사람의 검토값</h3><StatusBadge status={candidate.reviewedValues ? 'RESOLVED' : 'OPEN'} label={candidate.reviewedValues ? `검토됨 · r${candidate.reviewRevision}` : '미검토'} /></div>
      {role === 'ADMIN' ? <div className="import-review-form">{reviewFields[candidate.kind].map(key => <div className="import-review-field" key={key}><label><span>{fieldLabel[key] ?? key}</span><input type={key === 'quantity' || key === 'sourceQuantity' ? 'number' : 'text'} step={key === 'quantity' || key === 'sourceQuantity' ? 'any' : undefined} value={draft[key] ?? ''} disabled={saving || modes[key] === 'clear'} placeholder={`Parser 값: ${observed(candidate.normalizedValues[key])}`} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setModes(current => ({ ...current, [key]: event.target.value.trim() ? 'value' : 'inherit' })) }} /></label><select aria-label={`${fieldLabel[key] ?? key} 검토 방식`} value={modes[key]} disabled={saving} onChange={event => setModes(current => ({ ...current, [key]: event.target.value as ReviewFieldMode }))}><option value="inherit">Parser 값 유지</option><option value="value">검토값 입력</option>{nullableReviewField(candidate.kind, key) && <option value="clear">값 비우기 (null)</option>}</select></div>)}<label className="import-review-note"><span>검토 근거</span><textarea value={resolution} disabled={saving} onChange={event => setResolution(event.target.value)} placeholder="원본 소유자 확인 등 검토 근거를 입력하세요." /></label>{saveError && <p className="import-error" role="alert">{saveError}</p>}<button className="button button-primary" type="button" disabled={saving || !changed || !resolution.trim() || reviewFields[candidate.kind].some(key => modes[key] === 'value' && !draft[key]?.trim())} onClick={() => void onSave(buildValues(), resolution.trim())}>{saving ? '저장 중…' : '검토 저장'}</button></div> : <><ValueList values={candidate.reviewedValues} empty="기록된 검토값이 없습니다." />{candidate.reviewNote && <p className="import-resolution"><strong>검토 근거</strong>{candidate.reviewNote}</p>}<p className="import-readonly-note">EDITOR는 검토 내용을 조회할 수 있으며 변경할 수 없습니다.</p></>}
    </section>
    <section className="import-review-section"><h3>관련 이슈</h3>{relatedIssues.length ? <ul className="import-related-candidates">{relatedIssues.map(issue => <li key={issue.id}><span><strong className="mono">{issue.issueCode}</strong> · {issue.message}</span><StatusBadge status={issue.status} label={statusLabel[issue.status] ?? issue.status} /></li>)}</ul> : <p className="muted">연결된 검증 이슈가 없습니다.</p>}</section>
  </Drawer>
}

function IssueDetail({ issue, rawRow, loading, error, role, saving, saveError, onSave, onClose }: {
  issue: SavedImportIssue; rawRow: SavedRawImportRow | null; loading: boolean; error: string | null; role: ReviewRole; saving: boolean; saveError: string | null
  onSave: (status: IssueReviewStatus, resolution: string | null) => Promise<void>; onClose: () => void
}) {
  const [draftStatus, setDraftStatus] = useState<IssueReviewStatus>(issue.status as IssueReviewStatus)
  const [resolution, setResolution] = useState(issue.resolution ?? '')
  const resolutionRequired = draftStatus !== 'OPEN'
  const changed = draftStatus !== issue.status || (draftStatus === 'OPEN' ? issue.resolution !== null : resolution.trim() !== (issue.resolution ?? ''))
  return <Drawer title={issue.issueCode} subtitle={source(issue.sourceSheet ?? '전체', issue.sourceRow)} onClose={onClose}>
    <dl className="import-issue-detail"><dt>차단 범위</dt><dd>{issue.blockingScope}</dd><dt>원본 값</dt><dd>{observed(issue.observedValue)}</dd><dt>기대 규칙</dt><dd>{issue.expectedRule}</dd><dt>설명</dt><dd>{issue.message}</dd><dt>상태</dt><dd><StatusBadge status={issue.status} label={statusLabel[issue.status] ?? issue.status} /></dd><dt>관련 원본 행</dt><dd>{issue.relatedRawRowIds.length ? `${count(issue.relatedRawRowIds.length)}건` : '—'}</dd></dl>
    {issue.resolution && <p className="import-resolution"><strong>Resolution</strong>{issue.resolution}</p>}
    <section className="import-review-section"><h3>저장된 원본 행</h3><RawEvidence rawRow={rawRow} loading={loading} error={error} /></section>
    {role === 'ADMIN' ? <section className="import-review-section"><h3>이슈 검토 결정</h3><div className="import-review-form"><label><span>처리 상태</span><select value={draftStatus} disabled={saving} onChange={event => setDraftStatus(event.target.value as IssueReviewStatus)}>{issueStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="import-review-note"><span>처리 근거{resolutionRequired ? ' (필수)' : ''}</span><textarea value={resolution} disabled={saving || draftStatus === 'OPEN'} onChange={event => setResolution(event.target.value)} placeholder="확인한 근거와 결정 내용을 입력하세요." /></label>{saveError && <p className="import-error" role="alert">{saveError}</p>}<button className="button button-primary" type="button" disabled={saving || !changed || (resolutionRequired && !resolution.trim())} onClick={() => void onSave(draftStatus, draftStatus === 'OPEN' ? null : resolution.trim())}>{saving ? '저장 중…' : '이슈 결정 저장'}</button></div><p className="import-readonly-note">이슈를 해결해도 Candidate가 VALID가 되거나 Batch가 적용 가능 상태로 바뀌지 않습니다.</p></section> : <p className="import-readonly-note">EDITOR는 이슈 상태와 처리 근거를 조회할 수 있으며 변경할 수 없습니다.</p>}
  </Drawer>
}

export function SavedImportReview({ persistence, refreshKey, role }: { persistence: ImportPersistence; refreshKey: number; role: ReviewRole }) {
  const batchRequest = useRef(0)
  const rawRequest = useRef(0)
  const selection = useRef({ batchId: null as string | null, version: 0 })
  const [batches, setBatches] = useState<readonly SavedImportBatch[]>([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<SavedImportBatch | null>(null)
  const [selectedSource, setSelectedSource] = useState<SavedImportSource | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [candidates, setCandidates] = useState<readonly SavedImportCandidate[]>([])
  const [issues, setIssues] = useState<readonly SavedImportIssue[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<CandidateKindFilter>('ALL')
  const [stateFilter, setStateFilter] = useState<CandidateStateFilter>('ALL')
  const [candidatePage, setCandidatePage] = useState(1)
  const [selectedCandidate, setSelectedCandidate] = useState<SavedImportCandidate | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<SavedImportIssue | null>(null)
  const [rawRow, setRawRow] = useState<SavedRawImportRow | null>(null)
  const [loadingRaw, setLoadingRaw] = useState(false)
  const [rawError, setRawError] = useState<string | null>(null)
  const [savingReview, setSavingReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const loadDetails = useCallback(async (batch: SavedImportBatch) => {
    const currentRequest = ++batchRequest.current
    setLoadingDetails(true); setDetailError(null)
    try {
      const [nextCandidates, nextIssues] = await Promise.all([persistence.loadSavedImportCandidates(batch.id), persistence.loadSavedImportIssues(batch.id)])
      if (currentRequest === batchRequest.current) { setCandidates(nextCandidates); setIssues(nextIssues) }
    } catch { if (currentRequest === batchRequest.current) setDetailError('저장된 후보와 검증 이슈를 불러오지 못했습니다.') }
    finally { if (currentRequest === batchRequest.current) setLoadingDetails(false) }
  }, [persistence])

  const openBatch = useCallback(async (batch: SavedImportBatch) => {
    selection.current = { batchId: batch.id, version: selection.current.version + 1 }
    ++rawRequest.current
    setSelectedBatch(batch); setSelectedSource(null); setSourceError(null); setCandidates([]); setIssues([]); setKindFilter('ALL'); setStateFilter('ALL'); setCandidatePage(1); setSelectedCandidate(null); setSelectedIssue(null); setRawRow(null); setReviewError(null)
    await Promise.all([loadDetails(batch), batch.sourceFileId ? persistence.loadSourceFile(batch.sourceFileId)
      .then(next => { if (selection.current.batchId === batch.id) setSelectedSource(next) })
      .catch(() => { if (selection.current.batchId === batch.id) setSourceError('원본 파일 검증 정보를 불러오지 못했습니다.') }) : Promise.resolve()])
  }, [loadDetails, persistence])

  const downloadSource = async () => {
    if (!selectedBatch?.sourceFileId || selectedSource?.verificationStatus !== 'VERIFIED') return
    setDownloading(true); setSourceError(null)
    try {
      const url = await persistence.createSourceDownloadUrl(selectedBatch.sourceFileId)
      const link = document.createElement('a')
      link.href = url
      link.rel = 'noopener noreferrer'
      link.click()
    } catch { setSourceError('원본 파일 확인 링크를 만들지 못했습니다.') }
    finally { setDownloading(false) }
  }

  const openRaw = async (rowId: string | null) => {
    const currentRequest = ++rawRequest.current
    setRawRow(null); setRawError(null)
    if (!rowId) { setLoadingRaw(false); return }
    setLoadingRaw(true)
    try { const next = await persistence.loadRawImportRow(rowId); if (currentRequest === rawRequest.current) setRawRow(next) }
    catch { if (currentRequest === rawRequest.current) setRawError('연결된 원본 행을 불러오지 못했습니다.') }
    finally { if (currentRequest === rawRequest.current) setLoadingRaw(false) }
  }
  const openCandidate = (candidate: SavedImportCandidate) => { ++selection.current.version; setSelectedIssue(null); setSelectedCandidate(candidate); setReviewError(null); void openRaw(candidate.rawImportRowId) }
  const openIssue = (issue: SavedImportIssue) => { ++selection.current.version; setSelectedCandidate(null); setSelectedIssue(issue); setReviewError(null); void openRaw(issue.rawImportRowId) }
  const closeDrawer = () => { ++selection.current.version; ++rawRequest.current; setSelectedCandidate(null); setSelectedIssue(null); setRawRow(null); setRawError(null); setReviewError(null) }

  const saveCandidate = async (values: Record<string, unknown>, resolution: string) => {
    if (!selectedCandidate || !selectedBatch) return
    const batch = selectedBatch
    const { batchId, version } = selection.current
    setSavingReview(true); setReviewError(null)
    try {
      await persistence.reviewCandidate(selectedCandidate.id, selectedCandidate.validationRevision, selectedCandidate.reviewRevision, values, resolution)
      if (selection.current.batchId !== batchId) return
      if (selection.current.version === version) closeDrawer()
      await loadDetails(batch)
    } catch { if (selection.current.batchId === batchId && selection.current.version === version) setReviewError('검토값을 저장하지 못했습니다. 다른 관리자의 변경 여부를 확인한 뒤 다시 시도해 주세요.') }
    finally { setSavingReview(false) }
  }
  const saveIssue = async (status: IssueReviewStatus, resolution: string | null) => {
    if (!selectedIssue || !selectedBatch) return
    const batch = selectedBatch
    const { batchId, version } = selection.current
    setSavingReview(true); setReviewError(null)
    try {
      await persistence.reviewIssue(selectedIssue.id, selectedIssue.validationRevision, selectedIssue.reviewRevision, status, resolution)
      if (selection.current.batchId !== batchId) return
      if (selection.current.version === version) closeDrawer()
      await loadDetails(batch)
    } catch { if (selection.current.batchId === batchId && selection.current.version === version) setReviewError('이슈 결정을 저장하지 못했습니다. 다른 관리자의 변경 여부를 확인한 뒤 다시 시도해 주세요.') }
    finally { setSavingReview(false) }
  }

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (!active) return null; setLoadingBatches(true); setHistoryError(null); return persistence.listSavedMasterImports() })
      .then(next => { if (active && next) setBatches(next) })
      .catch(() => { if (active) setHistoryError('최근 저장된 Master 검증을 불러오지 못했습니다.') })
      .finally(() => { if (active) setLoadingBatches(false) })
    return () => { active = false }
  }, [persistence, refreshKey])

  const filteredCandidates = useMemo(() => candidates.filter(candidate => (kindFilter === 'ALL' || candidate.kind === kindFilter) && (stateFilter === 'ALL' || candidate.candidateStatus === stateFilter || (stateFilter === 'REVIEWED' && candidate.reviewedValues !== null) || (stateFilter === 'UNREVIEWED' && candidate.reviewedValues === null))), [candidates, kindFilter, stateFilter])
  const visibleCandidates = filteredCandidates.slice((candidatePage - 1) * PAGE_SIZE, candidatePage * PAGE_SIZE)
  const candidateTotal = selectedBatch ? selectedBatch.productCount + selectedBatch.skuCount + selectedBatch.bomCount : 0
  const legacyBatch = Boolean(selectedBatch && !loadingDetails && !detailError && candidateTotal > 0 && candidates.length === 0)
  const verifiedSource = selectedBatch?.sourceHashVerification === 'SERVER_VERIFIED' &&
    selectedSource?.verificationStatus === 'VERIFIED' && selectedSource.serverSha256 === selectedBatch.sourceHash
  const reviewRole: ReviewRole = role === 'ADMIN' && verifiedSource ? 'ADMIN' : 'EDITOR'

  return <section className="panel import-saved" aria-label="최근 저장된 Master 검증">
    <div className="section-heading"><div><h2>최근 저장된 Master 검증</h2><p>현재 워크스페이스에 저장된 최근 20개 Dry-run 결과입니다.</p></div><span className="subtle-tag">SHARED REVIEW</span></div>
    {loadingBatches && <p className="import-section-state" role="status">저장 이력을 불러오는 중입니다…</p>}
    {historyError && <p className="import-error import-section-state" role="alert">{historyError}</p>}
    {!loadingBatches && !historyError && !batches.length && <EmptyState title="저장된 검증 결과가 없습니다" description="Master Excel을 분석한 뒤 검증 결과를 저장하면 여기에 표시됩니다." />}
    {!loadingBatches && !historyError && batches.length > 0 && <DataTable minWidth={980}><thead><tr><th>저장 시각</th><th>파일명</th><th>상태</th><th>원본 행</th><th>Product / SKU / BOM</th><th>정상</th><th>주의</th><th>오류</th><th>보류</th><th>상세</th></tr></thead><tbody>{batches.map(batch => <tr key={batch.id}><td>{new Date(batch.createdAt).toLocaleString('ko-KR')}</td><td>{batch.sourceFilename}</td><td><StatusBadge status={batch.status} /></td><td>{count(batch.rowCount)}</td><td>{count(batch.productCount)} / {count(batch.skuCount)} / {count(batch.bomCount)}</td><td>{count(batch.validCount)}</td><td>{count(batch.warningCount)}</td><td>{count(batch.errorCount)}</td><td>{count(batch.deferredCount)}</td><td><button className="button button-small" type="button" aria-label={`${batch.sourceFilename} 배치 상세 보기`} onClick={() => void openBatch(batch)}>상세</button></td></tr>)}</tbody></DataTable>}
    {selectedBatch && <section className="import-saved-detail" aria-label="저장된 Batch 상세">
      <div className="section-heading"><div><h3>저장된 Batch 상세</h3><p className="mono">Batch ID: {selectedBatch.id} · Validation r{selectedBatch.validationRevision}</p></div><StatusBadge status={selectedBatch.status} /></div>
      <dl className="import-batch-meta"><div><dt>파일명</dt><dd>{selectedBatch.sourceFilename}</dd></div><div><dt>저장 시각</dt><dd>{new Date(selectedBatch.createdAt).toLocaleString('ko-KR')}</dd></div><div><dt>원본 행</dt><dd>{count(selectedBatch.rowCount)}</dd></div><div><dt>후보 요약</dt><dd>Product {count(selectedBatch.productCount)} · SKU {count(selectedBatch.skuCount)} · BOM {count(selectedBatch.bomCount)}</dd></div></dl>
      <section className="import-review-section" aria-label="원본 파일 검증"><h4>원본 파일 검증</h4>
        {selectedBatch.sourceHashVerification === 'CLIENT_OBSERVED' || !selectedBatch.sourceFileId
          ? <p className="import-legacy-notice">이 Batch는 원본 파일 서버 검증 기능 도입 이전 기록입니다. 저장된 hash는 client-observed 값입니다. 기존 기록은 조회할 수 있지만 새로운 검토 결과는 저장할 수 없습니다.</p>
          : <><p><StatusBadge status={verifiedSource ? 'RESOLVED' : 'OPEN'} label={verifiedSource ? '서버 검증 완료' : selectedSource?.verificationStatus === 'HASH_MISMATCH' ? 'Hash 불일치' : '원본 검증 확인 필요'} /></p>
            {selectedSource && <dl className="import-batch-meta"><div><dt>원본 파일명</dt><dd>{selectedSource.originalFilename}</dd></div><div><dt>Server SHA-256</dt><dd className="mono">{selectedSource.serverSha256 ?? '—'}</dd></div><div><dt>파일 크기</dt><dd>{selectedSource.serverByteSize === null ? '—' : `${count(selectedSource.serverByteSize)} bytes`}</dd></div><div><dt>검증 시각</dt><dd>{selectedSource.verifiedAt ? new Date(selectedSource.verifiedAt).toLocaleString('ko-KR') : '—'}</dd></div></dl>}
            {verifiedSource && <button className="button button-small" type="button" disabled={downloading} onClick={() => void downloadSource()}>{downloading ? '링크 생성 중…' : '원본 파일 확인'}</button>}
            {sourceError && <p className="import-error" role="alert">{sourceError}</p>}
            {!verifiedSource && <p className="import-readonly-note">서버 검증된 원본을 확인할 수 없어 새로운 검토 결과를 저장할 수 없습니다.</p>}
          </>}
        <p className="import-readonly-note">Review 근거: 원본 ID, 서버 SHA-256, parser {selectedBatch.parserVersion || '이전 버전'}, validation r{selectedBatch.validationRevision}. 어느 하나가 달라지면 기존 검토를 새 분석의 승인 근거로 자동 재사용할 수 없습니다.</p>
      </section>
      <div className="import-saved-summary" aria-label="저장된 후보 판정 요약"><div><span>정상</span><strong>{count(selectedBatch.validCount)}</strong></div><div><span>주의</span><strong>{count(selectedBatch.warningCount)}</strong></div><div><span>오류</span><strong>{count(selectedBatch.errorCount)}</strong></div><div><span>보류</span><strong>{count(selectedBatch.deferredCount)}</strong></div></div>
      <p className="import-limitation">이 화면은 Candidate Snapshot과 사람의 검토 결정을 기록합니다. Master Apply 기능은 없으며 Batch는 REVIEW_REQUIRED 상태를 유지합니다.</p>
      {loadingDetails && <p className="import-section-state" role="status">저장된 후보와 이슈를 불러오는 중입니다…</p>}{detailError && <p className="import-error import-section-state" role="alert">{detailError}</p>}
      {legacyBatch && <div className="import-legacy-notice" role="note"><strong>Candidate Snapshot이 없는 이전 Batch입니다.</strong><span>원본 Candidate 상세를 중앙 DB에서 재현할 수 없습니다. Raw 데이터로 과거 parser 결과를 추정하지 않습니다.</span></div>}
      {!loadingDetails && !detailError && !legacyBatch && <>
        <div className="section-heading import-saved-issues-heading"><div><h3>저장된 후보</h3><p>Parser 값과 사람이 기록한 override를 분리해 조회합니다.</p></div><span className="subtle-tag">{count(candidates.length)} CANDIDATES</span></div>
        <div className="import-candidate-controls"><div className="tabs import-review-tabs" role="tablist" aria-label="저장된 후보 종류">{([['ALL', '전체'], ['PRODUCT', 'Product'], ['SKU', 'SKU'], ['BOM_COMPONENT', 'BOM']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={kindFilter === value} className={`tab ${kindFilter === value ? 'active' : ''}`} onClick={() => { setKindFilter(value); setCandidatePage(1) }}>{label}</button>)}</div><label className="import-review-filter"><span className="sr-only">후보 상태</span><select value={stateFilter} onChange={event => { setStateFilter(event.target.value as CandidateStateFilter); setCandidatePage(1) }}><option value="ALL">전체 상태</option><option value="VALID">정상</option><option value="WARNING">주의</option><option value="ERROR">오류</option><option value="DEFERRED">보류</option><option value="REVIEWED">검토됨</option><option value="UNREVIEWED">미검토</option></select></label></div>
        {visibleCandidates.length ? <><DataTable minWidth={900}><thead><tr><th>Kind</th><th>시트 / 행</th><th>Business Key</th><th>이름 / SKU</th><th>상태</th><th>이슈</th><th>검토</th><th>상세</th></tr></thead><tbody>{visibleCandidates.map(candidate => <tr key={candidate.id}><td>{kindLabel[candidate.kind]}</td><td>{source(candidate.sourceSheet, candidate.sourceRow)}</td><td className="mono">{candidateBusinessKey(candidate)}</td><td>{candidateName(candidate)}</td><td><StatusBadge status={candidate.candidateStatus} label={statusLabel[candidate.candidateStatus]} /></td><td>{count(candidate.issueCodes.length)}</td><td>{candidate.reviewedValues ? <StatusBadge status="RESOLVED" label={`검토됨 · r${candidate.reviewRevision}`} /> : <StatusBadge status="OPEN" label="미검토" />}</td><td><button className="button button-small" type="button" onClick={() => openCandidate(candidate)}>후보 상세</button></td></tr>)}</tbody></DataTable><div className="import-table-footer"><span>{count(filteredCandidates.length)}건 중 {count((candidatePage - 1) * PAGE_SIZE + 1)}–{count(Math.min(candidatePage * PAGE_SIZE, filteredCandidates.length))}건</span><button className="button button-small" disabled={candidatePage <= 1} onClick={() => setCandidatePage(page => page - 1)}>이전</button><button className="button button-small" disabled={candidatePage * PAGE_SIZE >= filteredCandidates.length} onClick={() => setCandidatePage(page => page + 1)}>다음</button></div></> : <EmptyState title="조건에 맞는 저장 후보가 없습니다" description="후보 종류나 상태 필터를 바꿔 보세요." />}
      </>}
      {!loadingDetails && !detailError && <>
        <div className="section-heading import-saved-issues-heading"><div><h3>저장된 검증 이슈</h3><p>이슈 결정과 원본 증거를 확인합니다.</p></div><span className="subtle-tag">{count(issues.length)} ISSUES</span></div>
        {!issues.length ? <EmptyState title="저장된 검증 이슈가 없습니다" /> : <DataTable minWidth={940}><thead><tr><th>심각도</th><th>코드</th><th>시트 / 행</th><th>원본 값</th><th>메시지</th><th>상태</th><th>검토</th></tr></thead><tbody>{issues.map(issue => <tr key={issue.id}><td><StatusBadge status={issue.severity} /></td><td className="mono">{issue.issueCode}</td><td>{source(issue.sourceSheet ?? '전체', issue.sourceRow)}</td><td className="import-observed">{observed(issue.observedValue)}</td><td>{issue.message}</td><td><StatusBadge status={issue.status} label={statusLabel[issue.status] ?? issue.status} /></td><td><button className="button button-small" type="button" onClick={() => openIssue(issue)}>이슈 상세</button></td></tr>)}</tbody></DataTable>}
      </>}
    </section>}
    {selectedCandidate && <CandidateDetail key={`${selectedCandidate.id}:${selectedCandidate.reviewRevision}`} candidate={selectedCandidate} issues={issues} rawRow={rawRow} loadingRaw={loadingRaw} rawError={rawError} role={reviewRole} saving={savingReview} saveError={reviewError} onSave={saveCandidate} onClose={closeDrawer} />}
    {selectedIssue && <IssueDetail key={`${selectedIssue.id}:${selectedIssue.reviewRevision}`} issue={selectedIssue} rawRow={rawRow} loading={loadingRaw} error={rawError} role={reviewRole} saving={savingReview} saveError={reviewError} onSave={saveIssue} onClose={closeDrawer} />}
  </section>
}
